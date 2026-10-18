import { flushSync } from 'react-dom'

/**
 * 列印前的 DOM 準備（配合 print.css）：紙上沒有「點開」這回事，所以 beforeprint 時把收合的內容全部展開，
 * afterprint 時照原樣還原。CSS 沒辦法打開 <details>，React 狀態控制的收合（推導框、思考題解析）更不行，只能在這裡做。
 *
 * 三件事：
 *   1. 展開收合的內容：<details>（加 open 屬性）與 React 狀態控制的按鈕（DISCLOSURE_BUTTONS，點一下，之後再點回去）。
 *   2. Plotly 圖：螢幕上的圖寬是 px（照當時的容器量好），印出來容器變窄了、圖卻不會重畫（列印版面不會觸發 ResizeObserver），
 *      所以給每個圖層 svg 補上 viewBox，print.css 再讓它依頁寬等比縮放。
 *   3. 比頁寬還寬的單一公式片段（KaTeX 的 .base：長公式只能在關係符號／運算符號之間換行，片段本身不能拆）：量好它在螢幕上的寬度
 *      （以自己字級的 em 為單位）與它所在欄位比頁面窄多少，寫成 --c-em／--c-off，print.css 依 100vw（紙上的內容寬）把這個片段的字級縮到放得進去。
 *      量測在 beforeprint 的這一刻做：這時版面還是螢幕版面，而 em 為單位的寬度和紙張大小無關，所以 A4／Letter／橫式都適用。
 *   4. 紙上沒有「捲回去」：章末的「↑ 回到章首」、章內的「↑ 回到 §1」這類按鈕（各章的 class 不同，只有文字一致）標上 data-no-print，print.css 把它們隱藏；
 *      不隱藏的話，最後一個符號表放不下時整頁只剩一顆按鈕（ch13 實測）。
 *   5. 只動「這次列印前我們改過的」：本來就展開的 <details>、本來就有 viewBox 的 svg 不會被還原動到。
 *   6. Ctrl／⌘+P：圖是接近可視範圍才畫的（Mermaid／Plot 聽 beforeprint 才開始畫），但瀏覽器不等非同步的工作，剛開章就按列印時
 *      整章的圖都還是「圖表載入中…」（ch06 實測：13 張 Plotly、26 張 Mermaid 全部沒畫，31 頁印出佔位框）。所以攔下這個快捷鍵：
 *      先送一次 beforeprint 讓所有圖開始畫（只給元件看，不在這裡展開內容），等到沒有佔位框（最多 PRINT_WAIT_MS）再 window.print()；
 *      圖本來就畫好時完全不攔，交給瀏覽器。從選單列印的人仍走原路：沒畫好的圖印出補救說明（print.css）。
 *
 * 還原只用 open 屬性與按鈕點擊，不碰元件自己的 state，但有兩個副作用要處理：
 *   - <details open={…} onToggle={…}> 的元件（ch06 StepBox、ch11 Details、papers Fold…）會把 toggle 事件當成「使用者手動展開／收合」，
 *     記成 manual 狀態，之後切換學習模式就不再自動展開（實測：列印後切到 Engineer，原本會展開的 16 個推導框只剩 1 個）。
 *     toggle 事件是非同步的：Chrome 在同一個 task 裡來回，事件送出時已還原；Firefox／Safari 的 afterprint 在對話框關閉後才來，
 *     事件會在列印期間送出。所以我們改過的 <details> 在列印期間與還原後的一小段時間內（TOGGLE_QUIET_MS）攔掉 toggle 事件，元件看不到。
 *   - 推導框、思考題解析靠「點一下」展開與收回：狀態是 true → false，不是回到「沒手動操作過」。推導框原本依模式預設展開（Research），
 *     列印後它會維持收合；這只影響「列印之後又切到 Research」這個少見的順序，要完全避免得由 Derivation 元件自己提供「強制展開」的出口。
 */

/** React 狀態控制的收合按鈕（aria-expanded="false" 時點一下就展開）：Derivation 的標題列、Quiz 的「看答案與解析」 */
export const DISCLOSURE_BUTTONS = ['.c-derivation-toggle', '.c-quiz button'] as const

const CLOSED_BUTTONS = DISCLOSURE_BUTTONS.map((s) => `${s}[aria-expanded="false"]`).join(',')

/** 我們打開（或剛還原）的 <details>：toggle 事件不送給元件。還原之後再多攔一小段時間，等排隊中的事件送完 */
export const TOGGLE_QUIET_MS = 200
const quiet = new Map<Element, number>() // 計數：預覽重新整理時 beforeprint 會連來好幾次，最後一次還原後才真的放行
function hold(el: Element): void {
  quiet.set(el, (quiet.get(el) ?? 0) + 1)
}
function release(el: Element): void {
  setTimeout(() => {
    const n = (quiet.get(el) ?? 1) - 1
    if (n <= 0) quiet.delete(el)
    else quiet.set(el, n)
  }, TOGGLE_QUIET_MS)
}
function swallowToggle(e: Event): void {
  if (e.target instanceof Element && quiet.has(e.target)) e.stopImmediatePropagation()
}

/**
 * 只在螢幕上有用的「捲回去」按鈕／連結：整個文字就是「↑ 回到章首／頂端／頁首／§數字」、「回到章首／頂端／頁首（↑）」，
 * 或符號表上方的「↑ 回到剛才讀到的地方／閱讀的位置」（ch04、ch12）。
 * 只比對整段文字（不是包含）：「現在回到章首的系統地圖」這種正文、「§7 的 Polarity Explorer」這種跳到別處的導覽都不會被誤藏；
 * 「回到 §3」沒有向上箭頭時可能是句子裡的指引，也不藏。
 */
export const SCROLL_BACK_TEXT = /^\s*(?:[↑⬆]\s*回到\s*(?:章首|頂端|頁首|§\s*[\d.]+|剛才[^\s]{0,6}?(?:地方|位置))|回到\s*(?:章首|頂端|頁首)(?:\s*[↑⬆])?)\s*$/

/** 還沒畫好的圖：Mermaid 的「圖表載入中…」與 Plotly 的佔位框（畫好或失敗時都會消失） */
export const PENDING_FIGURES = '.c-mermaid-loading, .c-plot-placeholder[aria-busy="true"]'
/** 按下 Ctrl／⌘+P 後最多等這麼久讓圖畫完（一章 40 張圖實測 3–6 s）；超過就照印，沒畫好的圖印出補救說明 */
export const PRINT_WAIT_MS = 15000
/** 最後一個佔位框消失後再等一下，讓 Plotly 把圖層畫完、版面排好 */
export const PRINT_SETTLE_MS = 250
const PRINT_POLL_MS = 100

/** 列印快捷鍵：Ctrl+P（Windows／Linux）或 ⌘+P（macOS）；Shift／Alt 的組合是別的功能，不攔 */
export function isPrintShortcut(e: KeyboardEvent): boolean {
  return (e.key === 'p' || e.key === 'P') && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey
}

/** 點按鈕並讓 React 立刻把結果畫出來（不然要等到 beforeprint 處理器結束後的 microtask，之後的 querySelector 看不到新內容） */
function clickNow(button: HTMLElement): void {
  try {
    flushSync(() => button.click())
  } catch {
    // 在 React 的 render／commit 期間被呼叫（例如列印按鈕的 effect）時 flushSync 會丟錯；退回一般的點擊，結果晚一個 microtask 才出現
    button.click()
  }
}

/** 螢幕上比這個寬（px）的 KaTeX 片段才需要檢查放不放得進頁寬：更窄的在常見紙張（A5 的內容寬約 440px）上都放得下，不必替它加行內樣式 */
export const WIDE_BASE_PX = 240

/** 內容盒寬度（不含 padding）；jsdom 沒有版面，回傳 0 */
function contentWidth(el: Element): number {
  const cs = getComputedStyle(el)
  return (el as HTMLElement).clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
}

/**
 * 這個公式片段所在欄位比整個頁面內容窄多少（螢幕上的 px）：列印時頁面內容寬是 100vw，這個片段能用的寬度就是 100vw 減掉它。
 * 獨立公式取 .katex-display 的寬（texblock 的公式編號與間距已經被扣掉了）；行內公式取最近的區塊（表格內的取整張表）。
 */
function indentOf(base: Element): number {
  const display = base.closest<HTMLElement>('.katex-display')
  let room: number
  if (display) {
    room = display.clientWidth
  } else {
    let box = base.closest('p, li, dd, dt, div, td, th, figcaption, summary, h1, h2, h3, h4')
    if (box?.matches('td, th')) box = box.closest('table')
    room = box ? contentWidth(box) : 0
  }
  const page = base.closest('.page')
  const pageWidth = page ? contentWidth(page) : 0
  return room > 0 && pageWidth > room ? pageWidth - room : 0
}

/** 展開 root 底下所有收合的內容、整理 Plotly 圖與過寬的公式片段；回傳還原函式。 */
export function prepareForPrint(root: ParentNode = document): () => void {
  const undo: Array<() => void> = []

  // 1a. 先展開 React 控制的收合：展開後才會出現的內容（例如推導裡的 <details>）下一步一起處理
  const closed = Array.from(root.querySelectorAll<HTMLElement>(CLOSED_BUTTONS))
  for (const button of closed) {
    clickNow(button)
    undo.push(() => {
      if (button.isConnected && button.getAttribute('aria-expanded') === 'true') clickNow(button)
    })
  }

  // 1b. <details>：只記錄「原本是關著、這次由我們打開」的，還原時不動其他的
  for (const d of Array.from(root.querySelectorAll<HTMLDetailsElement>('details:not([open])'))) {
    hold(d)
    d.open = true
    undo.push(() => {
      d.open = false
      release(d)
    })
  }

  // 1c. 「捲回去」按鈕：標記後由 print.css 隱藏（[data-no-print]）；本來就標過的不動
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('button, a'))) {
    if (el.hasAttribute('data-no-print') || !SCROLL_BACK_TEXT.test(el.textContent ?? '')) continue
    el.setAttribute('data-no-print', '')
    undo.push(() => el.removeAttribute('data-no-print'))
  }

  // 2. Plotly 圖：只處理已經畫好（有 svg.main-svg）的圖；還沒畫的是「圖表載入中…」，沒有東西可縮放
  for (const frame of Array.from(root.querySelectorAll<HTMLElement>('.c-plot-frame'))) {
    const layers = Array.from(frame.querySelectorAll<SVGSVGElement>('.svg-container > svg.main-svg'))
    const first = layers[0]
    const w = Number(first?.getAttribute('width'))
    const h = Number(first?.getAttribute('height'))
    if (!first || !(w > 0) || !(h > 0)) continue
    const added: SVGSVGElement[] = []
    for (const svg of layers) {
      if (svg.hasAttribute('viewBox')) continue
      const sw = Number(svg.getAttribute('width'))
      const sh = Number(svg.getAttribute('height'))
      if (!(sw > 0) || !(sh > 0)) continue
      svg.setAttribute('viewBox', `0 0 ${sw} ${sh}`)
      added.push(svg)
    }
    if (added.length === 0) continue
    frame.setAttribute('data-print-fit', '')
    frame.style.setProperty('--c-print-ar', `${w} / ${h}`) // 長寬比：容器的高度由它決定（svg 圖層都是絕對定位）
    frame.style.setProperty('--c-print-w', `${w}px`) // 自然寬度：比頁寬窄的圖維持原大小，只有比頁寬寬的才縮小
    undo.push(() => {
      for (const svg of added) svg.removeAttribute('viewBox')
      frame.removeAttribute('data-print-fit')
      frame.style.removeProperty('--c-print-ar')
      frame.style.removeProperty('--c-print-w')
    })
  }

  // 3. 過寬的公式片段：先全部量完再寫（交錯讀寫會讓每一個片段都重排一次）。方塊圖裡的公式不動：Mermaid 照原寬度量好了節點，縮字會讓文字和節點對不上
  const wide: Array<{ base: HTMLElement; em: number; off: number }> = []
  for (const base of Array.from(root.querySelectorAll<HTMLElement>('.katex-html > .base'))) {
    const width = base.getBoundingClientRect().width
    if (!(width > WIDE_BASE_PX) || base.closest('.c-mermaid')) continue
    const fontSize = parseFloat(getComputedStyle(base).fontSize)
    if (!(fontSize > 0)) continue
    wide.push({ base, em: width / fontSize, off: indentOf(base) })
  }
  for (const { base, em, off } of wide) {
    base.setAttribute('data-print-wide', '')
    base.style.setProperty('--c-em', em.toFixed(2)) // 自己字級的 em 數：寬度 = em × 字級，所以字級 = 可用寬度 / em
    base.style.setProperty('--c-off', `${Math.round(off)}px`)
    undo.push(() => {
      base.removeAttribute('data-print-wide')
      base.style.removeProperty('--c-em')
      base.style.removeProperty('--c-off')
    })
  }

  // 後做的先還原：先把推導裡的 <details> 關回去，再收起推導框本身（反過來的話推導框收起後那些 <details> 已不在 DOM 裡）
  return () => {
    for (const fn of undo.splice(0).reverse()) {
      try {
        fn()
      } catch {
        // 還原是盡力而為：元素已經被 React 拿掉（換頁）時不必處理
      }
    }
  }
}

/**
 * 掛上 beforeprint／afterprint 處理器與 Ctrl／⌘+P 的攔截；回傳解除函式（會順便還原、取消等待中的列印）。
 * Chrome 的預覽每次改設定都會再觸發一次 beforeprint，所以重複進來時先還原上一輪再重做，不會疊加。
 */
export function installPrintPrep(target: Window = window): () => void {
  let restore: (() => void) | null = null
  const finish = () => {
    restore?.()
    restore = null
  }
  // priming：我們自己送出的 beforeprint（只是叫圖開始畫），這一輪不展開內容
  let priming = false
  const start = () => {
    if (priming) return
    finish()
    try {
      restore = prepareForPrint(target.document)
    } catch {
      // 列印準備失敗不應該擋住列印；沒展開的內容照原樣印
      restore = null
    }
  }

  // Ctrl／⌘+P：有圖還沒畫好時先讓它們畫完再列印（見檔頭第 6 點）
  let waitTimer: ReturnType<typeof setTimeout> | null = null
  const cancelWait = () => {
    if (waitTimer !== null) clearTimeout(waitTimer)
    waitTimer = null
  }
  const pending = () => target.document.querySelector(PENDING_FIGURES) !== null
  const onKey = (e: KeyboardEvent) => {
    if (!isPrintShortcut(e) || e.defaultPrevented) return
    if (waitTimer !== null) {
      e.preventDefault() // 已經在等了：再按一次不重複排程
      return
    }
    if (!pending()) return // 圖都畫好了：交給瀏覽器照常列印
    e.preventDefault()
    priming = true
    try {
      target.dispatchEvent(new Event('beforeprint')) // Mermaid／Plot 聽到它就開始畫
    } finally {
      priming = false
    }
    const deadline = Date.now() + PRINT_WAIT_MS
    const poll = () => {
      if (pending() && Date.now() < deadline) {
        waitTimer = setTimeout(poll, PRINT_POLL_MS)
        return
      }
      waitTimer = setTimeout(() => {
        waitTimer = null
        target.print() // 真正的 beforeprint／afterprint 由瀏覽器接著送來
      }, PRINT_SETTLE_MS)
    }
    waitTimer = setTimeout(poll, PRINT_POLL_MS)
  }

  target.addEventListener('beforeprint', start)
  target.addEventListener('afterprint', finish)
  target.addEventListener('keydown', onKey)
  // toggle 不會冒泡，但捕獲階段會經過 window：在這裡攔下，目標元素上元件自己掛的 onToggle 就收不到
  target.addEventListener('toggle', swallowToggle, true)
  return () => {
    target.removeEventListener('beforeprint', start)
    target.removeEventListener('afterprint', finish)
    target.removeEventListener('keydown', onKey)
    target.removeEventListener('toggle', swallowToggle, true)
    cancelWait()
    finish()
  }
}
