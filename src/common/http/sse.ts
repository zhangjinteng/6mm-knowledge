import type { FastifyReply } from 'fastify';

export type SseEvent = {
  event?: string;
  id?: string;
  data: unknown;
};

export type SseStream = {
  writeEvent: (event: SseEvent) => void;
  close: () => void;
};

/**
 * 创建 SSE 写入器，后续 chat/workflow 流式输出统一走这里封装响应头和事件格式。
 */
export function createSseStream(reply: FastifyReply): SseStream {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  return {
    writeEvent(event) {
      if (event.id) {
        reply.raw.write(`id: ${event.id}\n`);
      }

      if (event.event) {
        reply.raw.write(`event: ${event.event}\n`);
      }

      reply.raw.write(`data: ${JSON.stringify(event.data)}\n\n`);
    },
    close() {
      reply.raw.end();
    }
  };
}
