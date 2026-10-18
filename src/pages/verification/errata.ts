/**
 * 勘誤資料（src/data/errata.json，由 49 項規格驗算勘誤組成；docs/validation.md）的型別、篩選與深連結工具（純函式）。
 *
 * 深連結採 HashRouter 相容的 query：#/verification?e=E05（捲動到勘誤 E05），#/verification?t=T05（捲動到驗收列 T05）。
 * 頁面上每張勘誤卡片的 DOM id 就是 "E05"。
 */
import errataFile from '@/data/errata.json'

export type Severity = 'high' | 'medium' | 'low'

export interface Erratum {
  eid: string
  id: string
  severity: Severity
  area: string
  chapters: string[]
  location: string
  problem: string
  correction: string
  evidence: string
}

interface ErrataFile {
  generatedFrom: string
  date: string
  errata: Erratum[]
}

const FILE = errataFile as ErrataFile

export const ERRATA: Erratum[] = FILE.errata
export const ERRATA_META = { generatedFrom: FILE.generatedFrom, date: FILE.date }

export const SEVERITY_LABEL: Record<Severity, string> = { high: 'high 嚴重', medium: 'medium 中', low: 'low 輕微' }
export const SEVERITIES: Severity[] = ['high', 'medium', 'low']

/** 章節代號 → 顯示與路由（'all' = 全文符號／單位一致性） */
export function chapterLabel(ch: string): string {
  if (ch === 'all') return '全文'
  const m = /^ch(\d{2})$/.exec(ch)
  return m ? `Ch${m[1]}` : ch
}

export function chapterHref(ch: string): string | null {
  const m = /^ch(\d{2})$/.exec(ch)
  return m ? `#/ch/${m[1]}` : null
}

/** 勘誤 id 是否合法（E01–E99 格式且存在於資料中） */
export function erratumById(eid: string | null | undefined): Erratum | undefined {
  if (!eid) return undefined
  const key = eid.trim().toUpperCase()
  return ERRATA.find((e) => e.eid === key)
}

/** 由勘誤文字找出提到的 T-id（例如「§17 T12」「T14 改為…」），去重後排序 */
export function mentionedTests(e: Erratum): string[] {
  const text = `${e.location} ${e.problem} ${e.correction}`
  const set = new Set<string>()
  for (const m of text.matchAll(/T(0[1-9]|1[0-8])(?!\d)/g)) set.add(`T${m[1]}`)
  return [...set].sort()
}

export interface ErrataFilter {
  severity: Severity | 'all'
  area: string // 'all' 或 area 字串
  chapter: string // 'all-chapters' 或 'ch05'、'all'（全文）
  query: string
  /** 只看與 T01–T18 有關的勘誤（由驗收表的對照或內文提到的 T-id） */
  onlyAcceptance: boolean
  /** 只看本頁有「即時重算證據」的勘誤 */
  onlyLive: boolean
}

export const DEFAULT_FILTER: ErrataFilter = { severity: 'all', area: 'all', chapter: 'all-chapters', query: '', onlyAcceptance: false, onlyLive: false }

/**
 * 篩選勘誤；relatedTests 為「勘誤 → T-id」對照（驗收表 + 內文提及的聯集），
 * hasLive 回答某勘誤是否有即時重算的證據（省略時 onlyLive 不篩掉任何項目）。
 */
export function filterErrata(list: Erratum[], f: ErrataFilter, relatedTests: (e: Erratum) => string[], hasLive?: (eid: string) => boolean): Erratum[] {
  const q = f.query.trim().toLowerCase()
  return list.filter((e) => {
    if (f.severity !== 'all' && e.severity !== f.severity) return false
    if (f.area !== 'all' && e.area !== f.area) return false
    if (f.chapter !== 'all-chapters' && !e.chapters.includes(f.chapter)) return false
    if (f.onlyAcceptance && relatedTests(e).length === 0) return false
    if (f.onlyLive && hasLive && !hasLive(e.eid)) return false
    if (q) {
      const hay = `${e.eid} ${e.id} ${e.area} ${e.location} ${e.problem} ${e.correction} ${e.evidence}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** 一個勘誤是否通過篩選（深連結時用來決定要不要先清除篩選） */
export function passesFilter(e: Erratum, f: ErrataFilter, relatedTests: (e: Erratum) => string[], hasLive?: (eid: string) => boolean): boolean {
  return filterErrata([e], f, relatedTests, hasLive).length === 1
}

export function distinctAreas(list: Erratum[]): string[] {
  return [...new Set(list.map((e) => e.area))]
}

export function distinctChapters(list: Erratum[]): string[] {
  const set = new Set<string>()
  for (const e of list) for (const c of e.chapters) set.add(c)
  return [...set].sort((a, b) => (a === 'all' ? 1 : b === 'all' ? -1 : a.localeCompare(b)))
}

export function countBySeverity(list: Erratum[]): Record<Severity, number> {
  const out: Record<Severity, number> = { high: 0, medium: 0, low: 0 }
  for (const e of list) out[e.severity]++
  return out
}

/** 驗證頁上指向某勘誤的連結（HashRouter：#/verification?e=E05） */
export function erratumHref(eid: string): string {
  return `#/verification?e=${encodeURIComponent(eid)}`
}

export function testRowHref(tid: string): string {
  return `#/verification?t=${encodeURIComponent(tid)}`
}

/** docs/validation.md「已反駁（不列為勘誤）」的一項：稽核者提出、但被獨立的懷疑者反駁的意見 */
export interface RefutedItem {
  id: string
  area: string
  /** 規格中的位置（原文） */
  location: string
  /** 反駁理由（原文；來源檔在約 500 字處截斷，中英文混用） */
  reason: string
}

/**
 * 從 docs/validation.md 的原始文字解析「## 已反駁」一節。每一行的格式：
 *   - `id`（範圍）：位置 — 反駁理由：理由
 * 範圍本身可能含括號（例如「Part A（§1–3）」），所以用第一個「）：」當分界。
 */
export function parseRefuted(md: string): RefutedItem[] {
  const start = md.indexOf('## 已反駁')
  if (start < 0) return []
  const out: RefutedItem[] = []
  for (const line of md.slice(start).split('\n').slice(1)) {
    if (line.startsWith('## ')) break
    const m = /^- `([^`]+)`（/.exec(line)
    if (!m) continue
    const rest = line.slice(m[0].length)
    const cut = rest.indexOf('）：')
    const sep = rest.indexOf(' — 反駁理由：')
    if (cut < 0 || sep < cut) continue
    out.push({ id: m[1], area: rest.slice(0, cut), location: rest.slice(cut + 2, sep), reason: rest.slice(sep + ' — 反駁理由：'.length).trim() })
  }
  return out
}

/** docs/validation.md「方法」一節的兩個數字：稽核 agent 數與重算的聲明數（解析不到時為 null，頁面就不寫數字） */
export interface ValidationStats {
  auditors: number | null
  claims: number | null
}

/**
 * docs/validation.md「方法」一節的兩個數字（稽核 agent 數、重算的聲明數）。頁首（首屏）只需要這兩個數字，
 * 不值得為它把整份 validation.md（約 100 KB，gzip 後約 30 KB）放進首屏 chunk：這裡固定住，
 * data.test.ts 會用 parseValidationStats 解析原文來核對——文件改了而這裡沒改，測試就失敗。
 * 需要整份原文的勘誤瀏覽器（sections/ErrataBrowserBody.tsx，延後載入）仍然直接解析原文。
 */
export const VALIDATION_STATS: ValidationStats = { auditors: 9, claims: 237 }

/** 從 docs/validation.md 的原始文字解析「N 個稽核 agent … 共 **M** 項」 */
export function parseValidationStats(md: string): ValidationStats {
  const a = /(\d+)\s*個稽核 agent/.exec(md)
  const c = /共\s*\*\*(\d+)\*\*\s*項/.exec(md)
  return { auditors: a ? Number(a[1]) : null, claims: c ? Number(c[1]) : null }
}
