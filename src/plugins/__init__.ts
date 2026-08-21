/**
 * 插件目录。
 *
 * 这里放 harness 的各个功能插件。每个插件都是一个「挂载到 ctx 上的模块」，
 * 通过 ctx.provide() 提供服务，或 ctx.on()/ctx.use() 挂事件。
 *
 * 目录规划：
 *   session.ts   — 第 3 课：append-only 日志（唯一真相源）【你来写】
 *   llm.ts       — 第 5 课：LLM 适配器 seam（DeepSeek/GLM）【待写】
 *   tools.ts     — 第 4 课：工具注册表 + 守卫流水线【待写】
 *   agent_loop.ts— 第 6 课：Agent 主循环驱动器【待写】
 */
