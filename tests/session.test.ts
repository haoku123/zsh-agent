/**
 * 第 3 课：Session 测试。
 * 覆盖：append-only 日志、深拷贝防篡改、before 边界、投影、clear。
 */
import { describe, expect, it } from 'vitest'
import { SessionLog } from '../src/plugins/session/log.js'
import { sessionPlugin } from '../src/plugins/session/index.js'
import { userMessage, assistantMessage, toolResult } from '../src/plugins/session/event.js'
import { Context } from '../src/core/context.js'
import type {} from '../src/plugins/session/types.js'

describe('SessionLog 存储核心', () => {
  it('push 返回带自增 id 和时间戳的条目', () => {
    const log = new SessionLog()
    const e1 = log.push({ type: 'user/message', role: 'user', content: 'a' })
    const e2 = log.push({ type: 'user/message', role: 'user', content: 'b' })
    expect(e1.id).toBe(0)
    expect(e2.id).toBe(1)
    expect(e2.timestamp).toBeGreaterThanOrEqual(e1.timestamp)
  })

  it('all() 返回深拷贝，外部修改不影响日志', () => {
    const log = new SessionLog()
    log.push({ type: 'user/message', role: 'user', content: 'a' })
    const snapshot = log.all()
    ;(snapshot[0]!.payload as { content: string }).content = '篡改'
    expect(log.all()[0]!.payload).toEqual({ type: 'user/message', role: 'user', content: 'a' })
  })

  it('before(boundaryId) 取 id <= boundaryId 的条目', () => {
    const log = new SessionLog()
    log.push({ type: 'user/message', role: 'user', content: 'a' })
    log.push({ type: 'assistant/message', role: 'assistant', content: 'b' })
    log.push({ type: 'user/message', role: 'user', content: 'c' })
    const before = log.before(1)
    expect(before.map((e) => e.id)).toEqual([0, 1])
  })

  it('clear 清空日志且 id 重新从 0 开始', () => {
    const log = new SessionLog()
    log.push({ type: 'user/message', role: 'user', content: 'a' })
    log.clear()
    expect(log.length).toBe(0)
    const e = log.push({ type: 'user/message', role: 'user', content: 'b' })
    expect(e.id).toBe(0)
  })
})

describe('sessionPlugin 服务', () => {
  function setup(): { ctx: Context } {
    const ctx = new Context()
    ctx.plugin(sessionPlugin)
    return { ctx }
  }

  it('deriveMessages 只投影 user/assistant，忽略 tool 事件', () => {
    const { ctx } = setup()
    ctx.sessions.push(userMessage('你好'))
    ctx.sessions.push(toolResult('grep', { matchCount: 3 }))
    ctx.sessions.push(assistantMessage('收到'))
    const messages = ctx.sessions.deriveMessages()
    expect(messages).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '收到' },
    ])
  })

  it('push 广播 session/event 事件', () => {
    const { ctx } = setup()
    const seen: string[] = []
    const off = ctx.on('session/event', (e) => seen.push(e.type))
    ctx.sessions.push(userMessage('hi'))
    off()
    expect(seen).toEqual(['user/message'])
  })

  it('clear 清空会话后 deriveMessages 返回空', () => {
    const { ctx } = setup()
    ctx.sessions.push(userMessage('hi'))
    ctx.sessions.clear()
    expect(ctx.sessions.deriveMessages()).toEqual([])
    expect(ctx.sessions.length).toBe(0)
  })
})
