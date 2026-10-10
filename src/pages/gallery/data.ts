/**
 * Experiment Gallery 的資料層（純函式，不 import React）：
 * - 規格 §19.2 的 12 個必備 preset 槽位（GALLERY_SLOTS）與存在／連結稽核（auditSlots）
 * - 每個 experiment id 的名稱與模型層級（EXPERIMENT_META、levelsOf）
 * - 篩選（filterPresets）、T-id 覆蓋率（testCoverage）、勘誤標記（errataIn）
 *
 * 所有 preset 一律來自 ALL_PRESETS（src/data/presets/*.json）；這裡不新增、不改寫任何 preset，
 * 缺少的槽位只會被「標示為缺少」，絕不補一個假的。
 */
import type { ClaimKind, ModelLevelId, PresetEntry, SourceKind } from '@/data/types'
import errataData from '@/data/errata.json'

/* ───────────────────────── 規格 §17 的 T-id ───────────────────────── */

export const T_IDS = ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T11', 'T12', 'T13', 'T14', 'T15', 'T16', 'T17', 'T18'] as const
export type TId = (typeof T_IDS)[number]

/** 規格 §17 的條件與期望值（$…$ 為 TeX；已依 docs/validation.md 勘誤） */
export const T_SPEC: Record<TId, { input: string; expect: string; errata?: string[] }> = {
  T01: { input: '$a=3,\\ w_0=1,\\ x=2,\\ \\mu=0.1$', expect: '$w_1=1.8,\\ w_2=2.28$' },
  T02: { input: '固定 $x=2$', expect: '穩定條件 $0<\\mu<0.5$' },
  T03: { input: 'iid Gaussian $x$：$E[x^2]=1,\\ E[x^4]=3$', expect: 'mean 上限 $2$、mean-square 上限 $2/3$（iid 純量 $x$ 時為精確式）；另有 almost-sure 上限約 $2.42$', errata: ['E14', 'E38'] },
  T04: { input: '$s=1\\,\\mathrm{fs},\\ \\sigma_v=100\\,\\mathrm{fs}$', expect: '$P(q=+1)\\approx0.503989,\\ K_q\\approx0.00797885\\,\\mathrm{fs^{-1}}$' },
  T05: { input: '同上，$N\\approx42500$', expect: '方向判斷成功率約 $95\\%$（奇數 $N$ 或 tie 平分）', errata: ['E02'] },
  T06: { input: '$x=A\\cos\\Omega n,\\ \\varphi=120^\\circ$（$0<\\Omega<\\pi$）', expect: '$C<0$，正步長平均發散', errata: ['E46'] },
  T07: { input: '$\\varphi=-120^\\circ,\\ \\Omega=\\pi/6,\\ D=4$', expect: '殘餘相位 $0^\\circ$，$C_D$ 為正最大', errata: ['E46'] },
  T08: { input: '$g=1$、無延遲一階模型', expect: 'pole $0$、PM $60^\\circ$' },
  T09: { input: '$r=0.8,\\ b=0.2,\\ c=1,\\ \\mu=1.2$', expect: '$|z|\\approx1.0198>1$', errata: ['E19'] },
  T10: { input: '$R=\\begin{bmatrix}1&0.99\\\\0.99&1\\end{bmatrix}$', expect: '$\\lambda=1.99,\\ 0.01$；$\\kappa=199$' },
  T11: { input: '$\\mu K_q=0.5,\\ \\lambda_{\\min}=0.01$', expect: '慢 pole $0.995$，95% 衰減約 $598$ blocks', errata: ['E05', 'E23'] },
  T12: { input: '$x\\in\\{-2,\\dots,2\\}$ 等機率、$c_3=0.1,\\ a=1$', expect: 'MSE-LMS $w^*=1.34$', errata: ['E01', 'E11'] },
  T13: { input: '$\\sigma_v=100\\,\\mathrm{fs},\\ N=4096,\\ \\mu=10\\,\\mathrm{fs}$（unit-RMS code、identity path、average GMAC）', expect: '$p\\approx0.92021,\\ \\sigma_w\\approx0.399\\,\\mathrm{fs}$', errata: ['E30'] },
  T14: { input: '同上，$f_s=4\\,\\mathrm{GHz}$', expect: '$f_u=976.5625\\,\\mathrm{kHz}$，$f_{3\\,\\mathrm{dB}}\\approx12.93\\,\\mathrm{kHz}$（不是 noise BW）；$\\mathrm{ENBW}\\approx20.29\\,\\mathrm{kHz}$', errata: ['E06', 'E10', 'E26'] },
  T15: { input: '$f_{\\mathrm{out}}=13\\,\\mathrm{GHz}$、$0.5\\,\\mathrm{fs}$ peak', expect: 'spur $\\approx-93.8\\,\\mathrm{dBc}$（$|T|=1$）' },
  T16: { input: '常數 $32.4$、pattern $32,32,33,32,33$', expect: 'mean $32.4$、週期 $5$；主 tone 在 $2f_u/5$', errata: ['E15', 'E47'] },
  T17: { input: '隨機 $32/33$，$P(33)=0.4$', expect: 'mean $32.4$、variance $0.24\\,\\mathrm{LSB}^2$' },
  T18: { input: '$J=\\begin{bmatrix}-1&2\\\\2&-1\\end{bmatrix},\\ M=0.2I$', expect: '$\\operatorname{eig}(I+MJ)=1.2,\\ 0.4$', errata: ['E24'] },
}

/* ───────────────────────── 規格 §19.2：12 個必備 preset ───────────────────────── */

export interface GallerySlot {
  index: number
  /** 規格 §19.2 原文的條件（$…$ 為 TeX） */
  condition: string
  /** 規格要展示的現象 */
  lesson: string
  /** 網站依勘誤採用的修正說法（沒有則省略） */
  corrected?: string
  /** 允許的頁面路徑（第一個是主要頁面） */
  pages: string[]
  /** 允許的 ExperimentShell id */
  experiments: string[]
  /** 規格 §17 對應的 T-id（preset.tests 必須包含；#11 規格沒有對應 T-id） */
  tests: TId[]
  errata: string[]
  claim: ClaimKind
  /** 這個例子的核心公式（TeX） */
  keyFormula: string
  /** 一句話：硬體上對應什麼 */
  hardware: string
  /** 一句話：什麼情況下這個結論會失效（反例／邊界） */
  failure: string
  /** 這個例子的誤差怎麼演化（TeX；§4 統一觀點表） */
  dynamics: string
  /** 回答三個問題中的哪幾個（§4：走不走得回來／停在哪裡／停下來後抖多大） */
  questions: QuestionId[]
}

export type QuestionId = 'converge' | 'where' | 'noise'

export const QUESTION_LABEL: Record<QuestionId, string> = {
  converge: '走不走得回來',
  where: '停在哪裡',
  noise: '停下來後抖多大',
}

export const GALLERY_SLOTS: GallerySlot[] = [
  {
    index: 1,
    condition: '$w_0=1$、$a=3$、$x=2$、$\\mu=0.1$',
    lesson: '從手算理解 LMS',
    pages: ['/ch/01', '/ch/00'],
    experiments: ['lms-playground', 'intro-playground', 'stability-fixed-x'],
    tests: ['T01', 'T02'],
    errata: ['E39', 'E41'],
    claim: 'exact',
    keyFormula: 'w_{n+1}=w_n+\\mu e_nx_n,\\qquad \\delta_n=(1-\\mu x^2)^n\\delta_0',
    hardware: '單一 gain 暫存器 $w$、固定 regressor $x$、沒有 comparator 雜訊：最乾淨的 L0 模型。',
    failure: '$\\mu\\ge 2/x^2=0.5$ 時 $|p|\\ge1$，不再收斂（T02）；$x=0$ 時 $a$ 不可辨識。',
    dynamics: '\\delta_{n+1}=(1-\\mu x^2)\\,\\delta_n',
    questions: ['converge'],
  },
  {
    index: 2,
    condition: '$1\\,\\mathrm{fs}$ error $+$ $100\\,\\mathrm{fs}$ RMS noise',
    lesson: '1-bit 仍保留微弱資訊',
    corrected: '成功率表必須指定 tie rule：$N$ 取奇數（無 tie）或 tie 平分；偶數 $N$ 的嚴格 $P(G_N>0)$ 在 $N=100$ 只有 $49.2\\%$（勘誤 E02）。',
    pages: ['/ch/05'],
    experiments: ['comparator-lab'],
    tests: ['T04', 'T05'],
    errata: ['E02', 'E07', 'E18'],
    claim: 'exact',
    keyFormula: 'P(q=+1)=\\Phi\\!\\left(\\frac{s}{\\sigma_v}\\right),\\qquad K_q=\\frac{\\sqrt{2/\\pi}}{\\sigma_v}',
    hardware: 'Comparator（1-bit PD）後面接 GMAC 累加器：$N$ 個 ±1 加起來才看得到方向。',
    failure: '$s/\\sigma_v$ 變大時 $K_q$ 線性化高估（$0.25\\sigma_v$ 約 1%）；$\\sigma_v\\to0$ 時變成 hard limiter，$K_q$ 無定義。',
    dynamics: 'E[q]=\\operatorname{erf}\\!\\Big(\\frac{s}{\\sqrt2\\,\\sigma_v}\\Big)\\approx K_q s,\\quad \\frac{E[S_N]}{\\mathrm{SD}(S_N)}=\\frac{m\\sqrt N}{\\sqrt{1-m^2}}',
    questions: ['noise'],
  },
  {
    index: 3,
    condition: '原始相關器 phase $\\varphi=120^\\circ$',
    lesson: '正 learning rate 發散',
    pages: ['/ch/06'],
    experiments: ['polarity-explorer'],
    tests: ['T06'],
    errata: ['E46'],
    claim: 'exact',
    keyFormula: 'C=\\tfrac{A^2}{2}|H|\\cos\\varphi<0\\;\\Rightarrow\\;p=1-\\mu K_qC>1',
    hardware: 'GMAC 拿 raw code $x$ 去相關，但 PD 看到的是經過 PLL error path 的 $u=h*x$。',
    failure: '$\\Omega=0$ 或 $\\pi$ 時相關要用 2 倍公式（E46）；大誤差時 comparator 飽和，指數發散轉成線性漂移。',
    dynamics: '\\delta_{k+1}=(1-\\mu K_qC)\\,\\delta_k,\\quad C<0',
    questions: ['converge'],
  },
  {
    index: 4,
    condition: '$\\varphi=-120^\\circ$、$D=4$',
    lesson: 'Delay 修正極性',
    pages: ['/ch/07', '/ch/06'],
    experiments: ['delay-fx-lab', 'polarity-explorer'],
    tests: ['T07'],
    errata: ['E46'],
    claim: 'exact',
    keyFormula: 'C_D=\\tfrac{A^2}{2}|H|\\cos(\\varphi+\\Omega D)',
    hardware: 'GMAC 的 code 走一段 shift register（延遲 $D$ 個 sample）再相乘。',
    failure: '只對單一頻率成立；換一個 $\\Omega$，同一個 $D$ 可能又變號（寬頻 code 需要 filtered-x）。',
    dynamics: '\\delta_{k+1}=(1-\\mu K_qC_D)\\,\\delta_k,\\quad C_D>0',
    questions: ['converge'],
  },
  {
    index: 5,
    condition: '雙迴路 $r=0.8$、$b=0.2$、$c=1$、$\\mu=1.2$',
    lesson: '靜態預測穩定、完整模型發散',
    corrected: '上界減半的原因是觀測路徑中的一個 block 延遲（sample → observe），不是主迴路速度本身（勘誤 E19）。',
    pages: ['/ch/08'],
    experiments: ['dual-loop'],
    tests: ['T09'],
    errata: ['E19', 'E31'],
    claim: 'exact',
    keyFormula: 'z^2-(1+r)z+(r+\\mu bc)=0',
    hardware: '主 PLL 的殘差 $s_k$ 本身有記憶（pole $r$），GMAC 看到的是上一個 block 的 $\\delta$。',
    failure: '時間尺度分離（quasi-static）只在 $\\mu bc\\ll(1-r)^2/4$ 時可信。',
    dynamics: '\\begin{bmatrix}s\\\\\\delta\\end{bmatrix}_{k+1}=\\begin{bmatrix}r&b\\\\-\\mu c&1\\end{bmatrix}\\begin{bmatrix}s\\\\\\delta\\end{bmatrix}_k',
    questions: ['converge'],
  },
  {
    index: 6,
    condition: '$\\rho=0.99$',
    lesson: '慢 eigenmode',
    corrected: '$598$ blocks 的前提是 $K_q$ 正規化為 1（$g=\\mu K_q=0.5$）；物理 $K_q=0.00797885\\,\\mathrm{fs^{-1}}$、$\\mu=0.5\\,\\mathrm{fs}$ 時要 $75{,}091$ blocks（勘誤 E05）。',
    pages: ['/ch/09'],
    experiments: ['pe-eigen-lab'],
    tests: ['T10', 'T11'],
    errata: ['E05', 'E23'],
    claim: 'exact',
    keyFormula: 'p_i=1-\\mu K_q\\lambda_i,\\qquad \\lambda=1\\pm\\rho',
    hardware: '兩個高度相關的校正參數（例如兩個相鄰 PHOS）共用同一組 comparator 決策。',
    failure: '這是 mean recursion 的結論；逐 sample（$N=1$）的 mean-square 半徑可以 $>1$（勘誤 E23）。',
    dynamics: 'E[\\boldsymbol\\delta_{k+1}]=(\\mathbf I-g\\mathbf R)\\,E[\\boldsymbol\\delta_k],\\quad p_i=1-g\\lambda_i',
    questions: ['converge'],
  },
  {
    index: 7,
    condition: '$a=1$、$c_3=0.1$',
    lesson: '三階 INL，最佳線性 gain $1.34$',
    corrected: '$1.34$ 需要 $x$ 在 $\\{-2,\\dots,2\\}$ 等機率，且是 MSE-LMS（或 $\\sigma_v\\gg|e|$ 的 Sign-LMS）的固定點；無雜訊 Sign-LMS 收斂到 $1.40$（勘誤 E01、E11）。',
    pages: ['/ch/11'],
    experiments: ['bias-inl-lab'],
    tests: ['T12'],
    errata: ['E01', 'E11'],
    claim: 'exact',
    keyFormula: 'w^*=a+c_3\\,\\frac{E[x^4]}{E[x^2]}',
    hardware: 'DTC 的三階非線性：單一 gain 暫存器只能做最佳線性近似，殘差不會是 0。',
    failure: '換 code 分布答案就變（±1 code 為 $1.10$、Gaussian 為 $1.30$）；GMAC 歸零 ≠ DTC 誤差歸零。',
    dynamics: 'E[G](w^*)=0\\;\\Rightarrow\\;w^*=a+c_3\\frac{E[x^4]}{E[x^2]}\\ne a',
    questions: ['where'],
  },
  {
    index: 8,
    condition: '$f_s=4\\,\\mathrm{GHz}$、$N=4096$、$\\sigma_v=100\\,\\mathrm{fs}$、$\\mu=10\\,\\mathrm{fs}$',
    lesson: 'gain noise 約 $0.399\\,\\mathrm{fs}$',
    corrected: '$12.9\\,\\mathrm{kHz}$ 是 $-3\\,\\mathrm{dB}$ 頻寬，不是 noise-equivalent bandwidth（ENBW $=20.29\\,\\mathrm{kHz}$；勘誤 E06、E10）。$0.399\\,\\mathrm{fs}$ 的前提是 unit-RMS $\\pm1$ code、identity path、average GMAC（勘誤 E30）；它是 gain-equivalent 的係數雜訊，不是 output jitter。',
    pages: ['/ch/12'],
    experiments: ['lms-noise-lab'],
    tests: ['T13', 'T14'],
    errata: ['E06', 'E10', 'E26', 'E27', 'E30'],
    claim: 'approx',
    keyFormula: '\\sigma_w^2=\\frac{\\mu^2\\sigma_\\eta^2}{1-p^2},\\qquad p=1-\\mu K_qC',
    hardware: 'GMAC 每 $N$ 個 sample 給一次 1-bit 統計，係數暫存器在 $f_u=f_s/N$ 更新並帶著雜訊。',
    failure: '線性化只在 $|\\delta|\\lesssim0.2\\sigma_v$ 成立；sum 模式忘了 $/N$ 會讓 $g$ 放大 $4096$ 倍。',
    dynamics: '\\delta w_{k+1}=p\\,\\delta w_k+\\mu\\,\\eta_k',
    questions: ['noise'],
  },
  {
    index: 9,
    condition: '$13\\,\\mathrm{GHz}$ output $+$ $0.5\\,\\mathrm{fs}$ peak tone',
    lesson: '約 $-93.8\\,\\mathrm{dBc}$ spur',
    pages: ['/ch/12'],
    experiments: ['code-mixing-lab'],
    tests: ['T15'],
    errata: ['E09', 'E28'],
    claim: 'exact',
    keyFormula: '\\beta=2\\pi f_{\\mathrm{out}}|T|A_t,\\qquad \\mathrm{SSB}=20\\log_{10}\\frac{\\beta}{2}',
    hardware: '係數擾動 $\\delta w$ 乘上 DSM code $x$ 變成 DTC 時間誤差 $\\delta t=x\\,\\delta w$，再經 $T$ 到 PLL output。',
    failure: '要用 coherent sampling 量 peak；PD 的 high-pass $H_{PD}$ 與 output 的 low-pass $T$ 不能混用。',
    dynamics: '\\delta t[n]=x[n]\\cdot\\delta w[n]',
    questions: ['noise'],
  },
  {
    index: 10,
    condition: '6-bit target $32.4$',
    lesson: 'Freeze vs periodic toggle vs dither vs first-order noise shaping',
    corrected: '常數輸入時一階 ΔΣ 與 deterministic toggle 是同一個週期 5 循環（只差相位）；freeze 的誤差 $w-w^*=-0.4$ LSB（依 $\\delta=a-w$ 為 $+0.4$）（勘誤 E15、E49）。',
    pages: ['/ch/13'],
    experiments: ['quantized-gain-lab'],
    tests: ['T16', 'T17'],
    errata: ['E15', 'E47', 'E49'],
    claim: 'exact',
    keyFormula: 'y[n]=w_H+r[n-1]-r[n]',
    hardware: '6-bit DTC gain code 只能是整數；高解析度的 LMS 累加器要用某種方式「降到」整數。',
    failure: '只有 time-varying $w_H$ 或 dither 會讓 ΔΣ 與 toggle 不同；dither 消除譜線但總功率上升。',
    dynamics: 'y[n]=Q\\big(w_H+r[n-1]\\big),\\quad r[n]=w_H+r[n-1]-y[n]',
    questions: ['where', 'noise'],
  },
  {
    index: 11,
    condition: '四相 one-hot $+$ global offset',
    lesson: '不可辨識性',
    corrected: '主 PLL 若有 $H_{PD}(1)=0$ 的 DC null，$R_u$ 會有兩個零 eigenvalue（$b$ 也看不到），不是只有一個（勘誤 E04）。',
    pages: ['/ch/09'],
    experiments: ['gauge-one-hot'],
    tests: [],
    errata: ['E04'],
    claim: 'exact',
    keyFormula: 'R_x\\mathbf n=\\mathbf 0,\\qquad \\mathbf n\\propto(1,-1,-1,-1,-1)',
    hardware: '8 相 PMUX 的 PHOS（每相一個 offset）加上一個 global offset：兩組參數給出完全相同的輸出。',
    failure: '固定一個 reference phase 或強制 $\\sum a_i=0$ 才能讓解唯一；LMS 只會把 null 分量凍結在初值。',
    dynamics: '\\mathbf R_x\\mathbf n=\\mathbf 0\\;\\Rightarrow\\;\\hat{\\mathbf n}^{T}\\boldsymbol\\delta_{k+1}=\\hat{\\mathbf n}^{T}\\boldsymbol\\delta_k',
    questions: ['where'],
  },
  {
    index: 12,
    condition: '兩個 GMAC 對角斜率正確，但 off-diagonal 耦合',
    lesson: '造成發散',
    pages: ['/ch/10'],
    experiments: ['mimo-lms'],
    tests: ['T18'],
    errata: ['E24'],
    claim: 'exact',
    keyFormula: '\\mathbf A=\\mathbf I+\\mathbf M\\mathbf J,\\qquad \\rho(\\mathbf A)<1',
    hardware: '兩個校正迴路（例如 gain 與 offset）各自單獨調都穩定，一起開就互相推。',
    failure: '縮小 $\\mu$ 無效：共模 pole $=1+\\mu>1$；要用 $-\\gamma\\mathbf J^{-1}$ 或 regularized preconditioner。',
    dynamics: '\\boldsymbol\\delta_{k+1}=(\\mathbf I+\\mathbf M\\mathbf J)\\,\\boldsymbol\\delta_k',
    questions: ['converge'],
  },
]

/* ───────────────────────── 實驗名稱與模型層級 ───────────────────────── */

export interface ExperimentMeta {
  /** 簡短名稱（不含公式；公式在 preview 內以 KaTeX 顯示） */
  name: string
  /** 可能的模型層級（動態者列出全部） */
  levels: ModelLevelId[]
}

/**
 * 每個 ExperimentShell id 的名稱與 level（與各頁 ExperimentShell 的 level prop 一致；data.test.ts 以原始碼掃描驗證）。
 * 未登錄的 experiment（其他 agent 之後新增）在 UI 顯示「未登錄」，不猜測層級。
 */
export const EXPERIMENT_META: Record<string, ExperimentMeta> = {
  'intro-playground': { name: '入門 LMS Playground', levels: ['L0'] },
  'intro-noise-average': { name: '雜訊平均小型 Monte Carlo', levels: ['L0'] },
  'lms-playground': { name: 'LMS Playground', levels: ['L0'] },
  'mse-vs-mae': { name: 'MSE vs MAE vs Huber', levels: ['L0'] },
  'sign-lms-compare': { name: 'Sign-LMS 比較實驗', levels: ['L0'] },
  'sign-lms-fixed-points': { name: 'Sign-LMS 固定點探索', levels: ['L0'] },
  'sign-lms-band': { name: 'Sign-Error 跳動帶與遞減步長', levels: ['L0'] },
  'stability-lab': { name: 'Stability Lab（Mean / Mean-Square / Almost-Sure）', levels: ['L0'] },
  'stability-fixed-x': { name: 'Fixed-x Pole Explorer', levels: ['L0'] },
  'stability-heavytail': { name: 'Heavy-tail 示範', levels: ['L0'] },
  'gmac-signal-flow': { name: 'GMAC 訊號流', levels: ['L1', 'L2'] },
  'gmac-fixed-point': { name: '定點 GMAC', levels: ['L5'] },
  'gmac-bit-encoding': { name: '0/1 位元未映射（反面教材）', levels: ['L1'] },
  'gmac-residue': { name: 'DSM residue 與 DTC 殘差（telescoping）', levels: ['L2'] },
  'comparator-lab': { name: 'Comparator Lab', levels: ['L1'] },
  'comparator-dither': { name: 'Comparator Dither 實驗', levels: ['L1'] },
  'polarity-explorer': { name: 'Polarity Explorer', levels: ['L2'] },
  'polarity-ct-dt': { name: 'CT 原型 vs DT 迴路', levels: ['L2'] },
  'polarity-fcw-sweep': { name: '近整數 FCW 掃描', levels: ['L2'] },
  'delay-fx-lab': { name: 'Delay / Filtered-x Lab', levels: ['L2'] },
  'pm-lab': { name: 'Phase Margin Lab', levels: ['L1'] },
  'dual-loop': { name: 'Dual-Loop Explorer', levels: ['L2'] },
  'pe-eigen-lab': { name: 'PE / Eigen Lab', levels: ['L3'] },
  'gauge-one-hot': { name: '四相 One-Hot Gauge Lab', levels: ['L3'] },
  'mimo-lms': { name: 'MIMO LMS Lab', levels: ['L3'] },
  'bias-inl-lab': { name: 'Bias & INL Lab', levels: ['L1', 'L2'] },
  'lms-noise-lab': { name: 'LMS Noise Lab', levels: ['L1'] },
  'code-mixing-lab': { name: 'Code Mixing Lab', levels: ['L4'] },
  'code-spectra-lab': { name: 'Code Spectra Lab', levels: ['L4'] },
  'quantized-gain-lab': { name: 'Quantized Gain Lab', levels: ['L5'] },
  'cal-state-machine': { name: 'Calibration State Machine', levels: ['L1', 'L5'] },
  'corner-interval': { name: 'Corner-Based learning-rate 區間', levels: ['L1'] },
  'lr-optimizer': { name: 'Learning-Rate Optimizer', levels: ['L1'] },
  'block-lms-json': { name: 'Block Sign-LMS JSON Lab', levels: ['L1', 'L2', 'L5'] },
  'fft-spur-pitfalls': { name: 'FFT Spur 量測陷阱', levels: ['L4'] },
  'gmac-datapath-sizing': { name: 'GMAC datapath 計算器', levels: ['L5'] },
  'sspll-hpd': { name: 'SSPLL：error path 反號帶', levels: ['L2'] },
  'sspll-signmap': { name: 'SSPLL：GOS / PHOS sign map', levels: ['L2'] },
  'sspll-closed-loop': { name: 'SSPLL：閉迴路 sign-error block LMS', levels: ['L3'] },
  // Calibration Lab（/lab）：五個分頁各自是一個 ExperimentShell
  'unified-lab': { name: 'Unified Lab：Pipeline（完整 trace 與報告）', levels: ['L4', 'L5'] },
  'unified-lab-fcw': { name: 'Unified Lab：FCW sweep', levels: ['L2'] },
  'unified-lab-mc': { name: 'Unified Lab：Monte Carlo', levels: ['L2', 'L5'] },
  'unified-lab-compare': { name: 'Unified Lab：Compare A / B / C', levels: ['L4', 'L5'] },
  'training-sequence-lab': { name: 'Training Sequence Lab', levels: ['L3'] },
}

export function experimentName(id: string): string {
  return EXPERIMENT_META[id]?.name ?? id
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * 這個 preset 載入後 ExperimentShell 會顯示的模型層級。
 * 層級隨參數改變的實驗，依各實驗原始碼的同一條規則判斷；判斷不了時回傳全部可能值並標 dynamic。
 */
export function levelsOf(p: PresetEntry): { levels: ModelLevelId[]; dynamic: boolean; known: boolean } {
  const meta = EXPERIMENT_META[p.experiment]
  if (!meta) return { levels: [], dynamic: false, known: false }
  const prm = p.params
  switch (p.experiment) {
    case 'gmac-signal-flow': {
      // SignalFlowExperiment：level = runBlockLms 的 modelLevel——非 identity path 或 DSM code ⇒ 'L2'，否則 'L1'
      const dsm = prm.pattern === 'dsm_first_order' || prm.pattern === 'mash111'
      return { levels: [dsm || prm.path === 'first_order_hp' ? 'L2' : 'L1'], dynamic: false, known: true }
    }
    case 'bias-inl-lab': {
      // BiasInlLab：dcMode === 'none' ? 'L1' : 'L2'（預設 dcMode = 'none'）
      const dc = typeof prm.dcMode === 'string' ? prm.dcMode : 'none'
      return { levels: [dc === 'none' ? 'L1' : 'L2'], dynamic: false, known: true }
    }
    case 'cal-state-machine': {
      // CalStateMachine：registerLsb > 0 ? 'L5' : 'L1'（預設 0 = 理想浮點）
      const lsb = typeof prm.registerLsb === 'number' ? prm.registerLsb : 0
      return { levels: [lsb > 0 ? 'L5' : 'L1'], dynamic: false, known: true }
    }
    case 'unified-lab':
      // PipelineTab：level = 模擬結果的 modelLevel = quantize ? 'L5' : 'L4'（unifiedLab.ts；預設 quantize = false）
      return { levels: [prm.quantize === true ? 'L5' : 'L4'], dynamic: false, known: true }
    case 'unified-lab-mc': {
      // MonteCarloTab：params.quantize ? 'L5' : 'L2'；preset 的共用參數放在 params.base
      const base = isObj(prm.base) ? prm.base : prm
      return { levels: [base.quantize === true ? 'L5' : 'L2'], dynamic: false, known: true }
    }
    case 'unified-lab-compare': {
      // CompareTab：任何一個 case 開了定點暫存器 ⇒ 'L5'，否則 'L4'；case 沒寫 quantize 時沿用 base
      const base = isObj(prm.base) ? prm.base : {}
      const cases = Array.isArray(prm.cases) ? prm.cases.filter(isObj) : []
      const anyQ = cases.length ? cases.some((c) => (typeof c.quantize === 'boolean' ? c.quantize : base.quantize === true)) : base.quantize === true
      return { levels: [anyQ ? 'L5' : 'L4'], dynamic: false, known: true }
    }
    case 'block-lms-json': {
      const cfg = isObj(prm.config) ? prm.config : null
      const gr = cfg && isObj(cfg.gain_register) ? cfg.gain_register : null
      if (gr && gr.quantize_physical === true) return { levels: ['L5'], dynamic: false, known: true }
      return { levels: meta.levels, dynamic: true, known: true }
    }
    default:
      return { levels: meta.levels, dynamic: meta.levels.length > 1, known: true }
  }
}

/* ───────────────────────── 頁面 ───────────────────────── */

/** 頁面路徑 → 原始碼資料夾（相對專案根目錄；給原始碼掃描測試用） */
export function pageFolder(page: string, pageId?: string): string | null {
  const m = /^\/ch\/(\d{2})$/.exec(page)
  if (m) return `src/chapters/ch${m[1]}`
  if (page === '/') return 'src/pages/dashboard'
  if (pageId) return `src/pages/${pageId}`
  return null
}

/** 由頁面路徑排序：依 registry 順序（不在 registry 的排最後） */
export function pageOrder(page: string, pagePaths: string[]): number {
  const i = pagePaths.indexOf(page)
  return i < 0 ? 999 : i
}

/* ───────────────────────── §19.2 稽核 ───────────────────────── */

export type SlotStatus = 'ok' | 'missing' | 'duplicate' | 'page-unregistered' | 'page-mismatch' | 'experiment-mismatch' | 'tests-missing'

export const SLOT_STATUS_LABEL: Record<SlotStatus, string> = {
  ok: '存在、連結正確',
  missing: '缺少（尚未建立 preset）',
  duplicate: '重複（同一編號有多個 preset）',
  'page-unregistered': '頁面路徑不在網站目錄中',
  'page-mismatch': '頁面與規格不符',
  'experiment-mismatch': '實驗 id 與規格不符',
  'tests-missing': '缺少規格要求的 T-id',
}

export interface SlotAudit {
  slot: GallerySlot
  /** 這個編號下找到的所有 preset */
  found: PresetEntry[]
  /** 唯一的 preset（missing / duplicate 時為 undefined） */
  preset?: PresetEntry
  status: SlotStatus
  /** 可讀的問題清單（ok 時為空） */
  issues: string[]
}

/**
 * 檢查 12 個槽位：存在、唯一、頁面在 registry 中、頁面與 experiment 與規格一致、T-id 齊全。
 * 只做「資料層」檢查；`useUrlPreset` 是否真的接上由 data.test.ts 以原始碼掃描驗證。
 */
export function auditSlots(presets: PresetEntry[], pagePaths: string[], slots: GallerySlot[] = GALLERY_SLOTS): SlotAudit[] {
  return slots.map((slot) => {
    const found = presets.filter((p) => p.galleryIndex === slot.index)
    if (found.length === 0) return { slot, found, status: 'missing', issues: [`規格 §19.2 #${slot.index} 沒有任何 galleryIndex = ${slot.index} 的 preset。`] }
    if (found.length > 1)
      return { slot, found, status: 'duplicate', issues: [`galleryIndex = ${slot.index} 有 ${found.length} 個 preset：${found.map((p) => p.id).join('、')}。`] }
    const preset = found[0]
    const issues: string[] = []
    let status: SlotStatus = 'ok'
    if (!pagePaths.includes(preset.page)) {
      status = 'page-unregistered'
      issues.push(`頁面 ${preset.page} 不在 src/app/registry.ts，連結會落到「找不到此頁面」。`)
    } else if (!slot.pages.includes(preset.page)) {
      status = 'page-mismatch'
      issues.push(`頁面 ${preset.page} 不是規格對應的 ${slot.pages.join(' 或 ')}。`)
    } else if (!slot.experiments.includes(preset.experiment)) {
      status = 'experiment-mismatch'
      issues.push(`實驗 ${preset.experiment} 不是 ${slot.experiments.join(' 或 ')}。`)
    } else {
      const missingT = slot.tests.filter((t) => !(preset.tests ?? []).includes(t))
      if (missingT.length) {
        status = 'tests-missing'
        issues.push(`preset.tests 缺少 ${missingT.join('、')}。`)
      }
    }
    return { slot, found, preset, status, issues }
  })
}

/** galleryIndex 不在 1–12 的 preset（資料錯誤） */
export function invalidGalleryIndices(presets: PresetEntry[]): PresetEntry[] {
  return presets.filter((p) => p.galleryIndex !== undefined && !(Number.isInteger(p.galleryIndex) && p.galleryIndex >= 1 && p.galleryIndex <= 12))
}

/* ───────────────────────── 勘誤標記 ───────────────────────── */

export interface ErratumInfo {
  eid: string
  area: string
  severity: string
  slug: string
}

const ERRATA: Record<string, ErratumInfo> = Object.fromEntries(
  ((errataData as { errata?: { eid: string; area: string; severity: string; id: string }[] }).errata ?? []).map((e) => [
    e.eid,
    { eid: e.eid, area: e.area, severity: e.severity, slug: e.id },
  ]),
)

export function erratumInfo(eid: string): ErratumInfo | undefined {
  return ERRATA[eid]
}

/** 文字中提到的勘誤編號（E01–E49，依出現順序去重；只回傳 errata.json 裡存在的） */
export function errataIn(...texts: string[]): string[] {
  const out: string[] = []
  for (const t of texts) {
    for (const m of t.matchAll(/(?<![A-Za-z0-9])E(\d{2})(?!\d)/g)) {
      const id = `E${m[1]}`
      if (ERRATA[id] && !out.includes(id)) out.push(id)
    }
  }
  return out
}

/* ───────────────────────── 篩選 ───────────────────────── */

export interface PresetFilters {
  /** 頁面路徑（'' = 全部） */
  page: string
  /** 模型層級（'' = 全部） */
  level: string
  /** T-id（'' = 全部；'none' = 沒有 T-id） */
  test: string
  /** 來源（'' = 全部） */
  source: string
  /** 關鍵字（id、標題、說明、預期文字） */
  q: string
  /** 只顯示 §19.2 的 12 個 */
  galleryOnly: boolean
  /** 只顯示可即時預覽的 */
  previewOnly: boolean
}

export const EMPTY_FILTERS: PresetFilters = { page: '', level: '', test: '', source: '', q: '', galleryOnly: false, previewOnly: false }

export function filterPresets(presets: PresetEntry[], f: PresetFilters, previewable: ReadonlySet<string>): PresetEntry[] {
  const q = f.q.trim().toLowerCase()
  return presets.filter((p) => {
    if (f.page && p.page !== f.page) return false
    if (f.level && !levelsOf(p).levels.includes(f.level as ModelLevelId)) return false
    if (f.test === 'none' && (p.tests ?? []).length > 0) return false
    if (f.test && f.test !== 'none' && !(p.tests ?? []).includes(f.test)) return false
    if (f.source && p.source !== (f.source as SourceKind)) return false
    if (f.galleryOnly && p.galleryIndex === undefined) return false
    if (f.previewOnly && !previewable.has(p.experiment)) return false
    if (q) {
      const hay = `${p.id}\n${p.title}\n${p.description}\n${p.expected}\n${p.experiment}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** 是否有任何篩選條件 */
export function hasActiveFilter(f: PresetFilters): boolean {
  return !!(f.page || f.level || f.test || f.source || f.q.trim() || f.galleryOnly || f.previewOnly)
}

/* ───────────────────────── 覆蓋率 ───────────────────────── */

export interface TestCoverageRow {
  id: TId
  /** 帶這個 T-id 的 preset 數 */
  presets: number
  /** 其中屬於 §19.2 的 12 個 */
  gallery: number
  /** 出現在哪些頁面 */
  pages: string[]
}

export function testCoverage(presets: PresetEntry[]): TestCoverageRow[] {
  return T_IDS.map((id) => {
    const ps = presets.filter((p) => (p.tests ?? []).includes(id))
    return {
      id,
      presets: ps.length,
      gallery: ps.filter((p) => p.galleryIndex !== undefined).length,
      pages: [...new Set(ps.map((p) => p.page))],
    }
  })
}

/** 依某個 key 計數（保持第一次出現的順序） */
export function countBy<T>(items: T[], key: (t: T) => string | string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const it of items) {
    const k = key(it)
    for (const kk of Array.isArray(k) ? k : [k]) m.set(kk, (m.get(kk) ?? 0) + 1)
  }
  return m
}

/* ───────────────────────── 預覽支援（清單；實作在 previews.ts） ───────────────────────── */

/**
 * 有「即時預覽」的 experiment id。previews.ts 的 PREVIEWERS 必須與此清單完全一致（previews.test.ts 驗證）；
 * 放在這裡是為了讓頁面不必先載入 previews.ts（及其模型模組）就能決定要不要顯示預覽按鈕。
 */
export const PREVIEWABLE_EXPERIMENTS: readonly string[] = [
  'lms-playground',
  'intro-playground',
  'stability-fixed-x',
  'comparator-lab',
  'polarity-explorer',
  'delay-fx-lab',
  'pm-lab',
  'dual-loop',
  'pe-eigen-lab',
  'gauge-one-hot',
  'mimo-lms',
  'bias-inl-lab',
  'lms-noise-lab',
  'code-mixing-lab',
  'quantized-gain-lab',
]

/**
 * §19.2 的 12 個 preset：其「預期結果」文字必須寫出的關鍵量（previews 的 metric key）。
 * Gallery 以真實模型函式重算這些量，再到預期文字中找相符的數字；找不到就標 mismatch
 * （也就是規格 §17 末段的反面情境「模型公式有錯，UI 卻顯示成功」會被抓出來）。
 */
export const GALLERY_EXPECTED_KEYS: Record<string, string[]> = {
  'lms-playground-hand': ['w1', 'w2', 'pole'],
  'comparator-1fs-100fs': ['pPlus', 'Kq', 'meanSum', 'pCorrect', 'n95Odd'],
  'polarity-phase120': ['C', 'pole', 'driftSampled'],
  'delay-phi-m120-d4': ['C:A', 'C:B', 'pole:A', 'pole:B'],
  'dual-loop-gallery-5': ['poleIm', 'rho', 'muFullHi'],
  'pe-rho-099': ['lamMax', 'lamMin', 'kappa', 'pSlow', 'k95Slow', 'k95SlowReal'],
  'bias-inl-gallery7': ['Ex4', 'wMse', 'wStar'],
  'noise-t13-example': ['p', 'fu', 'f3dbExact', 'f3dbNegLnP', 'f3dbOneMinusP', 'enbw', 'sigmaW'],
  'mixing-t15-spur': ['tone:90', 'tone:110', 'beta', 'dbcSmall', 'dbcBessel'],
  'quant-gallery-10-five-strategies': ['dc:freeze', 'power:freeze', 'line1:toggle', 'line2:toggle', 'power:toggle'],
  'gauge-one-hot': ['eigRxA0', 'eigRxA1'],
  'mimo-gallery12-offdiag-diverge': ['eigA0', 'eigA1', 'singlePole'],
}
