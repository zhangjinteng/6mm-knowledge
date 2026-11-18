import { z } from 'zod';

export const AgentSandboxPermissionModeSchema = z.enum(['workspace-write', 'danger-full-access']);
export type AgentSandboxPermissionModeType = z.infer<typeof AgentSandboxPermissionModeSchema>;

export const DEFAULT_AGENT_SANDBOX_PERMISSION_MODE: AgentSandboxPermissionModeType =
  'danger-full-access';

export const AgentSandboxRuntimeSchema = z.object({
  type: z.literal('permission'),
  mode: AgentSandboxPermissionModeSchema.default(DEFAULT_AGENT_SANDBOX_PERMISSION_MODE)
});
export type AgentSandboxRuntimeType = z.infer<typeof AgentSandboxRuntimeSchema>;

export const resolveAgentSandboxRuntime = (
  runtime?: AgentSandboxRuntimeType
): AgentSandboxRuntimeType => ({
  type: 'permission',
  mode: runtime?.mode || DEFAULT_AGENT_SANDBOX_PERMISSION_MODE
});
