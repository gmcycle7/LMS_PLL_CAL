import { ALL_PRESETS } from '@/app/presets'
import { pageOfPath } from './registry'
import {
  DEFAULT_CASE,
  DEFAULT_SHARED,
  LIMITS,
  parsePresetParams,
  sanitizeCase,
  sanitizeShared,
  UNITS_EXPERIMENT_ID,
  UNITS_PRESETS,
  unitsPresetById,
  type UnitsCase,
} from './presets'
import { runUnitsMc, unitsCalc } from './unitsModel'
import { richProblems } from './testUtils'

function calc(shared: ReturnType<typeof parsePresetParams>['shared'], c: UnitsCase) {
  return unitsCalc({ fs: shared.fs, N: c.N, mu: c.mu, sigmaV: shared.sigmaV, C: shared.C, gmMode: c.gmMode, fOut: shared.fOut, At: shared.At })
}

describe('換算器 presets（本頁自帶；格式同 PresetEntry）', () => {
  it('id 唯一、指向本頁與本實驗、不與 src/data/presets 的 id 衝突', () => {
    const ids = UNITS_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of UNITS_PRESETS) {
      expect(p.page).toBe('/formulas')
      expect(pageOfPath(p.page)?.id).toBe('formulas')
      expect(p.experiment).toBe(UNITS_EXPERIMENT_ID)
      expect(p.source).toBe('simulation')
      expect(p.galleryIndex).toBeUndefined() // 規格 §19.2 的 12 個 Gallery preset 不含本頁
      expect(p.title.length).toBeGreaterThan(6)
      expect(p.expected.length).toBeGreaterThan(20)
      expect(ALL_PRESETS.some((q) => q.id === p.id), `${p.id} 與 JSON preset 重複`).toBe(false)
      // 說明文字不含未成對的 $（下拉選單不渲染 KaTeX，所以這裡用純文字／Unicode）
      expect(richProblems(p.description)).toEqual([])
    }
    expect(unitsPresetById('units-t13-reference')?.title).toMatch(/T13/)
    expect(unitsPresetById('nope')).toBeUndefined()
    expect(unitsPresetById(null)).toBeUndefined()
  })

  it('T13: 每個 preset 的 check（機器可讀的期望值）都與核心重算的結果一致', () => {
    const problems: string[] = []
    for (const p of UNITS_PRESETS) {
      const parsed = parsePresetParams(p.params)
      expect(p.check.length, p.id).toBeGreaterThan(2)
      for (const ck of p.check) {
        const c = parsed.cases[ck.caseIndex]
        if (!c) {
          problems.push(`${p.id}: 沒有 case ${ck.caseIndex}`)
          continue
        }
        const u = calc(parsed.shared, c)
        const actual = u.loop[ck.quantity]
        if (ck.value === 'nan') {
          if (!Number.isNaN(actual)) problems.push(`${p.id}[${ck.caseIndex}].${ck.quantity}: 應為 NaN，得到 ${actual}`)
        } else {
          const rel = Math.abs(actual - ck.value) / Math.abs(ck.value)
          if (!(rel <= (ck.rel ?? 1e-9))) problems.push(`${p.id}[${ck.caseIndex}].${ck.quantity}: ${actual} vs ${ck.value}（rel ${rel}）`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('T14: expected 文字裡的關鍵數字就是算出來的數字（不是手寫的）', () => {
    const fmt = (x: number, d: number) => Number(x.toPrecision(d)).toString()
    // units-t13-reference
    {
      const p = unitsPresetById('units-t13-reference')!
      const { shared, cases } = parsePresetParams(p.params)
      const l = calc(shared, cases[0]).loop
      for (const s of [fmt(l.g, 4), fmt(l.p, 4), fmt(l.tauBlocks, 4), fmt(l.sigmaW, 4), fmt(l.f3dbExact / 1e3, 4), fmt(l.enbw / 1e3, 4)]) expect(p.expected, s).toContain(s)
      expect(p.expected).toContain('12.40') // (1−p) 近似
      expect(l.f3dbOneMinusP / 1e3).toBeCloseTo(12.4, 2)
    }
    // units-sum-vs-average
    {
      const p = unitsPresetById('units-sum-vs-average')!
      const { shared, cases } = parsePresetParams(p.params)
      expect(cases.length).toBe(3)
      const b = calc(shared, cases[1]).loop
      expect(p.expected).toContain(fmt(b.g, 4))
      expect(p.expected).toContain(fmt(b.p, 4).replace('-', '−'))
      const a = calc(shared, cases[0]).loop
      const c = calc(shared, cases[2]).loop
      expect(c.g).toBeCloseTo(a.g, 14)
      expect(c.sigmaW).toBeCloseTo(a.sigmaW, 12)
    }
    // units-bandwidth-regimes
    {
      const p = unitsPresetById('units-bandwidth-regimes')!
      const { shared, cases } = parsePresetParams(p.params)
      const ls = cases.map((c) => calc(shared, c).loop)
      expect(ls.map((l) => l.regime)).toEqual(['lowpass', 'no3db', 'highpass'])
      expect(p.expected).toContain(fmt(ls[1].enbw / 1e3, 4)) // 399.5 kHz
      expect(p.expected).toContain(fmt(ls[2].enbw / 1e6, 4)) // 1.465 MHz
      expect(p.expected).toContain(fmt(ls[2].fu / 2e3, 4)) // f_u/2 = 488.3 kHz
      expect(ls[2].enbw).toBeGreaterThan(ls[2].fu / 2)
    }
    // units-same-p-different-hz
    {
      const p = unitsPresetById('units-same-p-different-hz')!
      const { shared, cases } = parsePresetParams(p.params)
      const us = cases.map((c) => calc(shared, c))
      for (const u of us) {
        expect(u.loop.p).toBeCloseTo(us[0].loop.p, 14)
        expect(u.omega3dbBlock).toBeCloseTo(us[0].omega3dbBlock, 12) // rad/block 相同
      }
      for (const [i, d] of [
        [0, 4],
        [1, 4],
        [2, 4],
      ] as const)
        expect(p.expected).toContain(fmt(us[i].loop.f3dbExact / 1e3, d))
      for (const u of us) expect(p.expected).toContain(fmt(u.loop.sigmaW, 4))
    }
    // units-polarity-negative-c
    {
      const p = unitsPresetById('units-polarity-negative-c')!
      const { shared, cases } = parsePresetParams(p.params)
      const u = calc(shared, cases[0])
      expect(u.loop.regime).toBe('polarity')
      expect(u.loop.warnings.join('\n')).toMatch(/C ≤ 0：更新極性錯誤/)
      expect(p.expected).toContain(fmt(u.loop.p, 5))
      expect(p.expected).toContain(fmt(u.loop.K, 4).replace('-', '−'))
      const mc = runUnitsMc({ mu: cases[0].mu, sigmaV: shared.sigmaV, C: shared.C, N: cases[0].N, gmMode: 'average', engine: 'linear', chains: 4, blocks: 4000, seed: 1 })
      expect(mc.valid).toBe(false)
      expect(mc.diverged).toBe(true)
    }
  })

  it('T13: units-t13-reference 的 1-bit Monte Carlo 以 preset 的 seed 重現 σ_w（|z| ≤ 4）；sum mode 的 case 標為不判定', () => {
    const ref = parsePresetParams(unitsPresetById('units-t13-reference')!.params)
    expect(ref.seed).toBe(20261010)
    const c = ref.cases[0]
    const mc = runUnitsMc({ mu: c.mu, sigmaV: ref.shared.sigmaV, C: ref.shared.C, N: c.N, gmMode: c.gmMode, engine: ref.shared.engine, chains: ref.shared.chains, blocks: ref.shared.blocks, seed: ref.seed! })
    expect(ref.shared.engine).toBe('sign')
    expect(mc.valid).toBe(true)
    expect(Math.abs(mc.z)).toBeLessThanOrEqual(4)
    const sv = parsePresetParams(unitsPresetById('units-sum-vs-average')!.params)
    const b = sv.cases[1]
    const mcB = runUnitsMc({ mu: b.mu, sigmaV: sv.shared.sigmaV, C: sv.shared.C, N: b.N, gmMode: b.gmMode, engine: 'sign', chains: 4, blocks: 1000, seed: sv.seed! })
    expect(mcB.valid).toBe(false)
    expect(mcB.sigmaHat).toBeGreaterThan(1000)
  })
})

describe('preset 參數清理（來自 URL 或舊版資料時不可讓控制項拿到非法值）', () => {
  it('缺欄位用預設值；超出範圍夾到合法範圍；整數欄位取整；非數字退回預設', () => {
    expect(sanitizeShared(undefined)).toEqual(DEFAULT_SHARED)
    expect(sanitizeShared({})).toEqual(DEFAULT_SHARED)
    const s = sanitizeShared({ fs: 1e20, sigmaV: -5, C: 'x', fOut: NaN, At: 0, lsbFs: null, engine: 'weird', chains: 3.7, blocks: 1e9 })
    expect(s.fs).toBe(LIMITS.fs[1])
    expect(s.sigmaV).toBe(LIMITS.sigmaV[0])
    expect(s.C).toBe(DEFAULT_SHARED.C)
    expect(s.fOut).toBe(DEFAULT_SHARED.fOut)
    expect(s.At).toBe(LIMITS.At[0])
    expect(s.lsbFs).toBe(DEFAULT_SHARED.lsbFs)
    expect(s.engine).toBe(DEFAULT_SHARED.engine)
    expect(s.chains).toBe(4)
    expect(s.blocks).toBe(LIMITS.blocks[1])
    expect(sanitizeShared({ engine: 'linear' }).engine).toBe('linear')
  })

  it('case：N 取整並限制在 [1, 2²⁰]；μ 限制在合法範圍；gmMode 只接受 average / sum', () => {
    expect(sanitizeCase(undefined)).toEqual(DEFAULT_CASE)
    expect(sanitizeCase({ N: 0, mu: -1, gmMode: 'both' })).toEqual({ N: 1, mu: LIMITS.mu[0], gmMode: 'average' })
    expect(sanitizeCase({ N: 1023.6, mu: 5, gmMode: 'sum' })).toEqual({ N: 1024, mu: 5, gmMode: 'sum' })
    expect(sanitizeCase({ N: 1e12 }).N).toBe(LIMITS.N[1])
    // base：只改一個欄位時其餘沿用
    expect(sanitizeCase({ mu: 2 }, { N: 64, mu: 1, gmMode: 'sum' })).toEqual({ N: 64, mu: 2, gmMode: 'sum' })
  })

  it('parsePresetParams：最多 3 個 case；沒有 cases 時給一個預設 case；seed 轉成 uint32 或 null', () => {
    const p = parsePresetParams({ sigmaV: 50, seed: 42.9, cases: [{ N: 8 }, { N: 16 }, { N: 32 }, { N: 64 }] })
    expect(p.shared.sigmaV).toBe(50)
    expect(p.seed).toBe(42)
    expect(p.cases.map((c) => c.N)).toEqual([8, 16, 32])
    expect(parsePresetParams({}).cases).toEqual([DEFAULT_CASE])
    expect(parsePresetParams({ cases: 'oops' }).cases).toEqual([DEFAULT_CASE])
    expect(parsePresetParams({ seed: -1 }).seed).toBeNull()
    expect(parsePresetParams({ seed: 'x' }).seed).toBeNull()
  })
})
