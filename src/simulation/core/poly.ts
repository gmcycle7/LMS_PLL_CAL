/**
 * 實係數多項式工具。係數一律為「降冪」：p = [a₀, a₁, …, a_N] 代表 a₀ zᴺ + a₁ zᴺ⁻¹ + … + a_N
 * （與 NumPy polyval / roots 相同）。
 */
import { c, cAbs, cDiv, type Complex } from '@/simulation/core/complex'
import { eigvals, sortByModulusDesc } from '@/simulation/core/linalg'

/** Horner 法求 p(x)（實數） */
export function polyval(p: ArrayLike<number>, x: number): number {
  let y = 0
  for (let i = 0; i < p.length; i++) y = y * x + p[i]
  return y
}

/** Horner 法求 p(z)（複數 z） */
export function polyvalC(p: ArrayLike<number>, z: Complex): Complex {
  let re = 0
  let im = 0
  for (let i = 0; i < p.length; i++) {
    const nr = re * z.re - im * z.im + p[i]
    im = re * z.im + im * z.re
    re = nr
  }
  return { re, im }
}

/** 去除前導零（leading zeros）；全為零時回傳 [] */
export function polyTrim(p: ArrayLike<number>): number[] {
  let i = 0
  while (i < p.length && p[i] === 0) i++
  return Array.from(p).slice(i)
}

/** 導數 p'(z) 的係數 */
export function polyDer(p: ArrayLike<number>): number[] {
  const q = polyTrim(p)
  const n = q.length - 1
  if (n <= 0) return [0]
  return q.slice(0, n).map((a, i) => a * (n - i))
}

/** 多項式乘法（卷積） */
export function polyMul(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  if (a.length === 0 || b.length === 0) return []
  const out = new Array<number>(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j]
  return out
}

/** 多項式加法（以常數項對齊） */
export function polyAdd(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const n = Math.max(a.length, b.length)
  const out = new Array<number>(n).fill(0)
  for (let i = 0; i < a.length; i++) out[n - a.length + i] += a[i]
  for (let i = 0; i < b.length; i++) out[n - b.length + i] += b[i]
  return out
}

/** 由根建立首一（monic）多項式；複根需以共軛對提供，回傳實係數（虛部捨去） */
export function polyFromRoots(roots: Complex[]): number[] {
  let re = [1]
  let im = [0]
  for (const r of roots) {
    // (z − r) 乘上目前多項式（複數係數）
    const nre = new Array<number>(re.length + 1).fill(0)
    const nim = new Array<number>(re.length + 1).fill(0)
    for (let i = 0; i < re.length; i++) {
      nre[i] += re[i]
      nim[i] += im[i]
      nre[i + 1] -= re[i] * r.re - im[i] * r.im
      nim[i + 1] -= re[i] * r.im + im[i] * r.re
    }
    re = nre
    im = nim
  }
  return re
}

/** 以 Newton 法在原多項式上修正一個根（只在殘差下降時採用） */
function polishRoot(p: number[], dp: number[], z0: Complex, iters = 4): Complex {
  let z = z0
  let fz = polyvalC(p, z)
  let res = cAbs(fz)
  for (let k = 0; k < iters; k++) {
    if (res === 0) break
    const d = polyvalC(dp, z)
    if (d.re === 0 && d.im === 0) break
    const step = cDiv(fz, d)
    const zn = { re: z.re - step.re, im: z.im - step.im }
    const fn = polyvalC(p, zn)
    const rn = cAbs(fn)
    if (!(rn < res)) break
    z = zn
    fz = fn
    res = rn
  }
  return z
}

/** 數值穩定的二次方程式根 a z² + b z + c = 0（a ≠ 0） */
function quadRoots(a: number, b: number, cc: number): Complex[] {
  const disc = b * b - 4 * a * cc
  if (disc >= 0) {
    const sq = Math.sqrt(disc)
    // 避免 b 與 ±sq 抵消：q = −(b + sign(b)·sq)/2
    const q = -0.5 * (b + (b >= 0 ? sq : -sq))
    if (q === 0) return [c(0), c(0)]
    return [c(q / a), c(cc / q)]
  }
  const re = -b / (2 * a)
  const im = Math.sqrt(-disc) / (2 * Math.abs(a))
  return [c(re, im), c(re, -im)]
}

/**
 * 多項式所有根（Complex[]，依 |z| 由大到小；共軛對 +j 在前）。
 * - 先去除前導零（leading zeros）；尾端零係數對應 z = 0 的根（精確）。
 * - 一次、二次用封閉式（二次用避免抵消的公式）；三次以上用 companion matrix 的特徵值
 *   （balance + Hessenberg QR），再以 Newton 法在原多項式上 polish。
 * - 重根（repeated roots）本質上是病態問題：m 重根的誤差約 ε^{1/m}（例如三重根 ~1e-5）。
 * 全零或常數多項式回傳 []。
 */
export function polyRoots(p: ArrayLike<number>): Complex[] {
  for (let i = 0; i < p.length; i++) {
    if (!Number.isFinite(p[i])) throw new Error('polyRoots：係數含 NaN 或 Inf')
  }
  let q = polyTrim(p)
  if (q.length <= 1) return []
  // 尾端零 → z = 0 的根
  let nZero = 0
  while (q.length > 1 && q[q.length - 1] === 0) {
    q = q.slice(0, -1)
    nZero++
  }
  const zerosOut: Complex[] = Array.from({ length: nZero }, () => c(0))
  const deg = q.length - 1
  let roots: Complex[]
  if (deg === 0) {
    roots = []
  } else if (deg === 1) {
    roots = [c(-q[1] / q[0])]
  } else if (deg === 2) {
    roots = quadRoots(q[0], q[1], q[2])
  } else {
    // companion matrix（首一化）：第一列為 −a_k/a_0，次對角線為 1
    const n = deg
    const C: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
    for (let j = 0; j < n; j++) C[0][j] = -q[j + 1] / q[0]
    for (let i = 1; i < n; i++) C[i][i - 1] = 1
    const ev = eigvals(C)
    const dq = polyDer(q)
    roots = []
    for (const z of ev) {
      if (z.im < 0) continue // 共軛對由 +j 的那個產生
      if (z.im === 0) {
        const zr = polishRoot(q, dq, z)
        roots.push(c(zr.re, 0))
      } else {
        const zp = polishRoot(q, dq, z)
        if (zp.im === 0) {
          // polish 落到實軸（近似重實根）：保留原共軛對結構
          roots.push(z, c(z.re, -z.im))
        } else {
          const im = Math.abs(zp.im)
          roots.push(c(zp.re, im), c(zp.re, -im))
        }
      }
    }
  }
  return sortByModulusDesc([...roots, ...zerosOut])
}

/** 多項式 p 在根 z 的殘差 |p(z)|（驗證用） */
export function polyResidual(p: ArrayLike<number>, z: Complex): number {
  return cAbs(polyvalC(p, z))
}

/** 以 Horner 法求有理函數 b(z)/a(z) 的值 */
export function ratvalC(b: ArrayLike<number>, a: ArrayLike<number>, z: Complex): Complex {
  return cDiv(polyvalC(b, z), polyvalC(a, z))
}
