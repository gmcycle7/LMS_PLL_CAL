import { useEffect, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import {
  Callout,
  ClaimTag,
  CodeBlock,
  ExperimentShell,
  ParamControl,
  Plot,
  Prereq,
  Section,
  StepDerivation,
  Tex,
  TexBlock,
  useDebouncedValue,
  useThemeTokens,
  type CheckEntry,
  type MetricRow,
} from '@/components'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import biasSrc from '@/simulation/models/bias.ts?raw'
import { nearIntegerSensitivity, type NearIntegerParams, type NearIntegerResult } from '@/simulation/models/bias'
import { F } from '../formulas'
import { Erratum, ModeDetails, num, m, texNum } from '../common'
import { Hand } from '../Hand'

const NI_ID = 'bias-near-integer'

function logspace(lo: number, hi: number, n: number): number[] {
  const a = Math.log10(lo)
  const b = Math.log10(hi)
  return Array.from({ length: n }, (_, i) => 10 ** (a + ((b - a) * i) / (n - 1)))
}

interface P {
  wnTs: number
  zeta: number
  loopDelay: number
  kappaDirect: number
  sigmaV: number
}
const DEFAULT: P = { wnTs: 0.02, zeta: 0.707, loopDelay: 1, kappaDirect: 0.01, sigmaV: 1 }

const NI_LAYOUT: Partial<Layout> = {
  xaxis: { title: { text: 'FCW frac（越小越接近整數）' } },
  yaxis: { title: { text: 'C' }, type: 'log' },
  yaxis2: { title: { text: '|w* − a|（t.u.）' }, overlaying: 'y', side: 'right', type: 'log', showgrid: false },
}

function NearIntegerExperiment() {
  const tokens = useThemeTokens()
  const [p, setP] = useState<P>(DEFAULT)
  const set = <K extends keyof P>(k: K) => (v: P[K]) => setP((s) => ({ ...s, [k]: v }))
  const params: NearIntegerParams = useMemo(
    () => ({ fracs: logspace(3e-4, 0.5, 32), wnTs: p.wnTs, zeta: p.zeta, loopDelay: p.loopDelay, kappaDirect: p.kappaDirect, sigmaV: p.sigmaV }),
    [p],
  )
  const key = useDebouncedValue(JSON.stringify(params), 350)
  const [res, setRes] = useState<NearIntegerResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const { run, running } = useWorkerTask<NearIntegerParams, NearIntegerResult>('bias', 'nearIntegerSweep', { restartOnRun: true })
  useEffect(() => {
    setErr(null)
    run(JSON.parse(key) as NearIntegerParams).then(setRes, (e: unknown) => {
      if (!isWorkerCancelled(e)) setErr((e as Error).message)
    })
  }, [key, run])

  const data: Data[] = useMemo(() => {
    if (!res) return []
    return [
      { x: res.frac, y: res.Cfreq, mode: 'lines', name: 'C（頻域：Σ|X_k|²·Re H_PD）', line: { color: tokens.series[0], width: 2 } },
      { x: res.frac, y: res.C, mode: 'markers', name: 'C（時域：序列通過 H_PD）', marker: { color: tokens.series[0], size: 6, symbol: 'circle-open' } },
      {
        x: res.frac,
        y: res.CinBand.map((v) => -v),
        mode: 'lines',
        name: '−C_in-band（頻寬內諧波，Re H_PD < 0）',
        line: { color: tokens.series[3], dash: 'dot' },
      },
      { x: res.frac, y: res.bias.map((v) => Math.abs(v)), mode: 'lines+markers', name: '|w* − a| = |B/C|（右軸）', yaxis: 'y2', line: { color: tokens.series[2] }, marker: { size: 4 } },
    ]
  }, [res, tokens])

  const metrics: MetricRow[] = []
  const warnings: string[] = []
  if (res && res.frac.length) {
    const i0 = 0
    const iLast = res.frac.length - 1
    metrics.push(
      { name: `$C$（frac $=${texNum(res.frac[i0], 3)}$，頻域）`, value: res.Cfreq[i0], formulaId: 'F-11.14', analytic: res.C[i0], tolerance: 1e-6, toleranceMode: 'rel', note: 'analytic 欄 = 時域值' },
      { name: `其中頻寬內諧波的貢獻（frac $=${texNum(res.frac[i0], 3)}$）`, value: res.CinBand[i0], note: String.raw`$\mathrm{Re}\,H_\mathrm{PD}<0\Rightarrow$ 負；與頻寬外的正貢獻幾乎抵銷` },
      { name: `$w^*-a$（frac $=${texNum(res.frac[i0], 3)}$）`, value: res.bias[i0], unit: 't.u.', claim: 'approx' },
      { name: `$C$（frac $=${texNum(res.frac[iLast], 3)}$）`, value: res.Cfreq[iLast] },
      { name: `$w^*-a$（frac $=${texNum(res.frac[iLast], 3)}$）`, value: res.bias[iLast], unit: 't.u.' },
      { name: String.raw`GMAC 斜率 $S=K_q\,C$（frac 最小處）`, value: res.slope[i0], unit: 't.u.⁻¹', formulaId: 'F-11.15', note: '越小 ⇒ 收斂越慢、對 bias 越敏感' },
      { name: String.raw`低 frac 冪次 $d\ln C/d\ln\mathrm{frac}$（最小 6 點擬合）`, value: res.lowFracExponent, note: String.raw`$\mathrm{frac}\ll\omega_nT_s/2\pi$ 時 $\to2$` },
      { name: '時域 vs 頻域最大相對差', value: res.maxRelDiff, note: `時域略過 ${res.skip} 個暫態 sample，取整數個週期` },
    )
    const neg = res.frac.filter((_, i) => res.Cfreq[i] <= 0)
    if (neg.length)
      warnings.push(
        String.raw`$C\le0$（frac $=${neg.map((f) => texNum(f, 3)).join(',\\ ')}$）：更新極性錯誤，$w^*=a+B/C$ 是 repelling 的點，正 learning rate 會使平均誤差發散（見 Ch06 與 SSPLL 案例）。`,
      )
  }
  if (res) warnings.push(...res.warnings)
  if (err) warnings.push(`計算失敗：${err}`)

  const freqCheck: CheckEntry = res && res.frac.length
    ? { status: res.maxRelDiff < 1e-6 ? 'ok' : 'mismatch', note: `頻域（週期穩態 Parseval）vs 時域（濾波 + 整數週期平均）：最大相對差 ${num(res.maxRelDiff, 2)}` }
    : { status: 'n/a', note: running ? '計算中…' : '—' }

  return (
    <ExperimentShell
      id={NI_ID}
      title={String.raw`Near-integer：$C(\mathrm{FCW})\to0$ 時 bias 被放大`}
      level="L2"
      claim="approx"
      source="simulation"
      description={
        <>
          first-order DSM residue（16-bit、標準化為 <Tex>{'E[x]=0,\\ E[x^2]=1'}</Tex>）通過 type-II DPLL 的 <Tex>{String.raw`H_\mathrm{PD}(z)`}</Tex>，計算{' '}
          <Tex>{String.raw`C=E[x\,(h_\mathrm{PD}*x)]`}</Tex>。兩條獨立路徑：時域（序列從靜止狀態濾波、略過暫態、取整數個週期平均）與頻域（一個週期的 DFT，
          <Tex>{String.raw`C=\sum_k|X_k|^2\,\mathrm{Re}\,H_\mathrm{PD}(e^{j\Omega_k})`}</Tex>）。干擾 <Tex>{String.raw`\kappa_d\,x`}</Tex> 直接耦合到 PD（不經過{' '}
          <Tex>{String.raw`H_\mathrm{PD}`}</Tex>），所以 <Tex>{String.raw`B=\kappa_dE[x^2]=\kappa_d`}</Tex>。
        </>
      }
      assumptions={[
        '$K_q$ 線性化；$B$ 固定（直接耦合的 code-correlated DJ）——示意用的干擾模型',
        String.raw`主 PLL：designDtLoop 的 DPLL 差分方程（勘誤 E44 的 DT 模型），$H_\mathrm{PD}=1/(1+L)$`,
        String.raw`first-order DSM、16-bit 累加器：residue 週期 $P=2^{16}/\gcd(K,2^{16})$；時域視窗 = 整數個 $P$`,
      ]}
      params={{ ...p }}
      units={{ kappaDirect: 't.u.', sigmaV: 't.u.', wnTs: 'rad/sample', loopDelay: 'samples', zeta: '—' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: freqCheck,
        monteCarlo: { status: 'n/a', note: '確定性序列（無隨機性），不需要 Monte Carlo' },
        fixedPoint: 'not-implemented',
      }}
      exportData={(): Record<string, ArrayLike<number>> =>
        res ? { frac: res.frac, period: res.period, C_time: res.C, C_freq: res.Cfreq, C_in_band: res.CinBand, w_minus_a: res.bias, slope: res.slope } : {}
      }
      actions={{ onReset: () => setP(DEFAULT), running }}
      controls={
        <>
          <ParamControl label="ω_nT_s（主 PLL 頻寬）" value={p.wnTs} onChange={set('wnTs')} min={0.002} max={0.3} log unit="rad/sample" reg="Behavioral：主 PLL ω_n/f_s" />
          <ParamControl label="ζ（阻尼）" value={p.zeta} onChange={set('zeta')} min={0.3} max={2} step={0.01} unit="—" reg="Behavioral：主 PLL damping" />
          <ParamControl label="loop delay" value={p.loopDelay} onChange={set('loopDelay')} min={0} max={4} integer clampOnBlur unit="samples" reg="Behavioral：PLL loop latency" />
          <ParamControl label="κ_d（直接耦合係數）" value={p.kappaDirect} onChange={set('kappaDirect')} min={-0.2} max={0.2} step={0.001} unit="t.u." reg="Behavioral：PD 端 code-correlated 耦合" />
          <ParamControl label="σ_v" value={p.sigmaV} onChange={set('sigmaV')} min={0.01} max={10} log unit="t.u." reg="Behavioral：comparator noise（給 K_q）" />
        </>
      }
    >
      <Plot
        title="$C$ 與 $|w^*-a|$ 隨 FCW 小數部分變化（log–log）"
        data={data}
        layout={NI_LAYOUT}
        height={320}
        xLog
        csvName="bias-near-integer"
        caption={String.raw`實線 = 頻域、圓圈 = 時域（兩者應重合）；點線 = 頻寬內諧波的負貢獻大小。$\mathrm{frac}\to0$ 時 $C$ 約以 $\mathrm{frac}^2$ 下降（冪次見指標），bias $B/C$ 約以 $1/\mathrm{frac}^2$ 上升。`}
      />
      {res && res.frac.length > 0 && (
        <p className="small muted">
          {m(
            `你會發現：frac $=${texNum(res.frac[0], 3)}$ 時，頻寬內諧波貢獻 $${texNum(res.CinBand[0], 4)}$、頻寬外 $${texNum(res.Cfreq[0] - res.CinBand[0], 4)}$，兩者幾乎抵銷，只剩 $C=${texNum(res.Cfreq[0], 4)}$。`,
          )}
        </p>
      )}
    </ExperimentShell>
  )
}

/** §11.4：Near-integer / near-grid 的敏感度 w* = a + B/C。 */
export function NearIntegerSection() {
  const sens = useMemo(() => {
    const B = 0.01
    // 與手算題 HC-11.7 共用同一個模型函式（bias.ts 的 nearIntegerSensitivity）
    return [1, 0.1, 0.01, -0.01].map((C) => {
      const r = nearIntegerSensitivity(B, C, 1)
      return { C, bias: r.bias, dwdC: r.dBiasdC }
    })
  }, [])
  return (
    <Section kind="formula" title={m('11.4 Near-integer / near-grid：當 $C\\to0$')} level={2} id="ch11-near-integer">
      <p className="small">
        <Erratum id="E12" note="此處 C = E[x(h*x)] 同 §6；B 為干擾 bias 項" />
        注意符號：這裡的 <Tex>{'C'}</Tex> 是 Ch06 的有效相關 <Tex>{String.raw`C=E[x\,(h*x)]`}</Tex>（code 經過主 PLL 誤差路徑 <Tex>{'h'}</Tex> 才到 PD），<Tex>{'B'}</Tex> 是 F-11.4
        的分子 <Tex>{String.raw`B_\mathrm{bias}=bE[x]+E[xd]+E[x\varepsilon_{cc}]`}</Tex>。規格書兩處都寫成 <Tex>{'E[x\\,u]'}</Tex>，但它們不是同一個量。
      </p>
      <p className="small">
        <Erratum id="E13" note="K = K_qC = −∂E[G]/∂w；規格 §11.4 的 S = ∂E[G]/∂w" />
        斜率的正負號：規格書 §11.4 把 GMAC 斜率寫成 <Tex>{String.raw`S_\mathrm{GMAC}=\partial E[G]/\partial w`}</Tex>（正確極性時為<strong>負</strong>，Ch04／Ch08 與 Sign-off
        頁沿用這個量測定義）。本章為了讓「越大越好」的直覺成立，用 <Tex>{String.raw`S\equiv-\partial E[G]/\partial w=K_qC`}</Tex>，它就是全站的{' '}
        <Tex>{'K'}</Tex>（勘誤 E13）：<Tex>{String.raw`S=K=-S_\mathrm{GMAC}`}</Tex>，<Tex>{'S>0'}</Tex> 才有恢復力。
      </p>
      <ModeDetails title={m('推導：$w^*=a+B/C$ 與它的敏感度')}>
        <StepDerivation
          steps={[
            { tex: String.raw`e_\mathrm{PD}[n]=(a-w)\,(h*x)[n]+\beta[n]+v[n]`, why: m('gain 誤差造成的 timing error 經過 PLL 誤差路徑 $h$ 才到 PD；$\\beta$ 是到達 PD 的其他確定性誤差。') },
            { tex: String.raw`E[q\,x]\approx K_q\big((a-w)\,E[x\,(h*x)]+E[x\,\beta]\big)`, why: 'comparator 線性化（F-11.3），再用期望值的線性。' },
            { tex: String.raw`=K_q\big((a-w)\,C+B\big)`, why: m('記 $C=E[x\\,(h*x)]$、$B=E[x\\beta]$（靜態時 $B$ 就是 F-11.4 的分子）。') },
            { tex: String.raw`w^*=a+\frac{B}{C}`, why: m('令平均 GMAC 為 0。$h=1$ 時 $C=E[x^2]$，回到 F-11.4。') },
            { tex: String.raw`S\equiv-\frac{\partial E[G]}{\partial w}=K_q\,C`, why: m('本章的斜率定義（符號表）：$S>0$ ⇔ $C>0$ ⇔ 固定點是吸引的；$C\\le0$ 時是 repelling（極性錯誤，Ch06）。') },
            { tex: String.raw`\frac{\partial w^*}{\partial B}=\frac1C,\qquad\frac{\partial w^*}{\partial C}=-\frac{B}{C^2}`, why: m('對 $B$、$C$ 微分：$C$ 越小，同樣的干擾造成越大的 bias，而且對 $C$ 的變化以 $1/C^2$ 敏感。') },
          ]}
        />
      </ModeDetails>
      <TexBlock id="F-11.14">{F.nearInteger}</TexBlock>
      <TexBlock id="F-11.15">{F.sensitivity}</TexBlock>
      <div className="table-wrap">
        <table className="ch11-table">
          <thead>
            <tr>
              <th>
                <Tex>{'C'}</Tex>（<Tex>{'B=0.01'}</Tex>）
              </th>
              <th>
                <Tex>{'w^*-a=B/C'}</Tex>
              </th>
              <th>
                <Tex>{'\\partial w^*/\\partial C'}</Tex>
              </th>
              <th>行為</th>
            </tr>
          </thead>
          <tbody>
            {sens.map((r) => (
              <tr key={r.C}>
                <td className="num">{r.C}</td>
                <td className="num">{num(r.bias, 4)}</td>
                <td className="num">{num(r.dwdC, 4)}</td>
                <td>{r.C > 0 ? (r.C >= 0.5 ? '正常' : '收斂慢、bias 放大') : m('repelling：$w$ 遠離 $a+B/C$（發散）')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CodeBlock
        source={biasSrc}
        region="nearIntegerSensitivity"
        path="src/simulation/models/bias.ts"
        title={String.raw`nearIntegerSensitivity：$B/C$、$-B/C^2$ 與 $S=K_qC$（上表與下面的手算題共用）`}
      />
      <Hand id="HC-11.7">
        {m('把 §11.3 的 $\\kappa$ 與這一節的 $C$ 串起來：同一個直接耦合的干擾，靜態時 bias 是 $\\kappa_d$，$C$ 變小後是多少？（預設是上表 $C=0.01$ 那一列。）')}
      </Hand>
      <Prereq title={String.raw`回顧 Ch06：頻率響應、為什麼只有實部 $\mathrm{Re}\,H$ 進入 $C$、Parseval 定理`}>
        <p>
          {m(
            '$(h*x)[n]=\\sum_{k\\ge0}h[k]\\,x[n-k]$ 叫做卷積（convolution）：現在的輸出是過去輸入的加權和，$h[k]$ 是濾波器（這裡是主 PLL 的誤差路徑 $H_\\mathrm{PD}$）對「$k$ 個 sample 前」的輸入給的權重。$\\Omega$ 是離散時間頻率（rad/sample，$0\\le\\Omega\\le\\pi$）。線性濾波器 $h$ 對弦波的作用只有兩件事：振幅乘 $|H(e^{j\\Omega})|$、相位加 $\\theta=\\angle H(e^{j\\Omega})$。',
          )}
        </p>
        <StepDerivation
          steps={[
            { tex: String.raw`x[n]=A\cos\Omega n\;\Rightarrow\;u[n]=(h*x)[n]=A|H|\cos(\Omega n+\theta)`, why: '弦波進、同頻率弦波出（穩態）。' },
            { tex: String.raw`x\,u=A^2|H|\cos\Omega n\cos(\Omega n+\theta)=\tfrac{A^2|H|}{2}\big[\cos\theta+\cos(2\Omega n+\theta)\big]`, why: m('積化和差：$\\cos\\alpha\\cos\\beta=\\tfrac12[\\cos(\\alpha-\\beta)+\\cos(\\alpha+\\beta)]$。') },
            { tex: String.raw`E[x\,u]=\tfrac{A^2}{2}|H|\cos\theta=\tfrac{A^2}{2}\,\mathrm{Re}\,H(e^{j\Omega})`, why: m('對 $n$ 平均時 $\\cos(2\\Omega n+\\theta)$ 的平均為 0；$|H|\\cos\\theta$ 就是 $H$ 的實部。') },
            { tex: String.raw`x\text{ 週期 }P:\;x[n]=\sum_{k}X_ke^{j2\pi kn/P}\;\Rightarrow\;C=E[x\,u]=\sum_k|X_k|^2\,\mathrm{Re}\,H(e^{j2\pi k/P})`, why: m('週期序列是諧波的和（DFT）；不同諧波的乘積平均為 0，所以 $C$ 是每條諧波「功率 $\\times\\ \\mathrm{Re}\\,H$」的總和（Parseval）。') },
          ]}
        />
      </Prereq>
      <p>
        為什麼 FCW 接近整數會讓 <Tex>{'C\\to0'}</Tex>？first-order DSM 的 residue 是基頻 <Tex>{String.raw`\Omega_1=2\pi\cdot\mathrm{frac}`}</Tex>（rad/sample）的 sawtooth，
        諧波功率約 <Tex>{String.raw`\propto1/k^2`}</Tex>。type-II PLL 的 <Tex>{String.raw`H_\mathrm{PD}=1/(1+L)`}</Tex> 在低頻是 high-pass（<Tex>{String.raw`|H_\mathrm{PD}|\propto\Omega^2`}</Tex>）。
        更關鍵的是<strong>相位</strong>：只有 <Tex>{String.raw`\mathrm{Re}\,H_\mathrm{PD}`}</Tex> 會進入 <Tex>{'C'}</Tex>，而在迴路頻寬內
      </p>
      <StepDerivation
        steps={[
          { tex: String.raw`L\approx\frac{\Omega_n^2+j2\zeta\Omega_n\Omega}{(j\Omega)^2}=-\frac{\Omega_n^2}{\Omega^2}-j\frac{2\zeta\Omega_n}{\Omega},\qquad \Omega_n\equiv\omega_nT_s`, why: m('type-II（雙積分）開迴路在低頻（$\\Omega\\ll1$）的近似；$\\Omega$ 與 $\\Omega_n$ 都以 rad/sample 為單位，$(j\\Omega)^2=-\\Omega^2$。') },
          { tex: String.raw`\mathrm{Re}\,H_\mathrm{PD}=\mathrm{Re}\frac{1}{1+L}=\frac{\mathrm{Re}(1+L)}{|1+L|^2}=\frac{1-\Omega_n^2/\Omega^2}{|1+L|^2}`, why: m('$\\mathrm{Re}(1/z)=\\mathrm{Re}(z)/|z|^2$。') },
          { tex: String.raw`\Omega<\Omega_n\;\Rightarrow\;\mathrm{Re}\,H_\mathrm{PD}<0`, why: m('分子變負：頻寬內 PD 看到的 gain 誤差相位接近 $180^\\circ$，那些諧波對 $C$ 的貢獻是負的。') },
          { tex: String.raw`C=\underbrace{\sum_{\Omega_k<\Omega_n}|X_k|^2\mathrm{Re}\,H}_{<0}+\underbrace{\sum_{\Omega_k\ge\Omega_n}|X_k|^2\mathrm{Re}\,H}_{>0}`, why: m('Parseval（週期穩態）：$C$ 是各諧波功率乘上 $\\mathrm{Re}\\,H$ 的總和。frac 很小時兩個和都約 $\\propto\\mathrm{frac}$，幾乎抵銷，淨值只剩 $\\propto\\mathrm{frac}^2$。') },
        ]}
      />
      <p className="small muted">
        <ClaimTag kind="approx" /> 上面用低頻近似（<Tex>{'\\Omega\\ll1'}</Tex>，不含 loop delay）說明正負號；實際的 DT 迴路由下方實驗以真實的{' '}
        <Tex>{String.raw`H_\mathrm{PD}(z)`}</Tex> 數值計算（<Erratum id="E44" note="DT 迴路不可直接代 CT 的 H_PD(s)" />不能把 <Tex>{'\\Omega'}</Tex> 直接代進連續時間的 <Tex>{String.raw`H_\mathrm{PD}(s)`}</Tex>），並分開畫出{' '}
        <Tex>{String.raw`\Omega_k<\Omega_n`}</Tex> 的負貢獻。
      </p>
      <p>
        同時，若有干擾直接耦合到 PD 而不經過 <Tex>{String.raw`H_\mathrm{PD}`}</Tex>，<Tex>{'B'}</Tex> 並不會跟著變小，於是 bias <Tex>{'B/C'}</Tex> 爆增。下面用真實的 DSM 序列與 DPLL
        以兩種獨立算法計算 <Tex>{'C'}</Tex>（並把頻寬內的負貢獻單獨畫出來）：
      </p>
      <NearIntegerExperiment />
      <CodeBlock
        source={biasSrc}
        region="nearIntegerC"
        path="src/simulation/models/bias.ts"
        title="nearIntegerC：同一個 $C$ 的時域與頻域算法（互為交叉比對）"
      />
      <Callout kind="info" title="Near-grid 不能只用固定 ppm 概括（規格 §11.4）">
        <ol>
          <li>
            有效 GMAC 敏感度 / 極性：<Tex>{String.raw`S=-\partial E[G]/\partial w\approx K_qC`}</Tex> 的大小與正負號（<Tex>{'S\\le0'}</Tex> ⇒ 極性錯誤）。
          </li>
          <li>
            PE 的最小 eigenvalue（Ch09）：多參數時 <Tex>{'C'}</Tex> 變成矩陣 <Tex>{'\\mathbf C'}</Tex>，看 <Tex>{String.raw`\lambda_\mathrm{min}`}</Tex>。
          </li>
          <li>
            Gain bias、calibration noise（固定 <Tex>{'\\mu'}</Tex> 時 <Tex>{String.raw`\sigma_w\propto1/\sqrt S`}</Tex>，Ch12）、收斂時間（<Tex>{String.raw`\propto1/(\mu S)`}</Tex> blocks）。
          </li>
          <li>Fractional spur / output jitter（Ch12、Ch13）。</li>
        </ol>
        <p>
          <strong>建議的量測流程</strong>：FCW sweep → 每個 FCW freeze gain → 分別在 <Tex>{'w\\pm\\Delta'}</Tex> 量 GMAC 平均 <Tex>{'G_\\pm'}</Tex> → 規格書的{' '}
          <Tex>{String.raw`\hat S_\mathrm{GMAC}=\frac{G_+-G_-}{2\Delta}`}</Tex>，本章的 <Tex>{String.raw`\hat S=-\hat S_\mathrm{GMAC}=\frac{G_--G_+}{2\Delta}`}</Tex>，附信賴區間；<Tex>{'\\hat S\\le0'}</Tex> 的 FCW
          標成極性錯誤，<Tex>{'\\hat S'}</Tex> 為正但很小的標成「bias 放大」。注意 <Tex>{'\\Delta'}</Tex> 不能太大：comparator 的 erf 非線性會讓割線斜率小於切線斜率。最後一定要用真實閉迴路測試確認。
          <ClaimTag kind="research" /> 極性翻轉的完整例子見 <a href="#/ch/06">Ch06</a> 與 <a href="#/case/sspll">SSPLL GOS / PHOS 案例</a>。
        </p>
        <p>
          §11.B 的 Lab 已經照這個流程做一次（靜態誤差路徑）：每次 Monte Carlo 都會把 gain 凍結在 <Tex>{'w^*\\pm\\Delta'}</Tex> 各量一次平均 GMAC，指標表的「
          <Tex>{'\\hat S'}</Tex>（MC：凍結 gain）」列出斜率、95% 信賴區間，以及同一個 <Tex>{'\\Delta'}</Tex> 的 mean-field 割線斜率與切線斜率。凍結量測的程式碼：
        </p>
        <CodeBlock source={biasSrc} region="frozenGmac" path="src/simulation/models/bias.ts" title="frozenGmac：凍結 gain 的平均 GMAC（batch-means 信賴區間）" />
      </Callout>
    </Section>
  )
}
