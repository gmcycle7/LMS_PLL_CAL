import { describe, expect, it } from 'vitest'
import type { Complex } from '@/simulation/core/complex'
import {
  cholesky,
  cond,
  det,
  diag,
  eigSym,
  eigvals,
  identity,
  inv,
  isSymmetric,
  luDecompose,
  matAdd,
  matMul,
  matScale,
  matSub,
  matVec,
  normFro,
  pinv,
  pinvReg,
  rank,
  solve,
  spectralRadius,
  svd,
  trace,
  transpose,
  zeros,
  type Matrix,
} from '@/simulation/core/linalg'

const maxAbsDiff = (A: Matrix, B: Matrix): number => {
  let m = 0
  for (let i = 0; i < A.length; i++) for (let j = 0; j < A[i].length; j++) m = Math.max(m, Math.abs(A[i][j] - B[i][j]))
  return m
}
const expectEigClose = (got: Complex[], ref: Complex[], tol: number): void => {
  expect(got.length).toBe(ref.length)
  got.forEach((z, i) => {
    expect(Math.abs(z.re - ref[i].re)).toBeLessThan(tol)
    expect(Math.abs(z.im - ref[i].im)).toBeLessThan(tol)
  })
}
const expectOrthonormalCols = (Q: Matrix, tol = 1e-13): void => {
  const k = Q[0].length
  expect(maxAbsDiff(matMul(transpose(Q), Q), identity(k))).toBeLessThan(tol)
}

// ───── 參考值：NumPy 2.x / mpmath（40 位數）獨立計算 ─────
// A：rng = np.random.default_rng(20261010)，round(standard_normal((5,5)), 6)
const A: Matrix = [
  [0.98854, 0.745275, 0.296697, -0.418775, -0.994885],
  [-1.257145, 3.188753, 0.071048, -0.64173, -1.916456],
  [1.293728, -0.68505, 0.132002, -1.057941, 0.565295],
  [0.213066, 0.468357, 2.428851, -3.505957, 0.506775],
  [-0.381434, -0.62562, -0.799018, -0.414837, -1.285796],
]
const EIG_A: Complex[] = [
  { re: 2.925632526063866, im: 0 },
  { re: -2.1284167437426467, im: 0 },
  { re: 1.701273242918094, im: 0 },
  { re: -1.4904735126196562, im: 0.5514434433418757 },
  { re: -1.4904735126196562, im: -0.5514434433418757 },
]
const SV_A = [4.606947510744321, 4.137428297361266, 1.7653329764489607, 1.4795740154782482, 0.537413050847651]
const INV_A: Matrix = [
  [0.4505393984872148, -0.04474927119363696, 0.3544204809821575, -0.1315202112331399, -0.1779239548420945],
  [-0.1297759871369985, 0.3783905538158019, 0.3865701074188308, -0.129622176101797, -0.3447045982889073],
  [0.6768935157001726, -0.47236101587018836, -1.080029950589142, 0.35003881380565693, -0.1565697150938219],
  [0.38980885377389946, -0.2500169495453544, -0.5927695808519258, -0.08094921787695701, -0.22148242685950068],
  [-0.6169079935313588, 0.203361521351244, 0.5691665811103692, -0.08931904918714746, -0.3884741726535969],
]
const B_VEC = [0.831254, 1.139767, -0.130282, 1.250148, -0.136015]
const X_A = [0.1371149231513759, 0.1578752229316128, 0.6238935593471695, 0.04522273639391262, -0.413998362778929]

describe('linalg：規格 T09 / T10 / T18 參考值', () => {
  it('T10: R = [[1,.99],[.99,1]] → eigenvalues 1.99、0.01；condition number 199', () => {
    const R = [
      [1, 0.99],
      [0.99, 1],
    ]
    const { values, vectors } = eigSym(R)
    expect(values[0]).toBeCloseTo(1.99, 14)
    expect(values[1]).toBeCloseTo(0.01, 14)
    expect(cond(R)).toBeCloseTo(199, 10)
    // 特徵向量：[1,1]/√2（快模式）與 [1,−1]/√2（慢模式，λ_min）
    expect(Math.abs(vectors[0][0])).toBeCloseTo(Math.SQRT1_2, 14)
    expect(vectors[0][0] * vectors[1][0]).toBeCloseTo(0.5, 14)
    expect(vectors[0][1] * vectors[1][1]).toBeCloseTo(-0.5, 14)
    expectOrthonormalCols(vectors)
    // R⁻¹ 元素約 ±25（規格 §10：Preconditioner 放大雜訊）
    const Ri = inv(R)
    expect(Ri[0][0]).toBeCloseTo(1 / (1 - 0.99 * 0.99), 10)
    expect(Ri[0][1]).toBeCloseTo(-0.99 / (1 - 0.99 * 0.99), 10)
  })

  it('T18: J = [[−1,2],[2,−1]] 的特徵值 1、−3；I + 0.2J 的特徵值 1.2、0.4（含發散模式判斷）', () => {
    const J = [
      [-1, 2],
      [2, -1],
    ]
    expect(eigSym(J).values[0]).toBeCloseTo(1, 14)
    expect(eigSym(J).values[1]).toBeCloseTo(-3, 14)
    expectEigClose(eigvals(J), [c2(-3), c2(1)], 1e-14)
    const A18 = matAdd(identity(2), matScale(J, 0.2))
    const ev = eigvals(A18)
    expectEigClose(ev, [c2(1.2), c2(0.4)], 1e-14)
    expect(spectralRadius(A18)).toBeCloseTo(1.2, 14)
    expect(spectralRadius(A18) > 1).toBe(true) // 發散模式
  })

  it('T09: 雙迴路 [[r,b],[−μc,1]]，r=.8,b=.2,c=1,μ=1.2 → 極點 0.9 ± j0.4796，|z| = √1.04 ≈ 1.01980 > 1', () => {
    const M = [
      [0.8, 0.2],
      [-1.2, 1],
    ]
    const ev = eigvals(M)
    // NumPy/mpmath：√0.92/2 = 0.47958315233127197，√1.04 = 1.019803902718557
    expectEigClose(ev, [{ re: 0.9, im: 0.47958315233127197 }, { re: 0.9, im: -0.47958315233127197 }], 1e-14)
    expect(Math.abs(spectralRadius(M) - 1.019803902718557)).toBeLessThan(1e-14)
    expect(spectralRadius(M) > 1).toBe(true)
    // μ = 0.9 < 1（完整模型的穩定範圍 0 < μ < 1）→ |z| = √0.98 < 1
    const M2 = [
      [0.8, 0.2],
      [-0.9, 1],
    ]
    expect(Math.abs(spectralRadius(M2) - Math.sqrt(0.98))).toBeLessThan(1e-14)
  })
})

function c2(re: number, im = 0): Complex {
  return { re, im }
}

describe('linalg：隨機 5×5 矩陣對照 NumPy / mpmath', () => {
  it('eigvals（Hessenberg + Francis QR）', () => {
    expectEigClose(eigvals(A), EIG_A, 1e-12)
    // 共軛對完全對稱
    const ev = eigvals(A)
    expect(ev[3].re).toBe(ev[4].re)
    expect(ev[3].im).toBe(-ev[4].im)
    expect(Math.abs(spectralRadius(A) - 2.925632526063866)).toBeLessThan(1e-12)
  })

  it('6×6 整數矩陣（兩對以上複根）', () => {
    const F = [
      [-4, 2, 3, 3, 3, -3],
      [0, 0, -3, 0, 2, 2],
      [2, 4, -1, 3, 0, 1],
      [2, -2, -3, 0, -1, 2],
      [-5, -3, -5, -3, 1, -1],
      [-1, 2, -5, 2, 1, 2],
    ]
    expectEigClose(
      eigvals(F),
      [
        { re: 1.548206750546956, im: 5.796408468808823 },
        { re: 1.548206750546956, im: -5.796408468808823 },
        c2(-5.182954200378183),
        c2(-2.9407309030687445),
        c2(1.9071550668999975),
        c2(1.1201165354530178),
      ],
      1e-12,
    )
  })

  it('svd、cond、det、inv、solve', () => {
    const { U, S, V } = svd(A)
    S.forEach((s, i) => expect(Math.abs(s - SV_A[i]) / SV_A[i]).toBeLessThan(1e-13))
    expectOrthonormalCols(U)
    expectOrthonormalCols(V)
    expect(maxAbsDiff(matMul(matMul(U, diag(S)), transpose(V)), A)).toBeLessThan(1e-13)
    expect(Math.abs(cond(A) - 8.572451866358426) / 8.572451866358426).toBeLessThan(1e-12)
    expect(Math.abs(det(A) - -26.755636246956087) / 26.755636246956087).toBeLessThan(1e-13)
    expect(maxAbsDiff(inv(A), INV_A)).toBeLessThan(1e-13)
    const x = solve(A, B_VEC)
    x.forEach((v, i) => expect(Math.abs(v - X_A[i])).toBeLessThan(1e-13))
    // 矩陣右手邊
    const X = solve(A, identity(5))
    expect(maxAbsDiff(X, INV_A)).toBeLessThan(1e-13)
    expect(maxAbsDiff(matMul(A, inv(A)), identity(5))).toBeLessThan(1e-13)
  })

  it('eigSym：5×5 對稱矩陣（mpmath eigsy），特徵值由大到小、特徵向量正交', () => {
    const S: Matrix = [
      [0.295216, -1.881418, 1.864327, -0.602415, -1.677197],
      [-1.881418, 2.979212, 0.069387, 2.996241, 0.134921],
      [1.864327, 0.069387, -2.276152, 3.203609, 1.116502],
      [-0.602415, 2.996241, 3.203609, 2.184502, 0.291657],
      [-1.677197, 0.134921, 1.116502, 0.291657, 2.393382],
    ]
    const ref = [6.663585273637964, 3.05952964899264, 2.3025898660297774, -1.442516740736259, -5.0070280479241225]
    const { values, vectors } = eigSym(S)
    values.forEach((v, i) => expect(Math.abs(v - ref[i])).toBeLessThan(1e-13))
    expectOrthonormalCols(vectors)
    // A V = V Λ
    expect(maxAbsDiff(matMul(S, vectors), matMul(vectors, diag(values)))).toBeLessThan(1e-13)
    expect(trace(S)).toBeCloseTo(
      ref.reduce((a, b) => a + b, 0),
      12,
    )
    expect(() => eigSym(A)).toThrow(/對稱/)
  })
})

describe('linalg：pinvReg / 秩不足 / 非方陣', () => {
  const C: Matrix = [
    [0.071364, 0.631004, 1.550564],
    [1.634246, 1.273808, 0.9622],
    [-1.537762, 0.1634, -1.202998],
    [0.124978, -1.285527, -0.168448],
  ]

  it('pinvReg(C, 0.1) = (CᵀC + 0.1 I)⁻¹Cᵀ（NumPy solve）與 pinv(C)', () => {
    const ref = [
      [-0.39276455859640325, 0.34462532162964193, -0.26840322094980856, 0.11328250170134486],
      [-0.008529091554558168, 0.28488764260081806, 0.26567812735785623, -0.4380963729938283],
      [0.6011267901186736, -0.17973667640622562, -0.17352344068244285, 0.08317948451393671],
    ]
    expect(maxAbsDiff(pinvReg(C, 0.1), ref)).toBeLessThan(1e-13)
    // 與定義式一致
    const Ct = transpose(C)
    const direct = matMul(inv(matAdd(matMul(Ct, C), matScale(identity(3), 0.1))), Ct)
    expect(maxAbsDiff(pinvReg(C, 0.1), direct)).toBeLessThan(1e-13)
    const refPinv = [
      [-0.4258404605519409, 0.3632711550422215, -0.27456351515634764, 0.11603567339725879],
      [-0.0181569393097052, 0.29804449886972845, 0.27883907139034053, -0.45603346335841105],
      [0.6422633038044225, -0.20319221044471297, -0.1787231318681572, 0.09119955536086763],
    ]
    expect(maxAbsDiff(pinv(C), refPinv)).toBeLessThan(1e-13)
    const sv = svd(C).S
    const svRef = [3.119239367837126, 1.594259455781777, 1.1360261455347038]
    svRef.forEach((s, i) => expect(Math.abs(sv[i] - s)).toBeLessThan(1e-13))
  })

  it('秩不足：第三欄 = 第一欄 + 2×第二欄 → σ_min ≈ 0、U/V 仍正交', () => {
    const D = C.map((r) => [r[0], r[1], r[0] + 2 * r[1]])
    const { U, S, V } = svd(D)
    expect(Math.abs(S[0] - 5.706736641401509)).toBeLessThan(1e-13)
    expect(Math.abs(S[1] - 1.7043886649125672)).toBeLessThan(1e-13)
    expect(S[2]).toBeLessThan(1e-14)
    expectOrthonormalCols(U)
    expectOrthonormalCols(V)
    expect(maxAbsDiff(matMul(matMul(U, diag(S)), transpose(V)), D)).toBeLessThan(1e-13)
    expect(rank(D)).toBe(2)
    const refPinvD = [
      [-0.10809414191581114, 0.12722125795720363, -0.38873480228563584, 0.2828891862017409],
      [0.08215447542310063, -0.004740537704551339, 0.19942181116217117, -0.19832064330964286],
      [0.05621480893039016, 0.11774018254810097, 0.010108820038706563, -0.11375210041754484],
    ]
    expect(maxAbsDiff(pinv(D), refPinvD)).toBeLessThan(1e-12)
  })

  it('完全奇異：cond = ∞、inv/solve 丟出「矩陣奇異（singular）」、det = 0', () => {
    const Z = [
      [1, 1],
      [1, 1],
    ]
    expect(cond(Z)).toBe(Infinity)
    expect(det(Z)).toBe(0)
    expect(() => inv(Z)).toThrow(/矩陣奇異（singular）/)
    expect(() => solve(Z, [1, 2])).toThrow(/矩陣奇異（singular）/)
    expect(luDecompose(Z).singularAt).toBe(1)
    // ρ = 1：R 的一個特徵值為 0（不可辨識方向）
    const R1 = [
      [1, 1],
      [1, 1],
    ]
    const e = eigSym(R1)
    expect(e.values[0]).toBeCloseTo(2, 14)
    expect(Math.abs(e.values[1])).toBeLessThan(1e-15)
    // 零矩陣的 SVD
    const z = svd(zeros(3, 2))
    expect(z.S).toEqual([0, 0])
    expectOrthonormalCols(z.U)
  })

  it('寬矩陣 2×4 的 thin SVD', () => {
    const W = [
      [0.932884, 0.052206, 0.839055, -0.871704],
      [0.888406, 0.001509, -0.718636, -0.161235],
    ]
    const { U, S, V } = svd(W)
    expect(U.length).toBe(2)
    expect(V.length).toBe(4)
    expect(V[0].length).toBe(2)
    expect(Math.abs(S[0] - 1.5672516796011369)).toBeLessThan(1e-13)
    expect(Math.abs(S[1] - 1.1010464463220504)).toBeLessThan(1e-13)
    expect(maxAbsDiff(matMul(matMul(U, diag(S)), transpose(V)), W)).toBeLessThan(1e-13)
  })
})

describe('linalg：基本運算與錯誤處理', () => {
  it('matMul / matVec / transpose / trace / det', () => {
    const P = [
      [1, 2, 3],
      [4, 5, 6],
    ]
    const Q = [
      [7, 8],
      [9, 10],
      [11, 12],
    ]
    expect(matMul(P, Q)).toEqual([
      [58, 64],
      [139, 154],
    ])
    expect(matVec(P, [1, 0, -1])).toEqual([-2, -2])
    expect(transpose(P)).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ])
    expect(matSub(P, P)).toEqual(zeros(2, 3))
    expect(trace(identity(4))).toBe(4)
    expect(det([[2, 0, 0], [0, 3, 0], [0, 0, 4]])).toBe(24)
    expect(det([[0, 1], [1, 0]])).toBe(-1)
    expect(normFro([[3, 4]])).toBe(5)
    expect(isSymmetric([[1, 2], [2, 1]])).toBe(true)
    expect(() => matMul(P, P)).toThrow(/維度不符/)
    expect(() => inv(P)).toThrow(/方陣/)
  })

  it('eigvals：旋轉矩陣的純虛根、上三角矩陣、1×1', () => {
    const E = [
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 2],
    ]
    expectEigClose(eigvals(E), [c2(2), c2(0, 1), c2(0, -1)], 1e-15)
    expectEigClose(eigvals([[3, 1, 4], [0, -5, 9], [0, 0, 2]]), [c2(-5), c2(3), c2(2)], 1e-14)
    expect(eigvals([[7]])).toEqual([c2(7)])
    expect(() => eigvals([[NaN, 0], [0, 1]])).toThrow(/NaN/)
  })

  it('eigvals：置換平衡隔離 Jordan block（三角矩陣、純延遲鏈）→ 特徵值精確', () => {
    // 下三角、0 為二重且 defective：若未經置換直接做 QR 會出現 ~√ε ≈ 3e-9 的誤差
    const T = [
      [0, 0, 0],
      [-0.701, 0, 0],
      [-0.178, 0, -1.606],
    ]
    expect(eigvals(T)).toEqual([c2(-1.606), c2(0), c2(0)])
    // 4 級純延遲（shift matrix，nilpotent）：全部特徵值為 0
    const Sh = [
      [0, 0, 0, 0],
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
    ]
    for (const z of eigvals(Sh)) {
      expect(z.re).toBe(0)
      expect(z.im).toBe(0)
    }
    // 延遲 d = 2 的 companion 形式 δ_{k+1} = δ_k − g δ_{k−2}，g = 0.618（mpmath：|z|max = 0.9999840462509538）
    const g = 0.618
    const Cd = [
      [1, 0, -g],
      [1, 0, 0],
      [0, 1, 0],
    ]
    expect(Math.abs(spectralRadius(Cd) - 0.9999840462509538)).toBeLessThan(1e-14)
  })

  it('cholesky：LLᵀ = A；非正定丟錯', () => {
    const Sp = [
      [4, 2, 0.4],
      [2, 5, 1],
      [0.4, 1, 3],
    ]
    const L = cholesky(Sp)
    expect(maxAbsDiff(matMul(L, transpose(L)), Sp)).toBeLessThan(1e-15)
    expect(L[0][1]).toBe(0)
    expect(() => cholesky([[1, 2], [2, 1]])).toThrow(/正定/)
  })
})
