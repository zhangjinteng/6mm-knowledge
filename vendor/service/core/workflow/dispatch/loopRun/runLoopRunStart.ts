import { NodeInputKeyEnum, NodeOutputKeyEnum } from '../../../../../global/core/workflow/constants';
import { DispatchNodeResponseKeyEnum } from '../../../../../global/core/workflow/runtime/constants';
import {
  type DispatchNodeResultType,
  type ModuleDispatchProps
} from '../../../../../global/core/workflow/runtime/type';
import { LoopRunModeEnum } from '../../../../../global/core/workflow/template/system/loopRun/loopRun';

type Props = ModuleDispatchProps<{
  [NodeInputKeyEnum.loopRunMode]: LoopRunModeEnum;
  [NodeInputKeyEnum.nestedStartInput]: any;
  [NodeInputKeyEnum.nestedStartIndex]: number;
}>;

type Response = DispatchNodeResultType<{
  [NodeOutputKeyEnum.currentIndex]?: number;
  [NodeOutputKeyEnum.currentItem]?: any;
  [NodeOutputKeyEnum.currentIteration]?: number;
}>;

export const dispatchLoopRunStart = async (props: Props): Promise<Response> => {
  const { params } = props;
  const mode = params[NodeInputKeyEnum.loopRunMode];
  const rawIndex = params[NodeInputKeyEnum.nestedStartIndex];
  const item = params[NodeInputKeyEnum.nestedStartInput];

  const data: Record<string, any> = {};
  if (mode === LoopRunModeEnum.array) {
    data[NodeOutputKeyEnum.currentIndex] = rawIndex;
    data[NodeOutputKeyEnum.currentItem] = item;
  } else {
    data[NodeOutputKeyEnum.currentIteration] = rawIndex;
  }

  return {
    data,
    [DispatchNodeResponseKeyEnum.nodeResponse]: {
      loopInputValue: mode === LoopRunModeEnum.array ? item : rawIndex
    }
  };
};
