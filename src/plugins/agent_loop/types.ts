/**
 * Agent Loop 相关类型定义。
 *
 * 第 6 课：把 Session + LLM + Tools 串成一个循环。
 * 你来完成下面的接口设计（参考提示），然后 index.ts 实现它。
 */
import type { Context } from '../../core/context.js'

// ==================== 服务接口 ====================

/**
 * ctx.agent 服务的对外接口。
 *
 * TODO（你来写）：
 *   - run(input: string): Promise<string>
 *     接收用户输入，跑完 agent 循环，返回最终 assistant 文本
 *
 * 提示：Agent Loop 是对外的「一键入口」，内部会：
 *   1. sessions.push(userMessage)
 *   2. 循环：llm.chat → 有 tool_calls 就 execute → 再 chat
 *   3. 直到模型返回纯文本，或达到 maxSteps
 */
export interface AgentLoopService {
  // TODO: 补全方法签名
  run(input: string): Promise<string>
}

/** 插件配置。 */
export interface AgentLoopConfig {
  /** 最多循环几轮（防止 tool 死循环），默认 10。 */
  maxSteps?: number
}

// ==================== 扩展 ctx ====================

declare global {
  interface HarnessServices {
    // TODO: 声明 agent 服务（键名建议 'agent'，这样 ctx.agent.run(...)）
    agent: AgentLoopService
  }
}

// 避免 types 文件被当成纯声明文件（如果你删了上面 TODO 记得保留 export）
export type _AgentLoopContext = Context
