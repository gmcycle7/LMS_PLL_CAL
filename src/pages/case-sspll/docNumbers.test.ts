/**
 * docNumbers.json 是 analysis/sspll/golden/results/doc_numbers.json 的子集（只含頁面讀的 8 個欄位：joint 的 4 個、phos 的 4 個），
 * 目的是讓案例頁的 chunk 不必帶上整個 283 KB 的檔案（Vite 對這種大 JSON 的具名 import 不做 tree-shaking）。
 * 這個測試保證子集的每個值與原檔逐位相同（含 +0／−0），原檔重新產生後忘了同步就會失敗；
 * 也保證頁面只讀子集裡有的欄位，之後有人多讀一個欄位時會在這裡提醒。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import subset from './docNumbers.json'
import { DOC_JOINT, DOC_PHOS } from './data'

const ROOT = process.cwd()
const DIR = join(ROOT, 'src/pages/case-sspll')
const full = JSON.parse(readFileSync(join(ROOT, 'analysis/sspll/golden/results/doc_numbers.json'), 'utf8')) as { joint: Record<string, unknown>; phos: Record<string, unknown> }
const KEYS = subset._meta.keys

describe('docNumbers.json（doc_numbers.json 的子集）', () => {
  it('只含 joint 與 phos 兩段、列在 _meta.keys 的欄位；每個值與原檔逐位相同', () => {
    expect(Object.keys(subset).sort()).toEqual(['_meta', 'joint', 'phos'])
    expect(subset._meta.source).toBe('analysis/sspll/golden/results/doc_numbers.json')
    expect(Object.keys(subset.joint).sort()).toEqual([...KEYS.joint].sort())
    expect(Object.keys(subset.phos).sort()).toEqual([...KEYS.phos].sort())
    for (const section of ['joint', 'phos'] as const)
      for (const k of KEYS[section]) expect((subset[section] as Record<string, unknown>)[k], `不同步（${section}.${k}）：${subset._meta.regenerate}`).toEqual(full[section][k])
  })

  it('頁面的 DOC_JOINT、DOC_PHOS 就是這些欄位（S08、S09 讀到的數字不變）', () => {
    for (const k of KEYS.joint) expect((DOC_JOINT as unknown as Record<string, unknown>)[k], k).toEqual(full.joint[k])
    for (const k of KEYS.phos) expect((DOC_PHOS as unknown as Record<string, unknown>)[k], k).toEqual(full.phos[k])
    expect(DOC_JOINT.theorem_random_kernel_min_re_eig).toBe(full.joint.theorem_random_kernel_min_re_eig)
    expect(DOC_PHOS.pe_failure['1/4'].phases_visited).toBeGreaterThan(0)
  })

  it('頁面（sections／experiments／測試以外的檔案）只讀子集裡有的欄位', () => {
    const files: string[] = []
    const walk = (d: string) => {
      for (const e of readdirSync(join(DIR, d), { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name))
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(join(d, e.name))
      }
    }
    walk('.')
    const used = new Set<string>()
    for (const f of files) {
      const text = readFileSync(join(DIR, f), 'utf8')
      for (const m of text.matchAll(/\bDOC_(JOINT|PHOS)\.(\w+)/g)) used.add(`${m[1].toLowerCase()}.${m[2]}`)
    }
    expect(used.size).toBeGreaterThanOrEqual(6)
    const allowed = new Set([...KEYS.joint.map((k) => `joint.${k}`), ...KEYS.phos.map((k) => `phos.${k}`)])
    for (const u of used) expect(allowed.has(u), `${u} 不在 docNumbers.json 裡：把它加進 _meta.keys 再用 _meta.regenerate 重新產生`).toBe(true)
  })

  it('data.ts 不再 import 整個 doc_numbers.json；子集檔比原檔小一個數量級以上', () => {
    const data = readFileSync(join(DIR, 'data.ts'), 'utf8')
    expect(data).not.toMatch(/from\s*['"][^'"]*doc_numbers\.json['"]/)
    expect(data).toContain("import docNumbers from './docNumbers.json'")
    const sizeFull = readFileSync(join(ROOT, 'analysis/sspll/golden/results/doc_numbers.json')).length
    const sizeSubset = readFileSync(join(DIR, 'docNumbers.json')).length
    expect(sizeSubset).toBeLessThan(sizeFull / 20)
  })
})
