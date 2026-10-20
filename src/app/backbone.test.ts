// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { BEGINNER_CONTROLS } from './beginnerControls'
import {
  BACKBONE,
  BACKBONE_MAX_MINUTES,
  LAST_VISIT_KEY,
  backboneHref,
  backboneIndexOf,
  backboneProgress,
  backboneStepId,
  backboneTotalMinutes,
  formatMinutes,
  readLastVisit,
  readScrollAnchor,
  recordLastVisit,
  touchLastVisit,
  resumeTarget,
} from './backbone'
import { estimateReadingMinutes } from './chapterMeta'
import { PAGES, pageById } from './registry'

/** 某一頁的原始碼（index.tsx、sections/、experiments/…；不含測試） */
function pageSources(pageId: string): string {
  const dir = /^ch\d\d[a-z]?$/.test(pageId) ? join(process.cwd(), 'src/chapters', pageId) : join(process.cwd(), 'src/pages', pageId)
  const out: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(tsx?|ts)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(readFileSync(p, 'utf8'))
    }
  }
  walk(dir)
  return out.join('\n')
}

/** 錨點是否在該頁原始碼裡：`id="x"`、`'x'`；實驗框的 `exp-<id>` 看 `'<id>'` */
function anchorInSource(src: string, anchor: string): boolean {
  if (src.includes(`id="${anchor}"`) || src.includes(`'${anchor}'`)) return true
  const m = /^exp-(.+)$/.exec(anchor)
  return !!m && src.includes(`'${m[1]}'`)
}

describe('Beginner 骨幹路線（backbone.ts）', () => {
  it('每一步指向存在的頁面，順序沿著 registry（Ch00 → … → Ch14 → Sign-off）', () => {
    expect(BACKBONE.length).toBeGreaterThanOrEqual(8)
    expect(BACKBONE[0].page).toBe('ch00')
    expect(BACKBONE[BACKBONE.length - 1].page).toBe('signoff')
    let prev = -1
    for (const s of BACKBONE) {
      const i = PAGES.findIndex((p) => p.id === s.page)
      expect(i, s.page).toBeGreaterThanOrEqual(0)
      expect(i, `${s.page} 排在前一步之後`).toBeGreaterThanOrEqual(prev)
      prev = i
      expect(s.title.length).toBeGreaterThan(8)
      expect(s.sections.length).toBeGreaterThan(0)
    }
    // 同一頁的兩步：第二步一定有 anchor（否則 key 會撞成同一格）
    const ids = BACKBONE.map(backboneStepId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('anchor／until 都在該章原始碼裡；ch05 也用 until（各節都有 id）', () => {
    for (const s of BACKBONE) {
      const src = pageSources(s.page)
      if (s.anchor) expect(anchorInSource(src, s.anchor), `${s.page} anchor ${s.anchor}`).toBe(true)
      if (s.until) expect(anchorInSource(src, s.until), `${s.page} until ${s.until}`).toBe(true)
      // 範圍要說得清楚：每一步都有終點 until
      expect(!!s.until, `${s.page} ${s.sections} 的終點`).toBe(true)
      for (const e of s.experiments) {
        expect(src.includes(`'${e}'`), `${s.page} 的實驗 ${e}`).toBe(true)
        expect(BEGINNER_CONTROLS[e], `${e} 要在 beginnerControls.ts 有 Beginner 清單`).toBeDefined()
      }
    }
    expect(BACKBONE.find((s) => s.page === 'ch05')?.until).toBe('ch05-accumulate')
  })

  it('分鐘數 = estimateReadingMinutes(reading)，5 的倍數、合理範圍；總時間 ≤ 6 小時', () => {
    for (const s of BACKBONE) {
      expect(s.minutes, `${s.page} ${s.sections}`).toBe(estimateReadingMinutes(s.reading))
      expect(s.minutes % 5).toBe(0)
      expect(s.minutes).toBeGreaterThanOrEqual(5)
      expect(s.minutes, `${s.page} ${s.sections} 太長`).toBeLessThanOrEqual(60)
      expect(s.reading.han).toBeGreaterThan(300)
      expect(s.reading.experiments).toBe(s.experiments.length)
    }
    const total = backboneTotalMinutes()
    expect(total).toBe(BACKBONE.reduce((a, s) => a + s.minutes, 0))
    expect(total).toBeLessThanOrEqual(BACKBONE_MAX_MINUTES)
    expect(total).toBeGreaterThanOrEqual(180)
  })

  it('stepId／href：整章 = 頁面 id 與路徑；段落級 = page#anchor 與 ?a=', () => {
    expect(backboneStepId({ page: 'ch00' })).toBe('ch00')
    expect(backboneStepId({ page: 'ch01', anchor: 'ch01-s14' })).toBe('ch01#ch01-s14')
    expect(backboneHref({ page: 'ch00' })).toBe('/ch/00')
    expect(backboneHref({ page: 'ch01', anchor: 'ch01-s14' })).toBe('/ch/01?a=ch01-s14')
    expect(backboneHref({ page: 'signoff' })).toBe(pageById('signoff')!.path)
    expect(backboneIndexOf('ch00')).toBe(0)
    expect(backboneIndexOf('nope')).toBe(-1)
  })

  it('進度：已完成步數、分鐘數與下一步', () => {
    const none = backboneProgress(new Set())
    expect(none).toMatchObject({ done: 0, total: BACKBONE.length, minutesDone: 0, minutesLeft: backboneTotalMinutes() })
    expect(none.next).toBe(BACKBONE[0])
    const two = backboneProgress(new Set([backboneStepId(BACKBONE[0]), backboneStepId(BACKBONE[1])]))
    expect(two.done).toBe(2)
    expect(two.minutesDone).toBe(BACKBONE[0].minutes + BACKBONE[1].minutes)
    expect(two.next).toBe(BACKBONE[2])
    // 跳著勾：下一步是第一個沒勾的
    const skip = backboneProgress(new Set([backboneStepId(BACKBONE[1])]))
    expect(skip.next).toBe(BACKBONE[0])
    const all = backboneProgress(new Set(BACKBONE.map(backboneStepId)))
    expect(all.next).toBeNull()
    expect(all.minutesLeft).toBe(0)
  })

  it('resumeTarget：上次離開的頁面優先（沒完成才算），否則第一個沒完成的步驟，全部完成就回第 1 步', () => {
    const done = new Set<string>()
    expect(resumeTarget(done, null)).toMatchObject({ kind: 'start', index: 1, href: '/ch/00' })
    done.add('ch00')
    expect(resumeTarget(done, null)).toMatchObject({ kind: 'next', index: 2, href: '/ch/01' })
    // 上次在 ch02 §3（有錨點）：回到那一步
    const r = resumeTarget(done, { page: 'ch02', anchor: 'ch02-s3', at: 1 })
    expect(r.kind).toBe('last-visit')
    expect(r.step.page).toBe('ch02')
    expect(r.href).toBe('/ch/02?a=ch02-s3')
    expect(r.index).toBe(backboneIndexOf('ch02#ch02-s3') + 1)
    // 上次在 ch01、沒有錨點：該頁第一個沒完成的步驟（§1.0–§1.1），連結到章首
    expect(resumeTarget(done, { page: 'ch01', at: 1 })).toMatchObject({ kind: 'last-visit', href: '/ch/01', index: 2 })
    // 那一頁的步驟都完成了：退回「下一步」
    done.add('ch01')
    done.add('ch01#ch01-s14')
    expect(resumeTarget(done, { page: 'ch01', at: 1 })).toMatchObject({ kind: 'next', href: '/ch/02', index: 4 })
    // 上次在不在路線上的頁面（ch03）：也退回下一步
    expect(resumeTarget(done, { page: 'ch03', at: 1 })).toMatchObject({ kind: 'next', index: 4 })
    for (const s of BACKBONE) done.add(backboneStepId(s))
    expect(resumeTarget(done, null)).toMatchObject({ kind: 'all-done', index: 1, href: '/ch/00' })
  })

  it('touchLastVisit（PageFrame 換頁時呼叫）：只記路線上的頁面；同一頁已有錨點就保留；路線外的頁面不會蓋掉路線的位置', () => {
    localStorage.clear()
    expect(touchLastVisit('ch03', 10)).toBe(false) // ch03 不在路線上
    expect(readLastVisit()).toBeNull()
    expect(recordLastVisit('ch01', 'ch01-s14', 100)).toBe(true) // Dashboard 的步驟連結記的
    expect(touchLastVisit('ch01', 200)).toBe(true)
    expect(JSON.parse(localStorage.getItem(LAST_VISIT_KEY)!)).toEqual({ page: 'ch01', anchor: 'ch01-s14', at: 200 })
    expect(touchLastVisit('ch04', 300)).toBe(true) // 換到路線上的另一頁：沒有錨點
    expect(JSON.parse(localStorage.getItem(LAST_VISIT_KEY)!)).toEqual({ page: 'ch04', at: 300 })
    expect(touchLastVisit('lab', 400)).toBe(false) // 路線外：維持 ch04
    expect(readLastVisit()?.page).toBe('ch04')
  })

  it('lmspll.lastVisited：寫入／讀取、壞資料與不存在的頁面都當作沒有；lmspll.scroll.<page> 可補錨點', () => {
    localStorage.clear()
    expect(readLastVisit()).toBeNull()
    expect(recordLastVisit('nope')).toBe(false)
    expect(recordLastVisit('ch02', 'ch02-s3', 123)).toBe(true)
    expect(JSON.parse(localStorage.getItem(LAST_VISIT_KEY)!)).toEqual({ page: 'ch02', anchor: 'ch02-s3', at: 123 })
    expect(readLastVisit()).toEqual({ page: 'ch02', anchor: 'ch02-s3', at: 123 })
    localStorage.setItem(LAST_VISIT_KEY, '{not json')
    expect(readLastVisit()).toBeNull()
    localStorage.setItem(LAST_VISIT_KEY, JSON.stringify({ page: 'ch99', at: 1 }))
    expect(readLastVisit()).toBeNull()
    // 沒有 anchor 時從 lmspll.scroll.<page> 補（純字串或 JSON 兩種寫法）
    localStorage.setItem(LAST_VISIT_KEY, JSON.stringify({ page: 'ch06', at: 5 }))
    expect(readLastVisit()).toEqual({ page: 'ch06', anchor: undefined, at: 5 })
    localStorage.setItem('lmspll.scroll.ch06', 'ch06-s3')
    expect(readScrollAnchor('ch06')).toBe('ch06-s3')
    expect(readLastVisit()?.anchor).toBe('ch06-s3')
    localStorage.setItem('lmspll.scroll.ch06', JSON.stringify({ anchor: 'ch06-s2', y: 100 }))
    expect(readLastVisit()?.anchor).toBe('ch06-s2')
    localStorage.setItem('lmspll.scroll.ch06', 'not an id!')
    expect(readScrollAnchor('ch06')).toBeUndefined()
    // 純數字（scrollY 之類）不是錨點
    localStorage.setItem('lmspll.scroll.ch06', '3262')
    expect(readScrollAnchor('ch06')).toBeUndefined()
    localStorage.clear()
  })

  it('formatMinutes：分鐘 → 「25 分」「約 1.5 小時」「約 6 小時」', () => {
    expect(formatMinutes(25)).toBe('25 分')
    expect(formatMinutes(60)).toBe('約 1 小時')
    expect(formatMinutes(95)).toBe('約 1.5 小時')
    expect(formatMinutes(360)).toBe('約 6 小時')
    expect(formatMinutes(backboneTotalMinutes())).toMatch(/^約 \d+(\.\d)? 小時$/)
  })
})
