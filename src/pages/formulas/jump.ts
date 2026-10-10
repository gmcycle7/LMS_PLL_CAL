/**
 * 從公式速查頁「跳到另一頁的公式錨點」。
 *
 * 為什麼需要它：網站用 HashRouter，'#formula-F-12.9' 這種 hash 會被當成路由（找不到頁面），
 * 所以必須先 navigate('/ch/12')，等該頁（lazy chunk）渲染出 <figure id="formula-F-12.9"> 後再自己捲動。
 * 本模組在**模組層級**執行輪詢：公式頁 unmount 之後仍會繼續，直到找到錨點或逾時。
 *   - 找到：展開祖先 <details>、捲到「topbar 高度 + 16 px」的位置、短暫加外框；
 *     之後在 0.35 s / 1 s / 2 s 各檢查一次位置（PageFrame 會在換頁時 scrollTo(0, 0)，圖表載入也會推動版面），
 *     使用者一旦自己捲動（wheel／touch／key）就停止校正。
 *   - 逾時：顯示一個小提示（可能只在 Research 模式顯示，或在收合的推導中），可一鍵切到 Research 並重試。
 * 不依賴任何 CSS 檔案（樣式用 inline），因為目標頁面不一定載入本頁的 CSS。
 */

export interface JumpOptions {
  /** 最長等待時間（ms） */
  timeoutMs?: number
  /** 輪詢間隔（ms） */
  intervalMs?: number
  /** 找不到時可切換學習模式並重試（呼叫後會再等一次） */
  onSwitchMode?: () => void
  /** 目前是否已經是 Research 模式（是的話不顯示「切換」按鈕） */
  isResearch?: boolean
}

export function anchorIdOf(formulaId: string): string {
  return `formula-${formulaId}`
}

let cancelActive: (() => void) | null = null

function topOffset(): number {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')
    const n = parseFloat(v)
    return (Number.isFinite(n) ? n : 52) + 16
  } catch {
    return 68
  }
}

/** 展開 el 的所有祖先 <details>（推導面板、先備知識框） */
export function openAncestors(el: Element): number {
  let opened = 0
  let cur: Element | null = el.parentElement
  while (cur) {
    if (cur instanceof HTMLDetailsElement && !cur.open) {
      cur.open = true
      opened++
    }
    cur = cur.parentElement
  }
  return opened
}

function scrollToEl(el: HTMLElement, smooth: boolean) {
  try {
    const top = el.getBoundingClientRect().top + (window.scrollY || 0) - topOffset()
    if (typeof window.scrollTo === 'function') window.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' })
  } catch {
    /* jsdom 或舊瀏覽器沒有 scrollTo(options)：忽略 */
  }
}

function flash(el: HTMLElement) {
  const prevOutline = el.style.outline
  const prevOffset = el.style.outlineOffset
  const prevRadius = el.style.borderRadius
  el.style.outline = '3px solid var(--accent, #1f5fa8)'
  el.style.outlineOffset = '4px'
  el.style.borderRadius = '6px'
  el.setAttribute('data-jump-target', 'true')
  window.setTimeout(() => {
    el.style.outline = prevOutline
    el.style.outlineOffset = prevOffset
    el.style.borderRadius = prevRadius
    el.removeAttribute('data-jump-target')
  }, 2600)
}

const TOAST_ID = 'fr-jump-toast'

export function removeToast() {
  document.getElementById(TOAST_ID)?.remove()
}

/** 小提示（不依賴 React）。buttons 由呼叫者提供文字與動作。 */
export function showToast(message: string, buttons: { label: string; onClick: () => void }[] = [], ttlMs = 9000) {
  removeToast()
  const box = document.createElement('div')
  box.id = TOAST_ID
  box.setAttribute('role', 'status')
  box.className = 'fr-toast'
  Object.assign(box.style, {
    position: 'fixed',
    left: '50%',
    bottom: '20px',
    transform: 'translateX(-50%)',
    maxWidth: 'min(92vw, 560px)',
    background: 'var(--surface, #fff)',
    color: 'var(--text, #1b2430)',
    border: '1px solid var(--border-strong, #b9c1cd)',
    borderLeft: '4px solid var(--warn, #9a6200)',
    borderRadius: '8px',
    boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
    padding: '10px 14px',
    zIndex: '60',
    fontSize: '0.9rem',
    lineHeight: '1.5',
  } satisfies Partial<CSSStyleDeclaration>)
  const p = document.createElement('div')
  p.textContent = message
  box.appendChild(p)
  const row = document.createElement('div')
  Object.assign(row.style, { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' })
  const all = [...buttons, { label: '關閉', onClick: () => undefined }]
  for (const b of all) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'btn'
    btn.textContent = b.label
    btn.addEventListener('click', () => {
      removeToast()
      b.onClick()
    })
    row.appendChild(btn)
  }
  box.appendChild(row)
  document.body.appendChild(box)
  window.setTimeout(() => {
    if (document.getElementById(TOAST_ID) === box) box.remove()
  }, ttlMs)
}

/**
 * 等待 id 為 anchorId 的元素出現後捲過去。回傳取消函式。
 * 同一時間只有一個跳轉工作；新的工作會取消舊的。
 */
export function waitForAnchor(anchorId: string, label: string, opts: JumpOptions = {}): () => void {
  cancelActive?.()
  const timeoutMs = opts.timeoutMs ?? 5000
  const intervalMs = opts.intervalMs ?? 100
  const t0 = Date.now()
  const timers: number[] = []
  let interval: number | null = null
  let userMoved = false
  let done = false
  const onUser = () => {
    userMoved = true
  }
  const listeners: [string, EventListener][] = [
    ['wheel', onUser],
    ['touchstart', onUser],
    ['keydown', onUser],
  ]
  const cleanup = () => {
    done = true
    if (interval !== null) window.clearInterval(interval)
    for (const t of timers) window.clearTimeout(t)
    for (const [ev, fn] of listeners) window.removeEventListener(ev, fn)
    if (cancelActive === cancel) cancelActive = null
  }
  const cancel = () => cleanup()
  for (const [ev, fn] of listeners) window.addEventListener(ev, fn, { passive: true })

  const realign = (el: HTMLElement) => {
    if (userMoved || done || !el.isConnected) return
    const top = el.getBoundingClientRect().top
    const want = topOffset()
    if (Math.abs(top - want) > 48) scrollToEl(el, false)
  }

  const tick = () => {
    if (done) return
    const el = document.getElementById(anchorId)
    if (el) {
      if (interval !== null) window.clearInterval(interval)
      interval = null
      openAncestors(el)
      scrollToEl(el, true)
      flash(el)
      for (const ms of [350, 1000, 2000]) timers.push(window.setTimeout(() => realign(el), ms))
      timers.push(window.setTimeout(cleanup, 2100))
      return
    }
    if (Date.now() - t0 > timeoutMs) {
      cleanup()
      const buttons =
        opts.onSwitchMode && !opts.isResearch
          ? [
              {
                label: '切換到 Research 模式並重試',
                onClick: () => {
                  opts.onSwitchMode?.()
                  waitForAnchor(anchorId, label, { ...opts, isResearch: true })
                },
              },
            ]
          : []
      showToast(
        `在這一頁找不到公式 ${label} 的錨點：它可能只在 Research 模式顯示、位於尚未展開的區塊，或該章節尚未完成。`,
        buttons,
      )
    }
  }
  interval = window.setInterval(tick, intervalMs)
  timers.push(window.setTimeout(tick, 0))
  cancelActive = cancel
  return cancel
}

/** 公式 ID → 等待並捲到 #formula-<id> */
export function jumpToFormula(formulaId: string, opts: JumpOptions = {}): () => void {
  return waitForAnchor(anchorIdOf(formulaId), formulaId, opts)
}
