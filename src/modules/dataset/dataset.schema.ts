import { z } from 'zod';

/**
 * NextJS 原版接口的统一成功响应结构。
 *
 * dataset 模块大多数接口会复用原版 `{ code, statusText, message, data }` 包装，
 * Swagger 中只固定外层契约，具体 `data` 结构由各接口的原版业务返回决定。
 */
export const DatasetNextSuccessResponseSchema = z.object({
  code: z.literal(200).describe('固定为 200，表示接口业务处理成功'),
  statusText: z.literal('').describe('成功时保持空字符串，兼容原版 WorkGPT 响应结构'),
  message: z.literal('').describe('成功时保持空字符串，错误信息由异常响应统一返回'),
  data: z.unknown().describe('接口返回的实际业务数据，结构与原版 NextJS 接口保持一致')
}).describe('dataset 模块统一成功响应');

/**
 * dataset 迁移接口的通用请求体描述。
 *
 * 当前 Fastify 侧逐个复刻原版接口行为，部分接口仍接收动态字段、文件或二进制内容，
 * 因此 Swagger 先保留透传对象，避免把尚未稳定的原版入参收窄错。
 */
export const DatasetAnyBodySchema = z
  .object({})
  .passthrough()
  .describe('dataset 接口通用请求体，允许携带原版接口支持的额外字段');

/**
 * dataset 迁移接口的通用查询参数描述。
 *
 * 用于兼容原版 GET/混合方法接口的动态 query 参数，后续某个接口入参稳定后可再拆成专用 Schema。
 */
export const DatasetAnyQuerySchema = z
  .object({})
  .passthrough()
  .describe('dataset 接口通用查询参数，允许携带原版接口支持的额外字段');

/**
 * 路由尚未迁移时返回的诊断响应。
 *
 * 该响应用于开发期发现路由表和原生实现没有对齐；正常已迁移接口不应返回该结构。
 */
export const DatasetRouteNotMigratedResponseSchema = z.object({
  code: z.literal(501).describe('固定为 501，表示该 Fastify 路由尚未完成原生迁移'),
  statusText: z.literal('ROUTE_NOT_MIGRATED').describe('固定错误标识，用于区分未迁移路由'),
  message: z.string().describe('可读错误信息，包含未迁移的 dataset 接口路径'),
  data: z.object({
    sourcePath: z.string().describe('原版 NextJS 接口文件路径'),
    targetPath: z.string().describe('Fastify 中注册的目标接口路径'),
    status: z.string().describe('路由迁移状态')
  })
}).describe('dataset 路由未迁移响应');

/** dataset 通用请求体类型，保持与 `DatasetAnyBodySchema` 的 Swagger 描述一致。 */
export type DatasetAnyBody = z.infer<typeof DatasetAnyBodySchema>;

/** dataset 通用查询参数类型，保持与 `DatasetAnyQuerySchema` 的 Swagger 描述一致。 */
export type DatasetAnyQuery = z.infer<typeof DatasetAnyQuerySchema>;
