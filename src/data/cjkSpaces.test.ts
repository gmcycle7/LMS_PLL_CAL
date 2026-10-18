/**
 * JSX 換行不可在中文之間（或中文／全形標點與拉丁字母之間）產生空格。
 *
 * JSX 會把多行文字的每一行去頭尾空白、再用「一個空格」接起來，所以
 *     做對，
 *     但不能取代
 * 在畫面上是「做對， 但不能取代」（全形逗號後面多一個空格），每頁有二、三十處，讀起來像網頁而不像書。
 * 同一行裡打在全形結尾標點後面的空格（「…的負的。 例：…」）是同一個缺口，一併檢查（標點後面接標籤的「。 <ClaimTag />」是刻意的，不算）。
 * 規則與修法在 scripts/check-cjk-spaces.mjs 的檔頭；這個測試做兩件事：
 *   1. 用一小段一小段的 TSX 原始碼驗證偵測與修正的行為（包含「不該動的」：拉丁字母與中文之間的空格、標籤旁的換行、
 *      模板字串、引號字串、註解、props）。
 *   2. 掃描 src 下所有 .tsx（略過測試檔）：一處違規都不能有。出現時請執行 `node scripts/check-cjk-spaces.mjs --fix`。
 */
import { readFileSync } from 'node:fs'
import ts from 'typescript'

interface Break {
  start: number
  end: number
  line: number
  col: number
  left: string
  right: string
  kind: string
}
interface CheckModule {
  classifyBreak(left: string, right: string): string | null
  findCjkBreaks(source: string, fileName?: string): Break[]
  fixCjkBreaks(source: string, fileName?: string): { text: string; count: number }
  listTsx(paths: string[], root?: string): string[]
  scanFiles(files: string[], root?: string): Array<{ file: string; breaks: Break[] }>
  DEFAULT_SCAN_ROOTS: string[]
}
// scripts/*.mjs 沒有型別宣告（專案不開 allowJs），在這裡補上介面
// @ts-expect-error -- TS7016：沒有 .d.mts
const check = (await import('../../scripts/check-cjk-spaces.mjs')) as CheckModule
const { classifyBreak, findCjkBreaks, fixCjkBreaks, listTsx, scanFiles, DEFAULT_SCAN_ROOTS } = check

/** 把一段 TSX 編成 react-jsx 的輸出：JSX 文字（含空白處理）會變成字串常數，直接看畫面上實際會有的字 */
function emit(tsx: string): string {
  const js = ts.transpileModule(tsx, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }, fileName: 'x.tsx' }).outputText
  // TypeScript 會把非 ASCII 字元輸出成 \uXXXX；還原成字才讀得懂
  return js.replace(/\\u([0-9A-Fa-f]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}
const wrap = (body: string): string => `export const X = () => (\n  <p>\n${body}\n  </p>\n)\n`

describe('JSX 的空白語意（偵測規則的前提）', () => {
  it('多行文字的換行會被接成「一個空格」；緊鄰標籤的換行整個消失', () => {
    expect(emit(wrap('    做對，\n    但不能取代'))).toContain('"做對， 但不能取代"')
    expect(emit(wrap('    中文\n    <b>粗</b>\n    中文'))).toMatch(/children: \["中文", _jsx\("b", \{ children: "粗" \}\), "中文"\]/)
  })
})

describe('classifyBreak：哪些換行的空格是多餘的', () => {
  it('中文／全形標點的兩側 → 多餘', () => {
    expect(classifyBreak('字', '字')).toBe('han-han')
    expect(classifyBreak('，', '但')).toBe('fw-han')
    expect(classifyBreak('字', '（')).toBe('han-fw')
    expect(classifyBreak('。', '「')).toBe('fw-fw')
    // ——、……、⋯⋯ 和中文接在一起時也是中文標點
    expect(classifyBreak('—', '正')).toBe('cjkp-han')
    expect(classifyBreak('字', '…')).toBe('han-cjkp')
  })

  it('全形標點與拉丁字母／數字之間 → 多餘（全形標點本身已帶空白）', () => {
    expect(classifyBreak('。', 'l')).toBe('fw-other')
    expect(classifyBreak('：', 'D')).toBe('fw-other')
    expect(classifyBreak('t', '（')).toBe('other-fw')
    expect(classifyBreak('4', '（')).toBe('other-fw')
  })

  it('拉丁字母／數字與中文之間的空格是本站的排版慣例 → 保留', () => {
    expect(classifyBreak('t', '字')).toBeNull()
    expect(classifyBreak('字', 'D')).toBeNull()
    expect(classifyBreak('字', '3')).toBeNull()
    expect(classifyBreak('a', 'b')).toBeNull()
    expect(classifyBreak(')', '字')).toBeNull()
    // — … 在拉丁字母旁邊就是一般的標點，不處理
    expect(classifyBreak('—', 'a')).toBeNull()
    expect(classifyBreak('a', '…')).toBeNull()
  })
})

describe('findCjkBreaks / fixCjkBreaks', () => {
  it('偵測中文之間與「全形標點＋拉丁字母」的換行，並回報行列與兩側字元', () => {
    const src = wrap('    開始修。\n    下面兩個方塊，\n    learning rate\n    GMAC（\n    comparator）')
    const found = findCjkBreaks(src)
    expect(found.map((b) => [b.left, b.right, b.kind])).toEqual([
      ['。', '下', 'fw-han'],
      ['，', 'l', 'fw-other'],
      ['（', 'c', 'fw-other'],
    ])
    expect(found[0].line).toBe(3)
    // [start, end) 只含空白（行尾空白、換行、下一行的縮排）
    for (const b of found) expect(src.slice(b.start, b.end)).toMatch(/^\s+$/)
  })

  it('修正：只拿掉那段空白，非空白字元一個都不變；修完再掃是空的；再修一次不會再動', () => {
    const src = wrap('    開始修。\n    下面兩個方塊，\n    learning rate 與 DTC\n    gain\n    GMAC（\n    comparator）\n    字\n    字')
    const { text, count } = fixCjkBreaks(src)
    expect(count).toBe(5)
    expect(text.replace(/\s+/g, '')).toBe(src.replace(/\s+/g, ''))
    expect(findCjkBreaks(text)).toEqual([])
    expect(fixCjkBreaks(text)).toEqual({ text, count: 0 })
    // 畫面上的字：該拿掉的空格沒了，Latin 之間（與 Latin／中文之間）的空格還在
    const out = emit(text)
    expect(out).toContain('開始修。下面兩個方塊，learning rate 與 DTC gain GMAC（comparator）字字')
  })

  it('不動：中文與拉丁字母之間、緊鄰標籤或 {…} 的換行、明確的 {\' \'}', () => {
    const src = wrap(
      [
        '    這是 reference',
        '    輸入端，',
        '    <b>粗</b>，',
        '    {x}',
        '    中文{\' \'}',
        '    中文',
        '    <i>斜</i>',
      ].join('\n'),
    )
    expect(findCjkBreaks(src)).toEqual([])
    // 畫面：標籤旁的換行不產生空格；{' '} 保留；中文與拉丁字母之間的空格保留
    expect(emit(src)).toContain('"這是 reference 輸入端，"')
  })

  it('同一行裡全形結尾標點後面多打的空格 → 偵測並拿掉；標籤前的空格（徽章與句子的間隔）、行尾空白、{\' \'} 不動', () => {
    const kinds = (line: string) => findCjkBreaks(wrap(`    ${line}`)).map((b) => [b.left, b.right, b.kind])
    expect(kinds('把校正拿掉。 例：4-bit 的 <code>0101</code>')).toEqual([['。', '例', 'typed-fw']])
    expect(kinds('（見 §3）； 下一項')).toEqual([['；', '下', 'typed-fw']])
    expect(kinds('主角： GMAC')).toEqual([['：', 'G', 'typed-fw']])
    // 不算：標籤或 {…} 前面的空格（把徽章和句子隔開）、行尾空白、明確的 {' '}、標點前面的空格
    expect(kinds('句子結束。 <ClaimTag kind="exact" />')).toEqual([])
    expect(kinds('<b>粗</b>。 <i>斜</i>')).toEqual([])
    expect(kinds('行尾空白。   ')).toEqual([])
    expect(kinds("中文，{' '}再來")).toEqual([])
    expect(kinds('數字 ，逗號')).toEqual([])

    const src = wrap('    把校正拿掉。 例：4-bit，\n    （見 §3）； 下一項')
    const { text, count } = fixCjkBreaks(src)
    expect(count).toBe(3) // 。␣例、，⏎（、；␣下
    expect(text.replace(/\s+/g, '')).toBe(src.replace(/\s+/g, ''))
    expect(findCjkBreaks(text)).toEqual([])
    expect(emit(text)).toContain('把校正拿掉。例：4-bit，（見 §3）；下一項')
    expect(emit(wrap("    句子結束。 <ClaimTag />"))).toContain('"句子結束。 "')
  })

  it('「空格＋破折號」的寫法：破折號前面已有空格時，換行（或標點後）的那個空格是對稱的右空格，不動', () => {
    const kinds = (body: string) => findCjkBreaks(wrap(body)).map((b) => [b.left, b.right, b.kind])
    // Ch11 的寫法「節點 —— 寫成」：接起來會變成「節點 ——寫成」，所以要留
    expect(kinds('    同一個節點 ——\n    寫成五項的和')).toEqual([])
    expect(kinds('    同一個節點\n    —— 寫成五項的和')).toEqual([])
    expect(kinds('    共用的 offset ……\n    迴路照樣穩定')).toEqual([])
    expect(kinds('    「引文」 —— 字')).toEqual([])
    expect(emit(wrap('    同一個節點 ——\n    寫成'))).toContain('"同一個節點 —— 寫成"')
    // 沒有空格的破折號照規則接起來：「範圍——⏎有連續」→「範圍——有連續」
    expect(kinds('    不是軌跡的範圍——\n    有連續雜訊時')).toEqual([['—', '有', 'cjkp-han']])
    expect(kinds('    「引文」 ——字')).toEqual([['」', '—', 'typed-fw']])
    expect(emit(fixCjkBreaks(wrap('    不是軌跡的範圍——\n    有連續雜訊時')).text)).toContain('"不是軌跡的範圍——有連續雜訊時"')
  })

  it('只看 JSX 文字：模板字串、引號字串、props、註解、一般程式碼裡的換行都不算', () => {
    const src = [
      'const a = `中文，',
      '  中文`',
      'const b = "中文" +',
      '  "中文"',
      '// 中文，',
      '// 中文',
      '/* 中文，',
      '   中文 */',
      'export const X = () => (',
      '  <p title="中文，',
      '    中文" data-x={`中文，',
      '    中文`}>',
      '    {/* 中文，',
      '        中文 */}',
      '    <code>{`中文，',
      '    中文`}</code>',
      '  </p>',
      ')',
    ].join('\n')
    expect(findCjkBreaks(src)).toEqual([])
  })

  it('巢狀元素裡的文字、Fragment、換行後接著 {…} 前的最後一行都照規則處理', () => {
    const src = wrap('    <b>\n      粗體，\n      仍然\n    </b>\n    <>\n      片段。\n      接著\n    </>')
    expect(findCjkBreaks(src).map((b) => b.kind)).toEqual(['fw-han', 'fw-han'])
  })
})

describe('全站原始碼：JSX 換行不可在中文之間留下空格', () => {
  const files = listTsx(['src'])

  it('掃描範圍包含所有章節與頁面（路徑寫錯就會變成什麼都沒掃到）', () => {
    expect(DEFAULT_SCAN_ROOTS).toEqual(['src'])
    expect(files.length).toBeGreaterThan(300)
    expect(files.some((f) => f.includes('/src/chapters/ch06/index.tsx'))).toBe(true)
    expect(files.some((f) => f.includes('/src/pages/signoff/'))).toBe(true)
    expect(files.some((f) => f.endsWith('.test.tsx'))).toBe(false)
  })

  it('JSX 文字裡「空格＋破折號」後面一定也有空格（接行時不可把「節點 ——⏎寫成」變成「節點 ——寫成」）', () => {
    // 畫面上的字：每行去頭尾空白、用一個空格接起來（第一行的開頭、最後一行的結尾保留，那是緊鄰標籤的空格）
    const rendered = (raw: string): string => {
      const lines = raw.split(/\r?\n/)
      return lines
        .map((l, i) => (i === 0 ? l.replace(/\s+$/, '') : i === lines.length - 1 ? l.replace(/^\s+/, '') : l.trim()))
        .filter((l) => l.length)
        .join(' ')
    }
    const bad: string[] = []
    for (const abs of files) {
      const src = readFileSync(abs, 'utf8')
      const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const visit = (node: ts.Node): void => {
        if (node.kind === ts.SyntaxKind.JsxText) {
          const text = rendered(src.slice(node.pos, node.end))
          const m = /(?:^|\S) \u2014+(?=[^\s\u2014])/.exec(text)
          if (m) bad.push(`${abs.replace(/^.*\/src\//, 'src/')}:${sf.getLineAndCharacterOfPosition(node.pos).line + 1}  ${text.slice(Math.max(0, m.index - 8), m.index + m[0].length + 8)}`)
          return
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
    }
    expect(bad).toEqual([])
  })

  it('沒有任何違規（出現時：node scripts/check-cjk-spaces.mjs --fix）', () => {
    const found = scanFiles(files)
    const lines = found.flatMap((f) => f.breaks.map((b) => `${f.file}:${b.line}:${b.col}  「${b.left}」|「${b.right}」 ${b.kind}`))
    expect(lines.slice(0, 30), `共 ${lines.length} 處多餘的換行空白；執行 node scripts/check-cjk-spaces.mjs --fix 可自動接起來`).toEqual([])
  })
})
