/**
 * 從原始碼字串擷取 `#region core:<name>` … `#endregion` 段落。
 * 頁面顯示的程式碼必須就是網站實際執行的程式碼（docs/teaching-style.md §4），
 * 所以章節以 `import src from '@/simulation/models/lms.ts?raw'` 取得原始檔，再用 region 名稱擷取。
 *
 * 支援的標記（TypeScript / Python 皆可）：
 *   // #region core:signErrorStep      # region core:sign_error_step
 *   ...                                 ...
 *   // #endregion                       # endregion
 */

const START = /^\s*(?:\/\/|#)\s*#?region\s+core:([\w.-]+)\s*$/
const END = /^\s*(?:\/\/|#)\s*#?endregion\b.*$/

/** 列出原始碼中所有 core region 名稱（依出現順序）。 */
export function listRegions(source: string): string[] {
  const names: string[] = []
  for (const line of source.split('\n')) {
    const m = START.exec(line)
    if (m) names.push(m[1])
  }
  return names
}

/**
 * 擷取指定 region（不含標記行），並移除共同縮排。
 * region 內若有巢狀的其他 region 標記，標記行會被略去但內容保留。
 * 找不到時丟出錯誤（讓開發時就發現名稱打錯，而不是默默顯示空白）。
 */
export function extractRegion(source: string, name: string): string {
  const lines = source.split('\n')
  let depth = 0
  let capturing = false
  const out: string[] = []
  for (const line of lines) {
    const start = START.exec(line)
    if (start) {
      if (capturing) {
        depth++
        continue
      }
      if (start[1] === name) {
        capturing = true
        depth = 0
      }
      continue
    }
    if (END.test(line) && capturing) {
      if (depth === 0) return dedent(out).join('\n')
      depth--
      continue
    }
    if (capturing) out.push(line)
  }
  if (capturing) throw new Error(`程式碼 region「${name}」缺少 #endregion`)
  throw new Error(`找不到程式碼 region「core:${name}」`)
}

function dedent(lines: string[]): string[] {
  while (lines.length && lines[0].trim() === '') lines.shift()
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  const indents = lines.filter((l) => l.trim() !== '').map((l) => /^\s*/.exec(l)![0].length)
  const cut = indents.length ? Math.min(...indents) : 0
  return lines.map((l) => l.slice(cut))
}

/** 標示差異行的註解標記：程式碼行內含 `← 差異` 會被高亮。 */
export const DIFF_MARKER = '← 差異'

/** 回傳含差異標記的行號（1-based）。 */
export function diffLines(code: string): number[] {
  return code
    .split('\n')
    .map((l, i) => (l.includes(DIFF_MARKER) ? i + 1 : 0))
    .filter((n) => n > 0)
}
