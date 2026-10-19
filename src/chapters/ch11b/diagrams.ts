import type { SystemBlock } from '@/components'
import { MASH_CODE_AUTOCORR, foldedPsdDc, foldedPsdDcLinearProcess, MASH_CODE_FIR, UNIFORM_KAPPA4, segmentClosedForm, lutClosedForm, modeAnalysis, uniformMomentMatrix, DEFAULT_STRUCTURE } from '@/simulation/models/dtcInl'
import { fmt } from '@/simulation/core'

/**
 * Ch11b 的方塊圖（docs/teaching-style.md §8）。每張圖的 Mermaid 原始碼是具名匯出的字串，diagrams.test.tsx 以真正的 mermaid
 * parser 解析、再以真正的 renderer（jsdom）畫一次，並逐張核對圖上的數字、正負號與 dtcInl.ts 的模型一致。
 *
 * 圖裡面的數學一律寫 LaTeX：雙引號標籤裡寫 `$…$`，由共用 `Mermaid` 元件用 KaTeX 排版；原始碼用 `String.raw`。
 * 加法點用全形「＋」與減號「−」（Mermaid 11 會把單獨的半形 + 當成 Markdown 清單）。
 * 架構照 docs/assumptions.md §2a：Reference → DTC → PD；回授只有 divider；LMS 的輸入從 PD 的輸出 e[n] 分接。
 * 圖內的數字一律由模型函式算出（d()），不手寫。
 */

/** 章首系統地圖要標成藍色的方塊：DTC（INL 所在）、PD、DSM／餘數（code 的頻譜）、comparator、GMAC、gain accumulator（多參數版） */
export const SYSTEM_MAP_FOCUS: SystemBlock[] = ['dtc', 'pd', 'dsm', 'res', 'cmp', 'gmac', 'acc']

const STYLE = `  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff
  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff`

/** 圖內數字（TeX） */
function d(x: number, digits = 4): string {
  const s = fmt(x, digits).replace('∞', '\\infty')
  const m = /^(-?[\d.]+)e([+-]?\d+)$/.exec(s)
  return m ? `${m[1]}\\times10^{${Number(m[2])}}` : s
}

/** 圖上用到的數字（與 handcalcs 的預設值相同：d_2 = 20、ν_B = 0.01、K = 8、J = 64、μ = 2、σ_v = 10、N = 64） */
export const NUM = {
  s2Gauss: foldedPsdDc(MASH_CODE_AUTOCORR, 2),
  s2Exact: foldedPsdDcLinearProcess(MASH_CODE_AUTOCORR, MASH_CODE_FIR, UNIFORM_KAPPA4),
  outer: segmentClosedForm(7, 8, 2, 10, 64),
  inner: segmentClosedForm(4, 8, 2, 10, 64),
  lut: lutClosedForm(64, 2, 10, 64),
  condMono: modeAnalysis(uniformMomentMatrix({ ...DEFAULT_STRUCTURE, structure: 'poly', M: 3, basis: 'monomial' }), 1, 1, 64).cond,
}

/* ───────────────────────── §11b.1 INL 模型 ───────────────────────── */

/**
 * 硬體視角：reference 端的 DTC 同時收到 gain 的補償量 w·x 與 INL 校正的補償量 c(x)；INL d(x) 在 DTC 裡多出來；
 * PD 量 t_ref′ − t_fb；comparator 取 PD 的輸出；GMAC 現在是一個向量（每個 regressor 一個累加器）。
 */
export const CHART_INL_MODEL = String.raw`flowchart TB
  REF["Reference clock"]
  GC["gain correction<br/>補償量 $w \cdot x$（Ch11）"]
  IC["INL corrector<br/>補償量 $c(x) = \sum_i \theta_i \varphi_i(x)$"]
  DTC["reference 端的 DTC<br/>$\tau_\mathrm{DTC} = T_0 - w \cdot x - c(x) + d(x)$<br/>$d(x)$：這個 code 多出來的延遲（INL）"]
  PD(("PD"))
  E(["PD 的輸出 $e[n] = (a - w) x + d(x) - c(x) + b + v$"])
  LF["主 PLL loop filter 與 VCO"]
  DIV["Divider<br/>feedback edge 早到 $a \cdot x$<br/>$t_\mathrm{fb} = -a \cdot x$"]
  DSM["DSM 餘數<br/>正規化 code $x[n] \in [-1, 1]$"]
  Q["1-bit comparator<br/>$q = \operatorname{sign}(e)$"]
  REG["regressor 產生器<br/>$\boldsymbol\psi(x) = [\varphi_1(x), \ldots, \varphi_P(x)]$<br/>（選段／查表／多項式）"]
  GMAC["向量 GMAC<br/>$\mathbf G = (1/N) \sum q \cdot \boldsymbol\psi$"]
  UPD["$\boldsymbol\theta \leftarrow \boldsymbol\theta + \mu \mathbf G$<br/>每 $N$ 個 sample"]
  REF --> DTC
  GC --> DTC
  IC --> DTC
  DTC -- "＋ $t_\mathrm{ref}'$" --> PD
  DIV -- "− $t_\mathrm{fb}$" --> PD
  PD --> E
  E -- "給主迴路" --> LF
  E -- "給校正迴路" --> Q
  LF -. "VCO 輸出" .-> DIV
  DSM -- "carry" --> DIV
  DSM -- "$x[n]$" --> GC
  DSM -- "$x[n]$" --> REG
  Q -- "$q[n]$" --> GMAC
  REG -- "$\boldsymbol\psi[n]$" --> GMAC
  GMAC -- "$\mathbf G$" --> UPD
  UPD -- "$\boldsymbol\theta$" --> IC
${STYLE}
  class IC,REG,GMAC focus
  class DTC warn`

/* ───────────────────────── §11b.2 噪聲折返 ───────────────────────── */

/**
 * 折返路徑：白色的 s_3/M 經 (1−z⁻¹)² 整形成 x（DC 為 0），線性的 gain 誤差保持整形；二次 INL 把 x 自己和自己混頻，
 * S_{x²} = 2 S_x ⊛ S_x 在 DC 不是 0，帶內的部分經主迴路（|T| ≈ 1）直接變成輸出 jitter。
 */
export const CHART_FOLDING_PATH = String.raw`flowchart TB
  U["第三級累加器 $u = s_3 / M$<br/>白色、uniform、$\sigma_u^2 = 1/12$"]
  NTF["整形 $-(1 - z^{-1})^2$，$\times \tfrac12$<br/>$h = [-\tfrac12, 1, -\tfrac12]$"]
  X["正規化 code $x[n]$<br/>$R_x = \tfrac1{48}[6, -4, 1]$，$S_x(0) = 0$（40 dB/dec）"]
  LIN["線性項 $(a - w) \cdot x$<br/>PSD $= (a-w)^2 S_x(\nu)$：仍是整形的，帶內 $\approx 0$"]
  SQ["二次 INL $d_2 \cdot x^2$<br/>自己乘自己 = 混頻"]
  SY["$S_{x^2}(\nu) = 2\,(S_x \circledast S_x)(\nu)$<br/>$S_{x^2}(0) = 2 \sum_m R_x[m]^2 = ${d(NUM.s2Gauss, 4)}$（Gaussian）<br/>$+\ \kappa_4 (\sum h^2)^2 \Rightarrow ${d(NUM.s2Exact, 4)}$（精確）"]
  IN["帶內功率 $P_\mathrm{in} = d_2^2 S_2(0) \cdot 2 \nu_B$<br/>$\nu_B = f_B / f_s$"]
  T["主 PLL $T(f)$：帶內 $|T| \approx 1$<br/>輸出 jitter $\sigma_{t,\mathrm{out}}^2 \approx P_\mathrm{in}$"]
  U --> NTF --> X
  X --> LIN
  X --> SQ
  SQ --> SY --> IN --> T
  LIN -. "被 $T$ 濾掉" .-> T
${STYLE}
  class SQ,SY warn
  class IN focus
  class LIN ok`

/* ───────────────────────── §11b.3 三種結構 ───────────────────────── */

/**
 * 分段選擇的 LMS 迴路（K 段）：x 決定段號 k，one-hot 讓只有第 k 個 GMAC 累加 q·x、只有 w_k 更新；
 * 補償量由同一個 mux 選出 w_k·x。每一段就是一個獨立的一階迴路，loop gain μK_qλ_k。
 */
export const CHART_PIECEWISE_LOOP = String.raw`flowchart TB
  X["code $x[n]$"] --> SEG["選段<br/>$k = \lfloor (x + 1) K / 2 \rfloor$"]
  SEG -- "one-hot $\mathbb 1_k$" --> REG["regressor $\varphi_k = \mathbb 1_k(x) \cdot x$<br/>（其餘為 0）"]
  REG -- "$\varphi_k$" --> G["$K$ 個 GMAC<br/>只有第 $k$ 個累加 $q \cdot x$"]
  Q["comparator<br/>$q = \operatorname{sign}(e)$"] -- "$q$" --> G
  G -- "$G_k$（每 $N$ 個 sample）" --> ACC["$w_k \leftarrow w_k + \mu G_k$<br/>$K$ 個 gain 暫存器"]
  ACC -- "$w_1 \ldots w_K$" --> MUX["mux：選 $w_k$"]
  SEG -- "$k$" --> MUX
  MUX -- "補償量 $w_k \cdot x$" --> DTC["DTC<br/>$T_0 - w_k \cdot x + d(x)$"]
  DTC -- "$e = (a + d(x)/x - w_k) \cdot x + v$" --> E["PD 的輸出 $e[n]$"]
  E --> Q
${STYLE}
  class SEG,REG,MUX focus
  class ACC ok`

/**
 * 三種結構並排成三欄（三條互不相連的直向鏈，dagre 會把它們並排）：regressor、R 的形狀（決定收斂）、硬體與近似誤差。
 * 數字：K = 8、J = 64、M = 3（uniform x）。不用 subgraph：subgraph 之間沒有邊時 Mermaid 會把它們橫排（寬 3000px 以上），有邊時內部的 direction 又會被忽略。
 */
export const CHART_STRUCTURES = String.raw`flowchart TB
  PW1["(a) 分段線性<br/>regressor $\mathbb 1_k(x) \cdot x$<br/>參數 $K = 8$"]
  PW2["$\mathbf R = \operatorname{diag}(\lambda_k)$<br/>$\lambda_k = (x_{k+1}^3 - x_k^3)/6$<br/>外段 $${d(NUM.outer.lambda, 4)}$<br/>內段 $${d(NUM.inner.lambda, 4)}$"]
  PW3["1 個乘法器 + mux<br/>$K$ 個暫存器<br/>近似誤差：段內曲率<br/>與段界跳變"]
  L1["(b) LUT<br/>regressor $\mathbb 1_j(x)$<br/>參數 $J = 64$"]
  L2["$\mathbf R = \operatorname{diag}(p_j)$<br/>$\tau_j = J / (\mu K_q)$<br/>$= ${d(NUM.lut.tau, 4)}$ blocks<br/>造訪少的格 $\tau_j$ 更長"]
  L3["沒有乘法器<br/>$J$ 個字的 RAM<br/>近似誤差<br/>$\Delta \sqrt{E[d'^2]/12}$"]
  P1["(c) 多項式基底<br/>regressor $\varphi_m(x)$<br/>參數 $M + 1 = 4$"]
  P2["monomial：Hankel<br/>$\kappa = ${d(NUM.condMono, 4)}$<br/>Legendre：$\kappa = 7$<br/>normalized：$\kappa = 1$"]
  P3["$M$ 個乘法器（Horner）<br/>$M + 1$ 個係數<br/>近似誤差：<br/>$M$ 階以上的 INL"]
  PW1 --> PW2 --> PW3
  L1 --> L2 --> L3
  P1 --> P2 --> P3
${STYLE}
  class PW2,L2,P2 focus`

/* ───────────────────────── §11b.4 可辨識性 ───────────────────────── */

/**
 * Gauge：哪些方向 comparator 看不到。(1) gain w 與分段／多項式的 x 方向共線；(2) LUT 的整體 offset 與 PD offset b 共線；
 * (3) 沒被 code 造訪的段／格（MASH 外側）根本沒有 regressor。總補償量仍唯一，只有參數的分配不唯一。
 */
export const CHART_GAUGE = String.raw`flowchart TB
  E["comparator 只看得到<br/>總補償量 $w \cdot x + c(x)$ 與 $b$ 的和"]
  subgraph G1["(1) gain 方向：$\sum_k \mathbb 1_k(x) \cdot x = x$"]
    direction TB
    A1["$w \to w + \epsilon$，所有 $w_k \to w_k - \epsilon$<br/>$e$ 不變"]
    A2["$\mathbf R_{[x, \varphi]}$ 奇異，$\lambda_{\min} = 0$<br/>$w$ 與 $\{w_k\}$ 沿著這條線隨機漫步"]
    A1 --> A2
  end
  subgraph G2["(2) offset 方向：$\sum_j \mathbb 1_j(x) = 1$"]
    direction TB
    B1["LUT 全部 $+\epsilon$，$b \to b - \epsilon$<br/>$e$ 不變"]
    B2["LUT 的整體 offset 與 PD offset 不可分<br/>（Ch11 §11.1、Ch09 F-09.13）"]
    B1 --> B2
  end
  subgraph G3["(3) 沒有樣本的段／格"]
    direction TB
    C1["MASH 的 $x$ 集中在 $|x| \lesssim 0.6$<br/>外側格 $p_j \approx 0$"]
    C2["regressor 恆為 0：參數不更新<br/>缺乏 persistent excitation（Ch09）"]
    C1 --> C2
  end
  E --> G1
  E --> G2
  E --> G3
  FIX["修法：固定 gauge（$w$ 固定或 LUT 減掉平均）、<br/>把段界對準 code 的分布、或只用有樣本的格"]
  G1 --> FIX
  G2 --> FIX
  G3 --> FIX
${STYLE}
  class A2,B2,C2 warn
  class FIX ok`

/* ───────────────────────── 綜合手算流程 ───────────────────────── */

/** HC-11B.5 的計算順序。 */
export const CHART_HANDCALC_FLOW = String.raw`flowchart TB
  S1["① gain 校正吸收 $\tfrac35 d_3$<br/>剩下 $E[r^2] = \tfrac{4 d_2^2}{45} + \tfrac{4 d_3^2}{175}$"]
  S2["② LUT 近似誤差<br/>floor $= \tfrac{2}{J}\sqrt{E[d'^2]/12}$"]
  S3["③ 時間常數<br/>$\tau_j = J / (\mu K_q)$，$k_{95}$"]
  S4["④ 穩態抖動<br/>$\operatorname{Var}(\theta_j) = \mu^2 \lambda_j / (N(1 - p_j^2))$"]
  S5["⑤ 校正後殘餘<br/>$\sigma_{r,\infty} = \sqrt{\text{floor}^2 + \sum_j \lambda_j \operatorname{Var}(\theta_j)}$"]
  S6["⑥ 判斷：抖動 ＞ floor ⇒ 降 $\mu$；<br/>floor ＞ 抖動 ⇒ 加格數（$\tau_j \propto J$）"]
  S1 --> S2
  S1 --> S3
  S3 --> S4
  S2 --> S5
  S4 --> S5
  S5 --> S6
${STYLE}
  class S5 focus
  class S6 ok`

export interface Ch11bDiagram {
  /** 頁面上的錨點為 `ch11b-fig-<id>` */
  id: string
  name: string
  title: string
  /** 這張圖所在的 Section（DOM id） */
  section: string
  chart: string
  caption: string
}

/** 登錄表 = 頁面上的順序（圖 11b-1 … 11b-N）。 */
export const CH11B_DIAGRAMS = [
  {
    id: 'inl-model',
    name: 'CHART_INL_MODEL',
    title: 'INL 校正的硬體視角：gain 與 INL 兩種補償量都從 $T_0$ 往回扣',
    section: 'ch11b-model',
    chart: CHART_INL_MODEL,
    caption: String.raw`先看 DTC 方塊：延遲 $T_0-w\,x-c(x)+d(x)$——$w\,x$ 是 Ch11 的 gain 補償量，$c(x)$ 是本章的 INL 補償量，$d(x)$ 是 DTC 自己多出來的 INL。再看下半：comparator 仍然只取 PD 的輸出 $e[n]$；新的是 regressor 產生器把 $x$ 變成向量 $\boldsymbol\psi$，GMAC 也變成向量（每個參數一個累加器）。`,
  },
  {
    id: 'folding-path',
    name: 'CHART_FOLDING_PATH',
    title: '噪聲折返的路徑：線性項守住整形，二次項把 $x$ 和自己混頻',
    section: 'ch11b-folding',
    chart: CHART_FOLDING_PATH,
    caption: String.raw`先看左邊：白色的 $u$ 經 $(1-z^{-1})^2$ 整形後，$x$ 的 PSD 在 DC 是 0。再看分岔：線性的 gain 誤差保持整形（綠色，被 $T$ 濾掉）；二次 INL 是 $x$ 乘 $x$（紅色），PSD 變成自己和自己的卷積，在 DC 是 $2\sum R_x^2$，帶內的部分（藍色）經主迴路直接變成輸出 jitter。`,
  },
  {
    id: 'piecewise-loop',
    name: 'CHART_PIECEWISE_LOOP',
    title: '分段選擇的 LMS 迴路：one-hot 讓每一段各自是一個一階迴路',
    section: 'ch11b-structures',
    chart: CHART_PIECEWISE_LOOP,
    caption: String.raw`先看上面：$x$ 決定段號 $k$，regressor 只在第 $k$ 個位置是 $x$、其餘是 0，所以只有第 $k$ 個 GMAC 累加、只有 $w_k$ 更新。再看下面的回授：mux 用同一個 $k$ 選出 $w_k$，補償量 $w_k\,x$ 從 $T_0$ 往回扣，PD 看到的是 $(a+d(x)/x-w_k)\,x+v$——每一段都在學「這一段的有效 gain」。`,
  },
  {
    id: 'structures',
    name: 'CHART_STRUCTURES',
    title: '三種校正結構並排：regressor、相關矩陣、硬體與近似誤差',
    section: 'ch11b-structures',
    chart: CHART_STRUCTURES,
    caption: String.raw`三欄由上到下都是「regressor → $\mathbf R$ 的形狀（決定收斂）→ 硬體與近似誤差」。藍色方塊是本章的主角：分段與 LUT 的 $\mathbf R$ 天生對角（每段／每格獨立），慢的是 $\lambda_k$ 小的段；多項式的 $\mathbf R$ 不對角，慢的是弱方向——換 Legendre 基底就把 $\kappa$ 從 $${d(NUM.condMono, 4)}$ 降到 7。`,
  },
  {
    id: 'gauge',
    name: 'CHART_GAUGE',
    title: '可辨識性：comparator 看不到的三種方向',
    section: 'ch11b-identifiability',
    chart: CHART_GAUGE,
    caption: String.raw`先看最上面：comparator 只看得到總補償量，所以任何「不改變總和」的參數搬移都看不到。三個紅色方塊各是一種：gain 與分段的 $x$ 方向共線（$\lambda_{\min}=0$）、LUT 的整體 offset 與 PD offset 共線、以及根本沒有樣本的格。綠色是修法。`,
  },
  {
    id: 'handcalc-flow',
    name: 'CHART_HANDCALC_FLOW',
    title: '綜合手算的順序：殘餘 INL → 近似誤差與時間常數 → 校正後的殘餘',
    section: 'ch11b-synthesis',
    chart: CHART_HANDCALC_FLOW,
    caption: String.raw`① 先算只做 gain 校正剩下多少；② 與 ③④ 是兩條平行的路（結構的近似誤差、LMS 的速度與抖動）；⑤ 把兩者平方相加；⑥ 看哪一個主導決定下一步調什麼。`,
  },
] as const satisfies readonly Ch11bDiagram[]

export type Ch11bDiagramId = (typeof CH11B_DIAGRAMS)[number]['id']
