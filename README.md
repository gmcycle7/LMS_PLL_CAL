# LMS × Fractional-N PLL Calibration Lab

**線上網站：<https://gmcycle7.github.io/LMS_PLL_CAL/>**（push 到 `main` 後先跑 CI（型別、lint、單元測試、Python golden、bundle 預算），通過才由 GitHub Actions build 並部署；`deploy.yml` 的 workflow_dispatch 是緊急通道）

繁體中文互動教學網站與校正實驗室：從高中數學的 LMS，一路到 DTC-based Fractional-N PLL 的 Sign-LMS / GMAC 校正、極性、穩定性、Persistent Excitation、MIMO Preconditioning、Bias、Noise → Jitter/Spur、6-bit 量化與 ΔΣ。

- 主規格：[docs/LMS_PLL_Calibration_Website_Blueprint_ZH_TW.md](docs/LMS_PLL_Calibration_Website_Blueprint_ZH_TW.md)
- 規格驗算與勘誤：[docs/validation.md](docs/validation.md)
- 實作計畫：[docs/implementation_plan.md](docs/implementation_plan.md)
- 假設與限制：[docs/assumptions.md](docs/assumptions.md)
- 開發約定（目錄結構、共用元件、測試、審查腳本）：[docs/dev-conventions.md](docs/dev-conventions.md)
- 共用模組 API 與使用注意事項：[docs/dev/infra-api.md](docs/dev/infra-api.md)
- 教學風格規範：[docs/teaching-style.md](docs/teaching-style.md)
- SSPLL GOS/PHOS 極性分析（完整推導）：[docs/analysis/sspll-gos-phos-polarity.md](docs/analysis/sspll-gos-phos-polarity.md)

> 所有晶片數值皆為 **illustrative 示例**，非量測數據；教學模型（L0–L2）不能當成 PLL sign-off 結論。

## 需求

- Node.js ≥ 20（開發時使用 v24）
- Python ≥ 3.10 + NumPy + SciPy + pytest（只用於 golden-model 回歸測試；網站本身不需要 Python）
- Google Chrome（只有下面的「審查腳本」需要；`puppeteer-core` 已列在 devDependencies）

## 啟動

```bash
npm install
npm run dev
```

瀏覽器開啟終端機顯示的網址（預設 http://localhost:5173）。

## 建置靜態網站

```bash
npm run build
npm run preview
```

`dist/` 可直接放到任何靜態主機（使用 HashRouter 與相對路徑，不需伺服器端路由設定）。

## 測試

```bash
npm test                 # Vitest：TypeScript 數值核心、模型與元件
npm run golden           # pytest：Python golden model（T01–T18 與延伸檢查）
npm run golden:export    # 重新產生 golden/vectors/*.json
npm run golden:sspll     # pytest：SSPLL GOS/PHOS 極性分析的 golden
npm run verify           # 兩邊都跑，彙整 src/data/verification-status.json（網站的驗證徽章）
npm run typecheck
npm run lint
```

只有 TypeScript 與 Python 兩邊測試都通過的 T-id，網站才會標示為 verified。

## 審查腳本

jsdom 量不到版面，所以改了畫面（版面、CSS、方塊圖、公式寬度、元件）之後，要用 `scripts/` 的腳本在真正的 Chrome 裡檢查，並**實際看過截圖**。需要先在另一個終端機跑 `npm run dev`；旗標、輸出怎麼讀與「改了畫面要附上哪些檢查」的約定見 [docs/dev-conventions.md](docs/dev-conventions.md) §8。

| 腳本 | 用途 | 一行用法 |
|---|---|---|
| `scripts/screenshots.mjs` | 截圖（頁面頂端、方塊圖、實驗、手算題…；淺色／深色、桌機／手機、三種學習模式） | `node scripts/screenshots.mjs --routes /ch/05 --theme light,dark --shots all-mermaid` |
| `scripts/diagram-audit.mjs` | 量每張方塊圖的自然寬高與超出版面的寬度，抓出畫不出來的圖 | `node scripts/diagram-audit.mjs --routes /ch/05` |
| `scripts/scroll-audit.mjs` | 找出沒有用途的捲軸（方塊圖內、只超出幾 px、為兩三行放的直向捲軸）；`--formulas` 另列比欄位寬的公式 | `node scripts/scroll-audit.mjs --routes /ch/05 --viewport mobile` |
| `scripts/dom-eval.mjs` | 開一頁，在頁面裡執行一段 JS（要 `return`）並印出結果 | `node scripts/dom-eval.mjs 'http://localhost:5173/#/ch/05' 'return document.title'` |
| `scripts/verify.mjs` | 驗證管線：跑 Vitest 與 pytest，依測試名稱中的 T-id 更新 `src/data/verification-status.json` | `npm run verify` |

## 網站內容

| 區塊 | 內容 |
|---|---|
| 00–03（Part A） | 入門（黑盒子、手算、為什麼是 e·x）、MSE/MAE/Huber、Gradient Descent 與 Sign-LMS 家族、Mean / Mean-Square / Almost-Sure 穩定性 |
| 04–10（Part B） | DSM→DTC→PD→GMAC 訊號流、1-bit comparator 統計、PLL error transfer 與極性、Delay / Filtered-x、Calibration phase margin 與雙迴路、Persistent Excitation、MIMO preconditioning |
| 07b 案例 | **Subsampling PLL（f_ref 4 GHz、BW 320 MHz、8 相 PMUX + input DTC）中 GOS／PHOS LMS 為何變號**：Type-I／Type-II SSPLL 與 CPPLL 的反號帶、對策（一階差分 regressor、filtered-x、P-only）與互動實驗 |
| 11、11b、12–14（Part C） | Calibration bias 與 DTC INL、**11b：DTC INL 校正（分段／LUT／多項式基底）與 MASH 噪聲折返**、係數雜訊 → PLL jitter/spur、6-bit 量化／limit cycle／ΔΣ、learning rate 與 N 最佳化 |
| 工具頁 | Calibration Lab（整合模擬）、手算練習簿、Experiment Gallery、Sign-off Checklist、Formula & Unit Reference、Papers、Research Backlog、T01–T18 驗證與勘誤 |

每一章的固定結構（見 [docs/teaching-style.md](docs/teaching-style.md)）：一個問題 → 系統地圖（標出本章在整個 PLL 校正系統的位置）→ 本章資訊（閱讀時間、勘誤、手算題）與先備自檢 → 先用數字手算 → **方塊圖**（先看訊號怎麼流）→ 一步一步推導（每步附理由，全部 LaTeX）→ 互動實驗 → **帶入手算**（輸入自己的數字，逐步代入；或先自己算再對答案）→ 演算法比較（並排顯示實際執行的程式碼，標出差異行）→ 思考題 → 本課必記 → 下一章要解決什麼 → 本章符號表（放在最後）。

- **方塊圖**：16 個章節頁共 409 張（ch00–ch14 與 SSPLL 案例，每頁 20–39 張，含章首的系統地圖），Ch11b 另有 7 張，參考頁（Dashboard、Models、Verification、Lab、Workbook、Gallery、Sign-off、Formulas、Papers、Roadmap）另有 41 張；數量是 Research 模式、展開所有收合區塊後，以 `scripts/diagram-audit.mjs` 逐頁實測的結果（Beginner／Engineer 模式下較少）。每張都對照該章公式審查過訊號名稱、箭頭方向與加法點的正負號，並在測試中以真正的 Mermaid 渲染。
- **架構約定**（[docs/assumptions.md](docs/assumptions.md) §2a）：DTC 在 reference 輸入端（`Reference clock → DTC → Phase detector`），回授路徑上只有 divider／PMUX（`VCO → Divider → Phase detector`）；LMS 校正迴路的輸入是 PD 的輸出 `e[n]`，也就是送進 loop filter 的同一個節點。全站的方塊圖與文字都照這個接法；`e[n] = (a − w)·x[n] + v[n]` 與所有模型、手算數字、golden vector 不變。
- **帶入手算**：173 題，每題的數值來自實際的模擬函式，並由獨立的 Python 重算驗證過每一步；「手算練習簿」可隨機出題、統計答對率、列印附詳解的練習卷。
- **學習模式**：Beginner／Engineer／Research 共用同一計算核心，只改變呈現深度。
- **站內搜尋**：頂列的 🔍 鈕（快捷鍵 `/`、⌘K／Ctrl+K）可搜尋公式、章節、實驗 preset、勘誤、術語與手算題；索引在第一次開啟時才載入。
- **可追溯性**：407 條公式有 ID 並彙整在 Formula 頁（分佈在 25 個頁面；精確／近似／研究假說的條數由 Formula 頁的簡介即時顯示）；228 個 preset 可由 Gallery 載入；每個實驗可下載 JSON／CSV／HTML 報告（含 seed、版本、假設）。

## 驗證狀態（2026-10-12）

| 項目 | 結果 |
|---|---|
| TypeScript 測試（Vitest） | 287 個檔案、6,540 項，全部通過（2026-10-19 wave 4 重跑；node 與 jsdom 兩個 project） |
| Python golden（pytest） | `golden/` 149 項 + `analysis/sspll/golden/` 64 項，全部通過 |
| T01–T18（TS 與 Python 兩邊都要過才算 verified） | 18／18 pass |
| 規格書驗算 | 237 項聲明重算，確認 49 項勘誤（[docs/validation.md](docs/validation.md)），網站一律採用修正版本 |
| typecheck／lint／build | 通過 |
| 外部技術審查（Codex，25 點） | 逐項重現、修正並驗收，紀錄在 [docs/reviews/2026-10-12-codex-review-results.md](docs/reviews/2026-10-12-codex-review-results.md) |

上表的測試數量是 2026-10-12 最後一次完整執行（`npm run verify`，Vitest 與 pytest 都跑完）的結果。公式、preset、手算題、勘誤的數量與 T-id 狀態由 `src/data/docsFacts.test.ts` 對照本檔，站內容增減卻忘了改這裡時測試會失敗；測試檔案數與測試項數不會被自動核對，重新跑完整測試後要手動更新。

## 專案結構

```
src/
├── app/            # 路由註冊表、Layout、主題、學習模式、preset 與手算題的彙整
├── components/     # Tex、Mermaid、Plot、ParamControl、ExperimentShell、HandCalc、SystemMap、報告匯出…
├── chapters/       # ch00–ch14 與 ch11b 教學章節（內容 + 互動實驗 + formulas.ts + handcalcs.ts + diagrams.ts + 測試）
├── pages/          # Dashboard、Calibration Lab、手算練習簿、SSPLL 案例、Gallery、Verification、Sign-off、Formulas、Papers、Roadmap、Models
├── simulation/     # 純 TypeScript 數值核心：core / signal / models（不依賴 React）
├── workers/        # Web Worker：重運算（Monte Carlo、PSD、sweep）
├── data/           # presets、勘誤、驗證狀態、SSPLL 分析資料
└── styles/         # 全站樣式與 design token
golden/             # Python golden model + pytest + vectors/
analysis/sspll/     # SSPLL GOS/PHOS 極性分析：理論、時域模擬、交叉核對與 golden 測試
scripts/            # verify.mjs（驗證管線）與審查腳本
docs/               # 規格、勘誤、計畫、假設、風格規範、開發文件
```
