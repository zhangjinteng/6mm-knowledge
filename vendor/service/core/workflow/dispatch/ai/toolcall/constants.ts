import { FlowNodeTypeEnum } from '../../../../../../global/core/workflow/node/constant';
import { getNanoid } from '../../../../../../global/common/string/tools';
import type { ChildResponseItemType } from './type';
import { SANDBOX_SHELL_TOOL_NAME } from '../../../../../../global/core/ai/sandbox/tools/index';

export const getSandboxToolWorkflowResponse = ({
  name,
  logo,
  toolId = SANDBOX_SHELL_TOOL_NAME,
  input,
  response,
  durationSeconds
}: {
  name: string;
  logo: string;
  toolId?: string;
  input: Record<string, any>;
  response: string;
  durationSeconds: number;
}): ChildResponseItemType => {
  return {
    flowResponses: [
      {
        moduleName: name,
        moduleType: FlowNodeTypeEnum.tool,
        moduleLogo: logo,
        toolId,
        toolInput: input,
        toolRes: response,
        totalPoints: 0,
        id: getNanoid(),
        nodeId: getNanoid(),
        runningTime: durationSeconds
      }
    ],
    flowUsages: [],
    runTimes: 0
  };
};
