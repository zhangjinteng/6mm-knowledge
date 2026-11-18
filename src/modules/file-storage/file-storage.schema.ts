import { z } from 'zod';

export const PresignAvatarBodySchema = z
  .object({
    filename: z.string().min(1).describe('头像文件名，原版会基于该名称生成 S3 对象 key'),
    autoExpired: z.boolean().optional().describe('是否自动设置临时过期时间，默认按原版头像上传逻辑处理')
  })
  .describe('头像上传预签名地址请求体')
  .strict();

export const PresignTempFileBodySchema = z
  .object({
    filename: z.string().min(1).describe('临时文件名，原版会基于团队 ID 和文件名生成 S3 对象 key')
  })
  .describe('临时文件上传预签名地址请求体')
  .strict();

export const FileStorageNextSuccessResponseSchema = z.object({
  code: z.literal(200).describe('业务状态码，成功固定为 200'),
  statusText: z.literal('').describe('业务状态文本，成功时为空字符串'),
  message: z.literal('').describe('业务提示信息，成功时为空字符串'),
  data: z.unknown().describe('接口返回数据，结构与原版 NextAPI 响应保持一致')
}).describe('WorkGPT 原版 NextAPI 成功响应结构');

export const FileStorageNextErrorResponseSchema = z.object({
  code: z.number().describe('业务错误码，按原版 jsonRes/processError 规则生成'),
  statusText: z.string().describe('业务错误状态文本，例如 error、fileNotFound、InvalidUploadFileType'),
  message: z.string().describe('错误提示信息，按原版错误处理逻辑返回'),
  data: z.unknown().nullable().describe('错误附加数据，通常为 null'),
  zodError: z.unknown().optional().describe('Zod 错误详情，仅原版错误处理返回该字段时存在')
}).describe('WorkGPT 原版 NextAPI 错误响应结构');

export const FileStorageRouteNotMigratedResponseSchema = z.object({
  code: z.literal(501).describe('HTTP 501 对应的业务错误码'),
  statusText: z.literal('ROUTE_NOT_MIGRATED').describe('接口尚未迁移时的固定状态文本'),
  message: z.string().describe('接口尚未迁移的中文提示信息'),
  data: z.object({
    sourcePath: z.string().describe('原 Next API 源文件路径'),
    targetPath: z.string().describe('Fastify 目标路由路径'),
    status: z.string().describe('迁移状态')
  }).describe('未迁移接口的定位信息')
}).describe('file-storage 路由未迁移响应结构');

export const PresignAvatarSwaggerBodySchema = z
  .unknown()
  .describe('请求体字段：filename 为头像文件名；autoExpired 为可选布尔值，表示是否自动设置头像临时过期时间。为对齐原版行为，Fastify 层不做严格入参拦截。');

export const PresignTempFileSwaggerBodySchema = z
  .unknown()
  .describe('请求体字段：filename 为临时文件名。接口会按团队权限、套餐限制和上传频控生成私有桶上传地址。为对齐原版行为，Fastify 层不做严格入参拦截。');

export const SystemImageParamsSchema = z.object({
  '*': z.string().describe('系统图片路径；Mongo ObjectId 图片会直接读取二进制，否则按头像 S3 key 生成公开访问地址')
}).describe('系统图片通配路径参数');

export const FileDownloadParamsSchema = z.object({
  token: z.string().describe('S3 下载 token，由原版 jwtSignS3DownloadToken 生成')
}).describe('S3 文件代理下载路径参数');

export const FileDownloadWildcardParamsSchema = z.object({
  '*': z.string().describe('S3 下载 token，由原版 jwtSignS3DownloadToken 生成')
}).describe('S3 文件代理下载通配路径参数');

export const FileDownloadQuerySchema = z.object({
  filename: z.string().optional().describe('可选下载文件名；存在时优先用于 Content-Disposition 响应头')
}).describe('S3 文件代理下载查询参数');

export const JwtFileParamsSchema = z.object({
  jwt: z.string().describe('S3 objectKey JWT，由原版 jwtSignS3ObjectKey 生成')
}).describe('旧版文件读取路径参数');

export const JwtFileWildcardParamsSchema = z.object({
  '*': z.string().describe('S3 objectKey JWT，由原版 jwtSignS3ObjectKey 生成')
}).describe('旧版文件读取通配路径参数');

export const CommonFileReadParamsSchema = z.object({
  filename: z.string().describe('对外展示的文件名，用于生成 Content-Disposition 响应头')
}).describe('通用文件读取路径参数');

export const CommonFileReadQuerySchema = z.object({
  token: z.string().optional().describe('文件读取授权 token，由原版 authFileToken 校验')
}).describe('通用文件读取查询参数');

export const FileUploadParamsSchema = z.object({
  token: z.string().describe('S3 上传 token，由原版 jwtSignS3UploadToken 生成')
}).describe('S3 文件代理上传路径参数');

export const FileUploadWildcardParamsSchema = z.object({
  '*': z.string().describe('S3 上传 token，由原版 jwtSignS3UploadToken 生成')
}).describe('S3 文件代理上传通配路径参数');

export const FileUploadBodySchema = z
  .any()
  .describe('文件二进制流请求体。接口会按上传 token 中的大小限制、文件扩展名和 MIME 约束进行校验，并流式写入对象存储。');

export type PresignAvatarBody = z.infer<typeof PresignAvatarBodySchema>;
export type PresignTempFileBody = z.infer<typeof PresignTempFileBodySchema>;
