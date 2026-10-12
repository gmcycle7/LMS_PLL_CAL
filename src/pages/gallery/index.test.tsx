import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, waitFor } from '@testing-library/react'
import katex from 'katex'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { extractRegion } from '@/components'
import { ALL_PRESETS } from '@/app/presets'
import lmsSrc from '@/simulation/models/lms.ts?raw'
import polaritySrc from '@/simulation/models/polarity.ts?raw'
import stabilitySrc from '@/simulation/models/stability.ts?raw'
import peSrc from '@/simulation/models/pe.ts?raw'
import mimoSrc from '@/simulation/models/mimo.ts?raw'
import previewsSrc from './previews.ts?raw'
import consistencySrc from './consistency.ts?raw'
import formatSrc from './format.ts?raw'
import { filterPresets, EMPTY_FILTERS, PREVIEWABLE_EXPERIMENTS } from './data'
import { FORMULAS } from './formulas'
import GalleryPage from './index'
import { CODE_REGIONS, KEY_LINES, keyLinesOf } from './sections/CodeSection'
import { sameNumber, unifiedRows } from './sections/UnifiedCheck'
import { auditSlots } from './data'
import { PAGES } from '@/app/registry'
import { handRows } from './sections/HowToRead'
import { fieldExample, PRESET_FIELDS } from './sections/Intro'
import { PARAMS_CLAMP_LINES, PARAMS_FULL_LINES, PresetCard } from './sections/PresetCard'
import { toBoardRow } from './sections/RegressionBoard'
import { quiz1Answer, quiz4Answer } from './sections/Wrapup'
import { CHECK_SYMBOLS, MODEL_SYMBOLS } from './symbols'
import { previewPreset } from './previews'

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

type Mode = 'beginner' | 'engineer' | 'research'

function renderPage(url = '/gallery', mode: Mode = 'engineer') {
  try {
    localStorage.setItem('lmspll.mode', mode)
  } catch {
    /* ignore */
  }
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <GalleryPage />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

// 整頁 DOM 很大（KaTeX）：jsdom 的 getByRole / getByLabelText 會掃描整份文件而非常慢，這裡一律用 querySelector。
const WAIT = { timeout: 20000 }
const inspector = (c: HTMLElement) => c.querySelector('[data-experiment="gallery-inspector"]') as HTMLElement | null
const buttonByText = (root: Element, text: string) => Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === text) as HTMLButtonElement | undefined
async function lazyReady(c: HTMLElement) {
  await waitFor(() => {
    expect(inspector(c)).toBeTruthy()
    expect(c.querySelector('.c-code-compare')).toBeTruthy()
  }, WAIT)
}
/** SelectControl 的 option value 是索引：依顯示文字選 */
function pickOption(select: HTMLSelectElement, label: string) {
  const opt = Array.from(select.options).find((o) => (o.textContent ?? '').trim() === label)
  if (!opt) throw new Error(`找不到選項「${label}」（有：${Array.from(select.options).map((o) => o.textContent).join('、')}）`)
  fireEvent.change(select, { target: { value: opt.value } })
}

/** 去掉程式碼區塊後的可見文字（程式碼裡本來就有 $ 與 template literal；TestBadge 提示框列的是別人測試的原始標題，不是 prose） */
function proseText(c: HTMLElement): string {
  const clone = c.cloneNode(true) as HTMLElement
  clone.querySelectorAll('pre, code, .katex, annotation, .c-tip').forEach((n) => n.remove())
  return clone.textContent ?? ''
}

const SOURCES: Record<string, string> = { lms: lmsSrc, polarity: polaritySrc, stability: stabilitySrc, pe: peSrc, mimo: mimoSrc, previews: previewsSrc, consistency: consistencySrc, format: formatSrc }

describe('Gallery 頁面：smoke（三種學習模式）', () => {
  it.each<Mode>(['beginner', 'engineer', 'research'])(
    '%s 模式：整頁渲染不丟錯；12 格、稽核表、公式錨點、lazy 區塊都出現；沒有 KaTeX 錯誤或殘留的 $',
    async (mode) => {
      const { container } = renderPage('/gallery', mode)
      await lazyReady(container)
      // 10 個章節標題
      expect(container.querySelectorAll('h2[id^="gal-s"]').length).toBe(10)
      // §3 稽核表與 §4 的 12 格
      expect(container.querySelectorAll('.gal-audit-table tbody tr[data-status="ok"]').length).toBe(12)
      expect(container.querySelectorAll('section.gal-slot').length).toBe(12)
      expect(container.querySelectorAll('section.gal-slot article.gal-card').length).toBe(12)
      expect(container.querySelectorAll('.gal-unified-table tbody tr').length).toBe(12)
      // §4 的數值驗算表（lazy）：四列，F-GA.4 的值與模型函式的值全部相同
      await waitFor(() => expect(container.querySelectorAll('tr[data-unified-check]').length).toBe(4), WAIT)
      expect(container.querySelectorAll('tr[data-unified-check][data-same="true"]').length).toBe(4)
      // §7 的程式碼比較：每一頁都有被標出的關鍵行（「← 差異」註解或以內容比對找出的行）
      for (const item of Array.from(container.querySelectorAll('.c-code-compare .c-code-compare-item'))) expect(item.querySelectorAll('.c-code-mark').length, item.querySelector('.c-code-compare-label')?.textContent ?? '').toBeGreaterThan(0)
      // 每條登錄的公式在頁面上恰有一個錨點（三種模式皆然）
      for (const f of FORMULAS) expect(container.querySelectorAll(`[id="formula-${f.id}"]`).length, `${f.id}（${mode}）`).toBe(1)
      // KaTeX：沒有錯誤節點；prose 中沒有未渲染的 $…$
      expect(container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
      expect(proseText(container)).not.toMatch(/\$[^$\s][^$]*\$/)
      // 程式碼 region 都找得到（找不到時 CodeBlock 會顯示錯誤框）
      expect(container.textContent).not.toContain('程式碼載入錯誤')
      // 手算表：3 列（n = 0, 1, 2）
      expect(container.querySelectorAll('#gal-s2 ~ .table-wrap').length + container.querySelectorAll('.gal-num-table').length).toBeGreaterThan(0)
      // 研究模式才顯示 preset 的原始 JSON 與 extractNumbers 的程式
      expect(container.querySelectorAll('details.gal-params').length > 0).toBe(mode === 'research')
    },
    60000,
  )

  it('每張必備卡片的「載入並執行」連到 presetHref（HashRouter 路徑 page?preset=id）', async () => {
    const { container } = renderPage()
    for (const p of ALL_PRESETS.filter((x) => x.galleryIndex !== undefined)) {
      const card = container.querySelector(`section.gal-slot article[data-preset="${p.id}"]`)
      expect(card, p.id).toBeTruthy()
      const a = card?.querySelector('a.gal-run') as HTMLAnchorElement
      expect(a.getAttribute('data-href')).toBe(`${p.page}?preset=${encodeURIComponent(p.id)}`)
      expect(a.getAttribute('href')).toBe(`${p.page}?preset=${encodeURIComponent(p.id)}`)
      expect(card?.textContent).toContain(p.expected)
      expect(card?.querySelector('.gal-index')?.textContent).toBe(`#${p.galleryIndex}`)
    }
    await lazyReady(container)
  }, 60000)
})

describe('Gallery 頁面：互動', () => {
  it('卡片的即時預覽：按下後以真實模型函式重算，#1 的 w₁、w₂、pole 都標為與預期文字相符', async () => {
    const { container } = renderPage()
    const card = container.querySelector('section.gal-slot[data-slot="1"] article.gal-card') as HTMLElement
    expect(card.querySelector('.gal-preview')).toBeNull()
    fireEvent.click(buttonByText(card, '即時預覽（真實模型函式）')!)
    await waitFor(() => expect(card.querySelector('.gal-preview[data-experiment="lms-playground"]')).toBeTruthy(), WAIT)
    for (const key of ['w1', 'w2', 'pole']) expect(card.querySelector(`tr[data-key="${key}"]`)?.getAttribute('data-check'), key).toBe('match')
    expect(card.textContent).toContain('與 preset 預期文字一致')
    // 再按一次收起
    fireEvent.click(buttonByText(card, '收起即時預覽')!)
    expect(card.querySelector('.gal-preview')).toBeNull()
    await lazyReady(container)
  }, 60000)

  it('一次重算：12 個必備 preset 全部「與預期文字一致」', async () => {
    const { container } = renderPage()
    expect(container.querySelector('.gal-board-table')).toBeNull()
    fireEvent.click(container.querySelector('[data-action="recompute"]') as HTMLButtonElement)
    await waitFor(() => expect(container.querySelectorAll('.gal-board-table tbody tr[data-status="ok"]').length).toBe(12), WAIT)
    expect(container.querySelectorAll('.gal-board-table tbody tr').length).toBe(12)
    await waitFor(() => expect(container.querySelector('.gal-board')?.textContent).toContain('全部通過'), WAIT)
    await lazyReady(container)
  }, 60000)

  it('Inspector 反面測試：注入 1% 相對誤差 ⇒ 交叉比對變成 Mismatch 並警告；設回 0 還原', async () => {
    const { container } = renderPage()
    await lazyReady(container)
    const box = inspector(container) as HTMLElement
    expect(box.querySelector('.gal-inspector-head')?.getAttribute('data-inspected')).toBe('lms-playground-hand')
    expect(box.querySelector('.c-check-ok')).toBeTruthy()
    expect(box.querySelector('.c-check-mismatch')).toBeNull()
    const eps = box.querySelector('input[aria-label="注入相對誤差 epsilon（百分比）"]') as HTMLInputElement
    fireEvent.change(eps, { target: { value: '1' } })
    await waitFor(() => expect(box.querySelector('.c-check-mismatch')).toBeTruthy(), WAIT)
    expect(box.textContent).toContain('反面測試進行中')
    expect(box.querySelector('tr[data-key="w2"]')?.getAttribute('data-check')).toBe('mismatch')
    fireEvent.change(eps, { target: { value: '0' } })
    await waitFor(() => expect(box.querySelector('.c-check-mismatch')).toBeNull(), WAIT)
    expect(box.querySelector('tr[data-key="w2"]')?.getAttribute('data-check')).toBe('match')
    // 可靠度表（engineer 以上）：三個必備數值各一列
    expect(box.querySelectorAll('.gal-reliability tbody tr').length).toBe(3)
  }, 60000)

  it('網址 ?inspect=<id> 直接打開該 preset；卡片的「在 Inspector 檢視／匯出」也會切換', async () => {
    const { container } = renderPage('/gallery?inspect=noise-t13-example')
    await lazyReady(container)
    const box = inspector(container) as HTMLElement
    expect(box.querySelector('.gal-inspector-head')?.getAttribute('data-inspected')).toBe('noise-t13-example')
    expect(box.querySelector('tr[data-key="sigmaW"]')?.getAttribute('data-check')).toBe('match')
    const card = container.querySelector('section.gal-slot[data-slot="5"] article.gal-card') as HTMLElement
    fireEvent.click(buttonByText(card, '在 Inspector 檢視／匯出')!)
    await waitFor(() => expect((inspector(container) as HTMLElement).querySelector('.gal-inspector-head')?.getAttribute('data-inspected')).toBe('dual-loop-gallery-5'), WAIT)
  }, 60000)

  it('?preset=<id> 是 ?inspect= 的別名（與各章「載入並執行」同一個參數名稱）', async () => {
    const { container } = renderPage('/gallery?preset=pe-rho-099')
    await lazyReady(container)
    const box = inspector(container) as HTMLElement
    expect(box.querySelector('.gal-inspector-head')?.getAttribute('data-inspected')).toBe('pe-rho-099')
    expect(box.querySelector('tr[data-key="k95Slow"]')?.getAttribute('data-check')).toBe('match')
  }, 60000)

  it('不可預覽或不存在的 ?inspect= 值被忽略（回到預設的 #1）', async () => {
    const { container } = renderPage('/gallery?inspect=no-such-preset')
    await lazyReady(container)
    expect((inspector(container) as HTMLElement).querySelector('.gal-inspector-head')?.getAttribute('data-inspected')).toBe('lms-playground-hand')
  }, 60000)

  it('篩選：網址上的 T-id 與頁面條件會套用；下拉選單改變層級後卡片跟著變；清除後回到全部', async () => {
    const previewable = new Set(PREVIEWABLE_EXPERIMENTS)
    const want = filterPresets(ALL_PRESETS, { ...EMPTY_FILTERS, test: 'T13' }, previewable)
    const { container } = renderPage('/gallery?t=T13')
    const s8 = container.querySelector('#gal-s8')?.closest('section') as HTMLElement
    await waitFor(() => expect(s8.querySelector('.gal-count')?.textContent).toContain(`顯示 ${want.length} / ${ALL_PRESETS.length}`), WAIT)
    const shown = Array.from(s8.querySelectorAll('.gal-group article[data-preset]')).map((el) => el.getAttribute('data-preset'))
    expect(shown.sort()).toEqual(want.map((p) => p.id).sort())
    // 再加上模型層級 L5：T13 ∩ L5
    const selects = s8.querySelectorAll('.gal-filters select')
    pickOption(selects[1] as HTMLSelectElement, 'L5')
    const both = filterPresets(ALL_PRESETS, { ...EMPTY_FILTERS, test: 'T13', level: 'L5' }, previewable)
    await waitFor(() => expect(s8.querySelector('.gal-count')?.textContent).toContain(`顯示 ${both.length} / ${ALL_PRESETS.length}`), WAIT)
    // 關鍵字找不到任何 preset ⇒ 顯示空狀態
    const q = s8.querySelector('.gal-search input') as HTMLInputElement
    fireEvent.change(q, { target: { value: '不存在的關鍵字 zzz' } })
    await waitFor(() => expect(s8.querySelector('.gal-empty')).toBeTruthy(), WAIT)
    fireEvent.click(buttonByText(s8, '清除篩選')!)
    await waitFor(() => expect(s8.querySelector('.gal-count')?.textContent).toContain(`顯示 ${ALL_PRESETS.length} / ${ALL_PRESETS.length}`), WAIT)
    await lazyReady(container)
  }, 60000)

  it('沒有篩選時：各組預設收合（不把兩百多張卡片都放進 DOM），依頁面分組且每組數量正確', async () => {
    const { container } = renderPage()
    const s8 = container.querySelector('#gal-s8')?.closest('section') as HTMLElement
    const groups = Array.from(s8.querySelectorAll('details.gal-group'))
    expect(groups[0].getAttribute('data-group')).toBe('required')
    expect((groups[0] as HTMLDetailsElement).open).toBe(false)
    const pages = new Set(ALL_PRESETS.filter((p) => p.galleryIndex === undefined).map((p) => p.page))
    expect(groups.length).toBe(1 + pages.size)
    expect(s8.querySelectorAll('.gal-group article[data-preset]').length).toBeLessThan(ALL_PRESETS.length / 2)
    await lazyReady(container)
  }, 60000)
})

describe('頁面用到的純函式與資料', () => {
  it('§7 的每個 code region 都擷取得到，而且含有實際執行的關鍵行', () => {
    for (const { file, region } of CODE_REGIONS) expect(() => extractRegion(SOURCES[file], region), `${file}:${region}`).not.toThrow()
    expect(extractRegion(lmsSrc, 'fixedXPole')).toContain('return 1 - mu * x * x')
    expect(extractRegion(polaritySrc, 'calPole')).toContain('return 1 - mu * Kq * C')
    expect(extractRegion(stabilitySrc, 'dualLoopCharPoly')).toContain('[1, -(1 + r), r + mu * b * cs]')
    expect(extractRegion(previewsSrc, 'previewPreset')).toContain("return { status: 'unsupported', reason: e.message }")
    expect(extractRegion(consistencySrc, 'checkExpected')).toContain('findExpectedMatch(m.value, nums, k, true)')
    expect(extractRegion(formatSrc, 'findExpectedMatch')).toContain('export function acceptHalfWidth')
    // Gallery 呼叫端的七個 region 各有一行差異標記
    for (const r of ['previewScalarLms', 'previewPolarityTone', 'previewDelayFx', 'previewPm', 'previewDualLoop', 'previewPe', 'previewMimo'])
      expect((extractRegion(previewsSrc, r).match(/← 差異/g) ?? []).length, r).toBe(1)
    expect((extractRegion(consistencySrc, 'checkExpected').match(/← 差異/g) ?? []).length).toBe(2)
  })

  it('沒有「← 差異」註解的 region：關鍵行由內容比對找出（每個都至少找到一行，行號不寫死）', () => {
    for (const k of KEY_LINES) {
      const lines = keyLinesOf(k.file, k.region) ?? []
      expect(lines.length, `${k.file}:${k.region} 找不到要標出的那一行（共用模型檔改寫了？）`).toBeGreaterThan(0)
      const code = extractRegion(SOURCES[k.file], k.region).split('\n')
      for (const n of lines) expect(k.pattern.test(code[n - 1]), `${k.file}:${k.region} 第 ${n} 行`).toBe(true)
    }
    // 已有「← 差異」註解的 region 不必登錄（回傳 undefined，CodeBlock 自動標示）
    expect(keyLinesOf('stability', 'delayStable')).toBeUndefined()
    expect(extractRegion(stabilitySrc, 'delayStable')).toContain('← 差異')
  })

  it('統一觀點的數值驗算（§4）：F-GA.4 代入 #1、#12、#7、#8 的數字，與各章模型函式的值相同', () => {
    const audit = auditSlots(ALL_PRESETS, PAGES.map((p) => p.path))
    const rows = unifiedRows(audit)
    expect(rows.map((r) => r.slot)).toEqual([1, 12, 7, 8])
    for (const r of rows) expect(sameNumber(r.unified, r.model), `#${r.slot}: ${r.unified} vs ${r.model}`).toBe(true)
    const by = (slot: number) => rows.find((r) => r.slot === slot)!
    expect(by(1).unified).toBeCloseTo(0.6 ** 3 * 2, 12) // δ₃ = p³δ₀ = 0.432
    expect(by(12).unified).toBeCloseTo(1.2, 12)
    expect(by(7).unified).toBeCloseTo(-0.34, 12) // δ_∞ = −B/K ⇒ w* = 1.34
    expect(by(8).unified.toFixed(4)).toBe('0.3992')
    // 反面：兩個數差 1e-6 就不算相同；preset 缺少時那一列直接略過（不補數字）
    expect(sameNumber(1, 1 + 1e-6)).toBe(false)
    expect(unifiedRows(audit.filter((a) => a.slot.index !== 7)).map((r) => r.slot)).toEqual([1, 12, 8])
    expect(unifiedRows([])).toEqual([])
  })

  it('region 標記行只有註解：Gallery 自己的三個檔案 #region / #endregion 成對', () => {
    for (const [name, src] of [
      ['previews.ts', previewsSrc],
      ['consistency.ts', consistencySrc],
      ['format.ts', formatSrc],
    ] as const) {
      const open = src.split('\n').filter((l) => /^\s*\/\/ #region core:/.test(l)).length
      const close = src.split('\n').filter((l) => /^\s*\/\/ #endregion\s*$/.test(l)).length
      expect(open, name).toBe(close)
      expect(open, name).toBeGreaterThan(0)
    }
  })

  it('handRows（§2.1 的手算表）：T01 的輸入 ⇒ w 依序 1 → 1.8 → 2.28 → 2.568，每列自洽', () => {
    const { rows, pole, w } = handRows(3, 1, 2, 0.1, 3)
    expect(Array.from(w)).toEqual([1, 1.8, 2.2800000000000002, 2.568])
    expect(pole).toBeCloseTo(0.6, 15)
    for (const r of rows) {
      expect(r.e).toBeCloseTo(r.y - r.pred, 12)
      expect(r.wNext).toBeCloseTo(r.w + r.step, 12)
      expect(r.deltaNext).toBeCloseTo(pole * (3 - r.w), 12)
    }
  })

  it('PRESET_FIELDS 與 PresetEntry 的欄位一致；範例值直接讀 #1 的 JSON', () => {
    const first = ALL_PRESETS.find((p) => p.galleryIndex === 1)
    expect(PRESET_FIELDS.map((f) => f.field).sort()).toEqual(['description', 'expected', 'experiment', 'galleryIndex', 'id', 'page', 'params', 'source', 'tests', 'title'])
    expect(fieldExample(first, 'id')).toBe('"lms-playground-hand"')
    expect(fieldExample(first, 'galleryIndex')).toBe('1')
    expect(fieldExample(undefined, 'id')).toBe('—')
    expect(fieldExample({ ...first!, tests: undefined }, 'tests')).toBe('（省略）')
    expect(fieldExample(first, 'expected', 20).length).toBe(20)
  })

  it('思考題答案由函式算出：0.399 相符、0.40 不相符；慢模式 598 blocks', () => {
    const q1 = quiz1Answer()
    expect([q1.pPrecise, q1.pMatch, q1.cPrecise, q1.cMatch]).toEqual([true, true, false, false])
    const q4 = quiz4Answer()
    expect(q4.pole).toBeCloseTo(0.995, 15)
    expect(q4.blocks).toBe(598)
  })

  it('toBoardRow：ok / unsupported / error 三種結果各自轉成一列', () => {
    const p1 = ALL_PRESETS.find((p) => p.galleryIndex === 1)!
    const ok = toBoardRow(p1, previewPreset(p1))
    expect(ok.status).toBe('ok')
    expect([ok.requiredMatched, ok.requiredTotal]).toEqual([3, 3])
    expect(ok.worst).toBe('ok')
    const p3 = ALL_PRESETS.find((p) => p.galleryIndex === 3)!
    const div = toBoardRow(p3, previewPreset(p3))
    expect(div.status).toBe('ok') // 比對一致
    expect(div.worst).toBe('danger') // 模型判定：極性錯誤——兩件事分開
    expect(toBoardRow(p1, { status: 'unsupported', reason: '不支援' })).toMatchObject({ status: 'unsupported', text: '不支援', requiredTotal: 0 })
    expect(toBoardRow(p1, { status: 'error', message: '壞了' })).toMatchObject({ status: 'error', text: '壞了' })
  })

  it('符號表：符號不重複、TeX 可解析；公式登錄 F-GA.1–4 的頁面是 /gallery', () => {
    const syms = [...CHECK_SYMBOLS, ...MODEL_SYMBOLS].map((s) => s.symbol)
    expect(new Set(syms).size).toBe(syms.length)
    expect(FORMULAS.map((f) => f.id)).toEqual(['F-GA.1', 'F-GA.2', 'F-GA.3', 'F-GA.4'])
    for (const f of FORMULAS) {
      expect(f.page).toBe('/gallery')
      expect(f.title).not.toContain('$')
      expect(f.conditions).not.toContain('$')
      expect(f.conditions.trim().length).toBeGreaterThan(0)
      expect(() => katex.renderToString(f.tex, { displayMode: true, throwOnError: true, strict: 'ignore', trust: false }), f.id).not.toThrow()
    }
    for (const s of [...CHECK_SYMBOLS, ...MODEL_SYMBOLS]) {
      expect(() => katex.renderToString(s.symbol, { throwOnError: true, strict: 'ignore' }), s.symbol).not.toThrow()
      if (s.unit) expect(() => katex.renderToString(s.unit as string, { throwOnError: true, strict: 'ignore' }), s.unit).not.toThrow()
    }
  })
})

describe('沒有用途的捲軸（使用者要求：「這種地方如果沒有用途請幫我拿掉」）', () => {
  const paramLines = (p: (typeof ALL_PRESETS)[number]) => JSON.stringify(p.params, null, 2).split('\n').length

  it('preset 參數 JSON：只有超過 28 行的才限高（框外至少還有 13 行）；較短的整段顯示，不為了幾行放一條直向捲軸', () => {
    try {
      localStorage.setItem('lmspll.mode', 'research')
    } catch {
      /* ignore */
    }
    // 限高時被捲到框外的行數 ≥ PARAMS_FULL_LINES + 1 − PARAMS_CLAMP_LINES = 13 行（約 230px，和看得到的 16 行差不多），不是五、六行
    expect(PARAMS_FULL_LINES).toBe(28)
    expect(PARAMS_FULL_LINES + 1 - PARAMS_CLAMP_LINES).toBeGreaterThanOrEqual(12)
    const sorted = [...ALL_PRESETS].sort((a, b) => paramLines(a) - paramLines(b))
    const short = sorted.filter((p) => paramLines(p) <= PARAMS_FULL_LINES)
    const long = sorted.filter((p) => paramLines(p) > PARAMS_FULL_LINES)
    expect(short.length).toBeGreaterThan(10)
    expect(long.length).toBeGreaterThan(10)
    // 邊界兩側各取一張，再加最短與最長的
    const picks = [short[0], short[short.length - 1], long[0], long[long.length - 1]]
    for (const p of picks) {
      const { container, unmount } = render(
        <SettingsProvider>
          <MemoryRouter initialEntries={['/gallery']}>
            <PresetCard preset={p} />
          </MemoryRouter>
        </SettingsProvider>,
      )
      const pre = container.querySelector('details.gal-params pre') as HTMLElement
      expect(pre, p.id).toBeTruthy()
      expect(pre.textContent, p.id).toBe(JSON.stringify(p.params, null, 2)) // 內容原樣、完整（沒有被截掉）
      expect(pre.classList.contains('is-long'), `${p.id}（${paramLines(p)} 行）`).toBe(paramLines(p) > PARAMS_FULL_LINES)
      unmount()
    }
    // CSS：預設不限高（只留橫向捲動給手機上的長行）；限高只掛在 .is-long，高度與 PARAMS_CLAMP_LINES 同步
    const css = readFileSync(resolve(process.cwd(), 'src/pages/gallery/gallery.css'), 'utf8')
    const base = /\.gal-params pre \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(base).toMatch(/overflow-x:\s*auto/)
    expect(base).toMatch(/line-height:\s*1\.5/)
    // 手機上比框寬的長行折行（內容不變），不為了多出的幾 px 放一條橫向捲軸
    expect(base).toMatch(/white-space:\s*pre-wrap/)
    expect(base).toMatch(/overflow-wrap:\s*anywhere/)
    expect(base).not.toMatch(/max-height|overflow:\s*hidden/)
    const clamp = /\.gal-params pre\.is-long \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(clamp).toContain(`max-height: calc(${PARAMS_CLAMP_LINES} * 1.5em + 16px)`)
    expect(clamp).toMatch(/overflow-y:\s*auto/)
  })

  it('extractNumbers 的程式碼框：最長的一行不超過 120 欄（桌機的正文欄放得下，不會多一條只差幾 px 的橫向捲軸）；正規表示式本身沒有變', () => {
    const region = extractRegion(formatSrc, 'extractNumbers')
    // 全形字（中文註解）佔兩欄
    const cols = (line: string) => [...line].reduce((n, ch) => n + (/[\u2E80-\uFFEF]/.test(ch) ? 2 : 1), 0)
    for (const line of region.split('\n')) expect(cols(line), line).toBeLessThanOrEqual(120)
    expect(region).toContain(String.raw`/(?<![A-Za-z_§.\d^-])(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?)(?:\s*[×*]\s*10\^?([-+]?\d+)|e([-+]?\d+))?(\s*%)?/g`)
  })
})

describe('文字規範：數學一律 KaTeX', () => {
  const DIR = resolve(process.cwd(), 'src/pages/gallery')
  const files: { file: string; text: string }[] = []
  for (const dir of ['', 'sections']) {
    for (const f of readdirSync(resolve(DIR, dir))) {
      if (!/\.tsx$/.test(f) || /\.test\.tsx$/.test(f)) continue
      files.push({ file: `${dir}/${f}`, text: readFileSync(resolve(DIR, dir, f), 'utf8') })
    }
  }

  it('TSX 的 JSX 文字中不用 Unicode 拼公式（希臘字母、上下標、≤ ≥ ≈ × 等）；註解與程式字串除外；「→」是導覽用的箭頭，不算公式', () => {
    const bad: string[] = []
    for (const { file, text } of files) {
      // 去掉註解、字串字面值與 template literal，只留 JSX 文字節點
      const stripped = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\s\/\/ .*$/gm, '')
        .replace(/`(?:[^`\\]|\\.)*`/g, '``')
        .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      stripped.split('\n').forEach((line, i) => {
        if (/[α-ωΑ-Ω₀-₉⁰-⁹²³¹≤≥≈≠×·√∑∞⇒±]/.test(line)) bad.push(`${file}:${i + 1}: ${line.trim().slice(0, 80)}`)
      })
    }
    expect(bad).toEqual([])
  })
})
