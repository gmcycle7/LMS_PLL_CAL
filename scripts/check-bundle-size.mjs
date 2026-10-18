#!/usr/bin/env node
// 建置大小預算：檢查 vite build 產生的 JavaScript chunk 沒有悄悄變大。
//
// 用法：
//   node scripts/check-bundle-size.mjs [distDir]   # 預設 dist；先跑 `npx vite build`
//   node scripts/check-bundle-size.mjs --self-test # 只驗證本腳本的判定邏輯（不讀 dist）
//
// 預算（原始位元組，即磁碟上的檔案大小，不是 gzip）：
//   plotly   檔名以 `plotly` 開頭的 chunk（plotly.js-cartesian-dist-min，lazy-load）
//   app      其餘 chunk 中最大的那一個（目前是主 chunk `index-*.js`）
//   total    所有 JS chunk 的總和
//
// 數字來源：2026-10-16 在 improve-wave-1 工作樹（main 527d28f 之後）實測：plotly 4,674,997 B、
// app（index-*.js 主 chunk）879,247 B、total 20,789,875 B／198 個檔案。main 527d28f 上主 chunk 原本是
// 2,192,706 B，wave 1 把它拆小了（case-sspll 的 1.4 MB 資料改成 lazy 載入）；若主 chunk 又回到
// 那個大小，這個檢查會失敗，那是刻意的。
// wave 2（2026-10-16，improve-wave-2）把 plotly.js-dist-min 換成 plotly.js-cartesian-dist-min（同 2.35.2）：
// plotly chunk 1,385,481 B（gzip 473,834 B；原本 4,674,997 B／gzip 1,416,632 B，即 raw −70.4%、gzip −66.6%）；
// review 時整個 wave-2 工作樹建置出來 total 17,549,945 B／213 個檔案（含其他 scope 當時的修改）。
// 預算：plotly 1,530,000 B（實測值 +10% = 1,524,029 B 進位到 0.01 MB；換回完整版或加進 gl2d／3D 的 bundle 都會超過）、
// app 1,200,000 B（review 定的上限；目前用了 63%）、total 19,400,000 B（實測值 +10% = 19,304,940 B 進位到 0.1 MB；
// wave 2 合併後請用 `node scripts/check-bundle-size.mjs` 重量一次，若其他 scope 加了大 chunk 要在 PR 裡說明並調整）。
//
// 如何收緊：
//   1. 每次把 chunk 拆小之後，從 `node scripts/check-bundle-size.mjs` 的輸出讀到新的實測值，
//      把 BUDGETS 的那一項改成「實測值 +10%」（例如 app 現在可以收到約 970,000 B）。
//   2. 預算只能往下調；要調高必須在 PR 說明理由（例如升級 plotly 或新增一個 Mermaid 圖種）。
//   3. --self-test 用的是固定的測試預算，不受 BUDGETS 影響，收緊後不必改它。
//
// 結束碼：0 通過；1 有項目超過預算；2 用法錯誤或找不到 dist／plotly chunk。
// 在 GitHub Actions 內會把結果表格附加到 $GITHUB_STEP_SUMMARY。

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

/** 預算（位元組）。見檔頭「數字來源」與「如何收緊」。 */
export const BUDGETS = {
  plotly: 1_530_000,
  app: 1_200_000,
  total: 19_400_000,
}

const PLOTLY_NAME = /^plotly/i

/** @typedef {{ name: string, bytes: number, gzip?: number }} Chunk */

/**
 * 依預算判定一組 chunk。純函式，不碰檔案系統。
 * @param {Chunk[]} chunks
 * @param {typeof BUDGETS} budgets
 * @returns {{ ok: boolean, errors: string[], rows: { label: string, chunk: string, bytes: number, budget: number, pct: number, over: boolean }[] }}
 */
export function evaluate(chunks, budgets = BUDGETS) {
  const errors = []
  const plotly = chunks.filter((c) => PLOTLY_NAME.test(c.name))
  const rest = chunks.filter((c) => !PLOTLY_NAME.test(c.name))
  if (chunks.length === 0) errors.push('找不到任何 JavaScript chunk（dist/assets/*.js 是空的）')
  else if (plotly.length === 0) {
    errors.push('找不到 plotly chunk（檔名應以 "plotly" 開頭）；若 vite 的 chunk 命名改了，請更新 scripts/check-bundle-size.mjs 的 PLOTLY_NAME')
  }
  if (errors.length > 0) return { ok: false, errors, rows: [] }

  const biggest = (list) => list.reduce((a, b) => (b.bytes > a.bytes ? b : a))
  const rows = []
  const add = (label, chunk, bytes, budget) =>
    rows.push({ label, chunk, bytes, budget, pct: (bytes / budget) * 100, over: bytes > budget })
  const p = biggest(plotly)
  add('plotly chunk', p.name, p.bytes, budgets.plotly)
  if (rest.length > 0) {
    const a = biggest(rest)
    add('最大的非 plotly chunk', a.name, a.bytes, budgets.app)
  }
  add('所有 JS 總和', `${chunks.length} 個檔案`, chunks.reduce((s, c) => s + c.bytes, 0), budgets.total)
  return { ok: rows.every((r) => !r.over), errors: [], rows }
}

const fmt = (n) => n.toLocaleString('en-US')
const mb = (n) => `${(n / 1_000_000).toFixed(2)} MB`

/** @param {string} distDir */
function readChunks(distDir) {
  const assets = path.join(distDir, 'assets')
  if (!existsSync(assets)) return null
  return readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .map((f) => {
      const file = path.join(assets, f)
      return { name: f, bytes: statSync(file).size, gzip: gzipSync(readFileSync(file)).length }
    })
}

function report(chunks, result) {
  const lines = []
  lines.push('| 項目 | 檔案 | 大小 | gzip | 預算 | 使用率 | 結果 |')
  lines.push('|---|---|---:|---:|---:|---:|---|')
  for (const r of result.rows) {
    const c = chunks.find((x) => x.name === r.chunk)
    lines.push(
      `| ${r.label} | ${r.chunk} | ${fmt(r.bytes)} B | ${c?.gzip ? fmt(c.gzip) + ' B' : '-'} | ${fmt(r.budget)} B | ${r.pct.toFixed(1)}% | ${r.over ? '超出' : '通過'} |`,
    )
  }
  const slack = result.rows.filter((r) => r.label !== '所有 JS 總和' && !r.over && r.bytes * 1.1 < r.budget)
  if (slack.length > 0) {
    lines.push('')
    lines.push(
      `可以收緊：${slack.map((r) => `${r.label} 目前 ${mb(r.bytes)}，預算 ${mb(r.budget)}，可收到實測值 +10% ≈ ${mb(Math.ceil((r.bytes * 1.1) / 10_000) * 10_000)}`).join('；')}。`,
    )
  }
  return lines.join('\n')
}

function selfTest() {
  const chunk = (name, bytes) => ({ name, bytes })
  const failures = []
  const expect = (cond, msg) => {
    if (!cond) failures.push(msg)
  }

  // 判定邏輯用「固定的測試預算」驗證，和 BUDGETS 無關：之後照檔頭的做法收緊 BUDGETS 時，
  // self-test 不會因為這裡的假 chunk 比新預算大而失敗。
  const B = { plotly: 5_000_000, app: 2_400_000, total: 20_000_000 }
  const base = [chunk('plotly.min-abc.js', 4_700_000), chunk('index-abc.js', 2_200_000), chunk('mermaid.core-abc.js', 500_000)]

  const ok = evaluate(base, B)
  expect(ok.ok && ok.rows.length === 3, '預算內的大小應該通過（三列：plotly、app、total）')
  expect(ok.rows[1].chunk === 'index-abc.js', 'app 列應取最大的非 plotly chunk')

  const appOver = evaluate([...base, chunk('index-big.js', B.app + 1)], B)
  expect(!appOver.ok && appOver.rows.find((r) => r.label.startsWith('最大的非'))?.over === true, 'app chunk 超過預算 1 B 應該失敗')

  const plotlyAtLimit = evaluate([chunk('plotly.min-x.js', B.plotly), chunk('index-x.js', 1000)], B)
  expect(plotlyAtLimit.ok, 'plotly 剛好等於預算應該通過（只有「超過」才失敗）')
  const plotlyOver = evaluate([chunk('plotly.min-x.js', B.plotly + 1), chunk('index-x.js', 1000)], B)
  expect(!plotlyOver.ok && plotlyOver.rows[0].over, 'plotly 超過預算應該失敗')

  const totalOver = evaluate([chunk('plotly.min-x.js', 4_000_000), ...Array.from({ length: 9 }, (_, i) => chunk(`c${i}-x.js`, 2_000_000))], B)
  expect(!totalOver.ok && totalOver.rows.every((r) => r.label !== '所有 JS 總和' || r.over), '總和超過預算應該失敗')
  expect(totalOver.rows.filter((r) => r.over).length === 1, '只有總和超標時，不應連帶判 app／plotly 失敗')

  const noPlotly = evaluate([chunk('index-x.js', 1000)], B)
  expect(!noPlotly.ok && noPlotly.errors.length === 1, '找不到 plotly chunk 應該是錯誤（避免命名改了之後預算悄悄失效）')
  expect(!evaluate([], B).ok, '空的 dist 應該是錯誤')

  const strict = evaluate(base, { plotly: 1, app: 1, total: 1 })
  expect(strict.rows.every((r) => r.over), '把預算調成 1 B 時三項都應該超出（預算參數確實被讀取）')

  // 不傳 budgets 時用的是 BUDGETS：各項剛好超過 1 B 都要失敗、一半大小要通過。
  const half = (n) => Math.floor(n / 2)
  const small = [chunk('plotly.min-d.js', half(BUDGETS.plotly)), chunk('index-d.js', half(BUDGETS.app))]
  expect(evaluate(small).ok, '預設 BUDGETS：plotly 與 app 各一半大小應該通過')
  const defApp = evaluate([chunk('plotly.min-d.js', half(BUDGETS.plotly)), chunk('index-d.js', BUDGETS.app + 1)])
  expect(defApp.rows[1].over && !defApp.rows[0].over, '預設 BUDGETS.app 有被讀取')
  const defPlotly = evaluate([chunk('plotly.min-d.js', BUDGETS.plotly + 1), chunk('index-d.js', half(BUDGETS.app))])
  expect(defPlotly.rows[0].over && !defPlotly.rows[1].over, '預設 BUDGETS.plotly 有被讀取')
  expect(BUDGETS.plotly <= BUDGETS.total && BUDGETS.app <= BUDGETS.total, 'BUDGETS.total 不能小於單一 chunk 的預算')

  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL: ${f}`)
    return 1
  }
  console.log(`check-bundle-size self-test: 通過（BUDGETS plotly ${fmt(BUDGETS.plotly)} / app ${fmt(BUDGETS.app)} / total ${fmt(BUDGETS.total)} B）`)
  return 0
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest()
  const distDir = path.resolve(argv.find((a) => !a.startsWith('-')) ?? 'dist')
  const chunks = readChunks(distDir)
  if (chunks === null) {
    console.error(`找不到 ${path.join(distDir, 'assets')}：請先執行 \`npx vite build\`。`)
    return 2
  }
  const result = evaluate(chunks)
  if (result.errors.length > 0) {
    for (const e of result.errors) console.error(`錯誤：${e}`)
    return 2
  }
  const table = report(chunks, result)
  console.log(table)
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Bundle 大小預算\n\n${table}\n`)
    } catch {
      /* 摘要寫不進去不影響判定 */
    }
  }
  if (!result.ok) {
    const over = result.rows.filter((r) => r.over)
    console.error(`\n超出預算：${over.map((r) => `${r.label}（${fmt(r.bytes)} B > ${fmt(r.budget)} B）`).join('、')}`)
    console.error('若是刻意增加（升級 plotly、新增圖種等），在 PR 說明理由後調高 scripts/check-bundle-size.mjs 的 BUDGETS。')
    return 1
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2))
}
