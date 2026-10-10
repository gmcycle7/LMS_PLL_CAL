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
  simulateFullModel,
  stableIntervalsNumeric,
  type ObservationSystem,
} from '@/simulation/models/stability'
import Chapter08 from './index'
import { PmLab } from './experiments/PmLab'
import { DualLoopLab } from './experiments/DualLoopLab'
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
const SLOW = 60_000

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
      // KaTeX 沒有語法錯誤
      expect(container.querySelectorAll('.c-tex-error')).toHaveLength(0)
      expect(container.querySelectorAll('.katex-error')).toHaveLength(0)
      // 每個登錄的公式恰好一個錨點
      for (const f of FORMULAS) expect(container.querySelectorAll(`[id="formula-${f.id}"]`)).toHaveLength(1)
      // 符號表在章首（開場問題之後、第一個段落之前）：teaching-style §5
      expect(text.indexOf('本章符號')).toBeGreaterThan(0)
      expect(text.indexOf('本章符號')).toBeLessThan(text.indexOf('先用一個生活例子'))
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
      const phase = calls.flatMap((c) => c[1]).filter((t) => (t.name ?? '').includes('∠L'))
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
