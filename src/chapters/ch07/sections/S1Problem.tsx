import { useMemo } from 'react'
import { Callout, ClaimTag, Prereq, Section, SourceTag, StepDerivation, Tex, TexBlock } from '@/components'
import { polarityMarginDeg } from '@/simulation/models/pll'
import { residualPhaseDeg, toneCorrCodeDelay } from '@/simulation/models/filteredX'
import { Hand } from '../Hand'
import { fx, kq, RAD, signClass, tx } from '../util'

const OMEGA = 30 * RAD // 30°/sample = π/6
const PHI = -120 * RAD
const TONE = { A: 1, mag: 1, phiRad: PHI, omega: OMEGA }

/** §7.1：一個問題 + 先算一次（數字先於公式）。所有表格數值由公式即時計算。 */
export function S1Problem() {
  // 一個週期 n = 0…11 的逐點乘積
  const rows = useMemo(
    () =>
      Array.from({ length: 12 }, (_, n) => {
        const x = Math.cos(OMEGA * n)
        const u = Math.cos(OMEGA * n + PHI)
        const xD = Math.cos(OMEGA * (n - 4))
        return { n, x, u, xu: x * u, xD, xDu: xD * u }
      }),
    [],
  )
  const avg = (k: 'xu' | 'xDu') => rows.reduce((s, r) => s + r[k], 0) / rows.length
  // D = 0…11 的掃描
  const sweep = useMemo(
    () =>
      Array.from({ length: 12 }, (_, D) => {
        const theta = residualPhaseDeg(PHI, OMEGA, D)
        return { D, omegaD: 30 * D, theta, C: toneCorrCodeDelay(TONE, D), margin: polarityMarginDeg(theta) }
      }),
    [],
  )
  // pole 數字：μ = 10 fs、σ_v = 100 fs
  const Kq = kq(100)
  const mu = 10
  const pRaw = 1 - mu * Kq * toneCorrCodeDelay(TONE, 0)
  const pD4 = 1 - mu * Kq * toneCorrCodeDelay(TONE, 4)

  return (
    <Section kind="intuition" level={2} title="7.1 一個問題：只加幾個 delay register，能不能把極性救回來？" id="ch07-problem">
      <div className="ch07-question">
        <strong>這一課要回答的問題：</strong>上一章（Ch06）看到，PLL 誤差路徑如果讓 PD 端的訊號相對 code 落後
        <Tex>{String.raw`120^\circ`}</Tex>，GMAC 算出來的相關 <Tex>{'C'}</Tex> 會變負，LMS 就往錯的方向更新。如果我們
        <strong>完全不動 PLL</strong>，只在 GMAC 讀 code 的地方多放幾個 register（讓 GMAC 看「比較舊」的 code），
        能不能把方向修正回來？要放幾個？什麼時候這招會失效？
      </div>
      <p className="ch07-lead">
        直覺：你在山谷裡大喊，聽到的回音比你的聲音晚了一點。如果你要判斷「回音和我的聲音是不是同一個節奏」，
        最簡單的方法是<strong>把自己的聲音也延遲同樣的時間</strong>再去比。GMAC 做的事情一模一樣：它把 comparator 的輸出
        <Tex>{'q[n]'}</Tex> 和 code <Tex>{'x[n]'}</Tex> 相乘再累加；如果 <Tex>{'x'}</Tex> 經過 PLL 之後「晚到」了，就把
        <Tex>{'x'}</Tex> 延遲 <Tex>{'D'}</Tex> 個 sample 再去乘。
      </p>

      <Prereq title="期望值（expectation）、時間平均與相關（correlation）">
        <p>
          <Tex>{'E[\\cdot]'}</Tex>（expectation，期望值）可以想成「做很多很多次再取平均」。對一個會重複的訊號（例如正弦波），
          它就等於<strong>一個完整週期內的平均</strong>：
        </p>
        <TexBlock>{String.raw`E\big[f[n]\big]\;\equiv\;\lim_{M\to\infty}\frac1M\sum_{n=0}^{M-1}f[n]\;=\;\frac1P\sum_{n=0}^{P-1}f[n]\quad(\text{週期 }P\text{ 的訊號})`}</TexBlock>
        <p>
          兩個訊號的<strong>相關</strong>（correlation）就是它們乘積的平均 <Tex>{'E[x\\,u]'}</Tex>：兩者同號的時候多（一起正、一起負），
          平均就是正的；反號的時候多，平均就是負的；毫無關係則接近 0。GMAC（gain multiply-accumulate）在硬體上做的正是
          「乘起來、加起來、除以 <Tex>{'N'}</Tex>」——它是在估計一個相關。
        </p>
      </Prereq>

      <Section kind="example" level={3} title="先算一次：一個週期 12 個點，用手就能算">
        <p>
          設定（與規格 §7、T07 相同）：code <Tex>{'x[n]=\\cos(\\Omega n)'}</Tex>，<Tex>{String.raw`\Omega=30^\circ/\text{sample}=\pi/6`}</Tex>
          （每 12 個 sample 一個週期）；PLL 誤差路徑在這個頻率的響應是 <Tex>{String.raw`H=1\cdot e^{-j120^\circ}`}</Tex>，
          所以 PD 看到的有效 regressor 是 <Tex>{String.raw`u[n]=\cos(\Omega n-120^\circ)`}</Tex>（落後 <Tex>{'120^\\circ'}</Tex>）。
          把 code 延遲 <Tex>{'D=4'}</Tex>：<Tex>{String.raw`x[n-4]=\cos(\Omega n-120^\circ)`}</Tex>——<strong>剛好和 <Tex>{'u[n]'}</Tex> 一模一樣</strong>。
        </p>
        <div className="table-wrap">
          <table className="ch07-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'n'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'x[n]'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'u[n]'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'x[n]\\,u[n]'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'x[n-4]'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'x[n-4]\\,u[n]'}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.n}>
                  <td className="num">{r.n}</td>
                  <td className="num">{fx(r.x, 3)}</td>
                  <td className="num">{fx(r.u, 3)}</td>
                  <td className={`num ${signClass(r.xu, 1e-12)}`}>{fx(r.xu, 3)}</td>
                  <td className="num">{fx(r.xD, 3)}</td>
                  <td className={`num ${signClass(r.xDu, 1e-12)}`}>{fx(r.xDu, 3)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3}>
                  <strong>12 點平均</strong>
                </td>
                <td className={`num ${signClass(avg('xu'))}`}>
                  <strong>{fx(avg('xu'), 4)}</strong>
                </td>
                <td />
                <td className={`num ${signClass(avg('xDu'))}`}>
                  <strong>{fx(avg('xDu'), 4)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          你會發現：沒有延遲時，乘積有正有負，<strong>負的比較多</strong>，平均是 <Tex>{tx(avg('xu'), 2)}</Tex>（<Tex>{String.raw`=\tfrac12\cos(-120^\circ)`}</Tex>）——GMAC 會把 LMS 往錯的方向推；
          延遲 4 個 sample 之後，每一點都是 <Tex>{String.raw`\cos^2(\cdot)\ge0`}</Tex>，平均是 <Tex>{'+' + tx(avg('xDu'), 2)}</Tex>（<Tex>{String.raw`=\tfrac12\cos0^\circ`}</Tex>），
          這是單頻能得到的<strong>最大值</strong> <Tex>{String.raw`A^2|H|/2`}</Tex>。 <ClaimTag kind="exact" /> <SourceTag />
        </p>
        <p className="small muted">
          這裡的手算用振幅 <Tex>{'A=1'}</Tex>（與 golden vector T07 相同）。後面的 Lab 把 code 正規化成 unit power（<Tex>{String.raw`A=\sqrt2`}</Tex>，
          <Tex>{String.raw`E[x^2]=A^2/2=1`}</Tex>），同一個例子會顯示成 <Tex>{'-0.5'}</Tex> 與 <Tex>{'+1'}</Tex>：數值 2 倍，符號不變。
        </p>
      </Section>

      <Section
        kind="example"
        level={3}
        title={
          <>
            把 <Tex>{'D'}</Tex> 從 0 掃到 11：哪些 <Tex>{'D'}</Tex> 有效？
          </>
        }
      >
        <p>
          每多延遲 1 個 sample，code 的相位就多落後 <Tex>{String.raw`\Omega=30^\circ`}</Tex>。殘餘相位
          <Tex>{String.raw`\theta=\phi+\Omega D`}</Tex>，相關 <Tex>{String.raw`C_D=\tfrac{A^2}{2}|H|\cos\theta`}</Tex>（下一節推導），
          polarity margin <Tex>{String.raw`M_{\mathrm{pol}}=90^\circ-|\mathrm{wrap}_{180}(\theta)|`}</Tex>（§8.1 的自訂指標）。
        </p>
        <div className="table-wrap">
          <table className="ch07-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'D'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'\\Omega D'}</Tex>
                </th>
                <th className="num">
                  <Tex>{String.raw`\theta=\mathrm{wrap}(\phi+\Omega D)`}</Tex>
                </th>
                <th className="num">
                  <Tex>{'C_D'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'M_{\\mathrm{pol}}'}</Tex>
                </th>
                <th>結論</th>
              </tr>
            </thead>
            <tbody>
              {sweep.map((r) => (
                <tr key={r.D} className={r.D === 4 ? 'ch07-row-hl' : r.C < -1e-12 ? 'ch07-row-bad' : ''}>
                  <td className="num">{r.D}</td>
                  <td className="num">{r.omegaD}°</td>
                  <td className="num">{fx(r.theta, 1)}°</td>
                  <td className={`num ${signClass(r.C, 1e-12)}`}>{fx(r.C, 4)}</td>
                  <td className="num">{fx(r.margin, 1)}°</td>
                  <td>
                    {r.C > 1e-12 ? (
                      r.D === 4 ? (
                        <>
                          最佳（<Tex>{String.raw`\theta=0^\circ`}</Tex>）
                        </>
                      ) : (
                        '收斂（恢復力較小）'
                      )
                    ) : r.C < -1e-12 ? (
                      '反向更新（發散）'
                    ) : (
                      <>
                        <Tex>{'C_D=0'}</Tex>：沒有恢復力
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          有效的是 <Tex>{String.raw`D\in\{2,3,4,5,6\}`}</Tex>（以 12 為週期重複）：剛好半個週期。<Tex>{'D=1'}</Tex> 與 <Tex>{'D=7'}</Tex>
          讓 <Tex>{String.raw`\theta=\pm90^\circ`}</Tex>，相關為 0，GMAC 完全沒有恢復力。
        </p>
        <Hand id="HC-07.1">
          上表的每一列只用到乘、加、減。把 <Tex>{String.raw`\phi`}</Tex>、<Tex>{String.raw`\Omega`}</Tex>、<Tex>{'D'}</Tex> 換成你自己的數字（例如你的 PLL 在某個 code
          頻率的相位），先用紙筆算出 <Tex>{String.raw`\theta`}</Tex> 和 <Tex>{String.raw`M_{\mathrm{pol}}`}</Tex>，再對答案。
        </Hand>
        <Prereq title="一階遞迴的 pole：等比數列決定收斂或發散">
          <p>
            Ch01–Ch03 的 LMS 平均誤差滿足一階遞迴（<Tex>{String.raw`\delta=a-w`}</Tex>，<Tex>{'k'}</Tex> 為 GMAC block）：
          </p>
          <StepDerivation
            steps={[
              {
                tex: String.raw`\delta_{k+1}=p\,\delta_k`,
                why: (
                  <>
                    每個 block 把平均誤差乘上同一個數 <Tex>{'p'}</Tex>（pole）。
                  </>
                ),
              },
              {
                tex: String.raw`\delta_k=p\,\delta_{k-1}=p^2\delta_{k-2}=\cdots=p^k\,\delta_0`,
                why: (
                  <>
                    反覆代入：這就是公比為 <Tex>{'p'}</Tex> 的等比數列。
                  </>
                ),
              },
              {
                tex: String.raw`\lim_{k\to\infty}p^k\delta_0=0\iff|p|<1`,
                why: (
                  <>
                    <Tex>{String.raw`|p|<1`}</Tex> 時 <Tex>{String.raw`|p|^k\to0`}</Tex>；<Tex>{String.raw`p>1`}</Tex> 時 <Tex>{String.raw`p^k`}</Tex> 指數放大（發散）。
                  </>
                ),
              },
              {
                tex: String.raw`|p|^{\tau}=e^{-1}\ \Rightarrow\ \tau=-\frac{1}{\ln|p|}\approx\frac{1}{1-p}\quad(p\to1^-)`,
                why: (
                  <>
                    時間常數 <Tex>{String.raw`\tau`}</Tex>（blocks）：誤差縮成 <Tex>{String.raw`1/e`}</Tex> 所需的 block 數；最後一步用泰勒展開 <Tex>{String.raw`\ln p\approx p-1`}</Tex>。
                  </>
                ),
              },
            ]}
          />
        </Prereq>
        <Callout
          kind="ok"
          title={
            <>
              代入 LMS 的平均 pole（<Tex>{String.raw`\mu=10\ \mathrm{fs}`}</Tex>、<Tex>{String.raw`\sigma_v=100\ \mathrm{fs}`}</Tex>、<Tex>{'A=|H|=1'}</Tex>）
            </>
          }
        >
          <p>
            Ch05 推導過 <Tex>{String.raw`K_q=\sqrt{2/\pi}/\sigma_v=${tx(Kq, 6)}\ \mathrm{fs^{-1}}`}</Tex>，平均 pole
            <Tex>{String.raw`p=1-\mu K_qC`}</Tex>：
          </p>
          <TexBlock>{String.raw`\begin{aligned}
p_{D=0}&=1-10\times${tx(Kq, 6)}\times(${tx(toneCorrCodeDelay(TONE, 0), 2)})=${tx(pRaw, 5)}>1&&\Rightarrow\ \text{平均誤差每個 block 放大}\\
p_{D=4}&=1-10\times${tx(Kq, 6)}\times(${tx(toneCorrCodeDelay(TONE, 4), 2)})=${tx(pD4, 5)}<1&&\Rightarrow\ \text{收斂，時間常數 }\tau=-1/\ln p\approx${tx(-1 / Math.log(pD4), 1)}\text{ blocks}
\end{aligned}`}</TexBlock>
          <p>
            這就是第 7 課的那句話：<strong>只加 4 個 delay registers，就讓發散變收斂</strong>。
            接下來我們把它一步一步推導出來，然後看它在什麼情況下會失效。
          </p>
        </Callout>
      </Section>
    </Section>
  )
}
