import type { Permission } from '../../../global/support/permission/controller';
import type { ApiRequestProps } from '../../type/next';
import type { PermissionValueType } from '../../../global/support/permission/type';
import type { RequireAtLeastOne } from '../../../global/common/type/utils';
import type { AuthUserTypeEnum } from '../../../global/support/permission/constant';

export type ReqHeaderAuthType = {
  cookie?: string;
  token?: string;
  apikey?: string; // abandon
  rootkey?: string;
  userid?: string;
  authorization?: string;
};

type authModeType = {
  req: ApiRequestProps;
  authToken?: boolean;
  authRoot?: boolean;
  authApiKey?: boolean;
  per?: PermissionValueType;
};

export type AuthModeType = RequireAtLeastOne<authModeType, 'authApiKey' | 'authRoot' | 'authToken'>;

export type AuthResponseType<T extends Permission = Permission> = {
  userId: string;
  teamId: string;
  tmbId: string;
  authType?: `${AuthUserTypeEnum}`;
  appId?: string;
  apikey?: string;
  isRoot: boolean;
  permission: T;
};
