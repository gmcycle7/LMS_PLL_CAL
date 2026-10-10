/**
 * 驗證頁的數字格式化與 Python 原始碼切片（純函式）。
 */
import type { Numeric, Tol } from '@/simulation/models/acceptance'

/** 以有效位數顯示；整數原樣；極大或極小值用指數；−0 顯示為 0 */
export function fmtNum(x: number, digits = 6): string {
  if (Number.isNaN(x)) return 'NaN'
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞'
  if (Object.is(x, -0) || x === 0) return '0'
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return x.toString()
  const ax = Math.abs(x)
  if (ax >= 1e6 || ax < 1e-4) {
    const [m, e] = x.toExponential(Math.max(0, digits - 1)).split('e')
    return `${trimZeros(m)}e${Number(e)}`
  }
  // toPrecision 在「整數位數 > digits」時會自己改用指數記號（251300.4 → '2.51e+5'）；
  // 這個區間（1e−4 ≤ |x| < 1e6）一律寫成一般小數：先四捨五入到 digits 位有效數字，再轉回十進位字串
  const s = x.toPrecision(digits)
  return s.includes('e') ? Number(s).toString() : trimZeros(s)
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/** 完整精度（17 位有效數字，可分辨 2.28 與 2.2800000000000002） */
export function fmtFull(x: number): string {
  if (!Number.isFinite(x)) return fmtNum(x)
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return x.toString()
  return String(x)
}

/** Numeric（number 或巢狀陣列）轉文字 */
export function fmtNumeric(v: Numeric | null | undefined, digits = 6, maxItems = 12): string {
  if (v === null || v === undefined) return '—'
  if (!Array.isArray(v)) return fmtNum(v, digits)
  const items = v.slice(0, maxItems).map((x) => fmtNumeric(x, digits, maxItems))
  return `[${items.join(', ')}${v.length > maxItems ? ', …' : ''}]`
}

/** 從 Numeric 取第 index 個元素（index 省略時原樣） */
export function pick(v: Numeric | null | undefined, index?: number): Numeric | null {
  if (v === null || v === undefined) return null
  if (index === undefined) return v
  return Array.isArray(v) ? (v[index] ?? null) : null
}

/** 容忍度的文字（abs / rel；兩者皆 0 時為「完全相等」） */
export function fmtTol(t: Tol): string {
  const parts: string[] = []
  if (t.abs !== undefined && t.abs !== 0) parts.push(`abs ${fmtNum(t.abs, 2)}`)
  if (t.rel !== undefined && t.rel !== 0) parts.push(`rel ${fmtNum(t.rel, 2)}`)
  if (parts.length === 0) return '完全相等'
  return parts.join(' + ')
}

/** |Δ|/bound 的顯示（≤ 1 通過） */
export function fmtRatio(r: number | undefined | null): string {
  if (r === undefined || r === null) return '—'
  if (r === 0) return '0'
  if (!Number.isFinite(r)) return '∞'
  return fmtNum(r, 3)
}

/**
 * 從 Python 原始碼切出指定的頂層 def（含 docstring），依給定順序串接。
 * golden/ 的 Python 沒有 `# region core:` 標記；這裡切的仍是實際的原始檔內容，不是另外手寫的示意版。
 */
export function extractPythonDefs(source: string, names: string[]): string {
  const lines = source.split('\n')
  const out: string[] = []
  for (const name of names) {
    const start = lines.findIndex((l) => l.startsWith(`def ${name}(`))
    if (start < 0) throw new Error(`Python 原始碼找不到 def ${name}`)
    let end = start + 1
    while (end < lines.length) {
      const l = lines[end]
      if (l.length > 0 && !/^\s/.test(l)) break // 下一個頂層敘述
      end++
    }
    while (end > start + 1 && lines[end - 1].trim() === '') end--
    if (out.length) out.push('')
    out.push(...lines.slice(start, end))
  }
  return out.join('\n')
}

/**
 * 從 JavaScript 原始碼切出指定的頂層 function（連同緊接在上方的 JSDoc 註解），依給定順序串接。
 * 用於顯示 scripts/verify.mjs 的實際內容（該檔不在 src/ 內，也沒有 region 標記）。
 */
export function extractJsFunctions(source: string, names: string[]): string {
  const lines = source.split('\n')
  const out: string[] = []
  for (const name of names) {
    const start = lines.findIndex((l) => l.startsWith(`function ${name}(`))
    if (start < 0) throw new Error(`JavaScript 原始碼找不到 function ${name}`)
    let end = start
    while (end < lines.length && lines[end] !== '}') end++ // 頂層函式以第 0 欄的 } 結束
    if (end >= lines.length) throw new Error(`function ${name} 沒有結束的 }`)
    let first = start
    if (first > 0 && lines[first - 1].trimEnd().endsWith('*/')) {
      first--
      while (first > 0 && !lines[first].trimStart().startsWith('/**')) first--
    }
    if (out.length) out.push('')
    out.push(...lines.slice(first, end + 1))
  }
  return out.join('\n')
}

/** 從 JavaScript 原始碼切出指定的頂層「單行」const 宣告（原樣，依給定順序）；找不到時丟錯。 */
export function extractJsConstLines(source: string, names: string[]): string {
  const lines = source.split('\n')
  return names
    .map((name) => {
      const line = lines.find((l) => l.startsWith(`const ${name} =`))
      if (line === undefined) throw new Error(`JavaScript 原始碼找不到 const ${name}`)
      return line
    })
    .join('\n')
}

/** 把 double 拆成精確的 sign·m·2^e（m、e 為整數；BigInt） */
export function decomposeDouble(x: number): { m: bigint; e: number } {
  if (!Number.isFinite(x)) throw new Error('decomposeDouble：需要有限數')
  const dv = new DataView(new ArrayBuffer(8))
  dv.setFloat64(0, x)
  const bits = dv.getBigUint64(0)
  const neg = bits >> 63n === 1n
  const expBits = Number((bits >> 52n) & 0x7ffn)
  const frac = bits & ((1n << 52n) - 1n)
  const m = expBits === 0 ? frac : frac | (1n << 52n)
  const e = expBits === 0 ? -1074 : expBits - 1075
  return { m: neg ? -m : m, e }
}

/** |x − num/den| 的精確值（先以整數算出有理數差，最後才轉成 double） */
export function exactDiffToFraction(x: number, num: bigint, den: bigint): number {
  if (den <= 0n) throw new Error('den 必須為正')
  const { m, e } = decomposeDouble(x)
  if (e >= 0) {
    const d = m * den * (1n << BigInt(e)) - num
    return Number(d < 0n ? -d : d) / Number(den)
  }
  const scale = 1n << BigInt(-e)
  const d = m * den - num * scale // (x − num/den)·den·2^{−e}
  const ad = d < 0n ? -d : d
  return Number(ad) / Number(den) / Number(scale)
}

/** TeX 版數字：科學記號寫成 a\times10^{b}（a = 1 時只寫 10^{b}） */
export function texNum(x: number, digits = 4): string {
  if (Number.isNaN(x)) return '\\mathrm{NaN}'
  let s = fmtNum(x, digits)
  if (Number.isInteger(x) && Math.abs(x) >= 1e7) {
    // 很大的整數（例如 |Δ|/b = 6×10¹⁰）改用科學記號；fmtNum 會把整數原樣印出
    const [mant, exp] = x.toExponential(Math.max(0, digits - 1)).split('e')
    s = `${trimZeros(mant)}e${Number(exp)}`
  }
  const m = /^(-?[\d.]+)e(-?\d+)$/.exec(s)
  if (m) return m[1] === '1' ? `10^{${m[2]}}` : m[1] === '-1' ? `-10^{${m[2]}}` : `${m[1]}\\times10^{${m[2]}}`
  return s.replace('−∞', '-\\infty').replace('∞', '\\infty')
}

/** r = |Δ|/b 的 TeX（≤ 1 通過；容忍度為 0 而有誤差時為 ∞） */
export function ratioTex(r: number | undefined | null): string {
  if (r === undefined || r === null) return '\\text{—}'
  if (r === 0) return '0'
  if (!Number.isFinite(r)) return '\\infty'
  return texNum(r, 3)
}

/** 容忍度的 TeX：ε_abs = …、ε_rel = …；兩者皆 0 時為「完全相等」（a = e） */
export function tolTex(t: Tol): string {
  const parts: string[] = []
  if (t.abs !== undefined && t.abs !== 0) parts.push(`\\varepsilon_{\\rm abs}=${texNum(t.abs, 2)}`)
  if (t.rel !== undefined && t.rel !== 0) parts.push(`\\varepsilon_{\\rm rel}=${texNum(t.rel, 2)}`)
  return parts.length ? parts.join(',\\ ') : 'a_k=e_k'
}

const TEX_SYMBOLS: [RegExp, string][] = [
  // 先處理帶大括號的結構
  [/\\operatorname\{([^}]*)\}/g, '$1'],
  [/\\(?:mathrm|mathbf|mathcal|boldsymbol|text)\{([^}]*)\}/g, '$1'],
  [/\\hat\{([^}]*)\}/g, '$1̂'],
  [/\\bar\{([^}]*)\}/g, '$1̄'],
  [/\\t?frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)'],
  [/\\tfrac(\d)(\d)/g, '$1/$2'],
  [/\\sqrt\{([^}]*)\}/g, '√($1)'],
  [/\\sqrt\s*([A-Za-z0-9])/g, '√$1'],
  // 字型切換（不帶大括號的寫法）與排版指令
  [/\\(?:mathrm|mathbf|mathcal|boldsymbol|rm|left|right|big|Big|bigg|displaystyle)\b\s*/g, ''],
  // 希臘字母
  [/\\varepsilon/g, 'ε'],
  [/\\varphi/g, 'φ'],
  [/\\sigma/g, 'σ'],
  [/\\alpha/g, 'α'],
  [/\\beta/g, 'β'],
  [/\\gamma/g, 'γ'],
  [/\\delta/g, 'δ'],
  [/\\Delta/g, 'Δ'],
  [/\\lambda/g, 'λ'],
  [/\\theta/g, 'θ'],
  [/\\kappa/g, 'κ'],
  [/\\Omega/g, 'Ω'],
  [/\\omega/g, 'ω'],
  [/\\Phi/g, 'Φ'],
  [/\\phi/g, 'φ'],
  [/\\rho/g, 'ρ'],
  [/\\chi/g, 'χ'],
  [/\\eta/g, 'η'],
  [/\\mu/g, 'μ'],
  [/\\nu/g, 'ν'],
  [/\\pi/g, 'π'],
  // 不帶大括號的 \hat x、\bar x（放在希臘字母之後：\hat\sigma → σ̂）
  [/\\hat\s*(\S)/gu, '$1̂'],
  [/\\bar\s*(\S)/gu, '$1̄'],
  // 關係與運算符號
  [/\\infty/g, '∞'],
  [/\\Rightarrow/g, '⇒'],
  [/\\Leftrightarrow|\\iff/g, '⇔'],
  [/\\equiv/g, '≡'],
  [/\\approx/g, '≈'],
  [/\\propto/g, '∝'],
  [/\\leq?(?![A-Za-z])/g, '≤'],
  [/\\geq?(?![A-Za-z])/g, '≥'],
  [/\\neq?(?![A-Za-z])/g, '≠'],
  [/\\ll(?![A-Za-z])/g, '≪'],
  [/\\gg(?![A-Za-z])/g, '≫'],
  [/\\in(?![A-Za-z])/g, '∈'],
  [/\\to(?![A-Za-z])/g, '→'],
  [/\\cdot/g, '·'],
  [/\\times/g, '×'],
  [/\\pm/g, '±'],
  [/\\sum/g, 'Σ'],
  [/\\langle/g, '⟨'],
  [/\\rangle/g, '⟩'],
  [/\\ldots|\\cdots/g, '…'],
  [/\\bmod/g, ' mod '],
  [/\\lceil|\\rceil|\\lfloor|\\rfloor/g, ''],
  [/\\\|/g, '‖'],
  [/\\[{}]/g, ''],
  [/\\[,;:! ]/g, ' '],
  [/\^\{\\circ\}|\^\\circ/g, '°'],
  [/\\circ/g, '°'],
  [/\\%/g, '%'],
  // 其餘指令（\ln、\log、\gcd、\max、\min、\arcsin…）：拿掉反斜線
  [/\\([A-Za-z]+)/g, '$1'],
  [/[{}]/g, ''],
  [/ {2,}/g, ' '],
]

/** 把 `$…$` 標記的行內 TeX 粗略轉成純文字（只用於只接受字串的 props：警告、select 選項、Plotly hover） */
export function texToPlain(text: string): string {
  return text
    .split('$')
    .map((part, i) => {
      if (i % 2 === 0) return part
      let s = part
      for (const [re, rep] of TEX_SYMBOLS) s = s.replace(re, rep)
      return s.normalize('NFC') // 組合用的 ̂ / ̄ 盡量合成單一字元（Ĵ、ā…）
    })
    .join('')
}
