/**
 * Formula & Unit Reference 頁的全文搜尋（純函式，無 React）。
 *
 * 設計目標：讀者可以用「中文」「英文術語」「TeX 原始碼」「Unicode 數學符號」任一種寫法找到同一個條目。
 *   - 'μ'、'\mu'、'mu' 都會被正規化成 'mu'；'δw'、'\delta w'、'delta_w' → 'deltaw'
 *   - 全形字元、上下標數字（σ²、x₀）用 NFKC 轉成半形（σ2、x0）
 *   - TeX 排版指令（\mathrm、\left、\,、\quad …）與 {}_^$ 一律去掉，空白也去掉（中文沒有空白）
 * 查詢字串先以空白切成多個 token，每個 token 都必須出現在 haystack 中（AND）。
 */

/** 希臘字母（含常見變體）→ TeX 名稱；先 toLowerCase 再查表，所以大寫 Ω、Δ、Σ 會落到小寫。 */
const GREEK: Record<string, string> = {
  α: 'alpha',
  β: 'beta',
  γ: 'gamma',
  δ: 'delta',
  ε: 'epsilon',
  ϵ: 'epsilon',
  ζ: 'zeta',
  η: 'eta',
  θ: 'theta',
  ϑ: 'theta',
  ι: 'iota',
  κ: 'kappa',
  λ: 'lambda',
  μ: 'mu',
  µ: 'mu', // U+00B5 MICRO SIGN（NFKC 之後也會變成 μ，這裡保險）
  ν: 'nu',
  ξ: 'xi',
  π: 'pi',
  ρ: 'rho',
  σ: 'sigma',
  ς: 'sigma',
  τ: 'tau',
  υ: 'upsilon',
  φ: 'phi',
  ϕ: 'phi',
  χ: 'chi',
  ψ: 'psi',
  ω: 'omega',
}

/** 數學運算符號 → 可搜尋的 ASCII 名稱（與 TeX 指令名稱一致） */
const SYMBOLS: Record<string, string> = {
  '−': '-',
  '–': '-',
  '—': '-',
  '≤': 'le',
  '≥': 'ge',
  '≈': 'approx',
  '∞': 'infty',
  '∫': 'int',
  '∑': 'sum',
  '√': 'sqrt',
  '∂': 'partial',
  '⇒': 'rightarrow',
  '→': 'to',
  '∈': 'in',
  '·': '',
  '×': 'times',
  '′': "'",
}

/** TeX 中只影響排版、不影響意義的指令（會被整個刪掉） */
const TEX_FORMAT = /\\(?:mathrm|mathbf|mathsf|mathcal|mathbb|boldsymbol|operatorname|text|textbf|left|right|bigg|Bigg|big|Big|displaystyle|scriptstyle|tfrac|dfrac|frac|quad|qquad|hat|tilde|bar|overline|underline|mathit|limits|nolimits)(?![a-zA-Z])/g
/** \varepsilon、\varphi、\vartheta → \epsilon、\phi、\theta */
const TEX_VAR = /\\var(?=[a-zA-Z])/g
/** TeX 間距指令 \, \; \: \! \␣ */
const TEX_SPACE = /\\[,;:! ]/g

/**
 * 正規化：NFKC → 小寫 → 去 TeX 排版 → 希臘字母/運算符號轉名稱 → 去掉 \ { } _ ^ $ 與所有空白。
 * 對 haystack 與 query token 使用同一個函式，因此兩邊寫法不同也能比對。
 */
export function normalizeSearch(s: string): string {
  let t = s.normalize('NFKC')
  t = t.replace(TEX_SPACE, ' ').replace(TEX_VAR, '\\').replace(TEX_FORMAT, '')
  t = t.toLowerCase()
  let out = ''
  for (const ch of t) {
    const g = GREEK[ch]
    if (g !== undefined) {
      out += g
      continue
    }
    const m = SYMBOLS[ch]
    out += m !== undefined ? m : ch
  }
  // 剩下的反斜線與結構符號一律移除
  return out.replace(/[\\{}_^$]/g, '').replace(/\s+/g, '')
}

/** 把使用者輸入切成 token（以空白、全形空白或逗號分隔），每個 token 已正規化；空 token 略去。 */
export function tokenize(query: string): string[] {
  return query
    .normalize('NFKC')
    .split(/[\s,，、]+/)
    .map(normalizeSearch)
    .filter((t) => t.length > 0)
}

/** 由多個欄位組成一個已正規化的 haystack（欄位之間用 '|' 分隔，避免跨欄位誤配對）。 */
export function buildHaystack(parts: ReadonlyArray<string | number | null | undefined | false>): string {
  return parts
    .filter((p): p is string | number => p !== null && p !== undefined && p !== false && `${p}`.length > 0)
    .map((p) => normalizeSearch(String(p)))
    .join('|')
}

/** 所有 token 都出現在 haystack 中才算符合；沒有 token（空查詢）時一律符合。 */
export function matchesAll(haystack: string, tokens: readonly string[]): boolean {
  for (const t of tokens) if (!haystack.includes(t)) return false
  return true
}

/** 依 tokens 過濾；回傳新陣列（保持原順序）。 */
export function filterByTokens<T>(items: readonly T[], haystackOf: (item: T) => string, tokens: readonly string[]): T[] {
  if (tokens.length === 0) return items.slice()
  return items.filter((it) => matchesAll(haystackOf(it), tokens))
}

/** 查詢字串是否「剛好是」一個公式 ID（例如 'F-12.9'、'f-12.9'），是的話回傳標準寫法。 */
export function exactFormulaId(query: string, ids: ReadonlySet<string>): string | null {
  const q = query.normalize('NFKC').trim()
  if (!/^f-[\w.]+$/i.test(q)) return null
  for (const id of ids) if (id.toLowerCase() === q.toLowerCase()) return id
  return null
}

/** 從 '$…$' 夾雜的說明文字取出純文字（給 haystack 使用；TeX 本身也保留，正規化時會處理）。 */
export function richToPlain(s: string): string {
  return s.replace(/\$([^$]*)\$/g, ' $1 ')
}
