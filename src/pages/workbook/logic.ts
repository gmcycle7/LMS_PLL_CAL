/**
 * 手算練習簿的純邏輯（不含 React）：章節分組、篩選與搜尋、隨機出題、練習卷產生、作答統計。
 * 題目本身（HandCalcDef）來自各章的 handcalcs.ts；這裡不新增、不改寫任何公式或數值。
 */
import { defaultValues, parseNumberInput, randomValues, texNum } from '@/components'
import { PAGES, type PageEntry } from '@/app/registry'
import type { HandCalcDef, HandCalcResult, HandCalcSolution } from '@/data/types'
import { createRng, normalizeSeed } from '@/simulation/core'

/* ───────────────────────── 難度 ───────────────────────── */

export type Level = HandCalcDef['level']
export const LEVELS: readonly Level[] = ['beginner', 'engineer', 'research']

/** 與 HandCalc 元件標頭顯示的文字相同 */
export const LEVEL_LABEL: Record<Level, string> = {
  beginner: '只需四則運算',
  engineer: '需要計算機',
  research: '需要查表或複數運算',
}

export const isLevel = (v: unknown): v is Level => typeof v === 'string' && (LEVELS as readonly string[]).includes(v)

/* ───────────────────────── 章節分組 ───────────────────────── */

type PageRef = Pick<PageEntry, 'id' | 'path' | 'nav' | 'title'>

export interface ChapterRef {
  /** 頁面 id（'ch03'、'case-sspll'…）；找不到對應頁面時就是題目的 page 路徑 */
  key: string
  /** 路由路徑（'/ch/03'）；HashRouter 下的網址是 '#/ch/03' */
  path: string
  /** 側欄名稱，例如「03 Mean / Mean-Square Stability」 */
  nav: string
  title: string
  /** 在全站目錄中的順序 */
  order: number
}

export interface ChapterGroup extends ChapterRef {
  items: HandCalcDef[]
}

const byId = (a: HandCalcDef, b: HandCalcDef): number => a.id.localeCompare(b.id, 'en', { numeric: true })

/** 題目屬於哪一章（依 def.page 對照全站頁面註冊表）。 */
export function chapterOf(def: HandCalcDef, pages: readonly PageRef[] = PAGES): ChapterRef {
  const i = pages.findIndex((p) => p.path === def.page)
  if (i < 0) return { key: def.page, path: def.page, nav: def.page, title: def.page, order: pages.length }
  const p = pages[i]
  return { key: p.id, path: p.path, nav: p.nav, title: p.title, order: i }
}

/** 依全站目錄順序分組；組內依題號排序。沒有題目的章節不出現。 */
export function groupByChapter(defs: readonly HandCalcDef[], pages: readonly PageRef[] = PAGES): ChapterGroup[] {
  const groups = new Map<string, ChapterGroup>()
  for (const def of defs) {
    const ch = chapterOf(def, pages)
    const g = groups.get(ch.key) ?? { ...ch, items: [] }
    g.items.push(def)
    groups.set(ch.key, g)
  }
  return [...groups.values()]
    .map((g) => ({ ...g, items: [...g.items].sort(byId) }))
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
}

/* ───────────────────────── 篩選與搜尋 ───────────────────────── */

export interface Filters {
  /** 章節 key；'' = 全部 */
  chapter: string
  /** 難度；'' = 全部 */
  level: Level | ''
  /** 標題關鍵字（空白分隔 = 全部都要出現） */
  q: string
}

export const EMPTY_FILTERS: Filters = { chapter: '', level: '', q: '' }

export const isFiltered = (f: Filters): boolean => f.chapter !== '' || f.level !== '' || f.q.trim() !== ''

/** 希臘字母 → TeX 名稱：搜尋「σ」「sigma」或標題裡的 `\sigma` 都對得上 */
const GREEK: Record<string, string> = {
  α: 'alpha',
  β: 'beta',
  γ: 'gamma',
  δ: 'delta',
  ε: 'epsilon',
  ζ: 'zeta',
  η: 'eta',
  θ: 'theta',
  κ: 'kappa',
  λ: 'lambda',
  μ: 'mu',
  µ: 'mu',
  ν: 'nu',
  ξ: 'xi',
  π: 'pi',
  ρ: 'rho',
  σ: 'sigma',
  ς: 'sigma',
  τ: 'tau',
  φ: 'phi',
  ϕ: 'phi',
  ϵ: 'epsilon',
  ϑ: 'theta',
  χ: 'chi',
  ψ: 'psi',
  ω: 'omega',
}

/** 搜尋用的正規化：小寫、希臘字母改成英文名、全形空白改半形。 */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u03b1-\u03c9\u00b5\u03d1\u03d5\u03f5]/g, (ch) => GREEK[ch] ?? ch)
    .replace(/\u3000/g, ' ')
}

/** 一題可被搜尋的文字：題號、標題、公式編號、章節名稱。 */
export function searchHaystack(def: HandCalcDef, pages: readonly PageRef[] = PAGES): string {
  const ch = chapterOf(def, pages)
  return normalizeText([def.id, def.title, def.formulaId ?? '', ch.nav].join(' '))
}

export function matchesQuery(def: HandCalcDef, q: string, pages: readonly PageRef[] = PAGES): boolean {
  const tokens = normalizeText(q).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const hay = searchHaystack(def, pages)
  return tokens.every((t) => hay.includes(t))
}

export function filterHandcalcs(defs: readonly HandCalcDef[], f: Filters, pages: readonly PageRef[] = PAGES): HandCalcDef[] {
  return defs.filter(
    (d) => (f.chapter === '' || chapterOf(d, pages).key === f.chapter) && (f.level === '' || d.level === f.level) && matchesQuery(d, f.q, pages),
  )
}

/** 各難度的題數（篩選列與說明表用） */
export function countByLevel(defs: readonly HandCalcDef[]): Record<Level, number> {
  const out: Record<Level, number> = { beginner: 0, engineer: 0, research: 0 }
  for (const d of defs) out[d.level] += 1
  return out
}

/* ── 篩選條件 ↔ 網址參數（?ch=ch03&level=engineer&q=pole） ── */

export function parseFilters(sp: URLSearchParams, validChapters: readonly string[]): Filters {
  const ch = sp.get('ch') ?? ''
  const level = sp.get('level')
  return {
    chapter: validChapters.includes(ch) ? ch : '',
    level: isLevel(level) ? level : '',
    q: sp.get('q') ?? '',
  }
}

/** 把篩選條件寫回網址參數；其他參數（tab、hc…）原樣保留，空的條件不留在網址上。 */
export function filtersToParams(f: Filters, base?: URLSearchParams): URLSearchParams {
  const sp = new URLSearchParams(base)
  const put = (k: string, v: string) => (v ? sp.set(k, v) : sp.delete(k))
  put('ch', f.chapter)
  put('level', f.level)
  put('q', f.q)
  return sp
}

export type WorkbookTab = 'browse' | 'practice' | 'sheet'
export const TABS: readonly WorkbookTab[] = ['browse', 'practice', 'sheet']
export const parseTab = (v: string | null): WorkbookTab => ((TABS as readonly string[]).includes(v ?? '') ? (v as WorkbookTab) : 'browse')

/* ───────────────────────── 顯示用：把數字排成 TeX ───────────────────────── */

/** 「已知」的一項：x = 2\ \mathrm{fs} */
export function givenTex(symbol: string, value: number, unit?: string): string {
  return `${symbol} = ${texNum(value, 10)}${unit ? `\\ ${unit}` : ''}`
}

/** 答案框：\boxed{w_1 = 1.8\ \mathrm{fs}}（與 HandCalc 元件相同的寫法） */
export function resultTex(r: HandCalcResult): string {
  return `\\boxed{${r.symbol} = ${texNum(r.value, r.digits ?? 5)}${r.unit ? `\\ ${r.unit}` : ''}}`
}

/* ───────────────────────── seed ───────────────────────── */

/** seed 的上限：32-bit 無號整數（createRng 只取低 32 位） */
export const SEED_MAX = 0xffff_ffff

/** seed 輸入框的文字 → 0 … 2³²−1 的整數；不合法回傳 null */
export function parseSeed(raw: string): number | null {
  const v = parseNumberInput(raw)
  return v !== null && Number.isInteger(v) && v >= 0 && v <= SEED_MAX ? v : null
}

/* ───────────────────────── 隨機出題 ───────────────────────── */

/** 以 seed 決定的洗牌（Fisher–Yates）；不改動輸入。 */
export function shuffled<T>(items: readonly T[], seed: number, label: string): T[] {
  const rng = createRng(seed).fork(label)
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export interface PracticeItem {
  def: HandCalcDef
  values: Record<string, number>
  solution: HandCalcSolution
  /** 抽這一題數字用的 seed（= 題目種子 + 題序） */
  valueSeed: number
  /** 第幾題（從 0 起算） */
  index: number
  poolSize: number
  /** 同一題在這個 session 內的識別碼（統計只記一次） */
  key: string
}

/**
 * 隨機練習的第 k 題：先用 seed 把題庫洗牌，再照順序出題（整個題庫輪完之前不會重複），
 * 數字由 randomValues(def, seed + k) 抽出。同一組（題庫、seed、k）永遠得到同一題。
 */
export function practiceItem(pool: readonly HandCalcDef[], seed: number, k: number): PracticeItem | null {
  if (pool.length === 0) return null
  const s = normalizeSeed(seed)
  const order = shuffled([...pool].sort(byId), s, 'workbook-practice')
  const index = Math.max(0, Math.floor(k))
  const valueSeed = normalizeSeed(s + index)
  // 正常情況第一輪就回傳；某一題的 solve 丟例外（題目寫壞了）時改出洗牌順序中的下一題，不讓整頁壞掉
  for (let skip = 0; skip < order.length; skip++) {
    const def = order[(index + skip) % order.length]
    try {
      const values = randomValues(def, valueSeed)
      return { def, values, solution: def.solve(values), valueSeed, index, poolSize: order.length, key: `${def.id}@${valueSeed}` }
    } catch {
      /* 換下一題 */
    }
  }
  return null
}

/* ───────────────────────── 作答統計 ───────────────────────── */

export interface ChapterStat {
  /** 按過「對答案」的題數 */
  attempted: number
  /** 在看詳解之前全部答對的題數 */
  correct: number
}

export interface WorkbookStats {
  v: 1
  /** key = 章節 key */
  chapters: Record<string, ChapterStat>
  /** 曾經答對的題號（題庫列表上打勾用） */
  solved: string[]
}

export const EMPTY_STATS: WorkbookStats = { v: 1, chapters: {}, solved: [] }

export type StatsAction =
  | { type: 'attempt'; chapter: string }
  | { type: 'correct'; chapter: string; id: string }
  | { type: 'reset' }

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

/** localStorage 讀回來的內容是否為合法的統計（舊版或被改壞的資料一律捨棄，回到空統計）。 */
export function isWorkbookStats(v: unknown): v is WorkbookStats {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (o.v !== 1 || typeof o.chapters !== 'object' || o.chapters === null || Array.isArray(o.chapters)) return false
  if (!Array.isArray(o.solved) || !o.solved.every((s) => typeof s === 'string')) return false
  return Object.values(o.chapters as Record<string, unknown>).every((c) => {
    if (typeof c !== 'object' || c === null) return false
    const s = c as Record<string, unknown>
    return isCount(s.attempted) && isCount(s.correct) && s.correct <= s.attempted
  })
}

/**
 * 統計的 reducer。
 *  - attempt：這一題第一次按「對答案」→ 該章 attempted + 1。
 *  - correct：這一題在看詳解之前全部答對 → 該章 correct + 1（不會超過 attempted），並記下題號。
 *  - reset：清空。
 * 「同一題只記一次」由呼叫端（RandomPractice）保證；reducer 只負責不變量 0 ≤ correct ≤ attempted。
 */
export function statsReducer(state: WorkbookStats, action: StatsAction): WorkbookStats {
  if (action.type === 'reset') return EMPTY_STATS
  const prev = state.chapters[action.chapter] ?? { attempted: 0, correct: 0 }
  if (action.type === 'attempt') {
    return { ...state, chapters: { ...state.chapters, [action.chapter]: { ...prev, attempted: prev.attempted + 1 } } }
  }
  const attempted = Math.max(prev.attempted, 1)
  const correct = Math.min(attempted, prev.correct + 1)
  return {
    ...state,
    chapters: { ...state.chapters, [action.chapter]: { attempted, correct } },
    solved: state.solved.includes(action.id) ? state.solved : [...state.solved, action.id],
  }
}

/** 隨機練習中「某一題（含它的數字）」在這次瀏覽裡的作答紀錄 */
export interface InstanceRecord {
  attempted: boolean
  /** 已記為答對 */
  credited: boolean
  /** 看過詳解（之後再答對也不計分） */
  revealed: boolean
}

export const NEW_RECORD: InstanceRecord = { attempted: false, credited: false, revealed: false }

/**
 * 按下「對答案」時的記分規則（純函式，方便測試）：
 *  - 這一題第一次對答案 → 送出 attempt；
 *  - 全部答對、還沒看過詳解、也還沒記過分 → 送出 correct。
 * 回傳更新後的紀錄與要送給 statsReducer 的動作種類。
 */
export function scoreCheck(rec: InstanceRecord, allCorrect: boolean): { record: InstanceRecord; actions: ('attempt' | 'correct')[] } {
  const actions: ('attempt' | 'correct')[] = []
  if (!rec.attempted) actions.push('attempt')
  const credit = allCorrect && !rec.credited && !rec.revealed
  if (credit) actions.push('correct')
  return { record: { attempted: true, credited: rec.credited || credit, revealed: rec.revealed }, actions }
}

export function statsTotals(stats: WorkbookStats): ChapterStat {
  return Object.values(stats.chapters).reduce((t, c) => ({ attempted: t.attempted + c.attempted, correct: t.correct + c.correct }), { attempted: 0, correct: 0 })
}

/** 正確率（0–1）；還沒作答時回傳 null */
export const accuracy = (c: ChapterStat): number | null => (c.attempted > 0 ? c.correct / c.attempted : null)

/* ───────────────────────── 練習卷 ───────────────────────── */

export const WORKSHEET_MIN = 5
export const WORKSHEET_MAX = 30
export const WORKSHEET_DEFAULT_COUNT = 10
export const DEFAULT_SEED = 20261010

export interface WorksheetOptions {
  /** 章節 key；空陣列 = 全部章節 */
  chapters: string[]
  /** 難度；空陣列 = 全部 */
  levels: Level[]
  /** 題數（會夾到 5–30） */
  count: number
  seed: number
  /** random = 依 seed 抽手算友善的數字；default = 課文 worked example 的數字 */
  numbers: 'random' | 'default'
}

export interface WorksheetItem {
  /** 卷上的題號（1 起算） */
  no: number
  def: HandCalcDef
  chapter: ChapterRef
  values: Record<string, number>
  /** def.solve(values) 的結果：題目的「求」與解答頁的逐步代入都取自它 */
  solution: HandCalcSolution
}

export interface Worksheet {
  options: WorksheetOptions
  items: WorksheetItem[]
  /** 符合章節與難度條件的題數 */
  poolSize: number
  /** 題庫不夠出滿指定題數 */
  shortfall: boolean
}

export function clampCount(n: number): number {
  if (!Number.isFinite(n)) return WORKSHEET_DEFAULT_COUNT
  return Math.min(WORKSHEET_MAX, Math.max(WORKSHEET_MIN, Math.round(n)))
}

/** 同一題最多再出幾輪（每輪換一組數字） */
const MAX_PASSES = 8

/**
 * 產生練習卷：完全由（題庫、選項）決定，同一個 seed 一定得到同一張卷。
 *  1. 依章節與難度篩出題庫，用 seed 洗牌；
 *  2. 依序取題，數字用 randomValues(def, seed + 輪次)；題庫比題數小時再輪一次（換一組數字，數字相同就跳過）；
 *  3. 最後依全站章節順序、題號排序並編號。
 */
export function buildWorksheet(defs: readonly HandCalcDef[], options: WorksheetOptions, pages: readonly PageRef[] = PAGES): Worksheet {
  const opts: WorksheetOptions = {
    chapters: [...options.chapters],
    levels: LEVELS.filter((l) => options.levels.includes(l)),
    count: clampCount(options.count),
    seed: normalizeSeed(options.seed),
    numbers: options.numbers === 'default' ? 'default' : 'random',
  }
  const pool = defs
    .filter((d) => (opts.chapters.length === 0 || opts.chapters.includes(chapterOf(d, pages).key)) && (opts.levels.length === 0 || opts.levels.includes(d.level)))
    .sort(byId)
  const order = shuffled(pool, opts.seed, 'workbook-sheet')
  const picked: { def: HandCalcDef; pass: number; values: Record<string, number>; solution: HandCalcSolution }[] = []
  const seen = new Set<string>()
  const passes = opts.numbers === 'default' ? 1 : MAX_PASSES
  for (let pass = 0; pass < passes && picked.length < opts.count; pass++) {
    const before = picked.length
    for (const def of order) {
      if (picked.length >= opts.count) break
      const values = opts.numbers === 'default' ? defaultValues(def) : randomValues(def, normalizeSeed(opts.seed + pass))
      const sig = `${def.id}|${JSON.stringify(values)}`
      if (seen.has(sig)) continue
      try {
        const solution = def.solve(values)
        seen.add(sig)
        picked.push({ def, pass, values, solution })
      } catch {
        /* 這組數字算不出來（不應發生：randomValues 已驗證過）→ 跳過這一題 */
      }
    }
    if (picked.length === before) break
  }
  const items = picked
    .map((p) => ({ ...p, chapter: chapterOf(p.def, pages) }))
    .sort((a, b) => a.chapter.order - b.chapter.order || byId(a.def, b.def) || a.pass - b.pass)
    .map((p, i) => ({ no: i + 1, def: p.def, chapter: p.chapter, values: p.values, solution: p.solution }))
  return { options: opts, items, poolSize: pool.length, shortfall: items.length < opts.count }
}

/** 練習卷的識別字串（印在卷首；兩張卷相同 ⇔ 這個字串相同且題庫沒變） */
export function worksheetFingerprint(ws: Worksheet): string {
  return ws.items.map((it) => `${it.def.id}:${it.def.inputs.map((i) => it.values[i.key]).join(',')}`).join(';')
}
