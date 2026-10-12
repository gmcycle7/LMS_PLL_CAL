import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRng, normCdf } from '@/simulation/core'
import { extractRegion, listRegions } from '@/components'
import {
  accumulatorBitsClosedForm,
  accumulatorBitsRequired,
  accumulatorSizing,
  accumulatorTrace,
  ar1MeanSe,
  biasFixedPoint,
  bitToBipolar,
  blockUpdate,
  bugFixedPointGaussian,
  bugMeanGmac,
  codeRangeOf,
  comparatorBit,
  compareEncodings,
  decodeComparator,
  ditherMinFor,
  fixedGmacBlock,
  floorRestoringSlope,
  gainUpdate,
  gmacAverage,
  gmacConditionalMoments,
  gmacRunningSum,
  gmacSum,
  halfEvenTieAmplitude,
  incrementMeanError,
  negateExtended,
  negateInplace,
  quantizeIncrement,
  roundingMeanError,
  roundingRestoringSlope,
  roundingTransfer,
  runFixedGmacLoop,
  runFixedGmacLoopCases,
  saturateTwos,
  shiftRound,
  sumAverageTable,
  towardZeroRestoringSlope,
  unmappedUpdateAtTruth,
  wrapTwos,
  xorCarryAccumulate,
  DITHER_MIN,
  ROUNDING_MODES,
  type Bit,
  type FixedLoopParams,
  type RoundingMode,
} from './gmac'

interface Vector {
  inputs: Record<string, number>
  expected: Record<string, number>
  tolerance: { abs?: number; rel?: number }
  tolerance_overrides?: Record<string, { abs?: number; rel?: number }>
}

function golden(name: string): Vector {
  return JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${name}.json`), 'utf8')) as Vector
}

function expectGolden(v: Vector, key: string, actual: number): void {
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  const e = v.expected[key]
  expect(Math.abs(actual - e)).toBeLessThanOrEqual((tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(e))
}

const NEG = golden('negative_tests')
const T13 = golden('T13')

const BASE_LOOP: FixedLoopParams = {
  bx: 6,
  codeRange: 'symmetric',
  codeKind: 'uniform',
  dsmFrac: 0.3,
  log2N: 10,
  accBits: 16,
  accOverflow: 'wrap',
  negate: 'extend',
  gmMode: 'average',
  gFracBits: 4,
  rounding: 'floor',
  aTrue: 3,
  aStepBlock: -1,
  aStepValue: 3,
  w0: 3,
  mu: 10,
  sigmaV: 100,
  physMin: -16,
  physMax: 16,
  regMin: -32,
  regMax: 32,
  regOverflow: 'saturate',
  antiWindup: true,
  numBlocks: 3000,
  seed: 20261010,
}

describe('comparator 位元與編碼', () => {
  it('tie 規則 e = 0 ⇒ b = 1（E07），q = 2b − 1', () => {
    expect(comparatorBit(0)).toBe(1)
    expect(comparatorBit(-1e-300)).toBe(0)
    expect(bitToBipolar(1)).toBe(1)
    expect(bitToBipolar(0)).toBe(-1)
    for (const b of [0, 1] as Bit[]) {
      expect(decodeComparator(b, 'bipolar_pm_one')).toBe(2 * b - 1)
      expect(decodeComparator(b, 'unipolar_mapped')).toBe(2 * b - 1)
      expect(decodeComparator(b, 'unipolar_unmapped_bug')).toBe(b)
    }
  })

  it('T04: 反面測試（錯誤 0/1 編碼）：w = a 時每 sample 平均更新 = E[x]/2（golden negative_tests）', () => {
    // 零均值 code ⇒ 0；DC code {−1, −0.5, 0, 0.5, 1, 1.5} ⇒ 0.125
    expectGolden(NEG, 'wrong_encoding_update_at_truth_zero_mean_code', unmappedUpdateAtTruth([-1, -0.5, 0, 0.5, 1]))
    expectGolden(NEG, 'wrong_encoding_update_at_truth_dc_code', unmappedUpdateAtTruth([-1, -0.5, 0, 0.5, 1, 1.5]))
    // 以 Monte Carlo 確認：δ = 0 時 P(b = 1) = ½，E[b·x] = E[x]/2
    const rng = createRng(7)
    const codes = [-1, -0.5, 0, 0.5, 1, 1.5]
    let s = 0
    const n = 200_000
    for (let i = 0; i < n; i++) {
      const x = codes[rng.int(0, codes.length - 1)]
      s += comparatorBit(0 * x + rng.normal()) * x
    }
    expect(s / n).toBeCloseTo(0.125, 2)
  })

  it('恆等式 G_bug = ½G + ½·mean(x)（每個 block 精確成立）', () => {
    const rng = createRng(3)
    for (let t = 0; t < 50; t++) {
      const N = 1 + rng.int(0, 63)
      const x = Array.from({ length: N }, () => rng.normal() + 0.3)
      const b = Array.from({ length: N }, () => (rng.uniform() < 0.5 ? 1 : 0) as Bit)
      const q = b.map((bi) => decodeComparator(bi, 'bipolar_pm_one'))
      const qb = b.map((bi) => decodeComparator(bi, 'unipolar_unmapped_bug'))
      const xbar = x.reduce((a, v) => a + v, 0) / N
      expect(gmacAverage(qb, x)).toBeCloseTo(0.5 * gmacAverage(q, x) + 0.5 * xbar, 12)
    }
  })
})

describe('sum vs average', () => {
  it('T13: sum 模式的 loop gain 放大 N 倍（golden T13 g_sum_mode / pole_sum_mode、negative_tests multiplier）', () => {
    const [row] = sumAverageTable({ mu: T13.inputs.mu_fs, sigmaV: T13.inputs.sigma_v_fs, C: T13.inputs.C, Ex2: 1, Ns: [T13.inputs.N] })
    expectGolden(T13, 'g', row.gAvg)
    expectGolden(T13, 'p', row.poleAvg)
    expectGolden(T13, 'g_sum_mode', row.gSum)
    expectGolden(T13, 'pole_sum_mode', row.poleSum)
    expectGolden(NEG, 'sum_mode_gain_multiplier', Math.round(row.gSum / row.gAvg))
    expect(row.stableAvg).toBe(true)
    expect(row.stableSum).toBe(false)
  })

  it('T13: 反面測試：同一個 μ，sum 的更新量是 average 的 N 倍；μ_sum = μ_avg/N 時更新完全相同', () => {
    const rng = createRng(11)
    for (const N of [1, 3, 16, 100, 4096]) {
      const x = Array.from({ length: N }, () => rng.normal())
      const q = Array.from({ length: N }, () => rng.sign())
      const dAvg = blockUpdate(0, q, x, 10, 'average')
      const dSum = blockUpdate(0, q, x, 10, 'sum')
      expect(dSum).toBeCloseTo(N * dAvg, 9)
      expect(blockUpdate(1.5, q, x, 10 / N, 'sum')).toBeCloseTo(blockUpdate(1.5, q, x, 10, 'average'), 12)
      expect(gmacSum(q, x)).toBeCloseTo(N * gmacAverage(q, x), 9)
      expect(gmacRunningSum(q, x)[N - 1]).toBeCloseTo(gmacSum(q, x), 12)
    }
  })

  it('E18：sum 與 average 的標準差差 N 倍（收斂附近）', () => {
    const rows = sumAverageTable({ mu: 10, sigmaV: 100, C: 1, Ex2: 1, Ns: [10000] })
    expect(rows[0].sdSum / rows[0].sdAvg).toBeCloseTo(10000, 9)
  })

  it('條件平均 E[G | codes] 與 Monte Carlo 一致（含 bug 編碼）', () => {
    const rng = createRng(5)
    const N = 16
    const x = Array.from({ length: N }, () => rng.sign())
    const eDet = x.map((v) => 30 * v)
    for (const enc of ['bipolar_pm_one', 'unipolar_unmapped_bug'] as const) {
      const mom = gmacConditionalMoments(eDet, x, 20, enc, 'average')
      const trials = 20000
      let s = 0
      for (let t = 0; t < trials; t++) {
        const q = eDet.map((e) => decodeComparator(comparatorBit(e + 20 * rng.normal()), enc))
        s += gmacAverage(q, x)
      }
      expect(Math.abs(s / trials - mom.mean)).toBeLessThan((5 * mom.sd) / Math.sqrt(trials))
    }
  })
})

describe('位元級運算', () => {
  it('wrapTwos / saturateTwos：與 Python wrap_twos_complement 相同的定義；golden 17-bit wrap 126976 → −4096', () => {
    expectGolden(NEG, 'gmac_17bit_wrapped_sum', wrapTwos(31 * 4096, 17))
    for (let v = -300; v <= 300; v++) {
      const m = 256
      const r = ((v % m) + m) % m
      expect(wrapTwos(v, 8)).toBe(r >= 128 ? r - m : r)
      expect(saturateTwos(v, 8)).toBe(Math.min(127, Math.max(-128, v)))
    }
  })

  it('反面測試：條件取負在 B_x bits 內只有最負 code 出錯（6-bit 窮舉）', () => {
    const [lo, hi] = codeRangeOf(6, 'full')
    let errors = 0
    for (let x = lo; x <= hi; x++) {
      for (const b of [0, 1] as Bit[]) {
        expect(negateExtended(x, b)).toBe((2 * b - 1) * x)
        if (negateInplace(x, b, 6) !== negateExtended(x, b)) {
          errors++
          expect(x).toBe(-32)
          expect(b).toBe(0)
          expect(negateInplace(x, b, 6)).toBe(-32)
        }
      }
    }
    expect(errors).toBe(1)
  })

  it('XOR + carry-in 與 acc + q·x 逐位元相同（6-bit code、12-bit 累加器）', () => {
    const [lo, hi] = codeRangeOf(6, 'full')
    for (const acc of [-2048, -100, 0, 77, 2047]) {
      for (let x = lo; x <= hi; x++) {
        for (const b of [0, 1] as Bit[]) {
          expect(xorCarryAccumulate(acc, x, b, 12, 'wrap')).toBe(wrapTwos(acc + (2 * b - 1) * x, 12))
          expect(xorCarryAccumulate(acc, x, b, 12, 'saturate')).toBe(saturateTwos(acc + (2 * b - 1) * x, 12))
        }
      }
    }
  })
})

describe('累加器位元數（§16.1 第 3 項）', () => {
  it('golden：6-bit × 4096 對稱 code 需要 18 bits（Python accumulator_bits_required）', () => {
    expectGolden(NEG, 'gmac_bits_required', accumulatorBitsRequired(NEG.inputs.gmac_input_bits, NEG.inputs.N, 'symmetric'))
    expect(accumulatorBitsRequired(6, 4096, 'full')).toBe(19)
  })

  it('與窮舉最壞情況一致；symmetric 在 N 為 2 的冪時等於 Python 的 B_x + ⌈log₂N⌉', () => {
    for (let bx = 2; bx <= 8; bx++) {
      for (let N = 1; N <= 70; N++) {
        for (const range of ['symmetric', 'full'] as const) {
          const A = accumulatorBitsRequired(bx, N, range)
          const [lo, hi] = codeRangeOf(bx, range)
          const maxAbs = Math.max(-lo, hi)
          const worstPos = N * maxAbs // q = −1、x = lo（或 q = +1、x = hi）
          const worstNeg = -N * maxAbs
          // A bits 放得下、A − 1 bits 放不下
          expect(worstPos).toBeLessThanOrEqual(2 ** (A - 1) - 1)
          expect(worstNeg).toBeGreaterThanOrEqual(-(2 ** (A - 1)))
          expect(worstPos > 2 ** (A - 2) - 1 || worstNeg < -(2 ** (A - 2))).toBe(true)
          if (range === 'symmetric') expect(A).toBeLessThanOrEqual(bx + Math.ceil(Math.log2(N)))
          if (range === 'symmetric' && Number.isInteger(Math.log2(N))) expect(A).toBe(bx + Math.log2(N))
          if (range === 'full' && Number.isInteger(Math.log2(N))) expect(A).toBe(bx + Math.log2(N) + 1)
        }
      }
    }
  })

  it('F-04.9 封閉式 1 + ⌈log₂(N·M_x + 1)⌉ 與窮舉一致；B_x + ⌈log₂N⌉ 對 symmetric 只是充分條件（反例 B_x = 2、N = 3）', () => {
    for (let bx = 2; bx <= 16; bx++) {
      for (let N = 1; N <= 5000; N += N < 300 ? 1 : 97) {
        for (const range of ['symmetric', 'full'] as const) expect(accumulatorBitsClosedForm(bx, N, range)).toBe(accumulatorBitsRequired(bx, N, range))
        expect(accumulatorBitsClosedForm(bx, N, 'full')).toBe(bx + Math.floor(Math.log2(N)) + 1)
      }
    }
    // 反例：|x| ≤ 1、N = 3 ⇒ |S| ≤ 3 ⇒ 3 bits 就夠（[−4, 3]），經驗法則給 4
    expect(accumulatorBitsRequired(2, 3, 'symmetric')).toBe(3)
    expect(2 + Math.ceil(Math.log2(3))).toBe(4)
    // full range 且 N = 2^m：經驗法則少 1 bit
    expect(accumulatorBitsRequired(6, 4096, 'full')).toBe(6 + 12 + 1)
    const sz = accumulatorSizing(6, 4096, 'full')
    expect(sz.bitsExact - sz.bitsRule).toBe(1)
  })

  it('反面測試（定點 overflow）：17-bit 累加器在最壞情況 wrap 成 −4096 並變號；18-bit 不溢位', () => {
    const base = { bx: 6, log2N: 12, codeRange: 'symmetric' as const, negate: 'extend' as const, scenario: 'worst_case' as const, deltaOverSigma: 0, seed: 1 }
    const bad = accumulatorTrace({ ...base, accBits: 17 })
    expect(bad.finalExact).toBe(126976)
    expectGolden(NEG, 'gmac_17bit_wrapped_sum', bad.finalWrap)
    expect(bad.signFlip).toBe(true)
    expect(bad.finalSaturate).toBe(2 ** 16 - 1)
    expect(bad.firstOverflow).toBe(Math.floor((2 ** 16 - 1) / 31)) // 第一次超過 65535 的 sample
    const ok = accumulatorTrace({ ...base, accBits: 18 })
    expect(ok.wrapEvents).toBe(0)
    expect(ok.finalWrap).toBe(126976)
    expect(accumulatorSizing(6, 4096, 'symmetric').bitsExact).toBe(18)
  })

  it('反面測試：full range + B_x bits 內取負 ⇒ 一直是最負 code 時總和變號', () => {
    const r = accumulatorTrace({ bx: 6, log2N: 12, codeRange: 'full', accBits: 19, negate: 'inplace', scenario: 'min_code', deltaOverSigma: 3, seed: 1 })
    expect(r.negateErrors).toBeGreaterThan(4000)
    expect(r.finalExact).toBeGreaterThan(0)
    expect(r.finalWrap).toBeLessThan(0)
    expect(r.signFlip).toBe(true)
    expect(r.wrapEvents).toBe(0) // 19 bits 夠，錯是取負造成的
  })
})

describe('右移 rounding（§16.1 第 5 項）', () => {
  it('shiftRound 與定義一致；ℓ ≤ 0 為精確左移', () => {
    for (let v = -200; v <= 200; v++) {
      for (const ell of [1, 2, 3, 5]) {
        const d = 2 ** ell
        expect(shiftRound(v, ell, 'floor')).toBe(Math.floor(v / d))
        expect(shiftRound(v, ell, 'half_up')).toBe(Math.floor(v / d + 0.5))
        expect(shiftRound(v, ell, 'toward_zero')).toBe(Math.trunc(v / d))
        const he = shiftRound(v, ell, 'half_even')
        expect(Math.abs(he - v / d)).toBeLessThanOrEqual(0.5)
        if (Math.abs(he - v / d) === 0.5) expect(Math.abs(he % 2)).toBe(0)
      }
      expect(shiftRound(v, 0, 'floor')).toBe(v)
      expect(shiftRound(v, -2, 'floor')).toBe(4 * v)
    }
  })

  it('均勻餘數的平均誤差：對一個完整週期窮舉 = roundingMeanError（F-04.10）', () => {
    for (const ell of [1, 2, 4, 8]) {
      const d = 2 ** ell
      for (const mode of ROUNDING_MODES) {
        for (const base of [0, 5 * d, -7 * d]) {
          // 兩個週期（奇偶商各一次），half_even 的 tie 才會平均
          let s = 0
          for (let r = 0; r < 2 * d; r++) {
            const v = base + r
            s += shiftRound(v, ell, mode) - v / d
          }
          const sign = base >= 0 ? 1 : -1
          expect(s / (2 * d)).toBeCloseTo(roundingMeanError(ell, mode, sign), 12)
        }
      }
    }
  })

  // ── half-even 的 0 需要「恰好一半（tie）時商的奇偶各半」；只有餘數均勻不夠（外部審查 R11） ──
  /** shiftRound 的平均誤差 E[Q(S) − S/2^ℓ]（對給定的整數集合取等權平均） */
  const meanErr = (pts: number[], ell: number, mode: RoundingMode): number => pts.reduce((a, S) => a + shiftRound(S, ell, mode) - S / 2 ** ell, 0) / pts.length
  /** tie（餘數恰好是 2^{ℓ−1}）且商為奇／偶的機率 */
  const tieParity = (pts: number[], ell: number): { odd: number; even: number } => {
    const d = 2 ** ell
    let odd = 0
    let even = 0
    for (const S of pts) {
      const j = Math.floor(S / d)
      if (S - j * d !== d / 2) continue
      if (Math.abs(j % 2) === 1) odd++
      else even++
    }
    return { odd: odd / pts.length, even: even / pts.length }
  }

  it('反例（R11）：ℓ = 2、S = 8K + R（R = 0…3）餘數完全均勻但商恆為偶數 ⇒ half-even 平均 −1/8 LSB；floor、half-up 仍等於 F-04.10', () => {
    const pts: number[] = []
    for (let K = -3; K <= 3; K++) for (let r = 0; r < 4; r++) pts.push(8 * K + r)
    expect(pts.length).toBe(28)
    const hist = [0, 0, 0, 0]
    for (const S of pts) hist[((S % 4) + 4) % 4]++
    expect(hist).toEqual([7, 7, 7, 7]) // S mod 4 完全均勻
    expect(pts.every((S) => Math.floor(S / 4) % 2 === 0)).toBe(true) // 商 = 2K，恆為偶數
    // 只需要餘數均勻的三種：與封閉式相同
    expect(meanErr(pts, 2, 'floor')).toBeCloseTo(roundingMeanError(2, 'floor'), 12)
    expect(roundingMeanError(2, 'floor')).toBe(-0.375)
    expect(meanErr(pts, 2, 'half_up')).toBeCloseTo(roundingMeanError(2, 'half_up'), 12)
    expect(roundingMeanError(2, 'half_up')).toBe(0.125)
    // half-even：封閉式回傳 0（它另外假設 tie 時商的奇偶各半），這個分布的實際平均是 −1/8
    expect(roundingMeanError(2, 'half_even')).toBe(0)
    expect(meanErr(pts, 2, 'half_even')).toBeCloseTo(-0.125, 12)
    // 一般式：ε̄ = ½·[P(tie 且商為奇) − P(tie 且商為偶)]，|ε̄| ≤ 2^{−ℓ−1}
    const tp = tieParity(pts, 2)
    expect([tp.odd, tp.even]).toEqual([0, 0.25])
    expect(meanErr(pts, 2, 'half_even')).toBeCloseTo(0.5 * (tp.odd - tp.even), 12)
    expect(Math.abs(meanErr(pts, 2, 'half_even'))).toBeLessThanOrEqual(2 ** -3)
    // 逐點：S = 0…7 的 half-even 誤差（頁面推導的例子）
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((S) => shiftRound(S, 2, 'half_even') - S / 4)).toEqual([0, -0.25, -0.5, 0.25, 0, -0.25, 0.5, 0.25])
    // 一個週期、商為偶數：−2^{−(ℓ+1)}（上界取到等號）
    for (const ell of [1, 2, 4, 8]) {
      const one = Array.from({ length: 2 ** ell }, (_, i) => i)
      expect(meanErr(one, ell, 'half_even')).toBeCloseTo(-(2 ** -(ell + 1)), 12)
    }
    // 只有 σ_S 大並不夠（頁面的說法）：K 散得很開時 σ_S/2^ℓ 可以任意大，餘數仍完全均勻、商仍恆為偶數，half-even 的平均還是 −1/8
    const wide: number[] = []
    for (const K of [-123456, -1000, -40, 7, 512, 99999]) for (let r = 0; r < 4; r++) wide.push(8 * K + r)
    const mu = wide.reduce((a, S) => a + S, 0) / wide.length
    const sigmaS = Math.sqrt(wide.reduce((a, S) => a + (S - mu) ** 2, 0) / wide.length)
    expect(sigmaS / 4).toBeGreaterThan(1e5) // σ_S/2^ℓ ≫ 1
    const histWide = [0, 0, 0, 0]
    for (const S of wide) histWide[((S % 4) + 4) % 4]++
    expect(histWide).toEqual([6, 6, 6, 6])
    expect(meanErr(wide, 2, 'half_even')).toBeCloseTo(-0.125, 9)
    expect(meanErr(wide, 2, 'floor')).toBeCloseTo(-0.375, 9)
    expect(meanErr(wide, 2, 'half_up')).toBeCloseTo(0.125, 9)
  })

  it('鏡像與正常對照（R11）：商恆為奇數 ⇒ +1/8；S mod 2^{ℓ+1} 均勻 ⇒ 0 = roundingMeanError', () => {
    const odd: number[] = []
    const full: number[] = []
    for (let K = -3; K <= 3; K++) {
      for (let r = 0; r < 4; r++) odd.push(8 * K + 4 + r) // 商 = 2K + 1
      for (let r = 0; r < 8; r++) full.push(8 * K + r) // S mod 8 均勻：奇偶商各半
    }
    expect(meanErr(odd, 2, 'half_even')).toBeCloseTo(0.125, 12)
    expect(tieParity(odd, 2)).toEqual({ odd: 0.25, even: 0 })
    expect(meanErr(full, 2, 'half_even')).toBeCloseTo(0, 12)
    expect(meanErr(full, 2, 'half_even')).toBeCloseTo(roundingMeanError(2, 'half_even'), 12)
    const tp = tieParity(full, 2)
    expect(tp.odd).toBe(tp.even)
    expect(tp.odd).toBe(0.125)
  })

  it('half-even 是奇函數 Q(−S) = −Q(S)：S 的分布對 0 對稱時平均輸出恰為 0（不需要餘數均勻）——閉迴路平衡點 δ = 0 的理由', () => {
    for (const ell of [1, 2, 3, 5, 8]) {
      for (let v = -400; v <= 400; v++) expect(shiftRound(-v, ell, 'half_even') + shiftRound(v, ell, 'half_even')).toBe(0) // 比較「和」，避免 −0 與 0
    }
    expect(shiftRound(-1, 2, 'floor') + shiftRound(1, 2, 'floor')).toBe(-1) // 對照：floor 不是奇函數
    // 對稱但餘數不均勻：S = −5…5、ℓ = 2
    const sym = Array.from({ length: 11 }, (_, i) => i - 5)
    const hist = [0, 0, 0, 0]
    for (const S of sym) hist[((S % 4) + 4) % 4]++
    expect(hist).toEqual([3, 3, 2, 3])
    expect(sym.reduce((a, S) => a + shiftRound(S, 2, 'half_even'), 0)).toBe(0)
    expect(sym.reduce((a, S) => a + shiftRound(S, 2, 'floor'), 0)).toBe(-4)
    // S → −S 把商為 j 的 tie 換成商為 −j − 1 的 tie（奇偶相反）⇒ 對稱分布自動滿足 tie 的奇偶各半
    const tp = tieParity(sym, 2)
    expect(tp.odd).toBe(tp.even)
    expect(tp.odd).toBeCloseTo(1 / 11, 15)
    // 第二個取整點（μ·G → W）的 half-even 也是奇函數
    for (const R of [2, 4, 8, 6.4, 1.5]) {
      for (let j = -400; j <= 400; j++) expect(quantizeIncrement(-j / R, 1, 'half_even') + quantizeIncrement(j / R, 1, 'half_even')).toBe(0)
    }
  })

  it('離散 Gaussian 的 S（面板 B 的模型）：half-even 的殘餘誤差 = −2^{−ℓ}·e^{−π²s²/2}·sin(πm)（tie 項），m = 0 時恆為 0；floor、half-up 收斂得快得多', () => {
    const rt = roundingTransfer({ ell: 2, ditherRatio: 1, mRange: 2, maxPoints: 100000 })
    expect(rt.m.length).toBe(17)
    expect([rt.m[8], rt.m[10], rt.m[14]]).toEqual([0, 0.5, 1.5])
    const amp = 0.25 * halfEvenTieAmplitude(1)
    expect(halfEvenTieAmplitude(1)).toBeCloseTo(Math.exp(-(Math.PI ** 2) / 2), 15)
    expect(halfEvenTieAmplitude(1)).toBeCloseTo(0.0071919, 7) // 頁面：約 0.0072 × 2^{−ℓ}，half-up 的 1.4%
    expect(halfEvenTieAmplitude(1) / 0.5).toBeCloseTo(0.014, 3)
    expect(Math.abs(rt.bias.half_even[8])).toBeLessThan(1e-12) // m = 0：對稱 ⇒ 0
    expect(rt.bias.half_even[10]).toBeCloseTo(-amp, 9) // m = ½：−0.0017979708
    expect(rt.bias.half_even[10]).toBeCloseTo(-0.0017979708, 9)
    expect(rt.bias.half_even[14]).toBeCloseTo(+amp, 9) // m = 3/2：反號
    expect(Math.max(...Array.from(rt.bias.half_even, Math.abs))).toBeCloseTo(amp, 9)
    // 每一個 m 都符合 tie 項的封閉式（s = 1 時餘數不均勻的那一項只有 1e-9 量級）
    rt.m.forEach((m, i) => expect(rt.bias.half_even[i]).toBeCloseTo(-amp * Math.sin(Math.PI * m), 8))
    // 同一組參數下只靠餘數均勻的 floor、half-up 已經和 F-04.10 相差不到 1e-8
    rt.m.forEach((_, i) => {
      expect(Math.abs(rt.bias.floor[i] - roundingMeanError(2, 'floor'))).toBeLessThan(1e-8)
      expect(Math.abs(rt.bias.half_up[i] - roundingMeanError(2, 'half_up'))).toBeLessThan(1e-8)
    })
    // 振幅 × 2^ℓ 與 ℓ 無關（頁面的「不超過約 0.0072 × 2^{−ℓ}」）；dither 加倍後小到 1e-10
    for (const ell of [1, 4, 6, 8]) {
      const r = roundingTransfer({ ell, ditherRatio: 1, mRange: 2, maxPoints: 100000 })
      expect(Math.max(...Array.from(r.bias.half_even, Math.abs)) * 2 ** ell).toBeCloseTo(halfEvenTieAmplitude(1), 9)
    }
    const wide = roundingTransfer({ ell: 4, ditherRatio: 2, mRange: 2, maxPoints: 100000 })
    expect(Math.max(...Array.from(wide.bias.half_even, Math.abs))).toBeLessThan(1e-9)
    expect(Math.max(...Array.from(wide.bias.half_even, Math.abs))).toBeCloseTo(2 ** -4 * halfEvenTieAmplitude(2), 12)
    // 餘數不均勻的那一項（不隨 ℓ 縮小）：s = 1 時 e^{−2π²}/π ≈ 8.5e-10，ℓ = 16 時仍比 tie 項小兩個數量級以上
    expect((2 ** -16 * halfEvenTieAmplitude(1)) / (Math.exp(-2 * Math.PI ** 2) / Math.PI)).toBeGreaterThan(100)
  })

  it('rounding 轉移特性：dither 充分時 floor ≈ −(1 − 2^{−ℓ})/2、half-even ≈ 0；無雜訊時 toward-zero 有 dead zone', () => {
    const rt = roundingTransfer({ ell: 4, ditherRatio: 2, mRange: 2 })
    const mid = Math.floor(rt.m.length / 2)
    expect(rt.m[mid]).toBe(0)
    expect(rt.bias.floor[mid]).toBeCloseTo(-(1 - 1 / 16) / 2, 6)
    expect(rt.bias.half_up[mid]).toBeCloseTo(1 / 32, 6)
    expect(rt.bias.half_even[mid]).toBeCloseTo(0, 6)
    expect(rt.bias.toward_zero[mid]).toBeCloseTo(0, 6)
    // toward-zero：bias ≈ (1 − 2^{−ℓ})/2·(2Φ(−m/σ) − 1)；m = −2、σ = 2 LSB ⇒ 0.46875·0.6827
    expect(rt.bias.toward_zero[0]).toBeCloseTo((1 - 1 / 16) / 2 * (2 * normCdf(1) - 1), 2)
    const far = roundingTransfer({ ell: 4, ditherRatio: 1, mRange: 6 })
    expect(far.bias.toward_zero[0]).toBeCloseTo((1 - 1 / 16) / 2, 4) // m = −6σ：完全像 ceil
    expect(far.bias.toward_zero[far.m.length - 1]).toBeCloseTo(-(1 - 1 / 16) / 2, 4)
    const nd = roundingTransfer({ ell: 4, ditherRatio: 0, mRange: 2 })
    nd.m.forEach((m, i) => {
      if (Math.abs(m) < 1) expect(nd.meanTransfer.toward_zero[i]).toBe(0)
    })
  })
})

describe('roundingTransfer 的快速算法', () => {
  it('分段常數區段求和 = 逐點離散 Gaussian 卷積（多組 ℓ、dither 比）', () => {
    for (const [ell, dr] of [
      [1, 0],
      [1, 0.3],
      [3, 0.2],
      [4, 1],
      [6, 0.05],
      [8, 3],
    ] as const) {
      const rt = roundingTransfer({ ell, ditherRatio: dr, mRange: 3 })
      const d = 2 ** ell
      const sigma = dr * d
      const span = sigma > 0 ? Math.ceil(8 * sigma) + 1 : 0
      for (const mode of ROUNDING_MODES) {
        for (const idx of [0, Math.floor(rt.m.length / 3), Math.floor(rt.m.length / 2), rt.m.length - 1]) {
          const j = Math.round(rt.m[idx] * d)
          let eq = 0
          let ws = 0
          for (let t = -span; t <= span; t++) {
            const w = sigma > 0 ? Math.exp(-(t * t) / (2 * sigma * sigma)) : 1
            eq += w * shiftRound(j + t, ell, mode)
            ws += w
          }
          expect(rt.meanTransfer[mode][idx]).toBeCloseTo(eq / ws, 10)
        }
      }
    }
  })
})

describe('位元級 GMAC 與閉迴路', () => {
  it('fixedGmacBlock：F_G ≥ log₂N（不需取整）且位元數足夠時與浮點 GMAC 完全相同', () => {
    const rng = createRng(9)
    const N = 256
    const xInt = Float64Array.from({ length: N }, () => rng.int(-31, 31))
    const b = Uint8Array.from({ length: N }, () => (rng.uniform() < 0.6 ? 1 : 0))
    const out = fixedGmacBlock(xInt, b, { bx: 6, log2N: 8, accBits: 20, accOverflow: 'wrap', negate: 'extend', gmMode: 'average', gFracBits: 8, rounding: 'floor' })
    const q = Array.from(b, (v) => 2 * v - 1)
    const x = Array.from(xInt, (v) => v / 32)
    expect(out.G).toBeCloseTo(gmacAverage(q, x), 14)
    expect(out.S).toBe(out.Sexact)
    expect(out.overflow).toBe(0)
    const sum = fixedGmacBlock(xInt, b, { bx: 6, log2N: 8, accBits: 20, accOverflow: 'wrap', negate: 'extend', gmMode: 'sum', gFracBits: 0, rounding: 'floor' })
    expect(sum.G).toBeCloseTo(gmacSum(q, x), 12)
  })

  it('gainUpdate：anti-windup 停在實體 rail；saturate 只保護內部暫存器；wrap 跳到另一端', () => {
    const reg = { physMin: 0, physMax: 8, regMin: -32, regMax: 32, regOverflow: 'saturate' as const, antiWindup: true }
    expect(gainUpdate(7.5, 2, reg)).toEqual({ W: 8, applied: 8, sat: true, wrapped: false })
    const noAw = gainUpdate(7.5, 2, { ...reg, antiWindup: false })
    expect(noAw.W).toBe(9.5)
    expect(noAw.applied).toBe(8)
    expect(gainUpdate(31, 2, { ...reg, antiWindup: false }).W).toBe(32)
    const wr = gainUpdate(31, 2, { ...reg, antiWindup: false, regOverflow: 'wrap' })
    expect(wr.W).toBe(-31)
    expect(wr.wrapped).toBe(true)
    expect(wr.applied).toBe(0)
  })

  it('floor 偏差：定點 − 浮點的平均差 ≈ ε̄Δ_G/K（F-04.11；4 SE 內），half-even 無偏差', () => {
    const fl = runFixedGmacLoop(BASE_LOOP)
    expect(fl.analytic.ditherRatio).toBeGreaterThan(1)
    expect(fl.analytic.biasPred).toBeCloseTo(-0.37310416449191897, 10) // 預測值（解析）
    expect(Math.abs(fl.stats.biasDiff - fl.analytic.biasPred)).toBeLessThan(4 * fl.stats.biasDiffSe + 0.02)
    expect(fl.stats.biasDiff).toBeLessThan(-0.2)
    expect(fl.warnings.join('\n')).toMatch(/floor/)
    const he = runFixedGmacLoop({ ...BASE_LOOP, rounding: 'half_even' })
    expect(he.analytic.biasPred).toBe(0)
    expect(Math.abs(he.stats.biasDiff)).toBeLessThan(4 * he.stats.biasDiffSe + 0.02)
  }, 30000)

  it('多 seed：floor 偏差的 12-seed 平均與 ε̄Δ_G/K 相差 < 1 SE（F_G = 2 與 4；頁面引用的數字）', () => {
    for (const [F, pred] of [
      [2, -1.5101835229434817],
      [4, -0.37310416449191897],
    ] as const) {
      const vals: number[] = []
      for (let s = 1; s <= 12; s++) vals.push(runFixedGmacLoop({ ...BASE_LOOP, gFracBits: F, seed: s }).stats.biasDiff)
      const m = vals.reduce((a, v) => a + v, 0) / vals.length
      const se = Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / (vals.length - 1) / vals.length)
      expect(Math.abs(m - pred)).toBeLessThan(se)
      // 頁面文字：F_G = 2 → −1.516 ± 0.010；F_G = 4 → −0.370 ± 0.004
      if (F === 2) {
        expect(m).toBeCloseTo(-1.516, 2)
        expect(se).toBeLessThan(0.012)
      } else {
        expect(m).toBeCloseTo(-0.370, 2)
        expect(se).toBeLessThan(0.005)
      }
    }
  }, 120000)

  it('同 seed 完全重現；sum 模式警告 g 放大 N 倍', () => {
    const p = { ...BASE_LOOP, numBlocks: 50 }
    const a = runFixedGmacLoop(p)
    const b = runFixedGmacLoop(p)
    expect(Array.from(a.wFixed)).toEqual(Array.from(b.wFixed))
    expect(Array.from(a.wFloat)).toEqual(Array.from(b.wFloat))
    const s = runFixedGmacLoop({ ...p, gmMode: 'sum', accBits: 18 })
    expect(s.analytic.g).toBeCloseTo(1024 * a.analytic.g, 10)
    expect(s.warnings.join('\n')).toMatch(/gm_mode=sum 時有效增益放大 N 倍/)
  })

  it('anti-windup：a 超出範圍再回來時，有 anti-windup 的回復快得多；W wrap 會產生 wrap 事件', () => {
    const aw: FixedLoopParams = { ...BASE_LOOP, physMin: 0, physMax: 8, aTrue: 12, aStepBlock: 200, aStepValue: 4, numBlocks: 600, w0: 0, rounding: 'half_even' }
    const off = runFixedGmacLoopCases({
      cases: [
        { ...aw, antiWindup: false },
        { ...aw, antiWindup: true },
        { ...aw, antiWindup: false, regOverflow: 'wrap', aTrue: 16 },
      ],
    }).results
    expect(off[0].stats.recoveryFixed).not.toBeNull()
    expect(off[1].stats.recoveryFixed).not.toBeNull()
    expect(off[1].stats.recoveryFixed!).toBeLessThan(off[0].stats.recoveryFixed! / 4)
    expect(Math.max(...off[0].wFixed)).toBeGreaterThan(20) // windup
    expect(Math.max(...off[1].wFixed)).toBeLessThanOrEqual(8)
    expect(off[2].stats.wWrap).toBeGreaterThan(0)
    expect(off[0].warnings.join('\n')).toMatch(/windup/)
  }, 30000)

  it('反面測試：累加器位元不足 ⇒ overflow 警告；參數錯誤以繁中訊息丟出', () => {
    const r = runFixedGmacLoop({ ...BASE_LOOP, accBits: 10, numBlocks: 30, w0: -40, physMin: -64, regMin: -64, aTrue: 60, physMax: 64, regMax: 64 })
    expect(r.stats.accOverflow).toBeGreaterThan(0)
    expect(r.warnings.join('\n')).toMatch(/GMAC accumulator 溢位/)
    expect(() => runFixedGmacLoop({ ...BASE_LOOP, regMin: 0 })).toThrow(/內部暫存器範圍必須包住實體範圍/)
    expect(() => runFixedGmacLoop({ ...BASE_LOOP, log2N: 16, numBlocks: 1000 })).toThrow(/超過上限/)
  })

  it('biasFixedPoint：只有 rounding 時 = −ε̄Δ_G/K；取負 bug 時解 Kδ = 2p_min Φ(δ/σ_v)（F-04.15）', () => {
    const K = 0.0025765022275925863
    expect(biasFixedPoint({ K, sigmaV: 100, roundErr: -0.001, pMin: 0 })).toBeCloseTo(0.001 / K, 12)
    const d = biasFixedPoint({ K: 0.0026609138429118996, sigmaV: 100, roundErr: 0, pMin: 1 / 64 })
    expect(0.0026609138429118996 * d - (2 / 64) * normCdf(d / 100)).toBeCloseTo(0, 12)
    expect(d).toBeCloseTo(6.160492498486434, 9) // python：迭代 δ = 2p_min Φ(δ/σ_v)/K
    expect(d).toBeGreaterThan(1 / 64 / 0.0026609138429118996) // Φ > ½ ⇒ 比 Φ ≈ ½ 的近似大
    expect(biasFixedPoint({ K: 0, sigmaV: 100, roundErr: 0, pMin: 0.1 })).toBeNaN()
    expect(biasFixedPoint({ K, sigmaV: 0, roundErr: 0, pMin: 0.1 })).toBeNaN()
  })

  it('反面測試（取負 bug）：full range uniform code、B_x bits 內取負 ⇒ 4 個 seed 的 w* − a 與 F-04.15 自洽解一致', () => {
    const p: FixedLoopParams = { ...BASE_LOOP, codeRange: 'full', negate: 'inplace', rounding: 'half_even', accBits: 17, numBlocks: 1500, w0: 0 }
    const vals: number[] = []
    let pred = NaN
    for (let seed = 1; seed <= 4; seed++) {
      const r = runFixedGmacLoop({ ...p, seed })
      pred = r.analytic.biasPred
      expect(r.analytic.pMin).toBe(1 / 64)
      expect(r.stats.negateErrors).toBeGreaterThan(0)
      vals.push(r.stats.biasDiff)
    }
    const m = vals.reduce((a, v) => a + v, 0) / vals.length
    const se = Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / (vals.length - 1) / vals.length)
    expect(pred).toBeCloseTo(-6.160492498486434, 6)
    expect(Math.abs(m - pred)).toBeLessThan(4 * se + 0.1)
    // 正確取負：沒有偏差、p_min 不計
    const ok = runFixedGmacLoop({ ...p, negate: 'extend', seed: 1 })
    expect(ok.analytic.pMin).toBe(0)
    expect(ok.analytic.biasPred).toBe(0)
    expect(Math.abs(ok.stats.biasDiff)).toBeLessThan(4 * ok.stats.biasDiffSe + 0.02)
  }, 60000)

  it('F-04.12：a 跳回範圍內後的回復時間 ≈ windup 放掉 + 由 rail 指數收斂（無 anti-windup 與有 anti-windup）', () => {
    const aw: FixedLoopParams = { ...BASE_LOOP, physMin: 0, physMax: 8, aTrue: 16, aStepBlock: 250, aStepValue: 4, numBlocks: 700, w0: 0, rounding: 'half_even' }
    const [off, on, wrap] = runFixedGmacLoopCases({ cases: [{ ...aw, antiWindup: false }, { ...aw, antiWindup: true }, { ...aw, antiWindup: false, regOverflow: 'wrap' }] }).results
    // 無 anti-windup：W 停在內部上限 32 ⇒ (32 − 8)/(g·4) + ln(4/tol)/(−ln(1 − g))
    const g = off.analytic.g
    const expected = (32 - 8) / (g * 4) + Math.log(4 / off.stats.recoveryTol) / -Math.log(1 - g)
    expect(off.stats.recoveryPredFixed).toBeCloseTo(expected, 9)
    expect(off.stats.recoveryFixed!).toBeGreaterThan(0.85 * off.stats.recoveryPredFixed)
    expect(off.stats.recoveryFixed!).toBeLessThan(1.15 * off.stats.recoveryPredFixed)
    expect(on.stats.recoveryPredFixed).toBeLessThan(15)
    expect(Math.abs(on.stats.recoveryFixed! - on.stats.recoveryPredFixed)).toBeLessThan(10)
    expect(wrap.stats.recoveryPredFixed).toBeNaN() // W wrap：預測不適用
  }, 60000)

  it('runFixedGmacLoopCases 的 Monte Carlo：floor 偏差的多 seed 平均與預測一致；mcRuns 上限檢查', () => {
    const p = { ...BASE_LOOP, numBlocks: 1500 }
    const out = runFixedGmacLoopCases({ cases: [{ ...p, rounding: 'half_even' }, p], mcRuns: 6, mcCase: 1 })
    expect(out.mc).not.toBeNull()
    expect(out.mc!.caseIndex).toBe(1)
    expect(out.mc!.pred).toBeCloseTo(-0.37310416449191897, 10)
    expect(Math.abs(out.mc!.mean - out.mc!.pred)).toBeLessThan(4 * out.mc!.se + 0.02)
    expect(runFixedGmacLoopCases({ cases: [{ ...p, numBlocks: 10 }] }).mc).toBeNull()
    expect(() => runFixedGmacLoopCases({ cases: [{ ...p, numBlocks: 10 }], mcRuns: 64 })).toThrow(/mcRuns/)
  }, 60000)

  it('ar1MeanSe：白雜訊時接近 s/√n，強相關時放大', () => {
    const rng = createRng(2)
    const white = Float64Array.from({ length: 4000 }, () => rng.normal())
    const m = white.reduce((a, v) => a + v, 0) / white.length
    expect(ar1MeanSe(white, m)).toBeGreaterThan(0.012)
    expect(ar1MeanSe(white, m)).toBeLessThan(0.02)
    const ar = new Float64Array(4000)
    for (let i = 1; i < ar.length; i++) ar[i] = 0.95 * ar[i - 1] + rng.normal()
    const ma = ar.reduce((a, v) => a + v, 0) / ar.length
    expect(ar1MeanSe(ar, ma)).toBeGreaterThan(0.1)
  })
})

/** 多 seed 的「定點 − 浮點」平均與標準誤 */
function seedMean(p: FixedLoopParams, seeds: number): { m: number; se: number; pred: number; r: ReturnType<typeof runFixedGmacLoop> } {
  const vals: number[] = []
  let last = runFixedGmacLoop({ ...p, seed: 1 })
  for (let s = 1; s <= seeds; s++) {
    last = runFixedGmacLoop({ ...p, seed: s })
    vals.push(last.stats.biasDiff)
  }
  const m = vals.reduce((a, v) => a + v, 0) / seeds
  const se = Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / (seeds - 1) / seeds)
  return { m, se, pred: last.analytic.biasPred, r: last }
}

describe('第二個截斷點：μ·G 取整到 W 的 LSB（§16.1 第 6 項，F-04.18）', () => {
  it('quantizeIncrement：四種 rounding 的定義；Δ_W = 0 時原樣通過', () => {
    expect(quantizeIncrement(0.37, 0, 'floor')).toBe(0.37)
    for (let j = -40; j <= 40; j++) {
      const v = j / 8 // 更新量在 1/8 的格點上，Δ_W = 1
      expect(quantizeIncrement(v, 1, 'floor')).toBe(Math.floor(v))
      expect(quantizeIncrement(v, 1, 'half_up')).toBe(Math.floor(v + 0.5))
      expect(quantizeIncrement(v, 1, 'toward_zero') + 0).toBe(Math.trunc(v) + 0)
      const he = quantizeIncrement(v, 1, 'half_even')
      expect(Math.abs(he - v)).toBeLessThanOrEqual(0.5)
      if (Math.abs(he - v) === 0.5) expect(Math.abs(he % 2)).toBe(0)
      expect(quantizeIncrement(v * 0.25, 0.25, 'floor')).toBe(Math.floor(v) * 0.25) // 尺度不變
    }
  })

  it('incrementMeanError：對 R = p/q 的一個完整週期窮舉 = 封閉式（floor −(1 − 1/p)/2；half-up p 為偶數時 +1/(2p)）', () => {
    for (const [R, p] of [
      [1, 1],
      [2, 2],
      [3, 3],
      [8, 8],
      [16, 16],
      [6.4, 32], // 32/5
      [0.5, 1], // 更新量的格點是 Δ_W 的 2 倍：永遠在格點上
      [1.5, 3], // 3/2
    ] as const) {
      for (const mode of ROUNDING_MODES) {
        // 更新量 j/R（單位 Δ_W），j 走正負各 2p·q 個值（half-even 的 tie 奇偶各一次；toward-zero 正負兩側互相抵消）；q = p/R
        const q = Math.round(p / R)
        const period = 2 * p * q
        let acc = 0
        for (let j = -period; j < period; j++) acc += quantizeIncrement(j / R, 1, mode) - j / R
        expect(incrementMeanError(R, mode), `R=${R} ${mode}`).toBeCloseTo(acc / (2 * period), 9)
      }
      expect(incrementMeanError(R, 'floor')).toBeCloseTo(p === 1 ? 0 : -(1 - 1 / p) / 2, 12)
    }
    expect(incrementMeanError(Math.PI, 'floor')).toBe(-0.5) // 無理數比：連續均勻近似
    expect(incrementMeanError(0, 'floor')).toBe(0)
  })

  it('第二個取整點的 half-even（R11）：R 為偶數時一個週期（商恆為偶數）平均 −1/(2R)，兩個週期才是 0；R 為奇數沒有 tie，一個週期就是 0', () => {
    const mean = (R: number, n: number): number => {
      let acc = 0
      for (let j = 0; j < n; j++) acc += quantizeIncrement(j / R, 1, 'half_even') - j / R
      return acc / n
    }
    for (const [R, one] of [
      [2, -0.25],
      [4, -0.125],
      [8, -0.0625],
    ] as const) {
      expect(mean(R, R)).toBeCloseTo(one, 12) // 餘數 {0, 1/R, …, (R−1)/R} 各一次（均勻），但 tie 那一格的商是 0（偶數）
      expect(mean(R, R)).toBeCloseTo(-1 / (2 * R), 12) // 上界 |ε̄_W| ≤ 1/(2p) 取到等號
      expect(mean(R, 2 * R)).toBeCloseTo(0, 12) // 奇偶商各一次
      expect(incrementMeanError(R, 'half_even')).toBe(0)
    }
    expect(mean(3, 3)).toBeCloseTo(0, 12)
    expect(incrementMeanError(3, 'half_even')).toBe(0)
  })

  it('floorRestoringSlope：E[⌊X⌋] 在 m = ½ 恆為 0（任何 s），斜率 χ(s) = 1 + 2Σ(−1)^k e^{−2π²k²s²}', () => {
    // 精確的 E[⌊X⌋] = Σ_k k·P(k ≤ X < k+1)，X ~ N(m, s²)
    const meanFloor = (m: number, s: number): number => {
      let acc = 0
      for (let k = -60; k <= 60; k++) acc += k * (normCdf((k + 1 - m) / s) - normCdf((k - m) / s))
      return acc
    }
    for (const s of [0.05, 0.142, 0.25, 0.5, 1, 2.3]) {
      expect(meanFloor(0.5, s)).toBeCloseTo(0, 12) // 平衡點不靠 dither
      let fourier = 1
      for (let k = 1; k <= 60; k++) fourier += 2 * (-1) ** k * Math.exp(-2 * Math.PI ** 2 * k * k * s * s)
      expect(floorRestoringSlope(s)).toBeCloseTo(fourier, 9)
      const h = 1e-5
      expect(floorRestoringSlope(s)).toBeCloseTo((meanFloor(0.5 + h, s) - meanFloor(0.5 - h, s)) / (2 * h), 5)
    }
    // 頁面引用的數字
    expect(floorRestoringSlope(1)).toBeCloseTo(1, 7)
    expect(floorRestoringSlope(0.5)).toBeCloseTo(0.9856, 4)
    expect(floorRestoringSlope(DITHER_MIN)).toBeCloseTo(0.4321, 3)
    expect(floorRestoringSlope(0.142)).toBeCloseTo(0.0115, 3)
    expect(floorRestoringSlope(0)).toBe(0)
    expect(floorRestoringSlope(Infinity)).toBe(1)
  })

  it('analytic：W floor 的預測 = ε̄_WΔ_W/g；與 ÷N 的 floor 串接時 = −(1 − 2^{−(ℓ+ℓ_W)})Δ_W/(2g)；W 浮點時所有新欄位為 0', () => {
    const base = { ...BASE_LOOP, numBlocks: 20, rounding: 'half_even' as const }
    const fl = runFixedGmacLoop({ ...base, wLsb: 0.15625, wRounding: 'floor' }).analytic
    expect(fl.wRatio).toBe(8)
    expect(fl.meanIncErr).toBeCloseTo((-(1 - 1 / 8) / 2) * 0.15625, 15)
    expect(fl.biasPredW).toBeCloseTo(-2.6531851697203126, 10)
    expect(fl.biasPred).toBeCloseTo(fl.biasPredW, 12)
    expect(fl.ditherRatioW).toBeCloseTo(1.1365, 3)
    const both = runFixedGmacLoop({ ...base, rounding: 'floor', wLsb: 0.15625, wRounding: 'floor' }).analytic
    expect(both.biasPred).toBeCloseTo(both.biasPredRound + both.biasPredW, 12)
    expect(both.biasPred).toBeCloseTo((-(1 - 2 ** -(both.ell + 3)) * 0.15625) / (2 * both.g), 10) // ⌊⌊S/2^ℓ⌋/2^ℓ_W⌋ = ⌊S/2^{ℓ+ℓ_W}⌋
    const off = runFixedGmacLoop(base).analytic
    expect([off.wRatio, off.meanIncErr, off.biasPredW]).toEqual([0, 0, 0])
    expect(off.ditherRatioW).toBe(Infinity)
    expect(runFixedGmacLoop({ ...base, wLsb: 0.15625, wRounding: 'half_even' }).analytic.biasPred).toBe(0)
    expect(() => runFixedGmacLoop({ ...base, wLsb: -1 })).toThrow(/Δ_W 必須 ≥ 0/)
  })

  it('多 seed：W floor 的偏差 ≈ −Δ_W/(2g)·(1 − 1/R)；μ 減半偏差加倍；half-even 無偏差（頁面 §5.6 引用的數字）', () => {
    const base: FixedLoopParams = { ...BASE_LOOP, rounding: 'half_even', w0: 0, numBlocks: 2000, wLsb: 0.15625 }
    const fl = seedMean({ ...base, wRounding: 'floor' }, 8)
    expect(fl.pred).toBeCloseTo(-2.6532, 4)
    expect(Math.abs(fl.m - fl.pred)).toBeLessThan(4 * fl.se + 0.02)
    expect(fl.m).toBeCloseTo(-2.68, 1) // 頁面：−2.68 ± 0.02
    expect(fl.se).toBeLessThan(0.03)
    expect(fl.r.warnings.join('\n')).toMatch(/取整到 W 的 LSB/)
    const half = seedMean({ ...base, wRounding: 'floor', mu: 5 }, 8)
    expect(half.pred).toBeCloseTo(-5.6854, 4) // R = 16、g 減半 ⇒ 約 2 倍
    expect(Math.abs(half.m - half.pred)).toBeLessThan(4 * half.se + 0.02)
    expect(half.m).toBeCloseTo(-5.66, 1) // 頁面：−5.66 ± 0.05
    expect(half.se).toBeLessThan(0.06)
    expect(half.m / fl.m).toBeGreaterThan(1.9)
    const he = seedMean({ ...base, wRounding: 'half_even' }, 8)
    expect(he.pred).toBe(0)
    expect(Math.abs(he.m)).toBeLessThan(4 * he.se + 0.02) // 頁面：−0.02 ± 0.02
    expect(Math.abs(he.m)).toBeLessThan(0.05)
  }, 120000)

  it('dither 比低於 1 時 ÷N 的 floor 偏差仍與預測相符（0.57）；遠低於 DITHER_MIN（0.14）時停在 dead zone、預測不適用', () => {
    const base: FixedLoopParams = { ...BASE_LOOP, accBits: 20, gFracBits: 0, rounding: 'floor', physMin: -64, physMax: 64, regMin: -128, regMax: 128 }
    const ok = seedMean({ ...base, log2N: 10, numBlocks: 3000 }, 6)
    expect(ok.r.analytic.ditherRatio).toBeCloseTo(0.568, 3)
    expect(ok.r.analytic.ditherRatio).toBeGreaterThan(DITHER_MIN)
    expect(ok.pred).toBeCloseTo(-6.059, 3)
    expect(Math.abs(ok.m - ok.pred)).toBeLessThan(4 * ok.se + 0.02)
    expect(ok.m).toBeCloseTo(-6.13, 1) // 頁面：−6.13 ± 0.04
    expect(ok.se).toBeLessThan(0.05)
    expect(ok.r.warnings.join('\n')).not.toMatch(/dead zone/)
    const dead = seedMean({ ...base, log2N: 14, numBlocks: 600 }, 6)
    expect(dead.r.analytic.ditherRatio).toBeCloseTo(0.142, 3)
    expect(dead.pred).toBeCloseTo(-6.064, 3)
    expect(Math.abs(dead.m - dead.pred)).toBeGreaterThan(10 * dead.se) // 明顯到不了平衡點
    expect(dead.m).toBeCloseTo(-4.35, 1) // 頁面：−4.35 ± 0.09
    expect(dead.r.warnings.join('\n')).toMatch(/dead zone/)
  }, 180000)

  it('toward-zero 的回復斜率 χ_tz(s) = Σ_{k≠0} φ(k/s)/s：同樣的 s 下比 floor 的 χ(s) 小得多，所以 dither 比的下限加倍（ditherMinFor）', () => {
    // 註解與頁面引用的數字
    expect(towardZeroRestoringSlope(0.284)).toBeCloseTo(0.0057, 4)
    expect(towardZeroRestoringSlope(0.4)).toBeCloseTo(0.0876, 4)
    expect(towardZeroRestoringSlope(0.5)).toBeCloseTo(0.2165, 4)
    expect(towardZeroRestoringSlope(0.57)).toBeCloseTo(0.3034, 4)
    expect(towardZeroRestoringSlope(2.273)).toBeCloseTo(0.8245, 4)
    expect(towardZeroRestoringSlope(0)).toBe(0)
    expect(towardZeroRestoringSlope(Infinity)).toBe(1)
    // s ≲ 0.6：≈ ½·χ(s/2)（只差偶數點那幾項）；s ≳ 0.8：≈ 1 − φ(0)/s（所有整數點的總和 ≈ 1，少掉 k = 0 那一項）
    for (const sv of [0.25, 0.284, 0.4, 0.5]) expect(towardZeroRestoringSlope(sv) / (0.5 * floorRestoringSlope(sv / 2))).toBeCloseTo(1, 2)
    for (const sv of [0.8, 1, 2.273, 5]) expect(towardZeroRestoringSlope(sv)).toBeCloseTo(1 - 1 / (Math.sqrt(2 * Math.PI) * sv), 4)
    // 同樣的 dither 比：floor 幾乎不受影響時 toward-zero 還在 dead zone
    expect(floorRestoringSlope(0.284)).toBeGreaterThan(0.59)
    expect(towardZeroRestoringSlope(0.284)).toBeLessThan(0.006)
    // 與面板 B 的精確模型（離散 Gaussian、ℓ = 8）比對：E[Q(S)] 在平衡點 m = 0 對 m 的斜率（差分；格點效應約 1–3%）。
    // half-even 在 m = 0 的斜率就是 floor 在 m = ½ 的 χ(s)
    for (const sv of [0.284, 0.4, 0.5, 0.57, 1, 2]) {
      const rt = roundingTransfer({ ell: 8, ditherRatio: sv, mRange: 1, maxPoints: 100000 })
      const mid = (rt.m.length - 1) / 2
      expect(rt.m[mid]).toBe(0)
      const slopeAt = (mode: RoundingMode, i: number): number => (rt.meanTransfer[mode][i + 4] - rt.meanTransfer[mode][i - 4]) / (rt.m[i + 4] - rt.m[i - 4])
      expect(slopeAt('toward_zero', mid) / towardZeroRestoringSlope(sv), `tz ${sv}`).toBeCloseTo(1, 1)
      expect(slopeAt('half_even', mid) / floorRestoringSlope(sv), `he ${sv}`).toBeCloseTo(1, 1)
      expect(rt.m[mid + 128]).toBe(0.5)
      expect(slopeAt('floor', mid + 128) / floorRestoringSlope(sv), `floor ${sv}`).toBeCloseTo(1, 1)
    }
    // 下限與回復斜率依模式選擇
    expect(ROUNDING_MODES.map(ditherMinFor)).toEqual([DITHER_MIN, DITHER_MIN, 2 * DITHER_MIN, DITHER_MIN]) // floor、half_up、toward_zero、half_even
    for (const mode of ROUNDING_MODES) expect(roundingRestoringSlope(0.4, mode)).toBe(mode === 'toward_zero' ? towardZeroRestoringSlope(0.4) : floorRestoringSlope(0.4))
  })

  it('dead zone 警告的下限依 rounding 模式而定：toward-zero 在 0.25 ≤ dither 比 < 0.5 也警告（用它自己的回復斜率），其他模式的訊息與門檻不變', () => {
    const dz = (p: FixedLoopParams): string[] => runFixedGmacLoop(p).warnings.filter((w) => /dead zone/.test(w))
    // ── ÷N 的右移：σ_S/2^ℓ = 0.284（log2 N = 12、F_G = 0）──
    const base: FixedLoopParams = { ...BASE_LOOP, accBits: 20, gFracBits: 0, log2N: 12, numBlocks: 40, w0: 0 }
    const tz = runFixedGmacLoop({ ...base, rounding: 'toward_zero' })
    expect(tz.analytic.ditherRatio).toBeCloseTo(0.284, 3)
    expect(tz.analytic.ditherRatio).toBeGreaterThan(DITHER_MIN)
    const tzMsg = tz.warnings.filter((w) => /dead zone/.test(w))
    expect(tzMsg.length).toBe(1)
    expect(tzMsg[0]).toContain('σ_S/2^ℓ = 0.284 < 0.5（toward-zero 的下限是 floor 的兩倍）')
    expect(tzMsg[0]).toContain('回復斜率只剩 χ ≈ 0.0057（1 = 沒有取整）')
    expect(tzMsg[0]).toContain('偏差預測（F-04.11）不再適用')
    for (const rounding of ['floor', 'half_up', 'half_even'] as const) expect(dz({ ...base, rounding }), rounding).toEqual([])
    expect(dz({ ...base, log2N: 10, rounding: 'toward_zero' })).toEqual([]) // 0.568 ≥ 0.5
    // 低於 DITHER_MIN（0.142）：toward-zero 仍用自己的訊息；floor 的訊息一字不變
    expect(dz({ ...base, log2N: 14, rounding: 'toward_zero' })[0]).toContain('σ_S/2^ℓ = 0.142 < 0.5（toward-zero 的下限是 floor 的兩倍）')
    const flDead = dz({ ...base, log2N: 14, rounding: 'floor' })
    expect(flDead.length).toBe(1)
    expect(flDead[0]).toBe(
      'σ_S/2^ℓ = 0.142 < 0.25：GMAC 雜訊遠小於右移後的 1 個 LSB，取整後的 G 幾乎都是同一個值——平衡點附近的回復斜率只剩 χ ≈ 0.011（1 = 沒有取整），迴路實際上停在 dead zone 裡，偏差預測（F-04.11）不再適用。請保留更多小數位元 F_G',
    )
    // ── μ·G → W 的取整：μσ_G/Δ_W = 0.284（Δ_W = 0.625 fs）──
    const wBase: FixedLoopParams = { ...BASE_LOOP, rounding: 'half_even', numBlocks: 40, wLsb: 0.625 }
    const wtz = runFixedGmacLoop({ ...wBase, wRounding: 'toward_zero' })
    expect(wtz.analytic.ditherRatioW).toBeCloseTo(0.284, 3)
    const wtzMsg = wtz.warnings.filter((w) => /dead zone/.test(w))
    expect(wtzMsg.length).toBe(1)
    expect(wtzMsg[0]).toContain('μσ_G/Δ_W = 0.284 < 0.5（toward-zero 的下限是 floor 的兩倍）')
    expect(wtzMsg[0]).toContain('回復斜率只剩 χ ≈ 0.0057')
    expect(wtzMsg[0]).toContain('偏差預測（F-04.18）不再適用')
    for (const wRounding of ['floor', 'half_up', 'half_even'] as const) expect(dz({ ...wBase, wRounding }), wRounding).toEqual([])
    expect(dz({ ...wBase, wLsb: 0.3125, wRounding: 'toward_zero' })).toEqual([]) // 0.568 ≥ 0.5
    expect(dz({ ...wBase, wLsb: 1.25, wRounding: 'floor' })[0]).toContain('μσ_G/Δ_W = 0.142 < 0.25：每個 block 的更新量雜訊遠小於一個 W-LSB')
    // 預測值本身不因為警告改變（只改文字）：toward-zero 的 ÷N 預測仍是 0
    expect(tz.analytic.biasPred).toBe(0)
    expect(wtz.analytic.biasPred).toBe(0)
  }, 60000)
})

describe('0/1 編碼反面教材（blockLms 實際模擬）', () => {
  it('T04: 反面測試：忘了映射時固定點偏到 ≈ 63.2 fs（mean-field），q = 2b − 1 與 ±1 逐 block 相同，增益減半', () => {
    const r = compareEncodings({ N: 256, numBlocks: 1500, mu: 10, sigmaV: 100, aTrue: 3, w0: 0, codeMean: 0.5, codeSigma: 1, seed: 20261010 })
    const [good, mapped, bug] = r.runs
    expect(Array.from(mapped.w)).toEqual(Array.from(good.w))
    expect(Math.abs(good.meanW - 3)).toBeLessThan(1)
    // Python mean-field：E_x[x·Φ((a − w)x/σ_v)] = 0，x ~ N(0.5, 1) ⇒ w* = 63.2341
    expect(Math.abs(bug.meanW - 63.234073849554626)).toBeLessThan(1.5)
    expect(bug.K / good.K).toBeCloseTo(0.5, 12)
    expect(r.bugLinearPred).toBeCloseTo(3 + 0.5 / ((Math.sqrt(2 / Math.PI) / 100) * 1.25), 10)
    expect(r.bugExactPred).toBeCloseTo(63.234073849554626, 8)
    const se = ar1MeanSe(bug.w.subarray(750), bug.meanW)
    expect(Math.abs(bug.meanW - r.bugExactPred)).toBeLessThan(4 * se)
  }, 30000)
})

describe('忘了映射＋Gaussian code：F-04.16 封閉式', () => {
  it('T04: 反面測試：h(t) = E[x·Φ(tx)] 的封閉式與數值積分一致；固定點 = Python mean-field 63.2341 fs', () => {
    // 數值積分（梯形法，x ∈ m ± 12s）
    for (const [m, sd] of [
      [0.5, 1],
      [-0.3, 0.7],
      [1.2, 2],
    ] as const) {
      for (const t of [-3, -0.6, -0.1, 0, 0.4, 2]) {
        let acc = 0
        const n = 24000
        const lo = m - 12 * sd
        const hstep = (24 * sd) / n
        for (let i = 0; i <= n; i++) {
          const x = lo + i * hstep
          const pdf = Math.exp(-((x - m) ** 2) / (2 * sd * sd)) / (Math.sqrt(2 * Math.PI) * sd)
          acc += (i === 0 || i === n ? 0.5 : 1) * x * normCdf(t * x) * pdf
        }
        expect(bugMeanGmac(t, m, sd)).toBeCloseTo(acc * hstep, 8)
      }
    }
    const r = bugFixedPointGaussian({ codeMean: 0.5, codeSigma: 1, sigmaV: 100, aTrue: 3 })
    expect(r.wStar).toBeCloseTo(63.234073849554626, 8) // blockLms.test.ts 的 Python mean-field 值
    expect(Math.abs(bugMeanGmac(r.xi, 0.5, 1))).toBeLessThan(1e-12)
    expect(r.wStarLinear).toBeCloseTo(3 + 0.5 / ((Math.sqrt(2 / Math.PI) / 100) * 1.25), 10)
  })

  it('T04: Monte Carlo（多 seed）：忘了映射的平均 w 與 F-04.16 封閉式一致（4 SE 內）', () => {
    const r = compareEncodings({ N: 256, numBlocks: 1500, mu: 10, sigmaV: 100, aTrue: 3, w0: 0, codeMean: 0.5, codeSigma: 1, seed: 20261010, mcRuns: 6 })
    expect(r.bugMc).not.toBeNull()
    const mc = r.bugMc!
    expect(mc.seeds).toHaveLength(6)
    expect(new Set(mc.seeds).size).toBe(6)
    expect(Math.abs(mc.mean - r.bugExactPred)).toBeLessThan(4 * mc.se + 0.01 * r.bugExactPred)
    expect(compareEncodings({ N: 16, numBlocks: 20, mu: 10, sigmaV: 100, aTrue: 3, w0: 0, codeMean: 0.5, codeSigma: 1, seed: 1 }).bugMc).toBeNull()
  }, 60000)

  it('偏差與 σ_v 精確成正比；零均值 code 時固定點就是 a；m 變號時偏差反號', () => {
    const base = { codeMean: 0.5, codeSigma: 1, aTrue: 3 }
    const r100 = bugFixedPointGaussian({ ...base, sigmaV: 100 })
    for (const sv of [1, 10, 37, 300]) {
      const r = bugFixedPointGaussian({ ...base, sigmaV: sv })
      expect((r.wStar - 3) / sv).toBeCloseTo((r100.wStar - 3) / 100, 10)
    }
    expect(bugFixedPointGaussian({ ...base, codeMean: 0, sigmaV: 100 }).wStar).toBe(3)
    expect(bugFixedPointGaussian({ ...base, codeMean: -0.5, sigmaV: 100 }).wStar - 3).toBeCloseTo(-(r100.wStar - 3), 9)
  })
})

describe('程式碼 region（頁面顯示的就是執行的程式碼）', () => {
  it('頁面引用的 core regions 都存在，且差異標記在 sum/average 與取負版本上', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'simulation', 'models', 'gmac.ts'), 'utf8')
    const regions = listRegions(src)
    for (const r of [
      'comparatorBit',
      'bitToBipolar',
      'decodeComparator',
      'gmacAverage',
      'gmacSum',
      'blockUpdate',
      'gmacRunningSum',
      'wrapTwos',
      'saturateTwos',
      'negateExtended',
      'negateInplace',
      'xorCarryAccumulate',
      'accumulatorBits',
      'accumulatorBitsClosedForm',
      'biasFixedPoint',
      'bugMeanGmac',
      'shiftRound',
      'roundingMeanError',
      'fixedGmacBlock',
      'gainUpdate',
      'fixedLoopBlock',
      'quantizeIncrement',
    ]) {
      expect(regions).toContain(r)
    }
    expect(extractRegion(src, 'gmacAverage')).toMatch(/← 差異/)
    expect(extractRegion(src, 'gmacSum')).toMatch(/← 差異/)
    expect(extractRegion(src, 'negateInplace')).toMatch(/← 差異/)
    expect(extractRegion(src, 'wrapTwos')).toMatch(/← 差異/)
    expect(extractRegion(src, 'saturateTwos')).toMatch(/← 差異/)
    expect(extractRegion(src, 'quantizeIncrement')).toMatch(/← 差異/)
  })
})
