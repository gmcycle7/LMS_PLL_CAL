/**
 * Plotly 圖內文字（軸標題、圖例、註記、hover）的數學排版。
 *
 * Plotly 的 SVG 文字不能放 KaTeX，MathJax 模式又不能把中文和公式混在同一個標籤裡（公式以外的字會被丟掉）。
 * 所以這裡把字串裡的 `$...$`（LaTeX）轉成 Plotly 支援的 pseudo-HTML：
 *   變數斜體 <i>、下標 <sub>、上標 <sup>、希臘字母與運算符號用 Unicode、\frac{a}{b} 寫成行內 a/b。
 * 作者在圖表字串裡一律寫 LaTeX：`'學習率 $\\mu$'`、`'$\\sigma_w$ (fs)'`、`'$|H_{\\mathrm{PD}}|$ (dB)'`。
 * `Plot` 元件會自動對 title／軸標題／trace 名稱／annotation／ticktext／hovertemplate 套用。
 */

const GREEK_LOWER: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', tau: 'τ',
  upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', ell: 'ℓ',
}
const GREEK_UPPER: Record<string, string> = {
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
}
/** 直接換成符號（不斜體）的指令 */
const SYMBOL: Record<string, string> = {
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
  sim: '∼', simeq: '≃', equiv: '≡', propto: '∝', ll: '≪', gg: '≫', to: '→', rightarrow: '→', leftarrow: '←',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', iff: '⇔', mapsto: '↦', infty: '∞', partial: '∂', nabla: '∇',
  sum: 'Σ', prod: 'Π', int: '∫', in: '∈', notin: '∉', angle: '∠', circ: '∘', degree: '°', ldots: '…', dots: '…',
  cdots: '⋯', langle: '⟨', rangle: '⟩', mid: '|', vert: '|', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
  star: '⋆', ast: '∗', bullet: '•', prime: '′', forall: '∀', exists: '∃', cup: '∪', cap: '∩', subset: '⊂',
  quad: ' ', qquad: '  ', lt: '&lt;', gt: '&gt;', Re: 'Re', Im: 'Im', hbar: 'ℏ',
}
/** 正體的函數名稱 */
const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp',
  'min', 'max', 'arg', 'det', 'dim', 'lim', 'sup', 'inf', 'gcd', 'deg', 'Pr', 'mod', 'bmod', 'erf', 'erfc', 'sgn',
])
/** 加在前一個字元後面的 combining accent */
const ACCENT: Record<string, string> = {
  hat: '̂', widehat: '̂', bar: '̄', overline: '̄', tilde: '̃', widetilde: '̃', dot: '̇', ddot: '̈', vec: '⃗',
}
const CALLIGRAPHIC: Record<string, string> = { L: 'ℒ', N: '𝒩', O: '𝒪', F: 'ℱ', H: 'ℋ', E: 'ℰ', R: 'ℛ', B: 'ℬ', M: 'ℳ', P: '𝒫', C: '𝒞', D: '𝒟' }
/** 兩側加空白的關係運算子 */
const RELATIONS = new Set(['=', '≤', '≥', '≠', '≈', '∼', '≃', '≡', '∝', '≪', '≫', '→', '←', '⇒', '⇐', '⇔', '↦', '∈', '&lt;', '&gt;'])

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

interface Parser {
  src: string
  pos: number
}

/** 讀一個「原子」：{群組}、\指令（含其參數）、或單一字元；回傳轉好的 pseudo-HTML。 */
function parseAtom(p: Parser, upright: boolean): string {
  const ch = p.src[p.pos]
  if (ch === undefined) return ''
  if (ch === '{') {
    p.pos++
    const inner = parseUntil(p, '}', upright)
    if (p.src[p.pos] === '}') p.pos++
    return inner
  }
  if (ch === '\\') return parseCommand(p, upright)
  p.pos++
  if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '~') return ch === '~' ? ' ' : ''
  if (ch === '-') return '−'
  if (ch === '<') return '&lt;'
  if (ch === '>') return '&gt;'
  if (ch === '&') return '&amp;'
  if (ch === "'") return '′'
  if (ch === '*') return '∗'
  if (/[A-Za-z]/.test(ch)) return upright ? ch : `<i>${ch}</i>`
  return ch
}

/** 讀指令的一個參數（{…} 或單一原子）。 */
function parseArg(p: Parser, upright: boolean): string {
  while (p.src[p.pos] === ' ') p.pos++
  return parseAtom(p, upright)
}

/** 讀 \text{…}、\mathrm{…} 這類「原文照出」的參數（不解析內部指令，只處理巢狀括號）。 */
function readRawGroup(p: Parser): string {
  while (p.src[p.pos] === ' ') p.pos++
  if (p.src[p.pos] !== '{') {
    const c = p.src[p.pos] ?? ''
    p.pos++
    return c
  }
  let depth = 0
  let out = ''
  for (; p.pos < p.src.length; p.pos++) {
    const c = p.src[p.pos]
    if (c === '{') {
      if (depth++ > 0) out += c
    } else if (c === '}') {
      if (--depth === 0) {
        p.pos++
        break
      }
      out += c
    } else out += c
  }
  return out
}

const needsParens = (html: string) => {
  const plain = html.replace(/<\/?(i|b|sub|sup)>/g, '').replace(/&[a-z]+;/g, 'x')
  return [...plain].length > 1 && !/^[\d.]+$/.test(plain) && !/^[^\s+−·×/=]+$/.test(plain)
}
const group = (html: string) => (needsParens(html) ? `(${html})` : html)

function parseCommand(p: Parser, upright: boolean): string {
  p.pos++ // 跳過反斜線
  const m = /^[A-Za-z]+/.exec(p.src.slice(p.pos))
  if (!m) {
    // \, \; \: \! \  \{ \} \% \_ \# \& \| \\
    const c = p.src[p.pos] ?? ''
    p.pos++
    if (c === ',' || c === ':' || c === ';') return ' '
    if (c === '!') return ''
    if (c === ' ') return ' '
    if (c === '|') return '‖'
    if (c === '\\') return '<br>'
    return escapeText(c)
  }
  const name = m[0]
  p.pos += name.length
  if (name in GREEK_LOWER) return upright ? GREEK_LOWER[name] : `<i>${GREEK_LOWER[name]}</i>`
  if (name in GREEK_UPPER) return GREEK_UPPER[name]
  if (name in SYMBOL) return SYMBOL[name]
  if (FUNCTIONS.has(name)) return name === 'bmod' ? ' mod ' : name
  if (name in ACCENT) {
    const inner = parseArg(p, upright)
    // accent 加在第一個實際字元後面（跳過開頭的標籤）
    const k = /^(?:<[^>]+>)*./u.exec(inner)
    return k ? inner.slice(0, k[0].length) + ACCENT[name] + inner.slice(k[0].length) : inner
  }
  switch (name) {
    case 'text':
    case 'textrm':
    case 'mbox':
    case 'textnormal':
      return escapeText(readRawGroup(p))
    case 'mathrm':
    case 'operatorname':
    case 'mathsf':
    case 'mathtt':
      return parseSub({ src: readRawGroup(p), pos: 0 }, true)
    case 'mathit':
      return parseSub({ src: readRawGroup(p), pos: 0 }, false)
    case 'mathbf':
    case 'boldsymbol':
    case 'bm':
    case 'textbf':
      return `<b>${parseSub({ src: readRawGroup(p), pos: 0 }, name === 'textbf' ? true : upright)}</b>`
    case 'mathcal':
    case 'mathscr': {
      const raw = readRawGroup(p)
      return [...raw].map((c) => CALLIGRAPHIC[c] ?? `<i>${escapeText(c)}</i>`).join('')
    }
    case 'mathbb': {
      const raw = readRawGroup(p)
      const BB: Record<string, string> = { R: 'ℝ', Z: 'ℤ', N: 'ℕ', C: 'ℂ', Q: 'ℚ', E: '𝔼', P: 'ℙ' }
      return [...raw].map((c) => BB[c] ?? escapeText(c)).join('')
    }
    case 'frac':
    case 'dfrac':
    case 'tfrac': {
      const a = parseArg(p, upright)
      const b = parseArg(p, upright)
      return `${group(a)}/${group(b)}`
    }
    case 'sqrt': {
      let index = ''
      if (p.src[p.pos] === '[') {
        const end = p.src.indexOf(']', p.pos)
        if (end > 0) {
          index = `<sup>${parseSub({ src: p.src.slice(p.pos + 1, end), pos: 0 }, upright)}</sup>`
          p.pos = end + 1
        }
      }
      const a = parseArg(p, upright)
      return `${index}√${needsParens(a) || /[<&]/.test(a.replace(/<\/?i>/g, '')) ? `(${a})` : a}`
    }
    case 'left':
    case 'right':
    case 'big':
    case 'Big':
    case 'bigg':
    case 'Bigg':
    case 'bigl':
    case 'bigr':
    case 'Bigl':
    case 'Bigr':
    case 'displaystyle':
    case 'textstyle':
    case 'limits':
    case 'nolimits':
    case 'nonumber':
      if ((name === 'left' || name === 'right') && p.src[p.pos] === '.') p.pos++
      return ''
    case 'boxed':
    case 'underline':
      return parseArg(p, upright)
    case 'underbrace':
    case 'overbrace':
      return parseArg(p, upright)
    default:
      // 不認得的指令：原樣輸出名稱（正體），讓作者看得出來要補對照表
      return name
  }
}

function parseUntil(p: Parser, stop: string | null, upright: boolean): string {
  let out = ''
  while (p.pos < p.src.length) {
    const ch = p.src[p.pos]
    if (stop && ch === stop) break
    if (ch === '_' || ch === '^') {
      p.pos++
      const tag = ch === '_' ? 'sub' : 'sup'
      const inner = parseArg(p, upright)
      // ^\circ → 度數符號；^\prime → ′
      out += inner === '∘' ? '°' : inner === '′' ? '′' : `<${tag}>${inner}</${tag}>`
      continue
    }
    const atom = parseAtom(p, upright)
    out += RELATIONS.has(atom) ? ` ${atom} ` : atom
  }
  return out
}

function parseSub(p: Parser, upright: boolean): string {
  return parseUntil(p, null, upright)
}

/** 合併相鄰的 <i>…</i>，並整理多餘空白。 */
function tidy(html: string): string {
  return html
    .replace(/<\/i><i>/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/** 一段 LaTeX（不含 `$`）→ Plotly pseudo-HTML。 */
export function texToPlotly(tex: string): string {
  return tidy(parseSub({ src: tex, pos: 0 }, false))
}

const INLINE = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

/** 把字串裡每一段 `$...$` 換成 Plotly pseudo-HTML；其餘文字不動（`\$` 還原成 `$`）。 */
export function plotMath(text: string): string {
  if (!text.includes('$')) return text
  return text.replace(INLINE, (_, tex: string) => texToPlotly(tex)).replace(/\\\$/g, '$')
}

/** 會顯示在圖上的字串欄位（其餘欄位，例如資料陣列、顏色、id，一律不碰） */
const TEXT_KEYS = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext', 'label', 'ticksuffix', 'tickprefix', 'legendgrouptitle'])

function walk(value: unknown, key: string | null, depth: number): unknown {
  if (typeof value === 'string') return key !== null && TEXT_KEYS.has(key) ? plotMath(value) : value
  if (depth > 6 || value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return value
  if (Array.isArray(value)) {
    if (value.length === 0) return value
    if (typeof value[0] === 'string') return key !== null && TEXT_KEYS.has(key) && value.length <= 5000 ? value.map((v) => (typeof v === 'string' ? plotMath(v) : v)) : value
    if (typeof value[0] === 'number') return value
    let changed = false
    const out = value.map((v) => {
      const w = walk(v, key, depth + 1)
      if (w !== v) changed = true
      return w
    })
    return changed ? out : value
  }
  let changed = false
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // title / legendgrouptitle 可以是字串或 { text }；物件形式時往下走並沿用 'text' 規則
    const w = walk(v, k, depth + 1)
    if (w !== v) changed = true
    out[k] = w
  }
  return changed ? out : value
}

/** 對 Plotly 的 data 與 layout 套用 plotMath（只處理會顯示的文字欄位；沒有 `$` 時回傳原物件）。 */
export function applyPlotMath<D, L>(data: D, layout: L): { data: D; layout: L } {
  return { data: walk(data, null, 0) as D, layout: walk(layout, null, 0) as L }
}
