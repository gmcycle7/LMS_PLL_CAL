import { useMemo } from 'react'
import { Callout, ClaimTag, CodeBlock, ModeGate, Prereq, Section, SourceTag, Tex, TexBlock } from '@/components'
import calNoiseSrc from '@/simulation/models/calNoise.ts?raw'
import {
  dtPsdOneSided,
  hpdMag2,
  integrateWithBreaks,
  mixBreakpoints,
  spurBeta,
  spurDbcBessel,
  spurDbcSmallAngle,
  tMag2,
} from '@/simulation/models/calNoise'
import { CODE_TABLE_PRM, EX, Erratum, Hand, SPUR, Steps, codeLabel, codeTable, md, sig } from '../common'

const PATH = 'src/simulation/models/calNoise.ts'

export function S5Paths() {
  const table = useMemo(() => codeTable(), [])
  // 常數 code 的 PD residual 拆成「主瓣（0…f_u/2）」與「ZOH image（f_u/2 以上）」兩部分：佐證「PD 主要看到 step」
  const pdSplit = useMemo(() => {
    const prm = CODE_TABLE_PRM
    const sys = { fs: prm.fs, N: prm.N, mu: prm.mu, p: EX.p, sEta: EX.sigmaEta2 }
    const code = { m: 1, A: 0, fx: 0, whiteVar: 0 }
    const fn = (f: number) => hpdMag2(f, prm.pll) * dtPsdOneSided(f, code, sys)
    const br = mixBreakpoints(EX.fu, 0, prm.fH, 6000)
    const main = integrateWithBreaks(fn, prm.fL, EX.fu / 2, br, 1e-12).value
    const img = integrateWithBreaks(fn, EX.fu / 2, prm.fH, br, 1e-12).value
    return { main: Math.sqrt(main), img: Math.sqrt(img), imgFrac: img / (main + img), t2fx: tMag2(prm.fx, prm.pll) }
  }, [])

  return (
    <>
      <Section kind="formula" title="§12.7 PD 看到 high-pass，PLL output 看到 low-pass" level={3} id="ch12-paths">
        <p>
          同一份 DTC 擾動 <Tex>{String.raw`\delta t`}</Tex>，在 PD 和在 PLL 輸出看到的頻譜完全不同。用最簡化的平均線性 PLL（DTC 誤差在 feedback 比較路徑注入）：
        </p>
        <Steps
          title={md(String.raw`$H_{\mathrm{PD}}$ 與 $T$（相位以 output 為參考）`)}
          steps={[
            {
              tex: String.raw`e_{\mathrm{PD}}=-\big(\theta_{\mathrm{out}}+\phi_{\mathrm{dtc}}\big)`,
              why: md(
                String.raw`reference 相位取 0；依規格 §12.3 的注入極性約定，DTC 的 timing 誤差等效成在比較點（feedback 側）加上相位 $\phi_{\mathrm{dtc}}$。若你的架構極性相反（例如 DTC 放在 reference 路徑），$\phi_{\mathrm{dtc}}$ 變號，下面所有結果只差一個負號——$|T|^2$、jitter、spur 的 dBc 都不變。`,
              ),
            },
            { tex: String.raw`\theta_{\mathrm{out}}=L(s)\,e_{\mathrm{PD}}`, why: md(String.raw`開迴路增益 $L$ = PD 增益 × loop filter × VCO 積分 ÷ 除數。`) },
            { tex: String.raw`\theta_{\mathrm{out}}=-L\theta_{\mathrm{out}}-L\phi_{\mathrm{dtc}}\ \Rightarrow\ \theta_{\mathrm{out}}=-\frac{L}{1+L}\phi_{\mathrm{dtc}}=-T\phi_{\mathrm{dtc}}`, why: '代入、移項、整理。' },
            { tex: String.raw`e_{\mathrm{PD}}=-(1-T)\phi_{\mathrm{dtc}}=-\frac{1}{1+L}\phi_{\mathrm{dtc}}=-H_{\mathrm{PD}}\phi_{\mathrm{dtc}}`, why: md(String.raw`代回第一式；$1-T=1/(1+L)$。`) },
            { tex: String.raw`H_{\mathrm{PD}}(s)+T(s)=1`, why: md(String.raw`迴路頻寬內 $T\approx1$（輸出跟著 DTC 誤差走，PD 幾乎看不到）；頻寬外 $H_{\mathrm{PD}}\approx1$（PD 全看到，輸出不跟）。`) },
            { tex: String.raw`\phi_{\mathrm{dtc}}=2\pi f_{\mathrm{out}}\,\delta t\ \Rightarrow\ \phi_{\mathrm{out}}=-2\pi f_{\mathrm{out}}\,T(s)\,\delta t(s)`, why: md(String.raw`時間換相位：一個 output 週期 $1/f_{\mathrm{out}}$ 對應 $2\pi$。`) },
          ]}
        />
        <TexBlock id="F-12.15" label="PD 與 output 的轉移">
          {String.raw`\boxed{H_{\mathrm{PD}}(s)=\frac1{1+L(s)},\qquad T(s)=\frac{L(s)}{1+L(s)}}`}
        </TexBlock>
        <TexBlock id="F-12.16" label="timing error → output phase">
          {String.raw`\boxed{\phi_{\mathrm{out}}(s)=-2\pi f_{\mathrm{out}}T(s)\,\delta t(s)},\qquad S^{(1)}_{\phi,\mathrm{out}}(f)=(2\pi f_{\mathrm{out}})^2|T(f)|^2S^{(1)}_{\delta t}(f)`}
        </TexBlock>
        <TexBlock id="F-12.17" label="output timing jitter">
          {String.raw`\boxed{\sigma_{t,\mathrm{out}}^2=\int_{f_L}^{f_H}|T(f)|^2S^{(1)}_{\delta t}(f)\,df}`}
        </TexBlock>
        <p>
          <ClaimTag kind="approx" /> F-12.17 已經是 time-jitter PSD 的積分，相位尺度 <Tex>{String.raw`(2\pi f_{\mathrm{out}})^2`}</Tex> 在換回時間時抵消。
          直接 PD noise 路徑與 LMS 的 cross-spectrum 在此忽略（Research Backlog R1）。<strong>PD error 小，不代表 output noise 小。</strong>
        </p>
      </Section>

      <Section kind="example" title="三種 code 的頻譜：0.399 / 0.282 / 0.009 fs 從哪來" level={3} id="ch12-three-codes">
        <p>
          同一個 <Tex>{`\\sigma_w=${sig(EX.sigmaW, 4)}\\ \\mathrm{fs}`}</Tex>，乘上三種不同的 code，在 <Tex>{String.raw`0\ldots f_{BW}=1\ \mathrm{MHz}`}</Tex>（理想 brick-wall
          的「PLL 頻寬」）內剩下多少？下表由 <code>codeSpectraAnalytic()</code> 以 F-12.13 + F-12.14 數值積分算出；最後兩欄改用 type-II PLL（<Tex>{String.raw`f_{3\mathrm{dB},T}=1\ \mathrm{MHz},\ \zeta=0.707`}</Tex>，
          積分 1 kHz–100 MHz）的 <Tex>{'|T|^2'}</Tex> 與 <Tex>{String.raw`|H_{\mathrm{PD}}|^2`}</Tex> 權重。
        </p>
        <div className="table-wrap">
          <table className="ch12-table">
            <thead>
              <tr>
                <th>code</th>
                <th className="num">
                  <Tex>{String.raw`\delta t`}</Tex> 總 RMS [fs]
                </th>
                <th className="num">
                  <Tex>{String.raw`0\ldots1\ \mathrm{MHz}`}</Tex> RMS [fs]
                </th>
                <th className="num">
                  output（<Tex>{'|T|^2'}</Tex>）[fs]
                </th>
                <th className="num">
                  PD residual（<Tex>{String.raw`|H_{\mathrm{PD}}|^2`}</Tex>）[fs]
                </th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.kind}>
                  <td>{codeLabel(r.kind)}</td>
                  <td className="num">{r.totalRms.toFixed(4)}</td>
                  <td className="num">{r.inbandRms < 0.01 ? r.inbandRms.toFixed(5) : r.inbandRms.toFixed(4)}</td>
                  <td className="num">{r.outRms.toFixed(4)}</td>
                  <td className="num">{r.pdRms.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul>
          <li>
            <strong>常數 code</strong>：<Tex>{String.raw`\delta t=\delta w`}</Tex>，功率集中在低頻（−3 dB 頻率 {(EX.f3dbExact / 1e3).toFixed(1)} kHz）：1 MHz 以內佔總功率的 {((table.rows[0]?.inbandFraction ?? NaN) * 100).toFixed(1)}% ⇒ 幾乎全部（只扣掉 ZOH step 的高頻能量）進入 PLL 頻寬，output 看到{' '}
            {table.rows[0]?.outRms.toFixed(3)} fs；PD 反而只看到 {table.rows[0]?.pdRms.toFixed(3)} fs，其中 {(pdSplit.imgFrac * 100).toFixed(0)}% 的功率來自{' '}
            <Tex>{'f_u/2'}</Tex> 以上的 ZOH image（step 能量，{pdSplit.img.toFixed(4)} fs），主瓣只貢獻 {pdSplit.main.toFixed(4)} fs。
          </li>
          <li>
            <strong>單頻 code</strong>：功率減半（<Tex>{String.raw`\overline{\cos^2}=\tfrac12`}</Tex>，RMS 乘 <Tex>{String.raw`1/\sqrt2`}</Tex>），被搬到 100 kHz ± 十幾 kHz，仍在頻寬內；
            output 值略大於 in-band 值，因為 type-II 的 <Tex>{'|T|'}</Tex> 在頻寬內有 peaking（<Tex>{`|T(f_x)|^2=${sig(pdSplit.t2fx, 4)}`}</Tex>）。
          </li>
          <li>
            <strong>
              <Tex>{String.raw`\pm1`}</Tex> 隨機 code
            </strong>：總功率仍是 <Tex>{String.raw`\sigma_w^2`}</Tex>，但攤平到 0…2 GHz，1 MHz 內只剩 <Tex>{String.raw`\sigma_w\sqrt{2f_{BW}/f_s}`}</Tex> ={' '}
            {table.rows[2]?.inbandRms.toFixed(5)} fs；相反地，PD 看到的 residual 很大（high-pass 讓寬頻成分通過）。
          </li>
        </ul>
        <Callout kind="ok" title="驗算">
          三個 in-band 數字 {table.rows.map((r) => r.inbandRms.toFixed(r.inbandRms < 0.01 ? 5 : 4)).join(' / ')} fs 與入門課的 0.399 / 0.282 / 0.009 fs 一致（差異來自 ZOH 的
          step 能量，E09）。下方 Code Spectra Lab 以逐 sample 模擬 + 整段 FFT 再驗證一次。 <SourceTag kind="illustrative" />
        </Callout>
      </Section>

    </>
  )
}

export function S5Spur() {
  const spurRows = useMemo(
    () =>
      [
        { at: 0.1, t: 1 },
        { at: 0.5, t: 1 },
        { at: 1, t: 1 },
        { at: 0.5, t: 0.1 },
        { at: 5, t: 1 },
        { at: 100, t: 1 },
      ].map((r) => {
        const beta = spurBeta(13e9, r.at, r.t)
        return { ...r, beta, small: spurDbcSmallAngle(beta), bessel: spurDbcBessel(beta) }
      }),
    [],
  )
  // 隨機 vs 相干：同樣總功率的 δt，一個是 skirt、一個是兩根 spur
  const rc = useMemo(() => {
    const fOut = 13e9
    const k2 = (2 * Math.PI * fOut * 1e-15) ** 2 // fs² → rad²
    const sDtPeak = 0.25 * EX.sw1Dc // tone code A = 1：S_δt^(1)(f_x) ≈ (A²/4)S_w^(1)(0)
    const Lpeak = 10 * Math.log10((k2 * sDtPeak) / 2)
    const toneRms = EX.sigmaW / Math.SQRT2 // A = 1 時 δt 的總 RMS
    const eachPeak = toneRms // 兩根 tone 各 peak = AB/2，B = √2σ_w ⇒ σ_w/√2
    const beta = spurBeta(fOut, eachPeak)
    return { Lpeak, toneRms, eachPeak, beta, dbc: spurDbcSmallAngle(beta), integ: 10 * Math.log10((k2 * toneRms * toneRms) / 2) }
  }, [])

  return (
    <>
      <Section kind="formula" title={String.raw`§12.8 Spur：13 GHz、0.5 fs peak ⇒ $-93.8$ dBc`} level={3} id="ch12-spur">
        <Prereq title="小角近似與 Bessel 展開">
          <p>
            <Tex>{String.raw`\beta\ll1`}</Tex> 時 <Tex>{String.raw`\cos\beta\approx1`}</Tex>、<Tex>{String.raw`\sin\beta\approx\beta`}</Tex>（泰勒一階）。
            精確版本是 Jacobi–Anger 展開 <Tex>{String.raw`e^{j\beta\sin\theta}=\sum_{n}J_n(\beta)e^{jn\theta}`}</Tex>，<Tex>{'J_n'}</Tex> 是 Bessel 函數（小 <Tex>{String.raw`\beta`}</Tex> 時{' '}
            <Tex>{String.raw`J_0\approx1,\ J_1\approx\beta/2`}</Tex>）。
          </p>
          <p>
            <strong>dBc</strong>：相對載波（carrier）的 dB。振幅比 <Tex>{'r'}</Tex> 寫成 <Tex>{String.raw`20\log_{10}r`}</Tex>、功率比寫成 <Tex>{String.raw`10\log_{10}r^2`}</Tex>，兩者是同一個數。
            離散的 spur 用 dBc；連續的雜訊裙擺要說「每 1 Hz 頻寬內」相對載波多少，單位是 <strong>dBc/Hz</strong>（<Tex>{String.raw`\mathcal L(f)`}</Tex>）。
          </p>
        </Prereq>
        <Steps
          title="單 tone 相位調變的邊帶"
          steps={[
            {
              tex: String.raw`\delta t(t)=A_t\sin(\omega_mt)\ \Rightarrow\ \phi_{\mathrm{out}}(t)=-2\pi f_{\mathrm{out}}|T(f_m)|\,A_t\sin\!\big(\omega_mt+\angle T(f_m)\big)`,
              why: md(String.raw`F-12.16：DTC 端的 timing tone（peak $A_t$、頻率 $f_m=\omega_m/2\pi$）經過 $T$——振幅乘 $|T(f_m)|$、相位移 $\angle T$——再乘 $-2\pi f_{\mathrm{out}}$ 換成相位。`),
            },
            {
              tex: String.raw`\phi(t)\equiv\beta\sin(\omega_mt),\qquad \beta=2\pi f_{\mathrm{out}}|T|A_t`,
              why: md(String.raw`負號與 $\angle T$ 只是把 tone 的起始相位平移，不影響邊帶的大小；所以只留下振幅 $\beta$（調變指數）。output timing tone 的 peak 是 $|T|A_t$。`),
            },
            {
              tex: String.raw`v(t)=\cos(\omega_ct+\phi)=\cos\omega_ct\cos\phi-\sin\omega_ct\sin\phi`,
              why: md(String.raw`PLL 輸出波形（振幅正規化為 1），$\omega_c=2\pi f_{\mathrm{out}}$ 是載波角頻率；用和角公式展開。`),
            },
            { tex: String.raw`\approx\cos\omega_ct-\beta\sin(\omega_mt)\sin(\omega_ct)`, why: md(String.raw`小角：$\cos\phi\approx1$、$\sin\phi\approx\phi$。`) },
            { tex: String.raw`=\cos\omega_ct-\frac{\beta}{2}\cos(\omega_c-\omega_m)t+\frac{\beta}{2}\cos(\omega_c+\omega_m)t`, why: md(String.raw`$\sin a\sin b=\tfrac12[\cos(a-b)-\cos(a+b)]$。`) },
            { tex: String.raw`\text{每個 spur}/\text{carrier}=\frac{\beta}{2}\ \Rightarrow\ 20\log_{10}\frac{\beta}{2}\ \mathrm{dBc}`, why: md(String.raw`振幅比取 $20\log_{10}$。`) },
            {
              tex: String.raw`\beta=2\pi\cdot13\times10^9\cdot0.5\times10^{-15}=${sig(SPUR.beta, 6)}\ \mathrm{rad}`,
              why: md(String.raw`T15 的條件：$|T|=1$、$A_t=AB/2=0.5$ fs peak（$B=1$ fs 的 $\delta w$ tone 乘上 $A=1$ 的 $x=\cos$，F-12.12）。單位換算 $1\ \mathrm{fs}=10^{-15}\ \mathrm s$。`),
            },
            { tex: String.raw`20\log_{10}\frac{\beta}{2}=${sig(SPUR.dbc, 6)}\ \mathrm{dBc}`, why: md(String.raw`精確 Bessel 版 $20\log_{10}(J_1/J_0)=${sig(SPUR.dbcBessel, 8)}$ dBc，差 $<10^{-8}$ dB。`) },
          ]}
        />
        <TexBlock id="F-12.18" label="單 tone spur">
          {String.raw`\boxed{\beta=2\pi f_{\mathrm{out}}|T|A_t,\qquad\text{spur}\approx20\log_{10}\frac{\beta}{2}=20\log_{10}(\pi f_{\mathrm{out}}|T|A_t)\ \mathrm{dBc}}`}
        </TexBlock>
        <CodeBlock source={calNoiseSrc} region="spur" path={PATH} title="spurBeta / spurDbcSmallAngle / spurDbcBessel" />
        <div className="table-wrap">
          <table className="ch12-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'A_t'}</Tex> [fs peak]
                </th>
                <th className="num">
                  <Tex>{'|T|'}</Tex>
                </th>
                <th className="num">
                  <Tex>{String.raw`\beta`}</Tex> [rad]
                </th>
                <th className="num">小角 [dBc]</th>
                <th className="num">Bessel [dBc]</th>
              </tr>
            </thead>
            <tbody>
              {spurRows.map((r) => (
                <tr key={`${r.at}-${r.t}`} className={r.at === 0.5 && r.t === 1 ? 'ch12-hl' : undefined}>
                  <td className="num">{r.at}</td>
                  <td className="num">{r.t}</td>
                  <td className="num">{r.beta.toExponential(4)}</td>
                  <td className="num">{r.small.toFixed(3)}</td>
                  <td className="num">{r.bessel.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          {md(
            String.raw`$f_{\mathrm{out}}=13$ GHz。$A_t$ 加倍 ⇒ +6.02 dB；$|T|=0.1$ ⇒ −20 dB。$\beta=${sig(spurRows[5].beta, 3)}$ rad（$A_t=100$ fs）時小角與 Bessel 只差 $${sig(Math.abs(spurRows[5].small - spurRows[5].bessel), 2)}$ dB。`,
          )}
        </p>
        <Hand id="HC-12.7">
          {md(
            String.raw`上表的每一列都可以用計算機按出來：把 $f_{\mathrm{out}}$ 換成你的 PLL 輸出頻率、$A_t$ 換成你估計的 timing tone，先自己算 $\beta$ 與 dBc（最容易錯的是 fs 換成秒、GHz 換成 Hz）。`,
          )}
        </Hand>
      </Section>

      <Section kind="assumptions" title="隨機 vs 相干：noise skirt 不是 spur" level={3}>
        <p>
          <strong>隨機</strong>的係數波動（LMS 的 <Tex>{String.raw`\delta w`}</Tex>）產生連續頻譜，在輸出是 phase-noise 的<strong>裙擺（skirt）</strong>，單位 dBc/Hz；
          只有<strong>相干 / 週期</strong>成分（例如 <Tex>{String.raw`\delta w`}</Tex> 被某個週期性干擾調變、或量化的 limit cycle，第 13 章）才會產生離散 spur，單位 dBc。
          同樣的總功率，兩者讀數完全不同：
        </p>
        <div className="table-wrap">
          <table className="ch12-table">
            <thead>
              <tr>
                <th>{md(String.raw`情境（$x=\cos(2\pi\cdot100\,\mathrm{kHz}\cdot t)$，$f_{\mathrm{out}}=13$ GHz，$|T|=1$）`)}</th>
                <th className="num">
                  <Tex>{String.raw`\delta t`}</Tex> 總 RMS [fs]
                </th>
                <th className="num">讀數</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{md(String.raw`隨機 $\delta w$（$\sigma_w=${EX.sigmaW.toFixed(3)}$ fs，ENBW ${(EX.enbw / 1e3).toFixed(1)} kHz）`)}</td>
                <td className="num">{rc.toneRms.toFixed(4)}</td>
                <td className="num">
                  <Tex>{`\\mathcal L(100\\,\\mathrm{kHz})\\approx${rc.Lpeak.toFixed(1)}\\ \\mathrm{dBc/Hz}`}</Tex>
                </td>
              </tr>
              <tr>
                <td>{md(String.raw`相干 $\delta w$ tone（同 RMS，peak $\sqrt2\,\sigma_w$）`)}</td>
                <td className="num">{rc.toneRms.toFixed(4)}</td>
                <td className="num">兩根 spur，各 {rc.dbc.toFixed(2)} dBc</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small muted">
          {md(
            String.raw`兩者的單邊帶積分相位功率相同：$10\log_{10}\big(\sigma_\phi^2/2\big)=10\log_{10}\big((2\pi f_{\mathrm{out}}\,\delta t_{\mathrm{rms}})^2/2\big)=${rc.integ.toFixed(2)}$ dBc。隨機版本把它攤在約 $2\cdot\mathrm{ENBW}$ 寬的裙擺裡（$f_x$ 兩側各一個 ENBW），所以任何一個 FFT bin 的讀數都遠低於 spur。FFT 上看到「一根線」之前，必須先確認它是 coherent（規格 §15.5：不能只靠一條 FFT 曲線說有 spur）。`,
          )}
        </p>
        <ModeGate min="engineer">
          <Callout kind="warn" title="注意假設">
            (1) 線性化 PLL 與 CT 原型 <Tex>{'T(s)'}</Tex>，只在 <Tex>{String.raw`f\ll f_s`}</Tex> 有效；(2) <Tex>{'x'}</Tex> 與 <Tex>{String.raw`\delta w`}</Tex> 獨立、平穩；
            (3) 忽略直接 PD noise 與 LMS 的 cross-spectrum；(4) 0.399 fs 是 gain-equivalent，乘上 code、經過 <Tex>{'T'}</Tex> 後才是 output timing jitter。 <ClaimTag kind="approx" />
            <Erratum id="E28" />
          </Callout>
        </ModeGate>
      </Section>
    </>
  )
}
