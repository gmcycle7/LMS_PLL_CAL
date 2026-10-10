# 開發約定（Dev Conventions）

本文件是所有開發者／agent 共用的介面合約。主規格是 `docs/LMS_PLL_Calibration_Website_Blueprint_ZH_TW.md`；規格中的勘誤以 `docs/validation.md` 為準。

## 0. 架構總覽

- **純前端**：React 18 + TypeScript + Vite 6，`HashRouter`（可直接部署成靜態網站）。所有模擬都在瀏覽器執行；重運算（Monte Carlo、長序列 PSD、sweep）放進 Web Worker。
- **Python 只做 golden model**：`golden/` 內的 pytest 以 NumPy/SciPy 獨立計算 T01–T18 等參考值，並輸出 `golden/vectors/*.json`；Vitest 讀這些 JSON 與 TypeScript 實作交叉比對。
- **數值核心與 UI 分離**：`src/simulation/**` 不得 import React 或 DOM；UI 只呼叫 simulation 函式。任何曲線都必須由公式或 simulation 產生，禁止手寫假資料。
- 路徑別名：`@/` → `src/`。

```
src/
├── app/                 # Layout / Routing / Theming / registry.ts（頁面註冊表）
├── components/          # 共用 UI 元件（見 §2）
├── chapters/chNN/       # 每章一個資料夾，index.tsx default export
├── pages/<name>/        # dashboard, models, verification, lab, gallery, signoff, formulas, papers, roadmap
├── experiments/<id>/    # 可被多頁重用的互動實驗 controller（選用）
├── simulation/
│   ├── core/            # rng, special, complex, poly, linalg, stats, units
│   ├── signal/          # fft, window, psd, filter, corr
│   └── models/          # lms, comparator, pll, dsm, dtc, quantizer, blockLms, stability, noise, mimo, bias, optimizer
├── workers/             # Web Worker 進入點與任務註冊
├── data/                # presets/*.json、formulas.ts、verification-status.json
└── tests/               # 跨模組整合測試
golden/                  # Python golden model + pytest + vectors/
```

## 1. 檔案所有權（平行開發時避免衝突）

- 每個章節 agent 只能修改：`src/chapters/chNN/**`、自己負責的 `src/simulation/models/<model>.ts`（與其 `.test.ts`）、`src/experiments/<自己的 id>/**`、`src/data/presets/<自己的 id>*.json`。
- **不要修改** `src/app/**`、`src/components/**`、`src/simulation/core/**`、`src/simulation/signal/**`、`src/styles/global.css`、`package.json`。若需要新共用功能，在自己的檔案內實作 private helper，並在最終回報中列出「建議上移到共用層」。
- 章節專屬樣式：`src/chapters/chNN/chapter.css`（class 名稱加 `chNN-` 前綴）。

## 2. 共用 UI 元件（`src/components/`，由 `@/components` 匯出）

| 元件 | 用途 | 主要 props |
|---|---|---|
| `Tex` | 行內 KaTeX | `children: string`（TeX 原始碼） |
| `TexBlock` | 獨立公式（display mode），可帶 `id`（formula ID，例如 `F-3.1`） | `children: string; id?: string; label?: string` |
| `Mermaid` | Mermaid 方塊圖，跟隨深淺主題 | `chart: string; caption?: string` |
| `Plot` | Plotly 圖表封裝：hover、zoom、reset、下載 PNG/SVG/CSV；跟隨主題；lazy-load plotly | `data: Partial<Plotly.Data>[]; layout?: Partial<Plotly.Layout>; height?: number; csvName?: string; title?: string; xLog?/yLog?` |
| `ParamControl` | 滑桿 + 數字輸入（可精確輸入 0.00001）+ 單位 + 合法範圍 + 對應 Hardware Reg / Behavioral Parameter；可 log 刻度 | `label; value; onChange; min; max; step; unit?; log?; hint?; reg?; digits?` |
| `SelectControl` / `ToggleControl` | 下拉、開關 | `label; value; onChange; options` |
| `ClaimTag` | 規格 §0.1 三層結論標籤 | `kind: 'exact' \| 'approx' \| 'research'`，顯示「精確｜指定模型」「近似｜需驗證」「研究假說／延伸」 |
| `ModelLevel` | L0–L6 模型層級徽章 | `level: 'L0'…'L6'` |
| `SourceTag` | illustrative / simulation / literature / measured | `kind` |
| `Callout` | 提示框 | `kind?: 'info' \| 'warn' \| 'danger' \| 'ok'; title?` |
| `Derivation` | 可展開的推導面板，含 Derivation / Symbols / Units / Assumptions / Model Level 分頁 | `title; derivation: ReactNode; symbols?; units?; assumptions?; level?` |
| `Section` | 章節段落，提供規格 §18.4 的「直覺 → 圖 → 公式 → 範例 → 探索 → 注意假設」標記 | `kind: 'intuition' \| 'diagram' \| 'formula' \| 'example' \| 'explore' \| 'assumptions'; title?` |
| `MetricTable` | 指標表：名稱、數值、單位、公式 ID、標籤、與解析值的差距 | `rows: MetricRow[]` |
| `ExperimentShell` | 互動實驗外框（見 §3） | 見下 |
| `TestBadge` | 顯示某 T-id 的驗證狀態（來自 `src/data/verification-status.json`） | `id: 'T01'…` |
| `ModeGate` | 依學習模式顯示（`@/app/settings`） | `min: 'beginner' \| 'engineer' \| 'research'` |

學習模式：`useSettings().mode` / `atLeast('engineer')`。三種模式**共用同一計算核心**，只改變呈現（例如 Beginner 隱藏 Derivation 預設展開、Research 顯示更多指標）。

## 3. 互動實驗規範（規格 §19）

`ExperimentShell` props（概要）：

```ts
interface ExperimentShellProps {
  id: string                       // 例如 'lms-playground'
  title: string
  level: ModelLevel                // L0–L6
  claim?: ClaimKind                // 主要結論標籤
  source?: SourceKind              // 預設 'illustrative'
  tests?: string[]                 // 對應 T-id
  assumptions: string[]            // 顯示並寫入報告
  controls: ReactNode              // 參數面板
  children: ReactNode              // 圖表與結果
  params: Record<string, unknown>  // 目前參數（匯出 JSON / 報告用）
  seed?: number; onSeedChange?(s: number): void
  units?: Record<string, string>
  metrics?: MetricRow[]
  warnings?: string[]              // 例如 C<=0 的 polarity 警告，必須顯示
  crossCheck?: { analytic: Status; monteCarlo: Status; fixedPoint: Status }  // Status = 'ok' | 'mismatch' | 'not-implemented' | 'n/a'
  actions?: { onReset?(); onStep?(); onRun?(); onRunToConvergence?(); onFreeze?(); running?: boolean; frozen?: boolean }
  exportData?: () => Record<string, number[]>   // CSV 欄位
  presets?: { name: string; params: Record<string, unknown> }[]; onLoadPreset?(p): void
}
```

必做：
1. 每個滑桿都能數字精確輸入，顯示單位與合法範圍。
2. 隨機一律用 `createRng(seed)`，同 seed 可重現；顯示「模擬條件摘要」。
3. 無解或失穩時**解釋原因**（例如 `C ≤ 0` → polarity 問題；`λ_min = 0` → 不可辨識），不要只寫「無法計算」。
4. Analytic / Monte Carlo / Fixed-Point 交叉比對：未實作者明確顯示 `Not implemented`。
5. 可下載 JSON（參數 + 指標 + seed + 版本 + 假設）、CSV（資料）、HTML 報告。
6. 不要每次拖動滑桿就重跑數百萬點：用 `useDeferredValue`、debounce 或 Worker。

## 4. 模擬核心 API（`src/simulation/core`、`src/simulation/signal`）

```ts
// core/rng.ts —— xoshiro128** + splitmix32 seeding；Box–Muller Gaussian
createRng(seed: number): Rng
interface Rng { uniform(): number; normal(): number; normalArray(n: number, sigma?: number): Float64Array;
  sign(): 1 | -1; int(lo: number, hiInclusive: number): number; bernoulli(p: number): boolean; fork(label: string | number): Rng; readonly seed: number }

// core/special.ts —— 雙精度等級（相對誤差 < 1e-13）
erf, erfc, normPdf, normCdf /*Φ*/, normInv /*Φ^-1*/, lgamma, betaIncReg(a,b,x), binomPmf(k,n,p), binomCdf(k,n,p)

// core/complex.ts
type Complex = { re: number; im: number }; c(re, im?), cAdd, cSub, cMul, cDiv, cAbs, cArg, cConj, cScale, cExpj(theta), cPolar(r, theta)

// core/poly.ts —— 係數為降冪
polyval(p: number[], x: number): number; polyvalC(p: number[], z: Complex): Complex; polyRoots(p: number[]): Complex[]

// core/linalg.ts —— Matrix = number[][]
identity, zeros, transpose, matMul, matVec, matAdd, matSub, matScale, inv, solve, det, trace,
eigSym(A): { values: number[] /* 由大到小 */; vectors: Matrix /* 第 i 欄對應 values[i] */ },
eigvals(A): Complex[] /* 一般實矩陣：Hessenberg + shifted QR */,
svd(A): { U: Matrix; S: number[]; V: Matrix }, cond(A), spectralRadius(A), pinvReg(A, lambda)

// core/stats.ts
mean, variance(x, ddof=1), std, rms, quantile, histogram(x, bins, range?), meanCI(x, level=0.95), wilsonCI(k, n, level), autocorr(x, maxLag)

// core/units.ts
fmt(x, digits=4), fmtSI(x, unit), db10, db20, wrap180(deg), deg2rad, rad2deg, clamp

// signal/fft.ts
fft(re, im) /*原地，任意長度：2 的冪用 radix-2，否則 Bluestein*/, ifft, nextPow2
// signal/window.ts
hann(n), rectangular(n), blackmanHarris(n), windowStats(w): { coherentGain, enbwBins }
// signal/psd.ts —— 一律回傳 { f: Float64Array, psd: Float64Array, onesided, units, enbwHz }
periodogram(x, fs, opts), welch(x, fs, { nperseg, noverlap, window, onesided=true, detrend='mean' }),
toneFit(x, fs, f0): { amplitudePeak, phase, rmsResidual }  /*已知頻率的 coherent 最小平方擬合*/,
integratePsd(f, psd, fL, fH), findTones(f, psd, opts)
// signal/filter.ts
lfilter(b, a, x, zi?): { y, zf }, class StreamFilter { constructor(b, a); step(x: number): number; reset() },
freqz(b, a, omegas: ArrayLike<number>): Complex[], freqs(b, a, w): Complex[], bilinear(b, a, fs, prewarpHz?),
impulseResponse(b, a, n)
// signal/corr.ts
xcorrAtLag(x, y, lag), xcorr(x, y, maxLag)
```

## 5. 單位與極性約定（規格 §0 + `docs/validation.md`）

- 時間誤差預設 **fs**；相位用 **rad**；兩者不可混用，換算處要寫明 `2π f_out`。
- `q = sign(e) ∈ {+1, −1}`；硬體 0/1 先映射 `q = 2b − 1`。
- `δ` 的極性：每段公式旁註明 `δ = a − w` 或 `δ = w − a`（規格前後不一致，見 validation.md）。
- 時間索引：`n` = comparator sample，`k` = GMAC block，`m` = PVT tracking。
- PSD：預設 one-sided，`ℒ(f) = 10 log10(S_φ^(1)(f)/2)`；PSD 圖要標示 window、segment、ENBW、one/two-sided。
- 所有例子預設 `SourceTag kind="illustrative"`。

## 5.1 公式登錄與 Presets（彙整頁自動收集，不需中央清單）

- 每章 `src/chapters/chNN/formulas.ts`：`export const FORMULAS: FormulaEntry[]`（型別在 `@/data/types`）。ID 格式 `F-<章>.<序>`，例如 `F-03.2`；章內 `TexBlock id` 使用同一 ID。Formula & Unit Reference 頁以 `import.meta.glob('../../chapters/*/formulas.ts')` 彙整。
- 每個 preset 一個檔：`src/data/presets/<preset-id>.json`（`PresetEntry`）。規格 §19.2 的 12 個 Gallery presets 填 `galleryIndex` 1–12。
- 實驗元件以 `useUrlPreset(experimentId)`（`@/app/presets`）讀取 `?preset=<id>` 並套用參數；`presetsForExperiment(id)` 可餵給 `ExperimentShell` 的 presets 下拉。

## 6. 測試

- Vitest：`src/**/*.test.ts(x)`。數值測試用 `toBeCloseTo` 或相對誤差斷言；Monte Carlo 用固定 seed + 信賴區間。
- 每個 T-id 至少一個以 `T01:` 開頭命名的測試（`it('T01: ...')`），`scripts/verify.mjs` 依此彙整 `src/data/verification-status.json`。
- Golden 交叉比對：`src/tests/golden.test.ts` 讀 `golden/vectors/*.json`。
- 反面測試（規格 §17 末段）：極性反轉、缺乏 PE、Code misalignment、N 改變卻忘記 scaling、定點 overflow、錯誤位元符號、路徑混淆、aliasing。

## 7. 語言與文字

- 介面與說明以繁體中文為主，保留精確英文術語（GMAC、Sign-Error LMS、Persistent Excitation…）。
- 不得寫「LMS 一定穩定」；必須說明是平均收斂、均方穩定、機率性有界、局部線性穩定或全域非線性。
- 不得把未完成功能標成已驗證；未實作 = 明確顯示 `Not implemented` / `pending`。
