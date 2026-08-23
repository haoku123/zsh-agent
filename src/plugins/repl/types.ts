/**
 * REPL（Read-Eval-Print Loop）相关类型定义。
 *
 * 第 7 课：把单次 run 变成连续对话的交互式 CLI。
 * 它复用了前 6 课的全部机制：
 *   - ctx.agent.run()        跑一轮（agent_loop）
 *   - ctx.sessions 事件流    监听 'session/event' 实时打印工具轨迹
 *   - ctx.tools / ctx.llm    给子命令 /tools、/model 用
 *   - ctx.sessions.clear()   /clear 子命令
 */
import type { Context } from '../../core/context.js'

// ==================== 服务接口 ====================

/** ctx.repl 服务的对外接口。 */
export interface ReplService {
  /** 启动交互式对话循环，直到用户退出（/exit 或 Ctrl+D）。 */
  start(): Promise<void>
}

/** 插件配置。 */
export interface ReplConfig {
  /** 输入提示符，默认 '你 > '。 */
  prompt?: string
}

// ==================== 扩展 ctx ====================

declare global {
  interface HarnessServices {
    repl: ReplService
  }
}

// 避免 types 文件被当成纯声明文件
export type _ReplContext = Context
