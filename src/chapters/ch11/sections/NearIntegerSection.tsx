import { useEffect, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import { Callout, ClaimTag, CodeBlock, ExperimentShell, ParamControl, Plot, Prereq, Section, StepDerivation, Tex, TexBlock, useDebouncedValue, useThemeTokens, type CheckEntry, type MetricRow, ChRef, ChapterErratum } from '@/components'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import biasSrc from '@/simulation/models/bias.ts?raw'
import { LIN_RATIO_LIMIT, LIN_RESIDUAL_LIMIT, nearIntegerSensitivity, type NearIntegerParams, type NearIntegerResult } from '@/simulation/models/bias'
import { F } from '../formulas'
import { ModeDetails, gappedSeries, num, m, positiveOrGap, texNum } from '../common'
import { Fig, FigRef } from '../Fig'
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
  xaxis: { title: { text: String.raw`FCW $\mathrm{frac}$（越小越接近整數）` } },
  yaxis: { title: { text: '$C$' }, type: 'log' },
  yaxis2: { title: { text: String.raw`線性候選 $|B/C|$（t.u.）` }, overlaying: 'y', side: 'right', type: 'log', showgrid: false },
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
    // 兩個 y 軸都是 log 軸，畫不出 ≤ 0 的值：改成 null 讓線在那裡斷開（直接給負值時 Plotly 會把線拉到圖的最下面，變成一根一根的直線）
    return [
      { x: res.frac, y: res.Cfreq.map(positiveOrGap), mode: 'lines', name: String.raw`$C$（頻域：$\sum_k |X_k|^2 \cdot \mathrm{Re}\,H_\mathrm{PD}$）`, line: { color: tokens.series[0], width: 2 } },
      { x: res.frac, y: res.C.map(positiveOrGap), mode: 'markers', name: String.raw`$C$（時域：序列通過 $H_\mathrm{PD}$）`, marker: { color: tokens.series[0], size: 6, symbol: 'circle-open' } },
      {
        x: res.frac,
        y: res.CinBand.map((v) => positiveOrGap(-v)),
        mode: 'lines',
        name: String.raw`$-C_\mathrm{in\text{-}band}$（頻寬內諧波，$\mathrm{Re}\,H_\mathrm{PD} \lt 0$）`,
        line: { color: tokens.series[3], dash: 'dot' },
      },
      // 右軸：線性候選 |B/C|，依「代回完整 erf 平均」的檢查結果分成兩條（通過 = 可當作 |w* − a|；未通過 = 只是線性外推）
      ...[true, false].flatMap((keep): Data[] => {
        const idx = res.frac.map((_, i) => i).filter((i) => res.linValid[i] === keep && Number.isFinite(res.bias[i]))
        if (idx.length === 0) return []
        // 同一類的點不相鄰時（中間夾著另一類的 FCW）在那裡斷開，線才不會跨過另一類的點
        const line = gappedSeries(idx, res.frac, res.bias.map((v) => Math.abs(v)))
        return [
          {
            x: line.x,
            y: line.y,
            mode: 'lines+markers',
            name: keep ? String.raw`$|w^*-a|\approx|B/C|$（通過代回檢查，右軸）` : String.raw`$|B/C|$：線性外推，未通過檢查（右軸）`,
            yaxis: 'y2',
            line: keep ? { color: tokens.series[2] } : { color: tokens.series[2], dash: 'dash' },
            marker: keep ? { size: 4 } : { symbol: 'circle-open', size: 6 },
          },
        ]
      }),
    ]
  }, [res, tokens])

  const metrics: MetricRow[] = []
  const warnings: string[] = []
  if (res && res.frac.length) {
    const i0 = 0
    const iLast = res.frac.length - 1
    const iv = res.linValid.indexOf(true) // 通過代回檢查的最小 frac（沒有時 −1）
    const nOk = res.linValid.filter(Boolean).length
    const fin = (v: number) => (Number.isFinite(v) ? v : null) // 非有限值在指標表顯示「—」
    metrics.push(
      { name: `$C$（frac $=${texNum(res.frac[i0], 3)}$，頻域）`, value: res.Cfreq[i0], formulaId: 'F-11.14', analytic: res.C[i0], tolerance: 1e-6, toleranceMode: 'rel', note: 'analytic 欄 = 時域值' },
      { name: `其中頻寬內諧波的貢獻（frac $=${texNum(res.frac[i0], 3)}$）`, value: res.CinBand[i0], note: String.raw`$\mathrm{Re}\,H_\mathrm{PD}<0\Rightarrow$ 負；與頻寬外的正貢獻幾乎抵銷` },
      {
        name: `線性候選 $B/C$（frac $=${texNum(res.frac[i0], 3)}$）`,
        value: fin(res.bias[i0]),
        unit: 't.u.',
        claim: 'approx',
        formulaId: 'F-11.14',
        note: res.linValid[i0]
          ? '通過代回檢查：可當作 $w^*-a$'
          : res.Cfreq[i0] > 0
            ? '未通過代回檢查：只是線性外推，不能當作 $w^*-a$（看下兩列）'
            : String.raw`$C\le0$：$a+B/C$ 是 repelling 的點，不是固定點`,
      },
      {
        name: String.raw`$\max_n|e_\mathrm{det}|/\sigma_v$（同一點，代入 $w=a+B/C$）`,
        value: fin(res.linRatio[i0]),
        formulaId: 'F-11.3',
        note: String.raw`門檻 $\le${LIN_RATIO_LIMIT}$（勘誤 E01）`,
      },
      {
        name: String.raw`殘餘比 $\gamma_\mathrm{lin}$（同一點）`,
        value: fin(res.linResidual[i0]),
        analytic: 0,
        tolerance: LIN_RESIDUAL_LIMIT,
        toleranceMode: 'abs',
        note: String.raw`固定點的定義是 $\gamma_\mathrm{lin}=0$；門檻 $|\gamma_\mathrm{lin}|\le${LIN_RESIDUAL_LIMIT}$`,
      },
      { name: '通過檢查的最小 frac', value: iv >= 0 ? res.frac[iv] : null, note: `${nOk}／${res.frac.length} 個 FCW 通過` },
      { name: String.raw`該處 $w^*-a\approx B/C$`, value: iv >= 0 ? res.bias[iv] : null, unit: 't.u.', claim: 'approx', formulaId: 'F-11.14' },
      { name: `$C$（frac $=${texNum(res.frac[iLast], 3)}$）`, value: res.Cfreq[iLast] },
      {
        name: res.linValid[iLast] ? String.raw`$w^*-a\approx B/C$（frac $=${texNum(res.frac[iLast], 3)}$）` : `線性候選 $B/C$（frac $=${texNum(res.frac[iLast], 3)}$，未通過檢查）`,
        value: fin(res.bias[iLast]),
        unit: 't.u.',
        claim: 'approx',
      },
      {
        name: String.raw`GMAC 斜率 $S=K_q\,C$（frac 最小處）`,
        value: res.slope[i0],
        unit: String.raw`$\mathrm{t.u.}^{-1}$`,
        formulaId: 'F-11.15',
        note: String.raw`小訊號斜率（$|e_\mathrm{det}|\ll\sigma_v$）；越小 $\Rightarrow$ 收斂越慢、對 bias 越敏感`,
      },
      { name: String.raw`低 frac 冪次 $d\ln C/d\ln\mathrm{frac}$（最小 6 點擬合）`, value: res.lowFracExponent, note: String.raw`$\mathrm{frac}\ll\omega_nT_s/2\pi$ 時 $\to2$` },
      { name: '時域 vs 頻域最大相對差', value: res.maxRelDiff, note: `時域略過 ${res.skip} 個暫態 sample，取整數個週期` },
    )
    const neg = res.frac.filter((_, i) => res.Cfreq[i] <= 0)
    if (neg.length)
      warnings.push(
        String.raw`$C\le0$（frac $=${neg.map((f) => texNum(f, 3)).join(',\\ ')}$）：更新極性錯誤，$w^*=a+B/C$ 是 repelling 的點，正 learning rate 會使平均誤差發散（見 Ch06 與 SSPLL 案例）。`,
      )
    // C > 0 但線性候選沒有通過代回檢查的 FCW：B/C 只是線性外推
    const bad = res.frac.map((_, i) => i).filter((i) => res.Cfreq[i] > 0 && !res.linValid[i])
    if (bad.length) {
      const fMax = Math.max(...bad.map((i) => res.frac[i]))
      const maxRatio = Math.max(...bad.map((i) => res.linRatio[i]))
      const maxGamma = Math.max(...bad.map((i) => Math.abs(res.linResidual[i])))
      warnings.push(
        String.raw`線性化條件不成立：${res.frac.length} 個 FCW 中有 ${bad.length} 個未通過（其中 frac 最大的是 $${texNum(fMax, 3)}$）。把 $w=a+B/C$ 代回完整的 erf 平均，$\max|e_\mathrm{det}|/\sigma_v$ 最大 $${texNum(maxRatio, 3)}$（門檻 ${LIN_RATIO_LIMIT}）、殘餘比 $|\gamma_\mathrm{lin}|$ 最大 $${texNum(maxGamma, 3)}$（門檻 ${LIN_RESIDUAL_LIMIT}）。這些 FCW 的 $B/C$ 只是線性外推，不能當作 Sign-LMS 的固定點（F-11.3；Ch06 F-06.19）。把 $\sigma_v$ 加大或把 $|\kappa_d|$ 縮小可以回到線性範圍。`,
      )
    }
  }
  if (res) warnings.push(...res.warnings)
  if (err) warnings.push(`計算失敗：${err}`)

  const freqCheck: CheckEntry = res && res.frac.length
    ? {
        status: res.maxRelDiff < 1e-6 ? 'ok' : 'mismatch',
        note: String.raw`只驗證 $C$：頻域（週期穩態 Parseval）vs 時域（濾波 + 整數週期平均）最大相對差 ${num(res.maxRelDiff, 2)}。不檢查 $a+B/C$ 是不是固定點（看指標表的 $\gamma_\mathrm{lin}$）`,
      }
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
          <Tex>{String.raw`H_\mathrm{PD}`}</Tex>），所以 <Tex>{String.raw`B=\kappa_dE[x^2]=\kappa_d`}</Tex>。每個 FCW 再把線性候選 <Tex>{'w=a+B/C'}</Tex>{' '}
          代回完整的 comparator 平均 <Tex>{String.raw`E[x\,\operatorname{erf}(e_\mathrm{det}/(\sqrt2\sigma_v))]`}</Tex>，檢查它是不是真的固定點。
        </>
      }
      assumptions={[
        String.raw`$K_q$ 線性化只在 $\max_n|e_\mathrm{det}|/\sigma_v\le${LIN_RATIO_LIMIT}$ 且 $|\gamma_\mathrm{lin}|\le${LIN_RESIDUAL_LIMIT}$ 的 FCW 成立（逐點檢查，圖上以實心／空心點區分）；$B$ 固定（直接耦合的 code-correlated DJ）——示意用的干擾模型`,
        String.raw`平均模型：$w$ 在 $H_\mathrm{PD}$ 的記憶長度內視為常數（時間尺度分離，同 Ch06 F-06.19）`,
        String.raw`主 PLL：designDtLoop 的 DPLL 差分方程（勘誤 E44 的 DT 模型），$H_\mathrm{PD}=1/(1+L)$`,
        String.raw`first-order DSM、16-bit 累加器：residue 週期 $P=2^{16}/\gcd(K,2^{16})$；時域視窗 = 整數個 $P$`,
      ]}
      params={{ ...p }}
      units={{ kappaDirect: 't.u.', sigmaV: 't.u.', wnTs: 'rad/sample', loopDelay: 'samples', zeta: '—' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: freqCheck,
        monteCarlo: {
          status: 'not-implemented',
          note: String.raw`$C$ 是確定性序列的時間平均，不需要 Monte Carlo；含 comparator 雜訊（$\sigma_v$）的 Sign-LMS 閉迴路沒有在這個實驗模擬（$B=0$ 的 basin 實驗見 Ch06 §7 的 Polarity Explorer）`,
        },
        fixedPoint: { status: 'not-implemented', note: '定點（bit-true）運算版本不在本實驗範圍；這一欄不是「$w^*$ 是不是固定點」的檢查' },
      }}
      exportData={(): Record<string, ArrayLike<number>> =>
        res
          ? {
              frac: res.frac,
              period: res.period,
              C_time: res.C,
              C_freq: res.Cfreq,
              C_in_band: res.CinBand,
              // 線性候選 B/C（全部 FCW）：只有 lin_valid = 1 的列可以當作 w* − a，其餘是線性外推（審查 R01）
              B_over_C_linear: res.bias,
              slope: res.slope,
              uMax: res.uMax,
              lin_ratio: res.linRatio,
              gmac_at_linear: res.gAtLinear,
              gamma_lin: res.linResidual,
              lin_valid: res.linValid.map((v) => (v ? 1 : 0)),
            }
          : {}
      }
      actions={{ onReset: () => setP(DEFAULT), running }}
      controls={
        <>
          <ParamControl label={String.raw`$\omega_n T_s$（主 PLL 頻寬）`} value={p.wnTs} onChange={set('wnTs')} min={0.002} max={0.3} log unit="rad/sample" reg="Behavioral：主 PLL omega_n/f_s" />
          <ParamControl label={String.raw`$\zeta$（阻尼）`} value={p.zeta} onChange={set('zeta')} min={0.3} max={2} step={0.01} unit="—" reg="Behavioral：主 PLL damping" />
          <ParamControl label="loop delay" value={p.loopDelay} onChange={set('loopDelay')} min={0} max={4} integer clampOnBlur unit="samples" reg="Behavioral：PLL loop latency" />
          <ParamControl label={String.raw`$\kappa_d$（直接耦合係數）`} value={p.kappaDirect} onChange={set('kappaDirect')} min={-0.2} max={0.2} step={0.001} unit="t.u." reg="Behavioral：PD 端 code-correlated 耦合" />
          <ParamControl label="$\sigma_v$" value={p.sigmaV} onChange={set('sigmaV')} min={0.01} max={10} log unit="t.u." reg="Behavioral：comparator noise（給 K_q）" />
        </>
      }
    >
      <Plot
        title="$C$ 與線性候選 $|B/C|$ 隨 FCW 小數部分變化（log–log）"
        data={data}
        layout={NI_LAYOUT}
        height={320}
        xLog
        csvName="bias-near-integer"
        caption={String.raw`實線 = 頻域、圓圈 = 時域（兩者應重合）；點線 = 頻寬內諧波的負貢獻大小。右軸：實心點是通過代回檢查的 FCW，$|B/C|$ 就是 $|w^*-a|$；空心點＋虛線是線性外推（代回完整的 erf 平均後 GMAC 不為 0），不能當作固定點。$\mathrm{frac}\to0$ 時 $C$ 約以 $\mathrm{frac}^2$ 下降（冪次見指標），線性候選 $B/C$ 約以 $1/\mathrm{frac}^2$ 上升（離開線性範圍之後，它只是外推值，不再是 $w^*-a$）。${
          res && res.Cfreq.some((c) => c <= 0) ? String.raw`$C\le0$ 的 FCW 在 log 軸上畫不出來，$C$ 的線在那裡斷開（是哪幾個 FCW，見警告）。` : ''
        }`}
      />
      {res && res.frac.length > 0 && (
        <p className="small muted">
          {m(
            `你會發現：frac $=${texNum(res.frac[0], 3)}$ 時，頻寬內諧波貢獻 $${texNum(res.CinBand[0], 4)}$、頻寬外 $${texNum(res.Cfreq[0] - res.CinBand[0], 4)}$，兩者幾乎抵銷，只剩 $C=${texNum(res.Cfreq[0], 4)}$。`,
          )}
          {res.Cfreq[0] > 0 &&
            !res.linValid[0] &&
            m(
              String.raw`但把 $a+B/C$ 代回去，comparator 要承受 $${texNum(res.linRatio[0], 3)}\,\sigma_v$ 的確定性殘差，${res.linRatio[0] > 1 ? '早已飽和' : '已經離開線性區'}（$\gamma_\mathrm{lin}=${texNum(res.linResidual[0], 3)}$）：這個 FCW 的 $B/C=${texNum(res.bias[0], 4)}$ 只是線性外推。`,
            )}
          {res.linValid.includes(true) &&
            !res.linValid[0] &&
            m(
              String.raw`通過檢查的最小 frac 是 $${texNum(res.frac[res.linValid.indexOf(true)], 3)}$，那裡 $w^*-a\approx${texNum(res.bias[res.linValid.indexOf(true)], 3)}$。`,
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
      <p>
        到目前為止都假設 gain 誤差造成的 timing error 原封不動到達 comparator。實際上這個殘餘誤差是從 PD 的 reference 輸入端進來的（DTC 在 reference
        端），主迴路會把其中低頻的部分追掉，所以出現在 PD 輸出的，是它經過主 PLL 誤差路徑之後的結果（正負號不變）。這條路徑的轉移函數記作{' '}
        <Tex>{String.raw`H_\mathrm{PD}(z)`}</Tex>、脈衝響應記作 <Tex>{'h'}</Tex>，「經過它」就是做卷積 <Tex>{'(h*x)[n]'}</Tex>。先看{' '}
        <FigRef id="near-integer-path" /> 上面的框：code 乘上 <Tex>{'(a-w)'}</Tex> 後經過藍色的 <Tex>{String.raw`H_\mathrm{PD}`}</Tex>，變成{' '}
        <Tex>{'(a-w)\\,(h*x)[n]'}</Tex>；紅色的 <Tex>{'\\beta[n]'}</Tex>（直接到達 PD 的其他確定性誤差，例如 §11.3 的耦合）不經過 <Tex>{String.raw`H_\mathrm{PD}`}</Tex>
        。再看下面的框：comparator 取的是 PD 的輸出 <Tex>{String.raw`e_\mathrm{PD}[n]`}</Tex>（送進 loop filter 的同一個訊號），GMAC 把它的正負號和同一個{' '}
        <Tex>{'x[n]'}</Tex> 做相關 —— 經過 <Tex>{String.raw`H_\mathrm{PD}`}</Tex> 的那條路給出{' '}
        <Tex>{'(a-w)\\,C'}</Tex>，沒經過的那條路給出 <Tex>{'B'}</Tex>。圖上的 <Tex>{'C'}</Tex>、<Tex>{'B'}</Tex> 就是下面公式 F-11.14 的{' '}
        <Tex>{String.raw`C=E[x\,(h*x)]`}</Tex> 與 <Tex>{String.raw`B=E[x\,\beta]`}</Tex>。
      </p>
      <Fig id="near-integer-path" />
      <p className="small">
        「直接到 PD、不經過 <Tex>{String.raw`H_\mathrm{PD}`}</Tex>」什麼時候成立：主迴路追得到的，只有進到 loop filter 的誤差。圖上的{' '}
        <Tex>{'\\beta[n]'}</Tex> 是示意用的干擾模型 —— 它和雜訊 <Tex>{'v[n]'}</Tex> 一樣算在 comparator 看到的{' '}
        <Tex>{String.raw`e_\mathrm{PD}`}</Tex> 裡，但主迴路沒有修它（例如只耦合到獨立 comparator 的 threshold，<FigRef id="coupling-node" />{' '}
        的紅色出口），所以 <Tex>{'B'}</Tex> 不會跟著 <Tex>{'C'}</Tex> 變小。反過來，如果干擾和 DTC
        的殘餘誤差一樣是從 PD 的輸入端進來的，主迴路同樣會把它的低頻追掉：它要算進 <Tex>{String.raw`H_\mathrm{PD}`}</Tex> 那條路，固定點是{' '}
        <Tex>{'w^*=a+\\kappa'}</Tex>（§11.3），不會被 <Tex>{'1/C'}</Tex> 放大。
      </p>
      <p className="small">
        <ChapterErratum id="E12" note={String.raw`此處 $C=E[x\,(h*x)]$ 同 §6；$B$ 為干擾 bias 項`} />
        注意符號：這裡的 <Tex>{'C'}</Tex> 是 <ChRef ch="06">Ch06</ChRef> 的有效相關 <Tex>{String.raw`C=E[x\,(h*x)]`}</Tex>（gain 誤差經過主 PLL 誤差路徑 <Tex>{'h'}</Tex> 才出現在 PD 的輸出），<Tex>{'B'}</Tex> 是 F-11.4
        的分子 <Tex>{String.raw`B_\mathrm{bias}=bE[x]+E[xd]+E[x\varepsilon_{cc}]`}</Tex>。規格書兩處都寫成 <Tex>{'E[x\\,u]'}</Tex>，但它們不是同一個量。
      </p>
      <p className="small">
        <ChapterErratum id="E13" note={String.raw`$K=K_qC=-\partial E[G]/\partial w$；規格 §11.4 的 $S=\partial E[G]/\partial w$`} />
        斜率的正負號：規格書 §11.4 把 GMAC 斜率寫成 <Tex>{String.raw`S_\mathrm{GMAC}=\partial E[G]/\partial w`}</Tex>（正確極性時為<strong>負</strong>，<ChRef ch="04">Ch04</ChRef>／<ChRef ch="08">Ch08</ChRef> 與 Sign-off
        頁沿用這個量測定義）。本章為了讓「越大越好」的直覺成立，用 <Tex>{String.raw`S\equiv-\partial E[G]/\partial w=K_qC`}</Tex>，它就是全站的{' '}
        <Tex>{'K'}</Tex>（勘誤 E13）：<Tex>{String.raw`S=K=-S_\mathrm{GMAC}`}</Tex>，<Tex>{'S>0'}</Tex> 才有恢復力。
      </p>
      <ModeDetails title={m('推導：$w^*=a+B/C$ 與它的敏感度')}>
        <StepDerivation
          steps={[
            { tex: String.raw`e_\mathrm{PD}[n]=(a-w)\,(h*x)[n]+\beta[n]+v[n]`, why: m('gain 誤差造成的 timing error 從 PD 的 reference 輸入端注入，經過 PLL 誤差路徑 $h$ 才出現在 PD 的輸出（正號）；$\\beta$ 是到達 PD 的其他確定性誤差。') },
            { tex: String.raw`E[q\,x]\approx K_q\big((a-w)\,E[x\,(h*x)]+E[x\,\beta]\big)`, why: m('comparator 線性化（F-11.3，§11.A），再用期望值的線性。條件也一樣：$w^*$ 處每個 sample 的整個確定性殘差 $(a-w^*)(h*x)[n]+\\beta[n]$ 都要遠小於 $\\sigma_v$（見下面的說明框）。') },
            { tex: String.raw`=K_q\big((a-w)\,C+B\big)`, why: m('記 $C=E[x\\,(h*x)]$、$B=E[x\\beta]$（靜態時 $B$ 就是 F-11.4 的分子）。') },
            { tex: String.raw`w^*=a+\frac{B}{C}`, why: m('令平均 GMAC 為 0。$h=1$ 時 $C=E[x^2]$，回到 F-11.4。') },
            { tex: String.raw`S\equiv-\frac{\partial E[G]}{\partial w}=K_q\,C`, why: m('本章的斜率定義（符號表）：$S>0$ ⇔ $C>0$ ⇔ 固定點在小訊號範圍內（$|e_\\mathrm{det}|\\ll\\sigma_v$）是吸引的；$C\\le0$ 時是 repelling（極性錯誤，Ch06）。誤差大到 comparator 飽和時，$C>0$ 也可能把 $w$ 往外推（Ch06 F-06.19 的 basin 半徑 $\\delta_c$）。') },
            { tex: String.raw`\frac{\partial w^*}{\partial B}=\frac1C,\qquad\frac{\partial w^*}{\partial C}=-\frac{B}{C^2}`, why: m('對 $B$、$C$ 微分：$C$ 越小，同樣的干擾造成越大的 bias，而且對 $C$ 的變化以 $1/C^2$ 敏感。') },
          ]}
        />
      </ModeDetails>
      <TexBlock id="F-11.14" label="Near-integer 固定點（MSE：精確；Sign：一階近似，條件見下）">
        {F.nearInteger}
      </TexBlock>
      <TexBlock id="F-11.15" label={m('敏感度與小訊號斜率（$|e_\\mathrm{det}|\\ll\\sigma_v$）')}>
        {F.sensitivity}
      </TexBlock>
      <Callout kind="warn" title={m('$a+B/C$ 什麼時候才是 Sign-LMS 的固定點？')}>
        <p>
          {m('F-11.14 的推導在第二步用了 comparator 的線性化（F-11.3，§11.A），所以它繼承同一個條件：在 $w^*$ 處，每一個 sample 的')}
          <strong>整個</strong>
          {m('確定性殘差都要遠小於 $\\sigma_v$。把 $a-w^*=-B/C$ 代回誤差模型，要檢查的量是')}
        </p>
        {/* 兩行：條件那一行在手機上也要直接看得到（不能藏在橫向捲動後面） */}
        <TexBlock>{String.raw`\begin{gathered}e_\mathrm{det}[n]=-\frac{B}{C}\,(h*x)[n]+\beta[n]\\[0.5em]\frac{\max_n|e_\mathrm{det}[n]|}{\sigma_v}\le${LIN_RATIO_LIMIT}\end{gathered}`}</TexBlock>
        <p>
          {m(
            `${LIN_RATIO_LIMIT} 是本章 Lab 與綜合手算 HC-11.8 用的同一個門檻（勘誤 E01）。和靜態的情況（§11.A）相比，gain 誤差那一項由 $-(B/E[x^2])\\,x$ 變成 $-(B/C)\\,(h*x)$，它跟著 $1/C$ 一起變大：「bias 被放大」和「線性化失效」是同一件事的兩面，放大到某個程度，公式就不能再用。`,
          )}
        </p>
        <p>
          {m(
            '超出範圍時，comparator 先在 sawtooth 跳變後的尖峰上飽和，後面的小尾巴還在線性區。$C$ 本來就是「尖峰的正貢獻」和「尾巴的負貢獻」幾乎抵銷後剩下的小量；尖峰被 erf 壓扁之後，恢復力比線性模型預測的小，甚至反向。所以平均 GMAC 在 $a+B/C$ 不是 0，$w$ 不會停在那裡；超出很多時，在實際的 gain 範圍內找不到任何吸引的固定點，$w$ 會一路往外漂（',
          )}
          <a href="#/ch/06">Ch06</a>
          {m(
            ' §6.4：mean-field 特性 F-06.19 與 basin 半徑 $\\delta_c$）。這時 $a+B/C$ 只能叫做「線性外推」。MSE-LMS 的 GMAC 用多位元的 $e$，沒有 erf；在同一個平均模型（$w$ 慢變）下 F-11.14 對它是精確的。',
          )}
        </p>
        <p>{m('下面的實驗對每個 FCW 直接檢查：把 $w=a+B/C$ 代回完整的 comparator 平均（F-11.2），看還剩下多少。')}</p>
        <TexBlock>{String.raw`\begin{gathered}\gamma_\mathrm{lin}=\frac{E\big[x\,\operatorname{erf}\!\big(e_\mathrm{det}/(\sqrt2\,\sigma_v)\big)\big]}{K_q\,B}\\[0.4em]\big(e_\mathrm{det}\text{ 取 }w=a+B/C\text{ 時的值}\big)\end{gathered}`}</TexBlock>
        <p>
          {m(
            `分子是 $w=a+B/C$ 處真正的平均 GMAC（固定點的定義是它等於 0），分母 $K_qB$ 是 $w=a$ 時干擾造成的平均 GMAC（線性化值），所以 $\\gamma_\\mathrm{lin}$ 表示「代回去之後，還有幾成沒有被抵銷」。$\\max_n|e_\\mathrm{det}|/\\sigma_v\\le${LIN_RATIO_LIMIT}$ 而且 $|\\gamma_\\mathrm{lin}|\\le${LIN_RESIDUAL_LIMIT}$ 的 FCW，才把 $a+B/C$ 當作固定點（真正的零點離它約 6% 以內）；其餘的標成「線性外推」。只看第一個條件不夠：$C$ 很小時，尖峰只被壓扁一點點就足以破壞抵銷。`,
          )}{' '}
          <ClaimTag kind="approx" />
        </p>
        <ModeDetails title={m('估計：near-integer 時 $|B/C|$ 最大可以到多少？')}>
          <StepDerivation
            steps={[
              {
                tex: String.raw`\text{residue 在 }[0,1)\text{ 均勻分布}:\ \sigma_x\approx\tfrac{1}{\sqrt{12}}\;\Rightarrow\;\text{跳變高度}=1\approx\sqrt{12}\,\sigma_x=2\sqrt3\,\sigma_x`,
                why: m('first-order DSM 的 residue 是 sawtooth：兩次跳變之間是斜坡，跳變的高度是全幅。$\\sigma_x$ 是 code 的標準差；標準化後（$\\sigma_x=1$）跳變高度約 3.46。'),
              },
              {
                tex: String.raw`\max_n\big|(h*x)[n]\big|\approx h[0]\cdot2\sqrt3\,\sigma_x=2\sqrt3\,\sigma_x`,
                why: m(
                  'type-II 迴路把斜坡完全追掉（$H_\\mathrm{PD}$ 在 $z=1$ 有兩個零點），$(h*x)$ 只剩每次跳變的 step response；它的第一個 sample 就是跳變本身（$h[0]=1$），之後才衰減。前提是 $\\mathrm{frac}\\ll\\omega_nT_s/2\\pi$：下一次跳變來之前，上一次的響應已經衰減完。',
                ),
              },
              {
                tex: String.raw`\begin{aligned}\frac{|B|}{C}\cdot2\sqrt3\,\sigma_x&\lesssim${LIN_RATIO_LIMIT}\,\sigma_v\\[0.3em]\Rightarrow\;\frac{|B|}{C}&\lesssim\frac{${LIN_RATIO_LIMIT}}{2\sqrt3}\,\frac{\sigma_v}{\sigma_x}\approx0.087\,\frac{\sigma_v}{\sigma_x}\end{aligned}`,
                why: m(
                  '$C\\ll E[x^2]$ 時 $\\beta$ 相對很小，$\\max|e_\\mathrm{det}|\\approx|B/C|\\cdot\\max|h*x|$。實驗的預設值（$B=0.01$、$\\sigma_v=\\sigma_x=1$）：需要 $C\\gtrsim0.01/0.087\\approx0.115$。',
                ),
              },
              {
                tex: String.raw`\begin{aligned}\frac{E[G]}{K_q}&\approx B-(w-a)\,C+c\,(w-a)^3\;\Rightarrow\;\gamma_\mathrm{lin}\approx\frac{c\,B^2}{C^3}\\[0.4em]w^*-a&=\frac{B}{C}\,(1+s),\qquad s=\gamma_\mathrm{lin}\,(1+s)^3\end{aligned}`,
                why: m(
                  '把 erf 展開到三次項（§11.2 情境 (2) 用過的同一個展開）；$C\\ll E[x^2]$ 時 $c\\approx E[x\\,(h*x)^3]/(6\\sigma_v^2)>0$（尖峰被壓扁）。把 $w-a=B/C$ 代進 $E[G]/K_q$ 的式子、再除以 $B$，就得到 $\\gamma_\\mathrm{lin}$；第二行是令 $E[G]=0$ 的解：真正的零點離 $a$ 的距離是 $B/C$ 的 $(1+s)$ 倍。$\\gamma_\\mathrm{lin}=0.05$ 時 $s\\approx6\\%$；$\\gamma_\\mathrm{lin}>4/27\\approx0.15$ 時 $s$ 的方程沒有解，也就是附近沒有固定點。',
                ),
              },
            ]}
          />
          <p className="small muted">
            <ClaimTag kind="approx" /> {m('這四步都是量級估計；每個 FCW 是否通過，以下面實驗逐點代回完整 erf 平均的結果為準。')}
          </p>
        </ModeDetails>
      </Callout>
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
      <p className="small">
        {m(
          '表中的 $B/C$ 是線性化（F-11.3）的結果。以 near-integer 的 sawtooth、標準化的 code（$\\sigma_x=1$）、$\\sigma_v=1$ 為例，要檢查的是 $2\\sqrt3\\,|B/C|/\\sigma_v$：$C=0.1$ 那一列是 $2\\sqrt3\\times0.1\\approx0.35$（剛超過門檻 0.3），$C=0.01$ 那一列是 $2\\sqrt3\\times1\\approx3.5$（遠遠超出，只是線性外推）；$C=1$ 那一列沒有問題。',
        )}
      </p>
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
        <FigRef id="near-integer-why" /> 是這一節的因果鏈，先看圖再讀下面的推導。由上往下：FCW（frequency control word）的小數部分 frac 越小，DSM residue 的
        sawtooth 越慢，越多諧波掉進迴路頻寬內；頻寬內的諧波對 <Tex>{'C'}</Tex> 的貢獻是負的、頻寬外是正的，兩者相加幾乎抵銷（藍色方塊）。最下面一列是{' '}
        <Tex>{'C'}</Tex> 變小的三個後果：恢復斜率 <Tex>{'S=K_qC'}</Tex> 變小（收斂慢）、同樣的 <Tex>{'B'}</Tex> 被 <Tex>{'1/C'}</Tex> 放大（這是線性化的
        bias：大到超出線性範圍，<Tex>{'a+B/C'}</Tex> 就不再是固定點，見上面的說明框）、<Tex>{'C\\le0'}</Tex> 時極性反轉。圖上的 <Tex>{String.raw`\Omega_k`}</Tex> 是第 <Tex>{'k'}</Tex> 條諧波的頻率（rad/sample），
        <Tex>{String.raw`\Omega_n=\omega_nT_s`}</Tex> 是主迴路的自然頻率，<Tex>{String.raw`|X_k|^2`}</Tex> 是該諧波的功率。
      </p>
      <Fig id="near-integer-why" />
      <p>
        為什麼 FCW 接近整數會讓 <Tex>{'C\\to0'}</Tex>？first-order DSM 的 residue 是基頻 <Tex>{String.raw`\Omega_1=2\pi\cdot\mathrm{frac}`}</Tex>（rad/sample）的 sawtooth，諧波功率約 <Tex>{String.raw`\propto1/k^2`}</Tex>。type-II PLL 的 <Tex>{String.raw`H_\mathrm{PD}=1/(1+L)`}</Tex> 在低頻是 high-pass（<Tex>{String.raw`|H_\mathrm{PD}|\propto\Omega^2`}</Tex>）。更關鍵的是<strong>相位</strong>：只有 <Tex>{String.raw`\mathrm{Re}\,H_\mathrm{PD}`}</Tex> 會進入 <Tex>{'C'}</Tex>，而在迴路頻寬內
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
        <Tex>{String.raw`H_\mathrm{PD}(z)`}</Tex> 數值計算（<ChapterErratum id="E44" note={String.raw`DT 迴路不可直接代 CT 的 $H_\mathrm{PD}(s)$`} />不能把 <Tex>{'\\Omega'}</Tex> 直接代進連續時間的 <Tex>{String.raw`H_\mathrm{PD}(s)`}</Tex>），並分開畫出{' '}
        <Tex>{String.raw`\Omega_k<\Omega_n`}</Tex> 的負貢獻。
      </p>
      <p>
        同時，若有干擾直接耦合到 PD 而不經過 <Tex>{String.raw`H_\mathrm{PD}`}</Tex>，<Tex>{'B'}</Tex> 並不會跟著變小，於是線性化的 bias <Tex>{'B/C'}</Tex> 快速變大 —— 直到它大到讓線性化本身失效為止（上面的說明框）。下面用真實的 DSM 序列與 DPLL
        以兩種獨立算法計算 <Tex>{'C'}</Tex>（並把頻寬內的負貢獻單獨畫出來）。<FigRef id="near-integer-check" /> 是實驗的計算流程：先看最上面三個方塊，FCW 的小數部分 <Tex>{String.raw`\mathrm{frac}`}</Tex> 乘上 <Tex>{'2^{16}'}</Tex> 是 16-bit 累加器的整數碼{' '}
        <Tex>{'K'}</Tex>，first-order DSM 的 residue 每 <Tex>{String.raw`P=2^{16}/\gcd(K,2^{16})`}</Tex> 個 sample 重複一次；兩支都從同一個標準化的 residue{' '}
        <Tex>{'x[n]'}</Tex>（<Tex>{'E[x]=0,\\ E[x^2]=1'}</Tex>）出發。再看中間分成左右的兩支：時域那一支讓序列真的通過 <Tex>{String.raw`H_\mathrm{PD}`}</Tex>{' '}
        再取整數個週期平均，頻域那一支只取一個週期做 DFT，把 <Tex>{String.raw`|X_k|^2`}</Tex> 乘上 <Tex>{String.raw`\mathrm{Re}\,H_\mathrm{PD}`}</Tex> 相加（就是上面 Parseval 的那一行）。最後看下面的六角形：兩個{' '}
        <Tex>{'C'}</Tex> 的相對差夠小才採用，這是下面實驗「Analytic」欄的交叉檢查。
        {m(
          `採用 $C$ 之後還有第二個六角形：把線性候選 $a+B/C$ 代回完整的 erf 平均，$\\max|e_\\mathrm{det}|/\\sigma_v\\le${LIN_RATIO_LIMIT}$ 且 $|\\gamma_\\mathrm{lin}|\\le${LIN_RESIDUAL_LIMIT}$ 才當作固定點（綠色），否則標成「線性外推」（紅色）。這一步檢查的是固定點，和「Analytic」欄檢查的 $C$ 是兩件事。`,
        )}
      </p>
      <Fig id="near-integer-check" />
      <NearIntegerExperiment />
      <CodeBlock
        source={biasSrc}
        region="nearIntegerC"
        path="src/simulation/models/bias.ts"
        title="nearIntegerC：同一個 $C$ 的時域與頻域算法（互為交叉比對）"
      />
      <CodeBlock
        source={biasSrc}
        region="nearIntegerLinearCheck"
        path="src/simulation/models/bias.ts"
        title="nearIntegerLinearCheck：把 $a+B/C$ 代回完整的 erf 平均"
      />
      <Callout kind="info" title="Near-grid 不能只用固定 ppm 概括（規格 §11.4）">
        <ol>
          <li>
            有效 GMAC 敏感度 / 極性：<Tex>{String.raw`S=-\partial E[G]/\partial w\approx K_qC`}</Tex> 的大小與正負號（<Tex>{'S\\le0'}</Tex> ⇒ 極性錯誤）。
          </li>
          <li>
            PE 的最小 eigenvalue（<ChRef ch="09">Ch09</ChRef>）：多參數時 <Tex>{'C'}</Tex> 變成矩陣 <Tex>{'\\mathbf C'}</Tex>，看 <Tex>{String.raw`\lambda_\mathrm{min}`}</Tex>。
          </li>
          <li>
            Gain bias、calibration noise（固定 <Tex>{'\\mu'}</Tex> 時 <Tex>{String.raw`\sigma_w\propto1/\sqrt S`}</Tex>，<ChRef ch="12">Ch12</ChRef>）、收斂時間（<Tex>{String.raw`\propto1/(\mu S)`}</Tex> blocks）。
          </li>
          <li>Fractional spur / output jitter（<ChRef ch="12">Ch12</ChRef>、<ChRef ch="13">Ch13</ChRef>）。</li>
        </ol>
        <p>
          先看 <FigRef id="slope-measure" /> 的上半：選一個 FCW、等 LMS 收斂後把 gain 凍結在 <Tex>{'w+\\Delta'}</Tex> 與 <Tex>{'w-\\Delta'}</Tex>（<Tex>{String.raw`\Delta`}</Tex>{' '}
          是一個小的 gain 偏移，單位 t.u.），各量一次平均 GMAC，分別記作 <Tex>{'G_+'}</Tex>、<Tex>{'G_-'}</Tex>；兩者相減再除以 <Tex>{'2\\Delta'}</Tex> 就是恢復斜率的估計{' '}
          <Tex>{String.raw`\hat S`}</Tex>（藍色）。再看下半的兩個六角形：怎麼從 <Tex>{String.raw`\hat S`}</Tex> 判讀極性與 bias 放大。
        </p>
        <Fig id="slope-measure" />
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
