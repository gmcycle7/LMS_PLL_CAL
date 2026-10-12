/**
 * Models 頁的方塊圖（Mermaid 原始碼；docs/teaching-style.md §8）。
 *
 * 規則：
 * - 圖內的數學一律寫 LaTeX（使用者要求，2026-10-11）：節點與連線的「雙引號標籤」裡把數學放在 `$...$`，文字照常寫，
 *   由共用的 <Mermaid> 用 KaTeX 排版。所以每張圖的原始碼都用 `String.raw`（TeX 的反斜線只寫一次）；
 *   標籤內不寫 `\\`（Mermaid 會收成一個反斜線），換行用 `<br/>`；也不直接寫 `<`、`>`（用 `\lt`、`\gt`）。
 *   單位與名稱（fs、GMAC、DTC、gain register…）照舊寫成文字。含括號、冒號、等號等特殊字元的標籤一律用雙引號包住。
 * - 加法點用圓形節點「＋」，每條進來的邊標正負號：正號寫全形「＋」、負號寫「−」（U+2212）；
 *   正負號後面還有說明文字時，負號寫成 `$-$`（KaTeX 的文字模式不認得 U+2212，會在主控台警告）。
 *   Mermaid 11 把標籤當 Markdown：單獨的 ASCII「+」「-」會被當成清單，畫面上變成「Unsupported markdown: list」。
 * - 每張圖的訊號名稱、正負號、箭頭方向與取樣率（sample n／block k）都和頁面上的公式、以及 blockLms.ts 實際執行的程式一致；
 *   diagrams.test.tsx 以真正的 mermaid parser 解析每一張，並逐條核對。
 * - 顏色（深淺主題都看得清楚）：藍 = 這一段的主角；綠 = 本站已完整實作；紅 = 未實作／容易出錯的地方。
 * - 版面（docs/teaching-style.md §8）：桌機正文欄約 900px，圖要完整放進去、不需要橫向捲動。階梯圖用 `flowchart LR`（長文字換行後約 950px）；
 *   兩層迴圈是由上到下（內層在上、外層在下，`flowchart TB`）；datapath 折成三列（每列一個 `direction LR` 的 subgraph），列與列之間的連線畫在 subgraph 之間
 *   （Mermaid 只要 subgraph 裡有節點連到外面，就會忽略它自己的 direction，所以跨列的箭頭不能從節點拉出去）。
 */

const FOCUS = 'classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px'
const PASS = 'classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff,stroke-width:2px'
const WARN = 'classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff,stroke-width:2px'

/**
 * §2：模型層級 L0–L6 的階梯（規格 §15.1）。箭頭 = 「在前一層之上再加東西」。
 * 顏色對應 S2Levels 的實作程度：綠 = 已實作（L0、L1）、紅 = Not implemented（L6）、其餘是簡化版。
 */
export const LEVEL_CHART = String.raw`flowchart LR
  L0["L0 純量 LMS<br/>每 sample"] --> L1["L1 Block GMAC<br/>＋ Gaussian<br/>comparator"]
  L1 --> L2["L2 DTC residue<br/>＋ $H_{\mathrm{PD}} / T$"]
  L2 --> L3["L3 多參數<br/>＋ Jacobian"]
  L2 --> L4["L4 Noise PSD<br/>→ output<br/>jitter / spur"]
  L2 --> L5["L5 定點 /<br/>RTL-like"]
  L3 --> L6["L6 進階 PLL /<br/>DSM / FCW"]
  L4 --> L6
  L5 --> L6
  ${PASS}
  ${WARN}
  class L0,L1 ok
  class L6 warn`

/**
 * §3：參考 Block Sign-LMS 的兩層迴圈（F-15.1、F-15.2；blockLms.ts 的 core:blockLmsInnerLoop / blockLmsGmacUpdate）。
 * 內層（索引 $n$）：$dt = (a - w_{\mathrm{app}})\,x + \mathrm{nl}(x)$ → $H_{\mathrm{PD}}$（有狀態）→ $+\,b + v$ → sign → $q\,x_{\mathrm{ref}}$ 累加。
 * 外層（索引 $k$）：$G_k = \frac{1}{N}\sum$ → $w_{k+1} = w_k + \mu\,G_k$ → 晚 $d$ 個 block、量化後才作用到 DTC。
 * 架構照 docs/assumptions.md §2a：DTC 在 reference 的輸入端，$dt$ 是它補償之後剩下的時間誤差 $t_{\mathrm{ref}}' - t_{\mathrm{fb}}$（開迴路），
 * 在 PD 的 reference 輸入端進入主 PLL；$H_{\mathrm{PD}}$ 的輸出就是 PD 的輸出（送進 loop filter 的同一個訊號），comparator 取的是它。
 */
export const CHART_BLOCK_SIGN_LMS = String.raw`flowchart TB
  subgraph FS["內層迴圈：每個 comparator sample 做一次（索引 $n$）"]
    X(["code $x[n]$"]) --> DTC["DTC 的殘餘誤差<br/>（進 PD 的 reference 輸入端）<br/>$(a - w_{\mathrm{app}})\cdot x$<br/>$+ c_2\cdot x^2 + c_3\cdot x^3 + o$"]
    DTC --> HPD["PLL error path $H_{\mathrm{PD}}(z)$<br/>殘餘誤差 $\to$ PD 的輸出<br/>狀態跨 block 持續"]
    HPD -- "＋" --> S(("＋"))
    BV(["offset $b$ 與雜訊 $v[n]$<br/>$v$ 的 RMS $= \sigma_v$"]) -- "＋" --> S
    S -- "$e[n]$" --> CMP["1-bit comparator<br/>$e \ge 0$ 時 $q = +1$，否則 $q = -1$"]
    CMP -- "$q[n]$" --> MUL(("$\times$"))
    X -- "$x_{\mathrm{ref}}[n]$：$x$、$x[n-D]$ 或 filtered-$x$" --> MUL
  end
  subgraph FU["外層迴圈：每 $N$ 個 sample 做一次（索引 $k$）"]
    AVG["GMAC<br/>$G_k = \frac{1}{N}\sum q[n]\cdot x_{\mathrm{ref}}[n]$"] -- "$G_k$" --> UPD["更新<br/>$w_{k+1} = w_k + \mu\cdot G_k$"]
    UPD -- "$w_k$" --> REG["gain register<br/>$w_{\mathrm{app}} = \mathrm{phys}(w_{k-d})$"]
  end
  MUL -- "$q[n]\cdot x_{\mathrm{ref}}[n]$，共 $N$ 個" --> AVG
  REG -. "$w_{\mathrm{app}}$（整個 block 內不變）" .-> DTC
  ${FOCUS}
  class CMP,AVG focus`

/**
 * §9：GMAC 到 gain register 的 RTL datapath，以及 §16.1 前 8 項檢查各自落在哪一塊（F-16.1、F-16.3、F-16.4、F-16.5）。
 * $S_k$ 是 $N$ 筆的總和（整數）；$\hat G_k$ 是右移之後的值；$\ell = \log_2 N - F_G$。
 * 兩端照 docs/assumptions.md §2a 標明：comparator bit 是 PD 輸出 $e[n]$ 的正負號；gain register 的 code 送到 reference 端的 DTC（補償量 $w\cdot x$）。
 */
export const CHART_GMAC_DATAPATH = String.raw`flowchart TB
  subgraph R1["輸入整理：每個 sample"]
    direction LR
    B(["comparator bit $b[n]$<br/>PD 輸出 $e[n]$ 的正負號<br/>0 或 1"]) --> MAP["檢查 1：映射成 $\pm 1$<br/>$q = 2b - 1$"]
    X(["code $x_{\mathrm{int}}[n]$<br/>$B_x$-bit 有號整數"]) --> DLY["檢查 2：對齊<br/>$z^{-D}$，用 $x_{\mathrm{int}}[n-D]$"]
    MAP -- "$q[n]$" --> NEG["條件取負<br/>$q = -1$ 時取 $-x$<br/>先符號延伸到<br/>$B_x + 1$ bits"]
    DLY -- "$x_{\mathrm{int}}[n-D]$" --> NEG
  end
  subgraph R2["累加與右移"]
    direction LR
    ACC["檢查 3、7：累加 $N$ 筆<br/>每個 block 清零<br/>$S_k = \sum q\cdot x_{\mathrm{int}}$<br/>$B_{\mathrm{acc}} = 1 + \lceil \log_2(N\cdot M_x + 1)\rceil$ bits"] -- "$S_k$" --> SHIFT["檢查 4、5：右移<br/>$\ell = \log_2 N - F_G$ bits<br/>$\hat G_k = \Delta_G\cdot\lfloor S_k / 2^{\ell}\rfloor$"]
  end
  subgraph R3["更新 gain register"]
    direction LR
    MU["$\times \mu$<br/>shift 型：$\mu = 2^{-m}$"] -- "$\mu\cdot\hat G_k$" --> REG["檢查 6、8：gain register<br/>$w_{k+1} = w_k + \mu\cdot\hat G_k$<br/>內部小數 bit、saturate"]
    REG -- "高位的實體 code" --> DTC(["reference 端的 DTC<br/>補償量 $= w\cdot x$"])
  end
  R1 -- "$q\cdot x_{\mathrm{int}}$" --> R2
  R2 -- "$\hat G_k$" --> R3
  ${FOCUS}
  ${WARN}
  class ACC focus
  class SHIFT warn`

/** 頁面上的圖（依出現順序）；diagrams.test.tsx 逐一解析，並核對頁面真的畫了這幾張。 */
export const MODEL_CHARTS: { name: string; section: string; chart: string }[] = [
  { name: 'LEVEL_CHART', section: '§2', chart: LEVEL_CHART },
  { name: 'CHART_BLOCK_SIGN_LMS', section: '§3', chart: CHART_BLOCK_SIGN_LMS },
  { name: 'CHART_GMAC_DATAPATH', section: '§9', chart: CHART_GMAC_DATAPATH },
]
