import { useMemo } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  Callout,
  ClaimTag,
  Mermaid,
  ModeGate,
  Plot,
  Prereq,
  Section,
  SourceTag,
  StepDerivation,
  Tex,
  TexBlock,
  useThemeTokens,
} from '@/components'
import { welch } from '@/simulation/signal'
import {
  bernoulliMoments,
  efbConstant,
  makeCtx,
  makeGrid,
  prbsProbability,
  simulateStrategy,
  toggleCycle,
} from '@/simulation/models/quantizer'
import { DEFAULT_LAB_PARAMS, Erratum, Fold, Hand, fx, n, ntex, num, tx } from '../common'
import { CHART_STOCHASTIC } from '../diagrams'

const FU_DEMO = 1e6
/** 「平均收斂多快」表的 Monte Carlo 次數（RMS 估計的相對誤差約 1/√(2·36) ≈ 12%）。 */
const MC_TRIALS = 36
/** p(1 − p)：p = frac(32.4) = 0.4 的 Bernoulli 變異（由 bernoulliMoments 計算，不手寫 0.24） */
const VAR_C = bernoulliMoments(32, 0.4).variance

/** 有限 N 的平均誤差：stochastic（Monte Carlo RMS）vs toggle / ΔΣ（確定性最壞值）。 */
function meanErrorTable() {
  const grid = makeGrid(32.4, 'rational', 0)
  // N 刻意不取 5 的倍數：toggle / ΔΣ 在整數個週期時平均誤差恰為 0，看不出 1/N 的界
  const Ns = [16, 128, 1024, 4096]
  // 36 次 × (16 + 128 + 1024 + 4096) ≈ 1.9e5 個 sample：留在主執行緒也只要幾毫秒（更大的 Monte Carlo 走 Web Worker）
  const trials = MC_TRIALS
  const ctx = makeCtx(DEFAULT_LAB_PARAMS, grid, 'stochastic', 20261010)
  const pattern = toggleCycle(32.4, 5).map((y) => y - 32.4)
  const ef = efbConstant({ target: 32.4, steps: Ns[Ns.length - 1] }).y.map((y) => y - 32.4)
  return Ns.map((N) => {
    // stochastic：MC_TRIALS 次獨立實驗的平均誤差 RMS（固定 seed，同一個亂數流連續取用）
    const W = new Float64Array(N).fill(grid.W0)
    let s2 = 0
    for (let t = 0; t < trials; t++) {
      const sim = simulateStrategy('stochastic', W, ctx, { freezeW: grid.W0, integer: true })
      let s = 0
      for (let i = 0; i < N; i++) s += sim.y[i] - 32.4
      s2 += (s / N) ** 2
    }
    // toggle：所有起始相位中最壞的 |平均誤差|
    let worstB = 0
    for (let ph = 0; ph < 5; ph++) {
      let s = 0
      for (let i = 0; i < N; i++) s += pattern[(i + ph) % 5]
      worstB = Math.max(worstB, Math.abs(s / N))
    }
    let sD = 0
    for (let i = 0; i < N; i++) sD += ef[i]
    return { N, rmsC: Math.sqrt(s2 / trials), theoryC: Math.sqrt(VAR_C / N), worstB, errD: Math.abs(sD / N) }
  })
}

export function StochasticSection() {
  const tokens = useThemeTokens()
  const m = bernoulliMoments(32, 0.4)
  const table = useMemo(meanErrorTable, [])
  const psd = useMemo(() => {
    const grid = makeGrid(32.4, 'rational', 0)
    const ctx = makeCtx(DEFAULT_LAB_PARAMS, grid, 'stochastic', 7)
    const W = new Float64Array(1 << 15).fill(grid.W0)
    const sim = simulateStrategy('stochastic', W, ctx, { freezeW: grid.W0, integer: true })
    const e = Float64Array.from(sim.y, (y) => y - 32.4)
    const ps = welch(e, FU_DEMO, { nperseg: 1024, window: 'hann' })
    return ps
  }, [])
  const prbsRows = useMemo(
    () =>
      [7, 9, 11, 15, 23].map((N) => {
        const pr = prbsProbability(0.4, N)
        return { N, period: 2 ** N - 1, p: pr, bias: pr - 0.4, spacing: FU_DEMO / (2 ** N - 1) }
      }),
    [],
  )
  const data = useMemo<Data[]>(
    () => [
      { x: psd.f, y: psd.psd, name: 'Welch PSD（模擬）', line: { color: tokens.series[3], width: 1 } },
      {
        x: [psd.f[1], psd.f[psd.f.length - 1]],
        y: [(2 * VAR_C) / FU_DEMO, (2 * VAR_C) / FU_DEMO],
        name: String.raw`理論 $2p(1-p)/f_u$`,
        line: { color: tokens.text, dash: 'dash', width: 1.5 },
      },
    ],
    [psd, tokens],
  )

  return (
    <Section kind="formula" title="§13.3 方法 C：Stochastic Rounding（隨機切換）" level={2} id="ch13-stochastic">
      <p>
        每次更新擲一枚「偏心硬幣」：以機率 <Tex>{'p=0.4'}</Tex>（<Tex>{'w^*'}</Tex> 的小數部分）輸出 33，否則 32，每次獨立。平均一定對，但每一刻的誤差是隨機的。
      </p>
      <Mermaid
        chart={CHART_STOCHASTIC}
        caption="方法 C 的方塊圖。和方法 B 比：計數器與固定 pattern 換成了藍色的亂數產生器與比較器，其餘相同；一樣沒有回授線。"
      />
      <p className="small ch13-figwalk">
        先看藍色兩塊：亂數產生器每次吐出一個均勻落在 0 到 1 之間的數（圖上的 rand，程式碼的 <code>c.rand()</code>），比 <Tex>{'p'}</Tex> 小就進位。再看右邊：圖上的 <Tex>{'X[n]'}</Tex> 是「這一拍有沒有進位」的 0 / 1 隨機變數（Bernoulli，下面的先備知識），
        輸出 <Tex>{String.raw`y[n]=32+X[n]`}</Tex>；圖上最後一格的 <Tex>{String.raw`E[y]`}</Tex> 與 <Tex>{String.raw`\mathrm{Var}(y)`}</Tex> 就是下面要手算的兩個動差（公式 F-13.6）。
      </p>
      <Prereq title="期望值、變異數與 Bernoulli 隨機變數">
        <p>
          <strong>期望值</strong> <Tex>{'E[X]'}</Tex>：把每個可能值乘上機率再加總，直覺上就是「做很多次的平均」。<strong>變異數</strong>
          <Tex>{String.raw`\mathrm{Var}(X)=E[(X-E[X])^2]=E[X^2]-(E[X])^2`}</Tex>：偏離平均的平方的平均，開根號就是 RMS 擾動。
        </p>
        <p>
          <strong>Bernoulli(<Tex>{'p'}</Tex>)</strong>：只取 1（機率 <Tex>{'p'}</Tex>）或 0（機率 <Tex>{'1-p'}</Tex>）。<Tex>{'E=p'}</Tex>、<Tex>{String.raw`E[X^2]=p`}</Tex>（因為 <Tex>{String.raw`1^2=1,\ 0^2=0`}</Tex>），所以
          <Tex>{String.raw`\mathrm{Var}=p-p^2=p(1-p)`}</Tex>。stochastic rounding 的 <Tex>{String.raw`y=32+X`}</Tex>，加常數不改變變異數。
        </p>
        <p>
          <strong>共變異數</strong> <Tex>{String.raw`\mathrm{Cov}(X,Y)=E[(X-E[X])(Y-E[Y])]=E[XY]-E[X]E[Y]`}</Tex>：兩個量「一起偏離平均」的程度。<Tex>{'X'}</Tex>、<Tex>{'Y'}</Tex> 獨立時為 0；為負時表示一個偏大、另一個傾向偏小（§13.4 的 <Tex>{'r[n-1]'}</Tex>、<Tex>{'r[n]'}</Tex> 就是負相關）。
        </p>
        <p>
          <strong>獨立平均的 <Tex>{String.raw`1/\sqrt N`}</Tex></strong>：<Tex>{'N'}</Tex> 個獨立樣本平均的變異數是 <Tex>{String.raw`\mathrm{Var}/N`}</Tex>，所以 RMS 誤差是 <Tex>{String.raw`\sigma/\sqrt N`}</Tex>。
        </p>
      </Prereq>
      <StepDerivation
        title="手算動差（用期望值的定義：「很多次的平均」）"
        steps={[
          { tex: String.raw`E[y]=0.6\times32+0.4\times33=19.2+13.2=${fx(m.mean, 1)}`, why: tx(String.raw`期望值 $=\sum(\text{值}\times\text{機率})$。`) },
          { tex: String.raw`E[y^2]=0.6\times32^2+0.4\times33^2=614.4+435.6=1050`, why: tx(String.raw`同樣的定義，套在 $y^2$ 上。`) },
          { tex: String.raw`\mathrm{Var}(y)=E[y^2]-(E[y])^2=1050-32.4^2=1050-1049.76=${fx(m.variance, 2)}`, why: tx(String.raw`變異數等於「平方的平均」減掉「平均的平方」：$\mathrm{Var}=E[y^2]-(E[y])^2$（先備知識）。`) },
          { tex: String.raw`\mathrm{Var}(y)=p(1-p)=0.4\times0.6=0.24\,\mathrm{LSB}^2`, why: tx(String.raw`一般化：只有兩個相差 1 的值時，變異數就是 $p(1-p)$。`) },
          { tex: String.raw`\sigma_y=\sqrt{0.24}=${fx(m.rms, 4)}\,\mathrm{LSB}\;\;\Rightarrow\;\;${fx(m.rms * DEFAULT_LAB_PARAMS.lsbFs, 4)}\,\mathrm{fs}`, why: tx(`RMS code noise；乘 $\\Delta_\\mathrm{LSB}=${DEFAULT_LAB_PARAMS.lsbFs}\\,\\mathrm{fs/LSB}$ 換成時間（E13）。`) },
        ]}
        result={String.raw`E[w_Q]=${fx(m.mean, 1)},\qquad \mathrm{Var}(w_Q)=${fx(m.variance, 2)}\,\mathrm{LSB}^2,\qquad \sigma=${fx(m.rms, 3)}\,\mathrm{LSB}`}
      />
      <TexBlock id="F-13.6">{String.raw`E[y]=\lfloor w^*\rfloor+p,\qquad \mathrm{Var}(y)=p(1-p),\qquad S_e^{(1)}(f)=\frac{2p(1-p)}{f_u}\quad(0<f<f_u/2)`}</TexBlock>
      <p>
        公式最後一項的 <Tex>{String.raw`S_e^{(1)}(f)`}</Tex> 是 code 誤差 <Tex>{'e'}</Tex> 的 one-sided PSD（功率頻譜密度：每 Hz 有多少功率，單位 <Tex>{String.raw`\mathrm{LSB}^2/\mathrm{Hz}`}</Tex>；下面的先備知識會解釋）。
      </p>
      <p>
        <ClaimTag kind="exact" /> 注意：<strong>總誤差功率 <Tex>{String.raw`${fx(m.variance, 2)}\,\mathrm{LSB}^2`}</Tex> 與 toggle 完全相同</strong>（任何只用 32/33、平均 32.4 的方案都是 <Tex>{String.raw`p(1-p)`}</Tex>）。差別只在頻譜：toggle 的
        功率集中在兩條譜線；stochastic 的功率平均攤在 0 到 <Tex>{String.raw`f_u/2`}</Tex> 的所有頻率（白雜訊）。
      </p>
      <Hand id="HC-13.4">
        把 <Tex>{'w^*'}</Tex> 換成 32.25 或 32.5，先自己算 <Tex>{'p(1-p)'}</Tex> 與它的根號，再算「平均 <Tex>{'N'}</Tex> 次之後還剩多少誤差」——<Tex>{'p=0.5'}</Tex> 時 code noise 最大。
      </Hand>

      <Prereq title="功率頻譜密度（PSD）與白雜訊">
        <p>
          PSD <Tex>{'S(f)'}</Tex> 告訴你「每 Hz 有多少功率」，單位是 <Tex>{String.raw`(\text{訊號單位})^2/\mathrm{Hz}`}</Tex>，本章為 <Tex>{String.raw`\mathrm{LSB}^2/\mathrm{Hz}`}</Tex>。把 PSD 在一段頻率上積分，就得到那段頻率的功率；
          從 0 積到 <Tex>{'f_u/2'}</Tex> 就是總功率（one-sided 約定，dev-conventions §5）。<strong>白雜訊</strong>的 PSD 是常數：每個頻率的功率一樣多。
          譜線（週期訊號）在 PSD 圖上會變成高度與視窗 ENBW 有關的尖峰，所以線功率要用 <Tex>{String.raw`\sum_{\text{lobe}}S\,\Delta f`}</Tex> 或精確 DFT 量（規格 §15.5）。
        </p>
        <p>
          <strong>自相關（autocorrelation）</strong> <Tex>{String.raw`R_e[\ell]=E\big[e[n]\,e[n+\ell]\big]`}</Tex>：同一個訊號相隔 <Tex>{String.raw`\ell`}</Tex> 個 sample 的相關程度。PSD 就是它的 DTFT（Wiener–Khinchin）：
          <Tex>{String.raw`S_e(e^{j\Omega})=\sum_\ell R_e[\ell]e^{-j\Omega\ell}`}</Tex>，換成 one-sided、每 Hz 要乘 <Tex>{'2/f_u'}</Tex>（勘誤 E28 的換算）。白雜訊 = 只有 <Tex>{String.raw`R_e[0]\neq0`}</Tex>。
        </p>
        <p className="small">
          相關勘誤：<Erratum id="E47" />（toggle 的線功率）。
        </p>
      </Prereq>
      <Plot
        title={String.raw`Stochastic rounding 的 code 誤差 PSD：白色、高度 $2p(1-p)/f_u$`}
        ariaLabel="Stochastic rounding 的 code 誤差 PSD：白色，高度 2p(1−p)/f_u"
        data={data}
        height={260}
        yLog
        csvName="ch13-stochastic-psd"
        layout={{ xaxis: { title: { text: String.raw`$f$ [Hz]（$f_u = 1\,\mathrm{MHz}$）` } }, yaxis: { title: { text: String.raw`PSD [$\mathrm{LSB}^2/\mathrm{Hz}$]` } } }}
        caption={
          <>
            Welch：Hann、nperseg {psd.nperseg}、{psd.nSegments} 段、ENBW {n(psd.enbwHz, 4)} Hz、one-sided、<Tex>{String.raw`\mathrm{LSB}^2/\mathrm{Hz}`}</Tex>；<Tex>{'2^{15}'}</Tex> 個 sample（seed 7）。虛線是理論值{' '}
            <Tex>{String.raw`2p(1-p)/f_u=${ntex((2 * VAR_C) / FU_DEMO, 3)}\ \mathrm{LSB}^2/\mathrm{Hz}`}</Tex>。
          </>
        }
      />
      <SourceTag kind="simulation" />

      <h3>平均收斂得多快？隨機 vs 確定性</h3>
      <p>
        <Tex>{'N'}</Tex> 個 sample 的平均誤差：隨機方案以 <Tex>{String.raw`\sigma/\sqrt N`}</Tex> 慢慢變小（獨立樣本平均的變異數是 <Tex>{String.raw`\sigma^2/N`}</Tex>，見先備知識）；toggle 與 ΔΣ
        是確定性的，部分和有界，誤差以 <Tex>{String.raw`1/N`}</Tex> 變小。
      </p>
      <div className="table-wrap">
        <table className="ch13-table" aria-label="N 個 sample 的平均誤差：stochastic 的 Monte Carlo RMS 對照 toggle 與 ΔΣ 的確定性上界">
          <thead>
            <tr>
              <th>
                <Tex>{'N'}</Tex>
              </th>
              <th>(C) 平均誤差 RMS（MC {MC_TRIALS} 次）</th>
              <th>
                (C) 理論 <Tex>{String.raw`\sqrt{p(1-p)/N}=\sqrt{${fx(VAR_C, 2)}/N}`}</Tex>
              </th>
              <th>(B) 最壞 |平均誤差|（5 個起始相位）</th>
              <th>
                (D) |平均誤差|（<Tex>{'r[-1]=0'}</Tex>）
              </th>
            </tr>
          </thead>
          <tbody>
            {table.map((r) => (
              <tr key={r.N}>
                <td>{r.N}</td>
                <td>{fx(r.rmsC, 5)}</td>
                <td>{fx(r.theoryC, 5)}</td>
                <td>{fx(r.worstB, 5)}</td>
                <td>{fx(r.errD, 5)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        (B) 的部分和 <Tex>{String.raw`\big|\sum_{n<N}e[n]\big|`}</Tex> 在任何起始相位下都不超過 0.8（例如從 <Tex>{'e=0.6'}</Tex> 起算：<Tex>{String.raw`0.6,\,0.2,\,0.8,\,0.4,\,0`}</Tex>），所以最壞是 <Tex>{String.raw`0.8/N`}</Tex>；(D) 由 §13.4 的 telescoping 公式，
        <Tex>{String.raw`|\text{平均誤差}|=|r[-1]-r[N-1]|/N\le1/N`}</Tex>。
        <ClaimTag kind="exact" />（B、D） <ClaimTag kind="approx" />（C：有限次 Monte Carlo）
      </p>

      <Callout kind="warn" title="規格的 PRBS 警告：有限長度的「隨機」其實是週期的">
        <p>
          硬體常用 N-bit LFSR（PRBS）代替真亂數。PRBS 每 <Tex>{'2^N-1'}</Tex> 個字重複一次，所以 code 誤差變成週期 <Tex>{'2^N-1'}</Tex> 的序列，
          在 <Tex>{String.raw`k\,f_u/(2^N-1)`}</Tex> 出現細密的<strong>譜線</strong>；而且 LFSR 不會產生 0，所以亂數 <Tex>{'u'}</Tex>（方塊圖上的 rand，均勻落在 <Tex>{'[0,1)'}</Tex>）比 <Tex>{'p'}</Tex> 小的機率 <Tex>{String.raw`P(u<p)`}</Tex> 也不剛好等於 <Tex>{'p'}</Tex>：
        </p>
        <div className="table-wrap">
          <table className="ch13-table" aria-label="PRBS 長度 N 對應的週期、輸出 33 的精確機率、平均偏差與譜線間距">
            <thead>
              <tr>
                <th>
                  PRBS <Tex>{'N'}</Tex>
                </th>
                <th>
                  週期 <Tex>{'2^N-1'}</Tex>
                </th>
                <th>
                  <Tex>{'P(y=33)'}</Tex>（一整個週期的精確值）
                </th>
                <th>平均偏差 [LSB]</th>
                <th>
                  譜線間距（<Tex>{String.raw`f_u=1\,\mathrm{MHz}`}</Tex>）
                </th>
              </tr>
            </thead>
            <tbody>
              {prbsRows.map((r) => (
                <tr key={r.N}>
                  <td>{r.N}</td>
                  <td>{r.period}</td>
                  <td>{fx(r.p, 7)}</td>
                  <td>
                    <Tex>{ntex(r.bias, 3)}</Tex>
                  </td>
                  <td>{num(r.spacing, 4)} Hz</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small">
          <Tex>{String.raw`P(33)=\frac{\lceil p\,2^N\rceil-1}{2^N-1}`}</Tex>（由 <code>prbsProbability()</code> 計算；<Tex>{'N=7'}</Tex> 時為 <Tex>{String.raw`\lceil 51.2\rceil-1=51`}</Tex>，即 <Tex>{'51/127'}</Tex>）。PRBS 越長，偏差越小、譜線越密（越像白雜訊）。實驗中可切換「ideal / PRBS」親眼看到週期 127 的偵測結果。
          <ClaimTag kind="exact" />
        </p>
      </Callout>

      <ModeGate min="research">
        <Fold title="研究模式：為什麼 i.i.d. 的 PSD 是平的？" openFrom="research">
          <StepDerivation
            steps={[
              { tex: String.raw`R_e[\ell]=E\big[(e[n]-\bar e)(e[n+\ell]-\bar e)\big]=\begin{cases}0.24,&\ell=0\\0,&\ell\ne0\end{cases}`, why: tx(String.raw`不同時刻獨立 $\Rightarrow$ 交叉項的期望值 = 期望值的乘積 = 0。`) },
              { tex: String.raw`S_e(e^{j\Omega})=\sum_{\ell}R_e[\ell]e^{-j\Omega\ell}=0.24`, why: tx(String.raw`PSD 是自相關的 DTFT；只有 $\ell=0$ 一項。`) },
              { tex: String.raw`S_e^{(1)}(f)=\frac{2}{f_u}S_e(e^{j2\pi f/f_u})=\frac{0.48}{f_u}`, why: tx(String.raw`換成 one-sided、每 Hz（勘誤 E28 的換算：乘 $2/f_u$）。`) },
              { tex: String.raw`\int_0^{f_u/2}S_e^{(1)}df=\frac{0.48}{f_u}\cdot\frac{f_u}2=0.24`, why: '積分回總功率，檢查一致。' },
            ]}
          />
        </Fold>
      </ModeGate>

    </Section>
  )
}
