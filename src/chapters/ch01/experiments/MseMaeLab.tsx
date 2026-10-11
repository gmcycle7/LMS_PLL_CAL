import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  Callout,
  CodeBlock,
  ExperimentShell,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  useThemeTokens,
  type CheckEntry,
  type ExperimentPreset,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import { gaussianAlmostSureMuMax, huberPsi, lossValue, sgn, type LmsVariant, type TieRule } from '@/simulation/models/lms'
import {
  batchHuber,
  batchL1,
  batchL2,
  costCurves,
  generateLossData,
  lmsSteadyState,
  populationOptima,
  runVariantOnData,
  signErrorFixedPointRun,
  signErrorDiffusionKappa,
  signErrorJitterApprox,
  signErrorLatticeStationary,
  timeAverage,
  type DataModel,
  type LatticeStationary,
  type LmsSteadyState,
  type LossDataParams,
  type OutlierSign,
  type TieStudyParams,
  type TieStudyResult,
  type TimeStats,
  type XDist,
} from '@/simulation/models/lossCompare'
import lossSrc from '@/simulation/models/lossCompare.ts?raw'
import { Erratum, f, symLabel, texNum, TryIt } from '../common'

export const MSE_MAE_ID = 'mse-vs-mae'

export interface MseMaeParams {
  model: DataModel
  xDist: XDist
  xScale: number
  a: number
  sigma: number
  outlierProb: number
  outlierSize: number
  outlierSign: OutlierSign
  mu: number
  w0: number
  n: number
  tie: TieRule
  huberDelta: number
  /** 「loss type」：突顯哪一種損失（其餘變淡）；all = 三者並列 */
  focus: 'all' | 'mse' | 'mae' | 'huber'
}

export const MSE_MAE_DEFAULTS: MseMaeParams = {
  model: 'four_point',
  xDist: 'const',
  xScale: 1,
  a: 3,
  sigma: 1,
  outlierProb: 0.1,
  outlierSize: 20,
  outlierSign: 'positive',
  mu: 0.2,
  w0: 1,
  n: 4000,
  tie: 'zero',
  huberDelta: 1,
  focus: 'all',
}
const DEFAULT_SEED = 7

const FOCUS_INDEX: Record<MseMaeParams['focus'], number> = { all: -1, mse: 0, mae: 1, huber: 2 }

/** 「loss type」選擇：被選中的（或 all）不透明，其餘淡化 */
export function focusOpacity(focus: MseMaeParams['focus'], i: number): number {
  return focus === 'all' || FOCUS_INDEX[focus] === i ? 1 : 0.18
}

const VARIANTS: { v: LmsVariant; label: string }[] = [
  { v: 'conventional', label: 'Conventional LMS（MSE）' },
  { v: 'sign_error', label: 'Sign-Error LMS（MAE）' },
  { v: 'huber', label: 'Huber LMS' },
]

const NUM_KEYS = ['xScale', 'a', 'sigma', 'outlierProb', 'outlierSize', 'mu', 'w0', 'n', 'huberDelta'] as const

/** 從 preset 取出合法欄位 */
export function sanitizeMseMaeParams(p: Record<string, unknown>): Partial<MseMaeParams> {
  const out: Partial<MseMaeParams> = {}
  for (const k of NUM_KEYS) {
    const v = p[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = k === 'n' ? Math.max(100, Math.min(20000, Math.round(v))) : v
  }
  if (p.model === 'four_point' || p.model === 'contaminated') out.model = p.model
  if (p.xDist === 'const' || p.xDist === 'pm1' || p.xDist === 'gaussian') out.xDist = p.xDist
  if (p.outlierSign === 'positive' || p.outlierSign === 'symmetric') out.outlierSign = p.outlierSign
  if (p.tie === 'zero' || p.tie === 'plus' || p.tie === 'minus') out.tie = p.tie
  if (p.focus === 'all' || p.focus === 'mse' || p.focus === 'mae' || p.focus === 'huber') out.focus = p.focus
  return out
}

/** 一般 x 的「典型步長」|x|：const / ±A 為 A；Gaussian 用 E|x| = A√(2/π) */
export function typicalAbsX(p: MseMaeParams): number {
  if (p.model === 'four_point') return 1
  return p.xDist === 'gaussian' ? Math.abs(p.xScale) * Math.sqrt(2 / Math.PI) : Math.abs(p.xScale)
}

/** Gaussian x（σ = 1）的 almost-sure 界 μ_as ≈ 2.4212（λ(μ) = E log|1 − μx²| = 0 的根；lms.ts 數值積分，第一次用到時計算一次） */
let AS_BOUND: number | null = null
function gaussianAsBound(): number {
  if (AS_BOUND === null) AS_BOUND = gaussianAlmostSureMuMax(1)
  return AS_BOUND
}

export function mseMaeWarnings(p: MseMaeParams, lmsStable: boolean, lmsDivergedAt: number | null): string[] {
  const w: string[] = []
  const four = p.model === 'four_point'
  if (!four && p.xScale === 0) {
    w.push(String.raw`$A=0$：$x\equiv0$，沒有 excitation——$\sum x^2=0$，$e$ 與 $w$ 無關、三種更新量都是 0；三種最佳解都不存在（$a$ 不可辨識，$\lambda_{\min}=0$）。`)
    return w
  }
  if (p.mu <= 0) w.push(String.raw`$\mu\le0$：更新極性錯誤或不更新——三種演算法都不會往最佳解走。`)
  else if (!lmsStable) {
    if (four || p.xDist !== 'gaussian') {
      // x ≡ A 或 x = ±A：x² = A² 是常數，每步都乘同一個 1 − μA²，mean / mean-square / 樣本路徑三種界相同
      const A = four ? 1 : p.xScale
      const g = p.mu * A * A
      w.push(
        Math.abs(g - 2) < 1e-12
          ? String.raw`Conventional LMS：$\mu A^2=2\ \Rightarrow$ pole $1-\mu A^2=-1$（穩定邊界；$|x|$ 固定，每條路徑都一樣）：$|\delta|$ 不再衰減，每一筆雜訊都原封不動地累積，$\operatorname{Var}(w_n)$ 隨 $n$ 線性成長——沒有穩態，圖上會越跳越大。Sign-Error 與 Huber 的單步更新有界（$|\Delta w|\le\mu\,\max|\psi|\,|x|$），不會發散。`
          : String.raw`Conventional LMS：$\mu A^2=${texNum(g, 5)}>2\ \Rightarrow$ pole $1-\mu A^2=${texNum(1 - g, 5)}<-1$，LMS 指數發散（$|x|$ 固定，每條路徑都一樣發散）；Sign-Error 與 Huber 的單步更新有界（$|\Delta w|\le\mu\,\max|\psi|\,|x|$），不會發散，但會大幅跳動。`,
      )
    } else {
      // Gaussian x ~ N(0, A²)：Pₓ = A²、E[x⁴] = 3A⁴；三種界不同（勘誤 E14）
      const g = p.mu * p.xScale * p.xScale // μA²
      const parts = [String.raw`Conventional LMS：$\mu A^2=${texNum(g, 5)}\ge\tfrac23$（均方界 $\mu<2P_x/E[x^4]$，$P_x=A^2$、$E[x^4]=3A^4$）$\Rightarrow$ 均方發散（MSD $E[\delta^2]\to\infty$）`]
      if (g >= 2) parts.push(String.raw`$\mu A^2\ge2\ \Rightarrow$ 連平均 $E[\delta]$ 也發散（mean 界 $2/P_x$）`)
      parts.push(
        g < gaussianAsBound()
          ? String.raw`但 $\mu A^2<${texNum(gaussianAsBound(), 5)}$（Gaussian 的 almost-sure 界，勘誤 E14）$\Rightarrow$ 單一路徑仍幾乎必然收斂；$E[\delta^2]$ 被極少數 heavy-tail 路徑撐大。圖上「看似收斂」不能當作均方穩定的證據`
          : String.raw`且 $\mu A^2\ge${texNum(gaussianAsBound(), 5)}$（almost-sure 界，勘誤 E14）$\Rightarrow$ 連單一路徑也幾乎必然發散`,
      )
      w.push(`${parts.join('；')}。`)
    }
  }
  if (lmsDivergedAt !== null) w.push(String.raw`Conventional LMS 在第 ${lmsDivergedAt} 步 $|w|>10^{12}$，已停止（圖中斷處）。`)
  if (!four && p.outlierSign === 'positive' && p.outlierProb >= 0.5)
    w.push(String.raw`$\varepsilon\ge0.5$：outlier 已佔一半以上，連中位數也被拉走（中位數的 breakdown point 是 50%）；MAE 不再「抗 outlier」。`)
  return w
}

function decimate(v: ArrayLike<number>, maxPts: number): { x: number[]; y: (number | null)[] } {
  const n = v.length
  const stride = Math.max(1, Math.ceil(n / maxPts))
  const x: number[] = []
  const y: (number | null)[] = []
  for (let i = 0; i < n; i += stride) {
    x.push(i)
    y.push(Number.isFinite(v[i]) ? v[i] : null)
  }
  if (x[x.length - 1] !== n - 1 && n > 0) {
    x.push(n - 1)
    y.push(Number.isFinite(v[n - 1]) ? v[n - 1] : null)
  }
  return { x, y }
}

function toPresetList(): ExperimentPreset[] {
  return presetsForExperiment(MSE_MAE_ID).map((p) => ({ name: p.title, params: p.params, description: p.description }))
}

/** IEEE double：0.2 + 0.2 + 0.2 − 0.2 − 0.2 − 0.2 的實際結果（不是 0；即時計算） */
const IEEE_RESIDUE_02 = [0.2, 0.2, 0.2, -0.2, -0.2, -0.2].reduce((w, d) => w + d, 0)

/** tie 慣例的 TeX（指標名稱、假設、表格、Plotly 圖例；下拉選單的 option 是純文字，直接寫在 options 裡） */
const TIE_TEX: Record<TieRule, string> = {
  zero: String.raw`\operatorname{sign}(0)=0`,
  plus: String.raw`\operatorname{sign}(0)=+1`,
  minus: String.raw`\operatorname{sign}(0)=-1`,
}

/** 交叉比對的門檻：|模擬 − 解析| ≤ Z_PASS × 理論標準誤 */
export const Z_PASS = 5

/** z 分數的文字（給支援 $...$ 的 note 用）：例如 $1.3\sigma$ */
const zText = (z: number) => (Number.isFinite(z) ? String.raw`$${texNum(z, 2)}\sigma$` : '—')

/**
 * Analytic 交叉比對：LMS 的時間平均與變異數 vs 封閉式（F-01.15 / E42）。
 * 容忍度用「理論標準誤」（lmsSteadyState：w_n 是 AR(1) ⇒ SE(平均) = σ√(τ/n)；樣本變異數用 Bartlett 公式），
 * 不是猜的百分比；樣本太短、暫態未結束或接近均方界時誠實回報 n/a 或只比對平均。
 * transient = |E[w_∞] − w₀|·|p|^{N/2}：平均窗口起點殘留的暫態。
 */
export function lmsAnalyticCheck(ta: TimeStats, ss: LmsSteadyState, transient: number, nearMsBound = false): CheckEntry {
  if (!ss.stable) return { status: 'n/a', note: 'LMS 不穩定：沒有穩態可比對' }
  const sd = Math.sqrt(ss.variance)
  if (!(ta.n >= 20 * Math.max(1, ss.tauMean)))
    return { status: 'n/a', note: String.raw`樣本太短：平均窗口只有 ${ta.n} 筆，不到 20 個相關時間（$\tau=(1+p)/(1-p)=${texNum(ss.tauMean, 3)}$）——加大 $N$ 或 $\mu$` }
  if (transient > 0.05 * sd + 1e-9)
    return { status: 'n/a', note: String.raw`暫態尚未結束：平均窗口起點仍殘留 $|\delta|\approx${texNum(transient, 3)}$（超過穩態 std 的 5%）——加大 $N$ 或 $\mu$` }
  const v = ta.std ** 2
  if (ss.variance === 0) {
    const ok = Math.abs(ta.mean - ss.mean) <= 1e-9 * Math.max(1, Math.abs(ss.mean)) && ta.std <= 1e-9
    return { status: ok ? 'ok' : 'mismatch', note: `無雜訊：LMS 應精確收斂到 ${f(ss.mean, 6)}，實得 ${f(ta.mean, 6)}（std ${f(ta.std, 2)}）` }
  }
  const zMean = Math.abs(ta.mean - ss.mean) / (sd * Math.sqrt(ss.tauMean / ta.n))
  const zVar = Math.abs(v - ss.variance) / (ss.variance * Math.sqrt(ss.varFactor / ta.n) + 1e-300)
  const seKind = ss.seExact ? '理論標準誤（AR(1) + Bartlett，精確）' : String.raw`理論標準誤（Gaussian $x$：小 $\mu$ 近似）`
  if (nearMsBound) {
    return {
      status: zMean <= Z_PASS ? 'ok' : 'mismatch',
      note: String.raw`LMS 平均 ${f(ta.mean, 4)} vs ${f(ss.mean, 4)}（${zText(zMean)}，門檻 $${Z_PASS}\sigma$）；Var ${f(v, 4)} vs ${f(ss.variance, 4)} 不檢定——$\mu A^2$ 超過均方界 $\tfrac23$ 的一半，樣本變異數是 heavy-tail（E14）`,
    }
  }
  return {
    status: zMean <= Z_PASS && zVar <= Z_PASS ? 'ok' : 'mismatch',
    note: String.raw`LMS 平均 ${f(ta.mean, 4)} vs ${f(ss.mean, 4)}（${zText(zMean)}）；Var ${f(v, 4)} vs ${f(ss.variance, 4)}（${zText(zVar)}）；門檻 $${Z_PASS}\sigma$，$\sigma$ 為${seKind}`,
  }
}

/** Sign-Error 離目標很遠時每步約走 μ|x|·O(1)：保守估計需要 4|w₀ − w̄|/(μ|x|) 步才進入穩態 */
function signErrorTransientSteps(w0: number, lattice: LatticeStationary): number {
  return lattice.h > 0 ? (4 * Math.abs(w0 - lattice.mean)) / lattice.h : Infinity
}

/**
 * Monte Carlo 交叉比對：Sign-Error（lms.ts，IEEE double）的時間平均 vs lattice 精確值。
 * 容忍度 = μ|x|（勘誤 E40：tie 慣例與浮點算術造成的 O(μ) 偏移）+ Z_PASS × 精確標準誤 √(meanAvar/n)。
 */
export function signErrorMcCheck(ta: TimeStats, lattice: LatticeStationary | null, band: number, w0: number): CheckEntry {
  if (!lattice) return { status: 'n/a', note: String.raw`Gaussian $x$：步長連續、無 lattice 精確解；改看時間平均是否在母體中位數 $\pm\mu|x|$ 內` }
  if (lattice.truncated) return { status: 'n/a', note: String.raw`格點數超過上限（$\mu A^2$ 太小），lattice 精確解被截斷` }
  if (signErrorTransientSteps(w0, lattice) > ta.from) return { status: 'n/a', note: String.raw`暫態尚未結束：Sign-Error 每步只走 $\mu|x|$，還沒走到中位數附近——加大 $N$ 或 $\mu$` }
  const se = Math.sqrt(lattice.meanAvar / ta.n)
  const tol = band + Z_PASS * se
  const msg = String.raw`Sign-Error（IEEE）${f(ta.mean, 4)} vs lattice ${f(lattice.mean, 4)}（容忍 $\mu|x|+${Z_PASS}\sigma=${texNum(tol, 2)}$，$\sigma$ 為鏈的精確標準誤；E40）`
  return { status: Math.abs(ta.mean - lattice.mean) <= tol ? 'ok' : 'mismatch', note: msg }
}

/**
 * Fixed-Point 交叉比對：整數 code 的 Sign-Error（tie 會精確發生）時間平均 vs lattice 精確值。
 * 這裡沒有 μ|x| 的寬限：容忍度只有 Z_PASS × 精確標準誤。變異數只回報 z 分數（稀有的大偏離讓樣本變異數高度偏態，不適合當判據）。
 */
export function signErrorFixedPointCheck(ta: TimeStats | null, lattice: LatticeStationary | null, w0: number): CheckEntry {
  if (!lattice || !ta) return { status: 'n/a', note: String.raw`$|x|$ 不固定（Gaussian $x$）：沒有整數 code 格點` }
  if (lattice.truncated) return { status: 'n/a', note: 'lattice 精確解被截斷' }
  if (signErrorTransientSteps(w0, lattice) > ta.from) return { status: 'n/a', note: String.raw`暫態尚未結束：加大 $N$ 或 $\mu$` }
  const se = Math.sqrt(lattice.meanAvar / ta.n)
  const zMean = Math.abs(ta.mean - lattice.mean) / (se + 1e-300)
  const zVar = Math.abs(ta.std ** 2 - lattice.std ** 2) / (Math.sqrt(lattice.varAvar / ta.n) + 1e-300)
  const exactMatch = Math.abs(ta.mean - lattice.mean) <= 1e-9 * Math.max(1, Math.abs(lattice.mean))
  const msg = String.raw`定點 ${f(ta.mean, 4)} vs lattice ${f(lattice.mean, 4)}（${exactMatch ? '$0\\sigma$' : zText(zMean)}，門檻 $${Z_PASS}\sigma=${texNum(Z_PASS * se, 2)}$）；std ${f(ta.std, 4)} vs ${f(lattice.std, 4)}（變異數 ${zText(zVar)}，僅供參考）`
  return { status: exactMatch || zMean <= Z_PASS ? 'ok' : 'mismatch', note: msg }
}

/** lattice 分布的顯示用抽點：格點可達數十萬個，圖上最多畫 maxPts 個 */
export function decimateLattice(lat: LatticeStationary, maxPts = 600): { x: number[]; y: number[]; stride: number } {
  const stride = Math.max(1, Math.ceil(lat.grid.length / maxPts))
  if (stride === 1) return { x: lat.grid, y: lat.pi, stride }
  const x: number[] = []
  const y: number[] = []
  for (let i = 0; i < lat.grid.length; i += stride) {
    x.push(lat.grid[i])
    y.push(lat.pi[i])
  }
  return { x, y, stride }
}

export function MseMaeLab() {
  const [params, setParams] = useState<MseMaeParams>(MSE_MAE_DEFAULTS)
  const [seed, setSeed] = useState(DEFAULT_SEED)
  const tokens = useThemeTokens()
  const urlPreset = useUrlPreset(MSE_MAE_ID)
  const presets = useMemo(toPresetList, [])
  const applyParams = useCallback((raw: Record<string, unknown>) => {
    setParams((prev) => ({ ...prev, ...sanitizeMseMaeParams(raw) }))
    if (typeof raw.seed === 'number' && Number.isFinite(raw.seed)) setSeed(raw.seed >>> 0)
  }, [])
  useEffect(() => {
    if (urlPreset) applyParams(urlPreset.params)
  }, [urlPreset, applyParams])

  const set = <K extends keyof MseMaeParams>(k: K) => (v: MseMaeParams[K]) => setParams((p) => ({ ...p, [k]: v }))
  const P = useDeferredValue(params)
  const four = P.model === 'four_point'
  const focus = params.focus // 只影響呈現，不重算（用即時值）

  const dataParams: LossDataParams = useMemo(
    () => ({
      model: P.model,
      a: P.a,
      xDist: P.xDist,
      xScale: P.xScale,
      sigma: P.sigma,
      outlierProb: P.outlierProb,
      outlierSize: P.outlierSize,
      outlierSign: P.outlierSign,
      n: P.n,
      seed,
    }),
    [P.model, P.a, P.xDist, P.xScale, P.sigma, P.outlierProb, P.outlierSize, P.outlierSign, P.n, seed],
  )
  const data = useMemo(() => generateLossData(dataParams), [dataParams])
  const runOpts = useMemo(() => ({ w0: P.w0, mu: P.mu, tie: P.tie, huberDelta: P.huberDelta }), [P.w0, P.mu, P.tie, P.huberDelta])
  const runs = useMemo(() => VARIANTS.map(({ v }) => runVariantOnData(v, data, runOpts)), [data, runOpts])
  const fixed = useMemo(() => signErrorFixedPointRun(data, runOpts), [data, runOpts])

  const batch = useMemo(
    () => ({ l2: batchL2(data.x, data.y), l1: batchL1(data.x, data.y), huber: batchHuber(data.x, data.y, P.huberDelta) }),
    [data, P.huberDelta],
  )
  const pop = useMemo(() => populationOptima(dataParams, P.huberDelta), [dataParams, P.huberDelta])
  const lmsSS = useMemo(() => lmsSteadyState(dataParams, P.mu), [dataParams, P.mu])
  const lattice = useMemo(() => signErrorLatticeStationary(dataParams, runOpts), [dataParams, runOpts])
  const ta = useMemo(() => runs.map((r) => timeAverage(r.w)), [runs])
  const taFixed = useMemo(() => (fixed ? timeAverage(fixed.w) : null), [fixed])
  const absX = typicalAbsX(P)
  const band = P.mu * absX
  const l1Mid = 0.5 * (batch.l1.lo + batch.l1.hi)
  const popL1Mid = 0.5 * (pop.l1.lo + pop.l1.hi)

  // ───── 交叉比對（容忍度 = Z_PASS × 理論／精確標準誤；樣本不足時誠實回報 n/a） ─────
  const lmsTa = ta[0]
  const seTa = ta[1]
  const Aeff = four ? 1 : P.xScale
  const lmsTransient = lmsSS.stable ? Math.abs(lmsSS.mean - P.w0) * Math.abs(lmsSS.pole) ** lmsTa.from : 0
  const nearMsBound = !four && P.xDist === 'gaussian' && P.mu * Aeff * Aeff > 1 / 3
  const analyticCheck = lmsAnalyticCheck(lmsTa, lmsSS, lmsTransient, nearMsBound)
  const mcCheck = signErrorMcCheck(seTa, lattice, band, P.w0)
  const fpCheck = signErrorFixedPointCheck(taFixed, lattice, P.w0)
  // 指標表用的容忍度（與上面的交叉比對同一套標準誤）
  const lmsSd = Math.sqrt(lmsSS.variance)
  const lmsTestable = lmsSS.stable && lmsSS.variance > 0 && lmsTa.n >= 20 * Math.max(1, lmsSS.tauMean)
  const lmsNoiseFree = lmsSS.stable && lmsSS.variance === 0
  const lmsMeanTol = lmsTestable ? Z_PASS * lmsSd * Math.sqrt(lmsSS.tauMean / lmsTa.n) : lmsNoiseFree ? 1e-9 * Math.max(1, Math.abs(lmsSS.mean)) : undefined
  const lmsStdTol = lmsTestable && !nearMsBound ? (Z_PASS * lmsSd * Math.sqrt(lmsSS.varFactor / lmsTa.n)) / 2 : undefined // |Δstd| ≈ |ΔVar|/(2σ)
  const latOk = lattice !== null && !lattice.truncated
  const seSe = latOk ? Math.sqrt(lattice.meanAvar / seTa.n) : undefined
  const jitter = useMemo(() => signErrorJitterApprox(dataParams, P.mu), [dataParams, P.mu])
  // 擴散近似的二階指標（只在 x ≡ A、outlier 離固定點夠遠時有定義）：std 的相對誤差 ≈ −κ/4
  const kappa = useMemo(() => signErrorDiffusionKappa(dataParams, P.mu), [dataParams, P.mu])

  const warnings = mseMaeWarnings(P, lmsSS.stable, runs[0].divergedAt)

  const intervalStr = (lo: number, hi: number) => (lo === hi ? lo : `[${f(lo, 6)}, ${f(hi, 6)}]`)

  const metrics: MetricRow[] = [
    { name: String.raw`批次最佳解 L2（$\sum xy/\sum x^2$；$x\equiv1$ 時 = 平均）`, value: batch.l2, analytic: pop.l2, formulaId: 'F-01.4', claim: 'exact', note: String.raw`analytic = 母體最佳解（$N\to\infty$）` },
    { name: '批次最佳解 L1（加權中位數）', value: intervalStr(batch.l1.lo, batch.l1.hi), formulaId: 'F-01.14', claim: 'exact', note: `母體中位數 ${intervalStr(pop.l1.lo, pop.l1.hi)}` },
    { name: String.raw`批次最佳解 Huber（$\delta_H=${texNum(P.huberDelta, 4)}$）`, value: batch.huber, analytic: pop.huber, claim: 'exact' },
    {
      name: 'LMS 時間平均（後半段）',
      value: lmsTa.mean,
      analytic: lmsSS.stable ? lmsSS.mean : undefined,
      tolerance: lmsMeanTol,
      formulaId: 'F-01.15',
      claim: 'exact',
      note: lmsTestable
        ? String.raw`容忍度 $${Z_PASS}\sigma$，$\sigma=\operatorname{std}\cdot\sqrt{\tau/n}$（AR(1) 的理論標準誤，$\tau=${texNum(lmsSS.tauMean, 3)}$、$n=${lmsTa.n}$）`
        : lmsNoiseFree
          ? String.raw`無雜訊：應精確收斂到母體最佳解（容忍度 $10^{-9}$）`
          : '樣本太短或無穩態：不設容忍度',
    },
    {
      name: 'LMS 穩態標準差',
      value: lmsTa.std,
      analytic: lmsSS.stable ? Math.sqrt(lmsSS.variance) : undefined,
      tolerance: lmsStdTol,
      formulaId: 'F-01.15',
      claim: 'exact',
      note:
        (lmsSS.formula === 'const-x' ? String.raw`$\sqrt{\mu\operatorname{Var}(\tilde v)/(2-\mu A^2)}$` : String.raw`$\sqrt{\mu P_xE[\tilde v^2]/(2P_x-\mu E[x^4])}$（E42）`) +
        (nearMsBound
          ? String.raw`；$\mu A^2$ 超過均方界 $\tfrac23$ 的一半：樣本變異數是 heavy-tail，不設容忍度（E14）`
          : lmsStdTol !== undefined
            ? String.raw`；容忍度 $${Z_PASS}\sigma$，由樣本變異數的理論標準誤（Bartlett 公式）換算`
            : lmsNoiseFree
              ? '；無雜訊：穩態沒有抖動'
              : '；樣本太短或無穩態：不設容忍度'),
    },
    {
      name: `Sign-Error 時間平均（IEEE double，$${TIE_TEX[P.tie]}$）`,
      value: seTa.mean,
      analytic: lattice?.mean,
      tolerance: seSe !== undefined ? band + Z_PASS * seSe : undefined,
      formulaId: 'F-01.16',
      claim: 'exact',
      note: String.raw`容忍度 $\mu|x|+${Z_PASS}\sigma$（勘誤 E40：tie 與算術會讓時間平均偏移 $O(\mu)$；$\sigma$ 為格點鏈的精確標準誤）`,
    },
    {
      name: 'Sign-Error 定點（整數 code）時間平均',
      value: taFixed ? taFixed.mean : 'n/a（輸入大小不固定）',
      analytic: lattice?.mean,
      tolerance: seSe !== undefined && taFixed ? Z_PASS * seSe + 1e-12 : undefined,
      formulaId: 'F-01.16',
      claim: 'exact',
      note: String.raw`容忍度 $${Z_PASS}\sigma$（沒有 $\mu|x|$ 的寬限：整數 code 上 tie 會精確發生）`,
    },
    {
      name: 'Sign-Error 穩態標準差（軌跡的抖動）',
      value: (taFixed ?? seTa).std,
      analytic: latOk ? lattice.std : jitter.applicable ? Math.sqrt(jitter.variance) : undefined,
      formulaId: lattice ? 'F-01.16' : 'F-01.18',
      claim: lattice ? 'exact' : 'approx',
      note: latOk
        ? `analytic = lattice 精確 std（${taFixed ? '定點' : 'IEEE'}軌跡；樣本變異數離精確值 ${zText(
            Math.abs((taFixed ?? seTa).std ** 2 - lattice.std ** 2) / (Math.sqrt(lattice.varAvar / seTa.n) + 1e-300),
          )}，僅供參考）；注意它不是 $\\mu|x|=${texNum(band, 3)}$`
        : lattice
          ? 'lattice 精確解被截斷'
          : String.raw`analytic = 擴散近似 $\sqrt{\mu/(4f_{\tilde v})}$（Gaussian $x$ 沒有 lattice 精確解）`,
    },
    {
      name: String.raw`擴散近似 $\sqrt{\mu/(4f_{\tilde v}(t^*))}$`,
      value: jitter.applicable ? Math.sqrt(jitter.variance) : `n/a（${jitter.reason}）`,
      analytic: jitter.applicable && latOk ? lattice.std : undefined,
      formulaId: 'F-01.18',
      claim: 'approx',
      note: jitter.applicable
        ? String.raw`連續雜訊下 std 是 $O(\sqrt\mu)$；等效 1-bit 增益 $K_q=2f_{\tilde v}=${texNum(2 * jitter.density, 4)}$；有效性 $\mu A^2f_{\tilde v}=${texNum(jitter.smallness, 3)}$（$\ll1$ 才準）${
            Number.isFinite(kappa) ? String.raw`；二階指標 $\kappa=${texNum(kappa, 3)}$（近似的 std 約偏小 $\kappa/4$，§2.3.2；$\varepsilon$ 大時要看它）` : ''
          }`
        : String.raw`點質量資料：抖動是 $O(\mu|x|)$，由格點鏈精確算出`,
    },
    { name: 'Huber 時間平均', value: ta[2].mean, analytic: pop.huber, claim: 'approx', note: String.raw`小 $\mu$ 時趨近 Huber 位置；無封閉式穩態` },
    {
      name: String.raw`單步步長 $\mu|x|$（時間平均的容忍帶）`,
      value: band,
      formulaId: 'F-01.16',
      note: P.xDist === 'gaussian' && !four ? String.raw`$|x|$ 取 $E|x|=A\sqrt{2/\pi}$` : String.raw`每步 $\Delta w=\pm\mu|x|$`,
    },
    {
      name: 'Sign-Error 時間平均與母體中位數的距離',
      value: Math.abs(seTa.mean - popL1Mid),
      note:
        pop.l1.hi - pop.l1.lo > 1e-12
          ? '母體中位數是一整段區間：Sign-Error 在區間內無回復力地遊走（思考題 3），這裡以區間中點為參考'
          : Math.abs(seTa.mean - popL1Mid) <= band + Z_PASS * (seSe ?? (Number.isFinite(seTa.se) ? seTa.se : 0))
            ? String.raw`時間平均在中位數 $\pm\mu|x|$ 內（E40）`
            : String.raw`時間平均超出中位數 $\pm\mu|x|$（$\mu$ 太大、尚未收斂，或樣本太短）`,
    },
  ]

  // ───── 圖：損失與 ψ ─────
  const lossPlots = useMemo(() => {
    const R = Math.max(3, 3 * P.huberDelta)
    const es = Array.from({ length: 241 }, (_, i) => -R + (2 * R * i) / 240)
    const rho: Data[] = [
      { x: es, y: es.map((e) => lossValue('mse', e)), name: String.raw`MSE $\tfrac12 e^2$`, mode: 'lines', line: { color: tokens.series[0] }, opacity: focusOpacity(focus, 0) },
      { x: es, y: es.map((e) => lossValue('mae', e)), name: 'MAE $|e|$', mode: 'lines', line: { color: tokens.series[1] }, opacity: focusOpacity(focus, 1) },
      { x: es, y: es.map((e) => lossValue('huber', e, P.huberDelta)), name: String.raw`Huber（$\delta_H=${texNum(P.huberDelta, 3)}$）`, mode: 'lines', line: { color: tokens.series[2] }, opacity: focusOpacity(focus, 2) },
    ]
    const neg = es.filter((e) => e < 0)
    const pos = es.filter((e) => e > 0)
    const tieVal = sgn(0, P.tie)
    const psi: Data[] = [
      { x: es, y: es, name: String.raw`$\psi=e$（MSE）`, mode: 'lines', line: { color: tokens.series[0] }, opacity: focusOpacity(focus, 0) },
      { x: [...neg, null, ...pos], y: [...neg.map(() => -1), null, ...pos.map(() => 1)], name: String.raw`$\psi=\operatorname{sign}(e)$（MAE）`, mode: 'lines', line: { color: tokens.series[1] }, connectgaps: false, opacity: focusOpacity(focus, 1) },
      { x: [0, 0], y: [-1, 1], name: String.raw`次梯度集合 $[-1,1]$（$e=0$）`, mode: 'lines', line: { color: tokens.series[1], dash: 'dot' } },
      { x: [0], y: [tieVal], name: `本實驗 tie：$${TIE_TEX[P.tie]}$`, mode: 'markers', marker: { size: 11, color: tokens.series[1] } },
      { x: es, y: es.map((e) => huberPsi(e, P.huberDelta)), name: String.raw`$\psi=\operatorname{clip}(e)$（Huber）`, mode: 'lines', line: { color: tokens.series[2] }, opacity: focusOpacity(focus, 2) },
    ]
    return { rho, psi }
  }, [P.huberDelta, P.tie, tokens, focus])

  // ───── 圖：資料分布 ─────
  const histPlot = useMemo<Data[]>(() => {
    const vals = new Float64Array(data.y.length)
    for (let i = 0; i < vals.length; i++) vals[i] = four ? data.y[i] : data.y[i] - P.a * data.x[i]
    return [{ x: Array.from(vals), type: 'histogram', nbinsx: 80, name: four ? '$y$' : String.raw`$\tilde v=y-a\,x$`, marker: { color: tokens.series[4] } }]
  }, [data, four, P.a, tokens])

  // ───── 圖：J(w)（各自正規化） ─────
  const costPlot = useMemo<Data[]>(() => {
    const pts = [batch.l2, batch.l1.lo, batch.l1.hi, batch.huber, pop.l2].filter(Number.isFinite)
    const lo0 = pts.length ? Math.min(...pts) : -1
    const hi0 = pts.length ? Math.max(...pts) : 1
    const pad = Math.max(1, 0.4 * (hi0 - lo0))
    const grid = Array.from({ length: 121 }, (_, i) => lo0 - pad + ((hi0 - lo0 + 2 * pad) * i) / 120)
    const c = costCurves(data.x, data.y, grid, P.huberDelta)
    const norm = (v: Float64Array) => {
      let mn = Infinity
      let mx = -Infinity
      for (const q of v) {
        mn = Math.min(mn, q)
        mx = Math.max(mx, q)
      }
      return Array.from(v, (q) => (mx > mn ? (q - mn) / (mx - mn) : 0))
    }
    return [
      { x: grid, y: norm(c.mse), name: String.raw`$J_{\mathrm{MSE}}(w)$`, mode: 'lines', line: { color: tokens.series[0] }, opacity: focusOpacity(focus, 0) },
      { x: grid, y: norm(c.mae), name: String.raw`$J_{\mathrm{MAE}}(w)$`, mode: 'lines', line: { color: tokens.series[1] }, opacity: focusOpacity(focus, 1) },
      { x: grid, y: norm(c.huber), name: String.raw`$J_{\mathrm{Huber}}(w)$`, mode: 'lines', line: { color: tokens.series[2] }, opacity: focusOpacity(focus, 2) },
      { x: [batch.l2], y: [0], name: `L2 最佳 ${f(batch.l2, 4)}`, mode: 'markers', marker: { size: 12, color: tokens.series[0], symbol: 'diamond' } },
      { x: [l1Mid], y: [0], name: `L1 最佳 ${f(l1Mid, 4)}`, mode: 'markers', marker: { size: 12, color: tokens.series[1], symbol: 'diamond' } },
      { x: [batch.huber], y: [0], name: `Huber 最佳 ${f(batch.huber, 4)}`, mode: 'markers', marker: { size: 12, color: tokens.series[2], symbol: 'diamond' } },
    ]
  }, [data, batch, pop.l2, l1Mid, P.huberDelta, tokens, focus])

  // ───── 圖：w vs n（同一組資料） ─────
  const wPlot = useMemo<Data[]>(() => {
    const N = data.x.length
    const out: Data[] = []
    const bx = [0, N]
    out.push({ x: bx, y: [popL1Mid - band, popL1Mid - band], mode: 'lines', line: { width: 0 }, showlegend: false, hoverinfo: 'skip', name: 'band-lo' })
    out.push({
      x: bx,
      y: [popL1Mid + band, popL1Mid + band],
      mode: 'lines',
      line: { width: 0 },
      fill: 'tonexty',
      fillcolor: 'rgba(127,127,127,0.18)',
      name: String.raw`母體中位數 $\pm\mu|x|$：時間平均的容忍帶（$\pm${texNum(band, 3)}$）`,
    })
    VARIANTS.forEach(({ label }, i) => {
      const d = decimate(runs[i].w, 2500)
      out.push({ x: d.x, y: d.y, name: label, mode: 'lines', line: { color: tokens.series[i], width: 1.4 }, opacity: focusOpacity(focus, i) })
    })
    out.push({ x: bx, y: [pop.l2, pop.l2], name: `母體 L2 最佳 ${f(pop.l2, 4)}`, mode: 'lines', line: { dash: 'dash', color: tokens.series[0] } })
    out.push({ x: bx, y: [popL1Mid, popL1Mid], name: `母體中位數 ${f(popL1Mid, 4)}`, mode: 'lines', line: { dash: 'dash', color: tokens.series[1] } })
    out.push({ x: bx, y: [pop.huber, pop.huber], name: `母體 Huber ${f(pop.huber, 4)}`, mode: 'lines', line: { dash: 'dot', color: tokens.series[2] } })
    return out
  }, [data, runs, pop, popL1Mid, band, tokens, focus])

  const latticePlot = useMemo<Data[] | null>(() => {
    if (!lattice || !lattice.grid.length) return null
    const d = decimateLattice(lattice)
    const dist: Data =
      d.stride === 1 && d.x.length <= 120
        ? { x: d.x, y: d.y, type: 'bar', name: String.raw`$\pi(w)$（$${TIE_TEX[P.tie]}$）`, marker: { color: tokens.series[1] } }
        : { x: d.x, y: d.y, mode: 'lines', fill: 'tozeroy', name: String.raw`$\pi(w)$（$${TIE_TEX[P.tie]}$；${lattice.states} 個格點${d.stride > 1 ? `，每 ${d.stride} 點畫 1 點` : ''}）`, line: { color: tokens.series[1] } }
    return [
      dist,
      { x: [lattice.mean, lattice.mean], y: [0, lattice.piMax], mode: 'lines', name: `精確時間平均 ${f(lattice.mean, 5)}`, line: { dash: 'dash', color: tokens.text } },
      {
        x: [lattice.mean - lattice.std, lattice.mean + lattice.std],
        y: [lattice.piMax / 2, lattice.piMax / 2],
        mode: 'lines+markers',
        name: String.raw`精確 $\pm1$ std（${f(lattice.std, 4)}）`,
        line: { color: tokens.series[3] },
      },
    ]
  }, [lattice, P.tie, tokens])

  // ───── 長時間 tie 研究（Worker） ─────
  const study = useWorkerTask<TieStudyParams, TieStudyResult>('lossCompare', 'runTieStudy', { restartOnRun: true })
  const [studyRes, setStudyRes] = useState<TieStudyResult | null>(null)
  const [studyErr, setStudyErr] = useState<string | null>(null)
  const canStudy = four || P.xDist !== 'gaussian'
  const runStudy = () => {
    setStudyErr(null)
    study
      .run({ data: { ...dataParams, n: 400000 }, w0: P.w0, mu: P.mu })
      .then(setStudyRes)
      .catch((e: unknown) => {
        if (!isWorkerCancelled(e)) setStudyErr(e instanceof Error ? e.message : String(e))
      })
  }

  const disabledHint = four ? (
    <>
      <code>four_point</code> 模式不使用（<Tex>{String.raw`x\equiv1`}</Tex>、<Tex>{'y'}</Tex> 從 <Tex>{String.raw`\{0,0,0,10\}`}</Tex> 抽）
    </>
  ) : undefined

  return (
    <ExperimentShell
      id={MSE_MAE_ID}
      title="MSE vs MAE vs Huber：同一組資料、三種更新律"
      level="L0"
      claim="exact"
      source="simulation"
      description={
        <>
          同一個 seed 產生同一組 <Tex>{String.raw`(x_n,y_n)`}</Tex>，分別交給 <code>conventionalStep</code>、
          <code>signErrorStep</code>、<code>huberStep</code>。比較批次最佳解（平均 vs 中位數 vs Huber）、母體最佳解，以及
          固定步長下的時間平均與抖動。Sign-Error 的<strong>時間平均</strong>只會落在中位數附近約 <Tex>{String.raw`\pm\mu|x|`}</Tex> 的帶內
          （會依 tie 慣例與算術偏移 <Tex>{String.raw`O(\mu)`}</Tex>）<Erratum id="E40" />；軌跡本身每步跳 <Tex>{String.raw`\pm\mu|x|`}</Tex>，
          抖動的 std 在點質量資料是 <Tex>{String.raw`O(\mu|x|)`}</Tex>，有連續雜訊時約{' '}
          <Tex>{String.raw`\sqrt{\mu/(4f_{\tilde v})}`}</Tex>（F-01.18）。
        </>
      }
      assumptions={[
        String.raw`$\texttt{four\_point}$：$y$ 從 $\{0,0,0,10\}$ 等機率 iid 抽樣、$x\equiv1$（規格 §2.3 例子）`,
        String.raw`$\texttt{contaminated}$：$y=ax+v+o$；$v\sim\mathcal N(0,\sigma_v^2)$；$o$ 以機率 $\varepsilon$ 為 $+s$（或 $\pm s$），與 $x$ 獨立`,
        String.raw`$x$ 分布：$\texttt{const}$（$x\equiv A$）、$\texttt{pm1}$（$x=\pm A$，像 DSM $\pm1$ code）、$\texttt{gaussian}$（$x\sim\mathcal N(0,A^2)$）`,
        String.raw`$\operatorname{sign}(0)$ 慣例：$${TIE_TEX[params.tie]}$（勘誤 E40；不依賴 Math.sign(0)）`,
        '時間平均與標準差只取後半段（避開初始暫態）；SE 用 batch means',
        String.raw`母體最佳解為 $N\to\infty$ 的精確值（混合 Gaussian 的 CDF / Huber 期望值以封閉式 + 二分法求根）`,
      ]}
      params={{ ...params }}
      seed={seed}
      onSeedChange={setSeed}
      units={{ a: '[y]/[x]（依校正對象）', w0: '[y]/[x]', xScale: '[x]', mu: 'LMS／Huber：1/[x]²；Sign-Error：[y]/[x]²（sign(e) 無因次）', sigma: '[y]', outlierProb: '機率（0–1）', outlierSize: '[y]', huberDelta: '[y]', n: 'samples' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{ analytic: analyticCheck, monteCarlo: mcCheck, fixedPoint: fpCheck }}
      actions={{ onReset: () => setParams(MSE_MAE_DEFAULTS), onRun: canStudy ? runStudy : undefined, onStop: study.cancel, running: study.running }}
      exportData={() => ({
        n: Array.from({ length: data.x.length + 1 }, (_, i) => i),
        x: data.x,
        y: data.y,
        outlier: data.outlier,
        w_conventional: runs[0].w,
        w_sign_error: runs[1].w,
        w_huber: runs[2].w,
        w_sign_error_fixed_point: fixed ? fixed.w : [],
      })}
      presets={presets}
      onLoadPreset={(p) => applyParams(p.params)}
      controls={
        <>
          <SelectControl
            label="loss type（突顯）"
            value={params.focus}
            onChange={set('focus')}
            options={[
              { value: 'all', label: '三種並列' },
              { value: 'mse', label: 'MSE ½e²（Conventional LMS）' },
              { value: 'mae', label: 'MAE |e|（Sign-Error LMS）' },
              { value: 'huber', label: 'Huber（Huber LMS）' },
            ]}
            reg="Behavioral: loss_type"
            hint="只改變顯示重點；三種演算法永遠跑在同一組資料上"
          />
          <SelectControl
            label="資料模型"
            value={params.model}
            onChange={set('model')}
            options={[
              { value: 'four_point', label: 'y ∈ {0,0,0,10}（規格 §2.3）' },
              { value: 'contaminated', label: 'y = a·x + v + outlier' },
            ]}
            reg="Behavioral: data_model"
          />
          <SelectControl
            label={
              <>
                <Tex>{'x'}</Tex> 分布
              </>
            }
            ariaLabel="x 分布"
            value={params.xDist}
            onChange={set('xDist')}
            options={[
              { value: 'const', label: 'const：x ≡ A（估常數）' },
              { value: 'pm1', label: 'pm1：x = ±A（DSM ±1 code）' },
              { value: 'gaussian', label: 'gaussian：x ~ N(0, A²)' },
            ]}
            reg="Behavioral: regressor 分布"
            hint={disabledHint}
            disabled={params.model === 'four_point'}
          />
          <ParamControl
            label={
              <>
                <Tex>{'A'}</Tex>（<Tex>{'x'}</Tex> 的大小）
              </>
            }
            ariaLabel="A（x 的大小）"
            value={params.xScale} onChange={set('xScale')} min={0} max={5} step={0.01} unit="$[x]$" reg="Behavioral: code_amplitude" disabled={params.model === 'four_point'} hint={disabledHint} />
          <ParamControl label={symLabel('a', '真實係數')} ariaLabel="a（真實係數）" value={params.a} onChange={set('a')} min={-10} max={10} step={0.01} unit="$[y]/[x]$" reg="Behavioral: true_gain_a" disabled={params.model === 'four_point'} />
          <ParamControl label={symLabel('\\sigma_v', 'Gaussian 雜訊')} ariaLabel="σᵥ（Gaussian 雜訊）" value={params.sigma} onChange={set('sigma')} min={0} max={5} step={0.01} unit="$[y]$" reg="Behavioral: noise_rms_v" disabled={params.model === 'four_point'} />
          <ParamControl label={symLabel('\\varepsilon', 'outlier 比例')} ariaLabel="ε（outlier 比例）" value={params.outlierProb} onChange={set('outlierProb')} min={0} max={0.6} step={0.005} unit="機率" reg="Behavioral: outlier_prob" disabled={params.model === 'four_point'} />
          <ParamControl label={symLabel('s', 'outlier 大小')} ariaLabel="s（outlier 大小）" value={params.outlierSize} onChange={set('outlierSize')} min={0} max={100} step={0.1} unit="$[y]$" reg="Behavioral: outlier_size" disabled={params.model === 'four_point'} />
          <SelectControl
            label="outlier 方向"
            value={params.outlierSign}
            onChange={set('outlierSign')}
            options={[
              { value: 'positive', label: '單邊 +s' },
              { value: 'symmetric', label: '對稱 ±s' },
            ]}
            reg="Behavioral: outlier_sign"
            disabled={params.model === 'four_point'}
          />
          <ParamControl
            label={symLabel('\\mu', '學習率')}
            ariaLabel="μ（學習率）"
            value={params.mu}
            onChange={set('mu')}
            min={0.0001}
            max={2}
            log
            digits={6}
            unit="$1/[x]^2$"
            reg="REG_LMS_MU"
            hint={
              <>
                固定步長；Sign-Error 每步走 <Tex>{String.raw`\mu|x|`}</Tex>；const／<Tex>{String.raw`\pm A`}</Tex> 時 LMS 需 <Tex>{String.raw`\mu A^2<2`}</Tex>。同一個數值在 Sign-Error 的單位是{' '}
                <Tex>{String.raw`[y]/[x]^2`}</Tex>（<Tex>{String.raw`\operatorname{sign}(e)`}</Tex> 無因次）
              </>
            }
          />
          <ParamControl label={symLabel('w_0', '初始值')} ariaLabel="w₀（初始值）" value={params.w0} onChange={set('w0')} min={-20} max={20} step={0.01} unit="$[y]/[x]$" reg="REG_LMS_W_INIT" />
          <ParamControl label={symLabel('N', '樣本數')} ariaLabel="N（樣本數）" value={params.n} onChange={set('n')} min={100} max={20000} step={100} integer clampOnBlur unit="samples" reg="Behavioral: num_updates" />
          <SelectControl
            label={
              <>
                <Tex>{String.raw`\operatorname{sign}(0)`}</Tex> 慣例（tie）
              </>
            }
            ariaLabel="sign(0) 慣例（tie）"
            value={params.tie}
            onChange={set('tie')}
            options={[
              { value: 'zero', label: 'sign(0) = 0（數學次梯度）' },
              { value: 'plus', label: 'sign(0) = +1（comparator tie → +1）' },
              { value: 'minus', label: 'sign(0) = −1（comparator tie → −1）' },
            ]}
            reg="Behavioral: comparator_tie_rule"
          />
          <ParamControl
            label={symLabel('\\delta_H', 'Huber 門檻')}
            ariaLabel="δₕ（Huber 門檻）"
            value={params.huberDelta}
            onChange={set('huberDelta')}
            min={0.01}
            max={20}
            step={0.01}
            unit="$[y]$"
            reg="Behavioral: huber_threshold"
            hint={
              <>
                <Tex>{String.raw`|e|\le\delta_H`}</Tex> 時像 LMS，<Tex>{String.raw`|e|>\delta_H`}</Tex> 時像 <Tex>{String.raw`\delta_H\times`}</Tex> Sign-Error
              </>
            }
          />
        </>
      }
    >
      <div className="ch01-two">
        <Plot title="損失 $\rho(e)$" ariaLabel="三種損失函數 ρ(e)" data={lossPlots.rho} layout={{ xaxis: { title: { text: '$e$' } }, yaxis: { title: { text: String.raw`$\rho(e)$` } } }} height={260} csvName="loss-rho" />
        <Plot
          title="導數 $\psi(e)=d\rho/de$（$\Delta w=\mu\,\psi(e)\,x$）"
          ariaLabel="三種損失的導數 ψ(e)"
          data={lossPlots.psi}
          layout={{ xaxis: { title: { text: '$e$' } }, yaxis: { title: { text: String.raw`$\psi(e)$` } } }}
          height={260}
          csvName="loss-psi"
        />
      </div>
      <Plot
        title="$w_n$：三種演算法吃同一組資料"
        ariaLabel="三種演算法在同一組資料上的 w 軌跡"
        data={wPlot}
        layout={{ xaxis: { title: { text: '$n$（sample）' } }, yaxis: { title: { text: '$w_n$' } } }}
        height={320}
        csvName="mse-mae-w"
        caption={
          <>
            灰帶 = 母體中位數 <Tex>{String.raw`\pm\mu|x|`}</Tex>：Sign-Error <strong>時間平均</strong>的驗證容忍帶（勘誤 E40），不是軌跡的範圍——
            有連續雜訊時軌跡的 std 約 <Tex>{String.raw`\sqrt{\mu/(4f_{\tilde v})}`}</Tex>，會明顯超出灰帶（見指標表）。長序列為顯示而抽點（<Tex>{String.raw`\le2500`}</Tex> 點）；CSV 為完整資料。
          </>
        }
      />
      <div className="ch01-two">
        <Plot
          title={four ? '資料分布 $y$' : String.raw`總雜訊 $\tilde v=y-ax$ 的分布`}
          ariaLabel={four ? '資料 y 的分布' : '總雜訊（y 減去 a 乘 x）的分布'}
          data={histPlot}
          layout={{ xaxis: { title: { text: four ? '$y$' : String.raw`$\tilde v$` } }, yaxis: { title: { text: '筆數' } }, bargap: 0.02 }}
          height={260}
          csvName="mse-mae-hist"
        />
        <Plot
          title="平均成本 $J(w)$（各自正規化到 $[0,1]$）"
          ariaLabel="三種平均成本 J(w)（各自正規化到 0 與 1 之間）"
          data={costPlot}
          layout={{ xaxis: { title: { text: '$w$' } }, yaxis: { title: { text: String.raw`$(J-\min)/(\max-\min)$` } } }}
          height={260}
          csvName="mse-mae-cost"
        />
      </div>
      {latticePlot && (
        <Plot
          title="Sign-Error 的精確穩態分布 $\pi(w)$（lattice Markov 鏈）"
          ariaLabel="Sign-Error 的精確穩態分布（lattice Markov 鏈）"
          data={latticePlot}
          layout={{ xaxis: { title: { text: String.raw`$w$（格點 $w_0+\mu|x|\,k$）` } }, yaxis: { title: { text: String.raw`$\pi$` } }, bargap: 0.1 }}
          height={240}
          csvName="mse-mae-lattice"
          caption={
            <>
              由流量平衡 <Tex>{String.raw`\pi_j\,u_j=\pi_{j+1}\,d_{j+1}`}</Tex> 精確計算（<code>lossCompare.ts</code> core:signErrorLattice），不是模擬直方圖。
            </>
          }
        />
      )}

      <Callout kind="info" title="長時間 tie 慣例研究（Worker，$4\times10^5$ 步）">
        <p className="small">
          按上方「執行 Run」：用同一組資料，分別以三種 <Tex>{String.raw`\operatorname{sign}(0)`}</Tex> 慣例 <Tex>{String.raw`\times`}</Tex> 兩種算術（IEEE double 連加 / 定點整數
          code）跑 <Tex>{String.raw`4\times10^5`}</Tex> 步，比較時間平均與 lattice 精確值。
          {!canStudy && (
            <>
              {' '}
              目前是 Gaussian <Tex>{'x'}</Tex>：<Tex>{'|x|'}</Tex> 不固定，沒有格點，無法做此研究。
            </>
          )}
        </p>
        {studyErr && <p className="small">錯誤：{studyErr}</p>}
        {study.running && <p className="small">計算中…</p>}
        {studyRes && (
          <div className="table-wrap">
            <table className="ch01-table">
              <thead>
                <tr>
                  <th>tie 慣例</th>
                  <th>算術</th>
                  <th className="num">
                    時間平均 <Tex>{String.raw`\pm`}</Tex> SE
                  </th>
                  <th className="num">lattice 精確平均</th>
                  <th className="num">std（lattice 精確）</th>
                  <th className="num">
                    <Tex>{'e=0'}</Tex> 次數
                  </th>
                </tr>
              </thead>
              <tbody>
                {studyRes.rows.map((r) => (
                  <tr key={`${r.tie}-${r.arithmetic}`}>
                    <td>
                      <Tex>{TIE_TEX[r.tie]}</Tex>
                    </td>
                    <td>{r.arithmetic === 'ieee' ? 'IEEE double（lms.ts）' : '定點整數 code'}</td>
                    <td className="num">
                      {f(r.timeAvg, 5)} <Tex>{String.raw`\pm`}</Tex> {Number.isFinite(r.se) ? f(r.se, 2) : '—（相關時間太長，估不出 SE）'}
                    </td>
                    <td className="num">{r.latticeMean === null ? '—' : f(r.latticeMean, 5)}</td>
                    <td className="num">
                      {f(r.std, 4)}（{r.latticeStd === null ? '—' : f(r.latticeStd, 4)}）
                    </td>
                    <td className="num">{r.tieHits}</td>
                  </tr>
                ))}
              </tbody>
              <caption>
                {studyRes.steps} 步（只取後半段平均）。IEEE double 連加 <Tex>{String.raw`\pm\mu`}</Tex> 會讓「中位數那一格」偏離 0 一點點（例如{' '}
                <Tex>{String.raw`\mu=0.2`}</Tex> 時 <Tex>{String.raw`0.2+0.2+0.2-0.2-0.2-0.2=${texNum(IEEE_RESIDUE_02, 3)}`}</Tex>，即時計算），<Tex>{'e=0'}</Tex> 幾乎不再發生，tie 慣例因而失效——這正是 <Erratum id="E40" />{' '}
                要求「明定慣例與算術」的原因。
              </caption>
            </table>
          </div>
        )}
      </Callout>

      <TryIt>
        (1) <code>four_point</code>、<Tex>{String.raw`\mu=0.2`}</Tex>：LMS 在 2.5 附近大幅抖動（std{' '}
        <Tex>{String.raw`\approx\sqrt{0.2\cdot18.75/1.8}\approx1.44`}</Tex>），Sign-Error 停在中位數 0 附近。(2) 把 tie 換成{' '}
        <Tex>{'+1'}</Tex> / <Tex>{'-1'}</Tex>，看定點時間平均變成 <Tex>{'\\mu'}</Tex>、<Tex>{'0'}</Tex>。(3) 切到 <code>contaminated</code>、
        <Tex>{String.raw`\varepsilon=0.1,\ s=20`}</Tex>：LMS 被拉到 <Tex>{String.raw`a+\varepsilon s/A`}</Tex>，中位數幾乎不動。(4) 改用 gaussian{' '}
        <Tex>{'x'}</Tex>：三種母體最佳解都回到 <Tex>{'a'}</Tex>——outlier 只讓 LMS 抖得更大，不再偏移。(5) <code>contaminated</code>、const{' '}
        <Tex>{'x'}</Tex>、<Tex>{String.raw`A=2,\ \mu=0.6`}</Tex>（<Tex>{String.raw`\mu A^2=2.4>2`}</Tex>）：LMS 發散，Sign-Error 只是跳得很大——看警告怎麼解釋。(6) 留在{' '}
        <code>contaminated</code>，把 <Tex>{'\\mu'}</Tex> 從 0.2 降到 0.002：Sign-Error 的 std 只縮小 <Tex>{String.raw`\sqrt{100}=10`}</Tex> 倍，不是 100 倍
        （指標表的「擴散近似」列）。(7) 載入 preset「無雜訊 Sign-Error：sign(0) 慣例與算術」：定點版凍結在 3，IEEE 版在兩格之間來回——勘誤 E40 的數值證據。
      </TryIt>

      <CodeBlock
        source={lossSrc}
        region="runOnSameData"
        path="src/simulation/models/lossCompare.ts"
        title="同一組資料、只換 STEP[variant]"
        caption="三條曲線就是這個迴圈跑三次；資料由 generateLossData 以同一個 seed 產生。"
      />
    </ExperimentShell>
  )
}
