/**
 * 頁內定位的共用函式（FormulaLink／AnchorLink／AnchorDeepLink 共用）。
 *
 * 為什麼不能用一般的 <a href="#id">：本站用 HashRouter，整個 location.hash 都是路由，
 * 例如 '#formula-F-05.1' 會被當成一個不存在的路由而顯示「找不到此頁面」。
 * 所以頁內跳轉一律是「攔截點擊 → 自己捲動 → 用 history.replaceState 把定位參數寫進目前的路由」，
 * 而連結本身的 href 仍是一個真的路由網址（中鍵、複製連結、在新分頁開啟都能用）：
 *   公式：   '#/formulas?f=F-05.1'（公式速查頁，會標示這條公式並提供「前往」）
 *   其他錨點：'#/ch/14?a=ch14-budget'（目前這一頁；載入時由 revealFromRoute 捲過去）
 */

/** 章節頁裡公式的錨點 id（TexBlock 的 id="formula-F-05.1"） */
export function formulaDomId(formulaId: string): string {
  return `formula-${formulaId}`
}

/** 公式連結的 href：公式速查頁的 ?f= 深連結 */
export function formulaHref(formulaId: string): string {
  return `#/formulas?f=${encodeURIComponent(formulaId)}`
}

/** 把 '#/ch/05?f=F-05.1'（有沒有開頭的 # 都可以）拆成路徑與參數 */
function parseRoute(route: string): { path: string; params: URLSearchParams } {
  const raw = route.startsWith('#') ? route.slice(1) : route
  const q = raw.indexOf('?')
  return { path: (q < 0 ? raw : raw.slice(0, q)) || '/', params: new URLSearchParams(q < 0 ? '' : raw.slice(q + 1)) }
}

/**
 * 在 route（'#/ch/05' 或 '/ch/05?x=1'，有沒有開頭的 # 都可以）上設定一個定位參數。
 * 'f'（公式）與 'a'（一般錨點）互斥：設定其中一個會拿掉另一個；其他參數（例如 ?preset=）保留。
 */
export function routeWithParam(route: string, param: 'f' | 'a', value: string): string {
  const { path, params } = parseRoute(route)
  params.set(param, value)
  params.delete(param === 'f' ? 'a' : 'f')
  return `#${path}?${params.toString()}`
}

/** 在這些路由上，?f= 已經有別的意思（公式速查頁拿它當搜尋字串），所以不改網址、載入時也不捲動 */
const ROUTES_WITH_OWN_F = new Set(['/formulas'])

/** 目前網址的路由部分（不含 #），例如 '/ch/05' */
export function currentRoutePath(): string {
  return parseRoute(typeof window === 'undefined' ? '' : window.location.hash).path
}

/** 把定位參數寫進目前的網址（replaceState：不新增歷史紀錄、不觸發路由）。回傳是否真的改了。 */
export function replaceRouteParam(param: 'f' | 'a', value: string): boolean {
  if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') return false
  if (ROUTES_WITH_OWN_F.has(currentRoutePath())) return false
  try {
    const next = routeWithParam(window.location.hash, param, value)
    // 保留 history.state：react-router 把目前這一筆的索引存在裡面
    window.history.replaceState(window.history.state, '', next)
    // 這一頁已經捲到目標了：之後才掛上來的同名連結（例如按 Run 之後出現的指標表）不要再捲一次
    handled = { key: next.slice(1), gen: navGen }
    return true
  } catch {
    return false
  }
}

/** 展開 el 的所有祖先 <details>（Beginner 模式的推導面板、先備知識框預設收合） */
export function openAncestors(el: Element): number {
  let opened = 0
  for (let cur = el.parentElement; cur; cur = cur.parentElement) {
    if (cur instanceof HTMLDetailsElement && !cur.open) {
      cur.open = true
      opened++
    }
  }
  return opened
}

const FLASH_MS = 2400
const flashTimers = new WeakMap<Element, number>()

/** 短暫標示捲到的目標（樣式在 links.css） */
function flash(el: HTMLElement) {
  const prev = flashTimers.get(el)
  if (prev !== undefined) window.clearTimeout(prev)
  el.setAttribute('data-link-target', 'true')
  flashTimers.set(
    el,
    window.setTimeout(() => {
      el.removeAttribute('data-link-target')
      flashTimers.delete(el)
    }, FLASH_MS),
  )
}

/** 固定的 topbar 不要蓋住目標：目標自己沒有 scroll-margin-top 時補一個 */
function ensureScrollMargin(el: HTMLElement) {
  let margin = 0
  try {
    margin = parseFloat(getComputedStyle(el).scrollMarginTop)
  } catch {
    /* 沒有 getComputedStyle（極舊環境）：當作 0 */
  }
  if (!(margin > 0)) el.style.scrollMarginTop = 'calc(var(--topbar-h, 52px) + 16px)'
}

/** 讓目標可以被程式聚焦（螢幕閱讀器會讀出它），但不加入 Tab 順序 */
function focusTarget(el: HTMLElement) {
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
  try {
    el.focus({ preventScroll: true })
  } catch {
    /* 忽略 */
  }
}

function jumpTo(el: HTMLElement) {
  el.scrollIntoView?.({ behavior: 'auto', block: 'start' })
}

/** 目標應該停在視窗頂端下方多少 px（= 它的 scroll-margin-top；沒有就是 topbar + 16） */
function wantedTop(el: HTMLElement): number {
  try {
    return parseFloat(getComputedStyle(el).scrollMarginTop) || 68
  } catch {
    return 68
  }
}

/** 使用者自己動了捲軸的事件：之後就不再校正，不跟使用者搶捲軸 */
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown', 'pointerdown'] as const
const SETTLE_FRAMES_MS = 500
const SETTLE_LATE_MS = [1000, 2000] as const
const SETTLE_END_MS = 2100

let cancelSettle: (() => void) | null = null

/**
 * 捲到目標之後版面還會變：延後渲染的圖（Plotly／Mermaid 在接近視窗時才畫）會長高，把目標推離原位。
 * 所以捲動是「瞬間」的，然後：前 0.5 s 每一個 frame 檢查一次、1 s／2 s 再各檢查一次，偏掉就（瞬間）拉回來。
 * 不用 smooth 捲動：長章節一次捲 5–6 萬 px，動畫要 1.5 s，中途校正會把它截斷、停在錯的位置（實測停在 2.4k px 外）。
 * 使用者一旦自己捲動（wheel／touch／key／拖捲軸）就停止。同一時間只有一個目標在校正。
 */
function settleScroll(el: HTMLElement) {
  cancelSettle?.()
  let userMoved = false
  const timers: number[] = []
  let raf: number | null = null
  const onUser = () => {
    userMoved = true
  }
  for (const ev of USER_SCROLL_EVENTS) window.addEventListener(ev, onUser, { passive: true })
  const cancel = () => {
    for (const t of timers) window.clearTimeout(t)
    if (raf !== null && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(raf)
    raf = null
    for (const ev of USER_SCROLL_EVENTS) window.removeEventListener(ev, onUser)
    if (cancelSettle === cancel) cancelSettle = null
  }
  const check = () => {
    if (userMoved || !el.isConnected) return
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return // 沒有版面（display:none、jsdom）：沒有東西可以校正
    if (Math.abs(r.top - wantedTop(el)) > 2) jumpTo(el)
  }
  if (typeof window.requestAnimationFrame === 'function') {
    const t0 = Date.now()
    const frame = () => {
      raf = null
      if (userMoved || !el.isConnected) return
      check()
      if (Date.now() - t0 < SETTLE_FRAMES_MS) raf = window.requestAnimationFrame(frame)
    }
    raf = window.requestAnimationFrame(frame)
  }
  for (const ms of SETTLE_LATE_MS) timers.push(window.setTimeout(check, ms))
  timers.push(window.setTimeout(cancel, SETTLE_END_MS))
  cancelSettle = cancel
}

/** 捲到 el（扣掉 scroll-margin-top）、展開祖先 <details>、聚焦並短暫標示；之後校正版面晚到造成的位移。 */
export function scrollToElement(el: HTMLElement): void {
  openAncestors(el)
  ensureScrollMargin(el)
  jumpTo(el)
  focusTarget(el)
  flash(el)
  settleScroll(el)
}

export interface RevealOptions {
  /** 找到之後要寫進網址的定位參數（不給就不改網址） */
  param?: 'f' | 'a'
  value?: string
}

/**
 * 本頁有 id 為 domId 的元素就捲過去（並更新網址），回傳 true；沒有就什麼都不做，回傳 false
 * （呼叫端應該讓連結照 href 走，例如跳到公式速查頁）。
 */
export function revealAnchor(domId: string, opts: RevealOptions = {}): boolean {
  if (typeof document === 'undefined') return false
  const el = document.getElementById(domId)
  if (!el) return false
  scrollToElement(el)
  if (opts.param && opts.value) replaceRouteParam(opts.param, opts.value)
  return true
}

/**
 * 等 domId 出現（章節是 lazy 載入、圖表晚一點才畫）再捲過去；回傳取消函式。
 * 捲動之後的位置校正與 scrollToElement 相同（見 settleScroll）。
 */
export function waitAndReveal(domId: string, opts: { timeoutMs?: number; intervalMs?: number; onReveal?: () => void } = {}): () => void {
  const timeoutMs = opts.timeoutMs ?? 6000
  const intervalMs = opts.intervalMs ?? 100
  const t0 = Date.now()
  let interval: number | null = null
  let first: number | null = null
  const cancel = () => {
    if (interval !== null) window.clearInterval(interval)
    if (first !== null) window.clearTimeout(first)
    interval = null
    first = null
  }
  const tick = () => {
    const el = document.getElementById(domId)
    if (el) {
      cancel()
      scrollToElement(el)
      opts.onReveal?.()
    } else if (Date.now() - t0 > timeoutMs) {
      cancel()
    }
  }
  interval = window.setInterval(tick, intervalMs)
  first = window.setTimeout(tick, 0)
  return cancel
}

/* ───────────── 載入時照網址的 ?f= / ?a= 捲動 ───────────── */

/** 導覽世代：頁面載入是 0，之後每次「真的換了網址」（上一頁／下一頁：popstate、hashchange）加一。 */
let navGen = 0
/** 這一次導覽已經處理過的路由（同一頁有好幾個同名連結時只捲一次） */
let handled: { key: string; gen: number } | null = null

/** 記錄「現在換了網址」：之後第一個符合的連結會再捲一次（測試用；頁框若自己導覽也可以呼叫） */
export function markNavigation(): void {
  navGen++
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('popstate', markNavigation)
  window.addEventListener('hashchange', markNavigation)
}

export interface RevealFilter {
  param: 'f' | 'a'
  value: string
}

/**
 * 網址（route = '/ch/05?f=F-05.1'，react-router 的 pathname+search，或 location.hash 去掉 #）帶 ?f=（公式）
 * 或 ?a=（一般錨點）時，等目標出現再捲過去；回傳取消函式，沒有要做的事就回傳 null。
 *
 *   - filter：只在參數正好是這個值時才捲（FormulaLink／AnchorLink 掛上來時用自己的 id 呼叫，
 *     所以複製下來的 '#/ch/05?f=F-05.1' 不需要頁框另外掛元件就會定位）。
 *   - 同一次導覽只捲一次：第一個符合的呼叫之後，其他同名連結（或 AnchorDeepLink）都略過；
 *     上一頁／下一頁（popstate）之後再呼叫會再捲一次。
 *   - 在 react-router 裡，點擊後用 replaceState 寫進去的 ?f= 不會出現在 useLocation() 的 search，
 *     所以之後才出現的連結（例如按 Run 之後的指標表）不會突然把頁面捲走。
 *   - 公式速查頁的 ?f= 是搜尋字串：略過。
 */
export function revealFromRoute(route: string, filter?: RevealFilter): (() => void) | null {
  if (typeof document === 'undefined') return null
  const { path, params } = parseRoute(route)
  if (ROUTES_WITH_OWN_F.has(path)) return null
  const f = params.get('f')
  const a = params.get('a')
  const domId = f ? formulaDomId(f) : a
  if (!domId) return null
  if (filter && params.get(filter.param) !== filter.value) return null
  const key = `${path}?${params.toString()}`
  if (handled && handled.key === key && handled.gen === navGen) return null
  const mine = { key, gen: navGen }
  handled = mine
  let revealed = false
  const cancelWait = waitAndReveal(domId, { onReveal: () => (revealed = true) })
  return () => {
    cancelWait()
    // 還沒捲到就被取消（React StrictMode 在開發模式會把 effect 掛上、拆掉、再掛一次）：把「已處理」讓出來，下一次呼叫才會真的捲
    if (!revealed && handled === mine) handled = null
  }
}
