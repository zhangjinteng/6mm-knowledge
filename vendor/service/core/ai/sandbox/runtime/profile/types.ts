import type { SandboxImageConfigType } from '../../../../../../global/core/ai/skill/type';
import type { SandboxCreateSpec } from '@fastgpt-sdk/sandbox-adapter';

export type SandboxRuntimeScenario = 'runtime' | 'session-runtime' | 'edit-debug';

/**
 * WorkGPT 运行态构造 sandbox 的统一入参。
 */
export type SandboxRuntimeCreateConfigInput = {
  scenario?: SandboxRuntimeScenario;
  sessionId?: string;
  image?: SandboxImageConfigType;
  entrypoint?: string | string[];
  env?: Record<string, string>;
  metadata?: Record<string, unknown>;
  createConfig?: SandboxCreateSpec;
  resourceLimits?: SandboxCreateSpec['resourceLimits'];
  volumes?: SandboxCreateSpec['volumes'];
};

/**
 * WorkGPT 本地权限 sandbox 的运行态契约。
 */
export type SandboxRuntimeProfile = {
  defaultImage: SandboxImageConfigType;
  workDirectory: string;
  entrypoint: string;
  skillsRootPath: string;
  resolveWorkDirectory: (sessionId?: string) => string;
  resolveSkillsRootPath: (sessionId?: string) => string;
  buildConfig: (input?: SandboxRuntimeCreateConfigInput) => SandboxCreateSpec | undefined;
};
