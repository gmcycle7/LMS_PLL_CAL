/**
 * Vitest 'jsdom' project（`src/**\/*.test.tsx`）的 setupFiles。
 *
 * 只放「所有 jsdom 測試都要、而且不改變斷言結果」的東西，全部與記憶體有關：
 *  - 假 Plotly／Mermaid（src/test/mocks/）的 mock.calls 會抓住每次傳進來的 DOM 節點與整組圖資料 ⇒ 每個測試前後清掉呼叫紀錄。
 *    （mock 本身是各檔 opt-in：`vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())`。）
 *  - jsdom selector 引擎的快取 ⇒ `releaseDetachedDom()`（src/test/releaseDom.ts）。
 *  - 網址：ExperimentShell 的分享網址（experimentUrl.ts）會用 history.replaceState 把 `?a=exp-…&p=…&seed=…` 寫進 window.location，
 *    jsdom 的 location 在同一個測試檔的測試之間不會自動還原，下一個測試掛載實驗時又會讀到上一個測試載入的 preset ⇒ 每個測試之後還原成 '/'。
 * afterEach 是 stack 順序（後註冊的先跑），RTL 的自動 cleanup 在測試檔 import 時才註冊，所以會先卸載、這裡後清；
 * 卸載時 Plot 會再呼叫一次 purge，那一筆由下一個測試的 beforeEach 清掉。
 */
import { resetMermaidMock } from './mocks/mermaid'
import { resetPlotlyMock } from './mocks/plotly'
import { releaseDetachedDom } from './releaseDom'

function resetLocation(): void {
  try {
    if (window.location.pathname !== '/' || window.location.search || window.location.hash) window.history.replaceState(null, '', '/')
  } catch {
    /* 沒有 history 的環境（node 專案不會載入這個檔） */
  }
}

function release(): void {
  resetPlotlyMock()
  resetMermaidMock()
  releaseDetachedDom()
}

beforeEach(release)
afterEach(() => {
  release()
  resetLocation()
})
