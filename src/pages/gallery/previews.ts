/**
 * Gallery 的「即時預覽」：把 preset 的 params 直接交給網站真正的模型函式（src/simulation/models/*）重算，
 * 回傳關鍵數字、代入數字的逐步推導、一張小圖與判定。這裡沒有任何手打的結果——每個數字都由下列函式算出：
 *   lms.runScalarLms / fixedXPole、comparator.*、polarity.tonePath / toneCorrelation / calPole、filteredX.analyzeFxLab、
 *   stability.analyzeDualLoop / pmWithDelay / delayStable、pe.peAnalytic / gaugeAnalysis、mimo.analyzeMimo、
 *   bias.analyzeBias、calNoise.calLoop / simulateMixing、quantizer.makeGrid / simulateStrategy / lineSpectrum。
 *
 * 推導步驟（steps）上寫的公式必須就是算出那個數字的公式：模型在邊界情形換了公式（Ω = 0／π 的 2 倍相關、主迴路 DC null 的
 * Var(x) 分母、colored η 的修正因子、無雜訊 Sign-LMS 的 dead zone…）時，步驟要跟著換；不存在的量（|p| ≥ 1 的 σ_w、
 * 沒有 gain crossover 的 PM、σ_v = 0 的 K_q）用文字說明原因，不顯示 NaN。previews.test.ts 逐項檢查。
 *
 * 只做主執行緒負擔得起的計算（封閉式、短的確定性模擬）：§19.2 的 12 個 preset 各 < 約 20 ms；
 * 最慢的是 Type-II 路徑 + 寬頻／DSM code 的 delay-fx-lab（analyzeFxLab 要濾一段 code 序列），約 0.1 s。
 * Monte Carlo、長時間閉迴路與 PSD 一律留在原頁面（「載入並執行」）。純函式、不 import React；
 * 文字中的 $…$ 由 UI 以 KaTeX 顯示。
 */
import type { ClaimKind, ModelLevelId, PresetEntry } from '@/data/types'
import { cAbs, cArg, eigvals, matVec, type Complex, type Matrix } from '@/simulation/core'
import { lfilter } from '@/simulation/signal'
import { classifyPole, fixedXMuMax, fixedXPole, runScalarLms, type PoleBehaviour } from '@/simulation/models/lms'
import {
  applyTieRule,
  directionCltPlain,
  directionExact,
  directionOutcomeExact,
  kq,
  linearizationRelError,
  meanQ,
  minNForTarget,
  pPlus,
  samplesForConfidence,
  sumMoments,
  type TieRule,
} from '@/simulation/models/comparator'
import {
  calPole,
  classifyPolarity,
  DEFAULT_POLARITY_PARAMS,
  empiricalLargeErrorGain,
  kqFromSigma,
  polarityMarginDeg,
  stableMuRange,
  toneCorrelation,
  toneLargeErrorGain,
  tonePath,
  type PolarityParams,
} from '@/simulation/models/polarity'
import { analyzeFxLab, type FxCodeSpec, type FxHatSpec, type FxPathSpec, type RegressorMode } from '@/simulation/models/filteredX'
import {
  analyzeDualLoop,
  analyzeGeneral,
  delayCriticalGain,
  delayStable,
  pmWithDelay,
  simulateDelayRecursion,
  simulateFullModel,
  simulateGeneral,
  simulateQuasiStatic,
} from '@/simulation/models/stability'
import { comparatorKq, corr2, gaugeAnalysis, meanTrajectory, peAnalytic, type Detector, type RegressorDist } from '@/simulation/models/pe'
import { analyzeMimo, DEFAULT_RULE, type JhatSource, type MimoRule, type RuleConfig } from '@/simulation/models/mimo'
import { analyzeBias, type BiasAlgorithm, type CodeDistKind, type DcNullMode } from '@/simulation/models/bias'
import { calLoop, mixingCrossCheck, REGIME_LABEL, simulateMixing, swDtft, zohGain, type GmMode } from '@/simulation/models/calNoise'
import {
  bernoulliMoments,
  isRotation,
  lineSpectrum,
  makeCtx,
  makeGrid,
  simulateStrategy,
  STRATEGIES,
  STRATEGY_LABEL,
  toggleCycle,
  type Arithmetic,
  type DitherPdf,
  type OverflowMode,
  type QuantStrategy,
  type QuantizerSetup,
  type RandomSource,
  type RoundingMode,
  type ToggleOrder,
} from '@/simulation/models/quantizer'
import type { DsmKind } from '@/simulation/models/dsm'
import { texArg, texNum } from './format'

/* ───────────────────────── 型別 ───────────────────────── */

export interface PreviewMetric {
  /** 穩定 key（測試與「預期文字比對」用） */
  key: string
  /** TeX 標籤 */
  label: string
  value: number | string
  /** TeX 單位 */
  unit?: string
  /** 有效位數（預設 6） */
  sig?: number
  claim: ClaimKind
  /** 說明（$…$ 為 TeX） */
  note?: string
}

export interface PreviewStep {
  /** 一行等式（TeX） */
  tex: string
  /** 為什麼可以這樣做（$…$ 為 TeX） */
  why: string
}

export interface PreviewSeries {
  name: string
  x: number[]
  y: number[]
  mode?: 'lines' | 'markers' | 'lines+markers'
}

export interface PreviewChart {
  title: string
  xLabel: string
  yLabel: string
  series: PreviewSeries[]
  yLog?: boolean
  /** 水平參考線 */
  hLines?: { y: number; name: string }[]
}

export interface PreviewTable {
  caption: string
  /** 欄名（$…$ 為 TeX） */
  head: string[]
  /** 每格：數字以 TeX 顯示；字串可含 $…$ */
  rows: (number | string)[][]
}

export interface Verdict {
  kind: 'ok' | 'info' | 'warn' | 'danger'
  /** $…$ 為 TeX */
  text: string
}

export interface PreviewResult {
  experiment: string
  /** 這次預覽實際呼叫的模型函式（「模組.函式」） */
  modelFns: string[]
  level: ModelLevelId
  /** 主要結論的標籤 */
  claim: ClaimKind
  /** 一句話摘要（$…$ 為 TeX） */
  summary: string
  metrics: PreviewMetric[]
  /** 代入 preset 數字的逐步推導 */
  steps: PreviewStep[]
  stepsTitle: string
  chart?: PreviewChart
  table?: PreviewTable
  verdicts: Verdict[]
  /** 假設與限制（$…$ 為 TeX） */
  notes: string[]
  /** 使用的 seed（有亂數時） */
  seed?: number
}

export type PreviewOutcome =
  | { status: 'ok'; result: PreviewResult; ms: number }
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; message: string }

type Params = Record<string, unknown>
type Previewer = (p: Params, preset: PresetEntry) => PreviewResult | { unsupported: string }

/* ───────────────────────── 小工具 ───────────────────────── */

const DEFAULT_SEED = 20261010

const isObj = (v: unknown): v is Params => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const int = (v: unknown, d: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(num(v, d))))
/** 這組參數超出預覽函式處理的範圍：誠實回報「不支援」，不用預設值頂替 */
export class UnsupportedPreview extends Error {}

/**
 * 列舉型參數：沒寫（undefined）用該實驗的預設值；寫了但不在預覽支援的清單內就丟 UnsupportedPreview——
 * 絕不把看不懂的選項悄悄換成預設值（那會算出一個與 preset 無關的數字）。
 */
function pick<T extends string>(v: unknown, allowed: readonly T[], d: T, name = '選項'): T {
  if (v === undefined || v === null) return d
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T
  throw new UnsupportedPreview(`參數 ${name} = ${JSON.stringify(v)} 不在 Gallery 預覽支援的範圍（${allowed.join('、')}）；請按「載入並執行」到原頁面。`)
}
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
const seedOf = (p: Params): number => (typeof p.seed === 'number' && Number.isInteger(p.seed) && p.seed >= 0 ? p.seed : DEFAULT_SEED)
const t = (x: number, sig = 6) => texNum(x, sig)
const ta = (x: number, sig = 6) => texArg(x, sig)
/** 角度：數字包在大括號內再加 ^\circ（科學記號 a\times10^{b} 後面直接接 ^\circ 會變成雙重上標） */
const td = (x: number, sig = 6) => `{${texNum(x, sig)}}^\\circ`
const range = (n: number) => Array.from({ length: n }, (_, i) => i)

/*
 * 共用模型檔的標籤（POLE_BEHAVIOUR_LABEL、TIE_RULE_LABEL、RULE_LABEL）是給下拉選單與 Plotly 圖例用的純文字（μ、S_N…）。
 * Gallery 把它們放進說明文字，所以這裡用同樣的 key 另寫一份 `$…$` 的版本，數學一律交給 KaTeX；
 * Record<…> 型別保證模型新增一個 key 時這裡編譯不過（不會悄悄漏掉）。
 */
const POLE_TEX: Record<PoleBehaviour, string> = {
  monotone: '$0<p<1$：不變號、單調收斂',
  oscillating: '$-1<p<0$：正負交替、震盪收斂',
  deadbeat: '$p=0$：理想模型一步到答案',
  boundary: '$|p|=1$：邊界，不保證收斂到 0',
  divergent: '$|p|>1$：發散',
  frozen: '$p=1$：$\\mu=0$，參數不動',
}
const TIE_TEX: Record<TieRule, string> = {
  strict: 'strict：只算 $S_N$ 與 $s$ 嚴格同號（tie 算錯）',
  half: 'half：tie 擲硬幣（random tie-break）',
  plus: '$\\operatorname{sign}(0)=+1$：tie 判 $+1$',
  skip: 'skip：$S_N=0$ 不更新',
}
const RULE_TEX: Record<MimoRule, string> = {
  scalar: 'Scalar LMS（$\\mathbf M=\\mu\\mathbf I$）',
  diagonal: 'Diagonal（各 loop 各自的 $\\mu_i$）',
  nlms: 'Block NLMS（除以 $\\operatorname{tr}\\hat{\\mathbf R}_x$）',
  full: 'Full preconditioner（$\\gamma(K_q\\mathbf R)^{-1}$）',
  regularized: 'Regularized（$\\lambda_{\\text{reg}}$）',
  sequential: 'Sequential（分階段）',
}
const CASE_IDS = ['A', 'B', 'C'] as const
const RAD2DEG = 180 / Math.PI
const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI)
/**
 * 浮點殘渣歸零：|x| ≤ rel·|scale| 時回傳 0（例如 cos 90° 算出的 6×10⁻¹⁷、90° − 3×30° 算出的 −1.4×10⁻¹⁴）。
 * 只用在「數學上恰為 0」的量；scale 是同一個量的自然大小。
 */
const snap = (x: number, scale = 1, rel = 1e-12): number => (Math.abs(x) <= rel * Math.abs(scale) ? 0 : x)
/** z 的冪次（特徵多項式用）：z⁰ = 1、z¹ = z */
const zPow = (k: number): string => (k === 0 ? '1' : k === 1 ? 'z' : `z^{${k}}`)
/** 帶正負號的一項：+3.2z、−z、+0.5（coef = 0 時回傳空字串；sym 為空代表常數項） */
function signedTerm(coef: number, sym: string, sig = 6): string {
  if (coef === 0) return ''
  const mag = Math.abs(coef)
  const body = sym && mag === 1 ? sym : `${texNum(mag, sig)}${sym}`
  return `${coef < 0 ? '-' : '+'}${body}`
}
/**
 * 單頻序列 cos(Ωn) 的週期（sample）：最小的正整數 P ≤ maxP 使 ΩP 為 2π 的整數倍；非週期（或週期太長）回傳 0。
 * 用來決定時間平均要不要取整數個週期（整數個週期的平均才是精確值）。
 */
export function tonePeriod(omega: number, maxP = 4096): number {
  if (!Number.isFinite(omega)) return 0
  const w = Math.abs(omega)
  if (w === 0) return 1
  for (let P = 1; P <= maxP; P++) {
    const k = (w * P) / (2 * Math.PI)
    const kr = Math.round(k)
    if (kr >= 1 && Math.abs(k - kr) <= 1e-9 * kr) return P
  }
  return 0
}

/** 取 ≤ maxPts 個等距點（畫圖用；保留第一與最後一點） */
function thin(y: ArrayLike<number>, maxPts = 400): { x: number[]; y: number[] } {
  const n = y.length
  const stride = Math.max(1, Math.ceil(n / maxPts))
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < n; i += stride) {
    xs.push(i)
    ys.push(y[i])
  }
  if (xs[xs.length - 1] !== n - 1 && n > 0) {
    xs.push(n - 1)
    ys.push(y[n - 1])
  }
  return { x: xs, y: ys }
}

/** 小矩陣 → TeX bmatrix */
function texMat(A: Matrix, sig = 4): string {
  const scale = Math.max(1e-300, ...A.flat().map((v) => Math.abs(v)))
  return `\\begin{bmatrix}${A.map((r) => r.map((v) => t(snap(v, scale), sig)).join('&')).join('\\\\')}\\end{bmatrix}`
}

function texComplex(z: Complex, sig = 5): string {
  if (Math.abs(z.im) < 1e-12 * Math.max(1, Math.abs(z.re))) return t(z.re, sig)
  return `${t(z.re, sig)}${z.im < 0 ? '-' : '+'}j${t(Math.abs(z.im), sig)}`
}

/* ═════════════════════════ L0：純量 LMS（lms-playground / intro-playground / stability-fixed-x） ═════════════════════════ */

interface ScalarCase {
  id: string
  mu: number
  w: Float64Array
  e: Float64Array
  p: number
  diverged: boolean
}

// #region core:previewScalarLms
/** 固定 x 的純量 LMS：同一組 (a, w₀, x, σ_v, seed) 對每個 μ 呼叫一次 runScalarLms，再用 fixedXPole 算 pole。 */
function scalarCases(base: { a: number; w0: number; x: number; steps: number; noise: number; seed: number }, mus: number[]): ScalarCase[] {
  return mus.map((mu, i) => {
    const r = runScalarLms({
      variant: 'conventional',
      a: base.a,
      w0: base.w0,
      mu,
      steps: base.steps,
      x: { kind: 'fixed', value: base.x },
      noiseSigma: base.noise,
      seed: base.seed,
    })
    const p = fixedXPole(mu, base.x) // ← 差異：L0 的 pole p = 1 − μx²（「增益」K = x² 一定 ≥ 0）
    return { id: CASE_IDS[i] ?? String(i), mu, w: r.w, e: r.e, p, diverged: r.diverged }
  })
}
// #endregion

function scalarPreview(experiment: string, base: { a: number; w0: number; x: number; steps: number; noise: number; seed: number }, mus: number[]): PreviewResult {
  const cases = scalarCases(base, mus)
  const c0 = cases[0]
  const { a, w0, x, noise } = base
  const multi = cases.length > 1
  const sfx = (c: ScalarCase) => (multi ? `:${c.id}` : '')
  const metrics: PreviewMetric[] = []
  for (const c of cases) {
    const tag = multi ? `\\;(\\text{${c.id}},\\ \\mu=${t(c.mu)})` : ''
    if (c.w.length > 1) metrics.push({ key: `w1${sfx(c)}`, label: `w_1${tag}`, value: c.w[1], claim: 'exact', note: noise > 0 ? `此 seed 的樣本值（含量測雜訊）` : '遞迴第一步' })
    if (c.w.length > 2) metrics.push({ key: `w2${sfx(c)}`, label: `w_2${tag}`, value: c.w[2], claim: 'exact' })
    metrics.push({ key: `pole${sfx(c)}`, label: `p=1-\\mu x^2${tag}`, value: c.p, claim: 'exact', note: POLE_TEX[classifyPole(c.p)] })
    const last = c.w.length - 1
    let lastFinite = last
    while (lastFinite > 0 && !Number.isFinite(c.w[lastFinite])) lastFinite--
    metrics.push({ key: `wN${sfx(c)}`, label: `w_{${lastFinite}}${tag}`, value: c.w[lastFinite], claim: 'exact', note: c.diverged ? `第 ${lastFinite + 1} 步 $|w|>10^{12}$，判定發散` : `最後一步（共 ${last} 步）` })
    // x = 0 時 w 完全不動（更新量 μe·x = 0），1 − p² = 0：穩態變異的公式是 0/0，不列
    if (noise > 0 && x !== 0 && c.mu > 0 && c.mu * x * x < 2) {
      const sd = Math.sqrt((c.mu * noise * noise) / (2 - c.mu * x * x))
      metrics.push({ key: `sdW${sfx(c)}`, label: `\\sigma_w=\\sqrt{\\mu\\sigma_v^2/(2-\\mu x^2)}${tag}`, value: sd, claim: 'exact', note: '穩態標準差（線性 AR(1) 遞迴的精確解）' })
      const tail = Array.from(c.w.slice(Math.floor(c.w.length / 2))).filter(Number.isFinite)
      if (tail.length > 10) {
        const m = tail.reduce((s, v) => s + v, 0) / tail.length
        const sdS = Math.sqrt(tail.reduce((s, v) => s + (v - m) ** 2, 0) / (tail.length - 1))
        metrics.push({ key: `sdWsample${sfx(c)}`, label: `\\hat\\sigma_w\\ (\\text{後半段})${tag}`, value: sdS, claim: 'approx', note: '單一路徑的時間平均（相鄰樣本相關，誤差較大）' })
      }
    }
  }
  metrics.push({ key: 'muMax', label: '\\mu_{\\max}=2/x^2', value: fixedXMuMax(x), unit: '1/[x]^2', claim: 'exact', note: 'T02：$0<\\mu<2/x^2$ 才收斂' })

  const steps: PreviewStep[] = []
  const y0 = c0.e.length ? c0.e[0] + w0 * x : NaN
  steps.push(
    noise > 0
      ? { tex: `y_0=ax+v_0=${ta(a)}\\times${ta(x)}+(${t(y0 - a * x, 4)})=${t(y0)}`, why: '量測 = 真實增益 × 輸入 + 雜訊（這個 seed 抽到的 $v_0$）。' }
      : { tex: `y_0=ax=${ta(a)}\\times${ta(x)}=${t(a * x)}`, why: '黑盒子的輸出：真實增益 $a$ 乘上輸入 $x$（無雜訊）。' },
  )
  if (c0.e.length > 0) {
    steps.push({ tex: `e_0=y_0-w_0x=${t(y0)}-${ta(w0)}\\times${ta(x)}=${t(c0.e[0])}`, why: '誤差 = 量測 − 用目前猜測 $w_0$ 的預測。' })
    steps.push({ tex: `w_1=w_0+\\mu e_0x=${ta(w0)}+${ta(c0.mu)}\\times${ta(c0.e[0])}\\times${ta(x)}=${t(c0.w[1])}`, why: '沿著 $-\\partial(\\tfrac12e^2)/\\partial w=e\\,x$ 的方向走一步（步長 $\\mu$）。' })
  }
  if (c0.e.length > 1) {
    steps.push({ tex: `e_1=y_1-w_1x=${t(c0.e[1])},\\quad w_2=w_1+\\mu e_1x=${t(c0.w[2])}`, why: '同一條規則再做一次（數字由 runScalarLms 算出）。' })
  }
  steps.push({ tex: `\\delta_{n+1}=a-w_{n+1}=(1-\\mu x^2)\\,\\delta_n=${t(c0.p)}\\,\\delta_n`, why: '無雜訊時把 $e_n=(a-w_n)x$ 代回更新式：誤差每步乘上同一個 pole $p$（$\\delta=a-w$，勘誤 E39）。' })
  steps.push({ tex: `\\delta_n=p^n\\delta_0,\\qquad \\delta_0=a-w_0=${t(a - w0)}`, why: `等比數列；${POLE_TEX[classifyPole(c0.p)]}。` })
  if (noise > 0) {
    steps.push({
      tex: `e_n=\\delta_nx+v_n\\;\\Rightarrow\\;\\delta_{n+1}=p\\,\\delta_n-\\mu x\\,v_n`,
      why: '有雜訊時 $y_n=ax+v_n$：更新式多出一項由雜訊推動的隨機步 $-\\mu x\\,v_n$（$v_n$ 零均值、與 $\\delta_n$ 獨立），所以平均仍照 $p^n$ 衰減，但 $w_n$ 不會停住。',
    })
    if (x !== 0 && c0.mu > 0 && c0.mu * x * x < 2) {
      const varW = (c0.mu * noise * noise) / (2 - c0.mu * x * x)
      steps.push({
        tex: `\\sigma_w^2=p^2\\sigma_w^2+\\mu^2x^2\\sigma_v^2\\;\\Rightarrow\\;\\sigma_w^2=\\frac{\\mu^2x^2\\sigma_v^2}{1-p^2}=\\frac{\\mu\\,\\sigma_v^2}{2-\\mu x^2}=\\frac{${ta(c0.mu)}\\times${t(noise * noise)}}{2-${t(c0.mu * x * x)}}=${t(varW)}`,
        why: `穩態時前後兩步的變異數相等，解一次方程式；$1-p^2=(1-p)(1+p)=\\mu x^2(2-\\mu x^2)$。開根號得 $\\sigma_w=${t(Math.sqrt(varW))}$：$\\mu$ 越大收斂越快，但停下來後抖得越大。`,
      })
    }
  }

  const verdicts: Verdict[] = []
  if (x === 0) verdicts.push({ kind: 'danger', text: '$x=0$：沒有 excitation，$e_n=y_n$ 與 $w$ 無關，$a$ 不可辨識（$\\lambda_{\\min}=E[x^2]=0$）。' })
  for (const c of cases) {
    const cls = classifyPole(c.p)
    const who = multi ? `Case ${c.id}（$\\mu=${t(c.mu)}$）：` : ''
    if (c.mu < 0) verdicts.push({ kind: 'danger', text: `${who}$\\mu<0$：更新極性錯誤——沿梯度上坡，$p=${t(c.p)}>1$，$|\\delta_n|$ 單調變大。` })
    else if (cls === 'divergent') verdicts.push({ kind: 'danger', text: `${who}$|p|=${t(Math.abs(c.p))}>1$：$\\mu$ 超過 $2/x^2=${t(fixedXMuMax(x))}$，誤差每步放大${c.p < -1 ? '且正負交替' : ''}。` })
    else if (cls === 'boundary') verdicts.push({ kind: 'warn', text: `${who}$|p|=1$：穩定邊界，$|\\delta_n|$ 不衰減。` })
    else if (cls === 'frozen') verdicts.push({ kind: 'warn', text: `${who}$\\mu=0$：$p=1$，參數不動。` })
    else if (x !== 0) verdicts.push({ kind: 'ok', text: `${who}$|p|=${t(Math.abs(c.p))}<1$：平均收斂到 $a=${t(a)}$。` })
  }

  const series: PreviewSeries[] = cases.map((c) => {
    const th = thin(c.w)
    return { name: multi ? `${c.id}: μ = ${c.mu}` : 'w_n', x: th.x, y: th.y, mode: c.w.length <= 41 ? 'lines+markers' : 'lines' }
  })
  return {
    experiment,
    modelFns: ['lms.runScalarLms', 'lms.fixedXPole', 'lms.classifyPole', 'lms.fixedXMuMax'],
    level: 'L0',
    claim: 'exact',
    summary: `固定 $x=${t(x)}$、$a=${t(a)}$、$w_0=${t(w0)}$${noise > 0 ? `、$\\sigma_v=${t(noise)}$` : '（無雜訊）'}：pole $p=1-\\mu x^2=${t(c0.p)}$${multi ? '（Case A）' : ''}。`,
    metrics,
    steps,
    stepsTitle: multi ? `手算：把 Case ${c0.id}（$\\mu=${t(c0.mu)}$）的數字代進 LMS 更新式` : '手算：把 preset 的數字代進 LMS 更新式',
    chart: { title: '係數軌跡（runScalarLms）', xLabel: 'n（sample）', yLabel: 'w_n', series, hLines: [{ y: a, name: `a = ${a}` }] },
    verdicts,
    notes: [
      'L0 模型：每個 sample 更新一次、$x$ 固定、量測雜訊 $v$ 為白色 Gaussian（若 $\\sigma_v>0$）。',
      noise > 0 ? `雜訊由 createRng(${base.seed}) 產生；同 seed 與原頁面結果逐點相同。` : '無雜訊時遞迴與封閉式 $w_n=a-(a-w_0)p^n$ 完全一致。',
    ],
    seed: noise > 0 ? base.seed : undefined,
  }
}

const previewLmsPlayground: Previewer = (p) =>
  scalarPreview(
    'lms-playground',
    { a: num(p.a, 3), w0: num(p.w0, 1), x: num(p.x, 2), steps: int(p.steps, 20, 1, 400), noise: Math.max(0, num(p.noiseSigma, 0)), seed: seedOf(p) },
    [num(p.mu, 0.1)],
  )

const previewIntroPlayground: Previewer = (p) => {
  const mus = Array.isArray(p.mus) ? p.mus.filter((m): m is number => typeof m === 'number' && Number.isFinite(m)).slice(0, 3) : []
  return scalarPreview(
    'intro-playground',
    { a: num(p.a, 3), w0: num(p.w0, 1), x: num(p.x, 2), steps: int(p.steps, 30, 1, 5000), noise: Math.max(0, num(p.sigmaV, 0)), seed: seedOf(p) },
    mus.length ? mus : [0.1],
  )
}

const previewFixedX: Previewer = (p) =>
  scalarPreview('stability-fixed-x', { a: num(p.a, 3), w0: num(p.w0, 1), x: num(p.x, 2), steps: int(p.steps, 20, 1, 2000), noise: 0, seed: DEFAULT_SEED }, [num(p.mu, 0.1)])

/* ═════════════════════════ L1：Comparator（comparator-lab） ═════════════════════════ */

const TIE_RULES: readonly TieRule[] = ['strict', 'half', 'plus', 'skip']

// #region core:previewComparator
const previewComparator: Previewer = (p) => {
  const s = num(p.s, 1)
  const sigma = Math.max(0, num(p.sigma, 100))
  const theta = num(p.theta, 0)
  const N = int(p.N, 10001, 1, 2e8)
  const tie = pick(p.tieRule, TIE_RULES, 'half', 'tieRule')
  const tSign: 1 | -1 = s >= 0 ? 1 : -1 // 正確方向（s = 0 時以 +1 為參考）
  const hasNoise = sigma > 0
  const pp = pPlus(s, sigma, theta) // P(q = +1) = Φ((s − θ)/σ_v)
  const m = meanQ(s, sigma, theta) // E[q] = erf((s − θ)/(√2σ_v))
  const mEff = tSign * m
  const Kq = hasNoise ? kq(sigma) : Infinity // K_q = √(2/π)/σ_v
  const mo = sumMoments(N, m) // E[S_N] = Nm、Var = N(1 − m²)
  const split = directionExact(p0(pp), N) // exact binomial：P(S>0)、P(S=0)、P(S<0)
  const out = applyTieRule(split, tie, tSign)
  const clt = directionCltPlain(mEff, N) // 規格 §5 的 Φ(m√N/√(1 − m²))
  const n95Clt = mEff > 0 ? samplesForConfidence(mEff, 0.95) : Infinity
  const n95Odd = mEff > 0 && n95Clt < 5e7 ? minNForTarget(pp, 0.95, 'odd', 'strict', tSign, 5e7) : null
  const r = hasNoise ? (s - theta) / sigma : NaN
  // #endregion
  const metrics: PreviewMetric[] = [
    { key: 'pPlus', label: 'P(q=+1)=\\Phi\\!\\left(\\tfrac{s-\\theta}{\\sigma_v}\\right)', value: pp, claim: 'exact', note: 'T04' },
    { key: 'meanQ', label: 'm=E[q]=2\\Phi-1', value: m, claim: 'exact' },
    { key: 'Kq', label: 'K_q=\\sqrt{2/\\pi}/\\sigma_v', value: Kq, unit: '\\mathrm{fs^{-1}}', claim: 'approx', note: '小訊號斜率（$s\\ll\\sigma_v$ 時才準）' },
    { key: 'linErr', label: '\\tfrac{K_q s}{E[q]}-1', value: hasNoise ? linearizationRelError(r) : NaN, claim: 'exact', note: '線性化高估量（$\\approx r^2/6$）' },
    { key: 'meanSum', label: 'E[S_N]=Nm', value: mo.meanSum, claim: 'exact' },
    { key: 'sdSum', label: '\\mathrm{SD}(S_N)=\\sqrt{N(1-m^2)}', value: mo.sdSum, claim: 'exact' },
    { key: 'pPos', label: 'P(S_N>0)', value: split.pos, claim: 'exact', note: 'exact binomial' },
    { key: 'pTie', label: 'P(S_N=0)', value: split.tie, claim: 'exact', note: N % 2 ? '奇數 $N$ 沒有 tie' : '偶數 $N$ 的 tie（勘誤 E02）' },
    { key: 'pCorrect', label: `P(\\text{判對})\\ [\\text{${tie}}]`, value: out.correct, claim: 'exact', note: TIE_TEX[tie] },
    { key: 'pClt', label: '\\Phi\\!\\left(m\\sqrt N/\\sqrt{1-m^2}\\right)', value: clt, claim: 'approx', note: 'CLT；偶數 $N$ 時近似的是 tie 平分的值' },
    { key: 'n95Clt', label: 'N_{95}\\approx z_{0.95}^2(1-m^2)/m^2', value: n95Clt, claim: 'approx' },
  ]
  if (n95Odd !== null) metrics.push({ key: 'n95Odd', label: 'N_{95}\\ (\\text{exact, odd})', value: n95Odd, claim: 'exact', note: 'T05：最小的奇數 $N$ 使嚴格 $P(S_N>0)\\ge0.95$' })

  const steps: PreviewStep[] = hasNoise
    ? [
        { tex: `z=\\frac{s-\\theta}{\\sigma_v}=\\frac{${t(s)}-${ta(theta)}}{${t(sigma)}}=${t((s - theta) / sigma)}`, why: '把固定誤差標準化：除以雜訊 RMS。' },
        { tex: `P(q=+1)=P(s+v\\ge\\theta)=\\Phi(z)=${t(pp)}`, why: 'Gaussian 雜訊下 comparator 輸出 +1 的機率就是標準常態 CDF。' },
        { tex: `m=E[q]=(+1)P(+1)+(-1)P(-1)=2\\Phi(z)-1=${t(m)}`, why: '期望值定義；$q$ 只有 ±1 兩個值。' },
        { tex: `K_q=\\left.\\frac{dE[q]}{ds}\\right|_{s=\\theta}=\\frac{2\\phi(0)}{\\sigma_v}=\\frac{\\sqrt{2/\\pi}}{${t(sigma)}}=${t(Kq)}\\ \\mathrm{fs^{-1}}`, why: '對 $2\\Phi(s/\\sigma_v)-1$ 微分，在 0 點 $\\phi(0)=1/\\sqrt{2\\pi}$。' },
        { tex: `E[S_N]=Nm=${t(N)}\\times${ta(m)}=${t(mo.meanSum)},\\quad \\mathrm{SD}=\\sqrt{N(1-m^2)}=${t(mo.sdSum)}`, why: '獨立樣本：期望值相加、變異數相加（訊號 $\\propto N$、雜訊 $\\propto\\sqrt N$）。' },
        {
          tex: `P(\\text{判對})\\approx\\Phi\\!\\left(\\frac{m_{\\text{eff}}\\sqrt N}{\\sqrt{1-m^2}}\\right)=${t(clt)}\\quad(\\text{exact},\\ \\text{${tie}}:\\ ${t(out.correct)})`,
          why:
            `CLT：$S_N$ 近似 Gaussian；$m_{\\text{eff}}=\\operatorname{sign}(s)\\,m=${t(mEff)}$ 是「朝正確方向」的平均。exact 值由 Binomial 逐項加總。` +
            (N % 2 === 0 ? `偶數 $N$ 有 tie（$P(S_N=0)=${t(split.tie, 4)}$）：CLT 式近似的是「tie 平分」的值，和嚴格的 $P(S_N>0)$ 不同（勘誤 E02）。` : '奇數 $N$ 沒有 tie，兩者才是同一件事（勘誤 E02）。'),
        },
        mEff > 0
          ? {
              tex: `N_{95}\\approx\\frac{z_{0.95}^2(1-m^2)}{m^2}=${t(n95Clt)}${n95Odd !== null ? `\\;\\Rightarrow\\;N_{\\text{odd}}=${t(n95Odd)}` : ''}`,
              why: '令 $m\\sqrt N/\\sqrt{1-m^2}=\\Phi^{-1}(0.95)$ 反解 $N$；exact 門檻由二分搜尋 Binomial 得到。',
            }
          : {
              tex: `m_{\\text{eff}}=${t(mEff)}\\le0\\;\\Rightarrow\\;P(\\text{判對})\\le\\tfrac12\\quad(N_{95}\\ \\text{不存在})`,
              why: '平均指向錯誤方向（或為 0）時，累加只會把「錯的方向」看得更清楚（$m_{\\text{eff}}<0$ 時判對機率隨 $N$ 趨近 0）：沒有任何 $N$ 能達到 95% 的正確率。要先修掉 offset $\\theta$。',
            },
      ]
    : [
        { tex: `\\sigma_v=0\\Rightarrow q=\\operatorname{sign}(s-\\theta)=${s - theta >= 0 ? '+1' : '-1'}`, why: '沒有雜訊時 comparator 是 hard limiter：每次都輸出同一個值。' },
        { tex: 'K_q=\\lim_{\\sigma_v\\to0}\\frac{\\sqrt{2/\\pi}}{\\sigma_v}=\\infty', why: '$E[q]$ 變成步階函數，小訊號增益不存在——LMS 會在 $\\pm\\mu$ 間 limit cycle。' },
      ]

  // P(判對) vs N（exact binomial，奇數 N 的 log 格點）
  const nMax = Math.max(3 * N, Number.isFinite(n95Clt) ? 3 * n95Clt : 0, 101)
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i <= 36; i++) {
    let n = Math.round(10 ** ((Math.log10(Math.min(nMax, 2e6)) * i) / 36))
    if (n % 2 === 0) n += 1
    if (xs.length && n <= xs[xs.length - 1]) continue
    xs.push(n)
    ys.push(directionOutcomeExact(pp, n, 'strict', tSign).correct)
  }
  const verdicts: Verdict[] = []
  if (!hasNoise) verdicts.push({ kind: 'warn', text: '$\\sigma_v=0$：hard limiter，$K_q$ 無定義；sign-LMS 只能在 $\\pm\\mu$ 的跳動帶內收斂。' })
  else if (s === theta) verdicts.push({ kind: 'warn', text: '$s=\\theta$：$E[q]=0$，comparator 沒有方向資訊（累加再多也是擲硬幣）。' })
  else if (mEff <= 0) verdicts.push({ kind: 'danger', text: 'offset $\\theta$ 大過誤差 $s$：$E[q]$ 指向錯誤方向，累加越多越確定地判錯。' })
  else if (out.correct < 0.5)
    verdicts.push({
      kind: 'warn',
      text: `$E[q]=${t(m, 4)}>0$，但在 tie 規則「${tie}」下判對機率只有 $${t(out.correct, 5)}<0.5$：$N=${t(N)}$ 太小，tie（$P(S_N=0)=${t(split.tie, 4)}$）吃掉的機率比訊號帶來的還多。`,
    })
  else verdicts.push({ kind: 'ok', text: `$E[q]=${t(m, 4)}$ 雖小，但 $N=${t(N)}$ 次累加後判對機率 $${t(out.correct, 5)}$。` })
  if (N % 2 === 0 && tie === 'strict') verdicts.push({ kind: 'warn', text: `偶數 $N$ 且 tie 算錯：$P(S_N=0)=${t(split.tie, 4)}$ 被丟掉（勘誤 E02）。` })
  if (hasNoise && Math.abs(r) > 0.246) verdicts.push({ kind: 'info', text: `$|s-\\theta|/\\sigma_v=${t(Math.abs(r), 3)}$：$K_q$ 線性化高估超過 1%。` })
  return {
    experiment: 'comparator-lab',
    modelFns: ['comparator.pPlus', 'comparator.meanQ', 'comparator.kq', 'comparator.sumMoments', 'comparator.directionExact', 'comparator.applyTieRule', 'comparator.directionCltPlain', 'comparator.samplesForConfidence', 'comparator.minNForTarget'],
    level: 'L1',
    claim: 'exact',
    summary: `$s=${t(s)}\\,\\mathrm{fs}$、$\\sigma_v=${t(sigma)}\\,\\mathrm{fs}$、$N=${t(N)}$：單次只有 $P(q=+1)=${t(pp)}$，累加後判對 $${t(out.correct, 5)}$。`,
    metrics,
    steps,
    stepsTitle: '手算：從單一 comparator 樣本到 $N$ 個樣本的方向判斷',
    chart: { title: '方向判斷正確率對 $N$（exact binomial、奇數 $N$）', xLabel: 'N（樣本數；取點在 log 尺度上等距）', yLabel: 'P(S_N 與 s 同號)', series: [{ name: 'exact（strict, odd N）', x: xs, y: ys, mode: 'lines+markers' }], hLines: [{ y: 0.95, name: '95%' }] },
    verdicts,
    notes: ['L1 模型：$v$ 為 iid Gaussian、$q=\\operatorname{sign}(s+v-\\theta)$、$S_N=\\sum q_i$（sum 尺度，勘誤 E18）。', 'Monte Carlo 與 histogram 在原頁面（worker）。'],
  }
}

/** 機率夾在 [0, 1]（浮點保護） */
function p0(p: number): number {
  return Math.min(1, Math.max(0, p))
}

/* ═════════════════════════ L2：單頻 polarity（polarity-explorer） ═════════════════════════ */

function polarityParams(v: Params): PolarityParams {
  const out: PolarityParams = { ...DEFAULT_POLARITY_PARAMS }
  out.mode = pick(v.mode, ['tone', 'pll'] as const, out.mode, 'mode')
  out.regressor = pick(v.regressor, ['x', 'u'] as const, out.regressor, 'regressor')
  for (const k of ['mag', 'phiDeg', 'omega', 'A', 'D', 'mu', 'sigmaV', 'N', 'blocks', 'a', 'w0'] as const) out[k] = num(v[k], out[k])
  return out
}

// #region core:previewPolarityTone
const previewPolarity: Previewer = (raw) => {
  const p = polarityParams(raw)
  if (p.mode !== 'tone')
    return { unsupported: 'PLL 模式需要以 worker 分析整段 DSM / tone code 經 DT 迴路的相關（analyzePllPolarity），不在 Gallery 主執行緒預覽；請按「載入並執行」。' }
  const phi = (p.phiDeg * Math.PI) / 180
  const path = tonePath(p.mag, phi, p.omega) // 2-tap FIR：H(e^{jΩ}) = |H|e^{jφ}（Ω = 0、π 時 φ 吸附到 0°/180°）
  const D = Math.max(0, Math.round(p.D))
  const spec = { A: p.A, mag: p.mag, phiRad: path.phiEffRad, omega: p.omega }
  const fx = p.regressor === 'u'
  const cScale = (path.edge ? 1 : 0.5) * p.A * p.A * (fx ? p.mag * p.mag : p.mag) // |C| 的最大可能值（cos = ±1）
  const Craw = fx
    ? toneCorrelation({ A: p.A * p.mag, mag: 1, phiRad: 0, omega: p.omega, delay: D }) // filtered-x：E[u[n−D]u[n]]
    : toneCorrelation({ ...spec, delay: D }) // C_D = (A²/2)|H|cos(φ + ΩD)（Ω = 0、π 時為 2 倍，E46）
  const Ceff = snap(Craw, cScale) // cos 90° 的浮點殘渣（約 6×10⁻¹⁷）歸零：數學上 C 恰為 0
  const Kq = kqFromSigma(p.sigmaV)
  const pole = calPole(p.mu, Kq, Ceff) // ← 差異：L2 的 pole p = 1 − μK_qC（相關 C 可以是負的 ⇒ p > 1）
  // #endregion
  const thetaDeg = ((fx ? 0 : path.phiEffRad) + p.omega * D) * RAD2DEG
  const margin = polarityMarginDeg(thetaDeg)
  const aRef = fx ? p.A * p.mag : p.A // regressor 的振幅（filtered-x 時是 u 的振幅 A|H|）
  const largeCont = snap(fx ? toneLargeErrorGain(aRef, 0, p.omega, D) : toneLargeErrorGain(p.A, path.phiEffRad, p.omega, D), aRef)
  // 取樣後的大誤差增益 E[x_D·sign(u)]：用真正的 FIR 濾波後求時間平均。
  // 序列有整數週期 P 時取整數個週期（精確）；否則取 2^14 個 sample（有限長度的估計，標成 approx）。
  const P = tonePeriod(p.omega)
  const L = P > 0 ? P * Math.max(1, Math.floor((1 << 14) / P)) : 1 << 14
  const pre = D + 8
  const xs = new Float64Array(L + pre)
  for (let n = 0; n < xs.length; n++) xs[n] = p.A * Math.cos(p.omega * (n - pre))
  const u = lfilter(path.b, path.a, xs).y
  const ref = new Float64Array(xs.length)
  for (let n = D; n < xs.length; n++) ref[n] = fx ? u[n - D] : xs[n - D]
  const largeSampled = snap(empiricalLargeErrorGain(ref, u, pre), aRef, 1e-9)
  const cls = classifyPolarity(Ceff, Math.max(cScale, 1e-12))
  const muRange = cls === 'positive' ? stableMuRange(Kq, Ceff) : null

  const refTex = fx ? 'u_D' : 'x_D'
  const ampTex = fx ? 'A|H|' : 'A'
  const cLabel = fx
    ? path.edge
      ? 'C=E[u_D\\,u]=(A|H|)^2\\cos(\\Omega D)'
      : 'C=E[u_D\\,u]=\\tfrac{(A|H|)^2}{2}\\cos(\\Omega D)'
    : path.edge
      ? 'C_D=A^2\\,H\\cos(\\Omega D)'
      : 'C_D=\\tfrac{A^2}{2}|H|\\cos\\theta'
  const metrics: PreviewMetric[] = [
    { key: 'theta', label: fx ? '\\theta=\\Omega D' : '\\theta=\\varphi+\\Omega D', value: thetaDeg, unit: '^\\circ', claim: 'exact', note: fx ? 'filtered-x：$\\varphi$ 抵銷，殘餘相位只剩 $\\Omega D$' : '殘餘相位' },
    {
      key: 'C',
      label: cLabel,
      value: Ceff,
      claim: 'exact',
      note: (path.edge ? '$\\Omega=0$ 或 $\\pi$：2 倍公式（勘誤 E46）' : '單頻、長時間平均') + (Ceff === 0 && Craw !== 0 ? `；浮點值 $${t(Craw, 3)}$ 是捨入殘渣，數學上恰為 0` : ''),
    },
    { key: 'Kq', label: 'K_q=\\sqrt{2/\\pi}/\\sigma_v', value: Kq, unit: '\\mathrm{fs^{-1}}', claim: 'approx' },
    { key: 'pole', label: 'p=1-\\mu K_qC', value: pole, claim: 'exact', note: '平均 pole（block rate、average GMAC、無更新延遲）' },
    { key: 'margin', label: 'M=90^\\circ-|\\mathrm{wrap}_{180}(\\theta)|', value: margin, unit: '^\\circ', claim: 'exact', note: '§8.1 單頻 polarity margin' },
    {
      key: 'driftSampled',
      label: `\\mu\\,|E[${refTex}\\operatorname{sign}u]|`,
      value: p.mu * Math.abs(largeSampled),
      unit: '\\mathrm{fs/block}',
      claim: P > 0 ? 'exact' : 'approx',
      note:
        '大誤差（comparator 飽和）時每 block 的漂移量（F-06.15）；' +
        (P > 0 ? `取樣序列週期 $P=${P}$，對整數個週期（${L} 個 sample）平均` : `$\\Omega/2\\pi$ 不是簡單的有理數（序列不週期），取 ${L} 個 sample 的時間平均（估計值）`),
    },
    {
      key: 'driftCont',
      label: path.edge ? `\\mu\\,${ampTex}\\,|\\cos(\\Omega D)|` : `\\mu\\,\\tfrac{2${ampTex}}{\\pi}|\\cos\\theta|`,
      value: p.mu * Math.abs(largeCont),
      unit: '\\mathrm{fs/block}',
      claim: path.edge ? 'exact' : 'approx',
      note: path.edge ? '$\\Omega=0$ 或 $\\pi$：$x$、$u$ 都是 $\\pm$ 定值的序列' : '連續時間極限；每週期 sample 少時與上一列不同',
    },
  ]
  if (muRange) metrics.push({ key: 'muMax', label: '\\mu_{\\max}=2/(K_qC)', value: muRange[1], unit: '\\mathrm{fs}', claim: 'exact' })
  const h = path.b
  const omegaDeg = p.omega * RAD2DEG
  const steps: PreviewStep[] = [
    path.edge
      ? { tex: `\\Omega=${t(p.omega, 5)}\\Rightarrow H=${t(h[0])}\\ (\\text{單 tap，實數})`, why: '$\\Omega=0$ 或 $\\pi$ 時實係數濾波器的頻率響應必為實數，$\\varphi$ 只能是 $0^\\circ$ 或 $180^\\circ$（勘誤 E46）。' }
      : {
          tex: `h=[h_0,h_1]=[${t(h[0], 5)},\\ ${t(h[1], 5)}]\\;\\Rightarrow\\;H(e^{j\\Omega})=h_0+h_1e^{-j\\Omega}=${t(p.mag)}\\,e^{j${td(p.phiDeg, 5)}}`,
          why: '用一個 2-tap FIR 精確做出指定的 $|H|$ 與 $\\varphi$（解實部、虛部兩條方程）。',
        },
    fx
      ? { tex: `\\theta=\\Omega D=${td(omegaDeg, 5)}\\times${D}=${td(thetaDeg, 5)}`, why: 'filtered-x：regressor $u[n-D]$ 與 PD 看到的 $u[n]$ 經過同一個 $H$，$\\varphi$ 互相抵銷，只剩 code 延遲造成的 $\\Omega D$。' }
      : { tex: `\\theta=\\varphi+\\Omega D=${td(path.phiEffRad * RAD2DEG, 5)}+${td(omegaDeg, 5)}\\times${D}=${td(thetaDeg, 5)}`, why: 'GMAC 用延遲 $D$ 的 code：每延遲一個 sample，相位多 $\\Omega$。' },
    path.edge
      ? {
          tex: fx
            ? `C=E[u[n-D]u[n]]=(A|H|)^2\\cos(\\Omega D)=${t(aRef * aRef)}\\times\\cos(${td(omegaDeg * D, 5)})=${t(Ceff)}`
            : `C_D=E[x[n-D]u[n]]=A^2\\,H\\cos(\\Omega D)=${t(p.A * p.A)}\\times${ta(h[0])}\\times\\cos(${td(omegaDeg * D, 5)})=${t(Ceff)}`,
          why: '$\\Omega=0$ 或 $\\pi$ 時 $\\cos(2\\Omega n+\\varphi)$ 是常數、不會被平均掉，所以是一般公式 $\\tfrac{A^2}{2}|H|\\cos\\theta$ 的 2 倍（勘誤 E46）。',
        }
      : {
          tex: fx
            ? `C=E[u[n-D]u[n]]=\\tfrac{(A|H|)^2}{2}\\cos(\\Omega D)=\\tfrac{${t(aRef * aRef)}}{2}\\times\\cos(${td(thetaDeg, 5)})=${t(Ceff)}`
            : `C_D=E[x[n-D]u[n]]=\\tfrac{A^2}{2}|H|\\cos\\theta=\\tfrac{${t(p.A * p.A)}}{2}\\times${t(p.mag)}\\times\\cos(${td(thetaDeg, 5)})=${t(Ceff)}`,
          why: '積化和差：$\\cos a\\cos b=\\tfrac12[\\cos(a-b)+\\cos(a+b)]$，高頻項長時間平均為 0（$0<\\Omega<\\pi$）。',
        },
    { tex: `K_q=\\frac{\\sqrt{2/\\pi}}{\\sigma_v}=\\frac{${t(SQRT_2_OVER_PI)}}{${t(p.sigmaV)}}=${t(Kq)}\\ \\mathrm{fs^{-1}}`, why: '1-bit comparator 的小訊號增益（Ch05）。' },
    { tex: `p=1-\\mu K_qC=1-${ta(p.mu)}\\times${ta(Kq)}\\times${ta(Ceff)}=${t(pole)}`, why: '平均更新 $E[\\delta_{k+1}]=(1-\\mu K_qC)E[\\delta_k]$。' },
    cls === 'negative'
      ? { tex: `C<0\\;\\Rightarrow\\;p=1+\\mu K_q|C|>1\\quad\\forall\\,\\mu>0`, why: '極性錯誤：縮小 $\\mu$ 只會讓發散變慢，不會變穩定。' }
      : cls === 'zero'
        ? {
            tex: Ceff === 0 ? `C=0\\;\\Rightarrow\\;p=1\\quad\\forall\\,\\mu` : `|C|\\ll${t(cScale)}\\;\\Rightarrow\\;p\\approx1`,
            why: '沒有恢復力：平均誤差（幾乎）不衰減，$w$ 只隨 comparator 雜訊做 random walk。這不是調 $\\mu$ 能解決的——要改的是相位（延遲 $D$ 或 filtered-x）。',
          }
        : { tex: `0<\\mu<\\frac{2}{K_qC}${muRange ? `=${t(muRange[1])}\\ \\mathrm{fs}` : ''}`, why: '$|p|<1$ 的條件（$C>0$）。' },
  ]
  const kqOk = Number.isFinite(Kq) // σ_v = 0：comparator 是 hard limiter，K_q 與平均 pole 沒有定義
  if (!kqOk)
    steps.splice(3, steps.length - 3, {
      tex: `\\sigma_v=0\\Rightarrow K_q=\\lim_{\\sigma_v\\to0}\\frac{\\sqrt{2/\\pi}}{\\sigma_v}=\\infty`,
      why: '沒有雜訊時 comparator 是 hard limiter：$E[q]$ 對誤差是步階函數，小訊號增益與平均 pole $p=1-\\mu K_qC$ 都沒有定義。$C$ 的正負號仍然決定方向：每個 block 以固定步幅移動（下一行），而不是指數收斂或發散。',
    })
  if (cls === 'negative' || !kqOk)
    steps.push({ tex: `|\\delta_{k+1}|-|\\delta_k|\\to\\mu\\,|E[${refTex}\\operatorname{sign}u]|=${ta(p.mu)}\\times${t(Math.abs(largeSampled), 5)}=${t(p.mu * Math.abs(largeSampled), 5)}\\ \\mathrm{fs/block}`, why: '誤差大到 comparator 飽和後 $q\\approx\\operatorname{sign}(\\delta u)$，指數發散變成線性漂移。' })
  const dMax = Math.max(12, Math.min(64, Math.ceil(path.edge ? 2 : (2 * Math.PI) / Math.max(p.omega, 1e-9)) + 1))
  const Ds = range(dMax + 1)
  const sweep = (d: number) => (fx ? toneCorrelation({ A: aRef, mag: 1, phiRad: 0, omega: p.omega, delay: d }) : toneCorrelation({ ...spec, delay: d }))
  const verdicts: Verdict[] = []
  if (cls === 'negative') verdicts.push({ kind: 'danger', text: `C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散（$C=${t(Ceff, 4)}$${kqOk ? `、$p=${t(pole)}$` : ''}）。` })
  else if (cls === 'zero') verdicts.push({ kind: 'warn', text: `$C\\approx0$：$\\theta\\approx\\pm90^\\circ$，GMAC 沒有恢復力，$w$ 只做 random walk。` })
  else if (!kqOk) verdicts.push({ kind: 'warn', text: '極性正確（$C>0$），但 $\\sigma_v=0$：comparator 是 hard limiter，$K_q$ 與平均 pole 沒有定義；$w$ 以固定步幅靠近 $a$，之後在 $\\pm\\mu$ 的帶內跳動（limit cycle）。' })
  else if (Math.abs(pole) >= 1) verdicts.push({ kind: 'danger', text: `極性正確但 $g=\\mu K_qC=${t(1 - pole)}\\ge2$：振盪發散，降低 $\\mu$ 即可。` })
  else verdicts.push({ kind: 'ok', text: `極性正確：$p=${t(pole)}$，平均收斂（polarity margin $${td(margin, 4)}$）。` })
  if (!kqOk && cls !== 'positive') verdicts.push({ kind: 'warn', text: '$\\sigma_v=0$：comparator 是 hard limiter，$K_q$ 與平均 pole 沒有定義（線性化模型不適用）。' })
  if (path.edge) verdicts.push({ kind: 'info', text: '$\\Omega$ 在 0 或 $\\pi$：相關要用 $A^2|H|\\cos\\varphi$（2 倍），而且 $\\varphi$ 只能是 $0^\\circ/180^\\circ$（勘誤 E46）。' })
  return {
    experiment: 'polarity-explorer',
    modelFns: ['polarity.tonePath', 'polarity.toneCorrelation', 'polarity.kqFromSigma', 'polarity.calPole', 'polarity.polarityMarginDeg', 'polarity.toneLargeErrorGain', 'polarity.empiricalLargeErrorGain', 'signal.lfilter'],
    level: 'L2',
    claim: 'exact',
    summary: `$\\varphi=${td(p.phiDeg, 5)}$、$\\Omega=${td(omegaDeg, 5)}/\\text{sample}$、$D=${D}$${fx ? '（filtered-x regressor）' : ''}：$C=${t(Ceff, 4)}$，${kqOk ? `$p=${t(pole)}$` : '$\\sigma_v=0$（$K_q$ 與 pole 沒有定義）'}。`,
    metrics,
    steps,
    stepsTitle: '手算：從 PLL error path 的相位到 LMS 的 pole',
    chart: {
      title: fx ? '$C$ 對 code delay $D$（filtered-x regressor；toneCorrelation）' : '$C_D$ 對 code delay $D$（toneCorrelation）',
      xLabel: 'D（sample）',
      yLabel: 'C_D',
      series: [{ name: fx ? 'C（filtered-x）' : 'C_D（raw/delayed x）', x: Ds, y: Ds.map(sweep), mode: 'lines+markers' }],
      hLines: [{ y: 0, name: 'C = 0' }],
    },
    verdicts,
    notes: ['L2 模型：單頻 code $x=A\\cos\\Omega n$、PLL error path 在該頻率為 $|H|e^{j\\varphi}$、average-mode GMAC。', '閉迴路 Monte Carlo（8 chains）在原頁面的 worker 執行。'],
  }
}

/* ═════════════════════════ L2：Delay / Filtered-x（delay-fx-lab） ═════════════════════════ */

const FX_PATH_KINDS = ['single_tone', 'type2_dt', 'identity'] as const
const FX_CODE_KINDS = ['sinusoid', 'ar1', 'white_pm_one', 'mash111', 'dsm1'] as const
const FX_MODES: readonly RegressorMode[] = ['raw', 'delayed', 'filtered']

const previewDelayFx: Previewer = (prm) => {
  const sc = isObj(prm.scenario) ? prm.scenario : {}
  const pathKind = pick(sc.pathKind, FX_PATH_KINDS, 'single_tone', 'pathKind')
  const codeKind = pick(sc.codeKind, FX_CODE_KINDS, 'sinusoid', 'codeKind')
  const omega = num(sc.omega, Math.PI / 6)
  const path: FxPathSpec =
    pathKind === 'identity'
      ? { kind: 'identity' }
      : pathKind === 'single_tone'
        ? { kind: 'single_tone', magnitude: num(sc.mag, 1), phaseDeg: num(sc.phiDeg, -120), omega }
        : { kind: 'type2_dt', wnTs: num(sc.wnTs, 0.1), zeta: num(sc.zeta, 0.7), loopDelay: int(sc.loopDelay, 0, 0, 64) }
  const code: FxCodeSpec =
    codeKind === 'sinusoid'
      ? { kind: 'sinusoid', omega }
      : codeKind === 'ar1'
        ? { kind: 'ar1', rho: num(sc.rho, 0.9) }
        : codeKind === 'white_pm_one'
          ? { kind: 'white_pm_one' }
          : { kind: codeKind, frac: num(sc.frac, 0.3) } // mash111 / dsm1：DSM 的 DTC phase residue
  const sigmaV = num(sc.sigmaV, 100)
  const Dmax = int(sc.Dmax, 24, 1, 4096)
  const seed = seedOf(prm)
  const rawCases = Array.isArray(prm.cases) ? prm.cases.slice(0, 3) : []
  const defaults = [
    { mode: 'raw', D: 0, mu: 10 },
    { mode: 'delayed', D: 4, mu: 10 },
    { mode: 'filtered', D: 0, mu: 10 },
  ]
  const cases = (rawCases.length ? rawCases : defaults).map((c, i) => {
    const o = isObj(c) ? c : {}
    const mode = pick(o.mode, FX_MODES, 'raw', 'mode')
    const hat: FxHatSpec = {
      base: pick(o.hatBase, ['same', 'second_diff'] as const, 'same', 'hatBase'),
      bwErrPct: num(o.bwErrPct, 0),
      loopDelayErr: int(o.loopDelayErr, 0, -64, 64),
      extraDelay: int(o.extraDelay, 0, 0, 4096),
      phaseErrDeg: num(o.phaseErrDeg, 0),
      gainErrPct: num(o.gainErrPct, 0),
    }
    return { id: CASE_IDS[i], mode, D: mode === 'raw' ? 0 : int(o.D, 0, 0, 4096), mu: num(o.mu, 10), hat }
  })
  const Kq = sigmaV > 0 ? SQRT_2_OVER_PI / sigmaV : NaN
  const C_TOL = 1e-9 // code 皆為單位功率：|C| ≤ 1e-9 視為 0（例如 cos 90° 的浮點殘渣）
  // #region core:previewDelayFx
  const analyses = cases.map((c) => {
    const an = analyzeFxLab({ path, code, mode: c.mode, D: c.D, hat: c.hat, seed, Dmax }) // 與 Lab 同一個函式、同 seed 的 code 序列
    const Craw = an.corr.active.analytic ?? an.corr.active.empirical // 封閉式（DSM code 沒有封閉式時用時間平均）
    const C = Math.abs(Craw) <= C_TOL ? 0 : Craw // 浮點殘渣歸零（數學上恰為 0）
    const pole = 1 - c.mu * Kq * C // ← 差異：同一條 p = 1 − μK_qC，但 C 依 regressor（raw / delayed / filtered）而不同
    return { c, an, C, Craw, analytic: an.corr.active.analytic !== null, pole }
  })
  // #endregion
  const metrics: PreviewMetric[] = []
  const steps: PreviewStep[] = []
  const tone = analyses[0].an.tone
  if (codeKind === 'sinusoid') steps.push({ tex: 'x[n]=\\sqrt2\\cos(\\Omega n)\\;\\Rightarrow\\;E[x^2]=\\tfrac{A^2}{2}=1', why: 'Lab 的 code 皆正規化成單位功率（所以 $C$ 比 T07 的 $A=1$ 版本大 2 倍）。' })
  if (tone)
    steps.push({ tex: `H(e^{j\\Omega})=${texComplex(tone.H, 5)}=|H|e^{j${td(cArg(tone.H) * RAD2DEG, 5)}},\\quad \\Omega=${td(tone.omega * RAD2DEG, 5)}/\\text{sample}`, why: 'PLL error path 在 code 頻率的複數增益（由 pathTransfer 的 b、a 算出）。' })
  for (const r of analyses) {
    const c = r.c
    const tag = `\\;(\\text{${c.id}: ${c.mode}${c.mode === 'raw' ? '' : `, D=${c.D}`}})`
    metrics.push({
      key: `C:${c.id}`,
      label: `C_{\\text{ref}}${tag}`,
      value: r.C,
      claim: r.analytic ? 'exact' : 'approx',
      note: (r.analytic ? '封閉式' : '時間平均（DSM code 沒有封閉式）') + (r.C === 0 && r.Craw !== 0 ? `；浮點值 $${t(r.Craw, 3)}$ 是捨入殘渣，視為 0` : ''),
    })
    metrics.push({ key: `pole:${c.id}`, label: `p=1-\\mu K_qC${tag}`, value: r.pole, claim: 'exact', note: `$\\mu=${t(c.mu)}\\,\\mathrm{fs}$` })
    if (Math.abs(r.pole) < 1 && r.pole > 0) metrics.push({ key: `tau:${c.id}`, label: `\\tau=-1/\\ln p${tag}`, value: -1 / Math.log(r.pole), unit: '\\text{blocks}', claim: 'exact' })
    metrics.push({ key: `rho:${c.id}`, label: `\\rho=C/\\sqrt{E[x_{\\text{ref}}^2]E[u^2]}${tag}`, value: r.an.rhoActive, claim: 'approx', note: 'Cauchy–Schwarz：$|\\rho|\\le1$（經驗值）' })
    const tn = r.an.tone
    if (tn) {
      // 單頻、單位功率 code：C = |H||G|cos θ，G 是 regressor 路徑（raw/delayed：1；filtered：Ĥ），θ = ∠H − ∠G + ΩD（analyzeFxLab 的 tone.thetaDeg）
      const magH = cAbs(tn.H)
      const th = td(snap(tn.thetaDeg, 1, 1e-9), 5)
      if (c.mode === 'filtered') {
        const magG = cAbs(tn.Hhat)
        steps.push(
          r.an.hat.exact
            ? {
                tex: `\\text{${c.id}}:\\ \\hat H=H\\Rightarrow\\theta=\\Omega D=${th},\\ C=E[u_f\\,u]=|H|^2\\cos\\theta=${t(magH * magH, 5)}\\times\\cos(${th})=${t(r.C)}`,
                why: 'filtered-x：用模型 $\\hat H$ 濾過的 code 當 regressor；$\\hat H=H$ 時相位完全抵銷，$C=E[u^2]\\ge0$。',
              }
            : {
                tex: `\\text{${c.id}}:\\ \\theta=\\angle H-\\angle\\hat H+\\Omega D=${th},\\ C=E[u_f\\,u]=|H||\\hat H|\\cos\\theta=${t(magH, 5)}\\times${t(magG, 5)}\\times\\cos(${th})=${t(r.C)}`,
                why: '$\\hat H\\ne H$：有效相關是 $E[u\\,u_f]$，不是 $E[u^2]$；模型與真實路徑的相位差超過 $90^\\circ$ 時，filtered-x 一樣會反向更新（勘誤 E45）。',
              },
        )
      } else {
        steps.push({
          tex: `\\text{${c.id}}:\\ \\theta=\\varphi+\\Omega D=${th},\\ C=|H|\\cos\\theta=${t(magH, 5)}\\times\\cos(${th})=${t(r.C)}`,
          why: c.mode === 'raw' ? 'raw-x：regressor 就是原始 code，殘餘相位就是 $H$ 的相位 $\\varphi$。' : '延遲 $D$ 讓殘餘相位旋轉 $\\Omega D$（角度已折回 $\\pm180^\\circ$）。',
        })
      }
    } else {
      steps.push({ tex: `\\text{${c.id}}:\\ C_{\\text{ref}}=\\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi}S_x(\\Omega)\\,\\mathrm{Re}\\{H\\,G^*\\}\\,d\\Omega=${t(r.C)}`, why: '寬頻 code：每個頻率的相關加起來（Parseval）；$G$ 是 regressor 路徑（延遲或 $\\hat H$）。' })
    }
  }
  const kqOk = Number.isFinite(Kq) // σ_v = 0：hard limiter，K_q 與平均 pole 沒有定義
  steps.push(
    kqOk
      ? { tex: `K_q=\\sqrt{2/\\pi}/\\sigma_v=${t(Kq)}\\ \\mathrm{fs^{-1}},\\quad p=1-\\mu K_qC`, why: `代入各 Case 的 $\\mu$ 與 $C$：${analyses.map((r) => `${r.c.id} → $${t(r.pole)}$`).join('、')}。` }
      : { tex: `\\sigma_v=0\\Rightarrow K_q=\\lim_{\\sigma_v\\to0}\\frac{\\sqrt{2/\\pi}}{\\sigma_v}=\\infty`, why: '沒有雜訊時 comparator 是 hard limiter：小訊號增益與平均 pole 都沒有定義。$C$ 的正負號仍決定 $w$ 朝哪個方向走，但那是固定步幅的移動，不是指數收斂或發散。' },
  )

  const sw = analyses[0].an.sweep.codeDelay
  const swY = Array.from(sw.analytic ?? sw.empirical)
  const verdicts: Verdict[] = analyses.map((r) => {
    const who = `Case ${r.c.id}（${r.c.mode}${r.c.mode === 'raw' ? '' : `、$D=${r.c.D}$`}）`
    if (r.C === 0) return { kind: 'warn' as const, text: `${who}：$C\\approx0$（殘餘相位 $\\pm90^\\circ$ 或寬頻抵銷）：GMAC 沒有恢復力，$w$ 只做 random walk。` }
    if (r.C < 0) return { kind: 'danger' as const, text: `${who}：C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散（$C=${t(r.C, 4)}$${kqOk ? `、$p=${t(r.pole)}$` : ''}）。` }
    if (!kqOk) return { kind: 'warn' as const, text: `${who}：$C=${t(r.C, 4)}>0$（極性正確），但 $\\sigma_v=0$：$K_q$ 與平均 pole 沒有定義（hard limiter），$w$ 以固定步幅靠近 $a$ 後在 $\\pm\\mu$ 的帶內跳動。` }
    if (Math.abs(r.pole) >= 1) return { kind: 'danger' as const, text: `${who}：$g=\\mu K_qC=${t(1 - r.pole)}\\ge2$，振盪發散（降低 $\\mu$）。` }
    return { kind: 'ok' as const, text: `${who}：$C=${t(r.C, 4)}>0$，$p=${t(r.pole)}$。` }
  })
  for (const w of analyses[0].an.warnings.slice(0, 3)) verdicts.push({ kind: 'info', text: w })
  return {
    experiment: 'delay-fx-lab',
    modelFns: ['filteredX.analyzeFxLab', 'filteredX.pathTransfer', 'filteredX.buildHat', 'blockLms.generateCodePattern'],
    level: 'L2',
    claim: 'exact',
    summary: `${pathKind === 'single_tone' ? `單頻路徑 $|H|e^{j\\varphi}$` : pathKind === 'type2_dt' ? 'Type-II DT 迴路的 $H_{PD}$' : '$H=1$'}、code ${codeKind}：${analyses.map((r) => `${r.c.id} 的 $C=${t(r.C, 4)}$`).join('、')}。`,
    metrics,
    steps,
    stepsTitle: '手算：三種 regressor 的有效相關與 pole',
    chart: { title: '$C_D$ 對 code delay $D$（Case A 的路徑與 code）', xLabel: 'D（sample）', yLabel: 'C_D', series: [{ name: sw.analytic ? 'C_D（封閉式）' : 'C_D（時間平均）', x: Array.from(analyses[0].an.sweep.D), y: swY, mode: 'lines+markers' }], hLines: [{ y: 0, name: 'C = 0' }] },
    verdicts,
    notes: ['code 正規化為 $E[x^2]=1$；$K_q$ 用小訊號近似（$|\\delta|\\ll\\sigma_v$）。', '閉迴路 Block Sign-LMS（paired seed）在原頁面的 worker 執行；這裡只算平均 pole。'],
    seed,
  }
}

/* ═════════════════════════ L1：Phase margin（pm-lab） ═════════════════════════ */

const previewPmLab: Previewer = (p) => {
  const g = num(p.g, 1)
  const d = int(p.d, 0, 0, 12)
  const steps = int(p.steps, 60, 5, 2000)
  // #region core:previewPm
  const pm = pmWithDelay(g, d) // ω_c = 2asin(g/2)、PM_d = 90° − (2d+1)asin(g/2)、GM = g*/g
  const st = delayStable(g, d) // ← 差異：更新延遲 d ⇒ 有 d + 1 個 pole，要解 z^{d+1} − z^d + g = 0
  const run = simulateDelayRecursion(g, d, steps) // δ_{k+1} = δ_k − g δ_{k−d}
  // #endregion
  const gStar = delayCriticalGain(d)
  // gain crossover 只在 0 < g ≤ 2 存在（|L(e^{jω})| = g/(2 sin(ω/2)) 的最小值是 g/2）；不存在時 ω_c、PM、GM 都沒有定義
  const hasCross = Number.isFinite(pm.omegaC)
  const noCrossNote = g <= 0 ? '$g\\le0$：沒有 gain crossover（極性反了，要看 pole）' : '$g>2$：$|L|$ 在所有頻率都大於 1，沒有 gain crossover'
  // 臨界點上的 PM、GM、delay margin 數學上恰為 0；浮點會留下 1e-14 等級的殘渣
  const pmDeg = snap(pm.pmDeg, 1, 1e-9)
  const gmDb = snap(pm.gmDb, 1, 1e-9)
  const dmBlocks = snap(pm.delayMarginBlocks, 1, 1e-9)
  const metrics: PreviewMetric[] = [
    { key: 'rho', label: '\\rho=\\max|z_i|', value: st.rho, claim: 'exact', note: st.marginal ? '臨界（不可視為穩定）' : st.stable ? '穩定' : '不穩定' },
    { key: 'gCrit', label: 'g^*=2\\sin\\frac{\\pi}{4d+2}', value: gStar, claim: 'exact' },
    { key: 'omegaC', label: '\\omega_c=2\\arcsin(g/2)', value: pm.omegaC, unit: '\\mathrm{rad/block}', claim: 'exact', note: hasCross ? undefined : noCrossNote },
    { key: 'pm', label: '\\mathrm{PM}_d=90^\\circ-(2d+1)\\arcsin(g/2)', value: pmDeg, unit: '^\\circ', claim: 'exact', note: hasCross ? 'T08：$g=1,d=0$ 時 $60^\\circ$' : noCrossNote },
    { key: 'gm', label: '\\mathrm{GM}=20\\log_{10}(g^*/g)', value: gmDb, unit: '\\mathrm{dB}', claim: 'exact', note: g > 0 ? undefined : '$g\\le0$ 時沒有定義' },
    { key: 'delayMargin', label: '\\mathrm{PM}/\\omega_c', value: dmBlocks, unit: '\\text{blocks}', claim: 'exact', note: hasCross ? '還能多容忍的純延遲' : noCrossNote },
  ]
  if (d === 0) metrics.unshift({ key: 'pole', label: 'p=1-g', value: 1 - g, claim: 'exact' })
  const sorted = [...st.roots].sort((u, v) => cAbs(v) - cAbs(u))
  const verdicts: Verdict[] = []
  if (g === 0) verdicts.push({ kind: 'warn', text: '$g=0$（$\\mu=0$ 或 $C=0$）：$p=1$，參數完全不動——沒有恢復力，也沒有 gain crossover。' })
  else if (g < 0) verdicts.push({ kind: 'danger', text: `$g=${t(g)}<0$：更新極性錯誤（例如 $C<0$），$p=1-g>1$，沒有 gain crossover。` })
  else if (st.marginal) verdicts.push({ kind: 'warn', text: `$g=${t(g)}$ 恰在臨界 $g^*(${d})=${t(gStar)}$：$\\rho=1$，標成 marginal，不可宣稱穩定。` })
  else if (!st.stable) verdicts.push({ kind: 'danger', text: `$g=${t(g)}>g^*(${d})=${t(gStar)}$：$\\rho=${t(st.rho)}>1$，只因為 $d=${d}$ 個 block 的更新延遲就發散。` })
  else verdicts.push({ kind: 'ok', text: `$\\rho=${t(st.rho)}<1$：穩定${hasCross ? `，PM $=${td(pmDeg, 4)}$` : ''}。` })
  const crossSteps: PreviewStep[] = hasCross
    ? [
        { tex: `|L|=1\\Rightarrow 2\\sin\\frac{\\omega_c}{2}=g\\Rightarrow\\omega_c=2\\arcsin\\frac{${t(g)}}{2}=${t(pm.omegaC)}\\ \\mathrm{rad/block}`, why: '解 gain crossover（$0<g\\le2$ 才有解）。' },
        {
          tex: `\\angle L=-90^\\circ-\\left(d+\\tfrac12\\right)\\omega_c\\Rightarrow \\mathrm{PM}=90^\\circ-(2d+1)\\arcsin\\frac g2=90^\\circ-${2 * d + 1}\\times${td(Math.asin(g / 2) * RAD2DEG, 5)}=${td(pmDeg, 5)}`,
          why: '$1/(e^{j\\omega}-1)$ 的相位是 $-90^\\circ-\\omega/2$，再加上延遲 $-d\\omega$；PM $=180^\\circ+\\angle L(e^{j\\omega_c})$。',
        },
      ]
    : [
        {
          tex: g <= 0 ? `|L|=1\\Rightarrow 2\\sin\\frac{\\omega}{2}=g=${t(g)}\\le0\\quad(\\text{無解})` : `|L|=1\\Rightarrow 2\\sin\\frac{\\omega}{2}=g=${t(g)}>2\\quad(\\text{無解})`,
          why:
            g <= 0
              ? '$0<\\omega\\le\\pi$ 時 $2\\sin(\\omega/2)>0$：$g\\le0$ 沒有 gain crossover，PM 沒有定義。$g<0$ 代表更新極性反了（負回授變成正回授）、$g=0$ 代表迴路根本沒有在更新；直接看下一行的 pole。'
              : '$2\\sin(\\omega/2)\\le2$：$g>2$ 時 $|L|$ 在所有頻率都大於 1（$\\omega=\\pi$ 時 $|L|=g/2$），沒有 gain crossover，PM 沒有定義；穩定與否直接看 pole。',
        },
      ]
  return {
    experiment: 'pm-lab',
    modelFns: ['stability.pmWithDelay', 'stability.delayStable', 'stability.simulateDelayRecursion', 'stability.delayCriticalGain'],
    level: 'L1',
    claim: 'exact',
    summary: `$L(z)=g\\,z^{-d}/(z-1)$，$g=${t(g)}$、$d=${d}$：$\\rho=${t(st.rho)}$${hasCross ? `、PM $=${td(pmDeg, 4)}$` : '（沒有 gain crossover，PM 沒有定義）'}。`,
    metrics,
    steps: [
      { tex: `L(e^{j\\omega})=\\frac{g\\,e^{-jd\\omega}}{e^{j\\omega}-1},\\quad |e^{j\\omega}-1|=2\\sin\\frac{\\omega}{2}`, why: '延遲只改相位、不改大小。' },
      ...crossSteps,
      { tex: `${zPow(d + 1)}-${zPow(d)}+${ta(g)}=0\\;\\Rightarrow\\;\\max|z|=${t(st.rho)}`, why: `閉迴路特徵式 $z^{d+1}-z^d+g=0$（$d=${d}$）；最大的根 $${texComplex(sorted[0] ?? { re: NaN, im: 0 })}$（polyRoots 求根，不用封閉式）。` },
      { tex: `g^*(d)=2\\sin\\frac{\\pi}{4d+2}=${t(gStar)}`, why: `把 $z=e^{j\\omega}$ 代入特徵式，取大小與角度兩條條件；$0<g<g^*$ 才穩定${g > 0 && Number.isFinite(gmDb) ? `（本例 GM $=20\\log_{10}(g^*/g)=${t(gmDb, 4)}$ dB）` : ''}。` },
    ],
    stepsTitle: '手算：一階校正迴路的 PM 與更新延遲',
    chart: { title: '$\\delta_k/\\delta_0$ 時域（simulateDelayRecursion）', xLabel: 'k（block）', yLabel: 'δ_k / δ_0', series: [{ name: 'δ_k', x: range(steps + 1), y: Array.from(run.delta), mode: steps <= 60 ? 'lines+markers' : 'lines' }], hLines: [{ y: 0, name: '0' }] },
    verdicts,
    notes: ['L1 模型：$K$ 已併入 $g=\\mu K$；$\\delta_{k+1}=\\delta_k-g\\,\\delta_{k-d}$。', 'Monte Carlo（真正的 block sign-LMS）在原頁面。'],
  }
}

/* ═════════════════════════ L2：Dual loop（dual-loop） ═════════════════════════ */

const previewDualLoop: Previewer = (p) => {
  const steps = int(p.steps, 300, 10, 5000)
  const mu = num(p.mu, 1.2)
  const dualMode = pick(p.mode, ['two-state', 'general'] as const, 'two-state', 'mode')
  if (dualMode === 'general') {
    const A = Array.isArray(p.A) ? (p.A as unknown[]).map((r) => (Array.isArray(r) ? r.map((v) => num(v, 0)) : [])) : [[0.8]]
    const b = Array.isArray(p.b) ? (p.b as unknown[]).map((v) => num(v, 0)) : [0.2]
    const c = Array.isArray(p.c) ? (p.c as unknown[]).map((v) => num(v, 0)) : [1]
    const sys = { A, b, c, d: num(p.d, 0) }
    const ga = analyzeGeneral(sys, mu)
    const sim = simulateGeneral(sys, mu, steps)
    const verdicts: Verdict[] = [
      ga.stable ? { kind: 'ok', text: `$\\rho(A_{\\text{comb}})=${t(ga.rho)}<1$：完整模型穩定。` } : { kind: 'danger', text: `$\\rho(A_{\\text{comb}})=${t(ga.rho)}\\ge1$：完整模型${ga.marginal ? '臨界' : '發散'}。` },
    ]
    if (Number.isFinite(ga.dcGain) && Math.abs(ga.simplifiedPole) < 1 && !ga.stable) verdicts.push({ kind: 'warn', text: `quasi-static 預測 pole $${t(ga.simplifiedPole)}$（穩定），但完整模型不穩定。` })
    return {
      experiment: 'dual-loop',
      modelFns: ['stability.combinedMatrix', 'stability.analyzeGeneral', 'stability.simulateGeneral'],
      level: 'L2',
      claim: 'exact',
      summary: `一般化觀測模型（$n=${A.length}$ 個狀態）、$\\mu=${t(mu)}$：$\\rho=${t(ga.rho)}$。`,
      metrics: [
        { key: 'rho', label: '\\rho(A_{\\text{comb}})', value: ga.rho, claim: 'exact' },
        { key: 'observerRho', label: '\\rho(A_s)', value: ga.observerRho, claim: 'exact', note: '觀測狀態自己的 pole' },
        { key: 'dcGain', label: 'F(1)=d_s+c_s^T(I-A_s)^{-1}b_s', value: ga.dcGain, claim: 'exact', note: '等效 $K$' },
        { key: 'simplifiedPole', label: '1-\\mu F(1)', value: ga.simplifiedPole, claim: 'approx', note: 'quasi-static（時間尺度分離）' },
        { key: 'simplifiedMuMax', label: '2/F(1)', value: ga.simplifiedMuMax, claim: 'approx' },
      ],
      steps: [
        { tex: `A_{\\text{comb}}=\\begin{bmatrix}A_s&b_s\\\\-\\mu c_s^T&1-\\mu d_s\\end{bmatrix}`, why: '狀態 $[s_k;\\delta_k]$：觀測狀態與校正誤差一起更新（勘誤 E31 的符號）。' },
        { tex: `\\operatorname{eig}(A_{\\text{comb}})=\\{${ga.poles.map((z) => texComplex(z, 4)).join(',\\ ')}\\}`, why: 'eigvals（Hessenberg + shifted QR）。' },
        { tex: `F(1)=${t(ga.dcGain)}\\Rightarrow 1-\\mu F(1)=${t(ga.simplifiedPole)}`, why: '若觀測瞬間到穩態，校正迴路只看到 DC 增益。' },
      ],
      stepsTitle: '手算：完整模型對 quasi-static',
      chart: { title: '$\\delta_k$（完整模型）', xLabel: 'k（block）', yLabel: 'δ_k', series: [{ name: '完整模型', ...thin(sim.delta) }] },
      verdicts,
      notes: ['L2 模型：觀測路徑以 state-space $(A_s,b_s,c_s,d_s)$ 表示，平均（無雜訊）動態。'],
    }
  }
  const r = num(p.r, 0.8)
  const b = num(p.b, 0.2)
  const c = num(p.c, 1)
  const prm = { r, b, c, mu }
  // #region core:previewDualLoop
  const an = analyzeDualLoop(prm) // ← 差異：兩個狀態 [s; δ] ⇒ z² − (1 + r)z + (r + μbc) = 0 的兩個根（另含 Jury 區間、quasi-static pole）
  const full = simulateFullModel(prm, steps) // s 有記憶：s_{k+1} = r s_k + b δ_k
  const qs = simulateQuasiStatic(prm, steps) // 假設 s 瞬間到穩態
  // #endregion
  const z0 = an.poles[0]
  const complex = Math.abs(z0.im) > 1e-12
  const absDelta = Array.from(full.delta, (v) => Math.abs(v))
  const k100 = Math.min(100, steps)
  let peakLast = NaN
  if (complex) {
    const period = (2 * Math.PI) / Math.abs(cArg(z0))
    const lo = Math.max(0, Math.floor(k100 - period))
    peakLast = Math.max(...absDelta.slice(lo, k100 + 1))
  }
  const metrics: PreviewMetric[] = [
    { key: 'a1', label: '-(1+r)', value: -(1 + r), claim: 'exact' },
    { key: 'a0', label: 'r+\\mu bc', value: r + mu * b * c, claim: 'exact' },
    { key: 'poleRe', label: '\\mathrm{Re}\\,z', value: z0.re, claim: 'exact' },
    { key: 'poleIm', label: '|\\mathrm{Im}\\,z|', value: Math.abs(z0.im), claim: 'exact' },
    { key: 'rho', label: '\\rho=\\max|z|', value: an.rho, claim: 'exact', note: 'T09' },
    { key: 'simplifiedPole', label: '1-\\mu bc/(1-r)', value: an.simplifiedPole, claim: 'approx', note: 'quasi-static' },
    { key: 'muFullHi', label: '\\mu_{\\max}^{\\text{full}}=(1-r)/(bc)', value: an.fullRange.hi, claim: 'exact', note: 'Jury 條件' },
    { key: 'muQsHi', label: '\\mu_{\\max}^{\\text{qs}}=2(1-r)/(bc)', value: an.simplifiedRange.hi, claim: 'approx' },
    { key: 'muComplex', label: '\\mu_{\\mathbb C}=(1-r)^2/(4bc)', value: an.muComplex, claim: 'exact', note: '超過後 poles 變複數' },
    { key: 'delta100', label: `|\\delta_{${k100}}|`, value: absDelta[k100], claim: 'exact', note: '單一時間點（可能剛好在零交越附近）' },
  ]
  if (complex) metrics.push({ key: 'peakLast', label: `\\max_{\\text{最後一週期}\\le ${k100}}|\\delta_k|`, value: peakLast, claim: 'exact', note: '同一週期的峰值才是包絡線' })
  metrics.push({ key: 'deltaEnd', label: `|\\delta_{${steps}}|`, value: absDelta[steps], claim: 'exact' })
  const verdicts: Verdict[] = []
  if (an.stable) verdicts.push({ kind: 'ok', text: `完整模型 $\\rho=${t(an.rho)}<1$：穩定。` })
  else verdicts.push({ kind: 'danger', text: `完整模型 $\\rho=${t(an.rho)}${an.marginal ? '=1（臨界）' : '>1'}$${an.simplifiedStable ? `，但 quasi-static 預測 pole $${t(an.simplifiedPole)}$ 是穩定的——時間尺度分離在這裡失效（勘誤 E19）` : ''}。` })
  if (complex && !an.stable && absDelta[k100] < peakLast / 3) verdicts.push({ kind: 'warn', text: `$|\\delta_{${k100}}|=${t(absDelta[k100], 3)}$ 看似很小，只是剛好在振盪的零交越附近；同一週期峰值已是 $${t(peakLast, 3)}$。短視窗會誤判為收斂。` })
  return {
    experiment: 'dual-loop',
    modelFns: ['stability.analyzeDualLoop', 'stability.dualLoopCharPoly', 'stability.dualLoopFullMuRange', 'stability.simulateFullModel', 'stability.simulateQuasiStatic'],
    level: 'L2',
    claim: 'exact',
    summary: `$r=${t(r)},\\ b=${t(b)},\\ c=${t(c)},\\ \\mu=${t(mu)}$：完整 poles $${texComplex(z0)}$，$|z|=${t(an.rho)}$；${Number.isFinite(an.simplifiedPole) ? `quasi-static pole $${t(an.simplifiedPole)}$` : 'quasi-static 近似不存在（$r=1$）'}。`,
    metrics,
    steps: [
      { tex: `s_{k+1}=r\\,s_k+b\\,\\delta_k,\\qquad \\delta_{k+1}=\\delta_k-\\mu c\\,s_k`, why: '主迴路殘差 $s$ 有記憶（pole $r$）；GMAC 看到的是上一個 block 的 $s_k$。' },
      { tex: `\\det(zI-A)=(z-r)(z-1)+\\mu bc=z^2-(1+r)z+(r+\\mu bc)=z^2${signedTerm(-(1 + r), 'z')}${signedTerm(r + mu * b * c, '')}`, why: '$A=\\begin{bmatrix}r&b\\\\-\\mu c&1\\end{bmatrix}$ 的特徵多項式（2×2 行列式：對角相乘減反對角相乘）。' },
      { tex: `\\Delta=(1+r)^2-4(r+\\mu bc)=(1-r)^2-4\\mu bc=${t(an.discriminant)}${an.discriminant < 0 ? '<0' : '\\ge0'}`, why: an.discriminant < 0 ? '二次方程式的判別式為負：一對共軛複數 pole（會振盪）。' : '判別式非負：兩個實數 pole。' },
      complex
        ? {
            tex: `z=\\frac{(1+r)\\pm j\\sqrt{-\\Delta}}{2}=${t((1 + r) / 2)}\\pm j${t(Math.sqrt(-an.discriminant) / 2, 5)},\\quad |z|^2=z\\bar z=r+\\mu bc=${t(r + mu * b * c)}\\Rightarrow|z|=${t(an.rho)}`,
            why: '公式解；共軛根的乘積等於常數項（Vieta），所以 $|z|$ 只由 $r+\\mu bc$ 決定。',
          }
        : { tex: `z_{1,2}=\\frac{(1+r)\\pm\\sqrt{\\Delta}}{2}=${an.poles.map((z) => t(z.re)).join(',\\ ')}`, why: '公式解：兩個實根。' },
      Number.isFinite(an.simplifiedPole)
        ? { tex: `s\\approx\\frac{b\\,\\delta}{1-r}\\Rightarrow p_{\\text{qs}}=1-\\frac{\\mu bc}{1-r}=${t(an.simplifiedPole)}`, why: 'quasi-static：假設 $s$ 瞬間到穩態，只剩一階遞迴。' }
        : { tex: `r=${t(r)}\\;\\Rightarrow\\;s_{k+1}=s_k+b\\,\\delta_k\\ \\text{沒有穩態}\\quad(\\text{quasi-static 近似不存在})`, why: '$r=1$ 時主迴路殘差是純積分器，$s\\approx b\\delta/(1-r)$ 要除以 0：不能用「$s$ 瞬間到穩態」來簡化，只能看完整模型。' },
      {
        tex: `0<\\mu bc<1-r\\ (\\text{full})\\quad\\text{vs}\\quad 0<\\mu bc<2(1-r)\\ (\\text{qs})`,
        why: 'Jury 條件（常數項 $r+\\mu bc<1$）給出完整模型的上界，正好是 quasi-static 的一半，而且與 $r$ 無關：差的那 2 倍來自「$\\delta_k$ 要經過 $s_{k+1}$ 才被 GMAC 看到」的一個 block 延遲，不是主迴路不夠快（勘誤 E19）。',
      },
    ],
    stepsTitle: '手算：完整二狀態模型對 quasi-static',
    chart: {
      title: '$|\\delta_k|$：完整模型對 quasi-static（同一組參數）',
      xLabel: 'k（block）',
      yLabel: '|δ_k|',
      yLog: true,
      series: [
        { name: '完整模型', ...thin(absDelta) },
        { name: 'quasi-static', ...thin(Array.from(qs, (v) => Math.abs(v))) },
      ],
    },
    verdicts,
    notes: ['L2 模型：平均（無雜訊）動態、$\\delta_0=1$、$s_0=0$；$\\mu$ 為正規化步長（$K\\equiv1$，勘誤 E13）。'],
  }
}

/* ═════════════════════════ L3：PE / eigen（pe-eigen-lab） ═════════════════════════ */

const previewPeEigen: Previewer = (p) => {
  const rho = Math.min(1, Math.max(-1, num(p.rho, 0.99)))
  const dist = pick(p.dist, ['gaussian', 'pm1'] as const, 'gaussian', 'dist') as RegressorDist
  const detector = pick(p.detector, ['linear', 'sign'] as const, 'linear', 'detector') as Detector
  const sigmaV = Math.max(0, num(p.sigmaV, 0))
  const kqMode = pick(p.kqMode, ['normalized', 'physical'] as const, 'normalized', 'kqMode')
  const muInput = num(p.muInput, 0.5)
  const N = int(p.N, 16, 1, 4096)
  const N0 = int(p.N0, 100, 2, 20000)
  const blocks = int(p.blocks, 800, 10, 3000)
  const d0 = [num(p.d10, 1), num(p.d20, 0)]
  // K_q 正規化（勘誤 E05）：linear ⇒ K_q ≡ 1；sign + normalized ⇒ 輸入就是 g；sign + physical ⇒ g = μK_q
  const Kq = detector === 'linear' ? 1 : comparatorKq(sigmaV)
  if (detector === 'sign' && kqMode === 'physical' && !(sigmaV > 0))
    throw new UnsupportedPreview('σ_v = 0：sign detector 的 K_q = √(2/π)/σ_v 沒有定義（hard limiter），物理單位的 g = μK_q 無法計算；請把 K_q 模式改成「正規化」（直接輸入 g），或設定 σ_v > 0。')
  const g = detector === 'linear' || kqMode === 'normalized' ? muInput : muInput * Kq
  // #region core:previewPe
  const an = peAnalytic({ rho, dist, g, N, N0, detector }) // ← 差異：每個 eigenvalue λ_i = 1 ± ρ 各一個 pole p_i = 1 − gλ_i（另含 k₉₅、mean-square 半徑）
  const traj = meanTrajectory(corr2(rho), g, d0, blocks) // E[δ_{k+1}] = (I − gR)E[δ_k]
  // #endregion
  const metrics: PreviewMetric[] = [
    { key: 'lamMax', label: '\\lambda_{\\max}=1+|\\rho|', value: an.modes.lambdas[0], claim: 'exact', note: 'T10' },
    { key: 'lamMin', label: '\\lambda_{\\min}=1-|\\rho|', value: an.modes.lambdas[1], claim: 'exact' },
    { key: 'kappa', label: '\\kappa=\\lambda_{\\max}/\\lambda_{\\min}', value: an.modes.kappa, claim: 'exact' },
    { key: 'g', label: 'g=\\mu K_q', value: g, claim: 'exact', note: detector === 'linear' ? 'linear detector：$K_q\\equiv1$' : kqMode === 'normalized' ? '正規化輸入（$\\mu=g/K_q$）' : `物理單位：$K_q=${t(Kq)}\\,\\mathrm{fs^{-1}}$` },
    { key: 'pFast', label: 'p_{\\text{fast}}=1-g\\lambda_{\\max}', value: an.pFast, claim: 'exact' },
    { key: 'pSlow', label: 'p_{\\text{slow}}=1-g\\lambda_{\\min}', value: an.pSlow, claim: 'exact', note: 'T11' },
    { key: 'k95Slow', label: 'k_{95}=\\lceil\\ln0.05/\\ln|p_{\\text{slow}}|\\rceil', value: an.k95Slow, unit: '\\text{blocks}', claim: 'exact' },
    { key: 'k95SlowReal', label: '\\ln0.05/\\ln|p_{\\text{slow}}|', value: an.k95SlowReal, claim: 'exact' },
    { key: 'msRadius', label: '\\rho_{\\text{MS}}', value: an.msRadius, claim: detector === 'linear' ? 'exact' : 'approx', note: `mean-square 半徑（$N=${N}$；勘誤 E23）` },
    { key: 'gOpt', label: 'g^*=2/(\\lambda_{\\max}+\\lambda_{\\min})', value: an.gOpt, claim: 'exact', note: '單一 scalar 步長的最佳值' },
  ]
  if (detector === 'sign') metrics.splice(3, 0, { key: 'Kq', label: 'K_q=\\sqrt{2/\\pi}/\\sigma_v', value: Kq, unit: '\\mathrm{fs^{-1}}', claim: 'approx' })
  if (dist === 'pm1') metrics.push({ key: 'degenerate', label: `P(\\lambda_{\\min}(R_k)=0),\\ N_0=${N0}`, value: an.degenerateProb, claim: 'exact', note: '±1 code 的退化窗口機率' })
  const lamMinZero = Math.abs(rho) >= 1
  const verdicts: Verdict[] = []
  if (lamMinZero) verdicts.push({ kind: 'danger', text: `λ_min = 0：不可辨識——$\\rho=${t(rho)}$ 時兩個 regressor 完全相同（或相反），$(1,${rho > 0 ? '-1' : '1'})$ 方向永遠學不到，停在初值。` })
  else if (an.meanRadius >= 1) verdicts.push({ kind: 'danger', text: `$\\max|p_i|=${t(an.meanRadius)}\\ge1$：$g$ 太大，快模式發散。` })
  else verdicts.push({ kind: 'ok', text: `平均遞迴穩定；慢模式要 $${t(an.k95Slow)}$ 個 block 才衰減 95%（$\\kappa=${t(an.modes.kappa, 4)}$）。` })
  if (Math.abs(rho) < 1 && an.meanRadius < 1 && an.msRadius > 1 + 1e-9) verdicts.push({ kind: 'warn', text: `mean-square 半徑 $${t(an.msRadius, 5)}\\ge1$：平均收斂但均方發散（勘誤 E23；把 $N$ 加大）。` })
  return {
    experiment: 'pe-eigen-lab',
    modelFns: ['pe.peAnalytic', 'pe.eigenModes', 'pe.eig2x2', 'pe.meanSquareRadius', 'pe.meanTrajectory'],
    level: 'L3',
    claim: 'exact',
    summary: `$R=\\begin{bmatrix}1&${t(rho)}\\\\${t(rho)}&1\\end{bmatrix}$、$g=${t(g)}$：慢 pole $${t(an.pSlow)}$，${lamMinZero ? '$\\lambda_{\\min}=0$，那個方向永遠不收斂' : `$k_{95}=${t(an.k95Slow)}$ blocks`}。`,
    metrics,
    steps: [
      { tex: `\\det(R-\\lambda I)=(1-\\lambda)^2-\\rho^2=0\\Rightarrow\\lambda=1\\pm\\rho=${t(snap(an.modes.lambdas[0]))},\\ ${t(snap(an.modes.lambdas[1]))}`, why: '2×2 對稱矩陣的 eigenvalue（Jacobi 數值結果與閉式一致）。' },
      {
        tex: `R\\begin{bmatrix}1\\\\1\\end{bmatrix}=(1+\\rho)\\begin{bmatrix}1\\\\1\\end{bmatrix},\\qquad R\\begin{bmatrix}1\\\\-1\\end{bmatrix}=(1-\\rho)\\begin{bmatrix}1\\\\-1\\end{bmatrix}`,
        why: `直接相乘驗證 eigenvector：共模 $(1,1)$ 與差模 $(1,-1)$。$\\rho${rho >= 0 ? '>0' : '<0'}$ 時${rho >= 0 ? '差模' : '共模'}的 eigenvalue 小——兩個 regressor 幾乎一樣（或相反），這個方向的誤差幾乎不改變 PD 看到的訊號，所以學得慢。`,
      },
      lamMinZero
        ? { tex: `\\lambda_{\\min}=0\\;\\Rightarrow\\;\\kappa=\\frac{\\lambda_{\\max}}{\\lambda_{\\min}}\\to\\infty`, why: '完全缺乏 persistent excitation：有一個方向 GMAC 完全沒有反應。' }
        : { tex: `\\kappa=\\frac{\\lambda_{\\max}}{\\lambda_{\\min}}=\\frac{${t(an.modes.lambdas[0])}}{${t(an.modes.lambdas[1])}}=${t(an.modes.kappa)}`, why: 'condition number：快慢模式差幾倍。' },
      {
        tex: `E[\\delta_{k+1}]=(I-gR)\\,E[\\delta_k],\\quad g=\\mu K_q=${detector === 'sign' && kqMode === 'physical' ? `${ta(muInput)}\\times${ta(Kq)}=` : ''}${t(g)}`,
        why: `平均遞迴（勘誤 E05：$K_q$ 要寫出來）。${detector === 'linear' ? 'linear detector：$K_q\\equiv1$。' : kqMode === 'normalized' ? '這裡輸入的就是正規化後的 $g$。' : '物理單位：$\\mu$ 是 fs、$K_q$ 是 $\\mathrm{fs^{-1}}$。'}`,
      },
      { tex: `p_i=1-g\\lambda_i:\\ ${t(snap(an.pFast))},\\ ${t(an.pSlow)}`, why: '在 eigenvector 座標下兩個模式各自獨立衰減。' },
      lamMinZero
        ? { tex: `p_{\\text{slow}}=1-g\\cdot0=1\\;\\Rightarrow\\;|p_{\\text{slow}}|^k=1\\ \\ \\forall k\\quad(k_{95}\\ \\text{不存在})`, why: 'pole 恰好在 1：那個方向的誤差永遠停在初值，不發散也不收斂——這就是「不可辨識」。' }
        : { tex: `k_{95}=\\left\\lceil\\frac{\\ln0.05}{\\ln|p_{\\text{slow}}|}\\right\\rceil=\\lceil${t(an.k95SlowReal)}\\rceil=${t(an.k95Slow)}`, why: '$|p|^k\\le0.05$ 取對數（$\\ln|p|<0$，不等號翻轉）。' },
    ],
    stepsTitle: '手算：eigenvalue、pole 與 95% 衰減步數',
    chart: {
      title: '平均軌跡 $E[\\boldsymbol\\delta_k]$（meanTrajectory）',
      xLabel: 'k（block）',
      yLabel: 'E[δ_i]',
      series: [
        { name: 'E[δ_1]', ...thin(traj[0]) },
        { name: 'E[δ_2]', ...thin(traj[1]) },
      ],
      hLines: [{ y: 0, name: '0' }],
    },
    verdicts,
    notes: ['L3 模型：兩個單位功率 regressor、相關係數 $\\rho$；這是 mean recursion，個別軌跡（尤其 ±1 code）會呈階梯狀。', 'Monte Carlo（chains、滑動窗口 $\\lambda_{\\min}$）在原頁面的 worker 執行。'],
  }
}

/* ═════════════════════════ L3：Gauge（gauge-one-hot） ═════════════════════════ */

/** 與 Gauge Lab 相同的兩組 LMS 初值（只影響 demo 軌跡，不影響 R、eigenvalue 與 null space） */
const GAUGE_W0_A = [0, 0, 0, 0, 0]
const GAUGE_W0_B = [0.8, -0.3, 0.1, 0.4, -0.2]

const previewGauge: Previewer = (p) => {
  const dcNull = bool(p.dcNull, false)
  const prm = {
    b: num(p.b, 0.3),
    a: [num(p.a0, 1), num(p.a1, -0.5), num(p.a2, 0.2), num(p.a3, 0.7)],
    c: num(p.c, 0.9),
    dB: num(p.dB, 0.4),
    path: dcNull ? pick(p.pathType, ['type1', 'type2'] as const, 'type2', 'pathType') : ('none' as const),
    pllMethod: pick(p.pllMethod, ['dpll', 'bilinear'] as const, 'dpll', 'pllMethod'),
    wnTs: num(p.wnTs, 0.05),
    zeta: num(p.zeta, 0.7),
    hpPole: num(p.hpPole, 0.95),
    sequence: pick(p.sequence, ['random', 'cyclic'] as const, 'random', 'sequence'),
    T: int(p.T, 20000, 2000, 400000),
    skip: int(p.skip, 2000, 0, 50000),
    mu: num(p.mu, 0.5),
    N: int(p.N, 64, 1, 1024),
    blocks: int(p.blocks, 150, 10, 2000),
    sigmaV: Math.max(0, num(p.sigmaV, 0.02)),
    gmacReg: pick(p.gmacReg, ['raw', 'filtered'] as const, 'raw', 'gmacReg'),
    w0A: GAUGE_W0_A,
    w0B: GAUGE_W0_B,
    seed: seedOf(p),
  }
  // #region core:previewGauge
  const res = gaugeAnalysis(prm) // 兩組參數同輸出、R_x / R_u 的 eigenvalue 與 null space、LMS demo
  // #endregion
  const n = res.nullRx.length ? res.nullRx.map((row) => row[0]) : []
  const nNorm = Math.hypot(...n)
  const nHat = n.map((v) => (n[0] < 0 ? -v : v) / (nNorm || 1))
  const zerosRu = res.eigRu.filter((v) => Math.abs(v) < 1e-9 * Math.max(1, Math.abs(res.eigRu[0] ?? 1))).length
  const metrics: PreviewMetric[] = [
    { key: 'maxDiffGauge', label: "\\max|y_\\theta-y_{\\theta'}|", value: res.maxDiffRawGauge, claim: 'exact', note: "$\\theta'=\\theta+c(1,-1,-1,-1,-1)$：只剩浮點捨入" },
    { key: 'maxDiffB', label: "\\max|y_\\theta-y_{\\theta''}|", value: res.maxDiffRawB, claim: 'exact', note: "$\\theta''$ 只動 $b$：輸出確實不同" },
    ...res.eigRxAnalytic.map((v, i) => ({ key: `eigRxA${i}`, label: `\\lambda_{${i + 1}}(R_x)\\ (\\text{解析})`, value: v, claim: 'exact' as ClaimKind })),
    ...res.eigRx.map((v, i) => ({ key: `eigRx${i}`, label: `\\lambda_{${i + 1}}(\\hat R_x)\\ (\\text{${prm.T - prm.skip} 樣本})`, value: v, claim: 'approx' as ClaimKind })),
  ]
  if (dcNull) metrics.push({ key: 'zerosRu', label: '\\#\\{\\lambda(R_u)\\approx0\\}', value: zerosRu, claim: 'exact', note: '$H_{PD}(1)=0$：$b$ 也看不到（勘誤 E04）' })
  res.lms.runs.forEach((run, i) => {
    const np = run.nullProj
    const id = CASE_IDS[i] ?? String(i) // gaugeAnalysis 的 run 依序是 A、B（raw domain）與 C（u-domain，若有）
    metrics.push({
      key: `nullDrift:${id}`,
      label: `\\max_k|\\hat n^T w_k-\\hat n^T w_0|\\ (\\text{run ${id}})`,
      value: Math.max(...Array.from(np, (v) => Math.abs(v - np[0]))),
      claim: run.domain === 'raw' ? 'exact' : 'approx',
      note: `${run.label}——${run.domain === 'raw' ? 'raw domain：null 分量凍結在初值' : 'u-domain'}`,
    })
  })
  const verdicts: Verdict[] = []
  const nullCount = res.nullRx[0]?.length ?? 0
  if (nullCount > 0)
    verdicts.push({ kind: 'warn', text: `λ_min = 0：不可辨識——$R_x$ 有 ${nullCount} 個零 eigenvalue，null vector $\\hat n\\approx(${nHat.map((v) => t(v, 3)).join(',')})$；LMS 只會把這個方向凍結在初值。` })
  else verdicts.push({ kind: 'ok', text: '$R_x$ 沒有零 eigenvalue：這組設定下參數可辨識。' })
  if (dcNull) verdicts.push({ kind: 'warn', text: `經過 $H_{PD}(1)=0$ 的 u-domain：$R_u$ 有 ${zerosRu} 個零 eigenvalue（勘誤 E04）。` })
  for (const w of res.warnings.slice(0, 2)) verdicts.push({ kind: 'info', text: w })
  const first = res.lms.runs[0]
  return {
    experiment: 'gauge-one-hot',
    modelFns: ['pe.gaugeAnalysis', 'pe.gaugeRegressorsRaw', 'pe.sampleCorrelation', 'pe.nullSpaceSym', 'pe.runGaugeLms', 'core.eigSym'],
    level: 'L3',
    claim: 'exact',
    summary: `$y=b+\\sum_i a_ix_i$、one-hot $\\sum_i x_i=1$：$\\theta$ 與 $\\theta+c(1,-1,-1,-1,-1)$ 的輸出相差 $${t(res.maxDiffRawGauge, 2)}$。`,
    metrics,
    steps: [
      { tex: `y_{\\theta'}=(b+c)+\\sum_i(a_i-c)x_i=y_\\theta+c\\Big(1-\\sum_i x_i\\Big)=y_\\theta`, why: 'one-hot：每個 sample 恰有一個 $x_i=1$，所以 $\\sum x_i=1$。' },
      { tex: `\\tilde x=(1,x_0,\\dots,x_3),\\quad R_x=E[\\tilde x\\tilde x^T]=\\begin{bmatrix}1&\\tfrac14\\mathbf 1^T\\\\\\tfrac14\\mathbf 1&\\tfrac14 I\\end{bmatrix}`, why: '各相等機率 $1/4$；$x_ix_j=0$（$i\\ne j$）。' },
      { tex: `R_x\\mathbf n=\\begin{bmatrix}1-4\\cdot\\tfrac14\\\\\\tfrac14-\\tfrac14\\end{bmatrix}=\\mathbf 0,\\quad \\mathbf n=(1,-1,-1,-1,-1)`, why: '直接相乘驗證：$\\mathbf n$ 就是 gauge 平移的方向。' },
      { tex: `\\operatorname{eig}(R_x)=\\{${res.eigRxAnalytic.map((v) => t(v, 4)).join(',\\ ')}\\}`, why: '$\\operatorname{tr}R_x=2=\\tfrac54+3\\cdot\\tfrac14+0$；$(0,v)$ 且 $\\sum v=0$ 的 3 個方向 eigenvalue $\\tfrac14$。' },
      { tex: `w_{k+1}=w_k+\\mu G_k,\\quad G_k\\propto\\tilde x\\;\\Rightarrow\\;\\hat n^Tw_{k+1}=\\hat n^Tw_k`, why: `GMAC 用 raw regressor 時，每次更新都是 $\\tilde x$ 的線性組合，而 $\\tilde x^T\\mathbf n=0$：null 分量永遠不動（run A、B）。${prm.gmacReg === 'filtered' ? '這個 preset 另有一組用 filtered regressor $\\tilde u$ 的 run，見下一行。' : ''}` },
      ...(dcNull
        ? [
            {
              tex: `H_{PD}(1)=0\\;\\Rightarrow\\;u_b=h*1\\to0,\\qquad \\sum_iu_i=h*\\Big(\\sum_ix_i\\Big)=h*1\\to0\\;\\Rightarrow\\;\\#\\{\\lambda(R_u)=0\\}=${zerosRu}`,
              why: 'PD 真正看到的是經過 PLL error path 的 $u=h*x$。常數 1 經過 DC 增益為 0 的路徑後（暖機結束）就消失，所以 global offset $b$ 完全看不到，而且各相的 $u_i$ 加起來也是 0：$R_u$ 的 null space 從 1 維變成 2 維。固定一個 reference phase 只能解掉 $a_i$ 的 gauge，$b$ 仍然無法辨識（勘誤 E04）。',
            },
          ]
        : []),
    ],
    stepsTitle: '手算：為什麼兩組參數給出同一個輸出',
    chart: first
      ? {
          title: '$\\hat{\\mathbf n}^T\\mathbf w_k$：LMS 的 null 分量（gaugeAnalysis 的 demo）',
          xLabel: 'k（block）',
          yLabel: 'n̂ᵀw',
          series: res.lms.runs.map((r) => ({ name: r.label, ...thin(r.nullProj) })),
        }
      : undefined,
    verdicts,
    notes: ['L3 模型：隨機或循環 one-hot 相位序列；LMS demo 用 $M=\\mu I$ 與兩組固定初值。', '約束比較表與 u-domain 細節在原頁面。'],
    seed: prm.seed,
  }
}

/* ═════════════════════════ L3：MIMO（mimo-lms） ═════════════════════════ */

const MIMO_RULES: readonly MimoRule[] = ['scalar', 'diagonal', 'nlms', 'full', 'regularized', 'sequential']
const JHAT_SOURCES: readonly JhatSource[] = ['exact', 'custom', 'perturbed', 'finiteDiff']

function readMat(v: unknown, P: number, fallback: Matrix): Matrix {
  const rows = Array.isArray(v) ? v : fallback
  return range(P).map((i) => range(P).map((j) => num(Array.isArray(rows[i]) ? (rows[i] as unknown[])[j] : undefined, fallback[i]?.[j] ?? (i === j ? 1 : 0))))
}

const previewMimo: Previewer = (p) => {
  const P = int(p.P, 2, 2, 3)
  const mode = pick(p.mode, ['R', 'J'] as const, 'R', 'mode')
  const I3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  const R = readMat(p.R, P, I3)
  const Jn = readMat(p.Jn, P, I3.map((r) => r.map((v) => -v)))
  const sigmaV = num(p.sigmaV, 100)
  const N = int(p.N, 4096, 1, 1e6)
  const dist = pick(p.dist, ['gaussian', 'pm1'] as const, 'gaussian', 'dist')
  const delta0 = range(P).map((i) => num(Array.isArray(p.delta0) ? (p.delta0 as unknown[])[i] : undefined, i === 0 ? 30 : 0))
  const blocks = int(p.blocks, 600, 1, 50000)
  const src = pick(p.jhatSource, JHAT_SOURCES, 'exact', 'jhatSource')
  const rawCases = Array.isArray(p.cases) && p.cases.length ? p.cases.slice(0, 3) : [{ rule: 'scalar' }]
  const cases: RuleConfig[] = rawCases.map((c) => {
    const o = isObj(c) ? c : {}
    return {
      ...DEFAULT_RULE,
      rule: pick(o.rule, MIMO_RULES, 'scalar', 'rule'),
      muKq: num(o.muKq, DEFAULT_RULE.muKq),
      gamma: num(o.gamma, DEFAULT_RULE.gamma),
      lambdaReg: num(o.lambdaReg, DEFAULT_RULE.lambdaReg),
      regForm: pick(o.regForm, ['R', 'J'] as const, DEFAULT_RULE.regForm, 'regForm'),
      seqBlocksPerPhase: int(o.seqBlocksPerPhase, DEFAULT_RULE.seqBlocksPerPhase, 1, 1e5),
      seqSweeps: int(o.seqSweeps, DEFAULT_RULE.seqSweeps, 1, 1e4),
    }
  })
  const seed = seedOf(p)
  // #region core:previewMimo
  const res = analyzeMimo({
    plant: mode === 'R' ? { mode: 'R', R, sigmaV, N, dist } : { mode: 'J', Jn, sigmaV, N, dist },
    cases,
    jhat: { source: src, custom: readMat(p.jhatCustom, P, Jn), perturbRel: num(p.perturbRel, 0.01), fdDeltaFs: num(p.fdDeltaFs, 30), fdSamples: int(p.fdSamples, 4096, 16, 1e6) },
    delta0,
    seed,
  }) // ← 差異：一般情形 A = I + MJ，pole = eig(A)（每個規則各算一次；另含 95% blocks、穩態共變異）
  // #endregion
  if (!res.ok) return { unsupported: `analyzeMimo 拒絕這組參數：${res.error ?? '未知原因'}` }
  const eigJ = eigvals(res.Jn).sort((u, v) => v.re - u.re)
  const eigJScale = Math.max(1e-300, ...eigJ.map((z) => cAbs(z)))
  const eigJPos = eigJ.some((z) => z.re > 1e-12 * eigJScale)
  const eigJZero = eigJ.some((z) => cAbs(z) <= 1e-12 * eigJScale)
  const metrics: PreviewMetric[] = eigJ.map((z, i) => ({ key: `eigJ${i}`, label: `\\lambda_{${i + 1}}(J_n)`, value: z.re, claim: 'exact' as ClaimKind, note: Math.abs(z.im) > 1e-12 ? `虛部 $${t(z.im)}$` : undefined }))
  const steps: PreviewStep[] = [
    { tex: `J_n=${texMat(res.Jn)}`, why: mode === 'J' ? '量測得到的正規化 Jacobian（$K_q\\equiv1$）。' : '$R$ 模式：$J_n=-R$（理想匹配的 regressor）。' },
    {
      tex: `\\operatorname{eig}(J_n)=\\{${eigJ.map((z) => texComplex({ re: snap(z.re, eigJScale), im: snap(z.im, eigJScale) }, 5)).join(',\\ ')}\\}`,
      why: eigJPos
        ? '有實部為正的 eigenvalue：沿那個方向，GMAC 的平均輸出把誤差推得更遠——對任何正的 scalar／diagonal 步長，負回授都變成正回授。'
        : eigJZero
          ? '有零 eigenvalue：沿那個方向 GMAC 完全沒有反應（$\\lambda_{\\min}=0$，不可辨識）。任何 $\\mathbf M$ 都無法讓那個方向收斂——preconditioner 可以加速，但不能製造缺失的資訊。'
          : '實部全部為負：每個方向都有恢復力，存在使所有模式收斂的 $\\mathbf M$（例如夠小的 $\\mu\\mathbf I$，或 $-\\gamma\\mathbf J^{-1}$）。',
    },
  ]
  const verdicts: Verdict[] = []
  const trajSeries: PreviewSeries[] = []
  res.analyses.forEach((a, i) => {
    const id = CASE_IDS[i]
    const tag = `\\;(\\text{${id}: ${a.rule}})`
    if (!a.ok) {
      verdicts.push({ kind: 'warn', text: `Case ${id}：${a.error ?? '無法分析'}` })
      return
    }
    const seq = a.rule === 'sequential'
    const poles = [...a.poles].sort((u, v) => v.re - u.re)
    poles.forEach((z, j) =>
      metrics.push({
        key: i === 0 ? `eigA${j}` : `eigA${j}:${id}`,
        label: `${seq ? `\\lambda_{${j + 1}}(\\Phi_{\\text{sweep}})` : `p_{${j + 1}}`}${tag}`,
        value: Math.abs(z.im) > 1e-12 ? cAbs(z) : snap(z.re),
        claim: 'exact',
        note: Math.abs(z.im) > 1e-12 ? `複數 pole $${texComplex(z, 4)}$（顯示 $|z|$）` : seq ? '一個 sweep（每個參數輪過一次）的轉移矩陣的 eigenvalue' : undefined,
      }),
    )
    metrics.push({ key: `rho:${id}`, label: `${seq ? '\\rho(\\Phi_{\\text{sweep}})^{1/(PK)}' : '\\rho(I+MJ)'}${tag}`, value: a.spectralRadius, claim: 'exact', note: seq ? '換算成每個 block 的等效值' : undefined })
    if (a.blocks95 !== null) metrics.push({ key: `k95:${id}`, label: `k_{95}${tag}`, value: a.blocks95, unit: '\\text{blocks}', claim: 'exact' })
    const Mn = a.Mn
    // 「單一 loop 的 pole」只對每個參數各用自己那條 GMAC 的規則（scalar / diagonal / NLMS）有意義；
    // 完整或 regularized 的 M 本來就是矩陣，拿它的對角線去算「單獨調」沒有物理意義
    const perLoop = a.rule === 'scalar' || a.rule === 'diagonal' || a.rule === 'nlms'
    const single = Mn && perLoop ? range(P).map((k) => 1 + Mn[k][k] * res.Jn[k][k]) : null
    if (single && i === 0) {
      metrics.push({ key: 'singlePole', label: '1+M_{ii}J_{ii}\\ (\\text{單一 loop})', value: single[0], claim: 'exact', note: `各 loop 單獨調時的 pole：${single.map((v) => `$${t(v)}$`).join('、')}` })
      steps.push({
        tex: `\\text{單一 loop：}\\ p_i=1+M_{ii}J_{ii}=${single.map((v) => t(v)).join(',\\ ')}`,
        why: `只開第 $i$ 個 loop、其他參數不動時的 pole：${single.every((v) => Math.abs(v) < 1) ? '每個 $|p_i|<1$，單獨看都穩定' : '有 $|p_i|\\ge1$，單獨調就已經不穩定'}。這只用到 $J$ 的對角線（各 GMAC 對自己那個參數的斜率），完全沒看 off-diagonal 的耦合。`,
      })
    }
    if (a.A && seq) {
      // sequential：analyzeMimo 回傳的是「一輪（每個參數各調 K 個 block）」的轉移矩陣，不是每個 block 的 I + MJ
      steps.push({
        tex: `\\Phi_{\\text{sweep}}^{(\\text{${id}})}=${texMat(a.A)},\\ \\operatorname{eig}=\\{${poles.map((z) => texComplex(z, 4)).join(',\\ ')}\\}`,
        why: `${RULE_TEX[a.rule]}：一次只開一個 loop、每個 loop 連續調若干 block，全部輪過一次（一個 sweep）之後的轉移矩陣；表中的 $\\rho$ 是換算成「每個 block」的等效值。有 eigenvalue 等於 1 表示有一個方向輪完也完全沒有被修正。`,
      })
    } else if (a.A) {
      steps.push({ tex: `A_{\\text{${id}}}=I+M_nJ_n=${texMat(a.A)},\\ \\operatorname{eig}=\\{${poles.map((z) => texComplex(z, 4)).join(',\\ ')}\\}`, why: `${RULE_TEX[a.rule]}：一起更新時真正的轉移矩陣（勘誤 E24：poles 一律由實際的 $M$ 與真實 $J$ 算）。` })
      // 平均遞迴 δ_{k+1} = Aδ_k 的範數（只畫前 min(blocks, 200) 個 block）
      const K = Math.min(blocks, 200)
      let d = delta0.slice()
      const ys = [Math.hypot(...d)]
      for (let k = 0; k < K; k++) {
        d = matVec(a.A, d)
        ys.push(Math.hypot(...d))
      }
      trajSeries.push({ name: `${id}: ${a.rule}`, x: range(K + 1), y: ys })
    }
    const singlesStable = single ? single.every((v) => Math.abs(v) < 1) : false
    const who = `Case ${id}（${RULE_TEX[a.rule]}）`
    if (a.stable) verdicts.push({ kind: 'ok', text: `${who}：$\\rho=${t(a.spectralRadius)}<1$，收斂${a.blocks95 !== null ? `（$k_{95}=${a.blocks95}$）` : ''}。` })
    else if (Math.abs(a.spectralRadius - 1) <= 1e-9)
      verdicts.push({ kind: 'warn', text: `${who}：$${seq ? '\\rho(\\Phi_{\\text{sweep}})' : '\\rho(I+MJ)'}=1$：臨界——有一個模式完全不衰減（通常是 $\\lambda_{\\min}=0$ 的不可辨識方向），不可宣稱收斂。` })
    else
      verdicts.push({ kind: 'danger', text: `${who}：$${seq ? '\\rho(\\Phi_{\\text{sweep}})^{1/(PK)}' : '\\rho(I+MJ)'}=${t(a.spectralRadius)}>1$，${seq ? '輪流更新時' : '一起更新時'}發散${singlesStable ? '——即使每個 loop 單獨調都穩定' : ''}。` })
  })
  if (eigJPos && res.analyses.some((a) => a.rule === 'scalar' || a.rule === 'diagonal'))
    steps.push({ tex: `J_n\\mathbf v=\\lambda\\mathbf v,\\ \\lambda>0\\Rightarrow (I+\\mu J_n)\\mathbf v=(1+\\mu\\lambda)\\mathbf v`, why: 'scalar $M=\\mu I$ 時沿正 eigenvalue 方向的 pole $=1+\\mu\\lambda>1$，縮小 $\\mu$ 無效。' })
  for (const w of res.warnings.slice(0, 2)) verdicts.push({ kind: 'info', text: w })
  return {
    experiment: 'mimo-lms',
    modelFns: ['mimo.analyzeMimo', 'mimo.buildPlant', 'mimo.resolveJhat', 'mimo.analyzeRule', 'mimo.buildUpdateMatrix', 'core.eigvals'],
    level: 'L3',
    claim: 'exact',
    summary: `${P}×${P} ${mode === 'J' ? '量測 Jacobian' : '相關矩陣 $R$'}：${res.analyses.map((a, i) => (a.ok ? `${CASE_IDS[i]} 的 $\\rho=${t(a.spectralRadius, 4)}$` : `${CASE_IDS[i]} 無法分析（見下方說明）`)).join('、')}。`,
    metrics,
    steps,
    stepsTitle: '手算：單一 loop 的 pole 對一起更新的 $\\operatorname{eig}(\\mathbf I+\\mathbf M\\mathbf J)$',
    chart: trajSeries.length
      ? { title: '$\\|E[\\boldsymbol\\delta_k]\\|$：平均遞迴 $\\boldsymbol\\delta_{k+1}=(\\mathbf I+\\mathbf M\\mathbf J)\\boldsymbol\\delta_k$', xLabel: 'k（block）', yLabel: '‖δ_k‖（fs）', yLog: true, series: trajSeries }
      : undefined,
    verdicts,
    notes: ['L3 模型：$K_q$ 正規化為 1（$M_n=K_qM$）；平均遞迴不含 GMAC 雜訊。', 'Monte Carlo 軌跡與穩態共變異（Lyapunov）在原頁面。'],
    seed,
  }
}

/* ═════════════════════════ L1/L2：Bias & INL（bias-inl-lab） ═════════════════════════ */

const CODE_KINDS: readonly CodeDistKind[] = ['five_level', 'pm_one', 'unipolar4', 'gaussian', 'uniform_residue', 'dsm']

const previewBias: Previewer = (p) => {
  const model = {
    a: num(p.a, 1),
    b: num(p.b, 0),
    c2: num(p.c2, 0),
    c3: num(p.c3, 0.1),
    kappa: num(p.kappa, 0),
    sigmaV: Math.max(0, num(p.sigmaV, 1)),
    jitterSlope: Math.max(0, num(p.jitterSlope, 0)),
    jitterRef: num(p.jitterRef, -2),
  }
  const code = {
    kind: pick(p.codeKind, CODE_KINDS, 'five_level', 'codeKind'),
    shift: num(p.codeShift, 0),
    dsmKind: pick(p.dsmKind, ['first_order', 'mash111'] as const, 'first_order', 'dsmKind') as DsmKind,
    dsmFrac: num(p.dsmFrac, 0.3),
  }
  const algorithm = pick(p.algorithm, ['mse', 'sign'] as const, 'sign', 'algorithm') as BiasAlgorithm
  const dcMode = pick(p.dcMode, ['none', 'shared_bbpd', 'linear_pd'] as const, 'none', 'dcMode') as DcNullMode
  const w0 = num(p.w0, 1)
  // #region core:previewBias
  const an = analyzeBias({ model, code, algorithm, dcMode, w0, curvePoints: 61 }) // MSE 封閉解、Sign mean-field root、殘差表
  const an0 = algorithm === 'sign' && model.sigmaV > 0 ? analyzeBias({ model: { ...model, sigmaV: 0 }, code, algorithm: 'sign', dcMode, w0, curvePoints: 61 }) : null // 無雜訊對照
  // #endregion
  const mo = an.moments
  const jitter = model.jitterSlope !== 0
  const noisy = model.sigmaV > 0
  // 無雜訊 Sign-LMS 的零點集合（|x| 加權中位數）：一整段區間時就是 dead zone，固定點不唯一
  const deadZone = algorithm === 'sign' && !noisy && an.zeroSet && an.zeroSet.hi - an.zeroSet.lo > 1e-9 ? an.zeroSet : null
  const dzTex = deadZone ? `[${t(deadZone.lo)},\\ ${t(deadZone.hi)}]` : ''
  // 線性（MSE）固定點的分子與分母：依主迴路的 DC null 模式而不同（勘誤 E03）
  const cov2 = mo.Ex3 - mo.Ex * mo.Ex2 // Cov(x, x²)
  const cov3 = mo.Ex4 - mo.Ex * mo.Ex3 // Cov(x, x³)
  const mseNum =
    dcMode === 'none'
      ? model.b * mo.Ex + model.c2 * mo.Ex3 + model.c3 * mo.Ex4 + model.kappa * mo.Ex2
      : (dcMode === 'linear_pd' ? model.b * mo.Ex : 0) + model.c2 * cov2 + model.c3 * cov3 + model.kappa * mo.varX
  const mseDen = dcMode === 'none' ? mo.Ex2 : mo.varX
  const metrics: PreviewMetric[] = [
    { key: 'Ex2', label: 'E[x^2]', value: mo.Ex2, claim: 'exact' },
    { key: 'Ex4', label: 'E[x^4]', value: mo.Ex4, claim: 'exact' },
  ]
  if (dcMode !== 'none') {
    metrics.push({ key: 'Ex', label: 'E[x]', value: mo.Ex, claim: 'exact' })
    metrics.push({ key: 'varX', label: '\\mathrm{Var}(x)=E[x^2]-E[x]^2', value: mo.varX, claim: 'exact', note: 'DC null 時有效 regressor 是 $x-\\bar x$：分母由 $E[x^2]$ 變成 $\\mathrm{Var}(x)$（勘誤 E03）' })
    metrics.push({ key: 'phiStar', label: '\\varphi^*', value: an.phiStar, claim: algorithm === 'mse' || dcMode === 'linear_pd' ? 'exact' : 'approx', note: '主迴路在 $w^*$ 處加到 comparator 輸入的 DC 偏移' })
  }
  metrics.push({
    key: 'wMse',
    label: 'w^*_{\\text{MSE}}',
    value: an.wMse,
    claim: 'exact',
    note: dcMode === 'none' ? 'MSE-LMS（$E[xe]=0$）的固定點' : 'MSE-LMS 在同一個 DC null 模式下的固定點（$E[(x-\\bar x)\\,e]=0$）',
  })
  metrics.push({
    key: 'wStar',
    label: `w^*_{\\text{${algorithm === 'mse' ? 'MSE' : 'Sign'}}}\\ (\\sigma_v=${t(model.sigmaV)})`,
    value: deadZone ? `$${dzTex}$` : an.wStar,
    claim: algorithm === 'mse' || !noisy ? 'exact' : 'approx',
    note:
      algorithm === 'mse'
        ? '封閉解'
        : deadZone
          ? `dead zone：整段區間都滿足 $E[G]=0$（模型函式回傳的代表值 $${t(an.wStar)}$ 只是其中一點）`
          : noisy
            ? `mean-field root（$E[x\\,\\mathrm{erf}(\\cdot)]=0$）`
            : '無雜訊：$E[x\\operatorname{sign}(e)]$ 的變號點',
  })
  if (Number.isFinite(an.wSecondOrder)) metrics.push({ key: 'wSecond', label: 'w^*\\approx w^*_{\\text{MSE}}+\\Delta/\\sigma_v^2', value: an.wSecondOrder, claim: 'approx', note: 'erf 三次項的二階修正（勘誤 E01）' })
  if (an0?.zeroSet) metrics.push({ key: 'wSign0', label: 'w^*_{\\text{Sign}}\\ (\\sigma_v=0)', value: an0.zeroSet.lo === an0.zeroSet.hi ? an0.zeroSet.lo : `$[${t(an0.zeroSet.lo)},\\ ${t(an0.zeroSet.hi)}]$`, claim: 'exact', note: '$|x|$ 加權中位數（無雜訊）' })
  else if (an0) metrics.push({ key: 'wSign0', label: 'w^*_{\\text{Sign}}\\ (\\sigma_v=0)', value: an0.wStar, claim: 'exact' })
  if (Number.isFinite(an.validityRatio)) metrics.push({ key: 'validity', label: '\\max|e_{\\det}|/\\sigma_v', value: an.validityRatio, claim: 'exact', note: '越小，Sign-LMS 越接近 MSE 解' })
  metrics.push({ key: 'slope', label: '-\\partial E[G]/\\partial w\\,|_{w^*}', value: an.slope, claim: 'approx', note: deadZone ? '跨過整段 dead zone 的割線斜率（區間內 $E[G]\\equiv0$，切線斜率為 0）' : undefined })

  const steps: PreviewStep[] = [
    { tex: `e_{\\det}(x;w)=(a-w)x+b+d(x),\\qquad d(x)=c_2x^2+c_3x^3+\\kappa x`, why: '確定性誤差：增益誤差 + offset $b$ + INL 與 code 相關干擾 $d(x)$（勘誤 E12 的符號）。' },
    {
      tex: `E[x]=${t(snap(mo.Ex))},\\quad E[x^2]=${t(mo.Ex2)},\\quad E[x^3]=${t(snap(mo.Ex3))},\\quad E[x^4]=${t(mo.Ex4)}${dcMode !== 'none' ? `,\\quad \\mathrm{Var}(x)=${t(mo.varX)}` : ''}`,
      why: `${an.distLabel} 的動差（${an.continuous ? '數值積分' : '離散分布直接加權平均'}）。`,
    },
  ]
  if (dcMode === 'none') {
    steps.push({
      tex: `E[x\\,e]=0\\Rightarrow w^*_{\\text{MSE}}=a+\\frac{b\\,E[x]+c_2E[x^3]+c_3E[x^4]+\\kappa E[x^2]}{E[x^2]}=${ta(model.a)}+\\frac{${t(snap(mseNum))}}{${t(mseDen)}}=${t(an.wMse)}`,
      why: 'MSE-LMS 的 GMAC 平均 $E[xe]=(a-w)E[x^2]+E[x(b+d)]$ 是 $w$ 的直線，令其為 0 直接解出。主迴路不碰 comparator 的 DC（靜態式，勘誤 E03 情境 A）。',
    })
  } else {
    steps.push({
      tex:
        dcMode === 'shared_bbpd'
          ? `\\varphi=-E[e_{\\det}]\\;\\Rightarrow\\;e_{\\det}+\\varphi=(a-w)(x-\\bar x)+d(x)-E[d]`
          : `\\varphi=-E[e_{\\det}-b]\\;\\Rightarrow\\;e_{\\det}+\\varphi=(a-w)(x-\\bar x)+b+d(x)-E[d]`,
      why:
        dcMode === 'shared_bbpd'
          ? '主迴路（type-II，與校正共用同一個 PD）的積分路徑把 comparator 輸入的 DC 歸零：offset $b$ 被吸收成 static phase offset，等效 regressor 變成置中的 $x-\\bar x$（勘誤 E03 情境 B；線性化的 MSE 版本）。'
          : '主迴路由線性 PD 鎖定（$E[e_{PD}]=0$，$e_{PD}$ 不含 comparator 自己的 offset），另一個帶 offset $b$ 的 comparator 觀察同一個誤差：$b$ 留下來（勘誤 E03 情境 C）。',
    })
    steps.push({
      tex:
        dcMode === 'shared_bbpd'
          ? `E[x(e_{\\det}+\\varphi)]=0\\Rightarrow w^*_{\\text{MSE}}=a+\\frac{\\mathrm{Cov}(x,d)}{\\mathrm{Var}(x)}=${ta(model.a)}+\\frac{${t(snap(mseNum))}}{${t(mseDen)}}=${t(an.wMse)}`
          : `E[x(e_{\\det}+\\varphi)]=0\\Rightarrow w^*_{\\text{MSE}}=a+\\frac{b\\,E[x]+\\mathrm{Cov}(x,d)}{\\mathrm{Var}(x)}=${ta(model.a)}+\\frac{${t(snap(mseNum))}}{${t(mseDen)}}=${t(an.wMse)}`,
      why:
        `$E[x(x-\\bar x)]=\\mathrm{Var}(x)$、$E[x(d-E[d])]=\\mathrm{Cov}(x,d)=c_2\\mathrm{Cov}(x,x^2)+c_3\\mathrm{Cov}(x,x^3)+\\kappa\\mathrm{Var}(x)$：分母由 $E[x^2]=${t(mo.Ex2)}$ 變成 $\\mathrm{Var}(x)=${t(mo.varX)}$。` +
        (dcMode === 'shared_bbpd' ? '常數 $b$ 的共變異數為 0，所以 offset 不造成 gain bias。' : '$b\\,E[x]$ 項留下，而且被較小的 $\\mathrm{Var}(x)$ 放大——比靜態式的 bias 更大。'),
    })
  }
  if (algorithm === 'sign' && noisy) {
    const sig = jitter ? '\\sigma_v(x)' : '\\sigma_v'
    steps.push({
      tex: `E[G](w)=E\\!\\left[x\\,\\mathrm{erf}\\!\\left(\\frac{e_{\\det}(x;w)${dcMode === 'none' ? '' : '+\\varphi'}}{\\sqrt2\\,${sig}}\\right)\\right]=0\\Rightarrow w^*=${t(an.wStar)}`,
      why:
        'Sign-LMS：$E[q\\mid x]=\\mathrm{erf}(\\cdot)$ 對 $w$ 非線性，用 Brent 法解根（mean-field）。' +
        (dcMode === 'shared_bbpd' ? `$\\varphi$ 由主迴路的條件 $E[q]=0$ 同時解出（本例 $\\varphi^*=${t(snap(an.phiStar, 1, 1e-9))}$）。` : dcMode === 'linear_pd' ? `$\\varphi=-E[e_{\\det}-b]$（本例 $\\varphi^*=${t(snap(an.phiStar, 1, 1e-9))}$）。` : '') +
        (jitter ? '$\\sigma_v(x)$ 隨 code 改變時，每個 code 的資訊量以 $1/\\sigma_v(x)$ 加權，code 置中也消不掉 offset 造成的 bias（勘誤 E17）。' : ''),
    })
  }
  const medianWhy = '無雜訊時 comparator 是 hard limiter：$x\\operatorname{sign}(e_{\\det})=|x|\\operatorname{sign}(t(x)-w)$，其中 $t(x)=a+\\kappa+(b+c_2x^2+c_3x^3)/x$ 是讓第 $x$ 個 code 誤差為 0 的 gain。固定點是 $t(x)$ 的 $|x|$ 加權中位數（MAE 解），不是 MSE 的 $x^2$ 加權平均（勘誤 E01）。'
  if (algorithm === 'sign' && !noisy) {
    if (an.zeroSet)
      steps.push({
        tex: `\\sigma_v=0:\\ E[G](w)=E\\big[|x|\\operatorname{sign}(t(x)-w)\\big]=0\\Rightarrow w^*${deadZone ? `\\in${dzTex}` : `=${t(an.zeroSet.lo)}`}`,
        why: medianWhy + (deadZone ? '這裡累積權重剛好在兩個 $t(x)$ 之間達到一半：整段區間都是解（dead zone），$w$ 停在哪裡由初值與 $\\mu$ 決定。' : ''),
      })
    else
      steps.push({
        tex: `\\sigma_v=0:\\ E[G](w)=E\\big[x\\operatorname{sign}(e_{\\det}(x;w)${dcMode === 'none' ? '' : '+\\varphi'})\\big]=0\\Rightarrow w^*=${t(an.wStar)}`,
        why: '無雜訊時 $E[q\\mid x]=\\operatorname{sign}(\\cdot)$，$E[G](w)$ 是分段常數（或分段平滑）的函數；以二分法找它變號的位置。',
      })
  } else if (an0?.zeroSet) {
    steps.push({
      tex: `\\sigma_v=0:\\ E\\big[|x|\\operatorname{sign}(t(x)-w)\\big]=0\\Rightarrow w^*${an0.zeroSet.lo === an0.zeroSet.hi ? `=${t(an0.zeroSet.lo)}` : `\\in[${t(an0.zeroSet.lo)},\\ ${t(an0.zeroSet.hi)}]`}`,
      why: `對照：${medianWhy}`,
    })
  }
  const residual = an.residual
  const verdicts: Verdict[] = []
  const gainBias = an.wStar - model.a
  if (an.status === 'unidentifiable') verdicts.push({ kind: 'danger', text: 'λ_min = 0：不可辨識——$E[x^2]=0$（或 GMAC 對 $w$ 的斜率為 0），固定點不存在唯一解。' })
  else if (an.status === 'no-root') verdicts.push({ kind: 'danger', text: '$E[G](w)$ 在搜尋範圍內沒有零點：GMAC 永遠推向同一邊（例如 offset 大過所有 code 的 gain 誤差）。' })
  else if (deadZone) verdicts.push({ kind: 'warn', text: `$\\sigma_v=0$：$E[G](w)=0$ 的解是整段區間 $${dzTex}$（dead zone），固定點不唯一——$w$ 停在哪裡取決於初值與 $\\mu$；加入雜訊（dither）才有唯一的零交越。` })
  else if (Math.abs(gainBias) <= 1e-9 * (1 + Math.abs(model.a)))
    verdicts.push({ kind: 'ok', text: `GMAC 在 $w^*=a=${t(model.a)}$ 歸零：這組設定下沒有 gain bias${dcMode === 'shared_bbpd' ? '（offset 被主迴路吸收成 static phase offset）' : ''}。` })
  else verdicts.push({ kind: 'ok', text: `GMAC 在 $w^*=${t(an.wStar)}$ 歸零，但 $w^*-a=${t(gainBias, 4)}\\ne0$、殘差 $e(x;w^*)\\ne0$：GMAC 歸零 ≠ DTC 誤差歸零。` })
  for (const w of an.warnings.slice(0, 3)) verdicts.push({ kind: 'info', text: w })
  const fixedTxt =
    algorithm === 'mse'
      ? 'MSE-LMS'
      : deadZone
        ? `無雜訊 Sign-LMS 的固定點是整段區間 $${dzTex}$`
        : `Sign-LMS（$\\sigma_v=${t(model.sigmaV)}$）${noisy ? 'mean-field ' : ''}$${t(an.wStar)}$`
  return {
    experiment: 'bias-inl-lab',
    modelFns: ['bias.analyzeBias', 'bias.buildCodeDistribution', 'bias.codeMoments', 'bias.dcOffset', 'bias.mseFixedPoint', 'bias.signFixedPoint', 'bias.signWeightedMedian', 'bias.brentRoot'],
    level: dcMode === 'none' ? 'L1' : 'L2',
    claim: algorithm === 'mse' ? 'exact' : 'approx',
    summary: `$a=${t(model.a)}$、$b=${t(model.b)}$、$c_3=${t(model.c3)}$、${an.distLabel}${dcMode === 'none' ? '' : dcMode === 'shared_bbpd' ? '、主迴路 DC null（共用 BBPD）' : '、主迴路 DC null（線性 PD）'}：MSE 解 $${t(an.wMse)}$，${fixedTxt}。`,
    metrics,
    steps,
    stepsTitle: '手算：GMAC 的固定點（MSE 與 Sign 的差別）',
    table: residual
      ? {
          caption: `每個 code 在固定點的殘差（analyzeBias 的 residual 表${dcMode === 'none' ? '' : '；$e$ 已含主迴路的 DC 偏移 $\\varphi^*$'}）`,
          head: ['$x$', '$P(x)$', '$e(x;w^*)$', '$x\\,e(x;w^*)$'],
          rows: residual.map((r) => [r.x, r.p, r.eStar, r.xe]),
        }
      : undefined,
    chart: { title: '平均 GMAC $E[G](w)$（零點就是固定點）', xLabel: 'w', yLabel: 'E[G]', series: [{ name: 'E[G](w)', x: an.curve.w, y: an.curve.G }], hLines: [{ y: 0, name: '0' }] },
    verdicts,
    notes: ['L1（mode none）／L2（DC null）模型；$x$ 依指定分布、identity path、Gaussian comparator noise。', 'Monte Carlo（多 chains、95% CI）在原頁面的 worker 執行。'],
  }
}

/* ═════════════════════════ L1：LMS noise（lms-noise-lab） ═════════════════════════ */

const previewNoise: Previewer = (p) => {
  const inp = {
    N: int(p.N, 4096, 1, 1 << 24),
    fs: num(p.fs, 4e9),
    mu: num(p.mu, 10),
    sigmaV: num(p.sigmaV, 100),
    C: num(p.C, 1),
    gmMode: pick(p.gmMode, ['average', 'sum'] as const, 'average', 'gmMode') as GmMode,
    etaR: num(p.etaR, 0),
  }
  // #region core:previewNoise
  const cl = calLoop(inp) // K = K_qC、g = μK、p = 1 − g、σ_w² = μ²σ_η²/(1 − p²)、四種頻寬
  // #endregion
  const kHz = (x: number) => x / 1e3
  const r = inp.etaR
  const colored = r !== 0
  // 線性模型有穩態的條件：|p| < 1（且 K_q 有定義）。C ≤ 0 時 p ≥ 1；g ≥ 2 時 p ≤ −1
  const kqOk = Number.isFinite(cl.Kq) // σ_v = 0 時 K_q 無定義
  const pStable = kqOk && Math.abs(cl.p) < 1
  const rOk = Math.abs(r) < 1 // AR(1) colored η 需要 |r| < 1 才有有限變異數
  const stable = pStable && rOk && Number.isFinite(cl.sigmaW2)
  const has3db = Number.isFinite(cl.f3dbExact)
  const whiteVar = stable ? (inp.mu * inp.mu * cl.sigmaEta2) / (1 - cl.p * cl.p) : NaN // 白色 η 的 μ²σ_η²/(1 − p²)
  const noSteady = cl.regime === 'polarity' ? '$C\\le0$：$p\\ge1$，沒有穩態' : cl.regime === 'undefined' ? '$\\sigma_v=0$：$K_q$ 無定義' : '$|p|\\ge1$：沒有穩態'
  const no3dbNote =
    cl.regime === 'no3db' ? '$p<3-2\\sqrt2$：到 Nyquist 仍未降 3 dB，−3 dB 點不存在（勘誤 E27）' : cl.regime === 'highpass' ? '$p<0$：high-pass，low-pass 的頻寬不適用（勘誤 E27）' : cl.regime === 'flat' ? '$p=0$：頻率響應是平的' : noSteady
  const metrics: PreviewMetric[] = [
    { key: 'Kq', label: 'K_q=\\sqrt{2/\\pi}/\\sigma_v', value: cl.Kq, unit: '\\mathrm{fs^{-1}}', claim: 'approx' },
    { key: 'g', label: `g=\\mu K_qC${inp.gmMode === 'sum' ? '\\cdot N' : ''}`, value: cl.g, claim: 'exact' },
    { key: 'p', label: 'p=1-g', value: cl.p, claim: 'exact', note: 'T13' },
    { key: 'fu', label: 'f_u=f_s/N', value: kHz(cl.fu), unit: '\\mathrm{kHz}', claim: 'exact', note: 'T14' },
    { key: 'sigmaEta2', label: '\\sigma_\\eta^2', value: cl.sigmaEta2, claim: 'approx', note: inp.gmMode === 'sum' ? 'sum 模式：$N$' : '$\\approx1/N$（±1 code 精確為 $(1-m^2)/N$）' },
    {
      key: 'sigmaW',
      label: colored ? '\\sigma_w=\\sqrt{\\tfrac{\\mu^2\\sigma_\\eta^2}{1-p^2}\\cdot\\tfrac{1+pr}{1-pr}}' : '\\sigma_w=\\sqrt{\\mu^2\\sigma_\\eta^2/(1-p^2)}',
      value: cl.sigmaW,
      unit: '\\mathrm{fs}',
      claim: 'approx',
      note: stable ? 'gain-equivalent 的係數雜訊，不是 output jitter；成立前提見勘誤 E30' : noSteady,
    },
  ]
  if (colored) {
    metrics.push({ key: 'colorFactor', label: '(1+pr)/(1-pr)', value: cl.colorFactor, claim: 'exact', note: `colored $\\eta$（lag-1 相關 $r=${t(r)}$）對 $\\sigma_w^2$ 的修正因子` })
    metrics.push({ key: 'rho1', label: '\\rho_1=p+\\frac{r(1-p^2)}{1+pr}', value: cl.rho1, claim: 'exact', note: '$\\delta w$ 的 lag-1 自相關（白色 $\\eta$ 時就是 $p$）' })
  }
  metrics.push(
    { key: 'tau', label: '\\tau=-1/\\ln|p|', value: cl.tauBlocks, unit: '\\text{blocks}', claim: 'exact', note: stable ? undefined : noSteady },
    { key: 'tauUs', label: '\\tau/f_u', value: cl.tauSeconds * 1e6, unit: '\\mu\\mathrm s', claim: 'exact', note: stable ? undefined : noSteady },
    { key: 'f3dbExact', label: 'f_{3\\mathrm{dB}}\\ (\\text{exact})', value: kHz(cl.f3dbExact), unit: '\\mathrm{kHz}', claim: 'exact', note: has3db ? '$\\sin(\\Omega/2)=(1-p)/(2\\sqrt p)$（勘誤 E27）' : no3dbNote },
    { key: 'f3dbNegLnP', label: '-\\ln p\\,f_u/2\\pi', value: kHz(cl.f3dbNegLnP), unit: '\\mathrm{kHz}', claim: 'approx', note: has3db ? undefined : cl.regime === 'no3db' ? '−3 dB 點不存在時，這個近似輸出的數字沒有意義（勘誤 E27）' : no3dbNote },
    { key: 'f3dbOneMinusP', label: '(1-p)f_u/2\\pi', value: kHz(cl.f3dbOneMinusP), unit: '\\mathrm{kHz}', claim: 'approx', note: has3db ? '勘誤 E26：偏低約 $(1-p)/2$' : cl.regime === 'no3db' ? '−3 dB 點不存在時，這個近似輸出的數字沒有意義（勘誤 E27）' : no3dbNote },
    { key: 'enbw', label: '\\mathrm{ENBW}=\\tfrac{f_u}{2}\\tfrac{1-p}{1+p}', value: kHz(cl.enbw), unit: '\\mathrm{kHz}', claim: 'exact', note: stable ? '$H_{\\eta\\to w}$ 的等效雜訊頻寬：積分用的寬度，不是 −3 dB 點（勘誤 E06）' : noSteady },
  )
  if (colored && stable) metrics.push({ key: 'enbwEff', label: '\\sigma_w^2/S_w^{(1)}(0)', value: kHz(cl.enbwEff), unit: '\\mathrm{kHz}', claim: 'exact', note: 'colored $\\eta$ 時實際 $S_w$ 的等效雜訊頻寬（與上一列不同）' })
  const verdicts: Verdict[] = []
  if (cl.regime === 'polarity') verdicts.push({ kind: 'danger', text: 'C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散。' })
  else if (cl.regime === 'unstable') verdicts.push({ kind: 'danger', text: `$|p|=${t(Math.abs(cl.p))}\\ge1$：$g\\ge2$，迴路不穩定${inp.gmMode === 'sum' ? '（sum 模式沿用 average 的 $\\mu$，$g$ 放大 $N$ 倍）' : ''}。` })
  else if (cl.regime === 'undefined') verdicts.push({ kind: 'warn', text: '$\\sigma_v=0$：$K_q$ 無定義（hard limiter）。' })
  else if (!rOk) verdicts.push({ kind: 'danger', text: `colored $\\eta$ 的 lag-1 相關 $|r|=${t(Math.abs(r))}\\ge1$：AR(1) 雜訊沒有有限變異數，$\\sigma_w$ 沒有定義（合法範圍 $|r|<1$）。` })
  else verdicts.push({ kind: 'ok', text: `${REGIME_LABEL[cl.regime]}：$\\sigma_w=${t(cl.sigmaW, 5)}\\,\\mathrm{fs}$（gain-equivalent）。` })
  for (const w of cl.warnings.slice(0, 2)) verdicts.push({ kind: 'info', text: w })
  // S_w(f)/S_w(0) 的形狀（解析式 swDtft；白色 η 時就是 |H_{η→w}|² 的正規化形狀）
  const fx: number[] = []
  const fy: number[] = []
  if (stable && Math.abs(r) < 1) {
    const s0 = swDtft(0, inp.mu, cl.p, cl.sigmaEta2, r)
    const fMax = Math.min(cl.fu / 2, has3db ? 8 * cl.f3dbExact : cl.fu / 2)
    for (let i = 0; i <= 160; i++) {
      const f = (fMax * i) / 160
      fx.push(kHz(f))
      fy.push(swDtft((2 * Math.PI * f) / cl.fu, inp.mu, cl.p, cl.sigmaEta2, r) / s0)
    }
  }

  const steps: PreviewStep[] = []
  if (!kqOk) {
    steps.push({ tex: `\\sigma_v=0\\Rightarrow K_q=\\lim_{\\sigma_v\\to0}\\frac{\\sqrt{2/\\pi}}{\\sigma_v}=\\infty`, why: '沒有雜訊時 comparator 是 hard limiter，$E[q]$ 對誤差是步階函數：小訊號增益不存在，這一頁的線性化模型（$g$、$p$、$\\sigma_w$、頻寬）全部不適用。' })
  } else steps.push(
    { tex: `K_q=\\frac{\\sqrt{2/\\pi}}{\\sigma_v}=\\frac{${t(SQRT_2_OVER_PI)}}{${t(inp.sigmaV)}}=${t(cl.Kq)}\\ \\mathrm{fs^{-1}}`, why: 'Comparator 小訊號增益（Ch05）。' },
    {
      tex: `g=\\mu K_qC${inp.gmMode === 'sum' ? 'N' : ''}=${ta(inp.mu)}\\times${ta(cl.Kq)}\\times${ta(inp.C)}${inp.gmMode === 'sum' ? `\\times${t(inp.N)}` : ''}=${t(cl.g)}`,
      why: inp.gmMode === 'sum' ? 'sum 模式：GMAC 輸出沒除以 $N$，同一個 $\\mu$ 讓 $g$ 放大 $N$ 倍。' : '無因次迴路增益（勘誤 E13：$K=K_qC$）。',
    },
    {
      tex: `p=1-g=${t(cl.p)},\\qquad \\delta w_{k+1}=p\\,\\delta w_k+\\mu\\eta_k`,
      why: colored
        ? `線性化 block 模型；這個 preset 假設 GMAC 雜訊 $\\eta_k$ 是 colored（AR(1)，相鄰 block 的相關係數 $r=${t(r)}$）、變異數 $\\sigma_\\eta^2$。`
        : '線性化 block 模型：每個 block 的 GMAC 雜訊 $\\eta_k$ 是白色、變異數 $\\sigma_\\eta^2$（$\\delta w=w-w^*$）。',
    },
  )
  if (!kqOk) {
    // 上面已說明：沒有線性化模型可言
  } else if (pStable && !rOk) {
    steps.push({ tex: `|r|=${t(Math.abs(r))}\\ge1\\quad(\\text{AR(1) 的}\\ \\eta\\ \\text{沒有有限變異數})`, why: 'colored $\\eta$ 的模型是 $R_\\eta[\\ell]=\\sigma_\\eta^2r^{|\\ell|}$，需要 $|r|<1$；$|r|\\to1$ 時 $\\eta$ 變成 random walk，$\\sigma_w$ 沒有定義。' })
  } else if (!stable) {
    steps.push({
      tex: `\\mathrm{Var}(\\delta w_{k+1})=p^2\\,\\mathrm{Var}(\\delta w_k)+\\mu^2\\sigma_\\eta^2,\\quad p^2=${t(cl.p * cl.p)}\\ge1\\;\\Rightarrow\\;\\text{沒有固定點}`,
      why:
        (cl.regime === 'polarity'
          ? '$C\\le0$ 讓 $p\\ge1$：平均誤差自己就在發散，變異數每個 block 還再加上 $\\mu^2\\sigma_\\eta^2$。'
          : '$g\\ge2$ 讓 $p\\le-1$：誤差每個 block 變號並放大，變異數沒有上限。') + '所以不存在穩態 $\\sigma_w$，也沒有頻寬可言（線性模型的結論；真正的 1-bit 迴路因 comparator 飽和，會變成線性漂移或有界振盪，見原頁面）。',
    })
  } else if (colored) {
    steps.push({
      tex: `E[\\delta w_k\\,\\eta_k]=\\mu\\sigma_\\eta^2\\sum_{j\\ge0}p^{\\,j}r^{\\,j+1}=\\frac{\\mu\\sigma_\\eta^2\\,r}{1-pr}`,
      why: '$\\delta w_k=\\mu\\sum_{j\\ge0}p^{\\,j}\\eta_{k-1-j}$ 由過去的 $\\eta$ 累積而成，而 colored $\\eta_k$ 與過去相關（$E[\\eta_k\\eta_{k-1-j}]=\\sigma_\\eta^2r^{\\,j+1}$）：交叉項不為 0，是一個公比 $pr$ 的等比級數。',
    })
    steps.push({
      tex: `\\sigma_w^2=p^2\\sigma_w^2+\\mu^2\\sigma_\\eta^2+2p\\mu\\,E[\\delta w_k\\eta_k]\\;\\Rightarrow\\;\\sigma_w^2=\\frac{\\mu^2\\sigma_\\eta^2}{1-p^2}\\cdot\\frac{1+pr}{1-pr}=${t(whiteVar)}\\times${t(cl.colorFactor)}=${t(cl.sigmaW2)}\\ \\mathrm{fs^2}`,
      why: `代入上一行整理：$1+\\tfrac{2pr}{1-pr}=\\tfrac{1+pr}{1-pr}$。白色（$r=0$）時退回 $\\mu^2\\sigma_\\eta^2/(1-p^2)$，即 $\\sigma_w=${t(Math.sqrt(whiteVar), 5)}$ fs；$r>0$ 時相鄰 block 的雜訊同方向累積，$\\sigma_w$ 變大成 $${t(cl.sigmaW, 5)}$ fs。`,
    })
  } else {
    steps.push({
      tex: `\\sigma_w^2=\\frac{\\mu^2\\sigma_\\eta^2}{1-p^2}=\\frac{${t(inp.mu * inp.mu)}\\times${t(cl.sigmaEta2)}}{1-${t(cl.p * cl.p)}}=${t(cl.sigmaW2)}\\ \\mathrm{fs^2}\\;\\Rightarrow\\;\\sigma_w=${t(cl.sigmaW, 5)}\\ \\mathrm{fs}`,
      why: '穩態：$\\mathrm{Var}(\\delta w)=p^2\\mathrm{Var}(\\delta w)+\\mu^2\\sigma_\\eta^2$（$\\eta_k$ 與 $\\delta w_k$ 獨立），解這個一次方程式。',
    })
  }
  steps.push({ tex: `f_u=\\frac{f_s}{N}=${t(kHz(cl.fu), 8)}\\ \\mathrm{kHz}`, why: '每 $N$ 個 comparator sample 更新一次。' })
  if (pStable) {
    const ratio = cl.p > 0 ? (1 - cl.p) / (2 * Math.sqrt(cl.p)) : NaN
    if (cl.regime === 'lowpass')
      steps.push({
        tex: `\\sin\\frac{\\Omega_3}{2}=\\frac{1-p}{2\\sqrt p}=${t(ratio)}\\Rightarrow f_{3\\mathrm{dB}}=\\frac{\\Omega_3}{2\\pi}f_u=${t(kHz(cl.f3dbExact))}\\ \\mathrm{kHz}`,
        why: '$|H_{\\eta\\to w}|^2=\\mu^2/(1-2p\\cos\\Omega+p^2)$ 降到 DC 值 $\\mu^2/(1-p)^2$ 的一半：$1-\\cos\\Omega_3=(1-p)^2/(2p)$，再用半角公式（只在 $p\\ge3-2\\sqrt2$ 時有解，勘誤 E27）。',
      })
    else if (cl.regime === 'no3db')
      steps.push({
        tex: `\\sin\\frac{\\Omega_3}{2}=\\frac{1-p}{2\\sqrt p}=${t(ratio)}>1\\quad(\\text{無解：−3 dB 點不存在})`,
        why: '$\\sin$ 不可能大於 1：$p<3-2\\sqrt2\\approx0.1716$ 時，$|H_{\\eta\\to w}|^2$ 一路到 Nyquist（$f_u/2$）都還高於 DC 的一半（勘誤 E27）。近似公式 $(1-p)f_u/2\\pi$、$-\\ln p\\,f_u/2\\pi$ 仍會吐出數字，但沒有意義。',
      })
    else if (cl.regime === 'highpass')
      steps.push({
        tex: `p=${t(cl.p)}<0\\;\\Rightarrow\\;|H_{\\eta\\to w}(e^{j\\Omega})|^2=\\frac{\\mu^2}{1-2p\\cos\\Omega+p^2}\\ \\text{在}\\ \\Omega=\\pi\\ \\text{最大}`,
        why: '$g>1$ 時每次更新都修正過頭：$\\delta w$ 相鄰 block 正負交替，雜訊集中在 $f_u/2$ 附近（high-pass）。low-pass 的「−3 dB 頻寬」不適用（勘誤 E27）。',
      })
    else if (cl.regime === 'flat') steps.push({ tex: `p=0\\;\\Rightarrow\\;|H_{\\eta\\to w}|^2=\\mu^2\\ (\\text{與頻率無關})`, why: 'deadbeat：每個 block 的誤差一步修完，$\\delta w_{k+1}=\\mu\\eta_k$ 是白色的。' })
    steps.push({
      tex: `\\mathrm{ENBW}=\\frac{f_u}{2}\\,\\frac{1-p}{1+p}=${t(kHz(cl.enbw))}\\ \\mathrm{kHz}`,
      why:
        '白色 $\\eta$ 時 $\\sigma_w^2=S_w^{(1)}(0)\\cdot\\mathrm{ENBW}$：把 PSD 換成「高度等於 DC 值」的矩形時的等效寬度（勘誤 E06：它不是 −3 dB 點' +
        (cl.regime === 'lowpass' ? '；$p\\to1$ 時約為 $\\tfrac\\pi2f_{3\\mathrm{dB}}$' : '') +
        '）。' +
        (colored && stable ? `colored $\\eta$ 時 $S_\\eta$ 本身不平，實際的 $\\sigma_w^2/S_w^{(1)}(0)=${t(kHz(cl.enbwEff))}$ kHz。` : ''),
    })
  }
  const head = `$\\sigma_v=${t(inp.sigmaV)}\\,\\mathrm{fs}$、$N=${t(inp.N)}$、$\\mu=${t(inp.mu)}\\,\\mathrm{fs}$${inp.gmMode === 'sum' ? '、sum 模式' : ''}${colored ? `、colored $\\eta$（$r=${t(r)}$）` : ''}：${kqOk ? `$p=${t(cl.p)}$` : '$\\sigma_v=0$'}`
  return {
    experiment: 'lms-noise-lab',
    modelFns: ['calNoise.calLoop', 'calNoise.loopCore', 'calNoise.sigmaW2Colored', 'calNoise.bw3dbExact', 'calNoise.bw3dbNegLnP', 'calNoise.bw3dbOneMinusP', 'calNoise.enbwOneSided', 'calNoise.swDtft'],
    level: 'L1',
    claim: 'approx',
    summary: stable
      ? `${head}，$\\sigma_w=${t(cl.sigmaW, 5)}\\,\\mathrm{fs}$，${has3db ? `$f_{3\\mathrm{dB}}=${t(kHz(cl.f3dbExact), 5)}\\,\\mathrm{kHz}$` : cl.regime === 'highpass' ? 'high-pass（low-pass 的 −3 dB 頻寬不適用）' : '−3 dB 點不存在'}。`
      : `${head}——${cl.regime === 'polarity' ? '更新極性錯誤（$C\\le0$）' : cl.regime === 'undefined' ? '$K_q$ 無定義' : !rOk ? 'colored $\\eta$ 的 $|r|\\ge1$' : '$|p|\\ge1$'}，不存在穩態 $\\sigma_w$ 與頻寬。`,
    metrics,
    steps,
    stepsTitle: '手算：comparator noise 到係數雜訊 $\\sigma_w$ 與頻寬',
    chart: fx.length
      ? {
          title: '係數雜訊 PSD 的形狀 $S_w(f)/S_w(0)$（解析式 swDtft，對 DC 正規化；不是由資料估計的 PSD）',
          xLabel: 'f（kHz，block rate f_u 的頻率軸）',
          yLabel: colored ? 'S_w(f)/S_w(0)（含 colored S_η）' : '|H_{η→w}|² 正規化',
          series: [{ name: 'S_w(f)/S_w(0)', x: fx, y: fy }],
          hLines: [{ y: 0.5, name: '−3 dB' }],
        }
      : undefined,
    verdicts,
    notes: [
      colored
        ? 'L1 線性化模型：小訊號 $K_q$；colored $\\eta$ 是引擎 (a)（線性遞迴）的假設，真正的 1-bit 引擎在 iid code 下產生的是白色 $\\eta$。'
        : 'L1 線性化模型：小訊號 $K_q$、iid $\\eta$（勘誤 E30 的前提：unit-RMS ±1 iid code、identity path、average GMAC）。',
      'Binomial / sample-level Monte Carlo 與 95% CI 在原頁面的 worker 執行。',
    ],
  }
}

/* ═════════════════════════ L4：Code mixing（code-mixing-lab） ═════════════════════════ */

const previewMixing: Previewer = (p) => {
  const prm = {
    fsim: num(p.fsim, 4096e3),
    L: int(p.L, 4096, 64, 1 << 18),
    fx: num(p.fx, 100e3),
    A: num(p.A, 1),
    m: num(p.m, 0),
    codeWhite: Math.max(0, num(p.codeWhite, 0)),
    fw: num(p.fw, 10e3),
    B: num(p.B, 1),
    holdN: int(p.holdN, 1, 1, 4096),
    dwNoiseSigma: Math.max(0, num(p.dwNoiseSigma, 0)),
    dwNoiseP: num(p.dwNoiseP, 0.92),
    fOut: num(p.fOut, 13e9),
    Tmag: num(p.Tmag, 1),
    window: pick(p.window, ['rectangular', 'hann', 'blackmanHarris'] as const, 'rectangular', 'window'),
    seed: seedOf(p),
    traceLen: 400,
  }
  // #region core:previewMixing
  const r = simulateMixing(prm) // δt = x·δw 的時域乘積、toneFit、spur dBc（小角與 Bessel）
  const cc = mixingCrossCheck(prm, r) // toneFit vs 積化和差預測
  // #endregion
  const tones = r.tones
  // 最大的一根 tone；振幅相同（只差浮點捨入）時取先出現的那一根，結果才不會隨捨入誤差跳動
  const main = tones.reduce<(typeof tones)[number] | null>((best, x) => (!best || x.measFs > best.measFs * (1 + 1e-9) ? x : best), null)
  const metrics: PreviewMetric[] = tones.map((tn) => ({
    key: `tone:${Math.round(tn.f / 1e3)}`,
    label: `A_t\\ @\\ ${t(tn.f / 1e3, 6)}\\,\\mathrm{kHz}`,
    value: tn.measFs,
    unit: '\\mathrm{fs}',
    claim: 'exact' as ClaimKind,
    note: `${tn.tex ? `$${tn.tex}$；` : ''}預測 $${t(tn.predFs, 5)}$ fs（toneFit 量測）`,
  }))
  if (main) {
    metrics.push({ key: 'beta', label: '\\beta=2\\pi f_{\\mathrm{out}}|T|A_t', value: main.beta, unit: '\\mathrm{rad}', claim: 'exact' })
    metrics.push({ key: 'dbcSmall', label: '20\\log_{10}(\\beta/2)', value: main.dbcSmall, unit: '\\mathrm{dBc}', claim: 'approx', note: '小角近似' })
    metrics.push({ key: 'dbcBessel', label: '20\\log_{10}(J_1(\\beta)/J_0(\\beta))', value: main.dbcBessel, unit: '\\mathrm{dBc}', claim: 'exact' })
  }
  metrics.push({ key: 'pmFft', label: '\\text{FFT of }e^{j\\varphi}', value: r.pmFftDbc, unit: '\\mathrm{dBc}', claim: 'exact', note: '不做小角近似的直接量測' })
  metrics.push({ key: 'dtRms', label: '\\mathrm{RMS}(\\delta t)', value: r.dtRms, unit: '\\mathrm{fs}', claim: 'exact' })
  const verdicts: Verdict[] = [
    { kind: cc.analytic.status === 'ok' ? 'ok' : cc.analytic.status === 'mismatch' ? 'danger' : 'info', text: `解析 vs toneFit：${cc.analytic.status}——${cc.analytic.note}` },
  ]
  if (cc.monteCarlo.status !== 'n/a') verdicts.push({ kind: cc.monteCarlo.status === 'ok' ? 'ok' : 'warn', text: `隨機成分：${cc.monteCarlo.note}` })
  for (const w of r.warnings.slice(0, 2)) verdicts.push({ kind: 'warn', text: w })
  const tr = r.trace
  const hasDc = prm.m !== 0
  const hasTone = prm.A * prm.B !== 0 || prm.m * prm.B !== 0
  const zoh = prm.holdN > 1 ? zohGain(prm.fw, prm.fsim, prm.holdN) : 1
  const steps: PreviewStep[] = [
    {
      tex: hasDc
        ? `x=m+A\\cos(2\\pi f_xt),\\ \\delta w=B\\cos(2\\pi f_wt)\\;\\Rightarrow\\;\\delta t=x\\cdot\\delta w=mB\\cos(2\\pi f_wt)+AB\\cos(2\\pi f_xt)\\cos(2\\pi f_wt)`
        : `\\delta t=x\\cdot\\delta w=AB\\cos(2\\pi f_xt)\\cos(2\\pi f_wt)`,
      why:
        'DTC 時間誤差 = code × 係數誤差：時域相乘（頻域就是卷積）。$\\delta w$ 是 block-rate 的量，要先以 ZOH 展開到 sample rate 才能和 $x$ 相乘（勘誤 E09）。' +
        (hasDc ? 'code 有 DC 成分 $m$ 時，$\\delta w$ 自己的頻率 $f_w$ 會原封不動出現在 $\\delta t$。' : ''),
    },
    {
      tex: `AB\\cos(2\\pi f_xt)\\cos(2\\pi f_wt)=\\tfrac{AB}{2}\\big[\\cos2\\pi(f_x-f_w)t+\\cos2\\pi(f_x+f_w)t\\big],\\quad \\tfrac{AB}{2}=${t((prm.A * prm.B) / 2)}\\ \\mathrm{fs}${hasDc ? `,\\ mB=${t(prm.m * prm.B)}\\ \\mathrm{fs}` : ''}`,
      why: `積化和差：兩根 tone 落在 $f_x\\pm f_w$${hasDc ? '，另有一根在 $f_w$' : ''}。${hasTone ? '' : '這個 preset 的 $A$、$B$ 至少有一個是 0：沒有確定性的 tone。'}`,
    },
  ]
  if (prm.holdN > 1 && hasTone)
    steps.push({
      tex: `\\text{ZOH（每}\\ N_h=${prm.holdN}\\ \\text{個 sample 更新）：}\\ \\frac{\\sin(\\pi f_wN_h/f_{\\mathrm{sim}})}{N_h\\sin(\\pi f_w/f_{\\mathrm{sim}})}=${t(zoh)}`,
      why: '$\\delta w$ 被 hold 住 $N_h$ 個 sample：頻率 $f_w$ 的成分乘上這個 Dirichlet 權重（每根 tone 的預測值見上表的說明欄），並在 $kf_{\\mathrm{sim}}/N_h\\pm f_w$ 出現 image（勘誤 E09）。',
    })
  if (main) {
    steps.push({ tex: `\\beta=2\\pi f_{\\mathrm{out}}|T|A_t=2\\pi\\times${t(prm.fOut)}\\times${t(prm.Tmag)}\\times${t(main.measFs)}\\times10^{-15}=${t(main.beta)}\\ \\mathrm{rad}`, why: `時間誤差換成 output 相位（$\\varphi=2\\pi f_{\\mathrm{out}}\\,\\delta t$）；$A_t$ 取量到的最大一根 tone（${t(main.f / 1e3)} kHz，toneFit 的 peak 值）。` })
    steps.push({ tex: `\\mathrm{SSB}=20\\log_{10}\\frac{\\beta}{2}=${t(main.dbcSmall, 6)}\\ \\mathrm{dBc}`, why: '小角 PM：$e^{j\\beta\\sin\\theta}\\approx1+j\\beta\\sin\\theta$，每個 sideband 的振幅是 $\\beta/2$。' })
  }
  if (r.msCheck)
    steps.push({
      tex: `E[\\delta t^2]=\\overline{\\big(x_{\\det}^2+c_w^2\\big)\\big(\\delta w_{\\det}^2+\\sigma_{\\delta w}^2\\big)}=${t(r.msCheck.pred, 5)}\\ \\mathrm{fs^2}\\quad(\\text{量測}\\ ${t(r.msCheck.meas, 5)})`,
      why: '隨機成分（code 的白色部分 $c_w$、係數雜訊 $\\sigma_{\\delta w}$）彼此獨立、零均值：乘積的均方等於均方的乘積，再對時間平均。它們不產生離散 tone，只把功率攤成連續的 floor／skirt；量測值是這個 seed 的單次實現。',
    })
  return {
    experiment: 'code-mixing-lab',
    modelFns: ['calNoise.simulateMixing', 'calNoise.mixingCrossCheck', 'calNoise.spurBeta', 'calNoise.spurDbcSmallAngle', 'calNoise.spurDbcBessel', 'signal.toneFit'],
    level: 'L4',
    claim: 'exact',
    summary: `$x=${hasDc ? `${t(prm.m)}+` : ''}${t(prm.A)}\\cos(2\\pi\\,${t(prm.fx / 1e3)}\\,\\mathrm{kHz}\\,t)$${prm.codeWhite > 0 ? '（另加白色成分）' : ''}、$\\delta w=${t(prm.B)}\\,\\mathrm{fs}\\cos(2\\pi\\,${t(prm.fw / 1e3)}\\,\\mathrm{kHz}\\,t)$${prm.dwNoiseSigma > 0 ? `（另加 RMS $${t(prm.dwNoiseSigma)}$ fs 的隨機成分）` : ''}：${main ? `spur $${t(main.dbcSmall, 5)}\\,\\mathrm{dBc}$` : '沒有離散 tone，只有連續的 noise floor'}。`,
    metrics,
    steps,
    stepsTitle: '手算：code 乘上係數擾動，變成 spur',
    chart: { title: '$\\delta t[n]$ 時域（simulateMixing）', xLabel: 't（μs）', yLabel: 'δt（fs）', series: [{ name: 'δt', x: Array.from(tr.tUs), y: Array.from(tr.dt) }] },
    verdicts,
    notes: ['L4 模型：coherent sampling（tone 落在整數 bin）、$|T|$ 在 tone 頻率視為常數。', `完整頻譜與 dBc 圖在原頁面；隨機成分使用 seed ${prm.seed}。`],
    seed: prm.seed,
  }
}

/* ═════════════════════════ L5：Quantized gain（quantized-gain-lab） ═════════════════════════ */

/** 從尾端偵測整數序列的最小週期（≤ maxP）；找不到回傳 0 */
function detectIntPeriod(y: ArrayLike<number>, maxP: number): number {
  const n = y.length
  const start = Math.floor(n / 2)
  for (let P = 1; P <= maxP && start + P < n; P++) {
    let ok = true
    for (let i = start; i + P < n; i++) {
      if (y[i] !== y[i + P]) {
        ok = false
        break
      }
    }
    if (ok) return P
  }
  return 0
}

interface QuantRun {
  strategy: QuantStrategy
  y: Int32Array
  r: Float64Array
  v: Float64Array
  mean: number
  dc: number
  power: number
  variance: number
  period: number
  cycle: number[] | null
  line1: number
  line2: number
  levels: number[]
  overflow: number
}

const previewQuant: Previewer = (p) => {
  const target = num(p.target, 32.4)
  const setup: QuantizerSetup = {
    bits: int(p.bits, 6, 1, 16),
    rounding: pick(p.rounding, ['nearest', 'floor'] as const, 'nearest', 'rounding') as RoundingMode,
    overflow: pick(p.overflow, ['saturate', 'wrap'] as const, 'saturate', 'overflow') as OverflowMode,
    antiWindup: bool(p.antiWindup, false),
    togglePeriod: int(p.togglePeriod, 5, 2, 4096),
    toggleOrder: pick(p.toggleOrder, ['spread', 'clustered'] as const, 'spread', 'toggleOrder') as ToggleOrder,
    randomSource: pick(p.randomSource, ['ideal', 'prbs'] as const, 'ideal', 'randomSource') as RandomSource,
    prbsBits: int(p.prbsBits, 7, 2, 31),
    ditherLsb: Math.max(0, num(p.ditherLsb, 1)),
    ditherPdf: pick(p.ditherPdf, ['uniform', 'triangular'] as const, 'uniform', 'ditherPdf') as DitherPdf,
  }
  const arithmetic = pick(p.arithmetic, ['rational', 'fixed', 'float'] as const, 'rational', 'arithmetic') as Arithmetic
  const fracBits = int(p.fracBits, 10, 0, 30)
  const seed = seedOf(p)
  const rInit = num(p.rInit, 0)
  const L = 4096
  // #region core:previewQuant
  const grid = makeGrid(target, arithmetic, fracBits) // 常數 w* 的精確表示（rational：p/q·2^16）
  const W = new Float64Array(L).fill(grid.W0)
  const runs: QuantRun[] = STRATEGIES.map((strategy) => {
    const ctx = makeCtx(setup, grid, strategy, seed) // 每個策略各自 fork 亂數流（paired）
    const sim = simulateStrategy(strategy, W, ctx, { freezeW: grid.W0, rInit, integer: grid.integer })
    const e = Array.from(sim.y, (y) => y - target) // 係數誤差 δw = y − w*（勘誤 E49 的符號）
    const period = detectIntPeriod(sim.y, 1024)
    const cycle = period > 0 && period <= 64 ? Array.from(sim.y.slice(L - period)) : null
    const lines = cycle ? lineSpectrum(cycle.map((y) => y - target)) : null // 一個週期的精確 DFT 線譜
    // #endregion
    // 週期序列：在後半段取整數個週期平均（精確）；否則用整段紀錄（Monte Carlo 估計）
    const n0 = period > 0 ? L - period * Math.floor(L / 2 / period) : 0
    const win = Array.from(sim.y.slice(n0))
    const ew = e.slice(n0)
    const mean = win.reduce((s, v) => s + v, 0) / win.length
    const dc = ew.reduce((s, v) => s + v, 0) / ew.length
    const power = ew.reduce((s, v) => s + v * v, 0) / ew.length
    return {
      strategy,
      y: sim.y,
      r: sim.r,
      v: sim.v,
      mean,
      dc,
      power,
      variance: power - dc * dc,
      period,
      cycle,
      line1: lines && lines.length > 1 ? lines[1].power : NaN,
      line2: lines && lines.length > 2 ? lines[2].power : NaN,
      levels: [...new Set(Array.from(sim.y))].sort((a, b) => a - b),
      overflow: sim.overflow,
    }
  })
  const by = (s: QuantStrategy): QuantRun => {
    const r = runs.find((x) => x.strategy === s)
    if (!r) throw new Error(`quantizer：缺少策略 ${s}`)
    return r
  }
  const B = by('toggle')
  const Dr = by('deltaSigma')
  const rot = B.cycle && Dr.cycle && B.cycle.length === Dr.cycle.length ? isRotation(Dr.cycle, B.cycle) : -1
  const lo = Math.floor(target)
  const frac = target - lo
  const bern = bernoulliMoments(lo, frac)
  const metrics: PreviewMetric[] = []
  for (const r of runs) {
    const s = r.strategy
    const cl: ClaimKind = r.period > 0 ? 'exact' : 'approx' // 週期序列：整數週期平均＝精確；隨機序列：有限樣本估計
    const how = r.period > 0 ? `整數個週期（$P=${r.period}$）的平均` : `${L} 次更新的樣本平均（隨機，估計值）`
    metrics.push({ key: `mean:${s}`, label: `\\bar y\\ (\\text{${s}})`, value: r.mean, unit: '\\mathrm{LSB}', claim: cl, note: how })
    metrics.push({ key: `dc:${s}`, label: `\\overline{y-w^*}\\ (\\text{${s}})`, value: r.dc, unit: '\\mathrm{LSB}', claim: cl, note: '$\\delta w=w-w^*$ 的符號（勘誤 E49）' })
    metrics.push({ key: `power:${s}`, label: `\\overline{(y-w^*)^2}\\ (\\text{${s}})`, value: r.power, unit: '\\mathrm{LSB^2}', claim: cl })
    if (r.period > 0) metrics.push({ key: `period:${s}`, label: `\\text{週期}\\ (\\text{${s}})`, value: r.period, claim: 'exact' })
    if (Number.isFinite(r.line1)) metrics.push({ key: `line1:${s}`, label: `P\\big(\\tfrac{f_u}{${r.period}}\\big)\\ (\\text{${s}})`, value: r.line1, unit: '\\mathrm{LSB^2}', claim: 'exact' })
    if (Number.isFinite(r.line2)) metrics.push({ key: `line2:${s}`, label: `P\\big(\\tfrac{2f_u}{${r.period}}\\big)\\ (\\text{${s}})`, value: r.line2, unit: '\\mathrm{LSB^2}', claim: 'exact' })
  }
  metrics.push({ key: 'bernVar', label: 'p(1-p),\\ p=\\mathrm{frac}(w^*)', value: bern.variance, unit: '\\mathrm{LSB^2}', claim: 'exact', note: 'T17：任何無偏的兩階方案的總誤差功率' })
  if (rot >= 0) metrics.push({ key: 'rotation', label: '\\text{ΔΣ 循環} = \\text{toggle 循環移位}', value: rot, claim: 'exact', note: '常數輸入時 (D) ≡ (B)（勘誤 E15）' })
  const pattern = toggleCycle(target, setup.togglePeriod, setup.toggleOrder)
  const steps: PreviewStep[] = [
    { tex: `\\text{(A) Freeze: } y=\\operatorname{round}(${t(target)})=${by('freeze').y[0]},\\quad y-w^*=${t(by('freeze').dc)}\\ \\mathrm{LSB}`, why: '只量化一次；誤差全部在 DC（$\\delta=a-w$ 的約定下為正號，勘誤 E49）。' },
    {
      tex: `\\text{(B) Toggle: }[${pattern.join(',')}],\\quad \\bar y=${t(B.mean)}`,
      why:
        `週期 ${setup.togglePeriod} 的固定 pattern（Bresenham 分散）。` +
        (B.overflow > 0
          ? `pattern 中有超出 code 範圍的值，實際輸出被 ${setup.overflow === 'wrap' ? 'wrap' : 'saturate'}：平均 $${t(B.mean)}$ 已經不是 $w^*=${t(target)}$。`
          : Math.abs(B.dc) <= 1e-9
            ? '平均值正好是 $w^*$（DC 誤差為 0）。'
            : `平均值是 $${t(B.mean)}$，不是 $w^*=${t(target)}$：週期 $L_t=${setup.togglePeriod}$ 只能表示 $k/L_t$ 的小數，剩下 $${t(B.dc, 4)}$ LSB 的 DC 誤差。`),
    },
  ]
  if (Number.isFinite(B.line1))
    steps.push({
      tex: `c_k=\\frac1P\\sum_{n=0}^{P-1}e[n]e^{-j2\\pi kn/P},\\quad P_k=2|c_k|^2:\\ P_1=${t(B.line1, 5)}${Number.isFinite(B.line2) ? `,\\ P_2=${t(B.line2, 5)}` : ''}\\ \\mathrm{LSB^2}`,
      why: `一個週期（$P=${B.period}$）的 DFT 給出 $f_u/P$${Number.isFinite(B.line2) ? ' 與 $2f_u/P$' : ''} 的譜線功率；$e[n]=y[n]-w^*$。所有譜線加上 DC 項等於總誤差功率（Parseval）${Number.isFinite(B.line2) && B.line2 > B.line1 ? '；主 tone 在 $2f_u/P$，不是 $f_u/P$（勘誤 E47）' : ''}。`,
    })
  steps.push(
    {
      tex: `\\text{(D) ΔΣ: } v[n]=w^*+r[n-1],\\ y=Q(v),\\ r[n]=v-y:\\ r=${Array.from(Dr.r.slice(0, 5), (v) => t(v, 4)).join(',\\ ')},\\dots`,
      why: `誤差回授讓 $y[n]=w^*+r[n-1]-r[n]$；${Dr.period > 0 ? `常數輸入時 $r$ 也是週期 ${Dr.period} 的循環` : '這組設定在 1024 次更新內沒有偵測到週期'}${rot >= 0 ? `，輸出與 (B) 是同一個循環、只差 ${rot} 個 sample 的相位（勘誤 E15：靜態目標下 ΔΣ 並不比 toggle 少 tone）` : ''}。`,
    },
    {
      tex: `\\text{(C) Stochastic: }p=\\mathrm{frac}(w^*)=${t(snap(frac, 1, 1e-9))},\\ E[y]=${lo}+p,\\ \\mathrm{Var}(y)=p(1-p)=${t(bern.variance)}`,
      why:
        'Bernoulli($p$)：無偏、白色（沒有譜線），但總誤差功率與任何無偏的兩階方案相同。' +
        (by('stochastic').overflow > 0 ? `這是沒有 overflow 時的理論值；本例的輸出超出 code 範圍、已被 ${setup.overflow === 'wrap' ? 'wrap' : 'saturate'}，實際的平均與功率見上表。` : ''),
    },
  )
  const fmtLevels = (r: QuantRun) => (r.levels.length <= 6 ? r.levels.join('/') : `${r.levels[0]}…${r.levels[r.levels.length - 1]}（${r.levels.length} 階）`)
  const verdicts: Verdict[] = []
  if (runs.some((r) => r.overflow > 0)) verdicts.push({ kind: 'danger', text: `overflow：${runs.filter((r) => r.overflow > 0).map((r) => `${r.strategy} ${r.overflow} 次`).join('、')}（目標超出 $[0,2^B-1]$；${setup.overflow === 'wrap' ? 'wrap 會讓 gain 瞬間崩到 0' : 'saturate 卡在端點'}）。` })
  const F = by('freeze')
  verdicts.push({
    kind: 'info',
    text: `誤差功率：freeze $${t(F.power, 4)}$（DC 項 $${t(F.dc * F.dc, 4)}$）、toggle $${t(B.power, 4)}$、ΔΣ $${t(Dr.power, 4)}$、stochastic $${t(by('stochastic').power, 4)}$；無偏兩階方案的理論值 $p(1-p)=${t(bern.variance, 4)}$。`,
  })
  if (Math.abs(B.dc) > 1e-6 && B.period > 0 && B.overflow > 0)
    verdicts.push({ kind: 'warn', text: `toggle 的 DC 誤差 $${t(B.dc, 4)}$ LSB 來自 overflow：pattern 中超出 code 範圍的值被 ${setup.overflow === 'wrap' ? 'wrap 成另一端的 code' : 'saturate 在端點'}，平均值不再是 $w^*$。` })
  else if (Math.abs(B.dc) > 1e-6 && B.period > 0)
    verdicts.push({ kind: 'warn', text: `toggle 的 DC 誤差 $${t(B.dc, 4)}$ LSB：週期 $L_t=${setup.togglePeriod}$ 只能表示 $1/L_t$ 的小數（$k=\\operatorname{round}(\\mathrm{frac}\\cdot L_t)$）${arithmetic === 'float' ? '，float 算術還可能讓 tie 被捨入翻轉' : ''}。` })
  for (const n of grid.notes) verdicts.push({ kind: 'info', text: n })
  // preset 中預覽不處理的部分：誠實列出（時變目標會改變結論，所以用 warn；只有 mixing 圖不同則用 info）
  const caseList = Array.isArray(p.cases) ? (p.cases as unknown[]).filter(isObj) : []
  const offScope: string[] = []
  if (caseList.some((c) => c.lmsNoise === true)) offScope.push('LMS 雜訊造成的時變目標')
  if (typeof p.driftPerK === 'number' && p.driftPerK !== 0) offScope.push('PVT 漂移')
  if (caseList.some((c) => typeof c.nUpd === 'number' && c.nUpd > 1)) offScope.push('降低 code 更新率（nUpd > 1）')
  if (offScope.length)
    verdicts.push({ kind: 'warn', text: `這個 preset 的重點——${offScope.join('、')}——不在 Gallery 預覽的範圍。下面只是同一個目標值在「常數輸入」下的五策略比較，不能代表 preset 要示範的現象；請按「載入並執行」。` })
  else if (p.mixing === true) verdicts.push({ kind: 'info', text: 'Gallery 預覽只跑常數目標的五策略比較；PSD 與 DSM mixing 的圖在原頁面。' })
  const show = Math.min(40, L)
  return {
    experiment: 'quantized-gain-lab',
    modelFns: ['quantizer.makeGrid', 'quantizer.makeCtx', 'quantizer.simulateStrategy', 'quantizer.lineSpectrum', 'quantizer.isRotation', 'quantizer.toggleCycle', 'quantizer.bernoulliMoments'],
    level: 'L5',
    claim: 'exact',
    summary: `常數 $w^*=${t(target)}$、${setup.bits}-bit、${arithmetic} 算術：freeze 誤差 $${t(F.dc, 4)}$ LSB；toggle 週期 ${B.period || '—'}、ΔΣ 週期 ${Dr.period || '（>1024 或非週期）'}。`,
    metrics,
    steps,
    stepsTitle: '手算：五種量化策略對常數目標的輸出',
    table: {
      caption: `五策略比較（同一 seed ${seed}、${L} 次更新、${arithmetic} 算術）`,
      head: ['策略', '$\\bar y$', '$\\overline{y-w^*}$', '$\\overline{(y-w^*)^2}$', '週期', '輸出階數'],
      rows: runs.map((r) => [STRATEGY_LABEL[r.strategy], r.mean, r.dc, r.power, r.period || '—', fmtLevels(r)]),
    },
    chart: {
      title: `code 時間序列（前 ${show} 次更新）`,
      xLabel: 'n（code update）',
      yLabel: 'y[n]（LSB）',
      series: (['toggle', 'deltaSigma', 'deltaSigmaDither'] as QuantStrategy[]).map((s) => ({ name: STRATEGY_LABEL[s], x: range(show), y: Array.from(by(s).y.slice(0, show)), mode: 'lines+markers' as const })),
      hLines: [{ y: target, name: `w* = ${target}` }],
    },
    verdicts,
    notes: ['L5 模型：整數（rational / fixed）運算，tie 不會被浮點誤差翻轉；以 code 更新率 $f_u$ 為時基。', 'PSD、ZOH 到 $f_s$ 與 DSM mixing 在原頁面。'],
    seed,
  }
}

/* ═════════════════════════ 分派 ═════════════════════════ */

export const PREVIEWERS: Record<string, Previewer> = {
  'lms-playground': previewLmsPlayground,
  'intro-playground': previewIntroPlayground,
  'stability-fixed-x': previewFixedX,
  'comparator-lab': previewComparator,
  'polarity-explorer': previewPolarity,
  'delay-fx-lab': previewDelayFx,
  'pm-lab': previewPmLab,
  'dual-loop': previewDualLoop,
  'pe-eigen-lab': previewPeEigen,
  'gauge-one-hot': previewGauge,
  'mimo-lms': previewMimo,
  'bias-inl-lab': previewBias,
  'lms-noise-lab': previewNoise,
  'code-mixing-lab': previewMixing,
  'quantized-gain-lab': previewQuant,
}

export function hasPreviewer(experiment: string): boolean {
  return Object.prototype.hasOwnProperty.call(PREVIEWERS, experiment)
}

// #region core:previewPreset
/** 用網站真正的模型函式重算一個 preset；不支援的實驗或模式誠實回報，不猜數字。 */
export function previewPreset(preset: PresetEntry): PreviewOutcome {
  const fn = PREVIEWERS[preset.experiment]
  if (!fn) return { status: 'unsupported', reason: `實驗 ${preset.experiment} 沒有可在主執行緒快速重算的純函式預覽；請按「載入並執行」到原頁面。` }
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  try {
    const out = fn(isObj(preset.params) ? preset.params : {}, preset)
    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
    if ('unsupported' in out) return { status: 'unsupported', reason: out.unsupported }
    return { status: 'ok', result: out, ms }
  } catch (e) {
    if (e instanceof UnsupportedPreview) return { status: 'unsupported', reason: e.message } // 看不懂的選項：不猜
    return { status: 'error', message: e instanceof Error ? e.message : String(e) } // 模型函式丟出的中文錯誤原樣顯示
  }
}
// #endregion

/** 與 data.ts 的 PREVIEWABLE_EXPERIMENTS 必須一致（previews.test.ts 驗證） */
export const PREVIEWER_IDS: readonly string[] = Object.keys(PREVIEWERS)
