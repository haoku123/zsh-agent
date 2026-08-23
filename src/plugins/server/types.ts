/**
 * Server 插件相关类型定义。
 *
 * 第 12 课：给现有 Agent 包一层 HTTP 后端服务（不重写任何 Agent 逻辑）。
 * 复用：ctx.agent / ctx.sessions / ctx.memory / ctx.context。
 */
import type { Context } from '../../core/context.js'

/** ctx.server 服务的对外接口。 */
export interface ServerService {
  /** 启动 HTTP 服务并阻塞。 */
  start(): Promise<void>
}

/** 插件配置。 */
export interface ServerConfig {
  /** 监听端口，默认 8787。 */
  port?: number
  /** 单次请求超时（毫秒），默认 120s。 */
  timeoutMs?: number
}

declare global {
  interface HarnessServices {
    server: ServerService
  }
}

// 避免 types 文件被当成纯声明文件
export type _ServerContext = Context
