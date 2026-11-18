import { PerResourceTypeEnum } from '../../../../global/support/permission/constant';
import { getGroupsByTmbId } from '../memberGroup/controllers';
import { getOrgsByTmbId } from '../org/controllers';
import { MongoResourcePermission } from '../schema';
import { getCollaboratorId } from '../../../../global/support/permission/utils';
import { isProVersion } from '../../../common/system/constants';

export const getMyModels = async ({
  teamId,
  tmbId,
  isTeamOwner
}: {
  teamId: string;
  tmbId: string;
  isTeamOwner: boolean;
}) => {
  const systemModelList = global.systemModelList ?? [];

  if (isTeamOwner || !isProVersion()) {
    return systemModelList.map((m) => m.model);
  }
  const [groups, orgs] = await Promise.all([
    getGroupsByTmbId({
      teamId,
      tmbId
    }),
    getOrgsByTmbId({
      teamId,
      tmbId
    })
  ]);

  const myIdSet = new Set([tmbId, ...groups.map((g) => g._id), ...orgs.map((o) => o._id)]);

  const rps = await MongoResourcePermission.find({
    teamId,
    resourceType: PerResourceTypeEnum.model
  }).lean();

  // 未配置权限的，默认是有权限
  const permissionConfiguredModelSet = new Set(rps.map((rp) => rp.resourceName));
  const unconfiguredModels = systemModelList.filter(
    (model) => !permissionConfiguredModelSet.has(model.model)
  );

  const myModels = rps.filter((rp) => myIdSet.has(getCollaboratorId(rp)));

  return [...unconfiguredModels.map((m) => m.model), ...myModels.map((m) => m.resourceName)];
};
