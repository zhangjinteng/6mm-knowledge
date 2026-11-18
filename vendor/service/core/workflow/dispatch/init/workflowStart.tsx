import { chatValue2RuntimePrompt } from '../../../../../global/core/chat/adapt';
import { NodeInputKeyEnum, NodeOutputKeyEnum } from '../../../../../global/core/workflow/constants';
import { DispatchNodeResponseKeyEnum } from '../../../../../global/core/workflow/runtime/constants';
import type {
  DispatchNodeResultType,
  ModuleDispatchProps
} from '../../../../../global/core/workflow/runtime/type';

export type UserChatInputProps = ModuleDispatchProps<{
  [NodeInputKeyEnum.userChatInput]: string;
}>;
type Response = DispatchNodeResultType<{
  [NodeOutputKeyEnum.userChatInput]: string;
  [NodeOutputKeyEnum.userFiles]: string[];
}>;

export const dispatchWorkflowStart = async (props: Record<string, any>): Promise<Response> => {
  const {
    query,
    variableState,
    params: { userChatInput }
  } = props as UserChatInputProps;

  const { text, files } = chatValue2RuntimePrompt(query);

  const queryFiles = files
    .map((item) => {
      return item?.url ?? '';
    })
    .filter(Boolean);
  const fileUrlList = variableState.get('fileUrlList');
  const variablesFiles: string[] = Array.isArray(fileUrlList) ? fileUrlList : [];

  return {
    [DispatchNodeResponseKeyEnum.nodeResponse]: {},
    data: {
      [NodeInputKeyEnum.userChatInput]: text || userChatInput,
      [NodeOutputKeyEnum.userFiles]: [...queryFiles, ...variablesFiles]
    }
  };
};
