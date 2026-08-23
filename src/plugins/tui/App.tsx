/**
 * TUI 主组件。
 *
 * 布局：
 *   ┌─ 标题栏（模型 / 会话数 / 运行状态）───────────┐
 *   │  消息区：用户气泡 / 助手气泡（流式）/ 工具轨迹    │
 *   │  输入行：> 你的输入…                          │
 *   └────────────────────────────────────────────┘
 *
 * 数据流（关键设计）：
 *   - 会话历史 = ctx.sessions 的投影。挂载时读一次全量，
 *     之后订阅 'session/event' 事件实时追加 → 界面只是 session 的视图
 *   - 提交消息 → agent.run(input, { onDelta })，
 *     onDelta 逐段更新当前 assistant 气泡（打字机效果）
 */
import { Box, Text, render, useApp, useInput } from 'ink'
import React, { useEffect, useRef, useState } from 'react'
import type { Context } from '../../core/context.js'
import type { SessionEvent } from '../session/types.js'

/** 启动 TUI：渲染 App 并阻塞直到退出。 */
export async function startTui(ctx: Context, title = 'Agent TUI'): Promise<void> {
  const { waitUntilExit } = render(<App ctx={ctx} title={title} />)
  await waitUntilExit()
}

/** 界面里的一条消息。 */
interface UiMessage {
  id: number
  kind: 'user' | 'assistant'
  text: string
}

/** 工具调用轨迹。 */
interface ToolTrace {
  id: number
  tool: string
  args: string
  result?: string
}

export function App({ ctx, title = 'Agent TUI' }: { ctx: Context; title?: string }) {
  const { exit } = useApp()
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [traces, setTraces] = useState<ToolTrace[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  // 流式状态：当前正在生成的 assistant 气泡（本地 id）
  const streamingRef = useRef<number | null>(null)
  // 本地自增 id（session 事件 id 不可复用，流式气泡用本地 key）
  const localIdRef = useRef(1)
  // 未返回结果的 tool/call 队列（FIFO：agent_loop 顺序 await，先调先返回）
  const pendingCallsRef = useRef<number[]>([])

  // 挂载时回放历史 + 订阅 session 事件
  useEffect(() => {
    const initial = ctx.sessions
      .all()
      .filter((e) => e.type === 'user/message' || e.type === 'assistant/message')
      .map((e) => {
        const p = e.payload as { role: 'user' | 'assistant'; content: string }
        return { id: e.id, kind: p.role, text: p.content } satisfies UiMessage
      })
    setMessages(initial)

    const off = ctx.on('session/event', (e: SessionEvent) => {
      onSessionEvent(e)
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** session/event 投影到界面状态。 */
  function onSessionEvent(e: SessionEvent): void {
    if (e.type === 'user/message') {
      const p = e.payload as { content: string }
      setMessages((prev) => [...prev, { id: e.id, kind: 'user', text: p.content }])
    } else if (e.type === 'assistant/message') {
      const p = e.payload as { content: string }
      // 落定：如果有进行中的流式气泡，替换为最终文本；否则新增
      setMessages((prev) => {
        const sid = streamingRef.current
        if (sid !== null) {
          streamingRef.current = null
          return prev.map((m) => (m.id === sid ? { ...m, text: p.content } : m))
        }
        return [...prev, { id: e.id, kind: 'assistant', text: p.content }]
      })
    } else if (e.type === 'tool/call') {
      const p = e.payload as { tool: string; args: Record<string, unknown> }
      const id = localIdRef.current++
      pendingCallsRef.current.push(id)
      setTraces((prev) => [...prev, { id, tool: p.tool, args: JSON.stringify(p.args) }])
    } else if (e.type === 'tool/result') {
      const p = e.payload as { tool: string; result: unknown }
      const id = pendingCallsRef.current.shift()
      if (id === undefined) return
      const preview = JSON.stringify(p.result)
      const clipped = preview.length > 120 ? preview.slice(0, 120) + '…' : preview
      setTraces((prev) => prev.map((t) => (t.id === id ? { ...t, result: clipped } : t)))
    }
  }

  /** 提交一行输入。 */
  async function submit(): Promise<void> {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)

    // 预占一个流式 assistant 气泡（本地 id），落定时被 session 事件替换
    const bubbleId = localIdRef.current++
    streamingRef.current = bubbleId
    setMessages((prev) => [...prev, { id: bubbleId, kind: 'assistant', text: '' }])

    try {
      await ctx.agent.run(text, {
        onDelta: (d) => {
          const sid = streamingRef.current
          if (sid === null) return
          // 注意：不能在闭包里直接读 messages，用函数式更新拼到当前气泡
          setMessages((prev) =>
            prev.map((m) => (m.id === sid ? { ...m, text: m.text + d } : m)),
          )
        },
      })
    } catch (err) {
      const sid = streamingRef.current
      if (sid !== null) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === sid ? { ...m, text: m.text + `\n[错误] ${(err as Error).message}` } : m,
          ),
        )
        streamingRef.current = null
      }
    } finally {
      setBusy(false)
    }
  }

  useInput((inputChar, key) => {
    if (key.return) {
      void submit()
    } else if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1))
    } else if (key.escape) {
      exit()
    } else if (inputChar && !key.ctrl) {
      setInput((prev) => prev + inputChar)
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <TitleBar title={title} ctx={ctx} busy={busy} messageCount={messages.length} />
      <Box flexDirection="column" minHeight={10}>
        {messages.map((m) => (
          <Message key={m.id} msg={m} streaming={streamingRef.current === m.id} />
        ))}
        {traces.map((t) => (
          <Trace key={t.id} trace={t} />
        ))}
      </Box>
      <InputLine text={input} busy={busy} />
    </Box>
  )
}

/** 标题栏：模型 / 会话数 / 运行状态。 */
function TitleBar({
  title,
  ctx,
  busy,
  messageCount,
}: {
  title: string
  ctx: Context
  busy: boolean
  messageCount: number
}) {
  return (
    <Box justifyContent="space-between">
      <Text bold color="cyan">
        {title}
      </Text>
      <Text dimColor>
        {ctx.llm.provider}/{ctx.llm.model} · {messageCount} 条消息
        {busy ? ' · …运行中' : ''}
      </Text>
    </Box>
  )
}

/** 单条消息气泡。 */
function Message({ msg, streaming }: { msg: UiMessage; streaming: boolean }) {
  if (msg.kind === 'user') {
    return (
      <Box>
        <Text color="green" bold>
          你 ›{' '}
        </Text>
        <Text>{msg.text}</Text>
      </Box>
    )
  }
  return (
    <Box>
      <Text color="cyan" bold>
        助手 ›{' '}
      </Text>
      <Text>
        {msg.text}
        {streaming ? '▌' : ''}
      </Text>
    </Box>
  )
}

/** 工具调用轨迹。 */
function Trace({ trace }: { trace: ToolTrace }) {
  return (
    <Box flexDirection="column" marginLeft={4}>
      <Text color="yellow" dimColor>
        → {trace.tool}({trace.args})
      </Text>
      {trace.result !== undefined && (
        <Text color="yellow" dimColor>
          ← {trace.result}
        </Text>
      )}
    </Box>
  )
}

/** 底部输入行。 */
function InputLine({ text, busy }: { text: string; busy: boolean }) {
  return (
    <Box marginTop={1}>
      <Text color="green" bold>
        {'> '}
      </Text>
      <Text>
        {text}
        <Text color={busy ? 'gray' : 'green'}>▌</Text>
      </Text>
      {!text && !busy && <Text dimColor> 输入消息（Enter 发送，Esc 退出）</Text>}
    </Box>
  )
}
