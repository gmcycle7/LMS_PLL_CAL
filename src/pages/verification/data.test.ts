import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import katex from 'katex'
import { listRegions } from '@/components'
import { ACCEPTANCE_IDS, MC_PLAN, MUTANTS } from '@/simulation/models/acceptance'
import { ACCEPTANCE_ROWS, MUTANT_TEXT, NEGATIVE_TESTS, testsForErratum } from './data'
import {
  chapterHref,
  chapterLabel,
  countBySeverity,
  DEFAULT_FILTER,
  distinctChapters,
  ERRATA,
  erratumById,
  erratumHref,
  filterErrata,
  mentionedTests,
  parseRefuted,
  parseValidationStats,
  passesFilter,
  VALIDATION_STATS,
} from './errata'
import { ERRATA_MATH } from './errataMath'
import { FORMULAS } from './formulas'
import { GOLDEN, GOLDEN_INDEX, GOLDEN_NEGATIVE } from './golden'
import { decomposeDouble, exactDiffToFraction, extractJsConstLines, extractJsFunctions, extractPythonDefs, fmtNum, fmtNumeric, fmtTol, pick, ratioTex, texNum, texToPlain, tolTex } from './format'
import { computeAcceptanceState } from './common'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

const texOk = (tex: string, where: string) => expect(() => katex.renderToString(tex, { throwOnError: true, strict: 'ignore' }), `${where}：${tex}`).not.toThrow()

/** 含 `$…$` 的說明文字：$ 成對，且每一段都是合法 TeX */
function inlineOk(text: string, where: string) {
  const parts = text.split('$')
  expect(parts.length % 2, `${where}：$ 不成對 → ${text}`).toBe(1)
  parts.forEach((p, i) => {
    if (i % 2 === 1) texOk(p, where)
  })
}

describe('verification：描述性資料與實際檔案一致', () => {
  it('T01–T18 每列都有 metadata，順序正確；headline key 都存在於 golden expected', () => {
    expect(ACCEPTANCE_ROWS.map((r) => r.id)).toEqual([...ACCEPTANCE_IDS])
    for (const r of ACCEPTANCE_ROWS) {
      expect(r.headline.length, r.id).toBeGreaterThan(0)
      for (const h of r.headline) {
        const v = GOLDEN[r.id].expected[h.key]
        expect(v, `${r.id}.${h.key}`).toBeDefined()
        if (h.index !== undefined) expect(Array.isArray(v) && (v as unknown[]).length > h.index).toBe(true)
      }
      expect(r.chapters.length).toBeGreaterThan(0)
      for (const c of r.chapters) expect(c.path).toMatch(/^\/ch\/\d{2}$/)
    }
  })

  it('每個引用的勘誤 id 都存在於 errata.json（驗收表、反面測試、mutant）', () => {
    const ids = new Set(ERRATA.map((e) => e.eid))
    const refs = [...ACCEPTANCE_ROWS.flatMap((r) => r.errata), ...NEGATIVE_TESTS.flatMap((n) => n.errata), ...MUTANTS.flatMap((m) => m.errata)]
    expect(refs.length).toBeGreaterThan(20)
    for (const e of refs) expect(ids.has(e), e).toBe(true)
  })

  it('反面測試列出的 TS 測試名稱與 Python 函式名稱真的存在於對應檔案（不是手寫的假清單）', () => {
    for (const n of NEGATIVE_TESTS) {
      for (const t of n.ts) {
        const src = read(t.file)
        expect(src.includes(`it('${t.name}'`), `${t.file}：${t.name}`).toBe(true)
      }
      for (const t of n.py) expect(read(t.file).includes(`def ${t.name}(`), `${t.file}：${t.name}`).toBe(true)
    }
    // 計入 T-id 的反面測試至少有一個 TS 測試以「Txx:」開頭；Python 名稱以 test_Txx_ 開頭；unmapped 的則是 test_NEG_
    for (const n of NEGATIVE_TESTS) {
      if (n.tId) expect(n.ts.some((t) => t.name.startsWith(`${n.tId}:`)), n.id).toBe(true)
      for (const t of n.py) {
        if (n.tId) expect(t.name.startsWith(`test_${n.tId}_`), t.name).toBe(true)
        else expect(t.name.startsWith('test_NEG_'), t.name).toBe(true)
      }
    }
  })

  it('規格 §17 末段的 9 種反面情境全部列出', () => {
    expect(NEGATIVE_TESTS.map((n) => n.title)).toEqual([
      '極性反轉',
      '完全缺乏 PE',
      'Code misalignment',
      'N 改變卻忘記 scaling',
      '定點 overflow',
      String.raw`錯誤位元符號（0/1 沒映射成 $\pm1$）`,
      'PLL 誤差與輸出路徑混淆',
      '低取樣率的 aliasing',
      '「模型公式有錯，UI 卻顯示成功」',
    ])
  })

  it('每個 mutant 都有說明文字；並排程式碼的 region 都存在（acceptance.ts 與章節模型）', () => {
    const acc = read('src/simulation/models/acceptance.ts')
    const accRegions = listRegions(acc)
    for (const m of MUTANTS) {
      expect(MUTANT_TEXT[m.id], m.id).toBeDefined()
      expect(accRegions, m.region).toContain(m.region)
      const src = read(`src/simulation/models/${m.correct.module}.ts`)
      expect(listRegions(src), `${m.correct.module}:${m.correct.region}`).toContain(m.correct.region)
    }
    for (const id of ACCEPTANCE_IDS) expect(accRegions).toContain(id)
    expect(accRegions).toEqual(expect.arrayContaining(['goldenRule', 'compareToGolden', 'runAcceptanceMonteCarlo', 'equivalentZ', 'zCheck', 'ar1SampleBias', 'sweepScores', 'parseQuotedNumber']))
    // 頁面以 CodeCompare 顯示的章節 region
    expect(listRegions(read('src/simulation/models/calNoise.ts'))).toContain('calLoop')
    expect(listRegions(read('src/simulation/models/comparator.ts'))).toContain('directionExact')
  })

  it('所有說明文字與 TeX 欄位都能被 KaTeX 解析（驗收表、反面測試、mutant）', () => {
    for (const row of ACCEPTANCE_ROWS) {
      inlineOk(row.title, `${row.id} title`)
      texOk(row.inputTex, `${row.id} inputTex`)
      texOk(row.specTex, `${row.id} specTex`)
      if (row.correctedTex) texOk(row.correctedTex, `${row.id} correctedTex`)
      if (row.correctedNote) inlineOk(row.correctedNote, `${row.id} correctedNote`)
      for (const h of row.headline) {
        texOk(h.tex, `${row.id} headline`)
        if (h.unit) texOk(h.unit, `${row.id} headline unit`)
      }
    }
    for (const n of NEGATIVE_TESTS) {
      inlineOk(n.title, n.id)
      inlineOk(n.failure, n.id)
    }
    for (const [id, t] of Object.entries(MUTANT_TEXT)) {
      inlineOk(t.title, id)
      inlineOk(t.lesson, id)
      texOk(t.wrongTex, id)
      texOk(t.rightTex, id)
      expect(texToPlain(t.title)).not.toMatch(/[$\\]/) // select 選項用的純文字版本沒有殘留的 TeX 指令
    }
  })

  it('公式登錄 F-VF.1…：ID 唯一且連號、頁面為 /verification、TeX 可解析、勘誤編號存在', () => {
    expect(FORMULAS.map((f) => f.id)).toEqual(FORMULAS.map((_, i) => `F-VF.${i + 1}`))
    const ids = new Set(ERRATA.map((e) => e.eid))
    for (const f of FORMULAS) {
      expect(f.page).toBe('/verification')
      texOk(f.tex, f.id)
      expect(f.title.length).toBeGreaterThan(4)
      expect(f.conditions.length).toBeGreaterThan(10)
      expect(f.title).not.toMatch(/\$/) // 彙整頁把 title / conditions 當純文字
      expect(f.conditions).not.toMatch(/\$/)
      if (f.erratumId) expect(ids.has(f.erratumId), f.erratumId).toBe(true)
    }
    expect(FORMULAS.length).toBeGreaterThanOrEqual(12)
  })

  it('golden 索引與 negative_tests 正確載入', () => {
    expect(GOLDEN_INDEX.vectors.map((v) => v.id)).toEqual(expect.arrayContaining([...ACCEPTANCE_IDS, 'negative_tests']))
    expect(Object.keys(GOLDEN_NEGATIVE.expected)).toHaveLength(8)
    for (const id of ACCEPTANCE_IDS) expect(GOLDEN[id].id).toBe(id)
  })
})

describe('verification：勘誤工具', () => {
  it('49 項勘誤：high 2、medium 14、low 33；每項都有 location / problem / correction / evidence', () => {
    expect(ERRATA).toHaveLength(49)
    expect(countBySeverity(ERRATA)).toEqual({ high: 2, medium: 14, low: 33 })
    ERRATA.forEach((e, i) => {
      expect(e.eid).toBe(`E${String(i + 1).padStart(2, '0')}`)
      for (const k of ['location', 'problem', 'correction', 'evidence'] as const) expect(e[k].length).toBeGreaterThan(10)
    })
  })

  it('篩選：嚴重度、章節、文字搜尋、只看與 T01–T18 相關；深連結的勘誤被擋住時可偵測', () => {
    const rel = (e: (typeof ERRATA)[number]) => [...new Set([...testsForErratum(e.eid), ...mentionedTests(e)])]
    expect(filterErrata(ERRATA, { ...DEFAULT_FILTER, severity: 'high' }, rel).map((e) => e.eid)).toEqual(['E01', 'E02'])
    expect(filterErrata(ERRATA, { ...DEFAULT_FILTER, chapter: 'ch05' }, rel).map((e) => e.eid)).toEqual(['E02', 'E18'])
    expect(filterErrata(ERRATA, { ...DEFAULT_FILTER, query: 'ENBW' }, rel).map((e) => e.eid)).toContain('E06')
    const onlyAcc = filterErrata(ERRATA, { ...DEFAULT_FILTER, onlyAcceptance: true }, rel)
    expect(onlyAcc.map((e) => e.eid)).toEqual(expect.arrayContaining(['E01', 'E02', 'E05', 'E06', 'E14', 'E30']))
    expect(onlyAcc.length).toBeLessThan(ERRATA.length)
    const e05 = erratumById('e05')!
    expect(passesFilter(e05, { ...DEFAULT_FILTER, severity: 'high' }, rel)).toBe(false)
    expect(passesFilter(e05, DEFAULT_FILTER, rel)).toBe(true)
    expect(erratumById('E99')).toBeUndefined()
  })

  it('errataMath：49 項勘誤都有 KaTeX 的摘要與修正式；純文字勘誤（E25、E36、E43）沒有「規格原式」；全部可解析', () => {
    expect(Object.keys(ERRATA_MATH).sort()).toEqual(ERRATA.map((e) => e.eid))
    for (const [eid, m] of Object.entries(ERRATA_MATH)) {
      inlineOk(m.gist, `${eid} gist`)
      expect(m.gist.length, eid).toBeGreaterThan(3)
      if (m.spec !== null) texOk(m.spec, `${eid} spec`)
      texOk(m.fix, `${eid} fix`)
    }
    expect(Object.entries(ERRATA_MATH).filter(([, m]) => m.spec === null).map(([eid]) => eid)).toEqual(['E25', 'E36', 'E43'])
    for (const [eid, m] of Object.entries(ERRATA_MATH)) if (m.addendum !== undefined) inlineOk(m.addendum, `${eid} addendum`)
    // 摘要裡引用的關鍵數字真的出現在原文（抽查）
    const text = (eid: string) => {
      const e = erratumById(eid)!
      return `${e.location} ${e.problem} ${e.correction} ${e.evidence}`
    }
    expect(text('E01')).toContain('1.34')
    expect(text('E05')).toContain('0.99996011')
    expect(text('E06')).toContain('20.29')
    expect(text('E14')).toContain('2.4212')
    expect(text('E47')).toContain('8.36')
  })

  it('技術審查 R05：E01 的原文（歷史紀錄）仍寫「由 E[x·sign(e)]=0 決定」，卡片用 addendum 說明無雜訊、離散 code 時是變號點而不是根；errata.json 與 docs/validation.md 的原文一致', () => {
    const e = erratumById('E01')!
    expect(e.problem).toContain('無雜訊時 Sign-LMS 的固定點由 E[x·sign(e)]=0 決定')
    expect(read('docs/validation.md')).toContain(e.problem)
    const m = ERRATA_MATH.E01
    expect(m.fix).toContain(String.raw`\text{由正變負（跳過 }0\text{）}`)
    expect(m.addendum).toBeDefined()
    for (const need of ['階梯函數', '變號的位置', '加權中位數', String.raw`由 $+0.4$ 直接跳到 $-1.2$`, '數值不變']) expect(m.addendum, need).toContain(need)
    // 無雜訊 GMAC 的兩個平台值（原文的數值證據）：w ∈ (1.1, 1.4) 時 +0.4、w > 1.4 時 −1.2；用整數（全部乘 10）重算
    const G10 = (w10: number) => [-2, -1, 0, 1, 2].reduce((acc, x) => acc + x * Math.sign((10 - w10) * x + x ** 3), 0) / 5
    expect(G10(13)).toBeCloseTo(0.4, 12)
    expect(G10(15)).toBeCloseTo(-1.2, 12)
    expect(e.evidence).toContain('w∈(1.1,1.4) 時 G=+0.4，w>1.4 時 G=-1.2')
    // 只有需要的勘誤才有 addendum（目前只有 E01）
    expect(Object.entries(ERRATA_MATH).filter(([, x]) => x.addendum !== undefined).map(([eid]) => eid)).toEqual(['E01'])
  })

  it('errataMath 的數字不是另外編的：摘要與公式中的每個小數、每個三位以上的整數，都逐字出現在該勘誤的原文裡', () => {
    // 兩個例外是原文數字的合理捨入：E05 的 0.00798（原文 0.00797885）、E10 的 20.289（原文 20.29 kHz / 20289.0 Hz）
    const rounded: Record<string, string[]> = { E05: ['0.00798'], E10: ['20.289'] }
    let checked = 0
    for (const [eid, m] of Object.entries(ERRATA_MATH)) {
      const e = erratumById(eid)!
      const source = `${e.location} ${e.problem} ${e.correction} ${e.evidence}`.replace(/−/g, '-').replace(/,/g, '')
      const body = `${m.gist} ${m.spec ?? ''} ${m.fix}`.replace(/\{,\}/g, '')
      const nums = new Set<string>([...(body.match(/(?<![\w.{^_])\d+\.\d+/g) ?? []), ...(body.match(/(?<![\w.{^_\\])\d{3,}(?![\w.}])/g) ?? [])])
      for (const n of nums) {
        if (rounded[eid]?.includes(n)) continue
        expect(source.includes(n), `${eid}：errataMath 的「${n}」不在原文中`).toBe(true)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(60)
    // 補充（addendum）裡的數字同樣要出現在原文
    for (const [eid, m] of Object.entries(ERRATA_MATH)) {
      if (!m.addendum) continue
      const e = erratumById(eid)!
      const source = `${e.location} ${e.problem} ${e.correction} ${e.evidence}`.replace(/−/g, '-')
      for (const n of m.addendum.match(/(?<![\w.{^_])\d+\.\d+/g) ?? []) expect(source.includes(n), `${eid}：addendum 的「${n}」不在原文中`).toBe(true)
    }
    // 例外清單本身也要站得住腳：四捨五入後與原文的數字一致
    expect((0.00797885).toFixed(5)).toBe('0.00798')
    expect((20289.0 / 1000).toFixed(3)).toBe('20.289')
  })

  it('驗收表、反面測試與 mutant 說明文字裡引用的數字，與 golden／即時計算一致（不是手寫的假數字）', () => {
    const st = computeAcceptanceState()
    const row = (id: string) => ACCEPTANCE_ROWS.find((x) => x.id === id)!
    const g = (id: keyof typeof GOLDEN, key: string) => GOLDEN[id].expected[key] as number
    const gl = (id: keyof typeof GOLDEN, key: string, i: number) => (GOLDEN[id].expected[key] as number[])[i]
    // T05：N = 42500 的三種機率、兩個精確門檻
    expect(row('T05').correctedNote).toContain(gl('T05', 'p_clt_list', 3).toFixed(6))
    expect(row('T05').correctedNote).toContain(gl('T05', 'p_exact_split_list', 3).toFixed(6))
    expect(row('T05').correctedNote).toContain(gl('T05', 'p_exact_strict_list', 3).toFixed(6))
    expect(row('T05').correctedTex).toContain(String(g('T05', 'N_exact_odd_95')))
    expect(row('T05').correctedTex).toContain(String(g('T05', 'N_exact_even_strict_95')))
    // T09：完整上界 1、簡化上界 2
    expect(g('T09', 'mu_max_full')).toBeCloseTo(1, 12)
    expect(g('T09', 'mu_max_simplified')).toBeCloseTo(2, 12)
    // T14：12.931 / 20.289 / 12.40 kHz
    expect(row('T14').correctedTex).toContain((g('T14', 'bw_exact_3db_hz') / 1e3).toFixed(3))
    expect(row('T14').correctedTex).toContain((g('T14', 'enbw_one_sided_hz') / 1e3).toFixed(3))
    expect(row('T14').correctedNote).toContain((g('T14', 'bw_one_minus_p_hz') / 1e3).toFixed(2))
    // T03 / T12 的修正值來自第二條獨立路徑
    expect(row('T03').correctedTex).toContain('2.4212')
    expect(st.byId.T03.comp!.checks.some((c) => c.label.includes('2.421249521') && c.pass)).toBe(true)
    expect(row('T12').correctedTex).toContain('1.340346')
    expect(st.byId.T12.comp!.checks.some((c) => c.label.includes('1.340346') && c.pass)).toBe(true)
    // T11：物理 K_q 的慢 pole
    expect(row('T11').correctedTex).toContain('0.99996011')
    expect(st.byId.T11.comp!.checks.some((c) => c.label.includes('0.99996011') && c.pass)).toBe(true)
    // 反面測試的說明
    const neg = (id: string) => NEGATIVE_TESTS.find((x) => x.id === id)!.failure
    expect(neg('neg-scaling')).toContain(g('T13', 'g_sum_mode').toFixed(1))
    expect(neg('neg-scaling')).toContain(g('T13', 'pole_sum_mode').toFixed(1))
    expect(neg('neg-bit')).toContain(g('T04', 'wrong_encoding_fixed_point_shift_fs').toFixed(2))
    expect(neg('neg-overflow')).toContain(String(GOLDEN_NEGATIVE.expected.gmac_bits_required))
    expect(neg('neg-overflow')).toContain(String(GOLDEN_NEGATIVE.expected.gmac_17bit_wrapped_sum))
    // mutant 的「lesson」：mutant 的值與 golden 的值
    const mv = (id: string) => st.mutants.find((x) => x.id === id)!
    const lesson = (id: string) => MUTANT_TEXT[id].lesson
    expect(lesson('pm-missing-half')).toContain(ratioTex(mv('pm-missing-half').diff!.worstRatio))
    expect(lesson('sigma-w-one-minus-p')).toContain((mv('sigma-w-one-minus-p').value as number).toFixed(3))
    expect(lesson('sigma-w-one-minus-p')).toContain(g('T13', 'sigma_w_fs').toFixed(3))
    expect(lesson('bw-one-minus-p')).toContain(((mv('bw-one-minus-p').value as number) / 1e3).toFixed(2))
    expect(lesson('bw-one-minus-p')).toContain((g('T14', 'bw_exact_3db_hz') / 1e3).toFixed(2))
    expect(lesson('enbw-as-f3db')).toContain(((mv('enbw-as-f3db').value as number) / 1e3).toFixed(2))
    expect(lesson('enbw-as-f3db')).toContain((g('T14', 'enbw_one_sided_hz') / 1e3).toFixed(2))
    expect(lesson('enbw-as-f3db')).toContain(`${Math.round((1 - (mv('enbw-as-f3db').value as number) / g('T14', 'enbw_one_sided_hz')) * 100)}\\%`)
    expect(lesson('strict-tie-as-table')).toContain(((mv('strict-tie-as-table').value as number) * 100).toFixed(1))
    expect(lesson('strict-tie-as-table')).toContain((gl('T05', 'p_clt_list', 0) * 100).toFixed(1))
    expect(lesson('kq-forgotten')).toContain((mv('kq-forgotten').value as number).toFixed(5))
    expect(lesson('sign-vs-mse')).toContain(String(Number((mv('sign-vs-mse').value as number).toFixed(6))))
    expect(lesson('sum-mode-mu')).toContain((mv('sum-mode-mu').value as number).toFixed(1))
    expect(lesson('sum-mode-mu')).toContain(g('T13', 'g').toFixed(4))
    const eigWrong = (mv('a-minus-mj').value as number[]).map((v) => Number(v.toFixed(6)))
    expect(lesson('a-minus-mj')).toContain(`${eigWrong[0]}/${eigWrong[1]}`)
    expect(lesson('a-minus-mj')).toContain(`${Number(gl('T18', 'eig_A_desc', 0).toFixed(6))}/${Number(gl('T18', 'eig_A_desc', 1).toFixed(6))}`)
  })

  it('parseRefuted：從 docs/validation.md 解析出 9 項被反駁的意見（範圍含括號也能正確切開）', () => {
    const items = parseRefuted(read('docs/validation.md'))
    expect(items).toHaveLength(9)
    expect(items[0]).toMatchObject({ id: 'partA-07', area: 'Part A（§1–3）' })
    expect(items[1]).toMatchObject({ id: 'comparator-T05-tie-tolerance', area: '§5 Comparator' })
    for (const it of items) {
      expect(it.location.length, it.id).toBeGreaterThan(5)
      expect(it.reason.length, it.id).toBeGreaterThan(20)
      expect(it.location).not.toContain('反駁理由')
    }
    expect(parseRefuted('# 沒有這一節')).toEqual([])
    // 「方法」一節的兩個數字：勘誤瀏覽器直接解析原文；頁首（首屏）用固定在 errata.ts 的 VALIDATION_STATS——文件改了這裡就會失敗，請同步更新常數
    expect(parseValidationStats(read('docs/validation.md'))).toEqual({ auditors: 9, claims: 237 })
    expect(VALIDATION_STATS).toEqual(parseValidationStats(read('docs/validation.md')))
    expect(parseValidationStats('沒有數字')).toEqual({ auditors: null, claims: null })
    expect(parseRefuted('## 已反駁\n\n- 格式不符的一行\n- `x`（A）：loc — 反駁理由：why\n## 下一節\n- `y`（B）：l — 反駁理由：r')).toEqual([{ id: 'x', area: 'A', location: 'loc', reason: 'why' }])
  })

  it('勘誤內文提到的 T-id、章節標籤與 HashRouter 相容的連結', () => {
    expect(mentionedTests(erratumById('E01')!)).toContain('T12')
    expect(mentionedTests(erratumById('E06')!)).toContain('T14')
    expect(chapterLabel('ch05')).toBe('Ch05')
    expect(chapterLabel('all')).toBe('全文')
    expect(chapterHref('ch11')).toBe('#/ch/11')
    expect(chapterHref('all')).toBeNull()
    expect(erratumHref('E05')).toBe('#/verification?e=E05')
    expect(distinctChapters(ERRATA).at(-1)).toBe('all')
  })
})

describe('verification：格式化與精確差', () => {
  it('fmtNum / fmtNumeric / fmtTol / pick / texNum', () => {
    expect(fmtNum(0.00797884560802865, 6)).toBe('0.00797885')
    expect(fmtNum(6.334248e-5, 4)).toBe('6.334e-5')
    expect(fmtNum(-0)).toBe('0')
    expect(fmtNum(42499)).toBe('42499')
    // 整數位數比有效位數多時不可漏出 toPrecision 的 'e+5'（曾把 n ≈ 2.51×10⁵ 顯示成「2.51e+5」）
    expect(fmtNum(251300.4, 3)).toBe('251000')
    expect(fmtNum(-1234.5, 2)).toBe('-1200')
    expect(fmtNum(20289.018, 7)).toBe('20289.02')
    expect(texNum(251300.4, 3)).toBe('251000')
    for (const v of [251300.4, 1234.5, 99999.9, 0.000123456, 5.5e-7, 3.2e9, 12345678]) {
      for (const d of [2, 3, 4, 6]) {
        expect(fmtNum(v, d), `${v}/${d}`).not.toMatch(/e\+/)
        expect(texNum(v, d), `${v}/${d}`).not.toMatch(/\de[+-]?\d/) // TeX 版一律 a\times10^{b}
        texOk(texNum(v, d), `texNum(${v}, ${d})`)
      }
    }
    expect(fmtNumeric([1, [2, 3]], 3)).toBe('[1, [2, 3]]')
    expect(fmtTol({ abs: 1e-12 })).toBe('abs 1e-12')
    expect(fmtTol({ abs: 0 })).toBe('完全相等')
    expect(fmtTol({ rel: 1e-10 })).toBe('rel 1e-10')
    expect(pick([1, 2, 3], 1)).toBe(2)
    expect(pick(5)).toBe(5)
    expect(texNum(6.334e-5, 4)).toBe('6.334\\times10^{-5}')
    expect(texNum(1e-12, 2)).toBe('10^{-12}')
    expect(texNum(-1e-9, 2)).toBe('-10^{-9}')
    expect(texNum(1e6, 3)).toBe('10^{6}') // 共用 texNum：|x| ≥ 1e6 一律用指數
    expect(texNum(999999, 3)).toBe('999999') // 低於門檻的整數（樣本數）原樣顯示，不捨入
    expect(texNum(230400, 3)).toBe('230400')
    expect(texNum(999999.5, 3)).toBe('1000000') // 非整數照共用規則捨入：有效位數 3 位也不漏出 e+
    expect(texNum(Infinity)).toBe('\\infty')
    expect(texNum(Number.NaN)).toBe('\\text{NaN}')
    expect(tolTex({ abs: 1e-12 })).toBe('\\varepsilon_{\\rm abs}=10^{-12}')
    expect(tolTex({ abs: 1e-9, rel: 1e-10 })).toBe('\\varepsilon_{\\rm abs}=10^{-9},\\ \\varepsilon_{\\rm rel}=10^{-10}')
    expect(tolTex({ abs: 0 })).toBe('a_k=e_k')
    expect(ratioTex(0)).toBe('0')
    expect(ratioTex(Infinity)).toBe('\\infty')
    expect(ratioTex(null)).toBe('\\text{—}')
    expect(ratioTex(6e10)).toBe('6\\times10^{10}')
    for (const t of [texNum(3.2e-7), tolTex({ abs: 1e-9, rel: 1e-10 }), ratioTex(6e10), ratioTex(null)]) texOk(t, 'format')
    expect(texToPlain('PM 漏掉 $/2$')).toBe('PM 漏掉 /2')
    expect(texToPlain(String.raw`$\sigma_w$ 分母少了 $(1+p)$`)).toBe('σ_w 分母少了 (1+p)')
    expect(texToPlain(String.raw`$\delta=w-a$（規格 §3 的極性）`)).toBe('δ=w-a（規格 §3 的極性）')
    expect(texToPlain(String.raw`$H_{\rm PD}(1)=0$、$K_q\equiv1$、$\tfrac23<\mu<2.42$、$\hat{\mathbf J}=\mathbf J$、$\omega_nT_s\ll1$`)).toBe('H_PD(1)=0、K_q≡1、2/3<μ<2.42、Ĵ=J、ω_nT_s≪1')
    expect(texToPlain(String.raw`$\left[\frac{a}{b}\right]$ 與 $x\le1$、$\mathrm{SE}\propto1/\sqrt n$、$\|\boldsymbol\delta_{300}\|$`)).toBe('[(a)/(b)] 與 x≤1、SE∝1/√n、‖δ_300‖')
  })

  it('texToPlain 能把本頁所有要當純文字用的標籤（MC 檢查、mutant 標題、勘誤摘要）轉乾淨：沒有殘留的反斜線、$ 或 TeX 指令名', () => {
    const all = [...MC_PLAN.flatMap((c) => [c.label, c.quantity]), ...Object.values(MUTANT_TEXT).map((t) => t.title), ...Object.values(ERRATA_MATH).map((m) => m.gist)]
    expect(all.length).toBeGreaterThan(80)
    for (const text of all) {
      const plain = texToPlain(text)
      expect(plain, text).not.toMatch(/[$\\]/)
      expect(plain, text).not.toMatch(/mathbf|mathrm|mathcal|boldsymbol|tfrac|equiv|varepsilon|operatorname|\bhat\b|\brm\b/)
    }
  })

  it('decomposeDouble 精確；exactDiffToFraction：2.2800000000000002 − 57/25 與 1.8 − 9/5', () => {
    const { m, e } = decomposeDouble(1.5)
    expect(Number(m) * 2 ** e).toBe(1.5)
    expect(exactDiffToFraction(1, 1n, 1n)).toBe(0)
    const d2 = exactDiffToFraction(2.2800000000000002, 57n, 25n)
    expect(d2).toBeGreaterThan(1e-16)
    expect(d2).toBeLessThan(5e-16)
    expect(exactDiffToFraction(1.8, 9n, 5n)).toBeLessThan(1.2e-16)
    expect(exactDiffToFraction(3, 6n, 2n)).toBe(0)
  })

  it('extractPythonDefs 從 golden 的 noise.py 切出實際的函式（含 docstring），找不到時丟錯', () => {
    const py = read('golden/lms_pll_golden/noise.py')
    const out = extractPythonDefs(py, ['cal_noise_example', 'sigma_w2_closed'])
    expect(out.startsWith('def cal_noise_example(')).toBe(true)
    expect(out).toContain('def sigma_w2_closed(')
    expect(out).toContain('return mu * mu * sigma_eta2 / (1.0 - p * p)')
    expect(out).not.toContain('def coef_noise_tf')
    expect(() => extractPythonDefs(py, ['no_such_fn'])).toThrow(/找不到/)
  })
})

describe('verification：scripts/verify.mjs 的狀態判定（頁面顯示的是實際檔案內容）', () => {
  it('extractJsFunctions 切出 statusOf / tsIds / pyIds（含 JSDoc）；切出的 statusOf 以四種輸入執行，只有兩邊都通過且無失敗才是 pass', () => {
    const src = read('scripts/verify.mjs')
    const code = extractJsFunctions(src, ['statusOf', 'tsIds', 'pyIds'])
    expect(code.startsWith('function statusOf(ts, py) {')).toBe(true)
    expect(code).toContain('/** TS：title 開頭的')
    expect(code).toContain('function pyIds(name) {')
    expect(code).not.toContain('function gitCommit')
    expect(() => extractJsFunctions(src, ['noSuchFn'])).toThrow(/找不到/)
    // 兩條 T-id 擷取規則的 regex 也原樣切出（頁面上和使用它們的函式一起顯示）
    const consts = extractJsConstLines(src, ['TS_PREFIX', 'PY_PREFIX'])
    expect(consts.split('\n')).toHaveLength(2)
    expect(consts).toMatch(/^const TS_PREFIX = \//)
    expect(consts).toContain('const PY_PREFIX = /^test_(T\\d{2})')
    expect(() => extractJsConstLines(src, ['NO_SUCH_CONST'])).toThrow(/找不到/)
    // 規則本身：title 以「T03/T04:」開頭算兩個 T-id；describe 名稱或句中的 T-id 不算；test_NEG_ 不算
    const tsIds = new Function(`${consts}\n${extractJsFunctions(src, ['tsIds', 'pyIds'])}; return { tsIds, pyIds }`)() as { tsIds: (t: string) => string[]; pyIds: (n: string) => string[] }
    expect(tsIds.tsIds('T03/T04: 單步 MC')).toEqual(['T03', 'T04'])
    expect(tsIds.tsIds('反面測試（見 T05）')).toEqual([])
    expect(tsIds.pyIds('test_T05_tie_rules')).toEqual(['T05'])
    expect(tsIds.pyIds('test_NEG_aliasing_low_sample_rate')).toEqual([])
    // 真的執行這段原始碼（不是另外重寫的版本）
    const statusOf = new Function(`${extractJsFunctions(src, ['statusOf'])}; return statusOf`)() as (ts: { passed: number; failed: number }, py: { passed: number; failed: number }) => string
    const side = (passed: number, failed = 0) => ({ passed, failed })
    expect(statusOf(side(2), side(3))).toBe('pass')
    expect(statusOf(side(0), side(3))).toBe('partial')
    expect(statusOf(side(2), side(0))).toBe('partial')
    expect(statusOf(side(0), side(0))).toBe('missing')
    expect(statusOf(side(5, 1), side(3))).toBe('fail')
    expect(statusOf(side(5), side(3, 1))).toBe('fail')
  })
})

describe('verification：頁面狀態（與 acceptance.ts 同一套計算）', () => {
  it('computeAcceptanceState：18/18 列通過、所有 golden key 一致、獨立路徑一致、negative_tests 一致、mutant 判定如預期', () => {
    const st = computeAcceptanceState()
    expect(st.rowsPassed).toBe(18)
    expect(st.keysFailed).toBe(0)
    expect(st.keysMissing).toBe(0)
    expect(st.keysPassed).toBe(st.keysTotal)
    expect(st.checksPassed).toBe(st.checksTotal)
    expect(st.negative.status).toBe('pass')
    expect(st.negativeError).toBeNull()
    expect(st.mutants.every((m) => m.error === undefined)).toBe(true)
    expect(st.mutants.every((m) => m.asExpected)).toBe(true)
    expect(st.byId.T05.cmp?.status).toBe('pass')
    // 勘誤的即時證據：全部一致，且每個標註的勘誤都能反查到驗收表的比對
    expect(st.evidenceError).toBeNull()
    expect(st.evidence.length).toBeGreaterThan(100)
    expect(st.evidencePassed).toBe(st.evidence.length)
    expect(Object.keys(st.evidenceByEid).length).toBeGreaterThanOrEqual(30)
    expect(st.checksByEid.E02.map((c) => c.tid)).toContain('T05')
    expect(st.checksByEid.E01.every((c) => c.tid === 'T12' && c.check.pass)).toBe(true)
  })

  it('篩選「只看有即時重算證據」：hasLive 省略時不篩；提供時只留下有證據的勘誤', () => {
    const rel = () => [] as string[]
    const f = { ...DEFAULT_FILTER, onlyLive: true }
    expect(filterErrata(ERRATA, f, rel)).toHaveLength(49)
    const live = filterErrata(ERRATA, f, rel, (eid) => eid === 'E02' || eid === 'E14')
    expect(live.map((e) => e.eid)).toEqual(['E02', 'E14'])
  })
})
