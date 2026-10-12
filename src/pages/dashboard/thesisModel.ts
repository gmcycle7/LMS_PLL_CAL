/**
 * Dashboard「六條件一分鐘體檢」的解析模型（規格 附錄 E「最終教學主旨」；模型層級 L1–L2 的線性化平均模型）。
 *
 * 只用封閉式與小型數值計算（多項式求根、脈衝響應能量、−3 dB 掃描），沒有亂數，因此不需要 Web Worker。
 * 每一項指標都可在對應章節找到完整推導；這裡把六個條件放進「同一條方程式」讓讀者一次看到彼此的關係。
 *
 * 模型（時間量一律 fs；code / regressor 正規化、無因次）：
 *   x_i[n]   單頻 code（第 i 個校正參數的 regressor），E[x_i²] = P_x，E[x_1 x_2] = ρ·P_x
 *   u[n]     = (h * x)[n]：經 PLL error path 的有效 regressor；單頻時 C = E[x u] = P_x |H| cos(φ + ΩD)
 *   雙參數的額外假設：E[x_i[n−D]·u_j[n]] = C·R̃_ij。零延遲的 ρ 保證不了這件事：兩個固定的同頻單頻 code（ρ = cos ψ）的真值是
 *     P_x|H|cos(θ + ψ_j − ψ_i) = C·R̃_ij − P_x|H| sin θ sin(ψ_j − ψ_i)，只有 θ = φ + ΩD = 0°（或 |ρ| = 1）時才等於 C·R̃；
 *     要對任何 path 都成立，需要每個延遲 m 都有 E[x_1[n]x_2[n+m]] = ρ·E[x_1[n]x_1[n+m]]（固定單頻 code 做不到）。
 *     計算核心維持 C·R̃；fixedToneRadius() 另外算固定同頻單頻 code 的 max|z| 當對照，judge() 據此加註（F-DB.6）。
 *   e[n]     = (a − w)·u[n] + ε_det[n] + v[n]，v ~ N(0, σ_v²)            （勘誤 E12：干擾記為 ε_det）
 *   q[n]     = sign(e[n]) ∈ {±1}（硬體 0/1 先映射 q = 2b − 1）
 *   G_k      = s·(1/N)·Σ q x，s = 1（average）或 N（sum）                 （勘誤 E18）
 *   w_{k+1}  = w_k + M·G_{k−d}，M = μI（scalar）或 μR̃⁻¹（preconditioned）
 * 線性化（|e_det| ≪ σ_v）：E[q | e_det] ≈ K_q·e_det，K_q = √(2/π)/σ_v。
 * 極性：δ = a − w（全站約定；勘誤 E32 / E39）；係數雜訊 δw = w − w*（勘誤 E33）。
 * Bias：B = E[x_1 ε_det]，並假設 ε_det 的 code 相關部分沿 x_1 方向（E[x_2 ε_det] = ρB），
 *       因此 δ* = −(C R̃)⁻¹·B·[1, ρ]ᵀ = −(B/C)·[1, 0]ᵀ。
 */

import { cAbs, fsToRad, identity, polyRoots, solve, wrap180, zeros } from '@/simulation/core'

export type GmacMode = 'average' | 'sum'
export type UpdateKind = 'scalar' | 'precond'
export type CheckState = 'ok' | 'warn' | 'fail'
export type ConditionId = 'identifiability' | 'polarity' | 'stability' | 'variance' | 'bias' | 'system'

export const CONDITION_ORDER: readonly ConditionId[] = ['identifiability', 'polarity', 'stability', 'variance', 'bias', 'system']

/** 體檢的全部輸入（皆為純量，可直接 structuredClone / 匯出 JSON） */
export interface ThesisParams {
  /** comparator 前雜訊 RMS σ_v [fs] */
  sigmaV: number
  /** 每個 GMAC block 的樣本數 N */
  N: number
  gmacMode: GmacMode
  /** 學習率 μ [fs]（以 average-mode GMAC 為單位） */
  mu: number
  /** comparator 取樣率 f_s [GHz] */
  fsGHz: number
  /** code 功率 P_x = E[x²]（單頻 x = A cos Ωn 時 P_x = A²/2） */
  Px: number
  /** PLL error path 在 code 頻率的幅度 |H| */
  Hmag: number
  /** PLL error path 在 code 頻率的相位 ∠H = φ [deg] */
  phiDeg: number
  /** code 的離散角頻率 Ω [rad/sample] */
  omega: number
  /** GMAC code 延遲 D [samples] */
  D: number
  /** 係數 commit 延遲 d [blocks] */
  d: number
  /** 是否同時校正第二個參數（2×2 模型） */
  twoParam: boolean
  /** 兩個 regressor 的零延遲相關係數 ρ（E[x_1 x_2] = ρ·P_x） */
  rho: number
  update: UpdateKind
  /** code 相關的 deterministic 干擾 B = E[x_1 ε_det] [fs] */
  B: number
  /** 初始 gain 誤差 w_0 − a [fs] */
  w0MinusA: number
  /** PLL 輸出頻率 f_out [GHz] */
  foutGHz: number
  /** PLL output transfer 在 code 頻率偏移處的 |T| */
  Tmag: number
  /** DTC-referred timing error 的 RMS 預算 [fs] */
  jitterBudget: number
  /** spur 上限 [dBc] */
  spurLimit: number
}

/** 預設值：規格 T13 / T14 的條件（σ_v = 100 fs、N = 4096、μ = 10 fs、f_s = 4 GHz、unit-RMS code、identity path），另加小的 B。 */
export const DEFAULT_PARAMS: ThesisParams = {
  sigmaV: 100,
  N: 4096,
  gmacMode: 'average',
  mu: 10,
  fsGHz: 4,
  Px: 1,
  Hmag: 1,
  phiDeg: 0,
  omega: Math.PI / 6,
  D: 0,
  d: 0,
  twoParam: false,
  rho: 0,
  update: 'scalar',
  B: 0.1,
  w0MinusA: -5,
  foutGHz: 13,
  Tmag: 1,
  jitterBudget: 1,
  spurLimit: -80,
}

/** 參數合法範圍（UI 與驗證共用） */
export const PARAM_RANGE: Record<keyof Omit<ThesisParams, 'gmacMode' | 'update' | 'twoParam'>, [number, number]> = {
  sigmaV: [1, 1000],
  N: [1, 1_048_576],
  mu: [1e-3, 1e4],
  fsGHz: [0.01, 50],
  Px: [0, 4],
  Hmag: [0, 4],
  phiDeg: [-180, 180],
  omega: [0, Math.PI],
  D: [0, 256],
  d: [0, 8],
  rho: [-1, 1],
  B: [-100, 100],
  w0MinusA: [-500, 500],
  foutGHz: [0.1, 100],
  Tmag: [0, 4],
  jitterBudget: [1e-3, 1000],
  spurLimit: [-200, 0],
}

/** λ̃ 小於此值視為 0（不可辨識） */
export const LAMBDA_EPS = 1e-12

/**
 * 線性化指標（linearityInit / linearityBias：gain 殘差的 RMS 除以 σ_v）的門檻。illustrative 的設計規則，
 * 和 Ch11 的 LIN_RATIO_LIMIT（max|e_det|/σ_v ≤ 0.3）是同一個數字。
 */
export const LINEARITY_LIMIT = 0.3
/** 極性裕度低於這個角度就亮「注意」[deg]（illustrative） */
export const POLARITY_MARGIN_WARN_DEG = 30
/**
 * 門檻比較用的容差：剛好落在門檻上的值（例如 θ = −60° 的 M_pol = 30°）經過 cos / asin 會變成 29.999999999999993 或 30.00000000000001，
 * 不留容差的話同一個角度有時「通過」、有時亮「注意」，還會印出「30° < 30°」。剛好等於門檻一律算在門檻內。
 */
const THRESHOLD_EPS = 1e-9
/** 線性化指標是否超過門檻（留浮點容差；mcBridge 的提醒共用同一個判斷） */
export function exceedsLinearityLimit(x: number): boolean {
  return x > LINEARITY_LIMIT * (1 + THRESHOLD_EPS)
}

// #region core:comparatorGain
/**
 * 1-bit comparator 的統計小訊號增益（規格 §5.1，T04）：
 * E[q | s] = erf(s / (√2 σ_v)) ≈ (2/√π)·s/(√2 σ_v) = K_q·s，K_q = √(2/π)/σ_v [fs⁻¹]。
 */
export function comparatorGain(sigmaV: number): number {
  return Math.sqrt(2 / Math.PI) / sigmaV
}
// #endregion

export interface Polarity {
  /** 殘餘相位 θ = φ + ΩD，折返到 (−180°, 180°] */
  thetaDeg: number
  cosTheta: number
  /** C = E[x u] = P_x |H| cos θ */
  C: number
  /** 極性裕度 M = arcsin(cos θ) [deg]（勘誤 E20：等於 90° − |wrap(θ)|，免 wrap） */
  marginDeg: number
}

// #region core:polarity
/** 單頻 code 的更新極性（規格 §6.1 / §7，T06 / T07）：C_D = (A²/2)|H|cos(φ + ΩD)，A²/2 = P_x。 */
export function polarityOf(p: Pick<ThesisParams, 'Px' | 'Hmag' | 'phiDeg' | 'omega' | 'D'>): Polarity {
  const thetaRad = (p.phiDeg * Math.PI) / 180 + p.omega * p.D // θ = φ + ΩD
  const raw = Math.cos(thetaRad)
  const cosTheta = Math.abs(raw) < 1e-12 ? 0 : raw // θ = ±90° 時視為 C = 0（避免 6e-17 的假正值）
  const C = p.Px * p.Hmag * cosTheta // 平均恢復力的大小與方向
  const marginDeg = (Math.asin(Math.max(-1, Math.min(1, cosTheta))) * 180) / Math.PI // M = arcsin(cos θ)
  // 顯示用的角度：先四捨五入到 10⁻⁹ 度再折返，−150° + 5 × 30° 才會是 0° 而不是 −2.5e−14°（C 與裕度由上面的 cos θ 算，不受影響）
  const thetaDeg = wrap180(Math.round(((thetaRad * 180) / Math.PI) * 1e9) / 1e9)
  return { thetaDeg, cosTheta, C, marginDeg }
}
// #endregion

// #region core:loopPoles
/** d 個 block 的 commit 延遲：δ_{k+1} = δ_k − g·δ_{k−d} ⇒ 特徵多項式 z^{d+1} − z^d + g（規格 §8.3）。 */
export function characteristicPoly(g: number, d: number): number[] {
  const c = new Array<number>(d + 2).fill(0)
  c[0] = 1
  c[1] -= 1
  c[d + 1] += g // d = 0 時與 c[1] 合併成 z − (1 − g)
  return c
}

/** 最大 |z|：< 1 才是（局部線性化平均模型下的）漸近穩定 */
export function spectralRadiusOf(g: number, d: number): number {
  return Math.max(...polyRoots(characteristicPoly(g, d)).map(cAbs))
}

/** 臨界 loop gain g* = 2 sin(π/(4d+2))：d = 0 → 2、d = 1 → 1、d = 2 → 0.618… */
export function criticalGain(d: number): number {
  return 2 * Math.sin(Math.PI / (4 * d + 2))
}

/** L(z) = g z^{−d}/(z − 1) 的 phase margin：PM = 90° − (2d+1)·asin(g/2)（0 < g ≤ 2；g > 2 時 |L| > 1 沒有 crossover） */
export function phaseMarginDeg(g: number, d: number): number {
  if (!(g > 0 && g <= 2)) return NaN
  return 90 - ((2 * d + 1) * Math.asin(g / 2) * 180) / Math.PI
}
// #endregion

/** delay margin [blocks] = PM [rad] / ω_c，ω_c = 2 asin(g/2) */
export function delayMarginBlocks(g: number, d: number): number {
  const pm = phaseMarginDeg(g, d)
  if (!Number.isFinite(pm)) return NaN
  return ((pm * Math.PI) / 180) / (2 * Math.asin(g / 2))
}

/**
 * 單一實數 pole 的 |p|^k 降到 5% 所需的 block 數 ⌈ln 0.05 / ln r⌉（T11：r = 0.995 → 598）。
 * d ≥ 1 時 max|z| 只給漸近速率：max|z|^k 不是平均誤差的包絡（重根、複數根），有限時間的 block 數見 settleDelayed。
 */
export function blocksTo95(r: number): number {
  if (!(r < 1)) return Infinity
  if (r <= 1e-12) return 1
  return Math.ceil(Math.log(0.05) / Math.log(r))
}

/** settleDelayed 逐 block 遞推的步數上限（超過就改列 ⌈ln 0.05 / ln max|z|⌉ 的漸近估計，並標成近似） */
export const SETTLE_MAX_STEPS = 2_000_000

// #region core:settleDelayed
/**
 * 有 commit 延遲時的 95% 收斂 block 數：照平均遞迴 y_{k+1} = y_k − g·y_{k−d} 逐 block 數出來。
 * 初始歷史 y_j = 1（j ≤ 0；和 trajectory() 的軌跡圖同一個約定），回傳 1 + max{k : |y_k| > frac}，
 * 也就是暫態最後一次超過初值 5% 的下一個 block。B ≠ 0 只是把固定點移開，「相對於固定點的暫態」仍是同一條 y_k，所以數字不變。
 * d = 0 時 y_k = (1 − g)^k，就是 blocksTo95(|1 − g|)。
 * 停止規則：連續 d + 1 個 |y|（整個狀態）都 ≤ frac·10⁻³ 就停。之後不會再超過 frac 的依據是「量到的」上界、不是證明：
 * 這個遞迴的狀態最多再放大 sup_j ‖F^j‖_∞ = 1 + d·g 倍（d ≤ 8、0 < g ≤ g* 逐點量測，最大 2.48，出現在 j = d），
 * 離 frac 還有約 400 倍的餘裕；thesisModel.test.ts 以格點（d = 0…8）和長時間的暴力遞推比對。
 * maxSteps 內沒有停（極慢的 mode）：回傳 blocksTo95(max|z|) 並標 exact = false。
 */
export function settleDelayed(g: number, d: number, frac = 0.05, maxSteps = SETTLE_MAX_STEPS): { blocks: number; exact: boolean } {
  const r = spectralRadiusOf(g, d)
  if (!(r < 1)) return { blocks: Infinity, exact: true } // 不穩定（或 g ≤ 0）：不收斂
  if (d === 0) return { blocks: blocksTo95(r), exact: true }
  const L = d + 1
  // 環形緩衝（和 trajectory() 相同）：步驟 n 開始時 ring[n % L] = y_n，ring[(n+1) % L] = y_{n−d}
  const ring = new Float64Array(L).fill(1)
  let lastAbove = 0
  let small = 0
  for (let n = 0; n < maxSteps; n++) {
    const next = ring[n % L] - g * ring[(n + 1) % L] // y_{n+1} = y_n − g·y_{n−d}
    ring[(n + 1) % L] = next
    const a = Math.abs(next)
    if (a > frac) lastAbove = n + 1 // ← 不是「第一次低於」：之後再超過也算
    if (a <= frac * 1e-3) {
      if (++small >= L) return { blocks: lastAbove + 1, exact: true }
    } else small = 0
  }
  return { blocks: blocksTo95(r), exact: false }
}
// #endregion

export interface ImpulseEnergy {
  /** Σ_m y_m² */
  energy: number
  steps: number
  converged: boolean
}

// #region core:impulseEnergy
/**
 * 白雜訊經校正迴路後的功率增益 Σ_m y_m²：y_0 = 1、y_m = y_{m−1} − g·y_{m−1−d}。
 * 算法一（最直接）：照定義一項一項加（環形緩衝），加到剩下的項可以忽略為止。
 * d = 0 時 y_m = p^m（p = 1 − g），Σ = 1/(1 − p²)；極慢的 mode（g ≲ 10⁻⁴）在 maxSteps 內加不完，converged = false。
 */
export function impulseEnergy(g: number, d: number, maxSteps = 300_000): ImpulseEnergy {
  if (!(spectralRadiusOf(g, d) < 1)) return { energy: Infinity, steps: 0, converged: false }
  const L = d + 1
  const ring = new Float64Array(L) // ring[m % L] = y_m
  ring[0] = 1
  let energy = 1
  let small = 0
  for (let m = 1; m < maxSteps; m++) {
    const prev = ring[(m - 1) % L] // y_{m−1}
    const old = m - 1 - d >= 0 ? ring[(m - 1 - d) % L] : 0 // y_{m−1−d}
    const y = prev - g * old
    ring[m % L] = y // 覆蓋的正是剛讀完的 y_{m−1−d}
    energy += y * y
    // 連續 L 個 y 都可忽略 ⇒ 狀態 (y_m … y_{m−d}) 已衰減，之後的貢獻可忽略
    if (y * y <= 1e-20 * energy) {
      if (++small >= L) return { energy, steps: m + 1, converged: true }
    } else small = 0
  }
  return { energy, steps: maxSteps, converged: false }
}
// #endregion

/** 封閉式（d = 0）：Σ p^{2m} = 1/(1 − p²) = 1/(g(2 − g)) */
export function impulseEnergyClosed(g: number): number {
  return g > 0 && g < 2 ? 1 / (g * (2 - g)) : Infinity
}

/**
 * 封閉式（d = 1）：y_m = y_{m−1} − g·y_{m−2} 是 AR(2)；令 r_j = Σ_m y_m y_{m−j}，把遞迴分別乘上 y_m、y_{m−1}、y_{m−2} 再加總，
 * 得 r_0 − 1 = r_1 − g·r_2、r_1 = r_0 − g·r_1、r_2 = r_1 − g·r_0，解出 Σy² = r_0 = (1 + g)/(g(1 − g)(2 + g))，0 < g < 1。
 */
export function impulseEnergyClosedD1(g: number): number {
  return g > 0 && g < 1 ? (1 + g) / (g * (1 - g) * (2 + g)) : Infinity
}

// #region core:impulseEnergyLyapunov
/**
 * 算法二（不必加到無窮多項）：把遞迴寫成狀態 s_m = (y_m, y_{m−1}, …, y_{m−d})ᵀ = A·s_{m−1}、s_0 = e₁，
 * 則 P = Σ_m s_m s_mᵀ 滿足離散 Lyapunov 方程 P = A·P·Aᵀ + e₁e₁ᵀ，而 Σ_m y_m² = P₁₁。
 * 把 P 的 (d+1)² 個元素排成向量，就是一組線性方程式 (I − A⊗A)·vec(P) = vec(e₁e₁ᵀ)，直接解。
 */
export function impulseEnergyLyapunov(g: number, d: number): number {
  if (!(spectralRadiusOf(g, d) < 1)) return Infinity // 不穩定：Σ y² 發散
  if (d === 0) return impulseEnergyClosed(g) // 1×1 的 Lyapunov 方程就是 P = p²P + 1
  const L = d + 1
  const A = zeros(L, L)
  A[0][0] = 1 // y_m = 1·y_{m−1} …
  A[0][d] -= g // … − g·y_{m−1−d}
  for (let i = 1; i < L; i++) A[i][i - 1] = 1 // 其餘狀態只是往後移一格
  const n = L * L
  const M = identity(n)
  for (let i = 0; i < L; i++)
    for (let j = 0; j < L; j++)
      for (let k = 0; k < L; k++)
        for (let l = 0; l < L; l++) M[i * L + j][k * L + l] -= A[i][k] * A[j][l] // (A⊗A)：P_ij ← Σ A_ik P_kl A_jl
  const rhs = new Array<number>(n).fill(0)
  rhs[0] = 1 // vec(e₁e₁ᵀ)
  try {
    return solve(M, rhs)[0] // P₁₁
  } catch {
    return Infinity // 臨界穩定時 (I − A⊗A) 奇異
  }
}
// #endregion

/** 累積能量 c_k = Σ_{m<k} y_m²（c_0 = 0）：從 0 開始的 variance 暫態 Var(δw_k) = q·c_k */
export function cumulativeEnergy(g: number, d: number, K: number): Float64Array {
  const out = new Float64Array(K + 1)
  const L = d + 1
  const ring = new Float64Array(L)
  let acc = 0
  for (let m = 0; m < K; m++) {
    let y: number
    if (m === 0) y = 1
    else {
      const prev = ring[(m - 1) % L]
      const old = m - 1 - d >= 0 ? ring[(m - 1 - d) % L] : 0
      y = prev - g * old
    }
    ring[m % L] = y
    acc += y * y
    out[m + 1] = Number.isFinite(acc) ? acc : Infinity
  }
  return out
}

/**
 * −3 dB 角頻率 Ω_3dB [rad/block]：雜訊到係數的轉移 H(z) = z^d/(z^{d+1} − z^d + g)，
 * 找第一個 |H(e^{jΩ})|² = ½|H(1)|²（即 |e^{jΩ(d+1)} − e^{jΩd} + g|² = 2g²）的 Ω；不存在時回傳 NaN。
 */
export function omega3dB(g: number, d: number): number {
  if (!(g > 0)) return NaN
  const target = 2 * g * g
  const f = (W: number) => {
    // 和差化積避免小 Ω 的抵消：e^{jΩ(d+1)} − e^{jΩd} = 2j·sin(Ω/2)·e^{jΩ(2d+1)/2}
    const s = 2 * Math.sin(W / 2)
    const ph = (W * (2 * d + 1)) / 2
    const re = g - s * Math.sin(ph)
    const im = s * Math.cos(ph)
    return re * re + im * im - target
  }
  // log 掃描（慢 mode 的 Ω_3dB 可能只有 1e-5 rad），找第一個由負轉非負的區間後二分
  const M = 3000
  let lo = 0
  let flo = f(0) // = −g² < 0
  for (let i = 0; i <= M; i++) {
    const hi = i === M ? Math.PI : 1e-8 * Math.pow(Math.PI / 1e-8, i / M)
    const fhi = f(hi)
    if (flo < 0 && fhi >= 0) {
      let a = lo
      let b = hi
      for (let it = 0; it < 80; it++) {
        const mid = 0.5 * (a + b)
        if (f(mid) < 0) a = mid
        else b = mid
      }
      return 0.5 * (a + b)
    }
    lo = hi
    flo = fhi
  }
  return NaN
}

/**
 * d = 0 的封閉式（勘誤 E06）：cos Ω = (1 + p² − 2(1 − p)²)/(2p)，等價於 1 − cos Ω = (1 − p)²/(2p)，
 * 即 Ω_3dB = 2·asin((1 − p)/(2√p))（數值上不會在小 Ω 抵消）；僅在 p ≥ 3 − 2√2 時存在。
 */
export function omega3dBClosed(g: number): number {
  const p = 1 - g
  if (!(p > 0)) return NaN
  const s = g / (2 * Math.sqrt(p))
  return s <= 1 ? 2 * Math.asin(s) : NaN
}

export interface ModeGain {
  /** 此 mode 的 loop gain g_i */
  gain: number
  /** 每個 block 注入此 mode 的雜訊功率 [fs²] */
  noise: number
  /** bias 驅動項的縮放（乘上 μ s K_q B v_i0） */
  drive: number
}

// #region core:modeScalar
/** 一般 LMS（M = μI）：R̃ 的第 i 個 eigen-mode（λ̃_i）的 loop gain、雜訊、bias 驅動。 */
export function modeScalar(g: number, lam: number, q: number): ModeGain {
  return {
    gain: g * lam, // ← 差異：loop gain 隨 λ̃_i 縮放（弱方向 λ̃ 小 → 收斂很慢）
    noise: q * lam, // ← 差異：GMAC 雜訊投影到 mode i 的功率 ∝ λ̃_i
    drive: lam, // ← 差異：B·[1, ρ] 投影到 mode i 也 ∝ λ̃_i
  }
}
// #endregion

// #region core:modePrecond
/** Preconditioned（M = μR̃⁻¹）：只消除 regressor 相關性，path 的 C（含極性）仍保留。 */
export function modePrecond(g: number, lam: number, q: number): ModeGain {
  return {
    gain: g, // ← 差異：R̃⁻¹ 把每個 mode 的 loop gain 拉齊成 g（慢模式消失）
    noise: q / lam, // ← 差異：雜訊增益 ∝ 1/λ̃_i（弱方向雜訊被放大 1/λ̃_min 倍）
    drive: 1, // ← 差異：R̃⁻¹·[1, ρ] = [1, 0]，bias 驅動不再隨 λ̃ 縮放
  }
}
// #endregion

export interface ModeResult {
  /** 正規化 eigenvalue λ̃_i（R = P_x·R̃） */
  lam: number
  /** eigenvector 第一個分量（gain 參數在此 mode 的權重） */
  v0: number
  identifiable: boolean
  gain: number
  noise: number
  drive: number
  radius: number
  pmDeg: number
  delayMarginBlocks: number
  /** 95% 收斂 block 數：這個 mode 的平均暫態（初始歷史 = 初值）最後一次超過初值 5% 的下一個 block（settleDelayed） */
  t95Blocks: number
  /** t95Blocks 是否逐 block 數出來（false = 極慢的 mode，只列漸近估計） */
  t95Exact: boolean
  /** 只看 max|z| 的 ⌈ln 0.05 / ln max|z|⌉（d ≥ 1 時只是漸近估計） */
  t95Asymptotic: number
  /** Σ y²：Lyapunov 方程的精確解（d = 0 時即封閉式 1/(g(2 − g))） */
  energy: number
  /** Σ y²：照定義直接加總（交叉比對用；未收斂時為部分和） */
  energySum: number
  /** 直接加總是否在步數上限內收斂 */
  energyConverged: boolean
  /** 穩態 mode variance [fs²] */
  variance: number
  /** 平均固定點（mode 座標）[fs] */
  xiStar: number
  /** 初值（mode 座標）[fs] */
  xi0: number
  /** −3 dB 頻寬 [Hz]（NaN = 不存在） */
  f3dbHz: number
  /** one-sided ENBW [Hz] */
  enbwHz: number
}

/**
 * 弱方向與強方向：可辨識 mode 裡 λ̃ 最小、最大的那兩個（可辨識的 mode 不到兩個時回傳 undefined）。
 * modes 的順序固定是 (1, 1)/√2（λ̃ = 1 + ρ）、(1, −1)/√2（λ̃ = 1 − ρ），所以 ρ < 0 時弱方向是第一個。
 * 要比「弱 / 強」時一律用這個函式，不要用固定的索引：modes[1] 對 modes[0] 的雜訊比在 ρ < 0 時是 1/√κ，不是 √κ。
 * λ̃ 相同（ρ = 0）時沒有強弱之分，回傳原本的順序（strong = 第一個、weak = 最後一個）。
 */
export function weakStrongModes(modes: readonly ModeResult[]): { weak: ModeResult; strong: ModeResult; weakIndex: number; strongIndex: number } | undefined {
  const idx = modes.map((_, i) => i).filter((i) => modes[i].identifiable)
  if (idx.length < 2) return undefined
  const weakIndex = idx.reduce((a, b) => (modes[b].lam <= modes[a].lam ? b : a))
  const strongIndex = idx.reduce((a, b) => (modes[b].lam > modes[a].lam ? b : a))
  return { weak: modes[weakIndex], strong: modes[strongIndex], weakIndex, strongIndex }
}

export interface ConditionCheck {
  id: ConditionId
  state: CheckState
  /** 關鍵數值（$…$ 內為 TeX，頁面以 KaTeX 顯示） */
  summary: string
  /** 為什麼（失敗時說明原因與修正方向；`$…$` 內為 TeX）。同一句話也用在 ExperimentShell 的 warnings；tooltip 用 stripMathDelimiters */
  reason: string
}

export interface ThesisResult {
  params: ThesisParams
  /** K_q [fs⁻¹] */
  Kq: number
  /** GMAC scaling s（average = 1，sum = N） */
  scale: number
  polarity: Polarity
  /** K = K_q·C [fs⁻¹]（勘誤 E13） */
  K: number
  /** 正規化 loop gain g = μ·s·K_q·C（無因次） */
  g: number
  /** 每 block 的 GMAC 雜訊功率 σ_η² ≈ P_x/N（average 單位） */
  sigmaEta2: number
  /** 注入 δ 的雜訊功率 q = μ² s² P_x / N [fs²] */
  q: number
  lamMin: number
  lamMax: number
  /** condition number κ = λ_max/λ_min（λ 為有效 regressor 自相關 R = |H|²P_x R̃ 的特徵值） */
  kappa: number
  modes: ModeResult[]
  identifiable: boolean
  stable: boolean
  maxRadius: number
  gStar: number
  /** f_u = f_s/N [Hz] */
  fuHz: number
  /** gain 參數的穩態 RMS σ_w [fs]（Σy² 取 Lyapunov 精確解） */
  sigmaW: number
  /** 同一個 σ_w，但 Σy² 改用直接加總（交叉比對用；任何 mode 的加總未收斂時為 NaN） */
  sigmaWSum: number
  /** gain bias Δw = w* − a [fs] */
  deltaW: number
  /** DTC-referred random timing error RMS [fs]（gain-equivalent × code RMS；不是 PLL 輸出 jitter） */
  sigmaDtRand: number
  /** DTC-referred deterministic timing error RMS [fs] */
  sigmaDtDet: number
  /** 合計 RMS [fs] */
  sigmaDt: number
  /** deterministic code tone 的 peak 幅度 A_t [fs] */
  AtPeak: number
  /** 輸出相位調變指數 β = 2π f_out |T| A_t [rad]（時間 → 相位一律用 fsToRad） */
  betaRad: number
  /** spur ≈ 20 log10(π f_out |T| A_t) [dBc]（小角度近似） */
  spurDbc: number
  /** 最慢 mode 的 95% 收斂 block 數：平均暫態（相對於固定點；初始歷史 = 初值）最後一次超過初值 5% 的下一個 block */
  slowT95Blocks: number
  /** slowT95Blocks 是否逐 block 數出來（false = 有極慢的 mode 只列漸近估計） */
  slowT95Exact: boolean
  slowT95Seconds: number
  /** |w0 − a|·|H|·√P_x/σ_v：初始的 gain 殘差 (a − w_0)·u 的 RMS 除以 σ_v——線性化（K_q）在暫態開頭是否成立的指標 */
  linearityInit: number
  /**
   * Sign-LMS 固定點 ≈ a + B/C 是否成立的指標（勘誤 E01）：把線性候選點 w = a + B/C 代回去，gain 那一項 (a − w)·u = −Δw·u 的 RMS 除以 σ_v，
   * |Δw|·|H|·√P_x/σ_v = |B|/(√P_x·σ_v·|cos θ|)。θ = 0° 時就是 |B|/(√P_x σ_v)；C 越小（|cos θ| → 0），同樣的 B 需要越大的 Δw，
   * comparator 前的確定性殘差跟著放大 1/|cos θ| 倍（Ch11 §11.4 把 a + B/C 代回去檢查的同一件事）。C = 0 時為 ∞。
   */
  linearityBias: number
  /** 雙參數的交叉相關假設 E[x_i u_j] = C·R̃_ij 不是自動成立：twoParam、|ρ| < 1、sin θ ≠ 0、0 < Ω < π、C > 0 */
  crossAssumptionActive: boolean
  /** 對照：兩個固定同頻單頻 code 的 max|z|（F-DB.6）；crossAssumptionActive 為 false 時是 NaN */
  fixedToneRadius: number
  checks: ConditionCheck[]
  /** 失敗原因（ExperimentShell 以 danger 顯示） */
  warnings: string[]
  /** 近似有效性提醒（以 warn 顯示） */
  notes: string[]
  crossCheck: { ok: boolean; note: string }
}

/**
 * TeX 用：4 位有效數字（大數的 e 記號改寫成 ×10ⁿ）。
 * 所有說明文字（reason / warnings / notes / crossCheck）裡的數學一律寫在 `$…$` 內，由共用元件的 mathText 以 KaTeX 顯示
 * （docs/teaching-style.md §3：字串屬性也要用 LaTeX）；tooltip 等純文字情境用 stripMathDelimiters。
 */
const t4 = (x: number) => {
  if (!Number.isFinite(x)) return x > 0 ? '\\infty' : x < 0 ? '-\\infty' : '\\text{—}'
  const str = Number(x.toPrecision(4)).toString()
  const m = /^(-?[\d.]+)e([+-]?\d+)$/.exec(str)
  return m ? `${m[1]}\\times10^{${Number(m[2])}}` : str
}
/** 「數值 fs」的行內 TeX */
const fsTex = (x: number) => `$${t4(x)}\\,\\mathrm{fs}$`

function modeBasis(p: ThesisParams): { lam: number; v0: number }[] {
  if (!p.twoParam) return [{ lam: 1, v0: 1 }]
  // R̃ = [[1, ρ], [ρ, 1]]：λ̃ = 1 ± ρ，eigenvectors (1, ±1)/√2
  return [
    { lam: 1 + p.rho, v0: Math.SQRT1_2 },
    { lam: 1 - p.rho, v0: Math.SQRT1_2 },
  ]
}

// #region core:fixedToneRadius
/**
 * 對照值（F-DB.6）：兩個固定的同頻單頻 code（x_i = A cos(Ωn + ψ_i)、ρ = cos(ψ_2 − ψ_1)）的 max|z|。
 * E[x_i[n−D] u_j[n]] = P_x|H| cos(θ + ψ_j − ψ_i)，特徵值 λ± = P_x|H|(cos θ ± √(ρ² − sin²θ))；
 * M = μR̃⁻¹ 時特徵值是 P_x|H| e^{±jθ}（等於把 ρ 換成 0）。g′ = μ s K_q P_x |H|（不含 cos θ）。
 */
export function fixedToneRadius(p: Pick<ThesisParams, 'sigmaV' | 'N' | 'gmacMode' | 'mu' | 'Px' | 'Hmag' | 'phiDeg' | 'omega' | 'D' | 'd' | 'rho' | 'update'>): number {
  const scale = p.gmacMode === 'sum' ? p.N : 1
  const gp = p.mu * scale * comparatorGain(p.sigmaV) * p.Px * p.Hmag // g′
  const c = polarityOf(p).cosTheta
  const rhoE = p.update === 'precond' ? 0 : p.rho
  const disc = rhoE * rhoE - (1 - c * c) // ρ² − sin²θ
  if (disc >= 0) {
    const s = Math.sqrt(disc) // 兩個實特徵值：各自是一個純量迴路
    return Math.max(spectralRadiusOf(gp * (c + s), p.d), spectralRadiusOf(gp * (c - s), p.d))
  }
  // 共軛複數特徵值：兩個因式相乘成實係數多項式 w² + 2g′cosθ·w + g′²(1 − ρ²)，w = z^{d+1} − z^d
  const n = 2 * p.d + 2
  const co = new Array<number>(n + 1).fill(0) // 最高次在前
  co[0] += 1
  co[1] -= 2
  co[2] += 1 // w²
  co[p.d + 1] += 2 * gp * c
  co[p.d + 2] -= 2 * gp * c // 2g′cosθ·w
  co[n] += gp * gp * (1 - rhoE * rhoE)
  return Math.max(...polyRoots(co).map(cAbs))
}
// #endregion

// #region core:evaluateThesis
/** 由同一組參數算出六個條件的所有指標（局部線性化平均模型；不同學習模式共用此函式）。 */
export function evaluateThesis(p: ThesisParams): ThesisResult {
  const Kq = comparatorGain(p.sigmaV)
  const scale = p.gmacMode === 'sum' ? p.N : 1 // sum 模式忘了 /N → 有效步長放大 N 倍
  const pol = polarityOf(p)
  const g = p.mu * scale * Kq * pol.C // 正規化 loop gain g = μ s K_q C
  const sigmaEta2 = p.Px / p.N // 近平衡、q ≈ iid ±1：Var(G) ≈ E[x²]/N
  const q = p.mu * p.mu * scale * scale * sigmaEta2 // 注入 δ 的雜訊功率
  const fuHz = (p.fsGHz * 1e9) / p.N
  const delta0 = -p.w0MinusA // δ_0 = a − w_0
  const basis = modeBasis(p)
  const uPower = p.Px * p.Hmag * p.Hmag // 有效 regressor u = h*x 的功率 E[u²] = |H|²P_x（§0：R = E[uuᵀ]）
  const modes: ModeResult[] = basis.map(({ lam, v0 }) => {
    const identifiable = lam > LAMBDA_EPS && uPower > 0
    const mg = p.update === 'precond' && p.twoParam ? (identifiable ? modePrecond(g, lam, q) : { gain: NaN, noise: NaN, drive: NaN }) : modeScalar(g, lam, q)
    const radius = Number.isFinite(mg.gain) ? spectralRadiusOf(mg.gain, p.d) : NaN
    const st = Number.isFinite(mg.gain) ? settleDelayed(mg.gain, p.d) : { blocks: Infinity, exact: true } // 95% 收斂：逐 block 數（d = 0 時即封閉式）
    const ie = Number.isFinite(mg.gain) ? impulseEnergy(mg.gain, p.d) : { energy: NaN, steps: 0, converged: false } // 算法一：直接加總
    const energy = Number.isFinite(mg.gain) ? impulseEnergyLyapunov(mg.gain, p.d) : NaN // 算法二：Lyapunov（採用）
    const variance = mg.noise === 0 ? 0 : mg.noise * energy // 穩態 Var = q_i Σ y²
    const xiStar = identifiable && pol.C !== 0 ? (-p.B * v0) / pol.C : NaN // ξ*_i = −B v_i0 / C
    return {
      lam,
      v0,
      identifiable,
      gain: mg.gain,
      noise: mg.noise,
      drive: mg.drive,
      radius,
      pmDeg: phaseMarginDeg(mg.gain, p.d),
      delayMarginBlocks: delayMarginBlocks(mg.gain, p.d),
      t95Blocks: st.blocks,
      t95Exact: st.exact,
      t95Asymptotic: blocksTo95(radius),
      energy,
      energySum: ie.energy,
      energyConverged: ie.converged,
      variance,
      xiStar,
      xi0: v0 * delta0,
      f3dbHz: (omega3dB(mg.gain, p.d) / (2 * Math.PI)) * fuHz,
      enbwHz: (fuHz / 2) * mg.gain * mg.gain * energy, // ENBW = (f_u/2)·g²·Σy²
    }
  })
  const lams = basis.map((b) => b.lam)
  const lamMax = Math.max(...lams) * uPower // R = |H|²P_x·R̃ 的特徵值
  const lamMin = Math.max(0, Math.min(...lams)) * uPower
  const kappa = lamMin > 0 ? lamMax / lamMin : Infinity
  const identifiable = modes.every((m) => m.identifiable)
  const active = modes.filter((m) => m.identifiable)
  const maxRadius = active.length ? Math.max(...active.map((m) => m.radius)) : NaN
  const stable = active.length > 0 && maxRadius < 1 // 可辨識的 mode 都收斂（不可辨識的 mode 是「不動」，另由 identifiability 判定）
  const sigmaW = Math.sqrt(modes.reduce((s, m) => s + m.v0 * m.v0 * m.variance, 0)) // gain 參數的 RMS
  const sumConverged = modes.every((m) => m.noise === 0 || m.energyConverged)
  const sigmaWSum = sumConverged ? Math.sqrt(modes.reduce((s, m) => s + (m.noise === 0 ? 0 : m.v0 * m.v0 * m.noise * m.energySum), 0)) : NaN
  const randVar = p.Px * modes.reduce((s, m) => s + m.lam * m.variance, 0) // P_x Σ λ̃_i Var(ξ_i)
  const sigmaDtRand = Math.sqrt(randVar)
  const deltaW = identifiable && pol.C > 0 ? p.B / pol.C : NaN // w* − a = B/C
  const sigmaDtDet = Number.isFinite(deltaW) ? Math.sqrt(p.Px) * Math.abs(deltaW) : NaN
  const sigmaDt = Math.hypot(sigmaDtRand, sigmaDtDet)
  const AtPeak = Math.SQRT2 * sigmaDtDet // 單頻 code：peak = √2 × RMS
  const betaRad = p.Tmag * fsToRad(AtPeak, p.foutGHz * 1e9) // β = 2π f_out |T| A_t [rad]
  const spurDbc = 20 * Math.log10(betaRad / 2) // 小角度：每根 sideband = β/2 ⇒ 20 log10(π f_out |T| A_t)
  const slowT95Blocks = active.length ? Math.max(...active.map((m) => m.t95Blocks)) : Infinity // d = 0 時就是 max|z| 最大的那個 mode
  // 雙參數的交叉相關假設需要另外確認的情況（θ = 0°、|ρ| = 1、Ω = 0 或 π、C ≤ 0 時不必：前兩者假設成立，後兩者另有判定）
  const crossAssumptionActive =
    p.twoParam && p.Px > 0 && p.Hmag > 0 && Math.abs(p.rho) < 1 - 1e-12 && 1 - pol.cosTheta * pol.cosTheta > 1e-9 && Math.abs(Math.sin(p.omega)) > 1e-9 && pol.C > 0
  const res: Omit<ThesisResult, 'checks' | 'warnings' | 'notes' | 'crossCheck'> = {
    params: p,
    Kq,
    scale,
    polarity: pol,
    K: Kq * pol.C,
    g,
    sigmaEta2,
    q,
    lamMin,
    lamMax,
    kappa,
    modes,
    identifiable,
    stable,
    maxRadius,
    gStar: criticalGain(p.d),
    fuHz,
    sigmaW,
    sigmaWSum,
    deltaW,
    sigmaDtRand,
    sigmaDtDet,
    sigmaDt,
    AtPeak,
    betaRad,
    spurDbc,
    slowT95Blocks,
    slowT95Exact: active.every((m) => m.t95Exact),
    slowT95Seconds: slowT95Blocks / fuHz,
    linearityInit: (Math.abs(p.w0MinusA) * p.Hmag * Math.sqrt(p.Px)) / p.sigmaV, // (a − w_0)·u 的 RMS：u = h*x 的 RMS 是 |H|√P_x
    linearityBias: p.Px > 0 && pol.cosTheta !== 0 ? Math.abs(p.B) / (Math.sqrt(p.Px) * p.sigmaV * Math.abs(pol.cosTheta)) : Infinity, // |Δw|·|H|·√P_x/σ_v
    crossAssumptionActive,
    fixedToneRadius: crossAssumptionActive ? fixedToneRadius(p) : NaN,
  }
  const { checks, warnings, notes } = judge(res)
  return { ...res, checks, warnings, notes, crossCheck: analyticCrossCheck(res) }
}
// #endregion

/** 六個條件的判定與文字說明（門檻為 illustrative 設計規則）。文字中的數學一律在 `$…$` 內。 */
function judge(r: Omit<ThesisResult, 'checks' | 'warnings' | 'notes' | 'crossCheck'>): Pick<ThesisResult, 'checks' | 'warnings' | 'notes'> {
  const p = r.params
  const pol = r.polarity
  const warnings: string[] = []
  const notes: string[] = []
  const checks: ConditionCheck[] = []
  const budget = p.jitterBudget

  // 1. Identifiability（R = E[uuᵀ]，u 是經 PLL error path 的有效 regressor）
  if (!(p.Px > 0)) {
    const reason = String.raw`$P_x=0$：code 沒有激勵，GMAC 完全看不到參數（$\lambda_{\min}=0$，不可辨識）。`
    checks.push({ id: 'identifiability', state: 'fail', summary: '$\\lambda_{\\min}=0$', reason })
    warnings.push(reason)
  } else if (!(p.Hmag > 0)) {
    const reason = String.raw`$|H|=0$：code 經 PLL error path 後完全到不了 comparator（有效 regressor 功率 $|H|^2P_x=0$，$\lambda_{\min}=0$，不可辨識）——例如 DC 分量遇到 $H_{\mathrm{PD}}(1)=0$。`
    checks.push({ id: 'identifiability', state: 'fail', summary: '$\\lambda_{\\min}=0$', reason })
    warnings.push(reason)
  } else if (!r.identifiable) {
    const reason = String.raw`$\lambda_{\min}=0$（$\rho=${t4(p.rho)}$）：兩個 regressor 完全相關，$(1,\,${p.rho > 0 ? '-1' : '+1'})$ 方向不可辨識；$\mathbf M=\mu\mathbf I$ 時該方向凍結在初值，$\mathbf M=\mu\tilde{\mathbf R}^{-1}$ 則根本不存在。`
    checks.push({ id: 'identifiability', state: 'fail', summary: '$\\lambda_{\\min}=0$', reason })
    warnings.push(reason)
  } else if (r.kappa > 100) {
    const amp = Math.sqrt(r.kappa)
    // 弱方向（λ̃ 最小）自己的 95% 收斂 block 數；步長大或有延遲時，最慢的可能反而是強方向（loop gain 太接近穩定上限）
    const weakMode = r.modes.filter((m) => m.identifiable).reduce((a, b) => (b.lam < a.lam ? b : a))
    const weakIsSlowest = weakMode.t95Blocks >= r.slowT95Blocks
    checks.push({
      id: 'identifiability',
      state: 'warn',
      summary: `$\\lambda_{\\min}=${t4(r.lamMin)},\\ \\kappa=${t4(r.kappa)}$`,
      reason:
        p.update === 'precond'
          ? String.raw`$\kappa=${t4(r.kappa)}>100$：preconditioner 讓所有 mode 一樣快，但弱方向的雜訊被放大，RMS 比強方向大 $\sqrt\kappa=${t4(amp)}$ 倍。`
          : String.raw`$\kappa=${t4(r.kappa)}>100$：弱方向的 loop gain 只剩 $g\,\tilde\lambda_{\min}$，95% 收斂要 $${t4(weakMode.t95Blocks)}$ 個 block` +
            (weakIsSlowest
              ? ''
              : Number.isFinite(r.slowT95Blocks)
                ? String.raw`（這組設定下最慢的不是它：強方向的 loop gain 太接近穩定上限，要 $${t4(r.slowT95Blocks)}$ 個 block）`
                : '（這組設定下強方向的 loop gain 已經達到或超過穩定上限 $g^*$，不收斂；見條件 3）') +
            String.raw`；改用 preconditioner 會加快，但弱方向雜訊放大 $\sqrt\kappa=${t4(amp)}$ 倍。`,
    })
  } else {
    checks.push({
      id: 'identifiability',
      state: 'ok',
      summary: `$\\lambda_{\\min}=${t4(r.lamMin)},\\ \\kappa=${t4(r.kappa)}$`,
      reason: String.raw`每個參數方向都有足夠的激勵（$\lambda_{\min}>0$ 且 $\kappa$ 不大）。`,
    })
  }

  // 2. Polarity
  const polSummary = `$C=${t4(pol.C)},\\ M_{\\mathrm{pol}}=${t4(pol.marginDeg)}^\\circ$`
  if (pol.C < 0) {
    const reason = String.raw`$C<0$：更新極性錯誤。$\theta=\phi+\Omega D=${t4(pol.thetaDeg)}^\circ$、$\cos\theta=${t4(pol.cosTheta)}$，$C=P_x|H|\cos\theta=${t4(pol.C)}$；正的 $\mu$ 會讓平均誤差以 $p=1-g>1$ 發散。調整 code delay $D$ 使 $\cos(\phi+\Omega D)>0$，或改用 filtered-x（Ch07）。`
    checks.push({ id: 'polarity', state: 'fail', summary: `$C=${t4(pol.C)}$`, reason })
    warnings.push(reason)
  } else if (pol.C === 0) {
    const reason = String.raw`$C=0$：$\theta=${t4(pol.thetaDeg)}^\circ$（或 $|H|=0$、$P_x=0$），平均恢復力為零，$w$ 只會隨 GMAC 雜訊 random walk。`
    checks.push({ id: 'polarity', state: 'fail', summary: '$C=0$', reason })
    warnings.push(reason)
  } else if (pol.marginDeg < POLARITY_MARGIN_WARN_DEG - THRESHOLD_EPS) {
    checks.push({
      id: 'polarity',
      state: 'warn',
      summary: polSummary,
      reason: String.raw`極性裕度 $M_{\mathrm{pol}}=\arcsin(\cos\theta)=${t4(pol.marginDeg)}^\circ<30^\circ$：有效增益只剩 $\cos\theta=${t4(pol.cosTheta)}$，PVT 或 FCW 改變相位時容易翻號。`,
    })
  } else {
    checks.push({ id: 'polarity', state: 'ok', summary: polSummary, reason: '單頻相關為正，更新方向正確。' })
  }

  // 3. Stability（只看可辨識的 mode；不可辨識的 mode 不是「不穩」，而是「不動」）
  const active = r.modes.filter((m) => m.identifiable)
  const worst = active.length ? active.reduce((a, b) => (b.radius > a.radius ? b : a)) : undefined
  const pmList = active.map((m) => m.pmDeg).filter(Number.isFinite)
  const minPm = pmList.length ? Math.min(...pmList) : NaN
  if (!worst) {
    checks.push({ id: 'stability', state: 'fail', summary: '無可辨識的 mode', reason: '沒有任何參數方向可以被校正，談不上迴路動態。' })
  } else if (!(worst.radius < 1)) {
    let reason: string
    if (!(worst.gain > 0))
      reason = String.raw`$g=${t4(worst.gain)}\le0$：極性錯誤（或 $C=0$）時特徵方程 $z^{d+1}-z^{d}+g=0$ 有一個實根 $z\ge1$（$d=0$ 時就是 $z=1-g$），沒有收斂的可能。`
    else
      reason =
        String.raw`$g_i=${t4(worst.gain)}\ge g^*(d=${p.d})=2\sin\frac{\pi}{4d+2}=${t4(r.gStar)}$：$\max|z|=${t4(worst.radius)}\ge1$，係數震盪發散。` +
        (p.gmacMode === 'sum'
          ? String.raw`GMAC 為 sum 模式但 $\mu$ 仍按 average 設計：有效 $g$ 被放大 $N=${p.N}$ 倍。`
          : String.raw`減小 $\mu$、縮短 commit latency $d$。`)
    checks.push({ id: 'stability', state: 'fail', summary: `$\\max|z|=${t4(worst.radius)}$`, reason })
    warnings.push(reason)
  } else if (minPm < 45) {
    const dm = Math.min(...active.map((m) => m.delayMarginBlocks).filter(Number.isFinite))
    checks.push({
      id: 'stability',
      state: 'warn',
      summary: `$\\max|z|=${t4(worst.radius)},\\ \\mathrm{PM}=${t4(minPm)}^\\circ$`,
      reason: String.raw`$\mathrm{PM}=90^\circ-(2d+1)\arcsin(g/2)=${t4(minPm)}^\circ<45^\circ$：收斂會振鈴，delay margin 只有 $${t4(dm)}$ 個 block。`,
    })
  } else {
    checks.push({
      id: 'stability',
      state: 'ok',
      summary: `$\\max|z|=${t4(worst.radius)},\\ \\mathrm{PM}=${t4(minPm)}^\\circ$`,
      reason: String.raw`所有可辨識 mode 的特徵根都在單位圓內（$g^*=${t4(r.gStar)}$）。`,
    })
  }
  // 雙參數且 θ ≠ 0°：上面的判定以交叉相關假設 E[x_i u_j] = C·R̃_ij 為前提。把固定同頻單頻 code 的對照值寫進說明；
  // 模型說穩定、對照卻不穩定時，燈號降為「注意」（不改成「未通過」：計算核心仍是 C·R̃，也不知道使用者的 code 是哪一種）。
  // 只後處理 ok / warn：'fail' 的原因同時放在 warnings，不可再改。
  if (r.crossAssumptionActive && worst && worst.radius < 1) {
    const st = checks[checks.length - 1] // 剛推入的 stability（ok 或 warn）
    const ft = r.fixedToneRadius
    if (!(ft < 1)) {
      st.state = 'warn'
      st.summary = `$\\max|z|=${t4(worst.radius)}$（固定同頻 code：$${t4(ft)}$）`
      st.reason += String.raw`但這是在雙參數的交叉相關假設 $E[x_i[n-D]\,u_j[n]]=C\,\tilde R_{ij}$ 之下：$\theta=${t4(pol.thetaDeg)}^\circ\ne0^\circ$ 時，兩個固定的同頻單頻 code 不滿足這個假設，它們的 $\max|z|=${t4(ft)}\ge1$，不收斂。這個燈號不能當成實體 code 的穩定保證（見下方「近似的適用範圍」；完整的 Jacobian 在 Ch10）。`
    } else {
      st.reason += String.raw`（雙參數：以交叉相關假設 $E[x_i[n-D]\,u_j[n]]=C\,\tilde R_{ij}$ 為前提；兩個固定的同頻單頻 code 的對照值是 $\max|z|=${t4(ft)}$，見下方「近似的適用範圍」。）`
    }
  }

  // 4. Variance：每個係數自己的 RMS，乘上 code RMS 換算成 DTC-referred timing error √P_x·σ_w
  const wTiming = Math.sqrt(p.Px) * r.sigmaW
  if (!r.stable) {
    checks.push({ id: 'variance', state: 'fail', summary: '$\\sigma_w$ 無界', reason: '迴路不穩定：穩態 variance 無界。' })
  } else if (!Number.isFinite(r.sigmaW)) {
    checks.push({
      id: 'variance',
      state: 'fail',
      summary: '$\\sigma_w$ 無定義',
      reason: String.raw`$\tilde{\mathbf R}$ 奇異：preconditioner $\tilde{\mathbf R}^{-1}$ 不存在，不可辨識方向的 variance 沒有定義。`,
    })
  } else if (wTiming > budget) {
    const hidden = p.twoParam && r.sigmaDtRand <= budget
    checks.push({
      id: 'variance',
      state: 'fail',
      summary: `$\\sigma_w=${t4(r.sigmaW)}\\,\\mathrm{fs}$`,
      reason:
        String.raw`係數 RMS $\sigma_w=${t4(r.sigmaW)}\,\mathrm{fs}$，乘上 code RMS 得 DTC-referred timing error $\sqrt{P_x}\,\sigma_w=${t4(wTiming)}\,\mathrm{fs}$，大於預算 ${fsTex(budget)}：減小 $\mu$ 或增加 $N$。` +
        (hidden
          ? String.raw`目前 code 下的 $\sigma_{\delta t}$ 只有 ${fsTex(r.sigmaDtRand)}，因為雜訊集中在幾乎沒被激勵的弱方向——換一組 code / FCW 就會現形。`
          : ''),
    })
  } else {
    checks.push({
      id: 'variance',
      state: 'ok',
      summary: `$\\sigma_w=${t4(r.sigmaW)}\\,\\mathrm{fs}$`,
      reason: String.raw`$\sqrt{P_x}\,\sigma_w=${t4(wTiming)}\,\mathrm{fs}$，不超過預算 ${fsTex(budget)}。`,
    })
  }

  // 5. Bias
  if (pol.C < 0) {
    checks.push({ id: 'bias', state: 'fail', summary: '$w^*$ 不可達', reason: String.raw`$C<0$：$w^*=a+B/C$ 是排斥點（repelling fixed point），平均誤差離它越來越遠，校正永遠到不了。` })
  } else if (pol.C === 0) {
    checks.push({
      id: 'bias',
      state: 'fail',
      summary: '沒有固定點',
      reason: String.raw`$C=0$：平均遞迴 $E[\delta_{k+1}]=E[\delta_k]-\mu\,s\,K_qB$ 沒有恢復力，$w^*=a+B/C$ 沒有定義；$B\ne0$ 時 $w$ 以每個 block $\mu\,s\,K_qB$ 的固定速率漂移（average 模式 $s=1$）。`,
    })
  } else if (!r.identifiable) {
    checks.push({ id: 'bias', state: 'fail', summary: '固定點不唯一', reason: '不可辨識：收斂值取決於初值，GMAC 歸零不代表參數正確。' })
  } else if (r.sigmaDtDet > budget) {
    checks.push({
      id: 'bias',
      state: 'fail',
      summary: `$\\Delta w=${t4(r.deltaW)}\\,\\mathrm{fs}$`,
      reason: String.raw`$\Delta w=B/C=${t4(r.deltaW)}\,\mathrm{fs}$；deterministic DTC error $\sqrt{P_x}\,|\Delta w|=${t4(r.sigmaDtDet)}\,\mathrm{fs}$，大於預算 ${fsTex(budget)}。$C$ 越小，同樣的 $B$ 造成越大的 bias（Ch11）。`,
    })
  } else if (exceedsLinearityLimit(r.linearityBias)) {
    checks.push({
      id: 'bias',
      state: 'warn',
      summary: `$\\Delta w=${t4(r.deltaW)}\\,\\mathrm{fs}$`,
      reason: String.raw`$|\Delta w|\,|H|\sqrt{P_x}/\sigma_v=|B|/(\sqrt{P_x}\,\sigma_v\,|\cos\theta|)=${t4(r.linearityBias)}>0.3$：把 $w=a+B/C$ 代回去，gain 那一項 $(a-w)\,u$ 的 RMS 相對 $\sigma_v$ 不夠小，comparator 可能已經離開線性區；$a+B/C$ 是線性化的值，Sign-LMS 的固定點可能不再是它（勘誤 E01）。$C$ 越小，同樣的 $B$ 需要越大的 $\Delta w$，這個比值跟著放大 $1/|\cos\theta|$ 倍（Ch11 §11.4）。`,
    })
  } else {
    checks.push({
      id: 'bias',
      state: 'ok',
      summary: `$\\Delta w=${t4(r.deltaW)}\\,\\mathrm{fs}$`,
      reason: String.raw`deterministic DTC error $\sqrt{P_x}\,|\Delta w|=${t4(r.sigmaDtDet)}\,\mathrm{fs}$，不超過預算 ${fsTex(budget)}。`,
    })
  }

  // 6. System-level
  const upstream = checks.some((c) => c.state === 'fail' && (c.id === 'identifiability' || c.id === 'polarity' || c.id === 'stability'))
  if (upstream || !Number.isFinite(r.sigmaDt)) {
    checks.push({
      id: 'system',
      state: 'fail',
      summary: '—',
      reason: String.raw`前面的條件未滿足（不可辨識、極性錯誤或不穩定）：校正本身不成立，沒有穩態的 $\sigma_{\delta t}$ 與 spur 可以和預算比。`,
    })
  } else {
    const spurOk = !(r.spurDbc > p.spurLimit)
    const jitOk = r.sigmaDt <= budget
    const hasSpur = Number.isFinite(r.spurDbc)
    const sysSummary = `$\\sigma_{\\delta t}=${t4(r.sigmaDt)}\\,\\mathrm{fs}$，spur ${hasSpur ? `$${t4(r.spurDbc)}\\,\\mathrm{dBc}$` : '無（$\\Delta w=0$）'}`
    if (jitOk && spurOk) {
      checks.push({
        id: 'system',
        state: 'ok',
        summary: sysSummary,
        reason: String.raw`合計 DTC-referred $\sigma_{\delta t}=${t4(r.sigmaDt)}\,\mathrm{fs}\le${t4(budget)}\,\mathrm{fs}$，spur 不超過 $${t4(p.spurLimit)}\,\mathrm{dBc}$：在預算內（不是和校正前比較）。`,
      })
    } else {
      const parts: string[] = []
      if (!jitOk) {
        const each = r.sigmaDtRand <= budget && r.sigmaDtDet <= budget
        parts.push(
          String.raw`合計 DTC-referred $\sqrt{\sigma_{\mathrm{rand}}^2+\sigma_{\mathrm{det}}^2}=${t4(r.sigmaDt)}\,\mathrm{fs}>${t4(budget)}\,\mathrm{fs}$` +
            (each ? '（variance 與 bias 各自都在預算內，合起來卻超出——條件 4、5 過關不保證條件 6，system-level 要另外檢查）' : ''),
        )
      }
      if (!spurOk)
        parts.push(String.raw`spur $\approx20\log_{10}(\pi f_{\mathrm{out}}|T|A_t)=${t4(r.spurDbc)}\,\mathrm{dBc}>${t4(p.spurLimit)}\,\mathrm{dBc}$`)
      checks.push({ id: 'system', state: 'fail', summary: sysSummary, reason: parts.join('；') + '。' })
    }
  }
  // 雙參數且 θ ≠ 0°，而固定同頻單頻 code 的對照值不收斂：「在預算內」的結論對那種 code 不適用（降為「注意」）
  if (r.crossAssumptionActive && !(r.fixedToneRadius < 1)) {
    const sys = checks[checks.length - 1]
    if (sys.id === 'system' && sys.state === 'ok') {
      sys.state = 'warn'
      sys.reason += String.raw`前提是雙參數的交叉相關假設成立：兩個固定的同頻單頻 code 在這組參數下不收斂（條件 3 的對照值 $\max|z|=${t4(r.fixedToneRadius)}$），這個結論對它們不適用。`
    }
  }

  if (r.crossAssumptionActive)
    notes.push(
      String.raw`雙參數模型除了 $\rho$，還假設交叉相關也以同一個 $C$ 縮放：$E[x_i[n-D]\,u_j[n]]=C\,\tilde R_{ij}$。零延遲的 $\rho$ 保證不了這件事。目前 $\theta=\phi+\Omega D=${t4(pol.thetaDeg)}^\circ\ne0^\circ$：如果兩個 regressor 是固定的同頻單頻 code（相位差 $\psi$，$\rho=\cos\psi$），真正的矩陣是 $E[x_i[n-D]\,u_j[n]]=P_x|H|\cos(\theta+\psi_j-\psi_i)$，比 $C\,\tilde{\mathbf R}$ 多一個反對稱項 $\pm P_x|H|\sin\theta\sqrt{1-\rho^2}$。` +
        (p.update === 'precond'
          ? String.raw`$\mathbf M=\mu\tilde{\mathbf R}^{-1}$ 時，pole 由 $1-g$ 變成 $1-g'e^{\pm j\theta}$，其中 $g'=\mu\,s\,K_qP_x|H|$（$d=0$；F-DB.6）。`
          : String.raw`特徵值由 $C(1\pm\rho)$ 變成 $P_x|H|\big(\cos\theta\pm\sqrt{\rho^2-\sin^2\theta}\big)$（F-DB.6；根號內為負時是一對共軛複數）。`) +
        String.raw`同一組參數下，這種 code 的 $\max|z|=${t4(r.fixedToneRadius)}$（本模型：$${t4(r.maxRadius)}$）；兩個係數的平均軌跡會互相耦合，固定點與 $\sigma_w$ 一般也不同。本模型的數字適用於 $\theta=0^\circ$（例如把 $D$ 調到 $\phi+\Omega D=0^\circ$），或兩個 code 在每一個延遲的交叉相關都是自相關的 $\rho$ 倍（固定的單頻 code 做不到；兩個互相獨立、頻譜相同的窄頻隨機 code 的線性混合可以）。其他情況請用 Ch10 的完整 Jacobian $\mathbf C=E[\mathbf x\,\mathbf u^T]$。`,
    )
  if (exceedsLinearityLimit(r.linearityInit))
    notes.push(
      String.raw`$|w_0-a|\,|H|\sqrt{P_x}/\sigma_v=${t4(r.linearityInit)}>0.3$：初始誤差（經 error path 之後的 $(a-w_0)\,u$）相對雜訊太大，comparator 會飽和（erf 不再線性），實際 Sign-LMS 前段是固定速率的線性漂移，比這裡的指數預測慢（Ch05 / Ch14）。`,
    )
  if (p.gmacMode === 'sum')
    notes.push(String.raw`GMAC sum 模式：$G$ 是 $N$ 筆總和，等效 $g$ 與雜訊都乘上 $s=N=${p.N}$（$\mu$ 必須同步除以 $N$，勘誤 E18）。`)
  const sinOmega = Math.abs(Math.sin(p.omega))
  // Ω = 0 或 π 時 ΩD 是 π 的整數倍，|cos θ| = |cos φ|：不等於 1 就代表 φ 不是 0° / 180°
  if (sinOmega < 1e-9 && Math.abs(Math.abs(pol.cosTheta) - 1) > 1e-9)
    notes.push(
      String.raw`$\Omega=${p.omega === 0 ? '0' : '\\pi'}$：實係數的 error path 在這個頻率只能給實數響應（$\phi=0^\circ$ 或 $180^\circ$），$\phi=${t4(p.phiDeg)}^\circ$ 不是可實現的組合；此外 $x=A\cos\Omega n$ 在 $\Omega=0$ 或 $\pi$ 時 $P_x=A^2$ 而不是 $A^2/2$（勘誤 E46）。`,
    )
  else if (p.omega > 0 && p.omega * p.N < 20 * Math.PI)
    notes.push(
      String.raw`$\Omega N/2\pi=${t4((p.omega * p.N) / (2 * Math.PI))}$：每個 GMAC block 不到 10 個 code 週期，block 內的平均不再接近長期平均（$C$ 與 $P_x$ 會逐 block 起伏），這裡的平均模型只是粗略估計。`,
    )
  return { checks, warnings, notes }
}

/**
 * 解析交叉比對（同一個量用兩種獨立算法）：
 *   Σy²：Lyapunov 方程（d = 0 即封閉式）vs 照定義直接加總；Ω_3dB：封閉式 vs 數值掃描（d = 0）；g* 判據 vs 特徵根。
 */
function analyticCrossCheck(r: Omit<ThesisResult, 'checks' | 'warnings' | 'notes' | 'crossCheck'>): { ok: boolean; note: string } {
  const d = r.params.d
  const issues: string[] = []
  let compared = 0
  let energyCompared = 0
  let energySkipped = 0
  for (const m of r.modes) {
    if (!m.identifiable || !Number.isFinite(m.gain)) continue
    // g* 與根的一致性：0 < g < g* ⇔ max|z| < 1
    const byGain = m.gain > 0 && m.gain < criticalGain(d)
    const byRoot = m.radius < 1
    const nearEdge = Math.abs(m.gain - criticalGain(d)) < 1e-9 || Math.abs(m.gain) < 1e-12
    if (byGain !== byRoot && !nearEdge) issues.push(String.raw`$g=${t4(m.gain)}$：$g^*$ 判據與特徵根不一致`)
    compared++
    if (m.radius < 1) {
      if (m.energyConverged) {
        energyCompared++
        if (Math.abs(m.energySum - m.energy) > 1e-8 * m.energy) issues.push(String.raw`$\sum y^2$ 直接加總 $${t4(m.energySum)}$ vs Lyapunov $${t4(m.energy)}$`)
      } else energySkipped++
    }
    if (d === 0 && m.gain > 0 && m.gain < 2) {
      const wc = omega3dBClosed(m.gain)
      const wn = omega3dB(m.gain, 0)
      if (Number.isFinite(wc) !== Number.isFinite(wn) || (Number.isFinite(wc) && Math.abs(wc - wn) > 1e-9 * wc))
        issues.push(String.raw`$\Omega_{3\mathrm{dB}}$ 數值 $${t4(wn)}$ vs 封閉式 $${t4(wc)}$`)
    }
  }
  if (compared === 0) return { ok: true, note: '沒有可比對的 mode' }
  if (issues.length) return { ok: false, note: issues.join('；') }
  const parts = [String.raw`$g^*(d=${d})=${t4(criticalGain(d))}$ 與特徵根一致`]
  if (energyCompared > 0) parts.push(String.raw`$\sum y^2$：${d === 0 ? '封閉式' : 'Lyapunov 方程'} = 直接加總（相對誤差 $<10^{-8}$）`)
  if (energySkipped > 0) parts.push(String.raw`極慢的 mode 直接加總在 $3\times10^{5}$ 步內未收斂，$\sigma_w$ 只採 Lyapunov 解（該 mode 未做加總比對）`)
  if (d === 0) parts.push(String.raw`$f_{3\mathrm{dB}}$：封閉式 = 數值掃描`)
  if (r.crossAssumptionActive) parts.push(String.raw`雙參數的交叉相關假設 $E[x_iu_j]=C\,\tilde R_{ij}$ 不在這個比對範圍內`)
  return { ok: true, note: parts.join('；') }
}

export interface Trajectory {
  k: Float64Array
  /** E[w_k − a]（gain 參數）[fs] */
  mean: Float64Array
  /** √Var(w_k)（從 0 開始的暫態）[fs] */
  sd: Float64Array
  diverged: boolean
}

/** 建議的模擬長度：最慢 mode 的 5 個時間常數（40–20000 blocks）；不穩時 80 blocks */
export function suggestHorizon(r: ThesisResult): number {
  if (!r.stable) return 80
  const tau = r.maxRadius > 0 ? -1 / Math.log(r.maxRadius) : 1
  return Math.max(40, Math.min(20000, Math.ceil(5 * tau) + r.params.d + 2))
}

/**
 * 平均與標準差的時間軌跡（線性化平均模型；mode 座標各自遞迴）：
 *   ξ_{i,k+1} = ξ_{i,k} − g_i ξ_{i,k−d} − μ s K_q B·drive_i·v_i0，  Var(ξ_{i,k}) = q_i · c_{i,k}
 * gain 參數：w_k − a = −Σ v_i0 ξ_{i,k}。
 */
export function trajectory(r: ThesisResult, K: number): Trajectory {
  const p = r.params
  const k = new Float64Array(K + 1)
  const mean = new Float64Array(K + 1)
  const sd = new Float64Array(K + 1)
  let diverged = false
  const varAcc = new Float64Array(K + 1)
  for (let i = 0; i <= K; i++) k[i] = i
  for (const m of r.modes) {
    const L = p.d + 1
    // 環形緩衝：步驟 n 開始時 ring[n % L] = ξ_n，ring[(n+1) % L] = ξ_{n−d}（j < 0 時 pipeline 以初值填滿）
    const ring = new Float64Array(L).fill(m.xi0)
    const force = Number.isFinite(m.drive) ? p.mu * r.scale * r.Kq * p.B * m.drive * m.v0 : 0
    const gi = Number.isFinite(m.gain) ? m.gain : 0
    mean[0] += -m.v0 * m.xi0
    for (let n = 0; n < K; n++) {
      const cur = ring[n % L] // ξ_n
      const old = ring[(n + 1) % L] // ξ_{n−d}
      const next = cur - gi * old - force
      ring[(n + 1) % L] = next // ξ_{n−d} 之後不再需要，改存 ξ_{n+1}
      mean[n + 1] += -m.v0 * next
    }
    if (m.noise > 0 && Number.isFinite(m.noise)) {
      const c = cumulativeEnergy(gi, p.d, K)
      for (let n = 0; n <= K; n++) varAcc[n] += m.v0 * m.v0 * m.noise * c[n]
    }
  }
  for (let n = 0; n <= K; n++) {
    if (!Number.isFinite(mean[n]) || Math.abs(mean[n]) > 1e9) {
      diverged = true
      mean.fill(NaN, n)
      sd.fill(NaN, n)
      break
    }
    sd[n] = Math.sqrt(varAcc[n])
    if (!Number.isFinite(sd[n]) || sd[n] > 1e9) {
      diverged = true
      sd.fill(NaN, n)
    }
  }
  return { k, mean, sd, diverged }
}
