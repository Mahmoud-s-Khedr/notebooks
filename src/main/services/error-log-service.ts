import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type Database from 'better-sqlite3'
import type { DiagnosticEvent, ErrorEvent, ErrorEventFilter, ErrorProcess, ErrorSeverity, RendererErrorReport } from '../../shared/domain'

export type ErrorLogInput = {
  severity?: ErrorSeverity; process: ErrorProcess; layer: string; category: string; code?: string | null
  context?: Record<string, unknown>; operationId?: string | null; ipcId?: string | null; stack?: string | null; causeChain?: string | null
}

const MAX_TEXT = 250_000
const max = (value: string, length = MAX_TEXT) => value.length > length ? `${value.slice(0, length)}\n[truncated]` : value
const secretKey = /(?:api[_-]?key|token|authorization|password|secret|credential|cookie|session)/i
const redacted = '[REDACTED]'

/** Keep local paths and diagnostic detail, but never persist known credentials. */
export function redact(value: string): string {
  return max(value
    .replace(/((?:["']?(?:api[_-]?key|token|authorization|password|secret|credential)["']?)\s*[=:]\s*["']?)([^\s,"']+)/gi, `$1${redacted}`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${redacted}`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, redacted)
    .replace(/([?&](?:api[_-]?key|token|access_token|password)=)[^&#\s]+/gi, `$1${redacted}`))
}

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[max depth]'
  if (typeof value === 'string') return redact(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeValue(item, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, item]) => [key, secretKey.test(key) ? redacted : safeValue(item, depth + 1)]))
  return typeof value === 'undefined' ? null : redact(String(value))
}

function details(error: unknown): { message: string; stack: string | null; causeChain: string | null } {
  if (error instanceof Error) {
    const causes: string[] = []; let cause: unknown = (error as Error & { cause?: unknown }).cause
    while (cause && causes.length < 8) {
      if (cause instanceof Error) { causes.push(`${cause.name}: ${cause.message}${cause.stack ? `\n${cause.stack}` : ''}`); cause = (cause as Error & { cause?: unknown }).cause }
      else { causes.push(String(cause)); break }
    }
    return { message: redact(error.message || error.name), stack: error.stack ? redact(error.stack) : null, causeChain: causes.length ? redact(causes.join('\nCaused by: ')) : null }
  }
  return { message: redact(typeof error === 'string' ? error : String(error ?? 'Unknown error')), stack: null, causeChain: null }
}

type StoredRow = { id: string; created_at: string; severity: ErrorSeverity; process: ErrorProcess; layer: string; category: string; code: string | null; message: string; stack: string | null; cause_chain: string | null; context_json: string; app_version: string | null; operation_id: string | null; ipc_id: string | null }

function eventFrom(row: StoredRow): ErrorEvent {
  let context: Record<string, unknown> = {}
  try { context = JSON.parse(row.context_json) as Record<string, unknown> } catch { context = { parseError: 'Stored diagnostic context was malformed.' } }
  return { id: row.id, createdAt: row.created_at, severity: row.severity, process: row.process, layer: row.layer, category: row.category, code: row.code, message: row.message, stack: row.stack, causeChain: row.cause_chain, context, appVersion: row.app_version, operationId: row.operation_id, ipcId: row.ipc_id }
}

/** The sole persistent error writer. Its failures are intentionally swallowed. */
export class ErrorLogService {
  private releaseCount = 0

  constructor(private readonly db: Database.Database, private readonly fallbackPath: string, private readonly appVersion: string | null, private readonly retainAll: boolean) {
    if (!retainAll) this.releaseCount = (db.prepare('SELECT COUNT(*) AS count FROM error_events').get() as { count: number }).count
    this.importFallback()
  }

  record(error: unknown, input: ErrorLogInput): void {
    const detail = details(error)
    this.write({
      id: randomUUID(), createdAt: new Date().toISOString(), severity: input.severity ?? 'error', process: input.process, layer: redact(input.layer), category: redact(input.category), code: input.code ? redact(input.code) : null,
      message: detail.message, stack: input.stack === undefined ? detail.stack : input.stack ? redact(input.stack) : null, causeChain: input.causeChain === undefined ? detail.causeChain : input.causeChain ? redact(input.causeChain) : null,
      context: safeValue(input.context ?? {}) as Record<string, unknown>, appVersion: this.appVersion, operationId: input.operationId ?? null, ipcId: input.ipcId ?? null
    })
  }

  reportRenderer(report: RendererErrorReport): void {
    this.record(report.message, { severity: report.severity ?? 'error', process: 'renderer', layer: 'renderer', category: report.category, stack: report.stack ?? null, causeChain: report.causeChain ?? null, context: report.context, operationId: report.operationId ?? null })
  }

  list(filter: ErrorEventFilter = {}): ErrorEvent[] {
    const clauses: string[] = []; const values: unknown[] = []
    if (filter.process) { clauses.push('process = ?'); values.push(filter.process) }
    if (filter.category) { clauses.push('category = ?'); values.push(filter.category) }
    if (filter.severity) { clauses.push('severity = ?'); values.push(filter.severity) }
    const limit = Math.max(1, Math.min(filter.limit ?? 200, 1000))
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    return (this.db.prepare(`SELECT * FROM error_events ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(...values, limit) as StoredRow[]).map(eventFrom)
  }

  get(id: string): ErrorEvent | null { const row = this.db.prepare('SELECT * FROM error_events WHERE id = ?').get(id) as StoredRow | undefined; return row ? eventFrom(row) : null }

  export(destination: string, jobs: DiagnosticEvent[]): string {
    const filename = join(destination, `research-notebook-diagnostics-${Date.now()}.txt`)
    const fullErrors = this.db.prepare('SELECT * FROM error_events ORDER BY created_at DESC, rowid DESC').all() as StoredRow[]
    const lines = ['Research Notebook diagnostics', `Exported: ${new Date().toISOString()}`, '', 'ERROR EVENTS']
    for (const event of fullErrors.map(eventFrom)) lines.push(JSON.stringify(event, null, 2), '')
    lines.push('JOB DIAGNOSTICS')
    for (const event of jobs) lines.push(`${event.createdAt}\t${event.category}\t${event.outcome}\t${event.code ?? ''}\t${event.message ?? ''}\t${event.durationMs ?? ''}`)
    writeFileSync(filename, lines.join('\n'), { mode: 0o600 })
    return filename
  }

  private write(event: ErrorEvent): void {
    try {
      this.db.prepare('INSERT INTO error_events (id,created_at,severity,process,layer,category,code,message,stack,cause_chain,context_json,app_version,operation_id,ipc_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(event.id, event.createdAt, event.severity, event.process, event.layer, event.category, event.code, event.message, event.stack, event.causeChain, JSON.stringify(event.context), event.appVersion, event.operationId, event.ipcId)
      if (!this.retainAll) {
        this.releaseCount += 1
        if (this.releaseCount > 5000) {
          this.db.prepare('DELETE FROM error_events WHERE id NOT IN (SELECT id FROM error_events ORDER BY created_at DESC, rowid DESC LIMIT 5000)').run()
          this.releaseCount = 5000
        }
      }
    } catch { appendFallbackEvent(this.fallbackPath, event) }
  }

  private importFallback(): void {
    if (!existsSync(this.fallbackPath)) return
    const imported = `${this.fallbackPath}.importing`
    try {
      renameSync(this.fallbackPath, imported)
      for (const line of readFileSync(imported, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try { const event = JSON.parse(line) as ErrorEvent; if (event?.id && event.createdAt && event.message) this.write(event) } catch { /* Skip a torn fallback line. */ }
      }
      unlinkSync(imported)
    } catch { try { if (existsSync(imported) && !existsSync(this.fallbackPath)) renameSync(imported, this.fallbackPath) } catch { /* No further recovery path. */ } }
  }
}

export function appendFallbackError(path: string, error: unknown, input: Omit<ErrorLogInput, 'process'> & { process?: ErrorProcess }, appVersion: string | null = null): void {
  const detail = details(error)
  appendFallbackEvent(path, { id: randomUUID(), createdAt: new Date().toISOString(), severity: input.severity ?? 'fatal', process: input.process ?? 'main', layer: redact(input.layer), category: redact(input.category), code: input.code ? redact(input.code) : null, message: detail.message, stack: input.stack === undefined ? detail.stack : input.stack ? redact(input.stack) : null, causeChain: input.causeChain === undefined ? detail.causeChain : input.causeChain ? redact(input.causeChain) : null, context: safeValue(input.context ?? {}) as Record<string, unknown>, appVersion, operationId: input.operationId ?? null, ipcId: input.ipcId ?? null })
}

function appendFallbackEvent(path: string, event: ErrorEvent): void {
  try { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify(event)}\n`, { mode: 0o600 }) } catch { /* Logging must never hide the original failure. */ }
}
