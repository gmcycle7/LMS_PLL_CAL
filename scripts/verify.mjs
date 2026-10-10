#!/usr/bin/env node
// 驗證管線：執行 Vitest（TypeScript）與 pytest（Python golden model），
// 依測試名稱中的 T-id（T01–T18）彙整成 src/data/verification-status.json。
//
// T-id 對應規則（docs/dev-conventions.md §6）：
//   TS     ：測試 title（不含 describe）以 `T05:` 開頭；可列多個，如 `T04/T05: ...`、`T04, T05：...`
//   Python ：函式名稱以 `test_T05_` 開頭（含 parametrize 的 `[...]`）
// 只在名稱「中間」提到 T-id（例如 describe 標題或 `TestBadge T02 → partial`）不算驗證該 T-id。
//
// 用法：
//   node scripts/verify.mjs            # 執行兩邊測試並更新狀態檔
//   node scripts/verify.mjs --no-run   # 不重跑，只解析 outputs/ 內既有的報告
//   node scripts/verify.mjs --strict   # 另外把「未對應 T-id 的失敗」與「無法載入的測試檔」視為失敗
//
// 判定（每個 T-id）：
//   fail    任一邊有失敗的測試
//   pass    TS 與 Python 都有通過的測試，且沒有失敗
//   partial 只有一邊有通過的測試，且沒有失敗
//   missing 兩邊都沒有對應測試
// 結束碼：任一 T-id 為 fail ⇒ 1；--strict 下若有未對應的失敗 / 載入錯誤 / 缺報告 ⇒ 1；否則 0。

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'outputs')
const VITEST_JSON = path.join(OUT_DIR, 'vitest-results.json')
const PYTEST_XML = path.join(OUT_DIR, 'pytest-results.xml')
const STATUS_JSON = path.join(ROOT, 'src', 'data', 'verification-status.json')
const T_IDS = Array.from({ length: 18 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`)
const DEFAULT_NOTE = '由 `npm run verify` 產生；status=pass 代表 TypeScript 與 Python golden 測試皆通過。'

const args = new Set(process.argv.slice(2))
const NO_RUN = args.has('--no-run')
const STRICT = args.has('--strict')
const IS_WIN = process.platform === 'win32'

const TS_PREFIX = /^\s*(T\d{2}(?:\s*[/,、&+＋]\s*T\d{2})*)\s*[:：]/
const PY_PREFIX = /^test_(T\d{2})(?=_|\[|$)/

/** TS：title 開頭的 `Txx:`（或 `Txx/Tyy:`）列出的 T-id。 */
function tsIds(title) {
  const m = TS_PREFIX.exec(title)
  return m ? [...new Set(m[1].match(/T\d{2}/g))] : []
}

/** Python：`test_Txx_...` 的 T-id。 */
function pyIds(name) {
  const m = PY_PREFIX.exec(name)
  return m ? [m[1]] : []
}

function run(label, cmd, cmdArgs) {
  console.log(`\n▶ ${label}: ${cmd} ${cmdArgs.join(' ')}`)
  const res = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', shell: IS_WIN, env: process.env })
  if (res.error) {
    console.warn(`⚠ ${label} 無法啟動：${res.error.message}`)
    return { code: -1 }
  }
  console.log(`◀ ${label} 結束碼 ${res.status}`)
  return { code: res.status ?? -1 }
}

function decodeXml(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** 解析 Vitest JSON reporter（Jest 相容格式）。回傳 { cases, suiteErrors, ok }。 */
function parseVitest(file) {
  if (!existsSync(file)) return { cases: [], suiteErrors: [], ok: false }
  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    console.warn(`⚠ 無法解析 ${path.relative(ROOT, file)}：${e.message}`)
    return { cases: [], suiteErrors: [], ok: false }
  }
  const cases = []
  const suiteErrors = []
  for (const suite of data.testResults ?? []) {
    const rel = path.relative(ROOT, suite.name ?? '')
    const assertions = suite.assertionResults ?? []
    if (suite.status === 'failed' && assertions.every((a) => a.status !== 'failed')) {
      suiteErrors.push(`${rel}: ${(suite.message ?? '').split('\n')[0] || '測試檔執行失敗'}`)
    }
    for (const a of assertions) {
      const full = a.fullName || [...(a.ancestorTitles ?? []), a.title].join(' ')
      const status = a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'skipped'
      cases.push({ name: `${path.basename(rel)} › ${full}`, ids: tsIds(a.title ?? ''), status })
    }
  }
  return { cases, suiteErrors, ok: true }
}

/** 解析 pytest --junitxml。 */
function parseJunit(file) {
  if (!existsSync(file)) return { cases: [], suiteErrors: [], ok: false }
  const xml = readFileSync(file, 'utf8')
  const cases = []
  const suiteErrors = []
  const re = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g
  for (const m of xml.matchAll(re)) {
    const attrs = {}
    for (const a of m[1].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = decodeXml(a[2])
    const body = m[2] ?? ''
    const failed = /<(failure|error)\b/.test(body)
    const skipped = !failed && /<skipped\b/.test(body)
    const cls = attrs.classname ?? ''
    const fileLike = cls ? `${cls.replace(/\./g, '/')}.py` : ''
    const name = fileLike ? `${fileLike}::${attrs.name}` : attrs.name ?? '(unknown)'
    if (failed && !cls) {
      suiteErrors.push(`${attrs.name}: collection error`)
      continue
    }
    cases.push({ name, ids: pyIds(attrs.name ?? ''), status: failed ? 'failed' : skipped ? 'skipped' : 'passed' })
  }
  return { cases, suiteErrors, ok: true }
}

function tally(cases) {
  const per = Object.fromEntries(T_IDS.map((id) => [id, { passed: 0, failed: 0, names: [] }]))
  const unmapped = { passed: 0, failed: 0, failedNames: [] }
  const unknownIds = new Set()
  for (const c of cases) {
    if (c.status === 'skipped') continue
    const ids = c.ids.filter((id) => {
      if (per[id]) return true
      unknownIds.add(id)
      return false
    })
    if (ids.length === 0) {
      unmapped[c.status] += 1
      if (c.status === 'failed') unmapped.failedNames.push(c.name)
      continue
    }
    for (const id of ids) {
      per[id][c.status] += 1
      per[id].names.push(c.status === 'failed' ? `${c.name} [FAILED]` : c.name)
    }
  }
  return { per, unmapped, unknownIds: [...unknownIds] }
}

function statusOf(ts, py) {
  if (ts.failed > 0 || py.failed > 0) return 'fail'
  if (ts.passed > 0 && py.passed > 0) return 'pass'
  if (ts.passed > 0 || py.passed > 0) return 'partial'
  return 'missing'
}

function gitCommit() {
  const res = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', shell: IS_WIN })
  const out = (res.stdout ?? '').trim()
  return res.status === 0 && out ? out : 'uncommitted'
}

function pad(s, n) {
  s = String(s)
  return s + ' '.repeat(Math.max(0, n - s.length))
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  if (!NO_RUN) {
    for (const f of [VITEST_JSON, PYTEST_XML]) rmSync(f, { force: true })
    run('Vitest', IS_WIN ? 'npx.cmd' : 'npx', [
      'vitest',
      'run',
      '--reporter=default',
      '--reporter=json',
      `--outputFile=${path.relative(ROOT, VITEST_JSON)}`,
    ])
    run('pytest', process.env.PYTHON || 'python3', ['-m', 'pytest', 'golden', '-q', `--junitxml=${path.relative(ROOT, PYTEST_XML)}`])
  }

  const ts = parseVitest(VITEST_JSON)
  const py = parseJunit(PYTEST_XML)
  const tsT = tally(ts.cases)
  const pyT = tally(py.cases)

  let note = DEFAULT_NOTE
  if (existsSync(STATUS_JSON)) {
    try {
      note = JSON.parse(readFileSync(STATUS_JSON, 'utf8')).note ?? DEFAULT_NOTE
    } catch {
      /* 舊檔損毀時使用預設說明 */
    }
  }
  const tests = {}
  for (const id of T_IDS) {
    tests[id] = { status: statusOf(tsT.per[id], pyT.per[id]), ts: tsT.per[id], py: pyT.per[id] }
  }
  const out = { generatedAt: new Date().toISOString(), commit: gitCommit(), note, tests }
  writeFileSync(STATUS_JSON, JSON.stringify(out, null, 2) + '\n', 'utf8')

  // ---- 摘要 ----
  console.log('\n驗證摘要（T01–T18）')
  console.log(`${pad('ID', 5)}${pad('狀態', 10)}${pad('TS 通過/失敗', 14)}${pad('Python 通過/失敗', 16)}`)
  console.log('-'.repeat(45))
  const counts = { pass: 0, partial: 0, fail: 0, missing: 0 }
  for (const id of T_IDS) {
    const t = tests[id]
    counts[t.status] += 1
    console.log(`${pad(id, 5)}${pad(t.status, 10)}${pad(`${t.ts.passed}/${t.ts.failed}`, 14)}${pad(`${t.py.passed}/${t.py.failed}`, 16)}`)
  }
  console.log('-'.repeat(45))
  console.log(`pass ${counts.pass}｜partial ${counts.partial}｜fail ${counts.fail}｜missing ${counts.missing}`)
  console.log(`未對應 T-id 的測試：TS ${tsT.unmapped.passed} 通過 / ${tsT.unmapped.failed} 失敗；Python ${pyT.unmapped.passed} 通過 / ${pyT.unmapped.failed} 失敗`)

  const problems = []
  if (!ts.ok) problems.push(`找不到或無法解析 Vitest 報告（${path.relative(ROOT, VITEST_JSON)}）`)
  if (!py.ok) problems.push(`找不到或無法解析 pytest 報告（${path.relative(ROOT, PYTEST_XML)}）`)
  for (const e of [...ts.suiteErrors, ...py.suiteErrors]) problems.push(`測試檔載入/收集失敗：${e}`)
  for (const n of [...tsT.unmapped.failedNames, ...pyT.unmapped.failedNames]) problems.push(`未對應 T-id 的失敗：${n}`)
  for (const p of problems) console.warn(`⚠ ${p}`)
  const unknown = [...new Set([...tsT.unknownIds, ...pyT.unknownIds])]
  if (unknown.length) console.warn(`⚠ 測試名稱含 T01–T18 以外的 id（已忽略）：${unknown.join(', ')}`)

  console.log(`\n已寫入 ${path.relative(ROOT, STATUS_JSON)}（commit ${out.commit}）`)
  const strictFail = STRICT && problems.length > 0
  if (counts.fail > 0 || strictFail) {
    console.error(counts.fail > 0 ? `✗ ${counts.fail} 個 T-id 失敗` : '✗ --strict：存在未對應的失敗或報告問題')
    process.exitCode = 1
  }
}

main()
