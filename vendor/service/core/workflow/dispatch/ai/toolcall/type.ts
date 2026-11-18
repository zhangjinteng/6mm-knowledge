import type { ChatCompletionMessageParam } from '../../../../../../global/core/ai/llm/type';
import type { NodeInputKeyEnum } from '../../../../../../global/core/workflow/constants';
import type { ModuleDispatchProps } from '../../../../../../global/core/workflow/runtime/type';
import type { RuntimeNodeItemType } from '../../../../../../global/core/workflow/runtime/type';
import type { DispatchFlowResponse } from '../../type';
import type { ChatItemMiniType } from '../../../../../../global/core/chat/type';
import type { WorkflowInteractiveResponseType } from '../../../../../../global/core/workflow/template/system/interactive/type';
import type { LLMModelItemType } from '../../../../../../global/core/ai/model.schema';
import type { JSONSchemaInputType } from '../../../../../../global/core/app/jsonschema';
import type { ReasoningEffort } from '../../../../../../global/core/ai/llm/type';
import type { AgentLoopChildrenInteractiveParams } from '../../../../ai/llm/agentLoop';

export type DispatchToolModuleProps = ModuleDispatchProps<{
  [NodeInputKeyEnum.history]?: ChatItemMiniType[];
  [NodeInputKeyEnum.userChatInput]: string;

  [NodeInputKeyEnum.fileUrlList]?: string[];
  [NodeInputKeyEnum.aiModel]: string;
  [NodeInputKeyEnum.aiSystemPrompt]: string;
  [NodeInputKeyEnum.aiChatTemperature]: number;
  [NodeInputKeyEnum.aiChatMaxToken]: number;
  [NodeInputKeyEnum.aiChatIsResponseText]?: boolean;
  [NodeInputKeyEnum.aiChatVision]?: boolean;
  [NodeInputKeyEnum.aiChatAudio]?: boolean;
  [NodeInputKeyEnum.aiChatVideo]?: boolean;
  [NodeInputKeyEnum.aiChatExtractFiles]?: boolean;
  [NodeInputKeyEnum.aiChatReasoning]?: boolean;
  [NodeInputKeyEnum.aiChatReasoningEffort]?: ReasoningEffort;
  [NodeInputKeyEnum.aiChatTopP]?: number;
  [NodeInputKeyEnum.aiChatStopSign]?: string;
  [NodeInputKeyEnum.aiChatResponseFormat]?: string;
  [NodeInputKeyEnum.aiChatJsonSchema]?: string;
  [NodeInputKeyEnum.useAgentSandbox]?: boolean;
}> & {
  messages: ChatCompletionMessageParam[];
  toolNodes: ToolNodeItemType[];
  toolModel: LLMModelItemType;
  childrenInteractiveParams?: AgentLoopChildrenInteractiveParams<WorkflowInteractiveResponseType>;
  allFiles: Map<string, FileInputType>;
  currentInputFiles: FileInputType[];
  fileUrls?: string[];
};

export type ToolNodeItemType = {
  nodeId: RuntimeNodeItemType['nodeId'];
  name: RuntimeNodeItemType['name'];
  avatar?: RuntimeNodeItemType['avatar'];
  intro?: RuntimeNodeItemType['intro'];
  toolDescription?: RuntimeNodeItemType['toolDescription'];
  flowNodeType: RuntimeNodeItemType['flowNodeType'];

  jsonSchema?: JSONSchemaInputType;
  toolParams: RuntimeNodeItemType['inputs'];
};

export type ChildResponseItemType = {
  flowResponses: DispatchFlowResponse['flowResponses'];
  runTimes: DispatchFlowResponse['runTimes'];
  flowUsages: DispatchFlowResponse['flowUsages'];
};

export type FileInputType = {
  id: string;
  name: string;
  url: string;
  sandboxPath?: string;
};
