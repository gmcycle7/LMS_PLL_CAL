import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PresetEntry } from '@/data/types'
import { createRng, normCdf } from '@/simulation/core'
import { accumulatorBitsRequired } from '@/simulation/models/gmac'
import {
  accBitsExact,
  accBitsRule,
  meanGhat,
  meanGhatCurves,
  productExtremes,
  shiftQuantize,
  truncationDerived,
  truncationEquilibrium,
  worstCaseAccumulate,
  wrapTwos,
  type TruncationSetup,
} from './gmacMath'
import { DEFAULT_GMAC_PARAMS, gmacSizing, gmacWarnings, type GmacSizingParams } from './gmacSizing'

const NEG = JSON.parse(readFileSync(resolve(process.cwd(), 'golden/vectors/negative_tests.json'), 'utf8')) as {
  inputs: { N: number; gmac_input_bits: number }
  expected: { gmac_bits_required: number; gmac_17bit_wrapped_sum: number }
}

/** 暴力法：最小的 A 使正、負最壞情況逐筆累加都不 wrap */
function bruteBits(bx: number, N: number, range: 'full' | 'symmetric'): number {
  for (let A = 2; A < 64; A++) {
    if (worstCaseAccumulate(bx, N, range, A, 1).firstOverflow === null && worstCaseAccumulate(bx, N, range, A, -1).firstOverflow === null) return A
  }
  return NaN
}

describe('GMAC accumulator 位元數（§16.1 第 3 項）', () => {
  it('golden negative_tests：6-bit × 4096 需要 18 bits，17 bits 時 31×4096 wrap 成 −4096', () => {
    const { N, gmac_input_bits: bx } = NEG.inputs
    expect(accBitsExact(bx, N, 'symmetric')).toBe(NEG.expected.gmac_bits_required)
    expect(accBitsRule(bx, N)).toBe(NEG.expected.gmac_bits_required)
    const w = worstCaseAccumulate(bx, N, 'symmetric', NEG.expected.gmac_bits_required - 1, 1)
    expect(w.exact).toBe(31 * 4096)
    expect(w.wrapped).toBe(NEG.expected.gmac_17bit_wrapped_sum)
    expect(w.firstOverflow).toBe(2115) // 31·2114 = 65534 ≤ 65535 < 31·2115
  })

  it('反面測試：full-range code 條件取負到 +2^{B_x−1}，經驗法則少 1 bit（18 bits 時 +131072 wrap 成 −131072）', () => {
    expect(productExtremes(6, 'full')).toEqual({ maxPos: 32, maxNeg: 32 })
    expect(accBitsExact(6, 4096, 'full')).toBe(19)
    const w = worstCaseAccumulate(6, 4096, 'full', 18, 1)
    expect(w.exact).toBe(131072)
    expect(w.wrapped).toBe(-131072)
    expect(w.firstOverflow).toBe(4096)
    expect(worstCaseAccumulate(6, 4096, 'full', 18, -1).firstOverflow).toBeNull()
  })

  it('精確位元數 = 暴力 bit-true 最小值 = gmac.ts 的 accumulatorBitsRequired（B_x 2…10、N 1…1000 抽樣）', () => {
    const Ns = [1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 100, 255, 256, 257, 1000]
    for (let bx = 2; bx <= 10; bx++) {
      for (const N of Ns) {
        for (const range of ['full', 'symmetric'] as const) {
          const a = accBitsExact(bx, N, range)
          expect(a, `bx=${bx} N=${N} ${range}`).toBe(bruteBits(bx, N, range))
          expect(a).toBe(accumulatorBitsRequired(bx, N, range))
          if (range === 'symmetric') expect(a).toBeLessThanOrEqual(accBitsRule(bx, N))
        }
      }
    }
  })

  it('wrapTwos：與二補數定義一致（golden wrap_twos_complement 的公式）', () => {
    expect(wrapTwos(126976, 17)).toBe(-4096)
    expect(wrapTwos(65535, 17)).toBe(65535)
    expect(wrapTwos(65536, 17)).toBe(-65536)
    expect(wrapTwos(-65537, 17)).toBe(65535)
    for (let v = -300; v <= 300; v++) {
      const m = 256
      const r = ((v % m) + m) % m
      expect(wrapTwos(v, 8)).toBe(r >= 128 ? r - m : r)
    }
  })

  it('shiftQuantize：floor 朝 −∞、half up 進位；ℓ ≤ 0 不取整', () => {
    expect(shiftQuantize(-1, 2, 'floor')).toBe(-1)
    expect(shiftQuantize(-2, 2, 'half_up')).toBe(0)
    expect(shiftQuantize(2, 2, 'half_up')).toBe(1)
    expect(shiftQuantize(5, 0, 'floor')).toBe(5)
    expect(shiftQuantize(5, -1, 'floor')).toBe(10)
  })
})

describe('右移截斷的平衡點（§16.1 第 5 項，F-16.3）', () => {
  const base: TruncationSetup = { bx: 6, log2N: 12, gFracBits: 0, rounding: 'floor', sigmaV: 100 }

  it('無截斷（F_G ≥ log₂N）時 E[Ĝ] 精確等於 x_n(2Φ − 1)，平衡點為 0', () => {
    const s: TruncationSetup = { ...base, gFracBits: 12 }
    const d = truncationDerived(s)
    for (const delta of [-30, -3, 0, 1.5, 20]) {
      expect(meanGhat(s, delta)).toBeCloseTo(d.xNorm * (2 * normCdf((delta * d.xNorm) / s.sigmaV) - 1), 12)
    }
    expect(Math.abs(truncationEquilibrium(s).deltaStar)).toBeLessThan(1e-9)
  })

  it('floor、F_G = 0：精確 mean-field δ* 與近似 Δ_G/(2K) 相差 < 1%；half up 幾乎為 0；與 σ_v 成正比', () => {
    const e = truncationEquilibrium(base)
    expect(e.hasEquilibrium).toBe(true)
    expect(Math.abs(e.deltaStar / e.approxDeltaStar - 1)).toBeLessThan(0.01)
    expect(e.deltaStar).toBeGreaterThan(2)
    expect(e.deltaStar).toBeLessThan(2.2)
    const h = truncationEquilibrium({ ...base, rounding: 'half_up' })
    expect(Math.abs(h.deltaStar)).toBeLessThan(1e-3)
    const e10 = truncationEquilibrium({ ...base, sigmaV: 10 })
    expect(e10.deltaStar / e.deltaStar).toBeCloseTo(0.1, 6)
    const e4 = truncationEquilibrium({ ...base, gFracBits: 4 })
    expect(Math.abs(e4.deltaStar / e4.approxDeltaStar - 1)).toBeLessThan(0.02)
  })

  it('E[Ĝ](δ) 對 δ 單調不減（floor 與 half up）', () => {
    const deltas = Array.from({ length: 81 }, (_, i) => -20 + i * 0.5)
    const c = meanGhatCurves({ bx: 6, log2N: 12, gFracBits: 0, sigmaV: 100 }, deltas)
    for (let i = 1; i < deltas.length; i++) {
      expect(c.floor[i]).toBeGreaterThanOrEqual(c.floor[i - 1] - 1e-15)
      expect(c.halfUp[i]).toBeGreaterThanOrEqual(c.halfUp[i - 1] - 1e-15)
    }
  })

  it('Monte Carlo：逐 block 模擬 floor 右移的 Sign-LMS，平均 δ 落在精確 δ* 的 4×SE 內（N = 256）', () => {
    const s: TruncationSetup = { bx: 6, log2N: 8, gFracBits: 0, rounding: 'floor', sigmaV: 100 }
    const eq = truncationEquilibrium(s)
    const d = eq.derived
    const mu = 0.05 / d.K // g = 0.05
    const rng = createRng(20261010).fork('gmac-truncation-mc')
    const blocks = 30000
    const burn = 2000
    let delta = 0
    let sum = 0
    let sum2 = 0
    let lag = 0
    let prev = NaN
    for (let k = 0; k < blocks; k++) {
      const p = normCdf((delta * d.xNorm) / s.sigmaV)
      let kk = 0
      for (let n = 0; n < d.N; n++) if (rng.uniform() < p) kk++
      const S = d.A * (2 * kk - d.N)
      const Ghat = shiftQuantize(S, d.ell, 'floor') * d.deltaG
      delta -= mu * Ghat
      if (k >= burn) {
        sum += delta
        sum2 += delta * delta
        if (Number.isFinite(prev)) lag += delta * prev
        prev = delta
      }
    }
    const m = blocks - burn
    const mean = sum / m
    const v = sum2 / m - mean * mean
    const rho = (lag / (m - 1) - mean * mean) / v
    const se = Math.sqrt((v / m) * ((1 + rho) / (1 - rho)))
    expect(Math.abs(mean - eq.deltaStar)).toBeLessThan(4 * se)
    expect(eq.deltaStar).toBeGreaterThan(8 * se) // 偏差遠大於統計誤差：截斷 bias 是真的
  }, 30000)

  it('計算器 gmacSizing：預設值的位元數、bit-true 驗證與警告', () => {
    const o = gmacSizing(DEFAULT_GMAC_PARAMS)
    expect(o.bitsSel).toBe(18)
    expect(o.okPos.firstOverflow).toBeNull()
    expect(o.okNeg.firstOverflow).toBeNull()
    expect(o.shortPos.wrapped).toBe(-4096)
    const w = gmacWarnings(o, DEFAULT_GMAC_PARAMS)
    expect(w.some((x) => x.includes('截斷偏差'))).toBe(true)
    const full = gmacSizing({ ...DEFAULT_GMAC_PARAMS, range: 'full' })
    expect(gmacWarnings(full, { ...DEFAULT_GMAC_PARAMS, range: 'full' }).some((x) => x.includes('經驗法則'))).toBe(true)
    const big = { ...DEFAULT_GMAC_PARAMS, log2N: 20, rounding: 'half_up' as const }
    const ob = gmacSizing(big)
    expect(ob.eq.derived.ditherLsb).toBeLessThan(0.4)
    expect(gmacWarnings(ob, big).some((x) => x.includes('自然 dither 不足'))).toBe(true)
  })

  it('參數檢查：B_x、N、σ_v 不合法時丟出中文錯誤', () => {
    expect(() => accBitsExact(1, 10, 'full')).toThrow(/B_x/)
    expect(() => accBitsExact(6, 0, 'full')).toThrow(/N/)
    expect(() => truncationDerived({ ...base, sigmaV: 0 })).toThrow(/sigma_v/)
  })
})

describe('gmac-datapath-sizing presets', () => {
  const dir = resolve(process.cwd(), 'src/data/presets')
  const PRESETS: PresetEntry[] = readdirSync(dir)
    .filter((f) => f.startsWith('gmac-datapath-sizing') && f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as PresetEntry)
  const get = (id: string) => {
    const p = { ...DEFAULT_GMAC_PARAMS, ...(PRESETS.find((x) => x.id === id)!.params as Partial<GmacSizingParams>) }
    const o = gmacSizing(p)
    return { p, o, w: gmacWarnings(o, p) }
  }
  it('preset 檔的預期敘述與計算結果一致', () => {
    expect(PRESETS.length).toBe(5)
    for (const pr of PRESETS) expect(pr.experiment).toBe('gmac-datapath-sizing')
    const g = get('gmac-datapath-sizing-golden')
    expect(g.o.bitsSel).toBe(18)
    expect(g.o.shortPos.wrapped).toBe(-4096)
    expect(g.o.eq.deltaStar).toBeCloseTo(2.08, 1)
    expect(g.w.some((x) => x.startsWith('截斷偏差'))).toBe(true)
    const f = get('gmac-datapath-sizing-full-range')
    expect(f.o.bitsSel).toBe(19)
    expect(f.o.shortPos.wrapped).toBe(-131072)
    expect(f.w.some((x) => x.startsWith('經驗法則'))).toBe(true)
    const gb = get('gmac-datapath-sizing-guard-bits')
    expect(gb.o.eq.deltaStar).toBeCloseTo(0.129, 3)
    expect(gb.w).toEqual([])
    const h = get('gmac-datapath-sizing-half-up')
    expect(Math.abs(h.o.eq.deltaStar)).toBeLessThan(1e-3)
    expect(h.w).toEqual([])
    const dz = get('gmac-datapath-sizing-dead-zone')
    expect(dz.o.bitsSel).toBe(26)
    expect(dz.o.eq.deadZone).toBeGreaterThan(2.3)
    expect(dz.o.eq.deadZone).toBeLessThan(2.5)
    expect(dz.w.some((x) => x.startsWith('自然 dither 不足'))).toBe(true)
    expect(dz.w.some((x) => x.startsWith('死區寬'))).toBe(true)
  })
})
