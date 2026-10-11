#!/usr/bin/env node
/**
 * 量每一頁每張方塊圖的實際尺寸，找出「比版面寬、要橫向捲動」或「縮得太小」的圖。
 *   node scripts/diagram-audit.mjs --base http://localhost:5173 --routes /ch/05,/ch/06 [--viewport desktop|mobile] [--json out.json]
 * 每張圖輸出：序號、圖說開頭、自然寬×高（px）、顯示倍率、超出版面的寬度（px，0 表示放得下）。
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import puppeteer from 'puppeteer-core'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1] ?? '']] : acc), []),
)
const base = (args.base ?? 'http://localhost:5173').replace(/\/$/, '')
const routes = (args.routes ?? '/').split(',')
const vp = args.viewport === 'mobile' ? { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 900 }
const chrome = args.chrome ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  userDataDir: join(tmpdir(), `lmspll-audit-${process.pid}`),
  args: ['--no-first-run', '--no-default-browser-check', '--hide-scrollbars'],
})
const all = []
try {
  for (const route of routes) {
    // 每一頁開新分頁：HashRouter 換 hash 不會重新載入，舊頁的圖會被誤算進來
    const page = await browser.newPage()
    await page.setViewport(vp)
    await page.goto(`${base}/#${route}`, { waitUntil: 'networkidle2', timeout: 120000 })
    await page.waitForSelector('article.page', { timeout: 60000 })
    const rows = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const figs = [...document.querySelectorAll('figure.c-mermaid')]
      const out = []
      for (let i = 0; i < figs.length; i++) {
        const f = figs[i]
        f.scrollIntoView({ block: 'center' })
        for (let t = 0; t < 120 && !f.querySelector('.c-mermaid-svg svg') && !f.querySelector('.c-mermaid-error'); t++) await sleep(100)
        await sleep(60)
        const svg = f.querySelector('.c-mermaid-svg svg')
        const box = f.querySelector('.c-mermaid-svg')
        const cap = f.querySelector('figcaption')?.cloneNode(true)
        cap?.querySelectorAll('.katex-mathml').forEach((n) => n.remove())
        const caption = (cap?.textContent ?? '').slice(0, 40)
        if (!svg || !box) {
          out.push({ i: i + 1, caption, error: (f.querySelector('.c-mermaid-error')?.textContent ?? 'not rendered').slice(0, 120) })
          continue
        }
        const vb = svg.viewBox.baseVal
        const shown = svg.getBoundingClientRect().width
        out.push({
          i: i + 1,
          caption,
          natural: `${Math.round(vb.width)}x${Math.round(vb.height)}`,
          scale: Number((shown / vb.width).toFixed(2)),
          overflow: Math.max(0, Math.round(box.scrollWidth - box.clientWidth)),
          unsupported: /Unsupported markdown/.test(svg.textContent ?? ''),
        })
      }
      return out
    })
    for (const r of rows) all.push({ route, ...r })
    await page.close()
    console.log(`\n${route}（${rows.length} 張）`)
    for (const r of rows) {
      const flag = r.error ? `ERROR ${r.error}` : `${r.natural}  ×${r.scale}${r.overflow ? `  超出 ${r.overflow}px` : ''}${r.unsupported ? '  UNSUPPORTED-MARKDOWN' : ''}`
      console.log(`  ${String(r.i).padStart(2)}  ${flag}  ${r.caption}`)
    }
  }
} finally {
  await browser.close()
}
if (args.json) writeFileSync(args.json, JSON.stringify(all, null, 1))
