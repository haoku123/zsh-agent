/**
 * Context 相关类型定义。
 *
 * 第 8 课：上下文组装器（context assembler）。
 *
 * 每次发给 LLM 的 messages 由三层组成：
 *   1. system prompt   —— 固定规则（你是谁、你拥有哪些能力）
 *   2. 长期记忆         —— memory.recall() 检索出的相关条目
 *   3. 短期记忆         —— session 当前对话历史
 *
 * 这个插件负责把三层「拼装 + 裁剪」成一份合法的请求消息，
 * 并保证不超出上下文窗口。
 */
import type { Context } from '../../core/context.js'
import type { MemoryEntry } from '../memory/types.js'
import type { DerivedMessage } from '../session/types.js'

// ==================== 组装产物 ====================

/** 组装好的完整请求。 */
export interface AssembledMessages {
  /** 最终发给 LLM 的 messages。 */
  messages: DerivedMessage[]
  /** 本次注入的长期记忆条目（调试 / 日志用）。 */
  injectedMemory: MemoryEntry[]
  /** 是否触发了截断（窗口管理）。 */
  truncated: boolean
}

// ==================== 服务接口 ====================

/** ctx.context 服务的对外接口。 */
export interface ContextService {
  /** 组装当前请求的完整上下文。 */
  assemble(): AssembledMessages
  /**
   * 上下文压缩（Pi 风格）：当上下文接近窗口上限时，
   * 把早期历史交给 LLM 生成摘要（不硬砍），保留最近消息。
   * 由 agent_loop 每轮循环前调用。无 LLM 依赖时静默跳过。
   */
  compactIfNeeded(): Promise<void>
}

/** 插件配置。 */
export interface ContextConfig {
  /** 自定义 system prompt；缺省用内置模板。 */
  systemPrompt?: string
  /** 长期记忆最多注入条数，默认 5。 */
  maxMemoryItems?: number
  /** 上下文窗口上限（字符数）。超出后从 history 头部截断。 */
  maxChars?: number
  /** 触发压缩的窗口占比阈值（0~1），默认 0.7。达到 70% 即开始压缩早期历史。 */
  compactThreshold?: number
}

// ==================== 扩展 ctx ====================

declare global {
  interface HarnessServices {
    context: ContextService
  }
}

// 避免 types 文件被当成纯声明文件
export type _ContextContext = Context
