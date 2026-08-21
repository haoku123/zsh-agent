# `context.ts` 逐行解读

> 这篇文档把 `src/core/context.ts` 从整体到细节讲透。
> 读法建议：先看「整体印象」，再看「为什么这么设计」，最后带着问题回代码里对照。

---

## 一、整体印象：Context 是个「容器王国」

想象 `Context` 是一个**独立的"小王国"**。`new Context('root')` 就建了一个王国。王国里能住三种"居民"：

| 居民 | 代码 | 比喻 |
|---|---|---|
| **服务** | `ctx.provide('llm', ...)` | 王国里的**公共设施**（发电厂、水厂），谁都能用 |
| **监听器/中间件** | `ctx.on()` / `ctx.use()` | 王国里的**信箱和关卡**，有事件来就触发 |
| **子插件** | `ctx.plugin(...)` | 王国里再**划一块飞地**，有独立的镇长 |

整个文件的核心，就是在管理"**怎么住人、怎么拆房、什么时候能进**"。

---

## 二、类型声明（1~86 行）：给王国画「设计图」

```ts
declare global {
  interface HarnessServices {}       // 服务长什么样
  interface HarnessEvents {}         // 事件长什么样
  interface HarnessMiddlewares {}    // 中间件长什么样
}
```

**这里全是"空壳"**。因为 `Context` 是通用的，它不知道你的项目里会有哪些服务/事件。所以留了三个**空接口**，等**你的插件去填**（声明合并）。

在 `main.ts` 里写：

```ts
declare global {
  interface HarnessMiddlewares {
    'demo/execute': (req: {cmd:string}, next: () => string) => string
  }
}
```

这一写，`ctx.waterfall('demo/execute', ...)` 就**自动有类型提示**了。

> **关键认知**：`declare` 只是告诉 TS"有这么个类型"，**不产生任何运行时代码**。运行时靠的是后面 class 里的实际方法。

`export type ServiceKey = keyof HarnessServices & string` —— 把接口的键（`'llm'`、`'tools'`）变成类型。`& string` 是为了让 TS 接受字符串字面量。

后面几个 `type EventArgs<K> = ...` 是用 `infer` 从事件签名里**抽出参数/返回值类型**，给 `emit`/`serial` 用。

---

## 三、字段（88~109 行）：王国的「户口本和账本」

```ts
_parent: Context | null          // 我爹是谁（根是 null）
_name: string                    // 我叫啥（诊断用）
_disposers: Disposer[]           // 我的"待办清理清单"（副作用账本）
_children: Context[]             // 我管着哪些子王国
_own: Set<string>                // 我这层注册了哪些服务（不含继承来的）
_disposed: boolean               // 我是不是已经拆了
_listeners: Map<string, unknown[]>   // 普通事件表
_middlewares: Map<string, unknown[]> // 中间件表
```

最关键的是 `_disposers` —— 一份"**承诺清单**"：每次登记一个东西，就同时往这里记一句"拆的时候要把它删掉"。

**为什么重要？** 因为 harness 的杀手锏是**能干净地卸载插件**（热重载、隔离）。没有这份清单，插件拆了但东西还在，就成了"幽灵"。

---

## 四、`_root` 和 `provide` / `isolate`（113~169 行）：公共服务怎么存

### `get _root()`

```ts
get _root(): Context {
  let node = this
  while (node._parent) node = node._parent   // 一直往上找，直到没爹
  return node
}
```

**向上爬到最顶层，返回根王国。** 因为 `new Context()` 只有 root 没爹，所以 `_root` 就是它。

### `provide(key, value)` —— 建公共设施

```ts
provide(key, value) {
  const target = this._root          // 存到根（全局）
  this.define(target, key, value)    // 真正去写
}
```

**服务统一存到根王国**。插件A 提供 `greeter`，插件B 用 `ctx.greeter` 也能拿到（B 往上找，找到根）。→ **服务全局共享**。

### `isolate(key, value)` —— 在自家建，不让外面知道

```ts
isolate(key, value) {
  if (Object.hasOwn(this, key)) throw ...
  this.define(this, key, value)      // 存到"自己"而不是 root
}
```

**存到当前王国**，而不是根。只有"自己和自己的子孙"能看到。→ **作用域隔离**（给子 Agent 裁剪能力用）。

### `define` —— 真正落笔 + 记账（整个文件最精妙的一行设计）

```ts
private define(target, key, value) {
  Object.defineProperty(target, key, { value, configurable: true, ... })
  //               ↑ 把 key 这个属性，动态挂到 target 这个对象上
  //                 configurable:true 是为了以后能 delete 删掉
  this._own.add(key)                 // 记：我注册了 key
  this.effect(() => {                // 记：拆的时候要……
    delete target[key]               // ……把 key 删掉
    this._own.delete(key)
  })
}
```

它做了两件事：
1. `Object.defineProperty(target, key, {...})` → 给 target **动态加一个属性**。所以 `ctx.greeter` 能直接用，不是硬编码在 class 里的。
2. `this.effect(清理函数)` → 把"删掉它"这个动作**记进当前插件的账本**。

**这就是"注册即副作用"的完整实现**：加属性（副作用）和删属性（清理）是**成对绑定**的，由同一个 `effect` 登记。

### `has(key)`

```ts
return key in this
```

`in` 会**沿原型链一直找**，所以"有没有这个服务"包括继承来的。

---

## 五、`plugin` / `derive`（173~221 行）：怎么挂插件

### `plugin(plug, config)` —— 挂一个插件

```ts
plugin(plug, config) {
  // ① 检查依赖
  for (const dep of plug.inject ?? []) {
    if (!this.has(dep)) throw Error(`依赖 ${dep} 未就绪`)
  }
  // ② 派生子作用域
  const scope = this.derive(name)
  // ③ 执行插件本体
  try { plug(scope, config) }
  catch (err) { scope.dispose(); throw err }   // 挂了就回滚
  return scope
}
```

三步：**查依赖 → 给插件划一块飞地 → 让插件在自己的飞地里干活**。出错了把飞地整个拆掉（避免留半截）。

### `derive(name)` —— 划飞地

```ts
private derive(name) {
  const scope = Object.create(this) as Context   // 以 this 为原型造新对象
  scope._parent = this                           // 认 this 当爹
  // 关键：每个飞地要有自己的账本，否则会误删爹的东西
  scope._disposers = []
  scope._children = []
  scope._own = new Set()
  this._children.push(scope)
  return scope
}
```

**`Object.create(this)` 是精髓**。它让新王国 `scope` **继承**父王国的所有东西：

- **服务查找自动向上**：`scope.greeter` → 自己身上没有 → 沿原型链找到 root 的 `greeter`。**不用写循环查找！**
- **账本独立**：`scope._disposers = []` 重设成空的。所以插件在飞地里登记的东西，只记在**飞地自己的账本**，拆飞地不影响父级。

> 一句话：**用 JS 原型链天然实现了"向上找爹、拆自己的房"**。服务全局共享、副作用各自独立，两者毫不冲突。

---

## 六、事件（223~314 行）：王国的「信箱系统」

```ts
on(name, listener)  → 往 _listeners 表里存      // 我订阅这个事件
use(name, mw)       → 往 _middlewares 表里存     // 我拦这个动作
emit(name, ...args) → 从 _listeners 取所有，挨个调  // 广播
waterfall(name, payload, terminal) → 从 _middlewares 取，套洋葱  // 拦截链
```

存储和调用都走 `_root`（全局），所以**任何插件 emit，所有插件都能收到**。

`addListener` / `snapshot` 是私有辅助：`addListener` 存进表 + 记账，`snapshot` 拷贝一份（防止遍历时被改）。

`emit` 里 `try/catch`：一个监听器炸了不拖累别人（**正交结果独立报告**）。

`waterfall` 是"环绕中间件"：不调 `next()` 即短路（权限拦截的核心）。

---

## 七、`effect` / `dispose` / `assertAlive`（322~369 行）：拆房

### `effect(disposer)`

```ts
effect(disposer) {
  this._disposers.push(disposer)   // 往账本里记一笔
  return disposer
}
```

所有登记动作（provide、on、use、plugin 子级）最后都调它，把"清理动作"存进账本。

### `dispose()` —— 拆房，倒着拆

```ts
dispose() {
  // ① 先拆子孙（它们可能引用爹的服务）
  for (const child of [...this._children].reverse()) child.dispose()
  // ② 再逆序执行自己的清理清单（后注册的先拆）
  for (const disposer of [...this._disposers].reverse()) {
    try { disposer() } catch (err) { console.error(...) }
  }
}
```

**顺序为什么重要**：就像拆积木塔，得**从上往下、从新到旧**拆。先拆子级（它们用父级的服务），再逆序清自己的副作用（后挂的依赖先挂的）。反了就会碰到"清理时访问已销毁的东西"。

### `assertAlive()`

```ts
if (this._disposed) throw Error('已卸载')
```

**防止在已拆的王国上继续操作。**

---

## 八、`inject` / `inspect`（364~380 行）

- `inject(deps, callback)`：可选依赖，全部就绪才执行 callback。
- `inspect()`：打印插件树，调试用。

---

## 九、一张图总结

```
Context = 一个王国
├── 户口本(_parent/_children/_name/_disposed)     → 我在哪、我管谁
├── 公共设施(provide/isolate → _root)             → 服务，全局共享/可隔离
├── 承诺清单(_disposers + effect)                  → 所有东西可逆，能干净拆
├── 信箱(_listeners/_middlewares + on/use/emit/waterfall) → 事件通知+拦截
└── 飞地(plugin/derive)                            → 插件各自干活，原型链继承服务
```

**整个文件的灵魂就一句话**：

> **"放东西"和"拆东西"永远成对登记。** 所有能力（服务、监听、工具、插件）都是"放"，`effect` 负责"拆"，`dispose` 统一倒着拆。做到这点，插件就能任意热插拔、互不污染。

---

## 十、为什么"没看懂"？—— 因为该"用"，不是该"读"

这个文件**没有任何可执行的业务逻辑**，它全是"基础设施"。看它的正确姿势不是逐行读，而是**带着问题看**：

| 你的问题 | 该看哪里 |
|---|---|
| 想让插件A给插件B提供能力 | `provide` / `has` |
| 想让插件能干净卸载 | `effect` / `dispose` |
| 想让所有插件都能被通知 | `on` / `emit` |
| 想拦住某个危险动作 | `use` / `waterfall` |

---

## 自测题

用一句话回答：**为什么 `provide` 要把服务存到 `_root`（根），而 `effect` 记的清理动作却存在"当前插件"自己的账本？**

提示——想两个后果：
- 如果把服务也存当前插件，兄弟插件会怎样？
- 如果清理也记到 root，卸载插件后会怎样？

答案参考：

1. **服务存 root** → 兄弟插件通过原型链向上能找到它，实现**全局共享**。若存当前插件，只有自己和子孙可见，兄弟插件 `ctx.greeter` 找不到，插件体系直接"各玩各的"失效。
2. **清理记当前插件** → 插件卸载时只清自己的账本，服务从 root 上消失，**不留幽灵**。若清理也记到 root，则 root 的 `dispose()` 会删掉所有插件的东西，且插件卸载后清理不执行（因为登记在别人账本上），热重载失效。

两条都答对 = 吃透了"注册即副作用"。
