import statusFile from '@/data/verification-status.json'

/**
 * 讀取 src/data/verification-status.json（由 `npm run verify` 產生）的純函式。
 */

/** verification-status.json 中單一 T-id 的狀態 */
export type TestStatus = 'pass' | 'partial' | 'fail' | 'missing'

export interface TestStatusInfo {
  id: string
  status: TestStatus
  tsPassed: number
  tsFailed: number
  pyPassed: number
  pyFailed: number
  names: string[]
}

interface RawSide {
  passed?: unknown
  failed?: unknown
  names?: unknown
}

const STATUSES: readonly TestStatus[] = ['pass', 'partial', 'fail', 'missing']

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function names(side: RawSide | undefined, prefix: string): string[] {
  const n = side?.names
  return Array.isArray(n) ? n.filter((x): x is string => typeof x === 'string').map((s) => `${prefix} ${s}`) : []
}

/**
 * 讀取某 T-id 的驗證狀態。檔案缺少該 id 或格式不符時一律視為 'missing'，
 * 絕不把未知狀態當成通過。
 */
export function getTestStatus(id: string, file: unknown = statusFile): TestStatusInfo {
  const tests = (file as { tests?: Record<string, unknown> } | null)?.tests
  const raw = (tests && typeof tests === 'object' ? tests[id] : undefined) as
    | { status?: unknown; ts?: RawSide; py?: RawSide }
    | undefined
  const status: TestStatus =
    raw && typeof raw.status === 'string' && (STATUSES as readonly string[]).includes(raw.status)
      ? (raw.status as TestStatus)
      : 'missing'
  return {
    id,
    status,
    tsPassed: num(raw?.ts?.passed),
    tsFailed: num(raw?.ts?.failed),
    pyPassed: num(raw?.py?.passed),
    pyFailed: num(raw?.py?.failed),
    names: [...names(raw?.ts, '[TS]'), ...names(raw?.py, '[PY]')],
  }
}

export const TEST_STATUS_LABEL: Record<TestStatus, string> = {
  pass: 'verified',
  partial: 'partial',
  fail: 'fail',
  missing: 'pending',
}
