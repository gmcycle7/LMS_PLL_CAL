/**
 * Ch04 §3：clock domain 與 latency 計算（純函式；latency.test.ts 驗證）。
 *
 * 平均線性模型（δ = a − w，g = μK）。新 gain w_{k+1} 在 block k 結束後「d + d_f 個 block」才生效：
 *   d   ：整數 block 數；d_f ∈ [0, 1)：block 中途生效時的分數部分
 *        （符號說明：分數延遲寫成 d_f，不用 φ——φ(z) 在本章是 Gaussian 密度）。
 * 生效時刻落在 block 中途時，該 block 的前 d_f·N 個 sample 仍用舊 gain，平均 GMAC 按 sample 比例加權：
 *   δ_{k+1} = δ_k − g[(1 − d_f)·δ_{k−d} + d_f·δ_{k−d−1}]
 *   ⇒ 特徵方程 z^{d+2} − z^{d+1} + g(1 − d_f)·z + g·d_f = 0
 * - d_f = 0：z^{d+1} − z^d + g = 0，臨界 g = 2 sin(π/(4d+2))（規格 §8.3；Ch08；F-04.14）。
 * - d = 0：z² − (1 − g(1 − d_f))z + g·d_f = 0，Jury 條件給 g_crit = min(1/d_f, 2/(1 − 2d_f))（F-04.17）。
 * - 其餘（d ≥ 1 且 d_f > 0）：由 g = 0 往上找第一個 spectral radius ≥ 1 的 g（求根）。
 */

import { cAbs, polyRoots } from '@/simulation/core'

/** 警告字串內的 `$...$` 是行內 TeX（頁面以 mathText / mt 顯示） */
const R = String.raw

export type ApplyMode = 'boundary' | 'immediate'

export interface LatencyParams {
  /** comparator 取樣率 [GHz] */
  fsGHz: number
  N: number
  /** code 對齊延遲 D [samples] */
  D: number
  /** commit pipeline P_c [samples] */
  Pc: number
  /** 設計上額外等待的 block 數 */
  dCfg: number
  apply: ApplyMode
}

export interface LatencyResult {
  TsPs: number
  TblockUs: number
  fuKHz: number
  /** 等效更新延遲的整數部分 d [blocks] */
  dEff: number
  /** 分數部分 d_f ∈ [0, 1)（boundary 模式恆為 0） */
  dFrac: number
  /** 平均模型的臨界 loop gain */
  gCrit: number
  /** gCrit 的算法：封閉式（F-04.14）／Jury（F-04.17）／特徵方程求根／連續延拓近似（d 很大時） */
  gCritMethod: CriticalGainMethod
  /** 新 gain 生效時，所用資訊（block k 的中心 sample）的「年齡」[samples] */
  ageSamples: number
  ageUs: number
  warnings: string[]
}

/** 平均模型的特徵多項式（降冪）：z^{d+2} − z^{d+1} + g(1 − d_f)z + g·d_f；d_f = 0 時約掉一個 z 成為 z^{d+1} − z^d + g。 */
export function delayCharPoly(g: number, d: number, dFrac = 0): number[] {
  if (!(dFrac > 0)) {
    const poly = new Array<number>(d + 2).fill(0)
    poly[0] = 1
    poly[1] = -1
    poly[d + 1] += g
    return poly
  }
  const poly = new Array<number>(d + 3).fill(0)
  poly[0] = 1
  poly[1] = -1
  poly[d + 1] += g * (1 - dFrac) // z¹ 的係數（d = 0 時與 −z^{d+1} 同一項）
  poly[d + 2] += g * dFrac
  return poly
}

/** 特徵多項式在給定 g 下的 spectral radius（最大根的模）。 */
export function delaySpectralRadius(g: number, d: number, dFrac = 0): number {
  return polyRoots(delayCharPoly(g, d, dFrac)).reduce((m, z) => Math.max(m, cAbs(z)), 0)
}

/**
 * 臨界 g（平均模型由穩定變成不穩定的第一個 g）。
 * - d_f = 0：2 sin(π/(4d+2))（F-04.14）。
 * - d = 0、d_f > 0：對 z² + a₁z + a₀（a₁ = −(1 − g(1 − d_f))、a₀ = g·d_f）用 Jury 條件
 *     |a₀| < 1 ⇒ g < 1/d_f；1 − a₁ + a₀ > 0 ⇒ g(1 − 2d_f) < 2；1 + a₁ + a₀ = g > 0
 *   ⇒ g_crit = min(1/d_f, 2/(1 − 2d_f))（d_f < ½），= 1/d_f（d_f ≥ ½）（F-04.17）。
 *   d_f → 0 回到 2，d_f = 1 回到 d = 1 的 1；中間在 d_f = ¼ 達到 4（舊 w 的部分權重像兩點平均，壓低 z = −1 的振盪模態）。
 * - d ≥ 1、d_f > 0：沒有簡單的封閉式，從 g = 0 往上掃到第一個 spectral radius ≥ 1，再二分法。
 *   d > ROOT_MAX_DELAY 時多項式次數太高，改用整數公式的連續延拓 2 sin(π/(4(d + d_f) + 2))（d = 32 時與求根相差 < 0.03%）。
 */
export function criticalGain(d: number, dFrac = 0): number {
  return criticalGainInfo(d, dFrac).g
}

export type CriticalGainMethod = 'closed_form' | 'jury' | 'root_finding' | 'continuation'

/** 求根法處理的最大整數延遲（block）；更大的 d 用連續延拓近似。 */
export const ROOT_MAX_DELAY = 32

/** criticalGain 與所用的方法（UI 用來標示精確或近似）。 */
export function criticalGainInfo(d: number, dFrac = 0): { g: number; method: CriticalGainMethod } {
  if (!(dFrac > 0)) return { g: 2 * Math.sin(Math.PI / (4 * d + 2)), method: 'closed_form' }
  if (d === 0) {
    const byProduct = 1 / dFrac
    return { g: dFrac < 0.5 ? Math.min(byProduct, 2 / (1 - 2 * dFrac)) : byProduct, method: 'jury' }
  }
  if (d > ROOT_MAX_DELAY) return { g: 2 * Math.sin(Math.PI / (4 * (d + dFrac) + 2)), method: 'continuation' }
  // g → 0⁺ 時 z = 1 的根往圓內移（1 − g），其餘 d + 1 個根在原點附近：小 g 一定穩定
  const step = 0.005
  let lo = 0
  let hi = NaN
  for (let g = step; g <= 4.5; g += step) {
    if (delaySpectralRadius(g, d, dFrac) >= 1) {
      hi = g
      break
    }
    lo = g
  }
  if (!Number.isFinite(hi)) return { g: NaN, method: 'root_finding' }
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi)
    if (delaySpectralRadius(mid, d, dFrac) >= 1) hi = mid
    else lo = mid
  }
  return { g: 0.5 * (lo + hi), method: 'root_finding' }
}

export function latencyCalc(p: LatencyParams): LatencyResult {
  const warnings: string[] = []
  const Ts = 1 / (p.fsGHz * 1e9)
  const Tblock = p.N * Ts
  // block k 在 sample (k+1)N − 1 結束；新 gain 在 (k+1+dCfg)N + P_c 才 ready
  //   boundary ：等下一個 block 邊界 ⇒ 整數延遲 dCfg + ⌈P_c/N⌉
  //   immediate：ready 就生效 ⇒ dCfg + ⌊P_c/N⌋ 個整 block，再加分數 d_f = (P_c mod N)/N
  const whole = Math.floor(p.Pc / p.N)
  const rem = p.Pc - whole * p.N
  const dEff = p.apply === 'boundary' ? p.dCfg + Math.ceil(p.Pc / p.N) : p.dCfg + whole
  const dFrac = p.apply === 'immediate' ? rem / p.N : 0
  if (p.Pc > p.N) {
    const cost = p.apply === 'boundary' ? R`$\lceil P_c/N\rceil=${Math.ceil(p.Pc / p.N)}$ 個 block` : `${whole} 個整 block 再加 ${rem} 個 sample`
    warnings.push(R`$P_c=${p.Pc}>N=${p.N}$：commit 比一個 block 還慢，光是 pipeline 就佔 ${cost}的更新延遲（$g_\mathrm{crit}$ 跟著下降）`)
  }
  const { g: gCrit, method: gCritMethod } = criticalGainInfo(dEff, dFrac)
  // block k 中心 sample (kN + N/2) 到新 gain 生效的距離
  const age = p.N / 2 + dEff * p.N + dFrac * p.N
  if (p.D > p.N) warnings.push(R`$D=${p.D}>N=${p.N}$：code 對齊延遲超過一個 block，GMAC 的 block 邊界需要跟著平移`)
  if (dFrac > 0) warnings.push(R`immediate：新 gain 在 block 中途生效，該 block 的 $G$ 混用了新舊兩個 $w$（分數延遲 $d_\mathrm{f}=${rem}/${p.N}$）；$P_c$ 一變，迴路的 pole 就跟著變`)
  return {
    TsPs: Ts * 1e12,
    TblockUs: Tblock * 1e6,
    fuKHz: 1 / Tblock / 1e3,
    dEff,
    dFrac,
    gCrit,
    gCritMethod,
    ageSamples: age,
    ageUs: age * Ts * 1e6,
    warnings,
  }
}
