import { ALL_CASES } from './data'
import {
  JSON_SCHEMA_ID,
  buildJson,
  buildMarkdown,
  emptyReview,
  getItem,
  isReviewState,
  mdCell,
  needsNote,
  parseReviewJson,
  setItem,
  setMeta,
  summarize,
  type ReviewState,
} from './review'

const NOW = new Date('2026-10-10T08:00:00.000Z')
const INFO = { now: NOW, appVersion: '0.1.0', gitCommit: 'abc1234' }
const allIds = ALL_CASES.flatMap((c) => c.checks.map((k) => k.id))

function closeAll(state: ReviewState, status: 'pass' | 'waived' = 'pass'): ReviewState {
  return allIds.reduce((s, id) => setItem(s, id, { status, note: status === 'waived' ? '依據 X' : '' }, NOW), state)
}

describe('review 狀態模型', () => {
  it('空白 review：全部未開始、判定為進行中', () => {
    const s = emptyReview()
    const sum = summarize(ALL_CASES, s)
    expect(sum.total).toBe(allIds.length)
    expect(sum.counts['not-started']).toBe(allIds.length)
    expect(sum.verdict).toBe('open')
    expect(getItem(s, 'basic-perturb')).toEqual({ status: 'not-started', note: '' })
  })

  it('setItem 不改動原物件（immutable），並記錄時間', () => {
    const s0 = emptyReview()
    const s1 = setItem(s0, 'basic-perturb', { status: 'pass' }, NOW)
    expect(s0.items['basic-perturb']).toBeUndefined()
    expect(s1.items['basic-perturb']).toEqual({ status: 'pass', note: '', updatedAt: NOW.toISOString() })
    const s2 = setItem(s1, 'basic-perturb', { note: 'M = 16、z = 3' }, NOW)
    expect(s2.items['basic-perturb'].status).toBe('pass')
    expect(setMeta(s2, { project: 'PLL-A' }).meta.project).toBe('PLL-A')
  })

  it('判定順序：有 fail ⇒ blocked；fail／waived 缺理由 ⇒ incomplete；全部關閉 ⇒ ready', () => {
    let s = closeAll(emptyReview())
    expect(summarize(ALL_CASES, s).verdict).toBe('ready')
    s = setItem(s, 'nl-overflow', { status: 'waived', note: '' }, NOW)
    expect(needsNote(getItem(s, 'nl-overflow'))).toBe(true)
    expect(summarize(ALL_CASES, s).verdict).toBe('incomplete')
    s = setItem(s, 'basic-bitmap', { status: 'fail', note: 'JIRA-12' }, NOW)
    const sum = summarize(ALL_CASES, s)
    expect(sum.verdict).toBe('blocked')
    expect(sum.counts.fail).toBe(1)
    expect(sum.missingNotes).toEqual(['nl-overflow'])
  })

  it('型別守衛拒絕舊版或被竄改的資料', () => {
    expect(isReviewState(emptyReview())).toBe(true)
    expect(isReviewState(null)).toBe(false)
    expect(isReviewState({ version: 2, meta: {}, items: {} })).toBe(false)
    expect(isReviewState({ ...emptyReview(), items: { x: { status: 'done', note: '' } } })).toBe(false)
    expect(isReviewState({ ...emptyReview(), meta: { project: 1, reviewer: '', revision: '', scope: '' } })).toBe(false)
  })
})

describe('匯出 Markdown／JSON 與匯入', () => {
  it('Markdown：表頭、每個 case 一節、狀態符號、缺理由標記、管線字元跳脫', () => {
    let s = setMeta(emptyReview(), { project: 'SSPLL-28', reviewer: 'Matt' })
    s = setItem(s, 'basic-perturb', { status: 'pass', note: 'K̂ = 0.0078 | z = 40\n第二行' }, NOW)
    s = setItem(s, 'sspll-phos', { status: 'fail', note: '' }, NOW)
    const md = buildMarkdown(ALL_CASES, s, INFO)
    expect(md).toContain('# LMS × Fractional-N PLL Calibration — Sign-off Review')
    expect(md).toContain('- 設計／專案：SSPLL-28')
    expect(md).toContain('- 匯出時間：2026-10-10T08:00:00.000Z')
    for (const c of ALL_CASES) expect(md).toContain(`## ${c.no}. ${c.title}`)
    expect(md).toContain('K̂ = 0.0078 \\| z = 40<br>第二行')
    expect(md).toContain('未通過（缺理由）')
    expect(md).toContain('**判定：不可 sign-off')
    expect(md).toMatch(/\| \[x\] \| Freeze \+ \$\\pm\\Delta w\$ 斜率/)
    expect(mdCell('a|b\nc')).toBe('a\\|b<br>c')
  })

  it('JSON 匯出 → 匯入 round trip 保留狀態、備註、時間與 meta', () => {
    let s = setMeta(emptyReview(), { project: 'P', reviewer: 'R', revision: 'r1', scope: 'TT/SS/FF' })
    s = setItem(s, 'corner-K', { status: 'in-progress', note: 'SS 尚未量' }, NOW)
    s = setItem(s, 'neg-overflow', { status: 'waived', note: '18-bit 已確認' }, NOW)
    const json = buildJson(ALL_CASES, s, INFO)
    expect(json.schema).toBe(JSON_SCHEMA_ID)
    expect(json.cases.map((c) => c.id)).toEqual(ALL_CASES.map((c) => c.id))
    const back = parseReviewJson(JSON.stringify(json), ALL_CASES)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.imported).toBe(allIds.length)
    expect(back.ignored).toEqual([])
    expect(back.state.meta).toEqual(s.meta)
    expect(back.state.items['corner-K']).toEqual(s.items['corner-K'])
    expect(back.state.items['neg-overflow']).toEqual(s.items['neg-overflow'])
    expect(isReviewState(back.state)).toBe(true)
  })

  it('匯入：拒絕非 JSON、錯誤 schema、不合法狀態；略過未知 id', () => {
    expect(parseReviewJson('{', ALL_CASES).ok).toBe(false)
    expect(parseReviewJson(JSON.stringify({ schema: 'other' }), ALL_CASES).ok).toBe(false)
    const bad = { schema: JSON_SCHEMA_ID, cases: [{ id: 'basic', checks: [{ id: 'basic-perturb', status: 'ok' }] }] }
    const r1 = parseReviewJson(JSON.stringify(bad), ALL_CASES)
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.error).toContain('status 不合法')
    const unknown = { schema: JSON_SCHEMA_ID, cases: [{ id: 'x', checks: [{ id: 'not-a-check', status: 'pass', note: '' }, { id: 'basic-perturb', status: 'pass', note: 'ok' }] }] }
    const r2 = parseReviewJson(JSON.stringify(unknown), ALL_CASES)
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.ignored).toEqual(['not-a-check'])
      expect(r2.imported).toBe(1)
    }
  })
})
