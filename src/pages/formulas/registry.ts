import type { ClaimKind, FormulaEntry, ModelLevelId } from '@/data/types'
import { PAGES } from '@/app/registry'
import { CLAIM_LABEL } from '@/components'
import { buildHaystack } from './search'

/**
 * 全站公式登錄的彙整（docs/dev-conventions.md §5.1）：
 *   - 每章 src/chapters/chNN/formulas.ts
 *   - 其他頁面 src/pages/<name>/formulas.ts（models、roadmap、signoff …；roadmap/formulas.ts 的註解要求本頁一併收錄）
 * 都以 `export const FORMULAS: FormulaEntry[]` 匯出；這裡用 import.meta.glob（eager）收集，不需要中央清單。
 * 本頁（src/pages/formulas/）自己不登錄新 ID，所以 '../*\/formulas.ts' 不會收到自己。
 */
type FormulaModule = { FORMULAS?: FormulaEntry[] }

const CHAPTER_MODULES = import.meta.glob<FormulaModule>('../../chapters/*/formulas.ts', { eager: true })
const PAGE_MODULES = import.meta.glob<FormulaModule>('../*/formulas.ts', { eager: true })

export interface RegistryRow extends FormulaEntry {
  /** 原始檔（相對 src/），例如 'chapters/ch12/formulas.ts' */
  source: string
  /** registry.ts 中的頁面 id（找不到時為 null） */
  pageId: string | null
  /** 側欄名稱，例如 '12 Coefficient Noise → PLL Output' */
  pageNav: string
  /** 依側欄順序排序用 */
  pageOrder: number
  /** 已正規化的搜尋字串 */
  haystack: string
}

/** 把 glob 的 key（'../../chapters/ch12/formulas.ts'）轉成相對 src/ 的路徑 */
export function sourceFromGlobKey(key: string): string {
  if (key.startsWith('../../')) return key.slice(6) // '../../chapters/ch12/formulas.ts' → 'chapters/ch12/formulas.ts'
  if (key.startsWith('../')) return `pages/${key.slice(3)}` // '../models/formulas.ts' → 'pages/models/formulas.ts'
  return key
}

/**
 * 自然排序的比較鍵：'F-02.18' 排在 'F-02.17' 之後；'F-13.12' 在 'F-13.13' 之前；
 * 字母前綴（F-R1.1、F-SO.3、F-SS.2）依字母，再依數字。
 */
export function idSortKey(id: string): (string | number)[] {
  return id
    .replace(/^F-/, '')
    .split(/(\d+)/)
    .filter((s) => s.length > 0)
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s))
}

export function compareIds(a: string, b: string): number {
  const ka = idSortKey(a)
  const kb = idSortKey(b)
  const n = Math.min(ka.length, kb.length)
  for (let i = 0; i < n; i++) {
    const x = ka[i]
    const y = kb[i]
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    if (typeof x === 'number') return -1 // 純數字章節（F-03.x）排在字母前綴（F-R1.x）之前
    if (typeof y === 'number') return 1
    return x < y ? -1 : 1
  }
  return ka.length - kb.length
}

/** 由 page 路徑找 registry 的頁面 */
export function pageOfPath(path: string): { id: string; nav: string; order: number } | null {
  const i = PAGES.findIndex((p) => p.path === path)
  if (i < 0) return null
  return { id: PAGES[i].id, nav: PAGES[i].nav, order: i }
}

/** 收集並排序（純函式，測試可注入假的模組表） */
export function collectFormulas(modules: Record<string, FormulaModule>): RegistryRow[] {
  const rows: RegistryRow[] = []
  for (const [key, mod] of Object.entries(modules)) {
    const list = mod?.FORMULAS
    if (!Array.isArray(list)) continue
    const source = sourceFromGlobKey(key)
    for (const f of list) {
      const page = pageOfPath(f.page)
      rows.push({
        ...f,
        source,
        pageId: page?.id ?? null,
        pageNav: page?.nav ?? f.page,
        pageOrder: page?.order ?? 999,
        haystack: buildHaystack([
          f.id,
          f.title,
          f.tex,
          f.conditions,
          f.specSection && `§${f.specSection}`,
          f.page,
          page?.nav,
          f.level,
          CLAIM_LABEL[f.claim],
          f.claim,
          f.erratumId,
          f.erratumId && `勘誤 ${f.erratumId}`,
          f.units && Object.entries(f.units).map(([k, v]) => `${k} ${v}`).join(' '),
        ]),
      })
    }
  }
  rows.sort((a, b) => a.pageOrder - b.pageOrder || compareIds(a.id, b.id))
  return rows
}

/** 全站公式（排序後） */
export const ALL_FORMULAS: readonly RegistryRow[] = collectFormulas({ ...CHAPTER_MODULES, ...PAGE_MODULES })

const FORMULA_BY_ID = new Map(ALL_FORMULAS.map((f) => [f.id, f]))

export function formulaById(id: string): RegistryRow | undefined {
  return FORMULA_BY_ID.get(id)
}

export const FORMULA_IDS: ReadonlySet<string> = new Set(FORMULA_BY_ID.keys())

/** 重複 ID（應為空；測試會檢查） */
export function duplicateIds(rows: readonly FormulaEntry[]): string[] {
  const seen = new Map<string, number>()
  for (const r of rows) seen.set(r.id, (seen.get(r.id) ?? 0) + 1)
  return [...seen].filter(([, n]) => n > 1).map(([id]) => id)
}

export interface RegistryStats {
  total: number
  pages: number
  byClaim: Record<ClaimKind, number>
  byLevel: Partial<Record<ModelLevelId, number>>
  withErratum: number
  errataReferenced: string[]
}

export function registryStats(rows: readonly RegistryRow[]): RegistryStats {
  const byClaim: Record<ClaimKind, number> = { exact: 0, approx: 0, research: 0 }
  const byLevel: Partial<Record<ModelLevelId, number>> = {}
  const pages = new Set<string>()
  const errata = new Set<string>()
  let withErratum = 0
  for (const r of rows) {
    byClaim[r.claim] = (byClaim[r.claim] ?? 0) + 1
    byLevel[r.level] = (byLevel[r.level] ?? 0) + 1
    pages.add(r.page)
    if (r.erratumId) {
      withErratum++
      errata.add(r.erratumId)
    }
  }
  return {
    total: rows.length,
    pages: pages.size,
    byClaim,
    byLevel,
    withErratum,
    errataReferenced: [...errata].sort(),
  }
}

/** 依頁面分組（保持排序） */
export function groupByPage(rows: readonly RegistryRow[]): { page: string; pageNav: string; pageId: string | null; rows: RegistryRow[] }[] {
  const out: { page: string; pageNav: string; pageId: string | null; rows: RegistryRow[] }[] = []
  for (const r of rows) {
    const last = out[out.length - 1]
    if (last && last.page === r.page) last.rows.push(r)
    else out.push({ page: r.page, pageNav: r.pageNav, pageId: r.pageId, rows: [r] })
  }
  return out
}
