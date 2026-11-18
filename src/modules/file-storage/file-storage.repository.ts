import { fileStorageRouteDefinitions } from '@/modules/file-storage/file-storage.route-map.js';
import type { PresignAvatarBody, PresignTempFileBody } from '@/modules/file-storage/file-storage.schema.js';
import type {
  FileStorageAuthCertResult,
  FileStorageAuthUserResult,
  FileStorageRouteDefinition
} from '@/modules/file-storage/file-storage.types.js';
import type { FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import {
  fastGptGlobalVendorModule,
  fastGptServiceVendorModule
} from '@/common/vendor/fastgpt-vendor.js';

const importVendorModule = <T>(specifier: string) => import(specifier) as Promise<T>;
const importServiceVendorModule = <T>(path: string) =>
  importVendorModule<T>(fastGptServiceVendorModule(path));
const importGlobalVendorModule = <T>(path: string) =>
  importVendorModule<T>(fastGptGlobalVendorModule(path));

type AuthCommonModule = {
  authCert: (props: {
    req: Pick<FastifyRequest, 'headers'>;
    authToken: true;
  }) => Promise<FileStorageAuthCertResult>;
};

type UserAuthModule = {
  authUserPer: (props: {
    req: Pick<FastifyRequest, 'headers'>;
    authToken: true;
    authApiKey: true;
    per: number;
  }) => Promise<FileStorageAuthUserResult>;
};

type TeamPermissionConstantModule = {
  TeamDatasetCreatePermissionVal: number;
};

type AvatarSourceModule = {
  getS3AvatarSource: () => {
    createUploadAvatarURL: (props: {
      teamId: string;
      filename: string;
      autoExpired?: boolean;
    }) => Promise<unknown>;
  };
};

type PlanStatusModule = {
  getTeamPlanStatus: (props: { teamId: string }) => Promise<{
    standard?: {
      maxUploadFileCount?: number;
      maxUploadFileSize?: number;
    };
  }>;
};

type FrequencyLimitModule = {
  authFrequencyLimit: (props: {
    eventId: string;
    maxAmount: number;
    expiredTime: Date;
  }) => Promise<unknown>;
};

type S3UtilsModule = {
  getFileS3Key: {
    temp: (props: { teamId: string; filename: string }) => { fileKey: string };
  };
};

type PrivateBucketModule = {
  S3PrivateBucket: new () => {
    createPresignedPutUrl: (
      file: { rawKey: string; filename: string },
      options: { expiredHours: number; maxFileSize: number }
    ) => Promise<unknown>;
  };
};

type MongoImageModule = {
  readMongoImg: (props: { id: string }) => Promise<{ binary: Buffer; mime: string }>;
};

type MongoTypesModule = {
  Types: {
    ObjectId: {
      isValid: (value: string) => boolean;
    };
  };
};

type AvatarPublicSourceModule = {
  getS3AvatarSource: () => {
    createPublicUrl: (key: string) => string;
  };
};

type DownloadTokenModule = {
  jwtVerifyS3DownloadToken: (token: string) => Promise<{
    objectKey: string;
    bucketName: string;
  }>;
};

type ObjectKeyTokenModule = {
  jwtVerifyS3ObjectKey: (jwt: string) => Promise<{
    objectKey: string;
  }>;
  isS3ObjectKey: (key: string, type: 'dataset' | 'chat') => boolean;
};

type S3SourceModule = {
  getS3DatasetSource: () => {
    getFileStream: (key: string) => Promise<Readable | undefined>;
    getFileMetadata: (key: string) => Promise<{
      filename?: string;
      extension?: string;
      contentType?: string;
      contentLength?: number;
    } | null>;
  };
};

type S3ChatSourceModule = {
  getS3ChatSource: () => {
    getFileStream: (key: string) => Promise<Readable | undefined>;
    getFileMetadata: (key: string) => Promise<{
      filename?: string;
      extension?: string;
      contentType?: string;
      contentLength?: number;
    } | null>;
  };
};

type MimeModule = {
  ensureTextContentTypeCharset: (props: {
    contentType: string;
    filename?: string;
  }) => string;
};

type FileToolsModule = {
  getContentDisposition: (props: { filename: string; type: 'inline' | 'attachment' }) => string;
};

type FileAuthModule = {
  authFileToken: (token?: string) => Promise<{ fileId?: string }>;
};

type GridFsUtilsModule = {
  stream2Encoding: (stream: Readable) => Promise<{
    stream: Readable;
    encoding: string;
  }>;
};

type UploadTokenModule = {
  jwtVerifyS3UploadToken: (token: string) => Promise<{
    objectKey: string;
    bucketName: string;
    maxSize: number;
    uploadConstraints: unknown;
    metadata?: Record<string, string>;
  }>;
};

type UploadValidationModule = {
  getUploadInspectBytes: (filename?: string) => number;
  validateUploadFile: (props: {
    buffer: Buffer;
    filename?: string;
    uploadConstraints: unknown;
  }) => Promise<{
    contentType: string;
    filename?: string;
  }>;
};

type CommonErrorCodeModule = {
  CommonErrEnum: {
    fileNotFound: string;
  };
};

type FastGptErrorCodeModule = {
  ERROR_RESPONSE: Record<string, {
    code: number;
    statusText: string;
    message: string;
    data?: unknown;
    httpStatus?: number;
  } | undefined>;
  proxyError: Record<string, boolean | undefined>;
};

type FastGptStringToolsModule = {
  replaceSensitiveText: (text: string) => string;
};

type ProcessedNextError = {
  code: number;
  statusText: string;
  message: string;
  shouldClearCookie: boolean;
  httpStatus: number;
  data?: unknown;
  zodError?: unknown;
};

/**
 * File/storage 迁移仓储。保存原版文件路由映射，并把请求交给原版 Next API 上游执行。
 */
export class FileStorageRepository {
  findRoute(targetPath: string): FileStorageRouteDefinition | undefined {
    return fileStorageRouteDefinitions.find((item) =>
      this.matchTargetPath(item.targetPath, targetPath)
    );
  }

  listRoutes(): FileStorageRouteDefinition[] {
    return fileStorageRouteDefinitions;
  }

  /**
   * 登录态鉴权，供头像上传预签名使用。
   */
  async authCert(request: Pick<FastifyRequest, 'headers'>) {
    const { authCert } = await importServiceVendorModule<AuthCommonModule>(
      'support/permission/auth/common'
    );

    return authCert({ req: request, authToken: true });
  }

  /**
   * 团队成员权限鉴权，供临时文件上传预签名使用。
   */
  async authDatasetCreate(request: Pick<FastifyRequest, 'headers'>) {
    const [{ authUserPer }, { TeamDatasetCreatePermissionVal }] = await Promise.all([
      importServiceVendorModule<UserAuthModule>('support/permission/user/auth'),
      importGlobalVendorModule<TeamPermissionConstantModule>('support/permission/user/constant')
    ]);

    return authUserPer({
      req: request,
      authToken: true,
      authApiKey: true,
      per: TeamDatasetCreatePermissionVal
    });
  }

  /**
   * 创建头像上传预签名 URL。
   */
  async createAvatarUploadUrl(teamId: string, body: PresignAvatarBody) {
    const { getS3AvatarSource } = await importServiceVendorModule<AvatarSourceModule>(
      'common/s3/sources/avatar'
    );

    return getS3AvatarSource().createUploadAvatarURL({
      teamId,
      filename: body.filename,
      autoExpired: body.autoExpired
    });
  }

  /**
   * 获取团队套餐上传限制。
   */
  async getTeamPlanStatus(teamId: string) {
    const { getTeamPlanStatus } = await importServiceVendorModule<PlanStatusModule>(
      'support/wallet/sub/utils'
    );

    return getTeamPlanStatus({ teamId });
  }

  /**
   * 执行上传频控。
   */
  async authUploadFrequencyLimit(input: {
    tmbId: string;
    maxAmount: number;
    expiredTime: Date;
  }) {
    const { authFrequencyLimit } = await importServiceVendorModule<FrequencyLimitModule>(
      'common/system/frequencyLimit/utils'
    );

    return authFrequencyLimit({
      eventId: `${input.tmbId}-uploadfile`,
      maxAmount: input.maxAmount,
      expiredTime: input.expiredTime
    });
  }

  /**
   * 创建临时文件上传预签名 URL。
   */
  async createTempFileUploadUrl(teamId: string, body: PresignTempFileBody, maxFileSize: number) {
    const [{ getFileS3Key }, { S3PrivateBucket }] = await Promise.all([
      importServiceVendorModule<S3UtilsModule>('common/s3/utils'),
      importServiceVendorModule<PrivateBucketModule>('common/s3/buckets/private')
    ]);
    const bucket = new S3PrivateBucket();
    const { fileKey } = getFileS3Key.temp({ teamId, filename: body.filename });

    return bucket.createPresignedPutUrl(
      { rawKey: fileKey, filename: body.filename },
      {
        expiredHours: 1,
        maxFileSize
      }
    );
  }

  /**
   * 判断图片路径是否为 Mongo ObjectId。
   */
  async isMongoObjectId(value: string) {
    const { Types } = await importServiceVendorModule<MongoTypesModule>('common/mongo');

    return Types.ObjectId.isValid(value);
  }

  /**
   * 读取 Mongo 中保存的图片。
   */
  async readMongoImage(id: string) {
    const { readMongoImg } = await importServiceVendorModule<MongoImageModule>(
      'common/file/image/controller'
    );

    return readMongoImg({ id });
  }

  /**
   * 创建头像对象的公开访问 URL。
   */
  async createAvatarPublicUrl(key: string) {
    const { getS3AvatarSource } = await importServiceVendorModule<AvatarPublicSourceModule>(
      'common/s3/sources/avatar'
    );

    return getS3AvatarSource().createPublicUrl(key);
  }

  /**
   * 校验 S3 下载 token。
   */
  async verifyDownloadToken(token: string) {
    const { jwtVerifyS3DownloadToken } = await importServiceVendorModule<DownloadTokenModule>(
      'common/s3/security/token'
    );

    return jwtVerifyS3DownloadToken(token);
  }

  /**
   * 从全局 bucket map 中读取文件流和元数据。
   */
  async getBucketFile(bucketName: string, objectKey: string) {
    const bucketMap = globalThis as typeof globalThis & {
      s3BucketMap?: Record<
        string,
        {
          getFileStream: (key: string) => Promise<Readable | undefined>;
          getFileMetadata: (key: string) => Promise<{
            filename?: string;
            extension?: string;
            contentType?: string;
            contentLength?: number;
          } | null>;
        }
      >;
    };
    const bucket = bucketMap.s3BucketMap?.[bucketName];

    if (!bucket) {
      return undefined;
    }

    const [stream, metadata] = await Promise.all([
      bucket.getFileStream(objectKey),
      bucket.getFileMetadata(objectKey)
    ]);

    return { stream, metadata };
  }

  /**
   * 补全文本类型 charset。
   */
  async ensureContentTypeCharset(contentType: string, filename?: string) {
    const { ensureTextContentTypeCharset } = await importServiceVendorModule<MimeModule>(
      'common/s3/utils/mime'
    );

    return ensureTextContentTypeCharset({ contentType, filename });
  }

  /**
   * 生成 Content-Disposition 头。
   */
  async getContentDisposition(filename: string, type: 'inline' | 'attachment') {
    const { getContentDisposition } = await importGlobalVendorModule<FileToolsModule>(
      'common/file/tools'
    );

    return getContentDisposition({ filename, type });
  }

  /**
   * 校验 S3 objectKey jwt。
   */
  async verifyObjectKeyJwt(jwt: string) {
    const { jwtVerifyS3ObjectKey } = await importServiceVendorModule<ObjectKeyTokenModule>(
      'common/s3/utils'
    );

    return jwtVerifyS3ObjectKey(jwt);
  }

  /**
   * 判断 objectKey 是否属于指定 S3 业务域。
   */
  async isS3ObjectKey(key: string, type: 'dataset' | 'chat') {
    const { isS3ObjectKey } = await importServiceVendorModule<ObjectKeyTokenModule>(
      'common/s3/utils'
    );

    return isS3ObjectKey(key, type);
  }

  /**
   * 从 dataset/chat source 读取文件。
   */
  async getSourceFile(source: 'dataset' | 'chat', objectKey: string) {
    const bucket = await (async () => {
      if (source === 'dataset') {
        const { getS3DatasetSource } = await importServiceVendorModule<S3SourceModule>(
          'common/s3/sources/dataset'
        );
        return getS3DatasetSource();
      }

      const { getS3ChatSource } = await importServiceVendorModule<S3ChatSourceModule>(
        'common/s3/sources/chat'
      );
      return getS3ChatSource();
    })();
    const [stream, metadata] = await Promise.all([
      bucket.getFileStream(objectKey),
      bucket.getFileMetadata(objectKey)
    ]);

    return { stream, metadata };
  }

  /**
   * 校验文件读取 token。
   */
  async authFileToken(token?: string) {
    const { authFileToken } = await importServiceVendorModule<FileAuthModule>(
      'support/permission/auth/file'
    );

    return authFileToken(token);
  }

  /**
   * 获取原版 common file not found 业务错误键。
   */
  async getCommonFileNotFoundErrorKey() {
    const { CommonErrEnum } = await importGlobalVendorModule<CommonErrorCodeModule>(
      'common/error/code/common'
    );

    return CommonErrEnum.fileNotFound;
  }

  /**
   * 检测 stream 编码并返回可继续输出的 stream。
   */
  async stream2Encoding(stream: Readable) {
    const { stream2Encoding } = await importServiceVendorModule<GridFsUtilsModule>(
      'common/file/gridfs/utils'
    );

    return stream2Encoding(stream);
  }

  /**
   * 校验 S3 上传 token。
   */
  async verifyUploadToken(token: string) {
    const { jwtVerifyS3UploadToken } = await importServiceVendorModule<UploadTokenModule>(
      'common/s3/security/token'
    );

    return jwtVerifyS3UploadToken(token);
  }

  /**
   * 获取原版上传流在执行文件类型校验前需要缓存的字节数。
   */
  async getUploadInspectBytes(filename?: string) {
    const { getUploadInspectBytes } = await importServiceVendorModule<UploadValidationModule>(
      'common/s3/validation/upload'
    );

    return getUploadInspectBytes(filename);
  }

  /**
   * 上传前校验文件内容、类型和扩展名。
   */
  async validateUploadFile(input: {
    buffer: Buffer;
    filename?: string;
    uploadConstraints: unknown;
  }) {
    const { validateUploadFile } = await importServiceVendorModule<UploadValidationModule>(
      'common/s3/validation/upload'
    );

    return validateUploadFile(input);
  }

  /**
   * 上传文件到 token 指定的 bucket。
   */
  async uploadObject(input: {
    bucketName: string;
    key: string;
    body: Buffer | Readable;
    contentType: string;
    contentLength?: number;
    metadata?: Record<string, string>;
  }) {
    const bucketMap = globalThis as typeof globalThis & {
      s3BucketMap?: Record<
        string,
        {
          client: {
            uploadObject: (props: {
              key: string;
              body: Buffer | Readable;
              contentType: string;
              contentLength?: number;
              metadata?: Record<string, string>;
            }) => Promise<unknown>;
          };
        }
      >;
    };
    const bucket = bucketMap.s3BucketMap?.[input.bucketName];

    if (!bucket) {
      throw new Error('S3 bucket not found');
    }

    return bucket.client.uploadObject({
      key: input.key,
      body: input.body,
      contentType: input.contentType,
      contentLength: input.contentLength,
      metadata: input.metadata
    });
  }

  /**
   * 按原版 NextAPI/jsonRes 的错误结果格式化 file-storage 失败响应。
   *
   * 原版 `service/common/response` 会加载 service env，测试和轻量迁移运行时容易被密钥校验副作用中断。
   * 这里直接复用 vendor/global 的 ERROR_RESPONSE 与敏感信息脱敏函数，保持业务错误码、statusText
   * 和 message 来源与原版一致，同时避免引入 service/env。
   */
  async formatNextErrorResponse(error: unknown, defaultCode = 500) {
    const [{ ERROR_RESPONSE, proxyError }, { replaceSensitiveText }] = await Promise.all([
      importGlobalVendorModule<FastGptErrorCodeModule>('common/error/errorCode'),
      importGlobalVendorModule<FastGptStringToolsModule>('common/string/tools')
    ]);
    const errResponseKey = typeof error === 'string' ? error : (error as Error | undefined)?.message;
    const mappedError = errResponseKey ? ERROR_RESPONSE[errResponseKey] : undefined;
    const processedError: ProcessedNextError = mappedError
      ? {
          code: mappedError.code || defaultCode,
          statusText: mappedError.statusText || 'error',
          message: mappedError.message,
          data: mappedError.data,
          httpStatus: mappedError.httpStatus ?? 500,
          shouldClearCookie: false
        }
      : (() => {
          const source = error as {
            response?: {
              statusText?: string;
              data?: {
                error?: {
                  message?: string;
                };
              };
            };
            error?: {
              message?: string;
            };
            code?: string;
            message?: string;
          };
          let message = source?.response?.statusText || source?.message || '请求错误';

          if (typeof error === 'string') {
            message = error;
          } else if (source?.code && proxyError[source.code]) {
            message = '网络连接异常';
          } else if (source?.response?.data?.error?.message) {
            message = source.response.data.error.message;
          } else if (source?.error?.message) {
            message = source.error.message;
          }

          return {
            code: defaultCode,
            statusText: 'error',
            message: replaceSensitiveText(message),
            shouldClearCookie: false,
            httpStatus: defaultCode
          };
        })();
    const httpStatus = this.resolveNextErrorHttpStatus(processedError, {
      defaultCode,
      error
    });

    return {
      statusCode: httpStatus,
      body: {
        code: processedError.code,
        statusText: processedError.statusText,
        message: processedError.message,
        data: processedError.data !== undefined ? processedError.data : null,
        ...(processedError.zodError ? { zodError: processedError.zodError } : {})
      }
    };
  }

  private matchTargetPath(pattern: string, targetPath: string): boolean {
    if (pattern === targetPath) {
      return true;
    }

    if (pattern.endsWith('/*')) {
      return targetPath.startsWith(pattern.slice(0, -1));
    }

    if (pattern.includes('/:')) {
      const escapedPattern = pattern
        .split('/')
        .map((part) => (part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        .join('/');
      return new RegExp(`^${escapedPattern}$`).test(targetPath);
    }

    return false;
  }

  private resolveNextErrorHttpStatus(
    processedError: ProcessedNextError,
    props: {
      defaultCode: number;
      error: unknown;
    }
  ) {
    const businessCode = processedError.code;

    if (typeof businessCode === 'number' && businessCode >= 400 && businessCode <= 499) {
      return businessCode;
    }

    if (typeof businessCode === 'number' && businessCode >= 510000 && businessCode < 511000) {
      return 400;
    }

    const raw = typeof props.error === 'string' ? props.error : (props.error as Error | undefined)?.message;
    if (raw === 'EntityTooLarge') {
      return 413;
    }

    if (props.defaultCode >= 400 && props.defaultCode <= 499) {
      return props.defaultCode;
    }

    return 500;
  }
}
