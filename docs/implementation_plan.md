# Implementation Plan（P0–P5）

主規格：`docs/LMS_PLL_Calibration_Website_Blueprint_ZH_TW.md`（以下稱「規格」）。勘誤：`docs/validation.md`。介面合約：`docs/dev-conventions.md`。

## 架構決策

| 決策 | 選擇 | 理由 |
|---|---|---|
| 執行環境 | **純前端**（React 18 + TypeScript + Vite 6，HashRouter） | 使用者選擇；可直接部署為靜態網站，不需 API 伺服器 |
| 重運算 | Web Worker（`src/workers/sim.worker.ts` 以 `import.meta.glob` 動態呼叫 `src/simulation/models/*.ts` 的純函式） | 拖動滑桿時 UI 不卡；不需中央註冊表，平行開發不衝突 |
| Python | 只做 golden model（`golden/`，NumPy/SciPy + pytest），輸出 `golden/vectors/*.json` 給 Vitest 交叉比對 | 兩種語言獨立實作，同一組測試向量 |
| 圖表 | Plotly（lazy-load） | hover / zoom / reset / PNG / SVG 內建；log 軸、極座標、直方圖 |
| 數學 / 圖 | KaTeX、Mermaid | 規格 §18.4 |
| 驗證狀態 | `npm run verify` → `src/data/verification-status.json` → UI 的 `TestBadge` | 只有 TS + Python 兩邊都通過的 T-id 才顯示 verified（規格 §20.5-5） |

規格 §20.1 建議的 FastAPI 後端因「純前端」決策而**不實作**；其職責（Monte Carlo、PSD、DSM 分析）由 Web Worker 承擔，模型精度要求不變。

## 階段與交付

| Phase | 交付 | 依賴 | 驗收 | 風險 |
|---|---|---|---|---|
| P0 基礎 | Vite/React/TS 專案、路由註冊表、側欄、深淺主題、三種學習模式、共用元件（Tex/Mermaid/Plot/ParamControl/ExperimentShell/報告匯出）、Worker 基礎、`core` 與 `signal` 數值庫 | — | `npm run build`、`npm test` 通過；公式與 Mermaid 正常 | Plotly bundle 大 → lazy-load |
| P1 數學 | Ch01–03、Ch05：LMS Playground、MSE vs MAE、Mean/Mean-Square、Comparator Lab | P0 | T01–T05 通過 | T05 偶數 N 的 tie 定義（見 validation.md） |
| P2 PLL / Stability | Ch04、Ch06–08：方塊圖、Polarity Explorer、Delay/Filtered-x、Phase Margin Lab、Dual-Loop Explorer；`pll.ts`、`blockLms.ts` | P0、P1 | T06–T09 通過；能解釋失穩原因 | CT H(s) 與 DT 相關性混用 → 明確 CT→DT 映射 |
| P3 MIMO / Bias | Ch09–11：PE/Eigen Lab、GOS one-hot gauge、MIMO LMS（Jacobian、Preconditioner）、Bias & INL Lab | P0 | T10–T12、T18 通過 | 近奇異矩陣數值穩定性 |
| P4 Noise / Quantization | Ch12–14：LMS Noise Lab、Code Mixing Lab、Spur、Quantized Gain Lab（freeze / toggle / stochastic / ΔΣ / ΔΣ+dither）、Learning-rate optimizer | P0、P2 | T13–T17 通過；PSD 總功率核對（Parseval） | Noise BW 定義歧義（見 validation.md）；PSD 正規化 |
| P5 Integrated Lab | Unified Calibration Lab（DSM/MASH → DTC → H_PD → comparator → GMAC → gain register → 量化）、FCW sweep、Monte Carlo、報告輸出；Experiment Gallery 12 個 presets；Training Sequence Lab；Sign-off checklist；Formula reference；Papers；Research backlog；驗證狀態頁 | P0–P4 | Presets 可載入／執行／下載；全部警示可見 | 長序列效能 → Worker + 抽樣顯示 |

## 執行方式

1. **規格驗算**（完成中）：9 個章節 agent 以 Python 獨立重算所有公式與數值，懷疑者 agent 逐條反駁 → `docs/validation.md`。
2. **基礎建設**：core / signal / components / golden 平行；之後 system models（pll、dsm、dtc、blockLms）。
3. **章節與頁面**：每章一個 agent（擁有 `src/chapters/chNN/**` 與自己的 model 檔），頁面（lab、gallery、verification…）各一個 agent。
4. **整合與驗證**：build、lint、Vitest、pytest、`npm run verify`、瀏覽器實測（桌面 + 375px 手機、深淺主題、console errors）、對每章做數學正確性審查並修正。

## Definition of Done 對照（規格 §20.5）

1. 本機可啟動網站：`npm install && npm run dev`。
2. 14 章全文、KaTeX 推導、Mermaid 方塊圖。
3. L0–L2 即時互動；L3–L5 有可重現數值範例與擴充介面。
4. Chapter / Experiment / Formula / Tests 互相連結（formula ID、TestBadge、Verification 頁）。
5. T01–T18 機器可執行（Vitest + pytest），通過才標 verified。
6. Presets 可載入、執行、繪圖、下載 CSV/JSON/HTML。
7. Model Assumptions 與 Known Limitations：`docs/assumptions.md`。
8. Research Backlog 頁面，未完成項目不得標成已驗證。

## 完成狀態（2026-10-10）

| Phase | 狀態 | 備註 |
|---|---|---|
| P0 基礎 | 完成 | 路由、主題、三種學習模式、共用元件、Worker、core／signal 數值庫 |
| P1 數學 | 完成 | Ch00–03、Ch05；T01–T05 pass |
| P2 PLL / Stability | 完成 | Ch04、Ch06–08、SSPLL 案例頁；T06–T09 pass |
| P3 MIMO / Bias | 完成 | Ch09–11；T10–T12、T18 pass |
| P4 Noise / Quantization | 完成 | Ch12–14；T13–T17 pass |
| P5 Integrated Lab | 完成（教學等級） | Calibration Lab、Gallery、Verification、Formulas、Sign-off、Models、Papers、Roadmap、手算練習簿；bit-true 定點與事件級 PLL 仍在 Research Backlog |

使用者中途追加並已完成：00 入門課、教學風格規範（微積分起點、逐步 LaTeX 推導、符號表、核心程式碼並排）、SSPLL GOS／PHOS 極性分析與案例頁、「帶入手算」161 題與手算練習簿。

驗證：Vitest 172 檔 3,954 項全過；pytest 147 + 64 項全過；`npm run verify` 18／18 pass；typecheck、lint、build 通過；瀏覽器 DOM 稽核 26 頁（桌面與 375 px）無元件錯誤、無 KaTeX 錯誤、無水平溢出。未完成與限制見 `docs/assumptions.md` §4。
