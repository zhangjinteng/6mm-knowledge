import type { z } from 'zod';
import type { SandboxToolRuntime } from '../service/runtime';

type ToolExecuteContext<P> = {
  appId: string;
  userId: string;
  chatId: string;
  sandboxInstance: SandboxToolRuntime;
  params: P;
};

/**
 * sandbox 工具的声明式定义。
 *
 * zodSchema 负责约束 LLM 工具参数，execute 只接收已校验的 params 和运行态 sandbox client。
 */
export type ToolDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  zodSchema: S;
  execute: (ctx: ToolExecuteContext<z.infer<S>>) => Promise<{ response: string }>;
};

/**
 * 保留工具定义的泛型推导。
 */
export const defineTool = <S extends z.ZodTypeAny>(def: ToolDefinition<S>): ToolDefinition<S> =>
  def;
