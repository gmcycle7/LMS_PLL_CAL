/**
 * plotly.js-cartesian-dist-min 的型別：整個 API 都來自 @types/plotly.js
 * （cartesian bundle 只是少註冊了 3D／地圖／polar 等 trace，函式介面相同）。
 * 站內只用 scatter / bar / histogram / heatmap；bundle 裡有哪些 trace 由 plotlyBundle.test.ts 檢查。
 */
declare module 'plotly.js-cartesian-dist-min' {
  import * as Plotly from 'plotly.js'

  export = Plotly
}
