import OpenAI from '../../../global/core/ai/index';
import { type OpenaiAccountType } from '../../../global/support/user/team/type';
import { serviceEnv } from '../../env';

const aiProxyBaseUrl = serviceEnv.AIPROXY_API_ENDPOINT
  ? `${serviceEnv.AIPROXY_API_ENDPOINT}/v1`
  : undefined;
export const openaiBaseUrl = aiProxyBaseUrl || serviceEnv.OPENAI_BASE_URL;
export const openaiBaseKey = aiProxyBaseUrl
  ? serviceEnv.AIPROXY_API_TOKEN || serviceEnv.CHAT_API_KEY
  : serviceEnv.CHAT_API_KEY;
export const defaultUserOpenAIBaseUrl = 'https://api.openai.com/v1';

export type AIApiRequestMeta = {
  usedUserOpenAIKey: boolean;
  baseUrl?: string;
};

const getUserOpenAIAccount = (userKey?: OpenaiAccountType): OpenaiAccountType | undefined => {
  if (!userKey?.key) return;

  return {
    key: userKey.key,
    baseUrl: userKey.baseUrl || defaultUserOpenAIBaseUrl
  };
};

// 代理走同包 common/proxy/index.ts 里的 EnvHttpProxyAgent + setGlobalDispatcher
export const getAIApi = (props?: { userKey?: OpenaiAccountType; timeout?: number }) => {
  const { userKey, timeout } = props || {};
  const userOpenAIAccount = getUserOpenAIAccount(userKey);

  const baseUrl = userOpenAIAccount?.baseUrl || global?.systemEnv?.oneapiUrl || openaiBaseUrl;
  const apiKey = userOpenAIAccount?.key || global?.systemEnv?.chatApiKey || openaiBaseKey;

  return {
    ai: new OpenAI({
      baseURL: baseUrl,
      apiKey,
      timeout,
      maxRetries: 2
    }),
    requestMeta: {
      usedUserOpenAIKey: !!userOpenAIAccount,
      baseUrl
    } satisfies AIApiRequestMeta
  };
};

export const getAxiosConfig = (props?: { userKey?: OpenaiAccountType }) => {
  const { userKey } = props || {};
  const userOpenAIAccount = getUserOpenAIAccount(userKey);

  const baseUrl = userOpenAIAccount?.baseUrl || global?.systemEnv?.oneapiUrl || openaiBaseUrl;
  const apiKey = userOpenAIAccount?.key || global?.systemEnv?.chatApiKey || openaiBaseKey;

  return {
    baseUrl,
    authorization: `Bearer ${apiKey}`
  };
};
