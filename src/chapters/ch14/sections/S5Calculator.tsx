import { useMemo } from 'react'
import { Callout, ClaimTag, Section, SourceTag, Tex } from '@/components'
import { asymptoticFinalOptimum, calPhaseMarginDeg, convergenceMuMin, finalCostDerivative, msdAfterBlocks, optimizeMu } from '@/simulation/models/optimizer'
import { LrOptimizerExperiment } from '../experiments/LrOptimizer'
import { Diagram } from '../Diagram'
import { CHART_CALC_VERIFY } from '../diagrams'
import { HandLink } from '../Hand'
import { md, nf, Steps, tx } from '../shared'
import { LESSON_MODEL } from './S3Objectives'

/** 第 10 課（使用者分享的入門課）設計計算器所宣稱的數字——這是「被驗算的對象」，不是本站的計算結果。 */
const LESSON_CLAIM = { alpha: 11.2, rms: 0.449, pole: 0.9106, pm: 87.4 }

/** §14.4：第 10 課設計計算器的重現與驗算 */
export function S5Calculator() {
  const m = LESSON_MODEL
  const r = useMemo(() => {
    const exact = optimizeMu('final', m)
    const asym = asymptoticFinalOptimum(m)
    const at = (mu: number) => ({
      mu,
      rms: Math.sqrt(msdAfterBlocks(m.delta0, 1 - mu * m.K, mu, m.sigmaEta2, m.B)),
      pole: 1 - mu * m.K,
      pm: calPhaseMarginDeg(mu * m.K),
    })
    return {
      exact: at(exact.mu),
      lesson: at(LESSON_CLAIM.alpha),
      asym: { ...at(asym.mu), A: asym.A },
      dAtLesson: finalCostDerivative(LESSON_CLAIM.alpha, m),
      dAtExact: finalCostDerivative(exact.mu, m),
      // 另一個可能的來源：「32 次更新把平均誤差縮到 5%」的最小 μ（F-14.15 的單一 corner 版）
      eps5: convergenceMuMin(m.K, 0.05, m.B),
    }
  }, [m])
  const penalty = r.lesson.rms / r.exact.rms - 1
  return (
    <Section kind="example" level={2} title="14.4 重現第 10 課的設計計算器（並驗算）" id="ch14-calculator">
      <p>
        第 10 課的計算器輸入：<Tex>{'\\delta_0=3\\,\\mathrm{fs}'}</Tex>、<Tex>{'\\sigma_v=100\\,\\mathrm{fs}'}</Tex>、<Tex>{'N=4096'}</Tex>、總比較次數 131072（
        <Tex>{'B=32'}</Tex> 次更新）、相位 <Tex>{'\\theta=0'}</Tex>，輸出「建議 <Tex>{'\\alpha=11.20\\,\\mathrm{fs}'}</Tex>、RMS 0.449 fs、pole 0.9106、PM <Tex>{'87.4^\\circ'}</Tex>」。（課程把 learning rate 寫成 <Tex>{'\\alpha'}</Tex>，就是本章的 <Tex>{'\\mu'}</Tex>。）我們用同一條成本 F-14.3 重新計算，順序如下圖：
      </p>
      <Diagram chart={CHART_CALC_VERIFY} caption="驗算的順序：先重算課程的三個數字，再問「它真的是成本的最低點嗎」。">
        <p>
          <strong>先看</strong>上半部：由課程的輸入算出 <Tex>{'K'}</Tex>、<Tex>{'\\sigma_\\eta^2'}</Tex>、<Tex>{'B'}</Tex>，再把課程建議的步長代進去得到 <Tex>{'g'}</Tex> 與 <Tex>{'p'}</Tex>，分兩路算 RMS（F-14.3）與 PM（F-14.14），在菱形和課程的數字比對。
          <strong>再看</strong>藍色方塊：數字對了不代表它是「最佳」，還要把同一個步長代入成本的導數 F-14.7 看正負號；導數是正的，表示步長再小一點成本更低。<strong>最後</strong>用數值求根找到導數為零的那一點（綠色）。
        </p>
        <p>
          圖上的每個方塊對應下面逐步計算的一行：「<Tex>{'K'}</Tex>、<Tex>{'\\sigma_\\eta^2'}</Tex>、<Tex>{'B'}</Tex>」是第 1 步，RMS 與 PM 是第 2、3 步，藍色方塊是第 4 步的 <Tex>{'dE[\\delta_B^2]/d\\mu'}</Tex>，綠色方塊是第 5 步的 <Tex>{'\\mu^*'}</Tex>。
        </p>
      </Diagram>
      <Steps
        steps={[
          { tex: String.raw`K=K_q=\sqrt{2/\pi}/100=${tx(m.K, 6)}\ \mathrm{fs^{-1}},\quad \sigma_\eta^2=1/4096,\quad B=131072/4096=32`, why: '代入條件。' },
          {
            tex: String.raw`\mu=11.20:\ g=${tx(11.2 * m.K, 5)},\ p=${tx(r.lesson.pole, 5)},\ E[\delta_{32}^2]=9p^{64}+\frac{11.2^2}{4096}\frac{1-p^{64}}{1-p^2}=${tx(r.lesson.rms ** 2, 5)}`,
            why: md(String.raw`照課程的 $\alpha$ 代入 F-14.3。`),
          },
          {
            tex: String.raw`\sqrt{E[\delta_{32}^2]}=${tx(r.lesson.rms, 4)}\ \mathrm{fs},\quad PM=90^\circ-\arcsin(g/2)=${tx(r.lesson.pm, 4)}^\circ`,
            why: md(String.raw`開根號得 RMS；PM 用 F-14.14。三個數字都與課程的 0.449 fs、0.9106、$87.4^\circ$ 一致。`),
          },
          {
            tex: String.raw`\frac{dE[\delta_B^2]}{d\mu}\Big|_{\mu=11.20}=${tx(r.dAtLesson, 4)}\ \mathrm{fs}\ (>0)`,
            why: <>11.20 是不是最佳點？代入 F-14.7：導數為正，代表再減小 <Tex>{'\\mu'}</Tex> 還會更好——11.20 只是「接近」最佳。</>,
          },
          { tex: String.raw`\mu^*=${tx(r.exact.mu, 5)}\ \mathrm{fs}\ (\text{F-14.7 的根}),\quad \text{RMS}=${tx(r.exact.rms, 4)}\ \mathrm{fs},\ p=${tx(r.exact.pole, 4)},\ PM=${tx(r.exact.pm, 4)}^\circ`, why: <>數值求根得到真正的最佳點（該點的導數 <Tex>{`${tx(r.dAtExact, 2)}`}</Tex>，等於 0 到數值精度）。</> },
        ]}
      />
      <div className="table-wrap">
        <table className="ch14-table">
          <thead>
            <tr>
              <th>量</th>
              <th>第 10 課宣稱</th>
              <th>
                代入 <Tex>{'\\alpha=11.20'}</Tex> 重算
              </th>
              <th>
                精確最佳 <Tex>{'\\mu^*'}</Tex>（F-14.7 = 0）
              </th>
              <th>漸近式 F-14.8</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Tex>{'\\mu'}</Tex>（fs）
              </td>
              <td className="num">{LESSON_CLAIM.alpha.toFixed(2)}</td>
              <td className="num">11.20</td>
              <td className="num">{nf(r.exact.mu, 5)}</td>
              <td className="num">{nf(r.asym.mu, 5)}</td>
            </tr>
            <tr>
              <td>
                RMS <Tex>{'\\delta_{32}'}</Tex>（fs）
              </td>
              <td className="num">{LESSON_CLAIM.rms}</td>
              <td className="num">{nf(r.lesson.rms, 4)}</td>
              <td className="num">{nf(r.exact.rms, 4)}</td>
              <td className="num">{nf(r.asym.rms, 4)}</td>
            </tr>
            <tr>
              <td>
                pole <Tex>{'p'}</Tex>
              </td>
              <td className="num">{LESSON_CLAIM.pole}</td>
              <td className="num">{nf(r.lesson.pole, 5)}</td>
              <td className="num">{nf(r.exact.pole, 5)}</td>
              <td className="num">{nf(r.asym.pole, 5)}</td>
            </tr>
            <tr>
              <td>
                PM（<Tex>{'^\\circ'}</Tex>）
              </td>
              <td className="num">{LESSON_CLAIM.pm}</td>
              <td className="num">{nf(r.lesson.pm, 4)}</td>
              <td className="num">{nf(r.exact.pm, 4)}</td>
              <td className="num">{nf(r.asym.pm, 4)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Callout kind="warn" title="驗算結論：數字不同時以本站為準">
        <p>
          <ClaimTag kind="exact" /> 課程的 RMS／pole／PM 三個數字<strong>對 <Tex>{'\\alpha=11.20\\,\\mathrm{fs}'}</Tex> 是正確的</strong>；但 11.20 不是 F-14.3 的最小點。真正的最佳點是{' '}
          <Tex>{`\\mu^*=${tx(r.exact.mu, 4)}\\,\\mathrm{fs}`}</Tex>（RMS {nf(r.exact.rms, 4)} fs、pole {nf(r.exact.pole, 4)}、PM <Tex>{`${tx(r.exact.pm, 4)}^\\circ`}</Tex>）。
        </p>
        <p>
          11.20 從哪裡來？課程沒有寫出算法，以下是<strong>推測</strong>，兩個候選都由程式重算：(1) 漸近封閉式 <Tex>{`\\ln A/(2BK)=${tx(r.asym.mu, 4)}\\,\\mathrm{fs}`}</Tex>（
          <Tex>{`A=${tx(r.asym.A, 4)}`}</Tex>，把 <Tex>{'p^{2B}'}</Tex> 換成指數的近似），對應 pole <Tex>{`${tx(r.asym.pole, 4)}`}</Tex>；(2) 「32 次更新把平均誤差縮到 5%」的最小步長{' '}
          <Tex>{`(1-0.05^{1/32})/K=${tx(r.eps5, 5)}\\,\\mathrm{fs}`}</Tex>（F-14.15 的單一 corner 版），對應 pole <Tex>{`0.05^{1/32}=${tx(1 - r.eps5 * m.K, 4)}`}</Tex>。候選 (2) 同時重現課程的 11.20 fs 與 pole
          0.9106 到所有列出的位數，候選 (1) 則是 {nf(r.asym.mu, 4)} fs／{nf(r.asym.pole, 4)}，所以 (2) 的可能性較高——也就是說課程的「建議值」其實是<strong>收斂要求的下限</strong>（§14.2 (d) 的型態），不是終點 RMS
          的最小點。無論哪一個，成本曲線在最佳點附近非常平：用 11.20 只多了 {(100 * penalty).toFixed(2)}% 的 RMS：<strong>工程上兩者都可以</strong>，但「最佳」一詞要用精確解。
        </p>
      </Callout>
      <p>
        <strong>換你算。</strong>章末的綜合手算題 <HandLink id="HC-14.8" /> 會帶你用紙筆從 <Tex>{'\\sigma_v,\\ N,\\ T,\\ \\delta_0'}</Tex> 與 <Tex>{'\\epsilon=0.05'}</Tex> 出發，一步一步重現課程的這四個數字（候選 (2) 的算法）。
      </p>
      <p className="small muted">
        <SourceTag kind="illustrative" /> 所有數字由 <code>optimizeMu</code>／<code>msdAfterBlocks</code> 即時計算；下方實驗載入的預設值就是這組條件，按「執行 Run」可加上 Monte Carlo 驗證。
      </p>
      <Callout kind="info" title="試試看">
        <ul>
          <li>
            按「執行 Run」：MC 點（exact-binomial）與 blockLms 菱形點應落在線性曲線上（<Tex>{'\\delta_0=3\\,\\mathrm{fs}\\ll\\sigma_v'}</Tex>）。
          </li>
          <li>
            載入 preset「勘誤 E48——<Tex>{'\\delta_0=2\\sigma_v'}</Tex>」再 Run：MC 明顯高於線性曲線，交叉比對變成 mismatch——這是 F-14.3 的適用範圍，不是程式錯誤。
          </li>
          <li>
            把目標換成「最佳 PVT 追蹤（ramp）」：最佳 <Tex>{'\\mu'}</Tex> 掉到約 2 fs，和開機校正差 5 倍。
          </li>
          <li>
            把 <Tex>{'\\theta'}</Tex> 拉到 <Tex>{'95^\\circ'}</Tex>：出現極性警告、Run 消失——任何 <Tex>{'\\mu'}</Tex> 都救不了 <Tex>{'C\\le0'}</Tex>。
          </li>
          <li>
            在 A/B/C 中把 <Tex>{'N'}</Tex> 改成 1024、16384：曲線左右平移、谷底幾乎一樣高（F-14.17）。
          </li>
          <li>
            把 <Tex>{'N'}</Tex> 改成 16、<Tex>{'T'}</Tex> 改成 <Tex>{'2^{24}'}</Tex>（<Tex>{'B\\approx10^6'}</Tex>）再 Run：worker 會自動減少 chain 數（指標列會註明），避免數十億次抽樣。
          </li>
        </ul>
      </Callout>
      <LrOptimizerExperiment />
    </Section>
  )
}
