/**
 * 方塊圖測試的輔助工具（只給 *.test.ts(x) 用，頁面不會匯入；Lab／Models／Dashboard／Sign-off 四頁的 diagrams 測試共用）。
 *
 * 圖原始碼裡的數學寫成 `$...$`（LaTeX），共用的 <Mermaid> 用 KaTeX 排版；因此測試要分兩層檢查：
 *  - 原始碼層級：標籤裡 `$...$` 以外的文字沒有 Unicode 拼的數學（unicodeMathInSource）；
 *  - 畫出來的結果：沒有殘留的 `$`、KaTeX 公式個數（mathCount）剛好等於含公式的標籤數、標籤的文字部分都畫出來了。
 * 含公式的標籤會被整個合併成一段 KaTeX（文字變成 \text{}），畫出來的 plainText 看不到它的文字部分，所以文字與 Unicode 檢查都在原始碼層級做。
 */
import { unicodeMathIn } from '@/components/mermaidTestUtils'

/** 與共用 Mermaid 前處理（mermaidSource.ts）相同的行內公式規則：`$...$` 或 `$$...$$`，`\$` 是字面的美元符號。 */
const MATH_SEGMENT = /\$\$((?:[^$\\]|\\.)+?)\$\$|(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

/** 圖原始碼裡所有雙引號標籤（節點、連線、subgraph 標題）。 */
export function quotedLabels(chart: string): string[] {
  return Array.from(chart.matchAll(/"([^"\n]*)"/g), (m) => m[1])
}

/** 標籤裡有沒有 `$...$`。 */
export function hasMath(label: string): boolean {
  MATH_SEGMENT.lastIndex = 0
  const found = MATH_SEGMENT.test(label)
  MATH_SEGMENT.lastIndex = 0
  return found
}

/** 含 `$...$` 的標籤個數；renderMermaidForTest 回傳的 mathCount 必須剛好等於它（每個含公式的標籤合併成一個 KaTeX 區塊）。 */
export function mathLabelCount(chart: string): number {
  return quotedLabels(chart).filter(hasMath).length
}

/** 標籤去掉 `$...$` 之後留下的文字片段（依出現順序；<br/> 當成分隔）。 */
export function textFragments(label: string): string[] {
  return label
    .replace(MATH_SEGMENT, '')
    .split(/<br\s*\/?>|/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

/**
 * 圖原始碼裡「`$...$` 以外」的文字若還有 Unicode 拼的數學（μ、≤、×、w_k、z⁻¹ …），回傳找到的片段。
 * 單位與英文單字不算；純文字的箭頭「→」與中文標點不算。
 */
export function unicodeMathInSource(chart: string): string[] {
  const hits = quotedLabels(chart).flatMap((label) => unicodeMathIn(textFragments(label).join(' ')))
  return [...new Set(hits)]
}

/** 比對用：拿掉換行標籤與空白，並還原 mermaid 在含 HTML 的標籤裡做的 entity 編碼。 */
export const plainCompare = (s: string): string =>
  s
    .replace(/<br\s*\/?>/g, '')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, '')

/**
 * 一張圖「畫得對不對」的共同斷言（renderMermaidForTest 的結果 + 圖原始碼）：
 * 沒有 Unsupported markdown、畫出來的文字沒有 `$`、KaTeX 公式個數 = 含公式的標籤數、KaTeX 以外沒有 Unicode 拼的數學（畫面與原始碼兩層），
 * 而且每個標籤的文字部分（`$...$` 以外）都原樣畫在圖上。回傳違規描述的陣列（空陣列 = 通過）。
 */
export function renderProblems(chart: string, r: { text: string; plainText: string; mathCount: number }): string[] {
  const problems: string[] = []
  if (/Unsupported markdown/i.test(r.text)) problems.push('出現 Unsupported markdown')
  if (r.text.includes('$')) problems.push('畫出來的文字殘留 `$`')
  if (r.mathCount !== mathLabelCount(chart)) problems.push(`KaTeX 公式 ${r.mathCount} 個 ≠ 含公式的標籤 ${mathLabelCount(chart)} 個`)
  const drawn = unicodeMathIn(r.plainText)
  if (drawn.length > 0) problems.push(`畫面上 KaTeX 以外還有 Unicode 數學：${drawn.join(' ')}`)
  const src = unicodeMathInSource(chart)
  if (src.length > 0) problems.push(`原始碼 \`$...$\` 以外還有 Unicode 數學：${src.join(' ')}`)
  const drawnPlain = plainCompare(r.text)
  for (const label of quotedLabels(chart)) {
    // 只有 classDef／class 這類指令列沒有標籤；其餘每個標籤的文字片段都必須畫出來
    for (const frag of textFragments(label)) {
      if (!drawnPlain.includes(plainCompare(frag))) problems.push(`標籤文字「${frag}」沒有畫在圖上`)
    }
  }
  return problems
}
