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
