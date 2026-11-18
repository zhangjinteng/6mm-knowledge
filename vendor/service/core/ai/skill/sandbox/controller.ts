import type { SandboxInstanceSchemaType } from '../../../../../global/core/ai/skill/type';
import {
  deleteSandboxInstanceRecord,
  findSandboxInstanceBySandboxIdAndTeam,
  findSandboxResourceBySandboxIdAndTeam,
  findSkillRelatedSandboxResources
} from '../../sandbox/instance/repository';
import { getPermissionSandboxClient } from '../../sandbox/service/permissionRuntime';
import { getLogger, LogCategories } from '../../../../common/logger';

export {
  createEditDebugSandbox,
  packageSkillInSandbox,
  type CreateEditDebugSandboxParams,
  type CreateEditDebugSandboxResult
} from '../edit/sandbox';

const addLog = getLogger(LogCategories.MODULE.AI.AGENT);

export type GetSandboxInfoParams = {
  sandboxId: string;
  teamId: string;
};

export type DeleteSandboxParams = {
  sandboxId: string;
  teamId: string;
};

export async function getSandboxInfo(
  params: GetSandboxInfoParams
): Promise<SandboxInstanceSchemaType> {
  const { sandboxId, teamId } = params;

  const sandbox = await findSandboxInstanceBySandboxIdAndTeam({
    sandboxId,
    teamId
  });

  if (!sandbox) {
    throw new Error('Sandbox not found or access denied');
  }

  return sandbox as unknown as SandboxInstanceSchemaType;
}

/**
 * Delete sandbox
 */
export async function deleteSandbox(params: DeleteSandboxParams): Promise<void> {
  const { sandboxId, teamId } = params;

  const instanceDoc = await findSandboxResourceBySandboxIdAndTeam({
    sandboxId,
    teamId
  });

  if (!instanceDoc) {
    throw new Error('Sandbox not found or access denied');
  }

  addLog.info('[Sandbox] Deleting sandbox', { sandboxId });

  await getPermissionSandboxClient({ sandboxId: instanceDoc.sandboxId }, {})
    .then((client) => client.delete?.())
    .catch((error) => {
      addLog.warn('[Sandbox] Failed to delete local permission sandbox directory', {
        sandboxId,
        error
      });
    });
  await deleteSandboxInstanceRecord(instanceDoc._id);
}

/**
 * Force delete all sandbox instances related to the given skill IDs.
 * Called when a skill is deleted to clean up local permission sandbox resources.
 */
export async function deleteSkillRelatedSandboxes(skillIds: string[]): Promise<void> {
  if (skillIds.length === 0) return;

  const instances = await findSkillRelatedSandboxResources(skillIds);

  if (instances.length === 0) return;

  addLog.info('[Sandbox] Force deleting skill-related sandboxes', {
    skillIds,
    count: instances.length
  });

  await Promise.allSettled(
    instances.map(async (doc) => {
      await getPermissionSandboxClient({ sandboxId: doc.sandboxId }, {})
        .then((client) => client.delete?.())
        .catch((error) => {
          addLog.warn('[Sandbox] Failed to delete local permission sandbox directory', {
            sandboxId: doc.sandboxId,
            error
          });
        });
      await deleteSandboxInstanceRecord(doc._id);
    })
  );
}
