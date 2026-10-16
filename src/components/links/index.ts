/** 連結元件：公式 ID 連結、頁內錨點連結、章節交叉參照（見 FormulaLink.tsx / ChRef.tsx） */
import './links.css'

export { FormulaLink, AnchorLink, type FormulaLinkProps, type AnchorLinkProps } from './FormulaLink'
export { ChRef, chapterTarget, normalizeChapterId, type ChRefProps } from './ChRef'
export { AnchorDeepLink } from './DeepLink'
export { formulaDomId, formulaHref, routeWithParam, revealAnchor, revealFromRoute, markNavigation, scrollToElement, waitAndReveal, type RevealFilter } from './anchor'
