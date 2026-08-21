import { Context, type PluginObject } from './core/context.js'

// ============ 声明服务类型（这一步只给类型，不产生运行时行为） ============

interface Greeter {
  greet(name: string): string
}

declare global {
  interface HarnessServices {
    greeter: Greeter
  }
}

// ============ 插件形态一：函数 ============

function greeterPlugin(ctx: Context, config: { lang: 'zh' | 'en' }): void {
  console.log(`  [greeter] 启动，lang=${config.lang}`)

  ctx.provide('greeter', {
    greet: (name) => (config.lang === 'zh' ? `你好，${name}` : `Hello, ${name}`),
  })

  // 登记一个副作用，卸载时会被撤销
  const timer = setInterval(() => {}, 60_000)
  ctx.effect(() => {
    clearInterval(timer)
    console.log('  [greeter] 已卸载，定时器已清理')
  })
}

// ============ 插件形态二：对象（可声明依赖） ============

const consumerPlugin: PluginObject = {
  name: 'consumer',
  inject: ['greeter'], // 声明依赖：greeter 未就绪就直接报错
  apply(ctx) {
    // ctx.greeter 有完整类型提示，因为上面做了声明合并
    console.log(`  [consumer] 调用服务 -> ${ctx.greeter.greet('张三')}`)
  },
}

// ============ 开始验证 ============

const root = new Context()

console.log('① 挂载 greeter 插件:')
const greeterScope = root.plugin(greeterPlugin, { lang: 'zh' })

console.log('\n② 挂载 consumer 插件（依赖 greeter）:')
root.plugin(consumerPlugin)

console.log('\n③ 当前插件树:')
console.log(root.inspect())

console.log('\n④ 验证作用域隔离——子作用域用 isolate 遮蔽父级服务:')
const childScope = root.plugin((ctx) => {
  console.log(`  遮蔽前，继承到根的服务 -> ${ctx.greeter.greet('李四')}`)
  ctx.isolate('greeter', { greet: (n) => `[子作用域专属] Yo ${n}` })
  console.log(`  遮蔽后，本作用域内     -> ${ctx.greeter.greet('李四')}`)
})
console.log(`  根作用域不受影响       -> ${root.greeter.greet('李四')}`)
childScope.dispose()

console.log('\n⑤ 验证依赖检查——挂载一个依赖不存在服务的插件:')
try {
  root.plugin({
    name: 'broken',
    inject: ['nonexistent' as never],
    apply() {},
  })
} catch (err) {
  console.log(`  ✓ 正确拦截: ${(err as Error).message}`)
}

console.log('\n⑥ 卸载 greeter 插件:')
greeterScope.dispose()
console.log(`  卸载后 root.has('greeter') = ${root.has('greeter')}`)

console.log('\n⑦ 卸载后的插件树:')
console.log(root.inspect())
