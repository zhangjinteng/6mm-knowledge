import type { FastifyReply, FastifyRequest } from 'fastify';

import { DatasetRoutePrefix } from '@/modules/dataset/dataset.route-map.js';
import { DatasetService } from '@/modules/dataset/dataset.service.js';

/** 按原版 NextJS API 契约包装 dataset 接口成功响应。 */
function nextOk<T>(data: T) {
  return {
    code: 200 as const,
    statusText: '' as const,
    message: '' as const,
    data
  };
}

/** dataset 文件下载接口的内部返回结构，Controller 会把它转成真实下载响应。 */
type DatasetDownloadResponse = {
  filename: string;
  contentType: string;
  content: string | Buffer;
};

/**
 * 判断 Service 返回值是否为文件下载响应。
 *
 * dataset 导出类接口不能使用统一 JSON 包装，否则前端下载文件会拿到错误内容；
 * 因此这里在 Controller 边界识别下载结构，并直接写出文件响应头和内容。
 */
function isDatasetDownloadResponse(data: unknown): data is DatasetDownloadResponse {
  return (
    !!data &&
    typeof data === 'object' &&
    typeof (data as DatasetDownloadResponse).filename === 'string' &&
    typeof (data as DatasetDownloadResponse).contentType === 'string' &&
    ('content' in data) &&
    (typeof (data as DatasetDownloadResponse).content === 'string' ||
      Buffer.isBuffer((data as DatasetDownloadResponse).content))
  );
}

/** dataset 模块接口控制器，负责把 Fastify 请求分发到原生 Service 并保持原版响应契约。 */
export class DatasetController {
  constructor(private readonly service = new DatasetService()) {}

  /**
   * 返回未迁移路由的开发期诊断错误。
   *
   * 当路由表登记了接口但 Service 尚未实现时，使用该响应暴露原版文件路径和目标路径，
   * 避免请求被误代理或静默返回不完整结果。
   */
  async notMigrated(request: FastifyRequest) {
    const rawPath = (request.routeOptions.url ?? request.url).split('?')[0];
    const routePath = rawPath.startsWith(DatasetRoutePrefix)
      ? rawPath.slice(DatasetRoutePrefix.length) || '/'
      : rawPath;

    throw this.service.getRouteNotMigratedError(routePath);
  }

  /**
   * 处理已经迁移到 Fastify 的 dataset 原生接口。
   *
   * 普通接口返回与原版一致的统一 JSON 包装；导出接口会直接返回下载文件，
   * 以保持浏览器和前端调用方对 `Content-Type`、`Content-Disposition` 的预期。
   */
  async handleNativeDatasetRoute(request: FastifyRequest, reply: FastifyReply) {
    const data = await this.service.handleNativeDatasetRoute(request);

    if (isDatasetDownloadResponse(data)) {
      return reply
        .header('Content-Type', data.contentType)
        .header('Content-Disposition', `attachment; filename=${data.filename};`)
        .send(data.content);
    }

    return nextOk(data);
  }
}
