import { ErrorCode, type ErrorCodeValue } from '@/common/errors/error-code.js';
import { HttpStatus } from '@/common/http/status-code.js';

export type AppErrorOptions = {
  statusCode?: number;
  code?: ErrorCodeValue;
  details?: unknown;
  cause?: unknown;
};

/**
 * 业务错误基类，用于把 service/usecase 层的可预期错误稳定映射成 HTTP 响应。
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCodeValue;
  readonly details?: unknown;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.statusCode = options.statusCode ?? HttpStatus.InternalServerError;
    this.code = options.code ?? ErrorCode.AppError;
    this.details = options.details;
  }
}
