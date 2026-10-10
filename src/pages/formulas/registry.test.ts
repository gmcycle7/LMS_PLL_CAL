import type { FormulaEntry } from '@/data/types'
import { PAGES } from '@/app/registry'
import { ALL_FORMULAS, collectFormulas, compareIds, duplicateIds, formulaById, FORMULA_IDS, groupByPage, idSortKey, pageOfPath, registryStats, sourceFromGlobKey } from './registry'
import { erratumExists } from './errata'
import { matchesAll, tokenize } from './search'
import { texError } from './testUtils'

const entry = (id: string, page: string, extra: Partial<FormulaEntry> = {}): FormulaEntry => ({
  id,
  title: `title ${id}`,
  tex: 'a=b',
  conditions: 'cond',
  claim: 'exact',
  level: 'L0',
  specSection: '1',
  page,
  ...extra,
})

describe('registry：彙整邏輯（純函式）', () => {
  it('sourceFromGlobKey：glob key → 相對 src/ 的路徑', () => {
    expect(sourceFromGlobKey('../../chapters/ch12/formulas.ts')).toBe('chapters/ch12/formulas.ts')
    expect(sourceFromGlobKey('../models/formulas.ts')).toBe('pages/models/formulas.ts')
    expect(sourceFromGlobKey('weird.ts')).toBe('weird.ts')
  })

  it('compareIds：自然排序（F-02.18 在 F-02.2 之後；純數字章節排在字母前綴之前；R2 在 R10 之前）', () => {
    const ids = ['F-R10.1', 'F-02.18', 'F-SO.3', 'F-02.2', 'F-13.12', 'F-R2.1', 'F-02.10', 'F-13.2', 'F-00.1']
    expect(ids.slice().sort(compareIds)).toEqual(['F-00.1', 'F-02.2', 'F-02.10', 'F-02.18', 'F-13.2', 'F-13.12', 'F-R2.1', 'F-R10.1', 'F-SO.3'])
    expect(idSortKey('F-R10.1')).toEqual(['R', 10, '.', 1])
    expect(compareIds('F-03.1', 'F-03.1')).toBe(0)
  })

  it('collectFormulas：依側欄順序 → ID 排序，補上 pageId / pageNav / source，忽略沒有 FORMULAS 的模組', () => {
    const rows = collectFormulas({
      '../models/formulas.ts': { FORMULAS: [entry('F-15.2', '/models'), entry('F-15.1', '/models')] },
      '../../chapters/ch03/formulas.ts': { FORMULAS: [entry('F-03.10', '/ch/03'), entry('F-03.2', '/ch/03')] },
      '../../chapters/ch01/formulas.ts': { FORMULAS: [entry('F-01.1', '/ch/01', { erratumId: 'E41', units: { mu: 'fs' } })] },
      '../broken/formulas.ts': {},
      '../nowhere/formulas.ts': { FORMULAS: [entry('F-ZZ.1', '/no/such/page')] },
    })
    expect(rows.map((r) => r.id)).toEqual(['F-01.1', 'F-03.2', 'F-03.10', 'F-15.1', 'F-15.2', 'F-ZZ.1'])
    expect(rows[0].pageId).toBe('ch01')
    expect(rows[0].source).toBe('chapters/ch01/formulas.ts')
    expect(rows[0].pageNav).toMatch(/^01 /)
    expect(rows[3].pageId).toBe('models')
    // 找不到頁面：排在最後、pageId = null、pageNav 退回路徑
    expect(rows[5].pageId).toBeNull()
    expect(rows[5].pageNav).toBe('/no/such/page')
    // haystack 含 ID、勘誤、單位
    expect(matchesAll(rows[0].haystack, tokenize('F-01.1 E41 fs'))).toBe(true)
    expect(matchesAll(rows[0].haystack, tokenize('勘誤E41'))).toBe(true)
  })

  it('duplicateIds / groupByPage / registryStats', () => {
    const rows = collectFormulas({
      a: { FORMULAS: [entry('F-01.1', '/ch/01'), entry('F-01.1', '/ch/01'), entry('F-01.2', '/ch/01', { claim: 'approx', level: 'L2', erratumId: 'E13' })] },
      b: { FORMULAS: [entry('F-03.1', '/ch/03', { claim: 'research', erratumId: 'E13' })] },
    })
    expect(duplicateIds(rows)).toEqual(['F-01.1'])
    const groups = groupByPage(rows)
    expect(groups.map((g) => [g.page, g.rows.length])).toEqual([
      ['/ch/01', 3],
      ['/ch/03', 1],
    ])
    const st = registryStats(rows)
    expect(st.total).toBe(4)
    expect(st.pages).toBe(2)
    expect(st.byClaim).toEqual({ exact: 2, approx: 1, research: 1 })
    expect(st.byLevel).toEqual({ L0: 3, L2: 1 })
    expect(st.withErratum).toBe(2)
    expect(st.errataReferenced).toEqual(['E13'])
  })

  it('pageOfPath：路徑 → 頁面 id 與側欄順序', () => {
    expect(pageOfPath('/ch/12')?.id).toBe('ch12')
    expect(pageOfPath('/')?.id).toBe('dashboard')
    expect(pageOfPath('/nope')).toBeNull()
  })
})

describe('registry：全站公式登錄（import.meta.glob 的實際結果）', () => {
  it('收錄 Ch00–Ch14 每一章與 models / signoff / roadmap 等頁面，總數 > 300', () => {
    expect(ALL_FORMULAS.length).toBeGreaterThan(300)
    const pages = new Set(ALL_FORMULAS.map((f) => f.pageId))
    for (let n = 0; n <= 14; n++) expect(pages.has(`ch${String(n).padStart(2, '0')}`), `ch${n}`).toBe(true)
    for (const id of ['models', 'signoff', 'roadmap']) expect(pages.has(id), id).toBe(true)
    // 本頁自己不登錄新 ID（'../*/formulas.ts' 不會收到 src/pages/formulas 底下的檔案）
    expect(ALL_FORMULAS.some((f) => f.source.startsWith('pages/formulas/'))).toBe(false)
  })

  it('ID 全站唯一、格式為 F-<章>.<序>，且每一條的 page 都在頁面註冊表中', () => {
    expect(duplicateIds(ALL_FORMULAS)).toEqual([])
    const bad = ALL_FORMULAS.filter((f) => !/^F-[A-Z0-9]+\.\d+$/.test(f.id)).map((f) => f.id)
    expect(bad).toEqual([])
    const orphan = ALL_FORMULAS.filter((f) => f.pageId === null).map((f) => `${f.id}@${f.page}`)
    expect(orphan).toEqual([])
    expect(FORMULA_IDS.size).toBe(ALL_FORMULAS.length)
    expect(formulaById('F-12.9')?.pageId).toBe('ch12')
    expect(formulaById('F-99.9')).toBeUndefined()
  })

  it('排序：依側欄頁面順序，頁面內依 ID 自然排序', () => {
    for (let i = 1; i < ALL_FORMULAS.length; i++) {
      const a = ALL_FORMULAS[i - 1]
      const b = ALL_FORMULAS[i]
      expect(a.pageOrder <= b.pageOrder, `${a.id} → ${b.id}`).toBe(true)
      if (a.pageOrder === b.pageOrder) expect(compareIds(a.id, b.id) < 0, `${a.id} < ${b.id}`).toBe(true)
    }
    expect(ALL_FORMULAS.every((f) => f.pageOrder < PAGES.length)).toBe(true)
  })

  it('每一條的 TeX 都能被 KaTeX 嚴格解析（display mode），標題與使用條件不為空', () => {
    const problems: string[] = []
    for (const f of ALL_FORMULAS) {
      const err = texError(f.tex, true)
      if (err) problems.push(`${f.id}: ${err}`)
      if (!f.title.trim()) problems.push(`${f.id}: 沒有標題`)
      if (!f.conditions.trim()) problems.push(`${f.id}: 沒有使用條件`)
      if (!f.specSection.trim()) problems.push(`${f.id}: 沒有規格段落`)
    }
    expect(problems).toEqual([])
  })

  it('結論標籤與模型層級合法；勘誤編號都存在於 errata.json', () => {
    const claims = new Set(['exact', 'approx', 'research'])
    const levels = new Set(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'])
    const bad: string[] = []
    for (const f of ALL_FORMULAS) {
      if (!claims.has(f.claim)) bad.push(`${f.id}: claim ${f.claim}`)
      if (!levels.has(f.level)) bad.push(`${f.id}: level ${f.level}`)
      if (f.erratumId !== undefined && !erratumExists(f.erratumId)) bad.push(`${f.id}: 勘誤 ${f.erratumId} 不存在`)
    }
    expect(bad).toEqual([])
    const st = registryStats(ALL_FORMULAS)
    expect(st.byClaim.exact + st.byClaim.approx + st.byClaim.research).toBe(ALL_FORMULAS.length)
    expect(st.withErratum).toBeGreaterThan(40)
  })

  it('搜尋 haystack：TeX、中文標題、勘誤、頁面名稱都找得到同一條公式', () => {
    const find = (q: string) => ALL_FORMULAS.filter((f) => matchesAll(f.haystack, tokenize(q))).map((f) => f.id)
    expect(find('F-12.9')).toContain('F-12.9')
    expect(find('ENBW')).toContain('F-12.9')
    expect(find('\\mathrm{ENBW}')).toContain('F-12.9')
    expect(find('Coefficient Noise')).toContain('F-12.9')
    // 希臘字母三種寫法結果相同
    expect(find('μ σ_η')).toEqual(find('\\mu \\sigma_\\eta'))
    expect(find('mu sigma_eta').length).toBeGreaterThan(0)
    // 反面：亂打的字沒有結果
    expect(find('zzzxqj不存在')).toEqual([])
  })
})
