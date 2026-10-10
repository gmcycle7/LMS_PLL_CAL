import { Tex, type SymbolEntry } from '@/components'
import { ErratumChip } from './common'

/**
 * 本頁符號表（docs/teaching-style.md §5）。Gallery 橫跨 12 個例子，所以表分兩部分：
 * (1) 比對預期文字用的符號（本頁新增）；(2) 12 個例子共用的符號（定義與各章相同，這裡只列本頁用到的）。
 * 符號衝突（ρ、k、r、d）在備註欄說明本頁的用法。
 */
export const CHECK_SYMBOLS: SymbolEntry[] = [
  { symbol: '\\hat y', meaning: '重算值：把 preset 的參數交給真實模型函式算出來的數', unit: '\\text{與該量相同}', firstSeen: '§2.3', note: '程式中的 value' },
  { symbol: 'y_{\\mathrm t}', meaning: '預期結果文字中寫的數字（text）', unit: '\\text{同上}', firstSeen: '§2.3', note: '程式中的 ExtractedNumber.value' },
  { symbol: 'n_{\\mathrm d}', meaning: '文字數字的小數位數（decimals）', firstSeen: '§2.3', note: <>例：<Tex>{'2.28'}</Tex> 的 <Tex>{'n_{\\mathrm d}=2'}</Tex></> },
  {
    symbol: '\\Delta_{\\mathrm t}',
    meaning: '捨入半寬（rounding half-width）：文字最後一位的半個單位',
    unit: '\\text{同上}',
    firstSeen: '§2.3',
    note: <>程式中的 tol；<Tex>{'\\Delta_{\\mathrm t}=\\tfrac12 10^{\\,e-n_{\\mathrm d}}'}</Tex></>,
  },
  { symbol: 'W', meaning: '接受半寬（acceptance half-width）：重算值離文字數字多近才算相符', unit: '\\text{同上}', firstSeen: '§2.3', note: <>程式中的 acceptHalfWidth；夠精確時 <Tex>{'W=k_{\\mathrm{tol}}\\Delta_{\\mathrm t}'}</Tex></> },
  { symbol: 'k_{\\mathrm{tol}}', meaning: '容差倍數（tolerance multiplier）', firstSeen: '§2.3', note: <>程式中的 k；與 block 索引 <Tex>{'k'}</Tex> 無關</> },
  { symbol: '\\varepsilon', meaning: <>假想的模型相對誤差：模型算出 <Tex>{'\\hat y(1+\\varepsilon)'}</Tex> 而不是 <Tex>{'\\hat y'}</Tex></>, firstSeen: '§2.4', note: '反面測試用；不是量測到的誤差' },
  { symbol: '\\varepsilon_{\\max}', meaning: <>假想誤差的範圍：<Tex>{'\\varepsilon'}</Tex> 在 <Tex>{'[-\\varepsilon_{\\max},\\varepsilon_{\\max}]'}</Tex> 均勻分布</>, firstSeen: '§2.4', note: <>程式中的 r；與雙迴路的 <Tex>{'r'}</Tex> 無關</> },
  { symbol: 'P_{\\text{match}}', meaning: '錯誤值仍然對到文字中某個數字的機率', firstSeen: '§2.4', note: '在均勻誤差假設下' },
]

export const MODEL_SYMBOLS: SymbolEntry[] = [
  { symbol: 'a', meaning: '真實增益（黑盒子裡的未知數；PLL 中是 DTC gain 的正確值）', unit: '\\mathrm{fs}', firstSeen: '#1', note: '嚴格說是 fs per unit code' },
  { symbol: 'w_n,\\ w_k', meaning: <>校正係數（LMS 的猜測值）；<Tex>{'n'}</Tex> 是 sample 索引、<Tex>{'k'}</Tex> 是 GMAC block 索引</>, unit: '\\mathrm{fs}', firstSeen: '#1' },
  {
    symbol: '\\delta=a-w',
    meaning: '係數誤差（真值減猜測）',
    unit: '\\mathrm{fs}',
    firstSeen: '#1',
    note: (
      <>
        全站採 <Tex>{'\\delta=a-w'}</Tex> <ErratumChip eid="E39" />；量化章另用 <Tex>{'\\delta w=w-w^*'}</Tex> <ErratumChip eid="E49" />
      </>
    ),
  },
  { symbol: '\\mu', meaning: '步長（learning rate）', unit: '\\mathrm{fs}', firstSeen: '#1', note: <>L0 的 MSE-LMS 中單位是 <Tex>{'1/[x]^2'}</Tex>；Sign-LMS（average GMAC）中是 fs</> },
  { symbol: 'x,\\ u', meaning: <>code（regressor）；<Tex>{'u'}</Tex> 是 code 經 PLL error path 後 PD 真正看到的訊號</>, firstSeen: '#1, #3', note: <><Tex>{'u=H_{PD}\\{x\\}'}</Tex></> },
  { symbol: 'e,\\ q', meaning: 'PD 誤差與 comparator 的 1-bit 決策', unit: '\\mathrm{fs},\\ \\pm1', firstSeen: '#1, #2', note: <><Tex>{'q=\\operatorname{sign}(e)\\in\\{+1,-1\\}'}</Tex></> },
  { symbol: 's,\\ \\sigma_v', meaning: 'comparator 輸入的固定誤差與雜訊 RMS', unit: '\\mathrm{fs}', firstSeen: '#2' },
  { symbol: 'K_q', meaning: 'comparator 小訊號增益', unit: '\\mathrm{fs^{-1}}', firstSeen: '#2', note: <><Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex></> },
  { symbol: 'N,\\ S_N', meaning: <>GMAC 累加長度；<Tex>{'N'}</Tex> 個 <Tex>{'\\pm1'}</Tex> 決策的和</>, firstSeen: '#2', note: <>sum 尺度 <ErratumChip eid="E18" /></> },
  { symbol: 'C,\\ C_D', meaning: <>regressor 與 <Tex>{'u'}</Tex> 的相關（correlation）；code 延遲 <Tex>{'D'}</Tex> 個 sample 時記為 <Tex>{'C_D'}</Tex></>, firstSeen: '#3, #4', note: <><Tex>{'C=E[x_{\\text{ref}}\\,u]'}</Tex>，可以是負的</> },
  { symbol: '\\varphi,\\ \\Omega,\\ D', meaning: 'error path 在 code 頻率的相位；code 的離散頻率；GMAC 的 code 延遲', unit: '^\\circ,\\ \\mathrm{rad/sample},\\ \\text{samples}', firstSeen: '#3, #4', note: <>更新延遲另用 <Tex>{'d'}</Tex>（blocks）<ErratumChip eid="E34" /></> },
  { symbol: 'g,\\ p', meaning: '無因次迴路增益與 pole', firstSeen: '#1, #3', note: <><Tex>{'g=\\mu K_qC,\\ p=1-g'}</Tex></> },
  { symbol: 'r,\\ b,\\ c', meaning: '雙迴路例子：主迴路殘差的 pole、輸入增益、觀測增益', firstSeen: '#5', note: <>觀測模型的符號 <ErratumChip eid="E31" /></> },
  {
    symbol: '\\rho',
    meaning: '兩種用法：(a) 兩個 regressor 的相關係數；(b) 矩陣的 spectral radius（最大的 eigenvalue 絕對值）',
    firstSeen: '#5, #6',
    note: <>(a) 寫成 <Tex>{'\\rho=0.99'}</Tex>；(b) 一律帶括號 <Tex>{'\\rho(\\mathbf A)'}</Tex> 或寫 <Tex>{'\\max|z|'}</Tex></>,
  },
  { symbol: '\\lambda_i,\\ \\kappa', meaning: <>相關矩陣 <Tex>{'\\mathbf R'}</Tex> 的 eigenvalue（特徵值）；condition number（條件數）</>, firstSeen: '#6', note: <><Tex>{'\\kappa=\\lambda_{\\max}/\\lambda_{\\min}'}</Tex></> },
  { symbol: '\\mathbf J,\\ \\mathbf M,\\ \\mathbf A', meaning: 'Jacobian（各 GMAC 對各參數的斜率）、更新矩陣、轉移矩陣', firstSeen: '#12', note: <><Tex>{'\\mathbf A=\\mathbf I+\\mathbf M\\mathbf J'}</Tex> <ErratumChip eid="E24" /></> },
  {
    symbol: '\\mathbf b,\\ \\boldsymbol\\eta_k',
    meaning: '統一觀點（F-GA.4）中每個 block 把誤差推偏的固定量（bias 的來源），以及 GMAC 的零均值雜訊',
    firstSeen: '§4',
    note: <>粗體 <Tex>{'\\mathbf b'}</Tex> 與雙迴路的 <Tex>{'b'}</Tex>、comparator offset <Tex>{'b'}</Tex> 無關；<Tex>{'\\eta_k'}</Tex> 的正負號併入定義（對稱分布，不影響變異數）</>,
  },
  { symbol: 'c_3,\\ w^*', meaning: 'DTC 三階非線性係數；GMAC 平均歸零的固定點', firstSeen: '#7', note: <><Tex>{'w^*\\ne a'}</Tex> 就是 bias</> },
  { symbol: '\\sigma_w,\\ f_u', meaning: '係數的穩態雜訊 RMS（gain-equivalent）；更新率', unit: '\\mathrm{fs},\\ \\mathrm{Hz}', firstSeen: '#8', note: <><Tex>{'f_u=f_s/N'}</Tex>；<Tex>{'\\sigma_w'}</Tex> 的成立前提見 <ErratumChip eid="E30" /></> },
  { symbol: '\\beta', meaning: '相位調變指數（PM index）', unit: '\\mathrm{rad}', firstSeen: '#9', note: <><Tex>{'\\beta=2\\pi f_{\\mathrm{out}}|T|A_t'}</Tex></> },
]
