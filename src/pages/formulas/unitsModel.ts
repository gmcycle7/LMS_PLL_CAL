import { createRng, fsToRad, type Rng } from '@/simulation/core'
import { calLoop, spurBeta, spurDbcBessel, spurDbcSmallAngle, type CalLoop, type GmMode } from '@/simulation/models/calNoise'
import { gmacModel, signGmacBlock, type GmacModel } from '@/simulation/models/optimizer'
import { texNum } from './format'

/**
 * 「單位與頻寬換算器」的純計算核心（無 React）。
 * 解析部分完全沿用第 12 章的 calLoop（同一個核心）；本檔只補上：
 *   - 換算：f ↔ rad/block ↔ rad/sample、fs ↔ rad、sum ↔ average 的等效 μ
 *   - 交叉驗算：ENBW 與 −3 dB 的「封閉式 vs 數值積分／二分法」
 *   - 累積功率比例 F(f) 的封閉式（E06：f_3dB 以下只有約一半的雜訊功率）
 *   - Monte Carlo：線性 AR(1) 遞迴，或 ±1 code 的精確 1-bit block Sign-GMAC（Binomial 化簡，借用 optimizer.signGmacBlock）
 */

export interface UnitsCalcParams {
  /** comparator 取樣率 f_s [Hz] */
  fs: number
  /** GMAC block 長度 N */
  N: number
  /** 學習率 μ [fs]（average mode） */
  mu: number
  /** comparator 前雜訊 RMS σ_v [fs] */
  sigmaV: number
  /** 有效 code 相關 C = E[xu]（unit-RMS code、identity path 為 1） */
  C: number
  gmMode: GmMode
  /** PLL 輸出頻率 f_out [Hz]（fs ↔ rad 換算、spur） */
  fOut: number
  /** output timing tone 的 peak A_t [fs] */
  At: number
}

export const DEFAULT_UNITS_PARAMS: UnitsCalcParams = { fs: 4e9, N: 4096, mu: 10, sigmaV: 100, C: 1, gmMode: 'average', fOut: 13e9, At: 0.5 }

export interface UnitsCalcResult {
  loop: CalLoop
  /** 二分法解 |H|² = ½|H(0)|²（不用封閉式） */
  f3dbNumeric: number
  /** 數值積分 ∫_0^{f_u/2}|H|²/|H(0)|² df（不用封閉式） */
  enbwNumeric: number
  omega3dbBlock: number
  theta3dbSample: number
  /** √(S_w^(1)(0)·ENBW)：應等於 σ_w */
  sigmaFromEnbw: number
  /** √(S_w^(1)(0)·f_3dB)：把 −3 dB 誤當 Noise BW 的結果 */
  sigmaFromF3db: number
  /** f_3dB 以下的雜訊功率比例 */
  fracBelowF3db: number
  /** 若改用 sum mode，要維持同一個 g 需要的 μ */
  muForSumMode: number
  /** 1 fs 在 f_out 的相位 [rad] */
  radPerFs: number
  beta: number
  spurDbc: number
  spurDbcBessel: number
}

// #region core:normalizedH2
/**
 * |e^{jΩ} − p|² = 1 − 2p cosΩ + p²，寫成「全部是非負項相加」的形式（避免 p → ±1 時的相消誤差）：
 *   p ≥ 0：(1 − p)² + 4p·sin²(Ω/2)；p < 0：(1 + p)² − 4p·cos²(Ω/2)。
 */
export function poleDistance2(p: number, sin2Half: number, cos2Half: number): number {
  return p >= 0 ? (1 - p) * (1 - p) + 4 * p * sin2Half : (1 + p) * (1 + p) - 4 * p * cos2Half
}

/** 一階 H_{η→w} 的正規化功率響應 |H(f)|²/|H(0)|² = (1−p)²/|e^{jΩ} − p|²，Ω = 2πf/f_u */
export function normalizedH2(f: number, p: number, fu: number): number {
  const om = (2 * Math.PI * f) / fu // Hz → rad/block：頻率要除以「這個序列自己的取樣率」f_u，不是 f_s
  return ((1 - p) * (1 - p)) / poleDistance2(p, Math.sin(om / 2) ** 2, Math.cos(om / 2) ** 2)
}
// #endregion

// #region core:cumulativePower
/**
 * 累積功率比例 F(f) = ∫_0^f|H|² / ∫_0^{f_u/2}|H|²（|p| < 1）。
 * 由 ∫_0^Ω dν/(1 − 2p cos ν + p²) = (2/(1 − p²))·atan(((1+p)/(1−p))·tan(Ω/2)) 得
 *   F = (2/π)·atan(((1 + p)/(1 − p))·tan(Ω/2))。
 */
export function cumulativePowerFraction(f: number, p: number, fu: number): number {
  if (!(Math.abs(p) < 1)) return NaN
  const om = Math.min(Math.PI, Math.max(0, (2 * Math.PI * f) / fu))
  if (om >= Math.PI) return 1
  return (2 / Math.PI) * Math.atan(((1 + p) / (1 - p)) * Math.tan(om / 2)) // 在 f_3dB 處約 ½，不是 1（E06）
}
// #endregion

// #region core:f3dbBisection
/**
 * 不用封閉式的 −3 dB 頻率：以二分法解 |H(Ω)|² = ½|H(0)|²（給換算器的 Analytic 交叉比對用）。
 * 方程式寫成 4p·sin²(Ω/2) = (1 − p)²（由 |e^{jΩ} − p|² = (1 − p)² + 4p·sin²(Ω/2) = 2(1 − p)² 移項），
 * 左邊對 Ω ∈ [0, π] 單調遞增、沒有相消：p → 1（Ω_3dB ≈ 1 − p 很小）時仍然準到雙精度。
 * （若直接用 1 − 2p·cosΩ + p² 做二分，1 − p ≲ 10⁻⁵ 時相消誤差就超過 10⁻⁸，會把正確的封閉式誤判成「不一致」。）
 * 不存在（p ≤ 0、p ≥ 1，或 Nyquist 處衰減不到 3 dB：p < 3 − 2√2，E27）時回傳 NaN。
 */
export function f3dbBisection(p: number, fu: number): number {
  if (!(p > 0 && p < 1)) return NaN
  const target = (1 - p) * (1 - p)
  const h = (om: number) => 4 * p * Math.sin(om / 2) ** 2 - target // 單調遞增；h(0) = −(1 − p)² < 0
  // 存在性：h(π) = 4p − (1 − p)² ≥ 0 ⇔ p ≥ 3 − 2√2（容許與封閉式相同的 10⁻¹² 邊界誤差）
  if (h(Math.PI) < -8e-12 * p) return NaN
  let lo = 0
  let hi = Math.PI
  for (let i = 0; i < 1200; i++) {
    const mid = 0.5 * (lo + hi)
    if (mid === lo || mid === hi) break // 區間已縮到相鄰的兩個浮點數
    if (h(mid) < 0) lo = mid
    else hi = mid
  }
  return (0.5 * (lo + hi) * fu) / (2 * Math.PI) // rad/block → Hz：乘 f_u/2π
}
// #endregion

/** F(f) 的反函數：功率比例 q ∈ (0, 1) 對應的頻率 f_q = (f_u/π)·atan(((1 − p)/(1 + p))·tan(πq/2)) [Hz] */
export function frequencyAtPowerFraction(q: number, p: number, fu: number): number {
  if (!(Math.abs(p) < 1) || !(q >= 0 && q <= 1)) return NaN
  if (q === 1) return fu / 2
  return (fu / Math.PI) * Math.atan(((1 - p) / (1 + p)) * Math.tan((Math.PI * q) / 2))
}

/**
 * 自適應 Simpson（遞迴；給 ENBW 數值積分交叉驗算用）。
 * 停止條件有「捨入誤差底線」：子區間的 Richardson 差值已經小到浮點捨入的量級時就不再細分
 * （否則容差每層減半、永遠達不到，遞迴會一路做到 maxDepth，運算量是 2^maxDepth）。
 */
export function adaptiveSimpson(f: (x: number) => number, a: number, b: number, tol = 1e-12, maxDepth = 48, maxEvals = 400_000): number {
  const simpson = (fa: number, fm: number, fb: number, h: number) => (h / 6) * (fa + 4 * fm + fb)
  let evals = 3
  const rec = (a0: number, b0: number, fa: number, fm: number, fb: number, whole: number, eps: number, depth: number): number => {
    const m = 0.5 * (a0 + b0)
    const lm = 0.5 * (a0 + m)
    const rm = 0.5 * (m + b0)
    const flm = f(lm)
    const frm = f(rm)
    evals += 2
    const left = simpson(fa, flm, fm, m - a0)
    const right = simpson(fm, frm, fb, b0 - m)
    const diff = left + right - whole
    const roundoff = 16 * Number.EPSILON * (Math.abs(left) + Math.abs(right))
    // evals > maxEvals：安全網（被積函數本身帶數值雜訊時不再細分，回傳目前的估計）
    if (depth <= 0 || evals > maxEvals || Math.abs(diff) <= 15 * Math.max(eps, roundoff)) return left + right + diff / 15
    return rec(a0, m, fa, flm, fm, left, eps / 2, depth - 1) + rec(m, b0, fm, frm, fb, right, eps / 2, depth - 1)
  }
  const fa = f(a)
  const fb = f(b)
  const fm = f(0.5 * (a + b))
  return rec(a, b, fa, fm, fb, simpson(fa, fm, fb, b - a), tol, maxDepth)
}

/** ENBW 的數值版本（在 Ω 上積分再換回 Hz；peak 在 DC，先用 tan 代換把 1 − p 的尖峰攤開） */
export function enbwNumeric(p: number, fu: number): number {
  if (!(Math.abs(p) < 1)) return NaN
  // Ω = 2·atan(t)：dΩ = 2/(1 + t²) dt，t ∈ [0, ∞)；再令 t = s/(1 − s)，s ∈ [0, 1]：
  // dΩ/ds = 2/((1 − s)² + s²)（在 s = 1 也有限），Ω = 2·atan2(s, 1 − s)
  // 代換後 sin²(Ω/2) = s²/D、cos²(Ω/2) = (1−s)²/D，D = (1−s)² + s²；被積函數直接用 s 寫，不經過三角函數：
  //   |H|²/|H(0)|²·dΩ/ds = 2(1−p)² / (D·|e^{jΩ} − p|²)，其中 D·|e^{jΩ} − p|² 仍是非負項相加
  const g = (s: number) => {
    const D = (1 - s) * (1 - s) + s * s
    const den = p >= 0 ? (1 - p) * (1 - p) * D + 4 * p * s * s : (1 + p) * (1 + p) * D - 4 * p * (1 - s) * (1 - s)
    return (2 * (1 - p) * (1 - p)) / den
  }
  // 先粗估量級，再用相對容差細算（積分值 ∝ 1 − p，p → 1 時很小，不能用固定的絕對容差）
  const coarse = adaptiveSimpson(g, 0, 1, 1e-6)
  const integralOmega = adaptiveSimpson(g, 0, 1, 1e-11 * Math.abs(coarse)) // ∫_0^π |H|²/|H(0)|² dΩ
  return (integralOmega / (2 * Math.PI)) * fu
}

export function unitsCalc(prm: UnitsCalcParams): UnitsCalcResult {
  const loop = calLoop({ N: prm.N, fs: prm.fs, mu: prm.mu, sigmaV: prm.sigmaV, C: prm.C, gmMode: prm.gmMode })
  const fu = loop.fu
  const beta = spurBeta(prm.fOut, prm.At, 1)
  return {
    loop,
    f3dbNumeric: f3dbBisection(loop.p, fu),
    enbwNumeric: enbwNumeric(loop.p, fu),
    omega3dbBlock: (2 * Math.PI * loop.f3dbExact) / fu,
    theta3dbSample: (2 * Math.PI * loop.f3dbExact) / prm.fs,
    sigmaFromEnbw: Math.sqrt(loop.sw1Dc * loop.enbw),
    sigmaFromF3db: Math.sqrt(loop.sw1Dc * loop.f3dbExact),
    fracBelowF3db: cumulativePowerFraction(loop.f3dbExact, loop.p, fu),
    muForSumMode: prm.gmMode === 'average' ? prm.mu / prm.N : prm.mu,
    radPerFs: fsToRad(1, prm.fOut),
    beta,
    spurDbc: spurDbcSmallAngle(beta),
    spurDbcBessel: spurDbcBessel(beta),
  }
}

/**
 * 畫圖用：log 頻率格點上的 |H|²、累積比例 F(f)、矩形近似 f/ENBW。
 * 頻率下限：一般是 f_u·10⁻⁵；很慢的迴路（corner ≈ f_u(1 − |p|)/2π 更低）時往下延伸到 corner 的 1/100，
 * 否則圖上只剩滾降的那一段，f_3dB 與 ENBW 的標線都落在圖外。
 */
export function unitsCurves(p: number, fu: number, enbw: number, points = 360): { f: number[]; h2: number[]; frac: number[]; rect: number[] } {
  const corner = (fu * Math.max(1 - Math.abs(p), 1e-14)) / (2 * Math.PI)
  const fMin = Math.min(fu * 1e-5, corner / 100)
  const fMax = fu / 2
  const f: number[] = []
  const h2: number[] = []
  const frac: number[] = []
  const rect: number[] = []
  if (!(Math.abs(p) < 1)) return { f, h2, frac, rect }
  for (let i = 0; i < points; i++) {
    const fi = fMin * Math.pow(fMax / fMin, i / (points - 1))
    f.push(fi)
    h2.push(normalizedH2(fi, p, fu))
    frac.push(cumulativePowerFraction(fi, p, fu))
    rect.push(Number.isFinite(enbw) && enbw > 0 ? fi / enbw : NaN)
  }
  return { f, h2, frac, rect }
}

// ───────────────────────────── Monte Carlo ─────────────────────────────

export type UnitsMcEngine = 'linear' | 'sign'

export interface UnitsMcParams {
  mu: number
  sigmaV: number
  C: number
  N: number
  gmMode: GmMode
  engine: UnitsMcEngine
  chains: number
  /** 每條 chain 計入統計的 block 數（不含 burn-in） */
  blocks: number
  seed: number
}

export interface UnitsMcResult {
  engine: UnitsMcEngine
  /** E[δ²] 的估計（所有 chain、burn-in 之後；已知平均為 0） */
  varHat: number
  varTheory: number
  /** varHat 的標準誤（AR(1) 有效樣本數修正） */
  se: number
  z: number
  sigmaHat: number
  ess: number
  nTotal: number
  burnIn: number
  /** 每條 chain 實際計入統計的 block 數（可能因運算量上限而少於要求的數目） */
  blocksUsed: number
  /** chain 0 的 δ_k（burn-in 之後，最多 1500 點） */
  trace: Float64Array
  diverged: boolean
  /** 1-bit 引擎需要的 burn-in（8τ + 10）是否因運算量上限被截短（截短時鏈還沒到穩態，不做判定） */
  burnInTruncated: boolean
  /** 交叉比對是否有意義（|p| < 1、ESS ≥ 30、未發散、burn-in 足夠、1-bit 時小訊號） */
  valid: boolean
  note: string
}

// #region core:mcLinearStep
/** 線性引擎的一步：δ_{k+1} = p·δ_k + μη_k，η_k ~ N(0, σ_η²)（Gaussian、與 δ 無關） */
export function linearMcStep(d: number, p: number, mu: number, sEta: number, rng: Rng): number {
  const eta = sEta * rng.normal() // ← 差異：GMAC 雜訊直接用 Gaussian 代替（中央極限定理）
  return p * d + mu * eta // ← 差異：恢復力 −gδ 對 δ 是直線（小訊號 K_q），永遠不飽和
}
// #endregion

// #region core:mcSignStep
/** 1-bit 引擎的一步：真的做 N 次比較，G = (2·Bin(N, Φ(Cδ/σ_v)) − N)/N，再 δ_{k+1} = δ_k − μ·G（sum mode 乘 N） */
export function signMcStep(d: number, mu: number, scale: number, model: GmacModel, rng: Rng): number {
  const G = signGmacBlock(rng, d, model) // ← 差異：Σq·x 是 Binomial（精確），平均值是 erf 形的 S 曲線
  return d - mu * scale * G // ← 差異：|G| ≤ 1 ⇒ 每個 block 最多走 μ（slew-limited），大誤差時比線性模型慢
}
// #endregion

/** 每次 MC 最多抽幾個 block（主執行緒上 < 0.1 s；超過時自動減少 blocks） */
export const MC_BLOCK_BUDGET = 200_000

/**
 * 實際的 block 預算。1-bit 引擎每個 block 是一次 Binomial(N, p) 抽樣，成本 ∝ √N（從眾數往兩側累加 pmf），
 * 所以 N 很大時要少抽一些，讓整次模擬維持在約 0.1 s 內（N ≤ 3600 時就是 MC_BLOCK_BUDGET）。
 */
export function mcBudget(engine: UnitsMcEngine, N: number): number {
  if (engine === 'linear') return MC_BLOCK_BUDGET
  return Math.max(4000, Math.min(MC_BLOCK_BUDGET, Math.floor(1.2e7 / Math.sqrt(Math.max(1, N)))))
}
export const MC_DIVERGE_FS = 1e6

/** 每條 chain 至少計入統計的 block 數（即使 burn-in 把預算用完） */
export const MC_MIN_BLOCKS = 10

/**
 * 把「每條 chain 的預算」分給 burn-in 與計入統計的 blocks。
 * 重點：**burn-in 也算在預算內**。慢迴路（p → 1）的 8τ 可以是幾百萬個 block；若不設上限，
 * 一次 Run 就會在迴圈裡跑 chains × 8τ 次 Binomial 抽樣，頁面（或 worker）等於當掉。
 * 預算不夠放完整的 burn-in 時把它截短，並回報 truncated：鏈還沒到穩態，呼叫端不做判定。
 */
export function planMcBlocks(wantBurnIn: number, wantBlocks: number, chains: number, budget: number): { burnIn: number; blocks: number; truncated: boolean } {
  const perChainBudget = Math.max(2 * MC_MIN_BLOCKS, Math.floor(budget / Math.max(1, chains)))
  const need = Math.max(0, Math.ceil(wantBurnIn))
  const burnIn = Math.min(need, perChainBudget - MC_MIN_BLOCKS) // ← burn-in 最多用到「預算 − 最少 blocks」
  const blocks = Math.max(MC_MIN_BLOCKS, Math.min(Math.max(MC_MIN_BLOCKS, Math.floor(wantBlocks)), perChainBudget - burnIn))
  return { burnIn, blocks, truncated: burnIn < need }
}

/**
 * 線性引擎：δ_{k+1} = p·δ_k + μη_k，η ~ N(0, σ_η²)，初值取穩態分布 N(0, σ_w²)（不需 burn-in）。
 * 1-bit 引擎：x = ±1、u = C·x，q·x = sign(Cδ + v·x) ⇒ Σq·x = 2·Binomial(N, Φ(Cδ/σ_v)) − N（精確），
 *   δ = a − w，w_{k+1} = w_k + μG_k ⇒ δ_{k+1} = δ_k − μG_k（sum mode 再乘 N）；從 δ = 0 開始、丟掉 burn-in。
 * 運算量：chains × (burn-in + blocks) ≤ mcBudget(engine, N)（外加每條 chain 至多 2·MC_MIN_BLOCKS 的下限）。
 */
export function runUnitsMc(prm: UnitsMcParams): UnitsMcResult {
  const loop = calLoop({ N: prm.N, fs: 1, mu: prm.mu, sigmaV: prm.sigmaV, C: prm.C, gmMode: prm.gmMode })
  const p = loop.p
  const varTheory = loop.sigmaW2
  const stable = Math.abs(p) < 1 && Number.isFinite(varTheory)
  const tau = stable && p !== 0 ? -1 / Math.log(Math.abs(p)) : 0
  const chains = Math.max(1, Math.floor(prm.chains))
  const wantBurnIn = prm.engine === 'sign' && stable ? Math.ceil(8 * tau) + 10 : 0
  const budget = mcBudget(prm.engine, prm.N)
  const { burnIn, blocks, truncated: burnInTruncated } = planMcBlocks(wantBurnIn, prm.blocks, chains, budget)
  const rng = createRng(prm.seed)
  const model = gmacModel(prm.N, prm.sigmaV, 0, prm.C)
  const scale = prm.gmMode === 'sum' ? prm.N : 1
  const sEta = Math.sqrt(loop.sigmaEta2)
  const trace = new Float64Array(Math.min(blocks, 1500))
  let sum2 = 0
  let n = 0
  let diverged = false
  for (let ch = 0; ch < chains && !diverged; ch++) {
    const r = rng.fork(ch)
    let d = prm.engine === 'linear' && stable ? Math.sqrt(varTheory) * r.normal() : 0
    for (let k = 0; k < burnIn + blocks; k++) {
      d = prm.engine === 'linear' ? linearMcStep(d, p, prm.mu, sEta, r) : signMcStep(d, prm.mu, scale, model, r)
      if (!Number.isFinite(d) || Math.abs(d) > MC_DIVERGE_FS) {
        diverged = true
        break
      }
      if (k >= burnIn) {
        sum2 += d * d
        n++
        if (ch === 0 && k - burnIn < trace.length) trace[k - burnIn] = d
      }
    }
  }
  const varHat = n > 0 ? sum2 / n : NaN
  const ess = stable ? (n * (1 - p * p)) / (1 + p * p) : 0
  const se = stable && n > 0 ? varTheory * Math.sqrt((2 * (1 + p * p)) / ((1 - p * p) * n)) : NaN
  const z = (varHat - varTheory) / se
  // 小訊號（K_q 線性化）要看 comparator 前確定性殘差的大小：本引擎 u = C·x、|x| = 1，殘差是 C·δ，RMS 為 |C|·σ_w（不是 σ_w 本身）
  const residualRatio = (Math.abs(prm.C) * Math.sqrt(varTheory)) / prm.sigmaV
  const smallSignal = !(prm.engine === 'sign') || residualRatio <= 0.2
  // note 是「$TeX$ 夾雜的說明文字」（ExperimentShell 的警告、交叉比對說明會以 KaTeX 顯示）
  const t = (x: number, d = 4) => texNum(x, d)
  let note = ''
  let valid = true
  if (diverged) {
    valid = false
    note =
      prm.engine === 'sign'
        ? String.raw`$|\delta|$ 超過模擬上限 $${t(MC_DIVERGE_FS, 2)}\,\mathrm{fs}$：1-bit 迴路雖然有界（$|G|\le1$），但每個 block 可以走 $\mu${prm.gmMode === 'sum' ? String.raw`\,N` : ''}=${t(prm.mu * scale)}\,\mathrm{fs}$，這個步長的量級已經超過上限（線性理論的 pole $p=${t(p, 6)}$）。這不是校正，請檢查 $\mu$ 與 gm_mode。`
        : String.raw`$|\delta|$ 超過 $${t(MC_DIVERGE_FS, 2)}\,\mathrm{fs}$：模擬發散（線性理論的 pole $p=${t(p, 6)}$，$|p|\ge1$ 時每個 block 誤差放大 $|p|$ 倍）。`
  } else if (!stable) {
    valid = false
    note =
      prm.engine === 'sign'
        ? String.raw`線性理論預測不穩定（$|p|=${t(Math.abs(p), 6)}\ge1$）；1-bit 迴路因 comparator 飽和（$|G|\le1$）不會數值發散，而是變成大幅 limit cycle（實測 RMS $${t(Math.sqrt(varHat))}\,\mathrm{fs}$），$\sigma_w=\mu\sigma_\eta/\sqrt{1-p^2}$ 不適用。`
        : String.raw`$|p|=${t(Math.abs(p), 6)}\ge1$：沒有穩態變異數可比對。`
  } else if (burnInTruncated) {
    valid = false
    note = String.raw`迴路太慢：$\tau=${t(tau)}$ blocks，1-bit 引擎從 $\delta=0$ 出發需要 $8\tau+10=${t(wantBurnIn)}$ 個 block 的 burn-in 才到穩態，但每條 chain 的運算量上限只有 $${t(burnIn + blocks)}$ 個 block（已截短成 $${t(burnIn)}$）。鏈還沒到穩態，$\hat\sigma_w$ 會偏小，不做判定。請改用線性引擎（初值直接取穩態分布）、減少 chains，或加大 $\mu$。`
  } else if (ess < 30) {
    valid = false
    note = String.raw`有效樣本數 ESS $=${t(ess, 3)}<30$（$p$ 太接近 1，$\tau=${t(tau)}$ blocks，相鄰 block 高度相關）：請增加 blocks 或 chains。`
  } else if (!smallSignal) {
    valid = false
    note = String.raw`$|C|\,\sigma_w/\sigma_v=${t(residualRatio, 3)}>0.2$：comparator 前殘差的 RMS（本引擎 $u=Cx$，所以是 $|C|\,\sigma_w$）已經不是遠小於 $\sigma_v$，$K_q$ 小訊號線性化不成立（comparator 的 S 曲線已經彎曲），1-bit Monte Carlo 與線性公式的差距是模型誤差，只供參考。`
  } else {
    note = String.raw`ESS $=${t(ess, 4)}$、$z=${t(z, 3)}$（判定：$|z|\le4$）。標準誤用 AR(1) 的 $\operatorname{Var}(\hat s^2)\approx2\sigma^4(1+p^2)/((1-p^2)n)$。`
  }
  return {
    engine: prm.engine,
    varHat,
    varTheory,
    se,
    z,
    sigmaHat: Math.sqrt(varHat),
    ess,
    nTotal: n,
    burnIn,
    blocksUsed: blocks,
    trace: n > 0 ? trace : new Float64Array(0),
    diverged,
    burnInTruncated,
    valid,
    note,
  }
}

/** 一次 Run 的全部 case（A / B / C 共用同一個 seed）；參數與結果都可 structured clone，可在 Web Worker 中執行 */
export interface UnitsMcBatchParams {
  cases: UnitsMcParams[]
}

/**
 * Worker 進入點（src/pages/formulas/units.worker.ts 以 dispatch 呼叫；jsdom 測試與 worker 不可用時在主執行緒 inline 執行）。
 * 純函式：只依賴參數（含 seed），不使用模組層級的可變狀態。
 */
export function runUnitsMcBatch(prm: UnitsMcBatchParams): UnitsMcResult[] {
  return prm.cases.map((c) => runUnitsMc(c))
}
