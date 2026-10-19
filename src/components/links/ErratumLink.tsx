import type { ReactNode } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import { erratumIndexEntry, type ErratumSeverity } from '@/data/errataIndex'
import { accessibleText } from '../speech'
import { badgeClass } from '../Tags'
import './erratumLink.css'

const SEVERITY_NAME: Record<ErratumSeverity, string> = { high: '嚴重', medium: '中', low: '輕微' }

/** 勘誤連結的路由（驗證頁的 ?e= 深連結；驗證頁會捲到並標示那一張勘誤卡片） */
export function erratumRoute(id: string): string {
  return `/verification?e=${encodeURIComponent(id)}`
}

export interface ErratumLinkProps {
  /** 勘誤編號，例如 'E44' */
  id: string
  /** 徽章後面的一句說明（選填） */
  children?: ReactNode
}

/**
 * 「勘誤 E44」徽章：連到 /verification?e=E44（該條勘誤的卡片，不是驗證頁頂端）。
 *
 * 各章原本各有一份自己的 Erratum 元件（有的連到 #/verification、有的帶 ?e=、有的只是文字）；新增內容請用這一個。
 * 在 <Router> 裡用 react-router 的 <Link>（站內導覽、不整頁重載）；在 Router 之外（單元測試）退回 <a href="#/verification?e=…">。
 * 浮動提示（title）是「E44（嚴重）：§11 Bias / INL」——嚴重度與區域取自 src/data/errataIndex.ts（由 errata.json 產生的精簡索引，
 * 約 4 KB；不能直接 import errata.json，那會把 75 KB 的完整勘誤文字打包進每一頁都載入的主 chunk，見 scripts/build-errata-index.mjs）；
 * 找不到這個編號時照樣畫出連結，但提示會寫「找不到此勘誤」並標上 data-missing，方便審查時抓出打錯的編號。
 *
 * 顏色：基底是勘誤徽章的琥珀描邊（嚴重度中）；high／low 由 erratumLink.css 的 data-severity 換成和 Badge 的 mismatch（紅）／
 * neutral（灰）同一組顏色，和驗證頁勘誤卡片上的嚴重度徽章（pages/verification/common.tsx 的 SEVERITY_VARIANT）一致；
 * src/components/links/erratumSeverity.test.ts 守住這個對應。
 */
export function ErratumLink({ id, children }: ErratumLinkProps) {
  const inRouter = useInRouterContext()
  const rec = erratumIndexEntry(id)
  const tip = rec ? `${id}（${SEVERITY_NAME[rec.severity]}）：${accessibleText(rec.area)}` : `${id}：找不到此勘誤`
  const content = (
    <>
      勘誤 {id}
      {children ? <span className="c-erratum-note">：{children}</span> : null}
    </>
  )
  const common = { className: badgeClass('erratum', 'c-erratum-link'), title: tip, 'data-erratum': id, 'data-severity': rec?.severity, 'data-missing': rec ? undefined : 'true' }
  if (!inRouter) {
    return (
      <a {...common} href={`#${erratumRoute(id)}`}>
        {content}
      </a>
    )
  }
  return (
    <Link {...common} to={erratumRoute(id)}>
      {content}
    </Link>
  )
}
