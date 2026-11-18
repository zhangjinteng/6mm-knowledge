import { createHash } from 'node:crypto';
import path from 'node:path';

const DEFAULT_LOCAL_SANDBOX_ID = 'default';

/**
 * 将 sandboxId 映射成本机权限沙箱的稳定目录。
 *
 * sandboxId 可能来自业务 ID 拼接，不能直接当路径片段使用；保留可读前缀并追加 hash，
 * 既避免路径穿越，也降低不同原始 ID 清洗后重名的概率。
 */
export function getLocalSandboxDirectory(rootDir: string, sandboxId?: string) {
  const rawSandboxId = (sandboxId || DEFAULT_LOCAL_SANDBOX_ID).trim() || DEFAULT_LOCAL_SANDBOX_ID;
  const safePrefix = rawSandboxId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'sandbox';
  const stableSuffix = createHash('sha256').update(rawSandboxId).digest('hex').slice(0, 12);

  return path.join(path.resolve(rootDir), `${safePrefix}-${stableSuffix}`);
}
