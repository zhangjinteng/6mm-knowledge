import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { getLocalSandboxDirectory } from '../localPath';
import type {
  BackgroundExecution,
  ContentReplaceEntry,
  DirectoryEntry,
  Endpoint,
  ExecuteOptions,
  ExecuteResult,
  FileDeleteResult,
  FileInfo,
  FileReadResult,
  FileWriteEntry,
  FileWriteResult,
  ISandbox,
  MoveEntry,
  PermissionEntry,
  ReadFileOptions,
  SandboxCreateSpec,
  SandboxEndpointSelector,
  SandboxId,
  SandboxInfo,
  SandboxMetrics,
  SandboxStatus,
  SearchResult,
  StreamHandlers
} from '@fastgpt-sdk/sandbox-adapter';

type LocalSandboxAdapterConfig = {
  sandboxId: string;
  rootDir: string;
};

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

const trimTrailingPathSeparator = (value: string) =>
  value.endsWith(path.sep) ? value.slice(0, -1) : value;

const escapeRegExp = (value: string) => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');

const globPatternToRegExp = (pattern: string) => {
  const source = pattern
    .split('')
    .map((char) => {
      if (char === '*') return '.*';
      if (char === '?') return '.';
      return escapeRegExp(char);
    })
    .join('');

  return new RegExp(`^${source}$`);
};

const isAbortError = (error: unknown) =>
  error instanceof Error && (error.name === 'AbortError' || error.message === 'AbortError');

/**
 * 无隔离的本机 sandbox adapter。
 *
 * 该 adapter 只把 WorkGPT sandbox 接口映射到宿主机目录和本机 shell。文件 API 会限制在
 * rootDir 内；execute 执行的是宿主机命令，不提供安全隔离。
 */
export class LocalSandboxAdapter implements ISandbox {
  readonly id: SandboxId;
  readonly provider = 'local';

  private readonly rootDir: string;
  private readonly sandboxRootDir: string;
  private readonly workDirectory: string;
  private readonly canCreateWorkspace: boolean;
  private readonly createdAt = new Date();
  private readonly backgroundProcesses = new Map<string, ChildProcessWithoutNullStreams>();
  private currentStatus: SandboxStatus = { state: 'Creating' };

  constructor(
    config: LocalSandboxAdapterConfig,
    private readonly createConfig: SandboxCreateSpec = {}
  ) {
    this.id = config.sandboxId;
    this.rootDir = path.resolve(config.rootDir);
    this.sandboxRootDir = getLocalSandboxDirectory(this.rootDir, this.id);
    this.canCreateWorkspace = !!createConfig.workingDir;
    this.workDirectory = path.resolve(
      createConfig.workingDir ?? path.join(this.sandboxRootDir, 'workspace')
    );
    this.assertInsideRoot(this.workDirectory);
  }

  get status(): SandboxStatus {
    return this.currentStatus;
  }

  private assertInsideRoot(resolvedPath: string) {
    const normalizedRoot = trimTrailingPathSeparator(this.rootDir);
    const normalizedPath = path.resolve(resolvedPath);

    if (
      normalizedPath !== normalizedRoot &&
      !normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)
    ) {
      throw new Error(`Local sandbox path escapes root: ${resolvedPath}`);
    }
  }

  private resolveFilePath(filePath: string = '.') {
    const resolvedPath = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(this.workDirectory, filePath);

    this.assertInsideRoot(resolvedPath);
    return resolvedPath;
  }

  private async ensureParentDirectory(filePath: string) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  }

  private async ensureNotSymlink(filePath: string) {
    try {
      const stats = await fs.lstat(filePath);
      if (stats.isSymbolicLink()) {
        throw new Error(`Symbolic links are not allowed in local sandbox file API: ${filePath}`);
      }
    } catch (error: any) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }

  private async toBuffer(data: FileWriteEntry['data']): Promise<Buffer> {
    if (typeof data === 'string') return Buffer.from(data);
    if (data instanceof Uint8Array) return Buffer.from(data);
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (data instanceof Blob) return Buffer.from(await data.arrayBuffer());

    const reader = data.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        chunks.push(value);
        totalLength += value.length;
      }
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
      totalLength
    );
  }

  async ensureRunning(): Promise<void> {
    if (this.canCreateWorkspace) {
      await this.create();
      return;
    }

    try {
      await fs.access(this.workDirectory);
      this.currentStatus = { state: 'Running' };
    } catch {
      this.currentStatus = {
        state: 'UnExist',
        message: 'Local sandbox workspace does not exist'
      };
      throw new Error(`Local sandbox workspace does not exist: ${this.workDirectory}`);
    }
  }

  async create(): Promise<void> {
    await fs.mkdir(this.workDirectory, { recursive: true });
    this.currentStatus = { state: 'Running' };
  }

  async start(): Promise<void> {
    await this.create();
  }

  async stop(): Promise<void> {
    this.currentStatus = { state: 'Stopped' };
  }

  async delete(sandboxId?: SandboxId): Promise<void> {
    const targetRoot = sandboxId
      ? getLocalSandboxDirectory(this.rootDir, sandboxId)
      : this.sandboxRootDir;
    this.assertInsideRoot(targetRoot);
    await fs.rm(targetRoot, { recursive: true, force: true });
    this.currentStatus = { state: 'Deleting' };
  }

  async getInfo(): Promise<SandboxInfo | null> {
    return {
      id: this.id,
      image: this.createConfig.image ?? { repository: 'local' },
      entrypoint: this.createConfig.entrypoint ?? [],
      metadata: Object.fromEntries(
        Object.entries(this.createConfig.metadata ?? {}).map(([key, value]) => [key, String(value)])
      ),
      status: this.currentStatus,
      createdAt: this.createdAt,
      resourceLimits: this.createConfig.resourceLimits
    };
  }

  async waitUntilReady(): Promise<void> {
    await this.ensureRunning();
  }

  async waitUntilDeleted(timeoutMs = 120000): Promise<void> {
    const startedAt = Date.now();
    const targetRoot = getLocalSandboxDirectory(this.rootDir, this.id);

    while (Date.now() - startedAt < timeoutMs) {
      try {
        await fs.access(targetRoot);
      } catch {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(`Local sandbox deletion timed out: ${this.id}`);
  }

  async renewExpiration(): Promise<void> {
    return;
  }

  private appendLimitedOutput(
    current: Buffer<ArrayBufferLike>,
    chunk: Buffer<ArrayBufferLike>,
    maxOutputBytes: number
  ): { output: Buffer<ArrayBufferLike>; truncated: boolean } {
    const output = Buffer.concat([current, chunk]);
    if (output.length <= maxOutputBytes) {
      return { output, truncated: false };
    }

    return {
      output: output.subarray(output.length - maxOutputBytes),
      truncated: true
    };
  }

  async execute(command: string, options: ExecuteOptions = {}): Promise<ExecuteResult> {
    await this.ensureRunning();

    const startedAt = Date.now();
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const cwd = options.workingDirectory
      ? this.resolveFilePath(options.workingDirectory)
      : this.workDirectory;

    await fs.mkdir(cwd, { recursive: true });

    return new Promise<ExecuteResult>((resolve) => {
      let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let truncated = false;
      let settled = false;
      let timedOut = false;
      let timeout: NodeJS.Timeout | undefined;

      const child = spawn('sh', ['-lc', command], {
        cwd,
        env: {
          ...process.env,
          ...(this.createConfig.env ?? {}),
          ...(options.env ?? {})
        }
      });

      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abortHandler);
      };

      const finish = (result: ExecuteResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      timeout = options.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            setTimeout(() => {
              if (!settled) child.kill('SIGKILL');
            }, 1000).unref();
          }, options.timeoutMs)
        : undefined;

      const abortHandler = () => {
        child.kill('SIGTERM');
      };
      options.signal?.addEventListener('abort', abortHandler, { once: true });

      child.stdout.on('data', (chunk: Buffer) => {
        const result = this.appendLimitedOutput(stdout, chunk, maxOutputBytes);
        stdout = result.output;
        truncated ||= result.truncated;
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const result = this.appendLimitedOutput(stderr, chunk, maxOutputBytes);
        stderr = result.output;
        truncated ||= result.truncated;
      });

      child.once('error', (error) => {
        finish({
          stdout: stdout.toString('utf-8'),
          stderr: error.message,
          exitCode: -1,
          truncated,
          durationMs: Date.now() - startedAt
        });
      });

      child.once('close', (code, signal) => {
        const stderrText = stderr.toString('utf-8');
        const timeoutText = timedOut
          ? `${stderrText}${stderrText ? '\n' : ''}Command timed out after ${options.timeoutMs}ms`
          : stderrText;

        finish({
          stdout: stdout.toString('utf-8'),
          stderr: timeoutText,
          exitCode: code ?? (signal ? -1 : 0),
          truncated,
          durationMs: Date.now() - startedAt
        });
      });
    }).catch((error: unknown) => {
      if (isAbortError(error)) {
        return {
          stdout: '',
          stderr: 'Command aborted',
          exitCode: -1,
          durationMs: Date.now() - startedAt
        };
      }
      throw error;
    });
  }

  async executeStream(
    command: string,
    handlers: StreamHandlers,
    options?: ExecuteOptions
  ): Promise<void> {
    const result = await this.execute(command, options);
    if (result.stdout) await handlers.onStdout?.({ text: result.stdout });
    if (result.stderr) await handlers.onStderr?.({ text: result.stderr });
    await handlers.onComplete?.(result);
  }

  async executeBackground(
    command: string,
    options: ExecuteOptions = {}
  ): Promise<BackgroundExecution> {
    await this.ensureRunning();
    const sessionId = randomUUID();
    const cwd = options.workingDirectory
      ? this.resolveFilePath(options.workingDirectory)
      : this.workDirectory;
    const child = spawn('sh', ['-lc', command], {
      cwd,
      env: {
        ...process.env,
        ...(this.createConfig.env ?? {}),
        ...(options.env ?? {})
      }
    });

    this.backgroundProcesses.set(sessionId, child);
    child.once('close', () => {
      this.backgroundProcesses.delete(sessionId);
    });

    return {
      sessionId,
      kill: async () => {
        await this.interrupt(sessionId);
      }
    };
  }

  async interrupt(sessionId: string): Promise<void> {
    const child = this.backgroundProcesses.get(sessionId);
    if (!child) return;

    child.kill('SIGTERM');
    this.backgroundProcesses.delete(sessionId);
  }

  async readFiles(paths: string[], options?: ReadFileOptions): Promise<FileReadResult[]> {
    const results: FileReadResult[] = [];

    for (const filePath of paths) {
      const resolvedPath = this.resolveFilePath(filePath);
      try {
        await this.ensureNotSymlink(resolvedPath);
        const content = await fs.readFile(resolvedPath);
        const selectedContent = (() => {
          if (!options?.range) return content;

          const [startValue, endValue] = options.range.split('-');
          const start = Number.parseInt(startValue, 10);
          const end = endValue ? Number.parseInt(endValue, 10) : undefined;
          if (Number.isNaN(start) || (endValue && Number.isNaN(end as number))) {
            throw new Error(`Invalid range: ${options.range}`);
          }
          return content.subarray(start, end);
        })();

        results.push({ path: resolvedPath, content: selectedContent, error: null });
      } catch (error) {
        results.push({
          path: resolvedPath,
          content: new Uint8Array(),
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    }

    return results;
  }

  async writeFiles(entries: FileWriteEntry[]): Promise<FileWriteResult[]> {
    const results: FileWriteResult[] = [];

    for (const entry of entries) {
      const resolvedPath = this.resolveFilePath(entry.path);
      try {
        await this.ensureNotSymlink(resolvedPath);
        await this.ensureParentDirectory(resolvedPath);
        const data = await this.toBuffer(entry.data);
        await fs.writeFile(resolvedPath, data);
        if (entry.mode !== undefined) {
          await fs.chmod(resolvedPath, entry.mode).catch(() => undefined);
        }
        results.push({ path: resolvedPath, bytesWritten: data.length, error: null });
      } catch (error) {
        results.push({
          path: resolvedPath,
          bytesWritten: 0,
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    }

    return results;
  }

  async deleteFiles(paths: string[]): Promise<FileDeleteResult[]> {
    const results: FileDeleteResult[] = [];

    for (const filePath of paths) {
      const resolvedPath = this.resolveFilePath(filePath);
      try {
        await this.ensureNotSymlink(resolvedPath);
        await fs.rm(resolvedPath, { force: true });
        results.push({ path: resolvedPath, success: true, error: null });
      } catch (error) {
        results.push({
          path: resolvedPath,
          success: false,
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    }

    return results;
  }

  async moveFiles(entries: MoveEntry[]): Promise<void> {
    for (const entry of entries) {
      const source = this.resolveFilePath(entry.source);
      const destination = this.resolveFilePath(entry.destination);
      await this.ensureNotSymlink(source);
      await this.ensureParentDirectory(destination);
      await fs.rename(source, destination);
    }
  }

  async replaceContent(entries: ContentReplaceEntry[]): Promise<void> {
    for (const entry of entries) {
      const resolvedPath = this.resolveFilePath(entry.path);
      await this.ensureNotSymlink(resolvedPath);
      const content = await fs.readFile(resolvedPath, 'utf-8');
      await fs.writeFile(resolvedPath, content.split(entry.oldContent).join(entry.newContent));
    }
  }

  async *readFileStream(filePath: string): AsyncIterable<Uint8Array> {
    const resolvedPath = this.resolveFilePath(filePath);
    await this.ensureNotSymlink(resolvedPath);
    for await (const chunk of createReadStream(resolvedPath)) {
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    }
  }

  async writeFileStream(filePath: string, stream: ReadableStream<Uint8Array>): Promise<void> {
    const resolvedPath = this.resolveFilePath(filePath);
    await this.ensureNotSymlink(resolvedPath);
    await this.ensureParentDirectory(resolvedPath);

    const writer = createWriteStream(resolvedPath);
    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) writer.write(Buffer.from(value));
      }
      await new Promise<void>((resolve, reject) => {
        writer.once('finish', resolve);
        writer.once('error', reject);
        writer.end();
      });
    } finally {
      reader.releaseLock();
    }
  }

  async createDirectories(paths: string[], options?: { mode?: number }): Promise<void> {
    for (const directoryPath of paths) {
      const resolvedPath = this.resolveFilePath(directoryPath);
      await fs.mkdir(resolvedPath, { recursive: true });
      if (options?.mode !== undefined) {
        await fs.chmod(resolvedPath, options.mode).catch(() => undefined);
      }
    }
  }

  async deleteDirectories(
    paths: string[],
    options?: { recursive?: boolean; force?: boolean }
  ): Promise<void> {
    for (const directoryPath of paths) {
      const resolvedPath = this.resolveFilePath(directoryPath);
      await this.ensureNotSymlink(resolvedPath);
      await fs.rm(resolvedPath, {
        recursive: options?.recursive !== false,
        force: options?.force !== false
      });
    }
  }

  async listDirectory(directoryPath: string): Promise<DirectoryEntry[]> {
    const resolvedPath = this.resolveFilePath(directoryPath);
    await this.ensureNotSymlink(resolvedPath);
    const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

    return Promise.all(
      entries
        .filter((entry) => entry.name !== '.' && entry.name !== '..')
        .map(async (entry) => {
          const entryPath = path.join(resolvedPath, entry.name);
          const stats = await fs.lstat(entryPath);

          return {
            name: entry.name,
            path: entryPath,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            size: stats.isFile() ? stats.size : undefined,
            modifiedAt: stats.mtime
          };
        })
    );
  }

  async getFileInfo(paths: string[]): Promise<Map<string, FileInfo>> {
    const infoMap = new Map<string, FileInfo>();

    for (const filePath of paths) {
      const resolvedPath = this.resolveFilePath(filePath);
      try {
        const stats = await fs.lstat(resolvedPath);
        infoMap.set(resolvedPath, {
          path: resolvedPath,
          size: stats.size,
          modifiedAt: stats.mtime,
          createdAt: stats.birthtime,
          mode: stats.mode,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          isSymlink: stats.isSymbolicLink()
        });
      } catch {
        continue;
      }
    }

    return infoMap;
  }

  async setPermissions(entries: PermissionEntry[]): Promise<void> {
    for (const entry of entries) {
      const resolvedPath = this.resolveFilePath(entry.path);
      if (entry.mode !== undefined) {
        await fs.chmod(resolvedPath, entry.mode);
      }
      if (entry.owner || entry.group) {
        // Node 的 chown 需要 uid/gid；本机适配器保守忽略名称型 owner/group。
        continue;
      }
    }
  }

  async search(pattern: string, searchPath: string = '.'): Promise<SearchResult[]> {
    const rootPath = this.resolveFilePath(searchPath);
    const matcher = globPatternToRegExp(pattern);
    const results: SearchResult[] = [];

    const walk = async (currentPath: string) => {
      await this.ensureNotSymlink(currentPath);
      const stats = await fs.lstat(currentPath);
      const name = path.basename(currentPath);

      if (matcher.test(name)) {
        results.push({
          path: currentPath,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile()
        });
      }

      if (!stats.isDirectory()) return;

      const entries = await fs.readdir(currentPath);
      for (const entry of entries) {
        await walk(path.join(currentPath, entry));
      }
    };

    await walk(rootPath);
    return results;
  }

  async ping(): Promise<boolean> {
    try {
      await fs.mkdir(this.workDirectory, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  async getMetrics(): Promise<SandboxMetrics> {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();

    return {
      cpuCount: os.cpus().length,
      cpuUsedPercentage: 0,
      memoryTotalMiB: Math.floor(totalMemory / 1024 / 1024),
      memoryUsedMiB: Math.floor((totalMemory - freeMemory) / 1024 / 1024),
      timestamp: Date.now()
    };
  }

  async getEndpoint(_selector: SandboxEndpointSelector): Promise<Endpoint> {
    throw new Error('Endpoint resolution is not supported by local permission sandbox');
  }
}
