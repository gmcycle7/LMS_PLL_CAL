import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { presetById, presetsForExperiment } from '@/app/presets'
import { MathText, extractRegion, listRegions } from '@/components'
import { analyseAlpha, eqOffset, inversionBands, kappaInfWorst, kappaRational, kernelMin, largeSignalPeriodic, loopF3dB, loopMargins, makeL1, oneDiffMargin, runSspllLms } from '@/simulation/models/sspll'
import CaseSspllPage from './index'
import { FORMULAS } from './formulas'
import { SYMBOLS } from './symbols'
import { FREF_MHZ, HPD, LMS_NOTE_ZH, LOOPS, PRED, SIGNMAP, SIM_CFG, mapIndex, mapIntervalsBelow } from './data'
import { MODEL_SRC, PY_SOURCES, fp, fs, fx, intervalsText, signClass, tx, txs } from './common'
import { HANDCALCS } from './handcalcs'
import { HPD_DEFAULTS, HPD_EXPERIMENT_ID, buildHpdLoop, closedFormEdgeMHz, mergeHpdParams } from './experiments/HpdExplorer'
import { SIGNMAP_EXPERIMENT_ID, SIGN_DEFAULTS, classify, mergeSignParams, modeSetup } from './experiments/SignMapExplorer'
import {
  GOLDEN_LMS_COND,
  LMS_CASE_LABEL,
  LMS_CASE_TEX,
  LMS_DEFAULTS,
  LMS_EXPERIMENT_ID,
  LMS_MC_RATIO_TOL,
  compareWithGolden,
  goldenTrace,
  gosRegressorHasDc,
  lmsCaseSetup,
  lmsCaseTag,
  mergeLmsParams,
  phosRegressorSum,
  predictCmDrift,
  predictPhosVerdict,
  type LmsCaseKind,
} from './experiments/ClosedLoopLms'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))

const M = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"><g></g></svg>`, diagramType: 'flowchart-v2' })),
}))
vi.mock('mermaid', () => ({ default: M }))

function renderPage(url = '/case/sspll', mode?: 'beginner' | 'engineer' | 'research') {
  if (mode) localStorage.setItem('lmspll.mode', mode)
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <CaseSspllPage />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

/** 去掉程式碼區塊後的頁面文字（原始碼裡本來就有 NaN、Infinity 等字樣） */
function proseText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.c-code, .c-code-compare, annotation').forEach((el) => el.remove())
  return clone.textContent ?? ''
}

/** 實驗 C 的警告「Case C（filtered-x（Ĥ = H））不收斂」：Ĥ = H 以 KaTeX 顯示，textContent 是 MathML＋HTML 的文字，所以括號內不逐字比對 */
const CASE_C_FX_DIVERGED = /Case C（filtered-x（[^）]*））不收斂/

/**
 * 字串屬性裡不該再出現的 Unicode 數學（希臘字母、上下標、不等號、根號…）與純文字下標（K_p、f_ref 這種「單一字母_下標」；
 * 檔名 pred_vs_sim.json 之類不算）；數學一律寫成 `$...$` 的 LaTeX。
 */
const UNICODE_MATH = /[α-ωΑ-Ω²³⁻¹⁰√≤≥≈≠≡≪≫∞∑∫∂⟺⇒∣∤⟨⟩ℓ₀-₉ᵀĤĥ]|\u0302|(?<![A-Za-z0-9_])[A-Za-z]_[A-Za-z{]/

/**
 * 會經過 mathText 的字串屬性在頁面上對應的元素（標題、警告、假設、指標名稱與註記、圖標題與圖說、程式碼標題、手算題的說明…）。
 * 不含：Plotly 圖內文字、下拉選單的 <option>、Mermaid 圖說、ParamControl 的 reg（這些不渲染 KaTeX，保留 Unicode）。
 */
const STRING_PROP_SELECTORS = [
  '.c-section-title',
  '.c-exp-title',
  '.c-exp-desc',
  '.c-exp-warnings p',
  '.c-assumption-list li',
  '.c-check-note',
  '.c-metric-table tbody td:first-child',
  '.c-plot-title',
  '.c-plot .c-figcaption',
  '.c-callout-title',
  '.c-prereq > summary',
  '.c-quiz-title',
  '.c-recap-title',
  '.c-recap-label',
  '.c-code-title',
  '.c-code-caption',
  '.c-code-compare-label',
  '.c-code-compare-note',
  '.c-steps-title',
  '.c-texblock-label',
  '.c-handcalc-title',
  '.c-handcalc-label',
  '.c-step-why',
  '.c-handcalc-notes li',
  '.c-handcalc-tips li',
  '.cs-hand-invite',
  '.cs-table caption',
  '.cs-table th',
  '.cs-table td',
]

/** 元素的文字，去掉 KaTeX 的輸出（裡面本來就有希臘字母）與程式碼 */
function textWithoutMath(el: Element): string {
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.katex, code, .c-code').forEach((x) => x.remove())
  return clone.textContent ?? ''
}

function traceNames(): string[] {
  return P.react.mock.calls.flatMap((c) => ((c as unknown as [unknown, { name?: string }[]])[1] ?? []).map((d) => d.name ?? ''))
}

/**
 * 清掉 plotly／mermaid mock 的呼叫紀錄。Plot 在 unmount 時呼叫 purge(gd)（react／Plots.resize 也收到 gd）：
 * mock 的呼叫紀錄會一直抓著 gd，也就是整棵已卸載的頁面 DOM——jsdom 的一頁約 10 萬個節點、實測約 390 MB。
 * 不清掉的話，整頁渲染 9 次左右 worker 就會 heap out of memory（加入 8 題帶入手算之後頁面變大，原本的測試因此在第 7 個測試當掉）。
 */
function clearMockCalls() {
  for (const m of [P.react, P.purge, P.toImage, P.downloadImage, P.Plots.resize, M.initialize, M.render]) m.mockClear()
}

// 放在 beforeEach：此時上一個測試的 RTL cleanup（unmount → purge）已經跑完，紀錄才清得乾淨
beforeEach(clearMockCalls)

afterEach(() => {
  localStorage.clear()
  P.react.mockClear()
})

describe('案例頁 /case/sspll（jsdom smoke）', () => {
  it('SSPLL: 完整渲染不丟錯——21 個段落、符號表、公式錨點、三個實驗、程式碼並排；沒有 KaTeX 錯誤或非有限數字', async () => {
    const { container } = renderPage('/case/sspll', 'engineer')
    // 符號表
    expect(container.querySelectorAll('.c-symbols tbody tr').length).toBe(SYMBOLS.length)
    expect(SYMBOLS.length).toBeGreaterThanOrEqual(30)
    expect(new Set(SYMBOLS.map((s) => s.symbol)).size).toBe(SYMBOLS.length)
    // 段落標題（H2）：0–20
    const h2 = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent ?? '')
    for (const t of [
      '0. 先講結論',
      '1. 本章符號',
      '2. 架構',
      '3. 從比較點到 PD',
      '4. LMS 的平均更新',
      '5. 為什麼',
      '6. 三個迴路',
      '7. GOS',
      '8. PHOS',
      '9. GOS 與 PHOS 一起看',
      '10. 模擬證據',
      '11. 對策',
      '12. 有限步長',
      '13. 比較器 DC offset',
      '14. 動手',
      '15. 設計 checklist',
      '16. 思考題',
      '17. 本課必記',
      '18. 連結到 PLL 硬體',
      '19. 仍未驗證的部分',
      '20. 檔案與重現方式',
    ]) {
      expect(h2.filter((x) => x.startsWith(t)).length, t).toBe(1)
    }
    // 每個登錄的公式都有唯一的 TexBlock 錨點
    const ids = Array.from(container.querySelectorAll('[id^="formula-F-CS"]')).map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of FORMULAS) expect(ids, f.id).toContain(`formula-${f.id}`)
    // KaTeX 都渲染成功
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(600)
    expect(container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
    // 三個實驗
    for (const id of [HPD_EXPERIMENT_ID, SIGNMAP_EXPERIMENT_ID, LMS_EXPERIMENT_ID]) expect(container.querySelector(`#exp-${id}`), id).not.toBeNull()
    // 帶入手算：HANDCALCS 的每一題都在頁面上各出現一次（依頁面順序），預設顯示帶入過程；綜合題（最後一題）排在思考題之前
    const hand = Array.from(container.querySelectorAll('.c-handcalc'))
    expect(hand.map((e) => e.id)).toEqual(HANDCALCS.map((h) => `handcalc-${h.id}`))
    expect(HANDCALCS.length).toBeGreaterThanOrEqual(5)
    for (const e of hand) expect(e.querySelectorAll('.c-step').length, e.id).toBeGreaterThanOrEqual(4)
    expect(container.querySelectorAll('.cs-hand-invite').length).toBe(HANDCALCS.length)
    const quiz = container.querySelector('#cs-16') as HTMLElement
    expect(hand[hand.length - 1].compareDocumentPosition(quiz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hand[hand.length - 2].compareDocumentPosition(hand[hand.length - 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 字串屬性裡的數學都寫成 `$...$`：這些元素去掉 KaTeX 之後，不該再有 Unicode 拼的公式（希臘字母、上下標、不等號…）
    let checkedProps = 0
    for (const sel of STRING_PROP_SELECTORS) {
      const els = Array.from(container.querySelectorAll(sel))
      expect(els.length, sel).toBeGreaterThan(0)
      for (const el of els) {
        expect(textWithoutMath(el), `${sel}：${(el.textContent ?? '').slice(0, 60)}`).not.toMatch(UNICODE_MATH)
        checkedProps++
      }
    }
    expect(checkedProps).toBeGreaterThan(400)
    // 實驗的標題、圖標題與公式標籤確實有 KaTeX（不是把 `$` 原樣印出來）
    for (const sel of ['.c-exp-title', '.c-plot-title', '.c-assumption-list li', '.c-texblock-label', '.c-handcalc-title', '.cs-hand-invite']) {
      expect(container.querySelectorAll(`${sel} .katex`).length, sel).toBeGreaterThan(0)
    }
    expect(proseText(container)).not.toMatch(/\$[^$\n]{1,80}\$/) // 沒有漏掉沒渲染的 `$...$`
    // 程式碼：region 都擷取成功、有差異行高亮、TS 與 Python 都出現
    expect(screen.queryByText(/找不到程式碼 region/)).toBeNull()
    expect(screen.queryByText(/程式碼載入錯誤/)).toBeNull()
    expect(container.querySelectorAll('.c-code-mark').length).toBeGreaterThanOrEqual(12)
    expect(container.querySelectorAll('code.language-python').length).toBeGreaterThanOrEqual(4)
    expect(container.querySelectorAll('code.language-typescript').length).toBeGreaterThanOrEqual(10)
    // 三層結論標籤都有用到
    const text = proseText(container)
    expect(text).toMatch(/精確｜指定模型/)
    expect(text).toMatch(/近似｜需驗證/)
    expect(text).toMatch(/研究假說/)
    // 頁面上不得出現 NaN / undefined / Infinity
    expect(text).not.toMatch(/NaN|undefined|Infinity|\[object Object\]/)
    // 關鍵數字（由資料與 TS port 產生）
    expect(text).toContain('134.820')
    expect(text).toContain('117.278')
    expect(text).toContain('32.68–125.33 MHz')
    expect(text).toContain('27.72–105.09 MHz')
    expect(text).toContain('0.388836')
    // 架構圖（mermaid）與圖表（plotly）
    await waitFor(() => expect(M.render).toHaveBeenCalled())
    await waitFor(() => {
      const names = traceNames()
      expect(names.some((n) => n.startsWith('Re H_PD（TS port'))).toBe(true)
      expect(names.some((n) => n.includes('golden JSON'))).toBe(true)
      expect(names.some((n) => n.startsWith('反號帶'))).toBe(true)
      expect(names.some((n) => n.startsWith('Re κ（ergodic'))).toBe(true)
    })
    // 預設的實驗 B（L2、83.5 MHz、raw）顯示反號警告；實驗 C 在參數穩定後自動執行（inline worker）
    expect(screen.getAllByText(/PHOS 反號/).length).toBeGreaterThan(0)
    const expC = container.querySelector(`#exp-${LMS_EXPERIMENT_ID}`) as HTMLElement
    await waitFor(() => expect(expC.textContent).toMatch(/Case A（raw）不收斂/), { timeout: 60000 })
    expect(expC.textContent).not.toMatch(/Case B（一階差分）不收斂/)
  }, 120000)

  it('SSPLL: Beginner 模式顯示入門四句話並收起程式碼；Research 模式顯示研究註記', () => {
    const a = renderPage('/case/sspll', 'beginner')
    expect(screen.getByText('入門模式：先抓住四句話')).toBeTruthy()
    // regressor 的核心程式碼並排在任何模式都顯示（使用者明確要求看核心程式碼）
    expect(a.container.querySelectorAll('.c-code-mark').length).toBeGreaterThanOrEqual(6)
    a.unmount()
    clearMockCalls()
    renderPage('/case/sspll', 'research')
    expect(screen.queryByText('入門模式：先抓住四句話')).toBeNull()
    expect(screen.getByText(/Research 註記/)).toBeTruthy()
  }, 120000)

  it('SSPLL: ?preset=sspll-l2-inband 載入實驗 B：84 MHz、raw ⇒ PHOS 反號；改 sspll-l2-1diff ⇒ 沒有反號警告', async () => {
    const a = renderPage('/case/sspll?preset=sspll-l2-inband')
    const expB = () => a.container.querySelector(`#exp-${SIGNMAP_EXPERIMENT_ID}`) as HTMLElement
    await waitFor(() => expect(expB().textContent).toContain('=21/1000'))
    expect(expB().textContent).toMatch(/PHOS 反號：mode 1/)
    expect(expB().textContent).toMatch(/0\.13953/)
    a.unmount()
    clearMockCalls()
    const b = renderPage('/case/sspll?preset=sspll-l2-1diff')
    const expB2 = () => b.container.querySelector(`#exp-${SIGNMAP_EXPERIMENT_ID}`) as HTMLElement
    await waitFor(() => expect(expB2().textContent).toContain('=21/1000'))
    expect(expB2().textContent).not.toMatch(/PHOS 反號/)
    expect(expB2().textContent).toContain('0.09836')
  }, 120000)

  it('SSPLL: ?preset=sspll-l1-nominal 載入實驗 A：L1 沒有反號帶，TS port 與 golden JSON 一致', async () => {
    const { container } = renderPage('/case/sspll?preset=sspll-l1-nominal')
    const expA = () => container.querySelector(`#exp-${HPD_EXPERIMENT_ID}`) as HTMLElement
    await waitFor(() => expect(expA().textContent).toContain('無（整個頻帶 Re H_PD ≥ 0）'))
    expect(expA().textContent).toContain('0.388836')
    expect(expA().querySelector('.c-check-ok')).not.toBeNull()
    expect(expA().querySelector('.c-check-mismatch')).toBeNull()
  }, 120000)

  it('SSPLL: 三個實驗的每一個 preset 都能載入——沒有 KaTeX 錯誤，也沒有非有限數字', async () => {
    const { container } = renderPage('/case/sspll', 'research')
    for (const id of [HPD_EXPERIMENT_ID, SIGNMAP_EXPERIMENT_ID, LMS_EXPERIMENT_ID]) {
      const exp = container.querySelector(`#exp-${id}`) as HTMLElement
      const select = exp.querySelector('.c-exp-presets select') as HTMLSelectElement
      const n = select.options.length - 1
      expect(n, id).toBeGreaterThanOrEqual(8)
      for (let i = 0; i < n; i++) {
        fireEvent.change(select, { target: { value: String(i) } })
        await waitFor(() => {
          expect(exp.querySelectorAll('.katex-error, .c-tex-error').length, `${id} preset ${i}`).toBe(0)
          expect(proseText(exp), `${id} preset ${i}`).not.toMatch(/NaN|undefined|Infinity|\[object Object\]/)
        })
      }
    }
    // 載入過「L1 延遲 5 拍」：Type-I 也出現反號帶（實驗 A 最後停在 L3 ZOH）
    expect((container.querySelector(`#exp-${HPD_EXPERIMENT_ID}`) as HTMLElement).textContent).toMatch(/反號帶/)
  }, 180000)

  it('SSPLL: 實驗 C（inline worker）：自動執行後 raw 不收斂、1diff 與 filtered-x 收斂；再按「執行 Run」可重跑', async () => {
    const { container } = renderPage('/case/sspll?preset=sspll-cl-l2-inband')
    const expC = () => container.querySelector(`#exp-${LMS_EXPERIMENT_ID}`) as HTMLElement
    await waitFor(() => expect(expC().textContent).toMatch(/Case A（raw）不收斂/), { timeout: 60000 })
    expect(expC().textContent).not.toMatch(/Case B（一階差分）不收斂/)
    expect(expC().textContent).not.toMatch(CASE_C_FX_DIVERGED)
    expect(expC().textContent).not.toMatch(/即時模擬尚未完成|即時模擬執行中/)
    // 小訊號預測（κ_PHOS 的符號）與閉迴路結果一致 → Analytic 為 ok；即時模擬與 golden 存檔在同一個 block 的 PHOS rms 相差不到 4 倍 → Monte Carlo 為 ok
    const cc = expC().querySelector('.c-exp-crosscheck') as HTMLElement
    expect(cc.querySelectorAll('.c-check-ok').length).toBe(2)
    expect(cc.querySelector('.c-check-mismatch')).toBeNull()
    expect(cc.textContent).toMatch(/3 個比對、0 個不一致/)
    expect(cc.textContent).toMatch(/3 個 case、0 個超出 4 倍/)
    // Fixed-Point 沒有實作：必須明確顯示
    expect(cc.textContent).toMatch(/Not implemented/)
    expect(expC().textContent).toMatch(/第 1400 block 的 PHOS rms，即時／golden 存檔的比值/)
    await waitFor(() => {
      const names = traceNames()
      expect(names.some((n) => n.startsWith('Case A：raw（TS，即時）'))).toBe(true)
      expect(names.some((n) => n.startsWith('Case A：raw（golden 存檔）'))).toBe(true)
    })
    // 手動重跑
    const runBtn = await waitFor(() => {
      const b = Array.from(expC().querySelectorAll('button')).find((x) => (x.textContent ?? '').includes('執行 Run'))
      expect(b).toBeTruthy()
      return b as HTMLElement
    })
    fireEvent.click(runBtn)
    await waitFor(() => expect(expC().textContent).toMatch(/Case A（raw）不收斂/), { timeout: 60000 })
  }, 180000)

  it('SSPLL: 實驗 C 加比較器 offset（?preset=sspll-cl-l2-offset）：raw 的共模漂移符合 forcing 公式；與 golden 存檔條件不同 ⇒ Monte Carlo 為 n/a', async () => {
    const { container } = renderPage('/case/sspll?preset=sspll-cl-l2-offset')
    const expC = () => container.querySelector(`#exp-${LMS_EXPERIMENT_ID}`) as HTMLElement
    await waitFor(() => expect(expC().textContent).toMatch(/Case A（raw）的 PHOS 共模漂移到/), { timeout: 60000 })
    const text = expC().textContent ?? ''
    // offset 的 forcing 要有解釋；zero-mean 的 case 不漂
    expect(text).toMatch(/與誤差無關的 forcing 項/)
    expect(text).not.toMatch(/Case B（zm（GOS、PHOS 都去平均））的 PHOS 共模漂移到/)
    expect(text).not.toMatch(/Case C（一階差分）的 PHOS 共模漂移到/)
    expect(text).toMatch(/Case A（raw）的 GOS 被比較器 offset 推偏/)
    // Analytic：共模漂移 vs B·μ_p·E[q]/8（三個 case 都比對）；Monte Carlo：條件與 golden 不同 ⇒ n/a，不疊 golden 軌跡
    const cc = expC().querySelector('.c-exp-crosscheck') as HTMLElement
    expect(cc.textContent).toMatch(/PHOS 共模漂移 vs forcing 公式/)
    expect(cc.textContent).toMatch(/3 個比對、0 個不一致/)
    expect(cc.querySelectorAll('.c-check-ok').length).toBe(1)
    expect(cc.querySelector('.c-check-mismatch')).toBeNull()
    expect(cc.textContent).toMatch(/沒有可比的參考/)
    expect(traceNames().some((n) => n.includes('golden 存檔'))).toBe(false)
    expect(proseText(expC())).not.toMatch(/NaN|undefined|Infinity|\[object Object\]/)
  }, 180000)

  it('SSPLL: 內文引用的「試試看」數字與敘述一致——491.5 MHz 的大訊號、filtered-x 的 Type-I 模型、帶緣 127 MHz 的有限步長', async () => {
    // 491.5 MHz（α = 983/8000，1/8 正下方）：raw 的 κ∞ 明顯為負；L2 換 ac 仍略為負；1diff 為正；L1 換 ac 為正
    const ls = (loop: 'L1' | 'L2', v: string) => kappaInfWorst(largeSignalPeriodic(LOOPS[loop], 983, 8000, SIM_CFG, v))
    expect(ls('L2', 'raw')).toBeLessThan(-0.3)
    expect(ls('L2', 'ac')).toBeLessThan(-1e-3)
    expect(ls('L2', 'ac')).toBeGreaterThan(-0.1)
    expect(ls('L2', '1diff')).toBeGreaterThan(1e-3)
    expect(ls('L1', 'ac')).toBeGreaterThan(1e-3)
    expect(ls('L2', 'raw')).toBeCloseTo(SIGNMAP.L2.LSinf[mapIndex(491.5)], 3)
    expect(ls('L2', 'ac')).toBeCloseTo(SIGNMAP.L2.LSinf_ac[mapIndex(491.5)], 3)
    // filtered-x 的 Type-I 模型（L2、71.5 MHz）：K̂ = 0.1 已低於臨界值 0.1247——kernel 有負值，但 κ_PHOS 仍為正；K̂ = 0.05 才反號
    const fxI = (k: number) => analyseAlpha(LOOPS.L2, 71.5 / FREF_MHZ, 'fx:typeI', { typeI: makeL1({ K: k }) }).kappaPhos
    expect(fxI(0.2)).toBeGreaterThan(0.05)
    expect(fxI(0.1)).toBeGreaterThan(1e-3)
    expect(fxI(0.05)).toBeLessThan(-1e-2)
    expect(kernelMin(LOOPS.L2, 'fx:typeI', { typeI: makeL1({ K: 0.1 }) }).min).toBeLessThan(-1e-3)
    expect(kernelMin(LOOPS.L2, 'fx:typeI', { typeI: makeL1({ K: 0.13 }) }).min).toBeGreaterThan(-1e-12)
    // 帶緣 127 MHz：Re κ > 0，N_τ = 25 不穩定、50 穩定
    const e = analyseAlpha(LOOPS.L2, 127 / FREF_MHZ)
    const w = e.kappaM[e.worstMode - 1]
    expect(w.re).toBeGreaterThan(0)
    expect(w.re).toBeLessThan((w.re ** 2 + w.im ** 2) / 50)
    expect(w.re).toBeGreaterThan((w.re ** 2 + w.im ** 2) / 100)
    // 頁面上對應的文字
    const { container } = renderPage('/case/sspll', 'engineer')
    const text = proseText(container)
    expect(text).toMatch(/臨界值是「保證」的界線/)
    expect(text).toMatch(/Type-II 的 near-grid 只去平均還不夠/)
    // §11.2 的掃描表：K̂ = 0.12、0.1 沒有反號，0.05 在 54.5–87.5 MHz 反號
    const rows = Array.from(container.querySelectorAll('tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? ''))
    const scanRow = (k: string) => rows.find((c) => c.length === 3 && c[0] === k && /@ [\d.]+ MHz$/.test(c[1]))
    expect(scanRow('0.12')?.[2]).toBe('無（全為正）')
    expect(scanRow('0.1')?.[2]).toBe('無（全為正）')
    expect(scanRow('0.05')?.[2]).toBe('54.5–87.5')
    expect(scanRow('0.05')?.[1]).toMatch(/^−0\.0153 @ 71\.5 MHz$/)
    // §11.1 的補充：L1 延遲 5 拍的 1diff margin 為負
    expect(text).toMatch(/1diff 也會反號/)
    // 內文與表格不出現 1e−5 這種寫法（一律 LaTeX）；共用 MetricTable 的數值欄（fmtNum）不在此限
    const noMetrics = container.cloneNode(true) as HTMLElement
    noMetrics.querySelectorAll('.c-code, .c-code-compare, annotation, .c-metric-table, .c-exp-metrics').forEach((el) => el.remove())
    expect(noMetrics.textContent ?? '').not.toMatch(/\de[−-]\d/)
  }, 120000)
})

describe('SSPLL 案例頁的公式登錄、presets 與實驗輔助函式', () => {
  it('SSPLL: FORMULAS——ID 唯一、格式 F-CS.n、頁面 /case/sspll、claim 合法', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(18)
    for (const f of FORMULAS) {
      expect(f.id).toMatch(/^F-CS\.\d+$/)
      expect(f.page).toBe('/case/sspll')
      expect(['exact', 'approx', 'research']).toContain(f.claim)
      expect(f.tex.length).toBeGreaterThan(10)
      expect(f.conditions.length).toBeGreaterThan(5)
    }
  })

  it('SSPLL: FORMULAS 的 title／conditions——數學一律寫成 `$...$`（沒有 Unicode 拼的公式），以 mathText 渲染沒有 KaTeX 錯誤', () => {
    let withMath = 0
    for (const f of FORMULAS) {
      for (const [key, text] of [
        ['title', f.title],
        ['conditions', f.conditions],
      ] as const) {
        // `$...$` 以外的文字不含 Unicode 數學；`$` 成對
        const outside = text.replace(/\$[^$]*\$/g, '')
        expect(outside, `${f.id}.${key}`).not.toMatch(UNICODE_MATH)
        expect(outside, `${f.id}.${key}`).not.toContain('$')
        expect(text, `${f.id}.${key}`).not.toMatch(/[α-ωΑ-Ω²³⁻¹√≤≥≈≠∞]/)
        const n = (text.match(/\$[^$]*\$/g) ?? []).length
        withMath += n
        const { container, unmount } = render(<MathText>{text}</MathText>)
        expect(container.querySelectorAll('.katex').length, `${f.id}.${key}`).toBe(n)
        expect(container.querySelectorAll('.katex-error, .c-tex-error').length, `${f.id}.${key}`).toBe(0)
        unmount()
      }
    }
    expect(withMath).toBeGreaterThanOrEqual(50)
    // 幾個代表：條件裡的公式確實是 LaTeX
    const by = (id: string) => FORMULAS.find((f) => f.id === id)!
    expect(by('F-CS.2').conditions).toContain('$\\lvert e_{PD}\\rvert\\ll\\sigma_v$')
    expect(by('F-CS.6').conditions).toContain('$\\iff K(d-\\tfrac12)>1$')
    expect(by('F-CS.7').title).toContain('$\\mathrm{Re}\\,H_{PD}$')
    expect(by('F-CS.13').title).toContain('$8\\times8$')
  })

  it('SSPLL: 實驗 C 的 case 標籤——警告／指標／表格用 `$...$` 版（KaTeX），下拉選單與 Plotly 圖例用純文字版', () => {
    const kinds = Object.keys(LMS_CASE_LABEL) as LmsCaseKind[]
    expect(Object.keys(LMS_CASE_TEX)).toEqual(kinds)
    for (const k of kinds) {
      expect(LMS_CASE_LABEL[k], k).not.toContain('$') // <option> 與圖例不渲染 KaTeX
      if (k !== 'fx' && k !== 'D1') expect(LMS_CASE_TEX[k], k).toBe(LMS_CASE_LABEL[k])
      expect(LMS_CASE_TEX[k].replace(/\$[^$]*\$/g, ''), k).not.toMatch(UNICODE_MATH)
      const { container, unmount } = render(<MathText>{lmsCaseTag('A', k)}</MathText>)
      expect(container.querySelectorAll('.katex-error, .c-tex-error').length, k).toBe(0)
      unmount()
    }
    expect(lmsCaseTag('C', 'fx')).toBe('Case C（filtered-x（$\\hat H=H$））')
    expect(lmsCaseTag('B', 'D1')).toBe('Case B（$D=+1$（有害））')
    expect(lmsCaseTag('B', '1diff')).toBe('Case B（一階差分）')
    // 頁面測試用來確認「Case C 沒有發散」的 regex，真的對得上這個警告渲染之後的文字
    const { container } = render(<MathText>{`${lmsCaseTag('C', 'fx')}不收斂：PHOS 誤差 rms 由 1 fs 變成 2 fs。`}</MathText>)
    expect(container.querySelectorAll('.katex').length).toBe(1)
    expect(container.textContent).toMatch(CASE_C_FX_DIVERGED)
    expect(`${lmsCaseTag('B', '1diff')}不收斂`).not.toMatch(CASE_C_FX_DIVERGED)
  })

  it('SSPLL: presets——四個指定的 preset 存在、指向本頁的實驗，expected 的數字由 TS port 重現', () => {
    const want: Record<string, string> = {
      'sspll-l2-inband': SIGNMAP_EXPERIMENT_ID,
      'sspll-l2-1diff': SIGNMAP_EXPERIMENT_ID,
      'sspll-l1-nominal': HPD_EXPERIMENT_ID,
      'sspll-l3-near-integer': SIGNMAP_EXPERIMENT_ID,
      'sspll-cl-l2-inband': LMS_EXPERIMENT_ID,
      'sspll-cl-l2-offset': LMS_EXPERIMENT_ID,
    }
    for (const [id, exp] of Object.entries(want)) {
      const p = presetById(id)
      expect(p, id).toBeTruthy()
      expect(p!.page).toBe('/case/sspll')
      expect(p!.experiment).toBe(exp)
      expect(p!.source).toBe('simulation')
    }
    expect(presetsForExperiment(SIGNMAP_EXPERIMENT_ID).length).toBe(3)
    // sspll-l2-inband：α·f_ref = 84 MHz、raw ⇒ 反號
    const inband = mergeSignParams(SIGN_DEFAULTS, presetById('sspll-l2-inband')!.params)
    expect(inband).toMatchObject({ loop: 'L2', fMHz: 84, mode: 'raw' })
    const sa = modeSetup(inband.loop, inband.mode, inband.kHat)
    const a = analyseAlpha(sa.loop, inband.fMHz / FREF_MHZ, sa.variant, sa.models)
    expect(a.kappaPhos).toBeCloseTo(-0.13953, 5)
    expect(a.worstMode).toBe(1)
    expect(a.kappaM[1].re).toBeCloseTo(0.4006, 4)
    expect(a.kappaM[2].re).toBeCloseTo(0.83, 3)
    expect(a.kappaM[3].re).toBeCloseTo(0.9439, 4)
    expect(a.singleLine).toBeCloseTo(-0.19495, 5)
    expect(a.m1Upper).toBeCloseTo(-0.1355, 4)
    expect(a.kappaGos).toBeCloseTo(1.105, 4)
    expect(classify(a.kappaPhos, 1e-3)).toBe('inverted')
    expect(kappaInfWorst(largeSignalPeriodic(sa.loop, 21, 1000, SIM_CFG, 'raw'))).toBeCloseTo(-0.5656, 4)
    // sspll-l2-1diff：同一個 α、一階差分 ⇒ 安全
    const d1 = mergeSignParams(SIGN_DEFAULTS, presetById('sspll-l2-1diff')!.params)
    expect(d1).toMatchObject({ loop: 'L2', fMHz: 84, mode: '1diff' })
    const sb = modeSetup(d1.loop, d1.mode, d1.kHat)
    const b = analyseAlpha(sb.loop, d1.fMHz / FREF_MHZ, sb.variant, sb.models)
    expect(b.kappaPhos).toBeCloseTo(0.09836, 5)
    expect(b.kappaM[1].re).toBeCloseTo(0.3936, 4)
    expect(b.kappaGos).toBeCloseTo(1.1867, 4)
    expect(b.m1Lower).toBeCloseTo(0.0399, 4)
    expect(classify(b.kappaPhos, 1e-3)).toBe('restoring')
    expect(kappaRational(sb.loop, 21, 1000, '1diff').kJ).toBeCloseTo(0.09836, 5)
    expect(kappaInfWorst(largeSignalPeriodic(sb.loop, 21, 1000, SIM_CFG, '1diff'))).toBeCloseTo(0.139, 3)
    expect(oneDiffMargin(LOOPS.L2).min).toBeCloseTo(0.2686, 4)
    // sspll-l1-nominal
    const l1 = mergeHpdParams(HPD_DEFAULTS, presetById('sspll-l1-nominal')!.params)
    const lp = buildHpdLoop(l1)
    expect(Number(lp.params.K)).toBeCloseTo(0.388836, 6)
    expect(loopMargins(lp).pmDeg).toBeCloseTo(78.79, 2)
    expect(loopF3dB(lp) * FREF_MHZ).toBeCloseTo(320, 6)
    expect(inversionBands(lp)).toEqual([])
    expect(0.5 * Number(lp.params.K)).toBeCloseTo(0.1944, 4)
    expect(oneDiffMargin(lp).min).toBeCloseTo(0.3888, 4)
    // sspll-l3-near-integer
    const l3 = mergeSignParams(SIGN_DEFAULTS, presetById('sspll-l3-near-integer')!.params)
    expect(l3).toMatchObject({ loop: 'L3', fMHz: 8, mode: 'raw' })
    const c = analyseAlpha(LOOPS.L3, l3.fMHz / FREF_MHZ)
    expect(c.kappaPhos * 1e5).toBeCloseTo(-2.06, 2)
    expect(classify(c.kappaPhos, 1e-3)).toBe('dead')
    expect(c.singleLine).toBeCloseTo(-0.00596, 5)
    expect(c.kappaGos).toBeCloseTo(0.1235, 4)
    expect(kappaRational(LOOPS.L3, 1, 500).kP * 1e5).toBeCloseTo(-2.07, 2)
    expect(kappaInfWorst(largeSignalPeriodic(LOOPS.L3, 1, 500, SIM_CFG, 'raw'))).toBeCloseTo(-0.841, 3)
    expect(analyseAlpha(LOOPS.L3, l3.fMHz / FREF_MHZ, '1diff').kappaPhos).toBeCloseTo(0.0094, 4)
    expect(PRED.lms['L3|0.002|raw'].final_phos_rms_fs / 1000).toBeCloseTo(11.6, 1)
    expect(PRED.lms['L3|0.002|1diff'].final_phos_rms_fs).toBeCloseTo(22, 0)
    // sspll-cl-l2-inband：golden 存檔與小訊號預測
    const cl = mergeLmsParams(LMS_DEFAULTS, presetById('sspll-cl-l2-inband')!.params)
    expect(cl).toMatchObject({ loop: 'L2', fMHz: 80, caseA: 'raw', caseB: '1diff', caseC: 'fx', nBlocks: 1500 })
    expect(PRED.lms['L2|0.02|raw'].final_phos_rms_fs / 1000).toBeCloseTo(28.4, 1)
    expect(PRED.lms['L2|0.02|raw'].phos_rms_med_fs[3] / 1000).toBeCloseTo(1.83, 2)
    expect(PRED.lms['L2|0.02|1diff'].final_phos_rms_fs).toBeCloseTo(6.2, 1)
    expect(PRED.lms['L2|0.02|fx:exact'].final_phos_rms_fs).toBeCloseTo(4.4, 1)
    expect(analyseAlpha(LOOPS.L2, 0.02).kappaPhos).toBeCloseTo(-0.138, 3)
    expect(analyseAlpha(LOOPS.L2, 0.02, '1diff').kappaPhos).toBeCloseTo(0.091, 3)
    // sspll-cl-l2-offset
    const off = mergeLmsParams(LMS_DEFAULTS, presetById('sspll-cl-l2-offset')!.params)
    expect(off).toMatchObject({ fMHz: 548, uOsFs: 25, caseB: 'zm', caseC: '1diff' })
    expect(PRED.offset_lms['L2|0.137|u=25|raw'].gos_fs).toBeCloseTo(133, 0)
    expect(PRED.offset_lms['L2|0.137|u=25|raw'].phos_cm_fs / 1000).toBeCloseTo(3.9, 1)
    expect(PRED.offset_lms['L2|0.137|u=25|zm'].gos_fs).toBeCloseTo(2.8, 1)
    expect(PRED.offset_lms['L2|0.137|u=25|1diff'].gos_fs).toBeCloseTo(7.4, 1)
    // 本頁的即時模擬（1500 blocks、seed 3）：raw 的共模約 1.4–1.5 ps（公式 1.50 ps）、GOS 偏差約 0.13–0.15 ps；zm 的共模為 0
    const offRaw = runSspllLms({ loop: LOOPS.L2, alpha: 548 / FREF_MHZ, variant: 'raw', cfg: SIM_CFG, nBlocks: off.nBlocks, nBlk: off.nBlk, tauBlocks: off.tauBlocks, seed: 3, recEvery: 10, lanes: off.lanes, uOsPs: off.uOsFs / 1000 })
    const dOff = predictCmDrift('raw', offRaw.muP, off.uOsFs, 200, off.nBlocks, off.nBlk)
    expect(dOff.predFs / 1000).toBeCloseTo(1.5, 2)
    expect(offRaw.finalPhosCmFs / 1000).toBeGreaterThan(1.4)
    expect(offRaw.finalPhosCmFs / 1000).toBeLessThan(1.5)
    expect(Math.abs(offRaw.finalPhosCmFs - dOff.predFs)).toBeLessThan(dOff.tolFs)
    expect(offRaw.finalGosFs).toBeGreaterThan(130)
    expect(offRaw.finalGosFs).toBeLessThan(150)
    const offZm = runSspllLms({ loop: LOOPS.L2, alpha: 548 / FREF_MHZ, variant: 'zm', cfg: SIM_CFG, nBlocks: off.nBlocks, nBlk: off.nBlk, tauBlocks: off.tauBlocks, seed: 3, recEvery: 10, lanes: off.lanes, uOsPs: off.uOsFs / 1000 })
    expect(offZm.finalPhosCmFs).toBeLessThan(1e-6)
    expect(offZm.finalGosFs).toBeLessThan(20)
    // sspll-cl-l2-inband：第 1400 block 即時模擬與 golden 軌跡相差不到 10%
    const inRaw = runSspllLms({ loop: LOOPS.L2, alpha: 0.02, variant: 'raw', cfg: SIM_CFG, nBlocks: cl.nBlocks, nBlk: cl.nBlk, tauBlocks: cl.tauBlocks, seed: 3, recEvery: 10, lanes: cl.lanes })
    const cmpIn = compareWithGolden(inRaw, PRED.lms['L2|0.02|raw'])!
    expect(cmpIn.block).toBe(1400)
    expect(Math.abs(cmpIn.ratio - 1)).toBeLessThan(0.1)
  })

  it('SSPLL: 實驗 A 的輔助函式——參數合併、迴路建立、closed form 帶緣', () => {
    expect(mergeHpdParams(HPD_DEFAULTS, null)).toBe(HPD_DEFAULTS)
    expect(mergeHpdParams(HPD_DEFAULTS, { loop: 'L9', bwMHz: 1e9, lat: 2.4, mapping: 'bogus' })).toMatchObject({ loop: 'L2', bwMHz: 320, lat: 2, mapping: 'impulse' })
    const l2 = buildHpdLoop(HPD_DEFAULTS)
    expect(closedFormEdgeMHz(HPD_DEFAULTS, l2)).toBeCloseTo(134.82, 2)
    expect(closedFormEdgeMHz(HPD_DEFAULTS, l2)).toBeCloseTo(inversionBands(l2)[0].fHi * FREF_MHZ, 6)
    const p3 = { ...HPD_DEFAULTS, loop: 'L3' as const }
    const l3 = buildHpdLoop(p3)
    expect(closedFormEdgeMHz(p3, l3)).toBeCloseTo(117.278, 3)
    expect(closedFormEdgeMHz({ ...p3, mapping: 'zoh' }, buildHpdLoop({ ...p3, mapping: 'zoh' }))).toBeNull()
    expect(closedFormEdgeMHz({ ...HPD_DEFAULTS, loop: 'L1' }, buildHpdLoop({ ...HPD_DEFAULTS, loop: 'L1' }))).toBeNull()
    // PVT：gain ×1.5 不重新設計
    const g = buildHpdLoop({ ...HPD_DEFAULTS, gainScale: 1.5 })
    expect(inversionBands(g)[0].fHi * FREF_MHZ).toBeCloseTo(172.73, 2)
    // L1 延遲 5 拍：出現反號帶
    expect(inversionBands(buildHpdLoop({ ...HPD_DEFAULTS, loop: 'L1', lat: 5 })).length).toBe(1)
    // 手動 Kp、Ki
    const man = buildHpdLoop({ ...HPD_DEFAULTS, manual: true, Kp: 0.3, Ki: 0.05 })
    expect(man.params).toMatchObject({ Kp: 0.3, Ki: 0.05 })
    // golden 格點與 TS port 的格點一致
    expect(HPD.L2.f_MHz.length).toBe(1500)
    expect(HPD.L2.f_MHz[HPD.L2.f_MHz.length - 1]).toBe(2000)
  })

  it('SSPLL: 實驗 B／C 的輔助函式——模式對應、分類、signmap 索引、golden 軌跡', () => {
    expect(classify(-0.01, 1e-3)).toBe('inverted')
    expect(classify(5e-4, 1e-3)).toBe('dead')
    expect(classify(0.2, 1e-3)).toBe('restoring')
    expect(modeSetup('L2', 'ponly', 0.1).loop.type).toBe(1)
    expect(modeSetup('L2', 'ponly', 0.1).colP).toBe('kP_Ponly')
    expect(modeSetup('L1', 'ponly', 0.1).colP).toBe('kP')
    expect(modeSetup('L2', 'fxTypeI', 0.2).models?.typeI.params.K).toBe(0.2)
    expect(modeSetup('L3', 'D1', 0.1).variant).toBe('D:1')
    expect(mergeSignParams(SIGN_DEFAULTS, { alpha: 0.25, mode: 'nope', tau: 0.5 })).toMatchObject({ fMHz: 1000, mode: 'raw', tau: 1e-3 })
    expect(mapIndex(83.5)).toBe(83)
    expect(mapIndex(4000 - 83.5)).toBe(83)
    expect(SIGNMAP.L2.f_MHz[mapIndex(83.5)]).toBe(83.5)
    expect(SIGNMAP.L1.kP_Ponly).toBeNull()
    // 閉迴路
    expect(lmsCaseSetup('L2', 'off')).toBeNull()
    expect(lmsCaseSetup('L2', 'ponly-raw')?.loop.type).toBe(1)
    expect(lmsCaseSetup('L3', 'fx')?.variant).toBe('fx:exact')
    expect(goldenTrace('L2', 0.02, 'raw')?.key).toBe('L2|0.02|raw')
    expect(goldenTrace('L2', 0.02, 'raw|Ponly')?.key).toBe('L2|0.02|raw|Ponly')
    expect(goldenTrace('L2', 0.021, 'raw')).toBeNull()
    expect(goldenTrace('L2', 0.02, null)).toBeNull()
    expect(mergeLmsParams(LMS_DEFAULTS, { nBlocks: 1e9, lanes: 2.2, caseB: 'zm', uOsFs: 9999 })).toMatchObject({ nBlocks: 1500, lanes: 2, caseB: 'zm', uOsFs: 0 })
  })

  it('SSPLL: 實驗 C 的交叉比對輔助函式——與 golden 軌跡在同一個 block 比較；offset 的共模漂移公式；signmap 區間', () => {
    // compareWithGolden：取 golden 有記錄、且不超過即時模擬長度的最後一個 block
    const trace = PRED.lms['L2|0.02|raw']
    const live = { block: Float64Array.from([0, 7, 14, 196, 203, 399, 406, 500]), phosRmsFs: Float64Array.from([173, 180, 190, 500, 520, 1000, 1010, 1300]) }
    const c = compareWithGolden(live, trace)!
    expect(c.block).toBe(400)
    expect(c.liveFs).toBe(1000) // 最接近 400 的記錄點是 399
    expect(c.goldenFs).toBe(trace.phos_rms_med_fs[trace.blocks.indexOf(400)])
    expect(c.ratio).toBeCloseTo(1000 / c.goldenFs, 12)
    expect(compareWithGolden({ block: Float64Array.from([0, 50, 100]), phosRmsFs: Float64Array.from([173, 170, 160]) }, trace)).toBeNull() // 不到 200 blocks
    expect(GOLDEN_LMS_COND).toEqual({ nBlk: 512, tauBlocks: 25, uOsFs: 0 })
    // 真的跑一次 TS 的閉迴路 LMS：與 golden 存檔在第 400 block 的 PHOS rms 相差不到容許倍率（raw 發散的成長率是決定性的，其實在 10% 以內）
    const r = runSspllLms({ loop: LOOPS.L2, alpha: 0.02, variant: 'raw', cfg: SIM_CFG, nBlocks: 400, nBlk: 512, tauBlocks: 25, seed: 5, recEvery: 10, lanes: 2 })
    const cmp = compareWithGolden(r, trace)!
    expect(cmp.block).toBe(400)
    expect(cmp.ratio).toBeGreaterThan(1 / LMS_MC_RATIO_TOL)
    expect(cmp.ratio).toBeLessThan(LMS_MC_RATIO_TOL)
    expect(Math.abs(Math.log(cmp.ratio))).toBeLessThan(0.15)
    // regressor 的 DC：決定 offset 的 forcing
    expect(['raw', 'ac', 'D:1'].map(phosRegressorSum)).toEqual([1, 1, 1])
    expect(['zm', '1diff', '2diff', 'fx:exact'].map(phosRegressorSum)).toEqual([0, 0, 0, 0])
    expect(['raw', 'D:1'].map(gosRegressorHasDc)).toEqual([true, true])
    expect(['ac', 'zm', '1diff', 'fx:exact'].map(gosRegressorHasDc)).toEqual([false, false, false, false])
    // 共模漂移公式 B·μ_p·E[q]/8：golden 的 4000 blocks、u_os = 25 fs、raw（μ_p = 8/(N_τ·K_q)）⇒ 約 3.99 ps；golden 的閉迴路 LMS 量到 3.885 ps
    const muP = 8 / (25 * (Math.sqrt(2 / Math.PI) / SIM_CFG.sigmaPs))
    const d = predictCmDrift('raw', muP, 25, 200, 4000, 512)
    expect(d.predFs).toBeCloseTo((4000 * muP * 1000 * eqOffset(25, 200)) / 8, 9)
    expect(Math.abs(PRED.offset_lms['L2|0.137|u=25|raw'].phos_cm_fs - d.predFs)).toBeLessThan(d.tolFs)
    expect(d.valid).toBe(true)
    // u_os = 100 fs 已經不是小 offset：公式（15.4 ps）是上限，golden 量到 10.5 ps ⇒ 標成不適用，不拿來比對
    const d100 = predictCmDrift('raw', muP, 100, 200, 4000, 512)
    expect(d100.valid).toBe(false)
    expect(d100.predFs).toBeGreaterThan(PRED.offset_lms['L2|0.137|u=100|raw'].phos_cm_fs)
    expect(PRED.offset_lms['L2|0.137|u=100|raw'].phos_cm_fs / 1000).toBeCloseTo(10.5, 1)
    expect(predictCmDrift('zm', muP, 25, 200, 4000, 512).predFs).toBe(0)
    expect(PRED.offset_lms['L2|0.137|u=25|zm'].phos_cm_fs).toBeLessThan(predictCmDrift('zm', muP, 25, 200, 4000, 512).tolFs)
    // 有限步長的平均模型：N_τ,eff = 8/(μ_p K_q)；raw 的 μ_p 對應 N_τ = 25
    const band = analyseAlpha(LOOPS.L2, 0.02).kappaM
    const vBand = predictPhosVerdict(band, muP, SIM_CFG.sigmaPs, 1500)
    expect(vBand.tauEff).toBeCloseTo(25, 9)
    expect(vBand.verdict).toBe('diverge') // 帶內：κ_1 < 0
    expect(predictPhosVerdict(analyseAlpha(LOOPS.L2, 0.137).kappaM, muP, SIM_CFG.sigmaPs, 1500).verdict).toBe('converge')
    // 帶緣 132 MHz：N_τ = 25 時 ρ < 1（時間常數約 870 blocks：1500 blocks 的模擬算邊際，6000 blocks 才判為收斂）；
    // 步長放大 5 倍（N_τ = 5）時 ρ > 1（同樣要夠長的模擬才判為發散）
    const edge = analyseAlpha(LOOPS.L2, 132 / FREF_MHZ).kappaM
    const e25 = predictPhosVerdict(edge, muP, SIM_CFG.sigmaPs, 1500)
    expect(e25.rho).toBeLessThan(1)
    expect(e25.verdict).toBe('marginal')
    expect(predictPhosVerdict(edge, muP, SIM_CFG.sigmaPs, 6000).verdict).toBe('converge')
    const e5 = predictPhosVerdict(edge, 5 * muP, SIM_CFG.sigmaPs, 1500)
    expect(e5.tauEff).toBeCloseTo(5, 9)
    expect(e5.rho).toBeGreaterThan(1)
    expect(e5.verdict).toBe('marginal')
    expect(predictPhosVerdict(edge, 5 * muP, SIM_CFG.sigmaPs, 20000).verdict).toBe('diverge')
    // 閉迴路也是如此：132 MHz、raw，N_τ = 25 收斂、N_τ = 5 變大
    const run132 = (tau: number) => runSspllLms({ loop: LOOPS.L2, alpha: 132 / FREF_MHZ, variant: 'raw', cfg: SIM_CFG, nBlocks: 1500, nBlk: 512, tauBlocks: tau, seed: 3, recEvery: 100, lanes: 2 })
    const r25 = run132(25)
    const r5 = run132(5)
    expect(r25.finalPhosRmsFs).toBeLessThan(0.5 * r25.initPhosRmsFs)
    expect(r5.finalPhosRmsFs).toBeGreaterThan(2 * r5.initPhosRmsFs)
    // dead zone（近整數 α = 0.002）：ρ ≈ 1 ⇒ 邊際
    expect(predictPhosVerdict(analyseAlpha(LOOPS.L2, 0.002).kappaM, muP, SIM_CFG.sigmaPs, 1500).verdict).toBe('marginal')
    // signmap 區間：L2 的 near-grid 大訊號 keep-out（文件 §15.2 步驟 5）
    const near = (col: number[]) => [...mapIntervalsBelow(col, SIGNMAP.L2.f_MHz, -1e-3, 420, 580), ...mapIntervalsBelow(col, SIGNMAP.L2.f_MHz, -1e-3, 1420, 1580)]
    expect(near(SIGNMAP.L2.LSinf)).toEqual([
      [466.5, 508.5],
      [1468.5, 1499.5],
    ])
    expect(near(SIGNMAP.L2.LSinf_ac)).toEqual([
      [490.5, 513.5],
      [1487.5, 1512.5],
    ])
    expect(mapIntervalsBelow(null, [])).toEqual([])
    expect(mapIntervalsBelow([0, -1, -1, 0, -1], [1, 2, 3, 4, 5], -0.5)).toEqual([
      [2, 3],
      [5, 5],
    ])
    // 頁面上用中文轉述的 golden 執行條件與 JSON 的 lms_note 一致
    for (const frag of ['sigma_v = 200 fs', 'N = 512', '6000 blocks', '2 noise lanes', 'time constant 25 blocks']) expect(PRED.lms_note).toContain(frag)
    for (const frag of ['$\\sigma_v=200$ fs', '$N=512$', '6000 blocks', '2 條雜訊 lane', '25 blocks']) expect(LMS_NOTE_ZH).toContain(frag)
    expect(PRED.lms['L2|0.02|raw'].blocks[PRED.lms['L2|0.02|raw'].blocks.length - 1]).toBe(6000)
  }, 60000)

  it('SSPLL: 顯示工具與程式碼 region——格式化函式；頁面引用的 region 在 sspll.ts 與 golden Python 都存在', () => {
    expect(fx(-0.20529, 4)).toBe('−0.2053')
    expect(fx(-0.00001, 3)).toBe('0.000')
    expect(fx(NaN)).toBe('—')
    expect(fs(0.0984, 4)).toBe('+0.0984')
    expect(fs(-0.1395, 4)).toBe('−0.1395')
    expect(fp(2.06e-5, 3)).toBe('2.06e−5')
    expect(tx(-0.5, 2)).toBe('-0.50')
    expect(txs(3.989e-3, 4)).toBe('0.003989')
    expect(txs(2.5e-8, 2)).toBe('2.5\\times10^{-8}')
    expect(intervalsText([])).toBe('無')
    expect(intervalsText([[0.5, 124.5], [953.5, 953.5]])).toBe('0.5–124.5、953.5')
    expect(signClass(-0.1)).toBe('cs-neg')
    expect(signClass(1e-4)).toBe('cs-dead')
    expect(signClass(0.3)).toBe('cs-pos')
    const ts = listRegions(MODEL_SRC)
    for (const reg of ['hpd', 'inversionBands', 'typeIK', 'bandEdge', 'variantG', 'gammaEff', 'gosHarmonic', 'gosRational', 'phosLambda', 'oneDiffMargin', 'blockMeanStable', 'cPeriodic', 'largeSignal', 'regRaw', 'regZeroMean', 'regDelay', 'regDiff1', 'regDiff2', 'regFx', 'signLmsBlock'])
      expect(ts, reg).toContain(reg)
    // 差異行標記
    for (const reg of ['regDiff1', 'regDiff2', 'regDelay', 'regFx', 'regZeroMean', 'variantG']) expect(extractRegion(MODEL_SRC, reg)).toContain('← 差異')
    expect(listRegions(PY_SOURCES.regressors.source)).toEqual(expect.arrayContaining(['variant_G', 'gmac_variants']))
    expect(listRegions(PY_SOURCES.predictions.source)).toEqual(expect.arrayContaining(['gamma_eff', 'C_periodic']))
    expect(listRegions(PY_SOURCES.simulator.source)).toContain('sign_lms_block')
    expect(extractRegion(PY_SOURCES.regressors.source, 'gmac_variants')).toContain('← 差異')
  })
})
