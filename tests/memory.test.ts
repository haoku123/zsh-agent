/**
 * 第 8 课：Memory 测试。
 * 覆盖：写入/持久化、精确召回、bigram 中文模糊召回、importance 排序、
 *      limit、LRU 更新、forget、namespace 过滤、跨实例持久化。
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '../src/core/context.js'
import { memoryPlugin } from '../src/plugins/memory/index.js'
import type {} from '../src/plugins/memory/types.js'

/** 每个测试用独立临时目录，互不污染。 */
function setup(): { ctx: Context; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-memory-'))
  const ctx = new Context()
  ctx.plugin(memoryPlugin, { file: path.join(dir, 'memory.json') })
  return { ctx, dir }
}

describe('Memory remember / list', () => {
  it('remember 生成唯一 id，默认 namespace 为 default', () => {
    const { ctx, dir } = setup()
    const e1 = ctx.memory.remember('记忆A')
    const e2 = ctx.memory.remember('记忆B')
    expect(e1.id).not.toBe(e2.id)
    expect(e1.namespace).toBe('default')
    // 已落盘
    rmSync(dir, { recursive: true, force: true })
  })

  it('list 可按 namespace 过滤', () => {
    const { ctx } = setup()
    ctx.memory.remember('a', { namespace: 'profile' })
    ctx.memory.remember('b')
    expect(ctx.memory.list('profile')).toHaveLength(1)
    expect(ctx.memory.list()).toHaveLength(2)
  })

  it('forget 删除记忆', () => {
    const { ctx } = setup()
    const e = ctx.memory.remember('要删的')
    expect(ctx.memory.list()).toHaveLength(1)
    ctx.memory.forget(e.id)
    expect(ctx.memory.list()).toHaveLength(0)
  })
})

describe('Memory recall 检索', () => {
  it('精确词命中 content', () => {
    const { ctx } = setup()
    ctx.memory.remember('项目使用 pnpm 管理依赖')
    const hits = ctx.memory.recall('pnpm')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.content).toBe('项目使用 pnpm 管理依赖')
  })

  it('中文整句通过 bigram 模糊召回', () => {
    const { ctx } = setup()
    ctx.memory.remember('用户张承琦喜欢喝铁观音茶')
    // 改前：整句子串不匹配、分词切不出 → 召回 0 条
    const hits = ctx.memory.recall('用户喜欢喝什么茶')
    expect(hits).toHaveLength(1)
  })

  it('不相关的 query 不召回', () => {
    const { ctx } = setup()
    ctx.memory.remember('项目使用 pnpm 管理依赖')
    const hits = ctx.memory.recall('今天天气怎么样')
    expect(hits).toHaveLength(0)
  })

  it('importance 高的记忆排在前面', () => {
    const { ctx } = setup()
    ctx.memory.remember('用户喜欢喝茶', { importance: 0.9 })
    ctx.memory.remember('用户喜欢喝咖啡', { importance: 0.1 })
    const hits = ctx.memory.recall('用户喜欢')
    expect(hits[0]!.content).toBe('用户喜欢喝茶')
  })

  it('limit 限制返回条数', () => {
    const { ctx } = setup()
    ctx.memory.remember('用户喜欢喝茶')
    ctx.memory.remember('用户喜欢喝咖啡')
    ctx.memory.remember('用户喜欢喝白水')
    expect(ctx.memory.recall('用户喜欢', 2)).toHaveLength(2)
  })

  it('命中后更新 lastAccessedAt（LRU）', () => {
    const { ctx } = setup()
    const e = ctx.memory.remember('重要记忆')
    // FileMemoryStore.put 存的是引用，可直接改
    e.lastAccessedAt = 0
    ctx.memory.recall('重要记忆')
    expect(e.lastAccessedAt).toBeGreaterThan(0)
  })
})

describe('Memory 持久化', () => {
  it('新实例能读回上次写入的记忆（跨会话）', () => {
    const { ctx, dir } = setup()
    const file = path.join(dir, 'memory.json')
    ctx.memory.remember('用户张承琦喜欢喝铁观音茶')
    // 模拟重启：新 Context + 同一个文件
    const ctx2 = new Context()
    ctx2.plugin(memoryPlugin, { file })
    expect(ctx2.memory.list()).toHaveLength(1)
    expect(ctx2.memory.list()[0]!.content).toBe('用户张承琦喜欢喝铁观音茶')
    rmSync(dir, { recursive: true, force: true })
  })
})
