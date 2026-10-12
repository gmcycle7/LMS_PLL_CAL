import { texNum } from '@/components'

/**
 * Ch07「帶入手算」顯示用的小工具（純函式，不含任何模型公式）。
 *
 * 使用者會打「自己的數字」。固定顯示 5 位有效數字時，畫面上的算式常常和紙筆算出來的對不起來：
 *
 *  1. 輸入被四捨五入：$\Omega=17.35^\circ$、$D=123$ 的 $\Omega D=2134.05^\circ$ 被顯示成 $2134.1^\circ$，後面的加減全部差 0.05°。
 *  2. 相減吃掉有效位數：$-0.41421+0.39775$ 照畫面算是 $-0.01646$，但顯示的結果是 $-0.016466$。
 *  3. 浮點殘渣：$\cos90^\circ=6\times10^{-17}$；反過來，把所有 $<10^{-9}$ 的數當成 0 又會吃掉真正很小的量。
 *  4. 科學記號當底數或接 $^\circ$：`7.0\times10^{-6}^2` 是 KaTeX 的 double superscript 錯誤。
 *
 * 做法：每一步寫成一棵小小的運算樹（Ex）。chain() 把它一層一層算掉（每個等號只做一種運算），
 * 並且**從 5 位起逐步增加運算元的顯示位數，直到「照畫面上的數字算」重現「畫面上的結果」**（相對誤差 ≤ 2×10⁻⁴）。
 * 使用者輸入的數、以及它們相加減乘得到的短小數（9 位以內）完整顯示，不四捨五入；角度永遠寫成小數（不用科學記號）。
 * 答案（results）仍然是模擬函式的回傳值，handcalcs.test.tsx 會把每一步的 TeX 重新求值檢查。
 */

/** 去掉 double 的尾巴（210.70000000000002 → 210.7）。不會把很小但有意義的數變成 0。 */
export const tidy = (v: number): number => (Number.isFinite(v) && v !== 0 ? Number(v.toPrecision(13)) : v === 0 ? 0 : v)

/** 最短十進位表示的有效數字個數：155.378 → 6、1200 → 2、0.5 → 1。 */
export function sigDigits(v: number): number {
  if (!Number.isFinite(v) || v === 0) return 1
  const mant = Math.abs(v).toExponential().split('e')[0]
  return mant.replace('.', '').replace(/0+$/, '').length || 1
}

/** 最短十進位表示的小數位數：155.378 → 3、30 → 0、0.03 → 2。 */
export function dpOf(v: number): number {
  if (!Number.isFinite(v) || v === 0) return 0
  return Math.max(0, sigDigits(v) - 1 - Number(Math.abs(v).toExponential().split('e')[1]))
}

/** 9 位有效數字以內的「短小數」：完整顯示、不四捨五入。 */
export const isShort = (v: number): boolean => sigDigits(v) <= 9

export const roundSig = (v: number, k: number): number => (Number.isFinite(v) && v !== 0 ? Number(v.toPrecision(k)) : v)
export const roundDec = (v: number, d: number): number => {
  const out = Number(v.toFixed(Math.max(0, Math.min(d, 12))))
  return out === 0 ? 0 : out
}

/** 一般小數寫法（不用科學記號），最多 9 位小數、去掉尾端的 0：-0.001225、899830.25。 */
export function plain(v: number): string {
  const s = v.toFixed(Math.min(dpOf(v), 9))
  if (Number(s) === 0) return '0'
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/** 兩個短小數相加減、相乘時，結果落在十進位格點上（0.1 + 0.2 = 0.3、359.924 − 360 = −0.076），不留浮點尾巴。 */
const onGrid = (v: number, dp: number): number => (dp <= 12 ? roundDec(v, dp) : tidy(v))

const turn = (deg: number): number => tidy(((deg % 360) + 360) % 360)
/** cos（角度，度）：90° 的整數倍回傳精確的 0、±1，不留下 6e-17 的殘渣。 */
export function cosDeg(deg: number): number {
  const m = turn(deg)
  if (m === 90 || m === 270) return 0
  if (m === 0 || m === 360) return 1
  if (m === 180) return -1
  return Math.cos((deg * Math.PI) / 180)
}
/** sin（角度，度）：90° 的整數倍回傳精確的 0、±1。 */
export function sinDeg(deg: number): number {
  const m = turn(deg)
  if (m === 0 || m === 180 || m === 360) return 0
  if (m === 90) return 1
  if (m === 270) return -1
  return Math.sin((deg * Math.PI) / 180)
}

/** 把角度折回 (−180°, 180°]（在十進位格點上計算，180° 不會因為浮點誤差變成 −180°）。 */
export function wrapDeg(raw: number): number {
  const dp = dpOf(raw)
  let w = onGrid(raw - 360 * Math.round(raw / 360), dp)
  if (w <= -180) w = onGrid(w + 360, dp)
  else if (w > 180) w = onGrid(w - 360, dp)
  return w === 0 ? 0 : w
}

// ─────────────────────────────────────────────────────────────────────────────
// 運算樹
// ─────────────────────────────────────────────────────────────────────────────

export type Unit = 'deg' | undefined
/** 一個數：exact = 完整顯示（使用者輸入或短小數）；否則四捨五入到 k 位有效數字顯示。 */
export interface Leaf {
  t: 'n'
  v: number
  exact: boolean
  unit: Unit
}
export type Ex = Leaf | { t: 'add' | 'sub' | 'div'; a: Ex; b: Ex } | { t: 'mul'; f: Ex[] } | { t: 'sq' | 'sqrt' | 'cos' | 'sin'; a: Ex }

/** 使用者輸入的數（或精確的常數）：短小數完整顯示。 */
export const given = (v: number, unit?: Unit): Leaf => ({ t: 'n', v: tidy(v), exact: isShort(tidy(v)), unit })
/** 算出來、寫不完的數（商、cos、√、π…）：顯示時四捨五入。 */
export const calc = (v: number, unit?: Unit): Leaf => ({ t: 'n', v, exact: false, unit })
/** 角度（度）：使用者輸入或十進位格點上的結果，永遠照小數完整寫出（最多 9 位小數，不四捨五入到 5 位有效數字）。 */
export const deg = (v: number): Leaf => ({ t: 'n', v: tidy(v), exact: true, unit: 'deg' })
export const add = (a: Ex, b: Ex): Ex => ({ t: 'add', a, b })
export const sub = (a: Ex, b: Ex): Ex => ({ t: 'sub', a, b })
export const mul = (...f: Ex[]): Ex => ({ t: 'mul', f })
export const div = (a: Ex, b: Ex): Ex => ({ t: 'div', a, b })
export const sq = (a: Ex): Ex => ({ t: 'sq', a })
export const sqrt = (a: Ex): Ex => ({ t: 'sqrt', a })
/** cos／sin 的引數是「度」。 */
export const cosd = (a: Ex): Ex => ({ t: 'cos', a })
export const sind = (a: Ex): Ex => ({ t: 'sin', a })

type Round = (x: number) => number
/** 運算元的四捨五入；inSum = 這個數在加減號底下（相減會吃掉有效位數，需要時多留幾位的就是它們）。 */
type LeafRound = (x: number, inSum: boolean) => number
const same: LeafRound = (x) => x

/** 求值；rd 套用在「寫不完」的數上（模擬照畫面上四捨五入後的數字計算）。完全抵銷的加減回傳精確的 0。 */
export function evalEx(e: Ex, rd: LeafRound = same, inSum = false): number {
  switch (e.t) {
    case 'n':
      return e.exact ? e.v : rd(e.v, inSum)
    case 'add':
    case 'sub': {
      const a = evalEx(e.a, rd, true)
      const b = evalEx(e.b, rd, true)
      const s = e.t === 'add' ? a + b : a - b
      return Math.abs(s) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b)) ? 0 : onGrid(s, Math.max(dpOf(a), dpOf(b)))
    }
    case 'mul': {
      const fs = e.f.map((x) => evalEx(x, rd, inSum))
      return onGrid(
        fs.reduce((p, x) => p * x, 1),
        fs.reduce((d, x) => d + dpOf(x), 0),
      )
    }
    case 'div':
      return tidy(evalEx(e.a, rd, inSum) / evalEx(e.b, rd, inSum))
    case 'sq': {
      const a = evalEx(e.a, rd, inSum)
      return onGrid(a * a, 2 * dpOf(a))
    }
    case 'sqrt':
      return Math.sqrt(evalEx(e.a, rd, inSum))
    case 'cos':
      return cosDeg(evalEx(e.a, rd, inSum))
    case 'sin':
      return sinDeg(evalEx(e.a, rd, inSum))
  }
}

/** 算式裡有沒有加減法。 */
function hasSum(e: Ex): boolean {
  return e.t === 'add' || e.t === 'sub' || kids(e).some(hasSum)
}

function unitOf(e: Ex): Unit {
  switch (e.t) {
    case 'n':
      return e.unit
    case 'add':
    case 'sub':
      return unitOf(e.a) ?? unitOf(e.b)
    case 'mul':
      return e.f.some((x) => unitOf(x) === 'deg') ? 'deg' : undefined
    case 'div':
      return unitOf(e.a) === 'deg' && unitOf(e.b) !== 'deg' ? 'deg' : undefined
    default:
      return undefined
  }
}

const kids = (e: Ex): Ex[] => (e.t === 'n' ? [] : e.t === 'mul' ? e.f : e.t === 'add' || e.t === 'sub' || e.t === 'div' ? [e.a, e.b] : [e.a])

/** 把最內層的運算（子節點全是數字的節點）各算掉一次：對應畫面上的一個等號。 */
function collapseOnce(e: Ex): Ex {
  if (e.t === 'n') return e
  const ks = kids(e)
  if (ks.every((k) => k.t === 'n')) {
    const v = evalEx(e)
    const arithmetic = e.t === 'add' || e.t === 'sub' || e.t === 'mul' || e.t === 'sq' || e.t === 'div'
    return { t: 'n', v, exact: arithmetic && ks.every((k) => k.t === 'n' && k.exact) && isShort(v), unit: unitOf(e) }
  }
  switch (e.t) {
    case 'mul':
      return { t: 'mul', f: e.f.map(collapseOnce) }
    case 'add':
    case 'sub':
    case 'div':
      return { t: e.t, a: collapseOnce(e.a), b: collapseOnce(e.b) }
    default:
      return { t: e.t, a: collapseOnce(e.a) }
  }
}

/** top：算式開頭；term：加減號右邊（負數加括號）；factor：乘數（負數、科學記號加括號）；base：平方的底數。 */
type Role = 'top' | 'term' | 'factor' | 'base'

/** 角度的 TeX（度）；科學記號時加括號，避免 `10^{-5}^\circ` 的 double superscript。 */
export function degTex(body: string): string {
  return body.includes('^') ? `(${body})^\\circ` : `${body}^\\circ`
}
/** 精確的角度（十進位小數，不用科學記號）。 */
export const degT = (v: number): string => `${plain(tidy(v))}^\\circ`

function leafTex(e: Leaf, k: number, role: Role): string {
  const body = e.exact ? (e.unit === 'deg' ? plain(e.v) : texNum(e.v, 9)) : texNum(e.v, k)
  const s = e.unit === 'deg' ? degTex(body) : body
  const neg = body.startsWith('-')
  const sci = body.includes('\\times')
  if (role === 'term' && neg) return `(${s})`
  if (role === 'factor' && (neg || sci)) return `(${s})`
  if (role === 'base' && (neg || sci || body.includes('^'))) return `(${s})`
  return s
}

/** 這個數顯示幾位有效數字（inSum：在加減號底下） */
type Digits = (inSum: boolean) => number

function texEx(e: Ex, k: Digits, role: Role = 'top', inSum = false): string {
  switch (e.t) {
    case 'n':
      return leafTex(e, k(inSum), role)
    case 'add':
    case 'sub': {
      const s = `${texEx(e.a, k, 'top', true)} ${e.t === 'add' ? '+' : '-'} ${texEx(e.b, k, 'term', true)}`
      return role === 'top' ? s : `\\big(${s}\\big)`
    }
    case 'mul': {
      const s = e.f.map((x) => texEx(x, k, 'factor', inSum)).join('\\times')
      return role === 'base' ? `\\big(${s}\\big)` : s
    }
    case 'div':
      return `\\frac{${texEx(e.a, k, 'top', inSum)}}{${texEx(e.b, k, 'top', inSum)}}`
    case 'sq':
      return `${texEx(e.a, k, 'base', inSum)}^2`
    case 'sqrt':
      return `\\sqrt{${texEx(e.a, k, 'top', inSum)}}`
    case 'cos':
    case 'sin':
      return `\\${e.t}\\big(${texEx(e.a, k, 'top', inSum)}\\big)`
  }
}

/** 「照畫面上的數字算」與「畫面上的結果」的容許相對誤差（測試用 2.5×10⁻⁴，這裡留一點餘裕）。 */
export const SHOWN_TOL = 2e-4
/** 運算元最多顯示幾位有效數字（再多就不像手算了）。 */
export const MAX_SIG = 8

export interface ChainOpt {
  /** 模擬函式算出的值（省略時用算式本身的值）。算式精確地算出 0 時一律當成 0（不留浮點殘渣）。 */
  target?: number
  /** 結果顯示時的四捨五入（預設 5 位有效數字；精確的短小數完整顯示）。 */
  round?: Round
  /** 運算元至少顯示幾位有效數字（預設 5）。 */
  from?: number
  /** 改用絕對容許誤差（例如角度的最後一位小數）。 */
  absTol?: number
  /** 接在結果後面的單位（TeX）。 */
  suffix?: string
}
export interface ChainOut {
  /** 「左式 = 代入數字 =（中間結果 =）結果」 */
  tex: string
  /** 這一步的結果，交給後面的步驟當運算元 */
  leaf: Leaf
  /** 結果的數值（target，或算式本身的值） */
  value: number
  /** 畫面上顯示的結果（四捨五入後） */
  shown: number
  /** 運算元比平常多顯示了幾位（兩個接近的數相減、或後面還要相減） */
  extended: boolean
}

/**
 * 一步手算：lhs = 代入數字 =（逐層算掉的中間結果 =）結果。
 * 每一段的運算元從 from 位有效數字起逐步增加，直到照畫面上的數字算出來與顯示的結果一致。
 */
export function chain(lhs: string, e: Ex, opt: ChainOpt = {}): ChainOut {
  const from = opt.from ?? 5
  const own = evalEx(e)
  const value = own === 0 ? 0 : tidy(opt.target ?? own)
  let last: Ex = e
  while (last.t !== 'n') last = collapseOnce(last)
  const exact = last.exact && opt.round === undefined
  const shown = exact ? last.v : (opt.round ?? ((v: number) => roundSig(v, 5)))(value)
  const ok = (got: number): boolean =>
    opt.absTol !== undefined ? Math.abs(got - shown) <= opt.absTol : Math.abs(got - shown) <= SHOWN_TOL * Math.max(Math.abs(got), Math.abs(shown))
  const segs: string[] = []
  let extended = false
  for (let cur: Ex = e; cur.t !== 'n'; cur = collapseOnce(cur)) {
    // 有加減法的算式：只有加減號底下的數需要多留幾位（其餘維持 from 位）；純乘除的算式則全部一起加
    const sens = hasSum(cur)
    let k = from
    const digits: Digits = (inSum) => (sens && !inSum ? from : k)
    while (k < MAX_SIG && !ok(evalEx(cur, (x, inSum) => roundSig(x, digits(inSum))))) k++
    if (k > from) extended = true
    segs.push(texEx(cur, digits))
  }
  const unit = unitOf(e)
  const body = unit === 'deg' && (shown === 0 || Math.abs(shown) >= 1e-6) ? plain(shown) : texNum(shown, 12)
  const final = (unit === 'deg' ? degTex(body) : body) + (opt.suffix ?? '')
  return {
    tex: [lhs, ...segs, final].filter((s) => s !== '').join(' = '),
    leaf: exact ? last : { t: 'n', v: value, exact: false, unit },
    value,
    shown,
    extended,
  }
}

/** 在最外層（不在大括號裡）的等號處切開；回傳各段（已去掉頭尾空白）。 */
function splitTopLevelEq(tex: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of tex) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
    if (ch === '=' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

/**
 * 把很長的一步排成對齊的幾行（桌機的內文欄約 850 px，一整行放不下時才用）：算式的內容與順序完全不變，只多了換行。
 * 所有行對齊第一個等號；before 是「要在它前面換行」的等號序號（最外層的等號由 1 起算；第 1 個是對齊點，不會在它前面換行）。
 * 例：`a = b = c = d` 配 before = [2] ⇒ 第一行 `a = b`，第二行 `= c = d`。等號不夠多時，多出來的序號略過。
 */
export function breakChain<T extends { tex: string }>(c: T, before: number[]): T {
  const segs = splitTopLevelEq(c.tex)
  const cuts = new Set(before.filter((i) => i >= 2 && i < segs.length))
  if (!cuts.size) return c
  let body = `${segs[0]} &= ${segs[1]}`
  for (let i = 2; i < segs.length; i++) body += cuts.has(i) ? ` \\\\ &= ${segs[i]}` : ` = ${segs[i]}`
  return { ...c, tex: `\\begin{aligned}${body}\\end{aligned}` }
}

/**
 * 把 raw（度）折回 (−180°, 180°] 的那一段 TeX：不必折返時只有 θ；否則寫出
 * 「raw − 360° = θ」或「raw − k×360° = raw − (360k)° = θ」。
 */
export function wrapTex(raw: number, theta: number): { tex: string; wrapped: boolean } {
  const turns = Math.round((raw - theta) / 360)
  if (turns === 0) return { tex: degT(theta), wrapped: false }
  const op = turns > 0 ? '-' : '+'
  const k = Math.abs(turns)
  const head = `${degT(raw)} ${op} ${k === 1 ? '' : `${k}\\times`}360^\\circ`
  const mid = k === 1 ? '' : ` = ${degT(raw)} ${op} ${k * 360}^\\circ`
  return { tex: `${head}${mid} = ${degT(theta)}`, wrapped: true }
}
