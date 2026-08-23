/**
 * 第 4 课：Tools 测试。
 * 覆盖：注册/取用/排序、重复注册报错、执行走守卫流水线、守卫短路与改写。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '../src/core/context.js'
import { toolsPlugin } from '../src/plugins/tools/index.js'
import type { Tool } from '../src/plugins/tools/types.js'
import type {} from '../src/plugins/tools/types.js'

function setup(): { ctx: Context } {
  const ctx = new Context()
  ctx.plugin(toolsPlugin)
  return { ctx }
}

function fakeTool(name: string, result: unknown): Tool {
  return {
    name,
    description: `工具 ${name}`,
    schema: { type: 'object', properties: {} },
    execute: () => result,
  }
}

describe('ToolRegistry 注册与取用', () => {
  it('register 后可通过 get / list 访问，list 按名称排序', () => {
    const { ctx } = setup()
    ctx.tools.register(fakeTool('b_tool', 1))
    ctx.tools.register(fakeTool('a_tool', 2))
    expect(ctx.tools.get('a_tool')).toBeDefined()
    expect(ctx.tools.list().map((t) => t.name)).toEqual(['a_tool', 'b_tool'])
  })

  it('重复注册同名工具抛错', () => {
    const { ctx } = setup()
    ctx.tools.register(fakeTool('dup', 1))
    expect(() => ctx.tools.register(fakeTool('dup', 2))).toThrow(/already registered/)
  })

  it('注册即副作用：卸载 toolsPlugin 后服务与工具一起消失', () => {
    const ctx = new Context()
    const scope = ctx.plugin(toolsPlugin)
    ctx.tools.register(fakeTool('temp', 1))
    expect(ctx.tools.list()).toHaveLength(1)
    scope.dispose()
    // register 的清理 effect 记在 toolsPlugin 作用域上（闭包捕获），
    // 卸载时逆序执行：先删工具、再删服务 → ctx.tools 整个消失
    expect((ctx as unknown as { tools?: unknown }).tools).toBeUndefined()
  })
})

describe('execute 守卫流水线', () => {
  it('execute 调用工具本体并返回结果', async () => {
    const { ctx } = setup()
    ctx.tools.register(fakeTool('echo', 'hello'))
    expect(await ctx.tools.execute('echo', {})).toBe('hello')
  })

  it('执行不存在的工具抛错', async () => {
    const { ctx } = setup()
    await expect(ctx.tools.execute('nope', {})).rejects.toThrow(/not found/)
  })

  it('守卫返回对象即短路，工具不执行', async () => {
    const { ctx } = setup()
    ctx.tools.register(fakeTool('blocked', 'never'))
    ctx.use('tools/execute', (req) => {
      if (req.name === 'blocked') return { error: '危险命令被拦截' }
      // 注意：不调用 next 即为短路
      return undefined
    })
    const result = await ctx.tools.execute('blocked', {})
    expect(result).toEqual({ error: '危险命令被拦截' })
  })

  it('守卫可通过 next 放行并拿到返回值', async () => {
    const { ctx } = setup()
    ctx.tools.register(fakeTool('ok', 'good'))
    ctx.use('tools/execute', (_req, next) => ({ guarded: next() }))
    expect(await ctx.tools.execute('ok', {})).toEqual({ guarded: 'good' })
  })
})
