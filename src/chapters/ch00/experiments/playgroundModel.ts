/**
 * intro-playground 實驗的純計算部分（不 import React）。
 * 核心模擬一律呼叫 lms.ts 的 runScalarLms（固定 x、可加量測雜訊），本檔只做：
 * Freeze 分段、解析值（pole、封閉解、穩態變異數）、警告文字與 Monte Carlo 交叉比對。
 */
import { deriveSeed } from '@/simulation/core'
import {
  classifyPole,
  fixedXMuMax,
  fixedXPole,
  runScalarLms,
  type PoleBehaviour,
} from '@/simulation/models/lms'
import { closedFormW, steadyStateVarW, stepsToFraction } from '../model'
import { POLE_BEHAVIOUR_TEX, texRes } from '../format'

export const EXP_ID = 'intro-playground'

export interface PlaygroundBase {
  a: number
  w0: number
  x: number
  steps: number
  sigmaV: number
}

export const DEFAULT_BASE: PlaygroundBase = { a: 3, w0: 1, x: 2, steps: 30, sigmaV: 0 }
/** 入門課的三個 μ：慢 / 穩 / 發散（x = 2 時理論界 0 < μ < 0.5） */
export const DEFAULT_MUS = [0.02, 0.1, 0.65]
export const SEED_DEFAULT = 20261010

export interface CaseRun {
  mu: number
  /** w_0 … w_steps（發散後為 NaN） */
  w: Float64Array
  /** e_0 … e_{steps−1} */
  e: Float64Array
  /** y_n = e_n + w_n·x */
  y: Float64Array
  delta: Float64Array
  diverged: boolean
  /** 第一個非有限 / 超過 1e12 的步數（未發散為 null） */
  divergeStep: number | null
  p: number
  behaviour: PoleBehaviour
  n1pct: number
  /** 理論穩態變異數（σ_v > 0 且 |p| < 1 時有意義） */
  varTheory: number
}

/**
 * 跑一組 μ。freezeAt（若有）之後 μ = 0：w 停在 w[freezeAt]，誤差序列改用另一條（seed 派生的）雜訊。
 */
export function runCase(base: PlaygroundBase, mu: number, seed: number, freezeAt: number | null): CaseRun {
  const steps = Math.max(1, Math.round(base.steps))
  const k = freezeAt !== null && freezeAt < steps ? Math.max(0, Math.round(freezeAt)) : null
  const common = { variant: 'conventional' as const, a: base.a, x: { kind: 'fixed' as const, value: base.x }, noiseSigma: base.sigmaV }
  const first = runScalarLms({ ...common, w0: base.w0, mu, steps: k ?? steps, seed })
  let w = first.w
  let e = first.e
  if (k !== null) {
    const wk = first.w[k]
    // Freeze：μ = 0，w 不再更新；仍然量測誤差（雜訊用派生 seed，避免與前段重複）
    const rest = runScalarLms({ ...common, w0: Number.isFinite(wk) ? wk : Number.NaN, mu: 0, steps: steps - k, seed: deriveSeed(seed, 'after-freeze') })
    const wAll = new Float64Array(steps + 1)
    wAll.set(first.w.subarray(0, k + 1), 0)
    wAll.set(rest.w.subarray(1), k + 1)
    const eAll = new Float64Array(steps)
    eAll.set(first.e.subarray(0, k), 0)
    eAll.set(rest.e, k)
    w = wAll
    e = eAll
  }
  const y = new Float64Array(e.length)
  for (let n = 0; n < e.length; n++) y[n] = e[n] + w[n] * base.x
  const delta = w.map((v) => base.a - v)
  let divergeStep: number | null = null
  for (let n = 0; n < w.length; n++) {
    if (!Number.isFinite(w[n]) || Math.abs(w[n]) > 1e12) {
      divergeStep = n
      break
    }
  }
  const p = fixedXPole(mu, base.x)
  return {
    mu,
    w,
    e,
    y,
    delta,
    diverged: divergeStep !== null,
    divergeStep,
    p,
    behaviour: classifyPole(p),
    n1pct: stepsToFraction(p),
    varTheory: steadyStateVarW(mu, base.x, base.sigmaV),
  }
}

/**
 * 每個 case 的警告（必須解釋原因，而不只是「失敗」）。
 * 字串中的 `$…$` 是行內 TeX：ExperimentShell 會以 KaTeX 顯示（docs/teaching-style.md §3：數學一律 LaTeX）。
 */
export function caseWarnings(id: string, base: PlaygroundBase, r: CaseRun): string[] {
  const out: string[] = []
  const muMax = fixedXMuMax(base.x)
  if (base.x === 0) return out // x = 0 的警告在 baseWarnings 統一說明
  if (r.mu < 0) {
    out.push(
      String.raw`Case ${id}：$\mu=${texRes(r.mu)}<0$：更新方向和「下坡」相反（往成本變大的方向走）。$p=1-\mu x^2=${texRes(r.p)}>1$，誤差每一步被放大 → 發散。這就是「更新極性錯誤（polarity）」：在 PLL 校正中，錯的 regressor 相位或錯的 0/1 編碼都會造成同樣的效果（Ch06）。`,
    )
  } else if (r.mu === 0) {
    out.push(String.raw`Case ${id}：$\mu=0$：完全不更新，$w$ 永遠停在 $w_0=${texRes(base.w0)}$（$p=1$）。`)
  } else if (r.behaviour === 'boundary') {
    out.push(
      String.raw`Case ${id}：$\mu=${texRes(r.mu)}=2/x^2$ 剛好在邊界：$p=${texRes(r.p)}$，$|\delta|$ 每步不變、只會正負交替，永遠不會收斂到 $a$。`,
    )
  } else if (r.behaviour === 'divergent') {
    const stop = r.divergeStep !== null ? String.raw`；第 ${r.divergeStep} 步 $|w|$ 超過 $10^{12}$，模擬提前停止` : ''
    out.push(
      String.raw`Case ${id}：$\mu=${texRes(r.mu)}$ 超過穩定上限 $2/x^2=${texRes(muMax)}$：$p=1-\mu x^2=${texRes(r.p)}$，$|p|>1$。每一步都「修正過頭」並跳到 $a$ 的另一側，而且離得更遠（誤差每步放大 $${texRes(Math.abs(r.p), 4)}$ 倍）→ 發散${stop}。`,
    )
  }
  return out
}

export function baseWarnings(base: PlaygroundBase): string[] {
  const out: string[] = []
  if (base.x === 0) {
    out.push(
      String.raw`$x=0$：預測 $\hat y=w\cdot0=0$ 與 $w$ 無關，所以 $e\,x\equiv0$、更新量永遠是 0。這組輸入完全不含 $a$ 的資訊（不可辨識，unidentifiable），任何 $\mu$ 都學不到 $a$。請把 $x$ 改成非零值。`,
    )
  }
  return out
}

/** 解析交叉比對：σ_v = 0 時，遞迴（runScalarLms）與封閉解 w_n = a − (a − w0)pⁿ 的最大相對差。 */
export function analyticMaxError(base: PlaygroundBase, runs: CaseRun[], freezeAt: number | null): number {
  let worst = 0
  for (const r of runs) {
    const nEnd = freezeAt !== null ? Math.min(freezeAt, r.w.length - 1) : r.w.length - 1
    for (let n = 0; n <= nEnd; n++) {
      if (!Number.isFinite(r.w[n])) break
      const ref = closedFormW(base.a, base.w0, base.x, r.mu, n)
      const err = Math.abs(r.w[n] - ref) / Math.max(1, Math.abs(ref))
      if (err > worst) worst = err
    }
  }
  return worst
}

// #region core:ar1VarianceCheck
/**
 * 固定 x、白色 Gaussian 雜訊時，穩態的 δ_n 是係數 p 的 AR(1)：δ_{n+1} = p·δ_n − μ·x·v_n。
 * 對 n 個「彼此相關」的樣本算樣本變異數 s²，要用 AR(1) 的相關結構才能誠實地判斷誤差棒：
 *   ρ_k = p^|k|
 *   E[s²]   = σ²·c,  c = (n − S/n)/(n − 1),  S = Σ_iΣ_j ρ_{|i−j|} = n + 2Σ_{k=1}^{n−1}(n − k)p^k   ← 有限樣本偏差
 *   Var(s²) ≈ (2σ⁴/n)·Σ_k ρ_k² = (2σ⁴/n)·(1 + p²)/(1 − p²)                               ← Gaussian 四階矩
 *   ⇒ 變異數用的有效樣本數 n_eff = n(1 − p²)/(1 + p²)，SE(s) ≈ σ/√(2·n_eff)
 * 注意：估「平均值」用的 ESS = n(1 − p)/(1 + p) 在 p < 0（震盪收斂）時會大於 n，拿來估變異數的誤差棒會嚴重低估。
 */
export function ar1SampleVarianceFactor(p: number, n: number): number {
  let s = n
  let pk = 1
  for (let k = 1; k < n; k++) {
    pk *= p
    s += 2 * (n - k) * pk
    if (Math.abs(pk) < 1e-18) break
  }
  return (n - s / n) / (n - 1)
}

export function ar1VarianceEss(p: number, n: number): number {
  return (n * (1 - p * p)) / (1 + p * p)
}
// #endregion

export interface SteadyStateCheck {
  /** 穩態段 w 的樣本標準差 */
  stdMc: number
  /** 理論 √Var(w_∞) */
  stdTheory: number
  /** 有限樣本下樣本標準差的期望值 σ·√c（c 見 ar1SampleVarianceFactor） */
  stdExpected: number
  /** 變異數用的有效樣本數 n(1 − p²)/(1 + p²) */
  ess: number
  /** z = (s − σ√c)/(σ/√(2·n_eff)) */
  z: number
  /** 使用的樣本數 */
  used: number
  /** 穩態段起點（之前視為暫態） */
  start: number
}

/** 進行穩態比對所需的最小有效樣本數（太少時樣本標準差的分布離 Gaussian 太遠，z 檢定不可信）。 */
export const MIN_VARIANCE_ESS = 30

/**
 * Monte Carlo 交叉比對：取穩態段 w 的樣本標準差，與 √(μσ_v²/(2 − μx²)) 比較（z 檢定，AR(1) 誤差棒）。
 * 只在 σ_v > 0、0 < |p| 的收斂區、未 Freeze、步數 ≥ 200、n_eff ≥ MIN_VARIANCE_ESS 時進行；否則回傳 null。
 */
export function steadyStateCheck(base: PlaygroundBase, r: CaseRun, freezeAt: number | null): SteadyStateCheck | null {
  if (!(base.sigmaV > 0) || Math.abs(r.p) >= 1 || r.mu <= 0 || freezeAt !== null || base.x === 0) return null
  const steps = r.w.length - 1
  if (steps < 200) return null
  const stdTheory = Math.sqrt(r.varTheory)
  // 暫態：確定性的殘差 |δ0|·|p|ⁿ 降到理論 std 的 1% 以下，且至少丟掉前一半
  const d0 = Math.abs(base.a - base.w0)
  const ap = Math.abs(r.p)
  const decay = d0 === 0 || ap === 0 ? 1 : Math.ceil(Math.log((0.01 * stdTheory) / d0) / Math.log(ap))
  const start = Math.max(Math.floor(steps / 2), decay, 1)
  if (steps + 1 - start < 100) return null
  const seg = r.w.subarray(start)
  const n = seg.length
  const ess = ar1VarianceEss(r.p, n)
  if (ess < MIN_VARIANCE_ESS) return null
  let m = 0
  for (const v of seg) m += v
  m /= n
  let s2 = 0
  for (const v of seg) s2 += (v - m) * (v - m)
  const stdMc = Math.sqrt(s2 / (n - 1))
  const stdExpected = stdTheory * Math.sqrt(ar1SampleVarianceFactor(r.p, n))
  const z = (stdMc - stdExpected) / (stdTheory / Math.sqrt(2 * ess))
  return { stdMc, stdTheory, stdExpected, ess, z, used: n, start }
}

/** pole 行為的說明（含 `$…$` 行內 TeX；指標表的 note 會以 KaTeX 顯示）。 */
export function behaviourLabel(b: PoleBehaviour): string {
  return POLE_BEHAVIOUR_TEX[b]
}

/** |w| 超過此值視為發散（與 lms.ts 的 runScalarLms 相同的門檻）。 */
export const DIVERGE_LIMIT = 1e12

export interface DeltaPlotScale {
  /** 對數縱軸的下限（> 0） */
  floor: number
  /** 對數縱軸的上限 */
  top: number
}

/**
 * |δ_n| 對數圖的縱軸範圍。沒有它的話，解析線 |δ₀||p|ⁿ 會一路畫到 1e-300（長時間模擬時下溢成 0），
 * 或在發散的 Case 衝到 1e300，把真正要看的部分壓成一條線。
 *   下限：有雜訊時，低於「雜訊地板」的暫態沒有意義 → 取各 Case 理論穩態 std 的最小值 ÷ 30；
 *         無雜訊時取倍精度的極限（約 |a|·1e-17，再低就是浮點捨入）。
 *   上限：模擬的 |δ| 與 |δ₀| 的最大值，但不超過發散門檻 1e12。
 */
export function deltaPlotScale(base: PlaygroundBase, runs: CaseRun[]): DeltaPlotScale {
  let top = Math.abs(base.a - base.w0)
  for (const r of runs) {
    for (const v of r.delta) {
      const av = Math.abs(v)
      if (Number.isFinite(av) && av > top) top = av
    }
  }
  top = Math.min(top, DIVERGE_LIMIT)
  if (!(top > 0)) top = 1 // w0 = a 且無雜訊：全部是 0，給一個不會出錯的範圍
  let floor: number
  if (base.sigmaV > 0) {
    const sds = runs.map((r) => Math.sqrt(r.varTheory)).filter((sd) => Number.isFinite(sd) && sd > 0)
    floor = (sds.length > 0 ? Math.min(...sds) : base.sigmaV * 1e-3) / 30
  } else {
    floor = 1e-17 * Math.max(1, Math.abs(base.a))
  }
  if (!(floor < top)) floor = top * 1e-6
  return { floor, top }
}

/** 解析衰減線 |δ₀||p|ⁿ（n = 0 … nMax）：只保留仍在 [floor, top] 內的那一段，離開範圍後就不再畫。 */
export function analyticDecayLine(d0: number, p: number, nMax: number, scale: DeltaPlotScale): { n: number[]; y: number[] } {
  const n: number[] = []
  const y: number[] = []
  const ap = Math.abs(p)
  for (let k = 0; k <= nMax; k++) {
    const v = d0 * Math.pow(ap, k)
    if (!(v >= scale.floor && v <= scale.top * (1 + 1e-9))) break
    n.push(k)
    y.push(v)
  }
  return { n, y }
}

/** w 圖的顯示範圍：以 a 為中心，避免發散 case 把其他曲線壓扁。 */
export function wPlotRange(base: PlaygroundBase, runs: CaseRun[]): [number, number] {
  const sd = Math.max(0, ...runs.map((r) => (Number.isFinite(r.varTheory) ? Math.sqrt(r.varTheory) : 0)))
  const span = Math.max(Math.abs(base.a - base.w0), 4 * sd, 0.5)
  let lo = Math.min(base.a, base.w0)
  let hi = Math.max(base.a, base.w0)
  for (const r of runs) {
    for (const v of r.w) {
      if (!Number.isFinite(v)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  const pad = 0.08 * span
  return [Math.max(lo, base.a - 3 * span) - pad, Math.min(hi, base.a + 3 * span) + pad]
}

/**
 * e_n 圖的縱軸範圍：以初始誤差 |x(a − w0)| 與穩態誤差的 4σ 為尺度（穩態 Var(e) = x²Var(w∞) + σ_v²），
 * 發散的 case 不會把其他曲線壓扁。
 */
export function ePlotRange(base: PlaygroundBase, runs: CaseRun[]): [number, number] {
  const sdW = Math.max(0, ...runs.map((r) => (Number.isFinite(r.varTheory) ? r.varTheory : 0)))
  const sdE = Math.sqrt(base.x * base.x * sdW + base.sigmaV * base.sigmaV)
  const span = Math.max(Math.abs(base.x * (base.a - base.w0)), 4 * sdE, 0.5)
  let lo = 0
  let hi = 0
  for (const r of runs) {
    for (const v of r.e) {
      if (!Number.isFinite(v)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  const pad = 0.08 * span
  return [Math.max(lo, -1.5 * span) - pad, Math.min(hi, 1.5 * span) + pad]
}
