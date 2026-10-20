import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import katex from 'katex'
import type { PresetEntry } from '@/data/types'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { fixedXPole, runScalarLms } from '@/simulation/models/lms'
import {
  analyticTrajectory,
  fourthPowerFactor,
  hillEstimator,
  kestenTailExponent,
  naiveCiCoverage,
  runStabilityMc,
  stabilityBounds,
  stabilityFactors,
  xMoments,
  type XDist,
} from '@/simulation/models/scalarStability'
import { FORMULAS } from './formulas'
import { erratumRoute } from '@/components/links/ErratumLink'
import { mergeParams, num, pyDef, texText, tnum, tx } from './common'
import { DEFAULT_DIST_FIELDS, parseList, toXDist } from './experiments/DistControls'
import { computeFixedXCase, DEFAULT_FIXED_X, FIXED_X_EXPERIMENT, stepsToReach } from './experiments/FixedXExplorer'
import { DEFAULT_LAB, LAB_EXPERIMENT } from './experiments/StabilityLab'
import { DEFAULT_HEAVY_TAIL, HEAVY_TAIL_EXPERIMENT } from './experiments/HeavyTailDemo'

const root = process.cwd()
const errata = JSON.parse(readFileSync(resolve(root, 'src/data/errata.json'), 'utf8')) as { errata: { eid: string }[] }
const presetDir = resolve(root, 'src/data/presets')
const presets: PresetEntry[] = readdirSync(presetDir)
  .filter((f) => f.startsWith('stability') && f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(presetDir, f), 'utf8')) as PresetEntry)

describe('ch03 公式登錄', () => {
  it('ID 唯一、格式 F-03.n、TeX 可由 KaTeX 嚴格解析、勘誤 ID 存在', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    const known = new Set(errata.errata.map((e) => e.eid))
    for (const f of FORMULAS) {
      expect(f.id).toMatch(/^F-03\.\d+$/)
      expect(f.page).toBe('/ch/03')
      expect(() => katex.renderToString(f.tex, { throwOnError: true, strict: 'ignore' })).not.toThrow()
      if (f.erratumId) expect(known.has(f.erratumId)).toBe(true)
    }
    // 本章負責的勘誤都有對應公式
    for (const e of ['E14', 'E38', 'E39', 'E42']) expect(FORMULAS.some((f) => f.erratumId === e)).toBe(true)
  })
})

describe('ch03 presets', () => {
  const allowed: Record<string, object> = {
    [LAB_EXPERIMENT]: DEFAULT_LAB,
    [FIXED_X_EXPERIMENT]: DEFAULT_FIXED_X,
    [HEAVY_TAIL_EXPERIMENT]: DEFAULT_HEAVY_TAIL,
  }

  it('每個 stability*.json 欄位完整、實驗 ID 正確、參數鍵與型別相容', () => {
    expect(presets.length).toBeGreaterThanOrEqual(15)
    for (const p of presets) {
      expect(p.page).toBe('/ch/03')
      expect(Object.keys(allowed)).toContain(p.experiment)
      expect(p.title.length).toBeGreaterThan(0)
      expect(p.expected.length).toBeGreaterThan(0)
      expect(p.source).toBe('illustrative')
      const base = allowed[p.experiment] as Record<string, unknown>
      for (const [k, v] of Object.entries(p.params)) {
        expect(Object.keys(base), `${p.id}.${k}`).toContain(k)
        expect(typeof v).toBe(typeof base[k])
      }
      const merged = mergeParams(base, p.params) as Record<string, unknown>
      if (p.experiment !== FIXED_X_EXPERIMENT) expect(toXDist(merged as unknown as typeof DEFAULT_LAB).error).toBeNull()
    }
  })

  it('preset 說明中的結論與模型一致（三種判據的收斂 / 發散）', () => {
    // [preset id, mean 收斂?, MS 收斂?, a.s. 收斂?]
    const table: [string, boolean, boolean, boolean][] = [
      ['stability-fixed-x2-mu01', true, true, true],
      ['stability-fixed-x2-mu06', false, false, false],
      ['stability-gauss-mu05', true, true, true],
      ['stability-gauss-mu08', true, false, true],
      ['stability-gauss-mu15', true, false, true],
      ['stability-gauss-mu23', false, false, true],
      ['stability-gauss-mu26', false, false, false],
      ['stability-bpsk-mu15', true, true, true],
      ['stability-uniform-mu1', true, true, true],
      ['stability-sparse-mu05', true, false, false],
      ['stability-gauss-noise-mu03', true, true, true],
      ['stability-gauss-noise-mu08', true, false, true],
    ]
    for (const [id, meanOk, msOk, asOk] of table) {
      const p = presets.find((x) => x.id === id)
      expect(p, id).toBeDefined()
      const params = mergeParams(DEFAULT_LAB, p!.params)
      const { dist } = toXDist(params)
      const f = stabilityFactors(params.mu, dist!)
      expect(Math.abs(f.meanPole) < 1, `${id} mean`).toBe(meanOk)
      expect(f.g < 1, `${id} MS`).toBe(msOk)
      expect(f.lambda < 0, `${id} a.s.`).toBe(asOk)
    }
    // 說明文字中的關鍵數字
    const g08 = stabilityFactors(0.8, { kind: 'gaussian', sigma: 1 })
    expect(presets.find((x) => x.id === 'stability-gauss-mu08')!.expected).toContain(num(g08.g, 3))
    const ub = stabilityBounds({ kind: 'uniform', halfWidth: Math.sqrt(3) })
    expect(presets.find((x) => x.id === 'stability-uniform-mu1')!.expected).toContain(num(ub.asMax, 5))
  })

  it('T02: Fixed-x preset（手算例子）與 Explorer 的遞迴 / 封閉式一致', () => {
    const p = presets.find((x) => x.id === 'stability-fx-t01')!
    const r = computeFixedXCase(mergeParams(DEFAULT_FIXED_X, p.params))
    expect(r.w[1]).toBeCloseTo(1.8, 14)
    expect(r.w[2]).toBeCloseTo(2.28, 14)
    expect(r.delta.slice(0, 3).map((d) => Number(d.toFixed(12)))).toEqual([2, 1.2, 0.72]) // δ = a − w（勘誤 E39）
    expect(r.p).toBeCloseTo(0.6, 14)
    expect(r.maxRelDev).toBeLessThan(1e-12)
    const neg = computeFixedXCase(mergeParams(DEFAULT_FIXED_X, presets.find((x) => x.id === 'stability-fx-negative')!.params))
    expect(neg.p).toBeCloseTo(1.04, 14)
    expect(neg.delta[100]).toBeCloseTo(2 * 1.04 ** 100, 8)
    const dead = computeFixedXCase({ ...DEFAULT_FIXED_X, mu: 0.25 })
    expect(dead.delta[1]).toBe(0)
  })
})

describe('ch03 helpers', () => {
  it('清單解析與分布轉換（含錯誤訊息）', () => {
    expect(parseList('0, 0 ,3').values).toEqual([0, 0, 3])
    expect(parseList('1；−2、3').values).toEqual([1, -2, 3])
    expect(parseList('').error).toMatch(/至少/)
    expect(parseList('1, abc').error).toMatch(/abc/)
    expect(toXDist({ ...DEFAULT_DIST_FIELDS, dist: 'gaussian', sigma: -1 }).error).toMatch(/σ/)
    const d = toXDist({ ...DEFAULT_DIST_FIELDS, dist: 'list' }).dist!
    expect(xMoments(d).Px).toBeCloseTo(0.9, 14)
  })

  it('pyDef 擷取 golden Python 函式；數字格式化', () => {
    const src = readFileSync(resolve(root, 'golden/lms_pll_golden/lms.py'), 'utf8')
    const code = pyDef(src, 'mean_square_factor')
    expect(code.startsWith('def mean_square_factor(')).toBe(true)
    expect(code).toContain('return 1.0 - 2.0 * mu * ex2 + mu * mu * ex4')
    expect(code).not.toContain('def gaussian_moments')
    expect(pyDef(src, 'mc_mean_square_factor')).toContain('draw_regressor')
    expect(() => pyDef(src, 'no_such_function')).toThrow()
    expect(num(Infinity)).toBe('∞')
    expect(num(-0.5)).toBe('−0.5')
    expect(tnum(1.5e-7, 3)).toBe('1.5\\times10^{-7}')
    expect(tnum(-0.25)).toBe('-0.25')
  })
})

describe('ch03 preset 說明中的數字（解析值即時重算；MC 值以同一 seed 重跑）', () => {
  const G: XDist = { kind: 'gaussian', sigma: 1 }
  const exp = (id: string) => {
    const p = presets.find((x) => x.id === id)!
    return `${p.description}｜${p.expected}`
  }
  it('解析數字：λ、MSD∞、κ_t、h、真實 SE 與說明文字一致', () => {
    expect(exp('stability-gauss-mu05')).toContain(num(stabilityFactors(0.5, G).lambda, 4))
    expect(exp('stability-gauss-mu08')).toContain(num(stabilityFactors(0.8, G).lambda, 4))
    expect(exp('stability-gauss-mu15')).toContain(num(stabilityFactors(1.5, G).lambda, 4))
    expect(exp('stability-gauss-mu23')).toContain(num(stabilityFactors(2.3, G).lambda, 4))
    expect(exp('stability-gauss-mu26')).toContain(num(stabilityFactors(2.6, G).lambda, 4))
    expect(exp('stability-uniform-mu1')).toContain(num(stabilityFactors(1, { kind: 'uniform', halfWidth: Math.sqrt(3) }).lambda, 4))
    expect(exp('stability-sparse-mu05')).toContain(num(stabilityFactors(0.5, { kind: 'list', values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 3] }).lambda, 4))
    const tr = analyticTrajectory({ mu: 0.3, dist: G, delta0: 1, noiseSigma: 0.1 }, [0])
    expect(exp('stability-gauss-noise-mu03')).toContain(num(tr.msdInf, 4))
    expect(exp('stability-gauss-noise-mu03')).toContain(num(tr.mseInf, 4))
    expect(exp('stability-gauss-noise-mu03')).toContain(num(kestenTailExponent(0.3, G), 3))
    expect(exp('stability-gauss-noise-mu08')).toContain(num(kestenTailExponent(0.8, G), 4))
    expect(exp('stability-heavytail-mu03')).toContain(num(fourthPowerFactor(0.3, xMoments(G)), 4))
    const ht = naiveCiCoverage({ mu: 0.8, dist: G, delta0: 1, n: 5, pathsPerBatch: 4000, batches: 1, seed: 1 })
    expect(exp('stability-heavytail-mu08')).toContain(num(ht.trueSe, 3))
  })

  it('T03: MC 數字（seed 20261010，與實驗預設 seed 相同）：天真 CI 覆蓋率 36% / 93%、SE 比約 64、μ=2.3 收斂比例、Hill 估計', () => {
    const seed = 20261010
    const bad = naiveCiCoverage({ mu: 0.8, dist: G, delta0: 1, n: 5, pathsPerBatch: 4000, batches: 100, seed })
    expect(bad.coverage).toBeCloseTo(0.36, 10)
    expect(bad.medianSeRatio).toBeGreaterThan(55)
    expect(bad.medianSeRatio).toBeLessThan(75)
    const good = naiveCiCoverage({ mu: 0.3, dist: G, delta0: 1, n: 5, pathsPerBatch: 4000, batches: 100, seed })
    expect(good.coverage).toBeCloseTo(0.93, 10)
    const r200 = runStabilityMc({ mu: 2.3, dist: G, delta0: 1, steps: 200, paths: 2000, seed, noiseSigma: 0, oneStepSamples: 1000 })
    const r1000 = runStabilityMc({ mu: 2.3, dist: G, delta0: 1, steps: 1000, paths: 2000, seed, noiseSigma: 0, oneStepSamples: 1000 })
    expect(r200.fracConverged.at(-1)!).toBeGreaterThan(0.4)
    expect(r200.fracConverged.at(-1)!).toBeLessThan(0.6)
    expect(r1000.fracConverged.at(-1)!).toBeGreaterThan(0.65)
    expect(r1000.fracConverged.at(-1)!).toBeLessThan(0.85)
    const rn = runStabilityMc({ mu: 0.8, dist: G, delta0: 1, steps: 300, paths: 20000, seed, noiseSigma: 0.1, oneStepSamples: 1000 })
    const hill = hillEstimator(rn.finalLog10, 400)
    expect(hill).toBeGreaterThan(1.39)
    expect(hill).toBeLessThan(1.49) // 說明文字：約 1.44
  }, 30000)
})

describe('ch03 Fixed-x：收斂步數與勘誤連結', () => {
  it('T02: n_ε = ⌈ln ε / ln|p|⌉（F-03.4）：五個 μ 的收斂步數；邊界與發散回傳 NaN；模擬在第 n_ε 步確實降到 ε 以下', () => {
    expect(stepsToReach(0.6)).toBe(14)
    expect(stepsToReach(-0.6)).toBe(14) // 震盪收斂一樣快
    expect(stepsToReach(0)).toBe(1) // deadbeat
    expect(Number.isNaN(stepsToReach(-1))).toBe(true) // μ = 0.5：邊界，不收斂
    expect(Number.isNaN(stepsToReach(-1.4))).toBe(true) // μ = 0.6：發散
    expect(Number.isNaN(stepsToReach(1.04))).toBe(true) // μ < 0：極性反轉
    for (const mu of [0.1, 0.4, 0.05, 0.45]) {
      const r = computeFixedXCase({ ...DEFAULT_FIXED_X, mu, steps: 200 })
      const n = stepsToReach(r.p)
      expect(Math.abs(r.delta[n] / r.delta[0])).toBeLessThanOrEqual(1e-3)
      expect(Math.abs(r.delta[n - 1] / r.delta[0])).toBeGreaterThan(1e-3) // 少一步還不夠
      expect(r.e[0]).toBeCloseTo((DEFAULT_FIXED_X.a - DEFAULT_FIXED_X.w0) * DEFAULT_FIXED_X.x, 14) // e_0 = δ_0·x
    }
  })

  it('勘誤標記的連結是驗證頁的深連結 /verification?e=Exx，且 ID 都存在於 errata.json', () => {
    const known = new Set(errata.errata.map((e) => e.eid))
    for (const id of ['E14', 'E32', 'E38', 'E39', 'E42']) {
      expect(erratumRoute(id)).toBe(`/verification?e=${id}`)
      expect(known.has(id)).toBe(true)
    }
  })
})

describe('ch03 Research 註記：浮點下的 deadbeat', () => {
  it('μ=0.25、x=2 時 1−μx² 恰為 0；x=0.3、μ=1/x² 時只到捨入誤差等級（頁面文字依此即時計算）', () => {
    expect(fixedXPole(0.25, 2)).toBe(0)
    const p = fixedXPole(1 / 0.09, 0.3)
    expect(p).not.toBe(0)
    expect(Math.abs(p)).toBeLessThan(1e-15)
    const r = runScalarLms({ variant: 'conventional', a: 3, w0: 1, mu: 1 / 0.09, steps: 3, x: { kind: 'fixed', value: 0.3 } })
    expect(Math.abs(r.delta[1])).toBeLessThan(1e-14)
    expect(r.delta[1]).not.toBe(0)
  })
})

describe('ch03 tx（內文行內數學）', () => {
  const kids = (n: ReactNode) => (isValidElement(n) ? ((n as ReactElement<{ children: ReactNode[] }>).props.children as ReactNode[]) : [])
  it('$…$ 之間轉成 <Tex>，其餘保留文字；$ 不成對時丟出錯誤', () => {
    const c = kids(tx`把 $\delta_{n+1}$ 兩邊平方`)
    expect(c).toHaveLength(3)
    expect(c[0]).toBe('把 ')
    expect(isValidElement(c[1])).toBe(true)
    expect((c[1] as ReactElement<{ children: string }>).props.children).toBe('\\delta_{n+1}')
    expect(kids(texText(`μ = ${0.5}`))).toEqual(['μ = 0.5'])
    expect(() => texText('只有一個 $ 符號')).toThrow(/不成對/)
  })
})
