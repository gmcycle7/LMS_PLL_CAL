import { Callout, ClaimTag, ModelLevel, Section, SourceTag, SymbolTable, TestBadge, Tex, type SymbolEntry } from '@/components'
import { MODE_LABEL, useSettings } from '@/app/settings'
import { BlackBoxSection, LoopSection, UpdateFormulaSection } from './sections/BlackBox'
import { HAND_CALC_PARAMS, HandCalcSection } from './sections/HandCalc'
import { WhyExSection } from './sections/WhyEx'
import { NoiseAverageSection } from './sections/NoiseAverage'
import { WhyMattersSection } from './sections/WhyMatters'
import { SignTeaserSection } from './sections/SignTeaser'
import { AssumptionsSection } from './sections/Assumptions'
import { LearningMapSection, QuizSection, RecapSection } from './sections/Wrapup'
import { IntroPlayground } from './experiments/IntroPlayground'
import { DEFAULT_BASE, DEFAULT_MUS } from './experiments/playgroundModel'
import { fixedXMuMax, fixedXPole } from '@/simulation/models/lms'
import { texNum } from './format'
import { ErratumNote, ErratumRef, PageLink } from './common'
import './chapter.css'

/** 本章符號（docs/teaching-style.md §5）。 */
const SYMBOLS: SymbolEntry[] = [
  { symbol: 'x,\\ x_n', meaning: (
      <>
        輸入（regressor）：第 <Tex>{'n'}</Tex> 筆餵進黑盒子的值
      </>
    ), unit: '\\text{無因次（教學例）}', firstSeen: '§0.1', note: 'PLL 中為 DSM 殘差／DTC code' },
  { symbol: 'y,\\ y_n', meaning: '黑盒子的輸出（量測值）', unit: '[y]', firstSeen: '§0.1' },
  { symbol: 'a', meaning: '黑盒子內部的真實參數（未知）', unit: '[y]/[x]', firstSeen: '§0.1', note: 'PLL 中為真實 DTC gain（fs/code）' },
  { symbol: 'v,\\ v_n', meaning: '量測雜訊，零均值', unit: '[y]', firstSeen: '§0.1' },
  { symbol: 'w,\\ w_n', meaning: '我們目前的猜測（可調係數 / weight）', unit: '[y]/[x]', firstSeen: '§0.1', note: '硬體上的 gain register' },
  { symbol: '\\hat y_n=w_nx_n', meaning: '預測', unit: '[y]', firstSeen: '§0.2' },
  { symbol: 'e_n=y_n-\\hat y_n', meaning: '誤差：預測錯多少、往哪錯', unit: '[y]', firstSeen: '§0.2' },
  {
    symbol: '\\mu',
    meaning: '學習率（learning rate / step size）',
    unit: '[w]/([e][x])',
    firstSeen: '§0.3',
    note: (
      <>
        本章教學例無因次；硬體常為 <Tex>{'2^{-k}'}</Tex>（右移 <Tex>{'k'}</Tex> 位元）
      </>
    ),
  },
  {
    symbol: 'n',
    meaning: '第幾筆資料（sample index）',
    firstSeen: '§0.3',
    note: (
      <>
        全站：<Tex>{'n'}</Tex> = comparator sample、<Tex>{'k'}</Tex> = GMAC block（§0.9）
      </>
    ),
  },
  {
    symbol: '\\delta_n=a-w_n',
    meaning: '參數誤差：還差多少',
    unit: '[w]',
    firstSeen: '§0.4',
    note: (
      <>
        全站極性 <Tex>{'a-w'}</Tex>（<ErratumRef eid="E39" />：規格 §3 原寫 <Tex>{'w-a'}</Tex>）
      </>
    ),
  },
  {
    symbol: 'p=1-\\mu x^2',
    meaning: (
      <>
        固定 <Tex>{'x'}</Tex> 時參數誤差每步乘上的倍數（pole）
      </>
    ),
    unit: '\\text{無因次}',
    firstSeen: '§0.6',
  },
  {
    symbol: 'j_n=\\tfrac12e_n^2',
    meaning: '單筆成本',
    unit: '[y]^2',
    firstSeen: '§0.6',
    note: (
      <>
        含 <Tex>{'\\tfrac12'}</Tex>，微分後與更新量 <Tex>{'\\mu ex'}</Tex> 同 scaling（<ErratumRef eid="E41" />）
      </>
    ),
  },
  {
    symbol: 'J(w)=\\tfrac12E[(y-wx)^2]',
    meaning: '平均成本（MSE 的一半）',
    unit: '[y]^2',
    firstSeen: '§0.6',
    note: (
      <>
        規格 §1 的 <Tex>{'J_2'}</Tex> 沒有 <Tex>{'\\tfrac12'}</Tex>；argmin 相同（<ErratumRef eid="E41" />）
      </>
    ),
  },
  { symbol: 'E[\\cdot]', meaning: '期望值：做很多次取平均會趨近的值', firstSeen: '§0.7', note: '先備知識框' },
  { symbol: '\\operatorname{Var}(\\cdot),\\ \\sigma', meaning: '變異數／標準差：抖動有多大', firstSeen: '§0.7' },
  {
    symbol: '\\sigma_v',
    meaning: (
      <>
        雜訊 <Tex>{'v'}</Tex> 的標準差（RMS）
      </>
    ),
    unit: '[y]',
    firstSeen: '§0.5',
  },
  {
    symbol: 's_1',
    meaning: (
      <>
        單筆 <Tex>{'e\\,x'}</Tex> 的標準差
      </>
    ),
    unit: '[y][x]',
    firstSeen: '§0.7',
  },
  {
    symbol: 'N,\\ \\bar G_N',
    meaning: (
      <>
        平均的筆數；<Tex>{'N'}</Tex> 筆 <Tex>{'e\\,x'}</Tex> 的平均 <Tex>{'\\bar G_N=\\frac1N\\sum e_ix_i'}</Tex>
      </>
    ),
    firstSeen: '§0.7',
  },
  {
    symbol: '\\mathrm{sign}(e),\\ q',
    meaning: (
      <>
        誤差的正負號；1-bit 比較器輸出 <Tex>{'q\\in\\{+1,-1\\}'}</Tex>
      </>
    ),
    firstSeen: '§0.9',
    note: (
      <>
        <Tex>{'\\mathrm{sign}(0)'}</Tex> 慣例必須明定（<ErratumRef eid="E40" />）；硬體 0/1 先映射 <Tex>{'q=2b-1'}</Tex>
      </>
    ),
  },
  {
    symbol: '\\Phi(z)',
    meaning: (
      <>
        標準常態的累積分布函數 <Tex>{'P(Z\\le z)'}</Tex>
      </>
    ),
    firstSeen: '§0.7',
    note: '先備知識框（§0.7、§0.9）',
  },
  {
    symbol: 'G_k',
    meaning: (
      <>
        GMAC：第 <Tex>{'k'}</Tex> 個 block 的 <Tex>{'q\\,x'}</Tex> 平均 <Tex>{'\\frac1N\\sum q_nx_n'}</Tex>
      </>
    ),
    firstSeen: '§0.9',
    note: (
      <>
        若硬體用總和要再乘 <Tex>{'N'}</Tex>
      </>
    ),
  },
  {
    symbol: 's,\\ m_q,\\ S_N',
    meaning: (
      <>
        §0.9 比較器例子：比較器前真正的誤差 <Tex>{'s'}</Tex>；1-bit 輸出的平均 <Tex>{'m_q=E[q]'}</Tex>；<Tex>{'N'}</Tex> 筆輸出的<strong>總和</strong>{' '}
        <Tex>{'S_N=\\sum_{i=1}^{N}q_i'}</Tex>
      </>
    ),
    unit: '\\mathrm{fs},\\ \\text{無因次},\\ \\text{無因次}',
    firstSeen: '§0.9',
    note: (
      <>
        規格 §5 原寫 <Tex>{'G_N'}</Tex>、<Tex>{'m'}</Tex>（<ErratumRef eid="E18" />）；平均 <Tex>{'G=S_N/N'}</Tex>
      </>
    ),
  },
  {
    symbol: 'M',
    meaning: 'Monte Carlo 的獨立試驗次數',
    firstSeen: '§0.7',
  },
  {
    symbol: '\\tau,\\ N_{\\mathrm{eq}}',
    meaning: (
      <>
        時間常數 <Tex>{'\\tau=-1/\\ln|p|'}</Tex>（暫態衰減到 <Tex>{'1/e'}</Tex> 的步數）；等效平均長度{' '}
        <Tex>{'N_{\\mathrm{eq}}=\\frac{1+p}{1-p}'}</Tex>
      </>
    ),
    unit: '\\text{samples}',
    firstSeen: '§0.7',
    note: 'Engineer 模式的推導',
  },
  {
    symbol: "\\kappa,\\ \\varepsilon_{cc},\\ v'",
    meaning: (
      <>
        §0.10 反例：與 code 相關的干擾 <Tex>{'\\varepsilon_{cc}=\\kappa x'}</Tex>（係數 <Tex>{'\\kappa'}</Tex>）；<Tex>{"v'"}</Tex> 是與 <Tex>{'x'}</Tex>{' '}
        無關的雜訊，<Tex>{"v=\\varepsilon_{cc}+v'"}</Tex>
      </>
    ),
    unit: '[y]/[x],\\ [y],\\ [y]',
    firstSeen: '§0.10',
    note: (
      <>
        規格 §11.3 原寫 <Tex>{'u=cx'}</Tex>，與 filtered regressor <Tex>{'u=h*x'}</Tex> 撞名（<ErratumRef eid="E12" />）
      </>
    ),
  },
  {
    symbol: 'w^*',
    meaning: (
      <>
        平均更新量為 0 的位置：LMS 平均收斂到的值（<Tex>{'E[v\\,x]=0'}</Tex> 時等於 <Tex>{'a'}</Tex>）
      </>
    ),
    unit: '[y]/[x]',
    firstSeen: '§0.10',
    note: (
      <>
        <Tex>{'w^*-a'}</Tex> 就是 calibration bias（Ch11）
      </>
    ),
  },
]

export default function Chapter00() {
  const { mode } = useSettings()
  return (
    <div className="ch00">
      <div className="ch00-question">
        <strong>這一課要回答的問題：</strong>你只能觀察一個黑盒子的輸入 <Tex>{'x'}</Tex> 和輸出 <Tex>{'y'}</Tex>，不知道裡面的係數{' '}
        <Tex>{'a'}</Tex>。資料還有雜訊。要怎麼<strong>一筆一筆地</strong>把 <Tex>{'a'}</Tex> 學出來？——答案就是 LMS。
      </div>
      <div className="ch00-tags">
        <ModelLevel level="L0" />
        <ClaimTag kind="exact" />
        <SourceTag kind="illustrative" />
        <TestBadge id="T01" />
        <TestBadge id="T02" />
      </div>
      <p className="ch00-lead">
        這是整個網站的第一課，只假設你會微積分（導數、chain rule、等比數列）。我們會先用數字手算，再推導公式，最後動手玩互動實驗。
        學完你會知道：
      </p>
      <ol className="ch00-goals">
        <li>LMS 的三個動作（預測 → 比較 → 修正）與更新公式 <Tex>{'w_{n+1}=w_n+\\mu e_nx_n'}</Tex>。</li>
        <li>為什麼更新量是 <Tex>{'e\\cdot x'}</Tex>（一次微分就能證明）。</li>
        <li>
          學習率 <Tex>{'\\mu'}</Tex> 太小、剛好、太大會發生什麼，以及 <Tex>{'0<\\mu<2/x^2'}</Tex> 從哪來。
        </li>
        <li>為什麼有雜訊還學得會（期望值與 <Tex>{'1/\\sqrt N'}</Tex>）。</li>
        <li>LMS 和 PLL / DTC 校正、SerDes 等化器、降噪耳機、AI 訓練的關係。</li>
      </ol>
      <Callout kind="info" title={null}>
        目前學習模式：<strong>{MODE_LABEL[mode]}</strong>。Beginner 只看直覺、手算與圖（推導預設收合，一鍵展開）；Engineer 預設展開推導並顯示更多程式碼與指標；
        Research 另外顯示精確有理數驗算、隨機輸入的三種穩定界限等細節。三種模式用的是同一份計算程式。
      </Callout>

      <SymbolTable
        rows={SYMBOLS}
        caption={
          <>
            <Tex>{'[y]'}</Tex>、<Tex>{'[x]'}</Tex> 表示 <Tex>{'y'}</Tex>、<Tex>{'x'}</Tex> 的單位；本章的數字例皆無因次（§0.9 的比較器例子用 fs）。全站符號總表見{' '}
            <PageLink id="formulas">Formula &amp; Unit Reference</PageLink> 頁。
          </>
        }
      />
      <ErratumNote eid="E39">
        本章所有 <Tex>{'\\delta'}</Tex> 一律為 <Tex>{'\\delta=a-w'}</Tex>（與規格 §0 一致；規格 §3 的 <Tex>{'w-a'}</Tex> 已更正）。
      </ErratumNote>

      <BlackBoxSection />
      <LoopSection />
      <UpdateFormulaSection />
      <HandCalcSection />

      <Section
        kind="explore"
        level={2}
        id="ch00-playground"
        title={
          <>
            §0.5 動手玩：<Tex>{'\\mu'}</Tex> 太小、剛好、太大
          </>
        }
      >
        <p>
          手算表只示範了 <Tex>{`\\mu=${texNum(HAND_CALC_PARAMS.mu)}`}</Tex>。下面三組比較（Case A / B / C）預設為{' '}
          <Tex>{`\\mu=${texNum(DEFAULT_MUS[0])}`}</Tex>（慢）、<Tex>{texNum(DEFAULT_MUS[1])}</Tex>（穩）、<Tex>{texNum(DEFAULT_MUS[2])}</Tex>（發散），
          <Tex>{`x=${texNum(DEFAULT_BASE.x)}`}</Tex> 時理論穩定區是 <Tex>{`0<\\mu<2/x^2=${texNum(fixedXMuMax(DEFAULT_BASE.x))}`}</Tex>（§0.6 推導）。
          每個滑桿旁都能輸入精確數字，也可以從「Preset」選單載入其他情境（一步到位、邊界、雜訊、極性錯誤）。
        </p>
        <p>
          指標表裡的 <strong>pole</strong> <Tex>{'p=1-\\mu x^2'}</Tex> 就是手算表最後一欄那個數：每走一步，參數誤差{' '}
          <Tex>{'\\delta_n=a-w_n'}</Tex> 剩下原來的 <Tex>{'p'}</Tex> 倍（手算例是 <Tex>{texNum(fixedXPole(HAND_CALC_PARAMS.mu, HAND_CALC_PARAMS.x))}</Tex>）。
          <Tex>{'|p|<1'}</Tex> 誤差才會越來越小；先動手玩，§0.6 再證明它。
        </p>
        <IntroPlayground />
      </Section>

      <WhyExSection />
      <NoiseAverageSection />
      <WhyMattersSection />
      <SignTeaserSection />
      <AssumptionsSection />
      <QuizSection />
      <RecapSection />
      <LearningMapSection />
    </div>
  )
}
