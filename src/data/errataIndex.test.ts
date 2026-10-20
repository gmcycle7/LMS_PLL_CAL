import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import errataFile from '@/data/errata.json'
import { ERRATA_INDEX, erratumIndexEntry } from './errataIndex'

/**
 * 勘誤索引（src/data/errataIndex.ts）：由 scripts/build-errata-index.mjs 從 errata.json 推導的產物。
 * 這裡守三件事：(1) 索引的內容就是 errata.json 推導的結果（不同步會失敗）；(2) 行內徽章走的程式碼不會再靜態 import 完整的 errata.json
 * （那會讓 75 KB 的全文進主 chunk）；(3) 產生器本身可以重現現有檔案（--check，連格式都要一樣，沒有人手改過）。
 */
const ROOT = process.cwd()
const errata = (errataFile as { errata: { eid: string; severity: string; area: string }[] }).errata

describe('errataIndex：索引 = 由 errata.json 推導的結果', () => {
  it('每一條勘誤都有索引項，順序相同，只有 severity 與 area 兩個欄位', () => {
    expect(Object.keys(ERRATA_INDEX)).toEqual(errata.map((e) => e.eid))
    for (const e of errata) {
      expect(ERRATA_INDEX[e.eid], e.eid).toEqual({ severity: e.severity, area: e.area })
      expect(Object.keys(ERRATA_INDEX[e.eid]).sort(), `${e.eid} 的索引項不該帶全文欄位`).toEqual(['area', 'severity'])
    }
  })

  it('erratumIndexEntry：查得到的回傳索引項；不存在的編號（含原型屬性名）回 undefined', () => {
    expect(erratumIndexEntry('E01')).toEqual({ severity: 'high', area: '§11 Bias / INL' })
    expect(erratumIndexEntry('E99')).toBeUndefined()
    expect(erratumIndexEntry('')).toBeUndefined()
    for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(erratumIndexEntry(k), k).toBeUndefined()
  })

  it('scripts/build-errata-index.mjs --check：現有索引檔和產生器的輸出逐字相同（沒有人手改過，也沒有忘了重跑）', () => {
    const out = execFileSync(process.execPath, [join(ROOT, 'scripts/build-errata-index.mjs'), '--check'], { encoding: 'utf8' })
    expect(out).toContain('一致')
  })

  it('索引檔很小（完整的 errata.json 約 75 KB；索引 < 10 KB）', () => {
    expect(statSync(join(ROOT, 'src/data/errataIndex.ts')).size).toBeLessThan(10_000)
    expect(statSync(join(ROOT, 'src/data/errata.json')).size).toBeGreaterThan(50_000)
  })
})

/** 遞迴列出 src 下的 ts／tsx 原始碼（不含測試） */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sources(p))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe('主 chunk 不帶勘誤全文', () => {
  // 靜態 `import … from '@/data/errata.json'`（或相對路徑）。動態 `import('@/data/errata.json')` 不算。
  const STATIC_IMPORT = /^\s*import\s[^;]*?from\s+['"][^'"]*data\/errata\.json['"]/m
  // 這些目錄的程式碼會被每一頁（路由殼、章節、共用元件）載入；全文只能在延後載入的頁面（pages/*）、搜尋索引（本來就 lazy）或動態 import 裡讀
  const EAGER_DIRS = ['src/app', 'src/chapters', 'src/components']
  const LAZY_OK = ['src/components/search/']

  it('src/app、src/chapters、src/components 沒有靜態 import errata.json（搜尋索引 buildIndex.ts 本來就延後載入，除外）', () => {
    const offenders: string[] = []
    for (const d of EAGER_DIRS) {
      for (const f of sources(join(ROOT, d))) {
        const rel = relative(ROOT, f).replace(/\\/g, '/')
        if (LAZY_OK.some((p) => rel.startsWith(p))) continue
        if (STATIC_IMPORT.test(readFileSync(f, 'utf8'))) offenders.push(rel)
      }
    }
    expect(offenders, '行內徽章只需要 src/data/errataIndex.ts；要全文請動態 import（見 chapter/ChapterErratum.tsx 的 loadErratumCorrections）').toEqual([])
  })

  it('ChapterErratum.tsx 用動態 import 載入全文，且不靜態 import', () => {
    const src = readFileSync(join(ROOT, 'src/components/chapter/ChapterErratum.tsx'), 'utf8')
    expect(src).toMatch(/import\('@\/data\/errata\.json'\)/)
    expect(STATIC_IMPORT.test(src)).toBe(false)
  })
})
