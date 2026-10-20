/**
 * Gallery 的純函式：數字 → TeX、從 preset 的「預期結果」文字抽出數字、比對容差。
 * 不 import React，可在 node 測試中直接使用。
 */
import { texNum as sharedTexNum } from '@/components/handcalcMath'

/** 去掉 toPrecision 結果的多餘 0（'1.8000' → '1.8'、'2.000e-5' → '2e-5'） */
function stripZeros(s: string): string {
  if (!s.includes('.')) return s
  const [mant, exp] = s.split('e')
  const m = mant.replace(/0+$/, '').replace(/\.$/, '')
  return exp === undefined ? m : `${m}e${exp}`
}

/**
 * 數字 → 純文字（ASCII 減號；|x| ≥ 1e6 或 < 1e-4 時用科學記號）。
 * sig = 有效位數。
 */
export function plainNum(x: number, sig = 6): string {
  if (Number.isNaN(x)) return 'NaN'
  if (x === Infinity) return '∞'
  if (x === -Infinity) return '-∞'
  if (x === 0) return '0'
  const ax = Math.abs(x)
  if (ax >= 1e6 || ax < 1e-4) {
    const [m, e] = x.toExponential(Math.max(0, sig - 1)).split('e')
    return `${stripZeros(m)}e${Number(e)}`
  }
  // 整數部分位數超過 sig 時保留整數（避免 42499 → 4.25e4）
  if (Number.isInteger(x)) return String(x)
  return stripZeros(x.toPrecision(sig))
}

/**
 * 數字 → TeX（預設 6 位有效數字）：規則由共用的 `texNum`（components/handcalcMath.ts）決定——
 * 科學記號寫成 a\times10^{b}（|x| ≥ 1e6 或 < 1e-4）；NaN/∞ 用 \text / \infty。用在 <Tex> 內，所以所有數學都經過 KaTeX。
 * 純文字的 plainNum 仍保留「整數位數超過 sig 時保留整數」的規則（extractNumbers 對照預期文字用）。
 */
export function texNum(x: number, sig = 6): string {
  return sharedTexNum(x, sig)
}

/**
 * 數字的最短可還原表示（JavaScript 的 String(x)）→ TeX：顯示「電腦實際算出的值」而不另外捨入，
 * 例如 2.2800000000000002（而不是 2.28），0.6 就是 0.6。
 */
export function texRepr(x: number): string {
  if (!Number.isFinite(x)) return texNum(x)
  const s = String(x)
  const m = /^(-?[\d.]+)e([-+]?\d+)$/.exec(s)
  return m ? `${m[1]}\\times10^{${Number(m[2])}}` : s
}

/**
 * 顯示一個「與文字數字相符」的重算值時需要的有效位數：至少比文字多一位，才看得出兩者差在哪裡（上限 12）。
 */
export function sigForMatch(value: number, tol: number, base = 6): number {
  if (!(tol > 0) || value === 0 || !Number.isFinite(value)) return base
  return Math.min(12, Math.max(base, Math.ceil(Math.log10(Math.abs(value) / tol)) + 1))
}

/** 負數加括號（代入公式時避免「×−3」） */
export function texArg(x: number, sig = 6): string {
  return x < 0 ? `(${texNum(x, sig)})` : texNum(x, sig)
}

/**
 * 預期文字中的原始數字片段（extractNumbers 的 raw，例如 '4.0841×10^-5'、'78.75%'、'42,499'）→ TeX，
 * 保留原本寫出的位數（'0.5000' 不會變成 0.5）。
 */
export function rawToTex(raw: string): string {
  return raw
    .replace(/\s*[×*]\s*10\^?([-+]?\d+)/, '\\times10^{$1}')
    .replace(/(?<=\d)e([-+]?\d+)/, '\\times10^{$1}')
    .replace(/,/g, '{,}')
    .replace(/\s*%/, '\\%')
}

/** 文字數字寫到小數第幾位（由捨入半寬反推；科學記號時相對於 10^e） */
export function decimalsOf(n: Pick<ExtractedNumber, 'tol'>): number {
  return Math.round(-Math.log10(2 * n.tol))
}

/** 由預期文字抽出的一個數字 */
export interface ExtractedNumber {
  /** 文字中的原始片段 */
  raw: string
  value: number
  /** 依文字的小數位數決定的捨入半寬：½·10^{−decimals}（科學記號再乘 10^exp） */
  tol: number
}

const SUPERSCRIPT: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁻': '-',
  '⁺': '+',
}

/** 把 Unicode 減號、上標指數正規化成 ASCII（10⁻⁴ → 10^-4） */
export function normalizeNumberText(text: string): string {
  let out = text.replace(/[−–]/g, '-').replace(/＝/g, '=').replace(/\bj(?=\d)/g, 'j ')
  out = out.replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+)/g, (s) => '^' + [...s].map((c) => SUPERSCRIPT[c] ?? c).join(''))
  return out
}

/**
 * 從預期結果文字抽出所有數字（含千分位逗號、科學記號 a×10⁻ᵇ / aeb、百分比）。
 * 緊接在英文字母、底線或 § 之後的數字（例如 T06、E30、F-06.15、§12.1 的章節號）不算，避免把編號當成結果。
 * 百分比同時加入 x 與 x/100 兩個值（78.75% 可對應機率 0.7875）。
 * （排版：正規表示式另起一行。它是這段程式最長的一行，接在 `const re =` 後面時，頁面上的程式碼框在桌機會多出一條只差 5px 的橫向捲軸。）
 */
// #region core:extractNumbers
export function extractNumbers(text: string): ExtractedNumber[] {
  const s = normalizeNumberText(text)
  const re =
    /(?<![A-Za-z_§.\d^-])(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?)(?:\s*[×*]\s*10\^?([-+]?\d+)|e([-+]?\d+))?(\s*%)?/g
  const out: ExtractedNumber[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    // 排除「F-06」這種：'-' 前面是字母時，lookbehind 只檢查 '-' 前一個字元
    const start = m.index
    if (m[1].startsWith('-') && start > 0 && /[A-Za-z_§]/.test(s[start - 1])) continue
    const mant = Number(m[1].replace(/,/g, ''))
    if (!Number.isFinite(mant)) continue
    const decimals = m[2]?.length ?? 0
    const expStr = m[3] ?? m[4]
    const exp = expStr !== undefined ? Number(expStr) : 0
    const scale = 10 ** exp
    const value = mant * scale
    const tol = 0.5 * 10 ** -decimals * scale // 捨入半寬 h = ½·10^(−d)·10^e
    out.push({ raw: m[0].trim(), value, tol })
    if (m[5]) out.push({ raw: m[0].trim(), value: value / 100, tol: tol / 100 })
  }
  return out
}
// #endregion

/** 「夠精確」的門檻：捨入半寬不超過數值的 1%（約 3 位有效數字以上）才足以當作證據 */
export const PRECISE_REL = 0.01
/** 「相等」的門檻（浮點意義）：相對 10⁻⁹（|y_t| < 1 時用絕對 10⁻⁹） */
export const EXACT_REL = 1e-9

// #region core:findExpectedMatch
/**
 * 文字數字 n 對重算值的「接受半寬」：
 * - 夠精確（Δ_t ≤ 1%·|y_t|）：k·Δ_t——重算值落在這個範圍內，文字就是它的正確捨入。
 * - 不夠精確（例如「2」「0.6」「−0.25」）：任何 1.5–2.5 的數都會被寫成「2」，不足以當證據；
 *   allowExact 時只接受浮點意義上的相等（教科書例子裡的短數字通常是精確值），否則不接受（回傳 −1）。
 */
export function acceptHalfWidth(n: Pick<ExtractedNumber, 'value' | 'tol'>, k = 1, allowExact = true): number {
  if (n.tol <= PRECISE_REL * Math.abs(n.value)) return k * n.tol
  return allowExact ? EXACT_REL * Math.max(1, Math.abs(n.value)) : -1
}

/**
 * 在抽出的數字中找與 value 相符者：|value − y_t| ≤ acceptHalfWidth(y_t)。回傳最接近者；找不到回傳 null。
 * 不接受符號相反的寫法：符號（例如 C < 0）本身就是結論的一部分。
 */
export function findExpectedMatch(value: number, numbers: ExtractedNumber[], k = 1.001, allowExact = true): ExtractedNumber | null {
  if (!Number.isFinite(value)) return null
  let best: ExtractedNumber | null = null
  let bestErr = Infinity
  for (const n of numbers) {
    const err = Math.abs(value - n.value)
    if (err <= acceptHalfWidth(n, k, allowExact) && err < bestErr) {
      best = n
      bestErr = err
    }
  }
  return best
}
// #endregion

const TEX_SYMBOLS: Record<string, string> = {
  mu: 'μ',
  sigma: 'σ',
  rho: 'ρ',
  lambda: 'λ',
  theta: 'θ',
  varphi: 'φ',
  phi: 'φ',
  Omega: 'Ω',
  omega: 'ω',
  delta: 'δ',
  Delta: 'Δ',
  eta: 'η',
  kappa: 'κ',
  beta: 'β',
  gamma: 'γ',
  tau: 'τ',
  pi: 'π',
  le: '≤',
  ge: '≥',
  ne: '≠',
  approx: '≈',
  pm: '±',
  infty: '∞',
  times: '×',
  cdot: '·',
  to: '→',
  Rightarrow: '⇒',
  forall: '∀',
  circ: '°',
  // 沒有大括號的字型指令（\mathrm s）：指令本身不輸出
  mathrm: '',
  text: '',
  mathbf: '',
  boldsymbol: '',
  operatorname: '',
  min: 'min',
  max: 'max',
  ln: 'ln',
  log: 'log',
  cos: 'cos',
  sin: 'sin',
}

/**
 * 只接受純文字的共用元件 prop（ExperimentShell 的 warnings、assumptions、MetricRow 的 note）用：
 * 把 `$…$` 內的常見 TeX 轉成 Unicode 近似（\mu → μ、\frac{a}{b} → a/b…），其餘文字不變。
 * 這是不得已的退路；頁面本身的數學一律以 KaTeX 顯示。
 */
export function texToPlain(text: string): string {
  return text.replace(/\$([^$]+)\$/g, (_, tex: string) => {
    let s = tex
    for (let i = 0; i < 4; i++) {
      s = s
        .replace(/([\^_])\{([^{}]*)\}/g, '$1$2') // ^{-1} → ^-1（先攤平最內層，外層的 \mathrm{…} 才配得到）
        .replace(/\\[td]?frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
        .replace(/\\sqrt\{([^{}]*)\}/g, '√($1)')
        .replace(/\\(?:text|mathrm|mathbf|operatorname|overline|hat|bar|boxed)\{([^{}]*)\}/g, '$1')
    }
    s = s
      .replace(/\^\{\\circ\}|\^\\circ/g, '°')
      .replace(/\\(?:left|right|big|Big)/g, '')
      .replace(/\\[,;:! ]|\\quad|\\qquad/g, ' ')
      .replace(/\\([A-Za-z]+)/g, (_m, name: string) => TEX_SYMBOLS[name] ?? name)
      .replace(/[{}]/g, '')
      .replace(/\^°/g, '°')
      .replace(/\\\\/g, ' ')
      .replace(/\s+/g, ' ')
    return s.trim()
  })
}
