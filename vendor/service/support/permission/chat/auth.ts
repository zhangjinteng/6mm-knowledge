import type { ChatSchemaType } from '../../../../global/core/chat/type';
import { ChatRoleEnum } from '../../../../global/core/chat/constants';
import type { HelperBotTypeEnum } from '../../../../global/core/chat/helperBot/type';
import { ChatErrEnum } from '../../../../global/common/error/code/chat';
import { DatasetErrEnum } from '../../../../global/common/error/code/dataset';
import { AuthUserTypeEnum, ReadPermissionVal } from '../../../../global/support/permission/constant';
import type { ShareChatAuthProps } from '../../../../global/support/permission/chat';
import type {
  AuthTeamTagTokenProps,
  AuthTokenFromTeamDomainResponse
} from '../../../../global/support/user/team/tag';
import { TeamMemberRoleEnum } from '../../../../global/support/user/team/constant';
import { authApp } from '../app/auth';
import { authCert } from '../auth/common';
import { authOutLinkValid } from '../publish/authLink';
import { authOutLinkInit } from '../../outLink/runtime/auth';
import type { AuthModeType } from '../type';
import { MongoApp } from '../../../core/app/schema';
import { MongoChat } from '../../../core/chat/chatSchema';
import { MongoChatItem } from '../../../core/chat/chatItemSchema';
import { MongoHelperBotChat } from '../../../core/chat/HelperBot/chatSchema';
import { GET } from '../../../common/api/plusRequest';
import { Types } from '../../../common/mongo';
import { MongoTeamMember } from '../../user/team/teamMemberSchema';
import type { OutLinkSchemaType } from '../../../../global/support/outLink/type';

export const defaultResponseShow = {
  showCite: true,
  showRunningStatus: true,
  showSkillReferences: true,
  showFullText: true,
  canDownloadSource: true
};

type AuthChatCommonProps = {
  appId: string;
  shareId?: string;
  outLinkUid?: string;
  teamId?: string;
  teamToken?: string;
};

export function authTeamTagToken(data: AuthTeamTagTokenProps) {
  return GET<AuthTokenFromTeamDomainResponse['data']>('/support/user/team/tag/authTeamToken', data);
}

export async function authTeamSpaceToken({
  teamId,
  teamToken
}: {
  teamId: string;
  teamToken: string;
}) {
  const [{ uid, tags }, member] = await Promise.all([
    authTeamTagToken({ teamId, teamToken }),
    MongoTeamMember.findOne({ teamId, role: TeamMemberRoleEnum.owner }, 'tmbId').lean()
  ]);

  return {
    uid,
    tmbId: member?._id!,
    tags
  };
}

export const authOutLink = async ({
  shareId,
  outLinkUid
}: ShareChatAuthProps): Promise<{
  uid: string;
  appId: string;
  outLinkConfig: OutLinkSchemaType;
}> => {
  if (!outLinkUid) {
    return Promise.reject(ChatErrEnum.unAuthChat);
  }
  const result = await authOutLinkValid({ shareId });
  const { uid } = await authOutLinkInit({
    outLinkUid,
    tokenUrl: result.outLinkConfig.limit?.hookUrl
  });

  return {
    ...result,
    uid
  };
};

/**
 * 校验 chat CRUD 权限。
 *
 * 支持普通 token/api key、分享链接 outLink、团队空间 teamToken 三种入口；
 * 带 chatId 时会继续校验会话归属，返回值包含当前入口允许展示的引用/运行状态权限。
 */
export async function authChatCrud({
  appId,
  chatId,

  shareId,
  outLinkUid,

  teamId: spaceTeamId,
  teamToken,
  ...props
}: AuthModeType &
  AuthChatCommonProps & {
    chatId?: string;
  }): Promise<{
  teamId: string;
  tmbId: string;
  uid: string;
  chat?: ChatSchemaType;
  showCite: boolean;
  showRunningStatus: boolean;
  showSkillReferences: boolean;
  showFullText: boolean;
  canDownloadSource: boolean;
  authType?: `${AuthUserTypeEnum}`;
}> {
  if (!appId) return Promise.reject(ChatErrEnum.unAuthChat);

  if (spaceTeamId && teamToken) {
    const { uid, tmbId, tags } = await authTeamSpaceToken({
      teamId: spaceTeamId,
      teamToken
    });

    const app = await MongoApp.findOne(
      {
        _id: appId,
        teamId: spaceTeamId,
        $or: [
          { teamTags: { $size: 0 } },
          { teamTags: { $exists: false } },
          { teamTags: { $in: tags } }
        ]
      },
      'teamId'
    ).lean();
    if (!app) {
      return Promise.reject(ChatErrEnum.unAuthChat);
    }

    if (!chatId) {
      return {
        teamId: spaceTeamId,
        tmbId,
        uid,
        ...defaultResponseShow,
        authType: AuthUserTypeEnum.teamDomain
      };
    }

    const chat = await MongoChat.findOne({ appId, chatId }).lean();
    if (!chat) {
      return {
        teamId: spaceTeamId,
        tmbId,
        uid,
        ...defaultResponseShow,
        authType: AuthUserTypeEnum.teamDomain
      };
    }

    if (String(chat.teamId) !== spaceTeamId || chat.outLinkUid !== uid) {
      return Promise.reject(ChatErrEnum.unAuthChat);
    }

    return {
      teamId: spaceTeamId,
      tmbId,
      uid,
      chat,
      ...defaultResponseShow,
      authType: AuthUserTypeEnum.teamDomain
    };
  }

  if (shareId && outLinkUid) {
    const {
      outLinkConfig,
      uid,
      appId: shareChatAppId
    } = await authOutLink({ shareId, outLinkUid });

    if (String(shareChatAppId) !== appId) return Promise.reject(ChatErrEnum.unAuthChat);

    if (!chatId) {
      return {
        teamId: String(outLinkConfig.teamId),
        tmbId: String(outLinkConfig.tmbId),
        uid,
        showCite: outLinkConfig.showCite ?? false,
        showRunningStatus: outLinkConfig.showRunningStatus ?? true,
        showSkillReferences: outLinkConfig.showSkillReferences ?? false,
        showFullText: outLinkConfig.showFullText ?? false,
        canDownloadSource: outLinkConfig.canDownloadSource ?? false,
        authType: AuthUserTypeEnum.outLink
      };
    }

    const chat = await MongoChat.findOne({ appId, chatId }).lean();

    if (!chat) {
      return {
        teamId: String(outLinkConfig.teamId),
        tmbId: String(outLinkConfig.tmbId),
        uid,
        showCite: outLinkConfig.showCite ?? false,
        showRunningStatus: outLinkConfig.showRunningStatus ?? true,
        showSkillReferences: outLinkConfig.showSkillReferences ?? false,
        showFullText: outLinkConfig.showFullText ?? false,
        canDownloadSource: outLinkConfig.canDownloadSource ?? false,
        authType: AuthUserTypeEnum.outLink
      };
    }
    if (chat.outLinkUid !== uid) return Promise.reject(ChatErrEnum.unAuthChat);
    return {
      teamId: String(outLinkConfig.teamId),
      tmbId: String(outLinkConfig.tmbId),
      chat,
      uid,
      showCite: outLinkConfig.showCite ?? false,
      showRunningStatus: outLinkConfig.showRunningStatus ?? true,
      showSkillReferences: outLinkConfig.showSkillReferences ?? false,
      showFullText: outLinkConfig.showFullText ?? false,
      canDownloadSource: outLinkConfig.canDownloadSource ?? false,
      authType: AuthUserTypeEnum.outLink
    };
  }

  const { teamId, tmbId, permission, authType } = await authApp({
    req: props.req,
    authToken: true,
    authApiKey: true,
    appId,
    per: ReadPermissionVal
  });

  if (!chatId) {
    return {
      teamId,
      tmbId,
      uid: tmbId,
      ...defaultResponseShow,
      authType
    };
  }

  const chat = await MongoChat.findOne({ appId, chatId }).lean();
  if (!chat) {
    return {
      teamId,
      tmbId,
      uid: tmbId,
      ...defaultResponseShow,
      authType
    };
  }

  if (String(teamId) !== String(chat.teamId)) return Promise.reject(ChatErrEnum.unAuthChat);
  if (permission.hasReadChatLogPer) {
    return {
      teamId,
      tmbId,
      chat,
      uid: chat.outLinkUid ?? chat.tmbId,
      ...defaultResponseShow,
      authType
    };
  }

  if (String(tmbId) === String(chat.tmbId)) {
    return {
      teamId,
      tmbId,
      chat,
      uid: chat.outLinkUid ?? chat.tmbId,
      ...defaultResponseShow,
      authType
    };
  }

  return Promise.reject(ChatErrEnum.unAuthChat);
}

/**
 * 校验文档是否来自当前会话引用。
 *
 * 只依赖 ChatItem 上的 citeCollectionIds 判断 collection 是否在当前会话中被引用，
 * 避免读取和解析完整 responseData。
 */
export const authCollectionInChat = async ({
  collectionIds,
  appId,
  chatId
}: {
  collectionIds: string[];
  appId: string;
  chatId: string;
}) => {
  const appObjectId = Types.ObjectId.isValid(String(appId))
    ? new Types.ObjectId(String(appId))
    : appId;
  const targetCollectionIds = collectionIds.map(String);

  const [authResult] = await MongoChatItem.aggregate<{ isAuthorized: boolean }>([
    {
      $match: {
        appId: appObjectId,
        chatId,
        obj: ChatRoleEnum.AI
      }
    },
    { $sort: { _id: -1 } },
    { $limit: 50 },
    { $unwind: '$citeCollectionIds' },
    {
      $group: {
        _id: null,
        citeCollectionIds: { $addToSet: { $toString: '$citeCollectionIds' } }
      }
    },
    {
      $project: {
        _id: 0,
        isAuthorized: { $setIsSubset: [targetCollectionIds, '$citeCollectionIds'] }
      }
    }
  ]);

  if (authResult?.isAuthorized) {
    return;
  }
  return Promise.reject(DatasetErrEnum.unAuthDatasetFile);
};

export const authHelperBotChatCrud = async ({
  type,
  chatId,
  ...props
}: AuthModeType & {
  type: `${HelperBotTypeEnum}`;
  chatId: string;
}) => {
  const { userId, teamId, tmbId } = await authCert(props);

  const chat = await MongoHelperBotChat.findOne({ type, userId, chatId }).lean();

  return { chat, userId, teamId, tmbId };
};
