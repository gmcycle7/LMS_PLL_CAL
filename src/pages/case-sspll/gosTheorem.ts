/**
 * GOS「D = 0 不反號」：從猜想到定理（案例頁 §7b；docs/analysis/sspll-gos-d0-theorem.md）。
 *
 * 模型（與 §7 相同）：線性小訊號 PLL（L2）、D = 0、raw regressor、凍結權重。GOS 的自我斜率是鋸齒諧波和（F-CS.11）
 *   C(β) = Σ_{m≥1} w_m g(frac(mβ)),   w_m = 1/(2π²m²),   g(f) = Re H_PD(e^{j2πf}),
 * g 以 1 為週期、g(f) = g(−f)（實係數的脈衝響應）。要證的是 C(β) > 0 對所有 β ∈ (0, 1)。
 *
 *   L1（Re H_PD ≥ 0 處處成立）：每一項 ≥ 0，一行證完（gosTypeIPositive）。
 *   L2／L3（Re H_PD 在 0–f_inv 為負）：電腦輔助的「證書」（gosCertificate）——
 *     (1) g 的 Lipschitz 常數 L_g = 2π Σ_n n|h[n]|（g(f) = Σ h[n] cos 2πfn 逐項微分；尾項用極點的留數展開 h[n] = Σ c_i λ_i^n 壓住）；
 *     (2) 截斷和 C_M(β) = Σ_{m≤M} w_m g(frac(mβ)) 對 β 的 Lipschitz 常數 Λ_M = L_g·H_M/(2π²)（H_M 是調和數）；
 *     (3) 尾項 Σ_{m>M} w_m g ≥ g_min·T_M，T_M = Σ_{m>M} w_m = ζ(2, M+1)/(2π²)，g_min 由細格點的最小值減 L_g·h/2 得到（下界）；
 *     (4) 在 β_i 算 LB_i = C_M(β_i) + g_min T_M；LB_i > 0 時，[β_i, β_i + LB_i/Λ_M] 上的 C 都 > 0（Lipschitz）；
 *     (5) 從 β_0 走到 1/2，每一步 β_{i+1} = β_i + LB_i/Λ_M 都直接重算 LB（沒有一點是靠推測的）；C(β) = C(1−β) 把 (1/2, 1−β_0] 補上。
 *   證書成立就是定理（在所述模型內精確；浮點誤差 ~1e-13，遠小於最小的 LB ~1e-3）；證書失敗不代表有反例（只是步長或 M 不夠）。
 *   β < β_0 的部分用 §7.2 的慢鋸齒漸近式 C ≈ β²/K_i 收尾（近似｜需驗證；gosRationalBeta 在 β = 1/b 上逐點檢查比值）。
 *
 * 純函式、不 import React／DOM。Python 版：analysis/sspll/golden/sspll_golden/gos_certificate.py（gosTheorem.test.ts 逐項比對 results/gos_certificate.json）。
 */
import { c, cAbs, cDiv, cMul, cScale, type Complex } from '@/simulation/core/complex'
import { polyDer, polyRoots, polyvalC } from '@/simulation/core/poly'
import { hurwitzZeta2, loopH, loopImpulse, typeIReH, type SspllLoop } from '@/simulation/models/sspll'

const TWO_PI2 = 2 * Math.PI * Math.PI
const frac = (x: number): number => x - Math.floor(x)

/** 第 m 次諧波的功率 w_m = 1/(2π²m²)（F-CS.11；Σ_m w_m = 1/12） */
export function harmonicWeight(m: number): number {
  return 1 / (TWO_PI2 * m * m)
}

/** 調和數 H_M = Σ_{m≤M} 1/m */
export function harmonicNumber(M: number): number {
  let s = 0
  for (let m = 1; m <= M; m++) s += 1 / m
  return s
}

/** 尾項的總權重 T_M = Σ_{m>M} w_m = ζ(2, M+1)/(2π²) */
export function harmonicTailWeight(M: number): number {
  return hurwitzZeta2(M + 1) / TWO_PI2
}

/** Re H_PD(f)：證書裡的 g(f) */
export function gosKernel(loop: SspllLoop, f: number): number {
  return loopH(loop, f).re
}

// #region core:gosTypeIPositive
/**
 * L1 的一行證明：L = Kz⁻¹/(1 − z⁻¹) ⇒ Re H_PD = (2 − K)(1 − cos Ω)/|1 − (1 − K)e^{−jΩ}|²（F-CS.7），0 < K < 2 時對所有 f ≥ 0，
 * 只有 f ∈ ℤ 時為 0。鋸齒的每條諧波 w_m > 0，所以 C(β) = Σ w_m Re H(frac(mβ)) ≥ 0；β ∉ ℤ 時 m = 1 那一項嚴格為正，C(β) > 0。
 * 回傳 m = 1 的那一項（嚴格正的證據）與前 M 項的和。
 */
export function gosTypeIPositive(K: number, beta: number, M = 1000): { ok: boolean; firstTerm: number; partial: number } {
  if (!(K > 0 && K < 2)) return { ok: false, firstTerm: NaN, partial: NaN }
  const b = frac(beta)
  const firstTerm = harmonicWeight(1) * typeIReH(K, b) // (2 − K)(1 − cos 2πβ) > 0 ⇔ β ∉ ℤ
  let partial = 0
  for (let m = 1; m <= M; m++) partial += harmonicWeight(m) * typeIReH(K, frac(m * b)) // 每一項 ≥ 0
  return { ok: b !== 0 && firstTerm > 0, firstTerm, partial }
}
// #endregion core:gosTypeIPositive

export interface GosLipschitz {
  /** L_g = 2π(Σ_{n≤N} n|h[n]| + 尾項上界) */
  Lg: number
  /** Σ_{n=1}^{N} n|h[n]|（直接遞迴算出的脈衝響應） */
  sumN: number
  /** 尾項 Σ_{n>N} n|h[n]| 的上界 Σ_i |c_i| ρ_i^{N+1}((N+1)(1−ρ_i)+ρ_i)/(1−ρ_i)²；留數展開驗證失敗時 NaN */
  tail: number
  N: number
  /** 極點半徑的最大值 */
  rhoMax: number
  /** 留數展開 h[n] = Σ c_i λ_i^n（1 ≤ n < 60）與遞迴算出的 h[n] 的最大差（驗證用） */
  residualErr: number
  /** 尾項上界是否成立（極點都是單根、不在原點、留數展開重現 h[n]） */
  tailBounded: boolean
}

/** H_PD(z) = B(z)/A(z) 的極點 λ_i 與留數 c_i（h[n] = c_0 δ[n] + Σ c_i λ_i^n）：B、A 是 z 的降冪多項式（由 z⁻¹ 升冪的 bH、aH 乘 z^p 得到） */
function residues(loop: SspllLoop): { lambda: Complex[]; coef: Complex[]; c0: number; valid: boolean } {
  const p = Math.max(loop.bH.length, loop.aH.length) - 1
  const B = new Array<number>(p + 1).fill(0)
  const A = new Array<number>(p + 1).fill(0)
  for (let k = 0; k < loop.bH.length; k++) B[k] = loop.bH[k] // 係數 z^{p−k}：z⁻¹ 升冪與 z 降冪是同一個順序
  for (let k = 0; k < loop.aH.length; k++) A[k] = loop.aH[k]
  const lambda = polyRoots(A)
  const dA = polyDer(A)
  const A0 = A[p]
  const scale = Math.max(1, ...A.map((v) => Math.abs(v)))
  let valid = Math.abs(A0) > 1e-12 * scale
  const coef = lambda.map((l) => {
    const denom = cMul(l, polyvalC(dA, l))
    if (cAbs(l) < 1e-9 || cAbs(denom) < 1e-12 * scale) valid = false
    return valid ? cDiv(polyvalC(B, l), denom) : c(NaN, NaN)
  })
  return { lambda, coef, c0: valid ? B[0] / A[0] : NaN, valid } // h[0] = lim_{z→∞} B(z)/A(z) = 首項係數之比（未用於 L_g：和只從 n = 1 起）
}

// #region core:gosLipschitz
/**
 * g(f) = Re H_PD(e^{j2πf}) = Σ_n h[n] cos(2πfn) ⇒ |g'(f)| ≤ 2π Σ_n n|h[n]| =: L_g。
 * 前 N 項直接用脈衝響應相加；n > N 的尾項用留數展開 |h[n]| ≤ Σ_i|c_i|ρ_i^n 壓住（Σ_{n>N} nρ^n 有封閉式）。
 * 留數展開先和遞迴算出的 h[n]（1 ≤ n < 60）比對，對不上（重根、原點極點）就回報 tailBounded = false。
 */
export function gosLipschitz(loop: SspllLoop, N = 4096): GosLipschitz {
  const h = loopImpulse(loop, N + 1)
  let sumN = 0
  let hMax = 0
  for (let n = 1; n <= N; n++) {
    sumN += n * Math.abs(h[n])
    hMax = Math.max(hMax, Math.abs(h[n]))
  }
  const { lambda, coef, valid } = residues(loop)
  let residualErr = 0
  if (valid) {
    for (let n = 1; n < Math.min(60, N + 1); n++) {
      let re = 0
      for (let i = 0; i < lambda.length; i++) {
        const pow = { re: Math.cos(n * Math.atan2(lambda[i].im, lambda[i].re)), im: Math.sin(n * Math.atan2(lambda[i].im, lambda[i].re)) }
        const r = Math.pow(cAbs(lambda[i]), n)
        re += cMul(coef[i], cScale(pow, r)).re
      }
      residualErr = Math.max(residualErr, Math.abs(re - h[n]))
    }
  }
  const rhoMax = lambda.length ? Math.max(...lambda.map((l) => cAbs(l))) : 0
  const tailBounded = valid && rhoMax < 1 && residualErr <= 1e-9 * Math.max(1, hMax)
  let tail = NaN
  if (tailBounded) {
    tail = 0
    for (let i = 0; i < lambda.length; i++) {
      const rho = cAbs(lambda[i])
      tail += (cAbs(coef[i]) * Math.pow(rho, N + 1) * ((N + 1) * (1 - rho) + rho)) / ((1 - rho) * (1 - rho)) // Σ_{n>N} n ρ^n
    }
  }
  return { Lg: 2 * Math.PI * (sumN + (tailBounded ? tail : 0)), sumN, tail, N, rhoMax, residualErr, tailBounded }
}
// #endregion core:gosLipschitz

/** g 的下界：細格點 f_j = j/(2(n_f − 1)) 上的最小值減 L_g·h/2（任何 f 離某個格點不超過 h/2）；只取 ≤ 0 的部分（尾項只需要下界） */
export function gosKernelMin(loop: SspllLoop, Lg: number, nf = 200001): { gMin: number; gridMin: number; fAtMin: number } {
  let gridMin = Infinity
  let fAtMin = 0
  const h = 0.5 / (nf - 1)
  for (let j = 0; j < nf; j++) {
    const f = j * h
    const g = loopH(loop, f).re
    if (g < gridMin) {
      gridMin = g
      fAtMin = f
    }
  }
  return { gMin: Math.min(0, gridMin - (Lg * h) / 2), gridMin, fAtMin }
}

/** 截斷和 C_M(β) = Σ_{m≤M} w_m g(frac(mβ))（精確計算的部分） */
export function gosPartialSum(loop: SspllLoop, beta: number, M: number): number {
  let s = 0
  for (let m = 1; m <= M; m++) s += harmonicWeight(m) * loopH(loop, frac(m * beta)).re
  return s
}

export interface GosCertificateOptions {
  /** 證書的起點 β_0（預設 0.016；更小要配更大的 M） */
  betaMin?: number
  /** 終點（預設 1/2；C(β) = C(1 − β) 補上另一半） */
  betaMax?: number
  /** 截斷和的項數 M（預設 1000） */
  M?: number
  /** g_min 的格點數（預設 200001） */
  nf?: number
  /** Lipschitz 常數用的脈衝響應長度（預設 4096） */
  N?: number
  /** 步數上限（預設 200000；超過就回報失敗而不是卡住） */
  maxSteps?: number
}

export interface GosCertificate {
  ok: boolean
  /** 失敗原因（ok = false 時） */
  reason?: string
  betaMin: number
  betaMax: number
  M: number
  Lg: number
  /** Λ_M = L_g H_M/(2π²) */
  LamM: number
  /** g 的下界（≤ 0） */
  gMin: number
  /** T_M = Σ_{m>M} w_m */
  tailWeight: number
  /** 尾項的下界 g_min·T_M */
  tailLower: number
  steps: number
  /** 所有格點中最小的下界 LB_i 與它的位置 */
  worstLower: number
  worstAt: number
  /** 最小的步長 */
  minStep: number
  /** 失敗時的 β（LB ≤ 0 的第一個格點） */
  failAt?: number
  lipschitz: GosLipschitz
}

// #region core:gosCertificate
/**
 * 從 β_0 走到 β_max：每個格點 β_i 直接算 LB_i = C_M(β_i) + g_min T_M；LB_i > 0 時 Lipschitz 保證 [β_i, β_i + LB_i/Λ_M] 上 C > 0，
 * 下一個格點就取 β_i + LB_i/Λ_M（也直接重算）。走完就證明了 C(β) > 0 對所有 β ∈ [β_0, β_max]；碰到 LB_i ≤ 0 就停（證書失敗，不是反例）。
 */
export function gosCertificate(loop: SspllLoop, o: GosCertificateOptions = {}): GosCertificate {
  const betaMin = o.betaMin ?? 0.016
  const betaMax = o.betaMax ?? 0.5
  const M = o.M ?? 1000
  const lip = gosLipschitz(loop, o.N ?? 4096)
  const LamM = (lip.Lg * harmonicNumber(M)) / TWO_PI2 // C_M 對 β 的 Lipschitz 常數
  const { gMin } = gosKernelMin(loop, lip.Lg, o.nf ?? 200001)
  const tailWeight = harmonicTailWeight(M)
  const tailLower = gMin * tailWeight // 尾項最多扣掉這麼多
  const base = { betaMin, betaMax, M, Lg: lip.Lg, LamM, gMin, tailWeight, tailLower, lipschitz: lip }
  if (!lip.tailBounded) return { ...base, ok: false, reason: '脈衝響應的尾項無法用留數展開壓住（重根或原點極點）：L_g 不是嚴格的上界', steps: 0, worstLower: NaN, worstAt: NaN, minStep: NaN }
  const maxSteps = o.maxSteps ?? 200_000
  let beta = betaMin
  let steps = 0
  let worstLower = Infinity
  let worstAt = betaMin
  let minStep = Infinity
  while (beta < betaMax) {
    const lb = gosPartialSum(loop, beta, M) + tailLower // 這一點的下界：精確的截斷和 + 尾項下界
    if (!(lb > 0)) return { ...base, ok: false, reason: `β = ${beta} 的下界 ${lb} ≤ 0：步長或 M 不夠（不是反例）`, steps, worstLower, worstAt, minStep, failAt: beta }
    if (lb < worstLower) {
      worstLower = lb
      worstAt = beta
    }
    const step = lb / LamM // Lipschitz：往右走這麼遠之內 C 仍 > 0
    minStep = Math.min(minStep, step)
    beta = Math.min(betaMax, beta + step)
    steps++
    if (steps > maxSteps) return { ...base, ok: false, reason: `超過 ${maxSteps} 步仍未走到 β_max`, steps, worstLower, worstAt, minStep, failAt: beta }
  }
  // 終點也直接算一次
  const lbEnd = gosPartialSum(loop, betaMax, M) + tailLower
  if (!(lbEnd > 0)) return { ...base, ok: false, reason: `β_max 的下界 ${lbEnd} ≤ 0`, steps, worstLower, worstAt, minStep, failAt: betaMax }
  if (lbEnd < worstLower) {
    worstLower = lbEnd
    worstAt = betaMax
  }
  return { ...base, ok: true, steps, worstLower, worstAt, minStep }
}
// #endregion core:gosCertificate

export interface GosPointCertificate {
  beta: number
  M: number
  terms: { m: number; f: number; g: number; w: number; contrib: number }[]
  /** C_M(β) */
  CM: number
  gMin: number
  tailWeight: number
  tailLower: number
  /** LB = C_M + g_min T_M */
  lower: number
  Lg: number
  LamM: number
  /** LB/Λ_M：這一點左右多遠之內 C 仍保證為正 */
  delta: number
}

/** 單點證書（手算題 HC-CS.10 與表格用）：前 M 項逐項列出，尾項用 g_min 壓住 */
export function gosPointCertificate(loop: SspllLoop, beta: number, M = 4, lip?: GosLipschitz, gMinIn?: number): GosPointCertificate {
  const l = lip ?? gosLipschitz(loop)
  const gMin = gMinIn ?? gosKernelMin(loop, l.Lg).gMin
  const terms = []
  let CM = 0
  for (let m = 1; m <= M; m++) {
    const f = frac(m * beta)
    const g = loopH(loop, f).re
    const w = harmonicWeight(m)
    terms.push({ m, f, g, w, contrib: w * g })
    CM += w * g
  }
  const tailWeight = harmonicTailWeight(M)
  const tailLower = gMin * tailWeight
  const lower = CM + tailLower
  const LamM = (l.Lg * harmonicNumber(M)) / TWO_PI2
  return { beta, M, terms, CM, gMin, tailWeight, tailLower, lower, Lg: l.Lg, LamM, delta: lower / LamM }
}
