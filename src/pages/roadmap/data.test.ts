import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import katex from 'katex'
import errataFile from '@/data/errata.json'
import { pageById } from '@/app/registry'
import {
  ALL_T_IDS,
  CONDITIONS,
  DOCS,
  DOD,
  ITEMS,
  itemStatus,
  PHASES,
  phaseProgress,
  statusCounts,
  subgoalCounts,
  VALIDATION_DOC,
  type ItemStatus,
  type SubStatus,
} from './data'
import { CONDITIONS_TEX, FORMULAS } from './formulas'
import { mergeParams, splitMath } from './common'
import { ROADMAP_SYMBOLS } from './symbols'
import { errataSummary, roadmapErrata } from './sections/Docs'

const ERRATA_IDS = new Set((errataFile as { errata: { eid: string }[] }).errata.map((e) => e.eid))
const ITEM_STATUSES: ItemStatus[] = ['partial', 'pending', 'not-started', 'in-analysis']
const SUB_STATUSES: SubStatus[] = ['on-site', 'preview', 'pending', 'not-started', 'in-analysis']

function renders(tex: string): void {
  expect(() => katex.renderToString(tex, { throwOnError: true, displayMode: true, strict: 'ignore' })).not.toThrow()
}

function allMathIn(text: string): string[] {
  return splitMath(text)
    .filter((p) => p.math)
    .map((p) => p.s)
}

describe('Roadmap 資料：誠實與完整', () => {
  it('包含 R1–R10 與 SSPLL 案例，id 不重複', () => {
    const ids = ITEMS.map((i) => i.id)
    expect(ids).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'SSPLL'])
  })

  it('反面：沒有任何研究項目或子目標是 verified / done（只允許 partial / pending / not started / in analysis）', () => {
    for (const it of ITEMS) {
      expect(ITEM_STATUSES).toContain(itemStatus(it))
      for (const s of it.subgoals) expect(SUB_STATUSES).toContain(s.status)
      // 每個題目都至少還有一個未完成的子目標
      expect(it.subgoals.some((s) => s.status === 'pending' || s.status === 'not-started' || s.status === 'in-analysis')).toBe(true)
      const blob = JSON.stringify(it).toLowerCase()
      expect(blob).not.toMatch(/\bverified\b/)
      expect(blob).not.toMatch(/已驗證/)
    }
  })

  it('SSPLL 案例：狀態為 in analysis，連到 #/case/sspll', () => {
    const ss = ITEMS.find((i) => i.id === 'SSPLL')!
    expect(itemStatus(ss)).toBe('in-analysis')
    expect(ss.link?.href).toBe('#/case/sspll')
    expect(ss.title).toMatch(/8 相 PMUX/)
    expect(ss.title).toMatch(/Type-I/)
    expect(ss.title).toMatch(/CPPLL/)
    // 使用者的架構：4 GHz reference、320 MHz 頻寬、GOS = DTC gain、PHOS = PMUX 相位 offset
    expect(ss.goal).toMatch(/4\$ GHz/)
    expect(ss.goal).toMatch(/320 MHz/)
    expect(ss.goal).toMatch(/GOS（DTC 的 gain error/)
    expect(ss.goal).toMatch(/PHOS（8 個 PMUX 相位/)
    expect(ss.covered.some((c) => c.page === 'case-sspll')).toBe(true)
    // 仍在分析中的子目標（含「沒有證明」的研究假說）必須明講
    expect(ss.subgoals.filter((s) => s.status === 'in-analysis').length).toBeGreaterThanOrEqual(2)
    expect(ss.subgoals.some((s) => /沒有證明/.test(s.text))).toBe(true)
    expect(ss.subgoals.some((s) => s.status === 'not-started')).toBe(true)
  })

  it('狀態彙整：partial / pending / not started / in analysis 的總數 = 項目數', () => {
    const c = statusCounts()
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(ITEMS.length)
    const s = subgoalCounts()
    expect(Object.values(s).reduce((a, b) => a + b, 0)).toBe(ITEMS.reduce((a, i) => a + i.subgoals.length, 0))
    expect(s['not-started']).toBeGreaterThan(0)
    expect(s.pending).toBeGreaterThan(0)
  })

  it('所有連結頁面都存在於 registry；勘誤 id 都存在；T-id 合法；條件 id 合法', () => {
    for (const it of ITEMS) {
      for (const c of it.covered) expect(pageById(c.page), `${it.id} → ${c.page}`).toBeTruthy()
      for (const e of it.errata) expect(ERRATA_IDS.has(e), `${it.id} → ${e}`).toBe(true)
      for (const t of it.tests) expect(ALL_T_IDS).toContain(t)
      for (const cd of it.conditions) expect(CONDITIONS.map((c) => c.id)).toContain(cd)
    }
    for (const ph of PHASES) {
      for (const p of ph.pages) expect(pageById(p), `${ph.id} → ${p}`).toBeTruthy()
      for (const e of ph.errata) expect(ERRATA_IDS.has(e)).toBe(true)
      for (const t of ph.tests) expect(ALL_T_IDS).toContain(t)
    }
    for (const d of DOD) for (const p of d.where ?? []) expect(pageById(p)).toBeTruthy()
    for (const d of DOCS) if (d.page) expect(pageById(d.page)).toBeTruthy()
    expect(roadmapErrata().every((e) => ERRATA_IDS.has(e))).toBe(true)
  })

  it('所有 $…$ 與 TeX 字串都能被 KaTeX 解析（數學一律 LaTeX）', () => {
    for (const it of ITEMS) {
      for (const m of it.math) {
        renders(m.tex)
        allMathIn(m.label).forEach(renders)
      }
      for (const t of [it.goal, it.why, ...it.covered.map((c) => c.what), ...it.subgoals.map((s) => s.text)]) allMathIn(t).forEach(renders)
    }
    for (const c of CONDITIONS) allMathIn(c.question).forEach(renders)
    for (const ph of PHASES) for (const t of [...ph.deliverables, ...ph.acceptance, ...ph.risks]) allMathIn(t).forEach(renders)
    for (const f of FORMULAS) renders(f.tex)
    for (const s of ROADMAP_SYMBOLS) renders(s.symbol)
    for (const it of ITEMS) allMathIn(it.preview).forEach(renders)
    for (const d of DOCS) allMathIn(d.purpose).forEach(renders)
  })

  it('反面：資料字串中的數學都包在 $…$ 內（不以 Unicode 希臘字母、上下標拼湊公式）', () => {
    const unicodeMath = /[α-ωϕϑ√∫∑‖ℐĴĤ⁰¹²³⁴-⁹⁺⁻₀-₉₊₋ᵀ≈≤≥≪≫⇒⇔∈]/
    const outside = (t: string) =>
      splitMath(t)
        .filter((p) => !p.math)
        .map((p) => p.s)
        .join(' ')
    const texts: string[] = []
    for (const it of ITEMS) texts.push(it.title, it.goal, it.why, it.preview, ...it.math.map((m) => m.label), ...it.covered.map((c) => c.what), ...it.subgoals.map((s) => s.text))
    for (const c of CONDITIONS) texts.push(c.label, c.question)
    for (const ph of PHASES) texts.push(ph.title, ...ph.deliverables, ...ph.acceptance, ...ph.risks)
    for (const d of DOD) texts.push(d.text)
    for (const d of DOCS) texts.push(d.title, d.purpose)
    texts.push(...Object.values(CONDITIONS_TEX))
    for (const t of texts) expect(outside(t), t).not.toMatch(unicodeMath)
  })

  it('反面：mergeParams 只接受同型別、有限的欄位（壞 preset 不會弄壞狀態）', () => {
    const prev = { mu: 10, kind: 'gaussian', on: false }
    expect(mergeParams(prev, { mu: 3, kind: 'laplace', on: true })).toEqual({ mu: 3, kind: 'laplace', on: true })
    expect(mergeParams(prev, { mu: 'x', kind: 4, on: 'yes', extra: 1 })).toEqual(prev)
    expect(mergeParams(prev, { mu: Number.NaN })).toEqual(prev)
    expect(mergeParams(prev, { mu: Number.POSITIVE_INFINITY })).toEqual(prev)
  })

  it('splitMath：文字與 $…$ 交錯', () => {
    expect(splitMath('a $x^2$ b $y$')).toEqual([
      { math: false, s: 'a ' },
      { math: true, s: 'x^2' },
      { math: false, s: ' b ' },
      { math: true, s: 'y' },
    ])
    expect(splitMath('沒有數學')).toEqual([{ math: false, s: '沒有數學' }])
  })

  it('公式登錄：ID 唯一、格式 F-R<n>.<m> / F-SS.<m>、頁面 /roadmap', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of FORMULAS) {
      expect(f.id).toMatch(/^F-(R\d+|SS)\.\d+$/)
      expect(f.page).toBe('/roadmap')
      if (f.erratumId) expect(ERRATA_IDS.has(f.erratumId)).toBe(true)
    }
  })

  it('每個公式都有 LaTeX 版的使用條件（本頁顯示用），而且 KaTeX 可解析', () => {
    expect(Object.keys(CONDITIONS_TEX).sort()).toEqual(FORMULAS.map((f) => f.id).sort())
    for (const f of FORMULAS) {
      const tex = allMathIn(CONDITIONS_TEX[f.id])
      expect(tex.length, f.id).toBeGreaterThan(0)
      tex.forEach(renders)
    }
  })
})

describe('P0–P5：驗收進度只由 verification-status 計算', () => {
  const fake = (status: string) => ({ tests: Object.fromEntries(ALL_T_IDS.map((t) => [t, { status, ts: {}, py: {} }])) })

  it('全部 pass → tests-pass；混合 → partial；全無結果 → pending；無 T-id → manual', () => {
    const p1 = PHASES.find((p) => p.id === 'P1')!
    expect(phaseProgress(p1, fake('pass')).state).toBe('tests-pass')
    expect(phaseProgress(p1, fake('partial')).state).toBe('partial')
    expect(phaseProgress(p1, fake('missing')).state).toBe('pending')
    expect(phaseProgress(p1, { tests: {} }).state).toBe('pending')
    const mixed = fake('missing') as { tests: Record<string, unknown> }
    mixed.tests.T01 = { status: 'pass' }
    expect(phaseProgress(p1, mixed).state).toBe('partial')
    expect(phaseProgress(PHASES.find((p) => p.id === 'P0')!, fake('pass')).state).toBe('manual')
  })

  it('反面：fail 或格式錯誤不會被算成 pass', () => {
    const p4 = PHASES.find((p) => p.id === 'P4')!
    expect(phaseProgress(p4, fake('fail')).counts.pass).toBe(0)
    expect(phaseProgress(p4, { tests: { T13: { status: 'verified' } } }).counts.pass).toBe(0)
    expect(phaseProgress(p4, null).state).toBe('pending')
  })

  it('P1–P4 的驗收 T-id 與 docs/implementation_plan.md 一致；T01–T18 恰好各出現一次', () => {
    const plan = readFileSync(join(process.cwd(), 'docs', 'implementation_plan.md'), 'utf8')
    expect(plan).toMatch(/T01–T05 通過/)
    expect(plan).toMatch(/T06–T09 通過/)
    expect(plan).toMatch(/T10–T12、T18 通過/)
    expect(plan).toMatch(/T13–T17 通過/)
    for (const id of ['P0', 'P1', 'P2', 'P3', 'P4', 'P5']) expect(plan).toContain(`| ${id} `)
    const all = PHASES.flatMap((p) => p.tests).sort()
    expect(all).toEqual(ALL_T_IDS)
  })
})

describe('文件與勘誤統計：與原始文件一致', () => {
  it('errata.json 的筆數 = validation.md 的勘誤數，並與 237 項檢查、9 項反駁的描述一致', () => {
    const doc = readFileSync(join(process.cwd(), 'docs', 'validation.md'), 'utf8')
    const s = errataSummary()
    const headings = doc.match(/^### E\d\d｜/gm) ?? []
    expect(headings.length).toBe(s.total)
    expect(doc).toContain(`確認 **${s.total}** 項勘誤（high ${s.bySeverity.high}、medium ${s.bySeverity.medium}、low ${s.bySeverity.low}）`)
    expect(doc).toContain(`共 **${VALIDATION_DOC.checks}** 項`)
    expect(doc).toContain(`${VALIDATION_DOC.refuted} 項被反駁`)
  })

  it('列出的文件都存在於專案中（含 SSPLL 的離線分析文件）', () => {
    for (const d of DOCS) expect(existsSync(join(process.cwd(), d.path)), d.path).toBe(true)
    expect(DOCS.some((d) => d.path === 'docs/analysis/sspll-gos-phos-polarity.md' && d.page === 'case-sspll')).toBe(true)
  })

  it('規格附錄 C 的 R1–R10 標題都在主規格中', () => {
    const spec = readFileSync(join(process.cwd(), 'docs', 'LMS_PLL_Calibration_Website_Blueprint_ZH_TW.md'), 'utf8')
    for (let i = 1; i <= 10; i++) expect(spec).toContain(`## R${i}｜`)
  })
})
