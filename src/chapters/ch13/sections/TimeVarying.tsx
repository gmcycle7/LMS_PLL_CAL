import { useMemo } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  Callout,
  ClaimTag,
  CodeBlock,
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
import { createRng } from '@/simulation/core'
import quantSrc from '@/simulation/models/quantizer.ts?raw'
import {
  LF_OSR_DIV,
  STRATEGY_LABEL,
  efbInbandWhite,
  efbPeriod,
  efbResidualVar,
  lmsTarget,
  runQuantLab,
  stochasticQuantVar,
  stochasticQuantVarApprox,
} from '@/simulation/models/quantizer'
import { DEFAULT_LAB_PARAMS, Erratum, Fold, STRATEGY_COLOR, SpurAt, Unit, fx, n, ntex, num, tx } from '../common'

const L = 1 << 14
const FU = 1e6
const FREEZE_AT = 4096
const F_DEMO = 8

export function TimeVaryingSection() {
  const tokens = useThemeTokens()
  const sim = useMemo(() => {
    const lab = runQuantLab({
      params: { ...DEFAULT_LAB_PARAMS, mixing: false, length: L, fs: FU, nperseg: 4096, arithmetic: 'fixed', fracBits: 16 },
      cases: [],
      compareAll: true,
      compareScenario: { lmsNoise: true, nUpd: 1 },
    })
    return lab.compare
  }, [])
  const freezeDemo = useMemo(() => {
    const p = { ...DEFAULT_LAB_PARAMS, mixing: false, length: L, fs: FU, arithmetic: 'fixed' as const, fracBits: F_DEMO, lmsFreezeAt: FREEZE_AT }
    const lab = runQuantLab({ params: p, cases: [{ id: 'D', strategy: 'deltaSigma', lmsNoise: true, nUpd: 1 }], compareAll: false })
    // 重建同一個 w_H（與模型相同的 seed 分支），取凍結值
    const t = lmsTarget({ target: p.target, length: FREEZE_AT, lmsNoise: true, sigmaW: p.sigmaW, pole: p.pole, driftPerK: 0, lmsFreezeAt: 0 }, createRng(p.seed).fork('lms-noise'))
    const D = 2 ** F_DEMO
    const K = Math.round(t.wH[FREEZE_AT - 1] * D)
    return { K, D, wFrozen: K / D, analytic: efbPeriod(K, D), detected: lab.runs[0].metrics.period }
  }, [])
  const data = useMemo<Data[]>(() => {
    const out: Data[] = []
    for (const r of sim) {
      if (r.strategy === 'freeze') continue
      out.push({ x: r.psd.f, y: r.psd.psd, name: STRATEGY_LABEL[r.strategy], line: { color: tokens.series[STRATEGY_COLOR[r.strategy]], width: 1.1 } })
    }
    const ref = sim.find((r) => r.psd.lmsRef)
    if (ref?.psd.lmsRef) out.push({ x: ref.psd.f, y: ref.psd.lmsRef, name: 'LMS 地板 S_δw（AR(1) 理論）', line: { color: tokens.text, dash: 'dash', width: 1.5 } })
    return out
  }, [sim, tokens])
  const ps = sim[0].psd
  const get = (st: string) => sim.find((r) => r.strategy === st)!
  const pw = useMemo(() => {
    const bcd = sim.filter((r) => r.strategy === 'toggle' || r.strategy === 'stochastic' || r.strategy === 'deltaSigma').map((r) => r.metrics.errPower)
    return { lo: Math.min(...bcd), hi: Math.max(...bcd), e: sim.find((r) => r.strategy === 'deltaSigmaDither')?.metrics.errPower ?? NaN }
  }, [sim])
  const sigmaW = DEFAULT_LAB_PARAMS.sigmaW
  const p0 = 0.4
  const epq = useMemo(() => stochasticQuantVar(DEFAULT_LAB_PARAMS.target, sigmaW), [sigmaW])
  const fBrel = 1 / LF_OSR_DIV
  // 白色近似的閉式與手算題 HC-13.7 / HC-13.8 共用同一份（quantizer.ts 的 core:whiteApprox）
  const shaped = efbInbandWhite(efbResidualVar(0), fBrel).lowFreq
  const epqApprox = stochasticQuantVarApprox(p0, sigmaW)
  const predC = 2 * epq * fBrel
  const C = get('stochastic').metrics
  const Dm = get('deltaSigma').metrics
  const Bm = get('toggle').metrics

  return (
    <Section kind="explore" title={<>§13.5a 情境：<Tex>{'w_H'}</Tex> 含 LMS 更新雜訊時，策略才真正不同</>} level={2} id="ch13-time-varying">
      <p>
        前面幾節都假設 <Tex>{String.raw`w_H`}</Tex> 是常數 32.4。真正的晶片裡 LMS 一直在更新，<Tex>{String.raw`w_H[n]=w^*+\delta w[n]`}</Tex> 會在 <Tex>{String.raw`w^*`}</Tex> 附近以 <Tex>{String.raw`\sigma_w`}</Tex> 的 RMS 隨機擺動（第 12 章）。
        <Erratum id="E15" /> 要求 §13.5 的五策略比較必須同時跑「<Tex>{String.raw`w_H`}</Tex> 常數」與「<Tex>{String.raw`w_H`}</Tex> 含 LMS 雜訊」兩種情境。
      </p>
      <Prereq title="AR(1) 隨機過程與高斯分布（第 12 章係數雜訊的模型）">
        <p className="small">
          高斯（常態）分布 <Tex>{String.raw`\mathcal N(m,\sigma^2)`}</Tex> 的機率密度是 <Tex>{String.raw`f(x)=\frac{1}{\sigma\sqrt{2\pi}}e^{-(x-m)^2/(2\sigma^2)}`}</Tex>：平均 <Tex>{'m'}</Tex>、變異數 <Tex>{String.raw`\sigma^2`}</Tex> 的鐘形曲線。
          本節用到「獨立、零平均、變異數 1」三個性質，以及對 <Tex>{'f(x)'}</Tex> 做積分求期望值。
        </p>
        <StepDerivation
          steps={[
            { tex: String.raw`\delta w[n+1]=p_\mathrm{cal}\,\delta w[n]+\sqrt{1-p_\mathrm{cal}^2}\,\sigma_w\,\xi[n],\quad\xi\sim\mathcal N(0,1)`, why: tx(String.raw`第 12 章的 $\delta w_{k+1}=p\,\delta w_k+\mu\eta_k$，這裡直接用穩態 RMS $\sigma_w$ 參數化（本章 $p$ 已用於小數部分，所以 pole 記為 $p_\mathrm{cal}$）。`) },
            { tex: String.raw`\mathrm{Var}(\delta w)=p_\mathrm{cal}^2\mathrm{Var}(\delta w)+(1-p_\mathrm{cal}^2)\sigma_w^2\;\Rightarrow\;\mathrm{Var}(\delta w)=\sigma_w^2`, why: tx(String.raw`穩態時前後兩刻的變異數相同；$\xi[n]$ 與 $\delta w[n]$ 獨立，變異數相加。`) },
            { tex: String.raw`\Delta W(z)=\frac{g}{1-p_\mathrm{cal}z^{-1}}\,\Xi(z),\qquad g=\sqrt{1-p_\mathrm{cal}^2}\,\sigma_w`, why: tx(String.raw`遞迴取 Z transform：$\delta w$ 是白雜訊 $\xi$ 經過一階 low-pass 濾波器。`) },
            { tex: String.raw`S_{\delta w}(e^{j\Omega})=\frac{g^2\cdot1}{|1-p_\mathrm{cal}e^{-j\Omega}|^2}=\frac{(1-p_\mathrm{cal}^2)\sigma_w^2}{1-2p_\mathrm{cal}\cos\Omega+p_\mathrm{cal}^2}`, why: tx(String.raw`濾波後的 PSD = $|H|^2\times$ 輸入 PSD（白色 $\xi$ 的 PSD 為 1）；展開 $|1-pe^{-j\Omega}|^2=1-2p\cos\Omega+p^2$。`) },
            { tex: String.raw`S_{\delta w}^{(1)}(f)=\frac{2}{f_u}S_{\delta w}\big(e^{j2\pi f/f_u}\big)`, why: tx(String.raw`換成 one-sided、每 Hz（勘誤 E28 的換算）。頻寬約 $(1-p_\mathrm{cal})f_u/(2\pi)$。`) },
          ]}
        />
      </Prereq>
      <ModeGate min="engineer">
        <Fold title={<>程式碼：<Tex>{'w_H[n]'}</Tex> 怎麼產生（lmsTarget）</>}>
          <CodeBlock source={quantSrc} region="lmsTarget" path="src/simulation/models/quantizer.ts" caption="穩態起跑（沒有暫態）；PVT 漂移與 LMS 凍結也在這裡。" />
        </Fold>
      </ModeGate>

      <h3>每個策略看到的是什麼？</h3>
      <ul>
        <li>
          <strong>A Freeze</strong>：根本不看 <Tex>{String.raw`w_H`}</Tex>——LMS 雜訊<em>不會</em>進到 DTC（優點！），但 <Tex>{String.raw`-0.4\,\mathrm{LSB}`}</Tex> 的 static error 與 PVT 漂移都留著。
        </li>
        <li>
          <strong>B Toggle</strong>：小數部分被量化成 <Tex>{String.raw`h/L_t`}</Tex>；<Tex>{String.raw`w_H`}</Tex> 越過 <Tex>{String.raw`\lfloor w_H\rfloor+(h\pm\tfrac12)/L_t`}</Tex> 的門檻時 pattern 突然改變：頻帶內多了一個「<Tex>{'1/L_t'}</Tex>
          階梯」誤差，<Tex>{String.raw`2f_u/5`}</Tex> 的線也還在（變弱）。
        </li>
        <li>
          <strong>C Stochastic</strong>：<Tex>{String.raw`E[y\,|\,w_H]=w_H`}</Tex>（無偏），但每一刻多了一個變異數 <Tex>{String.raw`p[n](1-p[n])`}</Tex> 的白色誤差，平均起來是{' '}
          <Tex>{String.raw`E[p(1-p)]`}</Tex>，其中 <Tex>{String.raw`f_B/(f_u/2)`}</Tex> 的比例落在頻帶內。
        </li>
        <li>
          <strong>D ΔΣ</strong>：<Tex>{String.raw`e[n]=y[n]-w^*=\delta w[n]+r[n-1]-r[n]`}</Tex>（F-13.7 兩邊減 <Tex>{'w^*'}</Tex>）。輸入一直在變（LMS 雜訊本身就像 dither），<Tex>{'r'}</Tex> 不再週期，limit cycle 消失；量化誤差被推到高頻，頻帶內幾乎只剩 LMS 地板。
        </li>
        <li>
          <strong>E ΔΣ + dither</strong>：與 D 相同的頻帶內表現，高頻多出 dither 的功率。
        </li>
      </ul>
      <StepDerivation
        title={<>頻帶內量化誤差有多大？（<Tex>{'f_B=f_u/64'}</Tex>）</>}
        steps={[
          { tex: String.raw`P_{\mathrm{in}}^{(D)}\approx\int_0^{f_B}4\sin^2\!\Big(\frac{\pi f}{f_u}\Big)\frac{2\sigma_r^2}{f_u}\,df\approx\int_0^{f_B}\Big(\frac{2\pi f}{f_u}\Big)^2\frac{2\sigma_r^2}{f_u}\,df`, why: tx(String.raw`F-13.9 的白色近似，再用 NTF 的低頻近似 $\sin x\approx x$（$f_B\ll f_u$）。`) },
          { tex: String.raw`=\frac{8\pi^2\sigma_r^2}{f_u^3}\cdot\frac{f_B^3}{3}=\frac{8\pi^2}{3}\sigma_r^2\Big(\frac{f_B}{f_u}\Big)^3`, why: tx(String.raw`$\int_0^{f_B}f^2\,df=f_B^3/3$。`) },
          { tex: String.raw`\sigma_r^2=\tfrac1{12},\ \frac{f_B}{f_u}=\frac1{64}\;\Rightarrow\;P_{\mathrm{in}}^{(D)}\approx${ntex(shaped, 3)}\ \mathrm{LSB}^2`, why: tx(String.raw`代入（時變輸入下 $r$ 近似均勻、白色才勉強合理——對常數輸入不成立）。`) },
          { tex: String.raw`E[p(1-p)]=\int f(x)\,\mathrm{frac}(x)\big(1-\mathrm{frac}(x)\big)\,dx\approx p_0(1-p_0)-\sigma_w^2=${fx(p0 * (1 - p0), 2)}-${fx(sigmaW ** 2, 2)}=${fx(epqApprox, 2)}`, why: tx(String.raw`$w_H\sim\mathcal N(32.4,\sigma_w^2)$；若 $w_H$ 幾乎不越過整數，$p=w_H-32$，$E[p]=p_0$、$E[p^2]=p_0^2+\sigma_w^2$，所以 $E[p-p^2]=p_0(1-p_0)-\sigma_w^2$。`) },
          { tex: String.raw`E[p(1-p)]\big|_{\text{數值積分}}=${fx(epq, 4)}\ \mathrm{LSB}^2`, why: tx(String.raw`把越過 32 / 33 的尾巴也算進去（$\texttt{stochasticQuantVar()}$，Simpson 積分）。`) },
          { tex: String.raw`P_{\mathrm{in}}^{(C)}=\frac{2E[p(1-p)]}{f_u}\,f_B=2\times${fx(epq, 4)}\times\frac1{64}=${fx(predC, 5)}\ \mathrm{LSB}^2`, why: tx(String.raw`白色誤差落在頻帶內的比例就是頻寬的比例（one-sided PSD 高度 $\times$ 頻寬）。`) },
        ]}
      />
      <TexBlock id="F-13.13">{String.raw`E[p(1-p)]\approx p_0(1-p_0)-\sigma_w^2,\qquad P_\mathrm{in}^{(C)}=2E[p(1-p)]\frac{f_B}{f_u},\qquad P_\mathrm{in}^{(D)}\approx\frac{8\pi^2}{3}\sigma_r^2\Big(\frac{f_B}{f_u}\Big)^3`}</TexBlock>
      <p>
        <ClaimTag kind="approx" /> 下表是實際模擬（<Tex>{String.raw`\sigma_w=${sigmaW}\,\mathrm{LSB}`}</Tex>、<Tex>{String.raw`p_\mathrm{cal}=${DEFAULT_LAB_PARAMS.pole}`}</Tex>、<Tex>{'F=16'}</Tex> bit 定點、{L} 次更新、同一 seed）。
        「頻帶內量化誤差」直接對 <Tex>{String.raw`\epsilon=y-w_H`}</Tex> 做 Welch 再積分，不受 <Tex>{String.raw`\epsilon`}</Tex> 與 <Tex>{String.raw`\delta w`}</Tex> 交叉項的影響：模擬 C ={' '}
        <Tex>{String.raw`${fx(C.lfQuantPower, 5)}`}</Tex>（白色近似 {fx(predC, 5)}，比值 {fx(C.lfQuantPower / predC, 2)}），D = <Tex>{ntex(Dm.lfQuantPower, 3)}</Tex>（白色近似 <Tex>{ntex(shaped, 3)}</Tex>——
        <Tex>{'r'}</Tex> 並不真的白，只有數量級可信）。這三個式子可以自己代數字算：<Tex>{String.raw`P_\mathrm{in}^{(D)}`}</Tex> 在上一節的手算題 HC-13.7，<Tex>{String.raw`E[p(1-p)]`}</Tex> 與{' '}
        <Tex>{String.raw`P_\mathrm{in}^{(C)}`}</Tex> 在章末的綜合手算 HC-13.8（那裡用的是可以筆算的近似 <Tex>{String.raw`p_0(1-p_0)-\sigma_w^2`}</Tex>，和這裡的數值積分差約 2%）。
      </p>
      <div className="table-wrap">
        <table className="ch13-table ch13-table-wide" aria-label="w_H 含 LMS 雜訊時五種策略的 DC 誤差、總功率、頻帶內誤差、LMS 地板、頻帶內量化誤差、最大譜線與週期">
          <thead>
            <tr>
              <th>策略</th>
              <th>
                DC 誤差 <Tex>{String.raw`\bar e`}</Tex> <Unit>{'LSB'}</Unit>
              </th>
              <th>
                總功率 <Tex>{String.raw`\overline{e^2}`}</Tex> <Unit>{'LSB^2'}</Unit>
              </th>
              <th>
                頻帶內 <Tex>{'e'}</Tex>（含 LMS）<Unit>{'LSB^2'}</Unit>
              </th>
              <th>
                LMS 地板 <Tex>{String.raw`\delta w`}</Tex> <Unit>{'LSB^2'}</Unit>
              </th>
              <th>
                頻帶內量化誤差 <Tex>{String.raw`\epsilon`}</Tex> <Unit>{'LSB^2'}</Unit>
              </th>
              <th>
                最大譜線 <Unit>{'LSB^2'}</Unit>
              </th>
              <th>週期</th>
            </tr>
          </thead>
          <tbody>
            {sim.map((r) => (
              <tr key={r.strategy}>
                <td className="nowrap">{STRATEGY_LABEL[r.strategy]}</td>
                <td>{fx(r.metrics.dcError, 4)}</td>
                <td>{fx(r.metrics.errPower, 4)}</td>
                <td>{num(r.metrics.lfErrPower, 3)}</td>
                <td>{r.strategy === 'freeze' ? <>—（不追蹤 <Tex>{'w_H'}</Tex>）</> : num(r.metrics.lfLmsPower, 3)}</td>
                <td>{r.strategy === 'freeze' ? '—' : num(r.metrics.lfQuantPower, 3)}</td>
                <td>{r.metrics.maxSpur ? <SpurAt power={r.metrics.maxSpur.power} fRel={r.metrics.maxSpur.f / FU} /> : '—'}</td>
                <td>{r.metrics.period || '無'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        「頻帶內」<Tex>{String.raw`=\mathrm{DC}^2+\int_0^{f_B}S\,df`}</Tex>，全部為 Welch 估計（Hann、nperseg {ps.nperseg}、{ps.nSegments} 段），64 個 bin 的積分有約 <Tex>{String.raw`\pm10\%`}</Tex> 的估計誤差。Freeze 不追蹤{' '}
        <Tex>{'w_H'}</Tex>：它的 <Tex>{'e'}</Tex> 是常數 <Tex>{String.raw`${fx(get('freeze').metrics.dcError, 1)}`}</Tex>，頻帶內就是 <Tex>{String.raw`\overline e^{\,2}=${fx(get('freeze').metrics.lfErrPower, 2)}`}</Tex>，LMS 雜訊完全不進 DTC。
      </p>
      <Plot
        title={String.raw`$w_H$ 含 LMS 雜訊：B、C、D、E 的 code 誤差 PSD`}
        ariaLabel="w_H 含 LMS 雜訊：B、C、D、E 的 code 誤差 PSD"
        data={data}
        height={300}
        xLog
        yLog
        csvName="ch13-time-varying-psd"
        layout={{ xaxis: { title: { text: 'f [Hz]（f_u = 1 MHz）' } }, yaxis: { title: { text: 'PSD [LSB²/Hz]' } } }}
        caption={
          <>
            Welch：Hann、nperseg {ps.nperseg}、{ps.nSegments} 段、ENBW {n(ps.enbwHz, 4)} Hz、one-sided、<Tex>{String.raw`\mathrm{LSB}^2/\mathrm{Hz}`}</Tex>。低頻時 D、E 貼著 LMS 地板（虛線），C 多一個白色地板、B 多一個{' '}
            <Tex>{'1/L_t'}</Tex> 階梯誤差；高頻 C 平、D/E 上翹（每 decade <Tex>{String.raw`+20\,\mathrm{dB}`}</Tex>）、B 仍有 <Tex>{'2f_u/5'}</Tex> 的峰。
          </>
        }
      />
      <SourceTag kind="simulation" />

      <Callout kind="ok" title="結論（由上表的模擬數字得出）">
        時變情境下，ΔΣ（D、E）的平均追蹤 <Tex>{String.raw`w_H`}</Tex>（telescoping），頻帶內量化誤差只有{' '}
        <Tex>{String.raw`${ntex(Dm.lfQuantPower, 2)}\,\mathrm{LSB}^2`}</Tex>，遠小於 LMS 地板 <Tex>{ntex(Dm.lfLmsPower, 2)}</Tex>；toggle 多一個 <Tex>{String.raw`1/L_t`}</Tex>{' '}
        階梯（<Tex>{ntex(Bm.lfQuantPower, 2)}</Tex>）、stochastic 多一個白色地板（<Tex>{ntex(C.lfQuantPower, 2)}</Tex>）。 但 B、C、D 的總功率都在{' '}
        {fx(pw.lo, 3)}–{fx(pw.hi, 3)} <Tex>{String.raw`\mathrm{LSB}^2`}</Tex> 之間（E 因 dither 為 {fx(pw.e, 3)}），差別仍只在<strong>頻率分布</strong>——所以要不要選 ΔΣ，取決於下游（DSM residue mixing 與{' '}
        <Tex>{String.raw`T(f)`}</Tex>）對哪個頻帶敏感（§13.5b）。
      </Callout>

      <ModeGate min="engineer">
        <Fold title="Freeze/Track 切換：LMS 凍結後，limit cycle 又回來了">
          <p>
            若 LMS 在第 {FREEZE_AT} 次更新後凍結，<Tex>{'w_H'}</Tex> 變成一個 <Tex>{String.raw`F=${F_DEMO}`}</Tex> bit 的定點常數 <Tex>{String.raw`K/2^F`}</Tex>，套用 §13.4 的定理，ΔΣ 會落入週期{' '}
            <Tex>{String.raw`2^F/\gcd(K\bmod2^F,2^F)`}</Tex> 的 limit cycle：
          </p>
          <ul className="small">
            <li>
              凍結值 <Tex>{String.raw`w_H=${freezeDemo.K}/${freezeDemo.D}=${fx(freezeDemo.wFrozen, 8)}`}</Tex>
            </li>
            <li>
              解析週期 <Tex>{String.raw`${freezeDemo.D}/\gcd(${freezeDemo.K % freezeDemo.D},${freezeDemo.D})=${freezeDemo.analytic}`}</Tex>；模擬偵測週期 <strong>{freezeDemo.detected}</strong>{' '}
              <span className={freezeDemo.analytic === freezeDemo.detected ? 'ch13-ok' : 'ch13-bad'}>{freezeDemo.analytic === freezeDemo.detected ? '✓' : '✗'}</span>
            </li>
          </ul>
          <p className="small">
            實務含意：背景 LMS 若在 PVT 穩定後凍結以省電，ΔΣ 的 tone 會重新出現；需要保留一點 dither（方法 E），或乾脆凍結 6-bit code 本身（方法 A）。 <ClaimTag kind="exact" />
          </p>
        </Fold>
      </ModeGate>
    </Section>
  )
}
