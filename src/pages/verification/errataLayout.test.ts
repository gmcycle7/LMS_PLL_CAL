/**
 * 勘誤的「規格原文／網站採用的修正」對照：上下排、不放橫向捲軸（使用者要求：沒有用途的捲軸拿掉）。
 * 並排時每格在 1280px 的桌機上只有 417px，49 則勘誤有 58 條式子比格子寬（每格底下一條橫向捲軸、式子被切掉）；
 * 改成上下排、桌機上再讓少數仍然太長的等式鏈換行之後，95 格全部沒有橫向捲動（瀏覽器實測）。
 * 版面只能在瀏覽器驗證；這裡固定住 CSS，避免被改回並排。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/pages/verification/verification.css'), 'utf8')

describe('驗證頁：勘誤的公式對照不橫向捲動', () => {
  it('對照的兩格上下排（單欄），不是 auto-fit 的並排', () => {
    const grid = /\.ver-em-grid \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(grid).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/)
    expect(grid).not.toMatch(/auto-fit|320px/)
  })

  it('桌機上，格子裡仍然太長的式子在最外層的等號／運算子後換行；手機維持原樣（規則包在 min-width 裡）', () => {
    const block = /@media \(min-width: 641px\) \{\s*\.ver-em-cell \.c-texblock-math \.katex-display > \.katex \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(block).toMatch(/white-space:\s*normal/)
    // 不分寬度的規則裡沒有這一條（手機不受影響），也沒有擴大到整頁
    const unconditional = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    expect(unconditional).not.toMatch(/katex-display > \.katex[^{]*\{[^}]*white-space:\s*normal/)
  })

  it('兩格都還在：ErrataBrowserBody 仍然用 .ver-em-grid 包住「規格原文」與「網站採用的修正」', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/pages/verification/sections/ErrataBrowserBody.tsx'), 'utf8')
    expect(src).toContain('className="ver-em-grid"')
    expect(src).toContain('規格原文')
    expect(src).toContain('網站採用的修正')
  })
})
