/**
 * Session 插件入口。
 *
 * 组装 log（存储）+ 投影（deriveMessages），provide 成 ctx.sessions，
 * 并在 push 时广播 'session/event'。
 */
import type { Context } from '../../core/context.js'
import { SessionLog } from './log.js'
import type { DerivedMessage, SessionEvent, SessionEventType, SessionService } from './types.js'

export function sessionPlugin(ctx: Context): void {
  const log = new SessionLog()

  const service: SessionService = {
    push<T extends { type: SessionEventType }>(e: T): SessionEvent {
      const entry = log.push(e)
      // 通知 UI 等监听者：来了一条新事件
      ctx.emit('session/event', entry)
      return entry
    },
    all() {
      return log.all()
    },
    before(boundaryId: number) {
      return log.before(boundaryId)
    },
    deriveMessages(): DerivedMessage[] {
      // 投影：只取 user/assistant 消息，按 id 排序，转成 LLM 格式
      return log
        .all()
        .filter((e) => e.type === 'user/message' || e.type === 'assistant/message')
        .map((e) => {
          const p = e.payload as { role: 'user' | 'assistant'; content: string }
          return { role: p.role, content: p.content }
        })
    },
    get length() {
      return log.length
    },
  }

  ctx.provide('sessions', service)
}
