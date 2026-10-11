import { useMemo, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import { Callout, ClaimTag, ModeGate, Plot, Prereq, Section, SelectControl, Tex, TexBlock, useThemeTokens } from '@/components'
import {
  TIE_RULE_LABEL,
  TIE_RULES,
  berryEsseenBound,
  directionCltPlain,
  directionExact,
  directionOutcomeClt,
  directionOutcomeExact,
  meanQ,
  minNForTarget,
  pPlus,
  samplesForConfidence,
  sumMoments,
  tieProbStirling,
  tieRuleEquilibrium,
  tieRuleEquilibriumApprox,
  type TieRule,
} from '@/simulation/models/comparator'
import { Erratum, Fig, HandCalcBlock, Steps, fx, int, logspace, pct, sig, texInt, texPct, useAtLeast, vline } from '../common'

const S0 = 1
const SIG0 = 100

/** 先備知識：獨立隨機變數的和、Binomial、CLT。 */
function SumPrereqs() {
  return (
    <>
      <Prereq title="獨立隨機變數相加：平均相加、變異數也相加">
        <p>
          兩個隨機變數 <Tex>{'X,Y'}</Tex>（平均 <Tex>{'\\mu_X,\\mu_Y'}</Tex>）。<strong>獨立</strong>的意思是「知道一個不會改變另一個的機率」，
          因而 <Tex>{'E[XY]=E[X]E[Y]'}</Tex>。
        </p>
        <Steps
          title={
            <>
              <Tex>{String.raw`\operatorname{Var}(X+Y)=\operatorname{Var}(X)+\operatorname{Var}(Y)`}</Tex>（獨立時）
            </>
          }
          steps={[
            { tex: String.raw`\operatorname{Var}(X+Y)=E\big[(X-\mu_X+Y-\mu_Y)^2\big]`, why: <>定義；<Tex>{'X+Y'}</Tex> 的平均是 <Tex>{'\\mu_X+\\mu_Y'}</Tex>（期望值線性）。</> },
            { tex: String.raw`=E\big[(X-\mu_X)^2\big]+E\big[(Y-\mu_Y)^2\big]+2E\big[(X-\mu_X)(Y-\mu_Y)\big]`, why: <>展開平方 <Tex>{'(A+B)^2=A^2+B^2+2AB'}</Tex>，再用線性。</> },
            { tex: String.raw`E\big[(X-\mu_X)(Y-\mu_Y)\big]=E[X-\mu_X]\,E[Y-\mu_Y]=0\cdot0`, why: <>獨立時，乘積的期望等於期望的乘積；而 <Tex>{'E[X-\\mu_X]=0'}</Tex>。</> },
            { tex: String.raw`\operatorname{Var}(X+Y)=\operatorname{Var}(X)+\operatorname{Var}(Y)`, why: '交叉項消失。$N$ 個獨立變數同理（兩兩交叉項都是 0）。' },
          ]}
        />
        <p>
          另外常用：<Tex>{'\\operatorname{Var}(cX)=c^2\\operatorname{Var}(X)'}</Tex>（常數提出來要平方）。所以「平均」<Tex>{'G=S_N/N'}</Tex> 的變異數是
          總和的 <Tex>{'1/N^2'}</Tex>。
        </p>
      </Prereq>
      <Prereq title="Binomial 分布：$N$ 次獨立的「成功／失敗」中成功幾次">
        <p>
          每次以機率 <Tex>{'p'}</Tex> 成功、彼此獨立，<Tex>{'N'}</Tex> 次中剛好 <Tex>{'k'}</Tex> 次成功的機率是「選哪 <Tex>{'k'}</Tex> 次」的組合數乘上每種排列的機率：
        </p>
        <TexBlock>{String.raw`P(K=k)=\binom{N}{k}p^k(1-p)^{N-k},\qquad \binom Nk=\frac{N!}{k!\,(N-k)!},\qquad E[K]=Np,\;\operatorname{Var}(K)=Np(1-p)`}</TexBlock>
        <p>
          這裡的「成功」就是 comparator 輸出 <Tex>{'+1'}</Tex>。<Tex>{'K'}</Tex> 只能是整數，所以 <Tex>{'S_N=2K-N'}</Tex> 也只能取間隔為 2 的值（格點，lattice）。
        </p>
      </Prereq>
      <Prereq title={String.raw`中央極限定理（CLT）：很多獨立小量的和 $\approx$ Gaussian`}>
        <p>
          若 <Tex>{'q_1,\\dots,q_N'}</Tex> 獨立同分布、平均 <Tex>{'m'}</Tex>、變異數 <Tex>{'\\sigma_q^2'}</Tex>，則標準化後的和{' '}
          <Tex>{String.raw`\frac{S_N-Nm}{\sqrt N\,\sigma_q}`}</Tex> 在 <Tex>{'N'}</Tex> 大時分布趨近 <Tex>{'\\mathcal N(0,1)'}</Tex>。
          它是<strong>近似</strong>：<Tex>{'N'}</Tex> 有限時有誤差（Berry–Esseen 定理給上界，見 Research 模式的 §3.5），而且 <Tex>{'S_N'}</Tex> 是離散格點，
          <Tex>{'S_N>0'}</Tex> 與 <Tex>{'S_N\\ge0'}</Tex> 在偶數 <Tex>{'N'}</Tex> 會差一個 tie 的機率 <Tex>{'P(S_N=0)'}</Tex>。
        </p>
      </Prereq>
    </>
  )
}

/** §3：N 次累加——S_N、SNR、精確 vs CLT、tie。 */
export function AccumulationSection() {
  const tokens = useThemeTokens()
  const [rule, setRule] = useState<TieRule>('strict')
  const base = useMemo(() => {
    const p = pPlus(S0, SIG0)
    const m = meanQ(S0, SIG0)
    const mo = sumMoments(10000, m)
    const nOdd95 = minNForTarget(p, 0.95, 'odd') ?? NaN
    const nOdd99 = minNForTarget(p, 0.99, 'odd') ?? NaN
    const oddRows = [101, 1001, 10001, nOdd95, nOdd99].map((N) => ({
      N,
      exact: directionOutcomeExact(p, N, 'strict').correct,
      clt: directionCltPlain(m, N),
    }))
    const evenRows = [100, 1000, 10000].map((N) => {
      const d = directionExact(p, N)
      return {
        N,
        d,
        clt: directionCltPlain(m, N),
        byRule: Object.fromEntries(TIE_RULES.map((r) => [r, directionOutcomeExact(p, N, r)])) as Record<TieRule, ReturnType<typeof directionOutcomeExact>>,
        cltCorr: directionOutcomeClt(m, N, 'strict').correct,
      }
    })
    const cross = (1 - m * m) / (m * m)
    const Ns = logspace(1, 1e7, 61)
    const be = [10, 100, 101, 1000, 10000].map((N) => ({
      N,
      bound: berryEsseenBound(m, N),
      err: Math.abs(directionCltPlain(m, N) - directionOutcomeExact(p, N, 'strict').correct),
    }))
    const eq = [100, 1000, 4096].map((N) => ({
      N,
      plus: tieRuleEquilibrium(N, SIG0, 'plus'),
      strict: tieRuleEquilibrium(N, SIG0, 'strict'),
      half: tieRuleEquilibrium(N, SIG0, 'half'),
      approx: Math.abs(tieRuleEquilibriumApprox(N, SIG0, 'plus')), // 1/(N K_q)：與手算題 HC-05.5 同一個函式
    }))
    const tieApprox = [100, 1000, 10000].map((N) => ({
      N,
      exact: directionExact(p, N).tie,
      approx: tieProbStirling(m, N), // √(2/(πN))·e^{−Nm²/2}：與手算題 HC-05.5 同一個函式
    }))
    return {
      p,
      m,
      mo,
      oddRows,
      evenRows,
      cross,
      Ns,
      be,
      eq,
      nOdd95,
      nOdd99,
      nEvenHalf95: minNForTarget(p, 0.95, 'even', 'half') ?? NaN,
      nEvenStrict95: minNForTarget(p, 0.95, 'even', 'strict') ?? NaN,
      nClt95: samplesForConfidence(m, 0.95),
      nClt99: samplesForConfidence(m, 0.99),
      n2half: directionOutcomeExact(p, 2, 'half').correct,
      tieApprox,
    }
  }, [])

  const snrData = useMemo<Data[]>(
    () => [
      { x: base.Ns, y: base.Ns.map((N) => N * base.m), name: '訊號 E[S_N] = N m（斜率 1）', mode: 'lines', line: { color: tokens.series[0] } },
      {
        x: base.Ns,
        y: base.Ns.map((N) => Math.sqrt(N * (1 - base.m * base.m))),
        name: '雜訊 SD(S_N) = √(N(1−m²))（斜率 ½）',
        mode: 'lines',
        line: { color: tokens.series[1], dash: 'dash' },
      },
    ],
    [base, tokens],
  )

  const n100 = base.evenRows[0]

  // HC-05.5 用到的兩個公式，推導分別在 §3.4（Engineer 以上）與 §3.5（Research）：模式較低時推導被收起來，告訴讀者去哪裡看
  const showsShift = useAtLeast('engineer')
  const showsStirling = useAtLeast('research')
  const derivationHint = showsStirling ? (
    <> 兩個公式的推導就在上面：平衡點偏移在 §3.4，Stirling 近似在 §3.5。</>
  ) : showsShift ? (
    <> 平衡點偏移的推導在上面的 §3.4；Stirling 近似的逐步推導在 §3.5（切到 Research 模式才顯示），題目裡每一步也附了一句來源。</>
  ) : (
    <> 這兩個公式的推導（§3.4、§3.5）在 Engineer／Research 模式才顯示；這裡先照題目每一步的說明代數字，想看推導再切換模式。</>
  )

  return (
    <Section
      kind="formula"
      level={2}
      title={
        <>
          3. 把 <Tex>{'N'}</Tex> 個 <Tex>{'q'}</Tex> 加起來：訊號 <Tex>{'\\propto N'}</Tex>、雜訊 <Tex>{'\\propto\\sqrt N'}</Tex>
        </>
      }
    >
      <Callout
        kind="info"
        title={
          <>
            符號：本章用 <Tex>{'S_N'}</Tex>（總和），保留 <Tex>{'G'}</Tex> 給 block 平均
          </>
        }
      >
        規格 §5 把總和寫成 <Tex>{'G_N=\\sum q_i'}</Tex>，但 §0 的 <Tex>{'G_k=\\frac1N\\sum q\\,x'}</Tex> 是<strong>平均</strong>、下標 <Tex>{'k'}</Tex> 是
        block。本章一律寫 <Tex>{'S_N=\\sum_{i=1}^N q_i'}</Tex>（相當於 <Tex>{'x\\equiv1'}</Tex> 的 GMAC 總和），平均則是 <Tex>{'G=S_N/N'}</Tex>。
        方向判斷與尺度無關，但 histogram 與信賴區間的軸差 <Tex>{'N'}</Tex> 倍。<Erratum id="E07" /> <Erratum id="E18" />
      </Callout>
      <SumPrereqs />

      <p>
        為什麼累加有用？把每個樣本想成兩部分：<Tex>{'q_i=m+\\eta_i'}</Tex>，其中 <Tex>{'m=E[q]'}</Tex> 是每次都一樣的平均（訊號），
        <Tex>{'\\eta_i\\equiv q_i-m'}</Tex> 是扣掉平均後剩下的零均值部分（雜訊，標準差 <Tex>{'\\sqrt{1-m^2}'}</Tex>）。相加時，這兩部分的長法不一樣：
      </p>
      <Fig name="signalVsNoise">
        先看「平均」那條路：<Tex>{'N'}</Tex> 個一樣的 <Tex>{'m'}</Tex> 同號相加，得到 <Tex>{'Nm'}</Tex>，隨 <Tex>{'N'}</Tex> 線性成長。再看「零均值」那條路：
        <Tex>{'\\eta_i'}</Tex> 有正有負、彼此獨立，會互相抵消一部分，相加的是變異數而不是大小，所以標準差只長到 <Tex>{'\\sqrt{N(1-m^2)}'}</Tex>。最後兩條路相除：比值{' '}
        <Tex>{'\\mathrm{SNR}_{\\mathrm{stat}}'}</Tex> 隨 <Tex>{'\\sqrt N'}</Tex> 成長。圖上的「<Tex>{'N\\cdot m'}</Tex>」就是下面公式的 <Tex>{'E[S_N]'}</Tex>，「
        <Tex>{'\\sqrt{N(1-m^2)}'}</Tex>」就是 <Tex>{'\\sqrt{\\operatorname{Var}(S_N)}'}</Tex>。
      </Fig>

      <Steps
        title={
          <>
            <Tex>{'S_N'}</Tex> 的平均與變異數（以及平均 <Tex>{'G'}</Tex>）
          </>
        }
        steps={[
          { tex: String.raw`S_N=\sum_{i=1}^{N}q_i=K\cdot(+1)+(N-K)\cdot(-1)=2K-N`, why: <><Tex>{'K'}</Tex> 個 <Tex>{'+1'}</Tex>、<Tex>{'N-K'}</Tex> 個 <Tex>{'-1'}</Tex> 相加。</> },
          { tex: String.raw`E[S_N]=\sum_{i=1}^{N}E[q_i]=Nm`, why: '期望值線性（不需要獨立）。' },
          { tex: String.raw`\operatorname{Var}(S_N)=\sum_{i=1}^{N}\operatorname{Var}(q_i)=N(1-m^2)`, why: <>樣本獨立，所以變異數相加；每個 <Tex>{'\\operatorname{Var}(q_i)=1-m^2'}</Tex>。</> },
          { tex: String.raw`G=\frac{S_N}{N}\;\Rightarrow\;E[G]=m,\;\operatorname{Var}(G)=\frac{1-m^2}{N}`, why: <>除以常數 <Tex>{'N'}</Tex>：平均除 <Tex>{'N'}</Tex>、變異數除 <Tex>{'N^2'}</Tex>。</> },
        ]}
      />
      <TexBlock id="F-05.4" label={<>總和與平均的矩 <ClaimTag kind="exact" /></>}>
        {String.raw`\boxed{E[S_N]=Nm,\quad \operatorname{Var}(S_N)=N(1-m^2)}\qquad G=\tfrac{S_N}{N}:\;E[G]=m,\;\operatorname{Var}(G)=\tfrac{1-m^2}{N}`}
      </TexBlock>
      <p>
        硬體的累加器多半輸出總和 <Tex>{'S_N'}</Tex>（sum），演算法卻多半寫平均 <Tex>{'G=S_N/N'}</Tex>（average）。兩者只差一個除以 <Tex>{'N'}</Tex>，但常常被搞混：
      </p>
      <Fig name="sumVsAvg">
        先看「<Tex>{'\\div N'}</Tex>」那條線：平均和標準差同時縮小 <Tex>{'N'}</Tex> 倍，所以兩格都連過去的那一格——平均除以標準差——兩者完全相同，方向判斷也不受影響。再看虛線：之後把結果乘上學習率{' '}
        <Tex>{'\\mu'}</Tex>（每次更新的步長，單位 <Tex>{'\\mathrm{fs}'}</Tex>）去更新係數 <Tex>{'w'}</Tex> 時，用 sum 的硬體要多除一個 <Tex>{'N'}</Tex>，否則迴路增益會大{' '}
        <Tex>{'N'}</Tex> 倍。圖上兩格裡的 E 與 SD 就是 F-05.4 的四個式子。<Erratum id="E18" />
      </Fig>
      <p>
        <Tex>{String.raw`N=10{,}000`}</Tex>（<Tex>{String.raw`s=1\,\mathrm{fs},\ \sigma_v=100\,\mathrm{fs}`}</Tex>）：sum 的 <Tex>{`E=${fx(base.mo.meanSum, 3)}`}</Tex>、<Tex>{`\\mathrm{SD}=${fx(base.mo.sdSum, 3)}`}</Tex>；
        average 的 <Tex>{`E=${fx(base.mo.meanAvg, 7)}`}</Tex>、<Tex>{`\\mathrm{SD}=${fx(base.mo.sdAvg, 7)}`}</Tex>——比值（SNR）完全一樣。
      </p>

      <Steps
        title="統計 SNR"
        steps={[
          { tex: String.raw`\mathrm{SNR}_{\mathrm{stat}}\equiv\frac{E[S_N]}{\sqrt{\operatorname{Var}(S_N)}}=\frac{Nm}{\sqrt{N(1-m^2)}}`, why: '訊號（平均）除以雜訊（標準差）。' },
          { tex: String.raw`=\frac{m\,N}{\sqrt N\,\sqrt{1-m^2}}=\frac{m\sqrt N}{\sqrt{1-m^2}}`, why: <><Tex>{'N/\\sqrt N=\\sqrt N'}</Tex>。</> },
        ]}
      />
      <TexBlock
        id="F-05.5"
        label={
          <>
            訊號 <Tex>{'\\propto N'}</Tex>、雜訊 <Tex>{'\\propto\\sqrt N'}</Tex> <Tex>{'\\Rightarrow'}</Tex> SNR <Tex>{'\\propto\\sqrt N'}</Tex> <ClaimTag kind="exact" />
          </>
        }
      >
        {String.raw`\boxed{\mathrm{SNR}_{\mathrm{stat}}=\frac{m\sqrt N}{\sqrt{1-m^2}}}`}
      </TexBlock>
      <Plot
        title="訊號線與雜訊線（log–log）：兩者在 $N=(1-m^2)/m^2$ 交叉"
        data={snrData}
        layout={{
          xaxis: { title: { text: 'N（樣本數）' } },
          yaxis: { title: { text: 'S_N 的尺度' } },
          shapes: [vline(base.cross, tokens.series[2])],
          annotations: [{ x: Math.log10(base.cross), y: Math.log10(base.cross * base.m), text: `SNR = 1 @ N ≈ ${int(base.cross)}`, showarrow: true, ax: -60, ay: -30 }],
        }}
        xLog
        yLog
        height={280}
        csvName="ch05-signal-vs-noise"
        caption={
          <>
            <Tex>{String.raw`s=1\,\mathrm{fs},\ \sigma_v=100\,\mathrm{fs}`}</Tex>。訊號斜率 1、雜訊斜率 <Tex>{'\\tfrac12'}</Tex>；兩線交於{' '}
            <Tex>{`N=(1-m^2)/m^2\\approx${texInt(base.cross)}`}</Tex>。每多 100 倍樣本，SNR 多 10 倍。
          </>
        }
      />
      <HandCalcBlock id="HC-05.2">
        挑一個你的 GMAC 會用的 <Tex>{'N'}</Tex>（完全平方數最好開根號），先用紙筆算出訊號 <Tex>{'E[S_N]'}</Tex>、雜訊{' '}
        <Tex>{'\\mathrm{SD}(S_N)'}</Tex> 和兩者的比值，再對答案——看看你的 <Tex>{'N'}</Tex> 在上圖交叉點的左邊還是右邊。
      </HandCalcBlock>

      <h3>3.1 精確答案：Binomial 加總</h3>
      <p>
        「判斷方向」到底是什麼動作？數一數 <Tex>{'N'}</Tex> 次比較裡有幾次是 <Tex>{'+1'}</Tex>，記作 <Tex>{'K'}</Tex>。每次比較獨立、輸出 <Tex>{'+1'}</Tex> 的機率都是{' '}
        <Tex>{'p'}</Tex>，所以 <Tex>{'K'}</Tex> 服從 Binomial 分布 <Tex>{'K\\sim\\mathrm{Bin}(N,p)'}</Tex>（本章的 <Tex>{'K'}</Tex> 只是這個計數，和後面章節的迴路增益{' '}
        <Tex>{'K=K_qC'}</Tex> 無關）。
      </p>
      <Fig name="decision">
        先看左邊三格：<Tex>{'N'}</Tex> 個 <Tex>{'q'}</Tex> 裡有 <Tex>{'K'}</Tex> 個 <Tex>{'+1'}</Tex>、<Tex>{'N-K'}</Tex> 個 <Tex>{'-1'}</Tex>，所以{' '}
        <Tex>{'S_N=2K-N'}</Tex>。再看菱形的三個出口：<Tex>{'K'}</Tex> 過半就判 <Tex>{'+1'}</Tex>，不到一半就判 <Tex>{'-1'}</Tex>；紅色的第三個出口{' '}
        <Tex>{'S_N=0'}</Tex> 是平手（tie），只有 <Tex>{'N'}</Tex> 是偶數、而且 <Tex>{'K'}</Tex> 剛好等於 <Tex>{'N/2'}</Tex> 時才會走到。下面的推導就是把這三個出口的機率各自寫出來。
      </Fig>
      <Steps
        title={<Tex>{'P(S_N>0),\\;P(S_N=0),\\;P(S_N<0)'}</Tex>}
        steps={[
          { tex: String.raw`S_N>0\iff 2K-N>0\iff K>\tfrac N2`, why: <>代入 <Tex>{'S_N=2K-N'}</Tex>。</> },
          { tex: String.raw`P(S_N>0)=\sum_{k=\lfloor N/2\rfloor+1}^{N}\binom Nk p^k(1-p)^{N-k}`, why: <>把所有 <Tex>{'K>N/2'}</Tex> 的 Binomial 機率加起來。</> },
          { tex: String.raw`S_N=0\iff K=\tfrac N2\;(\text{只有 }N\text{ 偶數才可能})`, why: <><Tex>{'K'}</Tex> 是整數，<Tex>{'N'}</Tex> 奇數時 <Tex>{'N/2'}</Tex> 不是整數。</> },
          { tex: String.raw`P(S_N=0)=\binom N{N/2}\big(p(1-p)\big)^{N/2},\qquad P(S_N<0)=1-P(S_N>0)-P(S_N=0)`, why: '三種結果互斥且涵蓋所有情況。' },
        ]}
      />
      <TexBlock id="F-05.6" label={<>精確方向機率 <ClaimTag kind="exact" /></>}>
        {String.raw`P(S_N>0)=\sum_{k>N/2}\binom Nk p^k(1-p)^{N-k},\quad P(S_N=0)=\binom N{N/2}\big(p(1-p)\big)^{N/2}\;(N\text{ 偶數})`}
      </TexBlock>
      <HandCalcBlock id="HC-05.3">
        <Tex>{'N=2'}</Tex> 和 <Tex>{'N=3'}</Tex> 的 Binomial 只有幾項，四則運算就能親手展開：換一個你喜歡的 <Tex>{'p'}</Tex>（例如 0.6），先算算看{' '}
        <Tex>{'N=2'}</Tex> 有多少機率平手、<Tex>{'N=3'}</Tex> 的多數決又比單看一次好多少。
      </HandCalcBlock>

      <h3>3.2 CLT 近似：規格 §5 的公式從哪來</h3>
      <p>
        Binomial 逐項加總是精確的，但不好手算，也看不出 <Tex>{'N'}</Tex> 要多大。<Tex>{'N'}</Tex> 大時可以把 <Tex>{'S_N'}</Tex> 當成 Gaussian（CLT），一次查表就得到答案。
        兩條路線先並排看一次：
      </p>
      <Fig name="exactVsClt">
        先看上框（精確）：由 <Tex>{'p'}</Tex> 與 <Tex>{'N'}</Tex> 得到 <Tex>{'K'}</Tex> 的分布，把 <Tex>{'K>N/2'}</Tex> 的機率逐項相加；偶數 <Tex>{'N'}</Tex> 的 tie
        是單獨的一項。再看下框（近似）：只需要平均 <Tex>{'Nm'}</Tex> 和標準差 <Tex>{'\\sigma_S\\equiv\\mathrm{SD}(S_N)=\\sqrt{N(1-m^2)}'}</Tex>，查一次{' '}
        <Tex>{'\\Phi'}</Tex>；菱形提醒你偶數 <Tex>{'N'}</Tex> 而且要嚴格的 <Tex>{'S_N>0'}</Tex> 時，要走紅色的連續性修正（切點從 0 移到 1）。圖上的 <Tex>{'N\\cdot m/\\sigma_S'}</Tex>{' '}
        就是 §3 的 <Tex>{'\\mathrm{SNR}_{\\mathrm{stat}}'}</Tex>。
      </Fig>
      <Steps
        title={<Tex>{String.raw`P(S_N>0)\approx\Phi\big(m\sqrt N/\sqrt{1-m^2}\big)`}</Tex>}
        steps={[
          { tex: String.raw`P(S_N>0)=P\!\left(\frac{S_N-Nm}{\sigma_S}>\frac{0-Nm}{\sigma_S}\right),\quad \sigma_S=\sqrt{N(1-m^2)}`, why: '兩邊同減平均、同除標準差（標準化）。' },
          { tex: String.raw`\approx P\!\left(Z>-\frac{Nm}{\sigma_S}\right),\quad Z\sim\mathcal N(0,1)`, why: 'CLT：標準化的和近似標準常態。' },
          { tex: String.raw`=\Phi\!\left(\frac{Nm}{\sigma_S}\right)`, why: <><Tex>{'P(Z>-c)=\\Phi(c)'}</Tex>（對稱）。</> },
          { tex: String.raw`=\Phi\!\left(\frac{m\sqrt N}{\sqrt{1-m^2}}\right)=\Phi(\mathrm{SNR}_{\mathrm{stat}})`, why: <>代入 <Tex>{'\\sigma_S'}</Tex>，化簡。正確率只取決於統計 SNR。</> },
        ]}
      />
      <TexBlock id="F-05.7" label={<>CLT 近似 <ClaimTag kind="approx" /> <Erratum id="E02" /></>}>
        {String.raw`\Phi\!\left(\frac{m\sqrt N}{\sqrt{1-m^2}}\right)\approx\begin{cases}P(S_N>0) & N\text{ 奇數}\\[2pt] P(S_N>0)+\tfrac12P(S_N=0) & N\text{ 偶數（random tie-break）}\end{cases}`}
      </TexBlock>
      <p>
        為什麼偶數 <Tex>{'N'}</Tex> 近似的是「tie 算一半」？因為 Gaussian 是連續的，把格點 0 的質量對半切在 0 的兩邊。若要嚴格的{' '}
        <Tex>{'P(S_N>0)'}</Tex>，要把切點移到格點中點：
      </p>
      <Steps
        title="連續性修正（continuity correction）"
        steps={[
          { tex: String.raw`N\text{ 偶數}:\;S_N\in\{\dots,-2,0,2,\dots\}\;\Rightarrow\;P(S_N>0)=P(S_N\ge2)`, why: <><Tex>{'S_N'}</Tex> 與 <Tex>{'N'}</Tex> 同奇偶，格點間距 2。</> },
          { tex: String.raw`P(S_N\ge2)\approx P(\tilde S>1),\quad\tilde S\sim\mathcal N\big(Nm,\sigma_S^2\big)`, why: <>格點 0 與 2 的中點是 1：把 <Tex>{'[1,3)'}</Tex> 的面積分給格點 2。</> },
          { tex: String.raw`=\Phi\!\left(\frac{Nm-1}{\sigma_S}\right)`, why: <>標準化後用 <Tex>{'\\Phi'}</Tex> 的對稱性 <Tex>{'P(Z>-c)=\\Phi(c)'}</Tex>。奇數 <Tex>{'N'}</Tex> 的格點是 <Tex>{'\\dots,-1,+1,\\dots'}</Tex>，中點剛好是 0，所以不需要修正。</> },
        ]}
      />
      <TexBlock
        id="F-05.8"
        label={
          <>
            偶數 <Tex>{'N'}</Tex> 的嚴格 <Tex>{'P(S_N>0)'}</Tex> <ClaimTag kind="approx" /> <Erratum id="E02" />
          </>
        }
      >
        {String.raw`P(S_N>0)\approx\Phi\!\left(\frac{Nm-1}{\sqrt{N(1-m^2)}}\right)\qquad(N\text{ 偶數})`}
      </TexBlock>
      <HandCalcBlock id="HC-05.4">
        準備一張標準常態表（或用題目提示裡的近似），把 <Tex>{'N=100'}</Tex> 的兩個數字親手算出來，再把 <Tex>{'N'}</Tex> 改成 101——你會看到偶數{' '}
        <Tex>{'N'}</Tex> 的嚴格判對率掉到 50% 以下，奇數 <Tex>{'N'}</Tex> 卻沒有這個問題。
      </HandCalcBlock>

      <h3>
        3.3 規格表格的修正版（<Tex>{'N'}</Tex> 取奇數，沒有 tie）
      </h3>
      <div className="table-wrap">
        <table className="ch05-table">
          <caption>
            <Tex>{String.raw`s=1\,\mathrm{fs},\ \sigma_v=100\,\mathrm{fs}`}</Tex>、<Tex>{'q_i'}</Tex> iid。最後兩列是讓精確值跨過 95% / 99% 的最小奇數{' '}
            <Tex>{'N'}</Tex>（CLT 連續解分別為 {fx(base.nClt95, 2)} 與 {fx(base.nClt99, 2)}）。這是辨識<strong>一個固定非零偏移之符號</strong>的機率，
            不是完整 LMS 迴路收斂的機率。
          </caption>
          <thead>
            <tr>
              <th className="num">
                <Tex>{'N'}</Tex>（奇數）
              </th>
              <th className="num">
                精確 <Tex>{'P(S_N>0)'}</Tex> <ClaimTag kind="exact" />
              </th>
              <th className="num">
                CLT <Tex>{'\\Phi(m\\sqrt N/\\sqrt{1-m^2})'}</Tex> <ClaimTag kind="approx" />
              </th>
              <th className="num">|差|</th>
            </tr>
          </thead>
          <tbody>
            {base.oddRows.map((r) => (
              <tr key={r.N}>
                <td className="num">{int(r.N)}</td>
                <td className="num">{pct(r.exact, 3)}</td>
                <td className="num">{pct(r.clt, 3)}</td>
                <td className="num">{sig(Math.abs(r.exact - r.clt), 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ch05-note">
        規格原表用 <Tex>{String.raw`N=100,\ 1{,}000,\ 10{,}000`}</Tex>（偶數）卻寫「<Tex>{'P(G_N>0)'}</Tex>」，事件與數字對不上：表中數字其實是
        tie 平分（或 <Tex>{'N+1'}</Tex> 奇數）的值。<Erratum id="E02" />
      </p>

      <Callout
        kind="warn"
        title={
          <>
            偶數 <Tex>{'N'}</Tex> 的 tie（<Tex>{'S_N=0'}</Tex>）：必須指定 decision rule
          </>
        }
      >
        <p>
          偶數 <Tex>{'N'}</Tex> 時 <Tex>{'S_N'}</Tex> 可能剛好是 0。這時硬體要怎麼辦，就是 tie rule；常見的有四種。下圖裡 <Tex>{'d_k'}</Tex> 表示第 <Tex>{'k'}</Tex> 個 block
          最後採用的方向（<Tex>{'+1'}</Tex>、<Tex>{'-1'}</Tex>，或 0 表示不動），<Tex>{'s^*'}</Tex> 表示「只取正負號來更新」的迴路最後停下來的誤差值（平衡點，理想是 0），
          <Tex>{'K_q'}</Tex> 是 §5 的小訊號增益：
        </p>
        <Fig name="tieRules">
          先看最上面的菱形：<Tex>{'S_N\\ne0'}</Tex> 時四種 rule 完全一樣，只有平手時才分道揚鑣。再看四個分支的顏色：綠色的 half（擲硬幣）與 skip（不更新）對 <Tex>{'+1'}</Tex>、<Tex>{'-1'}</Tex> 兩邊一視同仁，不會把迴路推向任何一邊；
          紅色的兩條——<Tex>{'\\operatorname{sign}(0)=+1'}</Tex>，以及 strict 在 <Tex>{'s>0'}</Tex> 時對應的硬體 <Tex>{'\\operatorname{sign}(0)=-1'}</Tex>——把平手一律判到同一邊，
          等於把決策門檻偏了半格，平衡點因此偏移 <Tex>{'\\mp1/(NK_q)'}</Tex>（推導在 §3.4，Engineer 模式顯示）。
          下表把每個分支的機率算出來。
        </Fig>
        <div className="ch05-row">
          <SelectControl
            label="強調的 tie rule"
            value={rule}
            onChange={setRule}
            options={TIE_RULES.map((r) => ({ value: r, label: TIE_RULE_LABEL[r] }))}
            reg="REG_GMAC_TIE_MODE[1:0]"
          />
        </div>
        <div className="table-wrap">
          <table className="ch05-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'N'}</Tex>（偶數）
                </th>
                <th className="num">
                  <Tex>{'P(S_N>0)'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'P(S_N=0)'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'P(S_N<0)'}</Tex>
                </th>
                {TIE_RULES.map((r) => (
                  <th key={r} className="num">
                    {r === 'plus' ? <Tex>{'\\operatorname{sign}(0)=+1'}</Tex> : r}
                  </th>
                ))}
                <th className="num">
                  CLT 近似（<Tex>{'S_N=0'}</Tex> 時以 <Tex>{'\\tfrac12'}</Tex> 機率判對，等同 tie 平分）<ClaimTag kind="approx" />
                </th>
              </tr>
            </thead>
            <tbody>
              {base.evenRows.map((r) => (
                <tr key={r.N}>
                  <td className="num">{int(r.N)}</td>
                  <td className="num">{pct(r.d.pos)}</td>
                  <td className="num">{pct(r.d.tie)}</td>
                  <td className="num">{pct(r.d.neg)}</td>
                  {TIE_RULES.map((k) => (
                    <td key={k} className="num" style={k === rule ? { fontWeight: 700, background: 'var(--accent-soft)' } : undefined}>
                      {pct(r.byRule[k].correct)}
                      {k === 'skip' && <span className="ch05-note">（不動 {pct(r.byRule[k].hold, 1)}）</span>}
                    </td>
                  ))}
                  <td className="num">{pct(r.clt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          以 <Tex>{'N=100'}</Tex> 為例：若 <strong>
            <Tex>{'S_N=0'}</Tex> 時不更新（skip）
          </strong>
          ，正確方向只有 {pct(n100.byRule.skip.correct, 1)}、錯誤 {pct(n100.byRule.skip.wrong, 1)}、不動 {pct(n100.byRule.skip.hold, 1)}；若硬體{' '}
          <strong>
            <Tex>{'\\operatorname{sign}(0)=+1'}</Tex>
          </strong>
          （例如直接拿累加器 MSB 當正負號），正確率為 {pct(n100.byRule.plus.correct, 1)}；只有 <strong>random tie-break</strong> 才得到規格表的{' '}
          {pct(n100.byRule.half.correct, 1)}。嚴格的 <Tex>{`P(S_N>0)=${texPct(n100.d.pos, 1)}`}</Tex> 甚至<strong>低於 50%</strong>，和「累加有幫助」的直覺相反——因為{' '}
          {pct(n100.d.tie, 1)} 的機率被 tie 吃掉了。連續性修正 <Tex>{'\\Phi((Nm-1)/\\sigma_S)'}</Tex> 給 {pct(n100.cltCorr, 2)}，和精確值吻合。
          <ClaimTag kind="exact" /> <Erratum id="E02" /> <Erratum id="E07" />
        </p>
        <p>
          最極端的例子是 <Tex>{'N=2'}</Tex>：只有兩次都是 <Tex>{'+1'}</Tex> 才有 <Tex>{'S_2>0'}</Tex>，所以嚴格的{' '}
          <Tex>{`P(S_2>0)=p^2=${fx(base.p * base.p, 4)}`}</Tex>（約 {pct(base.p * base.p, 1)}），而 tie 的機率高達{' '}
          <Tex>{`P(S_2=0)=2p(1-p)=${fx(2 * base.p * (1 - base.p), 4)}`}</Tex>——「累加兩次」比「只看一次」（{pct(base.p, 1)}）還糟，除非把 tie 平分（
          {pct(base.n2half, 2)}，正好等於 <Tex>{'N=1'}</Tex> 的 <Tex>{'p'}</Tex>；Research 模式的 §3.5 證明這是一般恆等式）。<ClaimTag kind="exact" />
        </p>
        <p className="ch05-note">Comparator Lab 的 Monte Carlo 與解析曲線使用同一條 rule；切換 rule 可直接看到鋸齒狀的奇偶差異。</p>
      </Callout>

      <ModeGate min="engineer">
        <h3>3.4 Tie rule 不只影響「判對率」：確定性的 tie rule 會造成收斂偏差</h3>
        <p>
          有些硬體只取累加結果的<strong>正負號</strong>來更新：每個 block 的決策 <Tex>{'d_k=\\operatorname{sign}(S_N)\\in\\{+1,-1,0\\}'}</Tex>（tie 依 rule），
          <Tex>{'w\\leftarrow w+\\mu d_k'}</Tex>（<Tex>{'x\\equiv1'}</Tex>，所以 <Tex>{'s=a-w'}</Tex>）。迴路的平衡點 <Tex>{'s^*'}</Tex> 滿足{' '}
          <Tex>{'E[d](s^*)=0'}</Tex>。偶數 <Tex>{'N'}</Tex> 時 <Tex>{'\\operatorname{sign}(0)=+1'}</Tex> 讓 tie 一律推向 <Tex>{'+1'}</Tex>，等於把決策門檻偏了半格（
          <Tex>{'S_N'}</Tex> 的格點間距是 2）。這裡 <Tex>{'\\mu'}</Tex> 是學習率（每個 block 的步長，單位 <Tex>{'\\mathrm{fs}'}</Tex>），<Tex>{'a'}</Tex> 是理想係數、
          <Tex>{'w_k'}</Tex> 是第 <Tex>{'k'}</Tex> 個 block 的校正係數。
        </p>
        <Fig name="signBlockLoop">
          先順著箭頭走一圈：<Tex>{'s=a-w_k'}</Tex> 加上雜訊 <Tex>{'v[n]'}</Tex>，每個 sample <Tex>{'n'}</Tex> 取一次 sign 得到 <Tex>{'q[n]'}</Tex>；累加 <Tex>{'N'}</Tex>{' '}
          次得到 <Tex>{'S_N'}</Tex>；每個 block <Tex>{'k'}</Tex> 再取一次正負號得到 <Tex>{'d_k'}</Tex>，乘 <Tex>{'\\mu'}</Tex> 後加進累加器（方塊裡的{' '}
          <Tex>{'\\mu/(z-1)'}</Tex> 是累加器的簡寫：每個 block 把 <Tex>{'\\mu\\,d_k'}</Tex> 加到暫存器上，新的值下一個 block 才生效）；累加器的輸出 <Tex>{'w_k'}</Tex> 以<strong>負號</strong>回到第一個加法點。再看紅色方塊：tie rule 只在這裡起作用——如果它把 <Tex>{'S_N=0'}</Tex> 一律判成{' '}
          <Tex>{'+1'}</Tex>，迴路要到 <Tex>{'E[d_k]=0'}</Tex> 才停，而這發生在 <Tex>{'s'}</Tex> 略小於 0 的地方。圖上累加器方塊裡的式子，就是更新式{' '}
          <Tex>{'w_{k+1}=w_k+\\mu\\,d_k'}</Tex>。
        </Fig>
        <Steps
          title={
            <>
              平衡點偏移 <Tex>{'s^*\\approx\\mp1/(NK_q)'}</Tex>
            </>
          }
          steps={[
            { tex: String.raw`\operatorname{sign}(0)=+1:\;d=+1\iff S_N\ge0\iff S_N>-1`, why: <>偶數 <Tex>{'N'}</Tex> 的格點 <Tex>{'\\dots,-2,0,2,\\dots'}</Tex>：「<Tex>{'\\ge0'}</Tex>」等於把門檻放在格點 <Tex>{'-2'}</Tex> 與 <Tex>{'0'}</Tex> 的中點 <Tex>{'-1'}</Tex>。</> },
            { tex: String.raw`E[d]=P(d=+1)-P(d=-1)=2P(S_N>-1)-1`, why: <>這條 rule 沒有 <Tex>{'d=0'}</Tex>，所以 <Tex>{'P(d=-1)=1-P(d=+1)'}</Tex>。</> },
            { tex: String.raw`P(S_N>-1)\approx\Phi\!\left(\frac{Nm+1}{\sigma_S}\right),\quad\sigma_S=\sqrt{N(1-m^2)}`, why: <>CLT 加連續性修正（§3.2 的同一招，切點在 <Tex>{'-1'}</Tex>）。</> },
            { tex: String.raw`E[d]=0\iff\Phi\!\left(\frac{Nm^*+1}{\sigma_S}\right)=\tfrac12\iff Nm^*=-1`, why: <><Tex>{'\\Phi(c)=\\tfrac12\\iff c=0'}</Tex>。</> },
            { tex: String.raw`s^*\approx\frac{m^*}{K_q}=-\frac{1}{NK_q}=-\frac{\sigma_v}{N}\sqrt{\frac\pi2}`, why: <>小訊號 <Tex>{'m\\approx K_qs'}</Tex>（§5）。硬體 <Tex>{'\\operatorname{sign}(0)=-1'}</Tex>（也就是 strict 評分在 <Tex>{'s>0'}</Tex> 時對應的硬體）符號相反；half / skip 對稱、無偏。</> },
          ]}
        />
        <TexBlock id="F-05.19" label={<>tie rule 造成的平衡點偏移 <ClaimTag kind="approx" /></>}>
          {String.raw`s^*\approx\mp\frac{1}{NK_q}=\mp\frac{\sigma_v}{N}\sqrt{\frac\pi2}\qquad\big(\operatorname{sign}(0)=+1:\,-;\ \ \operatorname{sign}(0)=-1:\,+\big)`}
        </TexBlock>
        <div className="table-wrap">
          <table className="ch05-table">
            <caption>
              <Tex>{String.raw`\sigma_v=100\,\mathrm{fs}`}</Tex>。「精確」為 exact binomial 下 <Tex>{'E[d](s^*)=0'}</Tex> 的二分法根；<Tex>{'N'}</Tex> 為奇數時三者皆為 0。
              strict 是「tie 算錯」的評分慣例，硬體無法知道 <Tex>{'s'}</Tex> 的正負，這裡以它在 <Tex>{'s>0'}</Tex> 時對應的硬體{' '}
              <Tex>{'\\operatorname{sign}(0)=-1'}</Tex> 計算。
            </caption>
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'N'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'\\operatorname{sign}(0)=+1'}</Tex> 精確 <Tex>{'s^*'}</Tex> <ClaimTag kind="exact" />
                </th>
                <th className="num">
                  <Tex>{'\\operatorname{sign}(0)=-1'}</Tex>（strict）精確 <Tex>{'s^*'}</Tex>
                </th>
                <th className="num">
                  half 精確 <Tex>{'s^*'}</Tex>
                </th>
                <th className="num">
                  近似 <Tex>{'\\mp1/(NK_q)'}</Tex> <ClaimTag kind="approx" />
                </th>
              </tr>
            </thead>
            <tbody>
              {base.eq.map((r) => (
                <tr key={r.N}>
                  <td className="num">{int(r.N)}</td>
                  <td className="num">{fx(r.plus, 4).replace('-', '−')} fs</td>
                  <td className="num">+{fx(r.strict, 4)} fs</td>
                  <td className="num">{fx(Math.abs(r.half) < 1e-9 ? 0 : r.half, 4)} fs</td>
                  <td className="num">
                    <Tex>{`\\mp${fx(r.approx, 4)}\\,\\mathrm{fs}`}</Tex>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Callout kind="danger" title="工程意義">
          <Tex>{'N=100'}</Tex> 時 <Tex>{'\\operatorname{sign}(0)=+1'}</Tex> 的偏差約 {fx(Math.abs(base.eq[0].plus), 2)} fs——比本章想辨識的{' '}
          <Tex>{String.raw`1\,\mathrm{fs}`}</Tex> 還大。用奇數 <Tex>{'N'}</Tex>、random tie-break（LFSR 一個位元）或「tie 不更新」都能消除；
          <Tex>{'N=4096'}</Tex> 時偏差降到 {fx(Math.abs(base.eq[2].plus), 3)} fs。
        </Callout>
        <Callout kind="info" title="適用範圍">
          這個偏差只出現在「只取 <Tex>{'S_N'}</Tex> 正負號」的判號式更新。若硬體做的是線性 GMAC 更新 <Tex>{'w\\leftarrow w+\\mu\\,S_N/N'}</Tex>（規格 §15.2 的
          block Sign-LMS），<Tex>{'S_N=0'}</Tex> 本來就貢獻 0，tie rule 根本不出現，平均更新 <Tex>{'\\mu E[S_N]/N=\\mu m'}</Tex> 也沒有偏移。此推導另假設{' '}
          <Tex>{'x\\equiv1'}</Tex>；一般 regressor 下 <Tex>{'G_k=0'}</Tex> 的機率較小，偏差需另行模擬。<ClaimTag kind="exact" />
        </Callout>
      </ModeGate>

      <ModeGate min="research">
        <h3>3.5 Research：兩個精確結果</h3>
        <p>
          <strong>
            (a) 偶數 <Tex>{'N'}</Tex> 平分 tie = 奇數 <Tex>{'N-1'}</Tex>。
          </strong>
          表中 half 欄位和「<Tex>{'N-1'}</Tex>」的奇數結果完全相同，不是巧合。把最後一個樣本 <Tex>{'q_N'}</Tex> 單獨拿出來，看它能把前{' '}
          <Tex>{'N-1'}</Tex> 個樣本的總和 <Tex>{'S_{N-1}'}</Tex> 推到哪裡：
        </p>
        <Fig name="lastSample">
          先看左邊四格：<Tex>{'N-1'}</Tex> 是奇數，所以 <Tex>{'S_{N-1}'}</Tex> 只能是奇數，離 0 最近的兩格是 <Tex>{'\\pm1'}</Tex>。再看最後一個樣本的效果：
          <Tex>{'S_{N-1}\\ge3'}</Tex>（或 <Tex>{'\\le-3'}</Tex>）時，不管 <Tex>{'q_N'}</Tex> 是多少，正負號都不會變；只有 <Tex>{'S_{N-1}=\\pm1'}</Tex> 這兩格可能被推進紅色的 tie。藍色那一格是關鍵：從{' '}
          <Tex>{'+1'}</Tex> 掉進 tie 的機率 <Tex>{'(1-p)\\,P(S_{N-1}=1)'}</Tex>，和從 <Tex>{'-1'}</Tex> 升進 tie 的機率 <Tex>{'p\\,P(S_{N-1}=-1)'}</Tex> 剛好相等。tie 再擲硬幣平分，分給「判{' '}
          <Tex>{'+1'}</Tex>」的那一半，正好把從 <Tex>{'+1'}</Tex> 掉下來的那一份補回去——所以結果和沒有 <Tex>{'q_N'}</Tex> 一樣。圖上進入「<Tex>{'S_N\\ge2'}</Tex>」的兩條箭頭就是下面推導第 2 行的兩項，進入 tie 的兩條箭頭是第 3 行的兩項，藍色格子裡的等式是第 5 行。
        </Fig>
        <Steps
          title={
            <>
              <Tex>{String.raw`P(S_N>0)+\tfrac12P(S_N=0)=P(S_{N-1}>0)`}</Tex>（<Tex>{'N'}</Tex> 偶數）
            </>
          }
          steps={[
            { tex: String.raw`S_N=S_{N-1}+q_N,\quad S_{N-1}\in\{\dots,-1,+1,\dots\}`, why: <>最後一個樣本單獨拿出來；<Tex>{'N-1'}</Tex> 為奇數。</> },
            { tex: String.raw`P(S_N>0)=P(S_{N-1}\ge3)+p\,P(S_{N-1}=1)`, why: <><Tex>{'S_{N-1}\\ge3'}</Tex> 時無論 <Tex>{'q_N'}</Tex> 是多少都有 <Tex>{'S_N\\ge2>0'}</Tex>；<Tex>{'S_{N-1}=1'}</Tex> 時需要 <Tex>{'q_N=+1'}</Tex>。</> },
            { tex: String.raw`P(S_N=0)=(1-p)P(S_{N-1}=1)+p\,P(S_{N-1}=-1)`, why: <>從 <Tex>{'+1'}</Tex> 走一步 <Tex>{'-1'}</Tex>，或從 <Tex>{'-1'}</Tex> 走一步 <Tex>{'+1'}</Tex>。</> },
            { tex: String.raw`\frac{P(S_{N-1}=1)}{P(S_{N-1}=-1)}=\frac{P(K=j+1)}{P(K=j)}=\frac{p}{1-p},\quad N-1=2j+1`, why: <>Binomial 相鄰兩項的比值 <Tex>{'\\frac{N-1-j}{j+1}\\cdot\\frac{p}{1-p}'}</Tex>，而 <Tex>{'N-1-j=j+1'}</Tex>。</> },
            { tex: String.raw`\Rightarrow\;(1-p)P(S_{N-1}=1)=p\,P(S_{N-1}=-1)`, why: '交叉相乘。' },
            { tex: String.raw`P(S_N>0)+\tfrac12P(S_N=0)=P(S_{N-1}\ge3)+P(S_{N-1}=1)=P(S_{N-1}>0)`, why: <>代入：<Tex>{'pP_1+\\tfrac12(1-p)P_1+\\tfrac12pP_{-1}=pP_1+(1-p)P_1=P_1'}</Tex>（<Tex>{'P_{\\pm1}\\equiv P(S_{N-1}=\\pm1)'}</Tex>）。</> },
          ]}
        />
        <TexBlock id="F-05.13" label={<>多出來的那一個樣本在 random tie-break 下毫無幫助 <ClaimTag kind="exact" /></>}>
          {String.raw`P(S_N>0)+\tfrac12P(S_N=0)=P(S_{N-1}>0)\qquad(N\text{ 偶數，任意 }p)`}
        </TexBlock>
        <p>
          這也解釋了 T05 的精確門檻：even-split 的 95% 門檻是 <Tex>{`${texInt(base.nEvenHalf95)}=${texInt(base.nOdd95)}+1`}</Tex>；若偶數 <Tex>{'N'}</Tex> 又用 strict
          （tie 算錯），門檻要到 {int(base.nEvenStrict95)}——多付 {int(base.nEvenStrict95 - base.nOdd95)} 個樣本，還不如奇數的 {int(base.nOdd95)}。
          <strong>
            硬體上用奇數 <Tex>{'N'}</Tex> 永遠不吃虧。
          </strong>
        </p>
        <p>
          <strong>(b) Berry–Esseen：CLT 最多差多少？</strong>對 iid 的和，以下上界對所有門檻 <Tex>{'x'}</Tex> 成立（常數取自文獻，
          <Tex>{'C\\le0.4748'}</Tex>，Shevtsova 2011）：
        </p>
        <TexBlock id="F-05.18" label={<>CLT 誤差的嚴格上界 <ClaimTag kind="exact" /></>}>
          {String.raw`\sup_x\Big|P(S_N\le x)-\Phi\!\Big(\tfrac{x-Nm}{\sqrt{N(1-m^2)}}\Big)\Big|\le\frac{C\,E|q-m|^3}{(1-m^2)^{3/2}\sqrt N},\quad E|q-m|^3=p(1-m)^3+(1-p)(1+m)^3`}
        </TexBlock>
        <div className="table-wrap">
          <table className="ch05-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'N'}</Tex>
                </th>
                <th className="num">Berry–Esseen 上界</th>
                <th className="num">
                  實際 <Tex>{'|\\text{CLT}-\\text{精確 strict}|'}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {base.be.map((r) => (
                <tr key={r.N}>
                  <td className="num">{int(r.N)}</td>
                  <td className="num">{sig(r.bound, 3)}</td>
                  <td className="num">{sig(r.err, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          偶數 <Tex>{'N'}</Tex> 時實際誤差幾乎就是 <Tex>{'\\tfrac12P(S_N=0)'}</Tex>。tie 機率本身可以用 Stirling 公式估計：
        </p>
        <Steps
          title={
            <>
              <Tex>{String.raw`P(S_N=0)\approx\sqrt{2/(\pi N)}\,e^{-Nm^2/2}`}</Tex>
            </>
          }
          steps={[
            { tex: String.raw`P(S_N=0)=\binom{N}{N/2}\big(p(1-p)\big)^{N/2}`, why: '§3.1 的精確式。' },
            { tex: String.raw`p(1-p)=\tfrac{1+m}{2}\cdot\tfrac{1-m}{2}=\frac{1-m^2}{4}`, why: <>代入 <Tex>{'p=(1+m)/2'}</Tex>（由 <Tex>{'m=2p-1'}</Tex>）。</> },
            { tex: String.raw`n!\approx\sqrt{2\pi n}\,(n/e)^n`, why: <>Stirling 公式（<Tex>{'\\ln n!=\\sum\\ln k\\approx\\int_1^n\\ln t\\,dt'}</Tex> 的精細版）。</> },
            { tex: String.raw`\binom{N}{N/2}=\frac{N!}{\big((N/2)!\big)^2}\approx\frac{\sqrt{2\pi N}\,(N/e)^N}{\pi N\,\big(N/(2e)\big)^N}=2^N\sqrt{\frac{2}{\pi N}}`, why: <>分子分母各用 Stirling；<Tex>{'(N/e)^N/(N/(2e))^N=2^N'}</Tex>。</> },
            { tex: String.raw`P(S_N=0)\approx\sqrt{\frac{2}{\pi N}}\,(1-m^2)^{N/2}\approx\sqrt{\frac{2}{\pi N}}\,e^{-Nm^2/2}`, why: <><Tex>{'2^N\\cdot4^{-N/2}=1'}</Tex>；<Tex>{'\\ln(1-m^2)\\approx-m^2'}</Tex>（一階泰勒）。</> },
          ]}
        />
        <p className="ch05-note">
          數值：{base.tieApprox.map((t, i) => (
            <span key={t.N}>
              {i > 0 ? '；' : ''}
              <Tex>{`N=${t.N}`}</Tex>：精確 {pct(t.exact, 3)}、Stirling {pct(t.approx, 3)}
            </span>
          ))}
          。所以偶數 <Tex>{'N'}</Tex> 的 CLT 誤差 <Tex>{'\\approx\\tfrac12\\sqrt{2/(\\pi N)}=1/\\sqrt{2\\pi N}'}</Tex>，和 Berry–Esseen 上界同階：CLT 的{' '}
          <Tex>{'O(1/\\sqrt N)'}</Tex> 誤差主要來自格點，而非尾巴形狀。<ClaimTag kind="approx" />
        </p>
      </ModeGate>
      <HandCalcBlock id="HC-05.5">
        偶數 <Tex>{'N'}</Tex> 到底有多常平手？用你硬體的 <Tex>{'N'}</Tex> 和 <Tex>{'\\sigma_v'}</Tex> 先手算 <Tex>{'P(S_N=0)'}</Tex>{' '}
        與它造成的平衡點偏移 <Tex>{'|s^*|'}</Tex>（只需要 <Tex>{'\\sqrt{\\ }'}</Tex> 和 <Tex>{'e^x'}</Tex>），再和上面的 tie 對照框比一比。
        {derivationHint}
      </HandCalcBlock>
    </Section>
  )
}
