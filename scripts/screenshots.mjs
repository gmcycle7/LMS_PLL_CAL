#!/usr/bin/env node
/**
 * 視覺檢查用的截圖工具：用本機已安裝的 Chrome（headless、獨立暫存設定檔）開啟網站並截圖。
 *
 *   node scripts/screenshots.mjs --base http://localhost:5173 --out outputs/shots \
 *        --routes /,/ch/00,/ch/05 --theme light,dark --viewport desktop,mobile \
 *        --shots top,mermaid:3,exp:1,handcalc:1,quiz:1,recap:1,symbols:1,code:1,table:1
 *
 * shots：
 *   top            頁面頂端一個視窗
 *   <kind>:<n>     該種元素的前 n 個（逐一捲到畫面中、等方塊圖畫完再截）；kind 見 SELECTORS
 *   all-mermaid    該頁全部方塊圖
 * 其他選項：
 *   --mode beginner|engineer|research   學習模式（預設 beginner，和訪客第一次看到的一樣）
 *   --only 3,7,12                       只截指定序號的元素（序號與 diagram-audit 相同，從 1 起算）
 * 截元素之前會把收合的 <details> 全部展開。
 * 檔名：<route>__<viewport>-<theme>__<shot>-<i>.png
 */
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import puppeteer from 'puppeteer-core'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1] ?? '']] : acc), []),
)
const base = (args.base ?? 'http://localhost:5173').replace(/\/$/, '')
const out = args.out ?? 'outputs/shots'
const routes = (args.routes ?? '/').split(',')
const themes = (args.theme ?? 'light').split(',')
const viewports = (args.viewport ?? 'desktop').split(',')
const shots = (args.shots ?? 'top').split(',')
const mode = args.mode ?? 'beginner'
const only = args.only ? new Set(args.only.split(',').map(Number)) : null
const chrome = args.chrome ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const VIEWPORT = {
  desktop: { width: 1280, height: 900, deviceScaleFactor: 1 },
  wide: { width: 1600, height: 1000, deviceScaleFactor: 1 },
  mobile: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
}
const SELECTORS = {
  mermaid: 'figure.c-mermaid',
  exp: '.c-exp',
  handcalc: '.c-handcalc',
  quiz: '.c-quiz',
  recap: '.c-recap',
  symbols: '#symbols',
  code: '.c-code',
  table: '.table-wrap',
  plot: '.c-plot',
  callout: '.callout',
  steps: '.c-steps',
  prereq: '.c-prereq',
  derivation: '.c-derivation',
}

mkdirSync(out, { recursive: true })
/**
 * 開發伺服器在別人改檔時會讓頁面整頁重新載入，量到一半的 evaluate 會丟出
 * 「Execution context was destroyed」。遇到這類暫時性錯誤就整頁重來。
 */
async function withRetry(label, fn, tries = 5) {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (e) {
      const transient = /Execution context was destroyed|detached Frame|Target closed|Cannot find context|Session closed|Navigating frame was detached|Navigation timeout|TimeoutError|Waiting for selector/i.test(String(e))
      if (!transient || i >= tries) throw e
      console.error(`（${label}：頁面在途中被重新載入，重試第 ${i} 次）`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
}

const profileDir = join(tmpdir(), `lmspll-shots-${process.pid}`)
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  userDataDir: profileDir,
  args: ['--no-first-run', '--no-default-browser-check', '--hide-scrollbars'],
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const slug = (r) => (r === '/' ? 'home' : r.replace(/^\//, '').replace(/\//g, '-'))
const written = []

try {
  for (const vpName of viewports) {
    for (const theme of themes) {
      for (const route of routes) {
        await withRetry(route, async () => {
          // 每一頁開新分頁：HashRouter 換 hash 不會重新載入
          const page = await browser.newPage()
          try {
            await page.setViewport(VIEWPORT[vpName] ?? VIEWPORT.desktop)
            await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
            await page.evaluateOnNewDocument((m) => localStorage.setItem('lmspll.mode', m), mode)
            await page.goto(`${base}/#${route}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
            // HashRouter：同一份文件換 hash 時 goto 不一定重新載入，保險起見等標題出現
            await page.waitForSelector('article.page', { timeout: 60000 })
            await sleep(1500)
            page.__chromeHidden = false
            const prefix = `${slug(route)}__${vpName}-${theme}`
            for (const shot of shots) {
              if (shot === 'top') {
                await page.evaluate(() => window.scrollTo(0, 0))
                await sleep(800)
                const file = join(out, `${prefix}__top.png`)
                await page.screenshot({ path: file })
                written.push(file)
                continue
              }
              // 元素截圖時藏起固定在上方的工具列，避免蓋住被截的元素
              if (!page.__chromeHidden) {
                await page.addStyleTag({ content: '.topbar{visibility:hidden!important}.fr-search{position:static!important}' })
                await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)))
                await sleep(300)
                page.__chromeHidden = true
              }
              const [kindRaw, nRaw] = shot.split(':')
              const kind = kindRaw === 'all-mermaid' ? 'mermaid' : kindRaw
              const sel = SELECTORS[kind]
              if (!sel) continue
              const handles = await page.$$(sel)
              const limit = kindRaw === 'all-mermaid' || only ? handles.length : Math.min(handles.length, Number(nRaw ?? 1))
              for (let i = 0; i < limit; i++) {
                if (only && !only.has(i + 1)) continue
                const h = handles[i]
                await h.evaluate((el) => el.scrollIntoView({ block: 'center' }))
                if (kind === 'mermaid') {
                  await page
                    .waitForFunction((el) => !!el.querySelector('.c-mermaid-svg svg') || !!el.querySelector('.c-mermaid-error'), { timeout: 30000 }, h)
                    .catch(() => undefined)
                }
                if (kind === 'plot' || kind === 'exp') {
                  // Plot 接近可視範圍才載入與繪製：先把元素裡每張圖逐一捲到畫面上，等 .main-svg 出現再截
                  const gds = await h.$$('.c-plot-gd')
                  for (const gd of gds) {
                    await gd.evaluate((el) => el.scrollIntoView({ block: 'center' }))
                    await page
                      .waitForFunction((el) => !!el.querySelector('.main-svg') || !!el.parentElement?.querySelector('.c-plot-error'), { timeout: 30000 }, gd)
                      .catch(() => undefined)
                  }
                  await h.evaluate((el) => el.scrollIntoView({ block: 'center' }))
                  await sleep(kind === 'exp' ? 2500 : 800)
                }
                await sleep(500)
                const box = await h.boundingBox()
                if (!box || box.width < 2 || box.height < 2) continue
                const file = join(out, `${prefix}__${kind}-${String(i + 1).padStart(2, '0')}.png`)
                // 元素太高時只截前 2400px，避免產生巨大的圖
                await h.screenshot({ path: file, clip: box.height > 2400 ? { x: 0, y: 0, width: box.width, height: 2400 } : undefined }).catch(async () => {
                  await page.screenshot({ path: file })
                })
                written.push(file)
              }
            }
          } finally {
            await page.close().catch(() => undefined)
          }
        })
      }
    }
  }
} finally {
  await browser.close()
  rmSync(profileDir, { recursive: true, force: true })
}
console.log(written.join('\n'))
