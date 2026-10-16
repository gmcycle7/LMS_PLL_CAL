import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 全站樣式的回歸測試：字型、對比度、☰ 漢堡鈕的優先序、頂列選單寬度。
 * 這些都是「改了某個 token／某條規則就悄悄壞掉」的東西，肉眼不容易發現，所以直接解析 CSS 檔來驗。
 */
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

interface Rule {
  media: string | null
  selector: string
  decls: Record<string, string>
}

/** 極簡 CSS 解析：處理一層 @media（本站的 CSS 沒有更深的巢狀）；@font-face 之類的 at-rule 當成選擇器為 '@font-face' 的規則。 */
function parseCss(css: string): Rule[] {
  const out: Rule[] = []
  const walk = (src: string, media: string | null) => {
    let i = 0
    while (i < src.length) {
      const open = src.indexOf('{', i)
      if (open < 0) break
      const head = src.slice(i, open).trim()
      let depth = 1
      let j = open + 1
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++
        else if (src[j] === '}') depth--
        j++
      }
      const body = src.slice(open + 1, j - 1)
      if (head.startsWith('@media')) walk(body, head.slice('@media'.length).trim())
      else {
        const decls: Record<string, string> = {}
        for (const d of body.split(';')) {
          const k = d.indexOf(':')
          if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim()
        }
        out.push({ media, selector: head.replace(/\s+/g, ' '), decls })
      }
      i = j
    }
  }
  walk(stripComments(css), null)
  return out
}

/** 選擇器優先權（只處理本站用得到的寫法：id、class、屬性、偽類、元素）。 */
function specificity(selector: string): [number, number, number] {
  const s = selector.replace(/\[[^\]]*\]/g, '.a').replace(/::?[a-z-]+(\([^)]*\))?/g, (m) => (m.startsWith('::') ? ' x' : '.p'))
  const ids = (s.match(/#[\w-]+/g) ?? []).length
  const cls = (s.match(/\.[\w-]+/g) ?? []).length
  const el = (s.replace(/[#.][\w-]+/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length
  return [ids, cls, el]
}
const cmpSpec = (a: [number, number, number], b: [number, number, number]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

// ---------- 顏色 ----------
type Theme = 'light' | 'dark'

function tokens(): Record<Theme, Record<string, string>> {
  const rules = parseCss(read('src/styles/global.css'))
  const base = rules.find((r) => r.media === null && r.selector === ':root')!.decls
  const dark = rules.find((r) => r.media === null && r.selector === ":root[data-theme='dark']")!.decls
  const resolveAll = (map: Record<string, string>) => {
    const res = (v: string, depth = 0): string => {
      const m = v.match(/^var\((--[\w-]+)\)$/)
      if (!m) return v
      if (depth > 5 || !(m[1] in map)) throw new Error(`cannot resolve ${v}`)
      return res(map[m[1]], depth + 1)
    }
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, res(v)]))
  }
  return { light: resolveAll(base), dark: resolveAll({ ...base, ...dark }) }
}

const rgb = (hex: string): [number, number, number] => {
  const m = hex.match(/^#([0-9a-f]{6})$/i)
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`)
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number]
}
const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map(lin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
/** CIE76 色差：用來確認語法色彼此看得出差別 */
function deltaE(a: string, b: string): number {
  const lab = (hex: string) => {
    const [r, g, bl] = rgb(hex).map(lin)
    const xyz = [
      (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047,
      (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 1,
      (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883,
    ]
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    const [fx, fy, fz] = xyz.map(f)
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
  }
  const [p, q] = [lab(a), lab(b)]
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

const THEMES: Theme[] = ['light', 'dark']
/** 文字可能出現的底色：頁面、卡片、表頭／程式碼標題列、程式碼標記行（--warn-soft） */
const TEXT_BACKGROUNDS = ['--bg', '--surface', '--surface-2', '--warn-soft']
const CODE_TOKENS = ['--code-keyword', '--code-string', '--code-number', '--code-title', '--code-type', '--code-attr', '--code-comment']

describe('對比度（WCAG AA，一般文字 ≥ 4.5:1）', () => {
  const t = tokens()
  for (const theme of THEMES) {
    it(`${theme}：--text-faint／--text-muted／--text 對各種底色 ≥ 4.5:1`, () => {
      for (const fg of ['--text-faint', '--text-muted', '--text']) {
        for (const bg of TEXT_BACKGROUNDS) {
          const ratio = contrast(t[theme][fg], t[theme][bg])
          expect(ratio, `${theme} ${fg} ${t[theme][fg]} on ${bg} ${t[theme][bg]} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    it(`${theme}：語法色 --code-* 對程式碼底色（含標記行）≥ 4.5:1`, () => {
      for (const fg of CODE_TOKENS) {
        for (const bg of TEXT_BACKGROUNDS.slice(1)) {
          const ratio = contrast(t[theme][fg], t[theme][bg])
          expect(ratio, `${theme} ${fg} ${t[theme][fg]} on ${bg} ${t[theme][bg]} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    it(`${theme}：六種語法色彼此看得出差別（ΔE76 ≥ 25）`, () => {
      const six = CODE_TOKENS.filter((k) => k !== '--code-comment')
      for (let i = 0; i < six.length; i++) {
        for (let j = i + 1; j < six.length; j++) {
          const d = deltaE(t[theme][six[i]], t[theme][six[j]])
          expect(d, `${theme} ${six[i]} vs ${six[j]} ΔE=${d.toFixed(1)}`).toBeGreaterThanOrEqual(25)
        }
      }
    })
  }

  it('code.css 的 highlight.js 規則只用 --code-* 語法色（不再借用圖表序列色，那些不保證對文字 ≥ 4.5:1）', () => {
    const rules = parseCss(read('src/components/code.css')).filter((r) => r.selector.includes('.hljs-'))
    expect(rules.length).toBeGreaterThan(5)
    for (const r of rules) {
      const color = r.decls.color
      expect(color, r.selector).toMatch(/^var\(--code-[a-z]+\)$/)
      expect(CODE_TOKENS, r.selector).toContain(color.slice(4, -1))
    }
  })
})

// ---------- 字型 ----------
function unicodeRange(spec: string): Array<[number, number]> {
  return spec.split(',').map((p) => {
    const m = p.trim().match(/^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i)
    if (!m) throw new Error(`bad unicode-range part: ${p}`)
    const lo = parseInt(m[1], 16)
    return [lo, m[2] ? parseInt(m[2], 16) : lo]
  })
}
const covers = (ranges: Array<[number, number]>, cp: number) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi)

describe('字型（自行託管的拉丁字型 + 系統 CJK 字型）', () => {
  const root1 = parseCss(read('src/styles/global.css')).find((r) => r.media === null && r.selector === ':root')!.decls
  // fonts.css 不存在時（例如有人把它刪掉）每個測試各自失敗，而不是整個檔案在 describe 階段就炸掉
  const FONTS_CSS = 'src/styles/fonts.css'
  const faces = existsSync(resolve(root, FONTS_CSS)) ? parseCss(read(FONTS_CSS)).filter((r) => r.selector === '@font-face') : []

  it('src/styles/fonts.css 存在（@font-face 都放在這裡）', () => {
    expect(existsSync(resolve(root, FONTS_CSS))).toBe(true)
  })

  it('--font-sans：Inter 在前負責拉丁字母，CJK 交給系統字型；--font-mono：JetBrains Mono', () => {
    const sans = root1['--font-sans'].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
    expect(sans[0]).toBe('Inter Variable')
    expect(sans).toEqual(expect.arrayContaining(['PingFang TC', 'Microsoft JhengHei', 'Noto Sans CJK TC', 'sans-serif']))
    expect(sans.indexOf('Inter Variable')).toBeLessThan(sans.indexOf('PingFang TC'))
    expect(root1['--font-mono'].split(',')[0].trim()).toBe("'JetBrains Mono'")
  })

  it('--font-sans／--font-mono 第一順位的字型都有 @font-face，而且用 font-display: swap', () => {
    const families = new Set(faces.map((f) => f.decls['font-family'].replace(/^'|'$/g, '')))
    expect(families).toEqual(new Set(['Inter Variable', 'JetBrains Mono']))
    for (const f of faces) expect(f.decls['font-display']).toBe('swap')
  })

  it('每個 @font-face 的 woff2 都真的存在於 node_modules（套件改檔名時這裡會先紅）', () => {
    expect(faces.length).toBeGreaterThanOrEqual(4)
    for (const f of faces) {
      const m = f.decls.src.match(/url\('([^']+)'\)/)
      expect(m, f.decls.src).not.toBeNull()
      expect(existsSync(resolve(root, 'node_modules', m![1])), m![1]).toBe(true)
      expect(m![1]).toMatch(/-latin-/)
      expect(m![1]).toMatch(/\.woff2$/)
    }
  })

  it('Inter 負責拉丁字母、數字、ASCII 連字號與減號；中文行文的標點（破折號、引號、刪節號）留給 CJK 字型', () => {
    const inter = faces.find((f) => f.decls['font-family'] === "'Inter Variable'")!
    const r = unicodeRange(inter.decls['unicode-range'])
    for (const cp of [0x41, 0x7a, 0x30, 0x39, 0x2d, 0x2b, 0x3d, 0xd7, 0xb7, 0x2212]) expect(covers(r, cp), `U+${cp.toString(16)}`).toBe(true)
    for (const cp of [0x2014, 0x2015, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x4e2d, 0x300c, 0xff0c]) expect(covers(r, cp), `U+${cp.toString(16)}`).toBe(false)
  })

  it('main.tsx 在 global.css 之前載入 fonts.css', () => {
    const main = read('src/main.tsx')
    const iFonts = main.indexOf("./styles/fonts.css")
    const iGlobal = main.indexOf("./styles/global.css")
    expect(iFonts).toBeGreaterThan(-1)
    expect(iFonts).toBeLessThan(iGlobal)
  })

  it('code／pre 關掉連字（JetBrains Mono 會把 >= 畫成 ≥，教學用程式碼要看到實際輸入的字元）', () => {
    const rule = parseCss(read('src/styles/global.css')).find((r) => r.media === null && r.selector.split(',').map((s) => s.trim()).includes('code'))!
    expect(rule.decls['font-variant-ligatures']).toBe('none')
  })

  it('body 關掉上下文替代（繼承到全站）：其他元件自己宣告 var(--font-mono) 的地方（.c-tip-item 的 test::name 等）也不會出現連字，Inter 也不會把 -> 畫成箭頭', () => {
    const body = parseCss(read('src/styles/global.css')).find((r) => r.media === null && r.selector === 'body')!
    expect(['no-contextual', 'none']).toContain(body.decls['font-variant-ligatures'])
  })
})

// ---------- ☰ 漢堡鈕與頂列 ----------
describe('頂列', () => {
  const rules = parseCss(read('src/styles/global.css'))
  const withSelector = (re: RegExp) => rules.filter((r) => r.selector.split(',').some((s) => re.test(s.trim())))

  it('☰ 漢堡鈕預設 display:none，只在 ≤900px 顯示；而且優先權高於後面的 .btn{display:inline-flex}', () => {
    const toggles = withSelector(/nav-toggle/).filter((r) => 'display' in r.decls)
    const base = toggles.find((r) => r.media === null)!
    const narrow = toggles.find((r) => r.media === '(max-width: 900px)')!
    expect(base.decls.display).toBe('none')
    expect(narrow.decls.display).toBe('inline-flex')
    // 會把 display 改掉的通用規則：.btn（優先權 0,1,0）。.nav-toggle 必須比它高，否則排在後面的 .btn 會把它蓋掉
    const btn = withSelector(/^\.btn$/).find((r) => r.decls.display)!
    expect(btn).toBeDefined()
    const spec = specificity(base.selector.split(',').find((s) => /nav-toggle/.test(s))!.trim())
    expect(cmpSpec(spec, specificity('.btn'))).toBeGreaterThan(0)
    expect(cmpSpec(specificity(narrow.selector.split(',').find((s) => /nav-toggle/.test(s))!.trim()), specificity('.btn'))).toBeGreaterThan(0)
  })

  it('≤480px 的頂列選單不再設固定 px 上限（原本 104px 把「Engineer 工程」截成「Engineer …」）', () => {
    const selects = rules.filter((r) => r.media === '(max-width: 480px)' && /topbar-controls select/.test(r.selector))
    expect(selects.length).toBeGreaterThan(0)
    for (const r of selects) {
      const mw = r.decls['max-width']
      expect(mw === undefined || mw === '100%' || mw === 'none', `max-width: ${mw}`).toBe(true)
      expect(r.decls['min-width']).toBe('0')
    }
  })
})

// ---------- 表格 ----------
describe('表格儲存格留白', () => {
  const rules = parseCss(read('src/styles/global.css'))
  const cell = (media: string | null) => rules.find((r) => r.media === media && r.selector.split(',').map((s) => s.trim()).join() === 'th,td')!.decls.padding
  const horizontal = (padding: string) => parseFloat(padding.split(/\s+/)[1] ?? padding.split(/\s+/)[0])

  it('桌面左右各 ≤ 8px、手機（≤480px）左右各 ≤ 6px：Inter 的數字比 PingFang 寬，留白再大，/ch/02 的逐步數值表與幾張手機上的表會多出 1–4px 的橫向捲軸', () => {
    expect(horizontal(cell(null))).toBeLessThanOrEqual(8)
    expect(horizontal(cell('(max-width: 480px)'))).toBeLessThanOrEqual(6)
  })
})

// ---------- 刻意不做的事 ----------
describe('content-visibility', () => {
  it('不替段落加 content-visibility:auto（長距離的頁內跳轉會落在 1 萬 px 外；見 global.css 的說明）', () => {
    const offenders = ['src/styles/global.css', 'src/components/components.css'].flatMap((f) =>
      parseCss(read(f))
        .filter((r) => /content-visibility/.test(Object.keys(r.decls).join(' ')) && r.decls['content-visibility'] === 'auto')
        .map((r) => `${f}: ${r.selector}`),
    )
    expect(offenders).toEqual([])
  })
})
