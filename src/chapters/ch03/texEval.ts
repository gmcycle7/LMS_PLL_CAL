/**
 * 測試用：把「帶入手算」每一步的 TeX 重新求值，確認畫面上的數字自己就算得出下一個等號。
 * 這是一個很小的算術解析器（遞迴下降），只認得手算題會出現的語法：
 *   數字、a\times10^{b}、+ − \times /、\frac{}{}、\tfrac12、^{n}、\sqrt{}、\ln、e^{}、\Phi()、\lceil \rceil、括號。
 * 不含任何模型公式；Φ 由呼叫端傳入（測試用獨立的實作）。
 */

/** 在最外層（不在 {} 裡）以 sep 切開 */
export function splitTop(s: string, sep = '='): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const c of s) {
    if (c === '{') depth++
    else if (c === '}') depth--
    if (c === sep && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

/** 去掉單位與排版用的間距指令 */
function clean(seg: string): string {
  let s = seg.replace(/\\ \\text\{[^}]*\}/g, '').replace(/\\approx/g, '')
  for (const k of ['\\Big', '\\big', '\\left', '\\right', '\\,', '\\;', '\\!', '\\qquad', '\\quad']) s = s.split(k).join('')
  return s.split('\\ ').join(' ').trim()
}

const KNOWN = ['\\times', '\\frac', '\\tfrac', '\\dfrac', '\\sqrt', '\\ln', '\\Phi', '\\lceil', '\\rceil', '\\exp']

/** 這一段是否還含有符號（字母、絕對值）：是的話不求值 */
export function isSymbolic(seg: string): boolean {
  let s = clean(seg).split('e^{').join('\\exp{')
  for (const k of KNOWN) s = s.split(k).join('')
  return /[A-Za-z\\|]/.test(s)
}

/**
 * 一段 TeX 的最後一個數字若是一般小數（不是 a\times10^{b}），回傳它最後一位的「半個單位」；否則回傳 0。
 * 科學記號只用相對誤差判斷：10^{-6} 的「最後一位」是 1e−6 本身，不能當成容許量。
 */
export function lastDigitHalfUnit(seg: string): number {
  const s = clean(seg)
  if (/10\^\{-?\d+\}\)?$/.test(s)) return 0
  const m = /-?\d+(?:\.(\d+))?\)?$/.exec(s)
  if (!m) return 0
  return 0.5 * 10 ** -(m[1] ? m[1].length : 0)
}

class Parser {
  private s: string
  private i = 0
  constructor(
    src: string,
    private phi: (z: number) => number,
  ) {
    this.s = clean(src).split('e^{').join('\\exp{')
  }

  private ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++
  }
  private peek(): string {
    this.ws()
    return this.i < this.s.length ? this.s[this.i] : ''
  }
  private at(t: string): boolean {
    this.ws()
    return this.s.startsWith(t, this.i)
  }
  private eat(t: string) {
    if (!this.at(t)) throw new Error(`texEval：位置 ${this.i} 應為 ${t}：${this.s}`)
    this.i += t.length
  }

  parse(): number {
    const v = this.expr()
    this.ws()
    if (this.i !== this.s.length) throw new Error(`texEval：多出 ${this.s.slice(this.i)}：${this.s}`)
    return v
  }

  private expr(): number {
    let v = this.term()
    for (;;) {
      const c = this.peek()
      if (c === '+') {
        this.i++
        v += this.term()
      } else if (c === '-') {
        this.i++
        v -= this.term()
      } else return v
    }
  }

  private term(): number {
    let v = this.unary()
    for (;;) {
      if (this.at('\\times')) {
        this.eat('\\times')
        v *= this.unary()
      } else if (this.at('/')) {
        this.eat('/')
        v /= this.unary()
      } else return v
    }
  }

  private unary(): number {
    if (this.peek() === '-') {
      this.i++
      return -this.unary()
    }
    return this.power()
  }

  /** {…} 或單一數字（\tfrac12、^2） */
  private arg(): number {
    if (this.peek() === '{') {
      this.eat('{')
      const v = this.expr()
      this.eat('}')
      return v
    }
    const c = this.peek()
    if (!/\d/.test(c)) throw new Error(`texEval：位置 ${this.i} 應為數字：${this.s}`)
    this.i++
    return Number(c)
  }

  private power(): number {
    let base = this.atom()
    let sup = 0
    while (this.peek() === '^') {
      if (++sup > 1) throw new Error(`texEval：double superscript：${this.s}`)
      this.i++
      base = base ** this.arg()
    }
    return base
  }

  private atom(): number {
    const c = this.peek()
    if (c === '(') {
      this.eat('(')
      const v = this.expr()
      this.eat(')')
      return v
    }
    if (c === '{') {
      this.eat('{')
      const v = this.expr()
      this.eat('}')
      return v
    }
    for (const f of ['\\frac', '\\tfrac', '\\dfrac']) {
      if (this.at(f)) {
        this.eat(f)
        const a = this.arg()
        const b = this.arg()
        return a / b
      }
    }
    if (this.at('\\sqrt')) {
      this.eat('\\sqrt')
      return Math.sqrt(this.arg())
    }
    if (this.at('\\exp')) {
      this.eat('\\exp')
      return Math.exp(this.arg())
    }
    if (this.at('\\ln')) {
      this.eat('\\ln')
      return Math.log(this.power())
    }
    if (this.at('\\Phi')) {
      this.eat('\\Phi')
      this.eat('(')
      const v = this.expr()
      this.eat(')')
      return this.phi(v)
    }
    if (this.at('\\lceil')) {
      this.eat('\\lceil')
      const v = this.expr()
      this.eat('\\rceil')
      return Math.ceil(v)
    }
    this.ws()
    const m = /^\d+(\.\d+)?/.exec(this.s.slice(this.i))
    if (!m) throw new Error(`texEval：位置 ${this.i} 應為數字：${this.s}`)
    this.i += m[0].length
    return Number(m[0])
  }
}

/** 求一段數字算式的值（含符號時丟出錯誤） */
export function evalTex(seg: string, phi: (z: number) => number = () => Number.NaN): number {
  return new Parser(seg, phi).parse()
}

export interface ChainLink {
  from: string
  to: string
  a: number
  b: number
  /** |a − b| 是否在容許範圍內：相對 1e−4（5 位有效數字的四捨五入），或 to 最後一位的 1 個單位（上限 1e−4：查表用的小數 4 位） */
  ok: boolean
}

/**
 * 把一步的 TeX 依最外層的等號切開，對「只有數字」的各段求值，回傳相鄰兩段的比較。
 * x_i^2:\quad a^2,\ b^2\;=\;c,\ d 這種逐項列表則逐項比較。
 */
export function chainLinks(tex: string, phi: (z: number) => number): { values: number[]; links: ChainLink[] } {
  const judge = (from: string, to: string, a: number, b: number): ChainLink => {
    // 「0.6 寫成 0.7」不可因為只顯示 1 位小數就放行：最後一位的容許量以 1e−4 為上限
    const tol = Math.max(1e-4 * Math.max(Math.abs(a), Math.abs(b)), Math.min(2 * lastDigitHalfUnit(to), 1e-4), 1e-300)
    return { from: from.trim(), to: to.trim(), a, b, ok: Math.abs(a - b) <= tol }
  }
  if (tex.includes(':\\quad')) {
    const body = tex.split(':\\quad')[1]
    const [lhs, rhs] = body.split('\\;=\\;')
    const L = lhs.split(',\\ ')
    const Rr = rhs.split(',\\ ')
    if (L.length !== Rr.length) throw new Error(`texEval：列表長度不同：${tex}`)
    const links = L.map((l, i) => judge(l, Rr[i], evalTex(l, phi), evalTex(Rr[i], phi)))
    return { values: links.map((l) => l.b), links }
  }
  const segs = splitTop(tex).filter((s) => !isSymbolic(s))
  const vals = segs.map((s) => evalTex(s, phi))
  const links: ChainLink[] = []
  for (let i = 0; i + 1 < segs.length; i++) links.push(judge(segs[i], segs[i + 1], vals[i], vals[i + 1]))
  return { values: vals, links }
}
