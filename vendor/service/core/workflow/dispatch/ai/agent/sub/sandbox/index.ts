import { FlowNodeTypeEnum } from '../../../../../../../../global/core/workflow/node/constant';
import { SANDBOX_ICON, SANDBOX_NAME } from '../../../../../../../../global/core/ai/sandbox/tools/index';
import { parseI18nString } from '../../../../../../../../global/common/i18n/utils';
import type { localeType } from '../../../../../../../../global/common/i18n/type';
import { runSandboxTools } from '../../../../../../ai/sandbox/toolCall';
import type { DispatchSubAppResponse } from '../../type';
import type { SandboxToolRuntime } from '../../../../../../ai/sandbox/service/runtime';
import type { AgentSandboxRuntimeType } from '../../../../../../../../global/core/ai/sandbox/permission';

export const dispatchSandboxTool = async ({
  toolName,
  rawArgs,
  appId,
  userId,
  chatId,
  lang,
  sandboxClient,
  agentSandboxRuntime
}: {
  toolName: string;
  rawArgs: string;
  appId: string;
  userId: string;
  chatId: string;
  lang?: localeType;
  sandboxClient?: SandboxToolRuntime;
  agentSandboxRuntime?: AgentSandboxRuntimeType;
}): Promise<DispatchSubAppResponse> => {
  const { input, response } = await runSandboxTools({
    toolName,
    args: rawArgs,
    appId,
    userId,
    chatId,
    sandboxClient,
    ...(agentSandboxRuntime ? { agentSandboxRuntime } : {})
  });

  return {
    response,
    nodeResponse: {
      moduleType: FlowNodeTypeEnum.tool,
      moduleName: parseI18nString(SANDBOX_NAME, lang),
      moduleLogo: SANDBOX_ICON,
      toolId: toolName,
      toolInput: input,
      toolRes: response
    }
  };
};

export { useSandbox } from './useSandbox';
