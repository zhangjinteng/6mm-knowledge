import { batchRun } from '../../../../../global/common/system/utils';
import { getLogger, LogCategories } from '../../../../common/logger';
import {
  deleteSandboxResourceRecord,
  findSandboxResourcesByAppId,
  findSandboxResourcesByChatIds,
  markSandboxResourceStopped,
  type SandboxResourceRef
} from '../instance/repository';
import { getPermissionSandboxClient } from './permissionRuntime';

const logger = getLogger(LogCategories.MODULE.AI.SANDBOX);

/**
 * 停止一条已存在的权限 sandbox 资源记录。
 */
export async function stopSandboxResource(resource: SandboxResourceRef): Promise<void> {
  const sandbox = await getPermissionSandboxClient({ sandboxId: resource.sandboxId }, {});
  await sandbox.stop?.();
  await markSandboxResourceStopped(resource);
}

/**
 * 删除一条已存在的权限 sandbox 资源记录。
 */
export async function deleteSandboxResource(resource: SandboxResourceRef): Promise<void> {
  const sandbox = await getPermissionSandboxClient({ sandboxId: resource.sandboxId }, {});
  await sandbox.delete?.();
  await deleteSandboxResourceRecord(resource);
}

/**
 * 删除某个 app 下指定 chat 会话关联的 sandbox 资源。
 *
 * 这里用于聊天记录删除等批量清理场景；单个资源清理失败会记录日志并继续处理剩余资源。
 */
export const deleteSandboxesByChatIds = async ({
  appId,
  chatIds
}: {
  appId: string;
  chatIds: string[];
}) => {
  const instances = await findSandboxResourcesByChatIds({ appId, chatIds });
  if (!instances.length) return;

  await Promise.allSettled(
    instances.map(async (doc) => {
      await deleteSandboxResource(doc).catch((err) => {
        logger.error('Failed to delete sandbox', { sandboxId: doc.sandboxId, error: err });
        return Promise.reject(err);
      });
    })
  );
};

/**
 * 删除某个 app 下的全部 sandbox 资源。
 *
 * app 删除流程可能遇到多个 chat 或 edit-debug 资源，因此统一从实例记录查询后逐条清理。
 */
export const deleteSandboxesByAppId = async (appId: string) => {
  const instances = await findSandboxResourcesByAppId(appId);
  if (!instances.length) return;

  await Promise.allSettled(
    instances.map(async (doc) => {
      await deleteSandboxResource(doc).catch((err) => {
        logger.error('Failed to delete sandbox', { sandboxId: doc.sandboxId, error: err });
      });
    })
  );
};

/**
 * 批量暂停已存在的 sandbox 资源。
 */
export async function stopSandboxResources(resources: SandboxResourceRef[]): Promise<void> {
  await batchRun(resources, async (resource) => {
    await stopSandboxResource(resource).catch((err) => {
      logger.error('Failed to stop sandbox', { sandboxId: resource.sandboxId, error: err });
    });
  });
}
