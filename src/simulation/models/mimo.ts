/**
 * 多參數 Sign-LMS、Jacobian 與 Preconditioner（規格 §10；模型層級 L3）。Ch10 專用；頁面以 `?raw` +
 * `#region core:*` 直接顯示這些程式碼（docs/teaching-style.md §4）。
 *
 * 單位與極性（全站約定 + 勘誤 E05 / E08 / E22 / E37）：
 *   δ = a − w（fs）；regressor u、x 已正規化（無因次）；G = (1/N) Σ q·x（無因次，average 模式）。
 *   K_q = √(2/π)/σ_v（fs⁻¹）。Jacobian J = ∂E[G]/∂w = −K_q·C（fs⁻¹），C = E[x uᵀ]。
 *   正規化 Jacobian J_n = J/K_q = −C（無因次）；正規化更新矩陣 M_n = K_q·M（無因次），實體 M = M_n/K_q（fs）。
 *   ⇒ 迴路矩陣 A_cal = I + M J = I + M_n J_n 與 K_q 無關；但雜訊 Cov(δ) ∝ 1/K_q²（fs²）。
 *   Regularizer 一律寫成 λ_reg（勘誤 E22）；λ_i 只代表 R 的 eigenvalue。
 *
 * 兩種 plant：
 *   'R'（匹配模型）：x = u，u ~ N(0, R) 或 ±1 碼，C = R，J_n = −R。
 *   'J'（一般 Jacobian）：u ~ N(0, I) 或 iid ±1，x = −J_n·u ⇒ C = −J_n（可不對稱、不定號，例如 T18 反例）。
 *
 * 兩種引擎：
 *   'linear'：G_k = K_q C δ_k + η_k，η_k ~ N(0, R_x/N)。規格 §10 的所有封閉式在此模型下精確。
 *   'sample'：逐 sample 的 1-bit comparator：e = uᵀδ + v，q = sign(e)，G = (1/N) Σ q·x（真正的 Sign-LMS）。
 *
 * 所有 worker 函式（runMimoTrajectories / runMimoCovarianceMc / analyzeMimo）只吃一個可 structured clone 的參數物件。
 */

import {
  createRng,
  det,
  eigSym,
  eigvals,
  erf,
  identity,
  inv,
  matAdd,
  matMul,
  matScale,
  matVec,
  meanCI,
  normFro,
  solve,
  spectralRadius,
  svd,
  trace,
  transpose,
  zeros,
  type Complex,
  type Matrix,
  type Rng,
} from '@/simulation/core'
import { createZigguratNormal } from '@/simulation/models/blockLms'

export type Mat = Matrix
export type PlantMode = 'R' | 'J'
export type RegressorDist = 'gaussian' | 'pm1'
export type MimoEngine = 'linear' | 'sample'
export type MimoRule = 'scalar' | 'diagonal' | 'nlms' | 'full' | 'regularized' | 'sequential'
export type RegForm = 'R' | 'J'
export type JhatSource = 'exact' | 'custom' | 'perturbed' | 'finiteDiff'

export const RULES: MimoRule[] = ['scalar', 'diagonal', 'nlms', 'full', 'regularized', 'sequential']

export const RULE_LABEL: Record<MimoRule, string> = {
  scalar: 'Scalar LMS（M = μI）',
  diagonal: 'Diagonal（各 loop 各自 μ_i）',
  nlms: 'Block NLMS（÷ tr R̂_x）',
  full: 'Full Preconditioner（γ(K_qR)⁻¹）',
  regularized: 'Regularized（λ_reg）',
  sequential: 'Sequential（分階段）',
}

export const RULE_SHORT: Record<MimoRule, string> = {
  scalar: 'Scalar',
  diagonal: 'Diagonal',
  nlms: 'NLMS',
  full: 'Full inverse',
  regularized: 'Regularized',
  sequential: 'Sequential',
}

/** 95% 衰減（剩 5%）的門檻 */
export const DECAY_95 = 0.05
/** sample 引擎的運算預算（總 comparator sample 數） */
export const MAX_SAMPLE_BUDGET = 4e7
/** 線性引擎的 block 上限 */
export const MAX_BLOCKS = 50000
/** |δ| 超過此值（fs）視為數值發散並停止 */
export const DIVERGENCE_LIMIT_FS = 1e9
/** sequential 排程總長 P·sweeps·K 的上限（解析在主執行緒逐 block 傳遞共變異，需限制運算量） */
export const MAX_SEQ_SCHEDULE = 100000

// ───────────────────────────── 小工具 ─────────────────────────────

// 警告／錯誤／說明字串會經 mathText 顯示在 Lab 的警告區、表格與 Gallery：數學一律寫成 `$...$`（docs/teaching-style.md §3），
// 數字用下面幾個函式轉成 TeX（1.2e-5 ⇒ 1.2\times10^{-5}、200000 ⇒ 200{,}000）。

/** 科學記號字串 1.2e-5 → 1.2\times10^{-5}；其餘原樣 */
function sciTex(text: string): string {
  const m = /^(-?[\d.]+)e([+-]?\d+)$/.exec(text)
  return m ? `${m[1]}\\times10^{${Number(m[2])}}` : text
}

/** 訊息用：有效位數（toPrecision）的數字 → TeX */
function texNum(x: number, sig = 4): string {
  if (typeof x !== 'number' || Number.isNaN(x)) return '\\text{NaN}'
  if (!Number.isFinite(x)) return x > 0 ? '\\infty' : '-\\infty'
  return sciTex(x.toPrecision(sig))
}

/** 訊息用：使用者輸入的原值（不改位數）→ TeX */
function texRaw(x: number): string {
  if (typeof x !== 'number' || Number.isNaN(x)) return '\\text{NaN}'
  if (!Number.isFinite(x)) return x > 0 ? '\\infty' : '-\\infty'
  return sciTex(String(x))
}

/** 訊息用：整數加千分位（TeX 的 {,}） */
function texInt(x: number): string {
  return Math.round(x)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '{,}')
}

/** 1-bit comparator 的小訊號增益 K_q = √(2/π)/σ_v（fs⁻¹；規格 §5.1） */
export function kqFromSigma(sigmaV: number): number {
  return Math.sqrt(2 / Math.PI) / sigmaV
}

/** R = [[1, ρ], [ρ, 1]]（P = 2）或所有非對角都是 ρ 的 P×P 相關矩陣 */
export function corrMatrix(P: number, rho: number): Mat {
  return Array.from({ length: P }, (_, i) => Array.from({ length: P }, (_, j) => (i === j ? 1 : rho)))
}

/** |p|^k ≤ frac 的最小整數 k = ⌈ln(frac)/ln|p|⌉；|p| ≥ 1 回傳 Infinity，p = 0 回傳 1。 */
export function stepsToDecay(p: number, frac = DECAY_95): number {
  const a = Math.abs(p)
  if (!(a < 1)) return Infinity
  if (a === 0) return 1
  return Math.max(1, Math.ceil(Math.log(frac) / Math.log(a)))
}

/** 未取整的 ln(frac)/ln|p| */
export function stepsToDecayReal(p: number, frac = DECAY_95): number {
  const a = Math.abs(p)
  if (!(a < 1)) return Infinity
  return Math.log(frac) / Math.log(a)
}

function symmetricPart(A: Mat): Mat {
  return A.map((row, i) => row.map((v, j) => 0.5 * (v + A[j][i])))
}

function isFiniteMatrix(A: Mat): boolean {
  return A.every((row) => row.every((v) => Number.isFinite(v)))
}

function isSquare(A: unknown, P?: number): A is Mat {
  if (!Array.isArray(A) || A.length === 0) return false
  const n = P ?? A.length
  return A.length === n && A.every((r) => Array.isArray(r) && r.length === n && r.every((v) => typeof v === 'number'))
}

/** 對稱半正定矩陣的平方根 S（S Sᵀ = A），以 eigen 分解計算；負 eigenvalue 截為 0。 */
export function psdSqrt(A: Mat): { S: Mat; minEig: number } {
  const { values, vectors } = eigSym(symmetricPart(A))
  const P = A.length
  const S = zeros(P)
  for (let i = 0; i < P; i++) {
    for (let k = 0; k < P; k++) S[i][k] = vectors[i][k] * Math.sqrt(Math.max(values[k], 0))
  }
  return { S, minEig: values[P - 1] }
}

/** 由一般實矩陣的 eigenvalues（複數）取 |·| 最大者 */
function sortedPoles(A: Mat): Complex[] {
  return eigvals(A)
}

/** 2-norm（最大 singular value） */
function norm2Mat(A: Mat): number {
  return svd(A).S[0] ?? 0
}

/**
 * ‖X‖₂ > t 嗎？不算 SVD：‖X‖₂ < t ⇔ t²I − XᵀX 正定 ⇔ Cholesky 的每個 pivot 都 > 0（P ≤ 4，約 P³ 次乘法）。
 * 恰好相等（pivot = 0，機率為零的邊界）算作「超過」。逐 block 判斷 95% 衰減時每一步都會用到，所以不能每步做一次 SVD。
 */
function norm2Exceeds(X: Mat, t: number): boolean {
  const P = X.length
  const t2 = t * t
  // H = t²I − XᵀX（對稱），原地做 Cholesky（只用下三角）
  const H: number[][] = []
  for (let i = 0; i < P; i++) {
    const row = new Array<number>(i + 1)
    for (let j = 0; j <= i; j++) {
      let g = 0
      for (let l = 0; l < P; l++) g += X[l][i] * X[l][j]
      row[j] = (i === j ? t2 : 0) - g
    }
    H.push(row)
  }
  for (let j = 0; j < P; j++) {
    let d = H[j][j]
    for (let l = 0; l < j; l++) d -= H[j][l] * H[j][l]
    if (!(d > 0)) return true
    const s = Math.sqrt(d)
    H[j][j] = s
    for (let i = j + 1; i < P; i++) {
      let v = H[i][j]
      for (let l = 0; l < j; l++) v -= H[i][l] * H[j][l]
      H[i][j] = v / s
    }
  }
  return false
}

// ───────────────────────────── 95% 衰減：整個誤差向量（勘誤審查 R02） ─────────────────────────────

/** 判斷「F-10.5 對整個誤差向量精確」的相對容差：‖A‖₂ − ρ(A) ≤ POLE_EXACT_TOL·(1 − ρ(A)) */
const POLE_EXACT_TOL = 1e-9
/** 捨入誤差下限（相對於 max(1, ‖A‖_F)）：對稱（或正規）的 A 經過反矩陣等運算後，只會差這個量級。isNormalMatrix 與 poleCountIsExact 共用 */
const POLE_EXACT_ROUNDOFF = 1e-13

/**
 * A 是正規矩陣（A Aᵀ = Aᵀ A；對稱矩陣屬之）嗎？
 * 加上 c·I 不會改變 A Aᵀ − Aᵀ A，所以用去掉平均對角的 B = A − (tr A/P)·I 來量：‖B Bᵀ − Bᵀ B‖_F ≤ tol·‖B‖_F²。
 * （不能拿 ‖A‖_F² 當尺度：A = I + μJ、μ 很小時 A ≈ I，任何 J 都會被誤判成正規——
 *   例如 J = [[−1, 0.3], [0, −1]]、μK_q = 10⁻⁴ 的 ‖A Aᵀ − Aᵀ A‖_F 只有 1.3×10⁻⁹，但 ‖A^k‖₂ 在 k₉₅ 附近是 ρ^k 的 1.5 倍。）
 * 捨入誤差：A 的元素經過反矩陣等運算後只準到 δ = POLE_EXACT_ROUNDOFF·max(1, ‖A‖_F)。B = B₀ + E（B₀ 正規、‖E‖_F ≤ δ）時
 * ‖B Bᵀ − Bᵀ B‖_F ≤ 4‖B₀‖_F·δ + 2δ² ≤ 4‖B‖_F·δ + 6δ²，所以容差再加上這一項；‖B‖_F ≤ δ（A 是 I 的倍數，例如完整反矩陣的 A = (1 − γ)·I
 * 加上 10⁻¹⁶ 的捨入殘差）直接視為正規。少了這一項，A = 0.3·I + 捨入殘差 會被判成「非正規」。
 */
export function isNormalMatrix(A: Mat, tol = 1e-9): boolean {
  const P = A.length
  const c = trace(A) / P
  const B = A.map((row, i) => row.map((v, j) => (i === j ? v - c : v)))
  const nB = normFro(B)
  const delta = POLE_EXACT_ROUNDOFF * Math.max(1, normFro(A))
  if (nB <= delta) return true
  const Bt = transpose(B)
  return normFro(matAdd(matMul(B, Bt), matScale(matMul(Bt, B), -1))) <= tol * nB * nB + 4 * nB * delta + 6 * delta * delta
}

/**
 * 「只看最慢 pole」的 ⌈ln 0.05/ln ρ(A)⌉（F-10.5）可以直接當作整個誤差向量的 k₉₅ 嗎？
 * ‖A‖₂ = ρ(A) 時可以：ρ^k ≤ ‖A^k‖₂ ≤ ‖A‖₂^k 永遠成立，兩端相等就得到 ‖A^k‖₂ = ρ(A)^k（對所有 k）。
 * 正規矩陣（對稱屬之）一定滿足 ‖A‖₂ = ρ(A)；2×2 時「‖A‖₂ = ρ(A)」與「正規」等價。
 * 容差要相對於 1 − ρ（不是 ‖A‖）：‖A‖₂ ≤ ρ + t ⇒ ‖A^k‖₂ ≤ ρ^k·e^{kt/ρ}；k ≈ 3/(1 − ρ) 時要 t ≪ 1 − ρ 才看不出差別。
 * t = max(POLE_EXACT_TOL·(1 − ρ), 捨入誤差下限)。
 *  (a) 對稱（到容差內）：S = (A + Aᵀ)/2 對稱、E = (A − Aᵀ)/2 ⇒ ‖A‖₂ ≤ ρ(S) + ‖E‖₂；另一方面 A 一定有一個 eigenvalue 的絕對值
 *      ≥ ρ(S) − (2P − 1)‖E‖₂（Bauer–Fike：A 的 eigenvalue 都落在以 S 的 eigenvalue 為圓心、半徑 ‖E‖₂ 的圓盤聯集裡，而且每個連通分量
 *      裡兩邊的個數相同）⇒ ‖A‖₂ − ρ(A) ≤ 2P‖E‖₂ ≤ P·‖A − Aᵀ‖_F。這一條不需要 SVD，
 *      極慢的對稱迴路（1 − ρ ≈ 10⁻⁸）也不會被 SVD／eig 的浮點誤差誤判。
 *  (b) 其他（不對稱但正規，例如旋轉加縮放）：直接比 ‖A‖₂ 與 ρ(A)。
 * 兩條都不過就逐 block 算（normDecayBlocks）：那個結果不管 A 正規與否都是對的，這裡只是決定能不能省掉連乘、並標示成 F-10.5。
 */
function poleCountIsExact(A: Mat, rho: number): boolean {
  const gap = 1 - rho
  if (!(gap > 0)) return false
  const t = Math.max(POLE_EXACT_TOL * gap, POLE_EXACT_ROUNDOFF * Math.max(1, normFro(A)))
  if (A.length * normFro(matAdd(A, matScale(transpose(A), -1))) <= t) return true
  return norm2Mat(A) - rho <= t
}

/** normDecayBlocks 逐 block 相乘的上限（超過就放棄、回傳 null） */
export const MAX_NORM_DECAY_ITER = 200000

/**
 * 最小的 k，使所有 j ≥ k 都有 ‖A^j‖₂ ≤ frac（0 < frac < 1）：最壞初始方向的誤差長度降到 frac 以下、且之後不再超過。
 * maxIter 內無法確定（不穩定，或非正規又衰減極慢）回傳 null。
 *
 * 做法：逐 block 算 A^k，記下最後一次 ‖A^k‖₂ > frac 的 k（lastAbove）。
 * 何時可以停：令 c = max_{0≤m≤k} ‖A^m‖_F（c ≥ ‖I‖_F = √P ≥ 1）。若 ‖A^k‖_F·c ≤ frac，則對 j ∈ [k, 2k]：
 *   ‖A^j‖₂ ≤ ‖A^j‖_F ≤ ‖A^k‖_F·‖A^{j−k}‖_F ≤ ‖A^k‖_F·c ≤ frac（次可乘性，0 ≤ j − k ≤ k）；
 * 再往後每 k 個 block 用歸納法：‖A^{j−k}‖_F ≤ frac ≤ c ⇒ ‖A^j‖_F ≤ ‖A^k‖_F·c ≤ frac。所以 k 之後不會再超過，答案就是 lastAbove + 1。
 * ‖A^k‖₂ > frac 的判斷：‖·‖_F/√P ≤ ‖·‖₂ ≤ ‖·‖_F，只有落在兩界之間才用 norm2Exceeds（Cholesky）。
 */
export function normDecayBlocks(A: Mat, frac = DECAY_95, maxIter = MAX_NORM_DECAY_ITER): number | null {
  const P = A.length
  if (!(frac > 0 && frac < 1) || !isFiniteMatrix(A)) return null
  const rootP = Math.sqrt(P)
  let Pk = identity(P)
  let tmp = zeros(P)
  let peakF = rootP
  let lastAbove = 0
  for (let k = 1; k <= maxIter; k++) {
    let ss = 0
    for (let i = 0; i < P; i++) {
      for (let j = 0; j < P; j++) {
        let s = 0
        for (let l = 0; l < P; l++) s += A[i][l] * Pk[l][j]
        tmp[i][j] = s
        ss += s * s
      }
    }
    ;[Pk, tmp] = [tmp, Pk]
    const fro = Math.sqrt(ss)
    if (!Number.isFinite(fro)) return null
    if (fro > peakF) peakF = fro
    const above = fro > frac * rootP ? true : fro <= frac ? false : norm2Exceeds(Pk, frac)
    if (above) lastAbove = k
    if (fro * peakF <= frac) return lastAbove + 1
  }
  return null
}

// ───────────────────────────── 矩陣檢視（Matrix Inspector） ─────────────────────────────

export interface MatrixInspection {
  P: number
  symmetric: boolean
  /** 一般 eigenvalues（|·| 由大到小） */
  eig: Complex[]
  /** 對稱時的實 eigenvalues（由大到小）與 eigenvectors（欄） */
  eigSym: { values: number[]; vectors: Mat } | null
  singular: number[]
  cond: number
  det: number
  trace: number
  /** 對稱且所有 eigenvalue > 0 */
  positiveDefinite: boolean
  /** 反矩陣（奇異或 cond > 1e14 時為 null） */
  inverse: Mat | null
}

/** Matrix Inspector：eigen / singular values / condition number / 反矩陣（規格 §10.3 互動、T10）。 */
export function inspectMatrix(A: Mat): MatrixInspection {
  const P = A.length
  let symmetric = true
  for (let i = 0; i < P; i++) for (let j = 0; j < i; j++) if (Math.abs(A[i][j] - A[j][i]) > 1e-12 * (1 + Math.abs(A[i][j]))) symmetric = false
  const es = symmetric ? eigSym(A) : null
  const S = svd(A).S
  const cnd = S[S.length - 1] > 0 ? S[0] / S[S.length - 1] : Infinity
  let inverse: Mat | null = null
  if (Number.isFinite(cnd) && cnd < 1e14) {
    try {
      inverse = inv(A)
    } catch {
      inverse = null
    }
  }
  const ev = eigvals(A)
  return {
    P,
    symmetric,
    eig: ev,
    eigSym: es,
    singular: S,
    cond: cnd,
    det: det(A),
    trace: trace(A),
    positiveDefinite: !!es && es.values[P - 1] > 0,
    inverse,
  }
}

// ───────────────────────────── Plant ─────────────────────────────

export interface PlantSpec {
  mode: PlantMode
  /** mode 'R'：regressor 自相關 R = E[uuᵀ]（P×P，對稱半正定，無因次） */
  R?: Mat
  /** mode 'J'：正規化 Jacobian J_n = J/K_q（P×P，無因次） */
  Jn?: Mat
  /** comparator 前雜訊 RMS σ_v（fs） */
  sigmaV: number
  /** GMAC block 長度 N（每次更新前累加的 sample 數） */
  N: number
  dist?: RegressorDist
}

export interface PlantModel {
  P: number
  mode: PlantMode
  dist: RegressorDist
  sigmaV: number
  N: number
  /** fs⁻¹ */
  Kq: number
  /** 正規化 Jacobian（= −C） */
  Jn: Mat
  /** C = E[x uᵀ] */
  C: Mat
  /** R_u = E[u uᵀ]（e = uᵀδ + v 中的 regressor） */
  Ru: Mat
  /** x = B·u（GMAC 用的 regressor） */
  B: Mat
  /** R_x = E[x xᵀ]（GMAC 雜訊 Cov(η) ≈ R_x/N） */
  Rx: Mat
  /** Gaussian：u = Su·z */
  Su: Mat
  /** 線性引擎：η = Sx·z/√N */
  Sx: Mat
  /** ±1 碼：2^P 個 pattern 與其累積機率 */
  patterns: number[][]
  patternCdf: number[]
  patternProb: number[]
  /** R-mode：R 的 eigenvalues（由大到小）；J-mode：J_n 的 singular values */
  modeValues: number[]
  /** 對應的模式基底（欄向量）：R-mode = R 的 eigenvectors；J-mode = J_n 的右 singular vectors */
  modeBasis: Mat
  errors: string[]
  warnings: string[]
}

function allSignPatterns(P: number): number[][] {
  const out: number[][] = []
  for (let m = 0; m < 1 << P; m++) out.push(Array.from({ length: P }, (_, i) => ((m >> i) & 1 ? -1 : 1)))
  return out
}

/**
 * 建立 plant（檢查輸入並預先計算平方根、pattern 機率等）。錯誤以中文說明放在 errors（不丟例外，方便 UI 顯示原因）。
 */
export function buildPlant(spec: PlantSpec): PlantModel {
  const errors: string[] = []
  const warnings: string[] = []
  const dist: RegressorDist = spec.dist ?? 'gaussian'
  const src = spec.mode === 'R' ? spec.R : spec.Jn
  const P = Array.isArray(src) ? src.length : 0
  const empty = (): PlantModel => ({
    P,
    mode: spec.mode,
    dist,
    sigmaV: spec.sigmaV,
    N: spec.N,
    Kq: NaN,
    Jn: [],
    C: [],
    Ru: [],
    B: [],
    Rx: [],
    Su: [],
    Sx: [],
    patterns: [],
    patternCdf: [],
    patternProb: [],
    modeValues: [],
    modeBasis: [],
    errors,
    warnings,
  })
  if (!isSquare(src) || P < 1 || P > 4) {
    errors.push(String.raw`矩陣必須是 $1\times1$ 到 $4\times4$ 的方陣（本章實驗用 $2\times2$ 或 $3\times3$）。`)
    return empty()
  }
  if (!isFiniteMatrix(src)) {
    errors.push(String.raw`矩陣含有非有限值（NaN 或 $\infty$）。`)
    return empty()
  }
  if (!(spec.sigmaV > 0)) {
    errors.push(
      String.raw`$\sigma_v=${texRaw(spec.sigmaV)}\ \mathrm{fs}$ 不合法：必須 $>0$（$K_q=\sqrt{2/\pi}/\sigma_v$；$\sigma_v=0$ 時 1-bit comparator 沒有線性小訊號增益）。`,
    )
    return empty()
  }
  if (!(Number.isInteger(spec.N) && spec.N >= 1)) {
    errors.push(String.raw`$N=${texRaw(spec.N)}$ 不合法：GMAC block 長度必須是正整數。`)
    return empty()
  }
  const Kq = kqFromSigma(spec.sigmaV)
  let Ru: Mat
  let B: Mat
  let C: Mat
  let Jn: Mat
  if (spec.mode === 'R') {
    const asym = src.some((row, i) => row.some((v, j) => Math.abs(v - src[j][i]) > 1e-12))
    if (asym) warnings.push(String.raw`$\mathbf R$ 必須對稱（$\mathbf R=E[\mathbf u\mathbf u^T]$）；已改用對稱部分 $(\mathbf R+\mathbf R^T)/2$。`)
    const R = symmetricPart(src)
    const { values } = eigSym(R)
    const lmin = values[P - 1]
    if (lmin < -1e-10 * Math.max(1, Math.abs(values[0]))) {
      errors.push(
        String.raw`$\mathbf R$ 不是半正定：$\lambda_{\min}=${texNum(lmin)}<0$。自相關矩陣 $E[\mathbf u\mathbf u^T]$ 的 eigenvalue 不可能為負（例如 $|\rho|>1$ 或 $3\times3$ 的相關係數互相矛盾），請修正 $\mathbf R$。`,
      )
      return empty()
    }
    Ru = R
    B = identity(P)
    C = R
    Jn = matScale(R, -1)
  } else {
    Jn = src.map((r) => r.slice())
    Ru = identity(P)
    B = matScale(Jn, -1)
    C = matScale(Jn, -1)
  }
  const Rx = matMul(matMul(B, Ru), transpose(B))
  const Su = psdSqrt(Ru).S
  const Sx = psdSqrt(Rx).S

  // ±1 碼：p(s) = (1 + Σ_{i<j} s_i s_j R_ij)/2^P（P ≤ 3 時精確給出 E[uuᵀ] = R、奇數階動差 = 0）
  let patterns: number[][] = []
  let patternProb: number[] = []
  let patternCdf: number[] = []
  if (dist === 'pm1') {
    if (P > 3) errors.push(String.raw`$\pm1$ 碼的 pattern 機率公式只適用 $P\le3$。`)
    const diagOk = Ru.every((row, i) => Math.abs(row[i] - 1) < 1e-9)
    if (!diagOk) errors.push(String.raw`$\pm1$ 碼的每個 regressor 功率恆為 1：$\mathbf R$ 的對角線必須全為 1（相關係數矩陣）；或改用 Gaussian。`)
    patterns = allSignPatterns(P)
    patternProb = patterns.map((s) => {
      let acc = 1
      for (let i = 0; i < P; i++) for (let j = i + 1; j < P; j++) acc += s[i] * s[j] * Ru[i][j]
      return acc / patterns.length
    })
    const neg = patternProb.find((p) => p < -1e-12)
    if (neg !== undefined) {
      errors.push(
        String.raw`這個 $\mathbf R$ 無法用 $\pm1$ 碼實現：某個 pattern 的機率 $=${texNum(neg, 3)}<0$（三個相關係數互相矛盾）。請改用 Gaussian regressor 或調整 $\mathbf R$。`,
      )
    }
    let c = 0
    patternCdf = patternProb.map((p) => (c += Math.max(p, 0)))
    patternCdf = patternCdf.map((v) => v / c)
  }

  // 模式基底：R-mode 用 eigenvectors，J-mode 用右 singular vectors
  let modeValues: number[]
  let modeBasis: Mat
  if (spec.mode === 'R') {
    const e = eigSym(Ru)
    modeValues = e.values
    modeBasis = e.vectors
    const lmax = e.values[0]
    const lmin = e.values[P - 1]
    if (lmax <= 0) {
      errors.push(String.raw`$\mathbf R=\mathbf 0$：沒有任何激勵（no excitation），GMAC 永遠是 0。`)
    } else if (lmin <= 1e-12 * lmax) {
      warnings.push(
        // 判斷條件是 λ_min ≤ 10⁻¹²·λ_max：不印出 λ_min 的數值（那只是 eigen 分解的浮點殘餘，例如 2.2e−16，數學上就是 0）
        String.raw`$\lambda_{\min}(\mathbf R)\approx0$（不到 $\lambda_{\max}$ 的 $10^{-12}$ 倍）：不可辨識（缺乏 persistent excitation）。沿 $\mathbf v_{\min}$ 方向的誤差完全看不到，完整 Preconditioner 無法求逆；只能用 regularized 或固定其中一個參數。`,
      )
    }
  } else {
    const s = svd(Jn)
    modeValues = s.S
    modeBasis = s.V
    if (s.S[0] === 0) errors.push(String.raw`$\mathbf J=\mathbf 0$：GMAC 對任何參數都沒有斜率。`)
    else if (s.S[P - 1] <= 1e-12 * s.S[0]) warnings.push(String.raw`$\sigma_{\min}(\mathbf J)\approx0$：$\mathbf J$ 奇異，有一個方向不可辨識（完整反矩陣不存在）。`)
  }
  return {
    P,
    mode: spec.mode,
    dist,
    sigmaV: spec.sigmaV,
    N: spec.N,
    Kq,
    Jn,
    C,
    Ru,
    B,
    Rx,
    Su,
    Sx,
    patterns,
    patternCdf,
    patternProb,
    modeValues,
    modeBasis,
    errors,
    warnings,
  }
}

// ───────────────────────────── GMAC 模型 ─────────────────────────────

/** 一個可重複使用的 N(0,1) 產生器（Ziggurat；同 seed 可重現） */
export type NormalGen = () => number

function makeNormal(rng: Rng): NormalGen {
  return createZigguratNormal(rng)
}

// #region core:signGmacMean
/**
 * Sign-GMAC 的「精確」平均 E[G] = E[x · sign(uᵀδ + v)]（v ~ N(0, σ_v²)，與 u 獨立）。
 *  - Gaussian u（Bussgang）：E[G] = √(2/π) · C δ / √(σ_v² + δᵀR_uδ)。δ → 0 時 → K_q C δ。
 *  - ±1 碼：E[G] = Σ_s p(s) · B s · erf(sᵀδ / (√2 σ_v))（列舉 2^P 個 pattern）。
 */
export function signGmacMean(plant: PlantModel, delta: number[]): number[] {
  const P = plant.P
  if (plant.dist === 'gaussian') {
    const Rd = matVec(plant.Ru, delta)
    let quad = 0
    for (let i = 0; i < P; i++) quad += delta[i] * Rd[i]
    const gain = Math.sqrt(2 / Math.PI) / Math.sqrt(plant.sigmaV * plant.sigmaV + quad) // 有效增益（大誤差時被壓縮）
    return matVec(plant.C, delta).map((m) => gain * m)
  }
  const out = new Array<number>(P).fill(0)
  plant.patterns.forEach((s, idx) => {
    let sd = 0
    for (let i = 0; i < P; i++) sd += s[i] * delta[i]
    const eq = erf(sd / (Math.SQRT2 * plant.sigmaV)) // E[q | u = s]
    const x = matVec(plant.B, s)
    for (let i = 0; i < P; i++) out[i] += plant.patternProb[idx] * x[i] * eq
  })
  return out
}
// #endregion

// #region core:gmacLinear
/**
 * 線性化 GMAC（block 層級）：G_k = K_q C δ_k + η_k，η_k ~ N(0, R_x/N)。
 * 這就是 §10 推導用的模型；所有封閉式（poles、Var(ξ_i)）在這個模型下精確。
 */
export function gmacLinear(plant: PlantModel, delta: number[], normal: NormalGen): number[] {
  const P = plant.P
  const z = Array.from({ length: P }, () => normal())
  const eta = matVec(plant.Sx, z).map((v) => v / Math.sqrt(plant.N)) // Cov(η) = R_x/N
  const mean = matVec(plant.C, delta) // C δ
  return mean.map((m, i) => plant.Kq * m + eta[i]) // G = K_q C δ + η
}
// #endregion

// #region core:gmacSample
/**
 * 逐 sample 的 1-bit GMAC（真正的 Block Sign-LMS 量測）：
 *   e[n] = uᵀ[n] δ_k + v[n]，q[n] = sign(e[n])，G_k = (1/N) Σ_n q[n] · x[n]。
 * 每個參數一個 GMAC 累加器，全部共用同一個 comparator 輸出 q[n]。
 */
export function gmacSample(plant: PlantModel, delta: number[], normal: NormalGen, uniform: () => number): number[] {
  const { P, N, sigmaV, B } = plant
  const u = new Float64Array(P)
  const z = new Float64Array(P)
  const acc = new Float64Array(P)
  for (let n = 0; n < N; n++) {
    if (plant.dist === 'gaussian') {
      for (let i = 0; i < P; i++) z[i] = normal()
      for (let i = 0; i < P; i++) {
        let s = 0
        for (let k = 0; k < P; k++) s += plant.Su[i][k] * z[k]
        u[i] = s // u ~ N(0, R_u)
      }
    } else {
      const r = uniform()
      let idx = 0
      while (idx < plant.patternCdf.length - 1 && r >= plant.patternCdf[idx]) idx++
      for (let i = 0; i < P; i++) u[i] = plant.patterns[idx][i] // ±1 碼
    }
    let e = sigmaV * normal() // v[n] ~ N(0, σ_v²)
    for (let i = 0; i < P; i++) e += u[i] * delta[i] // e[n] = uᵀδ + v
    const q = e >= 0 ? 1 : -1 // 1-bit comparator（e = 0 的機率為 0）
    for (let i = 0; i < P; i++) {
      let x = 0
      for (let k = 0; k < P; k++) x += B[i][k] * u[k] // x = B u（R-mode 時 x = u）
      acc[i] += q * x // 第 i 個 GMAC：累加 q · x_i
    }
  }
  return Array.from(acc, (a) => a / N) // average 模式：除以 N
}
// #endregion

// ───────────────────────────── 更新矩陣（五＋一種規則） ─────────────────────────────

export interface RuleConfig {
  rule: MimoRule
  /** scalar：正規化步長 μK_q（無因次）；實體 μ = μK_q / K_q（fs） */
  muKq: number
  /** diagonal / nlms / full / regularized / sequential 的目標 loop gain γ（無因次） */
  gamma: number
  /** regularized 的 λ_reg（正規化、無因次；R 形式與 R 同尺度，J 形式與 J_n² 同尺度，勘誤 E22） */
  lambdaReg: number
  regForm: RegForm
  /** sequential：每個參數連續更新的 block 數 */
  seqBlocksPerPhase: number
  /** sequential：輪流次數（1 = 一次性分階段；之後凍結） */
  seqSweeps: number
}

export const DEFAULT_RULE: RuleConfig = {
  rule: 'scalar',
  muKq: 0.5,
  gamma: 0.5,
  lambdaReg: 0.1,
  regForm: 'R',
  seqBlocksPerPhase: 30,
  seqSweeps: 1,
}

// #region core:mScalar
/** 原始 LMS：所有參數共用一個步長。正規化 M_n = K_q·M = μK_q·I。 */
export function mScalar(Jhat: Mat, c: RuleConfig): Mat {
  const P = Jhat.length
  return matScale(identity(P), c.muKq) // ← 差異：M_n = μK_q·I，完全不看 Ĵ
}
// #endregion

// #region core:mDiagonal
/** 各 loop 分別設定 learning rate：只用自己的斜率 Ĵ_ii，讓「單獨一個 loop」的 pole = 1 − γ。 */
export function mDiagonal(Jhat: Mat, c: RuleConfig): Mat {
  const P = Jhat.length
  const M = zeros(P)
  for (let i = 0; i < P; i++) M[i][i] = -c.gamma / Jhat[i][i] // ← 差異：只看對角線 Ĵ_ii，忽略 off-diagonal 耦合
  return M
}
// #endregion

// #region core:mNlms
/** Block NLMS：步長除以 regressor 的平均總能量 tr(R̂_x) = E‖x‖²（仍是純量 × I）。 */
export function mNlms(Jhat: Mat, c: RuleConfig, RxHat: Mat): Mat {
  const P = Jhat.length
  return matScale(identity(P), c.gamma / trace(RxHat)) // ← 差異：÷ E‖x‖²，只正規化總能量、不分方向
}
// #endregion

// #region core:mFull
/** 完整 Preconditioner：M = γ(K_q R̂)⁻¹，正規化後 M_n = −γ Ĵ_n⁻¹。Ĵ = J 時所有 pole = 1 − γ。 */
export function mFull(Jhat: Mat, c: RuleConfig): Mat {
  return matScale(inv(Jhat), -c.gamma) // ← 差異：乘上 Ĵ 的反矩陣，把每個方向的增益拉平
}
// #endregion

// #region core:mRegularized
/** Regularized：R 形式 M_n = γ(R̂ + λ_reg I)⁻¹；J 形式 M_n = −γ(ĴᵀĴ + λ_reg I)⁻¹Ĵᵀ（勘誤 E22：λ_reg ≠ λ_i）。 */
export function mRegularized(Jhat: Mat, c: RuleConfig): Mat {
  const P = Jhat.length
  const reg = matScale(identity(P), c.lambdaReg)
  if (c.regForm === 'R') {
    const Rhat = symmetricPart(matScale(Jhat, -1)) // R̂ = −Ĵ_n（匹配模型 J = −K_q R）
    return matScale(inv(matAdd(Rhat, reg)), c.gamma) // ← 差異：(R̂ + λ_reg I)⁻¹，小 eigenvalue 不再被放大成 1/λ_i
  }
  const Jt = transpose(Jhat)
  return matScale(solve(matAdd(matMul(Jt, Jhat), reg), Jt), -c.gamma) // ← 差異：(ĴᵀĴ + λ_reg I)⁻¹Ĵᵀ（Tikhonov pinv）
}
// #endregion

// #region core:mSequential
/** Sequential calibration：第 k 個 block 只更新一個參數，其餘凍結；跑完 P × sweeps 個階段後全部凍結。 */
export function mSequential(Jhat: Mat, c: RuleConfig, k: number): Mat {
  const P = Jhat.length
  const M = zeros(P)
  const phase = Math.floor(k / c.seqBlocksPerPhase)
  if (phase < P * c.seqSweeps) {
    const i = phase % P
    M[i][i] = -c.gamma / Jhat[i][i] // ← 差異：一次只開一個 loop（其他列全為 0 ⇒ 凍結）
  }
  return M
}
// #endregion

// #region core:blockUpdate
/**
 * 一個 GMAC block 的更新（所有規則共用）：w_{k+1} = w_k + M G_k。
 * 以 δ = a − w 表示：δ_{k+1} = δ_k − M G_k，實體 M = M_n / K_q（fs）。
 */
export function blockUpdate(delta: number[], Mn: Mat, G: number[], Kq: number): number[] {
  const step = matVec(Mn, G) // M_n G（無因次）
  return delta.map((d, i) => d - step[i] / Kq) // δ ← δ − (M_n/K_q) G
}
// #endregion

export interface MatrixBuild {
  /** 時不變規則的 M_n（sequential 為 null，請用 matrixAt） */
  Mn: Mat | null
  error: string | null
  warnings: string[]
}

/** 正規化的 R̂_x（NLMS 用）：R-mode = R̂ = −Ĵ_n 的對稱部分；J-mode = Ĵ_n Ĵ_nᵀ */
export function rxHatFrom(mode: PlantMode, JnHat: Mat): Mat {
  return mode === 'R' ? symmetricPart(matScale(JnHat, -1)) : matMul(JnHat, transpose(JnHat))
}

/** 依規則建立正規化更新矩陣 M_n，並把失敗原因轉成可讀的說明（不丟例外）。 */
export function buildUpdateMatrix(cfg: RuleConfig, JnHat: Mat, mode: PlantMode): MatrixBuild {
  const P = JnHat.length
  const warnings: string[] = []
  const needDiag = cfg.rule === 'diagonal' || cfg.rule === 'sequential'
  if (needDiag) {
    for (let i = 0; i < P; i++) {
      if (!(JnHat[i][i] < 0)) {
        return {
          Mn: null,
          error: String.raw`$(\hat{\mathbf J}_n)_{${i + 1}${i + 1}}=${texNum(JnHat[i][i], 3)}\ge0$：第 ${i + 1} 個 loop 單獨看就是錯誤極性（$C_{${i + 1}${i + 1}}\le0$）或沒有斜率，無法用「讓單一 loop pole $=1-\gamma$」設定 $\mu_{${i + 1}}$。`,
          warnings,
        }
      }
    }
  }
  if (cfg.rule === 'sequential') {
    if (!(Number.isInteger(cfg.seqBlocksPerPhase) && cfg.seqBlocksPerPhase >= 1)) return { Mn: null, error: '每階段 block 數必須是正整數。', warnings }
    if (!(Number.isInteger(cfg.seqSweeps) && cfg.seqSweeps >= 1)) return { Mn: null, error: '輪流次數必須是正整數。', warnings }
    const total = P * cfg.seqSweeps * cfg.seqBlocksPerPhase
    if (total > MAX_SEQ_SCHEDULE) {
      return {
        Mn: null,
        error: String.raw`Sequential 排程總長 $P\times\text{sweeps}\times K=${texInt(total)}$ blocks 超過上限 $${texInt(MAX_SEQ_SCHEDULE)}$：解析需逐 block 傳遞共變異，請減少每階段 blocks 或輪流次數。`,
        warnings,
      }
    }
    return { Mn: null, error: null, warnings }
  }
  try {
    let Mn: Mat
    switch (cfg.rule) {
      case 'scalar':
        Mn = mScalar(JnHat, cfg)
        break
      case 'diagonal':
        Mn = mDiagonal(JnHat, cfg)
        break
      case 'nlms': {
        const Rx = rxHatFrom(mode, JnHat)
        if (!(trace(Rx) > 0)) return { Mn: null, error: String.raw`$\operatorname{tr}(\hat{\mathbf R}_x)\le0$：regressor 沒有能量，NLMS 無法正規化。`, warnings }
        Mn = mNlms(JnHat, cfg, Rx)
        break
      }
      case 'full': {
        const s = svd(JnHat).S
        if (s[P - 1] <= 1e-12 * s[0]) {
          return {
            Mn: null,
            // 判斷條件是 σ_min ≤ 10⁻¹²·σ_max：不印出比值（只是 SVD 的浮點殘餘，數學上就是 0）
            error: String.raw`$\hat{\mathbf J}$ 奇異（$\sigma_{\min}/\sigma_{\max}\le10^{-12}$）：$\lambda_{\min}=0$ ⇒ 該方向不可辨識，完整 Preconditioner $(K_q\mathbf R)^{-1}$ 不存在。Preconditioner 可以加速，但不能製造缺失的資訊；請改用 regularized（$\lambda_{\mathrm{reg}}>0$）。`,
            warnings,
          }
        }
        Mn = mFull(JnHat, cfg)
        if (s[0] / s[P - 1] > 1e3) warnings.push(String.raw`$\hat{\mathbf J}$ 的 condition number $\kappa=${texNum(s[0] / s[P - 1], 3)}$：反矩陣元素很大，GMAC noise 會被大幅放大。`)
        break
      }
      case 'regularized': {
        if (!(cfg.lambdaReg >= 0)) return { Mn: null, error: String.raw`$\lambda_{\mathrm{reg}}$ 必須 $\ge0$。`, warnings }
        if (cfg.regForm === 'R') {
          const Rhat = symmetricPart(matScale(JnHat, -1))
          const asym = JnHat.some((row, i) => row.some((v, j) => Math.abs(v - JnHat[j][i]) > 1e-9 * (1 + Math.abs(v))))
          if (asym) warnings.push(String.raw`R 形式假設 $\hat{\mathbf J}=-K_q\hat{\mathbf R}$ 對稱；$\hat{\mathbf J}$ 不對稱，已取對稱部分。一般（不對稱）$\hat{\mathbf J}$ 請用 J 形式。`)
          const lmin = eigSym(Rhat).values[P - 1]
          if (lmin + cfg.lambdaReg <= 1e-12) {
            // 落在 ±10⁻¹² 內的和是浮點殘餘：顯示成 0，不印 1.1e−16 之類的數字
            const sum = lmin + cfg.lambdaReg
            const sumTex = Math.abs(sum) <= 1e-12 ? '=0' : `=${texNum(sum, 3)}<0`
            return {
              Mn: null,
              error: String.raw`$\hat{\mathbf R}+\lambda_{\mathrm{reg}}\mathbf I$ 不可逆（$\lambda_{\min}(\hat{\mathbf R})+\lambda_{\mathrm{reg}}${sumTex}$）：請增加 $\lambda_{\mathrm{reg}}$，或檢查 $\hat{\mathbf J}$ 的極性（$-\hat{\mathbf J}$ 必須半正定才適用 R 形式）。`,
              warnings,
            }
          }
        } else if (cfg.lambdaReg === 0) {
          const s = svd(JnHat).S
          if (s[P - 1] <= 1e-12 * s[0]) return { Mn: null, error: String.raw`$\lambda_{\mathrm{reg}}=0$ 且 $\hat{\mathbf J}$ 奇異：$(\hat{\mathbf J}^T\hat{\mathbf J})^{-1}$ 不存在。請設定 $\lambda_{\mathrm{reg}}>0$。`, warnings }
        }
        Mn = mRegularized(JnHat, cfg)
        break
      }
      default:
        return { Mn: null, error: `未知的規則 ${String(cfg.rule)}`, warnings }
    }
    if (!isFiniteMatrix(Mn)) return { Mn: null, error: String.raw`更新矩陣含有非有限值（$\hat{\mathbf J}$ 可能奇異）。`, warnings }
    return { Mn, error: null, warnings }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { Mn: null, error: String.raw`無法建立更新矩陣：${msg}（$\lambda_{\min}=0$ ⇒ 不可辨識）`, warnings }
  }
}

/** 第 k 個 block 實際使用的 M_n（sequential 隨 k 變，其餘固定） */
export function matrixAt(cfg: RuleConfig, built: MatrixBuild, JnHat: Mat, k: number): Mat {
  if (cfg.rule === 'sequential') return mSequential(JnHat, cfg, k)
  return built.Mn as Mat
}

// ───────────────────────────── 解析：Lyapunov、poles、閉式 ─────────────────────────────

// #region core:lyapunov
/**
 * 離散 Lyapunov 方程 X = A X Aᵀ + Q 的穩態解（|eig(A)| < 1 時唯一）。
 * 在 δ_{k+1} = A δ_k − M η_k 中取 Q = M Cov(η) Mᵀ，X 就是穩態 Cov(δ)。
 * P ≤ 4，直接解 P² 維線性方程：X_ij − Σ_kl A_ik X_kl A_jl = Q_ij。
 */
export function dlyap(A: Mat, Q: Mat): Mat | null {
  const P = A.length
  if (!(spectralRadius(A) < 1)) return null // 不穩定：沒有穩態共變異
  const n = P * P
  const L = zeros(n)
  const rhs = new Array<number>(n)
  for (let i = 0; i < P; i++) {
    for (let j = 0; j < P; j++) {
      const r = i * P + j
      rhs[r] = Q[i][j]
      for (let k = 0; k < P; k++) for (let l = 0; l < P; l++) L[r][k * P + l] = (r === k * P + l ? 1 : 0) - A[i][k] * A[j][l]
    }
  }
  const x = solve(L, rhs)
  const X = zeros(P)
  for (let i = 0; i < P; i++) for (let j = 0; j < P; j++) X[i][j] = 0.5 * (x[i * P + j] + x[j * P + i])
  return X
}
// #endregion

/** 單一模式的穩態變異（封閉式）：ξ_{k+1} = p ξ_k − (m/K_q) ζ_k，Var(ζ) = λ/N ⇒ Var(ξ) = m²λ/(K_q² N (1 − p²))，p = 1 − mλ。 */
export function modeVarianceClosed(m: number, lambda: number, Kq: number, N: number): number {
  const p = 1 - m * lambda
  if (!(Math.abs(p) < 1)) return Infinity
  return (m * m * lambda) / (Kq * Kq * N * (1 - p * p))
}

/** §10.1 完整 Preconditioning 的模式變異 Var(ξ_i) = γ/(K_q² N λ_i (2 − γ))（勘誤 E37：ξ = Vᵀδ 為 eigen-mode 座標） */
export function preconditionedModeVar(gamma: number, Kq: number, N: number, lambda: number): number {
  return gamma / (Kq * Kq * N * lambda * (2 - gamma))
}

/** 規則在 R 的第 i 個 eigen-mode 上的增益 m_i（M_n v_i = m_i v_i；僅 M 與 R 共用 eigenvectors 時有意義） */
export function ruleModeGain(cfg: RuleConfig, lambda: number, trRx: number): number | null {
  switch (cfg.rule) {
    case 'scalar':
      return cfg.muKq
    case 'nlms':
      return cfg.gamma / trRx
    case 'full':
      return lambda > 0 ? cfg.gamma / lambda : null
    case 'regularized':
      return cfg.regForm === 'R' ? cfg.gamma / (lambda + cfg.lambdaReg) : (cfg.gamma * lambda) / (lambda * lambda + cfg.lambdaReg)
    default:
      return null
  }
}

export interface RuleAnalysis {
  rule: MimoRule
  ok: boolean
  error: string | null
  warnings: string[]
  /** 時不變規則的 M_n（無因次）；sequential 為 null */
  Mn: Mat | null
  /** 實體 M = M_n/K_q（fs） */
  Mphys: Mat | null
  /** A = I + M_n J_n（真實 plant；sequential 為一個 sweep 的轉移矩陣） */
  A: Mat | null
  poles: Complex[]
  /** ρ(A)；sequential 為每 block 等效 ρ(Φ_sweep)^{1/(P·K)} */
  spectralRadius: number
  stable: boolean
  /**
   * 95% 衰減所需 block 數：最小的 k，使所有 j ≥ k 都有 ‖A^j‖₂ ≤ 0.05（最壞初始方向的誤差長度降到 5% 以下、且之後不再超過）。
   * A 正規（對稱屬之）時等於 ⌈ln 0.05/ln ρ(A)⌉（F-10.5）；非正規時 F-10.5 只是下界。sequential 用 ‖Φ_j‖₂；達不到為 null。
   */
  blocks95: number | null
  /**
   * blocks95 的來源：
   *  'pole' = ‖A‖₂ = ρ(A)（A 正規時一定成立），F-10.5 精確；
   *  'norm' = 逐 block 計算範數（非正規的 A，或 sequential）；
   *  'lower-bound' = A 非正規、但 MAX_NORM_DECAY_ITER 個 block 內沒算完，只列 F-10.5 的下界；
   *  null = 沒有值。
   */
  blocks95Basis: 'pole' | 'norm' | 'lower-bound' | null
  /** 只看 ρ(A) 的 ⌈ln 0.05/ln ρ(A)⌉（穩定的時不變規則；sequential、不穩定、分析失敗為 null） */
  blocks95Asymptotic: number | null
  /** 穩態 Cov(δ)（fs²；sequential 為排程結束、凍結後的 Cov） */
  cov: Mat | null
  covKind: 'stationary' | 'final' | null
  /** 模式座標 ξ = Vᵀδ 的變異（fs²） */
  modeVar: number[] | null
  perParamVar: number[] | null
  totalVar: number | null
  /** 線性化有效性指標 E[δᵀR_uδ]/σ_v²（需 ≪ 1） */
  validityIndex: number | null
  /** 封閉式 poles（Ĵ = J 時；依規則） */
  closedPoles: number[] | null
  /** 封閉式模式變異（R-mode、Ĵ = J、M 與 R 共用 eigenvectors 時） */
  closedModeVar: number[] | null
}

function failAnalysis(rule: MimoRule, error: string, warnings: string[] = []): RuleAnalysis {
  return {
    rule,
    ok: false,
    error,
    warnings,
    Mn: null,
    Mphys: null,
    A: null,
    poles: [],
    spectralRadius: NaN,
    stable: false,
    blocks95: null,
    blocks95Basis: null,
    blocks95Asymptotic: null,
    cov: null,
    covKind: null,
    modeVar: null,
    perParamVar: null,
    totalVar: null,
    validityIndex: null,
    closedPoles: null,
    closedModeVar: null,
  }
}

function diagOf(A: Mat): number[] {
  return A.map((row, i) => row[i])
}

function modeDiag(V: Mat, X: Mat): number[] {
  const P = V.length
  const out: number[] = []
  for (let m = 0; m < P; m++) {
    let s = 0
    for (let i = 0; i < P; i++) for (let j = 0; j < P; j++) s += V[i][m] * X[i][j] * V[j][m]
    out.push(s)
  }
  return out
}

/** δ 的線性模型一步：δ_{k+1} = A δ_k − M η_k；回傳 (A, Q = M Σ_η Mᵀ)（實體單位） */
function stepMatrices(plant: PlantModel, Mn: Mat): { A: Mat; Q: Mat } {
  const A = matAdd(identity(plant.P), matMul(Mn, plant.Jn))
  const Mphys = matScale(Mn, 1 / plant.Kq)
  const Q = matScale(matMul(matMul(Mphys, plant.Rx), transpose(Mphys)), 1 / plant.N)
  return { A, Q }
}

/** |pole| 與 1 的差距小於此值視為「臨界」（pole 落在單位圓上） */
export const MARGINAL_TOL = 1e-9

/**
 * ρ(I + MJ) ≥ 1 時，依「最外面那個 pole 落在哪裡」解釋原因（規格 §19：無解或失穩要說明原因，不可只寫發散）：
 *  - pole ≈ +1（臨界）：該模式的 loop gain 為 0 ⇒ 誤差凍結、不收斂也不放大（不可辨識方向 λ_min = 0，或該方向的增益為 0）。
 *  - pole > +1：該模式的更新方向相反（−J 在該方向不是正定，或 Ĵ 的符號與 J 不符）；縮小步長無效。
 *  - pole ≤ −1：該模式的 loop gain 1 − p ≥ 2，過度修正（μ / γ 太大，或 Ĵ 低估了該方向的斜率）。
 *  - 複數 pole：J（或 M·J）不對稱造成旋轉，模長 ≥ 1。
 * 「每個 loop 單獨穩定不代表 MIMO 一起穩定」只在每個對角斜率都正確（J_ii < 0）時才附上（T18 的情形）。
 */
export function explainInstability(poles: Complex[], rho: number, Jn: Mat, exactJ: boolean): string {
  const worst = poles[0]
  const isComplex = Math.abs(worst.im) > 1e-9 * Math.max(1, Math.abs(worst.re))
  // 回傳的字串經 mathText 顯示（Lab 警告區、Gallery）：數學寫成 `$...$`
  const poleTex = `${texNum(worst.re)}${isComplex ? `\\pm j${texNum(Math.abs(worst.im), 3)}` : ''}`
  const head = String.raw`$\rho(\mathbf I+\mathbf M\mathbf J)=${texNum(rho, 5)}\ge1$`
  const diagOk = Jn.every((row, i) => row[i] < 0)
  const tail = diagOk ? '每個 loop 單獨穩定不代表 MIMO 一起穩定。' : ''
  const jhatNote = exactJ ? '' : String.raw`（$\mathbf M$ 由 $\hat{\mathbf J}\ne\mathbf J$ 建構：也可能是 $\hat{\mathbf J}$ 的誤差造成，勘誤 E24）`
  const tooBig = String.raw`請減小 $\mu$／$\gamma$ 或加大 $\lambda_{\mathrm{reg}}$`
  if (isComplex) {
    return String.raw`${head}：複數 pole $${poleTex}$（$|p|=${texNum(rho)}$）——$\mathbf M\mathbf J$ 不對稱造成旋轉，誤差${rho > 1 + MARGINAL_TOL ? '邊振盪邊放大' : '持續振盪、不收斂'}${jhatNote}。${tail}`
  }
  if (Math.abs(rho - 1) <= MARGINAL_TOL) {
    return worst.re > 0
      ? String.raw`${head}：臨界——pole $=1$ 的模式 loop gain 為 0（或小於 $10^{-9}$），平均誤差沿該方向凍結（不收斂也不放大）。原因是該方向不可辨識（$\lambda_{\min}=0$）或更新矩陣在該方向沒有增益（步長為 0）${jhatNote}。`
      : String.raw`${head}：臨界——pole $=-1$ 的模式 loop gain 恰為 2，平均誤差每個 block 變號、振幅不衰減；${tooBig}${jhatNote}。`
  }
  if (worst.re > 0) {
    return String.raw`${head}：平均誤差沿 pole $${poleTex}$ 的模式發散（每個 block 放大 $${texNum(rho)}$ 倍）。pole $>1$ 代表該模式的更新方向相反（$-\mathbf J$ 在該方向不是正定／極性錯誤），縮小步長無效，需要用反矩陣或 regularized pinv 修正方向${jhatNote}。${tail}`
  }
  return String.raw`${head}：平均誤差沿 pole $${poleTex}$ 的模式發散（每個 block 變號並放大 $${texNum(rho)}$ 倍）。pole $<-1$ 代表該模式的 loop gain $1-p=${texNum(1 - worst.re)}>2$，過度修正：${tooBig}${jhatNote}。`
}

/**
 * 分析一個規則：M、A = I + MJ 的 poles、95% 衰減 block 數、穩態共變異（Lyapunov）與封閉式（若適用）。
 * poles 一律由實際使用的 M（由 Ĵ 建構）與真實 J 計算 eig(I + M(Ĵ)J)（勘誤 E24）。
 */
export function analyzeRule(plant: PlantModel, cfg: RuleConfig, JnHat: Mat): RuleAnalysis {
  if (plant.errors.length) return failAnalysis(cfg.rule, plant.errors.join(' '))
  const built = buildUpdateMatrix(cfg, JnHat, plant.mode)
  if (built.error) return failAnalysis(cfg.rule, built.error, built.warnings)
  const P = plant.P
  const warnings = [...built.warnings]
  const exactJ = normFro(matAdd(JnHat, matScale(plant.Jn, -1))) <= 1e-12 * Math.max(1, normFro(plant.Jn))

  if (cfg.rule === 'sequential') {
    const K = cfg.seqBlocksPerPhase
    const total = P * cfg.seqSweeps * K
    // 每個階段（只開第 i 個 loop）的 (A_i, Q_i) 只有 P 種：先算好
    const steps = Array.from({ length: P }, (_, i) => {
      return stepMatrices(plant, mSequential(JnHat, cfg, i * K))
    })
    // 一個 sweep 的轉移矩陣 Φ = Π A_i^K
    let Phi = identity(P)
    for (let i = 0; i < P; i++) for (let k = 0; k < K; k++) Phi = matMul(steps[i].A, Phi)
    const rhoSweep = spectralRadius(Phi)
    // 排程期間的平均與共變異傳遞（從 δ 已知 ⇒ Cov_0 = 0）。P ≤ 4：用預先配置的小矩陣原地運算（避免每 block 配置記憶體）
    let PhiK = identity(P)
    let X = zeros(P)
    let tmpPhi = zeros(P)
    let tmpX = zeros(P)
    const AX = zeros(P)
    // 與時不變規則同一個定義：‖Φ_j‖₂ 最後一次超過 5% 的下一個 block（不是第一次低於 5%：過度修正 γ > 1 時範數會再回升）
    let lastAbove = 0
    let endBelow = false
    for (let k = 0; k < total; k++) {
      const { A, Q } = steps[Math.floor(k / K) % P]
      for (let i = 0; i < P; i++) {
        for (let j = 0; j < P; j++) {
          let sp = 0
          let sx = 0
          for (let l = 0; l < P; l++) {
            sp += A[i][l] * PhiK[l][j]
            sx += A[i][l] * X[l][j]
          }
          tmpPhi[i][j] = sp
          AX[i][j] = sx
        }
      }
      for (let i = 0; i < P; i++) {
        for (let j = 0; j < P; j++) {
          let sx = Q[i][j]
          for (let l = 0; l < P; l++) sx += AX[i][l] * A[j][l] // (A X Aᵀ)_ij + Q_ij
          tmpX[i][j] = sx
        }
      }
      ;[PhiK, tmpPhi] = [tmpPhi, PhiK]
      ;[X, tmpX] = [tmpX, X]
      // ‖Φ‖_F/√P ≤ ‖Φ‖₂ ≤ ‖Φ‖_F：只有落在兩界之間才需要真的比 2-norm
      const fro = normFro(PhiK)
      endBelow = fro <= DECAY_95 || (fro / Math.sqrt(P) <= DECAY_95 && !norm2Exceeds(PhiK, DECAY_95))
      if (!endBelow) lastAbove = k + 1
    }
    // 排程結束後所有係數凍結，範數不再改變：結束時仍 > 5% 就是「沒有達成」
    const blocks95 = endBelow ? lastAbove + 1 : null
    const modeVar = modeDiag(plant.modeBasis, X)
    const perParamVar = diagOf(X)
    const vIdx = trace(matMul(plant.Ru, X)) / (plant.sigmaV * plant.sigmaV)
    if (blocks95 === null) {
      warnings.push(
        String.raw`Sequential：${cfg.seqSweeps} 個 sweep 結束時 $\|\boldsymbol\Phi\|_2=${texNum(norm2Mat(PhiK), 3)}>0.05$，初始誤差沒有被消除就凍結了（耦合使每個參數都把別人的誤差吸收進來）。`,
      )
    }
    return {
      rule: cfg.rule,
      ok: true,
      error: null,
      warnings,
      Mn: null,
      Mphys: null,
      A: Phi,
      poles: sortedPoles(Phi),
      spectralRadius: rhoSweep > 0 ? Math.pow(rhoSweep, 1 / (P * K)) : 0,
      stable: rhoSweep < 1 - MARGINAL_TOL,
      blocks95,
      blocks95Basis: blocks95 === null ? null : 'norm',
      blocks95Asymptotic: null,
      cov: X,
      covKind: 'final',
      modeVar,
      perParamVar,
      totalVar: trace(X),
      validityIndex: vIdx,
      closedPoles: null,
      closedModeVar: null,
    }
  }

  const Mn = built.Mn as Mat
  const { A, Q } = stepMatrices(plant, Mn)
  const poles = sortedPoles(A)
  const rho = spectralRadius(A)
  // 落在單位圓上（|ρ − 1| ≤ MARGINAL_TOL）視為臨界、不算穩定：否則浮點誤差會把 pole = ±1 判成「穩定但要 10¹¹ 個 block」
  const stable = rho < 1 - MARGINAL_TOL
  let cov: Mat | null = null
  if (stable) {
    try {
      cov = dlyap(A, Q)
    } catch {
      cov = null
    }
  } else {
    warnings.push(explainInstability(poles, rho, plant.Jn, exactJ))
  }
  const modeVar = cov ? modeDiag(plant.modeBasis, cov) : null
  // 95% 衰減：ρ(A) < 1 只保證最後會收斂；有限時間的 block 數要看 ‖A^k‖₂（A 非正規時 ‖A^k‖₂ > ρ^k，審查 R02）
  const blocks95Asymptotic = stable ? stepsToDecay(rho) : null
  let blocks95 = blocks95Asymptotic
  let blocks95Basis: RuleAnalysis['blocks95Basis'] = stable ? 'pole' : null
  if (blocks95Asymptotic !== null && !poleCountIsExact(A, rho)) {
    const kNorm = normDecayBlocks(A)
    if (kNorm !== null) {
      // ‖A^k‖₂ ≥ ρ^k ⇒ 一定不小於 F-10.5；取 max 只是擋掉剛好落在整數邊界時的浮點差異
      blocks95 = Math.max(kNorm, blocks95Asymptotic)
      blocks95Basis = 'norm'
    } else {
      blocks95Basis = 'lower-bound'
      // 這則訊息會經 mathText 顯示在 Lab 的警告區與 Gallery：數學寫成 `$...$`（docs/teaching-style.md §3）
      warnings.push(
        String.raw`$\mathbf A$ 非正規且衰減極慢：$\|\mathbf A^k\|_2$ 在 $${texInt(MAX_NORM_DECAY_ITER)}$ 個 block 內沒有確定降到 5% 以下；$k_{95}$ 只列出由 $\rho(\mathbf A)$ 算的下界 $${texInt(blocks95Asymptotic)}$（實際更久）。`,
      )
    }
  }
  // 封閉式（Ĵ = J 時）
  let closedPoles: number[] | null = null
  let closedModeVar: number[] | null = null
  if (exactJ) {
    if (cfg.rule === 'full') closedPoles = Array.from({ length: P }, () => 1 - cfg.gamma)
    else if (cfg.rule === 'regularized' && cfg.regForm === 'J') {
      closedPoles = svd(JnHat).S.map((s) => 1 - (cfg.gamma * s * s) / (s * s + cfg.lambdaReg))
    }
    if (plant.mode === 'R') {
      const trRx = trace(plant.Rx)
      const gains = plant.modeValues.map((l) => ruleModeGain(cfg, l, trRx))
      if (gains.every((g) => g !== null)) {
        closedPoles = gains.map((g, i) => 1 - (g as number) * plant.modeValues[i])
        closedModeVar = gains.map((g, i) => modeVarianceClosed(g as number, plant.modeValues[i], plant.Kq, plant.N))
      }
    }
  }
  return {
    rule: cfg.rule,
    ok: true,
    error: null,
    warnings,
    Mn,
    Mphys: matScale(Mn, 1 / plant.Kq),
    A,
    poles,
    spectralRadius: rho,
    stable,
    blocks95,
    blocks95Basis,
    blocks95Asymptotic,
    cov,
    covKind: cov ? 'stationary' : null,
    modeVar,
    perParamVar: cov ? diagOf(cov) : null,
    totalVar: cov ? trace(cov) : null,
    validityIndex: cov ? trace(matMul(plant.Ru, cov)) / (plant.sigmaV * plant.sigmaV) : null,
    closedPoles,
    closedModeVar,
  }
}

/** 硬體「Freeze gain」：第 k 個 block 之後（k ≥ freezeAt）停止更新 w（M = 0）。null / undefined = 不凍結。 */
export function isFrozen(k: number, freezeAt?: number | null): boolean {
  return freezeAt !== null && freezeAt !== undefined && k >= freezeAt
}

/**
 * 線性模型下平均與共變異的精確傳遞（時變 M 亦可）：
 *   m_{k+1} = A_k m_k，X_{k+1} = A_k X_k A_kᵀ + M_k Σ_η M_kᵀ，X_0 = 0。
 * freezeAt：k ≥ freezeAt 後 M = 0（A = I、Q = 0，w 與 δ 凍結）。
 * 回傳每個參數的 E[δ_k] 與 std(δ_k)（fs）。
 */
export function propagateLinearMoments(
  plant: PlantModel,
  cfg: RuleConfig,
  JnHat: Mat,
  delta0: number[],
  blocks: number,
  freezeAt?: number | null,
): { mean: Float64Array[]; std: Float64Array[] } | null {
  const built = buildUpdateMatrix(cfg, JnHat, plant.mode)
  if (built.error || plant.errors.length) return null
  const P = plant.P
  const mean = Array.from({ length: P }, () => new Float64Array(blocks + 1))
  const std = Array.from({ length: P }, () => new Float64Array(blocks + 1))
  let m = delta0.slice()
  let X = zeros(P)
  const fixed: { A: Mat; Q: Mat } | null = cfg.rule === 'sequential' ? null : stepMatrices(plant, built.Mn as Mat)
  const frozenStep = { A: identity(P), Q: zeros(P) }
  // sequential：每 block 的 M 只有「第 i 個 loop 開」或「全部凍結」幾種，快取避免逐 block 重建
  const seqCache = new Map<number, { A: Mat; Q: Mat }>()
  const seqStep = (k: number) => {
    const phase = Math.floor(k / cfg.seqBlocksPerPhase)
    const key = phase < P * cfg.seqSweeps ? phase % P : -1
    let st = seqCache.get(key)
    if (!st) {
      st = stepMatrices(plant, mSequential(JnHat, cfg, k))
      seqCache.set(key, st)
    }
    return st
  }
  for (let k = 0; k <= blocks; k++) {
    for (let i = 0; i < P; i++) {
      mean[i][k] = m[i]
      std[i][k] = Math.sqrt(Math.max(X[i][i], 0))
    }
    if (k === blocks) break
    const { A, Q } = isFrozen(k, freezeAt) ? frozenStep : (fixed ?? seqStep(k))
    m = matVec(A, m)
    X = matAdd(matMul(matMul(A, X), transpose(A)), Q)
    if (!m.every((v) => Math.abs(v) < DIVERGENCE_LIMIT_FS)) {
      for (let j = k + 1; j <= blocks; j++) for (let i = 0; i < P; i++) mean[i][j] = std[i][j] = NaN
      break
    }
  }
  return { mean, std }
}

/** 非線性 mean-field 遞迴（忽略雜訊）：δ_{k+1} = δ_k − M E[G(δ_k)]，E[G] 用精確的 sign-GMAC 平均（含大誤差增益壓縮）。 */
export function meanFieldTrajectory(
  plant: PlantModel,
  cfg: RuleConfig,
  JnHat: Mat,
  delta0: number[],
  blocks: number,
  freezeAt?: number | null,
): Float64Array[] | null {
  const built = buildUpdateMatrix(cfg, JnHat, plant.mode)
  if (built.error || plant.errors.length) return null
  const P = plant.P
  const out = Array.from({ length: P }, () => new Float64Array(blocks + 1))
  let d = delta0.slice()
  for (let k = 0; k <= blocks; k++) {
    for (let i = 0; i < P; i++) out[i][k] = d[i]
    if (k === blocks) break
    if (isFrozen(k, freezeAt)) continue // Freeze：w 不再更新
    d = blockUpdate(d, matrixAt(cfg, built, JnHat, k), signGmacMean(plant, d), plant.Kq)
    if (!d.every((v) => Number.isFinite(v) && Math.abs(v) < DIVERGENCE_LIMIT_FS)) {
      for (let j = k + 1; j <= blocks; j++) for (let i = 0; i < P; i++) out[i][j] = NaN
      break
    }
  }
  return out
}

// ───────────────────────────── Jacobian 量測（§10.2） ─────────────────────────────

// #region core:centralDiffJacobian
/**
 * §10.2 中央差分量測 Jacobian：Freeze w，把第 j 個參數分別 ±Δ，各跑一次 GMAC。
 *   J_ij ≈ [G_i(w + Δe_j) − G_i(w − Δe_j)] / (2Δ)
 * 以 δ = a − w 表示：w + Δe_j ⇔ δ − Δe_j。誤差 O(Δ²)（泰勒展開的偶次項相消）。
 */
export function centralDiffJacobian(measureG: (delta: number[]) => number[], delta: number[], deltaFs: number): Mat {
  const P = delta.length
  const J = zeros(P)
  for (let j = 0; j < P; j++) {
    const wPlus = delta.map((d, i) => (i === j ? d - deltaFs : d)) // w + Δe_j
    const wMinus = delta.map((d, i) => (i === j ? d + deltaFs : d)) // w − Δe_j
    const gp = measureG(wPlus)
    const gm = measureG(wMinus)
    for (let i = 0; i < P; i++) J[i][j] = (gp[i] - gm[i]) / (2 * deltaFs)
  }
  return J
}
// #endregion

/**
 * 中央差分在 1-bit comparator 下的截斷係數（在 δ = 0 量測、第 j 欄）：
 *  - Gaussian u：1/√(1 + Δ² R_jj/σ_v²)
 *  - ±1 碼：erf(Δ/(√2σ_v)) / (K_q Δ)
 * 量到的 Ĵ 欄 = 真實 J 欄 × 這個係數（皆 < 1：S 曲線在 ±Δ 處已開始飽和）。
 */
export function fdTruncationFactor(dist: RegressorDist, deltaOverSigma: number, Rjj = 1): number {
  const r = deltaOverSigma
  if (r === 0) return 1
  if (dist === 'gaussian') return 1 / Math.sqrt(1 + r * r * Rjj)
  return erf(r / Math.SQRT2) / (Math.sqrt(2 / Math.PI) * r)
}

export interface JhatSpec {
  source: JhatSource
  /** 'custom'：使用者輸入的正規化 Ĵ_n */
  custom?: Mat
  /** 'perturbed'：相對 Frobenius 誤差 ε */
  perturbRel?: number
  /** 'finiteDiff'：擾動 Δ（fs）與每次量測的 sample 數 N_J */
  fdDeltaFs?: number
  fdSamples?: number
}

export interface JhatInfo {
  source: JhatSource
  /** ‖Ĵ_n − J_n‖_F / ‖J_n‖_F */
  relErr: number
  /** finiteDiff：Ĵ_n 的理論期望值（含截斷）與標準差 */
  expected: Mat | null
  std: Mat | null
  samplesUsed: number
  note: string
}

/** 依來源決定 Ĵ_n（exact / custom / perturbed / finiteDiff）。finiteDiff 在初始 operating point δ_0 量測。 */
export function resolveJhat(plant: PlantModel, spec: JhatSpec, delta0: number[], seed: number): { JnHat: Mat; info: JhatInfo; error: string | null } {
  const P = plant.P
  const relErr = (J: Mat) => normFro(matAdd(J, matScale(plant.Jn, -1))) / Math.max(normFro(plant.Jn), 1e-300)
  const base = { expected: null, std: null, samplesUsed: 0 }
  switch (spec.source) {
    case 'custom': {
      if (!isSquare(spec.custom, P) || !isFiniteMatrix(spec.custom)) {
        return { JnHat: plant.Jn, info: { source: 'exact', relErr: 0, ...base, note: String.raw`自訂 $\hat{\mathbf J}$ 尺寸不符，改用 $\hat{\mathbf J}=\mathbf J$` }, error: String.raw`自訂 $\hat{\mathbf J}$ 必須是 $${P}\times${P}$ 的有限數值矩陣。` }
      }
      const J = spec.custom.map((r) => r.slice())
      return { JnHat: J, info: { source: 'custom', relErr: relErr(J), ...base, note: String.raw`使用者輸入的 $\hat{\mathbf J}$（例如舊 corner 的量測值）` }, error: null }
    }
    case 'perturbed': {
      const eps = spec.perturbRel ?? 0
      const rng = createRng(seed).fork('jhat-perturb')
      let E = Array.from({ length: P }, () => Array.from({ length: P }, () => rng.normal()))
      if (plant.mode === 'R') E = symmetricPart(E)
      const scale = (eps * normFro(plant.Jn)) / Math.max(normFro(E), 1e-300)
      const J = matAdd(plant.Jn, matScale(E, scale))
      return { JnHat: J, info: { source: 'perturbed', relErr: relErr(J), ...base, note: String.raw`$\hat{\mathbf J}=\mathbf J$ 加上隨機誤差（相對 Frobenius $\varepsilon=${texRaw(eps)}$）` }, error: null }
    }
    case 'finiteDiff': {
      const dfs = spec.fdDeltaFs ?? 0.3 * plant.sigmaV
      const NJ = Math.max(1, Math.round(spec.fdSamples ?? 4096))
      if (!(dfs > 0)) return { JnHat: plant.Jn, info: { source: 'exact', relErr: 0, ...base, note: String.raw`$\Delta$ 不合法` }, error: String.raw`$\Delta$ 必須 $>0\ \mathrm{fs}$。` }
      const meas: PlantModel = { ...plant, N: NJ }
      const rng = createRng(seed).fork('jacobian-fd')
      const normal = makeNormal(rng)
      const uni = () => rng.uniform()
      const Jphys = centralDiffJacobian((d) => gmacSample(meas, d, normal, uni), delta0, dfs)
      const J = matScale(Jphys, 1 / plant.Kq)
      const expPhys = centralDiffJacobian((d) => signGmacMean(plant, d), delta0, dfs)
      const expected = matScale(expPhys, 1 / plant.Kq)
      // Var(Ĵ_ij) ≈ 2·R_x,ii / (N_J (2Δ)²)（兩次獨立量測），轉成正規化單位 ÷ K_q
      const std = Array.from({ length: P }, (_, i) =>
        Array.from({ length: P }, () => Math.sqrt((2 * plant.Rx[i][i]) / NJ) / (2 * dfs) / plant.Kq),
      )
      return {
        JnHat: J,
        info: {
          source: 'finiteDiff',
          relErr: relErr(J),
          expected,
          std,
          samplesUsed: 2 * P * NJ,
          note: String.raw`中央差分：$\Delta=${texRaw(dfs)}\ \mathrm{fs}$（$\Delta/\sigma_v=${texNum(dfs / plant.sigmaV, 3)}$），每點 $N_J=${texInt(NJ)}$ samples，在 $\boldsymbol\delta_0$ 量測`,
        },
        error: null,
      }
    }
    default:
      return { JnHat: plant.Jn.map((r) => r.slice()), info: { source: 'exact', relErr: 0, ...base, note: String.raw`$\hat{\mathbf J}=\mathbf J$（模型完全匹配）` }, error: null }
  }
}

// ───────────────────────────── 時域模擬（worker） ─────────────────────────────

export interface MimoTrajParams {
  plant: PlantSpec
  cases: RuleConfig[]
  /** 初始誤差 δ_0 = a − w_0（fs） */
  delta0: number[]
  blocks: number
  engine: MimoEngine
  jhat: JhatSpec
  seed: number
  /** 硬體 Freeze gain：k ≥ freezeAt 後停止更新（GMAC 仍量測，但 w 不動）；省略 = 不凍結 */
  freezeAt?: number | null
}

export interface MimoTrajCase {
  rule: MimoRule
  ok: boolean
  error: string | null
  /** δ_{k,i}（fs）：每個參數一條，長度 blocks+1；數值發散後為 NaN */
  delta: Float64Array[]
  /** ‖δ_k‖₂（fs） */
  norm: Float64Array
  /** 線性模型的 E[δ_k] 與 std(δ_k)（精確傳遞） */
  meanAnalytic: Float64Array[] | null
  stdAnalytic: Float64Array[] | null
  /** sample 引擎：非線性 mean-field（含增益壓縮） */
  meanField: Float64Array[] | null
  diverged: boolean
  divergedAt: number | null
}

export interface MimoTrajResult {
  ok: boolean
  error: string | null
  engine: MimoEngine
  cases: MimoTrajCase[]
  JnHat: Mat
  jhatInfo: JhatInfo | null
  totalSamples: number
  warnings: string[]
}

/** 估計 sample 引擎的運算量（comparator samples） */
export function estimateSampleCost(p: { cases: number; blocks: number; N: number; chains?: number; P?: number; fdSamples?: number }): number {
  return p.cases * p.blocks * p.N * (p.chains ?? 1) + (p.fdSamples ? 2 * (p.P ?? 2) * p.fdSamples : 0)
}

function emptyCase(rule: MimoRule, error: string): MimoTrajCase {
  return { rule, ok: false, error, delta: [], norm: new Float64Array(0), meanAnalytic: null, stdAnalytic: null, meanField: null, diverged: false, divergedAt: null }
}

/**
 * 同一 seed 跑多個規則（paired comparison：每個 case 重建同一條 'gmac' 亂數串流，雜訊序列完全相同）。
 */
export function runMimoTrajectories(p: MimoTrajParams): MimoTrajResult {
  const plant = buildPlant(p.plant)
  const fail = (error: string): MimoTrajResult => ({
    ok: false,
    error,
    engine: p.engine,
    cases: [],
    JnHat: plant.Jn,
    jhatInfo: null,
    totalSamples: 0,
    warnings: plant.warnings,
  })
  if (plant.errors.length) return fail(plant.errors.join(' '))
  const blocks = Math.round(p.blocks)
  if (!(blocks >= 1 && blocks <= MAX_BLOCKS)) return fail(String.raw`blocks 必須在 1 到 $${texInt(MAX_BLOCKS)}$ 之間。`)
  if (!Array.isArray(p.delta0) || p.delta0.length !== plant.P || !p.delta0.every(Number.isFinite)) return fail(String.raw`$\boldsymbol\delta_0$ 必須有 ${plant.P} 個有限數值。`)
  const fdCost = p.jhat.source === 'finiteDiff' ? 2 * plant.P * (p.jhat.fdSamples ?? 4096) : 0
  const cost = p.engine === 'sample' ? p.cases.length * blocks * plant.N + fdCost : fdCost
  if (cost > MAX_SAMPLE_BUDGET) {
    return fail(
      String.raw`運算量 $${sciTex(cost.toExponential(2))}$ samples 超過預算 $${sciTex(MAX_SAMPLE_BUDGET.toExponential(0))}$：請減少 $N$、blocks、$N_J$ 或 case 數，或改用 linear 引擎。`,
    )
  }
  const { JnHat, info, error: jErr } = resolveJhat(plant, p.jhat, p.delta0, p.seed)
  const warnings = [...plant.warnings]
  if (jErr) warnings.push(jErr)
  const P = plant.P
  const cases = p.cases.map((cfg): MimoTrajCase => {
    const built = buildUpdateMatrix(cfg, JnHat, plant.mode)
    if (built.error) return emptyCase(cfg.rule, built.error)
    const rng = createRng(p.seed).fork('gmac') // paired：每個 case 用同一條串流
    const normal = makeNormal(rng)
    const uni = () => rng.uniform()
    const delta = Array.from({ length: P }, () => new Float64Array(blocks + 1).fill(NaN))
    const norm = new Float64Array(blocks + 1).fill(NaN)
    let d = p.delta0.slice()
    let diverged = false
    let divergedAt: number | null = null
    for (let k = 0; k <= blocks; k++) {
      let s = 0
      for (let i = 0; i < P; i++) {
        delta[i][k] = d[i]
        s += d[i] * d[i]
      }
      norm[k] = Math.sqrt(s)
      if (k === blocks) break
      const G = p.engine === 'sample' ? gmacSample(plant, d, normal, uni) : gmacLinear(plant, d, normal)
      if (isFrozen(k, p.freezeAt)) continue // Freeze gain：GMAC 照樣量測（亂數串流不變），但不更新 w
      d = blockUpdate(d, matrixAt(cfg, built, JnHat, k), G, plant.Kq)
      if (!d.every((v) => Number.isFinite(v) && Math.abs(v) < DIVERGENCE_LIMIT_FS)) {
        diverged = true
        divergedAt = k + 1
        break
      }
    }
    const mom = propagateLinearMoments(plant, cfg, JnHat, p.delta0, blocks, p.freezeAt)
    return {
      rule: cfg.rule,
      ok: true,
      error: null,
      delta,
      norm,
      meanAnalytic: mom?.mean ?? null,
      stdAnalytic: mom?.std ?? null,
      meanField: p.engine === 'sample' ? meanFieldTrajectory(plant, cfg, JnHat, p.delta0, blocks, p.freezeAt) : null,
      diverged,
      divergedAt,
    }
  })
  return {
    ok: true,
    error: null,
    engine: p.engine,
    cases,
    JnHat,
    jhatInfo: info,
    totalSamples: cost,
    warnings,
  }
}

// ───────────────────────────── 穩態共變異 Monte Carlo（worker） ─────────────────────────────

export interface MimoCovParams {
  plant: PlantSpec
  rule: RuleConfig
  jhat: JhatSpec
  engine: MimoEngine
  /** 獨立 chains（CI 以 chains 間的 t 分布計算） */
  chains: number
  /** 每條 chain 記錄的 block 數（stationary 規則） */
  recordBlocks: number
  /** burn-in（省略時自動：⌈6/(−ln ρ)⌉） */
  burnIn?: number
  delta0?: number[]
  seed: number
  /** scatter 圖最多保留的點數 */
  maxScatter?: number
}

export interface MimoCovResult {
  ok: boolean
  error: string | null
  kind: 'stationary' | 'final'
  /** MC 估計 Cov(δ)（fs²） */
  cov: Mat
  covLo: Mat
  covHi: Mat
  covAnalytic: Mat | null
  /** MC 樣本平均 E[δ]（fs）：stationary 只作參考（理論 0）；sequential 為排程結束時的平均（橢圓中心） */
  mean: number[]
  /** 解析平均：stationary = 0；sequential = Φ_total δ_0（線性模型精確傳遞） */
  meanAnalytic: number[] | null
  modeBasis: Mat
  modeValues: number[]
  modeVar: number[]
  modeVarLo: number[]
  modeVarHi: number[]
  modeVarAnalytic: number[] | null
  modeVarClosed: number[] | null
  perParamVarAnalytic: number[] | null
  /** δ 樣本（每個參數一條；已抽稀） */
  scatter: Float64Array[]
  chains: number
  burnIn: number
  recordBlocks: number
  samplesUsed: number
  validityIndexMc: number
  warnings: string[]
}

/**
 * 穩態共變異 Monte Carlo：多條獨立 chain，各自 burn-in 後以 (1/B)Σ δδᵀ（理論均值 0）估計 Cov(δ)，
 * 再以 chains 間的 Student-t 95% CI 與 Lyapunov 解析值比較。sequential 則取排程結束時的 δ（iid across chains）。
 */
export function runMimoCovarianceMc(p: MimoCovParams): MimoCovResult {
  const plant = buildPlant(p.plant)
  const P = plant.P
  const fail = (error: string): MimoCovResult => ({
    ok: false,
    error,
    kind: 'stationary',
    cov: [],
    covLo: [],
    covHi: [],
    covAnalytic: null,
    mean: [],
    meanAnalytic: null,
    modeBasis: plant.modeBasis,
    modeValues: plant.modeValues,
    modeVar: [],
    modeVarLo: [],
    modeVarHi: [],
    modeVarAnalytic: null,
    modeVarClosed: null,
    perParamVarAnalytic: null,
    scatter: [],
    chains: 0,
    burnIn: 0,
    recordBlocks: 0,
    samplesUsed: 0,
    validityIndexMc: NaN,
    warnings: plant.warnings,
  })
  if (plant.errors.length) return fail(plant.errors.join(' '))
  const chains = Math.round(p.chains)
  if (!(chains >= 2 && chains <= 4096)) return fail(String.raw`chains 必須在 2 到 $4{,}096$ 之間（CI 需要至少 2 條獨立 chain）。`)
  const delta0 = p.delta0 ?? new Array<number>(P).fill(0)
  const { JnHat, error: jErr } = resolveJhat(plant, p.jhat, delta0, p.seed)
  const warnings = [...plant.warnings]
  if (jErr) warnings.push(jErr)
  const an = analyzeRule(plant, p.rule, JnHat)
  if (!an.ok) return fail(an.error ?? '無法分析此規則')
  const isSeq = p.rule.rule === 'sequential'
  if (!isSeq && !an.stable) return fail(String.raw`$\rho(\mathbf I+\mathbf M\mathbf J)=${texNum(an.spectralRadius)}\ge1$：迴路不穩定，沒有穩態共變異可估計（誤差會無限成長）。`)
  const built = buildUpdateMatrix(p.rule, JnHat, plant.mode)
  const K = p.rule.seqBlocksPerPhase
  const seqTotal = P * p.rule.seqSweeps * K
  const burnIn = isSeq ? 0 : Math.max(10, Math.min(200000, Math.round(p.burnIn ?? Math.ceil(6 / -Math.log(Math.max(an.spectralRadius, 1e-6))))))
  const record = isSeq ? 1 : Math.max(1, Math.round(p.recordBlocks))
  const perChainBlocks = isSeq ? seqTotal : burnIn + record
  const cost = p.engine === 'sample' ? chains * perChainBlocks * plant.N : 0
  if (cost > MAX_SAMPLE_BUDGET) return fail(String.raw`運算量 $${sciTex(cost.toExponential(2))}$ samples 超過預算：請減少 chains、record blocks 或 $N$，或改用 linear 引擎。`)

  const maxScatter = p.maxScatter ?? 1500
  const totalRecorded = chains * record
  const stride = Math.max(1, Math.floor(totalRecorded / maxScatter))
  const scatter: number[][] = Array.from({ length: P }, () => [])
  // 每條 chain 的估計值：P×P 個二階動差（stationary）或 final δ（sequential）
  const perChain: number[][] = [] // [chain][i*P+j]
  const perChainMean: number[][] = [] // [chain][i]
  const finals: number[][] = []
  const root = createRng(p.seed)
  let rec = 0
  for (let c = 0; c < chains; c++) {
    const rng = root.fork(`cov-chain-${c}`)
    const normal = makeNormal(rng)
    const uni = () => rng.uniform()
    let d = isSeq ? delta0.slice() : new Array<number>(P).fill(0)
    const acc = new Array<number>(P * P).fill(0)
    const accMean = new Array<number>(P).fill(0)
    for (let k = 0; k < perChainBlocks; k++) {
      const G = p.engine === 'sample' ? gmacSample(plant, d, normal, uni) : gmacLinear(plant, d, normal)
      d = blockUpdate(d, matrixAt(p.rule, built, JnHat, k), G, plant.Kq)
      if (!isSeq && k >= burnIn) {
        for (let i = 0; i < P; i++) {
          accMean[i] += d[i]
          for (let j = 0; j < P; j++) acc[i * P + j] += d[i] * d[j]
        }
        if (rec % stride === 0) for (let i = 0; i < P; i++) scatter[i].push(d[i])
        rec++
      }
    }
    if (isSeq) {
      finals.push(d)
      if (c % Math.max(1, Math.floor(chains / maxScatter)) === 0) for (let i = 0; i < P; i++) scatter[i].push(d[i])
    } else {
      perChain.push(acc.map((v) => v / record))
      perChainMean.push(accMean.map((v) => v / record))
    }
  }

  const cov = zeros(P)
  const covLo = zeros(P)
  const covHi = zeros(P)
  const modeVar: number[] = []
  const modeVarLo: number[] = []
  const modeVarHi: number[] = []
  const V = plant.modeBasis
  let mean: number[] = new Array<number>(P).fill(0)
  let meanAnalytic: number[] | null = new Array<number>(P).fill(0)
  if (isSeq) {
    // final δ 在 chains 間 iid：樣本共變異（扣除均值）；CI 為 (δ−μ̂)(δ−μ̂)ᵀ 乘積的 Student-t 區間 × n/(n−1)
    const mu = Array.from({ length: P }, (_, i) => finals.reduce((s, f) => s + f[i], 0) / chains)
    mean = mu
    const mom = propagateLinearMoments(plant, p.rule, JnHat, delta0, seqTotal)
    meanAnalytic = mom ? mom.mean.map((m) => m[seqTotal]) : null
    for (let i = 0; i < P; i++) {
      for (let j = 0; j < P; j++) {
        const prods = finals.map((f) => (f[i] - mu[i]) * (f[j] - mu[j]))
        const ci = meanCI(prods)
        const scale = chains / (chains - 1)
        cov[i][j] = ci.mean * scale
        covLo[i][j] = ci.lo * scale
        covHi[i][j] = ci.hi * scale
      }
    }
    for (let m = 0; m < P; m++) {
      const xi = finals.map((f) => f.reduce((s, v, i) => s + V[i][m] * (v - mu[i]), 0))
      const ci = meanCI(xi.map((v) => v * v))
      const scale = chains / (chains - 1)
      modeVar.push(ci.mean * scale)
      modeVarLo.push(ci.lo * scale)
      modeVarHi.push(ci.hi * scale)
    }
  } else {
    mean = Array.from({ length: P }, (_, i) => perChainMean.reduce((s, m) => s + m[i], 0) / chains)
    for (let i = 0; i < P; i++) {
      for (let j = 0; j < P; j++) {
        const ci = meanCI(perChain.map((a) => a[i * P + j]))
        cov[i][j] = ci.mean
        covLo[i][j] = ci.lo
        covHi[i][j] = ci.hi
      }
    }
    for (let m = 0; m < P; m++) {
      const per = perChain.map((a) => {
        let s = 0
        for (let i = 0; i < P; i++) for (let j = 0; j < P; j++) s += V[i][m] * a[i * P + j] * V[j][m]
        return s
      })
      const ci = meanCI(per)
      modeVar.push(ci.mean)
      modeVarLo.push(ci.lo)
      modeVarHi.push(ci.hi)
    }
  }
  const vIdx = trace(matMul(plant.Ru, cov)) / (plant.sigmaV * plant.sigmaV)
  if (vIdx > 0.05) {
    warnings.push(
      String.raw`線性化有效性指標 $E[\boldsymbol\delta^T\mathbf R_u\boldsymbol\delta]/\sigma_v^2=${texNum(vIdx, 3)}$ 不夠小：殘差已和 comparator noise 同量級，$K_q$ 線性化高估實際增益（sample 引擎的變異會偏離公式）。`,
    )
  }
  return {
    ok: true,
    error: null,
    kind: isSeq ? 'final' : 'stationary',
    cov,
    covLo,
    covHi,
    covAnalytic: an.cov,
    mean,
    meanAnalytic,
    modeBasis: V,
    modeValues: plant.modeValues,
    modeVar,
    modeVarLo,
    modeVarHi,
    modeVarAnalytic: an.modeVar,
    modeVarClosed: an.closedModeVar,
    perParamVarAnalytic: an.perParamVar,
    scatter: scatter.map((s) => Float64Array.from(s)),
    chains,
    burnIn,
    recordBlocks: record,
    samplesUsed: cost,
    validityIndexMc: vIdx,
    warnings,
  }
}

// ───────────────────────────── 速度 vs 雜訊 trade-off（解析） ─────────────────────────────

export interface TradeoffPoint {
  value: number
  blocks95: number | null
  totalVar: number | null
  maxStd: number | null
  rho: number
}

/** 掃描某個規則的超參數（scalar: μK_q、nlms/full/diagonal: γ、regularized: λ_reg），回傳 (95% blocks, 總穩態變異)。 */
export function tradeoffSweep(plant: PlantModel, base: RuleConfig, JnHat: Mat, values: number[]): TradeoffPoint[] {
  return values.map((v) => {
    const cfg: RuleConfig = { ...base }
    if (base.rule === 'scalar') cfg.muKq = v
    else if (base.rule === 'regularized') cfg.lambdaReg = v
    else cfg.gamma = v
    const an = analyzeRule(plant, cfg, JnHat)
    return {
      value: v,
      blocks95: an.ok ? an.blocks95 : null,
      totalVar: an.ok ? an.totalVar : null,
      maxStd: an.ok && an.perParamVar ? Math.sqrt(Math.max(...an.perParamVar)) : null,
      rho: an.spectralRadius,
    }
  })
}

/** 等比數列 lo…hi（n 點） */
export function logspace(lo: number, hi: number, n: number): number[] {
  const a = Math.log10(lo)
  const b = Math.log10(hi)
  return Array.from({ length: n }, (_, i) => Math.pow(10, a + ((b - a) * i) / Math.max(1, n - 1)))
}

// ───────────────────────────── 一次分析全部規則（worker 亦可） ─────────────────────────────

export interface MimoAnalyzeParams {
  plant: PlantSpec
  cases: RuleConfig[]
  jhat: JhatSpec
  delta0: number[]
  seed: number
}

export interface MimoAnalyzeResult {
  ok: boolean
  error: string | null
  P: number
  Kq: number
  Jn: Mat
  JnHat: Mat
  modeValues: number[]
  modeBasis: Mat
  analyses: RuleAnalysis[]
  warnings: string[]
}

/** 解析總覽：每個 case 的 M、poles、95% blocks、穩態共變異（純函式、可 structured clone）。 */
export function analyzeMimo(p: MimoAnalyzeParams): MimoAnalyzeResult {
  const plant = buildPlant(p.plant)
  if (plant.errors.length) {
    return { ok: false, error: plant.errors.join(' '), P: plant.P, Kq: plant.Kq, Jn: [], JnHat: [], modeValues: [], modeBasis: [], analyses: [], warnings: plant.warnings }
  }
  // finiteDiff 的 Ĵ 需要 MC：解析總覽用 exact 以外的來源時照樣呼叫 resolveJhat（同 seed ⇒ 與時域模擬相同的 Ĵ）
  const { JnHat, error } = resolveJhat(plant, p.jhat, p.delta0, p.seed)
  const warnings = [...plant.warnings]
  if (error) warnings.push(error)
  return {
    ok: true,
    error: null,
    P: plant.P,
    Kq: plant.Kq,
    Jn: plant.Jn,
    JnHat,
    modeValues: plant.modeValues,
    modeBasis: plant.modeBasis,
    analyses: p.cases.map((c) => analyzeRule(plant, c, JnHat)),
    warnings,
  }
}
