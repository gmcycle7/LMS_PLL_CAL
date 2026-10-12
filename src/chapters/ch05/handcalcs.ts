import { texNum } from '@/components'
import type { HandCalcDef, HandCalcInput, HandCalcStep } from '@/data/types'
import { normCdf, normInv, normPdf } from '@/simulation/core'
import {
  blockLoopLinear,
  directionClt,
  directionCltPlain,
  directionExact,
  directionOutcomeClt,
  directionOutcomeExact,
  kq,
  kqLocal,
  linearizationRelError,
  meanQ,
  minNForTarget,
  pPlus,
  samplesForConfidence,
  samplesSmallSignal,
  sumMoments,
  tieProbStirling,
  tieRuleEquilibrium,
  tieRuleEquilibriumApprox,
  varQ,
} from '@/simulation/models/comparator'

/**
 * Ch05「1-bit Comparator」的帶入手算題（docs/teaching-style.md §7）。
 *
 * 原則：
 *  1. 每一題最後要對的「答案」（results[].value）一律取自 src/simulation/models/comparator.ts 的實際函式；
 *  2. 步驟（steps）是人用紙筆＋工程計算機做得到的版本：小訊號下用 Φ(r) ≈ ½ + r·φ(0)、m ≈ √(2/π)·r，
 *     所以步驟的最後一個數字和模型的精確值可能差一點點——差多少寫在 notes，並由 tolerance 與 validate 保證
 *     「照著步驟算」一定會被判為正確（handcalcs.test.tsx 逐題驗證）；
 *  3. 「照畫面上的數字往下算」：每一步的結果先四捨五入成畫面上顯示的那個數字（rd()：乘、除、開根號、eˣ、ln 取 5 位
 *     有效數字；加減法在十進位是精確的，用 add() 完整顯示），下一步就拿這個「抄在紙上的數字」繼續算。
 *     因此畫面上的每一個等號，讀者把左邊顯示的數字按進計算機、四捨五入後，一定得到右邊顯示的數字——
 *     不會出現「1.6449 × 100 = 164.485」「1.0213 − 1 = 0.021292」這種對不起來的算式
 *     （handcalcs.test.tsx 會把每一步的 TeX 重新求值檢查）。還要再平方或相減的量多抄一兩位（z、p_cal²）。
 *  4. 使用者輸入的數字完整顯示（不四捨五入）；負數與科學記號當底數時加括號（(5\times10^{-5})^2）。
 *  5. 需要查表的地方（Φ、Φ⁻¹）在 why／tips 說明怎麼查，並給沒有表時的近似與它的誤差。
 */

const PAGE = '/ch/05'
const FS = String.raw`\mathrm{fs}`

/** φ(0) = 1/√(2π) ≈ 0.39894：Φ 在 0 的斜率（由模擬核心的 normPdf 取得）。 */
const PHI0 = normPdf(0)
/** √(2/π) ≈ 0.79788 = K_q·σ_v（由模型的 kq(1) 取得，不另寫常數）。 */
const ROOT_2_OVER_PI = kq(1)

/** 各題 validate 使用的適用範圍（測試會逐一驗證這些界限內手算與模型的差距）。 */
export const HC05_LIMITS = {
  /** 一階泰勒 Φ(r) ≈ ½ + rφ(0)、m ≈ √(2/π)·r：|r| ≤ 0.3 時 E[q] 高估 ≤ r²/6 = 1.5% */
  rSmall: 0.3,
  /** CLT 查表題：|r| ≤ 0.2（m 的誤差 ≤ 0.67%，換算成 Φ 的誤差 < 0.002） */
  rClt: 0.2,
  /** CLT 是大 N 近似（Berry–Esseen 上界 ≈ 0.47/√N） */
  nCltMin: 20,
  /** tie 機率題：|r| ≤ 0.1 且 N m²/2 ≤ 3（再大 tie 機率已可忽略，而且指數對 m 的誤差太敏感） */
  rTie: 0.1,
  tieExponentMax: 3,
  /** Stirling 近似的相對誤差 ≈ 1/(4N)：N ≥ 10 時 < 3% */
  nTieMin: 10,
  /** 所需樣本數的小訊號式：|r| ≤ 0.25（再大會高估 N 超過 2%，見 §4 計算器的提示） */
  rSamples: 0.25,
  /** 反查表與手算近似的範圍：P ≤ 0.999999（z ≤ 4.75） */
  pTargetMax: 0.999999,
  /** 線性化誤差 r²/6：|r| ≤ 2 時與精確值相差 < 2%；再大 S 曲線已飽和 */
  rLinear: 2,
  /** 綜合題：g ≤ 1.98。再靠近穩定邊界 g = 2，1 − |p_cal| = 2 − g 是兩個幾乎相等的數相減，5 位有效數字的手算誤差會超過 1% */
  gMax: 1.98,
  /** 綜合題：|p_cal| ≥ 0.002。g ≈ 1（deadbeat）時 τ = −1/ln|p_cal| 對 p_cal 的最後一位極度敏感 */
  poleMin: 0.002,
  /** 綜合題：g ≥ 1e-8。再小的話 1 − g 在 10 位數的計算機上和 1 分不出來，ln|p_cal| 算不出來 */
  gMin: 1e-8,
} as const

/* ───────────── 「照畫面上的數字往下算」的小工具（純顯示／抄寫，不含任何模型公式） ───────────── */

/**
 * 手算時抄在紙上的數字：四捨五入到 sig 位有效數字（預設 5），下一步就用這個數字繼續算。
 * 整數部分不四捨五入（796288 不會被抄成 796290——那樣看起來像精確值，卻和計算機上的數字對不起來）。
 * 0、±∞、NaN 原樣回傳。
 */
export function rd(x: number, sig = 5): number {
  if (!Number.isFinite(x) || x === 0) return x
  const intDigits = Math.floor(Math.log10(Math.abs(x))) + 1 // 整數部分有幾位（|x| < 1 時 ≤ 0）
  return Number(x.toPrecision(Math.min(15, Math.max(sig, intDigits))))
}

/** 乘以小整數、移小數點這類「寫得完」的結果：不四捨五入，只去掉 double 的殘渣（3 × 0.12598933 → 0.37796799）。 */
function exact(x: number): number {
  return rd(x, 13)
}

/**
 * a + b（減法寫成 add(a, −b)）。加減法在十進位是精確的，所以不四捨五入到 5 位；只把結果對齊到「較大運算元的第 13 位
 * 有效數字」那一個小數位，去掉 double 的殘渣（1 − 0.079788 → 0.920212；1 − 0.9999976148 → 2.3852×10⁻⁶，
 * 不是 2.385199999955×10⁻⁶）。
 */
function add(a: number, b: number): number {
  const sum = a + b
  const scale = Math.max(Math.abs(a), Math.abs(b))
  if (sum === 0 || scale === 0 || !Number.isFinite(sum)) return sum
  const decimals = 12 - Math.floor(Math.log10(scale))
  return decimals >= 0 && decimals <= 100 ? Number(sum.toFixed(decimals)) : sum
}

/** 寫成十進位小數時用了幾位有效數字（0.84679 → 5、0.9605039 → 7）。 */
function sigDigits(x: number): number {
  if (!Number.isFinite(x) || x === 0) return 1
  return x
    .toExponential()
    .replace(/e.*$/, '')
    .replace(/[-.]/g, '').length
}

/**
 * 「1 − x」之後還要保有 5 位有效數字時，x 要抄幾位（x → 1 時相減會抵銷掉前幾位：1 − 0.9605 = 0.0395 只剩 3 位）。
 * 回傳 5–12；不抵銷時就是 5。
 */
function sigBeforeOneMinus(x: number): number {
  const diff = Math.abs(1 - x)
  if (!(diff > 0) || !Number.isFinite(diff) || !(Math.abs(x) > diff)) return 5
  return Math.min(12, 5 + Math.ceil(Math.log10(Math.abs(x) / diff)))
}

/** 整數的 TeX 寫法（千分位寫成 {,}：數學模式直接寫逗號會被排成標點）。 */
function texI(n: number): string {
  return Math.round(n).toLocaleString('en-US').replace(/,/g, '{,}')
}

/**
 * 把「已經是畫面精度」的數字（使用者輸入、rd() 或 exact() 的結果）寫成 TeX：完整顯示，不再四捨五入。
 * 一萬以上的整數寫成千分位（42{,}499、2{,}400{,}123，與樣本數 N 的寫法一致），其餘沿用共用 texNum（很小的數寫成 a\times10^{b}）。
 */
function tn(x: number): string {
  if (Number.isInteger(x) && Math.abs(x) >= 1e4 && Math.abs(x) < 1e15) return texI(x)
  return texNum(x, 12)
}

/** 乘數、加數用：負數加括號，例如 2\times(-0.015958)、\tfrac12+(-0.015958)。 */
function tnP(x: number): string {
  const s = tn(x)
  return s.startsWith('-') ? `(${s})` : s
}

/** x²：負數與科學記號的底數加括號（-0.3^2 會被讀成 −(0.3²)；5\times10^{-5}^2 是 KaTeX 的 double superscript 錯誤）。 */
function tnSq(x: number): string {
  const s = tn(x)
  return `${s.startsWith('-') || s.includes('^') ? `(${s})` : s}^2`
}

/** \ln 的引數：科學記號加括號（\ln 2\times10^{-5} 會被讀成 (\ln 2)\times10^{-5}）。 */
function tnArg(x: number): string {
  const s = tn(x)
  return s.includes('\\times') || s.startsWith('-') ? `(${s})` : s
}

/** 查表得到的 Φ：四位小數（一般常態表的位數）。 */
function phi4(z: number): number {
  return Number(normCdf(z).toFixed(4))
}

/* 手算用的常數：就是模型常數抄到畫面上顯示的位數（測試會確認它們等於 normPdf(0)、kq(1)、π 的四捨五入）。 */
/** π 抄 6 位：3.14159 */
const PI_H = rd(Math.PI, 6)
/** √(2π) 抄 6 位：2.50663（只抄 5 位的 2.5066 取倒數會得到 0.39895，最後一位就錯了） */
const SQRT_2PI_H = rd(Math.sqrt(2 * Math.PI), 6)
/** φ(0) = 0.39894 */
const PHI0_H = rd(PHI0)
/** 2/π = 0.63662 */
const TWO_OVER_PI_H = rd(2 / Math.PI)
/** √(2/π) = 0.79788 */
const ROOT_H = rd(ROOT_2_OVER_PI)
/** π/2 = 1.5708 */
const HALF_PI_H = rd(Math.PI / 2)

/** 手算常數（測試用）。 */
export const HC05_HAND_CONSTANTS = { pi: PI_H, sqrt2Pi: SQRT_2PI_H, phi0: PHI0_H, twoOverPi: TWO_OVER_PI_H, root2OverPi: ROOT_H, halfPi: HALF_PI_H } as const

/** 不小於 x 的最小奇數（N 取奇數就沒有 tie，勘誤 E02）。 */
export function nextOdd(x: number): number {
  const c = Math.ceil(x)
  return c % 2 === 1 ? c : c + 1
}

/**
 * 沒有常態表時的手算 Φ(z)：
 *  - |z| ≤ 0.3：一階泰勒 ½ + z·φ(0)（誤差 ≤ z³φ(0)/6 < 0.002）；
 *  - 其餘：Pólya 近似 ½[1 + √(1 − e^{−2z²/π})]（z ≥ 0；所有 z 的絕對誤差 < 0.0032）。
 * 只用在說明文字裡示範「照這樣按計算機會得到多少」；答案一律取模型（normCdf）的值。
 */
export function phiHand(z: number): { value: number; method: 'linear' | 'polya' } {
  if (Math.abs(z) <= 0.3) return { value: 0.5 + z * PHI0, method: 'linear' }
  const upper = 0.5 * (1 + Math.sqrt(1 - Math.exp((-2 * z * z) / Math.PI)))
  return { value: z >= 0 ? upper : 1 - upper, method: 'polya' }
}

/** 「Φ(z) 怎麼查／怎麼按」的說明（放在 why）。 */
function phiHow(z: number): string {
  if (Math.abs(z) > 3.5) {
    const lim = z > 0 ? 1 : 0
    return String.raw`$|z|>3.5$ 已超出一般常態表的範圍：$\Phi(z)$ 與 $${lim}$ 相差不到 $1-\Phi(3.5)=${texNum(1 - normCdf(3.5), 3)}$，直接寫 $${lim}$ 即可（方向幾乎確定${z > 0 ? '判對' : '判錯'}）。`
  }
  const h = phiHand(z)
  const table = String.raw`查標準常態表（$z$ 四捨五入到小數第二位；負的 $z$ 用 $\Phi(-z)=1-\Phi(z)$）。`
  if (h.method === 'linear') {
    return String.raw`${table}沒有表時：$|z|\le0.3$ 可用 $\Phi(z)\approx\tfrac12+${tn(PHI0_H)}\,z=${texNum(h.value, 4)}$（誤差 $<0.002$）。`
  }
  return String.raw`${table}沒有表時用 Pólya 近似 $\Phi(|z|)\approx\tfrac12\big[1+\sqrt{1-e^{-2z^2/\pi}}\,\big]$${z < 0 ? String.raw`（負的 $z$ 再取 $1-\Phi(|z|)$）` : ''}，得 $${texNum(h.value, 4)}$（誤差 $<0.0032$）。`
}

/**
 * 沒有反查表時的手算 Φ⁻¹(P)（½ ≤ P < 1；Abramowitz–Stegun 26.2.22，所有 P 的絕對誤差 < 0.003）：
 *   t = √(−2·ln(1 − P))，z ≈ t − (2.30753 + 0.27061·t)/(1 + 0.99229·t + 0.04481·t²)。
 * 只用在說明文字裡示範「照這樣按計算機會得到多少」；答案一律取模型（normInv）的值。
 */
export function zHand(P: number): { t: number; value: number } {
  const t = Math.sqrt(-2 * Math.log(1 - P))
  return { t, value: t - (2.30753 + 0.27061 * t) / (1 + 0.99229 * t + 0.04481 * t * t) }
}

/** 「Φ⁻¹(P) 怎麼查／怎麼按」的說明（放在 why）。 */
function zHow(P: number): string {
  const h = zHand(P)
  return String.raw`沒有反查表時：先算 $t=\sqrt{-2\ln(1-P_{\text{target}})}=${texNum(h.t, 5)}$，再代 $z\approx t-\dfrac{2.30753+0.27061\,t}{1+0.99229\,t+0.04481\,t^2}=${texNum(h.value, 5)}$（誤差 $<0.003$）。`
}

const SIGMA_ZERO = String.raw`$\sigma_v$ 必須大於 0：沒有雜訊時 comparator 是 hard limiter（階梯），單一次比較就確定方向，$\Phi$ 與 $K_q$ 的公式都不適用（見 §7 的 dither 實驗）。`

const inS = (over: Partial<HandCalcInput> = {}): HandCalcInput => ({
  key: 's',
  symbol: 's',
  label: '要辨識方向的固定誤差',
  unit: FS,
  default: 1,
  min: -1000,
  max: 1000,
  practice: { choices: [1, 2, 5, 10] },
  ...over,
})

const inSigma = (over: Partial<HandCalcInput> = {}): HandCalcInput => ({
  key: 'sigma',
  symbol: String.raw`\sigma_v`,
  label: 'comparator 前的雜訊 RMS',
  unit: FS,
  default: 100,
  min: 0,
  max: 100000,
  practice: { choices: [50, 100, 200] },
  ...over,
})

/** 常態表節錄（由模擬核心即時產生，不手抄數字）。 */
const PHI_TABLE_TIP = `常態表節錄：${[0.1, 0.2, 0.3, 0.5, 0.8, 1, 1.5, 2, 2.5, 3].map((z) => `$\\Phi(${z})=${normCdf(z).toFixed(4)}$`).join('、')}。`
const Z_TABLE_TIP = `反查表 $z=\\Phi^{-1}(P)$：${[0.9, 0.95, 0.975, 0.99, 0.995, 0.999]
  .map((P) => `${Number((100 * P).toPrecision(4))}% → $${normInv(P).toFixed(3)}$`)
  .join('、')}。`

export const HANDCALCS: HandCalcDef[] = [
  /* ───────────── HC-05.1：單一次比較 ───────────── */
  {
    id: 'HC-05.1',
    title: String.raw`單一次比較：$P(q=+1)$、$E[q]$ 與 $\operatorname{Var}(q)$`,
    page: PAGE,
    formulaId: 'F-05.1',
    formulaTex: String.raw`r=\frac{s-\theta}{\sigma_v},\qquad p=P(q=+1)=\Phi(r)\approx\tfrac12+\frac{r}{\sqrt{2\pi}},\qquad m=E[q]=2p-1,\qquad \operatorname{Var}(q)=1-m^2`,
    level: 'beginner',
    claim: 'approx',
    inputs: [
      inS({ practice: { choices: [-5, -2, 1, 2, 5, 10, 20] } }),
      inSigma(),
      // θ 的練習值刻意不和 s 的練習值相同：s = θ 時 p = ½、m = 0，整題都是 0，沒有東西可以算
      { key: 'theta', symbol: String.raw`\theta`, label: 'comparator threshold／offset', unit: FS, default: 0, min: -1000, max: 1000, practice: { choices: [0, 0, 0, -1, 0.5, 3] } },
    ],
    validate: ({ s, sigma, theta }) => {
      if (!(sigma > 0)) return SIGMA_ZERO
      const r = (s - theta) / sigma
      if (Math.abs(r) > HC05_LIMITS.rSmall) {
        return String.raw`$|r|=|s-\theta|/\sigma_v=${texNum(Math.abs(r), 3)}>${HC05_LIMITS.rSmall}$：一階泰勒 $\Phi(r)\approx\tfrac12+r/\sqrt{2\pi}$ 被捨去的三次項 $r^3/(6\sqrt{2\pi})$ 已接近 $0.002$，$E[q]$ 會高估超過 1.5%。請縮小 $|s-\theta|$ 或加大 $\sigma_v$；大的 $r$ 要查常態表（HC-05.4 的提示有節錄）。`
      }
      return null
    },
    solve: ({ s, sigma, theta }) => {
      // 手算鏈：每個數字都是畫面上顯示的那個數字（見檔頭原則 3）
      const d = add(s, -theta)
      const r = rd(d / sigma)
      const half = rd(r * PHI0_H) // p − ½ 的小訊號值
      const pHand = add(0.5, half)
      const mHand = rd(2 * half)
      const m2 = rd(mHand * mHand)
      const varHand = add(1, -m2)
      // 模型（答案）
      const p = pPlus(s, sigma, theta)
      const m = meanQ(s, sigma, theta)
      const rTrue = (s - theta) / sigma
      const steps: HandCalcStep[] = []
      if (theta !== 0) {
        steps.push({
          tex: String.raw`s-\theta = ${tn(s)}-${tnP(theta)} = ${tn(d)}\ ${FS}`,
          why: 'Comparator offset 先從誤差扣掉：決定輸出的是「誤差離門檻多遠」。',
        })
      }
      steps.push(
        {
          tex: String.raw`r = \frac{s-\theta}{\sigma_v} = \frac{${tn(d)}}{${tn(sigma)}} = ${tn(r)}`,
          why: '標準化：用雜訊的 $\\sigma_v$ 當尺。$|r|\\ll1$ 表示誤差埋在雜訊裡。',
        },
        {
          tex: String.raw`\varphi(0) = \frac{1}{\sqrt{2\pi}} = \frac{1}{${tn(SQRT_2PI_H)}} = ${tn(PHI0_H)}`,
          why: '常數，與輸入無關，直接代 $0.39894$ 即可（來源：計算機按 $2\\times\\pi$ → $\\sqrt{\\ }$ 得 $2.50663$ → $1/x$）。它是 $\\Phi$ 在 $0$ 的斜率 $\\Phi\'(0)$。',
        },
        {
          tex: String.raw`p-\tfrac12 \approx r\,\varphi(0) = ${tnP(r)}\times${tn(PHI0_H)} = ${tn(half)}`,
          why: '一階泰勒 $\\Phi(r)\\approx\\Phi(0)+r\\,\\Phi\'(0)$：機率只比 $\\tfrac12$ 偏這麼一點。',
        },
        {
          tex: String.raw`p \approx \tfrac12+${tnP(half)} = ${tn(pHand)}`,
          why: '輸出 $+1$ 的機率；$1-p$ 就是輸出 $-1$ 的機率。',
        },
        {
          tex: String.raw`m = 2p-1 = 2\,\big(p-\tfrac12\big) = 2\times${tnP(half)} = ${tn(mHand)}`,
          why: '$E[q]=(+1)\\,p+(-1)(1-p)=2p-1$：平均輸出，就是藏在雜訊裡的「訊號」。直接把上上一步的 $p-\\tfrac12$ 乘 2，不要用 $2\\times0.50\\ldots-1$（兩個幾乎相等的數相減會丟掉有效位數）。',
        },
        {
          tex: String.raw`m^2 = ${tnSq(mHand)} = ${tn(m2)}`,
          why: '先算平方（一次乘法）。',
        },
        {
          tex: String.raw`\operatorname{Var}(q) = 1-m^2 = 1-${tn(m2)} = ${tn(varHand)}`,
          why: '$q^2\\equiv1$，所以 $\\operatorname{Var}(q)=E[q^2]-m^2=1-m^2$：單次的「雜訊功率」幾乎是滿的 1。',
        },
      )
      const notes = [
        String.raw`精確值（網站模擬核心 pPlus／meanQ，等同查 $\Phi$ 表）：$p=${texNum(p, 10)}$、$m=${texNum(m, 8)}$。一階泰勒式 $\tfrac12+r\varphi(0)$ 與精確的 $p$ 相差 $${texNum(0.5 + rTrue * PHI0 - p, 3)}$，就是被捨去的三次項 $r^3\varphi(0)/6=${texNum((rTrue ** 3 * PHI0) / 6, 3)}$；步驟裡每個數字只抄 5 位有效數字，最後一位可能再差 1。`,
      ]
      if (d === 0) notes.push('$s=\\theta$：門檻剛好落在誤差上，$p=\\tfrac12$、$m=0$——不管累加多少次都只能擲硬幣。')
      else if (s !== 0 && Math.sign(m) !== Math.sign(s)) notes.push('注意 $m$ 和 $s$ 反號：offset $\\theta$ 蓋過了誤差，累加越多次越「確定地」判錯方向。')
      return {
        steps,
        results: [
          { symbol: 'p', label: '輸出 +1 的機率（精確值；小訊號手算在容許範圍內）', value: p, digits: 7, tolerance: { abs: 0.02 * Math.abs(p - 0.5) + 1e-9, rel: 0 } },
          { symbol: 'm', label: '平均輸出（訊號）', value: m, digits: 5, tolerance: { rel: 0.02, abs: 1e-9 } },
          { symbol: String.raw`\operatorname{Var}(q)`, label: '單次輸出的變異數', value: varQ(m), digits: 8, tolerance: { abs: 0.05 * m * m + 1e-9, rel: 0 } },
        ],
        notes,
      }
    },
    tips: [
      '兩個常數背起來，本章的手算幾乎都用得到：$\\varphi(0)=1/\\sqrt{2\\pi}=0.39894$、$\\sqrt{2/\\pi}=2\\varphi(0)=0.79788$。',
      '適用範圍：$|r|\\le0.3$ 時 $\\Phi(r)\\approx\\tfrac12+0.39894\\,r$ 的絕對誤差 $<0.002$；$|r|\\le0.1$ 時 $<7\\times10^{-5}$。更大的 $r$ 請查常態表。',
      '答案要寫到「偏離 $\\tfrac12$ 的量」看得出來的位數（例如 $0.50399$，不是 $0.50$）：整章的資訊就藏在那 $0.4$ 個百分點裡。',
      '範例數字（$s=1\\,\\mathrm{fs}$、$\\sigma_v=100\\,\\mathrm{fs}$、$\\theta=0$）：$p=0.503989$、$m=0.00797871$（測試 T04）。',
    ],
  },

  /* ───────────── HC-05.2：S_N 的平均、標準差與統計 SNR ───────────── */
  {
    id: 'HC-05.2',
    title: String.raw`累加 $N$ 次：$E[S_N]$、$\mathrm{SD}(S_N)$ 與 $\mathrm{SNR}_{\mathrm{stat}}$`,
    page: PAGE,
    formulaId: 'F-05.5',
    formulaTex: String.raw`m\approx\sqrt{\tfrac2\pi}\,\frac{s}{\sigma_v},\qquad E[S_N]=Nm,\qquad \mathrm{SD}(S_N)=\sqrt{N(1-m^2)},\qquad \mathrm{SNR}_{\mathrm{stat}}=\frac{E[S_N]}{\mathrm{SD}(S_N)}=\frac{m\sqrt N}{\sqrt{1-m^2}}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      inS(),
      inSigma(),
      { key: 'N', symbol: 'N', label: '累加的樣本數', unit: String.raw`\text{samples}`, default: 10000, min: 1, max: 1e9, integer: true, practice: { choices: [100, 400, 2500, 10000, 40000, 1000000] } },
    ],
    validate: ({ s, sigma }) => {
      if (!(sigma > 0)) return SIGMA_ZERO
      const r = s / sigma
      if (Math.abs(r) > HC05_LIMITS.rSmall) {
        return String.raw`$|r|=|s|/\sigma_v=${texNum(Math.abs(r), 3)}>${HC05_LIMITS.rSmall}$：小訊號式 $m\approx\sqrt{2/\pi}\,r$ 會高估 $m$ 超過 1.5%（S 曲線開始飽和）。請縮小 $|s|$ 或加大 $\sigma_v$；大的 $r$ 要用 $m=2\Phi(r)-1$ 查表。`
      }
      return null
    },
    solve: ({ s, sigma, N }) => {
      const r = rd(s / sigma)
      const mHand = rd(ROOT_H * r)
      const meanHand = rd(N * mHand)
      const m2 = rd(mHand * mHand)
      const oneMinus = add(1, -m2)
      const varHand = rd(N * oneMinus, 8)
      const sdHand = rd(Math.sqrt(varHand))
      const snrHand = rd(meanHand / sdHand)
      const rTrue = s / sigma
      const m = meanQ(s, sigma)
      const mom = sumMoments(N, m)
      const notes = [
        String.raw`精確值（模型 sumMoments，$m=\operatorname{erf}(r/\sqrt2)=${texNum(m, 8)}$）：$E[S_N]=${texNum(mom.meanSum, 6)}$、$\mathrm{SD}(S_N)=${texNum(mom.sdSum, 6)}$。小訊號的 $m$ 只高估 $r^2/6=${texNum((rTrue * rTrue) / 6, 3)}$（相對）。`,
        String.raw`換成平均 $G=S_N/N$（勘誤 E18）：$E[G]=m=${texNum(mom.meanAvg, 5)}$、$\mathrm{SD}(G)=\mathrm{SD}(S_N)/N=${texNum(mom.sdAvg, 5)}$——兩者都除以 $N$，$\mathrm{SNR}_{\mathrm{stat}}$ 不變。`,
      ]
      if (m !== 0) {
        notes.push(
          String.raw`訊號 $\propto N$、雜訊 $\propto\sqrt N$：兩條線在 $N=(1-m^2)/m^2\approx${texI((1 - m * m) / (m * m))}$ 交叉（$\mathrm{SNR}_{\mathrm{stat}}=1$）；${Math.abs(mom.snr) < 1 ? '現在的 $N$ 還在交叉點左邊，訊號仍埋在雜訊裡。' : '現在的 $N$ 已在交叉點右邊，方向開始看得出來。'}`,
        )
      }
      return {
        steps: [
          { tex: String.raw`r = \frac{s}{\sigma_v} = \frac{${tn(s)}}{${tn(sigma)}} = ${tn(r)}`, why: '標準化誤差。' },
          {
            tex: String.raw`m \approx \sqrt{\tfrac2\pi}\;r = ${tn(ROOT_H)}\times${tnP(r)} = ${tn(mHand)}`,
            why: '小訊號：$m=\\operatorname{erf}(r/\\sqrt2)\\approx\\sqrt{2/\\pi}\\,r$。常數 $\\sqrt{2/\\pi}$：計算機按 $2\\div\\pi=0.63662$ → $\\sqrt{\\ }=0.79788$。',
          },
          {
            tex: String.raw`E[S_N] = N\,m = ${texI(N)}\times${tnP(mHand)} = ${tn(meanHand)}`,
            why: '訊號：每個樣本平均貢獻 $m$，$N$ 個相加（期望值線性，不需要獨立）。',
          },
          { tex: String.raw`m^2 = ${tnSq(mHand)} = ${tn(m2)}`, why: '每個樣本的變異數是 $1-m^2$，先算 $m^2$。' },
          {
            tex: String.raw`\operatorname{Var}(q) = 1-m^2 = 1-${tn(m2)} = ${tn(oneMinus)}`,
            why: '單一樣本的變異數（HC-05.1）。小訊號時幾乎就是 1。',
          },
          {
            tex: String.raw`\operatorname{Var}(S_N) = N\,(1-m^2) = ${texI(N)}\times${tn(oneMinus)} = ${tn(varHand)}`,
            why: '雜訊：樣本獨立，所以變異數相加：$\\operatorname{Var}(S_N)\\approx N$。',
          },
          {
            tex: String.raw`\mathrm{SD}(S_N) = \sqrt{\operatorname{Var}(S_N)} = \sqrt{${tn(varHand)}} = ${tn(sdHand)}`,
            why: '開根號（計算機 $\\sqrt{\\ }$）：標準差只隨 $\\sqrt N$ 成長。',
          },
          {
            tex: String.raw`\mathrm{SNR}_{\mathrm{stat}} = \frac{E[S_N]}{\mathrm{SD}(S_N)} = \frac{${tn(meanHand)}}{${tn(sdHand)}} = ${tn(snrHand)}`,
            why: '訊號除以雜訊。快速估算：$\\mathrm{SNR}_{\\mathrm{stat}}\\approx m\\sqrt N$。',
          },
        ],
        results: [
          { symbol: 'E[S_N]', label: '總和的平均（訊號）', value: mom.meanSum, tolerance: { rel: 0.02, abs: 1e-9 } },
          { symbol: String.raw`\mathrm{SD}(S_N)`, label: '總和的標準差（雜訊）', value: mom.sdSum },
          { symbol: String.raw`\mathrm{SNR}_{\mathrm{stat}}`, label: '統計 SNR', value: mom.snr, tolerance: { rel: 0.02, abs: 1e-9 } },
        ],
        notes,
      }
    },
    tips: [
      '$N$ 選完全平方數最好算：$N=10^4\\Rightarrow\\sqrt N=100$。先用 $\\mathrm{SD}\\approx\\sqrt N$、$\\mathrm{SNR}\\approx m\\sqrt N$ 心算估一次，再按計算機。',
      '每多 100 倍樣本，訊號多 100 倍、雜訊只多 10 倍，所以 SNR 多 10 倍。',
      '範例（$s=1\\,\\mathrm{fs}$、$\\sigma_v=100\\,\\mathrm{fs}$、$N=10^4$）：$E[S_N]=79.787$、$\\mathrm{SD}(S_N)=99.997$（§3 的數字）。',
    ],
  },

  /* ───────────── HC-05.3：小 N 的精確 Binomial ───────────── */
  {
    id: 'HC-05.3',
    title: String.raw`小 $N$ 的精確機率：$N=2$ 的 tie 與 $N=3$ 的多數決`,
    page: PAGE,
    formulaId: 'F-05.6',
    formulaTex: String.raw`P(K=k)=\binom Nk p^k(1-p)^{N-k},\quad S_N=2K-N:\qquad P(S_2>0)=p^2,\quad P(S_2=0)=2p(1-p),\quad P(S_3>0)=p^3+3p^2(1-p)`,
    level: 'beginner',
    claim: 'exact',
    inputs: [
      {
        key: 'p',
        symbol: 'p',
        label: '單次輸出 +1 的機率',
        default: 0.5039894,
        min: 0,
        max: 1,
        practice: { choices: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.9] },
      },
    ],
    validate: ({ p }) => (p < 0 || p > 1 ? '$p$ 是機率，必須在 $0\\le p\\le1$ 之間。' : null),
    solve: ({ p }) => {
      // 精確題：乘法的中間值抄 8 位有效數字（手算友善的 p 會自己除盡），加減法完整顯示
      const q = add(1, -p)
      const pp = rd(p * p, 8)
      const pq = rd(p * q, 8)
      const tie2 = exact(2 * pq)
      const p3 = rd(pp * p, 8)
      const ppq = rd(pp * q, 8)
      const mid3 = exact(3 * ppq)
      const pos3 = add(p3, mid3)
      const d2 = directionExact(p, 2)
      const d3 = directionExact(p, 3)
      const half2 = directionOutcomeExact(p, 2, 'half').correct
      const plus2 = directionOutcomeExact(p, 2, 'plus').correct
      const notes = [
        String.raw`Random tie-break（tie 擲硬幣）：$P(S_2>0)+\tfrac12P(S_2=0)=p^2+p(1-p)=${texNum(half2, 7)}=p$——偶數 $N$ 平分 tie 剛好等於奇數 $N-1$，多出來的那個樣本沒有幫助（F-05.13）。`,
        String.raw`硬體 $\operatorname{sign}(0)=+1$：$P(S_2\ge0)=p^2+2p(1-p)=${texNum(plus2, 6)}$；三種 tie rule 給三個不同的數字，所以偶數 $N$ 一定要講清楚用哪一條（勘誤 E02）。`,
      ]
      if (p > 0.5 && p < 1) notes.push(String.raw`嚴格的 $P(S_2>0)=${texNum(d2.pos, 4)}$ 比只看一次的 $p=${texNum(p, 4)}$ 還低：有 $${texNum(d2.tie, 4)}$ 的機率被 tie 吃掉了。`)
      return {
        steps: [
          { tex: String.raw`1-p = 1-${tn(p)} = ${tn(q)}`, why: '單次輸出 $-1$ 的機率。' },
          { tex: String.raw`P(S_2>0) = p^2 = ${tnSq(p)} = ${tn(pp)}`, why: '$N=2$：兩次都是 $+1$ 才有 $S_2=+2>0$；獨立事件的機率相乘。' },
          { tex: String.raw`p\,(1-p) = ${tn(p)}\times${tn(q)} = ${tn(pq)}`, why: '一個 $+1$、一個 $-1$（指定順序）的機率。' },
          { tex: String.raw`P(S_2=0) = 2\,p\,(1-p) = 2\times${tn(pq)} = ${tn(tie2)}`, why: '$(+,-)$ 與 $(-,+)$ 兩種順序都得到 $S_2=0$（tie），所以乘 $\\binom21=2$。' },
          { tex: String.raw`p^3 = p^2\times p = ${tn(pp)}\times${tn(p)} = ${tn(p3)}`, why: '$N=3$：三次都是 $+1$（$S_3=+3$）。' },
          { tex: String.raw`p^2(1-p) = ${tn(pp)}\times${tn(q)} = ${tn(ppq)}`, why: '兩個 $+1$、一個 $-1$（指定順序）的機率。' },
          {
            tex: String.raw`3\,p^2(1-p) = 3\times${tn(ppq)} = ${tn(mid3)}`,
            why: '$S_3=+1$：那個 $-1$ 可以出現在三個位置，所以乘 $\\binom32=3$。',
          },
          {
            tex: String.raw`P(S_3>0) = p^3+3p^2(1-p) = ${tn(p3)}+${tn(mid3)} = ${tn(pos3)}`,
            why: '多數決：三次裡至少兩次 $+1$。$N$ 是奇數，$S_3$ 不可能等於 0，沒有 tie。',
          },
        ],
        results: [
          { symbol: 'P(S_2>0)', label: '累加兩次：嚴格判 +1 的機率', value: d2.pos, digits: 6, tolerance: { abs: 5e-4, rel: 0 } },
          { symbol: 'P(S_2=0)', label: '累加兩次：平手（tie）的機率', value: d2.tie, digits: 6, tolerance: { abs: 5e-4, rel: 0 } },
          { symbol: 'P(S_3>0)', label: '累加三次：多數決判 +1 的機率', value: d3.pos, digits: 6, tolerance: { abs: 5e-4, rel: 0 } },
        ],
        notes,
      }
    },
    tips: [
      '把四種結果列出來最不容易錯：$(+,+)$ 機率 $p^2$、$(+,-)$ 與 $(-,+)$ 各 $p(1-p)$、$(-,-)$ 機率 $(1-p)^2$；四個加起來要等於 1。',
      '$N=3$ 也可以寫成 $p^2(3-2p)$，少按一次計算機。',
      '範例 $p=\\Phi(0.01)=0.5039894$（HC-05.1 的答案；$s=1\\,\\mathrm{fs}$、$\\sigma_v=100\\,\\mathrm{fs}$）：$P(S_2>0)=0.254005$（只有 25.4%）、$P(S_3>0)=0.505984$。乘法的中間值抄到 8 位有效數字，最後一位才對得上。',
      '大 $N$ 不能這樣逐項展開（$N=100$ 的中間項係數 $\\binom{100}{50}\\approx10^{29}$）；改用 HC-05.4 的 CLT 與 HC-05.5 的 Stirling 近似。',
    ],
  },

  /* ───────────── HC-05.4：CLT 查表與連續性修正 ───────────── */
  {
    id: 'HC-05.4',
    title: String.raw`CLT：由 $\mathrm{SNR}_{\mathrm{stat}}$ 查表得判對機率（偶數 $N$ 要做連續性修正）`,
    page: PAGE,
    formulaId: 'F-05.7',
    formulaTex: String.raw`z=\frac{Nm}{\sigma_S},\quad\sigma_S=\sqrt{N(1-m^2)}:\qquad \Phi(z)\approx\begin{cases}P(S_N>0) & N\text{ 奇數}\\ P(S_N>0)+\tfrac12P(S_N=0) & N\text{ 偶數}\end{cases}\qquad P(S_N>0)\approx\Phi\!\Big(\frac{Nm-1}{\sigma_S}\Big)\ (N\text{ 偶數})`,
    level: 'research',
    claim: 'approx',
    inputs: [
      inS({ min: 0, practice: { choices: [1, 2, 5] } }),
      inSigma(),
      { key: 'N', symbol: 'N', label: '累加的樣本數', unit: String.raw`\text{samples}`, default: 100, min: 1, max: 1e6, integer: true, practice: { choices: [64, 81, 100, 121, 400, 441, 2500, 10000, 10201] } },
    ],
    validate: ({ s, sigma, N }) => {
      if (!(sigma > 0)) return SIGMA_ZERO
      if (!(s > 0)) return '請輸入 $s>0$：$s=0$ 沒有「正確方向」（$m=0$，判對率永遠是擲硬幣）；$s<0$ 時把所有 $q$ 變號，判對機率和 $|s|$ 的結果完全相同。'
      const r = s / sigma
      if (r > HC05_LIMITS.rClt) {
        return String.raw`$r=s/\sigma_v=${texNum(r, 3)}>${HC05_LIMITS.rClt}$：小訊號式 $m\approx\sqrt{2/\pi}\,r$ 的誤差超過 0.7%，查表前的 $z$ 就不準了。請縮小 $s$ 或加大 $\sigma_v$（大的 $r$ 要用 $m=2\Phi(r)-1$）。`
      }
      if (N < HC05_LIMITS.nCltMin) {
        return String.raw`CLT 是大 $N$ 近似（誤差上界約 $0.47/\sqrt N$，Berry–Esseen）：$N=${texI(N)}<${HC05_LIMITS.nCltMin}$ 時請改用 HC-05.3 的逐項展開。`
      }
      return null
    },
    solve: ({ s, sigma, N }) => {
      const r = rd(s / sigma)
      const mHand = rd(ROOT_H * r)
      const Nm = rd(N * mHand)
      const m2 = rd(mHand * mHand)
      const oneMinus = add(1, -m2)
      const varHand = rd(N * oneMinus, 8)
      const sd = rd(Math.sqrt(varHand))
      const z = rd(Nm / sd)
      const even = N % 2 === 0
      const m = meanQ(s, sigma)
      const p = pPlus(s, sigma)
      const plain = directionCltPlain(m, N)
      const clt = directionClt(m, N)
      const exactSplit = directionExact(p, N)
      const steps: HandCalcStep[] = [
        { tex: String.raw`r = \frac{s}{\sigma_v} = \frac{${tn(s)}}{${tn(sigma)}} = ${tn(r)}`, why: '標準化誤差。' },
        { tex: String.raw`m \approx \sqrt{\tfrac2\pi}\;r = ${tn(ROOT_H)}\times${tn(r)} = ${tn(mHand)}`, why: '小訊號的平均輸出（$\\sqrt{2/\\pi}=0.79788$）。' },
        { tex: String.raw`N\,m = ${texI(N)}\times${tn(mHand)} = ${tn(Nm)}`, why: '$S_N$ 的平均 $E[S_N]$。' },
        { tex: String.raw`m^2 = ${tnSq(mHand)} = ${tn(m2)}`, why: '先算平方。' },
        { tex: String.raw`1-m^2 = 1-${tn(m2)} = ${tn(oneMinus)}`, why: '單一樣本的變異數 $\\operatorname{Var}(q)$。' },
        { tex: String.raw`\sigma_S^2 = N\,(1-m^2) = ${texI(N)}\times${tn(oneMinus)} = ${tn(varHand)}`, why: '$S_N$ 的變異數：獨立樣本的變異數相加。' },
        { tex: String.raw`\sigma_S = \sqrt{${tn(varHand)}} = ${tn(sd)}`, why: '開根號得標準差。' },
        {
          tex: String.raw`z = \frac{Nm}{\sigma_S} = \frac{${tn(Nm)}}{${tn(sd)}} = ${tn(z)}`,
          why: '標準化：決策門檻 $0$ 離平均 $Nm$ 有幾個標準差——這就是 $\\mathrm{SNR}_{\\mathrm{stat}}$。',
        },
        {
          tex: String.raw`\Phi(z) = \Phi(${tn(z)}) = ${tn(phi4(z))}`,
          why: `${even ? '偶數 $N$：這個值近似的是「tie 平分」的 $P(S_N>0)+\\tfrac12P(S_N=0)$，不是嚴格的 $P(S_N>0)$。' : '奇數 $N$ 沒有 tie，這就是 $P(S_N>0)$。'}${phiHow(z)}`,
        },
      ]
      const notes: string[] = []
      if (even) {
        const Nm1 = add(Nm, -1)
        const zc = rd(Nm1 / sd)
        steps.push(
          {
            tex: String.raw`N\,m-1 = ${tn(Nm)}-1 = ${tn(Nm1)}`,
            why: '連續性修正：偶數 $N$ 的格點是 $\\dots,-2,0,2,\\dots$，嚴格的 $S_N>0$ 等於 $S_N\\ge2$，切點移到 $0$ 與 $2$ 的中點 $1$。',
          },
          {
            tex: String.raw`z_c = \frac{Nm-1}{\sigma_S} = \frac{${tn(Nm1)}}{${tn(sd)}} = ${tn(zc)}`,
            why: '用修正後的切點重新標準化。',
          },
          {
            tex: String.raw`P(S_N>0) \approx \Phi(z_c) = \Phi(${tn(zc)}) = ${tn(phi4(zc))}`,
            why: `嚴格（strict）的判對機率。${phiHow(zc)}`,
          },
        )
        notes.push(
          String.raw`精確 Binomial（模型 directionExact）：$P(S_N>0)=${texNum(exactSplit.pos, 5)}$、$P(S_N=0)=${texNum(exactSplit.tie, 5)}$、平分 tie $=${texNum(exactSplit.pos + exactSplit.tie / 2, 5)}$。CLT 兩個值分別差 $${texNum(clt.pos - exactSplit.pos, 2)}$ 與 $${texNum(plain - (exactSplit.pos + exactSplit.tie / 2), 2)}$。`,
          String.raw`硬體 $\operatorname{sign}(0)=+1$（tie 判 $+1$）要把切點移到 $-1$：$\Phi\big((Nm+1)/\sigma_S\big)=${texNum(directionOutcomeClt(m, N, 'plus').correct, 4)}$；三種 rule 相鄰相差約 $\tfrac12P(S_N=0)$。改成 $N=${texI(N + 1)}$（奇數）就沒有這個問題。`,
        )
        if (clt.pos < 0.5) notes.push('嚴格的 $P(S_N>0)<50\\%$：不是累加沒有用，而是 tie 的機率被算成「判錯」——這就是規格 §5 原表的陷阱（勘誤 E02）。')
      } else {
        notes.push(String.raw`精確 Binomial（模型 directionExact）：$P(S_N>0)=${texNum(exactSplit.pos, 5)}$；CLT 與它相差 $${texNum(plain - exactSplit.pos, 2)}$（奇數 $N$ 的格點中點剛好是 $0$，不需要連續性修正）。`)
      }
      const tol = { abs: 0.006, rel: 0 }
      return {
        steps,
        results: even
          ? [
              { symbol: String.raw`P(S_N>0)+\tfrac12P(S_N=0)`, label: '平分 tie 的判對機率（CLT 規格式）', value: plain, digits: 4, tolerance: tol },
              { symbol: 'P(S_N>0)', label: '嚴格的判對機率（CLT + 連續性修正）', value: clt.pos, digits: 4, tolerance: tol },
            ]
          : [{ symbol: 'P(S_N>0)', label: '判對機率（CLT）', value: plain, digits: 4, tolerance: tol }],
        notes,
      }
    },
    tips: [
      PHI_TABLE_TIP,
      '沒有常態表時：$|z|\\le0.3$ 用 $\\Phi(z)\\approx\\tfrac12+0.39894\\,z$（誤差 $<0.002$）；其他用 Pólya 近似 $\\Phi(z)\\approx\\tfrac12\\big[1+\\sqrt{1-e^{-2z^2/\\pi}}\\,\\big]$（$z\\ge0$，誤差 $<0.0032$）。按法：$z^2$ → $\\times2\\div\\pi$ → 變號 → $e^x$ → $1-$ → $\\sqrt{\\ }$ → $+1$ → $\\div2$。',
      '負的 $z$：$\\Phi(-z)=1-\\Phi(z)$。答案容許 $\\pm0.006$（查表四捨五入或上面的近似都算對）。',
      '範例（$s=1\\,\\mathrm{fs}$、$\\sigma_v=100\\,\\mathrm{fs}$、$N=100$）：規格式 $53.18\\%$、連續性修正 $49.19\\%$；精確 Binomial 的嚴格值是 $49.205\\%$（勘誤 E02、測試 T05）。把 $N$ 改成 $101$ 再算一次。',
    ],
  },

  /* ───────────── HC-05.5：偶數 N 的 tie 機率與平衡點偏移 ───────────── */
  {
    id: 'HC-05.5',
    title: String.raw`偶數 $N$ 的平手：$P(S_N=0)$ 的 Stirling 近似，與它造成的平衡點偏移 $s^*$`,
    page: PAGE,
    formulaId: 'F-05.19',
    formulaTex: String.raw`P(S_N=0)=\binom{N}{N/2}\big(p(1-p)\big)^{N/2}\approx\sqrt{\frac{2}{\pi N}}\;e^{-Nm^2/2}\quad(N\text{ 偶數}),\qquad |s^*|\approx\frac{1}{N K_q},\quad K_q=\sqrt{\frac2\pi}\,\frac1{\sigma_v}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      { key: 'N', symbol: 'N', label: '累加的樣本數（偶數）', unit: String.raw`\text{samples}`, default: 100, min: 2, max: 100000, integer: true, practice: { choices: [10, 16, 50, 100, 400, 1000, 4096] } },
      inS({ min: 0, practice: { choices: [1, 2, 5, 1, 2, 0] } }),
      inSigma(),
    ],
    validate: ({ N, s, sigma }) => {
      if (!(sigma > 0)) return SIGMA_ZERO
      if (N % 2 !== 0) return String.raw`$N=${texI(N)}$ 是奇數：$S_N$ 與 $N$ 同奇偶，不可能等於 0，$P(S_N=0)=0$、$s^*=0$——沒有東西要算。請輸入偶數 $N$（這也是為什麼硬體用奇數 $N$ 最乾淨）。`
      if (N < HC05_LIMITS.nTieMin) return String.raw`Stirling 近似的相對誤差約 $1/(4N)$：$N=${texI(N)}<${HC05_LIMITS.nTieMin}$ 時超過 3%。小 $N$ 請用 HC-05.3 的精確式（例如 $N=2$ 時 $P(S_2=0)=2p(1-p)$）。`
      const r = s / sigma
      if (r > HC05_LIMITS.rTie) return String.raw`$r=s/\sigma_v=${texNum(r, 3)}>${HC05_LIMITS.rTie}$：指數 $e^{-Nm^2/2}$ 對 $m$ 的誤差很敏感，小訊號式 $m\approx\sqrt{2/\pi}\,r$ 不夠準。請縮小 $s$ 或加大 $\sigma_v$。`
      const arg = (N * (ROOT_2_OVER_PI * r) ** 2) / 2
      if (arg > HC05_LIMITS.tieExponentMax) {
        return String.raw`$Nm^2/2=${texNum(arg, 3)}>${HC05_LIMITS.tieExponentMax}$：平均 $Nm$ 已經離 0 超過 $2.4$ 個標準差，tie 機率小於 $\sqrt{2/(\pi N)}\,e^{-3}$、可以忽略；而且這時近似式的相對誤差會放大。請減小 $N$ 或 $s$。`
      }
      return null
    },
    solve: ({ N, s, sigma }) => {
      const piN = rd(PI_H * N, 6)
      const frac = rd(2 / piN)
      const tie0 = rd(Math.sqrt(frac))
      const r = rd(s / sigma)
      const mHand = rd(ROOT_H * r)
      const m2 = rd(mHand * mHand)
      const Nm2 = rd(N * m2)
      const arg = rd(Nm2 / 2)
      const fac = rd(Math.exp(-arg))
      const tieHand = rd(tie0 * fac)
      const K = rd(ROOT_H / sigma)
      const NK = rd(N * K)
      const shiftHand = rd(1 / NK)
      const p = pPlus(s, sigma)
      const m = meanQ(s, sigma)
      const d = directionExact(p, N)
      const stirling = tieProbStirling(m, N)
      const shiftExact = Math.abs(tieRuleEquilibrium(N, sigma, 'plus'))
      const shiftApprox = Math.abs(tieRuleEquilibriumApprox(N, sigma, 'plus'))
      const notes = [
        String.raw`精確值（模型 directionExact，逐項計算 $\binom{N}{N/2}$）：$P(S_N=0)=${texNum(d.tie, 5)}$；Stirling 近似（模型 tieProbStirling）$=${texNum(stirling, 5)}$，高估約 $1/(4N)=${texNum(1 / (4 * N), 2)}$。`,
        String.raw`平衡點偏移的精確值（模型 tieRuleEquilibrium，exact binomial 的二分法根）：$|s^*|=${texNum(shiftExact, 5)}\,${FS}$；近似 $1/(NK_q)=${texNum(shiftApprox, 5)}\,${FS}$。$\operatorname{sign}(0)=+1$ 時 $s^*<0$、$\operatorname{sign}(0)=-1$ 時 $s^*>0$；random tie-break、tie 不更新或奇數 $N$ 都是 0。`,
      ]
      if (s > 0) {
        const strict = directionOutcomeExact(p, N, 'strict').correct
        const half = directionOutcomeExact(p, N, 'half').correct
        const plus = directionOutcomeExact(p, N, 'plus').correct
        notes.push(
          String.raw`這份 tie 機率怎麼分，決定了判對率（精確）：strict $${texNum(strict, 4)}$、平分 $${texNum(half, 4)}$、$\operatorname{sign}(0)=+1$ $${texNum(plus, 4)}$——相鄰兩個剛好差 $\tfrac12P(S_N=0)=${texNum(d.tie / 2, 3)}$，這也是 CLT 規格式在偶數 $N$ 的誤差。`,
        )
      } else {
        notes.push('$s=0$：$m=0$，tie 機率最大（$e^{0}=1$）；這時沒有「正確方向」，但平衡點偏移 $s^*$ 仍然存在——它描述的正是迴路最後停在哪裡。')
      }
      if (shiftExact > 0 && s > 0 && shiftExact > 0.1 * s) notes.push(String.raw`$|s^*|$ 已經是 $s$ 的 $${texNum((100 * shiftExact) / s, 3)}\%$：只取 $\operatorname{sign}(S_N)$ 更新的迴路，光是 tie rule 就會帶來和想辨識的誤差同量級的偏差。`)
      return {
        steps: [
          { tex: String.raw`\pi N = ${tn(PI_H)}\times${texI(N)} = ${tn(piN)}`, why: '先算分母（$\\pi$ 抄 6 位）。' },
          { tex: String.raw`\frac{2}{\pi N} = \frac{2}{${tn(piN)}} = ${tn(frac)}`, why: 'Stirling：$\\binom{N}{N/2}\\approx2^N\\sqrt{2/(\\pi N)}$，而 $2^N$ 會和 $\\big(\\tfrac14\\big)^{N/2}$ 消掉。' },
          { tex: String.raw`\sqrt{\frac{2}{\pi N}} = \sqrt{${tn(frac)}} = ${tn(tie0)}`, why: '這是 $m=0$（公平硬幣）時的 tie 機率：隨 $1/\\sqrt N$ 變小，但 $N=100$ 時還有約 8%。' },
          { tex: String.raw`r = \frac{s}{\sigma_v} = \frac{${tn(s)}}{${tn(sigma)}} = ${tn(r)}`, why: '標準化誤差。' },
          { tex: String.raw`m \approx \sqrt{\tfrac2\pi}\;r = ${tn(ROOT_H)}\times${tn(r)} = ${tn(mHand)}`, why: '小訊號的平均輸出（$\\sqrt{2/\\pi}=0.79788$）。' },
          { tex: String.raw`m^2 = ${tnSq(mHand)} = ${tn(m2)}`, why: '先算平方。' },
          {
            tex: String.raw`\frac{N m^2}{2} = \frac{${texI(N)}\times${tn(m2)}}{2} = \frac{${tn(Nm2)}}{2} = ${tn(arg)}`,
            why: '指數的引數；來源是 $(1-m^2)^{N/2}\\approx e^{-Nm^2/2}$（$\\ln(1-m^2)\\approx-m^2$）。',
          },
          { tex: String.raw`e^{-Nm^2/2} = e^{-${tn(arg)}} = ${tn(fac)}`, why: '計算機按 $e^x$。引數 $x\\le0.1$ 時也可以用 $e^{-x}\\approx1-x$（誤差 $<x^2/2$）。' },
          { tex: String.raw`P(S_N=0) \approx ${tn(tie0)}\times${tn(fac)} = ${tn(tieHand)}`, why: '平均偏離 0 之後，剛好平手的機率再打這個折扣。' },
          { tex: String.raw`K_q = \sqrt{\tfrac2\pi}\,\frac{1}{\sigma_v} = \frac{${tn(ROOT_H)}}{${tn(sigma)}} = ${tn(K)}\ ${FS}^{-1}`, why: 'Comparator 的小訊號增益（§5）：$m\\approx K_qs$。' },
          { tex: String.raw`N K_q = ${texI(N)}\times${tn(K)} = ${tn(NK)}\ ${FS}^{-1}`, why: '$E[S_N]=Nm\\approx NK_q\\,s$：誤差每 $1\\,\\mathrm{fs}$ 讓 $S_N$ 的平均移動多少。' },
          {
            tex: String.raw`|s^*| \approx \frac{1}{N K_q} = \frac{1}{${tn(NK)}} = ${tn(shiftHand)}\ ${FS}`,
            why: '確定性的 tie rule 把決策門檻偏了半格（$S_N$ 的格點間距是 2，半格是 1）：迴路要靠 $N m^*=\\mp1$ 才能抵銷，換算成誤差就是 $1/(NK_q)$（§3.4）。',
          },
        ],
        results: [
          { symbol: 'P(S_N=0)', label: '平手（tie）的機率', value: d.tie, digits: 5, tolerance: { rel: 0.05, abs: 1e-12 } },
          { symbol: '|s^*|', label: '判號式迴路的平衡點偏移（確定性 tie rule）', value: shiftExact, unit: FS, digits: 5, tolerance: { rel: 0.05, abs: 1e-12 } },
        ],
        notes,
      }
    },
    tips: [
      '$\\sqrt{2/(\\pi N)}$ 的捷徑：它等於 $0.79788/\\sqrt N$（$N=100$ 時就是 $0.079788$）。',
      '適用範圍：$N\\ge10$（Stirling 誤差約 $1/(4N)$）、$s/\\sigma_v\\le0.1$、$Nm^2/2\\le3$。小 $N$ 用 HC-05.3 的精確式。',
      '$s^*$ 只和 $N$、$\\sigma_v$ 有關，和 $s$ 無關：$|s^*|\\approx(\\sigma_v/N)\\sqrt{\\pi/2}=1.2533\\,\\sigma_v/N$。',
      '答案容許 5%：Stirling 與 $1/(NK_q)$ 都是近似，$N=10$ 時和精確值差約 3%。',
      '範例（$N=100$、$s=1\\,\\mathrm{fs}$、$\\sigma_v=100\\,\\mathrm{fs}$）：精確 $P(S_N=0)=7.934\\%$、Stirling $7.953\\%$；$|s^*|\\approx1.25\\,\\mathrm{fs}$——比想辨識的 $1\\,\\mathrm{fs}$ 還大。',
    ],
  },

  /* ───────────── HC-05.6：要累加幾次 ───────────── */
  {
    id: 'HC-05.6',
    title: String.raw`要累加幾次？由目標正確率反解 $N$`,
    page: PAGE,
    formulaId: 'F-05.9',
    formulaTex: String.raw`N=\frac{z^2(1-m^2)}{m^2}\approx\left(\frac{z\,\sigma_v}{s}\right)^2\frac{\pi}{2},\qquad z=\Phi^{-1}(P_{\text{target}})`,
    level: 'research',
    claim: 'approx',
    inputs: [
      inS({ practice: { choices: [0.5, 1, 2, 5, 10] } }),
      inSigma(),
      { key: 'P', symbol: String.raw`P_{\text{target}}`, label: '目標正確率（0.5 到 1 之間）', default: 0.95, min: 0.5, max: 1, practice: { choices: [0.9, 0.95, 0.975, 0.99, 0.999] } },
    ],
    validate: ({ s, sigma, P }) => {
      if (!(sigma > 0)) return SIGMA_ZERO
      if (s === 0) return '$s=0$：沒有方向可以辨識（$m=0$），不管累加幾次正確率都是 50%，$N\\to\\infty$。請輸入非零的 $s$。'
      if (!(P > 0.5)) return '$P_{\\text{target}}=0.5$ 不需要任何樣本（擲硬幣就有 50%）；請輸入大於 0.5 的目標。'
      if (!(P < 1)) return String.raw`$P_{\text{target}}=1$：要 100% 確定需要 $z=\Phi^{-1}(1)=\infty$，也就是無限多個樣本——雜訊是 Gaussian，再多樣本也只能逼近 1。請輸入小於 1 的目標（例如 $0.999$）。`
      if (P > HC05_LIMITS.pTargetMax) {
        return String.raw`$P_{\text{target}}>${HC05_LIMITS.pTargetMax}$（$z>4.75$）超出一般常態表與手算近似的範圍，$1-P_{\text{target}}$ 也已小到要抄很多位才不失真。請輸入 $\le${HC05_LIMITS.pTargetMax}$ 的目標。`
      }
      const r = Math.abs(s) / sigma
      if (r > HC05_LIMITS.rSamples) {
        return String.raw`$|s|/\sigma_v=${texNum(r, 3)}>${HC05_LIMITS.rSamples}$：小訊號式 $(z\sigma_v/s)^2\pi/2$ 會高估 $N$ 超過 2%（S 曲線開始飽和），請改用第一式 $z^2(1-m^2)/m^2$ 配合查表的 $m=2\Phi(r)-1$，或直接用 §4 的樣本數計算器。`
      }
      const n = samplesSmallSignal(r, P)
      if (n < HC05_LIMITS.nCltMin) {
        return String.raw`算出來 $N\approx${texNum(n, 3)}<${HC05_LIMITS.nCltMin}$：這麼小的 $N$ 不能用 CLT（常態近似）反解，請提高目標正確率，或用 HC-05.3 的精確 Binomial。`
      }
      return null
    },
    solve: ({ s, sigma, P }) => {
      const a = Math.abs(s)
      // z 還要平方：多抄一位（6 位有效數字）；(zσ/s)² 與 N 抄 7 位，最後才取整數
      const z = rd(normInv(P), 6)
      const ratio = rd(sigma / a)
      const zr = rd(z * ratio, 6)
      const sq = rd(zr * zr, 7)
      const nHand = rd(sq * HALF_PI_H, 7)
      const nCeil = Math.ceil(nHand)
      const nOdd = nextOdd(nHand)
      const r = a / sigma
      const m = Math.abs(meanQ(s, sigma))
      const nClt = samplesForConfidence(m, P)
      const nSmall = samplesSmallSignal(r, P)
      const nExact = nClt < 5e7 ? minNForTarget(pPlus(a, sigma), P, 'odd') : null
      const notes = [
        String.raw`CLT 連續解（模型 samplesForConfidence，用精確的 $m=\operatorname{erf}(r/\sqrt2)=${texNum(m, 6)}$）：$N=${texNum(nClt, 8)}$；小訊號式（模型 samplesSmallSignal）$=${texNum(nSmall, 8)}$，只差 $${texNum(nSmall - nClt, 2)}$ 個樣本（相對 $${texNum(nSmall / nClt - 1, 2)}$）。`,
        nExact === null
          ? '精確門檻（exact binomial 的最小奇數 $N$）太大，這裡不逐項計算；CLT 的值已經很準。'
          : String.raw`精確門檻（模型 minNForTarget：讓 exact binomial 的 $P(S_N>0)\ge P_{\text{target}}$ 的最小奇數 $N$）$=${texI(nExact)}$。手算的 $z$ 只有幾位有效數字，$N$ 的最後一兩位本來就不可靠：重點是量級與「取奇數」這個動作。`,
        String.raw`1-bit 的代價：直接平均類比誤差只要 $(z\sigma_v/s)^2\approx${texI(sq)}$ 個樣本，1-bit 要多 $\pi/2-1\approx${texNum(100 * (Math.PI / 2 - 1), 3)}\%$（$10\log_{10}(\pi/2)\approx${texNum(10 * Math.log10(Math.PI / 2), 3)}\,\mathrm{dB}$ 的 SNR 損失）。`,
        '縮放律 $N\\propto(\\sigma_v/s)^2$：$s$ 減半或 $\\sigma_v$ 加倍，$N$ 都變 4 倍。',
      ]
      return {
        steps: [
          {
            tex: String.raw`z = \Phi^{-1}(P_{\text{target}}) = \Phi^{-1}(${tn(P)}) = ${tn(z)}`,
            why: `反查常態表：找出 $\\Phi(z)$ 等於目標正確率的 $z$（常用值在下面的手算提示）。意思是「平均要離決策門檻幾個標準差」。$z$ 還要平方，所以這裡多抄一位；只查得到三位小數也可以，$N$ 只會差不到 $0.1\\%$。${zHow(P)}`,
          },
          { tex: String.raw`\frac{\sigma_v}{|s|} = \frac{${tn(sigma)}}{${tn(a)}} = ${tn(ratio)}`, why: '雜訊是誤差的幾倍（$=1/r$）。' },
          { tex: String.raw`\frac{z\sigma_v}{|s|} = ${tn(z)}\times${tn(ratio)} = ${tn(zr)}`, why: '一次乘法。' },
          {
            tex: String.raw`\left(\frac{z\sigma_v}{s}\right)^2 = ${tnSq(zr)} = ${tn(sq)}`,
            why: '平方。這個數本身就是「直接平均類比誤差 $e$」所需的樣本數。',
          },
          {
            tex: String.raw`N \approx \left(\frac{z\sigma_v}{s}\right)^2\frac{\pi}{2} = ${tn(sq)}\times${tn(HALF_PI_H)} = ${tn(nHand)}`,
            why: '乘上 $\\pi/2=1.5708$：1-bit 量化的代價（來自 $m^2\\approx(2/\\pi)\\,r^2$）。',
          },
          {
            tex: String.raw`\lceil N\rceil = \lceil ${tn(nHand)}\rceil = ${texI(nCeil)}\quad\Rightarrow\quad N_{\text{odd}} = ${nCeil % 2 === 0 ? `${texI(nCeil)}+1 = ` : ''}${texI(nOdd)}`,
            why: '$N$ 要是整數：先無條件進位，若是偶數再加 1 變成奇數，就沒有 tie 的問題（勘誤 E02）。',
          },
        ],
        results: [
          { symbol: 'z', label: '目標正確率對應的 z', value: normInv(P), digits: 5, tolerance: { abs: 0.006, rel: 0 } },
          { symbol: 'N', label: '所需樣本數（CLT 連續解）', value: nClt, unit: String.raw`\text{samples}`, digits: 6, tolerance: { rel: 0.03, abs: 1e-9 } },
        ],
        notes,
      }
    },
    tips: [
      Z_TABLE_TIP,
      '沒有反查表時（$0.5<P<1$）：$t=\\sqrt{-2\\ln(1-P)}$，$z\\approx t-\\dfrac{2.30753+0.27061\\,t}{1+0.99229\\,t+0.04481\\,t^2}$，誤差 $<0.003$（Abramowitz–Stegun 26.2.22；$P\\ge0.9$ 時換算成 $N$ 的誤差 $<0.5\\%$）。按法：$1-P$ → $\\ln$ → $\\times(-2)$ → $\\sqrt{\\ }$ 得 $t$；分子、分母各自算完再相除，最後用 $t$ 去減。',
      '答案容許 3%：$z$ 取到小數第二位、或最後四捨五入成整數／奇數都算對。',
      '適用範圍：$|s|/\\sigma_v\\le0.25$（小訊號，也正是校正收斂後的工作區）。',
      '範例（$s=1\\,\\mathrm{fs}$、$\\sigma_v=100\\,\\mathrm{fs}$、95%）：$(1.6449\\times100)^2\\times1.5708\\approx4.25\\times10^{4}$，就是規格說的「約 42,500 次」；模型的 CLT 連續解是 $42{,}497.3$、精確的最小奇數 $N$ 是 $42{,}499$（測試 T05）。',
    ],
  },

  /* ───────────── HC-05.7：小訊號增益 K_q ───────────── */
  {
    id: 'HC-05.7',
    title: String.raw`小訊號增益 $K_q$：線性預測、高估多少、局部斜率剩多少`,
    page: PAGE,
    formulaId: 'F-05.10',
    formulaTex: String.raw`K_q=\sqrt{\frac{2}{\pi}}\,\frac{1}{\sigma_v},\qquad E[q]\approx K_q\,s,\qquad \frac{K_qs-E[q]}{E[q]}\approx\frac{r^2}{6},\qquad \frac{dE[q]}{ds}=K_q\,e^{-r^2/2},\qquad r=\frac{s}{\sigma_v}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [inSigma({ practice: { choices: [50, 100, 200, 400] } }), inS({ practice: { choices: [1, 5, 10, 25, 50, 100] } })],
    validate: ({ sigma, s }) => {
      if (!(sigma > 0)) return SIGMA_ZERO
      const r = Math.abs(s) / sigma
      if (r > HC05_LIMITS.rLinear) {
        return String.raw`$|r|=|s|/\sigma_v=${texNum(r, 3)}>${HC05_LIMITS.rLinear}$：S 曲線已經飽和（$|E[q]|>0.95$），comparator 只告訴你方向、不告訴你大小，「線性化」和 $r^2/6$ 都沒有意義（更新變成 slew-limited）。請輸入 $|s|\le2\sigma_v$。`
      }
      return null
    },
    solve: ({ sigma, s }) => {
      const K = rd(ROOT_H / sigma)
      const lin = rd(K * s)
      const r = rd(s / sigma)
      const r2 = rd(r * r)
      const over = rd(r2 / 6)
      const halfR2 = rd(r2 / 2)
      const ratio = rd(Math.exp(-halfR2))
      const rTrue = s / sigma
      const m = meanQ(s, sigma)
      const linErr = linearizationRelError(rTrue)
      const slopeRatio = kqLocal(s, sigma) / kq(sigma)
      const notes = [
        String.raw`精確的平均輸出（模型 meanQ）：$E[q]=\operatorname{erf}(r/\sqrt2)=${texNum(m, 6)}$；線性預測 $K_qs=${texNum(kq(sigma) * s, 6)}$ 高估 $${texNum(linErr, 3)}$（模型 linearizationRelError），手算的 $r^2/6=${texNum(over, 3)}$。`,
      ]
      if (Math.abs(rTrue) > 0.25) notes.push('$|r|>0.25$：線性化高估超過 1%。用 $K_q$ 算出來的 loop gain 偏大、收斂時間會被低估（Ch14 的 coarse calibration 要另外估）。')
      else notes.push('$|r|\\le0.25$：線性化高估不到 1%，把 comparator 當成增益 $K_q$ 是好近似——這正是校正收斂後的工作區。')
      return {
        steps: [
          { tex: String.raw`\frac{2}{\pi} = \frac{2}{${tn(PI_H)}} = ${tn(TWO_OVER_PI_H)}`, why: '常數的第一步（與輸入無關；$\\pi$ 抄 6 位）。' },
          { tex: String.raw`\sqrt{\frac{2}{\pi}} = \sqrt{${tn(TWO_OVER_PI_H)}} = ${tn(ROOT_H)}`, why: '開根號；這個 $0.79788$ 值得背起來，它也等於 $2\\varphi(0)$。' },
          {
            tex: String.raw`K_q = \sqrt{\tfrac{2}{\pi}}\,\frac{1}{\sigma_v} = \frac{${tn(ROOT_H)}}{${tn(sigma)}} = ${tn(K)}\ ${FS}^{-1}`,
            why: '$E[q]$ 對 $s$ 在原點的斜率 $dE[q]/ds=2\\varphi(0)/\\sigma_v$：雜訊越大，S 曲線越平、增益越小。',
          },
          { tex: String.raw`K_q\,s = ${tn(K)}\times${tnP(s)} = ${tn(lin)}`, why: '線性（小訊號）預測的平均輸出 $E[q]$（$\\mathrm{fs}^{-1}\\times\\mathrm{fs}$，無因次）。' },
          { tex: String.raw`r = \frac{s}{\sigma_v} = \frac{${tn(s)}}{${tn(sigma)}} = ${tn(r)}`, why: '標準化誤差：線性化準不準只看它。' },
          { tex: String.raw`r^2 = ${tnSq(r)} = ${tn(r2)}`, why: '先算平方。' },
          { tex: String.raw`\frac{r^2}{6} = \frac{${tn(r2)}}{6} = ${tn(over)}`, why: '線性預測高估的比例：來自 $\\operatorname{erf}$ 泰勒展開的三次項。' },
          { tex: String.raw`\frac{r^2}{2} = \frac{${tn(r2)}}{2} = ${tn(halfR2)}`, why: '局部斜率的指數引數。' },
          {
            tex: String.raw`\frac{dE[q]/ds}{K_q} = e^{-r^2/2} = e^{-${tn(halfR2)}} = ${tn(ratio)}`,
            why: '計算機按 $e^x$：操作點的局部斜率還剩原點的幾成。$|r|$ 越大越小——S 曲線飽和。',
          },
        ],
        results: [
          { symbol: 'K_q', label: 'Comparator 小訊號統計增益', value: kq(sigma), unit: String.raw`${FS}^{-1}`, tolerance: { rel: 0.005, abs: 1e-12 } },
          { symbol: 'K_q\\,s', label: '線性預測的平均輸出', value: kq(sigma) * s, tolerance: { rel: 0.005, abs: 1e-12 } },
          { symbol: String.raw`\tfrac{K_qs-E[q]}{E[q]}`, label: '線性化高估的比例', value: linErr, digits: 4, tolerance: { rel: 0.03, abs: 1e-12 } },
          { symbol: String.raw`e^{-r^2/2}`, label: '局部斜率還剩原點斜率的比例', value: slopeRatio, digits: 5, tolerance: { rel: 0.005, abs: 1e-12 } },
        ],
        notes,
      }
    },
    tips: [
      '$K_q$ 的單位是 $\\mathrm{fs}^{-1}$（$\\sigma_v$ 單位的倒數）；$K_qs$ 無因次。',
      '$r^2/6$ 的適用範圍：$|r|\\le2$ 時與精確值相差不到 2%；高估 1% 發生在 $r\\approx\\sqrt{0.06}=0.245$。',
      '$e^{-r^2/2}$ 怎麼按：輸入 $r^2/2$ → 變號 → $e^x$。$r^2/2\\le0.01$ 時也可以用 $1-r^2/2$（誤差 $<5\\times10^{-5}$）。',
      '範例（$\\sigma_v=100\\,\\mathrm{fs}$、$s=1\\,\\mathrm{fs}$）：$K_q=0.00797885\\,\\mathrm{fs}^{-1}$（測試 T04）；把 $s$ 改成 $50$、$100$、$200\\,\\mathrm{fs}$，看高估量和斜率怎麼變。',
    ],
  },

  /* ───────────── HC-05.8：綜合題（放在思考題之前） ───────────── */
  {
    id: 'HC-05.8',
    title: String.raw`綜合題：從 $\sigma_v$ 到校正迴路——穩定上限、pole、收斂時間與 $\sigma_w$`,
    page: PAGE,
    formulaId: 'F-05.20',
    formulaTex: String.raw`K_q=\sqrt{\tfrac2\pi}\,\frac1{\sigma_v},\qquad 0<\mu<\mu_{\max}=\frac{2}{K_q},\qquad g=\mu K_q,\quad p_{\mathrm{cal}}=1-g,\qquad \tau=\frac{-1}{\ln|p_{\mathrm{cal}}|},\qquad \sigma_w=\frac{\mu}{\sqrt{N\,(1-p_{\mathrm{cal}}^2)}}`,
    level: 'engineer',
    claim: 'approx',
    inputs: [
      inSigma(),
      { key: 'mu', symbol: String.raw`\mu`, label: '學習率（每個 block 的步長）', unit: FS, default: 10, min: 0, max: 100000, practice: { choices: [2, 5, 10, 20, 50] } },
      { key: 'N', symbol: 'N', label: '每個 GMAC block 的樣本數', unit: String.raw`\text{samples}`, default: 4096, min: 1, max: 1e8, integer: true, practice: { choices: [1024, 4096, 10000, 16384] } },
      { key: 'fs', symbol: 'f_s', label: 'comparator 取樣率', unit: String.raw`\mathrm{GHz}`, default: 4, min: 0, max: 1000, practice: { choices: [1, 2, 4, 8] } },
    ],
    validate: ({ sigma, mu, fs }) => {
      if (!(sigma > 0)) return SIGMA_ZERO
      if (!(mu > 0)) return '$\\mu$ 必須大於 0：$\\mu=0$ 時係數不更新（$p_{\\mathrm{cal}}=1$，誤差永遠不衰減）。'
      if (!(fs > 0)) return '$f_s$ 必須大於 0，才能把 block 數換成時間。'
      const L = blockLoopLinear(mu, sigma, 1)
      if (!(L.g < 2)) {
        return String.raw`$g=\mu K_q=${texNum(L.g, 4)}\ge2$：$|p_{\mathrm{cal}}|=|1-g|\ge1$，每個 block 都修正過頭、而且越跳越遠（線性模型發散）。$\mu$ 必須小於 $\mu_{\max}=2/K_q=${texNum(L.muMax, 5)}\,${FS}$。`
      }
      if (L.g < HC05_LIMITS.gMin) {
        return String.raw`$g=\mu K_q=${texNum(L.g, 3)}<10^{-8}$：$p_{\mathrm{cal}}=1-g$ 在一般 10 位數的計算機上已經和 $1$ 分不出來，$\ln|p_{\mathrm{cal}}|$ 按不出來。這麼小的 $g$ 直接用 $\tau\approx1/g=${texNum(1 / L.g, 3)}$ blocks、$\sigma_w\approx\mu/\sqrt{2gN}$ 就夠準；要走完整步驟請把 $\mu$ 加大。`
      }
      if (L.g > HC05_LIMITS.gMax) {
        return String.raw`$g=\mu K_q=${texNum(L.g, 5)}$ 離穩定邊界 $g=2$ 不到 1%：$1-|p_{\mathrm{cal}}|=2-g=${texNum(2 - L.g, 3)}$ 是兩個幾乎相等的數相減，$K_q$ 只抄 5 位有效數字時 $\tau$ 與 $\sigma_w$ 會差到好幾個百分點；而且這麼貼近邊界的迴路沒有任何 margin（$\sigma_v$ 再小一點就發散）。請把 $\mu$ 降到 $${texNum(Math.floor(HC05_LIMITS.gMax * L.muMax * 50) / 100, 6)}\,${FS}$（$g=${HC05_LIMITS.gMax}$）以下。`
      }
      if (Math.abs(L.pole) < HC05_LIMITS.poleMin) {
        return String.raw`$g=\mu K_q=${texNum(L.g, 6)}$ 幾乎剛好是 1（deadbeat）：$p_{\mathrm{cal}}=1-g\approx0$，線性模型一個 block 就把誤差修完。這時 $\tau=-1/\ln|p_{\mathrm{cal}}|$ 對 $p_{\mathrm{cal}}$ 的最後一位極度敏感（$\ln$ 在 $0$ 附近發散），5 位有效數字的手算沒有意義。請把 $\mu$ 調開至少 $1\%$（$1/K_q=${texNum(L.muMax / 2, 5)}\,${FS}$）。`
      }
      return null
    },
    solve: ({ sigma, mu, N, fs }) => {
      const K = rd(ROOT_H / sigma)
      const muMax = rd(2 / K)
      const g = rd(mu * K)
      const pole = add(1, -g)
      const absP = Math.abs(pole)
      const lnP = rd(Math.log(absP))
      const tau = pole === 0 ? 0 : rd(-1 / lnP)
      const blkNs = rd(N / fs, 8) // N ÷ f_s[GHz] = ns
      const blkUs = exact(blkNs / 1000)
      const tauUs = rd(tau * blkUs)
      // p_cal → ±1 時 1 − p_cal² 會抵銷：p_cal² 多抄幾位，讓差仍有 5 位有效數字
      const p2 = rd(pole * pole, sigBeforeOneMinus(pole * pole))
      const oneMinus = add(1, -p2)
      const den = rd(N * oneMinus)
      const root = rd(Math.sqrt(den))
      const swHand = rd(mu / root)
      const L = blockLoopLinear(mu, sigma, N, fs * 1e9)
      const sumDiverges = N * L.g >= 2 // GMAC 輸出總和卻沿用同一個 μ 時的 loop gain
      const notes = [
        String.raw`模型（blockLoopLinear）：$g=${texNum(L.g, 6)}$、$p_{\mathrm{cal}}=${texNum(L.pole, 6)}$、$\tau=${texNum(L.tau, 6)}$ blocks、$\sigma_w=${texNum(L.sigmaW, 6)}\,${FS}$。${L.g <= 0.3 ? String.raw`心算版 $\tau\approx1/g=${texNum(1 / L.g, 4)}$ blocks，比精確值多約半個 block。` : ''}`,
        String.raw`這個 $\sigma_w$ 是「係數」的穩態抖動（gain-equivalent，單位 fs），不是輸出 jitter；它怎麼變成 phase noise 留到 Ch12。`,
        String.raw`若 GMAC 輸出的是總和 $S_N$（沒有除以 $N$）卻沿用同一個 $\mu$：loop gain 變成 $N\mu K_q=${texNum(N * L.g, 4)}${sumDiverges ? String.raw`\ge2` : ''}$${sumDiverges ? '，直接發散' : ''}（勘誤 E18：sum 與 average 差 $N$ 倍）。`,
        String.raw`若更新晚一個 block 才生效，穩定範圍從 $0<g<2$ 縮成 $0<g<1$，也就是 $\mu<1/K_q=${texNum(L.muMax / 2, 5)}\,${FS}$（Ch08）。`,
      ]
      if (pole < 0) notes.push('$g>1$：$p_{\\mathrm{cal}}<0$，誤差每個 block 變號——正負交替地衰減。')
      if (N === 1) notes.push('$N=1$：每個 comparator sample 都更新，就是 §7 逐 sample 的 Sign-LMS（F-05.15）：$\\sigma_w^2=\\mu/(K_q(2-\\mu K_q))$。')
      return {
        steps: [
          {
            tex: String.raw`K_q = \sqrt{\tfrac2\pi}\,\frac{1}{\sigma_v} = \frac{${tn(ROOT_H)}}{${tn(sigma)}} = ${tn(K)}\ ${FS}^{-1}`,
            why: 'Comparator 的小訊號增益（§5、HC-05.7）：迴路「看到」的誤差要先乘上它。',
          },
          {
            tex: String.raw`\mu_{\max} = \frac{2}{K_q} = \frac{2}{${tn(K)}} = ${tn(muMax)}\ ${FS}`,
            why: '穩定條件 $|p_{\\mathrm{cal}}|<1\\iff0<\\mu K_q<2$：$\\mu$ 的上限正比於 $\\sigma_v$。',
          },
          { tex: String.raw`g = \mu\,K_q = ${tn(mu)}\times${tn(K)} = ${tn(g)}`, why: '無因次的 loop gain（本章 $x\\equiv1$，所以 $C=1$）：每個 block 修掉誤差的比例。' },
          { tex: String.raw`p_{\mathrm{cal}} = 1-g = 1-${tn(g)} = ${tn(pole)}`, why: 'Pole：$\\delta_{k+1}=p_{\\mathrm{cal}}\\,\\delta_k-\\mu\\eta_k$，剩餘誤差 $\\delta=a-w$ 每個 block 乘上它。減法是精確的，每一位都留著。' },
          {
            tex: String.raw`\ln|p_{\mathrm{cal}}| = \ln ${tnArg(absP)} = ${tn(lnP)}`,
            why: '計算機按 $\\ln$。$g\\ll1$ 時 $\\ln(1-g)\\approx-g$，所以 $\\tau\\approx1/g$。',
          },
          {
            tex: String.raw`\tau = \frac{-1}{\ln|p_{\mathrm{cal}}|} = \frac{-1}{${tn(lnP)}} = ${tn(tau)}\ \text{blocks}`,
            why: '時間常數：誤差衰減到 $1/e\\approx37\\%$ 需要的 block 數（$|p_{\\mathrm{cal}}|^{\\tau}=e^{-1}$）。',
          },
          {
            tex: String.raw`T_{\mathrm{blk}} = \frac{N}{f_s} = \frac{${texI(N)}}{${tn(fs)}\ \mathrm{GHz}} = ${tn(blkNs)}\ \mathrm{ns} = ${tn(blkUs)}\ \mu\mathrm{s}`,
            why: '一個 block 的時間：樣本數除以取樣率（除以 GHz 得到 ns，再除以 1000 得 $\\mu\\mathrm{s}$）。',
          },
          {
            tex: String.raw`t_\tau = \tau\,T_{\mathrm{blk}} = ${tn(tau)}\times${tn(blkUs)} = ${tn(tauUs)}\ \mu\mathrm{s}`,
            why: '把時間常數換成實際時間；收斂到 5% 大約要 $3\\tau$。',
          },
          {
            tex: String.raw`p_{\mathrm{cal}}^2 = ${tnSq(pole)} = ${tn(p2)}`,
            why: `開始算係數雜訊：先算 pole 的平方。${sigDigits(p2) > 5 ? '下一步要拿 1 去減它，所以多抄幾位，相減後才還有 5 位有效數字。' : ''}`,
          },
          { tex: String.raw`1-p_{\mathrm{cal}}^2 \\ = 1-${tn(p2)} = ${tn(oneMinus)}`, why: '$=g\\,(2-g)$：迴路對雜訊的「平均能力」。' },
          {
            tex: String.raw`N\,(1-p_{\mathrm{cal}}^2) = ${texI(N)}\times${tn(oneMinus)} = ${tn(den)}`,
            why: '每個 block 的 GMAC 雜訊 $\\operatorname{Var}(G)=(1-m^2)/N\\approx1/N$（§3 的「平均」變異數）。',
          },
          { tex: String.raw`\sqrt{N\,(1-p_{\mathrm{cal}}^2)} = \sqrt{${tn(den)}} = ${tn(root)}`, why: '開根號。' },
          {
            tex: String.raw`\sigma_w = \frac{\mu}{\sqrt{N\,(1-p_{\mathrm{cal}}^2)}} = \frac{${tn(mu)}}{${tn(root)}} = ${tn(swHand)}\ ${FS}`,
            why: '穩態時 $\\sigma_w^2=p_{\\mathrm{cal}}^2\\sigma_w^2+\\mu^2/N$ 解出來的係數 RMS：$\\mu$ 越大收斂越快，但抖動也越大。',
          },
        ],
        results: [
          { symbol: String.raw`\mu_{\max}`, label: '穩定上限', value: L.muMax, unit: FS },
          { symbol: String.raw`p_{\mathrm{cal}}`, label: '校正迴路的 pole', value: L.pole, tolerance: { abs: 0.002, rel: 0 } },
          { symbol: String.raw`\tau`, label: '時間常數', value: L.tau, unit: String.raw`\text{blocks}`, tolerance: { rel: 0.02, abs: 1e-9 } },
          { symbol: String.raw`t_\tau`, label: '時間常數換成時間', value: L.tauSeconds * 1e6, unit: String.raw`\mu\mathrm{s}`, tolerance: { rel: 0.02, abs: 1e-12 } },
          { symbol: String.raw`\sigma_w`, label: '係數的穩態 RMS', value: L.sigmaW, unit: FS },
        ],
        notes,
      }
    },
    tips: [
      '先估再算：$K_q\\approx0.8/\\sigma_v$、$\\mu_{\\max}\\approx2.5\\,\\sigma_v$、$\\tau\\approx1/g$、$\\sigma_w\\approx\\mu/\\sqrt{2gN}$（$g\\ll1$）。',
      '$\\ln$ 怎麼按：輸入 $|p_{\\mathrm{cal}}|$ 後按 $\\ln$；$g\\le0.1$ 時 $\\ln(1-g)\\approx-g-g^2/2$（誤差 $<g^3/2$）。',
      '$p_{\\mathrm{cal}}$ 的答案要寫到小數第三位以上（容許 $\\pm0.002$）：$0.92$ 和 $0.93$ 的 $\\tau$ 就差了 15%。',
      '適用範圍：$0<g\\le1.98$，而且 $g$ 不要剛好等於 1（$|p_{\\mathrm{cal}}|\\ge0.002$）——太靠近 $g=2$ 或 $g=1$ 時，5 位有效數字的手算不夠用。',
      '範例（$\\sigma_v=100\\,\\mathrm{fs}$、$\\mu=10\\,\\mathrm{fs}$、$N=4096$）：$p_{\\mathrm{cal}}=0.92021$、$\\sigma_w=0.3992\\,\\mathrm{fs}$（測試 T13）；$f_s=4\\,\\mathrm{GHz}$ 時一個 block 是 $1.024\\,\\mu\\mathrm{s}$。',
    ],
  },
]
