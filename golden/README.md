# Golden Model（Python 參考實作與 T01–T18 驗證）

本資料夾是網站數值結果的**獨立參考**：以 NumPy / SciPy 從第一原理重新計算規格書 §17 的
Acceptance Reference Values（T01–T18），並輸出 JSON test vectors 給 TypeScript（Vitest）交叉比對。
網站本身是純前端；Python 只用在這裡做回歸測試，不會在瀏覽器執行。

## 1. 安裝與執行

需求：Python 3.12、`numpy>=2`、`scipy>=1.13`、`pytest>=8`（見 `requirements.txt`，沒有其他依賴）。

```bash
# 專案根目錄
pip install -r golden/requirements.txt

python3 -m pytest golden -q                 # 全部 golden 測試（約 10 秒）
python3 -m pytest golden -q -k T05          # 只跑某個 T-id
python3 golden/export_vectors.py            # 重新產生 golden/vectors/*.json
python3 golden/export_vectors.py --check    # 只檢查 vectors 是否與目前模型一致
python3 golden/export_vectors.py --check-web  # 檢查網頁讀的資料 JSON 的結構（src/data/golden/schemas.json，與 TypeScript 的 validate.ts 共用）；不重算任何東西
npm run verify                              # Vitest + pytest → src/data/verification-status.json
```

`npm run golden`、`npm run golden:export` 分別對應前兩個指令。

## 2. 結構

```
golden/
├── lms_pll_golden/          # 依規格章節組織的小型參考實作（純函式）
│   ├── lms.py               # §1–§3  LMS、Sign-Error LMS、mean / mean-square 界限（T01–T03）
│   ├── comparator.py        # §5     1-bit comparator、方向判斷機率（T04–T05）
│   ├── polarity.py          # §6–§7  單頻 / 多頻相關性、Delay Alignment（T06–T07）
│   ├── stability.py         # §8     Calibration PM、更新延遲、雙迴路（T08–T09）
│   ├── mimo.py              # §9–§10 PE、Eigen / SVD、Preconditioner、Jacobian（T10–T11、T18）
│   ├── bias.py              # §11    Offset / INL 固定點偏差（T12）
│   ├── noise.py             # §12    係數雜訊、Calibration BW、Spur（T13–T15）
│   ├── quantization.py      # §13    Freeze / Toggle / Stochastic Rounding / 1st-order ΔΣ、定點 wrap（T16–T17）
│   └── optimizer.py         # §14    E[δ_B²]、Corner-based μ 區間、最佳 μ
├── test_reference_values.py # T01–T18（每個函式名稱含 T-id）＋ 對應的反面測試
├── test_extensions.py       # 其他已推導結論（test_S…）與額外反面測試（test_NEG_…）
├── test_vectors.py          # vectors 格式檢查與「是否與模型同步」
├── export_vectors.py        # 產生 vectors/
├── conftest.py              # sys.path 與固定 seed 的 RNG 工廠
└── vectors/                 # T01.json … T18.json、延伸 vectors、index.json
```

## 3. 測試命名與 verify 對應規則

- **Python**：函式名稱以 `test_T05_` 開頭才算 T05 的驗證（parametrize 的 `[...]` 亦可）。
  `test_S8_3_...`、`test_NEG_...`、`test_vector_schema[...]` 不對應任何 T-id，`verify` 會另列為「未對應」。
- **TypeScript**：`it('T05: ...')`——**title 本身**以 `T05:` 開頭（可寫 `T04/T05: ...`）。
  只在 `describe` 標題或句中提到 T-id 不算（避免 UI 元件測試把 T-id 標成「已驗證」）。
- `scripts/verify.mjs` 判定：任一邊失敗 ⇒ `fail`；兩邊皆有通過 ⇒ `pass`；只有一邊 ⇒ `partial`；都沒有 ⇒ `missing`。
  任一 T-id 為 `fail` 時結束碼非零；`--strict` 另把未對應的失敗、測試檔載入錯誤、缺少報告也視為失敗；
  `--no-run` 只重新解析 `outputs/` 內既有報告。

## 4. 容忍度原則

| 類型 | 作法 |
|---|---|
| 封閉式 | 雙精度等級（abs / rel ≈ 1e-12）；已另以 50 位數 mpmath 抽查（不列為依賴）。 |
| 規格中「≈」的數字 | 依規格列出的位數四捨五入後比對（例如 `round(p, 6) == 0.503989`）。 |
| 數值求根 / 積分 | 與封閉式交叉比對（PM crossover、delay 臨界增益、−3 dB、ENBW、PSD 積分）。 |
| Monte Carlo | 固定 seed（`np.random.default_rng(20261010 + offset)`），容忍度為 ±4 個標準誤、Wilson interval 或四階矩變異 CI；近似式另加明列的模型誤差上限（例如 §14 sign-GMAC 的 2%）。 |

## 5. Vectors 格式（給各章的測試 `src/chapters/chNN/*.test.ts(x)` 與 `src/pages/verification/golden.ts`）

`golden/vectors/index.json` 列出所有檔案。每個 vector：

```json
{
  "id": "T14",
  "description_zh": "…",
  "spec_section": "§12",
  "inputs":   { "fs_hz": 4000000000.0, "N": 4096, "p": 0.9202115439197135 },
  "expected": { "f_u_hz": 976562.5, "bw_neg_ln_p_hz": 12923.83…, "…": "…" },
  "tolerance": { "rel": 1e-10 },
  "tolerance_overrides": { "某個 key": { "abs": 0 } },
  "notes": "…"
}
```

- `expected` 只放**確定性**數值（封閉式、精確 Binomial、數值求根）；值為 number、number 陣列（可巢狀）或 `{re, im}`。沒有 NaN / Infinity。
- 判定規則同 `numpy.isclose`：`|actual − expected| ≤ abs + rel·|expected|`（缺的一項視為 0），陣列逐元素比較；
  `tolerance_overrides` 針對個別 key 覆寫（整數門檻如 `N_exact_odd_95`、`blocks_95`、`period` 為 `abs: 0`）。
- Monte Carlo 結果不放進 vectors（TypeScript 的 RNG 不同）。TS 端請用自己的 seed 做 MC，並以 CI 與 vectors 中的**期望值**比對（例如 T17 的 `mean`、`variance`）。
- TypeScript 不一定要實作每個 key；只比對自己實作的 key 即可，但要在測試名稱寫明 T-id。

TypeScript 讀取範例：

```ts
import { readFileSync } from 'node:fs'

interface Tol { abs?: number; rel?: number }
interface GoldenVector {
  id: string
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: Tol
  tolerance_overrides?: Record<string, Tol>
}

// 各章測試從 repo 根目錄讀（vitest 的 cwd 是 repo 根目錄）：
const load = (name: string): GoldenVector =>
  JSON.parse(readFileSync(join(process.cwd(), 'golden/vectors', `${name}.json`), 'utf8')) as GoldenVector

function expectClose(actual: number, v: GoldenVector, key: string, index?: number) {
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  const raw = v.expected[key]
  const exp = (index === undefined ? raw : (raw as number[])[index]) as number
  expect(Math.abs(actual - exp)).toBeLessThanOrEqual((tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(exp))
}

it('T13: σ_w ≈ 0.399 fs（golden vector）', () => {
  const v = load('T13')
  expectClose(sigmaW(/* … */), v, 'sigma_w_fs')
})
```

## 6. 規格歧義與勘誤（由 golden 測試確認）

| 項目 | 結論 |
|---|---|
| T05 平手 | 規格未定義 `G_N = 0`。CLT 表格（53.2 / 60.0 / 78.8 / 95 / 99%）與「平手算一半」或「奇數 N」的精確 Binomial 一致；「只算嚴格 > 0」在 N=100 只有 49.2%。N=42500 時三種解讀都 ≈ 95%（嚴格 > 為 94.95%）。精確門檻：奇數 N ≥ 42499、偶數嚴格 N ≥ 42750；CLT 連續解 42497.3。 |
| T14 頻寬 | 「約 12.9 kHz」只符合 −ln(p)/(2π)·f_u（12.924 kHz）與精確 −3 dB（12.931 kHz）。規格同時寫的 (1−p)/(2π)·f_u = 12.401 kHz（≈12.4）、one-sided ENBW = 20.29 kHz 都不是 12.9 kHz。 |
| §10.1「反矩陣元素約 ±25」 | 指 M = 0.5R⁻¹ 的元素（25.13 / −24.87）；R⁻¹ 本身約 ±50。 |
| §13.4 一階 EF quantizer | 常數 32.4、round-to-nearest、r[−1]=0 ⇒ 週期 5 的 [32,33,32,33,32]（規格 pattern 的循環位移）；floor 量化恰好得到 [32,32,33,32,33]。常數 32 + p/q 的週期 = q。 |
| §5 E[q] vs K_q·s | erf(0.01/√2) = 0.00797871，K_q·s = 0.00797885，相對差 (s/σ)²/6。 |
| §12.1 σ_η² | 規格近似 1/N；x = ±1 時精確為 (1 − m²)/N，m = E[q]。 |
| §3 vs §0 極性 | §3 用 δ = w − a，§0 用 δ = a − w；Pole 相同。 |

## 7. Ch11b 延伸（DTC INL 校正與噪聲折返；無 T-id）

`lms_pll_golden/dtc_inl.py` 是 `src/simulation/models/dtcInl.ts` 的 NumPy 獨立實作（正規化 code `x ∈ [−1, 1]`、INL `d(x) = d_2x² + d_3x³ + A_s·saw(x)`）；測試 `test_dtc_inl.py` 的函式名稱都是 `test_S11b_*`（規格 §11 的延伸，`verify` 會列為「未對應」）。vectors（`export_vectors.py` 的 Ch11b 區塊，`--check` 一併核對）：

| 檔案 | 內容 | 容忍度 |
|---|---|---|
| `dtc_inl_folding.json` | MASH 1-1-1 正規化 code 的自相關 `(1/48)[6, −4, 1]`、Gaussian–Isserlis 折返位準 `2ΣR² = 35/576`、`6ΣR³ = 5/1024`、線性過程精確式 `121/2880`（`κ_4 = −1/120`、`Σh² = 3/2`）、`d_2 = 20`、`ν_B = 0.01` 的帶內功率；uniform iid 的 `Var(x²) = 4/45` | rel 1e-12 |
| `dtc_inl_segments.json` | 分段 `K = 8`（uniform x）每段的 `λ_k`、pole、`k95`、`τ`、穩態 std；LUT 64 格的 `τ_j`、每格樣本數、`n_eff`、std；LUT 近似誤差 `Δ√(E[d′²]/12)`（`μ = 2`、`σ_v = 10`、`N = 64`） | rel 1e-12；`k95` abs 0 |
| `dtc_inl_basis.json` | monomial／Legendre／normalized Legendre／Chebyshev（`M = 3`、uniform）的 `R`、特徵值、條件數（67.6／7／1／5.9）、2×2 分塊的手算特徵值、LS 最佳解與 mean-field `k95`（`μK_qλ_max = 0.1`） | rel 1e-9 + abs 1e-12；`θ*` abs 1e-9；`k95` abs 0 |

另外在 pytest 內（不進 vectors）：以 2M 個樣本的 MA(2) uniform 過程驗證線性過程精確式（±3%，Gaussian 式高估 1.446 倍）、真的跑 MASH 1-1-1（20 bit、frac 0.618）用 SciPy Welch 量帶內折返功率對精確式（±8%）、LUT Sign-LMS 收斂到 floor + misadjustment（±25%）、LUT 近似誤差封閉式對 200k 格點直接計算（±1%）。

## 8. Ch05 非理想 comparator 與 Ch14 acquisition（無 T-id）

`lms_pll_golden/comparator.py` 附加了遲滯 ±h 與 metastability 決策窗 ε 的模型（`src/simulation/models/comparator.ts` 的獨立實作），測試在 `test_comparator_nonideal.py`；`lms_pll_golden/acquisition.py` 是 `src/simulation/models/acquisition.ts` 的獨立實作（FLL、lock detect、SSPD 單調範圍與 cycle slip、倍頻捕獲 `|Δf̂| < f_ref/2`、校正 enable 條件與狀態機），測試在 `test_acquisition.py`。兩者都由 `export_vectors.py` 輸出，`--check` 與 `--check-web` 一併核對：

| vector | 內容 | 容忍度 |
|---|---|---|
| `comparator_hysteresis.json` | 遲滯的平穩斜率比、記憶因子 `ν`、雜訊因子 `(1+ν)/(1−ν)`、等效 `K_q` 比與所需 `N` 比；metastability 的 `P_meta`、drop 斜率比與每 block 丟掉的樣本數；`h = 30 fs`、`ε = 5 fs` 的 chain 轉移機率 | rel 1e-12 + abs 1e-15 |
| `acquisition_timeline.json` | FLL 收斂週期 `n_c`、`n_FL`；相位鎖定與 settle；lock detect 的 `P_miss`、誤報率與平均偵測週期；cycle slip 的單調範圍與 `Δf` 上限；DTC 工作點；線性與 sine PD 的完整時間線；失鎖與重鎖；倍頻捕獲（`harmonic_*`）、沒有 FLL 時的別名與靜態偏移（`no_fll_*`）、鎖到錯的倍頻（`wrong_harmonic_*`） | rel 1e-9 + abs 1e-12；週期數、block 數、布林與 `k` 為 abs 0 |
