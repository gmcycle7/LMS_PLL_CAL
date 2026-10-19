import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SEVERITY_VARIANT } from '@/pages/verification/common'

/**
 * 勘誤嚴重度的顏色只有一套：驗證頁的 SEVERITY_VARIANT（high→mismatch 紅、medium→erratum 琥珀描邊、low→neutral 灰）。
 * 行內「勘誤 Exx」徽章（ErratumLink／ChapterErratum／Dashboard／驗證頁的 ErratumChip）走 `c-erratum-link` 的 data-severity，
 * 顏色寫在 links/erratumLink.css；這裡逐項比對它和 components.css 裡該 Badge variant 的宣告，
 * 再比對驗證頁勘誤卡片左邊的色條（verification.css 的 .ver-erratum.sev-*）。以前 low 在行內徽章是藍色、在驗證頁是灰色。
 * 淺色與深色主題都用同一組 CSS 變數（--danger、--text-muted…，各主題在 global.css 定義），所以比對變數名稱就涵蓋兩個主題。
 */
const ROOT = process.cwd()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

interface Rule {
  selectors: string[]
  decls: Record<string, string>
}

/** 極簡 CSS 解析（只取不含巢狀的區塊；@media 內的規則也會被取出，但本測試要找的徽章規則都在最外層） */
function parse(css: string): Rule[] {
  const rules: Rule[] = []
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls: Record<string, string> = {}
    for (const d of m[2].split(';')) {
      const k = d.indexOf(':')
      if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim()
    }
    rules.push({ selectors: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')), decls })
  }
  return rules
}

const BADGE = parse(read('src/components/components.css'))
const LINK = parse(read('src/components/links/erratumLink.css'))
const VERIFICATION = parse(read('src/pages/verification/verification.css'))

const declsOf = (rules: Rule[], selector: string): Record<string, string> => {
  const found = rules.filter((r) => r.selectors.includes(selector))
  return Object.assign({}, ...found.map((r) => r.decls)) as Record<string, string>
}

/** 一個 Badge variant 的三個顏色變數與框線樣式（neutral 沒有自己的類別：就是 .c-badge 的預設值） */
function badgeColors(variant: string): Record<string, string> {
  const base = declsOf(BADGE, '.c-badge')
  const own = variant === 'neutral' ? {} : declsOf(BADGE, `.c-badge--${variant}`)
  expect(variant === 'neutral' || Object.keys(own).length > 0, `components.css 沒有 .c-badge--${variant}`).toBe(true)
  const all = { ...base, ...own }
  return { '--b-fg': all['--b-fg'], '--b-bg': all['--b-bg'], '--b-bd': all['--b-bd'], '--b-bd-style': all['--b-bd-style'] ?? 'solid' }
}

/** 行內徽章在某個嚴重度下實際生效的變數：基底 .c-badge--erratum（ErratumLink 一律帶這個類別）再疊上 data-severity 的規則 */
function linkColors(severity: string): Record<string, string> {
  const all = { ...declsOf(BADGE, '.c-badge'), ...declsOf(BADGE, '.c-badge--erratum'), ...declsOf(LINK, `a.c-erratum-link[data-severity='${severity}']`) }
  return { '--b-fg': all['--b-fg'], '--b-bg': all['--b-bg'], '--b-bd': all['--b-bd'], '--b-bd-style': all['--b-bd-style'] ?? 'solid' }
}

describe('勘誤嚴重度顏色：行內徽章、驗證頁徽章、卡片色條同一套', () => {
  it('SEVERITY_VARIANT：嚴重＝紅（mismatch）、中＝琥珀描邊（erratum）、輕微＝灰（neutral）', () => {
    expect(SEVERITY_VARIANT).toEqual({ high: 'mismatch', medium: 'erratum', low: 'neutral' })
  })

  for (const severity of ['high', 'medium', 'low'] as const) {
    it(`${severity}：行內徽章（c-erratum-link[data-severity]）的字色、底色、框色、框線樣式 = Badge variant「${SEVERITY_VARIANT[severity]}」`, () => {
      expect(linkColors(severity)).toEqual(badgeColors(SEVERITY_VARIANT[severity]))
    })

    it(`${severity}：驗證頁勘誤卡片左邊的色條 = 該 variant 的字色`, () => {
      expect(declsOf(VERIFICATION, `.ver-erratum.sev-${severity}`)['border-left-color']).toBe(badgeColors(SEVERITY_VARIANT[severity])['--b-fg'])
    })
  }

  it('行內徽章不再用藍色（--info）表示輕微；也沒有 data-severity="medium" 的覆寫（中就是琥珀基底）', () => {
    expect(JSON.stringify(LINK.filter((r) => r.selectors.some((s) => s.includes('c-erratum-link'))))).not.toContain('--info')
    expect(LINK.some((r) => r.selectors.includes("a.c-erratum-link[data-severity='medium']"))).toBe(false)
  })

  it('三種嚴重度在 Badge 上彼此不同色（沒有兩個嚴重度共用同一組顏色）', () => {
    const fg = (['high', 'medium', 'low'] as const).map((s) => linkColors(s)['--b-fg'])
    expect(new Set(fg).size).toBe(3)
  })
})
