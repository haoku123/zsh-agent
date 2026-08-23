/**
 * Subagent（子 Agent / 委派）相关类型定义。
 *
 * 第 11 课：把 harness 的核心能力补全 —— 子 Agent 委派、能力隔离、会话 fork。
 *
 * 为什么子 Agent 要「新建独立 Context」而不是「derive + isolate」：
 *   服务内部通过闭包绑定挂载时作用域（如 agent_loop 的 run 里用的 ctx 是
 *   挂载时捕获的），derive 子作用域只影响「服务查找」，不影响「服务内部绑定」。
 *   所以要真正隔离，必须新挂一套插件，让每个服务的闭包绑定子作用域。
 */
import type { Context } from '../../core/context.js'

/** 子 Agent 运行选项。 */
export interface SubagentOptions {
  /** 工具白名单：只让子 Agent 用这些工具；缺省 = 全部。 */
  tools?: string[]
  /** 子 Agent 最多循环几轮。 */
  maxSteps?: number
  /** 是否继承主会话历史作为子会话的初始上下文（fork），默认 true。 */
  inheritHistory?: boolean
}

/** ctx.subagent 服务的对外接口。 */
export interface SubagentService {
  /** 把任务委派给一个全新、隔离的子 Agent，返回它的最终文本。 */
  run(task: string, options?: SubagentOptions): Promise<string>
}

/** 插件配置。 */
export interface SubagentConfig {
  /** 子 Agent 是否共享长期记忆（默认 true）。 */
  shareMemory?: boolean
}

declare global {
  interface HarnessServices {
    subagent: SubagentService
  }
}

// 避免 types 文件被当成纯声明文件
export type _SubagentContext = Context
