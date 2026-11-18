export const ErrorCode = {
  AppError: 'APP_ERROR',
  RequestValidationError: 'REQUEST_VALIDATION_ERROR',
  Unauthorized: 'UNAUTHORIZED',
  InternalServerError: 'INTERNAL_SERVER_ERROR',
  ExternalResponseInvalid: 'EXTERNAL_RESPONSE_INVALID',
  RouteNotMigrated: 'ROUTE_NOT_MIGRATED'
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
