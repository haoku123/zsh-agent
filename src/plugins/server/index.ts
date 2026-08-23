/**
 * Server 插件入口 —— 第 12 课。
 *
 * 给现有 Agent 包一层 HTTP 后端服务。核心设计：**完全复用**已有插件，
 * 一个字节的 Agent 逻辑都不改——服务层只是把 ctx 的能力暴露成 HTTP。
 *
 * 路由（与 Go 版 API 对齐，方便对照）：
 *   POST /api/chat          非流式：{"message":"..."} → {"answer":"..."}
 *   POST /api/chat/stream   SSE 流式：delta / tool_call / tool_result / done
 *   GET  /api/history       会话事件流
 *   POST /api/clear         清空会话
 *   POST /api/remember      写长期记忆
 *   GET  /api/recall        检索记忆
 */
import express from 'express'
import type { Context } from '../../core/context.js'
import type { ServerConfig, ServerService } from './types.js'

export function serverPlugin(ctx: Context, config: ServerConfig = {}): void {
  const port = config.port ?? Number(process.env.PORT ?? 8787)
  const timeoutMs = config.timeoutMs ?? 120_000

  const service: ServerService = {
    async start(): Promise<void> {
      const app = express()
      app.use(express.json())

      // ---- 健康检查 ----
      app.get('/healthz', (_req, res) => {
        res.json({ status: 'ok', provider: ctx.llm.provider, model: ctx.llm.model })
      })

      // ---- POST /api/chat（非流式）----
      app.post('/api/chat', async (req, res) => {
        const message = (req.body as { message?: unknown })?.message
        if (typeof message !== 'string' || !message.trim()) {
          res.status(400).json({ error: 'message 字段必填' })
          return
        }
        try {
          const answer = await withTimeout(ctx.agent.run(message), timeoutMs)
          res.json({ answer })
        } catch (err) {
          res.status(500).json({ error: (err as Error).message })
        }
      })

      // ---- POST /api/chat/stream（SSE 流式）----
      app.post('/api/chat/stream', async (req, res) => {
        const message = (req.body as { message?: unknown })?.message
        if (typeof message !== 'string' || !message.trim()) {
          res.status(400).json({ error: 'message 字段必填' })
          return
        }

        // SSE 必需头
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
        res.setHeader('X-Accel-Buffering', 'no')
        res.flushHeaders()

        const send = (event: string, data: unknown): void => {
          res.write(`event: ${event}\n`)
          res.write(`data: ${JSON.stringify(data)}\n\n`)
        }

        // 工具轨迹：监听 session/event（本请求期间注册，结束即撤）
        const off = ctx.on('session/event', (e) => {
          if (e.type === 'tool/call') {
            const p = e.payload as { tool: string; args: Record<string, unknown> }
            send('tool_call', { tool: p.tool, args: p.args })
          } else if (e.type === 'tool/result') {
            const p = e.payload as { tool: string; result: unknown }
            send('tool_result', { tool: p.tool, result: p.result })
          }
        })

        try {
          const answer = await withTimeout(
            ctx.agent.run(message, {
              onDelta: (d) => send('delta', { text: d }),
            }),
            timeoutMs,
          )
          send('done', { answer })
        } catch (err) {
          send('error', { error: (err as Error).message })
        } finally {
          off()
          res.end()
        }
      })

      // ---- GET /api/history ----
      app.get('/api/history', (_req, res) => {
        res.json({ events: ctx.sessions.all() })
      })

      // ---- POST /api/clear ----
      app.post('/api/clear', (_req, res) => {
        ctx.sessions.clear()
        res.json({ status: 'cleared' })
      })

      // ---- 长期记忆 ----
      app.post('/api/remember', (req, res) => {
        const content = (req.body as { content?: unknown })?.content
        if (typeof content !== 'string' || !content.trim()) {
          res.status(400).json({ error: 'content 字段必填' })
          return
        }
        const entry = ctx.memory.remember(content)
        res.json(entry)
      })

      app.get('/api/recall', (req, res) => {
        const query = String(req.query.query ?? '')
        res.json({ hits: ctx.memory.recall(query, 5) })
      })

      // ---- 启动 ----
      await new Promise<void>((resolve) => {
        app.listen(port, () => {
          console.log(`[server] listening on http://localhost:${port}`)
          resolve()
        })
      })
    },
  }

  ctx.provide('server', service)
}

/** 给 Promise 加超时（超时 reject）。 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`请求超时（>${ms}ms）`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

serverPlugin.inject = ['sessions', 'llm', 'tools', 'agent', 'memory'] as const
