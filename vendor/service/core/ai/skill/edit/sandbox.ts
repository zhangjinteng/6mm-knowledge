import type { SandboxCreateSpec } from '@fastgpt-sdk/sandbox-adapter';
import { MongoAgentSkills } from '../model/schema';
import { MongoAgentSkillsVersion } from '../version/schema';
import {
  parseSkillMarkdown,
  shellQuote,
  getSafeSkillDirectoryName,
  joinSandboxPath,
  parseGitignoreRules
} from '../utils';
import { downloadSkillPackage, DEFAULT_GITIGNORE_CONTENT } from '../package';
import { getSkillSizeLimits } from '../sandbox/config';
import { EDIT_DEBUG_SANDBOX_CHAT_ID, getEditDebugSandboxId } from './config';
import {
  buildBaseSandboxRuntimeEnv,
  getSandboxRuntimeProfile
} from '../../sandbox/runtime/profile';
import type { SandboxImageConfigType } from '../../../../../global/core/ai/skill/type';
import { SandboxTypeEnum } from '../../../../../global/core/ai/skill/constants';
import { getPermissionSandboxClient } from '../../sandbox/service/permissionRuntime';
import {
  countRunningSandboxInstancesByType,
  findSandboxInstanceByAppChatType,
  upsertRunningSandboxInstance,
  updateSandboxInstanceRecordBySandboxId
} from '../../sandbox/instance/repository';
import { getLogger, LogCategories } from '../../../../common/logger';
import { serviceEnv } from '../../../../env';
import type { SandboxStatusItemType } from '../../../../../global/core/chat/type';

const PERMISSION_SANDBOX_PROVIDER = 'local' as const;

const addLog = getLogger(LogCategories.MODULE.AI.AGENT);

export type CreateEditDebugSandboxParams = {
  skillId: string;
  teamId: string;
  tmbId: string;
  image?: SandboxImageConfigType;
  entrypoint?: string;
  onProgress?: (status: SandboxStatusItemType) => void;
};

export type CreateEditDebugSandboxResult = {
  sandboxId: string;
  status: {
    state: string;
    message?: string;
  };
};

/**
 * 创建或复用一个 skill 编辑态 sandbox。
 *
 * 该流程只服务 edit-debug：下载当前版本包，标准化目录结构，写入并解压到
 * sandbox 工作目录下的 `skills`，最后返回 sandboxId/status 供 SandboxEditor 文件 API 使用。普通 agent session
 * 的 skill 注入逻辑仍由 runtime/useSandbox 负责，避免编辑态和运行态生命周期互相污染。
 */
export async function createEditDebugSandbox(
  params: CreateEditDebugSandboxParams
): Promise<CreateEditDebugSandboxResult> {
  const { skillId, teamId, tmbId, image, entrypoint, onProgress } = params;

  const runtimeProfile = getSandboxRuntimeProfile();

  const sandboxImage = image || runtimeProfile.defaultImage;

  addLog.info('[Sandbox] Creating edit-debug sandbox', {
    skillId,
    teamId,
    image: sandboxImage
  });

  const skill = await MongoAgentSkills.findOne({
    _id: skillId,
    teamId,
    deleteTime: null
  });

  if (!skill) {
    throw new Error('Skill not found or access denied');
  }

  if (!skill.currentVersionId) {
    throw new Error('Skill package not found - no current version available');
  }

  const currentVersion = await MongoAgentSkillsVersion.findOne({
    _id: skill.currentVersionId,
    skillId
  });

  if (!currentVersion) {
    throw new Error('No current version found for skill');
  }

  const existingInstance = await findSandboxInstanceByAppChatType({
    appId: skillId,
    chatId: EDIT_DEBUG_SANDBOX_CHAT_ID,
    type: SandboxTypeEnum.editDebug
  });
  const sessionId = existingInstance?.sandboxId || getEditDebugSandboxId(skillId);
  const workDirectory = runtimeProfile.resolveWorkDirectory(sessionId);
  const getEditSkillSandboxPaths = () => ({
    skillsRootPath: runtimeProfile.resolveSkillsRootPath(sessionId)
  });

  if (existingInstance && existingInstance.provider !== PERMISSION_SANDBOX_PROVIDER) {
    await updateSandboxInstanceRecordBySandboxId({
      sandboxId: existingInstance.sandboxId,
      nextProvider: PERMISSION_SANDBOX_PROVIDER
    });
  }

  const maxEditDebug =
    global.feConfigs?.limit?.agentSandboxMaxEditDebug ?? serviceEnv.AGENT_SANDBOX_MAX_EDIT_DEBUG;
  if (maxEditDebug !== undefined) {
    const activeCount = await countRunningSandboxInstancesByType(SandboxTypeEnum.editDebug);
    const effectiveActiveCount = existingInstance ? Math.max(0, activeCount - 1) : activeCount;
    if (effectiveActiveCount >= maxEditDebug) {
      const message = `Active edit-debug sandbox limit reached (${effectiveActiveCount}/${maxEditDebug}). Please try again later.`;
      onProgress?.({ sandboxId: sessionId, phase: 'failed', message });
      throw new Error(message);
    }
  }

  let sandboxClient: Awaited<ReturnType<typeof getPermissionSandboxClient>> | null = null;

  try {
    onProgress?.({ sandboxId: sessionId, phase: 'downloadingPackage' });
    const packageBuffer = await downloadSkillPackage({
      storageKey: currentVersion.storageKey
    });

    onProgress?.({ sandboxId: sessionId, phase: 'creatingContainer' });

    const runtimeEnv = buildBaseSandboxRuntimeEnv(sessionId, workDirectory);
    const runtimeMetadata = {
      skillId,
      teamId,
      sessionId
    };
    const createConfig: SandboxCreateSpec = runtimeProfile.buildConfig({
      scenario: 'edit-debug',
      sessionId,
      image: sandboxImage,
      entrypoint: entrypoint ?? runtimeProfile.entrypoint,
      env: runtimeEnv,
      metadata: runtimeMetadata
    }) ?? {
      env: runtimeEnv,
      metadata: runtimeMetadata
    };
    const client = await getPermissionSandboxClient(
      {
        sandboxId: sessionId
      },
      {
        createConfig
      }
    );
    sandboxClient = client;

    const sandboxInfo = await client.provider.getInfo();

    const { skillsRootPath } = getEditSkillSandboxPaths();

    const prepareWorkDirectoryResult = await client.provider.execute(
      `mkdir -p ${shellQuote(workDirectory)}`
    );
    if (prepareWorkDirectoryResult.exitCode !== 0) {
      throw new Error(
        `Failed to prepare workspace directory: ${prepareWorkDirectoryResult.stderr}`
      );
    }

    onProgress?.({ sandboxId: sessionId, phase: 'uploadingPackage' });
    const zipPath = joinSandboxPath(skillsRootPath, 'package.zip');

    const prepareResult = await client.provider.execute(
      `rm -rf ${shellQuote(skillsRootPath)} && mkdir -p ${shellQuote(skillsRootPath)}`
    );
    if (prepareResult.exitCode !== 0) {
      throw new Error(`Failed to reset skill directory: ${prepareResult.stderr}`);
    }

    const writeResults = await client.provider.writeFiles([
      {
        path: zipPath,
        data: packageBuffer
      }
    ]);
    const failedWrite = writeResults.find((result) => result.error);
    if (failedWrite) {
      throw new Error(`Failed to write skill package ZIP: ${failedWrite.error?.message}`);
    }

    const quotedSkillsRootPath = shellQuote(skillsRootPath);
    const quotedZipPath = shellQuote(zipPath);
    const unzipCmd = [
      `cd ${quotedSkillsRootPath}`,
      `mkdir -p tmp_unzip`,
      `unzip -o -q package.zip -d tmp_unzip`,
      `rm -f package.zip`
    ].join(' && ');

    const extractResult = await client.provider.execute(unzipCmd);
    if (extractResult.exitCode !== 0) {
      throw new Error(`Failed to decompress package inside sandbox: ${extractResult.stderr}`);
    }

    const findSkillMdResult = await client.provider.execute(
      `find ${quotedSkillsRootPath}/tmp_unzip -iname "skill.md" | head -n 1`
    );
    const skillMdPath = findSkillMdResult.stdout.trim();

    let skillFolderName = getSafeSkillDirectoryName(skill.name);
    if (skillMdPath) {
      try {
        const readFilesResult = await client.provider.readFiles([skillMdPath]);
        const file = readFilesResult?.[0];
        if (file && !file.error) {
          const content =
            typeof file.content === 'string'
              ? file.content
              : Buffer.from(file.content).toString('utf-8');
          const { frontmatter } = parseSkillMarkdown(content);
          if (frontmatter.name) {
            skillFolderName = getSafeSkillDirectoryName(String(frontmatter.name));
          }
        }
      } catch (err: any) {
        addLog.warn('[Sandbox] Failed to read and parse SKILL.md from package', {
          sandboxId: sessionId,
          error: err.message
        });
      }
    }

    const quotedSkillFolderName = shellQuote(skillFolderName);
    const moveCmd = [
      `cd ${quotedSkillsRootPath}`,
      `REAL_SKILL_DIR=$(dirname "$(find tmp_unzip -iname "skill.md" | head -n 1)")`,
      `if [ -n "$REAL_SKILL_DIR" ] && [ "$REAL_SKILL_DIR" != "." ]; then mv "$REAL_SKILL_DIR" ${quotedSkillFolderName}; fi`,
      `rm -rf tmp_unzip`,
      `if [ -f ${quotedSkillFolderName}/.gitignore ]; then mv ${quotedSkillFolderName}/.gitignore ${shellQuote(workDirectory)}/ 2>/dev/null || true; fi`,
      `if [ ! -f ${shellQuote(workDirectory)}/.gitignore ]; then echo ${shellQuote(DEFAULT_GITIGNORE_CONTENT)} > ${shellQuote(workDirectory)}/.gitignore; fi`
    ].join(' && ');

    const moveResult = await client.provider.execute(moveCmd);
    if (moveResult.exitCode !== 0) {
      throw new Error(`Failed to move and organize skill folder: ${moveResult.stderr}`);
    }

    await upsertRunningSandboxInstance({
      provider: PERMISSION_SANDBOX_PROVIDER,
      sandboxId: sessionId,
      appId: skillId,
      userId: '',
      chatId: EDIT_DEBUG_SANDBOX_CHAT_ID,
      metadata: {
        teamId,
        tmbId,
        skillId,
        sessionId,
        provider: PERMISSION_SANDBOX_PROVIDER,
        workDirectory
      }
    });
    const newSandboxDoc = await updateSandboxInstanceRecordBySandboxId({
      provider: PERMISSION_SANDBOX_PROVIDER,
      sandboxId: sessionId,
      appId: skillId,
      userId: '',
      chatId: EDIT_DEBUG_SANDBOX_CHAT_ID,
      type: SandboxTypeEnum.editDebug,
      metadata: {
        teamId,
        tmbId,
        skillId,
        sessionId,
        provider: PERMISSION_SANDBOX_PROVIDER,
        workDirectory,
        image: sandboxInfo?.image ?? sandboxImage,
        sandboxCreatedAt: sandboxInfo?.createdAt,
        storage: {
          key: currentVersion.storageKey,
          uploadedAt: new Date()
        },
        metadata: new Map([
          ['skillName', skill.name],
          ['versionId', currentVersion._id.toString()]
        ])
      }
    });

    if (!newSandboxDoc) throw new Error('Failed to find sandbox document after creation');

    onProgress?.({
      sandboxId: sessionId,
      phase: 'ready'
    });

    return {
      sandboxId: sessionId,
      status: {
        state: sandboxInfo?.status.state ?? 'Running',
        message: sandboxInfo?.status.message
      }
    };
  } catch (error) {
    addLog.error('[Sandbox] Failed to create sandbox', {
      error,
      rawBody: (error as any)?.cause?.rawBody ?? (error as any)?.rawBody
    });

    if (sandboxClient) {
      try {
        await sandboxClient.delete();
      } catch (cleanupError) {
        addLog.error('[Sandbox] Failed to cleanup sandbox after error', { cleanupError });
      }
    }

    throw error;
  }
}

/**
 * 将编辑态 sandbox 内的 skill 目录打包成 zip。
 *
 * 保存发布时只读取指定 workDirectory，默认会先做目录大小检查，避免把过大的编辑工作区
 * 直接压入对象存储。调用方负责后续 SKILL.md 解析、版本写入和对象存储上传。
 */
export async function packageSkillInSandbox(params: {
  sandboxId: string;
  workDirectory?: string;
  fallbackDirectory?: {
    rootDirectory: string;
    suffix: string;
  };
}): Promise<Buffer> {
  const { sandboxId, workDirectory, fallbackDirectory } = params;
  const { maxSandboxPackageBytes: maxBytes } = getSkillSizeLimits();

  try {
    const sandboxClient = await getPermissionSandboxClient({ sandboxId }, {});
    const newSandbox = sandboxClient.provider;
    const preferredTargetDir = workDirectory || sandboxClient.getWorkDirectory();

    const preferredDirExists = await newSandbox.execute(`[ -d ${shellQuote(preferredTargetDir)} ]`);
    const targetDir = await (async () => {
      if (preferredDirExists.exitCode === 0) return preferredTargetDir;
      if (!fallbackDirectory) return preferredTargetDir;

      const fallbackResult = await newSandbox.execute(
        `find ${shellQuote(fallbackDirectory.rootDirectory)} -mindepth 1 -maxdepth 1 -type d -name ${shellQuote(
          `*${fallbackDirectory.suffix}`
        )} -print | head -n 1`
      );
      const fallbackDir = fallbackResult.stdout.trim().split('\n').filter(Boolean)[0];
      return fallbackResult.exitCode === 0 && fallbackDir ? fallbackDir : preferredTargetDir;
    })();
    const quotedTargetDir = shellQuote(targetDir);

    let gitignoreContents: string[] = [];
    try {
      const findIgnoreCmd = `find ${quotedTargetDir} -name '.gitignore' -type f`;
      const findIgnoreResult = await newSandbox.execute(findIgnoreCmd);
      if (findIgnoreResult.exitCode === 0 && findIgnoreResult.stdout.trim()) {
        const ignorePaths = findIgnoreResult.stdout
          .split('\n')
          .map((p) => p.trim())
          .filter(Boolean);

        if (ignorePaths.length > 0) {
          const files = await newSandbox.readFiles(ignorePaths);
          gitignoreContents = files
            .filter((file) => file && !file.error)
            .map((file) =>
              typeof file.content === 'string'
                ? file.content
                : Buffer.from(file.content).toString('utf-8')
            );
        }
      }
    } catch (err: any) {
      addLog.warn('[Sandbox] Failed to read custom .gitignore files', {
        sandboxId,
        error: err.message
      });
    }

    const { customExcludes, pruneClause } = parseGitignoreRules(gitignoreContents);
    const allExcludes = Array.from(new Set(['package.zip', ...customExcludes]));
    const sizeCheckCmd = pruneClause
      ? `cd ${quotedTargetDir} && find . \\( ${pruneClause} \\) -prune -o -type f ! -name 'package.zip' -ls 2>/dev/null | awk '{s+=$7} END {print s+0}'`
      : `cd ${quotedTargetDir} && find . -type f ! -name 'package.zip' -ls 2>/dev/null | awk '{s+=$7} END {print s+0}'`;
    const sizeResult = await newSandbox.execute(sizeCheckCmd);

    if (sizeResult.exitCode === 0 && sizeResult.stdout.trim()) {
      const dirBytes = parseInt(sizeResult.stdout.trim(), 10);
      if (!isNaN(dirBytes) && dirBytes > maxBytes) {
        throw new Error(
          `Skill directory size (${(dirBytes / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size (${maxBytes / 1024 / 1024}MB)`
        );
      }
    }

    const excludeArgs = allExcludes.map((pattern) => `-x ${shellQuote(pattern)}`).join(' ');
    const zipCommand = `cd ${quotedTargetDir} && zip -r package.zip . ${excludeArgs}`;
    const zipResult = await newSandbox.execute(zipCommand);

    if (zipResult.exitCode !== 0) {
      throw new Error(`Failed to package skill directory: ${zipResult.stderr || zipResult.stdout}`);
    }

    const zipFilePath = joinSandboxPath(targetDir, 'package.zip');
    try {
      const files = await newSandbox.readFiles([zipFilePath]);
      const file = files?.[0];

      if (!file) {
        throw new Error('Package file not found in sandbox');
      }
      if (file.error) {
        throw new Error(`Failed to read package file in sandbox: ${file.error.message}`);
      }

      const content = file.content;
      return Buffer.from(content instanceof Uint8Array ? content : Buffer.from(content, 'utf-8'));
    } finally {
      await newSandbox.execute(`rm -f ${shellQuote(zipFilePath)}`).catch((cleanupError) => {
        addLog.warn('[Sandbox] Failed to cleanup package zip', {
          sandboxId,
          zipFilePath,
          error: cleanupError
        });
      });
    }
  } catch (error) {
    addLog.error('[Sandbox] Failed to package skill', {
      sandboxId,
      error
    });
    throw error;
  }
}
