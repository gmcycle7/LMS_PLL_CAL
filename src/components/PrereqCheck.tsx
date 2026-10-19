import { NavLink, useInRouterContext } from 'react-router-dom'
import type { ChapterPrereq } from '@/app/chapterMeta'
import { pageById } from '@/app/registry'
import { ChRef, chapterTarget, normalizeChapterId } from './links'
import { mathText } from './Tex'

export interface PrereqCheckProps {
  /** 2–4 條自檢；每條可以指到一章（ChRef）或該章的某個錨點（連到 `#/ch/03?a=…`） */
  items: ChapterPrereq[]
  title?: string
}

/** 一條自檢後面的連結：有 anchor 就連到該章的錨點（載入後會捲過去），否則就是一般的章節交叉參照 */
function PrereqLink({ item }: { item: ChapterPrereq }) {
  const inRouter = useInRouterContext()
  if (!item.ch) return null
  if (!item.anchor) return <ChRef ch={item.ch} sec={item.sec} />
  const target = chapterTarget(item.ch)
  const id = normalizeChapterId(item.ch)
  if (!target || !id) return <ChRef ch={item.ch} sec={item.sec} />
  const label = id === '07b' ? '07b 案例' : `第 ${id} 章`
  const to = `${target.to}?a=${encodeURIComponent(item.anchor)}`
  const text = (
    <>
      {label}
      {item.sec ? ` ${item.sec}` : null}
    </>
  )
  const title = pageById(target.pageId)?.nav
  if (!inRouter) {
    return (
      <a className="c-chref" href={`#${to}`} title={title} data-chref={id} data-anchor={item.anchor}>
        {text}
      </a>
    )
  }
  return (
    <NavLink className="c-chref" to={to} title={title} data-chref={id} data-anchor={item.anchor}>
      {text}
    </NavLink>
  )
}

/**
 * 章首的「進來之前你應該會」（docs/teaching-style.md §9）：2–4 條一句話的自檢，三種學習模式都展開（不是 <details>）。
 * 每條後面一個連結指到該去複習的章或小節；跳章進來的讀者在這裡被攔下。資料在 src/app/chapterMeta.ts，由 PageFrame 掛上。
 */
export function PrereqCheck({ items, title = '進來之前你應該會' }: PrereqCheckProps) {
  if (items.length === 0) return null
  return (
    <aside className="c-prereq-check" aria-label={title}>
      <div className="c-prereq-check-title">{title}</div>
      <ul className="c-prereq-check-list">
        {items.map((it, i) => (
          <li key={i}>
            <span className="c-prereq-check-label">{mathText(it.label)}</span>
            {it.ch && (
              <span className="c-prereq-check-go">
                → <PrereqLink item={it} />
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="c-prereq-check-note">不確定就先點過去看一眼；正文每個符號第一次出現時也會再用一句話說明。</p>
    </aside>
  )
}
