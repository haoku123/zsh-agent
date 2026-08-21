/**
 * 第 4 课验证入口：Tools 插件。
 *
 * 运行：pnpm tsx src/main-tools.ts
 * 目的：验证 register / list / execute，以及守卫流水线能拦截危险工具。
 */
import { Context } from './core/context.js'
import { toolsPlugin } from './plugins/tools/index.js'
import type { Tool } from './plugins/tools/types.js'

const root = new Context()
root.plugin(toolsPlugin)

// ① 注册两个工具：一个安全的，一个危险的
const calculator: Tool = {
  name: 'calculator',
  description: '执行算术运算',
  schema: {
    type: 'object',
    properties: {
      expr: { type: 'string', description: '如 "1+1" 或 "2*3"' },
    },
    required: ['expr'],
  },
  execute: ({ expr }) => {
    // 仅演示，别用 eval 做真的；这里做个假实现
    if (expr === '1+1') return 2
    if (expr === '2*3') return 6
    return '无法计算'
  },
}

const shell: Tool = {
  name: 'shell',
  description: '执行 shell 命令',
  schema: {
    type: 'object',
    properties: { cmd: { type: 'string' } },
    required: ['cmd'],
  },
  dangerous: true, // 危险工具
  execute: ({ cmd }) => `已执行: ${cmd}`,
}

root.tools.register(calculator)
root.tools.register(shell)

// ② 列表
console.log('=== list() 工具列表 ===')
console.log('  工具:', root.tools.list().map((t) => t.name).join(', '))

// ③ 注册一个权限守卫：拦截 dangerous 工具
root.use('tools/execute', (req, next) => {
  const tool = root.tools.get(req.name)
  if (tool?.dangerous) {
    return { error: `拒绝执行危险工具: ${req.name}` } // 短路，不调 next
  }
  return next()
})

// ④ 执行安全工具（应正常）
console.log('=== 执行安全工具 calculator ===')
console.log('  1+1 =', await root.tools.execute('calculator', { expr: '1+1' }))

// ⑤ 执行危险工具（应被守卫拦截）
console.log('=== 执行危险工具 shell ===')
const r = await root.tools.execute('shell', { cmd: 'rm -rf /' })
console.log('  结果:', r)

// ⑥ 执行不存在的工具（应抛错）
console.log('=== 执行不存在的工具 ===')
try {
  await root.tools.execute('nonexistent', {})
} catch (err) {
  console.log('  ✓ 正确抛错:', (err as Error).message)
}
