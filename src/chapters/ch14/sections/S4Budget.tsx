import { useDeferredValue, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { Callout, ClaimTag, CodeBlock, HandLink, ModeGate, ParamControl, Plot, Section, SourceTag, Tex, TexBlock, useThemeTokens, ChRef } from '@/components'
import optimizerSrc from '@/simulation/models/optimizer.ts?raw'
import { budgetSplit, loopGainK } from '@/simulation/models/optimizer'
import { Diagram } from '../Diagram'
import { CHART_BUDGET_SPLIT } from '../diagrams'
import { md, nf, Steps, tx } from '../shared'

/** §14.3：固定總比較次數 T = N·B，N 與更新次數的取捨（F-14.17） */
export function S4Budget() {
  const tokens = useThemeTokens()
  const [T, setT] = useState(131072)
  const [delta0, setDelta0] = useState(3)
  const [sigmaV, setSigmaV] = useState(100)
  const [spread, setSpread] = useState(3)
  const deferred = useDeferredValue({ T, delta0, sigmaV, spread })
  const K = loopGainK(deferred.sigmaV, 0)
  const rows = useMemo(() => {
    const Ns: number[] = []
    for (let e = 4; e <= 20; e++) if (2 ** e <= deferred.T) Ns.push(2 ** e)
    return budgetSplit({ T: deferred.T, Ns, K, delta0: deferred.delta0, kSpread: deferred.spread })
  }, [deferred, K])
  // Kalman 下界（§14.6 F-14.18）只依賴 T：δ0²/(1 + Tδ0²K²)
  const kalman = Math.sqrt((deferred.delta0 * deferred.delta0) / (1 + deferred.T * deferred.delta0 * deferred.delta0 * K * K))
  const data = useMemo<Data[]>(
    () => [
      { x: rows.map((r) => r.N), y: rows.map((r) => r.rmsNominal), name: String.raw`$K$ 已知：最佳 $\mu$ 下的 RMS`, mode: 'lines+markers', line: { color: tokens.series[0], width: 2.5 } },
      {
        x: rows.map((r) => r.N),
        y: rows.map((r) => r.rmsRobust),
        name: String.raw`$K \in [K/\sqrt{\rho},\, K\sqrt{\rho}]$（$\rho = ${tx(deferred.spread, 3)}$）：最差情況 RMS`,
        mode: 'lines+markers',
        line: { color: tokens.series[1], width: 2 },
      },
      { x: rows.map((r) => r.N), y: rows.map((r) => r.rmsFirstOrder), name: String.raw`一階預測（只依賴 $T$）`, line: { color: tokens.series[2], dash: 'dash' } },
      { x: rows.map((r) => r.N), y: rows.map(() => kalman), name: String.raw`Kalman 下界 $\sqrt{P_B}$（只依賴 $T$；F-14.18）`, line: { color: tokens.series[4], dash: 'dot' } },
    ],
    [rows, tokens, deferred.spread, kalman],
  )
  const muData = useMemo<Data[]>(
    () => [
      { x: rows.map((r) => r.N), y: rows.map((r) => r.muNominal), name: String.raw`$\mu^*$（$K$ 已知）`, mode: 'lines+markers', line: { color: tokens.series[0] } },
      { x: rows.map((r) => r.N), y: rows.map((r) => r.muRobust), name: String.raw`$\mu^*$（最差情況）`, mode: 'lines+markers', line: { color: tokens.series[1] } },
    ],
    [rows, tokens],
  )
  const fo = rows.length ? rows[0].rmsFirstOrder : NaN
  return (
    <Section kind="explore" level={2} title={md('14.3 固定總預算：$N$ 大、更新少，還是 $N$ 小、更新多？')} id="ch14-budget">
      <p>
        開機校正的時間是固定的：<Tex>{'T=N\\cdot B'}</Tex> 次比較。<Tex>{'N'}</Tex> 加倍，每次更新的雜訊 <Tex>{'\\sigma_\\eta^2=1/N'}</Tex> 減半，但更新次數 <Tex>{'B'}</Tex> 也減半。哪個好？
      </p>
      <Diagram chart={CHART_BUDGET_SPLIT} caption="同一筆預算的兩種花法：兩條路線最後匯到同一個藍色方塊，表示一階結果相同。">
        <p>
          <strong>先看</strong>最上面：總比較次數 <Tex>{'T'}</Tex> 固定。一條路線是「<Tex>{'N'}</Tex> 大」：每次更新比較乾淨，但更新次數少；另一條是「<Tex>{'N'}</Tex> 小」：每次更新比較吵，但更新次數多。<strong>再看</strong>兩條路線匯合的藍色方塊：只要{' '}
          <Tex>{'\\mu'}</Tex> 跟著重新最佳化，「每次的雜訊 ÷ 更新次數」永遠等於 <Tex>{'1/T'}</Tex>。<strong>最後看</strong>最下面：既然雜訊分不出高下，<Tex>{'N'}</Tex> 就交給硬體與穩健性決定（本節後半的表格）。
        </p>
        <p>
          圖上藍色方塊裡的 <Tex>{'\\sigma_\\eta^2/B=1/T'}</Tex> 與 <Tex>{'A=4TK^2\\delta_0^2'}</Tex> 就是下面推導的第 1、2 步；把它們代回 F-14.8，就是只剩 <Tex>{'T'}</Tex> 的 F-14.17。
        </p>
      </Diagram>
      <Steps
        title={
          <>
            把 <Tex>{'\\sigma_\\eta^2=1/N'}</Tex>、<Tex>{'B=T/N'}</Tex> 代入 F-14.8
          </>
        }
        steps={[
          { tex: String.raw`\frac{\sigma_\eta^2}{B}=\frac{1/N}{T/N}=\frac1T`, why: <><Tex>{'N'}</Tex> 在分子分母抵銷。</> },
          { tex: String.raw`A=\frac{4BK^2\delta_0^2}{\sigma_\eta^2}=4BNK^2\delta_0^2=4TK^2\delta_0^2`, why: <><Tex>{'BN=T'}</Tex>：同樣只剩 <Tex>{'T'}</Tex>。</> },
          { tex: String.raw`E[\delta_B^2]^*\approx\frac{\sigma_\eta^2(1+\ln A)}{4BK^2}=\frac{1+\ln(4TK^2\delta_0^2)}{4TK^2}`, why: '代回 F-14.8。' },
        ]}
      />
      <TexBlock id="F-14.17" label={md('一階只依賴 $T$')}>
        {String.raw`\boxed{E[\delta_B^2]^*\approx\frac{1+\ln(4TK^2\delta_0^2)}{4TK^2}}\qquad(\text{與 }N\text{ 無關})`}
      </TexBlock>
      <p>
        <ClaimTag kind="approx" /> 直覺：資訊量只有 <Tex>{'T'}</Tex> 次 1-bit 比較；怎麼分批，只要重新最佳化 <Tex>{'\\mu'}</Tex>，結果幾乎一樣。<strong>真正決定 <Tex>{'N'}</Tex> 的是硬體與穩健性</strong>，不是雜訊。（同一個結論的精確版：§14.6 的 Kalman 下界 <Tex>{'P_B=\\delta_0^2/(1+B\\delta_0^2K^2/\\sigma_\\eta^2)=\\delta_0^2/(1+T\\delta_0^2K^2)'}</Tex> 也只依賴 <Tex>{'T'}</Tex>。）
      </p>
      <p>
        <strong>換你算。</strong>回到 §14.2 的手算題 <HandLink id="HC-14.5">HC-14.5</HandLink>，把 <Tex>{'N'}</Tex> 從 4096 改成 8192（<Tex>{'T'}</Tex> 不變）再用紙筆算一次：<Tex>{'B'}</Tex> 減半、<Tex>{'\\mu^*'}</Tex> 加倍，但 <Tex>{'A'}</Tex> 與{' '}
        <Tex>{'\\text{RMS}^*'}</Tex> 一個位數都不會變——F-14.17 說的就是這件事。
      </p>
      <div className="grid-2">
        <ParamControl label={md(String.raw`總比較次數 $T$`)} ariaLabel="總比較次數 T" value={T} onChange={setT} min={1024} max={2 ** 24} log integer clampOnBlur reg="CAL_TIMER（開機校正預算，以 comparator 樣本計）" hint="第 10 課：131072" />
        <ParamControl label={md(String.raw`初始誤差 $\delta_0$`)} ariaLabel="初始誤差 δ0" value={delta0} onChange={setDelta0} min={0.01} max={50} log unit="fs" reg="gain_true 與 gain_initial 的差" />
        <ParamControl label={md(String.raw`comparator 雜訊 $\sigma_v$`)} ariaLabel="comparator 雜訊 σ_v" value={sigmaV} onChange={setSigmaV} min={1} max={1000} log unit="fs" reg="pd_noise_rms_fs" />
        <ParamControl label={md(String.raw`$K$ 的 corner 散佈 $\rho=K_{\max}/K_{\min}$`)} ariaLabel="K 的 corner 散佈 ρ = K_max/K_min" value={spread} onChange={setSpread} min={1} max={10} step={0.1} reg="PVT／FCW corner spread" hint={md(String.raw`$\rho=1$：$K$ 精確已知`)} />
      </div>
      <Plot
        title="最佳 RMS vs $N$（固定 $T$）"
        data={data}
        xLog
        height={320}
        csvName="ch14-budget-split"
        layout={{ xaxis: { title: { text: String.raw`$N$（每 block 樣本數，log）` } }, yaxis: { title: { text: String.raw`RMS $\delta_B$ (fs)` } } }}
        caption={md(
          String.raw`一階預測 ${nf(fo, 4)} fs。$K$ 已知時曲線在 $B$ 夠大時幾乎平坦；$B$ 很小（右端）反而下降，$B=1$ 時恰好等於 Kalman 下界 $\sqrt{\delta_0^2/(1+T\delta_0^2K^2)}=${tx(kalman, 4)}\,\mathrm{fs}$（前提是 $K$ 精確已知）。$K$ 有 corner 不確定時，$B$ 太小的最差情況急劇惡化：少數幾次更新沒有機會修正 $K$ 的誤差。`,
        )}
      />
      <Plot
        title={String.raw`最佳 $\mu$ vs $N$（固定 $T$）`}
        data={muData}
        xLog
        yLog
        height={260}
        csvName="ch14-budget-mu"
        layout={{ xaxis: { title: { text: String.raw`$N$（log）` } }, yaxis: { title: { text: String.raw`$\mu^*$ (fs)` } } }}
        caption={md(String.raw`$\mu^*$ 大致與 $N$ 成正比（$g^*\approx\ln A/(2B)$，$B=T/N$）：換 $N$ 時 $\mu$ 要跟著換，否則就不是同一個設計。`)}
      />
      <div className="table-wrap">
        <table className="ch14-table">
          <thead>
            <tr>
              <th>
                <Tex>{'N'}</Tex>
              </th>
              <th>
                <Tex>{'B'}</Tex>
              </th>
              <th>
                <Tex>{'\\mu^*'}</Tex>（<Tex>{'K'}</Tex> 已知）
              </th>
              <th>RMS</th>
              <th>
                <Tex>{'\\mu^*'}</Tex>（最差）
              </th>
              <th>最差 RMS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.N}>
                <td className="num">{r.N}</td>
                <td className="num">{r.B}</td>
                <td className="num">{nf(r.muNominal, 4)}</td>
                <td className="num">{nf(r.rmsNominal, 4)}</td>
                <td className="num">{nf(r.muRobust, 4)}</td>
                <td className="num">{nf(r.rmsRobust, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        <SourceTag kind="illustrative" /> 線性模型、<Tex>{'\\theta=0'}</Tex>、<Tex>{`K=${tx(K, 4)}\\,\\mathrm{fs^{-1}}`}</Tex>、<Tex>{'PM\\ge60^\\circ'}</Tex>。最差情況：在 9 個 <Tex>{'K'}</Tex> 值（log 等距於 <Tex>{'[K/\\sqrt\\rho,\\ K\\sqrt\\rho]'}</Tex>）中取最大的 <Tex>{'E[\\delta_B^2]'}</Tex>，再對 <Tex>{'\\mu'}</Tex> 最小化（minimax），且要求最大的 <Tex>{'K'}</Tex> 也滿足 <Tex>{'g\\le1'}</Tex>。
      </p>
      <h3>{md('那 $N$ 到底怎麼選？硬體的取捨')}</h3>
      <div className="table-wrap">
        <table className="ch14-table">
          <thead>
            <tr>
              <th>考量</th>
              <th>{md('$N$ 大（更新少）')}</th>
              <th>{md('$N$ 小（更新多）')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{md(String.raw`雜訊（$K$ 已知、$\mu$ 最佳化）`)}</td>
              <td colSpan={2}>一階相同（F-14.17）；只差二階項</td>
            </tr>
            <tr>
              <td>{md('$K$ 不確定（PVT／FCW corner）')}</td>
              <td>{md('差：每次更新都要「猜對」$g$，少數幾次無法自我修正')}</td>
              <td>{md('好：迭代本身會修正 $K$ 的誤差')}</td>
            </tr>
            <tr>
              <td>{md('更新延遲 $d$（以 block 計）')}</td>
              <td>
                好：固定的 pipeline latency 只佔 block 的一小部分，<Tex>{'d\\approx0'}</Tex>
              </td>
              <td>差：latency 可能跨好幾個 block，PM 變小（<ChRef ch="08">Ch08</ChRef> §8.3）</td>
            </tr>
            <tr>
              <td>Accumulator 位元數</td>
              <td>
                多：<Tex>{'x=\\pm1'}</Tex> 的 sum-mode 累加值落在 <Tex>{'[-N,N]'}</Tex>，需 <Tex>{'\\lceil\\log_2(N+1)\\rceil+1'}</Tex> 位元（<Tex>{'N=4096'}</Tex> 時 14 bits；多位元 code 再加 code 位元，見 <ChRef ch="04">Ch04</ChRef> §5）
              </td>
              <td>少</td>
            </tr>
            <tr>
              <td>
                追蹤頻寬 <Tex>{'f_u g/(2\\pi)'}</Tex>（<Tex>{'f_u'}</Tex> 是每秒更新幾次）
              </td>
              <td>
                低：更新率 <Tex>{'f_u=f_s/N'}</Tex> 小
              </td>
              <td>高</td>
            </tr>
            <tr>
              <td>係數更新活動（spur）</td>
              <td>
                少：更新頻率 <Tex>{'f_u'}</Tex> 低、每次跳較大
              </td>
              <td>多：更新頻率高、每次跳較小</td>
            </tr>
            <tr>
              <td>Sign-LMS 線性化（E48）</td>
              <td>
                每次步長 <Tex>{'\\mu|G|'}</Tex> 大，<Tex>{'\\delta'}</Tex> 大時更容易進入 slew-limited
              </td>
              <td>步長小，較平順</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Callout kind="info" title="你會發現">
        <ClaimTag kind="exact" /> 把 <Tex>{'\\rho'}</Tex> 拉到 1（<Tex>{'K'}</Tex> 精確已知），右端（<Tex>{'B=1,2'}</Tex>）反而最好——極限 <Tex>{'B=1'}</Tex> 就是「把全部 <Tex>{'T'}</Tex> 次比較平均，再用{' '}
        <Tex>{'\\mu=K\\delta_0^2/(K^2\\delta_0^2+1/T)\\approx1/K'}</Tex> 一步到位」，剛好等於 Kalman 下界（最小平方估計）。但只要 <Tex>{'\\rho>1'}</Tex>，同一個設計在 corner 上會差很多。這是 §14.5 corner-based 區間與 §14.6 步長排程的動機。
      </Callout>
      <ModeGate min="research">
        <CodeBlock source={optimizerSrc} region="budgetSplit" path="src/simulation/models/optimizer.ts" />
      </ModeGate>
    </Section>
  )
}
