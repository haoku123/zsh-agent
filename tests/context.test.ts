/**
 * 第 1-2 课：Context 微内核测试。
 * 覆盖：服务注册/隔离、副作用回收、事件、waterfall 守卫、inject、dispose 级联。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '../src/core/context.js'
// import 类型声明，让 HarnessServices 合并生效（declare global）
import type {} from '../src/plugins/session/types.js'

// 测试里用到的临时服务键，声明进 HarnessServices 以便通过类型检查
declare global {
  interface HarnessServices {
    greeter: { hello(): string }
    secret: string
    svc: string
    x: number
    a: number
    fromA: number
    fromB: number
  }
}

describe('Context 服务容器', () => {
  it('provide 注册的服务可通过 ctx.xxx 访问', () => {
    const ctx = new Context()
    ctx.provide('greeter', { hello: () => 'hi' })
    expect((ctx as unknown as { greeter: { hello: () => string } }).greeter.hello()).toBe('hi')
  })

  it('重复注册同名服务抛错', () => {
    const ctx = new Context()
    ctx.provide('a', 1)
    expect(() => ctx.provide('a', 2)).toThrow(/已存在/)
  })

  it('isolate 只在本作用域及子级可见', () => {
    const ctx = new Context()
    ctx.isolate('secret', 'x')
    const child = ctx.plugin((scope: Context) => {
      expect((scope as unknown as { secret: string }).secret).toBe('x')
    })
    expect(child).toBeDefined()
  })
})

describe('Context 副作用回收', () => {
  it('dispose 后服务被移除，且不能再操作', () => {
    const ctx = new Context()
    ctx.provide('svc', 'v')
    expect((ctx as unknown as { svc: string }).svc).toBe('v')
    ctx.dispose()
    expect((ctx as unknown as { svc?: string }).svc).toBeUndefined()
    expect(() => ctx.provide('x', 1)).toThrow(/已卸载/)
  })

  it('插件卸载只撤销自己的副作用，兄弟服务不受影响', () => {
    const root = new Context()
    const scopeA = root.plugin((ctx: Context) => {
      ctx.provide('fromA', 1)
    })
    // scopeB 里注册 fromB（挂在 scopeB 上，但 provide 写到 root）
    root.plugin((ctx: Context) => {
      ctx.provide('fromB', 2)
    })
    expect((root as unknown as { fromA: number }).fromA).toBe(1)
    expect((root as unknown as { fromB: number }).fromB).toBe(2)
    scopeA.dispose()
    expect((root as unknown as { fromA?: number }).fromA).toBeUndefined()
    // B 的服务还在
    expect((root as unknown as { fromB: number }).fromB).toBe(2)
  })

  it('effect 登记的撤销函数在 dispose 时执行', () => {
    const ctx = new Context()
    let cleaned = 0
    ctx.effect(() => {
      cleaned++
    })
    expect(cleaned).toBe(0)
    ctx.dispose()
    expect(cleaned).toBe(1)
  })
})

describe('Context 事件与中间件', () => {
  it('on/emit 同步广播', () => {
    const ctx = new Context()
    const seen: number[] = []
    ctx.on('internal/service', (k) => seen.push(k.length))
    ctx.emit('internal/service', 'abc')
    expect(seen).toEqual([3])
  })

  it('on 返回的 disposer 可提前撤销监听', () => {
    const ctx = new Context()
    const seen: string[] = []
    const off = ctx.on('internal/service', (k) => seen.push(k))
    ctx.emit('internal/service', 'a')
    off()
    ctx.emit('internal/service', 'b')
    expect(seen).toEqual(['a'])
  })

  it('waterfall 中间件不调 next 即短路，terminal 不执行', () => {
    const ctx = new Context()
    let ran = false
    const disposer = ctx.use('tools/execute', () => ({ error: 'blocked' }))
    const result = ctx.waterfall(
      'tools/execute',
      { name: 'x', args: {} },
      () => {
        ran = true
        return 'ok'
      },
    )
    expect(result).toEqual({ error: 'blocked' })
    expect(ran).toBe(false)
    disposer()
    // 撤销后恢复原行为
    const result2 = ctx.waterfall('tools/execute', { name: 'x', args: {} }, () => 'ok')
    expect(result2).toBe('ok')
  })

  it('waterfall 洋葱：中间件可包住 terminal 并拿到返回值', () => {
    const ctx = new Context()
    ctx.use('tools/execute', (req, next) => {
      const r = next()
      return { wrapped: r, name: req.name }
    })
    const result = ctx.waterfall('tools/execute', { name: 't', args: {} }, () => 'done')
    expect(result).toEqual({ wrapped: 'done', name: 't' })
  })
})

describe('Context inject 依赖', () => {
  it('依赖就绪后才执行 callback', () => {
    const ctx = new Context()
    let ran = false
    ctx.inject(['sessions'], () => {
      ran = true
    })
    // sessions 未注册，不应执行
    expect(ran).toBe(false)
    ctx.provide('sessions', {} as never)
    expect(ran).toBe(true)
  })
})

describe('Context dispose 级联', () => {
  it('父级 dispose 级联卸载子作用域', () => {
    const ctx = new Context()
    let childCleaned = 0
    ctx.plugin((scope: Context) => {
      scope.effect(() => {
        childCleaned++
      })
    })
    expect(childCleaned).toBe(0)
    ctx.dispose()
    expect(childCleaned).toBe(1)
  })
})
