/**
 * 第 3 课验证入口：Session 插件（文件夹结构版）。
 *
 * 运行：pnpm tsx src/main-session.ts
 * 目的：验证 ctx.sessions 能 push / all / before / deriveMessages / 广播，且日志不被外部篡改。
 */
import { Context } from './core/context.js'
import { sessionPlugin } from './plugins/session/index.js'
import {
  assistantMessage,
  toolCall,
  toolResult,
  userMessage,
} from './plugins/session/event.js'
import type { SessionEvent } from './plugins/session/types.js'

const root = new Context()
root.plugin(sessionPlugin)

// ① 广播监听：新事件来了
root.on('session/event', (event) => {
  console.log(`  📣 [session/event] #${event.id} ${event.type}`)
})

// ② 模拟一轮对话 + 工具调用
console.log('=== push 一轮对话 ===')
const e1 = root.sessions.push(userMessage('帮我算 1+1'))
const e2 = root.sessions.push(toolCall('calculator', { a: 1, b: 1 }))
const e3 = root.sessions.push(toolResult('calculator', 2))
const e4 = root.sessions.push(assistantMessage('结果是 2'))

console.log(
  `e1.id=${e1.id} e2.id=${e2.id} e3.id=${e3.id} e4.id=${e4.id} | length=${root.sessions.length}`,
)

// ③ 投影成模型历史：应只含 user 和 assistant，不含 tool
console.log('=== deriveMessages() 投影 ===')
console.log('  投影结果:', JSON.stringify(root.sessions.deriveMessages()))

// ④ before(boundaryId)：fork 用
console.log('=== before(2) 取前 3 条 ===')
console.log('  条数:', root.sessions.before(2).length, '(应含 id 0,1,2 共 3 条)')

// ⑤ 验证 all() 是深拷贝，篡改不影响日志
console.log('=== 验证 all() 是深拷贝 ===')
const got = root.sessions.all()
;(got[0] as SessionEvent).payload = { hacked: true }
console.log('  篡改后日志第一条 payload =', root.sessions.all()[0]?.payload, '(应仍为原始用户消息)')
