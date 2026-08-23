/**
 * TUI（终端图形界面）相关类型定义。
 *
 * 第 10 课：用 ink（React for CLI）做终端聊天界面。
 * 复用 harness 的全部机制：
 *   - ctx.agent.run(input, { onDelta })  流式输出 → 打字机效果
 *   - ctx.on('session/event')           工具调用轨迹实时显示
 *   - ctx.sessions.all()                挂载时回放历史
 */
import type { Context } from '../../core/context.js'

/** ctx.tui 服务的对外接口。 */
export interface TuiService {
  /** 启动终端界面（阻塞直到退出）。 */
  start(): Promise<void>
}

/** 插件配置。 */
export interface TuiConfig {
  /** 标题栏显示的标题，默认 "Agent TUI"。 */
  title?: string
}

declare global {
  interface HarnessServices {
    tui: TuiService
  }
}

// 避免 types 文件被当成纯声明文件
export type _TuiContext = Context
