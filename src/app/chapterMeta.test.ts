import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import errataJson from '@/data/errata.json'
import { handcalcsForPage } from './handcalcs'
import { CHAPTER_FRAME_META, READING_RATE, chapterChain, chapterFrameMeta, estimateReadingMinutes } from './chapterMeta'
import { PAGES, pageById } from './registry'
import { MODES } from './settings'

/** 章節頁：group A／B／C（含 07b 案例頁） */
const CHAPTER_PAGES = PAGES.filter((p) => p.group === 'A' || p.group === 'B' || p.group === 'C')

/** 'ch05' → src/chapters/ch05；'case-sspll' → src/pages/case-sspll */
function sourceDir(pageId: string): string {
  return join(process.cwd(), pageId === 'case-sspll' ? 'src/pages/case-sspll' : `src/chapters/${pageId}`)
}

/** 章編號（'05'、'07b'）→ registry id */
function pageIdOfChapter(ch: string): string {
  return ch === '07b' ? 'case-sspll' : `ch${ch}`
}

/** 讀一個章節資料夾裡所有非測試的 .tsx／.ts 原始碼（找錨點 id 用） */
function chapterSources(pageId: string): string {
  const dir = sourceDir(pageId)
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(readFileSync(p, 'utf8'))
    }
  }
  walk(dir)
  return out.join('\n')
}

describe('chapterMeta：每個章節頁一筆', () => {
  it('group A／B／C 的每一頁（ch00–ch14、ch11b、case-sspll）都有資料，表裡沒有多出來的 id', () => {
    for (const p of CHAPTER_PAGES) expect(chapterFrameMeta(p.id), p.id).toBeDefined()
    for (const id of Object.keys(CHAPTER_FRAME_META)) expect(CHAPTER_PAGES.some((p) => p.id === id), `${id} 不是章節頁`).toBe(true)
    expect(Object.keys(CHAPTER_FRAME_META)).toHaveLength(17)
  })

  it('閱讀時間：三種模式都有、是 5 的倍數、至少 5 分鐘，且由量到的內容量（reading）依 READING_RATE 算出；內容量隨模式遞增', () => {
    for (const [id, m] of Object.entries(CHAPTER_FRAME_META)) {
      for (const mode of MODES) {
        const v = m.readingMinutes[mode]
        expect(Number.isInteger(v) && v >= 5 && v % 5 === 0, `${id} ${mode}: ${v}`).toBe(true)
        expect(v, `${id} ${mode}`).toBe(estimateReadingMinutes(m.reading[mode]))
        for (const k of ['han', 'formulas', 'figures', 'experiments'] as const) expect(m.reading[mode][k], `${id} ${mode} ${k}`).toBeGreaterThanOrEqual(0)
        expect(m.reading[mode].han, `${id} ${mode} 中文字數`).toBeGreaterThan(1000)
      }
      // 模式越高看得到的東西越多（Beginner 只是少掉 ModeGate 的內容，不會多）
      expect(m.readingMinutes.engineer, id).toBeGreaterThanOrEqual(m.readingMinutes.beginner)
      expect(m.readingMinutes.research, id).toBeGreaterThanOrEqual(m.readingMinutes.engineer)
      expect(m.reading.research.han, id).toBeGreaterThanOrEqual(m.reading.beginner.han)
    }
  })

  it('estimateReadingMinutes：中文 350 字／分 + 每條公式 0.2 分 + 每張圖 0.5 分 + 每個實驗 3 分，四捨五入到 5 分鐘、最少 5', () => {
    expect(READING_RATE).toEqual({ hanPerMinute: 350, formulaMinutes: 0.2, figureMinutes: 0.5, experimentMinutes: 3 })
    expect(estimateReadingMinutes({ han: 0, formulas: 0, figures: 0, experiments: 0 })).toBe(5)
    // 3500 字 = 10 分；+ 4 條公式 = 10.8；+ 2 張圖 = 11.8；+ 1 個實驗 = 14.8 → 15
    expect(estimateReadingMinutes({ han: 3500, formulas: 4, figures: 2, experiments: 1 })).toBe(15)
    // 四捨五入到 5 的倍數：17.5 分是 15 與 20 的中點
    expect(estimateReadingMinutes({ han: 3500, formulas: 37, figures: 0, experiments: 0 })).toBe(15) // 17.4 → 15
    expect(estimateReadingMinutes({ han: 3500, formulas: 38, figures: 0, experiments: 0 })).toBe(20) // 17.6 → 20
    expect(estimateReadingMinutes({ han: 7000, formulas: 0, figures: 0, experiments: 0 })).toBe(20)
  })

  it('errata：和 src/data/errata.json 裡 chapters 含本章的條目一致（全文性的 "all" 不算本章負責）', () => {
    const errata = (errataJson as { errata: { eid: string; chapters: string[] }[] }).errata
    for (const [id, m] of Object.entries(CHAPTER_FRAME_META)) {
      const expected = errata.filter((e) => e.chapters.includes(id)).map((e) => e.eid).sort()
      expect([...m.errata].sort(), id).toEqual(expected)
      expect(m.errata, `${id}：勘誤順序依 Exx 排列`).toEqual([...m.errata].sort())
    }
  })

  it('prereqs：每章 2–4 條；ch 指向存在的章節頁、anchor 在該章的原始碼裡真的有（id="…" 或 \'…\' 字串）；只有 ch00 可以沒有章節連結', () => {
    for (const [id, m] of Object.entries(CHAPTER_FRAME_META)) {
      expect(m.prereqs.length, id).toBeGreaterThanOrEqual(2)
      expect(m.prereqs.length, id).toBeLessThanOrEqual(4)
      for (const pr of m.prereqs) {
        expect(pr.label.trim().length, `${id}: ${pr.label}`).toBeGreaterThan(4)
        if (!pr.ch) {
          expect(id, `${id} 的「${pr.label}」沒有章節連結`).toBe('ch00')
          expect(pr.anchor).toBeUndefined()
          continue
        }
        const target = pageIdOfChapter(pr.ch)
        expect(pageById(target), `${id} → ${pr.ch}`).toBeDefined()
        expect(target, `${id} 的先備不能指向自己`).not.toBe(id)
        if (pr.anchor) {
          const src = chapterSources(target)
          const found = src.includes(`id="${pr.anchor}"`) || src.includes(`'${pr.anchor}'`) || src.includes(`"${pr.anchor}"`)
          expect(found, `${id} → ${target}#${pr.anchor} 在 ${sourceDir(target)} 的原始碼裡找不到`).toBe(true)
        }
      }
    }
  })

  it('next：從 ch00 沿著 next 走是 ch00 → … → ch07 → case-sspll → ch08 → … → ch11 → ch11b → ch12 → … → ch14，ch14 指向 sign-off 頁；hook 都是一句話', () => {
    expect(chapterChain()).toEqual(['ch00', 'ch01', 'ch02', 'ch03', 'ch04', 'ch05', 'ch06', 'ch07', 'case-sspll', 'ch08', 'ch09', 'ch10', 'ch11', 'ch11b', 'ch12', 'ch13', 'ch14'])
    expect(CHAPTER_FRAME_META.ch14.next.page).toBe('signoff')
    expect(pageById('signoff')).toBeDefined()
    for (const [id, m] of Object.entries(CHAPTER_FRAME_META)) {
      expect(pageById(m.next.page), `${id} → ${m.next.page}`).toBeDefined()
      expect(m.next.hook.trim().length, id).toBeGreaterThan(10)
      expect(m.next.hook, `${id}：hook 不該有未成對的 $`).toMatch(/^(?:[^$]*\$[^$]+\$)*[^$]*$/)
    }
  })

  it('手算題：每一章 registry 的 path 都收集得到 HANDCALCS（strip 的「手算 N 題」從畫面數，但資料要先存在）', () => {
    for (const p of CHAPTER_PAGES) expect(handcalcsForPage(p.path).length, p.id).toBeGreaterThanOrEqual(4)
  })

  it('每個章節頁的原始碼資料夾存在（prereq 的錨點檢查才有意義）', () => {
    for (const p of CHAPTER_PAGES) expect(existsSync(sourceDir(p.id)), p.id).toBe(true)
  })
})
