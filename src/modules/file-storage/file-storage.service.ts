import type { FastifyRequest } from 'fastify';

import { AppError } from '@/common/errors/app-error.js';
import { ErrorCode } from '@/common/errors/error-code.js';
import { HttpStatus } from '@/common/http/status-code.js';
import { FileStorageRepository } from '@/modules/file-storage/file-storage.repository.js';
import type { PresignAvatarBody, PresignTempFileBody } from '@/modules/file-storage/file-storage.schema.js';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';

const EntityTooLargeStatusCode = 413;

const PreviewableExtensions = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'bmp',
  'webp',
  'txt',
  'log',
  'csv',
  'md',
  'json'
]);

export class FileStorageService {
  constructor(private readonly repository = new FileStorageRepository()) {}

  /**
   * 创建头像上传预签名 URL。对齐原版 token 鉴权和 avatar source 行为。
   */
  async presignAvatarPostUrl(request: Pick<FastifyRequest, 'headers'>, body: PresignAvatarBody) {
    const { teamId } = await this.repository.authCert(request);

    return this.repository.createAvatarUploadUrl(teamId, body);
  }

  /**
   * 创建临时文件上传预签名 URL。对齐原版团队权限、套餐限制和上传频控。
   */
  async presignTempFilePostUrl(
    request: Pick<FastifyRequest, 'headers'>,
    body: PresignTempFileBody
  ) {
    const { teamId, tmbId } = await this.repository.authDatasetCreate(request);
    const planStatus = await this.repository.getTeamPlanStatus(teamId);
    const { feConfigs } = globalThis as typeof globalThis & {
      feConfigs: {
        uploadFileMaxAmount: number;
        uploadFileMaxSize: number;
      };
    };
    const maxUploadFileCount =
      planStatus.standard?.maxUploadFileCount || feConfigs.uploadFileMaxAmount;
    const maxUploadFileSize =
      planStatus.standard?.maxUploadFileSize ?? feConfigs.uploadFileMaxSize;

    await this.repository.authUploadFrequencyLimit({
      tmbId,
      maxAmount: maxUploadFileCount,
      expiredTime: new Date(Date.now() + 30 * 1000)
    });

    return this.repository.createTempFileUploadUrl(teamId, body, maxUploadFileSize);
  }

  /**
   * 读取系统图片。ObjectId 走 Mongo 二进制，否则重定向到头像公开 URL。
   */
  async readSystemImage(idParts: string[]) {
    const joined = idParts.join('/');
    const parsed = path.parse(joined);
    const keys = path.format({ dir: parsed.dir, name: parsed.name, ext: '' });

    if (await this.repository.isMongoObjectId(keys)) {
      const { binary, mime } = await this.repository.readMongoImage(joined);

      return {
        type: 'binary' as const,
        binary,
        mime
      };
    }

    const publicUrl = await this.repository.createAvatarPublicUrl(joined);

    return {
      type: 'redirect' as const,
      url: encodeURI(publicUrl)
    };
  }

  /**
   * 通过下载 token 读取 S3 文件。对齐原版下载接口的 token、bucket、metadata 和响应头逻辑。
   */
  async downloadFile(token: string, queryFilename?: string) {
    const parseRequestFilename = (filename?: string) => {
      if (!filename) return '';
      try {
        return decodeURIComponent(filename);
      } catch {
        return filename;
      }
    };

    const { objectKey, bucketName } = await this.repository.verifyDownloadToken(token);
    const file = await this.repository.getBucketFile(bucketName, objectKey);

    if (!file) {
      return {
        statusCode: 404,
        json: {
          code: 404,
          statusText: 'error',
          message: 'S3 bucket not found',
          data: null
        }
      };
    }

    if (!file.stream) {
      return {
        statusCode: 404,
        json: {
          code: 404,
          statusText: 'error',
          message: 'File not found',
          data: null
        }
      };
    }

    const filename =
      parseRequestFilename(queryFilename) ||
      file.metadata?.filename ||
      path.basename(objectKey) ||
      'file';
    const headers: Record<string, string | number> = {
      'content-disposition': await this.repository.getContentDisposition(filename, 'inline'),
      'cache-control': 'public, max-age=31536000'
    };

    if (file.metadata?.contentType) {
      headers['content-type'] = await this.repository.ensureContentTypeCharset(
        file.metadata.contentType,
        file.metadata.filename
      );
    }
    if (file.metadata?.contentLength) {
      headers['content-length'] = file.metadata.contentLength;
    }

    return {
      statusCode: 200,
      headers,
      stream: file.stream
    };
  }

  /**
   * 通过 objectKey jwt 读取 dataset/chat 文件。
   */
  async readJwtFile(jwt: string) {
    const { objectKey } = await this.repository.verifyObjectKeyJwt(jwt);
    const source = (await this.repository.isS3ObjectKey(objectKey, 'dataset'))
      ? 'dataset'
      : (await this.repository.isS3ObjectKey(objectKey, 'chat'))
        ? 'chat'
        : undefined;

    if (!source) {
      return {
        statusCode: 404,
        json: {
          code: 404,
          statusText: 'error',
          message: 'File not found',
          data: null
        }
      };
    }

    const file = await this.repository.getSourceFile(source, objectKey);

    if (!file.stream) {
      return {
        statusCode: 404,
        json: {
          code: 404,
          statusText: 'error',
          message: 'File not found',
          data: null
        }
      };
    }

    const filename = file.metadata?.filename || path.basename(objectKey) || 'file';
    const headers: Record<string, string | number> = {
      'content-disposition': await this.repository.getContentDisposition(filename, 'inline'),
      'cache-control': 'public, max-age=31536000'
    };

    if (file.metadata?.contentType) {
      headers['content-type'] = await this.repository.ensureContentTypeCharset(
        file.metadata.contentType,
        file.metadata.filename
      );
    }
    if (file.metadata?.contentLength) {
      headers['content-length'] = file.metadata.contentLength;
    }

    return {
      statusCode: 200,
      headers,
      stream: file.stream
    };
  }

  /**
   * 读取带 file token 的 dataset 文件预览/下载。
   */
  async readCommonFile(filename: string, token?: string) {
    const { fileId } = await this.repository.authFileToken(token);

    if (!fileId || !(await this.repository.isS3ObjectKey(fileId, 'dataset'))) {
      throw new Error('Invalid fileId');
    }

    const file = await this.repository.getSourceFile('dataset', fileId);

    if (!file.stream || !file.metadata) {
      throw new Error(await this.repository.getCommonFileNotFoundErrorKey());
    }

    const { stream, encoding } = await this.repository.stream2Encoding(file.stream);
    const extension = file.metadata.extension ?? '';
    const disposition = PreviewableExtensions.has(extension) ? 'inline' : 'attachment';
    const headers: Record<string, string | number> = {
      'content-type': `${file.metadata.contentType}; charset=${encoding}`,
      'cache-control': 'public, max-age=31536000',
      'content-disposition': await this.repository.getContentDisposition(filename, disposition)
    };

    if (file.metadata.contentLength) {
      headers['content-length'] = file.metadata.contentLength;
    }

    return {
      statusCode: 200,
      headers,
      stream
    };
  }

  /**
   * 上传文件到 S3。对齐原版 raw stream guard：先按 token 校验大小和文件类型，再流式写入对象存储。
   */
  async uploadFile(token: string, body: unknown, headers: FastifyRequest['headers']) {
    type ValidatedUploadFile = Awaited<ReturnType<FileStorageRepository['validateUploadFile']>>;

    const isReadableBody = (value: unknown): value is Readable =>
      value instanceof Readable ||
      (!!value &&
        typeof value === 'object' &&
        typeof (value as { pipe?: unknown }).pipe === 'function' &&
        typeof (value as { on?: unknown }).on === 'function');

    const parseContentLength = (value: string | string[] | undefined) => {
      const raw = Array.isArray(value) ? value[0] : value;
      if (!raw) return undefined;

      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
      return parsed;
    };

    const throwEntityTooLarge = () => {
      throw new AppError('EntityTooLarge', {
        statusCode: EntityTooLargeStatusCode,
        code: ErrorCode.AppError
      });
    };

    if (!Buffer.isBuffer(body) && !isReadableBody(body)) {
      throw new AppError('Invalid upload body', {
        statusCode: HttpStatus.BadRequest,
        code: ErrorCode.RequestValidationError
      });
    }

    const { objectKey, bucketName, maxSize, uploadConstraints, metadata } =
      await this.repository.verifyUploadToken(token);
    const contentLength = parseContentLength(headers['content-length']);

    if (contentLength && contentLength > maxSize) {
      throwEntityTooLarge();
    }

    const originFilename = metadata?.originFilename;
    const inspectBytes = await this.repository.getUploadInspectBytes(originFilename);

    const createUploadGuardStream = () => {
      let uploadedBytes = 0;
      let bufferedBytes = 0;
      const chunks: Buffer[] = [];
      let validatedFile: ValidatedUploadFile | undefined;
      let validationSettled = false;
      let resolveValidatedUpload!: (value: ValidatedUploadFile) => void;
      let rejectValidatedUpload!: (reason?: unknown) => void;

      const validatedUpload = new Promise<ValidatedUploadFile>((resolve, reject) => {
        resolveValidatedUpload = resolve;
        rejectValidatedUpload = reject;
      });

      const settleValidation = ({
        result,
        error
      }: {
        result?: ValidatedUploadFile;
        error?: unknown;
      }) => {
        if (validationSettled) return;
        validationSettled = true;

        if (error) {
          rejectValidatedUpload(error);
          return;
        }
        if (result) {
          resolveValidatedUpload(result);
        }
      };

      const validateBuffer = async () => {
        if (validatedFile) return validatedFile;

        const buffer = Buffer.concat(chunks, bufferedBytes);
        const result = await this.repository.validateUploadFile({
          buffer,
          filename: originFilename,
          uploadConstraints
        });

        validatedFile = result;
        settleValidation({ result });

        return result;
      };

      const stream = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          uploadedBytes += chunk.length;
          if (uploadedBytes > maxSize) {
            const error = new AppError('EntityTooLarge', {
              statusCode: EntityTooLargeStatusCode,
              code: ErrorCode.AppError
            });
            settleValidation({ error });
            callback(error);
            return;
          }

          if (validatedFile) {
            callback(null, chunk);
            return;
          }

          chunks.push(chunk);
          bufferedBytes += chunk.length;

          if (bufferedBytes < inspectBytes) {
            callback();
            return;
          }

          validateBuffer()
            .then(() => {
              const initialBuffer = Buffer.concat(chunks, bufferedBytes);
              chunks.length = 0;
              bufferedBytes = 0;
              callback(null, initialBuffer);
            })
            .catch((error: unknown) => {
              settleValidation({ error });
              callback(error instanceof Error ? error : new Error(String(error)));
            });
        },
        flush(callback) {
          validateBuffer()
            .then(() => {
              if (bufferedBytes > 0) {
                callback(null, Buffer.concat(chunks, bufferedBytes));
                return;
              }
              callback();
            })
            .catch((error: unknown) => {
              settleValidation({ error });
              callback(error instanceof Error ? error : new Error(String(error)));
            });
        }
      });

      stream.once('error', (error) => {
        settleValidation({ error });
      });
      stream.once('close', () => {
        if (!validationSettled && !validatedFile) {
          settleValidation({ error: new Error('UploadStreamClosed') });
        }
      });

      return {
        stream,
        validatedUpload
      };
    };

    const { stream: guardStream, validatedUpload } = createUploadGuardStream();
    const uploadSource = Buffer.isBuffer(body) ? Readable.from(body) : body;

    uploadSource.pipe(guardStream);
    const validatedFile = await validatedUpload;
    const validatedFilename = validatedFile.filename;
    const uploadMetadata = validatedFilename
      ? {
          ...metadata,
          contentDisposition: await this.repository.getContentDisposition(
            validatedFilename,
            'attachment'
          ),
          originFilename: encodeURIComponent(validatedFilename)
        }
      : metadata;

    await this.repository.uploadObject({
      bucketName,
      key: objectKey,
      body: guardStream,
      contentType: validatedFile.contentType,
      contentLength,
      metadata: uploadMetadata
    });

    return {
      success: true
    };
  }

  /**
   * 返回 file/storage 路由的显式迁移占位错误，避免对齐阶段出现 404 和静默遗漏。
   */
  getRouteNotMigratedError(targetPath: string) {
    const route = this.repository.findRoute(targetPath);

    return new AppError('该 file/storage 接口已登记，但尚未完成 Fastify 迁移', {
      statusCode: HttpStatus.NotImplemented,
      code: ErrorCode.RouteNotMigrated,
      details: {
        sourcePath: route?.sourcePath ?? targetPath,
        targetPath: route?.targetPath ?? targetPath,
        status: route?.status ?? 'pending'
      }
    });
  }

  /**
   * 按原版 NextAPI/jsonRes 的错误格式生成响应体。
   */
  async formatNextErrorResponse(error: unknown, defaultCode = 500) {
    return this.repository.formatNextErrorResponse(error, defaultCode);
  }

}
