import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import type { PlotProps } from '@/components'
import { eig2x2, peAnalytic, signJitterSteadyState, stepsToDecay } from '@/simulation/models/pe'
import { PeEigenLab } from './experiments/PeEigenLab'
import { PE_DEFAULT, PE_LIMITS, S_DELTA_LIMIT, blocksForConvergence, derivedGain, k95ForConvergence, shownPole, switchDetector } from './experiments/peLabState'

/**
 * PE / Eigen Lab 的三個行為（技術審查的收尾項目），只渲染實驗室本身（不渲染整章）：
 *   1. 顯示的 pole 不帶浮點殘渣：ρ = ±1、g = 0.5 的 p_fast 是 0，不是 2.22045e-16（審查 R07 的附帶觀察）。
 *   2. g > g⋆ 時整體要等的是過衝的 λ_max 模式：有提示，「執行至收斂」也以它定長度（審查 C01 的延伸）。
 *   3. 1-bit 的小訊號條件也檢查迴路自己的穩態抖動，不只是初始誤差（審查 R06a 的後續）。
 * 共用的 <Plot> 換成「記下 props」的替身（作法同 chartStrings.test.tsx），圖說與圖例字串才檢查得到。
 */
const captured = vi.hoisted(() => ({ plots: [] as unknown[] }))
vi.mock('@/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components')>()
  const Plot = (props: PlotProps) => {
    captured.plots.push(props)
    return null
  }
  return { ...actual, Plot }
})

const WAIT = { timeout: 60000, interval: 200 }
const TIMEOUT = 120000

function renderLab(url = '/') {
  localStorage.setItem('lmspll.mode', 'engineer')
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <PeEigenLab />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

/** 最近一次交給 <Plot> 的 props（依 csvName 找） */
function lastPlot(csvName: string): PlotProps {
  const all = (captured.plots as PlotProps[]).filter((p) => p.csvName === csvName)
  expect(all.length, csvName).toBeGreaterThan(0)
  return all[all.length - 1]
}

/** 指標表裡名稱同時含有這幾段文字的那一列的「數值」欄（名稱以 KaTeX 顯示，textContent 帶有 TeX 原始碼） */
function metricValue(container: HTMLElement, ...needles: string[]): string {
  const row = Array.from(container.querySelectorAll('.c-metric-table tbody tr')).find((tr) => {
    const name = tr.querySelector('td')?.textContent ?? ''
    return needles.every((n) => name.includes(n))
  })
  expect(row, `指標列 ${needles.join(' ＋ ')}`).toBeTruthy()
  return row?.querySelectorAll('td')[1]?.textContent ?? ''
}

const warningsText = (container: HTMLElement) => container.querySelector('.c-exp-warnings')?.textContent ?? ''

function setParam(ariaLabel: string, value: string) {
  fireEvent.change(screen.getByLabelText(ariaLabel), { target: { value } })
}

beforeEach(() => {
  captured.plots.length = 0
})
afterEach(() => {
  localStorage.clear()
  captured.plots.length = 0
})

describe('PE / Eigen Lab：純函式', () => {
  it('shownPole：gλ = 1 的浮點殘渣顯示成 0（ρ = ±1、g = .5 的 p_fast；ρ = .5、g = 2/3；ρ = .2、g = 1.25 的 p_slow），真正的小 pole 與一般的 pole 不動', () => {
    for (const rho of [1, -1]) {
      const a = peAnalytic({ rho, dist: 'gaussian', g: 0.5, N: 16, N0: 100 })
      // 模型的值：Jacobi 的 λ_max = 1.9999999999999996 ⇒ 1 − 0.5λ_max = 2.2×10⁻¹⁶（不是 0）；閉式 λ_max 恰好是 2
      expect(a.pFast).not.toBe(0)
      expect(Math.abs(a.pFast)).toBeLessThan(1e-15)
      expect(a.closed.values[0]).toBe(2)
      expect(shownPole(a.pFast, 0.5 * a.closed.values[0])).toBe(0)
      expect(shownPole(a.pSlow, 0.5 * a.closed.values[1])).toBe(1) // λ_min = 0 的 pole 仍是 1
    }
    const b = peAnalytic({ rho: 0.5, dist: 'gaussian', g: 2 / 3, N: 16, N0: 100 })
    expect(b.pFast).not.toBe(0)
    expect(shownPole(b.pFast, (2 / 3) * 1.5)).toBe(0)
    const c = peAnalytic({ rho: 0.2, dist: 'gaussian', g: 1.25, N: 16, N0: 100 })
    expect(c.pSlow).not.toBe(0)
    expect(shownPole(c.pSlow, 1.25 * 0.8)).toBe(0)
    // 不是殘渣的數字原樣保留
    const d = peAnalytic({ rho: 0.99, dist: 'gaussian', g: 0.5, N: 16, N0: 100 })
    expect(shownPole(d.pFast, 0.5 * 1.99)).toBe(d.pFast)
    expect(shownPole(d.pSlow, 0.5 * 0.01)).toBe(d.pSlow)
    expect(shownPole(1e-9, 1)).toBe(1e-9)
    expect(shownPole(-0.8, 1.8)).toBe(-0.8)
    // gλ 很大時門檻跟著放大（相對於運算元）：g = 100、λ = 0.01 的 1 − gλ 殘渣是 −4×10⁻¹⁵
    expect(shownPole(-4.2e-15, 1)).toBe(0)
  })

  it('k95ForConvergence（審查 C01）：g ≤ g⋆ 用慢模式；g⋆ < g < 2/λ_max 換成過衝的 λ_max 模式（ρ = .5、g = 1.2：14 不是 4；ρ = .99、g = 1.003：742 不是 298）', () => {
    const k95 = (rho: number, g: number) => {
      const [lmax, lmin] = eig2x2(1, rho, 1).values
      return { fast: stepsToDecay(1 - g * lmax), slow: stepsToDecay(1 - g * lmin) }
    }
    // 預設 ρ = .99、g = .5：598（T11）⇒ ⌈1.25·598⌉ = 748，和原本一樣
    const def = k95(0.99, 0.5)
    expect(def).toEqual({ fast: 1, slow: 598 })
    expect(k95ForConvergence(def.fast, def.slow)).toBe(598)
    expect(blocksForConvergence(k95ForConvergence(def.fast, def.slow))).toEqual({ blocks: 748, reachable: true })
    // ρ = .5、g = 1.2：pole −0.8／0.4 ⇒ 14／4 個 block；以前拉到下限 10，現在是 ⌈1.25·14⌉ = 18
    const a = k95(0.5, 1.2)
    expect(a).toEqual({ fast: 14, slow: 4 })
    expect(blocksForConvergence(a.slow).blocks).toBe(PE_LIMITS.blocks[0])
    expect(blocksForConvergence(k95ForConvergence(a.fast, a.slow))).toEqual({ blocks: 18, reachable: true })
    // ρ = .99、g = 1.003：pole −0.99597／0.98997 ⇒ 742／298；以前 373，現在 ⌈1.25·742⌉ = 928
    const b = k95(0.99, 1.003)
    expect(b).toEqual({ fast: 742, slow: 298 })
    expect(blocksForConvergence(b.slow).blocks).toBe(373)
    expect(blocksForConvergence(k95ForConvergence(b.fast, b.slow))).toEqual({ blocks: 928, reachable: true })
    // 快模式發散（k₉₅ = ∞）：沒有收斂可等，長度照舊用慢模式；λ_min = 0（慢模式 ∞）：停在上限
    expect(k95ForConvergence(Infinity, 271)).toBe(271)
    expect(k95ForConvergence(1, Infinity)).toBe(Infinity)
    expect(blocksForConvergence(k95ForConvergence(1, Infinity))).toEqual({ blocks: PE_LIMITS.blocks[1], reachable: false })
  })

  it('1-bit 穩態抖動的門檻：預設 g = .5、N = 16 切到 1-bit 時 √E[s_δ²] = 0.303 > 0.3（會警告）；N = 64 時 0.155；preset pe-physical-kq（g = 0.004、N = 64）遠低於門檻', () => {
    expect(S_DELTA_LIMIT).toBe(0.3)
    const sign = switchDetector(PE_DEFAULT, 'sign')
    const lam = eig2x2(1, sign.rho, 1).values
    const g = derivedGain(sign).g
    expect(g).toBeCloseTo(0.5, 12)
    expect(Math.sqrt(signJitterSteadyState(lam, g, sign.N))).toBeCloseTo(0.303, 3)
    expect(Math.sqrt(signJitterSteadyState(lam, g, 64))).toBeCloseTo(0.1549, 4)
    expect(Math.sqrt(signJitterSteadyState(lam, 0.5 * Math.sqrt(2 / Math.PI) / 100, 64))).toBeLessThan(0.02)
  })
})

describe('PE / Eigen Lab：畫面', () => {
  it(
    'R07 附帶項：preset pe-rho-1-missing（ρ = 1、g = .5）的 p_fast 顯示 0（不是 2.22045e-16）；(δ₁, δ₂) 圖說寫「到不了原點」而不是「慢慢爬回原點」',
    async () => {
      const { container } = renderLab('/?preset=pe-rho-1-missing')
      await waitFor(() => expect(container.textContent).toMatch(/MC：64 chains × 300 blocks/), WAIT)
      expect(metricValue(container, String.raw`p_{\text{fast}}=1-g\lambda_{\max}`)).toBe('0')
      expect(metricValue(container, String.raw`p_{\text{slow}}=1-g\lambda_{\min}`)).toBe('1')
      expect(metricValue(container, String.raw`p_{\text{fast}}=1-g\lambda_{\max}`)).not.toMatch(/e-1\d/)
      // 圖例的 pole 同樣是 0
      const modeNames = (lastPlot('pe-eigenmodes').data as { name?: string }[]).map((t) => t.name ?? '')
      expect(modeNames.some((n) => n.includes('（$p=0$）'))).toBe(true)
      expect(modeNames.join(' ')).not.toMatch(/10\^\{-1\d\}/)
      // 圖說依目前的 pole 描述：ρ = 1 時 v₂ 分量不動
      const cap = String(lastPlot('pe-delta-plane').caption)
      expect(cap).toContain(String.raw`$p_{\text{fast}}=0$`)
      expect(cap).toContain(String.raw`$p_{\text{slow}}=1$`)
      expect(cap).toContain('到不了原點')
      expect(cap).not.toContain('爬回原點')
      expect(container.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
    },
    TIMEOUT,
  )

  it(
    '很接近 1 的 pole 不可顯示成「1」：preset pe-physical-kq 的慢 pole 在圖例與圖說都是 0.99996011（指標表 0.99996），沒有任何警告提到穩態抖動（√E[s_δ²] ≈ 0.0099）',
    async () => {
      const { container } = renderLab('/?preset=pe-physical-kq')
      await waitFor(() => expect(container.textContent).toMatch(/MC：32 chains × 1000 blocks/), WAIT)
      const modeNames = (lastPlot('pe-eigenmodes').data as { name?: string }[]).map((t) => t.name ?? '')
      expect(modeNames.some((n) => n.includes('（$p=0.99996011$）'))).toBe(true)
      expect(modeNames.some((n) => n.includes('（$p=0.992061$）'))).toBe(true)
      expect(modeNames.some((n) => n.includes('（$p=1$）'))).toBe(false)
      const cap = String(lastPlot('pe-delta-plane').caption)
      expect(cap).toContain(String.raw`$p_{\text{fast}}=0.992061$`)
      expect(cap).toContain(String.raw`$p_{\text{slow}}=0.99996011$`)
      expect(metricValue(container, String.raw`p_{\text{slow}}=1-g\lambda_{\min}`)).toBe('0.99996')
      // 這個 preset 本來就有的警告（k₉₅ = 75,091 超過 blocks 上限）還在；小訊號的兩則都不該出現
      const w = warningsText(container)
      expect(w).toContain(String.raw`k_{95}=75{,}091`)
      expect(w).not.toContain('穩態抖動')
      expect(w).not.toContain('最慢的反而是它')
    },
    TIMEOUT,
  )

  it(
    'C01：ρ = .5、g = 1.2（> g⋆ = 1）時提示最慢的是過衝的 λ_max 模式（14 個 block，不是慢模式的 4 個），「執行至收斂」拉到 ⌈1.25·14⌉ = 18；預設（g = .5）沒有這則提示',
    async () => {
      const { container } = renderLab('/')
      await waitFor(() => expect(container.textContent).toMatch(/MC：64 chains × 800 blocks/), WAIT)
      // 預設 ρ = .99、g = .5：沒有警告；圖說是原本的敘述
      expect(warningsText(container)).toBe('')
      const cap0 = String(lastPlot('pe-delta-plane').caption)
      expect(cap0).toContain(String.raw`$p_{\text{fast}}=0.005$`)
      expect(cap0).toContain(String.raw`$p_{\text{slow}}=0.995$`)
      expect(cap0).toContain(String.raw`$\mathbf v_1$ 分量一步就幾乎消掉（剩不到 5%），之後沿 $\mathbf v_2$ 慢慢爬回原點。`)

      setParam('ρ（兩個 regressor 的相關係數）', '0.5')
      setParam('g = μK_q（正規化 loop gain）', '1.2')
      await waitFor(() => expect(warningsText(container)).toContain('最慢的反而是它'), WAIT)
      const w = warningsText(container)
      expect(w).toContain(String.raw`g=1.2>g^\star=2/(\lambda_{\max}+\lambda_{\min})=1`)
      expect(w).toContain(String.raw`p_{\text{fast}}=-0.8`)
      expect(w).toContain(String.raw`|p_{\text{fast}}|=0.8>|p_{\text{slow}}|=0.4`)
      expect(w).toContain(String.raw`\lceil\ln0.05/\ln|p_{\text{fast}}|\rceil=14`)
      expect(w).toContain('「執行至收斂」也以它為準')
      expect(w).toContain('（F-09.7）')
      // 指標表的標籤與數字不變：k₉₅（慢模式）仍是 4
      expect(metricValue(container, 'k_{95}', '（慢模式）')).toBe('4')
      expect(String(lastPlot('pe-delta-plane').caption)).toContain('留得久')
      expect(String(lastPlot('pe-delta-plane').caption)).not.toContain('一步就幾乎消掉')

      // Case A / B / C 的表只看慢模式（欄名寫明）；某個 case 的 g > g⋆ 或發散時，表下方另外註明
      const caseNote = () => Array.from(container.querySelectorAll('p.ch09-note')).find((el) => el.textContent?.includes('表與圖只描述'))
      expect(caseNote()).toBeUndefined() // 預設三個 case 都是 ρ = .99、g = .5
      const kHead = Array.from(container.querySelectorAll('table.ch09-table th')).find((th) => th.textContent?.includes('k_{95}'))
      expect(kHead?.textContent).toContain('（慢模式）')
      setParam('Case A 的 ρ', '0.5')
      setParam('Case A 的 g = μK_q', '1.2')
      expect(caseNote()?.textContent).toContain(String.raw`g=1.2>g^\star=1`)
      expect(caseNote()?.textContent).toContain(String.raw`|p_{\text{fast}}|=0.8>|p_{\text{slow}}|=0.4`)
      expect(caseNote()?.textContent).toMatch(/整體要等 (14)+ 個 blocks/) // KaTeX 的 textContent 會重複數字（MathML＋HTML）
      setParam('Case A 的 g = μK_q', '2.2')
      expect(caseNote()?.textContent).toContain(String.raw`g=2.2\ge2/\lambda_{\max}=1.333`)
      expect(caseNote()?.textContent).toContain('平均遞迴不收斂')
      setParam('Case A 的 g = μK_q', '0.5')
      expect(caseNote()).toBeUndefined()

      // 執行至收斂：blocks 800 → 18（以前是慢模式的 ⌈1.25·4⌉ = 5 夾到下限 10）
      fireEvent.click(screen.getByRole('button', { name: /Run-to-Convergence/ }))
      await waitFor(() => expect(container.textContent).toMatch(/MC：64 chains × 18 blocks/), WAIT)
      expect((screen.getByLabelText('blocks') as HTMLInputElement).value).toBe('18')
      expect(container.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
    },
    TIMEOUT,
  )

  it(
    'R06a 後續：切到 1-bit（g = .5、N = 16）時警告「迴路自己的穩態抖動」√E[s_δ²] ≈ 0.303；N 加到 64 警告消失；linear detector 沒有這則警告',
    async () => {
      const { container } = renderLab('/')
      await waitFor(() => expect(container.textContent).toMatch(/MC：64 chains × 800 blocks/), WAIT)
      expect(warningsText(container)).not.toContain('穩態抖動')

      // 偵測器：linear → 1-bit（σ_v 自動設為 100 fs、g 保持 0.5）
      fireEvent.change(screen.getByLabelText('GMAC 前的偵測器'), { target: { value: '1' } })
      await waitFor(() => expect(warningsText(container)).toContain('迴路自己的穩態抖動'), WAIT)
      const w = warningsText(container)
      expect(w).toContain(String.raw`\sqrt{E[s_\delta^2]}\approx0.303`)
      expect(w).toContain(String.raw`s_\delta=\sqrt{\boldsymbol\delta^T\mathbf R\boldsymbol\delta}\big/\sigma_v`)
      expect(w).toContain('F-09.18')
      expect(w).toContain('請加大')
      // 初始誤差（1 fs 對 σ_v = 100 fs）很小：原本那則只看 δ₀ 的警告不會出現——這正是新警告要補的情形
      expect(w).not.toContain(String.raw`\sqrt{\boldsymbol\delta_0^T\mathbf R\boldsymbol\delta_0}`)

      setParam('N（GMAC block 長度）', '64')
      await waitFor(() => expect(warningsText(container)).not.toContain('穩態抖動'), WAIT)
      expect(container.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
    },
    TIMEOUT,
  )
})
