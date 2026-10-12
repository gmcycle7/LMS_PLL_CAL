import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cond, createRng, eigSym, matScale, matVec, svd, type Matrix } from '@/simulation/core'
import {
  KQ_SIGMA100,
  bussgangMeanG,
  comparatorKq,
  corr2,
  drawPm1Pair,
  eig2x2,
  eigenModes,
  gaugeAnalysis,
  gaugeDriftStd,
  gaugeNullVector,
  gaugeRegressorsRaw,
  lmsHandSteps,
  meanFieldTrajectory,
  meanSquareDiagGaussian,
  meanSquareMap,
  meanSquareRadius,
  meanSquareTrajectory,
  meanTrajectory,
  modalCoords,
  optimalScalarGain,
  peAnalytic,
  pm1DegenerateProb,
  pm1WindowLminStats,
  runPeChain,
  signJitterSteadyState,
  simulatePeLab,
  slidingWindowPe,
  stepsToDecay,
  stepsToDecayReal,
  type GaugeParams,
} from './pe'

interface Vector {
  expected: Record<string, unknown>
  tolerance: { abs?: number; rel?: number }
  tolerance_overrides?: Record<string, { abs?: number; rel?: number }>
}

function loadVector(id: string): Vector {
  return JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${id}.json`), 'utf8')) as Vector
}

/** golden 比對規則：|actual − expected| ≤ abs + rel·|expected|（逐元素） */
function expectGolden(v: Vector, key: string, actual: number | number[] | number[][]): void {
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  const exp = v.expected[key] as number | number[] | number[][]
  const flat = (x: unknown): number[] => (Array.isArray(x) ? x.flatMap(flat) : [x as number])
  const a = flat(actual)
  const e = flat(exp)
  expect(a.length).toBe(e.length)
  a.forEach((ai, i) => {
    const bound = (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(e[i])
    expect(Math.abs(ai - e[i]), `${key}[${i}]: ${ai} vs ${e[i]}`).toBeLessThanOrEqual(bound)
  })
}

const BASE_GAUGE: GaugeParams = {
  b: 0.3,
  a: [1.0, -0.5, 0.2, 0.7],
  c: 0.9,
  dB: 0.4,
  path: 'type2',
  pllMethod: 'dpll',
  wnTs: 0.05,
  zeta: 0.7,
  hpPole: 0.95,
  sequence: 'random',
  T: 40000,
  skip: 2000,
  mu: 0.5,
  N: 64,
  blocks: 120,
  sigmaV: 0,
  gmacReg: 'filtered',
  w0A: [0, 0, 0, 0, 0],
  w0B: [0.8, -0.3, 0.1, 0.4, -0.2],
  seed: 20261010,
}

describe('pe：閉式 2×2 eigen 分解與平均遞迴（§9）', () => {
  it('T10: R = [[1,.99],[.99,1]] ⇒ eigenvalues 1.99、0.01，κ = 199，eigenvectors (1,±1)/√2（golden 比對）', () => {
    const v = loadVector('T10')
    const closed = eig2x2(1, 0.99, 1)
    expectGolden(v, 'eig_max', closed.values[0])
    expectGolden(v, 'eig_min', closed.values[1])
    expectGolden(v, 'eigvec_max', [closed.vectors[0][0], closed.vectors[1][0]])
    expectGolden(v, 'eigvec_min', [closed.vectors[0][1], closed.vectors[1][1]])
    const modes = eigenModes(corr2(0.99), 0.5)
    expectGolden(v, 'eig_max', modes.lambdas[0])
    expectGolden(v, 'eig_min', modes.lambdas[1])
    expectGolden(v, 'cond', modes.kappa)
    expectGolden(v, 'cond', cond(corr2(0.99)))
  })

  it('T10: 閉式解與 Jacobi eigSym 在隨機對稱 2×2 上一致（含 b < 0、a < d、b = 0）', () => {
    const rng = createRng(7)
    const cases: [number, number, number][] = [
      [1, 0, 2],
      [3, 0, 1],
      [1, -0.4, 1],
      [2, 0.3, -1],
    ]
    for (let i = 0; i < 50; i++) cases.push([rng.normal(), rng.normal(), rng.normal()])
    for (const [a, b, d] of cases) {
      const c = eig2x2(a, b, d)
      const j = eigSym([
        [a, b],
        [b, d],
      ])
      expect(c.values[0]).toBeCloseTo(j.values[0], 12)
      expect(c.values[1]).toBeCloseTo(j.values[1], 12)
      // R v = λ v
      for (let col = 0; col < 2; col++) {
        const vcol = [c.vectors[0][col], c.vectors[1][col]]
        const Rv = matVec(
          [
            [a, b],
            [b, d],
          ],
          vcol,
        )
        expect(Rv[0]).toBeCloseTo(c.values[col] * vcol[0], 12)
        expect(Rv[1]).toBeCloseTo(c.values[col] * vcol[1], 12)
        expect(Math.hypot(vcol[0], vcol[1])).toBeCloseTo(1, 14)
      }
    }
  })

  it('T10: 反面測試 ρ = 1（完全缺乏 PE）⇒ eigenvalues [2, 0]、κ = ∞，(1,−1)/√2 方向在平均遞迴中永遠不動', () => {
    const v = loadVector('T10')
    const closed = eig2x2(1, 1, 1)
    expectGolden(v, 'missing_pe_eig_list', [closed.values[0], closed.values[1]])
    // golden 的反面測試彙整（negative_tests.json）：缺乏 PE 時 λ_min = 0
    expectGolden(loadVector('negative_tests'), 'missing_pe_eig_min', closed.values[1])
    expectGolden(loadVector('negative_tests'), 'missing_pe_eig_min', eigenModes(corr2(1), 0.5).lambdas[1])
    const modes = eigenModes(corr2(1), 0.5)
    expect(modes.kappa).toBe(Infinity)
    expect(modes.nullCount).toBe(1)
    expect(modes.poles[1]).toBe(1)
    expect(stepsToDecay(modes.poles[1])).toBe(Infinity)
    const traj = meanTrajectory(corr2(1), 0.5, [1, -0.2], 500)
    const s = Math.SQRT1_2
    const proj0 = s * 1 - s * -0.2
    for (let k = 0; k <= 500; k += 50) expect(s * traj[0][k] - s * traj[1][k]).toBeCloseTo(proj0, 13)
    // 相同 regressor u = [x, x]：(a1, a2) 與 (a1 + c, a2 − c) 輸出完全相同
    for (const x of [-1, -0.3, 0.2, 1]) expect(x * 1 + x * 2).toBeCloseTo(x * 1.7 + x * 1.3, 14)
  })

  it('T11: μ = .5、λ_min = .01 ⇒ 慢 pole .995、快 pole .005、95% 衰減 598 blocks（golden 比對，K_q 正規化為 1）', () => {
    const v = loadVector('T11')
    const modes = eigenModes(corr2(0.99), 0.5)
    expectGolden(v, 'slow_pole', modes.poles[1])
    expectGolden(v, 'fast_pole', modes.poles[0])
    expectGolden(v, 'blocks_95', stepsToDecay(modes.poles[1], 0.05))
    expectGolden(v, 'blocks_95_real', stepsToDecayReal(0.995, 0.05))
    expect(modes.k95[1]).toBe(598)
    expect(Math.pow(0.995, 597)).toBeGreaterThan(0.05)
    expect(Math.pow(0.995, 598)).toBeLessThanOrEqual(0.05)
  })

  it('T11: 時域驗證：沿慢 eigenvector 出發，|c_slow| 在第 598 步首次 ≤ 5%', () => {
    const traj = meanTrajectory(corr2(0.99), 0.5, [Math.SQRT1_2, -Math.SQRT1_2], 600)
    const mag = (k: number) => Math.abs(Math.SQRT1_2 * traj[0][k] - Math.SQRT1_2 * traj[1][k])
    expect(mag(598)).toBeLessThanOrEqual(0.05)
    expect(mag(597)).toBeGreaterThan(0.05)
  })

  it('T11: 物理 K_q（勘誤 E05）：μ = 0.5 fs、K_q = √(2/π)/100 fs⁻¹ ⇒ 慢 pole 0.99996011、75,091 blocks', () => {
    expect(KQ_SIGMA100).toBeCloseTo(0.0079788456, 9)
    expect(comparatorKq(100)).toBe(KQ_SIGMA100)
    const modes = eigenModes(corr2(0.99), 0.5 * KQ_SIGMA100)
    expect(modes.poles[1]).toBeCloseTo(0.99996011, 8)
    expect(modes.k95[1]).toBe(75091)
    // 要得到正規化 g = 0.5，需 μ = 0.5/K_q = 62.6657 fs
    expect(0.5 / KQ_SIGMA100).toBeCloseTo(62.665706865775, 9)
  })

  it('T11: 例子 δ₀ = (1, 0)：一步後 δ₁ = (0.5, −0.495)，模態座標 (0.0035, 0.7036)', () => {
    const traj = meanTrajectory(corr2(0.99), 0.5, [1, 0], 1)
    expect(traj[0][1]).toBeCloseTo(0.5, 14)
    expect(traj[1][1]).toBeCloseTo(-0.495, 14)
    const c = modalCoords(eig2x2(1, 0.99, 1).vectors, [traj[0][1], traj[1][1]])
    expect(c[0]).toBeCloseTo(0.005 * Math.SQRT1_2, 14)
    expect(c[1]).toBeCloseTo(0.995 * Math.SQRT1_2, 14)
  })

  it('最佳 scalar gain：g* = 2/(λ_max+λ_min) = 1，max|p| = (κ−1)/(κ+1) = 0.99（ρ = .99）', () => {
    const o = optimalScalarGain(1.99, 0.01)
    expect(o.g).toBeCloseTo(1, 14)
    expect(o.p).toBeCloseTo(0.99, 14)
    expect(o.p).toBeCloseTo((199 - 1) / (199 + 1), 12)
  })

  it('F-09.5: κ(R) 只由 |ρ| 決定（ρ = ±.5 ⇒ 3、ρ = ±.99 ⇒ 199、ρ = ±1 ⇒ ∞）；(1+ρ)/(1−ρ) 在 ρ < 0 時是 1/κ', () => {
    const cases: [number, number][] = [
      [0.5, 3],
      [-0.5, 3],
      [0.99, 199],
      [-0.99, 199],
    ]
    for (const [rho, expected] of cases) {
      const kappa = eigenModes(corr2(rho), 0.5).kappa
      expect(kappa, `ρ = ${rho}`).toBeCloseTo(expected, 9)
      expect(kappa).toBeGreaterThanOrEqual(1) // condition number 的定義：大的除以小的
      expect(cond(corr2(rho))).toBeCloseTo(expected, 9)
      // 登錄式（F-09.5）：κ = (1 + |ρ|)/(1 − |ρ|)，λ_max,min = 1 ± |ρ|
      expect((1 + Math.abs(rho)) / (1 - Math.abs(rho))).toBeCloseTo(expected, 9)
      const { values } = eig2x2(1, rho, 1)
      expect(values[0]).toBeCloseTo(1 + Math.abs(rho), 12)
      expect(values[1]).toBeCloseTo(1 - Math.abs(rho), 12)
    }
    for (const rho of [1, -1]) {
      const modes = eigenModes(corr2(rho), 0.5)
      expect(modes.kappa, `ρ = ${rho}`).toBe(Infinity)
      expect(modes.nullCount).toBe(1)
      expect(cond(corr2(rho))).toBe(Infinity)
    }
    // 反例（審查 R07）：少了絕對值的 (1 + ρ)/(1 − ρ) 是 λ₁/λ₂，不是 κ——ρ = −.5 時是 1/3，ρ = −1（R 奇異）時是 0
    expect((1 + -0.5) / (1 - -0.5)).toBeCloseTo(1 / 3, 12)
    expect((1 + -0.5) / (1 - -0.5)).toBeCloseTo(1 / eigenModes(corr2(-0.5), 0.5).kappa, 12)
    expect((1 + -1) / (1 - -1)).toBe(0)
  })

  it('F-09.5: 負相關時快慢模式對調（ρ = −.5：共模 pole 0.75 慢、差模 pole 0.25 快、k95 = 11）；ρ = +.99 的結果不變', () => {
    // λ₁ = 1 + ρ 配 (1,1)/√2、λ₂ = 1 − ρ 配 (1,−1)/√2 的配對不變；ρ < 0 時較大的是 λ₂
    const c = eig2x2(1, -0.5, 1)
    expect(c.values[0]).toBeCloseTo(1.5, 12)
    expect(c.values[1]).toBeCloseTo(0.5, 12)
    expect(c.vectors[0][0]).toBeCloseTo(Math.SQRT1_2, 12) // v_max = (1, −1)/√2（差模）
    expect(c.vectors[1][0]).toBeCloseTo(-Math.SQRT1_2, 12)
    expect(c.vectors[0][1]).toBeCloseTo(Math.SQRT1_2, 12) // v_min = (1, 1)/√2（共模）
    expect(c.vectors[1][1]).toBeCloseTo(Math.SQRT1_2, 12)
    const a = peAnalytic({ rho: -0.5, dist: 'gaussian', g: 0.5, N: 16, N0: 100 })
    expect(a.pFast).toBeCloseTo(0.25, 12)
    expect(a.pSlow).toBeCloseTo(0.75, 12)
    expect(a.k95Slow).toBe(11) // ⌈ln 0.05/ln 0.75⌉ = ⌈10.41⌉
    expect(a.gOpt).toBeCloseTo(1, 12)
    expect(a.pOpt).toBeCloseTo(0.5, 12)
    expect(a.modes.kappa).toBeCloseTo(3, 9)
    // 時域：共模 (1,1) 每個 block 乘 0.75（慢），差模 (1,−1) 每個 block 乘 0.25（快）
    const common = meanTrajectory(corr2(-0.5), 0.5, [1, 1], 3)
    const diff = meanTrajectory(corr2(-0.5), 0.5, [1, -1], 3)
    ;[1, 0.75, 0.5625, 0.421875].forEach((v, k) => {
      expect(common[0][k]).toBeCloseTo(v, 12)
      expect(common[1][k]).toBeCloseTo(v, 12)
    })
    ;[1, 0.25, 0.0625, 0.015625].forEach((v, k) => {
      expect(diff[0][k]).toBeCloseTo(v, 12)
      expect(diff[1][k]).toBeCloseTo(-v, 12)
    })
    // 對照（正相關，本章的例子）：共模是快模式，數字不變
    const b = peAnalytic({ rho: 0.99, dist: 'gaussian', g: 0.5, N: 16, N0: 100 })
    expect(b.modes.kappa).toBeCloseTo(199, 9)
    expect(b.pSlow).toBeCloseTo(0.995, 12)
    expect(b.k95Slow).toBe(598)
    expect(b.pOpt).toBeCloseTo(0.99, 12)
    const cp = eig2x2(1, 0.99, 1)
    expect(cp.vectors[0][0]).toBeCloseTo(Math.SQRT1_2, 12) // v_max = (1, 1)/√2（共模）
    expect(cp.vectors[1][0]).toBeCloseTo(Math.SQRT1_2, 12)
  })

  it('F-09.7: g > g⋆ = 2/(λ_max+λ_min) 時最慢的是 λ_max 的模式（ρ = .5、g = 1.2：pole −0.8／0.4 ⇒ 14 vs. 4 blocks）；g ≤ g⋆ 時才是 λ_min', () => {
    // 反例（審查 C01）：「最小 eigenvalue 決定收斂速度」只在 g ≤ g⋆ 成立
    const m = eigenModes(corr2(0.5), 1.2)
    expect(m.lambdas[0]).toBeCloseTo(1.5, 12)
    expect(m.lambdas[1]).toBeCloseTo(0.5, 12)
    expect(m.poles[0]).toBeCloseTo(-0.8, 12) // λ_max 的模式：負的（每個 block 變號）
    expect(m.poles[1]).toBeCloseTo(0.4, 12) // λ_min 的模式
    expect(m.k95).toEqual([14, 4])
    const a = peAnalytic({ rho: 0.5, dist: 'gaussian', g: 1.2, N: 16, N0: 100 })
    expect(a.meanRadius).toBeCloseTo(0.8, 12) // max|p_i| 是快模式的
    expect(a.gOpt).toBeCloseTo(1, 12)
    expect(1.2).toBeLessThan(2 / m.lambdas[0]) // 仍在穩定範圍內（上限 2/1.5 = 1.333）
    // 軌跡（不只看 pole）：沿共模 (1,1) 出發第 14 個 block 才 ≤ 5%；沿差模 (1,−1) 第 4 個 block 就到
    const common = meanTrajectory(corr2(0.5), 1.2, [1, 1], 14)
    expect(Math.abs(common[0][13])).toBeCloseTo(Math.pow(0.8, 13), 12)
    expect(Math.abs(common[0][13])).toBeGreaterThan(0.05)
    expect(Math.abs(common[0][14])).toBeLessThanOrEqual(0.05)
    expect(common[0][1]).toBeCloseTo(-0.8, 12)
    const diff = meanTrajectory(corr2(0.5), 1.2, [1, -1], 4)
    expect(Math.abs(diff[0][3])).toBeGreaterThan(0.05) // 0.4³ = 0.064
    expect(Math.abs(diff[0][4])).toBeLessThanOrEqual(0.05) // 0.4⁴ = 0.0256
    // 對照：g = 0.5（< g⋆ = 1）⇒ 最慢的是 λ_min（0.75、11 blocks）；g = g⋆ = 1 ⇒ 兩個 |p| 相等（0.5、5 blocks）
    const small = eigenModes(corr2(0.5), 0.5)
    expect(small.poles[0]).toBeCloseTo(0.25, 12)
    expect(small.poles[1]).toBeCloseTo(0.75, 12)
    expect(small.k95).toEqual([3, 11])
    const tie = eigenModes(corr2(0.5), 1)
    expect(tie.poles[0]).toBeCloseTo(-0.5, 12)
    expect(tie.poles[1]).toBeCloseTo(0.5, 12)
    expect(tie.k95).toEqual([5, 5])
    // 一般性：0 < g < 2/λ_max 內，|1 − gλ_max| > |1 − gλ_min| ⇔ g > 2/(λ_max + λ_min)
    const rng = createRng(20261012)
    for (let i = 0; i < 300; i++) {
      const l1 = 0.01 + 2.99 * rng.uniform()
      const l2 = 0.01 + 2.99 * rng.uniform()
      const lmax = Math.max(l1, l2)
      const lmin = Math.min(l1, l2)
      const g = (2 / lmax) * (0.001 + 0.998 * rng.uniform())
      const gStar = optimalScalarGain(lmax, lmin).g
      if (Math.abs(g - gStar) < 1e-9) continue
      expect(Math.abs(1 - g * lmax) > Math.abs(1 - g * lmin), `λ = ${lmax}, ${lmin}; g = ${g}`).toBe(g > gStar)
      // 不論 g 取多少，max|p| 都不會小於 (κ − 1)/(κ + 1)
      expect(Math.max(Math.abs(1 - g * lmax), Math.abs(1 - g * lmin))).toBeGreaterThanOrEqual(optimalScalarGain(lmax, lmin).p - 1e-12)
    }
  })
})

describe('pe：mean-square 遞迴（勘誤 E23）', () => {
  it('T11: Gaussian、ρ=.99、g=.5 的 MS spectral radius：N=1 → 1.9801（發散），N=2 → 0.99254，N=16 → 0.99003', () => {
    expect(meanSquareRadius('gaussian', 0.99, 0.5, 1)).toBeCloseTo(1.9801, 6)
    expect(meanSquareRadius('gaussian', 0.99, 0.5, 2)).toBeCloseTo(0.9925375, 6)
    expect(meanSquareRadius('gaussian', 0.99, 0.5, 16)).toBeCloseTo(0.99003, 5)
    // 3×3 算子與 eigen 座標閉式對角子系統一致
    for (const N of [1, 2, 4, 16, 256]) {
      const A = meanSquareDiagGaussian([1.99, 0.01], 0.5, N)
      const r = Math.max(...eigSym(A).values.map(Math.abs))
      expect(meanSquareRadius('gaussian', 0.99, 0.5, N)).toBeCloseTo(r, 10)
    }
    // MS 半徑 ≥ mean 半徑²（Jensen）
    expect(meanSquareRadius('gaussian', 0.99, 0.5, 4096)).toBeGreaterThanOrEqual(0.995 * 0.995 - 1e-12)
  })

  it('±1 sparse-flip、N = 1、g = .5：每步 I − ½uuᵀ 是投影 ⇒ MS 半徑 = 0.995（等於 mean 半徑，而非平方）', () => {
    expect(meanSquareRadius('pm1', 0.99, 0.5, 1)).toBeCloseTo(0.995, 12)
  })

  it('Gaussian N=1 MS 發散的 Monte Carlo 證據：E[(1 − g·x²)²] 型的四階動差（單步 P 映射 vs MC）', () => {
    // 單步：E[‖δ₁‖²] 從 δ₀ = (1, 0)，比較 meanSquareTrajectory 與 MC（大量獨立單步，避免重尾）
    const pred = meanSquareTrajectory({ dist: 'gaussian', rho: 0.99, g: 0.5, N: 1, delta0: [1, 0], steps: 1 })[1]
    const rng = createRng(99)
    const u = new Float64Array(2)
    let s = 0
    let s2 = 0
    const M = 200000
    for (let i = 0; i < M; i++) {
      const z1 = rng.normal()
      const z2 = rng.normal()
      u[0] = z1
      u[1] = 0.99 * z1 + Math.sqrt(1 - 0.99 * 0.99) * z2
      const e = u[0] // uᵀδ，δ = (1, 0)
      const d1 = 1 - 0.5 * e * u[0]
      const d2 = -0.5 * e * u[1]
      const n2 = d1 * d1 + d2 * d2
      s += n2
      s2 += n2 * n2
    }
    const mean = s / M
    const se = Math.sqrt((s2 / M - mean * mean) / M)
    expect(Math.abs(mean - pred)).toBeLessThan(5 * se)
  })
})

describe('pe：1-bit（Sign-LMS）的 mean-square（F-09.18）', () => {
  it('T11: sign detector、Gaussian、ρ=.99、g=.5、N=1：小訊號均方齊次半徑 = 0.99（linear 同條件為 1.9801）', () => {
    expect(meanSquareRadius('gaussian', 0.99, 0.5, 1, 'sign')).toBeCloseTo(0.99, 12)
    expect(meanSquareRadius('gaussian', 0.99, 0.5, 1, 'linear')).toBeCloseTo(1.9801, 6)
    // 預設參數仍是 linear（舊呼叫不受影響）
    expect(meanSquareRadius('gaussian', 0.99, 0.5, 1)).toBeCloseTo(1.9801, 6)
    // eigen 座標：E[c_i²] 的倍數 (1 − gλ_i)² − g²λ_i²/N；N = 4 時最大者
    const N = 4
    const pred = Math.max(...[1.99, 0.01].map((l) => Math.abs((1 - 0.5 * l) ** 2 - (0.25 * l * l) / N)))
    expect(meanSquareRadius('gaussian', 0.99, 0.5, N, 'sign')).toBeCloseTo(pred, 12)
    // peAnalytic 依 detector 切換
    expect(peAnalytic({ rho: 0.99, dist: 'gaussian', g: 0.5, N: 1, N0: 100, detector: 'sign' }).msRadius).toBeLessThan(1)
    expect(peAnalytic({ rho: 0.99, dist: 'gaussian', g: 0.5, N: 1, N0: 100, detector: 'linear' }).msRadius).toBeGreaterThan(1.9)
  })

  it('q² ≡ 1 ⇒ E‖G‖² = tr(R)/N + (1 − 1/N)‖E[qu|δ]‖²（精確恆等式，沒有四階動差；MC 驗證）', () => {
    const rho = 0.6
    const N = 4
    const d: [number, number] = [0.8, -0.3]
    const [m1, m2] = bussgangMeanG('gaussian', rho, 1, d[0], d[1])
    const pred = 2 / N + (1 - 1 / N) * (m1 * m1 + m2 * m2)
    const rng = createRng(77)
    let s = 0
    let s2 = 0
    const M = 100000
    for (let i = 0; i < M; i++) {
      let g1 = 0
      let g2 = 0
      for (let n = 0; n < N; n++) {
        const u1 = rng.normal()
        const u2 = rho * u1 + Math.sqrt(1 - rho * rho) * rng.normal()
        const q = u1 * d[0] + u2 * d[1] + rng.normal() >= 0 ? 1 : -1
        g1 += q * u1
        g2 += q * u2
      }
      const v = (g1 / N) ** 2 + (g2 / N) ** 2
      s += v
      s2 += v * v
    }
    const mean = s / M
    const se = Math.sqrt((s2 / M - mean * mean) / M)
    expect(Math.abs(mean - pred)).toBeLessThan(5 * se)
  })

  it('一步均方：小訊號下 F-09.18 與 MC 一致（σ_v = 1、N = 4、g = 0.5）', () => {
    const rho = 0.99
    const N = 4
    const sigmaV = 1
    const Kq = comparatorKq(sigmaV)
    const mu = 0.5 / Kq
    const d: [number, number] = [0.05, -0.03]
    const pred = meanSquareTrajectory({ dist: 'gaussian', rho, g: mu * Kq, N, delta0: d, steps: 1, noiseVar: mu * mu, detector: 'sign' })[1]
    const res = simulatePeLab({
      rho,
      dist: 'gaussian',
      detector: 'sign',
      sigmaV,
      mu,
      N,
      delta0: d,
      blocks: 1,
      chains: 40000,
      nPaths: 0,
      N0: 10,
      scatterCount: 0,
      peLength: 10,
      seed: 31,
    })
    // E‖δ₁‖² 的 MC 標準誤：用 ‖δ₁‖² ≈ μ²‖G‖² 的尺度估計（|q·u| 有界 ⇒ 變異有限）
    const se = (mu * mu * 2) / N / Math.sqrt(res.chainsUsed)
    expect(Math.abs(res.msNorm[1] - pred)).toBeLessThan(6 * se)
  })

  // ── 迴路自己的穩態抖動：F-09.18 固定點的閉式（PE / Eigen Lab 的 1-bit 小訊號警告用它；審查 R06a 的後續） ──

  /** 把 F-09.18 的映射（meanSquareMap 的 sign 分支，σ_v = 1、每個 block 注入 μ²R/N）從 P = 0 迭代到固定點，回傳 tr(R·P∞) = E[s_δ²] */
  const iterateJitter = (rho: number, g: number, N: number, dist: 'gaussian' | 'pm1' = 'gaussian', iters = 6000): number => {
    const mu = g / comparatorKq(1)
    const Q = matScale(corr2(rho), (mu * mu) / N)
    let P: Matrix = [
      [0, 0],
      [0, 0],
    ]
    for (let i = 0; i < iters; i++) P = meanSquareMap(dist, rho, g, N, P, Q, 'sign')
    return P[0][0] + 2 * rho * P[0][1] + P[1][1]
  }

  it('signJitterSteadyState：E[s_δ²] = (πg/2N)·Σλ_i/(2 − g(1 − 1/N)λ_i) 與迭代 meanSquareMap 的固定點一致（ρ 正負、兩種 regressor 分布）', () => {
    const grid: [number, number, number][] = [
      [0.99, 0.5, 1],
      [0.99, 0.5, 16],
      [0.99, 0.5, 32],
      [0.5, 0.3, 8],
      [-0.5, 0.3, 8],
      [0, 0.2, 2],
      [0.5, 1.2, 64],
      [-0.9, 0.7, 4],
    ]
    for (const [rho, g, N] of grid) {
      const closed = signJitterSteadyState(eig2x2(1, rho, 1).values, g, N)
      // 手寫的同一個式子（不經過被測函式）
      const byHand = ((Math.PI * g) / (2 * N)) * [1 + Math.abs(rho), 1 - Math.abs(rho)].reduce((acc, l) => acc + l / (2 - g * (1 - 1 / N) * l), 0)
      expect(closed, `ρ=${rho} g=${g} N=${N}`).toBeCloseTo(byHand, 13)
      // sign 的 q² ≡ 1：沒有四階動差，所以固定點與 regressor 分布無關
      for (const dist of ['gaussian', 'pm1'] as const) expect(iterateJitter(rho, g, N, dist) / closed, `ρ=${rho} g=${g} N=${N} ${dist}`).toBeCloseTo(1, 9)
    }
    // 章內「多小才算小」說明框與實驗室警告顯示的數字（ρ = .99、g = .5）
    const lam = eig2x2(1, 0.99, 1).values
    expect(signJitterSteadyState(lam, 0.5, 1)).toBeCloseTo(Math.PI / 4, 12) // N = 1：(π/4)·tr(R)/2 = π/4
    expect(signJitterSteadyState(lam, 0.5, 32)).toBeCloseTo(0.0472634883, 9)
    // N = 16（實驗室預設的 block 長度）：√E[s_δ²] = 0.303，剛超過 0.3 的門檻；N = 17 就回到門檻內
    expect(Math.sqrt(signJitterSteadyState(lam, 0.5, 16))).toBeCloseTo(0.30295, 4)
    expect(Math.sqrt(signJitterSteadyState(lam, 0.5, 17))).toBeLessThan(0.3)
    // 只和 |ρ| 有關（λ_max、λ_min 相同）
    expect(signJitterSteadyState(eig2x2(1, -0.99, 1).values, 0.5, 16)).toBeCloseTo(signJitterSteadyState(lam, 0.5, 16), 14)
  })

  it('signJitterSteadyState 的邊界：λ = 0 的方向不注入雜訊；平均或均方不收斂 ⇒ ∞；g = 0 ⇒ 0；N 越大越小、g 越大越大', () => {
    // ρ = 1：λ = (2, 0)。只有共模有抖動：(π·0.5/32)·2/(2 − 0.5·(15/16)·2) = 0.092400…；與迭代（零方向的 P 留在 0）一致
    const rho1 = signJitterSteadyState([2, 0], 0.5, 16)
    expect(rho1).toBeCloseTo(((Math.PI * 0.5) / 32) * (2 / (2 - 0.9375)), 14)
    expect(rho1).toBeCloseTo(0.0924, 4)
    expect(iterateJitter(1, 0.5, 16) / rho1).toBeCloseTo(1, 9)
    // N = 1 的均方倍數是 1 − 2gλ：gλ_max ≥ 1 就不收斂（與 meanSquareRadius 的判斷一致）
    expect(signJitterSteadyState([1.99, 0.01], 0.6, 1)).toBe(Infinity)
    expect(meanSquareRadius('gaussian', 0.99, 0.6, 1, 'sign')).toBeGreaterThan(1)
    expect(Number.isFinite(signJitterSteadyState([1.99, 0.01], 0.5, 1))).toBe(true)
    expect(meanSquareRadius('gaussian', 0.99, 0.5, 1, 'sign')).toBeLessThan(1)
    // 平均遞迴發散（gλ_max ≥ 2）
    expect(signJitterSteadyState([1.99, 0.01], 1.1, 64)).toBe(Infinity)
    expect(signJitterSteadyState([1.99, 0.01], 0, 16)).toBe(0)
    // 實驗室警告的建議「加大 N 或減小 g」：估計值對 N 遞減、對 g 遞增（平均穩定的範圍內）
    for (const rho of [0, 0.5, 0.99]) {
      const lam = eig2x2(1, rho, 1).values
      let prevN = Infinity
      for (const N of [2, 4, 16, 64, 256, 4096]) {
        const v = signJitterSteadyState(lam, 0.5, N)
        expect(v, `ρ=${rho} N=${N}`).toBeLessThan(prevN)
        prevN = v
      }
      let prevG = 0
      for (const g of [0.01, 0.1, 0.3, 0.5, 0.9]) {
        const v = signJitterSteadyState(lam, g, 64)
        expect(v, `ρ=${rho} g=${g}`).toBeGreaterThan(prevG)
        prevG = v
      }
    }
  })

  it('signJitterSteadyState 與本站的 MC chain（runPeChain、sign detector）一致：小訊號區（ρ = .5、g = .3、N = 64，√E[s_δ²] ≈ 0.095）穩態的 E[δᵀRδ]/σ_v² 相差不到 5%', () => {
    const rho = 0.5
    const g = 0.3
    const N = 64
    const sigmaV = 100
    const pred = signJitterSteadyState(eig2x2(1, rho, 1).values, g, N)
    expect(Math.sqrt(pred)).toBeCloseTo(0.0953, 4) // (π·0.3/128)·(1.5/1.55703 + 0.5/1.85234) = 0.0090809
    const mu = g / comparatorKq(sigmaV)
    const chains = 60
    const burn = 100 // 慢模式的時間常數 1/(gλ_min) ≈ 6.7 blocks
    const blocks = 2100
    const perChain: number[] = []
    for (let c = 0; c < chains; c++) {
      const ur = createRng(4000 + 7 * c)
      const vr = createRng(880000 + 13 * c)
      let acc = 0
      let cnt = 0
      runPeChain({ dist: 'gaussian', detector: 'sign', rho, sigmaV, mu, N, delta0: [0, 0], blocks }, ur, vr, (k, d1, d2) => {
        if (k < burn) return
        acc += (d1 * d1 + 2 * rho * d1 * d2 + d2 * d2) / (sigmaV * sigmaV)
        cnt++
      })
      perChain.push(acc / cnt)
    }
    const mean = perChain.reduce((a, b) => a + b, 0) / chains
    const se = Math.sqrt(perChain.reduce((a, b) => a + (b - mean) ** 2, 0) / (chains - 1) / chains)
    expect(se / mean).toBeLessThan(0.01) // MC 自己的統計誤差 < 1%
    expect(Math.abs(mean / pred - 1)).toBeLessThan(0.05)
  }, 60000)
})

describe('pe：1-bit comparator 的 mean-field（Bussgang）', () => {
  it('小 δ 時 E[q·u|δ] → K_q·Rδ（Gaussian 與 ±1 皆然）', () => {
    const kq = KQ_SIGMA100
    for (const dist of ['gaussian', 'pm1'] as const) {
      const [g1, g2] = bussgangMeanG(dist, 0.99, 100, 0.01, -0.02)
      expect(g1 / (kq * (0.01 + 0.99 * -0.02))).toBeCloseTo(1, 4)
      expect(g2 / (kq * (0.99 * 0.01 - 0.02))).toBeCloseTo(1, 4)
    }
  })

  it('±1 code 的 E[q·u|δ] 與 Monte Carlo 一致（σ_v = 1、δ = (0.8, −0.3)）', () => {
    const [g1, g2] = bussgangMeanG('pm1', 0.6, 1, 0.8, -0.3)
    const rng = createRng(5)
    const u = new Float64Array(2)
    let a1 = 0
    let a2 = 0
    const M = 400000
    for (let i = 0; i < M; i++) {
      drawPm1Pair(0.6, rng, u)
      const q = u[0] * 0.8 + u[1] * -0.3 + rng.normal() >= 0 ? 1 : -1
      a1 += q * u[0]
      a2 += q * u[1]
    }
    // 每個分量 |q·u| = 1 ⇒ SE ≤ 1/√M
    expect(Math.abs(a1 / M - g1)).toBeLessThan(5 / Math.sqrt(M))
    expect(Math.abs(a2 / M - g2)).toBeLessThan(5 / Math.sqrt(M))
  })

  // ── 審查 R06a：F-09.3 的 1-bit 式（K_q 線性化）只是小訊號近似；linear detector 才是精確的等式 ──

  it('R06a: δ₀ = σ_v 時 K_q 線性化（F-09.3 的 1-bit 式）高估一步修正量：精確 0.94358 vs. 線性式 0.92021', () => {
    // 單一參數、u ~ N(0,1)、v ~ N(0,1)、δ₀ = 1、μ = 0.1（本站的 2 參數模型：ρ = 0、δ₀ = (1, 0)）
    // Price／Bussgang：E[sign(uδ₀ + v)·u] = √(2/π)·δ₀/√(σ_v² + δ₀²) = 1/√π
    expect(bussgangMeanG('gaussian', 0, 1, 1, 0)[0]).toBeCloseTo(1 / Math.sqrt(Math.PI), 12)
    expect(1 / Math.sqrt(Math.PI)).toBeCloseTo(0.5641895835477563, 15)
    const exact = meanFieldTrajectory({ dist: 'gaussian', rho: 0, sigmaV: 1, mu: 0.1, delta0: [1, 0], steps: 1 })[0][1]
    expect(exact).toBeCloseTo(0.9435810416452244, 12) // 1 − 0.1/√π（δ₀ 是確定值 ⇒ 第一步的 mean-field 就是精確平均）
    const lin = meanTrajectory(corr2(0), 0.1 * comparatorKq(1), [1, 0], 1)[0][1]
    expect(lin).toBeCloseTo(0.9202115439197135, 12) // 1 − 0.1·√(2/π)
    expect(exact - lin).toBeCloseTo(0.0233694977, 9)
    expect(exact - lin).toBeGreaterThan(0.02)
    // 線性化把這一步的修正量高估成 √2 倍
    expect((1 - lin) / (1 - exact)).toBeCloseTo(Math.SQRT2, 12)
  })

  it('R06a: 用本站的 MC chain（runPeChain、sign detector）走一步：平均落在精確值 5 SE 內，離線性式超過 50 SE', () => {
    const ur = createRng(12345)
    const vr = createRng(67890)
    const M = 200000
    let sum = 0
    for (let c = 0; c < M; c++) {
      runPeChain({ dist: 'gaussian', detector: 'sign', rho: 0, sigmaV: 1, mu: 0.1, N: 1, delta0: [1, 0], blocks: 1 }, ur, vr, (k, d1) => {
        if (k === 1) sum += d1
      })
    }
    const mean = sum / M
    // δ₁ = 1 − 0.1·q·u，Var(q·u) = E[u²] − (E[qu])² = 1 − 1/π ⇒ 每條 chain 的 sd = 0.08256
    const se = (0.1 * Math.sqrt(1 - 1 / Math.PI)) / Math.sqrt(M)
    expect(se).toBeCloseTo(1.846e-4, 6)
    expect(Math.abs(mean - 0.9435810416452244)).toBeLessThan(5 * se)
    expect(Math.abs(mean - 0.9202115439197135)).toBeGreaterThan(50 * se)
  })

  it('R06a 對照（小訊號）：δ₀ = 0.05σ_v 時兩者只差 0.12%；Bussgang 增益 ÷ K_q = 1/√(1 + s_δ²)（s_δ = 0.1、0.3、1 ⇒ 0.9950、0.9578、0.7071）', () => {
    const kq = comparatorKq(1)
    const lin = meanTrajectory(corr2(0), 0.1 * kq, [0.05, 0], 1)[0][1]
    const mf = meanFieldTrajectory({ dist: 'gaussian', rho: 0, sigmaV: 1, mu: 0.1, delta0: [0.05, 0], steps: 1 })[0][1]
    expect(lin).toBeCloseTo(0.046010577195985676, 14)
    expect(mf).toBeCloseTo(0.046015554643718086, 14)
    expect((0.05 - mf) / (0.05 - lin)).toBeCloseTo(0.9987523, 6)
    expect(Math.abs((0.05 - mf) / (0.05 - lin) - 1)).toBeLessThan(2e-3)
    const expected = [0.9950371902, 0.9578262852, 0.7071067812]
    ;[0.1, 0.3, 1].forEach((sRatio, i) => {
      const ratio = bussgangMeanG('gaussian', 0, 1, sRatio, 0)[0] / (kq * sRatio)
      expect(ratio).toBeCloseTo(1 / Math.sqrt(1 + sRatio * sRatio), 12)
      expect(ratio).toBeCloseTo(expected[i], 9)
    })
    // 有相關時量的是 s_δ = √(δᵀRδ)/σ_v，不是 ‖δ‖：沿差模（λ_min = 0.01）的 δ = (1, −1)/√2·σ_v 只有 s_δ = 0.1
    const [g1, g2] = bussgangMeanG('gaussian', 0.99, 1, Math.SQRT1_2, -Math.SQRT1_2)
    expect(g1 / (kq * 0.01 * Math.SQRT1_2)).toBeCloseTo(1 / Math.sqrt(1.01), 12)
    expect(g2 / (kq * 0.01 * -Math.SQRT1_2)).toBeCloseTo(1 / Math.sqrt(1.01), 12)
  })

  it('R06a 對照（linear detector）：E[δ₁] = (1 − μ)δ₀ 不論誤差大小都精確（δ₀ = 1 與 δ₀ = 10 的 MC 都在 5 SE 內）', () => {
    const M = 200000
    for (const d0 of [1, 10]) {
      const ur = createRng(2468)
      const vr = createRng(1357)
      let sum = 0
      for (let c = 0; c < M; c++) {
        runPeChain({ dist: 'gaussian', detector: 'linear', rho: 0, sigmaV: 1, mu: 0.1, N: 1, delta0: [d0, 0], blocks: 1 }, ur, vr, (k, d1) => {
          if (k === 1) sum += d1
        })
      }
      // δ₁ = δ₀ − μ·u(uδ₀ + v)：Var = μ²(2δ₀² + 1) ⇒ SE = 0.1·√(2δ₀² + 1)/√M（δ₀ = 1：3.873e-4；δ₀ = 10：3.170e-3）
      const se = (0.1 * Math.sqrt(2 * d0 * d0 + 1)) / Math.sqrt(M)
      expect(Math.abs(sum / M - 0.9 * d0), `δ₀ = ${d0}`).toBeLessThan(5 * se)
      expect(meanTrajectory(corr2(0), 0.1, [d0, 0], 1)[0][1]).toBeCloseTo(0.9 * d0, 12)
    }
  })

  it('R06a: 迴路自己的穩態抖動也會破壞小訊號條件——ρ = .99、g = .5 的 1-bit 迴路，N = 1 時第 598 個 block 的慢模式平均明顯高於 0.995⁵⁹⁸；N = 32 時才相符', () => {
    const kq = comparatorKq(1)
    const linear = Math.pow(0.995, 598) // 線性式（F-09.3 的 1-bit 式）的預測：0.04991
    expect(linear).toBeCloseTo(0.04991169, 8)
    /** F-09.18（小訊號）的穩態 E[s_δ²] = tr(R·P∞)/σ_v²（s_δ = √(δᵀRδ)/σ_v）：頁面上「多小才算小」那一段顯示的估計值 */
    const jitter = (N: number): number => {
      const mu = 0.5 / kq
      const Q = matScale(corr2(0.99), (mu * mu) / N)
      let P: Matrix = [
        [0, 0],
        [0, 0],
      ]
      for (let i = 0; i < 6000; i++) P = meanSquareMap('gaussian', 0.99, 0.5, N, P, Q, 'sign')
      return P[0][0] + 2 * 0.99 * P[0][1] + P[1][1]
    }
    /** 閉式（eigen 座標）：P_ii = μ²/(N(2g − g²λ_i(1 − 1/N)))，E[s_δ²] = Σλ_i·P_ii */
    const jitterClosed = (N: number): number => {
      const mu = 0.5 / kq
      return [1.99, 0.01].reduce((acc, l) => acc + (l * mu * mu) / (N * (2 * 0.5 - 0.25 * l * (1 - 1 / N))), 0)
    }
    expect(jitter(1)).toBeCloseTo(Math.PI / 4, 10) // g·π/4·tr(R) = 0.7854：已經不是 ≪ 1
    expect(jitter(1)).toBeCloseTo(jitterClosed(1), 10)
    expect(jitter(32)).toBeCloseTo(0.0472634883, 9)
    expect(jitter(32)).toBeCloseTo(jitterClosed(32), 10)
    const run = (N: number, chains: number) => {
      const ur = createRng(11)
      const vr = createRng(1011)
      let s1 = 0
      let s2 = 0
      let q = 0
      for (let c = 0; c < chains; c++) {
        runPeChain({ dist: 'gaussian', detector: 'sign', rho: 0.99, sigmaV: 1, mu: 0.5 / kq, N, delta0: [1, 0], blocks: 598 }, ur, vr, (k, d1, d2) => {
          if (k !== 598) return
          const c2 = (d1 - d2) / Math.SQRT2 // 慢模式（差模）座標
          s1 += c2
          s2 += c2 * c2
          q += d1 * d1 + 2 * 0.99 * d1 * d2 + d2 * d2 // δᵀRδ = s_δ²·σ_v²
        })
      }
      const mean = s1 / chains
      const sd = Math.sqrt((s2 - chains * mean * mean) / (chains - 1))
      // 初值的慢模式座標是 1/√2
      return { ratio: mean / Math.SQRT1_2, se: sd / Math.sqrt(chains) / Math.SQRT1_2, meanQ: q / chains }
    }
    // 反例：N = 1。抖動本身讓 E[s_δ²] > 1（比小訊號估計的 0.785 還大），慢模式的平均比線性式慢
    const n1 = run(1, 8000)
    expect(n1.meanQ).toBeGreaterThan(1)
    expect(n1.meanQ).toBeGreaterThan(jitter(1))
    expect(n1.ratio).toBeGreaterThan(0.08)
    expect(n1.ratio - linear).toBeGreaterThan(4 * n1.se)
    // 對照：N = 32。E[s_δ²] ≈ 0.047（與小訊號估計相符），慢模式的平均與線性式在 4 SE 內一致
    const n32 = run(32, 300)
    expect(n32.meanQ).toBeLessThan(0.1)
    expect(Math.abs(n32.meanQ / jitter(32) - 1)).toBeLessThan(0.3)
    expect(Math.abs(n32.ratio - linear)).toBeLessThan(4 * n32.se)
  }, 60000)
})

describe('pe：§9.1 有限窗口 PE', () => {
  it('T10: 滑動窗口 R_k 的 λ_min 與直接計算一致；singular values 滿足 σ_i(U_k)² = N₀·λ_i(R_k)', () => {
    const rng = createRng(11)
    const n = 400
    const u1 = new Float64Array(n)
    const u2 = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      u1[i] = rng.normal()
      u2[i] = 0.9 * u1[i] + Math.sqrt(1 - 0.81) * rng.normal()
    }
    const N0 = 50
    const pe = slidingWindowPe(u1, u2, N0, 7)
    for (const w of [0, 3, 10, pe.k.length - 1]) {
      const k = pe.k[w]
      const U = Array.from({ length: N0 }, (_, j) => [u1[k + j], u2[k + j]])
      const s = svd(U).S
      expect(pe.svMax[w]).toBeCloseTo(s[0], 10)
      expect(pe.svMin[w]).toBeCloseTo(s[1], 10)
      expect(pe.lmin[w]).toBeCloseTo((s[1] * s[1]) / N0, 10)
    }
  })

  it('T10: Gaussian ρ = .99、N₀ = 20000 的窗口 λ_min 估計集中在 0.01（相對散佈 ≈ √(2/N₀)）', () => {
    const rng = createRng(1001)
    const lmins: number[] = []
    for (let r = 0; r < 30; r++) {
      const n = 20000
      const u1 = new Float64Array(n)
      const u2 = new Float64Array(n)
      for (let i = 0; i < n; i++) {
        u1[i] = rng.normal()
        u2[i] = 0.99 * u1[i] + Math.sqrt(1 - 0.99 * 0.99) * rng.normal()
      }
      lmins.push(slidingWindowPe(u1, u2, n, 1).lmin[0])
    }
    const mean = lmins.reduce((s, x) => s + x, 0) / lmins.length
    const sd = Math.sqrt(lmins.reduce((s, x) => s + (x - mean) ** 2, 0) / (lmins.length - 1))
    expect(Math.abs(mean - 0.01)).toBeLessThan((5 * sd) / Math.sqrt(lmins.length))
    expect(sd / 0.01).toBeGreaterThan(0.5 * Math.sqrt(2 / 20000))
    expect(sd / 0.01).toBeLessThan(2 * Math.sqrt(2 / 20000))
  })

  it('T10: 反面測試（缺乏 PE 的窗口）：±1 sparse-flip ρ=.99、N₀=100 ⇒ 約 60.6% 的窗口 λ_min 精確為 0', () => {
    expect(pm1DegenerateProb(0.99, 100)).toBeCloseTo(0.6057704, 6)
    const rng = createRng(2026)
    const u = new Float64Array(2)
    const N0 = 100
    let deg = 0
    const W = 3000
    for (let w = 0; w < W; w++) {
      const u1 = new Float64Array(N0)
      const u2 = new Float64Array(N0)
      for (let i = 0; i < N0; i++) {
        drawPm1Pair(0.99, rng, u)
        u1[i] = u[0]
        u2[i] = u[1]
      }
      const pe = slidingWindowPe(u1, u2, N0, 1)
      if (pe.lmin[0] === 0) deg++
    }
    const p = pm1DegenerateProb(0.99, 100)
    const se = Math.sqrt((p * (1 - p)) / W)
    expect(Math.abs(deg / W - p)).toBeLessThan(4 * se)
  })

  it('T10: ±1 code 非退化窗口的 λ_min(R_k)：條件平均與相對散佈（精確二項）與 MC 一致，且高於 λ_min(R) = 0.01', () => {
    const st = pm1WindowLminStats(0.99, 100)
    expect(st.probNonDegenerate).toBeCloseTo(1 - pm1DegenerateProb(0.99, 100), 10)
    expect(st.mean).toBeCloseTo(0.0253659, 6)
    expect(st.relSd).toBeCloseTo(0.42278, 4)
    expect(st.mean).toBeGreaterThan(0.01)
    // 不重疊的窗口（stride = N₀）互相獨立 ⇒ 可以用標準誤
    const rng = createRng(4242)
    const u = new Float64Array(2)
    const N0 = 100
    const W = 4000
    const u1 = new Float64Array(N0 * W)
    const u2 = new Float64Array(N0 * W)
    for (let i = 0; i < N0 * W; i++) {
      drawPm1Pair(0.99, rng, u)
      u1[i] = u[0]
      u2[i] = u[1]
    }
    const pe = slidingWindowPe(u1, u2, N0, N0)
    const nd = Array.from(pe.lmin).filter((v) => v > 0)
    const mean = nd.reduce((a, b) => a + b, 0) / nd.length
    const sd = Math.sqrt(nd.reduce((a, b) => a + (b - mean) ** 2, 0) / (nd.length - 1))
    expect(Math.abs(mean - st.mean)).toBeLessThan((4 * sd) / Math.sqrt(nd.length))
    // Gaussian 的 peAnalytic 用 λ_min(R) 與 √(2/N₀)
    const ga = peAnalytic({ rho: 0.99, dist: 'gaussian', g: 0.5, N: 16, N0: 100 })
    expect(ga.windowLminMean).toBeCloseTo(0.01, 12)
    expect(ga.windowLminRelSd).toBeCloseTo(Math.sqrt(2 / 100), 12)
    // ρ = 1 的 ±1 code：沒有非退化窗口
    expect(pm1WindowLminStats(1, 100).probNonDegenerate).toBe(0)
  })

  it('N₀ = 1 的窗口必定退化（rank uuᵀ = 1）', () => {
    const pe = slidingWindowPe([0.3, -1.2, 0.7], [1.1, 0.4, -0.2], 1, 1)
    expect(pe.degenerateFraction).toBe(1)
  })
})

describe('pe：Monte Carlo（block LMS）', () => {
  it('T11: linear detector、Gaussian、N = 16：MC ensemble 平均與 (I − μR)^k δ₀ 在 4 SE 內一致', () => {
    const res = simulatePeLab({
      rho: 0.99,
      dist: 'gaussian',
      detector: 'linear',
      sigmaV: 0,
      mu: 0.5,
      N: 16,
      delta0: [1, 0],
      blocks: 60,
      chains: 200,
      nPaths: 3,
      N0: 100,
      scatterCount: 100,
      peLength: 1000,
      seed: 42,
    })
    expect(res.chainsUsed).toBe(200)
    expect(res.divergedChains).toBe(0)
    const c0 = modalCoords(eig2x2(1, 0.99, 1).vectors, [1, 0])
    for (const k of [10, 30, 60]) {
      const pred = c0[1] * Math.pow(0.995, k)
      expect(Math.abs(res.cMean[1][k] - pred)).toBeLessThan(4 * res.cSe[1][k] + 1e-12)
    }
    expect(res.refD1[1]).toBeCloseTo(0.5, 14)
    expect(res.paths).toHaveLength(3)
    // 同 seed 可重現
    const again = simulatePeLab({
      rho: 0.99,
      dist: 'gaussian',
      detector: 'linear',
      sigmaV: 0,
      mu: 0.5,
      N: 16,
      delta0: [1, 0],
      blocks: 60,
      chains: 200,
      nPaths: 3,
      N0: 100,
      scatterCount: 100,
      peLength: 1000,
      seed: 42,
    })
    expect(Array.from(again.meanD1)).toEqual(Array.from(res.meanD1))
  })

  it('±1 sparse-flip、N = 1、μ = .5：個別軌跡呈階梯（慢模式座標只取初值或 0），ensemble 平均依 0.995^k 衰減', () => {
    const vec = eig2x2(1, 0.99, 1).vectors
    const c0 = modalCoords(vec, [1, 0])[1]
    const p = { dist: 'pm1' as const, detector: 'linear' as const, rho: 0.99, sigmaV: 0, mu: 0.5, N: 1, delta0: [1, 0] as [number, number], blocks: 400 }
    const root = createRng(3)
    let zeroed = 0
    const chains = 400
    for (let c = 0; c < chains; c++) {
      const slow: number[] = []
      runPeChain(p, root.fork(`u-${c}`), root.fork(`v-${c}`), (_k, d1, d2) => slow.push(vec[0][1] * d1 + vec[1][1] * d2))
      // 從第 1 步起每一步的慢模式座標只可能是 c0（還沒 flip）或 0（已 flip 過）
      for (const s of slow.slice(1)) expect(Math.abs(s - c0) < 1e-12 || Math.abs(s) < 1e-12).toBe(true)
      if (Math.abs(slow[400]) < 1e-12) zeroed++
    }
    const pZero = 1 - Math.pow(0.995, 400)
    const se = Math.sqrt((pZero * (1 - pZero)) / chains)
    expect(Math.abs(zeroed / chains - pZero)).toBeLessThan(4 * se)
  })

  it('預算保護：chains·blocks·N 超過 budget 時自動減少 chains 並回報', () => {
    const res = simulatePeLab({
      rho: 0.5,
      dist: 'pm1',
      detector: 'sign',
      sigmaV: 100,
      mu: 50,
      N: 1000,
      delta0: [1, 1],
      blocks: 100,
      chains: 50,
      nPaths: 2,
      N0: 50,
      scatterCount: 10,
      peLength: 200,
      seed: 1,
      budget: 1e6,
    })
    expect(res.budgetTruncated).toBe(true)
    expect(res.chainsUsed).toBe(10)
    expect(res.blocksUsed).toBe(100)
    // 連 2 條 chain 都放不下時縮短 blocks
    const res2 = simulatePeLab({
      rho: 0.5,
      dist: 'pm1',
      detector: 'linear',
      sigmaV: 0,
      mu: 0.5,
      N: 4000,
      delta0: [1, 1],
      blocks: 1000,
      chains: 10,
      nPaths: 1,
      N0: 50,
      scatterCount: 10,
      peLength: 200,
      seed: 1,
      budget: 1e6,
    })
    expect(res2.blocksUsed).toBe(125)
    expect(res2.chainsUsed).toBe(2)
    expect(res2.meanD1).toHaveLength(126)
  })
})

describe('pe：入門手算表', () => {
  it('u 固定為 (1, 1)、a = (3, 1)、μ = .25：w → (2, 2)，誤差歸零但兩個參數都錯（δ ∥ (1, −1)）', () => {
    const rows = lmsHandSteps({ a: [3, 1], w0: [0, 0], mu: 0.25, us: Array.from({ length: 40 }, () => [1, 1] as [number, number]) })
    expect(rows[0].e).toBe(4)
    expect(rows[0].wNext).toEqual([1, 1])
    expect(rows[1].e).toBe(2)
    expect(rows[1].wNext).toEqual([1.5, 1.5])
    const last = rows[rows.length - 1].wNext
    expect(last[0]).toBeCloseTo(2, 10)
    expect(last[1]).toBeCloseTo(2, 10)
  })
})

describe('pe：§9.2 GOS / PHOS gauge freedom（勘誤 E04）', () => {
  it('raw-x：θ 與 θ + c·(1,−1,−1,−1,−1) 的輸出逐 sample 相同；R_x 恰一個零 eigenvalue，null vector ∝ n', () => {
    const r = gaugeAnalysis({ ...BASE_GAUGE, path: 'none' })
    expect(r.maxDiffRawGauge).toBeLessThan(1e-14)
    expect(r.maxDiffRawB).toBeCloseTo(0.4, 12) // 只動 b：raw domain 看得到
    expect(r.eigRx.filter((v) => Math.abs(v) < 1e-9)).toHaveLength(1)
    expect(r.nullRx[0]).toHaveLength(1)
    const n = gaugeNullVector(4)
    const col = r.nullRx.map((row) => row[0])
    const scale = col[0] / n[0]
    col.forEach((v, i) => expect(v).toBeCloseTo(scale * n[i], 9))
    expect(r.residual.nOnRx).toBeLessThan(1e-12)
    // 解析值 {5/4, 1/4, 1/4, 1/4, 0}
    expect(r.eigRxAnalytic).toEqual([1.25, 0.25, 0.25, 0.25, 0])
    r.eigRx.forEach((v, i) => expect(Math.abs(v - r.eigRxAnalytic[i])).toBeLessThan(0.02))
  })

  it('u-domain（type-II H_PD，H(1) = 0）：R_u 有兩個零 eigenvalue，b 只動也看不到；非零 eigenvalue ≈ ‖h‖²/4', () => {
    const r = gaugeAnalysis(BASE_GAUGE)
    expect(Math.abs(r.dcGain)).toBeLessThan(1e-12)
    expect(r.eigRu.filter((v) => Math.abs(v) < 1e-9)).toHaveLength(2)
    expect(r.nullRu[0]).toHaveLength(2)
    expect(r.residual.ebOnRu).toBeLessThan(1e-9)
    expect(r.residual.cmOnRu).toBeLessThan(1e-9)
    expect(r.maxDiffPdGauge).toBeLessThan(1e-12)
    expect(r.maxDiffPdB).toBeLessThan(1e-9)
    const nz = r.eigRu.filter((v) => Math.abs(v) > 1e-9)
    expect(nz).toHaveLength(3)
    nz.forEach((v) => expect(Math.abs(v - r.hNorm2 / 4) / (r.hNorm2 / 4)).toBeLessThan(0.04))
    // DPLL 差分方程的 H_PD 有 peaking ⇒ ‖h‖² 略大於 1；bilinear 版本（E04 的設定）約 0.98
    expect(r.hNorm2).toBeGreaterThan(1)
    expect(r.hNorm2).toBeLessThan(1.1)
    const bl = gaugeAnalysis({ ...BASE_GAUGE, pllMethod: 'bilinear' })
    expect(bl.hNorm2).toBeGreaterThan(0.95)
    expect(bl.hNorm2).toBeLessThan(1)
    expect(bl.eigRu.filter((v) => Math.abs(v) < 1e-9)).toHaveLength(2)
    // C = E[x̃ũᵀ] 也有 2 維 null space
    expect(r.svC.filter((s) => s < 1e-6)).toHaveLength(2)
  })

  it('約束比較：raw-x 固定 a₀ 或 Σa=0 即可辨識；u-domain 仍剩 b 一個零方向，需「不更新 b ＋ 固定 a₀」', () => {
    const r = gaugeAnalysis(BASE_GAUGE)
    const row = (id: string) => r.constraints.find((c) => c.id === id)!
    expect(row('none').rawNull).toBe(1)
    expect(row('none').pdNull).toBe(2)
    expect(row('ref').rawNull).toBe(0)
    expect(row('ref').pdNull).toBe(1)
    expect(row('sumzero').rawNull).toBe(0)
    expect(row('sumzero').pdNull).toBe(1)
    expect(row('dropb').rawNull).toBe(0)
    expect(row('dropb').pdNull).toBe(1)
    expect(row('dropb_ref').rawNull).toBe(0)
    expect(row('dropb_ref').pdNull).toBe(0)
  })

  it('LMS（M = μI）raw-x：null 分量 n̂ᵀw 永遠等於初值；不同初值收斂到差一個 gauge 平移的兩組參數', () => {
    const r = gaugeAnalysis({ ...BASE_GAUGE, sigmaV: 0.05, blocks: 200 })
    const [A, B] = r.lms.runs
    for (const run of [A, B]) {
      const p0 = run.nullProj[0]
      run.nullProj.forEach((v) => expect(Math.abs(v - p0)).toBeLessThan(1e-12))
    }
    const diff = A.final.map((v, i) => v - B.final[i])
    const n = gaugeNullVector(4)
    const nn = Math.hypot(...n)
    const cos = diff.reduce((s, d, i) => s + (d * n[i]) / nn, 0) / Math.hypot(...diff)
    expect(Math.abs(cos)).toBeGreaterThan(0.999)
  })

  it('u-domain、raw x̃ GMAC、有雜訊：w_b 沒有恢復力而 random walk；filtered ũ GMAC 則 w_b 凍結', () => {
    const raw = gaugeAnalysis({ ...BASE_GAUGE, gmacReg: 'raw', sigmaV: 0.5, blocks: 300, N: 16, mu: 0.2, seed: 9 })
    const runC = raw.lms.runs[2]
    expect(runC.domain).toBe('pd')
    const driftRaw = Math.abs(runC.wb[300] - runC.wb[0])
    expect(driftRaw).toBeGreaterThan(0.05 * raw.lms.driftStdPred)
    // random walk 的 RMS 漂移 ≈ μσ_v√(K/N)（20 個 seed；RMS 的相對標準差約 1/√40 ≈ 16%，取 ±45% 帶）
    const drifts: number[] = []
    for (let sd = 1; sd <= 20; sd++) {
      const r = gaugeAnalysis({ ...BASE_GAUGE, gmacReg: 'raw', sigmaV: 0.1, blocks: 400, N: 16, mu: 0.2, T: 12000, seed: sd })
      const c = r.lms.runs[2]
      drifts.push(c.wb[c.wb.length - 1] - c.wb[0])
    }
    const pred = 0.2 * 0.1 * Math.sqrt(400 / 16)
    const rms = Math.sqrt(drifts.reduce((acc, x) => acc + x * x, 0) / drifts.length)
    expect(rms / pred).toBeGreaterThan(0.55)
    expect(rms / pred).toBeLessThan(1.45)
    const filt = gaugeAnalysis({ ...BASE_GAUGE, gmacReg: 'filtered', sigmaV: 0.5, blocks: 300, N: 16, mu: 0.2, seed: 9 })
    const runF = filt.lms.runs[2]
    expect(Math.abs(runF.wb[300] - runF.wb[0])).toBeLessThan(1e-6)
  })

  it('raw x̃ GMAC 的漂移預測：type-II 的 step-response 總和 S = 0（純 random walk）；type-I 的 S = 1/(1 − r) 使步進被阻尼 1/(1 + 1.25·μS/N)', () => {
    const t2 = gaugeAnalysis({ ...BASE_GAUGE, gmacReg: 'raw', sigmaV: 0.1 })
    expect(Math.abs(t2.hStepSum)).toBeLessThan(1e-6)
    expect(t2.lms.driftDamping).toBeCloseTo(1, 6)
    expect(t2.lms.driftStdPred).toBeCloseTo(0.5 * 0.1 * Math.sqrt(120 / 64), 6)
    expect(gaugeAnalysis({ ...BASE_GAUGE, path: 'none' }).hStepSum).toBe(0)
    // type-I（r = 0.95）：S = 1/(1 − r) = 20；μ = 1、N = 8 ⇒ 阻尼 1/(1 + 1.25·20/8) = 0.2424
    const cfg = { ...BASE_GAUGE, path: 'type1' as const, hpPole: 0.95, gmacReg: 'raw' as const, mu: 1, N: 8, blocks: 1000, T: 12000 }
    const one = gaugeAnalysis({ ...cfg, sigmaV: 0.1 })
    expect(one.hStepSum).toBeCloseTo(20, 6)
    expect(one.lms.driftDamping).toBeCloseTo(1 / (1 + (1.25 * 1 * 20) / 8), 9)
    expect(gaugeDriftStd({ mu: 1, sigmaV: 0.1, N: 8, blocks: 1000, P: 4, stepSum: 20 }).std).toBeCloseTo(one.lms.driftStdPred, 12)
    // MC（24 個 seed，與 σ_v = 0 的同序列 run 相減只留下雜訊驅動的漂移）：RMS 的相對標準差 ≈ 1/√48 ≈ 14%，取 ±45% 帶
    const drifts: number[] = []
    for (let sd = 1; sd <= 24; sd++) {
      const noisy = gaugeAnalysis({ ...cfg, sigmaV: 0.1, seed: sd }).lms.runs[2]
      const clean = gaugeAnalysis({ ...cfg, sigmaV: 0, seed: sd }).lms.runs[2]
      drifts.push(noisy.wb[noisy.wb.length - 1] - clean.wb[clean.wb.length - 1])
    }
    const rms = Math.sqrt(drifts.reduce((acc, x) => acc + x * x, 0) / drifts.length)
    expect(rms / one.lms.driftStdPred).toBeGreaterThan(0.55)
    expect(rms / one.lms.driftStdPred).toBeLessThan(1.45)
    // 反面：未加阻尼的 μσ_v√(K/N) 會高估約 4 倍
    expect(rms / (1 * 0.1 * Math.sqrt(1000 / 8))).toBeLessThan(0.4)
  })

  it('cyclic 序列與 type-I high-pass：null space 仍是 2 維（結構性），R_u 沒有 iid 解析式', () => {
    const cyc = gaugeAnalysis({ ...BASE_GAUGE, sequence: 'cyclic' })
    expect(cyc.eigRuAnalytic).toBeNull()
    expect(cyc.eigRu.filter((v) => Math.abs(v) < 1e-9)).toHaveLength(2)
    expect(cyc.eigRx.filter((v) => Math.abs(v) < 1e-9)).toHaveLength(1)
    cyc.eigRx.forEach((v, i) => expect(Math.abs(v - cyc.eigRxAnalytic[i])).toBeLessThan(1e-3))
    const t1 = gaugeAnalysis({ ...BASE_GAUGE, path: 'type1', hpPole: 0.9 })
    expect(Math.abs(t1.dcGain)).toBeLessThan(1e-15)
    expect(t1.eigRu.filter((v) => Math.abs(v) < 1e-9)).toHaveLength(2)
    // type-I（pole r）：‖h‖² = 1 + (1−r)²/(1−r²) = 2/(1+r)
    expect(t1.hNorm2).toBeCloseTo(2 / 1.9, 9)
  })

  it('反面測試：暖機不足（type-I pole r = 0.999、skip = 500）時要警告 u-domain 統計仍含 step 暫態；預設設定沒有這個警告', () => {
    const short = gaugeAnalysis({ ...BASE_GAUGE, path: 'type1', hpPole: 0.999, skip: 500, T: 20000, blocks: 20 })
    expect(short.warnings.some((w) => w.includes('暖機不足'))).toBe(true)
    // 暫態未消失 ⇒ 「只動 b」在 u-domain 仍看得到一點
    expect(short.maxDiffPdB).toBeGreaterThan(1e-3)
    const ok = gaugeAnalysis(BASE_GAUGE)
    expect(ok.warnings.some((w) => w.includes('暖機不足'))).toBe(false)
  })

  it('one-hot regressor：每個 sample Σx_i = 1 ⇒ x̃ᵀn = 0', () => {
    const X = gaugeRegressorsRaw([0, 3, 2, 1, 1, 0], 4)
    const n = gaugeNullVector(4)
    for (let t = 0; t < 6; t++) expect(X.reduce((s, col, i) => s + col[t] * n[i], 0)).toBe(0)
  })
})

describe('pe：peAnalytic 摘要', () => {
  it('ρ = .99、g = .5、N = 16：閉式 vs Jacobi 一致，k95 = 598，近似 3/(gλ_min) ≈ 599', () => {
    const a = peAnalytic({ rho: 0.99, dist: 'gaussian', g: 0.5, N: 16, N0: 100 })
    expect(a.eigAgreement).toBeLessThan(1e-12)
    expect(a.k95Slow).toBe(598)
    expect(a.k95SlowApprox).toBeCloseTo(Math.log(20) / 0.005, 9)
    expect(a.meanRadius).toBeCloseTo(0.995, 14)
    expect(a.msRadius).toBeLessThan(1)
    expect(a.gOpt).toBeCloseTo(1, 12)
  })
})
