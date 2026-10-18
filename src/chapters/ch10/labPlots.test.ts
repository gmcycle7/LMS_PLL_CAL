import type { Data } from 'plotly.js-cartesian-dist-min'
import { applyPlotMath, plotMath } from '@/components/plotMath'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import {
  DEFAULT_RULE,
  RULES,
  analyzeRule,
  buildPlant,
  resolveJhat,
  runMimoCovarianceMc,
  runMimoTrajectories,
  type MimoTrajParams,
  type RuleConfig,
} from '@/simulation/models/mimo'
import { DEFAULT_CASES, DEFAULT_PARAMS, DEFAULT_SEED, allRulesFrom, delta0Of, jhatSpecOf, plantSpecOf } from './experiments/labState'
import { mcTraces, normTraces, phasePlaneTraces, poleTraces, trajectoryTraces, type PlotTokens } from './experiments/labPlots'

/**
 * MIMO LMS Lab 的圖例名稱（trace name）都用 LaTeX（docs/teaching-style.md §3：圖裡面的數學也要用 LaTeX）：
 * 用真正的模擬結果把 labPlots.ts 的每一種 trace 都產生一次，檢查
 *  1. `$...$` 以外沒有 Unicode 拼的數學（希臘字母、下標數字、±、²…）；
 *  2. 經過 Plot 元件的轉換（plotMath）後，圖上不會殘留反斜線、大括號或 `$`（用到了 plotMath 不支援的指令時，指令名稱會原樣露出來）。
 */

const tokens: PlotTokens = { series: ['#1f77b4', '#d62728', '#2ca02c'], text: '#111111', textMuted: '#666666', border: '#cccccc' }

/** `$...$` 以外的文字 */
const outsideMath = (s: string) => s.replace(/(?<!\\)\$(?:[^$\\]|\\.)+?(?<!\\)\$/g, '')

function names(traces: Data[]): string[] {
  return traces.map((t) => (t as { name?: string }).name).filter((x): x is string => typeof x === 'string')
}

function expectLatexNames(all: string[], what: string) {
  expect(all.length, what).toBeGreaterThan(0)
  for (const name of all) {
    expect(unicodeMathIn(outsideMath(name)), `${what}：${name}`).toEqual([])
    const shown = plotMath(name)
    expect(shown, `${what}：${name}`).not.toMatch(/[\\{}$]/)
  }
}

function run(engine: 'linear' | 'sample', cases: RuleConfig[], blocks = 60) {
  const params = { ...DEFAULT_PARAMS, engine, blocks, N: 256 }
  const req: MimoTrajParams = {
    plant: plantSpecOf(params),
    cases,
    delta0: delta0Of(params),
    blocks,
    engine,
    jhat: jhatSpecOf(params),
    seed: DEFAULT_SEED,
  }
  const plant = buildPlant(req.plant)
  const jn = resolveJhat(plant, req.jhat, req.delta0, req.seed)!.JnHat
  return { req, plant, jn, res: runMimoTrajectories(req), params }
}

describe('labPlots：圖例名稱用 LaTeX', () => {
  const ids = ['A', 'B', 'C']

  it('時域軌跡（解析平均、±2σ 帶、sample 引擎的 mean-field）、六種規則的 ‖δ‖、poles、相平面：名稱沒有 Unicode 拼的數學，轉換後也沒有殘留的 TeX', () => {
    const sample = run('sample', DEFAULT_CASES)
    expect(sample.res.ok).toBe(true)
    const trajNames = names(trajectoryTraces(sample.res.cases, ids, DEFAULT_CASES, 2, tokens, 1, null, true))
    // 每一種 trace 都出現過：軌跡、±2σ 帶（兩種名稱）、線性解析平均、mean-field
    expect(trajNames.some((x) => /\$E\[\\delta_1\]\$（線性解析）/.test(x))).toBe(true)
    expect(trajNames.some((x) => /mean-field \$\\delta_1\$/.test(x))).toBe(true)
    expect(trajNames.some((x) => /解析 \$\\pm2\\sigma\$/.test(x))).toBe(true)
    expect(trajNames.some((x) => /^\$\\pm2\\sigma\$ \$\\delta_2\$$/.test(x))).toBe(true)
    expect(trajNames).toContain('Case A：Scalar $\\delta_1$')
    expectLatexNames(trajNames, '時域軌跡')
    // 轉成 Plotly 的 pseudo-HTML 之後：斜體符號與真正的下標
    expect(plotMath('Case A：Scalar $\\delta_1$')).toBe('Case A：Scalar <i>δ</i><sub>1</sub>')
    expect(plotMath('$\\pm2\\sigma$ $\\delta_2$')).toBe('±2<i>σ</i> <i>δ</i><sub>2</sub>')
    expect(plotMath('Case A $E[\\delta_1]$（線性解析）')).toBe('Case A <i>E</i>[<i>δ</i><sub>1</sub>]（線性解析）')

    const linear = run('linear', allRulesFrom(DEFAULT_CASES[0]), 80)
    expect(linear.res.ok).toBe(true)
    expectLatexNames(names(normTraces(linear.res.cases, tokens, null)), '‖δ‖')

    // poles：單位圓與每個 case（含 sequential 的 sweep Φ）
    const withSeq: RuleConfig[] = [...DEFAULT_CASES.slice(0, 2), { ...DEFAULT_RULE, rule: 'sequential', gamma: 1, seqBlocksPerPhase: 1, seqSweeps: 3 }]
    const seq = run('linear', withSeq, 40)
    const analyses = withSeq.map((c) => analyzeRule(seq.plant, c, seq.jn))
    const poleNames = names(poleTraces(analyses, ids, tokens))
    expect(poleNames).toContain('單位圓 $|z| = 1$')
    expect(poleNames.some((x) => x.includes('sweep $\\Phi$'))).toBe(true)
    expectLatexNames(poleNames, 'poles')
    expect(plotMath('單位圓 $|z| = 1$')).toBe('單位圓 |<i>z</i>| = 1')

    // 相平面：方向場、軌跡、目前位置、橢圓、原點
    const field = [
      [-0.5, 0],
      [0, -0.5],
    ]
    const phaseNames = names(
      phasePlaneTraces({ traj: seq.res.cases, analyses, ids, tokens, field, L: 12, kView: 30, scheduleEnd: withSeq.map((c) => (c.rule === 'sequential' ? 2 * c.seqSweeps * c.seqBlocksPerPhase : null)) }),
    )
    expect(phaseNames).toContain('平均更新方向 $-\\mathbf M\\mathbf G$（active case）')
    expect(phaseNames).toContain('$\\delta = 0$（$w = a$）')
    expect(phaseNames.some((x) => /目前 \$k = \d+\$/.test(x))).toBe(true)
    expectLatexNames(phaseNames, '相平面')
    expect(plotMath('平均更新方向 $-\\mathbf M\\mathbf G$（active case）')).toBe('平均更新方向 −<b><i>M</i></b><b><i>G</i></b>（active case）')
  })

  it('Monte Carlo 的橢圓與樣本（stationary 與 sequential 的 final）：名稱沒有 Unicode 拼的數學', () => {
    for (const cfg of [DEFAULT_CASES[1], { ...DEFAULT_RULE, rule: 'sequential' as const, gamma: 1, seqBlocksPerPhase: 1, seqSweeps: 2 }]) {
      const base = run('linear', [cfg], 10)
      const mc = runMimoCovarianceMc({ plant: base.req.plant, rule: cfg, jhat: base.req.jhat, engine: 'linear', chains: 16, recordBlocks: 40, delta0: base.req.delta0, seed: DEFAULT_SEED })
      expect(mc.ok, mc.error ?? '').toBe(true)
      const all = names(mcTraces(mc, tokens, tokens.series[0]))
      expect(all.length).toBeGreaterThanOrEqual(3)
      expectLatexNames(all, `MC（${cfg.rule}）`)
    }
  })

  it('每一種規則都跑得過（不是只有預設三個 case）：六種規則 × 兩種引擎，圖例名稱都合格', () => {
    for (const engine of ['linear', 'sample'] as const) {
      const cases = allRulesFrom(DEFAULT_CASES[1])
      expect(cases.length).toBe(RULES.length)
      const r = run(engine, cases, 30)
      expect(r.res.ok).toBe(true)
      expectLatexNames(names(trajectoryTraces(r.res.cases, RULES.map((_, i) => 'ABCDEF'[i]), cases, 2, tokens, 0, null, engine === 'sample')), `${engine} 軌跡`)
      expectLatexNames(names(normTraces(r.res.cases, tokens, null)), `${engine} ‖δ‖`)
    }
  })

  it('負面：檢查真的抓得到——Unicode 拼的名稱、plotMath 不支援的指令都會被報出來', () => {
    expect(unicodeMathIn(outsideMath('±2σ δ1'))).toEqual(expect.arrayContaining(['±', 'σ', 'δ']))
    expect(unicodeMathIn(outsideMath('Case A $E[\\delta_1]$'))).toEqual([])
    // 不支援的 TeX 指令（例如 \boldsymbol\delta、\underset）：轉換後會殘留反斜線或大括號
    expect(plotMath('$\\boldsymbol\\delta_k$')).toMatch(/[\\{}]|delta/)
    expect(applyPlotMath([{ x: [1], name: '$\\sigma_w$' }], { title: 'x' }).data[0].name).toBe('<i>σ</i><sub><i>w</i></sub>')
  })
})
