/**
 * 全站手算題庫（@/app/handcalcs：各章 handcalcs.ts 的彙整，連同它們 solve() 呼叫的模型，約 600 KB gzip）的載入函式。
 *
 * 練習簿的首屏模組（index.tsx 與它靜態 import 的檔案）不能靜態 import '@/app/handcalcs'，否則打包時整份題庫又被併回首屏 chunk
 * （lazyBoundary.test.ts 會檢查）。頁面用 useModule(loadBank) 在背景載入；它同時是 lazy.tsx 裡快取的 key，所以必須是這一個穩定的函式。
 * 測試用 `await preloadModule(loadBank)` 讓題庫在第一次 render 之前就已經可以同步取得。
 */
export const loadBank = () => import('@/app/handcalcs')
