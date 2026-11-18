import { buildLocalRuntimeProfile } from './local';
import type { SandboxRuntimeProfile } from './types';

export type {
  SandboxRuntimeCreateConfigInput,
  SandboxRuntimeProfile,
  SandboxRuntimeScenario
} from './types';
export { buildBaseSandboxRuntimeEnv } from './utils';

/**
 * 获取 fastify 权限沙箱的本地运行态契约。
 */
export function getSandboxRuntimeProfile(): SandboxRuntimeProfile {
  return buildLocalRuntimeProfile();
}
