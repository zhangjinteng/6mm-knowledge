import { sandboxToolMap } from '../../../../../global/core/ai/sandbox/tools/index';
import { parseI18nString } from '../../../../../global/common/i18n/utils';
import type { localeType } from '../../../../../global/common/i18n/type';
import { LangEnum } from '../../../../../global/common/i18n/type';
import { toolMap as editFileToolMap } from './editFile.tool';
import { toolMap as getFileUrlToolMap } from './getFileUrl.tool';
import { toolMap as readFileToolMap } from './readFile.tool';
import { toolMap as searchToolMap } from './search.tool';
import { toolMap as shellToolMap } from './shell.tool';
import { toolMap as writeFileToolMap } from './writeFile.tool';
import type { SandboxToolRuntime } from '../service/runtime';
import { getPermissionSandboxClient } from '../service/permissionRuntime';
import { parseJsonArgs } from '../../utils';
import { writeUrlFilesToSandbox } from '../service/file';
import type { AgentSandboxRuntimeType } from '../../../../../global/core/ai/sandbox/permission';

const ToolMap = {
  ...editFileToolMap,
  ...getFileUrlToolMap,
  ...readFileToolMap,
  ...searchToolMap,
  ...writeFileToolMap,
  ...shellToolMap
};

export type SandboxToolCallResult = {
  success: boolean;
  input: Record<string, any>;
  response: string;
  durationSeconds: number;
};

/**
 * 按当前 workflow 运行态获取 sandbox client。
 *
 * fastify 运行链路统一使用权限沙箱；未显式传入 agentSandboxRuntime 时，
 * getPermissionSandboxClient 会按默认 danger-full-access 权限创建本地运行态。
 */
const getToolSandboxClient = async ({
  appId,
  userId,
  chatId,
  agentSandboxRuntime
}: {
  appId: string;
  userId: string;
  chatId: string;
  agentSandboxRuntime?: AgentSandboxRuntimeType;
}) => {
  return getPermissionSandboxClient(
    {
      appId,
      userId,
      chatId
    },
    {
      runtime: agentSandboxRuntime
    }
  );
};

/**
 * 执行一次 sandbox 工具调用。
 *
 * 这里负责解析 LLM 传入的 JSON 参数、按工具 schema 校验，并复用已有 sandbox client；
 * 未传入 client 时会按 app/user/chat 获取运行态 sandbox。
 */
export const runSandboxTools = async ({
  appId,
  userId,
  chatId,
  toolName,
  args,
  sandboxClient,
  agentSandboxRuntime
}: {
  appId: string;
  userId: string;
  chatId: string;
  toolName: string;
  args: string;
  sandboxClient?: SandboxToolRuntime;
  agentSandboxRuntime?: AgentSandboxRuntimeType;
}): Promise<SandboxToolCallResult> => {
  const startTime = Date.now();
  const getDuration = () => +((Date.now() - startTime) / 1000).toFixed(2);

  const tool = ToolMap[toolName as keyof typeof ToolMap];

  if (!tool) {
    return {
      success: false,
      input: {},
      response: `Unknown sandbox tool: ${toolName}`,
      durationSeconds: getDuration()
    };
  }

  const parsedArgs = tool.zodSchema.safeParse(parseJsonArgs(args));
  if (!parsedArgs.success) {
    return {
      success: false,
      input: {},
      response: parsedArgs.error.message,
      durationSeconds: getDuration()
    };
  }

  const instance =
    sandboxClient ??
    (await getToolSandboxClient({
      appId,
      userId,
      chatId,
      agentSandboxRuntime
    }));
  let executeSuccess = true;
  const result = await tool
    .execute({
      appId,
      userId,
      chatId,
      sandboxInstance: instance,
      params: parsedArgs.data as any
    })
    .catch((error: unknown) => {
      executeSuccess = false;
      return {
        response: error instanceof Error ? error.message : String(error)
      };
    });

  return {
    success: executeSuccess,
    input: parsedArgs.data,
    response: result.response,
    durationSeconds: getDuration()
  };
};

/**
 * 将用户输入文件注入到当前会话 sandbox。
 *
 * 该入口会确保运行态 sandbox 可用，然后把远端 URL 文件下载并写入本地沙箱文件系统。
 */
export const injectSandboxFiles = async ({
  appId,
  userId,
  chatId,
  files,
  agentSandboxRuntime
}: {
  appId: string;
  userId: string;
  chatId: string;
  files: { path: string; url: string }[];
  agentSandboxRuntime?: AgentSandboxRuntimeType;
}) => {
  const instance = await getToolSandboxClient({
    appId,
    userId,
    chatId,
    agentSandboxRuntime
  });
  await instance.ensureAvailable();
  await writeUrlFilesToSandbox(instance.provider, files);
};

/**
 * 获取 sandbox 工具的展示信息。
 *
 * 仅返回全局工具表中已有工具的本地化名称和描述，供 workflow/tool UI 展示使用。
 */
export const getSandboxToolInfo = (name: string, lang: localeType = LangEnum.en) => {
  if (name in sandboxToolMap) {
    const info = sandboxToolMap[name];
    return {
      name: parseI18nString(info.name, lang),
      avatar: info.avatar,
      toolDescription: info.toolDescription
    };
  }
};
