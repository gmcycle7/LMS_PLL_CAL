# LMS × Fractional-N PLL Calibration Lab

**線上網站：<https://gmcycle7.github.io/LMS_PLL_CAL/>**（每次 push 到 `main` 由 GitHub Actions 自動 build 並部署）

繁體中文互動教學網站與校正實驗室：從高中數學的 LMS，一路到 DTC-based Fractional-N PLL 的 Sign-LMS / GMAC 校正、極性、穩定性、Persistent Excitation、MIMO Preconditioning、Bias、Noise → Jitter/Spur、6-bit 量化與 ΔΣ。

- 主規格：[docs/LMS_PLL_Calibration_Website_Blueprint_ZH_TW.md](docs/LMS_PLL_Calibration_Website_Blueprint_ZH_TW.md)
- 規格驗算與勘誤：[docs/validation.md](docs/validation.md)
- 實作計畫：[docs/implementation_plan.md](docs/implementation_plan.md)
- 假設與限制：[docs/assumptions.md](docs/assumptions.md)
- 開發約定（介面合約）：[docs/dev-conventions.md](docs/dev-conventions.md)
- 教學風格規範：[docs/teaching-style.md](docs/teaching-style.md)
- SSPLL GOS/PHOS 極性分析（完整推導）：[docs/analysis/sspll-gos-phos-polarity.md](docs/analysis/sspll-gos-phos-polarity.md)

> 所有晶片數值皆為 **illustrative 示例**，非量測數據；教學模型（L0–L2）不能當成 PLL sign-off 結論。

## 需求

- Node.js ≥ 20（開發時使用 v24）
- Python ≥ 3.10 + NumPy + SciPy + pytest（只用於 golden-model 回歸測試；網站本身不需要 Python）

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

## 網站內容

| 區塊 | 內容 |
|---|---|
| 00–03（Part A） | 入門（黑盒子、手算、為什麼是 e·x）、MSE/MAE/Huber、Gradient Descent 與 Sign-LMS 家族、Mean / Mean-Square / Almost-Sure 穩定性 |
| 04–10（Part B） | DSM→DTC→PD→GMAC 訊號流、1-bit comparator 統計、PLL error transfer 與極性、Delay / Filtered-x、Calibration phase margin 與雙迴路、Persistent Excitation、MIMO preconditioning |
| 07b 案例 | **Subsampling PLL（f_ref 4 GHz、BW 320 MHz、8 相 PMUX + input DTC）中 GOS／PHOS LMS 為何變號**：Type-I／Type-II SSPLL 與 CPPLL 的反號帶、對策（一階差分 regressor、filtered-x、P-only）與互動實驗 |
| 11–14（Part C） | Calibration bias 與 DTC INL、係數雜訊 → PLL jitter/spur、6-bit 量化／limit cycle／ΔΣ、learning rate 與 N 最佳化 |
| 工具頁 | Calibration Lab（整合模擬）、手算練習簿、Experiment Gallery、Sign-off Checklist、Formula & Unit Reference、Papers、Research Backlog、T01–T18 驗證與勘誤 |

每一章的固定結構（見 [docs/teaching-style.md](docs/teaching-style.md)）：系統地圖（標出本章在整個 PLL 校正系統的位置）→ 一個問題 → 先用數字手算 → **方塊圖**（先看訊號怎麼流）→ 一步一步推導（每步附理由，全部 LaTeX）→ 互動實驗 → **帶入手算**（輸入自己的數字，逐步代入；或先自己算再對答案）→ 演算法比較（並排顯示實際執行的程式碼，標出差異行）→ 思考題 → 本課必記 → 本章符號表（放在最後）。

- **方塊圖**：16 個章節頁共 407 張（參考頁另有 24 張），每張都對照該章公式審查過訊號名稱、箭頭方向與加法點的正負號，並在測試中以真正的 Mermaid 渲染。
- **架構約定**（[docs/assumptions.md](docs/assumptions.md) §2a）：DTC 在 reference 輸入端（`Reference clock → DTC → Phase detector`），回授路徑上只有 divider／PMUX（`VCO → Divider → Phase detector`）；LMS 校正迴路的輸入是 PD 的輸出 `e[n]`，也就是送進 loop filter 的同一個節點。全站的方塊圖與文字都照這個接法；`e[n] = (a − w)·x[n] + v[n]` 與所有模型、手算數字、golden vector 不變。
- **帶入手算**：161 題，每題的數值來自實際的模擬函式，並由獨立的 Python 重算驗證過每一步；「手算練習簿」可隨機出題、統計答對率、列印附詳解的練習卷。
- **學習模式**：Beginner／Engineer／Research 共用同一計算核心，只改變呈現深度。
- **可追溯性**：383 條公式有 ID 並彙整在 Formula 頁；218 個 preset 可由 Gallery 載入；每個實驗可下載 JSON／CSV／HTML 報告（含 seed、版本、假設）。

## 驗證狀態（2026-10-11）

| 項目 | 結果 |
|---|---|
| TypeScript 測試（Vitest） | 217 個檔案、5,254 項，全部通過（2026-10-12 架構約定改版後重跑） |
| Python golden（pytest） | `golden/` 147 項 + `analysis/sspll/golden/` 64 項，全部通過 |
| T01–T18（TS 與 Python 兩邊都要過才算 verified） | 18／18 pass |
| 規格書驗算 | 237 項聲明重算，確認 49 項勘誤（[docs/validation.md](docs/validation.md)），網站一律採用修正版本 |
| typecheck／lint／build | 通過 |

## 專案結構

```
src/
├── app/            # 路由註冊表、Layout、主題、學習模式、preset 載入
├── components/     # Tex、Mermaid、Plot、ParamControl、ExperimentShell、報告匯出…
├── chapters/       # ch00–ch14 教學章節（內容 + 互動實驗 + formulas.ts + handcalcs.ts）
├── pages/          # Dashboard、Calibration Lab、手算練習簿、SSPLL 案例、Gallery、Verification、Sign-off、Formulas、Papers、Roadmap、Models
├── simulation/     # 純 TypeScript 數值核心：core / signal / models（不依賴 React）
├── workers/        # Web Worker：重運算（Monte Carlo、PSD、sweep）
└── data/           # presets、勘誤、驗證狀態
golden/             # Python golden model + pytest + vectors/
analysis/sspll/     # SSPLL GOS/PHOS 極性分析：理論、時域模擬、交叉核對與 golden 測試
docs/               # 規格、勘誤、計畫、假設
```
