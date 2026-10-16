#!/usr/bin/env node
// 檢查 src/data/verification-status.json（網站上「verified」徽章讀的快照）。
//
// 用法：
//   node scripts/verify-status-check.mjs --sanity [file]
//       便宜的檢查（CI fast job 用）：檔案可解析、T01–T18 都在、status 合法、
//       沒有 fail、也沒有任何失敗的測試。預設 file = src/data/verification-status.json。
//   node scripts/verify-status-check.mjs <committed.json> <fresh.json>
//       比對「已提交的快照」與「剛跑完 `npm run verify` 產生的快照」（每週 verify-status workflow 用）。
//       只比對有意義的欄位（每個 T-id 的 status、通過／失敗數、測試名稱集合）；
//       generatedAt、commit、note 每次都會變，一律忽略。有差異就以結束碼 1 失敗，
//       並列出差異，修法是在本機 `npm run verify` 後提交新的快照。
//   node scripts/verify-status-check.mjs --self-test
//       只驗證本腳本的判定邏輯。
//
// 結束碼：0 通過；1 有問題；2 用法錯誤或檔案讀不到。

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const T_IDS = Array.from({ length: 18 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`)
export const STATUSES = new Set(['pass', 'partial', 'fail', 'missing'])
const DEFAULT_FILE = 'src/data/verification-status.json'

/** @param {any} snap @returns {string[]} 問題清單（空陣列 = 沒問題） */
export function sanity(snap) {
  const problems = []
  if (snap === null || typeof snap !== 'object' || snap.tests === null || typeof snap.tests !== 'object') {
    return ['格式錯誤：缺少 tests 物件']
  }
  for (const id of T_IDS) {
    const t = snap.tests[id]
    if (!t) {
      problems.push(`${id}：快照裡沒有這個 T-id`)
      continue
    }
    if (!STATUSES.has(t.status)) problems.push(`${id}：status "${t.status}" 不合法（要是 ${[...STATUSES].join('／')}）`)
    if (t.status === 'fail') problems.push(`${id}：status 是 fail（網站會顯示驗證失敗）`)
    for (const side of ['ts', 'py']) {
      const s = t[side]
      if (!s || !Array.isArray(s.names) || !Number.isInteger(s.passed) || !Number.isInteger(s.failed)) {
        problems.push(`${id}.${side}：格式錯誤（要有 passed／failed 整數與 names 陣列）`)
        continue
      }
      if (s.failed > 0) problems.push(`${id}.${side}：有 ${s.failed} 項失敗的測試`)
      if (s.names.length !== s.passed + s.failed) {
        problems.push(`${id}.${side}：names 有 ${s.names.length} 筆，但 passed + failed = ${s.passed + s.failed}`)
      }
    }
  }
  for (const id of Object.keys(snap.tests)) {
    if (!T_IDS.includes(id)) problems.push(`${id}：不是 T01–T18 之一`)
  }
  return problems
}

/** 比較兩份快照，忽略 generatedAt／commit／note。回傳差異清單。 */
export function diffSnapshots(committed, fresh) {
  const diffs = []
  for (const id of T_IDS) {
    const a = committed?.tests?.[id]
    const b = fresh?.tests?.[id]
    if (!a || !b) {
      if (a || b) diffs.push(`${id}：只出現在${a ? '已提交的快照' : '新產生的快照'}`)
      continue
    }
    if (a.status !== b.status) diffs.push(`${id}：status ${a.status} → ${b.status}`)
    for (const side of ['ts', 'py']) {
      const x = a[side] ?? { passed: 0, failed: 0, names: [] }
      const y = b[side] ?? { passed: 0, failed: 0, names: [] }
      if (x.passed !== y.passed || x.failed !== y.failed) {
        diffs.push(`${id}.${side}：通過／失敗 ${x.passed}/${x.failed} → ${y.passed}/${y.failed}`)
      }
      const before = new Set(x.names)
      const after = new Set(y.names)
      const removed = [...before].filter((n) => !after.has(n))
      const added = [...after].filter((n) => !before.has(n))
      if (removed.length > 0 || added.length > 0) {
        const sample = (list) => list.slice(0, 2).join('；') + (list.length > 2 ? `…（共 ${list.length}）` : '')
        diffs.push(
          `${id}.${side}：測試名稱 -${removed.length} +${added.length}` +
            (removed.length > 0 ? `\n      移除：${sample(removed)}` : '') +
            (added.length > 0 ? `\n      新增：${sample(added)}` : ''),
        )
      }
    }
  }
  return diffs
}

function load(file) {
  try {
    return JSON.parse(readFileSync(path.resolve(file), 'utf8'))
  } catch (e) {
    console.error(`讀不到或無法解析 ${file}：${e.message}`)
    return undefined
  }
}

function selfTest() {
  const failures = []
  const expect = (cond, msg) => {
    if (!cond) failures.push(msg)
  }
  const side = (n) => ({ passed: n, failed: 0, names: Array.from({ length: n }, (_, i) => `t${i}`) })
  const make = () => ({
    generatedAt: 'a',
    commit: 'x',
    note: 'n',
    tests: Object.fromEntries(T_IDS.map((id) => [id, { status: 'pass', ts: side(2), py: side(1) }])),
  })

  expect(sanity(make()).length === 0, '完整且全部通過的快照應該沒有問題')
  const missingId = make()
  delete missingId.tests.T07
  expect(sanity(missingId).some((p) => p.startsWith('T07')), '缺 T07 應該被抓到')
  const failing = make()
  failing.tests.T03.status = 'fail'
  failing.tests.T03.ts = { passed: 1, failed: 1, names: ['t0', 't1 [FAILED]'] }
  expect(sanity(failing).length >= 2, 'status fail 與失敗的測試都應該被抓到')
  const badStatus = make()
  badStatus.tests.T01.status = 'ok'
  expect(sanity(badStatus).length === 1, '不合法的 status 應該被抓到')
  const badNames = make()
  badNames.tests.T02.py.names.pop()
  expect(sanity(badNames).length === 1, 'names 數量和 passed + failed 對不上應該被抓到')
  expect(sanity({}).length === 1 && sanity(null).length === 1, '格式錯誤的輸入要回報而不是丟例外')

  const a = make()
  const b = make()
  b.generatedAt = 'later'
  b.commit = 'y'
  b.note = 'other'
  expect(diffSnapshots(a, b).length === 0, 'generatedAt／commit／note 不同不算差異')
  b.tests.T05.ts = side(3)
  const d = diffSnapshots(a, b)
  expect(d.length === 2 && d.every((x) => x.startsWith('T05.ts')), '多一項測試應該同時回報數量與名稱差異')
  const c = make()
  c.tests.T09.status = 'partial'
  expect(diffSnapshots(a, c).some((x) => x.startsWith('T09：status pass → partial')), 'status 改變要回報')

  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL: ${f}`)
    return 1
  }
  console.log('verify-status-check self-test: 通過')
  return 0
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest()
  const rest = argv.filter((a) => !a.startsWith('--'))
  if (argv.includes('--sanity')) {
    const file = rest[0] ?? DEFAULT_FILE
    const snap = load(file)
    if (snap === undefined) return 2
    const problems = sanity(snap)
    if (problems.length > 0) {
      console.error(`${file} 有 ${problems.length} 個問題：`)
      for (const p of problems) console.error(`  - ${p}`)
      return 1
    }
    console.log(`${file}：T01–T18 格式正確，沒有失敗項目。`)
    return 0
  }
  if (rest.length !== 2) {
    console.error('用法：verify-status-check.mjs --sanity [file] | <committed.json> <fresh.json> | --self-test')
    return 2
  }
  const [committed, fresh] = rest.map(load)
  if (committed === undefined || fresh === undefined) return 2
  const problems = sanity(fresh)
  if (problems.length > 0) {
    console.error('新產生的快照本身就有問題：')
    for (const p of problems) console.error(`  - ${p}`)
    return 1
  }
  const diffs = diffSnapshots(committed, fresh)
  if (diffs.length === 0) {
    console.log('已提交的 verification-status.json 和重新驗證的結果一致。')
    return 0
  }
  console.error(`已提交的 verification-status.json 過期（${diffs.length} 處和重新驗證的結果不同）：`)
  for (const d of diffs) console.error(`  - ${d}`)
  console.error('\n修法：在本機執行 `npm run verify`，檢查 diff 後提交 src/data/verification-status.json。')
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2))
}
