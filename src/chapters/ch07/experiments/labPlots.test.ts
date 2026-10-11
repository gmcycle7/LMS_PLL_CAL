import type { Data, Layout } from 'plotly.js-dist-min'
import { applyPlotMath, plotMath } from '@/components/plotMath'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import { presetById } from '@/app/presets'
import { analyzeFxLab, runFxComparison, type FxLabAnalysis } from '@/simulation/models/filteredX'
import { parseLabPreset, toCaseSpec, toCodeSpec, toFxScenario, toHatSpec, toPathSpec, type LabCase, type LabScenario } from './labState'
import { closedLoopFigure, phaseFigure, sweepFigure, waveFigure } from './labPlots'

/**
 * Lab 的 Plotly 圖內文字（docs/teaching-style.md §3：圖裡面的數學也要用 LaTeX）：
 * 軸標題、圖例名稱都寫 `$...$`，Plot 元件用 plotMath 轉成斜體符號與真正的上下標；文字部分沒有 Unicode 拼的數學。
 */

const r = String.raw
const INLINE = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
const TEXT_KEYS = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext'])

/** 圖上會顯示的字串（trace 名稱、軸標題…） */
function plotStrings(figure: { data: Data[]; layout: Partial<Layout> }): string[] {
  const out: string[] = []
  const walk = (v: unknown, key: string | null, depth: number): void => {
    if (depth > 6 || v === null || v === undefined) return
    if (typeof v === 'string') {
      if (key !== null && TEXT_KEYS.has(key)) out.push(v)
      return
    }
    if (Array.isArray(v)) {
      v.forEach((x) => walk(x, key, depth + 1))
      return
    }
    if (typeof v === 'object' && !ArrayBuffer.isView(v)) for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1)
  }
  walk(figure.data, null, 0)
  walk(figure.layout, null, 0)
  return out
}

/** 每個字串：`$` 成對、文字部分沒有 Unicode 拼的數學、plotMath 轉完沒有殘留的 TeX（反斜線、大括號、$） */
function expectLatexStyle(strings: string[]) {
  for (const s of strings) {
    expect((s.match(/(?<!\\)\$/g) ?? []).length % 2, s).toBe(0)
    expect(unicodeMathIn(s.replace(INLINE, '')), `文字部分：${s}`).toEqual([])
    expect(s.replace(INLINE, ''), `文字部分：${s}`).not.toMatch(/[ĤĥŷΔ]|̂/u)
    expect(plotMath(s), s).not.toMatch(/[\\${}]/)
  }
}

const parsed = parseLabPreset(presetById('filtered-x-second-diff-hf-fail')?.params) as NonNullable<ReturnType<typeof parseLabPreset>>
function analysis(i: number, patch: Partial<LabCase> = {}): FxLabAnalysis {
  const c = { ...parsed.cases[i], ...patch }
  return analyzeFxLab({
    path: toPathSpec(parsed.scenario),
    code: toCodeSpec(parsed.scenario),
    mode: c.mode,
    D: c.D,
    hat: toHatSpec(c),
    seed: 1,
    Dmax: 8,
  })
}

describe('Lab 的圖內文字：數學寫成 $...$（plotMath 轉成斜體符號與上下標）', () => {
  it('波形疊圖：x[n]、u[n]、x[n−D]、u_f[n]（含縮放標註）的圖例與 n 軸', () => {
    // 二次差分的增益約 1/27 倍：u_f 會被縮放，圖例帶「顯示 × k」；filtered-x 且 D > 0 時多一條 u_f[n−D]
    const fig = waveFigure(analysis(1, { mode: 'filtered', D: 2 }), 'filtered', 2)
    const names = fig.data.map((d) => d.name as string)
    expect(names).toHaveLength(5)
    expect(names[0]).toBe(r`$x[n]$（code）`)
    expect(names[1]).toBe(r`$u[n] = (h*x)[n]$（PD 看到的）`)
    expect(names[2]).toBe(r`$x[n-2]$（delayed-x）`)
    expect(names[3]).toMatch(/^\$u_f\[n\] = \(\\hat h\*x\)\[n\]\$（filtered-x）（顯示 \$\\times [\d.]+\$，與 \$u\$ 同 RMS）$/)
    expect(names[4]).toMatch(/^\$u_f\[n-2\]\$（實際 regressor）（顯示 \$\\times [\d.]+\$，與 \$u\$ 同 RMS）$/)
    expect((fig.layout.xaxis?.title as { text: string }).text).toBe(r`$n$ [sample]`)
    expectLatexStyle(plotStrings(fig))
    // 轉成 Plotly pseudo-HTML：斜體變數與真正的下標，× 與數字相連
    expect(plotMath(names[0])).toBe('<i>x</i>[<i>n</i>]（code）')
    expect(plotMath(names[2])).toBe('<i>x</i>[<i>n</i>−2]（delayed-x）')
    // \hat h → h + 組合用的抑揚符（U+0302）
    expect(plotMath(names[3])).toContain('<i>u</i><sub><i>f</i></sub>[<i>n</i>] = (<i>h\u0302</i>∗<i>x</i>)[<i>n</i>]')
    expect(plotMath(names[3])).toContain('×')
    // Ĥ = H 時不縮放：圖例沒有「顯示 ×」
    const plain = waveFigure(analysis(2), 'raw', 0)
    expect(plain.data.map((d) => d.name as string).some((n) => n.includes('顯示'))).toBe(false)
  })

  it('相關 vs D：圖例的 E[x[n−D]·u[n]]、E[x[n]·u[n−D]]、E[u_f[n−D]·u[n]] 與 D、C 軸', () => {
    const fig = sweepFigure(analysis(2), 3, 'filtered')
    const names = fig.data.map((d) => d.name as string)
    expect(names).toContain(r`delayed-x：$E[x[n-D]\cdot u[n]]$（解析）`)
    expect(names).toContain(r`延遲 error：$E[x[n]\cdot u[n-D]]$（解析）`)
    expect(names).toContain(r`filtered-x：$E[u_f[n-D]\cdot u[n]]$（解析）`)
    expect((fig.layout.xaxis?.title as { text: string }).text).toBe(r`$D$ [samples]`)
    expect((fig.layout.yaxis?.title as { text: string }).text).toBe(r`相關 $C$（unit-power code）`)
    expectLatexStyle(plotStrings(fig))
    expect(plotMath(names[0])).toBe('delayed-x：<i>E</i>[<i>x</i>[<i>n</i>−<i>D</i>]·<i>u</i>[<i>n</i>]]（解析）')
  })

  it('逐頻率相位：θ(Ω) = ∠H − ∠Ĥ_ref + ΩD、∠H(e^{jΩ})、加權 S_xx|H||Ĥ_ref| 與 Ω 軸', () => {
    // 單頻 code 沒有封閉式 PSD：加權只有 |H||Ĥ_ref|；AR(1) code 有 S_xx
    const tone = phaseFigure(analysis(2))
    const toneNames = tone.data.map((d) => d.name as string)
    expect(toneNames[0]).toBe(r`$\theta(\Omega) = \angle H - \angle\hat H_{\mathrm{ref}} + \Omega D$`)
    expect(toneNames[1]).toBe(r`$\angle H(e^{j\Omega})$`)
    expect(toneNames[2]).toBe(r`$|H||\hat H_{\mathrm{ref}}|$（正規化）`)
    expect((tone.layout.xaxis?.title as { text: string }).text).toBe(r`$\Omega$ [rad/sample]（log）`)
    expectLatexStyle(plotStrings(tone))
    expect(plotMath(toneNames[0])).toBe('<i>θ</i>(Ω) = ∠<i>H</i>−∠<i>H\u0302</i><sub>ref</sub>+Ω<i>D</i>')
    const ar1 = analyzeFxLab({
      path: toPathSpec(parsed.scenario),
      code: toCodeSpec({ ...parsed.scenario, codeKind: 'ar1', rho: 0.9 }),
      mode: 'raw',
      D: 0,
      hat: toHatSpec(parsed.cases[0]),
      seed: 1,
      Dmax: 8,
    })
    const ar1Names = phaseFigure(ar1).data.map((d) => d.name as string)
    expect(ar1Names).toContain(r`加權 $S_{xx}|H||\hat H_{\mathrm{ref}}|$（正規化）`)
    expectLatexStyle(plotStrings(phaseFigure(ar1)))
  })

  it('閉迴路 w_k：Case 圖例（含 $...$ 的說明）、線性化平均的 p、block k 軸與 w_k 軸', () => {
    const base = parseLabPreset(presetById('delay-phi-m120-d4')?.params) as NonNullable<ReturnType<typeof parseLabPreset>>
    const scenario: LabScenario = { ...base.scenario, N: 64, blocks: 30 }
    const res = runFxComparison({ scenario: toFxScenario(scenario, 1), cases: base.cases.map((c, i) => ({ id: 'ABC'[i], spec: toCaseSpec(c) })) })
    const labels = { A: 'raw-x', B: r`delayed-x，$D=4$`, C: r`filtered-x（$\hat H=H$）` }
    const fig = closedLoopFigure(res, scenario, { A: '#111', B: '#222', C: '#333' }, labels)
    const names = fig.data.map((d) => d.name as string)
    expect(names).toContain('Case A：raw-x')
    expect(names).toContain(r`Case B：delayed-x，$D=4$`)
    expect(names).toContain(r`Case C：filtered-x（$\hat H=H$）`)
    // 線性化平均只畫預測會收斂的 Case（B、C）：名稱裡的 p 是公式
    const pred = names.filter((n) => n.includes('線性化平均'))
    expect(pred.length).toBeGreaterThanOrEqual(2)
    for (const n of pred) expect(n).toMatch(/^Case [BC] 線性化平均（\$p = -?[\d.]+\$）$/)
    expect((fig.layout.xaxis?.title as { text: string }).text).toBe(r`block $k$`)
    expect((fig.layout.yaxis?.title as { text: string }).text).toBe(r`$w_k$ [fs per unit code]`)
    expectLatexStyle(plotStrings(fig))
    // 圖例送進 Plotly 之前由 applyPlotMath 轉成斜體符號
    const typeset = applyPlotMath(fig.data, fig.layout)
    const typesetNames = typeset.data.map((d) => d.name as string)
    expect(typesetNames).toContain('Case B：delayed-x，<i>D</i> = 4')
    expect(typesetNames).toContain('Case C：filtered-x（<i>H\u0302</i> = <i>H</i>）')
    expect((typeset.layout.yaxis?.title as { text: string }).text).toBe('<i>w</i><sub><i>k</i></sub> [fs per unit code]')
  })
})
