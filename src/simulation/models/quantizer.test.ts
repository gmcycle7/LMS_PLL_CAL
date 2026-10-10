import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRng } from '@/simulation/core'
import { welch } from '@/simulation/signal'
import { runDsm } from './dsm'
import {
  LF_OSR_DIV,
  RATIONAL_EXTRA_BITS,
  STRATEGIES,
  TOGGLE_PATTERN_5,
  bernoulliMoments,
  createPrbs,
  efbConstant,
  efbPeriod,
  isRotation,
  lineSpectrum,
  makeCtx,
  makeGrid,
  mixWithResidue,
  prbsProbability,
  quantize,
  rationalApprox,
  runQuantLab,
  simulateStrategy,
  slowProductStaircase,
  stochasticQuantVar,
  toggleCycle,
  validateQuantParams,
  zohLines,
  type QuantLabParams,
  type QuantizerSetup,
} from './quantizer'

interface GoldenVector {
  id: string
  inputs: Record<string, unknown>
  expected: Record<string, number | number[]>
  tolerance: { abs?: number; rel?: number }
  tolerance_overrides?: Record<string, { abs?: number; rel?: number }>
}

function loadVector(name: string): GoldenVector {
  return JSON.parse(readFileSync(join(process.cwd(), 'golden/vectors', `${name}.json`), 'utf8')) as GoldenVector
}

/** golden/README §5 的比對規則：|a − e| ≤ abs + rel·|e|（逐元素）。 */
function expectGolden(v: GoldenVector, key: string, actual: number | number[]) {
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  const exp = v.expected[key]
  const a = Array.isArray(actual) ? actual : [actual]
  const e = Array.isArray(exp) ? exp : [exp]
  expect(a.length).toBe(e.length)
  for (let i = 0; i < e.length; i++) {
    const bound = (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(e[i])
    expect(Math.abs(a[i] - e[i]), `${v.id}.${key}[${i}]: ${a[i]} vs ${e[i]}`).toBeLessThanOrEqual(bound)
  }
}

const SETUP: QuantizerSetup = {
  bits: 6,
  rounding: 'nearest',
  overflow: 'saturate',
  antiWindup: false,
  togglePeriod: 5,
  toggleOrder: 'spread',
  randomSource: 'ideal',
  prbsBits: 7,
  ditherLsb: 1,
  ditherPdf: 'uniform',
}

const BASE: QuantLabParams = {
  ...SETUP,
  target: 32.4,
  arithmetic: 'rational',
  fracBits: 10,
  length: 4096,
  fs: 100e6,
  nUpd: 1,
  lmsNoise: false,
  sigmaW: 0.2,
  pole: 0.9202,
  driftPerK: 0,
  lmsFreezeAt: 0,
  lsbFs: 0.125,
  mixing: false,
  dsmKind: 'first_order',
  dsmFrac: 0.1,
  pllBwHz: 1e6,
  pllZeta: 0.7,
  mixSamples: 1 << 16,
  nperseg: 1024,
  seed: 20261010,
  rInit: 0,
}

/** 以策略跑一個常數目標（rational 精確）。 */
function runConst(strategy: (typeof STRATEGIES)[number], target: number, steps: number, over: Partial<QuantizerSetup> = {}, seed = 1) {
  const setup = { ...SETUP, ...over }
  const grid = makeGrid(target, 'rational', 0)
  const ctx = makeCtx(setup, grid, strategy, seed)
  const W = new Float64Array(steps).fill(grid.W0)
  return simulateStrategy(strategy, W, ctx, { freezeW: grid.W0, integer: true })
}

describe('quantizer：基本工具', () => {
  it('rationalApprox：32.4 → 162/5、32+1/3 → 97/3、32.4375 → 519/16', () => {
    expect(rationalApprox(32.4)).toMatchObject({ p: 162, q: 5 })
    expect(rationalApprox(32 + 1 / 3)).toMatchObject({ p: 97, q: 3 })
    expect(rationalApprox(32.4375)).toMatchObject({ p: 519, q: 16 })
    expect(rationalApprox(32)).toMatchObject({ p: 32, q: 1 })
  })

  it('quantize：round-half-up 的 tie（32.5 → 33）在整數運算下精確；floor 與 saturate / wrap', () => {
    const grid = makeGrid(32.5, 'rational', 0)
    const ctx = makeCtx(SETUP, grid, 'deltaSigma', 1)
    const s = { n: 0, r: 0, wFreeze: 0, overflow: 0, windup: 0 }
    expect(quantize(grid.W0, s, ctx)).toBe(33)
    expect(quantize(grid.W0 - 1, s, ctx)).toBe(32) // 32.5 − 1/D
    const ctxF = makeCtx({ ...SETUP, rounding: 'floor' }, grid, 'deltaSigma', 1)
    expect(quantize(grid.W0, s, ctxF)).toBe(32)
    // 64.0 → saturate 63；wrap → 0
    const g64 = makeGrid(64, 'rational', 0)
    expect(quantize(g64.W0, s, makeCtx(SETUP, g64, 'freeze', 1))).toBe(63)
    expect(quantize(g64.W0, s, makeCtx({ ...SETUP, overflow: 'wrap' }, g64, 'freeze', 1))).toBe(0)
    expect(quantize(-g64.D, s, makeCtx({ ...SETUP, overflow: 'wrap' }, g64, 'freeze', 1))).toBe(63)
    expect(s.overflow).toBe(3)
  })

  it('PRBS：N = 7、9、11 的字序列週期為 2^N − 1，且每個非零值恰出現一次', () => {
    for (const N of [7, 9, 11]) {
      const M = 2 ** N
      const g = createPrbs(N, 12345)
      const first = g()
      const seen = new Set<number>([first])
      let period = 0
      for (let i = 1; i <= M; i++) {
        const u = g()
        if (u === first) {
          period = i
          break
        }
        seen.add(u)
      }
      expect(period).toBe(M - 1)
      expect(seen.size).toBe(M - 1)
      expect(seen.has(0)).toBe(false)
    }
  })
})

describe('T16：Freeze / Toggle / 一階 EFB（golden T16.json、quantizer_first_order.json）', () => {
  const v = loadVector('T16')
  const q = loadVector('quantizer_first_order')

  it('T16: toggle pattern [32,32,33,32,33] 由 Bresenham 產生；平均 32.4（精確有理數）、週期 5', () => {
    const pattern = toggleCycle(32.4, 5, 'spread')
    expect(pattern).toEqual(v.inputs.pattern)
    expect(pattern).toEqual([...TOGGLE_PATTERN_5])
    const sum = pattern.reduce((a, b) => a + b, 0)
    expect(sum).toBe(162) // 162/5 = 32.4 精確
    expectGolden(v, 'mean', sum / pattern.length)
    // 策略模擬：toggle 週期 5、穩態就是 pattern
    const sim = runConst('toggle', 32.4, 50)
    expect(Array.from(sim.y.subarray(0, 5))).toEqual(pattern)
    const lab = runQuantLab({ params: { ...BASE, length: 2000 }, cases: [{ id: 'A', strategy: 'toggle', lmsNoise: false, nUpd: 1 }], compareAll: false })
    expectGolden(v, 'period', lab.runs[0].metrics.period)
    expect(lab.runs[0].metrics.periodAnalytic).toBe(5)
  })

  it('T16: nearest freeze：code 32、static error w − w* = −0.4 LSB（E49：δ = a − w = +0.4）、誤差功率 0.16 LSB² 全在 DC', () => {
    const sim = runConst('freeze', 32.4, 10)
    expect(Array.from(sim.y).every((y) => y === 32)).toBe(true)
    expectGolden(v, 'freeze_code', sim.y[0])
    expectGolden(v, 'freeze_error_lsb', sim.y[0] - 32.4)
    const lab = runQuantLab({ params: BASE, cases: [{ id: 'A', strategy: 'freeze', lmsNoise: false, nUpd: 1 }], compareAll: false })
    const m = lab.runs[0].metrics
    expect(m.dcError).toBeCloseTo(-0.4, 12) // δw 約定
    expect(-m.dcError).toBeCloseTo(0.4, 12) // δ = a − w 約定
    expect(m.errPower).toBeCloseTo(0.16, 12)
    expect(m.errVar).toBeCloseTo(0, 12)
  })

  it('T16: |DFT|/5 譜線 = (√5 ∓ 1)/10；E47 線功率 f_u/5 為 0.03056、2f_u/5 為 0.20944 LSB²，總和 0.24', () => {
    const comps = lineSpectrum(TOGGLE_PATTERN_5)
    const mags = [comps[0].mag, comps[1].mag, comps[2].mag, comps[2].mag, comps[1].mag]
    expectGolden(v, 'dft_mag_list', mags)
    const e = TOGGLE_PATTERN_5.map((y) => y - 32.4)
    const lines = lineSpectrum(e)
    expect(lines[0].power).toBeCloseTo(0, 24) // DC 誤差 0
    expect(lines[1].power).toBeCloseTo(0.0305572809000084, 12)
    expect(lines[2].power).toBeCloseTo(0.2094427190999916, 12)
    expect(lines[1].power + lines[2].power).toBeCloseTo(0.24, 12)
    expect(10 * Math.log10(lines[2].power / lines[1].power)).toBeCloseTo(8.3595, 3)
    // clustered [32,32,32,33,33] 把 0.20944 移到 f_u/5
    const cl = lineSpectrum(toggleCycle(32.4, 5, 'clustered').map((y) => y - 32.4))
    expect(cl[1].power).toBeCloseTo(0.2094427190999916, 12)
    expect(cl[2].power).toBeCloseTo(0.0305572809000084, 12)
  })

  it('T16: 一階 EFB（round-half-up、r[−1] = 0、精確有理數）前 40 點的 y 與 r 和 Python Fraction golden 完全相同', () => {
    const out = efbConstant({ target: 32.4, steps: 40 })
    expectGolden(q, 'y', out.y)
    expectGolden(q, 'r', out.r)
    expectGolden(v, 'ef_cycle', out.y.slice(0, 5))
    expectGolden(q, 'cycle', out.y.slice(0, 5))
    expectGolden(q, 'cycle_mean', out.y.slice(0, 5).reduce((a, b) => a + b, 0) / 5)
    const g = makeGrid(32.4, 'rational', 0)
    expectGolden(v, 'ef_period', efbPeriod(g.W0, g.D))
    expectGolden(q, 'period', efbPeriod(g.W0, g.D))
    const floor = efbConstant({ target: 32.4, steps: 10, rounding: 'floor' })
    expectGolden(q, 'y_floor_rounding_first10', floor.y)
  })

  it('T16: E15 acceptance —— 常數 32.4 時 D ≡ B（floor 完全相同、nearest 為循環移位），任何初始 r 都是週期 5', () => {
    const floor = efbConstant({ target: 32.4, steps: 50, rounding: 'floor' })
    expect(floor.y.slice(0, 5)).toEqual([...TOGGLE_PATTERN_5])
    const nearest = efbConstant({ target: 32.4, steps: 50 })
    expect(isRotation(nearest.y.slice(0, 5), TOGGLE_PATTERN_5)).toBeGreaterThanOrEqual(0)
    for (const r0 of [0.1, -0.3, 1 / 7, 0.49]) {
      const o = efbConstant({ target: 32.4, steps: 60, rInit: r0 })
      // 允許最多 1 個 sample 的暫態，之後的 5 點循環必為 B 的循環移位
      const cyc = o.y.slice(10, 15)
      expect(isRotation(cyc, TOGGLE_PATTERN_5)).toBeGreaterThanOrEqual(0)
      for (let n = 10; n + 5 < 60; n++) expect(o.y[n + 5]).toBe(o.y[n])
    }
    // runQuantLab 的五策略比較：D 與 B 的 code 誤差頻譜、總功率完全相同
    const lab = runQuantLab({ params: { ...BASE, length: 4000 }, cases: [], compareAll: true })
    const B = lab.compare.find((r) => r.strategy === 'toggle')!
    const D = lab.compare.find((r) => r.strategy === 'deltaSigma')!
    expect(D.metrics.period).toBe(5)
    expect(D.metrics.errPower).toBeCloseTo(B.metrics.errPower, 12)
    expect(D.metrics.errPower).toBeCloseTo(0.24, 12)
    expect(D.cycle && B.cycle && isRotation(D.cycle, B.cycle)).toBeGreaterThanOrEqual(0)
    expect(D.lines[0].power).toBeCloseTo(B.lines[0].power, 12)
    expect(D.lines[0].f).toBeCloseTo((2 / 5) * 100e6, 3)
  })

  it('T16: 常數 32 + num/den（最簡）時週期 = den：[1,2,3,4,5,8,16]', () => {
    const targets = q.inputs.rational_targets as number[]
    const periods = targets.map((t) => {
      const o = efbConstant({ target: t, steps: 200 })
      const g = makeGrid(t, 'rational', 0)
      const P = efbPeriod(g.W0, g.D)
      // 模擬也必須在 P 後重複
      for (let n = 20; n + P < 200; n++) expect(o.y[n + P]).toBe(o.y[n])
      return P
    })
    expectGolden(q, 'period_list', periods)
  })

  it('T16: 定點 F = 8 / 10 / 12 個小數 bit 時，32.4 的週期為 2^F/gcd = 128 / 512 / 2048（E15）', () => {
    for (const [F, P] of [
      [8, 128],
      [10, 512],
      [12, 2048],
    ] as const) {
      const g = makeGrid(32.4, 'fixed', F)
      expect(efbPeriod(g.W0, g.D)).toBe(P)
      const lab = runQuantLab({
        params: { ...BASE, arithmetic: 'fixed', fracBits: F, length: 4 * P + 64 },
        cases: [{ id: 'A', strategy: 'deltaSigma', lmsNoise: false, nUpd: 1 }],
        compareAll: false,
      })
      expect(lab.runs[0].metrics.period).toBe(P)
      expect(lab.runs[0].metrics.periodAnalytic).toBe(P)
    }
    expect(makeGrid(32.4, 'fixed', 10).represented).toBe(32.400390625)
  })

  it('T16: ZOH 保持 N = 64 時線功率帶 sinc² 權重（E47）：k=1 0.02674、2 0.11998、3 0.05333、4 0.00167、7 0.00981 LSB²', () => {
    const e = TOGGLE_PATTERN_5.map((y) => y - 32.4)
    const lines = zohLines(e, 64, 400)
    const byK = new Map(lines.map((l) => [l.k, l.power]))
    expect(byK.get(1)).toBeCloseTo(0.02674, 4)
    expect(byK.get(2)).toBeCloseTo(0.11998, 4)
    expect(byK.get(3)).toBeCloseTo(0.05333, 4)
    expect(byK.get(4)).toBeCloseTo(0.00167, 4)
    expect(byK.get(7)).toBeCloseTo(0.00981, 4)
    expect(byK.has(5)).toBe(false) // ZOH 零點
    // Parseval：所有譜線總和仍為 0.24
    const all = zohLines(e, 64, 10_000)
    expect(all.reduce((a, l) => a + l.power, 0)).toBeCloseTo(0.24, 10)
  })

  it('T16: Parseval —— white-uniform NTF 模型預測 2/12 ≈ 0.1667 LSB²，但常數 32.4 實際為 0.24（E15，反面測試）', () => {
    const out = efbConstant({ target: 32.4, steps: 500 })
    const e = out.y.map((y) => y - 32.4)
    const p = e.reduce((a, x) => a + x * x, 0) / e.length
    expect(p).toBeCloseTo(0.24, 12)
    expect(Math.abs(p - 2 / 12)).toBeGreaterThan(0.07)
    const rv = out.r.reduce((a, x) => a + x * x, 0) / out.r.length
    expect(rv).toBeCloseTo(0.08, 12) // Var(r) = 0.08，不是 1/12
  })
})

describe('T17：Stochastic Rounding（golden T17.json）', () => {
  const v = loadVector('T17')

  it('T17: 解析動差 E = 32 + p = 32.4、Var = p(1 − p) = 0.24、RMS 0.4899', () => {
    const m = bernoulliMoments(v.inputs.low_code as number, v.inputs.p_high as number)
    expectGolden(v, 'mean', m.mean)
    expectGolden(v, 'variance', m.variance)
    expectGolden(v, 'rms', m.rms)
  })

  it('T17: Monte Carlo 1e6 次（固定 seed）：mean、variance 落在 ±4 SE 內', () => {
    const n = 1_000_000
    const sim = runConst('stochastic', 32.4, n, {}, 20261010)
    let s = 0
    let s2 = 0
    let c33 = 0
    for (let i = 0; i < n; i++) {
      s += sim.y[i]
      if (sim.y[i] === 33) c33++
    }
    const mean = s / n
    for (let i = 0; i < n; i++) s2 += (sim.y[i] - mean) ** 2
    const variance = s2 / (n - 1)
    const p = 0.4
    const seMean = Math.sqrt(p * (1 - p) / n)
    // Bernoulli 樣本變異數的 SE：√((μ4 − σ⁴)/n)，μ4 = p(1−p)(1 − 3p(1−p))
    const mu4 = p * (1 - p) * (1 - 3 * p * (1 - p))
    const seVar = Math.sqrt((mu4 - (p * (1 - p)) ** 2) / n)
    expect(Math.abs(mean - (v.expected.mean as number))).toBeLessThan(4 * seMean)
    expect(Math.abs(variance - (v.expected.variance as number))).toBeLessThan(4 * seVar)
    expect(new Set(sim.y).size).toBe(2)
    expect(c33 / n).toBeGreaterThan(0.39)
  })

  it('T17: 白色 code noise —— Welch PSD 平均值 ≈ 2·0.24/f_u（one-sided），積分 ≈ 0.24 LSB²', () => {
    const n = 1 << 17
    const sim = runConst('stochastic', 32.4, n, {}, 7)
    const e = Float64Array.from(sim.y, (y) => y - 32.4)
    const fu = 1e6
    const ps = welch(e, fu, { nperseg: 1024 })
    let mean = 0
    for (let i = 1; i < ps.psd.length - 1; i++) mean += ps.psd[i]
    mean /= ps.psd.length - 2
    expect(mean / ((2 * 0.24) / fu)).toBeGreaterThan(0.97)
    expect(mean / ((2 * 0.24) / fu)).toBeLessThan(1.03)
    let tot = 0
    for (let i = 0; i < ps.psd.length; i++) tot += ps.psd[i] * ps.df
    expect(tot).toBeCloseTo(0.24, 2)
  })

  it('T17: PRBS 警告（反面測試）——PRBS-7 的輸出週期 127、P(33) = 51/127 ≠ 0.4（有限長度偏差）', () => {
    const sim = runConst('stochastic', 32.4, 127 * 6, { randomSource: 'prbs', prbsBits: 7 }, 99)
    for (let n = 0; n + 127 < sim.y.length; n++) expect(sim.y[n + 127]).toBe(sim.y[n])
    let c = 0
    for (let n = 0; n < 127; n++) if (sim.y[n] === 33) c++
    expect(c).toBe(51)
    expect(prbsProbability(0.4, 7)).toBeCloseTo(51 / 127, 15)
    const lab = runQuantLab({
      params: { ...BASE, randomSource: 'prbs', prbsBits: 7, length: 4096 },
      cases: [{ id: 'A', strategy: 'stochastic', lmsNoise: false, nUpd: 1 }],
      compareAll: false,
    })
    expect(lab.runs[0].metrics.period).toBe(127)
    expect(lab.runs[0].linesExact).toBe(true) // 週期性 ⇒ 有離散譜線（不是白雜訊）
  })
})

describe('ΔΣ + dither、時變 w_H、mixing', () => {
  it('ΔΣ + RPDF dither A = 1 LSB：輸出 31–34 四階、總誤差功率 ≈ 0.32 LSB²、DC 誤差 ≈ 0、沒有週期', () => {
    const lab = runQuantLab({
      params: { ...BASE, length: 1 << 16, ditherLsb: 1 },
      cases: [{ id: 'E', strategy: 'deltaSigmaDither', lmsNoise: false, nUpd: 1 }],
      compareAll: false,
    })
    const m = lab.runs[0].metrics
    expect(m.codeMin).toBe(31)
    expect(m.codeMax).toBe(34)
    expect(m.errPower).toBeGreaterThan(0.3)
    expect(m.errPower).toBeLessThan(0.34)
    expect(Math.abs(m.dcError)).toBeLessThan(0.01)
    expect(m.period).toBe(0)
    // 一階塑形：低頻（< f_u/50）PSD 比白色 stochastic 低 > 20 dB
    const ps = lab.runs[0].psd
    const fu = lab.runs[0].fu
    let lo = 0
    let cnt = 0
    for (let i = 1; i < ps.f.length; i++) {
      if (ps.f[i] < fu / 50) {
        lo += ps.psd[i]
        cnt++
      }
    }
    expect(10 * Math.log10(lo / cnt / ((2 * 0.24) / fu))).toBeLessThan(-20)
  })

  it('時變 w_H（LMS 雜訊 σ_w = 0.2 LSB）：D 與 B 不再相同；D 的頻帶內誤差最接近 LMS 地板，freeze 仍有 −0.4 LSB', () => {
    const lab = runQuantLab({ params: { ...BASE, length: 1 << 15, lmsNoise: true }, cases: [], compareAll: true, compareScenario: { lmsNoise: true, nUpd: 1 } })
    const get = (s: string) => lab.compare.find((r) => r.strategy === s)!
    const B = get('toggle')
    const C = get('stochastic')
    const D = get('deltaSigma')
    expect(D.metrics.period).toBe(0)
    expect(B.metrics.period).toBe(0)
    // 逐點序列不同（常數情境時只差循環移位）
    expect(Array.from(D.trace.y).join()).not.toBe(Array.from(B.trace.y).join())
    expect(Math.abs(D.metrics.dcError)).toBeLessThan(0.02)
    expect(get('freeze').metrics.dcError).toBeCloseTo(-0.4, 12)
    // 頻帶內（f < f_u/64）超過 LMS 地板的部分：D < B < C（ΔΣ 把量化誤差推到高頻）
    const excess = (r: typeof D) => r.metrics.lfErrPower - r.metrics.lfLmsPower
    expect(excess(D)).toBeLessThan(excess(B))
    expect(excess(B)).toBeLessThan(excess(C))
    expect(Math.abs(excess(D))).toBeLessThan(0.002)
    expect(excess(C)).toBeGreaterThan(0.004) // ≈ 0.24/32（白色量化誤差落在頻帶內的部分）
  })

  it('PVT drift + freeze（反面測試）：freeze 的追蹤誤差隨時間變大，ΔΣ 跟得上', () => {
    const lab = runQuantLab({ params: { ...BASE, length: 8000, driftPerK: 0.2 }, cases: [], compareAll: true })
    const A = lab.compare.find((r) => r.strategy === 'freeze')!
    const D = lab.compare.find((r) => r.strategy === 'deltaSigma')!
    // w* 由 32.4 漂到 34.0；freeze 停在 32 ⇒ 最後 1/4 的平均誤差約 −(0.4 + 0.2·7) = −1.8
    expect(A.metrics.trackDcError).toBeLessThan(-1.5)
    expect(Math.abs(D.metrics.trackDcError)).toBeLessThan(0.05)
  })

  it('LMS freeze 之後 w_H 為定點常數 ⇒ ΔΣ 重新落入 limit cycle（週期 2^F/gcd 的因數）', () => {
    const L = 1 << 14
    const lab = runQuantLab({
      params: { ...BASE, arithmetic: 'fixed', fracBits: 8, length: L, lmsNoise: true, lmsFreezeAt: 1000 },
      cases: [{ id: 'D', strategy: 'deltaSigma', lmsNoise: true, nUpd: 1 }],
      compareAll: false,
    })
    const P = lab.runs[0].metrics.period
    expect(P).toBeGreaterThan(0)
    expect(256 % P).toBe(0)
  })

  it('Overload（反面測試）：w_H = 63.3 時無 anti-windup 的 r 無界成長（1000 步後 |r| ≈ 300）；anti-windup 有界', () => {
    const grid = makeGrid(63.3, 'rational', 0)
    const W = new Float64Array(1000).fill(grid.W0)
    const sim = simulateStrategy('deltaSigma', W, makeCtx(SETUP, grid, 'deltaSigma', 1), { freezeW: grid.W0, integer: true })
    expect(Math.abs(sim.r[999])).toBeGreaterThan(290)
    expect(sim.overflow).toBeGreaterThan(900)
    const simAw = simulateStrategy('deltaSigma', W, makeCtx({ ...SETUP, antiWindup: true }, grid, 'deltaSigma', 1), {
      freezeW: grid.W0,
      integer: true,
    })
    expect(Math.max(...Array.from(simAw.r, Math.abs))).toBeLessThanOrEqual(0.5)
    expect(simAw.windup).toBeGreaterThan(0)
  })

  it('Wrap vs saturate（反面測試）：w* = 63.4 時 wrap 讓 code 由 63 跳到 0，saturate 停在 63', () => {
    const labW = runQuantLab({
      params: { ...BASE, target: 63.4, overflow: 'wrap', length: 256 },
      cases: [{ id: 'D', strategy: 'deltaSigma', lmsNoise: false, nUpd: 1 }],
      compareAll: false,
    })
    expect(labW.runs[0].metrics.codeMin).toBe(0)
    expect(labW.runs[0].warnings.some((w) => w.includes('wrap'))).toBe(true)
    const labS = runQuantLab({
      params: { ...BASE, target: 63.4, overflow: 'saturate', length: 256 },
      cases: [{ id: 'D', strategy: 'deltaSigma', lmsNoise: false, nUpd: 1 }],
      compareAll: false,
    })
    expect(labS.runs[0].metrics.codeMin).toBe(63)
    expect(labS.warnings.some((w) => w.includes('超出'))).toBe(true)
  })

  it('Wrap（反面測試）：硬體丟掉進位 ⇒ r 仍有界；63.4 時 40% 的更新量化成 64 而繞回 0，平均 code 只剩 0.6·63 = 37.8', () => {
    const lab = runQuantLab({
      params: { ...BASE, target: 63.4, overflow: 'wrap', length: 500 },
      cases: [{ id: 'D', strategy: 'deltaSigma', lmsNoise: false, nUpd: 1 }],
      compareAll: false,
    })
    const r = lab.runs[0]
    // 63.4 = 317/5：未 wrap 的循環是 [63, 64, 63, 64, 63]，64 繞回 0
    expect(Array.from(r.trace.y.subarray(0, 10))).toEqual([63, 0, 63, 0, 63, 63, 0, 63, 0, 63])
    expect(r.metrics.overflow).toBe(200) // 500 次更新的 2/5
    expect(r.metrics.meanCode).toBeCloseTo(37.8, 12)
    expect(r.metrics.period).toBe(5)
    // r 是「v 減去未 wrap 的整數」：與不 wrap 的理想 EFB 完全相同，|r| ≤ ½（舊版會讓 r 每次 wrap 多出 64）
    const ideal = efbConstant({ target: 32.4, steps: 20 }) // frac 相同 ⇒ r 序列相同
    for (let n = 0; n < 20; n++) expect(r.trace.r[n]).toBeCloseTo(ideal.r[n], 12)
    expect(Math.max(...Array.from(r.trace.r, Math.abs))).toBeLessThanOrEqual(0.5)
    // 負向 wrap：w = −0.4 ⇒ 未 wrap 的 code 為 0 / −1，−1 繞到 63；r 仍有界
    const neg = runQuantLab({
      params: { ...BASE, target: -0.4, overflow: 'wrap', length: 500 },
      cases: [{ id: 'D', strategy: 'deltaSigma', lmsNoise: false, nUpd: 1 }],
      compareAll: false,
    }).runs[0]
    expect(neg.metrics.codeMax).toBe(63)
    expect(neg.metrics.codeMin).toBe(0)
    expect(neg.metrics.overflow).toBe(200)
    expect(Math.max(...Array.from(neg.trace.r, Math.abs))).toBeLessThanOrEqual(0.5)
    // saturate 不受影響：r 仍然無界累積（windup）
    const sat = runQuantLab({
      params: { ...BASE, target: 63.4, overflow: 'saturate', length: 500 },
      cases: [{ id: 'D', strategy: 'deltaSigma', lmsNoise: false, nUpd: 1 }],
      compareAll: false,
    }).runs[0]
    expect(sat.trace.r[sat.trace.r.length - 1]).toBeGreaterThan(50)
  })

  it('Freeze/Track：LMS 在 L/4 之前凍結 ⇒ 解析週期 = D/gcd(W_frozen mod D, D)，與偵測週期一致；凍結點在偵測窗口之後則不給解析值', () => {
    const L = 1 << 13
    const run = (lmsFreezeAt: number) =>
      runQuantLab({
        params: { ...BASE, arithmetic: 'fixed', fracBits: 8, length: L, lmsNoise: true, lmsFreezeAt },
        cases: [{ id: 'D', strategy: 'deltaSigma', lmsNoise: true, nUpd: 1 }],
        compareAll: false,
      }).runs[0]
    const frozen = run(L / 4)
    expect(frozen.metrics.periodAnalytic).not.toBeNull()
    expect(256 % frozen.metrics.periodAnalytic!).toBe(0)
    expect(frozen.metrics.period).toBe(frozen.metrics.periodAnalytic)
    // 凍結後 w_H 不再改變
    expect(new Set(Array.from(frozen.trace.wH.subarray(0, 4))).size).toBeGreaterThan(1)
    expect(run(L / 2).metrics.periodAnalytic).toBeNull() // 偵測窗口（從 L/4 起）還包含未凍結的區段
    expect(run(0).metrics.periodAnalytic).toBeNull() // 持續追蹤：沒有解析週期
    expect(run(0).metrics.period).toBe(0)
  })

  it('T16: zohLines 只掃 k ≤ (maxLines + 1)·P 仍然精確：與「把保持後的序列直接做 DFT」逐線相同；N_h 很大時不會卡住', () => {
    const e = TOGGLE_PATTERN_5.map((y) => y - 32.4)
    const Nh = 16
    const held = Array.from({ length: 5 * Nh }, (_, m) => e[Math.floor(m / Nh)])
    const brute = lineSpectrum(held)
      .filter((l) => l.k > 0)
      .sort((a, b) => b.power - a.power)
    const fast = zohLines(e, Nh, 12)
    expect(fast).toHaveLength(12)
    for (let i = 0; i < 12; i++) {
      expect(fast[i].k).toBe(brute[i].k)
      expect(fast[i].power).toBeCloseTo(brute[i].power, 12)
    }
    // 週期 512（F = 10）、N_h = 65536：全掃要 1.7e7 條線，截斷後只掃 13·512 條
    const o = efbConstant({ target: 32.4, steps: 2 * 512, arithmetic: 'fixed', fracBits: 10 })
    const seg = o.y.slice(512).map((y) => y - 32.4)
    const t0 = performance.now()
    const big = zohLines(seg, 65536, 12)
    expect(performance.now() - t0).toBeLessThan(3000) // 全掃 1.7e7 條線需數秒以上；截斷後約數十毫秒（上限放寬以容忍 CI 負載）
    expect(big[0].k).toBe(205) // 主線仍在 205 f_u/512
    for (let i = 1; i < big.length; i++) expect(big[i].power).toBeLessThanOrEqual(big[i - 1].power)
  })

  it('浮點 tie 翻轉（反面測試）：w = 32.3 時 float EFB 在 n = 4 與精確模型分歧（E15：必須用整數比對）', () => {
    const lab = runQuantLab({
      params: { ...BASE, target: 32.3, arithmetic: 'float', length: 1000 },
      cases: [{ id: 'D', strategy: 'deltaSigma', lmsNoise: false, nUpd: 1 }],
      compareAll: false,
    })
    const bt = lab.runs[0].bitTrue!
    expect(bt.firstIndex).toBe(4)
    expect(bt.mismatches).toBeGreaterThan(0)
    // 但兩者週期都是 10、平均都是 32.3（tie 只影響相位）
    expect(lab.runs[0].metrics.period).toBe(10)
    const exact = efbConstant({ target: 32.3, steps: 40 })
    expect(exact.y[4]).toBe(33)
  })

  it('mixing：freeze 的 δt = Δ_LSB·(−0.4)·x，RMS = 0.05 fs（x 標準化）；PLL 後 RMS 變小', () => {
    const x = Float64Array.from({ length: 8 }, (_, i) => (i % 2 ? 1 : -1))
    const dt = mixWithResidue([-0.4, -0.4], 4, x, 0.125)
    expect(Array.from(dt)).toEqual([0.05, -0.05, 0.05, -0.05, 0.05, -0.05, 0.05, -0.05])
    const lab = runQuantLab({
      params: { ...BASE, mixing: true, nUpd: 16, length: 4096, mixSamples: 1 << 16 },
      cases: [{ id: 'A', strategy: 'freeze', lmsNoise: false, nUpd: 16 }],
      compareAll: false,
    })
    const mx = lab.runs[0].mixing!
    expect(mx.sigmaRawFs).toBeCloseTo(0.05, 6)
    expect(mx.sigmaOutFs).toBeLessThan(mx.sigmaRawFs)
  })

  it('mixing 的慢變成分（反面測試）：Freeze 的 static error 把 DSM residue 的慢鋸齒（f_s/2^18）帶到 δt——低於積分下限 f_L，不在 σ_out 裡，但必須另外回報並警告', () => {
    const Ns = 1 << 18
    const lab = runQuantLab({
      params: { ...BASE, mixing: true, length: Ns, mixSamples: Ns },
      cases: [
        { id: 'A', strategy: 'freeze', lmsNoise: false, nUpd: 1 },
        { id: 'B', strategy: 'toggle', lmsNoise: false, nUpd: 1 },
      ],
      compareAll: false,
    })
    const A = lab.runs[0].mixing!
    const Bm = lab.runs[1].mixing!
    expect(A.samples).toBe(Ns)
    expect(A.fLowHz).toBeCloseTo(BASE.fs / 32768, 9)
    expect(A.nSegments).toBeGreaterThan(8)
    // 解析值：frac = K/2^20、K = round(0.1·2^20) ⇒ 10K − 2^20 = 4，residue 的 10 點圖樣每 2^18 個 cycle 滑過 1/10；
    // 標準化 x 的慢鋸齒峰對峰 = (1/10)/σ_res，σ_res² = (1 − 1/100)/12；乘上 Δ_LSB·|δw| = 0.05 fs；
    // 8 個區塊平均（等距取樣一個鋸齒週期）的 RMS = pp·√((64 − 1)/(12·64))
    const K = Math.round(0.1 * 2 ** 20)
    expect(10 * K - 2 ** 20).toBe(4)
    const pp = (0.05 * 0.1) / Math.sqrt((1 - 1 / 100) / 12)
    const want = pp * Math.sqrt(63 / (12 * 64))
    expect(A.slowRmsFs).not.toBeNull()
    expect(A.slowRmsFs! / want).toBeGreaterThan(0.97)
    expect(A.slowRmsFs! / want).toBeLessThan(1.03)
    expect(A.slowRmsFs!).toBeGreaterThan(A.sigmaOutFs) // 慢變成分才是 Freeze 的主要 in-band 成分
    expect(Math.abs(A.meanFs)).toBeLessThan(1e-9) // x 標準化後零平均 ⇒ Freeze 沒有靜態偏移
    expect(A.warnings.some((w) => w.includes('慢變成分') && w.includes('f_L'))).toBe(true)
    // Toggle：code 誤差零平均 ⇒ 不會把 x 的慢鋸齒帶出來；但 code tone 與 residue tone 同頻 ⇒ 差頻在 DC（靜態偏移）
    expect(Bm.slowRmsFs!).toBeLessThan(0.01 * Bm.sigmaOutFs)
    expect(Math.abs(Bm.meanFs)).toBeGreaterThan(Bm.sigmaOutFs)
    expect(Bm.warnings.some((w) => w.includes('慢變成分'))).toBe(false)
    // 紀錄太短（少於 4 個區塊）時不硬估
    const short = runQuantLab({ params: { ...BASE, mixing: true, length: 4096 }, cases: [{ id: 'A', strategy: 'freeze', lmsNoise: false, nUpd: 1 }], compareAll: false }).runs[0].mixing!
    expect(short.slowRmsFs).toBeNull()
    expect(short.nSegments).toBe(1)
  })

  it('code 更新率（§13.5 第 5 點）：混頻產物都解析得出來時（frac = 13/128），toggle 在 N_upd = 1 的 σ_out 反而比 N_upd = 1024 大——2f_s/5 的 code tone 與 DSM residue 的高次諧波混頻後落回通帶', () => {
    const Ns = 1 << 17
    const run = (nUpd: number) =>
      runQuantLab({
        params: { ...BASE, dsmFrac: 13 / 128, mixing: true, nUpd, length: Ns, mixSamples: Ns, pllBwHz: 1e6 },
        cases: [{ id: 'B', strategy: 'toggle', lmsNoise: false, nUpd }],
        compareAll: false,
      }).runs[0].mixing!
    const fast = run(1)
    const slow = run(1024)
    // 同一個量的比較：相同的 reference cycle 數與積分下限
    expect(fast.samples).toBe(Ns)
    expect(slow.samples).toBe(Ns)
    expect(fast.fLowHz).toBe(slow.fLowHz)
    // 混頻週期 lcm(P_code·N_upd, P_DSM)：DSM 週期 128 ⇒ 640 與 5120 個 cycle，都遠小於紀錄 ⇒ 沒有東西藏在 DC
    expect(fast.productPeriod).toBe(640)
    expect(slow.productPeriod).toBe(5120)
    for (const m of [fast, slow]) {
      expect(m.slowRmsFs!).toBeLessThan(0.01 * m.sigmaOutFs)
      expect(Math.abs(m.meanFs)).toBeLessThan(0.01 * m.sigmaOutFs)
      expect(m.warnings).toEqual([])
    }
    expect(fast.sigmaRawFs).toBeCloseTo(slow.sigmaRawFs, 2)
    expect(fast.sigmaOutFs).toBeGreaterThan(2 * slow.sigmaOutFs) // 直覺（tone 移進頻寬內會變差）在這裡是錯的
  })

  it('FCW 陷阱（反面測試）：frac = 0.1 時 toggle × DSM residue 的混頻週期 5·2^19 比紀錄長 ⇒ 短紀錄只看到「靜態偏移」並警告；完整週期的慢階梯 RMS 與解析得出來的 FCW 的 σ_out 同量級', () => {
    const stair = slowProductStaircase(BASE, 0.1, 32768)
    expect(stair.K).toBe(104858)
    expect(stair.dsmPeriod).toBe(2 ** 19)
    expect(stair.productPeriod).toBe(5 * 2 ** 19)
    expect(stair.samples).toBe(stair.productPeriod)
    expect(stair.complete).toBe(true)
    // 5 階、每階 2^18 個 cycle：±0.00866、±0.01732、0（fs），RMS = √(2·(0.00866² + 0.01732²)/5)
    const a = stair.levelMaxFs / 2
    expect(stair.levelMaxFs).toBeCloseTo(-stair.levelMinFs, 6)
    expect(stair.slowRmsFs).toBeCloseTo(Math.sqrt((2 * (a * a + 4 * a * a)) / 5), 5)
    expect(stair.slowRmsFs).toBeGreaterThan(0.012)
    expect(stair.slowRmsFs).toBeLessThan(0.0125)
    const mixOf = (dsmFrac: number) =>
      runQuantLab({
        params: { ...BASE, dsmFrac, mixing: true, length: 1 << 17, mixSamples: 1 << 17 },
        cases: [{ id: 'B', strategy: 'toggle', lmsNoise: false, nUpd: 1 }],
        compareAll: false,
      }).runs[0].mixing!
    // 短紀錄（2^17 個 cycle = 半階）：σ_out 看起來很小，最大的產物變成「靜態偏移」，而且必須警告
    const short = mixOf(0.1)
    expect(short.productPeriod).toBe(5 * 2 ** 19)
    expect(short.sigmaOutFs).toBeLessThan(0.3 * stair.slowRmsFs)
    expect(Math.abs(short.meanFs)).toBeCloseTo(a, 4)
    expect(short.warnings.some((w) => w.includes('混頻產物') && w.includes('靜態偏移') && w.includes('2621440'))).toBe(true)
    // 解析得出來的 FCW（13/128）：同一個 limit cycle 的 in-band 產物直接出現在 σ_out，與慢階梯的 RMS 同量級
    const ok = mixOf(13 / 128)
    expect(ok.warnings).toEqual([])
    expect(ok.sigmaOutFs / stair.slowRmsFs).toBeGreaterThan(0.8)
    expect(ok.sigmaOutFs / stair.slowRmsFs).toBeLessThan(1.25)
    // 串流版（DsmStream 兩趟）與「runDsm + mixWithResidue 再取區塊平均」逐區塊相同
    const small = slowProductStaircase(BASE, 13 / 128, 64)
    expect(small.productPeriod).toBe(640)
    expect(small.samples).toBe(640)
    const x = runDsm({ kind: 'first_order', frac: 13 / 128, bits: 20, length: 640, normalization: 'standardize' }).code
    const e = Array.from({ length: 640 }, (_, n) => TOGGLE_PATTERN_5[n % 5] - 32.4)
    const dt = mixWithResidue(e, 1, x, BASE.lsbFs)
    for (let b = 0; b < 10; b++) {
      let s = 0
      for (let i = 0; i < 64; i++) s += dt[b * 64 + i]
      expect(small.blockMeans[b]).toBeCloseTo(s / 64, 12)
    }
    // Freeze：code 是常數 ⇒ 混頻週期就是 DSM 的週期（與 N_upd 無關）
    const fz = runQuantLab({
      params: { ...BASE, dsmFrac: 13 / 128, mixing: true, length: 4096, nUpd: 1024 },
      cases: [{ id: 'A', strategy: 'freeze', lmsNoise: false, nUpd: 1024 }],
      compareAll: false,
    }).runs[0].mixing!
    expect(fz.productPeriod).toBe(128)
  })

  it('同 seed 可重現（paired）：兩次 runQuantLab 結果逐點相同', () => {
    const a = runQuantLab({ params: { ...BASE, lmsNoise: true }, cases: [], compareAll: true, compareScenario: { lmsNoise: true, nUpd: 1 } })
    const b = runQuantLab({ params: { ...BASE, lmsNoise: true }, cases: [], compareAll: true, compareScenario: { lmsNoise: true, nUpd: 1 } })
    for (let i = 0; i < 5; i++) {
      expect(Array.from(a.compare[i].trace.y)).toEqual(Array.from(b.compare[i].trace.y))
      expect(a.compare[i].metrics.errPower).toBe(b.compare[i].metrics.errPower)
    }
  })

  it('參數檢查：非法 bits / L 以中文錯誤丟出', () => {
    expect(() => runQuantLab({ params: { ...BASE, bits: 0 }, cases: [], compareAll: false })).toThrow(/bits/)
    expect(() => runQuantLab({ params: { ...BASE, length: 10 }, cases: [], compareAll: false })).toThrow(/L 必須/)
  })

  it('T16: 常數情境的頻帶內功率由精確線譜加總：B、D 為 0（線在 f_u/5、2f_u/5）；F = 10 時 = k ≤ 8 的線功率和', () => {
    const lab = runQuantLab({ params: { ...BASE, length: 8000 }, cases: [], compareAll: true, compareScenario: { lmsNoise: false, nUpd: 1 } })
    for (const s of ['toggle', 'deltaSigma'] as const) {
      const r = lab.compare.find((x) => x.strategy === s)!
      expect(r.metrics.lfExact).toBe(true)
      expect(r.metrics.lfErrPower).toBeLessThan(1e-20)
      expect(r.metrics.dcError).toBeCloseTo(0, 12) // L = 8000 是 5 的倍數 ⇒ 平均恰為 32.4
    }
    expect(lab.compare.find((x) => x.strategy === 'freeze')!.metrics.lfErrPower).toBeCloseTo(0.16, 12)
    const f10 = runQuantLab({
      params: { ...BASE, arithmetic: 'fixed', fracBits: 10, length: 4096 },
      cases: [{ id: 'D', strategy: 'deltaSigma', lmsNoise: false, nUpd: 1 }],
      compareAll: false,
    }).runs[0]
    const o = efbConstant({ target: 32.4, steps: 3 * 512, arithmetic: 'fixed', fracBits: 10 })
    const comps = lineSpectrum(o.y.slice(512, 1024).map((y) => y - 32.4))
    const want = comps.filter((c) => c.k <= 8).reduce((a, c) => a + c.power, 0)
    expect(f10.metrics.lfExact).toBe(true)
    expect(f10.metrics.lfErrPower).toBeCloseTo(want, 15)
  })

  it('反面測試：Freeze + LMS 雜訊時誤差是常數 −0.4，不可「偵測」出假譜線（舊版會回報 1e-60 LSB² 的 spur）', () => {
    const lab = runQuantLab({ params: { ...BASE, length: 1 << 14, lmsNoise: true }, cases: [], compareAll: true, compareScenario: { lmsNoise: true, nUpd: 1 } })
    const A = lab.compare.find((r) => r.strategy === 'freeze')!
    expect(A.metrics.errVar).toBeLessThan(1e-12)
    expect(A.lines).toEqual([])
    expect(A.metrics.maxSpur).toBeNull()
  })

  it('反面測試：Welch 段數少（L = 8000、nperseg 4096）時，白色 stochastic 誤差不可被誤判為 tone；LMS 雜訊下的 toggle 2f_u/5 線仍偵測得到', () => {
    for (const seed of [1, 2, 3, 4]) {
      const lab = runQuantLab({ params: { ...BASE, seed, length: 8000, nperseg: 4096 }, cases: [], compareAll: true, compareScenario: { lmsNoise: false, nUpd: 1 } })
      expect(lab.compare.find((r) => r.strategy === 'stochastic')!.metrics.maxSpur).toBeNull()
      expect(lab.compare.find((r) => r.strategy === 'deltaSigmaDither')!.metrics.maxSpur).toBeNull()
    }
    const tv = runQuantLab({ params: { ...BASE, length: 1 << 14, nperseg: 4096, lmsNoise: true }, cases: [{ id: 'B', strategy: 'toggle', lmsNoise: true, nUpd: 1 }], compareAll: false })
    const sp = tv.runs[0].metrics.maxSpur!
    expect(sp.f / tv.runs[0].fu).toBeCloseTo(0.4, 3)
    expect(sp.power).toBeGreaterThan(0.03)
  })

  it('時變 w_H：頻帶內「量化誤差」ε = y − w_H 的功率 D < B < C；C ≈ 2E[p(1−p)]·(f_B/f_u)，E[p(1−p)] ≈ p₀(1−p₀) − σ_w²', () => {
    const Epq = stochasticQuantVar(32.4, 0.2)
    expect(Epq).toBeCloseTo(0.2035491427687526, 6) // Python 數值積分（np.trapezoid）
    expect(Math.abs(Epq - (0.24 - 0.04))).toBeLessThan(0.005)
    expect(stochasticQuantVar(32.4, 0)).toBeCloseTo(0.24, 12)
    expect(stochasticQuantVar(32.4, 0.02)).toBeCloseTo(0.24 - 0.0004, 5)
    const lab = runQuantLab({
      params: { ...BASE, length: 1 << 15, lmsNoise: true, arithmetic: 'fixed', fracBits: 16, nperseg: 4096 },
      cases: [],
      compareAll: true,
      compareScenario: { lmsNoise: true, nUpd: 1 },
    })
    const get = (s: string) => lab.compare.find((r) => r.strategy === s)!.metrics
    expect(get('deltaSigma').lfQuantPower).toBeLessThan(get('toggle').lfQuantPower)
    expect(get('toggle').lfQuantPower).toBeLessThan(get('stochastic').lfQuantPower)
    const predC = (2 * Epq) / LF_OSR_DIV
    expect(get('stochastic').lfQuantPower / predC).toBeGreaterThan(0.8)
    expect(get('stochastic').lfQuantPower / predC).toBeLessThan(1.2)
    expect(get('stochastic').quantErrVar).toBeCloseTo(Epq, 1)
    // D 的頻帶內量化誤差比 C 小 2 個數量級以上（一階 noise shaping）
    expect(get('deltaSigma').lfQuantPower).toBeLessThan(predC / 100)
  })

  it('參數檢查：Δ_LSB ≤ 0、σ_w < 0、F 超出範圍、LMS 凍結時刻超出 L 都以中文錯誤拒絕', () => {
    expect(validateQuantParams({ ...BASE, lsbFs: 0 }).join()).toMatch(/Δ_LSB/)
    expect(validateQuantParams({ ...BASE, sigmaW: -1 }).join()).toMatch(/σ_w/)
    expect(validateQuantParams({ ...BASE, arithmetic: 'fixed', fracBits: 31 }).join()).toMatch(/F/)
    expect(validateQuantParams({ ...BASE, lmsFreezeAt: BASE.length }).join()).toMatch(/凍結/)
    expect(validateQuantParams({ ...BASE, target: Number.NaN }).join()).toMatch(/w\*/)
    expect(validateQuantParams(BASE)).toEqual([])
  })

  it('反面測試：dither 的 overload margin 是 A（不是 A/2）——|u − w_H| ≤ ½ + A，A = 1 時 w* = 1.0 不會溢位、w* = 0.6 會', () => {
    const run = (target: number) =>
      runQuantLab({
        params: { ...BASE, target, length: 1 << 15, ditherLsb: 1, ditherPdf: 'uniform' },
        cases: [{ id: 'E', strategy: 'deltaSigmaDither', lmsNoise: false, nUpd: 1 }],
        compareAll: false,
      })
    const ok = run(1.0)
    expect(ok.runs[0].metrics.overflow).toBe(0)
    expect(ok.warnings.some((w) => w.includes('dither 寬度'))).toBe(false)
    const bad = run(0.6)
    expect(bad.runs[0].metrics.overflow).toBeGreaterThan(0)
    expect(bad.warnings.some((w) => w.includes('dither 寬度'))).toBe(true)
    // 一般位置：code 偏離 w* 不超過 ½ + A + ½（A = 1 ⇒ 32.4 時只用 31–34）
    const mid = run(32.4).runs[0].metrics
    expect(mid.codeMin).toBeGreaterThanOrEqual(31)
    expect(mid.codeMax).toBeLessThanOrEqual(34)
  })

  it('警告必須解釋原因（反面測試）：toggle 表示不了的小數、floor 的 Freeze、PRBS、凍結點在偵測窗口之後', () => {
    const one = (over: Partial<QuantLabParams>, strategy: (typeof STRATEGIES)[number], lmsNoise = false) =>
      runQuantLab({ params: { ...BASE, ...over }, cases: [{ id: 'A', strategy, lmsNoise, nUpd: 1 }], compareAll: false }).runs[0]
    // 32.43：L_t = 5 只能表示 2/5 ⇒ 平均偏 −0.03 LSB，而且 D（週期 100）不再等於 B（週期 5）
    const tg = one({ target: 32.43 }, 'toggle')
    expect(tg.warnings.some((w) => w.includes('只能表示 h/L_t') && w.includes('2/5'))).toBe(true)
    expect(tg.metrics.dcError).toBeCloseTo(-0.03, 3)
    expect(one({ target: 32.43, length: 8192 }, 'deltaSigma').metrics.period).toBe(100)
    expect(one({}, 'toggle').warnings.some((w) => w.includes('只能表示'))).toBe(false) // 32.4 = 2/5 可精確表示
    // floor + Freeze：32.6 → 32（誤差 −0.6 LSB，不是最近的 33）
    const fz = one({ target: 32.6, rounding: 'floor' }, 'freeze')
    expect(fz.metrics.dcError).toBeCloseTo(-0.6, 12)
    expect(fz.warnings.some((w) => w.includes('truncation') && w.includes('33'))).toBe(true)
    expect(one({ target: 32.4, rounding: 'floor' }, 'freeze').warnings.some((w) => w.includes('truncation'))).toBe(false)
    // PRBS：說明週期與偏差
    expect(one({ randomSource: 'prbs', prbsBits: 7 }, 'stochastic').warnings.some((w) => w.includes('PRBS-7') && w.includes('127'))).toBe(true)
    expect(one({}, 'stochastic').warnings.some((w) => w.includes('PRBS'))).toBe(false)
    // 凍結點在偵測窗口（L/4）之後
    const late = one({ arithmetic: 'fixed', fracBits: 8, lmsFreezeAt: 3000 }, 'deltaSigma', true)
    expect(late.warnings.some((w) => w.includes('凍結點') && w.includes('L/4'))).toBe(true)
    expect(one({ arithmetic: 'fixed', fracBits: 8, lmsFreezeAt: 1000 }, 'deltaSigma', true).warnings.some((w) => w.includes('凍結點'))).toBe(false)
  })

  it('rational 格點：D = q·2^16；時變 w_H 時仍為整數運算', () => {
    const g = makeGrid(32.4, 'rational', 0)
    expect(g.D).toBe(5 * 2 ** RATIONAL_EXTRA_BITS)
    expect(g.W0).toBe(162 * 2 ** RATIONAL_EXTRA_BITS)
    const rng = createRng(3)
    expect(Number.isInteger(Math.round((32.4 + 0.1 * rng.normal()) * g.D))).toBe(true)
  })
})
