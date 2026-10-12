import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { renderTex } from '@/components'
import * as plotMathModule from '@/components/plotMath'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import { SettingsProvider } from '@/app/settings'
import { presetById, presetsForExperiment } from '@/app/presets'
import { analyzeFxLab, closedLoopConsistent, pathStability, pathTransfer, runFxComparison, type FxPathSpec } from '@/simulation/models/filteredX'
import { lfilter } from '@/simulation/signal'
import Chapter07 from './index'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import {
  DEFAULT_CASES,
  DEFAULT_SCENARIO,
  EXPERIMENT_ID,
  blocksToConverge,
  parseLabPreset,
  toCaseSpec,
  toCodeSpec,
  toFxScenario,
  toHatSpec,
  toPathSpec,
} from './experiments/labState'
import { ufDisplayScale } from './experiments/labPlots'
import { DelayFxLab } from './experiments/DelayFxLab'

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

// 多個測試行程同時執行時 CPU 可能嚴重超額：沒有另外指定 timeout 的模擬測試給足夠的時間（預設只有 5 秒）；
// 整章渲染後的 cleanup（afterEach）也可能超過預設的 10 秒
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

/** Unicode／ASCII 拼湊的數學：希臘字母、上下標字元、關係符號、x_ref、x[n]、E[…]、^2、C = 1 這類寫法 */
const PLAIN_MATH = /[θΩωζφσμτρδ∠Ĥĥ√²³≤≥≈≠±∇λΔΣΦπ∞∈⇒⇔∝₀₁₂⁻]|\b[A-Za-z]_\{?[A-Za-z0-9]|\b[A-Za-z]\[[a-z]|\bE\[|\^[0-9{]|\b[A-Za-z] ?= ?[-−+]?\d/
/**
 * 頁面上不在 KaTeX 裡、卻含有拼湊數學的文字節點（docs/teaching-style.md §3：數學一律 LaTeX）。
 * 不檢查：程式碼與暫存器名稱（code／pre／.mono）、<select> 選項與 SVG（Plotly、Mermaid 的圖本身不渲染 KaTeX；Mermaid 的圖說支援 $...$，所以本章自己的圖說要檢查；共用的系統地圖圖說不在本章範圍）、
 * 共用元件自帶的文字（模型層級標籤的說明、指標表的表頭、按鈕）；全站警告的固定標籤「C ≤ 0／C ≈ 0」視為文字。
 */
function plainMathText(container: HTMLElement): string[] {
  const SKIP = '.katex, code, pre, select, svg, .mono, .c-code, .c-mermaid-svg, figure[aria-label*="系統方塊圖"], .c-tip, .c-metric-table th, button, script, style'
  const out: string[] = []
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    const t = (n.textContent ?? '').trim().replace(/C (?:≤|≈) 0/g, '')
    if (el && t && PLAIN_MATH.test(t) && !el.closest(SKIP)) out.push(`<${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}"> ${t}`)
  }
  return out
}

/**
 * Plot 元件送進 Plotly 之前的圖內文字（trace 名稱、軸標題、標註、ticktext、hovertemplate…）：
 * 以 spy 截下 Plot 呼叫 applyPlotMath 時的原始 data／layout（docs/teaching-style.md §3：圖裡面的數學也要用 LaTeX）。
 */
function plotStringsOf(calls: unknown[][]): string[] {
  const KEYS = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext'])
  const out: string[] = []
  const walk = (v: unknown, key: string | null, depth: number): void => {
    if (depth > 6 || v === null || v === undefined) return
    if (typeof v === 'string') {
      if (key !== null && KEYS.has(key)) out.push(v)
      return
    }
    if (Array.isArray(v)) {
      v.forEach((x) => walk(x, key, depth + 1))
      return
    }
    if (typeof v === 'object' && !ArrayBuffer.isView(v)) for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1)
  }
  for (const [data, layout] of calls) {
    walk(data, null, 0)
    walk(layout, null, 0)
  }
  return out
}

function renderChapter(url = '/ch/07') {
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <Chapter07 />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

afterEach(() => {
  localStorage.clear()
  P.react.mockClear()
})

describe('Chapter 07（jsdom smoke）', () => {
  it('完整渲染不丟錯：各節標題、公式錨點與 Lab 都在；符號表在章末（id="symbols"），章首只留一行連結；沒有重複的公式 id', () => {
    const { container } = renderChapter()
    // 符號表放在章末（docs/teaching-style.md §5）：全頁只有一張，包在 id="symbols" 裡，是頁面的最後一個區塊（在「本課必記」與 7.10 之後）
    const symbols = container.querySelector('#symbols') as HTMLElement
    expect(symbols).not.toBeNull()
    expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
    expect(symbols.querySelector('.c-symbols tbody')?.querySelectorAll('tr').length).toBeGreaterThanOrEqual(20)
    expect(container.querySelector('.ch07')?.lastElementChild).toBe(symbols)
    const precedes = (a: Element | null, b: Element | null) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(precedes(container.querySelector('#ch07-recap'), symbols)).toBe(true)
    expect(precedes(container.querySelector('#ch07-pll'), symbols)).toBe(true)
    expect(symbols.querySelector('h2')?.textContent).toBe('本章符號表')
    // 章首只留一行連結「本章符號表在最後 ↓」：在系統地圖與 7.1 節之前；是按鈕而不是會改變 HashRouter 路由的 href
    const link = container.querySelector('.ch07-symlink button') as HTMLButtonElement
    expect(link).not.toBeNull()
    expect(link.textContent).toContain('本章符號表在最後')
    expect(container.querySelectorAll('.ch07-symlink')).toHaveLength(1)
    expect(link.closest('a')).toBeNull()
    expect(container.querySelector('a[href="#symbols"]')).toBeNull()
    expect(precedes(link, container.querySelector('figure.c-mermaid'))).toBe(true)
    expect(precedes(link, container.querySelector('#ch07-problem'))).toBe(true)
    const scrolled = vi.fn()
    symbols.scrollIntoView = scrolled
    fireEvent.click(link)
    expect(scrolled).toHaveBeenCalledTimes(1)
    // 章首的系統地圖 + 22 張方塊圖（原始碼的語法與內容由 diagrams.test.tsx 用真正的 mermaid 檢查）
    const figures = container.querySelectorAll('figure.c-mermaid')
    expect(figures).toHaveLength(23)
    expect(figures[0].getAttribute('aria-label')).toContain('系統方塊圖')
    expect(precedes(figures[0], container.querySelector('#ch07-problem'))).toBe(true)
    // 符號表移到章末之後，每個符號第一次出現時要就地用一句話說明（不能只靠符號表）
    const sec = (id: string) => container.querySelector(id) as HTMLElement
    const texIn = (id: string) => Array.from(sec(id).querySelectorAll('annotation')).map((a) => a.textContent ?? '')
    const s1 = sec('#ch07-problem').textContent ?? ''
    for (const phrase of ['DTC 真正的 gain', '目前的校正係數', '雜訊', '標準差', '正負號', 'learning rate', '小訊號增益', 'loop gain', '是 code 的振幅', '誤差路徑在 code 頻率的相位', '離變號']) expect(s1, phrase).toContain(phrase)
    for (const t of [String.raw`\delta=a-w`, String.raw`\sigma_v`, String.raw`e_{\mathrm{PD}}[n]=(a-w)\,u[n]+v[n]`, String.raw`\phi=\angle H`, String.raw`g=\mu K_qC`, 'G_k', 'N']) expect(texIn('#ch07-problem'), t).toContain(t)
    // 架構約定（docs/assumptions.md §2a）：7.1 節第一次給出物理圖像——DTC 在 reference 輸入端、回授路徑上只有 divider、
    // DTC 的補償量 w·x[n] 從基準延遲 T_0 往回扣、PD 量的是 t_ref′ − t_fb；comparator 取的是 PD 的輸出（送進 loop filter 的同一個訊號）
    for (const phrase of ['DTC 在 reference 輸入端', '回授路徑上只有 divider', '補償量', '基準延遲', 'reference edge 減 feedback edge', 'edge 比理想時刻早到', 'comparator 取的就是這個 PD 輸出', '送進 loop filter 的同一個訊號']) {
      expect(s1, phrase).toContain(phrase)
    }
    for (const t of [String.raw`\tau_{\mathrm{DTC}}[n]=T_0-w\,x[n]`, String.raw`t_{\mathrm{ref}}'-t_{\mathrm{fb}}`, String.raw`(a-w)\,x[n]`, String.raw`(a-w)\,u[n]`]) expect(texIn('#ch07-problem'), t).toContain(t)
    // 章首系統地圖下面的那句話也照同一個接法
    expect(container.querySelector('figure.c-sysmap')?.nextElementSibling?.textContent).toMatch(/comparator 取的是 PD 的輸出/)
    expect(container.querySelector('figure.c-sysmap')?.nextElementSibling?.textContent).toMatch(/DTC 在 reference 輸入端，回授路徑上只有 divider/)
    // 7.4、7.6 節的閉迴路圖與 RTL 位置圖：走圖說明寫明 comparator 取 PD 的輸出、w_k 送回 reference 端的 DTC
    for (const id of ['#ch07-gradient', '#ch07-hardware']) {
      expect(sec(id).textContent, id).toMatch(/comparator 取的就是這個 PD 輸出/)
      expect(sec(id).textContent, id).toMatch(/送回 reference 端的 DTC/)
    }
    // reference 端的 DTC 只能延遲：code x[n] 越大延遲越短（7.1 節）；RTL 送進 DTC 的 code 從固定的中心值往回扣（7.6 節）
    expect(s1).toMatch(/越大，延遲越短/)
    // 補償不足（w < a）時 reference edge 太晚：x[n] > 0 時誤差為正，也就是誤差和 x[n] 同號（本章的例子 x[n] 有正有負，所以寫成「同號」）
    expect(s1).toMatch(/補償不足、.*時 reference edge 還是太晚：.*時誤差為正，也就是誤差和.*同號/)
    expect(texIn('#ch07-problem')).toContain('x[n]>0')
    expect(sec('#ch07-hardware').textContent).toMatch(/DTC 只能延遲.*從一個固定的中心值往回扣.*越大，延遲越短/)
    expect(texIn('#ch07-hardware')).toContain(String.raw`w_k\,x[n]`)
    // 7.4 節：e_PD（含雜訊）就是 PD 的輸出——推導第 1 步與梯度圖的走圖說明都這樣寫，不會讀成「PD 的輸出之後才加雜訊」
    const s4 = sec('#ch07-gradient').textContent ?? ''
    expect(s4).toMatch(/再加上雜訊.*，就是 PD 的輸出/)
    expect(s4).toMatch(/圓形加法點的輸出就是 PD 的輸出，兩個乘法器都從這裡取訊號/)
    expect(s4).not.toMatch(/成為 PD 的輸出，再加上雜訊/)
    // 7.5 節的 Type-II 迴路：PD 的輸出＝reference 輸入減回授，誤差從 PD 的 reference 輸入注入，H_PD = 1/(1 + L) 取正號；DTC 不在回授路徑上
    const s5 = sec('#ch07-mismatch').textContent ?? ''
    // 回授線走的是 divider（圖上標「divider 的回授」，圖說與走圖說明同一個說法）
    expect(s5).toMatch(/divider 的回授從負端進來/)
    expect(s5).toMatch(/只在回授線上標出「divider 的回授」/)
    for (const phrase of ['先看標著 PD 的圓圈', 'reference 端減回授端', 'DTC 不在這條路上', '和送進 loop filter 的是同一個訊號', 'PD 的輸出等於 reference 端的輸入減掉']) expect(s5, phrase).toContain(phrase)
    expect(texIn('#ch07-mismatch')).toContain(String.raw`e_{\mathrm{PD}}=\phi_{\mathrm{dtc}}-\theta_{\mathrm{fb}}`)
    expect(texIn('#ch07-mismatch')).toContain(String.raw`e_{\mathrm{PD}}=H_{\mathrm{PD}}\,\phi_{\mathrm{dtc}}`)
    expect(texIn('#ch07-mismatch').some((t) => t.includes(String.raw`-\underbrace{L(z)\,(a-w)\,U(z)}_{\text{回授}}`) && t.includes(String.raw`U(z)=\frac{X(z)}{1+L(z)}`))).toBe(true)
    expect(texIn('#ch07-mismatch')).toContain(String.raw`H_{\mathrm{PD}}=\frac{U}{X}=\frac{1}{1+L}=\frac{\nabla^2}{\nabla^2+(K_i+K_p\nabla)\,z^{-(1+d)}}`)
    // 符號表：e_PD 是 PD 的輸出；DTC 的補償量與基準延遲、t_ref′／t_fb 都有列
    const symTex = Array.from(symbols.querySelectorAll('annotation')).map((a) => a.textContent ?? '')
    for (const t of [String.raw`T_0,\ \tau_{\mathrm{DTC}}[n]=T_0-w\,x[n]`, String.raw`t_{\mathrm{ref}}',\ t_{\mathrm{fb}}`, String.raw`C_{f,D}`]) expect(symTex, t).toContain(t)
    expect(symbols.textContent).toMatch(/凍結（固定不動）時的值；見 §7\.4 的前提/)
    expect(symbols.textContent).toMatch(/PD 的輸出（PD 誤差；comparator 取的就是它，也就是送進 loop filter 的同一個訊號）/)
    expect(symbols.textContent).toMatch(/誤差從 PD 的 reference 輸入注入/)
    expect(sec('#ch07-linear-phase').textContent).toMatch(/自然頻率（natural frequency）/)
    expect(sec('#ch07-linear-phase').textContent).toMatch(/阻尼（damping/)
    expect(sec('#ch07-linear-phase').textContent).toMatch(/pipeline latency/)
    expect(sec('#ch07-gradient').textContent).toMatch(/GMAC 實際拿來相乘的訊號/)
    expect(texIn('#ch07-gradient')).toContain(String.raw`x_{\mathrm{ref}}[n]`)
    // R06b：F-07.1 的等號只在 w 凍結時成立——前提寫在公式旁（所有模式），兩拍的反例在 Engineer 以上；7.1 節指到這裡
    for (const phrase of ['當成固定不動的常數', '記憶長度內幾乎不變', '兩拍的反例', '慢適應前提', '方塊裡寫的是 F-06.1 的近似式']) expect(s4, phrase).toContain(phrase)
    expect(texIn('#ch07-gradient').some((t) => t.includes(String.raw`h*\big((a-w)\,x\big)=(a-w)\,(h*x)`))).toBe(true)
    expect(texIn('#ch07-gradient')).toContain(String.raw`e_{\mathrm{PD}}[n]\approx(a-w_k)\,u[n]+v[n]`)
    expect(texIn('#ch07-gradient').some((t) => t.includes(String.raw`\sum_{m\ge1}h[m]\,\big(w[n]-w[n-m]\big)\,x[n-m]`))).toBe(true)
    expect(texIn('#ch07-gradient').some((t) => t.includes(String.raw`=(a-w[n])\,x[n]`) && t.includes(String.raw`-(a-w[n-1])\,x[n-1]`) && t.includes(String.raw`=0\times1-1\times1=-1`) && t.includes(String.raw`(a-w[n])\,u[n]=0\times(1-1)=0`))).toBe(true)
    expect(s1).toMatch(/固定不動時兩者完全相等；.*在更新時只是近似（Ch06 的 F-06\.1），成立條件寫在 7\.4 節的 F-07\.1 下面/)
    // 「記憶長度」就地定義成衰減的時間尺度（1/e），和框裡的 1/(1 − 0.964) ≈ 28 個 sample 是同一個量；Lab 的假設欄也帶著這個前提（平均 pole 引用 F-07.11）
    expect(s4).toMatch(/記憶長度是脈衝響應.*衰減的時間尺度/)
    expect(texIn('#ch07-gradient')).toContain(String.raw`1/e\approx37\%`)
    expect(texIn('#ch07-gradient')).toContain(String.raw`1/(1-0.964)\approx28`)
    const labAssumptions = Array.from(container.querySelectorAll('[id="exp-delay-fx-lab"] .c-assumption-list li')).map((li) => li.textContent ?? '')
    expect(labAssumptions.some((t) => t.includes('小訊號線性化') && t.includes('記憶長度內近似不變') && t.includes('F-06.1') && t.includes('先乘後濾'))).toBe(true)
    // R03：章內的 F-07.11／F-07.12 與登錄表逐字相同（帶著 regressor 的額外延遲 D）；D = 0 的約定寫在公式旁
    const reg = (id: string) => FORMULAS.find((f) => f.id === id)?.tex ?? ''
    expect(texIn('#ch07-gradient')).toContain(reg('F-07.11'))
    expect(texIn('#ch07-gradient')).toContain(reg('F-07.10'))
    expect(texIn('#ch07-mismatch')).toContain(reg('F-07.12'))
    // 桌機放不下一整行、拆成對齊兩行的公式（F-07.5、F-07.8、F-07.16）：章內的方塊與登錄表逐字相同；拆的是換行，內容不變
    for (const id of ['F-07.5', 'F-07.8', 'F-07.16']) {
      expect(reg(id).startsWith(String.raw`\begin{aligned}`), id).toBe(true)
      expect(texIn(`[id="formula-${id}"]`), id).toContain(reg(id))
    }
    const oneLine = (tex: string) => tex.replace(/\\begin\{aligned\}|\\end\{aligned\}|&/g, '').replace(/\\\\/g, ' ')
    expect(oneLine(reg('F-07.5'))).toBe(String.raw`C_D=A^2\,H(e^{j\Omega})\cos(\Omega D),\quad H(e^{j\Omega})\in\mathbb R\quad(\Omega\in\{0,\pi\}); \text{例：交替碼 }x[n]=A(-1)^n\Rightarrow C_D=A^2H(e^{j\pi})(-1)^D`)
    expect(oneLine(reg('F-07.8'))).toBe(
      String.raw`C_D=\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}(e^{j\Omega})\,\mathrm{Re}\big\{H(e^{j\Omega})\,e^{j\Omega D}\big\}\,d\Omega =\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}\,|H|\cos\big(\phi(\Omega)+\Omega D\big)\,d\Omega=\sum_k h[k]\,R_x[k-D]`,
    )
    expect(oneLine(reg('F-07.16'))).toBe(
      String.raw`E[u\,u_f]=K_2\Big[(1-\rho_x)^2h[0]-2(1-\rho_x)h[1]+(1-\rho_x)^2\sum_{k\ge2}h[k]\rho_x^{k-2}\Big], E[u_f^2]=2K_2^2(1-\rho_x)(3-\rho_x)`,
    )
    // 7.10：會縮小 g 的穩定範圍的是 GMAC 的更新延遲（Ch08）；filtered-x 的 D、Ĥ 的 latency 在 regressor 那一側（前饋），改的是 C_{f,D}，不是 g 的穩定上限
    const s10 = sec('#ch07-pll').textContent ?? ''
    expect(s10).toMatch(/算出的修正量晚幾個 block 才生效（更新延遲），會縮小.*的穩定範圍——這是 Ch08 的主題/)
    expect(s10).toMatch(/不是這一種延遲：它們在 regressor 那一側（前饋），不在校正迴路的回授路徑上。在平均模型裡（.*慢變）它們只改變相關.*（F-07\.12）——同一個.*的大小，甚至正負號——不改變.*的穩定上限/)
    expect(s10).not.toMatch(/額外 latency，都會縮小/)
    expect(texIn('#ch07-pll')).toContain(String.raw`g=\mu K_q\,C_{f,D}`)
    // bring-up 的走圖文字：G_± 與斜率都是小訊號線性化的近似（和圖上的 ≈ 一致）
    expect(texIn('#ch07-pll')).toContain(String.raw`S\approx-K_qC`)
    expect(texIn('#ch07-pll')).not.toContain('S=-K_qC')
    expect(s4).toMatch(/沒有另外標.*的 filtered-x 都是/)
    expect(s4).toMatch(/、.*的 filtered-x 恆為 1/)
    expect(texIn('#ch07-gradient')).toContain(String.raw`C_{f,D}=E\big[u[n]\,u_f[n-D]\big]`)
    expect(s5).toMatch(/而且 regressor 沒有額外延遲（.*）時成立/)
    expect(s5).toMatch(/本節以下的圖、表與手算都取/)
    expect(s5).toMatch(/自己的自相關——大小不超過.*，但可以是負的/)
    // 7.5 節的例子（T07 的單頻、Ĥ = H）：D = 2、3、4 ⇒ 0.5、0、−0.5，由模型即時計算
    const pExtraD = Array.from(sec('#ch07-mismatch').querySelectorAll('p')).find((p) => p.textContent?.includes('本節以下的圖、表與手算都取')) as HTMLElement
    const pExtraTex = Array.from(pExtraD.querySelectorAll('annotation')).map((a) => a.textContent ?? '')
    expect(pExtraTex.slice(pExtraTex.indexOf('D=2'), pExtraTex.indexOf('D=2') + 6)).toEqual(['D=2', '0.5', 'D=3', '0', 'D=4', '-0.5'])
    expect(pExtraD.textContent).toMatch(/（反向更新）；和下面「.*多算.*」的表逐列相同/)
    expect(texIn('#ch07-mismatch')).toContain(String.raw`C_{f,D}=E\big[u[n]\,u[n-D]\big]=R_u[D]`)
    expect(texIn('#ch07-mismatch').some((t) => t.includes(String.raw`E\big[u[n]\,u_f[n-D]\big]`) && t.includes(String.raw`=\sum_k\sum_l h[k]\,\hat h[l]\,R_x[k-l-D]`))).toBe(true)
    expect(texIn('#ch07-mismatch')).toContain(String.raw`\theta(\Omega)=\angle H-\angle\hat H+\Omega D`)
    expect(texIn('#ch07-recap').some((t) => t.includes(String.raw`p_f=1-\mu K_q\,C_{f,D}`))).toBe(true)
    expect(texIn('#ch07-recap').some((t) => t.includes(String.raw`\cos(\angle H-\angle\hat H+\Omega D)`))).toBe(true)
    // Lab 的指標列：filtered-x 的相關寫成 C_{f,D}（帶著目前 Case 的 D），E[u²] 那一列註明 Ĥ = H、D = 0
    expect(texIn('[id="exp-delay-fx-lab"]')).toContain(String.raw`C_{f,D}=E\big[u[n]\,u_f[n-0]\big]`)
    expect(sec('#ch07-mismatch').textContent).toMatch(/PI loop filter 的比例係數與積分係數/)
    for (const t of ['7.1 一個問題', '7.2 推導', '7.3 為什麼一個 delay', '7.4 Filtered-x', '7.5 模型不準', '7.6 硬體成本', '7.7 動手觀察', '7.8 思考題', '7.9 本課必記', '7.10 連結到 PLL']) {
      expect(screen.getAllByText((_, el) => !!el && el.tagName === 'H2' && (el.textContent ?? '').startsWith(t)).length).toBeGreaterThan(0)
    }
    // 每個登錄的公式都有對應的 TexBlock 錨點（engineer 模式：ModeGate 內的公式也會顯示）
    const ids = Array.from(container.querySelectorAll('[id^="formula-F-07"]')).map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of FORMULAS) expect(ids).toContain(`formula-${f.id}`)
    // KaTeX 有渲染、勘誤標記連到 #/verification
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(200)
    const errata = Array.from(container.querySelectorAll('a.ch07-erratum-tag'))
    expect(errata.map((a) => a.textContent)).toEqual(expect.arrayContaining(['勘誤 E44', '勘誤 E45', '勘誤 E46']))
    expect(errata.every((a) => a.getAttribute('href') === '#/verification')).toBe(true)
    // 程式碼並排：四個 regressor region 都擷取成功，且有差異行高亮
    expect(screen.queryByText(/找不到程式碼 region/)).toBeNull()
    expect(container.querySelectorAll('.c-code-mark').length).toBeGreaterThanOrEqual(6)
    // 所有即時計算的數字都有限：頁面上不得出現 NaN / undefined / Infinity（KaTeX 解析錯誤也不得出現）
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/NaN|undefined|Infinity/)
    // 全章沒有舊接法的說法：DTC 不在回授路徑上、殘餘誤差不是從回授那一邊進來、DTC 給的是補償量（不是往後推 edge 的延遲）。
    // （下面是「不可以出現」的樣式，不是內文。）
    expect(text).not.toMatch(/DTC 在回授|divider 之後|回授路徑上的 DTC|DTC 插入|插入延遲|推回理想|feedback 側注入|回授側注入|延遲 feedback edge/)
    expect(container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
    // 7.5 的二次差分：DT 推導（F-07.15）與 AR(1) 確切式（F-07.16）都在
    expect(container.querySelector('[id="formula-F-07.16"]')).not.toBeNull()
    // 7.10：寬頻 PLL 的數字例子（engineer 模式）與案例頁連結；Lab 的 code 選單含一階 DSM
    expect(screen.getByText(/代入一組寬頻 PLL 的數字/)).toBeTruthy()
    expect(container.querySelector('a[href="#/case/sspll"]')).not.toBeNull()
    expect(Array.from(container.querySelectorAll('option')).some((o) => o.textContent?.includes('一階 DSM residue'))).toBe(true)
    // 內文不留純文字公式：h3 小標與表格內的「D = 數字」都改成 KaTeX
    const plain = Array.from(container.querySelectorAll('.ch07-table td, .ch07-subhead')).filter((el) => /[（(]D = \d+[)）]|D_max/.test(Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('')))
    expect(plain).toHaveLength(0)
    // 帶入手算：8 題依序出現，各自緊跟在對應的推導／worked example 之後；綜合題（HC-07.8）在 Lab 之後、思考題之前
    expect(Array.from(container.querySelectorAll('[id^="handcalc-HC-07"]')).map((e) => e.id)).toEqual(HANDCALCS.map((h) => `handcalc-${h.id}`))
    expect(container.querySelectorAll('.ch07-hand-invite').length).toBe(HANDCALCS.length)
    const q = (sel: string) => container.querySelector(sel)
    const before = (a: string, b: string) => {
      const ea = q(a)
      const eb = q(b)
      expect(ea, a).not.toBeNull()
      expect(eb, b).not.toBeNull()
      expect(!!((ea as Element).compareDocumentPosition(eb as Element) & Node.DOCUMENT_POSITION_FOLLOWING), `${a} 應在 ${b} 之前`).toBe(true)
    }
    before('[id="handcalc-HC-07.1"]', '#ch07-derivation')
    before('[id="formula-F-07.2"]', '[id="handcalc-HC-07.2"]')
    before('[id="handcalc-HC-07.2"]', '[id="formula-F-07.3"]')
    before('[id="formula-F-07.4"]', '[id="handcalc-HC-07.3"]')
    before('[id="handcalc-HC-07.3"]', '[id="formula-F-07.7"]')
    before('[id="formula-F-07.7"]', '[id="handcalc-HC-07.4"]')
    before('[id="handcalc-HC-07.4"]', '[id="formula-F-07.8"]')
    before('[id="formula-F-07.13"]', '[id="handcalc-HC-07.5"]')
    before('[id="formula-F-07.12"]', '[id="handcalc-HC-07.6"]')
    before('[id="handcalc-HC-07.6"]', '[id="formula-F-07.14"]')
    before('[id="formula-F-07.15"]', '[id="handcalc-HC-07.7"]')
    before('[id="handcalc-HC-07.7"]', '[id="formula-F-07.16"]')
    before('[id="exp-delay-fx-lab"]', '[id="handcalc-HC-07.8"]')
    before('[id="handcalc-HC-07.8"]', '#ch07-quiz')
    // 字串屬性裡的數學以 KaTeX 顯示（docs/teaching-style.md §3）：圖標題、程式碼標題、Lab 的假設與指標名稱的純文字部分不再有 Unicode 拼的公式
    const ownText = (el: Element) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('')
    const UNICODE_MATH = /[θΩωζφσμτρδ∠Ĥĥ√²≤≥≈±]|\b[A-Za-z]_([A-Za-z0-9]|ref|PD|raw)\b/
    const titled = Array.from(container.querySelectorAll('.c-plot-title, .c-figcaption, .c-code-title, .c-code-caption, .c-code-compare-label, .c-assumption-list li'))
    expect(container.querySelectorAll('.c-plot-title').length).toBeGreaterThanOrEqual(5)
    expect(container.querySelectorAll('.c-plot-title .katex').length).toBeGreaterThanOrEqual(5)
    expect(container.querySelectorAll('.c-assumption-list li .katex').length).toBeGreaterThanOrEqual(10)
    for (const el of titled) {
      expect(ownText(el), ownText(el)).not.toMatch(UNICODE_MATH)
    }
    // 指標表：名稱欄的純文字不含 Unicode 公式（數值與模型產生的診斷訊息除外）
    const metricNames = Array.from(container.querySelectorAll('.c-exp table tbody tr > td:first-child'))
    expect(metricNames.length).toBeGreaterThanOrEqual(8)
    for (const td of metricNames) expect(ownText(td), ownText(td)).not.toMatch(UNICODE_MATH)
    // Lab 的「目前 Case」描述（caseLabel）也用 KaTeX：預設 Case A 是 raw-x，沒有公式；這裡只確認沒有拼湊的數學
    expect(container.querySelector('.ch07-kv .v')?.textContent).toBe('raw-x')
    // 整章（engineer 模式）沒有任何不在 KaTeX 裡的拼湊數學——含內文、表格、手算題的步驟說明與備註、Lab 的警告
    expect(plainMathText(container)).toEqual([])
  }, 240000)

  it('T07: Gallery #4 以 ?preset= 載入 Lab，閉迴路（inline worker）顯示 A/B/C 三組結果', async () => {
    const plotSpy = vi.spyOn(plotMathModule, 'applyPlotMath')
    const { container } = renderChapter('/ch/07?preset=delay-phi-m120-d4')
    expect(await screen.findByText(/Case C：後半段 mean/, undefined, { timeout: 120000 })).toBeTruthy()
    expect(screen.getByText(/Case A：後半段 mean/)).toBeTruthy()
    // 解析：raw-x 的 C = −0.5（unit-power code），出現在 C ≤ 0 的警告中
    expect(screen.getAllByText(/C ≤ 0/).length).toBeGreaterThan(0)
    // 模型回傳的診斷訊息（純文字）經 diagMath 轉成 KaTeX：兩則警告（即時分析、閉迴路）裡的「C = −0.5」與 μ 都不再是純文字
    const warns = Array.from(container.querySelectorAll('.c-exp-warnings p'))
    expect(warns.length).toBeGreaterThanOrEqual(2)
    for (const w of warns) {
      expect(w.querySelectorAll('.katex').length, w.textContent ?? '').toBeGreaterThan(0)
      expect(w.querySelector('annotation')?.textContent).toMatch(/^C=-0\.(5|4999|5001)/)
    }
    // 交叉比對的說明（closedLoopConsistent）：p、|w_end − a| − |w_0 − a|、σ_rw、SE 都是 KaTeX
    const mc = Array.from(container.querySelectorAll('.c-check-note')).find((el) => el.textContent?.includes('Case A：ok'))
    expect(mc).toBeTruthy()
    const mcTex = Array.from((mc as Element).querySelectorAll('annotation')).map((a) => a.textContent ?? '')
    expect(mcTex.some((t) => /^p=1\.0\d+>1$/.test(t))).toBe(true)
    expect(mcTex.some((t) => t.startsWith('|w_{\\mathrm{end}}-a|-|w_0-a|='))).toBe(true)
    expect(mcTex.some((t) => t.startsWith('\\mathrm{SE}='))).toBe(true)
    // 閉迴路結果出來之後（警告、指標備註、交叉比對都已顯示）整章仍然沒有拼湊的數學，也沒有 KaTeX 錯誤
    expect(plainMathText(container)).toEqual([])
    expect(container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
    // 閉迴路圖有三條 w_k
    await waitFor(() => {
      const names = P.react.mock.calls.flatMap((c) => ((c as unknown as [unknown, { name?: string }[]])[1] ?? []).map((d) => d.name ?? ''))
      expect(names.some((n) => n.startsWith('Case A：raw-x'))).toBe(true)
      // 圖例名稱裡的 $D=4$ 由 plotMath 轉成斜體的 D（Plotly 收到的是 pseudo-HTML）
      expect(names.some((n) => n.startsWith('Case B：delayed-x，<i>D</i> = 4'))).toBe(true)
    }, { timeout: 60000 })
    // 整章所有 Plotly 圖（3.3 節的三張、3.5 節的一張、Lab 的波形／相關 vs D／逐頻率相位／閉迴路）的圖內文字：數學一律是 `$...$`
    const strings = plotStringsOf(plotSpy.mock.calls as unknown[][])
    plotSpy.mockRestore()
    expect(strings.length).toBeGreaterThan(40)
    expect(strings.filter((s) => s.includes('$')).length).toBeGreaterThanOrEqual(30)
    const INLINE = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
    for (const str of strings) {
      expect((str.match(/(?<!\\)\$/g) ?? []).length % 2, str).toBe(0)
      // 文字部分沒有 Unicode 拼的數學（希臘字母、∠、帶帽子的 Ĥ、上下標字元、x_ref 這類底線下標、E[…]）
      const rest = str.replace(INLINE, '')
      expect(unicodeMathIn(rest), `圖內文字：${str}`).toEqual([])
      expect(rest, `圖內文字：${str}`).not.toMatch(/[ĤĥŷΔ∠]|\u0302|\bE\[|[A-Za-z]\[n[-−]/u)
      // 轉成 Plotly pseudo-HTML 之後沒有殘留的 TeX（反斜線、大括號、$）；不支援的指令會原樣顯示指令名稱，所以也不能有 \ 開頭的字樣
      expect(plotMathModule.plotMath(str), `圖內文字：${str}`).not.toMatch(/[\\${}]/)
    }
  }, 240000)

  it('StrictMode（開發伺服器：掛載時 effect 連跑兩次）以 ?preset= 載入：A/B/C 三個 Case 都在，閉迴路的「C ≤ 0」警告依 Case 的 regressor 給建議', async () => {
    // main.tsx 用 StrictMode：開發模式下 A/B/C 的初始化 effect 會跑兩次。舊版第二次執行把 preset 的 Case 清單丟掉，畫面只剩 Case A。
    // preset「H = 1 卻把 code 錯位 D = 4」：A raw-x（C = +1）、B delayed-x D = 4（C = −0.5）、C delayed-x D = 3（C ≈ 0）
    const { container } = render(
      <StrictMode>
        <SettingsProvider>
          <MemoryRouter initialEntries={['/ch/07?preset=delay-code-misalignment']}>
            <DelayFxLab />
          </MemoryRouter>
        </SettingsProvider>
      </StrictMode>,
    )
    const caseButtons = () =>
      Array.from(container.querySelectorAll('button'))
        .map((b) => (b.textContent ?? '').trim())
        .filter((t) => /Case [ABC]$/.test(t))
    await waitFor(() => expect(caseButtons()).toEqual(['Case A', 'Case B', 'Case C']), { timeout: 30000 })
    // 閉迴路跑完：Case B 是 delayed-x，警告不再建議「需 delay alignment 或 filtered-x」，而是「換一個 D，或改用 filtered-x」；Case A（raw-x、C > 0）沒有警告
    const warningTexts = () => Array.from(container.querySelectorAll('.c-exp-warnings > *')).map((e) => e.textContent ?? '')
    await waitFor(() => expect(warningTexts().some((t) => t.includes('Case B（閉迴路）：C ≤ 0'))).toBe(true), { timeout: 60000 })
    const b = warningTexts().find((t) => t.includes('Case B（閉迴路）：C ≤ 0')) as string
    expect(b).toContain('這個 Case 已經是 delayed-x：要換一個')
    expect(b).toContain('（F-07.4），或改用 filtered-x')
    expect(b).not.toContain('需 delay alignment 或 filtered-x')
    expect(warningTexts().some((t) => t.includes('Case A'))).toBe(false)
    expect(container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
  })

  it('三模式切換：點 filtered-x 後目前 Case 改為 filtered（aria-checked），並顯示 Ĥ 誤差控制', async () => {
    const renderChapterResult = renderChapter()
    const { container } = renderChapterResult
    const radio = Array.from(container.querySelectorAll('.ch07-mode-switch button')).find((b) => b.textContent === 'filtered-x') as HTMLElement
    expect(radio).toBeTruthy()
    fireEvent.click(radio)
    await waitFor(() => expect(radio.getAttribute('aria-checked')).toBe('true'), { timeout: 60000 })
    expect(screen.getAllByText(/額外延遲/).length).toBeGreaterThan(0)
  }, 240000)

  it('Run-to-Convergence：寬頻低通 preset 的 raw-x（τ ≈ 129 blocks）不足 10τ ⇒ 按鈕把 block 數加長到 ⌈12τ⌉ = 1554 並重跑', async () => {
    const { container } = renderChapter('/ch/07?preset=filtered-x-second-diff-wideband-fail')
    expect(await screen.findByText(/Case C：後半段 mean/, undefined, { timeout: 120000 })).toBeTruthy()
    // 重跑前：Case C 因 block 數不足 10τ 而不比對
    expect(container.textContent).toContain('block 數 300 不足')
    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Run-to-Convergence')) as HTMLElement
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(await screen.findByText(/1554 blocks/, undefined, { timeout: 120000 })).toBeTruthy()
    await waitFor(() => expect(container.textContent).toContain('777 個相關 block'), { timeout: 60000 })
    expect(container.textContent).not.toContain('block 數 300 不足')
    expect(container.textContent).not.toContain('block 數 1554 不足')
    // 參數面板的 block 數同步更新；結果對應目前參數（沒有「重算中」）
    expect((container.querySelector('input[type="text"][aria-label="block 數"]') as HTMLInputElement).value).toBe('1554')
    expect(container.textContent).not.toContain('重算中')
  }, 300000)

  // Beginner 與 Research 各渲染一次、分成兩個測試：整章渲染在 CPU 超額時要一兩分鐘，放在同一個測試裡會超時
  it('Beginner 模式顯示入門三句話，推導預設收合；手算題仍在（research 等級的 HC-07.7 除外）', () => {
    localStorage.setItem('lmspll.mode', 'beginner')
    const a = renderChapter()
    expect(screen.getByText('入門模式：先抓住三句話')).toBeTruthy()
    // Beginner：推導預設收合（一鍵展開），但 boxed 結果與 Lab 會用到的 ρ 定義（F-07.13）仍直接顯示
    const folds = Array.from(a.container.querySelectorAll('.ch07-fold > details'))
    expect(folds.length).toBeGreaterThanOrEqual(8)
    expect(folds.every((d) => !(d as HTMLDetailsElement).open)).toBe(true)
    expect(a.container.querySelectorAll('.ch07-fold .c-steps-result').length).toBeGreaterThanOrEqual(4)
    expect(a.container.querySelector('[id="formula-F-07.2"]')).not.toBeNull()
    expect(a.container.querySelector('[id="formula-F-07.13"]')).not.toBeNull()
    // Engineer 以上才顯示的內容不在 Beginner 出現
    expect(screen.queryByText(/代入一組寬頻 PLL 的數字/)).toBeNull()
    // 方塊圖幾乎不分模式都顯示（入門模式最需要圖）：只有 Engineer 以上才有的「邊界情況 2：有限 N 的 block」少一張；符號表一樣在章末
    expect(a.container.querySelectorAll('figure.c-mermaid')).toHaveLength(22)
    expect(a.container.querySelector('.ch07')?.lastElementChild?.id).toBe('symbols')
    // R06b：「w 凍結」的前提在 Beginner 也看得到（公式旁的一段話）；兩拍的反例與數字留給 Engineer 以上
    const s4b = a.container.querySelector('#ch07-gradient')?.textContent ?? ''
    expect(s4b).toContain('當成固定不動的常數')
    expect(s4b).toContain('記憶長度內幾乎不變')
    expect(s4b).toMatch(/記憶長度是脈衝響應.*衰減的時間尺度/)
    expect(s4b).not.toContain('兩拍的反例')
    // R03：F-07.11 下面的 D = 0 約定不分模式都顯示
    expect(s4b).toMatch(/沒有另外標.*的 filtered-x 都是/)
    // 帶入手算：beginner／engineer 等級的題目都在；複數運算的 HC-07.7 放在 Engineer 模式以上
    const ids = Array.from(a.container.querySelectorAll('[id^="handcalc-HC-07"]')).map((e) => e.id)
    expect(ids).toEqual(HANDCALCS.filter((h) => h.id !== 'HC-07.7').map((h) => `handcalc-${h.id}`))
    expect(plainMathText(a.container)).toEqual([])
    expect(a.container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
  }, 240000)

  it('Research 模式：推導直接展開、顯示分析細節與 Python golden 對照；沒有拼湊的數學', () => {
    localStorage.setItem('lmspll.mode', 'research')
    const b = renderChapter()
    expect(screen.queryByText('入門模式：先抓住三句話')).toBeNull()
    expect(b.container.querySelectorAll('.ch07-fold').length).toBe(0) // 推導直接展開
    expect(b.container.querySelectorAll('figure.c-mermaid')).toHaveLength(23)
    expect(b.container.querySelector('.ch07')?.lastElementChild?.id).toBe('symbols')
    expect(screen.getByText(/分析細節：經驗相關使用/)).toBeTruthy()
    // research 模式附上 Python golden model 對照（?raw 匯入 golden/lms_pll_golden/polarity.py）
    expect(screen.getByText('golden/lms_pll_golden/polarity.py（§6–§7）')).toBeTruthy()
    expect(screen.queryByText(/程式碼載入錯誤/)).toBeNull()
    expect(b.container.querySelectorAll('[id^="handcalc-HC-07"]').length).toBe(HANDCALCS.length)
    expect(plainMathText(b.container)).toEqual([])
    expect(b.container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
  }, 240000)

  it('沒有用途的捲軸：手機上入門模式的收合框不縮窄推導（和 Engineer 模式同寬）；GMAC 程式碼那一行在桌機放得下', () => {
    // jsdom 不排版，這裡只確認規則還在；實際寬度用 `node scripts/scroll-audit.mjs --routes /ch/07 --mode beginner --viewport mobile` 量
    // （規則拿掉的話，375 px 的手機上有三條公式只比 278 px 的欄位寬 2–5 px，各多一條橫向捲軸）。
    const css = readFileSync(join(process.cwd(), 'src/chapters/ch07/chapter.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const mobile = css.match(/@media \(max-width: 480px\) \{\s*\.ch07-fold > details \{([^}]*)\}\s*\}/)
    expect(mobile).not.toBeNull()
    for (const decl of ['border-left: 0', 'border-right: 0', 'padding-left: 0', 'padding-right: 0']) expect(mobile?.[1], decl).toContain(decl)
    // 桌機與平板仍是完整的虛線框
    expect(css).toMatch(/\.ch07-fold > details \{\s*border: 1px dashed var\(--border-strong\);/)
    // 7.4 節的 GMAC 程式碼：右側留白 8 px（共用預設 12 px 時，桌機上最長的一行只比欄位寬 2 px）
    expect(css).toMatch(/\.ch07-code-fit \.c-code-line \{\s*padding-right: 8px;\s*\}/)
  })
})

describe('Ch07 公式登錄與 presets', () => {
  it('FORMULAS：ID 唯一、格式 F-07.n、頁面 /ch/07、勘誤 id 合法', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of FORMULAS) {
      expect(f.id).toMatch(/^F-07\.\d+$/)
      expect(f.page).toBe('/ch/07')
      expect(f.tex.length).toBeGreaterThan(5)
      if (f.erratumId) expect(['E44', 'E45', 'E46']).toContain(f.erratumId)
      // title／conditions 會經過 mathText 顯示（Formula Reference 的登錄表）：`$` 成對、每個片段 KaTeX 可解析、
      // 純文字部分沒有 Unicode／ASCII 拼湊的數學（docs/teaching-style.md §3）
      for (const text of [f.title, f.conditions]) {
        expect((text.match(/\$/g) ?? []).length % 2, text).toBe(0)
        for (const m of text.matchAll(/\$([^$]+)\$/g)) {
          const html = renderTex(m[1], false)
          expect(html.includes('katex-error') || html.includes('c-tex-error'), `${f.id}: ${m[1]}`).toBe(false)
        }
        expect(text.replace(/\$[^$]+\$/g, ''), `${f.id}: ${text}`).not.toMatch(PLAIN_MATH)
      }
    }
    // 公式本體（display TeX）也都能解析
    for (const f of FORMULAS) expect(renderTex(f.tex, true).includes('katex-error'), f.id).toBe(false)
    // 至少一半的條件欄含有公式（確認真的轉成 $...$ 了，而不是把數學刪掉）
    expect(FORMULAS.filter((f) => f.conditions.includes('$')).length).toBeGreaterThanOrEqual(FORMULAS.length / 2)
    // 架構約定（docs/assumptions.md §2a）寫在 F-07.1 的條件裡：公式本身不變（e_PD = (a − w)·u + v，正號），e_PD 是 PD 的輸出、
    // comparator 與 loop filter 取同一個節點、DTC 在 reference 輸入端、殘餘誤差從 PD 的 reference 輸入注入
    const f1 = FORMULAS.find((f) => f.id === 'F-07.1')
    expect(f1?.tex).toBe(String.raw`e_{\mathrm{PD}}[n]=(a-w)\,u[n]+v[n],\qquad u[n]=(h*x)[n]`)
    for (const phrase of ['PD 的輸出', 'reference edge 減 feedback edge', 'comparator 與 loop filter 取同一個節點', 'DTC 在 reference 輸入端', '從 PD 的 reference 輸入注入', String.raw`$H_{\mathrm{PD}}=1/(1+L)$ 取正號`]) {
      expect(f1?.conditions, phrase).toContain(phrase)
    }
  })

  it('R06b：F-07.1／F-07.9 是「w 凍結」模型內的等式（exact），條件寫明凍結與 F-06.1 的慢適應前提；F-07.11（approx）也帶著這個前提', () => {
    const f = (id: string) => FORMULAS.find((x) => x.id === id) as (typeof FORMULAS)[number]
    // 公式不變（等號，不是 ≈）；w 凍結時是等式，LMS 更新時是 F-06.1 的近似
    expect(f('F-07.1').claim).toBe('exact')
    expect(f('F-07.1').tex).not.toContain(String.raw`\approx`)
    expect(f('F-07.1').title).toContain('凍結')
    for (const phrase of ['凍結', 'F-06.1', '記憶長度', '時間尺度分離', '只說「block 內 $w$ 固定」還不夠', String.raw`$h*\big((a-w)\,x\big)=(a-w)\,(h*x)$`, 'DTC 在 reference 輸入端']) {
      expect(f('F-07.1').conditions, phrase).toContain(phrase)
    }
    expect(f('F-07.9').claim).toBe('exact')
    expect(f('F-07.9').tex).toBe(String.raw`J(w)=\tfrac12E\big[e_{\mathrm{PD}}^2\big],\qquad \frac{dJ}{dw}=-E\big[e_{\mathrm{PD}}\,u\big]`)
    for (const phrase of ['凍結', 'F-06.1', '時間尺度分離']) expect(f('F-07.9').conditions, phrase).toContain(phrase)
    expect(f('F-07.11').claim).toBe('approx')
    for (const phrase of ['記憶長度', 'F-06.1', String.raw`$|\delta u|\ll\sigma_v$`]) expect(f('F-07.11').conditions, phrase).toContain(phrase)
  })

  it('R06b：7.4 節 Engineer 框裡的數字——Type-II（0.05、0.7、d = 0）的記憶長度約 28 個 sample；慢適應時兩種寫法只差 8e-4，快適應時差到同一個量級（約 0.8）', () => {
    // 誤差路徑：H_PD = ∇²/(∇² + (K_i + K_p∇)z⁻¹)，K_p = 0.07、K_i = 0.0025 ⇒ 分母 1 − 1.9275z⁻¹ + 0.93z⁻²
    const path: FxPathSpec = { kind: 'type2_dt', wnTs: 0.05, zeta: 0.7, loopDelay: 0 }
    const H = pathTransfer(path)
    expect(Array.from(H.b)).toEqual([1, -2, 1])
    expect(H.a).toHaveLength(3)
    expect(H.a[0]).toBe(1)
    expect(H.a[1]).toBeCloseTo(-1.9275, 12)
    expect(H.a[2]).toBeCloseTo(0.93, 12)
    // 共軛複數 pole：半徑的平方 = 分母的常數項 0.93
    expect(H.a[1] * H.a[1] - 4 * H.a[2]).toBeLessThan(0)
    const radius = pathStability(path).radius
    expect(radius).toBeCloseTo(Math.sqrt(0.93), 9) // 0.964
    expect(1 / (1 - radius)).toBeCloseTo(28.06, 2)
    // 先乘後濾（真實電路）對先濾後乘（F-07.1 的寫法）：x = cos(πn/6)、w_k = a(1 − (1 − g)^k)，從 w 第一次更新（k ≥ 1）算起
    const ratio = (N: number, g: number, blocks: number, a = 3): number => {
      const L = N * blocks
      const x = Float64Array.from({ length: L }, (_, n) => Math.cos((Math.PI * n) / 6))
      const coef = Float64Array.from({ length: L }, (_, n) => a * Math.pow(1 - g, Math.floor(n / N))) // a − w_k
      const eTrue = lfilter(H.b, H.a, Float64Array.from(x, (v, n) => coef[n] * v)).y
      const u = lfilter(H.b, H.a, x).y
      let num = 0
      let den = 0
      for (let n = N; n < L; n++) {
        const approx = coef[n] * u[n]
        num += (eTrue[n] - approx) ** 2
        den += approx ** 2
      }
      return Math.sqrt(num / den)
    }
    // 慢：N/g = 40960 個 sample ≫ 28
    const slow = ratio(4096, 0.1, 60)
    expect(slow).toBeGreaterThan(8.0e-4)
    expect(slow).toBeLessThan(8.5e-4)
    // N 越小（適應越快）差越大：每一格都比前一格大
    const byN = [4096, 256, 64, 16, 4, 1].map((N) => ratio(N, 0.1, 60))
    for (let i = 1; i < byN.length; i++) expect(byN[i]).toBeGreaterThan(byN[i - 1])
    expect(byN[5]).toBeCloseTo(0.0963, 3)
    // 快：N/g = 2 個 sample ≪ 28。30 個 block 是 0.772，再長收斂到 0.78——文字寫「約 0.8」
    expect(ratio(1, 0.5, 30)).toBeCloseTo(0.7716, 3)
    for (const blocks of [30, 60, 240]) {
      expect(ratio(1, 0.5, blocks)).toBeGreaterThan(0.75)
      expect(ratio(1, 0.5, blocks)).toBeLessThan(0.8)
    }
    // w 凍結（g = 0）：兩種寫法逐點相同（F-07.1 是等式）
    expect(ratio(64, 0, 8)).toBeLessThan(1e-12)
  })

  it('R03：F-07.10–F-07.13 帶著 regressor 的額外延遲 D——公式用 C_{f,D}，條件欄都寫出 D = 0 的情形；claim 不變', () => {
    const f = (id: string) => FORMULAS.find((x) => x.id === id) as (typeof FORMULAS)[number]
    expect(f('F-07.10').tex).toContain('u_f[n-D]')
    expect(f('F-07.11').tex).toContain('C_{f,D}')
    expect(f('F-07.11').tex).toContain('u_f[n-D]')
    expect(f('F-07.11').tex).toContain(String.raw`\overset{D=0}{=}E[u\,u_f]`)
    expect(f('F-07.12').tex).toContain('C_{f,D}')
    expect(f('F-07.12').tex).toContain(String.raw`\angle H-\angle\hat H+\Omega D`)
    expect(f('F-07.12').tex).toContain(String.raw`\overset{\hat H=H,\ D=0}{=}`)
    // 舊式（沒有 D、只寫 Ĥ = H 就保證 E[u²]）不再出現
    expect(f('F-07.12').tex).not.toContain(String.raw`\overset{\hat H=H}{=}`)
    expect(f('F-07.11').tex).not.toContain(String.raw`p_f=1-\mu K_q\,E[u\,u_f]`)
    for (const id of ['F-07.10', 'F-07.11', 'F-07.12', 'F-07.13']) expect(f(id).conditions, id).toContain('D=0')
    expect(['F-07.10', 'F-07.11', 'F-07.12', 'F-07.13'].map((id) => f(id).claim)).toEqual(['exact', 'approx', 'exact', 'exact'])
    expect(f('F-07.12').title).toContain('額外延遲')
    expect(f('F-07.12').conditions).toContain(String.raw`$C_{f,D}=R_u[D]$`)
    expect(f('F-07.12').conditions).toContain('充分條件（非必要）')
    expect(f('F-07.13').conditions).toContain(String.raw`$\hat H\propto H$`)
  })

  it('所有 delay-fx-lab presets 都能解析；Gallery #4 唯一且指向本章', () => {
    const list = presetsForExperiment(EXPERIMENT_ID)
    expect(list.length).toBeGreaterThanOrEqual(6)
    for (const p of list) {
      expect(p.page).toBe('/ch/07')
      expect(parseLabPreset(p.params)).not.toBeNull()
    }
    const g4 = presetById('delay-phi-m120-d4')
    expect(g4?.galleryIndex).toBe(4)
    expect(g4?.tests).toContain('T07')
  })

  it('blocksToConverge：取預測收斂的 Case 中最大的 τ × 12；全部不收斂回傳 null；超過上限 4000 時截斷並標記', () => {
    const mk = (g: number, tau: number, stable = true) => ({ analytic: { stableMean: stable, g, tauBlocks: tau } })
    expect(blocksToConverge([mk(0.08, 12.03), mk(0.0077, 129.48)])).toEqual({ blocks: 1554, capped: false })
    expect(blocksToConverge([mk(0.5, 0.5)])).toEqual({ blocks: 10, capped: false })
    expect(blocksToConverge([mk(0.003, 400)])).toEqual({ blocks: 4000, capped: true })
    // C ≤ 0（p > 1，τ = NaN）與 C ≈ 0（g < 1e-3）都不算「會收斂」
    expect(blocksToConverge([mk(-0.04, NaN, false), mk(1e-6, 1e6)])).toBeNull()
    expect(blocksToConverge([])).toBeNull()
  })

  it('parseLabPreset：未知欄位用預設值；不合法的列舉回傳 null（不套用）', () => {
    const ok = parseLabPreset({ scenario: { omega: 0.2, bogus: 1 }, cases: [{ mode: 'delayed', D: 3 }] })
    expect(ok?.scenario.omega).toBe(0.2)
    expect(ok?.scenario.pathKind).toBe(DEFAULT_SCENARIO.pathKind)
    expect(ok?.cases).toHaveLength(1)
    expect(ok?.cases[0].mu).toBe(10)
    expect(parseLabPreset({ scenario: { pathKind: 'ct_hpd' } })).toBeNull()
    expect(parseLabPreset({ cases: [{ mode: 'lms' }] })).toBeNull()
    expect(parseLabPreset(null)).toBeNull()
    expect(parseLabPreset({})?.cases).toHaveLength(DEFAULT_CASES.length)
  })

  it('T07: Gallery #4 preset 的參數重現 T07——C_raw = −0.5、C_4 = +1、θ = 0°（unit power），閉迴路 raw 發散、D = 4 收斂', () => {
    const parsed = parseLabPreset(presetById('delay-phi-m120-d4')?.params)
    expect(parsed).not.toBeNull()
    const { scenario, cases, seed } = parsed as NonNullable<typeof parsed>
    const an = analyzeFxLab({
      path: toPathSpec(scenario),
      code: toCodeSpec(scenario),
      mode: cases[1].mode,
      D: cases[1].D,
      hat: toHatSpec(cases[1]),
      seed: seed ?? 1,
      Dmax: 11,
    })
    expect(an.corr.raw.analytic).toBeCloseTo(-0.5, 12)
    expect(an.corr.delayed.analytic).toBeCloseTo(1, 12)
    expect(an.tone?.thetaDeg).toBeCloseTo(0, 9)
    expect(an.tone?.marginDeg).toBeCloseTo(90, 9)
    expect(an.tone?.best.D).toBe(4)
    const res = runFxComparison({ scenario: toFxScenario(scenario, seed ?? 1), cases: cases.map((c, i) => ({ id: 'ABC'[i], spec: toCaseSpec(c) })) })
    expect(Math.abs(res.cases[0].metrics.wEnd - scenario.a)).toBeGreaterThan(100)
    expect(Math.abs(res.cases[1].metrics.meanW - scenario.a)).toBeLessThan(0.6)
    expect(Math.abs(res.cases[2].metrics.meanW - scenario.a)).toBeLessThan(0.6)
  })

  it('presets 的 expected 文字中的數字由模型重現（seed 20261010）', () => {
    const load = (id: string) => {
      const parsed = parseLabPreset(presetById(id)?.params) as NonNullable<ReturnType<typeof parseLabPreset>>
      const an = (i: number) =>
        analyzeFxLab({
          path: toPathSpec(parsed.scenario),
          code: toCodeSpec(parsed.scenario),
          mode: parsed.cases[i].mode,
          D: parsed.cases[i].D,
          hat: toHatSpec(parsed.cases[i]),
          seed: parsed.seed ?? 1,
          Dmax: parsed.scenario.Dmax,
        })
      return { parsed, an }
    }
    // Type-II 低頻 tone：∠H = 155.378°、|H| = 0.0893、C_raw = −0.0812、D* = 119.04、C_119 = +0.0893、E[u²] = 0.00797
    const t2 = load('delay-type2-low-tone')
    const a0 = t2.an(1)
    expect(a0.tone?.best.D).toBe(119)
    expect(a0.tone?.best.continuous).toBeCloseTo(119.04, 2)
    expect(a0.corr.raw.analytic as number).toBeCloseTo(-0.0812, 4)
    expect(a0.corr.delayed.analytic as number).toBeCloseTo(0.0893, 4)
    expect(a0.Eu2.analytic as number).toBeCloseTo(0.00797, 5)
    // 二次差分（低頻 tone）：相位差 −22.9°、E[u·u_f] = 0.00740、ρ = 0.921
    const sd = load('filtered-x-second-diff').an(1)
    expect(sd.tone?.thetaDeg).toBeCloseTo(-22.9, 1)
    expect(sd.corr.filtered.analytic as number).toBeCloseTo(0.0074, 4)
    expect(sd.rhoActive).toBeCloseTo(0.921, 2)
    // 二次差分在中頻 tone：∠H = 16.3°、相位差 −133.7°、E[u·u_f] = −19.9、E[u²] = 1.156
    const hf = load('filtered-x-second-diff-hf-fail').an(1)
    expect(hf.tone?.thetaDeg).toBeCloseTo(-133.7, 1)
    expect(hf.corr.filtered.analytic as number).toBeCloseTo(-19.9, 1)
    expect(hf.Eu2.analytic as number).toBeCloseTo(1.156, 3)
    // Type-II 模型誤差（AR(1) ρ = 0.98、d = 1）：E[u²] = 0.1895、頻寬 +50% → 0.148、漏算 latency → 0.168、raw C = 0.0315
    const me = load('filtered-x-type2-model-error')
    expect(me.an(0).Eu2.analytic as number).toBeCloseTo(0.1895, 4)
    expect(me.an(1).corr.filtered.analytic as number).toBeCloseTo(0.148, 3)
    expect(me.an(2).corr.filtered.analytic as number).toBeCloseTo(0.168, 3)
    expect(me.an(0).corr.raw.analytic as number).toBeCloseTo(0.0315, 4)
    // MASH：raw ≈ +0.98、D = 4 ≈ 0、filtered ≈ +0.97（經驗值）
    const mash = load('filtered-x-mash-fcw')
    expect(mash.an(0).corr.raw.empirical).toBeCloseTo(0.98, 1)
    expect(Math.abs(mash.an(1).corr.delayed.empirical)).toBeLessThan(0.02)
    expect(mash.an(2).corr.filtered.empirical).toBeCloseTo(0.97, 1)
  })

  it('T07: 反面——FCW preset（一階 DSM、寬頻 PLL、d = 2）：frac = 0.05 時 raw-x 發散、D = 12 收斂；換成 frac = 0.3，raw-x 收斂、同一個 D = 12 發散；filtered-x 兩邊都收斂', () => {
    const parsed = parseLabPreset(presetById('filtered-x-fcw-first-order-dsm')?.params) as NonNullable<ReturnType<typeof parseLabPreset>>
    expect(parsed.scenario.codeKind).toBe('dsm1')
    const run = (frac: number) =>
      runFxComparison({
        scenario: toFxScenario({ ...parsed.scenario, frac }, parsed.seed ?? 1),
        cases: parsed.cases.map((c, i) => ({ id: 'ABC'[i], spec: toCaseSpec(c) })),
      })
    // preset 的 expected 文字：C ≈ −0.13／+1.36／3.46，w_end ≈ +199 fs
    const lo = run(0.05)
    expect(lo.cases[0].analytic.Cest).toBeCloseTo(-0.13, 2)
    expect(lo.cases[1].analytic.Cest).toBeCloseTo(1.36, 1)
    expect(lo.cases[2].analytic.Cest).toBeCloseTo(3.46, 1)
    expect(lo.cases[0].metrics.wEnd).toBeCloseTo(199, -1)
    expect(lo.cases.map((c) => closedLoopConsistent(c, 3, 0).status)).toEqual(['ok', 'ok', 'ok'])
    expect(Math.abs(lo.cases[1].metrics.meanW - 3)).toBeLessThan(0.5)
    expect(Math.abs(lo.cases[2].metrics.meanW - 3)).toBeLessThan(0.5)
    // 換 channel：同一個 D 由收斂變發散，raw-x 由發散變收斂
    const hi = run(0.3)
    expect(hi.cases[0].analytic.Cest).toBeCloseTo(0.99, 1)
    expect(hi.cases[1].analytic.Cest).toBeCloseTo(-0.18, 2)
    expect(Math.abs(hi.cases[1].metrics.wEnd - 3)).toBeGreaterThan(100)
    expect(Math.abs(hi.cases[0].metrics.meanW - 3)).toBeLessThan(0.5)
    expect(Math.abs(hi.cases[2].metrics.meanW - 3)).toBeLessThan(0.5)
    // near-integer：raw-x 的 ρ ≈ 0.02、τ ≈ 295 blocks（交叉比對誠實標成 n/a）；filtered-x 仍收斂
    const ni = run(0.01)
    expect(ni.cases[0].analytic.tauBlocks).toBeGreaterThan(200)
    expect(closedLoopConsistent(ni.cases[0], 3, 0).status).toBe('n/a')
    expect(closedLoopConsistent(ni.cases[2], 3, 0).status).toBe('ok')
    const an = analyzeFxLab({
      path: toPathSpec({ ...parsed.scenario, frac: 0.01 }),
      code: toCodeSpec({ ...parsed.scenario, frac: 0.01 }),
      mode: 'raw',
      D: 0,
      hat: toHatSpec(parsed.cases[0]),
      seed: parsed.seed ?? 1,
      Dmax: parsed.scenario.Dmax,
    })
    expect(an.corr.raw.analytic).toBeNull() // DSM code：只有經驗值
    expect(Math.abs(an.rhoActive)).toBeLessThan(0.05)
  })

  it('波形疊圖只在 |Ĥ| 與 |H| 差很多時縮放 u_f（二次差分 ≈ 1/27），Ĥ = H 時不縮放', () => {
    const parsed = parseLabPreset(presetById('filtered-x-second-diff-hf-fail')?.params) as NonNullable<ReturnType<typeof parseLabPreset>>
    const mk = (i: number) =>
      analyzeFxLab({
        path: toPathSpec(parsed.scenario),
        code: toCodeSpec(parsed.scenario),
        mode: parsed.cases[i].mode,
        D: parsed.cases[i].D,
        hat: toHatSpec(parsed.cases[i]),
        seed: 1,
        Dmax: 8,
      })
    const k = ufDisplayScale(mk(1))
    expect(k).toBeGreaterThan(0.02)
    expect(k).toBeLessThan(1 / 3)
    expect(ufDisplayScale(mk(2))).toBe(1)
  })

  it('反面 presets：code 錯位 D = 4 發散、D = 3 無恢復力；Ĥ 多算 4 sample 的 filtered-x 發散；二次差分在高頻失效', () => {
    const run = (id: string) => {
      const parsed = parseLabPreset(presetById(id)?.params) as NonNullable<ReturnType<typeof parseLabPreset>>
      return runFxComparison({
        scenario: toFxScenario(parsed.scenario, parsed.seed ?? 1),
        cases: parsed.cases.map((c, i) => ({ id: 'ABC'[i], spec: toCaseSpec(c) })),
      })
    }
    const mis = run('delay-code-misalignment')
    expect(mis.cases[1].analytic.Cest).toBeCloseTo(-0.5, 2)
    expect(mis.cases[1].analytic.p).toBeGreaterThan(1)
    expect(Math.abs(mis.cases[2].analytic.Cest)).toBeLessThan(1e-3)
    const lat = run('filtered-x-latency-mismatch')
    expect(lat.cases[2].analytic.Cest).toBeCloseTo(-0.5, 2)
    expect(Math.abs(lat.cases[2].metrics.wEnd - 3)).toBeGreaterThan(100)
    const sd = run('filtered-x-second-diff-hf-fail')
    expect(sd.cases[0].analytic.Cest).toBeGreaterThan(0)
    expect(sd.cases[1].analytic.Cest).toBeLessThan(0)
    expect(sd.cases[2].analytic.Cest).toBeGreaterThan(0)
    // 二次差分 + 寬頻低通 code（F-07.16）：A 收斂、B 沒有恢復力（n/a 而非 ok）、C 方向對但很慢
    const wb = run('filtered-x-second-diff-wideband-fail')
    expect(closedLoopConsistent(wb.cases[0], 3, 0).status).toBe('ok')
    expect(Math.abs(wb.cases[1].analytic.g)).toBeLessThan(1e-3)
    expect(closedLoopConsistent(wb.cases[1], 3, 0).status).toBe('n/a')
    expect(wb.cases[2].analytic.Cest).toBeGreaterThan(0)
    const parsed = parseLabPreset(presetById('filtered-x-second-diff-wideband-fail')?.params) as NonNullable<ReturnType<typeof parseLabPreset>>
    const anB = analyzeFxLab({
      path: toPathSpec(parsed.scenario),
      code: toCodeSpec(parsed.scenario),
      mode: parsed.cases[1].mode,
      D: 0,
      hat: toHatSpec(parsed.cases[1]),
      seed: parsed.seed ?? 1,
      Dmax: 8,
    })
    expect(anB.warnings.some((w) => w.startsWith('C ≈ 0') && w.includes('正負票'))).toBe(true)
  })
})
