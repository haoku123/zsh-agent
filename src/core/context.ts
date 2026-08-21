/**
 * Context —— 微内核。
 *
 * 这是整个 harness 中唯一「非插件」的东西。它同时是三样：
 *   1. 服务容器（空间维度：作用域隔离）
 *   2. 插件挂载器
 *   3. 副作用账本（时间维度：可逆、可热插拔）
 *
 * 设计铁律：注册即副作用。任何注册动作都必须同时登记它的撤销动作。
 */

declare global {
  /**
   * 服务注册表。插件通过声明合并往这里加自己的服务，例如：
   *
   *   declare global {
   *     interface HarnessServices {
   *       tools: ToolRegistry
   *     }
   *   }
   *
   * 注意：declare 只提供类型，不产生任何运行时接线——
   * 插件仍必须自己调用 ctx.provide() 真正注册。
   */
  interface HarnessServices {}

  /**
   * 普通事件（emit / parallel / serial 用）。
   * 插件通过声明合并追加，例如：
   *   interface HarnessEvents {
   *     'session/event': (e: SessionEvent) => void
   *   }
   *
   * internal/* 是内核机制事件，不是业务事件。
   */
  interface HarnessEvents {
    /** 服务刚被注册时触发，用于响应式依赖等待。 */
    'internal/service': (key: string) => void
  }

   /**
   * 环绕中间件（waterfall 用）。监听器签名固定为 (payload, next)。
   * 单独一个命名空间，避免和普通事件混用导致 next 丢失。
   */
  interface HarnessMiddlewares {}
}

export type ServiceKey = keyof HarnessServices & string

export type EventKey = keyof HarnessEvents & string

export type MiddlewareKey = keyof HarnessMiddlewares & string

/** 提取普通事件的参数列表。 */ 
type EventArgs<K extends EventKey> = 
    HarnessEvents[K] extends (...args: infer Args) => unknown ? Args : never

/** 提取普通事件的返回值（serial 用）。 */
type EventResult<K extends EventKey> =
  HarnessEvents[K] extends (...args: never[]) => infer R ? Awaited<R> : never

/** 提取中间件的 payload 类型。 */
type MwPayload<K extends MiddlewareKey> =
  HarnessMiddlewares[K] extends (payload: infer P, next: never) => unknown ? P : never

/** 提取中间件的返回值类型（可以是 Promise）。 */
type MwResult<K extends MiddlewareKey> =
  HarnessMiddlewares[K] extends (...args: never[]) => infer R ? R : never

/** 副作用的撤销函数。 */
export type Disposer = () => void

/** 插件的对象形态。 */
export interface PluginObject<C = void> {
  /** 插件名，用于日志与错误提示。 */
  name?: string
  /** 声明依赖的服务；未就绪时挂载会报错。 */
  inject?: readonly ServiceKey[]
  apply(ctx: Context, config: C): void
}

/** 插件的函数形态。 */
export interface PluginFunction<C = void> {
  (ctx: Context, config: C): void
  inject?: readonly ServiceKey[]
}

export type Plugin<C = void> = PluginObject<C> | PluginFunction<C>

/** 让 ctx.xxx 能直接访问已声明的服务（与下面的 class 同名合并）。 */
export interface Context extends HarnessServices {}

export class Context {
  /** 父作用域；根为 null。 */
  _parent: Context | null = null
  /** 作用域名称，仅用于诊断。 */
  _name: string
  /** 副作用账本，dispose 时逆序执行。 */
  _disposers: Disposer[] = []
  /** 子作用域，父级 dispose 时级联。 */
  _children: Context[] = []
  /** 本层自己注册的服务键（不含继承来的）。 */
  _own: Set<string> = new Set()
  _disposed = false

  /** 普通事件监听器表。只有根作用域的这份有效。 */
  _listeners: Map<string, unknown[]> = new Map()

  /** 中间件表。同上。 */
  _middlewares: Map<string, unknown[]> = new Map()

  constructor(name = 'root') {
    this._name = name
  }

  // ==================== 服务：空间维度 ====================

  /** 根作用域。服务默认注册到这里，从而全局可见。 */
  get _root(): Context {
    let node: Context = this
    while (node._parent) node = node._parent
    return node
  }

  /**
   * 注册服务，全局可见。
   *
   * 注意这里的不对称，它是整个机制的核心：
   *   - 服务「值」写到根作用域   → 所有插件（包括兄弟）都能拿到
   *   - 「撤销」记在当前插件账本 → 插件一卸载，服务立刻消失
   */
  provide<K extends ServiceKey>(key: K, value: HarnessServices[K]): void {
    this.assertAlive()
    const target = this._root
    // key in target 会检查整条原型链，也能挡住与内核成员同名的情况
    if (key in target) {
      throw new Error(
        `[${this._name}] 服务 "${key}" 已存在（或与内核成员冲突），不允许重复注册`,
      )
    }
    this.define(target, key, value)
    // 广播：某个服务刚注册。响应式依赖（inject）靠它感知依赖就绪。
    this.emit('internal/service', key)
  }

  /**
   * 只在「当前作用域及其子级」注册服务，遮蔽父级的同名服务。
   *
   * 用于给子 Agent 一套裁剪过的能力集（对应 dsh 的 isolate realm）。
   */
  isolate<K extends ServiceKey>(key: K, value: HarnessServices[K]): void {
    this.assertAlive()
    if (Object.hasOwn(this, key)) {
      throw new Error(`[${this._name}] 本作用域已隔离注册过 "${key}"`)
    }
    this.define(this, key, value)
  }

  private define(target: Context, key: ServiceKey, value: unknown): void {
    Object.defineProperty(target, key, {
      value,
      configurable: true, // 必须可配置，否则 dispose 时删不掉
      enumerable: true,
      writable: false,
    })
    this._own.add(key)
    this.effect(() => {
      delete (target as unknown as Record<string, unknown>)[key]
      this._own.delete(key)
    })
  }

  /** 服务是否可用（含继承）。 */
  has(key: string): boolean {
    return key in this
  }

  // ==================== 插件：时间维度 ====================

  /**
   * 挂载插件，返回它的作用域。
   * 对返回值调用 dispose() 只会卸载这一个插件及其子树。
   */
  plugin<C>(plug: Plugin<C>, config: C): Context
  plugin(plug: Plugin<void>): Context
  plugin<C>(plug: Plugin<C>, config?: C): Context {
    this.assertAlive()

    const name =
      (typeof plug === 'function' ? plug.name : plug.name) || 'anonymous'

    // 依赖检查：inject 声明的服务必须已就绪
    for (const dep of plug.inject ?? []) {
      if (!this.has(dep)) {
        throw new Error(
          `插件 "${name}" 依赖服务 "${dep}"，但它尚未注册（检查挂载顺序）`,
        )
      }
    }

    const scope = this.derive(name)
    try {
      if (typeof plug === 'function') {
        plug(scope, config as C)
      } else {
        plug.apply(scope, config as C)
      }
    } catch (err) {
      // 挂载失败必须回滚，不能留下半初始化的作用域
      scope.dispose()
      throw err
    }
    return scope
  }

  /** 派生子作用域。用原型链继承，故服务查找天然向上追溯。 */
  private derive(name: string): Context {
    const scope = Object.create(this) as Context
    scope._parent = this
    scope._name = name
    // 关键：每个作用域必须持有自己的账本，否则会误删父级的东西
    scope._disposers = []
    scope._children = []
    scope._own = new Set()
    scope._disposed = false
    this._children.push(scope)
    return scope
  }

  //======================= 事件 ========================
  on<K extends EventKey>(
    name: K,
    listener: HarnessEvents[K],
    option: { prepend?: boolean } = {},
  ): Disposer {
    return this.addListener(this._root._listeners, name, listener, option)
  }

  use<K extends MiddlewareKey>(
    name: K,
    middleware: HarnessMiddlewares[K],
    option: { prepend?: boolean } = {},
  ): Disposer {
    return this.addListener(this._root._middlewares, name, middleware, option)
  }

  private addListener(
    table: Map<string, unknown[]>,
    name: string,
    fn: unknown,
    options: { prepend?: boolean },
  ): Disposer {
    this.assertAlive()
    let list = table.get(name)
    if (!list) table.set(name, (list = []))
    if (options.prepend) list.unshift(fn)
    else list.push(fn)
    return this.effect(() => {
      const i = list.indexOf(fn)
      if (i >= 0) list.splice(i, 1)
    })
  }

  /** 取监听器快照。快照很关键：分发途中若有插件装卸，不会打乱本次遍历。 */
  private snapshot(table: Map<string, unknown[]>, name: string): unknown[] {
    return [...(table.get(name) ?? [])]
  }

  /** 同步广播，不等待、无返回值。 */
  emit<K extends EventKey>(name: K, ...args: EventArgs<K>): void {
    for (const fn of this.snapshot(this._root._listeners, name)) {
      try {
        ;(fn as (...a: EventArgs<K>) => unknown)(...args)
      } catch (err) {
        // 一个监听器炸了不能影响其他监听器（正交结果独立报告）
        console.error(`[emit ${name}] 监听器出错:`, err)
      }
    }
  }

  /** 并行广播，等全部完成。单个失败不影响其他。 */
  async parallel<K extends EventKey>(name: K, ...args: EventArgs<K>): Promise<void> {
    const results = await Promise.allSettled(
      this.snapshot(this._root._listeners, name).map((fn) =>
        (fn as (...a: EventArgs<K>) => unknown)(...args),
      ),
    )
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error(`[parallel ${name}] 监听器出错:`, r.reason)
      }
    }
  }

  /** 串行分发，返回第一个非 undefined 的结果（拿到就停）。 */
  async serial<K extends EventKey>(
    name: K,
    ...args: EventArgs<K>
  ): Promise<EventResult<K> | undefined> {
    for (const fn of this.snapshot(this._root._listeners, name)) {
      const result = await (fn as (...a: EventArgs<K>) => unknown)(...args)
      if (result !== undefined) return result as EventResult<K>
    }
    return undefined
  }

  /**
   * 环绕中间件分发。
   *
   * terminal 是洋葱最内层——真正干活的那个（比如工具本体）。
   * 监听器不调 next() 即为短路，terminal 不会执行。
   */
  waterfall<K extends MiddlewareKey>(
    name: K,
    payload: MwPayload<K>,
    terminal: () => MwResult<K>,
  ): MwResult<K> {
    const chain = this.snapshot(this._root._middlewares, name)
    let index = 0
    const next = (): MwResult<K> => {
      const fn = chain[index++]
      if (!fn) return terminal()
      return (fn as (p: MwPayload<K>, n: () => MwResult<K>) => MwResult<K>)(payload, next)
    }
    return next()
  }
  // ==================== 副作用回收 ====================

  /**
   * 登记一个副作用的撤销函数。
   *
   * 若卸载有顺序要求，把相关工作放进同一个 effect，以保证释放顺序。
   */
  effect(disposer: Disposer): Disposer {
    this.assertAlive()
    this._disposers.push(disposer)
    // 返回它本身，方便调用方提前手动撤销
    return disposer
  }

  /** 卸载：先级联子作用域，再逆序撤销自己的副作用。 */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true

    // 子级先拆，因为它们可能引用父级的服务
    for (const child of [...this._children].reverse()) {
      child.dispose()
    }
    this._children.length = 0

    // 逆序：后注册的可能依赖先注册的
    for (const disposer of [...this._disposers].reverse()) {
      try {
        disposer()
      } catch (err) {
        // 铁律：空 catch 必须命名所吞之物
        console.error(`[dispose] ${this._name} 撤销副作用失败:`, err)
      }
    }
    this._disposers.length = 0

    if (this._parent) {
      const siblings = this._parent._children
      const i = siblings.indexOf(this)
      if (i >= 0) siblings.splice(i, 1)
    }
  }

  private assertAlive(): void {
    if (this._disposed) {
      throw new Error(`[${this._name}] 作用域已卸载，不能再操作`)
    }
  }

  //当deps列出的服务全部就绪后才执行callback
  inject(deps: readonly ServiceKey[], callback: (ctx: Context) => void): Disposer {
    this.assertAlive()
    let active = false

    let scope: Context | null = null

    const check = () => {
      const ready = deps.every((key) => this.has(key))
      if (ready && !active) {
        active = true
        scope = this.derive('inject')
        callback(scope)
      }else if (!ready && active){
        active = false
        if (scope) {
          scope.dispose()
          scope = null
        }
      }
    }

    check()

    const disposer = this.on('internal/service', check)
    return this.effect(() => {
      disposer()
      if (scope) {
        scope.dispose()
        scope = null
      }
    })
  }

  /** 打印插件树，调试用。 */
  inspect(depth = 0): string {
    const pad = '  '.repeat(depth)
    const own = this._own.size ? ` provides=[${[...this._own].join(', ')}]` : ''
    const lines = [`${pad}${this._name}${own}`]
    for (const child of this._children) {
      lines.push(child.inspect(depth + 1))
    }
    return lines.join('\n')
  }
}
