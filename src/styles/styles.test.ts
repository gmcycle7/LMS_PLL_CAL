import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
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

// ---------- 列印樣式（print.css） ----------
describe('列印樣式（print.css）', () => {
  const printCss = read('src/styles/print.css')
  const rules = parseCss(printCss)
  const inPrint = rules.filter((r) => r.media === 'print')
  const hasDecl = (r: Rule, prop: string, re: RegExp) => re.test(r.decls[prop] ?? '')
  /** 練習卷以外的列印規則都以這個前綴開頭（見 print.css 標頭）；比對選擇器時先拿掉它 */
  const SCOPE = 'body:not(.wb-print-sheet)'
  const rawSelectorsOf = (r: Rule) => r.selector.split(',').map((s) => s.trim())
  const selectorsOf = (r: Rule) => rawSelectorsOf(r).map((s) => (s.startsWith(`${SCOPE} `) ? s.slice(SCOPE.length + 1) : s))
  /** 找出「選擇器清單裡含 sel，且宣告了 prop」的列印規則 */
  const printRuleFor = (sel: string, prop: string) => inPrint.filter((r) => selectorsOf(r).includes(sel) && prop in r.decls)
  /** 所有被 display:none 隱藏的選擇器 */
  const hidden = new Set(inPrint.filter((r) => hasDecl(r, 'display', /^none\b/)).flatMap(selectorsOf))

  it('main.tsx 在 global.css 之後載入 print（樣式與列印前展開的處理器）', () => {
    const main = read('src/main.tsx')
    expect(main.indexOf("'./styles/print'")).toBeGreaterThan(main.indexOf("'./styles/global.css'"))
    expect(existsSync(resolve(root, 'src/styles/print.ts'))).toBe(true)
    expect(read('src/styles/print.ts')).toContain("import './print.css'")
    expect(read('src/styles/print.ts')).toContain('installPrintPrep')
  })

  it('除了命名頁面 @page doc 之外，每一條規則都在 @media print 裡（不影響螢幕）', () => {
    const outside = rules.filter((r) => r.media !== 'print').map((r) => r.selector)
    expect(outside).toEqual(['@page doc'])
  })

  it('隱藏外框：頂列、側欄、遮罩、skip link、模式選擇器、上下頁、目錄、搜尋、放大鈕、modebar、浮動按鈕（display:none !important）', () => {
    for (const sel of [
      '.topbar',
      '.sidebar',
      '.nav-scrim',
      '.c-skip-link',
      '.c-modepicker',
      '.page-pager',
      '.c-outline-col',
      '.c-outline-dock',
      '.c-search-backdrop',
      '.c-zoom',
      '.c-mermaid-zoom',
      '.modebar',
      '.modebar-container',
      '.wb-dock',
      '.no-print',
      '[data-no-print]', // printPrep.ts 替「↑ 回到章首」這類只在螢幕上有用的按鈕標上的屬性
    ]) {
      const hit = printRuleFor(sel, 'display')
      expect(hit.length, `${sel} 沒有列印時隱藏的規則`).toBeGreaterThan(0)
      expect(hit.every((r) => /^none !important$/.test(r.decls.display)), `${sel} 要寫 display: none !important（章節 CSS 比它晚載入）`).toBe(true)
    }
  })

  it('實驗的控制項：滑桿、工具列（執行／重設／preset）、下載鈕、複製程式碼、程式碼分頁、看答案鈕都不印', () => {
    for (const sel of ['.c-param-slider', '.c-exp-toolbar', '.c-exp-export', '.c-code-copy', '.c-code-tabs', '.c-quiz > .btn', '.c-handcalc-actions']) {
      expect(hidden.has(sel), sel).toBe(true)
    }
  })

  it('強制淺色：:root[data-theme=dark] 在列印時被改回與 global.css 淺色 :root 完全相同的 token', () => {
    const globalRules = parseCss(read('src/styles/global.css'))
    const light = globalRules.find((r) => r.media === null && r.selector === ':root')!.decls
    const dark = globalRules.find((r) => r.media === null && r.selector === ":root[data-theme='dark']")!.decls
    const forced = inPrint.find((r) => selectorsOf(r).includes(":root[data-theme='dark']") && selectorsOf(r).includes(':root'))
    expect(forced, '缺少 :root, :root[data-theme=dark] 的列印規則').toBeDefined()
    const darkTokens = Object.keys(dark).filter((k) => k.startsWith('--'))
    expect(darkTokens.length).toBeGreaterThan(40)
    for (const k of darkTokens) expect(forced!.decls[k], `${k}（深色主題會改它，列印要還原成淺色值）`).toBe(light[k])
    expect(forced!.decls['color-scheme']).toBe('light')
    // 列印規則的優先權不低於深色主題那條，而且 print.css 在 global.css 之後載入（上一個測試守住載入順序）→ 同優先權時後者勝
    const darkSpec = specificity(":root[data-theme='dark']")
    expect(cmpSpec(specificity(":root[data-theme='dark']"), darkSpec)).toBe(0)
  })

  it('背景色照印（print-color-adjust: exact），背景是白紙不是 --bg 的淡灰', () => {
    const all = inPrint.find((r) => selectorsOf(r).includes('*'))!
    expect(rawSelectorsOf(all)).toContain(`${SCOPE} *`)
    expect(all.decls['print-color-adjust']).toBe('exact')
    expect(all.decls['-webkit-print-color-adjust']).toBe('exact')
    const page = inPrint.find((r) => selectorsOf(r).join() === 'html,body')!
    expect(page.decls.background).toMatch(/^#fff\b/)
  })

  it('版面：內容滿版（.content 與 .page 拿掉 margin／padding／max-width），章節與工具頁用命名頁面 doc 的 16 mm 邊界，練習卷不套用', () => {
    const content = inPrint.find((r) => rawSelectorsOf(r).join() === '.content')!
    expect(content.decls.margin).toBe('0 !important')
    expect(content.decls.padding).toBe('0 !important')
    const page = inPrint.find((r) => rawSelectorsOf(r).includes('.page') && 'max-width' in r.decls)!
    expect(page.decls['max-width']).toBe('none !important')
    expect(selectorsOf(page)).toContain('.page[data-outline]') // PageOutline 的右欄會加 padding-right 與 max-width
    expect(page.decls['padding-right']).toBe('0 !important')
    const named = rules.find((r) => r.selector === '@page doc')!
    expect(named.decls.margin).toBe('16mm')
    const apply = inPrint.find((r) => rawSelectorsOf(r).includes(`${SCOPE} .content`) && 'page' in r.decls)!
    expect(apply.decls.page).toBe('doc')
    // 練習卷自己的列印規則（workbook.css）不由這裡處理：這裡不出現 .wb-sheet
    expect(printCss).not.toContain('.wb-sheet {')
    expect(printCss).not.toMatch(/\.wb-sheet[\s,.{]/)
  })

  it('練習卷（body.wb-print-sheet）不受影響：除了 token、隱藏外框、html／body 白底、.content／.page 重設（它自己的規則寫了同樣的值）、深色圖表反相之外，所有規則都以 body:not(.wb-print-sheet) 開頭', () => {
    const exempt = (r: Rule) =>
      rawSelectorsOf(r).every((s) => s.startsWith(':root') || s === '.app-shell' || s === 'html' || s === 'body' || s === '.content' || s === '.page' || s === '.page[data-outline]') ||
      hasDecl(r, 'display', /^none !important$/) // 隱藏外框／控制項（練習卷自己的規則隱藏同一批東西）
    const unscoped = inPrint.filter((r) => !exempt(r)).flatMap((r) => rawSelectorsOf(r).filter((s) => !s.startsWith(`${SCOPE} `) && s !== SCOPE && !s.startsWith('html:not(:has(body.wb-print-sheet))')))
    expect(unscoped).toEqual([])
    // 豁免名單裡的 token 規則只改 token，不碰版面；html／body 規則只改背景
    const bg = inPrint.find((r) => rawSelectorsOf(r).join() === 'html,body')!
    expect(Object.keys(bg.decls)).toEqual(['background'])
  })

  it('字級縮到 14px（10.5pt）、行高 1.55，淺色紙面', () => {
    // :has() 不支援的瀏覽器丟棄 html 這條（維持 16px），所以限定練習卷的條件寫在它上面
    const html = inPrint.find((r) => r.selector === 'html:not(:has(body.wb-print-sheet))')!
    expect(html.decls['font-size']).toBe('14px')
    const body = inPrint.find((r) => r.selector === SCOPE)!
    expect(body.decls['line-height']).toBe('1.55')
  })

  it('分頁：標題不孤單留在頁底；圖、獨立公式、表格的列、手算的每一步、思考題不從中間切開；表頭跨頁重複', () => {
    const after = inPrint.find((r) => hasDecl(r, 'break-after', /^avoid$/))!
    for (const sel of ['h1', 'h2', 'h3', 'h4', 'summary']) expect(selectorsOf(after), sel).toContain(sel)
    const inside = inPrint.find((r) => hasDecl(r, 'break-inside', /^avoid$/))!
    for (const sel of ['figure:not(.c-code)', '.c-plot', '.c-mermaid', '.c-texblock', '.c-step', '.c-quiz', 'tr', '.katex-display']) expect(selectorsOf(inside), sel).toContain(sel)
    expect(printRuleFor('thead', 'display')[0].decls.display).toBe('table-header-group')
  })

  it('目錄（.page nav）不從中間切開、標題列不單獨留在頁底；callout 的標題跟著內文走', () => {
    const inside = inPrint.find((r) => hasDecl(r, 'break-inside', /^avoid$/))!
    expect(selectorsOf(inside)).toContain('.page nav')
    const after = inPrint.find((r) => hasDecl(r, 'break-after', /^avoid$/))!
    for (const sel of ['.c-callout-title', '.page nav > strong:first-child']) expect(selectorsOf(after), sel).toContain(sel)
  })

  it('程式碼區塊（<figure class="c-code">）可以在行之間換頁，但標題列與「比較」的名稱／說明不單獨留在頁底；折行的長行不從中間切開', () => {
    const avoided = inPrint.filter((r) => hasDecl(r, 'break-inside', /^avoid$/)).flatMap(selectorsOf)
    expect(avoided).not.toContain('figure') // 裸的 figure 會把整段程式碼挪到下一頁，上一頁只剩一行說明（ch08 實測）
    expect(avoided).toContain('.c-code-line')
    const after = inPrint.find((r) => hasDecl(r, 'break-after', /^avoid$/))!
    for (const sel of ['.c-code-head', '.c-code-compare-label', '.c-code-compare-note']) expect(selectorsOf(after), sel).toContain(sel)
  })

  it('不能把整個表格／整段程式碼／整張實驗結果設成 break-inside:avoid（比一頁高時 Chrome 會在前一頁留下孤單的標題與整頁空白）', () => {
    const avoided = inPrint.filter((r) => hasDecl(r, 'break-inside', /^avoid/)).flatMap(selectorsOf)
    for (const sel of ['table', '.c-code', '.c-exp', '.c-exp-results', '.c-handcalc', 'details', '.callout']) expect(avoided, sel).not.toContain(sel)
  })

  it('章節的 h2 另起一頁：只套用在章節頁（ch00–ch14 與 07b 案例），工具頁不套用；註冊表裡的頁面 id 與這兩個選擇器對得起來', async () => {
    const forced = inPrint.filter((r) => hasDecl(r, 'break-before', /^page$/))
    const plain = forced.find((r) => !r.selector.includes(':has('))!
    expect(selectorsOf(plain).sort()).toEqual([".page[data-page='case-sspll'] h2:not(.c-section-title)", ".page[data-page^='ch'] h2:not(.c-section-title)"])
    for (const r of forced) for (const sel of rawSelectorsOf(r)) expect(sel.startsWith(`${SCOPE} `), sel).toBe(true)
    // Section 元件的 h2 前面有一行 kicker：換頁要連 kicker 一起（對 .c-section），而且 :has() 規則獨立成一條（不支援的瀏覽器整條丟棄，不連累上面那條）
    const withHas = forced.filter((r) => r.selector.includes(':has('))
    expect(withHas).toHaveLength(1)
    expect(selectorsOf(withHas[0]).sort()).toEqual([".page[data-page='case-sspll'] .c-section:has(> h2.c-section-title)", ".page[data-page^='ch'] .c-section:has(> h2.c-section-title)"])
    const { PAGES } = await import('@/app/registry')
    for (const p of PAGES) {
      const chapter = p.group === 'A' || p.group === 'B' || p.group === 'C'
      const matched = p.id.startsWith('ch') || p.id === 'case-sspll'
      expect(matched, `${p.id}（group ${p.group}）`).toBe(chapter)
    }
  })

  it('外部連結後面印網址、站內 #/ 路由連結不印', () => {
    const r = inPrint.find((x) => x.selector.includes("a[href^='http']::after"))!
    expect(r.decls.content).toBe("' (' attr(href) ')'")
    expect(printCss).not.toMatch(/a\[href\^=['"]#/)
  })

  it('能橫向捲動的容器（表格外框、程式碼、方塊圖、獨立公式）列印時 overflow:visible、不截高度', () => {
    const r = inPrint.find((x) => selectorsOf(x).includes('.table-wrap') && 'overflow' in x.decls)!
    for (const sel of ['.c-scroll', '.c-metric-wrap', '.katex-display', '.c-mermaid-svg', '.c-code-pre']) expect(selectorsOf(r), sel).toContain(sel)
    expect(r.decls.overflow).toBe('visible !important')
    expect(r.decls['max-height']).toBe('none !important')
  })

  it('不能有任何元素比頁寬寬（Chrome 會把整份文件等比縮小去配合它）：表格取消 min-width 與數值欄的 nowrap，長公式可換行（方塊圖裡的除外）', () => {
    const table = inPrint.find((x) => selectorsOf(x).includes('table') && 'min-width' in x.decls)!
    expect(table.decls['min-width']).toBe('0 !important')
    const cell = inPrint.find((x) => selectorsOf(x).includes('th') && selectorsOf(x).includes('td') && 'white-space' in x.decls)!
    expect(cell.decls['white-space']).toBe('normal !important')
    expect(cell.decls['overflow-wrap']).toBe('break-word') // anywhere 會把短欄名擠成直排
    const katex = inPrint.find((x) => selectorsOf(x).includes('.katex:not(.c-mermaid .katex)'))!
    expect(selectorsOf(katex)).toContain('.katex-html:not(.c-mermaid .katex-html)')
    expect(katex.decls['white-space']).toBe('normal')
  })

  it('表格每格的留白縮小；欄數多的表（第 8 欄以後還有格子）再縮一級字與留白，免得整份文件被 Chrome 縮小', () => {
    const cell = inPrint.find((x) => selectorsOf(x).includes('th') && selectorsOf(x).includes('td') && 'padding' in x.decls)!
    expect(cell.decls.padding).toBe('4px 5px !important')
    expect(cell.decls['min-width']).toBe('0 !important') // /verification 的 .ver-wide（170px）、.ver-mid（110px）：9 欄加起來 1072px，Chrome 會把整頁縮到 63%
    const wide = ['table:has(tr > :nth-child(8))', 'table:has(tr > :nth-child(8)) th', 'table:has(tr > :nth-child(8)) td']
    const font = inPrint.find((x) => selectorsOf(x).includes(wide[0]) && 'font-size' in x.decls)!
    const dense = inPrint.find((x) => selectorsOf(x).includes(wide[1]) && selectorsOf(x).includes(wide[2]))!
    expect(parseFloat(font.decls['font-size'])).toBeLessThan(parseFloat(printRuleFor('table', 'font-size')[0].decls['font-size']))
    expect(dense.decls.padding).toBe('3px 3px !important')
    // :has() 不支援的瀏覽器會整條丟棄：不能和基本的表格規則放在同一個選擇器清單裡
    expect(selectorsOf(cell).some((sel) => sel.includes(':has('))).toBe(false)
    expect(selectorsOf(printRuleFor('table', 'min-width')[0]).some((sel) => sel.includes(':has('))).toBe(false)
  })

  it('比頁寬還寬的單一公式片段依 100vw 縮小字級（printPrep 量好 --c-em、--c-off）；放得下的取 1em 維持原樣', () => {
    const r = inPrint.find((x) => selectorsOf(x).includes('.katex-html > .base[data-print-wide]'))!
    expect(r.decls['font-size']).toBe('min(1em, calc((100vw - var(--c-off, 0px) - 4px) / var(--c-em)))')
    // 100vw 在 Chrome 的列印版面等於頁面內容寬（扣掉 @page 邊界）：puppeteer page.pdf 實測 A4／Letter 都是
    expect(r.decls.width).toBeUndefined()
  })

  it('方塊圖拿掉為窄螢幕設的 min-width；程式碼長行換行；程式碼對照在紙上全部印出', () => {
    const svg = inPrint.find((x) => selectorsOf(x).includes('.c-mermaid-svg > svg') && 'min-width' in x.decls)!
    expect(svg.decls['min-width']).toBe('0 !important')
    expect(svg.decls['max-width']).toBeUndefined() // 保留 Mermaid 的自然寬度，免得小圖被放大成整頁
    // 高度封頂在「一頁內容高（100vh = 紙張高度扣掉邊界）減掉圖框的 padding、圖說與 margin」：長寬比接近 1 的圖滿頁寬時比一頁還高，
    // break-inside: avoid 的圖框會在上一頁留一條邊、下一頁整頁空白（ch12 實測）；width: auto 讓 max-height 依 viewBox 長寬比縮窄
    expect(selectorsOf(svg)).toContain('.c-sysmap-svg')
    expect(svg.decls.width).toBe('auto')
    const cap = /^calc\(100vh - (\d+)px\)$/.exec(svg.decls['max-height'] ?? '')
    expect(cap, 'max-height 要寫 calc(100vh - Npx)（A4／Letter／橫式都適用）').not.toBeNull()
    expect(Number(cap![1])).toBeGreaterThanOrEqual(140) // 圖框 padding 16 + 邊框 + 上下 margin 36 + 圖說最多四五行
    expect(Number(cap![1])).toBeLessThanOrEqual(240) // 再大就把橫式紙張（內容高約 670px）的圖縮得太小
    const line = inPrint.find((x) => selectorsOf(x).includes('.c-code-line') && 'white-space' in x.decls)!
    expect(line.decls['white-space']).toBe('pre-wrap')
    const compare = inPrint.find((x) => selectorsOf(x).includes('.c-code-compare-tabs .c-code-compare-item'))!
    expect(compare.decls.display).toBe('block !important')
  })

  it('Plotly 圖依頁寬縮放：只套用在 printPrep 標記過的圖（data-print-fit），沒標記的維持原樣', () => {
    const plot = inPrint.filter((x) => selectorsOf(x).some((s) => s.includes('.c-plot-frame')))
    expect(plot.length).toBeGreaterThanOrEqual(3)
    for (const r of plot) for (const s of selectorsOf(r)) expect(s, s).toContain('[data-print-fit]')
    const ar = plot.find((r) => 'aspect-ratio' in r.decls)!
    expect(ar.decls['aspect-ratio']).toBe('var(--c-print-ar)')
    // 只縮小、不放大：比頁寬窄的圖維持自然寬度
    const w = plot.find((r) => 'max-width' in r.decls)!
    expect(w.decls['max-width']).toBe('var(--c-print-w)')
    expect(w.decls.width).toBe('100% !important')
  })

  it('圖還沒畫好時（第一次按列印才開始載入）印出原因與補救辦法，不是只有一句「圖表載入中…」', () => {
    const r = inPrint.find((x) => selectorsOf(x).includes(".c-plot-placeholder[aria-busy='true']::after") && selectorsOf(x).includes('.c-mermaid-loading::after'))!
    expect(r.decls.content).toMatch(/再列印一次/)
  })

  it('每個 position:fixed 的元素（日後新增的浮動目錄、搜尋、提示列…）都必須列在列印隱藏清單裡，否則會在每一頁重複並蓋住正文', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(resolve(root, dir))) {
        const rel = `${dir}/${name}`
        if (statSync(resolve(root, rel)).isDirectory()) walk(rel)
        else if (name.endsWith('.css') && rel !== 'src/styles/print.css') files.push(rel)
      }
    }
    walk('src')
    const classOf = (sel: string) => (sel.match(/\.([\w-]+)(?![\w-])/g) ?? []).pop()
    // 只算「單一 class」的隱藏規則（.c-seed .btn 之類的後代選擇器只藏某個容器裡的按鈕，不代表 .btn 整個不印）
    const hiddenClasses = new Set([...hidden].filter((s) => /^\.[\w-]+$/.test(s)).map((s) => classOf(s)))
    const missing: string[] = []
    let fixed = 0
    for (const f of files) {
      for (const r of parseCss(read(f))) {
        if (r.media === 'print' || r.decls.position !== 'fixed') continue
        for (const sel of r.selector.split(',').map((s) => s.trim())) {
          fixed++
          const cls = classOf(sel)
          // 列印時根本不顯示的容器（練習卷的 body.wb-print-sheet 規則自己處理）不算；其餘必須有 class 且在清單裡
          if (!cls || !hiddenClasses.has(cls)) missing.push(`${f}: ${sel}`)
        }
      }
    }
    expect(fixed).toBeGreaterThan(8) // 至少抓到 topbar、sidebar、遮罩、放大、搜尋、目錄…（解析壞掉時不會默默通過）
    expect(missing, '這些 position:fixed 的元素列印時會在每一頁重複：到 print.css 隱藏清單加上它的 class，或在元素上加 class="no-print"').toEqual([])
  })
})
