/**
 * Dashboard 的內容資料：六個條件、三條學習路線（規格 §19.1）、附錄 E 的 15 個問題、章節中繼資料。
 * 頁面清單一律從 '@/app/registry' 的 PAGES 讀取；這裡只放「頁面 id → 教學對照」，由 data.test.ts 驗證每個 id 都存在。
 * 說明文字中的數學以 `$…$` 標記，由 Rich 元件轉成 KaTeX（不在內文用 Unicode 拼公式）。
 */
import type { ClaimKind, ModelLevelId } from '@/data/types'
import type { ConditionId } from './thesisModel'

export interface ConditionDef {
  id: ConditionId
  n: number
  zh: string
  en: string
  /** 這個條件在問什麼（$…$ 為 TeX） */
  ask: string
  /** 判據（TeX） */
  tex: string
  claim: ClaimKind
  /** 判據成立的模型條件 */
  claimNote: string
  /** 不滿足時會看到什麼 */
  failure: string
  /** 對應的硬體 / RTL */
  hardware: string
  pages: string[]
  tests: string[]
  questions: number[]
  errata: string[]
  /** 反例：會讓這個條件失敗的內建 preset id（presets.ts；卡片上的「載入反例」） */
  example: string
  /** 卡片色條（--series-n） */
  color: string
}

export const SIX_CONDITIONS: ConditionDef[] = [
  {
    id: 'identifiability',
    n: 1,
    zh: '資訊足夠',
    en: 'Identifiability / Persistent Excitation',
    ask: '每一個要校正的參數，都在 GMAC 的相關量裡留下「分得開」的痕跡嗎？',
    tex: String.raw`\lambda_{\min}(\mathbf R)>0,\qquad \mathbf R=E\!\left[\mathbf u\,\mathbf u^{T}\right]`,
    claim: 'exact',
    claimNote: '以實際送進 GMAC 的有效 regressor 計算 $\\mathbf R$',
    failure:
      '$\\lambda_{\\min}=0$：某個方向完全看不見（GOS / PHOS 的 common-mode、經 $H_{\\mathrm{PD}}(1)=0$ 觀測的 global offset）。$\\lambda_{\\min}$ 很小：慢模式，收斂時間 $\\propto1/\\lambda_{\\min}$；用 preconditioner 加速又會放大弱方向雜訊。',
    hardware: 'DSM code pattern、FCW、PHOS one-hot 相位選擇、training sequence',
    pages: ['ch09', 'ch10', 'case-sspll'],
    tests: ['T10', 'T11', 'T18'],
    questions: [12, 13],
    errata: ['E04', 'E05'],
    example: 'thesis-no-pe',
    color: '--series-1',
  },
  {
    id: 'polarity',
    n: 2,
    zh: '更新方向正確',
    en: 'Update polarity',
    ask: '把 $\\mu$ 設成正數時，係數真的往 $a$ 走，而不是離 $a$ 越來越遠？',
    tex: String.raw`C=E[x\,u]>0,\qquad C_D=\tfrac{A^2}{2}\,|H|\cos(\phi+\Omega D)`,
    claim: 'exact',
    claimNote: '單頻 code $x=A\\cos\\Omega n$；多頻時要用 $E[x\\,(h*x)]$ 整體判斷',
    failure: '$C<0$：平均誤差每個 block 放大（發散）；$C=0$：沒有恢復力，係數隨雜訊 random walk。PLL error transfer 的相位、code 與 error 沒對齊（misalignment）、comparator 0/1 編碼錯誤都會讓 $C$ 變號。',
    hardware: 'BBPD / comparator 極性、GMAC code delay register、filtered-x 路徑模型',
    pages: ['ch06', 'ch07', 'case-sspll', 'ch08'],
    tests: ['T06', 'T07'],
    questions: [2, 7, 8, 9],
    errata: ['E20', 'E46'],
    example: 'thesis-phase120',
    color: '--series-2',
  },
  {
    id: 'stability',
    n: 3,
    zh: '動態穩定',
    en: 'Loop stability',
    ask: '方向對了，步子會不會太大、更新會不會太晚，導致係數震盪甚至發散？',
    // 兩行：排成一行（457px）比 1280px 桌機上的卡片（407px）寬，結尾的 (g = μK_qC) 要橫向捲動才看得到；內容與原來的一行相同
    tex: String.raw`\begin{gathered}p=1-\mu K_q C\\[2pt]0<g<2\sin\frac{\pi}{4d+2}\quad(g=\mu K_qC)\end{gathered}`,
    claim: 'exact',
    claimNote:
      '局部線性化平均模型、$d$ 個 block 的 commit 延遲；$d=0$ 時為 $0<g<2$。$\\mu>0$、$K_q>0$ 時，下限 $0<g$ 就是條件 2 的 $C>0$（穩定 $\\Rightarrow$ 極性正確，反過來不成立）',
    failure:
      '$g$ 太大：震盪發散；GMAC 用 sum 卻沒把 $\\mu$ 除以 $N$：$g$ 放大 $N$ 倍。Mean 穩定不代表 mean-square 穩定。雙迴路：在 Ch08 §8.4 的二狀態模型裡（誤差晚一個 block 才被 GMAC 看到），完整的 $\\mu$ 上界只有 quasi-static 簡化模型（把主 PLL 當成瞬間到穩態）的一半；這是該模型的結果，不是所有 PLL 雙迴路的通則。',
    hardware: 'REG_LMS_MU、GMAC right shift、commit pipeline latency、主 PLL 頻寬',
    pages: ['ch03', 'ch08', 'ch14'],
    tests: ['T02', 'T03', 'T08', 'T09'],
    questions: [5, 6, 9, 10],
    errata: ['E14', 'E19'],
    example: 'thesis-latency',
    color: '--series-3',
  },
  {
    id: 'variance',
    n: 4,
    zh: '統計精度足夠',
    en: 'Statistical accuracy (variance)',
    ask: '收斂之後，係數被 comparator 雜訊推來推去的幅度夠小嗎？',
    tex: String.raw`\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2},\qquad \sigma_\eta^2\approx\frac{P_x}{N}`,
    claim: 'approx',
    claimNote: '白色 GMAC 雜訊、$|p|<1$、近平衡時 $q$ 近似 iid',
    failure: '$\\mu$ 大：收斂快但 $\\sigma_w$ 大；$\\mu$ 小：安靜但追不上 PVT 漂移。1-bit 的資訊以 $\\sqrt N$ 累積，$N$ 改變時 tie 與 scaling 都要重新檢查。',
    hardware: 'REG_GMAC_N、REG_LMS_MU、comparator noise、tracking schedule',
    pages: ['ch05', 'ch12', 'ch14'],
    tests: ['T04', 'T05', 'T13', 'T14'],
    questions: [3, 4, 13, 14],
    errata: ['E02', 'E06'],
    example: 'thesis-rho099-precond',
    color: '--series-4',
  },
  {
    id: 'bias',
    n: 5,
    zh: '收斂到正確的物理參數',
    en: 'Bias / correct fixed point',
    ask: 'GMAC 平均歸零的那一點，真的是 DTC 的正確 gain 嗎？',
    tex: String.raw`w^*=a+\frac{B}{C},\qquad B=E\!\left[x\,\varepsilon_{\mathrm{det}}\right]`,
    claim: 'exact',
    claimNote: 'MSE-LMS 的線性固定點；Sign-LMS 只在殘差 $\\ll\\sigma_v$ 時近似成立（勘誤 E01）',
    failure: 'comparator offset、DTC INL、code-correlated 干擾讓 $B\\ne0$；$C\\to0$ 時同樣的 $B$ 造成更大的 bias（線性化的 $B/C$：大到 comparator 飽和時它只是線性外推，$a+B/C$ 不再是 Sign-LMS 的固定點，Ch11 §11.4）。$E[G]=0$ 只代表 GMAC 看不到殘差，不代表殘差為零。',
    hardware: 'comparator offset、DTC INL、主迴路 DC null（shared BBPD）',
    pages: ['ch11', 'ch11b'],
    tests: ['T12'],
    questions: [11],
    errata: ['E01', 'E03', 'E12'],
    example: 'thesis-bias-only',
    color: '--series-5',
  },
  {
    id: 'system',
    n: 6,
    // 名稱是純文字（Hero 的膠囊、體檢表、chip、HC-DB.6 的判定列都原樣印出），不放 $…$
    zh: '殘餘誤差在預算內',
    en: 'System-level budget (timing error, spur)',
    ask: '校正收斂之後，剩下的 DTC-referred timing error $\\sigma_{\\delta t}$ 與單 tone spur，都在預算內嗎？',
    tex: String.raw`\begin{gathered}\sigma_{\delta t}=\sqrt{P_x\,(\Delta w^2+\sigma_w^2)}\le\sigma_{\delta t,\max}\\[2pt]\mathrm{Spur}\approx20\log_{10}\!\left(\pi f_{\mathrm{out}}|T|A_t\right)\le\mathrm{Spur}_{\max}\end{gathered}`,
    claim: 'approx',
    claimNote:
      '單參數、線性化 DTC gain error、單 tone、小角度調變；$\\sigma_{\\delta t}$ 是 DTC-referred（還沒經過 PLL 的 $T(f)$，不是輸出 jitter；$|T|$ 只用在 spur）；只和預算比，不和校正前比',
    failure: '低頻的 gain noise 乘上寬頻 DSM code 會變成寬頻 timing error；6-bit 量化的 limit cycle 會產生 tone。各項單獨過關，合起來仍可能超出 timing error / spur 預算。',
    hardware: 'DTC 輸出、PLL output transfer $T$、6-bit gain register、sign-off matrix',
    pages: ['ch12', 'ch13', 'signoff', 'lab'],
    tests: ['T13', 'T15', 'T16', 'T17'],
    questions: [11, 14, 15],
    errata: ['E09', 'E15', 'E33'],
    example: 'thesis-spur-t15',
    color: '--series-6',
  },
]

/** 規格 §16.3「何時可以宣稱穩定」的語句範例 */
export const CLAIM_EXAMPLES: { ok: boolean; text: string }[] = [
  { ok: true, text: '在明定的一階平均模型、$0<g<2$ 下，局部平均誤差漸近收斂。' },
  { ok: true, text: '在此固定點的線性化雙迴路模型中，所有 closed-loop eigenvalues 都位於 unit circle 內。' },
  { ok: true, text: '指定的 FCW / PVT sweep、Monte Carlo seeds 均未觀察到溢位或發散。' },
  { ok: false, text: 'Phase margin 大於 $60^\\circ$，因此所有 Sign-LMS、所有 FCW 都保證校正正確。' },
  { ok: false, text: 'GMAC output 等於零，因此 DTC gain 沒有偏差且 spurs 都消失。' },
]

export interface RouteStep {
  /** 規格 §19.1 的步驟名稱 */
  label: string
  zh: string
  page: string
  also?: string[]
  /** 規格書段落 */
  sections: string
}

export interface RouteDef {
  id: 'math' | 'pll' | 'chip'
  title: string
  en: string
  blurb: string
  steps: RouteStep[]
}

/**
 * 規格 §19.1：網站首頁應呈現的三條主要學習路線。
 * 數學路線在規格的六步之前多了 STEP 1「黑盒子」（Ch00 入門課）：第一次來的人先手算兩步，再進規格的 MSE → … → MIMO。
 */
export const ROUTES: RouteDef[] = [
  {
    id: 'math',
    title: '數學路線',
    en: 'Math route',
    blurb: '只需要微積分：先用黑盒子手算兩步，再從平方誤差與導數出發；第一次用到期望值、特徵值時再補先備知識。',
    steps: [
      { label: 'Black Box', zh: '黑盒子：預測→比較→修正', page: 'ch00', sections: '入門' },
      { label: 'MSE', zh: '平方誤差', page: 'ch01', sections: '§1–2' },
      { label: 'Gradient', zh: '梯度下降', page: 'ch02', sections: '§1.1' },
      { label: 'Scalar Stability', zh: '純量穩定性', page: 'ch03', sections: '§3' },
      { label: 'Sign-LMS', zh: '1-bit 更新', page: 'ch02', also: ['ch05'], sections: '§2.2、§5' },
      { label: 'PE', zh: '持續激勵', page: 'ch09', sections: '§9' },
      { label: 'MIMO', zh: '多參數', page: 'ch10', sections: '§10' },
    ],
  },
  {
    id: 'pll',
    title: 'PLL 架構路線',
    en: 'PLL architecture route',
    blurb: '沿著訊號流走一遍：code 從 DSM 出發，經 DTC、PD、GMAC，再回到 gain register。',
    steps: [
      { label: 'DSM Code', zh: 'Regressor 來源', page: 'ch04', sections: '§4' },
      { label: 'DTC', zh: '被校正的 gain', page: 'ch04', sections: '§4.1' },
      { label: 'PD', zh: '1-bit comparator', page: 'ch05', also: ['ch04'], sections: '§5' },
      { label: 'GMAC', zh: '相關累加器', page: 'ch04', sections: '§4.2' },
      { label: 'H(z)', zh: 'PLL error transfer', page: 'ch06', sections: '§6' },
      { label: 'Polarity', zh: '更新極性', page: 'ch06', also: ['ch07', 'case-sspll'], sections: '§6.2、§7' },
      { label: 'Dual Loop', zh: '主迴路 × LMS', page: 'ch08', sections: '§8.4' },
    ],
  },
  {
    id: 'chip',
    title: '晶片驗證路線',
    en: 'Chip verification route',
    blurb: '從「會收斂」走到「可以 sign-off」：雜訊、偏差、量化、輸出 spur / jitter、定點與驗證矩陣。',
    steps: [
      { label: 'Noise', zh: '係數雜訊', page: 'ch12', also: ['ch05'], sections: '§12.1' },
      { label: 'Bias', zh: '固定點偏差', page: 'ch11', sections: '§11' },
      { label: 'Quantization', zh: '6-bit 量化', page: 'ch13', sections: '§13' },
      { label: 'Spur/Jitter', zh: '輸出影響', page: 'ch12', sections: '§12.2–12.4' },
      { label: 'Fixed Point', zh: 'RTL 細節', page: 'models', also: ['ch13'], sections: '§16.1' },
      { label: 'Sign-off', zh: '驗證矩陣', page: 'signoff', also: ['verification'], sections: '§16.2' },
    ],
  },
]

export interface OutcomeDef {
  /** registry 的 PageGroup（GROUP_LABEL 的標題：Part A｜LMS 數學基礎…） */
  part: 'A' | 'B' | 'C'
  /** 學完這個 Part 之後能做的事（$…$ 為 TeX），每句連到一章 */
  can: { text: string; page: string }[]
  /** 卡片色條（--series-n） */
  color: string
}

/** Hero 下方的「學完你能做什麼」：三個 Part 各兩句可以驗證的能力，各自連到教那件事的章節 */
export const OUTCOMES: OutcomeDef[] = [
  {
    part: 'A',
    can: [
      { text: '用紙筆手算 LMS 兩步（預測 → 比較 → 修正）', page: 'ch00' },
      { text: '看一眼 $\\mu$ 與 $x$ 就判斷更新會不會發散', page: 'ch03' },
    ],
    color: '--series-1',
  },
  {
    part: 'B',
    can: [
      { text: '算出自己 PLL 的 comparator gain $K_q$ 與該累加幾筆 $N$', page: 'ch05' },
      { text: '判斷 PLL error transfer 的相位會不會讓 GMAC 的更新極性反過來', page: 'ch06' },
    ],
    color: '--series-3',
  },
  {
    part: 'C',
    can: [
      { text: '估出係數雜訊 $\\sigma_w$ 與它在輸出造成的 spur', page: 'ch12' },
      { text: '用數字決定 6-bit gain register 要 freeze、toggle 還是 dither', page: 'ch13' },
    ],
    color: '--series-5',
  },
]

export interface QuestionDef {
  n: number
  /** 規格附錄 E 原文（$…$ 為 TeX） */
  text: string
  /** 第一個為主要回答頁 */
  pages: string[]
  conditions: ConditionId[]
  tests: string[]
  errata?: string[]
}

/** 規格附錄 E：網站最後應能回答的 15 個問題 */
export const QUESTIONS: QuestionDef[] = [
  { n: 1, text: '為什麼叫 LMS？為何使用平方而不是絕對值？', pages: ['ch01', 'ch00', 'ch02'], conditions: [], tests: ['T01'] },
  { n: 2, text: '為什麼 GMAC 的 $ex$ 就是最小化方向？', pages: ['ch02', 'ch01', 'ch04'], conditions: ['polarity'], tests: ['T01'] },
  { n: 3, text: '為什麼 1 fs Error 埋在 100 fs Noise 裡，1-bit Comparator 仍可保留資訊？', pages: ['ch05'], conditions: ['variance'], tests: ['T04'] },
  { n: 4, text: '要累加幾筆才能以指定機率判斷 Error 正負？', pages: ['ch05'], conditions: ['variance'], tests: ['T05'], errata: ['E02'] },
  { n: 5, text: '為何 LMS 可能震盪收斂、臨界震盪、或發散？', pages: ['ch03', 'ch08'], conditions: ['stability'], tests: ['T02', 'T08'] },
  { n: 6, text: 'Mean Stability 與 Mean-Square Stability 為何不一樣？', pages: ['ch03'], conditions: ['stability'], tests: ['T03'], errata: ['E14'] },
  { n: 7, text: '為何 PLL 主迴路穩定，LMS 卻可能因 Phase Shift 發散？', pages: ['ch06', 'case-sspll'], conditions: ['polarity', 'stability'], tests: ['T06'] },
  { n: 8, text: '只加 Delay Register 能否改善？何時必須用 Filtered-x？', pages: ['ch07'], conditions: ['polarity'], tests: ['T07'] },
  { n: 9, text: 'Polarity Margin 與真正 LMS Phase Margin 是哪兩個不同概念？', pages: ['ch08'], conditions: ['polarity', 'stability'], tests: ['T08'], errata: ['E20'] },
  { n: 10, text: '什麼時候快速 PLL 和慢速 LMS 不能分開分析？', pages: ['ch08'], conditions: ['stability'], tests: ['T09'], errata: ['E19'] },
  { n: 11, text: '為何 GMAC 歸零不代表 DTC Gain 正確、Spur 為零？', pages: ['ch11', 'ch12'], conditions: ['bias', 'system'], tests: ['T12'], errata: ['E01', 'E03'] },
  { n: 12, text: '何謂 Persistent Excitation？多參數 LMS 為何有非常慢的模式？', pages: ['ch09'], conditions: ['identifiability'], tests: ['T10', 'T11'], errata: ['E04'] },
  { n: 13, text: '為什麼 Preconditioning 可以加快收斂，卻會把弱資訊方向的 Noise 放大？', pages: ['ch10'], conditions: ['identifiability', 'variance'], tests: ['T11', 'T18'], errata: ['E05', 'E21'] },
  { n: 14, text: 'Comparator Noise 經 GMAC 與 DSM Code 相乘後，如何變成 PLL Output PN/Spur？', pages: ['ch12'], conditions: ['variance', 'system'], tests: ['T13', 'T14', 'T15'], errata: ['E06', 'E09'] },
  { n: 15, text: '6-bit Gain 要 Freeze、periodic toggle、dither 還是 noise shape，應該怎麼做定量選擇？', pages: ['ch13', 'ch14'], conditions: ['system'], tests: ['T16', 'T17'], errata: ['E15', 'E49'] },
]

export interface ChapterMeta {
  /** 本頁互動實驗使用的模型層級（Dashboard 的編輯對照；data.test.ts 會檢查 Ch00–Ch14 所列層級確實出現在該章原始碼中） */
  levels: ModelLevelId[]
  /** 卡片上的一句話（$…$ 為 TeX） */
  summary: string
}

/** 頁面 id → 教學中繼資料（所有 id 皆須存在於 PAGES） */
export const CHAPTER_META: Record<string, ChapterMeta> = {
  ch00: { levels: ['L0'], summary: '黑盒子 $y=ax$：預測→比較→修正，先手算兩步。' },
  ch01: { levels: ['L0'], summary: '為什麼是平方？MSE 的最佳解是平均，MAE 是中位數。' },
  ch02: { levels: ['L0'], summary: '梯度 $-e\\,x$ 從哪來；Sign-Error / Sign-Sign 丟掉了什麼。' },
  ch03: { levels: ['L0'], summary: '等比數列 $p^n$ 與穩定區間；mean 與 mean-square 不同。' },
  ch04: { levels: ['L1', 'L2', 'L5'], summary: 'DSM → DTC → PD → GMAC → gain update 的訊號流與 RTL。' },
  ch05: { levels: ['L1'], summary: '1 fs 埋在 100 fs 雜訊：$K_q$、$\\sqrt N$ 累積與 tie rule。' },
  ch06: { levels: ['L1', 'L2'], summary: 'PLL error transfer 的相位讓 $C$ 變號。' },
  ch07: { levels: ['L1', 'L2'], summary: 'Delay alignment 只能補單一頻率；filtered-x 的適用範圍。' },
  'case-sspll': { levels: ['L2', 'L3'], summary: 'Subsampling PLL 中 GOS / PHOS 的極性案例。' },
  ch08: { levels: ['L1', 'L2'], summary: '真正的 calibration PM、更新延遲 $d$ 與雙迴路。' },
  ch09: { levels: ['L3'], summary: '$\\lambda_{\\min}$、persistent excitation 與 gauge freedom。' },
  ch10: { levels: ['L3'], summary: 'Jacobian、preconditioner 與弱方向雜訊放大。' },
  ch11: { levels: ['L1', 'L2'], summary: '$w^*=a+B/C$：offset、INL 與主迴路 DC null。' },
  ch11b: { levels: ['L1', 'L3', 'L4'], summary: 'INL 把 MASH 的高頻雜訊折回帶內；分段／LUT／多項式 LMS 的收斂、抖動、條件數與 gauge。' },
  ch12: { levels: ['L1', 'L4'], summary: '$\\sigma_w$、頻寬定義、$\\delta t=x\\,\\delta w$ 與 spur。' },
  ch13: { levels: ['L5'], summary: '6-bit：freeze、toggle、dither、$\\Delta\\Sigma$ 的 tone 與功率。' },
  ch14: { levels: ['L1'], summary: '$\\mu$、$N$ 與 tracking schedule 的設計方程。' },
  models: { levels: ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'], summary: 'L0–L6 behavioral model、RTL 與定點細節。' },
  verification: { levels: [], summary: 'T01–T18 數值回歸測試與勘誤總表。' },
  lab: { levels: ['L1', 'L2', 'L4'], summary: '整合式 pipeline 模擬與 HTML 報告。' },
  workbook: { levels: [], summary: '全站「帶入手算」題彙整：自己代數字、逐步對答案、隨機出題。' },
  gallery: { levels: [], summary: '規格 §19.2 的 12 個預設實驗。' },
  signoff: { levels: ['L4', 'L5', 'L6'], summary: 'Sign-off matrix 與「可以宣稱什麼」。' },
  formulas: { levels: [], summary: '全站公式與單位速查。' },
  papers: { levels: [], summary: '建議閱讀（附錄 D）。' },
  roadmap: { levels: [], summary: '尚未驗證的研究題目 R1–R10。' },
}

/** 某頁涵蓋哪些條件（由 SIX_CONDITIONS.pages 反查） */
export function conditionsForPage(pageId: string): ConditionId[] {
  return SIX_CONDITIONS.filter((c) => c.pages.includes(pageId)).map((c) => c.id)
}

/** 某頁回答哪些問題（由 QUESTIONS.pages 反查） */
export function questionsForPage(pageId: string): number[] {
  return QUESTIONS.filter((q) => q.pages.includes(pageId)).map((q) => q.n)
}

export function conditionById(id: ConditionId): ConditionDef {
  const c = SIX_CONDITIONS.find((x) => x.id === id)
  if (!c) throw new Error(`unknown condition ${id}`)
  return c
}

/** 章節短代號：'ch06' → 'Ch06'、'case-sspll' → '07b'、其他頁回傳 undefined */
export function shortCode(pageId: string): string | undefined {
  if (/^ch\d\d$/.test(pageId)) return `Ch${pageId.slice(2)}`
  if (pageId === 'case-sspll') return 'Ch07b'
  return undefined
}
