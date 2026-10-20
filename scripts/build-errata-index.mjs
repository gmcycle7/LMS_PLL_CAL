#!/usr/bin/env node
// 勘誤索引產生器：src/data/errata.json（49 條勘誤的完整文字，約 75 KB）→ src/data/errataIndex.ts（每條只留編號、嚴重度、區域，約 3 KB）。
//
// 為什麼要有索引：行內的「勘誤 Exx」徽章（ErratumLink／ChapterErratum）只需要嚴重度（決定顏色與浮動提示的「（嚴重）」）和區域
// （提示的後半句）。直接 import errata.json 會讓完整文字（problem／correction／evidence…）被打包進每一頁都會載入的主 chunk。
// 只有區塊版的 ChapterErratumNote 要顯示官方修正文字，它改成動態 import errata.json（第一次需要時才載入）。
//
// 用法：
//   node scripts/build-errata-index.mjs           # 重新產生 src/data/errataIndex.ts
//   node scripts/build-errata-index.mjs --check   # 不寫檔；現有檔案和 errata.json 推導的結果不同就結束碼 1（src/data/errataIndex.test.ts 會跑）
//
// 改了 errata.json 的 eid／severity／area 之後要重跑一次（不跑的話 errataIndex.test.ts 會失敗，CI 的 unit job 會抓到）。
// 索引檔是產物，不要手改；格式只由這支腳本決定。
// 結束碼：0 成功（或 --check 一致）；1 --check 不一致；2 errata.json 格式不符。

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const ERRATA_PATH = path.join(ROOT, 'src/data/errata.json')
export const INDEX_PATH = path.join(ROOT, 'src/data/errataIndex.ts')

export const SEVERITIES = ['high', 'medium', 'low']

/**
 * errata.json 的內容 → 索引項目（順序同 errata.json）。格式不符丟 Error。純函式。
 * @param {unknown} file
 * @returns {{ eid: string, severity: string, area: string }[]}
 */
export function deriveErrataIndex(file) {
  const list = file && typeof file === 'object' ? file.errata : undefined
  if (!Array.isArray(list) || list.length === 0) throw new Error('errata.json 沒有 errata 陣列')
  const seen = new Set()
  return list.map((e, i) => {
    const where = `errata[${i}]`
    if (!e || typeof e.eid !== 'string' || !/^E\d{2,}$/.test(e.eid)) throw new Error(`${where}.eid 不是 "E01" 這種編號：${JSON.stringify(e?.eid)}`)
    if (seen.has(e.eid)) throw new Error(`${where}.eid 重複：${e.eid}`)
    seen.add(e.eid)
    if (!SEVERITIES.includes(e.severity)) throw new Error(`${e.eid}.severity 必須是 ${SEVERITIES.join('／')}：${JSON.stringify(e.severity)}`)
    if (typeof e.area !== 'string' || e.area.trim() === '') throw new Error(`${e.eid}.area 不是非空字串`)
    return { eid: e.eid, severity: e.severity, area: e.area }
  })
}

/** 單引號字串（專案風格：單引號、不加分號） */
const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`

/**
 * 索引項目 → src/data/errataIndex.ts 的完整內容。純函式（--check 就是拿它的輸出和現有檔案逐字比對）。
 * @param {{ eid: string, severity: string, area: string }[]} entries
 */
export function renderErrataIndexModule(entries) {
  const rows = entries.map((e) => `  ${e.eid}: { severity: ${q(e.severity)}, area: ${q(e.area)} },`).join('\n')
  return `/**
 * 勘誤索引：每條勘誤的嚴重度與區域（${entries.length} 條）。
 *
 * 這個檔案是產物，不要手改——由 \`node scripts/build-errata-index.mjs\` 從 src/data/errata.json 推導；
 * src/data/errataIndex.test.ts 驗證它和 errata.json 一致（改了 errata.json 沒重跑，CI 的 unit job 會失敗）。
 *
 * 用途：行內的「勘誤 Exx」徽章（links/ErratumLink、chapter/ChapterErratum）只要嚴重度（顏色、浮動提示的「（嚴重）」）和區域，
 * 不需要完整文字；import 完整的 errata.json（約 75 KB）會讓它被打包進每一頁都會載入的主 chunk。
 * 需要 problem／correction／evidence 的頁面（驗證頁、Dashboard、Roadmap、Gallery）和 ChapterErratumNote（延後載入）才讀 errata.json。
 */

export type ErratumSeverity = 'high' | 'medium' | 'low'

export interface ErratumIndexEntry {
  severity: ErratumSeverity
  /** 勘誤所屬的區域（純文字，例如 '§11 Bias / INL'） */
  area: string
}

export const ERRATA_INDEX: Readonly<Record<string, ErratumIndexEntry>> = {
${rows}
}

/** 依編號（'E44'）取索引項；沒有這個編號回 undefined（含 'constructor' 之類的原型屬性名） */
export function erratumIndexEntry(id: string): ErratumIndexEntry | undefined {
  return Object.hasOwn(ERRATA_INDEX, id) ? ERRATA_INDEX[id] : undefined
}
`
}

function main(argv) {
  let entries
  try {
    entries = deriveErrataIndex(JSON.parse(readFileSync(ERRATA_PATH, 'utf8')))
  } catch (e) {
    console.error(`錯誤：${path.relative(ROOT, ERRATA_PATH)} 格式不符：${e instanceof Error ? e.message : String(e)}`)
    return 2
  }
  const next = renderErrataIndexModule(entries)
  const rel = path.relative(ROOT, INDEX_PATH)
  if (argv.includes('--check')) {
    const current = existsSync(INDEX_PATH) ? readFileSync(INDEX_PATH, 'utf8') : null
    if (current === next) {
      console.log(`${rel} 和 errata.json 一致（${entries.length} 條）。`)
      return 0
    }
    console.error(`${rel} ${current === null ? '不存在' : '和 errata.json 推導的結果不同'}：請執行 \`node scripts/build-errata-index.mjs\` 重新產生。`)
    return 1
  }
  writeFileSync(INDEX_PATH, next)
  console.log(`已寫入 ${rel}（${entries.length} 條，${Buffer.byteLength(next)} B）。`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2))
}
