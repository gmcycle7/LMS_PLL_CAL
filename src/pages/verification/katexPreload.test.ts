/**
 * index.html 的 KaTeX 字型預載（performance 審查第 7 項）。
 *
 * 問題：KaTeX 的 @font-face 沒有 font-display（預設 block），而字型要等 React 把第一個公式排進頁面、瀏覽器第一次需要它時才開始下載。
 * 模擬 100 ms RTT／20 Mbps 時，/lab 的字型要到約 1.2 s 才發出請求、1.4 s 才到；4 倍 CPU 節流＋1.6 Mbps 時 5–6.5 s 才發出請求、8–9.6 s 才變成 loaded。
 * 在這之前畫出來的公式是隱形的（block 期間字會留位置但不顯示），字型到了才突然出現。
 *
 * 做法（兩步）：
 *   1. <link rel="preload" as="font"> 讓字型位元組在 HTML 解析時就開始下載（快速網路約 110 ms 發出、250 ms 到；慢速約 170 ms 發出、0.8 s 到）。
 *   2. 樣式表載入後的行內腳本呼叫 document.fonts.load()：只靠預載，FontFace 要等第一個公式排版時才開始「載入」，
 *      主執行緒忙的時候這一步會晚；先呼叫 load() 之後，第一個公式出現時字型已經是 loaded。
 *
 * 實測（建置後的 production、冷快取、gzip 靜態伺服器；以 rAF 逐幀檢查「畫面上已有 .katex、但 KaTeX_Main／Math 還沒 loaded」的幀 = 公式隱形的幀）：
 *   - 修改前（main f36a593）：快速網路 /lab 8 次裡 4 次、公式隱形 0.58–0.60 s；/ 8 次裡 5 次、0.09–0.32 s；慢速 /lab 5 次全部、1.3–3.3 s。
 *   - 同一份 JS、沒有預載：/ 8 次全部有 1–5 個隱形幀（36–77 ms）。
 *   - 預載＋load()：/lab、/ch/05、/ 共 24 次、慢速 /lab 5 次，隱形幀為 0。
 *   - 代價：預載的 53 KB 字型和 CSS／JS 搶頻寬，FCP 快速網路慢約 10–30 ms、4 倍 CPU＋1.6 Mbps 時約 250 ms；fetchpriority="low" 與把預載移到 <body> 在這個環境下都沒有改變請求順序，所以沒採用。
 *   - CLS：/lab、/ch/05 修改前後都是 0.00001（審查報告的 0.089 沒有重現：第一批的自架 Inter 已經消除那次字型換入的位移）；/ 的 0.0115 修改前後相同，不是字型造成的。
 *
 * href 指向 /node_modules/katex/dist/fonts/…：Vite 建置時把它換成和 katex.min.css 裡同一個檔案的雜湊檔名
 * （同一份內容、同一個雜湊，所以預載的就是 CSS 實際會用的那個 URL，不會下載兩次）。建置產物（dist/index.html 的預載網址 = dist 裡 CSS 的 @font-face 網址）在單元測試裡驗不到，
 * 要靠建置後的檢查（2026-10-19 手動核對過 4 個檔名都一致）。這個測試固定住原始碼端的約定，以及「預載的字型確實是每頁都用到的那幾個」。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
const css = readFileSync(join(ROOT, 'node_modules/katex/dist/katex.min.css'), 'utf8')

interface Face {
  family: string
  style: string
  weight: string
  woff2: string
}

/** katex.min.css 的 @font-face：family／style／weight，以及 woff2 檔名 */
function katexFaces(): Face[] {
  const out: Face[] = []
  for (const m of css.matchAll(/@font-face\{([^}]*)\}/g)) {
    const body = m[1]
    const family = /font-family:([^;]+)/.exec(body)?.[1]
    const woff2 = /url\(fonts\/([^)]+\.woff2)\)/.exec(body)?.[1]
    if (!family || !woff2) continue
    out.push({ family, style: /font-style:([^;]+)/.exec(body)?.[1] ?? 'normal', weight: /font-weight:([^;]+)/.exec(body)?.[1] ?? '400', woff2 })
  }
  return out
}

const preloads = [...html.matchAll(/<link\b[^>]*\brel="preload"[^>]*>/g)].map((m) => m[0])
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null
const fileOf = (tag: string) => /\/([^/"]+\.woff2)$/.exec(attr(tag, 'href') ?? '')?.[1] ?? ''

describe('index.html：KaTeX 字型預載', () => {
  it('預載 3–5 個 woff2 字型：as=font、type=font/woff2、crossorigin（字型的請求一律是 CORS 模式，缺了就會下載兩次）', () => {
    expect(preloads.length).toBeGreaterThanOrEqual(3)
    expect(preloads.length).toBeLessThanOrEqual(5) // 太多會和 JS 搶頻寬；只預載每頁都用到的
    for (const tag of preloads) {
      expect(attr(tag, 'as'), tag).toBe('font')
      expect(attr(tag, 'type'), tag).toBe('font/woff2')
      expect(tag, tag).toMatch(/\bcrossorigin\b/)
    }
  })

  it('href 指向 node_modules/katex/dist/fonts（Vite 建置時換成雜湊檔名），檔案存在，也確實是 katex.min.css 會要的 woff2', () => {
    const faces = katexFaces()
    expect(faces.length).toBeGreaterThan(15)
    for (const tag of preloads) {
      expect(attr(tag, 'href'), tag).toMatch(/^\/node_modules\/katex\/dist\/fonts\/KaTeX_[A-Za-z0-9-]+\.woff2$/)
      expect(existsSync(join(ROOT, attr(tag, 'href')!)), tag).toBe(true)
      expect(
        faces.some((f) => f.woff2 === fileOf(tag)),
        `${fileOf(tag)} 不在 katex.min.css 的 @font-face 裡`,
      ).toBe(true)
    }
    expect(new Set(preloads.map(fileOf)).size, '沒有重複預載同一個檔案').toBe(preloads.length)
  })

  it('預載的是每頁都用到的字型：Main-Regular 與 Math-Italic 一定在（所有公式的內文與變數），不預載只有部分頁面用到的 Bold／Caligraphic／AMS', () => {
    const files = preloads.map(fileOf)
    expect(files).toContain('KaTeX_Main-Regular.woff2')
    expect(files).toContain('KaTeX_Math-Italic.woff2')
    // 52 個「頁面×模式」的實測：Main-Regular／Math-Italic／Size1 100%、Size2 98%；Caligraphic 81%、AMS 71%、Main-Bold 67%（沒用到的預載是白白浪費頻寬）
    for (const f of files) expect(f, '只預載 100% 頁面都用到的字型').toMatch(/^KaTeX_(Main-Regular|Math-Italic|Size1-Regular|Size2-Regular)\.woff2$/)
  })

  it('預載寫在載入 JS 的 <script type="module"> 之前（HTML 解析一開始就發出請求）', () => {
    const script = html.indexOf('<script type="module"')
    expect(script).toBeGreaterThan(0)
    for (const tag of preloads) expect(html.indexOf(tag), tag).toBeLessThan(script)
  })

  it('katex.min.css 仍由進入檔 import（預載的雜湊檔名才會和 CSS 的一樣）', () => {
    expect(readFileSync(join(ROOT, 'src/main.tsx'), 'utf8')).toMatch(/import\s+'katex\/dist\/katex\.min\.css'/)
  })
})

describe('index.html：樣式表載入後先把預載的字型變成 loaded', () => {
  const script = /<script>\s*\/\/ 樣式表載入後[\s\S]*?<\/script>/.exec(html)?.[0] ?? ''
  const loads = [...script.matchAll(/document\.fonts\.load\('([^']+)'\)/g)].map((m) => m[1])

  it('有這段腳本，放在 <body> 裡 #root 之後（它前面的樣式表是 render-blocking，腳本一定在樣式表載完之後才執行）', () => {
    expect(script).not.toBe('')
    expect(html.indexOf(script)).toBeGreaterThan(html.indexOf('<div id="root">'))
    expect(script).toMatch(/try\s*\{/) // 沒有 FontFace API 的環境不能丟例外
    expect(script).toMatch(/\.catch\(function \(\) \{\}\)/) // load() 失敗（字型 404）不能變成 unhandled rejection
  })

  it('每個預載的字型都有一個對應的 document.fonts.load(…)：字體名稱、斜體、粗細都和 @font-face 一致', () => {
    const faces = katexFaces()
    expect(loads).toHaveLength(preloads.length)
    for (const tag of preloads) {
      const face = faces.find((f) => f.woff2 === fileOf(tag))!
      const want = `${face.style === 'italic' ? 'italic ' : ''}${face.weight === '700' ? 'bold ' : ''}1em ${face.family}`
      expect(loads, `${fileOf(tag)} 沒有對應的 document.fonts.load('${want}')`).toContain(want)
    }
  })
})
