/**
 * 语义事件的便捷构造函数。
 *
 * 让其他插件不用手工拼 payload 对象，用函数生成符合类型契约的事件。
 * 例：
 *   import { userMessage, assistantMessage, toolCall, toolResult } from './event.js'
 *   ctx.sessions.push(userMessage('你好'))
 */
import type {
  AssistantMessagePayload,
  ToolCallPayload,
  ToolResultPayload,
  UserMessagePayload,
} from './types.js'

/** 生成一条用户消息事件。 */
export function userMessage(content: string): UserMessagePayload {
  return { type: 'user/message', role: 'user', content }
}

/** 生成一条模型回复事件。 */
export function assistantMessage(content: string): AssistantMessagePayload {
  return { type: 'assistant/message', role: 'assistant', content }
}

/** 生成一条工具调用事件。 */
export function toolCall(tool: string, args: Record<string, unknown>): ToolCallPayload {
  return { type: 'tool/call', tool, args }
}

/** 生成一条工具返回事件。 */
export function toolResult(tool: string, result: unknown): ToolResultPayload {
  return { type: 'tool/result', tool, result }
}
