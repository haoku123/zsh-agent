/**
 * Agent Loop 插件入口 —— 第 6 课，你来写。
 *
 * 循环逻辑（伪代码）：
 *
 *   run(input):
 *     sessions.push(userMessage(input))
 *     for step in 1..maxSteps:
 *       res = llm.chat({ messages: sessions.deriveMessages(), tools: tools.list() })
 *       if res.content && res.toolCalls.length === 0:
 *         sessions.push(assistantMessage(res.content))
 *         return res.content
 *       for tc in res.toolCalls:
 *         sessions.push(toolCall(tc.name, tc.args))
 *         result = await tools.execute(tc.name, tc.args)
 *         sessions.push(toolResult(tc.name, result))
 *     throw new Error('超过 maxSteps')
 */
import type { Context } from '../../core/context.js'
import type { AgentLoopConfig, AgentLoopRunOptions, AgentLoopService } from './types.js'
import { userMessage, assistantMessage, toolCall, toolResult } from '../session/event.js'
import type { DerivedMessage } from '../session/types.js'

/** 给 Agent 用的投影：在 user/assistant 基础上，把 tool/result 编进上下文。 */
function deriveAgentMessages(ctx: Context): DerivedMessage[] {
  const messages: DerivedMessage[] = []
  for (const e of ctx.sessions.all()) {
    if (e.type === 'user/message') {
      const p = e.payload as { content: string }
      messages.push({ role: 'user', content: p.content })
    } else if (e.type === 'assistant/message') {
      const p = e.payload as { content: string }
      messages.push({ role: 'assistant', content: p.content })
    } else if (e.type === 'tool/result') {
      const p = e.payload as { tool: string; result: unknown }
      messages.push({
        role: 'user',
        content: `[工具 ${p.tool} 返回] ${JSON.stringify(p.result)}`,
      })
    }
  }
  return messages
}

export function agentLoopPlugin(ctx: Context, config: AgentLoopConfig = {}): void {
  const maxSteps = config.maxSteps ?? 10

  const service: AgentLoopService = {
    async run(input: string, options: AgentLoopRunOptions = {}): Promise<string> {
      ctx.sessions.push(userMessage(input))

      for (let step = 0; step < maxSteps; step++) {
        // 有 context 插件（长期记忆 + system prompt + 压缩）就用它组装，
        // 没有则退回纯短期投影——两套都支持，向后兼容。
        let messages: DerivedMessage[]
        if (ctx.has('context')) {
          // 先看是否需要压缩早期历史，再组装
          await ctx.context.compactIfNeeded()
          messages = ctx.context.assemble().messages
        } else {
          messages = deriveAgentMessages(ctx)
        }
        const tools = ctx.tools.list()
        // 有 onDelta 就走流式，否则走一次性 chat
        const res = options.onDelta
          ? await ctx.llm.chatStream({ messages, tools }, options.onDelta)
          : await ctx.llm.chat({ messages, tools })

        if (res.toolCalls.length === 0) {
          if (!res.content) throw new Error('模型返回空响应')
          ctx.sessions.push(assistantMessage(res.content))
          return res.content
        }

        for (const tc of res.toolCalls) {
          ctx.sessions.push(toolCall(tc.name, tc.args))
          const result = await ctx.tools.execute(tc.name, tc.args)
          ctx.sessions.push(toolResult(tc.name, result))
        }
      }

      throw new Error(`Agent 循环超过 maxSteps=${maxSteps}`)
    },
  }

  ctx.provide('agent', service)
}

agentLoopPlugin.inject = ['sessions', 'llm', 'tools'] as const
