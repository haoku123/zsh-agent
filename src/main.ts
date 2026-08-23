/**
 * Agent Harness 入口。
 *
 * 四种模式：
 *   - 单次：npm run dev -- "你的问题"（流式输出）
 *   - 交互：npm run dev（进入 REPL，多轮对话 + 子命令）
 *   - TUI：npm run dev -- --tui（终端图形界面）
 *   - HTTP 后端：npm run dev -- --serve（服务现有 Agent，端口默认 8787）
 */
import 'dotenv/config'
import path from 'node:path'
import { Context } from './core/context.js'
import { agentLoopPlugin } from './plugins/agent_loop/index.js'
import { contextPlugin } from './plugins/context/index.js'
import { llmPlugin } from './plugins/llm/index.js'
import { memoryPlugin } from './plugins/memory/index.js'
import { replPlugin } from './plugins/repl/index.js'
import { serverPlugin } from './plugins/server/index.js'
import { sessionPlugin } from './plugins/session/index.js'
import { subagentPlugin } from './plugins/subagent/index.js'
import { tuiPlugin } from './plugins/tui/index.js'
import { registerBuiltinTools } from './plugins/tools/builtins/index.js'
import { toolsPlugin } from './plugins/tools/index.js'

const rootDir = process.cwd()

const root = new Context()
// 会话落盘：JSONL 持久化到 .agent/session.json（重启后恢复对话）
root.plugin(sessionPlugin, { file: path.join(rootDir, '.agent', 'session.jsonl') })
root.plugin(llmPlugin)
root.plugin(memoryPlugin) // 长期记忆（注意：必须在 context 之前挂载）
root.plugin(contextPlugin) // 上下文组装器，依赖 memory + sessions
root.plugin(toolsPlugin)
root.plugin(agentLoopPlugin)
root.plugin(subagentPlugin) // 子 Agent 委派（依赖 agent + tools）
root.plugin(replPlugin)
root.plugin(tuiPlugin)
root.plugin(serverPlugin) // HTTP 后端服务（依赖 agent + sessions + memory）

registerBuiltinTools(root, rootDir)

console.log(`=== Agent (${root.llm.provider} / ${root.llm.model}) ===`)
console.log(`=== 工作目录: ${path.relative(process.env.HOME ?? '', rootDir) || rootDir} ===\n`)

const args = process.argv.slice(2)

if (args[0] === '--tui') {
  // TUI 模式：终端图形界面
  await root.tui.start()
} else if (args[0] === '--serve') {
  // HTTP 后端模式：服务现有 Agent
  await root.server.start()
} else if (args[0]) {
  // 单次模式：也走流式，能实时看到 token 输出
  console.log('> ', args[0], '\n')
  await root.agent.run(args[0], {
    onDelta: (d) => process.stdout.write(d),
  })
  process.stdout.write('\n')
} else {
  // 交互模式：进入 REPL
  await root.repl.start()
}
