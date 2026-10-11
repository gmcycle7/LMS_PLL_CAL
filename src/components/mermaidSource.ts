/**
 * Mermaid 11 會把節點／連線標籤當成 Markdown 處理：單獨一個半形「+」或「-」，或以「+ 」「- 」「* 」開頭的標籤，
 * 會被當成清單而畫成「Unsupported markdown: list」。語法 parser 不會報錯，只有真的 render 才看得到。
 * 這裡在送進 Mermaid 之前把這些標籤換成不會觸發 Markdown 的字元（全形「＋」、減號「−」U+2212、「∗」）。
 * 純函式；`Mermaid` 元件與測試工具都會套用，所以各章的圖即使照舊寫 `((+))` 也畫得出來。
 */
export function sanitizeMermaidSource(chart: string): string {
  return (
    mermaidMathDelimiters(chart)
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

const MATH_SEGMENT = /\$\$((?:[^$\\]|\\.)+?)\$\$|(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
const LINE_BREAK = /<br\s*\/?>/gi

/** 把一般文字包成 KaTeX 的 \text{…}（跳脫 TeX 的特殊字元）。 */
function texText(text: string): string {
  if (text === '') return ''
  const escaped = text
    .replace(/\\\$/g, '$')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([{}%#&_$])/g, '\\$1')
    .replace(/\^/g, '\\^{}')
    .replace(/~/g, '\\textasciitilde{}')
  return `\\text{${escaped}}`
}

/** 一行標籤（可混合文字與 `$...$`）→ 一段 TeX。 */
function lineToTex(line: string): string {
  let out = ''
  let last = 0
  for (const m of line.matchAll(MATH_SEGMENT)) {
    const start = m.index ?? 0
    out += texText(line.slice(last, start)) + (m[1] ?? m[2])
    last = start + m[0].length
  }
  return out + texText(line.slice(last))
}

/**
 * 全站字串裡的行內公式都寫 `$...$`；Mermaid 的 KaTeX 語法是 `$$...$$`，而且 Mermaid 11 一個標籤只認得「一段」公式
 * （它用貪婪的 /\$\$(.*)\$\$/ 比對，兩段以上或跨行會被黏成一段而出錯）。
 * 這裡把每個含公式的雙引號標籤整個合併成單一的 `$$...$$`：文字部分包成 \text{…}，
 * 用 <br/> 分行的標籤改用 gathered 環境逐行排列。所以圖的原始碼可以和其他地方一樣寫
 *   A["誤差 $e[n] = y[n] - \hat y[n]$<br/>再乘上 $\mu$"]
 */
export function mermaidMathDelimiters(chart: string): string {
  return chart.replace(/"([^"\n]*)"/g, (whole, label: string) => {
    MATH_SEGMENT.lastIndex = 0
    if (!MATH_SEGMENT.test(label)) return whole
    MATH_SEGMENT.lastIndex = 0
    const lines = label.split(LINE_BREAK).map(lineToTex)
    // 換行用 \\cr：Mermaid 處理標籤時會把連續兩個反斜線收成一個，所以不能用 TeX 的 \\\\
    const tex = lines.length === 1 ? lines[0] : `\\begin{gathered}${lines.join('\\cr ')}\\end{gathered}`
    return `"$$${tex}$$"`
  })
}

/**
 * Mermaid 產生的 SVG 是 width=100%、max-width=自然寬度：容器比圖窄時會等比縮小，手機上寬圖會縮到看不清楚。
 * 這裡依 viewBox 的自然寬度加上 min-width（自然寬度的 70%，至少 480px，但不超過自然寬度），
 * 讓圖在窄螢幕改為在自己的容器（overflow-x: auto）內橫向捲動，字不會小於約 11px。
 */
export function withReadableMinWidth(svg: string): string {
  const open = /^<svg\b[^>]*>/.exec(svg)
  if (!open) return svg
  const vb = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) [\d.]+"/.exec(open[0])
  if (!vb) return svg
  const natural = Number(vb[1])
  if (!Number.isFinite(natural) || natural <= 0) return svg
  const min = Math.round(Math.min(natural, Math.max(natural * 0.7, 480)))
  const tag = /style="([^"]*)"/.test(open[0])
    ? open[0].replace(/style="([^"]*)"/, (_, st: string) => `style="${st.trim().replace(/;?$/, ';')} min-width: ${min}px;"`)
    : open[0].replace(/^<svg\b/, `<svg style="min-width: ${min}px;"`)
  return tag + svg.slice(open[0].length)
}
