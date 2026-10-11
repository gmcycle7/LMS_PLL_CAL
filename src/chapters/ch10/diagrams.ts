/**
 * 第 10 章的方塊圖（docs/teaching-style.md §8）。每張圖一個具名匯出的 Mermaid 原始碼字串，
 * 由 diagrams.test.tsx 以真正的 mermaid parser 解析，並用共用的 renderMermaidForTest（@/components/mermaidTestUtils）在 jsdom 下實際 render 檢查。
 * 圖號（圖 10-1 … 10-N）不寫在這個檔案裡：它等於登錄表 CH10_DIAGRAMS 的順序，正文一律用 <Fig id> / <FigRef id> 取得。
 *
 * 寫圖時的約定（全部由測試把關）：
 *  - 圖裡的數學一律寫 LaTeX：雙引號標籤內用 `$...$`，由共用的 <Mermaid> 以 KaTeX 排版（和正文同一套樣式）；文字（中文、英文單字、單位 fs）照常寫在 `$...$` 外面。
 *    原始碼用 `String.raw` 樣板字串，TeX 的反斜線只寫一次（`${...}` 插值照常可用）。標籤內不要用雙反斜線（Mermaid 會收成一個），換行用 `<br/>`，矩陣的換列用 `\cr`。
 *    不要用裸的 `<`、`>`（會被當成 HTML），寫 `\lt`、`\gt`。向量與矩陣用粗體（`\mathbf`、`\boldsymbol`），和章內其他地方一致。
 *  - stateDiagram-v2：`state "…" as ID` 的描述可以含 `$...$`；轉移（`A --> B : …`）的文字不在雙引號裡，要有公式就整句寫成單一 `$$\text{…}…$$`，否則只寫文字。
 *  - 加法點用全形「＋」：Mermaid 11 會把每個標籤當 Markdown 解析，單獨一個半形 `+`（或 `-`、`*`、`1.` 開頭）會被當成清單，
 *    畫面上變成「Unsupported markdown: list」（共用的 <Mermaid> 會先用 sanitizeMermaidSource 轉換，但本章的原始碼直接寫全形，不依賴它）。減號用 U+2212「−」。
 *  - 極性：δ = a − w（全站約定）；T18 與 Jacobian 的圖改用 ε = w − w*（= −δ），因為 J 是對 w 的斜率，圖說會註明。
 *  - 取樣率：帶 [n] 的訊號每個 comparator sample 一次；帶 _k 的訊號每個 GMAC block 一次。
 *  - 版面寬度（docs/teaching-style.md §8）：桌機（1280px）上圖要完整放進正文欄、不必橫向捲動（node scripts/diagram-audit.mjs --routes /ch/10 的「超出」要是 0）。
 *    長的橫向流程一律改成 `flowchart TB`（扇出／扇入的節點會並排）；兩個框要接起來時用「框對框」的連線（`FAST --> SLOW`），箭頭會停在框的邊緣，不會穿過框的標題；
 *    只有迴路（更新迴路、雜訊路徑、Lyapunov）保留 `flowchart LR`，因為橫向的回授才是課本裡熟悉的樣子，寬度都在 1260px 以內。
 *  - 圖內的數字一律由 numbers.ts（模型函式）算出，不手寫；`d()` 輸出的是 TeX 數字，一定要放在 `$...$` 裡。
 */
import type { SystemBlock } from '@/components'
import { fmt } from '@/simulation/core'
import { NUM } from './numbers'

/** 深淺主題都看得清楚的三種標色：focus（本圖主角／改掉的方塊）、warn（出問題的路徑）、ok（沒問題的結果） */
const STYLE = `
  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff
  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff`

/** 圖內數字（TeX，放在 `$...$` 裡）：有效位數；負號用 TeX 的 `-`，指數記號寫成 `\times10^{n}`，∞ 寫成 `\infty` */
function d(x: number, digits = 4): string {
  const s = fmt(x, digits).replace('∞', '\\infty')
  const m = /^(-?[\d.]+)e([+-]?\d+)$/.exec(s)
  return m ? `${m[1]}\\times10^{${Number(m[2])}}` : s
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
export const CHART_MIMO_SYSTEM = String.raw`flowchart TB
  subgraph PLL["PLL + DTC 的誤差路徑（每個 sample $n$）"]
    E["$e[n] = u_1[n]\,\delta_1 + u_2[n]\,\delta_2 + u_3[n]\,\delta_3 + v[n]$"]
  end
  E --> Q["1-bit comparator<br/>$q[n] = \operatorname{sign}(e[n])$"]
  Q -- "$q[n]$" --> G1["$\mathrm{GMAC}_1$（GOS）<br/>$G_1 = \frac{1}{N}\sum_n q[n]\,x_1[n]$"]
  Q -- "$q[n]$" --> G2["$\mathrm{GMAC}_2$（PHOS）<br/>$G_2 = \frac{1}{N}\sum_n q[n]\,x_2[n]$"]
  Q -- "$q[n]$" --> G3["$\mathrm{GMAC}_3$（DTC gain）<br/>$G_3 = \frac{1}{N}\sum_n q[n]\,x_3[n]$"]
  G1 --> M["更新矩陣 $\mathbf M$<br/>$\mu\mathbf I$ / diag / NLMS /<br/>$\gamma\,(K_q\mathbf R)^{-1}$ / regularized"]
  G2 --> M
  G3 --> M
  M --> W["$\mathbf w_{k+1} = \mathbf w_k + \mathbf M\,\mathbf G_k$<br/>每個 block $k$ 更新一次"]
  W -- "$\boldsymbol\delta = \mathbf a - \mathbf w$" --> E${STYLE}
  class Q focus`

/* ───────────── §10.1–§10.2：耦合 ───────────── */

/** E[G] ≈ K_q R δ 的訊號流（P = 2）；紅色是交叉耦合路徑 */
export const CHART_COUPLING_PATHS = String.raw`flowchart LR
  D1["$\delta_1 = a_1 - w_1$<br/>例：$${d(c.delta[0])}\ \mathrm{fs}$（$w_1$ 正確）"]
  D2["$\delta_2 = a_2 - w_2$<br/>例：$${d(c.delta[1])}\ \mathrm{fs}$"]
  D1 --> R11["$\times R_{11} = ${d(c.R[0][0])}$<br/>自己的路徑"]
  D2 --> R12["$\times R_{12} = ${d(c.R[0][1])}$<br/>交叉耦合"]
  D1 --> R21["$\times R_{21} = ${d(c.R[1][0])}$<br/>交叉耦合"]
  D2 --> R22["$\times R_{22} = ${d(c.R[1][1])}$<br/>自己的路徑"]
  R11 -- "＋" --> S1(("＋"))
  R12 -- "＋" --> S1
  R21 -- "＋" --> S2(("＋"))
  R22 -- "＋" --> S2
  S1 --> K1["$\times K_q$<br/>comparator 增益"]
  S2 --> K2["$\times K_q$<br/>comparator 增益"]
  K1 --> G1["$\mathrm{GMAC}_1$ 的平均 $E[G_1]$<br/>例：$${d(c.R[0][1])} \times K_q \times ${d(c.delta[1])} = ${d(c.G1lin)}$"]
  K2 --> G2["$\mathrm{GMAC}_2$ 的平均 $E[G_2]$<br/>例：$${d(c.R[1][1])} \times K_q \times ${d(c.delta[1])} = ${d(c.G2lin)}$"]${STYLE}
  class R12,R21 warn
  class G1 focus`

/** 從 comparator 到 GMAC（sample 速率 n → block 速率 k）；兩個 GMAC 共用同一個 q[n] */
export const CHART_SAMPLE_TO_BLOCK = String.raw`flowchart TB
  subgraph FAST["sample 速率：每個 $n$ 做一次（block $k$ 之內 $\mathbf w$ 不變）"]
    direction LR
    U1["$u_1[n] \times \delta_1$"] -- "＋" --> SE(("＋"))
    U2["$u_2[n] \times \delta_2$"] -- "＋" --> SE
    V(["雜訊 $v[n]$<br/>RMS $= \sigma_v$"]) -- "＋" --> SE
    SE -- "$e[n]$" --> CMP["1-bit comparator<br/>$q[n] = \operatorname{sign}(e[n])$"]
    CMP -- "$q[n]$" --> X1["$\times x_1[n]$"]
    CMP -- "$q[n]$" --> X2["$\times x_2[n]$"]
  end
  subgraph SLOW["block 速率：每 $N$ 個 sample 輸出一次"]
    direction LR
    A1["累加 $N$ 次再 $\div N$"] --> G1["$G_1$（第 $k$ 個 block）"]
    A2["累加 $N$ 次再 $\div N$"] --> G2["$G_2$（第 $k$ 個 block）"]
  end
  X1 --> A1
  X2 --> A2${STYLE}
  class CMP focus`

/**
 * 1-bit comparator 的平均輸出是一條 S 曲線（erf）；訊號遠小於雜訊時可以換成一個增益 K_q（F-10.1 推導的第 5–7 步）。
 * 例子取 §10.1 的 δ = (0, 10) fs、這個 sample 的 u₂ = +1：s = 10 fs。
 */
export const CHART_COMPARATOR_GAIN = String.raw`flowchart TB
  S["這個 sample 的訊號<br/>$s = u_1\,\delta_1 + u_2\,\delta_2$<br/>例：$\delta_1 = ${d(c.delta[0])}$、$\delta_2 = ${d(c.delta[1])}\ \mathrm{fs}$、$u_2 = +1$，$s = ${d(c.delta[1])}\ \mathrm{fs}$"] -- "＋" --> ADD(("＋"))
  V(["雜訊 $v$<br/>Gaussian，RMS $\sigma_v = ${d(NUM.sigmaV)}\ \mathrm{fs}$"]) -- "＋" --> ADD
  ADD -- "$e = s + v$" --> CMP["1-bit comparator<br/>$q = \operatorname{sign}(e)$，只有 $\pm1$"]
  CMP -- "$q$" --> AVG["固定 $s$，對雜訊取平均<br/>$E[q \mid u] = \operatorname{erf}\big(s \div (\sqrt2\,\sigma_v)\big)$<br/>例：$${d(c.erfOne)}$"]
  AVG -- "$|s|$ 遠小於 $\sigma_v$" --> LIN["$\approx K_q \times s$<br/>$K_q = \sqrt{2/\pi} \div \sigma_v = ${d(NUM.Kq)}\ \mathrm{fs}^{-1}$<br/>例：$${d(c.G2lin)}$"]
  AVG -- "$|s|$ 遠大於 $\sigma_v$" --> SAT["飽和在 $\pm1$<br/>等效增益比 $K_q$ 小"]${STYLE}
  class LIN focus
  class SAT warn`

/**
 * GMAC 雜訊 η_k 的來源（§10.2 的 Cov(η) ≈ R / N）：每個 sample 的乘積 q·x 的共變異 ≈ R（q² = 1），平均 N 個獨立 sample 後 ÷ N。
 * 畫的是匹配模型（x = u，R_x = R）；例子的數字與正文同一個來源（N = 4096、§10.1 的 G₁）。
 */
export const CHART_GMAC_NOISE = String.raw`flowchart TB
  subgraph FAST["sample 速率：每個 $n$ 一個乘積"]
    direction TB
    Q["$q[n] = \pm1$<br/>近平衡時幾乎只由雜訊 $v[n]$ 決定"] --> P["乘積 $q[n]\,\mathbf x[n]$（$P$ 個數）<br/>平均 $\approx K_q\mathbf R\boldsymbol\delta_k$：很小<br/>共變異 $\approx \mathbf R$（因為 $q^2 = 1$）"]
    X["GMAC 的 code $\mathbf x[n]$<br/>匹配時 $\mathbf x = \mathbf u$，$E[\mathbf x\mathbf x^T] = \mathbf R$"] --> P
  end
  subgraph SLOW["block 速率：每 $N$ 個 sample 一個 $\mathbf G_k$"]
    direction TB
    AVG["平均 $N$ 個獨立的乘積<br/>平均不變，共變異 $\div N$"] --> G["$\mathbf G_k = K_q\mathbf R\boldsymbol\delta_k + \boldsymbol\eta_k$<br/>$\boldsymbol\eta_k$ 的平均是 $0$，$\operatorname{Cov}(\boldsymbol\eta_k) \approx \mathbf R / N$"]
    G --> EX["例：$N = ${z.N}$、$R_{ii} = 1$<br/>每個 GMAC 的雜訊 RMS $= 1 \div ${Math.sqrt(z.N)} = ${d(etaRms, 3)}$<br/>§10.1 的訊號 $G_1 = ${d(c.G1lin, 3)}$，只有它的 $${d(c.G1lin / etaRms, 2)}$ 倍"]
  end
  FAST --> SLOW${STYLE}
  class G focus
  class EX warn`

/* ───────────── §10.3：更新矩陣 ───────────── */

/** w_(k+1) = w_k + M·G_k 的迴路（block 速率，每條線都是 P 維向量） */
export const CHART_UPDATE_LOOP = String.raw`flowchart LR
  A["$\mathbf a$<br/>真實參數"] -- "＋" --> SD(("＋"))
  SD -- "$\boldsymbol\delta_k = \mathbf a - \mathbf w_k$" --> KR["$\times K_q\mathbf R$<br/>comparator 與相關<br/>（$= -\mathbf J$）"]
  KR -- "＋" --> SG(("＋"))
  ETA(["GMAC 雜訊 $\boldsymbol\eta_k$<br/>$\operatorname{Cov} \approx \mathbf R / N$"]) -- "＋" --> SG
  SG -- "$\mathbf G_k$" --> M["$\times \mathbf M$<br/>更新矩陣"]
  M -- "＋" --> SW(("＋"))
  SW -- "$\mathbf w_{k+1}$" --> Z["$z^{-1}$<br/>延遲一個 block"]
  Z -- "＋" --> SW
  Z -- "$-\mathbf w_k$" --> SD${STYLE}
  class M focus`

/** 五種更新矩陣並排（藍色 = 相對於 scalar LMS 改掉的方塊） */
export const CHART_M_VARIANTS = String.raw`flowchart LR
  G["GMAC 輸出 $\mathbf G_k$<br/>$P$ 個數"]
  G --> M1["Scalar：$\mathbf M = \mu\mathbf I$<br/>每個係數只用自己的 GMAC<br/>大家同一個 $\mu$"]
  G --> M2["Diagonal：$\mathbf M = \operatorname{diag}(\mu_1, \ldots, \mu_P)$<br/>只用自己的 GMAC<br/>各有各的 $\mu_i$"]
  G --> M3["Full inverse：$\mathbf M = \gamma\,(K_q\mathbf R)^{-1}$<br/>每個係數用全部 GMAC 的組合"]
  G --> M4["Regularized：$\mathbf M = \gamma\,\big(K_q(\mathbf R + \lambda_{\mathrm{reg}}\mathbf I)\big)^{-1}$<br/>先加 $\lambda_{\mathrm{reg}}$ 再求逆"]
  G --> M5["Sequential：$\mathbf M$ 只留一個 $M_{ii}$<br/>每個 block 只開一個 loop，輪流換 $i$"]
  M1 --> P1["$p_i = 1 - \mu K_q\lambda_i$<br/>慢模式被 $\lambda_{\min}$ 卡住"]
  M2 --> P2["只修正各參數功率不同<br/>相關造成的慢模式還在"]
  M3 --> P3["$p_i = 1 - \gamma$，每個模式一樣快<br/>雜訊沿慢方向放大 $1/\lambda_{\min}$"]
  M4 --> P4["$p_i = 1 - \gamma\lambda_i / (\lambda_i + \lambda_{\mathrm{reg}})$<br/>速度與雜訊折衷"]
  M5 --> P5["每個階段都是穩定的純量 LMS<br/>誤差可能被先校的參數吸收"]${STYLE}
  class M2,M3,M4,M5 focus`

/** eigen 分解把耦合的 2×2 迴路拆成兩條獨立的一階迴路（scalar LMS、無雜訊平均） */
export const CHART_EIGEN_MODES = String.raw`flowchart LR
  D["$\boldsymbol\delta_k$<br/>$\delta_1$、$\delta_2$ 互相耦合"] --> VT["$\times \mathbf V^T$<br/>投影到 eigenvector"]
  VT -- "$\xi_1 = (\delta_1 + \delta_2) / \sqrt2$<br/>共模" --> L1["$\times p_1 = 1 - \mu K_q\lambda_1$<br/>$\lambda_1 = 1 + \rho$：快"]
  VT -- "$\xi_2 = (\delta_1 - \delta_2) / \sqrt2$<br/>差模" --> L2["$\times p_2 = 1 - \mu K_q\lambda_2$<br/>$\lambda_2 = 1 - \rho$：慢"]
  L1 --> V["$\times \mathbf V$<br/>轉回參數座標"]
  L2 --> V
  V --> DN["$\boldsymbol\delta_{k+1}$"]${STYLE}
  class L1 ok
  class L2 warn`

/**
 * 每個模式的 loop gain = m_i × λ_i；scalar 與完整反矩陣並排（ρ = 0.99、K_q 正規化為 1）。
 * Mermaid 依宣告的相反順序排 subgraph：FU 先宣告，畫面上 Scalar 框在前（上）、Full inverse 框在後（下）；順序由 diagrams.test.tsx 鎖住。
 */
export const CHART_MODE_GAIN = String.raw`flowchart LR
  subgraph FU["② Full inverse：$\mathbf M_n = \gamma\,\mathbf R^{-1}$（$\gamma = 0.5$）"]
    direction LR
    A3["快模式<br/>$\lambda_1 = ${d(r.eig[0])}$"] --> B3["$\times m_1 = \gamma / \lambda_1 = ${d(r.eigMn[1])}$"] --> C3["loop gain $0.5$<br/>$p_1 = 0.5$"]
    A4["慢模式<br/>$\lambda_2 = ${d(r.eig[1])}$"] --> B4["$\times m_2 = \gamma / \lambda_2 = ${d(r.eigMn[0])}$"] --> C4["loop gain $0.5$<br/>$p_2 = 0.5$"]
  end
  subgraph SC["① Scalar：$\mathbf M_n = \mu K_q\,\mathbf I$（$\mu K_q = 0.5$）"]
    direction LR
    A1["快模式<br/>$\lambda_1 = ${d(r.eig[0])}$"] --> B1["$\times m_1 = 0.5$"] --> C1["loop gain $${d(1 - r.fast)}$<br/>$p_1 = ${d(r.fast)}$"]
    A2["慢模式<br/>$\lambda_2 = ${d(r.eig[1])}$"] --> B2["$\times m_2 = 0.5$"] --> C2["loop gain $${d(1 - r.slow)}$<br/>$p_2 = ${d(r.slow)}$"]
  end${STYLE}
  class C2 warn
  class B3,B4 focus
  class C3,C4 ok`

/** 598 與 5 的手算流程（F-10.3 → F-10.5） */
export const CHART_K95_FLOW = String.raw`flowchart LR
  R["$\rho = 0.99$<br/>$\mathbf R = \begin{bmatrix} 1 & \rho \cr \rho & 1 \end{bmatrix}$"] --> L["eigenvalue<br/>$\lambda = 1 \pm \rho = ${d(r.eig[0])}$、$${d(r.eig[1])}$"]
  L --> P["一般 LMS 的慢 pole<br/>$p = 1 - \mu K_q \times \lambda_{\min}$<br/>$= 1 - 0.5 \times ${d(r.eig[1])} = ${d(r.slow)}$"]
  P --> K["$k_{95} = \lceil \ln 0.05 \div \ln |p| \rceil$<br/>$= \lceil ${d(r.ln005, 5)} \div ${d(r.lnSlow, 5)} \rceil$<br/>$= \lceil ${d(r.blocksScalarReal, 4)} \rceil = ${r.blocksScalar}$"]
  L --> PF["完整反矩陣<br/>$p = 1 - \gamma = 0.5$<br/>（不必看 $\lambda$）"]
  PF --> KF["$k_{95} = \lceil \ln 0.05 \div \ln 0.5 \rceil$<br/>$= \lceil ${d(r.blocksFullReal, 4)} \rceil = ${r.blocksFull}$"]
  CHK(["先檢查單位<br/>$\mu$ 是 fs、$K_q$ 是 $\mathrm{fs}^{-1}$<br/>代進去的必須是 $\mu \times K_q$"]) -.-> P${STYLE}
  class K warn
  class KF ok
  class CHK focus`

/* ───────────── §10.4：雜訊代價 ───────────── */

/** 完整反矩陣在一個 eigen-mode 上的迴路；訊號繞一圈增益 γ，雜訊只經過 M（紅色） */
export const CHART_NOISE_PATH = String.raw`flowchart LR
  ACC(("＋")) -- "$\xi_i$（下一個 block）" --> Z["$z^{-1}$"]
  Z -- "$\xi_i$（第 $k$ 個 block）" --> S["$\times K_q\lambda_i$<br/>GMAC 沿這個方向<br/>看到的訊號<br/>慢模式 $\lambda_2 = ${d(r.eig[1])}$：很小"]
  S -- "＋" --> SUM(("＋"))
  N(["GMAC 雜訊 $\zeta_i$<br/>$\operatorname{Var} = \lambda_i / N$"]) -- "＋" --> SUM
  SUM --> M["$\times \gamma / (K_q\lambda_i)$<br/>反矩陣沿這個方向的增益<br/>$\gamma = 0.5$ 時：<br/>慢模式 $${d(r.eigMn[0])} / K_q$、<br/>快模式 $${d(r.eigMn[1])} / K_q$"]
  M -- "−" --> ACC
  Z -- "＋" --> ACC${STYLE}
  class N,M warn`

/** 穩態共變異的迴路（離散 Lyapunov 方程 F-10.15） */
export const CHART_LYAPUNOV = String.raw`flowchart LR
  Q(["每個 block 的新雜訊<br/>$\operatorname{Cov}(\boldsymbol\eta_k) \approx \mathbf R_x / N$"]) --> MQ["$\mathbf M\,(\mathbf R_x / N)\,\mathbf M^T$<br/>經過更新矩陣後注入"]
  MQ -- "＋" --> S(("＋"))
  S -- "$\mathbf X_{k+1}$" --> Z["$z^{-1}$<br/>延遲一個 block"]
  Z -- "$\mathbf X_k = \operatorname{Cov}(\boldsymbol\delta_k)$" --> AX["$\mathbf A\,\mathbf X_k\,\mathbf A^T$<br/>舊的散布被迴路縮小"]
  AX -- "＋" --> S${STYLE}
  class MQ warn
  class AX ok`

/** 慢模式上三種增益 m 的比較（598 / 5 / 65 與每參數 RMS） */
export const CHART_REG_COMPARE = String.raw`flowchart LR
  IN["慢模式<br/>$\lambda_{\min} = ${d(r.eig[1])}$"]
  IN --> A["一般 LMS<br/>$m = \mu K_q = 0.5$"]
  IN --> B["完整反矩陣<br/>$m = \gamma / \lambda_{\min} = ${d(r.eigMn[0])}$"]
  IN --> C["Regularized<br/>$m = \gamma / (\lambda_{\min} + \lambda_{\mathrm{reg}}) = ${d(0.5 / (r.eig[1] + 0.1))}$"]
  A --> A2["$p = ${d(r.slow)}$，$k_{95} = ${r.blocksScalar}$<br/>$\mathrm{RMS}(\delta_j) = ${d(Math.sqrt(z.scalarPerParam[0]))}\ \mathrm{fs}$<br/>安靜但很慢"]
  B --> B2["$p = 0.5$，$k_{95} = ${r.blocksFull}$<br/>$\mathrm{RMS}(\delta_j) = ${d(Math.sqrt(z.perParam[0]))}\ \mathrm{fs}$<br/>很快但很吵"]
  C --> C2["$p = ${d(r.regSlowPole)}$，$k_{95} = ${r.blocksReg}$<br/>$\mathrm{RMS}(\delta_j) = ${d(Math.sqrt(z.regPerParam[0]))}\ \mathrm{fs}$<br/>折衷"]${STYLE}
  class C focus
  class C2 ok`

/* ───────────── §10.5：Jacobian ───────────── */

/**
 * 中央差分量測 Ĵ 的狀態機（Freeze → +Δ → −Δ → 斜率，對每個參數重複）。
 * 狀態描述（雙引號）可以含 `$...$`；轉移的文字不在雙引號裡，要放公式就整句寫成單一 `$$\text{…}…$$`（共用的前處理只認得雙引號標籤）。
 */
export const CHART_JACOBIAN_FSM = String.raw`stateDiagram-v2
  direction TB
  state "FREEZE：所有係數停止更新" as FREEZE
  state "PLUS：把 $w_j$ 加上 $\Delta_j$，平均 $N_J$ 個 sample，記下 $G^+$" as PLUS
  state "MINUS：把 $w_j$ 減去 $\Delta_j$，平均 $N_J$ 個 sample，記下 $G^-$" as MINUS
  state "SLOPE：$\hat{\mathbf J}$ 的第 $j$ 欄 $= (G^+ - G^-) \div (2\Delta_j)$，$w_j$ 放回原值" as SLOPE
  state "BUILD：用 $\hat{\mathbf J}$ 建構 $\mathbf M$，解除 Freeze" as BUILD
  [*] --> FREEZE
  FREEZE --> PLUS : $$\text{從 }j = 1\text{ 開始}$$
  PLUS --> MINUS
  MINUS --> SLOPE
  SLOPE --> PLUS : $$\text{換下一個參數 }j$$
  SLOPE --> BUILD : $$P\text{ 欄都量完}$$
  BUILD --> [*]`

/** 擾動 Δ 的 bias–variance 兩難（F-10.14 與 std(Ĵ)） */
export const CHART_FD_TRADEOFF = String.raw`flowchart LR
  D["擾動大小 $\Delta$"] --> S["$\Delta$ 太小<br/>例：$0.1\,\sigma_v$"]
  D --> M["$\Delta \approx 0.3\,\sigma_v$"]
  D --> L["$\Delta$ 太大<br/>例：$1\,\sigma_v$"]
  S --> S2["$G^+ - G^-$ 隨 $\Delta$ 變小，GMAC 雜訊卻不變<br/>$N_J = 4096$ 時 $\operatorname{std}(\hat{\mathbf J} / K_q) = ${d(fdRow(0.1).stdNj4096, 3)}$<br/>（$\mathbf J / K_q$ 的真值最大是 $1$）"]
  M --> M2["截斷係數 $${d(fdRow(0.3).pm1)}$（$\pm1$ 碼）：只少約 1.5%<br/>$\operatorname{std}(\hat{\mathbf J} / K_q) = ${d(fdRow(0.3).stdNj4096, 3)}$，可再用 $N_J$ 壓低"]
  L --> L2["comparator 飽和，erf 變平<br/>截斷係數 $${d(fdRow(1).pm1)}$（$\pm1$ 碼）：斜率被低估約 ${d(100 * (1 - fdRow(1).pm1), 2)}%"]${STYLE}
  class S2,L2 warn
  class M,M2 ok`

/** A_cal = I + M(Ĵ)·J 的穩定性檢查流程（勘誤 E24：M 用 Ĵ 建構，迴路乘真正的 J） */
export const CHART_ACAL_CHECK = String.raw`flowchart TB
  JH["量到的 $\hat{\mathbf J}$<br/>有雜訊、有截斷"] --> BM["建構 $\mathbf M(\hat{\mathbf J})$<br/>例：$-\gamma\,\hat{\mathbf J}^{-1}$"]
  JT["晶片真正的 $\mathbf J$<br/>隨 FCW、PVT 改變"] --> AC["$\mathbf A_{\mathrm{cal}} = \mathbf I + \mathbf M(\hat{\mathbf J})\,\mathbf J$"]
  BM --> AC
  AC --> EIG["poles $p_i = \operatorname{eig}(\mathbf A_{\mathrm{cal}})$<br/>$\rho(\mathbf A_{\mathrm{cal}}) =$ 最大的 $|p_i|$"]
  EIG --> Q{"$\rho(\mathbf A_{\mathrm{cal}})$ 小於 1 ?"}
  Q -- "是" --> OK["平均誤差收斂<br/>速度由最大的 $|p_i|$ 決定"]
  Q -- "否" --> NG["發散或停在臨界<br/>加 $\lambda_{\mathrm{reg}}$、降 $\gamma$，或重新量 $\hat{\mathbf J}$"]${STYLE}
  class AC focus
  class OK ok
  class NG warn`

/**
 * regularized pseudoinverse 的 SVD 分解（F-10.10）；U 與 Uᵀ 相消後每個模式只剩一個純量增益。
 * 十一個方塊排成一列太寬（> 1300px），所以拆成兩個框、框內由上往下，兩框並排：① 的輸出 E[G_k]（綠）就是 ② 的輸入 G_k（綠，多了量測雜訊）。
 * 兩框之間沒有連線；PLANT 後宣告，畫面上排在左邊（頂層 TB 時 Mermaid 依宣告的相反順序由左到右排沒有連線的框，由 diagrams.test.tsx 鎖住）。
 */
export const CHART_PINV_SVD = String.raw`flowchart TB
  subgraph UPD["② 更新矩陣：$\mathbf M = -\gamma\,(\mathbf J^T\mathbf J + \lambda_{\mathrm{reg}}\mathbf I)^{-1}\mathbf J^T$"]
    direction TB
    GK["GMAC 量到的 $\mathbf G_k$"] --> UT["$\times \mathbf U^T$"] --> INV["$\times \sigma_i / (\sigma_i^2 + \lambda_{\mathrm{reg}})$<br/>加了 $\lambda_{\mathrm{reg}}$ 的除法"] --> V["$\times \mathbf V$"] --> GM["$\times (-\gamma)$"] --> OUT["$\boldsymbol\epsilon_{k+1} = \boldsymbol\epsilon_k + \mathbf M\,\mathbf G_k$<br/>模式 $i$ 乘上 $1 - \gamma\sigma_i^2 / (\sigma_i^2 + \lambda_{\mathrm{reg}})$"]
  end
  subgraph PLANT["① 晶片：$\mathbf J = \mathbf U\boldsymbol\Sigma\mathbf V^T$"]
    direction TB
    E["$\boldsymbol\epsilon_k = \mathbf w_k - \mathbf w^*$"] --> VT["$\times \mathbf V^T$<br/>拆成模式"] --> SG["$\times \sigma_i$<br/>模式 $i$ 的斜率"] --> U["$\times \mathbf U$"] --> EG["$E[\mathbf G_k] = \mathbf J\,\boldsymbol\epsilon_k$"]
  end${STYLE}
  class INV focus
  class EG,GK ok`

/**
 * T18 的訊號流（ε = w − w*）；紅色交叉路徑的斜率 +2 比自己的 −1 大。
 * 回授（更新後的 w 回到最左邊）不畫成箭頭：有回授時 dagre 會把 2×2 的結構拉成一長串，反而看不出「自己 vs 交叉」。
 */
export const CHART_T18_COUPLING = String.raw`flowchart LR
  E1["$\epsilon_1 = w_1 - w_1^*$"] --> J11["$\times J_{11} = ${d(t.J[0][0])}$<br/>自己的斜率：把 $w_1$ 拉回去"]
  E2["$\epsilon_2 = w_2 - w_2^*$"] --> J12["$\times J_{12} = +${d(t.J[0][1])}$<br/>耦合：把 $w_1$ 往外推"]
  E1 --> J21["$\times J_{21} = +${d(t.J[1][0])}$<br/>耦合：把 $w_2$ 往外推"]
  E2 --> J22["$\times J_{22} = ${d(t.J[1][1])}$<br/>自己的斜率：把 $w_2$ 拉回去"]
  J11 -- "＋" --> S1(("＋"))
  J12 -- "＋" --> S1
  J21 -- "＋" --> S2(("＋"))
  J22 -- "＋" --> S2
  S1 -- "$G_1$" --> M1["$\times \mu = 0.2$"]
  S2 -- "$G_2$" --> M2["$\times \mu = 0.2$"]
  M1 --> W1["$w_1 \leftarrow w_1 + 0.2\,G_1$<br/>成為下一個 block 的 $\epsilon_1$"]
  M2 --> W2["$w_2 \leftarrow w_2 + 0.2\,G_2$<br/>成為下一個 block 的 $\epsilon_2$"]${STYLE}
  class J12,J21 warn`

/** 同一個 J 的三種看法——只開一個 loop／一起開的共模／一起開的差模 */
export const CHART_T18_MODES = String.raw`flowchart LR
  subgraph BOTH["② 兩個 loop 一起更新"]
    direction LR
    B1["共模：$\epsilon_1 = \epsilon_2$<br/>斜率 $J_{11} + J_{12} = ${d(t.J[0][0])} + ${d(t.J[0][1])} = +${d(t.eigJ[0])}$"] --> B2["$p = 1 + 0.2 \times (+${d(t.eigJ[0])}) = ${d(t.poles[0])}$<br/>每個 block 放大 ${d(t.poles[0])} 倍"]
    C1["差模：$\epsilon_1 = -\epsilon_2$<br/>斜率 $J_{11} - J_{12} = ${d(t.J[0][0])} - ${d(t.J[0][1])} = ${d(t.eigJ[1])}$"] --> C2["$p = 1 + 0.2 \times (${d(t.eigJ[1])}) = ${d(t.poles[1])}$<br/>穩定"]
  end
  subgraph ONE["① 只開一個 loop（另一個凍結）"]
    direction LR
    A1["只看得到 $J_{11} = ${d(t.J[0][0])}$"] --> A2["$p = 1 + 0.2 \times (${d(t.J[0][0])}) = ${d(1 + 0.2 * t.J[0][0])}$<br/>穩定"]
  end${STYLE}
  class A2,C2 ok
  class B2 warn`

/* ───────────── §10.6–§10.8：架構 ───────────── */

/** Block NLMS 的正規化方塊——所有通道除以同一個總能量 tr R */
export const CHART_NLMS = String.raw`flowchart LR
  X["GMAC code $\mathbf x[n]$<br/>$P$ 個"] --> EN["能量估計<br/>把 $x_1^2 + \cdots + x_P^2$ 取平均<br/>$= \operatorname{tr}\mathbf R_x$（匹配時 $= \operatorname{tr}\mathbf R$）"]
  G["GMAC 輸出 $\mathbf G_k$<br/>$P$ 個"] --> DIV["$\times \tilde\mu \div (K_q \operatorname{tr}\mathbf R)$<br/>每個通道乘同一個數"]
  EN --> DIV
  DIV --> RES["$\mathbf w_{k+1} = \mathbf w_k + \mathbf M\,\mathbf G_k$<br/>$\mathbf M = \tilde\mu / (K_q \operatorname{tr}\mathbf R) \times \mathbf I$，仍然正比於 $\mathbf I$<br/>$p_i = 1 - \tilde\mu\lambda_i / \operatorname{tr}\mathbf R$"]${STYLE}
  class DIV focus
  class RES warn`

/** sequential calibration 的狀態機（P = 2；對應 mSequential） */
export const CHART_SEQ_FSM = String.raw`stateDiagram-v2
  direction TB
  state "階段 1：只更新 $w_1$，$w_2$ 凍結" as CAL1
  state "階段 2：只更新 $w_2$，$w_1$ 凍結" as CAL2
  state "全部凍結：$\mathbf M = \mathbf 0$" as DONE
  [*] --> CAL1
  CAL1 --> CAL2 : 跑滿這個階段的 block 數
  CAL2 --> CAL1 : 還有下一輪
  CAL2 --> DONE : 輪數用完
  DONE --> [*]`

/** ρ = 1 的陷阱——comparator 只看得到 δ₁ + δ₂，先校的 w₁ 吸收全部誤差 */
export const CHART_SEQ_TRAP = String.raw`flowchart TB
  E["$u_1 = u_2 = u$（$\rho = 1$）<br/>$e[n] = u[n]\,(\delta_1 + \delta_2) + v[n]$<br/>comparator 只看得到 $\delta_1 + \delta_2$"]
  E --> P1["階段 1：只動 $w_1$<br/>$G_1$ 正比於 $\delta_1 + \delta_2$，一路推到 $\delta_1 + \delta_2 = 0$"]
  P1 --> R1["$w_1 = a_1 + a_2 = ${d(s.a[0] + s.a[1])}$<br/>正確值是 $a_1 = ${d(s.a[0])}$"]
  R1 --> P2["階段 2：只動 $w_2$<br/>$G_2$ 正比於 $\delta_1 + \delta_2 = 0$，所以不動"]
  P2 --> R2["$w_2 = 0$<br/>正確值是 $a_2 = ${d(s.a[1])}$"]
  R2 --> OUT["輸出誤差 $\delta_1 + \delta_2 = 0$<br/>看起來已經校好"]
  OUT --> FCW["換 FCW 之後 $u_1 \ne u_2$<br/>$\boldsymbol\delta = (${d(-s.a[1])}, +${d(s.a[1])})$ 現形"]${STYLE}
  class R1,R2,FCW warn
  class OUT ok`

/**
 * Gauss–Seidel 的一輪（P = 2、γ = 1、每階段一個 block）：階段 1 把 G₁ 歸零 ⇒ δ₁′ = −ρ·δ₂；階段 2 把 G₂ 歸零 ⇒ δ₂′ = −ρ·δ₁′ = ρ²·δ₂。
 * G₁ ∝ δ₁ + ρ·δ₂、G₂ ∝ ρ·δ₁ + δ₂ 就是 F-10.1（R = [[1, ρ], [ρ, 1]]）。
 */
export const CHART_GS_SWEEP = String.raw`flowchart TB
  S0["一輪開始<br/>誤差 $\delta_1$、$\delta_2$"] --> P1["階段 1：只動 $w_1$（$\gamma = 1$）<br/>一步把 $G_1 \propto \delta_1 + \rho\,\delta_2$ 推到 $0$"]
  P1 -- "$\delta_1' = -\rho\,\delta_2$" --> P2["階段 2：只動 $w_2$（$\gamma = 1$）<br/>一步把 $G_2 \propto \rho\,\delta_1' + \delta_2$ 推到 $0$"]
  P2 -- "$\delta_2' = -\rho\,\delta_1' = \rho^2\delta_2$" --> E["一輪結束<br/>$\delta_2$ 只乘了 $\rho^2$<br/>$\rho = 0.99$：$\rho^2 = ${d(s.gsSweep)}$"]
  E -. "下一輪：再乘一次 $\rho^2$" .-> P1${STYLE}
  class E warn`

/** 把本章結論排成選擇流程（整理用） */
export const CHART_CHOOSE_M = String.raw`flowchart TB
  Q1{"$\lambda_{\min}$ 接近 $0$ ?<br/>regressor 幾乎完全相關"}
  Q1 -- "是" --> N1["不可辨識<br/>任何 $\mathbf M$ 都不能製造缺失的資訊"]
  Q1 -- "否" --> Q2{"$\mathbf J$ 的 eigenvalue<br/>實部全部為負 ?"}
  Q2 -- "否，例如 T18" --> N2["Scalar LMS 對任何 $\mu \gt 0$ 都發散<br/>用 $-\gamma\,\mathbf J^{-1}$ 或 regularized pinv 修正極性"]
  Q2 -- "是" --> Q3{"$\kappa = \lambda_{\max} / \lambda_{\min}$ 很大，<br/>而且等不起慢模式 ?"}
  Q3 -- "否" --> N3["Scalar LMS 就夠<br/>各參數功率不同用 Diagonal<br/>code 振幅會變用 NLMS"]
  Q3 -- "是" --> N4["Regularized preconditioner<br/>$\lambda_{\mathrm{reg}}$ 依雜訊預算與 $\hat{\mathbf J}$ 的誤差選"]
  N4 --> N5["$\lambda_{\mathrm{reg}}$ 趨近 $0$ 就是完整反矩陣<br/>最快，雜訊最大，對 $\hat{\mathbf J}$ 誤差最敏感"]${STYLE}
  class N1,N2 warn
  class N3,N4 ok`

/** 程式碼的資料流（六個規則函式 → M_n → blockUpdate） */
export const CHART_CODE_FLOW = String.raw`flowchart TB
  JH["$\hat{\mathbf J}_n = \hat{\mathbf J} / K_q$<br/>匹配模型時 $= -\mathbf R$"] --> RULE["mScalar / mDiagonal<br/>mNlms / mFull<br/>mRegularized / mSequential"]
  D["$\boldsymbol\delta_k$"] --> GM["gmacLinear 或 gmacSample<br/>$\mathbf G_k = K_q\mathbf C\boldsymbol\delta_k + \boldsymbol\eta_k$"]
  RULE -- "$\mathbf M_n = K_q\mathbf M$（無因次）" --> BU["blockUpdate<br/>$\boldsymbol\delta_{k+1} = \boldsymbol\delta_k - (\mathbf M_n / K_q)\,\mathbf G_k$"]
  GM -- "$\mathbf G_k$" --> BU
  BU --> NX["$\boldsymbol\delta_{k+1}$<br/>下一個 block 再走一次"]${STYLE}
  class RULE focus`

/* ───────────── 章末 ───────────── */

/** 綜合手算 HC-10.8 的計算順序 */
export const CHART_HANDCALC_FLOW = String.raw`flowchart TB
  A["$\lambda_{\min} = 1 - |\rho|$"] --> B["$K_q = \sqrt{2/\pi} \div \sigma_v$"]
  B --> C["$K_q^2 \times N$<br/>變異公式的共同分母"]
  C --> M["選更新矩陣，算慢方向的增益 $m$<br/>一般 LMS：$m = \mu K_q$<br/>完整反矩陣：$m = \gamma \div \lambda_{\min}$<br/>Regularized：$m = \gamma \div (\lambda_{\min} + \lambda_{\mathrm{reg}})$"]
  M --> P["$p = 1 - m \times \lambda_{\min}$"]
  P --> K["$k_{95} = \lceil \ln 0.05 \div \ln |p| \rceil$<br/>預設數字：${r.blocksScalar} / ${r.blocksFull} / ${r.blocksReg}"]
  P --> Q["$1 - p^2 = (1 - p) \times (1 + p)$"]
  Q --> V["$\operatorname{Var}(\xi_{\mathrm{slow}}) = m^2 \times \lambda_{\min} \div \big(K_q^2 \times N \times (1 - p^2)\big)$<br/>預設數字：$${d(z.scalarModeVar[1])}$ / $${d(z.modeVar[1])}$ / $${d(z.regModeVar[1])}\ \mathrm{fs}^2$"]${STYLE}
  class M focus`

/** 硬體對應（藍色 = 本章新增的 P×P 混合矩陣；虛線 = 韌體／測試機的慢速路徑） */
export const CHART_HW_MAP = String.raw`flowchart TB
  CMP["BBPD / 1-bit comparator<br/>$q[n] = \pm1$"] --> G1["GMAC accumulator 1<br/>GOS"]
  CMP --> G2["GMAC accumulator 2<br/>PHOS"]
  CMP --> G3["GMAC accumulator 3<br/>DTC gain"]
  G1 --> MIX["$P \times P$ 混合矩陣 $\mathbf M$<br/>$P^2$ 個乘加或 LUT<br/>scalar / diagonal 只要 shift"]
  G2 --> MIX
  G3 --> MIX
  MIX --> ACC["$P$ 個係數暫存器 $\mathbf w$"]
  ACC --> DTC["DTC / PMUX 補償"]
  DTC -. "經 PLL error path" .-> CMP
  FW["韌體或測試機的 FSM<br/>Freeze、$\pm\Delta$、量 $\hat{\mathbf J}$"] -. "寫入 $\mathbf M$、$\gamma$、$\lambda_{\mathrm{reg}}$" .-> MIX
  FW -. "Freeze 與 $\pm\Delta$" .-> ACC${STYLE}
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
    caption: String.raw`多參數 Block Sign-LMS 的整體架構（$P=3$）。要看藍色方塊：三個 GMAC 各用自己的 code $x_i[n]$ 去相關「同一個」comparator 輸出 $q[n]$；下面的更新矩陣 $\mathbf M$ 決定各 GMAC 的輸出如何分配到各校正係數。`,
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
    caption: String.raw`從 comparator 到 GMAC（由上往下）：上框每個 sample $n$ 做一次，下框每 $N$ 個 sample 才輸出一個 $G_{i,k}$。要看的是藍色方塊：兩個 GMAC 吃的是同一個 $q[n]$。`,
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
    caption: String.raw`GMAC 雜訊 $\boldsymbol\eta_k$ 從哪裡來（由上往下）：上框每個 sample 的乘積 $q[n]\,\mathbf x[n]$ 平均很小、抖動卻有 $\mathbf R$ 那麼大；下框平均 $N$ 個之後，抖動的共變異剩下 $\mathbf R/N$（藍）。紅色那一格是 §10.1 的數字。`,
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
