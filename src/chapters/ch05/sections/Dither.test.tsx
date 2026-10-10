import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { DitherSection } from './Dither'

// 多個 agent／開發者同時跑測試時 CPU 會嚴重超額（load average 曾達數百），jsdom 渲染與 Monte Carlo 比平常慢一到兩個數量級：
// 放寬的只是「等待時間」（waitFor 與每個測試的上限），不是任何數值判準。
configure({ asyncUtilTimeout: 120_000 })
vi.setConfig({ testTimeout: 600_000 })
const SLOW = 600_000

interface Trace {
  name?: string
  x?: ArrayLike<number>
  y?: ArrayLike<number>
}

const P = vi.hoisted(() => ({
  react: vi.fn(async (..._args: unknown[]) => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))

function lastPlotWith(pred: (t: Trace) => boolean): Trace[] | undefined {
  for (let i = P.react.mock.calls.length - 1; i >= 0; i--) {
    const data = P.react.mock.calls[i][1] as Trace[]
    if (Array.isArray(data) && data.some(pred)) return data
  }
  return undefined
}

/** 把 KaTeX 節點換回 `$tex$`，方便比對含公式的文字（警告、指標名稱等字串屬性裡的數學現在都以 KaTeX 顯示）。 */
function plainText(el: Element): string {
  const c = el.cloneNode(true) as Element
  c.querySelectorAll('.c-tex').forEach((k) => k.replaceWith(`$${k.querySelector('annotation')?.textContent ?? ''}$`))
  return c.textContent ?? ''
}

function renderDither(url = '/ch/05') {
  try {
    localStorage.setItem('lmspll.mode', 'engineer')
  } catch {
    /* ignore */
  }
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <DitherSection />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

describe('Dither 實驗（§7：雜訊像 dither）', () => {
  beforeEach(() => P.react.mockClear())

  it('預設 Case A/B/C（σ_v = 0 / 1 / 30 fs）：σ_v = 0 出現 limit-cycle 警告（偏差 0.15 fs），MC 與精確穩態一致', async () => {
    const errSpy = vi.spyOn(console, 'error')
    const { container } = renderDither()
    await waitFor(() => expect(container.textContent).toContain('Case C'))
    await waitFor(() => expect(container.textContent).toContain('Monte Carlo 完成（20000 步 × 3 個 Case'))
    expect(plainText(container)).toMatch(
      /Case A：\$\\sigma_v=0\$ → hard limiter，\$w\$ 在 \$1\$ 與 \$1\.5\\,\\mathrm\{fs\}\$ 之間形成 period-2 limit cycle；時間平均偏差 \$0\.15\\,\\mathrm\{fs\}\$/,
    )
    // 字串屬性（標題、假設、指標名稱、警告、圖標題）裡的 $...$ 都已轉成 KaTeX：畫面上不留下未轉換的 $，也沒有 KaTeX 錯誤
    expect(container.textContent).not.toContain('$')
    expect(container.querySelector('.katex-error, .c-tex-error')).toBeNull()
    expect(container.querySelector('.c-exp-title .katex')).toBeTruthy()
    expect(container.querySelectorAll('.c-exp-assumptions .katex').length).toBeGreaterThanOrEqual(4)
    expect(container.querySelectorAll('.c-metric-table td .katex').length).toBeGreaterThanOrEqual(5)
    const plotTitles = Array.from(container.querySelectorAll('.c-plot-title'))
    expect(plotTitles.length).toBe(4)
    for (const t of plotTitles) expect(t.querySelector('.katex'), t.textContent ?? '').toBeTruthy()
    expect(container.textContent).toContain('MC 時間平均落在解析值的容差內')
    // 精確穩態 π(w)：σ_v = 0 只有兩個支撐點、各 ½
    // Plot 在 passive effect 裡才呼叫 Plotly.react：文字出現後圖不一定已經送出，所以用 waitFor 等到那張圖
    const isPi = (t: Trace) => (t.name ?? '').includes('精確穩態 π(w)')
    await waitFor(() => expect(lastPlotWith(isPi)?.length).toBe(3))
    const pi = lastPlotWith(isPi)!
    const piA = pi.find((t) => (t.name ?? '').startsWith('A '))!
    expect(Array.from(piA.x!)).toEqual([1, 1.5])
    expect(Array.from(piA.y!)).toEqual([0.5, 0.5])
    // 軌跡圖：三個 Case 都從 w₀ = 0 出發（同一個 seed 的 paired comparison）
    const isTrajC = (t: Trace) => (t.name ?? '').startsWith('C：σ_v = 30 fs')
    await waitFor(() => expect(lastPlotWith(isTrajC)).toBeTruthy())
    const traj = lastPlotWith(isTrajC)!
    expect(traj.length).toBe(3)
    for (const t of traj) expect(Array.from(t.y!)[0]).toBe(0)
    // 表格：捨入誤差等級的精確偏差不顯示成有效數字
    expect(container.textContent).toContain('≈ 0（< 1e-9）')
    expect(container.textContent).not.toMatch(/\d\.\d+e-1[0-9]/)
    const real = errSpy.mock.calls.map((c) => String(c[0])).filter((m) => !/not wrapped in act/.test(m))
    expect(real).toEqual([])
    errSpy.mockRestore()
  }, SLOW)

  it('失敗模式會解釋原因：步數太短（< 20τ）時警告說明是模擬太短、不是模型錯誤', async () => {
    const { container } = renderDither()
    await waitFor(() => expect(container.textContent).toContain('Monte Carlo 完成（20000 步'))
    expect(container.textContent).not.toContain('後半段只涵蓋不到 10 個時間常數')
    const steps = screen.getByLabelText('步數') as HTMLInputElement
    await act(async () => {
      fireEvent.change(steps, { target: { value: '300' } })
      fireEvent.blur(steps)
    })
    // Case C：σ_v = 30 fs、μ = 0.5 fs ⇒ τ ≈ 1/(μK_q) ≈ 75 samples，20τ ≈ 1504 > 300
    await waitFor(() => expect(plainText(container)).toMatch(/Case C：步數 300 \$<20\\tau\$（\$\\tau\\approx1\/\(\\mu K_q\)\\approx75\$ samples）/))
    expect(container.textContent).toContain('這是模擬太短，不是模型錯誤')
    // Case B（σ_v = 1 fs：τ ≈ 2.5）不受影響
    expect(container.textContent).not.toMatch(/Case B：步數/)
  }, SLOW)

  it('URL preset ?preset=comparator-dither-tradeoff 會建立三個 Case 並套用 a、μ', async () => {
    const { container } = renderDither('/ch/05?preset=comparator-dither-tradeoff')
    await waitFor(() => expect(container.textContent).toContain('Case C'))
    await waitFor(() => expect(container.textContent).toContain('Monte Carlo 完成'))
    await waitFor(() => expect(lastPlotWith((t) => (t.name ?? '').startsWith('B：σ_v = 1 fs、μ = 0.5 fs'))).toBeTruthy())
  }, SLOW)
})
