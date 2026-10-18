import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_FORMULAS } from '@/pages/formulas/registry'
import { ALL_PRESETS, presetHref } from '@/app/presets'
import { ALL_HANDCALCS } from '@/app/handcalcs'
import { GLOSSARY } from '@/pages/formulas/glossary'
import { PAGES } from '@/app/registry'
import { QUESTIONS } from '@/pages/dashboard/data'
import errataFile from '@/data/errata.json'
import { itemById } from '@/pages/roadmap/data'
import { normalizeSearch, tokenize } from '@/pages/formulas/search'
import { filterEntries, searchIndex } from '@/pages/formulas/searchIndex'
import { buildIndex, erratumEntries, getStaticIndex, handcalcRoute, presetRoute, readErrata } from './buildIndex'
import { KIND_LABEL, KIND_ORDER, PER_GROUP, scoreEntry, search, type SearchEntry, type SearchKind } from './searchCore'

/**
 * 全站搜尋的靜態索引：每個來源一筆不漏（筆數直接和來源比），目標路由的格式，以及查詢的排序。
 * 索引在執行期由既有的登錄建出來，沒有 JSON 檔要維護；這裡守住的是「來源多了一筆，索引就多一筆」。
 */

const index = buildIndex()
const ofKind = (kind: SearchKind) => index.filter((e) => e.kind === kind)
const ids = (kind: SearchKind) => ofKind(kind).map((e) => e.id)

describe('全站搜尋索引：每個來源一筆不漏', () => {
  it('公式：筆數與 ID 和 ALL_FORMULAS 相同；目標是該章的 ?f=；TeX 與 ID 都在 haystack 裡', () => {
    expect(ALL_FORMULAS.length).toBeGreaterThan(300)
    expect(ids('formula')).toEqual(ALL_FORMULAS.map((f) => f.id))
    for (const e of ofKind('formula')) {
      const f = ALL_FORMULAS.find((x) => x.id === e.id)!
      const page = PAGES.find((p) => p.id === f.pageId)
      expect(e.to).toBe(page ? `${page.path}?f=${encodeURIComponent(f.id)}` : `/formulas?f=${encodeURIComponent(f.id)}`)
      expect(e.tex).toBe(f.tex)
      expect(e.haystack).toBe(f.haystack)
      expect(e.haystack).toContain(e.idKey)
    }
    // 每條公式都找得到自己的章（registry 裡的頁）
    expect(ofKind('formula').filter((e) => e.to.startsWith('/formulas?f='))).toEqual([])
  })

  it('preset：筆數與 src/data/presets/*.json 的檔案數相同；目標 = presetHref（頁面 + ?preset=）再加 ?a=exp-<experiment>（捲到那個實驗）', () => {
    const files = readdirSync(join(process.cwd(), 'src/data/presets')).filter((f) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThan(200)
    expect(ofKind('preset')).toHaveLength(files.length)
    expect(ids('preset')).toEqual(ALL_PRESETS.map((p) => p.id))
    for (const e of ofKind('preset')) {
      const p = ALL_PRESETS.find((x) => x.id === e.id)!
      // presetHref（頁面 + ?preset=）再加 ?a=exp-<experiment>：AnchorDeepLink 會捲到套用了 preset 的實驗（<ExperimentShell id> 的 DOM id）
      expect(e.to).toBe(`${presetHref(p)}&a=exp-${p.experiment}`)
      expect(e.to).toBe(presetRoute(p))
      expect(e.to).toMatch(/^\/[^#]*\?preset=[^&]+&a=exp-/)
      expect(e.title).toBe(p.title)
    }
  })

  it('勘誤：筆數與 errata.json 相同；目標 /verification?e=Exx；problem 可搜尋', () => {
    const raw = (errataFile as { errata: { eid: string; problem: string }[] }).errata
    expect(raw.length).toBeGreaterThan(40)
    expect(readErrata()).toHaveLength(raw.length)
    expect(ids('erratum')).toEqual(raw.map((e) => e.eid))
    for (const e of ofKind('erratum')) expect(e.to).toBe(`/verification?e=${e.id}`)
    // E01 的 problem 提到 1.34（Sign-LMS 固定點）：用數字也找得到
    const e01 = ofKind('erratum').find((e) => e.id === 'E01')!
    expect(e01.haystack).toContain('1.34')
    // 格式不符的條目略過、沒有 errata 欄位時是空陣列
    expect(readErrata({ errata: [{ eid: 'E99' }, { nope: true }, null] })).toHaveLength(1)
    expect(readErrata({})).toEqual([])
    expect(erratumEntries().length).toBe(raw.length)
    // 只有 eid 的條目也建得出來（其他欄位缺了不會讓整份索引炸掉）
    const [bare] = erratumEntries({ errata: [{ eid: 'E99' }] })
    expect(bare.id).toBe('E99')
    expect(bare.title).toBe('E99')
    expect(bare.detail).toBe('')
    expect(bare.to).toBe('/verification?e=E99')
    expect(bare.haystack).toContain('e99')
  })

  it('手算題：筆數與 ALL_HANDCALCS 相同；目標是該頁的 ?a=handcalc-ID；Roadmap 的題目另帶 ?item=R{n} 讓卡片先打開', () => {
    expect(ALL_HANDCALCS.length).toBeGreaterThan(100)
    expect(ids('handcalc')).toEqual(ALL_HANDCALCS.map((h) => h.id))
    let roadmap = 0
    for (const e of ofKind('handcalc')) {
      const h = ALL_HANDCALCS.find((x) => x.id === e.id)!
      const rm = h.page === '/roadmap' ? /^HC-RM\.(\d+)$/.exec(h.id) : null
      if (rm) {
        roadmap++
        expect(e.to).toBe(`/roadmap?item=R${rm[1]}&a=handcalc-${h.id}`)
        expect(itemById(`R${rm[1]}`), `${h.id} 對應的題目卡 R${rm[1]}`).toBeDefined()
      } else {
        expect(e.to).toBe(`${h.page}?a=handcalc-${h.id}`)
      }
      expect(e.tex).toBeUndefined() // 題目的通式不放進清單（太長），但可搜尋
      expect(e.haystack.length).toBeGreaterThan(e.idKey.length)
    }
    expect(roadmap).toBeGreaterThan(5)
    expect(handcalcRoute({ id: 'HC-RM.10', page: '/roadmap' })).toBe('/roadmap?item=R10&a=handcalc-HC-RM.10')
    expect(handcalcRoute({ id: 'HC-05.1', page: '/ch/05' })).toBe('/ch/05?a=handcalc-HC-05.1')
  })

  it('術語：筆數與 GLOSSARY 相同；標籤是縮寫；目標是公式速查頁的 ?q=中文名，到了再捲到那一列（revealSelector）；每個中文名都過濾得出自己那一列', () => {
    expect(GLOSSARY.length).toBeGreaterThan(50)
    expect(ids('term')).toEqual(GLOSSARY.map((g) => g.key))
    const glossaryRows = searchIndex().glossary
    for (const e of ofKind('term')) {
      const g = GLOSSARY.find((x) => x.key === e.id)!
      expect(e.to).toBe(`/formulas?q=${encodeURIComponent(g.zh)}`)
      expect(e.label).toBe(g.abbr ?? '術語')
      expect(e.title).toContain(g.en)
      // 公式速查頁不處理 ?a=、術語列也沒有 id：面板到了之後用這個 selector 找那一列（GlossarySection 的 data-term）
      expect(e.revealSelector).toBe(`.fr-gloss-item[data-term="${g.key}"]`)
      // 公式速查頁用 ?q= 過濾：這個術語的中文名一定過濾得出它自己那一列（否則到了也捲不到）
      const rows = filterEntries(glossaryRows, tokenize(g.zh)) as { key: string }[]
      expect(rows.map((r) => r.key), g.key).toContain(g.key)
    }
    // 只有術語需要 revealSelector（其他種類靠 ?f=／?a= 的 AnchorDeepLink）
    expect(index.filter((e) => e.revealSelector && e.kind !== 'term')).toEqual([])
  })

  it('章節：registry 每頁一筆（目標 = 路徑）＋ 附錄 E 的 15 個問題（目標 = 主要回答頁）', () => {
    const sections = ofKind('section')
    expect(sections.filter((e) => !e.id.startsWith('q'))).toHaveLength(PAGES.length)
    for (const p of PAGES) {
      const e = sections.find((x) => x.id === p.id)!
      expect(e.to).toBe(p.path)
      expect(e.title).toBe(p.nav)
    }
    expect(QUESTIONS).toHaveLength(15)
    for (const q of QUESTIONS) {
      const e = sections.find((x) => x.id === `q${q.n}`)!
      expect(e.label).toBe(`問題 ${q.n}`)
      expect(e.to).toBe(PAGES.find((p) => p.id === q.pages[0])!.path)
    }
    // 靜態索引沒有 DOM 元素（本頁段落是開面板時才加的）
    expect(index.every((e) => e.el === undefined)).toBe(true)
  })

  it('同一種類內 id 不重複；to 是不含 # 的路由；haystack 已正規化（沒有 $、反斜線、空白、大寫）', () => {
    for (const kind of KIND_ORDER) {
      const list = ids(kind)
      expect(new Set(list).size, kind).toBe(list.length)
    }
    for (const e of index) {
      expect(e.to).toMatch(/^\/[^#\s]*$/)
      expect(e.haystack).not.toMatch(/[$\\\s]/)
      expect(e.haystack).toBe(e.haystack.toLowerCase())
      expect(e.haystack.length, `${e.kind}:${e.id}`).toBeLessThanOrEqual(2000)
      expect(e.title.trim().length).toBeGreaterThan(0)
    }
    expect(KIND_ORDER.map((k) => KIND_LABEL[k])).toEqual(['公式', '章節', '實驗 preset', '勘誤', '術語', '手算題'])
  })

  it('getStaticIndex 只建一次（同一個陣列）；整份索引序列化後在合理範圍（執行期建立，不另外出貨 JSON）', () => {
    expect(getStaticIndex()).toBe(getStaticIndex())
    expect(getStaticIndex()).toHaveLength(index.length)
    const bytes = Buffer.byteLength(JSON.stringify(index), 'utf8')
    expect(bytes).toBeGreaterThan(100_000)
    expect(bytes).toBeLessThan(1_000_000)
  })
})

describe('查詢與排序（search／scoreEntry）', () => {
  const top = (q: string) => search(index, q)
  const firstOf = (q: string, kind: SearchKind) => top(q).find((g) => g.kind === kind)?.items[0]

  it('完全相同的公式 ID 排第一，大小寫與全形不拘；同一個 ID 的手算題與術語也會出現', () => {
    expect(firstOf('F-12.9', 'formula')?.id).toBe('F-12.9')
    expect(firstOf('f-12.9', 'formula')?.id).toBe('F-12.9')
    expect(firstOf('Ｆ-12.9', 'formula')?.id).toBe('F-12.9')
    // ID 開頭：F-12 → 第 12 章的公式排在其他只在內文提到 F-12 的項目前面
    const g = top('F-12').find((x) => x.kind === 'formula')!
    expect(g.items.every((e) => e.id.startsWith('F-12'))).toBe(true)
  })

  it('TeX、Unicode 與拼音寫法找到同一組公式（σ_w、\\sigma_w、sigma_w）', () => {
    const a = top('σ_w').find((g) => g.kind === 'formula')!
    const b = top('\\sigma_w').find((g) => g.kind === 'formula')!
    const c = top('sigma_w').find((g) => g.kind === 'formula')!
    expect(a.total).toBeGreaterThan(5)
    expect(b.total).toBe(a.total)
    expect(c.total).toBe(a.total)
    expect(a.items.map((e) => e.id)).toEqual(b.items.map((e) => e.id))
  })

  it('術語縮寫 ENBW：公式群組有 F-12.9，術語群組有 enbw；勘誤編號 E13 的勘誤群組第一筆就是 E13', () => {
    const groups = top('ENBW')
    expect(groups.find((g) => g.kind === 'formula')!.items.map((e) => e.id)).toContain('F-12.9')
    expect(firstOf('ENBW', 'term')?.id).toBe('enbw')
    expect(firstOf('E13', 'erratum')?.id).toBe('E13')
    expect(firstOf('HC-05.1', 'handcalc')?.id).toBe('HC-05.1')
  })

  it('打的正好是某筆的 id：那一組排最前面、那一筆排第一（E13 → 勘誤、HC-05.1 → 手算題、ch05 → 章節、ENBW → 術語），不被前面組裡提到它的項目壓住；其餘的組仍照 KIND_ORDER', () => {
    for (const [q, kind] of [
      ['E13', 'erratum'],
      ['HC-05.1', 'handcalc'],
      ['ch05', 'section'],
      ['ENBW', 'term'],
      ['F-12.9', 'formula'],
    ] as const) {
      const groups = top(q)
      expect(groups[0].kind, q).toBe(kind)
      expect(groups[0].items[0].idKey, q).toBe(normalizeSearch(q))
      const rest = groups.slice(1).map((g) => g.kind)
      expect(rest, q).toEqual(KIND_ORDER.filter((k) => rest.includes(k)))
    }
    // E13 也被好幾條公式的內文提到：它們還在，只是排在勘誤那一組後面
    const e13 = top('E13')
    expect(e13.find((g) => g.kind === 'formula')!.total).toBeGreaterThan(0)
    expect(e13[0].items[0].id).toBe('E13')
  })

  it('多個 token 是 AND（空白、逗號、頓號分隔）；都不符合時是空陣列', () => {
    const both = top('dead zone')
    expect(both.length).toBeGreaterThan(0)
    for (const g of both) for (const e of g.items) expect(e.haystack).toMatch(/dead/)
    expect(top('deadzone、不存在的字串xyz')).toEqual([])
    expect(top('zzzzqqq')).toEqual([])
  })

  it('每組最多 PER_GROUP 筆、total 是符合的總數、群組依 KIND_ORDER 排列（打到 id 的那一組提到最前面）', () => {
    const groups = top('LMS')
    expect(groups.length).toBe(KIND_ORDER.length)
    // 'lms' 正好是術語 lms 的 id：術語組排最前面，其餘照 KIND_ORDER
    expect(groups.map((g) => g.kind)).toEqual(['term', ...KIND_ORDER.filter((k) => k !== 'term')])
    // 沒有打到任何 id 的查詢：完全照 KIND_ORDER
    const plain = top('雜訊')
    expect(plain.length).toBeGreaterThan(2)
    expect(plain.map((g) => g.kind)).toEqual(KIND_ORDER.filter((k) => plain.some((g) => g.kind === k)))
    for (const g of groups) {
      expect(g.items.length).toBeLessThanOrEqual(PER_GROUP)
      expect(g.total).toBeGreaterThanOrEqual(g.items.length)
      expect(g.label).toBe(KIND_LABEL[g.kind])
    }
    expect(search(index, 'LMS', 3).every((g) => g.items.length <= 3)).toBe(true)
  })

  it('空查詢：靜態索引沒有本頁段落（el），所以是空的', () => {
    expect(search(index, '')).toEqual([])
    expect(search(index, '   ')).toEqual([])
  })

  it('scoreEntry：id 完全相同 > id 開頭 > id 包含 > 標題開頭 > 標題包含 > 其他欄位；不符合是 -1', () => {
    const e: SearchEntry = { kind: 'formula', id: 'F-05.1', title: 'Comparator 輸出', to: '/ch/05', haystack: 'f-05.1|comparator輸出|phi|其他', idKey: 'f-05.1', titleKey: 'comparator輸出' }
    expect(scoreEntry(e, ['f-05.1'])).toBe(100)
    expect(scoreEntry(e, ['f-05'])).toBe(80)
    expect(scoreEntry(e, ['05.1'])).toBe(60)
    expect(scoreEntry(e, ['comparator'])).toBe(50)
    expect(scoreEntry(e, ['輸出'])).toBe(40)
    expect(scoreEntry(e, ['phi'])).toBe(10)
    expect(scoreEntry(e, ['phi', '輸出'])).toBe(50)
    expect(scoreEntry(e, ['phi', 'nope'])).toBe(-1)
  })
})
