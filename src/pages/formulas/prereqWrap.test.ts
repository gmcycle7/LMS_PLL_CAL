/**
 * 公式頁兩欄並排的先備知識（.fr-prereq-row）：桌機上每欄只有 420px 左右，裡面的獨立公式比欄位寬兩三百 px；
 * 這一排不分螢幕寬度都讓 KaTeX 換行，不放橫向捲軸（使用者要求：沒有用途的捲軸拿掉）。
 * 表格儲存格裡的公式（.fr-table td .katex）也允許換行：公式登錄表改成固定版面的兩欄之後，公式欄的寬度不再由最寬的那條公式決定
 * （原本整張表因此撐成內容欄的 1.4 倍、右邊兩欄被切在畫面外）；符號表與速查表也靠它把表寬縮回內容欄內。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/pages/formulas/formulas.css'), 'utf8')
const unconditional = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')

describe('公式頁：先備知識那一排的公式換行而不是橫向捲動', () => {
  it('.fr-prereq-row 裡的 TexBlock 不分螢幕寬度都允許 KaTeX 換行', () => {
    const rule = /\.fr \.fr-prereq-row \.c-texblock-math \.katex-display > \.katex \{([^}]*)\}/.exec(unconditional)?.[1] ?? ''
    expect(rule).toMatch(/white-space:\s*normal/)
  })

  it('範圍：整頁的 TexBlock 只在手機換行；表格儲存格（td）裡的公式在所有寬度都可以換行', () => {
    expect(unconditional).not.toMatch(/\.fr \.c-texblock-math \.katex-display > \.katex[^>{]*\{[^}]*white-space:\s*normal/)
    expect(unconditional).toMatch(/\.fr-table td \.katex \{[^}]*white-space:\s*normal/)
    expect(unconditional).not.toMatch(/\.fr-table th[^{]*katex[^{]*\{[^}]*white-space:\s*normal/) // 表頭只放欄名，不套用
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\.fr \.c-step-tex \.katex-display > \.katex,\s*\.fr \.c-texblock-math \.katex-display > \.katex \{\s*white-space: normal;/)
    expect(readFileSync(resolve(process.cwd(), 'src/pages/formulas/sections/SymbolsSection.tsx'), 'utf8')).toContain('className="fr-prereq-row"')
  })
})
