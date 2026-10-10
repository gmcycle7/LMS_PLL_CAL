/**
 * 小型稠密線性代數（dense linear algebra），Matrix = number[][]（row-major，A[i][j] = 第 i 列第 j 欄）。
 *
 * 適用於 2×2 … 數十維的教學／校正模型（R 矩陣、Jacobian、雙迴路狀態矩陣）。
 * - inv / solve / det：LU 分解 + partial pivoting；奇異矩陣丟出含「矩陣奇異（singular）」的 Error。
 * - eigSym：cyclic Jacobi（對稱矩陣），特徵值由大到小，特徵向量為正交單位欄向量。
 * - eigvals：一般實矩陣，EISPACK balance（置換 + 縮放）→ Hessenberg（elmhes）→ Francis double-shift QR
 *   （Numerical Recipes hqr），回傳 Complex[]，依 |λ| 由大到小排序。
 * - svd：one-sided Jacobi（Hestenes），對秩不足（rank-deficient）矩陣也回傳正交的 U、V。
 * 所有函式都不修改輸入矩陣。
 */
import type { Complex } from '@/simulation/core/complex'

export type Matrix = number[][]
export type Vector = number[]

const EPS = 2.220446049250313e-16

// ───────────────────────────── 基本建構與檢查 ─────────────────────────────

function dimError(op: string, detail: string): Error {
  return new Error(`矩陣維度不符（dimension mismatch）：${op} ${detail}`)
}

function rows(A: Matrix): number {
  return A.length
}

function cols(A: Matrix): number {
  return A.length === 0 ? 0 : A[0].length
}

function assertRect(A: Matrix, op: string): void {
  const c = cols(A)
  for (let i = 0; i < A.length; i++) {
    if (A[i].length !== c) throw dimError(op, `第 ${i} 列長度 ${A[i].length} ≠ ${c}（不是矩形矩陣）`)
  }
}

function assertSquare(A: Matrix, op: string): number {
  assertRect(A, op)
  const n = rows(A)
  if (cols(A) !== n) throw dimError(op, `需要方陣，收到 ${n}×${cols(A)}`)
  return n
}

/** 深拷貝矩陣 */
export function clone(A: Matrix): Matrix {
  return A.map((r) => r.slice())
}

/** n×n 單位矩陣 */
export function identity(n: number): Matrix {
  const I = zeros(n, n)
  for (let i = 0; i < n; i++) I[i][i] = 1
  return I
}

/** r×c 零矩陣（c 省略時為 r×r） */
export function zeros(r: number, c: number = r): Matrix {
  return Array.from({ length: r }, () => new Array<number>(c).fill(0))
}

/** 以向量建立對角矩陣 */
export function diag(v: ArrayLike<number>): Matrix {
  const D = zeros(v.length, v.length)
  for (let i = 0; i < v.length; i++) D[i][i] = v[i]
  return D
}

/** 轉置 Aᵀ */
export function transpose(A: Matrix): Matrix {
  assertRect(A, 'transpose')
  const r = rows(A)
  const c = cols(A)
  const T = zeros(c, r)
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) T[j][i] = A[i][j]
  return T
}

/** 矩陣乘法 AB */
export function matMul(A: Matrix, B: Matrix): Matrix {
  assertRect(A, 'matMul')
  assertRect(B, 'matMul')
  const n = rows(A)
  const m = cols(A)
  const p = cols(B)
  if (rows(B) !== m) throw dimError('matMul', `A 為 ${n}×${m}、B 為 ${rows(B)}×${p}`)
  const C = zeros(n, p)
  for (let i = 0; i < n; i++) {
    const Ai = A[i]
    const Ci = C[i]
    for (let k = 0; k < m; k++) {
      const a = Ai[k]
      if (a === 0) continue
      const Bk = B[k]
      for (let j = 0; j < p; j++) Ci[j] += a * Bk[j]
    }
  }
  return C
}

/** 矩陣乘向量 Ax */
export function matVec(A: Matrix, x: ArrayLike<number>): Vector {
  assertRect(A, 'matVec')
  if (cols(A) !== x.length) throw dimError('matVec', `A 為 ${rows(A)}×${cols(A)}、x 長度 ${x.length}`)
  return A.map((row) => {
    let s = 0
    for (let j = 0; j < row.length; j++) s += row[j] * x[j]
    return s
  })
}

function elementwise(A: Matrix, B: Matrix, op: string, f: (a: number, b: number) => number): Matrix {
  assertRect(A, op)
  assertRect(B, op)
  if (rows(A) !== rows(B) || cols(A) !== cols(B)) {
    throw dimError(op, `${rows(A)}×${cols(A)} 與 ${rows(B)}×${cols(B)}`)
  }
  return A.map((row, i) => row.map((a, j) => f(a, B[i][j])))
}

/** A + B */
export function matAdd(A: Matrix, B: Matrix): Matrix {
  return elementwise(A, B, 'matAdd', (a, b) => a + b)
}

/** A − B */
export function matSub(A: Matrix, B: Matrix): Matrix {
  return elementwise(A, B, 'matSub', (a, b) => a - b)
}

/** sA */
export function matScale(A: Matrix, s: number): Matrix {
  return A.map((row) => row.map((a) => a * s))
}

/** 跡 tr(A) */
export function trace(A: Matrix): number {
  const n = assertSquare(A, 'trace')
  let s = 0
  for (let i = 0; i < n; i++) s += A[i][i]
  return s
}

/** 內積 aᵀb */
export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw dimError('dot', `長度 ${a.length} 與 ${b.length}`)
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** 向量 2-norm（以縮放避免 overflow/underflow） */
export function norm2(v: ArrayLike<number>): number {
  let scale = 0
  for (let i = 0; i < v.length; i++) scale = Math.max(scale, Math.abs(v[i]))
  if (scale === 0 || !Number.isFinite(scale)) return scale
  let s = 0
  for (let i = 0; i < v.length; i++) {
    const t = v[i] / scale
    s += t * t
  }
  return scale * Math.sqrt(s)
}

/** 外積 abᵀ */
export function outer(a: ArrayLike<number>, b: ArrayLike<number>): Matrix {
  return Array.from({ length: a.length }, (_, i) => Array.from({ length: b.length }, (_, j) => a[i] * b[j]))
}

/** Frobenius norm ‖A‖_F */
export function normFro(A: Matrix): number {
  return norm2(A.flat())
}

/** 是否（在相對容忍度 tol 內）對稱 */
export function isSymmetric(A: Matrix, tol = 1e-12): boolean {
  if (rows(A) !== cols(A)) return false
  const scale = Math.max(1e-300, normFro(A))
  for (let i = 0; i < A.length; i++) {
    for (let j = i + 1; j < A.length; j++) {
      if (Math.abs(A[i][j] - A[j][i]) > tol * scale) return false
    }
  }
  return true
}

// ───────────────────────────── LU / inv / solve / det ─────────────────────────────

export interface LuResult {
  /** 合併儲存的 L（單位下三角，不含對角）與 U */
  lu: Matrix
  /** 列置換：第 i 列來自原矩陣第 perm[i] 列 */
  perm: number[]
  /** 置換的符號 (+1 / −1) */
  sign: 1 | -1
  /** 若某主元為 0（或相對於 ‖A‖ 可忽略）則為該欄索引，否則 −1 */
  singularAt: number
}

/** LU 分解（Doolittle，partial pivoting）：PA = LU。不丟錯，奇異時以 singularAt 標示。 */
export function luDecompose(A: Matrix): LuResult {
  const n = assertSquare(A, 'luDecompose')
  const lu = clone(A)
  const perm = Array.from({ length: n }, (_, i) => i)
  let sign: 1 | -1 = 1
  let singularAt = -1
  let maxAbs = 0
  for (const r of A) for (const v of r) maxAbs = Math.max(maxAbs, Math.abs(v))
  const tiny = n * EPS * maxAbs
  for (let k = 0; k < n; k++) {
    let piv = k
    let big = Math.abs(lu[k][k])
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(lu[i][k])
      if (v > big) {
        big = v
        piv = i
      }
    }
    if (piv !== k) {
      const tmp = lu[k]
      lu[k] = lu[piv]
      lu[piv] = tmp
      const tp = perm[k]
      perm[k] = perm[piv]
      perm[piv] = tp
      sign = sign === 1 ? -1 : 1
    }
    const pivot = lu[k][k]
    if (big === 0 || big <= tiny) {
      if (singularAt < 0) singularAt = k
      if (pivot === 0) continue
    }
    for (let i = k + 1; i < n; i++) {
      const f = lu[i][k] / pivot
      lu[i][k] = f
      if (f === 0) continue
      for (let j = k + 1; j < n; j++) lu[i][j] -= f * lu[k][j]
    }
  }
  return { lu, perm, sign, singularAt }
}

function singularError(op: string, k: number): Error {
  return new Error(
    `矩陣奇異（singular）：${op} 的 LU 分解在第 ${k + 1} 欄遇到零主元（pivot ≈ 0），矩陣不可逆。` +
      '常見原因：參數方向不可辨識（λ_min = 0、缺乏 Persistent Excitation）或兩個校正參數完全耦合；可改用 pinvReg(A, λ)。',
  )
}

function luSolveVec(lu: Matrix, perm: number[], b: ArrayLike<number>): Vector {
  const n = lu.length
  const x = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    let s = b[perm[i]]
    for (let j = 0; j < i; j++) s -= lu[i][j] * x[j]
    x[i] = s
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i]
    for (let j = i + 1; j < n; j++) s -= lu[i][j] * x[j]
    x[i] = s / lu[i][i]
  }
  return x
}

/** 解 Ax = b（b 為向量）或 AX = B（B 為矩陣）。A 奇異時丟出 Error。 */
export function solve(A: Matrix, b: Vector): Vector
export function solve(A: Matrix, B: Matrix): Matrix
export function solve(A: Matrix, b: Vector | Matrix): Vector | Matrix {
  const n = assertSquare(A, 'solve')
  if (b.length !== n) throw dimError('solve', `A 為 ${n}×${n}、右手邊有 ${b.length} 列`)
  const { lu, perm, singularAt } = luDecompose(A)
  if (singularAt >= 0) throw singularError('solve', singularAt)
  if (n > 0 && Array.isArray(b[0])) {
    const B = b as Matrix
    assertRect(B, 'solve')
    const m = cols(B)
    const X = zeros(n, m)
    for (let j = 0; j < m; j++) {
      const xj = luSolveVec(
        lu,
        perm,
        B.map((r) => r[j]),
      )
      for (let i = 0; i < n; i++) X[i][j] = xj[i]
    }
    return X
  }
  return luSolveVec(lu, perm, b as Vector)
}

/** 反矩陣 A⁻¹（LU + partial pivoting）。A 奇異時丟出含「矩陣奇異（singular）」的 Error。 */
export function inv(A: Matrix): Matrix {
  const n = assertSquare(A, 'inv')
  const { lu, perm, singularAt } = luDecompose(A)
  if (singularAt >= 0) throw singularError('inv', singularAt)
  const X = zeros(n, n)
  const e = new Array<number>(n).fill(0)
  for (let j = 0; j < n; j++) {
    e.fill(0)
    e[j] = 1
    const xj = luSolveVec(lu, perm, e)
    for (let i = 0; i < n; i++) X[i][j] = xj[i]
  }
  return X
}

/** 行列式 det(A)（LU）；奇異時回傳 0 或極小值，不丟錯 */
export function det(A: Matrix): number {
  const n = assertSquare(A, 'det')
  if (n === 0) return 1
  const { lu, sign } = luDecompose(A)
  let d: number = sign
  for (let i = 0; i < n; i++) d *= lu[i][i]
  return d
}

/** Cholesky 分解 A = LLᵀ（A 對稱正定），回傳下三角 L；非正定時丟出 Error */
export function cholesky(A: Matrix): Matrix {
  const n = assertSquare(A, 'cholesky')
  const L = zeros(n, n)
  for (let j = 0; j < n; j++) {
    let s = A[j][j]
    for (let k = 0; k < j; k++) s -= L[j][k] * L[j][k]
    if (!(s > 0)) {
      throw new Error(`Cholesky 失敗：矩陣不是正定（positive definite），第 ${j + 1} 個主元 = ${s}`)
    }
    const d = Math.sqrt(s)
    L[j][j] = d
    for (let i = j + 1; i < n; i++) {
      let t = A[i][j]
      for (let k = 0; k < j; k++) t -= L[i][k] * L[j][k]
      L[i][j] = t / d
    }
  }
  return L
}

// ───────────────────────────── 對稱特徵分解（Jacobi） ─────────────────────────────

export interface EigSymResult {
  /** 特徵值，由大到小 */
  values: number[]
  /** 特徵向量矩陣：第 i 欄對應 values[i]（正交單位向量；符號正規化為「絕對值最大分量為正」） */
  vectors: Matrix
}

/**
 * 對稱矩陣特徵分解（cyclic Jacobi）。輸入若明顯不對稱（相對誤差 > 1e-8）丟出 Error；
 * 微小不對稱會先以 (A + Aᵀ)/2 對稱化。
 */
export function eigSym(A: Matrix): EigSymResult {
  const n = assertSquare(A, 'eigSym')
  if (n === 0) return { values: [], vectors: [] }
  if (!isSymmetric(A, 1e-8)) {
    throw new Error('eigSym 需要對稱矩陣（symmetric）；一般矩陣請用 eigvals(A)')
  }
  const a = zeros(n, n)
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) a[i][j] = 0.5 * (A[i][j] + A[j][i])
  const v = identity(n)
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q]
    if (off === 0) break
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p][q]
        if (apq === 0) continue
        const app = a[p][p]
        const aqq = a[q][q]
        // 相對於對角元可忽略 → 直接歸零（NR jacobi 的判斷）
        const g = 100 * Math.abs(apq)
        if (sweep > 3 && Math.abs(app) + g === Math.abs(app) && Math.abs(aqq) + g === Math.abs(aqq)) {
          a[p][q] = 0
          a[q][p] = 0
          continue
        }
        const theta = (aqq - app) / (2 * apq)
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        // A ← Jᵀ A J
        for (let k = 0; k < n; k++) {
          const akp = a[k][p]
          const akq = a[k][q]
          a[k][p] = c * akp - s * akq
          a[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k]
          const aqk = a[q][k]
          a[p][k] = c * apk - s * aqk
          a[q][k] = s * apk + c * aqk
        }
        a[p][q] = 0
        a[q][p] = 0
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p]
          const vkq = v[k][q]
          v[k][p] = c * vkp - s * vkq
          v[k][q] = s * vkp + c * vkq
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[j][j] - a[i][i])
  const values = order.map((i) => a[i][i])
  const vectors = zeros(n, n)
  order.forEach((src, dst) => {
    // 符號正規化：絕對值最大的分量（相同時取第一個）為正
    let big = 0
    for (let k = 0; k < n; k++) big = Math.max(big, Math.abs(v[k][src]))
    let sgn = 1
    for (let k = 0; k < n; k++) {
      if (Math.abs(v[k][src]) >= big * (1 - 1e-9)) {
        sgn = v[k][src] < 0 ? -1 : 1
        break
      }
    }
    for (let k = 0; k < n; k++) vectors[k][dst] = sgn * v[k][src]
  })
  return { values, vectors }
}

// ───────────────────────────── 一般實矩陣特徵值（hqr） ─────────────────────────────

/**
 * EISPACK balanc（1-indexed）：
 * 1. 置換（permutation）：把「除對角外整列為 0」的列推到底、「除對角外整欄為 0」的欄推到最左，
 *    這些特徵值可直接讀出（避免 Jordan block 經 QR 後出現 √ε 等級誤差，例如三角矩陣、純延遲鏈）。
 * 2. 對剩下的子矩陣 [low, high] 以 2 的冪次做相似縮放（無捨入誤差）。
 * 回傳 [low, high]。
 */
function balance(a: number[][], n: number): [number, number] {
  const RADIX = 2
  const sqrdx = RADIX * RADIX
  let k = 1
  let l = n
  const exchange = (j: number, m: number): void => {
    if (j === m) return
    for (let i = 1; i <= l; i++) {
      const t = a[i][j]
      a[i][j] = a[i][m]
      a[i][m] = t
    }
    for (let i = k; i <= n; i++) {
      const t = a[j][i]
      a[j][i] = a[m][i]
      a[m][i] = t
    }
  }
  // 搜尋可隔離特徵值的列，推到底部
  let found = true
  while (found) {
    found = false
    for (let j = l; j >= 1; j--) {
      let isolated = true
      for (let i = 1; i <= l; i++) {
        if (i !== j && a[j][i] !== 0) {
          isolated = false
          break
        }
      }
      if (isolated) {
        exchange(j, l)
        if (l === 1) return [1, 1]
        l--
        found = true
        break
      }
    }
  }
  // 搜尋可隔離特徵值的欄，推到左側
  found = true
  while (found) {
    found = false
    for (let j = k; j <= l; j++) {
      let isolated = true
      for (let i = k; i <= l; i++) {
        if (i !== j && a[i][j] !== 0) {
          isolated = false
          break
        }
      }
      if (isolated) {
        exchange(j, k)
        k++
        found = true
        break
      }
    }
  }
  // 對子矩陣 [k, l] 做縮放
  let noconv = true
  while (noconv) {
    noconv = false
    for (let i = k; i <= l; i++) {
      let c = 0
      let r = 0
      for (let j = k; j <= l; j++) {
        if (j === i) continue
        c += Math.abs(a[j][i])
        r += Math.abs(a[i][j])
      }
      if (c === 0 || r === 0) continue
      let g = r / RADIX
      let f = 1
      const s = c + r
      while (c < g) {
        f *= RADIX
        c *= sqrdx
      }
      g = r * RADIX
      while (c >= g) {
        f /= RADIX
        c /= sqrdx
      }
      if ((c + r) / f < 0.95 * s) {
        g = 1 / f
        noconv = true
        for (let j = k; j <= n; j++) a[i][j] *= g
        for (let j = 1; j <= l; j++) a[j][i] *= f
      }
    }
  }
  return [k, l]
}

/** EISPACK elmhes：以 Gaussian elimination（含 pivoting）把列／欄 low…high 化為上 Hessenberg（1-indexed） */
function toHessenberg(a: number[][], n: number, low: number, high: number): void {
  for (let m = low + 1; m <= high - 1; m++) {
    let x = 0
    let i = m
    for (let j = m; j <= high; j++) {
      if (Math.abs(a[j][m - 1]) > Math.abs(x)) {
        x = a[j][m - 1]
        i = j
      }
    }
    if (i !== m) {
      for (let j = m - 1; j <= n; j++) {
        const t = a[i][j]
        a[i][j] = a[m][j]
        a[m][j] = t
      }
      for (let j = 1; j <= high; j++) {
        const t = a[j][i]
        a[j][i] = a[j][m]
        a[j][m] = t
      }
    }
    if (x !== 0) {
      for (i = m + 1; i <= high; i++) {
        let y = a[i][m - 1]
        if (y !== 0) {
          y /= x
          a[i][m - 1] = y
          for (let j = m; j <= n; j++) a[i][j] -= y * a[m][j]
          for (let j = 1; j <= high; j++) a[j][m] += y * a[j][i]
        }
      }
    }
  }
  // 清除 elmhes 存放在次對角線以下的乘數（置換後區塊外的這些位置本來就是 0），留下純 Hessenberg 矩陣
  for (let i = 3; i <= n; i++) for (let j = 1; j <= i - 2; j++) a[i][j] = 0
}

const sameSign = (a: number, b: number): number => (b >= 0 ? Math.abs(a) : -Math.abs(a))

/** NR hqr：上 Hessenberg 矩陣的 Francis double-shift QR，回傳 (wr, wi)（1-indexed） */
function hqr(a: number[][], n: number, wr: number[], wi: number[]): void {
  let anorm = 0
  for (let i = 1; i <= n; i++) for (let j = Math.max(i - 1, 1); j <= n; j++) anorm += Math.abs(a[i][j])
  let nn = n
  let t = 0
  let p = 0
  let q = 0
  let r = 0
  let s = 0
  let w = 0
  let x = 0
  let y = 0
  let z = 0
  while (nn >= 1) {
    let its = 0
    let l: number
    do {
      for (l = nn; l >= 2; l--) {
        s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l])
        if (s === 0) s = anorm
        if (Math.abs(a[l][l - 1]) <= EPS * s) {
          a[l][l - 1] = 0
          break
        }
      }
      x = a[nn][nn]
      if (l === nn) {
        // 一個實特徵值收斂
        wr[nn] = x + t
        wi[nn] = 0
        nn--
      } else {
        y = a[nn - 1][nn - 1]
        w = a[nn][nn - 1] * a[nn - 1][nn]
        if (l === nn - 1) {
          // 2×2 區塊收斂：一對實根或共軛複根
          p = 0.5 * (y - x)
          q = p * p + w
          z = Math.sqrt(Math.abs(q))
          x += t
          if (q >= 0) {
            z = p + sameSign(z, p)
            wr[nn - 1] = wr[nn] = x + z
            if (z !== 0) wr[nn] = x - w / z
            wi[nn - 1] = wi[nn] = 0
          } else {
            wr[nn - 1] = wr[nn] = x + p
            wi[nn - 1] = -z
            wi[nn] = z
          }
          nn -= 2
        } else {
          if (its === 60) {
            throw new Error('eigvals：QR 迭代未收斂（hqr 超過 60 次迭代），矩陣可能含 NaN/Inf 或病態')
          }
          if (its === 10 || its === 20 || its === 40) {
            // exceptional shift
            t += x
            for (let i = 1; i <= nn; i++) a[i][i] -= x
            s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2])
            y = x = 0.75 * s
            w = -0.4375 * s * s
          }
          ++its
          let m: number
          for (m = nn - 2; m >= l; m--) {
            z = a[m][m]
            r = x - z
            s = y - z
            p = (r * s - w) / a[m + 1][m] + a[m][m + 1]
            q = a[m + 1][m + 1] - z - r - s
            r = a[m + 2][m + 1]
            s = Math.abs(p) + Math.abs(q) + Math.abs(r)
            p /= s
            q /= s
            r /= s
            if (m === l) break
            const u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(r))
            const v = Math.abs(p) * (Math.abs(a[m - 1][m - 1]) + Math.abs(z) + Math.abs(a[m + 1][m + 1]))
            if (u <= EPS * v) break
          }
          for (let i = m + 2; i <= nn; i++) {
            a[i][i - 2] = 0
            if (i !== m + 2) a[i][i - 3] = 0
          }
          for (let k = m; k <= nn - 1; k++) {
            if (k !== m) {
              p = a[k][k - 1]
              q = a[k + 1][k - 1]
              r = 0
              if (k !== nn - 1) r = a[k + 2][k - 1]
              x = Math.abs(p) + Math.abs(q) + Math.abs(r)
              if (x !== 0) {
                p /= x
                q /= x
                r /= x
              }
            }
            s = sameSign(Math.sqrt(p * p + q * q + r * r), p)
            if (s !== 0) {
              if (k === m) {
                if (l !== m) a[k][k - 1] = -a[k][k - 1]
              } else {
                a[k][k - 1] = -s * x
              }
              p += s
              x = p / s
              y = q / s
              z = r / s
              q /= p
              r /= p
              for (let j = k; j <= nn; j++) {
                p = a[k][j] + q * a[k + 1][j]
                if (k !== nn - 1) {
                  p += r * a[k + 2][j]
                  a[k + 2][j] -= p * z
                }
                a[k + 1][j] -= p * y
                a[k][j] -= p * x
              }
              const mmin = nn < k + 3 ? nn : k + 3
              for (let i = l; i <= mmin; i++) {
                p = x * a[i][k] + y * a[i][k + 1]
                if (k !== nn - 1) {
                  p += z * a[i][k + 2]
                  a[i][k + 2] -= p * r
                }
                a[i][k + 1] -= p * q
                a[i][k] -= p
              }
            }
          }
        }
      }
    } while (l < nn - 1)
  }
}

/** 特徵值／根的排序：|z| 由大到小；相同模數時實部大者先、再虛部大者先（共軛對 +j 在前） */
export function sortByModulusDesc(zs: Complex[]): Complex[] {
  const key = (u: Complex): number => Math.hypot(u.re, u.im)
  return zs.slice().sort((u, v) => {
    const du = key(v) - key(u)
    if (Math.abs(du) > 1e-14 * Math.max(key(u), key(v))) return du
    if (u.re !== v.re) return v.re - u.re
    return v.im - u.im
  })
}

/**
 * 一般實方陣的全部特徵值（Complex[]，依 |λ| 由大到小）。
 * 流程：balance（置換隔離 + 縮放）→ elmhes（Hessenberg）→ hqr（Francis double-shift QR）。
 * 複數特徵值以精確共軛對出現。
 */
export function eigvals(A: Matrix): Complex[] {
  const n = assertSquare(A, 'eigvals')
  if (n === 0) return []
  for (const r of A) {
    for (const v of r) {
      if (!Number.isFinite(v)) throw new Error('eigvals：矩陣含 NaN 或 Inf，無法計算特徵值')
    }
  }
  if (n === 1) return [{ re: A[0][0], im: 0 }]
  // 1-indexed 工作陣列（與 Numerical Recipes 相同索引，降低移植錯誤）
  const a: number[][] = Array.from({ length: n + 1 }, (_, i) =>
    i === 0 ? new Array<number>(n + 1).fill(0) : [0, ...A[i - 1]],
  )
  const [low, high] = balance(a, n)
  toHessenberg(a, n, low, high)
  const wr = new Array<number>(n + 1).fill(0)
  const wi = new Array<number>(n + 1).fill(0)
  hqr(a, n, wr, wi)
  const out: Complex[] = []
  for (let i = 1; i <= n; i++) out.push({ re: wr[i], im: wi[i] })
  return sortByModulusDesc(out)
}

/** 譜半徑 ρ(A) = max |λ_i|（離散時間系統穩定 ⇔ ρ(A) < 1） */
export function spectralRadius(A: Matrix): number {
  const ev = eigvals(A)
  let r = 0
  for (const z of ev) r = Math.max(r, Math.hypot(z.re, z.im))
  return r
}

// ───────────────────────────── SVD（one-sided Jacobi） ─────────────────────────────

export interface SvdResult {
  /** m×k，正交單位欄（k = min(m, n)） */
  U: Matrix
  /** k 個奇異值，由大到小，皆 ≥ 0 */
  S: number[]
  /** n×k，正交單位欄；A = U diag(S) Vᵀ */
  V: Matrix
}

/** 以標準基底補齊正交單位欄（Gram–Schmidt，做兩次以確保正交） */
function completeOrthonormal(Q: Matrix, filled: boolean[]): void {
  const m = Q.length
  const k = filled.length
  for (let j = 0; j < k; j++) {
    if (filled[j]) continue
    let best: number[] | null = null
    let bestNorm = -1
    for (let e = 0; e < m; e++) {
      const v = new Array<number>(m).fill(0)
      v[e] = 1
      for (let pass = 0; pass < 2; pass++) {
        for (let c = 0; c < k; c++) {
          if (!filled[c]) continue
          let d = 0
          for (let i = 0; i < m; i++) d += Q[i][c] * v[i]
          for (let i = 0; i < m; i++) v[i] -= d * Q[i][c]
        }
      }
      const nv = norm2(v)
      if (nv > bestNorm) {
        bestNorm = nv
        best = v
      }
      if (nv > 0.7) break
    }
    if (best && bestNorm > 0) {
      for (let i = 0; i < m; i++) Q[i][j] = best[i] / bestNorm
      filled[j] = true
    }
  }
}

function svdTall(A: Matrix): SvdResult {
  const m = rows(A)
  const n = cols(A)
  const U = clone(A)
  const V = identity(n)
  for (let sweep = 0; sweep < 75; sweep++) {
    let rotated = false
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        let alpha = 0
        let beta = 0
        let gamma = 0
        for (let i = 0; i < m; i++) {
          const up = U[i][p]
          const uq = U[i][q]
          alpha += up * up
          beta += uq * uq
          gamma += up * uq
        }
        if (gamma === 0 || Math.abs(gamma) <= EPS * Math.sqrt(alpha * beta)) continue
        rotated = true
        const zeta = (beta - alpha) / (2 * gamma)
        const t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta))
        const c = 1 / Math.sqrt(1 + t * t)
        const s = c * t
        for (let i = 0; i < m; i++) {
          const up = U[i][p]
          const uq = U[i][q]
          U[i][p] = c * up - s * uq
          U[i][q] = s * up + c * uq
        }
        for (let i = 0; i < n; i++) {
          const vp = V[i][p]
          const vq = V[i][q]
          V[i][p] = c * vp - s * vq
          V[i][q] = s * vp + c * vq
        }
      }
    }
    if (!rotated) break
  }
  const sv = Array.from({ length: n }, (_, j) => norm2(U.map((r) => r[j])))
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => sv[j] - sv[i])
  const S = order.map((j) => sv[j])
  const smax = S[0] ?? 0
  const tol = Math.max(m, n) * EPS * smax
  const Uo = zeros(m, n)
  const Vo = zeros(n, n)
  const filled = new Array<boolean>(n).fill(false)
  order.forEach((src, dst) => {
    for (let i = 0; i < n; i++) Vo[i][dst] = V[i][src]
    if (S[dst] > tol && S[dst] > 0) {
      for (let i = 0; i < m; i++) Uo[i][dst] = U[i][src] / S[dst]
      filled[dst] = true
    }
  })
  completeOrthonormal(Uo, filled)
  return { U: Uo, S, V: Vo }
}

/**
 * 奇異值分解（thin SVD）A = U diag(S) Vᵀ，S 由大到小。
 * 使用 one-sided Jacobi，對小奇異值有高相對精度；秩不足時 U 以正交補齊（S 對應值為 0 或極小）。
 * 奇異向量的符號不唯一。
 */
export function svd(A: Matrix): SvdResult {
  assertRect(A, 'svd')
  const m = rows(A)
  const n = cols(A)
  if (m === 0 || n === 0) return { U: zeros(m, 0), S: [], V: zeros(n, 0) }
  if (m >= n) return svdTall(A)
  const r = svdTall(transpose(A))
  return { U: r.V, S: r.S, V: r.U }
}

/** 2-norm 條件數 κ(A) = σ_max/σ_min；σ_min = 0 時回傳 Infinity */
export function cond(A: Matrix): number {
  const { S } = svd(A)
  if (S.length === 0) return NaN
  const smin = S[S.length - 1]
  if (smin === 0) return Infinity
  return S[0] / smin
}

/** 矩陣秩：σ_i > tol 的個數（預設 tol = max(m,n)·ε·σ_max） */
export function rank(A: Matrix, tol?: number): number {
  const { S } = svd(A)
  if (S.length === 0) return 0
  const t = tol ?? Math.max(rows(A), cols(A)) * EPS * S[0]
  return S.filter((s) => s > t).length
}

/**
 * Regularized pseudoinverse (AᵀA + λI)⁻¹Aᵀ（Tikhonov / ridge），以 SVD 計算：
 * V diag(σ/(σ² + λ)) Uᵀ。λ > 0 時與定義式完全相同但數值更穩定；
 * λ = 0 時退化為 Moore–Penrose pinv（σ ≤ max(m,n)·ε·σ_max 的方向捨棄）。
 */
export function pinvReg(A: Matrix, lambda: number): Matrix {
  if (!(lambda >= 0)) throw new Error(`pinvReg：λ 必須 ≥ 0，收到 ${lambda}`)
  const { U, S, V } = svd(A)
  const m = rows(A)
  const n = cols(A)
  const tol = Math.max(m, n) * EPS * (S[0] ?? 0)
  const g = S.map((s) => {
    if (lambda === 0) return s > tol ? 1 / s : 0
    return s / (s * s + lambda)
  })
  const P = zeros(n, m)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      let acc = 0
      for (let k = 0; k < S.length; k++) acc += V[i][k] * g[k] * U[j][k]
      P[i][j] = acc
    }
  }
  return P
}

/** Moore–Penrose pseudoinverse A⁺ */
export function pinv(A: Matrix): Matrix {
  return pinvReg(A, 0)
}
