import { useMemo, useState } from 'react'
import { Callout, ClaimTag, ParamControl, Section, Tex, TexBlock, mathText } from '@/components'
import { normCdf, normInv } from '@/simulation/core'
import { meanQ, minNForTarget, pPlus, samplesForConfidence, samplesSmallSignal } from '@/simulation/models/comparator'
import { Fig, HandCalcBlock, Steps, fx, int, pct, texInt } from '../common'

const TARGETS = [0.8413447460685429, 0.9, 0.95, 0.99, 0.999]

/** §4：要多少樣本才看得出方向。 */
export function SamplesSection() {
  const [s, setS] = useState(1)
  const [sigma, setSigma] = useState(100)
  const [target, setTarget] = useState(0.95)

  const table = useMemo(() => {
    const p = pPlus(1, 100)
    const m = meanQ(1, 100)
    return TARGETS.map((t) => ({
      t,
      z: normInv(t),
      clt: samplesForConfidence(m, t),
      small: samplesSmallSignal(0.01, t),
      exact: minNForTarget(p, t, 'odd'),
    }))
  }, [])

  const calc = useMemo(() => {
    const p = pPlus(s, sigma)
    const m = meanQ(s, sigma)
    const mEff = Math.abs(m)
    const t: 1 | -1 = s >= 0 ? 1 : -1
    const ok = sigma > 0 && s !== 0 && target > 0.5 && target < 1
    const clt = ok ? samplesForConfidence(mEff, target) : NaN
    const small = ok ? samplesSmallSignal(Math.abs(s) / sigma, target) : NaN
    const exact = ok && clt < 2e8 ? minNForTarget(p, target, 'odd', 'strict', t, 2e8) : null
    return { m, clt, small, exact, ok }
  }, [s, sigma, target])

  const z95 = normInv(0.95)
  return (
    <Section
      kind="formula"
      level={2}
      title={
        <>
          4. 要累加多少次？<Tex>{String.raw`N\approx(z\sigma_v/s)^2\cdot\pi/2`}</Tex>
        </>
      }
    >
      <p>
        §3 的 <Tex>{String.raw`P(\text{判對})\approx\Phi(\mathrm{SNR}_{\mathrm{stat}})`}</Tex> 把問題變成：要讓{' '}
        <Tex>{'\\mathrm{SNR}_{\\mathrm{stat}}'}</Tex> 達到某個 <Tex>{'z'}</Tex> 值。例如 95% 對應 <Tex>{`z=\\Phi^{-1}(0.95)=${fx(z95, 4)}`}</Tex>。
        這裡 <Tex>{'\\Phi^{-1}'}</Tex> 是 <Tex>{'\\Phi'}</Tex> 的<strong>反函數</strong>（把同一張常態表反過來查：給機率、回傳對應的 <Tex>{'z'}</Tex>）；
        <Tex>{'\\Phi'}</Tex> 嚴格遞增，所以反函數存在且唯一。驗算：<Tex>{`\\Phi(${fx(z95, 4)})=${fx(normCdf(z95), 4)}`}</Tex>。
      </p>
      <p>
        整個設計流程只有四步，先看圖再推導。<Tex>{'P_{\\text{target}}'}</Tex> 是你想要的判對機率（目標信心），<Tex>{'f_s'}</Tex> 是 comparator 的取樣率（每秒做幾次比較）：
      </p>
      <Fig name="designFlow">
        先看從「目標正確率」出發的那條線：由 <Tex>{'P_{\\text{target}}'}</Tex> 反查常態表得到 <Tex>{'z'}</Tex>。再看從「誤差與雜訊」出發的那條線：由 <Tex>{'s'}</Tex> 與{' '}
        <Tex>{'\\sigma_v'}</Tex> 得到單一樣本的平均 <Tex>{'m'}</Tex>。兩者合成 <Tex>{'N'}</Tex>；最後取奇數（避開 §3 的 tie），再除以 <Tex>{'f_s'}</Tex> 換成時間。圖上寫著 <Tex>{'N'}</Tex> 的那一格有兩個式子，就是下面要推導的 F-05.9：前一個是 CLT
        的連續解，後一個是小訊號近似。
      </Fig>
      <Steps
        title="反解 $N$"
        steps={[
          { tex: String.raw`\frac{m\sqrt N}{\sqrt{1-m^2}}=z`, why: <>令正確率 <Tex>{'\\Phi(\\mathrm{SNR}_{\\mathrm{stat}})=P_{\\text{target}}'}</Tex>，兩邊取 <Tex>{'\\Phi^{-1}'}</Tex>。</> },
          { tex: String.raw`\sqrt N=\frac{z\sqrt{1-m^2}}{m}`, why: '移項。' },
          { tex: String.raw`N=\frac{z^2(1-m^2)}{m^2}`, why: '兩邊平方（CLT 的連續解）。' },
          { tex: String.raw`m=2\Phi(r)-1\approx2\big[\tfrac12+r\varphi(0)\big]-1=2r\varphi(0)=\sqrt{\tfrac2\pi}\,r`, why: <><Tex>{'|r|\\ll1'}</Tex> 時對 <Tex>{'\\Phi'}</Tex> 做一階泰勒展開 <Tex>{"\\Phi(r)\\approx\\Phi(0)+r\\,\\Phi'(0)"}</Tex>；<Tex>{'\\varphi(0)=1/\\sqrt{2\\pi}'}</Tex>（§5 會再推一次）。</> },
          { tex: String.raw`1-m^2\approx1`, why: <><Tex>{'m\\approx0.008'}</Tex>，<Tex>{'m^2\\approx6\\times10^{-5}'}</Tex> 可忽略。</> },
          { tex: String.raw`N\approx\frac{z^2}{(2/\pi)\,r^2}=\left(\frac{z\,\sigma_v}{s}\right)^2\frac{\pi}{2}`, why: <>代入 <Tex>{'r=s/\\sigma_v'}</Tex>。</> },
        ]}
      />
      <TexBlock id="F-05.9" label={<>所需樣本數 <ClaimTag kind="approx" /></>}>
        {String.raw`\boxed{N=\frac{z^2(1-m^2)}{m^2}\approx\left(\frac{z\,\sigma_v}{s}\right)^2\frac{\pi}{2}}`}
      </TexBlock>
      <p>
        手算：
        <Tex>{String.raw`(${fx(z95, 4)}\times100)^2\times${fx(Math.PI / 2, 4)}\approx${texInt((z95 * 100) ** 2)}\times${fx(Math.PI / 2, 4)}\approx${texInt(samplesSmallSignal(0.01, 0.95))}`}</Tex>
        ，就是規格說的「約 42,500 次」。
        <strong>
          <Tex>{'\\pi/2'}</Tex> 這個因子是 1-bit 量化的代價
        </strong>
        ：如果直接拿到類比的 <Tex>{'e'}</Tex>（不經過 comparator）並取平均 <Tex>{String.raw`\bar e=s+\bar v`}</Tex>，
        <Tex>{String.raw`\mathrm{SNR}=s\sqrt N/\sigma_v`}</Tex>，只需要 <Tex>{'(z\\sigma_v/s)^2'}</Tex> 次——1-bit 需要多{' '}
        <Tex>{`\\pi/2-1\\approx${fx(100 * (Math.PI / 2 - 1), 1)}\\%`}</Tex> 的樣本（<Tex>{`10\\log_{10}(\\pi/2)\\approx${fx(10 * Math.log10(Math.PI / 2), 2)}\\,\\mathrm{dB}`}</Tex>{' '}
        的 SNR 損失）。<ClaimTag kind="approx" />（這是小訊號 <Tex>{'|s|\\ll\\sigma_v'}</Tex> 的結論，也正是校正收斂後的工作區）
      </p>
      <Fig name="analogVs1bit">
        先比較兩個框的方塊：右框只比左框多了藍色的 sign。再比較兩框的 SNR：類比路徑每個樣本的訊號是 <Tex>{'s'}</Tex>、雜訊是 <Tex>{'\\sigma_v'}</Tex>；過了 sign 之後，訊號變成{' '}
        <Tex>{'m\\approx\\sqrt{2/\\pi}\\,s/\\sigma_v'}</Tex>、雜訊變成 <Tex>{'\\sqrt{1-m^2}\\approx1'}</Tex>，所以 SNR 乘上 <Tex>{'\\sqrt{2/\\pi}'}</Tex>。要回到同樣的{' '}
        <Tex>{'z'}</Tex>，<Tex>{'N'}</Tex> 就得乘上它平方的倒數 <Tex>{'\\pi/2'}</Tex>（紅色）。圖上兩個 <Tex>{'N'}</Tex> 的式子相除，就是公式 F-05.9 裡的那個 <Tex>{'\\pi/2'}</Tex>。
      </Fig>
      <div className="table-wrap">
        <table className="ch05-table">
          <caption>
            <Tex>{String.raw`s=1\,\mathrm{fs},\ \sigma_v=100\,\mathrm{fs}`}</Tex>。「精確」為最小奇數 <Tex>{'N'}</Tex> 使 exact binomial{' '}
            <Tex>{String.raw`P(S_N>0)\ge P_{\text{target}}`}</Tex>。
          </caption>
          <thead>
            <tr>
              <th className="num">目標正確率</th>
              <th className="num">
                <Tex>{'z'}</Tex>
              </th>
              <th className="num">
                CLT <Tex>{'z^2(1-m^2)/m^2'}</Tex> <ClaimTag kind="approx" />
              </th>
              <th className="num">
                小訊號 <Tex>{'(z\\sigma_v/s)^2\\pi/2'}</Tex> <ClaimTag kind="approx" />
              </th>
              <th className="num">
                精確（奇數 <Tex>{'N'}</Tex>）<ClaimTag kind="exact" />
              </th>
            </tr>
          </thead>
          <tbody>
            {table.map((r) => (
              <tr key={r.t} className={r.t === 0.95 ? 'ch05-hl' : undefined}>
                <td className="num">{pct(r.t, 2)}</td>
                <td className="num">{fx(r.z, 4)}</td>
                <td className="num">{fx(r.clt, 2)}</td>
                <td className="num">{fx(r.small, 2)}</td>
                <td className="num">{r.exact === null ? '—' : int(r.exact)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <HandCalcBlock id="HC-05.6">
        換成你的規格：想辨識多小的 <Tex>{'s'}</Tex>、雜訊 <Tex>{'\\sigma_v'}</Tex> 多大、要幾成把握？先反查常態表得到 <Tex>{'z'}</Tex>，再用紙筆算出{' '}
        <Tex>{'N'}</Tex>，然後對答案（也可以和下面的樣本數計算器互相驗算）。
      </HandCalcBlock>
      <Callout
        kind="info"
        title={
          <>
            三條縮放律（全部來自 <Tex>{String.raw`N\propto(\sigma_v/s)^2`}</Tex>）
          </>
        }
      >
        <ul>
          <li>
            誤差 <Tex>{'s'}</Tex> 減半 <Tex>{'\\Rightarrow'}</Tex> <Tex>{'N'}</Tex> 變 <strong>4 倍</strong>（<Tex>{String.raw`\sigma_v=100\,\mathrm{fs}`}</Tex> 下想辨識{' '}
            <Tex>{String.raw`s=0.5\,\mathrm{fs}`}</Tex> 需要約 {int(samplesSmallSignal(0.005, 0.95))} 次）。
          </li>
          <li>
            雜訊 <Tex>{'\\sigma_v'}</Tex> 加倍 <Tex>{'\\Rightarrow'}</Tex> <Tex>{'N'}</Tex> 也變 <strong>4 倍</strong>；所以「雜訊越多越好」是錯的（§7）。
          </li>
          <li>
            95% <Tex>{'\\to'}</Tex> 99%：<Tex>{'N'}</Tex> 乘 <Tex>{`(z_{0.99}/z_{0.95})^2=${fx((normInv(0.99) / z95) ** 2, 3)}`}</Tex>。
          </li>
        </ul>
      </Callout>

      <div className="card">
        <strong>樣本數計算器</strong>（同一個計算核心）
        <div className="ch05-controls">
          <ParamControl label={mathText('$s$（固定誤差）')} ariaLabel="s（固定誤差）" value={s} onChange={setS} min={-100} max={100} step={0.01} unit="fs" reg="Behavioral: s = DTC residual" />
          <ParamControl label={mathText(String.raw`$\sigma_v$（雜訊 RMS）`)} ariaLabel="σ_v（雜訊 RMS）" value={sigma} onChange={setSigma} min={0.01} max={1000} log unit="fs" reg="Behavioral: σ_v" />
          <ParamControl label="目標正確率" value={target} onChange={setTarget} min={0.5001} max={0.99999} step={0.0001} digits={6} reg="Spec: P_target" />
        </div>
        {calc.ok ? (
          <div className="ch05-kpis">
            <div className="ch05-kpi">
              <div className="ch05-kpi-label">
                <Tex>{'m=E[q]'}</Tex>
              </div>
              <div className="ch05-kpi-value">{fx(calc.m, 6)}</div>
            </div>
            <div className="ch05-kpi">
              <div className="ch05-kpi-label">CLT 連續解</div>
              <div className="ch05-kpi-value">{fx(calc.clt, 1)}</div>
            </div>
            <div className="ch05-kpi">
              <div className="ch05-kpi-label">小訊號近似</div>
              <div className="ch05-kpi-value">{fx(calc.small, 1)}</div>
            </div>
            <div className="ch05-kpi">
              <div className="ch05-kpi-label">
                精確最小奇數 <Tex>{'N'}</Tex>
              </div>
              <div className="ch05-kpi-value">{calc.exact === null ? '> 2e8（未計算）' : int(calc.exact)}</div>
            </div>
          </div>
        ) : (
          <p className="ch05-note">
            <Tex>{'s=0'}</Tex> 或 <Tex>{'\\sigma_v=0'}</Tex> 時沒有可求的 <Tex>{'N'}</Tex>：<Tex>{'s=0'}</Tex> 沒有方向可辨識（<Tex>{'m=0'}</Tex>，正確率永遠 50%）；
            <Tex>{'\\sigma_v=0'}</Tex> 時單一樣本就確定（hard limiter）。
          </p>
        )}
        {calc.ok && Math.abs(s) / sigma > 0.25 && (
          <p className="ch05-note">
            <Tex>{'|s|/\\sigma_v>0.25'}</Tex>：小訊號近似（第二式）開始高估 <Tex>{'N'}</Tex>，請以 CLT 或精確欄為準。
          </p>
        )}
      </div>
    </Section>
  )
}
