import { useMemo } from 'react'
import { Callout, ClaimTag, Mermaid, Section, SourceTag, SymbolTable, Tex, type SymbolEntry } from '@/components'
import { normPdf } from '@/simulation/core'
import { directionOutcomeExact, meanQ, pPlus, sumMoments, varQ } from '@/simulation/models/comparator'
import { Erratum, fx, int, sig } from '../common'
import { ExpectationPrereq, GaussianPrereq } from './Probability'

const T = (tex: string) => <Tex>{tex}</Tex>

const SYMBOLS: SymbolEntry[] = [
  {
    symbol: 's',
    meaning: '要辨識正負號的固定誤差（PLL 中是 DTC residual 在 PD 處的時間誤差）',
    unit: '\\mathrm{fs}',
    firstSeen: '§2',
    note: <>本章 regressor {T('x\\equiv1')}，所以 {T('s=\\delta=a-w')}（全站約定 {T('\\delta=a-w')}）</>,
  },
  {
    symbol: 'v,\\;\\sigma_v',
    meaning: 'comparator 前的 Gaussian 雜訊與其 RMS',
    unit: '\\mathrm{fs}',
    firstSeen: '§2',
    note: <>{T('v\\sim\\mathcal N(0,\\sigma_v^2)')}，iid（時間相關的情形見章末 Research 延伸）</>,
  },
  {
    symbol: '\\theta',
    meaning: 'comparator threshold／offset',
    unit: '\\mathrm{fs}',
    firstSeen: '§2',
    note: <>硬體慣例 {T('e\\ge\\theta\\Rightarrow q=+1')}（規格 §15.2）；理想 {T('\\theta=0')}</>,
  },
  { symbol: 'e=s+v', meaning: 'comparator 輸入', unit: '\\mathrm{fs}', firstSeen: '§2' },
  {
    symbol: 'x',
    meaning: 'regressor（DTC code／相位選擇等，乘在誤差上的已知訊號）',
    firstSeen: '§0',
    note: <>本章固定 {T('x\\equiv1')}；一般情形留到 Ch06–Ch11</>,
  },
  { symbol: 'b', meaning: '硬體 comparator 輸出的 0/1 位元', unit: '0/1', firstSeen: '§2', note: <>{T('q=2b-1')}</> },
  {
    symbol: 'q',
    meaning: '1-bit comparator 的雙極性輸出',
    unit: '\\pm1',
    firstSeen: '§2',
    note: <>硬體 0/1 位元 {T('b')} 必須先映射 {T('q=2b-1')}（規格 §0）</>,
  },
  { symbol: 'p', meaning: T('P(q=+1)'), firstSeen: '§2', note: <>本章 {T('p')} 專指機率；Ch12/Ch14 的迴路 pole 本章改寫 {T('p_{\\mathrm{cal}}')}</> },
  {
    symbol: 'm\\;(\\equiv m_q)',
    meaning: <>{T('E[q]')}，單一樣本的平均（「訊號」）</>,
    firstSeen: '§2',
    note: (
      <>
        全站符號表寫作 {T('m_q')}，以免與 §12 的 code DC 衝突；本章只有這一個 {T('m')}，公式中簡寫成 {T('m')}，兩者是同一個量 <Erratum id="E34" />
      </>
    ),
  },
  { symbol: 'r', meaning: <>標準化誤差 {T('(s-\\theta)/\\sigma_v')}</>, firstSeen: '§2' },
  { symbol: '\\Phi,\\;\\varphi', meaning: '標準常態分布的 CDF 與 PDF', firstSeen: '§2' },
  { symbol: '\\operatorname{erf}', meaning: 'error function', firstSeen: '§2' },
  { symbol: 'N', meaning: '累加的樣本數（comparator 決策次數）', unit: '\\text{samples}', firstSeen: '§3', note: <>時間索引 {T('n')} = comparator sample</> },
  {
    symbol: 'K',
    meaning: <>{T('N')} 個樣本中 {T('q=+1')} 的個數，{T('K\\sim\\mathrm{Bin}(N,p)')}</>,
    firstSeen: '§3',
    note: <>本章 {T('K')} 只代表計數（勘誤 E02 的寫法），與 §8/§12 的迴路增益 {T('K=K_qC')} 無關</>,
  },
  {
    symbol: 'S_N',
    meaning: <>comparator 輸出的總和 {T('\\sum_i q_i=2K-N')}</>,
    firstSeen: '§3',
    note: (
      <>
        規格 §5 原寫 {T('G_N')}；本章改用 {T('S_N')}，保留 {T('G')} 給 §0 的 block 平均 <Erratum id="E07" /> <Erratum id="E18" />
      </>
    ),
  },
  {
    symbol: 'G=S_N/N',
    meaning: <>平均（§0 的 {T('G_k=\\frac1N\\sum qx')} 在 {T('x\\equiv1')} 時）</>,
    firstSeen: '§3',
    note: <>sum 與 average 差 {T('N')} 倍</>,
  },
  { symbol: '\\sigma_S', meaning: <>{T('S_N')} 的標準差 {T('\\mathrm{SD}(S_N)=\\sqrt{N(1-m^2)}')}</>, firstSeen: '§3.2' },
  { symbol: '\\mathrm{SNR}_{\\mathrm{stat}}', meaning: <>統計 SNR {T('=E[S_N]/\\mathrm{SD}(S_N)')}</>, firstSeen: '§3' },
  { symbol: 'z', meaning: <>{T('\\Phi^{-1}(P_{\\text{target}})')}，例如 95% → 1.645</>, firstSeen: '§4' },
  { symbol: 'K_q', meaning: <>comparator 的小訊號統計增益 {T('dE[q]/ds')}</>, unit: '\\mathrm{fs}^{-1}', firstSeen: '§5' },
  {
    symbol: 'd_k,\\;s^*',
    meaning: <>只取 {T('S_N')} 正負號的硬體決策 {T('d_k\\in\\{+1,-1,0\\}')}，與其迴路平衡點 {T('s^*')}</>,
    unit: '\\mathrm{fs}',
    firstSeen: '§3.4（Engineer）',
    note: <>{T('s^*')} 的單位是 fs；{T('d_k')} 無因次</>,
  },
  { symbol: 'T', meaning: 'Monte Carlo 的獨立 trials 數', firstSeen: '§6（實驗）', note: <>與全站的 closed-loop {T('T=L/(1+L)')} 無關</> },
  {
    symbol: 'k,\\;\\hat P',
    meaning: <>Monte Carlo 中判對的次數，與估計的判對率 {T('\\hat P=k/T')}</>,
    firstSeen: '§6（實驗）',
    note: <>{T('k')} 在 §9 另作 GMAC block 索引、在 §7 作格點編號，依上下文區分</>,
  },
  {
    symbol: 'k_{\\mathrm{lo}},\\;k_{\\mathrm{hi}}',
    meaning: <>MC 計數的接受域（精確 Binomial 每側尾機率 {T('<\\Phi(-4)')}）</>,
    firstSeen: '§6（實驗）',
    note: 'Analytic ↔ Monte Carlo 交叉比對的判準',
  },
  { symbol: 'a,\\;w', meaning: '理想係數與目前的校正係數', unit: '\\mathrm{fs}', firstSeen: '§7', note: <>{T('x\\equiv1')} 時 {T('s=a-w')}</> },
  {
    symbol: '\\delta=a-w',
    meaning: '剩餘參數誤差',
    unit: '\\mathrm{fs}',
    firstSeen: '§7',
    note: <>全站約定 {T('\\delta=a-w')}（不是 {T('w-a')}）</>,
  },
  {
    symbol: '\\mu',
    meaning: '學習率（每次更新的步長）',
    unit: '\\mathrm{fs}',
    firstSeen: '§7',
    note: (
      <>
        §7 為逐 sample 更新（等於 {T('N=1')} 的 block）；§9 為 average-mode GMAC 的 block 更新，單位同為 fs。規格／ChatGPT 課程中的 {T('\\alpha')} 本站一律寫{' '}
        {T('\\mu')} <Erratum id="E13" /> <Erratum id="E34" />
      </>
    ),
  },
  {
    symbol: 'g=\\mu K_q',
    meaning: <>無因次的 normalized loop gain（{T('x\\equiv1')} 時 {T('C=1')}，所以 {T('K=K_q')}）</>,
    firstSeen: '§7',
    note: <>一般情形 {T('g=\\mu K_qC')}</>,
  },
  { symbol: 'p_{\\mathrm{cal}}=1-g', meaning: '校正迴路的（線性化）pole', firstSeen: '§9', note: <>Ch12/Ch14 寫作 {T('p')}</> },
  { symbol: '\\eta', meaning: <>{T('q')} 或 {T('G_k')} 扣掉平均後的零均值「量化雜訊」</>, firstSeen: '§7' },
  {
    symbol: '\\tau',
    meaning: <>迴路的時間常數 {T('\\approx1/g')}（精確 {T('-1/\\ln|1-g|')}）</>,
    unit: '\\text{samples / blocks}',
    firstSeen: '§7',
    note: '§7 逐 sample 更新時單位是 samples；§9 block 更新時是 blocks',
  },
  {
    symbol: 'w_k,\\;u_k,\\;\\bar u_k,\\;\\pi_k',
    meaning: <>§7 的格點 {T('w_k=w_0+k\\mu')}、往上／往下一步的機率、穩態（時間平均）機率</>,
    firstSeen: '§7（Engineer）',
    note: <>{T('E_\\pi[\\cdot]')} 表示以 {T('\\pi_k')} 加權的平均</>,
  },
  { symbol: '\\sigma_w', meaning: '收斂後係數的穩態 RMS（coefficient noise）', unit: '\\mathrm{fs}', firstSeen: '§9' },
  {
    symbol: 'C',
    meaning: <>regressor 與誤差路徑輸出的相關量（一般情形 {T('K=K_qC')}）</>,
    firstSeen: '§9',
    note: <>本章 {T('x\\equiv1')}，所以 {T('C=1')}；Ch06 詳述</>,
  },
  {
    symbol: 'f_s,\\;f_u',
    meaning: <>comparator 取樣率與 GMAC 更新率 {T('f_u=f_s/N')}</>,
    unit: '\\mathrm{Hz}',
    firstSeen: '§9',
    note: <>{T('f_s')} 不保證等於 {T('f_{\\mathrm{ref}}')}（規格 §0）</>,
  },
  {
    symbol: '\\rho,\\;N_{\\mathrm{eff}}',
    meaning: <>雜訊相鄰樣本的相關係數，與等效獨立樣本數</>,
    firstSeen: '章末延伸（Research）',
    note: '只在 Research 模式出現',
  },
]

/** 開場：問題、方塊圖、符號表、先算一次。 */
export function IntroSection() {
  const ex = useMemo(() => {
    const s = 1
    const sigma = 100
    const r = s / sigma
    const p = pPlus(s, sigma)
    const pTaylor = 0.5 + r * normPdf(0)
    const m = meanQ(s, sigma)
    const rows = [1, 101, 10001, 1000001].map((N) => ({ N, ...sumMoments(N, m), correct: directionOutcomeExact(p, N, 'strict').correct }))
    // 「偏一點點的硬幣」：擲 100 次與 100 萬次時，正面比反面多幾次（平均）與運氣造成的起伏（SD）
    const coin = [100, 1_000_000].map((N) => ({ N, ...sumMoments(N, m) }))
    return { r, p, pTaylor, m, v: varQ(m), rows, coin }
  }, [])

  return (
    <>
      <Callout kind="info" title="這次我們要回答的問題">
        <p className="ch05-question">
          PLL 裡的 DTC gain 還差一點點，造成 <Tex>{String.raw`s=1\,\mathrm{fs}`}</Tex> 的時間誤差；但 PD 前面的雜訊有{' '}
          <Tex>{String.raw`\sigma_v=100\,\mathrm{fs}`}</Tex> RMS。Bang-bang PD（1-bit comparator）每次只告訴你「早」或「晚」（
          <Tex>{'q=\\pm1'}</Tex>）。<strong>單一次的 <Tex>{'q'}</Tex> 幾乎就是擲硬幣，那方向資訊到底還在不在？要累加幾次才看得出來？</strong>
        </p>
      </Callout>

      <SymbolTable
        rows={SYMBOLS}
        caption={
          <>
            時間索引：<Tex>{'n'}</Tex> = comparator sample；<Tex>{'k'}</Tex> = GMAC block（本章只用到 <Tex>{'n'}</Tex>）。所有時間量預設{' '}
            <Tex>{'\\mathrm{fs}'}</Tex>。
          </>
        }
      />

      <Section kind="intuition" level={2} title="直覺：一枚只偏一點點的硬幣">
        <p>
          想像一枚被動過手腳的硬幣：正面的機率是 {fx(100 * ex.p, 2)}%、反面 {fx(100 * (1 - ex.p), 2)}%。擲<strong>一次</strong>，你完全看不出它偏哪一邊。擲{' '}
          {int(ex.coin[0].N)} 次，正面平均只比反面多 {fx(ex.coin[0].meanSum, 1)} 次，可是「運氣」造成的起伏有 <Tex>{'\\pm'}</Tex>
          {fx(ex.coin[0].sdSum, 0)} 次左右——還是看不出來。但是擲 {int(ex.coin[1].N)} 次，正面平均多出 {int(ex.coin[1].meanSum)} 次，運氣的起伏只有{' '}
          <Tex>{'\\pm'}</Tex>
          {int(ex.coin[1].sdSum)} 次：偏向一清二楚。
        </p>
        <p>
          1-bit comparator 就是這枚硬幣。誤差 <Tex>{'s'}</Tex> 決定「偏多少」，雜訊 <Tex>{'\\sigma_v'}</Tex> 決定「有多像公平硬幣」。本章要算的三件事：
          <strong>① 偏多少</strong>（<Tex>{'P(q=+1)'}</Tex> 與 <Tex>{'E[q]'}</Tex>，§2）、<strong>② 要擲幾次才看得出來</strong>（<Tex>{'N'}</Tex>，§3–§4）、
          <strong>③ 這個「偏」和誤差成正比的比例常數</strong>（<Tex>{'K_q'}</Tex>，§5）。上面這些數字就是用{' '}
          <Tex>{String.raw`s=1\,\mathrm{fs},\ \sigma_v=100\,\mathrm{fs}`}</Tex> 由本站模擬核心算出來的。<SourceTag kind="illustrative" />
        </p>
      </Section>

      <Section kind="diagram" level={2} title="0. 模型：一個固定誤差 + 雜訊 → 1-bit → 累加">
        <Mermaid
          chart={[
            'flowchart LR',
            '  S["固定誤差 s（fs）"] --> ADD(("+"))',
            '  V["雜訊 v ~ N(0, σ_v²)"] --> ADD',
            '  ADD -->|"e = s + v"| CMP["Comparator（threshold θ）"]',
            '  CMP -->|"q = ±1"| ACC["累加器 S_N = Σ q_i"]',
            '  ACC -->|"sign(S_N)，S_N = 0 時依 tie rule"| DEC["方向判斷"]',
          ].join('\n')}
          caption="本章的 L1 模型：s 固定、v iid Gaussian、x ≡ 1（regressor 的效果留到 Ch06–Ch11）"
          ariaLabel="固定誤差加雜訊經過 comparator 輸出正負一，累加後判斷方向"
        />
        <p>
          這是 PLL 校正迴路（Ch04）裡「PD → GMAC」那一段的最小模型：把 regressor 固定成 <Tex>{'x\\equiv1'}</Tex>，問題就只剩下「
          <strong>一個很小的偏移，經過 1-bit 量化之後，平均還保留多少？</strong>」。之後章節的 <Tex>{'K_q'}</Tex>、loop gain、
          noise 全部從這裡出發。方塊圖中的 <Tex>{'s'}</Tex>、<Tex>{'v\\sim\\mathcal N(0,\\sigma_v^2)'}</Tex>、<Tex>{'e=s+v'}</Tex>、
          <Tex>{'q=\\pm1'}</Tex>、<Tex>{'S_N=\\sum_{i=1}^{N}q_i'}</Tex> 的定義見章首的符號表。
        </p>
      </Section>

      <Section
        kind="example"
        level={2}
        title={
          <>
            1. 先算一次：<Tex>{String.raw`s=1\,\mathrm{fs},\;\sigma_v=100\,\mathrm{fs}`}</Tex>
          </>
        }
      >
        <p>
          先不推導，直接用數字感受一下（所有數字都由本站的模擬核心即時計算）。<SourceTag kind="illustrative" /> 表中用到的{' '}
          <Tex>{'\\Phi,\\ \\varphi'}</Tex>、期望值 <Tex>{'E[\\cdot]'}</Tex> 與變異數 <Tex>{'\\operatorname{Var}(\\cdot)'}</Tex> 若不熟，先展開下面兩個先備知識框（§2 會再一步一步推導每一列）。
        </p>
        <GaussianPrereq />
        <ExpectationPrereq />
        <div className="table-wrap">
          <table className="ch05-table">
            <thead>
              <tr>
                <th>步驟</th>
                <th>算式</th>
                <th className="num">數值</th>
                <th>白話</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>① 標準化</td>
                <td>
                  <Tex>{'r=s/\\sigma_v'}</Tex>
                </td>
                <td className="num">{sig(ex.r)}</td>
                <td>誤差只有雜訊的 1%</td>
              </tr>
              <tr>
                <td>② 輸出 +1 的機率</td>
                <td>
                  <Tex>{String.raw`p=\Phi(0.01)\approx\tfrac12+0.01\,\varphi(0)`}</Tex>
                </td>
                <td className="num">
                  {fx(ex.pTaylor, 8)}（泰勒）
                  <br />
                  {fx(ex.p, 8)}（精確）
                </td>
                <td>
                  比 50% 多 {fx(100 * (ex.p - 0.5), 4)} 個百分點 <ClaimTag kind="exact" />
                </td>
              </tr>
              <tr>
                <td>
                  ③ 輸出 <Tex>{'-1'}</Tex> 的機率
                </td>
                <td>
                  <Tex>{'1-p'}</Tex>
                </td>
                <td className="num">{fx(1 - ex.p, 8)}</td>
                <td>單次幾乎是擲硬幣</td>
              </tr>
              <tr>
                <td>④ 平均輸出</td>
                <td>
                  <Tex>{'m=E[q]=2p-1'}</Tex>
                </td>
                <td className="num">{fx(ex.m, 8)}</td>
                <td>不是 0！方向資訊就藏在這裡</td>
              </tr>
              <tr>
                <td>⑤ 單次的雜訊</td>
                <td>
                  <Tex>{'\\operatorname{Var}(q)=1-m^2'}</Tex>
                </td>
                <td className="num">{fx(ex.v, 8)}</td>
                <td>每次的「雜訊功率」幾乎是滿的 1</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          單一樣本的訊號雜訊比只有 <Tex>{`m/\\sqrt{1-m^2}\\approx${fx(ex.m / Math.sqrt(ex.v), 5)}`}</Tex>：雜訊大約是訊號的{' '}
          {int(Math.sqrt(ex.v) / ex.m)} 倍。可是把 <Tex>{'N'}</Tex> 個 <Tex>{'q'}</Tex> 加起來，
          <strong>
            訊號 <Tex>{'Nm'}</Tex> 隨 <Tex>{'N'}</Tex> 線性成長，雜訊只隨 <Tex>{'\\sqrt N'}</Tex> 成長
          </strong>
          ：
        </p>
        <div className="table-wrap">
          <table className="ch05-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'N'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'E[S_N]=Nm'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'\\mathrm{SD}=\\sqrt{N(1-m^2)}'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'\\mathrm{SNR}_{\\mathrm{stat}}'}</Tex>
                </th>
                <th className="num">
                  精確 <Tex>{'P(\\text{判對})=P(S_N>0)'}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {ex.rows.map((r) => (
                <tr key={r.N}>
                  <td className="num">{int(r.N)}</td>
                  <td className="num">{sig(r.meanSum, 5)}</td>
                  <td className="num">{sig(r.sdSum, 5)}</td>
                  <td className="num">{fx(r.snr, 4)}</td>
                  <td className="num">{fx(100 * r.correct, 2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ch05-note">
          表中 <Tex>{'N'}</Tex> 都取奇數，所以 <Tex>{'S_N'}</Tex> 不可能等於 0、沒有平手（tie）的問題；偶數 <Tex>{'N'}</Tex> 的陷阱留到 §3 再談。
          <Erratum id="E02" />
        </p>
        <Callout kind="ok" title="第一個結論">
          1-bit 量化並沒有把 <Tex>{'1\\,\\mathrm{fs}'}</Tex> 的資訊「丟掉」，只是把它變成{' '}
          <Tex>{`p-\\tfrac12\\approx${fx(100 * (ex.p - 0.5), 3)}\\%`}</Tex> 的機率偏差；需要很多樣本才能把它從雜訊裡平均出來。
          <ClaimTag kind="exact" />（指定模型：<Tex>{'s'}</Tex> 固定、<Tex>{'v'}</Tex> iid Gaussian）
        </Callout>
      </Section>
    </>
  )
}
