/**
 * LLM 相关类型定义。
 *
 * 这是「适配器 seam」：Agent Loop 只依赖 LLMService，
 * 换 DeepSeek / GLM 只改配置，不动业务代码。
 */
import type { DerivedMessage } from '../session/types.js'
import type { Tool } from '../tools/types.js'

// ==================== 请求 / 响应 ====================

/** 一次 chat 请求。messages 可直接用 sessions.deriveMessages() 的产物。 */
export interface ChatRequest {
  messages: DerivedMessage[]
  /** 可选：把 ctx.tools.list() 传进来，模型就能发起 tool_calls。 */
  tools?: Tool[]
}

/** 模型发起的一次工具调用（OpenAI 兼容格式）。 */
export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

/** chat 的返回。content 和 toolCalls 可能同时存在，也可能只有一个。 */
export interface ChatResponse {
  content: string | null
  toolCalls: ToolCall[]
}

// ==================== 服务接口 ====================

/** ctx.llm 服务的对外接口。 */
export interface LLMService {
  /** 当前 provider：deepseek | glm */
  readonly provider: string
  /** 当前模型名 */
  readonly model: string
  /** 发消息给模型，返回文本和/或 tool_calls。 */
  chat(request: ChatRequest): Promise<ChatResponse>
}

/** 插件配置（可选覆盖 .env 里的 PROVIDER）。 */
export interface LLMConfig {
  provider?: 'deepseek' | 'glm'
}

// ==================== 扩展 ctx ====================

declare global {
  interface HarnessServices {
    llm: LLMService
  }
}
