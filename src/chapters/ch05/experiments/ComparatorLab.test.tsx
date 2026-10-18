import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { plotMath } from '@/components'
import { allChartStrings, chartStringProblems } from '../chartStrings.testutil'
import { ComparatorLab } from './ComparatorLab'

// 多個 agent／開發者同時跑測試時 CPU 會嚴重超額（load average 曾達數百），jsdom 渲染與 Monte Carlo 比平常慢一到兩個數量級：
// 放寬的只是「等待時間」（waitFor 與每個測試的上限），不是任何數值判準。
configure({ asyncUtilTimeout: 120_000 })
vi.setConfig({ testTimeout: 600_000 })
const SLOW = 600_000

interface Trace {
  name?: string
  type?: string
  x?: ArrayLike<number>
  y?: ArrayLike<number>
  opacity?: number
}

const P = vi.hoisted(() => ({
  react: vi.fn(async (..._args: unknown[]) => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: P }))

// 圖內文字（軸標題、圖例名稱、註記）的數學一律寫 `$...$`：<Plot> 先套用 applyPlotMath 再交給 Plotly，
// 所以在轉換前記下作者寫的字串（chartStrings.testutil.ts），Plotly.react 看到的則是轉換後的 pseudo-HTML。
const plotCalls = vi.hoisted(() => [] as { data: unknown; layout: unknown }[])
vi.mock('@/components/plotMath', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/plotMath')>()
  return {
    ...actual,
    applyPlotMath: (data: unknown, layout: unknown) => {
      plotCalls.push({ data, layout })
      return actual.applyPlotMath(data, layout)
    },
  }
})

/** 最近一次送進 Plotly.react、且含有符合條件的 trace 的那張圖。 */
function lastPlotWith(pred: (t: Trace) => boolean): Trace[] | undefined {
  for (let i = P.react.mock.calls.length - 1; i >= 0; i--) {
    const data = P.react.mock.calls[i][1] as Trace[]
    if (Array.isArray(data) && data.some(pred)) return data
  }
  return undefined
}

function renderLab(url = '/ch/05') {
  try {
    localStorage.setItem('lmspll.mode', 'engineer')
  } catch {
    /* ignore */
  }
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <ComparatorLab />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

const done = (container: HTMLElement) => waitFor(() => expect(container.textContent).toContain('Monte Carlo 完成'))

describe('Comparator Lab（互動）', () => {
  beforeEach(() => {
    P.react.mockClear()
    plotCalls.length = 0
  })

  it('T05: histogram 的三條資料（MC／精確 Binomial／CLT）來自同一組參數；切到 average 尺度後橫軸縮小 N 倍（E18）', async () => {
    const errSpy = vi.spyOn(console, 'error')
    const { container } = renderLab()
    await done(container)
    await waitFor(() => expect(lastPlotWith((t) => t.type === 'bar')).toBeTruthy())
    const hist = lastPlotWith((t) => t.type === 'bar')!
    const [bar, exact, clt] = hist
    // 個數加總 = trials；精確期望個數加總 ≈ trials（±4.5σ 外的質量 < 1e-5）
    const total = Array.from(bar.y!).reduce((x, y) => x + y, 0)
    expect(total).toBeGreaterThan(3990)
    expect(total).toBeLessThanOrEqual(4000)
    expect(Array.from(exact.y!).reduce((x, y) => x + y, 0)).toBeCloseTo(4000, 0)
    // sum 尺度：S_N 的中心在 E[S_N] ≈ 79.8、寬度 ~ ±450
    const xs = Array.from(bar.x!)
    expect(Math.max(...xs)).toBeGreaterThan(300)
    // CLT 曲線的峰值位置 ≈ N m
    const cy = Array.from(clt.y!)
    const peakX = Array.from(clt.x!)[cy.indexOf(Math.max(...cy))]
    expect(Math.abs(peakX - 79.8)).toBeLessThan(5)

    // 切到 average：G = S_N/N，橫軸 |x| ≤ 1
    // SelectControl 的 DOM value 是選項索引：0 = sum、1 = average
    fireEvent.change(screen.getByLabelText(/累加量的尺度/), { target: { value: '1' } })
    await waitFor(() => {
      const h = lastPlotWith((t) => t.type === 'bar')!
      expect(Math.max(...Array.from(h[0].x!).map(Math.abs))).toBeLessThan(1)
    })
    const avg = lastPlotWith((t) => t.type === 'bar')!
    const ratio = Math.max(...xs) / Math.max(...Array.from(avg[0].x!))
    expect(ratio).toBeCloseTo(10001, 6) // 差 N 倍
    // 圖內數學：sum／average 兩種橫軸標題都是 LaTeX，轉成斜體符號與真正的上下標後交給 Plotly（沒有殘留的 $、反斜線、大括號）
    const strings = allChartStrings(plotCalls)
    expect(strings).toContain(String.raw`$S_N = \sum q_i$`)
    expect(strings).toContain('$G = S_N / N$')
    expect(plotMath(String.raw`$S_N = \sum q_i$`)).toBe('<i>S</i><sub><i>N</i></sub> = Σ<i>q</i><sub><i>i</i></sub>')
    expect(plotMath('$G = S_N / N$')).toBe('<i>G</i> = <i>S</i><sub><i>N</i></sub>/<i>N</i>')
    const axisTitles = P.react.mock.calls.map((c) => ((c[2] as { xaxis?: { title?: { text?: string } } } | undefined)?.xaxis?.title?.text ?? ''))
    expect(axisTitles).toContain(plotMath('$G = S_N / N$'))
    expect(axisTitles.filter((t) => /[$\\{}]/.test(t))).toEqual([])
    // 六張圖的軸標題、圖例名稱、註記：數學都在成對的 $...$ 裡，公式以外沒有 Unicode 拼的數學
    expect(chartStringProblems(plotCalls)).toEqual([])
    for (const s of ['$e = s + v$ 的 PDF', '$E[q]$ vs $s$', '$K_q$ 切線', '精確（奇數 $N$）', '$E[G] = m$', '$P(\\text{判對})$']) {
      expect(strings.some((t) => t.includes(s)), s).toBe(true)
    }
    const real = errSpy.mock.calls.map((c) => String(c[0])).filter((m) => !/not wrapped in act/.test(m))
    expect(real).toEqual([])
    errSpy.mockRestore()
  }, SLOW)

  it('Single Step 一次累加一個 comparator sample；播放按鈕可啟動動畫（規格 §5「動畫顯示每個 q_i 累加」）', async () => {
    const { container } = renderLab()
    await done(container)
    const isPath = (t: Trace) => (t.name ?? '').startsWith('第 1 個 trial')
    await waitFor(() => expect(lastPlotWith(isPath)).toBeTruthy())
    const full = lastPlotWith(isPath)!.find(isPath)!
    expect(full.x!.length).toBe(4000) // pathLength 上限
    const step = screen.getByRole('button', { name: /單步 Step/ })
    fireEvent.click(step)
    await waitFor(() => expect(lastPlotWith(isPath)!.find(isPath)!.x!.length).toBe(1))
    const first = lastPlotWith(isPath)!.find(isPath)!
    expect(Math.abs(Array.from(first.y!)[0])).toBe(1) // S_1 = ±1
    fireEvent.click(step)
    await waitFor(() => expect(lastPlotWith(isPath)!.find(isPath)!.x!.length).toBe(2))
    const second = Array.from(lastPlotWith(isPath)!.find(isPath)!.y!)
    expect([-2, 0, 2]).toContain(second[1]) // S_2 ∈ {−2, 0, +2}
    // 信賴帶始終涵蓋完整的 n 範圍
    const band = lastPlotWith(isPath)!.find((t) => (t.name ?? '').includes('帶'))!
    expect(band.x!.length).toBe(4000)
    fireEvent.click(screen.getByRole('button', { name: /播放累加過程/ }))
    await waitFor(() => expect(lastPlotWith(isPath)!.find(isPath)!.x!.length).toBeGreaterThan(50))
  }, SLOW)

  it('新增 Case B 並改成 sign(0) = +1：P(判對) vs N 圖同時畫出兩組曲線；偶數 N 的說明反映目前的 rule', async () => {
    const { container } = renderLab('/ch/05?preset=comparator-even-n100-tie')
    await done(container)
    fireEvent.click(screen.getByRole('button', { name: /新增比較組/ }))
    const rule = await screen.findByLabelText(/tie rule（S_N = 0）— Case B/)
    fireEvent.change(rule, { target: { value: '2' } }) // 選項索引：strict / half / plus / skip
    await waitFor(() => expect(container.textContent).toContain(' 精確（plus）'))
    // 圖例名稱的數學是 LaTeX（`$N$`）：Plotly 看到的是轉換後的斜體 N
    const nameB = plotMath('B 精確（偶數 $N$，plus）')
    const nameA = plotMath('A 精確（偶數 $N$，strict）')
    expect(nameB).toBe('B 精確（偶數 <i>N</i>，plus）')
    await waitFor(() => {
      const pn = lastPlotWith((t) => (t.name ?? '').startsWith(nameB))
      expect(pn).toBeTruthy()
      expect(pn!.some((t) => (t.name ?? '').startsWith(nameA))).toBe(true)
    })
    // N = 100：Case B（plus）的偶數曲線在 N = 100 的值 = 57.14%，Case A（strict）= 49.20%
    const pn = lastPlotWith((t) => (t.name ?? '').startsWith(nameB))!
    const at100 = (name: string) => {
      const t = pn.find((x) => (x.name ?? '').startsWith(name))!
      return Array.from(t.y!)[Array.from(t.x!).indexOf(100)]
    }
    expect(at100(nameB)).toBeCloseTo(0.5714, 4)
    expect(at100(nameA)).toBeCloseTo(0.4920, 4)
    await waitFor(() => expect(container.textContent).toMatch(/依 sign\(0\) = \+1：tie 判 \+1：判對 57\.139%/))
    await done(container)
    expect(container.textContent).not.toContain('Monte Carlo 與精確值不一致')
  }, SLOW)

  it('失敗模式會解釋原因：θ 蓋過 s 時出現 offset 警告；σ_v = 0 時出現 hard-limiter 警告且 MC 交叉比對仍為 ok', async () => {
    const { container } = renderLab('/ch/05?preset=comparator-offset-beats-error')
    await waitFor(() => expect(container.textContent).toContain('Offset 蓋過誤差'))
    await done(container)
    expect(container.textContent).toContain('到不了（E[q] 朝錯誤方向或為 0）')
    // 重設回預設，再把 σ_v 設成 0
    fireEvent.click(screen.getByRole('button', { name: /重設 Reset/ }))
    await waitFor(() => expect(container.textContent).not.toContain('Offset 蓋過誤差'))
    const sigma = screen.getByLabelText(/σ_v（雜訊 RMS）— Case A$/) as HTMLInputElement
    await act(async () => {
      fireEvent.change(sigma, { target: { value: '0' } })
      fireEvent.blur(sigma)
    })
    await waitFor(() => expect(container.textContent).toContain('hard limiter'))
    await waitFor(() => expect(container.textContent).toMatch(/判對 4000\/4000（接受域 \[4000, 4000\]）/))
    expect(container.textContent).not.toContain('Monte Carlo 與精確值不一致')
  }, SLOW)
})
