/**
 * Context 插件入口 —— 第 8 课。
 *
 * 提供 ctx.context.assemble()：把「长期记忆 + 短期记忆 + system」组装成
 * 一次 LLM 请求的消息。agent_loop 优先用它代替自己的 deriveAgentMessages。
 *
 * 你要写的核心：assemble() 里的记忆注入 + 窗口管理（TODO 见下方）。
 */
import type { Context } from '../../core/context.js'
import type { MemoryEntry } from '../memory/types.js'
import type { DerivedMessage } from '../session/types.js'
import type { AssembledMessages, ContextConfig, ContextService } from './types.js'

/** 内置 system prompt：Agent 的基本人设（可被配置覆盖）。 */
const DEFAULT_SYSTEM = [
  '你是一个运行在本地的 Agent Harness 里的智能体。',
  '你有以下工具可用：读取文件、列出目录、全文检索、写文件、执行 shell 命令。',
  '面对任务时，先拆解，再按需调用工具；工具结果会以 [工具 X 返回] 的形式出现在消息里。',
  '回答要简洁、直接、用中文。',
].join('\n')

export function contextPlugin(ctx: Context, config: ContextConfig = {}): void {
  const systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM
  const maxMemoryItems = config.maxMemoryItems ?? 5
  const maxChars = config.maxChars ?? 24_000

  const service: ContextService = {
    assemble(): AssembledMessages {
      // 1) 短期记忆：session 投影。
      //    注意：不能用 sessions.deriveMessages()——它只投影 user/assistant，
      //    会把 tool/result 过滤掉，导致模型看不到工具返回（历史 bug）。
      //    这里用完整投影：工具结果编成 user 消息喂回模型。
      const history = projectSession(ctx)

      // 2) 长期记忆：用「最近一条 user 消息」作 query 检索，命中才注入
      const query = lastUserMessage(history)
      const injectedMemory: MemoryEntry[] = query
        ? ctx.memory.recall(query, maxMemoryItems)
        : []

      // 3) 组装：记忆消息（若有）→ system → 短期对话历史
      const messages: DerivedMessage[] = []
      if (injectedMemory.length > 0) {
        const memoryText = injectedMemory.map((e) => `- ${e.content}`).join('\n')
        messages.push({ role: 'system', content: `【长期记忆】\n${memoryText}` })
      }
      messages.push({ role: 'system', content: systemPrompt })
      messages.push(...history)

      // 4) 窗口管理：超 maxChars 时从对话历史头部丢弃最老的，直到不超
      let truncated = false
      const baseLen = messages
        .filter((m) => m.role === 'system')
        .reduce((n, m) => n + m.content.length, 0)
      let total = baseLen + history.reduce((n, m) => n + m.content.length, 0)
      // 只裁剪 history 部分：从 history 数组头部删，然后整体重建
      let keptHistory = history
      while (total > maxChars && keptHistory.length > 0) {
        keptHistory = keptHistory.slice(1)
        truncated = true
        total = baseLen + keptHistory.reduce((n, m) => n + m.content.length, 0)
      }
      const finalMessages: DerivedMessage[] = [
        ...messages.slice(0, messages.length - history.length),
        ...keptHistory,
      ]

      return {
        messages: finalMessages,
        injectedMemory,
        truncated,
      }
    },
  }

  ctx.provide('context', service)
}

contextPlugin.inject = ['sessions', 'memory'] as const

/**
 * 完整会话投影：user/assistant 原样，tool/result 编成 user 消息。
 * 这样模型每一轮都能看到工具返回（工具循环的前提）。
 */
function projectSession(ctx: Context): DerivedMessage[] {
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

/** 取最近一条 user 消息（检索 query 用）；没有则返回空串。 */
function lastUserMessage(messages: DerivedMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return messages[i]?.content ?? ''
  }
  return ''
}
