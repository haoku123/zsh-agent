/**
 * LLM 插件入口。
 *
 * 读 .env 选 provider，用 OpenAI SDK 调 DeepSeek / GLM（两者都是 OpenAI 兼容 API）。
 * provide 成 ctx.llm，Agent Loop 只认 LLMService，不认具体厂商。
 */
import { config as loadEnv } from 'dotenv'
import OpenAI from 'openai'
import type { Context } from '../../core/context.js'
import type { Tool } from '../tools/types.js'
import type { ChatRequest, ChatResponse, LLMConfig, LLMService, ToolCall } from './types.js'

type Provider = 'deepseek' | 'glm'

interface ProviderConfig {
  apiKey: string | undefined
  baseURL: string
  model: string
}

/** 读取某个 provider 的连接参数。 */
function resolveProviderConfig(provider: Provider): ProviderConfig {
  if (provider === 'deepseek') {
    return {
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    }
  }
  return {
    apiKey: process.env.GLM_API_KEY,
    baseURL: process.env.GLM_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4',
    model: process.env.GLM_MODEL ?? 'glm-4.5',
  }
}

/** 把 harness 的 Tool 转成 OpenAI function 格式。 */
function toOpenAITool(tool: Tool): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.schema as unknown as OpenAI.FunctionParameters,
    },
  }
}

/** 解析模型返回的 tool_calls。 */
function parseToolCalls(raw: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]): ToolCall[] {
  return raw.map((tc) => {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(tc.function.arguments) as Record<string, unknown>
    } catch {
      args = { _raw: tc.function.arguments }
    }
    return { id: tc.id, name: tc.function.name, args }
  })
}

/** 从 OpenAI 兼容响应里取文本（GLM 带 tools 时 content 可能为空，正文在 reasoning_content）。 */
function extractContent(message: OpenAI.Chat.Completions.ChatCompletionMessage | undefined): string | null {
  if (!message) return null
  const text = message.content?.trim()
  if (text) return text
  const reasoning = (message as OpenAI.Chat.Completions.ChatCompletionMessage & {
    reasoning_content?: string | null
  }).reasoning_content?.trim()
  return reasoning || null
}

export function llmPlugin(ctx: Context, pluginConfig: LLMConfig = {}): void {
  // 插件挂载时加载 .env（main-llm.ts 也可提前 import 'dotenv/config'）
  loadEnv()

  const provider = (pluginConfig.provider ?? process.env.PROVIDER ?? 'deepseek') as Provider
  if (provider !== 'deepseek' && provider !== 'glm') {
    throw new Error(`[llm] 未知 PROVIDER="${provider}"，仅支持 deepseek | glm`)
  }

  const { apiKey, baseURL, model } = resolveProviderConfig(provider)
  if (!apiKey) {
    throw new Error(
      `[llm] ${provider} 缺少 API Key，请在 .env 中设置 ${
        provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'GLM_API_KEY'
      }`,
    )
  }

  const client = new OpenAI({ apiKey, baseURL })

  const service: LLMService = {
    provider,
    model,

    async chat(request: ChatRequest): Promise<ChatResponse> {
      const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
        model,
        messages: request.messages,
      }

      if (request.tools && request.tools.length > 0) {
        params.tools = request.tools.map(toOpenAITool)
        params.tool_choice = 'auto'
      }

      const completion = await client.chat.completions.create(params)
      const message = completion.choices[0]?.message

      return {
        content: extractContent(message),
        toolCalls: message?.tool_calls ? parseToolCalls(message.tool_calls) : [],
      }
    },

    async chatStream(
      request: ChatRequest,
      onDelta: (delta: string) => void,
    ): Promise<ChatResponse> {
      const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
        model,
        messages: request.messages,
        stream: true,
      }
      if (request.tools && request.tools.length > 0) {
        params.tools = request.tools.map(toOpenAITool)
        params.tool_choice = 'auto'
      }

      const stream = await client.chat.completions.create(params)

      // 文本：逐段累积；tool_calls：按 index 分片累积（流式的参数是碎块到达的）
      let content = ''
      let reasoning = ''
      const pending = new Map<number, { id: string; name: string; args: string }>()

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta
        if (delta?.content) {
          content += delta.content
          onDelta(delta.content)
        }
        // GLM 等 reasoning 模型：正文偶发全在 reasoning_content（content 为空），
        // 累积兜底（语义与上方 extractContent 一致）。
        // content 尚未出现时先转发 reasoning 增量，保证打字机输出不中断。
        const rc = (delta as unknown as { reasoning_content?: string | null })
          .reasoning_content
        if (rc) {
          reasoning += rc
          if (!content) onDelta(rc)
        }
        for (const tc of delta?.tool_calls ?? []) {
          const slot = pending.get(tc.index) ?? { id: '', name: '', args: '' }
          if (tc.id) slot.id = tc.id
          if (tc.function?.name) slot.name += tc.function.name
          if (tc.function?.arguments) slot.args += tc.function.arguments
          pending.set(tc.index, slot)
        }
      }

      const toolCalls: ToolCall[] = []
      for (const slot of pending.values()) {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(slot.args) as Record<string, unknown>
        } catch {
          args = { _raw: slot.args }
        }
        toolCalls.push({ id: slot.id, name: slot.name, args })
      }

      return { content: content || reasoning || null, toolCalls }
    },
  }

  ctx.provide('llm', service)
}
