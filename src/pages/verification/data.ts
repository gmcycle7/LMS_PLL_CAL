/**
 * 驗證頁的「描述性」資料：每個 T-id 的輸入條件、規格期望、勘誤後期望（TeX 字串，取自規格 §17 與 docs/validation.md），
 * 以及反面測試清單與其測試位置。所有「數值結果」都不在這裡——它們由 acceptance.ts 即時計算或來自 golden JSON。
 * 說明文字（title / correctedNote / failure / lesson）可含 `$…$` 行內 TeX，頁面以 mathText() 顯示成 KaTeX。
 * data.test.ts 會檢查：勘誤 id 都存在、TS / Python 測試名稱真的存在於對應檔案、headline key 都在 golden 裡。
 */
import type { ClaimKind, ModelLevelId } from '@/data/types'
import { MUTANTS, type AcceptanceId } from '@/simulation/models/acceptance'

export interface HeadlineKey {
  key: string
  /** key 為陣列時取第幾個元素 */
  index?: number
  /** TeX 標籤 */
  tex: string
  /** TeX 單位（可省略） */
  unit?: string
  digits?: number
}

export interface AcceptanceRowMeta {
  id: AcceptanceId
  specSection: string
  /** 標題（可含 `$…$`） */
  title: string
  /** 輸入條件（TeX） */
  inputTex: string
  /** 規格 §17 原本的期望值（TeX） */
  specTex: string
  /** 勘誤後的期望（TeX）；null = 與規格相同 */
  correctedTex: string | null
  /** 勘誤後的補充說明（可含 `$…$`） */
  correctedNote?: string
  errata: string[]
  chapters: { path: string; label: string }[]
  claim: ClaimKind
  level: ModelLevelId
  headline: HeadlineKey[]
}

const ch = (n: string, label: string) => ({ path: `/ch/${n}`, label })

export const ACCEPTANCE_ROWS: AcceptanceRowMeta[] = [
  {
    id: 'T01',
    specSection: '§1.2',
    title: '手算 LMS 兩步',
    inputTex: String.raw`a=3,\ w_0=1,\ x=2,\ \mu=0.1`,
    specTex: String.raw`w_1=1.8,\ w_2=2.28`,
    correctedTex: String.raw`\delta_n=a-w_n:\ \delta_0,\delta_1,\delta_2=+2,\,+1.2,\,+0.72`,
    correctedNote: String.raw`數值不變；$\delta$ 的極性統一為 $a-w$（規格 §3 寫 $w-a$）。`,
    errata: ['E32', 'E39'],
    chapters: [ch('00', 'Ch00'), ch('01', 'Ch01')],
    claim: 'exact',
    level: 'L0',
    headline: [
      { key: 'w1', tex: 'w_1' },
      { key: 'w2', tex: 'w_2' },
    ],
  },
  {
    id: 'T02',
    specSection: '§3',
    title: String.raw`固定 $x$ 的穩定區間`,
    inputTex: String.raw`x=2\ (\text{固定})`,
    specTex: String.raw`0<\mu<0.5`,
    correctedTex: String.raw`0<\mu<\tfrac{2}{x^2}=0.5;\ \mu=0.5\Rightarrow p=-1\ (\text{臨界})`,
    correctedNote: String.raw`數值不變；$\mu=0.5$ 的 $|p|=1$ 是邊界（持續振盪），不可標成穩定。`,
    errata: [],
    chapters: [ch('03', 'Ch03'), ch('01', 'Ch01')],
    claim: 'exact',
    level: 'L0',
    headline: [
      { key: 'mu_max', tex: String.raw`\mu_{\max}` },
      { key: 'mu_one_step', tex: String.raw`\mu_{p=0}` },
    ],
  },
  {
    id: 'T03',
    specSection: '§3.1',
    title: 'Mean 與 Mean-Square 界限',
    inputTex: String.raw`x\sim\mathcal N(0,1):\ E[x^2]=1,\ E[x^4]=3`,
    specTex: String.raw`\mu_{\rm MS}<\tfrac23,\ \mu_{\rm mean}<2\ (\text{依獨立模型})`,
    correctedTex: String.raw`\text{iid 純量 }x\text{ 下為精確式（不是近似）；另有 a.s. 界 }\mu_{\rm as}\approx2.4212`,
    correctedNote: String.raw`要用封閉式 $g(\mu)$ 或單步 MC 驗證，不可用長時間 $\delta_n^2$ 平均（heavy tail）。`,
    errata: ['E14', 'E38', 'E42'],
    chapters: [ch('03', 'Ch03')],
    claim: 'exact',
    level: 'L0',
    headline: [
      { key: 'mu_mean_max', tex: String.raw`\mu_{\rm mean}` },
      { key: 'mu_ms_max', tex: String.raw`\mu_{\rm MS}` },
    ],
  },
  {
    id: 'T04',
    specSection: '§5、§5.1',
    title: String.raw`1-bit comparator 的 $P(+1)$ 與 $K_q$`,
    inputTex: String.raw`s=1\,\mathrm{fs},\ \sigma_v=100\,\mathrm{fs}`,
    specTex: String.raw`P(q{=}{+}1)\approx0.503989,\ K_q\approx0.00797885\,\mathrm{fs^{-1}}`,
    correctedTex: String.raw`E[q]=\operatorname{erf}\!\big(\tfrac{s}{\sqrt2\sigma_v}\big)\ne K_qs\ \ (\text{相對差 }\tfrac{(s/\sigma_v)^2}{6})`,
    correctedNote: String.raw`數值不變；$E[q]$ 與線性化 $K_qs$ 不完全相同（golden README §6）。`,
    errata: [],
    chapters: [ch('05', 'Ch05')],
    claim: 'exact',
    level: 'L1',
    headline: [
      { key: 'p_plus', tex: String.raw`P(+1)`, digits: 7 },
      { key: 'kq_per_fs', tex: 'K_q', unit: String.raw`\mathrm{fs^{-1}}`, digits: 7 },
    ],
  },
  {
    id: 'T05',
    specSection: '§5',
    title: '方向判斷 95%',
    inputTex: String.raw`\text{同 T04},\ N\approx42500`,
    specTex: String.raw`P(\text{方向正確})\approx95\%\ (\text{iid/CLT})`,
    correctedTex: String.raw`\text{須指定 tie rule：奇數 }N\ge42499;\ \text{偶數 strict }N\ge42750`,
    correctedNote: String.raw`$N=42500$ 時 CLT $0.950005$、tie 平分 $0.950002$、strict 只有 $0.949501$。`,
    errata: ['E02', 'E07', 'E18'],
    chapters: [ch('05', 'Ch05')],
    claim: 'exact',
    level: 'L1',
    headline: [
      { key: 'p_clt_list', index: 3, tex: String.raw`P_{\rm CLT}(42500)`, digits: 7 },
      { key: 'p_exact_strict_list', index: 3, tex: String.raw`P_{\rm strict}(42500)`, digits: 7 },
      { key: 'N_exact_odd_95', tex: String.raw`N^{\rm odd}_{95}`, digits: 6 },
    ],
  },
  {
    id: 'T06',
    specSection: '§6、§6.1',
    title: String.raw`單頻 $\phi=120^\circ$ 的極性`,
    inputTex: String.raw`x=A\cos\Omega n,\ \phi=120^\circ,\ \Omega=\tfrac{\pi}{6},\ \mu=10\,\mathrm{fs}`,
    specTex: String.raw`C<0;\ \text{正步長平均發散}`,
    correctedTex: String.raw`C=\tfrac{A^2}{2}|H|\cos\phi\ (0<\Omega<\pi);\ \Omega=0,\pi\ \text{時 2 倍}`,
    correctedNote: String.raw`§6.1 的 CT $H_{\rm PD}(s)$ 只在 $\omega_nT_s\ll1$ 時代表 DT 迴路。`,
    errata: ['E46', 'E44'],
    chapters: [ch('06', 'Ch06')],
    claim: 'exact',
    level: 'L2',
    headline: [
      { key: 'C', tex: 'C' },
      { key: 'pole', tex: 'p', digits: 7 },
    ],
  },
  {
    id: 'T07',
    specSection: '§7、§8.1',
    title: String.raw`Delay alignment $D=4$`,
    inputTex: String.raw`\phi=-120^\circ,\ \Omega=\tfrac{\pi}{6},\ D=4`,
    specTex: String.raw`\text{殘餘相位 }0^\circ,\ C_D\ \text{正最大}`,
    correctedTex: String.raw`\theta=\phi+\Omega D\ (\text{延遲 code});\ \text{延遲 error 時為 }\phi-\Omega D`,
    correctedNote: String.raw`$\operatorname{wrap}_{180}$ 必須以 $360^\circ$ 為週期映射到 $[-180^\circ,180^\circ)$，不可寫成 $\theta\bmod180^\circ$。`,
    errata: ['E46', 'E20'],
    chapters: [ch('07', 'Ch07')],
    claim: 'exact',
    level: 'L2',
    headline: [
      { key: 'theta_deg', tex: String.raw`\theta`, unit: String.raw`^\circ` },
      { key: 'C_D', tex: 'C_4' },
    ],
  },
  {
    id: 'T08',
    specSection: '§8.2',
    title: '一階 calibration loop 的 PM',
    inputTex: String.raw`L(z)=\tfrac{g}{z-1},\ g=1,\ d=0`,
    specTex: String.raw`\text{pole }0,\ \text{PM }60^\circ`,
    correctedTex: String.raw`g=\mu K\ \text{為正規化增益};\ \mathrm{PM}_d=90^\circ-(2d+1)\arcsin\tfrac g2`,
    errata: ['E13'],
    chapters: [ch('08', 'Ch08')],
    claim: 'exact',
    level: 'L1',
    headline: [
      { key: 'pole', tex: 'p' },
      { key: 'pm_deg', tex: String.raw`\mathrm{PM}`, unit: String.raw`^\circ` },
    ],
  },
  {
    id: 'T09',
    specSection: '§8.4',
    title: '雙迴路（主 PLL × LMS）',
    inputTex: String.raw`r=0.8,\ b=0.2,\ c=1,\ \mu=1.2`,
    specTex: String.raw`|z|\approx1.01980>1`,
    correctedTex: String.raw`\text{完整 }0<\mu<\tfrac{1-r}{bc}=1;\ \text{簡化 }0<\mu<2`,
    correctedNote: String.raw`$\tfrac12$ 倍來自觀測路徑的 1-block 延遲（與 $r$ 無關）；§8.4 的 $\mathbf C$、$\mathbf D$ 是 state-space 矩陣，不是相關 $C$ 與 code delay $D$。`,
    errata: ['E19', 'E31', 'E13'],
    chapters: [ch('08', 'Ch08')],
    claim: 'exact',
    level: 'L2',
    headline: [
      { key: 'pole_abs', tex: '|z|', digits: 7 },
      { key: 'mu_max_full', tex: String.raw`\mu_{\max}^{\rm full}` },
    ],
  },
  {
    id: 'T10',
    specSection: '§9',
    title: String.raw`$\mathbf R(\rho=0.99)$ 的 eigenvalues`,
    inputTex: String.raw`\mathbf R=\begin{bmatrix}1&.99\\.99&1\end{bmatrix}`,
    specTex: String.raw`\lambda=1.99,\ 0.01;\ \kappa=199`,
    correctedTex: null,
    errata: [],
    chapters: [ch('09', 'Ch09'), ch('10', 'Ch10')],
    claim: 'exact',
    level: 'L3',
    headline: [
      { key: 'eig_min', tex: String.raw`\lambda_{\min}` },
      { key: 'cond', tex: String.raw`\kappa` },
    ],
  },
  {
    id: 'T11',
    specSection: '§9、§10.1',
    title: '慢模式 pole 與 598 blocks',
    inputTex: String.raw`\mu K_q=0.5,\ \lambda_{\min}=0.01`,
    specTex: String.raw`p_{\rm slow}=0.995,\ \approx598\ \text{blocks}`,
    correctedTex: String.raw`K_q\equiv1\ \text{正規化才成立；物理 }K_q:\ p=0.99996011`,
    correctedNote: String.raw`物理 $K_q=0.00798\,\mathrm{fs^{-1}}$、$\mu=0.5\,\mathrm{fs}$ 時要 75,091 blocks；$N=1$ 的 Gaussian regressor 均方發散。`,
    errata: ['E05', 'E08', 'E23', 'E21'],
    chapters: [ch('09', 'Ch09'), ch('10', 'Ch10')],
    claim: 'exact',
    level: 'L3',
    headline: [
      { key: 'slow_pole', tex: String.raw`p_{\rm slow}` },
      { key: 'blocks_95', tex: String.raw`k_{95}` },
    ],
  },
  {
    id: 'T12',
    specSection: '§11.2',
    title: '三階 DTC INL 的最佳 gain',
    inputTex: String.raw`x\in\{-2,\ldots,2\},\ a=1,\ c_3=0.1`,
    specTex: String.raw`w^*=1.34`,
    correctedTex: String.raw`\text{MSE-LMS }1.34;\ \text{Sign-LMS }\sigma_v{=}1\to1.340346,\ \sigma_v{=}0\to1.4`,
    correctedNote: String.raw`$1.34$ 只對 MSE-LMS 精確；code 分布必須寫明（$\pm1$ code 時 $1.10$，Gaussian $1.30$）。`,
    errata: ['E01', 'E11', 'E12'],
    chapters: [ch('11', 'Ch11')],
    claim: 'exact',
    level: 'L1',
    headline: [{ key: 'w_star', tex: 'w^*' }],
  },
  {
    id: 'T13',
    specSection: '§12.1',
    title: String.raw`係數雜訊 $\sigma_w$`,
    inputTex: String.raw`\sigma_v=100\,\mathrm{fs},\ N=4096,\ \mu=10\,\mathrm{fs}`,
    specTex: String.raw`p\approx0.92021,\ \sigma_w\approx0.399\,\mathrm{fs}`,
    correctedTex: String.raw`\text{前提：unit-RMS code、}C{=}1\text{、average GMAC、}\sigma_\eta^2\approx\tfrac1N`,
    correctedNote: String.raw`$0.399\,\mathrm{fs}$ 是 gain-equivalent noise，不是 output jitter。`,
    errata: ['E30', 'E13'],
    chapters: [ch('12', 'Ch12')],
    claim: 'exact',
    level: 'L1',
    headline: [
      { key: 'p', tex: 'p', digits: 7 },
      { key: 'sigma_w_fs', tex: String.raw`\sigma_w`, unit: String.raw`\mathrm{fs}` },
    ],
  },
  {
    id: 'T14',
    specSection: '§12',
    title: 'Update rate 與 calibration 頻寬',
    inputTex: String.raw`f_s=4\,\mathrm{GHz},\ N=4096`,
    specTex: String.raw`f_u=976.5625\,\mathrm{kHz},\ \text{Noise BW}\approx12.9\,\mathrm{kHz}`,
    correctedTex: String.raw`f_{3\rm dB}=12.931\,\mathrm{kHz},\ \mathrm{ENBW}=20.289\,\mathrm{kHz}`,
    correctedNote: String.raw`$12.9\,\mathrm{kHz}$ 是 $-3\,\mathrm{dB}$ corner，不是 Noise BW；$(1-p)$ 近似只有 $12.40\,\mathrm{kHz}$。`,
    errata: ['E06', 'E10', 'E26', 'E27'],
    chapters: [ch('12', 'Ch12')],
    claim: 'exact',
    level: 'L1',
    headline: [
      { key: 'bw_exact_3db_hz', tex: String.raw`f_{3\rm dB}`, unit: String.raw`\mathrm{Hz}`, digits: 7 },
      { key: 'enbw_one_sided_hz', tex: String.raw`\mathrm{ENBW}`, unit: String.raw`\mathrm{Hz}`, digits: 7 },
    ],
  },
  {
    id: 'T15',
    specSection: '§12.2、§12.4',
    title: '0.5 fs timing tone 的 spur',
    inputTex: String.raw`f_{\rm out}=13\,\mathrm{GHz},\ A_t=0.5\,\mathrm{fs},\ |T|=1`,
    specTex: String.raw`\approx-93.8\,\mathrm{dBc}`,
    correctedTex: null,
    correctedNote: String.raw`小角近似 $20\log_{10}(\beta/2)$ 與 Bessel 精確值差 $<10^{-8}\,\mathrm{dB}$；$\delta w$ 以 ZOH 保持時另有 sinc 權重。`,
    errata: ['E09'],
    chapters: [ch('12', 'Ch12')],
    claim: 'approx', // 小角 PM 近似（另以 Bessel 精確值交叉比對）、單一 tone、|T| = 1
    level: 'L4',
    headline: [{ key: 'spur_dbc', tex: String.raw`\mathcal L_{\rm spur}`, unit: String.raw`\mathrm{dBc}`, digits: 6 }],
  },
  {
    id: 'T16',
    specSection: '§13.1–§13.4',
    title: '6-bit toggle 32 / 33',
    inputTex: String.raw`\text{目標 }32.4\,\mathrm{LSB},\ [32,32,33,32,33]`,
    specTex: String.raw`\bar y=32.4,\ \text{週期 }5`,
    correctedTex: String.raw`\text{一階 EFB 對常數 32.4 也是週期 5（與 toggle 只差相位）}`,
    correctedNote: String.raw`譜線功率：$f_u/5$ 為 $0.03056$、$2f_u/5$ 為 $0.20944\,\mathrm{LSB^2}$；freeze 的 $\delta=a-w=+0.4\,\mathrm{LSB}$。`,
    errata: ['E15', 'E47', 'E49', 'E36'],
    chapters: [ch('13', 'Ch13')],
    claim: 'exact',
    level: 'L5',
    headline: [
      { key: 'mean', tex: String.raw`\bar y`, unit: String.raw`\mathrm{LSB}` },
      { key: 'period', tex: 'P' },
    ],
  },
  {
    id: 'T17',
    specSection: '§13.3',
    title: 'Stochastic rounding',
    inputTex: String.raw`32/33,\ P(33)=0.4`,
    specTex: String.raw`\bar y=32.4,\ \mathrm{Var}=0.24\,\mathrm{LSB^2}`,
    correctedTex: null,
    errata: [],
    chapters: [ch('13', 'Ch13')],
    claim: 'exact',
    level: 'L5',
    headline: [
      { key: 'mean', tex: String.raw`\bar y`, unit: String.raw`\mathrm{LSB}` },
      { key: 'variance', tex: String.raw`\mathrm{Var}`, unit: String.raw`\mathrm{LSB^2}` },
    ],
  },
  {
    id: 'T18',
    specSection: '§10.2',
    title: 'Jacobian 反例：一起更新發散',
    inputTex: String.raw`\mathbf J=\begin{bmatrix}-1&2\\2&-1\end{bmatrix},\ \mathbf M=0.2\mathbf I`,
    specTex: String.raw`\operatorname{eig}(\mathbf I+\mathbf M\mathbf J)=1.2,\ 0.4;\ \text{發散模式}`,
    correctedTex: String.raw`\text{poles 一律由 }\operatorname{eig}\big(\mathbf I+\mathbf M(\hat{\mathbf J})\mathbf J\big)\text{ 計算}`,
    correctedNote: String.raw`regularized 的 $p_i=1-\gamma\sigma_i^2/(\sigma_i^2+\lambda_{\rm reg})$ 只在 $\hat{\mathbf J}=\mathbf J$ 時成立；$\lambda_{\rm reg}$ 是 regularization，不是 eigenvalue。`,
    errata: ['E24', 'E22'],
    chapters: [ch('10', 'Ch10')],
    claim: 'exact',
    level: 'L3',
    headline: [
      { key: 'eig_A_desc', index: 0, tex: String.raw`\lambda_1(\mathbf A)` },
      { key: 'eig_A_desc', index: 1, tex: String.raw`\lambda_2(\mathbf A)` },
    ],
  },
]

/** 勘誤 → 驗收 T-id（由上表反查） */
export function testsForErratum(eid: string): string[] {
  return ACCEPTANCE_ROWS.filter((r) => r.errata.includes(eid)).map((r) => r.id)
}

// ═══════════════════════════════════════════════════════════════════════════
// 反面測試（規格 §17 末段）
// ═══════════════════════════════════════════════════════════════════════════

export interface TestRef {
  /** 專案根目錄相對路徑 */
  file: string
  /** it() 的 title（TS）或函式名稱（Python） */
  name: string
}

export interface NegativeTestMeta {
  id: string
  /** 規格 §17 的情境名稱 */
  title: string
  /** 錯在哪裡、會造成什麼（可含 `$…$`） */
  failure: string
  /** 計入 verify 的 T-id（null = Python 端是 test_NEG_…，verify 列為 unmapped） */
  tId: AcceptanceId | null
  ts: TestRef[]
  py: TestRef[]
  errata: string[]
}

export const NEGATIVE_TESTS: NegativeTestMeta[] = [
  {
    id: 'neg-polarity',
    title: '極性反轉',
    failure: String.raw`comparator 或更新方向接反 $\Rightarrow$ 等效 $C\to-C$，平均 pole $1+\mu K_q>1$，任何正 $\mu$ 都發散。`,
    tId: 'T06',
    ts: [
      { file: 'src/simulation/models/polarity.test.ts', name: 'T06: 平均 pole p = 1 − μK_qC = 1.0199471 > 1；反面測試：comparator 極性接反 p = 1.0797885' },
      { file: 'src/simulation/models/calNoise.test.ts', name: 'T13: 反面測試：C ≤ 0（極性反轉）⇒ p > 1、極性警告，線性 MC 發散' },
    ],
    py: [{ file: 'golden/test_reference_values.py', name: 'test_T06_negative_reversed_comparator_polarity_diverges' }],
    errata: [],
  },
  {
    id: 'neg-pe',
    title: '完全缺乏 PE',
    failure: String.raw`$\rho=1\Rightarrow\mathbf R$ 的 $\lambda_{\min}=0$：差模方向在平均遞迴中永遠不動，任何 preconditioner 都不能製造缺失的資訊。`,
    tId: 'T10',
    ts: [
      { file: 'src/simulation/models/pe.test.ts', name: 'T10: 反面測試 ρ = 1（完全缺乏 PE）⇒ eigenvalues [2, 0]、κ = ∞，(1,−1)/√2 方向在平均遞迴中永遠不動' },
      { file: 'src/simulation/models/mimo.test.ts', name: 'T10: 負面—ρ=1（缺乏 PE）⇒ eig [2, 0]、完整 preconditioner 拒絕並解釋「不可辨識」' },
    ],
    py: [{ file: 'golden/test_reference_values.py', name: 'test_T10_negative_missing_pe_rho_one' }],
    errata: ['E04', 'E23'],
  },
  {
    id: 'neg-misalign',
    title: 'Code misalignment',
    failure: String.raw`$H=1$（$\phi=0$）但 GMAC 用錯位 $D=4$ 的 code $\Rightarrow\Omega D=120^\circ>90^\circ$，相關變號。`,
    tId: 'T07',
    ts: [{ file: 'src/simulation/models/filteredX.test.ts', name: 'T07: 反面——H = 1 但 GMAC code 錯位 D = 4 ⇒ C_D = −0.25（negative_tests.json）' }],
    py: [{ file: 'golden/test_reference_values.py', name: 'test_T07_negative_code_misalignment_flips_sign' }],
    errata: ['E46'],
  },
  {
    id: 'neg-scaling',
    title: 'N 改變卻忘記 scaling',
    failure: String.raw`GMAC 改成總和（或 $N$ 改變）卻沿用 average 設計的 $\mu\Rightarrow$ 有效增益乘 $N$：$g=326.8$、pole $-325.8$。`,
    tId: 'T13',
    ts: [
      { file: 'src/simulation/models/calNoise.test.ts', name: 'T13: 反面測試：GMAC 用總和卻沿用 average 的 μ ⇒ g = 326.81、pole = −325.81，出現警告且不存在 σ_w' },
      { file: 'src/simulation/models/gmac.test.ts', name: 'T13: 反面測試：同一個 μ，sum 的更新量是 average 的 N 倍；μ_sum = μ_avg/N 時更新完全相同' },
    ],
    py: [{ file: 'golden/test_reference_values.py', name: 'test_T13_negative_gmac_sum_vs_average_scaling' }],
    errata: ['E18', 'E13'],
  },
  {
    id: 'neg-overflow',
    title: '定點 overflow',
    failure: String.raw`6-bit 有號 code $\times\,N=4096$ 需要 18-bit 累加器；17-bit 在最壞情況 wrap 成 $-4096$，正相關被讀成負。`,
    tId: null,
    ts: [{ file: 'src/simulation/models/gmac.test.ts', name: '反面測試（定點 overflow）：17-bit 累加器在最壞情況 wrap 成 −4096 並變號；18-bit 不溢位' }],
    py: [{ file: 'golden/test_extensions.py', name: 'test_NEG_fixed_point_gmac_overflow_flips_sign' }],
    errata: [],
  },
  {
    id: 'neg-bit',
    title: String.raw`錯誤位元符號（0/1 沒映射成 $\pm1$）`,
    failure: String.raw`把 comparator 的 $b\in\{0,1\}$ 直接當 $q\Rightarrow$ 在 $w=a$ 時平均更新 $E[x]/2\ne0$；DC code 的固定點偏 $+41.27\,\mathrm{fs}$。`,
    tId: 'T04',
    ts: [
      { file: 'src/simulation/models/comparator.test.ts', name: 'T04: 0/1 位元未映射——零均值 code 在真值的平均更新 = 0（只是增益減半）、DC code = 0.125（golden negative_tests）' },
      { file: 'src/simulation/models/gmac.test.ts', name: 'T04: 反面測試（錯誤 0/1 編碼）：w = a 時每 sample 平均更新 = E[x]/2（golden negative_tests）' },
    ],
    py: [{ file: 'golden/test_reference_values.py', name: 'test_T04_negative_wrong_01_encoding_biased_update' }],
    errata: [],
  },
  {
    id: 'neg-path',
    title: 'PLL 誤差與輸出路徑混淆',
    failure: String.raw`$H_{\rm PD}=1/(1+L)$ 是 PD 看到的 residual，$T=L/(1+L)$ 才是輸出路徑；低頻 $|H_{\rm PD}|$ 很小 $\ne$ 輸出雜訊很小。`,
    tId: null,
    ts: [{ file: 'src/simulation/models/pll.test.ts', name: 'T = 1 − H_PD、L(jω)' }],
    py: [{ file: 'golden/test_extensions.py', name: 'test_NEG_pd_path_vs_output_path_confusion' }],
    errata: ['E28'],
  },
  {
    id: 'neg-alias',
    title: '低取樣率的 aliasing',
    failure: String.raw`$f_x+f_w\ge f_{\rm sim}/2$ 時混頻產物折回，量到的 spur 頻率與功率都錯；模擬必須警告。`,
    tId: null,
    ts: [{ file: 'src/simulation/models/calNoise.test.ts', name: 'T15: 反面測試：f_x + f_w ≥ f_sim/2 ⇒ aliasing 警告；非整數 bin ⇒ leakage 警告' }],
    py: [{ file: 'golden/test_extensions.py', name: 'test_NEG_aliasing_low_sample_rate' }],
    errata: ['E09'],
  },
  {
    id: 'neg-formula',
    title: '「模型公式有錯，UI 卻顯示成功」',
    failure: `公式寫錯時，交叉比對必須顯示 mismatch，而不是永遠 ok。本頁以 ${MUTANTS.length} 個 mutant 實測（見下方 Mutation Lab）。`,
    tId: null,
    ts: [
      { file: 'src/simulation/models/acceptance.test.ts', name: '模型公式有錯，UI 卻顯示成功：9 個故意寫錯的公式全部被 golden 比對抓到；δ 極性約定（E39）則本來就看不出來' },
      { file: 'src/simulation/models/calNoise.test.ts', name: 'T15: 反面測試：預測錯誤時交叉比對必須顯示 mismatch（不是永遠 ok）' },
    ],
    py: [{ file: 'golden/test_extensions.py', name: 'test_NEG_wrong_formula_is_detected_by_cross_check' }],
    errata: [],
  },
]

/** Mutation Lab 的說明文字（id 對應 acceptance.MUTANTS） */
/** title / lesson 可含 `$…$` 行內 TeX；select 選項等只能放純文字的地方用 format.texToPlain(title) */
export const MUTANT_TEXT: Record<string, { title: string; wrongTex: string; rightTex: string; lesson: string }> = {
  'pm-missing-half': {
    title: String.raw`PM 漏掉 $/2$`,
    wrongTex: String.raw`\mathrm{PM}=90^\circ-\arcsin(g)`,
    rightTex: String.raw`\mathrm{PM}=90^\circ-\arcsin(g/2)`,
    lesson: String.raw`$g=1$ 時錯誤公式給 $0^\circ$，golden 是 $60^\circ$：差 $6\times10^{10}$ 倍容忍度。`,
  },
  'sigma-w-one-minus-p': {
    title: String.raw`$\sigma_w$ 分母少了 $(1+p)$`,
    wrongTex: String.raw`\sigma_w=\mu\sqrt{\sigma_\eta^2/(1-p)}`,
    rightTex: String.raw`\sigma_w=\mu\sqrt{\sigma_\eta^2/(1-p^2)}`,
    lesson: String.raw`$0.553\,\mathrm{fs}$ vs $0.399\,\mathrm{fs}$。T13 的容忍度 $10^{-12}$ 立刻抓到；MC 也抓得到（Python 的 test_NEG_wrong_formula…）。`,
  },
  'bw-one-minus-p': {
    title: String.raw`把 $(1-p)$ 近似當 exact $-3\,\mathrm{dB}$`,
    wrongTex: String.raw`f_{3\rm dB}\approx\tfrac{1-p}{2\pi}f_u`,
    rightTex: String.raw`f_{3\rm dB}=\tfrac{f_u}{\pi}\arcsin\tfrac{1-p}{2\sqrt p}`,
    lesson: String.raw`$12.40$ vs $12.93\,\mathrm{kHz}$（$-4.1\%$）。近似式可以顯示，但不能冒充 exact。`,
  },
  'enbw-as-f3db': {
    title: String.raw`把 $-3\,\mathrm{dB}$ 當 Noise BW`,
    wrongTex: String.raw`\mathrm{ENBW}\stackrel{?}{=}f_{3\rm dB}`,
    rightTex: String.raw`\mathrm{ENBW}=\tfrac{f_u}{2}\tfrac{1-p}{1+p}`,
    lesson: String.raw`$12.93$ vs $20.29\,\mathrm{kHz}$：拿 $f_{3\rm dB}$ 積分白雜訊會低估 $\sigma_w^2$ 約 $36\%$。`,
  },
  'strict-tie-as-table': {
    title: String.raw`偶數 $N$ 照字面算 strict`,
    wrongTex: String.raw`P(S_{100}>0)\stackrel{?}{=}\Phi(m\sqrt N/\sqrt{1-m^2})`,
    rightTex: String.raw`P(S_N>0)+\tfrac12P(S_N=0)\approx\Phi(\cdot)`,
    lesson: String.raw`$49.2\%$ vs $53.2\%$：CLT 無修正式在偶數 $N$ 近似的是 tie 平分。`,
  },
  'kq-forgotten': {
    title: String.raw`§10.1 忘了 $K_q$ 正規化`,
    wrongTex: String.raw`p=1-\mu K_q^{\rm phys}\lambda_{\min}`,
    rightTex: String.raw`p=1-(\mu K_q)\lambda_{\min},\ \mu K_q=0.5`,
    lesson: String.raw`$0.99996$ vs $0.995$：慢兩個數量級（75,091 vs 598 blocks）。`,
  },
  'sign-vs-mse': {
    title: String.raw`無雜訊 Sign-LMS 當成 $1.34$`,
    wrongTex: String.raw`w^*_{\rm sign}(\sigma_v{=}0)\stackrel{?}{=}1.34`,
    rightTex: String.raw`w^*_{\rm MSE}=a+c_3\tfrac{E[x^4]}{E[x^2]}=1.34`,
    lesson: String.raw`$1.4$ vs $1.34$：無雜訊 Sign-LMS 是 $|x|$ 加權中位數（MAE 解），不是 MSE 解。`,
  },
  'sum-mode-mu': {
    title: String.raw`sum 模式沿用 average 的 $\mu$`,
    wrongTex: String.raw`g=N\mu K`,
    rightTex: String.raw`g=\mu K`,
    lesson: String.raw`$326.8$ vs $0.0798$：這同時是反面測試「$N$ 改變卻忘記 scaling」。`,
  },
  'a-minus-mj': {
    title: String.raw`更新矩陣寫成 $\mathbf I-\mathbf M\mathbf J$`,
    wrongTex: String.raw`\mathbf A=\mathbf I-\mathbf M\mathbf J`,
    rightTex: String.raw`\mathbf A=\mathbf I+\mathbf M\mathbf J`,
    lesson: String.raw`eig $1.6/0.8$ vs $1.2/0.4$：極性寫反仍是「發散」，但數值完全不同——只看「穩不穩」會漏掉。`,
  },
  'delta-convention': {
    title: String.raw`$\delta=w-a$（規格 §3 的極性）`,
    wrongTex: String.raw`\delta_n=w_n-a`,
    rightTex: String.raw`\delta_n=a-w_n`,
    lesson: String.raw`pole 都是 $1-\mu x^2=0.6$，pole 測試「本來就」看不出來：它不是 bug，只是約定。這一列示範測試的盲點——所以 T01 另外比對 $w_n$ 的整條 trace。`,
  },
}
