import path from 'node:path';
import { serviceEnv } from '../../../../../env';
import type { SandboxRuntimeProfile } from './types';
import { getSandboxSkillsRootPath, mergeStringRecord, mergeUnknownRecord } from './utils';
import { getLocalSandboxDirectory } from '../../localPath';

/**
 * 构建本机权限沙箱的运行态 profile。
 *
 * 每个 sandboxId 映射到宿主机上的独立工作目录，用于避免多个编辑态或会话态 workspace
 * 互相覆盖。
 */
export function buildLocalRuntimeProfile(): SandboxRuntimeProfile {
  const rootDirectory = path.resolve(serviceEnv.AGENT_SANDBOX_LOCAL_ROOT);
  const resolveWorkDirectory = (sessionId?: string) =>
    path.join(getLocalSandboxDirectory(rootDirectory, sessionId), 'workspace');
  const workDirectory = resolveWorkDirectory();

  return {
    defaultImage: {
      repository: 'local'
    },
    workDirectory,
    entrypoint: '',
    skillsRootPath: getSandboxSkillsRootPath(workDirectory),
    resolveWorkDirectory,
    resolveSkillsRootPath: (sessionId?: string) =>
      getSandboxSkillsRootPath(resolveWorkDirectory(sessionId)),
    buildConfig(input = {}) {
      const createConfig = input.createConfig ?? {};
      const env = mergeStringRecord(createConfig.env, input.env);
      const metadata = mergeUnknownRecord(createConfig.metadata, input.metadata);
      const workingDir = createConfig.workingDir ?? resolveWorkDirectory(input.sessionId);
      const resourceLimits = input.resourceLimits ?? createConfig.resourceLimits;

      return {
        ...createConfig,
        image: createConfig.image ?? input.image ?? { repository: 'local' },
        ...(resourceLimits ? { resourceLimits } : {}),
        ...(env ? { env } : {}),
        ...(metadata ? { metadata } : {}),
        workingDir
      };
    }
  };
}
