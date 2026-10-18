import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Tex, mathText } from '../Tex'
import { currentRoutePath, formulaDomId, markNavigation, revealAnchor, scrollToElement } from '../links/anchor'
import { SearchIcon } from './SearchButton'
import { collectPageSections, search, type SearchEntry } from './searchCore'
import './search.css'

export type IndexLoader = () => Promise<readonly SearchEntry[]>

/** 預設：第一次開面板才載入資料（公式登錄、presets、勘誤、術語、手算題） */
const defaultLoader: IndexLoader = () => import('./buildIndex').then((m) => m.getStaticIndex())

export interface SearchPaletteProps {
  onClose: () => void
  /** 測試用：換掉靜態索引的載入方式（預設 import('./buildIndex')） */
  loadIndex?: IndexLoader
}

export const SEARCH_PLACEHOLDER = '公式 ID、符號、術語、preset、勘誤編號…（例：ENBW、\\sigma_w、F-12.9、E13）'

/** 修飾鍵／非左鍵的點擊交給瀏覽器（新分頁、另存…） */
function isPlainLeftClick(e: ReactMouseEvent): boolean {
  return !(e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
}

/**
 * 目標就在這一頁時直接捲過去（和 <FormulaLink>／<AnchorLink> 相同：展開 <details>、聚焦、短暫標示、網址寫入 ?f=／?a=）。
 * 只有 ?a= 一個參數的目標才這樣做：還帶著別的參數（?preset=…&a=exp-…、?item=R1&a=…）表示那一頁要收到它才會動作，得走路由。
 * 回傳 false 表示要走路由。
 */
export function revealLocal(e: SearchEntry, pathname: string): boolean {
  if (e.el && e.el.isConnected) {
    if (e.el.id) return revealAnchor(e.el.id, { param: 'a', value: e.el.id })
    scrollToElement(e.el)
    return true
  }
  if (e.kind === 'formula' && revealAnchor(formulaDomId(e.id), { param: 'f', value: e.id })) return true
  const q = e.to.indexOf('?')
  if (q < 0 || e.to.slice(0, q) !== pathname) return false
  const params = new URLSearchParams(e.to.slice(q + 1))
  const a = params.get('a')
  if (a && Array.from(params.keys()).length === 1) return revealAnchor(a, { param: 'a', value: a })
  return false
}

/** 公式速查頁的 ?f=（那裡每條公式都有，還提供「前往」該章） */
export function formulaPageRoute(formulaId: string): string {
  return `/formulas?f=${encodeURIComponent(formulaId)}`
}

/** 路由的路徑部分（去掉 ?…） */
export function routePathOf(route: string): string {
  const q = route.indexOf('?')
  return q < 0 ? route : route.slice(0, q)
}

/**
 * 走路由到了目標頁之後，等 selector 的元素出現再捲過去（和 scrollToElement 相同：展開祖先、聚焦、短暫標示）。
 * 給目標頁自己不處理 ?a= 的情況用（公式速查頁的術語列 .fr-gloss-item[data-term=…]；它用 ?q= 過濾，列是過濾後才出現的）。
 * 讀者中途去了別頁就停；timeoutMs 內沒出現就放棄。回傳取消函式。
 */
export function revealWhenPresent(selector: string, route: string, opts: { intervalMs?: number; timeoutMs?: number } = {}): () => void {
  const { intervalMs = 150, timeoutMs = 20_000 } = opts
  const path = routePathOf(route)
  const t0 = Date.now()
  let timer: number | null = null
  const stop = () => {
    if (timer !== null) window.clearInterval(timer)
    timer = null
  }
  const tick = () => {
    if (currentRoutePath() !== path) return stop()
    const el = document.querySelector<HTMLElement>(selector)
    if (el) {
      stop()
      scrollToElement(el)
      return
    }
    if (Date.now() - t0 >= timeoutMs) stop()
  }
  timer = window.setInterval(tick, intervalMs)
  return stop
}

export interface FallbackOptions {
  intervalMs?: number
  /** 章節畫好（article 裡出現段落 h2）之後再等多久還沒有錨點就改走 fallback */
  graceMs?: number
  /** 章節一直沒畫好（chunk 載不下來）也在這之後放棄、改走 fallback */
  timeoutMs?: number
}

/**
 * 公式走路由到該章之後，確認錨點真的在：章節畫好了（有段落 h2；模式選擇器的不算）卻沒有 #formula-ID
 * ——例如那條公式只在 Engineer／Research 模式顯示，而讀者在 Beginner——就改去 fallbackTo（公式速查頁的 ?f=，用 replace，
 * 上一頁仍回到原來的頁面）。讀者中途去了別頁、或錨點出現了（AnchorDeepLink 會捲過去）就停。回傳取消函式。
 */
export function fallbackWhenMissing(domId: string, route: string, fallbackTo: string, go: (to: string) => void, opts: FallbackOptions = {}): () => void {
  const { intervalMs = 150, graceMs = 600, timeoutMs = 20_000 } = opts
  const path = routePathOf(route)
  const t0 = Date.now()
  let rendered: number | null = null
  let timer: number | null = null
  const stop = () => {
    if (timer !== null) window.clearInterval(timer)
    timer = null
  }
  const tick = () => {
    if (currentRoutePath() !== path) return stop()
    if (document.getElementById(domId)) return stop()
    if (rendered === null) {
      const article = document.querySelector('main article.page')
      const h2 = article && Array.from(article.querySelectorAll('h2')).some((h) => !h.closest('.c-modepicker'))
      if (h2) rendered = Date.now()
    }
    const now = Date.now()
    if ((rendered !== null && now - rendered >= graceMs) || now - t0 >= timeoutMs) {
      stop()
      go(fallbackTo)
    }
  }
  timer = window.setInterval(tick, intervalMs)
  return stop
}

/**
 * 全站搜尋的命令面板（Layout 以 lazy 載入；掛上來就是開著的，關閉 = 卸載）。
 *   - 索引 = 靜態索引（loadIndex，第一次 import）＋ 目前這一頁的 h2（collectPageSections，每次開啟從 DOM 讀）
 *   - 結果依「公式／章節／實驗 preset／勘誤／術語／手算題」分組；標題與 TeX 用 KaTeX 顯示
 *   - 鍵盤：↑↓ 選擇、Enter 前往、Esc 關閉、Tab 只在輸入框與關閉鈕之間循環；輸入框是 combobox，結果是 listbox／option
 *   - Enter：目標在本頁就直接捲過去；否則 navigate(to)（術語：到了公式速查頁再捲到那一列；公式：該章沒有錨點就改去公式速查頁）。
 *     動作延到面板卸載之後，捲動鎖與焦點才不會互相打架
 *   - ≤600px 是全螢幕的 sheet（search.css）
 */
export function SearchPalette({ onClose, loadIndex = defaultLoader }: SearchPaletteProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const uid = useId()
  const listId = `${uid}-list`
  const inputRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const [entries, setEntries] = useState<readonly SearchEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(0)

  // 開啟：鎖住背景捲動、聚焦輸入框
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    inputRef.current?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  // 載入索引：本頁段落在前（空查詢時就是本頁目錄），靜態索引在後
  useEffect(() => {
    let cancelled = false
    loadIndex().then(
      (list) => {
        if (!cancelled) setEntries([...collectPageSections(pathname), ...list])
      },
      () => {
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [loadIndex, pathname])

  const groups = useMemo(() => (entries ? search(entries, deferred) : []), [entries, deferred])
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const total = groups.reduce((n, g) => n + g.total, 0)
  const cur = flat.length ? Math.min(active, flat.length - 1) : -1
  const optId = (i: number) => `${uid}-opt-${i}`

  // 鍵盤移動時讓目前的項目留在可視範圍
  useEffect(() => {
    if (cur < 0) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cur}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [cur, flat])

  const go = useCallback(
    (e: SearchEntry) => {
      onClose()
      // 面板卸載（背景捲動鎖解除、焦點還給開啟者）之後再動作。
      // 走路由時先記一次新的導覽：react-router 的 navigate 不會觸發 hashchange，revealFromRoute 的「同一次導覽只捲一次」
      // 才不會把第二次搜同一條公式當成重複而不捲動。
      window.setTimeout(() => {
        if (revealLocal(e, pathname)) return
        markNavigation()
        navigate(e.to)
        if (e.revealSelector) {
          // 目標頁自己不處理 ?a=（公式速查頁的術語列）：等那個元素出現再捲過去
          revealWhenPresent(e.revealSelector, e.to)
        } else if (e.kind === 'formula') {
          // 公式：到了該章卻沒有這條公式的錨點（只在較高的模式顯示）→ 改去公式速查頁
          fallbackWhenMissing(formulaDomId(e.id), e.to, formulaPageRoute(e.id), (to) => {
            markNavigation()
            navigate(to, { replace: true })
          })
        }
      }, 0)
    },
    [onClose, navigate, pathname],
  )

  const onKeyDown = (ev: ReactKeyboardEvent<HTMLDivElement>) => {
    // 中文輸入法選字中的 Enter／方向鍵不是給面板的
    if (ev.nativeEvent.isComposing) return
    switch (ev.key) {
      case 'Escape':
        ev.preventDefault()
        ev.stopPropagation()
        onClose()
        break
      case 'ArrowDown':
        ev.preventDefault()
        if (flat.length) setActive((cur + 1) % flat.length)
        break
      case 'ArrowUp':
        ev.preventDefault()
        if (flat.length) setActive((cur - 1 + flat.length) % flat.length)
        break
      case 'Enter':
        // 只有輸入框裡的 Enter 是「前往」；關閉鈕上的 Enter 交給按鈕本身（否則會跑去目前選到的結果而不是關閉）
        if (cur >= 0 && ev.target === inputRef.current) {
          ev.preventDefault()
          go(flat[cur])
        }
        break
      case 'Tab': {
        // 焦點只在輸入框與關閉鈕之間循環（結果用 aria-activedescendant，不進 Tab 順序）
        const items: HTMLElement[] = [inputRef.current, closeRef.current].filter((x) => x !== null) as HTMLElement[]
        if (items.length === 0) break
        const first = items[0]
        const last = items[items.length - 1]
        if (ev.shiftKey && document.activeElement === first) {
          ev.preventDefault()
          last.focus()
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault()
          first.focus()
        }
        break
      }
    }
  }

  const typed = deferred.trim().length > 0
  const status = failed
    ? '索引載入失敗'
    : !entries
      ? '索引載入中'
      : typed
        ? total
          ? `符合 ${total} 項`
          : '沒有符合的項目'
        : total
          ? `本頁 ${total} 個段落；輸入關鍵字搜尋全站`
          : '輸入關鍵字搜尋全站'

  let k = 0
  return createPortal(
    <div
      className="c-search-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="c-search" role="dialog" aria-modal="true" aria-label="搜尋全站" onKeyDown={onKeyDown} data-ready={entries ? 'true' : 'false'}>
        <div className="c-search-head">
          <SearchIcon />
          <input
            ref={inputRef}
            type="text"
            className="c-search-input"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-activedescendant={cur >= 0 ? optId(cur) : undefined}
            aria-autocomplete="list"
            aria-label="搜尋公式、章節、preset、勘誤、術語與手算題"
            placeholder={SEARCH_PLACEHOLDER}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          <button type="button" className="c-search-close" onClick={onClose} ref={closeRef}>
            關閉
          </button>
        </div>
        <div className="c-sr-only" role="status" aria-live="polite" aria-atomic="true">
          {status}
        </div>
        <div className="c-search-body" ref={listRef}>
          {failed ? (
            <p className="c-search-empty">索引載入失敗，請重新整理後再試。</p>
          ) : !entries ? (
            <p className="c-search-empty">索引載入中…</p>
          ) : flat.length === 0 ? (
            <p className="c-search-empty">{typed ? '沒有符合的項目。試試公式 ID（F-12.9）、符號（\\sigma_w 或 σ_w）、術語（ENBW）、preset 名稱或勘誤編號（E13）。' : '輸入公式 ID、符號、術語、preset 名稱或勘誤編號。'}</p>
          ) : (
            <div role="listbox" id={listId} aria-label="搜尋結果">
              {groups.map((g) => {
                const hid = `${uid}-g-${g.kind}`
                return (
                  <div role="group" aria-labelledby={hid} key={g.kind} className="c-search-group" data-kind={g.kind}>
                    <div id={hid} role="presentation" className="c-search-group-label">
                      <span>{g.label}</span>
                      <span className="c-search-count">{g.total > g.items.length ? `前 ${g.items.length} 項，共 ${g.total}` : g.total}</span>
                    </div>
                    {g.items.map((e) => {
                      const idx = k++
                      const isActive = idx === cur
                      return (
                        <a
                          key={`${e.kind}:${e.id}`}
                          role="option"
                          id={optId(idx)}
                          data-idx={idx}
                          aria-selected={isActive}
                          className={`c-search-opt${isActive ? ' is-active' : ''}`}
                          href={`#${e.to}`}
                          tabIndex={-1}
                          onClick={(ev) => {
                            if (!isPlainLeftClick(ev)) return
                            ev.preventDefault()
                            go(e)
                          }}
                          onMouseMove={() => {
                            if (!isActive) setActive(idx)
                          }}
                        >
                          <span className="c-search-opt-id">{e.label ?? e.id}</span>
                          <span className="c-search-opt-main">
                            <span className="c-search-opt-title">{mathText(e.title)}</span>
                            {e.tex && (
                              <span className="c-search-opt-tex">
                                <Tex>{e.tex}</Tex>
                              </span>
                            )}
                            {e.detail && <span className="c-search-opt-detail">{mathText(e.detail)}</span>}
                          </span>
                        </a>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="c-search-foot" aria-hidden="true">
          <span>
            <kbd className="c-search-kbd">↑</kbd>
            <kbd className="c-search-kbd">↓</kbd> 選擇
          </span>
          <span>
            <kbd className="c-search-kbd">Enter</kbd> 前往
          </span>
          <span>
            <kbd className="c-search-kbd">Esc</kbd> 關閉
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
