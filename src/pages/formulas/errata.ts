import errataData from '@/data/errata.json'

/**
 * docs/validation.md 的勘誤（49 項）在 src/data/errata.json 的機器可讀版本。
 * 本頁只讀取；勘誤詳細內容由 /verification 頁依 ID 列出。
 */
export interface ErratumRecord {
  eid: string
  id: string
  severity: 'high' | 'medium' | 'low' | string
  area: string
  chapters: string[]
  location: string
  problem: string
  correction: string
  evidence: string
}

export const ERRATA: readonly ErratumRecord[] = (errataData as { errata: ErratumRecord[] }).errata

const BY_ID = new Map(ERRATA.map((e) => [e.eid, e]))

export function erratumById(eid: string): ErratumRecord | undefined {
  return BY_ID.get(eid)
}

export function erratumExists(eid: string): boolean {
  return BY_ID.has(eid)
}

/** 'E07' 形式的勘誤 ID */
export const ERRATUM_ID = /^E\d{2}$/

/** 嚴重度的中文 */
export const SEVERITY_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' }

/** tooltip 用的短摘要：修正內容前 n 個字 */
export function erratumSummary(eid: string, n = 180): string {
  const r = BY_ID.get(eid)
  if (!r) return `${eid}（找不到此勘誤）`
  const c = r.correction.replace(/\s+/g, ' ')
  return `${eid}｜${r.area}｜嚴重度 ${SEVERITY_LABEL[r.severity] ?? r.severity}：${c.length > n ? `${c.slice(0, n)}…` : c}`
}
