/**
 * Subagent 插件入口 —— 第 11 课。
 *
 * ctx.subagent.run(task, opts)：创建全新 Context，挂一套独立插件，
 * 给子 Agent 一个裁剪过的能力集 + fork 的会话，跑完返回结果。
 *
 * 隔离的三个维度：
 *   1. 作用域隔离：新 Context（不是 derive），服务的闭包各自绑定
 *   2. 会话 fork：子会话从主会话历史「拷贝」初始上下文，但不共享日志
 *   3. 能力裁剪：工具白名单，子 Agent 只有需要的工具
 *
 * 共享的（刻意保留）：
 *   - LLM：同一 provider（子 Agent 用同一模型）
 *   - 长期记忆：同一个 .agent/memory.json（子 Agent 也能 recall）
 */
import { Context } from '../../core/context.js'
import { agentLoopPlugin } from '../agent_loop/index.js'
import { contextPlugin } from '../context/index.js'
import { llmPlugin } from '../llm/index.js'
import { memoryPlugin } from '../memory/index.js'
import { sessionPlugin } from '../session/index.js'
import { toolsPlugin } from '../tools/index.js'
import { registerDelegateTool } from './delegate.js'
import type { SubagentConfig, SubagentService } from './types.js'

export function subagentPlugin(ctx: Context, config: SubagentConfig = {}): void {
  const shareMemory = config.shareMemory ?? true

  // 主 Agent 获得 delegate 工具（子 Agent 不继承，见下方复制时排除）
  registerDelegateTool(ctx)

  const service: SubagentService = {
    async run(task: string, options = {}): Promise<string> {
      const { tools: whitelist, maxSteps = 8, inheritHistory = true } = options

      // ---- 1) 全新隔离的 Context ----
      const child = new Context('subagent')
      child.plugin(sessionPlugin)
      // ctx.llm.provider 是 string，收窄成 llmPlugin 接受的字面量联合
      const provider =
        ctx.llm.provider === 'deepseek' || ctx.llm.provider === 'glm'
          ? ctx.llm.provider
          : undefined
      child.plugin(llmPlugin, provider ? { provider } : undefined)
      child.plugin(toolsPlugin)
      if (shareMemory) {
        // 共享长期记忆文件：用默认路径（.agent/memory.json），不传 file 参数
        child.plugin(memoryPlugin)
        // 子 Agent 的 system prompt 不列举具体工具（工具能力由 tools schema 告知模型），
        // 否则裁剪白名单后，模型会按 system prompt 调用不存在的工具导致死循环
        child.plugin(contextPlugin, {
          systemPrompt: '你是一个被委派执行专门任务的子 Agent。直接完成任务，给出最终回答。',
        })
      }
      child.plugin(agentLoopPlugin, { maxSteps })

      // ---- 2) 能力裁剪：只注册白名单工具 ----
      // 关键：排除 delegate——子 Agent 不能再委派，防止无限递归
      for (const tool of ctx.tools.list()) {
        if (tool.name === 'delegate') continue
        if (!whitelist || whitelist.includes(tool.name)) {
          child.tools.register(tool)
        }
      }

      // ---- 3) 会话 fork：主会话历史投影成子会话的初始消息 ----
      if (inheritHistory) {
        const history = ctx.sessions
          .all()
          .filter((e) => e.type === 'user/message' || e.type === 'assistant/message')
        for (const e of history) {
          const p = e.payload as { role: 'user' | 'assistant'; content: string }
          child.sessions.push({
            type: p.role === 'user' ? 'user/message' : 'assistant/message',
            role: p.role,
            content: p.content,
          })
        }
      }

      // ---- 4) 委派执行 ----
      try {
        return await child.agent.run(task)
      } finally {
        // 子 Agent 用完即弃：卸载全部子插件，不留幽灵
        child.dispose()
      }
    },
  }

  ctx.provide('subagent', service)
}

subagentPlugin.inject = ['sessions', 'llm', 'tools', 'agent'] as const
