import path from 'node:path';
import { generateSandboxId } from '../../../../../global/core/ai/sandbox/constants';
import type {
  ExecuteResult,
  ResourceLimits,
  SandboxCreateSpec
} from '@fastgpt-sdk/sandbox-adapter';
import {
  resolveAgentSandboxRuntime,
  type AgentSandboxRuntimeType
} from '../../../../../global/core/ai/sandbox/permission';
import { serviceEnv } from '../../../../env';
import { getLocalSandboxDirectory } from '../localPath';
import { LocalSandboxAdapter } from './localSandboxAdapter';
import type { SandboxToolRuntime } from './runtime';

type UnionIdType = {
  appId: string;
  userId: string;
  chatId: string;
};

type PermissionSandboxClientProps = {
  sandboxId: string;
  runtime: AgentSandboxRuntimeType;
  createConfig?: SandboxCreateSpec;
};

const COMMAND_BLOCKED_RESULT: ExecuteResult = {
  stdout: '',
  stderr:
    'command_execution is blocked by the workspace-write permission sandbox. Switch agentSandboxPermissionMode to "danger-full-access" to run host shell commands.',
  exitCode: -1
};

const resolveSandboxId = (props: { sandboxId: string } | UnionIdType): string => {
  if ('sandboxId' in props) {
    return props.sandboxId;
  }

  const sandboxUserId = props.chatId === 'edit-debug' ? '' : props.userId;
  return generateSandboxId(props.appId, sandboxUserId, props.chatId);
};

const getPermissionSandboxWorkspace = (sandboxId: string) =>
  path.join(getLocalSandboxDirectory(serviceEnv.AGENT_SANDBOX_LOCAL_ROOT, sandboxId), 'workspace');

const getFilesystemRoot = () => path.parse(process.cwd()).root;

/**
 * fastify 运行链路使用的本地权限 sandbox client。
 *
 * workspace-write 模式把 rootDir 收窄到会话 workspace 并阻断命令；
 * danger-full-access 模式把 rootDir 放宽到文件系统根目录，因此只适合可信本地调试。
 */
export class PermissionSandboxClient implements SandboxToolRuntime {
  readonly provider: LocalSandboxAdapter;
  private readonly sandboxId: string;
  private readonly workDirectory: string;
  private readonly runtime: AgentSandboxRuntimeType;

  constructor({ sandboxId, runtime, createConfig }: PermissionSandboxClientProps) {
    this.sandboxId = sandboxId;
    this.runtime = resolveAgentSandboxRuntime(runtime);
    this.workDirectory = getPermissionSandboxWorkspace(sandboxId);

    const rootDir =
      this.runtime.mode === 'danger-full-access' ? getFilesystemRoot() : this.workDirectory;

    this.provider = new LocalSandboxAdapter(
      {
        sandboxId,
        rootDir
      },
      {
        ...createConfig,
        workingDir: this.workDirectory
      }
    );
  }

  async ensureAvailable() {
    await this.provider.ensureRunning();
  }

  getSandboxId() {
    return this.sandboxId;
  }

  getWorkDirectory() {
    return this.workDirectory;
  }

  getSkillsRootPath() {
    return this.workDirectory;
  }

  /**
   * 按权限模式执行命令。
   *
   * workspace-write 模式必须把命令作为工具响应返回给模型，不能抛出 workflow 错误；
   * danger-full-access 模式才真正调用本机 shell。
   */
  async exec(command: string, timeout?: number): Promise<ExecuteResult> {
    if (this.runtime.mode !== 'danger-full-access') {
      return COMMAND_BLOCKED_RESULT;
    }

    return this.provider.execute(command, {
      timeoutMs: timeout ? timeout * 1000 : undefined
    });
  }

  async delete() {
    await this.provider.delete();
  }

  async stop() {
    await this.provider.stop();
  }
}

/**
 * 获取 fastify 权限 sandbox client。
 *
 * 只根据 app/user/chat 的稳定 sandboxId 打开一个本地会话 workspace。
 */
export const getPermissionSandboxClient = async (
  props:
    | {
        sandboxId: string;
      }
    | UnionIdType,
  opts: {
    runtime?: AgentSandboxRuntimeType;
    resourceLimits?: ResourceLimits;
    createConfig?: SandboxCreateSpec;
  }
) => {
  const sandboxId = resolveSandboxId(props);
  const sandbox = new PermissionSandboxClient({
    sandboxId,
    runtime: resolveAgentSandboxRuntime(opts.runtime),
    createConfig: opts.createConfig
  });
  await sandbox.ensureAvailable();
  return sandbox;
};
