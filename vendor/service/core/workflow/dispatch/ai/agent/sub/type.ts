import type { StoreSecretValueType } from '../../../../../../../global/common/secret/type';
import type { ChatCompletionTool } from '../../../../../../../global/core/ai/llm/type';
import type { SystemToolSecretInputTypeEnum } from '../../../../../../../global/core/app/tool/systemTool/constants';
import type { NodeInputKeyEnum } from '../../../../../../../global/core/workflow/constants';
import type { RuntimeNodeItemType } from '../../../../../../../global/core/workflow/runtime/type';
import type { SubAppRuntimeType } from '../type';

export type SubAppInitType = {
  type: SubAppRuntimeType['type'];
  id: string;
  name: string;
  avatar?: string;
  version?: string;
  toolConfig?: RuntimeNodeItemType['toolConfig'];
  requestSchema: ChatCompletionTool;
  params: {
    [NodeInputKeyEnum.systemInputConfig]?: {
      type: SystemToolSecretInputTypeEnum;
      value: StoreSecretValueType;
    };
    [key: string]: any;
  };
};
