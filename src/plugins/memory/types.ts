/**
 * Memory 相关类型定义。
 *
 * 第 8 课：长期记忆（跨会话持久）。
 *
 * 记忆分层一句话：
 *   - 短期记忆 = session 日志（当前对话，append-only，会话结束即消失）
 *   - 长期记忆 = 本插件（跨会话，存文件，按需检索注入上下文）
 */
import type { Context } from '../../core/context.js'

// ==================== 记忆条目 ====================

/** 一条长期记忆。 */
export interface MemoryEntry {
  /** 唯一 id。 */
  id: string
  /** 记忆内容（纯文本）。 */
  content: string
  /** 命名空间，如 'user/profile' / 'project/learnings'，便于分类管理。 */
  namespace: string
  /** 关联关键词，检索时用。 */
  keywords: string[]
  /** 重要度 0~1，检索排序加权。 */
  importance: number
  /** 创建时间。 */
  createdAt: number
  /** 最后访问时间（LRU / 时间衰减用）。 */
  lastAccessedAt: number
}

/** 存储后端接口。目前用文件 JSON，未来可换成 SQLite / 向量库。 */
export interface MemoryStore {
  /** 全部记忆（未排序）。 */
  all(): MemoryEntry[]
  /** 按 id 取。 */
  get(id: string): MemoryEntry | undefined
  /** 写入或覆盖。 */
  put(entry: MemoryEntry): void
  /** 删除。 */
  remove(id: string): void
}

// ==================== 服务接口 ====================

/** 写记忆时的选项。 */
export interface RememberOptions {
  namespace?: string
  keywords?: string[]
  importance?: number
}

/** ctx.memory 服务的对外接口。 */
export interface MemoryService {
  /**
   * 写入一条长期记忆。
   * TODO（你来写）：生成 id、落 store、持久化。
   */
  remember(content: string, options?: RememberOptions): MemoryEntry
  /**
   * 检索最相关的记忆（top-N）。
   * TODO（你来写 · 核心算法）：打分排序，取前 limit 条。
   */
  recall(query: string, limit?: number): MemoryEntry[]
  /** 删除一条记忆。 */
  forget(id: string): void
  /** 列出某个 namespace 下的全部记忆。 */
  list(namespace?: string): MemoryEntry[]
}

// ==================== 扩展 ctx ====================

declare global {
  interface HarnessServices {
    memory: MemoryService
  }
}

// 避免 types 文件被当成纯声明文件
export type _MemoryContext = Context
