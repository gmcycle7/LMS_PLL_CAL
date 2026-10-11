/**
 * Ch08 的 Mermaid 方塊圖原始碼（集中在這裡，diagrams.test.tsx 用真正的 mermaid parser 驗證語法，
 * 並把每張圖「照著畫的訊號流」和 stability.ts 的實際函式逐點比對）。
 *
 * 寫法約定（docs/teaching-style.md §8）：
 * - 標籤內避免 ASCII '<'、'>' 與 ';'（改用全形 ＜、＞、，），以免被 Mermaid 當成 HTML 或敘述分隔。
 * - 加法點是圓形節點 Σ，每一條進入的線都標上正負號：全形「＋」、減號「−」（U+2212），或「訊號名（＋）／訊號名（−）」。
 *   不可以只寫一個半形 "+"（或以 "- "、"* "、"1. " 開頭）：Mermaid 11 會把標籤當成 markdown 清單，畫出「Unsupported markdown: list」。
 *   這種錯誤 parser 抓不到，所以測試另外用真正的 renderer（@/components/mermaidTestUtils）畫一次並檢查每一行標籤都還在。
 *   共用的 <Mermaid> 會先用 sanitizeMermaidSource 把 "+"／"-" 換掉；本章的原始碼直接寫全形，所以前處理前後完全相同（測試會確認）。
 * - 延遲寫成 z⁻¹／z⁻ᵈ，積分器寫成 μ/(z−1)；時間索引 k 一律是 GMAC block，n 是 comparator sample。
 * - 極性一律是 δ = a − w（全站約定 §0）。
 * - 標色：藍（focus）＝這張圖的主角；紅（warn）＝會出事的地方；綠（ok）＝通過。三種顏色在深淺主題都讀得清楚。
 */
import type { SystemBlock } from '@/components'

const CLASS_DEFS = [
  '  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff',
  '  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff',
  '  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff',
]

/**
 * 本章的三個模型：一階 → 加更新延遲 → 加觀測動態（雙迴路）→ 一般化。
 * 每一格的遞迴式與穩定條件和 F-08.2／F-08.3、F-08.7／F-08.8、F-08.10／F-08.11、F-08.13／F-08.14 逐字相同（下標 k 是 GMAC block）。
 */
export const ROADMAP_CHART = [
  'flowchart LR',
  '  A["§8.2 一階<br/>δ_{k+1} = (1−g)·δ_k<br/>0 ＜ g ＜ 2"] -- "加上更新延遲 d" --> B["§8.3 更新延遲<br/>δ_{k+1} = δ_k − g·δ_{k−d}<br/>0 ＜ g ＜ 2·sin(π/(4d+2))"]',
  '  B -- "加上觀測狀態 s" --> C["§8.4 雙迴路<br/>s_{k+1} = r_s·s_k + b_s·δ_k<br/>δ_{k+1} = δ_k − μ·c_s·s_k<br/>0 ＜ μ·b_s·c_s ＜ 1 − r_s"]',
  '  C -- "s 變成向量" --> D["一般化<br/>ρ(A_comb) ＜ 1<br/>L_cal = μ·F(z)/(z−1)"]',
].join('\n')

/**
 * §8.1 單頻相關的兩條路徑：θ = φ + ΩD 從哪裡來（comparator rate，索引 n）。
 * E[x[n−D]·u[n]] = (A²/2)·|H|·cos θ；cos θ 的正負決定更新方向。
 */
export const POLARITY_PATH_CHART = [
  'flowchart LR',
  '  X(["單頻 code<br/>x[n] = A·cos(Ωn)"]) --> H["PLL error path H<br/>增益 |H|、相位 φ"]',
  '  X --> DLY["code delay<br/>延遲 D 個 sample"]',
  '  H -- "u[n]" --> M(("×"))',
  '  DLY -- "x[n−D]" --> M',
  '  M -- "取平均" --> C["相關 C = (A²/2)·|H|·cos θ<br/>θ = φ + ΩD"]',
  '  C --> Q{"cos θ 的正負？<br/>M = arcsin(cos θ)"}',
  '  Q -- "＞ 0" --> POS["極性正確，M ＞ 0<br/>w 被拉向 a"]',
  '  Q -- "= 0" --> ZERO["沒有恢復力，M = 0<br/>random walk"]',
  '  Q -- "＜ 0" --> NEG["極性錯誤，M ＜ 0<br/>w 被推離 a"]',
  ...CLASS_DEFS,
  '  class C focus',
  '  class POS ok',
  '  class NEG warn',
].join('\n')

/**
 * §8.1 F-08.1 的手算順序（HC-08.1 的步驟）：ψ = wrap₁₈₀(θ) = ((θ + 180°) mod 360°) − 180°，M = 90° − |ψ| = arcsin(cos θ)。
 * 上排＝先折回再量距離；綠色＝免折回的封閉式（結果相同）；紅色＝勘誤 E20 的反面教材（把週期錯當成 180°：M_錯 = 90° − (θ mod 180°)）。
 * 例：θ = −150° → 30° → 30° → ψ = −150° → M = −60°；錯誤寫法 −150° mod 180° = 30° → +60°。
 */
export const POLARITY_WRAP_CHART = [
  'flowchart LR',
  '  T(["相位 θ（度）"]) --> A1["加 180°"]',
  '  A1 --> A2["除以 360°<br/>取非負餘數"]',
  '  A2 --> A3["減 180°<br/>得到 ψ = wrap₁₈₀(θ)<br/>−180° ≤ ψ ＜ 180°"]',
  '  A3 --> A4["取絕對值 |ψ|"]',
  '  A4 --> M["M = 90° − |ψ|<br/>正的才有恢復力"]',
  '  T -- "免折回的捷徑" --> S["arcsin(cos θ)"]',
  '  S -- "結果相同" --> M',
  '  T -. "錯誤寫法（E20）" .-> B1["θ 除以 180° 取餘數<br/>週期錯當成 180°"]',
  '  B1 -.-> B2["90° − 餘數<br/>θ = −150° 得到 +60°<br/>正確是 −60°"]',
  ...CLASS_DEFS,
  '  class M focus',
  '  class S ok',
  '  class B1,B2 warn',
].join('\n')

/** §8.1 → §8.2：設計審查的兩關——polarity margin（方向）與 calibration phase margin（動態）是兩個不同的檢查 */
export const TWO_MARGINS_CHART = [
  'flowchart TB',
  '  START(["設計審查：calibration loop 會收斂嗎？"]) --> C1["第 1 關：Polarity margin（§8.1）<br/>只看更新方向，與 μ 無關<br/>頻率軸：code 的 Ω（rad/sample）"]',
  '  C1 --> Q1{"M = arcsin(cos θ) ＞ 0？"}',
  '  Q1 -- "否" --> F1["方向反了：平均誤差單調漂移<br/>調小 μ 沒有用<br/>修法：delay alignment、filtered-x（Ch07）"]',
  '  Q1 -- "是" --> C2["第 2 關：Calibration phase margin（§8.2–8.4）<br/>看迴路動態，由 g 與延遲決定<br/>頻率軸：block 的 ω（rad/block）"]',
  '  C2 --> Q2{"閉迴路 poles 全在單位圓內？"}',
  '  Q2 -- "否" --> F2["迴路自己振盪發散<br/>調小 μ 有用<br/>修法：降 g = μ·K、縮短更新延遲 d"]',
  '  Q2 -- "是" --> PASS["兩關都過：線性平均模型穩定<br/>接著看 PM、GM、DM 還剩多少"]',
  ...CLASS_DEFS,
  '  class C1,C2 focus',
  '  class F1,F2 warn',
  '  class PASS ok',
].join('\n')

/** §8.2 一階 calibration loop（block rate；δ = a − w）：單位回授 + 離散積分器 μ/(z−1) */
export const FIRST_ORDER_CHART = [
  'flowchart LR',
  '  A(["目標 a"]) -- "＋" --> S(("Σ"))',
  '  S -- "δ_k = a − w_k" --> K["GMAC 平均斜率<br/>K = K_q·C"]',
  '  K -- "G_k = K·δ_k" --> I["暫存器 = 積分器<br/>μ/(z−1)"]',
  '  I -- "w_k（−）" --> S',
  ...CLASS_DEFS,
  '  class I focus',
].join('\n')

/** §8.2 在 δ 處把迴路剪開：繞一圈的乘積就是 L_cal(z) = g/(z−1)；回到 Σ 走 − 端，所以回來的是 −L_cal·δ_in */
export const LOOP_CUT_CHART = [
  'flowchart LR',
  '  IN(["在 δ 處剪開迴路<br/>注入測試弦波 δ_in"]) --> K["× K<br/>GMAC 斜率"]',
  '  subgraph LG["開迴路增益 L_cal(z) = g/(z−1)，g = μ·K"]',
  '    K -- "G" --> MU["× μ<br/>學習率"]',
  '    MU --> INT["1/(z−1)<br/>積分器"]',
  '  end',
  '  INT -- "w" --> OUT(["回到 Σ 的 − 端<br/>δ_out = −L_cal(z)·δ_in"])',
  '  OUT -.-> RD["L_cal = −1 時 δ_out = δ_in：自己振盪<br/>PM、GM 量的是 L_cal 離 −1 多遠"]',
  ...CLASS_DEFS,
  '  class INT focus',
].join('\n')

/** §8.2 手算流程：g → pole、ω_c → ∠L → PM → DM，以及 GM（F-08.3 … F-08.6） */
export const PM_FLOW_CHART = [
  'flowchart LR',
  '  G(["g = μ·K"]) --> P["pole p = 1 − g<br/>穩定 ⇔ 0 ＜ g ＜ 2"]',
  '  G --> WC["ω_c = 2·arcsin(g/2)<br/>（|L| = 1 的頻率）"]',
  '  WC --> ANG["∠L(ω_c) = −90° − ω_c/2"]',
  '  ANG --> PM["PM = 180° + ∠L(ω_c)<br/>= 90° − arcsin(g/2)"]',
  '  PM --> DM["DM = PM[rad] / ω_c<br/>（單位：blocks）"]',
  '  WC --> DM',
  '  G --> GM["GM = 2/g<br/>（ω = π 處 |L| = g/2）"]',
  ...CLASS_DEFS,
  '  class PM focus',
].join('\n')

/** §8.3 同一個迴路，暫存器輸出要再等 d 個 block 才作用到 DTC：L(z) = g·z⁻ᵈ/(z−1) */
export const DELAY_LOOP_CHART = [
  'flowchart LR',
  '  A(["目標 a"]) -- "＋" --> S(("Σ"))',
  '  S -- "δ_{k−d} = a − w_{k−d}" --> K["GMAC 平均斜率<br/>K = K_q·C"]',
  '  K -- "G_k = K·δ_{k−d}" --> I["暫存器 = 積分器<br/>μ/(z−1)"]',
  '  I -- "w_k" --> D["更新延遲 z⁻ᵈ<br/>shadow register → commit → DTC"]',
  '  D -- "w_{k−d}（−）" --> S',
  ...CLASS_DEFS,
  '  class D warn',
].join('\n')

/** §8.3 pipeline 時序（d = 1 的例子，與正文的時序表逐格相同）：block k 的 DTC 用的是 w_{k−1} */
export const PIPELINE_SEQ_CHART = [
  'sequenceDiagram',
  '  participant D as DTC（正在使用的係數）',
  '  participant G as GMAC（累加 N 個 sample）',
  '  participant R as 係數暫存器 w',
  '  Note over D,R: block k 開始，暫存器最新值是 w_k',
  '  R-->>D: DTC 拿到的卻是 w_{k−1}（晚 d = 1 個 block）',
  '  D->>G: 這個 block 的誤差是 δ_{k−1} = a − w_{k−1}',
  '  G->>R: G_k = K·δ_{k−1}',
  '  R->>R: w_{k+1} = w_k + μ·G_k',
  '  Note over D,R: block k+1 開始，暫存器最新值是 w_{k+1}',
  '  R-->>D: DTC 拿到 w_k',
  '  D->>G: 這個 block 的誤差是 δ_k = a − w_k',
  '  G->>R: G_{k+1} = K·δ_k',
  '  R->>R: w_{k+2} = w_{k+1} + μ·G_{k+1}',
].join('\n')

/** §8.3 g 由小變大時，特徵式 z^(d+1) − z^d + g 的主導根怎麼走（狀態流程） */
export const ROOT_STATES_CHART = [
  'flowchart LR',
  '  S0(["g → 0⁺<br/>慢根 z ≈ 1 − g<br/>快根在 z ≈ 0 附近"]) -- "g 變大" --> S1(["主導根是正實根<br/>δ_k 不變號<br/>不 overshoot"])',
  '  S1 -- "過 overshoot 門檻" --> S2(["主導根是共軛複數對<br/>會 overshoot<br/>仍收斂，ρ ＜ 1"])',
  '  S2 -- "g = g*(d)" --> S3(["根踩在單位圓上<br/>角度 ω* = π/(2d+1)<br/>PM_d = 0，臨界"])',
  '  S3 -- "g ＞ g*(d)" --> S4(["根跑到圓外<br/>振盪發散<br/>ρ ＞ 1"])',
  ...CLASS_DEFS,
  '  class S1 ok',
  '  class S2 focus',
  '  class S3,S4 warn',
].join('\n')

/**
 * §8.3 相位預算（F-08.9）：PM = 180° + ∠L(ω_c)，L = K·[μ/(z−1)]·z⁻ᵈ，∠L(ω) = 0° − (90° + ω/2) − d·ω。
 * 方塊依 DELAY_LOOP_CHART 繞一圈的順序排列，線上寫的是「還剩多少相位」；ω_c = 2·arcsin(g/2) 與 d 無關（延遲不改 |L|）。
 * 所以 PM_d = 90° − ω_c/2 − d·ω_c = 90° − (2d+1)·arcsin(g/2)；PM_d = 0 ⇔ g = g*(d)。
 */
export const PHASE_BUDGET_CHART = [
  'flowchart LR',
  '  B0(["相位預算 180°<br/>PM = 180° + ∠L(ω_c)"]) --> KK["GMAC 斜率 K ＞ 0<br/>不吃相位"]',
  '  KK -- "剩 180°" --> INT["積分器 μ/(z−1)<br/>落後 90° + ω_c/2"]',
  '  INT -- "剩 90° − ω_c/2" --> DLY["更新延遲 z⁻ᵈ<br/>落後 d·ω_c"]',
  '  DLY -- "剩 90° − ω_c/2 − d·ω_c" --> PM["PM_d = 90° − (2d+1)·arcsin(g/2)"]',
  '  WC["交越頻率 ω_c = 2·arcsin(g/2)<br/>延遲不改變 |L|，所以與 d 無關"] -.-> INT',
  '  WC -.-> DLY',
  '  PM -- "PM_d = 0 時的 g" --> CR["臨界增益 g*(d) = 2·sin(π/(4d+2))<br/>GM_d = g*(d)/g：g 離它還差幾倍"]',
  ...CLASS_DEFS,
  '  class PM focus',
  '  class DLY,CR warn',
].join('\n')

/** §8.4 二狀態模型（方程式版）：觀測狀態 s 有記憶（pole r_s，藍色），GMAC 只看得到 s_k（不含 δ_k） */
export const DUAL_LOOP_CHART = [
  'flowchart LR',
  '  D(["δ_k"]) --> O["觀測動態<br/>s_{k+1} = r_s·s_k + b_s·δ_k"]',
  '  O -- "s_k" --> C["GMAC<br/>G_k = c_s·s_k"]',
  '  C -- "G_k" --> U["暫存器<br/>δ_{k+1} = δ_k − μ·G_k"]',
  '  U -- "到下一個 block" --> D',
  ...CLASS_DEFS,
  '  class O focus',
].join('\n')

/**
 * §8.4 訊號流版：上＝完整二狀態模型（藍色那一圈是有記憶的觀測狀態 s）；
 * 下＝quasi-static 把那一圈換成常數增益 F(1) = b_s·c_s/(1−r_s)（紅色）。
 * 兩者的暫存器（δ_{k+1} = δ_k − μ·G_k）完全相同。
 */
export const DUAL_SIGNAL_FLOW_CHART = [
  'flowchart LR',
  '  subgraph FULL["完整二狀態模型：觀測狀態 s 有記憶（pole r_s）"]',
  '    direction LR',
  '    FZD["z⁻¹"] -- "δ_k" --> FB["× b_s"]',
  '    FB -- "＋" --> FS(("Σ"))',
  '    FS -- "s_{k+1}" --> FZ["z⁻¹"]',
  '    FZ -- "s_k" --> FR["× r_s"]',
  '    FR -- "＋" --> FS',
  '    FZ -- "s_k" --> FC["× c_s"]',
  '    FC -- "G_k" --> FM["× μ"]',
  '    FM -- "μ·G_k（−）" --> FI(("Σ"))',
  '    FZD -- "δ_k（＋）" --> FI',
  '    FI -- "δ_{k+1}" --> FZD',
  '  end',
  '  subgraph QS["Quasi-static 近似：s 那一圈換成常數增益，沒有記憶"]',
  '    direction LR',
  '    QZD["z⁻¹"] -- "δ_k" --> QF["× F(1) = b_s·c_s/(1−r_s)"]',
  '    QF -- "G_k" --> QM["× μ"]',
  '    QM -- "μ·G_k（−）" --> QI(("Σ"))',
  '    QZD -- "δ_k（＋）" --> QI',
  '    QI -- "δ_{k+1}" --> QZD',
  '  end',
  ...CLASS_DEFS,
  '  class FB,FS,FZ,FR focus',
  '  class QF warn',
].join('\n')

/**
 * §8.4 三種觀測模型並排（E19 的歸因）：F(z) = b_s·c_s/(z−r_s) = z⁻¹ × 低通 b_s·c_s/(1 − r_s·z⁻¹)。
 * (a) 只留 DC 增益；(b) 只有低通、沒有 latency（反事實）；(c) 完整模型 = latency × 低通。
 * 每一列最右邊那格不是訊號處理方塊，而是「G 接上同一個暫存器 δ_{k+1} = δ_k − μ·G_k 之後」閉迴路的穩定上界。
 */
export const LATENCY_SPLIT_CHART = [
  'flowchart LR',
  '  D(["δ"]) --> A1["(a) quasi-static<br/>× F(1) = b_s·c_s/(1−r_s)<br/>沒有相位"]',
  '  A1 -- "G" --> A2["接上暫存器後的上界<br/>μ·b_s·c_s ＜ 2(1−r_s)<br/>也就是 g_eff ＜ 2"]',
  '  D --> B1["(b) 只有低通（反事實）<br/>b_s·c_s/(1 − r_s·z⁻¹)"]',
  '  B1 -- "G" --> B2["接上暫存器後的上界<br/>μ·b_s·c_s ＜ 2(1+r_s)<br/>r_s ＞ 0 時比 (a) 還寬"]',
  '  D --> CZ["(c) 完整模型<br/>z⁻¹：一個 block 的 latency"]',
  '  CZ --> C1["同一個低通<br/>b_s·c_s/(1 − r_s·z⁻¹)"]',
  '  C1 -- "G" --> C2["接上暫存器後的上界<br/>μ·b_s·c_s ＜ 1−r_s<br/>也就是 g_eff ＜ 1：只有 (a) 的一半"]',
  ...CLASS_DEFS,
  '  class CZ,C2 warn',
].join('\n')

/**
 * §8.4 μ 由小到大的四個區間（F-08.11、F-08.12；P(z) = z² − (1+r_s)z + (r_s + μ·b_s·c_s)）：
 *   μ·b_s·c_s ＜ (1−r_s)²/4        兩個實根（都在 r_s 與 1 之間）；μ → 0 時慢根 → 1 − g_eff，quasi-static 可信
 *   (1−r_s)²/4 ＜ … ＜ 1−r_s       共軛複數根，|z|² = r_s + μ·b_s·c_s（μ 越大越慢）；quasi-static 的 pole 1 − g_eff ∈ (0, 1) 卻越來越小
 *   1−r_s ＜ … ＜ 2(1−r_s)         |z| ＞ 1 發散；quasi-static 的 pole ∈ (−1, 0)，還以為穩定
 *   … ＞ 2(1−r_s)                  兩個模型都不穩定
 * 「本例」＝ Gallery #5 的 r_s = 0.8、b_s·c_s = 0.2：三個門檻是 μ = 0.05、1、2（測試用 analyzeDualLoop 驗證）。
 */
export const DUAL_REGIMES_CHART = [
  'flowchart LR',
  '  R1(["完整：兩個實根（一快一慢）<br/>quasi-static：pole = 1 − g_eff<br/>μ 遠小於門檻時兩者一致"]) -- "μ·b_s·c_s 超過 (1−r_s)²/4<br/>本例 μ = 0.05" --> R2(["完整：共軛複數根<br/>模數 |z| = √(r_s + μ·b_s·c_s)，μ 越大越慢<br/>quasi-static：以為越來越快"])',
  '  R2 -- "超過 1 − r_s<br/>本例 μ = 1" --> R3(["完整：|z| ＞ 1，振盪發散<br/>quasi-static：還以為穩定<br/>（pole 在 −1 與 0 之間）"])',
  '  R3 -- "超過 2(1 − r_s)<br/>本例 μ = 2" --> R4(["兩個模型都不穩定"])',
  ...CLASS_DEFS,
  '  class R1 ok',
  '  class R2 focus',
  '  class R3,R4 warn',
].join('\n')

/**
 * §8.4 一般化 state-space：觀測（A_s、b_s、c_sᵀ、d_s）＝ F(z)，暫存器＝積分器（δ 座標：δ_{k+1} = δ_k − μ·G_k）。
 * 兩個框串成一圈就是 L_cal(z) = μ·F(z)/(z−1)。
 */
export const STATE_SPACE_CHART = [
  'flowchart LR',
  '  DK(["δ_k"]) --> BS',
  '  DK --> DS',
  '  subgraph OBS["觀測動態 F(z) = d_s + c_sᵀ·(zI − A_s)⁻¹·b_s"]',
  '    BS["b_s"] -- "＋" --> SS(("Σ"))',
  '    SS -- "s_{k+1}" --> ZS["z⁻¹"]',
  '    ZS -- "s_k" --> AS["A_s"]',
  '    AS -- "＋" --> SS',
  '    ZS -- "s_k" --> CT["c_sᵀ"]',
  '    CT -- "＋" --> SG(("Σ"))',
  '    DS["d_s（直通）"] -- "＋" --> SG',
  '  end',
  '  subgraph REG["暫存器 = 積分器（δ 座標）"]',
  '    MU["× μ"] -- "μ·G_k（−）" --> SD(("Σ"))',
  '    SD -- "δ_{k+1}" --> ZD["z⁻¹"]',
  '    ZD -- "δ_k（＋）" --> SD',
  '  end',
  '  SG -- "G_k" --> MU',
  '  ZD -- "回授" --> DK',
  ...CLASS_DEFS,
  '  class AS,BS,CT,DS focus',
].join('\n')

/** §8.4 穩定性檢查流程：組 A_comb → 求 eigenvalue → 是否都在單位圓內（與 combinedMatrix／analyzeGeneral 的步驟相同） */
export const STABILITY_CHECK_CHART = [
  'flowchart TB',
  '  IN(["輸入：A_s、b_s、c_sᵀ、d_s 與 μ"]) --> BUILD["組合併矩陣 A_comb<br/>上列：A_s、b_s<br/>下列：−μ·c_sᵀ、1 − μ·d_s"]',
  '  BUILD --> EIG["求全部 eigenvalue λ_i<br/>（也就是閉迴路 poles）"]',
  '  EIG --> RHO["ρ = max |λ_i|"]',
  '  RHO --> Q{"ρ 和 1 比？"}',
  '  Q -- "ρ ＜ 1" --> PASS["線性平均模型穩定<br/>再讀 L_cal = μF(z)/(z−1) 的 PM、GM"]',
  '  Q -- "ρ = 1" --> MARG["臨界：不能當成穩定"]',
  '  Q -- "ρ ＞ 1" --> FAIL["不穩定<br/>降 μ，或改善觀測動態 F(z)"]',
  '  PASS --> TD["時域再驗一次<br/>跑 300 個 block 以上，疊上 ρᵏ 包絡"]',
  ...CLASS_DEFS,
  '  class BUILD focus',
  '  class PASS ok',
  '  class MARG,FAIL warn',
].join('\n')

/**
 * 總整理（比較表之前）：整章是同一個迴路 δ_k = a − w_k → F(z) → G_k → μ/(z−1) → w_k，只是「δ 到 G 的觀測路徑 F(z)」不同。
 *   §8.2  F(z) = K                    ⇒ L_cal = g/(z−1)
 *   §8.3  F(z) = K·z⁻ᵈ（G_k = K·δ_{k−d}）⇒ L = g·z⁻ᵈ/(z−1)
 *   §8.4  F(z) = b_s·c_s/(z − r_s)      ⇒ L_cal = μ·b_s·c_s/((z−1)(z−r_s))
 *   quasi-static：把 F(z) 換成常數 F(1)
 * 延遲在 DELAY_LOOP_CHART 畫在暫存器輸出（w_k → w_{k−d}），這裡併進 F(z)：a 是常數時兩種畫法的遞迴式相同（δ_{k+1} = δ_k − g·δ_{k−d}）。
 */
export const UNIFIED_LOOP_CHART = [
  'flowchart LR',
  '  A(["目標 a"]) -- "＋" --> S(("Σ"))',
  '  subgraph LG["繞一圈的乘積：L_cal(z) = μ·F(z)/(z−1)"]',
  '    F["觀測路徑 F(z)<br/>從 δ 到 G 的全部動態"] -- "G_k" --> I["暫存器 = 積分器<br/>μ/(z−1)"]',
  '  end',
  '  S -- "δ_k = a − w_k" --> F',
  '  I -- "w_k（−）" --> S',
  '  M1["§8.2 一階<br/>F(z) = K"] -.-> F',
  '  M2["§8.3 更新延遲 d<br/>F(z) = K·z⁻ᵈ"] -.-> F',
  '  M3["§8.4 雙迴路<br/>F(z) = b_s·c_s/(z − r_s)"] -.-> F',
  '  M4["quasi-static 近似<br/>把 F(z) 換成常數 F(1)"] -.-> F',
  ...CLASS_DEFS,
  '  class F focus',
  '  class M4 warn',
].join('\n')

/** 綜合手算（HC-08.8）的計算順序：σ_v、μ、C、d → K_q → K → g → p、g*(d)、μ_max、GM_d、PM_d */
export const SYNTHESIS_FLOW_CHART = [
  'flowchart LR',
  '  SV(["σ_v [fs]"]) --> KQ["K_q = √(2/π) / σ_v<br/>[1/fs]"]',
  '  KQ --> KK["K = K_q·C<br/>[1/fs]"]',
  '  CC(["C"]) --> KK',
  '  KK --> G["g = μ·K<br/>（無因次）"]',
  '  MU(["μ [fs]"]) --> G',
  '  G --> P["p = 1 − g"]',
  '  DD(["d [blocks]"]) --> GS["g*(d) = 2·sin(π/(4d+2))"]',
  '  GS --> MM["μ_max = g*(d) / K<br/>[fs]"]',
  '  KK --> MM',
  '  GS --> GM["GM_d = g*(d) / g"]',
  '  G --> GM',
  '  G --> PM["PM_d = 90° − (2d+1)·arcsin(g/2)"]',
  '  DD --> PM',
  ...CLASS_DEFS,
  '  class G focus',
].join('\n')

/** 本章全部的 Mermaid 原始碼（依頁面出現的順序）；章首另有一張全站共用的 <SystemMap>。 */
export const CH08_CHARTS = {
  ROADMAP_CHART,
  POLARITY_PATH_CHART,
  POLARITY_WRAP_CHART,
  TWO_MARGINS_CHART,
  FIRST_ORDER_CHART,
  LOOP_CUT_CHART,
  PM_FLOW_CHART,
  PIPELINE_SEQ_CHART,
  DELAY_LOOP_CHART,
  ROOT_STATES_CHART,
  PHASE_BUDGET_CHART,
  DUAL_LOOP_CHART,
  DUAL_SIGNAL_FLOW_CHART,
  LATENCY_SPLIT_CHART,
  DUAL_REGIMES_CHART,
  STATE_SPACE_CHART,
  STABILITY_CHECK_CHART,
  UNIFIED_LOOP_CHART,
  SYNTHESIS_FLOW_CHART,
} as const

export type Ch08ChartName = keyof typeof CH08_CHARTS

/** 章首 <SystemMap> 標成藍色的方塊：GMAC（量斜率 K）、÷N × μ（步長）、gain accumulator（積分器） */
export const SYSTEM_MAP_FOCUS: SystemBlock[] = ['gmac', 'scale', 'acc']
