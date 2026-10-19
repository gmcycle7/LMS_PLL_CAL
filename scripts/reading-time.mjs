#!/usr/bin/env node
/**
 * 量每一章在三種學習模式下「看得見」的內容量，估算閱讀時間，並印出可以貼回 src/app/chapterMeta.ts 的 reading 物件。
 *
 *   node scripts/reading-time.mjs --base http://localhost:5173 --routes /ch/04,/ch/11b [--modes beginner,engineer,research]
 *        [--out outputs/reading-time.json] [--chrome <路徑>]
 *
 * 估算公式與 chapterMeta.ts 的 READING_RATE 相同（本腳本直接從那個檔案讀係數）：
 *   分鐘 = 中文字數／350 + 0.2 × 獨立公式數 + 0.5 × 圖數 + 3 × 實驗數，四捨五入到 5 分鐘（最少 5）。
 * 中文字數用 innerText（只算畫面上看得到的文字：收合的 <details>、ModeGate 之外的內容不算）；
 * 公式（.katex-display）、圖（figure.c-mermaid、figure.c-plot）、實驗（.c-exp）只數有版面的元素（getClientRects().length > 0）。
 * 整頁先慢慢捲一遍，讓延後載入的區塊長出來。預設的路由是全部 17 個章節頁（--routes 可以只量其中幾頁）。
 * 輸出的 JSON 另外附手算題與思考題的數量（供參考，不進公式）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1] ?? '']] : acc), []),
)
const base = (args.base ?? 'http://localhost:5173').replace(/\/$/, '')
const ALL_ROUTES = '/ch/00,/ch/01,/ch/02,/ch/03,/ch/04,/ch/05,/ch/06,/ch/07,/case/sspll,/ch/08,/ch/09,/ch/10,/ch/11,/ch/11b,/ch/12,/ch/13,/ch/14'
const routes = (args.routes ?? ALL_ROUTES).split(',')
const modes = (args.modes ?? 'beginner,engineer,research').split(',')
const out = args.out ?? 'outputs/reading-time.json'
const chrome = args.chrome ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// 係數從 chapterMeta.ts 讀，不另外抄一份
const metaSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/app/chapterMeta.ts'), 'utf8')
const rateOf = (key) => {
  const m = new RegExp(`${key}:\\s*([0-9.]+)`).exec(metaSrc)
  if (!m) throw new Error(`chapterMeta.ts 裡找不到 READING_RATE.${key}`)
  return Number(m[1])
}
const RATE = { hanPerMinute: rateOf('hanPerMinute'), formulaMinutes: rateOf('formulaMinutes'), figureMinutes: rateOf('figureMinutes'), experimentMinutes: rateOf('experimentMinutes') }
const estimate = (c) => c.han / RATE.hanPerMinute + RATE.formulaMinutes * c.formulas + RATE.figureMinutes * c.figures + RATE.experimentMinutes * c.experiments
const round5 = (m) => Math.max(5, Math.round(m / 5) * 5)

/** 開發伺服器在別人改檔時會整頁重新載入：遇到暫時性錯誤就整頁重來 */
async function withRetry(label, fn, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (e) {
      const transient = /Execution context was destroyed|detached Frame|Target closed|Cannot find context|Session closed|Navigation timeout|TimeoutError|Waiting for selector|article\.page 不見了/i.test(String(e))
      if (!transient || i >= tries) throw e
      console.error(`（${label}：頁面在途中被重新載入，重試第 ${i} 次）`)
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-first-run', '--no-default-browser-check', '--hide-scrollbars'] })
const results = {}
try {
  for (const route of routes) {
    results[route] = {}
    for (const mode of modes) {
      const counts = await withRetry(`${route} ${mode}`, async () => {
        const page = await browser.newPage()
        try {
          await page.setViewport({ width: 1280, height: 900 })
          await page.evaluateOnNewDocument((m) => localStorage.setItem('lmspll.mode', m), mode)
          await page.goto(`${base}/#${route}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
          await page.waitForSelector('article.page', { timeout: 90000 })
          return await page.evaluate(async () => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
            await sleep(1500)
            const step = Math.max(400, window.innerHeight * 0.8)
            for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
              window.scrollTo(0, y)
              await sleep(60)
            }
            await sleep(800)
            window.scrollTo(0, 0)
            let art = document.querySelector('article.page')
            for (let t = 0; !art && t < 300; t++) {
              await sleep(100)
              art = document.querySelector('article.page')
            }
            if (!art) throw new Error('article.page 不見了（dev server 重新載入？）')
            const visible = (el) => el.getClientRects().length > 0
            const count = (sel) => Array.from(art.querySelectorAll(sel)).filter(visible).length
            const text = art.innerText || ''
            return {
              han: (text.match(/\p{Script=Han}/gu) || []).length,
              formulas: count('.katex-display'),
              figures: count('figure.c-mermaid, figure.c-plot'),
              experiments: count('.c-exp'),
              handcalcs: count('.c-handcalc'),
              quizzes: count('.c-quiz'),
            }
          })
        } finally {
          await page.close()
        }
      })
      const minutes = estimate(counts)
      results[route][mode] = { ...counts, minutes: Math.round(minutes * 10) / 10, rounded: round5(minutes) }
      console.log(`${route}\t${mode}\than=${counts.han}\tformulas=${counts.formulas}\tfigures=${counts.figures}\texp=${counts.experiments}\thc=${counts.handcalcs}\t→ ${minutes.toFixed(1)} 分 → ${round5(minutes)}`)
    }
    const r = results[route]
    if (modes.length === 3) {
      console.log(`  reading: {\n${modes.map((m) => `    ${m}: { han: ${r[m].han}, formulas: ${r[m].formulas}, figures: ${r[m].figures}, experiments: ${r[m].experiments} },`).join('\n')}\n  },`)
    }
  }
} finally {
  await browser.close()
}
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify({ base, rate: RATE, measuredAt: new Date().toISOString(), results }, null, 1))
console.log(`寫入 ${out}`)
