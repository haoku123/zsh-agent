/**
 * Session 相关类型定义。
 *
 * 独立成文件，避免 UI / Agent Loop / 其他插件 import 时产生循环依赖。
 */

// ==================== 日志条目 ====================

/** append-only 日志的条目。 */
export interface SessionEvent {
  /** 会话内单调递增的 id，保证顺序与唯一。 */
  id: number
  /** 时间戳。 */
  timestamp: number
  /** 事件类型，见 SessionEventType。 */
  type: SessionEventType
  /** 事件内容（原始事件对象）。 */
  payload: unknown
}

// ==================== 语义事件类型 ====================

/**
 * Session 的语义事件类型词汇表。
 * 用一个受控的联合类型，而不是自由 string，让日志能被精确投影。
 */
export type SessionEventType =
  | 'turn/start'          // 一轮对话开始
  | 'user/message'        // 用户消息 { role:'user', content }
  | 'assistant/message'   // 模型回复 { role:'assistant', content }
  | 'tool/call'           // 工具被调用 { tool, args }
  | 'tool/result'         // 工具返回 { tool, result }
  | 'turn/end'            // 一轮对话结束

// ==================== 各类型事件的 payload ====================

export interface UserMessagePayload {
  type: 'user/message'
  role: 'user'
  content: string
}

export interface AssistantMessagePayload {
  type: 'assistant/message'
  role: 'assistant'
  content: string
}

export interface ToolCallPayload {
  type: 'tool/call'
  tool: string
  args: Record<string, unknown>
}

export interface ToolResultPayload {
  type: 'tool/result'
  tool: string
  result: unknown
}

// ==================== 投影产物 ====================

/** 投影成 LLM 可读的消息（OpenAI 兼容格式）。 */
export interface DerivedMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

// ==================== 服务接口 ====================

/** ctx.sessions 服务的对外接口。 */
export interface SessionService {
  /** 追加一条事件，返回带 id/timestamp 的日志条目，并广播 'session/event'。 */
  push<T extends { type: SessionEventType }>(e: T): SessionEvent
  /** 取全部事件（返回深拷贝，外部无法篡改日志）。 */
  all(): SessionEvent[]
  /** 取第 boundaryId 条之前（含）的事件，fork 用。 */
  before(boundaryId: number): SessionEvent[]
  /** 投影成模型历史（只取 user/assistant 消息，按 id 排序）。 */
  deriveMessages(): DerivedMessage[]
  /** 清空全部事件，开始全新会话。 */
  clear(): void
  /** 当前日志条数。 */
  readonly length: number
}

// ==================== 扩展 ctx ====================

declare global {
  interface HarnessServices {
    sessions: SessionService
  }
  interface HarnessEvents {
    'session/event': (event: SessionEvent) => void
  }
}
