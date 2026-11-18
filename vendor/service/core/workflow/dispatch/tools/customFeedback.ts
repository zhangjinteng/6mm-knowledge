import { DispatchNodeResponseKeyEnum } from '../../../../../global/core/workflow/runtime/constants';
import type { ModuleDispatchProps } from '../../../../../global/core/workflow/runtime/type';
import type { NodeInputKeyEnum } from '../../../../../global/core/workflow/constants';
import { type DispatchNodeResultType } from '../../../../../global/core/workflow/runtime/type';

type Props = ModuleDispatchProps<{
  [NodeInputKeyEnum.textareaInput]: string;
}>;
type Response = DispatchNodeResultType<{}>;

export const dispatchCustomFeedback = (props: Record<string, any>): Response => {
  const {
    params: { system_textareaInput: feedbackText = '' }
  } = props as Props;

  return {
    [DispatchNodeResponseKeyEnum.nodeResponse]: {
      textOutput: feedbackText
    },
    [DispatchNodeResponseKeyEnum.customFeedbacks]: [feedbackText]
  };
};
