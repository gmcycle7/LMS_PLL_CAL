import { PAGES, type PageEntry } from '@/app/registry'
import { buildHaystack, normalizeSearch, richToPlain, tokenize } from '@/pages/formulas/search'

/**
 * 全站搜尋的型別、排序與「目前這一頁的段落」收集（純函式，不載入任何資料）。
 * 資料本身在 ./buildIndex.ts，由面板第一次開啟時以 import() 載入；這個檔案很小，面板直接 import。
 * 字串的正規化沿用公式速查頁的 normalizeSearch（NFKC、希臘字母／TeX／Unicode 寫法互通），
 * 所以 'σ_w'、'\sigma_w'、'sigma w' 找得到同一條公式。
 */

export type SearchKind = 'formula' | 'section' | 'preset' | 'erratum' | 'term' | 'handcalc'

export const KIND_ORDER: readonly SearchKind[] = ['formula', 'section', 'preset', 'erratum', 'term', 'handcalc']

export const KIND_LABEL: Record<SearchKind, string> = {
  formula: '公式',
  section: '章節',
  preset: '實驗 preset',
  erratum: '勘誤',
  term: '術語',
  handcalc: '手算題',
}

export interface SearchEntry {
  kind: SearchKind
  /** 同一種類內唯一（F-05.1、E01、HC-05.1、preset id、術語 key、頁面 id、段落 id） */
  id: string
  /** 左側的小標籤（預設顯示 id；術語顯示縮寫、問題顯示「問題 n」、本頁段落顯示「本頁」） */
  label?: string
  /** 標題（可含 $…$，面板以 mathText 顯示） */
  title: string
  /** 公式的 TeX（只有公式有；面板以 KaTeX 顯示） */
  tex?: string
  /** 第二行：所在頁面、條件、說明（可含 $…$） */
  detail?: string
  /** 目標路由（不含 #），例如 '/ch/05?f=F-05.1'；<a href> 用 `#${to}`，Enter 用 navigate(to) */
  to: string
  /** 正規化的搜尋字串：每個查詢 token 都要出現（AND） */
  haystack: string
  /** 正規化的 id 與標題：命中這兩個欄位的排前面 */
  idKey: string
  titleKey: string
  /** 目前這一頁的段落：直接捲到這個元素（不經過路由） */
  el?: HTMLElement
  /** 走路由到了目標頁之後要捲到的元素（CSS selector）：目標頁自己不處理 ?a= 時用（公式速查頁的術語列） */
  revealSelector?: string
}

/** 建立一筆索引項：haystack／idKey／titleKey 由 title、id 與額外欄位算出 */
export function makeEntry(
  base: Omit<SearchEntry, 'haystack' | 'idKey' | 'titleKey'>,
  extra: ReadonlyArray<string | number | null | undefined | false> = [],
  haystack?: string,
): SearchEntry {
  const titlePlain = richToPlain(base.title)
  return {
    ...base,
    haystack: haystack ?? buildHaystack([base.id, titlePlain, base.detail && richToPlain(base.detail), base.tex, ...extra]),
    idKey: normalizeSearch(base.id),
    titleKey: normalizeSearch(titlePlain),
  }
}

/** 由路由路徑找 registry 的頁面（'/ch/05' → ch05） */
export function pageOfPath(path: string): PageEntry | undefined {
  return PAGES.find((p) => p.path === path)
}

/* ───────────── 排序與分組 ───────────── */

export interface SearchGroup {
  kind: SearchKind
  label: string
  /** 符合的總數（items 只放前 perGroup 筆） */
  total: number
  items: SearchEntry[]
}

/** 預設每組最多顯示幾筆 */
export const PER_GROUP = 8

/**
 * 單一 token 對一筆項目的分數：id 完全相同 100、id 開頭 80、id 包含 60、標題開頭 50、標題包含 40、其他欄位 10；都沒有就是 -1（不符合）。
 * 多個 token 的分數相加；任何一個 token 不符合，整筆就不符合（AND）。
 */
export function scoreEntry(e: SearchEntry, tokens: readonly string[]): number {
  let score = 0
  for (const t of tokens) {
    if (e.idKey === t) score += 100
    else if (e.idKey.startsWith(t)) score += 80
    else if (e.idKey.includes(t)) score += 60
    else if (e.titleKey.startsWith(t)) score += 50
    else if (e.titleKey.includes(t)) score += 40
    else if (e.haystack.includes(t)) score += 10
    else return -1
  }
  return score
}

/**
 * 搜尋：query 以空白切成 token（normalizeSearch 正規化），全部都要出現；依分數排序（同分保持來源順序），
 * 再依 KIND_ORDER 分組（有 token 剛好等於某筆 id 的組排最前面），每組最多 perGroup 筆（total 保留符合的總數）。
 * 空查詢：只列出目前這一頁的段落（有 el 的項目），讓面板一打開就是本頁目錄——目錄要完整，所以不受 perGroup 限制。
 */
export function search(entries: readonly SearchEntry[], query: string, perGroup = PER_GROUP): SearchGroup[] {
  const tokens = tokenize(query)
  const scored: { e: SearchEntry; s: number; i: number }[] = []
  let cap = perGroup
  if (tokens.length === 0) {
    cap = Infinity
    entries.forEach((e, i) => {
      if (e.el) scored.push({ e, s: 0, i })
    })
  } else {
    entries.forEach((e, i) => {
      const s = scoreEntry(e, tokens)
      if (s >= 0) scored.push({ e, s, i })
    })
  }
  scored.sort((a, b) => b.s - a.s || a.i - b.i)
  const byKind = new Map<SearchKind, SearchEntry[]>()
  // 某個 token 剛好是一筆的 id（E13、F-12.9、HC-05.1、enbw）：那一組排最前面——打 ID 就是要跳過去，
  // 不該被排在前面的組裡「內文提到這個 ID」的項目壓在下面（否則 E13 之前先列 8 條提到 E13 的公式）
  const exact = new Set<SearchKind>()
  for (const { e } of scored) {
    const list = byKind.get(e.kind)
    if (list) list.push(e)
    else byKind.set(e.kind, [e])
    if (tokens.some((t) => e.idKey === t)) exact.add(e.kind)
  }
  const order = [...KIND_ORDER.filter((k) => exact.has(k)), ...KIND_ORDER.filter((k) => !exact.has(k))]
  const out: SearchGroup[] = []
  for (const kind of order) {
    const list = byKind.get(kind)
    if (!list) continue
    out.push({ kind, label: KIND_LABEL[kind], total: list.length, items: list.slice(0, cap) })
  }
  return out
}

/* ───────────── 目前這一頁的段落（從 DOM 讀） ───────────── */

/**
 * 標題的純文字：KaTeX 會同時輸出 MathML 與 HTML 兩份，textContent 會重複；
 * 這裡把每個 .katex 換回它的 TeX 原始碼（annotation）寫成 $…$，面板再用 mathText 顯示。
 */
export function headingText(h: Element): string {
  const clone = h.cloneNode(true) as Element
  for (const k of Array.from(clone.querySelectorAll('.katex'))) {
    const tex = k.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()
    const text = tex ? `$${tex}$` : (k.querySelector('.katex-html')?.textContent ?? '')
    k.replaceWith(clone.ownerDocument.createTextNode(text))
  }
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * 目前這一頁的 h2（章節的 <Section level={2} id="…">、頁面的段落）→ 章節群組的項目。
 *   - 有 id（h2 自己的，或最近的有 id 的祖先，<main> 不算）：目標是 `路徑?a=id`，和 <AnchorLink> 相同；
 *   - 沒有 id：Enter 直接捲到那個 h2（el），路由不變。
 * 模式選擇器與對話框裡的 h2 不算。章節只在 JSX 裡寫段落標題，沒有建置步驟能列出別頁的段落，所以其他頁只索引 registry 的標題。
 */
export function collectPageSections(routePath: string, root: ParentNode = document): SearchEntry[] {
  const article = root.querySelector('main article.page') ?? root.querySelector('main')
  if (!article) return []
  const page = pageOfPath(routePath)
  const out: SearchEntry[] = []
  let n = 0
  for (const h of Array.from(article.querySelectorAll<HTMLElement>('h2'))) {
    if (h.closest('.c-modepicker, [role="dialog"], .c-search')) continue
    const title = headingText(h)
    if (!title) continue
    n++
    const anchor = h.id ? h : h.closest<HTMLElement>('[id]')
    const id = anchor && anchor.id && anchor.id !== 'main' && article.contains(anchor) ? anchor.id : null
    out.push(
      makeEntry(
        {
          kind: 'section',
          id: id ?? `h2-${n}`,
          label: '本頁',
          title,
          detail: page?.nav ?? '目前這一頁',
          to: id ? `${routePath}?a=${encodeURIComponent(id)}` : routePath,
          el: id && anchor ? anchor : h,
        },
        [id, page?.nav],
      ),
    )
  }
  return out
}
