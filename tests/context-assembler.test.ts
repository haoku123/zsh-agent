/**
 * 第 8 课：Context 组装器测试。
 * 覆盖：无记忆退化、记忆注入、注入来源 query、窗口裁剪 truncated。
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '../src/core/context.js'
import { sessionPlugin } from '../src/plugins/session/index.js'
import { memoryPlugin } from '../src/plugins/memory/index.js'
import { contextPlugin } from '../src/plugins/context/index.js'
import type { LLMService } from '../src/plugins/llm/types.js'
import type {} from '../src/plugins/session/types.js'
import type {} from '../src/plugins/context/types.js'

function setup(config: Parameters<typeof contextPlugin>[1] = {}): {
  ctx: Context
  dir: string
} {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-ctx-'))
  const ctx = new Context()
  ctx.plugin(sessionPlugin)
  ctx.plugin(memoryPlugin, { file: path.join(dir, 'memory.json') })
  ctx.plugin(contextPlugin, config)
  return { ctx, dir }
}

describe('context.assemble 组装', () => {
  it('无记忆时退化为 system + history', () => {
    const { ctx } = setup()
    ctx.sessions.push({ type: 'user/message', role: 'user', content: '你好' })
    const out = ctx.context.assemble()
    expect(out.messages).toEqual([
      { role: 'system', content: expect.stringContaining('Agent Harness') },
      { role: 'user', content: '你好' },
    ])
    expect(out.injectedMemory).toEqual([])
    expect(out.truncated).toBe(false)
  })

  it('有相关记忆时注入为 system 消息，插在 system prompt 前面', () => {
    const { ctx } = setup()
    ctx.memory.remember('用户张承琦喜欢喝铁观音茶')
    ctx.sessions.push({ type: 'user/message', role: 'user', content: '用户喜欢喝什么茶' })
    const out = ctx.context.assemble()
    expect(out.injectedMemory).toHaveLength(1)
    expect(out.messages[0]).toEqual({
      role: 'system',
      content: expect.stringContaining('【长期记忆】'),
    })
    expect(out.messages[0]!.content).toContain('铁观音')
    // system prompt 仍在，user 消息在最后
    expect(out.messages.some((m) => m.role === 'system' && m.content.includes('Agent'))).toBe(true)
    expect(out.messages.at(-1)).toEqual({ role: 'user', content: '用户喜欢喝什么茶' })
  })

  it('不相关记忆不注入', () => {
    const { ctx } = setup()
    ctx.memory.remember('项目使用 pnpm 管理依赖')
    ctx.sessions.push({ type: 'user/message', role: 'user', content: '你好' })
    const out = ctx.context.assemble()
    expect(out.injectedMemory).toEqual([])
  })

  it('tool/result 必须投影进上下文（模型看不到工具返回会死循环）', () => {
    const { ctx } = setup()
    ctx.sessions.push({ type: 'user/message', role: 'user', content: '列目录' })
    // 模拟 agent_loop：工具被调用并返回
    ctx.sessions.push({ type: 'tool/call', tool: 'list_dir', args: { path: 'src' } })
    ctx.sessions.push({
      type: 'tool/result',
      tool: 'list_dir',
      result: { entries: [{ name: 'core', type: 'dir' }] },
    })
    const out = ctx.context.assemble()
    const hasToolResult = out.messages.some(
      (m) => m.role === 'user' && m.content.includes('[工具 list_dir 返回]'),
    )
    expect(hasToolResult).toBe(true)
  })

  it('窗口超限时从 history 头部裁剪并置 truncated', () => {
    const { ctx, dir } = setup({ maxChars: 30 })
    ctx.sessions.push({ type: 'user/message', role: 'user', content: 'a'.repeat(50) })
    ctx.sessions.push({ type: 'user/message', role: 'user', content: 'b'.repeat(50) })
    // maxChars 很小，任何一条 history 都会超 → 全部被裁掉
    const out = ctx.context.assemble()
    expect(out.truncated).toBe(true)
    expect(out.messages.filter((m) => m.role === 'user')).toHaveLength(0)
    rmSync(dir, { recursive: true, force: true })
  })

  it('compactIfNeeded 把早期历史压缩成摘要，session 保持完整', async () => {
    const { ctx, dir } = setup({ maxChars: 300, compactThreshold: 0.01 })
    // mock LLM：压缩调用返回固定摘要
    ctx.provide('llm', {
      provider: 'mock',
      model: 'mock',
      chat: async () => ({ content: '项目用 TypeScript + Node.js', toolCalls: [] }),
      chatStream: async () => ({ content: '', toolCalls: [] }),
    } satisfies LLMService)

    for (let i = 1; i <= 4; i++) {
      ctx.sessions.push({ type: 'user/message', role: 'user', content: `问题${i}` })
      ctx.sessions.push({
        type: 'assistant/message',
        role: 'assistant',
        content: `回答${i}：TypeScript 技术栈`,
      })
    }
    const totalBefore = ctx.sessions.length

    await ctx.context.compactIfNeeded()
    const out = ctx.context.assemble()

    // session 不变（append-only 真相源）
    expect(ctx.sessions.length).toBe(totalBefore)
    // 摘要注入为 system 消息
    const hasSummary = out.messages.some(
      (m) => m.role === 'system' && m.content.includes('【历史摘要】'),
    )
    expect(hasSummary).toBe(true)
    // 早期消息被压缩掉，只保留最近
    const texts = out.messages.map((m) => m.content)
    expect(texts.some((t) => t.includes('问题1'))).toBe(false)
    expect(texts.some((t) => t.includes('问题4'))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})
