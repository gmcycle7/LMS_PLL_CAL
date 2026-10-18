/**
 * Ch04 整頁（jsdom）測試的第二個檔案：React StrictMode 與實驗互動。
 * 和 ch04.test.tsx 分開是為了記憶體：每渲染一次整頁，worker 的 heap 會多留數百 MB，七次整頁渲染放在同一個 worker 會撞到 4 GB 的上限
 * （JavaScript heap out of memory）；分成兩個檔案後各用一個 worker。共用的輔助函式在 pageTestUtils.tsx。
 */
import { act, cleanup, waitFor, within } from '@testing-library/react'
import { PAGE_TIMEOUT, WAIT, caseButtons, proseText, renderAt, shellOf, texText } from './pageTestUtils'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: P }))
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })),
  },
}))

afterEach(() => {
  // 先卸載頁面，再清掉 Plotly mock 的呼叫紀錄（紀錄裡的圖節點連著整頁的 DOM；Plot 卸載時呼叫的 Plotly.purge(gd) 也會被記下來）
  cleanup()
  localStorage.clear()
  for (const m of [P.react, P.purge, P.toImage, P.downloadImage, P.Plots.resize]) m.mockClear()
})

describe('Ch04 在 React StrictMode（dev server）下', () => {
  it('反面測試：effect 連跑兩次時 preset 的 case 不會重複加入——預設 gmac-fixed-point 只有 A/B，不會多出 Case C', async () => {
    const { container } = renderAt('/ch/04', true)
    await waitFor(() => expect(caseButtons(container, 'gmac-fixed-point').length).toBeGreaterThanOrEqual(2), WAIT)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })
    expect(caseButtons(container, 'gmac-fixed-point').map((b) => b.textContent?.trim())).toEqual(['Case A', 'Case B'])
    expect(caseButtons(container, 'gmac-signal-flow').map((b) => b.textContent?.trim())).toEqual(['Case A'])
  }, PAGE_TIMEOUT)

  it('?preset=gmac-fp-negate-bug（2 個 case）：載入後剛好是 A（正確取負）與 B（取負 bug），不會被預設的 case 蓋掉', async () => {
    const { container } = renderAt('/ch/04?preset=gmac-fp-negate-bug', true)
    await waitFor(() => expect(caseButtons(container, 'gmac-fixed-point').length).toBeGreaterThanOrEqual(2), WAIT)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })
    expect(caseButtons(container, 'gmac-fixed-point').map((b) => b.textContent?.trim())).toEqual(['Case A', 'Case B'])
    // 共用參數與 case 參數都來自 preset：full range code、B_acc = 17、B 為 inplace 取負
    const shell = container.querySelector('#exp-gmac-fixed-point')!
    await waitFor(() => expect(texText(shell)).toMatch(/B_\\mathrm\{acc\}=17，取負 bug/), WAIT)
    expect(texText(shell)).toContain('full range（含 -2^{B_x-1}）')
  }, PAGE_TIMEOUT)
})

describe('Ch04 實驗互動（jsdom）', () => {
  it('gmac-signal-flow（300 ms／步的動畫）：Run 鈕顯示步數進度；「跳到結尾」把游標放到最後一個 block 的最後一步，進度滿、鈕停用', async () => {
    const { container } = renderAt('/ch/04')
    const shell = shellOf(container, 'gmac-signal-flow')
    await waitFor(() => expect(within(shell).getByText('執行 Run').textContent).toMatch(/（0\/\d+ 步）/), WAIT)
    const skip = within(shell).getByText('跳到結尾') as HTMLButtonElement
    expect(skip.disabled).toBe(false)
    act(() => skip.click())
    await waitFor(() => expect(skip.disabled).toBe(true), WAIT)
    const m = /（(\d+)\/(\d+) 步）/.exec(within(shell).getByText('執行 Run').textContent ?? '')
    expect(m).not.toBeNull()
    expect(m![1]).toBe(m![2])
    expect(Number(m![2])).toBeGreaterThan(100)
  }, PAGE_TIMEOUT)

  it('?preset=gmac-fp-w-truncation：三個 case；切到 B 顯示 W 截斷的警告、R 與 F-04.18 的預測，Fixed-Point 交叉比對一致', async () => {
    const { container } = renderAt('/ch/04?preset=gmac-fp-w-truncation')
    await waitFor(() => expect(caseButtons(container, 'gmac-fixed-point').map((b) => b.textContent?.trim())).toEqual(['Case A', 'Case B', 'Case C']), WAIT)
    act(() => caseButtons(container, 'gmac-fixed-point')[1].click())
    const shell = container.querySelector('#exp-gmac-fixed-point')!
    await waitFor(() => expect(texText(shell)).toContain('取整到 W 的 LSB \\Delta_W=0.1563\\,\\mathrm{fs}（R=\\Delta_W/(\\mu\\Delta_G)=8）'), WAIT)
    expect(texText(shell)).toContain('\\Rightarrow w^*-a\\approx\\bar\\varepsilon_W\\Delta_W/g=-2.653\\,\\mathrm{fs}（F-04.18）')
    expect(shell.textContent).not.toMatch(/Δ_W = |ε̄_W|w\* − a/) // 模型原本的 Unicode 寫法不再出現
    expect(texText(shell)).toContain('Case B：R=\\Delta_W/(\\mu\\Delta_G)、\\mu\\sigma_G/\\Delta_W')
    expect(texText(shell)).toMatch(/Case B：w_\\mathrm\{fixed\}-w_\\mathrm\{float\}=-2\.578\\pm0\.0716\\,\\mathrm\{fs\}（AR\(1\) SE），預測（\\div N rounding 0 \+ W 取整 -2\.653）=-2\.653\\,\\mathrm\{fs\}/)
    expect(shell.querySelector('.katex-error, .c-tex-error')).toBeNull()
    expect(proseText(shell)).not.toContain('$')
    // 舊 preset（case 沒有 wLsb / wRounding 欄位）載入後，控制項拿到的是預設值而不是 undefined
    const lsb = Array.from(shell.querySelectorAll('input')).find((i) => /Δ_W（W 的 LSB/.test(i.getAttribute('aria-label') ?? ''))
    expect(lsb).toBeTruthy()
    expect((lsb as HTMLInputElement).value).not.toMatch(/NaN|undefined/)
  }, PAGE_TIMEOUT)


  it('gmac-fixed-point：打開 Monte Carlo 開關後顯示多 seed 結果；gmac-bit-encoding 的 Monte Carlo 自動執行', async () => {
    const { container } = renderAt()
    const enc = shellOf(container, 'gmac-bit-encoding')
    const fp = shellOf(container, 'gmac-fixed-point')
    await waitFor(() => expect(texText(enc)).toContain('bug：Monte Carlo 平均 w（6 seeds）'), WAIT)
    const sw = within(fp).getByRole('switch', { name: /Monte Carlo（目前 case 另跑 6 seeds/ })
    act(() => sw.click())
    await waitFor(() => expect(texText(fp)).toMatch(/Case A：Monte Carlo w_\\mathrm\{fixed\}-w_\\mathrm\{float\}（6 seeds）/), WAIT)
    expect(container.querySelector('.katex-error, .c-tex-error')).toBeNull()
  }, PAGE_TIMEOUT)
})
