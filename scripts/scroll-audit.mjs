#!/usr/bin/env node
/**
 * 找出頁面上「會出現捲軸」的元素，分辨有用的（寬表格、長程式碼在手機上橫向捲動）和沒用的
 * （方塊圖節點裡的公式、只超出一兩個像素的區塊——只會多出一條灰色的捲軸）。
 *
 *   node scripts/scroll-audit.mjs --base http://localhost:5173 --routes /ch/05,/ch/06 [--viewport desktop|mobile]
 *        [--mode beginner|engineer|research] [--json out.json]
 *
 * 判斷方式：元素的 overflow-x／overflow-y 是 auto 或 scroll，而且內容真的比框大（scrollWidth > clientWidth
 * 或 scrollHeight > clientHeight）。每個元素輸出：方向、超出幾 px、所在位置，以及分類：
 *   DIAGRAM  在方塊圖（figure.c-mermaid）裡面 —— 一律不該有捲軸
 *   TINY     只超出 ≤ 6px —— 多半是四捨五入或 padding 造成，捲軸沒有用途
 *   VERT     直向只超出 7–60px —— 為了兩三行放一條直向捲軸，通常沒有用途（把高度上限放寬或拿掉）
 *   ok       內容真的放不下：橫向超出 > 6px 的表格／程式碼／公式，或直向超出 > 60px 的限高清單／JSON／程式碼
 * 預設用 Research 模式並展開所有 <details>。
 * 加上 --formulas 會另外列出「比欄位寬、要橫向捲動的獨立公式」（WIDE-FORMULA，屬於 ok 類，預設不印）：
 * 桌機上這種公式通常可以拆成對齊的兩行，就不需要捲軸。
 */
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import puppeteer from 'puppeteer-core'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1] ?? '']] : acc), []),
)
const base = (args.base ?? 'http://localhost:5173').replace(/\/$/, '')
const routes = (args.routes ?? '/').split(',')
const vp = args.viewport === 'mobile' ? { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 900 }
const mode = args.mode ?? 'research'
const chrome = args.chrome ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

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

const profileDir = join(tmpdir(), `lmspll-scroll-${process.pid}`)
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  userDataDir: profileDir,
  args: ['--no-first-run', '--no-default-browser-check'],
})
const all = []
try {
  for (const route of routes) {
    const rows = await withRetry(route, async () => {
      const page = await browser.newPage()
      await page.setViewport(vp)
      await page.evaluateOnNewDocument((m) => localStorage.setItem('lmspll.mode', m), mode)
      await page.goto(`${base}/#${route}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
      await page.waitForSelector('article.page', { timeout: 60000 })
      try {
        return await page.evaluate(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
          document.querySelectorAll('details').forEach((d) => (d.open = true))
          await sleep(300)
          // 讓延後渲染的圖與圖表都畫出來：整頁慢慢捲一遍
          const step = Math.max(400, window.innerHeight * 0.8)
          for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
            window.scrollTo(0, y)
            await sleep(120)
          }
          for (let t = 0; t < 150 && document.querySelector('.c-mermaid-loading'); t++) await sleep(100)
          await sleep(400)
          window.scrollTo(0, 0)
    
          const describe = (el) => {
            const parts = []
            for (let e = el, i = 0; e && e !== document.body && i < 4; e = e.parentElement, i++) {
              const cls = typeof e.className === 'string' && e.className ? `.${e.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''
              parts.unshift(`${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${cls}`)
            }
            return parts.join(' > ')
          }
          const out = []
          const main = document.querySelector('main.content') ?? document.body
          for (const el of main.querySelectorAll('*')) {
            const cs = getComputedStyle(el)
            const sx = cs.overflowX === 'auto' || cs.overflowX === 'scroll'
            const sy = cs.overflowY === 'auto' || cs.overflowY === 'scroll'
            if (!sx && !sy) continue
            const dx = sx ? el.scrollWidth - el.clientWidth : 0
            const dy = sy ? el.scrollHeight - el.clientHeight : 0
            const forced = (cs.overflowX === 'scroll' || cs.overflowY === 'scroll') && dx <= 0 && dy <= 0
            if (dx <= 0 && dy <= 0 && !forced) continue
            if (el.clientWidth === 0 || el.clientHeight === 0) continue
            // 方塊圖的外框本身（.c-mermaid-svg）是刻意可橫向捲動的；要抓的是圖「裡面」的捲軸
            const inDiagram = !!el.closest('figure.c-mermaid svg')
            const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50)
            let kind = 'ok'
            if (inDiagram) kind = 'DIAGRAM'
            else if (forced) kind = 'TINY'
            else if (Math.max(dx, 0) <= 6 && Math.max(dy, 0) <= 6) kind = 'TINY'
            else if (dy > 6 && dy <= 60 && dx <= 6) kind = 'VERT'
            out.push({ kind, dx: Math.max(dx, 0), dy: Math.max(dy, 0), where: describe(el), text, overflow: `${cs.overflowX}/${cs.overflowY}`, w: el.clientWidth, h: el.clientHeight })
          }
          return out
        })
      } finally {
        await page.close().catch(() => undefined)
      }
    })
    for (const r of rows) all.push({ route, ...r })
    const bad = rows.filter((r) => r.kind !== 'ok')
    console.log(`\n${route}：${rows.length} 個可捲動的區塊，其中 ${bad.length} 個需要看（DIAGRAM ${bad.filter((r) => r.kind === 'DIAGRAM').length}、TINY ${bad.filter((r) => r.kind === 'TINY').length}、VERT ${bad.filter((r) => r.kind === 'VERT').length}）`)
    if (args.formulas !== undefined) {
      const wide = rows.filter((r) => r.kind === 'ok' && /katex-display/.test(r.where) && r.dx > 0)
      console.log(`  （比欄位寬的獨立公式：${wide.length} 條）`)
      for (const r of wide) console.log(`  WIDE-FORMULA x+${r.dx}  ${r.w}x${r.h}  ${r.where}  「${r.text}」`)
    }
    for (const r of bad) console.log(`  ${r.kind.padEnd(7)} x+${r.dx} y+${r.dy}  ${r.w}x${r.h}  ${r.where}  「${r.text}」`)
  }
} finally {
  await browser.close()
  rmSync(profileDir, { recursive: true, force: true })
}
if (args.json) writeFileSync(args.json, JSON.stringify(all, null, 1))
