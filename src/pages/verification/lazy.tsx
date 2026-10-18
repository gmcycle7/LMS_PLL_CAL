/**
 * 工具型頁面（/workbook、/gallery、/verification）共用的「延後載入」小工具。
 *
 * 這三頁原本靜態 import 全站資料與整份原始碼（所有章節的手算題、全部 preset、?raw 的模型原始碼、golden vectors…），
 * 首次載入要下載 700–850 KB（gzip）才畫得出第一個字。這裡提供兩個工具把它們移出首屏：
 *   - NearGate：子元件（通常是 React.lazy 的元件）要等占位區接近可視範圍才掛載，所以只在使用者捲過去時才下載。
 *   - useModule：頁面資料（動態 import 的模組）在背景載入，載入前回傳 null，頁面先畫出不依賴資料的部分。
 *
 * 規則（測試 lazyBoundary.test.ts 會檢查）：被 NearGate 包住的元件、以及 useModule 載入的模組，
 * 不能被頁面的首屏模組「靜態」import，否則打包時又會被併回首屏 chunk。
 *
 * 目前放在 verification/ 只是因為三頁都用得到；若其他頁面也要用，應整份搬到 src/components/。
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type ComponentType, type LazyExoticComponent, type ReactNode, type RefObject } from 'react'
import { useInRouterContext, useLocation } from 'react-router-dom'
import { importWithRetry } from '@/app/lazyRetry'
import './lazy.css'

/**
 * React.lazy + 失敗復原（部署後舊 hash 404 時重試一次再 reload；見 src/app/lazyRetry.ts）。
 * 不直接用 lazyWithRetry：它的型別限制 `T extends ComponentType`（props 必須是 {}），有必要 props 的元件推不出型別。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 與 React.lazy 的簽名相同：任何 props 的元件都可以
export function lazyPart<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): LazyExoticComponent<T> {
  return lazy(() => importWithRetry(load))
}

/* ───────────────────────── 接近可視範圍 ───────────────────────── */

/**
 * 離可視範圍多遠就開始載入（px）。比 Plot（700）與 Mermaid（800）稍大：
 * 區塊的 chunk 不只要下載、還要執行與排版，慢一點的網路上要在使用者捲到之前就準備好。
 */
export const NEAR_MARGIN_PX = 900

/**
 * 這兩個網址參數（公式 ?f=、頁內錨點 ?a=）指著頁面上的某個位置，但頁面事先不知道它在哪個區塊裡：
 * 網址帶了其中一個，所有 NearGate 都不等捲動、立刻掛載（目標才找得到）。
 * 其他參數只指向特定區塊（例如 /verification 的 ?e= 指向勘誤區）：由那個區塊自己決定要不要 force，
 * 不為它們把整頁的延後區塊一起下載；指向首屏內容的參數（/verification 的 ?t=、/workbook 的 ?hc=）更不需要強制任何區塊。
 */
export const ANCHOR_PARAMS = ['f', 'a'] as const

/** search（'?f=F-05.1&x=1'，有沒有 '?' 都可以）是否帶有 ANCHOR_PARAMS 的任何一個參數 */
export function hasLocatingParam(search: string): boolean {
  const params = new URLSearchParams(search)
  return ANCHOR_PARAMS.some((k) => params.has(k))
}

/** 目前路由的 search；不在 Router 裡（單元測試直接 render 區塊）就是空字串。是否在 Router 裡在元件存活期間不會改變，所以條件式呼叫 hook 是安全的。 */
function useRouteSearch(): string {
  const inRouter = useInRouterContext()
  // eslint-disable-next-line react-hooks/rules-of-hooks -- inRouter 在同一個元件的整個生命期內不變
  return inRouter ? useLocation().search : ''
}

/**
 * ref 指到的元素是否「曾經」接近可視範圍（一旦為 true 就不再變回 false）。
 * force = true、列印（beforeprint）、或環境沒有 IntersectionObserver（jsdom、很舊的瀏覽器）時直接為 true。
 * 收合中的 <details> 裡的元素不會相交，所以收合的推導框不會載入它裡面的東西。
 */
export function useNearViewport(ref: RefObject<Element | null>, force = false, margin = NEAR_MARGIN_PX): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  const near = seen || force
  useEffect(() => {
    const el = ref.current
    if (near || !el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin: `${margin}px 0px` },
    )
    io.observe(el)
    // 列印整頁時，還沒捲到的區塊也要出現（否則印出「載入中…」）
    const onPrint = () => setSeen(true)
    window.addEventListener('beforeprint', onPrint)
    return () => {
      io.disconnect()
      window.removeEventListener('beforeprint', onPrint)
    }
  }, [near, ref, margin])
  return near
}

export interface NearGateProps {
  children: ReactNode
  /** 占位區的最小高度（px）：取該區塊畫完後的典型高度，避免它出現時把下面的內容推走 */
  minHeight?: number
  /** 占位區的文字，例如「Preset Inspector」→「載入 Preset Inspector…」 */
  label?: string
  /** true = 不等捲動，立刻掛載（頁面自己知道這個區塊現在就要用，例如按了「檢視」按鈕） */
  force?: boolean
  /** 區塊種類，寫在占位區的 data-lazy-kind（例如 'exp' = 互動實驗、'code' = 原始碼），讓本頁目錄之類的 DOM 掃描能把還沒掛載的區塊算進去 */
  kind?: string
  className?: string
}

/**
 * 內容取代占位區之後、畫面更新之前：占位區只有 minHeight 高，內容可能高得多（§V.6 占位 3 000 px、內容 33 000 px）。
 * 如果使用者正在看這個區塊「下面」的內容——從本頁目錄跳到 §V.7、頁首的「符號表」連到頁尾——版面長高會把他看的東西往下推好幾萬 px；
 * 瀏覽器的 scroll anchoring 救不了（Chrome 對這次 Suspense 換入實測沒有補償，Safari 沒有這個機制）。
 * 所以自己補：區塊的舊範圍整個在可視範圍上方、或只露出尾巴（舊底邊在視窗內）時，把捲動位置移動同樣的量，使用者看的東西就不動。
 * 使用者正看著占位區本身（頂端在視窗內，或舊範圍蓋住整個視窗）時不動：內容就在原地出現。
 * host 必須已經是最終的樣子（沒有占位的 min-height 與 .small 字級，否則量到的高度不對）。回傳移動的量（測試用）。
 */
export function keepViewBelow(host: HTMLElement, pendingHeight: number): number {
  const r = host.getBoundingClientRect()
  const delta = r.height - pendingHeight
  const oldBottom = r.top + pendingHeight
  if (delta === 0 || r.top >= 0 || oldBottom >= window.innerHeight) return 0
  window.scrollBy(0, delta)
  return delta
}

/** 和 children 一起放在 Suspense 裡：children 真正掛載（內容取代占位文字）的那個 commit 通知 NearGate */
function Mounted({ onMounted }: { onMounted: () => void }) {
  useLayoutEffect(() => onMounted(), [onMounted])
  return null
}

/**
 * 占位區離可視範圍 NEAR_MARGIN_PX 以內才掛載 children（外面再包一層 Suspense，給 React.lazy 的元件用）。
 * 網址帶 ?f=／?a=（ANCHOR_PARAMS）時立刻掛載。占位區本身不含任何錨點：區塊的標題與 id 請放在 NearGate 外面。
 *
 * 同一個 <div> 從頭到尾都在：先是占位區（data-lazy-gate、aria-busy、min-height），內容掛載後變成一層沒有樣式的宿主
 * （.lazy-gate-host；拿掉它 React 會把內容整個重新掛載）。內容到的那一刻由 keepViewBelow 補償捲動位置。
 */
export function NearGate({ children, minHeight = 160, label, force = false, kind, className }: NearGateProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const search = useRouteSearch()
  const near = useNearViewport(hostRef, force || hasLocatingParam(search))
  const [mounted, setMounted] = useState(false)
  // 占位時的高度（內容到了之後要和它比）：在占位區出現、以及開始等 chunk 的那次 render 之後量一次，之後高度不會變。
  // 內容掛載的那個 commit（Mounted 的 layout effect）只把 mounted 設成 true：宿主在那一刻還帶著占位的 .small 字級與 min-height，
  // 量到的內容高度會偏小（§V.6 實測少 3 000 px）；React 會在畫面更新之前同步再 render 一次把它們拿掉，這個 effect 那時才量、才補償。
  const pendingHeight = useRef(0)
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (!mounted) pendingHeight.current = host.getBoundingClientRect().height
    else keepViewBelow(host, pendingHeight.current)
  }, [near, mounted])
  const onMounted = useCallback(() => setMounted(true), [])
  const text = label ? `載入 ${label}…` : '載入中…'
  const pending = !mounted
  return (
    <div
      ref={hostRef}
      className={pending ? `lazy-gate small muted${className ? ` ${className}` : ''}` : 'lazy-gate-host'}
      style={pending ? { minHeight } : undefined}
      aria-busy={pending ? 'true' : undefined}
      data-lazy-gate={pending ? (label ?? '') : undefined}
      data-lazy-kind={pending ? kind : undefined}
    >
      {near ? (
        <Suspense fallback={text}>
          <Mounted onMounted={onMounted} />
          {children}
        </Suspense>
      ) : (
        text
      )}
    </div>
  )
}

/* ───────────────────────── 頁面資料：背景載入的模組 ───────────────────────── */

type Entry<T> = { status: 'pending'; promise: Promise<T> } | { status: 'ok'; value: T } | { status: 'error'; error: unknown }

/** 以載入函式為 key：同一個 loader 只會真的 import 一次（載入失敗時清掉，下次掛載會重試） */
const entries = new WeakMap<object, Entry<unknown>>()

function entryOf<T>(load: () => Promise<T>): Entry<T> {
  let e = entries.get(load) as Entry<T> | undefined
  if (!e) {
    const promise = importWithRetry(load).then(
      (value) => {
        entries.set(load, { status: 'ok', value })
        return value
      },
      (error: unknown) => {
        entries.set(load, { status: 'error', error })
        throw error
      },
    )
    // 沒有人在等的時候也不要產生 unhandled rejection（錯誤會在 useModule 的 render 裡丟出）
    promise.catch(() => undefined)
    e = { status: 'pending', promise }
    entries.set(load, e)
  }
  return e
}

/** 在頁面模組載入時就開始下載（不必等第一次 render）；回傳同一個 promise */
export function preloadModule<T>(load: () => Promise<T>): Promise<T> {
  const e = entryOf(load)
  if (e.status === 'ok') return Promise.resolve(e.value)
  if (e.status === 'error') return Promise.reject(e.error)
  return e.promise
}

/**
 * 背景載入一個動態 import 的模組：載入完成前回傳 null（頁面先畫出不依賴它的部分），完成後重新 render。
 * load 必須是穩定的函式（定義在模組最上層），它同時是快取的 key。載入失敗會在 render 裡丟出，交給外框的 ErrorBoundary（有「重試」）。
 */
export function useModule<T>(load: () => Promise<T>): T | null {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const e = entryOf(load)
  useEffect(() => {
    if (e.status !== 'pending') return
    let alive = true
    const done = () => {
      if (alive) rerender()
    }
    e.promise.then(done, done)
    return () => {
      alive = false
    }
  }, [e])
  if (e.status === 'error') {
    // React 丟出錯誤後會在同一個 task 內立刻重畫一次：那一次仍要看到同一個錯誤（否則會重新 import、永遠到不了 ErrorBoundary，
    // 失敗的載入還會無限重試）。等這個 task 結束再清掉，ErrorBoundary 的「重試」重新掛載時才會真的再 import 一次。
    setTimeout(() => {
      if (entries.get(load) === e) entries.delete(load)
    }, 0)
    throw e.error
  }
  return e.status === 'ok' ? e.value : null
}

/** 測試用：清掉某個 loader 的快取 */
export function resetModuleCache(load: () => unknown): void {
  entries.delete(load)
}
