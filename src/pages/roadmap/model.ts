/**
 * Research Backlog / Roadmap（規格附錄 C）的「數學預覽」計算核心。
 *
 * 這裡的每個函式都只是某個研究題目的**第一步**：在一個明確、簡化的模型裡把關鍵量算出來，
 * 讓讀者看到「這個研究需要什麼數學、為什麼重要」。它們不是已驗證的功能，頁面上一律標示
 * 研究狀態（pending / partial / not started / in analysis），**不會**標成 verified。
 *
 * 純函式、不依賴 React / DOM；隨機一律用 createRng(seed)，同 seed 可重現。
 * 頁面以 `?raw` 匯入本檔，用 `#region core:<name>` 顯示真正執行的程式碼（docs/teaching-style.md §4）。
 *
 * 極性與符號（與全站一致）：
 *   δw = w − w*（勘誤 E33，同第 12 章）；R7 沿用規格 §8.4 的抽象模型 δ（δ_{k+1} = δ_k − μG_k）。
 *   K = K_q·C [fs⁻¹]，g = μK（無因次），p = 1 − g；σ_η² ≈ 1/N（average-mode sign-GMAC）。
 *   正則化參數一律寫 ε（勘誤 E22：λ 只代表 eigenvalue）。
 */
import {
  c,
  cAbs2,
  cAdd,
  createRng,
  eigSym,
  eigvals,
  identity,
  matAdd,
  matMul,
  matScale,
  meanCI,
  normCdf,
  normPdf,
  pinvReg,
  solve,
  studentTCdf,
  studentTPdf,
  svd,
  transpose,
  zeros,
  type Complex,
  type Matrix,
} from '@/simulation/core'
import { fft, fftReal, freqz, impulseResponse, integratePsd } from '@/simulation/signal'
import { designDtLoop } from '@/simulation/models/pll'

// ───────────────────────────── 共用小工具 ─────────────────────────────

/** 最大公因數（非負整數）。gcd(0, m) = m。 */
export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

/** 最小公倍數 */
export function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return Math.abs((a / gcd(a, b)) * b)
}

/** 95% 衰減所需步數 ⌈ln 0.05 / ln|p|⌉；|p| ≥ 1 時為 Infinity。 */
export function settle95(p: number): number {
  const a = Math.abs(p)
  if (!(a < 1)) return Number.POSITIVE_INFINITY
  if (a === 0) return 1
  return Math.ceil(Math.log(0.05) / Math.log(a))
}

/**
 * ⌊x⌋，但容許 x 因 double 的捨入比整數小一點點：4.096e9 × 200e-6 在 double 裡是 819199.9999999999，
 * 除以 4096 後應該是 200 個 block，不是 199。只吸收 1e-12 等級的相對誤差。
 */
export function floorTol(x: number): number {
  return Math.floor(x * (1 + 1e-12) + 1e-12)
}

/** 以 z⁻¹ 升冪係數在實數 z⁻¹ = β 處求值：Σ b_k β^k */
export function polyAscAt(coef: ArrayLike<number>, beta: number): number {
  let acc = 0
  for (let k = coef.length - 1; k >= 0; k--) acc = acc * beta + coef[k]
  return acc
}

// ═════════════════════════ R1｜Colored / Correlated GMAC Noise ═════════════════════════

export interface ColoredNoiseParams {
  /** 校正 pole p = 1 − μK（無因次），|p| < 1 */
  p: number
  /** 步長 μ [fs]（average-mode GMAC） */
  mu: number
  /** GMAC 雜訊變異數 σ_η²（無因次；sign-GMAC 約 1/N） */
  sigmaEta2: number
  /** η 的 AR(1) 係數 ρ（相鄰 block 的相關係數），|ρ| < 1 */
  rho: number
}

// #region core:sigmaWColored
/**
 * 有色（AR(1)）GMAC 雜訊下的係數穩態變異數（封閉式）：
 *   δw_{k+1} = p·δw_k + μ·η_k，R_η[ℓ] = σ_η²·ρ^|ℓ|
 *   σ_w² = μ²σ_η²/(1 − p²) · (1 + pρ)/(1 − pρ)
 */
export function sigmaW2Colored({ p, mu, sigmaEta2, rho }: ColoredNoiseParams): number {
  if (!(Math.abs(p) < 1) || !(Math.abs(rho) < 1)) return Number.POSITIVE_INFINITY
  const white = (mu * mu * sigmaEta2) / (1 - p * p) // 白雜訊（ρ = 0）：第 12 章 F-12 的結果
  return white * ((1 + p * rho) / (1 - p * rho)) // ← 差異：有色雜訊的放大因子 (1 + pρ)/(1 − pρ)
}
// #endregion

// #region core:dlyap
/**
 * 離散 Lyapunov 方程 P = A·P·Aᵀ + Q 的直接解（n ≤ 4）。
 * 用 vec（列優先）把它寫成線性方程 (I − A⊗A)·vec(P) = vec(Q)。
 * A 的某兩個 eigenvalue 乘積等於 1（邊界穩定）時矩陣奇異，solve 會丟出錯誤。
 */
export function dlyap(A: Matrix, Q: Matrix): Matrix {
  const n = A.length
  const K = zeros(n * n, n * n)
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++)
        for (let l = 0; l < n; l++) {
          // (A P Aᵀ)[i][j] = Σ_k Σ_l A[i][k]·P[k][l]·A[j][l]
          K[i * n + j][k * n + l] = (i === k && j === l ? 1 : 0) - A[i][k] * A[j][l]
        }
  const v = solve(K, Q.flatMap((row) => row))
  return Array.from({ length: n }, (_, i) => v.slice(i * n, i * n + n))
}
// #endregion

// #region core:sigmaWLyapunov
/** 同一個量用狀態空間 + Lyapunov 方程求：狀態 s_k = [δw_k, η_k]ᵀ。 */
export function sigmaW2Lyapunov({ p, mu, sigmaEta2, rho }: ColoredNoiseParams): number {
  const A = [
    [p, mu], // δw_{k+1} = p·δw_k + μ·η_k
    [0, rho], // ← 差異：η 自己也有狀態 η_{k+1} = ρ·η_k + √(1−ρ²)·σ_η·ξ_k
  ]
  const drive2 = (1 - rho * rho) * sigmaEta2
  const Q = [
    [0, 0],
    [0, drive2],
  ]
  return dlyap(A, Q)[0][0]
}
// #endregion

export interface ColoredMcParams extends ColoredNoiseParams {
  chains: number
  blocks: number
  seed: number
}

export interface ColoredMcResult {
  /** 跨 chain 的 E[δw²] 估計與 95% CI（fs²） */
  meanSq: number
  lo: number
  hi: number
  chains: number
  blocks: number
  burnIn: number
  /** 最慢的時間常數 τ = 1/(1 − max(|p|, |ρ|))（blocks） */
  tauBlocks: number
  /** burn-in ≥ 5τ？否則 δw 從 0 出發還沒到穩態，估計會偏低，不可拿來判定 */
  burnInAdequate: boolean
  /** 第一條 chain 的前 400 個 δw（畫圖用） */
  trace: Float64Array
}

/**
 * Monte Carlo 的 burn-in 上限（blocks）。預覽的 MC 在主執行緒執行（Worker 只載入 src/simulation/models/*），
 * 所以把每次互動的總樣本數控制在 ~2e5 的量級；太慢的迴路（5τ > 上限）由呼叫端標示為「不判定」。
 */
export const MC_BURN_CAP = 2000

// #region core:sigmaWMonteCarlo
/** Monte Carlo：多條獨立 chain（各自 fork 亂數串流），逐 block 模擬同一條遞迴。 */
export function simulateColoredLms(P: ColoredMcParams): ColoredMcResult {
  const { p, mu, sigmaEta2, rho, chains, blocks, seed } = P
  const root = createRng(seed)
  const sEta = Math.sqrt(sigmaEta2)
  const drive = Math.sqrt(1 - rho * rho) * sEta
  const slow = Math.max(Math.abs(p), Math.abs(rho))
  const tauBlocks = 1 / Math.max(1e-9, 1 - slow)
  const burnIn = Math.min(MC_BURN_CAP, Math.ceil(20 * tauBlocks)) // 目標 20τ；太慢的迴路會被上限截斷
  const perChain: number[] = []
  const trace = new Float64Array(Math.min(400, blocks))
  for (let ch = 0; ch < chains; ch++) {
    const rng = root.fork(`chain-${ch}`)
    let eta = sEta * rng.normal() // η 從平穩分布出發
    let dw = 0
    let acc = 0
    for (let k = 0; k < burnIn + blocks; k++) {
      dw = p * dw + mu * eta // ← 差異：不解方程，直接跑遞迴
      eta = rho * eta + drive * rng.normal()
      if (k >= burnIn) {
        acc += dw * dw
        if (ch === 0 && k - burnIn < trace.length) trace[k - burnIn] = dw
      }
    }
    perChain.push(acc / blocks)
  }
  const ci = meanCI(perChain)
  return { meanSq: ci.mean, lo: ci.lo, hi: ci.hi, chains, blocks, burnIn, tauBlocks, burnInAdequate: burnIn >= 5 * tauBlocks, trace }
}
// #endregion

/**
 * 係數雜訊的單邊 PSD（fs²/Hz，block rate f_u）與其積分（Parseval 檢查）。
 * DTFT 形式 S(e^{jΩ}) = μ²/|1 − p e^{−jΩ}|² · σ_η²(1 − ρ²)/|1 − ρ e^{−jΩ}|²，
 * 單邊 per-Hz：S^(1)(f) = 2·S(e^{jΩ})/f_u（勘誤 E28）。
 */
export function coloredPsd(P: ColoredNoiseParams & { fu: number; points: number }): {
  f: Float64Array
  s1: Float64Array
  integral: number
} {
  const { p, mu, sigmaEta2, rho, fu, points } = P
  const n = Math.max(16, Math.round(points))
  const f = new Float64Array(n)
  const s1 = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const fi = (i / (n - 1)) * (fu / 2)
    const om = (2 * Math.PI * fi) / fu
    const d1 = 1 - 2 * p * Math.cos(om) + p * p
    const d2 = 1 - 2 * rho * Math.cos(om) + rho * rho
    f[i] = fi
    s1[i] = (2 / fu) * ((mu * mu) / d1) * ((sigmaEta2 * (1 - rho * rho)) / d2)
  }
  return { f, s1, integral: integratePsd(f, s1, 0, fu / 2) }
}

// ═════════════════════════ R2｜Cyclostationary DSM × LMS ═════════════════════════

// #region core:dsmResidue
/**
 * 一階 DSM（accumulator）的小數 residue 當 code：x[n] = ((n·K) mod M)/M，再減去一個週期的平均（零均值）。
 * 週期 P = M / gcd(K, M)。
 */
export function dsmResidueCode(K: number, M: number, length: number): Float64Array {
  const P = M / gcd(K % M, M)
  let m = 0
  for (let n = 0; n < P; n++) m += (((n * K) % M) + M) % M
  m /= P * M
  const x = new Float64Array(length)
  for (let n = 0; n < length; n++) x[n] = ((((n * K) % M) + M) % M) / M - m
  return x
}
// #endregion

export interface CycloParams {
  /** FCW 小數 = K/M（一階 DSM） */
  K: number
  M: number
  /** GMAC block 長度（ZOH 保持 N 個 sample） */
  N: number
  /** block-rate AR(1) 係數（= 校正 pole p），σ_w² 正規化為 1 */
  p: number
  maxLag: number
}

export interface CycloResult {
  P: number
  L: number
  /** gcd(P, N)：= 1 時時間平均自相關精確分解 */
  g: number
  lags: number[]
  /** 精確時間平均自相關 R̄_δt[m]（σ_w² = 1） */
  exact: number[]
  /** 「獨立平穩」近似 R̄_x[m]·R̄_w[m] */
  factorized: number[]
  rx: number[]
  rw: number[]
  /** max_m |exact − factorized| / exact[0] */
  maxRelErr: number
  /** 一個 L 週期內 E[δt[n]²] = x[n]²（σ_w² = 1）：變異數本身隨 n 週期變化 */
  instVar: number[]
}

// #region core:cycloAutocorr
/**
 * δt[n] = x[n]·δw[⌊n/N⌋]（ZOH，commit latency 0），δw 為 block-rate AR(1)：R_w[ℓ] = p^|ℓ|。
 * 精確時間平均自相關：R̄[m] = (1/L) Σ_{n<L} x[n]x[n+m]·p^|⌊(n+m)/N⌋ − ⌊n/N⌋|，L = lcm(P, N)。
 * 與「x、δw 各自時間平均後相乘」的近似比較（勘誤 E09 的時間平均 PSD 即此近似）。
 */
export function cycloAutocorr({ K, M, N, p, maxLag }: CycloParams): CycloResult {
  const P = M / gcd(K % M, M)
  const L = lcm(P, N)
  const x = dsmResidueCode(K, M, L + maxLag + 1)
  const lags: number[] = []
  const exact: number[] = []
  const rx: number[] = []
  const rw: number[] = []
  const factorized: number[] = []
  for (let m = 0; m <= maxLag; m++) {
    let e = 0
    for (let n = 0; n < L; n++) {
      const dk = Math.floor((n + m) / N) - Math.floor(n / N) // 跨過幾個 block 邊界
      e += x[n] * x[n + m] * Math.pow(p, dk) // ← 差異：x 的相位與 block 邊界一起平均
    }
    let ax = 0
    for (let n = 0; n < P; n++) ax += x[n] * x[n + m]
    let aw = 0
    for (let r = 0; r < N; r++) aw += Math.pow(p, Math.floor((r + m) / N))
    lags.push(m)
    exact.push(e / L)
    rx.push(ax / P)
    rw.push(aw / N)
    factorized.push((ax / P) * (aw / N)) // ← 差異：假設兩者獨立平穩，各自平均再相乘
  }
  const r0 = Math.max(Math.abs(exact[0]), 1e-300)
  let maxRelErr = 0
  for (let m = 0; m <= maxLag; m++) maxRelErr = Math.max(maxRelErr, Math.abs(exact[m] - factorized[m]) / r0)
  const instVar = Array.from(x.subarray(0, Math.min(L, 512)), (v) => v * v)
  return { P, L, g: gcd(P, N), lags, exact, factorized, rx, rw, maxRelErr, instVar }
}
// #endregion

// #region core:zohAutocorr
/**
 * ZOH 係數本身的時間平均自相關（σ_w² = 1）的封閉式：m = qN + m′（0 ≤ m′ < N）
 *   R̄_w[m] = (1 − m′/N)·p^q + (m′/N)·p^{q+1}
 * 一個 block 內的 N 個起點中，有 m′ 個會多跨一個 block 邊界。
 */
export function zohAutocorr(p: number, N: number, m: number): number {
  const q = Math.floor(m / N)
  const mp = m - q * N
  return (1 - mp / N) * Math.pow(p, q) + (mp / N) * Math.pow(p, q + 1) // ← 差異：不必逐點平均，兩項加權即可
}
// #endregion

/** Monte Carlo：真的產生 AR(1) block 雜訊、ZOH、乘上 code，量測時間平均自相關。 */
export function simulateCyclo(P: CycloParams & { seed: number; budget: number }): { lags: number[]; empirical: number[]; samples: number } {
  const { K, M, N, p, maxLag, seed, budget } = P
  const per = M / gcd(K % M, M)
  const L = lcm(per, N)
  const periods = Math.max(1, Math.floor(budget / L))
  const T = periods * L // 取 L 的整數倍：每個 (code 相位, block 相位) 組合被平均到的次數相同
  const nBlocks = Math.ceil((T + maxLag) / N) + 1
  const rng = createRng(seed).fork('cyclo-ar1')
  const w = new Float64Array(nBlocks)
  const drive = Math.sqrt(1 - p * p)
  w[0] = rng.normal()
  for (let k = 1; k < nBlocks; k++) w[k] = p * w[k - 1] + drive * rng.normal()
  const x = dsmResidueCode(K, M, T + maxLag + 1)
  const dt = new Float64Array(T + maxLag + 1)
  for (let n = 0; n < dt.length; n++) dt[n] = x[n] * w[Math.floor(n / N)]
  const lags: number[] = []
  const empirical: number[] = []
  for (let m = 0; m <= maxLag; m++) {
    let acc = 0
    for (let n = 0; n < T; n++) acc += dt[n] * dt[n + m]
    lags.push(m)
    empirical.push(acc / T)
  }
  return { lags, empirical, samples: T }
}

// ═════════════════════════ R3｜Quantization / Limit Cycle ═════════════════════════

export type EfRounding = 'nearest' | 'floor'

// #region core:efQuantizerInt
/**
 * 一階 error-feedback quantizer（規格 §13.4）的**整數**實作：w_H = W/S、r = R/S。
 *   v = W + R[n−1]，y = Q(v/S)，R[n] = v − S·y
 * nearest 為 round-half-up：y = ⌊(2v + S)/(2S)⌋；floor：y = ⌊v/S⌋。
 * 全部是整數運算，不會因浮點誤差翻轉 rounding tie（validation.md 的建議）。
 */
export function efQuantizerInt(W: number, S: number, steps: number, rounding: EfRounding = 'nearest', R0 = 0): { y: number[]; R: number[] } {
  const y: number[] = []
  const R: number[] = []
  let r = R0
  for (let n = 0; n < steps; n++) {
    const v = W + r
    const q = rounding === 'floor' ? Math.floor(v / S) : Math.floor((2 * v + S) / (2 * S))
    r = v - S * q
    y.push(q)
    R.push(r)
  }
  return { y, R }
}
// #endregion

// #region core:efPeriod
/** 理論週期：R[n] ≡ R[−1] + (n+1)·W (mod S)，所以週期 = S / gcd(W mod S, S)。 */
export function efTheoryPeriod(W: number, S: number): number {
  const frac = ((W % S) + S) % S
  return frac === 0 ? 1 : S / gcd(frac, S)
}
// #endregion

/** 量測週期：狀態 R 第一次回到 R[0] 的步數（序列從頭就是純週期）。 */
export function detectStatePeriod(R: number[]): number {
  for (let n = 1; n < R.length; n++) if (R[n] === R[0]) return n
  return Number.NaN
}

export interface EfAnalysis {
  W: number
  S: number
  /** 實際表示的目標 W/S [LSB] */
  represented: number
  period: number
  periodTheory: number
  /** 一個週期的輸出 code */
  cycle: number[]
  cycleMean: number
  /** 一個週期內 (y − w_H)² 的平均（總量化誤差功率，LSB²） */
  errorPower: number
  /** 所有非 DC 譜線的功率和 Σ_{k=1}^{P−1}|Y_k|²/P²（Parseval：應等於 errorPower，因為平均恰為 w_H） */
  linePower: number
  /** 譜線：k·f_u/P（k = 1..P/2），振幅 |Y_k|/P（LSB），依大小排序的前 12 條 */
  topLines: { k: number; fracFu: number; mag: number }[]
  /** P ≤ 512 時的全部譜線（畫 stem 圖用） */
  lines: { fracFu: number; mag: number }[]
  overload: boolean
}

/**
 * 分析常數目標的一階 EF quantizer：
 * mode 'fixed'：w_H 以 F 個小數 bit 表示（S = 2^F，W = round(w_H·S)）；
 * mode 'rational'：w_H = I + num/den（S = den，精確有理數）。
 */
export function analyzeEf(P: { mode: 'fixed' | 'rational'; target: number; fracBits: number; num: number; den: number; rounding: EfRounding; bits: number }): EfAnalysis {
  let W: number
  let S: number
  if (P.mode === 'rational') {
    S = Math.max(1, Math.round(P.den))
    W = Math.floor(P.target) * S + Math.round(P.num)
  } else {
    S = 2 ** Math.max(0, Math.min(20, Math.round(P.fracBits)))
    W = Math.round(P.target * S)
  }
  const periodTheory = efTheoryPeriod(W, S)
  const run = efQuantizerInt(W, S, periodTheory + 1, P.rounding, 0)
  const period = detectStatePeriod(run.R)
  const cycle = run.y.slice(0, Number.isFinite(period) ? period : periodTheory)
  const represented = W / S
  const Pn = cycle.length
  let sum = 0
  let err = 0
  for (const v of cycle) {
    sum += v
    err += (v - represented) * (v - represented)
  }
  const { re, im } = fftReal(cycle)
  const all: { k: number; fracFu: number; mag: number }[] = []
  for (let k = 1; k <= Math.floor(Pn / 2); k++) all.push({ k, fracFu: k / Pn, mag: Math.hypot(re[k], im[k]) / Pn })
  let linePower = 0
  for (let k = 1; k < Pn; k++) linePower += (re[k] * re[k] + im[k] * im[k]) / (Pn * Pn)
  const topLines = [...all].sort((a, b) => b.mag - a.mag).slice(0, 12)
  const lines = Pn <= 512 ? all.map(({ fracFu, mag }) => ({ fracFu, mag })) : []
  const maxCode = 2 ** P.bits - 1
  const overload = cycle.some((v) => v < 0 || v > maxCode)
  return { W, S, represented, period, periodTheory, cycle, cycleMean: sum / Pn, errorPower: err / Pn, linePower, topLines, lines, overload }
}

// ═════════════════════════ R4｜Regularized MIMO update matrix ═════════════════════════

export interface PrecondParams {
  /** 量測（或模型）Jacobian J = ∂E[G]/∂w（方陣） */
  J: Matrix
  /** 收斂因子 γ（0 < γ < 2） */
  gamma: number
  /** 正則化 ε ≥ 0（勘誤 E22：不用 λ） */
  eps: number
  /** GMAC 雜訊 Cov(η) = σ_η²·I */
  sigmaEta2: number
}

export interface PrecondResult {
  /** singular values σ_i（由大到小） */
  sv: number[]
  /** 封閉式 poles p_i = 1 − γσ_i²/(σ_i² + ε)（與 sv 同順序） */
  poles: number[]
  /** 直接由 eig(I + MJ) 算的 poles（由大到小，取實部） */
  polesEig: number[]
  /** 每個 mode 的穩態變異（封閉式） */
  modeVar: number[]
  totalVar: number
  /** Lyapunov 數值解的 trace（無法求解時 null） */
  totalVarLyap: number | null
  slowest: number
  settle: number
  M: Matrix
  /** σ_i = 0 的方向數（不可辨識） */
  nullDirs: number
}

// #region core:regularizedPreconditioner
/**
 * M = −γ(JᵀJ + εI)⁻¹Jᵀ（規格 §10.2；pinvReg 以 SVD 計算）。
 * 在 J = UΣVᵀ 的座標裡每個 mode 互不干擾：
 *   p_i = 1 − γσ_i²/(σ_i² + ε)
 *   Var_i = (γσ_i/(σ_i² + ε))²·σ_η² / (1 − p_i²)
 */
export function regularizedPreconditioner({ J, gamma, eps, sigmaEta2 }: PrecondParams): PrecondResult {
  const n = J.length
  const { S } = svd(J)
  const tol = n * 2.2e-16 * (S[0] ?? 0)
  const gains = S.map((s) => (s <= tol ? 0 : (gamma * s) / (s * s + eps))) // ← 差異：ε 把小 σ_i 的增益壓下來
  const poles = S.map((s, i) => 1 - gains[i] * s)
  const modeVar = poles.map((p, i) => (gains[i] === 0 ? 0 : (gains[i] * gains[i] * sigmaEta2) / (1 - p * p)))
  const M = matScale(pinvReg(J, eps), -gamma)
  const A = matAdd(identity(n), matMul(M, J))
  const polesEig = eigvals(A)
    .map((z) => z.re)
    .sort((a, b) => b - a)
  let totalVarLyap: number | null = null
  try {
    const Q = matScale(matMul(M, transpose(M)), sigmaEta2)
    const Pm = dlyap(A, Q)
    totalVarLyap = Pm.reduce((acc, row, i) => acc + row[i], 0)
  } catch {
    totalVarLyap = null // 有 pole = 1（不可辨識方向）時 I − A⊗A 奇異
  }
  const slowest = poles.reduce((m, p) => Math.max(m, Math.abs(p)), 0)
  return {
    sv: S,
    poles,
    polesEig,
    modeVar,
    totalVar: modeVar.reduce((a, b) => a + b, 0),
    totalVarLyap,
    slowest,
    settle: settle95(slowest),
    M,
    nullDirs: S.filter((s) => s <= tol).length,
  }
}
// #endregion

/** 對照：原始 LMS M = μI 的 poles = eig(I + μJ)（複數，依 |z| 由大到小）。 */
export function scalarLmsPoles(J: Matrix, mu: number): Complex[] {
  return eigvals(matAdd(identity(J.length), matScale(J, mu)))
}

/** ε 掃描：收斂（95% blocks）vs 穩態總變異。 */
export function precondSweep(P: Omit<PrecondParams, 'eps'> & { epsGrid: number[] }): { eps: number[]; settle: number[]; totalVar: number[]; slowest: number[] } {
  const settle: number[] = []
  const totalVar: number[] = []
  const slowest: number[] = []
  for (const eps of P.epsGrid) {
    const r = regularizedPreconditioner({ J: P.J, gamma: P.gamma, eps, sigmaEta2: P.sigmaEta2 })
    settle.push(r.settle)
    totalVar.push(r.totalVar)
    slowest.push(r.slowest)
  }
  return { eps: P.epsGrid, settle, totalVar, slowest }
}

/** Monte Carlo：δ_{k+1} = (I + MJ)δ_k + Mη_k，η ~ N(0, σ_η²I)，量 E‖δ‖²。 */
export function simulatePrecond(P: PrecondParams & { chains: number; blocks: number; seed: number }): { meanSq: number; lo: number; hi: number } {
  const n = P.J.length
  const { M } = regularizedPreconditioner(P)
  const A = matAdd(identity(n), matMul(M, P.J))
  const root = createRng(P.seed)
  const sEta = Math.sqrt(P.sigmaEta2)
  const per: number[] = []
  const burn = 400
  for (let ch = 0; ch < P.chains; ch++) {
    const rng = root.fork(`precond-${ch}`)
    let d = new Array<number>(n).fill(0)
    let acc = 0
    for (let k = 0; k < burn + P.blocks; k++) {
      const eta = Array.from({ length: n }, () => sEta * rng.normal())
      const next = new Array<number>(n).fill(0)
      for (let i = 0; i < n; i++) {
        let v = 0
        for (let j = 0; j < n; j++) v += A[i][j] * d[j] + M[i][j] * eta[j]
        next[i] = v
      }
      d = next
      if (k >= burn) acc += d.reduce((a, v) => a + v * v, 0)
    }
    per.push(acc / P.blocks)
  }
  const ci = meanCI(per)
  return { meanSq: ci.mean, lo: ci.lo, hi: ci.hi }
}

// ═════════════════════════ R5｜Training sequence / E- and D-optimal ═════════════════════════

export interface DesignMetrics {
  det: number
  lambdaMin: number
  lambdaMax: number
  cond: number
  trace: number
}

// #region core:designMetrics
/** 資訊矩陣 R 的設計指標：D-optimal 看 det R，E-optimal 看 λ_min(R)。 */
export function designMetrics(R: Matrix): DesignMetrics {
  const { values } = eigSym(R) // 由大到小
  const lambdaMax = values[0]
  const lambdaMin = values[values.length - 1]
  const det = values.reduce((a, v) => a * v, 1)
  const trace = values.reduce((a, v) => a + v, 0)
  return { det, lambdaMin, lambdaMax, cond: lambdaMin > 0 ? lambdaMax / lambdaMin : Number.POSITIVE_INFINITY, trace }
}
// #endregion

/** gain + offset 兩參數：u = [x, s]ᵀ，x 在 [m − h, m + h] 均勻分布，s 為 offset regressor 的單位尺度。 */
export function uniformCodeR(mean: number, halfWidth: number, scale: number): Matrix {
  const Ex = mean
  const Ex2 = mean * mean + (halfWidth * halfWidth) / 3
  return [
    [Ex2, scale * Ex],
    [scale * Ex, scale * scale],
  ]
}

// #region core:windowLambdaMin
/**
 * 近整數 FCW 的滑動窗口 PE：x[n] = frac(nα + φ0) − ½，u = [x, 1]ᵀ，
 * R_win = (1/N0)·Σ_{窗口} u uᵀ。回傳所有窗口中最小（最差）的 λ_min。
 */
export function windowLambdaMin(alpha: number, N0: number, starts = 48, phase0 = 0.123): { worst: number; best: number } {
  const period = alpha > 0 ? 1 / alpha : Number.POSITIVE_INFINITY
  const span = Number.isFinite(period) ? Math.max(1, Math.ceil(period)) : N0
  const stride = Math.max(1, Math.floor(span / starts))
  let worst = Number.POSITIVE_INFINITY
  let best = 0
  for (let j = 0; j < starts; j++) {
    const n0 = j * stride
    let sx = 0
    let sxx = 0
    for (let n = n0; n < n0 + N0; n++) {
      const t = n * alpha + phase0
      const x = t - Math.floor(t) - 0.5
      sx += x
      sxx += x * x
    }
    const a = sxx / N0 // E[x²]
    const b = sx / N0 // E[x]
    const tr = a + 1
    const det = a - b * b // = 視窗內 Var(x)
    const lmin = (tr - Math.sqrt(Math.max(0, tr * tr - 4 * det))) / 2
    worst = Math.min(worst, lmin)
    best = Math.max(best, lmin)
  }
  return { worst, best }
}
// #endregion

/** 小 α（窗口內沒有 wrap）時最差窗口的漸近式 λ_min ≈ α²(N0² − 1)/15（x̄ → ±½）。 */
export function nearIntegerAsymptote(alpha: number, N0: number): number {
  return (alpha * alpha * (N0 * N0 - 1)) / 15
}

/** 上式反解：最差窗口的 λ_min 剛好等於門檻 λ_t 的 FCW 小數（keep-out 邊界）α_keep = √(15λ_t/(N0² − 1))。 */
export function nearIntegerKeepOut(lambdaT: number, N0: number): number {
  return Math.sqrt((15 * lambdaT) / (N0 * N0 - 1))
}

// ═════════════════════════ R6｜Comparator non-idealities ═════════════════════════

export type NoiseKind = 'gaussian' | 'laplace' | 'uniform' | 'student3' | 'dualDirac'

export interface NoiseSpec {
  kind: NoiseKind
  /** 總 RMS σ_v [fs] */
  sigma: number
  /** dualDirac：deterministic jitter 佔總變異數的比例（0 ≤ ζ_DJ < 1） */
  djFrac?: number
}

function djParts(spec: NoiseSpec): { A: number; srj: number } {
  const f = Math.min(0.99, Math.max(0, spec.djFrac ?? 0))
  return { A: Math.sqrt(f) * spec.sigma, srj: Math.sqrt(1 - f) * spec.sigma }
}

/** 零均值、標準差 σ 的雜訊 CDF F_v(v)。 */
export function noiseCdf(spec: NoiseSpec, v: number): number {
  const s = spec.sigma
  switch (spec.kind) {
    case 'gaussian':
      return normCdf(v / s)
    case 'laplace': {
      const b = s / Math.SQRT2
      return v < 0 ? 0.5 * Math.exp(v / b) : 1 - 0.5 * Math.exp(-v / b)
    }
    case 'uniform': {
      const h = Math.sqrt(3) * s
      return v <= -h ? 0 : v >= h ? 1 : (v + h) / (2 * h)
    }
    case 'student3':
      return studentTCdf((v * Math.sqrt(3)) / s, 3)
    case 'dualDirac': {
      const { A, srj } = djParts(spec)
      return 0.5 * (normCdf((v - A) / srj) + normCdf((v + A) / srj))
    }
  }
}

/** 對應的 PDF f_v(v)。 */
export function noisePdf(spec: NoiseSpec, v: number): number {
  const s = spec.sigma
  switch (spec.kind) {
    case 'gaussian':
      return normPdf(v / s) / s
    case 'laplace': {
      const b = s / Math.SQRT2
      return Math.exp(-Math.abs(v) / b) / (2 * b)
    }
    case 'uniform': {
      const h = Math.sqrt(3) * s
      return Math.abs(v) < h ? 1 / (2 * h) : 0
    }
    case 'student3':
      return (studentTPdf((v * Math.sqrt(3)) / s, 3) * Math.sqrt(3)) / s
    case 'dualDirac': {
      const { A, srj } = djParts(spec)
      return (0.5 * (normPdf((v - A) / srj) + normPdf((v + A) / srj))) / srj
    }
  }
}

/** 由 rng 抽一個雜訊樣本。 */
export function drawNoise(spec: NoiseSpec, rng: { uniform(): number; normal(): number }): number {
  const s = spec.sigma
  switch (spec.kind) {
    case 'gaussian':
      return s * rng.normal()
    case 'laplace': {
      const b = s / Math.SQRT2
      const u = rng.uniform() - 0.5
      return -b * Math.sign(u) * Math.log(1 - 2 * Math.abs(u))
    }
    case 'uniform':
      return Math.sqrt(3) * s * (2 * rng.uniform() - 1)
    case 'student3': {
      const z = rng.normal()
      const chi2 = rng.normal() ** 2 + rng.normal() ** 2 + rng.normal() ** 2
      return ((z / Math.sqrt(chi2 / 3)) * s) / Math.sqrt(3)
    }
    case 'dualDirac': {
      const { A, srj } = djParts(spec)
      return (rng.uniform() < 0.5 ? -A : A) + srj * rng.normal()
    }
  }
}

// #region core:comparatorMean
/** q = sign(s + v − θ)：E[q | s] = 1 − 2F_v(θ − s)，局部斜率 dE[q]/ds = 2f_v(θ − s)。 */
export function comparatorMean(spec: NoiseSpec, s: number, theta = 0): number {
  return 1 - 2 * noiseCdf(spec, theta - s)
}

export function comparatorSlope(spec: NoiseSpec, s: number, theta = 0): number {
  return 2 * noisePdf(spec, theta - s)
}
// #endregion

export interface HysteresisStats {
  /** t₊ = P(−1 → +1)，t₋ = P(+1 → −1) */
  tUp: number
  tDown: number
  mean: number
  /** 記憶因子 ν = 1 − t₊ − t₋（q 的 lag-k 相關 = ν^k） */
  nu: number
  slope: number
  /** 每個 sample 的有效資訊 ℐ = slope²·(1 − ν)/((1 − m²)(1 + ν)) [fs⁻²] */
  info: number
}

// #region core:hysteresisMarkov
/**
 * 遲滯 comparator（門檻 θ ± H/2，依前一次決策而定）在 iid 雜訊下是兩狀態 Markov chain：
 *   t₊ = 1 − F(θ + H/2 − s)，t₋ = F(θ − H/2 − s)
 *   E[q] = (t₊ − t₋)/(t₊ + t₋)，lag-k 相關 ν^k，ν = 1 − t₊ − t₋
 * H = 0 時 t₊ + t₋ = 1、ν = 0，退化成一般 comparator。
 */
export function hysteresisStats(spec: NoiseSpec, s: number, H: number, theta = 0): HysteresisStats {
  const tUp = 1 - noiseCdf(spec, theta + H / 2 - s)
  const tDown = noiseCdf(spec, theta - H / 2 - s)
  const sum = tUp + tDown
  // 有界雜訊（uniform）且 H/2 超出雜訊範圍時永遠不翻轉：chain 卡在初始狀態，沒有資訊
  if (!(sum > 0)) return { tUp, tDown, mean: Number.NaN, nu: 1, slope: Number.NaN, info: 0 }
  const mean = (tUp - tDown) / sum
  const nu = 1 - sum
  const dUp = noisePdf(spec, theta + H / 2 - s) // dt₊/ds
  const dDown = -noisePdf(spec, theta - H / 2 - s) // dt₋/ds
  const slope = (2 * (dUp * tDown - tUp * dDown)) / (sum * sum) // ← 差異：Markov 平穩分布的斜率
  const varFactor = ((1 - mean * mean) * (1 + nu)) / (1 - nu)
  return { tUp, tDown, mean, nu, slope, info: (slope * slope) / varFactor }
}
// #endregion

// #region core:comparatorStep
/** 一般 comparator：tie（輸入恰為門檻）→ +1（規格 §15.2、勘誤 E07）。 */
export function comparatorStep(_prev: 1 | -1, input: number, theta: number): 1 | -1 {
  return input - theta >= 0 ? 1 : -1 // 與前一次決策無關
}
// #endregion

// #region core:hysteresisStep
/** 遲滯 comparator：要越過「對面」的門檻才翻轉。 */
export function hysteresisStep(prev: 1 | -1, input: number, theta: number, H: number): 1 | -1 {
  if (prev > 0) return input < theta - H / 2 ? -1 : 1 // ← 差異：門檻依前一次決策而定
  return input > theta + H / 2 ? 1 : -1 // ← 差異：另一側的門檻
}
// #endregion

/** Monte Carlo：逐 sample 跑（遲滯）comparator，量 E[q|s]（20 批平均的 95% CI）與 lag-1 相關。 */
export function mcComparator(P: { spec: NoiseSpec; theta: number; H: number; sValues: number[]; samples: number; seed: number }): {
  mean: number[]
  lo: number[]
  hi: number[]
  lag1: number[]
} {
  const root = createRng(P.seed)
  const batches = 20
  const perBatch = Math.max(10, Math.floor(P.samples / batches))
  const mean: number[] = []
  const lo: number[] = []
  const hi: number[] = []
  const lag1: number[] = []
  P.sValues.forEach((s, idx) => {
    const rng = root.fork(`cmp-${idx}`)
    let q: 1 | -1 = rng.uniform() < 0.5 ? 1 : -1
    for (let i = 0; i < 200; i++) q = P.H > 0 ? hysteresisStep(q, s + drawNoise(P.spec, rng), P.theta, P.H) : comparatorStep(q, s + drawNoise(P.spec, rng), P.theta)
    const bm: number[] = []
    let sq = 0
    let sqq = 0
    let n = 0
    let prev = q
    for (let b = 0; b < batches; b++) {
      let acc = 0
      for (let i = 0; i < perBatch; i++) {
        const input = s + drawNoise(P.spec, rng)
        q = P.H > 0 ? hysteresisStep(q, input, P.theta, P.H) : comparatorStep(q, input, P.theta)
        acc += q
        sq += q
        sqq += q * prev
        prev = q
        n++
      }
      bm.push(acc / perBatch)
    }
    const ci = meanCI(bm)
    mean.push(ci.mean)
    lo.push(ci.lo)
    hi.push(ci.hi)
    const m = sq / n
    const v = 1 - m * m
    lag1.push(v > 1e-12 ? (sqq / n - m * m) / v : Number.NaN)
  })
  return { mean, lo, hi, lag1 }
}

// ═════════════════════════ R7｜Multirate dual-loop lifting ═════════════════════════

export interface DualLoopParams {
  /** 抽象快迴路狀態 s 的 pole（規格 §8.4） */
  r: number
  b: number
  c: number
  /** LMS 步長（K ≡ 1 的正規化，勘誤 E13） */
  mu: number
  /** 每個 GMAC block 含 N 個快迴路 sample */
  N: number
}

// #region core:liftedDualLoop
/**
 * 多速率提升（lifting）：快迴路每 sample 跑 s_{n+1} = r·s_n + b·δ_k，
 * GMAC 在 block k 平均 G_k = (c/N)Σ_{i<N} s_{kN+i}，再更新 δ_{k+1} = δ_k − μ·G_k。
 * 把一個 block 內的 N 步精確積掉，得到 block rate 的 2×2 矩陣：
 *   A_N = [[ r^N,            b·S_N ],
 *          [ −μc·S_N/N,      1 − μcb·(N − S_N)/(N(1 − r)) ]]，S_N = Σ_{i<N} r^i
 * N = 1 時就是規格 §8.4 的 [[r, b], [−μc, 1]]。
 */
export function liftedDualLoop({ r, b, c: cc, mu, N }: DualLoopParams): Matrix {
  const rN = Math.pow(r, N)
  const nearOne = Math.abs(1 - r) < 1e-12
  const SN = nearOne ? N : (1 - rN) / (1 - r) // Σ_{i<N} r^i
  const inner = nearOne ? (N * (N - 1)) / 2 : (N - SN) / (1 - r) // Σ_{i<N} (1 − r^i)/(1 − r)
  return [
    [rN, b * SN],
    [-(mu * cc * SN) / N, 1 - (mu * cc * b * inner) / N], // ← 差異：一個 block 內 N 步的精確積分
  ]
}
// #endregion

// #region core:multirateSim
/** 逐 sample 的直接模擬（用來驗證 lifted 矩陣）。 */
export function simulateMultirate({ r, b, c: cc, mu, N }: DualLoopParams, blocks: number, s0: number, delta0: number): { delta: Float64Array; s: Float64Array } {
  const delta = new Float64Array(blocks + 1)
  const s = new Float64Array(blocks + 1)
  let x = s0
  let d = delta0
  delta[0] = d
  s[0] = x
  for (let k = 0; k < blocks; k++) {
    let acc = 0
    for (let i = 0; i < N; i++) {
      acc += cc * x // GMAC 累加 c·s_{kN+i}
      x = r * x + b * d // ← 差異：快迴路逐 sample 前進，δ 在 block 內保持不變（ZOH）
    }
    d = d - (mu * acc) / N
    delta[k + 1] = d
    s[k + 1] = x
  }
  return { delta, s }
}
// #endregion

/** quasi-static（時間尺度分離）近似的 pole：s ≈ bδ/(1 − r) ⇒ 1 − μcb/(1 − r)。 */
export function quasiStaticPole({ r, b, c: cc, mu }: DualLoopParams): number {
  return 1 - (mu * cc * b) / (1 - r)
}

/** 2×2 實矩陣的 eigenvalues 與 spectral radius。 */
export function eig2(A: Matrix): { z: Complex[]; rho: number } {
  const tr = A[0][0] + A[1][1]
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0]
  const disc = tr * tr - 4 * det
  let z: Complex[]
  if (disc >= 0) {
    const sq = Math.sqrt(disc)
    z = [c((tr + sq) / 2), c((tr - sq) / 2)]
  } else {
    const sq = Math.sqrt(-disc)
    z = [c(tr / 2, sq / 2), c(tr / 2, -sq / 2)]
  }
  const rho = Math.max(...z.map((v) => Math.hypot(v.re, v.im)))
  return { z, rho }
}

/** μ 掃描：每個 N 的 spectral radius。 */
export function dualLoopSweep(base: Omit<DualLoopParams, 'mu' | 'N'>, Ns: number[], mus: number[]): { mus: number[]; rho: Record<number, number[]>; quasi: number[] } {
  const rho: Record<number, number[]> = {}
  for (const N of Ns) rho[N] = mus.map((mu) => eig2(liftedDualLoop({ ...base, mu, N })).rho)
  const quasi = mus.map((mu) => Math.abs(quasiStaticPole({ ...base, mu, N: 1 })))
  return { mus, rho, quasi }
}

/** 二分法找 ρ(A_N(μ)) = 1 的第一個 μ（0 < μ ≤ muMax）。找不到回傳 NaN。 */
export function dualLoopMuMax(base: Omit<DualLoopParams, 'mu' | 'N'>, N: number, muMax = 20): number {
  const f = (mu: number) => eig2(liftedDualLoop({ ...base, mu, N })).rho - 1
  const grid = 2000
  let prev = 1e-9
  if (f(prev) >= 0) return Number.NaN
  for (let i = 1; i <= grid; i++) {
    const mu = (i / grid) * muMax
    if (f(mu) >= 0) {
      let lo = prev
      let hi = mu
      for (let it = 0; it < 80; it++) {
        const mid = 0.5 * (lo + hi)
        if (f(mid) >= 0) hi = mid
        else lo = mid
      }
      return 0.5 * (lo + hi)
    }
    prev = mu
  }
  return Number.NaN
}

// ═════════════════════════ R8｜Tracking: LMS vs Kalman ═════════════════════════

// #region core:trackingVariance
/**
 * Random-walk 目標 w*_{k+1} = w*_k + ζ_k（Var ζ = σ_ζ²），等效量測雜訊 σ_y² = σ_η²/K²：
 *   e_{k+1} = (1 − g)e_k − μη_k + ζ_k  ⇒  V(g) = (σ_ζ² + g²σ_y²)/(g(2 − g))
 */
export function trackingVariance(g: number, sz2: number, sy2: number): number {
  if (!(g > 0 && g < 2)) return Number.POSITIVE_INFINITY
  return (sz2 + g * g * sy2) / (g * (2 - g))
}
// #endregion

// #region core:kalmanSteady
/** dV/dg = 0 ⇒ σ_y²g² + σ_ζ²g − σ_ζ² = 0；穩態 Kalman：P⁻ = (σ_ζ² + √(σ_ζ⁴ + 4σ_ζ²σ_y²))/2，增益 P⁻/(P⁻ + σ_y²)。 */
export function optimalTrackingGain(sz2: number, sy2: number): number {
  if (sy2 <= 0) return 1
  return (Math.sqrt(sz2 * sz2 + 4 * sz2 * sy2) - sz2) / (2 * sy2)
}

export function kalmanSteady(sz2: number, sy2: number): { Pprior: number; gain: number } {
  const Pprior = (sz2 + Math.sqrt(sz2 * sz2 + 4 * sz2 * sy2)) / 2
  return { Pprior, gain: Pprior / (Pprior + sy2) }
}
// #endregion

// #region core:lmsTrackStep
/** 固定步長 LMS（g = μK 為常數）。y = 估計 w* 的一次量測（= w + G/K）。 */
export function lmsTrackStep(w: number, y: number, g: number): number {
  return w + g * (y - w) // ← 差異：增益 g 是固定的設計常數
}
// #endregion

// #region core:kalmanTrackStep
/** Scalar Kalman：同一個更新式，但增益每步由誤差變異數 P 算出。 */
export function kalmanTrackStep(w: number, P: number, y: number, sz2: number, sy2: number): { w: number; P: number } {
  const Pp = P + sz2 // 預測：random walk 讓不確定度變大
  const k = Pp / (Pp + sy2) // ← 差異：增益不是常數，而是 P⁻/(P⁻ + σ_y²)
  return { w: w + k * (y - w), P: (1 - k) * Pp }
}
// #endregion

/** Monte Carlo：固定增益 g 的 tracking，量穩態 E[(w* − w)²]（更新前的 prior 誤差）。 */
export function simulateTracking(P: { g: number; sz2: number; sy2: number; chains: number; blocks: number; seed: number }): {
  meanSq: number
  lo: number
  hi: number
  burnIn: number
  /** 誤差遞迴 e_{k+1} = (1 − g)e_k + … 的時間常數 τ ≈ 1/min(g, 2 − g)（blocks） */
  tauBlocks: number
  /** burn-in ≥ 5τ？否則從 e = 0 出發還沒到穩態 */
  burnInAdequate: boolean
} {
  const root = createRng(P.seed)
  const sz = Math.sqrt(P.sz2)
  const sy = Math.sqrt(P.sy2)
  const tauBlocks = 1 / Math.max(1e-9, Math.min(P.g, 2 - P.g))
  const burn = Math.min(MC_BURN_CAP, Math.ceil(20 * tauBlocks))
  const per: number[] = []
  for (let ch = 0; ch < P.chains; ch++) {
    const rng = root.fork(`track-${ch}`)
    let wStar = 0
    let w = 0
    let acc = 0
    for (let k = 0; k < burn + P.blocks; k++) {
      if (k >= burn) acc += (wStar - w) * (wStar - w)
      const y = wStar + sy * rng.normal()
      w = lmsTrackStep(w, y, P.g)
      wStar += sz * rng.normal()
    }
    per.push(acc / P.blocks)
  }
  const ci = meanCI(per)
  return { meanSq: ci.mean, lo: ci.lo, hi: ci.hi, burnIn: burn, tauBlocks, burnInAdequate: burn >= 5 * tauBlocks }
}

// ═════════════════════════ R9｜Bit-true accumulator ═════════════════════════

// #region core:wrap
/** two's complement wrap 到 bits 位元：結果落在 [−2^{bits−1}, 2^{bits−1} − 1]。 */
export function wrapTwos(v: number, bits: number): number {
  const m = 2 ** bits
  const h = m / 2
  return ((((v + h) % m) + m) % m) - h // ← 差異：溢位時繞回（符號可能翻轉）
}
// #endregion

// #region core:saturate
/** saturate（clip）到同樣的範圍。 */
export function saturateTwos(v: number, bits: number): number {
  const h = 2 ** (bits - 1)
  return Math.min(h - 1, Math.max(-h, v)) // ← 差異：溢位時卡在邊界（符號保留）
}
// #endregion

export interface AccBits {
  /** |q·x| 的最大值 */
  maxProduct: number
  maxSum: number
  minSum: number
  bitsRequired: number
}

// #region core:accumulatorBits
/**
 * q ∈ {±1}、x 為 W_x-bit two's complement code，N 筆累加需要的 signed accumulator 位寬。
 * allowMostNegative：x 可取 −2^{W_x−1}，則 q = −1 時乘積 = +2^{W_x−1}（比正最大值多 1）。
 */
export function accumulatorBits(codeBits: number, N: number, allowMostNegative: boolean): AccBits {
  const top = 2 ** (codeBits - 1)
  const maxProduct = allowMostNegative ? top : top - 1
  const maxSum = N * maxProduct
  const minSum = -N * (allowMostNegative ? top : top - 1)
  let bits = 1
  while (!(maxSum <= 2 ** (bits - 1) - 1 && -minSum <= 2 ** (bits - 1))) bits++
  return { maxProduct, maxSum, minSum, bitsRequired: bits }
}
// #endregion

/**
 * 最壞情況（每筆乘積都是 +max|q·x|）下，accBits-bit signed 累加器「不溢位」最多能累加幾筆：
 *   n_safe = ⌊(2^{accBits−1} − 1)/max|q·x|⌋；第一次溢位發生在第 n_safe + 1 筆（若 n_safe ≥ N 則整個 block 都不溢位）。
 */
export function worstCaseSafeCount(codeBits: number, accBits: number, allowMostNegative: boolean): number {
  const top = 2 ** (codeBits - 1)
  const maxProduct = allowMostNegative ? top : top - 1
  return Math.floor((2 ** (accBits - 1) - 1) / maxProduct)
}

/** 最壞情況（所有乘積同號且最大）逐筆累加，分別用 wrap 與 saturate。 */
export function worstCaseAccumulate(codeBits: number, N: number, accBits: number, allowMostNegative: boolean): {
  trueSum: number
  wrapped: number
  saturated: number
  firstOverflowAt: number | null
} {
  const { maxProduct } = accumulatorBits(codeBits, N, allowMostNegative)
  let w = 0
  let s = 0
  let first: number | null = null
  const hi = 2 ** (accBits - 1) - 1
  for (let n = 1; n <= N; n++) {
    w = wrapTwos(w + maxProduct, accBits)
    s = saturateTwos(s + maxProduct, accBits)
    if (first === null && n * maxProduct > hi) first = n
  }
  return { trueSum: N * maxProduct, wrapped: w, saturated: s, firstOverflowAt: first }
}

// ═════════════════════════ R10｜Inverse design（spec → N, μ） ═════════════════════════

/** T13 的參考值 σ_w [fs]（golden/vectors/T13.json 的 expected.sigma_w_fs；model.test.ts 以 golden 檔核對這個常數）。 */
export const T13_SIGMA_W_FS = 0.3991861429909288

export interface InverseDesignParams {
  /** comparator 前雜訊 σ_v [fs] */
  sigmaV: number
  /** code 相關 C（正規化 code 時無因次） */
  C: number
  /** comparator 取樣率 f_s [Hz] */
  fs: number
  /** 規格：係數雜訊上限 σ_w,max [fs] */
  sigmaWMax: number
  /** 規格：校正時間上限 T_max [s] */
  tMax: number
  /** 平均誤差需縮到 ε·|δ0|（相對比例，勘誤 E16） */
  eps: number
  /** 初始誤差 |δ0| [fs]（sign-LMS 每 block 最多走 μ：slew 限制） */
  delta0: number
  /** PM 下限 [deg]（一階 L = g/(z − 1)：g ≤ 2cos PM） */
  pmMinDeg: number
  log2Nmin: number
  log2Nmax: number
}

export interface InverseDesignRow {
  N: number
  fu: number
  Bmax: number
  gTime: number
  gSlew: number
  gLo: number
  gVar: number
  gPm: number
  gHi: number
  feasible: boolean
  muLo: number
  muHi: number
  sigmaWAtLo: number
  sigmaWContinuous: number
  /** 失敗原因（可行時為空字串；`$…$` 內為 KaTeX） */
  reason: string
}

// #region core:inverseDesign
/**
 * 由規格反推 (N, μ) 的可行區間（單一參數、線性一階模型、x = ±1、σ_η² = 1/N）。
 *   下界：時間 (1 − g)^{B_max} ≤ ε；slew μ·B_max ≥ |δ0|
 *   上界：σ_w² = g/(K²N(2 − g)) ≤ σ_w,max²；PM：g ≤ 2cos PM_min
 */
export function inverseDesign(P: InverseDesignParams): {
  K: number
  rows: InverseDesignRow[]
  floorMany: number
  floorOneShot: number
  best: InverseDesignRow | null
} {
  const K = (Math.sqrt(2 / Math.PI) / P.sigmaV) * P.C // K = K_q·C [fs⁻¹]
  const Lg = Math.log(1 / P.eps)
  const total = P.fs * P.tMax // 總比較次數
  const gPm = 2 * Math.cos((P.pmMinDeg * Math.PI) / 180)
  const rows: InverseDesignRow[] = []
  for (let e = P.log2Nmin; e <= P.log2Nmax; e++) {
    const N = 2 ** e
    const Bmax = floorTol(total / N) // 可以更新幾次（總比較次數是整數，吸收 f_s·T_max 的浮點捨入）
    const X = P.sigmaWMax * P.sigmaWMax * K * K * N
    const gVar = (2 * X) / (1 + X)
    const gTime = Bmax >= 1 ? 1 - Math.pow(P.eps, 1 / Bmax) : Number.POSITIVE_INFINITY
    const gSlew = Bmax >= 1 ? (K * Math.abs(P.delta0)) / Bmax : Number.POSITIVE_INFINITY
    const gLo = Math.max(gTime, gSlew)
    const gHi = Math.min(gVar, gPm, 2)
    const feasible = Bmax >= 1 && gLo <= gHi
    const y = (N * Lg) / (2 * total)
    const sigmaWContinuous = Math.sqrt((Lg / (2 * K * K * total)) * (Math.tanh(y) / y))
    const sigmaWAtLo = Number.isFinite(gLo) && gLo < 2 ? Math.sqrt(gLo / (K * K * N * (2 - gLo))) : Number.NaN
    let reason = ''
    // 失敗原因是給頁面顯示的字串：$…$ 內為 KaTeX
    if (Bmax < 1) reason = String.raw`$N>f_sT_{\max}$：一個 block 都跑不完`
    else if (!feasible) {
      if (gLo === gSlew && gSlew > gHi) reason = String.raw`slew：$\mu B_{\max}<|\delta_0|$，sign-LMS 走不到`
      else if (gLo > gVar) reason = String.raw`時間下界超過雜訊上界：$\sigma_{w,\max}$ 太嚴或 $T_{\max}$ 太短`
      else reason = '下界超過 PM 上界'
    }
    rows.push({ N, fu: P.fs / N, Bmax, gTime, gSlew, gLo, gVar, gPm, gHi, feasible, muLo: gLo / K, muHi: gHi / K, sigmaWAtLo, sigmaWContinuous, reason })
  }
  const feasibleRows = rows.filter((r) => r.feasible)
  const best = feasibleRows.length ? feasibleRows.reduce((a, r) => (r.sigmaWAtLo < a.sigmaWAtLo ? r : a)) : null
  return {
    K,
    rows,
    floorMany: Math.sqrt(Lg / (2 * K * K * total)), // ← 多 block、固定 μ 的極限
    floorOneShot: 1 / (K * Math.sqrt(total)), // 一次平均全部樣本（線性化）
    best,
  }
}
// #endregion

// ═════════════════════════ SSPLL｜Re{H_PD} 與更新極性 ═════════════════════════

export type LoopKind = 'type1' | 'type2'

export interface LoopSpec {
  kind: LoopKind
  /** Type-I 迴路增益 K_L（L = K_L z^{−(1+d)}/(1 − z⁻¹)） */
  KL: number
  /** Type-II（pll.ts designDtLoop）：ζ 與 ω_nT_s */
  zeta: number
  wnTs: number
  /** 額外 loop latency d [samples] */
  d: number
}

export interface LoopTransfer {
  L: { b: number[]; a: number[] }
  Hpd: { b: number[]; a: number[] }
  Kp: number
  Ki: number
  spectralRadius: number
  stable: boolean
  /** designDtLoop 的警告（例如 ω_nT_s 太大，E44） */
  warnings: string[]
}

/** 建立迴路：Type-I 自行組 b/a；Type-II 用共用的 designDtLoop（pll.ts，唯讀使用）。 */
export function loopTransfer(spec: LoopSpec): LoopTransfer {
  if (spec.kind === 'type2') {
    const dz = designDtLoop({ wnTs: spec.wnTs, zeta: spec.zeta, loopDelay: spec.d })
    return { L: dz.L, Hpd: dz.Hpd, Kp: dz.Kp, Ki: dz.Ki, spectralRadius: dz.spectralRadius, stable: dz.stable, warnings: dz.warnings }
  }
  const d = spec.d
  const bL = new Array<number>(d + 2).fill(0)
  bL[d + 1] = spec.KL
  const aL = [1, -1]
  // H_PD = (1 − z⁻¹) / ((1 − z⁻¹) + K_L z^{−(1+d)})
  const n = Math.max(2, d + 2)
  const num = new Array<number>(n).fill(0)
  num[0] = 1
  num[1] = -1
  const den = num.slice()
  den[d + 1] += spec.KL
  // 穩定性：特徵多項式 den（z⁻¹ 升冪）乘 z^{n−1} 的根
  const roots = eigvals(companion(den))
  const rho = roots.reduce((m, z) => Math.max(m, Math.hypot(z.re, z.im)), 0)
  return { L: { b: bL, a: aL }, Hpd: { b: num, a: den }, Kp: spec.KL, Ki: 0, spectralRadius: rho, stable: rho < 1, warnings: [] }
}

/** z⁻¹ 升冪多項式 [1, a1, …, an] 的 companion 矩陣（根 = 1 + Σ a_k z^{−k} = 0 的 z）。 */
function companion(a: number[]): Matrix {
  const n = a.length - 1
  if (n < 1) return [[0]]
  const C = zeros(n, n)
  for (let j = 0; j < n; j++) C[0][j] = -a[j + 1] / a[0]
  for (let i = 1; i < n; i++) C[i][i - 1] = 1
  return C
}

/** 由 (K_p, K_i) 反推 designDtLoop 的 (ζ, ω_nT_s)：K_p = 2ζω_nT_s、K_i = (ω_nT_s)²。 */
export function zetaWnFromKpKi(Kp: number, Ki: number): { zeta: number; wnTs: number } {
  const wnTs = Math.sqrt(Ki)
  return { zeta: Kp / (2 * wnTs), wnTs }
}

export interface ClosedLoopSummary {
  /** T = L/(1 + L) = 1 − H_PD 的 −3 dB 頻寬（Hz；找不到時 NaN） */
  f3dB: number
  /** |T| 的最大值（dB）與所在頻率（Hz）；0 dB 表示沒有 peaking */
  peakDb: number
  fPeak: number
  /** |L| = 1 的頻率（Hz）與 phase margin（deg） */
  fCross: number
  pmDeg: number
}

// #region core:closedLoopSummary
/**
 * 主迴路的閉迴路指標（全部在 DT 計算）：
 *   |T(e^{jΩ})|² = ½ 的第一個 Ω → −3 dB 頻寬；max|T| → peaking；|L| = 1 處的 180° + ∠L → PM。
 * 反號帶（Re H_PD < 0 ⇔ Re T > 1）一定落在 |T| > 1 的 peaking 區內，所以 peaking = 0 dB 的迴路不會反號。
 */
export function closedLoopSummary(lt: LoopTransfer, fRef: number, points = 4096): ClosedLoopSummary {
  const tMag2 = (om: number) => {
    const h = hpdAt(lt.Hpd, om)
    return (1 - h.re) * (1 - h.re) + h.im * h.im // |T|² = |1 − H_PD|²
  }
  const lAt = (om: number) => freqz(lt.L.b, lt.L.a, [om])[0]
  const bisect = (f: (om: number) => number, lo: number, hi: number) => {
    let a = lo
    let b = hi
    for (let it = 0; it < 60; it++) {
      const m = 0.5 * (a + b)
      if (f(m) > 0) a = m
      else b = m
    }
    return 0.5 * (a + b)
  }
  let f3dB = Number.NaN
  let fCross = Number.NaN
  let pmDeg = Number.NaN
  let peak2 = 1
  let omPeak = 0
  let prevOm = Math.PI / points
  let prevT = tMag2(prevOm)
  let prevL = cAbs2(lAt(prevOm))
  for (let i = 2; i <= points; i++) {
    const om = (Math.PI * i) / points
    const t2 = tMag2(om)
    const l2 = cAbs2(lAt(om))
    if (t2 > peak2) {
      peak2 = t2
      omPeak = om
    }
    if (Number.isNaN(f3dB) && prevT >= 0.5 && t2 < 0.5) f3dB = (bisect((x) => tMag2(x) - 0.5, prevOm, om) * fRef) / (2 * Math.PI)
    if (Number.isNaN(fCross) && prevL >= 1 && l2 < 1) {
      const omC = bisect((x) => cAbs2(lAt(x)) - 1, prevOm, om)
      const L = lAt(omC)
      fCross = (omC * fRef) / (2 * Math.PI)
      let ph = (Math.atan2(L.im, L.re) * 180) / Math.PI // (−180°, 180°]
      if (ph > 0) ph -= 360 // 迴路相位落在 (−360°, 0°]
      pmDeg = 180 + ph
    }
    prevOm = om
    prevT = t2
    prevL = l2
  }
  return { f3dB, peakDb: 10 * Math.log10(peak2), fPeak: (omPeak * fRef) / (2 * Math.PI), fCross, pmDeg }
}
// #endregion

// #region core:reHpdIdentity
/** Re{H_PD} = Re{1/(1 + L)} = (1 + Re L)/|1 + L|²：符號只由 1 + Re L 決定。 */
export function reHpdFromL(L: Complex): number {
  return (1 + L.re) / cAbs2(cAdd(c(1), L))
}
// #endregion

export interface PolarityScan {
  f: Float64Array
  reH: Float64Array
  /** 由 L 經恆等式算出的 Re H（交叉驗證） */
  reHIdentity: Float64Array
  phaseDeg: Float64Array
  /** 低頻漸近式：Type-II −Ω²/K_i；Type-I (Ω²/K_L²)(1 − K_L(d + ½)) */
  asym: Float64Array
  /** Re H < 0 的頻帶 [lo, hi]（Hz；lo = 0 代表從 DC 開始） */
  bands: [number, number][]
  minRe: number
  fAtMin: number
  identityMaxErr: number
  /** Type-II、d = 0 的封閉式邊界（Hz）；不適用時 null */
  closedFormEdge: number | null
}

function hpdAt(H: { b: number[]; a: number[] }, om: number): Complex {
  return freqz(H.b, H.a, [om])[0]
}

/** 掃描 Re{H_PD}(f)，找出反號帶（f_ref 為 PD 取樣率）。 */
export function polarityScan(spec: LoopSpec, fRef: number, points = 1600, fMinRatio = 1e-4): PolarityScan {
  const lt = loopTransfer(spec)
  const omegas = new Float64Array(points)
  const f = new Float64Array(points)
  const lmin = Math.log10(fMinRatio)
  const lmax = Math.log10(0.5)
  for (let i = 0; i < points; i++) {
    const fr = 10 ** (lmin + ((lmax - lmin) * i) / (points - 1))
    f[i] = fr * fRef
    omegas[i] = 2 * Math.PI * fr
  }
  const H = freqz(lt.Hpd.b, lt.Hpd.a, omegas)
  const L = freqz(lt.L.b, lt.L.a, omegas)
  const reH = new Float64Array(points)
  const reHIdentity = new Float64Array(points)
  const phaseDeg = new Float64Array(points)
  const asym = new Float64Array(points)
  let identityMaxErr = 0
  let minRe = Number.POSITIVE_INFINITY
  let fAtMin = Number.NaN
  for (let i = 0; i < points; i++) {
    reH[i] = H[i].re
    reHIdentity[i] = reHpdFromL(L[i])
    identityMaxErr = Math.max(identityMaxErr, Math.abs(reH[i] - reHIdentity[i]))
    phaseDeg[i] = (Math.atan2(H[i].im, H[i].re) * 180) / Math.PI
    const om = omegas[i]
    asym[i] = spec.kind === 'type2' ? -(om * om) / lt.Ki : ((om * om) / (spec.KL * spec.KL)) * (1 - spec.KL * (spec.d + 0.5))
    if (reH[i] < minRe) {
      minRe = reH[i]
      fAtMin = f[i]
    }
  }
  // 反號帶：在格點上找符號變化，再用二分法精修邊界
  const reAt = (om: number) => hpdAt(lt.Hpd, om).re
  const refine = (lo: number, hi: number) => {
    let a = lo
    let b = hi
    const sa = Math.sign(reAt(a))
    for (let it = 0; it < 60; it++) {
      const m = 0.5 * (a + b)
      if (Math.sign(reAt(m)) === sa) a = m
      else b = m
    }
    return 0.5 * (a + b)
  }
  const bands: [number, number][] = []
  let start: number | null = reH[0] < 0 ? 0 : null
  for (let i = 1; i < points; i++) {
    if (reH[i - 1] >= 0 && reH[i] < 0) start = (refine(omegas[i - 1], omegas[i]) * fRef) / (2 * Math.PI)
    if (reH[i - 1] < 0 && reH[i] >= 0 && start !== null) {
      bands.push([start, (refine(omegas[i - 1], omegas[i]) * fRef) / (2 * Math.PI)])
      start = null
    }
  }
  if (start !== null) bands.push([start, f[points - 1]])
  let closedFormEdge: number | null = null
  if (spec.kind === 'type2' && spec.d === 0) {
    const arg = lt.Ki / (2 * (2 - lt.Kp))
    if (arg > 0 && arg <= 1) closedFormEdge = (fRef / Math.PI) * Math.asin(Math.sqrt(arg))
  }
  return { f, reH, reHIdentity, phaseDeg, asym, bands, minRe, fAtMin, identityMaxErr, closedFormEdge }
}

// #region core:polarityC
/**
 * raw-x GMAC 的相關 C = E[x·(h_PD * x)] = Σ_k h[k]·R_x[k]：
 *   白色 code：C = h[0]；AR(1) code（R_x[k] = β^|k|）：C = H_PD(z)|_{z⁻¹=β}；
 *   單頻 code A cos(Ω₀n)：C = (A²/2)·Re H_PD(e^{jΩ₀})。
 */
export function cWhite(H: { b: number[]; a: number[] }): number {
  return impulseResponse(H.b, H.a, 1)[0]
}

export function cAr1(H: { b: number[]; a: number[] }, beta: number): number {
  return polyAscAt(H.b, beta) / polyAscAt(H.a, beta)
}

export function cTone(H: { b: number[]; a: number[] }, omega0: number, A = 1): number {
  return ((A * A) / 2) * hpdAt(H, omega0).re
}
// #endregion

/** 白色 code 的 C 用頻域積分再算一次：(1/π)∫_0^π Re H dΩ（梯形法），應等於 h[0]。 */
export function cWhiteByIntegral(H: { b: number[]; a: number[] }, n = 8192): number {
  const om = Array.from({ length: n + 1 }, (_, i) => (Math.PI * i) / n)
  const v = freqz(H.b, H.a, om).map((z) => z.re)
  let acc = 0
  for (let i = 0; i < n; i++) acc += 0.5 * (v[i] + v[i + 1]) * (Math.PI / n)
  return acc / Math.PI
}

/** 直接以 impulse response 累加 Σ h[k] β^k（交叉驗證 cAr1）。 */
export function cAr1BySum(H: { b: number[]; a: number[] }, beta: number, len = 20000): number {
  const h = impulseResponse(H.b, H.a, len)
  let acc = 0
  let pw = 1
  for (let k = 0; k < len; k++) {
    acc += h[k] * pw
    pw *= beta
  }
  return acc
}

// ───────────── SSPLL：8 相 PMUX（PHOS）與 input DTC（GOS）的 regressor ─────────────

/** mode-1 regressor 的基波權重 W₁ = 64·sin²(π/8)/π² ≈ 0.9496（階梯化複指數的 Fourier 係數平方）。 */
export const PMUX_W1 = (64 * Math.sin(Math.PI / 8) ** 2) / Math.PI ** 2

export interface PmuxLine {
  /** 譜線頻率（cycles/sample，折到 [0, ½]） */
  fNorm: number
  /** 該線佔 mode-1 regressor 功率的比例（全部加起來 = 1） */
  weight: number
  reH: number
  /** weight × Re H_PD */
  contribution: number
}

export interface PmuxKappa {
  /** α = j/Q 化簡後的分母；8 ∤ Q_red 時 PHOS 的平均更新矩陣不是 circulant */
  Qred: number
  circulant: boolean
  /** PHOS mode-1 的正規化斜率 κ₁ = Σ(線功率)·Re H_PD（H ≡ 1 時為 1；< 0 ⇒ 反號） */
  kappaPhos1: number
  /** mode-1 基波（PMUX 旋轉頻率）的權重，Q → ∞ 時 → W₁ */
  w1: number
  /** 權重最大的 6 條譜線 */
  lines: PmuxLine[]
  /** GOS：C = ⟨ρ·(h_PD * ρ)⟩ 與 12C（ρ 均勻分布時 Var ρ = 1/12；H ≡ 1 時 12C ≈ 1） */
  cGos: number
  twelveCGos: number
}

/** 一個週期的 DFT 線功率（只留非零的線）；只與 (j, Q) 有關、與迴路無關。 */
export interface PmuxSpectra {
  /** PHOS mode-1 regressor s₁[n] 的非零譜線：bin 索引 k（頻率 k/Q cycles/sample）與功率（總和 = 1） */
  kPhos: Int32Array
  wPhos: Float64Array
  /** GOS regressor ρ[n] 的非零譜線（不含 DC）：bin 索引與功率（總和 = Var ρ） */
  kGos: Int32Array
  wGos: Float64Array
}

/** 理論上為零的譜線在 FFT 後只剩捨入雜訊（~1e-30）；低於此值的線不存、不加（對 κ 的影響 < 1e-16）。 */
const LINE_EPS = 1e-24
const PMUX_CACHE = new Map<string, PmuxSpectra>()
const PMUX_CACHE_MAX = 192

// #region core:pmuxKappa
/**
 * 使用者的架構：分數累加器 φ[n] = frac(nα)；PMUX 相位索引 p[n] = ⌊8φ[n]⌋（PHOS 的 one-hot regressor），
 * DTC 細部殘差 ρ[n] = 8φ[n] − p[n] ∈ [0, 1)（GOS 的 regressor）。
 * α = j/Q 時兩者都以 Q 為週期：一個週期的 DFT 給出每條譜線的功率，raw-x GMAC 的平均斜率就是
 *   κ = Σ_k（第 k 條線的功率）·Re H_PD(e^{j2πk/Q})
 * PHOS 取 mode-1 regressor s₁[n] = e^{−j2πp[n]/8}（|s₁| = 1，功率和 = 1）；GOS 取 ρ 本身（DC 線被 H_PD(1) = 0 消掉）。
 */
export function pmuxSpectra(j: number, Q: number): PmuxSpectra {
  const re1 = new Float64Array(Q)
  const im1 = new Float64Array(Q)
  const reR = new Float64Array(Q)
  const imR = new Float64Array(Q)
  const step = ((j % Q) + Q) % Q
  for (let n = 0; n < Q; n++) {
    const acc = (n * step) % Q // 整數累加器：φ[n] = acc/Q
    const ph = Math.floor((8 * acc) / Q) // PMUX 相位索引 p[n] ∈ {0,…,7}
    re1[n] = Math.cos((2 * Math.PI * ph) / 8) // ← 差異：PHOS 的 mode-1 regressor（階梯化的旋轉）
    im1[n] = -Math.sin((2 * Math.PI * ph) / 8)
    reR[n] = (8 * acc - ph * Q) / Q // ← 差異：GOS 的 regressor（鋸齒 ρ[n]）
  }
  fft(re1, im1)
  fft(reR, imR)
  const kPhos: number[] = []
  const wPhos: number[] = []
  const kGos: number[] = []
  const wGos: number[] = []
  for (let k = 0; k < Q; k++) {
    const w1 = (re1[k] * re1[k] + im1[k] * im1[k]) / (Q * Q) // 第 k 條線的功率 |S₁[k]|²/Q²
    if (w1 > LINE_EPS) {
      kPhos.push(k)
      wPhos.push(w1)
    }
    const wr = (reR[k] * reR[k] + imR[k] * imR[k]) / (Q * Q)
    if (k > 0 && wr > LINE_EPS) {
      kGos.push(k)
      wGos.push(wr)
    }
  }
  return { kPhos: Int32Array.from(kPhos), wPhos: Float64Array.from(wPhos), kGos: Int32Array.from(kGos), wGos: Float64Array.from(wGos) }
}

export function pmuxKappa(H: { b: number[]; a: number[] }, j: number, Q: number, reHGrid?: ArrayLike<number>): PmuxKappa {
  const sp = pmuxSpectraCached(j, Q) // 線功率與迴路無關：掃很多個迴路參數時只算一次
  // Re H_PD 在 Ω_k = 2πk/Q 的值（掃很多個 j 時可由呼叫端先算好傳進來）
  const reH = reHGrid ?? hpdReGrid(H, Q)
  let kappaPhos1 = 0
  const all: PmuxLine[] = []
  for (let i = 0; i < sp.kPhos.length; i++) {
    const k = sp.kPhos[i]
    const w = sp.wPhos[i]
    kappaPhos1 += w * reH[k]
    if (w > 1e-9) all.push({ fNorm: Math.min(k, Q - k) / Q, weight: w, reH: reH[k], contribution: w * reH[k] })
  }
  let cGos = 0
  for (let i = 0; i < sp.kGos.length; i++) cGos += sp.wGos[i] * reH[sp.kGos[i]]
  all.sort((a, b) => b.weight - a.weight)
  const Qred = Q / gcd(((j % Q) + Q) % Q, Q)
  return { Qred, circulant: Qred % 8 === 0, kappaPhos1, w1: all[0]?.weight ?? Number.NaN, lines: all.slice(0, 6), cGos, twelveCGos: 12 * cGos }
}
// #endregion

/** pmuxSpectra 的小型快取（每筆約 12 kB；超過上限時丟掉最舊的一筆）。純函式的結果快取，不影響可重現性。 */
export function pmuxSpectraCached(j: number, Q: number): PmuxSpectra {
  const key = `${Q}:${((j % Q) + Q) % Q}`
  const hit = PMUX_CACHE.get(key)
  if (hit) return hit
  const sp = pmuxSpectra(j, Q)
  if (PMUX_CACHE.size >= PMUX_CACHE_MAX) {
    const oldest = PMUX_CACHE.keys().next().value
    if (oldest !== undefined) PMUX_CACHE.delete(oldest)
  }
  PMUX_CACHE.set(key, sp)
  return sp
}

/** Re H_PD(e^{j2πk/Q})，k = 0…Q−1（k = 0 為 DC：Type-I / II 時恰為 0）。 */
export function hpdReGrid(H: { b: number[]; a: number[] }, Q: number): Float64Array {
  const om = Float64Array.from({ length: Q }, (_, k) => (2 * Math.PI * k) / Q)
  return Float64Array.from(freqz(H.b, H.a, om), (z) => z.re)
}

// #region core:pmuxSureBand
/**
 * mode-1 的嚴格界限：κ₁ ≤ W₁·Re H(αf_ref) + (1 − W₁)·max Re H。
 * 上界 < 0 ⇔ Re H(αf_ref) < −(1 − W₁)·max Re H / W₁ ⇒ 不管其餘 5% 的功率落在哪裡，PHOS mode-1 一定反號。
 */
export function pmuxSureBand(H: { b: number[]; a: number[] }, fRef: number, points = 8192): { maxRe: number; threshold: number; band: [number, number] | null } {
  const reAt = (om: number) => hpdAt(H, om).re
  const om = Float64Array.from({ length: points }, (_, i) => (Math.PI * (i + 1)) / points)
  const re = freqz(H.b, H.a, om).map((z) => z.re)
  const maxRe = re.reduce((m, v) => Math.max(m, v), Number.NEGATIVE_INFINITY)
  const threshold = (-(1 - PMUX_W1) * maxRe) / PMUX_W1
  const cross = (lo: number, hi: number) => {
    let a = lo
    let b = hi
    const sa = Math.sign(reAt(a) - threshold)
    for (let it = 0; it < 60; it++) {
      const m = 0.5 * (a + b)
      if (Math.sign(reAt(m) - threshold) === sa) a = m
      else b = m
    }
    return (0.5 * (a + b) * fRef) / (2 * Math.PI)
  }
  let lo: number | null = re[0] < threshold ? 0 : null
  for (let i = 1; i < points; i++) {
    if (lo === null && re[i - 1] >= threshold && re[i] < threshold) lo = cross(om[i - 1], om[i])
    if (lo !== null && re[i - 1] < threshold && re[i] >= threshold) return { maxRe, threshold, band: [lo, cross(om[i - 1], om[i])] }
  }
  return { maxRe, threshold, band: lo !== null ? [lo, fRef / 2] : null }
}
// #endregion

// #region core:firstDiffKernel
/**
 * 對策預覽：一階差分 regressor r[n] = x[n] − x[n−1]（前置濾波 G = 1 − z⁻¹）。
 * GMAC 的平均斜率變成 Σ(線功率)·Re Γ，Γ(Ω) = H_PD(e^{jΩ})·conj(G(e^{jΩ}))。
 * min_Ω Re Γ ≥ 0 ⇒ 不管 regressor 的能量落在哪個頻率（任何 α、PHOS 或 GOS）都不會反號。
 */
export function firstDiffKernelMin(H: { b: number[]; a: number[] }, points = 4096): { minRe: number; omAtMin: number } {
  let minRe = Number.POSITIVE_INFINITY
  let omAtMin = 0
  for (let i = 1; i <= points; i++) {
    const om = (Math.PI * i) / points
    const h = hpdAt(H, om)
    const re = h.re * (1 - Math.cos(om)) + h.im * Math.sin(om) // Re{H·(1 − e^{+jΩ})}
    if (re < minRe) {
      minRe = re
      omAtMin = om
    }
  }
  return { minRe, omAtMin }
}

/**
 * Type-II（L = (K_p + K_i/(1 − z⁻¹))·z⁻¹/(1 − z⁻¹)，d = 0）的封閉式：
 *   Re Γ 與 Re{(1 − z⁻¹)(1 + L)} = (K_p − K_i/2) + 2·sin²(Ω/2)·(1 − K_p) 同號；
 * 它對 sin²(Ω/2) ∈ [0, 1] 是線性的，所以只要檢查兩端：K_i ≤ 2K_p 與 K_p + K_i/2 ≤ 2。
 */
export function firstDiffMarginTypeII(Kp: number, Ki: number): { atDc: number; atNyquist: number; nonInverting: boolean } {
  const atDc = Kp - Ki / 2
  const atNyquist = 2 - Kp - Ki / 2
  return { atDc, atNyquist, nonInverting: atDc >= 0 && atNyquist >= 0 }
}
// #endregion

