/**
 * Mermaid 11 會把節點／連線標籤當成 Markdown 處理：單獨一個半形「+」或「-」，或以「+ 」「- 」「* 」開頭的標籤，
 * 會被當成清單而畫成「Unsupported markdown: list」。語法 parser 不會報錯，只有真的 render 才看得到。
 * 這裡在送進 Mermaid 之前把這些標籤換成不會觸發 Markdown 的字元（全形「＋」、減號「−」U+2212、「∗」）。
 * 純函式；`Mermaid` 元件與測試工具都會套用，所以各章的圖即使照舊寫 `((+))` 也畫得出來。
 */
export function sanitizeMermaidSource(chart: string): string {
  return (
    chart
      // 加法點／節點：((+))、(("+"))、((-))、(("-"))
      .replace(/\(\(\s*"?\+"?\s*\)\)/g, '(("＋"))')
      .replace(/\(\(\s*"?-"?\s*\)\)/g, '(("−"))')
      // 連線標籤：|+|、|"+"|、|-|、|"-"|
      .replace(/\|\s*"?\+"?\s*\|/g, '|"＋"|')
      .replace(/\|\s*"?-"?\s*\|/g, '|"−"|')
      // 任何「整個標籤就是 + 或 -」的雙引號字串：-- "+" -->、["+"]…
      .replace(/"\+"/g, '"＋"')
      .replace(/"-"/g, '"−"')
      // 以清單記號開頭的標籤："+ μ·e·x"、"- gδ"、"* 註"
      .replace(/"\+ /g, '"＋ ')
      .replace(/"- /g, '"− ')
      .replace(/"\* /g, '"∗ ')
  )
}

/** 圖是否含有 Mermaid 畫不出來的 Markdown 標記（給測試用）。 */
export function hasUnsupportedMarkdown(svgOrText: string): boolean {
  return /Unsupported markdown/i.test(svgOrText)
}
