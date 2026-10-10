import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRng, meanCI } from '@/simulation/core'
import {
  DEFAULT_CAL_SM,
  asymptoticFinalOptimum,
  asymptoticRampOptimum,
  asymptoticRwOptimum,
  binomialSample,
  budgetSplit,
  calBandwidth3dB,
  calPhaseMarginDeg,
  comparatorKq,
  convergenceMuMin,
  cornerContraction,
  cornerInterval,
  finalCostDerivative,
  geomSum2,
  gMaxForPm,
  gmacMeanField,
  gmacModel,
  gmacVariance,
  integratedMsd,
  loopGainK,
  measureCornerSlopes,
  measureSlope,
  msdAfterBlocks,
  msdRecursion,
  msdSplit,
  objectiveCost,
  optimalSchedule,
  optimizeMu,
  optimizeTwoPhase,
  runCalStateMachine,
  runCalStateMachineMonteCarlo,
  runMsdMonteCarlo,
  runScheduleMonteCarlo,
  settleBlock,
  signGmacBlock,
  slopeTruncationBias,
  traceBlockIndices,
  twoPhaseMsd,
  type CalSmParams,
  type DesignModel,
} from './optimizer'

interface Vector {
  inputs: Record<string, unknown>
  expected: Record<string, number | number[]>
  tolerance: { abs?: number; rel?: number }
}

function vector(name: string): Vector {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'golden/vectors', `${name}.json`), 'utf8')) as Vector
}

function within(actual: number, expected: number, tol: { abs?: number; rel?: number }): boolean {
  return Math.abs(actual - expected) <= (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(expected)
}

/** 第 10 課設計計算器：δ0 = 3 fs、σ_v = 100 fs、N = 4096、總比較次數 131072 ⇒ B = 32、θ = 0 */
const LESSON10: DesignModel = { K: loopGainK(100, 0), delta0: 3, sigmaEta2: 1 / 4096, B: 131072 / 4096 }

describe('§14 E[δ_B²]：bias² + variance（F-14.3；勘誤 E48）', () => {
  it('與 golden msd_after_blocks.json 一致（rel 1e-11）', () => {
    const v = vector('msd_after_blocks')
    const inp = v.inputs as { delta0_fs: number; mu_fs: number; kq_per_fs: number; sigma_eta2: number; B_list: number[] }
    expect(comparatorKq(100)).toBeCloseTo(inp.kq_per_fs, 15)
    const p = 1 - inp.mu_fs * inp.kq_per_fs
    expect(within(p, v.expected.p as number, v.tolerance)).toBe(true)
    const list = v.expected.msd_list as number[]
    inp.B_list.forEach((B, i) => {
      expect(within(msdAfterBlocks(inp.delta0_fs, p, inp.mu_fs, inp.sigma_eta2, B), list[i], v.tolerance)).toBe(true)
    })
  })

  it('T13: 穩態極限（B → ∞）等於 §12.1 的 σ_w² = μ²σ_η²/(1 − p²)（golden T13：p = 0.92021、σ_w = 0.399 fs）', () => {
    const v = vector('T13')
    const p = v.expected.p as number
    const s2 = msdAfterBlocks(0, p, 10, 1 / 4096, 1e6)
    expect(within(s2, v.expected.sigma_w2_fs2 as number, { abs: 1e-12 })).toBe(true)
    // 由本章的 K = K_q·C 與 g = μK 重新算 p 與 σ_w（F-14.6），與 golden 一致
    const K = loopGainK(100, 0)
    expect(within(K, v.expected.K_per_fs as number, v.tolerance)).toBe(true)
    expect(within(1 - 10 * K, p, v.tolerance)).toBe(true)
    expect(within(Math.sqrt((10 * (1 / 4096)) / (K * (2 - 10 * K))), v.expected.sigma_w_fs as number, { abs: 1e-12 })).toBe(true)
  })

  it('封閉式 = 逐 block 遞迴（含 p < 0 的振盪區；E48：線性模型對任意 p 皆精確）', () => {
    for (const p of [0.95, 0.5, 0, -0.3, -0.9]) {
      const rec = msdRecursion(7, p, 12, 1 / 1024, 40)
      for (const B of [0, 1, 2, 5, 17, 40]) expect(msdAfterBlocks(7, p, 12, 1 / 1024, B)).toBeCloseTo(rec[B], 10)
    }
  })

  it('bias² + variance 分解：bias² = (p^B δ0)²，總和等於 msdAfterBlocks', () => {
    const p = 1 - 10 * LESSON10.K
    const s = msdSplit(3, p, 10, 1 / 4096, 32)
    expect(s.bias2).toBeCloseTo((Math.pow(p, 32) * 3) ** 2, 14)
    expect(s.total).toBeCloseTo(msdAfterBlocks(3, p, 10, 1 / 4096, 32), 14)
  })

  it('|p| = 1 極限（E48）：g = 0（C = 0）或 g = 2 時 E[δ_B²] = δ0² + Bμ²σ_η²（不是 0/0）', () => {
    expect(geomSum2(1, 25)).toBe(25)
    expect(geomSum2(-1, 25)).toBe(25)
    expect(msdAfterBlocks(3, 1, 10, 1 / 4096, 32)).toBeCloseTo(9 + (32 * 100) / 4096, 12)
    expect(msdAfterBlocks(3, -1, 10, 1 / 4096, 32)).toBeCloseTo(9 + (32 * 100) / 4096, 12)
    // 極限是連續的：p = 1 − 1e-12 時 Σq^k ≈ B − (1 − q)·B(B − 1)/2 = 1000 − 2e-12·499500
    expect(geomSum2(1 - 1e-12, 1000)).toBeCloseTo(1000 - 2e-12 * 499500, 8)
    expect(geomSum2(0, 5)).toBe(1)
    expect(geomSum2(0.7, 0)).toBe(0)
  })

  it('geomSum2 與直接加總一致（隨機 p、B）', () => {
    const rng = createRng(14)
    for (let i = 0; i < 200; i++) {
      const p = rng.uniform() * 2.2 - 1.1
      const B = rng.int(1, 60)
      let s = 0
      for (let k = 0; k < B; k++) s += Math.pow(p * p, k)
      expect(Math.abs(geomSum2(p, B) - s)).toBeLessThanOrEqual(1e-9 * Math.max(1, s))
    }
  })

  it('integratedMsd 封閉式（含 q ≈ 1 泰勒分支）= 逐項加總', () => {
    for (const [p, B] of [
      [0.9, 32],
      [0.3, 10],
      [-0.5, 12],
      [1 - 1e-9, 200],
      [1, 50],
    ] as const) {
      const rec = msdRecursion(3, p, 8, 1 / 2048, B)
      let s = 0
      for (let k = 1; k <= B; k++) s += rec[k]
      expect(integratedMsd(3, p, 8, 1 / 2048, B)).toBeCloseTo(s, 7)
    }
  })
})

describe('最佳 μ：第 10 課設計計算器的重算', () => {
  it('解析導數 dJ/dμ = 中央差分；並在數值最佳點為 0', () => {
    for (const mu of [3, 10, 30, 80]) {
      const h = 1e-5
      const fd = (objectiveCost('final', mu + h, LESSON10) - objectiveCost('final', mu - h, LESSON10)) / (2 * h)
      expect(finalCostDerivative(mu, LESSON10)).toBeCloseTo(fd, 7)
    }
    const opt = optimizeMu('final', LESSON10)
    expect(Math.abs(finalCostDerivative(opt.mu, LESSON10))).toBeLessThan(1e-7)
  })

  it('精確最佳 μ* = 10.664 fs、RMS 0.4474 fs、pole 0.9149、PM 87.56°（第 10 課寫 11.20 fs / 0.449 fs，見本章說明）', () => {
    const opt = optimizeMu('final', LESSON10)
    expect(opt.feasible).toBe(true)
    expect(opt.mu).toBeCloseTo(10.6642, 3)
    expect(Math.sqrt(opt.cost)).toBeCloseTo(0.44744, 4)
    expect(opt.p).toBeCloseTo(0.91491, 4)
    expect(opt.pmDeg).toBeCloseTo(87.5617, 3)
    expect(opt.atBoundary).toBeNull()
  })

  it('代入第 10 課的 α = 11.20 fs：RMS 0.449 fs、pole 0.9106、PM 87.4°（與課程數字相符）', () => {
    const mu = 11.2
    const g = mu * LESSON10.K
    expect(Math.sqrt(objectiveCost('final', mu, LESSON10))).toBeCloseTo(0.449, 3)
    expect(1 - g).toBeCloseTo(0.9106, 4)
    expect(calPhaseMarginDeg(g)).toBeCloseTo(87.44, 2)
    // 曲線很平：11.20 比真正最佳點只差 0.3% RMS
    const ratio = Math.sqrt(objectiveCost('final', mu, LESSON10) / optimizeMu('final', LESSON10).cost)
    expect(ratio).toBeGreaterThan(1)
    expect(ratio).toBeLessThan(1.004)
  })

  it('大 B 封閉近似 μ* ≈ ln A/(2BK) = 11.17 fs（A ≈ 300.4），與 11.20 相近、與精確解差 < 5%', () => {
    const a = asymptoticFinalOptimum(LESSON10)
    expect(a.A).toBeCloseTo(300.3949, 3)
    expect(a.mu).toBeCloseTo(11.1723, 3)
    expect(a.valid).toBe(true)
    const exact = optimizeMu('final', LESSON10)
    expect(Math.abs(a.mu / exact.mu - 1)).toBeLessThan(0.05)
    expect(Math.abs(a.cost / exact.cost - 1)).toBeLessThan(0.01)
  })

  it('不同目標 ⇒ 不同最佳 μ（fastest > integrated > final > trackRamp > trackRw）', () => {
    const m: DesignModel = { ...LESSON10, eps: 0.05, spurOmega: 0.5, driftRate: 0.002, driftSigma: 0.02 }
    const mu = Object.fromEntries((['final', 'fastest', 'integrated', 'spur', 'trackRamp', 'trackRw'] as const).map((o) => [o, optimizeMu(o, m).mu]))
    expect(mu.fastest).toBeCloseTo(1 / LESSON10.K, 9) // g = 1：deadbeat
    expect(mu.fastest).toBeGreaterThan(mu.integrated)
    expect(mu.integrated).toBeGreaterThan(mu.final)
    expect(mu.final).toBeGreaterThan(mu.trackRamp)
    expect(mu.trackRamp).toBeGreaterThan(mu.trackRw)
    expect(mu.spur).toBeCloseTo(convergenceMuMin(LESSON10.K, 0.05, 32), 9)
  })

  it('spur 成本（係數雜訊 PSD）在 0 < g < 2 隨 μ 單調遞增 ⇒ 最佳點是收斂要求的下限', () => {
    for (const om of [0.05, 0.5, 2, 3]) {
      let prev = 0
      for (let i = 1; i <= 400; i++) {
        const mu = (i / 400) * (1.99 / LESSON10.K)
        const c = objectiveCost('spur', mu, { ...LESSON10, spurOmega: om })
        expect(c).toBeGreaterThan(prev)
        prev = c
      }
    }
  })

  it('追蹤目標：小 g 近似 μ* ≈ (4r²/(Kσ_η²))^{1/3}（ramp）與 μ* ≈ σ_ζ/σ_η（random walk）', () => {
    const ramp: DesignModel = { ...LESSON10, driftRate: 0.0005 }
    expect(optimizeMu('trackRamp', ramp).mu / asymptoticRampOptimum(ramp)).toBeCloseTo(1, 1)
    const rw: DesignModel = { ...LESSON10, driftSigma: 0.005 }
    const a = asymptoticRwOptimum(rw)
    expect(optimizeMu('trackRw', rw).mu / a.mu).toBeCloseTo(1, 1)
  })

  it('反面：C ≤ 0（θ ≥ 90°）⇒ 不可行並解釋極性；B = 0 ⇒ 預算不足；spur 的 ε ≥ 1 被拒絕（E16）', () => {
    const bad = optimizeMu('final', { ...LESSON10, K: loopGainK(100, 120) })
    expect(bad.feasible).toBe(false)
    expect(bad.reason).toMatch(/C ≤ 0：更新極性錯誤/)
    expect(optimizeMu('final', { ...LESSON10, B: 0 }).reason).toMatch(/B=0/)
    expect(optimizeMu('spur', { ...LESSON10, eps: 1 }).reason).toMatch(/0<\\epsilon<1/)
    // PM ≥ 60° 時 g = 1 可一步到位，任何 ε 都可行；PM ≥ 75°（g ≤ 0.518）時 ε = 1e-30 在 B = 32 內做不到
    expect(optimizeMu('spur', { ...LESSON10, eps: 1e-30 }).feasible).toBe(true)
    const tight = optimizeMu('spur', { ...LESSON10, eps: 1e-30 }, { pmTargetDeg: 75 })
    expect(tight.feasible).toBe(false)
    expect(tight.reason).toMatch(/超過 PM 限制/)
  })

  it('T08: 一階 calibration loop：g = 1 ⇒ pole 0、PM 60°；PM 表與 golden T08 一致（F-14.14）', () => {
    const v = vector('T08')
    const gs = (v.inputs as { g_list: number[] }).g_list
    const poles = v.expected.pole_list as number[]
    const pms = v.expected.pm_deg_list as number[]
    gs.forEach((g, i) => {
      expect(within(1 - g, poles[i], v.tolerance)).toBe(true)
      expect(within(calPhaseMarginDeg(g), pms[i], v.tolerance)).toBe(true)
    })
    expect(within(calPhaseMarginDeg(1), v.expected.pm_deg as number, v.tolerance)).toBe(true)
    // F-14.14 的反函數：g_max(PM_t) 代回得到 PM_t
    for (const pm of [60, 65, 70, 75, 84.26082952273322]) expect(calPhaseMarginDeg(gMaxForPm(pm))).toBeCloseTo(pm, 10)
  })

  it('PM 目標：PM ≥ 60° ⇔ g ≤ 1；PM ≥ 75° ⇔ g ≤ 2cos75°；calPhaseMarginDeg(1) = 60°', () => {
    expect(gMaxForPm(60)).toBe(1)
    expect(gMaxForPm(75)).toBeCloseTo(2 * Math.cos((75 * Math.PI) / 180), 14)
    expect(calPhaseMarginDeg(1)).toBeCloseTo(60, 12)
    expect(calPhaseMarginDeg(gMaxForPm(75))).toBeCloseTo(75, 10)
    expect(Number.isNaN(calPhaseMarginDeg(2.5))).toBe(true)
  })
})

describe('§14.1 Corner-based 區間（勘誤 E16）', () => {
  it('與 golden msd_after_blocks.json 的 corner 例子一致', () => {
    const v = vector('msd_after_blocks')
    const c = (v.inputs as { corner: { k_min: number; k_max: number; eps: number; B: number } }).corner
    const r = cornerInterval([c.k_min, c.k_max], c.eps, c.B)
    expect(within(r.muLo, v.expected.corner_mu_lo as number, v.tolerance)).toBe(true)
    expect(within(r.muHi, v.expected.corner_mu_hi as number, v.tolerance)).toBe(true)
    expect(r.nonEmpty).toBe(true)
  })

  it('E16 例：K_min/K_max = 1/3、ε = 0.01 ⇒ B ≥ 11.358 → 12；B = 12 非空 [79.677, 83.333]、B = 11 為空', () => {
    const r12 = cornerInterval([0.004, 0.008, 0.012], 0.01, 12)
    expect(r12.bMinExact).toBeCloseTo(11.3577, 3)
    expect(r12.bMin).toBe(12)
    expect(r12.nonEmpty).toBe(true)
    expect(r12.muLo).toBeCloseTo(79.677, 3)
    expect(r12.muHi).toBeCloseTo(83.3333, 3)
    expect(cornerInterval([0.004, 0.012], 0.01, 11).nonEmpty).toBe(false)
  })

  it('E16 其他數值：r = 0.5、ε = 0.001 ⇒ B ≥ 9.966 → 10；K_min = 0.00797885、B = 30、ε = 0.02 ⇒ μ_min = 15.3226 fs', () => {
    const r = cornerInterval([0.005, 0.01], 0.001, 10)
    expect(r.bMinExact).toBeCloseTo(9.966, 3)
    expect(r.bMin).toBe(10)
    expect(cornerInterval([0.00797885, 0.01], 0.02, 30).muLo).toBeCloseTo(15.3226, 3)
  })

  it('非空 ⇔ B ≥ ⌈ln ε/ln(1 − g_max r)⌉（隨機 5000 組，含 PM 目標 60°–80°）', () => {
    const rng = createRng(1601)
    let mismatches = 0
    for (let i = 0; i < 5000; i++) {
      const kMax = 0.001 + rng.uniform() * 0.02
      const kMin = kMax * (0.02 + 0.98 * rng.uniform())
      const eps = Math.pow(10, -4 * rng.uniform())
      const B = rng.int(1, 300)
      const pm = 60 + 20 * rng.uniform()
      const r = cornerInterval([kMin, kMax], eps, B, pm)
      if (Math.abs(B - r.bMinExact) < 1e-6) continue // 剛好在邊界上：捨入可以任意
      if (r.nonEmpty !== B >= r.bMin) mismatches++
    }
    expect(mismatches).toBe(0)
  })

  it('區間內每個 corner 都滿足 |E[δ_B]/δ0| ≤ ε 與 μK_i ≤ g_max；區間外至少一個 corner 違反', () => {
    const Ks = [0.004, 0.006, 0.009, 0.012]
    const r = cornerInterval(Ks, 0.01, 20)
    expect(r.nonEmpty).toBe(true)
    for (const mu of [r.muLo, 0.5 * (r.muLo + r.muHi), r.muHi]) {
      for (const K of Ks) {
        expect(cornerContraction(mu, K, 20)).toBeLessThanOrEqual(0.01 * (1 + 1e-9))
        expect(mu * K).toBeLessThanOrEqual(1 + 1e-12)
      }
    }
    expect(cornerContraction(r.muLo * 0.99, 0.004, 20)).toBeGreaterThan(0.01)
    expect(r.muHi * 1.01 * 0.012).toBeGreaterThan(1)
  })

  it('反面：ε ≥ 1（把絕對誤差 1 fs 當 ε）被拒絕、K_i ≤ 0 報極性錯誤、B 非整數被拒絕', () => {
    expect(cornerInterval([0.004, 0.012], 1, 30).ok).toBe(false)
    expect(cornerInterval([0.004, 0.012], 1, 30).reason).toMatch(/0<\\epsilon<1/)
    expect(cornerInterval([0.004, 0.012], 2, 30).ok).toBe(false)
    expect(cornerInterval([0.004, -0.001], 0.01, 30).reason).toMatch(/C ≤ 0/)
    expect(cornerInterval([0.004, 0.012], 0.01, 12.5).ok).toBe(false)
  })

  it('K_min = K_max（沒有 corner 散佈）⇒ g = 1 一步到位，B ≥ 1 即可', () => {
    const r = cornerInterval([0.01, 0.01], 1e-6, 1)
    expect(r.bMin).toBe(1)
    expect(r.nonEmpty).toBe(true)
  })
})

describe('固定總預算 T = N·B 與步長排程', () => {
  it('一階近似只依賴 T：B ≥ 32 時 N 改變 RMS 幾乎不變（差 < 0.5%）；K 有 3× 不確定時 B = 2 最差情況急劇惡化', () => {
    const rows = budgetSplit({ T: 131072, Ns: [256, 1024, 4096, 65536], K: LESSON10.K, delta0: 3, kSpread: 3 })
    for (const r of rows.slice(0, 3)) {
      expect(Math.abs(r.rmsNominal / rows[2].rmsNominal - 1)).toBeLessThan(0.005)
      expect(Math.abs(r.rmsNominal / r.rmsFirstOrder - 1)).toBeLessThan(0.01)
    }
    expect(rows[3].rmsNominal).toBeLessThan(rows[2].rmsNominal) // K 已知：更新越少反而略好
    expect(rows[3].rmsRobust).toBeGreaterThan(1.5 * rows[2].rmsRobust) // K 不確定：B = 2 很糟
  })

  it('1/k（Kalman）排程：P_B = δ0²/(1 + Bδ0²K²/σ_η²)，μ_k = 1/(K(k + 1 + k₀))；且 ≤ 兩段式 ≤ 固定 μ', () => {
    const { K, delta0, sigmaEta2, B } = LESSON10
    const o = optimalSchedule(delta0, K, sigmaEta2, B)
    expect(o.P[B]).toBeCloseTo(o.PB, 12)
    expect(Math.sqrt(o.PB)).toBeCloseTo(0.3439, 3)
    for (const k of [0, 5, 31]) expect(o.mu[k]).toBeCloseTo(1 / (K * (k + 1 + o.k0)), 9)
    const two = optimizeTwoPhase(delta0, K, sigmaEta2, B)
    const fixed = optimizeMu('final', LESSON10).cost
    expect(o.PB).toBeLessThan(two.msd)
    expect(two.msd).toBeLessThan(fixed)
    expect(two.mu1).toBeGreaterThan(two.mu2) // coarse 大、fine 小
    // 大 A 時比值 J_fixed/J_Kalman ≈ (1 + ln A)/4
    const A = asymptoticFinalOptimum(LESSON10).A
    expect(fixed / o.PB).toBeCloseTo((1 + Math.log(A)) / 4, 0)
  })

  it('twoPhaseMsd：μ₁ = μ₂ 時退化成單一 μ 的 E[δ_B²]', () => {
    const { K } = LESSON10
    expect(twoPhaseMsd(3, K, 1 / 4096, 10, 12, 10, 20)).toBeCloseTo(msdAfterBlocks(3, 1 - 10 * K, 10, 1 / 4096, 32), 12)
  })
})

describe('1-bit GMAC exact binomial 引擎', () => {
  it('binomialSample 的平均與變異數符合 np、np(1−p)（含 p > ½、小 n、邊界 p）', () => {
    const rng = createRng(77)
    for (const [n, p] of [
      [4096, 0.51],
      [4096, 0.97],
      [37, 0.2],
      [1, 0.5],
      [100000, 0.5],
    ] as const) {
      const R = 6000
      const xs = new Float64Array(R)
      for (let i = 0; i < R; i++) xs[i] = binomialSample(rng, n, p)
      const ci = meanCI(xs)
      const sd = Math.sqrt(n * p * (1 - p))
      expect(Math.abs(ci.mean - n * p)).toBeLessThan(5 * (sd / Math.sqrt(R)) + 1e-9)
      let v = 0
      for (const x of xs) v += (x - ci.mean) ** 2
      expect(v / (R - 1) / (sd * sd)).toBeGreaterThan(0.9)
      expect(v / (R - 1) / (sd * sd)).toBeLessThan(1.1)
    }
    expect(binomialSample(rng, 50, 0)).toBe(0)
    expect(binomialSample(rng, 50, 1)).toBe(50)
  })

  it('binomialSample 的分布（n = 10、p = 0.3）通過 χ² 檢定', () => {
    const rng = createRng(78)
    const R = 40000
    const counts = new Array(11).fill(0) as number[]
    for (let i = 0; i < R; i++) counts[binomialSample(rng, 10, 0.3)]++
    let chi2 = 0
    let c = 1
    for (let k = 0; k <= 10; k++) {
      if (k > 0) c = (c * (10 - k + 1)) / k
      const e = R * c * Math.pow(0.3, k) * Math.pow(0.7, 10 - k)
      if (e > 5) chi2 += (counts[k] - e) ** 2 / e
    }
    expect(chi2).toBeLessThan(30) // df ≈ 8，p ≈ 2e-4 的門檻
  })

  it('signGmacBlock：E[G] = mean-field、Var(G) = (1 − E[G]²)/N（θ = 0 與 θ = 60° 的正交分量）', () => {
    const rng = createRng(79)
    for (const theta of [0, 60]) {
      const m = gmacModel(256, 100, theta)
      for (const delta of [0, 30, 150]) {
        const R = 6000
        const g = new Float64Array(R)
        for (let i = 0; i < R; i++) g[i] = signGmacBlock(rng, delta, m)
        const ci = meanCI(g)
        const sd = Math.sqrt(gmacVariance(delta, m))
        expect(Math.abs(ci.mean - gmacMeanField(delta, m))).toBeLessThan(5 * (sd / Math.sqrt(R)))
        expect(ci.se * Math.sqrt(R) / sd).toBeCloseTo(1, 1)
      }
    }
  })

  it('小 δ 時 mean-field 斜率 = K_q·C（C = cos θ）', () => {
    const m = gmacModel(4096, 100, 45)
    const d = 1e-3
    expect((gmacMeanField(d, m) - gmacMeanField(-d, m)) / (2 * d)).toBeCloseTo(loopGainK(100, 45), 9)
  })

  it('Monte Carlo：δ0 = 3 fs ≪ σ_v 時 E[δ_B²] 與線性公式一致（2000 chains、95% CI）', () => {
    const res = runMsdMonteCarlo({ seed: 2026, sigmaV: 100, N: 4096, thetaDeg: 0, delta0: 3, B: 32, mus: [5, 10.664, 25], chains: 2000, traceIndex: 1, blockLmsRuns: 0 })
    for (let i = 0; i < 3; i++) {
      const half = (res.hi[i] - res.lo[i]) / 2
      expect(Math.abs(res.msd[i] - res.linear[i])).toBeLessThan(2 * half) // ≈ 4σ
    }
    expect(res.blockLms).toBeNull()
    expect(res.trace.msd[0]).toBeCloseTo(9, 12)
  })

  it('反面（E48）：δ0 = 2σ_v 時 comparator 飽和，線性公式嚴重低估（validation：MC 569.9 vs 272.6 fs²）', () => {
    const res = runMsdMonteCarlo({ seed: 48, sigmaV: 100, N: 4096, thetaDeg: 0, delta0: 200, B: 30, mus: [10], chains: 2000, traceIndex: 0, blockLmsRuns: 0 })
    expect(res.linear[0]).toBeCloseTo(272.6, 0)
    expect(res.msd[0] / res.linear[0]).toBeGreaterThan(1.8)
    expect(Math.abs(res.msd[0] / 569.9 - 1)).toBeLessThan(0.08)
  })

  it('sample-level blockLms（唯讀共用模型）與 exact binomial 引擎一致', () => {
    const res = runMsdMonteCarlo({ seed: 7, sigmaV: 100, N: 256, thetaDeg: 30, delta0: 20, B: 24, mus: [40], chains: 3000, traceIndex: 0, blockLmsRuns: 300 })
    const bl = res.blockLms
    expect(bl).not.toBeNull()
    if (!bl) return
    const se = Math.hypot((res.hi[0] - res.lo[0]) / 3.92, (bl.hi - bl.lo) / 3.92)
    expect(Math.abs(bl.msdB - res.msd[0])).toBeLessThan(4 * se)
  })

  it('三種排程 MC：1/k < two-phase < fixed，且各自與線性解析曲線一致', () => {
    const { K } = LESSON10
    const two = optimizeTwoPhase(3, K, 1 / 4096, 32)
    const fixed = optimizeMu('final', LESSON10).mu
    const res = runScheduleMonteCarlo({ seed: 3, sigmaV: 100, N: 4096, thetaDeg: 0, delta0: 3, B: 32, muFixed: fixed, muCoarse: two.mu1, muFine: two.mu2, switchBlock: two.B1, chains: 3000 })
    const B = 32
    expect(res.inverseK[B]).toBeLessThan(res.twoPhase[B])
    expect(res.twoPhase[B]).toBeLessThan(res.fixed[B])
    for (const [mc, lin, ci] of [
      [res.fixed[B], res.linFixed[B], res.finalCI.fixed],
      [res.twoPhase[B], res.linTwoPhase[B], res.finalCI.twoPhase],
      [res.inverseK[B], res.linInverseK[B], res.finalCI.inverseK],
    ] as const) {
      expect(Math.abs(mc - lin)).toBeLessThan(ci[1] - ci[0]) // ≈ 4σ
    }
  })

  it('斜率量測的標準誤 se = σ_η/(Δ√(2M)) 與重複量測的實際標準差一致', () => {
    const m = gmacModel(1024, 100, 0)
    const rng = createRng(11)
    const R = 600
    const ks = new Float64Array(R)
    let se = 0
    for (let i = 0; i < R; i++) {
      const r = measureSlope(rng, 0, m, 10, 8)
      ks[i] = r.kHat
      se = r.se
    }
    const sd = meanCI(ks).se * Math.sqrt(R)
    expect(se).toBeCloseTo(Math.sqrt(1 / (2 * 1024 * 8)) / 10, 15)
    expect(sd / se).toBeGreaterThan(0.9)
    expect(sd / se).toBeLessThan(1.1)
  })

  it('斜率量測（6 步流程）：K̂ ≈ K_q c(1 − (Δc)²/(6σ²))；θ = 120° 時 K̂ < 0（極性錯誤被偵測）', () => {
    const m = gmacModel(4096, 100, 0)
    const r = measureSlope(createRng(5), 0, m, 30, 400)
    const expectK = comparatorKq(100) * (1 - 0.09 / 6)
    expect(Math.abs(r.kHat - expectK)).toBeLessThan(4 * r.se)
    const res = measureCornerSlopes({ seed: 9, N: 4096, Delta: 20, M: 200, corners: [{ sigmaV: 80, thetaDeg: 0 }, { sigmaV: 120, thetaDeg: 120 }] })
    expect(res.kHat[0]).toBeGreaterThan(0)
    expect(res.kHat[1]).toBeLessThan(0)
    expect(Math.abs(res.kHat[0] - res.kMeanField[0])).toBeLessThan(4 * res.se[0])
  })
})

describe('§14.2 Calibration State Machine', () => {
  const quick = (patch: Partial<CalSmParams> = {}): CalSmParams => ({ ...DEFAULT_CAL_SM, ...patch })

  it('預設情境：RESET → LOCK → COARSE → VERIFY → FINE → TRACK，低雜訊視窗內係數不動', () => {
    const res = runCalStateMachine(quick())
    const transitions = res.events.filter((e) => e.kind === 'state').map((e) => e.msg)
    expect(transitions.slice(0, 5)).toEqual(['RESET → LOCK', 'LOCK → COARSE', 'COARSE → VERIFY', 'VERIFY → FINE', 'FINE → TRACK'])
    expect(res.summary.firstTrackBlock).toBeGreaterThan(0)
    expect(res.summary.updatesInLowNoise).toBe(0)
    expect(res.summary.updatesInLowNoiseBase).toBeGreaterThan(50)
    expect(res.summary.fault).toBe(false)
  })

  it('MC：狀態機的穩態 RMS 低於「固定快 μ」、收斂快於「固定安靜 μ」（步長切換的好處）', () => {
    const mc = runCalStateMachineMonteCarlo({ config: quick(), runs: 24 })
    expect(mc.evalRms.hi).toBeLessThan(mc.evalRmsBase.lo)
    expect(mc.settle.sm).toBeGreaterThanOrEqual(0)
    expect(mc.settle.sm).toBeLessThan(mc.settle.base2)
    expect(settleBlock([5, 4, 1, 1, 1], 2, 3)).toBe(2)
    expect(settleBlock([5, 4], 2, 3)).toBe(-1)
  })

  it('PVT step（mode change）⇒ TRACK 警報 ⇒ RESTART → COARSE；無 hysteresis + 低門檻 ⇒ 誤警報較多', () => {
    const res = runCalStateMachine(quick({ stepBlock: 450, stepSize: 25 }))
    expect(res.summary.restarts).toBeGreaterThanOrEqual(1)
    expect(res.events.some((e) => e.kind === 'alarm' && e.k >= 450 && e.k < 480)).toBe(true)
    // 同樣的高門檻 3σ：有 hysteresis（低門檻 1.5σ、持續 4 個 block）時誤警報較少；預設的 6σ 則完全沒有
    const th = { alarmHiZ: 3, alarmLoZ: 1.5, alarmHold: 4 }
    const noHyst = runCalStateMachineMonteCarlo({ config: quick({ ...th, hysteresis: false }), runs: 48 })
    const hyst = runCalStateMachineMonteCarlo({ config: quick(th), runs: 48 })
    const dflt = runCalStateMachineMonteCarlo({ config: quick(), runs: 48 })
    expect(noHyst.meanRestarts).toBeGreaterThan(0.3)
    expect(noHyst.meanRestarts).toBeGreaterThan(2 * hyst.meanRestarts)
    expect(dflt.meanRestarts).toBe(0)
    // 誤警報的代價：DTC 實際誤差的評估 RMS 明顯變差
    expect(noHyst.evalRms.mean).toBeGreaterThan(2 * dflt.evalRms.mean)
  })

  it('反面（極性錯誤 θ = 120°）：COARSE 發散 ⇒ clip detect 或 VERIFY 判定 ⇒ FAULT，並退回 last-known-good／w0', () => {
    const res = runCalStateMachine(quick({ thetaDeg: 120 }))
    expect(res.summary.fault).toBe(true)
    expect(res.events.some((e) => e.kind === 'clip' || e.kind === 'fault')).toBe(true)
    const final = res.w[res.w.length - 1]
    expect(final).toBeGreaterThan(DEFAULT_CAL_SM.wMin)
    expect(final).toBeLessThan(DEFAULT_CAL_SM.wMax)
  })

  it('lock detect：失鎖期間不更新；關掉 lock detect 時假相關把 w 拉走', () => {
    const cfg = quick({ lockLossStart: 300, lockLossLen: 40, unlockBias: 0.3 })
    const on = runCalStateMachine(cfg)
    expect(on.w[339]).toBe(on.w[301])
    const off = runCalStateMachine({ ...cfg, lockDetect: false })
    expect(Math.abs(off.delta[340])).toBeGreaterThan(Math.abs(on.delta[340]) + 5)
  })

  it('bad-FCW policy：freeze 安靜度過；ignore 時假相關觸發警報 → VERIFY 量不到斜率 → FAULT；沒有警報時 w 直接漂走', () => {
    const cfg = quick({ badFcwStart: 300, badFcwLen: 150, badFcwGain: 0, badFcwBias: 0.05 })
    const frz = runCalStateMachine(cfg)
    expect(frz.summary.fault).toBe(false)
    expect(frz.summary.restarts).toBe(0)
    expect(Math.abs(frz.delta[450])).toBeLessThan(3)
    const ign = runCalStateMachine({ ...cfg, badFcwPolicy: 'ignore' })
    expect(ign.summary.restarts + (ign.summary.fault ? 1 : 0)).toBeGreaterThanOrEqual(1)
    const blind = runCalStateMachine({ ...cfg, badFcwPolicy: 'ignore', alarmHiZ: 1e9, alarmLoZ: 1e9 })
    expect(Math.abs(blind.delta[450])).toBeGreaterThan(5) // μ_track·β ≈ 0.1 fs/block × 150 blocks
  })

  it('L5 定點：暫存器 LSB = 0.25 fs 時 TRACK 的 μ_track·|G| 多半 < ½ LSB ⇒ 係數幾乎卡住（dead zone）', () => {
    const res = runCalStateMachine(quick({ registerLsb: 0.25 }))
    let changes = 0
    let trackBlocks = 0
    for (let k = 0; k < res.state.length; k++) {
      if (res.state[k] !== 5) continue // TRACK
      trackBlocks++
      if (res.w[k + 1] !== res.w[k]) changes++
    }
    expect(trackBlocks).toBeGreaterThan(100)
    expect(changes / trackBlocks).toBeLessThan(0.1)
  })
})

describe('審查補充：E27 精確頻寬、截斷偏差、工作量上限、邊界最佳點', () => {
  it('T14: calBandwidth3dB 的精確 −3 dB 頻率 = 12.931 kHz（golden T14），並標出 E27 的無定義區', () => {
    const v = vector('T14')
    const p = (v.inputs as { p: number }).p
    const fu = v.expected.f_u_hz as number
    const bw = calBandwidth3dB(p, fu)
    expect(bw.regime).toBe('lowpass')
    expect(within(bw.hz, v.expected.bw_exact_3db_hz as number, v.tolerance)).toBe(true)
    // (1 − p) 近似 12.40 kHz 低了 4.1%：頁面顯示精確值，近似值只當備註（E26）
    expect(((1 - p) * fu) / (2 * Math.PI) / bw.hz - 1).toBeCloseTo(-0.041, 3)
    // 邊界：p = 3 − 2√2 剛好有 −3 dB 點（在 Nyquist）；更小則不存在；p ≤ 0、|p| ≥ 1 各自標示
    const pMin = 3 - 2 * Math.SQRT2
    expect(calBandwidth3dB(pMin, 1).hz).toBeCloseTo(0.5, 6)
    expect(calBandwidth3dB(pMin * 0.99, 1).regime).toBe('no3db')
    expect(calBandwidth3dB(0, 1).regime).toBe('flat')
    expect(calBandwidth3dB(-0.3, 1).regime).toBe('highpass')
    expect(calBandwidth3dB(1, 1).regime).toBe('unstable')
    // 數值二分法交叉檢查：|H|² 在 f_3dB 剛好是 DC 的一半
    for (const pp of [0.3, 0.7, 0.95, 0.999]) {
      const om = (2 * Math.PI * calBandwidth3dB(pp, 1).hz) / 1
      const ratio = (1 - pp) ** 2 / (1 - 2 * pp * Math.cos(om) + pp * pp)
      expect(ratio).toBeCloseTo(0.5, 10)
    }
  })

  it('斜率量測截斷偏差 F-14.21：−Δ²(c² + 3s²)/(6σ_v²) 與 mean-field 中央差分一致（θ ≠ 0 時不是 −(Δc)²/(6σ_v²)）', () => {
    for (const th of [0, 25, 55, 80]) {
      const m = gmacModel(4096, 100, th)
      const Delta = 10
      const exact = (gmacMeanField(Delta, m) - gmacMeanField(-Delta, m)) / (2 * Delta) / (comparatorKq(100) * m.c) - 1
      const pred = slopeTruncationBias(m, Delta)
      // 三階近似的殘差是 O(Δ⁴/σ⁴)：Δ = 0.1σ_v 時相對誤差 < 3%
      expect(Math.abs(pred / exact - 1)).toBeLessThan(0.03)
      if (th >= 25) {
        const naive = -((Delta * m.c) ** 2) / (6 * 100 * 100)
        expect(Math.abs(naive / exact - 1)).toBeGreaterThan(0.3) // 舊公式在 θ ≠ 0 時明顯錯
      }
    }
    expect(Number.isNaN(slopeTruncationBias(gmacModel(4096, 100, 90), 10))).toBe(true)
  })

  it('最佳點落在最後兩個格點之間時仍會細化（B = 1：fixed μ 恰好等於 Kalman 下界，不是 g = 1 的邊界解）', () => {
    const K = LESSON10.K
    const T = 131072
    const o = optimizeMu('final', { K, delta0: 3, sigmaEta2: 1 / T, B: 1 })
    const muStar = (K * 9) / (K * K * 9 + 1 / T)
    expect(o.atBoundary).toBeNull()
    expect(o.mu).toBeCloseTo(muStar, 6)
    expect(o.cost).toBeCloseTo(optimalSchedule(3, K, 1 / T, 1).PB, 12)
    // budgetSplit 的 B = 1 列也因此等於 Kalman 下界 δ0²/(1 + Tδ0²K²)
    const row = budgetSplit({ T, Ns: [T], K, delta0: 3 })[0]
    expect(row.rmsNominal ** 2).toBeCloseTo(9 / (1 + T * 9 * K * K), 10)
  })

  it('Monte Carlo 工作量上限：B 很大時自動減少 chains、只記錄約 400 個 block、sample-level 對照誠實略過', () => {
    const tk = traceBlockIndices(1_000_000)
    expect(tk[0]).toBe(0)
    expect(tk[tk.length - 1]).toBe(1_000_000)
    expect(tk.length).toBeLessThan(410)
    for (let i = 1; i < tk.length; i++) expect(tk[i]).toBeGreaterThan(tk[i - 1])
    expect(Array.from(traceBlockIndices(32))).toEqual(Array.from({ length: 33 }, (_, k) => k))
    const res = runMsdMonteCarlo({ seed: 3, sigmaV: 100, N: 64, thetaDeg: 0, delta0: 3, B: 120_000, mus: [1, 2], chains: 500, traceIndex: 0, blockLmsRuns: 10, maxChainBlocks: 600_000 })
    expect(res.chains).toBe(2) // floor(6e5/(2·1.2e5)) = 2
    expect(res.chainsRequested).toBe(500)
    expect(res.blockLms).toBeNull()
    expect(res.blockLmsNote).toMatch(/略過/)
    expect(res.trace.k.length).toBe(res.trace.msd.length)
    expect(res.trace.k[res.trace.k.length - 1]).toBe(120_000)
    // 記錄點的線性值與 msdAfterBlocks 一致
    const j = 7
    expect(res.trace.linear[j]).toBeCloseTo(msdAfterBlocks(3, 1 - 1 * loopGainK(100, 0), 1, 1 / 64, res.trace.k[j]), 12)
    const sch = runScheduleMonteCarlo({ seed: 1, sigmaV: 100, N: 4096, thetaDeg: 0, delta0: 3, B: 500, muFixed: 10, muCoarse: 40, muFine: 5, switchBlock: 10, chains: 5000, maxChainBlocks: 30_000 })
    expect(sch.chains).toBe(20) // floor(3e4/(3·500))
    expect(sch.chainsRequested).toBe(5000)
  })
})

describe('審查補充（第二輪）：VERIFY 擾動的代價、PM_t < 60° 的 corner 區間、第 10 課 11.20 fs 的來源', () => {
  const quick = (patch: Partial<CalSmParams> = {}): CalSmParams => ({ ...DEFAULT_CAL_SM, ...patch })

  it('deltaApplied：VERIFY 期間 DTC 實際誤差 = 暫存器誤差 ∓ Δ，其他狀態兩者相同；VERIFY 佔 16 個 block', () => {
    const res = runCalStateMachine(quick())
    const VERIFY = 3
    let verifyBlocks = 0
    for (let k = 0; k < res.state.length; k++) {
      if (res.state[k] === VERIFY) {
        verifyBlocks++
        expect(Math.abs(Math.abs(res.deltaApplied[k] - res.delta[k]) - DEFAULT_CAL_SM.verifyDelta)).toBeLessThan(1e-9)
      } else {
        expect(res.deltaApplied[k]).toBe(res.delta[k])
      }
    }
    expect(verifyBlocks).toBe(DEFAULT_CAL_SM.verifyBlocks)
    expect(res.summary.verifyBlocksUsed).toBe(verifyBlocks)
    // 前半 w + Δ（δ_applied = δ − Δ）、後半 w − Δ（δ_applied = δ + Δ）
    const first = Array.from(res.state).indexOf(VERIFY)
    expect(res.deltaApplied[first] - res.delta[first]).toBeCloseTo(-DEFAULT_CAL_SM.verifyDelta, 9)
    expect(res.deltaApplied[first + 15] - res.delta[first + 15]).toBeCloseTo(DEFAULT_CAL_SM.verifyDelta, 9)
    // 開機的 VERIFY 在評估視窗之前 ⇒ 預設情境兩種 RMS 相同
    expect(res.summary.rmsEval).toBe(res.summary.rmsEvalRegister)
  })

  it('評估視窗內有 VERIFY（PVT step 觸發 RESTART）時，狀態機的 RMS 要把 ±Δ 算進去：rmsEval² − rmsEvalRegister² ≈ Δ²·B_verify/窗長', () => {
    const cfg = quick({ stepBlock: 450, stepSize: 100 })
    const res = runCalStateMachine(cfg)
    expect(res.summary.restarts).toBe(1)
    expect(res.summary.verifyBlocksUsed).toBe(2 * cfg.verifyBlocks) // 開機一次 + RESTART 後一次
    const nEval = cfg.blocks - cfg.evalStart
    const extra = res.summary.rmsEval ** 2 - res.summary.rmsEvalRegister ** 2
    // 交叉項 ∓2Δ·δ 在前後半抵銷到只剩雜訊量級，所以多出來的均方 ≈ Δ²·16/650 = 9.85 fs²
    expect(extra).toBeGreaterThan(0.8 * ((cfg.verifyDelta ** 2 * cfg.verifyBlocks) / nEval))
    expect(extra).toBeLessThan(1.2 * ((cfg.verifyDelta ** 2 * cfg.verifyBlocks) / nEval))
    const mc = runCalStateMachineMonteCarlo({ config: cfg, runs: 16 })
    expect(mc.evalRms.mean).toBeGreaterThan(mc.evalRmsRegister.mean)
    expect(mc.rmsRegister.length).toBe(mc.rms.length)
    // 誠實的比較：算進 VERIFY 代價後，狀態機仍不比固定快 μ 差（優勢變小），且遠好於固定安靜 μ
    expect(mc.evalRms.mean).toBeLessThan(mc.evalRmsBase.mean * 1.02)
    expect(mc.evalRms.mean).toBeLessThan(0.6 * mc.evalRmsBase2.mean)
  })

  it('cornerInterval：PM_t < 60°（g_max > 1）時上限是 min(g_max, 1 + ε^{1/B})/K_max，與暴力掃描一致（頁面只開放 PM_t ≥ 60°）', () => {
    const rng = createRng(1602)
    let mismatches = 0
    for (let i = 0; i < 400; i++) {
      const kMax = 0.002 + rng.uniform() * 0.02
      const kMin = kMax * (0.05 + 0.95 * rng.uniform())
      const eps = Math.pow(10, -3 * rng.uniform() - 0.05)
      const B = rng.int(1, 40)
      const pm = 20 + 70 * rng.uniform()
      const r = cornerInterval([kMin, kMax], eps, B, pm)
      const gMax = gMaxForPm(pm)
      // 暴力：在 μ ∈ (0, 2.2/K_min] 的細格點上逐點檢查兩個 corner 的 |1 − μK|^B ≤ ε 與 μK ≤ g_max
      let any = false
      let lo = Infinity
      let hi = -Infinity
      const M = 4000
      for (let j = 1; j <= M; j++) {
        const mu = (j / M) * (2.2 / kMin)
        const ok = [kMin, kMax].every((K) => cornerContraction(mu, K, B) <= eps && mu * K <= gMax)
        if (ok) {
          any = true
          lo = Math.min(lo, mu)
          hi = Math.max(hi, mu)
        }
      }
      const step = 2.2 / kMin / M
      const width = r.muHi - r.muLo
      if (Math.abs(width) < 3 * step) continue // 區間寬度接近格點解析度：不判定
      if (any !== r.nonEmpty) mismatches++
      else if (any && (Math.abs(lo - r.muLo) > 1.5 * step || Math.abs(hi - r.muHi) > 1.5 * step)) mismatches++
      if (Math.abs(B - r.bMinExact) > 1e-6 && r.nonEmpty !== B >= r.bMin) mismatches++
    }
    expect(mismatches).toBe(0)
    // PM_t ≥ 60° 時與 F-14.15／F-14.16 完全相同
    const e16 = cornerInterval([0.004, 0.012], 0.01, 12, 60)
    expect(e16.muHi).toBeCloseTo(1 / 0.012, 12)
    expect(e16.bMinExact).toBeCloseTo(Math.log(0.01) / Math.log(2 / 3), 12)
  })

  it('第 10 課的 α = 11.20 fs 與 pole 0.9106 可由「32 次更新把平均誤差縮到 5%」重現：(1 − 0.05^{1/32})/K = 11.2006 fs、p = 0.91063', () => {
    const mu = convergenceMuMin(LESSON10.K, 0.05, 32)
    expect(mu).toBeCloseTo(11.2006, 3)
    expect(1 - mu * LESSON10.K).toBeCloseTo(0.91063, 5)
    expect(Math.pow(1 - mu * LESSON10.K, 32)).toBeCloseTo(0.05, 12)
    // 漸近式候選的 pole 是 0.9109（與課程的 0.9106 不符）
    expect(1 - asymptoticFinalOptimum(LESSON10).mu * LESSON10.K).toBeCloseTo(0.9109, 4)
  })

  it('反面（規格 §17「N 改變卻忘記 scaling」）：固定 T，N 從 4096 改成 16384 卻沿用舊的 μ* ⇒ bias² 沒收完，RMS 比重新最佳化差 3 倍以上', () => {
    const T = 131072
    const old = optimizeMu('final', LESSON10) // N = 4096、B = 32 的 μ* = 10.66 fs
    const m2: DesignModel = { K: LESSON10.K, delta0: 3, sigmaEta2: 1 / 16384, B: T / 16384 } // B = 8
    const stale = Math.sqrt(objectiveCost('final', old.mu, m2))
    const redo = optimizeMu('final', m2)
    expect(redo.mu / old.mu).toBeGreaterThan(3) // μ* 大致與 N 成正比（F-14.8：μ* ≈ ln A/(2BK)）
    expect(Math.sqrt(redo.cost) / Math.sqrt(old.cost)).toBeCloseTo(1, 1) // 重新最佳化後 RMS 幾乎不變（F-14.17）
    expect(stale / Math.sqrt(redo.cost)).toBeGreaterThan(3)
    // 原因是 bias²：p^{2B} 從 p^{64} 變成 p^{16}
    const split = msdSplit(3, 1 - old.mu * LESSON10.K, old.mu, 1 / 16384, 8)
    expect(split.bias2).toBeGreaterThan(10 * split.variance)
  })

  it('給 UI 的訊息以 $…$ 標記數學（mathText 會轉成 KaTeX），且 $ 成對', () => {
    const msgs = [
      optimizeMu('final', { ...LESSON10, K: -0.004 }).reason,
      optimizeMu('final', { ...LESSON10, B: 0 }).reason,
      optimizeMu('spur', { ...LESSON10, eps: 2 }).reason,
      optimizeMu('spur', { ...LESSON10, eps: 1e-30 }, { pmTargetDeg: 75 }).reason,
      cornerInterval([0.004, -0.001], 0.01, 30).reason,
      cornerInterval([0.004, 0.012], 2, 30).reason,
      cornerInterval([0.004, 0.012], 0.01, 2.5).reason,
      ...runCalStateMachine(quick({ thetaDeg: 120 })).events.map((e) => e.msg),
      ...runCalStateMachine(quick({ stepBlock: 450, stepSize: 100 })).events.map((e) => e.msg),
    ]
    for (const m of msgs) {
      expect(typeof m).toBe('string')
      expect(((m as string).match(/\$/g) ?? []).length % 2).toBe(0)
      // 不留 Unicode 拼湊的公式（規格要求逐字顯示的「C ≤ 0：更新極性錯誤」除外）
      expect((m as string).replace('C ≤ 0：', '')).not.toMatch(/[\u0370-\u03FF²³⁻¹≤≥≈⇒√±]|\u0302/)
    }
  })
})
