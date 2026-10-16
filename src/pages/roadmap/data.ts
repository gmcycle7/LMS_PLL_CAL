/**
 * Research Backlog / Roadmap 的資料（規格附錄 C R1–R10、使用者的 SSPLL 案例、docs/implementation_plan.md 的 P0–P5）。
 *
 * 誠實原則（規格 §20.5-8、dev-conventions §7）：
 *   - 研究項目的狀態只有 partial / pending / not started / in analysis，**型別上就不允許 verified**。
 *   - 「本站已有」只代表有教學或模擬涵蓋其中一部分，不代表研究完成。
 *   - Phase 的進度由 src/data/verification-status.json 計算（只有 TS 與 Python 都通過的 T-id 才算 pass），
 *     其他驗收項（瀏覽器、手機、主題）一律標「需人工確認」。
 * 字串中的數學以 $…$ 包住，由頁面用 KaTeX 渲染（docs/teaching-style.md §3）。
 */
import type { ModelLevelId } from '@/data/types'
import { getTestStatus, type TestStatus } from '@/components'

// ───────────────────────────── 狀態 ─────────────────────────────

/** 研究項目整體狀態（沒有 verified / done） */
export type ItemStatus = 'partial' | 'pending' | 'not-started' | 'in-analysis'

/** 子目標狀態 */
export type SubStatus = 'on-site' | 'preview' | 'pending' | 'not-started' | 'in-analysis'

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  partial: '部分覆蓋 partial',
  pending: '待辦 pending',
  'not-started': '未開始 not started',
  'in-analysis': '分析中 in analysis',
}

export const ITEM_STATUS_DESC: Record<ItemStatus, string> = {
  partial: '本站已有教學或模擬涵蓋其中一部分（列出連結）；研究題目本身尚未完成，也未驗證。',
  pending: '已排入計畫，只有本頁的數學預覽；網站上還沒有對應的章節功能。',
  'not-started': '尚未開始：相依的模型或資料還不存在。',
  'in-analysis': '已有離線分析（Python golden、時域模擬）並整理成案例頁，但沒有 T-id 驗收；部分結論仍是研究假說，AMS / 晶片驗證尚未開始。',
}

export const SUB_STATUS_LABEL: Record<SubStatus, string> = {
  'on-site': '本站已有（簡化版）',
  preview: '本頁預覽（未驗證）',
  pending: '待辦 pending',
  'not-started': '未開始 not started',
  'in-analysis': '分析中 in analysis',
}

// ───────────────────────────── 六個成功條件 ─────────────────────────────

/** 規格結尾的「最終教學主旨」：成功的 calibration 必須同時滿足的六件事 */
export type Condition = 'identifiability' | 'polarity' | 'stability' | 'variance' | 'bias' | 'system'

export const CONDITIONS: { id: Condition; label: string; question: string }[] = [
  { id: 'identifiability', label: '資訊足夠 identifiability', question: '每個參數方向都被激發到了嗎（$\\lambda_{\\min}>0$）？' },
  { id: 'polarity', label: '方向正確 polarity', question: 'GMAC 的平均更新方向是否指向真值（$C>0$）？' },
  { id: 'stability', label: '動態穩定 stability', question: '整個（多速率、含延遲）迴路的 poles 在單位圓內嗎？' },
  { id: 'variance', label: '統計精度 variance', question: '收斂後係數抖多少（$\\sigma_w$）？' },
  { id: 'bias', label: '收斂到正確值 bias', question: 'GMAC 歸零的點 $w^*$ 是否等於物理上正確的值？' },
  { id: 'system', label: '系統效能 system', question: '最後 PLL output 的 jitter / spur 真的變好了嗎？' },
]

// ───────────────────────────── 研究項目 ─────────────────────────────

export type ItemId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'SSPLL'

export interface MathNeed {
  label: string
  /** KaTeX 原始碼 */
  tex: string
}

export interface Coverage {
  /** src/app/registry.ts 的頁面 id */
  page: string
  what: string
}

export interface SubGoal {
  text: string
  status: SubStatus
}

export interface RoadmapItem {
  id: ItemId
  title: string
  /** 規格出處 */
  spec: string
  goal: string
  why: string
  math: MathNeed[]
  covered: Coverage[]
  subgoals: SubGoal[]
  /** 相關勘誤（validation.md） */
  errata: string[]
  /** 支撐本題的既有驗收測試 */
  tests: string[]
  levelNow: ModelLevelId[]
  levelTarget: ModelLevelId
  conditions: Condition[]
  /** 明確指定的狀態（SSPLL：分析中）；省略則由子目標彙整 */
  status?: ItemStatus
  link?: { href: string; label: string }
  /** 本頁數學預覽的標題 */
  preview: string
}

export const ITEMS: RoadmapItem[] = [
  {
    id: 'R1',
    title: 'Colored / Correlated GMAC Noise',
    spec: '附錄 C R1',
    goal: '以量測或模擬得到的 $S_\\eta(f)$ 取代「iid、$\\sigma_\\eta^2\\approx1/N$」的假設，求係數雜訊 $S_w=|H_{\\eta\\to w}|^2S_\\eta$ 與 $\\sigma_w$，再一路算到 output jitter（含與直接 PD noise 的 cross-spectrum）。',
    why: '第 12 章的 $\\sigma_w$ 假設相鄰 GMAC block 的雜訊互相獨立。只要 comparator 有記憶（遲滯、metastability）、或 block 長度與主迴路時間常數相當，$\\eta_k$ 就會相關；同號相關（$\\rho>0$）會把 $\\sigma_w$ 放大，反號相關則縮小。只做功率相加的 noise budget 會錯。',
    math: [
      { label: 'AR(1) 的自相關（block-to-block 相關）', tex: 'R_\\eta[\\ell]=\\sigma_\\eta^2\\,\\rho^{|\\ell|}' },
      { label: '係數雜訊頻譜（第 12 章 F-12.4 的一般形式）', tex: 'S_w(e^{j\\Omega})=\\frac{\\mu^2}{|1-pe^{-j\\Omega}|^2}\\,S_\\eta(e^{j\\Omega})' },
      { label: '狀態空間 + 離散 Lyapunov 方程', tex: '\\mathbf s_{k+1}=\\mathbf A\\mathbf s_k+\\mathbf B\\xi_k\\;\\Rightarrow\\;\\mathbf P=\\mathbf A\\mathbf P\\mathbf A^{T}+\\mathbf B\\mathbf B^{T}' },
      { label: '兩個相關來源不能只做功率相加', tex: 'S_{a+b}=S_a+S_b+2\\,\\mathrm{Re}\\{S_{ab}\\}' },
    ],
    covered: [
      { page: 'ch12', what: '白色 $\\eta$：$H_{\\eta\\to w}$、$S_w$、$\\sigma_w$、$-3$ dB 與 ENBW（T13 / T14）；§12.4 Research 框與 LMS Noise Lab 另有 AR(1) 特例（該章把相關係數記作 $r$）' },
      { page: 'ch05', what: '$\\sigma_\\eta^2$ 的來源：$K_q$ 與 $\\mathrm{Var}(q)=1-m^2$' },
    ],
    subgoals: [
      { text: '白色、iid 的 $\\eta$：$S_w$、$\\sigma_w$、$-3$ dB 與 ENBW（第 12 章，T13 / T14）；AR(1) 特例的封閉式 $\\tfrac{1+p\\rho}{1-p\\rho}$（第 12 章 §12.4 的 Research 框）', status: 'on-site' },
      { text: '同一個 $\\sigma_w^2$ 的四方比對：封閉式、狀態空間 + Lyapunov（可推廣到任意有限階 ARMA 的 $S_\\eta$）、Monte Carlo、PSD 積分', status: 'preview' },
      { text: '從實際 comparator / PLL 模擬（或量測）估計 $S_\\eta(f)$：遲滯、metastability、DSM 相關的確定性殘差', status: 'pending' },
      { text: 'output jitter 的完整預算：直接 PD noise 與 LMS 係數雜訊的 cross-spectrum', status: 'not-started' },
      { text: '完整 L4 模型下，時域 Monte Carlo 與 PSD 積分的對照', status: 'not-started' },
    ],
    errata: ['E06', 'E10', 'E28', 'E29', 'E30'],
    tests: ['T13', 'T14'],
    levelNow: ['L1', 'L4'],
    levelTarget: 'L4',
    conditions: ['variance', 'system'],
    preview: '有色 GMAC 雜訊的 $\\sigma_w$：封閉式 vs Lyapunov vs Monte Carlo',
  },
  {
    id: 'R2',
    title: 'Cyclostationary DSM × LMS Noise',
    spec: '附錄 C R2',
    goal: '在 reference rate 建構 sample-and-hold 的係數序列，乘上（準）週期的 DSM residue；同時分析週期性 spur 與連續 PSD，並找出「獨立、平穩」近似何時失效。',
    why: '第 12 章的 $S_{\\delta t}=S_x\\circledast S_w$ 需要 $x$ 與 $\\delta w$ 獨立且平穩。實際上 $\\delta w$ 每 $N$ 個 sample 才變一次（ZOH），DSM residue 又有週期 $P$；兩個週期同步時，block 邊界總是落在同一組 code 相位上，時間平均的自相關不再能拆成兩個因子相乘。',
    math: [
      { label: 'multirate 定義（勘誤 E09）', tex: '\\delta t[n]=x[n]\\,\\delta w_{\\lfloor n/N\\rfloor}' },
      {
        label: '時間平均自相關（週期 $L=\\mathrm{lcm}(P,N)$）',
        tex: '\\bar R_{\\delta t}[m]=\\frac1L\\sum_{n=0}^{L-1}x[n]x[n+m]\\,R_w\\!\\left[\\Big\\lfloor\\tfrac{n+m}{N}\\Big\\rfloor-\\Big\\lfloor\\tfrac nN\\Big\\rfloor\\right]',
      },
      { label: '中國餘數定理（CRT）', tex: '\\gcd(P,N)=1\\;\\Rightarrow\\;n\\mapsto(n\\bmod P,\\;n\\bmod N)\\text{ 是一對一}' },
      { label: 'ZOH 的時間平均頻譜（Fejér kernel）', tex: 'S_w^{(f_s)}(e^{j\\Omega})=\\frac1N\\left[\\frac{\\sin(N\\Omega/2)}{\\sin(\\Omega/2)}\\right]^2S_w^{(f_u)}(e^{jN\\Omega})' },
    ],
    covered: [
      { page: 'ch12', what: 'ZOH 到 sample rate 的時間平均 PSD（勘誤 E09）、Code Mixing Lab' },
      { page: 'ch13', what: 'code 以 ZOH 保持時的 $\\mathrm{sinc}^2$ 權重（勘誤 E47）' },
      { page: 'ch04', what: 'DSM fractional residue explorer' },
    ],
    subgoals: [
      { text: 'ZOH 的時間平均 PSD（第 12 章，E09）與 code 更新率 vs ZOH 的 $\\mathrm{sinc}^2$ 權重（第 13 章，E47）', status: 'on-site' },
      { text: '精確時間平均自相關；$\\gcd(P,N)=1$ 時精確分解（CRT），否則獨立平穩近似失準', status: 'preview' },
      { text: 'cyclic spectrum $S^{(\\alpha)}(f)$ 與週期性 spur 的分離（MASH 1-1-1、真實 FCW）', status: 'pending' },
      { text: 'LMS 係數與 code 的相關（$\\delta w$ 由 $q\\cdot x$ 產生，並不獨立）納入 closed-loop 的 joint 模型', status: 'not-started' },
    ],
    errata: ['E09', 'E28', 'E29', 'E47'],
    tests: ['T15'],
    levelNow: ['L4'],
    levelTarget: 'L6',
    conditions: ['system', 'variance'],
    preview: 'ZOH 係數 × DSM residue：時間平均自相關何時能分解',
  },
  {
    id: 'R3',
    title: 'Quantization / Limit Cycle / Noise Shaping',
    spec: '附錄 C R3',
    goal: '一階 / 二階 quantizer、dither、PRBS、stochastic rounding；確認有理數 target、fractional FCW、更新率下的 limit cycles；比較 Freeze vs Background Tracking 的 output jitter–spur–drift 取捨。',
    why: '第 13 章證明常數 32.4 時一階 ΔΣ 與 periodic toggle 是同一個週期 5 的循環：平均正確不等於頻譜乾淨。真實系統的 $w_H$ 不是常數、code 誤差又會與 DSM residue 相乘，limit cycle 的譜線被搬到哪裡、有多大，只能靠時域模擬回答。',
    math: [
      { label: '一階 error-feedback quantizer（規格 §13.4）', tex: 'y[n]=w_H+r[n-1]-r[n]' },
      { label: '整數實作的週期', tex: 'w_H=\\frac WS\\;\\Rightarrow\\;P=\\frac{S}{\\gcd(W\\bmod S,\\;S)}' },
      { label: '一週期的譜線', tex: '|Y_k|/P,\\quad f_k=k\\,f_u/P' },
      { label: '高階 noise shaping 的 NTF', tex: '\\mathrm{NTF}(z)=(1-z^{-1})^{L_\\mathrm{ns}}' },
    ],
    covered: [
      { page: 'ch13', what: '五種策略、週期 5、定點 F bits 的週期、dither、Freeze/Track 切換（T16 / T17）' },
      { page: 'ch04', what: 'gain accumulator 的 saturation / anti-windup / wrap' },
    ],
    subgoals: [
      { text: '常數 32.4 的五種策略、週期 5、定點週期、dither、Freeze/Track（第 13 章，T16 / T17）', status: 'on-site' },
      { text: '整數實作的週期公式 $P=S/\\gcd$、一個週期的譜線與誤差功率', status: 'preview' },
      { text: '二階 / MASH quantizer 的 stability 與 overload；PRBS 長度與 seed 造成的週期 tone', status: 'pending' },
      { text: 'FCW × code 更新率 × 量化 limit cycle 的交互作用，經 PLL $T(f)$ 後的 spur / jitter', status: 'not-started' },
      { text: 'Freeze vs Background Tracking 的 jitter–spur–drift 定量取捨（需要 PVT drift 模型，連到 R8）', status: 'not-started' },
    ],
    errata: ['E15', 'E47', 'E49'],
    tests: ['T16', 'T17'],
    levelNow: ['L5'],
    levelTarget: 'L6',
    conditions: ['bias', 'system'],
    preview: '一階 EF quantizer：週期 $S/\\gcd$ 與一個週期的譜線',
  },
  {
    id: 'R4',
    title: '多參數 Gain / GOS / PHOS 的最佳更新矩陣',
    spec: '附錄 C R4',
    goal: '實測 $\\mathbf J(\\mathrm{FCW},\\mathrm{PVT})$；用 SVD、regularization、partial decoupling 設計更新矩陣 $\\mathbf M$，同時最佳化收斂速度、穩態 covariance 與硬體乘法器數；PVT 漂移時改用 gain scheduling。',
    why: '第 10 章的反例（T18）說明每個 loop 單獨穩定不代表 MIMO 一起穩定；理想 preconditioner 又會把弱方向（小 $\\sigma_i$）的雜訊放大。最佳 $\\mathbf M$ 是收斂與雜訊之間的取捨，而且 $\\mathbf J$ 隨 corner 改變，固定的反矩陣可能在某些 corner 失效。',
    math: [
      { label: 'SVD', tex: '\\mathbf J=\\mathbf U\\boldsymbol\\Sigma\\mathbf V^{T}' },
      { label: 'Regularized pseudo-inverse（$\\varepsilon$ 為正則化，勘誤 E22）', tex: '\\mathbf M=-\\gamma(\\mathbf J^{T}\\mathbf J+\\varepsilon\\mathbf I)^{-1}\\mathbf J^{T}' },
      { label: '每個 mode 的 pole 與穩態變異', tex: 'p_i=1-\\gamma\\frac{\\sigma_i^2}{\\sigma_i^2+\\varepsilon},\\qquad \\mathrm{Var}_i=\\frac{\\gamma^2\\sigma_i^2\\sigma_\\eta^2}{(\\sigma_i^2+\\varepsilon)^2(1-p_i^2)}' },
      { label: 'Robust：所有 corner 的 Jacobian 一起穩定', tex: '\\max_{c}\\;\\rho(\\mathbf I+\\mathbf M\\mathbf J_c)<1' },
    ],
    covered: [
      { page: 'ch10', what: 'Jacobian、理想與 regularized preconditioner、$\\hat{\\mathbf J}$ 誤差、NLMS、sequential、T18 反例' },
      { page: 'ch09', what: 'PE、eigenvalue 與慢模式' },
    ],
    subgoals: [
      { text: '$2\\times2$ / $3\\times3$ 的 $\\mathbf R$ 與 $\\mathbf J$、理想與 regularized preconditioner、T18 反例（第 10 章）', status: 'on-site' },
      { text: '每個 mode 的 pole 與穩態變異封閉式；$\\varepsilon$ 的收斂–雜訊取捨曲線（Lyapunov 與 MC 驗算）', status: 'preview' },
      { text: '多個 corner（FCW、PVT）的 $\\mathbf J$ 集合下的 robust $\\mathbf M$', status: 'pending' },
      { text: 'gain scheduling（$\\mathbf M$ 隨 corner 查表）與定點係數量化', status: 'not-started' },
      { text: '硬體乘法器數 / LUT 大小與收斂–雜訊的聯合最佳化', status: 'not-started' },
    ],
    errata: ['E05', 'E08', 'E21', 'E22', 'E24', 'E37'],
    tests: ['T10', 'T11', 'T18'],
    levelNow: ['L3'],
    levelTarget: 'L5',
    conditions: ['identifiability', 'stability', 'variance'],
    preview: 'Regularized preconditioner：$\\varepsilon$ 的收斂–雜訊取捨',
  },
  {
    id: 'R5',
    title: 'Training Sequence 設計',
    spec: '附錄 C R5',
    goal: '設計 training sequence：E-optimal（最大化有效資訊矩陣的 $\\lambda_{\\min}$）、D-optimal（最大化 $\\det\\mathbf R$，並處理單位與縮放）；對 DTC range、PLL spur、output jitter、training time 加約束；以 near-integer / near-grid FCW sweep 量化 keep-out 的效果。',
    why: 'PE 不足時 preconditioner 也救不回來（第 9–10 章）。近整數 FCW 的 DSM residue 在一個短窗口內幾乎是一條斜線，和 offset regressor 幾乎共線，$\\lambda_{\\min}$ 隨 $\\alpha^2$ 掉下去；要決定 keep-out 多寬、訓練序列怎麼加 dither，需要明確的設計指標。',
    math: [
      { label: '資訊矩陣', tex: '\\mathbf R=E[\\mathbf u\\mathbf u^{T}]' },
      { label: 'E-optimal 與 D-optimal', tex: '\\max\\;\\lambda_{\\min}(\\mathbf R)\\qquad\\text{vs}\\qquad\\max\\;\\det\\mathbf R' },
      { label: '換單位（對角縮放）', tex: '\\det(\\mathbf S\\mathbf R\\mathbf S)=\\det(\\mathbf S)^2\\det\\mathbf R' },
      { label: 'Near-integer 的最差窗口', tex: '\\lambda_{\\min}\\approx\\frac{\\alpha^2(N_0^2-1)}{15}\\quad(\\alpha N_0\\ll1)' },
    ],
    covered: [
      { page: 'ch09', what: 'PE 定義、滑動窗口 $\\lambda_{\\min}$、gauge freedom' },
      { page: 'ch11', what: 'near-integer 時 $C\\to0$ 放大 bias' },
      { page: 'ch06', what: '$C/\\sigma_x^2$ 隨 FCW 小數部分變化' },
    ],
    subgoals: [
      { text: 'PE 定義、滑動窗口 $\\lambda_{\\min}$、gauge（第 9 章）；near-integer 時 $C\\to0$ 放大 bias（第 11 章）', status: 'on-site' },
      { text: 'gain + offset 兩參數的 E- / D-optimal 指標、單位縮放對排名的影響、near-integer 的 $\\lambda_{\\min}\\propto\\alpha^2$', status: 'preview' },
      { text: 'Training Sequence Lab（規格 §19：FCW、DSM pattern、code randomization → PSD、相關、Jacobian rank、spur）', status: 'pending' },
      { text: '在 DTC range、spur、jitter、training time 約束下的最佳化（含 near-grid）', status: 'not-started' },
    ],
    errata: ['E04', 'E23'],
    tests: ['T10', 'T11'],
    levelNow: ['L3'],
    levelTarget: 'L6',
    conditions: ['identifiability'],
    preview: 'E- vs D-optimal 與 near-integer keep-out',
  },
  {
    id: 'R6',
    title: 'Comparator 非理想與 Distribution-Free LMS',
    spec: '附錄 C R6',
    goal: 'Offset、hysteresis、metastability、非 Gaussian 雜訊；以 $E[q|s]$ 的實際斜率 $2f_v(\\theta-s)$ 取代 $K_q$；MAE / Huber / robust estimation、outlier、impulsive noise、sign clipping。',
    why: '$K_q=\\sqrt{2/\\pi}/\\sigma_v$ 只對 Gaussian、小訊號成立（第 5 章）。同樣的 RMS，不同 PDF 的斜率可以差兩倍以上；遲滯讓 $E[q]$ 的斜率變大，卻同時讓相鄰決策相關（GMAC 雜訊變有色，連到 R1），淨資訊反而下降。',
    math: [
      { label: 'S 曲線與斜率', tex: 'E[q\\mid s]=1-2F_v(\\theta-s),\\qquad \\frac{dE[q\\mid s]}{ds}=2f_v(\\theta-s)' },
      { label: '遲滯 comparator：兩狀態 Markov chain', tex: 'E[q]=\\frac{t_+-t_-}{t_++t_-},\\qquad \\nu=1-t_+-t_-' },
      { label: '每個 sample 的有效資訊', tex: '\\mathcal I=\\frac{(dE[q]/ds)^2\\,(1-\\nu)}{(1-m^2)(1+\\nu)}' },
      { label: 'Huber 的 $\\psi$（robust）', tex: '\\psi_\\delta(e)=\\begin{cases}e,&|e|\\le\\delta\\\\\\delta\\,\\mathrm{sign}(e),&|e|>\\delta\\end{cases}' },
    ],
    covered: [
      { page: 'ch05', what: 'Gaussian comparator 的 erf S 曲線、$K_q$ 與飽和、門檻 $\\theta$、tie rule、dither' },
      { page: 'ch11', what: 'comparator offset 造成的假 gain bias（勘誤 E03）' },
      { page: 'ch01', what: 'MSE / MAE / Huber 損失比較' },
    ],
    subgoals: [
      { text: 'Gaussian comparator：erf S 曲線、$K_q$、飽和、門檻 $\\theta$、tie rule、dither（第 5 章）；offset bias（第 11 章）', status: 'on-site' },
      { text: '五種雜訊 PDF 的 S 曲線與 $2f_v$ 斜率；遲滯 comparator 的 Markov 解析與每 sample 資訊（含 MC）', status: 'preview' },
      { text: 'metastability（「軟 tie」視窗）與由量測 S 曲線估計 $K$ 的流程', status: 'pending' },
      { text: 'impulsive noise / outlier 下的 robust（Huber、clipping）GMAC 及其 bias–variance', status: 'not-started' },
    ],
    errata: ['E02', 'E03', 'E07', 'E40'],
    tests: ['T04', 'T05'],
    levelNow: ['L1'],
    levelTarget: 'L2',
    conditions: ['polarity', 'bias', 'variance'],
    preview: '非 Gaussian 雜訊與遲滯：S 曲線、斜率與每 sample 資訊',
  },
  {
    id: 'R7',
    title: '真正的 Fractional-N PLL Closed-Loop State-Space',
    spec: '附錄 C R7',
    goal: '建立 reference → DTC → PD → loop filter → VCO（DTC 在 reference 輸入端），以及 VCO → divider（由 DSM 控制）→ PD 回授的事件級模型；明確分開 PD error、reference noise、VCO noise、gain update 四條路徑；處理主迴路快狀態 + LMS 慢狀態的 multirate stability 與線性化；injection-locked 與非注入模式各自量測 $H_{\\mathrm{PD}}$。',
    why: '第 8 章用抽象的 $s_{k+1}=r_ss_k+b_s\\delta_k$ 說明「時間尺度分離」可能失效。真實 PLL 每個 reference cycle 走一步、LMS 每 $N$ 個 cycle 才更新一次，兩者的耦合必須在同一個多速率模型裡算 poles：同一個 $\\mu$，換一個 $N$，穩定與否可能就不同，不能用單一速率的公式外推。',
    math: [
      { label: '多速率 lifting（一個 block 內的 $N$ 步精確積掉；符號依勘誤 E31）', tex: '\\mathbf s_{(k+1)N}=\\mathbf A_s^{N}\\mathbf s_{kN}+\\Big(\\textstyle\\sum_{i=0}^{N-1}\\mathbf A_s^{i}\\Big)\\mathbf b_s\\,\\delta_k' },
      { label: '合併後的狀態矩陣（規格 §8.4，$N=1$）', tex: '\\mathbf A_{\\mathrm{comb}}=\\begin{bmatrix}\\mathbf A_s&\\mathbf b_s\\\\-\\mu\\mathbf c_s^{T}&1-\\mu d_s\\end{bmatrix},\\quad \\rho(\\mathbf A_{\\mathrm{comb}})<1' },
      { label: '觀測動態', tex: 'F(z)=d_s+\\mathbf c_s^{T}(z\\mathbf I-\\mathbf A_s)^{-1}\\mathbf b_s,\\qquad L_{\\mathrm{cal}}(z)=\\frac{\\mu F(z)}{z-1}' },
      { label: '四條路徑分開', tex: 'H_{\\mathrm{PD}}=\\frac1{1+L},\\qquad T=\\frac{L}{1+L}' },
    ],
    covered: [
      { page: 'ch08', what: '§8.4 抽象雙迴路（$N=1$）、Jury 判據、step response' },
      { page: 'ch06', what: '線性化 Type-II DT 主迴路（含 latency，勘誤 E44）與 $\\mathrm{Re}\\{H_{\\mathrm{PD}}\\}$' },
      { page: 'ch12', what: 'PD 路徑（high-pass）vs output 路徑（low-pass）' },
      { page: 'models', what: 'L0–L6 模型層級：哪些結論可以 sign-off' },
    ],
    subgoals: [
      { text: '線性化 Type-II DT 主迴路（含 latency）、§8.4 抽象雙迴路（第 6、8 章）；PD vs output 路徑（第 12 章）', status: 'on-site' },
      { text: '抽象雙迴路的多速率 lifting $\\mathbf A_N$，與逐 sample 模擬逐點吻合', status: 'preview' },
      { text: '以真實 $H_{\\mathrm{PD}}(z)$ 與 GMAC block 做 lifting（含 commit latency），計算 multirate poles', status: 'pending' },
      { text: '事件級（edge-based）模型：reference → DTC → PD → LF → VCO，回授 VCO → divider（DSM 控制）→ PD；四條 noise 路徑', status: 'not-started' },
      { text: 'injection-locked 模式的 $H_{\\mathrm{PD}}$ 量測與比較', status: 'not-started' },
    ],
    errata: ['E13', 'E19', 'E31', 'E34', 'E44'],
    tests: ['T08', 'T09'],
    levelNow: ['L2'],
    levelTarget: 'L6',
    conditions: ['stability', 'polarity', 'system'],
    preview: '多速率 lifting：同一個 $\\mu$，$N$ 改變穩定性就改變',
  },
  {
    id: 'R8',
    title: 'Learning-Rate Scheduling、NLMS、RLS、Kalman',
    spec: '附錄 C R8',
    goal: '比較 scalar / block LMS、Sign-LMS、leaky LMS、NLMS；RLS / Kalman 在可辨識性不足與高維估計中的速度–雜訊取捨；系統變動、PVT drift、reacquisition 與 freeze 的最佳切換準則。',
    why: '第 14 章給出固定 $\\mu$、兩段式與 $1/k$ 排程，以及 random-walk 追蹤的近似最佳 $\\mu$。背景追蹤要在「追得上漂移」與「不被雜訊推著走」之間取捨；這個取捨在線性模型下有精確解：最佳固定增益就是穩態 Kalman 增益。但 1-bit comparator 的觀測是非線性的，RLS / Kalman 不能直接套用。',
    math: [
      { label: 'Random-walk 追蹤的穩態誤差', tex: 'V(g)=\\frac{\\sigma_\\zeta^2+g^2\\sigma_y^2}{g(2-g)},\\qquad \\sigma_y^2=\\sigma_\\eta^2/K^2' },
      { label: '穩態 Riccati 方程與 Kalman 增益', tex: 'P^-=\\frac{P^-\\sigma_y^2}{P^-+\\sigma_y^2}+\\sigma_\\zeta^2,\\qquad K_\\infty=\\frac{P^-}{P^-+\\sigma_y^2}' },
      { label: 'NLMS', tex: '\\mathbf w_{k+1}=\\mathbf w_k+\\frac{\\tilde\\mu}{\\epsilon_0+\\|\\mathbf x_k\\|^2}\\,e_k\\mathbf x_k' },
      { label: 'RLS 的記憶長度', tex: '\\text{forgetting }\\lambda_f\\;\\Rightarrow\\;N_{\\mathrm{eff}}\\approx\\frac1{1-\\lambda_f}' },
    ],
    covered: [
      { page: 'ch14', what: '固定 $\\mu$ / 兩段式 / $1/k$（scalar Kalman）、random-walk 的近似 $\\mu^*$（F-14.13）、calibration state machine' },
      { page: 'ch10', what: 'NLMS 的 poles 與限制' },
      { page: 'ch03', what: 'mean / mean-square / almost-sure 三種穩定' },
    ],
    subgoals: [
      { text: '固定 $\\mu$、兩段式、$1/k$ 排程、random-walk 近似、state machine（第 14 章）；NLMS（第 10 章）', status: 'on-site' },
      { text: '最佳固定增益 = 穩態 Kalman 增益的精確證明與 Monte Carlo 驗算', status: 'preview' },
      { text: 'leaky LMS 與 RLS 在 PE 不足（$\\lambda_{\\min}\\to0$）時的速度–雜訊–bias 取捨', status: 'pending' },
      { text: '1-bit 觀測下的 Kalman 類估計，以及 freeze / reacquisition 的最佳切換準則', status: 'not-started' },
    ],
    errata: ['E14', 'E16', 'E48'],
    tests: ['T02', 'T03', 'T13'],
    levelNow: ['L1'],
    levelTarget: 'L3',
    conditions: ['variance', 'stability'],
    preview: 'Random-walk 追蹤：最佳固定增益 = 穩態 Kalman 增益',
  },
  {
    id: 'R9',
    title: 'RTL Bit-True / AMS Co-simulation',
    spec: '附錄 C R9',
    goal: 'Bit-exact RTL reference model（saturation、rounding、clock-domain latency）；Verilog / SystemVerilog assertions、test vectors、Python golden model；behavioral vs AMS / Spectre 的 waveform / PSD 對照。',
    why: '教學模型裡的 $\\mu$、$G$ 都是實數；硬體裡 GMAC 是固定位寬的累加器，溢位時 wrap 會翻轉符號——而且偏偏發生在誤差最大、最需要正確方向的時候。bit-true 模型要能逐 cycle 對上 RTL，本站的數學結論才帶得進 sign-off。',
    math: [
      { label: 'two’s complement wrap', tex: '\\mathrm{wrap}_W(v)=\\big((v+2^{W-1})\\bmod 2^W\\big)-2^{W-1}' },
      { label: '累加器位寬（含最負 code）', tex: 'W_\\mathrm{acc}\\ge W_x+\\log_2N+1' },
      { label: '右移（floor）取平均的 rounding 偏差', tex: 'E\\big[\\lfloor A_\\mathrm{acc}/N\\rfloor-A_\\mathrm{acc}/N\\big]\\approx-\\tfrac12\\,\\mathrm{LSB}' },
      { label: '更新延遲 d 縮小 PM', tex: 'PM_d=90^\\circ-(2d+1)\\arcsin(g/2)' },
    ],
    covered: [
      { page: 'ch04', what: '定點 GMAC：位寬、右移、rounding、飽和、最負 code 的陷阱、RTL 檢查清單' },
      { page: 'models', what: 'L5 定點模型、Behavioral 與 sign-off 層級' },
      { page: 'verification', what: 'Python golden model 與 T01–T18 golden vectors' },
      { page: 'ch08', what: '更新延遲 d 的 PM 與臨界增益' },
    ],
    subgoals: [
      { text: 'Python golden model 與 golden vectors；定點 GMAC 位寬、rounding、最負 code（第 4 章）；L5 gain register（Part D）', status: 'on-site' },
      { text: '累加器位寬的精確界，與 wrap / saturate 的最壞情況', status: 'preview' },
      { text: 'bit-exact RTL reference model 與逐 cycle 比對的 test vectors', status: 'not-started' },
      { text: 'SystemVerilog assertions（極性、溢位、tie、commit 時序）與 CDC', status: 'not-started' },
      { text: 'Behavioral vs AMS / Spectre 的 waveform / PSD 對照', status: 'not-started' },
    ],
    errata: ['E07', 'E13'],
    tests: [],
    levelNow: ['L5'],
    levelTarget: 'L5',
    conditions: ['polarity', 'system'],
    preview: '累加器位寬與 wrap / saturate 的最壞情況',
  },
  {
    id: 'R10',
    title: '以目標規格反推 Calibration 設計',
    spec: '附錄 C R10',
    goal: '輸入 $T_{\\max}$、$\\sigma_{w,\\max}$、spur limit、PLL PN / jitter budget、PVT range、FCW range、silicon power / area；輸出 $N$、$\\mu$、code width、delay tap、更新頻率、freeze / track、training strategy、margin 與失敗 FCW 清單。',
    why: '前面每一章都回答「給定設計，結果是什麼」；晶片設計需要反過來：「規格給定，設計空間在哪裡、是不是空的」。即使只看一個參數，時間與雜訊兩個規格就把 $(N,\\mu)$ 夾成一條帶子；而在線性模型裡 $\\sigma_w$ 的下限幾乎與 $N$ 無關。',
    math: [
      { label: '係數雜訊（$\\sigma_\\eta^2=1/N$）', tex: '\\sigma_w^2=\\frac{g}{K^2N(2-g)}' },
      { label: '時間：平均誤差縮到 $\\varepsilon$ 倍', tex: '(1-g)^{B}\\le\\varepsilon,\\qquad T=\\frac{NB}{f_s}\\le T_{\\max}' },
      { label: 'tanh 律（$y=NL_\\varepsilon/(2f_sT)$）', tex: '\\sigma_{w,\\min}^2(N)=\\frac{L_\\varepsilon}{2K^2f_sT}\\cdot\\frac{\\tanh y}{y},\\qquad L_\\varepsilon=\\ln\\frac1\\varepsilon' },
      { label: 'Corner-based 區間（第 14 章，勘誤 E16）', tex: '\\frac{1-\\varepsilon^{1/B}}{K_{\\min}}\\le\\mu\\le\\frac1{K_{\\max}}' },
    ],
    covered: [
      { page: 'ch14', what: 'corner-based $\\mu$ 可行區間與非空條件、固定總預算下的 $E[\\delta_B^2]$、learning-rate optimizer' },
      { page: 'ch12', what: '$\\sigma_w$、頻寬（T13 / T14）' },
      { page: 'ch08', what: 'PM 與 $g\\le1$' },
    ],
    subgoals: [
      { text: 'corner-based $\\mu$ 可行區間、固定總預算、learning-rate optimizer（第 14 章）', status: 'on-site' },
      { text: '由 $T_{\\max}$、$\\sigma_{w,\\max}$、$\\varepsilon$、$\\delta_0$、PM 反推每個 $N$ 的 $\\mu$ 區間與 $\\sigma_w$ 的 tanh 律', status: 'preview' },
      { text: '把 spur limit、PN / jitter budget（經 $T(f)$ 與 code 混頻）加入約束', status: 'pending' },
      { text: '多 corner、多參數（GOS / PHOS / gain）的聯合反推與失敗 FCW 清單', status: 'not-started' },
      { text: 'silicon power / area（位寬、乘法器、LUT）的成本模型', status: 'not-started' },
    ],
    errata: ['E06', 'E13', 'E16', 'E48'],
    tests: ['T13', 'T14'],
    levelNow: ['L1'],
    levelTarget: 'L6',
    conditions: ['identifiability', 'polarity', 'stability', 'variance', 'bias', 'system'],
    preview: '由規格反推 $(N,\\mu)$：時間 × 雜訊的可行帶',
  },
  {
    id: 'SSPLL',
    title: 'SSPLL 8 相 PMUX + input DTC：GOS / PHOS 在 Type-I / Type-II / CPPLL 下的更新極性',
    spec: '使用者案例（規格 §6、§7、§9.2、§11.4）',
    goal: '$f_{\\mathrm{ref}}=4$ GHz、閉迴路 $-3$ dB 頻寬 320 MHz 的 subsampling PLL，分數除頻由 feedback 側的 8 相 PMUX 加上 reference 側的 input DTC 完成。判斷兩組 Sign-Error LMS——GOS（DTC 的 gain error，regressor 是 DTC 細部殘差 $\\rho[n]\\in[0,1)$）與 PHOS（8 個 PMUX 相位各自的 offset，regressor 是 8 個 one-hot）——在 Type-I SSPLL、Type-II SSPLL 與 CPPLL 下的平均更新方向：$\\mathrm{Re}\\{H_{\\mathrm{PD}}\\}<0$ 的頻帶在哪裡、哪些 FCW 小數 $\\alpha$ 會讓 regressor 的能量落進去。',
    why: '這是實際遇到的問題：同一套 GMAC，換了迴路型態，GOS / PHOS 可能變號。PMUX 每個 reference cycle 前進 $8\\alpha$ 個相位；8 個 one-hot regressor 的 mode-1 分量（「轉一圈」的那個 DFT mode）有 95% 的功率集中在旋轉頻率 $\\alpha f_{\\mathrm{ref}}$。它一旦落在反號帶內，正的 $\\mu$ 就會讓校正發散——這不是 bug，而是 $H_{\\mathrm{PD}}=1/(1+L)$ 的相位。修法（改 regressor、filtered-x、校準時改變迴路型態、keep-out）都要先知道反號帶在哪裡。',
    math: [
      { label: '反號條件（對任何 $L$ 成立）', tex: '\\mathrm{Re}\\{H_{\\mathrm{PD}}\\}=\\frac{1+\\mathrm{Re}\\{L\\}}{|1+L|^2}<0\\iff\\mathrm{Re}\\{L\\}<-1\\iff\\mathrm{Re}\\{T\\}>1' },
      { label: 'raw-x GMAC 的相關（勘誤 E46 的單頻邊界另計）', tex: 'C=\\sum_{k\\ge0}h_{\\mathrm{PD}}[k]\\,R_x[k]=\\frac1{2\\pi}\\int_{-\\pi}^{\\pi}S_x(e^{j\\Omega})\\,\\mathrm{Re}\\{H_{\\mathrm{PD}}(e^{j\\Omega})\\}\\,d\\Omega' },
      {
        label: 'PHOS：8 個 one-hot 的平均更新矩陣是 circulant，特徵向量是 DFT mode $m$',
        tex: 's_m[n]=e^{-j2\\pi m\\,p[n]/8},\\quad \\kappa_m=\\sum_{\\ell\\equiv m\\ (8)}w_\\ell\\,\\mathrm{Re}\\{H_{\\mathrm{PD}}(e^{j2\\pi\\ell\\alpha})\\},\\quad w_\\ell=\\frac{64\\sin^2(\\pi\\ell/8)}{\\pi^2\\ell^2}',
      },
      { label: 'one-hot 的 gauge（勘誤 E04）', tex: 'x_i[n]=\\mathbb 1\\{p[n]=i\\},\\quad \\sum_{i=0}^{7}x_i[n]=1\\;\\Rightarrow\\;H_{\\mathrm{PD}}(1)=0\\text{ 時共模 }(m=0)\\text{ 不可見}' },
      { label: 'GOS：DTC 細部殘差是鋸齒，基頻 $\\beta=\\mathrm{frac}(8\\alpha)$', tex: '\\rho[n]=8\\varphi[n]-p[n],\\qquad C_{\\mathrm{GOS}}=\\sum_{k\\ne0}|c_k|^2\\,\\mathrm{Re}\\{H_{\\mathrm{PD}}(e^{j2\\pi k\\beta})\\}' },
      { label: 'Filtered-x 的極性條件（勘誤 E45）', tex: '\\mathrm{Re}\\{H\\,\\overline{\\hat H}\\}>0' },
    ],
    covered: [
      { page: 'ch06', what: 'Type-I 只會變慢、Type-II 會變號；Polarity Explorer' },
      { page: 'ch07', what: 'delay alignment 與 filtered-x 修正' },
      { page: 'ch09', what: '四相 one-hot + global offset 的 gauge freedom' },
      {
        page: 'case-sspll',
        what: '案例頁：三種迴路（L1 Type-I SSPLL、L2 Type-II SSPLL、L3 CPPLL）的 $\\mathrm{Re}\\{H_{\\mathrm{PD}}\\}$、PHOS / GOS 的 sign map 與對策。資料來自 analysis/sspll 的離線 Python golden 與時域模擬，每個結論各自標示精確／近似／研究假說',
      },
    ],
    subgoals: [
      { text: 'Type-I / Type-II 的一般極性說明與 Polarity Explorer（第 6 章）；delay / filtered-x（第 7 章）；one-hot gauge（第 9 章）', status: 'on-site' },
      {
        text: '本頁以共用 pll.ts 獨立重算（只含 L1 / L2、線性小訊號、相關器延遲 $D=0$）：反號帶與 Type-II 封閉式邊界、白色與 AR(1) code 的 $C>0$、PMUX mode-1 的 $\\kappa_1$ 與「一定反號」帶、GOS 鋸齒的 $12C$',
        status: 'preview',
      },
      {
        text: '案例頁與 docs/analysis：L1 / L2 / L3（含 CPPLL）的完整 sign map（$\\alpha=j/4096$）、alias dead zone、near-grid GOS、時域 replica 與閉迴路 LMS 的三方比對——離線結果已整理成頁面資料，尚未納入 T-id 驗收',
        status: 'in-analysis',
      },
      { text: 'GOS 在 $D=0$、raw regressor 下「對任何 $\\alpha$ 都不反號」：數值掃描沒有反例，但沒有證明（研究假說）；$8\\nmid Q$ 的有理 $\\alpha=j/Q$ 也只有數值證據', status: 'in-analysis' },
      { text: '對策的定量比較（一階差分 regressor、filtered-x、校準時 hold 積分路徑、PMUX 隨機旋轉、keep-out）：需要大訊號 1-bit map、comparator offset 與 PVT margin', status: 'in-analysis' },
      { text: '把 PMUX / DTC regressor 與 CPPLL（三階、impulse-invariant）納入共用 pll.ts 與 Calibration Lab；以 AMS 或實測的 $H_{\\mathrm{PD}}$ 驗證', status: 'not-started' },
    ],
    errata: ['E04', 'E44', 'E45', 'E46'],
    tests: ['T06', 'T07'],
    levelNow: ['L2'],
    levelTarget: 'L3',
    conditions: ['polarity', 'identifiability', 'stability'],
    status: 'in-analysis',
    link: { href: '#/case/sspll', label: '案例頁：SSPLL 的 GOS / PHOS 極性' },
    preview: '$\\mathrm{Re}\\{H_{\\mathrm{PD}}\\}$ 的反號帶與 8 相 PMUX / DTC regressor 的平均斜率',
  },
]

/** 研究項目的整體狀態：明確指定者優先；否則有任何「本站已有」→ partial；有預覽或待辦 → pending；其餘 not started。 */
export function itemStatus(item: RoadmapItem): ItemStatus {
  if (item.status) return item.status
  if (item.subgoals.some((s) => s.status === 'on-site')) return 'partial'
  if (item.subgoals.some((s) => s.status === 'preview' || s.status === 'pending')) return 'pending'
  return 'not-started'
}

export function itemById(id: string): RoadmapItem | undefined {
  return ITEMS.find((i) => i.id === id)
}

/** 狀態統計（overview 用） */
export function statusCounts(items: RoadmapItem[] = ITEMS): Record<ItemStatus, number> {
  const out: Record<ItemStatus, number> = { partial: 0, pending: 0, 'not-started': 0, 'in-analysis': 0 }
  for (const it of items) out[itemStatus(it)]++
  return out
}

/** 子目標統計 */
export function subgoalCounts(items: RoadmapItem[] = ITEMS): Record<SubStatus, number> {
  const out: Record<SubStatus, number> = { 'on-site': 0, preview: 0, pending: 0, 'not-started': 0, 'in-analysis': 0 }
  for (const it of items) for (const s of it.subgoals) out[s.status]++
  return out
}

// ───────────────────────────── P0–P5 ─────────────────────────────

export type PhaseId = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5'

export interface Phase {
  id: PhaseId
  title: string
  deliverables: string[]
  /** registry 頁面 id */
  pages: string[]
  deps: PhaseId[]
  /** 驗收條件（docs/implementation_plan.md 與規格 §20.6） */
  acceptance: string[]
  /** 驗收所需的 T-id（只有 TS + Python 都 pass 才算） */
  tests: string[]
  risks: string[]
  errata: string[]
}

export const PHASES: Phase[] = [
  {
    id: 'P0',
    title: '基礎',
    deliverables: [
      'Vite / React / TypeScript 專案、路由註冊表、側欄、深淺主題、三種學習模式',
      '共用元件：Tex、Mermaid、Plot、ParamControl、ExperimentShell、報告匯出',
      'Web Worker 基礎；core 與 signal 數值庫；Python golden model 與 vectors',
    ],
    pages: ['dashboard'],
    deps: [],
    acceptance: ['npm run build、npm test 通過', '公式（KaTeX）與 Mermaid 方塊圖正常渲染', '網站本機能用（規格 §20.6）'],
    tests: [],
    risks: ['Plotly bundle 大 → lazy-load'],
    errata: [],
  },
  {
    id: 'P1',
    title: '數學',
    deliverables: ['Ch01–03、Ch05：LMS Playground、MSE vs MAE、Mean / Mean-Square、Comparator Lab', '入門課 Ch00'],
    pages: ['ch00', 'ch01', 'ch02', 'ch03', 'ch05'],
    deps: ['P0'],
    acceptance: ['T01–T05 通過（TypeScript 與 Python golden 兩邊）', '互動無硬編假值（規格 §20.6）'],
    tests: ['T01', 'T02', 'T03', 'T04', 'T05'],
    risks: ['T05 偶數 N 的 tie 定義'],
    errata: ['E02', 'E07', 'E14'],
  },
  {
    id: 'P2',
    title: 'PLL / Stability',
    deliverables: ['Ch04、Ch06–08：方塊圖、Polarity Explorer、Delay / Filtered-x、Phase Margin Lab、Dual-Loop Explorer', '共用模型 pll.ts、blockLms.ts', 'SSPLL 案例頁'],
    pages: ['ch04', 'ch06', 'ch07', 'case-sspll', 'ch08'],
    deps: ['P0', 'P1'],
    acceptance: ['T06–T09 通過', '能解釋失穩原因（$C\\le0$、$g\\ge2$、更新延遲、雙迴路耦合）'],
    tests: ['T06', 'T07', 'T08', 'T09'],
    risks: ['CT $H(s)$ 與 DT 相關性混用 → 明確 CT→DT 映射'],
    errata: ['E44', 'E19'],
  },
  {
    id: 'P3',
    title: 'MIMO / Bias',
    deliverables: ['Ch09–11：PE / Eigen Lab、GOS one-hot gauge、MIMO LMS（Jacobian、Preconditioner）、Bias & INL Lab'],
    pages: ['ch09', 'ch10', 'ch11'],
    deps: ['P0'],
    acceptance: ['T10–T12、T18 通過'],
    tests: ['T10', 'T11', 'T12', 'T18'],
    risks: ['近奇異矩陣的數值穩定性'],
    errata: ['E01', 'E04', 'E05'],
  },
  {
    id: 'P4',
    title: 'Noise / Quantization',
    deliverables: ['Ch12–14：LMS Noise Lab、Code Mixing Lab、Spur、Quantized Gain Lab（freeze / toggle / stochastic / ΔΣ / ΔΣ+dither）、Learning-rate optimizer'],
    pages: ['ch12', 'ch13', 'ch14'],
    deps: ['P0', 'P2'],
    acceptance: ['T13–T17 通過', 'PSD 總功率核對（Parseval）'],
    tests: ['T13', 'T14', 'T15', 'T16', 'T17'],
    risks: ['Noise BW 定義歧義', 'PSD 正規化'],
    errata: ['E06', 'E10', 'E28'],
  },
  {
    id: 'P5',
    title: 'Integrated Lab',
    deliverables: [
      'Unified Calibration Lab（DSM / MASH → DTC → $H_{\\mathrm{PD}}$ → comparator → GMAC → gain register → 量化）、FCW sweep、Monte Carlo、報告輸出',
      'Experiment Gallery 12 個 presets；Training Sequence Lab；Sign-off checklist；Formula reference；Papers；Research backlog（本頁）；驗證狀態頁',
    ],
    pages: ['lab', 'gallery', 'signoff', 'formulas', 'papers', 'roadmap', 'verification', 'models'],
    deps: ['P0', 'P1', 'P2', 'P3', 'P4'],
    acceptance: ['Presets 可載入、執行、繪圖、下載（CSV / JSON / HTML）', '全部警示可見', 'preset 重現、報告輸出（規格 §20.6）'],
    tests: [],
    risks: ['長序列效能 → Worker + 抽樣顯示'],
    errata: [],
  },
]

export type PhaseState = 'tests-pass' | 'partial' | 'pending' | 'manual'

export const PHASE_STATE_LABEL: Record<PhaseState, string> = {
  'tests-pass': '驗收測試皆通過（其他項目待人工確認）',
  partial: '部分 T-id 通過',
  pending: '尚無 T-id 兩邊皆通過',
  manual: '無 T-id：需人工驗收',
}

export interface PhaseProgress {
  total: number
  counts: Record<TestStatus, number>
  state: PhaseState
}

/** 由 verification-status.json 計算 phase 的驗收進度（不會產生 verified）。 */
export function phaseProgress(phase: Phase, file?: unknown): PhaseProgress {
  const counts: Record<TestStatus, number> = { pass: 0, partial: 0, fail: 0, missing: 0 }
  for (const t of phase.tests) counts[getTestStatus(t, file).status]++
  const total = phase.tests.length
  let state: PhaseState
  if (total === 0) state = 'manual'
  else if (counts.pass === total) state = 'tests-pass'
  else if (counts.pass > 0 || counts.partial > 0) state = 'partial'
  else state = 'pending'
  return { total, counts, state }
}

// ───────────────────────────── Definition of Done（規格 §20.5） ─────────────────────────────

export interface DodItem {
  n: number
  text: string
  /** 如何判斷：'computed' 由資料計算；'manual' 需人工 */
  check: 'computed' | 'manual'
  where?: string[]
}

export const DOD: DodItem[] = [
  { n: 1, text: '可在本機啟動的網站，而非只有截圖或靜態 HTML 空殼', check: 'manual', where: ['dashboard'] },
  { n: 2, text: '14 個主章節全文，文字、KaTeX 推導、Mermaid 方塊圖可讀', check: 'computed' },
  { n: 3, text: '優先實作 L0–L2 的即時互動；L3–L5 至少提供可重現數值範例與擴充介面', check: 'manual', where: ['models'] },
  { n: 4, text: 'Chapter / Experiment / Theory / Tests 互相連結，公式不能單獨藏在 source code', check: 'manual', where: ['formulas'] },
  { n: 5, text: 'T01–T18 有可機器執行的測試，通過的測試才可標成 verified', check: 'computed', where: ['verification'] },
  { n: 6, text: 'Experiment presets 可載入、執行、繪圖、下載 CSV / JSON', check: 'computed', where: ['gallery'] },
  { n: 7, text: '有一份可自行閱讀的 Model Assumptions 與 Known Limitations（docs/assumptions.md）', check: 'manual', where: ['models'] },
  { n: 8, text: '有一頁 Research Backlog，未完成項目不得標成已驗證（本頁）', check: 'manual', where: ['roadmap'] },
]

export const ALL_T_IDS = Array.from({ length: 18 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`)

// ───────────────────────────── 文件 ─────────────────────────────

/** docs/validation.md 「方法」段落的統計（data.test.ts 會讀原檔核對，避免與文件不一致） */
export const VALIDATION_DOC = { checks: 237, refuted: 9 }

export interface DocEntry {
  path: string
  title: string
  purpose: string
  /** 站內對應頁面（registry id） */
  page?: string
}

export const DOCS: DocEntry[] = [
  { path: 'docs/LMS_PLL_Calibration_Website_Blueprint_ZH_TW.md', title: '主規格', purpose: '產品與數學規格；附錄 C 即本頁的 R1–R10，§20.6 為 P0–P5 的驗收' },
  { path: 'docs/validation.md', title: '規格驗算與勘誤', purpose: '逐項重算規格中的公式與數值；網站一律採用修正後版本', page: 'verification' },
  { path: 'docs/implementation_plan.md', title: '實作計畫', purpose: 'P0–P5 的交付、依賴、驗收與風險（本頁下方）' },
  { path: 'docs/assumptions.md', title: '模型假設與已知限制', purpose: 'L0–L6 模型層級、全站共用假設、架構限制', page: 'models' },
  { path: 'docs/dev-conventions.md', title: '開發約定', purpose: '目錄結構、共用元件、單位與極性、測試、審查腳本' },
  { path: 'docs/teaching-style.md', title: '教學風格', purpose: '微積分起點、逐步推導、LaTeX、核心程式碼並排、符號表、思考題' },
  { path: 'docs/dev/infra-api.md', title: '基礎模組 API', purpose: 'core / signal / models / components / workers / golden 的用法' },
  { path: 'golden/README.md', title: 'Python golden model', purpose: '獨立的 NumPy / SciPy 實作與 golden/vectors/*.json' },
  { path: 'docs/analysis/sspll-gos-phos-polarity.md', title: 'SSPLL GOS / PHOS 極性分析（分析中）', purpose: '使用者案例的完整推導：Type-I / Type-II SSPLL 與 CPPLL 的 $H_{\\mathrm{PD}}$、PHOS circulant mode、GOS 鋸齒、對策排序', page: 'case-sspll' },
  { path: 'analysis/sspll/', title: 'SSPLL 離線 golden 與時域模擬', purpose: 'Python golden（test_SSPLL_*）、時域 replica 與閉迴路 LMS 模擬；輸出 src/data/sspll/*.json 給案例頁', page: 'case-sspll' },
]
