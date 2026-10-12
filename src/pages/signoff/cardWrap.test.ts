/**
 * 兩欄卡片裡的公式不放橫向捲軸（使用者要求：沒有用途的捲軸拿掉）。
 * §1 的宣稱語句（.so-stmts）與兩處 .so-limits 在桌機上每欄只有 420px 左右，卡片裡的獨立公式比欄位寬幾十到兩百多 px；
 * 原本每張卡片底下一條橫向捲軸、式子的右半被切掉。現在這兩種卡片不分螢幕寬度都讓 KaTeX 在最外層的等號／運算子後換行。
 * 版面本身只能在瀏覽器驗證（scripts/scroll-audit.mjs）；這裡固定住規則的範圍，避免被誤刪或誤擴大到表格。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/pages/signoff/signoff.css'), 'utf8')
/** 拿掉 @media 區塊之後剩下的「不分螢幕寬度」的規則 */
const unconditional = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')

describe('Sign-off：兩欄卡片裡的公式換行而不是橫向捲動', () => {
  it('.so-stmts／.so-limits 的 TexBlock 不分螢幕寬度都允許 KaTeX 換行；換行後的行距與右側留白和手機的規則相同', () => {
    for (const card of ['.so-stmts', '.so-limits']) {
      expect(unconditional).toContain(`.so-page ${card} .c-texblock-math .katex-display > .katex`)
      expect(unconditional).toContain(`.so-page ${card} .c-texblock-math .katex-display > .katex > .katex-html > .base`)
    }
    const rule = /\.so-page \.so-stmts \.c-texblock-math \.katex-display > \.katex,\s*\.so-page \.so-limits \.c-texblock-math \.katex-display > \.katex \{([^}]*)\}/.exec(unconditional)?.[1] ?? ''
    expect(rule).toMatch(/white-space:\s*normal/)
  })

  it('這條規則只管卡片：整欄寬的公式與表格在桌機上不換行（沒有不分寬度、範圍是整頁的 white-space: normal）', () => {
    expect(unconditional).not.toMatch(/\.so-page \.c-texblock-math \.katex-display > \.katex[^>{]*\{[^}]*white-space:\s*normal/)
    expect(unconditional).not.toMatch(/table[^{]*\.katex-display > \.katex[^{]*\{[^}]*white-space:\s*normal/)
    // 手機的規則還在（整頁的 TexBlock 與推導步驟）
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\.so-page \.c-step-tex \.katex-display > \.katex,\s*\.so-page \.c-texblock-math \.katex-display > \.katex \{\s*white-space: normal;/)
  })

  it('卡片真的是用這兩個 class 包起來的', () => {
    expect(readFileSync(resolve(process.cwd(), 'src/pages/signoff/sections/S3Claims.tsx'), 'utf8')).toContain('className="so-stmts"')
    expect(readFileSync(resolve(process.cwd(), 'src/pages/signoff/sections/S6Limits.tsx'), 'utf8')).toContain('className="so-limits"')
  })
})
