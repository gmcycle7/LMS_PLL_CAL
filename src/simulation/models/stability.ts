/**
 * Calibration loop 穩定性模型（規格 §8；模型層級 L1 平均模型 / L2 雙迴路抽象觀測模型）。Ch08 擁有。
 * 頁面以 `?raw` + `#region core:*` 直接顯示這些程式碼（docs/teaching-style.md §4）。
 *
 * ── 一階 block-rate calibration loop（§8.2）──
 *   G_k = K·δ_k，δ_k = a − w_k（全站極性約定），w_{k+1} = w_k + μ·G_k
 *   ⇒ δ_{k+1} = (1 − g)·δ_k，g = μK（無因次 normalized loop gain；K = K_q·C）
 *   開迴路 L_cal(z) = g/(z − 1)，閉迴路 pole 1 − g，PM = 90° − asin(g/2)（0 < g ≤ 2）。
 *
 * ── 更新延遲 d 個 block（§8.3）──
 *   δ_{k+1} = δ_k − g·δ_{k−d}，L(z) = g·z^{−d}/(z − 1)，特徵式 z^{d+1} − z^d + g = 0，
 *   臨界增益 g* = 2 sin(π/(4d+2))，臨界根角度 ω* = π/(2d+1)，PM_d = 90° − (2d+1)·asin(g/2)。
 *
 * ── 雙迴路（§8.4；記號依勘誤 E31：r_s, b_s, c_s 與 A_s, b_s, c_sᵀ, d_s）──
 *   s_{k+1} = r·s_k + b·δ_k，G_k = c·s_k，δ_{k+1} = δ_k − μ·G_k
 *   ⇒ [s; δ]_{k+1} = [[r, b], [−μc, 1]]·[s; δ]_k，特徵式 z² − (1+r)z + (r + μbc)。
 *   完整模型（Jury）：0 < μbc < 1 − r；quasi-static（s = bδ/(1−r)）：0 < μbc < 2(1 − r)（勘誤 E19）。
 *   頻域版本：L = μbc/((z−1)(z−r))，cos ω_180 = (1+r)/2，|L(ω_180)| = g_eff = μbc/(1−r)
 *   ⇒ GM_完整 = 1/g_eff = ½·GM_quasi-static（與 r 無關；完整模型的界限 g_eff < 1 就是 §8.3 d = 1 的 g*）。
 *   一般化：A_comb = [[A_s, b_s], [−μc_sᵀ, 1 − μd_s]]，F(z) = d_s + c_sᵀ(zI − A_s)⁻¹b_s，L_cal = μF(z)/(z − 1)。
 *
 * ── Polarity margin（§8.1，勘誤 E20）──
 *   wrap_180(θ) ≜ ((θ + 180°) mod 360°) − 180° ∈ [−180°, 180°)，M = 90° − |wrap_180(θ)| = asin(cos θ)。
 *
 * 純數值、無 React/DOM；所有函式不改動輸入。
 */

import {
  c,
  cAbs,
  cAdd,
  cArg,
  cDiv,
  cExpj,
  cMul,
  cScale,
  cSub,
  eigvals,
  polyRoots,
  solve,
  studentTInv,
  type Complex,
  type Matrix,
} from '@/simulation/core'
import type { BlockLmsConfigInput } from '@/simulation/models/blockLms'

/** |ρ − 1| ≤ MARGINAL_TOL 視為「臨界／marginal」（不可顯示為穩定） */
export const MARGINAL_TOL = 1e-9

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180

// ═══════════════════════════════════════════════════════════════════════════
// §8.1 Polarity margin（勘誤 E20）
// ═══════════════════════════════════════════════════════════════════════════

// #region core:wrap180
/** 非負餘數：posMod(−30, 360) = 330（JavaScript 的 % 對負數會回傳負值，不能直接用） */
export function posMod(x: number, m: number): number {
  return ((x % m) + m) % m
}

/** 勘誤 E20 的定義：wrap_180(θ) ≜ ((θ + 180°) mod 360°) − 180°，值域 [−180°, 180°)，週期 360° */
export function wrap180Spec(thetaDeg: number): number {
  return posMod(thetaDeg + 180, 360) - 180
}
// #endregion

// #region core:polarityMarginWrap
/** 正確版（E20）：M = 90° − |wrap_180(θ)|。M > 0 ⇔ cos θ > 0（有恢復力）。 */
export function polarityMarginWrap(thetaDeg: number): number {
  const wrapped = posMod(thetaDeg + 180, 360) - 180 // ← 差異：週期 360°，結果落在 [−180°, 180°)
  return 90 - Math.abs(wrapped)
}
// #endregion

// #region core:polarityMarginArcsin
/** 免 wrap 的等價封閉式：M = asin(cos θ)（度），值域 [−90°, 90°]。網站實作採用此式。 */
export function polarityMarginArcsin(thetaDeg: number): number {
  const cosTheta = Math.cos(thetaDeg * DEG2RAD)
  return Math.asin(Math.max(-1, Math.min(1, cosTheta))) * RAD2DEG // ← 差異：直接 asin(cos θ)，不需要 wrap
}
// #endregion

// #region core:polarityMarginMod180Bug
/** 反面教材：把 wrap_180 誤寫成 θ mod 180°（值域 [0°, 180°)）。θ = −150° 會得到 +60°（實際應為 −60°）。 */
export function polarityMarginMod180Bug(thetaDeg: number): number {
  const wrapped = posMod(thetaDeg, 180) // ← 差異（錯誤）：週期誤用 180°，負角度被折成正的
  return 90 - Math.abs(wrapped)
}
// #endregion

// ═══════════════════════════════════════════════════════════════════════════
// §8.2 一階 calibration loop：L_cal(z) = g/(z − 1)
// ═══════════════════════════════════════════════════════════════════════════

// #region core:calLoopGain
/**
 * 開迴路頻率響應 L(e^{jω}) = g·e^{−jdω}/(e^{jω} − 1)，ω [rad/block]。
 * d = 0 就是 §8.2 的 g/(z − 1)；d ≥ 1 是 §8.3 的純更新延遲。
 */
export function calLoopGain(g: number, d: number, omega: number): Complex {
  const z = cExpj(omega) // 單位圓上的點 z = e^{jω}
  const delay = cExpj(-d * omega) // z^{−d}：d 個 block 的純延遲
  return cDiv(cScale(delay, g), cSub(z, c(1))) // g·z^{−d}/(z − 1)
}
// #endregion

/** 相位展開（unwrap）：相鄰點相差超過 180° 時補 ±360°（與 numpy.unwrap 相同概念，單位 deg） */
export function unwrapDeg(phases: ArrayLike<number>): Float64Array {
  const out = new Float64Array(phases.length)
  if (phases.length === 0) return out
  out[0] = phases[0]
  let offset = 0
  for (let i = 1; i < phases.length; i++) {
    const step = phases[i] - phases[i - 1]
    if (step > 180) offset -= 360 * Math.round(step / 360)
    else if (step < -180) offset += 360 * Math.round(-step / 360)
    out[i] = phases[i] + offset
  }
  return out
}

export interface LoopResponse {
  omega: Float64Array
  re: Float64Array
  im: Float64Array
  mag: Float64Array
  magDb: Float64Array
  /** 由最低頻開始展開的連續相位 [deg] */
  phaseDeg: Float64Array
}

/**
 * 任意開迴路 L(ω) 在 ω 網格上的響應（相位已展開）。
 *
 * `lagBranch`：展開相位的起點只能由 atan2 的主值 (−180°, 180°] 決定，所以「增益變號」的迴路
 * （例如 g < 0 的 −|g|/(z − 1)）低頻相位會被畫成 +90°，容易被誤讀成「PM = 270°」。
 * 設 `lagBranch = true` 時，若最低頻的相位 > 0 就整條減 360°（+90° → −270°）：負號＝多 180° 的 lag，
 * 曲線從一開始就在 −180° 以下，Bode 圖的讀法（PM = 180° + ∠L）才與「極性錯誤 ⇒ 不穩定」一致。
 * 只在呼叫端確定低頻增益為負時使用；預設 false（不改變主值起點）。
 */
export function loopResponse(L: (omega: number) => Complex, omegas: ArrayLike<number>, lagBranch = false): LoopResponse {
  const n = omegas.length
  const omega = Float64Array.from(omegas)
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const mag = new Float64Array(n)
  const magDb = new Float64Array(n)
  const raw = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const v = L(omega[i])
    re[i] = v.re
    im[i] = v.im
    mag[i] = cAbs(v)
    magDb[i] = 20 * Math.log10(mag[i])
    raw[i] = cArg(v) * RAD2DEG
  }
  const phaseDeg = unwrapDeg(raw)
  if (lagBranch && n > 0 && phaseDeg[0] > 0) for (let i = 0; i < n; i++) phaseDeg[i] -= 360
  return { omega, re, im, mag, magDb, phaseDeg }
}

/**
 * 一階（含延遲）calibration loop 的頻率響應。g < 0（極性錯誤）時相位採 lag 分支：
 * ∠L = −270° − (d + ½)ω（而不是 +90° − (d + ½)ω），見 loopResponse 的說明。
 */
export function calLoopResponse(g: number, d: number, omegas: ArrayLike<number>): LoopResponse {
  return loopResponse((w) => calLoopGain(g, d, w), omegas, g < 0)
}

/** 對數間隔的 ω 網格 [ωmin, π]（最後一點精確等於 π） */
export function logOmegaGrid(points = 400, omegaMin = 1e-3, omegaMax = Math.PI): Float64Array {
  const out = new Float64Array(points)
  const a = Math.log10(omegaMin)
  const b = Math.log10(omegaMax)
  for (let i = 0; i < points; i++) out[i] = 10 ** (a + ((b - a) * i) / (points - 1))
  out[points - 1] = omegaMax
  return out
}

export interface FirstOrderPm {
  g: number
  /** 閉迴路 pole 1 − g */
  pole: number
  /** |pole| < 1 */
  stable: boolean
  /** |pole| = 1（g = 0 或 g = 2）：臨界，不可視為穩定 */
  marginal: boolean
  /** gain crossover ω_c [rad/block]；g ≤ 0 或 g > 2 時沒有 crossover → NaN */
  omegaC: number
  /** PM [deg]；沒有 crossover 時 NaN */
  pmDeg: number
  /** Gain margin 20log10(2/g) [dB]；g ≤ 0 時 NaN */
  gmDb: number
  /** Delay margin = PM[rad]/ω_c [blocks]：還能額外容忍的純延遲 */
  delayMarginBlocks: number
  /** 收斂時間常數 −1/ln|p| [blocks]（|p| ≥ 1 或 p = 0 時 NaN／0） */
  tauBlocks: number
}

// #region core:pmFirstOrder
/**
 * §8.2 一階模型的所有封閉式（T08）：
 *   pole = 1 − g；|e^{jω} − 1| = 2 sin(ω/2) = g ⇒ ω_c = 2 asin(g/2)；
 *   ∠L(e^{jω_c}) = −90° − ω_c/2 ⇒ PM = 180° + ∠L = 90° − asin(g/2)；GM = 2/g。
 */
export function pmFirstOrder(g: number): FirstOrderPm {
  const pole = 1 - g // 閉迴路特徵式 z − 1 + g = 0
  const absPole = Math.abs(pole)
  const hasCrossover = g > 0 && g <= 2 // |L| = g/(2 sin(ω/2)) 的最小值是 g/2（ω = π）
  const omegaC = hasCrossover ? 2 * Math.asin(g / 2) : NaN // 解 2 sin(ω_c/2) = g
  const pmDeg = hasCrossover ? 90 - Math.asin(g / 2) * RAD2DEG : NaN // ← 差異：d = 0，PM = 180° + (−90° − ω_c/2)
  const gmDb = g > 0 ? 20 * Math.log10(2 / g) : NaN // ← 差異：Nyquist 曲線在 ω = π 穿過 −g/2，GM = 2/g
  const delayMarginBlocks = hasCrossover ? (pmDeg * DEG2RAD) / omegaC : NaN
  return {
    g,
    pole,
    stable: absPole < 1 - MARGINAL_TOL,
    marginal: Math.abs(absPole - 1) <= MARGINAL_TOL,
    omegaC,
    pmDeg,
    gmDb,
    delayMarginBlocks,
    tauBlocks: absPole === 0 ? 0 : absPole < 1 ? -1 / Math.log(absPole) : NaN,
  }
}
// #endregion

// #region core:blockRateToHz
/** 係數更新率 f_u = f_s/N [Hz]：GMAC 每累加 N 個 comparator sample 才更新一次（block rate） */
export function updateRateHz(fsHz: number, N: number): number {
  return fsHz / N
}

/** block-rate 離散頻率換成實際頻率：f = ω·f_u/(2π) [Hz]（ω [rad/block]；0 ≤ ω ≤ π ⇔ 0 ≤ f ≤ f_u/2） */
export function omegaToHz(omega: number, fuHz: number): number {
  return (omega * fuHz) / (2 * Math.PI)
}
// #endregion

// ═══════════════════════════════════════════════════════════════════════════
// §8.3 更新延遲：δ_{k+1} = δ_k − g·δ_{k−d}
// ═══════════════════════════════════════════════════════════════════════════

// #region core:delayCharPoly
/** 特徵多項式 z^{d+1} − z^d + g（降冪係數）。d = 0 → [1, g − 1]；d = 2 → [1, −1, 0, g]。 */
export function delayCharPoly(g: number, d: number): number[] {
  if (!Number.isInteger(d) || d < 0) throw new Error(`更新延遲 d 必須是非負整數（收到 ${d}）`)
  const p = new Array<number>(d + 2).fill(0)
  p[0] = 1 // z^{d+1}
  p[1] = -1 // −z^d
  p[d + 1] += g // + g（常數項；d = 0 時與 −1 合併成 g − 1）
  return p
}
// #endregion

export interface DelayStability {
  g: number
  d: number
  /** 特徵式的全部根（|z| 由大到小） */
  roots: Complex[]
  /** spectral radius ρ = max|z| */
  rho: number
  stable: boolean
  /** ρ 與 1 的差 ≤ MARGINAL_TOL：臨界（例如 g 恰為 g*） */
  marginal: boolean
}

// #region core:delayStable
/** 以多項式求根判斷穩定：所有根都在單位圓內 ⇔ 平均誤差收斂（不使用封閉式，可與 g* 交叉比對） */
export function delayStable(g: number, d: number): DelayStability {
  const roots = polyRoots(delayCharPoly(g, d)) // ← 差異：直接求 d + 1 個根（companion matrix + Newton polish），不用任何封閉式
  let rho = 0
  for (const z of roots) rho = Math.max(rho, cAbs(z))
  return {
    g,
    d,
    roots,
    rho,
    stable: rho < 1 - MARGINAL_TOL,
    marginal: Math.abs(rho - 1) <= MARGINAL_TOL,
  }
}
// #endregion

// #region core:delayCriticalGain
/**
 * 臨界增益的封閉式 g* = 2 sin(π/(4d+2))，對應的單位圓根角度 ω* = π/(2d+1)。
 * 推導：令 z = e^{jω} 代入 z^d(z − 1) = −g，取絕對值得 2 sin(ω/2) = g，取角度得 (d + ½)ω + 90° = 180°。
 * 只對 z^{d+1} − z^d + g 這個特定特徵方程成立。
 */
export function delayCriticalGain(d: number): number {
  return 2 * Math.sin(Math.PI / (4 * d + 2)) // ← 差異：封閉式，一行算完（由 |z| = 1 的大小與角度條件推得）
}

export function delayCriticalOmega(d: number): number {
  return Math.PI / (2 * d + 1)
}
// #endregion

/**
 * 延遲遞迴的 step response「不衝過頭（δ_k 不變號）」的最大 g：
 * P(z) = z^{d+1} − z^d + g 要有正實根 ⇔ g ≤ −min_{z>0} z^d(z − 1)；令 d/dz[z^d(z − 1)] = 0 得 z = d/(d+1)，
 * 代回去就是 d^d/(d+1)^{d+1}（d = 1、2、3 → 1/4、4/27、27/256；d = 1 即判別式 1 − 4g ≥ 0）。
 * d = 0 時（0⁰ = 1）回傳 1：一階模型 pole 1 − g ≥ 0 ⇔ g ≤ 1，同樣是「不變號」的條件。
 * 「手算題」的備註用它說明會不會 overshoot；門檻本身由 simulateDelayRecursion 的變號與否驗證（ch08/handcalcs.test.tsx）。
 */
export function delayNoOvershootGain(d: number): number {
  return d ** d / (d + 1) ** (d + 1)
}

// #region core:delayCriticalGainNumeric
/** 不用封閉式：掃描 g 找到第一個 ρ(g) ≥ 1 的區間，再以二分法逼近 ρ(g) = 1（交叉驗證 g*） */
export function delayCriticalGainNumeric(d: number, gMax = 2.5, grid = 2500): number {
  const rho = (g: number) => delayStable(g, d).rho
  let prev = 0
  for (let i = 1; i <= grid; i++) {
    const g = (gMax * i) / grid
    if (rho(g) >= 1) { // ← 差異：只看數值 ρ(g) 第一次 ≥ 1 的位置，再二分逼近
      let lo = prev
      let hi = g
      for (let it = 0; it < 200 && hi - lo > 1e-15; it++) {
        const mid = 0.5 * (lo + hi)
        if (rho(mid) >= 1) hi = mid
        else lo = mid
      }
      return 0.5 * (lo + hi)
    }
    prev = g
  }
  return NaN // 掃描範圍內沒有臨界點
}
// #endregion

export interface DelayPm {
  g: number
  d: number
  /** gain crossover（與 d 無關，延遲不改變 |L|） */
  omegaC: number
  /** PM_d = 90° − (2d+1)·asin(g/2) [deg] */
  pmDeg: number
  /** phase crossover ω_180 = π/(2d+1) */
  omega180: number
  /** 臨界增益 g* */
  gCrit: number
  /** GM = g_crit ÷ g，以 dB 表示 */
  gmDb: number
  /** Delay margin = PM[rad]/ω_c [blocks] */
  delayMarginBlocks: number
}

// #region core:pmWithDelay
/**
 * 含 d 個 block 更新延遲的 PM / GM（§8.3 的頻域觀點）：
 *   |L(e^{jω})| = g/(2 sin(ω/2)) 與 d 無關 ⇒ ω_c 不變；
 *   ∠L(e^{jω}) = −90° − (d + ½)ω ⇒ PM_d = 90° − (2d+1)·asin(g/2)；
 *   ∠L = −180° 時 ω_180 = π/(2d+1)，|L(ω_180)| = g/g* ⇒ GM = g_crit ÷ g。
 */
export function pmWithDelay(g: number, d: number): DelayPm {
  const hasCrossover = g > 0 && g <= 2
  const omegaC = hasCrossover ? 2 * Math.asin(g / 2) : NaN
  const pmDeg = hasCrossover ? 90 - (2 * d + 1) * Math.asin(g / 2) * RAD2DEG : NaN // ← 差異：每多 1 block 延遲，PM 再扣 ω_c = 2·asin(g/2)
  const gCrit = delayCriticalGain(d)
  return {
    g,
    d,
    omegaC,
    pmDeg,
    omega180: delayCriticalOmega(d),
    gCrit,
    gmDb: g > 0 ? 20 * Math.log10(gCrit / g) : NaN, // ← 差異：GM = g*(d)/g（d = 0 時 g* = 2）
    delayMarginBlocks: hasCrossover ? (pmDeg * DEG2RAD) / omegaC : NaN,
  }
}
// #endregion

export interface DelayRun {
  /** δ_0 … δ_steps（發散超過 limit 後填 NaN） */
  delta: Float64Array
  /** 第一次 |δ| > limit 的 k；未發散為 null */
  divergedAt: number | null
}

// #region core:simulateDelayRecursion
/**
 * 時域執行 δ_{k+1} = δ_k − g·δ_{k−d}，k < 0 的歷史 δ = δ_0。
 * 與 blockLms 相同的時序：a 為常數、w_0 = 0，block k 的 DTC 使用 w_{max(0, k−d)}，
 * 所以 k − d < 0 時 GMAC 看到的仍是 a − w_0 = δ_0。w_k = a − δ_k 就是閉迴路的 step response。
 */
export function simulateDelayRecursion(g: number, d: number, steps: number, delta0 = 1, limit = 1e12): DelayRun {
  const delta = new Float64Array(steps + 1).fill(Number.NaN)
  const hist = new Array<number>(d + 1).fill(delta0) // [δ_{k−d}, …, δ_k]（環形用陣列平移即可，d 很小）
  delta[0] = delta0
  for (let k = 0; k < steps; k++) {
    const next = hist[d] - g * hist[0] // δ_{k+1} = δ_k − g·δ_{k−d}
    hist.shift()
    hist.push(next)
    if (!Number.isFinite(next) || Math.abs(next) > limit) return { delta, divergedAt: k + 1 }
    delta[k + 1] = next
  }
  return { delta, divergedAt: null }
}
// #endregion

/** 根軌跡：g 由 gs 掃描時特徵式的所有根（每列一個 g） */
export function delayRootLocus(d: number, gs: ArrayLike<number>): Complex[][] {
  return Array.from(gs, (g) => polyRoots(delayCharPoly(g, d)))
}

export interface DelayBoundRow {
  d: number
  gCritClosed: number
  gCritNumeric: number
  omegaCrit: number
  omegaCritDeg: number
  /** 在 g*(1 ± 1e-6) 處的 ρ，用來確認「穿越」確實發生 */
  rhoBelow: number
  rhoAbove: number
}

/** §8.3 穩定界限表（d = 0..dMax），封閉式與數值求根並列 */
export function delayBoundTable(dMax = 6): DelayBoundRow[] {
  return Array.from({ length: dMax + 1 }, (_, d) => {
    const gc = delayCriticalGain(d)
    return {
      d,
      gCritClosed: gc,
      gCritNumeric: delayCriticalGainNumeric(d),
      omegaCrit: delayCriticalOmega(d),
      omegaCritDeg: delayCriticalOmega(d) * RAD2DEG,
      rhoBelow: delayStable(gc * (1 - 1e-6), d).rho,
      rhoAbove: delayStable(gc * (1 + 1e-6), d).rho,
    }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 通用數值 PM / GM（任意開迴路 L(ω)）
// ═══════════════════════════════════════════════════════════════════════════

export interface LoopMargins {
  /** 所有 gain crossover |L| = 1（由低頻到高頻） */
  crossovers: { omega: number; pmDeg: number }[]
  /** 最小 PM [deg]（沒有 crossover 時 NaN） */
  pmDeg: number
  /** 達到最小 PM 的 crossover 頻率 */
  omegaC: number
  /** 所有 phase crossover（L 為負實數）及該點的 GM [dB] */
  phaseCrossovers: { omega: number; gmDb: number }[]
  /** 最小 GM [dB]（沒有 phase crossover 時 NaN） */
  gmDb: number
}

// #region core:loopMargins
/**
 * 數值求 PM / GM（不靠封閉式）：在 ω 網格上找 |L| − 1 與 Im L 的變號區間，再以二分法精修。
 * PM 用「由低頻開始展開」的連續相位：PM = 180° + ∠L(e^{jω_c})；GM = −20log10|L(ω_180)|。
 * 前提：L 在低頻是「正增益 × 一個積分器」（相位由 −90° 起算）。低頻增益為負時請設 lagBranch
 * （相位由 −270° 起算，PM 必為負）；否則主值起點 +90° 會算出沒有意義的「PM ≈ 270°」。
 */
export function loopMargins(
  L: (omega: number) => Complex,
  opts: { omegaMin?: number; points?: number; lagBranch?: boolean } = {},
): LoopMargins {
  const omegaMin = opts.omegaMin ?? 1e-4
  const resp = loopResponse(L, logOmegaGrid(opts.points ?? 3000, omegaMin, Math.PI), opts.lagBranch ?? false)
  const { omega, mag, phaseDeg, re, im } = resp
  const bisect = (f: (w: number) => number, a: number, b: number): number => {
    let fa = f(a)
    for (let it = 0; it < 100 && b - a > 1e-15 * Math.max(1, b); it++) {
      const m = 0.5 * (a + b)
      const fm = f(m)
      if (fa * fm <= 0) b = m
      else {
        a = m
        fa = fm
      }
    }
    return 0.5 * (a + b)
  }
  const crossovers: { omega: number; pmDeg: number }[] = []
  for (let i = 1; i < omega.length; i++) {
    const f0 = mag[i - 1] - 1
    const f1 = mag[i] - 1
    if (f0 === 0 || f0 * f1 < 0) {
      const wc = f0 === 0 ? omega[i - 1] : bisect((w) => cAbs(L(w)) - 1, omega[i - 1], omega[i])
      const t = (wc - omega[i - 1]) / (omega[i] - omega[i - 1])
      const approx = phaseDeg[i - 1] + t * (phaseDeg[i] - phaseDeg[i - 1]) // 展開相位的內插
      const exact = cArg(L(wc)) * RAD2DEG
      const phase = exact + 360 * Math.round((approx - exact) / 360) // 對齊到展開分支
      crossovers.push({ omega: wc, pmDeg: 180 + phase })
    }
  }
  const iEnd = omega.length - 1 // crossover 恰在頻帶端點 ω = π（例如 d = 0、g = 2：|L(π)| = g/2 = 1）
  if (Math.abs(mag[iEnd] - 1) <= 1e-12 && !crossovers.some((cr) => Math.abs(cr.omega - omega[iEnd]) < 1e-9)) {
    crossovers.push({ omega: omega[iEnd], pmDeg: 180 + phaseDeg[iEnd] })
  }
  const phaseCrossovers: { omega: number; gmDb: number }[] = []
  for (let i = 1; i < omega.length; i++) {
    if (im[i - 1] * im[i] < 0 && (re[i - 1] < 0 || re[i] < 0)) {
      const w180 = bisect((w) => L(w).im, omega[i - 1], omega[i])
      const v = L(w180)
      if (v.re < 0) phaseCrossovers.push({ omega: w180, gmDb: -20 * Math.log10(cAbs(v)) })
    }
  }
  const last = omega.length - 1 // ω = π：實係數系統的 L(−1) 為實數
  if (Math.abs(im[last]) <= 1e-12 * Math.max(1, mag[last]) && re[last] < 0) {
    phaseCrossovers.push({ omega: omega[last], gmDb: -20 * Math.log10(mag[last]) })
  }
  let pmDeg = NaN
  let omegaC = NaN
  for (const cr of crossovers) {
    if (!(cr.pmDeg >= pmDeg)) {
      pmDeg = cr.pmDeg
      omegaC = cr.omega
    }
  }
  let gmDb = NaN
  for (const pc of phaseCrossovers) if (!(pc.gmDb >= gmDb)) gmDb = pc.gmDb
  return { crossovers, pmDeg, omegaC, phaseCrossovers, gmDb }
}
// #endregion

export interface DelayLoopCheck {
  /** 所有比對項目都通過 */
  ok: boolean
  /** 每一項比對（顯示在 crossCheck 的說明；name 內的 `$…$` 是行內 TeX） */
  items: { name: string; ok: boolean }[]
  margins: LoopMargins
  pm: DelayPm
  stab: DelayStability
  gCritNumeric: number
}

/**
 * PM Lab 的 Analytic 交叉比對：封閉式（pmWithDelay、g*）vs 數值（loopMargins、求根、二分法 g*）。
 * g ≤ 0 時 PM／GM 依定義不適用（極性錯誤或沒有更新）：|L| 雖然仍有 crossover，但負號等於多 180° 的 lag，
 * 相位由 −270° 起算（lag 分支），「180° + ∠L」必為負。此時改比對「存在實根 z ≥ 1」（P(1) = g ≤ 0）、
 * d = 0 的 ρ = 1 − g，以及數值 PM = −90° − (2d+1)·asin(|g|/2) < 0。
 */
export function delayLoopCrossCheck(g: number, d: number, gCritNumeric = delayCriticalGainNumeric(d)): DelayLoopCheck {
  const pm = pmWithDelay(g, d)
  const stab = delayStable(g, d)
  // 低頻起點要低於 crossover（|g| 很小時 ω_c ≈ |g|）；g < 0 時相位採 lag 分支（−270° 起算）
  const margins = loopMargins((w) => calLoopGain(g, d, w), { omegaMin: g !== 0 ? Math.min(1e-4, Math.abs(g) / 100) : 1e-4, lagBranch: g < 0 })
  const near = (a: number, b: number, tol: number) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= tol
  const items: { name: string; ok: boolean }[] = [{ name: String.raw`$g^*$（數值求根 $=2\sin\frac{\pi}{4d+2}$）`, ok: near(gCritNumeric, pm.gCrit, 1e-9) }]
  if (g > 0) {
    items.push(
      { name: String.raw`$\omega_c$`, ok: near(margins.omegaC, pm.omegaC, 1e-9) },
      { name: String.raw`$PM$`, ok: near(margins.pmDeg, pm.pmDeg, 1e-6) },
      { name: String.raw`$GM$`, ok: near(margins.gmDb, pm.gmDb, 1e-6) },
      { name: String.raw`穩定判斷（$\rho<1\iff g<g^*$）`, ok: stab.marginal || stab.stable === g < pm.gCrit },
    )
  } else {
    // P(1) = g ≤ 0 且 z → +∞ 時 P(z) → +∞ ⇒ 必有實根 z ≥ 1（g = 0 時恰為 z = 1：臨界）
    const realRootOutside = stab.roots.some((z) => Math.abs(z.im) < 1e-9 && z.re >= 1 - 1e-9)
    items.push({ name: String.raw`存在實根 $z\ge1$（$P(1)=g\le0$）`, ok: realRootOutside && !stab.stable })
    if (d === 0) items.push({ name: String.raw`$\rho=1-g$`, ok: near(stab.rho, 1 - g, 1e-12) })
    if (g < 0 && g >= -2) {
      // 負增益＝多 180° 的 lag：∠L = −270° − (d + ½)ω ⇒ 數值「PM」= −90° − (2d+1)·asin(|g|/2) < 0
      const pmNeg = -90 - (2 * d + 1) * Math.asin(-g / 2) * RAD2DEG
      items.push({ name: String.raw`數值 $PM$（lag 分支）$=-90^\circ-(2d+1)\arcsin\frac{|g|}{2}<0$`, ok: near(margins.pmDeg, pmNeg, 1e-6) && margins.pmDeg < 0 })
    }
  }
  return { ok: items.every((it) => it.ok), items, margins, pm, stab, gCritNumeric }
}

/** max |x_k|，k ∈ [k0, k1]（含端點，自動截到陣列範圍；用來看「一個振盪週期內的峰值」而不是單一時間點） */
export function peakAbs(x: ArrayLike<number>, k0: number, k1: number): number {
  let m = 0
  for (let k = Math.max(0, Math.floor(k0)); k <= Math.min(x.length - 1, Math.floor(k1)); k++) m = Math.max(m, Math.abs(x[k]))
  return m
}

// ═══════════════════════════════════════════════════════════════════════════
// §8.4 雙迴路（二狀態抽象觀測模型；記號 r_s, b_s, c_s 依 E31）
// ═══════════════════════════════════════════════════════════════════════════

export interface DualLoopParams {
  /** 觀測狀態的極點 r_s（主迴路殘差每 block 保留的比例） */
  r: number
  /** δ → s 的耦合 b_s */
  b: number
  /** s → G 的觀測增益 c_s */
  c: number
  /** 正規化步長 μ（K ≡ 1 時即 g；E13） */
  mu: number
}

// #region core:dualLoopMatrix
/** [s; δ]_{k+1} = [[r, b], [−μc, 1]]·[s; δ]_k（s_{k+1} = r s_k + b δ_k；δ_{k+1} = δ_k − μ c s_k） */
export function dualLoopMatrix({ r, b, c: cs, mu }: DualLoopParams): Matrix {
  return [
    [r, b],
    [-mu * cs, 1],
  ]
}
// #endregion

// #region core:dualLoopCharPoly
/** det(zI − A) = (z − r)(z − 1) − (b)(−μc) = z² − (1 + r)z + (r + μbc)（降冪係數） */
export function dualLoopCharPoly({ r, b, c: cs, mu }: DualLoopParams): number[] {
  return [1, -(1 + r), r + mu * b * cs]
}
// #endregion

export interface DualLoopAnalysis {
  params: DualLoopParams
  /** 完整模型 poles（特徵式求根） */
  poles: Complex[]
  /** 同一組 poles 以 eigvals(A) 計算（交叉比對） */
  polesEig: Complex[]
  rho: number
  stable: boolean
  marginal: boolean
  /** 判別式 (1 − r)² − 4μbc；< 0 時為複數共軛對 */
  discriminant: number
  /** quasi-static 簡化 pole 1 − μbc/(1 − r) */
  simplifiedPole: number
  simplifiedStable: boolean
  /** 完整模型的 μ 穩定區間（封閉式；空區間時 lo ≥ hi） */
  fullRange: MuRange
  /** quasi-static 的 μ 穩定區間 */
  simplifiedRange: MuRange
  /** 開始出現複數 pole 的 μ = (1 − r)²/(4bc)（bc > 0 時） */
  muComplex: number
  /** 主迴路觀測的 DC 增益 F(1) = bc/(1 − r)（= 等效 K） */
  dcGain: number
}

export interface MuRange {
  lo: number
  hi: number
  /** 區間為空（例如 bc ≤ 0 的極性錯誤） */
  empty: boolean
  /** 為什麼是空的／適用條件。字串內的 `$…$` 是行內 TeX（UI 以 mathText 顯示成 KaTeX；title／aria-label 用 accessibleText） */
  note: string
}

// #region core:dualLoopFullRange
/**
 * 完整二狀態模型的 Jury 條件（P(z) = z² + a₁z + a₀，a₁ = −(1+r)，a₀ = r + μbc）：
 *   P(1) = μbc > 0；P(−1) = 2(1 + r) + μbc > 0；|a₀| = |r + μbc| < 1
 * ⇒ max(0, −2(1+r), −(1+r)) < μbc < 1 − r。|r| < 1 時就是 0 < μbc < 1 − r。
 */
export function dualLoopFullMuRange(r: number, b: number, cs: number): MuRange {
  const bc = b * cs
  if (bc === 0) return { lo: NaN, hi: NaN, empty: true, note: String.raw`$b_sc_s=0$：$\delta$ 不影響 $G$（不可觀測），特徵式有 $z=1$ 的根，任何 $\mu$ 都只是臨界` }
  if (bc < 0) return { lo: NaN, hi: NaN, empty: true, note: String.raw`$b_sc_s<0$：$P(1)=\mu b_sc_s>0$ 要求 $\mu<0$，正 $\mu$ 一定不穩定（觀測極性錯誤）` }
  const lo = Math.max(0, -2 * (1 + r), -(1 + r)) / bc // P(1) > 0、P(−1) > 0、a₀ > −1
  const hi = (1 - r) / bc // ← 差異：上界來自 |a₀| = |r + μbc| < 1（複數對穿過單位圓）
  return hi > lo
    ? { lo, hi, empty: false, note: String.raw`$0<\mu b_sc_s<1-r_s$（$|r_s|<1$ 時）` }
    : { lo, hi, empty: true, note: String.raw`區間為空：需要 $-3<r_s<1$（目前 $r_s=${r}$）` }
}
// #endregion

// #region core:dualLoopSimplifiedRange
/**
 * Quasi-static（時間尺度分離）：假設 s 已到穩態 s = bδ/(1 − r)，則 G = cs = [bc/(1 − r)]·δ，
 * δ_{k+1} = (1 − μbc/(1 − r))·δ_k ⇒ 0 < μbc/(1 − r) < 2 ⇒ 0 < μbc < 2(1 − r)。
 */
export function dualLoopSimplifiedMuRange(r: number, b: number, cs: number): MuRange {
  const bc = b * cs
  if (!(Math.abs(r) < 1)) return { lo: NaN, hi: NaN, empty: true, note: String.raw`$|r_s|\ge1$：觀測狀態本身沒有穩態，quasi-static 前提不存在` }
  if (bc === 0) return { lo: NaN, hi: NaN, empty: true, note: String.raw`$b_sc_s=0$：簡化 pole 恆為 $1$` }
  if (bc < 0) return { lo: NaN, hi: NaN, empty: true, note: String.raw`$b_sc_s<0$：等效 $K=\frac{b_sc_s}{1-r_s}<0$，極性錯誤` }
  const hi = (2 * (1 - r)) / bc // ← 差異：上界來自一階 pole 1 − μbc/(1 − r) > −1，比完整模型寬一倍
  return { lo: 0, hi, empty: false, note: String.raw`$0<\mu b_sc_s<2(1-r_s)$` }
}
// #endregion

export interface DualLoopGainMargin {
  /** 等效 loop gain g_eff = μF(1) = μbc/(1 − r)（quasi-static 一階模型的 g） */
  gEff: number
  /** 完整模型的 phase crossover ω_180 = acos((1 + r)/2) [rad/block]；前提不成立時 NaN */
  omega180: number
  /** 觀測路徑在 ω_180 的相位 ∠F(e^{jω_180}) = −(90° − ω_180/2) [deg]（quasi-static 假設它是 0°） */
  obsPhaseAt180Deg: number
  /** 完整模型 GM = 1/g_eff，以 dB 表示 */
  gmFullDb: number
  /** quasi-static GM = 2/g_eff，以 dB 表示（恰比完整模型多 20log10(2) = 6.02 dB） */
  gmSimplifiedDb: number
}

// #region core:dualLoopGainMargin
/**
 * 完整二狀態模型的頻域封閉式（勘誤 E19 的頻域版本）：L(z) = μbc/((z − 1)(z − r))，0 ≤ ω ≤ π。
 *   ∠L = −180° ⇔ ∠(e^{jω} − r) = 90° − ω/2 ⇔ cos ω_180 = (1 + r)/2（臨界根的實部在 r 與 1 的正中間）
 *   此時 |e^{jω_180} − 1| = |e^{jω_180} − r| = √(1 − r) ⇒ |L(e^{jω_180})| = μbc/(1 − r) = g_eff
 *   ⇒ 完整模型 GM = 1/g_eff；quasi-static（L = g_eff/(z − 1)）GM = 2/g_eff：恰差 2 倍，與 r 無關。
 * 前提：|r| < 1 且 g_eff > 0（否則回傳 NaN：極性錯誤或觀測沒有穩態時 GM 不適用）。
 */
export function dualLoopGainMargin({ r, b, c: cs, mu }: DualLoopParams): DualLoopGainMargin {
  const gEff = (mu * b * cs) / (1 - r) // 等效 loop gain μF(1)
  const valid = Math.abs(r) < 1 && gEff > 0
  const omega180 = valid ? Math.acos((1 + r) / 2) : NaN // cos ω_180 = (1 + r)/2
  return {
    gEff,
    omega180,
    obsPhaseAt180Deg: valid ? -(90 - (omega180 * RAD2DEG) / 2) : NaN, // r = 0 時 = −ω_180 = −60°：純一個 block 的延遲
    gmFullDb: valid ? -20 * Math.log10(gEff) : NaN, // ← 差異：完整模型 GM = 1/g_eff（上界 g_eff < 1，就是 d = 1 的 g*）
    gmSimplifiedDb: valid ? 20 * Math.log10(2 / gEff) : NaN, // ← 差異：quasi-static GM = 2/g_eff（上界 g_eff < 2）
  }
}
// #endregion

/** 二次式的根（封閉式；與 polyRoots 對照） */
function quadraticRoots(a1: number, a0: number): Complex[] {
  const disc = a1 * a1 - 4 * a0
  if (disc >= 0) {
    const s = Math.sqrt(disc)
    return [c((-a1 + s) / 2), c((-a1 - s) / 2)]
  }
  const im = Math.sqrt(-disc) / 2
  return [c(-a1 / 2, im), c(-a1 / 2, -im)]
}

/** 雙迴路完整分析（poles、ρ、兩種 μ 區間、複數門檻） */
export function analyzeDualLoop(p: DualLoopParams): DualLoopAnalysis {
  const [, a1, a0] = dualLoopCharPoly(p)
  const poles = polyRoots([1, a1, a0])
  const polesEig = eigvals(dualLoopMatrix(p))
  let rho = 0
  for (const z of poles) rho = Math.max(rho, cAbs(z))
  const bc = p.b * p.c
  const simplifiedPole = 1 - (p.mu * bc) / (1 - p.r)
  return {
    params: p,
    poles,
    polesEig,
    rho,
    stable: rho < 1 - MARGINAL_TOL,
    marginal: Math.abs(rho - 1) <= MARGINAL_TOL,
    discriminant: (1 - p.r) ** 2 - 4 * p.mu * bc,
    simplifiedPole,
    simplifiedStable: Math.abs(p.r) < 1 && Math.abs(simplifiedPole) < 1 - MARGINAL_TOL,
    fullRange: dualLoopFullMuRange(p.r, p.b, p.c),
    simplifiedRange: dualLoopSimplifiedMuRange(p.r, p.b, p.c),
    muComplex: bc > 0 ? (1 - p.r) ** 2 / (4 * bc) : NaN,
    dcGain: bc / (1 - p.r),
  }
}

/** 二狀態完整模型的根軌跡（μ 掃描；封閉式） */
export function dualLoopRootLocus(r: number, b: number, cs: number, mus: ArrayLike<number>): Complex[][] {
  return Array.from(mus, (mu) => quadraticRoots(-(1 + r), r + mu * b * cs))
}

// #region core:simulateQuasiStatic
/** 簡化（quasi-static）模型的時域：每個 block 都假設觀測 s 已經穩態 */
export function simulateQuasiStatic(p: DualLoopParams, steps: number, delta0 = 1): Float64Array {
  const { r, b, c: cs, mu } = p
  const delta = new Float64Array(steps + 1)
  delta[0] = delta0
  for (let k = 0; k < steps; k++) {
    const s = (b * delta[k]) / (1 - r) // ← 差異：假設 s 瞬間到穩態 s = bδ/(1 − r)，沒有記憶
    const G = cs * s // GMAC 輸出 G_k = c·s
    delta[k + 1] = delta[k] - mu * G // 校正更新 δ ← δ − μG
  }
  return delta
}
// #endregion

// #region core:simulateFullModel
/** 完整二狀態模型的時域：s 有自己的動態，δ_k 要到下一個 block 才進入 s */
export function simulateFullModel(p: DualLoopParams, steps: number, delta0 = 1, s0 = 0): { delta: Float64Array; s: Float64Array } {
  const { r, b, c: cs, mu } = p
  const delta = new Float64Array(steps + 1)
  const s = new Float64Array(steps + 1)
  delta[0] = delta0
  s[0] = s0
  for (let k = 0; k < steps; k++) {
    s[k + 1] = r * s[k] + b * delta[k] // ← 差異：s 是一個有記憶的狀態（pole r），由 δ_k 驅動
    const G = cs * s[k] // GMAC 輸出 G_k = c·s_k（看到的是上一個 block 的 δ 造成的 s）
    delta[k + 1] = delta[k] - mu * G // 校正更新 δ ← δ − μG
  }
  return { delta, s }
}
// #endregion

// ═══════════════════════════════════════════════════════════════════════════
// 一般化 state-space 觀測（E31：A_s, b_s, c_sᵀ, d_s）
// ═══════════════════════════════════════════════════════════════════════════

export interface ObservationSystem {
  /** n×n 觀測狀態矩陣 A_s */
  A: Matrix
  /** δ → s 的輸入向量 b_s（長度 n） */
  b: number[]
  /** s → G 的輸出向量 c_s（長度 n；G = c_sᵀ s + d_s δ） */
  c: number[]
  /** feedthrough d_s（δ 直接進入 G 的部分） */
  d: number
}

// #region core:combinedMatrix
/**
 * A_comb = [[A_s, b_s], [−μ c_sᵀ, 1 − μ d_s]]：狀態 x_k = [s_k; δ_k]，x_{k+1} = A_comb x_k。
 * 需檢查 ρ(A_comb) < 1。
 */
export function combinedMatrix(sys: ObservationSystem, mu: number): Matrix {
  const n = sys.A.length
  const top = sys.A.map((row, i) => [...row, sys.b[i]]) // s_{k+1} = A_s s_k + b_s δ_k
  const bottom = [...sys.c.map((v) => -mu * v), 1 - mu * sys.d] // δ_{k+1} = δ_k − μ(c_sᵀ s_k + d_s δ_k)
  if (top.some((row) => row.length !== n + 1) || bottom.length !== n + 1) {
    throw new Error('combinedMatrix：A_s 必須是 n×n，b_s、c_s 長度必須是 n')
  }
  return [...top, bottom]
}
// #endregion

/** 複數線性方程 M·v = rhs（部分選主元高斯消去；n 很小） */
function cSolve(M: Complex[][], rhs: Complex[]): Complex[] {
  const n = M.length
  const a = M.map((row, i) => [...row, rhs[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let i = col + 1; i < n; i++) if (cAbs(a[i][col]) > cAbs(a[piv][col])) piv = i
    if (cAbs(a[piv][col]) === 0) throw new Error('矩陣奇異（singular）：z 恰為 A_s 的 eigenvalue')
    if (piv !== col) [a[piv], a[col]] = [a[col], a[piv]]
    for (let i = col + 1; i < n; i++) {
      const f = cDiv(a[i][col], a[col][col])
      for (let j = col; j <= n; j++) a[i][j] = cSub(a[i][j], cMul(f, a[col][j]))
    }
  }
  const x = new Array<Complex>(n).fill(c(0))
  for (let i = n - 1; i >= 0; i--) {
    let s = a[i][n]
    for (let j = i + 1; j < n; j++) s = cSub(s, cMul(a[i][j], x[j]))
    x[i] = cDiv(s, a[i][i])
  }
  return x
}

// #region core:observationTransfer
/** F(z) = d_s + c_sᵀ (zI − A_s)⁻¹ b_s：δ → G 的轉移函數（觀測動態）。F(1) 就是等效 K。 */
export function observationTransfer(sys: ObservationSystem, z: Complex): Complex {
  const n = sys.A.length
  const M = sys.A.map((row, i) => row.map((v, j) => (i === j ? cSub(z, c(v)) : c(-v)))) // zI − A_s
  const v = cSolve(M, sys.b.map((x) => c(x))) // (zI − A_s)⁻¹ b_s
  let F = c(sys.d)
  for (let i = 0; i < n; i++) F = cAdd(F, cScale(v[i], sys.c[i])) // d_s + c_sᵀ v
  return F
}

/** L_cal(e^{jω}) = μ F(e^{jω})/(e^{jω} − 1) */
export function calLoopGainGeneral(sys: ObservationSystem, mu: number, omega: number): Complex {
  const z = cExpj(omega)
  return cDiv(cScale(observationTransfer(sys, z), mu), cSub(z, c(1)))
}
// #endregion

export interface GeneralAnalysis {
  /** eig(A_comb) */
  poles: Complex[]
  rho: number
  stable: boolean
  marginal: boolean
  /** eig(A_s)：觀測狀態自己的 poles */
  observerPoles: Complex[]
  observerRho: number
  /** F(1) = d_s + c_sᵀ(I − A_s)⁻¹b_s；A_s 有 eigenvalue 1 時 NaN */
  dcGain: number
  /** quasi-static pole 1 − μF(1) */
  simplifiedPole: number
  /** quasi-static 上界 2/F(1)（F(1) > 0 時） */
  simplifiedMuMax: number
}

/** 一般化觀測模型的分析（poles、DC 增益、quasi-static 對照） */
export function analyzeGeneral(sys: ObservationSystem, mu: number): GeneralAnalysis {
  const poles = eigvals(combinedMatrix(sys, mu))
  const observerPoles = sys.A.length > 0 ? eigvals(sys.A) : []
  let rho = 0
  for (const z of poles) rho = Math.max(rho, cAbs(z))
  let observerRho = 0
  for (const z of observerPoles) observerRho = Math.max(observerRho, cAbs(z))
  let dcGain = NaN
  try {
    const n = sys.A.length
    const IminusA = sys.A.map((row, i) => row.map((v, j) => (i === j ? 1 - v : -v)))
    const v = n > 0 ? solve(IminusA, sys.b) : []
    dcGain = sys.d + v.reduce((acc, x, i) => acc + x * sys.c[i], 0)
  } catch {
    dcGain = NaN // I − A_s 奇異：觀測狀態含 z = 1 的積分器，沒有有限 DC 增益
  }
  return {
    poles,
    rho,
    stable: rho < 1 - MARGINAL_TOL,
    marginal: Math.abs(rho - 1) <= MARGINAL_TOL,
    observerPoles,
    observerRho,
    dcGain,
    simplifiedPole: 1 - mu * dcGain,
    simplifiedMuMax: dcGain > 0 ? 2 / dcGain : NaN,
  }
}

/** 一般化模型的時域：x_0 = [0, …, 0, δ_0]，回傳 δ_k 與 ‖s_k‖ */
export function simulateGeneral(sys: ObservationSystem, mu: number, steps: number, delta0 = 1): { delta: Float64Array; sNorm: Float64Array } {
  const A = combinedMatrix(sys, mu)
  const n = A.length
  let x = new Array<number>(n).fill(0)
  x[n - 1] = delta0
  const delta = new Float64Array(steps + 1)
  const sNorm = new Float64Array(steps + 1)
  delta[0] = delta0
  for (let k = 0; k < steps; k++) {
    const nx = new Array<number>(n).fill(0)
    for (let i = 0; i < n; i++) {
      let s = 0
      for (let j = 0; j < n; j++) s += A[i][j] * x[j]
      nx[i] = s
    }
    x = nx
    delta[k + 1] = x[n - 1]
    let ss = 0
    for (let i = 0; i < n - 1; i++) ss += x[i] * x[i]
    sNorm[k + 1] = Math.sqrt(ss)
  }
  return { delta, sNorm }
}

// #region core:stableIntervals
/** 掃描 μ ∈ [lo, hi]，回傳所有 ρ(μ) < 1 的連續區間（端點以二分法精修）；不使用任何封閉式 */
export function stableIntervalsNumeric(rhoFn: (mu: number) => number, lo: number, hi: number, grid = 801): { lo: number; hi: number }[] {
  const mus = Array.from({ length: grid }, (_, i) => lo + ((hi - lo) * i) / (grid - 1))
  const stable = mus.map((m) => rhoFn(m) < 1)
  const refine = (a: number, b: number, stableAtA: boolean): number => {
    for (let it = 0; it < 80 && b - a > 1e-13 * Math.max(1, Math.abs(b)); it++) {
      const m = 0.5 * (a + b)
      if (rhoFn(m) < 1 === stableAtA) a = m
      else b = m
    }
    return 0.5 * (a + b)
  }
  const out: { lo: number; hi: number }[] = []
  let i = 0
  while (i < grid) {
    if (!stable[i]) {
      i++
      continue
    }
    const left = i === 0 ? mus[0] : refine(mus[i - 1], mus[i], false)
    let j = i
    while (j + 1 < grid && stable[j + 1]) j++
    const right = j + 1 < grid ? refine(mus[j], mus[j + 1], true) : mus[grid - 1]
    out.push({ lo: left, hi: right })
    i = j + 1
  }
  return out
}
// #endregion

// ═══════════════════════════════════════════════════════════════════════════
// Monte Carlo 交叉比對：真實 block sign-LMS（blockLms.ts，worker 執行）vs 線性延遲模型
// ═══════════════════════════════════════════════════════════════════════════

export interface SignLmsMcSetup {
  g: number
  d: number
  /** comparator 前雜訊 σ_v [fs] */
  sigmaV: number
  /** GMAC 累加長度 N */
  N: number
  /** 初始誤差 δ_0 = a − w_0 [fs]（w_0 = 0，a = δ_0） */
  delta0: number
  blocks: number
  seed: number
}

/** K_q = √(2/π)/σ_v [fs⁻¹]（±1 unit-RMS code、identity path ⇒ C = 1，K = K_q） */
export function comparatorKq(sigmaV: number): number {
  return Math.sqrt(2 / Math.PI) / sigmaV
}

/**
 * 把 (g, d) 轉成 blockLms 的設定：μ = g/K_q（average 模式，單位 fs），cal_update_delay_blocks = d。
 * 規格 §15.3 的欄位；其餘使用預設（iid ±1 code、identity path、bipolar comparator、浮點暫存器）。
 */
export function buildSignLmsMcConfig(s: SignLmsMcSetup): BlockLmsConfigInput {
  return {
    seed: s.seed >>> 0,
    gm_accum_samples: s.N,
    gain_initial: 0,
    gain_true: s.delta0,
    gain_step: s.g / comparatorKq(s.sigmaV),
    pd_noise_rms_fs: s.sigmaV,
    cal_update_delay_blocks: s.d,
    num_blocks: s.blocks,
    gm_mode: 'average',
    code_normalization: 'unit_rms',
    seeded_pattern: { kind: 'iid_pm_one', parameters: {} },
    pll_error_path: { kind: 'identity', parameters: {} },
    record: { sample_trace_blocks: 0, decimate: 1 },
  }
}

export interface McComparison {
  /** 每個 block 的 |δ_MC − δ_lin| ≤ t_crit·SE + 線性化容許量（t_crit：Student-t、Bonferroni） */
  pass: boolean
  /** Student-t（runs − 1 自由度）臨界值，含對所有 block 的 Bonferroni 校正 */
  tCrit: number
  /** max_k |δ_MC − δ_lin| [fs] */
  maxAbsDev: number
  /** 最差點的偏差 / 允許值（≤ 1 為通過） */
  worstRatio: number
  worstBlock: number
  /** 線性化容許量（fs）：sign 非線性 erf 的三次項 ≈ δ0·(δ0/σ_v)²/6，再加 1% δ0 */
  linAllowance: number
}

// #region core:compareMcToLinear
/**
 * 比較 MC ensemble 平均 δ_MC,k = a − mean(w_k) 與線性遞迴 δ_lin,k（k = 0…K）：
 * 允許值 = t_crit·SE_k（SE = std/√runs；t_crit 為 Student-t、雙尾 α 並對 K+1 個 block 做 Bonferroni）
 *        + 線性化容許量（K_q 線性化在 δ/σ_v 不小時高估 erf 的斜率）。
 */
export function compareMcToLinear(
  deltaMc: ArrayLike<number>,
  stdMc: ArrayLike<number>,
  runs: number,
  deltaLin: ArrayLike<number>,
  delta0: number,
  sigmaV: number,
  alpha = 0.01,
): McComparison {
  const r = Math.abs(delta0) / sigmaV
  const linAllowance = Math.abs(delta0) * ((r * r) / 6 + 0.01) // erf 三次項 + 1% 餘裕
  const n = Math.min(deltaMc.length, deltaLin.length, stdMc.length)
  if (runs < 2) return { pass: false, tCrit: NaN, maxAbsDev: NaN, worstRatio: NaN, worstBlock: 0, linAllowance } // 無法估計 SE
  const tCrit = studentTInv(1 - alpha / (2 * Math.max(1, n)), runs - 1)
  let maxAbsDev = 0
  let worstRatio = 0
  let worstBlock = 0
  for (let k = 0; k < n; k++) {
    const dev = Math.abs(deltaMc[k] - deltaLin[k])
    if (!Number.isFinite(dev)) {
      worstRatio = Infinity // 線性模型已發散（超過 1e12）或 MC 出現非有限值
      worstBlock = k
      break
    }
    const allow = (tCrit * stdMc[k]) / Math.sqrt(runs) + linAllowance
    maxAbsDev = Math.max(maxAbsDev, dev)
    const ratio = dev / allow
    if (ratio > worstRatio) {
      worstRatio = ratio
      worstBlock = k
    }
  }
  return { pass: worstRatio <= 1, tCrit, maxAbsDev, worstRatio, worstBlock, linAllowance }
}
// #endregion

// ═══════════════════════════════════════════════════════════════════════════
// §8.3 補充（2026-10-19）：用 z^{d+1} − z^d + g = 0 的 d + 1 個極點做模態展開，算 95% 收斂 block 數 k₉₅
// ═══════════════════════════════════════════════════════════════════════════
//
// 平均遞迴 y_{k+1} = y_k − g·y_{k−d}（初始歷史 y_j = 1，j ≤ 0）是常係數線性遞迴，解一定可以寫成極點的組合：
//   y_k = Σ_i c_i λ_i^k                （極點互異）
//   y_k = Σ_i Σ_{p<m_i} c_{i,p} k^p λ_i^k（λ_i 為 m_i 重根；這個多項式最多只有二重根，出現在 z = d/(d+1)）
// 係數 c 由 d + 1 個初始條件 y_{−d} = … = y_0 = 1 解線性方程組得到（共軛複根合成 2 Re(c k^p λ^k)，未知數仍是實數）。
// k₉₅ = 1 + max{k : |y_k| > 0.05}。「之後不再超過」用三角不等式證明：|y_k| ≤ Σ|c_{i,p}| k^p ρ_i^k，這個上界在
// k ≥ p/(−ln ρ_i) 之後單調遞減，一旦 ≤ 0.05 就不可能再超過——和 settleDelayed（thesisModel.ts）逐 block 數出來的數字相同
// （stability.test.ts 逐點比對，誤差 < 1 步），但停止規則是證明、不是量到的門檻，而且極慢的 mode 需要掃的步數更少。
// 只用 spectral radius 的 ⌈ln 0.05 / ln ρ⌉ 是「漸近估計」（d = 0 才精確），這裡一併回傳供對照。

/** settleFromPoles 掃描 y_k 的步數上限；超過（極慢的 mode）就改回傳漸近估計並標 exact = false */
export const SETTLE_FROM_POLES_MAX_STEPS = 2_000_000

/** 極點叢集的相對容差：polyRoots 對二重根的誤差約 √ε ≈ 1.5×10⁻⁸，所以 10⁻⁶ 內的根視為同一個重根 */
const POLE_CLUSTER_TOL = 1e-6

export interface DelayMode {
  /** 極點 λ；real = false 時它代表一對共軛極點（只列 Im > 0 的那一個） */
  lambda: Complex
  real: boolean
  /** 重根次數 m（這個特徵多項式最多 2） */
  multiplicity: number
  /** 係數 c_p（p = 0…m−1）：實極點貢獻 c_p k^p λ^k；共軛對貢獻 2 Re(c_p k^p λ^k) */
  coeff: Complex[]
}

export interface DelayModal {
  g: number
  d: number
  /** 特徵式的全部根（含重根） */
  poles: Complex[]
  /** spectral radius ρ = max|λ| */
  rho: number
  /** 模態展開；係數解不出來（方程組奇異或非有限）時為 null */
  modes: DelayMode[] | null
}

/** 把根依 POLE_CLUSTER_TOL 分群（重根），回傳每群的中心與個數。 */
function clusterPoles(poles: Complex[]): { center: Complex; count: number }[] {
  const out: { sum: Complex; count: number }[] = []
  for (const z of poles) {
    const hit = out.find((cl) => cAbs(cSub(cScale(cl.sum, 1 / cl.count), z)) <= POLE_CLUSTER_TOL * Math.max(1, cAbs(z)))
    if (hit) {
      hit.sum = cAdd(hit.sum, z)
      hit.count++
    } else out.push({ sum: z, count: 1 })
  }
  return out.map((cl) => ({ center: cScale(cl.sum, 1 / cl.count), count: cl.count }))
}

/** k^p λ^k（k 可為負；λ ≠ 0） */
function modeTerm(lambda: Complex, p: number, k: number): Complex {
  const r = cAbs(lambda)
  const th = cArg(lambda)
  const mag = Math.pow(r, k) * Math.pow(k, p)
  return cScale(cExpj(th * k), mag)
}

// #region core:delayModes
/**
 * y_{k+1} = y_k − g·y_{k−d}（y_j = 1，j ≤ 0）的模態展開：求根 → 分群（重根）→ 以初始條件解係數。
 * 實根群（m 重）給 m 個實未知數 c_0…c_{m−1}；共軛對群給 2m 個（c_p 的實部與虛部），總數恰為 d + 1。
 */
export function delayModes(g: number, d: number): DelayModal {
  const poles = polyRoots(delayCharPoly(g, d))
  let rho = 0
  for (const z of poles) rho = Math.max(rho, cAbs(z))
  if (!(rho > 0) || poles.some((z) => cAbs(z) === 0)) return { g, d, poles, rho, modes: null } // λ = 0（deadbeat）沒有 λ^{−k}
  const clusters = clusterPoles(poles)
  type Basis = { eval: (k: number) => number; mode: number; p: number; part: 're' | 'im' }
  const basis: Basis[] = []
  const modes: DelayMode[] = []
  for (const cl of clusters) {
    const real = Math.abs(cl.center.im) <= POLE_CLUSTER_TOL * Math.max(1, cAbs(cl.center))
    if (!real && cl.center.im < 0) continue // 共軛對只處理 Im > 0 的那一個
    const lambda = real ? c(cl.center.re, 0) : cl.center
    const idx = modes.length
    modes.push({ lambda, real, multiplicity: cl.count, coeff: [] })
    for (let p = 0; p < cl.count; p++) {
      if (real) basis.push({ eval: (k) => modeTerm(lambda, p, k).re, mode: idx, p, part: 're' })
      else {
        basis.push({ eval: (k) => 2 * modeTerm(lambda, p, k).re, mode: idx, p, part: 're' }) // 2 Re(c k^p λ^k) 中 Re(c) 的係數
        basis.push({ eval: (k) => -2 * modeTerm(lambda, p, k).im, mode: idx, p, part: 'im' }) // Im(c) 的係數
      }
    }
  }
  const n = d + 1
  if (basis.length !== n) return { g, d, poles, rho, modes: null }
  const A: Matrix = []
  const rhs: number[] = []
  for (let k = -d; k <= 0; k++) {
    A.push(basis.map((b) => b.eval(k)))
    rhs.push(1) // ← 初始歷史全為 1（和 settleDelayed、trajectory() 同一個約定）
  }
  let u: number[]
  try {
    u = solve(A, rhs)
  } catch {
    return { g, d, poles, rho, modes: null }
  }
  if (u.some((v) => !Number.isFinite(v))) return { g, d, poles, rho, modes: null }
  for (const m of modes) m.coeff = Array.from({ length: m.multiplicity }, () => c(0, 0))
  basis.forEach((b, j) => {
    const coef = modes[b.mode].coeff[b.p]
    if (b.part === 're') coef.re = u[j]
    else coef.im = u[j]
  })
  return { g, d, poles, rho, modes }
}
// #endregion

/** 模態展開在第 k 步的值 y_k（k ≥ −d）。modes 為 null 時回傳 NaN。 */
export function delayModalValue(modal: DelayModal, k: number): number {
  if (!modal.modes) return NaN
  let y = 0
  for (const m of modal.modes)
    for (let p = 0; p < m.multiplicity; p++) {
      const t = cMul(m.coeff[p], modeTerm(m.lambda, p, k))
      y += m.real ? t.re : 2 * t.re
    }
  return y
}

/** |y_k| 的保證上界 Σ|c_p| k^p |λ|^k（共軛對乘 2）；k ≥ max p/(−ln|λ|) 之後單調遞減。 */
export function delayModalBound(modal: DelayModal, k: number): number {
  if (!modal.modes) return Infinity
  let b = 0
  for (const m of modal.modes) {
    const r = cAbs(m.lambda)
    for (let p = 0; p < m.multiplicity; p++) b += (m.real ? 1 : 2) * cAbs(m.coeff[p]) * Math.pow(k, p) * Math.pow(r, k)
  }
  return b
}

export interface PoleSettle {
  g: number
  d: number
  frac: number
  poles: Complex[]
  rho: number
  stable: boolean
  modes: DelayMode[] | null
  /** k₉₅ = 1 + max{k : |y_k| > frac}；不穩定時 ∞；沒掃完（exact = false）時改填漸近估計當下界 */
  blocks: number
  exact: boolean
  /** 只用 ρ 的漸近估計 max(1, ⌈ln frac / ln ρ⌉)；d = 0 時與 blocks 相同 */
  asymptotic: number
  /** 證明「之後不再超過 frac」的那一步（上界 ≤ frac 且已進入單調遞減區）；沒掃完時 null */
  provenAt: number | null
  /** 'modes'：模態展開；'recursion'：模態係數解不出來（例如 deadbeat）時退回逐 block 遞推 */
  method: 'modes' | 'recursion'
}

// #region core:settleFromPoles
/**
 * 以極點的模態展開數 k₉₅：y_k = Σ c_{i,p} k^p λ_i^k 逐步求值，記下最後一次 |y_k| > frac 的 k；
 * 當 k 進入上界的單調遞減區且 Σ|c| k^p ρ^k ≤ frac 時停止（之後不可能再超過，這是證明不是量測）。
 * d = 0：y_k = (1 − g)^k，k₉₅ = ⌈ln frac / ln|1 − g|⌉（deadbeat g = 1 需要一次更新 ⇒ 1）。
 * ρ ≥ 1（含 g ≤ 0）：不收斂，∞。maxSteps 內沒停：極慢的 mode，blocks = 漸近估計、exact = false。
 */
export function settleFromPoles(g: number, d: number, frac = 0.05, maxSteps = SETTLE_FROM_POLES_MAX_STEPS): PoleSettle {
  const modal = delayModes(g, d)
  const { poles, rho } = modal
  const base = { g, d, frac, poles, rho, modes: modal.modes }
  if (!(rho < 1)) return { ...base, stable: false, blocks: Infinity, exact: true, asymptotic: Infinity, provenAt: null, method: 'modes' }
  // ρ = 0（deadbeat，g = 1、d = 0）：ln 0 = −∞ ⇒ 商為 0，但仍需要「一次」更新才到位，所以至少 1
  const asymptotic = rho <= 1e-12 ? 1 : Math.max(1, Math.ceil(Math.log(frac) / Math.log(rho)))
  if (!modal.modes) {
    // 模態係數解不出來：退回逐 block 遞推（和 settleDelayed 相同的停止規則：整個狀態都 ≤ frac·10⁻³）
    const L = d + 1
    const ring = new Float64Array(L).fill(1)
    let lastAbove = 0
    let small = 0
    for (let n = 0; n < maxSteps; n++) {
      const next = ring[n % L] - g * ring[(n + 1) % L]
      ring[(n + 1) % L] = next
      if (Math.abs(next) > frac) lastAbove = n + 1
      if (Math.abs(next) <= frac * 1e-3) {
        if (++small >= L) return { ...base, stable: true, blocks: lastAbove + 1, exact: true, asymptotic, provenAt: n + 1, method: 'recursion' }
      } else small = 0
    }
    return { ...base, stable: true, blocks: asymptotic, exact: false, asymptotic, provenAt: null, method: 'recursion' }
  }
  // 上界 Σ|c| k^p ρ_i^k 從 kDec 之後每一項都單調遞減；主極點的 p = 0 項 A·ρ^k 是它的下界，
  // 所以證明至少要掃到 k ≥ ln(frac/A)/ln ρ——這個數字已經超過 maxSteps 就直接回報「沒數完」（極慢的 mode 不用真的掃兩百萬步）
  let kDec = 1
  let ampDom = 0
  for (const m of modal.modes) {
    const r = cAbs(m.lambda)
    if (m.multiplicity > 1 && r < 1 && r > 0) kDec = Math.max(kDec, Math.ceil((m.multiplicity - 1) / -Math.log(r)))
    if (Math.abs(r - rho) <= 1e-12) ampDom += (m.real ? 1 : 2) * cAbs(m.coeff[0])
  }
  const notExact = { ...base, stable: true, blocks: asymptotic, exact: false, asymptotic, provenAt: null, method: 'modes' as const }
  if (ampDom > frac && Math.log(frac / ampDom) / Math.log(rho) > maxSteps) return notExact
  // 逐步求值：λ^k 與 ρ^k 用連乘遞推（不用每一步都呼叫 pow／exp），k^p 直接算
  const state = modal.modes.map((m) => ({ m, w: m.real ? 1 : 2, r: cAbs(m.lambda), pow: c(1, 0), rk: 1, amp: m.coeff.map(cAbs) }))
  let lastAbove = 0
  for (let k = 1; k <= maxSteps; k++) {
    let y = 0
    let bound = 0
    for (const st of state) {
      st.pow = cMul(st.pow, st.m.lambda) // λ^k
      st.rk *= st.r // ρ_i^k
      let kp = 1
      for (let p = 0; p < st.m.multiplicity; p++) {
        y += st.w * cMul(st.m.coeff[p], st.pow).re * kp
        bound += st.w * st.amp[p] * kp * st.rk
        kp *= k
      }
    }
    if (!Number.isFinite(y)) break
    if (Math.abs(y) > frac) lastAbove = k // ← 不是「第一次低於」：之後再超過也算
    if (k >= kDec && bound <= frac) return { ...base, stable: true, blocks: lastAbove + 1, exact: true, asymptotic, provenAt: k, method: 'modes' }
  }
  return notExact
}
// #endregion
