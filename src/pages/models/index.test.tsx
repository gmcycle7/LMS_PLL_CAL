import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { MathText, extractRegion } from '@/components'
import blockLmsSrc from '@/simulation/models/blockLms.ts?raw'
import dsmSrc from '@/simulation/models/dsm.ts?raw'
import dtcSrc from '@/simulation/models/dtc.ts?raw'
import pllSrc from '@/simulation/models/pll.ts?raw'
import fftSrc from './experiments/fftPitfalls.ts?raw'
import jsonLabSrc from './experiments/jsonLabModel.ts?raw'
import { UNICODE_MATH } from './experiments/modelText'
import { MODEL_CHARTS } from './diagrams'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import ModelsPage from './index'
import { STATEMENTS } from './sections/S9Statements'
import { MODEL_SYMBOLS } from './symbols'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))
vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })), parse: vi.fn(async () => true) },
}))

function renderPage(url = '/models', mode: 'beginner' | 'engineer' | 'research' = 'engineer') {
  try {
    localStorage.setItem('lmspll.mode', mode)
  } catch {
    /* ignore */
  }
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <ModelsPage />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

// 整頁 DOM 很大（KaTeX）：jsdom 的 getByRole / getByLabelText 會掃描整份文件而非常慢，這裡一律用 querySelector。
const lab = (c: HTMLElement) => c.querySelector('[data-experiment="block-lms-json"]') as HTMLElement
const jsonArea = (c: HTMLElement) => lab(c).querySelector('textarea.models-json-text') as HTMLTextAreaElement
const buttonByText = (root: HTMLElement, text: string) => Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === text) as HTMLButtonElement

/** 看得到的文字：拿掉 KaTeX 的 MathML（含 TeX 原始碼的 annotation），留下 HTML 那一份 */
function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.katex-mathml').forEach((e) => e.remove())
  return clone.textContent ?? ''
}
/** 公式以外的文字：把整個 KaTeX 節點拿掉（檢查有沒有殘留「用 Unicode 拼的公式」） */
function nonMathText(el: Element): string {
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.katex').forEach((e) => e.remove())
  return clone.textContent ?? ''
}
/** 元素內所有行內公式的 TeX 原始碼 */
const texSources = (el: Element): string[] => Array.from(el.querySelectorAll('annotation')).map((a) => a.textContent ?? '')

const PAGE_DIR = resolve(process.cwd(), 'src/pages/models')
/** src/data/presets 內所有 preset 的 id（檢查頁內的「重現」連結） */
const presetIds = new Set(readdirSync(resolve(process.cwd(), 'src/data/presets')).filter((f) => f.endsWith('.json')).map((f) => (JSON.parse(readFileSync(resolve(process.cwd(), 'src/data/presets', f), 'utf8')) as { id: string }).id))
function sourceFiles(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  for (const dir of ['', 'sections', 'experiments']) {
    for (const f of readdirSync(resolve(PAGE_DIR, dir))) {
      if (!/\.tsx?$/.test(f) || /\.test\.tsx?$/.test(f)) continue
      out.push({ file: `${dir}/${f}`, text: readFileSync(resolve(PAGE_DIR, dir, f), 'utf8') })
    }
  }
  return out
}

describe('core region 標記（只加註解，不改程式）', () => {
  it('blockLms / pll / dsm / dtc 的 region 都擷取得到，內容是實際執行的程式行', () => {
    expect(extractRegion(blockLmsSrc, 'blockLmsInnerLoop')).toContain('acc += q * xrn')
    expect(extractRegion(blockLmsSrc, 'blockLmsGmacUpdate')).toMatch(/^const Gk = avg \? acc \/ N : acc/)
    expect(extractRegion(blockLmsSrc, 'blockLmsGainRegister')).toContain('const physOf')
    expect(extractRegion(blockLmsSrc, 'blockLmsBlockSetup')).toContain('const wApp = wPhys[k - dUp >= 0 ? k - dUp : 0]')
    const outer = extractRegion(blockLmsSrc, 'blockLmsBlockLoop')
    expect(outer).toContain('for (let k = 0; k < K; k++) {')
    expect(outer).not.toContain('#region')
    expect(extractRegion(blockLmsSrc, 'roundWith')).toContain('function roundWith')
    expect(extractRegion(blockLmsSrc, 'blockLmsAnalyticGain')).toContain('const gCritical = 2 * Math.sin(Math.PI / (4 * dUp + 2))')
    expect(extractRegion(pllSrc, 'designDtLoop')).toContain('numL[d + 1] = Kp + Ki')
    const dsm = extractRegion(dsmSrc, 'dsmStep').split('\n')
    expect(dsm[32]).toContain('this.rInt += M * y - inp') // S4 的 highlight 行 33
    expect(dsm[35]).toContain('this.residue = this.rInt / M') // highlight 行 36
    expect(extractRegion(dsmSrc, 'dsmResidue')).toContain('this.residue = this.rInt / M')
    expect(extractRegion(dtcSrc, 'dtcQuantize')).toContain('export function quantizeDtcCode')
    expect(extractRegion(dtcSrc, 'dtcMapping')).toContain('export function dtcDelayFs')
    // 本頁自己的模型檔（§7.1、§8 的 CodeBlock）：也是實際執行的函式
    expect(extractRegion(jsonLabSrc, 'ar1StandardError')).toContain('export function ar1SeMean')
    expect(extractRegion(jsonLabSrc, 'ar1StandardError')).toContain('export function ar1EffectiveSamples')
    expect(extractRegion(fftSrc, 'fftHandFormulas')).toContain('export function noiseFloorPerBinDbc')
    expect(extractRegion(fftSrc, 'fftHandFormulas')).toContain('export function dbPowerSum')
    const inner = extractRegion(blockLmsSrc, 'blockLmsInnerLoop').split('\n')
    // S3 CodeCompare 的 highlight 行（1-based）：4 dt、6 u、7 e、13 q、15 acc
    expect(inner[3]).toContain('let dt = coef * x')
    expect(inner[5]).toContain('pathF.step(dt)')
    expect(inner[6]).toContain('const e = u + bOff')
    expect(inner[12]).toContain('else q = e >= 0 ? 1 : qLo')
    expect(inner[14]).toContain('acc += q * xrn')
  })

  it('region 標記行只有註解：四個共用模型檔的 #region / #endregion 成對，且標記行沒有程式碼', () => {
    for (const [name, src] of [
      ['blockLms.ts', blockLmsSrc],
      ['pll.ts', pllSrc],
      ['dsm.ts', dsmSrc],
      ['dtc.ts', dtcSrc],
    ] as const) {
      const lines = src.split('\n').filter((l) => /#(end)?region/.test(l))
      const opens = lines.filter((l) => /#region/.test(l))
      const closes = lines.filter((l) => /#endregion/.test(l))
      expect(opens.length, name).toBeGreaterThan(0)
      expect(opens.length, name).toBe(closes.length)
      for (const l of lines) expect(l.trim(), `${name}: ${l}`).toMatch(/^\/\/ #(region core:[\w.-]+|endregion)$/)
    }
  })
})

describe('頁面原始碼的 LaTeX 規範（docs/teaching-style.md §3）', () => {
  const files = sourceFiles()

  it('JSX 屬性字串裡的 TeX 用單一反斜線（attr="…" 不做跳脫，\\\\sigma 會變成換行 + sigma）', () => {
    const bad: string[] = []
    for (const { file, text } of files) {
      if (!file.endsWith('.tsx')) continue
      text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/\s[\w-]+="([^"\n]*)"/g)) if (m[1].includes('\\\\')) bad.push(`${file}:${i + 1}`)
      })
    }
    expect(bad).toEqual([])
  })

  it('一般字串（非 String.raw、非 JSX 屬性）裡的 TeX 指令必須寫成雙反斜線，否則反斜線會被 JS 吃掉', () => {
    const bad: string[] = []
    for (const { file, text } of files) {
      // 跨多行的 String.raw 樣板字串（diagrams.ts 的方塊圖原始碼）：整段都是 raw，單一反斜線是對的
      let inRaw = false
      text.split('\n').forEach((line, i) => {
        const ticks = (line.match(/(?<!\\)`/g) ?? []).length
        if (inRaw) {
          if (ticks % 2 === 1) inRaw = false
          return
        }
        if (line.includes('String.raw')) {
          if (ticks % 2 === 1) inRaw = true
          return
        }
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        // 先拿掉 JSX 屬性字串（單反斜線是對的）與樣板字串的 ${…} 插值（避免 $${x} 被當成一對 $）
        const stripped = line.replace(/\s[\w-]+="[^"\n]*"/g, ' ').replace(/\$\{[^}]*\}/g, '0')
        // '$...\cmd...$' 或 `$...\cmd...$`：$ 內出現單一反斜線接字母
        for (const m of stripped.matchAll(/\$[^$'`\n]*\$/g)) if (/(^|[^\\])\\[a-zA-Z,;!]/.test(m[0])) bad.push(`${file}:${i + 1}: ${m[0]}`)
      })
    }
    expect(bad).toEqual([])
  })

  it('字串中的 $ 成對（符號表、語句測驗、公式登錄的標題不含未關閉的行內公式）', () => {
    const count = (t: string) => (t.match(/(?<!\\)\$/g) ?? []).length
    for (const s of STATEMENTS) expect(count(s.text) % 2, s.id).toBe(0)
    for (const f of FORMULAS) {
      expect(count(f.title) % 2, f.id).toBe(0)
      expect(count(f.conditions) % 2, f.id).toBe(0)
    }
    expect(new Set(MODEL_SYMBOLS.map((s) => s.symbol)).size).toBe(MODEL_SYMBOLS.length)
    expect(new Set(STATEMENTS.map((s) => s.id)).size).toBe(STATEMENTS.length)
    expect(new Set(FORMULAS.map((f) => f.id)).size).toBe(FORMULAS.length)
  })
})

/** registry.ts 登錄的路由（讀檔，不載入其他頁面的模組） */
const ROUTES = new Set(Array.from(readFileSync(resolve(process.cwd(), 'src/app/registry.ts'), 'utf8').matchAll(/path: '([^']+)'/g)).map((m) => m[1]))

describe('公式登錄（Formula & Unit Reference 頁以 mathText 顯示 title / conditions）', () => {
  it('17 條公式的標題與使用條件：數學都在 `$...$` 內、KaTeX 可以渲染、沒有用 Unicode 拼的公式', () => {
    expect(FORMULAS.map((f) => f.id)).toEqual([...Array.from({ length: 12 }, (_, i) => `F-15.${i + 1}`), ...Array.from({ length: 5 }, (_, i) => `F-16.${i + 1}`)])
    const { container } = render(
      <ul>
        {FORMULAS.map((f) => (
          <li key={f.id} data-formula={f.id}>
            <MathText>{f.title}</MathText>
            <MathText>{f.conditions}</MathText>
          </li>
        ))}
      </ul>,
    )
    expect(container.querySelector('.katex-error, .c-tex-error')).toBeNull()
    for (const li of Array.from(container.querySelectorAll('li'))) {
      const rest = nonMathText(li)
      expect(rest, li.getAttribute('data-formula') ?? '').not.toContain('$')
      expect(UNICODE_MATH.test(rest), `${li.getAttribute('data-formula')}: ${rest}`).toBe(false)
    }
    for (const f of FORMULAS) expect(f.page).toBe('/models')
  })
})

describe('Models 頁面（jsdom smoke）', () => {
  it('T13: 整頁可渲染：章節、符號表、公式錨點、勘誤連結、程式碼區塊，JSON Lab 跑完並顯示指標', async () => {
    // console.error：React 的 key／DOM 巢狀／未知屬性警告與 KaTeX 錯誤都會走這裡。
    // 只排除測試環境特有的「not wrapped in act(...)」（Plot、Mermaid 的非同步載入），其餘一律視為錯誤。
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const msg = args.map(String).join(' ')
      if (!/not wrapped in act\(/.test(msg)) errors.push(msg.slice(0, 300))
    })
    const { container } = renderPage()
    const h2 = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent ?? '')
    for (const re of [/這次我們要回答的問題/, /模型層級 L0–L6/, /參考 Block Sign-LMS/, /L2 的三塊積木/, /§15.3 參數 JSON/, /Block Sign-LMS JSON Lab/, /§15.4 標準輸出/, /一條 FFT 曲線不能證明/, /12 項硬體細節/, /何時可以宣稱穩定/, /思考題與本頁必記/]) {
      expect(h2.some((t) => re.test(t)), String(re)).toBe(true)
    }
    expect(container.querySelector('.c-symbols')).toBeTruthy()
    for (const f of FORMULAS) expect(container.querySelector(`[id="formula-${f.id}"]`), f.id).toBeTruthy()
    // 符號表放在頁末（docs/teaching-style.md §5）：全頁只有一張，包在 id="symbols" 裡，是頁面的最後一個區塊（在 §11「本頁必記」之後）
    const precedes = (x: Element | null, y: Element | null) => !!x && !!y && !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING)
    const symbols = container.querySelector('#symbols') as HTMLElement
    expect(symbols).toBeTruthy()
    expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
    expect(symbols.querySelectorAll('.c-symbols tbody tr').length).toBe(MODEL_SYMBOLS.length)
    expect(container.querySelector('.models-page')?.lastElementChild).toBe(symbols)
    expect(symbols.lastElementChild?.classList.contains('c-symbols')).toBe(true)
    expect(precedes(container.querySelector('#models-s11'), symbols)).toBe(true)
    expect(precedes(container.querySelector('.c-recap'), symbols)).toBe(true)
    expect(symbols.querySelector('h2')?.textContent).toBe('本頁符號表')
    expect(container.querySelector('section[aria-labelledby="models-s1"] .c-symbols')).toBeNull()
    // 頁首只留一行「本頁符號表在最後 ↓」：是按鈕（HashRouter 下 href="#symbols" 會被當成路由），而且在第 1 節之前
    const jump = container.querySelector('.models-symbols-jump button') as HTMLButtonElement
    expect(jump.textContent).toBe('本頁符號表在最後 ↓')
    expect(container.querySelectorAll('.models-symbols-jump')).toHaveLength(1)
    expect(jump.closest('a')).toBeNull()
    expect(container.querySelector('a[href*="#symbols"]')).toBeNull()
    expect(precedes(jump, container.querySelector('#models-s1'))).toBe(true)
    const down = vi.fn()
    const up = vi.fn()
    symbols.scrollIntoView = down
    ;(container.querySelector('#models-top') as HTMLElement).scrollIntoView = up
    fireEvent.click(jump)
    expect(down).toHaveBeenCalledTimes(1)
    fireEvent.click(buttonByText(symbols, '↑ 回到頁首'))
    expect(up).toHaveBeenCalledTimes(1)
    // 方塊圖（docs/teaching-style.md §8）：三張圖各一次、依 MODEL_CHARTS 的順序；圖說是純文字（不用 Unicode 拼數學）；
    // 每張都有「先看…／圖上…」的導讀（含 KaTeX），並放在對應的表格、程式碼與推導之前
    const figs = Array.from(container.querySelectorAll('figure.c-mermaid')) as HTMLElement[]
    expect(figs).toHaveLength(MODEL_CHARTS.length)
    for (const f of figs) {
      const cap = f.querySelector('figcaption')?.textContent ?? ''
      expect(cap.length, cap).toBeGreaterThan(20)
      expect(UNICODE_MATH.test(cap), cap).toBe(false)
      expect(cap).not.toContain('$')
      const walk = f.closest('.models-diagram')?.querySelector('.models-diagram-walk')
      expect(walk?.textContent, cap).toContain('先看')
      expect(walk?.textContent, cap).toContain('圖上')
      expect(walk?.querySelector('.katex'), cap).toBeTruthy()
    }
    const [figLevels, figLoop, figPath] = figs
    expect(figLevels.getAttribute('aria-label')).toContain('模型層級')
    expect(figLoop.getAttribute('aria-label')).toContain('兩層迴圈')
    expect(figPath.getAttribute('aria-label')).toContain('GMAC datapath')
    const sec = (n: number) => container.querySelector(`section[aria-labelledby="models-s${n}"]`) as HTMLElement
    expect(figLevels.closest('section[aria-labelledby="models-s2"]')).toBeTruthy()
    expect(precedes(figLevels, sec(2).querySelector('table.models-levels'))).toBe(true)
    expect(figLoop.closest('section[aria-labelledby="models-s3"]')).toBeTruthy()
    expect(precedes(figLoop, sec(3).querySelector('.c-code, figure.c-code-block, pre'))).toBe(true)
    expect(precedes(figLoop, container.querySelector('[id="formula-F-15.1"]'))).toBe(true)
    expect(figPath.closest('section[aria-labelledby="models-s9"]')).toBeTruthy()
    expect(precedes(figPath, sec(9).querySelector('.models-checks'))).toBe(true)
    expect(precedes(figPath, container.querySelector('[id="formula-F-16.1"]'))).toBe(true)
    const errata = Array.from(container.querySelectorAll('.models-erratum a'))
    expect(errata.every((a) => a.getAttribute('href') === '#/verification')).toBe(true)
    const ids = new Set(errata.map((a) => a.textContent))
    for (const id of ['E07', 'E13', 'E18', 'E30', 'E34', 'E36', 'E44', 'E06', 'E03']) expect(ids.has(`勘誤 ${id}`), id).toBe(true)
    const text = container.textContent ?? ''
    expect(text).not.toContain('程式碼載入錯誤')
    expect(text).not.toContain('ParseError') // KaTeX 語法錯誤
    expect(container.querySelector('.katex-error, .c-tex-error')).toBeNull()
    expect(text).toContain('acc += q * xrn')
    expect(text).toContain('numL[d + 1] = Kp + Ki')
    expect(text).toContain('this.rInt += M * y - inp')
    expect(text).toContain('export function ar1SeMean') // §7.1 的 CodeBlock
    expect(text).toContain('export function noiseFloorPerBinDbc') // §8 的 CodeBlock
    // 12 項硬體檢查卡片、§16.2 的 7 列、§15.1 的 7 個層級
    expect(container.querySelectorAll('.models-check').length).toBe(12)
    expect(text).toContain('Sign-off Matrix（§16.2）')
    expect(container.querySelectorAll('.models-levels tbody tr').length).toBe(7)
    // 三個實驗外框
    for (const id of ['block-lms-json', 'fft-spur-pitfalls', 'gmac-datapath-sizing']) expect(container.querySelector(`[data-experiment="${id}"]`), id).toBeTruthy()
    // 帶入手算：本頁的每一題都真的用 <HandCalc> 渲染在頁面上（各一次），並有逐步的帶入過程；
    // 已經在別章出過題的公式只放「換你算」的指路，連到存在的章節
    for (const h of HANDCALCS) {
      const el = container.querySelector(`[id="handcalc-${h.id}"]`)
      expect(el, h.id).toBeTruthy()
      expect(el?.closest('[data-handcalc]')?.getAttribute('data-handcalc'), h.id).toBe(h.id)
      expect(el?.querySelectorAll('.c-step').length, h.id).toBe(h.solve(Object.fromEntries(h.inputs.map((i) => [i.key, i.default]))).steps.length)
    }
    expect(container.querySelectorAll('.c-handcalc').length).toBe(HANDCALCS.length)
    const pointers = Array.from(container.querySelectorAll('[data-handcalc-pointer]'))
    expect(pointers.length).toBe(6)
    for (const p of pointers) {
      const hrefs = Array.from(p.querySelectorAll('a')).map((a) => a.getAttribute('href'))
      expect(hrefs.length).toBeGreaterThan(0)
      for (const href of hrefs) expect(href).toMatch(/^\/ch\/(04|06|08|12)$/)
    }
    // 頁內連結都指向存在的路由（HashRouter 路徑；registry.ts）；帶 ?preset= 的連結指向存在的 preset
    expect(ROUTES.has('/models') && ROUTES.has('/workbook') && ROUTES.has('/verification')).toBe(true)
    const links = Array.from(container.querySelectorAll('a.models-chlink'))
    expect(links.length).toBeGreaterThan(40)
    for (const a of links) {
      const [path, query] = (a.getAttribute('href') ?? '').split('?')
      expect(ROUTES.has(path), a.getAttribute('href') ?? '').toBe(true)
      if (query) expect(presetIds.has(new URLSearchParams(query).get('preset') ?? ''), query).toBe(true)
    }
    // 表格都包在 .table-wrap 內（手機上可以橫向捲動，不會撐破版面）
    const tables = Array.from(container.querySelectorAll('table'))
    expect(tables.length).toBeGreaterThan(15)
    for (const t of tables) expect(t.closest('.table-wrap'), (t.textContent ?? '').slice(0, 30)).toBeTruthy()
    // JSON Lab 自動在（inline）worker 跑完 §15.3 範例
    const el = lab(container)
    await waitFor(() => expect(el.textContent).toContain('解析區塊'), { timeout: 90000 })
    expect(el.textContent).toContain('後半段 blocks')
    expect(el.textContent).toContain('Mean-field 固定點')
    expect(el.textContent).toContain('0.920212') // p
    expect(el.querySelector('.katex-error, .c-tex-error')).toBeNull()
    // 模型（blockLms.ts）的假設已換成 LaTeX：`$...$` 之外沒有用 Unicode 拼的公式，σ_v 的值還在
    const assumptions = Array.from(el.querySelectorAll('.c-assumption-list li'))
    expect(assumptions.length).toBeGreaterThanOrEqual(12)
    for (const li of assumptions) expect(UNICODE_MATH.test(nonMathText(li)), nonMathText(li)).toBe(false)
    const asmTex = assumptions.flatMap(texSources)
    expect(asmTex).toContain(String.raw`\sigma_v=100\,\mathrm{fs}`)
    expect(asmTex).toContain(String.raw`\delta=a-w`)
    expect(asmTex).toContain(String.raw`G_k=\frac1N\sum q\,x_\mathrm{ref}`)
    expect(assumptions.some((li) => /F-15\.12/.test(li.textContent ?? ''))).toBe(true)
    // 沒有「沒被渲染的 $...$」：程式碼、JSON 文字框與 KaTeX 的 MathML 註解以外不應出現 $
    const clone = container.cloneNode(true) as HTMLElement
    // .c-tip：TestBadge 的 tooltip 逐字列出測試名稱（src/data/verification-status.json），名稱裡可以有字面的 `$...$`；它不是本頁的內文
    clone.querySelectorAll('pre, code, textarea, annotation, .katex-mathml, .c-tip').forEach((e) => e.remove())
    const plain = clone.textContent ?? ''
    const at = plain.indexOf('$')
    expect(at === -1 ? '' : plain.slice(Math.max(0, at - 30), at + 30)).toBe('')
    // 無障礙：每個輸入欄位都有可讀的名稱（<label> 包住、htmlFor 指到、或 aria-label）
    for (const input of Array.from(container.querySelectorAll('input, select, textarea'))) {
      const id = input.getAttribute('id')
      const named = !!input.getAttribute('aria-label') || !!input.getAttribute('aria-labelledby') || !!input.closest('label') || (!!id && !!container.querySelector(`label[for="${id}"]`))
      expect(named, input.outerHTML.slice(0, 120)).toBe(true)
    }
    for (const b of Array.from(container.querySelectorAll('button'))) expect((b.textContent ?? '').trim() !== '' || !!b.getAttribute('aria-label'), b.outerHTML.slice(0, 120)).toBe(true)
    // 每個 <section aria-labelledby> 都指到存在的標題
    for (const sec of Array.from(container.querySelectorAll('section[aria-labelledby], article[aria-labelledby]'))) {
      expect(container.querySelector(`[id="${sec.getAttribute('aria-labelledby')}"]`), sec.getAttribute('aria-labelledby') ?? '').toBeTruthy()
    }
    spy.mockRestore()
    expect(errors).toEqual([])
  }, 120000)

  it('JSON 編輯：改成非法 enum 會顯示繁體中文錯誤；載入 §15.3 範例後恢復合法', async () => {
    const { container } = renderPage()
    const el = lab(container)
    const ta = jsonArea(container)
    expect(ta.value).toContain('"gm_mode": "average"')
    fireEvent.change(ta, { target: { value: ta.value.replace('"gm_mode": "average"', '"gm_mode": "avg"') } })
    await waitFor(() => expect(el.textContent).toContain('JSON 驗證失敗'), { timeout: 60000 })
    expect(el.textContent).toContain("gm_mode：必須為 'average' | 'sum'，收到 'avg'")
    expect(ta.getAttribute('aria-invalid')).toBe('true')
    fireEvent.click(buttonByText(el, '載入 §15.3 範例'))
    await waitFor(() => expect(el.textContent).toContain('✓ 合法'), { timeout: 60000 })
    expect(ta.getAttribute('aria-invalid')).toBeNull()
  }, 120000)

  it('T13: URL preset ?preset=block-lms-json-sum-mode 套用 sum 模式並顯示 N 倍增益警告', async () => {
    const { container } = renderPage('/models?preset=block-lms-json-sum-mode')
    const el = lab(container)
    expect(jsonArea(container).value).toContain('"gm_mode": "sum"')
    // 警告來自 blockLms.ts（Unicode 原文），顯示前逐句換成 `$...$`：看得到的文字與 TeX 原始碼都要對
    await waitFor(() => expect(visibleText(el)).toContain('gm_mode=sum 時有效增益放大 N 倍'), { timeout: 90000 })
    const warnings = Array.from(el.querySelectorAll('.c-exp-warnings .callout'))
    const tex = warnings.flatMap(texSources)
    expect(tex).toContain(String.raw`g=\mu K=326.8`) // g = N·0.079788（golden T13 的反面測試）
    expect(tex).toContain(String.raw`p=-325.8`)
    expect(tex).toContain(String.raw`\mu/N=0.002441`)
    expect(tex).toContain(String.raw`g\ge2`)
    for (const w of warnings) {
      expect(w.querySelector('.katex-error, .c-tex-error')).toBeNull()
      expect(UNICODE_MATH.test(nonMathText(w)), nonMathText(w)).toBe(false) // 沒有殘留的 Unicode 公式
    }
  }, 120000)

  it('§16.3 語句測驗：選 ✅ / ❌ 後顯示對錯與解析，並統計分數', () => {
    const { container } = renderPage('/models', 'beginner')
    const first = container.querySelector('[data-statement="s1"]') as HTMLElement
    fireEvent.click(first.querySelector('[data-answer="ok"]') as HTMLButtonElement)
    expect(first.textContent).toContain('答對了')
    const s4 = container.querySelector('[data-statement="s4"]') as HTMLElement
    fireEvent.click(s4.querySelector('[data-answer="ok"]') as HTMLButtonElement)
    expect(s4.textContent).toContain('再想想')
    expect(s4.textContent).toContain('❌ 不可以宣稱')
    expect(container.querySelector('.models-score')?.textContent).toContain(`已作答 2 / ${STATEMENTS.length}，答對 1`)
    // 規格 §16.3 的 5 句都在，且 3 ✅ / 2 ❌
    const spec = STATEMENTS.filter((s) => s.fromSpec)
    expect(spec.length).toBe(5)
    expect(spec.filter((s) => s.ok).length).toBe(3)
    expect(container.querySelectorAll('[data-statement]').length).toBe(STATEMENTS.length)
  }, 120000)

  it('Research 模式：額外內容（直方圖說明、未建模清單）可渲染，沒有 KaTeX 錯誤', async () => {
    const { container } = renderPage('/models', 'research')
    expect(container.textContent).toContain('Research：本模擬刻意沒有建模的東西')
    expect(container.querySelector('.katex-error, .c-tex-error')).toBeNull()
    const el = lab(container)
    await waitFor(() => expect(el.textContent).toContain('解析區塊'), { timeout: 90000 })
    expect(el.querySelector('.katex-error, .c-tex-error')).toBeNull()
  }, 120000)
})
