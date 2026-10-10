/**
 * 從 Python 原始檔擷取一個頂層函式：自 `def name(` 起，到函式本體之後的下一個頂層敘述之前
 * （尾端的空行去掉；多行簽名 `def f(\n  …\n) -> T:` 也支援）。
 *
 * golden/ 的檔案沒有 `# region core:*` 標記（本章不能修改 golden/），所以改用函式名稱擷取——
 * 頁面顯示的仍然是實際執行的原始碼，不是另外手寫的示意版。找不到時回傳一行說明，不默默顯示空白。
 */
export function pyFunction(source: string, name: string): string {
  const lines = source.split('\n')
  const start = lines.findIndex((l) => l.startsWith(`def ${name}(`))
  if (start < 0) return `# 找不到 def ${name}(…)：golden 原始檔已變更`
  // 簽名結束的那一行（以 ':' 結尾）
  let sigEnd = start
  while (sigEnd < lines.length - 1 && !lines[sigEnd].trimEnd().endsWith(':')) sigEnd++
  let end = lines.length
  for (let i = sigEnd + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) {
      end = i
      break
    }
  }
  const body = lines.slice(start, end)
  while (body.length && body[body.length - 1].trim() === '') body.pop()
  return body.join('\n')
}
