import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { conventionalStep } from '@/simulation/models/lms'
import { num } from './format'
import Chapter00 from './index'
import { HAND_CALC_PARAMS, HandCalcSection, HandCalcTable } from './sections/HandCalc'
import { IntroPlayground } from './experiments/IntroPlayground'
import { NoiseAverageLab } from './experiments/NoiseAverageLab'

// 重量級外部函式庫：jsdom 中以假物件取代
vi.mock('plotly.js-dist-min', () => ({
  default: {
    react: vi.fn(async () => undefined),
    purge: vi.fn(),
    toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
    downloadImage: vi.fn(async () => ''),
    Plots: { resize: vi.fn() },
    Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
  },
}))
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })),
  },
}))
// 包一層 spy：證明手算表的數字真的來自 lms.ts 的 conventionalStep
vi.mock('@/simulation/models/lms', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/simulation/models/lms')>()
  return { ...orig, conventionalStep: vi.fn(orig.conventionalStep) }
})

function wrap(ui: React.ReactNode, path = '/ch/00') {
  return (
    <SettingsProvider>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </SettingsProvider>
  )
}

/** 元素的文字；其中的 KaTeX 以 `$TeX 原始碼$` 表示（KaTeX 的 textContent 會重複 MathML 與 HTML 兩份，不適合直接比對）。 */
function texText(el: Element | null | undefined): string {
  if (!el) return ''
  const c = el.cloneNode(true) as HTMLElement
  c.querySelectorAll('.katex').forEach((k) => k.replaceWith(`$${k.querySelector('annotation')?.textContent ?? ''}$`))
  return c.textContent ?? ''
}

function headingTexts(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('h1, h2, h3, h4')).map((h) => texText(h).trim())
}

afterEach(() => {
  localStorage.clear()
  vi.mocked(conventionalStep).mockClear()
})

describe('Ch00 手算表（T01 render-level）', () => {
  it('T01: 表格的每一格都由 lms.ts 的 conventionalStep 算出，且與 golden T01 一致（w1 = 1.8、w2 = 2.28）', () => {
    const golden = JSON.parse(readFileSync(join(process.cwd(), 'golden/vectors/T01.json'), 'utf8')) as {
      expected: { w_trace: number[]; e_trace: number[] }
    }
    render(wrap(<HandCalcTable />))
    const spy = vi.mocked(conventionalStep)
    expect(spy).toHaveBeenCalledTimes(HAND_CALC_PARAMS.steps)
    expect(spy.mock.calls[0][0]).toMatchObject({ w: 1, x: 2, y: 6, mu: 0.1 })
    const table = screen.getByTestId('ch00-hand-calc')
    for (let n = 0; n < 5; n++) {
      const row = within(table).getByTestId(`ch00-hand-row-${n}`)
      const cell = (col: string) => row.querySelector(`[data-col="${col}"]`)?.textContent
      // 顯示值 = conventionalStep 的回傳值（格式化後），並等於 golden 軌跡
      expect(cell('w')).toBe(num(golden.expected.w_trace[n]))
      expect(cell('wNext')).toBe(num(golden.expected.w_trace[n + 1]))
      expect(cell('e')).toBe(num(golden.expected.e_trace[n]))
      expect(cell('wNext')).toBe(num((spy.mock.results[n].value as { w: number }).w))
    }
    expect(within(table).getByTestId('ch00-hand-row-0').querySelector('[data-col="wNext"]')?.textContent).toBe('1.8')
    expect(within(table).getByTestId('ch00-hand-row-1').querySelector('[data-col="wNext"]')?.textContent).toBe('2.28')
    // δ = a − w（勘誤 E39）：+2、+1.2、+0.72
    expect(within(table).getByTestId('ch00-hand-row-0').querySelector('[data-col="delta"]')?.textContent).toBe('+2')
    expect(within(table).getByTestId('ch00-hand-row-2').querySelector('[data-col="delta"]')?.textContent).toBe('+0.72')
  })
})

describe('Ch00 手算表的交叉比對（反面測試）', () => {
  it('T01: 反面測試——把 conventionalStep 的更新極性弄反時，「遞迴 vs 封閉解」必須顯示 ✗，不可顯示成功', () => {
    localStorage.setItem('lmspll.mode', 'engineer')
    const spy = vi.mocked(conventionalStep)
    const original = spy.getMockImplementation()
    try {
      // 正確版本：三列（w1、w2、w5）都通過
      const good = render(wrap(<HandCalcSection />))
      expect(good.container.querySelectorAll('tr[data-pass="true"]')).toHaveLength(3)
      expect(good.container.querySelectorAll('tr[data-pass="false"]')).toHaveLength(0)
      good.unmount()
      // 錯誤版本：w ← w − μ·e·x（極性反了）
      spy.mockImplementation(({ w, x, y, mu }) => {
        const e = y - w * x
        const dw = -mu * e * x
        return { e, dw, w: w + dw }
      })
      const bad = render(wrap(<HandCalcSection />))
      expect(bad.container.querySelectorAll('tr[data-pass="false"]')).toHaveLength(3)
      expect(bad.container.querySelectorAll('tr[data-pass="true"]')).toHaveLength(0)
      // 手算表也如實顯示錯的結果（w1 = 0.2 而不是 1.8），不會被「修飾」成正確答案
      expect(bad.container.querySelector('[data-testid="ch00-hand-row-0"] [data-col="wNext"]')?.textContent).toBe('0.2')
    } finally {
      if (original) spy.mockImplementation(original)
    }
  }, 60_000)
})

describe('Ch00 整頁 smoke test', () => {
  it.each(['beginner', 'engineer', 'research'])('%s 模式可完整渲染所有段落而不拋錯', async (mode) => {
    localStorage.setItem('lmspll.mode', mode)
    // 渲染過程不得有 console.error（React 的 key / hooks / DOM 巢狀警告都走 console.error）
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { container } = render(wrap(<Chapter00 />))
    for (const t of [
      '§0.1 一個黑盒子問題',
      '§0.2 三個動作：預測 → 比較 → 修正',
      '§0.3 LMS 更新公式',
      '§0.4 先算一次：用數字手算兩步',
      '§0.5 動手玩：$\\mu$ 太小、剛好、太大',
      '§0.6 為什麼是 $e\\,x$？——只用微積分推導',
      '§0.7 有雜訊時為什麼還學得會？——雜訊會被平均掉',
      '§0.8 為什麼 LMS 這麼重要？',
      '§0.9 預告：只知道誤差的「正負號」也能學嗎？',
      '§0.10 注意假設：這一課的結論什麼時候成立？',
      '§0.11 思考題',
      '§0.12 本課必記',
      '§0.13 學習地圖：15 個問題在哪裡回答',
    ]) {
      // 標題內含 KaTeX（MathML）時，jsdom 的 accessible-name 計算會出錯，所以直接比對標題文字
      expect(headingTexts(container)).toContain(t)
    }
    // 符號表、勘誤標記（連到驗證頁）、程式碼區塊
    expect(screen.getByText('本章符號')).toBeTruthy()
    const errata = Array.from(container.querySelectorAll('.ch00-erratum-badge')).map((a) => a.textContent)
    expect(errata).toEqual(expect.arrayContaining(['勘誤 E39', '勘誤 E40', '勘誤 E41']))
    // 本章沿用全站更正後的符號：總和 S_N / m_q（E18）、code-correlated 干擾 κ（E12）
    expect(errata).toEqual(expect.arrayContaining(['勘誤 E18', '勘誤 E12']))
    const signSection = texText(container.querySelector('#ch00-sign'))
    expect(signSection).toContain('P(S_N>0)')
    expect(signSection).not.toContain('P(G_N>0)')
    expect(texText(container.querySelector('#ch00-assumptions'))).toContain(String.raw`w^*=a+\kappa`)
    container.querySelectorAll('.ch00-erratum-badge').forEach((a) => expect(a.getAttribute('href')).toBe('#/verification'))
    expect(container.querySelectorAll('.c-code').length).toBeGreaterThan(2)
    // CodeBlock / CodeCompare 的 region 名稱都必須存在（找不到時會渲染錯誤框）
    expect(container.textContent).not.toContain('找不到程式碼 region')
    expect(container.textContent).not.toContain('缺少 #endregion')
    // 勘誤 E40 的說明文字由模擬結果產生（不是手打）：μ = 0.125 的跳動值與 μ = 0.1 的浮點值
    const e40 = Array.from(container.querySelectorAll('.ch00-erratum')).find((el) => el.textContent?.includes('勘誤 E40'))
    expect(e40?.textContent).toContain('3.25')
    expect(e40?.textContent).toContain('2.75')
    expect(e40?.textContent).toContain('3.0000000000000004')
    expect(container.querySelector('.c-tex-error')).toBeNull()
    // KaTeX throwOnError:false 時的語法錯誤會以 .katex-error 呈現：全章不得出現
    const texErrors = Array.from(container.querySelectorAll('.katex-error')).map((e) => e.getAttribute('title') ?? e.textContent)
    expect(texErrors).toEqual([])
    // 字串屬性裡的 `$…$` 都必須被排版成 KaTeX：頁面文字（程式碼區塊除外）不得殘留字面的 `$`
    const prose = container.cloneNode(true) as HTMLElement
    prose.querySelectorAll('pre, .katex').forEach((e) => e.remove())
    expect(prose.textContent).not.toContain('$')
    // 學習地圖 15 列；問題中的數學（Q2 的 e·x）以 KaTeX 排版而不是純文字
    const map = container.querySelector('table.ch00-map') as HTMLTableElement
    expect(map.tBodies[0].rows).toHaveLength(15)
    expect(map.tBodies[0].rows[1].cells[1].querySelector('.katex')).not.toBeNull()
    expect(map.tBodies[0].rows[1].cells[1].textContent).not.toContain('$')
    // §0.10 注意假設：段落類型為「注意假設」，反例表四列都與理論 w* = a + c 一致（由模擬判定）
    expect(container.querySelector('#ch00-assumptions')?.getAttribute('data-kind')).toBe('assumptions')
    const biasRows = Array.from(container.querySelectorAll('[data-testid^="ch00-bias-row-"]'))
    expect(biasRows).toHaveLength(4)
    biasRows.forEach((r) => expect(r.getAttribute('data-ok')).toBe('true'))
    // 預設參數下，全章所有指標表都不應出現「超出容許誤差」
    expect(container.querySelectorAll('tr[data-pass="false"]')).toHaveLength(0)
    // 八題「帶入手算」在三種模式都看得到（不被 ModeGate 藏起來），而且預設就顯示帶入過程
    const handcalcs = Array.from(container.querySelectorAll('.c-handcalc'))
    expect(handcalcs.map((h) => h.id).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((k) => `handcalc-HC-00.${k}`))
    handcalcs.forEach((h) => expect(h.querySelectorAll('.c-step').length, h.id).toBeGreaterThan(0))
    // 等效平均長度表只在 Engineer 以上顯示（μ = 0.01 ⇒ N_eq = 49；一步到位 ⇒ 1）
    const neq = container.querySelector('[data-testid="ch00-neq-table"]') as HTMLTableElement | null
    if (mode === 'beginner') expect(neq).toBeNull()
    else {
      expect(neq!.tBodies[0].rows[0].cells[2].textContent).toBe('49')
      expect(neq!.tBodies[0].rows[3].cells[2].textContent).toBe('1')
    }
    if (mode === 'research') {
      // 展開所有思考題解析，確認其中的 TeX 也都能正確排版
      screen.getAllByText('看答案與解析').forEach((b) => fireEvent.click(b))
      expect(screen.getAllByText('收起解析')).toHaveLength(4)
      expect(Array.from(container.querySelectorAll('.katex-error')).map((e) => e.getAttribute('title'))).toEqual([])
      expect(headingTexts(container)).toContain('（Research）精確有理數驗算')
      expect(container.textContent).toContain('57/25')
      // 精確差距（BigInt 相減）與 1 ulp 的說明
      expect(container.textContent).toContain('距離則是 2.487×10')
    }
    await act(async () => {})
    const errors = errSpy.mock.calls.map((c) => String(c[0]))
    errSpy.mockRestore()
    expect(errors).toEqual([])
  }, 90_000) // 整章渲染（含 KaTeX、research 的數值積分）；多個 agent 同時跑測試時機器負載很高，逾時放寬

  it('思考題 1：選 2.9 判定正確，答案解析由 conventionalStep 算出', async () => {
    render(wrap(<Chapter00 />))
    const quiz = screen.getByText('思考題 1（必做）').closest('.c-quiz') as HTMLElement
    fireEvent.click(within(quiz).getByText(/^B\. 2\.9$/))
    expect(within(quiz).getByText('答對了！')).toBeTruthy()
    fireEvent.click(within(quiz).getByText('看答案與解析'))
    // 誘答選項的說明與檢查數字都由 conventionalStep 算出（x 以 KaTeX 排版，所以用 regex 比對）
    expect(quiz.textContent).toMatch(/1\.1 是忘了 x+ 的負號/)
    expect(quiz.textContent).toContain('−8.7')
    await act(async () => {})
  }, 90_000)
})

describe('Ch00 內文連結 → preset', () => {
  it('§0.7 的「載入這組參數」連結會把 intro-noisy 套用到 Playground；重設後再點同一個連結也會重新套用', async () => {
    const { container } = render(wrap(<Chapter00 />))
    const playground = container.querySelector('#exp-intro-playground') as HTMLElement
    expect(texText(playground)).toContain(String.raw`$\sigma_v=0$：沒有隨機性`)
    const link = screen.getByText('在 §0.5 的 Playground 載入這組參數')
    expect(link.getAttribute('href')).toBe('/ch/00?preset=intro-noisy')
    fireEvent.click(link)
    await waitFor(() => expect(texText(playground)).toContain('Case C: $z='))
    // 內文的三個數字（0.03571 / 0.08333 / 0.2041）與 Playground 指標表的理論穩態 std 是同一組
    const theory = Array.from(playground.querySelectorAll('tr'))
      .filter((r) => r.textContent?.includes('理論穩態'))
      .map((r) => r.cells[1].textContent)
    expect(theory).toEqual(['0.0357143', '0.0833333', '0.204124'])
    // 重設 → 回到無雜訊的預設；再點同一個連結（網址不變）仍要重新套用
    fireEvent.click(within(playground).getByText('重設 Reset'))
    await waitFor(() => expect(texText(playground)).toContain(String.raw`$\sigma_v=0$：沒有隨機性`))
    fireEvent.click(link)
    await waitFor(() => expect(texText(playground)).toContain('Case C: $z='))
    await act(async () => {})
  }, 90_000)
})

// 每個測試只渲染一個實驗（通常 < 1 s）；多個 agent 同時跑測試、機器負載高時放寬逾時
describe('Ch00 互動實驗', { timeout: 60_000 }, () => {
  it('預設三個 Case（0.02 / 0.10 / 0.65）：Case C 發散並解釋原因；e_n 圖與代入數字的更新公式都在', async () => {
    const { container } = render(wrap(<IntroPlayground />))
    expect(texText(container)).toContain('$e_n$：每一步的預測誤差')
    // Case A（μ = 0.02）第 0 步：e0 = 6 − 1×2 = 4，w1 = 1 + 0.02×4×2 = 1.16
    const live = container.querySelector('.ch00-live')?.textContent ?? ''
    expect(live).toContain('=4')
    expect(live).toContain('=1.16')
    await waitFor(() => expect(screen.getAllByText(/Case C/).length).toBeGreaterThan(0))
    const alerts = await screen.findAllByRole('alert')
    // 警告裡的數學以 KaTeX 排版（字串中的 $…$），不是 Unicode 拼湊
    const text = alerts.map((a) => texText(a)).join('\n')
    expect(text).toContain(String.raw`Case C：$\mu=0.65$ 超過穩定上限 $2/x^2=0.5$`)
    expect(text).toContain('修正過頭')
    expect(alerts.some((a) => a.querySelector('.katex'))).toBe(true)
    expect(alerts.map((a) => a.textContent).join('')).not.toContain('$')
  })

  it('x = 0：指標表顯示「不可辨識」，原因以 KaTeX 排版在說明裡（不是 Unicode 拼的 x = 0）', async () => {
    const { container } = render(wrap(<IntroPlayground />))
    fireEvent.change(screen.getByLabelText('x（固定輸入）'), { target: { value: '0' } })
    await waitFor(() => expect(container.textContent).toContain('不可辨識'))
    const row = Array.from(container.querySelectorAll('tr')).find((r) => texText(r).includes(String.raw`穩定上限 $\mu_{\max}=2/x^2$`))!
    expect(row.cells[1].textContent).toBe('不可辨識')
    expect(texText(row)).toContain(String.raw`$x=0$：更新量永遠是 0，任何 $\mu$ 都學不到 $a$`)
    expect(row.textContent).not.toContain('$')
    expect(container.querySelector('.katex-error')).toBeNull()
    await act(async () => {})
  })

  it('?preset=intro-pole-regions 會套用 μ = 0.25 / 0.4 / 0.5，並警告邊界', async () => {
    render(wrap(<IntroPlayground />, '/ch/00?preset=intro-pole-regions'))
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((a) => a.textContent).join('\n')).toContain('剛好在邊界')
  })

  it('單步 Step 進入單步模式；Freeze 後顯示凍結說明', async () => {
    render(wrap(<IntroPlayground />))
    fireEvent.click(screen.getByText('單步 Step'))
    expect(await screen.findByText(/單步模式：目前顯示到第 1 步/)).toBeTruthy()
    fireEvent.click(screen.getByText('凍結 Freeze'))
    expect(await screen.findByText(/已在第 1 步 Freeze/)).toBeTruthy()
  })

  it('反面測試：雜訊平均實驗在 s₁ = 0 的退化情況（±1 碼、σ_v = 0）不可把「0 對 0」顯示成不通過', async () => {
    const { container } = render(wrap(<NoiseAverageLab />))
    fireEvent.change(screen.getByLabelText('sigma_v（量測雜訊 RMS）'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('x 的分布'), { target: { value: '1' } }) // 第 2 個選項：±1 碼
    await waitFor(() => expect(container.textContent).toContain('每一筆都一樣'))
    expect(container.querySelectorAll('tr[data-pass="false"]')).toHaveLength(0)
    expect(container.querySelectorAll('tr[data-pass="true"]').length).toBeGreaterThanOrEqual(3)
    // Monte Carlo 欄誠實標示 n/a 並說明原因，而不是 ok / mismatch
    expect(texText(container)).toContain(String.raw`$s_1=0$：每一筆 $e\,x$ 都相同，沒有隨機性`)
    expect(texText(container)).toContain('$0/0$ 無定義')
    // 再把 w 改成非整數差（a − w = 0.7）：累加的浮點捨入也不可造成不通過
    fireEvent.change(screen.getByLabelText('w（目前的猜測，固定）'), { target: { value: '2.3' } })
    await waitFor(() => expect(container.textContent).toContain('=0.7'))
    expect(container.querySelectorAll('tr[data-pass="false"]')).toHaveLength(0)
  })

  it('?preset=intro-noise-pm-one 會把 x 的分布切成 ±1 碼', async () => {
    render(wrap(<NoiseAverageLab />, '/ch/00?preset=intro-noise-pm-one'))
    expect((screen.getByLabelText('x 的分布') as HTMLSelectElement).value).toBe('1')
    await act(async () => {})
  })

  it('有雜訊的 preset（intro-noisy）：三個 Case 的 Monte Carlo 穩態比對都通過，來源標示為 simulation', async () => {
    const { container } = render(wrap(<IntroPlayground />, '/ch/00?preset=intro-noisy'))
    await waitFor(() => expect(texText(container)).toContain('Case C: $z='))
    expect(container.querySelectorAll('tr[data-pass="false"]')).toHaveLength(0)
    // 每個 Case 一列「模擬的穩態 std(w)」都有 ✓
    expect(container.querySelectorAll('tr[data-pass="true"]').length).toBeGreaterThanOrEqual(3)
    expect(container.querySelector('#exp-intro-playground')?.textContent).toContain('simulation')
  })

  it('雜訊平均實驗可渲染，Monte Carlo 交叉比對為 ok', async () => {
    render(wrap(<NoiseAverageLab />))
    // 標題含 KaTeX（jsdom 對含 MathML 的標題計算 accessible name 會出錯），所以直接取標題元素比對
    expect(texText(document.getElementById('exp-intro-noise-average-title'))).toBe(String.raw`雜訊為什麼會被平均掉？（$1/\sqrt N$ 小型 Monte Carlo）`)
    await act(async () => {})
    expect(texText(document.body)).toContain('最大 $|z|=')
    expect(texText(document.body)).toContain('$|z|<4$ 視為一致')
  })
})
