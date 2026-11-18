import type { FastifyReply, FastifyRequest } from 'fastify';

import { FileStorageService } from '@/modules/file-storage/file-storage.service.js';
import type { PresignAvatarBody, PresignTempFileBody } from '@/modules/file-storage/file-storage.schema.js';

const getRouteToken = (params: unknown, key: 'token' | 'jwt') => {
  const record = params as Record<string, string | undefined>;

  return record[key] ?? record['*'] ?? '';
};

function nextOk<T>(data: T) {
  return {
    code: 200 as const,
    statusText: '' as const,
    message: '' as const,
    data
  };
}

export class FileStorageController {
  constructor(private readonly service = new FileStorageService()) {}

  async presignAvatarPostUrl(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = await this.service.presignAvatarPostUrl(
        request,
        request.body as PresignAvatarBody
      );

      return nextOk(data);
    } catch (error) {
      return this.sendNextError(reply, error);
    }
  }

  async presignTempFilePostUrl(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = await this.service.presignTempFilePostUrl(
        request,
        request.body as PresignTempFileBody
      );

      return nextOk(data);
    } catch (error) {
      return this.sendNextError(reply, error);
    }
  }

  async readSystemImage(request: FastifyRequest, reply: FastifyReply) {
    try {
      const id = (request.params as { '*': string })['*'].split('/').filter(Boolean);
      const result = await this.service.readSystemImage(id);

      if (result.type === 'redirect') {
        return reply.redirect(result.url, 301);
      }

      return reply.header('content-type', result.mime).send(result.binary);
    } catch (error) {
      return this.sendNextError(reply, error);
    }
  }

  async downloadFile(request: FastifyRequest, reply: FastifyReply) {
    try {
      const token = getRouteToken(request.params, 'token');
      const { filename } = request.query as { filename?: string };
      const result = await this.service.downloadFile(token, filename);

      if ('json' in result) {
        return reply.status(result.statusCode).send(result.json);
      }

      for (const [key, value] of Object.entries(result.headers)) {
        reply.header(key, value);
      }

      if (request.method === 'HEAD') {
        return reply.status(result.statusCode).send();
      }

      result.stream.once('error', (error) => {
        request.log.error({ err: error }, 'Error reading proxy download stream');
      });

      return reply.status(result.statusCode).send(result.stream);
    } catch (error) {
      return this.sendNextError(reply, error);
    }
  }

  async readJwtFile(request: FastifyRequest, reply: FastifyReply) {
    try {
      const jwt = getRouteToken(request.params, 'jwt');
      const result = await this.service.readJwtFile(jwt);

      if ('json' in result) {
        return reply.status(result.statusCode).send(result.json);
      }

      for (const [key, value] of Object.entries(result.headers)) {
        reply.header(key, value);
      }

      result.stream.once('error', (error) => {
        request.log.error({ err: error }, 'Error reading dataset file');
      });

      return reply.status(result.statusCode).send(result.stream);
    } catch (error) {
      return this.sendNextError(reply, error);
    }
  }

  async readCommonFile(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { filename } = request.params as { filename: string };
      const { token } = request.query as { token?: string };
      const result = await this.service.readCommonFile(filename, token);

      if ('json' in result) {
        return reply.status(result.statusCode).send(result.json);
      }

      for (const [key, value] of Object.entries(result.headers)) {
        reply.header(key, value);
      }

      result.stream.once('error', (error) => {
        request.log.error({ err: error }, 'Error reading common file');
      });

      return reply.status(result.statusCode).send(result.stream);
    } catch (error) {
      return this.sendNextError(reply, error);
    }
  }

  async uploadFile(request: FastifyRequest, reply: FastifyReply) {
    try {
      const token = getRouteToken(request.params, 'token');
      const data = await this.service.uploadFile(token, request.body, request.headers);

      return nextOk(data);
    } catch (error) {
      return this.sendNextError(reply, error);
    }
  }

  async notMigrated(request: FastifyRequest) {
    const targetPath = request.url.split('?')[0];

    throw this.service.getRouteNotMigratedError(targetPath);
  }

  private async sendNextError(reply: FastifyReply, error: unknown, defaultCode = 500) {
    const result = await this.service.formatNextErrorResponse(error, defaultCode);

    return reply.status(result.statusCode).send(result.body);
  }

}
