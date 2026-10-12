/**
 * Calibration Bias & DTC INL（規格 §11；勘誤 E01 / E03 / E11 / E12 / E17；模型層級 L1 靜態、L2 含主迴路 DC null）。
 * Ch11 與 Bias & INL Lab 共用；頁面以 `?raw` + `#region core:*` 直接顯示這些程式碼。
 *
 * ── 總誤差模型（勘誤 E12：§11 的干擾改名為 ε_cc、係數 κ；INL 係數統一為 c_2、c_3）──
 *   e[n] = (a − w)·x[n] + b + d(x[n]) + ε_cc[n] + v[n]
 *   d(x) = c_2·x² + c_3·x³            DTC INL（code-dependent delay）
 *   ε_cc[n] = κ·x[n]                   deterministic code-correlated error（不是 random jitter，勘誤 E17）
 *   v[n] ~ N(0, σ_v(x)²)，與 x 獨立     σ_v(x) = σ_v·√(1 + ρ_j·(x − x_j)²)；ρ_j = 0 時與 code 無關
 * 確定性部分 e_det(x; w) = (a − w)x + b + d(x) + κx。
 * 架構（docs/assumptions.md §2a）：DTC 在 reference 輸入端，回授路徑上只有 divider。feedback edge 早到 a·x（t_fb = −a·x）；
 *   DTC 延遲後的 reference edge 是 t_ref′ = T_0 − w·x + d(x)（補償量 w·x 從固定的基準延遲 T_0 往回扣；d(x) 是 DTC 在這個 code
 *   多出來的延遲，所以以正號進入誤差）；PD 量 t_ref′ − t_fb = (a − w)x + d(x)（常數 T_0 被主 PLL 吸收）。
 *   comparator 取的是 PD 的輸出（送進 loop filter 的同一個節點），b 是 comparator／PD 的 offset。
 *
 * ── 兩種 GMAC（同一個誤差模型，只差進 GMAC 的那個量）──
 *   MSE-LMS ：G = mean(e·x)        ⇒ 固定點 E[x·e] = 0，對 w 是一次方程（封閉解，[精確｜指定模型]）
 *   Sign-LMS：G = mean(sign(e)·x)  ⇒ 固定點 E[x·erf(e_det/(√2σ_v))] = 0（mean-field，需 root finding）
 *   σ_v ≫ max|e_det(x; w*)| 時 erf 可線性化，兩者固定點相同（勘誤 E01：要小的是「整個」確定性殘差）。
 *
 * ── 主迴路 DC null（勘誤 E03）──
 *   'none'       ：PD 誤差的 DC 原封不動到達 comparator（主迴路 frozen、無積分路徑，或 x 已零均值）
 *   'shared_bbpd'：q 就是 type-II 主 PLL 的 BBPD；lock 時積分路徑加上 static phase offset φ，強制 E[q] = 0
 *   'linear_pd'  ：主迴路由線性 PD/TDC 鎖定（E[e_PD] = 0）；另一個帶 offset b 的 comparator 觀察 e_PD
 *
 * 單位：x 無因次（正規化 code）；e、b、c_2、c_3、κ、a、w、σ_v 都用同一個正規化時間單位 t.u.
 * （例如 1 t.u. = 1 fs 或 1 DTC LSB）。Sign-LMS 的 μ 單位為 t.u.；MSE-LMS 的 μ 無因次。
 *
 * 純數值、無 React/DOM；隨機性全部來自 createRng(seed)。
 * ── Monte Carlo 與 mean-field 之間的兩個已知差距（都有估計式，Lab 的交叉比對會用到）──
 *   (1) 有限步長：w 在 w* 附近抖動（Var(w) ≈ μ²E[x²]/(N·g(2 − g))），E[G](w) 的曲率使時間平均偏移
 *       E[w̄] − w* ≈ G″(w*)·Var(w)/(2S)（finiteStepBias）；σ_v = 0 的離散 code 則是 O(μ) 的 limit cycle。
 *   (2) 主迴路 servo 自己的抖動：DC null 的 φ 不是常數，它的抖動 std(φ) 對 comparator 而言就是額外的 dither，
 *       固定點等於把 σ_v 換成 σ_eff = √(σ_v² + Var(φ)) 的 mean-field 根（ErrorModel.sigmaExtra）。
 *
 * Worker 可呼叫（單一 structured-cloneable 參數）：analyzeBias、simulateBiasLms、biasSigmaSweep、
 * runDcNullComparison、nearIntegerSweep、cubicReferenceTable、finiteStepBias。
 */

import { createRng, erf, meanCI, normPdf, polyRoots, type Rng } from '@/simulation/core'
import { runDsm, type DsmKind } from '@/simulation/models/dsm'
import { corrFromSequence, designDtLoop } from '@/simulation/models/pll'
import { fft } from '@/simulation/signal'

const SQRT2 = Math.SQRT2
/** K_q = √(2/π)/σ_v 的常數部分 */
export const KQ_FACTOR = Math.sqrt(2 / Math.PI)

// ───────────────────────── 型別與標籤 ─────────────────────────

export type BiasAlgorithm = 'mse' | 'sign'
export type DcNullMode = 'none' | 'shared_bbpd' | 'linear_pd'
export type CodeDistKind = 'five_level' | 'pm_one' | 'unipolar4' | 'gaussian' | 'uniform_residue' | 'dsm'

export const ALGORITHM_LABEL: Record<BiasAlgorithm, string> = {
  mse: 'MSE-LMS（GMAC 用多位元 e）',
  sign: 'Sign-LMS（GMAC 用 1-bit q）',
}

export const DC_MODE_LABEL: Record<DcNullMode, string> = {
  none: 'none：DC 不被主迴路消除（靜態式）',
  shared_bbpd: 'shared BBPD：type-II 主迴路強制 E[q] = 0',
  linear_pd: 'linear PD + separate comparator',
}

export const CODE_KIND_LABEL: Record<CodeDistKind, string> = {
  five_level: '5-level {−2,−1,0,1,2}（等機率）',
  pm_one: '±1（等機率）',
  unipolar4: '4-level unipolar {0,1,2,3}（等機率）',
  gaussian: 'Gaussian N(0, 1)',
  uniform_residue: 'Uniform [0, 1) residue',
  dsm: 'DSM residue（8-bit 累加器）',
}

/** 誤差模型參數（單位 t.u.；x 無因次） */
export interface ErrorModel {
  /** 真實線性 gain a */
  a: number
  /** comparator / PD offset b */
  b: number
  /** 二階 INL 係數 c_2（d(x) = c_2x² + c_3x³） */
  c2: number
  /** 三階 INL 係數 c_3 */
  c3: number
  /** code-correlated deterministic error ε_cc = κ·x 的係數 κ（勘誤 E12） */
  kappa: number
  /** comparator 前 Gaussian 雜訊 σ_v（≥ 0；0 = 無雜訊） */
  sigmaV: number
  /** code-dependent jitter：σ_v(x) = σ_v√(1 + ρ_j(x − x_j)²) 的 ρ_j（≥ 0；預設 0，勘誤 E17） */
  jitterSlope?: number
  /** code-dependent jitter 的參考 code x_j（jitter 最小的 code） */
  jitterRef?: number
  /**
   * 與 code 無關的額外 Gaussian 抖動（≥ 0；預設 0），與 σ_v(x) 平方相加：σ(x)² = σ_v(x)² + σ_extra²。
   * 用來表示主迴路 servo 的 φ 抖動（servo-aware mean-field）；Lab 的控制項不直接設定它。
   */
  sigmaExtra?: number
}

export interface CodeSpec {
  kind: CodeDistKind
  /** code 平移 x → x + shift（示範 code centering / offset 交叉耦合） */
  shift?: number
  /** DSM：'first_order' 或 'mash111' */
  dsmKind?: DsmKind
  /** DSM：FCW 小數部分（量化到 1/256） */
  dsmFrac?: number
}

/** Lab 的 DSM：8-bit 累加器（first-order residue 最多 256 個不同值，期望值可精確列舉） */
export const DSM_BITS = 8
export const DSM_LENGTH = 4096

/** 離散或連續的 code 分布（全部欄位可 structured clone） */
export interface CodeDistribution {
  kind: CodeDistKind
  label: string
  shift: number
  /** 離散分布的支撐點（連續分布為空陣列） */
  values: number[]
  probs: number[]
  /** 連續分布：pdf 種類與積分區間 */
  continuous: { pdf: 'gaussian' | 'uniform'; lo: number; hi: number } | null
  /** DSM：依時間順序的 code 序列（MC 循環使用；長度 DSM_LENGTH） */
  sequence: number[] | null
  notes: string[]
}

// ───────────────────────── 誤差模型 ─────────────────────────

// #region core:errorModel
/** 確定性誤差 e_det(x; w) = (a − w)x + b + c_2x² + c_3x³ + κx（勘誤 E12：ε_cc = κx） */
export function eDet(x: number, w: number, m: ErrorModel): number {
  return (m.a - w) * x + m.b + m.c2 * x * x + m.c3 * x * x * x + m.kappa * x
}

/** σ_v(x) = σ_v·√(1 + ρ_j (x − x_j)²)；ρ_j = 0 時與 code 無關（勘誤 E17）。sigmaExtra > 0 時再平方相加。 */
export function sigmaAt(x: number, m: ErrorModel): number {
  const rho = m.jitterSlope ?? 0
  const extra = m.sigmaExtra ?? 0
  let s = m.sigmaV
  if (rho !== 0) {
    const dx = x - (m.jitterRef ?? 0)
    s = m.sigmaV * Math.sqrt(1 + rho * dx * dx)
  }
  return extra > 0 ? Math.hypot(s, extra) : s
}
// #endregion

// #region core:comparatorMean
/**
 * Comparator 的條件平均 E[q | x] = E[sign(s + v)]，v ~ N(0, σ²)：
 *   P(q = +1) = Φ(s/σ) ⇒ E[q] = 2Φ(s/σ) − 1 = erf(s/(√2σ))。
 * σ = 0 時退化為 sign(s)（mean-field 中 sign(0) 取 0；只影響測度為 0 的點）。
 */
export function comparatorMean(s: number, sigma: number): number {
  if (!(sigma > 0)) return s > 0 ? 1 : s < 0 ? -1 : 0
  return erf(s / (SQRT2 * sigma))
}
// #endregion

/** 檢查參數是否有限且合法；不合法時丟出繁中錯誤（UI 顯示原因）。 */
export function validateModel(m: ErrorModel): void {
  for (const k of ['a', 'b', 'c2', 'c3', 'kappa', 'sigmaV'] as const) {
    if (!Number.isFinite(m[k])) throw new Error(`誤差模型參數 ${k} 必須為有限數，收到 ${m[k]}`)
  }
  if (m.sigmaV < 0) throw new Error(`σ_v 不可為負，收到 ${m.sigmaV}`)
  const rho = m.jitterSlope ?? 0
  if (!(rho >= 0) || !Number.isFinite(rho)) throw new Error(`ρ_j 必須 ≥ 0，收到 ${rho}`)
  const extra = m.sigmaExtra ?? 0
  if (!(extra >= 0) || !Number.isFinite(extra)) throw new Error(`σ_extra 必須 ≥ 0，收到 ${extra}`)
}

// ───────────────────────── Code 分布 ─────────────────────────

/** 依 CodeSpec 建立 code 分布。DSM 使用 x = −residue（first-order 時 x = s/M ∈ [0, 1)：非負的 DTC code，也就是 feedback edge 早到的量，以 T_vco 計）。 */
export function buildCodeDistribution(spec: CodeSpec): CodeDistribution {
  const shift = spec.shift ?? 0
  if (!Number.isFinite(shift)) throw new Error(`code 平移必須為有限數，收到 ${shift}`)
  const label = CODE_KIND_LABEL[spec.kind]
  const discrete = (vals: number[]): CodeDistribution => ({
    kind: spec.kind,
    label,
    shift,
    values: vals.map((v) => v + shift),
    probs: vals.map(() => 1 / vals.length),
    continuous: null,
    sequence: null,
    notes: [],
  })
  switch (spec.kind) {
    case 'five_level':
      return discrete([-2, -1, 0, 1, 2])
    case 'pm_one':
      return discrete([-1, 1])
    case 'unipolar4':
      return discrete([0, 1, 2, 3])
    case 'gaussian':
      return { kind: 'gaussian', label, shift, values: [], probs: [], continuous: { pdf: 'gaussian', lo: shift - 9, hi: shift + 9 }, sequence: null, notes: [] }
    case 'uniform_residue':
      return { kind: 'uniform_residue', label, shift, values: [], probs: [], continuous: { pdf: 'uniform', lo: shift, hi: shift + 1 }, sequence: null, notes: [] }
    case 'dsm': {
      const frac = spec.dsmFrac ?? 0.3
      const res = runDsm({ kind: spec.dsmKind ?? 'first_order', frac, bits: DSM_BITS, length: DSM_LENGTH })
      const seq = Array.from(res.residue, (r) => -r + shift)
      // 合併相同的值（residue 是 1/M 的整數倍，乘 2^20 後為精確整數鍵）
      const counts = new Map<number, number>()
      for (const v of seq) {
        const key = Math.round(v * 1048576)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      const keys = [...counts.keys()].sort((p, q) => p - q)
      const notes = [...res.warnings, `FCW frac 量化為 K/M = ${res.K}/${res.M} = ${res.fracEff}`]
      if (res.K === 0) notes.push('$K=0$：residue 恆為 0（整數 FCW），code 沒有變化')
      return {
        kind: 'dsm',
        label: `${label}，${spec.dsmKind === 'mash111' ? 'MASH 1-1-1' : 'first-order'}，frac = ${res.fracEff}`,
        shift,
        values: keys.map((k) => k / 1048576),
        probs: keys.map((k) => (counts.get(k) as number) / seq.length),
        continuous: null,
        sequence: seq,
        notes,
      }
    }
  }
}

// 10 點 Gauss–Legendre（[−1, 1]）
const GL_X = [0.1488743389816312, 0.4333953941292472, 0.6794095682990244, 0.8650633666889845, 0.9739065285171717]
const GL_W = [0.2955242247147529, 0.2692667193099963, 0.219086362515982, 0.1494513491505806, 0.0666713443086881]
const PANELS = 48

function pdfAt(c: NonNullable<CodeDistribution['continuous']>, shift: number, x: number): number {
  return c.pdf === 'gaussian' ? normPdf(x - shift) : 1
}

/**
 * E[f(x)]：離散分布直接加權求和；連續分布用 composite 10 點 Gauss–Legendre（48 等分 + 呼叫者給的斷點）。
 * 斷點用來把 sign/erf 的轉折處切開，使 σ_v → 0 時積分仍精確（被積函數在每一小段內光滑）。
 */
export function expectation(dist: CodeDistribution, f: (x: number) => number, breaks: number[] = []): number {
  if (!dist.continuous) {
    let s = 0
    for (let i = 0; i < dist.values.length; i++) s += dist.probs[i] * f(dist.values[i])
    return s
  }
  const c = dist.continuous
  const pts: number[] = []
  for (let i = 0; i <= PANELS; i++) pts.push(c.lo + ((c.hi - c.lo) * i) / PANELS)
  for (const b of breaks) if (b > c.lo && b < c.hi) pts.push(b)
  pts.sort((p, q) => p - q)
  let s = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    const u = pts[i]
    const v = pts[i + 1]
    if (!(v - u > 1e-14)) continue
    const h = (v - u) / 2
    const mid = (u + v) / 2
    for (let k = 0; k < GL_X.length; k++) {
      const d = h * GL_X[k]
      const x1 = mid - d
      const x2 = mid + d
      s += h * GL_W[k] * (f(x1) * pdfAt(c, dist.shift, x1) + f(x2) * pdfAt(c, dist.shift, x2))
    }
  }
  return s
}

/** code 的動差 E[x], E[x²], E[x³], E[x⁴], E[x⁶] 與 Var(x) */
export interface CodeMoments {
  Ex: number
  Ex2: number
  Ex3: number
  Ex4: number
  Ex6: number
  varX: number
}

export function codeMoments(dist: CodeDistribution): CodeMoments {
  const Ex = expectation(dist, (x) => x)
  const Ex2 = expectation(dist, (x) => x * x)
  return {
    Ex,
    Ex2,
    Ex3: expectation(dist, (x) => x * x * x),
    Ex4: expectation(dist, (x) => x * x * x * x),
    Ex6: expectation(dist, (x) => x ** 6),
    varX: Ex2 - Ex * Ex,
  }
}

/**
 * 連續 code 的積分斷點：e_det(x; w) + φ = 0 的實根 r，以及 r ± k·τ（τ = σ_v(r)/|∂e/∂x|，erf 轉折寬度）。
 * 離散分布不需要斷點。
 */
export function argBreakpoints(w: number, m: ErrorModel, phi: number, dist: CodeDistribution): number[] {
  if (!dist.continuous) return []
  const c1 = m.a - w + m.kappa
  const c0 = m.b + phi
  if (m.c3 === 0 && m.c2 === 0 && c1 === 0) return []
  const roots = polyRoots([m.c3, m.c2, c1, c0]).filter((z) => Math.abs(z.im) <= 1e-9 * (1 + Math.abs(z.re)))
  const out: number[] = []
  for (const z of roots) {
    const r = z.re
    out.push(r)
    const sig = sigmaAt(r, m)
    if (!(sig > 0)) continue
    const slope = Math.abs(3 * m.c3 * r * r + 2 * m.c2 * r + c1)
    const tau = sig / Math.max(slope, 1e-12)
    for (const k of [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12]) out.push(r - k * tau, r + k * tau)
  }
  return out
}

// ───────────────────────── Root finding ─────────────────────────

/** Brent 法求 [a, b] 內 f 的根（需 f(a)·f(b) ≤ 0）；不連續函數時退化為二分法，仍收斂到跳變點。 */
export function brentRoot(f: (x: number) => number, a0: number, b0: number, tol = 1e-13, maxIter = 300): number {
  let a = a0
  let b = b0
  let fa = f(a)
  let fb = f(b)
  if (fa === 0) return a
  if (fb === 0) return b
  if (fa * fb > 0) throw new Error('brentRoot：區間兩端同號，沒有夾住根')
  let c = a
  let fc = fa
  let d = b - a
  let e = d
  for (let it = 0; it < maxIter; it++) {
    if (fb * fc > 0) {
      c = a
      fc = fa
      d = b - a
      e = d
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b
      b = c
      c = a
      fa = fb
      fb = fc
      fc = fa
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol
    const xm = 0.5 * (c - b)
    if (Math.abs(xm) <= tol1 || fb === 0) return b
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa
      let p: number
      let q: number
      if (a === c) {
        p = 2 * xm * s
        q = 1 - s
      } else {
        const qq = fa / fc
        const r = fb / fc
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1))
        q = (qq - 1) * (r - 1) * (s - 1)
      }
      if (p > 0) q = -q
      p = Math.abs(p)
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d
        d = p / q
      } else {
        d = xm
        e = d
      }
    } else {
      d = xm
      e = d
    }
    a = b
    fa = fb
    b += Math.abs(d) > tol1 ? d : xm > 0 ? tol1 : -tol1
    fb = f(b)
  }
  return b
}

/** 從 x0 往兩側（倍增 span）找出 f 變號的區間；找不到時回傳 null。 */
export function bracketRoot(f: (x: number) => number, x0: number, span0: number, maxSpan = 1e4): { lo: number; hi: number } | null {
  const f0 = f(x0)
  if (f0 === 0) return { lo: x0, hi: x0 }
  let span = Math.max(span0, 1e-6)
  while (span <= maxSpan) {
    const lo = x0 - span
    const hi = x0 + span
    const flo = f(lo)
    const fhi = f(hi)
    if (flo * f0 <= 0) return { lo, hi: x0 }
    if (fhi * f0 <= 0) return { lo: x0, hi }
    span *= 2
  }
  return null
}

// ───────────────────────── 主迴路 DC null ─────────────────────────

// #region core:dcOffset
/**
 * 主迴路加到 comparator 輸入的 DC 偏移 φ(w)（勘誤 E03）。comparator 實際看到 e_det(x; w) + φ + v。
 */
export function dcOffset(w: number, m: ErrorModel, dist: CodeDistribution, dc: DcNullMode, alg: BiasAlgorithm): number {
  if (dc === 'none') return 0 // ← 差異：(A) none —— 主迴路不碰 comparator 的 DC（靜態式），φ = 0
  const meanEdet = expectation(dist, (x) => eDet(x, w, m)) // E[e_det]（含 b）
  if (dc === 'linear_pd') return m.b - meanEdet // ← 差異：(C) 線性 PD 強制 E[e_PD] = 0（e_PD 不含 b）⇒ φ = −E[e_det − b]；comparator 的 b 留下
  if (alg === 'mse') return -meanEdet // 共用（多位元）PD：積分路徑強制 E[e] = 0
  // ← 差異：(B) 共用 BBPD —— type-II 積分路徑強制 E[q] = E[erf((e_det + φ)/(√2σ_v))] = 0；對 φ 單調遞增 → root finding
  const eq = (phi: number) =>
    expectation(dist, (x) => comparatorMean(eDet(x, w, m) + phi, sigmaAt(x, m)), argBreakpoints(w, m, phi, dist))
  const br = bracketRoot(eq, -meanEdet, 0.1 + sigmaAt(0, m))
  if (!br) return Number.NaN
  return br.lo === br.hi ? br.lo : brentRoot(eq, br.lo, br.hi, 1e-13)
}
// #endregion

// ───────────────────────── 平均 GMAC 與固定點 ─────────────────────────

// #region core:meanGmacMse
/** MSE-LMS 的平均 GMAC：E[G] = E[x·e]（v 與 x 獨立且零均值，平均後消失）。 */
export function meanGmacMse(w: number, m: ErrorModel, dist: CodeDistribution, dc: DcNullMode = 'none'): number {
  const phi = dcOffset(w, m, dist, dc, 'mse') // 主迴路 DC null 的偏移（none 時為 0）
  return expectation(dist, (x) => x * (eDet(x, w, m) + phi)) // ← 差異：e 本身（多位元）乘 x
}
// #endregion

// #region core:meanGmacSign
/** Sign-LMS 的平均 GMAC：E[G] = E[x·E[q|x]] = E[x·erf((e_det + φ)/(√2σ_v(x)))]。 */
export function meanGmacSign(w: number, m: ErrorModel, dist: CodeDistribution, dc: DcNullMode = 'none'): number {
  const phi = dcOffset(w, m, dist, dc, 'sign') // 主迴路 DC null 的偏移（none 時為 0）
  const brk = argBreakpoints(w, m, phi, dist) // 連續 code：在 e_det + φ = 0 處切開積分區間
  return expectation(dist, (x) => x * comparatorMean(eDet(x, w, m) + phi, sigmaAt(x, m)), brk) // ← 差異：只用 1-bit 的 E[q|x] = erf(·)
}
// #endregion

export function meanGmac(alg: BiasAlgorithm, w: number, m: ErrorModel, dist: CodeDistribution, dc: DcNullMode = 'none'): number {
  return alg === 'mse' ? meanGmacMse(w, m, dist, dc) : meanGmacSign(w, m, dist, dc)
}

// #region core:mseFixedPoint
/** MSE-LMS 固定點：E[x·e] 對 w 是一條直線 ⇒ 兩點決定，直接解（不需要迭代）。 */
export function mseFixedPoint(m: ErrorModel, dist: CodeDistribution, dc: DcNullMode = 'none'): number {
  const g0 = meanGmacMse(0, m, dist, dc) // G(0)
  const g1 = meanGmacMse(1, m, dist, dc) // G(1)
  const slope = g0 - g1 // S = −dG/dw = E[x²]（DC null 時為 Var(x)）← 差異：G(w) 是直線
  if (!(Math.abs(slope) > 1e-14)) return Number.NaN // S = 0：code 沒有激勵 → 不可辨識
  return g0 / slope // 直線 G(w) = G(0) − S·w 的零點 ← 差異：封閉解，精確
}
// #endregion

export type FixedPointStatus = 'ok' | 'no-root' | 'unidentifiable'

export interface FixedPointResult {
  w: number
  status: FixedPointStatus
}

// #region core:signFixedPoint
/** Sign-LMS 固定點（mean-field）：解 E[x·erf((e_det + φ)/(√2σ_v))] = 0。 */
export function signFixedPoint(m: ErrorModel, dist: CodeDistribution, dc: DcNullMode = 'none'): FixedPointResult {
  const G = (w: number) => meanGmacSign(w, m, dist, dc) // ← 差異：G(w) 經過 erf，對 w 非線性
  const start = mseFixedPoint(m, dist, dc) // K_q 線性化的解（= MSE 解）當起點
  if (!Number.isFinite(start)) return { w: Number.NaN, status: 'unidentifiable' }
  const br = bracketRoot(G, start, 0.05 * (1 + Math.abs(start))) // ← 差異：往外擴張直到 G 變號
  if (!br) return { w: Number.NaN, status: 'no-root' }
  const w = br.lo === br.hi ? br.lo : brentRoot(G, br.lo, br.hi, 1e-13) // ← 差異：Brent（σ_v = 0 時退化為二分）
  return { w, status: 'ok' }
}
// #endregion

/** 依演算法求固定點（MSE：封閉解；Sign：mean-field root）。 */
export function fixedPoint(alg: BiasAlgorithm, m: ErrorModel, dist: CodeDistribution, dc: DcNullMode = 'none'): FixedPointResult {
  if (alg === 'mse') {
    const w = mseFixedPoint(m, dist, dc)
    return { w, status: Number.isFinite(w) ? 'ok' : 'unidentifiable' }
  }
  return signFixedPoint(m, dist, dc)
}

// #region core:linearizedFixedPoint
/**
 * 一階（K_q 線性化）固定點，權重 ω(x) = 1/σ_v(x)（code-dependent jitter，勘誤 E17；σ_v 為常數時 ω ≡ 1）。
 *   none       ：w* = a + E[ωxB]/E[ωx²]
 *   shared_bbpd：w* = a + Cov_ω(x, B)/Var_ω(x)            （b 被吸收成 static phase offset）
 *   linear_pd  ：w* = a + (E[ωxB] − E[ωx](E[B] − b))/(E[ωx²] − E[x]E[ωx])
 * 其中 B(x) = b + d(x) + κx；slope = K_q 正規化的 −dG/dw（σ_v = 0 時 NaN）。
 */
export function linearizedFixedPoint(
  m: ErrorModel,
  dist: CodeDistribution,
  dc: DcNullMode,
  weighted: boolean,
): { w: number; slope: number } {
  const om = (x: number) => (weighted && sigmaAt(x, m) > 0 ? 1 / sigmaAt(x, m) : 1)
  const B = (x: number) => m.b + m.c2 * x * x + m.c3 * x * x * x + m.kappa * x
  const E1 = expectation(dist, om)
  const Ex = expectation(dist, (x) => om(x) * x)
  const Exx = expectation(dist, (x) => om(x) * x * x)
  const ExB = expectation(dist, (x) => om(x) * x * B(x))
  let num: number
  let den: number
  if (dc === 'none') {
    num = ExB // ← 差異：(A) 分子 E[xB]（含 bE[x]）
    den = Exx // ← 差異：(A) 分母 E[x²]
  } else if (dc === 'shared_bbpd') {
    const EB = expectation(dist, (x) => om(x) * B(x))
    num = ExB - (Ex * EB) / E1 // ← 差異：(B) 分子 Cov(x, B)：常數 b 的共變異數為 0，offset 消失
    den = Exx - (Ex * Ex) / E1 // ← 差異：(B) 分母 Var(x)
  } else {
    const m1 = expectation(dist, (x) => x)
    const EBplain = expectation(dist, B)
    num = ExB - Ex * (EBplain - m.b) // ← 差異：(C) 分子 Cov(x, d + ε_cc) + b·E[x]：offset 項留下
    den = Exx - m1 * Ex // ← 差異：(C) 分母 Var(x)
  }
  const w = Math.abs(den) > 1e-14 ? m.a + num / den : Number.NaN
  const s0 = sigmaAt(0, m) // σ_v 與 code 無關時的常數值
  const kq = weighted ? KQ_FACTOR : s0 > 0 ? KQ_FACTOR / s0 : Number.NaN
  return { w, slope: kq * den }
}
// #endregion

// #region core:signSecondOrder
/**
 * Sign-LMS 的二階修正（σ_v 為常數、mode none）：erf(z) ≈ (2/√π)(z − z³/3) 的三次項給
 *   w* ≈ w_1 + Δ，Δ = −E[x·e_0³]/(6σ_v²·E[x²])，e_0 = e_det(x; w_1)，w_1 = 一階（= MSE）解。
 * 只在 σ_v ≫ max|e_0| 時有效（勘誤 E01）。
 */
export function signSecondOrder(m: ErrorModel, dist: CodeDistribution): number {
  const w1 = mseFixedPoint(m, dist, 'none') // 一階：K_q 線性化（= MSE 解）
  const s = sigmaAt(0, m) // σ_v（與 code 無關）
  if (!(s > 0) || !Number.isFinite(w1)) return Number.NaN
  const ex2 = expectation(dist, (x) => x * x)
  const exe3 = expectation(dist, (x) => {
    const e0 = eDet(x, w1, m)
    return x * e0 * e0 * e0 // x·e_0³
  })
  return w1 - exe3 / (6 * s * s * ex2) // 修正量 Δ = w* − w_1 = −E[x e_0³]/(6σ_v² E[x²])
}
// #endregion

// #region core:perCodeGain
/** 每個 code 自己的「零誤差 gain」t(x)：令 e_det(x; t) = 0 ⇒ t(x) = a + κ + (b + d(x))/x（x ≠ 0）。 */
export function perCodeGain(x: number, m: ErrorModel): number {
  return m.a + m.kappa + (m.b + m.c2 * x * x + m.c3 * x * x * x) / x
}
// #endregion

// #region core:mseWeightedMean
/** MSE-LMS（mode none）：E[x·e] = E[x²·(t(x) − w)] = 0 ⇒ w* 是 t(x) 的 x² 加權平均。 */
export function mseWeightedMean(m: ErrorModel, values: ArrayLike<number>, probs: ArrayLike<number>): number {
  let num = 0
  let den = 0
  for (let i = 0; i < values.length; i++) {
    const x = values[i]
    if (x === 0) continue // x = 0 對 GMAC 沒有貢獻
    const wt = probs[i] * x * x // ← 差異：權重 p·x²
    num += wt * perCodeGain(x, m)
    den += wt
  }
  return den > 0 ? num / den : Number.NaN // ← 差異：加權「平均」
}
// #endregion

// #region core:signWeightedMedian
/** 無雜訊 Sign-LMS（mode none）：E[x·sign(e)] = E[|x|·sign(t(x) − w)] = 0 ⇒ w* 是 t(x) 的 |x| 加權中位數。 */
export function signWeightedMedian(m: ErrorModel, values: ArrayLike<number>, probs: ArrayLike<number>): { lo: number; hi: number } {
  const items: { t: number; wt: number }[] = []
  for (let i = 0; i < values.length; i++) {
    const x = values[i]
    if (x === 0 || probs[i] <= 0) continue
    items.push({ t: perCodeGain(x, m), wt: probs[i] * Math.abs(x) }) // ← 差異：權重 p·|x|
  }
  items.sort((p, q) => p.t - q.t)
  const merged: { t: number; wt: number }[] = [] // 相同 t 合併
  for (const it of items) {
    const last = merged[merged.length - 1]
    if (last && Math.abs(last.t - it.t) <= 1e-12 * (1 + Math.abs(it.t))) last.wt += it.wt
    else merged.push({ ...it })
  }
  const half = merged.reduce((s, it) => s + it.wt, 0) / 2
  let cum = 0
  for (let i = 0; i < merged.length; i++) {
    cum += merged[i].wt
    if (Math.abs(cum - half) <= 1e-12) return { lo: merged[i].t, hi: merged[i + 1]?.t ?? merged[i].t } // 剛好一半：整段都是解（dead zone）
    if (cum > half) return { lo: merged[i].t, hi: merged[i].t } // ← 差異：累積權重越過一半處 = 加權「中位數」
  }
  return { lo: Number.NaN, hi: Number.NaN }
}
// #endregion

// ───────────────────────── GMAC 斜率與有限步長偏差 ─────────────────────────

/**
 * GMAC 斜率 S = −dE[G]/dw（中央差分）。無雜訊 Sign-LMS 的 G(w) 是階梯，改用寬一點的割線斜率
 * （h = 0.02(1 + |w|)），只用來設定 μ 的量級。
 * 註：本章的 S 與全站的 K = K_q·C（勘誤 E13）同號（S > 0 才有恢復力）；規格 §11.4 的 S_GMAC = ∂E[G]/∂w = −S。
 */
export function gmacSlope(alg: BiasAlgorithm, w: number, m: ErrorModel, dist: CodeDistribution, dc: DcNullMode): number {
  if (!Number.isFinite(w)) return Number.NaN
  const stepLike = alg === 'sign' && !(sigmaAt(0, m) > 0)
  const h = (stepLike ? 0.02 : 1e-4) * (1 + Math.abs(w))
  return (meanGmac(alg, w - h, m, dist, dc) - meanGmac(alg, w + h, m, dist, dc)) / (2 * h)
}

export interface FiniteStepParams {
  model: ErrorModel
  code: CodeSpec
  algorithm: BiasAlgorithm
  dcMode: DcNullMode
  /** 學習率 μ */
  mu: number
  /** 每個 block 的 sample 數 N */
  N: number
  /** 固定點（省略時自行求解） */
  wStar?: number
  /** 主迴路 servo 每 sample 的增益 k_φ（DC null 模式估計 servo 落後用；預設 0.01） */
  servoGain?: number
}

export interface FiniteStepEstimate {
  /** 二階估計的時間平均偏移 E[w̄] − w* ≈ G″(w*)·Var(w)/(2S)（MSE-LMS 為 0；非光滑時 NaN） */
  bias: number
  /**
   * DC null 模式的 servo 落後項：w 每個 block 跳一步，φ 要 τ = 1/(k_φ·K_servo) 個 sample 才跟上；
   * 這段時間 comparator 看到的是「φ 凍結」的 G(w)，它的曲率 G″_frozen 把沒跟上的那部分抖動整流成偏移
   * ≈ G″_frozen·Var_untracked/(2S)，Var_untracked ≈ (μ²E[x²]/N)·(τ/N)（不超過 Var(w)）。mode none 為 0。
   */
  lagBias: number
  /** servo 時間常數 τ（samples；mode none 為 0） */
  servoTau: number
  /** w 的穩態標準差估計 √(μ²E[x²]/(N·g(2 − g)))（Sign；g = μS） */
  sdW: number
  /** 平均步長的上界 μ·E|x|（|E[G]| ≤ E|x|）：limit cycle 的幅度量級 */
  bound: number
  /**
   * MC 交叉比對用的容許量（MSE 為 0）：
   * 光滑時 min(2|bias| + 4|lagBias|, bound)；非光滑（σ_v = 0 的離散 code）時 bound + 兩側漂移不對稱造成的偏移
   * μE[x²]/(2N)·|1/G₋ − 1/G₊|（G∓ = w* 兩側的平均 GMAC 大小）。
   */
  allowance: number
  /** G(w) 在 w* 附近是否光滑（σ_v > 0 或連續 code） */
  smooth: boolean
  /** S = −dE[G]/dw 與 g = μS */
  slope: number
  g: number
}

// #region core:finiteStepBias
/**
 * 有限步長造成的「時間平均 ≠ mean-field 根」估計（只用泰勒展開）：
 *   w_{k+1} = w_k + μG_k，G_k = E[G](w_k) + η_k，Var(η) ≈ E[x²]/N（Sign：(q·x)² = x²，固定點處 E[G] = 0）
 *   令 δw = w − w*：E[G](w) ≈ −S·δw + ½G″·δw²
 *   穩態 E[w_{k+1}] = E[w_k] ⇒ E[E[G](w)] = 0 ⇒ E[δw] ≈ G″·Var(w)/(2S)
 *   線性化的抖動 δw_{k+1} = (1 − g)δw_k + μη_k ⇒ Var(w) = μ²Var(η)/(1 − (1 − g)²) = μ²E[x²]/(N·g(2 − g))
 * MSE-LMS 的 E[G](w) 是直線（G″ = 0），沒有這個偏移。
 * 無雜訊 Sign-LMS 配離散 code 時 G 是階梯（w* 左側平均 +G₋、右側 −G₊），w 在 w* 附近做 limit cycle：
 *   ‧N 大（步長幾乎確定）：每個 block 最多走 μ·E|x| ⇒ 偏移不超過 μ·E|x|
 *   ‧N 小（步長很隨機）：兩側是漂移相反的隨機漫步，穩態密度各以長度 L∓ = Var(μG_k)/(2μG∓) 指數衰減，
 *     平均偏移 ≈ L₊ − L₋ = μE[x²]/(2N)·(1/G₊ − 1/G₋)
 * 兩項相加當作容許量。
 * DC null 模式另外加上 servo 落後項 lagBias（見 FiniteStepEstimate.lagBias）。
 */
export function finiteStepBias(p: FiniteStepParams): FiniteStepEstimate {
  const { model: m, algorithm: alg, dcMode: dc, mu, N } = p
  const dist = buildCodeDistribution(p.code)
  const wStar = p.wStar ?? fixedPoint(alg, m, dist, dc).w
  const S = gmacSlope(alg, wStar, m, dist, dc)
  const g = mu * S
  if (alg === 'mse') return { bias: 0, lagBias: 0, servoTau: 0, sdW: Number.NaN, bound: 0, allowance: 0, smooth: true, slope: S, g } // ← 差異：MSE 的 G(w) 是直線，沒有曲率偏移
  const ex2 = expectation(dist, (x) => x * x)
  const bound = mu * expectation(dist, (x) => Math.abs(x)) // |E[G]| ≤ E|x|
  const varW = g > 0 && g < 2 ? (mu * mu * ex2) / (N * g * (2 - g)) : Number.NaN
  const sdW = Math.sqrt(varW)
  const smooth = sigmaAt(0, m) > 0 || !!dist.continuous
  const G = (w: number) => meanGmacSign(w, m, dist, dc)
  if (!smooth && Number.isFinite(wStar)) {
    const eps = 1e-7 * (1 + Math.abs(wStar))
    const gl = Math.abs(G(wStar - eps)) // G₋：w* 左側的平均 GMAC（階梯的高度）
    const gr = Math.abs(G(wStar + eps)) // G₊：右側
    const asym = gl > 0 && gr > 0 ? ((mu * ex2) / (2 * N)) * Math.abs(1 / gl - 1 / gr) : 0 // dead zone（某側為 0）另由區間比對處理
    return { bias: Number.NaN, lagBias: 0, servoTau: 0, sdW, bound, allowance: bound + asym, smooth, slope: S, g }
  }
  if (!Number.isFinite(wStar) || !Number.isFinite(varW)) return { bias: Number.NaN, lagBias: 0, servoTau: 0, sdW, bound, allowance: bound, smooth, slope: S, g }
  const h = 1e-3 * (1 + Math.abs(wStar))
  const curv = (G(wStar + h) - 2 * G(wStar) + G(wStar - h)) / (h * h) // G″(w*)（中央二階差分）
  const bias = (curv * varW) / (2 * S) // ← 差異：Sign 的 erf 有曲率 ⇒ 抖動被「整流」成偏移
  // DC null：servo 落後 w 的 block-to-block 跳動 ⇒ 那一小段時間用的是「φ 凍結」的 G(w)
  let lagBias = 0
  let servoTau = 0
  if (dc !== 'none') {
    const phi = dcOffset(wStar, m, dist, dc, 'sign')
    const frozen = (w: number, ph: number) =>
      expectation(dist, (x) => x * comparatorMean(eDet(x, w, m) + ph, sigmaAt(x, m)), argBreakpoints(w, m, ph, dist))
    const curvFrozen = (frozen(wStar + h, phi) - 2 * frozen(wStar, phi) + frozen(wStar - h, phi)) / (h * h)
    const eq = (ph: number) => expectation(dist, (x) => comparatorMean(eDet(x, wStar, m) + ph, sigmaAt(x, m)), argBreakpoints(wStar, m, ph, dist))
    const hp = 1e-4 * (1 + sigmaAt(0, m))
    const kServo = dc === 'shared_bbpd' ? (eq(phi + hp) - eq(phi - hp)) / (2 * hp) : 1 // dE[q]/dφ（BBPD）；線性 PD 的增益為 1
    servoTau = 1 / Math.max((p.servoGain ?? 0.01) * kServo, 1e-12)
    const varUntracked = Math.min(varW, ((mu * mu * ex2) / N) * (servoTau / N))
    lagBias = (curvFrozen * varUntracked) / (2 * S)
  }
  // 容許量：曲率項取 2 倍；servo 落後項只是量級估計（MC 實測落在估計值的 0.3–3 倍），取 4 倍
  const total = 2 * Math.abs(bias) + 4 * Math.abs(lagBias)
  const allowance = Number.isFinite(total) ? Math.min(total, bound) : bound
  return { bias, lagBias, servoTau, sdW, bound, allowance, smooth, slope: S, g }
}
// #endregion

// ───────────────────────── 分析（主執行緒，即時） ─────────────────────────

export interface BiasAnalysisParams {
  model: ErrorModel
  code: CodeSpec
  algorithm: BiasAlgorithm
  dcMode: DcNullMode
  /** 初始暫存器值（「校正前」的 E[e²] 用） */
  w0?: number
  /** G(w) 曲線點數（預設 121） */
  curvePoints?: number
  /** 主迴路 servo 增益 k_φ（只用來判斷「servo 是否跟得上 DSM pattern」的警告；預設 0.01） */
  servoGain?: number
}

export interface ResidualRow {
  x: number
  p: number
  /** per-code gain t(x)（x = 0 時 NaN） */
  t: number
  /** w* 處的確定性殘差（含 DC null 偏移 φ） */
  eStar: number
  /** w = a 處的殘差 */
  eAtA: number
  /** x·e(w*) */
  xe: number
  /** x·E[GMAC 統計量 | x] at w*：MSE 為 x·e，Sign 為 x·erf(e/(√2σ_v(x)))（這一欄的機率加權平均 = E[G](w*) = 0） */
  xg: number
}

export interface BiasAnalysis {
  distLabel: string
  continuous: boolean
  supportSize: number
  moments: CodeMoments
  /** MSE-LMS 精確固定點（同一 DC mode） */
  wMse: number
  /** K_q 線性化（Sign 含 1/σ_v(x) 加權） */
  wLinear: number
  /** 此演算法的固定點（MSE：封閉解；Sign：mean-field root） */
  wStar: number
  status: FixedPointStatus
  /** Sign、σ_v 常數、mode none：二階修正；其他情況 NaN */
  wSecondOrder: number
  /** 無雜訊 Sign（離散、mode none）：|x| 加權中位數區間；其他 null */
  zeroSet: { lo: number; hi: number } | null
  /** −dG/dw at w*（數值；σ_v = 0 時為割線斜率） */
  slope: number
  /** w* 處主迴路加上的 φ */
  phiStar: number
  /** max|e_det + φ|/σ_v(x)（Sign；連續分布取 99.99% 範圍）；越小線性化越準 */
  validityRatio: number
  curve: { w: number[]; G: number[]; Glin: number[] }
  residual: ResidualRow[] | null
  residualCurve: { x: number[]; eStar: number[]; eAtA: number[]; density: number[] }
  /** E[(e_det + φ)²]、E|e_det + φ| 與總功率 E[e²] = E[(e_det+φ)²] + E[σ_v(x)²] */
  costs: { at: 'w0' | 'a' | 'wStar'; w: number; mse: number; mae: number; total: number }[]
  warnings: string[]
}

function residualArg(w: number, m: ErrorModel, dist: CodeDistribution, dc: DcNullMode, alg: BiasAlgorithm) {
  const phi = dcOffset(w, m, dist, dc, alg)
  return { phi, f: (x: number) => eDet(x, w, m) + phi }
}

/** 主執行緒的即時分析（不含 Monte Carlo）。 */
export function analyzeBias(p: BiasAnalysisParams): BiasAnalysis {
  const { model: m, algorithm: alg, dcMode: dc } = p
  validateModel(m)
  const dist = buildCodeDistribution(p.code)
  const mo = codeMoments(dist)
  const warnings: string[] = [...dist.notes.filter((n) => n.startsWith('$K=0$'))]
  const constSigma = (m.jitterSlope ?? 0) === 0
  const noisy = sigmaAt(0, m) > 0 // σ_v > 0（或 sigmaExtra > 0）：comparator 前有 dither
  const wMse = mseFixedPoint(m, dist, dc)
  const lin = alg === 'sign' && noisy ? linearizedFixedPoint(m, dist, dc, !constSigma) : { w: wMse, slope: Number.NaN }
  const fp = fixedPoint(alg, m, dist, dc)
  const wStar = fp.w
  const wSecondOrder = alg === 'sign' && constSigma && dc === 'none' && noisy ? signSecondOrder(m, dist) : Number.NaN
  const zeroSet = alg === 'sign' && !noisy && dc === 'none' && !dist.continuous ? signWeightedMedian(m, dist.values, dist.probs) : null

  // 不可辨識 / 無根
  if (dc === 'none' && !(mo.Ex2 > 1e-14)) warnings.push(String.raw`$E[x^2]=0$：$x\equiv0$，GMAC 對 $w$ 沒有任何敏感度（沒有激勵，$\lambda_\mathrm{min}=0$：不可辨識）。`)
  if (dc !== 'none' && !(mo.varX > 1e-14))
    warnings.push(String.raw`$\operatorname{Var}(x)=0$：主迴路 DC null 把 code 的平均值移除後，有效 regressor 只剩 0 —— GMAC 對 $w$ 完全沒有敏感度（$\lambda_\mathrm{min}=0$：不可辨識）。`)
  if (fp.status === 'no-root') warnings.push(String.raw`mean GMAC 在掃描範圍（$\pm10^4$）內不變號：沒有可吸引的固定點（檢查極性與激勵），$w$ 會一路漂移。`)

  const G = (w: number) => meanGmac(alg, w, m, dist, dc)
  // 斜率 S = −dE[G]/dw；dead zone（G = 0 的整段區間）時改用跨過整段區間的割線斜率，μ 才設得出來
  let slope = gmacSlope(alg, wStar, m, dist, dc)
  if (zeroSet && zeroSet.hi - zeroSet.lo > 1e-9) {
    const h = 0.02 * (1 + Math.abs(wStar))
    slope = (meanGmac(alg, zeroSet.lo - h, m, dist, dc) - meanGmac(alg, zeroSet.hi + h, m, dist, dc)) / (zeroSet.hi - zeroSet.lo + 2 * h)
  }

  // w* 處的殘差
  const wRef = Number.isFinite(wStar) ? wStar : m.a
  const rs = residualArg(wRef, m, dist, dc, alg)
  const ra = residualArg(m.a, m, dist, dc, alg)
  let validityRatio = Number.NaN
  if (alg === 'sign') {
    const xs = dist.continuous ? gridOver(dist, 401, true) : dist.values
    let mx = 0
    for (const x of xs) {
      const s = sigmaAt(x, m)
      mx = Math.max(mx, s > 0 ? Math.abs(rs.f(x)) / s : Math.abs(rs.f(x)) > 1e-15 ? Infinity : 0)
    }
    validityRatio = mx
  }

  // comparator 飽和：w* 附近所有 code 的 |e_det|/σ_v 都很大 ⇒ q 幾乎恆為同號，GMAC 沒有資訊
  if (alg === 'sign' && noisy) {
    const active = expectation(dist, (x) => (x !== 0 && Math.abs(rs.f(x)) / sigmaAt(x, m) < 5 ? 1 : 0))
    if (active < 1e-6)
      warnings.push(
        String.raw`Comparator 飽和：$w^*$ 附近所有 code 的 $|e_\mathrm{det}+\varphi|/\sigma_v>5$，$q$ 幾乎恆為同一個正負號 —— GMAC 對 $w$ 幾乎沒有敏感度（$S\approx0$），固定點只由數值雜訊決定。先修正 offset、縮小 INL，或提高 $\sigma_v$（dither）。`,
      )
  }
  if (alg === 'sign' && !noisy) {
    warnings.push(
      String.raw`$\sigma_v=0$：無雜訊 Sign-LMS 的固定點由 $|x|$ 加權中位數決定（MAE 解），不是 MSE 的 $x^2$ 加權平均；實際的 $w$ 會在 $O(\mu)$ 的 limit cycle 中跳動（勘誤 E01）。`,
    )
    if (zeroSet && zeroSet.hi - zeroSet.lo > 1e-9)
      warnings.push(
        String.raw`$\sigma_v=0$ 且 $|x|$ 加權中位數是一整段區間 $(${fmtTex(zeroSet.lo)},\ ${fmtTex(zeroSet.hi)})$：$G(w)=0$ 的解不唯一（dead zone），$w$ 停在哪裡取決於初值與 $\mu$；加入雜訊（$\sigma_v>0$）才有唯一的零交越。`,
      )
  } else if (alg === 'sign' && validityRatio > 0.3) {
    warnings.push(
      String.raw`線性化失效風險：$w^*$ 處 $\max|e_\mathrm{det}|/\sigma_v=${fmtTex(validityRatio)}>0.3$，$E[q\mid x]$ 已進入 erf 的飽和區；固定點應以 mean-field root（$${fmtTex(wStar)}$）為準，$w^*=a+(bE[x]+E[x\,d]+E[x\,\varepsilon_{cc}])/E[x^2]$ 不適用（勘誤 E01）。`,
    )
  }
  if (m.kappa !== 0)
    warnings.push(String.raw`$\kappa\neq0$：$\varepsilon_{cc}=\kappa x$ 與真實 gain 共線，$w^*$ 多出 $\kappa=${fmtTex(m.kappa)}$；只靠 $(x,q)$ 無法分辨 $a$ 與 $\kappa$（不可辨識，需額外 training／觀測者／約束）。`)
  if (!dist.continuous && m.c3 !== 0) {
    const nz = dist.values.filter((x, i) => x !== 0 && dist.probs[i] > 0).map(Math.abs)
    if (nz.length > 0 && Math.max(...nz) - Math.min(...nz) < 1e-12)
      warnings.push(
        String.raw`所有非零 code 的 $|x|$ 都等於 $${fmtTex(nz[0])}$：$x^3=${fmtTex(nz[0] ** 2)}\,x$ 與 gain 項共線，三階 INL 完全被當成 gain 誤差（$w^*$ 多出 $c_3x^2=${fmtTex(m.c3 * nz[0] ** 2)}$，不可辨識；勘誤 E11 的 $\pm1$ code 例）。`,
      )
  }
  if (alg === 'sign' && !constSigma && dc === 'none' && Math.abs(mo.Ex) < 1e-12 && m.b !== 0)
    warnings.push(String.raw`code 已置中（$E[x]=0$），但 $\sigma_v$ 隨 code 變化：Sign-LMS 的固定點變成 $1/\sigma_v(x)$ 加權，offset $b$ 仍會造成 gain bias（勘誤 E17）；MSE-LMS 不受影響。`)

  // DSM 的慢 pattern 被主迴路 servo 跟上：iid mean-field 不適用（§11.4 的 H_PD 濾波效應）
  if (dist.kind === 'dsm' && dc !== 'none') {
    const f = Math.round((p.code.dsmFrac ?? 0.3) * 2 ** DSM_BITS) / 2 ** DSM_BITS
    const omega1 = 2 * Math.PI * Math.min(f, 1 - f) // residue sawtooth 的基頻（rad/sample）
    const kPhi = p.servoGain ?? 0.01
    const spread = Math.sqrt(Math.max(0, expectation(dist, (x) => rs.f(x) ** 2) - expectation(dist, (x) => rs.f(x)) ** 2))
    const sEff = Math.max(sigmaAt(0, m), spread, 1e-6)
    const omegaServo = dc === 'linear_pd' || alg === 'mse' ? kPhi : (kPhi * KQ_FACTOR) / sEff // servo 的 −3 dB 頻寬量級（rad/sample）
    if (omega1 > 0 && omega1 < 10 * omegaServo)
      warnings.push(
        String.raw`DSM residue 的基頻 $\Omega_1=2\pi\times${fmtTex(Math.min(f, 1 - f))}=${fmtTex(omega1)}$ rad/sample 沒有遠高於主迴路 servo 頻寬（約 $${fmtTex(omegaServo)}$ rad/sample）：servo 會跟著 code pattern 走，把低頻的 $x$ 也一起消掉（這正是 §11.4 的 $H_\mathrm{PD}$ 濾波：$C=E[x\,(h*x)]\neq\operatorname{Var}(x)$）。此時「iid code + 理想 DC null」的 mean-field 不適用，請以 Monte Carlo 為準，或降低 $k_\varphi$。`,
      )
  }

  // G(w) 曲線
  const span0 = [m.a, wRef, p.w0 ?? m.a].filter(Number.isFinite)
  const lo0 = Math.min(...span0)
  const hi0 = Math.max(...span0)
  const pad = 0.3 * (hi0 - lo0) + 0.25
  const nPts = Math.max(11, Math.min(401, Math.round(p.curvePoints ?? 121)))
  const cw: number[] = []
  const cg: number[] = []
  const cl: number[] = []
  for (let i = 0; i < nPts; i++) {
    const w = lo0 - pad + ((hi0 - lo0 + 2 * pad) * i) / (nPts - 1)
    cw.push(w)
    cg.push(G(w))
    cl.push(Number.isFinite(lin.slope) && Number.isFinite(lin.w) ? lin.slope * (lin.w - w) : alg === 'mse' ? G(w) : Number.NaN)
  }

  // 殘差表（離散、支撐點 ≤ 16）
  let residual: ResidualRow[] | null = null
  if (!dist.continuous && dist.values.length <= 16) {
    residual = dist.values.map((x, i) => {
      const es = rs.f(x)
      const xg = alg === 'sign' ? x * comparatorMean(es, sigmaAt(x, m)) : x * es
      return { x, p: dist.probs[i], t: x !== 0 ? perCodeGain(x, m) : Number.NaN, eStar: es, eAtA: ra.f(x), xe: x * es, xg }
    })
  }
  const gx = dist.continuous ? gridOver(dist, 201, false) : dist.values
  const residualCurve = {
    x: Array.from(gx),
    eStar: Array.from(gx, (x) => rs.f(x)),
    eAtA: Array.from(gx, (x) => ra.f(x)),
    density: dist.continuous
      ? Array.from(gx, (x) => pdfAt(dist.continuous as NonNullable<CodeDistribution['continuous']>, dist.shift, x))
      : Array.from(dist.probs),
  }

  // E[e²] before / after
  const noisePow = expectation(dist, (x) => sigmaAt(x, m) ** 2)
  const costAt = (at: 'w0' | 'a' | 'wStar', w: number) => {
    const r = residualArg(w, m, dist, dc, alg)
    const brk = argBreakpoints(w, m, r.phi, dist)
    const mse = expectation(dist, (x) => r.f(x) ** 2)
    const mae = expectation(dist, (x) => Math.abs(r.f(x)), brk)
    return { at, w, mse, mae, total: mse + noisePow }
  }
  const costs = [costAt('w0', p.w0 ?? m.a), costAt('a', m.a)]
  if (Number.isFinite(wStar)) costs.push(costAt('wStar', wStar))

  return {
    distLabel: dist.label,
    continuous: !!dist.continuous,
    supportSize: dist.continuous ? Infinity : dist.values.length,
    moments: mo,
    wMse,
    wLinear: lin.w,
    wStar,
    status: fp.status,
    wSecondOrder,
    zeroSet,
    slope,
    phiStar: rs.phi,
    validityRatio,
    curve: { w: cw, G: cg, Glin: cl },
    residual,
    residualCurve,
    costs,
    warnings,
  }
}

/** 連續分布的格點（central = true 時 Gaussian 只取 ±3.9σ，約 99.99% 機率） */
function gridOver(dist: CodeDistribution, n: number, central: boolean): number[] {
  const c = dist.continuous as NonNullable<CodeDistribution['continuous']>
  const lo = c.pdf === 'gaussian' ? dist.shift - (central ? 3.9 : 4) : c.lo
  const hi = c.pdf === 'gaussian' ? dist.shift + (central ? 3.9 : 4) : c.hi
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1))
}

function fmt(x: number): string {
  if (!Number.isFinite(x)) return String(x)
  return Number(x.toPrecision(6)).toString()
}

/**
 * fmt 的 TeX 版：放進警告訊息的 `$…$` 行內公式用（ExperimentShell／Gallery 以 mathText 渲染）。
 * 科學記號改成 a\times10^{b}，非有限值改成 \infty／\text{—}。
 */
function fmtTex(x: number): string {
  if (Number.isNaN(x)) return String.raw`\text{—}`
  if (!Number.isFinite(x)) return x > 0 ? String.raw`\infty` : String.raw`-\infty`
  const sci = /^(-?[\d.]+)e([+-]?\d+)$/.exec(fmt(x))
  return sci ? String.raw`${sci[1]}\times10^{${Number(sci[2])}}` : fmt(x)
}

/** μ 的自動設定：μ = g/S（S = −dG/dw at w*），讓平均 pole p = 1 − g。 */
export function autoMu(slope: number, gTarget = 0.02): number {
  return slope > 0 && Number.isFinite(slope) ? gTarget / slope : Number.NaN
}

// ───────────────────────── Monte Carlo（worker） ─────────────────────────

export interface BiasMcParams {
  model: ErrorModel
  code: CodeSpec
  algorithm: BiasAlgorithm
  dcMode: DcNullMode
  /** 學習率 μ（Sign：t.u.；MSE：無因次） */
  mu: number
  /** 每個 GMAC block 的 sample 數 N */
  N: number
  /** 每條 chain 的 block 數 */
  blocks: number
  /** 前面丟棄（burn-in）的比例，預設 0.5 */
  burnInFraction?: number
  /** 獨立 chain 數（各自 fork seed） */
  chains: number
  /** 主迴路 servo 每 sample 的增益 k_φ（DC null 模式），預設 0.01 */
  servoGain?: number
  /** 初始 w */
  w0: number
  seed: number
  /** 記錄軌跡的 chain 數（預設 3） */
  traceChains?: number
  /** 每條軌跡最多點數（預設 1500） */
  traceMaxPoints?: number
  /** 凍結 w 時估計 E[G] 的位置 */
  gmacPoints?: number[]
  /** 每個凍結點的 sample 數（預設 20000；切成 20 批做 batch-means 信賴區間） */
  gmacSamples?: number
  /**
   * 規格 §11.4 的量測：凍結 gain，在 center ± delta 各量一次平均 GMAC，以中央差分求斜率。
   * center 通常給解析的 w*；delta 不宜太大（erf 的非線性讓割線斜率小於切線斜率）。
   */
  slopeProbe?: { center: number; delta: number }
  /**
   * Run-to-Convergence：自動把 blocks 加倍重跑，直到 (a) averaging window 前後半的平均差在統計上不顯著
   * （|差| ≤ 它自己的 95% CI 半寬），且 (b) 若給了 loopGain，burn-in ≥ 7 個時間常數（g·burn ≥ 7，殘餘暫態 < 0.1%）。
   * 最多加倍 6 次（且總 sample 數不超過上限）。預設 false。
   */
  untilSettled?: boolean
  /** g = μS 的估計（只給 Run-to-Convergence 判斷 burn-in 是否夠長；省略則只看漂移） */
  loopGain?: number
}

/** MC 要對照的解析參考值（由同一組參數計算，worker 內完成） */
export interface BiasMcReference {
  /** 理想 mean-field 固定點（主迴路 φ 視為常數） */
  wMeanField: number
  /**
   * servo-aware 固定點：把 servo 的 φ 抖動當成額外 dither，σ_eff(x)² = σ_v(x)² + Var(φ) 的 mean-field 根。
   * mode none、MSE-LMS、或 φ 沒有抖動時等於 wMeanField。
   */
  wServoAware: number
  /** 有限步長偏移的估計與容許量（以 wServoAware 為中心） */
  step: FiniteStepEstimate
}

export interface BiasMcResult {
  /** 每條 chain 在 burn-in 之後的時間平均 w */
  chainMeans: number[]
  mean: number
  lo: number
  hi: number
  halfWidth: number
  se: number
  /** averaging window 前半 vs 後半的平均差（未收斂檢查） */
  driftCheck: { mean: number; halfWidth: number; settled: boolean }
  traces: { k: number[]; w: number[][] }
  /** 主迴路 φ 在 averaging window 的平均（chain 0，逐 sample） */
  phiMean: number
  /** φ 在 averaging window 的標準差（chain 0，逐 sample）：servo 自己的抖動，等效於額外的 comparator dither */
  phiStd: number
  /** comparator 端的 E[q]（Sign）或 E[e]（MSE），averaging window（chain 0） */
  qMean: number
  gmac: { w: number[]; mean: number[]; halfWidth: number[] }
  totalSamples: number
  /** 實際使用的 blocks（untilSettled 時可能是輸入的 2、4、8 倍） */
  blocksUsed: number
  /** 是否有 chain 發散（|w| > 1e9 或非有限） */
  diverged: boolean
  reference: BiasMcReference
  /** 凍結 w、±Δ 的 GMAC 斜率量測（沒有要求 slopeProbe 時為 null） */
  slopeProbe: SlopeProbeResult | null
  warnings: string[]
}

export interface SlopeProbeResult {
  center: number
  delta: number
  /** 凍結在 center − Δ、center + Δ 時量到的平均 GMAC */
  gMinus: number
  gPlus: number
  /** 本章的 Ŝ = (G₋ − G₊)/(2Δ)（= −Ŝ_GMAC；> 0 才有恢復力）與它的標準誤 */
  slope: number
  se: number
  /** 同一個 Δ 的 mean-field 割線斜率（DC null 模式用 servo-aware 的 σ_eff）：MC 應與它一致 */
  meanFieldSecant: number
  /** mean-field 的切線斜率 S（Δ → 0） */
  meanFieldTangent: number
}

interface ChainCfg {
  a: number
  b: number
  c2: number
  c3: number
  kappa: number
  sign: boolean
  dc: DcNullMode
  kPhi: number
  N: number
  sigmaAt: (x: number) => number
}

interface ChainState {
  w: number
  phi: number
  nextX: () => number
  noise: () => number
  /** 累積 q（或 e）的總和與次數（chain 0 統計用） */
  qSum: number
  qCount: number
  /** 累積 comparator 實際用到的 φ 與 φ²（chain 0 統計用：servo 抖動） */
  phiSum: number
  phiSq: number
}

function makeXSource(dist: CodeDistribution, rng: Rng): () => number {
  if (dist.sequence) {
    const seq = dist.sequence
    let i = rng.int(0, seq.length - 1) // 每條 chain 從隨機相位開始
    return () => {
      const v = seq[i]
      i = i + 1 === seq.length ? 0 : i + 1
      return v
    }
  }
  if (dist.continuous) {
    const s = dist.shift
    return dist.continuous.pdf === 'gaussian' ? () => s + rng.normal() : () => s + rng.uniform()
  }
  const vals = dist.values
  const probs = dist.probs
  const equal = probs.every((q) => Math.abs(q - probs[0]) < 1e-15)
  if (equal) return () => vals[rng.int(0, vals.length - 1)]
  const cdf: number[] = []
  let acc = 0
  for (const q of probs) cdf.push((acc += q))
  return () => {
    const u = rng.uniform() * acc
    let j = 0
    while (j < cdf.length - 1 && u >= cdf[j]) j++
    return vals[j]
  }
}

// #region core:mcBlock
/** 跑一個 GMAC block（N 個 comparator sample），回傳 block 平均 G_k；主迴路 servo 逐 sample 更新 φ。 */
function runBlock(st: ChainState, cfg: ChainCfg, record: boolean): number {
  let acc = 0
  for (let n = 0; n < cfg.N; n++) {
    const x = st.nextX() // 這個 sample 的 code
    const ed = (cfg.a - st.w) * x + cfg.b + cfg.c2 * x * x + cfg.c3 * x * x * x + cfg.kappa * x // e_det
    const sig = cfg.sigmaAt(x)
    const v = sig > 0 ? sig * st.noise() : 0 // comparator 前的 Gaussian 雜訊
    const phi = cfg.dc === 'none' ? 0 : st.phi // 主迴路此刻加上的 static phase offset（none：不加）
    let e: number
    if (cfg.dc === 'linear_pd') {
      const ePd = ed - cfg.b + phi + v // 線性 PD 看到的誤差（不含 comparator 自己的 offset）
      st.phi -= cfg.kPhi * ePd // 線性積分路徑：強制 E[e_PD] = 0
      e = ePd + cfg.b // 獨立 comparator 再加上它的 offset b
    } else {
      e = ed + phi + v
    }
    const q = cfg.sign ? (e >= 0 ? 1 : -1) : e // ← 差異：Sign 只留 1 bit（硬體 tie → +1）；MSE 用整個 e
    if (cfg.dc === 'shared_bbpd') st.phi -= cfg.kPhi * q // type-II 積分路徑：強制 E[q] = 0（共用 BBPD）
    if (record) {
      st.qSum += q
      st.qCount++
      st.phiSum += phi
      st.phiSq += phi * phi
    }
    acc += q * x // GMAC：Σ q·x（硬體：依 q 選 +x 或 −x 再累加）
  }
  return acc / cfg.N // block 平均 G_k（average mode）
}
// #endregion

function chainConfig(p: { model: ErrorModel; algorithm: BiasAlgorithm; dcMode: DcNullMode; N: number; servoGain?: number }): ChainCfg {
  const m = p.model
  return {
    a: m.a,
    b: m.b,
    c2: m.c2,
    c3: m.c3,
    kappa: m.kappa,
    sign: p.algorithm === 'sign',
    dc: p.dcMode,
    kPhi: p.servoGain ?? 0.01,
    N: p.N,
    sigmaAt: (x: number) => sigmaAt(x, m),
  }
}

/** MC 的總 sample 數上限（chains × blocks × N） */
export const MAX_MC_SAMPLES = 6e7

/**
 * Block Sign-/MSE-LMS 的 Monte Carlo（多條 seeded chains；worker 可呼叫）。
 * 回傳時間平均 w̄ 的 95% CI、凍結 w 的平均 GMAC，以及要對照的解析參考值（reference）。
 */
export function simulateBiasLms(p: BiasMcParams): BiasMcResult {
  let cur = p
  let res = simulateOnce(cur)
  if (p.untilSettled) {
    const g = p.loopGain ?? Number.NaN
    const converged = (r: BiasMcResult, blocks: number) => {
      const burn = blocks - Math.round(blocks * (1 - (p.burnInFraction ?? 0.5)))
      const longEnough = !(g > 0 && g < 2) || g * burn >= 7 // e^{−7} ≈ 0.1%：初始誤差的殘餘可忽略
      const noDrift = r.driftCheck.settled && !(Math.abs(r.driftCheck.mean) > r.driftCheck.halfWidth)
      return longEnough && noDrift
    }
    for (let round = 0; round < 6; round++) {
      if (res.diverged || converged(res, cur.blocks)) break
      if (cur.chains * cur.blocks * 2 * cur.N > MAX_MC_SAMPLES) {
        res.warnings.push(`Run-to-Convergence：blocks 再加倍會超過 ${MAX_MC_SAMPLES.toExponential(0)} samples 的上限，停在 ${cur.blocks} blocks（可能仍未收斂）。`)
        break
      }
      cur = { ...cur, blocks: cur.blocks * 2 }
      res = simulateOnce(cur)
    }
  }
  return res
}

export interface McAgreement {
  /** 'point'：唯一固定點；'dead-zone'：無雜訊時 G(w) = 0 的整段區間 */
  kind: 'point' | 'dead-zone'
  /** 參考值（point：servo-aware 固定點；dead-zone：區間中點） */
  reference: number
  /** 容許量 = 4·SE + 有限步長容許量 + servo 修正量的 25% */
  tolerance: number
  /** 容許量的三個組成 */
  parts: { stat: number; step: number; servo: number }
  /** MC − 參考值（dead-zone：落在區間內為 0，否則為到最近端點的距離） */
  delta: number
  pass: boolean
}

/** servo-aware 修正量中當作「形狀誤差」容許的比例（φ 的抖動不是 Gaussian；MC 實測殘差 ≲ 修正量的 15%） */
export const SERVO_SHAPE_FRACTION = 0.25

// #region core:mcAgreement
/**
 * Monte Carlo 與解析值是否一致（Lab 的 Analytic ↔ Monte Carlo 交叉比對）。
 * 參考值用 servo-aware 固定點（DC null 模式下 φ 的抖動是額外的 dither）。容許量有三項：
 *   stat ：4 × 標準誤（chains 之間的 t 區間；全站 MC 驗收慣例 ±4 SE）
 *   step ：有限步長的偏移（finiteStepBias；MSE 為 0）
 *   servo：servo-aware 修正量 |w*(σ_eff) − w*(σ_v)| 的 25%（把非 Gaussian 的 φ 抖動當成 Gaussian 的誤差）
 * 無雜訊 dead zone 時解是一整段區間，MC 只要落在區間內（±容許量）就算一致。
 */
export function mcAgreement(mc: Pick<BiasMcResult, 'mean' | 'se' | 'reference'>, zeroSet?: { lo: number; hi: number } | null): McAgreement {
  const ref = mc.reference
  const parts = {
    stat: 4 * mc.se,
    step: ref.step.allowance,
    servo: SERVO_SHAPE_FRACTION * Math.abs(ref.wServoAware - ref.wMeanField),
  }
  const tolerance = parts.stat + parts.step + parts.servo
  if (zeroSet && zeroSet.hi - zeroSet.lo > 1e-9) {
    const delta = mc.mean < zeroSet.lo ? mc.mean - zeroSet.lo : mc.mean > zeroSet.hi ? mc.mean - zeroSet.hi : 0
    return { kind: 'dead-zone', reference: 0.5 * (zeroSet.lo + zeroSet.hi), tolerance, parts, delta, pass: Math.abs(delta) <= tolerance }
  }
  const delta = mc.mean - ref.wServoAware
  return { kind: 'point', reference: ref.wServoAware, tolerance, parts, delta, pass: Math.abs(delta) <= tolerance }
}
// #endregion

/** servo 的 φ 抖動當成額外 dither 後的固定點，以及有限步長估計（MC 的解析參考值）。 */
function mcReference(p: BiasMcParams, dist: CodeDistribution, phiStd: number): BiasMcReference {
  const wMeanField = fixedPoint(p.algorithm, p.model, dist, p.dcMode).w
  const jitter = p.algorithm === 'sign' && p.dcMode !== 'none' && phiStd > 0 && Number.isFinite(phiStd)
  const mEff: ErrorModel = jitter ? { ...p.model, sigmaExtra: Math.hypot(p.model.sigmaExtra ?? 0, phiStd) } : p.model
  const wServoAware = jitter ? fixedPoint('sign', mEff, dist, p.dcMode).w : wMeanField
  const step = finiteStepBias({ model: mEff, code: p.code, algorithm: p.algorithm, dcMode: p.dcMode, mu: p.mu, N: p.N, wStar: wServoAware, servoGain: p.servoGain })
  return { wMeanField, wServoAware, step }
}

function simulateOnce(p: BiasMcParams): BiasMcResult {
  validateModel(p.model)
  if (!(p.mu > 0) || !Number.isFinite(p.mu)) throw new Error(`μ 必須為正有限數，收到 ${p.mu}`)
  if (!Number.isInteger(p.N) || p.N < 1) throw new Error(`N 必須為正整數，收到 ${p.N}`)
  if (!Number.isInteger(p.blocks) || p.blocks < 20) throw new Error(`blocks 必須為 ≥ 20 的整數，收到 ${p.blocks}`)
  if (!Number.isInteger(p.chains) || p.chains < 2) throw new Error(`chains 必須為 ≥ 2 的整數（才能估計信賴區間），收到 ${p.chains}`)
  const total = p.chains * p.blocks * p.N
  if (total > MAX_MC_SAMPLES) throw new Error(`總 sample 數 ${total.toExponential(2)} 超過 ${MAX_MC_SAMPLES.toExponential(0)} 上限，請減少 chains／blocks／N`)
  const dist = buildCodeDistribution(p.code)
  const cfg = chainConfig(p)
  const root = createRng(p.seed)
  const burn = Math.min(p.blocks - 10, Math.max(1, Math.floor(p.blocks * (p.burnInFraction ?? 0.5))))
  const nTrace = Math.min(p.traceChains ?? 3, p.chains)
  const maxPts = p.traceMaxPoints ?? 1500
  const stride = Math.max(1, Math.ceil((p.blocks + 1) / maxPts))
  const traceK: number[] = []
  for (let k = 0; k <= p.blocks; k += stride) traceK.push(k)
  const traces: number[][] = []
  const chainMeans: number[] = []
  const drift: number[] = []
  const warnings: string[] = []
  let phiMean = 0
  let phiStd = 0
  let qMean = 0
  let diverged = false
  for (let c = 0; c < p.chains; c++) {
    const r = root.fork(`chain-${c}`)
    const xr = r.fork('x')
    const vr = r.fork('v')
    const st: ChainState = { w: p.w0, phi: 0, nextX: makeXSource(dist, xr), noise: () => vr.normal(), qSum: 0, qCount: 0, phiSum: 0, phiSq: 0 }
    const tr: number[] = []
    let sum = 0
    let sum1 = 0
    const half = burn + Math.floor((p.blocks - burn) / 2)
    for (let k = 0; k < p.blocks; k++) {
      if (c < nTrace && k % stride === 0) tr.push(st.w)
      const avg = k >= burn
      if (avg) {
        sum += st.w
        if (k < half) sum1 += st.w
      }
      const G = runBlock(st, cfg, c === 0 && avg)
      st.w += p.mu * G // w_{k+1} = w_k + μ·G_k
      if (!Number.isFinite(st.w) || Math.abs(st.w) > 1e9) {
        diverged = true
        break
      }
    }
    if (c < nTrace) {
      if (p.blocks % stride === 0) tr.push(st.w)
      traces.push(tr)
    }
    const nAvg = p.blocks - burn
    chainMeans.push(sum / nAvg)
    const n1 = half - burn
    drift.push((sum - sum1) / (nAvg - n1) - sum1 / n1)
    if (c === 0) {
      const cnt = st.qCount
      qMean = cnt > 0 ? st.qSum / cnt : Number.NaN
      phiMean = cnt > 0 ? st.phiSum / cnt : Number.NaN
      phiStd = cnt > 0 ? Math.sqrt(Math.max(0, st.phiSq / cnt - phiMean * phiMean)) : Number.NaN
    }
    if (diverged) break
  }
  if (diverged) warnings.push(String.raw`$w$ 發散（$|w|>10^9$ 或非有限）：$\mu$ 太大使平均更新 $g=\mu S\ge2$，或極性錯誤。`)
  const ci = meanCI(chainMeans)
  const dci = meanCI(drift)
  const settled = !(Math.abs(dci.mean) > Math.max(2 * dci.halfWidth, 4 * ci.halfWidth))
  if (!settled)
    warnings.push(
      String.raw`averaging window 前後半平均相差 $${fmtTex(dci.mean)}$（大於信賴區間）：$w$ 可能尚未收斂。增加 blocks、提高 $\mu$，或把 $w_0$ 設得更接近 $w^*$。`,
    )

  // 凍結 w 的平均 GMAC（估計 E[G](w) 曲線上的點）
  const gw = p.gmacPoints ?? []
  const gS = p.gmacSamples ?? 20000
  const nb = 20
  const per = Math.max(1, Math.floor(gS / nb))
  const frozenCost = nb * per + (cfg.dc !== 'none' ? 4000 : 0)
  const one = { ...cfg, N: 1 }
  // #region core:frozenGmac
  /** 凍結 gain（w 不更新），量平均 GMAC 與 batch-means 的 95% CI。 */
  const frozenGmac = (w: number, label: string) => {
    const r = root.fork(label)
    const vr = r.fork('v')
    const st: ChainState = { w, phi: 0, nextX: makeXSource(dist, r.fork('x')), noise: () => vr.normal(), qSum: 0, qCount: 0, phiSum: 0, phiSq: 0 }
    if (cfg.dc !== 'none') for (let n = 0; n < 4000; n++) runBlock(st, one, false) // servo 先收斂（w 凍結）
    // batch means：DSM code 是確定性序列、servo 也有記憶，樣本不是 iid；
    // 把 gS 個 sample 切成 20 批，以批平均的 t 區間估計 95% CI（對相關樣本仍有效）
    const batch: number[] = []
    for (let bIdx = 0; bIdx < nb; bIdx++) {
      let s1 = 0
      for (let n = 0; n < per; n++) s1 += runBlock(st, one, false) // N = 1：每次回傳一個 sample 的 q·x
      batch.push(s1 / per)
    }
    return meanCI(batch)
  }
  // #endregion
  const gmac = { w: [] as number[], mean: [] as number[], halfWidth: [] as number[] }
  for (let i = 0; i < gw.length; i++) {
    const c = frozenGmac(gw[i], `gmac-${i}`)
    gmac.w.push(gw[i])
    gmac.mean.push(c.mean)
    gmac.halfWidth.push(c.halfWidth)
  }
  const reference = mcReference(p, dist, phiStd)

  // 規格 §11.4：Freeze gain → w ± Δ → GMAC 斜率（附標準誤），並與同一個 Δ 的 mean-field 割線斜率比較
  let slopeProbe: SlopeProbeResult | null = null
  if (p.slopeProbe && p.slopeProbe.delta > 0 && Number.isFinite(p.slopeProbe.center)) {
    const { center, delta } = p.slopeProbe
    const lo = frozenGmac(center - delta, 'slope-minus')
    const hi = frozenGmac(center + delta, 'slope-plus')
    const jitter = p.algorithm === 'sign' && p.dcMode !== 'none' && phiStd > 0 && Number.isFinite(phiStd)
    const mEff: ErrorModel = jitter ? { ...p.model, sigmaExtra: Math.hypot(p.model.sigmaExtra ?? 0, phiStd) } : p.model
    slopeProbe = {
      center,
      delta,
      gMinus: lo.mean,
      gPlus: hi.mean,
      slope: (lo.mean - hi.mean) / (2 * delta), // Ŝ = −Ŝ_GMAC
      se: Math.hypot(lo.se, hi.se) / (2 * delta),
      meanFieldSecant: (meanGmac(p.algorithm, center - delta, mEff, dist, p.dcMode) - meanGmac(p.algorithm, center + delta, mEff, dist, p.dcMode)) / (2 * delta),
      meanFieldTangent: gmacSlope(p.algorithm, center, mEff, dist, p.dcMode),
    }
  }

  return {
    chainMeans,
    mean: ci.mean,
    lo: ci.lo,
    hi: ci.hi,
    halfWidth: ci.halfWidth,
    se: ci.se,
    driftCheck: { mean: dci.mean, halfWidth: dci.halfWidth, settled },
    traces: { k: traceK.slice(0, traces[0]?.length ?? 0), w: traces },
    phiMean,
    phiStd,
    qMean,
    gmac,
    totalSamples: total + (gw.length + (slopeProbe ? 2 : 0)) * frozenCost,
    blocksUsed: p.blocks,
    diverged,
    reference,
    slopeProbe,
    warnings,
  }
}

// ───────────────────────── σ_v sweep、DC null 對照（worker） ─────────────────────────

export interface SigmaSweepParams {
  model: ErrorModel
  code: CodeSpec
  dcMode: DcNullMode
  sigmas: number[]
}

export interface SigmaSweepResult {
  sigma: number[]
  /** Sign-LMS mean-field 固定點 */
  wSign: number[]
  /** 二階近似（mode none、σ_v 常數） */
  wSecond: number[]
  /** max|e_det|/σ_v at w* */
  ratio: number[]
  /** MSE-LMS 固定點（與 σ_v 無關） */
  wMse: number
  /** σ_v = 0 的 Sign 固定點（mean-field 根；dead zone 時為區間中某點） */
  wNoiseFree: number
}

/** w*(σ_v)：Sign-LMS 固定點隨雜訊的變化（worker 可呼叫）。 */
export function biasSigmaSweep(p: SigmaSweepParams): SigmaSweepResult {
  validateModel(p.model)
  const dist = buildCodeDistribution(p.code)
  const constSigma = (p.model.jitterSlope ?? 0) === 0
  const out: SigmaSweepResult = { sigma: [], wSign: [], wSecond: [], ratio: [], wMse: mseFixedPoint(p.model, dist, p.dcMode), wNoiseFree: Number.NaN }
  out.wNoiseFree = signFixedPoint({ ...p.model, sigmaV: 0 }, dist, p.dcMode).w
  for (const s of p.sigmas) {
    if (!(s > 0)) continue
    const m = { ...p.model, sigmaV: s }
    const fp = signFixedPoint(m, dist, p.dcMode)
    out.sigma.push(s)
    out.wSign.push(fp.w)
    out.wSecond.push(constSigma && p.dcMode === 'none' ? signSecondOrder(m, dist) : Number.NaN)
    let mx = 0
    if (Number.isFinite(fp.w)) {
      const r = residualArg(fp.w, m, dist, p.dcMode, 'sign')
      const xs = dist.continuous ? gridOver(dist, 201, true) : dist.values
      for (const x of xs) mx = Math.max(mx, Math.abs(r.f(x)) / sigmaAt(x, m))
    }
    out.ratio.push(Number.isFinite(fp.w) ? mx : Number.NaN)
  }
  return out
}

export interface DcNullComparisonParams {
  model: ErrorModel
  code: CodeSpec
  algorithm: BiasAlgorithm
  N: number
  blocks: number
  chains: number
  w0: number
  seed: number
  servoGain?: number
  /** 自動 μ 的 g = μS（預設 0.02） */
  gTarget?: number
}

export interface DcNullComparisonRow {
  mode: DcNullMode
  /** 一階（線性化）公式 */
  linear: number
  /** mean-field（MSE 時與 linear 相同，皆精確） */
  meanField: number
  mu: number
  mc: { mean: number; lo: number; hi: number; halfWidth: number; se: number }
  settled: boolean
  /** MC 量到的 servo φ 抖動 std（mode none 為 0） */
  phiStd: number
  /** servo-aware 固定點：σ_eff² = σ_v² + Var(φ) 的 mean-field 根（MC 應與它一致） */
  servoAware: number
  /** MC 與 servo-aware 固定點的比對（mcAgreement；無法執行 MC 時 null） */
  agreement: McAgreement | null
}

/** 三種主迴路 DC null 模式的公式 vs Monte Carlo（勘誤 E03；worker 可呼叫）。 */
export function runDcNullComparison(p: DcNullComparisonParams): { rows: DcNullComparisonRow[]; warnings: string[] } {
  const dist = buildCodeDistribution(p.code)
  const rows: DcNullComparisonRow[] = []
  const warnings: string[] = []
  const constSigma = (p.model.jitterSlope ?? 0) === 0
  for (const mode of ['none', 'shared_bbpd', 'linear_pd'] as const) {
    const linear =
      p.algorithm === 'sign' && sigmaAt(0, p.model) > 0 ? linearizedFixedPoint(p.model, dist, mode, !constSigma).w : mseFixedPoint(p.model, dist, mode)
    const fp = fixedPoint(p.algorithm, p.model, dist, mode)
    const slope = gmacSlope(p.algorithm, fp.w, p.model, dist, mode)
    const mu = autoMu(slope, p.gTarget ?? 0.02)
    if (!Number.isFinite(mu)) {
      warnings.push(String.raw`${DC_MODE_LABEL[mode]}：GMAC 斜率 $S\le0$ 或不可辨識（例如 $\operatorname{Var}(x)=0$），無法設定 $\mu$，略過 Monte Carlo。`)
      rows.push({ mode, linear, meanField: fp.w, mu, mc: { mean: NaN, lo: NaN, hi: NaN, halfWidth: NaN, se: NaN }, settled: false, phiStd: NaN, servoAware: NaN, agreement: null })
      continue
    }
    const mc = simulateBiasLms({
      model: p.model,
      code: p.code,
      algorithm: p.algorithm,
      dcMode: mode,
      mu,
      N: p.N,
      blocks: p.blocks,
      chains: p.chains,
      w0: p.w0,
      seed: p.seed,
      servoGain: p.servoGain,
      traceChains: 0,
    })
    warnings.push(...mc.warnings.map((w) => `${mode}：${w}`))
    rows.push({
      mode,
      linear,
      meanField: fp.w,
      mu,
      mc: { mean: mc.mean, lo: mc.lo, hi: mc.hi, halfWidth: mc.halfWidth, se: mc.se },
      settled: mc.driftCheck.settled,
      phiStd: mode === 'none' ? 0 : mc.phiStd,
      servoAware: mc.reference.wServoAware,
      agreement: mcAgreement(mc),
    })
  }
  return { rows, warnings }
}

// ───────────────────────── 勘誤 E01 參考表（cubic INL） ─────────────────────────

export interface CubicReferenceRow {
  sigma: number
  /** mean-field 精確根 */
  exact: number
  /** 二階近似 1.34 + 3.456e−4/σ_v² */
  secondOrder: number
  /** max|e_det(w*)|/σ_v */
  ratio: number
}

/** §11.2 例：x ∈ {−2..2}、a = 1、c_3 = 0.1 的 Sign-LMS 固定點隨 σ_v 的變化（勘誤 E01 表）。 */
export function cubicReferenceTable(p: { sigmas: number[]; a?: number; c3?: number }): CubicReferenceRow[] {
  const dist = buildCodeDistribution({ kind: 'five_level' })
  return p.sigmas.map((s) => {
    const m: ErrorModel = { a: p.a ?? 1, b: 0, c2: 0, c3: p.c3 ?? 0.1, kappa: 0, sigmaV: s }
    const exact = signFixedPoint(m, dist).w
    let mx = 0
    for (const x of dist.values) mx = Math.max(mx, Math.abs(eDet(x, exact, m)))
    return { sigma: s, exact, secondOrder: s > 0 ? signSecondOrder(m, dist) : Number.NaN, ratio: s > 0 ? mx / s : Infinity }
  })
}

// ───────────────────────── §11.4 Near-integer：C(FCW) → 0 ─────────────────────────

export interface NearIntegerParams {
  /** 要掃描的 FCW 小數部分 */
  fracs: number[]
  /** 主 PLL：ω_nT_s [rad/sample] */
  wnTs: number
  zeta: number
  loopDelay?: number
  /** 直接耦合到 PD 的 code-correlated 干擾係數 κ_d（不經過 H_PD）：B = κ_d·E[x²] */
  kappaDirect: number
  /** comparator 雜訊（給 K_q） */
  sigmaV: number
  /** 時域平均視窗的最小長度（會進位到整數個 residue 週期；預設 16384） */
  length?: number
}

export interface NearIntegerResult {
  frac: number[]
  /** C = E[x·(h_PD * x)]，時域：DSM 序列從靜止狀態通過 H_PD，略過暫態後取「整數個週期」平均（x 標準化：E[x] = 0、E[x²] = 1） */
  C: number[]
  /** 同一個 C 的頻域算法（週期穩態、Parseval）：C = Σ_k |X_k|²·Re H_PD(e^{jΩ_k})，Ω_k = 2πk/P —— 獨立交叉比對 */
  Cfreq: number[]
  /** C 中來自 |Ω_k| < ω_nT_s（迴路頻寬內）諧波的部分：Re H_PD < 0，貢獻為負 */
  CinBand: number[]
  /** residue 的週期 P（samples） */
  period: number[]
  /** w* − a = B/C */
  bias: number[]
  /** GMAC 斜率 S = K_q·C（越小收斂越慢） */
  slope: number[]
  B: number
  Kq: number
  /** 時域 vs 頻域的最大相對差 max|C − Cfreq|/max(|Cfreq|, 1e-9) */
  maxRelDiff: number
  /** 最小 6 個 frac 的 log C – log frac 最小平方斜率（near-integer 的冪次；C ≤ 0 時 NaN） */
  lowFracExponent: number
  /** 時域略過的暫態 sample 數 */
  skip: number
  hpdDescription: string
  warnings: string[]
}

/** 最小平方直線斜率（log–log 冪次擬合用） */
function lsSlope(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 2) return Number.NaN
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
  }
  return sxx > 0 ? sxy / sxx : Number.NaN
}

function gcd(a: number, b: number): number {
  let p = Math.abs(a)
  let q = Math.abs(b)
  while (q) [p, q] = [q, p % q]
  return p
}

/** Re H(e^{jΩ})，H = B(z⁻¹)/A(z⁻¹)（z⁻¹ 升冪）；不配置物件的 freqz 實部（sweep 內每個 FCW 要算上萬個頻點）。 */
function reH(b: ArrayLike<number>, a: ArrayLike<number>, omega: number): number {
  const c1 = Math.cos(omega)
  const s1 = -Math.sin(omega) // e^{−jΩ}
  let zr = 1
  let zi = 0 // e^{−jnΩ}
  let br = 0
  let bi = 0
  let ar = 0
  let ai = 0
  const n = Math.max(b.length, a.length)
  for (let i = 0; i < n; i++) {
    if (i < b.length) {
      br += b[i] * zr
      bi += b[i] * zi
    }
    if (i < a.length) {
      ar += a[i] * zr
      ai += a[i] * zi
    }
    const t = zr * c1 - zi * s1
    zi = zr * s1 + zi * c1
    zr = t
  }
  return (br * ar + bi * ai) / (ar * ar + ai * ai) // Re(B·conj(A))/|A|²
}

// #region core:nearIntegerC
/**
 * 一個 FCW 的有效相關 C = E[x·(h_PD * x)]，兩條獨立路徑：
 *   (1) 時域：x 從靜止狀態通過 H_PD(z)，略過 skip 個暫態 sample 後，取整數個週期 P 平均
 *   (2) 頻域：一個週期的 DFT X_k，C = Σ_k |X_k|²·Re H_PD(e^{j2πk/P})（Parseval，週期穩態）
 * x 為 first-order DSM residue，先標準化為 E[x] = 0、E[x²] = 1。
 */
function nearIntegerC(residue: Float64Array, P: number, skip: number, hpd: { b: number[]; a: number[] }, wnTs: number) {
  const L = residue.length
  const base = L - P // 最後一個完整週期的起點（L = skip + m·P）
  let mean = 0
  for (let i = base; i < L; i++) mean += residue[i]
  mean /= P
  let v2 = 0
  for (let i = base; i < L; i++) v2 += (residue[i] - mean) ** 2
  const sd = Math.sqrt(v2 / P)
  if (!(sd > 0)) return null // residue 恆為常數（整數 FCW）：沒有激勵
  const x = Float64Array.from(residue, (r) => (r - mean) / sd)
  const cTime = corrFromSequence({ x, h: hpd, skip }) // (1) 時域：skip 之後剛好 m 個整週期

  const re = x.slice(base, L) // (2) 頻域：一個整週期
  const im = new Float64Array(P)
  fft(re, im)
  const half = Math.floor(P / 2)
  let cFreq = 0
  let cIn = 0
  for (let k = 1; k <= half; k++) {
    const omega = (2 * Math.PI * k) / P
    const w = P % 2 === 0 && k === half ? 1 : 2 // 實數序列：±k 兩條譜線（Nyquist 只算一次）
    const pk = (w * (re[k] * re[k] + im[k] * im[k])) / (P * P) // |X_k|²（含共軛那一半）
    const c = pk * reH(hpd.b, hpd.a, omega) // ← 只有 Re H = |H|cosθ 進入 E[x·u]：|θ| < 90° 為正、> 90° 為負
    cFreq += c
    if (omega < wnTs) cIn += c // 迴路頻寬內（Ω < ω_nT_s）：相位接近 180°，Re H_PD < 0，貢獻為負
  }
  return { cTime, cFreq, cIn }
}
// #endregion

// #region core:nearIntegerSensitivity
/**
 * §11.4 的線性化固定點與敏感度（F-11.14 / F-11.15）：平均 GMAC ≈ K_q·((a − w)·C + B) ⇒
 *   w* − a = B/C、∂(w*)/∂C = −B/C²、S = −∂E[G]/∂w = K_q·C。
 * C > 0 才是吸引的固定點；C < 0 時 a + B/C 是 repelling 的點（極性錯誤）；C = 0 不可辨識（回傳 NaN）。
 * 純函式：Ch11 的手算題（HC-11.7）與 §11.4 的敏感度表使用；算式與 nearIntegerSweep 的 bias / slope 相同。
 */
export function nearIntegerSensitivity(B: number, C: number, sigmaV: number): { bias: number; dBiasdC: number; Kq: number; slope: number; attracting: boolean } {
  const Kq = sigmaV > 0 ? KQ_FACTOR / sigmaV : Number.NaN // comparator 小訊號增益 K_q = √(2/π)/σ_v
  const ok = Number.isFinite(C) && C !== 0
  return {
    bias: ok ? B / C : Number.NaN, // w* − a = B/C
    dBiasdC: ok ? -B / (C * C) : Number.NaN, // ∂w*/∂C = −B/C²：C 越小，對 C 的變化越敏感
    Kq,
    slope: Kq * C, // S = K_q·C：越小收斂越慢；S ≤ 0 沒有恢復力
    attracting: C > 0,
  }
}
// #endregion

/**
 * 以真實 DSM residue 經主 PLL 的 H_PD(z) 計算 C(FCW)，示範 near-integer 時 C → 0 使 w* = a + B/C 爆增
 * （規格 §11.4；勘誤 E12：此處 C = E[x(h*x)] 同 §6，B 為干擾 bias 項）。worker 可呼叫。
 * 時域與頻域兩種算法互相交叉比對（maxRelDiff）。
 */
export function nearIntegerSweep(p: NearIntegerParams): NearIntegerResult {
  const design = designDtLoop({ wnTs: p.wnTs, zeta: p.zeta, loopDelay: p.loopDelay ?? 0 })
  const bits = 16
  const M = 2 ** bits
  const minWindow = p.length ?? 16384
  // 暫態：closed-loop pole 半徑 ρ ⇒ 衰減到 1e-12 需要 ln(1e-12)/ln ρ 個 sample
  const settle = design.stable && design.spectralRadius > 0 ? Math.ceil(Math.log(1e-12) / Math.log(design.spectralRadius)) : 0
  const skip = Math.min(1 << 18, Math.max(4096, settle))
  const B = p.kappaDirect
  const Kq = p.sigmaV > 0 ? KQ_FACTOR / p.sigmaV : Number.NaN
  const out: NearIntegerResult = {
    frac: [],
    C: [],
    Cfreq: [],
    CinBand: [],
    period: [],
    bias: [],
    slope: [],
    B,
    Kq,
    maxRelDiff: 0,
    lowFracExponent: Number.NaN,
    skip,
    hpdDescription: '',
    warnings: [...design.warnings],
  }
  out.hpdDescription = `type-II DPLL，ω_nT_s = ${p.wnTs}、ζ = ${p.zeta}、loop delay ${p.loopDelay ?? 0}；${design.stable ? '穩定' : '不穩定！'}`
  if (!design.stable) {
    out.warnings.push(String.raw`主 PLL 不穩定（closed-loop pole 在單位圓外）：$H_\mathrm{PD}$ 沒有穩態，$C$ 無意義，略過計算。`)
    return out
  }
  if (settle > skip) out.warnings.push(`主 PLL 暫態很長（約 ${settle} samples），只略過 ${skip} 個；時域 $C$ 可能殘留暫態，請以頻域值為準。`)
  for (const f of p.fracs) {
    const K = Math.round(f * M)
    if (K <= 0 || K >= M) continue
    const P = M / gcd(K, M) // first-order DSM residue 的週期
    const m = Math.max(1, Math.ceil(minWindow / P))
    const res = runDsm({ kind: 'first_order', frac: f, bits, length: skip + m * P })
    const c = nearIntegerC(res.residue, P, skip, design.Hpd, p.wnTs)
    if (!c) continue
    out.frac.push(res.fracEff)
    out.period.push(P)
    out.C.push(c.cTime)
    out.Cfreq.push(c.cFreq)
    out.CinBand.push(c.cIn)
    out.bias.push(B / c.cFreq)
    out.slope.push(Kq * c.cFreq)
    out.maxRelDiff = Math.max(out.maxRelDiff, Math.abs(c.cTime - c.cFreq) / Math.max(Math.abs(c.cFreq), 1e-9))
  }
  const lowN = Math.min(6, out.frac.length)
  const lx: number[] = []
  const ly: number[] = []
  for (let i = 0; i < lowN; i++) {
    if (!(out.Cfreq[i] > 0)) break
    lx.push(Math.log(out.frac[i]))
    ly.push(Math.log(out.Cfreq[i]))
  }
  out.lowFracExponent = lx.length === lowN ? lsSlope(lx, ly) : Number.NaN
  return out
}
