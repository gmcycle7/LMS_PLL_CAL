/**
 * 第 10 章的方塊圖（docs/teaching-style.md §8）。每張圖一個具名匯出的 Mermaid 原始碼字串，
 * 由 diagrams.test.tsx 以真正的 mermaid parser 解析，並用共用的 renderMermaidForTest（@/components/mermaidTestUtils）在 jsdom 下實際 render 檢查。
 * 圖號（圖 10-1 … 10-N）不寫在這個檔案裡：它等於登錄表 CH10_DIAGRAMS 的順序，正文一律用 <Fig id> / <FigRef id> 取得。
 *
 * 寫圖時的約定（全部由測試把關）：
 *  - 節點文字用 Unicode 數學符號（Mermaid 不渲染 KaTeX）；下標字母一律寫成 `_k`、`_i`（U+2096 之類的下標字母字型支援不齊），數字下標用 ₁₂₃。
 *  - 加法點用全形「＋」：Mermaid 11 會把每個標籤當 Markdown 解析，單獨一個半形 `+`（或 `-`、`*`、`1.` 開頭）會被當成清單，
 *    畫面上變成「Unsupported markdown: list」（共用的 <Mermaid> 會先用 sanitizeMermaidSource 轉換，但本章的原始碼直接寫全形，不依賴它）。減號用 U+2212「−」。
 *  - 極性：δ = a − w（全站約定）；T18 與 Jacobian 的圖改用 ε = w − w*（= −δ），因為 J 是對 w 的斜率，圖說會註明。
 *  - 取樣率：帶 [n] 的訊號每個 comparator sample 一次；帶 _k 的訊號每個 GMAC block 一次。
 *  - 圖內的數字一律由 numbers.ts（模型函式）算出，不手寫。
 */
import type { SystemBlock } from '@/components'
import { fmt } from '@/simulation/core'
import { NUM } from './numbers'

/** 深淺主題都看得清楚的三種標色：focus（本圖主角／改掉的方塊）、warn（出問題的路徑）、ok（沒問題的結果） */
const STYLE = `
  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff
  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff`

/** 圖內數字：有效位數、負號用 U+2212 */
function d(x: number, digits = 4): string {
  return fmt(x, digits).replace(/-/g, '−')
}

const c = NUM.coupling
const r = NUM.rho099
const z = NUM.noise
const t = NUM.t18
const s = NUM.seq
/** 單一 GMAC（R_ii = 1）在一個 block 內的雜訊 RMS：√(1/N) */
const etaRms = 1 / Math.sqrt(z.N)
const fdRow = (ratio: number) => NUM.fd.rows.find((row) => row.r === ratio) ?? NUM.fd.rows[0]

/* ───────────── §10 開頭 ───────────── */

/**
 * P 個 GMAC 共用一個 comparator 的整體架構（P = 3）：comparator 之前每個 sample n 一次，GMAC 之後每個 block k 一次。
 * 藍色 = 三個 GMAC 共用的那一個 comparator。
 */
export const CHART_MIMO_SYSTEM = `flowchart LR
  subgraph PLL["PLL + DTC 的誤差路徑（每個 sample n）"]
    E["e[n] = u₁[n]·δ₁ + u₂[n]·δ₂ + u₃[n]·δ₃ + v[n]"]
  end
  E --> Q["1-bit comparator<br/>q[n] = sign(e[n])"]
  Q -- "q[n]" --> G1["GMAC₁（GOS）<br/>G₁ = (1/N)·Σ q[n]·x₁[n]"]
  Q -- "q[n]" --> G2["GMAC₂（PHOS）<br/>G₂ = (1/N)·Σ q[n]·x₂[n]"]
  Q -- "q[n]" --> G3["GMAC₃（DTC gain）<br/>G₃ = (1/N)·Σ q[n]·x₃[n]"]
  G1 --> M["更新矩陣 M<br/>μ·I / diag / NLMS /<br/>γ·(K_q·R)⁻¹ / regularized"]
  G2 --> M
  G3 --> M
  M --> W["w_(k+1) = w_k + M·G_k<br/>每個 block k 更新一次"]
  W -- "δ = a − w" --> E${STYLE}
  class Q focus`

/* ───────────── §10.1–§10.2：耦合 ───────────── */

/** E[G] ≈ K_q R δ 的訊號流（P = 2）；紅色是交叉耦合路徑 */
export const CHART_COUPLING_PATHS = `flowchart LR
  D1["δ₁ = a₁ − w₁<br/>例：${d(c.delta[0])} fs（w₁ 正確）"]
  D2["δ₂ = a₂ − w₂<br/>例：${d(c.delta[1])} fs"]
  D1 --> R11["× R₁₁ = ${d(c.R[0][0])}<br/>自己的路徑"]
  D2 --> R12["× R₁₂ = ${d(c.R[0][1])}<br/>交叉耦合"]
  D1 --> R21["× R₂₁ = ${d(c.R[1][0])}<br/>交叉耦合"]
  D2 --> R22["× R₂₂ = ${d(c.R[1][1])}<br/>自己的路徑"]
  R11 -- "＋" --> S1(("＋"))
  R12 -- "＋" --> S1
  R21 -- "＋" --> S2(("＋"))
  R22 -- "＋" --> S2
  S1 --> K1["× K_q<br/>comparator 增益"]
  S2 --> K2["× K_q<br/>comparator 增益"]
  K1 --> G1["GMAC₁ 的平均 E[G₁]<br/>例：${d(c.R[0][1])} × K_q × ${d(c.delta[1])} = ${d(c.G1lin)}"]
  K2 --> G2["GMAC₂ 的平均 E[G₂]<br/>例：${d(c.R[1][1])} × K_q × ${d(c.delta[1])} = ${d(c.G2lin)}"]${STYLE}
  class R12,R21 warn
  class G1 focus`

/** 從 comparator 到 GMAC（sample 速率 n → block 速率 k）；兩個 GMAC 共用同一個 q[n] */
export const CHART_SAMPLE_TO_BLOCK = `flowchart LR
  subgraph FAST["sample 速率：每個 n 做一次（block k 之內 w 不變）"]
    direction LR
    U1["u₁[n] × δ₁"] -- "＋" --> SE(("＋"))
    U2["u₂[n] × δ₂"] -- "＋" --> SE
    V(["雜訊 v[n]<br/>RMS = σ_v"]) -- "＋" --> SE
    SE -- "e[n]" --> CMP["1-bit comparator<br/>q[n] = sign(e[n])"]
    CMP -- "q[n]" --> X1["× x₁[n]"]
    CMP -- "q[n]" --> X2["× x₂[n]"]
  end
  subgraph SLOW["block 速率：每 N 個 sample 輸出一次"]
    direction LR
    A1["累加 N 次再 ÷ N"] --> G1["G₁（第 k 個 block）"]
    A2["累加 N 次再 ÷ N"] --> G2["G₂（第 k 個 block）"]
  end
  X1 --> A1
  X2 --> A2${STYLE}
  class CMP focus`

/**
 * 1-bit comparator 的平均輸出是一條 S 曲線（erf）；訊號遠小於雜訊時可以換成一個增益 K_q（F-10.1 推導的第 5–7 步）。
 * 例子取 §10.1 的 δ = (0, 10) fs、這個 sample 的 u₂ = +1：s = 10 fs。
 */
export const CHART_COMPARATOR_GAIN = `flowchart LR
  S["這個 sample 的訊號<br/>s = u₁·δ₁ + u₂·δ₂<br/>例：δ₁ = ${d(c.delta[0])}、δ₂ = ${d(c.delta[1])} fs、u₂ = +1，s = ${d(c.delta[1])} fs"] -- "＋" --> ADD(("＋"))
  V(["雜訊 v<br/>Gaussian，RMS σ_v = ${d(NUM.sigmaV)} fs"]) -- "＋" --> ADD
  ADD -- "e = s + v" --> CMP["1-bit comparator<br/>q = sign(e)，只有 ±1"]
  CMP -- "q" --> AVG["固定 s，對雜訊取平均<br/>E[q | u] = erf(s ÷ (√2·σ_v))<br/>例：${d(c.erfOne)}"]
  AVG -- "|s| 遠小於 σ_v" --> LIN["≈ K_q × s<br/>K_q = √(2/π) ÷ σ_v = ${d(NUM.Kq)} fs⁻¹<br/>例：${d(c.G2lin)}"]
  AVG -- "|s| 遠大於 σ_v" --> SAT["飽和在 ±1<br/>等效增益比 K_q 小"]${STYLE}
  class LIN focus
  class SAT warn`

/**
 * GMAC 雜訊 η_k 的來源（§10.2 的 Cov(η) ≈ R / N）：每個 sample 的乘積 q·x 的共變異 ≈ R（q² = 1），平均 N 個獨立 sample 後 ÷ N。
 * 畫的是匹配模型（x = u，R_x = R）；例子的數字與正文同一個來源（N = 4096、§10.1 的 G₁）。
 */
export const CHART_GMAC_NOISE = `flowchart LR
  subgraph FAST["sample 速率：每個 n 一個乘積"]
    direction LR
    Q["q[n] = ±1<br/>近平衡時幾乎只由雜訊 v[n] 決定"] --> P["乘積 q[n]·x[n]（P 個數）<br/>平均 ≈ K_q·R·δ_k：很小<br/>共變異 ≈ R（因為 q² = 1）"]
    X["GMAC 的 code x[n]<br/>匹配時 x = u，E[x·xᵀ] = R"] --> P
  end
  subgraph SLOW["block 速率：每 N 個 sample 一個 G_k"]
    direction LR
    AVG["平均 N 個獨立的乘積<br/>平均不變，共變異 ÷ N"] --> G["G_k = K_q·R·δ_k + η_k<br/>η_k 的平均是 0，Cov(η_k) ≈ R / N"]
    G --> EX["例：N = ${z.N}、R_ii = 1<br/>每個 GMAC 的雜訊 RMS = 1 ÷ ${Math.sqrt(z.N)} = ${d(etaRms, 3)}<br/>§10.1 的訊號 G₁ = ${d(c.G1lin, 3)}，只有它的 ${d(c.G1lin / etaRms, 2)} 倍"]
  end
  P --> AVG${STYLE}
  class G focus
  class EX warn`

/* ───────────── §10.3：更新矩陣 ───────────── */

/** w_(k+1) = w_k + M·G_k 的迴路（block 速率，每條線都是 P 維向量） */
export const CHART_UPDATE_LOOP = `flowchart LR
  A["a<br/>真實參數"] -- "＋" --> SD(("＋"))
  SD -- "δ_k = a − w_k" --> KR["× K_q·R<br/>comparator 與相關<br/>（= −J）"]
  KR -- "＋" --> SG(("＋"))
  ETA(["GMAC 雜訊 η_k<br/>Cov ≈ R / N"]) -- "＋" --> SG
  SG -- "G_k" --> M["× M<br/>更新矩陣"]
  M -- "＋" --> SW(("＋"))
  SW -- "w_(k+1)" --> Z["z⁻¹<br/>延遲一個 block"]
  Z -- "＋" --> SW
  Z -- "−（w_k）" --> SD${STYLE}
  class M focus`

/** 五種更新矩陣並排（藍色 = 相對於 scalar LMS 改掉的方塊） */
export const CHART_M_VARIANTS = `flowchart LR
  G["GMAC 輸出 G_k<br/>P 個數"]
  G --> M1["Scalar：M = μ·I<br/>每個係數只用自己的 GMAC<br/>大家同一個 μ"]
  G --> M2["Diagonal：M = diag(μ₁ … μ_P)<br/>只用自己的 GMAC<br/>各有各的 μ_i"]
  G --> M3["Full inverse：M = γ·(K_q·R)⁻¹<br/>每個係數用全部 GMAC 的組合"]
  G --> M4["Regularized：M = γ·(K_q·(R + λ_reg·I))⁻¹<br/>先加 λ_reg 再求逆"]
  G --> M5["Sequential：M 只留一個 M_ii<br/>每個 block 只開一個 loop，輪流換 i"]
  M1 --> P1["p_i = 1 − μ·K_q·λ_i<br/>慢模式被 λ_min 卡住"]
  M2 --> P2["只修正各參數功率不同<br/>相關造成的慢模式還在"]
  M3 --> P3["p_i = 1 − γ，每個模式一樣快<br/>雜訊沿慢方向放大 1/λ_min"]
  M4 --> P4["p_i = 1 − γ·λ_i / (λ_i + λ_reg)<br/>速度與雜訊折衷"]
  M5 --> P5["每個階段都是穩定的純量 LMS<br/>誤差可能被先校的參數吸收"]${STYLE}
  class M2,M3,M4,M5 focus`

/** eigen 分解把耦合的 2×2 迴路拆成兩條獨立的一階迴路（scalar LMS、無雜訊平均） */
export const CHART_EIGEN_MODES = `flowchart LR
  D["δ_k<br/>δ₁、δ₂ 互相耦合"] --> VT["× Vᵀ<br/>投影到 eigenvector"]
  VT -- "ξ₁ = (δ₁ + δ₂) / √2<br/>共模" --> L1["× p₁ = 1 − μ·K_q·λ₁<br/>λ₁ = 1 + ρ：快"]
  VT -- "ξ₂ = (δ₁ − δ₂) / √2<br/>差模" --> L2["× p₂ = 1 − μ·K_q·λ₂<br/>λ₂ = 1 − ρ：慢"]
  L1 --> V["× V<br/>轉回參數座標"]
  L2 --> V
  V --> DN["δ_(k+1)"]${STYLE}
  class L1 ok
  class L2 warn`

/**
 * 每個模式的 loop gain = m_i × λ_i；scalar 與完整反矩陣並排（ρ = 0.99、K_q 正規化為 1）。
 * Mermaid 依宣告的相反順序排 subgraph：FU 先宣告，畫面上 Scalar 框在前（上）、Full inverse 框在後（下）；順序由 diagrams.test.tsx 鎖住。
 */
export const CHART_MODE_GAIN = `flowchart LR
  subgraph FU["② Full inverse：M_n = γ·R⁻¹（γ = 0.5）"]
    direction LR
    A3["快模式<br/>λ₁ = ${d(r.eig[0])}"] --> B3["× m₁ = γ / λ₁ = ${d(r.eigMn[1])}"] --> C3["loop gain 0.5<br/>p₁ = 0.5"]
    A4["慢模式<br/>λ₂ = ${d(r.eig[1])}"] --> B4["× m₂ = γ / λ₂ = ${d(r.eigMn[0])}"] --> C4["loop gain 0.5<br/>p₂ = 0.5"]
  end
  subgraph SC["① Scalar：M_n = μK_q·I（μK_q = 0.5）"]
    direction LR
    A1["快模式<br/>λ₁ = ${d(r.eig[0])}"] --> B1["× m₁ = 0.5"] --> C1["loop gain ${d(1 - r.fast)}<br/>p₁ = ${d(r.fast)}"]
    A2["慢模式<br/>λ₂ = ${d(r.eig[1])}"] --> B2["× m₂ = 0.5"] --> C2["loop gain ${d(1 - r.slow)}<br/>p₂ = ${d(r.slow)}"]
  end${STYLE}
  class C2 warn
  class B3,B4 focus
  class C3,C4 ok`

/** 598 與 5 的手算流程（F-10.3 → F-10.5） */
export const CHART_K95_FLOW = `flowchart LR
  R["ρ = 0.99<br/>R = [[1, ρ], [ρ, 1]]"] --> L["eigenvalue<br/>λ = 1 ± ρ = ${d(r.eig[0])}、${d(r.eig[1])}"]
  L --> P["一般 LMS 的慢 pole<br/>p = 1 − μK_q × λ_min<br/>= 1 − 0.5 × ${d(r.eig[1])} = ${d(r.slow)}"]
  P --> K["k₉₅ = ⌈ln 0.05 ÷ ln |p|⌉<br/>= ⌈${d(r.ln005, 5)} ÷ ${d(r.lnSlow, 5)}⌉<br/>= ⌈${d(r.blocksScalarReal, 4)}⌉ = ${r.blocksScalar}"]
  L --> PF["完整反矩陣<br/>p = 1 − γ = 0.5<br/>（不必看 λ）"]
  PF --> KF["k₉₅ = ⌈ln 0.05 ÷ ln 0.5⌉<br/>= ⌈${d(r.blocksFullReal, 4)}⌉ = ${r.blocksFull}"]
  CHK(["先檢查單位<br/>μ 是 fs、K_q 是 fs⁻¹<br/>代進去的必須是 μ × K_q"]) -.-> P${STYLE}
  class K warn
  class KF ok
  class CHK focus`

/* ───────────── §10.4：雜訊代價 ───────────── */

/** 完整反矩陣在一個 eigen-mode 上的迴路；訊號繞一圈增益 γ，雜訊只經過 M（紅色） */
export const CHART_NOISE_PATH = `flowchart LR
  ACC(("＋")) -- "ξ_i（下一個 block）" --> Z["z⁻¹"]
  Z -- "ξ_i（第 k 個 block）" --> S["× K_q·λ_i<br/>GMAC 沿這個方向看到的訊號<br/>慢模式 λ₂ = ${d(r.eig[1])}：很小"]
  S -- "＋" --> SUM(("＋"))
  N(["GMAC 雜訊 ζ_i<br/>Var = λ_i / N"]) -- "＋" --> SUM
  SUM --> M["× γ / (K_q·λ_i)<br/>反矩陣沿這個方向的增益<br/>γ = 0.5 時：慢模式 ${d(r.eigMn[0])} / K_q、快模式 ${d(r.eigMn[1])} / K_q"]
  M -- "−" --> ACC
  Z -- "＋" --> ACC${STYLE}
  class N,M warn`

/** 穩態共變異的迴路（離散 Lyapunov 方程 F-10.15） */
export const CHART_LYAPUNOV = `flowchart LR
  Q(["每個 block 的新雜訊<br/>Cov(η_k) ≈ R_x / N"]) --> MQ["M·(R_x / N)·Mᵀ<br/>經過更新矩陣後注入"]
  MQ -- "＋" --> S(("＋"))
  S -- "X_(k+1)" --> Z["z⁻¹<br/>延遲一個 block"]
  Z -- "X_k = Cov(δ_k)" --> AX["A·X_k·Aᵀ<br/>舊的散布被迴路縮小"]
  AX -- "＋" --> S${STYLE}
  class MQ warn
  class AX ok`

/** 慢模式上三種增益 m 的比較（598 / 5 / 65 與每參數 RMS） */
export const CHART_REG_COMPARE = `flowchart LR
  IN["慢模式<br/>λ_min = ${d(r.eig[1])}"]
  IN --> A["一般 LMS<br/>m = μK_q = 0.5"]
  IN --> B["完整反矩陣<br/>m = γ / λ_min = ${d(r.eigMn[0])}"]
  IN --> C["Regularized<br/>m = γ / (λ_min + λ_reg) = ${d(0.5 / (r.eig[1] + 0.1))}"]
  A --> A2["p = ${d(r.slow)}，k₉₅ = ${r.blocksScalar}<br/>RMS(δ_j) = ${d(Math.sqrt(z.scalarPerParam[0]))} fs<br/>安靜但很慢"]
  B --> B2["p = 0.5，k₉₅ = ${r.blocksFull}<br/>RMS(δ_j) = ${d(Math.sqrt(z.perParam[0]))} fs<br/>很快但很吵"]
  C --> C2["p = ${d(r.regSlowPole)}，k₉₅ = ${r.blocksReg}<br/>RMS(δ_j) = ${d(Math.sqrt(z.regPerParam[0]))} fs<br/>折衷"]${STYLE}
  class C focus
  class C2 ok`

/* ───────────── §10.5：Jacobian ───────────── */

/** 中央差分量測 Ĵ 的狀態機（Freeze → +Δ → −Δ → 斜率，對每個參數重複） */
export const CHART_JACOBIAN_FSM = `stateDiagram-v2
  direction TB
  state "FREEZE：所有係數停止更新" as FREEZE
  state "PLUS：把 w_j 加上 Δ_j，平均 N_J 個 sample，記下 G⁺" as PLUS
  state "MINUS：把 w_j 減去 Δ_j，平均 N_J 個 sample，記下 G⁻" as MINUS
  state "SLOPE：Ĵ 的第 j 欄 = (G⁺ − G⁻) ÷ (2Δ_j)，w_j 放回原值" as SLOPE
  state "BUILD：用 Ĵ 建構 M，解除 Freeze" as BUILD
  [*] --> FREEZE
  FREEZE --> PLUS : 從 j = 1 開始
  PLUS --> MINUS
  MINUS --> SLOPE
  SLOPE --> PLUS : 換下一個參數 j
  SLOPE --> BUILD : P 欄都量完
  BUILD --> [*]`

/** 擾動 Δ 的 bias–variance 兩難（F-10.14 與 std(Ĵ)） */
export const CHART_FD_TRADEOFF = `flowchart LR
  D["擾動大小 Δ"] --> S["Δ 太小<br/>例：0.1·σ_v"]
  D --> M["Δ ≈ 0.3·σ_v"]
  D --> L["Δ 太大<br/>例：1·σ_v"]
  S --> S2["G⁺ − G⁻ 隨 Δ 變小，GMAC 雜訊卻不變<br/>N_J = 4096 時 std(Ĵ / K_q) = ${d(fdRow(0.1).stdNj4096, 3)}<br/>（J / K_q 的真值最大是 1）"]
  M --> M2["截斷係數 ${d(fdRow(0.3).pm1)}（±1 碼）：只少約 1.5%<br/>std(Ĵ / K_q) = ${d(fdRow(0.3).stdNj4096, 3)}，可再用 N_J 壓低"]
  L --> L2["comparator 飽和，erf 變平<br/>截斷係數 ${d(fdRow(1).pm1)}（±1 碼）：斜率被低估約 ${d(100 * (1 - fdRow(1).pm1), 2)}%"]${STYLE}
  class S2,L2 warn
  class M,M2 ok`

/** A_cal = I + M(Ĵ)·J 的穩定性檢查流程（勘誤 E24：M 用 Ĵ 建構，迴路乘真正的 J） */
export const CHART_ACAL_CHECK = `flowchart TB
  JH["量到的 Ĵ<br/>有雜訊、有截斷"] --> BM["建構 M(Ĵ)<br/>例：−γ·Ĵ⁻¹"]
  JT["晶片真正的 J<br/>隨 FCW、PVT 改變"] --> AC["A_cal = I + M(Ĵ)·J"]
  BM --> AC
  AC --> EIG["poles p_i = eig(A_cal)<br/>ρ(A_cal) = 最大的 |p_i|"]
  EIG --> Q{"ρ(A_cal) 小於 1 ?"}
  Q -- "是" --> OK["平均誤差收斂<br/>速度由最大的 |p_i| 決定"]
  Q -- "否" --> NG["發散或停在臨界<br/>加 λ_reg、降 γ，或重新量 Ĵ"]${STYLE}
  class AC focus
  class OK ok
  class NG warn`

/**
 * regularized pseudoinverse 的 SVD 分解（F-10.10）；U 與 Uᵀ 相消後每個模式只剩一個純量增益。
 * 九個方塊排成一列太寬，所以拆成兩框：① 的輸出 E[G_k]（綠）就是 ② 的輸入 G_k（綠，多了量測雜訊）。PLANT 後宣告，畫面上排在前面。
 */
export const CHART_PINV_SVD = `flowchart LR
  subgraph UPD["② 更新矩陣：M = −γ·(JᵀJ + λ_reg·I)⁻¹·Jᵀ"]
    direction LR
    GK["GMAC 量到的 G_k"] --> UT["× Uᵀ"] --> INV["× σ_i / (σ_i² + λ_reg)<br/>加了 λ_reg 的除法"] --> V["× V"] --> GM["× (−γ)"] --> OUT["ε_(k+1) = ε_k + M·G_k<br/>模式 i 乘上 1 − γ·σ_i² / (σ_i² + λ_reg)"]
  end
  subgraph PLANT["① 晶片：J = U·Σ·Vᵀ"]
    direction LR
    E["ε_k = w_k − w*"] --> VT["× Vᵀ<br/>拆成模式"] --> SG["× σ_i<br/>模式 i 的斜率"] --> U["× U"] --> EG["E[G_k] = J·ε_k"]
  end${STYLE}
  class INV focus
  class EG,GK ok`

/**
 * T18 的訊號流（ε = w − w*）；紅色交叉路徑的斜率 +2 比自己的 −1 大。
 * 回授（更新後的 w 回到最左邊）不畫成箭頭：有回授時 dagre 會把 2×2 的結構拉成一長串，反而看不出「自己 vs 交叉」。
 */
export const CHART_T18_COUPLING = `flowchart LR
  E1["ε₁ = w₁ − w₁*"] --> J11["× J₁₁ = ${d(t.J[0][0])}<br/>自己的斜率：把 w₁ 拉回去"]
  E2["ε₂ = w₂ − w₂*"] --> J12["× J₁₂ = +${d(t.J[0][1])}<br/>耦合：把 w₁ 往外推"]
  E1 --> J21["× J₂₁ = +${d(t.J[1][0])}<br/>耦合：把 w₂ 往外推"]
  E2 --> J22["× J₂₂ = ${d(t.J[1][1])}<br/>自己的斜率：把 w₂ 拉回去"]
  J11 -- "＋" --> S1(("＋"))
  J12 -- "＋" --> S1
  J21 -- "＋" --> S2(("＋"))
  J22 -- "＋" --> S2
  S1 -- "G₁" --> M1["× μ = 0.2"]
  S2 -- "G₂" --> M2["× μ = 0.2"]
  M1 --> W1["w₁ ← w₁ + 0.2·G₁<br/>成為下一個 block 的 ε₁"]
  M2 --> W2["w₂ ← w₂ + 0.2·G₂<br/>成為下一個 block 的 ε₂"]${STYLE}
  class J12,J21 warn`

/** 同一個 J 的三種看法——只開一個 loop／一起開的共模／一起開的差模 */
export const CHART_T18_MODES = `flowchart LR
  subgraph BOTH["② 兩個 loop 一起更新"]
    direction LR
    B1["共模：ε₁ = ε₂<br/>斜率 J₁₁ + J₁₂ = ${d(t.J[0][0])} + ${d(t.J[0][1])} = +${d(t.eigJ[0])}"] --> B2["p = 1 + 0.2 × (+${d(t.eigJ[0])}) = ${d(t.poles[0])}<br/>每個 block 放大 ${d(t.poles[0])} 倍"]
    C1["差模：ε₁ = −ε₂<br/>斜率 J₁₁ − J₁₂ = ${d(t.J[0][0])} − ${d(t.J[0][1])} = ${d(t.eigJ[1])}"] --> C2["p = 1 + 0.2 × (${d(t.eigJ[1])}) = ${d(t.poles[1])}<br/>穩定"]
  end
  subgraph ONE["① 只開一個 loop（另一個凍結）"]
    direction LR
    A1["只看得到 J₁₁ = ${d(t.J[0][0])}"] --> A2["p = 1 + 0.2 × (${d(t.J[0][0])}) = ${d(1 + 0.2 * t.J[0][0])}<br/>穩定"]
  end${STYLE}
  class A2,C2 ok
  class B2 warn`

/* ───────────── §10.6–§10.8：架構 ───────────── */

/** Block NLMS 的正規化方塊——所有通道除以同一個總能量 tr R */
export const CHART_NLMS = `flowchart LR
  X["GMAC code x[n]<br/>P 個"] --> EN["能量估計<br/>把 x₁² + … + x_P² 取平均<br/>= tr R_x（匹配時 = tr R）"]
  G["GMAC 輸出 G_k<br/>P 個"] --> DIV["× μ̃ ÷ (K_q·tr R)<br/>每個通道乘同一個數"]
  EN --> DIV
  DIV --> RES["w_(k+1) = w_k + M·G_k<br/>M = μ̃ / (K_q·tr R) × I，仍然正比於 I<br/>p_i = 1 − μ̃·λ_i / tr R"]${STYLE}
  class DIV focus
  class RES warn`

/** sequential calibration 的狀態機（P = 2；對應 mSequential） */
export const CHART_SEQ_FSM = `stateDiagram-v2
  direction TB
  state "階段 1：只更新 w₁，w₂ 凍結" as CAL1
  state "階段 2：只更新 w₂，w₁ 凍結" as CAL2
  state "全部凍結：M = 0" as DONE
  [*] --> CAL1
  CAL1 --> CAL2 : 跑滿這個階段的 block 數
  CAL2 --> CAL1 : 還有下一輪
  CAL2 --> DONE : 輪數用完
  DONE --> [*]`

/** ρ = 1 的陷阱——comparator 只看得到 δ₁ + δ₂，先校的 w₁ 吸收全部誤差 */
export const CHART_SEQ_TRAP = `flowchart TB
  E["u₁ = u₂ = u（ρ = 1）<br/>e[n] = u[n]·(δ₁ + δ₂) + v[n]<br/>comparator 只看得到 δ₁ + δ₂"]
  E --> P1["階段 1：只動 w₁<br/>G₁ 正比於 δ₁ + δ₂，一路推到 δ₁ + δ₂ = 0"]
  P1 --> R1["w₁ = a₁ + a₂ = ${d(s.a[0] + s.a[1])}<br/>正確值是 a₁ = ${d(s.a[0])}"]
  R1 --> P2["階段 2：只動 w₂<br/>G₂ 正比於 δ₁ + δ₂ = 0，所以不動"]
  P2 --> R2["w₂ = 0<br/>正確值是 a₂ = ${d(s.a[1])}"]
  R2 --> OUT["輸出誤差 δ₁ + δ₂ = 0<br/>看起來已經校好"]
  OUT --> FCW["換 FCW 之後 u₁ ≠ u₂<br/>δ = (${d(-s.a[1])}, +${d(s.a[1])}) 現形"]${STYLE}
  class R1,R2,FCW warn
  class OUT ok`

/**
 * Gauss–Seidel 的一輪（P = 2、γ = 1、每階段一個 block）：階段 1 把 G₁ 歸零 ⇒ δ₁′ = −ρ·δ₂；階段 2 把 G₂ 歸零 ⇒ δ₂′ = −ρ·δ₁′ = ρ²·δ₂。
 * G₁ ∝ δ₁ + ρ·δ₂、G₂ ∝ ρ·δ₁ + δ₂ 就是 F-10.1（R = [[1, ρ], [ρ, 1]]）。
 */
export const CHART_GS_SWEEP = `flowchart LR
  S0["一輪開始<br/>誤差 δ₁、δ₂"] --> P1["階段 1：只動 w₁（γ = 1）<br/>一步把 G₁ ∝ δ₁ + ρ·δ₂ 推到 0"]
  P1 -- "δ₁′ = −ρ·δ₂" --> P2["階段 2：只動 w₂（γ = 1）<br/>一步把 G₂ ∝ ρ·δ₁′ + δ₂ 推到 0"]
  P2 -- "δ₂′ = −ρ·δ₁′ = ρ²·δ₂" --> E["一輪結束<br/>δ₂ 只乘了 ρ²<br/>ρ = 0.99：ρ² = ${d(s.gsSweep)}"]
  E -. "下一輪：再乘一次 ρ²" .-> P1${STYLE}
  class E warn`

/** 把本章結論排成選擇流程（整理用） */
export const CHART_CHOOSE_M = `flowchart TB
  Q1{"λ_min 接近 0 ?<br/>regressor 幾乎完全相關"}
  Q1 -- "是" --> N1["不可辨識<br/>任何 M 都不能製造缺失的資訊"]
  Q1 -- "否" --> Q2{"J 的 eigenvalue<br/>實部全部為負 ?"}
  Q2 -- "否，例如 T18" --> N2["Scalar LMS 對任何 μ > 0 都發散<br/>用 −γ·J⁻¹ 或 regularized pinv 修正極性"]
  Q2 -- "是" --> Q3{"κ = λ_max / λ_min 很大，<br/>而且等不起慢模式 ?"}
  Q3 -- "否" --> N3["Scalar LMS 就夠<br/>各參數功率不同用 Diagonal<br/>code 振幅會變用 NLMS"]
  Q3 -- "是" --> N4["Regularized preconditioner<br/>λ_reg 依雜訊預算與 Ĵ 的誤差選"]
  N4 --> N5["λ_reg 趨近 0 就是完整反矩陣<br/>最快，雜訊最大，對 Ĵ 誤差最敏感"]${STYLE}
  class N1,N2 warn
  class N3,N4 ok`

/** 程式碼的資料流（六個規則函式 → M_n → blockUpdate） */
export const CHART_CODE_FLOW = `flowchart LR
  JH["Ĵ_n = Ĵ / K_q<br/>匹配模型時 = −R"] --> RULE["mScalar / mDiagonal / mNlms<br/>mFull / mRegularized / mSequential"]
  D["δ_k"] --> GM["gmacLinear 或 gmacSample<br/>G_k = K_q·C·δ_k + η_k"]
  RULE -- "M_n = K_q·M（無因次）" --> BU["blockUpdate<br/>δ_(k+1) = δ_k − (M_n / K_q)·G_k"]
  GM -- "G_k" --> BU
  BU --> NX["δ_(k+1)<br/>下一個 block 再走一次"]${STYLE}
  class RULE focus`

/* ───────────── 章末 ───────────── */

/** 綜合手算 HC-10.8 的計算順序 */
export const CHART_HANDCALC_FLOW = `flowchart TB
  A["λ_min = 1 − |ρ|"] --> B["K_q = √(2/π) ÷ σ_v"]
  B --> C["K_q² × N<br/>變異公式的共同分母"]
  C --> M["選更新矩陣，算慢方向的增益 m<br/>一般 LMS：m = μK_q<br/>完整反矩陣：m = γ ÷ λ_min<br/>Regularized：m = γ ÷ (λ_min + λ_reg)"]
  M --> P["p = 1 − m × λ_min"]
  P --> K["k₉₅ = ⌈ln 0.05 ÷ ln |p|⌉<br/>預設數字：${r.blocksScalar} / ${r.blocksFull} / ${r.blocksReg}"]
  P --> Q["1 − p² = (1 − p) × (1 + p)"]
  Q --> V["Var(ξ_slow) = m² × λ_min ÷ (K_q² × N × (1 − p²))<br/>預設數字：${d(z.scalarModeVar[1])} / ${d(z.modeVar[1])} / ${d(z.regModeVar[1])} fs²"]${STYLE}
  class M focus`

/** 硬體對應（藍色 = 本章新增的 P×P 混合矩陣；虛線 = 韌體／測試機的慢速路徑） */
export const CHART_HW_MAP = `flowchart LR
  CMP["BBPD / 1-bit comparator<br/>q[n] = ±1"] --> G1["GMAC accumulator 1<br/>GOS"]
  CMP --> G2["GMAC accumulator 2<br/>PHOS"]
  CMP --> G3["GMAC accumulator 3<br/>DTC gain"]
  G1 --> MIX["P×P 混合矩陣 M<br/>P² 個乘加或 LUT<br/>scalar / diagonal 只要 shift"]
  G2 --> MIX
  G3 --> MIX
  MIX --> ACC["P 個係數暫存器 w"]
  ACC --> DTC["DTC / PMUX 補償"]
  DTC -. "經 PLL error path" .-> CMP
  FW["韌體或測試機的 FSM<br/>Freeze、±Δ、量 Ĵ"] -. "寫入 M、γ、λ_reg" .-> MIX
  FW -. "Freeze 與 ±Δ" .-> ACC${STYLE}
  class MIX focus`

/* ───────────── 登錄表：依頁面順序 ───────────── */

export type DiagramKind = '系統圖' | '數學模型' | '演算法迴圈' | '路徑圖' | '比較圖' | '手算流程' | '狀態機' | '流程圖'

export interface Ch10Diagram {
  /** 元件用的鍵：<Fig id="…" /> */
  id: string
  /** 匯出的常數名稱（報告與測試用） */
  name: string
  kind: DiagramKind
  /** 所在段落（Section 的 id） */
  section: string
  /** 這張圖對應的公式（沒有就省略） */
  formula?: string
  /** 這張圖要排在哪個元素之前（DOM id：公式的 `formula-F-10.x` 或手算題的 `handcalc-HC-10.x`）——先看圖、再看推導與 boxed 結果 */
  before?: string
  chart: string
  /** 圖說：一句話說明要看什麼（`$...$` 以 KaTeX 顯示） */
  caption: string
  /** 螢幕閱讀器用的純文字說明 */
  alt: string
}

/** 第 10 章全部的 Mermaid 圖（不含章首的 SystemMap），順序 = 頁面上出現的順序 = 圖號 10-1 … 10-N */
export const CH10_DIAGRAMS: readonly Ch10Diagram[] = [
  {
    id: 'system',
    name: 'CHART_MIMO_SYSTEM',
    kind: '系統圖',
    section: 'ch10-system',
    chart: CHART_MIMO_SYSTEM,
    caption: String.raw`多參數 Block Sign-LMS 的整體架構（$P=3$）。要看藍色方塊：三個 GMAC 各用自己的 code $x_i[n]$ 去相關「同一個」comparator 輸出 $q[n]$；右邊的更新矩陣 $\mathbf M$ 決定各 GMAC 的輸出如何分配到各校正係數。`,
    alt: '多參數 Block Sign-LMS 架構：三個 GMAC 共用一個 1-bit comparator，輸出經更新矩陣 M 回到校正係數，再以 δ = a − w 回到誤差',
  },
  {
    id: 'coupling',
    name: 'CHART_COUPLING_PATHS',
    kind: '數學模型',
    section: 'ch10-coupling',
    formula: 'F-10.1',
    before: 'formula-F-10.1',
    chart: CHART_COUPLING_PATHS,
    caption: String.raw`把 $E[\mathbf G]\approx K_q\mathbf R\boldsymbol\delta$ 畫成訊號流（$P=2$、$\rho=0.8$）。先看紅色的兩條交叉路徑：$\delta_2$ 經 $R_{12}$ 流進 $G_1$，所以 $w_1$ 正確時 $G_1$ 也不是 0。`,
    alt: '兩個參數誤差 δ₁、δ₂ 各自經 R 的四個元素流到兩個 GMAC 的訊號流圖；R₁₂、R₂₁ 是交叉耦合路徑',
  },
  {
    id: 'sample-to-block',
    name: 'CHART_SAMPLE_TO_BLOCK',
    kind: '路徑圖',
    section: 'ch10-derive-G',
    formula: 'F-10.1',
    before: 'formula-F-10.1',
    chart: CHART_SAMPLE_TO_BLOCK,
    caption: String.raw`從 comparator 到 GMAC：左框每個 sample $n$ 做一次，右框每 $N$ 個 sample 才輸出一個 $G_{i,k}$。要看的是藍色方塊：兩個 GMAC 吃的是同一個 $q[n]$。`,
    alt: '誤差在加法點相加成 e[n]，經 1-bit comparator 得到 q[n]，分別乘上 x₁、x₂ 後累加 N 次得到 G₁、G₂',
  },
  {
    id: 'comparator-gain',
    name: 'CHART_COMPARATOR_GAIN',
    kind: '數學模型',
    section: 'ch10-derive-G',
    formula: 'F-10.1',
    before: 'formula-F-10.1',
    chart: CHART_COMPARATOR_GAIN,
    caption: String.raw`把 1-bit comparator 換成一個增益：固定訊號 $s$、只對雜訊取平均，$\pm1$ 的平均是一條 S 曲線 $\operatorname{erf}\big(s/(\sqrt2\,\sigma_v)\big)$；$|s|\ll\sigma_v$ 時它就是斜率 $K_q$ 的直線（藍），$|s|$ 很大時飽和（紅）。`,
    alt: '訊號 s 加上 Gaussian 雜訊後經 1-bit comparator，平均輸出是 erf 形狀的 S 曲線；訊號遠小於雜訊時近似為增益 K_q 乘上 s，訊號很大時飽和',
  },
  {
    id: 'gmac-noise',
    name: 'CHART_GMAC_NOISE',
    kind: '路徑圖',
    section: 'ch10-derive-G',
    chart: CHART_GMAC_NOISE,
    caption: String.raw`GMAC 雜訊 $\boldsymbol\eta_k$ 從哪裡來：左框每個 sample 的乘積 $q[n]\,\mathbf x[n]$ 平均很小、抖動卻有 $\mathbf R$ 那麼大；右框平均 $N$ 個之後，抖動的共變異剩下 $\mathbf R/N$（藍）。紅色那一格是 §10.1 的數字。`,
    alt: '每個 sample 的乘積 q 乘 code 的共變異約為 R，GMAC 平均 N 個 sample 後得到 G_k 等於平均加上雜訊 η_k，雜訊共變異約為 R 除以 N',
  },
  {
    id: 'update-loop',
    name: 'CHART_UPDATE_LOOP',
    kind: '演算法迴圈',
    section: 'ch10-update-matrix',
    formula: 'F-10.2',
    before: 'formula-F-10.2',
    chart: CHART_UPDATE_LOOP,
    caption: String.raw`多參數更新 $\mathbf w_{k+1}=\mathbf w_k+\mathbf M\mathbf G_k$ 的迴路（每條線都是 $P$ 維向量，每個 block $k$ 走一圈）。藍色的 $\mathbf M$ 是唯一可以設計的方塊。`,
    alt: '誤差 δ_k 經 K_q R、加上雜訊 η_k 得到 G_k，乘上更新矩陣 M 後累加成 w，再以負號回到誤差',
  },
  {
    id: 'm-variants',
    name: 'CHART_M_VARIANTS',
    kind: '比較圖',
    section: 'ch10-update-matrix',
    formula: 'F-10.3 / F-10.4 / F-10.8',
    before: 'formula-F-10.2',
    chart: CHART_M_VARIANTS,
    caption: String.raw`五種更新矩陣並排：輸入都是同一個 $\mathbf G_k$，差別只在中間那一塊（藍色 = 相對於 scalar LMS 改掉的方塊），右邊是各自的結果。`,
    alt: 'Scalar、Diagonal、Full inverse、Regularized、Sequential 五種更新矩陣與各自的 pole 及代價',
  },
  {
    id: 'eigen-modes',
    name: 'CHART_EIGEN_MODES',
    kind: '數學模型',
    section: 'ch10-update-matrix',
    formula: 'F-10.3',
    before: 'formula-F-10.3',
    chart: CHART_EIGEN_MODES,
    caption: 'Eigen 分解把兩條互相耦合的迴路拆成兩條互不相干的一階迴路：共模（綠）快，差模（紅）慢。',
    alt: '誤差向量經 Vᵀ 拆成共模與差模，各自乘上自己的 pole，再經 V 轉回參數座標',
  },
  {
    id: 'mode-gain',
    name: 'CHART_MODE_GAIN',
    kind: '比較圖',
    section: 'ch10-update-matrix',
    formula: 'F-10.4',
    before: 'formula-F-10.4',
    chart: CHART_MODE_GAIN,
    caption: String.raw`同一個 $\mathbf R$（$\rho=0.99$）、兩種更新矩陣：每個模式的 loop gain $=m_i\lambda_i$。① Scalar 兩個模式用同一個 $m$，慢模式（紅）只有 0.005；② Full inverse 把 $m_i$ 改成 $\gamma/\lambda_i$（藍），兩個模式都變成 $\gamma$（綠）。`,
    alt: 'Scalar 與完整反矩陣在快、慢兩個模式上的增益 m、loop gain 與 pole 的比較',
  },
  {
    id: 'k95-flow',
    name: 'CHART_K95_FLOW',
    kind: '手算流程',
    section: 'ch10-598',
    formula: 'F-10.5',
    before: 'formula-F-10.5',
    chart: CHART_K95_FLOW,
    caption: String.raw`598 與 5 的手算流程：由左到右每一格只做一種運算；上面一路是一般 LMS，下面一路是完整反矩陣。藍色那一格提醒先把 $\mu$ 乘上 $K_q$。`,
    alt: '由 ρ 算 eigenvalue、慢 pole，再算 95% 衰減所需的 block 數：一般 LMS 598、完整反矩陣 5',
  },
  {
    id: 'noise-path',
    name: 'CHART_NOISE_PATH',
    kind: '演算法迴圈',
    section: 'ch10-noise',
    formula: 'F-10.6',
    before: 'formula-F-10.6',
    chart: CHART_NOISE_PATH,
    caption: String.raw`完整反矩陣在一個 eigen-mode 上的迴路。訊號先乘 $K_q\lambda_i$ 再乘 $\gamma/(K_q\lambda_i)$，兩者相消；雜訊（紅）只經過後面那一塊，所以 $\lambda_i$ 越小被放大越多。`,
    alt: '模式誤差 ξ 經 K_q λ 後與 GMAC 雜訊相加，再乘上反矩陣增益 γ/(K_q λ) 並以負號累加回 ξ',
  },
  {
    id: 'lyapunov',
    name: 'CHART_LYAPUNOV',
    kind: '演算法迴圈',
    section: 'ch10-noise',
    formula: 'F-10.15',
    before: 'formula-F-10.15',
    chart: CHART_LYAPUNOV,
    caption: String.raw`共變異 $\mathbf X_k=\operatorname{Cov}(\boldsymbol\delta_k)$ 的迴路：右邊繞圈的一路把舊的散布用 $\mathbf A$ 縮小（綠），左邊進來的一路是經過 $\mathbf M$ 注入的新雜訊（紅）；兩者平衡時就是穩態。`,
    alt: '共變異矩陣 X 每個 block 被 A 縮小後加上 M 注入的 GMAC 雜訊',
  },
  {
    id: 'reg-compare',
    name: 'CHART_REG_COMPARE',
    kind: '比較圖',
    section: 'ch10-regularized',
    formula: 'F-10.8',
    before: 'formula-F-10.8',
    chart: CHART_REG_COMPARE,
    caption: String.raw`慢模式（$\lambda_{\min}=0.01$）上的三種增益 $m$ 與結果（$\gamma=\mu K_q=0.5$、$\lambda_{\mathrm{reg}}=0.1$、$N=4096$、$\sigma_v=100\ \mathrm{fs}$）：regularized（藍）的速度與雜訊都落在另外兩者之間，用一點速度換回大部分的雜訊。`,
    alt: '一般 LMS、完整反矩陣、Regularized 在慢模式上的增益、pole、95% blocks 與每參數 RMS',
  },
  {
    id: 'jacobian-fsm',
    name: 'CHART_JACOBIAN_FSM',
    kind: '狀態機',
    section: 'ch10-jacobian',
    formula: 'F-10.9',
    before: 'formula-F-10.9',
    chart: CHART_JACOBIAN_FSM,
    caption: String.raw`量測 $\hat{\mathbf J}$ 的狀態機（由上往下）：每個參數做一次「$+\Delta_j$、$-\Delta_j$」，每次都等 $N_J$ 個 sample，一共 $2P$ 次 GMAC 量測；量完才用 $\hat{\mathbf J}$ 建構 $\mathbf M$。`,
    alt: 'Jacobian 量測狀態機：Freeze、加擾動、減擾動、算斜率，對每個參數重複，最後建構更新矩陣',
  },
  {
    id: 'fd-tradeoff',
    name: 'CHART_FD_TRADEOFF',
    kind: '比較圖',
    section: 'ch10-jacobian',
    formula: 'F-10.14',
    before: 'formula-F-10.14',
    chart: CHART_FD_TRADEOFF,
    caption: String.raw`擾動 $\Delta$ 的兩難：太小時兩次讀數的差變小、雜訊相對變大（上），太大時 comparator 飽和、斜率被低估（下）；$\Delta\approx0.3\sigma_v$（綠）是折衷。數字與下表同一列。`,
    alt: '擾動太小時雜訊大、太大時 comparator 飽和使斜率偏小，0.3 倍 σ_v 是折衷',
  },
  {
    id: 'acal-check',
    name: 'CHART_ACAL_CHECK',
    kind: '流程圖',
    section: 'ch10-jacobian',
    formula: 'F-10.2（勘誤 E24）',
    before: 'formula-F-10.10',
    chart: CHART_ACAL_CHECK,
    caption: String.raw`穩定性檢查的流程（由上往下）。要看藍色方塊的兩個輸入：$\mathbf M$ 是用量到的 $\hat{\mathbf J}$ 建構的，但迴路矩陣乘的是晶片真正的 $\mathbf J$（勘誤 E24）。`,
    alt: '由量測的 Ĵ 建構 M，與真正的 J 相乘得到 A_cal，檢查 spectral radius 是否小於 1',
  },
  {
    id: 'pinv-svd',
    name: 'CHART_PINV_SVD',
    kind: '路徑圖',
    section: 'ch10-jacobian',
    formula: 'F-10.10',
    before: 'formula-F-10.10',
    chart: CHART_PINV_SVD,
    caption: String.raw`Regularized pseudoinverse 的 SVD 分解：① 是晶片（$\mathbf J=\mathbf U\boldsymbol\Sigma\mathbf V^T$），② 是更新矩陣；① 的輸出（綠）就是 ② 的輸入。$\mathbf U$ 與 $\mathbf U^T$ 相消後，每個模式只剩藍色那一個純量增益。`,
    alt: '第一框：誤差經 Vᵀ、σ、U 變成 GMAC 輸出；第二框：GMAC 輸出經 Uᵀ、regularized 除法、V 與 −γ 變成更新量',
  },
  {
    id: 't18-coupling',
    name: 'CHART_T18_COUPLING',
    kind: '數學模型',
    section: 'ch10-t18',
    formula: 'F-10.11',
    before: 'formula-F-10.11',
    chart: CHART_T18_COUPLING,
    caption: String.raw`T18 的訊號流（$\epsilon_i=w_i-w_i^*$，由左到右是一個 block）：自己的斜率是 $-1$，紅色交叉路徑是 $+2$——別人的誤差推你的力道，是你自己修正力道的兩倍。`,
    alt: 'T18 反例的訊號流：對角斜率 −1、交叉耦合 +2，兩個 loop 各自乘 0.2 後加回自己的係數',
  },
  {
    id: 't18-modes',
    name: 'CHART_T18_MODES',
    kind: '比較圖',
    section: 'ch10-t18',
    formula: 'F-10.11',
    before: 'formula-F-10.11',
    chart: CHART_T18_MODES,
    caption: String.raw`同一個 $\mathbf J$ 的三種看法：① 只開一個 loop 時 pole $=0.8$（穩定）；② 一起更新時共模方向的斜率變成 $+1$，pole $=1.2$（紅，發散），差模 pole $=0.4$。`,
    alt: '單一 loop 的 pole 0.8、一起更新時共模 pole 1.2 發散、差模 pole 0.4',
  },
  {
    id: 'nlms',
    name: 'CHART_NLMS',
    kind: '數學模型',
    section: 'ch10-nlms-seq',
    formula: 'F-10.12',
    before: 'formula-F-10.12',
    chart: CHART_NLMS,
    caption: String.raw`Block NLMS：從 code $x[n]$ 出發的那一路估計 regressor 的總能量 $\operatorname{tr}\mathbf R$，用它去除步長（藍）。所有通道除的是同一個數，所以更新方向沒有改變（紅）。`,
    alt: 'NLMS 用 code 的平均總能量正規化步長，所有 GMAC 通道乘同一個純量',
  },
  {
    id: 'seq-fsm',
    name: 'CHART_SEQ_FSM',
    kind: '狀態機',
    section: 'ch10-nlms-seq',
    chart: CHART_SEQ_FSM,
    caption: String.raw`Sequential calibration 的狀態機（$P=2$）：任何時候只有一個係數在更新，其他凍結；可以只跑一輪，也可以 round-robin 多輪。`,
    alt: 'Sequential calibration 狀態機：階段 1 只更新 w₁、階段 2 只更新 w₂，可輪流多輪後全部凍結',
  },
  {
    id: 'seq-trap',
    name: 'CHART_SEQ_TRAP',
    kind: '流程圖',
    section: 'ch10-nlms-seq',
    chart: CHART_SEQ_TRAP,
    caption: String.raw`$\rho=1$ 的陷阱，由上往下看：comparator 只看得到 $\delta_1+\delta_2$，先校的 $w_1$ 把全部誤差吸收（紅 = 錯的係數，綠 = 「看起來沒問題」的輸出）。`,
    alt: '完全相關時階段 1 把 w₁ 推到 a₁ + a₂，階段 2 的 w₂ 不動，輸出誤差為 0 但兩個係數都錯',
  },
  {
    id: 'gs-sweep',
    name: 'CHART_GS_SWEEP',
    kind: '演算法迴圈',
    section: 'ch10-nlms-seq',
    chart: CHART_GS_SWEEP,
    caption: String.raw`Round-robin 的一輪（$\gamma=1$、每階段一個 block）：階段 1 把 $G_1$ 歸零時，$\delta_2$ 的誤差被複製成 $\delta_1'=-\rho\,\delta_2$；階段 2 再乘一次 $-\rho$，所以一輪下來 $\delta_2$ 只乘上 $\rho^2$（紅）。`,
    alt: 'Gauss–Seidel 的一輪：階段 1 得到 δ₁′ 等於負 ρ 乘 δ₂，階段 2 得到 δ₂′ 等於 ρ 平方乘 δ₂，每輪誤差只乘上 ρ 平方',
  },
  {
    id: 'choose-m',
    name: 'CHART_CHOOSE_M',
    kind: '流程圖',
    section: 'ch10-four-architectures',
    chart: CHART_CHOOSE_M,
    caption: '把本章的結論排成一張選擇流程（整理用，不是唯一的設計流程）：先問可不可辨識，再問極性，最後才是速度與雜訊的取捨。',
    alt: '選擇更新矩陣的流程：不可辨識、極性錯誤、eigenvalue spread 三個問題依序決定用哪一種',
  },
  {
    id: 'code-flow',
    name: 'CHART_CODE_FLOW',
    kind: '流程圖',
    section: 'ch10-code',
    chart: CHART_CODE_FLOW,
    caption: String.raw`程式碼的資料流：六個規則函式只負責產生 $\mathbf M_n$（藍）；GMAC 與 blockUpdate 是所有規則共用的，兩路在 blockUpdate 會合，每個 block 走一次。`,
    alt: 'Ĵ_n 經規則函式得到 M_n，δ_k 經 GMAC 得到 G_k，兩者一起進入 blockUpdate 得到下一個 block 的誤差',
  },
  {
    id: 'handcalc-flow',
    name: 'CHART_HANDCALC_FLOW',
    kind: '手算流程',
    section: 'ch10-synthesis',
    formula: 'F-10.5 / F-10.7（HC-10.8）',
    before: 'handcalc-HC-10.8',
    chart: CHART_HANDCALC_FLOW,
    caption: String.raw`綜合手算 HC-10.8 的計算順序：前三格三種更新矩陣共用；從藍色那一格開始，每種更新矩陣各做一次。`,
    alt: '綜合手算流程：先算 λ_min、K_q、K_q²N，再對每種更新矩陣算 m、p、k95、1 − p² 與變異',
  },
  {
    id: 'hw-map',
    name: 'CHART_HW_MAP',
    kind: '系統圖',
    section: 'ch10-pll',
    chart: CHART_HW_MAP,
    caption: String.raw`硬體對應：實線是每個 sample／block 都在跑的資料路徑，虛線是韌體或測試機偶爾才動的慢速路徑。藍色的 $P\times P$ 混合矩陣是本章新增的硬體。`,
    alt: 'comparator 輸出送進三個 GMAC accumulator，經 P×P 混合矩陣到係數暫存器與 DTC/PMUX；韌體負責量 Ĵ 並寫入 M',
  },
]

/** 依 id 取出一張圖與它的圖號（找不到就丟錯，避免頁面默默少一張圖） */
export function diagram(id: string): Ch10Diagram & { no: string } {
  const i = CH10_DIAGRAMS.findIndex((x) => x.id === id)
  if (i < 0) throw new Error(`ch10/diagrams.ts：找不到圖 "${id}"`)
  return { ...CH10_DIAGRAMS[i], no: `10-${i + 1}` }
}

/** 章首系統地圖要標成藍色的方塊：P 個 GMAC、「÷ N、× μ」（本章變成更新矩陣 M）、係數累加器（本章變成向量 w_k） */
export const SYSTEM_MAP_FOCUS: SystemBlock[] = ['gmac', 'scale', 'acc']
