/**
 * 測試工具（只給 *.test.ts(x) 用；Lab／Models／Dashboard／Sign-off 四頁共用）：檢查「送進 Plotly 之前」的圖內文字（軸標題、圖例名稱、註記、ticktext、hovertemplate…）是不是 LaTeX 寫法
 * （docs/teaching-style.md §3：圖裡面的數學也要用 LaTeX）。
 *
 * <Plot> 會先對 data／layout 套用 `applyPlotMath`（把 `$...$` 轉成斜體符號與真正的上下標），Plotly 看到的已經是轉換後的 pseudo-HTML，
 * 所以要檢查「作者寫的字串」，得在轉換前攔下來：測試檔裡把 `@/components/plotMath` 的 `applyPlotMath` 換成會記錄參數的版本：
 *
 *   const plotCalls = vi.hoisted(() => [] as { data: unknown; layout: unknown }[])
 *   vi.mock('@/components/plotMath', async (importOriginal) => {
 *     const actual = await importOriginal<typeof import('@/components/plotMath')>()
 *     return { ...actual, applyPlotMath: (data: unknown, layout: unknown) => (plotCalls.push({ data, layout }), actual.applyPlotMath(data, layout)) }
 *   })
 *   expect(chartStringProblems(plotCalls)).toEqual([])
 */

/** 會顯示在圖上的字串欄位（與 src/components/plotMath.ts 的 TEXT_KEYS 相同）。 */
const TEXT_KEYS = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext', 'label', 'ticksuffix', 'tickprefix', 'legendgrouptitle'])

/** Unicode 數學字元（希臘字母、上下標數字、運算符號、組合用的上橫線／帽子 w̄、ŷ）。公式（`$...$`）裡也不可以出現。 */
const UNICODE_CHARS = /[\u0300-\u03ff\u2070-\u209f\u00b2\u00b3\u00b9\u2211\u220f\u221a\u221e\u2264\u2265\u2260\u2248\u00b1\u2213\u00b7\u00d7\u00f7\u2202\u2207\u2208\u221d\u230a\u230b\u2308\u2309\u2112\u{1d4a9}\u00bd]/u
/** 公式以外的文字：除了 Unicode 數學字元，也不可以用 `w_k`、`x^2` 這類純文字拼的下標／上標（與 mermaidTestUtils.unicodeMathIn 相同的判準）。 */
const UNICODE_MATH = new RegExp(`${UNICODE_CHARS.source}|\\b[A-Za-z]{1,3}_[A-Za-z0-9{]|\\^[-0-9{]`, 'u')

const INLINE = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

/** 一個送進 Plot 的 data／layout（轉換前）。 */
export interface PlotCall {
  data: unknown
  layout: unknown
}

/** 找出 data／layout 裡所有會顯示的字串（與 applyPlotMath 走同樣的欄位）。 */
export function chartStrings(value: unknown, key: string | null = null, depth = 0, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (key !== null && TEXT_KEYS.has(key)) out.push(value)
    return out
  }
  if (depth > 6 || value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return out
  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === 'number') return out
    for (const v of value) chartStrings(v, key, depth + 1, out)
    return out
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) chartStrings(v, k, depth + 1, out)
  return out
}

/** 一個圖內字串的問題：`$` 沒有成對、公式裡有 Unicode 拼的數學、公式以外的文字還有 Unicode 拼的數學。 */
export function chartStringProblem(s: string): string | null {
  const bare = s.replace(/\\\$/g, '')
  if ((bare.match(/\$/g) ?? []).length % 2 !== 0) return `「${s}」的 $ 沒有成對`
  for (const m of s.matchAll(INLINE)) {
    if (UNICODE_CHARS.test(m[1])) return `「${s}」的公式 $${m[1]}$ 裡有 Unicode 拼的數學（要寫成 TeX 指令）`
  }
  const prose = s.replace(INLINE, '')
  if (UNICODE_MATH.test(prose)) return `「${s}」在 $...$ 以外還有 Unicode 拼的數學：${prose.match(UNICODE_MATH)?.[0]}`
  return null
}

/** 所有記錄下來的 Plot 呼叫裡，不符合「圖內數學一律 LaTeX」的字串（空陣列 = 全部合格）。 */
export function chartStringProblems(calls: readonly PlotCall[]): string[] {
  const seen = new Set<string>()
  const problems: string[] = []
  for (const c of calls) {
    for (const s of [...chartStrings(c.data), ...chartStrings(c.layout)]) {
      if (seen.has(s)) continue
      seen.add(s)
      const p = chartStringProblem(s)
      if (p) problems.push(p)
    }
  }
  return problems
}

/**
 * 經 plotMath 轉成 Plotly pseudo-HTML 之後仍殘留的 TeX 痕跡（反斜線、大括號、`$`）：代表某個指令 plotMath 不認得。
 * 回傳「原字串 → 轉換結果」有問題的清單（空陣列 = 全部合格）。
 */
export function plotlyLeftovers(strings: readonly string[], convert: (s: string) => string): string[] {
  const out: string[] = []
  for (const s of strings) {
    const c = convert(s)
    if (/[\\{}$]/.test(c)) out.push(`「${s}」→「${c}」`)
  }
  return out
}

/** 所有記錄下來的圖內字串（去重），給測試挑出特定的字串來核對。 */
export function allChartStrings(calls: readonly PlotCall[]): string[] {
  return [...new Set(calls.flatMap((c) => [...chartStrings(c.data), ...chartStrings(c.layout)]))]
}
