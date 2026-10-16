import { useEffect, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react'
import { useInRouterContext, useLocation } from 'react-router-dom'
import { formulaDomId, formulaHref, revealAnchor, revealFromRoute, routeWithParam } from './anchor'

/** 修飾鍵／非左鍵的點擊交給瀏覽器（新分頁、另存…），不攔截 */
function isPlainLeftClick(e: ReactMouseEvent): boolean {
  return !(e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
}

/** 在 <Router> 之外（單元測試）的目前路由：window.location.hash 去掉 # */
function hashRoute(): string {
  const hash = typeof window === 'undefined' ? '' : window.location.hash
  return hash.replace(/^#/, '') || '/'
}

/**
 * 掛上來時網址正好指著自己（?f=自己的公式／?a=自己的錨點）就等目標出現再捲過去：複製下來的連結才會定位。
 * route 在 <Router> 裡是 react-router 的 pathname+search：點擊後用 replaceState 寫進去的 ?f= 不會出現在裡面，
 * 所以晚一點才掛上來的同名連結（例如按 Run 之後的指標表）不會突然把頁面捲走。
 */
function useRevealOnMount(param: 'f' | 'a', value: string, route: string) {
  useEffect(() => revealFromRoute(route, { param, value }) ?? undefined, [param, value, route])
}

/** 在 <Router> 裡：把 react-router 的路由交給 View；在外面：用 window.location.hash */
function withRoute<P extends object>(View: (props: P & { route: string }) => ReactElement) {
  function Routed(props: P) {
    const { pathname, search } = useLocation()
    return <View {...props} route={`${pathname}${search}`} />
  }
  return function Wrapped(props: P) {
    const inRouter = useInRouterContext()
    return inRouter ? <Routed {...props} /> : <View {...props} route={hashRoute()} />
  }
}

export interface FormulaLinkProps {
  /** 公式 ID，例如 'F-05.1' */
  id: string
  /** 連結文字（預設就是公式 ID） */
  children?: ReactNode
  className?: string
}

function FormulaLinkView({ id, children, className, route }: FormulaLinkProps & { route: string }) {
  useRevealOnMount('f', id, route)
  return (
    <a
      href={formulaHref(id)}
      className={className}
      data-formula-link={id}
      onClick={(e) => {
        if (!isPlainLeftClick(e)) return
        if (revealAnchor(formulaDomId(id), { param: 'f', value: id })) e.preventDefault()
      }}
    >
      {children ?? id}
    </a>
  )
}

/**
 * 公式 ID 連結（MetricTable 的「公式」欄、內文裡的 F-xx.y）。
 *
 *   - 這一頁有這條公式（元素 id="formula-F-05.1"）→ 攔截左鍵點擊：展開祖先 <details>、捲到公式（扣掉 topbar）、
 *     聚焦並短暫標示，再用 history.replaceState 把網址改成「目前的路由 + ?f=F-05.1」（不經過路由器、不新增歷史紀錄）。
 *   - 這一頁沒有（在別章、或只在 Research 模式顯示）→ 照 href 走：'#/formulas?f=F-05.1'，公式速查頁會標示這條公式並提供「前往」。
 *   - 打開複製下來的 '#/ch/05?f=F-05.1'：這條連結掛上來時看到網址指著自己，就等公式出現再捲過去。
 * href 是真的路由網址，所以中鍵、Ctrl／⌘ 點擊、複製連結都能用；永遠不會出現會被 HashRouter 當成路由的 '#formula-…'。
 * 在 <Router> 之外（單元測試）會退回 window.location.hash。
 */
export const FormulaLink = withRoute<FormulaLinkProps>(FormulaLinkView)

export interface AnchorLinkProps {
  /** 目標元素的 id（本頁內） */
  id: string
  children: ReactNode
  className?: string
  title?: string
}

function AnchorLinkView({ id, children, className, title, route }: AnchorLinkProps & { route: string }) {
  useRevealOnMount('a', id, route)
  return (
    <a
      href={routeWithParam(route, 'a', id)}
      className={className}
      title={title}
      data-anchor-link={id}
      onClick={(e) => {
        if (!isPlainLeftClick(e)) return
        if (revealAnchor(id, { param: 'a', value: id })) e.preventDefault()
      }}
    >
      {children}
    </a>
  )
}

/**
 * 頁內錨點連結（章內目錄、「跳到第 7 節」）：FormulaLink 的一般版。
 * 點擊時捲到本頁的 #id 並把網址改成「目前的路由 + ?a=id」；href 是這個真的網址，所以在新分頁開啟時
 * 會先到對的頁面，再由同一條連結（掛上來時看到 ?a= 指著自己）捲到目標。目標不在這一頁時就照 href 走。
 * 在 <Router> 之外（單元測試）會退回 window.location.hash。
 */
export const AnchorLink = withRoute<AnchorLinkProps>(AnchorLinkView)
