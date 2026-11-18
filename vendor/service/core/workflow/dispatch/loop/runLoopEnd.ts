import { NodeInputKeyEnum } from '../../../../../global/core/workflow/constants';
import { DispatchNodeResponseKeyEnum } from '../../../../../global/core/workflow/runtime/constants';
import {
  type DispatchNodeResultType,
  type ModuleDispatchProps
} from '../../../../../global/core/workflow/runtime/type';

type Props = ModuleDispatchProps<{
  [NodeInputKeyEnum.nestedEndInput]: any;
}>;
type Response = DispatchNodeResultType<{}>;

export const dispatchLoopEnd = async (props: Props): Promise<Response> => {
  const { params } = props;

  return {
    [DispatchNodeResponseKeyEnum.nodeResponse]: {
      loopOutputValue: params[NodeInputKeyEnum.nestedEndInput]
    }
  };
};
