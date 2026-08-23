/**
 * Session 日志存储核心 —— append-only 数组 + id 生成 + JSONL 持久化。
 *
 * 只负责「存」，不负责「通知」和「投影」。
 * 它是一块纯数据逻辑，方便单独测试，也便于未来接入持久化。
 *
 * 持久化设计（Pi 的 Transcript 风格）：
 *   - 格式：JSONL（每行一条事件，追加写），事件溯源的标准做法
 *   - push 时同步追加一行到文件（磁盘 + 内存双重真相源）
 *   - 启动时 load() 逐行恢复，_nextId 从最后一条的 id+1 继续
 *   - 落盘失败只 console.warn 不崩溃（内存仍可用）
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { SessionEvent, SessionEventType } from './types.js'

export class SessionLog {
  private _events: SessionEvent[] = []
  private _nextId = 0
  private _file: string | null = null

  /** 启用 JSONL 持久化（不调用则纯内存）。 */
  enablePersistence(file: string): void {
    this._file = file
    this.load()
  }

  /** 追加一条事件，返回带 id/timestamp 的日志条目。 */
  push<T extends { type: SessionEventType }>(e: T): SessionEvent {
    const entry: SessionEvent = {
      id: this._nextId++,
      timestamp: Date.now(),
      type: e.type,
      payload: e,
    }
    this._events.push(entry)
    this.append(entry)
    return entry
  }

  /** 取全部（深拷贝，外部无法篡改日志 —— append-only 铁律）。 */
  all(): SessionEvent[] {
    return this._events.map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      type: e.type,
      payload: structuredClone(e.payload),
    }))
  }

  /** 取 id <= boundaryId 的事件（fork 用）。 */
  before(boundaryId: number): SessionEvent[] {
    return this._events.filter((e) => e.id <= boundaryId).map(clone)
  }

  /** 清空日志（新会话用）。 */
  clear(): void {
    this._events = []
    this._nextId = 0
    if (this._file) {
      try {
        writeFileSync(this._file, '')
      } catch (err) {
        console.warn('[session] 清空持久化失败:', err)
      }
    }
  }

  get length(): number {
    return this._events.length
  }

  // ==================== 持久化 ====================

  /** 追加写一行 JSONL。 */
  private append(entry: SessionEvent): void {
    if (!this._file) return
    try {
      appendFileSync(this._file, JSON.stringify(entry) + '\n', 'utf-8')
    } catch (err) {
      console.warn('[session] 落盘失败:', err)
    }
  }

  /** 启动时从 JSONL 恢复历史。 */
  private load(): void {
    if (!this._file) return
    let raw: string
    try {
      raw = readFileSync(this._file, 'utf-8')
    } catch {
      return // 文件不存在 = 新会话
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const entry = JSON.parse(trimmed) as SessionEvent
        this._events.push(entry)
        if (entry.id >= this._nextId) this._nextId = entry.id + 1
      } catch {
        // 跳过损坏行，不整体崩溃
        console.warn('[session] 忽略损坏的日志行')
      }
    }
    // 确保目录存在（首次写入前）
    if (this._file) mkdirSync(path.dirname(this._file), { recursive: true })
  }
}

/** 深拷贝一条事件。 */
function clone(e: SessionEvent): SessionEvent {
  return {
    id: e.id,
    timestamp: e.timestamp,
    type: e.type,
    payload: structuredClone(e.payload),
  }
}
