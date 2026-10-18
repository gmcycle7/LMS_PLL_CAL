import { act, fireEvent, waitFor } from '@testing-library/react'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import { plotMath } from '@/components/plotMath'
import { analyticChecks, CHECK_NAME, checkTolerance, mcRunNote, UnitsCalculator } from './UnitsCalculator'
import { useFormulaAnchorHandler } from '../common'
import { regimeLabelTex } from '../format'
import { DEFAULT_UNITS_PARAMS, unitsCalc } from '../unitsModel'
import { buttonByText, count, mountAt, q, renderProblems } from '../domTestUtils'
import { richProblems } from '../testUtils'

vi.mock('plotly.js-cartesian-dist-min', async () => ({ default: (await import('../domTestUtils')).PLOTLY_STUB }))
// 記下每一張圖「轉換之前」的圖內文字（軸標題、圖例名稱、註記…）：只存字串，不存資料與 DOM（避免抓住整頁的節點）
const PLOT = vi.hoisted(() => ({ strings: new Set<string>() }))
vi.mock('@/components/plotMath', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/plotMath')>()
  const TEXT_KEYS = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext', 'label'])
  const collect = (v: unknown, key: string | null, depth: number): void => {
    if (typeof v === 'string') {
      if (key !== null && TEXT_KEYS.has(key)) PLOT.strings.add(v)
      return
    }
    if (depth > 6 || v === null || typeof v !== 'object' || ArrayBuffer.isView(v)) return
    if (Array.isArray(v)) {
      for (const x of v.slice(0, 40)) collect(x, key, depth + 1)
      return
    }
    for (const [k, x] of Object.entries(v)) collect(x, k, depth + 1)
  }
  return {
    ...mod,
    applyPlotMath: <D, L>(data: D, layout: L) => {
      collect(data, null, 0)
      collect(layout, null, 0)
      return mod.applyPlotMath(data, layout)
    },
  }
})
vi.setConfig({ testTimeout: 120_000 })

const J = vi.hoisted(() => ({ jumps: [] as string[] }))
vi.mock('../jump', async (orig) => {
  const mod = await orig<typeof import('../jump')>()
  return {
    ...mod,
    jumpToFormula: (id: string) => {
      J.jumps.push(id)
      return () => undefined
    },
  }
})

beforeEach(() => {
  J.jumps.length = 0
})
afterEach(() => {
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})

/** 與頁面相同的外層：攔截公式連結（a[data-formula-link]） */
function Harness() {
  const onClick = useFormulaAnchorHandler()
  return (
    <div onClick={onClick}>
      <UnitsCalculator />
    </div>
  )
}

const text = (root: ParentNode, sel: string) => q(root, sel).textContent ?? ''
/** 換算器整塊的文字（含警告、指標表與交叉比對三欄） */
/**
 * 區塊內看得見的文字。TestBadge 的 tooltip（.c-tip-list）逐字列出測試標題——包括本檔自己的標題（例如「…Monte Carlo 尚未執行…」）——
 * 它們不是換算器顯示的內容，所以不能算進去（否則「不應出現『尚未執行』」這類斷言會因為標題而誤報）。
 */
const crossText = (root: HTMLElement) => {
  const parts: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement?.closest('.c-tip-list')) parts.push(n.nodeValue ?? '')
  return parts.join('')
}

/** 依標籤找 ParamControl 的數字輸入框（aria-label 或 label 文字） */
function numberInput(root: ParentNode, label: RegExp): HTMLInputElement {
  const boxes = Array.from(root.querySelectorAll<HTMLElement>('.c-param'))
  const box = boxes.find((b) => label.test(b.querySelector('.c-param-label')?.textContent ?? '') || Array.from(b.querySelectorAll('input')).some((i) => label.test(i.getAttribute('aria-label') ?? '')))
  const input = box?.querySelector<HTMLInputElement>('input[type="text"]')
  if (!input) throw new Error(`找不到參數輸入框：${String(label)}`)
  return input
}

function setNumber(root: ParentNode, label: RegExp, value: string) {
  const input = numberInput(root, label)
  act(() => {
    fireEvent.change(input, { target: { value } })
    fireEvent.blur(input)
  })
}

describe('analyticChecks（封閉式 vs 數值解）', () => {
  it('T14: T13 條件下三項檢查都通過（f_3dB 二分法、ENBW 數值積分、σ_w² = S(0)·ENBW）', () => {
    const checks = analyticChecks(unitsCalc(DEFAULT_UNITS_PARAMS))
    expect(checks.length).toBe(3)
    expect(checks.every((c) => c.ok)).toBe(true)
    expect(Math.max(...checks.map((c) => c.err))).toBeLessThan(1e-9)
  })
  it('沒有 −3 dB 點時只檢查 ENBW 與 σ_w；不穩定時沒有任何可檢查的項目', () => {
    const K = unitsCalc(DEFAULT_UNITS_PARAMS).loop.K
    const no3db = analyticChecks(unitsCalc({ ...DEFAULT_UNITS_PARAMS, mu: 0.9 / K }))
    expect(no3db.map((c) => c.name)).toEqual([CHECK_NAME.enbw, CHECK_NAME.sigmaW])
    expect(no3db.every((c) => c.ok)).toBe(true)
    expect(analyticChecks(unitsCalc({ ...DEFAULT_UNITS_PARAMS, gmMode: 'sum' }))).toEqual([])
  })
  it('反面（回歸）：控制項合法範圍內的極端參數（很慢的迴路、p → −1、sum mode、C < 0…）都不會誤報「不一致」', () => {
    // 修正前：數值 −3 dB 用 1 − 2p·cosΩ + p² 做二分，μ ≲ 10⁻³ fs（1 − p ≲ 10⁻⁵）時相消誤差超過 10⁻⁸ → Analytic 欄顯示 mismatch
    const bad: string[] = []
    let n = 0
    let finite = 0
    for (const mu of [1e-6, 1e-4, 1e-3, 1e-2, 1, 10, 113, 188, 250, 250.6, 1e3, 1e4])
      for (const sigmaV of [0.01, 1, 3.9, 100, 1e4])
        for (const N of [1, 2, 4096, 1_048_576])
          for (const C of [-2, -0.5, 0, 1e-6, 0.01, 1, 2])
            for (const gmMode of ['average', 'sum'] as const) {
              const u = unitsCalc({ ...DEFAULT_UNITS_PARAMS, mu, sigmaV, N, C, gmMode })
              const checks = analyticChecks(u)
              n++
              finite += checks.length
              for (const c of checks) if (!c.ok) bad.push(`${c.name} μ=${mu} σ_v=${sigmaV} N=${N} C=${C} ${gmMode} p=${u.loop.p} err=${c.err}`)
              // 沒有穩態（|p| ≥ 1）時不檢查任何東西
              if (!(Math.abs(u.loop.p) < 1)) expect(checks).toEqual([])
            }
    expect(n).toBe(12 * 5 * 4 * 7 * 2)
    expect(finite).toBeGreaterThan(1500) // 真的有檢查到東西
    expect(bad.slice(0, 5)).toEqual([])
    // 容差：一般情況就是 10⁻⁸；只有 1 − |p| ≲ 10⁻⁶ 才明顯放寬；|p| ≥ 1 時不比對
    expect(checkTolerance(0.92)).toBeCloseTo(1e-8, 12)
    expect(checkTolerance(1 - 1e-5)).toBeLessThan(1.1e-8)
    expect(checkTolerance(1 - 1e-10)).toBeGreaterThan(5e-5)
    expect(checkTolerance(-(1 - 1e-10))).toBeGreaterThan(5e-5)
    expect(checkTolerance(1)).toBe(Infinity)
    expect(checkTolerance(-3)).toBe(Infinity)
    // 反面：真的不一致（把 ENBW 換成 −3 dB corner）一定被抓到
    const u = unitsCalc(DEFAULT_UNITS_PARAMS)
    const wrong = analyticChecks({ ...u, enbwNumeric: u.loop.f3dbExact, sigmaFromEnbw: u.sigmaFromF3db })
    expect(wrong.filter((c) => !c.ok).map((c) => c.name)).toEqual([CHECK_NAME.enbw, CHECK_NAME.sigmaW])
    const ghost = analyticChecks({ ...u, f3dbNumeric: NaN })
    expect(ghost.some((c) => c.name === CHECK_NAME.f3dbExistence && !c.ok)).toBe(true)
  })

  it('檢查名稱是 LaTeX（$…$），不是 Unicode 拼的公式；mcRunNote 說明在哪裡算', () => {
    for (const name of Object.values(CHECK_NAME)) {
      expect(richProblems(name), name).toEqual([])
      expect(name).not.toMatch(/[σμ√·]/)
    }
    expect(CHECK_NAME.sigmaW).toContain(String.raw`\sigma_w`)
    expect(mcRunNote(null, 'worker')).toBe('')
    expect(mcRunNote({ fallback: false, ms: 41.7 }, 'worker')).toMatch(/Web Worker，42 ms（不佔用主執行緒）/)
    expect(mcRunNote({ fallback: false, ms: 3 }, 'inline')).toMatch(/主執行緒，3 ms（這個環境沒有 Web Worker）/)
    expect(mcRunNote({ fallback: true, ms: null, reason: '模組載入失敗' }, 'worker')).toMatch(/Web Worker 失敗後自動改用（原因：模組載入失敗）/)
  })
})

describe('UnitsCalculator（jsdom）', () => {
  it('T13: 預設（T13 / T14 條件）：單位鏈表、指標、三張圖的說明、控制項都有單位與 reg；Analytic 交叉比對 ok、Monte Carlo 尚未執行、Fixed-point Not implemented', () => {
    const { container } = mountAt(<Harness />)
    const root = q(container, '#fr-units-calculator')
    expect(renderProblems(root)).toEqual([])
    // 單位鏈：13 列，含 g、p、σ_w、ENBW 的數字
    expect(count(root, '.fr-chain-table tbody tr')).toBe(13)
    const chain = text(root, '.fr-chain-table')
    for (const s of ['0.0797885', '0.9202115', '0.399186', '12.931', '20.289', '976.563']) expect(chain, s).toContain(s)
    // 控制項：每個 ParamControl 都有 reg（硬體暫存器或 behavioral 參數）
    const params = Array.from(root.querySelectorAll('.c-param'))
    expect(params.length).toBeGreaterThanOrEqual(12)
    expect(params.filter((p) => !p.querySelector('.c-param-reg')).map((p) => p.querySelector('.c-param-label')?.textContent)).toEqual([])
    expect(crossText(root)).toContain('REG_LMS_MU')
    // 交叉比對
    const all = crossText(root)
    expect(all).toMatch(/3 項「封閉式 vs 不用封閉式的數值解」/)
    expect(all).toMatch(/尚未執行/)
    expect(all).toMatch(/這個換算器沒有量化模型/)
    expect(all).toMatch(/Not implemented/i)
    // 沒有警告（T13 條件是健康的）
    expect(count(root, '.callout-danger')).toBe(0)
    // preset 下拉：本頁自帶的 5 個
    const presetSelect = Array.from(root.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => /Sum vs Average/.test(o.textContent ?? '')))
    expect(presetSelect).toBeTruthy()
    expect(Array.from(presetSelect!.options).filter((o) => /T13|Sum vs Average|−3 dB|同一個 pole|C < 0/.test(o.textContent ?? '')).length).toBe(5)
  })

  it('T13: 按 Run：1-bit Monte Carlo 的 σ̂_w 與解析值一致（|z| ≤ 4），交叉比對變成 ok；改參數後結果標為過期', async () => {
    const { container } = mountAt(<Harness />)
    const root = q(container, '#fr-units-calculator')
    fireEvent.click(buttonByText(root, /^(Run|執行)/))
    await waitFor(() => expect(crossText(root)).toMatch(/引擎：精確 1-bit Binomial/), { timeout: 20_000 })
    const all = crossText(root)
    expect(all).not.toMatch(/尚未執行/)
    expect(all).not.toMatch(/先換一個 seed 排除偶然/) // 沒有 mismatch
    expect(all).toMatch(/Monte Carlo .*1-bit/s) // 指標表多一列 σ̂_w
    expect(all).toMatch(/執行環境：主執行緒，\d+ ms（這個環境沒有 Web Worker）/) // jsdom 沒有 Worker：hook 以 inline 執行同一個 loader
    expect(count(root, '.callout-danger')).toBe(0)
    expect(renderProblems(root)).toEqual([])
    // 改 σ_v → 上一次的 MC 不再對應目前設定
    setNumber(root, /sigma_v/, '50')
    await waitFor(() => expect(crossText(root)).toMatch(/參數已改變，上一次的 Monte Carlo 結果不再對應目前設定/))
  })

  it('控制項與指標表：label／hint／unit、指標名稱與說明、單位鏈的「量」欄都沒有 Unicode 拼的數學（一律 $…$ 由 KaTeX 排版）', () => {
    const { container } = mountAt(<Harness />)
    const root = q(container, '#fr-units-calculator')
    // KaTeX 以外的文字；reg（暫存器與參數的程式碼名稱）與下拉選單（<option> 是純文字）不算
    const bare = (el: Element) => {
      const c = el.cloneNode(true) as Element
      c.querySelectorAll('.katex, .c-param-reg, select').forEach((e) => e.remove())
      return c.textContent ?? ''
    }
    const boxes = Array.from(root.querySelectorAll('.c-param'))
    expect(boxes.length).toBeGreaterThanOrEqual(12)
    for (const b of boxes) {
      const where = `控制項「${b.querySelector('.c-param-label')?.textContent}」`
      expect(unicodeMathIn(bare(b)), where).toEqual([])
      expect(bare(b), `${where}：負號要寫在 $…$ 裡`).not.toContain('−')
    }
    // 符號確實由 KaTeX 排版：N、μ、f_s、σ_v、C、f_out、A_t、Δ_LSB 這 8 個 label，以及 K_q、f_u 的 hint
    const labels = boxes.map((b) => b.querySelector('.c-param-label')?.querySelectorAll('.katex').length ?? 0)
    expect(labels.filter((n) => n > 0).length).toBe(8)
    expect(boxes.some((b) => b.querySelector('.c-param-hint .katex'))).toBe(true)
    // 指標表：名稱＋說明（第 1 欄）與單位（第 3 欄）
    const rows = Array.from(root.querySelectorAll('.c-metric-table tbody tr'))
    expect(rows.length).toBeGreaterThanOrEqual(11)
    for (const r of rows) {
      const cells = r.querySelectorAll('td')
      for (const i of [0, 2]) {
        expect(unicodeMathIn(bare(cells[i])), r.textContent ?? '').toEqual([])
        expect(bare(cells[i]), `${r.textContent}：負號要寫在 $…$ 裡`).not.toContain('−')
      }
    }
    // 單位鏈表的「量」欄：「−3 dB corner」的負號與單位是 KaTeX
    for (const td of Array.from(root.querySelectorAll('.fr-chain-table tbody td:first-child'))) {
      expect(unicodeMathIn(bare(td)), td.textContent ?? '').toEqual([])
      expect(bare(td), `${td.textContent}：負號要寫在 $…$ 裡`).not.toContain('−')
    }
    const corner = Array.from(root.querySelectorAll('.fr-chain-table tbody tr')).find((r) => /corner/.test(r.querySelector('td')?.textContent ?? ''))
    expect(corner?.querySelector('td .katex')).toBeTruthy()
    expect(renderProblems(root)).toEqual([])
  })

  it('regimeLabelTex：型態名稱裡的「−3 dB」改成 $-3\\,\\mathrm{dB}$（其餘文字不動），單位鏈的 pole 列用它顯示', () => {
    expect(regimeLabelTex('Low-pass（有 −3 dB 點）')).toBe(String.raw`Low-pass（有 $-3\,\mathrm{dB}$ 點）`)
    expect(regimeLabelTex('High-pass')).toBe('High-pass')
    const { container } = mountAt(<Harness />)
    const root = q(container, '#fr-units-calculator')
    const pole = Array.from(root.querySelectorAll('.fr-chain-table tbody tr')).find((r) => r.querySelector('td')?.textContent === 'Pole')!
    const note = pole.querySelector('td:last-child .small')!
    expect(note.querySelector('.katex')).toBeTruthy()
    expect(note.textContent).toContain('Low-pass（有')
    expect(note.textContent).not.toContain('−3 dB')
  })

  it('三張圖的圖內文字（軸標題、圖例名稱、註記）：數學是 $…$ LaTeX，沒有 Unicode 拼的數學，轉成 Plotly 文字後沒有殘留的 \\ { } $', async () => {
    PLOT.strings.clear()
    const { container } = mountAt(<Harness />)
    const root = q(container, '#fr-units-calculator')
    fireEvent.click(buttonByText(root, /^(Run|執行)/))
    await waitFor(() => expect(crossText(root)).toMatch(/引擎：精確 1-bit Binomial/), { timeout: 20_000 })
    const strings = [...PLOT.strings]
    // 三張圖都有畫：註記、兩條 x 軸、三條 y 軸、圖例名稱（解析曲線、矩形近似、Monte Carlo 路徑）
    for (const want of [
      String.raw`$(1-p)$`,
      String.raw`$f_{3\mathrm{dB}}$`,
      String.raw`$\mathrm{ENBW}$`,
      String.raw`$f$ [Hz]（block-rate 序列：$0\ldots f_u/2$）`,
      String.raw`$|H|^2/|H(0)|^2$ [dB]`,
      String.raw`Case A：$F(f)$`,
      String.raw`Case A：矩形近似 $\min(1,\ f/\mathrm{ENBW})$`,
      '$f$ [Hz]',
      String.raw`$0\ldots f$ 的雜訊功率比例 $F(f)$`,
      String.raw`Case A：$\delta_k$（chain 0）`,
      'block $k$（burn-in 之後）',
      String.raw`$\delta_k = a - w_k$ [fs]`,
    ])
      expect(strings, want).toContain(want)
    for (const s of strings) {
      const outside = s.replace(/\$[^$]*\$/g, ' ')
      expect(unicodeMathIn(outside), `圖內文字 $…$ 以外的 Unicode 數學：${s}`).toEqual([])
      expect(outside, `圖內文字的負號要寫在 $…$ 裡：${s}`).not.toContain('−')
      // 轉成 Plotly 的 pseudo-HTML：不認得的指令會原樣留下反斜線，語法錯誤會留下大括號或 $
      expect(plotMath(s), `轉換後殘留 TeX：${s}`).not.toMatch(/[\\${}]/)
    }
    // 轉換結果是斜體符號與真正的上下標（不是把 TeX 原樣貼上去）
    expect(plotMath(String.raw`Case A：$\delta_k$（chain 0）`)).toBe('Case A：<i>δ</i><sub><i>k</i></sub>（chain 0）')
    expect(plotMath(String.raw`$|H|^2/|H(0)|^2$ [dB]`)).toBe('|<i>H</i>|<sup>2</sup>/|<i>H</i>(0)|<sup>2</sup> [dB]')
    expect(plotMath(String.raw`$f_{3\mathrm{dB}}$`)).toBe('<i>f</i><sub>3dB</sub>')
    expect(plotMath(String.raw`$0\ldots f$ 的雜訊功率比例 $F(f)$`)).toBe('0…<i>f</i> 的雜訊功率比例 <i>F</i>(<i>f</i>)')
  })

  it('T13: 反面 —— 把 GMAC 改成 sum：警告解釋 g 放大 N 倍與 g ≥ 2，單位鏈沒有 σ_w／頻寬；Run 之後 Monte Carlo 標為不做判定', async () => {
    const { container } = mountAt(<Harness />)
    const root = q(container, '#fr-units-calculator')
    const mode = Array.from(root.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => /^sum：/.test(o.textContent ?? '')))!
    const sum = Array.from(mode.options).find((o) => /^sum：/.test(o.textContent ?? ''))!
    act(() => {
      fireEvent.change(mode, { target: { value: sum.value } })
    })
    await waitFor(() => expect(crossText(root)).toMatch(/gm_mode=sum 時有效增益放大 N 倍/))
    const all = crossText(root)
    expect(all).toMatch(/g ≥ 2：一階模型不穩定/)
    expect(text(root, '.fr-chain-table')).toContain('326.814')
    expect(text(root, '.fr-chain-table')).toContain('沒有穩態')
    // 沒有任何 case 有穩態 → Analytic 交叉比對是 n/a 並說明原因
    expect(all).toMatch(/沒有任何 case 有穩態/)
    fireEvent.click(buttonByText(root, /^(Run|執行)/))
    await waitFor(() => expect(crossText(root)).toMatch(/Case A 的 Monte Carlo 不做判定/), { timeout: 20_000 })
    expect(crossText(root)).toMatch(/limit cycle/)
    expect(renderProblems(root)).toEqual([])
  })

  it('?preset=units-sum-vs-average：載入三個 case；比較表三列；Case B 沒有 σ_w', async () => {
    const { container } = mountAt(<Harness />, { url: '/formulas?preset=units-sum-vs-average' })
    const root = q(container, '#fr-units-calculator')
    await waitFor(() => expect(count(root, '.c-case')).toBe(3))
    const rows = root.querySelectorAll('.fr-cases-table tbody tr')
    expect(rows.length).toBe(3)
    expect(rows[0].textContent).toContain('average')
    expect(rows[1].textContent).toContain('sum')
    expect(rows[1].textContent).toContain('326.8')
    expect(rows[2].textContent).toContain('0.07979')
    expect(crossText(root)).toMatch(/Case B：.*gm_mode=sum 時有效增益放大 N 倍/s)
    expect(renderProblems(root)).toEqual([])
    // Reset 回到單一 case 的預設值
    fireEvent.click(buttonByText(root, /^(Reset|重設)/))
    await waitFor(() => expect(count(root, '.c-case')).toBe(1))
    expect(root.querySelector('.fr-cases-table')).toBeNull()
    expect(count(root, '.callout-danger')).toBe(0)
  })

  it('反面：C ≤ 0 的 preset → 極性警告；不合法的 preset id 被忽略', async () => {
    const neg = mountAt(<Harness />, { url: '/formulas?preset=units-polarity-negative-c' })
    const root = q(neg.container, '#fr-units-calculator')
    await waitFor(() => expect(crossText(root)).toMatch(/C ≤ 0：更新極性錯誤/))
    expect(text(root, '.fr-chain-table')).toContain('極性錯誤')
    neg.unmount()
    const bad = mountAt(<Harness />, { url: '/formulas?preset=does-not-exist' })
    const root2 = q(bad.container, '#fr-units-calculator')
    expect(text(root2, '.fr-chain-table')).toContain('0.0797885')
    expect(count(root2, '.callout-danger')).toBe(0)
  })

  it('指標表的「公式」欄（FormulaLink）：公式在別頁時被攔截成頁面切換，直接到該章的公式（href 本身是 #/formulas?f=…，中鍵／複製連結用）', () => {
    const { container, loc } = mountAt(<Harness />)
    const a = q<HTMLAnchorElement>(container, '#fr-units-calculator a[data-formula-link="F-12.9"]')
    expect(a.getAttribute('href')).toBe('#/formulas?f=F-12.9')
    expect(fireEvent.click(a)).toBe(false) // preventDefault 生效
    expect(loc()).toBe('/ch/12?f=F-12.9') // 帶 ?f=，目標頁載好後會捲到那條公式
    expect(J.jumps).toEqual(['F-12.9'])
  })
})
