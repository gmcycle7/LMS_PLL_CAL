import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * 站內不能再有會被 HashRouter 當成路由的 `<a href="#…">`：
 *   '#formula-F-05.1'、'#ch14-budget' 這種 hash 會讓整頁變成「找不到此頁面」（全站曾有 243 個公式連結壞掉）。
 * 公式 ID 用 <FormulaLink>，頁內錨點用 <AnchorLink>，章節交叉參照用 <ChRef>。
 * 路由連結 '#/ch/05' 與 '#/formulas?f=…' 以 '#/' 開頭，不在此限。
 */
const SRC = join(process.cwd(), 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) out.push(p)
  }
  return out
}

/** 去掉註解（註解裡常常正好在解釋 href="#id" 為什麼不能用）；`//` 只在前面是空白或行首時才算註解，避免誤砍 'https://' */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

/** 開頭是 '#'、第二個字元不是 '/' 的 href（字串、JSX 運算式、樣板字串）。樣板字串 `#${to}` 的 to 是路由（'/ch/05'），不算 */
const RAW_HASH_HREF = /href=(?:"#(?!\/)[^"]*"|'#(?!\/)[^']*'|\{\s*`#(?![/$])[^`]*`\s*\}|\{\s*"#(?!\/)[^"]*"\s*\}|\{\s*'#(?!\/)[^']*'\s*\})/g

describe('沒有會被 HashRouter 當成路由的頁內 href', () => {
  const files = walk(SRC)

  it('檔案數合理（掃描真的有跑）', () => {
    expect(files.length).toBeGreaterThan(300)
  })

  it('公式錨點：沒有任何 href="#formula-…"', () => {
    const hits: string[] = []
    for (const f of files) {
      const src = stripComments(readFileSync(f, 'utf8'))
      for (const m of src.matchAll(/href=(?:\{\s*)?[`"']#formula-/g)) hits.push(`${relative(SRC, f)}: ${m[0]}`)
    }
    expect(hits).toEqual([])
  })

  it('其他頁內錨點（#id）也沒有，除了還沒改的例外（改成 <AnchorLink> 之後就從清單拿掉）', () => {
    // 目前沒有例外（ch14 的 HandLink 已改用 @/components 的 HandLink）
    const PENDING = new Set<string>()
    const hits: string[] = []
    for (const f of files) {
      const rel = relative(SRC, f)
      if (PENDING.has(rel)) continue
      const src = stripComments(readFileSync(f, 'utf8'))
      for (const m of src.matchAll(RAW_HASH_HREF)) hits.push(`${rel}: ${m[0]}`)
    }
    expect(hits).toEqual([])
  })
})
