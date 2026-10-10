/**
 * Gallery 頁的 Mermaid 圖（diagrams.test.ts 以真正的 mermaid parser 驗證語法）。
 * 節點文字不放數學符號（Mermaid 不渲染 KaTeX）；公式在圖說與內文以 KaTeX 顯示。
 */

/** 一個 preset 的兩條路：左邊到原頁面「載入並執行」，右邊在 Gallery 內用同一組模型函式重算並與預期文字比對 */
export const PRESET_FLOW = `flowchart TD
  J["src/data/presets/id.json<br/>page, experiment, params, expected, tests"] --> A["ALL_PRESETS<br/>import.meta.glob 自動收集"]
  A --> C["Gallery 卡片<br/>標題, 說明, 預期結果, T-id"]
  C -->|"載入並執行"| U["原頁面網址帶 ?preset=id"]
  U --> H["useUrlPreset(experiment)"]
  H --> E["ExperimentShell<br/>完整互動實驗, Monte Carlo 在 Worker"]
  C -->|"即時預覽"| P["previewPreset(preset)"]
  P --> M["src/simulation/models 的同一組函式"]
  E --> M
  M --> N["重算的數值"]
  N --> K{"checkExpected<br/>與預期文字逐項比對"}
  K -->|"每個必備數值都相符"| OK["ok"]
  K -->|"有必備數值找不到"| BAD["mismatch, 顯示哪一個"]
`

/** 三個問題的學習路線（規格 §19.1 的三條路線對應到 12 個 preset） */
export const THREE_QUESTIONS = `flowchart LR
  Q1["問題一 走不走得回來<br/>pole 在單位圓內嗎"] --> S1["preset 1, 3, 4, 5, 6, 12"]
  Q2["問題二 停在哪裡<br/>固定點等於真值嗎"] --> S2["preset 7, 10, 11"]
  Q3["問題三 停下來後抖多大<br/>雜訊與 spur"] --> S3["preset 2, 8, 9"]
  S1 --> R["sign-off<br/>三個問題都要回答"]
  S2 --> R
  S3 --> R
`
