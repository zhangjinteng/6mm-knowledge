/** dataset 路由迁移状态，用于区分已原生复刻和待补齐的接口。 */
export type DatasetRouteMigrationStatus = 'migrated' | 'pending';

/**
 * dataset 原版接口到 Fastify 路由的映射定义。
 *
 * `path` 是 Fastify 注册在 `/api/core/dataset` 前缀下的相对路径，
 * `sourcePath` 用于追溯原版 NextJS 接口文件，`status` 用于迁移完整性检查。
 */
export type DatasetRouteDefinition = {
  /** Fastify dataset 模块下的相对接口路径。 */
  path: string;
  /** 原版 NextJS API 路由文件路径，方便对齐行为和 Swagger 描述。 */
  sourcePath: string;
  /** 当前接口迁移状态。 */
  status: DatasetRouteMigrationStatus;
};

/** dataset 旧代理请求结构，保留用于兼容迁移期代码和测试夹具。 */
export type DatasetProxyRequest = {
  /** 上游请求方法。 */
  method: string;
  /** 上游完整请求地址。 */
  url: string;
  /** 透传到上游的请求头。 */
  headers: Record<string, string>;
  /** 透传到上游的请求体，可能是字符串或二进制内容。 */
  body?: string | Uint8Array;
};

/** dataset 旧代理响应结构，保留用于兼容迁移期代码和测试夹具。 */
export type DatasetProxyResponse = {
  /** 上游响应状态码。 */
  statusCode: number;
  /** 上游响应头。 */
  headers: Record<string, string>;
  /** 上游响应体二进制内容。 */
  body: Buffer;
};
