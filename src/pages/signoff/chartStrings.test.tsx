import { render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import type { PlotProps } from '@/components'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import { plotMath } from '@/components/plotMath'
import { allChartStrings, chartStringProblems, plotlyLeftovers } from '../lab/chartStringsTestUtils'
import { CornerJudgeExperiment } from './experiments/CornerJudge'
import { EvidenceLabExperiment } from './experiments/EvidenceLab'
import { FixedPointJudgeExperiment } from './experiments/FixedPointJudge'
import { MimoJudgeExperiment } from './experiments/MimoJudgeLab'
import { PolarityPerturbExperiment } from './experiments/PolarityPerturb'
import { SspllJacobianExperiment } from './experiments/SspllJacobian'

/**
 * Sign-off 六個實驗的互動圖與控制項：數學一律是 LaTeX（使用者要求，2026-10-11：「數學公式包含圖片裡面的數學公式都要用類似 latex 的格式」）。
 *
 * 把共用的 <Plot> 換成「記下收到的 props」的替身，逐一渲染六個實驗，檢查交給 <Plot> 的每個圖內字串（軸標題、trace 名稱、刻度文字）：
 *   1. `$...$` 以外沒有 Unicode 拼的數學；公式裡也沒有 Unicode 數學；
 *   2. 經 plotMath 轉成 Plotly 的 pseudo-HTML 之後，沒有殘留的反斜線、大括號、`$`。
 * DOM 這一側：控制項的 label／unit／hint 與指標表的名稱／單位／備註，KaTeX 以外的文字也沒有 Unicode 數學（單位 fs⁻¹ 是 `$\mathrm{fs}^{-1}$`）。
 */
const captured = vi.hoisted(() => ({ plots: [] as { data: unknown; layout: unknown; title?: unknown; caption?: unknown }[] }))
vi.mock('@/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components')>()
  const Plot = (props: PlotProps) => {
    captured.plots.push({ data: props.data, layout: props.layout, title: props.title, caption: props.caption })
    return null
  }
  return { ...actual, Plot }
})

vi.setConfig({ testTimeout: 60_000 })

const INLINE = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

function mount(node: ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/signoff']}>
      <SettingsProvider>{node}</SettingsProvider>
    </MemoryRouter>,
  )
}

/** KaTeX 以外的文字（拿掉 .katex 子樹，MathML 的 TeX 原始碼也一併拿掉）；識別字（snake_case）不算數學 */
function plainTextOf(el: Element): string {
  const copy = el.cloneNode(true) as Element
  copy.querySelectorAll('.katex').forEach((k) => k.remove())
  return (copy.textContent ?? '').replace(/\b[A-Za-z]+(?:_[A-Za-z0-9]+)+\b/g, ' ')
}

const strings = () => allChartStrings(captured.plots)

/** 圖內字串、Plot 的 title／caption、DOM 的控制項與指標表，一次檢查 */
function checkAll(container: HTMLElement, expected: string[]) {
  const all = strings()
  expect(all.length).toBeGreaterThanOrEqual(3)
  for (const s of expected) expect(all, `圖內字串缺少 ${s}`).toContain(s)
  expect(chartStringProblems(captured.plots)).toEqual([])
  expect(plotlyLeftovers(all, plotMath)).toEqual([])
  for (const p of captured.plots) {
    if (typeof p.title === 'string') expect(unicodeMathIn(p.title.replace(INLINE, ' ')), `Plot title「${p.title}」`).toEqual([])
    if (typeof p.caption === 'string') expect(unicodeMathIn(p.caption.replace(INLINE, ' ')), `Plot caption「${p.caption}」`).toEqual([])
  }
  for (const el of Array.from(container.querySelectorAll('.c-param-label, .c-param-unit, .c-param-hint, .c-metric-table tbody th, .c-metric-table tbody td'))) {
    expect(unicodeMathIn(plainTextOf(el)), `「${el.textContent}」（${el.className}）`).toEqual([])
  }
  expect(container.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
}

/** KaTeX 的 TeX 原始碼（annotation） */
const texOf = (container: HTMLElement, selector: string): string[] => Array.from(container.querySelectorAll(`${selector} annotation`)).map((a) => a.textContent ?? '')

describe('Sign-off 實驗：圖內字串與控制項的數學都是 LaTeX', () => {
  beforeEach(() => {
    captured.plots.length = 0
  })
  afterEach(() => {
    try {
      localStorage.clear()
    } catch {
      /* ignore */
    }
    captured.plots.length = 0
  })

  it('Polarity：S 曲線（Ḡ(w)）、K 的比較圖（K̂ ±z·se、K_qC）；指標表的單位 fs⁻¹', async () => {
    const { container } = mount(<PolarityPerturbExperiment />)
    await waitFor(() => expect(strings().some((s) => s.includes('小訊號'))).toBe(true), { timeout: 60_000 })
    checkAll(container, [String.raw`$w$ [fs/unit code]`, String.raw`$\bar G(w)$（無因次）`, String.raw`$K$ [fs$^{-1}$]`, String.raw`小訊號 $K_qC$`])
    expect(strings().some((s) => /^\$\\hat K\$（\$\\pm z\\cdot\\mathrm\{se\}\$，\$z = [\d.]+\$）$/.test(s))).toBe(true)
    expect(strings().some((s) => /^Case [A-C] MC（\$\\pm2\\,\\mathrm\{se\}\$）$/.test(s))).toBe(true)
    expect(strings().some((s) => /^Case [A-C] \$\\pm\\Delta\$ 量測$/.test(s))).toBe(true)
    expect(texOf(container, '.c-metric-table')).toContain(String.raw`\mathrm{fs}^{-1}`)
    expect(container.querySelector('.c-metric-table')?.textContent).not.toContain('fs⁻¹')
  })

  it('Corner：每個 corner 的 ρ(μ)、0.05^{1/B}、ρ = 1、目前 μ；座標軸 μ 與 ρ', async () => {
    const { container } = mount(<CornerJudgeExperiment />)
    await waitFor(() => expect(strings().some((s) => s.includes('穩定邊界'))).toBe(true), { timeout: 60_000 })
    checkAll(container, [String.raw`$\mu$ [fs]`, String.raw`$\rho$`, String.raw`$\rho = 1$（穩定邊界）`])
    // 預設 d = 1：判定改用逐 block 的 k95，這條線只剩漸近參考的意義（d = 0 的圖例見 experiments.test.tsx 的 refLineName）
    expect(strings().some((s) => /^\$\\rho = 0\.05\^\{1\/B\}\$（漸近參考線，\$B = \d+\$）$/.test(s))).toBe(true)
    expect(strings().some((s) => /^目前 \$\\mu = [\d.e-]+\$ fs$/.test(s))).toBe(true)
    expect(strings().some((s) => /^TT 25°C：\$\\rho\(\\mu\)\$$/.test(s))).toBe(true)
  })

  it('Evidence：p_U 對 n 的曲線（k_f = 0, 1, 2）、log10|δ_n/δ_0| 的直方圖與理論值', async () => {
    const { container } = mount(<EvidenceLabExperiment />)
    await waitFor(() => expect(strings().some((s) => s.includes('理論'))).toBe(true), { timeout: 60_000 })
    checkAll(container, [
      String.raw`$n$（獨立試驗數）`,
      String.raw`$p_U$`,
      String.raw`$k_f = 0$`,
      String.raw`$k_f = 2$`,
      String.raw`目前 $(n, k_f)$`,
      String.raw`$\log_{10}|\delta_n/\delta_0|$（各路徑）`,
      String.raw`理論 $\log_{10}\bigl(\sqrt{E[\delta^2]}/\delta_0\bigr)$`,
    ])
  })

  it('Fixed-point：EFB 輸出 y_Q[k]、誤差頻譜 |X_k|/T；指標表的單位 LSB²', async () => {
    const { container } = mount(<FixedPointJudgeExperiment />)
    await waitFor(() => expect(strings().some((s) => s.includes('y_Q'))).toBe(true), { timeout: 60_000 })
    checkAll(container, [String.raw`6-bit 輸出 $y_Q[k]$`, String.raw`$k$（code 更新）`])
    expect(texOf(container, '.c-metric-table')).toContain(String.raw`\mathrm{LSB}^2`)
    expect(container.querySelector('.c-metric-table')?.textContent).not.toContain('LSB²')
  })

  it('MIMO：eig(I + MJ)、單獨 1 + M_iiJ_ii、公式 pole；Re z／Im z；控制項的單位 fs⁻¹', async () => {
    const { container } = mount(<MimoJudgeExperiment />)
    await waitFor(() => expect(strings().some((s) => s.includes('聯合'))).toBe(true), { timeout: 60_000 })
    checkAll(container, [
      String.raw`$\mathrm{Re}\,z$`,
      String.raw`$\mathrm{Im}\,z$`,
      String.raw`$\mathrm{eig}(\mathbf I + \mathbf M\mathbf J)$（聯合）`,
      String.raw`單獨 $1 + M_{ii}J_{ii}$`,
    ])
    const units = texOf(container, '.c-param-unit')
    expect(units.filter((u) => u === String.raw`\mathrm{fs}^{-1}`)).toHaveLength(4)
  })

  it('SSPLL Jacobian：聯合 eig(I + MĴ)、單獨更新 1 + μ_iĴ_ii；Re z／Im z；Ĵ 的單位 fs⁻¹', async () => {
    const { container } = mount(<SspllJacobianExperiment />)
    await waitFor(() => expect(strings().some((s) => s.includes('聯合'))).toBe(true), { timeout: 60_000 })
    checkAll(container, [
      String.raw`$\mathrm{Re}\,z$`,
      String.raw`$\mathrm{Im}\,z$`,
      String.raw`聯合 $\mathrm{eig}(\mathbf I + \mathbf M\hat{\mathbf J})$`,
      String.raw`單獨更新 $1 + \mu_i\hat J_{ii}$`,
    ])
    expect(texOf(container, '.c-metric-table')).toContain(String.raw`\mathrm{fs}^{-1}`)
  })
})
