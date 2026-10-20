import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'

/**
 * 章節資料夾的標準結構（docs/dev/new-chapter.md、docs/dev-conventions.md §1）：
 *   - 每個 src/chapters/chNN/ 都有標準檔案與 export（scripts/new-chapter.mjs 產生的就是這一組）
 *   - 每個有標題的 <section>／<Section> 都有 id；id 在章內唯一、以 chNN- 開頭（符號表的 "symbols" 除外）
 *   - 章內不再自寫勘誤徽章、帶入手算引言、頁內跳轉、texNum 的實作——用 @/components 的共用元件
 * 例外一律列在 EXCEPTIONS 並附理由；例外清單裡的項目一旦符合規則，測試會要求把它從清單拿掉。
 */
const ROOT = process.cwd()
const CHAPTERS = join(ROOT, 'src/chapters')
const chapterDirs = readdirSync(CHAPTERS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^ch\d{2}[a-z]?$/.test(d.name))
  .map((d) => d.name)
  .sort()

const read = (path: string) => readFileSync(path, 'utf8')

function walk(dir: string, pred: (name: string) => boolean, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, pred, out)
    else if (pred(e.name)) out.push(p)
  }
  return out
}

/** 非測試的 .ts／.tsx 原始碼（不含 *.test.*、testutil） */
const sources = (ch: string) => walk(join(CHAPTERS, ch), (n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && !/testutil/.test(n))

/** 去掉註解，免得說明文字裡的範例被當成程式碼 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')

/** 例外：章 → { 規則 → 理由 }。理由要寫清楚為什麼現在不符合、什麼時候該拿掉 */
const EXCEPTIONS: Record<string, Partial<Record<'files' | 'exports' | 'sectionIds' | 'localHelpers', string>>> = {}
const excused = (ch: string, rule: 'files' | 'exports' | 'sectionIds' | 'localHelpers') => EXCEPTIONS[ch]?.[rule]

/* ───────────── 1. 標準檔案與 export ───────────── */

/** 標準檔案（整頁的 smoke test 檔名是 chNN.test.tsx 或 index.test.tsx 二擇一） */
const REQUIRED_FILES = ['index.tsx', 'chapter.css', 'formulas.ts', 'handcalcs.ts', 'diagrams.ts', 'diagrams.test.tsx', 'handcalcs.test.tsx']

function pageTestName(ch: string): string | null {
  for (const n of [`${ch}.test.tsx`, 'index.test.tsx']) if (existsSync(join(CHAPTERS, ch, n))) return n
  return null
}

describe('章節資料夾：標準檔案與 export', () => {
  it('掃描有找到章節（ch00–ch14、ch11b）', () => {
    expect(chapterDirs.length).toBeGreaterThanOrEqual(16)
    expect(chapterDirs).toContain('ch00')
    expect(chapterDirs).toContain('ch11b')
  })

  it.each(chapterDirs)('%s：有標準檔案', (ch) => {
    if (excused(ch, 'files')) return
    const missing = REQUIRED_FILES.filter((f) => !existsSync(join(CHAPTERS, ch, f)))
    expect(missing, `${ch} 缺少檔案`).toEqual([])
    expect(pageTestName(ch), `${ch} 缺少整頁 smoke test（${ch}.test.tsx 或 index.test.tsx）`).not.toBeNull()
  })

  it.each(chapterDirs)('%s：index.tsx default export；formulas.ts 匯出 FORMULAS；handcalcs.ts 匯出 HANDCALCS；diagrams.ts 有 export', (ch) => {
    if (excused(ch, 'exports')) return
    const dir = join(CHAPTERS, ch)
    expect(read(join(dir, 'index.tsx'))).toMatch(/export default (function|class|[A-Za-z_])/)
    expect(read(join(dir, 'formulas.ts'))).toMatch(/export const FORMULAS\b/)
    expect(read(join(dir, 'handcalcs.ts'))).toMatch(/export const HANDCALCS\b/)
    expect(read(join(dir, 'diagrams.ts'))).toMatch(/^export /m)
  })

  it('例外清單裡的章節都存在，而且每個例外都附理由', () => {
    for (const [ch, rules] of Object.entries(EXCEPTIONS)) {
      expect(chapterDirs, ch).toContain(ch)
      for (const [rule, why] of Object.entries(rules)) expect(why?.length ?? 0, `${ch}.${rule}`).toBeGreaterThan(15)
    }
  })
})

/* ───────────── 1b. 範本的另外兩個測試檔：既有章節的例外清單 ───────────── */

/**
 * 範本（scripts/new-chapter.mjs）產生五個測試檔：整頁 smoke、diagrams、handcalcs（上面的 REQUIRED_FILES 已要求）、formulas.test.ts、presets.test.ts。
 * 後兩個在既有章節大多沒有；它們檢查的內容目前由全站測試涵蓋，所以列成例外（理由在 TEMPLATE_TEST_EXCUSED_WHY）：
 *   - formulas.test.ts：src/pages/formulas/registry.test.ts 用 import.meta.glob 收集每章 FORMULAS，檢查 ID 唯一、格式、KaTeX 嚴格解析、結論標籤與勘誤編號。
 *   - presets.test.ts：src/pages/gallery/data.test.ts 與 src/data/validate.test.ts 檢查全站 preset 的格式、頁面、實驗與 id 唯一。
 * 新章一律要有（範本已產生）；清單只能變短：某章補上之後，測試會要求把它從清單拿掉。
 */
const TEMPLATE_TESTS = ['formulas.test.ts', 'presets.test.ts'] as const
const TEMPLATE_TEST_EXCUSED: Record<(typeof TEMPLATE_TESTS)[number], readonly string[]> = {
  'formulas.test.ts': ['ch00', 'ch01', 'ch02', 'ch03', 'ch04', 'ch05', 'ch06', 'ch07', 'ch08', 'ch09', 'ch10', 'ch11', 'ch11b', 'ch12', 'ch13'],
  'presets.test.ts': ['ch00', 'ch02', 'ch03', 'ch04', 'ch05', 'ch06', 'ch07', 'ch08', 'ch09', 'ch12', 'ch13'],
}
const TEMPLATE_TEST_EXCUSED_WHY: Record<(typeof TEMPLATE_TESTS)[number], string> = {
  'formulas.test.ts': '既有章節的公式由 src/pages/formulas/registry.test.ts 全站檢查（ID、格式、KaTeX 嚴格解析、標籤、勘誤編號）',
  'presets.test.ts': '既有章節的 preset 由 src/pages/gallery/data.test.ts 與 src/data/validate.test.ts 全站檢查（格式、頁面、實驗、id 唯一）',
}

describe('章節資料夾：範本的 formulas.test.ts／presets.test.ts（既有章節的例外清單）', () => {
  it.each(TEMPLATE_TESTS)('%s：缺少的章節正好是例外清單（新章不能缺；補上了就從清單拿掉）', (f) => {
    const missing = chapterDirs.filter((ch) => !existsSync(join(CHAPTERS, ch, f)))
    expect(missing, `${f}：例外清單要和實際缺少的章節一致（${TEMPLATE_TEST_EXCUSED_WHY[f]}）`).toEqual([...TEMPLATE_TEST_EXCUSED[f]].sort())
    expect(TEMPLATE_TEST_EXCUSED_WHY[f].length).toBeGreaterThan(15)
  })
})

/* ───────────── 2. 穩定的段落 id ───────────── */

interface SectionTag {
  file: string
  line: number
  tag: string
  id: string | null
}

/** 掃描 <Section …>／<section …> 的開頭標籤（大括號配對，所以 title={…} 裡有 > 也沒關係） */
function sectionTags(ch: string): SectionTag[] {
  const out: SectionTag[] = []
  for (const file of sources(ch)) {
    const src = stripComments(read(file))
    for (const m of src.matchAll(/<(Section|section)\b/g)) {
      let i = (m.index ?? 0) + m[0].length
      let depth = 0
      while (i < src.length) {
        const c = src[i]
        if (c === '{') depth++
        else if (c === '}') depth--
        else if (c === '>' && depth === 0) break
        i++
      }
      const tag = src.slice(m.index, i + 1)
      const lit = /\bid="([^"]+)"/.exec(tag)
      out.push({ file: file.replace(`${ROOT}/`, ''), line: src.slice(0, m.index).split('\n').length, tag, id: lit ? lit[1] : /\bid=\{/.test(tag) ? '{expr}' : null })
    }
  }
  return out
}

describe('穩定的段落 id（docs/dev-conventions.md §1.6）', () => {
  it.each(chapterDirs)('%s：每個 <Section>／<section> 都有 id', (ch) => {
    const missing = sectionTags(ch)
      .filter((s) => s.id === null)
      .map((s) => `${s.file}:${s.line}`)
    if (excused(ch, 'sectionIds')) {
      expect(missing.length, `${ch} 已經全部有 id 了：把例外清單裡的 ${ch}.sectionIds 拿掉`).toBeGreaterThan(0)
      return
    }
    expect(missing, `${ch} 沒有 id 的段落`).toEqual([])
  })

  it.each(chapterDirs)('%s：段落 id 在章內唯一，格式是 <chNN>-<slug>（或章末符號表的 symbols）', (ch) => {
    const ids = sectionTags(ch)
      .map((s) => s.id)
      .filter((id): id is string => !!id && id !== '{expr}')
    expect(new Set(ids).size, `${ch} 有重複的段落 id：${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`).toBe(ids.length)
    // 新的 id 用小寫英數與連字號；舊的 id 不改（ch10-derive-G 有大寫，已經被連結引用），所以這裡接受大小寫
    const bad = ids.filter((id) => id !== 'symbols' && !new RegExp(`^${ch}-[A-Za-z0-9]+(-[A-Za-z0-9]+)*$`).test(id))
    expect(bad, `${ch} 的段落 id 不符合 ${ch}-<slug>（英數與連字號）`).toEqual([])
  })
})

/* ───────────── 3. 共用元件，不要在章內自寫 ───────────── */

/** 這些名稱在章內不能再有「自己的實作」（共用版本：ChapterErratum、bindHandCalc／ChapterHandCalc、ChapterFig、JumpTo／jumpToId、makeTexNum） */
const FORBIDDEN_DEFS = /\b(?:export\s+)?(?:function|const)\s+(Erratum|ErratumNote|ErrataNote|ErratumRef|scrollToId|scrollToAnchor|jumpTo|JumpTo|HandLink|HandCalcLink)\b/g

describe('章節不自寫共用元件（src/components/chapter）', () => {
  it.each(chapterDirs)('%s：沒有自己的 Erratum／JumpTo／scrollToId／HandLink，也沒有 href="#/verification"', (ch) => {
    const hits: string[] = []
    for (const file of sources(ch)) {
      const src = stripComments(read(file))
      for (const m of src.matchAll(FORBIDDEN_DEFS)) hits.push(`${file.replace(`${ROOT}/`, '')}：自寫 ${m[1]}`)
      if (/href=["']#\/verification["']/.test(src)) hits.push(`${file.replace(`${ROOT}/`, '')}：href="#/verification"（改用 ChapterErratum／ErratumLink，連到 ?e=Exx 的卡片）`)
      // texNum 要綁共用的 makeTexNum，不能自己再寫一份轉換規則
      if (/\bfunction\s+texNum\b/.test(src)) hits.push(`${file.replace(`${ROOT}/`, '')}：自寫 texNum（用 makeTexNum）`)
    }
    if (excused(ch, 'localHelpers')) {
      expect(hits.length, `${ch} 已經沒有自寫的共用元件了：把例外清單裡的 ${ch}.localHelpers 拿掉`).toBeGreaterThan(0)
      return
    }
    expect(hits).toEqual([])
  })

  it.each(chapterDirs)('%s：Hand 的「怎麼用」固定句子用共用的 HAND_CALC_HOWTO_TAIL，不是自己抄一份', (ch) => {
    // 原本 Ch11 與 Ch11b 的 Hand.tsx 各抄了同一句長字串
    const hits = sources(ch)
      .filter((f) => /下面會一步一步把它們代進公式/.test(read(f)))
      .map((f) => f.replace(`${ROOT}/`, ''))
    expect(hits).toEqual([])
  })

  it.each(chapterDirs)('%s：沒有直接呼叫 scrollIntoView（用 JumpTo／jumpToId／AnchorLink：它們會先展開祖先 <details>，再補償晚到的版面位移）', (ch) => {
    if (excused(ch, 'localHelpers')) return
    const hits = sources(ch).filter((f) => /\.scrollIntoView\b/.test(stripComments(read(f)))).map((f) => f.replace(`${ROOT}/`, ''))
    expect(hits).toEqual([])
  })
})

/**
 * 勘誤註記（ChapterErratum 的 note／detail／children 與 ChapterErratumNote 的 children）是畫面上直接看得到的文字，數學一律寫成 $…$。
 * 用 TypeScript 的語法樹找出每個 <ChapterErratum>／<ChapterErratumNote>，只看「畫面上會變成純文字」的部分：
 *   - note="…"／note={String.raw`…`}：經 mathText，$…$ 排成 KaTeX，$…$ 以外不可有數學痕跡；
 *   - detail／children 裡的 JSX 文字與字串常數：不經 mathText（所以裡面不能有 $），數學要包在 <Tex>／<TexBlock>／<MathText>（這些整個略過）。
 * 範例：$H_{\mathrm{PD}}(s)$、$K_qC$、$\sigma_v$、$\varepsilon_{cc}$、$c_3$，不是 H_PD(s)、K_qC、σ_v、ε_cc、c₃。
 */
describe('ChapterErratum 的 note／detail／children 是看得到的文字：數學一律寫成 $…$（docs/teaching-style.md：所有數學用 LaTeX）', () => {
  const ERRATUM_TAGS = new Set(['ChapterErratum', 'ChapterErratumNote'])
  /** 裡面是數學（或程式碼）的元素：整個略過 */
  const MATH_ELEMENTS = new Set(['Tex', 'TexBlock', 'MathText', 'code'])
  /** 字串引數會經 mathText 排版的函數（Ch08 的 rich = mathText 的包裝）：引數裡的 $…$ 會變成 KaTeX，不是原樣顯示 */
  const MATH_RENDERERS = new Set(['rich', 'mathText'])
  /** $…$ 外面不應該出現的數學痕跡：下標底線、希臘字母、偏微分、下標／上標數字（₀–₉、⁰–⁹、²、³）、單字母函數 H(s) */
  const MATHY = /[_^]|[α-ωΑ-Ω∂₀-₉⁰-⁹²³]|\b[A-Za-z]\((?:[a-z]|\d+)\)/

  interface Plain {
    text: string
    /** note 經 mathText（$…$ 會排成 KaTeX）；其餘不經 */
    mathText: boolean
  }

  /** 字串常數與樣板字串的字面部分（String.raw`…`、'…'、"…"；`${…}` 內的運算式不算） */
  function literalParts(node: ts.Node): string[] | null {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
    if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((sp) => sp.literal.text)]
    if (ts.isTaggedTemplateExpression(node)) return literalParts(node.template)
    return null
  }

  /** 收集一棵子樹裡畫面上會顯示的純文字（略過 Tex 之類的數學元素、巢狀元素的屬性、識別字） */
  function collect(node: ts.Node, mathText: boolean, out: Plain[]): void {
    if (ts.isJsxText(node)) {
      if (node.text.trim()) out.push({ text: node.text, mathText })
      return
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText()
      if (MATH_ELEMENTS.has(tag)) return
      if (ts.isJsxElement(node)) node.children.forEach((c) => collect(c, mathText, out))
      return
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && MATH_RENDERERS.has(node.expression.text)) {
      node.arguments.forEach((a) => collect(a, true, out))
      return
    }
    const lit = literalParts(node)
    if (lit) {
      for (const text of lit) if (text.trim()) out.push({ text, mathText })
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((sp) => collect(sp.expression, mathText, out))
      return
    }
    ts.forEachChild(node, (c) => collect(c, mathText, out))
  }

  /** 一個勘誤註記元素的所有純文字 */
  function erratumTexts(el: ts.JsxElement | ts.JsxSelfClosingElement): Plain[] {
    const out: Plain[] = []
    const opening = ts.isJsxElement(el) ? el.openingElement : el
    for (const attr of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attr) || !attr.initializer) continue
      const name = attr.name.getText()
      if (name === 'note') collect(attr.initializer, true, out)
      else if (name === 'detail') collect(attr.initializer, false, out)
    }
    if (ts.isJsxElement(el)) el.children.forEach((c) => collect(c, false, out))
    return out
  }

  function erratumElements(sf: ts.SourceFile): Array<ts.JsxElement | ts.JsxSelfClosingElement> {
    const found: Array<ts.JsxElement | ts.JsxSelfClosingElement> = []
    const visit = (n: ts.Node): void => {
      if (ts.isJsxElement(n) && ERRATUM_TAGS.has(n.openingElement.tagName.getText())) found.push(n)
      else if (ts.isJsxSelfClosingElement(n) && ERRATUM_TAGS.has(n.tagName.getText())) found.push(n)
      ts.forEachChild(n, visit)
    }
    visit(sf)
    return found
  }

  /** 一段純文字的問題；沒有問題回傳 null */
  function problem({ text, mathText }: Plain): string | null {
    if (!mathText && text.includes('$')) return '不經 mathText 的文字（children／detail）裡有 $：會原樣顯示成美元符號，數學改包 <Tex>'
    const outside = mathText ? text.split('$').filter((_, i) => i % 2 === 0).join(' ') : text
    return MATHY.test(outside) ? '$…$ 外面有純文字數學' : null
  }

  let scanned = 0
  let withText = 0

  it.each(chapterDirs)('%s：勘誤註記在 $…$（或 <Tex>）外面沒有 x_y、σ、∂、c₃、H(s) 這類純文字數學', (ch) => {
    const hits: string[] = []
    for (const file of sources(ch).filter((f) => f.endsWith('.tsx'))) {
      const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      for (const el of erratumElements(sf)) {
        scanned++
        const texts = erratumTexts(el)
        if (texts.length) withText++
        for (const t of texts) {
          const why = problem(t)
          if (why) hits.push(`${file.replace(`${ROOT}/`, '')}:${sf.getLineAndCharacterOfPosition(el.getStart()).line + 1}：${why}：${t.text.trim()}`)
        }
      }
    }
    expect(hits).toEqual([])
  })

  it('掃描確實有看到勘誤註記（避免語法樹走訪壞掉而什麼都沒掃到）', () => {
    expect(scanned).toBeGreaterThan(200)
    expect(withText).toBeGreaterThan(30)
  })

  it('偵測規則本身：純文字數學會被抓到，$…$、<Tex> 與一般中文不會', () => {
    const run = (tsx: string): string[] => {
      const sf = ts.createSourceFile('x.tsx', `const X = () => (<p>${tsx}</p>)`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      return erratumElements(sf).flatMap((el) => erratumTexts(el).map(problem).filter((p): p is string => !!p))
    }
    expect(run('<ChapterErratum id="E1" note="H_PD(s) 與 σ_v" />')).toHaveLength(1)
    expect(run('<ChapterErratum id="E1" note="c₃ 與 K_qC" />')).toHaveLength(1)
    expect(run('<ChapterErratum id="E1" note={String.raw`$H_{\\mathrm{PD}}(s)$ 與 $\\sigma_v$ 不是 H_PD`} />')).toHaveLength(1)
    expect(run('<ChapterErratum id="E1" detail={<>規格寫 σ_w，本站寫 w。</>} />')).toHaveLength(1)
    expect(run('<ChapterErratumNote id="E1">這裡 ε_cc 是干擾<Tex>{"x_n"}</Tex></ChapterErratumNote>')).toHaveLength(1)
    expect(run('<ChapterErratum id="E1">改寫成 $\\sigma_v$</ChapterErratum>')).toHaveLength(1)
    expect(run('<ChapterErratum id="E1" note={String.raw`$H_{\\mathrm{PD}}(s)$、$K_qC$、$\\varepsilon_{cc}$、$c_3$ 都是 LaTeX`} />')).toEqual([])
    expect(run('<ChapterErratum id="E1" detail={<>{rich(String.raw`$\\sigma_v$ 與 $c_3$`)}</>} />')).toEqual([])
    expect(run('<ChapterErratum id="E1" detail={<>{rich(String.raw`σ_v 沒有包 $…$`)}</>} />')).toHaveLength(1)
    expect(run('<ChapterErratum id="E1" detail={<>規格寫成 <Tex>{"H_{PD}"}</Tex>，本站一律寫 <code>sgn(v, tie)</code>。</>} />')).toEqual([])
    expect(run('<ChapterErratumNote id="E1">本章所有 <Tex>{"\\\\delta"}</Tex> 一律為 <strong>a − w</strong>（與規格 §0 一致）。</ChapterErratumNote>')).toEqual([])
  })
})

/* ───────────── 4. 範本產生器本身 ───────────── */

describe('scripts/new-chapter.mjs', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'new-chapter-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))
  const run = (...a: string[]) => execFileSync('node', [join(ROOT, 'scripts/new-chapter.mjs'), ...a, '--root', tmp], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

  it('產生的資料夾有標準檔案（和上面的 REQUIRED_FILES 一致），加上 common.tsx、三個 sections 與其餘三個測試檔', () => {
    run('98', 'template-check')
    const dir = join(tmp, 'src/chapters/ch98')
    for (const f of REQUIRED_FILES) expect(existsSync(join(dir, f)), f).toBe(true)
    expect(existsSync(join(dir, 'ch98.test.tsx'))).toBe(true)
    for (const f of ['common.tsx', 'sections/Intro.tsx', 'sections/Wrap.tsx', 'sections/Symbols.tsx', 'formulas.test.ts', 'presets.test.ts']) expect(existsSync(join(dir, f)), f).toBe(true)
    expect(read(join(dir, 'index.tsx'))).toMatch(/export default function Chapter98\(\)/)
    expect(read(join(dir, 'formulas.ts'))).toMatch(/export const FORMULAS: FormulaEntry\[\] = \[\]/)
    expect(read(join(dir, 'handcalcs.ts'))).toMatch(/export const HANDCALCS: HandCalcDef\[\] = \[\]/)
  })

  it('產生的 section 都有 <chNN>-<slug> 的 id；common.tsx 只用共用元件（沒有自寫實作）', () => {
    const dir = join(tmp, 'src/chapters/ch98')
    for (const f of ['sections/Intro.tsx', 'sections/Wrap.tsx']) expect(read(join(dir, f))).toMatch(/<Section [^>]*id="ch98-[a-z-]+"/)
    expect(read(join(dir, 'sections/Symbols.tsx'))).toContain('id="symbols"')
    const common = stripComments(read(join(dir, 'common.tsx')))
    expect(common).toContain('bindHandCalc(')
    expect(common).toContain('makeTexNum(')
    expect(common).toContain('<ChapterFig')
    expect(common.match(FORBIDDEN_DEFS)).toBeNull()
  })

  it('延伸章的章號 11b 風格：類別小寫、公式與手算題 ID 大寫（F-11B.、HC-11B.）', () => {
    run('97b', 'extension-check')
    const dir = join(tmp, 'src/chapters/ch97b')
    expect(read(join(dir, 'index.tsx'))).toContain('export default function Chapter97b()')
    expect(read(join(dir, 'index.tsx'))).toContain('className="ch97b"')
    expect(read(join(dir, 'formulas.test.ts'))).toContain("'F-97B.'")
    expect(read(join(dir, 'handcalcs.test.tsx'))).toContain("'HC-97B.'")
  })

  it('已存在的資料夾不覆蓋；章號與 slug 不合法時拒絕', () => {
    expect(() => run('98', 'again')).toThrow(/已存在/)
    expect(() => run('9', 'x')).toThrow(/章號/)
    expect(() => run('15', 'Bad_Slug')).toThrow(/slug/)
    expect(existsSync(join(tmp, 'src/chapters/ch15'))).toBe(false)
  })

  it('--dry-run 不寫檔', () => {
    const out = run('96', 'dry', '--dry-run')
    expect(out).toContain('dry-run')
    expect(existsSync(join(tmp, 'src/chapters/ch96'))).toBe(false)
  })
})
