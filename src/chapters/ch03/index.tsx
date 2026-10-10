import { useMemo } from 'react'
import { Callout, ClaimTag, ModelLevel, Section, SourceTag, SymbolTable, Tex, TestBadge, type SymbolEntry } from '@/components'
import { useSettings } from '@/app/settings'
import { stabilityBounds } from '@/simulation/models/scalarStability'
import { Erratum, T, tnum, tx } from './common'
import { FixedXSection } from './sections/FixedX'
import { RandomMeanSection } from './sections/RandomMean'
import { MeanSquareSection } from './sections/MeanSquare'
import { AlmostSureSection } from './sections/AlmostSure'
import { HeavyTailSection } from './sections/HeavyTail'
import { LabSection } from './sections/LabSection'
import { CompareSection } from './sections/Compare'
import { QuizSection, RecapSection, SynthesisSection } from './sections/Wrap'
import './chapter.css'

export const SYMBOLS: SymbolEntry[] = [
  { symbol: 'a', meaning: '真實參數（例如 DTC gain 的理想值）；未知', unit: '[y]/[x]', firstSeen: '§1', note: tx`黑盒子 $y=ax$ 的斜率；正規化後無因次` },
  { symbol: 'w_n', meaning: tx`第 $n$ 個 sample 時的估計值（校正係數）`, unit: '[y]/[x]', firstSeen: '§1' },
  {
    symbol: '\\delta_n=a-w_n',
    meaning: '剩餘參數誤差',
    unit: '[y]/[x]',
    firstSeen: '§1',
    note: (
      <>
        {tx`全站極性 $a-w$；規格 §3 原寫 $w-a$（遞迴相同、數值差一個負號）`} <Erratum id="E39" /> <Erratum id="E32" />
      </>
    ),
  },
  { symbol: 'x_n', meaning: '輸入 / regressor（迴歸輸入；PLL 中為正規化 DSM / DTC code）', unit: '[x]', firstSeen: '§1', note: tx`§2 起 $x_n$ 為 iid 隨機變數` },
  { symbol: 'v_n,\\ \\sigma_v', meaning: tx`量測雜訊與其標準差（零均值、與 $x$ 獨立）`, unit: '[y]', firstSeen: '§3' },
  { symbol: 'e_n=y_n-w_nx_n', meaning: tx`預測誤差，$e_n=\delta_nx_n+v_n$`, unit: '[y]', firstSeen: '§1' },
  { symbol: '\\mu', meaning: '學習率（step size）', unit: '1/[x]^2', firstSeen: '§1', note: tx`由 $w_{n+1}=w_n+\mu e_nx_n$ 的單位推得；使 $\mu x^2$ 無因次` },
  { symbol: 'p=1-\\mu x^2', meaning: tx`固定 $x$ 時的離散 pole（極點；每步乘法因子）`, unit: '\\text{—}', firstSeen: '§1' },
  { symbol: 'f_n=1-\\mu x_n^2', meaning: tx`隨機 $x$ 時第 $n$ 步的乘法因子`, unit: '\\text{—}', firstSeen: '§2' },
  { symbol: 'E[\\cdot]', meaning: '期望值（很多次的平均）', firstSeen: '§2', note: '見 §2 先備知識' },
  { symbol: 'P_x=E[x^2]', meaning: '輸入功率（二階動差）', unit: '[x]^2', firstSeen: '§2' },
  { symbol: 'M_4=E[x^4]', meaning: '四階動差', unit: '[x]^4', firstSeen: '§2' },
  {
    symbol: '\\kappa=M_4/P_x^2',
    meaning: tx`kurtosis（峰度；$\kappa\ge1$；Gaussian 3、Uniform $9/5$、$\pm A$ 為 1）`,
    unit: '\\text{—}',
    firstSeen: '§2',
    note: tx`本章用「對原點」的動差比 $E[x^4]/E[x^2]^2$；$x$ 零均值時就是一般的 kurtosis，$x$ 有 DC 偏移時不同（見 §2）。Kesten 尾指數另記為 $\kappa_t$`,
  },
  { symbol: 'g(\\mu)=E[(1-\\mu x^2)^2]', meaning: 'MSD 每步因子', unit: '\\text{—}', firstSeen: '§3' },
  {
    symbol: 'E[\\delta_n^2]',
    meaning: tx`係數均方偏差 MSD（不是 MSE 成本 $E[e^2]$）`,
    unit: '([y]/[x])^2',
    firstSeen: '§3',
    note: <Erratum id="E42" />,
  },
  {
    symbol: '\\lambda(\\mu)=E\\ln|1-\\mu x^2|',
    meaning: 'Lyapunov 指數（典型路徑每步的平均對數縮放率）',
    unit: '\\text{nat/sample}',
    firstSeen: '§4',
    note: tx`本章 $\lambda$ 專指 Lyapunov 指數（勘誤 E14 的第三種收斂）；第 9–10 章的 $\lambda_i$ 是 $\mathbf R$ 的 eigenvalue，兩者無關`,
  },
  { symbol: '\\mu_\\text{mean},\\ \\mu_\\text{MS},\\ \\mu_\\text{as}', meaning: '三種意義下的穩定上限', unit: '1/[x]^2', firstSeen: '§2–§4' },
  { symbol: 'h(\\mu)=E[(1-\\mu x^2)^4]', meaning: tx`$\delta^4$ 的每步因子（算 heavy tail／厚尾下的真實 SE）`, unit: '\\text{—}', firstSeen: '§5' },
  { symbol: '\\kappa_t', meaning: 'Kesten 尾指數（有雜訊時穩態分布的冪次尾；研究層級）', unit: '\\text{—}', firstSeen: '§4' },
  { symbol: 's^2=\\operatorname{Var}(\\ln|1-\\mu x^2|)', meaning: tx`log 域每步增量 $\ln|f_n|$ 的變異數；分位帶寬度 $\propto s\sqrt n$`, unit: '\\text{nat}^2/\\text{sample}', firstSeen: '§5' },
  { symbol: '\\Phi(z),\\ z_p=\\Phi^{-1}(p)', meaning: '標準常態的累積分布函數（CDF）與它的反函數（分位點）', unit: '\\text{—}', firstSeen: '§5', note: '見 §5 先備知識' },
  { symbol: 'n', meaning: 'sample 索引（每個 sample 更新一次）', unit: '\\text{sample}', firstSeen: '§1', note: tx`§8 的 block 索引用 $k$` },
  { symbol: 'N', meaning: '步數（實驗）或 GMAC 每個 block 的累加筆數（§8）', unit: '\\text{—}', firstSeen: '§6' },
]

function Roadmap() {
  const go = (id: string) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const items: [string, string][] = [
    ['fixed-x', '1｜固定輸入：等比數列與 pole'],
    ['random-mean', '2｜隨機輸入：平均（mean）'],
    ['mean-square', '3｜均方（MSD）與雜訊'],
    ['almost-sure', '4｜幾乎每條路徑（almost-sure）'],
    ['heavy-tail', '5｜Heavy tail（厚尾）與正確的 Monte Carlo 驗證'],
    ['lab', '6｜Stability Lab'],
    ['compare', '7｜總整理與核心程式碼'],
    ['pll', '8｜連到 PLL'],
    ['synthesis', '綜合手算（代入你自己的數字）'],
    ['quiz', '思考題與本課必記'],
  ]
  return (
    <ol className="ch03-roadmap">
      {items.map(([id, label]) => (
        <li key={id}>
          <button type="button" className="ch03-toc" onClick={go(id)}>
            {label}
          </button>
        </li>
      ))}
    </ol>
  )
}

export default function Chapter03() {
  const { mode } = useSettings()
  const gb = useMemo(() => stabilityBounds({ kind: 'gaussian', sigma: 1 }), [])
  return (
    <div className="ch03">
      <p className="ch03-lead">
        這一課要回答：<strong>LMS 什麼時候會收斂？</strong>固定輸入時答案是一個等比數列，乾淨俐落；輸入變成隨機以後，「收斂」突然有了<strong>三種不同的意思</strong>，
        而且它們的界限可以差好幾倍。我們會一路從高中的 <Tex>{T`r^n\to0`}</Tex> 推到 Lyapunov 指數，並用 Monte Carlo 親眼看到「均方發散、但每條路徑都收斂」。
      </p>
      <div className="ch03-tags">
        <ModelLevel level="L0" />
        <ClaimTag kind="exact" />
        <SourceTag kind="illustrative" />
        <TestBadge id="T02" />
        <TestBadge id="T03" />
        <Erratum id="E14" />
        <Erratum id="E38" />
        <Erratum id="E39" />
        <Erratum id="E42" />
      </div>
      <SymbolTable
        rows={SYMBOLS}
        caption={tx`$[x]$、$[y]$ 代表輸入與輸出的單位（硬體中 $x$ 是 DSM / DTC code、$y$ 是時間誤差，單位依 scaling；例如 $x$ 無因次、$y$ 為 fs 時 $a,w,\delta$ 的單位就是 fs）。$\mu$ 的單位是 $1/[x]^2$，使 $\mu x^2$ 無因次。實驗中所有量皆已正規化。全站符號總表見 Formula & Unit Reference 頁。`}
      />

      <Section kind="intuition" title={tx`先看結論：標準 Gaussian $x\sim\mathcal N(0,1)$ 的三個界限`}>
        <div className="ch03-trio">
          <div className="ch03-trio-card">
            <h4>Mean（平均）</h4>
            <div className="ch03-trio-num">
              <Tex>{T`0<\mu<${tnum(gb.meanMax)}`}</Tex>
            </div>
            <div className="small muted">
              <Tex>{T`E[\delta_n]\to0`}</Tex>：偏差消失，但正負可以互相抵消
            </div>
          </div>
          <div className="ch03-trio-card">
            <h4>Mean-square（MSD）</h4>
            <div className="ch03-trio-num">
              <Tex>{T`0<\mu<${tnum(gb.msMax)}\ (=\tfrac23)`}</Tex>
            </div>
            <div className="small muted">
              <Tex>{T`E[\delta_n^2]\to0`}</Tex>：RMS 有限，有雜訊時穩態 MSD 有限
            </div>
          </div>
          <div className="ch03-trio-card">
            <h4>Almost-sure（路徑）</h4>
            <div className="ch03-trio-num">
              <Tex>{T`0<\mu<${tnum(gb.asMax, 5)}`}</Tex>
            </div>
            <div className="small muted">
              <Tex>{T`|\delta_n|\to0`}</Tex>（機率 1）：你看到的那條軌跡會收斂 <Erratum id="E14" />
            </div>
          </div>
        </div>
        <p>
          規格 §3.1 只區分 mean 與 mean-square；本站依勘誤 E14 補上第三種（樣本路徑）收斂，否則你在互動圖上看到 <Tex>{T`\mu=0.8`}</Tex> 的路徑收斂時，會以為{' '}
          <Tex>{T`2/3`}</Tex> 的公式錯了。三個數字都由 <code>stabilityBounds</code> 即時計算（mean 與 MS 為封閉式，almost-sure 為數值積分求根）。
        </p>
        <Roadmap />
        <p>
          <strong>帶入手算：</strong>每一段推導的後面都有一題「帶入手算」（HC-03.1–HC-03.8）。把數字換成你自己的，先用紙筆和一般的工程計算機算，再和網站一步一步對照——
          每個等號只做一種運算（中間結果都寫出來，照著畫面上的數字就能按出下一個數），需要 <Tex>{T`\ln`}</Tex>、<Tex>{T`\sqrt{\ }`}</Tex> 或查 <Tex>{T`\Phi(z)`}</Tex> 表的地方都會說明怎麼做；
          很小的 <Tex>\mu</Tex>（例如 <Tex>{T`10^{-6}`}</Tex>）或很多位的小數也可以直接打進去。
        </p>
        <Callout kind="info" title={`目前是 ${mode === 'beginner' ? 'Beginner' : mode === 'engineer' ? 'Engineer' : 'Research'} 模式`}>
          Beginner：直覺、手算、圖與思考題，逐步推導預設收合（一鍵展開）。Engineer：推導、假設、單位與程式碼預設展開。Research：另外顯示 Kesten heavy tail、Dawson 形式、Monte Carlo 細節與文獻。
          三種模式共用同一個計算核心（<code>src/simulation/models/scalarStability.ts</code> 與 <code>lms.ts</code>）。
        </Callout>
      </Section>

      <FixedXSection />
      <RandomMeanSection />
      <MeanSquareSection />
      <AlmostSureSection />
      <HeavyTailSection />
      <LabSection />
      <CompareSection />
      <SynthesisSection />
      <QuizSection />
      <RecapSection />
    </div>
  )
}
