/**
 * Tools 相关类型定义。
 */

// ==================== 工具定义 ====================

/** JSON Schema 风格的工具参数描述（告诉模型参数格式）。 */
export interface ToolSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

/** 一个工具。 */
export interface Tool {
  /** 工具名，模型用它调用。 */
  name: string
  /** 给模型看的说明。 */
  description: string
  /** 参数 JSON Schema。 */
  schema: ToolSchema
  /** 真正的执行逻辑。 */
  execute(args: Record<string, unknown>): unknown | Promise<unknown>
  /** 是否为危险操作（如执行 shell）。守卫流水线可据此拦截。 */
  dangerous?: boolean
}

/** 一次工具调用请求（守卫流水线的 payload）。 */
export interface ToolRequest {
  name: string
  args: Record<string, unknown>
}

// ==================== 服务接口 ====================

/** ctx.tools 服务的对外接口。 */
export interface ToolRegistry {
  /** 注册一个工具。 */
  register(tool: Tool): void
  /** 按名取工具。 */
  get(name: string): Tool | undefined
  /** 列出全部工具（按名排序，供 LLM 生成 schema 列表）。 */
  list(): Tool[]
  /**
   * 执行工具，走守卫流水线（waterfall 'tools/execute'）。
   * 守卫可以短路（返回对象含 error），或改写 req.args。
   */
  execute(name: string, args: Record<string, unknown>): Promise<unknown>
}

// ==================== 扩展 ctx ====================

declare global {
  interface HarnessServices {
    tools: ToolRegistry
  }
  interface HarnessMiddlewares {
    /** 工具执行流水线。payload 是请求，next() 是真正的 execute。 */
    'tools/execute': (
      req: ToolRequest,
      next: () => unknown,
    ) => unknown
  }
}
