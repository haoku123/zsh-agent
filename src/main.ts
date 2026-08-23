/**
 * Agent Harness 入口。
 *
 * 运行：npm run dev
 * 示例：npm run dev -- "列出 src/plugins 目录"
 */
import 'dotenv/config'
import path from 'node:path'
import { Context } from './core/context.js'
import { agentLoopPlugin } from './plugins/agent_loop/index.js'
import { llmPlugin } from './plugins/llm/index.js'
import { sessionPlugin } from './plugins/session/index.js'
import { registerBuiltinTools } from './plugins/tools/builtins/index.js'
import { toolsPlugin } from './plugins/tools/index.js'

const rootDir = process.cwd()

const root = new Context()
root.plugin(sessionPlugin)
root.plugin(llmPlugin)
root.plugin(toolsPlugin)
root.plugin(agentLoopPlugin)

registerBuiltinTools(root, rootDir)

const input = process.argv[2] ?? '列出 src/plugins 目录结构，并说明 agent_loop 插件做什么'

console.log(`=== Agent (${root.llm.provider} / ${root.llm.model}) ===`)
console.log(`=== 工作目录: ${path.relative(process.env.HOME ?? '', rootDir) || rootDir} ===\n`)
console.log('> ', input, '\n')

const answer = await root.agent.run(input)
console.log(answer)
