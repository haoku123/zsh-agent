/**
 * Session 插件入口。
 *
 * 组装 log（存储 + JSONL 持久化）+ 投影（deriveMessages），provide 成 ctx.sessions，
 * 并在 push 时广播 'session/event'。
 *
 * 可选配置 { file }：启用 JSONL 落盘（重启后恢复历史）。
 */
import type { Context } from '../../core/context.js'
import { SessionLog } from './log.js'
import type { DerivedMessage, SessionEvent, SessionEventType, SessionService } from './types.js'

export function sessionPlugin(ctx: Context, config: { file?: string } = {}): void {
  const log = new SessionLog()
  if (config.file) {
    log.enablePersistence(config.file)
  }

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
    clear() {
      log.clear()
    },
    get length() {
      return log.length
    },
  }

  ctx.provide('sessions', service)

  // 恢复历史后广播一次（让 REPL/TUI/SSE 订阅者知道已有会话内容）
  for (const e of log.all()) {
    ctx.emit('session/event', e)
  }
}
