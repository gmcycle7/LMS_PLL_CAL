import { NavLink, useInRouterContext } from 'react-router-dom'
import type { ChapterNext } from '@/app/chapterMeta'
import { pageById } from '@/app/registry'
import { ChRef } from './links'
import { mathText } from './Tex'

export interface ChapterHandoffProps {
  next: ChapterNext
}

/** registry id → ChRef 的章編號（'ch05' → '05'、'ch11b' → '11b'、'case-sspll' → '07b'）；工具頁回傳 null */
export function chapterCodeOf(pageId: string): string | null {
  if (pageId === 'case-sspll') return '07b'
  const m = /^ch(\d{2}b?)$/.exec(pageId)
  return m ? m[1] : null
}

/**
 * 章末交棒（docs/teaching-style.md §9）：Wrap（思考題、本課必記）之後、符號表之前的一段「下一章：…要解決什麼」。
 * 資料在 src/app/chapterMeta.ts 的 next；ch14 指向 sign-off 頁（不是章節，用一般的頁面連結）。由 PageFrame 掛上。
 */
export function ChapterHandoff({ next }: ChapterHandoffProps) {
  const inRouter = useInRouterContext()
  const page = pageById(next.page)
  if (!page) return null
  const code = chapterCodeOf(next.page)
  const link = code ? (
    <ChRef ch={code}>{page.nav}</ChRef>
  ) : inRouter ? (
    <NavLink className="c-chref" to={page.path} data-page={page.id}>
      {page.nav}
    </NavLink>
  ) : (
    <a className="c-chref" href={`#${page.path}`} data-page={page.id}>
      {page.nav}
    </a>
  )
  return (
    <aside className="c-handoff" aria-label={code ? '下一章要解決什麼' : '接下來要做什麼'} data-next={next.page}>
      <div className="c-handoff-kicker">{code ? '下一章要解決什麼' : '接下來要做什麼'}</div>
      <p className="c-handoff-body">
        <span className="c-handoff-next">{link}</span>：{mathText(next.hook)}
      </p>
    </aside>
  )
}
