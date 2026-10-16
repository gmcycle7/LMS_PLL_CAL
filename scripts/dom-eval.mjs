#!/usr/bin/env node
// 開一頁、等方塊圖畫完，在頁面裡執行一段 JS 並印出結果（檢查 DOM 用）
//   node scripts/dom-eval.mjs <url> '<async function body that returns something JSON-able>' [mobile]
//   （參數會被包成 async function 的本體，所以要寫 return；只寫一個運算式會印出 undefined）
import puppeteer from 'puppeteer-core'
const [url, expr, vp] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run', '--hide-scrollbars'] })
try {
  const page = await browser.newPage()
  await page.setViewport(vp === 'mobile' ? { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 900 })
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 })
  await page.waitForSelector('article.page', { timeout: 60000 })
  await new Promise((r) => setTimeout(r, 2500))
  const out = await page.evaluate(`(async () => { ${expr} })()`)
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1))
} finally {
  await browser.close()
}
