import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';

import { FileStorageController } from '@/modules/file-storage/file-storage.controller.js';
import {
  CommonFileReadParamsSchema,
  CommonFileReadQuerySchema,
  FileDownloadQuerySchema,
  FileDownloadWildcardParamsSchema,
  FileStorageNextErrorResponseSchema,
  FileStorageNextSuccessResponseSchema,
  FileUploadBodySchema,
  FileUploadWildcardParamsSchema,
  JwtFileWildcardParamsSchema,
  PresignAvatarSwaggerBodySchema,
  PresignTempFileSwaggerBodySchema,
  SystemImageParamsSchema
} from '@/modules/file-storage/file-storage.schema.js';

const fileStorageRoutes: FastifyPluginAsync = async (app) => {
  const controller = new FileStorageController();
  const route = app.withTypeProvider<ZodTypeProvider>();

  app.addContentTypeParser(
    ['application/octet-stream', 'multipart/form-data', 'image/png', 'image/jpeg', 'image/webp'],
    (_request, payload, done) => {
      done(null, payload);
    }
  );

  route.post(
    '/api/common/file/presignAvatarPostUrl',
    {
      schema: {
        summary: '生成头像上传地址',
        description:
          '为当前登录团队生成头像文件上传预签名地址。接口会复用原版 token 鉴权和头像 S3 source 逻辑，成功响应结构与原版 NextAPI 保持一致。',
        tags: ['file-storage'],
        body: PresignAvatarSwaggerBodySchema,
        response: {
          200: FileStorageNextSuccessResponseSchema,
          400: FileStorageNextErrorResponseSchema,
          403: FileStorageNextErrorResponseSchema,
          500: FileStorageNextErrorResponseSchema
        }
      }
    },
    controller.presignAvatarPostUrl.bind(controller)
  );

  route.post(
    '/api/common/file/presignTempFilePostUrl',
    {
      schema: {
        summary: '生成临时文件上传地址',
        description:
          '为当前团队生成临时文件上传预签名地址。接口会校验团队数据集创建权限、套餐上传限制和 30 秒上传频控，并复用原版私有桶上传 URL 生成逻辑。',
        tags: ['file-storage'],
        body: PresignTempFileSwaggerBodySchema,
        response: {
          200: FileStorageNextSuccessResponseSchema,
          400: FileStorageNextErrorResponseSchema,
          403: FileStorageNextErrorResponseSchema,
          429: FileStorageNextErrorResponseSchema,
          500: FileStorageNextErrorResponseSchema
        }
      }
    },
    controller.presignTempFilePostUrl.bind(controller)
  );

  route.get(
    '/api/system/img/*',
    {
      schema: {
        summary: '读取系统图片',
        description:
          '读取系统图片资源。路径去掉扩展名后如果是 Mongo ObjectId，则直接返回 Mongo 中的图片二进制；否则按头像 S3 key 生成公开访问地址并返回 301 重定向。',
        tags: ['file-storage'],
        params: SystemImageParamsSchema,
        response: {
          500: FileStorageNextErrorResponseSchema
        }
      }
    },
    controller.readSystemImage.bind(controller)
  );

  route.route({
    method: ['GET', 'HEAD'],
    url: '/api/system/file/download/*',
    schema: {
      summary: '代理下载 S3 文件',
      description:
        '通过下载 token 代理读取 S3 文件。接口会校验下载 token、读取 bucket 文件流和 metadata，并按原版逻辑设置 Content-Type、Content-Length、Content-Disposition 与 Cache-Control。HEAD 请求只返回响应头。',
      tags: ['file-storage'],
      params: FileDownloadWildcardParamsSchema,
      querystring: FileDownloadQuerySchema,
      response: {
        404: FileStorageNextErrorResponseSchema,
        500: FileStorageNextErrorResponseSchema
      }
    },
    handler: controller.downloadFile.bind(controller)
  });

  route.get(
    '/api/system/file/*',
    {
      schema: {
        summary: '读取旧版 JWT 文件',
        description:
          '通过 objectKey JWT 读取 dataset 或 chat 业务域下的 S3 文件。接口会校验 JWT 和 objectKey 来源，并按原版逻辑返回文件流与下载响应头。',
        tags: ['file-storage'],
        params: JwtFileWildcardParamsSchema,
        response: {
          404: FileStorageNextErrorResponseSchema,
          500: FileStorageNextErrorResponseSchema
        }
      }
    },
    controller.readJwtFile.bind(controller)
  );

  route.get(
    '/api/common/file/read/:filename',
    {
      schema: {
        summary: '读取通用文件',
        description:
          '通过文件读取 token 读取 dataset 文件，用于文件预览或下载。接口会校验 file token、限制 fileId 必须属于 dataset S3 key，并根据文件扩展名决定 inline 或 attachment。',
        tags: ['file-storage'],
        params: CommonFileReadParamsSchema,
        querystring: CommonFileReadQuerySchema,
        response: {
          500: FileStorageNextErrorResponseSchema
        }
      }
    },
    controller.readCommonFile.bind(controller)
  );

  await app.register(async (uploads) => {
    // Signed uploads must preserve bytes, including text/JSON/Office content types.
    uploads.removeAllContentTypeParsers();
    uploads.addContentTypeParser('*', (_request, payload, done) => done(null, payload));
    uploads.withTypeProvider<ZodTypeProvider>().put(
    '/api/system/file/upload/*',
    {
      schema: {
        summary: '代理上传 S3 文件',
        description:
          '通过上传 token 接收文件二进制流并写入 S3。接口会按原版逻辑校验上传 token、最大文件大小、允许扩展名和 MIME 类型，并把校验后的文件流上传到 token 指定的 bucket。',
        tags: ['file-storage'],
        params: FileUploadWildcardParamsSchema,
        body: FileUploadBodySchema,
        response: {
          200: FileStorageNextSuccessResponseSchema,
          400: FileStorageNextErrorResponseSchema,
          413: FileStorageNextErrorResponseSchema,
          500: FileStorageNextErrorResponseSchema
        }
      }
    },
    controller.uploadFile.bind(controller)
  );
  });

};

export default fileStorageRoutes;
