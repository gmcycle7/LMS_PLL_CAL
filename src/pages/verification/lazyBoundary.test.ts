/**
 * 三個工具型頁面（/workbook、/gallery、/verification）的「首屏模組」不能靜態 import 延後載入的部分。
 *
 * 動機：這三頁原本靜態 import 全站資料與整份原始碼，
 * 首次載入要下載 700–850 KB（gzip）才畫得出第一個字。把它們改成 dynamic import() 之後，只要有「任何一個」首屏模組
 * 又靜態 import 了它們（例如為了一個型別以外的常數、或 `import x from '…?raw'`），打包時整份又會被併回首屏 chunk，
 * 而且功能測試全部照常通過——只有首次載入的體積默默變回去。這個測試用 TypeScript 的語法樹走過首屏的靜態 import 圖，把它擋下來。
 *
 * 做法：從頁面的進入檔出發，只跟隨「靜態」import／export-from（`import type` 與 dynamic `import()` 不算），
 * 相對路徑與 `@/` 別名都解析到 src 底下的檔案；第三方套件不展開。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

interface Edge {
  /** 原始的 import 字串（含 ?raw 之類的後綴） */
  spec: string
  /** 解析到的 src 檔案；第三方套件為 null */
  file: string | null
}
interface ParsedFile {
  statics: Edge[]
  dynamics: Edge[]
}

function resolveSpec(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else return null
  base = base.replace(/\?.*$/, '')
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand
  }
  return null
}

const parsed = new Map<string, ParsedFile>()

function parse(file: string): ParsedFile {
  const hit = parsed.get(file)
  if (hit) return hit
  const out: ParsedFile = { statics: [], dynamics: [] }
  parsed.set(file, out)
  if (!/\.tsx?$/.test(file)) return out
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.importClause?.isTypeOnly) out.statics.push({ spec: node.moduleSpecifier.text, file: resolveSpec(file, node.moduleSpecifier.text) })
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) out.statics.push({ spec: node.moduleSpecifier.text, file: resolveSpec(file, node.moduleSpecifier.text) })
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      out.dynamics.push({ spec: node.arguments[0].text, file: resolveSpec(file, node.arguments[0].text) })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

interface Closure {
  /** 首屏的靜態 import 圖裡的所有 src 檔案 → 是從哪個檔案進來的（回報用） */
  files: Map<string, string | null>
  /** 圖裡每一個 `…?raw` 匯入：[匯入的檔案, 字串] */
  raws: [string, string][]
  /** 圖裡每一個 dynamic import() 的目標檔案 → 在哪個檔案裡 */
  dynamicTargets: Map<string, string[]>
}

function closureOf(entry: string): Closure {
  const files = new Map<string, string | null>([[entry, null]])
  const raws: [string, string][] = []
  const dynamicTargets = new Map<string, string[]>()
  const queue = [entry]
  while (queue.length) {
    const file = queue.shift()!
    const p = parse(file)
    for (const e of p.statics) {
      if (/\?raw$/.test(e.spec)) raws.push([file, e.spec])
      if (e.file && !files.has(e.file)) {
        files.set(e.file, file)
        queue.push(e.file)
      }
    }
    for (const e of p.dynamics) {
      if (e.file) dynamicTargets.set(e.file, [...(dynamicTargets.get(e.file) ?? []), file])
    }
  }
  return { files, raws, dynamicTargets }
}

const rel = (f: string) => relative(ROOT, f)

/** file 是怎麼被首屏圖拉進來的：entry → … → file */
function chain(c: Closure, file: string): string {
  const out: string[] = []
  for (let cur: string | null | undefined = file; cur; cur = c.files.get(cur)) out.unshift(rel(cur))
  return out.join(' → ')
}

const P = (...parts: string[]) => join(SRC, ...parts)

interface PageSpec {
  name: string
  entry: string
  /** 不可出現在首屏靜態圖裡、但必須有人用 dynamic import() 載入的檔案 */
  deferred: string[]
  /** 不可出現在首屏靜態圖裡的檔案樣式（不要求 dynamic import()） */
  forbidden?: RegExp[]
}

const PAGES: PageSpec[] = [
  {
    name: '/workbook',
    entry: P('pages', 'workbook', 'index.tsx'),
    // 全站手算題庫：連同各章 handcalcs.ts 與它們 solve() 呼叫的模型（約 600 KB gzip）
    deferred: [P('app', 'handcalcs.ts')],
    forbidden: [/src\/chapters\/[^/]+\/handcalcs\.ts$/, /src\/pages\/[^/]+\/handcalcs\.ts$/],
  },
  {
    name: '/gallery',
    entry: P('pages', 'gallery', 'index.tsx'),
    // previews.ts 連同十幾個模型模組、§7 的原始碼文字、數值驗算表
    deferred: [
      P('pages', 'gallery', 'sections', 'Inspector.tsx'),
      P('pages', 'gallery', 'sections', 'CodeSection.tsx'),
      P('pages', 'gallery', 'sections', 'PreviewPanel.tsx'),
      P('pages', 'gallery', 'sections', 'UnifiedCheck.tsx'),
    ],
    forbidden: [/src\/pages\/gallery\/previews\.ts$/],
  },
  {
    name: '/verification',
    entry: P('pages', 'verification', 'index.tsx'),
    deferred: [
      P('pages', 'verification', 'sections', 'MonteCarloLabBody.tsx'),
      P('pages', 'verification', 'sections', 'NegativeTestsBody.tsx'),
      P('pages', 'verification', 'sections', 'HowItWorksBody.tsx'),
      P('pages', 'verification', 'sections', 'ErrataBrowserBody.tsx'),
      P('pages', 'verification', 'sections', 'AcceptanceRegion.tsx'),
    ],
    // 這幾個檔案只被延後載入的區塊使用：被首屏模組靜態 import 就等於又併回首屏
    forbidden: [/sections\/McSweepLab\.tsx$/, /sections\/McTheory\.tsx$/],
  },
]

describe.each(PAGES)('首屏模組不靜態 import 延後載入的部分：$name', (page) => {
  const c = closureOf(page.entry)

  it('進入檔存在，而且首屏圖不是空的（解析器真的走過了 import）', () => {
    expect(existsSync(page.entry)).toBe(true)
    expect(c.files.size).toBeGreaterThan(20)
    // 抽樣：頁面一定會用到的共用元件有被走到
    expect([...c.files.keys()].some((f) => /src\/components\/index\.ts$/.test(f))).toBe(true)
  })

  it.each(page.deferred.map((f) => [rel(f), f]))('延後載入：%s 不在首屏的靜態 import 圖裡，而且有人用 import() 載入它', (_name, file) => {
    expect(existsSync(file), `${rel(file)} 不存在`).toBe(true)
    expect(c.files.has(file), `首屏靜態 import 了它：${chain(c, file)}`).toBe(false)
    expect(c.dynamicTargets.get(file)?.length ?? 0, `沒有任何首屏模組用 import() 載入 ${rel(file)}（區塊變成永遠不會出現）`).toBeGreaterThanOrEqual(1)
  })

  it('其他不可進首屏的檔案', () => {
    for (const f of c.files.keys()) {
      for (const re of page.forbidden ?? []) expect(re.test(f), `首屏靜態 import 了 ${rel(f)}：${chain(c, f)}`).toBe(false)
    }
  })

  it('首屏沒有任何 `…?raw` 匯入（整份原始碼文字要跟著延後載入的區塊走）', () => {
    expect(c.raws.map(([f, s]) => `${rel(f)} → ${s}`)).toEqual([])
  })
})

describe('解析器本身', () => {
  it('跟隨 `export … from`，略過 `import type` 與 dynamic import()', () => {
    // verification/index.tsx 用 dynamic import() 載入 sections 的 Body，所以這些檔案只出現在 dynamicTargets
    const c = closureOf(P('pages', 'verification', 'index.tsx'))
    const body = P('pages', 'verification', 'sections', 'ErrataBrowserBody.tsx')
    expect(c.files.has(body)).toBe(false)
    expect(c.dynamicTargets.get(body)).toEqual([P('pages', 'verification', 'sections', 'ErrataBrowser.tsx')])
    // 型別匯入不算：workbook/index.tsx 只用 `import type { HandCalcDef } from '@/data/types'`
    const wb = closureOf(P('pages', 'workbook', 'index.tsx'))
    expect(parse(P('pages', 'workbook', 'index.tsx')).statics.some((e) => e.spec === '@/data/types')).toBe(false)
    expect(wb.files.size).toBeGreaterThan(0)
  })

  it('題庫的載入函式（bank.ts）自己只有 dynamic import()：它的首屏圖不含題庫', () => {
    const viaBank = closureOf(P('pages', 'workbook', 'bank.ts'))
    expect(viaBank.files.has(P('app', 'handcalcs.ts'))).toBe(false)
    expect(viaBank.dynamicTargets.has(P('app', 'handcalcs.ts'))).toBe(true)
    // handcalcs.ts 用 import.meta.glob 收集各章（不是 import 語句）：所以必須擋住 handcalcs.ts 本身，擋不到各章檔案
    expect(readFileSync(P('app', 'handcalcs.ts'), 'utf8')).toMatch(/import\.meta\.glob(?:<[^>]*>)?\(/)
  })
})
