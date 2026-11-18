import { TeamErrEnum } from "../../../../../vendor/global/common/error/code/team";
import { checkTeamAIPoints } from "../../../../../vendor/service/support/permission/teamLimit";
import { sendOneInform } from "../../../support/user/inform/api.ts";
import { lockTrainingDataByTeamId } from "../../../../../vendor/service/core/dataset/training/controller";
import { InformLevelEnum } from "../../../../../vendor/global/support/user/inform/constants";
import { getLogger, LogCategories } from "../../../../../vendor/service/common/logger";
const logger = getLogger(LogCategories.MODULE.DATASET.QUEUES);

export const checkTeamAiPointsAndLock = async (teamId: string) => {
  try {
    await checkTeamAIPoints(teamId);
    return true;
  } catch (error: any) {
    if (error === TeamErrEnum.aiPointsNotEnough) {
      // send inform and lock data
      try {
        sendOneInform({
          level: InformLevelEnum.emergency,
          templateCode: 'LACK_OF_POINTS',
          templateParam: {},
          teamId
        });
        logger.info('余额不足，暂停知识库处理');
        await lockTrainingDataByTeamId(teamId);
      } catch (error) {}
    }
    return false;
  }
};
