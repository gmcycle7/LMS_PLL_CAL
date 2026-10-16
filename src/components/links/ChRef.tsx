import type { ReactNode } from 'react'
import { NavLink, useInRouterContext } from 'react-router-dom'
import { pageById } from '@/app/registry'

export interface ChRefProps {
  /** 章編號：'00'–'14'，或 '07b'（案例頁 /case/sspll）；'5'、'Ch05' 也接受 */
  ch: string
  /** 小節標示，附在連結文字後面，例如 '§5.3' */
  sec?: string
  /** 連結文字（內文原本怎麼寫就怎麼放：「第 05 章」「Ch05」…）；不給就用「第 05 章」 */
  children?: ReactNode
  className?: string
}

/** '5' / 'ch05' / 'Ch05' / '07B' → '05' / '07b'；不是章編號時回傳 null */
export function normalizeChapterId(ch: string): string | null {
  const m = /^(?:ch)?\s*(\d{1,2})(b?)$/i.exec(ch.trim())
  if (!m) return null
  return `${m[1].padStart(2, '0')}${m[2].toLowerCase()}`
}

/** 章編號 → 頁面 registry 的 id 與路由；registry 裡沒有這一頁（例如 'Ch16'）時回傳 null */
export function chapterTarget(ch: string): { pageId: string; to: string } | null {
  const id = normalizeChapterId(ch)
  if (!id) return null
  const pageId = id === '07b' ? 'case-sspll' : `ch${id}`
  const page = pageById(pageId)
  return page ? { pageId, to: page.path } : null
}

/**
 * 章節交叉參照：把內文裡的「第 05 章」「Ch05」「07b 案例」變成連到該章的連結（NavLink → /ch/05；07b → /case/sspll）。
 * hover／長按會顯示該章的完整名稱（來源是頁面 registry，不另外維護一份）。
 * 在 <Router> 之外（單元測試）退回 <a href="#/ch/05">。章編號不存在時只顯示文字、不產生連結。
 */
export function ChRef({ ch, sec, children, className }: ChRefProps) {
  const inRouter = useInRouterContext()
  const target = chapterTarget(ch)
  const id = normalizeChapterId(ch)
  const label = children ?? (id === '07b' ? '07b 案例' : `第 ${id ?? ch} 章`)
  const text = (
    <>
      {label}
      {sec ? ` ${sec}` : null}
    </>
  )
  if (!target) return <span className="c-chref-missing">{text}</span>
  const title = pageById(target.pageId)?.nav
  const cls = className ? `c-chref ${className}` : 'c-chref'
  if (!inRouter) {
    return (
      <a className={cls} href={`#${target.to}`} title={title} data-chref={id}>
        {text}
      </a>
    )
  }
  return (
    <NavLink className={cls} to={target.to} end title={title} data-chref={id}>
      {text}
    </NavLink>
  )
}
