/**
 * 文件裡的「事實」不能和站內實際的資料脫節：
 *   1. README.md 與 docs/implementation_plan.md 寫的數量（公式、preset、手算題、勘誤、章節頁、T-id 狀態）
 *      要等於站內實際值——這些數字原本是手寫的，曾經差過一條（383 vs 384）。
 *   2. 開發文件裡用 `反引號` 寫出的檔案路徑都要存在（曾經留著已經不存在的 src/tests/golden.test.ts）。
 *   3. docs/dev-conventions.md §8 要寫出四支審查腳本，以及它們實際會讀的每一個旗標。
 *   4. 開發文件裡不能留下代理人回報的口氣（第一人稱、轉達給使用者的註記）與已知過期的說法。
 *
 * 只比對「數字出現在文件裡」，不比對整段文字，所以改一句話不會讓測試壞掉。
 * 測試檔案數與測試項數（README 的驗證狀態表）需要完整跑完測試才知道，這裡不核對。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PAGES } from '@/app/registry'
import { ALL_HANDCALCS } from '@/app/handcalcs'
import { ALL_PRESETS } from '@/app/presets'
import { ALL_FORMULAS, registryStats } from '@/pages/formulas/registry'
import errataFile from '@/data/errata.json'
import statusFile from '@/data/verification-status.json'

const ROOT = process.cwd()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/** 取第一個符合的數字（允許千分位逗號）；找不到就讓測試失敗並指出是哪一條 */
function numbersIn(text: string, re: RegExp, label: string): number[] {
  const m = re.exec(text)
  if (!m) throw new Error(`文件裡找不到「${label}」（規則 ${re}）`)
  return m.slice(1).map((s) => Number(s.replace(/,/g, '')))
}

const readme = read('README.md')
const plan = read('docs/implementation_plan.md')

const stats = registryStats(ALL_FORMULAS)
const presetFiles = readdirSync(join(ROOT, 'src/data/presets')).filter((n) => n.endsWith('.json'))
const errataCount = (errataFile as { errata: unknown[] }).errata.length
const chapterPages = PAGES.filter((p) => /^ch\d\d$/.test(p.id) || p.id === 'case-sspll')
const tStatus = (statusFile as { tests: Record<string, { status: string }> }).tests
const passCount = Object.values(tStatus).filter((t) => t.status === 'pass').length

describe('README.md 的數量等於站內實際值', () => {
  it('公式：「N 條公式有 ID」＝ ALL_FORMULAS，括號內的頁數＝ /formulas 頁顯示的登錄頁數', () => {
    const [n] = numbersIn(readme, /(\d+) 條公式有 ID/, 'N 條公式有 ID')
    expect(n).toBe(ALL_FORMULAS.length)
    const [pages] = numbersIn(readme, /分佈在 (\d+) 個頁面/, '公式分佈的頁數')
    expect(pages).toBe(stats.pages)
    // 精確／近似／研究假說的條數不寫進文件：它隨內容審查常常調整，由 /formulas 頁即時顯示
    expect(stats.byClaim.exact + stats.byClaim.approx + stats.byClaim.research).toBe(ALL_FORMULAS.length)
  })

  it('preset：「N 個 preset」＝ src/data/presets 的檔案數 ＝ ALL_PRESETS', () => {
    const [n] = numbersIn(readme, /(\d+) 個 preset 可由 Gallery 載入/, 'N 個 preset')
    expect(n).toBe(presetFiles.length)
    expect(n).toBe(ALL_PRESETS.length)
  })

  it('帶入手算：「N 題」＝ ALL_HANDCALCS', () => {
    const [n] = numbersIn(readme, /帶入手算\*\*：(\d+) 題/, '帶入手算 N 題')
    expect(n).toBe(ALL_HANDCALCS.length)
  })

  it('勘誤：「確認 N 項勘誤」＝ errata.json；「N 項聲明」＝ docs/validation.md 的「共 N 項」', () => {
    const [n] = numbersIn(readme, /確認 (\d+) 項勘誤/, '確認 N 項勘誤')
    expect(n).toBe(errataCount)
    const [claims] = numbersIn(readme, /(\d+) 項聲明重算/, 'N 項聲明重算')
    const [inValidation] = numbersIn(read('docs/validation.md'), /共 \*\*(\d+)\*\* 項/, 'validation.md 的「共 N 項」')
    expect(claims).toBe(inValidation)
  })

  it('方塊圖：「N 個章節頁」＝ ch00–ch14 加上 SSPLL 案例頁', () => {
    const [n] = numbersIn(readme, /(\d+) 個章節頁共 \d+ 張/, 'N 個章節頁')
    expect(n).toBe(chapterPages.length)
  })

  it('T-id：「N／18 pass」＝ verification-status.json 裡 status 為 pass 的 T-id 數', () => {
    const [n] = numbersIn(readme, /\| T01–T18[^\n]*\| (\d+)／18 pass \|/, 'N／18 pass')
    expect(Object.keys(tStatus)).toHaveLength(18)
    expect(n).toBe(passCount)
  })
})

describe('docs/implementation_plan.md 的規模數字等於站內實際值', () => {
  it('頁面、公式、preset、手算題、勘誤', () => {
    const [pages, formulas, presets, handcalcs, errata] = numbersIn(
      plan,
      /(\d+) 個頁面、(\d+) 條有 ID 的公式、(\d+) 個 preset、(\d+) 題帶入手算、(\d+) 項勘誤/,
      '站內的規模',
    )
    expect([pages, formulas, presets, handcalcs, errata]).toEqual([PAGES.length, ALL_FORMULAS.length, presetFiles.length, ALL_HANDCALCS.length, errataCount])
  })
})

describe('docs/dev-conventions.md §1.2：新增一頁要填的 PAGES 欄位和 registry.ts 的 PageEntry 一致', () => {
  it('PageEntry 的每個欄位都以 `反引號` 寫在 §1 裡（曾經漏掉 component）', () => {
    const conv = read('docs/dev-conventions.md')
    const section = conv.slice(conv.indexOf('## 1. '), conv.indexOf('## 2. '))
    const iface = /export interface PageEntry \{([\s\S]*?)\n\}/.exec(read('src/app/registry.ts'))
    if (!iface) throw new Error('src/app/registry.ts 找不到 export interface PageEntry')
    const fields = [...iface[1].matchAll(/^\s+([a-zA-Z]+)\??:/gm)].map((m) => m[1])
    expect(fields.length).toBeGreaterThanOrEqual(8)
    const missing = fields.filter((f) => !section.includes(`\`${f}\``))
    expect(missing, '§1 沒有寫到這些 PageEntry 欄位').toEqual([])
  })
})

/** 這些文件裡用 `反引號` 寫出的檔案路徑都必須存在 */
const PATH_DOCS = ['README.md', 'docs/dev-conventions.md', 'docs/dev/infra-api.md', 'docs/teaching-style.md', 'docs/implementation_plan.md']
const PATH_ROOTS = ['src/', 'scripts/', 'docs/', 'golden/', 'analysis/', '.github/']
/** 含這些記號的是範本（chNN、<name>、*、Txx…），不是實際的路徑 */
const PLACEHOLDER = /NN|xx|<|>|\*|\{|\}|\.\.\./

function referencedPaths(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/`([^`\s]+)`/g)) {
    const raw = m[1].replace(/[，。；、）)]+$/u, '').replace(/\?raw$/, '')
    if (!PATH_ROOTS.some((r) => raw.startsWith(r)) || PLACEHOLDER.test(raw)) continue
    out.add(raw.replace(/\/$/, ''))
  }
  return [...out].sort()
}

describe('開發文件裡寫到的檔案路徑都存在', () => {
  it('路徑清單不是空的（規則本身有抓到東西）', () => {
    expect(referencedPaths(read('docs/dev-conventions.md')).length).toBeGreaterThan(20)
  })

  for (const doc of PATH_DOCS) {
    it(doc, () => {
      const missing = referencedPaths(read(doc)).filter((p) => !existsSync(join(ROOT, p)))
      expect(missing, `${doc} 提到了不存在的路徑`).toEqual([])
    })
  }
})

describe('docs/dev-conventions.md §8：審查腳本都有寫、腳本會讀的旗標都有寫', () => {
  const conv = read('docs/dev-conventions.md')
  const section = conv.slice(conv.indexOf('## 8. 審查腳本'))

  it('有 §8，而且 §7（語言與文字）的編號沒有動（src/pages/roadmap/data.ts 引用它）', () => {
    expect(section.length).toBeGreaterThan(500)
    expect(conv).toContain('## 7. 語言與文字')
  })

  for (const name of ['screenshots', 'diagram-audit', 'scroll-audit', 'dom-eval', 'verify']) {
    it(`scripts/${name}.mjs 在 §8 有說明，而且腳本讀的每個旗標都出現在文件裡`, () => {
      expect(existsSync(join(ROOT, `scripts/${name}.mjs`))).toBe(true)
      expect(section).toContain(`${name}.mjs`)
      const src = read(`scripts/${name}.mjs`)
      const flags = new Set<string>()
      for (const m of src.matchAll(/\bargs\.([a-z][\w]*)/g)) if (m[1] !== 'has') flags.add(m[1]) // args.has(...) 是 Set 的方法，旗標在下一行處理
      for (const m of src.matchAll(/args\.has\('--([\w-]+)'\)/g)) flags.add(m[1])
      const undocumented = [...flags].filter((f) => !section.includes(`--${f}`))
      expect(undocumented, `scripts/${name}.mjs 讀了這些旗標，但 §8 沒有寫`).toEqual([])
    })
  }

  it('「改了畫面要附上的檢查」的約定與升級渲染相關套件時的前後對照都寫在 §8', () => {
    expect(section).toContain('改了畫面的 PR 要附上這些檢查的結果')
    expect(section).toContain('升級 `mermaid`、`katex`、`plotly.js-dist-min`')
  })
})

describe('開發文件沒有代理人回報的口氣與已知過期的說法', () => {
  const FORBIDDEN: ReadonlyArray<[string, RegExp]> = [
    ['轉達給使用者的註記', /Note for whoever relays/],
    ['由各模組作者回報彙整', /由各模組作者回報/],
    ['稽核者的實作建議', /各章節稽核者給的實作建議/],
    ['第一人稱的回報（I chose／I added／I suggest／I did not touch…）', /\bI (?:chose|added|keep|suggest|follow|import|did not|don't)\b/],
    ['已經不存在的 src/tests/golden.test.ts', /src\/tests\/golden\.test\.ts/],
    ['已經不存在（空）的 src/experiments', /src\/experiments\//],
    ['T01／T02 是 partial（現在 18/18 pass）', /T01 and T02 show 'partial'/],
    ['平行開發時的檔案所有權規則', /檔案所有權|每個章節 agent 只能修改/],
    ['docs/validation.md 不存在（現在存在）', /validation\.md does not exist/],
  ]

  for (const doc of ['docs/dev-conventions.md', 'docs/dev/infra-api.md', 'README.md']) {
    it(doc, () => {
      const text = read(doc)
      const hits = FORBIDDEN.filter(([, re]) => re.test(text)).map(([what]) => what)
      expect(hits).toEqual([])
    })
  }

  it('規則本身：每一條都抓得到一個例句', () => {
    const SAMPLES = [
      'Note for whoever relays this to the user',
      '（由各模組作者回報彙整）',
      '## 規格驗算時各章節稽核者給的實作建議',
      'I suggest no changes to shared code.',
      '`src/tests/golden.test.ts`',
      '`src/experiments/<id>/**`',
      "At the moment T01 and T02 show 'partial'.",
      '## 1. 檔案所有權（平行開發時避免衝突）',
      'docs/validation.md does not exist and I do not own docs/',
    ]
    for (const [what, re] of FORBIDDEN) expect(SAMPLES.some((s) => re.test(s)), what).toBe(true)
  })
})
