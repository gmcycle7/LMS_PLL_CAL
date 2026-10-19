import { memo, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type { PageEntry, PageGroup } from './registry'
import { ErrorBoundary } from './ErrorBoundary'
import { MODE_HINT, useSettings } from './settings'
import { pageNeighbours as neighbours, useNavigationInfo } from './navigation'
import { chapterFrameMeta } from './chapterMeta'
import { ModePicker } from '@/components/ModePicker'
import { AnchorDeepLink } from '@/components/links'
import { PageOutline, type OutlineLayout } from '@/components/PageOutline'
import { ChapterInfoStrip } from '@/components/ChapterInfoStrip'
import { PrereqCheck } from '@/components/PrereqCheck'
import { ChapterHandoff } from '@/components/ChapterHandoff'
import '@/components/chapterFrame.css'

/** 章節頁（含 07b 案例）才顯示模式提示；工具頁與 Part D 不顯示 */
const CHAPTER_GROUPS: readonly PageGroup[] = ['A', 'B', 'C']

/** 章節本體只在換頁時重畫：外框自己的 state（目錄的版面、章首插槽）變了不能把 6–10 萬個節點的章節整個再 render 一次 */
const PageContent = memo(function PageContent({ Page }: { Page: ComponentType }) {
  return <Page />
})

/* ───────────── 章首／章末骨架（docs/teaching-style.md §9） ───────────── */

/** DOM 變動後多久重掃一次插槽的位置（和 PageOutline 一樣：Plotly 畫圖時 mutation 很多，合併處理） */
export const CHAPTER_FRAME_RESCAN_MS = 150

/** 兩個插槽在 DOM 裡的標記（data-chapter-slot） */
export const OPENING_SLOT = 'opening'
export const HANDOFF_SLOT = 'handoff'

export interface ChapterSlots {
  /** 章首插槽：第一張圖（系統地圖）與緊接著的 .c-map-note 之後；頁面上沒有圖就是 null（strip 改畫在內容前面） */
  opening: HTMLElement | null
  /** 章末插槽：#symbols 之前；沒有 #symbols 就是 null（交棒改畫在內容後面） */
  handoff: HTMLElement | null
  /** 本頁（目前模式）畫出來的手算題元素 id，DOM 順序 */
  handcalcIds: string[]
  hasSymbols: boolean
}

/** 在 ref 的前面或後面放一個插槽（已經在那裡就直接用；在別處就搬過來） */
function ensureSlot(root: ParentNode, ref: Element, where: 'before' | 'after', name: string): HTMLElement {
  const sibling = where === 'after' ? ref.nextElementSibling : ref.previousElementSibling
  if (sibling instanceof HTMLElement && sibling.dataset.chapterSlot === name) return sibling
  let slot = root.querySelector<HTMLElement>(`[data-chapter-slot="${name}"]`)
  if (!slot) {
    slot = document.createElement('div')
    slot.dataset.chapterSlot = name
    slot.className = name === OPENING_SLOT ? 'c-chapter-opening' : 'c-chapter-handoff-slot'
  }
  ref.parentElement?.insertBefore(slot, where === 'after' ? ref.nextSibling : ref)
  return slot
}

/**
 * 找出（並放好）章首與章末的插槽：
 *   - 章首：root 裡第一張圖（figure.c-mermaid，各章章首的系統地圖）之後；圖後面緊接著的「你在這裡」段落（.c-map-note）也算在圖裡，插槽放在它後面。
 *   - 章末：#symbols（章末符號表）之前。
 * 插槽是 PageFrame 自己建的 <div>，用 createPortal 把 strip／先備自檢／交棒畫進去，章節本身不需要知道它存在；
 * 章節重畫時 React 只動它自己建的節點，插槽留在原位。
 */
export function placeChapterSlots(root: HTMLElement): ChapterSlots {
  const fig = root.querySelector<HTMLElement>('figure.c-mermaid')
  let opening: HTMLElement | null = null
  if (fig) {
    const next = fig.nextElementSibling
    const anchor = next && next.classList.contains('c-map-note') ? next : fig
    opening = ensureSlot(root, anchor, 'after', OPENING_SLOT)
  }
  const symbols = root.querySelector<HTMLElement>('#symbols')
  const handoff = symbols ? ensureSlot(root, symbols, 'before', HANDOFF_SLOT) : null
  const handcalcIds = Array.from(root.querySelectorAll<HTMLElement>('.c-handcalc[id]')).map((el) => el.id)
  return { opening, handoff, handcalcIds, hasSymbols: !!symbols }
}

function sameSlots(a: ChapterSlots | null, b: ChapterSlots): boolean {
  return !!a && a.opening === b.opening && a.handoff === b.handoff && a.hasSymbols === b.hasSymbols && a.handcalcIds.join() === b.handcalcIds.join()
}

/** 每個頁面的共同外框：標題、章節對照、模式提示、本頁目錄、上一頁/下一頁。 */
export function PageFrame({ entry }: { entry: PageEntry }) {
  const { prev, next } = neighbours(entry.id)
  const Page = entry.component
  const { mode, modeChosen } = useSettings()
  const { generation, announce } = useNavigationInfo()
  const articleRef = useRef<HTMLElement>(null)
  // 本頁目錄的版面：'column'（寬螢幕右欄，article 要讓出右側 224px）、'dock'（右下角按鈕）、null（本頁太短）
  const [outline, setOutline] = useState<OutlineLayout | null>(null)
  // 章首／章末骨架（只有章節頁有 chapterMeta）：插槽的位置與從 DOM 數出來的手算題；掃完之前不畫（避免先畫在上面再跳到圖後面）
  const meta = chapterFrameMeta(entry.id)
  const [slots, setSlots] = useState<{ id: string; slots: ChapterSlots } | null>(null)

  useEffect(() => {
    // 瀏覽器分頁標題由 App.tsx 的 <DocumentTitle>（navigation.tsx）設定
    window.scrollTo(0, 0)
  }, [entry])

  // 章節掛上來的同一個 commit 裡找插槽（layout effect：第一次繪製就在正確位置）；之後 DOM 變了（模式切換、延後渲染）就重掃
  useLayoutEffect(() => {
    const root = articleRef.current
    if (!meta || !root) return
    let timer: number | null = null
    const scan = () => {
      timer = null
      if (!root.isConnected) return
      const next = placeChapterSlots(root)
      setSlots((prev) => (prev && prev.id === entry.id && sameSlots(prev.slots, next) ? prev : { id: entry.id, slots: next }))
    }
    scan()
    const mo =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            if (timer === null) timer = window.setTimeout(scan, CHAPTER_FRAME_RESCAN_MS)
          })
    mo?.observe(root, { childList: true, subtree: true })
    return () => {
      mo?.disconnect()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [entry.id, meta])

  // 換頁後（首次載入不算）：焦點移到本頁 h1、播報「已切換到：標題」。
  // 延後到下一個 macrotask，讓 Layout 先把抽屜的 inert 拿掉（否則 inert 裡的元素 focus() 無效）。
  useEffect(() => {
    if (generation === 0) return
    const id = setTimeout(() => {
      const h1 = articleRef.current?.querySelector<HTMLElement>('h1')
      if (h1) {
        if (!h1.hasAttribute('tabindex')) h1.tabIndex = -1
        h1.focus({ preventScroll: true })
      }
      announce(`已切換到：${entry.title}`)
    }, 0)
    return () => clearTimeout(id)
  }, [generation, entry, announce])

  const isChapter = CHAPTER_GROUPS.includes(entry.group)
  const modeHint = isChapter && modeChosen && (
    <p className="c-mode-hint" data-mode={mode}>
      {MODE_HINT[mode]}
    </p>
  )
  // 章首：本章資訊 strip → 模式提示 → 先備自檢（畫在系統地圖之後的插槽；頁面上沒有圖就畫在內容前面）
  const current = slots && slots.id === entry.id ? slots.slots : null
  const opening = meta && current && (
    <>
      <ChapterInfoStrip entry={entry} meta={meta} handcalcIds={current.handcalcIds} hasSymbols={current.hasSymbols} />
      {modeHint}
      <PrereqCheck items={meta.prereqs} />
    </>
  )
  // 章末：下一章要解決什麼（畫在 #symbols 之前的插槽；沒有 #symbols 就畫在內容後面）
  const handoff = meta && current && <ChapterHandoff next={meta.next} />

  return (
    <article className="page" data-page={entry.id} data-outline={outline ?? undefined} ref={articleRef}>
      <ModePicker />
      {entry.id !== 'dashboard' && (
        <header className="page-header">
          {/* 規格書 §／驗證 T-id 原本是 h1 上方的 eyebrow，現在在系統地圖之後的 ChapterInfoStrip 裡：h1 之後第一個區塊是本章要回答的問題 */}
          <h1 tabIndex={-1}>{entry.title}</h1>
        </header>
      )}
      {/* 本頁目錄：從下面章節的 h2 自動產生（寬螢幕右欄／窄螢幕右下角「目錄」鈕）＋浮動「回到頂端」 */}
      <PageOutline root={articleRef} pageKey={entry.id} onLayout={setOutline} />
      {!meta && modeHint}
      {opening && current && !current.opening && <div className="c-chapter-opening" data-chapter-slot={OPENING_SLOT}>{opening}</div>}
      {opening && current?.opening && createPortal(opening, current.opening)}
      <ErrorBoundary key={entry.id}>
        <PageContent Page={Page} />
      </ErrorBoundary>
      {handoff && current && !current.handoff && <div className="c-chapter-handoff-slot" data-chapter-slot={HANDOFF_SLOT}>{handoff}</div>}
      {handoff && current?.handoff && createPortal(handoff, current.handoff)}
      {/* 貼上的 ?f=／?a= 深連結：頁面載好後捲到目標（連結元件自己會處理點擊；這裡只管手打或複製的網址） */}
      <AnchorDeepLink />
      <nav className="page-pager" aria-label="章節導覽">
        {prev ? <Link to={prev.path}>← {prev.nav}</Link> : <span />}
        {next ? <Link to={next.path}>{next.nav} →</Link> : <span />}
      </nav>
    </article>
  )
}
