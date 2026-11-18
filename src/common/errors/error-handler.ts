import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { ZodError } from 'zod';

import { HttpStatus } from '@/common/http/status-code.js';
import { fastGptGlobalVendorModule } from '@/common/vendor/fastgpt-vendor.js';
import { AppError } from '@/common/errors/app-error.js';
import { ErrorCode } from '@/common/errors/error-code.js';

type FastGptErrorResponseItem = {
  code: number;
  statusText: string;
  message: string;
  data?: unknown;
  httpStatus?: number;
};

type FastGptErrorCodeModule = {
  ERROR_RESPONSE: Record<string, FastGptErrorResponseItem | undefined>;
  ERROR_ENUM: {
    unAuthorization: string;
  };
};

type ApiErrorBody = {
  code: number;
  statusText: string;
  message: string;
  data: unknown;
  zodError?: unknown;
};

let fastGptErrorCodeModulePromise: Promise<FastGptErrorCodeModule> | undefined;

function resolveHttpStatusForFastGptErrorResponse(
  errorResponse: FastGptErrorResponseItem,
  defaultStatusCode: number
) {
  if (errorResponse.httpStatus) return errorResponse.httpStatus;
  if (errorResponse.code >= 400 && errorResponse.code <= 499) return errorResponse.code;
  if (defaultStatusCode >= 400 && defaultStatusCode <= 499) return defaultStatusCode;

  return HttpStatus.InternalServerError;
}

function isFastGptUserError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === 'UserError' || error.constructor?.name === 'UserError')
  );
}

function getFastifyErrorStatusCode(error: FastifyError | Error) {
  const statusCode = 'statusCode' in error ? error.statusCode : undefined;

  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
    ? statusCode
    : undefined;
}

function loadFastGptErrorCodeModule() {
  fastGptErrorCodeModulePromise ??= import(
    fastGptGlobalVendorModule('common/error/errorCode')
  ) as Promise<FastGptErrorCodeModule>;

  return fastGptErrorCodeModulePromise;
}

async function getFastGptErrorResponse(key: string) {
  const { ERROR_RESPONSE } = await loadFastGptErrorCodeModule();

  return ERROR_RESPONSE[key];
}

async function getUnauthorizedResponse() {
  const { ERROR_RESPONSE, ERROR_ENUM } = await loadFastGptErrorCodeModule();

  return ERROR_RESPONSE[ERROR_ENUM.unAuthorization];
}

function sendApiError(
  reply: FastifyReply,
  statusCode: number,
  body: ApiErrorBody
) {
  return reply.status(statusCode).send(body);
}

function validationErrorBody(zodError: unknown): ApiErrorBody {
  return {
    code: HttpStatus.BadRequest,
    statusText: 'error',
    message: 'Data validation error',
    data: null,
    zodError
  };
}

function internalZodErrorBody(error: ZodError): ApiErrorBody {
  return {
    code: HttpStatus.InternalServerError,
    statusText: 'error',
    message: error.message,
    data: null,
    zodError: error.issues
  };
}

function mappedErrorBody(errorResponse: FastGptErrorResponseItem): ApiErrorBody {
  return {
    code: errorResponse.code,
    statusText: errorResponse.statusText,
    message: errorResponse.message,
    data: errorResponse.data ?? null
  };
}

function genericErrorBody(props: {
  code: number;
  statusText?: string;
  message: string;
  data?: unknown;
}): ApiErrorBody {
  return {
    code: props.code,
    statusText: props.statusText ?? 'error',
    message: props.message,
    data: props.data ?? null
  };
}

/**
 * 集中处理 API 边界错误，输出与原 NextAPI/jsonRes 对齐的错误结构。
 */
export async function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  if (hasZodFastifySchemaValidationErrors(error)) {
    return sendApiError(reply, HttpStatus.BadRequest, validationErrorBody(error.validation));
  }

  if (error instanceof ZodError) {
    request.log.error({ err: error }, error.message);

    return sendApiError(
      reply,
      HttpStatus.InternalServerError,
      internalZodErrorBody(error)
    );
  }

  if (error instanceof AppError) {
    if (error.statusCode >= HttpStatus.InternalServerError) {
      request.log.error({ err: error }, error.message);
    }

    if (error.code === ErrorCode.Unauthorized) {
      const unauthorizedResponse = await getUnauthorizedResponse();
      if (unauthorizedResponse) {
        return sendApiError(reply, HttpStatus.Forbidden, mappedErrorBody(unauthorizedResponse));
      }
    }

    if (error.code === ErrorCode.RequestValidationError) {
      return sendApiError(reply, HttpStatus.BadRequest, validationErrorBody(error.details));
    }

    const errorResponse = await getFastGptErrorResponse(error.message);
    if (errorResponse) {
      return sendApiError(
        reply,
        resolveHttpStatusForFastGptErrorResponse(errorResponse, error.statusCode),
        mappedErrorBody(errorResponse)
      );
    }

    return sendApiError(
      reply,
      error.statusCode,
      genericErrorBody({
        code: error.statusCode,
        statusText: error.code === ErrorCode.AppError ? 'error' : error.code,
        message: error.message,
        data: error.details ?? null
      })
    );
  }

  if (isFastGptUserError(error)) {
    const errorResponse = await getFastGptErrorResponse(error.message);
    if (errorResponse) {
      return sendApiError(reply, HttpStatus.BadRequest, mappedErrorBody(errorResponse));
    }

    return sendApiError(
      reply,
      HttpStatus.BadRequest,
      genericErrorBody({
        code: HttpStatus.BadRequest,
        message: error.message || '请求错误'
      })
    );
  }

  if (typeof error === 'string') {
    const errorResponse = await getFastGptErrorResponse(error);
    if (errorResponse) {
      return sendApiError(
        reply,
        resolveHttpStatusForFastGptErrorResponse(
          errorResponse,
          HttpStatus.InternalServerError
        ),
        mappedErrorBody(errorResponse)
      );
    }

    return sendApiError(
      reply,
      HttpStatus.InternalServerError,
      genericErrorBody({
        code: HttpStatus.InternalServerError,
        message: error
      })
    );
  }

  const fastifyStatusCode = getFastifyErrorStatusCode(error);
  if (fastifyStatusCode) {
    return sendApiError(
      reply,
      fastifyStatusCode,
      genericErrorBody({
        code: fastifyStatusCode,
        message: error.message || '请求错误'
      })
    );
  }

  request.log.error({ err: error }, error.message);

  return sendApiError(
    reply,
    HttpStatus.InternalServerError,
    genericErrorBody({
      code: HttpStatus.InternalServerError,
      message: '服务内部错误'
    })
  );
}
