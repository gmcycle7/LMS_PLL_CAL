import { useMemo } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { Callout, ClaimTag, Mermaid, ModeGate, Plot, Section, SourceTag, StepDerivation, Tex, TexBlock, useThemeTokens, ChapterErratum } from '@/components'
import { runQuantLab, type DitherPdf } from '@/simulation/models/quantizer'
import { DEFAULT_LAB_PARAMS, Fold, Hand, STRATEGY_COLOR, SpurAt, Unit, fx, n, texLabel, tx } from '../common'
import { CHART_DITHER_LOOP } from '../diagrams'

const SWEEP: { A: number; pdf: DitherPdf }[] = [
  { A: 0, pdf: 'uniform' },
  { A: 0.25, pdf: 'uniform' },
  { A: 0.5, pdf: 'uniform' },
  { A: 1, pdf: 'uniform' },
  { A: 2, pdf: 'uniform' },
  { A: 1, pdf: 'triangular' },
  { A: 2, pdf: 'triangular' },
]

export function DitherSection() {
  const tokens = useThemeTokens()
  const sweep = useMemo(
    () =>
      SWEEP.map(({ A, pdf }) => {
        const lab = runQuantLab({
          params: { ...DEFAULT_LAB_PARAMS, mixing: false, length: 1 << 14, ditherLsb: A, ditherPdf: pdf },
          cases: [{ id: 'E', strategy: 'deltaSigmaDither', lmsNoise: false, nUpd: 1 }],
          compareAll: false,
        })
        const run = lab.runs[0]
        return { A, pdf, m: run.metrics, theory: run.theory }
      }),
    [],
  )
  const psd = useMemo(() => {
    const lab = runQuantLab({
      params: { ...DEFAULT_LAB_PARAMS, mixing: false, length: 1 << 15, fs: 1e6, nperseg: 2048 },
      cases: [
        { id: 'C', strategy: 'stochastic', lmsNoise: false, nUpd: 1 },
        { id: 'D', strategy: 'deltaSigma', lmsNoise: false, nUpd: 1 },
        { id: 'E', strategy: 'deltaSigmaDither', lmsNoise: false, nUpd: 1 },
      ],
      compareAll: false,
    })
    return lab.runs
  }, [])
  const data = useMemo<Data[]>(() => {
    const out: Data[] = []
    for (const run of psd) {
      out.push({
        x: run.psd.f,
        y: run.psd.psd,
        name: texLabel(run.label),
        line: { color: tokens.series[STRATEGY_COLOR[run.strategy]], width: 1.2 },
      })
      if (run.psd.theory)
        out.push({
          x: run.psd.f,
          y: run.psd.theory,
          name: `${texLabel(run.label)} 理論`,
          line: { color: tokens.series[STRATEGY_COLOR[run.strategy]], width: 1, dash: 'dash' },
        })
    }
    return out
  }, [psd, tokens])
  const ps0 = psd[0].psd
  // 「讀表」文字用到的列（全部取自上面的模擬結果，不手寫數字）
  const pick = (A: number, pdf: DitherPdf) => sweep.find((s) => s.A === A && s.pdf === pdf)!
  const small = [pick(0.25, 'uniform'), pick(0.5, 'uniform')]
  const r1 = pick(1, 'uniform')
  const t1 = pick(1, 'triangular')
  const t2 = pick(2, 'triangular')
  // A = 1 LSB RPDF 時每次更新的 code 跳動量 |Δy| 的分布（由完整 trace 計算）
  const jumps = useMemo(() => {
    const lab = runQuantLab({
      params: { ...DEFAULT_LAB_PARAMS, mixing: false, length: 1 << 14, traceLen: 1 << 14, ditherLsb: 1, ditherPdf: 'uniform' },
      cases: [{ id: 'E', strategy: 'deltaSigmaDither', lmsNoise: false, nUpd: 1 }],
      compareAll: false,
    })
    const y = lab.runs[0].trace.y
    let j2 = 0
    let j3 = 0
    for (let i = 1; i < y.length; i++) {
      const d = Math.abs(y[i] - y[i - 1])
      if (d === 2) j2++
      else if (d >= 3) j3++
    }
    return { p2: j2 / (y.length - 1), p3: j3 / (y.length - 1) }
  }, [])

  return (
    <Section kind="formula" title="§13.4E 方法 E：ΔΣ + Dither" level={2} id="ch13-dither">
      <p>
        limit cycle 的根源是「<Tex>{'r'}</Tex> 的遞迴完全確定」。在量化器輸入加一點零平均的亂數 <Tex>{'d[n]'}</Tex>（dither），每次 rounding 的決定就不再只由 <Tex>{'r'}</Tex> 決定，週期性被打散。
      </p>
      <Mermaid
        chart={CHART_DITHER_LOOP}
        caption="方法 E 的迴圈。和方法 D 的圖比，只多了藍色的兩塊：dither 在量化器前面加進來。再看下半：相減點拿的是還沒加 dither 的 $v$，所以存回去的 $r$ 不含 $d$ 本身。"
      />
      <p className="small ch13-figwalk">
        圖上的 <Tex>{'d[n]'}</Tex> 是 dither：零平均、每拍獨立的亂數，峰對峰寬度 <Tex>{'A'}</Tex>（LSB）、變異數 <Tex>{String.raw`\sigma_d^2`}</Tex>；均勻分布（RPDF）時 <Tex>{String.raw`\sigma_d^2=A^2/12`}</Tex>，兩個均勻亂數相加的三角分布（TPDF）時{' '}
        <Tex>{String.raw`A^2/24`}</Tex>。圖上的 <Tex>{'u[n]=v[n]+d[n]'}</Tex> 是真正進量化器的值，就是下面推導第一行的 <Tex>{'u[n]'}</Tex>；相減點的 <Tex>{'r[n]=v[n]-y[n]'}</Tex> 是第二行。因為 <Tex>{'y'}</Tex> 已經被 <Tex>{'d'}</Tex> 影響，
        <Tex>{'r'}</Tex> 裡仍然帶著 <Tex>{'d'}</Tex> 的效果——推導的第 4、5 行會算出它和量化誤差一樣被 <Tex>{String.raw`1-z^{-1}`}</Tex> 塑形。
      </p>
      <StepDerivation
        title="推導：dither 加在哪裡、會不會被塑形？"
        steps={[
          { tex: String.raw`v[n]=w_H[n]+r[n-1],\qquad u[n]=v[n]+d[n],\qquad y[n]=Q_6(u[n])`, why: 'dither 只加在量化器的輸入。' },
          { tex: String.raw`r[n]=v[n]-y[n]\quad(\text{不含 }d)`, why: (
              <>
                回授的誤差以「未加 dither」的 <Tex>{'v'}</Tex> 為基準（程式碼 <code>deltaSigmaDitherStep</code> 中存回 <code>s.r</code> 的是 <code>V - y * c.D</code>，不含 <code>d</code>）。
              </>
            ),
          },
          { tex: String.raw`y[n]=w_H[n]+r[n-1]-r[n]`, why: '和 §13.4 完全相同的代數：等式仍成立。' },
          { tex: String.raw`r[n]=v[n]-y[n]=-\big(\underbrace{y[n]-u[n]}_{e_q[n]}+d[n]\big)`, why: tx(String.raw`把 $v=u-d$ 代入：$r$ 包含量化誤差 $e_q$ 與 dither 兩部分。`) },
          { tex: String.raw`Y(z)=W_H(z)+(1-z^{-1})\big(E_q(z)+D(z)\big)`, why: tx(String.raw`$e_q$ 與 $d$ 都經過 $1-z^{-1}$：dither 也被一階塑形（低頻很小）。`) },
          { tex: String.raw`E[e^2]\approx2\,\mathrm{Var}(r)\approx2\Big(\frac1{12}+\sigma_d^2\Big),\qquad\sigma_d^2=\frac{A^2}{12}\ (\text{RPDF}),\ \frac{A^2}{24}\ (\text{TPDF})`, why: tx(String.raw`由 $e[n]=y[n]-w_H=r[n-1]-r[n]$ 展開平方：$E[e^2]=2\,\mathrm{Var}(r)-2\,\mathrm{Cov}(r[n-1],r[n])$。近似有兩個：(1) $r$ 前後不相關（$\mathrm{Cov}\approx0$）；(2) 把 $e_q$ 當成變異數 $\tfrac1{12}$、與 $d$ 不相關的均勻誤差，所以 $\mathrm{Var}(r)=\mathrm{Var}(e_q+d)\approx\tfrac1{12}+\sigma_d^2$。兩者都要 dither 夠大才成立（§13.4 已看到 $A=0$ 時 $\mathrm{Var}(r)=0.08$、$\mathrm{Cov}=-0.04$）。`) },
          { tex: String.raw`A=1\ \text{LSB（RPDF）}:\ 2\Big(\frac1{12}+\frac1{12}\Big)=\frac13\approx0.333`, why: '代入數字；模擬值見下表。' },
        ]}
      />
      <TexBlock id="F-13.10">{String.raw`y[n]=w_H[n]+r[n-1]-r[n],\qquad r[n]=-\big(e_q[n]+d[n]\big),\qquad E[e^2]\approx2\Big(\frac1{12}+\sigma_d^2\Big)`}</TexBlock>
      <p>
        <ClaimTag kind="approx" /> 白色近似只在 dither 夠大時準（<Tex>{String.raw`A\gtrsim1\,\mathrm{LSB}`}</Tex>）。下表是同一 seed 的實際模擬（<Tex>{'2^{14}'}</Tex> 次更新）：
      </p>
      <div className="table-wrap">
        <table className="ch13-table" aria-label="dither 寬度 A 與 PDF 的掃描：code 範圍、總誤差功率、白色近似、最大譜線與週期">
          <thead>
            <tr>
              <th>dither</th>
              <th>
                <Tex>{'A'}</Tex> [LSB p-p]
              </th>
              <th>code 範圍</th>
              <th>
                總誤差功率 <Tex>{String.raw`\overline{e^2}`}</Tex> <Unit>{'LSB^2'}</Unit>
              </th>
              <th>
                白色近似 <Tex>{String.raw`2(\tfrac1{12}+\sigma_d^2)`}</Tex>
              </th>
              <th>
                最大譜線 <Unit>{'LSB^2'}</Unit>
              </th>
              <th>週期</th>
            </tr>
          </thead>
          <tbody>
            {sweep.map((s) => (
              <tr key={`${s.pdf}-${s.A}`}>
                <td>{s.pdf === 'uniform' ? 'RPDF' : 'TPDF'}</td>
                <td>{s.A}</td>
                <td>
                  {s.m.codeMin}–{s.m.codeMax}
                </td>
                <td>{fx(s.m.errPower, 4)}</td>
                <td>{s.theory ? fx(s.theory.errPower, 4) : '—'}</td>
                <td>{s.m.maxSpur ? <SpurAt power={s.m.maxSpur.power} fRel={s.m.maxSpur.f / DEFAULT_LAB_PARAMS.fs} /> : '無（沒有統計顯著譜線）'}</td>
                <td>{s.m.period || '無'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Callout kind="info" title="讀表">
        <ul>
          <li>
            <Tex>{String.raw`A=0`}</Tex> 就是方法 D：週期 {sweep[0].m.period}、主線{' '}
            <Tex>{String.raw`${fx(sweep[0].m.maxSpur?.power ?? NaN, 3)}\,\mathrm{LSB}^2`}</Tex> 在 <Tex>{String.raw`2f_u/5`}</Tex>，總功率 {fx(sweep[0].m.errPower, 2)}；白色模型卻預測{' '}
            {fx(sweep[0].theory?.errPower ?? NaN, 3)}（<Tex>{'2/12'}</Tex>；<ChapterErratum id="E15" />）。
          </li>
          <li>
            <Tex>{String.raw`A=0.25,\,0.5`}</Tex> LSB（RPDF）：本例的 code 範圍是 {small.map((s) => `${s.m.codeMin}–${s.m.codeMax}`).join('、')}
            {small.every((s) => s.m.levels === 2) ? (
              <>
                ，仍只有兩階；只用兩階且平均 32.4 的序列，總功率被鎖死在 <Tex>{'p(1-p)'}</Tex>（§13.4 的證明），所以<strong>仍是 {small.map((s) => fx(s.m.errPower, 2)).join('、')}</strong>。
              </>
            ) : (
              <>，總功率 {small.map((s) => fx(s.m.errPower, 3)).join('、')}。</>
            )}{' '}
            週期被打斷（偵測週期：{small.map((s) => s.m.period || '無').join('、')}），<Tex>{'2f_u/5'}</Tex> 的線功率 {small.map((s) => (s.m.maxSpur ? fx(s.m.maxSpur.power, 3) : '無')).join('、')}{' '}
            <Tex>{String.raw`\mathrm{LSB}^2`}</Tex>：變弱但沒有消失。
          </li>
          <li>
            <Tex>{String.raw`A=1`}</Tex> LSB（RPDF）：輸出變成 {r1.m.codeMin}–{r1.m.codeMax}（{r1.m.levels} 階）、總功率升到 {fx(r1.m.errPower, 3)}，
            {r1.m.maxSpur ? <>仍偵測到 {fx(r1.m.maxSpur.power, 3)} 的譜線</> : <>沒有統計顯著的譜線</>}——這是用「更多總功率」換「沒有 tone」。
          </li>
          <li>
            TPDF 的變異數只有 RPDF 的一半（<Tex>{String.raw`A^2/24`}</Tex> vs <Tex>{String.raw`A^2/12`}</Tex>）：同樣 <Tex>{String.raw`A=1`}</Tex> 時
            {t1.m.maxSpur ? (
              <>
                仍殘留 <Tex>{String.raw`${fx(t1.m.maxSpur.f / DEFAULT_LAB_PARAMS.fs, 2)}f_u`}</Tex> 的線（{fx(t1.m.maxSpur.power, 3)} <Tex>{String.raw`\mathrm{LSB}^2`}</Tex>）
              </>
            ) : (
              <>已沒有統計顯著的譜線</>
            )}
            ；<Tex>{String.raw`A=2`}</Tex> 時{t2.m.maxSpur ? <>仍有 {fx(t2.m.maxSpur.power, 3)} 的線</> : <>譜線消失</>}（總功率 {fx(t2.m.errPower, 3)}）。
          </li>
        </ul>
      </Callout>
      <Hand id="HC-13.7">
        把 <Tex>{'A'}</Tex> 改成 0、0.5、2，先自己算白色近似的總功率 <Tex>{String.raw`2(\tfrac1{12}+\sigma_d^2)`}</Tex>，和上表的模擬值比一比（<Tex>{String.raw`A<1`}</Tex> 時差很多；題目下方的補充觀察也會列出同一個 seed 實際跑出來的總功率）；再改 <Tex>{'f_u/f_B'}</Tex>，感受「頻寬減半、頻帶內功率變成{' '}
        <Tex>{String.raw`\tfrac18`}</Tex>」的三次方關係。
      </Hand>

      <Plot
        title={String.raw`C、D、E 的 code 誤差 PSD（常數 $w_H=32.4$，$f_u=1\,\mathrm{MHz}$）`}
        ariaLabel="C、D、E 的 code 誤差 PSD（常數 w_H = 32.4，f_u = 1 MHz）"
        data={data}
        height={300}
        xLog
        yLog
        csvName="ch13-cde-psd"
        layout={{ xaxis: { title: { text: String.raw`$f$ [Hz]` } }, yaxis: { title: { text: String.raw`PSD [$\mathrm{LSB}^2/\mathrm{Hz}$]` }, range: [-13, -3] } }}
        caption={
          <>
            Welch：Hann、nperseg {ps0.nperseg}、{ps0.nSegments} 段、ENBW {n(ps0.enbwHz, 4)} Hz、one-sided、<Tex>{String.raw`\mathrm{LSB}^2/\mathrm{Hz}`}</Tex>、去平均。D 只有{' '}
            <Tex>{'f_u/5'}</Tex>、<Tex>{'2f_u/5'}</Tex> 兩根譜線（PSD 圖上的高度取決於 ENBW，線功率請看譜線表）；E 以每 decade <Tex>{String.raw`+20\,\mathrm{dB}`}</Tex> 被塑形；C 是平的。
          </>
        }
      />
      <SourceTag kind="simulation" />

      <ModeGate min="engineer">
        <Fold title="工程取捨：E 不是免費的">
          <ul>
            <li>
              <strong>code 擺幅變大</strong>：量化器輸入 <Tex>{'u=w_H+r[n-1]+d[n]'}</Tex>，其中 <Tex>{String.raw`|r|\le\tfrac12+\tfrac A2`}</Tex>、<Tex>{String.raw`|d|\le\tfrac A2`}</Tex>，所以{' '}
              <Tex>{String.raw`|u-w_H|\le\tfrac12+A`}</Tex>。<Tex>{'A=1'}</Tex> 時 <Tex>{String.raw`u\in[32.4-1.5,\,32.4+1.5]=[30.9,\,33.9]`}</Tex>，<Tex>{'y'}</Tex> 會碰到 31 與 34（上表模擬：{r1.m.codeMin}–{r1.m.codeMax}），離 <Tex>{'w^*'}</Tex> 最多{' '}
              <Tex>{String.raw`34-32.4=1.6\,\mathrm{LSB}`}</Tex>。要永不 overload 需 <Tex>{String.raw`A\le w_H<2^B-1-A`}</Tex>（距離 0 與 63 各留 <Tex>{'A'}</Tex> LSB），否則 dither 被截斷、平均跑掉（實驗中會出現警告）。
            </li>
            <li>
              <strong>平均追蹤的常數變大</strong>：§13.4 的 telescoping 等式（F-13.12）照樣成立，但 <Tex>{'r'}</Tex> 的範圍由 <Tex>{String.raw`|r|\le\tfrac12`}</Tex> 變寬成 <Tex>{String.raw`|r|\le\tfrac12+\tfrac A2`}</Tex>（寬度 <Tex>{'1+A'}</Tex>）。起點 <Tex>{'r[-1]'}</Tex> 也在這個範圍內、沒有 overload 時，<Tex>{'N'}</Tex> 個 sample 的平均誤差上界由{' '}
              <Tex>{'1/N'}</Tex> 變成 <Tex>{'(1+A)/N'}</Tex>——仍以 <Tex>{'1/N'}</Tex> 變小，只是常數變大（<Tex>{'A=1'}</Tex> 時是 <Tex>{'2/N'}</Tex>）。 <ClaimTag kind="exact" />
            </li>
            <li>
              <strong>切換次數</strong>：每次 code 改變都是一次 DTC switching kick（§13.6）。E 的 toggle rate 與 D 同級，但每次跳動可能超過 1 LSB（本例 {fx(100 * jumps.p2, 1)}% 的更新跳 2 LSB、{fx(100 * jumps.p3, 1)}% 跳 3 LSB 以上；由模擬 trace 計算）。一次跳 2 LSB 以上，也代表 gray 碼「只翻 1 個 bit」的保證不成立，code 跨到非同步的 clock domain 時要改用 handshake（§13.6 第 4 點）。
            </li>
            <li>
              <strong>頻帶內仍很小</strong>：dither 也經過 <Tex>{String.raw`1-z^{-1}`}</Tex>，低頻誤差功率與 D 同量級——若 PLL 的 <Tex>{'T(f)'}</Tex> 會濾掉高頻，E 的代價就很小；若後面的 mixing 把高頻搬回通帶（§13.5 第 6 點），就要靠模擬判斷。
            </li>
            <li>
              <strong>dither 的來源</strong>：硬體多半用 PRBS，週期 <Tex>{'2^N-1'}</Tex> 一樣會留下細密譜線（§13.3）。 <ClaimTag kind="research" />
            </li>
          </ul>
        </Fold>
      </ModeGate>
    </Section>
  )
}
