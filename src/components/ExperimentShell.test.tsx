import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ExperimentShell, finishSummary, type ExperimentShellProps } from './ExperimentShell'
import { downloadText } from './download'
import { usePlotRegistry } from './plotRegistry'
import { useEffect, useState } from 'react'

vi.mock('./download', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./download')>()
  return { ...orig, downloadText: vi.fn() }
})

const dl = vi.mocked(downloadText)

function base(overrides: Partial<ExperimentShellProps> = {}): ExperimentShellProps {
  return {
    id: 'lms-playground',
    title: 'LMS Playground',
    level: 'L0',
    claim: 'exact',
    tests: ['T01'],
    assumptions: ['固定 x = 2', 'v = 0（無雜訊）'],
    controls: <div>controls here</div>,
    children: <div>results here</div>,
    params: { a: 3, w0: 1, x: 2, mu: 0.1 },
    seed: 20261010,
    units: { a: '—', mu: '—' },
    ...overrides,
  }
}

beforeEach(() => dl.mockClear())

describe('ExperimentShell', () => {
  it('標題、模型層級、結論標籤、來源（預設 illustrative）與 TestBadge', () => {
    render(<ExperimentShell {...base()} />)
    expect(screen.getByRole('heading', { name: 'LMS Playground' })).toBeTruthy()
    expect(screen.getByText('模型 L0')).toBeTruthy()
    expect(screen.getByText('精確｜指定模型')).toBeTruthy()
    expect(screen.getByText('Illustrative 示例')).toBeTruthy()
    expect(document.querySelector('.c-test')?.textContent).toContain('T01')
    expect(screen.getByText('controls here')).toBeTruthy()
    expect(screen.getByText('results here')).toBeTruthy()
    expect(screen.getByText('固定 x = 2')).toBeTruthy()
  })

  it('只顯示有提供的動作；Freeze 為切換鈕；running 時停用 Step', () => {
    const onReset = vi.fn()
    const onFreeze = vi.fn()
    const { rerender } = render(<ExperimentShell {...base({ actions: { onReset, onStep: vi.fn(), onFreeze, frozen: false } })} />)
    expect(screen.getByText('重設 Reset')).toBeTruthy()
    expect(screen.queryByText('執行 Run')).toBeNull()
    expect(screen.queryByText(/執行至收斂/)).toBeNull()
    const freeze = screen.getByText('凍結 Freeze')
    expect(freeze.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(freeze)
    expect(onFreeze).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('重設 Reset'))
    expect(onReset).toHaveBeenCalledTimes(1)

    rerender(
      <ExperimentShell {...base({ actions: { onReset, onStep: vi.fn(), onRun: vi.fn(), onFreeze, frozen: true, running: true } })} />,
    )
    expect(screen.getByText('已凍結 Frozen').getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByText('單步 Step') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('執行中…')).toBeTruthy()
  })

  it('running 且提供 onStop 時 Run 變成停止鈕', () => {
    const onStop = vi.fn()
    render(<ExperimentShell {...base({ actions: { onRun: vi.fn(), onStop, running: true } })} />)
    fireEvent.click(screen.getByText('停止 Stop'))
    expect(onStop).toHaveBeenCalled()
  })

  it('警告以 danger callout（role=alert）顯示', () => {
    render(<ExperimentShell {...base({ warnings: ['C ≤ 0：更新極性錯誤（polarity），正學習率會發散'] })} />)
    const alerts = screen.getAllByRole('alert')
    expect(alerts.some((a) => a.textContent?.includes('polarity'))).toBe(true)
  })

  it('交叉比對未提供時三項都顯示 Not implemented', () => {
    render(<ExperimentShell {...base()} />)
    const row = screen.getByLabelText('交叉比對')
    expect(within(row).getAllByText('Not implemented')).toHaveLength(3)
    expect(within(row).getByText('Analytic')).toBeTruthy()
    expect(within(row).getByText('Monte Carlo')).toBeTruthy()
    expect(within(row).getByText('Fixed-Point')).toBeTruthy()
  })

  it('交叉比對狀態 ok / mismatch / n/a', () => {
    render(<ExperimentShell {...base({ crossCheck: { analytic: 'ok', monteCarlo: { status: 'mismatch', note: '超出 99% CI' }, fixedPoint: 'n/a' } })} />)
    expect(screen.getByText('✓ 一致（ok）')).toBeTruthy()
    expect(screen.getByText('✗ 不一致（mismatch）')).toBeTruthy()
    expect(screen.getByText('超出 99% CI')).toBeTruthy()
    expect(screen.getByText('n/a')).toBeTruthy()
  })

  it('seed 輸入與「隨機新 seed」', () => {
    const onSeedChange = vi.fn()
    render(<ExperimentShell {...base({ onSeedChange })} />)
    const input = screen.getByLabelText('seed') as HTMLInputElement
    expect(input.value).toBe('20261010')
    fireEvent.change(input, { target: { value: '42' } })
    expect(onSeedChange).toHaveBeenLastCalledWith(42)
    fireEvent.change(input, { target: { value: '-1' } })
    expect(onSeedChange).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/seed 必須是/)).toBeTruthy()
    fireEvent.click(screen.getByText('隨機新 seed'))
    const s = onSeedChange.mock.calls[1][0] as number
    expect(Number.isInteger(s) && s >= 0 && s <= 0xffffffff).toBe(true)
  })

  it('presets 下拉選單', () => {
    const onLoadPreset = vi.fn()
    const presets = [
      { name: '手算例子 w0=1, a=3, x=2, μ=0.1', params: { a: 3, w0: 1, x: 2, mu: 0.1 } },
      { name: '發散 μ=1', params: { a: 3, w0: 1, x: 2, mu: 1 } },
    ]
    render(<ExperimentShell {...base({ presets, onLoadPreset })} />)
    fireEvent.change(screen.getByLabelText('Preset'), { target: { value: '1' } })
    expect(onLoadPreset).toHaveBeenCalledWith(presets[1])
  })

  it('模擬條件摘要包含參數、seed、版本', () => {
    render(<ExperimentShell {...base()} />)
    const details = screen.getByText('模擬條件摘要').closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    const pre = details.querySelector('pre')!
    const json = JSON.parse(pre.textContent!)
    expect(json.params).toEqual({ a: 3, w0: 1, x: 2, mu: 0.1 })
    expect(json.seed).toBe(20261010)
    expect(typeof json.app_version).toBe('string')
    expect(typeof json.git_commit).toBe('string')
  })

  it('下載 JSON：內容含 seed / 版本 / 假設', () => {
    render(<ExperimentShell {...base({ metrics: [{ name: 'w_2', value: 2.28, analytic: 2.28, tolerance: 1e-12 }] })} />)
    fireEvent.click(screen.getByText('下載 JSON'))
    expect(dl).toHaveBeenCalledTimes(1)
    const [filename, mime, text] = dl.mock.calls[0]
    expect(filename).toMatch(/^lms-playground-\d{8}-\d{6}\.json$/)
    expect(mime).toBe('application/json')
    const payload = JSON.parse(text)
    expect(payload.seed).toBe(20261010)
    expect(payload.app_version).toBeTruthy()
    expect(payload.git_commit).toBeTruthy()
    expect(payload.assumptions).toEqual(['固定 x = 2', 'v = 0（無雜訊）'])
    expect(payload.metrics).toEqual({ w_2: 2.28 })
    expect(new Date(payload.generated_at).toISOString()).toBe(payload.generated_at)
  })

  it('下載 CSV：長度不同的欄位以空白補齊；exportData 丟錯時顯示訊息', () => {
    const { rerender } = render(<ExperimentShell {...base({ exportData: () => ({ k: [0, 1, 2], w: [1, 1.8] }) })} />)
    fireEvent.click(screen.getByText('下載 CSV'))
    expect(dl.mock.calls[0][2]).toBe('k,w\n0,1\n1,1.8\n2,')
    expect(dl.mock.calls[0][3]).toEqual({ bom: true })

    rerender(
      <ExperimentShell
        {...base({
          exportData: () => {
            throw new Error('尚未執行模擬')
          },
        })}
      />,
    )
    fireEvent.click(screen.getByText('下載 CSV'))
    expect(document.querySelector('.c-exp-export .c-param-warn')?.textContent).toMatch(/資料匯出失敗：尚未執行模擬/)
    // 匯出錯誤也會透過 live 區播報
    expect(screen.getByTestId('exp-live').textContent).toMatch(/資料匯出失敗：尚未執行模擬/)
  })

  it('live 區播報：按下執行後「執行中」、running 變回 false 後播結束摘要（主要指標與警告數）；停止', async () => {
    const actions = { onRun: vi.fn(), onStop: vi.fn(), running: false }
    const { rerender } = render(<ExperimentShell {...base({ actions })} />)
    const live = screen.getByTestId('exp-live')
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(live.textContent).toBe('')
    // 自動執行（running 自己變 true，沒有人按鈕）不播報
    rerender(<ExperimentShell {...base({ actions: { ...actions, running: true } })} />)
    rerender(<ExperimentShell {...base({ actions, metrics: [{ name: 'n', value: 1 }] })} />)
    await new Promise((r) => setTimeout(r, 10))
    expect(live.textContent).toBe('')
    fireEvent.click(screen.getByText('執行 Run'))
    expect(actions.onRun).toHaveBeenCalledTimes(1)
    expect(live.textContent).toBe('模擬執行中')
    rerender(<ExperimentShell {...base({ actions: { ...actions, running: true } })} />)
    await new Promise((r) => setTimeout(r, 10))
    expect(live.textContent).toBe('模擬執行中')
    rerender(
      <ExperimentShell
        {...base({
          actions,
          metrics: [
            { name: 'misses', value: null },
            { name: '$w_2$', value: 2.28, unit: '$\\mathrm{fs}$', analytic: 2.28, tolerance: 1e-12 },
          ],
          warnings: ['C ≤ 0'],
        })}
      />,
    )
    await waitFor(() => expect(live.textContent).toBe('模擬完成：1 個指標已更新；1 則警告'))
    // 沒有指標與警告時只說「模擬完成」
    fireEvent.click(screen.getByText('執行 Run'))
    rerender(<ExperimentShell {...base({ actions: { ...actions, running: true } })} />)
    rerender(<ExperimentShell {...base({ actions })} />)
    await waitFor(() => expect(live.textContent).toBe('模擬完成'))
    // 停止
    fireEvent.click(screen.getByText('執行 Run'))
    rerender(<ExperimentShell {...base({ actions: { ...actions, running: true } })} />)
    fireEvent.click(screen.getByText('停止 Stop'))
    expect(actions.onStop).toHaveBeenCalledTimes(1)
    expect(live.textContent).toBe('模擬已停止')
    rerender(<ExperimentShell {...base({ actions })} />)
    await new Promise((r) => setTimeout(r, 10))
    expect(live.textContent).toBe('模擬已停止')
    // 播報文字是純文字（不含 $、反斜線與 HTML）
    expect(finishSummary([{ name: '$\\sigma_v$', value: 0.5, unit: '$\\mathrm{fs}$' }], [])).toBe('模擬完成：1 個指標已更新')
    expect(finishSummary([{ name: 'n', value: 'Not implemented' }], ['a', 'b'])).toBe('模擬完成；2 則警告')
  })

  it('同步算完的實驗（沒給 running）：按執行後下一次 render 就播結束摘要；單步只播摘要', async () => {
    function SyncExp() {
      const [n, setN] = useState(0)
      return <ExperimentShell {...base({ actions: { onRun: () => setN((k) => k + 1), onStep: () => setN((k) => k + 1) }, metrics: [{ name: 'steps', value: n }] })} />
    }
    render(<SyncExp />)
    const live = screen.getByTestId('exp-live')
    fireEvent.click(screen.getByText('執行 Run'))
    await waitFor(() => expect(live.textContent).toBe('模擬完成：1 個指標已更新'))
    fireEvent.click(screen.getByText('單步 Step'))
    await waitFor(() => expect(live.textContent).toBe('模擬完成：1 個指標已更新'))
  })

  it('模擬條件 JSON 太長時可聚焦捲動（ScrollRegion）', () => {
    const params = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, i]))
    render(<ExperimentShell {...base({ params })} />)
    const details = screen.getByText('模擬條件摘要').closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    const pre = details.querySelector('pre.c-exp-json')!
    expect(pre.className).toContain('c-scroll')
    expect(pre.className).not.toContain('is-full')
  })

  it('沒有 exportData 時不顯示「下載 CSV」', () => {
    render(<ExperimentShell {...base()} />)
    expect(screen.queryByText('下載 CSV')).toBeNull()
  })

  it('下載 HTML 報告：收集已註冊圖表的 PNG 並跳脫文字', async () => {
    function FakePlot() {
      const reg = usePlotRegistry()
      useEffect(
        () =>
          reg?.register({
            title: () => 'w_k 收斂曲線',
            element: () => null,
            capture: async () => 'data:image/png;base64,iVBORw0KGgo=',
          }),
        [reg],
      )
      return null
    }
    render(
      <ExperimentShell {...base({ title: 'Lab <script>x</script>', exportData: () => ({ k: [0, 1] }) })}>
        <FakePlot />
      </ExperimentShell>,
    )
    fireEvent.click(screen.getByText('下載 HTML 報告'))
    await waitFor(() => expect(dl).toHaveBeenCalledTimes(1))
    const [filename, mime, html] = dl.mock.calls[0]
    expect(filename).toMatch(/-report\.html$/)
    expect(mime).toBe('text/html')
    expect(html).toContain('<img src="data:image/png;base64,iVBORw0KGgo="')
    expect(html).toContain('w_k 收斂曲線')
    expect(html).not.toContain('<script>x')
    expect(html).toContain('Lab &lt;script&gt;x&lt;/script&gt;')
    expect(html).toContain('固定 x = 2')
  })
})
