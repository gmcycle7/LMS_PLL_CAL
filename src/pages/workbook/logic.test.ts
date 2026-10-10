import { defaultValues, randomValues, renderTex } from '@/components'
import { ALL_HANDCALCS } from '@/app/handcalcs'
import { PAGES } from '@/app/registry'
import type { HandCalcDef } from '@/data/types'
import {
  EMPTY_FILTERS,
  EMPTY_STATS,
  LEVELS,
  LEVEL_LABEL,
  NEW_RECORD,
  SEED_MAX,
  WORKSHEET_MAX,
  WORKSHEET_MIN,
  accuracy,
  buildWorksheet,
  chapterOf,
  clampCount,
  countByLevel,
  filterHandcalcs,
  filtersToParams,
  givenTex,
  groupByChapter,
  isFiltered,
  isWorkbookStats,
  matchesQuery,
  normalizeText,
  parseFilters,
  parseSeed,
  parseTab,
  practiceItem,
  resultTex,
  scoreCheck,
  shuffled,
  statsReducer,
  statsTotals,
  worksheetFingerprint,
  type StatsAction,
  type WorkbookStats,
  type WorksheetOptions,
} from './logic'

/** 測試用的假題目：y = k·x（k 可隨機、x 固定） */
function fake(id: string, page: string, level: HandCalcDef['level'], title = `題目 ${id}`, random = true): HandCalcDef {
  return {
    id,
    title,
    page,
    formulaId: `F-${id}`,
    formulaTex: 'y = k\\,x',
    level,
    claim: 'exact',
    inputs: [
      { key: 'k', symbol: 'k', label: '倍數', default: 2, min: 0, max: 100, integer: true, ...(random ? { practice: { min: 1, max: 60, step: 1 } } : {}) },
      { key: 'x', symbol: 'x', label: '輸入', default: 3, unit: '\\mathrm{fs}' },
    ],
    solve: ({ k, x }) => ({
      steps: [{ tex: `y = k\\,x = ${k}\\times${x} = ${k * x}`, why: '相乘。' }],
      results: [{ symbol: 'y', value: k * x, unit: '\\mathrm{fs}' }],
    }),
  }
}

const FAKE_PAGES = [
  { id: 'ch00', path: '/ch/00', nav: '00 入門', title: '入門' },
  { id: 'ch05', path: '/ch/05', nav: '05 Comparator', title: 'Comparator' },
  { id: 'tools', path: '/tools', nav: '工具', title: '工具' },
]
const FAKES: HandCalcDef[] = [
  fake('HC-05.2', '/ch/05', 'engineer', '累加 $N$ 次：$\\mathrm{SD}(S_N)$ 與 $\\sigma_v$'),
  fake('HC-00.10', '/ch/00', 'beginner', 'LMS 更新兩步'),
  fake('HC-00.2', '/ch/00', 'beginner', '學習率上限與 pole'),
  fake('HC-TL.1', '/tools', 'research', '查 Φ 表：τ 與 μ'),
  fake('HC-05.1', '/ch/05', 'research', '單一次比較 P(q=+1)'),
  fake('HC-XX.1', '/nowhere', 'engineer', '找不到頁面的題目'),
]

describe('章節分組', () => {
  it('依目錄順序分組、組內依題號（數字順序）排序；找不到頁面的題目排在最後', () => {
    const groups = groupByChapter(FAKES, FAKE_PAGES)
    expect(groups.map((g) => g.key)).toEqual(['ch00', 'ch05', 'tools', '/nowhere'])
    expect(groups[0].items.map((d) => d.id)).toEqual(['HC-00.2', 'HC-00.10'])
    expect(groups[1].items.map((d) => d.id)).toEqual(['HC-05.1', 'HC-05.2'])
    expect(groups[0]).toMatchObject({ path: '/ch/00', nav: '00 入門', order: 0 })
    expect(chapterOf(FAKES[5], FAKE_PAGES)).toMatchObject({ key: '/nowhere', path: '/nowhere', order: 3 })
  })

  it('全站題庫：每一題都對得上註冊表裡的頁面，分組不漏題、不重複', () => {
    expect(ALL_HANDCALCS.length).toBeGreaterThan(40)
    const groups = groupByChapter(ALL_HANDCALCS)
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(ALL_HANDCALCS.length)
    expect(new Set(groups.flatMap((g) => g.items.map((d) => d.id))).size).toBe(ALL_HANDCALCS.length)
    for (const g of groups) {
      const page = PAGES.find((p) => p.id === g.key)
      expect(page, `頁面 ${g.key}`).toBeTruthy()
      expect(g.path).toBe(page?.path)
      expect(g.nav).toBe(page?.nav)
    }
    const order = groups.map((g) => g.order)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    const c = countByLevel(ALL_HANDCALCS)
    expect(c.beginner + c.engineer + c.research).toBe(ALL_HANDCALCS.length)
    for (const l of LEVELS) expect(LEVEL_LABEL[l]).toBeTruthy()
  })
})

describe('篩選與搜尋', () => {
  const ids = (f: Partial<typeof EMPTY_FILTERS>) =>
    filterHandcalcs(FAKES, { ...EMPTY_FILTERS, ...f }, FAKE_PAGES)
      .map((d) => d.id)
      .sort()

  it('沒有條件 = 全部', () => {
    expect(ids({})).toHaveLength(FAKES.length)
    expect(isFiltered(EMPTY_FILTERS)).toBe(false)
    expect(isFiltered({ ...EMPTY_FILTERS, q: '  ' })).toBe(false)
    expect(isFiltered({ ...EMPTY_FILTERS, level: 'research' })).toBe(true)
  })

  it('依章節、依難度、兩者同時', () => {
    expect(ids({ chapter: 'ch05' })).toEqual(['HC-05.1', 'HC-05.2'])
    expect(ids({ level: 'research' })).toEqual(['HC-05.1', 'HC-TL.1'])
    expect(ids({ chapter: 'ch05', level: 'research' })).toEqual(['HC-05.1'])
    expect(ids({ chapter: 'ch00', level: 'research' })).toEqual([])
  })

  it('搜尋：題號、標題、公式編號、章節名稱；不分大小寫；空白分隔 = 都要出現', () => {
    expect(ids({ q: 'hc-05' })).toEqual(['HC-05.1', 'HC-05.2'])
    expect(ids({ q: 'POLE' })).toEqual(['HC-00.2'])
    expect(ids({ q: 'f-hc-tl' })).toEqual(['HC-TL.1'])
    expect(ids({ q: 'comparator' })).toEqual(['HC-05.1', 'HC-05.2'])
    expect(ids({ q: 'comparator 累加' })).toEqual(['HC-05.2'])
    expect(ids({ q: '不存在的字' })).toEqual([])
    expect(ids({ q: 'lms', chapter: 'ch05' })).toEqual([])
  })

  it('搜尋：希臘字母的字元、英文名稱與標題裡的 TeX 指令互通', () => {
    expect(normalizeText('Σ_w 與 Τ、µ')).toBe('sigma_w 與 tau、mu')
    // 標題寫 `\sigma_v`（TeX）：打「sigma」或「σ」都找得到
    expect(ids({ q: 'sigma' })).toEqual(['HC-05.2'])
    expect(ids({ q: 'σ' })).toEqual(['HC-05.2'])
    // 標題寫 Unicode「τ 與 μ」：打英文名稱也找得到
    expect(ids({ q: 'tau' })).toEqual(['HC-TL.1'])
    expect(ids({ q: 'mu tau' })).toEqual(['HC-TL.1'])
    expect(matchesQuery(FAKES[3], 'Φ', FAKE_PAGES)).toBe(true)
    expect(matchesQuery(FAKES[3], 'phi', FAKE_PAGES)).toBe(true)
  })

  it('全站題庫：依章節篩選得到的就是那一組；依難度篩選的題數等於統計', () => {
    const groups = groupByChapter(ALL_HANDCALCS)
    for (const g of groups.slice(0, 4)) {
      const got = filterHandcalcs(ALL_HANDCALCS, { ...EMPTY_FILTERS, chapter: g.key })
      expect(got.map((d) => d.id).sort()).toEqual(g.items.map((d) => d.id).sort())
    }
    const c = countByLevel(ALL_HANDCALCS)
    for (const l of LEVELS) expect(filterHandcalcs(ALL_HANDCALCS, { ...EMPTY_FILTERS, level: l })).toHaveLength(c[l])
    // 用題號搜尋一定找得到那一題
    const first = ALL_HANDCALCS[0]
    expect(filterHandcalcs(ALL_HANDCALCS, { ...EMPTY_FILTERS, q: first.id }).map((d) => d.id)).toContain(first.id)
  })

  it('網址參數 ↔ 篩選條件：不合法的值被忽略，其他參數保留', () => {
    const valid = ['ch00', 'ch05']
    expect(parseFilters(new URLSearchParams('ch=ch05&level=engineer&q=pole'), valid)).toEqual({ chapter: 'ch05', level: 'engineer', q: 'pole' })
    expect(parseFilters(new URLSearchParams('ch=nope&level=expert'), valid)).toEqual(EMPTY_FILTERS)
    expect(parseFilters(new URLSearchParams(''), valid)).toEqual(EMPTY_FILTERS)

    const sp = filtersToParams({ chapter: 'ch05', level: '', q: 'σ v' }, new URLSearchParams('tab=practice&level=research&hc=HC-00.1'))
    expect(sp.get('ch')).toBe('ch05')
    expect(sp.has('level')).toBe(false)
    expect(sp.get('q')).toBe('σ v')
    expect(sp.get('tab')).toBe('practice')
    expect(sp.get('hc')).toBe('HC-00.1')
    expect(parseFilters(sp, valid)).toEqual({ chapter: 'ch05', level: '', q: 'σ v' })
    expect(filtersToParams(EMPTY_FILTERS).toString()).toBe('')

    expect(parseTab('practice')).toBe('practice')
    expect(parseTab('sheet')).toBe('sheet')
    expect(parseTab('bogus')).toBe('browse')
    expect(parseTab(null)).toBe('browse')
  })
})

describe('seed 與洗牌', () => {
  it('parseSeed 只接受 0 … 2^32−1 的整數', () => {
    expect(parseSeed('0')).toBe(0)
    expect(parseSeed(' 20261010 ')).toBe(20261010)
    expect(parseSeed(String(SEED_MAX))).toBe(SEED_MAX)
    expect(parseSeed(String(SEED_MAX + 1))).toBeNull()
    expect(parseSeed('-1')).toBeNull()
    expect(parseSeed('1.5')).toBeNull()
    expect(parseSeed('abc')).toBeNull()
    expect(parseSeed('')).toBeNull()
  })

  it('shuffled：同 seed 同結果、是原陣列的排列、不改動輸入', () => {
    const src = Array.from({ length: 40 }, (_, i) => i)
    const a = shuffled(src, 7, 'x')
    expect(shuffled(src, 7, 'x')).toEqual(a)
    expect([...a].sort((p, q) => p - q)).toEqual(src)
    expect(src[0]).toBe(0)
    expect(shuffled(src, 8, 'x')).not.toEqual(a)
    expect(shuffled(src, 7, 'y')).not.toEqual(a)
    expect(shuffled([], 1, 'x')).toEqual([])
  })
})

describe('隨機練習出題', () => {
  it('同（題庫、seed、第幾題）得到同一題與同一組數字；題庫順序不影響結果', () => {
    const a = practiceItem(FAKES, 42, 3)
    const b = practiceItem([...FAKES].reverse(), 42, 3)
    expect(a).not.toBeNull()
    expect(b?.def.id).toBe(a?.def.id)
    expect(b?.values).toEqual(a?.values)
    expect(a?.key).toBe(`${a?.def.id}@${a?.valueSeed}`)
    expect(a?.valueSeed).toBe(45)
    expect(a?.values).toEqual(randomValues(a!.def, 45))
    expect(a?.solution.results[0].value).toBe(a!.values.k * a!.values.x)
  })

  it('整個題庫輪完之前不重複；輪完之後同一題換一組數字', () => {
    const n = FAKES.length
    const firstRound = Array.from({ length: n }, (_, k) => practiceItem(FAKES, 5, k)!)
    expect(new Set(firstRound.map((i) => i.def.id)).size).toBe(n)
    expect(firstRound.every((i) => i.poolSize === n)).toBe(true)
    const again = practiceItem(FAKES, 5, n)!
    expect(again.def.id).toBe(firstRound[0].def.id)
    expect(again.key).not.toBe(firstRound[0].key)
  })

  it('某一題的 solve 丟例外：跳到洗牌順序的下一題；全部都壞才回傳 null', () => {
    const broken: HandCalcDef = {
      ...fake('HC-BAD.1', '/ch/00', 'beginner'),
      solve: () => {
        throw new Error('壞掉的題目')
      },
    }
    for (let k = 0; k < 6; k++) {
      const it = practiceItem([broken, FAKES[0], FAKES[1]], 3, k)
      expect(it).not.toBeNull()
      expect(it?.def.id).not.toBe('HC-BAD.1')
    }
    expect(practiceItem([broken], 3, 0)).toBeNull()
    // 練習卷同樣跳過壞掉的題目
    const ws = buildWorksheet([broken, FAKES[0], FAKES[1]], { chapters: [], levels: [], count: 5, seed: 1, numbers: 'default' }, FAKE_PAGES)
    expect(ws.items.map((i) => i.def.id).sort()).toEqual([FAKES[0].id, FAKES[1].id].sort())
  })

  it('空題庫回傳 null；全站題庫抽出的數字都通過該題的 validate、答案有限', () => {
    expect(practiceItem([], 1, 0)).toBeNull()
    for (let k = 0; k < 40; k++) {
      const it = practiceItem(ALL_HANDCALCS, 20261010, k)!
      expect(it.def.validate?.(it.values) ?? null, it.def.id).toBeNull()
      expect(it.solution.results.length, it.def.id).toBeGreaterThan(0)
      expect(it.solution.results.every((r) => Number.isFinite(r.value)), it.def.id).toBe(true)
    }
  })
})

describe('作答統計（reducer）', () => {
  const run = (actions: StatsAction[], start: WorkbookStats = EMPTY_STATS) => actions.reduce(statsReducer, start)

  it('attempt 只加作答；correct 加答對並記下題號；不改動原物件', () => {
    const s1 = statsReducer(EMPTY_STATS, { type: 'attempt', chapter: 'ch03' })
    expect(s1.chapters.ch03).toEqual({ attempted: 1, correct: 0 })
    expect(EMPTY_STATS.chapters).toEqual({})
    const s2 = statsReducer(s1, { type: 'correct', chapter: 'ch03', id: 'HC-03.1' })
    expect(s2.chapters.ch03).toEqual({ attempted: 1, correct: 1 })
    expect(s2.solved).toEqual(['HC-03.1'])
    expect(s1.chapters.ch03).toEqual({ attempted: 1, correct: 0 })
  })

  it('各章分開統計，總計與正確率', () => {
    const s = run([
      { type: 'attempt', chapter: 'ch03' },
      { type: 'correct', chapter: 'ch03', id: 'HC-03.1' },
      { type: 'attempt', chapter: 'ch03' },
      { type: 'attempt', chapter: 'ch05' },
      { type: 'attempt', chapter: 'ch05' },
      { type: 'correct', chapter: 'ch05', id: 'HC-05.2' },
      { type: 'attempt', chapter: 'ch05' },
      { type: 'correct', chapter: 'ch05', id: 'HC-05.2' },
    ])
    expect(s.chapters).toEqual({ ch03: { attempted: 2, correct: 1 }, ch05: { attempted: 3, correct: 2 } })
    expect(s.solved).toEqual(['HC-03.1', 'HC-05.2']) // 同一題號只記一次
    expect(statsTotals(s)).toEqual({ attempted: 5, correct: 3 })
    expect(accuracy(statsTotals(s))).toBeCloseTo(0.6, 12)
    expect(accuracy({ attempted: 0, correct: 0 })).toBeNull()
    expect(isWorkbookStats(s)).toBe(true)
  })

  it('不變量 0 ≤ correct ≤ attempted：沒有對應 attempt 的 correct 也不會讓答對超過作答', () => {
    const s = run([
      { type: 'correct', chapter: 'ch01', id: 'HC-01.1' },
      { type: 'correct', chapter: 'ch01', id: 'HC-01.2' },
    ])
    expect(s.chapters.ch01.correct).toBeLessThanOrEqual(s.chapters.ch01.attempted)
    expect(isWorkbookStats(s)).toBe(true)
  })

  it('reset 回到空統計', () => {
    const s = run([{ type: 'attempt', chapter: 'ch03' }, { type: 'correct', chapter: 'ch03', id: 'HC-03.1' }, { type: 'reset' }])
    expect(s).toEqual(EMPTY_STATS)
    expect(statsTotals(s)).toEqual({ attempted: 0, correct: 0 })
  })

  it('isWorkbookStats 擋掉舊版或被改壞的資料', () => {
    expect(isWorkbookStats(EMPTY_STATS)).toBe(true)
    expect(isWorkbookStats(null)).toBe(false)
    expect(isWorkbookStats('x')).toBe(false)
    expect(isWorkbookStats({})).toBe(false)
    expect(isWorkbookStats({ v: 2, chapters: {}, solved: [] })).toBe(false)
    expect(isWorkbookStats({ v: 1, chapters: [], solved: [] })).toBe(false)
    expect(isWorkbookStats({ v: 1, chapters: {}, solved: [1] })).toBe(false)
    expect(isWorkbookStats({ v: 1, chapters: { a: { attempted: 1 } }, solved: [] })).toBe(false)
    expect(isWorkbookStats({ v: 1, chapters: { a: { attempted: 1, correct: 2 } }, solved: [] })).toBe(false)
    expect(isWorkbookStats({ v: 1, chapters: { a: { attempted: -1, correct: 0 } }, solved: [] })).toBe(false)
    expect(isWorkbookStats({ v: 1, chapters: { a: { attempted: 1.5, correct: 0 } }, solved: [] })).toBe(false)
    expect(isWorkbookStats({ v: 1, chapters: { a: { attempted: 3, correct: 2 } }, solved: ['HC-00.1'] })).toBe(true)
  })

  it('記分規則 scoreCheck：每題只記一次作答；看詳解之前全對才記答對，而且只記一次', () => {
    // 第一次就全對
    let r = scoreCheck(NEW_RECORD, true)
    expect(r.actions).toEqual(['attempt', 'correct'])
    expect(r.record).toEqual({ attempted: true, credited: true, revealed: false })
    expect(scoreCheck(r.record, true).actions).toEqual([])
    // 先錯、修正後全對
    r = scoreCheck(NEW_RECORD, false)
    expect(r.actions).toEqual(['attempt'])
    r = scoreCheck(r.record, false)
    expect(r.actions).toEqual([])
    r = scoreCheck(r.record, true)
    expect(r.actions).toEqual(['correct'])
    // 先看詳解：只記作答
    r = scoreCheck({ ...NEW_RECORD, revealed: true }, true)
    expect(r.actions).toEqual(['attempt'])
    expect(r.record.credited).toBe(false)
    expect(scoreCheck(r.record, true).actions).toEqual([])
  })
})

describe('練習卷', () => {
  const base: WorksheetOptions = { chapters: [], levels: [], count: 10, seed: 20261010, numbers: 'random' }

  it('同一個 seed 一定得到同一張卷；換 seed 就不同', () => {
    const a = buildWorksheet(ALL_HANDCALCS, base)
    const b = buildWorksheet([...ALL_HANDCALCS].reverse(), { ...base })
    expect(a.items).toHaveLength(10)
    expect(worksheetFingerprint(b)).toBe(worksheetFingerprint(a))
    expect(b.items.map((i) => i.def.id)).toEqual(a.items.map((i) => i.def.id))
    const c = buildWorksheet(ALL_HANDCALCS, { ...base, seed: 20261011 })
    expect(worksheetFingerprint(c)).not.toBe(worksheetFingerprint(a))
    // 一張卷內不重複出同一題
    expect(new Set(a.items.map((i) => i.def.id)).size).toBe(10)
    expect(a.shortfall).toBe(false)
    expect(a.poolSize).toBe(ALL_HANDCALCS.length)
  })

  it('題號從 1 連續編號，依全站章節順序、題號排列；解答就是 def.solve(該題的數字)', () => {
    const ws = buildWorksheet(ALL_HANDCALCS, { ...base, count: 20 })
    expect(ws.items.map((i) => i.no)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    for (let i = 1; i < ws.items.length; i++) {
      const [p, q] = [ws.items[i - 1], ws.items[i]]
      expect(p.chapter.order).toBeLessThanOrEqual(q.chapter.order)
      if (p.chapter.order === q.chapter.order) expect(p.def.id.localeCompare(q.def.id, 'en', { numeric: true })).toBeLessThanOrEqual(0)
    }
    for (const it of ws.items) {
      expect(it.values).toEqual(randomValues(it.def, ws.options.seed))
      expect(it.def.validate?.(it.values) ?? null, it.def.id).toBeNull()
      const again = it.def.solve(it.values)
      expect(it.solution.results.map((r) => r.value)).toEqual(again.results.map((r) => r.value))
      expect(it.solution.steps.map((s) => s.tex)).toEqual(again.steps.map((s) => s.tex))
      expect(it.solution.steps.length).toBeGreaterThan(0)
    }
  })

  it('題數夾在 5–30；章節與難度條件有效', () => {
    expect(clampCount(1)).toBe(WORKSHEET_MIN)
    expect(clampCount(99)).toBe(WORKSHEET_MAX)
    expect(clampCount(12.4)).toBe(12)
    expect(clampCount(Number.NaN)).toBe(10)
    expect(buildWorksheet(ALL_HANDCALCS, { ...base, count: 1 }).items).toHaveLength(WORKSHEET_MIN)
    expect(buildWorksheet(ALL_HANDCALCS, { ...base, count: 99 }).items).toHaveLength(WORKSHEET_MAX)

    const groups = groupByChapter(ALL_HANDCALCS)
    const keys = groups.slice(0, 2).map((g) => g.key)
    const ws = buildWorksheet(ALL_HANDCALCS, { ...base, chapters: keys, levels: ['beginner', 'engineer'], count: 6 })
    expect(ws.items.length).toBeGreaterThan(0)
    for (const it of ws.items) {
      expect(keys).toContain(it.chapter.key)
      expect(['beginner', 'engineer']).toContain(it.def.level)
    }
    expect(ws.poolSize).toBe(ALL_HANDCALCS.filter((d) => keys.includes(chapterOf(d).key) && d.level !== 'research').length)
    expect(buildWorksheet(ALL_HANDCALCS, { ...base, chapters: ['不存在的章節'] }).items).toEqual([])
  })

  it('「課文範例的數字」：每題用 inputs 的 default，題庫不夠時標示 shortfall', () => {
    const ws = buildWorksheet(FAKES, { ...base, numbers: 'default', count: 10 }, FAKE_PAGES)
    expect(ws.items).toHaveLength(FAKES.length)
    expect(ws.shortfall).toBe(true)
    for (const it of ws.items) expect(it.values).toEqual(defaultValues(it.def))
    expect(ws.items.map((i) => i.def.id)).toEqual(['HC-00.2', 'HC-00.10', 'HC-05.1', 'HC-05.2', 'HC-TL.1', 'HC-XX.1'])
  })

  it('題庫比題數小：同一題換一組數字再出一輪，數字完全相同的不重複出', () => {
    const ws = buildWorksheet(FAKES, { ...base, count: 12 }, FAKE_PAGES)
    expect(ws.items).toHaveLength(12)
    expect(ws.poolSize).toBe(FAKES.length)
    expect(ws.shortfall).toBe(false)
    const sigs = ws.items.map((i) => `${i.def.id}|${JSON.stringify(i.values)}`)
    expect(new Set(sigs).size).toBe(12)
    // 沒有 practice 範圍的題目每次都是同一組數字 → 只會出現一次，出不滿就標示 shortfall
    const fixed = [fake('HC-F.1', '/ch/00', 'beginner', '固定數字 1', false), fake('HC-F.2', '/ch/00', 'beginner', '固定數字 2', false)]
    const short = buildWorksheet(fixed, { ...base, count: 5 }, FAKE_PAGES)
    expect(short.items.map((i) => i.def.id)).toEqual(['HC-F.1', 'HC-F.2'])
    expect(short.shortfall).toBe(true)
  })
})

describe('顯示用的 TeX', () => {
  it('givenTex／resultTex：數字、單位與框', () => {
    expect(givenTex('\\mu', 0.1, '\\mathrm{fs}')).toBe('\\mu = 0.1\\ \\mathrm{fs}')
    expect(givenTex('N', 4096)).toBe('N = 4096')
    expect(givenTex('x', 0.30000000000000004)).toBe('x = 0.3')
    expect(givenTex('f', 4e9, '\\mathrm{Hz}')).toBe('f = 4\\times10^{9}\\ \\mathrm{Hz}')
    expect(resultTex({ symbol: 'w_1', value: 1.8 })).toBe('\\boxed{w_1 = 1.8}')
    expect(resultTex({ symbol: 'p', value: 0.920212345, unit: '\\mathrm{fs}', digits: 4 })).toBe('\\boxed{p = 0.9202\\ \\mathrm{fs}}')
  })

  it('全站題庫：每一題的「已知」與「求」都排得出可渲染的 TeX', () => {
    const bad = (html: string) => /katex-error|c-tex-error/.test(html)
    for (const def of ALL_HANDCALCS) {
      const v = randomValues(def, 11)
      for (const i of def.inputs) expect(bad(renderTex(givenTex(i.symbol, v[i.key], i.unit), false)), `${def.id} ${i.key}`).toBe(false)
      for (const r of def.solve(v).results) {
        expect(bad(renderTex(`${r.symbol} =`, false)), `${def.id} ${r.symbol}`).toBe(false)
        expect(bad(renderTex(resultTex(r), true)), `${def.id} ${r.symbol}`).toBe(false)
      }
    }
  })
})
