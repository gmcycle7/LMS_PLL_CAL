/**
 * Sign-off Checklist / Design Review 頁（/signoff；規格 §16.2、§16.3、§17 反面測試、附錄 B）的判斷數學與小型模擬。
 *
 * - 純函式，不 import React／DOM；頁面上的每一個數字、每一條曲線都由這裡計算（不手寫結果）。
 * - 頁面以 `?raw` + `#region core:<name>` 直接顯示這些程式碼（docs/teaching-style.md §4）。
 * - 極性一律 δ = a − w（規格 §0；勘誤 E32/E39）；時間單位 fs；n = comparator sample、k = GMAC block。
 * - 這裡的模擬都很小（每個實驗每次重算合計 ≤ SAMPLE_BUDGET 個 comparator sample，約 20–50 ms），因此在主執行緒以 useDeferredValue 執行；
 *   本頁不擁有 src/simulation/models/ 的檔案，無法掛 Web Worker（見回報的「建議上移」）。
 */
import {
  binomCdf,
  createRng,
  eigSym,
  eigvals,
  erf,
  fsToRad,
  identity,
  inv,
  matAdd,
  matMul,
  matScale,
  mean,
  normCdf,
  polyRoots,
  solve,
  svd,
  transpose,
  variance,
  type Complex,
  type Matrix,
  type Rng,
} from '@/simulation/core'
import { corrSingleTone, ctHpd, ctT, polarityMarginDeg, singleToneFir } from '@/simulation/models/pll'
import { settleDelayed, SETTLE_MAX_STEPS } from '@/pages/dashboard/thesisModel'
import { buildSignLmsMcConfig, compareMcToLinear, simulateDelayRecursion, type McComparison, type SignLmsMcSetup } from '@/simulation/models/stability'
import type { BlockLmsConfigInput, BlockLmsMonteCarloResult } from '@/simulation/models/blockLms'

/** 一個實驗每次重算可用的 comparator sample 上限（超過就自動減少 block 數／掃描點數並提示）。 */
export const SAMPLE_BUDGET = 200_000

/* ───────────────────────────── 基本量 ───────────────────────────── */

/** 1-bit comparator 小訊號增益 K_q = √(2/π)/σ_v [fs⁻¹]（§5.1；只在 |s| ≪ σ_v 成立）。 */
export function kq(sigmaV: number): number {
  return Math.sqrt(2 / Math.PI) / sigmaV
}

/** 把數字寫成 TeX（科學記號改成 a×10^{b}），給含 `$…$` 的警告字串用。 */
export function texNum(x: number, digits = 3): string {
  if (!Number.isFinite(x)) return x > 0 ? '\\infty' : x < 0 ? '-\\infty' : '\\text{NaN}'
  const [m, e] = x.toExponential(digits).split('e')
  const k = Number(e)
  return k === 0 ? m : `${m}\\times10^{${k}}`
}

/** 兩個非負整數的最大公因數。 */
export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y) [x, y] = [y, x % y]
  return x
}

/* ───────────────────── 1. 基本正確性：freeze + ±Δw ───────────────────── */

export interface SlopeEstimate {
  /** Ŝ = ∂E[G]/∂w 的中央差分估計 [fs⁻¹] */
  S: number
  /** K̂ = −Ŝ（> 0 才有恢復力） */
  K: number
  /** Ŝ 的標準誤 */
  se: number
  /** z = K̂ / se */
  z: number
  gPlusMean: number
  gMinusMean: number
}

// #region core:centralDiff
/**
 * 凍結 w（不更新），在 w + Δ 與 w − Δ 各量 M 個 block 的 GMAC 平均 G_k，用中央差分估計斜率：
 *   Ŝ = (Ḡ₊ − Ḡ₋)/(2Δ),  K̂ = −Ŝ,  se(Ŝ) = √(s₊²/M₊ + s₋²/M₋)/(2Δ)
 * 兩側的 block 互相獨立（不同時間、獨立的 comparator 雜訊），所以變異數相加。
 */
export function centralDifference(gPlus: ArrayLike<number>, gMinus: ArrayLike<number>, delta: number): SlopeEstimate {
  const gp = mean(gPlus)
  const gm = mean(gMinus)
  const S = (gp - gm) / (2 * delta)
  const vp = gPlus.length > 1 ? variance(gPlus) / gPlus.length : NaN
  const vm = gMinus.length > 1 ? variance(gMinus) / gMinus.length : NaN
  const se = Math.sqrt(vp + vm) / (2 * delta)
  return { S, K: -S, se, z: -S / se, gPlusMean: gp, gMinusMean: gm }
}
// #endregion

export type PolarityVerdict = 'pass' | 'reversed' | 'inconclusive'

// #region core:polarityVerdict
/**
 * 三分法判決（z 為單邊信心倍數，例如 3）：
 *   K̂ − z·se > 0 ⇒ 'pass'      （恢復力顯著存在，極性正確）
 *   K̂ + z·se < 0 ⇒ 'reversed'  （顯著為負：極性錯誤，正 μ 會發散）
 *   其他          ⇒ 'inconclusive'（C ≈ 0 或量測不夠：加大 M、Δ，或換 FCW）
 */
export function polarityVerdict(K: number, se: number, z: number): PolarityVerdict {
  if (!Number.isFinite(K) || !(se >= 0)) return 'inconclusive'
  if (K - z * se > 0) return 'pass'
  if (K + z * se < 0) return 'reversed'
  return 'inconclusive'
}
// #endregion

/**
 * identity path、±1 code、Gaussian 雜訊、w = a 處的中央差分「截斷比」：
 *   Ŝ_exact/S_lin = erf(Δ/(√2σ_v))/(K_qΔ)  （= 1 − Δ²/(6σ_v²) + …）
 * Δ = 0.3σ_v ⇒ 0.98520（−1.5%）；Δ = σ_v ⇒ 0.85562（−14.4%）。
 */
export function secantRatio(delta: number, sigmaV: number): number {
  if (delta === 0) return 1
  return erf(delta / (Math.SQRT2 * sigmaV)) / (kq(sigmaV) * delta)
}

/**
 * 判決需要的每側 block 數：要 z·se ≤ K̂，以 Var(G_k) ≈ σ_η² ≈ 1/N（±1 code、近平衡）：
 *   se = σ_η/(Δ√(2M)) ⇒ M ≥ z²/(2NΔ²K²)
 */
export function requiredBlocks(K: number, delta: number, N: number, z: number): number {
  if (!(K !== 0) || !(delta > 0) || !(N > 0)) return Infinity
  return Math.max(1, Math.ceil((z * z) / (2 * N * delta * delta * K * K)))
}

/**
 * 量測前「預期」的斜率標準誤（F-SO.3）：se(Ŝ) = σ_η/(Δ√(2M))，σ_η ≈ 1/√N（±1 code、近平衡、兩側各 M 個獨立 block）。
 * 實際量測時 centralDifference 以樣本變異數估計同一個量；requiredBlocks 是把 K/se ≥ z 反過來解 M。
 */
export function slopeStdErr(delta: number, N: number, M: number): number {
  return 1 / Math.sqrt(N) / (delta * Math.sqrt(2 * M))
}

/* ── 位元映射：硬體 b ∈ {0,1} → q（§16.1-1、§17「錯誤位元符號」） ── */

export type BitMapping = 'bipolar' | 'reversed' | 'unipolar'

// #region core:mapBipolar
/** 正確：q = 2b − 1 ∈ {−1, +1}（e ≥ 0 ⇒ b = 1；tie 規則同 §15.2／E07） */
export function mapBipolar(b: number): number {
  return 2 * b - 1
}
// #endregion

// #region core:mapReversed
/** 錯誤：comparator 兩端接反、或 PD 極性定義相反 */
export function mapReversed(b: number): number {
  return 1 - 2 * b // ← 差異：q 整個變號 ⇒ K = K_qC 變號 ⇒ 正 μ 平均發散
}
// #endregion

// #region core:mapUnipolar
/** 錯誤：忘了把 0/1 映射成 ±1 */
export function mapUnipolar(b: number): number {
  return b // ← 差異：E[b·x] = ½E[q·x] + ½E[x]：斜率減半，且 E[x] ≠ 0 時固定點偏移
}
// #endregion

export const BIT_MAP: Record<BitMapping, (b: number) => number> = {
  bipolar: mapBipolar,
  reversed: mapReversed,
  unipolar: mapUnipolar,
}

/* ── GMAC 累加器的三種寫法（§16.1-3、§16.1-4；§17「N 改變卻忘記 scaling」「定點 overflow」） ── */

/** two's complement wrap 到 bits 位元（含 sign）：((v + 2^{b−1}) mod 2^b) − 2^{b−1} */
export function wrapTwos(v: number, bits: number): number {
  const m = 2 ** bits
  const h = 2 ** (bits - 1)
  return ((((v + h) % m) + m) % m) - h
}

/** 飽和到 bits 位元的有號範圍 [−2^{b−1}, 2^{b−1} − 1] */
export function saturateTwos(v: number, bits: number): number {
  const h = 2 ** (bits - 1)
  return Math.min(h - 1, Math.max(-h, v))
}

// #region core:gmacAverage
/** 正確：block 平均 G = (1/N)Σ q·x_D（G 無因次；μ 的單位與 w 相同） */
export function gmacAverage(q: ArrayLike<number>, xd: ArrayLike<number>): number {
  let acc = 0
  for (let n = 0; n < q.length; n++) acc += q[n] * xd[n]
  return acc / q.length
}
// #endregion

// #region core:gmacSum
/** RTL 常見：只做總和（沒有 /N 或 >> log2 N） */
export function gmacSum(q: ArrayLike<number>, xd: ArrayLike<number>): number {
  let acc = 0
  for (let n = 0; n < q.length; n++) acc += q[n] * xd[n]
  return acc // ← 差異：少了 /N：同一個 μ 的有效迴路增益 g 放大 N 倍
}
// #endregion

// #region core:gmacSumWrapped
/** RTL 定點：累加器只有 bits 位元（two's complement） */
export function gmacSumWrapped(q: ArrayLike<number>, xd: ArrayLike<number>, bits: number): number {
  let acc = 0
  for (let n = 0; n < q.length; n++) acc = wrapTwos(acc + q[n] * xd[n], bits) // ← 差異：位元不足時 wrap，符號可能翻轉
  return acc
}
// #endregion

/* ── 凍結 w 的 GMAC 量測模擬（L1/L2：±1 或單頻 code、2-tap 誤差路徑、Gaussian comparator） ── */

export type CodeKind = 'bpsk' | 'tone'

export interface PolarityPerturbParams {
  /** code：iid ±1（BPSK／隨機化 DSM 的理想化）或單頻 √2·cos(Ωn + θ₀)（unit RMS） */
  code: CodeKind
  /** 誤差路徑在 Ω 的 |H|（2-tap FIR 精確實現） */
  magH: number
  /** 誤差路徑在 Ω 的相位 φ [deg] */
  phiDeg: number
  /** Ω [rad/sample]，0 < Ω < π */
  omega: number
  /** GMAC 使用 x[n − D] 的 code delay D [samples] */
  D: number
  /** 硬體位元映射 */
  mapping: BitMapping
  /** comparator 前雜訊 σ_v [fs] */
  sigmaV: number
  /** 真實係數 a [fs/unit code] */
  a: number
  /** 凍結的工作點 w₀ [fs/unit code] */
  w0: number
  /** 擾動 Δw [fs/unit code] */
  delta: number
  /** 每個 GMAC block 的樣本數 */
  N: number
  /** 每側 block 數 */
  M: number
  /** S 曲線掃描點數（0 = 不掃描） */
  sweepPoints: number
  /** 掃描半寬 [fs]（以 a 為中心） */
  sweepSpan: number
  /** 每個掃描點的 block 數 */
  sweepBlocks: number
  /** 判決的 z 倍數 */
  z: number
  seed: number
  /** 這一次量測可用的 comparator sample 上限（預設 SAMPLE_BUDGET；A／B／C 對照時由呼叫端平分） */
  budget?: number
}

export interface PolarityPerturbResult {
  h: number[]
  /** 解析有效相關 C_D（單頻：|H|cos(φ + ΩD)；±1 code：Σ_k h[k]R_x[k − D] = h[D]） */
  C: number
  /** 線性化（小訊號）K = K_q·C·(映射係數) */
  Klin: number
  /** 精確 mean-field 的中央差分（含 erf 截斷），作為 Monte Carlo 的 analytic 對照 */
  KmeanField: number
  est: SlopeEstimate
  verdict: PolarityVerdict
  gPlus: Float64Array
  gMinus: Float64Array
  sweep: { w: number[]; gMean: number[]; gSe: number[] }
  meanFieldCurve: { w: number[]; g: number[] }
  samplesUsed: number
  Meff: number
  warnings: string[]
}

/** 映射對 E[q|e] 的線性效果：bipolar ×1、reversed ×(−1)、unipolar ×½（並另有 E[x]/2 offset） */
export const MAPPING_GAIN: Record<BitMapping, number> = { bipolar: 1, reversed: -1, unipolar: 0.5 }

/** 解析 C_D：單頻用 corrSingleTone（A = √2 ⇒ A²/2 = 1）；±1 iid code 用 Σ_k h[k]R_x[k − D] = h[D]。 */
export function analyticC(p: Pick<PolarityPerturbParams, 'code' | 'magH' | 'phiDeg' | 'omega' | 'D'>): number {
  const phi = (p.phiDeg * Math.PI) / 180
  if (p.code === 'tone') return corrSingleTone({ amplitude: Math.SQRT2, magnitude: p.magH, phaseRad: phi, omega: p.omega, delay: p.D })
  const h = singleToneFir(p.magH, phi, p.omega)
  return p.D >= 0 && p.D < h.length ? h[p.D] : 0
}

/** P(b = 1 | e_det) = P(e_det + v ≥ 0) = Φ(e_det/σ_v)；σ_v = 0 時為階梯函數。 */
function pOne(eDet: number, sigmaV: number): number {
  if (sigmaV <= 0) return eDet >= 0 ? 1 : 0
  return normCdf(eDet / sigmaV)
}

/** E[q | e_det]，依位元映射。 */
function eq(eDet: number, sigmaV: number, mapping: BitMapping): number {
  const p1 = pOne(eDet, sigmaV)
  return BIT_MAP[mapping](1) * p1 + BIT_MAP[mapping](0) * (1 - p1)
}

// #region core:meanField
/**
 * 凍結 w 時 GMAC 的精確平均 E[G](w)（mean-field；無 Monte Carlo 誤差）。
 *   ±1 iid code：列舉 (x[n], x[n−1]) 四種組合（各 ¼），u = h₀x[n] + h₁x[n−1]，e_det = (a − w)u，
 *               E[q|e_det] = Σ_b map(b)·P(b)，P(b = 1) = Φ(e_det/σ_v)；D ≥ 2 時 x[n−D] 與 q 獨立 ⇒ 0。
 *   單頻 code ：對隨機初相 ψ 平均（512 點梯形 = 週期函數的譜精度積分）。
 */
export function meanFieldG(p: Pick<PolarityPerturbParams, 'code' | 'magH' | 'phiDeg' | 'omega' | 'D' | 'mapping' | 'sigmaV' | 'a'>, w: number): number {
  const phi = (p.phiDeg * Math.PI) / 180
  const d = p.a - w
  if (p.code === 'bpsk') {
    const [h0, h1 = 0] = singleToneFir(p.magH, phi, p.omega)
    if (p.D >= 2) return 0
    let s = 0
    for (const x0 of [-1, 1]) {
      for (const x1 of [-1, 1]) {
        const xd = p.D === 0 ? x0 : x1
        s += 0.25 * xd * eq(d * (h0 * x0 + h1 * x1), p.sigmaV, p.mapping)
      }
    }
    return s
  }
  const K = 512
  let s = 0
  for (let i = 0; i < K; i++) {
    const psi = (2 * Math.PI * i) / K
    const x = Math.SQRT2 * Math.cos(psi - p.omega * p.D)
    const u = Math.SQRT2 * p.magH * Math.cos(psi + phi)
    s += x * eq(d * u, p.sigmaV, p.mapping)
  }
  return s / K
}
// #endregion

/** 有狀態的 code／誤差路徑串流：跨 block 連續（不在每個 block 重置；E44 的提醒）。 */
function makeStream(p: PolarityPerturbParams, rng: Rng) {
  const phi = (p.phiDeg * Math.PI) / 180
  const h = singleToneFir(p.magH, phi, p.omega)
  const h0 = h[0]
  const h1 = h.length > 1 ? h[1] : 0
  const codeRng = rng.fork('code')
  const noise = rng.fork('comparator-noise')
  const theta0 = codeRng.uniform() * 2 * Math.PI
  const D = Math.max(0, Math.round(p.D))
  const ring = new Float64Array(D + 2)
  const map = BIT_MAP[p.mapping]
  let n = 0
  const nextX = () => (p.code === 'bpsk' ? codeRng.sign() : Math.SQRT2 * Math.cos(p.omega * n + theta0))
  // #region core:gmacFrozenBlock
  /** 凍結 w，跑一個 GMAC block：e = (a − w)·(h * x) + v，b = [e ≥ 0]，q = map(b)，G = (1/N)Σ q·x[n − D] */
  const block = (w: number, N: number): number => {
    let acc = 0
    for (let i = 0; i < N; i++, n++) {
      const x = nextX()
      const xPrev = ring[(n + ring.length - 1) % ring.length]
      ring[n % ring.length] = x
      const u = h0 * x + h1 * xPrev // 有狀態 FIR：x[n−1] 來自上一個 sample（可跨 block）
      const e = (p.a - w) * u + p.sigmaV * noise.normal()
      const q = map(e >= 0 ? 1 : 0) // tie e = 0 ⇒ b = 1（§15.2、E07）
      acc += q * ring[(n - D + ring.length * (D + 1)) % ring.length]
    }
    return acc / N
  }
  // #endregion
  // 暖機：填滿 delay ring 與 FIR 狀態
  block(p.w0, D + 2)
  return { h, block }
}

/** 一次完整的「freeze + ±Δw」量測（加上可選的 S 曲線掃描）。 */
export function runPolarityPerturbation(p: PolarityPerturbParams): PolarityPerturbResult {
  const warnings: string[] = []
  const N = Math.max(1, Math.round(p.N))
  // 樣本預算：±Δ 量測至少保留每側 2 個 block（4N 個 sample）；S 曲線掃描最多用掉一半，其餘給 ±Δ 量測
  const budget = Math.max(4 * N, Math.round(p.budget ?? SAMPLE_BUDGET))
  let sweepPts = Math.max(0, Math.round(p.sweepPoints))
  let sweepBlocks = Math.max(1, Math.round(p.sweepBlocks))
  const sweepBudget = Math.floor(budget / 2)
  if (sweepPts * sweepBlocks * N > sweepBudget) {
    const [pts0, blk0] = [sweepPts, sweepBlocks]
    sweepBlocks = Math.max(1, Math.min(sweepBlocks, Math.floor(sweepBudget / (sweepPts * N))))
    if (sweepPts * sweepBlocks * N > sweepBudget) sweepPts = Math.floor(sweepBudget / (sweepBlocks * N))
    warnings.push(`樣本預算：S 曲線掃描由 ${pts0} 點 × ${blk0} block 降為 ${sweepPts} 點 × ${sweepBlocks} block（本頁在主執行緒計算，這一組的上限是 ${budget} 個 comparator sample，掃描最多用一半）。`)
  }
  const sweepCost = sweepPts * sweepBlocks * N
  let Meff = Math.max(2, Math.round(p.M))
  if (2 * Meff * N + sweepCost > budget) {
    Meff = Math.max(2, Math.floor((budget - sweepCost) / (2 * N)))
    warnings.push(`樣本預算：本頁在主執行緒計算，這一組的上限是 ${budget} 個 comparator sample，每側 block 數 $M$ 自動由 ${Math.round(p.M)} 降為 ${Meff}。`)
  }
  const rng = createRng(p.seed)
  const stream = makeStream(p, rng.fork('perturb'))
  const gPlus = new Float64Array(Meff)
  const gMinus = new Float64Array(Meff)
  // 交錯量測 +Δ／−Δ：慢漂移（PVT、1/f）在兩側近似相同，差分時抵消
  for (let m = 0; m < Meff; m++) {
    gPlus[m] = stream.block(p.w0 + p.delta, N)
    gMinus[m] = stream.block(p.w0 - p.delta, N)
  }
  const est = centralDifference(gPlus, gMinus, p.delta)
  const verdict = polarityVerdict(est.K, est.se, p.z)

  const C = analyticC(p)
  const Klin = kq(p.sigmaV) * C * MAPPING_GAIN[p.mapping]
  const KmeanField = -(meanFieldG(p, p.w0 + p.delta) - meanFieldG(p, p.w0 - p.delta)) / (2 * p.delta)

  const sweep = { w: [] as number[], gMean: [] as number[], gSe: [] as number[] }
  if (sweepPts > 0) {
    const sw = makeStream(p, rng.fork('sweep'))
    for (let i = 0; i < sweepPts; i++) {
      const w = sweepPts === 1 ? p.a : p.a - p.sweepSpan + (2 * p.sweepSpan * i) / (sweepPts - 1)
      const gs = new Float64Array(sweepBlocks)
      for (let m = 0; m < sweepBlocks; m++) gs[m] = sw.block(w, N)
      sweep.w.push(w)
      sweep.gMean.push(mean(gs))
      sweep.gSe.push(sweepBlocks > 1 ? Math.sqrt(variance(gs) / sweepBlocks) : NaN)
    }
  }
  const mf = { w: [] as number[], g: [] as number[] }
  const span = Math.max(p.sweepSpan, Math.abs(p.w0 - p.a) + 2 * p.delta)
  for (let i = 0; i <= 120; i++) {
    const w = p.a - span + (2 * span * i) / 120
    mf.w.push(w)
    mf.g.push(meanFieldG(p, w))
  }

  if (Math.abs(C) < 1e-12) {
    warnings.push(
      `C ≤ 0：$C_D=0$——GMAC 使用的 code $x[n-D]$ 與誤差路徑的輸出完全不相關（${p.code === 'bpsk' ? `iid $\\pm1$ code 時 $C_D=h[D]$，$D=${p.D}$ 超出 2-tap 路徑的記憶長度` : '有效相位 $\\phi+\\Omega D=\\pm90^\\circ$'}），沒有恢復力：更新方向由雜訊決定（random walk），參數不可辨識。`,
    )
  } else if (C < 0) {
    warnings.push(
      `C ≤ 0：更新極性錯誤（$C_D=${C.toFixed(4)}<0$，平均 pole $p=1-\\mu K_qC_D>1$）。誤差路徑在 code 頻帶的有效相位 $\\phi+\\Omega D$ 超過 $\\pm90^\\circ$，GMAC 的平均方向與真實誤差相反，正 learning rate 會使平均誤差發散——請調整 code delay $D$、改用 filtered-x，或反轉更新符號後重新量測。`,
    )
  } else if (Math.abs(C) < 0.1 * p.magH) {
    warnings.push(`$C_D\\approx0$（$C_D=${C.toFixed(4)}$）：有效相位接近 $\\pm90^\\circ$，恢復力極弱；量測需要非常多 block 才能判定極性（$M\\ge${requiredBlocks(kq(p.sigmaV) * C, p.delta, N, p.z)}$），且 FCW／PVT 小改變就可能翻號。`)
  }
  if (p.mapping === 'reversed') warnings.push(String.raw`位元映射錯誤：$q=1-2b$（comparator 接反）——量到的 $\hat K$ 與真實極性相反；sign-off 前必須以已知符號的刺激（例如 $a-w$ 已知為正）核對 0/1 → $\pm1$ 的對應。`)
  if (p.mapping === 'unipolar') warnings.push(String.raw`位元映射錯誤：$q=b\in\{0,1\}$（忘了 $2b-1$）——斜率只剩一半，且 code 有 DC 時 $E[b\,x]\big|_{w=a}=E[x]/2\ne0$，固定點被推離 $a$（§17 反面測試）。`)
  if (p.delta > 0.5 * p.sigmaV) {
    warnings.push(`$\\Delta=${p.delta}\\,\\mathrm{fs}>0.5\\sigma_v$：erf S 曲線的三次項讓中央差分低估斜率（identity path 時 $\\hat S_\\text{CD}/\\bar G'(a)=${secantRatio(p.delta, p.sigmaV).toFixed(4)}$）；判定極性沒問題，但不要拿這個 $\\hat K$ 直接設計 $\\mu$。`)
  }
  if (p.code === 'tone' && Math.abs(Math.sin(p.omega)) * N < 20) {
    warnings.push(`$N|\\sin\\Omega|=${(Math.abs(Math.sin(p.omega)) * N).toFixed(1)}$ 太小：單頻 code 的有限 block 平均有 ripple（上界 $\\frac{A^2|H|/2}{N|\\sin\\Omega|}$，勘誤 E46），單一 block 的符號可能翻轉。`)
  }
  if (Number.isNaN(est.z)) warnings.push(String.raw`每側只有 1 個 block，無法估計標準誤；請把 $M$ 設為 $\ge2$。`)

  return {
    h: stream.h,
    C,
    Klin,
    KmeanField,
    est,
    verdict,
    gPlus,
    gMinus,
    sweep,
    meanFieldCurve: mf,
    samplesUsed: 2 * Meff * N + sweepPts * sweepBlocks * N,
    Meff,
    warnings,
  }
}

/* ───────────────────── SSPLL：GOS / PHOS 兩參數 Jacobian 極性檢查 ───────────────────── */

export interface TwoParamParams {
  /** GOS（DTC gain）regressor 與 PHOS（PMUX phase）regressor 的相關 ρ = E[x_G x_P] */
  rho: number
  /** GOS 路徑的有效相關 c_G = |H_G|cos θ_G（可為負） */
  cG: number
  /** PHOS 路徑的有效相關 c_P = |H_P|cos θ_P（可為負） */
  cP: number
  sigmaV: number
  aG: number
  aP: number
  /** 凍結工作點 */
  wG: number
  wP: number
  deltaG: number
  deltaP: number
  N: number
  M: number
  /** 更新步長（M = diag(μ_G, μ_P)） */
  muG: number
  muP: number
  z: number
  seed: number
}

export interface TwoParamResult {
  /** 量測 Ĵ（2×2，列 = GMAC_i，行 = 擾動的參數 j） */
  Jhat: Matrix
  Jse: Matrix
  /** 小訊號 J = −K_q·[[c_G, ρc_P],[ρc_G, c_P]] */
  Jlin: Matrix
  /** 精確 mean-field 的中央差分 Jacobian */
  JmeanField: Matrix
  /** A = I + MĴ */
  A: Matrix
  eigA: Complex[]
  rhoA: number
  /** 單獨更新各參數時的 pole 1 + μ_iĴ_ii */
  diagPoles: number[]
  diagVerdicts: PolarityVerdict[]
  singularValues: number[]
  /** 可辨識性門檻 z·‖se‖_F（Weyl 不等式：|σ_min(Ĵ) − σ_min(J)| ≤ ‖Ĵ − J‖_F） */
  sigmaMinThreshold: number
  /** σ_min(Ĵ) > z·‖se‖_F：在量測誤差內可以排除「J 奇異」 */
  identifiable: boolean
  samplesUsed: number
  Meff: number
  warnings: string[]
}

/** 相關 ±1 對：x_G iid ±1；x_P = x_G（機率 (1+ρ)/2）否則 −x_G ⇒ E[x_G x_P] = ρ。 */
function twoParamMeanField(p: TwoParamParams, wG: number, wP: number): [number, number] {
  let gG = 0
  let gP = 0
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      const pr = (1 + p.rho * s1 * s2) / 4
      const eDet = (p.aG - wG) * p.cG * s1 + (p.aP - wP) * p.cP * s2
      const q = p.sigmaV > 0 ? erf(eDet / (Math.SQRT2 * p.sigmaV)) : eDet >= 0 ? 1 : -1
      gG += pr * s1 * q
      gP += pr * s2 * q
    }
  }
  return [gG, gP]
}

// #region core:jacobianTwoParam
/**
 * 兩參數 freeze + 擾動：每次只動一個參數 w_j ± Δ_j，其餘凍結，同時記錄兩個 GMAC：
 *   Ĵ_ij = (Ḡ_i(w + Δ_j e_j) − Ḡ_i(w − Δ_j e_j))/(2Δ_j)
 * 對角 Ĵ_ii < 0 ⇔ 第 i 個 loop 單獨更新時極性正確；聯合穩定看 ρ(I + MĴ) < 1。
 */
export function measureJacobian2(p: TwoParamParams): { Jhat: Matrix; Jse: Matrix; Meff: number; samples: number } {
  const N = Math.max(1, Math.round(p.N))
  const Meff = Math.max(2, Math.min(Math.round(p.M), Math.floor(SAMPLE_BUDGET / (4 * N))))
  const rng = createRng(p.seed)
  const code = rng.fork('code')
  const noise = rng.fork('comparator-noise')
  const pSame = (1 + p.rho) / 2
  const block = (wG: number, wP: number): [number, number] => {
    let accG = 0
    let accP = 0
    for (let n = 0; n < N; n++) {
      const xG = code.sign()
      const xP = code.uniform() < pSame ? xG : -xG
      const e = (p.aG - wG) * p.cG * xG + (p.aP - wP) * p.cP * xP + p.sigmaV * noise.normal()
      const q = e >= 0 ? 1 : -1
      accG += q * xG
      accP += q * xP
    }
    return [accG / N, accP / N]
  }
  const Jhat: Matrix = [[0, 0], [0, 0]]
  const Jse: Matrix = [[0, 0], [0, 0]]
  const deltas = [p.deltaG, p.deltaP]
  for (let j = 0; j < 2; j++) {
    const plus = [new Float64Array(Meff), new Float64Array(Meff)]
    const minus = [new Float64Array(Meff), new Float64Array(Meff)]
    for (let m = 0; m < Meff; m++) {
      const gp = block(p.wG + (j === 0 ? deltas[0] : 0), p.wP + (j === 1 ? deltas[1] : 0))
      const gm = block(p.wG - (j === 0 ? deltas[0] : 0), p.wP - (j === 1 ? deltas[1] : 0))
      plus[0][m] = gp[0]
      plus[1][m] = gp[1]
      minus[0][m] = gm[0]
      minus[1][m] = gm[1]
    }
    for (let i = 0; i < 2; i++) {
      const est = centralDifference(plus[i], minus[i], deltas[j])
      Jhat[i][j] = est.S
      Jse[i][j] = est.se
    }
  }
  return { Jhat, Jse, Meff, samples: 4 * Meff * N }
}
// #endregion

/** 兩參數模型的小訊號 Jacobian（F-SO.6）：J = −K_q·R·diag(c_G, c_P) = −K_q·[[c_G, ρc_P],[ρc_G, c_P]] [fs⁻¹]。 */
export function twoParamJlin(p: Pick<TwoParamParams, 'rho' | 'cG' | 'cP' | 'sigmaV'>): Matrix {
  const k = kq(p.sigmaV)
  return [
    [-k * p.cG, -k * p.rho * p.cP],
    [-k * p.rho * p.cG, -k * p.cP],
  ]
}

/**
 * 可辨識性門檻（F-SO.12）：z·‖se‖_F，‖se‖_F = √(Σ_ij se_ij²)。
 * Weyl 不等式 |σ_i(Ĵ) − σ_i(J)| ≤ ‖Ĵ − J‖_F，而 E‖Ĵ − J‖_F² = ‖se‖_F² ⇒ σ_min(Ĵ) > z‖se‖_F 時可排除「J 奇異」（誤判機率 ≤ 1/z²）。
 */
export function identifiabilityThreshold(Jse: Matrix, z: number): number {
  return z * Math.hypot(...Jse.flat())
}

export function runTwoParamCheck(p: TwoParamParams): TwoParamResult {
  const warnings: string[] = []
  const { Jhat, Jse, Meff, samples } = measureJacobian2(p)
  if (Meff < Math.round(p.M)) warnings.push(`樣本預算：每次擾動的 block 數 $M$ 由 ${Math.round(p.M)} 降為 ${Meff}（單次上限 ${SAMPLE_BUDGET} 個 sample）。`)
  const Jlin = twoParamJlin(p)
  const JmeanField: Matrix = [[0, 0], [0, 0]]
  const ds = [p.deltaG, p.deltaP]
  for (let j = 0; j < 2; j++) {
    const gp = twoParamMeanField(p, p.wG + (j === 0 ? ds[0] : 0), p.wP + (j === 1 ? ds[1] : 0))
    const gm = twoParamMeanField(p, p.wG - (j === 0 ? ds[0] : 0), p.wP - (j === 1 ? ds[1] : 0))
    for (let i = 0; i < 2; i++) JmeanField[i][j] = (gp[i] - gm[i]) / (2 * ds[j])
  }
  const Mmat: Matrix = [[p.muG, 0], [0, p.muP]]
  const judged = mimoJudge(Jhat, Mmat)
  const diagVerdicts = [0, 1].map((i) => polarityVerdict(-Jhat[i][i], Jse[i][i], p.z))
  diagVerdicts.forEach((v, i) => {
    const name = i === 0 ? 'GOS（DTC gain）' : 'PHOS（PMUX phase offset）'
    const sub = i === 0 ? 'GG' : 'PP'
    if (v === 'reversed')
      warnings.push(
        `C ≤ 0：${name} 的量測 $\\hat J_{${sub}}=${texNum(Jhat[i][i])}\\,\\mathrm{fs}^{-1}>0$，該參數的更新極性錯誤，單獨更新就會發散——必須在這個 SSPLL 模式下反轉該 loop 的更新符號，或修正 regressor 的對應。`,
      )
    if (v === 'inconclusive') warnings.push(`${name}：$\\hat J_{${sub}}$ 不顯著（$|\\hat J_{${sub}}|<z\\,\\mathrm{se}$），無法判定極性；有效相關接近 0（不可辨識）或量測太短。`)
  })
  if (judged.eachLoopStable && !judged.jointStable) {
    warnings.push(`各 loop 單獨穩定（pole $${judged.diagPoles.map((x) => x.toFixed(4)).join(',\\ ')}$），但聯合 $\\rho(\\mathbf I+\\mathbf M\\hat{\\mathbf J})=${judged.rho.toFixed(4)}\\ge1$：交叉耦合讓 MIMO 一起更新時發散（同 T18 的機制）。`)
  }
  // 可辨識性：σ_min(Ĵ) 是否「顯著」大於 0。Weyl 不等式：|σ_i(Ĵ) − σ_i(J)| ≤ ‖Ĵ − J‖₂ ≤ ‖Ĵ − J‖_F，
  // 而 ‖Ĵ − J‖_F 的量級是 ‖se‖_F = √(Σ se_ij²) ⇒ 以 σ_min(Ĵ) > z‖se‖_F 作為（保守的）判準。
  const smin = judged.singularValues[judged.singularValues.length - 1]
  const sigmaMinThreshold = identifiabilityThreshold(Jse, p.z)
  const identifiable = smin > sigmaMinThreshold
  if (!identifiable)
    warnings.push(
      `$\\lambda_{\\min}\\approx0$：$\\sigma_{\\min}(\\hat{\\mathbf J})=${texNum(smin)}\\,\\mathrm{fs}^{-1}$ 沒有顯著大於 0（門檻 $z\\,\\|\\mathrm{se}\\|_F=${texNum(sigmaMinThreshold)}\\,\\mathrm{fs}^{-1}$）——在量測誤差內 $\\hat{\\mathbf J}$ 與奇異矩陣無法區分，兩個參數的某個線性組合不可辨識（$|\\rho_{GP}|\\to1$ 或某條路徑的 $c\\approx0$）。若確定兩者應該可分辨，就加大 $M$、$N$ 再量；否則凍結其中一個參數或降低 regressor 相關。`,
    )
  return {
    Jhat,
    Jse,
    Jlin,
    JmeanField,
    A: judged.A,
    eigA: judged.eigA,
    rhoA: judged.rho,
    diagPoles: judged.diagPoles,
    diagVerdicts,
    singularValues: judged.singularValues,
    sigmaMinThreshold,
    identifiable,
    samplesUsed: samples,
    Meff,
    warnings,
  }
}

/* ───────────────────── 2. Corner：每個 corner 的 g、pole、PM ───────────────────── */

/** 更新延遲 d 個 block 的臨界增益 g_crit(d) = 2 sin(π/(4d + 2))（§8.3；d = 0 ⇒ 2）。 */
export function gCrit(d: number): number {
  return 2 * Math.sin(Math.PI / (4 * d + 2))
}

/** L(z) = g·z^{−d}/(z − 1) 的 phase margin [deg]：90° − (2d + 1)·asin(g/2)；0 < g ≤ 2 之外回傳 NaN。 */
export function pmDeg(g: number, d = 0): number {
  if (!(g > 0) || g > 2) return NaN
  return 90 - ((2 * d + 1) * Math.asin(g / 2) * 180) / Math.PI
}

/**
 * 與封閉式獨立的 PM 數值解（交叉比對用）：二分法找 |e^{jω} − 1| = g 的 ω_c，再直接算 L(e^{jω_c}) = g·e^{−jdω_c}/(e^{jω_c} − 1) 的相位。
 */
export function pmNumeric(g: number, d = 0): number {
  if (!(g > 0)) return NaN
  const mag = (w: number) => Math.hypot(Math.cos(w) - 1, Math.sin(w))
  if (mag(Math.PI) < g) return NaN
  let lo = 0
  let hi = Math.PI
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi)
    if (mag(mid) < g) lo = mid
    else hi = mid
  }
  const w = 0.5 * (lo + hi)
  const phaseDeg = ((-d * w - Math.atan2(Math.sin(w), Math.cos(w) - 1)) * 180) / Math.PI
  const pm = 180 + phaseDeg
  return ((((pm + 180) % 360) + 360) % 360) - 180
}

// #region core:delayPoles
/** δ_{k+1} = δ_k − g·δ_{k−d} 的特徵方程 z^{d+1} − z^d + g = 0（係數降冪），回傳根與 spectral radius。 */
export function delayPoles(g: number, d: number): { poles: Complex[]; rho: number } {
  const c = new Array<number>(d + 2).fill(0)
  c[0] = 1
  c[1] -= 1
  c[d + 1] += g
  const poles = polyRoots(c)
  let rho = 0
  for (const z of poles) rho = Math.max(rho, Math.hypot(z.re, z.im))
  return { poles, rho }
}
// #endregion

// #region core:noiseGainSum
/**
 * 單位雜訊增益 Σ_k h_k²（h 為 δ_{k+1} = δ_k − g·δ_{k−d} + ν_k 的脈衝響應）；σ_w² = μ²σ_η²·Σh²。
 * 封閉解法（Yule–Walker）：令 r_m = E[δ_kδ_{k+m}]/σ_ν²（r_{−m} = r_m），把遞迴乘上 δ_{k−m} 再取期望：
 *   m = 0      ：r_0 − r_1 + g·r_{d+1} = 1          （ν_k 只與「下一個」δ 相關，貢獻 σ_ν²）
 *   m = 1…d+1 ：r_m − r_{m−1} + g·r_{|m−d−1|} = 0
 * 共 d + 2 個未知數的線性方程組，Σh² = r_0。d = 0 時化簡為 1/(1 − p²)，p = 1 − g。不穩定（ρ ≥ 1）時回傳 ∞。
 */
export function noiseGainSum(g: number, d: number): number {
  if (d === 0) {
    const p = 1 - g
    return Math.abs(p) < 1 ? 1 / (1 - p * p) : Infinity
  }
  if (!(delayPoles(g, d).rho < 1)) return Infinity
  const n = d + 2
  const A: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const rhs = new Array<number>(n).fill(0)
  A[0][0] += 1
  A[0][1] -= 1
  A[0][d + 1] += g
  rhs[0] = 1
  for (let m = 1; m <= d + 1; m++) {
    A[m][m] += 1
    A[m][m - 1] -= 1
    A[m][Math.abs(m - d - 1)] += g
  }
  return solve(A, rhs)[0]
}
// #endregion

/**
 * 同一個量的「獨立算法」（交叉比對用，不給 UI）：直接把脈衝響應 h_k 一項一項遞迴出來再平方相加。
 * ρ 接近 1 時要累加很多項（慢），所以頁面用上面的 Yule–Walker 解；測試確認兩者一致。
 */
export function noiseGainSumImpulse(g: number, d: number, maxSteps = 200_000): number {
  const L = d + 1
  const hist = new Float64Array(L) // 環形緩衝：寫入 h_k 後，hist[(k+1) % L] 正好是 h_{k−d}
  let cur = 1 // h_0 = 1（脈衝在第 0 步進入）
  let sum = 0
  for (let k = 0; k < maxSteps; k++) {
    sum += cur * cur
    hist[k % L] = cur
    const hkd = k - d >= 0 ? hist[(k + 1) % L] : 0
    const next = cur - g * hkd
    if (!Number.isFinite(next) || Math.abs(next) > 1e12) return Infinity
    cur = next
    if (k > 50 * L && Math.abs(cur) < 1e-14 && hist.every((v) => Math.abs(v) < 1e-14)) break
  }
  return sum
}

export interface CornerSpec {
  name: string
  /** 該 corner 的 comparator 雜訊 σ_v [fs] */
  sigmaV: number
  /** 該 corner 的誤差路徑有效相位 θ = φ + ΩD [deg]（C = |H|cos θ，|H| = 1） */
  thetaDeg: number
}

export interface CornerRowResult {
  name: string
  K: number
  g: number
  rho: number
  pm: number
  /**
   * k₉₅：平均遞迴 y_{k+1} = y_k − g·y_{k−d}（初始歷史 y_j = 1）最後一次 |y_k| > 0.05 的下一個 block——pass/fail 用的就是它
   * （和首頁同一個 settleDelayed）。不穩定時 ∞。settle95Exact = false 時逐 block 沒有數完（極慢的 mode），這個數字只是下界／漸近估計，畫面要寫「≥」。
   */
  settle95: number
  settle95Exact: boolean
  /** ρ 的漸近估計 max(1, ⌈ln 0.05/ln ρ⌉)：d = 0 與 k₉₅ 相同；d ≥ 1 時 ρ^k 不是包絡，可能比 k₉₅ 多、也可能少（只顯示，不判定） */
  settleAsym: number
  sigmaW: number
  ok: { polarity: boolean; stable: boolean; pm: boolean; settle: boolean; noise: boolean }
}

// #region core:cornerJudge
/**
 * 同一組 (μ, d) 必須通過「所有」corner：K_c = K_q(σ_v,c)·cos θ_c，g_c = μK_c，
 *   極性：K_c > 0；穩定：ρ_c < 1（z^{d+1} − z^d + g_c 的根）；PM_c ≥ PM_t；
 *   收斂：k₉₅ ≤ B，k₉₅ 是平均遞迴 y_{k+1} = y_k − g_c·y_{k−d} 逐 block 數出來的（settleDelayed，初始歷史 y_j = 1）；
 *         ⌈ln 0.05/ln ρ_c⌉ 只在 d = 0 精確，d ≥ 1 時 ρ^k 不是包絡，所以只當「ρ 漸近估計」另列、不拿來判定；
 *   雜訊：σ_w,c = μσ_η√(Σh²) ≤ 預算（σ_η² ≈ 1/N）。
 */
export function cornerJudge(
  corners: CornerSpec[],
  o: { mu: number; d: number; pmTargetDeg: number; B: number; N: number; sigmaWMax: number; settleMaxSteps?: number },
): CornerRowResult[] {
  return corners.map((c) => {
    const K = kq(c.sigmaV) * Math.cos((c.thetaDeg * Math.PI) / 180)
    const g = o.mu * K
    const { rho } = delayPoles(g, o.d)
    const pm = pmDeg(g, o.d)
    // 漸近估計：ρ = 0（deadbeat，g = 1、d = 0）時 ln ρ = −∞ ⇒ 商為 0；但仍需要「一次」更新才到位，所以至少 1
    const settleAsym = rho < 1 ? Math.max(1, Math.ceil(Math.log(0.05) / Math.log(rho))) : Infinity
    // 判定用的 k₉₅：d = 0 時就是上面的封閉式；d ≥ 1 逐 block 數（沒數完時 exact = false，回傳漸近估計當下界）
    const { blocks: settle95, exact: settle95Exact } = rho < 1 ? settleDelayed(g, o.d, 0.05, o.settleMaxSteps ?? SETTLE_MAX_STEPS) : { blocks: Infinity, exact: true }
    const sigmaW = rho < 1 ? o.mu * Math.sqrt((1 / o.N) * noiseGainSum(g, o.d)) : Infinity
    return {
      name: c.name,
      K,
      g,
      rho,
      pm,
      settle95,
      settle95Exact,
      settleAsym,
      sigmaW,
      ok: {
        polarity: K > 0,
        stable: rho < 1,
        pm: pm >= o.pmTargetDeg,
        settle: settle95 <= o.B,
        noise: sigmaW <= o.sigmaWMax,
      },
    }
  })
}
// #endregion

export interface CornerScan {
  mu: number[]
  /** rho[c][i]：第 c 個 corner 在 mu[i] 的 spectral radius */
  rho: number[][]
  /** 每個 μ 是否所有 corner 的所有判準都通過 */
  ok: boolean[]
  /** 可行 μ 的最小、最大值（格點上）；無可行點時為 NaN */
  lo: number
  hi: number
}

/** cornerFeasibleScan 預設的對數格點數（相鄰格點的比值約 1 + ln(4000·K_max/K_min)/點數，四個 corner 的預設值約 3.6%）。 */
export const CORNER_SCAN_POINTS = 240

/**
 * 在對數格點上掃 μ，找出「所有 corner 同時通過」的區間（格點解析度，不是封閉式）。
 * `include` 內的 μ（例如使用者目前設定的 μ）一定會被評估並併入格點——這樣「目前的 μ 通過所有 corner」時，
 * 掃描結果不可能回報「沒有可行點」（比格點間距還窄的可行區間不會被漏掉）。
 */
export function cornerFeasibleScan(
  corners: CornerSpec[],
  o: { d: number; pmTargetDeg: number; B: number; N: number; sigmaWMax: number },
  points = CORNER_SCAN_POINTS,
  include: number[] = [],
): CornerScan {
  const Ks = corners.map((c) => kq(c.sigmaV) * Math.cos((c.thetaDeg * Math.PI) / 180))
  const pos = Ks.filter((k) => k > 0)
  const kMax = pos.length ? Math.max(...pos) : 1
  const kMin = pos.length ? Math.min(...pos) : 1
  const lo0 = 1e-3 / kMax
  const hi0 = 4 / kMin
  const grid = Array.from({ length: points }, (_, i) => lo0 * Math.pow(hi0 / lo0, i / (points - 1)))
  const mu = [...grid, ...include.filter((m) => Number.isFinite(m) && m > 0)].sort((a, b) => a - b).filter((m, i, arr) => i === 0 || m !== arr[i - 1])
  const n = mu.length
  const rho = corners.map(() => new Array<number>(n).fill(NaN))
  const ok = new Array<boolean>(n).fill(false)
  // 格點上只需要知道 k₉₅ ≤ B 與否：能通過的 mode 在 ~20B 步內就衰減到停止規則的門檻，數不完的一定是極慢（k₉₅ ≫ B）的 mode，
  // 逐 block 的步數上限因此取 50B + 5000（極端的 K 散佈、很小的 g 時不會把掃描拖到秒級）；單點的 cornerJudge 仍用 settleDelayed 的完整上限。
  const settleMaxSteps = Math.min(SETTLE_MAX_STEPS, 50 * o.B + 5000)
  for (let i = 0; i < n; i++) {
    const rows = cornerJudge(corners, { ...o, mu: mu[i], settleMaxSteps })
    rows.forEach((r, c) => (rho[c][i] = r.rho))
    ok[i] = rows.length > 0 && rows.every((r) => r.ok.polarity && r.ok.stable && r.ok.pm && r.ok.settle && r.ok.noise)
  }
  const idx = ok.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)
  return { mu, rho, ok, lo: idx.length ? mu[idx[0]] : NaN, hi: idx.length ? mu[idx[idx.length - 1]] : NaN }
}

/* ───────────────────── Corner 判斷器的 Monte Carlo 交叉比對 ───────────────────── */

/** 交叉比對跑 8 個 seeds（blockLms 的 deriveSeed(seed, i)，i = 0…7）。 */
export const CORNER_MC_RUNS = 8
/** MC 的每 block 樣本數：平均軌跡與 N 無關（N 只決定雜訊），取 512 讓 8 seeds × 300 block 約 120 萬個 comparator sample。 */
export const CORNER_MC_N = 512
/** MC 最多跑幾個 block。 */
export const CORNER_MC_MAX_BLOCKS = 300
/** 初始誤差 δ₀ = 0.2σ_v：K_q 線性化的相對誤差約 δ₀²/(6σ_v²) ≈ 0.7%（compareMcToLinear 的容許量已含這一項）。 */
export const CORNER_MC_DELTA0_RATIO = 0.2

export interface CornerMcPlan {
  /** 被比對的 corner 名稱與在 corners 中的序號 */
  name: string
  index: number
  /** buildSignLmsMcConfig 的輸入：g = 該 corner 的 μK_c（K_q cos θ 吸收進 μ_eff = g/K_q），identity path、iid ±1 code */
  setup: SignLmsMcSetup
  runs: number
  /** 該 corner 的 k₉₅（逐 block） */
  k95: number
  /** blocks 涵蓋不到 k₉₅（k₉₅ ≥ blocks）：只比對前 blocks 個 block */
  truncated: boolean
}

/**
 * 挑出要做 Monte Carlo 的 corner：所有「極性正確且穩定」的 corner 中 k₉₅ 最大者（決定「收斂」這一項判定的那一個）。
 * 沒有這樣的 corner（全部極性錯誤或不穩定）時回傳 null——線性化的平均模型發散，sign-LMS 的 |G| ≤ 1 讓實際誤差有界（limit cycle），比對沒有意義。
 */
export function cornerMcPlan(corners: CornerSpec[], rows: CornerRowResult[], d: number, seed: number): CornerMcPlan | null {
  let best = -1
  rows.forEach((r, i) => {
    if (r.ok.polarity && r.ok.stable && (best < 0 || r.settle95 > rows[best].settle95)) best = i
  })
  if (best < 0) return null
  const r = rows[best]
  const sigmaV = corners[best].sigmaV
  const blocks = Math.min(CORNER_MC_MAX_BLOCKS, Math.max(40, Math.ceil(1.5 * r.settle95) + 10))
  return {
    name: corners[best].name,
    index: best,
    setup: { g: r.g, d, sigmaV, N: CORNER_MC_N, delta0: CORNER_MC_DELTA0_RATIO * sigmaV, blocks, seed: seed >>> 0 },
    runs: CORNER_MC_RUNS,
    k95: r.settle95,
    truncated: !(r.settle95 < blocks),
  }
}

/** blockLms 的設定（average 模式、iid ±1 code、identity path、bipolar comparator）：μ = g/K_q(σ_v)，cal_update_delay_blocks = d */
export function cornerMcConfig(plan: CornerMcPlan): BlockLmsConfigInput {
  return buildSignLmsMcConfig(plan.setup)
}

export interface CornerMcCheck {
  plan: CornerMcPlan
  /** Student-t·SE（Bonferroni）＋線性化容許量 的逐 block 比較（stability.compareMcToLinear，和 Ch08 PM Lab 同一個函式） */
  cmp: McComparison
  /** 第 k₉₅ 個 block 的 |δ|/δ₀：MC 平均（se 為 8 seeds 的標準誤）與逐 block 遞迴；blocks 涵蓋不到 k₉₅ 時為 null */
  atK95: { k: number; mc: number; se: number; lin: number } | null
  /** blockLms 回報的有效 g（由實際 code 估計 C）：應等於 plan.setup.g */
  gEff: number
}

/**
 * 把 blockLms 的 Monte Carlo 結果（wMean、wStd，跨 seeds）和「逐 block 的平均遞迴」比對：
 * δ_MC,k = δ₀ − mean(w_k) 對 δ_k = δ_{k−1} − g·δ_{k−1−d}（k − d < 0 時的歷史 = δ₀，與 blockLms 的 DTC 時序相同）。
 * pass 只看 compareMcToLinear（全部 block）；有效 g 與指定 g 差超過 10⁻⁶ 時視為不一致（設定沒有套用）。
 */
export function compareCornerMc(plan: CornerMcPlan, res: Pick<BlockLmsMonteCarloResult, 'wMean' | 'wStd' | 'analytic'>): CornerMcCheck {
  const { g, d, delta0, blocks, sigmaV } = plan.setup
  const deltaMc = Array.from(res.wMean, (w) => delta0 - w)
  const lin = simulateDelayRecursion(g, d, blocks, delta0).delta
  const cmp = compareMcToLinear(deltaMc, res.wStd, plan.runs, lin, delta0, sigmaV)
  const gEff = res.analytic.g
  const gMatch = Math.abs(gEff - g) <= 1e-6 * Math.max(1, Math.abs(g))
  const k = plan.k95
  const atK95 =
    Number.isFinite(k) && k < deltaMc.length
      ? { k, mc: Math.abs(deltaMc[k]) / delta0, se: res.wStd[k] / Math.sqrt(plan.runs) / delta0, lin: Math.abs(lin[k]) / delta0 }
      : null
  return { plan, cmp: gMatch ? cmp : { ...cmp, pass: false }, atK95, gEff }
}

/** 週期序列的 DFT 幅度 |X_k|/T（k = 0..T−1；O(T²)，只用於 T ≤ 1024 的 limit cycle）。 */
export function dftMagnitudes(y: ArrayLike<number>): number[] {
  const T = y.length
  const out: number[] = []
  for (let k = 0; k < T; k++) {
    let re = 0
    let im = 0
    for (let n = 0; n < T; n++) {
      const ph = (-2 * Math.PI * k * n) / T
      re += y[n] * Math.cos(ph)
      im += y[n] * Math.sin(ph)
    }
    out.push(Math.hypot(re, im) / T)
  }
  return out
}

/** AR(1)（相鄰相關 p）樣本估計變異數時的有效樣本數 ≈ K(1 − p²)/(1 + p²)；估計平均值時 ≈ K(1 − p)/(1 + p)。 */
export function effectiveSamples(K: number, p: number): { forMean: number; forVariance: number } {
  return { forMean: (K * (1 - p)) / (1 + p), forVariance: (K * (1 - p * p)) / (1 + p * p) }
}

/* ───────────────────── 3. 多參數：J、M、A = I + MJ ───────────────────── */

export interface MimoJudgement {
  A: Matrix
  eigA: Complex[]
  rho: number
  eigJ: Complex[]
  singularValues: number[]
  cond: number
  diagPoles: number[]
  eachLoopStable: boolean
  jointStable: boolean
}

// #region core:mimoJudge
/**
 * 局部線性化（§10.2）：G(w) ≈ J(w − w*)，w_{k+1} = w_k + M·G_k ⇒ δw_{k+1} = (I + MJ)·δw_k。
 *   聯合穩定 ⇔ ρ(I + MJ) < 1；「每個 loop 單獨」只看對角 1 + M_ii J_ii——兩者不等價（T18）。
 *   可辨識性看 J 的奇異值：σ_min ≈ 0 ⇒ 某個參數組合沒有資訊（PE 不足）。
 */
export function mimoJudge(J: Matrix, M: Matrix): MimoJudgement {
  const n = J.length
  const A = matAdd(identity(n), matMul(M, J))
  const eigA = eigvals(A)
  const rho = Math.max(...eigA.map((z) => Math.hypot(z.re, z.im)))
  const { S } = svd(J)
  const diagPoles = J.map((_, i) => 1 + M[i][i] * J[i][i])
  return {
    A,
    eigA,
    rho,
    eigJ: eigvals(J),
    singularValues: S,
    cond: S[S.length - 1] > 0 ? S[0] / S[S.length - 1] : Infinity,
    diagPoles,
    eachLoopStable: diagPoles.every((p) => Math.abs(p) < 1),
    jointStable: rho < 1,
  }
}
// #endregion

export interface RobustnessCheck {
  /** 設計者以為的 ρ(I + MĴ) */
  rhoHat: number
  /** 擾動 E = M(J_true − Ĵ) 的 2-norm */
  normE: number
  /** Â = I + MĴ 是否對稱（對稱 ⇒ eigenvector 矩陣條件數 κ(V) = 1） */
  symmetric: boolean
  /** Bauer–Fike 充分條件：ρ(Â) + κ(V)‖E‖₂ < 1（只在 Â 對稱時計算） */
  bound: number
  /** 真實 ρ(I + MJ_true) */
  rhoTrue: number
}

/**
 * Ĵ ≠ J 時的穩健性（Research）：A_true = Â + E，Â = I + MĴ，E = M(J_true − Ĵ)。
 * Bauer–Fike：Â 可對角化時 |λ(A_true) − λ(Â)| ≤ κ(V)‖E‖₂；Â 對稱時 κ(V) = 1 ⇒ ρ(A_true) ≤ ρ(Â) + ‖E‖₂。
 */
export function jacobianRobustness(Jtrue: Matrix, Jhat: Matrix, M: Matrix): RobustnessCheck {
  const n = Jtrue.length
  const Ahat = matAdd(identity(n), matMul(M, Jhat))
  const E = matMul(M, matAdd(Jtrue, matScale(Jhat, -1)))
  const rhoHat = Math.max(...eigvals(Ahat).map((z) => Math.hypot(z.re, z.im)))
  const normE = svd(E).S[0] ?? 0
  const scale = 1 + Math.max(...Ahat.flat().map(Math.abs))
  const symmetric = Ahat.every((r, i) => r.every((v, j) => Math.abs(v - Ahat[j][i]) <= 1e-9 * scale))
  const rhoTrue = Math.max(...eigvals(matAdd(identity(n), matMul(M, Jtrue))).map((z) => Math.hypot(z.re, z.im)))
  return { rhoHat, normE, symmetric, bound: symmetric ? rhoHat + normE : NaN, rhoTrue }
}

/**
 * Kesten 尾指數（Research；E14 的「有雜訊時二階矩無限大」）：δ_{n+1} = (1 − μx_n²)δ_n + μx_nv_n 的穩態分布
 * 尾巴 P(|δ| > t) ~ t^{−κ}，κ > 0 解 E[|1 − μx²|^κ] = 1（x ~ N(0,1)）。κ ≤ 2 ⇔ 變異數無限大；μ = 2/3 時 κ = 2。
 */
export function kestenTailIndex(mu: number): number {
  const m = (s: number) => {
    // E|1 − μx²|^s：對 t ≥ 0 的 Simpson（偶函數 ×2）；被積函數連續（在 1 − μt² = 0 有 kink），細格點足夠
    const n = 6000
    const a = 0
    const b = 14
    const h = (b - a) / n
    const f = (t: number) => Math.pow(Math.abs(1 - mu * t * t), s) * Math.exp(-0.5 * t * t)
    let acc = f(a) + f(b)
    for (let i = 1; i < n; i++) acc += (i % 2 ? 4 : 2) * f(a + i * h)
    return (2 * (acc * h)) / 3 / Math.sqrt(2 * Math.PI)
  }
  // m(0) = 1、m'(0) = λ(μ)；λ < 0 時在 κ > 0 處回到 1。λ ≥ 0 ⇒ 沒有正根（樣本路徑發散）
  let lo = 1e-3
  if (m(lo) >= 1) return NaN
  let hi = 1
  while (m(hi) < 1 && hi < 64) hi *= 2
  if (m(hi) < 1) return Infinity
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi)
    if (m(mid) < 1) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}

/** Regularized pseudoinverse 更新矩陣 M = −γ(ĴᵀĴ + ε_J I)⁻¹Ĵᵀ（§10.2；ε_J 取代規格的 λ，勘誤 E22）。 */
export function regPinvM(Jhat: Matrix, gamma: number, epsJ: number): Matrix {
  const Jt = transpose(Jhat)
  const n = Jt.length
  return matScale(matMul(inv(matAdd(matMul(Jt, Jhat), matScale(identity(n), epsJ))), Jt), -gamma)
}

/* ───────────────────── 4. 非線性／定點 ───────────────────── */

/** GMAC 累加器需要的位元數（含 sign）：B_x + ⌈log₂N⌉（§16.1-3；6-bit × 4096 ⇒ 18）。 */
export function accumulatorBitsRequired(Bx: number, N: number): number {
  return Bx + Math.ceil(Math.log2(N))
}

/**
 * 「被累加的每一筆 q·x 本身是有號 B_x-bit」時，累加 N 筆的最壞情況總和範圍 [−2^{B_x−1}N, (2^{B_x−1} − 1)N]。
 * 前提：conditional negate 的輸出仍在 B_x-bit 內（code 範圍對稱，或 −(−2^{B_x−1}) 飽和成 2^{B_x−1} − 1）。
 */
export function worstCaseSum(Bx: number, N: number): { max: number; min: number } {
  return { max: (2 ** (Bx - 1) - 1) * N, min: -(2 ** (Bx - 1)) * N }
}

/**
 * conditional negate「不飽和」（輸出多 1 bit）時的正端最壞情況：N 筆都是 q = −1、x = −2^{B_x−1} ⇒ Σ q·x = +2^{B_x−1}·N。
 * N 為 2 的冪、B_acc = B_x + log₂N 時它等於 2^{B_acc−1}，比可表示的最大值 2^{B_acc−1} − 1 多 1 個 count（wrap 後變成 −2^{B_acc−1}）。
 */
export function negateWorstCaseSum(Bx: number, N: number): number {
  return 2 ** (Bx - 1) * N
}

/** 用右移 s 位代替 /N 時的有效比例 N/2^s（N 非 2 的冪、或改了 N 卻沒改 s，都會讓 μ 被縮放）。 */
export function shiftScale(N: number, shiftBits: number): number {
  return N / 2 ** shiftBits
}

export type EfbRounding = 'round' | 'floor'

// #region core:efbExact
/**
 * 一階 error-feedback quantizer（§13.4），常數目標 c = P/q，精確整數算術（狀態 r 以 1/q 為單位）：
 *   v[k] = c + r[k−1]，y[k] = Q(v[k])，r[k] = v[k] − y[k]
 * Q = round-half-up 或 floor。對最簡分數 P/q，必然進入週期 q 的 limit cycle（勘誤 E15）。
 */
export function efbSequence(P: number, q: number, steps: number, rounding: EfbRounding = 'round', r0Num = 0): { y: number[]; rNum: number[] } {
  const y: number[] = []
  const rNum: number[] = []
  let r = r0Num
  for (let k = 0; k < steps; k++) {
    const vNum = P + r // v = vNum / q
    const yk = rounding === 'floor' ? Math.floor(vNum / q) : Math.floor((2 * vNum + q) / (2 * q))
    r = vNum - yk * q
    y.push(yk)
    rNum.push(r)
  }
  return { y, rNum }
}
// #endregion

/** 由整數狀態序列偵測 limit-cycle 週期（第一次回到先前出現過的狀態）。 */
export function efbPeriod(P: number, q: number, rounding: EfbRounding = 'round'): number {
  const seen = new Map<number, number>()
  let r = 0
  for (let k = 0; k < 4 * q + 8; k++) {
    if (seen.has(r)) return k - (seen.get(r) as number)
    seen.set(r, k)
    const vNum = P + r
    const yk = rounding === 'floor' ? Math.floor(vNum / q) : Math.floor((2 * vNum + q) / (2 * q))
    r = vNum - yk * q
  }
  return NaN
}

/** 定點 w_H（F 個小數位）時常數輸入的週期 2^F/gcd(K, 2^F)，K = round(w_H·2^F) 的小數部分（勘誤 E15）。 */
export function fixedPointPeriod(target: number, F: number): number {
  const scale = 2 ** F
  const K = Math.round(target * scale)
  const frac = ((K % scale) + scale) % scale
  if (frac === 0) return 1
  return scale / gcd(frac, scale)
}

/** 週期序列相對目標的誤差功率 mean((y − c)²)。 */
export function errorPower(y: ArrayLike<number>, target: number): number {
  let s = 0
  for (let i = 0; i < y.length; i++) s += (y[i] - target) ** 2
  return s / y.length
}

/* ───────────────────── 5. 證據強度：機率性宣稱 ───────────────────── */

// #region core:failureUpperBound
/**
 * n 次獨立試驗觀察到 k 次失效時，失效機率 p 的單邊上界（信心 1 − α）：
 *   找最大的 p 使 P(X ≤ k | n, p) ≥ α（Clopper–Pearson）。k = 0 時有封閉解 p_U = 1 − α^{1/n} ≈ −ln α/n
 *   （α = 0.05 ⇒ 「rule of three」3/n）。
 */
export function failureUpperBound(k: number, n: number, conf = 0.95): number {
  const alpha = 1 - conf
  if (!(n >= 1) || k < 0) return NaN
  if (k >= n) return 1
  if (k === 0) return 1 - Math.pow(alpha, 1 / n)
  let lo = k / n
  let hi = 1
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi)
    if (binomCdf(k, n, mid) > alpha) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}
// #endregion

/** 要宣稱「失效機率 ≤ p_max（信心 conf）」且 0 失效時，需要的最少獨立試驗數 n = ⌈ln α/ln(1 − p_max)⌉。 */
export function trialsForZeroFailure(pMax: number, conf = 0.95): number {
  return Math.ceil(Math.log(1 - conf) / Math.log(1 - pMax))
}

/** Chebyshev：P(|δ| ≥ b) ≤ E[δ²]/b²（mean-square 有界 ⇒ 機率性有界）。 */
export function chebyshevBound(meanSquare: number, b: number): number {
  return Math.min(1, meanSquare / (b * b))
}

export interface PathStudy {
  mu: number
  /** 樣本路徑中 |δ_n| < tol·|δ_0| 的比例 */
  fracConverged: number
  /** log10 of 樣本平均 δ_n²/δ_0²（log-sum-exp，避免溢位） */
  log10SampleMsd: number
  /** log10 of 理論 E[δ_n²]/δ_0² = n·log10 g(μ) */
  log10TheoryMsd: number
  /** 中位數 log10|δ_n/δ_0| */
  log10MedianAbs: number
  /** 每條路徑的 log10|δ_n/δ_0|（畫分布用） */
  log10Abs: Float64Array
}

/**
 * 純量 iid Gaussian regressor、無雜訊：δ_{n+1} = (1 − μx_n²)δ_n（§3.1、勘誤 E14）。
 * 以 log|δ| 追蹤以免溢位；回傳有限 seeds 的「經驗觀察」與理論 MSD 的對照。
 */
export function scalarPathStudy(mu: number, paths: number, steps: number, seed: number, tol = 1e-3): PathStudy {
  const rng = createRng(seed)
  const logs = new Float64Array(paths)
  for (let i = 0; i < paths; i++) {
    const r = rng.fork(i)
    let L = 0
    for (let n = 0; n < steps; n++) {
      const x = r.normal()
      L += Math.log(Math.abs(1 - mu * x * x))
    }
    logs[i] = L
  }
  let conv = 0
  let mx = -Infinity
  for (const L of logs) {
    if (L < Math.log(tol)) conv++
    mx = Math.max(mx, 2 * L)
  }
  let s = 0
  for (const L of logs) s += Math.exp(2 * L - mx)
  const logMean = mx + Math.log(s / paths)
  const sorted = Array.from(logs).sort((a, b) => a - b)
  const med = paths % 2 ? sorted[(paths - 1) / 2] : 0.5 * (sorted[paths / 2 - 1] + sorted[paths / 2])
  const g = 1 - 2 * mu + 3 * mu * mu
  return {
    mu,
    fracConverged: conv / paths,
    log10SampleMsd: logMean / Math.LN10,
    log10TheoryMsd: steps * Math.log10(g),
    log10MedianAbs: med / Math.LN10,
    log10Abs: Float64Array.from(logs, (L) => L / Math.LN10),
  }
}

/* ───────────────────── 6. §17 反面測試的數學特徵 ───────────────────── */

/** 錯誤 mod-180 的 polarity margin（勘誤 E20 的反例）：90° − (θ mod 180°)，mod 取非負餘數。 */
export function naivePolarityMarginDeg(thetaDeg: number): number {
  const r = ((thetaDeg % 180) + 180) % 180
  return 90 - r
}

/** 取樣率 f_s 下頻率 f 的 alias（折到 [0, f_s/2]）。 */
export function aliasFrequency(f: number, fs: number): number {
  const r = ((f % fs) + fs) % fs
  return r > fs / 2 ? fs - r : r
}

/**
 * 錯誤 0/1 編碼（q = b）時的 mean-field 固定點：Σ p_x·x·Φ((a − w)x/σ_v) = 0（二分法）。
 * DC code {−1, −0.5, 0, 0.5, 1, 1.5}、σ_v = 100 fs ⇒ w − a ≈ +41.27 fs（golden T04）。
 */
export function unipolarFixedPointShift(values: number[], sigmaV: number): number {
  const f = (dw: number) => {
    // dw = w − a；E[b·x] = mean x·Φ(−dw·x/σ)
    let s = 0
    for (const x of values) s += x * normCdf((-dw * x) / sigmaV)
    return s / values.length
  }
  let lo = -20 * sigmaV
  let hi = 20 * sigmaV
  let flo = f(lo)
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi)
    const fm = f(mid)
    if (fm === 0) return mid
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid
      flo = fm
    } else hi = mid
  }
  return 0.5 * (lo + hi)
}

/** E[q·x] 在 w = a 的「錯誤編碼」平均更新：E[b·x] = Σ x·Φ(0)/n = E[x]/2。 */
export function unipolarUpdateAtTruth(values: number[]): number {
  let s = 0
  for (const x of values) s += x * eq(0, 1, 'unipolar')
  return s / values.length
}

export const DC_CODE_VALUES = [-1, -0.5, 0, 0.5, 1, 1.5]

export interface NegativeSignatures {
  /** 極性反轉：pole = 1 + μK（μ = 10 fs、σ_v = 100 fs、C = 1） */
  reversedPolarityPole: number
  /** 缺乏 PE：R = [[1,1],[1,1]] 的最小 eigenvalue */
  missingPeEigMin: number
  /** code 錯位：φ = 0、Ω = π/6、D = 4 ⇒ C_D */
  misalignedCD4: number
  /** sum 模式：gmacSum/gmacAverage 的比值（= N） */
  sumModeGainMultiplier: number
  gSumMode: number
  poleSumMode: number
  /** μ 以 N₀ = 4096 補償，但 N 改為 32N₀ 卻沒重算：g = 32·μK */
  gWrongNScaling: number
  /** 錯誤編碼：w = a 時的平均更新（DC code）與固定點偏移 */
  wrongEncodingUpdateAtTruth: number
  wrongEncodingShiftFs: number
  /** 定點 overflow：6-bit × 4096 需要的位元數；17-bit wrap 後的總和 */
  gmacBitsRequired: number
  gmacSumExact: number
  gmacWrapped17: number
  gmacSaturated17: number
  /** E20：θ = 200° 與 −150° 的正確／錯誤 polarity margin */
  margin200: number
  margin200Naive: number
  marginM150: number
  marginM150Naive: number
  /** 路徑混淆：ω = 0.1ω_n、ζ = 0.7 的 |H_PD|、|T|、|H_PD + T − 1| */
  hpdAt01: number
  tAt01: number
  pathIdentityResidual: number
  /** aliasing：0.6 f_s 折到的頻率（以 f_s 為單位）與兩序列最大差 */
  aliasOf06: number
  aliasMaxDiff: number
  /** 公式錯誤偵測：g = 1 的正確 PM 與漏掉 /2 的 PM；σ_w 正確 vs 用 (1 − p) */
  pmRight: number
  pmWrong: number
  /** 數值 crossover 求得的 PM（與封閉式獨立） */
  pmNumeric: number
  sigmaWRight: number
  sigmaWWrong: number
  /** comparator 大偏移：s = 500 fs、σ_v = 100 fs 的 E[q] 與 K_q·s */
  eqAt500: number
  kqTimesS500: number
  /** gauge：one-hot + global offset 的 R 最小 eigenvalue */
  gaugeEigMin: number
}

/** §17 反面測試的「數學特徵」——全部由上面的函式即時計算（Golden：negative_tests.json、T04、T06、T07、T13）。 */
export function negativeSignatures(): NegativeSignatures {
  const mu = 10
  const K = kq(100)
  const N = 4096
  const ones = new Float64Array(N).fill(1)
  const multiplier = gmacSum(ones, ones) / gmacAverage(ones, ones)
  const thirtyOne = new Float64Array(N).fill(31)
  const hpd = ctHpd(0.1, { zeta: 0.7, wn: 1 })
  const t = ctT(0.1, { zeta: 0.7, wn: 1 })
  let aliasMaxDiff = 0
  for (let n = 0; n < 1000; n++) aliasMaxDiff = Math.max(aliasMaxDiff, Math.abs(Math.cos(2 * Math.PI * 0.6 * n) - Math.cos(2 * Math.PI * 0.4 * n)))
  const p = 1 - mu * K
  const gUnit = 1
  // one-hot（4 相）+ global offset：regressor [1, e_i]，均勻選相
  const R: Matrix = Array.from({ length: 5 }, (_, i) => Array.from({ length: 5 }, (_, j) => (i === 0 && j === 0 ? 1 : i === 0 || j === 0 ? 0.25 : i === j ? 0.25 : 0)))
  return {
    reversedPolarityPole: 1 + mu * K * 1,
    missingPeEigMin: eigSym([[1, 1], [1, 1]]).values[1],
    misalignedCD4: corrSingleTone({ amplitude: 1, magnitude: 1, phaseRad: 0, omega: Math.PI / 6, delay: 4 }),
    sumModeGainMultiplier: multiplier,
    gSumMode: multiplier * mu * K,
    poleSumMode: 1 - multiplier * mu * K,
    gWrongNScaling: (mu / N) * K * (32 * N),
    wrongEncodingUpdateAtTruth: unipolarUpdateAtTruth(DC_CODE_VALUES),
    wrongEncodingShiftFs: unipolarFixedPointShift(DC_CODE_VALUES, 100),
    gmacBitsRequired: accumulatorBitsRequired(6, N),
    gmacSumExact: gmacSum(thirtyOne, ones),
    gmacWrapped17: gmacSumWrapped(thirtyOne, ones, 17),
    gmacSaturated17: saturateTwos(gmacSum(thirtyOne, ones), 17),
    margin200: polarityMarginDeg(200),
    margin200Naive: naivePolarityMarginDeg(200),
    marginM150: polarityMarginDeg(-150),
    marginM150Naive: naivePolarityMarginDeg(-150),
    hpdAt01: Math.hypot(hpd.re, hpd.im),
    tAt01: Math.hypot(t.re, t.im),
    pathIdentityResidual: Math.hypot(hpd.re + t.re - 1, hpd.im + t.im),
    aliasOf06: aliasFrequency(0.6, 1),
    aliasMaxDiff,
    pmRight: pmDeg(gUnit, 0),
    pmWrong: 90 - (Math.asin(Math.min(gUnit, 1)) * 180) / Math.PI, // 漏掉 /2 的錯誤公式
    pmNumeric: pmNumeric(gUnit, 0),
    sigmaWRight: mu * Math.sqrt(1 / N / (1 - p * p)),
    sigmaWWrong: mu * Math.sqrt(1 / N / (1 - p)),
    eqAt500: erf(500 / (Math.SQRT2 * 100)),
    kqTimesS500: K * 500,
    gaugeEigMin: eigSym(R).values[4],
  }
}

// #region core:linearSigmaWMc
/**
 * 「公式錯了 UI 卻顯示成功」的反制：用與公式獨立的時域模擬估 σ_w。
 * 線性化 block 遞迴 δw_{k+1} = p·δw_k + μη_k，η_k ~ N(0, σ_η²) iid；每個 seed 丟掉 burn 個 block 後估一個 σ̂_w。
 * （這只驗證公式的代數；sign-LMS 的非線性另見 Ch12 的 sample-level 模擬。）
 */
export function linearSigmaWMc(p: { pole: number; mu: number; sigmaEta: number; blocks: number; burn: number; seeds: number; seed: number }): number[] {
  const root = createRng(p.seed)
  const out: number[] = []
  for (let s = 0; s < p.seeds; s++) {
    const r = root.fork(s)
    let d = 0
    let acc = 0
    for (let k = 0; k < p.burn + p.blocks; k++) {
      d = p.pole * d + p.mu * p.sigmaEta * r.normal()
      if (k >= p.burn) acc += d * d
    }
    out.push(Math.sqrt(acc / p.blocks))
  }
  return out
}
// #endregion

/* ───────────────────── 7. 其他小工具（附錄 B、策略） ───────────────────── */

/** 單 tone 時間誤差 A_t [fs peak] 在 f_out 的 SSB spur（小角、|T| = 1）：20log10(β/2)，β = 2πf_out A_t。 */
export function spurDbc(fOutHz: number, atFs: number): number {
  const beta = fsToRad(atFs, fOutHz)
  return 20 * Math.log10(beta / 2)
}

/** 三階 INL 例（§11.2、E01）：x ∈ {−2..2} 等機率、a = 1、c₃ = 0.1 時 MSE-LMS 固定點 a + c₃E[x⁴]/E[x²]。 */
export function inlMseFixedPoint(values: number[], a: number, c3: number): number {
  const m2 = mean(values.map((x) => x * x))
  const m4 = mean(values.map((x) => x ** 4))
  return a + (c3 * m4) / m2
}

/** 無雜訊 Sign-LMS 固定點：Σ x·sign((a − w)x + c₃x³) 變號處（二分法；E01 ⇒ 1.4）。 */
export function inlSignFixedPoint(values: number[], a: number, c3: number): number {
  const G = (w: number) => {
    let s = 0
    for (const x of values) {
      const e = (a - w) * x + c3 * x ** 3
      s += x * (e > 0 ? 1 : e < 0 ? -1 : 0)
    }
    return s
  }
  let lo = a - 10
  let hi = a + 10
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi)
    if (G(mid) > 0) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}

/** comparator S 曲線：E[q] = erf(s/(√2σ_v)) 與線性外插 K_q·s（附錄 B-3）。 */
export function sCurve(sOverSigma: number): { exact: number; linear: number } {
  return { exact: erf(sOverSigma / Math.SQRT2), linear: Math.sqrt(2 / Math.PI) * sOverSigma }
}
