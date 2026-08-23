/**
 * Session 日志存储核心 —— append-only 数组 + id 生成。
 *
 * 只负责「存」，不负责「通知」和「投影」。
 * 它是一块纯数据逻辑，方便单独测试，也便于未来接入持久化。
 */
import type { SessionEvent, SessionEventType } from './types.js'

export class SessionLog {
  private _events: SessionEvent[] = []
  private _nextId = 0

  /** 追加一条事件，返回带 id/timestamp 的日志条目。 */
  push<T extends { type: SessionEventType }>(e: T): SessionEvent {
    const entry: SessionEvent = {
      id: this._nextId++,
      timestamp: Date.now(),
      type: e.type,
      payload: e,
    }
    this._events.push(entry)
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
  }

  get length(): number {
    return this._events.length
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
