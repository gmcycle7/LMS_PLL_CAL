import { readFileSync } from 'node:fs'
import ditherNumbers from './ditherNumbers.json'
import { validateValue } from '@/data/validate'
import { webSchema } from '@/data/golden/schemas'
import { DITHER_NUM, SIM_CFG } from './data'
import { FORMULAS } from './formulas'

/**
 * ditherNumbers.json 是 analysis/sspll/golden/results/dither_interaction.json（tools/dither_sweep.py）裡頁面用到的子集（§10b、實驗 D）：
 * closed form、頻譜因子（factors）、大訊號斜率（large_signal）不收（TS port 即時算）；numeric 只去掉逐模態的 kappa_m，mc 只去掉 seeds／diverged／converged 三個陣列
 * 與逐列的候選判準 candidates（總計分留在 mc._summary.candidates），其餘逐位相同。
 */
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const FULL: Json = JSON.parse(readFileSync(new URL('../../../analysis/sspll/golden/results/dither_interaction.json', import.meta.url), 'utf8'))
const SUB = ditherNumbers as Json
const SCHEMA = webSchema('sspll/dither_numbers')

describe('案例頁 ditherNumbers.json（§10b 的子集）與 golden 的 dither_interaction.json 一致', () => {
  it('SSPLL: _meta 指向來源，keys 是四段；tau_dead、sources、selected_alphas、迴路參數相同', () => {
    expect(SUB._meta.source).toBe('analysis/sspll/golden/results/dither_interaction.json')
    expect(SUB._meta.keys).toEqual(['numeric', 'sim_compare', 'mc', 'headline'])
    expect(SUB._meta.tau_dead).toBe(FULL._meta.tau_dead)
    expect(SUB._meta.sources).toEqual(FULL._meta.sources)
    expect(SUB._meta.selected_alphas).toEqual(FULL._meta.selected_alphas)
    expect(SUB._meta.loops).toEqual(FULL._meta.loops)
    expect(SUB._meta.code_range_delta).toEqual(FULL._meta.code_range_delta)
    expect(SUB.closed).toBeUndefined()
    expect(SUB.factors).toBeUndefined()
    expect(SUB.large_signal).toBeUndefined()
  })

  it('SSPLL: sim_compare、headline 逐位相同；numeric 除了 kappa_m 以外相同；mc 除了三個 seeds 陣列以外相同', () => {
    expect(SUB.sim_compare).toEqual(FULL.sim_compare)
    expect(SUB.headline).toEqual(FULL.headline)
    for (const [key, table] of Object.entries(FULL.numeric as Json)) {
      for (const [a, row] of Object.entries(table as Json)) {
        const { kappa_m, ...rest } = row as Json
        expect(kappa_m).toHaveLength(7)
        expect(SUB.numeric[key][a], `${key} ${a}`).toEqual(rest)
      }
    }
    for (const [key, table] of Object.entries(FULL.mc as Json)) {
      if (key.startsWith('_')) {
        expect(SUB.mc[key]).toEqual(table)
        continue
      }
      for (const [a, row] of Object.entries(table as Json)) {
        const { seeds, diverged, converged, candidates, ...rest } = row as Json
        expect(seeds).toHaveLength(8)
        expect(diverged).toHaveLength(8)
        expect(converged).toHaveLength(8)
        expect(Object.keys(candidates).sort()).toEqual(['efold', 'two_stage', 'two_stage_m1'])
        expect(SUB.mc[key][a], `${key} ${a}`).toEqual(rest)
      }
    }
    // golden 的總結：F-CS.28 的線性段 105 組、87 ok、0 mismatch、18 n/a（全是 dead zone）；候選判準「dead zone 看 κ_∞」在 dead zone 6/8/4；headline 那一組 8/8 發散
    expect(SUB.mc._summary).toMatchObject({ n_ok: 87, n_mismatch: 0, n_na: 18, n_dead: 18 })
    expect(SUB.mc._summary.candidates.two_stage.dead_zone).toEqual({ n_ok: 6, n_mismatch: 8, n_na: 4 })
    expect(SUB.mc._summary.candidates.efold.n_mismatch).toBe(0)
    expect(SUB.mc['L2_pm45|mash']['0.03']).toMatchObject({ n_div: 8, verdict: 'dead' })
    expect(SUB.headline.kappa_inf).toBeLessThan(-0.2)
  })
})

describe('ditherNumbers.json 的結構驗證（docs/dev-conventions.md §6.2；schema 暫放在 data.ts 的 DITHER_NUM_SCHEMA）', () => {
  it('SSPLL: 真實檔案通過；schemas.json 的條目 sspll/dither_numbers 存在且路徑指向這個檔案', () => {
    expect(validateValue(SUB, SCHEMA.schema, SCHEMA.defs)).toBeNull()
    expect(DITHER_NUM.headline.kappa_1).toBe(SUB.headline.kappa_1)
  })

  it('SSPLL: 破壞後在正確的路徑失敗——少一個欄位、判定不在 enum、Wilson 區間少一端、headline 少一項、NaN', () => {
    const broken = (f: (j: Json) => void): Json => {
      const j = JSON.parse(JSON.stringify(SUB)) as Json
      f(j)
      return j
    }
    expect(validateValue(broken((j) => delete j.numeric['L2|mash']['0.03'].gos_C), SCHEMA.schema, SCHEMA.defs)).toMatch(/gos_C/)
    expect(validateValue(broken((j) => (j.mc['L2_pm45|mash']['0.03'].verdict = 'diverged')), SCHEMA.schema, SCHEMA.defs)).toMatch(/verdict/)
    expect(validateValue(broken((j) => j.mc['L2|rot8']['0.02'].ci_div.pop()), SCHEMA.schema, SCHEMA.defs)).toMatch(/ci_div/)
    expect(validateValue(broken((j) => delete j.headline.terms.k2), SCHEMA.schema, SCHEMA.defs)).toMatch(/terms/)
    expect(validateValue(broken((j) => (j.headline.kappa_inf = NaN)), SCHEMA.schema, SCHEMA.defs)).toMatch(/kappa_inf/)
    expect(validateValue(broken((j) => delete j.mc['L2|dq']['0.03'].kappa_inf_worst), SCHEMA.schema, SCHEMA.defs)).toMatch(/kappa_inf_worst/)
    expect(validateValue(broken((j) => (j.mc._summary.candidates.two_stage.dead_zone.n_mismatch = 8.5)), SCHEMA.schema, SCHEMA.defs)).toMatch(/n_mismatch/)
  })

  it('SSPLL: F-CS.28 的式子裡寫死的 headline 數字（0.731、−0.382、0.269、0.041、−0.009、+0.021、κ_∞ = −0.258）和 golden 一致到印出的位數；κ_∞ 只寫成提示', () => {
    const f28 = FORMULAS.find((f) => f.id === 'F-CS.28')!
    const hl = SUB.headline
    const r3 = (x: number) => x.toFixed(3)
    expect(f28.tex).toContain(`${r3(hl.phi2)}\\times(${r3(hl.ReH)})`)
    expect(f28.tex).toContain(`${r3(hl.terms.k0)}+${r3(hl.terms.k1)}${r3(hl.terms.k2)}`)
    expect(f28.tex).toContain(`=+${r3(hl.kappa_1)}`)
    expect(f28.tex).toContain(`=${r3(hl.kappa_inf)}\\end{gathered}`)
    expect(f28.tex).toContain('提示（研究假說，不參與判定）')
    expect(f28.tex).not.toMatch(/Rightarrow\\ \\text\{發散\}/) // 舊版的「κ_∞ = −0.258 ⇒ 發散」已拿掉
    // 條件裡的 87／0／18（線性段）與兩段判定在 dead zone 的 6／8／4、反例的 κ_∞ 與 golden 的交叉比對總結相同
    const s = SUB.mc._summary
    expect(f28.conditions).toContain(`一致 ${s.n_ok} 個、不一致 ${s.n_mismatch} 個、dead zone ${s.n_na} 個不判`)
    const dz = s.candidates.two_stage.dead_zone
    expect(f28.conditions).toContain(`${s.n_dead} 個 dead zone 案例裡一致 ${dz.n_ok} 個、不一致 ${dz.n_mismatch} 個、不判 ${dz.n_na} 個`)
    const l3 = SUB.mc['L3|acc1']['0.253']
    expect(f28.conditions).toContain(`mode ${l3.worst_mode} 的 $\\kappa_\\infty=${r3(l3.kappa_inf_worst)}$，${l3.n_conv} 個 seeds 卻全部收斂`)
    expect(l3.n_conv).toBe(l3.n)
    expect(f28.claim).toBe('approx')
  })
})

describe('§10b.4／§10b.7 引用的反例數字（κ_∞ 判準為什麼失敗）', () => {
  it('SSPLL: 初始 PHOS 誤差（−ε，seed 7）的模態功率：mode 4 只有 0.6%、mode 1＋7 佔 63%（推導文件 §5a 與頁面的說法）；反例那兩列的 golden 數字', () => {
    const e = SIM_CFG.epsPs
    const pw = Array.from({ length: 8 }, (_, m) => {
      let re = 0
      let im = 0
      for (let k = 0; k < 8; k++) {
        re += e[k] * Math.cos((2 * Math.PI * m * k) / 8)
        im -= e[k] * Math.sin((2 * Math.PI * m * k) / 8)
      }
      return re * re + im * im
    })
    const tot = pw.slice(1).reduce((x, y) => x + y, 0)
    expect(pw[4] / tot).toBeCloseTo(0.006, 3)
    expect((pw[1] + pw[7]) / tot).toBeCloseTo(0.63, 2)
    const doc = readFileSync(new URL('../../../docs/analysis/sspll-dither-interaction.md', import.meta.url), 'utf8')
    expect(doc).toContain('mode 4 只佔初始 PHOS 誤差功率的 0.6%，mode 1＋7 佔 63%')
    // 反例：L3／acc1／0.253（mode 4 的 κ_∞ = −0.744，8/8 收斂）、L3／dq／0.01（κ_∞ = −0.173，0/8 發散、0/8 收斂）
    const a = SUB.mc['L3|acc1']['0.253']
    expect([a.worst_mode, a.kappa_inf_worst.toFixed(3), a.n_div, a.n_conv]).toEqual([4, '-0.744', 0, 8])
    const d = SUB.mc['L3|dq']['0.01']
    expect([d.verdict, d.kappa_inf_worst.toFixed(3), d.n_div, d.n_conv]).toEqual(['dead', '-0.173', 0, 0])
    expect(doc).toContain('L3、dq、$\\alpha=0.01$ 的 $\\kappa_\\infty=-0.173$，0/8 發散、0/8 收斂')
    expect(doc).toContain('L3、acc1、$\\alpha=0.253$ 沿 mode 4 的 $\\kappa_\\infty=-0.744$，8/8 收斂')
  })
})
