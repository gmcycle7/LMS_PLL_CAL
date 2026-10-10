/**
 * 驗證狀態與勘誤的彙整（純函式；資料來源為 src/data/errata.json 與 src/data/verification-status.json）。
 * 不得把未知狀態當作通過：缺漏或格式不符一律算 'missing'。
 */
import errataFile from '@/data/errata.json'
import statusFile from '@/data/verification-status.json'
import goldenIndex from '../../../golden/vectors/index.json'
import { getTestStatus, type TestStatus } from '@/components'

export type Severity = 'high' | 'medium' | 'low'
export const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low']
export const SEVERITY_LABEL: Record<Severity, string> = { high: '高 high', medium: '中 medium', low: '低 low' }

export interface Erratum {
  eid: string
  id: string
  severity: Severity
  area: string
  chapters: string[]
  location: string
  problem: string
  correction: string
}

function isErratum(v: unknown): v is Erratum {
  const e = v as Partial<Erratum> | null
  return (
    !!e &&
    typeof e.eid === 'string' &&
    typeof e.area === 'string' &&
    (e.severity === 'high' || e.severity === 'medium' || e.severity === 'low') &&
    Array.isArray(e.chapters)
  )
}

/** errata.json → 型別安全的清單（格式不符的條目略過） */
export function readErrata(file: unknown = errataFile): Erratum[] {
  const list = (file as { errata?: unknown[] } | null)?.errata
  return Array.isArray(list) ? list.filter(isErratum) : []
}

export const ERRATA: Erratum[] = readErrata()

export function erratumById(eid: string): Erratum | undefined {
  return ERRATA.find((e) => e.eid === eid)
}

export interface ErrataSummary {
  total: number
  bySeverity: Record<Severity, number>
  /** 頁面 id → 該頁相關的勘誤數（'all' 另計） */
  byPage: Record<string, number>
  /** chapters 含 'all' 的全站勘誤 */
  global: number
  /** 依領域（area）分組 */
  byArea: { area: string; count: number }[]
  high: Erratum[]
}

export function summarizeErrata(list: Erratum[] = ERRATA): ErrataSummary {
  const bySeverity: Record<Severity, number> = { high: 0, medium: 0, low: 0 }
  const byPage: Record<string, number> = {}
  const areas = new Map<string, number>()
  let global = 0
  for (const e of list) {
    bySeverity[e.severity]++
    areas.set(e.area, (areas.get(e.area) ?? 0) + 1)
    if (e.chapters.includes('all')) global++
    for (const ch of e.chapters) if (ch !== 'all') byPage[ch] = (byPage[ch] ?? 0) + 1
  }
  return {
    total: list.length,
    bySeverity,
    byPage,
    global,
    byArea: [...areas.entries()].map(([area, count]) => ({ area, count })).sort((a, b) => b.count - a.count),
    high: list.filter((e) => e.severity === 'high'),
  }
}

/** 規格 §17 的 18 個 acceptance tests */
export const T_IDS: string[] = Array.from({ length: 18 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`)

export interface TestSummary {
  counts: Record<TestStatus, number>
  generatedAt?: string
  byId: { id: string; status: TestStatus; description?: string; section?: string }[]
}

interface GoldenIndexEntry {
  id?: unknown
  description_zh?: unknown
  spec_section?: unknown
}

export function goldenDescription(id: string, index: unknown = goldenIndex): { description?: string; section?: string } {
  const list = (index as { vectors?: GoldenIndexEntry[] } | null)?.vectors
  const hit = Array.isArray(list) ? list.find((v) => v.id === id) : undefined
  return {
    description: typeof hit?.description_zh === 'string' ? hit.description_zh : undefined,
    section: typeof hit?.spec_section === 'string' ? hit.spec_section : undefined,
  }
}

export function summarizeTests(file: unknown = statusFile, index: unknown = goldenIndex): TestSummary {
  const counts: Record<TestStatus, number> = { pass: 0, partial: 0, fail: 0, missing: 0 }
  const byId = T_IDS.map((id) => {
    const s = getTestStatus(id, file).status
    counts[s]++
    return { id, status: s, ...goldenDescription(id, index) }
  })
  const gen = (file as { generatedAt?: unknown } | null)?.generatedAt
  return { counts, byId, generatedAt: typeof gen === 'string' ? gen : undefined }
}
