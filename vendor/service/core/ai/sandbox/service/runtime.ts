import { generateSandboxId } from '../../../../../global/core/ai/sandbox/constants';
import type { ExecuteResult, ISandbox } from '@fastgpt-sdk/sandbox-adapter';
import type { ResourceLimits, SandboxCreateSpec } from '@fastgpt-sdk/sandbox-adapter';
import { getPermissionSandboxClient } from './permissionRuntime';

export type SandboxToolRuntime = {
  readonly provider: ISandbox;
  ensureAvailable: () => Promise<void>;
  exec: (command: string, timeout?: number) => Promise<ExecuteResult>;
  getSandboxId?: () => string;
  getWorkDirectory?: () => string;
  getSkillsRootPath?: () => string;
  delete?: () => Promise<void>;
  stop?: () => Promise<void>;
};

type UnionIdType = {
  appId: string;
  userId: string;
  chatId: string;
  teamId?: string;
};

const resolveSandboxId = (props: { sandboxId: string } | UnionIdType): string => {
  if ('sandboxId' in props) {
    return props.sandboxId;
  }

  const sandboxUserId = props.chatId === 'edit-debug' ? '' : props.userId;
  return generateSandboxId(props.appId, sandboxUserId, props.chatId);
};

/**
 * 获取 Fastify 本地运行态 sandbox client。
 *
 * Fastify vendor 只内置本地权限 sandbox 能力；这里补齐原 service/runtime 的
 * getSandboxClient 入口，让 `/api/core/ai/sandbox/*` 运行态文件接口能复用同一套
 * app/user/chat 到 workspace 的稳定映射。
 */
export const getSandboxClient = async (
  props:
    | {
        sandboxId: string;
        teamId?: string;
      }
    | UnionIdType,
  opts: {
    resourceLimits?: ResourceLimits;
    createConfig?: SandboxCreateSpec;
  } = {}
) => {
  const sandboxId = resolveSandboxId(props);
  return getPermissionSandboxClient(
    {
      sandboxId
    },
    {
      resourceLimits: opts.resourceLimits,
      createConfig: opts.createConfig
    }
  );
};
