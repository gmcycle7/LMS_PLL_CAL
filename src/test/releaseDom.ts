/**
 * 讓「已卸載的整棵章節 DOM」可以被 GC。
 *
 * 整章在 jsdom 下約 370–400 MB（上千個 KaTeX）。jsdom 的 selector 引擎（nwsapi）替「每一個用過的 selector 字串」快取最後一次查詢的
 * context 與結果節點（selectResolvers／matchResolvers，LRU 1000 筆），所以 `container.querySelector(…)`、`getAllByText`
 * （內部是 `querySelectorAll('*')`）查過的整章 DOM 在卸載後仍被抓住，直到同一個 selector 改在別的 context 上查詢為止。
 * 幾個測試就累積到數 GB，worker 逼近 heap 上限後 GC 空轉（waitFor 逾時），最後 OOM。
 *
 * `releaseDetachedDom()` 清空這兩個快取（不換掉引擎實例：它在 document 上掛了事件監聽，換掉反而整個留著），
 * 再對 document 查詢一次，把「最後查詢的 context」移回 document。碰的是 jsdom 的內部欄位（沒有公開 API 可以清）；
 * 欄位不存在時什麼都不做——只是多佔記憶體，不影響任何斷言。
 * `src/test/setup.jsdom.ts` 在每個 jsdom 測試的前後各呼叫一次（卸載時 Plot 會再呼叫一次 purge，那一筆要等下一個測試開始前才清得到）。
 */
interface SelectorEngineCaches {
  selectResolvers?: { clear?: () => void }
  matchResolvers?: { clear?: () => void }
}

export function releaseDetachedDom(): void {
  for (const sym of Object.getOwnPropertySymbols(document)) {
    const impl = (document as unknown as Record<symbol, unknown>)[sym] as
      | { _nwsapi?: SelectorEngineCaches; _nwsapiDontThrow?: SelectorEngineCaches }
      | null
      | undefined
    if (!impl || typeof impl !== 'object') continue
    for (const engine of [impl._nwsapi, impl._nwsapiDontThrow]) {
      engine?.selectResolvers?.clear?.()
      engine?.matchResolvers?.clear?.()
    }
  }
  document.querySelector('body')
}
