#!/usr/bin/env node
// 建置大小預算：檢查 vite build 產生的 JavaScript chunk 沒有悄悄變大。
//
// 用法：
//   node scripts/check-bundle-size.mjs [distDir]            # 預設 dist；先跑 `npx vite build`
//   node scripts/check-bundle-size.mjs --update-baseline    # 量完把這次的大小寫進 scripts/bundle-baseline.json（刻意變大／變小之後）
//   node scripts/check-bundle-size.mjs --self-test          # 只驗證本腳本的判定邏輯（不讀 dist）
//
// 預算（原始位元組，即磁碟上的檔案大小，不是 gzip）：
//   plotly   檔名以 `plotly` 開頭的 chunk（plotly.js-cartesian-dist-min，lazy-load）
//   app      其餘 chunk 中最大的那一個（vite.config.ts 的 chunkFileName 讓路由 chunk 叫 `chapter-chNN-*.js`／`page-<名稱>-*.js`，
//            所以表格裡看得出是哪一章／哪一頁；目前是 `page-case-sspll`）
//   total    所有 JS chunk 的總和
//
// 成長警告（不影響結束碼）：和 scripts/bundle-baseline.json（git 裡的基準檔）比，plotly／app／total 或任何一個 chunk 家族
// （檔名去掉 hash，例如 `chapter-ch05`、`page-lab`、`mermaid.core`）成長超過 10% 就印警告，家族要同時增加至少 20,000 B 才算
// （避免小檔案的幾百位元組浮動洗版）。預算是「絕對不能超過」的上限，警告是「這次比上次明顯變大，請確認是刻意的」。
// 基準檔過期（例如大量內容合併之後）用 --update-baseline 重產；它是 build 產物的摘要，不是手寫的。
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
// wave 3（2026-10-19，improve-wave-3 perf-more）：路由 chunk 改名（chapter-chNN／page-<名稱>）、新增 worker pool：
// plotly 1,385,481 B、最大的非 plotly chunk 是 page-case-sspll 757,051 B、total 17,564,533 B／213 個檔案
// （scripts/bundle-baseline.json 就是這次的量測）。BUDGETS 沒有動；app 其實只用了 63%，要收緊請在其他 scope 合併後重量再決定。
//
// 如何收緊：
//   1. 每次把 chunk 拆小之後，從 `node scripts/check-bundle-size.mjs` 的輸出讀到新的實測值，
//      把 BUDGETS 的那一項改成「實測值 +10%」（例如 app 現在可以收到約 970,000 B）。
//   2. 預算只能往下調；要調高必須在 PR 說明理由（例如升級 plotly 或新增一個 Mermaid 圖種）。
//   3. --self-test 用的是固定的測試預算，不受 BUDGETS 影響，收緊後不必改它。
//
// 結束碼：0 通過；1 有項目超過預算；2 用法錯誤或找不到 dist／plotly chunk。
// 在 GitHub Actions 內會把結果表格附加到 $GITHUB_STEP_SUMMARY。

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

/** 預算（位元組）。見檔頭「數字來源」與「如何收緊」。 */
export const BUDGETS = {
  plotly: 1_530_000,
  app: 1_200_000,
  total: 19_400_000,
}

const PLOTLY_NAME = /^plotly/i

/** 成長警告的門檻：比基準檔大超過 10%，且 chunk 家族至少多 20,000 B */
export const GROWTH_RATIO = 0.1
export const GROWTH_MIN_BYTES = 20_000

const BASELINE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bundle-baseline.json')

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

/** chunk 檔名去掉尾端的 `-<hash>.js`：同一個 chunk 在不同次建置的名字一樣（`chapter-ch05-AbCd1234.js` → `chapter-ch05`） */
export function familyOf(name) {
  return name.replace(/-[A-Za-z0-9_-]{8}\.js$/, '').replace(/\.js$/, '')
}

/**
 * 一次建置的摘要（基準檔的內容）：plotly／app／total 位元組，以及每個 chunk 家族的位元組總和（同名家族相加）。
 * @param {Chunk[]} chunks
 */
export function summarize(chunks) {
  const plotly = chunks.filter((c) => PLOTLY_NAME.test(c.name))
  const rest = chunks.filter((c) => !PLOTLY_NAME.test(c.name))
  const biggest = (list) => list.reduce((a, b) => (b.bytes > a.bytes ? b : a), { name: '', bytes: 0 })
  /** @type {Record<string, number>} */
  const families = {}
  for (const c of chunks) families[familyOf(c.name)] = (families[familyOf(c.name)] ?? 0) + c.bytes
  const sorted = Object.fromEntries(Object.entries(families).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  return {
    plotly: biggest(plotly).bytes,
    app: biggest(rest).bytes,
    appFamily: familyOf(biggest(rest).name),
    total: chunks.reduce((s, c) => s + c.bytes, 0),
    chunks: chunks.length,
    families: sorted,
  }
}

/**
 * 和基準檔比較，回傳警告文字（空陣列 = 沒有明顯成長）。純函式。
 * @param {ReturnType<typeof summarize>} now
 * @param {ReturnType<typeof summarize> | null} baseline
 * @returns {string[]}
 */
export function compareToBaseline(now, baseline, ratio = GROWTH_RATIO, minBytes = GROWTH_MIN_BYTES) {
  if (!baseline) return []
  const warnings = []
  const grew = (a, b) => b > 0 && a > b * (1 + ratio)
  const pct = (a, b) => `+${(((a - b) / b) * 100).toFixed(1)}%`
  for (const [label, key] of [
    ['plotly chunk', 'plotly'],
    ['最大的非 plotly chunk', 'app'],
    ['所有 JS 總和', 'total'],
  ]) {
    if (grew(now[key], baseline[key])) {
      warnings.push(`${label}比基準檔大 ${pct(now[key], baseline[key])}（${fmt(baseline[key])} B → ${fmt(now[key])} B）`)
    }
  }
  for (const [family, bytes] of Object.entries(now.families)) {
    const before = baseline.families?.[family]
    if (before === undefined) {
      if (bytes >= minBytes) warnings.push(`新的 chunk「${family}」${fmt(bytes)} B（基準檔裡沒有）`)
    } else if (grew(bytes, before) && bytes - before >= minBytes) {
      warnings.push(`chunk「${family}」比基準檔大 ${pct(bytes, before)}（${fmt(before)} B → ${fmt(bytes)} B）`)
    }
  }
  return warnings
}

function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  } catch {
    return null
  }
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

  // 成長警告：基準檔比較
  expect(familyOf('chapter-ch05-AbCd1234.js') === 'chapter-ch05', 'familyOf 去掉 hash')
  expect(familyOf('plotly-cartesian.min-ts87UKKN.js') === 'plotly-cartesian.min', 'familyOf 保留名稱中的 .min')
  expect(familyOf('gitGraph-YCYPL57B-CZUSdKKV.js') === 'gitGraph-YCYPL57B', 'familyOf 只去掉最後一段 hash')
  const sum0 = summarize([chunk('plotly.min-a1b2c3d4.js', 1_000_000), chunk('chapter-ch05-a1b2c3d4.js', 400_000), chunk('chapter-ch05-b1b2c3d4.js', 100_000), chunk('page-lab-a1b2c3d4.js', 300_000)])
  expect(sum0.total === 1_800_000 && sum0.app === 400_000 && sum0.appFamily === 'chapter-ch05', 'summarize：total／app／appFamily')
  expect(sum0.families['chapter-ch05'] === 500_000, 'summarize：同名家族相加')
  expect(compareToBaseline(sum0, sum0).length === 0, '和自己比不該有警告')
  expect(compareToBaseline(sum0, null).length === 0, '沒有基準檔就不警告')
  const grown = summarize([chunk('plotly.min-a1b2c3d4.js', 1_000_000), chunk('chapter-ch05-a1b2c3d4.js', 400_000), chunk('chapter-ch05-b1b2c3d4.js', 100_000), chunk('page-lab-a1b2c3d4.js', 345_000)])
  const w1 = compareToBaseline(grown, sum0)
  expect(w1.length === 1 && w1[0].includes('page-lab'), '家族 +15%（+45,000 B）與總和 +2.5%：只有 page-lab 成長超過門檻；總和沒超過 10% 不該警告')
  const tinyBase = summarize([chunk('plotly.min-a1b2c3d4.js', 1_000_000), chunk('big-a1b2c3d4.js', 500_000), chunk('tiny-a1b2c3d4.js', 1_000)])
  const smallGrown = summarize([chunk('plotly.min-a1b2c3d4.js', 1_000_000), chunk('big-a1b2c3d4.js', 500_000), chunk('tiny-a1b2c3d4.js', 1_500)])
  expect(compareToBaseline(smallGrown, tinyBase).length === 0, '小 chunk +50% 但只多 500 B：低於 20,000 B 不警告')
  const brandNew = summarize([chunk('plotly.min-a1b2c3d4.js', 1_000_000), chunk('big-a1b2c3d4.js', 500_000), chunk('tiny-a1b2c3d4.js', 1_000), chunk('newpage-a1b2c3d4.js', 50_000)])
  expect(compareToBaseline(brandNew, tinyBase).some((x) => x.includes('新的 chunk「newpage」')), '基準檔沒有的大 chunk 要提示')
  const exactly = summarize([chunk('plotly.min-a1b2c3d4.js', 1_100_000)])
  expect(compareToBaseline(exactly, summarize([chunk('plotly.min-a1b2c3d4.js', 1_000_000)])).length === 0, '剛好 +10% 不警告（超過才警告）')

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
  const now = summarize(chunks)
  if (argv.includes('--update-baseline')) {
    const { families, ...rest } = now
    writeFileSync(
      BASELINE_PATH,
      JSON.stringify({ note: '由 `node scripts/check-bundle-size.mjs --update-baseline` 產生；見該腳本檔頭「成長警告」', generatedAt: new Date().toISOString().slice(0, 10), ...rest, families }, null, 2) + '\n',
    )
    console.log(`\n已更新基準檔 ${path.relative(process.cwd(), BASELINE_PATH)}（${now.chunks} 個檔案，total ${fmt(now.total)} B）。`)
  } else {
    const baseline = readBaseline()
    const growth = compareToBaseline(now, baseline)
    if (!baseline) console.log('\n（沒有 scripts/bundle-baseline.json，略過成長比較；用 --update-baseline 產生。）')
    else if (growth.length === 0) console.log(`\n成長比較：和基準檔（${baseline.generatedAt ?? '?'}）相比沒有超過 10% 的成長。`)
    else {
      console.log(`\n成長警告（相對基準檔 ${baseline.generatedAt ?? '?'}，門檻 +10%；不影響結束碼）：`)
      for (const w of growth) {
        console.log(`  - ${w}`)
        if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Bundle 成長::${w}`)
      }
      console.log('若是刻意的，用 `node scripts/check-bundle-size.mjs --update-baseline` 更新基準檔並在 PR 說明。')
    }
    if (process.env.GITHUB_STEP_SUMMARY && growth.length > 0) {
      try {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n**成長警告**\n\n${growth.map((w) => `- ${w}`).join('\n')}\n`)
      } catch {
        /* 摘要寫不進去不影響判定 */
      }
    }
  }
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
