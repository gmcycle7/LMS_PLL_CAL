import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SIX_CONDITIONS } from './data'

/**
 * 條件編號圓章（Hero 的膠囊 .dash-pill-n、條件卡片的 .dash-cond-n）的對比度。
 * 序列色（--series-n）是給圖形用的，白字在 series-3／4／6 只有 3.4／2.3／3.7:1，所以圓章改成「條件色的外框＋淡底」，數字用一般文字色（--text）；
 * 這裡直接解析 global.css 的 token 與 dashboard.css 的規則，兩個主題、六個條件逐一驗證數字對淡底 ≥ 4.5:1，
 * 並確認沒有人把白字（#fff）或條件色填滿的寫法改回去。狀態圓章（.dash-state）也一併檢查：白字對 --ok／--warn／--danger（深色主題用 --bg）。
 */
const root = process.cwd()
// @import 行也拿掉：global.css 第一行是 `@import './tokens.css';`，留著會被當成下一個選擇器的前綴
const read = (rel: string) => readFileSync(join(root, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '')

/** 取出 `selector { … }` 的宣告（selector 以字串精確比對，空白正規化） */
function declsOf(css: string, selector: string): Record<string, string>[] {
  const out: Record<string, string>[] = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].replace(/\s+/g, ' ').trim()
    if (sel !== selector) continue
    const decls: Record<string, string> = {}
    for (const d of m[2].split(';')) {
      const k = d.indexOf(':')
      if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim()
    }
    out.push(decls)
  }
  return out
}

type Theme = 'light' | 'dark'
function tokens(): Record<Theme, Record<string, string>> {
  const css = read('src/styles/global.css')
  const light = Object.assign({}, ...declsOf(css, ':root'))
  const dark = { ...light, ...Object.assign({}, ...declsOf(css, ":root[data-theme='dark']")) }
  return { light, dark }
}

const rgb = (hex: string): [number, number, number] => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`not #rrggbb: ${hex}`)
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number]
}
const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lum = (c: [number, number, number]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
/** color-mix(in srgb, fg pct%, bg) */
const mix = (fg: [number, number, number], bg: [number, number, number], pct: number): [number, number, number] =>
  [0, 1, 2].map((i) => fg[i] * (pct / 100) + bg[i] * (1 - pct / 100)) as [number, number, number]

describe('條件編號圓章與狀態圓章的對比度', () => {
  const css = read('src/pages/dashboard/dashboard.css')
  const t = tokens()
  const badge = declsOf(css, '.dash-pill-n, .dash-cond-n')

  it('圓章的規則：條件色（--cond-c）外框、條件色對 --surface 的淡底、數字用 --text；沒有白字', () => {
    expect(badge).toHaveLength(1)
    const d = badge[0]
    expect(d.color).toBe('var(--text)')
    expect(d.border).toBe('2px solid var(--cond-c)')
    expect(d.background).toMatch(/^color-mix\(in srgb, var\(--cond-c\) \d+%, var\(--surface\)\)$/)
    // 兩個圓章的其他規則（尺寸）不得再把顏色設回白字或條件色填滿
    for (const sel of ['.dash-pill-n', '.dash-cond-n', ":root[data-theme='dark'] .dash-pill-n", ":root[data-theme='dark'] .dash-cond-n"]) {
      for (const dd of declsOf(css, sel)) {
        expect(dd.color ?? 'var(--text)', sel).not.toMatch(/#fff|white|--accent-text|--bg/i)
        expect(dd.background ?? 'x', sel).not.toBe('var(--cond-c)')
      }
    }
    // 兩個地方都有提供 --cond-c（Hero 的膠囊、條件卡片）
    expect(readFileSync(join(root, 'src/pages/dashboard/sections/Hero.tsx'), 'utf8')).toContain("'--cond-c': `var(${c.color})`")
    expect(readFileSync(join(root, 'src/pages/dashboard/sections/Thesis.tsx'), 'utf8')).toContain("'--cond-c': `var(${c.color})`")
  })

  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}：六個條件色的淡底與 --text 的對比 ≥ 4.5:1（數字清楚可讀）`, () => {
      const pct = Number(/(\d+)%/.exec(badge[0].background)?.[1])
      expect(pct).toBeGreaterThan(0)
      expect(pct).toBeLessThanOrEqual(25) // 淡底：條件色最多佔四分之一
      expect(SIX_CONDITIONS.map((c) => c.color)).toEqual(['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6'])
      for (const c of SIX_CONDITIONS) {
        const bg = mix(rgb(t[theme][c.color]), rgb(t[theme]['--surface']), pct)
        const ratio = contrast(rgb(t[theme]['--text']), bg)
        expect(ratio, `${theme} 條件 ${c.n}（${c.color} ${t[theme][c.color]}）= ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`${theme}：狀態圓章（✓ ! ✗）：${theme === 'light' ? '白字' : '--bg'}對 --ok／--warn／--danger ≥ 4.5:1`, () => {
      const base = declsOf(css, '.dash-state')[0]
      expect(base.color).toBe('#fff')
      const ink = theme === 'light' ? rgb('#ffffff') : rgb(t.dark['--bg'])
      if (theme === 'dark') expect(declsOf(css, ":root[data-theme='dark'] .dash-state")[0].color).toBe('var(--bg)')
      for (const tok of ['--ok', '--warn', '--danger']) {
        const ratio = contrast(ink, rgb(t[theme][tok]))
        expect(ratio, `${theme} ${tok} ${t[theme][tok]} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})
