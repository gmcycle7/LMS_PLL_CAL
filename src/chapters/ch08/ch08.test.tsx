import type { ReactNode } from 'react'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider, type LearningMode } from '@/app/settings'
import { presetById, presetsForExperiment } from '@/app/presets'
import { listRegions } from '@/components'
import stabilitySrc from '@/simulation/models/stability.ts?raw'
import {
  analyzeDualLoop,
  analyzeGeneral,
  comparatorKq,
  delayCriticalGain,
  delayStable,
  pmFirstOrder,
  peakAbs,
  pmWithDelay,
  simulateDelayRecursion,
  simulateFullModel,
  stableIntervalsNumeric,
  type ObservationSystem,
} from '@/simulation/models/stability'
import Chapter08 from './index'
import { PmLab, stepCaption } from './experiments/PmLab'
import { DualLoopLab } from './experiments/DualLoopLab'
import { dualLoopRhoReference } from './sections/DualLoop'
import { STABILITY_CHECK_CHART } from './diagrams'
import { FORMULAS, formula } from './formulas'
import { HANDCALCS } from './handcalcs'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })),
}))
vi.mock('mermaid', () => ({ default: mermaidMock }))

function wrap(ui: ReactNode, url: string, mode: LearningMode) {
  localStorage.setItem('lmspll.mode', mode)
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>
    </SettingsProvider>,
  )
}
const renderChapter = (url = '/ch/08', mode: LearningMode = 'engineer') => wrap(<Chapter08 />, url, mode)

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  errorSpy.mockRestore()
  localStorage.clear()
})

// 整章 DOM 很大（數百個 KaTeX 公式），jsdom 渲染一次約數秒：整章測試放寬 timeout，互動測試只渲染單一實驗元件。
// 多個測試行程同時跑時（CPU 超額）渲染與卸載都會慢很多，所以 test 與 hook（RTL 的自動 cleanup）都給足時間。
const SLOW = 240_000
vi.setConfig({ testTimeout: SLOW, hookTimeout: SLOW })

describe('Ch08 smoke test（jsdom）', () => {
  it.each(['beginner', 'engineer', 'research'] as const)(
    '以 %s 模式渲染整章不拋錯、沒有 React 警告、公式錨點與勘誤連結齊全',
    async (mode) => {
      const { container } = renderChapter('/ch/08', mode)
      const text = container.textContent ?? ''
      for (const heading of ['§8.1 Polarity margin', '§8.2 真正的 calibration loop', '§8.3 更新延遲', '§8.4 主 PLL 與 LMS 的耦合', 'Phase Margin Lab：', 'Dual-Loop Explorer：']) {
        expect(text).toContain(heading)
      }
      // 程式碼 region 全部找得到（找不到時 CodeBlock 會顯示 danger alert）
      expect(text).not.toMatch(/找不到程式碼 region|程式碼載入錯誤/)
      // 散文（不含程式碼區塊與 KaTeX 的 TeX annotation）沒有殘留的 rich() 分隔符、字面 \n、NaN 或 undefined
      const prose = container.cloneNode(true) as HTMLElement
      prose.querySelectorAll('.c-code, annotation').forEach((el) => el.remove())
      const proseText = prose.textContent ?? ''
      expect(proseText).not.toContain('$')
      expect(proseText).not.toContain('\\n')
      expect(proseText).not.toMatch(/NaN|undefined/)
      // 技術審查 R02：ρ^k 是漸近速率的參考線，不再稱為誤差的「包絡」（只有 d = 0 的 PM Lab 圖說保留「解析包絡 1 ± ρ^k」）
      expect(proseText).not.toMatch(/[ρk]\s*包絡|包絡\s*ρ/)
      expect(proseText).toContain('參考線比斜率')
      expect(proseText).toContain('不是誤差的上界')
      // 細節（本例最多高 2.2%、重根 μ = 0.05 到 k = 300 是 34 倍）放在 Engineer 以上
      expect(proseText.includes('不要拿它當誤差的上界')).toBe(mode !== 'beginner')
      expect(proseText.includes('不是「完整模型快一倍」')).toBe(mode !== 'beginner')
      expect(proseText).toContain('由漸近衰減率換算的時間常數，不是逐 block 數出來的收斂時間')
      // KaTeX 沒有語法錯誤
      expect(container.querySelectorAll('.c-tex-error')).toHaveLength(0)
      expect(container.querySelectorAll('.katex-error')).toHaveLength(0)
      // 每個登錄的公式恰好一個錨點
      for (const f of FORMULAS) expect(container.querySelectorAll(`[id="formula-${f.id}"]`)).toHaveLength(1)
      // 符號表在章末（teaching-style §5）：章首只留一行「本章符號表在最後 ↓」，表本身是頁面最後一個區塊（外層 id="symbols"，排在 Recap 之後）
      expect(text.indexOf('本章符號表在最後')).toBeGreaterThan(text.indexOf('這一章要回答的問題'))
      expect(text.indexOf('本章符號表在最後')).toBeLessThan(text.indexOf('先用一個生活例子'))
      const symbols = container.querySelector('[id="symbols"]')
      expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
      expect(symbols?.querySelectorAll('.c-symbols tbody tr')).toHaveLength(30)
      expect(container.querySelector('.ch08')?.lastElementChild).toBe(symbols)
      expect(text.lastIndexOf('本章符號表（依第一次出現的順序）')).toBeGreaterThan(text.indexOf('應該記住的'))
      // 方塊圖（teaching-style §8）：章首的系統地圖 + 本章 19 張圖，三種模式都看得到（不放在 ModeGate 裡）
      expect(container.querySelectorAll('figure.c-mermaid')).toHaveLength(20)
      expect(container.querySelector('figure.c-mermaid')?.getAttribute('aria-label') ?? '').toContain('系統方塊圖')
      // 「用晶片上的數字算一次」：μ 上界 250.66 / 125.33 fs（入門課 Lesson 4）由模型算出
      expect(text).toContain('250.66')
      expect(text).toContain('125.33')
      // 互動實驗的指標表沒有任何一列超出容許誤差（解析 vs 數值）
      expect(container.querySelectorAll('tr[data-pass="false"]')).toHaveLength(0)
      // 帶入手算（teaching-style §7）：8 題各出現一次、依序排在對應推導之後，每題前面都有「換你算」的引導
      expect(Array.from(container.querySelectorAll('.c-handcalc'), (el) => el.id)).toEqual(HANDCALCS.map((h) => `handcalc-${h.id}`))
      expect(container.querySelectorAll('.ch08-handcalc-lead')).toHaveLength(HANDCALCS.length)
      for (const el of Array.from(container.querySelectorAll('.c-handcalc'))) expect(el.querySelectorAll('.c-step').length, el.id).toBeGreaterThan(0)
      // 綜合手算（HC-08.8）在硬體對照之後、章末思考題之前
      const synth = text.indexOf('綜合手算：從晶片數字到穩定裕度')
      expect(synth).toBeGreaterThan(text.indexOf('設計檢查清單（本章）'))
      expect(synth).toBeLessThan(text.indexOf('思考題 5（Gain margin）'))
      // 每題排在所屬段落內：HC-08.1 在 §8.1、HC-08.2/3 在 §8.2、HC-08.4–6 在 §8.3、HC-08.7 在 §8.4
      const sectionOf = (hc: string) => container.querySelector(`[id="handcalc-${hc}"]`)?.closest('section.c-section')?.id
      expect(sectionOf('HC-08.1')).toBe('ch08-polarity')
      expect(sectionOf('HC-08.2')).toBe('ch08-first-order')
      expect(sectionOf('HC-08.3')).toBe('ch08-first-order')
      for (const hc of ['HC-08.4', 'HC-08.5', 'HC-08.6']) expect(sectionOf(hc)).toBe('ch08-delay')
      expect(sectionOf('HC-08.7')).toBe('ch08-dual-loop')
      expect(sectionOf('HC-08.8')).toBe('ch08-handcalc-synthesis')
      // 勘誤標記連到 #/verification
      for (const id of ['E19', 'E20', 'E31', 'E13', 'E34']) {
        const links = container.querySelectorAll(`a[data-erratum="${id}"]`)
        expect(links.length).toBeGreaterThan(0)
        expect(links[0].getAttribute('href')).toBe('#/verification')
      }
      await waitFor(() => expect(P.react).toHaveBeenCalled())
      expect(errorSpy).not.toHaveBeenCalled()
    },
    SLOW,
  )
})

describe('Ch08 實驗元件（單獨渲染）', () => {
  it('T09: URL preset dual-loop-gallery-5 → 顯示「完整模型發散、簡化預測穩定」並引用 E19', async () => {
    const { container } = wrap(<DualLoopLab />, '/ch/08?preset=dual-loop-gallery-5', 'engineer')
    // 警告字串中的 `$…$` 由 ExperimentShell 轉成 KaTeX；TeX 原始碼留在 <annotation> 內，可直接比對
    await waitFor(() => expect(container.textContent).toContain(String.raw`\rho=1.0198`))
    expect(container.textContent).toContain('完整模型發散（')
    expect(container.textContent).toContain('勘誤 E19')
    expect(container.textContent).toContain('簡化模型給出錯誤的穩定結論')
    // 頻域版 E19：GM（完整）數值 = 20log10(1/g_eff) = −1.58 dB（g_eff = 1.2），而 quasi-static 還以為有 +4.44 dB
    expect(container.textContent).toContain('-1.58362')
    expect(container.querySelectorAll('tr[data-pass="false"]')).toHaveLength(0)
    expect(container.textContent).not.toContain('$')
    expect(container.querySelectorAll('.c-tex-error, .katex-error')).toHaveLength(0)
    expect(errorSpy).not.toHaveBeenCalled()
  }, SLOW)

  it('T08: URL preset pm-d2-unstable → 警告說明 g > g*(d=2)', async () => {
    const { container } = wrap(<PmLab />, '/ch/08?preset=pm-d2-unstable', 'engineer')
    await waitFor(() => expect(container.textContent).toContain(String.raw`g^*(d=2)=0.618034`))
    expect(container.textContent).toContain('若忽略延遲、只用一階模型')
    expect(container.textContent).not.toContain('$')
    expect(container.querySelectorAll('.c-tex-error, .katex-error')).toHaveLength(0)
    expect(errorSpy).not.toHaveBeenCalled()
  }, SLOW)

  it('反面測試：URL preset pm-reversed-polarity → 極性錯誤警告，且 Analytic 交叉比對不誤報 mismatch', async () => {
    const { container } = wrap(<PmLab />, '/ch/08?preset=pm-reversed-polarity', 'engineer')
    await waitFor(() => expect(container.textContent).toContain('更新極性錯誤'))
    expect(container.querySelectorAll('.c-check-mismatch')).toHaveLength(0)
    expect(container.querySelector('.c-check-ok')?.textContent ?? '').toContain('PM／GM 依定義不適用')
  }, SLOW)

  it.each(['pm-g1-deadbeat', 'pm-g15-delay-margin', 'pm-d1-critical', 'pm-d2-unstable', 'pm-mu10fs-hardware', 'dual-loop-gallery-5', 'dual-loop-mu05-slow', 'dual-loop-r0-delay', 'dual-loop-zero-latency', 'dual-loop-second-order'])(
    '每個 preset（%s）的 Analytic 交叉比對都是 ok（沒有誤報 mismatch）',
    async (id) => {
      const ui = id.startsWith('pm-') ? <PmLab /> : <DualLoopLab />
      const { container } = wrap(ui, `/ch/08?preset=${id}`, 'engineer')
      await waitFor(() => expect(container.querySelectorAll('.c-check-ok').length).toBeGreaterThan(0))
      expect(container.querySelectorAll('.c-check-mismatch')).toHaveLength(0)
      // 指標表的每一列「數值 vs 解析」都在容許誤差內；字串屬性裡的 `$…$` 全部被轉成 KaTeX、沒有語法錯誤
      expect(container.querySelectorAll('tr[data-pass="false"]')).toHaveLength(0)
      expect(container.textContent).not.toContain('$')
      expect(container.querySelectorAll('.c-tex-error, .katex-error')).toHaveLength(0)
      expect(errorSpy).not.toHaveBeenCalled()
    },
    SLOW,
  )

  it('一般化 state-space 模式：二階觀測 preset → quasi-static 錯誤的警告與矩陣輸入', async () => {
    const { container } = wrap(<DualLoopLab />, '/ch/08?preset=dual-loop-second-order', 'research')
    await waitFor(() => expect(container.textContent).toContain('忽略了觀測路徑的相位延遲（勘誤 E19 的一般化）'))
    expect(container.querySelectorAll('input[aria-label="A_s[1][2]"]')).toHaveLength(1)
    expect(errorSpy).not.toHaveBeenCalled()
  }, SLOW)

  it('PM Lab：把 g 改成 2.2（d = 0）會顯示沒有 crossover 的解釋', async () => {
    const { container } = wrap(<PmLab />, '/ch/08', 'engineer')
    const input = container.querySelector('input[aria-label="g（正規化 loop gain）"]') as HTMLInputElement
    expect(input).toBeTruthy()
    act(() => {
      fireEvent.change(input, { target: { value: '2.2' } })
    })
    await waitFor(() => expect(container.textContent).toContain('沒有 gain crossover（PM 無定義）'))
  }, SLOW)

  it('反面測試：PM Lab 的 d = 1、g = 2.5（> 2）警告說明沒有 crossover，而不是顯示「PM_d = —」', async () => {
    const { container, getByLabelText } = wrap(<PmLab />, '/ch/08', 'engineer')
    act(() => {
      fireEvent.change(getByLabelText('d（更新延遲 blocks）'), { target: { value: '1' } })
    })
    act(() => {
      fireEvent.change(getByLabelText('g（正規化 loop gain）'), { target: { value: '2.5' } })
    })
    await waitFor(() => expect(container.textContent).toContain('沒有 gain crossover，PM 無定義'))
    expect(container.textContent).toContain(String.raw`g=2.5>g^*(d=1)=1`)
    expect(container.textContent).not.toContain('PM_d=')
    expect(container.querySelectorAll('.c-check-mismatch')).toHaveLength(0)
    expect(container.querySelectorAll('.c-tex-error, .katex-error')).toHaveLength(0)
  }, SLOW)

  it('反面測試：Dual-Loop 的 b_s < 0（觀測極性錯誤）與 |r_s| ≥ 1（沒有穩態）都有解釋原因的警告', async () => {
    const { container, getByLabelText } = wrap(<DualLoopLab />, '/ch/08', 'engineer')
    act(() => {
      fireEvent.change(getByLabelText('b_s（δ → s 耦合）'), { target: { value: '-0.2' } })
    })
    await waitFor(() => expect(container.textContent).toContain('觀測極性錯誤'))
    expect(container.textContent).toContain('都不穩定。先修正 GMAC 的相關極性')
    // 極性錯誤時 PM／GM 不可顯示成一個看似很大的正數（主值相位 +90° 起算會得到 ≈ 270°）：指標顯示 — 並說明原因
    const pmRows = Array.from(container.querySelectorAll('.c-metric-table tbody tr')).filter((tr) => (tr.textContent ?? '').includes('PM'))
    expect(pmRows.length).toBeGreaterThanOrEqual(2)
    for (const tr of pmRows) {
      expect(tr.textContent).toContain('PM／GM 依定義不適用')
      expect(tr.querySelector('td.num')?.textContent ?? '').not.toMatch(/\d/)
    }
    act(() => {
      fireEvent.change(getByLabelText('b_s（δ → s 耦合）'), { target: { value: '0.2' } })
    })
    act(() => {
      fireEvent.change(getByLabelText('r_s（觀測 pole）'), { target: { value: '1.1' } })
    })
    await waitFor(() => expect(container.textContent).toContain('quasi-static 前提不存在'))
    expect(container.querySelectorAll('.c-check-mismatch')).toHaveLength(0)
    expect(errorSpy).not.toHaveBeenCalled()
  }, SLOW)

  it('T08: PM Lab 的 Monte Carlo（blockLms，jsdom 下 inline 執行）跑完後交叉比對顯示 ok', async () => {
    const { container, getByLabelText, getByText } = wrap(<PmLab />, '/ch/08', 'engineer')
    const set = (label: string, value: string) =>
      act(() => {
        fireEvent.change(getByLabelText(label), { target: { value } })
      })
    set('N（GMAC 累加長度）', '1024')
    set('MC blocks', '30')
    set('runs（seeds）', '8')
    expect(container.textContent).toContain('尚未執行')
    act(() => {
      fireEvent.click(getByText('執行 Run'))
    })
    await waitFor(() => expect(container.textContent).toMatch(/8 runs：/), { timeout: 30_000 })
    expect(container.querySelector('.c-check-ok .c-check-note, .c-check-note')?.textContent ?? '').toBeTruthy()
    expect(container.textContent).toContain('Student-t 臨界值')
    // step response 圖多了一條 MC ensemble 平均的 trace
    await waitFor(() => {
      const names = (P.react.mock.calls as unknown as [unknown, { name?: string }[]][]).flatMap((c) => c[1].map((t) => t.name ?? ''))
      expect(names.some((nm) => nm.startsWith('MC：真實 block sign-LMS 平均（8 seeds）'))).toBe(true)
    })
    expect(errorSpy).not.toHaveBeenCalled()
  }, SLOW)

  it('反面測試：Dual-Loop 的 r_s = 1（觀測含積分器，F(1) = ∞）不拋錯、有解釋原因的警告，圖表資料不含 ±∞／NaN', async () => {
    const { container, getByLabelText } = wrap(<DualLoopLab />, '/ch/08', 'engineer')
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    P.react.mockClear()
    act(() => {
      fireEvent.change(getByLabelText('r_s（觀測 pole）'), { target: { value: '1' } })
    })
    await waitFor(() => expect(container.textContent).toContain('quasi-static 前提不存在'))
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    const calls = P.react.mock.calls as unknown as [unknown, { y?: ArrayLike<number | null> }[]][]
    for (const [, traces] of calls) {
      for (const t of traces) for (const v of Array.from(t.y ?? [])) expect(v === null || Number.isFinite(v)).toBe(true)
    }
    expect(container.textContent).toContain('PM／GM 依定義不適用')
    expect(container.querySelectorAll('.c-check-mismatch')).toHaveLength(0)
    expect(container.querySelectorAll('.c-tex-error, .katex-error')).toHaveLength(0)
    expect(errorSpy).not.toHaveBeenCalled()
  }, SLOW)

  it('PM Lab：與圖無關的重新渲染（改 Monte Carlo 的 runs）不會多呼叫 Plotly.react——data 與 layout 的參考都有 memo', async () => {
    const { getByLabelText } = wrap(<PmLab />, '/ch/08', 'engineer')
    await waitFor(() => expect(P.react.mock.calls.length).toBeGreaterThanOrEqual(6))
    // 等初次繪圖全部完成
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    const before = P.react.mock.calls.length
    act(() => {
      fireEvent.change(getByLabelText('runs（seeds）'), { target: { value: '12' } })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(P.react.mock.calls.length).toBe(before)
    // 改 g 則會重畫（確認上面的「不重畫」不是因為圖表壞掉）
    act(() => {
      fireEvent.change(getByLabelText('g（正規化 loop gain）'), { target: { value: '0.7' } })
    })
    await waitFor(() => expect(P.react.mock.calls.length).toBeGreaterThan(before))
  }, SLOW)

  it('反面測試：PM Lab 的 g < 0 時 Bode 相位採 lag 分支（由 −270° 起算），不會畫出 +90° 起算、看似 PM ≈ 270° 的曲線', async () => {
    const { container } = wrap(<PmLab />, '/ch/08?preset=pm-reversed-polarity', 'engineer')
    await waitFor(() => expect(container.textContent).toContain('更新極性錯誤'))
    await waitFor(() => {
      const calls = P.react.mock.calls as unknown as [unknown, { name?: string; y?: ArrayLike<number> }[]][]
      const phase = calls.flatMap((c) => c[1]).filter((t) => (t.name ?? '').includes('∠<i>L</i>')) // Plot 把名稱裡的 `$\angle L$` 轉成 ∠ 加斜體 L
      expect(phase.length).toBeGreaterThan(0)
      const last = phase[phase.length - 1]
      const ys = Array.from(last.y ?? [])
      expect(ys[0]).toBeCloseTo(-270, 0)
      expect(Math.max(...ys)).toBeLessThan(-180)
    })
  }, SLOW)

  it('Dual-Loop：矩陣格子輸入超出範圍時不套用並標紅', async () => {
    const { container } = wrap(<DualLoopLab />, '/ch/08?preset=dual-loop-zero-latency', 'engineer')
    await waitFor(() => expect(container.querySelectorAll('input[aria-label="A_s[1][1]"]')).toHaveLength(1))
    const cell = container.querySelector('input[aria-label="A_s[1][1]"]') as HTMLInputElement
    act(() => {
      fireEvent.change(cell, { target: { value: '9' } })
    })
    expect(cell.getAttribute('aria-invalid')).toBe('true')
    act(() => {
      fireEvent.change(cell, { target: { value: '0.5' } })
    })
    expect(cell.getAttribute('aria-invalid')).toBeNull()
  }, SLOW)
})

/** Plotly.react 收到的、會顯示在圖上的文字：trace 名稱、軸標題、圖標題、註記、hovertemplate（已由 Plot 元件轉成 pseudo-HTML） */
function plotTexts(): string[] {
  const keys = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext'])
  const out: string[] = []
  const walk = (v: unknown, key: string | null, depth: number) => {
    if (typeof v === 'string') {
      if (key !== null && keys.has(key)) out.push(v)
      return
    }
    if (depth > 6 || v === null || typeof v !== 'object' || ArrayBuffer.isView(v)) return
    if (Array.isArray(v)) {
      for (const x of v.slice(0, 40)) walk(x, key, depth + 1)
      return
    }
    for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1)
  }
  for (const [, data, layout] of P.react.mock.calls as unknown as [unknown, unknown, unknown][]) {
    walk(data, null, 0)
    walk(layout, null, 0)
  }
  return out
}

/** 圖內文字的數學都是 `$...$` 轉出來的：沒有殘留的 `$`、TeX 指令、大括號，也沒有 Unicode 拼的下標、上標與沒轉成斜體的希臘字母 */
function expectTypesetPlotTexts(texts: string[]) {
  expect(texts.length).toBeGreaterThan(20)
  expect(texts.some((t) => t.includes('<i>'))).toBe(true)
  for (const raw of texts) {
    const t = raw.replace(/%\{[^}]*\}/g, '') // Plotly 的 %{x:.4f} 佔位不算
    expect(t, raw).not.toMatch(/[$\\{}^]/)
    const outsideItalic = t.replace(/<i>.*?<\/i>/g, '')
    expect(outsideItalic, raw).not.toMatch(/[α-ω⁰-₟²³¹]|\b[A-Za-z]{1,3}_[A-Za-z0-9{]/u)
  }
}

describe('Ch08 數學一律是 LaTeX（圖內文字與控制項）', () => {
  it('整章（engineer）：§8.2／§8.3 的圖與兩個實驗的圖，軸標題、圖例名稱、hover 裡的數學都由 `$...$` 轉出', async () => {
    renderChapter('/ch/08', 'engineer')
    // §8.2 兩張、§8.3 兩張、PM Lab 六張、Dual-Loop 五張
    await waitFor(() => expect(P.react.mock.calls.length).toBeGreaterThanOrEqual(15), { timeout: 60_000 })
    const texts = plotTexts()
    expectTypesetPlotTexts(texts)
    // 幾個代表性的字串：變數是斜體、下標與上標是真正的 <sub>／<sup>、度數是 °
    expect(texts).toContain('<i>g</i>') // §8.2／§8.3／PM Lab 的橫軸
    expect(texts).toContain('<i>ρ</i> = 1')
    expect(texts).toContain('<i>PM</i><sub><i>d</i></sub> [deg]')
    expect(texts).toContain('<i>ω</i> [rad/block]')
    expect(texts.some((t) => /^Re\s<i>L<\/i>$/.test(t))).toBe(true) // `\mathrm{Re}\,L`
    expect(texts).toContain('|<i>δ</i><sub><i>k</i></sub>|/<i>δ</i><sub>0</sub>')
    expect(texts.some((t) => t.includes('<i>PM</i> = 90°−arcsin(<i>g</i>/2)'))).toBe(true)
    expect(texts.some((t) => /單位圓 \|<i>z<\/i>\| = 1/.test(t))).toBe(true)
    expect(texts.some((t) => t.includes('<br><i>z</i> = %{x:.4f} %{y:+.4f}<i>j</i>'))).toBe(true) // 極點的 hovertemplate
    expect(errorSpy).not.toHaveBeenCalled()
  }, SLOW)

  it('Dual-Loop 一般化 state-space 模式：圖內文字同樣是 LaTeX 轉出的', async () => {
    wrap(<DualLoopLab />, '/ch/08?preset=dual-loop-second-order', 'research')
    await waitFor(() => expect(P.react.mock.calls.length).toBeGreaterThanOrEqual(5), { timeout: 60_000 })
    const texts = plotTexts()
    expectTypesetPlotTexts(texts)
    expect(texts.some((t) => t.includes('eig(<b><i>A</i></b><sub><i>s</i></sub>)'))).toBe(true)
    expect(texts.some((t) => t.includes('<i>ρ</i>(<b><i>A</i></b><sub>comb</sub>)'))).toBe(true)
    expect(errorSpy).not.toHaveBeenCalled()
  }, SLOW)

  it('整章的文字（含控制項的標籤、提示、單位與指標名稱）沒有 Unicode 或 `^`／`_` 拼出來的公式，也沒有沒轉成 KaTeX 的 `$`', async () => {
    const { container } = renderChapter('/ch/08', 'research')
    await waitFor(() => expect(container.querySelectorAll('.c-param').length).toBeGreaterThan(8))
    // 例外（docs/teaching-style.md §3）：程式碼、下拉選單、暫存器／behavioral 參數名稱、檔案路徑、共用徽章的 tooltip；Plotly 圖內文字另由上面兩題檢查
    // 共用元件自己的文字（Plot 的 log 軸提示、實驗的參數／單位摘要、指標表的欄名）不在本章範圍
    const skip = '.katex, code, pre, option, script, style, svg, .c-param-reg, .c-code-path, .c-tip, .c-tip-item, .c-plot-note, .c-exp-summary-list'
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    const offenders: string[] = []
    let total = 0
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      if (!el || el.closest(skip)) continue
      total++
      const t = n.textContent ?? ''
      if (t === 'Δ（模擬 − 解析）') continue // MetricTable 的欄名（共用元件）
      // 小寫下標（w_k、σ_w）、上標 ^、希臘字母／根號／積分等符號、乘號與中點、不等號、正負號、上下標數字、未渲染的 $ ⇒ 純文字公式
      if (/(?<![A-Z_])[A-Za-z]_[a-z0-9{(]|\^|[Ͱ-Ͽ⁰-₟²³¹∑∏√∫∞≤≥≠≈±∓×·÷∂∇∈∝∠]|\$/u.test(t)) offenders.push(`<${el.tagName.toLowerCase()} class="${el.className}"> ${t.trim().slice(0, 80)}`)
    }
    expect(total).toBeGreaterThan(1500)
    expect(offenders).toEqual([])
    expect(container.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
  }, SLOW)
})

describe('技術審查 R02：ρ^k 只是漸近速率，不是 d ≥ 1 或雙迴路誤差的包絡', () => {
  const ratios = (delta: ArrayLike<number>, rho: number) => Array.from(delta, (v, k) => Math.abs(v) / rho ** k)

  it('更新延遲遞迴：d = 0 時 |δ_k| = ρ^k（包絡精確）；d = 1、g = 0.25 是重根 0.5，δ_k = (1 + k/2)·2^(−k)，60 個 block 全部在 ρ^k 之外', () => {
    for (const g of [0.5, 1.5]) {
      const rho = delayStable(g, 0).rho
      expect(rho).toBeCloseTo(Math.abs(1 - g), 12)
      const r = ratios(simulateDelayRecursion(g, 0, 60, 1).delta, rho)
      for (const v of r) expect(v).toBeCloseTo(1, 9)
    }
    const rho = delayStable(0.25, 1).rho
    expect(rho).toBeCloseTo(0.5, 7)
    const run = simulateDelayRecursion(0.25, 1, 60, 1).delta
    expect(Array.from(run.slice(0, 6))).toEqual([1, 0.75, 0.5, 0.3125, 0.1875, 0.109375])
    for (let k = 0; k <= 60; k++) expect(run[k] / 0.5 ** k).toBeCloseTo(1 + k / 2, 9)
    const r = ratios(run, 0.5)
    expect(r.slice(1).every((v) => v > 1)).toBe(true)
    expect(r[60]).toBeCloseTo(31, 9)
    // τ = −1/ln ρ = 1.44 blocks，但誤差要到第 3 個 block 才低於 1/e、第 7 個 block 才低於 5%
    expect(-1 / Math.log(rho)).toBeCloseTo(1.4427, 4)
    const lastAbove = (level: number) => Array.from(run).reduce((last, v, k) => (Math.abs(v) > level ? k : last), 0)
    expect(lastAbove(Math.exp(-1)) + 1).toBe(3)
    expect(lastAbove(0.05) + 1).toBe(7)
    // 複數根（d = 1、g = 0.8）：有 14 個 block 在 ρ^k 之外，最多高到 2g/√(4g − 1) = 1.0787 倍
    const r08 = ratios(simulateDelayRecursion(0.8, 1, 60, 1).delta, delayStable(0.8, 1).rho)
    expect(r08.slice(1).filter((v) => v > 1 + 1e-12)).toHaveLength(14)
    expect(Math.max(...r08)).toBeGreaterThan(1.07)
    expect(Math.max(...r08)).toBeLessThanOrEqual(1.6 / Math.sqrt(2.2) + 1e-12)
    // 暫態也可能比 τ 快：d = 3、g = 0.2 的 τ = 6.18 blocks，誤差第 4 個 block 起就低於 1/e
    const run3 = simulateDelayRecursion(0.2, 3, 200, 1).delta
    expect(-1 / Math.log(delayStable(0.2, 3).rho)).toBeCloseTo(6.18, 2)
    expect(Array.from(run3).reduce((last, v, k) => (Math.abs(v) > Math.exp(-1) ? k : last), 0) + 1).toBe(4)
  })

  it('PM Lab 的圖說：d = 0 才叫「解析包絡」；d ≥ 1 說明是漸近速率的參考線、不是包絡', () => {
    expect(stepCaption(false, true, 0)).toContain('解析包絡')
    expect(stepCaption(false, true, 0)).not.toContain('參考線')
    for (const d of [1, 2, 6]) {
      const cap = stepCaption(false, true, d)
      expect(cap).not.toContain('解析包絡')
      expect(cap).toContain('只是漸近速率的參考線，不是包絡')
      expect(cap).toContain(String.raw`\delta_k/\delta_0=(1+k/2)\,2^{-k}`)
    }
    // 裁切時兩句都留；沒畫點線時不提點線
    expect(stepCaption(true, true, 1)).toMatch(/^發散的曲線已裁切.*不是包絡/)
    expect(stepCaption(true, false, 1)).not.toMatch(/點線|包絡/)
    expect(stepCaption(false, false, 0)).not.toMatch(/點線|包絡/)
    expect(stepCaption(false, false, 0).length).toBeGreaterThan(0)
  })

  it('PM Lab：d = 1、g = 0.25 時 τ 那一列標「漸近衰減率／近似」、圖例是「漸近速率參考線」；回到 d = 0 才是「時間常數／精確」與「包絡」', async () => {
    const { container, getByLabelText } = wrap(<PmLab />, '/ch/08', 'engineer')
    const set = (label: string, value: string) =>
      act(() => {
        fireEvent.change(getByLabelText(label), { target: { value } })
      })
    const tauRow = () => Array.from(container.querySelectorAll('.c-metric-table tbody tr')).find((tr) => (tr.textContent ?? '').includes(String.raw`\tau=-1/\ln\rho`))
    const rhoLineNames = () => {
      const calls = P.react.mock.calls as unknown as [unknown, { name?: string }[]][]
      return calls.flatMap((c) => c[1].map((t) => t.name ?? '')).filter((nm) => /1\s*±/.test(nm)) // Plot 把 `$1 \pm \rho^k$` 轉成 1±ρ^k
    }
    const settle = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 50))
      })
    await settle()
    P.react.mockClear() // 前面的測試也畫過 PM Lab：只看這一題的圖
    set('g（正規化 loop gain）', '0.5')
    await waitFor(() => expect(tauRow()?.textContent ?? '').toContain('1.4427'))
    expect(tauRow()?.textContent).toContain('時間常數')
    expect(tauRow()?.textContent).toContain('精確')
    expect(tauRow()?.textContent).not.toContain('漸近')
    await waitFor(() => expect(rhoLineNames().some((nm) => nm.includes('包絡'))).toBe(true))
    expect(rhoLineNames().some((nm) => nm.includes('參考線'))).toBe(false)
    expect(container.textContent).toContain('解析包絡')

    await settle()
    P.react.mockClear()
    set('d（更新延遲 blocks）', '1')
    set('g（正規化 loop gain）', '0.25')
    await waitFor(() => expect(tauRow()?.textContent ?? '').toContain('漸近衰減率'))
    // 數字不變（ρ = 0.5 ⇒ 1.4427），變的是標籤：不再標「精確」
    expect(tauRow()?.textContent).toContain('1.4427')
    expect(tauRow()?.textContent).toContain('近似')
    expect(tauRow()?.textContent).not.toContain('精確')
    expect(tauRow()?.textContent).toContain('不是平均誤差的包絡')
    await waitFor(() => expect(rhoLineNames().some((nm) => nm.includes('漸近速率參考線'))).toBe(true))
    expect(rhoLineNames().some((nm) => nm.includes('包絡'))).toBe(false)
    expect(container.textContent).not.toContain('解析包絡')
    expect(container.textContent).toContain('只是漸近速率的參考線，不是包絡')
    expect(container.querySelectorAll('.c-tex-error, .katex-error')).toHaveLength(0)
    expect(errorSpy).not.toHaveBeenCalled()
  }, SLOW)

  it('雙迴路：Gallery #5 的 |δ_k| 最多比 ρ^k 高 2.2%（上限 1/√(1 − μ_c/μ)）；重根 μ = 0.05 是 δ_k = (1 + k/9)·0.9^k，k = 300 時是 ρ^k 的 34 倍', () => {
    const p = { r: 0.8, b: 0.2, c: 1, mu: 1.2 }
    const ref = dualLoopRhoReference(p, 300)
    // 複數 pole 的解是 M·ρ^k·cos(kθ − ψ)，M = 1/√(1 − μ_c/μ)（由 δ_0 = δ_1 = 1 定出），μ_c = (1 − r_s)²/(4 b_s c_s) = 0.05
    const M = 1 / Math.sqrt(1 - 0.05 / 1.2)
    expect(M).toBeCloseTo(1.0215, 4)
    expect(ref.maxRatio).toBeLessThanOrEqual(M + 1e-12)
    expect(ref.maxRatio).toBeGreaterThan(1.021)
    expect(((ref.maxRatio - 1) * 100).toFixed(1)).toBe('2.2')
    const rho = analyzeDualLoop(p).rho
    const over = Array.from(simulateFullModel(p, 300).delta, (v, k) => Math.abs(v) / rho ** k).filter((v) => v > 1 + 1e-12)
    expect(over).toHaveLength(39)
    // 重根
    expect(ref.muDouble).toBe(0.05)
    expect(ref.zDouble).toBeCloseTo(0.9, 12)
    expect(analyzeDualLoop({ ...p, mu: 0.05 }).rho).toBeCloseTo(0.9, 6)
    const dbl = simulateFullModel({ ...p, mu: 0.05 }, 300).delta
    for (let k = 0; k <= 300; k++) expect(dbl[k] / 0.9 ** k).toBeCloseTo(1 + k / 9, 8)
    expect(ref.doubleRatio).toBeCloseTo(1 + 300 / 9, 8)
    expect(ref.doubleRatio.toFixed(0)).toBe('34')
    // 重根那一列的 τ = −1/ln 0.9 = 9.49 blocks 只是漸近時間常數：(1 + k/9)·0.9^k 在 k = 20 還是 0.392 > 1/e，k = 21 才是 0.365；
    // 簡化模型（pole 0.95）的 τ = 19.50 blocks 反而接近
    expect((1 + 20 / 9) * 0.9 ** 20).toBeGreaterThan(Math.exp(-1))
    expect((1 + 21 / 9) * 0.9 ** 21).toBeLessThan(Math.exp(-1))
    expect(ref.doubleBelowE).toBe(21)
    const dblRow = analyzeDualLoop({ ...p, mu: 0.05 })
    expect(-1 / Math.log(dblRow.rho)).toBeCloseTo(9.49, 2)
    expect(dblRow.simplifiedPole).toBeCloseTo(0.95, 12)
    expect(-1 / Math.log(dblRow.simplifiedPole)).toBeCloseTo(19.5, 2)
    // 實數相異根（μ = 0.02）也會高出一個常數倍：A = (1 − z_2)/(z_1 − z_2) = 1.1455
    const a02 = analyzeDualLoop({ ...p, mu: 0.02 })
    const [z1, z2] = a02.poles.map((z) => z.re).sort((x, y) => y - x)
    const tr02 = simulateFullModel({ ...p, mu: 0.02 }, 300).delta
    expect(tr02[300] / a02.rho ** 300).toBeCloseTo((1 - z2) / (z1 - z2), 6)
    expect((1 - z2) / (z1 - z2)).toBeCloseTo(1.1455, 4)
  })

  it('Dual-Loop Explorer 與穩定性檢查流程圖：點線叫「ρ^k 參考線」，不叫包絡', async () => {
    expect(STABILITY_CHECK_CHART).toContain(String.raw`疊上 $\rho^k$ 參考線`)
    expect(STABILITY_CHECK_CHART).not.toContain('包絡')
    for (const url of ['/ch/08', '/ch/08?preset=dual-loop-second-order']) {
      P.react.mockClear()
      const { container, unmount } = wrap(<DualLoopLab />, url, 'engineer')
      await waitFor(() => {
        const names = (P.react.mock.calls as unknown as [unknown, { name?: string }[]][]).flatMap((c) => c[1].map((t) => t.name ?? ''))
        expect(names.some((nm) => nm.includes('參考線（漸近速率'))).toBe(true)
        expect(names.some((nm) => nm.includes('包絡'))).toBe(false)
      })
      const text = container.textContent ?? ''
      expect(text).toMatch(/只給漸近速率，不是 /)
      expect(text).toContain('的包絡')
      expect(text).not.toMatch(/要看包絡|\$/)
      unmount()
    }
    expect(errorSpy).not.toHaveBeenCalled()
  }, SLOW)
})

describe('Ch08 公式登錄與 presets', () => {
  it('FORMULAS：id 唯一、格式 F-08.n、欄位齊全', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of FORMULAS) {
      expect(f.id).toMatch(/^F-08\.\d+$/)
      expect(f.page).toBe('/ch/08')
      expect(f.tex.length).toBeGreaterThan(5)
      expect(formula(f.id)).toBe(f)
    }
    expect(FORMULAS.filter((f) => f.erratumId === 'E19').length).toBeGreaterThan(0)
    expect(FORMULAS.filter((f) => f.erratumId === 'E20').length).toBeGreaterThan(0)
    expect(FORMULAS.filter((f) => f.erratumId === 'E31').length).toBeGreaterThan(0)
  })

  it('F-08.1 與 F-08.14 分成兩行（gathered）：排成一行會比桌機 1280px 的正文欄寬，多出一條橫向捲軸（scripts/scroll-audit.mjs 量得到）；內容一項不少', () => {
    const lines = (id: string) => {
      const tex = formula(id).tex
      expect(tex.startsWith(String.raw`\begin{gathered}`) && tex.endsWith(String.raw`\end{gathered}`), id).toBe(true)
      return tex.slice(String.raw`\begin{gathered}`.length, -String.raw`\end{gathered}`.length).split(/\\\\(?:\[[^\]]*\])?/)
    }
    const f1 = lines('F-08.1')
    expect(f1).toHaveLength(2)
    expect(f1[0]).toBe(String.raw`M_{\mathrm{polarity}}=90^\circ-\big|\mathrm{wrap}_{180}(\theta)\big|=\arcsin(\cos\theta)`)
    expect(f1[1]).toBe(String.raw`\mathrm{wrap}_{180}(\theta)\triangleq\big((\theta+180^\circ)\bmod 360^\circ\big)-180^\circ\in[-180^\circ,180^\circ)`)
    const f14 = lines('F-08.14')
    expect(f14).toHaveLength(2)
    expect(f14[0]).toBe(String.raw`F(z)=d_s+\mathbf c_s^{\mathsf T}(z\mathbf I-\mathbf A_s)^{-1}\mathbf b_s,\qquad \boxed{L_{\mathrm{cal}}(z)=\frac{\mu F(z)}{z-1}}`)
    expect(f14[1]).toBe(String.raw`\det(z\mathbf I-\mathbf A_{\mathrm{comb}})=\det(z\mathbf I-\mathbf A_s)\,\big(z-1+\mu F(z)\big)`)
  })

  it('stability.ts 的 core regions 都存在（頁面引用的名稱）', () => {
    const regions = listRegions(stabilitySrc)
    for (const r of [
      'wrap180',
      'polarityMarginWrap',
      'polarityMarginArcsin',
      'polarityMarginMod180Bug',
      'calLoopGain',
      'pmFirstOrder',
      'delayCharPoly',
      'delayStable',
      'delayCriticalGain',
      'delayCriticalGainNumeric',
      'pmWithDelay',
      'simulateDelayRecursion',
      'loopMargins',
      'dualLoopMatrix',
      'dualLoopCharPoly',
      'dualLoopFullRange',
      'dualLoopSimplifiedRange',
      'simulateQuasiStatic',
      'simulateFullModel',
      'combinedMatrix',
      'observationTransfer',
      'stableIntervals',
      'dualLoopGainMargin',
      'compareMcToLinear',
    ]) {
      expect(regions).toContain(r)
    }
  })

  it('T08: pm-lab presets 的 expected 文字與模型一致', () => {
    const list = presetsForExperiment('pm-lab')
    expect(list.map((p) => p.id).sort()).toEqual(['pm-d1-critical', 'pm-d2-unstable', 'pm-g15-delay-margin', 'pm-g1-deadbeat', 'pm-mu10fs-hardware', 'pm-reversed-polarity'].sort())
    const g1 = pmFirstOrder(1)
    expect(g1.pole).toBe(0)
    expect(g1.pmDeg).toBeCloseTo(60, 12)
    expect(pmFirstOrder(1.5).delayMarginBlocks).toBeCloseTo(0.426, 3)
    expect(delayStable(1.5, 1).stable).toBe(false)
    expect(delayStable(1, 1).marginal).toBe(true)
    const d2 = delayStable(0.65, 2)
    expect(d2.rho).toBeCloseTo(1.0147, 4)
    expect(pmWithDelay(0.65, 2).pmDeg).toBeCloseTo(-4.83, 2)
    expect(pmFirstOrder(0.65).pmDeg).toBeCloseTo(71.03, 2)
    expect(delayCriticalGain(2)).toBeCloseTo(0.618034, 6)
    expect(pmFirstOrder(presetById('pm-reversed-polarity')!.params.g as number).pole).toBeCloseTo(1.0797885, 7)
    // pm-mu10fs-hardware：g = μK_q（μ = 10 fs、σ_v = 100 fs），expected 文字的每個數字
    const hw = presetById('pm-mu10fs-hardware')!
    const gHw = hw.params.g as number
    const kq = comparatorKq(100)
    expect(gHw / kq).toBeCloseTo(10, 9)
    const hwPm = pmFirstOrder(gHw)
    expect(hwPm.pole).toBeCloseTo(0.92021, 5)
    expect(hwPm.omegaC).toBeCloseTo(0.07981, 5)
    expect(hwPm.pmDeg).toBeCloseTo(87.71, 2)
    expect(hwPm.delayMarginBlocks).toBeCloseTo(19.18, 2)
    expect(pmWithDelay(gHw, 6).pmDeg).toBeCloseTo(60.3, 1)
    expect(delayCriticalGain(0) / kq).toBeCloseTo(250.66, 2)
    expect(delayCriticalGain(1) / kq).toBeCloseTo(125.33, 2)
    expect(delayCriticalGain(2) / kq).toBeCloseTo(77.46, 2)
    expect(kq).toBeCloseTo(0.0079788, 7)
  })

  it('T09: dual-loop presets 的 expected 文字與模型一致（含 Gallery #5）', () => {
    const g5 = presetById('dual-loop-gallery-5')!
    expect(g5.galleryIndex).toBe(5)
    const p = g5.params as { r: number; b: number; c: number; mu: number }
    const a = analyzeDualLoop(p)
    expect(a.rho).toBeCloseTo(1.019804, 6)
    expect(a.fullRange.hi).toBeCloseTo(1, 12)
    expect(a.simplifiedRange.hi).toBeCloseTo(2, 12)
    const traj = simulateFullModel(p, 300).delta
    expect(peakAbs(traj, 0, 30)).toBeCloseTo(1.7, 2)
    expect(Math.abs(traj[100])).toBeCloseTo(0.43, 2)
    expect(peakAbs(traj, 100 - 13, 100)).toBeCloseTo(6.76, 2)
    expect(Math.abs(traj[300])).toBeCloseTo(204, 0)

    const slow = analyzeDualLoop(presetById('dual-loop-mu05-slow')!.params as typeof p)
    expect(-1 / Math.log(slow.simplifiedPole)).toBeCloseTo(1.44, 2)
    expect(-1 / Math.log(slow.rho)).toBeCloseTo(19, 0)

    const r0 = analyzeDualLoop(presetById('dual-loop-r0-delay')!.params as typeof p)
    expect(r0.fullRange.hi).toBeCloseTo(2, 12)
    expect(r0.simplifiedRange.hi).toBeCloseTo(4, 12)
    expect(r0.rho).toBeCloseTo(Math.sqrt(1.1), 12)

    const zlP = presetById('dual-loop-zero-latency')!.params as unknown as ObservationSystem & { mu: number }
    const zl = analyzeGeneral(zlP, zlP.mu)
    expect(zl.dcGain).toBeCloseTo(1, 12)
    expect(zl.simplifiedPole).toBeCloseTo(-4, 12)
    expect(zl.rho).toBeCloseTo(Math.sqrt(0.8), 10)
    const zlIv = stableIntervalsNumeric((mu) => analyzeGeneral(zlP, mu).rho, 0, 25, 801)
    expect(zlIv).toHaveLength(1)
    expect(zlIv[0].hi).toBeCloseTo(18, 6)

    const soP = presetById('dual-loop-second-order')!.params as unknown as ObservationSystem & { mu: number }
    const so = analyzeGeneral(soP, soP.mu)
    expect(so.dcGain).toBeCloseTo(1, 12)
    expect(so.simplifiedPole).toBeCloseTo(0.7, 12)
    expect(so.rho).toBeCloseTo(1.0045, 4)
    const soIv = stableIntervalsNumeric((mu) => analyzeGeneral(soP, mu).rho, 0, 3, 601)
    expect(soIv[0].hi).toBeCloseTo(0.284, 3)
  })
})
