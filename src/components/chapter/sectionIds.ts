/**
 * 穩定的段落 id（章節測試用）。
 *
 * 規則（docs/dev-conventions.md §1.6）：章內每個有 h2／h3／h4 標題的 <section> 都要有 id，
 * 格式 `<chNN>-<slug>`（slug 是英文短字，例如 `ch12-spurs`）；已經有 id 的不改——PageOutline、Beginner 骨幹路線的 anchor、
 * `?a=` 深連結與使用者存下來的連結都靠它，改了就全部失效。
 */

export interface SectionIdReport {
  /** 有標題但沒有 id 的 section（標題文字） */
  missing: string[]
  /** 同一頁出現不只一次的 id */
  duplicates: string[]
  /** 掃到的 section 數（有標題的） */
  count: number
}

/** 這些 section 的標題不是章節段落的標題（手算題卡片、放大檢視）：略過 */
const SKIP = '.c-handcalc, .c-zoom, .c-outline'

/** 掃一個 DOM 子樹：有標題的 <section> 是否都有 id、id 是否唯一 */
export function sectionIdReport(root: ParentNode): SectionIdReport {
  const missing: string[] = []
  let count = 0
  root.querySelectorAll('section').forEach((s) => {
    if (s.matches(SKIP) || s.closest(SKIP)) return
    const h = s.querySelector(':scope > h2, :scope > h3, :scope > h4, :scope > div > h2, :scope > div > h3, :scope > div > h4, :scope > header h2, :scope > header h3, :scope > summary h2')
    if (!h) return
    count++
    if (!s.id) missing.push((h.textContent ?? '').trim().slice(0, 40))
  })
  const seen = new Map<string, number>()
  root.querySelectorAll('[id]').forEach((e) => seen.set(e.id, (seen.get(e.id) ?? 0) + 1))
  const duplicates = [...seen].filter(([, n]) => n > 1).map(([id]) => id)
  return { missing, duplicates, count }
}

/** 新增的段落 id 要符合的格式：`ch12-spurs`、`ch11b-basis` */
export function isChapterSectionId(id: string, ch: string): boolean {
  return new RegExp(`^ch${ch}-[a-z0-9]+(-[a-z0-9]+)*$`).test(id)
}
