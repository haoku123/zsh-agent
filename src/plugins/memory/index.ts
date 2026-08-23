/**
 * Memory 插件入口 —— 第 8 课。
 *
 * 提供 ctx.memory：长期记忆的读写与检索。
 * 短期记忆（session）已由 session 插件管理，本插件只负责「跨会话持久」那部分。
 *
 * 你要写的核心：recall() 的检索打分算法（TODO 见下方）。
 */
import path from 'node:path'
import type { Context } from '../../core/context.js'
import { FileMemoryStore } from './store.js'
import type { MemoryEntry, MemoryService, RememberOptions } from './types.js'

export function memoryPlugin(ctx: Context, config: { file?: string } = {}): void {
  const store = new FileMemoryStore(
    config.file ?? path.join(process.cwd(), '.agent', 'memory.json'),
  )

  const service: MemoryService = {
    remember(content: string, options: RememberOptions = {}): MemoryEntry {
      const entry: MemoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content,
        namespace: options.namespace ?? 'default',
        keywords: options.keywords ?? [],
        importance: options.importance ?? 0.5,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      }
      store.put(entry)
      return entry
    },

    recall(query: string, limit = 5): MemoryEntry[] {
      // ============ TODO（你来写 · 核心算法） ============
      // 目标：从 store 里挑出和 query 最相关的 top-N 条记忆。
      //
      // 思路参考：
      //   1. 给每条记忆打分（score）：
      //      - 关键词命中：把 query 分词后，命中 keywords / content 的次数越多分越高
      //      - 重要度加权：乘以 importance（0~1）
      //      - 时间衰减：lastAccessedAt 越久远，稍微降权（可选）
      //   2. 按 score 降序排序，取前 limit 条
      //   3. 命中条记得更新 lastAccessedAt（LRU），并写回 store
      //
      // 中文不用做复杂分词：按空白 + 常见标点切词即可，甚至直接子串匹配也能用。
      // 能跑通、结果"看起来相关"就算合格——以后想升级成向量检索，接口不用动。
      // ==================================================

      const q = query.toLowerCase()
      // 中文不空格，split 切出来是整句；整句子串匹配才是最可靠的召回信号
      const tokens = q.split(/[\s,.!?;:，。！？；：'"()（）]+/).filter(Boolean)
      const queryBigrams = bigrams(q)

      const scored = store.all().map((e) => {
        const content = e.content.toLowerCase()
        const keywords = e.keywords.map((k) => k.toLowerCase())
        let hit = 0
        // 与某个 keyword 双向包含：整句 query 也能命中短关键词
        if (keywords.some((k) => k.includes(q) || q.includes(k))) hit += 2
        // bigram 重合度（中文模糊匹配核心）：计算 query 与内容共享的二元组比例
        const contentBigrams = bigrams(content)
        let shared = 0
        for (const b of queryBigrams) if (contentBigrams.has(b)) shared++
        const overlap = shared / Math.max(1, queryBigrams.size)
        hit += overlap * 3
        for (const token of tokens) {
          if (content.includes(token)) hit++
          if (keywords.some((k) => k.includes(token) || token.includes(k))) hit++
        }
        const decay = 1 / (1 + (Date.now() - e.lastAccessedAt) / 86_400_000)
        const score = hit * e.importance * decay
        return { entry: e, score }
      })
      .filter(e=>e.score>0)
      .sort((a,b)=>b.score-a.score)
      .slice(0,limit)

      for(const { entry } of scored){
        entry.lastAccessedAt = Date.now()
        store.put(entry)
      }
      return scored.map(e=>e.entry)
    },

    forget(id: string): void {
      store.remove(id)
    },

    list(namespace?: string): MemoryEntry[] {
      const all = store.all()
      return namespace ? all.filter((e) => e.namespace === namespace) : all
    },
  }

  ctx.provide('memory', service)
}

/** 把字符串切成二元组（bigram）集合，用于中文模糊匹配。 */
function bigrams(s: string): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) {
    set.add(s.slice(i, i + 2))
  }
  return set
}
