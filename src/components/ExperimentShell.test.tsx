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

/* ===== 第二批：版面（sticky／分組收合）、手機（捲到結果、狀態列）、執行進度 ===== */
import {
  autoGroupCut,
  ControlGroup,
  CONTROL_COLLAPSE_THRESHOLD,
  DONE_STATUS_MS,
  PHONE_MEDIA_QUERY,
  progressText,
  shouldCollapseControls,
  shouldStickControls,
  STICKY_MIN_VIEWPORT_WIDTH,
} from './ExperimentShell'
import { act } from '@testing-library/react'

/** 假的 matchMedia：只有列在 matching 裡的 query 成立 */
function stubMatchMedia(matching: string[]) {
  const listeners = new Map<string, Set<() => void>>()
  const mm = vi.fn((query: string) => ({
    matches: matching.includes(query),
    media: query,
    addEventListener: (_: string, cb: () => void) => {
      if (!listeners.has(query)) listeners.set(query, new Set())
      listeners.get(query)!.add(cb)
    },
    removeEventListener: (_: string, cb: () => void) => listeners.get(query)?.delete(cb),
  }))
  vi.stubGlobal('matchMedia', mm)
  return mm
}

function fakeRect(el: Element, rect: Partial<DOMRect>) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}), ...rect }),
  })
}

const params = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => (
    <div className="c-param" key={from + i}>
      <label>
        p{from + i} <input type="range" aria-label={`p${from + i}`} />
      </label>
    </div>
  ))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ExperimentShell 版面規則（純函式）', () => {
  it('shouldStickControls：≥ 1100px、兩欄、整欄放得下才黏', () => {
    const base = { viewportWidth: 1280, viewportHeight: 900, columnHeight: 600, twoColumns: true }
    expect(shouldStickControls(base)).toBe(true)
    expect(shouldStickControls({ ...base, columnHeight: 824 })).toBe(true) // 824 + 52 + 24 = 900
    expect(shouldStickControls({ ...base, columnHeight: 825 })).toBe(false)
    expect(shouldStickControls({ ...base, viewportWidth: STICKY_MIN_VIEWPORT_WIDTH - 1 })).toBe(false)
    expect(shouldStickControls({ ...base, viewportWidth: STICKY_MIN_VIEWPORT_WIDTH })).toBe(true)
    expect(shouldStickControls({ ...base, twoColumns: false })).toBe(false)
    expect(shouldStickControls({ ...base, columnHeight: 0 })).toBe(false)
  })

  it('shouldCollapseControls：> 12 個才分組收合；autoGroupCut 在累積 ≥ 8 個控制項後切、後面沒控制項就不切', () => {
    expect(shouldCollapseControls(CONTROL_COLLAPSE_THRESHOLD)).toBe(false)
    expect(shouldCollapseControls(CONTROL_COLLAPSE_THRESHOLD + 1)).toBe(true)
    expect(autoGroupCut(Array(14).fill(1))).toBe(8)
    expect(autoGroupCut([0, 1, 4, 9, 2])).toBe(4) // p, select, group(4), group(9) → 累積 14 ≥ 8 於第 4 個；後面還有 2
    // 累積到 ≥ 8 時後面已沒有控制項 → 退回最後一個「前面 ≥ 1、後面 ≥ 1」的切點（章節自訂分組 div 的典型結構）
    expect(autoGroupCut([0, 1, 4, 9])).toBe(3) // ch06 polarity-explorer：p、select、group(4) 展開，group(9) 收合
    expect(autoGroupCut([0, 5, 0, 13])).toBe(3) // ch02 sign-lms-compare：fieldset(5) 展開，fieldset(13) 收合
    expect(autoGroupCut([3, 2, 2, 6])).toBe(3) // ch07 delay-fx-lab：7 個展開，最後一組 6 個收合
    expect(autoGroupCut([2, 22])).toBe(1)
    expect(autoGroupCut([13, 1])).toBe(1)
    expect(autoGroupCut([24])).toBeNull() // 整欄只有一個子節點：切不開
    expect(autoGroupCut([0, 0, 14])).toBeNull() // 前面只有沒控制項的節點：切了等於全部收起
    expect(autoGroupCut([1, 1, 1])).toBeNull() // 不到 8 個：不值得切（呼叫端本來就只在 > 12 時才切）
  })

  it('progressText：animate 預設「步」、compute 不加單位、可自訂', () => {
    expect(progressText({ done: 112, total: 408 }, 'animate')).toBe('112/408 步')
    expect(progressText({ done: 3, total: 9 })).toBe('3/9')
    expect(progressText({ done: 3, total: 9, unit: 'seeds' })).toBe('3/9 seeds')
  })
})

describe('ExperimentShell 控制欄：sticky 與分組收合', () => {
  it('≤ 12 個控制項：平鋪、沒有 details、沒有 data-collapsed', () => {
    render(<ExperimentShell {...base({ controls: <>{params(12)}</> })} />)
    const ctl = document.querySelector('.c-exp-controls')!
    expect(ctl.getAttribute('data-collapsed')).toBeNull()
    expect(ctl.querySelectorAll('details').length).toBe(0)
    expect(ctl.querySelectorAll('.c-param').length).toBe(12)
  })

  it('> 12 個平鋪控制項且沒有 ControlGroup：前 8 個展開、其餘收進「其餘參數（N 個）」（預設收合、可展開）', () => {
    render(<ExperimentShell {...base({ controls: <>{params(14)}</> })} />)
    const ctl = document.querySelector('.c-exp-controls')!
    expect(ctl.getAttribute('data-collapsed')).toBe('true')
    const details = ctl.querySelector('details.c-exp-group.is-auto') as HTMLDetailsElement
    expect(details).toBeTruthy()
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toBe('其餘參數（6 個）')
    expect(details.querySelectorAll('.c-param').length).toBe(6)
    // 前 8 個在 details 之前
    const flat = Array.from(ctl.children).filter((c) => c.matches('.c-param'))
    expect(flat.length).toBe(8)
    expect(flat[0].textContent).toContain('p0')
    // 所有控制項仍在 DOM、可查到
    expect(screen.getByLabelText('p13')).toBeTruthy()
    // 使用者展開後維持
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(details.open).toBe(true)
  })

  it('頂層子節點與 DOM 子節點對不上（元件渲染成多個節點）或整欄只有一個子節點時不自動切分', () => {
    // 巢狀 fragment 會被拆開：仍然切
    const { container, unmount } = render(
      <ExperimentShell
        {...base({
          controls: (
            <>
              <>{params(14)}</>
            </>
          ),
        })}
      />,
    )
    expect(container.querySelectorAll('details.is-auto').length).toBe(1)
    unmount()
    // 一個元件渲染出 14 個節點：React 頂層 1 個、DOM 14 個 → 對不上，不切
    const Many = () => <>{params(14)}</>
    const r2 = render(<ExperimentShell {...base({ id: 'many', controls: <Many /> })} />)
    let ctl = r2.container.querySelector('.c-exp-controls')!
    expect(ctl.getAttribute('data-collapsed')).toBe('true')
    expect(ctl.querySelectorAll('details').length).toBe(0)
    r2.unmount()
    // 整欄包在一個 div 裡（ch13 的寫法）：切點落在後面沒有控制項 → 不切
    const r3 = render(<ExperimentShell {...base({ id: 'wrapped', controls: <div className="chNN-controls">{params(14)}</div> })} />)
    ctl = r3.container.querySelector('.c-exp-controls')!
    expect(ctl.getAttribute('data-collapsed')).toBe('true')
    expect(ctl.querySelectorAll('details').length).toBe(0)
  })

  it('章節自訂分組 div（p、select、group(4)、group(9)）：前三個節點展開、最後一組收進「其餘參數（9 個）」', () => {
    render(
      <ExperimentShell
        {...base({
          controls: (
            <>
              <p className="small muted">目前編輯：Case A</p>
              {params(1)}
              <div className="chNN-controls-group">{params(4, 10)}</div>
              <div className="chNN-controls-group">{params(9, 20)}</div>
            </>
          ),
        })}
      />,
    )
    const ctl = document.querySelector('.c-exp-controls')!
    const details = ctl.querySelector('details.c-exp-group.is-auto') as HTMLDetailsElement
    expect(details).toBeTruthy()
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toBe('其餘參數（9 個）')
    expect(details.querySelectorAll('.c-param').length).toBe(9)
    expect(details.querySelector('.chNN-controls-group')).toBeTruthy() // 整個分組 div 原樣搬進去
    expect(Array.from(ctl.children).map((c) => c.tagName)).toEqual(['P', 'DIV', 'DIV', 'DETAILS'])
    expect(ctl.querySelectorAll(':scope > .c-param, :scope > div .c-param').length).toBe(5) // 展開的 5 個
  })

  it('章節自己已經用 <details> 收合的控制欄（例如 /lab）不再套一層「其餘參數」', () => {
    render(
      <ExperimentShell
        {...base({
          controls: (
            <>
              {params(1)}
              <details className="chNN-group" open>
                <summary>主要</summary>
                {params(13, 10)}
              </details>
            </>
          ),
        })}
      />,
    )
    const ctl = document.querySelector('.c-exp-controls')!
    expect(ctl.getAttribute('data-collapsed')).toBe('true')
    expect(ctl.querySelector('.is-auto')).toBeNull()
    expect(ctl.querySelectorAll('details').length).toBe(1)
  })

  it('自動切分後：切點前的控制項不會被重新掛載（輸入中的文字保留）；條件式控制項增減時「其餘參數」數量跟著更新', () => {
    function Exp({ extra }: { extra: number }) {
      return <ExperimentShell {...base({ controls: <>{params(14 + extra)}</> })} />
    }
    const { rerender } = render(<Exp extra={0} />)
    const first = screen.getByLabelText('p0') as HTMLInputElement
    first.value = '7'
    rerender(<Exp extra={2} />)
    expect(screen.getByLabelText('p0')).toBe(first) // 同一個 DOM 節點
    expect(document.querySelector('details.is-auto summary')?.textContent).toBe('其餘參數（8 個）')
  })

  it('ControlGroup：≤ 12 個時是帶小標題的區塊；> 12 個時每組一個 details，第一組展開、其餘收合', () => {
    const groups = (n: number) => (
      <>
        <ControlGroup title="主要參數 $\\mu$">{params(n)}</ControlGroup>
        <ControlGroup title="雜訊">{params(n, 100)}</ControlGroup>
        <ControlGroup title="進階" defaultOpen>
          {params(n, 200)}
        </ControlGroup>
      </>
    )
    const { rerender } = render(<ExperimentShell {...base({ controls: groups(4) })} />)
    let ctl = document.querySelector('.c-exp-controls')!
    expect(ctl.querySelectorAll('details').length).toBe(0)
    expect(ctl.querySelectorAll('.c-exp-group').length).toBe(3)
    expect(ctl.querySelector('.c-exp-group-title .katex')).toBeTruthy()
    expect(ctl.querySelector('.c-exp-group-title')?.textContent).toContain('主要參數')

    rerender(<ExperimentShell {...base({ controls: groups(5) })} />)
    ctl = document.querySelector('.c-exp-controls')!
    const details = Array.from(ctl.querySelectorAll<HTMLDetailsElement>('details.c-exp-group'))
    expect(details.length).toBe(3)
    expect(details.map((d) => d.open)).toEqual([true, false, true])
    expect(details[0].querySelector('summary')?.textContent).toContain('主要參數')
    expect(ctl.querySelector('.is-auto')).toBeNull() // 有明確分組就不自動切
    // 使用者收起第一組 → 維持
    details[0].open = false
    fireEvent(details[0], new Event('toggle'))
    rerender(<ExperimentShell {...base({ controls: groups(5) })} />)
    expect(details[0].open).toBe(false)
  })

  it('sticky：ResizeObserver 回報後，≥ 1100px、兩欄且放得下 → data-sticky；放不下就拿掉', () => {
    const callbacks: (() => void)[] = []
    vi.stubGlobal(
      'ResizeObserver',
      vi.fn(function (cb: () => void) {
        callbacks.push(cb)
        return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() }
      }),
    )
    stubMatchMedia([`(min-width: ${STICKY_MIN_VIEWPORT_WIDTH}px)`])
    vi.stubGlobal('innerWidth', 1280)
    vi.stubGlobal('innerHeight', 900)
    render(<ExperimentShell {...base()} />)
    const ctl = document.querySelector('.c-exp-controls')!
    const res = document.querySelector('.c-exp-results')!
    fakeRect(ctl, { left: 0, right: 300, height: 600 })
    fakeRect(res, { left: 320, right: 892, height: 2000 })
    act(() => callbacks.forEach((cb) => cb()))
    expect(ctl.getAttribute('data-sticky')).toBe('true')
    // 控制欄變高（放不下）→ 不黏
    fakeRect(ctl, { left: 0, right: 300, height: 1600 })
    act(() => callbacks.forEach((cb) => cb()))
    expect(ctl.getAttribute('data-sticky')).toBeNull()
    // 單欄（控制欄在結果欄上方）→ 不黏
    fakeRect(ctl, { left: 0, right: 892, height: 600 })
    fakeRect(res, { left: 0, right: 892, height: 2000 })
    act(() => callbacks.forEach((cb) => cb()))
    expect(ctl.getAttribute('data-sticky')).toBeNull()
  })
})

describe('ExperimentShell 執行進度與動畫', () => {
  it('running 而沒有 progress：不確定式進度條（沒有 aria-valuenow）；有 progress：確定式，執行鈕顯示 N/M', () => {
    const actions = { onRun: vi.fn(), onStop: vi.fn(), running: false }
    const { rerender } = render(<ExperimentShell {...base({ actions })} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
    rerender(<ExperimentShell {...base({ actions: { ...actions, running: true } })} />)
    let bar = screen.getByRole('progressbar')
    expect(bar.className).toContain('is-indeterminate')
    expect(bar.getAttribute('aria-valuenow')).toBeNull()
    rerender(<ExperimentShell {...base({ actions: { ...actions, running: true, progress: { done: 3, total: 9, unit: 'seeds' } } })} />)
    bar = screen.getByRole('progressbar')
    expect(bar.className).not.toContain('is-indeterminate')
    expect(bar.getAttribute('aria-valuenow')).toBe('3')
    expect(bar.getAttribute('aria-valuemax')).toBe('9')
    expect(bar.getAttribute('aria-valuetext')).toBe('3/9 seeds')
    expect((bar.firstElementChild as HTMLElement).style.width).toBe(`${(100 * 3) / 9}%`)
    expect(screen.getByText('停止 Stop').textContent).toContain('（3/9 seeds）')
    // compute 型：算完就不顯示進度條
    rerender(<ExperimentShell {...base({ actions: { ...actions, running: false, progress: { done: 9, total: 9 } } })} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it("runKind='animate'：「跳到結尾」鈕（到結尾時停用）、停下來也顯示第幾步；按下後播報結束摘要", async () => {
    const onSkipToEnd = vi.fn()
    const actions = { onRun: vi.fn(), onStop: vi.fn(), onSkipToEnd, runKind: 'animate' as const, running: false, progress: { done: 112, total: 408 } }
    const { rerender } = render(<ExperimentShell {...base({ actions, metrics: [{ name: 'w', value: 1 }] })} />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuetext')).toBe('112/408 步')
    const skip = screen.getByText('跳到結尾') as HTMLButtonElement
    expect(skip.disabled).toBe(false)
    fireEvent.click(skip)
    expect(onSkipToEnd).toHaveBeenCalledTimes(1)
    rerender(<ExperimentShell {...base({ actions: { ...actions, progress: { done: 408, total: 408 } }, metrics: [{ name: 'w', value: 1 }] })} />)
    await waitFor(() => expect(screen.getByTestId('exp-live').textContent).toBe('模擬完成：1 個指標已更新'))
    expect((screen.getByText('跳到結尾') as HTMLButtonElement).disabled).toBe(true)
    // 沒有 onSkipToEnd 或不是 animate 就沒有這顆鈕
    rerender(<ExperimentShell {...base({ actions: { onRun: vi.fn(), onSkipToEnd, running: false } })} />)
    expect(screen.queryByText('跳到結尾')).toBeNull()
  })

  it("runKind='animate'：還沒開始（0/N）只在執行鈕裡寫步數、不畫空的進度軌道；停在半路時軌道與步數都在；compute 型停下來就都不顯示", () => {
    const animate = { onRun: vi.fn(), onStop: vi.fn(), onSkipToEnd: vi.fn(), runKind: 'animate' as const, running: false }
    const { rerender } = render(<ExperimentShell {...base({ actions: { ...animate, progress: { done: 0, total: 408 } } })} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByText('執行 Run').textContent).toContain('（0/408 步）')
    expect((screen.getByText('跳到結尾') as HTMLButtonElement).disabled).toBe(false)

    rerender(<ExperimentShell {...base({ actions: { ...animate, progress: { done: 112, total: 408 } } })} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('112')
    expect(screen.getByText('執行 Run').textContent).toContain('（112/408 步）')

    rerender(<ExperimentShell {...base({ actions: { ...animate, running: true, progress: { done: 113, total: 408 } } })} />)
    expect(screen.getByText('停止 Stop').textContent).toContain('（113/408 步）')

    // compute 型：只有 running 時才顯示步數與進度條
    rerender(<ExperimentShell {...base({ actions: { onRun: vi.fn(), onStop: vi.fn(), running: false, progress: { done: 3, total: 9 } } })} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByText('執行 Run').textContent).toBe('執行 Run')
  })
})

describe('ExperimentShell 手機（< 760px）', () => {
  it('按執行 → 底部狀態列「執行中…」；完成 → 「完成」並把結果捲進畫面（reduced-motion 時 behavior auto）；一段時間後消失', async () => {
    vi.useFakeTimers()
    try {
      stubMatchMedia([PHONE_MEDIA_QUERY])
      const scrollIntoView = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoView
      const actions = { onRun: vi.fn(), onStop: vi.fn(), running: false }
      const { rerender } = render(<ExperimentShell {...base({ actions, metrics: [{ name: 'n', value: 1 }] })} />)
      expect(screen.queryByTestId('exp-status')).toBeNull()
      // 自動執行（沒按鈕）不顯示狀態列、不捲動
      rerender(<ExperimentShell {...base({ actions: { ...actions, running: true }, metrics: [{ name: 'n', value: 1 }] })} />)
      rerender(<ExperimentShell {...base({ actions, metrics: [{ name: 'n', value: 2 }] })} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20)
      })
      expect(screen.queryByTestId('exp-status')).toBeNull()
      expect(scrollIntoView).not.toHaveBeenCalled()

      fireEvent.click(screen.getByText('執行 Run'))
      expect(screen.getByTestId('exp-status').textContent).toContain('執行中…')
      expect(screen.getByTestId('exp-status').getAttribute('aria-hidden')).toBe('true')
      rerender(<ExperimentShell {...base({ actions: { ...actions, running: true, progress: { done: 1, total: 4 } }, metrics: [{ name: 'n', value: 2 }] })} />)
      expect(screen.getByTestId('exp-status').textContent).toContain('25%')
      rerender(<ExperimentShell {...base({ actions, metrics: [{ name: 'n', value: 3 }] })} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20)
      })
      expect(screen.getByTestId('exp-status').textContent).toBe('完成')
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView.mock.instances[0]).toBe(document.querySelector('.c-exp-results'))
      expect(scrollIntoView.mock.calls[0][0]).toEqual({ behavior: 'smooth', block: 'start' })
      expect(screen.getByTestId('exp-live').textContent).toBe('模擬完成：1 個指標已更新')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DONE_STATUS_MS + 20)
      })
      expect(screen.queryByTestId('exp-status')).toBeNull()

      // prefers-reduced-motion → behavior: 'auto'
      stubMatchMedia([PHONE_MEDIA_QUERY, '(prefers-reduced-motion: reduce)'])
      fireEvent.click(screen.getByText('執行 Run'))
      rerender(<ExperimentShell {...base({ actions: { ...actions, running: true }, metrics: [{ name: 'n', value: 3 }] })} />)
      rerender(<ExperimentShell {...base({ actions, metrics: [{ name: 'n', value: 4 }] })} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20)
      })
      expect(scrollIntoView.mock.calls[1][0]).toEqual({ behavior: 'auto', block: 'start' })
      // 停止 → 狀態列消失
      fireEvent.click(screen.getByText('執行 Run'))
      rerender(<ExperimentShell {...base({ actions: { ...actions, running: true }, metrics: [{ name: 'n', value: 4 }] })} />)
      fireEvent.click(screen.getByText('停止 Stop'))
      expect(screen.queryByTestId('exp-status')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('手機：「單步」不捲到結果、沒有狀態列（連按時單步鈕不能被捲走）；「跳到結尾」結束後和執行一樣捲到結果並顯示「完成」', async () => {
    stubMatchMedia([PHONE_MEDIA_QUERY])
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const onStep = vi.fn()
    const onSkipToEnd = vi.fn()
    const actions = { onStep, onRun: vi.fn(), onSkipToEnd, runKind: 'animate' as const, running: false, progress: { done: 3, total: 20 } }
    const { rerender } = render(<ExperimentShell {...base({ actions, metrics: [{ name: 'w', value: 1 }] })} />)
    fireEvent.click(screen.getByText('單步 Step'))
    expect(onStep).toHaveBeenCalledTimes(1)
    rerender(<ExperimentShell {...base({ actions: { ...actions, progress: { done: 4, total: 20 } }, metrics: [{ name: 'w', value: 2 }] })} />)
    await waitFor(() => expect(screen.getByTestId('exp-live').textContent).toBe('模擬完成：1 個指標已更新'))
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(screen.queryByTestId('exp-status')).toBeNull()

    fireEvent.click(screen.getByText('跳到結尾'))
    expect(onSkipToEnd).toHaveBeenCalledTimes(1)
    rerender(<ExperimentShell {...base({ actions: { ...actions, progress: { done: 20, total: 20 } }, metrics: [{ name: 'w', value: 3 }] })} />)
    await waitFor(() => expect(screen.getByTestId('exp-status').textContent).toBe('完成'))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(document.querySelector('.c-exp-results'))
  })

  it('狀態列掛在 body（portal）而不是 .c-exp 裡：.c-exp 的 container-type 在仍套 layout containment 的引擎會把 fixed 釘在實驗框底', () => {
    stubMatchMedia([PHONE_MEDIA_QUERY])
    Element.prototype.scrollIntoView = vi.fn()
    const { container } = render(<ExperimentShell {...base({ actions: { onRun: vi.fn(), onStop: vi.fn(), running: false } })} />)
    fireEvent.click(screen.getByText('執行 Run'))
    const pill = screen.getByTestId('exp-status')
    expect(pill.closest('.c-exp')).toBeNull()
    expect(pill.parentElement).toBe(document.body)
    expect(container.querySelector('.c-exp-status')).toBeNull()
  })

  it("手機 + runKind='animate'：按下執行就捲到結果區（結果從第一步開始變）；結束時不再捲第二次、狀態列變「完成」；停止後再「跳到結尾」仍會在結束時捲", async () => {
    stubMatchMedia([PHONE_MEDIA_QUERY])
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const onSkipToEnd = vi.fn()
    const actions = { onRun: vi.fn(), onStop: vi.fn(), onSkipToEnd, runKind: 'animate' as const, running: false, progress: { done: 0, total: 20 } }
    const m = (v: number) => [{ name: 'w', value: v }]
    const { rerender } = render(<ExperimentShell {...base({ actions, metrics: m(1) })} />)
    fireEvent.click(screen.getByText('執行 Run'))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(document.querySelector('.c-exp-results'))
    expect(screen.getByTestId('exp-status').textContent).toContain('執行中…')
    rerender(<ExperimentShell {...base({ actions: { ...actions, running: true, progress: { done: 5, total: 20 } }, metrics: m(2) })} />)
    expect(screen.getByTestId('exp-status').textContent).toContain('25%')
    rerender(<ExperimentShell {...base({ actions: { ...actions, running: false, progress: { done: 20, total: 20 } }, metrics: m(3) })} />)
    await waitFor(() => expect(screen.getByTestId('exp-status').textContent).toBe('完成'))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    // 執行 → 停止（中途）→ 跳到結尾：停止把「已捲過」清掉，跳到結尾結束時照常捲到結果
    fireEvent.click(screen.getByText('執行 Run'))
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    rerender(<ExperimentShell {...base({ actions: { ...actions, running: true, progress: { done: 3, total: 20 } }, metrics: m(3) })} />)
    fireEvent.click(screen.getByText('停止 Stop'))
    rerender(<ExperimentShell {...base({ actions: { ...actions, running: false, progress: { done: 3, total: 20 } }, metrics: m(3) })} />)
    expect(screen.queryByTestId('exp-status')).toBeNull()
    fireEvent.click(screen.getByText('跳到結尾'))
    expect(onSkipToEnd).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledTimes(2) // 跳到結尾本身不捲
    rerender(<ExperimentShell {...base({ actions: { ...actions, running: false, progress: { done: 20, total: 20 } }, metrics: m(4) })} />)
    await waitFor(() => expect(screen.getByTestId('exp-status').textContent).toBe('完成'))
    expect(scrollIntoView).toHaveBeenCalledTimes(3)
  })

  it('桌面（不是手機）：按執行完成後不捲動、沒有狀態列', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const actions = { onRun: vi.fn(), running: false }
    const { rerender } = render(<ExperimentShell {...base({ actions })} />)
    fireEvent.click(screen.getByText('執行 Run'))
    rerender(<ExperimentShell {...base({ actions: { ...actions, running: true } })} />)
    rerender(<ExperimentShell {...base({ actions })} />)
    await waitFor(() => expect(screen.getByTestId('exp-live').textContent).toBe('模擬完成'))
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(screen.queryByTestId('exp-status')).toBeNull()
  })
})

describe('ExperimentShell 控制欄：跨越門檻時的 DOM 穩定性（審查補測）', () => {
  it('條件式控制項讓數量從 12 變 13 再回到 12：切點前的控制項不重新掛載（焦點與輸入中的文字不丟）', () => {
    function Exp({ n }: { n: number }) {
      return <ExperimentShell {...base({ controls: <>{params(n)}</> })} />
    }
    const { rerender } = render(<Exp n={12} />)
    const first = screen.getByLabelText('p0') as HTMLInputElement
    const eighth = screen.getByLabelText('p7') as HTMLInputElement
    expect(document.querySelector('details.is-auto')).toBeNull()
    rerender(<Exp n={13} />)
    expect(document.querySelector('details.is-auto summary')?.textContent).toBe('其餘參數（5 個）')
    expect(screen.getByLabelText('p0')).toBe(first)
    expect(screen.getByLabelText('p7')).toBe(eighth)
    rerender(<Exp n={12} />)
    expect(document.querySelector('details.is-auto')).toBeNull()
    expect(screen.getByLabelText('p0')).toBe(first)
    expect(screen.getByLabelText('p7')).toBe(eighth)
  })
})
