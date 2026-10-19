import { useMemo } from 'react'
import { ClaimTag, Quiz, Section, Tex, TexBlock, ChRef } from '@/components'
import { erf } from '@/simulation/core'
import { sumAverageTable } from '@/simulation/models/gmac'
import { firstOrderAccumulator, residueSignals } from '../residue'
import { f, mt, tx } from '../common'
import { DEFAULT_RESIDUE, HAND } from './Residue'

const R = String.raw

/** 思考題 5 的收斂門檻：平均誤差降到 1% */
export const QUIZ_SETTLE_RATIO = 0.01

/**
 * Part 1 思考題用到的全部數字（由模型函式算出；ch04.test.tsx 逐一核對）：
 *  - 思考題 1：§2 手算表的一階累加器（K_F = 5、M = 16）走完一個週期，code 的取值與平均；
 *  - 思考題 2：3-bit、K_F = 3 的 r[3]（原思考題 4）；
 *  - 思考題 3：f_vco = 13 GHz 時前兩拍需要的補償量（residueSignals，和 §2 的互動圖同一個函式）；
 *  - 思考題 4：F-04.6 的例子（σ_v = 100 fs、誤差 1 fs）要累加幾筆，總和的平均才追得上標準差；
 *  - 思考題 5：§3 表格 N = 256 那一列的 g、p，以及降到 1% 要幾個 block（μ 減半再算一次）。
 */
export function part1QuizNumbers() {
  const M = 2 ** HAND.bits
  const period = firstOrderAccumulator(HAND.KF, HAND.bits, M) // gcd(K_F, M) = 1 ⇒ 週期剛好 M 拍
  const sVals = period.map((r) => r.s)
  const xMean = sVals.reduce((a, s) => a + s, 0) / M / M
  const xMax = Math.max(...sVals) / M
  const sig = residueSignals({ ...DEFAULT_RESIDUE, length: M, gainErrPct: 0 })
  const need0 = sig.dtcNeedFs[0]
  const need1 = sig.dtcNeedFs[1]
  const mq = erf(0.01 / Math.SQRT2) // F-04.6：E[q] = erf(δ/(√2 σ_v))，δ = 1 fs、σ_v = 100 fs
  const nMin = Math.ceil((1 - mq * mq) / (mq * mq))
  const row = sumAverageTable({ mu: 10, sigmaV: 100, C: 1, Ex2: 1, Ns: [256] })[0]
  const rowHalf = sumAverageTable({ mu: 5, sigmaV: 100, C: 1, Ex2: 1, Ns: [256] })[0]
  const blocksTo = (p: number) => Math.ceil(Math.log(QUIZ_SETTLE_RATIO) / Math.log(p))
  const r3 = firstOrderAccumulator(3, 3, 4)
  return {
    M,
    sVals,
    xMean,
    xMax,
    tvco: sig.tvcoFs,
    need0,
    need1,
    mq,
    nMin,
    row,
    rowHalf,
    kExact: Math.log(QUIZ_SETTLE_RATIO) / Math.log(row.poleAvg),
    k1: blocksTo(row.poleAvg),
    k1Half: blocksTo(rowHalf.poleAvg),
    tau: 1 / row.gAvg,
    r3,
  }
}

/**
 * Part 1 的思考題（訊號流與數學，六題）。原本 §7 的六題裡偏 RTL 的四題留在 Part 2 的 §7（思考題 7–10），
 * 兩題數學題（residue、忘了映射）搬到這裡，再加四題：residue 的範圍與平均、DTC 延遲與 code 的線性關係、GMAC 累加的尺度、μ 與收斂步數。
 * 每題的題幹最後有一行提示；答案與解析可展開（Quiz 元件）。
 */
export function Part1QuizSection() {
  const n = useMemo(() => part1QuizNumbers(), [])
  const { M, r3 } = n
  const dTau = n.need1 - n.need0
  return (
    <Section kind="example" title="思考題（Part 1：訊號流與數學）" level={2} id="ch04-part1-quiz">
      <p>
        做完 Part 1，先用這六題確認訊號流的數學：前三題是 §2 的 residue 與 DTC，後三題是 §3 的 GMAC。每題的最後一行是提示；選了答案再展開解析。RTL 與定點的四題在 Part 2 的 §7。
      </p>
      <Quiz
        title="思考題 1（fractional residue 的範圍與平均）"
        question={
          <>
            §2 手算表的一階累加器：<Tex>{R`M=${M}`}</Tex>、<Tex>{R`K_\mathrm{F}=${HAND.KF}`}</Tex>、<Tex>{R`s[-1]=0`}</Tex>。DTC 的 code <Tex>{R`x[n]=s[n]/M`}</Tex> 會取哪些值？連續 {M} 拍的平均是多少？
            <p className="small muted">提示：看手算表 <Tex>{R`s[n]`}</Tex> 那一欄——{M} 拍裡有沒有重複的值？</p>
          </>
        }
        options={[
          { label: mt(R`$x\in[0,1)$ 連續取值，平均 $\tfrac12$`) },
          { label: mt(R`$x\in\{0,\tfrac1{${M}},\dots,\tfrac{${M - 1}}{${M}}\}$，每個值各出現一次，平均 $\tfrac{${M - 1}}{${2 * M}}=${tx(n.xMean, 5)}$`), correct: true },
          { label: mt(R`$x$ 只有 $0$ 與 $\tfrac{${HAND.KF}}{${M}}$ 兩個值，平均 $\mathrm{frac}=\tfrac{${HAND.KF}}{${M}}$`) },
          { label: mt(R`$x\in[-\tfrac12,\tfrac12)$，平均 $0$`) },
        ]}
        answer={
          <>
            <p>
              <Tex>{R`s[n]`}</Tex> 依序為 {n.sVals.join('、')}：因為 <Tex>{R`\gcd(K_\mathrm{F},M)=1`}</Tex>，序列的週期剛好是 <Tex>M</Tex> 拍，而且 <Tex>{R`0,\dots,M-1`}</Tex> 每個餘數恰好各出現一次（<Tex>{R`s[n]=(n+1)K_\mathrm{F}\bmod M`}</Tex>，<Tex>{R`K_\mathrm{F}`}</Tex> 與 <Tex>M</Tex> 互質時這是 <Tex>{R`0,\dots,M-1`}</Tex> 的一個排列）。所以 <Tex>x</Tex> 不是連續的，最大值是 <Tex>{R`(M-1)/M=${tx(n.xMax, 4)}`}</Tex>，平均是等差數列的平均：
            </p>
            <TexBlock>{R`\bar x=\frac1M\sum_{s=0}^{M-1}\frac{s}{M}=\frac{1}{M^2}\cdot\frac{M(M-1)}{2}=\frac{M-1}{2M}=\frac{${M - 1}}{${2 * M}}=${tx(n.xMean, 5)}`}</TexBlock>
            <p>
              <ClaimTag kind="exact" /> 一階累加器、零初值、<Tex>{R`\gcd(K_\mathrm{F},M)=1`}</Tex> 時精確；<Tex>{R`M\to\infty`}</Tex> 時趨近 <Tex>{R`\tfrac12`}</Tex>。這個不為零的平均就是 §2 警告框說的事：code 有 DC，所以 §3 的「忘了映射」會把它變成 gain 偏差（F-04.7）；把累加器的 MSB 反相（<Tex>{R`x-\tfrac12`}</Tex>）平均就只剩 <Tex>{R`-1/(2M)`}</Tex>。若 <Tex>{R`\gcd\ne1`}</Tex>（例如 <Tex>{R`K_\mathrm{F}=4`}</Tex>），週期縮成 <Tex>{R`M/\gcd`}</Tex>、<Tex>x</Tex> 只走過幾個值——DTC 的非線性就只被抽查這幾個 code（<ChRef ch="11">Ch11</ChRef>）。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 2（fractional residue）"
        question={
          <>
            3-bit 一階累加器（<Tex>{R`M=8`}</Tex>），<Tex>{R`K_\mathrm{F}=3`}</Tex>，<Tex>{R`s[-1]=0`}</Tex>。第 3 拍（<Tex>{R`n=3`}</Tex>）的 residue <Tex>{R`r[3]`}</Tex> 是多少 <Tex>{R`T_\mathrm{vco}`}</Tex>？
            <p className="small muted">提示：讓累加器走 4 拍，記下每一拍的 carry；或直接用 F-04.1 的封閉式 <Tex>{R`r[n]=-s[n]/M`}</Tex>。</p>
          </>
        }
        options={[{ label: mt(R`$-0.5$`), correct: r3[3].residue === -0.5 }, { label: mt(R`$-0.375$`) }, { label: mt(R`$+0.5$`) }, { label: mt(R`$0$`) }]}
        answer={
          <>
            <p>
              <Tex>{R`s[n]`}</Tex> 依序為 {r3.map((r) => r.s).join('、')}（第 2 拍 <Tex>{R`6+3=9\ge8`}</Tex> 進位，留下 1）；carry <Tex>{R`y[n]`}</Tex> 為 {r3.map((r) => r.y).join('、')}。
            </p>
            <TexBlock>{R`r[3]=\sum_{m=0}^{3}\Bigl(y[m]-\tfrac38\Bigr)=1-4\times\tfrac38=-\tfrac12=-\frac{s[3]}{M}=-\frac{${r3[3].s}}{8}`}</TexBlock>
            <p>
              feedback（divider）edge 早到半個 VCO 週期，所以 reference 端的 DTC 要把 reference edge 也提前 <Tex>{R`0.5\,T_\mathrm{vco}`}</Tex>：需要的補償量 <Tex>{R`\tau_\mathrm{need}=0.5\,T_\mathrm{vco}`}</Tex>，DTC 的延遲是{' '}
              <Tex>{R`T_0-0.5\,T_\mathrm{vco}`}</Tex>。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 3（DTC 延遲與 code 的線性關係）"
        question={
          <>
            gain 剛好正確（<Tex>{R`w=a=T_\mathrm{vco}`}</Tex>），<Tex>{R`f_\mathrm{vco}=${DEFAULT_RESIDUE.fvcoGHz}\,\mathrm{GHz}`}</Tex>（<Tex>{R`T_\mathrm{vco}=${tx(n.tvco, 6)}\,\mathrm{fs}`}</Tex>）。§2 手算表第 0 拍 <Tex>{R`s[0]=${n.sVals[0]}`}</Tex>、第 1 拍 <Tex>{R`s[1]=${n.sVals[1]}`}</Tex>。從第 0 拍到第 1 拍，reference 端 DTC 的延遲{' '}
            <Tex>{R`\tau_\mathrm{DTC}[n]=T_0-w\,x[n]`}</Tex> 改變了多少？
            <p className="small muted">提示：把兩拍的 <Tex>{R`\tau_\mathrm{DTC}`}</Tex> 相減，看看 <Tex>{R`T_0`}</Tex> 還在不在。</p>
          </>
        }
        options={[
          { label: mt(R`多延遲 $${tx(dTau, 6)}\,\mathrm{fs}$`) },
          { label: mt(R`少延遲 $${tx(dTau, 6)}\,\mathrm{fs}$（$=\tfrac{${n.sVals[1] - n.sVals[0]}}{${M}}T_\mathrm{vco}$）`), correct: true },
          { label: mt(R`少延遲 $${tx(n.need1, 6)}\,\mathrm{fs}$（$=\tfrac{${n.sVals[1]}}{${M}}T_\mathrm{vco}$）`) },
          { label: mt(R`要知道基準延遲 $T_0$ 才能算`) },
        ]}
        answer={
          <>
            <TexBlock>
              {R`\begin{aligned}\tau_\mathrm{DTC}[1]-\tau_\mathrm{DTC}[0]&=\bigl(T_0-w\,x[1]\bigr)-\bigl(T_0-w\,x[0]\bigr)=-w\bigl(x[1]-x[0]\bigr)\\&=-T_\mathrm{vco}\Bigl(\tfrac{${n.sVals[1]}}{${M}}-\tfrac{${n.sVals[0]}}{${M}}\Bigr)=-\tfrac{${n.sVals[1] - n.sVals[0]}}{${M}}\times${tx(n.tvco, 6)}=${tx(-dTau, 6)}\,\mathrm{fs}\end{aligned}`}
            </TexBlock>
            <p>
              延遲對 code 是一條直線，斜率是 <Tex>{R`-w`}</Tex>，基準延遲 <Tex>{R`T_0`}</Tex> 在相減時消掉——所以 PLL 把 <Tex>{R`T_0`}</Tex> 當成靜態相位偏移吸收，不影響任何會動的量。需要的補償量同時從 <Tex>{R`\tau_\mathrm{need}[0]=${tx(n.need0, 6)}\,\mathrm{fs}`}</Tex> 變成{' '}
              <Tex>{R`\tau_\mathrm{need}[1]=${tx(n.need1, 6)}\,\mathrm{fs}`}</Tex>（feedback edge 早到的時間也多了同樣多），兩條 edge 仍然對齊。code 每變 1 LSB（<Tex>{R`1/M`}</Tex>）延遲就變 <Tex>{R`T_\mathrm{vco}/M=${tx(n.tvco / M, 5)}\,\mathrm{fs}`}</Tex>：這是 DTC 需要的時間解析度；整個 code 範圍要蓋住 <Tex>{R`(M-1)T_\mathrm{vco}/M`}</Tex>。
              <ClaimTag kind="exact" /> 線性 DTC 時精確；DTC 不是直線（INL <Tex>{R`d(x)`}</Tex>）時，偏離直線的量會直接進 PD（<ChRef ch="11">Ch11</ChRef>）。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 4（GMAC 累加的尺度：要加幾筆才看得到 1 fs？）"
        question={
          <>
            <Tex>{R`\sigma_v=100\,\mathrm{fs}`}</Tex>，gain 誤差讓 PD 看到固定的 <Tex>{R`1\,\mathrm{fs}`}</Tex>（<Tex>{R`x\equiv1`}</Tex>），所以每一筆 <Tex>q</Tex> 的平均只有 <Tex>{R`m_q=\mathrm{erf}(0.01/\sqrt2)=${tx(n.mq, 6)}`}</Tex>（F-04.6）。把 <Tex>N</Tex> 筆加起來，總和 <Tex>{R`S_N`}</Tex> 的平均{' '}
            <Tex>{R`N\,m_q`}</Tex> 至少要和它的標準差 <Tex>{R`\sqrt{N(1-m_q^2)}`}</Tex> 一樣大，<Tex>N</Tex> 最少要多少？
            <p className="small muted">提示：平均和 <Tex>N</Tex> 成正比、標準差和 <Tex>{R`\sqrt N`}</Tex> 成正比；兩者相等時 <Tex>N</Tex> 滿足一個很短的式子。</p>
          </>
        }
        options={[
          { label: mt(R`約 $${Math.ceil(1 / n.mq)}$（$1/m_q$）`) },
          { label: mt(R`約 $${n.nMin}$（$\approx1/m_q^2$）`), correct: true },
          { label: mt(R`約 $${Math.ceil(n.nMin / 10)}$`) },
          { label: '不管 N 多大，總和永遠淹沒在雜訊裡' },
        ]}
        answer={
          <>
            <TexBlock>{R`N\,m_q\ge\sqrt{N(1-m_q^2)}\;\Longleftrightarrow\;\sqrt N\ge\frac{\sqrt{1-m_q^2}}{m_q}\;\Longleftrightarrow\;N\ge\frac{1-m_q^2}{m_q^2}=\frac{1-${tx(n.mq * n.mq, 4)}}{${tx(n.mq * n.mq, 4)}}=${tx((1 - n.mq * n.mq) / (n.mq * n.mq), 1)}\;\Rightarrow\;N_\mathrm{min}=${n.nMin}`}</TexBlock>
            <p>
              訊號隨 <Tex>N</Tex> 線性長大，雜訊只隨 <Tex>{R`\sqrt N`}</Tex> 長大，所以總和的 SNR <Tex>{R`\propto\sqrt N`}</Tex>——這就是 GMAC 要累加這麼多筆的原因。F-04.6 的例子 <Tex>{R`N=10000`}</Tex>：<Tex>{R`E[S_N]=79.8`}</Tex> 還小於 <Tex>{R`\mathrm{sd}(S_N)=100`}</Tex>，單一個 block 分不出方向；但 gain accumulator 會再把很多個 block 平均起來（§3：時間常數約 <Tex>{R`1/g`}</Tex> 個 block），所以 <Tex>{R`\mu`}</Tex> 小一點就補得回來。要 SNR 達到 3，<Tex>N</Tex> 還要再 9 倍（約 <Tex>{R`${tx(9 * n.nMin, 3)}`}</Tex>）。
              <ClaimTag kind="exact" /> 在「<Tex>q</Tex> iid、<Tex>{R`x\equiv1`}</Tex>」的指定模型下精確（<Tex>{R`\mathrm{Var}(q)=1-m_q^2`}</Tex>）；真實 code 有 <Tex>{R`E[x^2]<1`}</Tex>，需要的 <Tex>N</Tex> 更多（<ChRef ch="05">Ch05</ChRef>）。
            </p>
          </>
        }
      />
      <Quiz
        title={R`思考題 5（$\mu$ 與收斂步數）`}
        question={
          <>
            average 模式，<Tex>{R`N=256,\;\mu=10\,\mathrm{fs},\;\sigma_v=100\,\mathrm{fs},\;C=1`}</Tex>（§3 表格那一列）：<Tex>{R`g=\mu K=${tx(n.row.gAvg, 4)}`}</Tex>，平均 pole <Tex>{R`p=1-g=${tx(n.row.poleAvg, 4)}`}</Tex>。平均誤差要從{' '}
            <Tex>{R`\delta_0`}</Tex> 降到 1% 需要幾個 block？
            <p className="small muted">提示：<Tex>{R`E[\delta_k]=p^k\delta_0`}</Tex>，兩邊取對數。</p>
          </>
        }
        options={[
          { label: mt(R`$1/g\approx${tx(n.tau, 3)}$ 個 block，之後誤差就是 0`) },
          { label: mt(R`$${n.k1}$ 個 block（$=${n.k1 * 256}$ 個 sample）`), correct: true },
          { label: mt(R`$${n.k1}$ 個 sample`) },
          { label: mt(R`和 $\mu$ 無關：$\mu$ 減半也是 $${n.k1}$ 個 block`) },
        ]}
        answer={
          <>
            <TexBlock>{R`p^k=0.01\;\Rightarrow\;k=\frac{\ln0.01}{\ln p}=\frac{${tx(Math.log(QUIZ_SETTLE_RATIO), 4)}}{${tx(Math.log(n.row.poleAvg), 5)}}=${tx(n.kExact, 4)}\;\Rightarrow\;${n.k1}\text{ 個 block}=${n.k1}\times256=${n.k1 * 256}\text{ 個 sample}`}</TexBlock>
            <p>
              時間常數 <Tex>{R`\tau=-1/\ln p\approx1/g=${tx(n.tau, 3)}`}</Tex> 個 block（<Tex>g</Tex> 小時 <Tex>{R`\ln p\approx-g`}</Tex>），1% 大約是 <Tex>{R`4.6\,\tau`}</Tex>；<Tex>{R`1/g`}</Tex> 個 block 之後誤差只降到 <Tex>{R`e^{-1}\approx37\%`}</Tex>，不是 0。<Tex>{R`\mu`}</Tex> 減半：<Tex>{R`g=${tx(n.rowHalf.gAvg, 4)}`}</Tex>、<Tex>{R`p=${tx(n.rowHalf.poleAvg, 4)}`}</Tex>，要 <Tex>{R`${n.k1Half}`}</Tex> 個 block——約兩倍（代價換來的是穩態抖動 <Tex>{R`\sigma_w`}</Tex> 降 <Tex>{R`\sqrt2`}</Tex> 倍，<ChRef ch="12">Ch12</ChRef>）。若 RTL 少了「<Tex>{R`\div N`}</Tex>」的右移（sum 模式），<Tex>g</Tex> 變成 {f(n.row.gSum, 3)}，迴路根本不穩定（Part 2 的思考題 7）。
              <ClaimTag kind="approx" /> 一階平均模型、小訊號；實際的 sign-LMS 還有雜訊造成的抖動。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 6（忘了映射 + 零均值 code）"
        question={
          <>
            code 是零均值的 iid <Tex>{R`\pm1`}</Tex>，comparator 的 0/1 沒有映射成 <Tex>{R`\pm1`}</Tex>。下列何者正確？
            <p className="small muted">提示：把 <Tex>{R`b=(q+1)/2`}</Tex> 代進 GMAC（F-04.7），看多出來的那一項在零均值 code 時是多少。</p>
          </>
        }
        options={[
          { label: '平均誤差發散' },
          { label: mt(R`收斂到錯誤的 gain，偏差 $E[x]/K$`) },
          { label: mt(R`固定點仍是 $a$，但收斂速度只有一半`), correct: true },
          { label: '完全沒有影響' },
        ]}
        answer={
          <>
            <TexBlock>{R`G_\mathrm{bug}=\tfrac12G+\tfrac12\bar x\;\Rightarrow\;E[G_\mathrm{bug}]\approx\tfrac12K\delta+\tfrac12E[x]=\tfrac12K\delta`}</TexBlock>
            <p>
              <Tex>{R`E[x]=0`}</Tex> 時偏差項消失，只剩增益減半：<Tex>{R`g_\mathrm{bug}=g/2`}</Tex>，時間常數加倍。正因為「看起來還是收斂到對的值」，這個 bug 在零均值 code 的模擬裡很容易漏掉；換成有 DC 的 DSM code（思考題 1 的平均 <Tex>{R`${tx(n.xMean, 5)}`}</Tex>）就會出現大偏差。
            </p>
          </>
        }
      />
    </Section>
  )
}
