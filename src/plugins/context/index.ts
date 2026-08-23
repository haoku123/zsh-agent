/**
 * Context 插件入口 —— 第 8 课 + 第 13 课（压缩）。
 *
 * 提供 ctx.context：
 *   - assemble()：把「历史摘要 + 长期记忆 + system + 短期历史」组装成一次请求
 *   - compactIfNeeded()：上下文接近窗口上限时，把早期历史交给 LLM 压缩成摘要
 *     （Pi 风格：不硬砍，保留最近消息；达到窗口 70% 阈值触发）
 *
 * 压缩状态设计：
 *   - summary（string|null）：已压缩部分的摘要，作为 system 消息放最前
 *   - compactedUntilId（number）：已压缩的最后一条会话事件 id；
 *     投影时只从它之后取历史（session 本身仍是 append-only 真相源，不删数据）
 *
 * 容错：llm 是可选依赖（ctx.has('llm') 判断）——没有 LLM 时退化为纯硬截断。
 */
import type { Context } from '../../core/context.js'
import type { MemoryEntry } from '../memory/types.js'
import type { SessionEvent } from '../session/types.js'
import type { DerivedMessage } from '../session/types.js'
import type { AssembledMessages, ContextConfig, ContextService } from './types.js'

/** 内置 system prompt：Agent 的基本人设（可被配置覆盖）。 */
const DEFAULT_SYSTEM = [
  '你是一个运行在本地的 Agent Harness 里的智能体。',
  '你有以下工具可用：读取文件、列出目录、全文检索、写文件、执行 shell 命令。',
  '面对任务时，先拆解，再按需调用工具；工具结果会以 [工具 X 返回] 的形式出现在消息里。',
  '回答要简洁、直接、用中文。',
].join('\n')

/** 压缩指令：只输出摘要正文，不加新信息。 */
const COMPACT_PROMPT =
  '把以下对话压缩成一段中文摘要，保留关键决策、用户偏好、重要结论和未完成的事项。' +
  '不要添加新信息，不要输出任何多余内容，只输出摘要正文。'

export function contextPlugin(ctx: Context, config: ContextConfig = {}): void {
  const systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM
  const maxMemoryItems = config.maxMemoryItems ?? 5
  const maxChars = config.maxChars ?? 24_000
  const compactThreshold = config.compactThreshold ?? 0.7

  // ---- 压缩状态（Pi 风格：早期历史 → 摘要，session 本身不动） ----
  let summary: string | null = null
  let compactedUntilId = -1 // 已压缩的最后一条会话事件 id；-1 = 尚未压缩

  const service: ContextService = {
    assemble(): AssembledMessages {
      // 1) 短期记忆：从压缩边界之后投影（历史 bug 的教训：必须含 tool/result）
      const history = projectSessionFrom(ctx, compactedUntilId + 1)

      // 2) 长期记忆：用最近一条 user 消息检索
      const query = lastUserMessage(history)
      const injectedMemory: MemoryEntry[] = query
        ? ctx.memory.recall(query, maxMemoryItems)
        : []

      // 3) 组装：历史摘要 → 长期记忆 → system prompt → 近期历史
      const messages: DerivedMessage[] = []
      if (summary) {
        messages.push({ role: 'system', content: `【历史摘要】\n${summary}` })
      }
      if (injectedMemory.length > 0) {
        const memoryText = injectedMemory.map((e) => `- ${e.content}`).join('\n')
        messages.push({ role: 'system', content: `【长期记忆】\n${memoryText}` })
      }
      messages.push({ role: 'system', content: systemPrompt })
      messages.push(...history)

      // 4) 硬截断兜底：压缩没来得及 / 无 LLM 时，超限从历史头部丢
      let truncated = false
      const baseLen = messages
        .filter((m) => m.role === 'system')
        .reduce((n, m) => n + m.content.length, 0)
      let total = baseLen + history.reduce((n, m) => n + m.content.length, 0)
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

    async compactIfNeeded(): Promise<void> {
      // 需要 LLM 才能压缩（可选依赖）
      if (!ctx.has('llm')) return

      const events = ctx.sessions.all().filter((e) => e.id > compactedUntilId)
      const dialogs = events.filter(
        (e) => e.type === 'user/message' || e.type === 'assistant/message',
      )
      if (dialogs.length < 2) return // 消息太少，不值得压

      const contentOf = (e: SessionEvent): string =>
        (e.payload as { content: string }).content
      const dialogChars = dialogs.reduce((n, e) => n + contentOf(e).length, 0)
      const baseLen = systemPrompt.length + (summary?.length ?? 0)

      // 未达窗口阈值 → 不压缩
      if (baseLen + dialogChars < maxChars * compactThreshold) return

      // 取「较老的一半」去压缩：从头部累计到一半字符
      let cut = 0
      let keepFrom: number | null = null
      for (const e of dialogs) {
        cut += contentOf(e).length
        if (cut >= dialogChars / 2) {
          keepFrom = e.id
          break
        }
      }
      if (keepFrom === null) return
      const toCompress = dialogs.filter((e) => e.id <= keepFrom)

      // 生成摘要（容错：LLM 失败则跳过本次，下次再试）
      try {
        const resp = await ctx.llm.chat({
          messages: [
            { role: 'system', content: COMPACT_PROMPT },
            ...toCompress.map((e) => {
              const p = e.payload as { role: 'user' | 'assistant'; content: string }
              return { role: p.role, content: p.content }
            }),
          ],
        })
        const text = resp.content?.trim()
        if (!text) return
        // 累积摘要：旧摘要 + 新摘要
        summary = summary ? `${summary}\n\n${text}` : text
        compactedUntilId = keepFrom
      } catch {
        // 静默跳过：不阻塞 Agent 主流程
      }
    },
  }

  ctx.provide('context', service)
}

contextPlugin.inject = ['sessions', 'memory'] as const

/**
 * 完整会话投影（从 fromId 起）：user/assistant 原样，tool/result 编成 user 消息。
 * 这样模型每一轮都能看到工具返回（工具循环的前提）。
 */
function projectSessionFrom(ctx: Context, fromId: number): DerivedMessage[] {
  const messages: DerivedMessage[] = []
  for (const e of ctx.sessions.all()) {
    if (e.id < fromId) continue // 已压缩部分跳过
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
