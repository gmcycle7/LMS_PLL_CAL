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
  StepDerivation,
  Tex,
  TexBlock,
  useThemeTokens,
} from '@/components'
import {
  TOGGLE_PATTERN_5,
  efbConstant,
  efbPeriod,
  gcd,
  isRotation,
  lineSpectrum,
  makeGrid,
  mod,
  ntfGain2,
} from '@/simulation/models/quantizer'
import { Erratum, Fold, Hand, fx, ntex, tx } from '../common'
import { CHART_EFB_LOOP, CHART_LIMIT_CYCLE, CHART_NTF_PATHS, CHART_PERIOD_FLOW, CHART_TELESCOPING } from '../diagrams'

const R_INITS = [0, 0.1, -0.3, 1 / 7, 0.49]

export function DeltaSigmaSection() {
  const tokens = useThemeTokens()
  const r = useMemo(() => {
    const near = efbConstant({ target: 32.4, steps: 12 })
    const flr = efbConstant({ target: 32.4, steps: 12, rounding: 'floor' })
    const long = efbConstant({ target: 32.4, steps: 500 })
    const e = long.y.map((y) => y - 32.4)
    const pow = e.reduce((a, x) => a + x * x, 0) / e.length
    // 500 點 = 100 個完整週期：以「循環」方式配對 (r[n−1], r[n])，平均、變異數與共變異數都是精確的週期平均
    const Nr = long.r.length
    const meanR = long.r.reduce((a, x) => a + x, 0) / Nr
    const varR = long.r.reduce((a, x) => a + (x - meanR) ** 2, 0) / Nr
    let cov = 0
    for (let i = 0; i < Nr; i++) cov += (long.r[i] - meanR) * (long.r[(i + Nr - 1) % Nr] - meanR)
    cov /= Nr
    const accept = R_INITS.map((r0) => {
      const o = efbConstant({ target: 32.4, steps: 60, rInit: r0 })
      const cyc = o.y.slice(10, 15)
      let period = 0
      for (let P = 1; P <= 20; P++) {
        let ok = true
        for (let i = 10; i + P < 60; i++) if (o.y[i + P] !== o.y[i]) ok = false
        if (ok) {
          period = P
          break
        }
      }
      return { r0, cyc, period, shift: isRotation(cyc, TOGGLE_PATTERN_5) }
    })
    const fixedRows = [8, 10, 12, 16, 20].map((F) => {
      const g = makeGrid(32.4, 'fixed', F)
      const f = mod(g.W0, g.D)
      return { F, K: g.W0, rep: g.represented, frac: f, g: gcd(f, g.D), period: efbPeriod(g.W0, g.D) }
    })
    // F = 10：一個週期 512 的精確線譜
    const o10 = efbConstant({ target: 32.4, steps: 3 * 512, arithmetic: 'fixed', fracBits: 10 })
    const seg10 = o10.y.slice(512, 1024).map((y) => y - 32.4)
    const ls10 = lineSpectrum(seg10)
    const top10 = ls10.filter((l) => l.k > 0).sort((a, b) => b.power - a.power).slice(0, 6)
    const low10 = ls10.filter((l) => l.k > 0 && l.k <= 8)
    const lowSum = low10.reduce((a, l) => a + l.power, 0)
    // 主線（最大）與它左右 ±1 的 sideband；f_u/5 附近的最大線
    const main = top10[0]
    const sideL = ls10[main.k - 1]
    const sideR = ls10[main.k + 1]
    const near5 = ls10.filter((l) => Math.abs(l.k / 512 - 0.2) < 0.01).sort((a, b) => b.power - a.power)[0]
    // 精確 32.4（週期 5）的主線功率，用來和 F = 10 的主線比較
    const exactMain = Math.max(...lineSpectrum(near.y.slice(0, 5).map((y) => y - 32.4)).filter((l) => l.k > 0).map((l) => l.power))
    return { near, flr, pow, varR, cov, accept, fixedRows, top10, lowSum, ls10, main, sideL, sideR, near5, exactMain }
  }, [])

  const ntf = useMemo(() => {
    const f: number[] = []
    const mag: number[] = []
    const approx: number[] = []
    for (let i = 1; i <= 400; i++) {
      const x = 10 ** (-3 + (Math.log10(0.5) + 3) * (i / 400)) // f/f_u ∈ [1e-3, 0.5]
      f.push(x)
      mag.push(10 * Math.log10(ntfGain2(x)))
      approx.push(10 * Math.log10((2 * Math.PI * x) ** 2))
    }
    return { f, mag, approx }
  }, [])
  const ntfData = useMemo<Data[]>(
    () => [
      { x: ntf.f, y: ntf.mag, name: String.raw`$|1 - e^{-j\Omega}|^2 = 4\sin^2(\pi f/f_u)$`, line: { color: tokens.series[1], width: 2 } },
      { x: ntf.f, y: ntf.approx, name: String.raw`低頻近似 $(2\pi f/f_u)^2$：+20 dB/dec`, line: { color: tokens.textMuted, dash: 'dash', width: 1 } },
    ],
    [ntf, tokens],
  )
  const timeline = useMemo<Data[]>(() => {
    const o = efbConstant({ target: 32.4, steps: 20 })
    const x = o.y.map((_, i) => i)
    return [
      { x, y: o.v, name: String.raw`$v[n] = w_H + r[n-1]$`, mode: 'lines+markers', line: { color: tokens.series[2], width: 1 } },
      { x, y: o.y, name: String.raw`$y[n]$（6-bit code）`, mode: 'lines+markers', line: { shape: 'hv', color: tokens.series[1], width: 2 } },
      { x, y: x.map(() => 32.4), name: String.raw`$w_H = 32.4$`, line: { color: tokens.textMuted, dash: 'dot' } },
      { x, y: o.r.map((v) => 32 + v), name: String.raw`$32 + r[n]$`, mode: 'markers', marker: { color: tokens.series[4], symbol: 'diamond' } },
    ]
  }, [tokens])

  return (
    <Section kind="formula" title="§13.4 方法 D：高解析 accumulator + 一階 ΔΣ（Error Feedback）" level={2} id="ch13-deltasigma">
      <p>
        這和 Fractional-N PLL 的 DSM 是同一個想法：保留高解析的 <Tex>{String.raw`w_H`}</Tex>，每次輸出整數 code 時把「這次欠下的小數」記在
        <Tex>{'r'}</Tex> 裡，下次加回去。
      </p>
      <Mermaid
        chart={CHART_EFB_LOOP}
        caption="一階 error-feedback ΔΣ 的迴圈。先看上排：$w_H$ 加上「上次欠的」$r[n-1]$ 得到 $v$，量化成整數 $y$；再看藍色的下排：$v$ 減 $y$ 就是這次欠的 $r$，存進暫存器（$z^{-1}$），下一拍加回去。"
      />
      <p className="small ch13-figwalk">
        圖上三條線上的式子就是下面的三行方程式：<Tex>{'v[n]'}</Tex> 是量化器的輸入（高解析值加上上次的欠帳）、<Tex>{'y[n]'}</Tex> 是輸出的 6-bit code、<Tex>{'r[n]'}</Tex> 是這一拍的量化誤差（residual）。圖上的{' '}
        <Tex>{String.raw`z^{-1}`}</Tex> 是「延遲一拍」的暫存器，也就是程式碼裡的 <code>s.r</code>：這一拍存進去的 <Tex>{'r[n]'}</Tex>，下一拍讀出來時就是 <Tex>{'r[n-1]'}</Tex>。和方法 B、C 的圖比，多出來的就是這條藍色的回授線。
      </p>
      <TexBlock>{String.raw`\begin{aligned}v[n]&=w_H[n]+r[n-1]\\ y[n]&=Q_6\big(v[n]\big)\\ r[n]&=v[n]-y[n]\end{aligned}`}</TexBlock>
      <p>
        先不推公式，直接用數字跑一次（numbers first）：
      </p>
      <h3>手算：<Tex>{String.raw`w_H=32.4`}</Tex>、round-half-up、<Tex>{String.raw`r[-1]=0`}</Tex></h3>
      <div className="table-wrap">
        <table className="ch13-table" aria-label="一階 ΔΣ 手算表：round-half-up 與 floor 兩種量化的 v、y、r">
          <thead>
            <tr>
              <th>
                <Tex>{'n'}</Tex>
              </th>
              <th>
                <Tex>{'v=32.4+r[n-1]'}</Tex>
              </th>
              <th>
                <Tex>{String.raw`y=\lfloor v+\tfrac12\rfloor`}</Tex>
              </th>
              <th>
                <Tex>{'r=v-y'}</Tex>
              </th>
              <th>
                floor 版 <Tex>{'y'}</Tex>
              </th>
              <th>
                floor 版 <Tex>{'r'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {r.near.y.slice(0, 10).map((y, i) => (
              <tr key={i} className={i % 5 === 4 ? 'ch13-row-sep' : undefined}>
                <td>{i}</td>
                <td>{fx(r.near.v[i], 1)}</td>
                <td>{y}</td>
                <td>{fx(r.near.r[i], 1)}</td>
                <td>{r.flr.y[i]}</td>
                <td>{fx(r.flr.r[i], 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Mermaid
        chart={CHART_LIMIT_CYCLE}
        caption="把上表（round-half-up 的三欄）畫成狀態圖：每個方塊是暫存器裡的 $r$，箭頭上是這一拍的 $v$ 與輸出 $y$。從 $r=0$ 出發，走 5 步回到 $r=0$，之後永遠繞同一圈——這就是 limit cycle。"
      />
      <p className="small ch13-figwalk">
        先看任何一個箭頭：<Tex>{'r'}</Tex> 每走一步就加上小數 0.4，只要 <Tex>{'v'}</Tex> 的小數部分達到 <Tex>{String.raw`\tfrac12`}</Tex> 就進位（<Tex>{'y=33'}</Tex>）並從 <Tex>{'r'}</Tex> 扣掉 1。再數一圈：五個箭頭裡兩個{' '}
        <Tex>{'y=33'}</Tex>、三個 <Tex>{'y=32'}</Tex>，平均 32.4。圖上五個狀態的值 <Tex>{String.raw`0.4,\,-0.2,\,0.2,\,-0.4,\,0`}</Tex> 就是後面證明裡的{' '}
        <Tex>{String.raw`r[n]\equiv r[-1]+(n+1)\cdot0.4\pmod 1`}</Tex>（取在 <Tex>{String.raw`[-\tfrac12,\tfrac12)`}</Tex> 內的那個值）：狀態只有 5 個，所以一定繞回來。
      </p>
      <Plot
        title={String.raw`$\Delta\Sigma$ 內部 accumulator：$v$、$y$ 與 $r$（前 20 個更新）`}
        ariaLabel="ΔΣ 內部 accumulator：v、y 與 r（前 20 個更新）"
        data={timeline}
        height={260}
        csvName="ch13-efb-timeline"
        layout={{ xaxis: { title: { text: String.raw`$n$（code 更新）` } }, yaxis: { title: { text: 'LSB' } } }}
        caption={
          <>
            由 <code>efbConstant()</code>（精確有理數）計算；<Tex>{String.raw`r[0..4]=${r.near.r.slice(0, 5).map((v) => fx(v, 1)).join(',\\ ')}`}</Tex>，然後重複。菱形畫的是 <Tex>{'32+r[n]'}</Tex>，方便和 code 放在同一張圖。
          </>
        }
      />
      <Prereq title="Z transform：把「延遲一個 sample」寫成乘法">
        <p>
          序列 <Tex>{'r[n]'}</Tex> 的 Z transform <Tex>{String.raw`R(z)=\sum_n r[n]z^{-n}`}</Tex>（<Tex>{'z'}</Tex> 是一個複數變數；只要把它當成「記錄延遲的記號」即可）。把序列延遲一格{' '}
          <Tex>{'r[n-1]'}</Tex>，代入定義、令 <Tex>{'m=n-1'}</Tex>：
          <Tex>{String.raw`\sum_n r[n-1]z^{-n}=z^{-1}\sum_m r[m]z^{-m}=z^{-1}R(z)`}</Tex>。所以「延遲一個 sample」就是乘 <Tex>{String.raw`z^{-1}`}</Tex>。
          頻率響應：把 <Tex>{String.raw`z=e^{j\Omega}`}</Tex>（單位圓上的點）代入，<Tex>{String.raw`\Omega=2\pi f/f_u`}</Tex> 是每個 sample 轉多少弧度（離散時間頻率；<Tex>{String.raw`\Omega=\pi`}</Tex> 對應 Nyquist <Tex>{'f_u/2'}</Tex>）。
          <Tex>{String.raw`|H(e^{j\Omega})|^2`}</Tex> 就是頻率 <Tex>{'f'}</Tex> 的功率放大倍數。
        </p>
      </Prereq>
      <Mermaid
        chart={CHART_NTF_PATHS}
        caption="同一個迴圈在 $z$ 域的樣子。先看上面一條：$w_H$ 原封不動到輸出（增益 1）；再看藍色的一條：量化誤差 $r$ 要先經過 $1-z^{-1}$（現在的減掉上一次的）才到輸出，所以慢慢變的誤差幾乎被消掉、快速變的被放大。"
      />
      <p className="small ch13-figwalk">
        圖上的 <Tex>{'W_H(z)'}</Tex>、<Tex>{'R(z)'}</Tex>、<Tex>{'Y(z)'}</Tex> 是 <Tex>{'w_H[n]'}</Tex>、<Tex>{'r[n]'}</Tex>、<Tex>{'y[n]'}</Tex> 的 Z transform。圖上藍色方塊就是公式裡的{' '}
        <Tex>{String.raw`\mathrm{NTF}(z)=1-z^{-1}`}</Tex>（noise transfer function：誤差到輸出的轉移函數）；它進加法點的負號，就是公式 F-13.7 裡 <Tex>{String.raw`(1-z^{-1})R(z)`}</Tex> 前面的負號。下面四步推導就是在證明這張圖。
      </p>
      <StepDerivation
        title={<>推導 <Tex>{'y=w_H+r[n-1]-r[n]'}</Tex></>}
        steps={[
          { tex: String.raw`r[n]=v[n]-y[n]\;\Rightarrow\;y[n]=v[n]-r[n]`, why: '第三式移項：輸出等於量化器輸入減掉量化誤差。' },
          { tex: String.raw`y[n]=\big(w_H[n]+r[n-1]\big)-r[n]`, why: tx(String.raw`把第一式 $v[n]$ 代入。`) },
          { tex: String.raw`Y(z)=W_H(z)+z^{-1}R(z)-R(z)=W_H(z)-(1-z^{-1})R(z)`, why: tx(String.raw`取 Z transform：$r[n-1]\leftrightarrow z^{-1}R(z)$（延遲一個 sample，見先備知識）。`) },
          { tex: String.raw`\mathrm{NTF}(z)=1-z^{-1}`, why: tx(String.raw`誤差 $r$ 經過 $1-z^{-1}$ 才到輸出：一階 high-pass 的 noise transfer function。`) },
        ]}
        result={String.raw`y[n]=w_H[n]+r[n-1]-r[n]`}
      />
      <TexBlock id="F-13.7">{String.raw`y[n]=w_H[n]+r[n-1]-r[n]\;\Longleftrightarrow\;Y(z)=W_H(z)-(1-z^{-1})R(z)`}</TexBlock>
      <p>
        <ClaimTag kind="exact" /> 這個等式不需要任何假設。但它<strong>沒有說 <Tex>{'r'}</Tex> 是白雜訊</strong>，也不保證沒有 limit cycle（規格 §13.4 的提醒）。上面的手算表已經看到：
        <Tex>{'r'}</Tex> 以 5 為週期重複，所以 <Tex>{'y'}</Tex> 也一樣。
      </p>

      <Fold title="NTF 的頻率響應：為什麼叫 noise shaping">
        <StepDerivation
          steps={[
            { tex: String.raw`\mathrm{NTF}(e^{j\Omega})=1-e^{-j\Omega},\qquad \Omega=2\pi f/f_u`, why: tx(String.raw`在單位圓上 $z=e^{j\Omega}$（頻率響應的定義）。`) },
            { tex: String.raw`1-e^{-j\Omega}=e^{-j\Omega/2}\big(e^{j\Omega/2}-e^{-j\Omega/2}\big)=e^{-j\Omega/2}\cdot2j\sin(\Omega/2)`, why: tx(String.raw`提出半角的相位，再用 Euler：$e^{j\theta}-e^{-j\theta}=2j\sin\theta$。`) },
            { tex: String.raw`|\mathrm{NTF}|^2=4\sin^2(\Omega/2)=4\sin^2(\pi f/f_u)`, why: tx(String.raw`$|e^{-j\Omega/2}|=|j|=1$。`) },
            { tex: String.raw`|\mathrm{NTF}|^2\approx(2\pi f/f_u)^2\quad(f\ll f_u)`, why: tx(String.raw`小角度 $\sin x\approx x$（泰勒一階）：功率每 10 倍頻率增加 20 dB。`) },
            { tex: String.raw`|\mathrm{NTF}(f_u/2)|^2=4`, why: tx(String.raw`在 Nyquist（$\Omega=\pi$）達最大值 4（+6 dB）：誤差被「推」到高頻。`) },
          ]}
        />
        <Plot
          title="一階 NTF 的功率響應"
          data={ntfData}
          height={250}
          xLog
          csvName="ch13-ntf"
          layout={{ xaxis: { title: { text: String.raw`$f / f_u$` } }, yaxis: { title: { text: String.raw`$|\mathrm{NTF}|^2$ [dB]` } } }}
          caption={
            <>
              實線 <Tex>{String.raw`|1-e^{-j\Omega}|^2=4\sin^2(\pi f/f_u)`}</Tex>；虛線是低頻近似 <Tex>{String.raw`(2\pi f/f_u)^2`}</Tex>（每 decade <Tex>{String.raw`+20\,\mathrm{dB}`}</Tex>）。
            </>
          }
        />
        <TexBlock id="F-13.9">{String.raw`S_e^{(1)}(f)\overset{?}{\approx}4\sin^2\!\Big(\frac{\pi f}{f_u}\Big)\frac{2\sigma_r^2}{f_u},\qquad \sigma_r^2=\frac1{12}\;\Rightarrow\;\int_0^{f_u/2}S_e^{(1)}df=2\sigma_r^2=\frac16`}</TexBlock>
        <p className="small">
          其中 <Tex>{String.raw`\sigma_r^2`}</Tex> 是 <Tex>{'r'}</Tex> 的變異數，<Tex>{String.raw`S_e^{(1)}(f)`}</Tex> 是 code 誤差 <Tex>{'e'}</Tex> 的 one-sided PSD（每 Hz 的功率）。 <ClaimTag kind="approx" /> 這是「<Tex>{'r'}</Tex> 為白色、均勻」的近似（打問號是因為對常數輸入它是錯的，下面就會看到實際是 <Tex>{String.raw`${fx(r.pow, 2)}\,\mathrm{LSB}^2`}</Tex>，<Erratum id="E15" />）。
        </p>
      </Fold>

      <Fold title="ΔΣ 的「平均追蹤」：telescoping（伸縮相消）" openFrom="beginner">
        <Mermaid
          chart={CHART_TELESCOPING}
          caption="同一個迴圈換個畫法。先看藍色方塊：$r$ 其實是「$w_H$ 減 $y$」的累加器；再看右邊：累加器的內容永遠有界，所以 $N$ 次的總誤差只剩頭尾兩個 $r$，平均誤差隨 $1/N$ 變小。"
        />
        <p className="small ch13-figwalk">
          圖上累加器的式子 <Tex>{String.raw`r[n]=r[n-1]+(w_H[n]-y[n])`}</Tex> 只是把 <Tex>{'r=v-y'}</Tex> 與 <Tex>{'v=w_H+r[n-1]'}</Tex> 合成一行；圖上的{' '}
          <Tex>{String.raw`\sum(y-w_H)=r[-1]-r[N-1]`}</Tex> 除以 <Tex>{'N'}</Tex> 就是下面的公式 F-13.12。這和 Fractional-N 的 DSM 是同一個道理：累加器不溢出，長期平均就一定對。
        </p>
        <StepDerivation
          steps={[
            { tex: String.raw`\sum_{n=0}^{N-1}\big(y[n]-w_H[n]\big)=\sum_{n=0}^{N-1}\big(r[n-1]-r[n]\big)`, why: tx(String.raw`把 $y-w_H=r[n-1]-r[n]$ 加總。`) },
            { tex: String.raw`=r[-1]-r[0]+r[0]-r[1]+\cdots+r[N-2]-r[N-1]=r[-1]-r[N-1]`, why: '相鄰項互相抵消，只剩頭尾。' },
            { tex: String.raw`\Big|\frac1N\sum_{n=0}^{N-1}(y[n]-w_H[n])\Big|\le\frac{|r[-1]|+|r[N-1]|}{N}\le\frac1N`, why: tx(String.raw`round-half-up 時 $|r|\le\tfrac12$（沒有 overload 時）。`) },
          ]}
        />
        <TexBlock id="F-13.12">{String.raw`\frac1N\sum_{n=0}^{N-1}\big(y[n]-w_H[n]\big)=\frac{r[-1]-r[N-1]}{N}`}</TexBlock>
        <p>
          <ClaimTag kind="exact" /> 對<strong>任何</strong>時變的 <Tex>{'w_H[n]'}</Tex> 都成立：ΔΣ 的輸出平均永遠追得上內部的高解析值。這是它勝過 Freeze 與 toggle 的地方（PVT 追蹤，§13.5）。
        </p>
      </Fold>
      <Hand id="HC-13.5">
        拿一張紙畫四欄（<Tex>{'n'}</Tex>、<Tex>{'v'}</Tex>、<Tex>{'y'}</Tex>、<Tex>{'r'}</Tex>），把 <Tex>{'w_H'}</Tex> 換成 32.25 或 32.6、<Tex>{'r[-1]'}</Tex> 換成 0.25，自己跑 6 列；再把 mode 改成 1（floor）重跑一次，看輸出是不是只差循環移位，最後用{' '}
        <Tex>{String.raw`\sum(y-w_H)=r[-1]-r[5]`}</Tex> 檢查整張表。
      </Hand>

      <Callout kind="danger" title="勘誤 E15：常數有理輸入「必然」進入 limit cycle，而且就是方法 B">
        <p>
          規格寫「常數有理輸入時，仍<strong>可能</strong>產生週期性序列」——語氣太弱。對 <Tex>{String.raw`w_H=32.4=162/5`}</Tex>，一階 EFB
          <strong>必然</strong>進入週期 5 的 limit cycle：floor 版輸出 <Tex>{String.raw`[${r.flr.y.slice(0, 5).join(',')}]`}</Tex> 與方法 B
          <strong>完全相同</strong>；round-half-up 版輸出 <Tex>{String.raw`[${r.near.y.slice(0, 5).join(',')}]`}</Tex>，是 B 的循環移位。兩者的頻譜、spur、總誤差功率（<Tex>{String.raw`${fx(r.pow, 2)}\,\mathrm{LSB}^2`}</Tex>）全都一樣。
          所以對靜態目標，<strong>ΔΣ 並不比 toggle 少 tone</strong>。 <Erratum id="E15" /> <ClaimTag kind="exact" />
        </p>
      </Callout>

      <Prereq title="mod 與 gcd（最大公因數）">
        <p>
          <Tex>{String.raw`a\bmod q`}</Tex> 是 <Tex>{'a'}</Tex> 除以 <Tex>{'q'}</Tex> 的餘數（本章取 <Tex>{String.raw`0,\dots,q-1`}</Tex>）；對實數，<Tex>{String.raw`x\bmod1=\mathrm{frac}(x)`}</Tex>。
          <Tex>{String.raw`\gcd(a,b)`}</Tex> 是最大公因數，例如 <Tex>{String.raw`\gcd(410,1024)=2`}</Tex>。若 <Tex>{String.raw`\gcd(m,q)=1`}</Tex>（互質），則 <Tex>{String.raw`0,m,2m,\dots`}</Tex> 除以{' '}
          <Tex>{'q'}</Tex> 的餘數要走完全部 <Tex>{'q'}</Tex> 個值才會重複（若 <Tex>{String.raw`jm\equiv0\pmod q`}</Tex> 且 <Tex>{'0<j<q'}</Tex>，則 <Tex>{'q'}</Tex> 整除 <Tex>{'jm'}</Tex>，又因互質，所以 <Tex>{'q'}</Tex> 整除{' '}
          <Tex>{'j'}</Tex>，矛盾）——這就是週期 = <Tex>{'q'}</Tex> 的原因。
        </p>
      </Prereq>
      <StepDerivation
        title={<>證明：常數 <Tex>{'c=m/q'}</Tex>（最簡分數）<Tex>{String.raw`\Rightarrow`}</Tex> 週期恰為 <Tex>{'q'}</Tex>，與初始 <Tex>{'r'}</Tex> 無關</>}
        steps={[
          { tex: String.raw`r[n]=r[n-1]+c-y[n],\qquad y[n]\in\mathbb Z`, why: tx(String.raw`由 $v=c+r[n-1]$ 與 $r=v-y$。`) },
          { tex: String.raw`r[n]\equiv r[n-1]+c\pmod 1`, why: tx(String.raw`減掉整數 $y[n]$ 不改變「除以 1 的餘數」（小數部分）。`) },
          { tex: String.raw`r[n]\equiv r[-1]+(n+1)\,c\pmod 1`, why: tx(String.raw`重複上一步 $n+1$ 次（數學歸納）。`) },
          { tex: String.raw`r[n]\in[-\tfrac12,\tfrac12)\;\Rightarrow\;r[n]=\Big(\big(r[-1]+(n+1)c+\tfrac12\big)\bmod 1\Big)-\tfrac12`, why: tx(String.raw`長度為 1 的半開區間內，每個餘數只對應一個值 $\Rightarrow$ $r[n]$ 被唯一決定（$r[-1]$ 超出範圍時最多 1 個 sample 暫態）。`) },
          { tex: String.raw`(n+1)\frac mq\bmod 1\ \text{的週期}=q\quad(\gcd(m,q)=1)`, why: tx(String.raw`$nm\bmod q$ 在 $n=0,\dots,q-1$ 走遍所有 $q$ 個餘數後才回到起點（互質）。`) },
          { tex: String.raw`y[n]=c+r[n-1]-r[n]\ \text{也以 }q\text{ 為週期}`, why: tx(String.raw`$y$ 由 $r$ 決定。`) },
        ]}
        result={String.raw`w_H=\tfrac mq\;\Rightarrow\;\text{limit cycle 週期}=q\qquad(32.4=\tfrac{162}{5}\Rightarrow q=5)`}
      />
      <p>
        floor 版的 <Tex>{String.raw`r[n]=\mathrm{frac}\big(r[-1]+(n+1)c\big)`}</Tex>，所以 <Tex>{String.raw`y[n]=\lfloor c\rfloor+\lfloor(n+1)p+r_{-1}\rfloor-\lfloor np+r_{-1}\rfloor`}</Tex>：
        <Tex>{String.raw`r[-1]=0`}</Tex> 時<strong>逐字就是</strong> §13.2 的 Bresenham 公式（<Tex>{String.raw`h/L_t=p`}</Tex>）。round-half-up 等於「floor 加上 <Tex>{String.raw`\tfrac12`}</Tex> 的初始偏移」，只改變相位：對有理 <Tex>{'c=m/q'}</Tex>，<Tex>{String.raw`\lfloor nc+\theta\rfloor=\lfloor(nm+\lfloor q\theta\rfloor)/q\rfloor`}</Tex>（<Tex>{'nm'}</Tex> 是整數），所以任何偏移 <Tex>{String.raw`\theta`}</Tex> 都等價於某個 <Tex>{'j/q'}</Tex>；又因 <Tex>{'m'}</Tex> 與 <Tex>{'q'}</Tex> 互質，存在 <Tex>{'n_0'}</Tex> 使 <Tex>{String.raw`n_0m\equiv j\pmod q`}</Tex>，也就是把序列平移 <Tex>{'n_0'}</Tex> 格。
      </p>

      <h3>
        Acceptance check：D ≡ B（只差循環移位），任何初始 <Tex>{'r[-1]'}</Tex> 都一樣
      </h3>
      <div className="table-wrap">
        <table className="ch13-table" aria-label="Acceptance check：不同初始 r 下一階 ΔΣ 的穩態循環都是方法 B 的循環移位">
          <thead>
            <tr>
              <th>
                <Tex>{'r[-1]'}</Tex>
              </th>
              <th>
                穩態 5 點（<Tex>{String.raw`n=10,\dots,14`}</Tex>）
              </th>
              <th>偵測週期</th>
              <th>
                相對 <Tex>{'[32,32,33,32,33]'}</Tex> 的移位
              </th>
              <th>結果</th>
            </tr>
          </thead>
          <tbody>
            {r.accept.map((a) => (
              <tr key={a.r0}>
                <td>{fx(a.r0, 4)}</td>
                <td>[{a.cyc.join(', ')}]</td>
                <td>{a.period}</td>
                <td>{a.shift >= 0 ? a.shift : '—'}</td>
                <td className={a.shift >= 0 && a.period === 5 ? 'ch13-ok' : 'ch13-bad'}>{a.shift >= 0 && a.period === 5 ? '✓ D ≡ B' : '✗'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        由 <code>efbConstant()</code> 以精確有理數即時計算（rational 模式：以 <Tex>{String.raw`1/(5\cdot2^{16})\,\mathrm{LSB}`}</Tex> 為單位的整數運算）；同一檢查也在單元測試 T16 中執行。
      </p>

      <Fold title={<>白色模型為什麼錯？<Tex>{String.raw`\mathrm{Var}(r)=0.08`}</Tex> 而且 <Tex>{'r'}</Tex> 前後負相關</>}>
        <StepDerivation
          steps={[
            { tex: String.raw`r\in\{r_0+\tfrac jq\}\ \text{（每個週期各一次）}\Rightarrow\mathrm{Var}(r)=\frac{q^2-1}{12q^2}=\frac{24}{300}=${fx(r.varR, 4)}`, why: tx(String.raw`由上面的證明，$r$ 均勻落在間距 $1/q$ 的 $q$ 個格點上；離散均勻分布的變異數（$q\to\infty$ 才是 $1/12$）。`) },
            { tex: String.raw`E[(y-c)^2]=E\big[(r[n-1]-r[n])^2\big]=2\mathrm{Var}(r)-2\,\mathrm{Cov}(r[n-1],r[n])`, why: '展開平方。' },
            { tex: String.raw`\mathrm{Cov}(r[n-1],r[n])=${fx(r.cov, 4)}\;\Rightarrow\;E[(y-c)^2]=2(${fx(r.varR, 2)})-2(${fx(r.cov, 2)})=${fx(2 * r.varR - 2 * r.cov, 4)}`, why: tx(String.raw`由模擬的 $r$ 序列直接計算（500 點 = 100 個完整週期）：手算 $\tfrac15\big[(0.4)(-0.2)+(-0.2)(0.2)+(0.2)(-0.4)+(-0.4)(0)+(0)(0.4)\big]=-0.04$。$r$ 前後是負相關，不是白色；結果與直接平均 $(y-c)^2$ 得到的 $${fx(r.pow, 4)}$ 一致。`) },
            { tex: String.raw`\text{白色模型：}2\sigma_r^2=\tfrac16\approx0.1667\ne0.24`, why: tx(String.raw`白色假設忽略了負相關、也用錯了 $\sigma_r^2$：低估總功率 30%。`) },
          ]}
        />
        <p className="small">
          另一個看法：只用 32、33 兩階且平均為 32.4 的<strong>任何</strong>序列，<Tex>{String.raw`P(33)=0.4`}</Tex> 被平均值鎖死，總功率必為{' '}
          <Tex>{String.raw`0.4(0.6)^2+0.6(0.4)^2=0.24`}</Tex>。noise shaping 只能「搬動」這 0.24 的頻率分布，不能讓它變小。 <ClaimTag kind="exact" />
        </p>
      </Fold>

      <h3>定點 <Tex>{String.raw`w_H`}</Tex>：週期變成 <Tex>{String.raw`2^F/\gcd`}</Tex>（勘誤 E15）</h3>
      <p>
        真實硬體的 <Tex>{'w_H'}</Tex> 是 <Tex>{'F'}</Tex> 個小數 bit 的定點數，32.4 無法精確表示：<Tex>{String.raw`w_H=K/2^F`}</Tex>，<Tex>{String.raw`K=\mathrm{round}(32.4\cdot2^F)`}</Tex>。套用上面的定理：<Tex>{String.raw`K/2^F`}</Tex> 約分後的分母就是 <Tex>{String.raw`q=2^F/\gcd(K\bmod2^F,2^F)`}</Tex>：
      </p>
      <Mermaid
        chart={CHART_PERIOD_FLOW}
        caption="limit cycle 的週期怎麼算。先看左支：精確的有理數約分後，分母就是週期；再看右支：定點數先取出小數部分對應的整數，和 $2^F$ 求最大公因數，週期是 $2^F$ 除以它。"
      />
      <p className="small ch13-figwalk">
        圖上的 <Tex>{'m/q'}</Tex> 就是下面公式左半邊的 <Tex>{'w_H=m/q'}</Tex>；圖上的 <Tex>{'K'}</Tex>、<Tex>{'F'}</Tex>、<Tex>{'g'}</Tex> 就是右半邊的 <Tex>{'K'}</Tex>、<Tex>{'F'}</Tex> 與{' '}
        <Tex>{String.raw`\gcd(K\bmod2^F,2^F)`}</Tex>。兩支其實是同一件事：<Tex>{String.raw`K/2^F`}</Tex> 約分後的分母就是 <Tex>{String.raw`2^F/g`}</Tex>（<Tex>{'F=10'}</Tex> 時 <Tex>{String.raw`\tfrac{33178}{1024}=\tfrac{16589}{512}`}</Tex>）。
      </p>
      <TexBlock id="F-13.8">{String.raw`w_H=\frac{m}{q}\Rightarrow\text{period}=q;\qquad w_H=\frac{K}{2^F}\Rightarrow\text{period}=\frac{2^F}{\gcd(K\bmod2^F,\;2^F)}`}</TexBlock>
      <div className="table-wrap">
        <table className="ch13-table" aria-label="定點小數位元數 F 與一階 ΔΣ limit cycle 週期">
          <thead>
            <tr>
              <th>
                <Tex>{'F'}</Tex>
              </th>
              <th>
                <Tex>{String.raw`K=\mathrm{round}(32.4\cdot2^F)`}</Tex>
              </th>
              <th>
                實際 <Tex>{'w_H=K/2^F'}</Tex>
              </th>
              <th>
                <Tex>{String.raw`K\bmod2^F`}</Tex>
              </th>
              <th>
                <Tex>{String.raw`\gcd(K\bmod2^F,\,2^F)`}</Tex>
              </th>
              <th>
                週期 <Tex>{String.raw`2^F/\gcd`}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {r.fixedRows.map((row) => (
              <tr key={row.F}>
                <td>{row.F}</td>
                <td>{row.K}</td>
                <td className="mono">{row.rep.toPrecision(14)}</td>
                <td>{row.frac}</td>
                <td>{row.g}</td>
                <td>{row.period}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <Tex>{'F=10'}</Tex> 時週期 512：主 tone 移到 <Tex>{String.raw`${r.main.k}f_u/512\approx${fx(r.main.k / 512, 5)}f_u`}</Tex>（線功率{' '}
        <Tex>{String.raw`${fx(r.main.power, 4)}\,\mathrm{LSB}^2`}</Tex>，比精確 32.4 時 <Tex>{String.raw`2f_u/5`}</Tex> 的 <Tex>{String.raw`${fx(r.exactMain, 5)}`}</Tex> 略小），兩旁以 <Tex>{String.raw`f_u/512`}</Tex> 為間距長出 sideband（
        <Tex>{String.raw`k=${r.main.k - 1}`}</Tex>：{fx(r.sideL.power, 4)}、<Tex>{String.raw`k=${r.main.k + 1}`}</Tex>：{fx(r.sideR.power, 4)} <Tex>{String.raw`\mathrm{LSB}^2`}</Tex>）；
        <Tex>{String.raw`f_u/5`}</Tex> 附近最大的是 <Tex>{String.raw`k=${r.near5.k}`}</Tex>（{fx(r.near5.power, 4)} <Tex>{String.raw`\mathrm{LSB}^2`}</Tex>）。
        <Tex>{String.raw`k=1,\dots,8`}</Tex>（<Tex>{String.raw`f\le f_u/64`}</Tex>）的低頻譜線總和只有 <Tex>{String.raw`${ntex(r.lowSum, 3)}\,\mathrm{LSB}^2`}</Tex>。也就是：定點下
        limit cycle 仍在，只是週期變長、譜線變密。 <ClaimTag kind="exact" />
      </p>
      <Hand id="HC-13.6">
        先不要看上表：自己算 <Tex>{'F=8'}</Tex> 與 <Tex>{'F=12'}</Tex> 時 32.4 的週期（答案在表裡），再試一個可以被定點精確表示的值（例如 <Tex>{'w_H=32.375'}</Tex>、<Tex>{'F=4'}</Tex>），看兩個週期什麼時候會相同。
      </Hand>
      <ModeGate min="research">
        <p className="small muted">
          前 6 大線（<Tex>{'F=10'}</Tex>）：
          {r.top10.map((l, i) => (
            <span key={l.k}>
              {i ? '；' : ' '}
              <Tex>{String.raw`k=${l.k}\ (${fx(l.k / 512, 4)}f_u):\ ${ntex(l.power, 3)}\,\mathrm{LSB}^2`}</Tex>
            </span>
          ))}
          。由 <code>lineSpectrum()</code> 對一個完整週期（512 點）做精確 DFT。
        </p>
      </ModeGate>

    </Section>
  )
}
