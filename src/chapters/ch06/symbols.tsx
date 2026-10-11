import { Tex, type SymbolEntry } from '@/components'
import { Erratum } from './shared'

/**
 * 本章符號表（docs/teaching-style.md §5）：放在章末（index.tsx 的 #symbols），章首只留一行連結。
 * 極性一律 δ = a − w（§0 約定；E32/E39）；e_PD 已含 comparator 前的雜訊 v，所以 q = sign(e_PD)（與 F-06.1、圖 6.4 一致）。
 * 「首次出現」欄 = 正文第一次用到並就地解釋這個符號的小節。
 */
export const CH06_SYMBOLS: SymbolEntry[] = [
  {
    symbol: 'x[n]',
    meaning: '原始 DSM / DTC code（GMAC 的 regressor）',
    unit: '\\text{無因次}',
    firstSeen: '§1',
    note: (
      <>
        正規化 code；PLL 模式取 standardize（<Tex>{'E[x]=0,\\;E[x^2]=1'}</Tex>）
      </>
    ),
  },
  {
    symbol: 'a,\\;w_k',
    meaning: (
      <>
        真實的 DTC gain；校正迴路在第 <Tex>{'k'}</Tex> 個 block 使用的估計值
      </>
    ),
    unit: '\\mathrm{fs}',
    firstSeen: '§1',
    note: (
      <>
        每單位（無因次）code 的時間；<Tex>{'n'}</Tex> 是 sample 索引、<Tex>{'k'}</Tex> 是 block 索引
      </>
    ),
  },
  {
    symbol: 'h[n],\\;H(z)',
    meaning: '從 DTC 誤差到 PD 的脈衝響應與轉移函數（主 PLL 的 error transfer）',
    firstSeen: '§1、§2',
    note: <Tex>{'H=H_{\\mathrm{PD}}=1/(1+L)'}</Tex>,
  },
  {
    symbol: 'u[n]=(h*x)[n]',
    meaning: 'PD 實際「看到」的有效 regressor',
    unit: '\\text{同 }x',
    firstSeen: '§1',
    note: (
      <>
        §0 約定；<Erratum id="E13" />：<Tex>{'u'}</Tex> 與 <Tex>{'x'}</Tex> 同單位
      </>
    ),
  },
  {
    symbol: '\\delta_k=a-w_k',
    meaning: (
      <>
        第 <Tex>{'k'}</Tex> 個 GMAC block 的參數誤差
      </>
    ),
    unit: '\\mathrm{fs}',
    firstSeen: '§1',
    note: (
      <>
        本章採 <Tex>{'\\delta=a-w'}</Tex>（§0）；規格 §3 原寫 <Tex>{'w-a'}</Tex>，見 <Erratum id="E32" />
      </>
    ),
  },
  {
    symbol: '\\varepsilon[n]=(a-w_k)\\,x[n]',
    meaning: 'DTC 的時間誤差（注入主 PLL 的比較點）',
    unit: '\\mathrm{fs}',
    firstSeen: '§2',
    note: (
      <>
        Z 域寫成 <Tex>{'\\mathcal E'}</Tex>；與 §11 的 <Tex>{'\\varepsilon_{cc}'}</Tex> 無關
      </>
    ),
  },
  {
    symbol: '\\varphi_{\\mathrm{fb}},\\;T=L/(1+L)',
    meaning: '主 PLL 的回授修正（已追掉的誤差）與 closed-loop 轉移函數',
    firstSeen: '§2',
    note: (
      <>
        <Tex>{'\\Phi_{\\mathrm{fb}}=T\\,\\mathcal E'}</Tex>，<Tex>{'H_{\\mathrm{PD}}+T=1'}</Tex>（圖 6.3）
      </>
    ),
  },
  {
    symbol: 'e_{\\mathrm{PD}}[n]',
    meaning: (
      <>
        comparator 輸入端的 PD 誤差：<Tex>{'e_{\\mathrm{PD}}\\approx(a-w_k)\\,u+v'}</Tex>（已含雜訊 <Tex>{'v'}</Tex>）
      </>
    ),
    unit: '\\mathrm{fs}',
    firstSeen: '§2',
    note: (
      <>
        不含雜訊的確定部分記作 <Tex>{'e_{\\det}=(a-w_k)\\,u'}</Tex>（§3）
      </>
    ),
  },
  { symbol: 'v[n],\\;\\sigma_v', meaning: 'comparator 前的雜訊與其 RMS', unit: '\\mathrm{fs}', firstSeen: '§1、§2' },
  {
    symbol: 'q[n]',
    meaning: (
      <>
        1-bit comparator 輸出 <Tex>{'\\operatorname{sign}(e_{\\mathrm{PD}}[n])'}</Tex>
      </>
    ),
    unit: '\\pm1',
    firstSeen: '§1',
    note: (
      <>
        tie（<Tex>{'e=0'}</Tex>）<Tex>{'\\to+1'}</Tex>
      </>
    ),
  },
  {
    symbol: 'G_k',
    meaning: (
      <>
        GMAC 一個 block 的平均 <Tex>{'\\frac1N\\sum_n q[n]\\,x[n-D]'}</Tex>
      </>
    ),
    unit: '\\text{無因次}',
    firstSeen: '§3',
    note: (
      <>
        average mode；sum mode 再乘 <Tex>{'N'}</Tex>
      </>
    ),
  },
  { symbol: 'K_q=\\sqrt{2/\\pi}/\\sigma_v', meaning: 'comparator 的統計小訊號增益（第 05 章）', unit: '\\mathrm{fs}^{-1}', firstSeen: '§1' },
  {
    symbol: 'C,\\;C_D',
    meaning: (
      <>
        相關 <Tex>{'E\\big[x[n-D]\\,u[n]\\big]'}</Tex>：決定更新極性的關鍵量（<Tex>{'C\\equiv C_0'}</Tex>）
      </>
    ),
    unit: '\\text{無因次}',
    firstSeen: '§1',
    note: (
      <>
        與 §11 的 disturbance 不同（<Erratum id="E12" /> 已把那裡改名 <Tex>{'\\varepsilon_{cc}'}</Tex>）
      </>
    ),
  },
  { symbol: 'p=1-\\mu K_qC', meaning: '平均更新 pole（block rate）', unit: '\\text{無因次}', firstSeen: '§1' },
  {
    symbol: '\\mu',
    meaning: '學習率 gain_step',
    unit: '\\mathrm{fs}',
    firstSeen: '§1',
    note: (
      <>
        average-mode GMAC 下 <Tex>{'\\mu'}</Tex> 的單位為 fs（<Erratum id="E13" />）
      </>
    ),
  },
  { symbol: 'g=\\mu K_qC', meaning: '無因次 normalized loop gain', unit: '\\text{無因次}', firstSeen: '§3' },
  {
    symbol: 'D',
    meaning: (
      <>
        GMAC code delay（<Tex>{'x'}</Tex> 延遲 <Tex>{'D'}</Tex> 個 sample 再相乘）
      </>
    ),
    unit: '\\text{samples}',
    firstSeen: '§2',
    note: (
      <>
        不是 §8.4 的 state-space <Tex>{'D'}</Tex>
      </>
    ),
  },
  {
    symbol: 'A,\\;\\Omega,\\;\\phi',
    meaning: (
      <>
        單頻 code 的振幅、離散角頻率、路徑相位 <Tex>{'\\phi=\\angle H(e^{j\\Omega})'}</Tex>
      </>
    ),
    unit: '\\Omega:\\,\\mathrm{rad/sample}',
    firstSeen: '§4',
    note: (
      <>
        <Tex>{'\\Omega=\\omega T_s'}</Tex>；不可把 <Tex>{'\\Omega'}</Tex> 直接代入 <Tex>{'H(j\\omega)'}</Tex>（<Erratum id="E44" />）
      </>
    ),
  },
  { symbol: 'N', meaning: 'GMAC 每個 block 的 sample 數', unit: '\\text{samples}', firstSeen: '§2' },
  {
    symbol: 'L(s),\\;L(z)',
    meaning: '主 PLL 開迴路增益（CT 原型 / DT 模擬模型）',
    firstSeen: '§2',
    note: (
      <>
        DT 版本見 F-06.10 <Erratum id="E44" />
      </>
    ),
  },
  { symbol: '\\omega_c,\\;\\omega_n,\\;\\zeta', meaning: 'Type-I 交越頻率；Type-II 自然頻率與阻尼比', unit: '\\mathrm{rad/s}', firstSeen: '§5' },
  {
    symbol: '\\nu=\\omega/\\omega_L',
    meaning: (
      <>
        以迴路頻率 <Tex>{'\\omega_L'}</Tex>（<Tex>{'\\omega_c'}</Tex> 或 <Tex>{'\\omega_n'}</Tex>）正規化的頻率；DT 時 <Tex>{'\\nu=\\Omega/(\\omega_LT_s)'}</Tex>
      </>
    ),
    unit: '\\text{無因次}',
    firstSeen: '§5',
  },
  {
    symbol: 'T_s,\\;f_s',
    meaning: (
      <>
        comparator / PD 取樣週期與頻率（本章假設 <Tex>{'f_s=f_{\\mathrm{ref}}'}</Tex>）
      </>
    ),
    unit: '\\mathrm{s},\\,\\mathrm{Hz}',
    firstSeen: '§2、§5',
    note: (
      <>
        <Tex>{'f_s\\ne f_{\\mathrm{ref}}'}</Tex> 需另做 multirate 推導（<Erratum id="E44" />）
      </>
    ),
  },
  {
    symbol: 'K_p,\\;K_i,\\;K,\\;d',
    meaning: (
      <>
        DPLL 比例、積分增益；Type-I 增益 <Tex>{'K=\\omega_cT_s'}</Tex>；額外 loop latency <Tex>{'d'}</Tex>
      </>
    ),
    unit: 'd:\\,\\text{samples}',
    firstSeen: '§5',
  },
  {
    symbol: '\\mathrm{BW},\\;c_{3\\mathrm{dB}}=\\omega_{3\\mathrm{dB}}/\\omega_n',
    meaning: (
      <>
        主 PLL closed-loop 的 <Tex>{'-3\\,\\mathrm{dB}'}</Tex> 頻寬（<Tex>{'|T|^2=\\tfrac12'}</Tex> 的頻率）；它是自然頻率的幾倍
      </>
    ),
    unit: '\\mathrm{Hz};\\ \\text{無因次}',
    firstSeen: '§5',
    note: (
      <>
        <Tex>{'c_{3\\mathrm{dB}}=\\sqrt{\\beta+\\sqrt{\\beta^2+1}}'}</Tex>，<Tex>{'\\beta=1+2\\zeta^2'}</Tex>；<Tex>{'\\omega_nT_s=2\\pi(\\mathrm{BW}/f_{\\mathrm{ref}})/c_{3\\mathrm{dB}}'}</Tex>（圖
        6.14、HC-06.6；CT 原型）
      </>
    ),
  },
  {
    symbol: '\\kappa',
    meaning: (
      <>
        低頻係數：<Tex>{'\\operatorname{Re}H\\approx\\kappa\\,(\\Omega/\\omega_LT_s)^2'}</Tex>（Type-II <Tex>{'\\kappa=-1'}</Tex>）
      </>
    ),
    unit: '\\text{無因次}',
    firstSeen: '§5',
  },
  {
    symbol: 'R_x[\\ell],\\;\\sigma_x^2',
    meaning: (
      <>
        自相關 <Tex>{'E\\big[x[n]\\,x[n+\\ell]\\big]'}</Tex>；code 功率 <Tex>{'\\sigma_x^2=E[x^2]=R_x[0]'}</Tex>
      </>
    ),
    unit: '\\text{同 }x^2',
    firstSeen: '§4、§6',
  },
  {
    symbol: 'S_{xx}(e^{j\\Omega})',
    meaning: (
      <>
        DTFT 形式的雙邊 PSD：<Tex>{'\\sigma_x^2=\\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi}S_{xx}\\,d\\Omega'}</Tex>
      </>
    ),
    unit: 'x^2/(\\text{cycle/sample})',
    firstSeen: '§6',
    note: (
      <>
        不是 welch 的 one-sided <Tex>{'x^2/\\mathrm{Hz}'}</Tex>（<Erratum id="E28" />）
      </>
    ),
  },
  {
    symbol: 'm_j=\\sum_k k^j h[k]',
    meaning: (
      <>
        脈衝響應的動差（<Tex>{'j=0,1,2'}</Tex>）；對應 <Tex>{'H(e^{j\\Omega})'}</Tex> 在 <Tex>{'\\Omega=0'}</Tex> 的泰勒係數
      </>
    ),
    unit: '\\text{無因次}',
    firstSeen: '§6.4',
  },
  {
    symbol: 's[k]=\\sum_{j\\le k}h[j]',
    meaning: '主 PLL 誤差路徑的步階響應（鋸齒折返一次，PD 看到的就是它）',
    unit: '\\text{無因次}',
    firstSeen: '§6.4',
    note: (
      <>
        Type-II：<Tex>{'\\sum_ks[k]=-m_1=0'}</Tex>（圖 6.22）
      </>
    ),
  },
  {
    symbol: 't_\\ell=\\mathrm{frac}(|\\ell|\\cdot\\mathrm{frac})',
    meaning: (
      <>
        相隔 <Tex>{'\\ell'}</Tex> 個 sample 的鋸齒相位差（以週期為單位）
      </>
    ),
    unit: '\\text{無因次}',
    firstSeen: '§6.4',
    note: (
      <>
        外層的 <Tex>{'\\mathrm{frac}(\\cdot)'}</Tex> 是「取小數部分」
      </>
    ),
  },
  {
    symbol: 'E[G](\\delta),\\;\\delta_c',
    meaning: (
      <>
        mean-field GMAC 特性 <Tex>{'E\\big[x_D\\,\\mathrm{erf}(\\delta u/\\sqrt2\\sigma_v)\\big]'}</Tex> 與它的第一個變號點（basin 半徑）
      </>
    ),
    unit: '\\delta_c:\\,\\mathrm{fs}',
    firstSeen: '§3、§6.4',
    note: (
      <>
        小訊號斜率 = <Tex>{'K_qC'}</Tex>；F-06.19
      </>
    ),
  },
  {
    symbol: 'P,\\;c_P=P^2/(P^2-1)',
    meaning: 'DSM 累加器實際走過的相位格點數與鋸齒自相關的有限格點修正',
    unit: '\\text{無因次}',
    firstSeen: '§6.4',
  },
  {
    symbol: '\\mathrm{frac},\\;\\Omega_0=2\\pi\\,\\mathrm{frac}',
    meaning: 'FCW 小數部分與近整數時 residue 鋸齒波的基頻',
    unit: '\\Omega_0:\\,\\mathrm{rad/sample}',
    firstSeen: '§6.4',
  },
  {
    symbol: '\\Delta=\\Omega_0/(\\omega_LT_s)',
    meaning: (
      <>
        鋸齒基頻相對迴路頻率的比值（近整數時 <Tex>{'\\ll1'}</Tex>）
      </>
    ),
    unit: '\\text{無因次}',
    firstSeen: '§6.4',
  },
]
