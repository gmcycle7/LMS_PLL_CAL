#!/usr/bin/env node
/**
 * 新增一章的範本產生器（docs/dev/new-chapter.md 是完整的檢查清單）。
 *
 *   node scripts/new-chapter.mjs <NN> <slug> [--root <dir>] [--dry-run]
 *
 *   NN    章號：兩位數字，延伸章加一個小寫字母（'15'、'11b'）
 *   slug  英文短字（小寫、數字、連字號），例如 'adaptive-step'；只用在檔頭註解與章名的預設值
 *
 * 產生 src/chapters/ch<NN>/（已存在就拒絕，不覆蓋）：
 *   index.tsx                 default export；章首 → （你的各節）→ 本課必記 → 符號表
 *   chapter.css               章節專屬樣式（class 加 ch<NN>- 前綴）
 *   common.tsx                本章的 Hand／Fig／FigRef／texNum：全部是共用元件（@/components）的一行綁定
 *   formulas.ts / handcalcs.ts / diagrams.ts
 *   sections/Intro.tsx、Wrap.tsx、Symbols.tsx
 *   ch<NN>.test.tsx、diagrams.test.tsx、handcalcs.test.tsx、formulas.test.ts、presets.test.ts
 *
 * 產生的檔案可以直接通過 tsc、eslint 與它自己的五個測試（空的公式／手算／圖／preset 清單是合法的）。
 * 腳本不會改任何既有檔案：registry、chapterMeta、backbone…要自己接（印在最後，詳見 docs/dev/new-chapter.md）。
 * src/data/chapterTemplate.test.ts 會檢查每個章節資料夾都有這組標準檔案與 export。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--root'))
const [NN_RAW, SLUG] = positional

const usage = () => {
  console.error('用法：node scripts/new-chapter.mjs <NN> <slug> [--root <dir>] [--dry-run]\n  例：node scripts/new-chapter.mjs 15 adaptive-step')
  process.exit(2)
}
if (!NN_RAW || !SLUG) usage()
if (!/^\d{2}[a-z]?$/.test(NN_RAW)) {
  console.error(`章號 "${NN_RAW}" 不合法：兩位數字，延伸章加一個小寫字母（例如 15、11b）`)
  process.exit(2)
}
if (!/^[a-z][a-z0-9-]*$/.test(SLUG)) {
  console.error(`slug "${SLUG}" 不合法：小寫英文字母開頭，只能有小寫、數字、連字號`)
  process.exit(2)
}

const root = resolve(opt('root') ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
const nn = NN_RAW // 15、11b
const NN = NN_RAW.toUpperCase() // 15、11B（公式與手算題的 ID 用大寫：F-11B.1）
const dir = join(root, 'src/chapters', `ch${nn}`)
if (existsSync(dir)) {
  console.error(`已存在：${dir}（不覆蓋；要重來請先自己刪掉）`)
  process.exit(1)
}

const fill = (text) =>
  text
    .replaceAll('__nn__', nn)
    .replaceAll('__NN__', NN)
    .replaceAll('__SLUG__', SLUG)

/* ───────────────────────── 範本 ───────────────────────── */

const FILES = {}

FILES['index.tsx'] = String.raw`import './chapter.css'
import { Intro } from './sections/Intro'
import { Wrap } from './sections/Wrap'
import { SymbolsSection } from './sections/Symbols'

/**
 * 第 __NN__ 章：__SLUG__（TODO：換成章名與規格段落）。
 *
 * 版面順序（docs/teaching-style.md §2、§9）：章首問題 + 系統地圖 → 各節（直覺 → 圖 → 公式 → 範例 → 探索）→ 比較／思考題／本課必記 → 符號表。
 * 符號表是整頁的最後一個區塊（id="symbols"）；本章資訊 strip、先備自檢與章末交棒由 PageFrame 依 src/app/chapterMeta.ts 放上去，這裡不用寫。
 * 每個有標題的 <section>／<Section> 都要有 id="ch__nn__-<英文短字>"（docs/dev-conventions.md §1.6）：PageOutline、?a= 深連結與 Beginner 骨幹路線都靠它。
 */
export default function Chapter__nn__() {
  return (
    <div className="ch__nn__">
      <Intro />
      {/* TODO：各節放在這裡，例如：
          <Section kind="formula" level={2} id="ch__nn__-first" title="__NN__.1 第一個主題">…</Section>
          帶入手算用 <Hand id="HC-__NN__.1" />、方塊圖用 <Fig id="…" />（都在 ./common），勘誤用 <ChapterErratum id="E00" />（@/components）。 */}
      <Wrap />
      <SymbolsSection />
    </div>
  )
}
`

FILES['chapter.css'] = String.raw`/* 第 __NN__ 章專屬樣式。class 一律加 ch__nn__- 前綴。
   勘誤徽章、帶入手算的引言、方塊圖與導讀、頁內跳轉按鈕的樣式在 src/components/chapter/chapter.css（全站一致），不要在這裡重寫；
   顏色、字級、間距用 src/styles/tokens.css 的 token，不要寫字面值。 */

.ch__nn__-symbols {
  margin-top: var(--space-6);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border);
}
`

FILES['common.tsx'] = String.raw`import type { ReactNode } from 'react'
import { ChapterFig, FigRef as SharedFigRef, bindHandCalc, makeTexNum } from '@/components'
import { CH__NN___DIAGRAMS, figLabel, diagramById } from './diagrams'
import { HANDCALCS } from './handcalcs'

/**
 * 本章的小工具：全部是共用元件的綁定，不放自己的實作（docs/dev/new-chapter.md）。
 * 勘誤徽章直接用 @/components 的 ChapterErratum；頁內跳轉用 JumpTo／AnchorLink；數字格式用 texNum 或 fmtNum。
 */

/** 帶入手算題：依 id 從 handcalcs.ts 取出，前面有「換你算：」引言（children 可換成貼近該題的一句話）。 */
export const Hand = bindHandCalc(HANDCALCS)

/** 放進 TeX 的數字（預設 4 位有效數字；負號、指數記號都處理好）。 */
export const texNum = makeTexNum(4)

/** 方塊圖：依 id 從 diagrams.ts 取出；children 是「怎麼看這張圖」的導讀。 */
export function Fig({ id, children }: { id: string; children?: ReactNode }) {
  const d = diagramById(id)
  return <ChapterFig chart={d.chart} label={figLabel(id)} kind={d.kind} caption={d.caption} ariaLabel={d.alt} id={'ch__nn__-fig-' + d.id}>{children}</ChapterFig>
}

/** 正文裡提到某張圖（圖號由登錄順序算出，圖的順序改變時不會對不上）。 */
export function FigRef({ id }: { id: string }) {
  return <SharedFigRef label={figLabel(id)} />
}

/** 本章有幾張圖（測試與 chapterMeta 用）。 */
export const FIGURE_COUNT = CH__NN___DIAGRAMS.length
`

FILES['formulas.ts'] = String.raw`import type { FormulaEntry } from '@/data/types'

/**
 * 本章每條有 ID 的公式（ID 格式 F-__NN__.序，全站唯一；頁面上用 <TexBlock id="F-__NN__.1">，格式見 docs/dev-conventions.md §5.1）。
 * claim 要標 exact／approx／research；exact 的 assumes 寫「在哪個模型內精確」。
 *
 * 範例（複製後改）：
 * {
 *   id: 'F-__NN__.1',
 *   title: '一句話名稱（支援 $…$）',
 *   tex: String.raw` + '`' + String.raw`p = 1 - \mu x^2` + '`' + String.raw`,
 *   conditions: '成立條件（支援 $…$）',
 *   claim: 'exact',
 *   level: 'L1',
 *   specSection: '__NN__.1',
 *   page: '/ch/__nn__',
 *   assumes: '固定 $x$、無雜訊',
 * },
 */
export const FORMULAS: FormulaEntry[] = []
`

FILES['handcalcs.ts'] = String.raw`import type { HandCalcDef } from '@/data/types'

/**
 * 本章的「帶入手算」題（docs/teaching-style.md §7）。ID 格式 HC-__NN__.序，全站唯一。
 * solve() 的數值必須呼叫 src/simulation 的實際函式（或與其交叉測試，見 handcalcs.test.tsx），不可另寫一套公式；
 * 每一步一行（tex：符號式 → 代入數字 → 結果）加一句理由（why）；數字都是 illustrative。
 * 範本：src/chapters/ch00/handcalcs.ts。
 */
export const HANDCALCS: HandCalcDef[] = []
`

FILES['diagrams.ts'] = String.raw`import type { SystemBlock } from '@/components'

/**
 * 本章的方塊圖（docs/teaching-style.md §8）。圖內標籤與圖說裡的數學寫 $…$，由 Mermaid 元件以 KaTeX 排版；
 * 圖號由登錄順序（頁面出現的順序）算出，不要在正文手寫。
 */

/** 章首系統地圖裡本章的主角（藍色方塊）。TODO：換成這一章在講的方塊。 */
export const CH__NN___SYSTEM_FOCUS: SystemBlock[] = ['cmp', 'gmac']

export interface Ch__nn__Diagram {
  /** 圖的短 id，例如 'loop'（<Fig id="loop">） */
  id: string
  /** 圖種，例如 '數學模型'、'演算法迴圈'、'比較圖'（圖號後面括起來） */
  kind: string
  /** Mermaid 原始碼 */
  chart: string
  /** 圖說：一句話說明要看什麼（$…$ 為 KaTeX） */
  caption: string
  /** 螢幕閱讀器用的文字替代（純文字，數學要念得出來） */
  alt: string
}

/** 依頁面出現的順序登錄。空的清單是合法的（新章還沒有圖）。 */
export const CH__NN___DIAGRAMS: Ch__nn__Diagram[] = []

export function diagramById(id: string): Ch__nn__Diagram {
  const d = CH__NN___DIAGRAMS.find((x) => x.id === id)
  if (!d) throw new Error('第 __NN__ 章找不到方塊圖 ' + id)
  return d
}

/** 圖號：依登錄順序編成「圖 __NN__-n」。 */
export function figLabel(id: string): string {
  const i = CH__NN___DIAGRAMS.findIndex((d) => d.id === id)
  if (i < 0) throw new Error('第 __NN__ 章找不到方塊圖 ' + id)
  return '圖 __NN__-' + (i + 1)
}
`

FILES['sections/Intro.tsx'] = String.raw`import { Callout, ClaimTag, ModelLevel, Section, SourceTag, SystemMap } from '@/components'
import { CH__NN___SYSTEM_FOCUS } from '../diagrams'

/** 章首：這一課要回答的問題、系統地圖（你在這裡）、標籤列。本章資訊 strip 與先備自檢由 PageFrame 放在這之後。 */
export function Intro() {
  return (
    <Section kind="intuition" level={2} id="ch__nn__-question" title="這一課要回答的問題">
      <Callout kind="info" title="這一課要回答的問題">
        <p>TODO：用一句話寫出本章要解決的問題（先問題、再答案），並指出它在整個 PLL + LMS 校正系統的哪一塊。</p>
      </Callout>
      <SystemMap focus={CH__NN___SYSTEM_FOCUS} />
      <p className="c-map-note">
        <strong>你在這裡：</strong>TODO：用一兩句話說明藍色方塊是本章的主角、沒有上色的部分本章不動（DTC 在 reference 輸入端，回授路徑上只有 divider；comparator 取的是 PD 的輸出）。
      </p>
      <div className="c-tag-row">
        <ModelLevel level="L1" /> <ClaimTag kind="exact" /> <SourceTag kind="illustrative" />
      </div>
    </Section>
  )
}
`

FILES['sections/Wrap.tsx'] = String.raw`import { Quiz, Recap, Section } from '@/components'

/** 比較、思考題與「本課必記」。符號表另外放在整頁最後（./Symbols.tsx）。 */
export function Wrap() {
  return (
    <Section kind="assumptions" level={2} id="ch__nn__-wrap" title="__NN__.9 思考題與本課必記">
      <Quiz title="思考題 1" question="TODO：一個需要用本章公式算數字的問題。" answer="TODO：解析（含推導）。" />
      <Recap points={['TODO：應該記住的第一件事。', 'TODO：應該記住的第二件事。']} />
    </Section>
  )
}
`

FILES['sections/Symbols.tsx'] = String.raw`import { SymbolTable, type SymbolEntry } from '@/components'

/** 本章符號表（docs/teaching-style.md §5）：整頁的最後一個區塊，外層 id="symbols"。symbol 與 unit 是 TeX。 */
export const SYMBOLS: SymbolEntry[] = [
  { symbol: 'x[n]', meaning: 'TODO：這個符號是什麼（一句話）', unit: '\\mathrm{t.u.}', firstSeen: '§__NN__.1' },
]

export function SymbolsSection() {
  return (
    <section id="symbols" className="ch__nn__-symbols" aria-label="本章符號表">
      <SymbolTable rows={SYMBOLS} title="本章符號表" caption="首次出現欄對應本頁的小節；所有例子的數字都是 illustrative。" />
    </section>
  )
}
`

FILES['ch__nn__.test.tsx'] = String.raw`import { sectionIdReport } from '@/components/chapter/sectionIds'
import { expectNoTexErrors } from '@/test/katex'
import { renderPage } from '@/test/renderPage'
import Chapter__nn__ from './index'

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

describe('第 __NN__ 章頁面（jsdom smoke）', () => {
  // 預設學習模式是 Beginner（很多區塊被藏起來）：要數圖、數段落一律用 engineer 或 research
  it('整章可渲染、沒有 KaTeX 錯誤；符號表是最後一個區塊（id="symbols"）', () => {
    const { container } = renderPage(<Chapter__nn__ />, { url: '/ch/__nn__', mode: 'engineer' })
    expectNoTexErrors(container)
    expect(container.querySelector('.ch__nn__')?.lastElementChild?.id).toBe('symbols')
  })

  it('每個有標題的 section 都有 id，而且整頁沒有重複的 id（穩定的段落 id：PageOutline、?a= 深連結、骨幹路線）', () => {
    const { container } = renderPage(<Chapter__nn__ />, { url: '/ch/__nn__', mode: 'research' })
    const report = sectionIdReport(container)
    expect(report.missing).toEqual([])
    expect(report.duplicates).toEqual([])
    expect(report.count).toBeGreaterThan(0)
  })
})
`

FILES['diagrams.test.tsx'] = String.raw`import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import { CH__NN___DIAGRAMS, diagramById, figLabel } from './diagrams'

beforeAll(installMermaidSvgShim)

describe('第 __NN__ 章方塊圖登錄', () => {
  it('id 唯一、圖號依登錄順序連續、查不到的 id 會丟錯', () => {
    const ids = CH__NN___DIAGRAMS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    ids.forEach((id, i) => expect(figLabel(id)).toBe('圖 __NN__-' + (i + 1)))
    expect(() => diagramById('no-such-diagram')).toThrow(/找不到方塊圖/)
  })

  it('圖說的 $ 成對（數學用 KaTeX）、有文字替代', () => {
    for (const d of CH__NN___DIAGRAMS) {
      expect(d.caption.split('$').length % 2, d.id).toBe(1)
      expect(d.alt.length, d.id).toBeGreaterThan(8)
      expect(d.alt, d.id).not.toContain('$')
    }
  })

  it('每張圖都能被真的 Mermaid 畫出來；圖上沒有 Unicode 拼的數學', async () => {
    for (const d of CH__NN___DIAGRAMS) {
      const r = await renderMermaidForTest(d.chart)
      expect(r.nodeCount, d.id).toBeGreaterThan(1)
      expect(unicodeMathIn(r.plainText), d.id).toEqual([])
    }
  }, 120_000)
})
`

FILES['handcalcs.test.tsx'] = String.raw`import { defaultValues, inputError } from '@/components'
import { HANDCALCS } from './handcalcs'

describe('第 __NN__ 章帶入手算', () => {
  it('ID 格式 HC-__NN__.序、唯一、page 是 /ch/__nn__', () => {
    const ids = HANDCALCS.map((h) => h.id)
    expect(new Set(ids).size).toBe(ids.length)
    HANDCALCS.forEach((h, i) => {
      expect(h.id).toBe('HC-__NN__.' + (i + 1))
      expect(h.page).toBe('/ch/__nn__')
    })
  })

  it('預設輸入都合法，solve 的結果是有限值，每一步有算式與理由', () => {
    for (const h of HANDCALCS) {
      const v = defaultValues(h)
      for (const i of h.inputs) expect(inputError(i, v[i.key]), h.id + ' ' + i.key).toBeNull()
      expect(h.validate?.(v) ?? null, h.id).toBeNull()
      const sol = h.solve(v)
      expect(sol.steps.length, h.id).toBeGreaterThan(1)
      for (const s of sol.steps) {
        expect(s.tex.length, h.id).toBeGreaterThan(0)
        expect(s.why.length, h.id).toBeGreaterThan(0)
      }
      for (const r of sol.results) expect(Number.isFinite(r.value), h.id + ' ' + r.symbol).toBe(true)
    }
  })

  // TODO：每一題都要有一個測試，把 solve() 的數字和 src/simulation 的函式（或 golden/vectors）逐一比對，
  // 容許誤差寫清楚（數值上是 0 的量要給 abs 容許度）。
})
`

FILES['formulas.test.ts'] = String.raw`import katex from 'katex'
import { FORMULAS } from './formulas'

describe('第 __NN__ 章公式登錄（formulas.ts）', () => {
  it('ID 格式 F-__NN__.序、唯一、連續編號；page 是 /ch/__nn__', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    FORMULAS.forEach((f, i) => {
      expect(f.id).toBe('F-__NN__.' + (i + 1))
      expect(f.page).toBe('/ch/__nn__')
    })
  })

  it('每一條都標了結論強度（exact／approx／research）；exact 要寫 assumes（在哪個模型內精確）', () => {
    for (const f of FORMULAS) {
      expect(['exact', 'approx', 'research'], f.id).toContain(f.claim)
      if (f.claim === 'exact') expect(f.assumes?.length ?? 0, f.id).toBeGreaterThan(0)
    }
  })

  it('每一條 TeX 都能被 KaTeX 解析（throwOnError）', () => {
    for (const f of FORMULAS) expect(() => katex.renderToString(f.tex, { throwOnError: true, strict: 'ignore' }), f.id).not.toThrow()
  })
})
`

FILES['presets.test.ts'] = String.raw`import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PresetEntry } from '@/data/types'

const dir = join(process.cwd(), 'src/data/presets')
const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
const mine = files.map((f) => ({ f, p: JSON.parse(readFileSync(join(dir, f), 'utf8')) as PresetEntry })).filter(({ p }) => p.page === '/ch/__nn__')

describe('第 __NN__ 章 presets（src/data/presets/*.json 裡 page 為 /ch/__nn__ 的）', () => {
  // 新章一開始沒有 preset 也是合法的；加了就要符合格式（TODO：再加上「expected 文字裡的數字由模型重現」的測試）
  it('格式正確：id 與檔名一致、有 experiment 與 expected、來源是 illustrative', () => {
    for (const { f, p } of mine) {
      expect(p.id + '.json', f).toBe(f)
      expect(p.experiment.length, f).toBeGreaterThan(0)
      expect(p.expected.length, f).toBeGreaterThan(10)
      expect(p.source, f).toBe('illustrative')
    }
  })
})
`

/* ───────────────────────── 寫檔 ───────────────────────── */

const written = []
for (const [name, body] of Object.entries(FILES)) {
  const rel = fill(name)
  const path = join(dir, rel)
  written.push(join('src/chapters', `ch${nn}`, rel))
  if (flag('dry-run')) continue
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, fill(body))
}

console.log(`${flag('dry-run') ? '（dry-run，沒有寫檔）' : '已產生'} src/chapters/ch${nn}/（${written.length} 個檔案）：`)
for (const w of written) console.log('  ' + w)
console.log(`
接下來（逐項說明在 docs/dev/new-chapter.md）：
  1. src/app/registry.ts            PAGES 加一筆（id 'ch${nn}'、path '/ch/${nn}'、component: ch('${nn}')）
  2. src/app/chapterMeta.ts         CHAPTER_FRAME_META：reading（用 scripts/reading-time.mjs 量）、errata、prereqs、next、models
  3. src/app/backbone.ts            Beginner 骨幹路線要不要走這一章（anchor 用 ch${nn}-<slug> 的段落 id）
  4. src/pages/dashboard            CHAPTER_META（章名、摘要、預估時間）
  5. src/pages/gallery              要放進 Experiment Gallery 的 preset（src/data/presets/*.json，page: '/ch/${nn}'）
  6. src/pages/roadmap              路線圖上的這一章
  7. README.md                      頁面、公式、手算題、preset 的數量（src/data/docsFacts.test.ts 會核對）
  8. npm run verify                 tsc、eslint、全部測試、審查腳本（改完才算完成）
`)
