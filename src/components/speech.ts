/**
 * 數學的「可念形式」：給 aria-label / title / aria-valuetext / <option> 這些只能放純文字的無障礙名稱用。
 *
 * 為什麼需要：獨立公式（TexBlock）畫面上有 MathML、行內公式（Tex）有 `role="math"` + 同一個 `texToSpeech` 產生的 aria-label，螢幕閱讀器念得出來；但名稱欄位（滑桿、輸入框、圖說、分頁）
 * 只能是字串。原本拿掉 `$` 就直接放進去，結果螢幕閱讀器念出「backslash sigma underscore v」。
 *
 * - `texToSpeech(tex)`：一段 TeX → 可念的文字。希臘字母念名稱（\sigma → sigma），下標直接接在後面
 *   （x_{ref} → x ref），上標用中文（^2 → 平方、^{-1} → 的負 1 次方），常用巨集換成中文詞
 *   （\frac{a}{b} → a 除以 b、\sqrt → 根號、\pm → 正負、\times → 乘、\approx → 約等於 …），
 *   其餘大括號與反斜線一律去掉。不認識的指令保留指令名稱（\foo → foo），所以輸出永遠不含 `\ { } ^ _ $`。
 * - `accessibleText(s)`：字串中的每個 `$...$` 換成它的可念形式，其餘原樣保留（`\$` 還原成字面的 `$`）。
 *   `stripMathDelimiters`（Tex.tsx）仍保留 TeX 原始碼，只用在程式碼、id、報告等「要原始碼」的地方。
 *
 * 這個模組不依賴 React / DOM，測試與腳本可以直接用。
 */

/** 配對的 `$...$`（`\\$` 為字面金額符號，不算分隔符）。mathText / stripMathDelimiters / accessibleText 共用。 */
export const INLINE_MATH = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

const HAS_INLINE_MATH = new RegExp(INLINE_MATH.source)

/** 字串裡有沒有配對的 `$...$`（`\\$` 字面金額不算） */
export function hasInlineMath(text: string): boolean {
  return text.includes('$') && HAS_INLINE_MATH.test(text)
}

/* ---------- 對照表 ---------- */

const GREEK = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho',
  'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon',
  'Phi', 'Psi', 'Omega',
])
const GREEK_VARIANT: Record<string, string> = { varepsilon: 'epsilon', vartheta: 'theta', varphi: 'phi', varrho: 'rho', varsigma: 'sigma', varpi: 'pi' }

/** 直接當一個詞念的符號 */
const WORD: Record<string, string> = {
  infty: '無限大', partial: '偏微分', nabla: '梯度', angle: '角', degree: '度', emptyset: '空集合', varnothing: '空集合',
  ldots: '…', dots: '…', cdots: '…', vdots: '…', ddots: '…', star: '星號', ast: '星號', checkmark: '勾選', hbar: 'h bar',
  prime: 'prime', Re: '實部', Im: '虛部', ell: 'ell', top: '轉置', intercal: '轉置', dagger: '共軛轉置', circ: '圈', bullet: '點',
  uparrow: '上升', downarrow: '下降', Pr: '機率', aleph: 'aleph', imath: 'i', jmath: 'j',
}
/** 二元運算符號 */
const OP: Record<string, string> = {
  cdot: '乘', times: '乘', div: '除以', pm: '正負', mp: '負正', cup: '聯集', cap: '交集', oplus: 'XOR', otimes: '張量積',
  circledast: '卷積', bmod: 'mod', setminus: '扣除', wedge: '且', land: '且', vee: '或', lor: '或', ominus: '減', odot: '乘',
}
/** 關係符號（等號、不等號、箭頭） */
const REL: Record<string, string> = {
  approx: '約等於', simeq: '約等於', sim: '約為', equiv: '恆等於', propto: '正比於', ne: '不等於', neq: '不等於',
  le: '小於等於', leq: '小於等於', leqslant: '小於等於', ge: '大於等於', geq: '大於等於', geqslant: '大於等於',
  ll: '遠小於', gg: '遠大於', ggg: '遠大於', lll: '遠小於', lesssim: '小於約', gtrsim: '大於約', preceq: '小於等於', succeq: '大於等於',
  prec: '小於', succ: '大於', in: '屬於', notin: '不屬於', ni: '包含元素', subset: '包含於', subseteq: '包含於', supset: '包含',
  supseteq: '包含', perp: '垂直於', parallel: '平行於', mid: '給定', nmid: '不整除', triangleq: '定義為', cong: '全等於',
  mapsto: '對應到', leftarrow: '左箭頭', gets: '左箭頭', leftrightarrow: '雙向箭頭', Rightarrow: '推得', Longrightarrow: '推得',
  implies: '推得', Leftarrow: '被推得', Longleftarrow: '被推得', Leftrightarrow: '若且唯若', Longleftrightarrow: '若且唯若',
  longleftrightarrow: '雙向箭頭', iff: '若且唯若', lt: '小於', gt: '大於', doteq: '約等於', coloneqq: '定義為',
}
/** 前綴詞（量詞、否定） */
const PREFIX: Record<string, string> = { forall: '對所有', exists: '存在', neg: '非', lnot: '非' }
/** 函數名稱：直接念名稱 */
const FUNCTION_NAME = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln', 'lg', 'exp',
  'max', 'min', 'arg', 'det', 'dim', 'gcd', 'deg', 'sup', 'inf', 'ker', 'hom', 'limsup', 'liminf', 'sgn',
])
/** 加在前一個符號後面的記號 */
const ACCENT: Record<string, string> = {
  hat: 'hat', widehat: 'hat', bar: 'bar', overline: 'bar', tilde: 'tilde', widetilde: 'tilde', dot: 'dot', ddot: 'ddot',
  check: 'check', breve: 'breve', acute: 'acute', grave: 'grave', mathring: 'ring',
}
/** 只要內容（字型、框、對齊等排版指令） */
const CONTENT_ONLY = new Set([
  'mathbf', 'mathit', 'mathcal', 'mathbb', 'mathfrak', 'mathscr', 'boldsymbol', 'bm', 'pmb', 'boxed', 'fbox', 'bbox', 'cancel',
  'bcancel', 'xcancel', 'sout', 'underline', 'mathop', 'mathbin', 'mathrel', 'mathord', 'mathpunct', 'mathinner', 'mathclap',
  'smash', 'textcolor', 'colorbox',
])
/** 內容照字母連成一個詞（\mathrm{fs}、\operatorname{Var}、\mathsf{T}） */
const WORD_MODE = new Set(['mathrm', 'operatorname', 'mathsf', 'mathtt', 'mathnormal'])
/** 純文字（可含中文與空白） */
const TEXT_MODE = new Set(['text', 'textrm', 'textbf', 'textit', 'textsf', 'texttt', 'mbox', 'hbox', 'textnormal', 'textup'])
/** 後面跟一個要丟掉的參數 */
const DROP_ARG = new Set(['phantom', 'hphantom', 'vphantom', 'hspace', 'vspace', 'hskip', 'vskip', 'label', 'tag', 'color', 'raisebox', 'kern', 'mkern', 'mskip'])
/** 完全不輸出的指令（間距、大小、換行對齊等） */
const NO_OUTPUT = new Set([
  ',', ';', ':', '!', ' ', '>', 'quad', 'qquad', 'enspace', 'thinspace', 'medspace', 'thickspace', 'negthinspace', 'negmedspace',
  'negthickspace', 'hfill', 'hline', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'bigm', 'Bigl', 'Bigr', 'Bigm', 'biggl', 'biggr',
  'biggm', 'Biggl', 'Biggr', 'Biggm', 'limits', 'nolimits', 'nonumber', 'notag', 'strut', 'allowbreak', 'relax', 'centering',
  'rm', 'bf', 'it', 'sf', 'tt', 'cal', 'bfseries', 'normalfont', 'mathstrut', 'vcenter', '{', '}', 'displaystyle', 'textstyle',
  'scriptstyle', 'scriptscriptstyle', 'left', 'right', 'middle', 'nobreak', 'break', 'protect',
])

const BIGOP_NOUN: Record<string, string> = { sum: '總和', prod: '連乘', int: '積分', iint: '二重積分', iiint: '三重積分', oint: '環積分', lim: '極限', bigcup: '聯集', bigcap: '交集' }
const X_ARROW: Record<string, string> = {
  xrightarrow: '箭頭', xlongequal: '等於', xleftarrow: '左箭頭', xRightarrow: '推得', xLeftarrow: '被推得', xleftrightarrow: '雙向箭頭',
  xrightleftharpoons: '平衡', xmapsto: '對應到',
}

const SUP_SPECIAL: Record<string, string> = {
  T: '轉置', '\\top': '轉置', '\\intercal': '轉置', '\\mathsf{T}': '轉置', '\\mathrm{T}': '轉置', '\\mathbf{T}': '轉置', '\\text{T}': '轉置',
  H: '共軛轉置', '\\dagger': '共軛轉置', '\\mathrm{H}': '共軛轉置', '\\mathsf{H}': '共軛轉置', '\\mathbf{H}': '共軛轉置',
  '*': '星號', '\\ast': '星號', '\\star': '星號', '\\prime': 'prime', "'": 'prime',
  '2': '平方', '3': '立方',
  '+': '正', '-': '負', // 單側極限：0^+ → 0 正
}

/* ---------- 剖析 ---------- */

type Kind = 'w' | 'op' | 'rel' | 'open' | 'close' | 'sep' | 'u' | 'abs' | 'norm'
interface Item {
  k: Kind
  t: string
  /** 複合項（含運算符號或多個詞）：當分子、分母、根號內容時要加括號 */
  c?: boolean
  /** \underbrace / \overbrace：後面的上下標是標註 */
  br?: boolean
  /** abs / norm 配對用的序號 */
  n?: number
}
interface State {
  /** \rm 之後：英文字母連成一個詞 */
  word: boolean
  /** \not 之後 */
  not: boolean
  absCount: number
  normCount: number
}
interface Cx {
  s: string
  i: number
  depth: number
  steps: number
  /** >0 時不接上下標：單一參數（\hat\mu_k 的 \mu）不該把後面的 _k 吃掉 */
  noScripts: number
}

const MAX_DEPTH = 40
const MAX_STEPS = 50000
const isLetter = (c: string | undefined) => !!c && /[A-Za-z]/.test(c)
const isDigit = (c: string | undefined) => !!c && c >= '0' && c <= '9'

function skipSpace(cx: Cx): void {
  while (cx.i < cx.s.length && /\s/.test(cx.s[cx.i]!)) cx.i++
}

/** 把一串 Item 接成一句話：括號內側不加空白，逗號前不加空白，f(x)、E[x] 保持連在一起。 */
function join(items: Item[]): string {
  let out = ''
  let prev: Item | null = null
  for (const it of items) {
    if (!it.t) continue
    if (prev === null) out = it.t
    else {
      const tight =
        it.k === 'close' ||
        it.k === 'sep' ||
        prev.k === 'open' ||
        (it.k === 'open' && prev.k === 'w' && (it.t === '(' || it.t === '['))
      out += (tight ? '' : ' ') + it.t
    }
    prev = it
  }
  return out
}

/** 分子、分母、根號內容：不只一項時加全形括號，避免念成「a 加 b 除以 c」 */
function wrapped(items: Item[]): string {
  const text = join(items)
  const nonEmpty = items.filter((x) => x.t)
  return nonEmpty.length > 1 || nonEmpty[0]?.c ? `（${text}）` : text
}

/** 接在中文詞後面：全形括號前不加空白 */
function spaced(w: string): string {
  return w.startsWith('（') ? w : ` ${w}`
}

function isPrefixPosition(items: Item[]): boolean {
  const last = items[items.length - 1]
  if (!last) return true
  if (last.k === 'abs' || last.k === 'norm') return (last.n ?? 0) % 2 === 0
  return last.k === 'op' || last.k === 'rel' || last.k === 'open' || last.k === 'sep' || last.k === 'u'
}

function push(items: Item[], it: Item): void {
  // 連續的分隔符號只留一個（例如 cases 裡的 `0,&…`）
  const last = items[items.length - 1]
  if (it.k === 'sep' && last?.k === 'sep') return
  items.push(it)
}

/** 讀一個單位（不含上下標）：給指令的單一參數用 */
function readSingle(cx: Cx, st: State): Item[] {
  skipSpace(cx)
  const out: Item[] = []
  if (cx.i >= cx.s.length) return out
  if (cx.s[cx.i] === '}') return out
  cx.noScripts++
  try {
    parseUnit(cx, out, st, true)
  } finally {
    cx.noScripts--
  }
  return out
}

/** 讀一個參數：{…} 或單一單位。word=true 時英文字母連成一個詞。 */
function readArg(cx: Cx, word = false): Item[] {
  skipSpace(cx)
  if (cx.s[cx.i] === '{') {
    cx.i++
    const inner = parseSeq(cx, '}', word)
    if (cx.s[cx.i] === '}') cx.i++
    return inner
  }
  return readSingle(cx, { word, not: false, absCount: 0, normCount: 0 })
}

/** \text{…}：原文照念（含中文），去掉跳脫反斜線 */
function readRaw(cx: Cx): string {
  skipSpace(cx)
  if (cx.s[cx.i] !== '{') {
    const ch = cx.s[cx.i] ?? ''
    if (ch) cx.i++
    return ch
  }
  cx.i++
  let depth = 1
  let out = ''
  while (cx.i < cx.s.length) {
    const ch = cx.s[cx.i]!
    cx.i++
    if (ch === '{') {
      depth++
      continue
    }
    if (ch === '}') {
      depth--
      if (depth === 0) break
      continue
    }
    if (ch === '\\') {
      const nx = cx.s[cx.i]
      if (nx !== undefined && /[A-Za-z]/.test(nx)) {
        while (cx.i < cx.s.length && /[A-Za-z]/.test(cx.s[cx.i]!)) cx.i++
        out += ' '
      } else if (nx !== undefined) {
        cx.i++
        out += nx === ',' || nx === ';' || nx === ':' || nx === '!' ? ' ' : nx === '\\' ? ' ' : nx
      }
      continue
    }
    out += ch
  }
  return out.replace(/\s+/g, ' ').trim()
}

interface ScriptPart {
  type: 'sub' | 'sup' | 'prime'
  items: Item[]
  /** 原始碼（去掉最外層大括號），用來辨識 ^T、^* 等固定寫法 */
  src: string
}

/** 讀緊接在後面的 `_` / `^` / `'`（依出現順序） */
function readScripts(cx: Cx): ScriptPart[] {
  const parts: ScriptPart[] = []
  for (;;) {
    const save = cx.i
    skipSpace(cx)
    const ch = cx.s[cx.i]
    if (ch === "'") {
      cx.i++
      parts.push({ type: 'prime', items: [], src: "'" })
      continue
    }
    if (ch !== '_' && ch !== '^') {
      cx.i = save
      return parts
    }
    cx.i++
    skipSpace(cx)
    const start = cx.i
    const items = ch === '_' ? readScriptArg(cx, true) : readScriptArg(cx, false)
    const raw = cx.s.slice(start, cx.i).trim()
    const src = raw.startsWith('{') && raw.endsWith('}') ? raw.slice(1, -1).trim() : raw
    parts.push({ type: ch === '_' ? 'sub' : 'sup', items, src })
    if (parts.length > 8) return parts
  }
}

function readScriptArg(cx: Cx, word: boolean): Item[] {
  skipSpace(cx)
  if (cx.s[cx.i] === '{') {
    cx.i++
    const inner = parseSeq(cx, '}', word)
    if (cx.s[cx.i] === '}') cx.i++
    return inner
  }
  return readSingle(cx, { word, not: false, absCount: 0, normCount: 0 })
}

/** 上下標內容含運算符號時加全形括號：y_{m-1} 念成「y（m 減 1）」，不是「y m 減 1」 */
function scriptText(items: Item[]): string {
  const text = join(items)
  const compound = items.some((x) => x.k === 'op' || x.k === 'rel' || x.c)
  return compound ? `（${text}）` : text
}

function supSpeech(p: ScriptPart): string {
  if (p.type === 'prime') return 'prime'
  const text = scriptText(p.items)
  const key = p.src.replace(/\s+/g, '')
  if (key === '\\circ' || key === '^\\circ') return '度' // 站上的 ^\circ 一律是角度（90^\circ、單位 {}^\circ）
  if (SUP_SPECIAL[key]) return SUP_SPECIAL[key]!
  if (!text) return ''
  return `的${text.startsWith('負') || text.startsWith('（') ? '' : ' '}${text} 次方`
}

/** 把上下標接到最後一個項目後面 */
function attachScripts(cx: Cx, items: Item[]): void {
  if (cx.noScripts > 0) return
  const parts = readScripts(cx)
  if (parts.length === 0) return
  let last = items[items.length - 1]
  if (!last || last.k === 'sep' || last.k === 'open') {
    last = { k: 'w', t: '' }
    items.push(last)
  }
  for (const p of parts) {
    let sp: string
    if (last.br) sp = p.items.length ? `（${join(p.items)}）` : ''
    else if (p.type === 'sub') sp = scriptText(p.items)
    else sp = supSpeech(p)
    if (sp) last.t = last.t ? `${last.t} ${sp}` : sp
  }
}

function numberToken(cx: Cx, single: boolean): string {
  if (single) {
    const ch = cx.s[cx.i]!
    cx.i++
    return ch
  }
  const m = /^(?:\d+\.?\d*|\.\d+)/.exec(cx.s.slice(cx.i))
  const tok = m ? m[0] : cx.s[cx.i]!
  cx.i += tok.length
  return tok
}

const UNICODE_OP: Record<string, [Kind, string]> = {
  '×': ['op', '乘'], '·': ['op', '乘'], '⋅': ['op', '乘'], '÷': ['op', '除以'], '±': ['op', '正負'], '∓': ['op', '負正'],
  '≈': ['rel', '約等於'], '≤': ['rel', '小於等於'], '≥': ['rel', '大於等於'], '≠': ['rel', '不等於'], '→': ['rel', '對應到'],
  '←': ['rel', '左箭頭'], '⇒': ['rel', '推得'], '⇔': ['rel', '若且唯若'], '∝': ['rel', '正比於'], '≡': ['rel', '恆等於'],
  '∞': ['w', '無限大'], '∂': ['w', '偏微分'], '∇': ['w', '梯度'], '…': ['w', '…'],
}

function parseUnit(cx: Cx, items: Item[], st: State, single = false): void {
  const s = cx.s
  if (++cx.steps > MAX_STEPS) {
    cx.i = s.length
    return
  }
  const ch = s[cx.i]!
  if (/\s/.test(ch)) {
    cx.i++
    return
  }
  if (ch === '{') {
    if (cx.depth > MAX_DEPTH) {
      cx.i = s.length
      return
    }
    cx.i++
    const inner = parseSeq(cx, '}', st.word)
    if (s[cx.i] === '}') cx.i++
    const nonEmpty = inner.filter((x) => x.t)
    if (nonEmpty.length) push(items, { k: 'w', t: join(inner), c: nonEmpty.length > 1 || !!nonEmpty[0]?.c })
    attachScripts(cx, items)
    return
  }
  if (ch === '\\') {
    parseCommand(cx, items, st)
    return
  }
  if (ch === '^' || ch === '_') {
    attachScripts(cx, items)
    return
  }
  if (isDigit(ch) || (ch === '.' && isDigit(s[cx.i + 1]))) {
    push(items, { k: 'w', t: numberToken(cx, single) })
    attachScripts(cx, items)
    return
  }
  if (isLetter(ch)) {
    let tok = ch
    cx.i++
    if (st.word && !single) {
      while (cx.i < s.length && /[A-Za-z0-9]/.test(s[cx.i]!)) tok += s[cx.i++]
    }
    push(items, { k: 'w', t: tok })
    attachScripts(cx, items)
    return
  }
  cx.i++
  switch (ch) {
    case '+':
      push(items, isPrefixPosition(items) ? { k: 'u', t: '正' } : { k: 'op', t: '加' })
      return
    case '-':
    case '−':
    case '–':
      push(items, isPrefixPosition(items) ? { k: 'u', t: '負' } : { k: 'op', t: '減' })
      return
    case '*':
      push(items, { k: 'op', t: '卷積' }) // 站上的 `*` 一律是卷積（h*x）；乘法寫 \times / \cdot
      return
    case '/':
      push(items, { k: 'op', t: '除以' })
      return
    case '=':
      push(items, { k: 'rel', t: '等於' })
      return
    case '<':
      push(items, { k: 'rel', t: '小於' })
      return
    case '>':
      push(items, { k: 'rel', t: '大於' })
      return
    case '(':
    case '[':
      push(items, { k: 'open', t: ch })
      return
    case ')':
    case ']':
      push(items, { k: 'close', t: ch })
      attachScripts(cx, items)
      return
    case '|':
      pushBar(cx, items, st, 'abs')
      return
    case ',':
    case ';':
    case '&':
      push(items, { k: 'sep', t: ',' })
      return
    case ':':
      if (s[cx.i] === '=') {
        cx.i++
        push(items, { k: 'rel', t: '定義為' })
      } else push(items, { k: 'sep', t: ':' })
      return
    case '.':
    case '?':
      push(items, { k: 'sep', t: ch })
      return
    case '!':
      push(items, { k: 'w', t: '階乘' })
      return
    case "'":
      push(items, { k: 'w', t: 'prime' })
      return
    case '~':
    case '`':
    case '"':
      return
    default:
  }
  const u = UNICODE_OP[ch]
  if (u) {
    push(items, { k: u[0], t: u[1] })
    return
  }
  if (ch.charCodeAt(0) > 127) {
    // 連續的中文（或其他非 ASCII 字元）併成一個詞
    let tok = ch
    while (cx.i < s.length && s.charCodeAt(cx.i) > 127 && !/\s/.test(s[cx.i]!) && !UNICODE_OP[s[cx.i]!]) tok += s[cx.i++]
    push(items, { k: 'w', t: tok })
    attachScripts(cx, items)
    return
  }
  push(items, { k: 'w', t: ch })
}

/** `|` / `\|`：絕對值或範數的開關；`|_{…}`（代入）是「在…時」 */
function pushBar(cx: Cx, items: Item[], st: State, kind: 'abs' | 'norm'): void {
  const save = cx.i
  skipSpace(cx)
  // 沒有開著的絕對值時，`|_{d=0}` 是「代入」；開著時（|z|_{\max}）這個 `|` 是關閉，下標屬於整個絕對值
  if (kind === 'abs' && st.absCount % 2 === 0 && cx.s[cx.i] === '_') {
    cx.i++
    const sub = readScriptArg(cx, false)
    push(items, { k: 'w', t: `在 ${join(sub)} 時` })
    return
  }
  cx.i = save
  const n = kind === 'abs' ? st.absCount++ : st.normCount++
  push(items, { k: kind, t: '', n })
}

/** 序列結束時決定每個 `|` 是開、是關，還是落單（落單的視為條件符號「給定」） */
function resolveBars(items: Item[], st: State): void {
  for (const kind of ['abs', 'norm'] as const) {
    const total = kind === 'abs' ? st.absCount : st.normCount
    const word = kind === 'abs' ? '絕對值' : '範數'
    for (const it of items) {
      if (it.k !== kind) continue
      const n = it.n ?? 0
      if (n % 2 === 0) {
        if (n === total - 1) {
          it.k = 'rel'
          it.t = '給定'
        } else {
          it.k = 'open'
          it.t = `${word}（`
        }
      } else {
        // 關閉的 `|` 後面可能接了上標（|H|^2）：attachScripts 先把「平方」放在 t 裡
        it.t = it.t ? `） ${it.t}` : '）'
        it.k = 'close'
      }
    }
  }
}

function parseSeq(cx: Cx, stop: '}' | ']' | 'end', word = false): Item[] {
  if (cx.depth > MAX_DEPTH) {
    cx.i = cx.s.length
    return []
  }
  cx.depth++
  const outerNoScripts = cx.noScripts
  cx.noScripts = 0
  const items: Item[] = []
  const st: State = { word, not: false, absCount: 0, normCount: 0 }
  while (cx.i < cx.s.length) {
    const ch = cx.s[cx.i]
    if (ch === '}') {
      if (stop === '}') break
      cx.i++
      continue
    }
    if (ch === ']' && stop === ']') break
    const before = cx.i
    parseUnit(cx, items, st)
    if (cx.i === before) cx.i++ // 不可能卡住
  }
  resolveBars(items, st)
  cx.noScripts = outerNoScripts
  cx.depth--
  return items
}

function readCommandName(cx: Cx): string {
  const s = cx.s
  cx.i++ // 跳過反斜線
  const ch = s[cx.i]
  if (ch === undefined) return ''
  if (isLetter(ch)) {
    let name = ''
    while (cx.i < s.length && isLetter(s[cx.i])) name += s[cx.i++]
    if (s[cx.i] === '*' && (name === 'operatorname' || name === 'mathop')) cx.i++
    return name
  }
  cx.i++
  return ch
}

function envWrapper(name: string): { open: string; close: string } | null {
  if (/^(?:[pbBvV]?matrix|smallmatrix)$/.test(name)) return { open: '矩陣（', close: '）' }
  if (name === 'cases') return { open: '分段（', close: '）' }
  return null
}

function parseCommand(cx: Cx, items: Item[], st: State): void {
  const name = readCommandName(cx)
  // 字母指令後面的空白不算
  if (isLetter(name[0])) while (cx.i < cx.s.length && cx.s[cx.i] === ' ') cx.i++
  const notOp = st.not
  st.not = false

  if (GREEK.has(name)) {
    push(items, { k: 'w', t: name })
    attachScripts(cx, items)
    return
  }
  if (GREEK_VARIANT[name]) {
    push(items, { k: 'w', t: GREEK_VARIANT[name]! })
    attachScripts(cx, items)
    return
  }
  if (FUNCTION_NAME.has(name)) {
    push(items, { k: 'w', t: name })
    attachScripts(cx, items)
    return
  }

  switch (name) {
    case 'not':
      st.not = true
      return
    case '\\': {
      // 換行；後面可能跟 [2pt]
      const m = /^\s*\[[^\]]*\]/.exec(cx.s.slice(cx.i))
      if (m) cx.i += m[0].length
      push(items, { k: 'sep', t: '；' })
      return
    }
    case 'left':
    case 'right':
    case 'middle':
      if (cx.s[cx.i] === '.') cx.i++
      return
    case 'frac':
    case 'dfrac':
    case 'tfrac':
    case 'cfrac': {
      const a = readArg(cx)
      const b = readArg(cx)
      push(items, { k: 'w', t: `${wrapped(a)} 除以 ${wrapped(b)}`, c: true })
      attachScripts(cx, items)
      return
    }
    case 'binom':
    case 'dbinom':
    case 'tbinom': {
      const a = readArg(cx)
      const b = readArg(cx)
      push(items, { k: 'w', t: `${wrapped(a)} 取 ${wrapped(b)}`, c: true })
      attachScripts(cx, items)
      return
    }
    case 'sqrt': {
      let index = ''
      if (cx.s[cx.i] === '[') {
        cx.i++
        index = join(parseSeq(cx, ']', false))
        if (cx.s[cx.i] === ']') cx.i++
      }
      const body = readArg(cx)
      const t = index ? `${index} 次方根${spaced(wrapped(body))}` : `根號${spaced(wrapped(body))}`
      push(items, { k: 'w', t, c: true })
      attachScripts(cx, items)
      return
    }
    case 'sum':
    case 'prod':
    case 'int':
    case 'iint':
    case 'iiint':
    case 'oint':
    case 'lim':
    case 'bigcup':
    case 'bigcap': {
      const parts = readScripts(cx)
      const sub = parts.find((p) => p.type === 'sub')
      const sup = parts.find((p) => p.type === 'sup')
      const lo = sub ? join(sub.items) : ''
      const hi = sup ? join(sup.items) : ''
      const noun = BIGOP_NOUN[name]!
      let t: string
      if (name === 'lim') t = lo ? `當 ${lo} 時的極限` : '極限'
      else if (lo && hi) t = `從 ${lo} 到 ${hi} 的${noun}`
      else if (lo) t = name === 'sum' || name === 'prod' ? `對 ${lo} 的${noun}` : `${lo} 上的${noun}`
      else if (hi) t = `到 ${hi} 的${noun}`
      else t = noun
      push(items, { k: 'w', t, c: true })
      return
    }
    case 'to':
    case 'rightarrow':
    case 'longrightarrow': {
      const rest = cx.s.slice(cx.i).trimStart()
      const toLimit = /^(?:\\infty|\\pm\s*\\infty|0(?![\d.]))/.test(rest)
      push(items, { k: 'rel', t: toLimit ? '趨近' : '對應到' })
      return
    }
    case 'begin': {
      const envName = readRaw(cx)
      if (envName === 'array' || envName === 'subarray') readRaw(cx) // 欄位對齊參數
      const w = envWrapper(envName)
      if (w) push(items, { k: 'open', t: w.open })
      return
    }
    case 'end': {
      const envName = readRaw(cx)
      const w = envWrapper(envName)
      if (w) push(items, { k: 'close', t: w.close })
      attachScripts(cx, items)
      return
    }
    case 'vert':
      pushBar(cx, items, st, 'abs')
      return
    case '|':
    case 'Vert':
      pushBar(cx, items, st, 'norm')
      return
    // 有方向的寫法不必配對猜測：`$\lvert$GOS 誤差$\rvert$` 拆在兩段 $…$ 裡也念得對
    case 'lvert':
      push(items, { k: 'open', t: '絕對值（' })
      return
    case 'lVert':
      push(items, { k: 'open', t: '範數（' })
      return
    case 'rvert':
    case 'rVert':
      push(items, { k: 'close', t: '）' })
      attachScripts(cx, items)
      return
    case 'langle':
      push(items, { k: 'open', t: '（' })
      return
    case 'rangle':
      push(items, { k: 'close', t: '）' })
      attachScripts(cx, items)
      return
    case 'lfloor':
      push(items, { k: 'open', t: '向下取整（' })
      return
    case 'lceil':
      push(items, { k: 'open', t: '向上取整（' })
      return
    case 'rfloor':
    case 'rceil':
      push(items, { k: 'close', t: '）' })
      attachScripts(cx, items)
      return
    case 'pmod': {
      const a = readArg(cx)
      push(items, { k: 'w', t: `（mod ${join(a)}）` })
      return
    }
    case 'underbrace':
    case 'overbrace': {
      const a = readArg(cx)
      push(items, { k: 'w', t: join(a), c: a.length > 1, br: true })
      attachScripts(cx, items)
      return
    }
    case 'overset':
    case 'stackrel':
    case 'underset': {
      const a = readArg(cx)
      const b = readArg(cx)
      const only = b.length === 1 ? b[0]! : null
      push(items, { k: only ? only.k : 'w', t: `${join(b)}（${join(a)}）`, c: !only })
      return
    }
    case 'xrightarrow':
    case 'xlongequal':
    case 'xleftarrow':
    case 'xRightarrow':
    case 'xLeftarrow':
    case 'xleftrightarrow':
    case 'xrightleftharpoons':
    case 'xmapsto': {
      if (cx.s[cx.i] === '[') {
        cx.i++
        parseSeq(cx, ']', false)
        if (cx.s[cx.i] === ']') cx.i++
      }
      const label = readArg(cx)
      const word = X_ARROW[name]!
      const lab = join(label)
      push(items, { k: 'rel', t: lab ? `${word}（${lab}）` : word })
      return
    }
    case 'textcolor':
    case 'colorbox':
      readRaw(cx) // 顏色；內容照一般的內容指令處理
      break
    case '#':
      push(items, { k: 'w', t: '數量' })
      return
    case '%':
    case '&':
    case '_':
      push(items, { k: 'w', t: name })
      return
    case '$':
      push(items, { k: 'w', t: '$' })
      return
    default:
  }

  if (TEXT_MODE.has(name)) {
    const raw = readRaw(cx)
    if (raw) push(items, { k: 'w', t: raw })
    attachScripts(cx, items)
    return
  }
  if (WORD_MODE.has(name)) {
    const a = readArg(cx, true)
    const nonEmpty = a.filter((x) => x.t)
    if (nonEmpty.length) push(items, { k: 'w', t: join(a), c: nonEmpty.length > 1 || !!nonEmpty[0]?.c })
    attachScripts(cx, items)
    return
  }
  if (ACCENT[name]) {
    const a = readArg(cx)
    push(items, { k: 'w', t: `${join(a)} ${ACCENT[name]}`, c: a.length > 1 })
    attachScripts(cx, items)
    return
  }
  if (name === 'vec') {
    const a = readArg(cx)
    push(items, { k: 'w', t: `向量 ${join(a)}`, c: a.length > 1 })
    attachScripts(cx, items)
    return
  }
  if (CONTENT_ONLY.has(name)) {
    const a = readArg(cx)
    const nonEmpty = a.filter((x) => x.t)
    if (nonEmpty.length) push(items, { k: 'w', t: join(a), c: nonEmpty.length > 1 || !!nonEmpty[0]?.c })
    attachScripts(cx, items)
    return
  }
  if (DROP_ARG.has(name)) {
    readRaw(cx)
    return
  }
  if (name === 'rm') {
    st.word = true
    return
  }
  if (NO_OUTPUT.has(name)) return

  if (PREFIX[name]) {
    push(items, { k: 'u', t: PREFIX[name]! })
    return
  }
  if (OP[name]) {
    // 前面沒有東西的 \cdot 是「這裡放任何東西」的佔位點（\Phi(\cdot)），不是乘號
    if (name === 'cdot' && isPrefixPosition(items)) push(items, { k: 'w', t: '點' })
    else push(items, { k: 'op', t: OP[name]! })
    return
  }
  if (REL[name]) {
    const base = REL[name]!
    let t = base
    if (notOp) t = name === 'Rightarrow' || name === 'Longrightarrow' || name === 'implies' ? '推不出' : `不${base}`
    push(items, { k: 'rel', t })
    return
  }
  if (WORD[name]) {
    push(items, { k: 'w', t: WORD[name]! })
    attachScripts(cx, items)
    return
  }
  // 不認識的指令：保留指令名稱（\foo → foo），不要輸出反斜線
  if (isLetter(name[0])) {
    push(items, { k: 'w', t: name })
    attachScripts(cx, items)
  }
}

/* ---------- 對外 API ---------- */

function plainFallback(tex: string): string {
  return tex.replace(/\\([A-Za-z]+|.)/g, ' $1 ').replace(/[{}^_$\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

const cache = new Map<string, string>()
const CACHE_MAX = 2000

/**
 * 一段 TeX（不含 `$` 分隔符）→ 可念的文字。永遠回傳字串、不丟例外；輸出不含 `\ { } ^ _ $`。
 *
 * 例：`\sigma_v` → "sigma v"、`|a-w_0|` → "絕對值（a 減 w 0）"、`\mathrm{fs}^{-1}` → "fs 的負 1 次方"、
 * `\frac{1}{z-1}` → "1 除以（z 減 1）"。
 */
export function texToSpeech(tex: string): string {
  const hit = cache.get(tex)
  if (hit !== undefined) return hit
  let out: string
  try {
    const cx: Cx = { s: tex, i: 0, depth: 0, steps: 0, noScripts: 0 }
    const items = parseSeq(cx, 'end', false)
    out = join(items)
      .replace(/(^|[^\d.])0 除以 1(?![\d.])/g, (_, pre: string) => `${pre}0 或 1`) // 0/1 是兩個可能的值，不是除法
      .replace(/\s+/g, ' ')
      .replace(/ +（/g, '（') // 全形括號、分號與前後的詞之間不留空白
      .replace(/） +/g, '）')
      .replace(/； +/g, '；')
      .trim()
    if (/[\\{}^_$]/.test(out)) out = plainFallback(out)
  } catch {
    out = plainFallback(tex)
  }
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(tex, out)
  return out
}

/**
 * 字串中的每個 `$...$` 換成可念形式，其餘原樣保留（`\$` 還原成字面的 `$`）。
 * 給 aria-label / title / aria-valuetext / <option> 用；沒有 `$` 的字串原樣回傳。
 * 例：accessibleText('要走的距離 $|a-w_0|$（D）') → '要走的距離 絕對值（a 減 w 0）（D）'
 */
export function accessibleText(text: string): string {
  if (!text.includes('$')) return text
  let out = ''
  let last = 0
  for (const m of text.matchAll(INLINE_MATH)) {
    const start = m.index ?? 0
    const spoken = texToSpeech(m[1] ?? '')
    const before = text.slice(last, start)
    const after = text[start + m[0].length]
    out += before
    // 西文字母／數字相鄰時補一個空白，避免黏成一個字（Case$\alpha$ → Case alpha）
    if (/[A-Za-z0-9]$/.test(out) && /^[A-Za-z0-9]/.test(spoken)) out += ' '
    out += spoken
    if (after !== undefined && /[A-Za-z0-9]/.test(after) && /[A-Za-z0-9]$/.test(spoken)) out += ' '
    last = start + m[0].length
  }
  out += text.slice(last)
  return out.replace(/\\\$/g, '$')
}
