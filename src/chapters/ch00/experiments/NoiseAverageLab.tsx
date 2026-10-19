import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import {
  ClaimTag,
  CodeBlock,
  ExperimentShell,
  ModeGate,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  useThemeTokens,
  type ExperimentPreset,
  type MetricRow,
} from '@/components'
import { presetsForExperiment } from '@/app/presets'
import {
  REGRESSOR_LABEL,
  kurtosisExcessFloor,
  noiseAverageDegeneracy,
  simulateNoiseAverage,
  stdTolerance,
  varianceZScore,
  type RegressorKind,
} from '../model'
import { num, texNum, texRes } from '../format'
import { TryIt, usePresetVisit, useScrollToExperiment } from '../common'
import modelSrc from '../model.ts?raw'

export const NOISE_EXP_ID = 'intro-noise-average'

interface NoiseParams {
  a: number
  w: number
  sigmaV: number
  xKind: RegressorKind
  trials: number
  nMax: number
}

const DEFAULTS: NoiseParams = { a: 3, w: 2, sigmaV: 1, xKind: 'gaussian', trials: 200, nMax: 1024 }
/** 實驗的預設參數（HC-00.5 的預設值與它相同；handcalcs.test.tsx 會比對） */
export const NOISE_LAB_DEFAULTS: Readonly<NoiseParams> = DEFAULTS
const SEED_DEFAULT = 20261010
const N_MAX_OPTIONS = [256, 512, 1024]
/** 固定的版面物件（模組層級）：參數改變時只有 data 會變，Plot 不會因為新的 layout 參照而重設縮放 */
const STD_LAYOUT: Partial<Layout> = {
  xaxis: { title: { text: '$N$（平均的樣本數）' } },
  // 縱軸的範圍不到一個 decade：Plotly 預設會把 2–9 全部標出來，擠成一團；只標 1、2、5
  yaxis: { title: { text: String.raw`$\operatorname{std}(\bar G_N)$` }, dtick: 'D2' },
}
const TRACE_LAYOUT: Partial<Layout> = {
  xaxis: { title: { text: '$n$' } },
  yaxis: { title: { text: String.raw`$\bar G_n = (1/n)\sum e\,x$` } },
}
const CORRECT_LAYOUT: Partial<Layout> = {
  xaxis: { title: { text: '$N$' } },
  yaxis: { title: { text: String.raw`$P(\mathrm{sign}\ \text{正確})$` }, range: [0.4, 1.02] },
}

function fromPreset(params: Record<string, unknown> | undefined): NoiseParams {
  const p = { ...DEFAULTS }
  if (!params) return p
  for (const k of ['a', 'w', 'sigmaV', 'trials', 'nMax'] as const) {
    const v = params[k]
    if (typeof v === 'number' && Number.isFinite(v)) p[k] = v
  }
  if (params.xKind === 'gaussian' || params.xKind === 'pm_one') p.xKind = params.xKind
  if (!N_MAX_OPTIONS.includes(p.nMax)) p.nMax = 1024
  p.trials = Math.min(200, Math.max(20, Math.round(p.trials)))
  return p
}

/** 小型 Monte Carlo：固定 w，N 筆 e·x 的平均如何隨 N 收斂（1/√N 法則）。 */
export function NoiseAverageLab() {
  const tokens = useThemeTokens()
  const { preset: urlPreset, visit } = usePresetVisit(NOISE_EXP_ID)
  const applied = useRef<string | undefined>(visit)
  useScrollToExperiment(NOISE_EXP_ID, visit)
  const [params, setParams] = useState<NoiseParams>(() => fromPreset(urlPreset?.params))
  const [seed, setSeed] = useState<number>(() => (typeof urlPreset?.params.seed === 'number' ? urlPreset.params.seed : SEED_DEFAULT))

  // 掛載後網址的 preset 改變（或同一個 preset 連結再點一次）時重新套用
  useEffect(() => {
    if (urlPreset && applied.current !== visit) {
      applied.current = visit
      setParams(fromPreset(urlPreset.params))
      if (typeof urlPreset.params.seed === 'number') setSeed(urlPreset.params.seed)
    }
  }, [urlPreset, visit])

  const presets: ExperimentPreset[] = useMemo(
    () => presetsForExperiment(NOISE_EXP_ID).map((p) => ({ id: p.id, name: p.title, params: p.params, description: p.description })),
    [],
  )

  const dp = useDeferredValue(params)
  const dSeed = useDeferredValue(seed)
  // 至多 200 × 1024 ≈ 2e5 個樣本：主執行緒約數十 ms，不需要 Worker
  const res = useMemo(() => simulateNoiseAverage({ ...dp, seed: dSeed, traces: 6 }), [dp, dSeed])
  const K = res.checkpoints.length
  const zs = useMemo(() => res.mcStd.map((s, k) => varianceZScore(s, res.theoryStd[k], res.mcKurtosis[k], dp.trials)), [res, dp.trials])
  const worstZ = zs.reduce((m, z) => (Math.abs(z) > Math.abs(m) ? z : m), 0)
  const meanSe = res.s1 / Math.sqrt(dp.nMax * dp.trials) // 所有試驗在 N_max 的總平均的標準誤

  const stdData: Data[] = useMemo(
    () => [
      {
        x: res.checkpoints,
        y: res.mcStd,
        name: String.raw`Monte Carlo：${dp.trials} 次試驗的 $\operatorname{std}(\bar G_N)$`,
        mode: 'markers',
        marker: { size: 8, color: tokens.series[0] },
      },
      {
        x: res.checkpoints,
        y: res.theoryStd,
        name: String.raw`理論 $s_1/\sqrt{N}$`,
        mode: 'lines',
        line: { color: tokens.series[1], dash: 'dash' },
      },
    ],
    [res, dp.trials, tokens],
  )

  const traceData: Data[] = useMemo(() => {
    const n = Array.from({ length: dp.nMax }, (_, i) => i + 1)
    // 為了畫圖輕量，對數間隔取樣
    const idx: number[] = []
    for (let i = 0; i < dp.nMax; i = Math.max(i + 1, Math.floor(i * 1.06))) idx.push(i)
    if (idx[idx.length - 1] !== dp.nMax - 1) idx.push(dp.nMax - 1)
    const nx = idx.map((i) => n[i])
    const env = (sgn: 1 | -1) => nx.map((k) => res.theoryMean + (sgn * 2 * res.s1) / Math.sqrt(k))
    const traces: Data[] = res.traces.map((tr, t) => ({
      x: nx,
      y: idx.map((i) => tr[i]),
      name: `試驗 ${t + 1}`,
      mode: 'lines',
      line: { width: 1.2, color: tokens.series[t % tokens.series.length] },
      showlegend: t === 0,
      legendgroup: 'traces',
    }))
    traces.push(
      { x: nx, y: nx.map(() => res.theoryMean), name: String.raw`$E[e\,x] = (a - w)E[x^2] = ${texRes(res.theoryMean)}$`, mode: 'lines', line: { color: tokens.text, width: 2 } },
      { x: nx, y: env(1), name: String.raw`$\pm 2 s_1/\sqrt{N}$ 包絡`, mode: 'lines', line: { color: tokens.textMuted, dash: 'dot' }, legendgroup: 'env' },
      { x: nx, y: env(-1), name: String.raw`$-2 s_1/\sqrt{N}$`, mode: 'lines', line: { color: tokens.textMuted, dash: 'dot' }, showlegend: false, legendgroup: 'env' },
    )
    return traces
  }, [res, dp.nMax, tokens])

  const correctData: Data[] = useMemo(
    () => [
      { x: res.checkpoints, y: res.mcCorrect, name: String.raw`Monte Carlo：$\mathrm{sign}(\bar G_N)$ 正確的比例`, mode: 'markers', marker: { size: 8, color: tokens.series[2] } },
      { x: res.checkpoints, y: res.cltCorrect, name: String.raw`CLT 近似 $\Phi(\sqrt{N}\,|E[z]|/s_1)$`, mode: 'lines', line: { color: tokens.series[3], dash: 'dash' } },
    ],
    [res, tokens],
  )

  const degen = noiseAverageDegeneracy(dp.a, dp.w, dp.sigmaV, dp.xKind)
  const degenerate = degen.kind === 'no-randomness'
  // 浮點捨入的下限：s₁ = 0（沒有隨機性）時標準誤為 0，仍要容許累加時 ~1e-16 的捨入
  const roundoff = 1e-9 * Math.max(1, Math.abs(res.theoryMean))

  const metrics: MetricRow[] = [
    { name: String.raw`理論 $E[e\,x]=(a-w)E[x^2]$`, value: res.theoryMean, formulaId: 'F-00.7', claim: 'exact' },
    {
      name: `MC：所有試驗在 $N=${dp.nMax}$ 的平均`,
      value: res.mcMean[K - 1],
      analytic: res.theoryMean,
      tolerance: 4 * meanSe + roundoff,
      toleranceMode: 'abs',
      claim: 'exact',
      note: degenerate ? '$s_1=0$：沒有隨機性，只容許浮點捨入' : String.raw`容忍 4 個標準誤（$4\,s_1/\sqrt{MN}=${texRes(4 * meanSe, 3)}$）`,
    },
    {
      name: '單筆標準差 $s_1$',
      value: res.s1,
      formulaId: 'F-00.8',
      claim: 'exact',
      note: String.raw`$s_1^2=(a-w)^2\big(E[x^4]-E[x^2]^2\big)+\sigma_v^2E[x^2]$`,
    },
    {
      name: 'MC：$N=1$ 的 std',
      value: res.mcStd[0],
      analytic: res.theoryStd[0],
      tolerance: stdTolerance(res.theoryStd[0], res.mcKurtosis[0], dp.trials) + roundoff,
      toleranceMode: 'abs',
      claim: 'exact',
      note: degenerate ? String.raw`$s_1=0$：每一筆 $e\,x$ 都相同` : `樣本 kurtosis ${num(res.mcKurtosis[0], 3)}（Gaussian 為 3）`,
    },
    {
      name: `MC：$N=${dp.nMax}$ 的 std`,
      value: res.mcStd[K - 1],
      analytic: res.theoryStd[K - 1],
      tolerance: stdTolerance(res.theoryStd[K - 1], res.mcKurtosis[K - 1], dp.trials) + roundoff,
      toleranceMode: 'abs',
      formulaId: 'F-00.8',
      claim: 'exact',
    },
    degenerate
      ? // s₁ = 0 時「縮小倍數」是 0/0，沒有定義：不比較（而不是顯示成不通過）
        { name: String.raw`std 縮小倍數（$N=1\to${dp.nMax}$）`, value: null, note: '$s_1=0$：沒有雜訊可以縮小（$0/0$ 無定義，不比較）' }
      : {
          name: String.raw`std 縮小倍數（$N=1\to${dp.nMax}$）`,
          value: res.mcStd[K - 1] > 0 ? res.mcStd[0] / res.mcStd[K - 1] : null,
          analytic: Math.sqrt(dp.nMax),
          // 兩個樣本 std 相除：相對標準誤 ≈ √[(κ₁ − 1 + κ_N − 1)/(4M)]，容忍 4 倍
          tolerance:
            4 *
            Math.sqrt(dp.nMax) *
            Math.sqrt((kurtosisExcessFloor(res.mcKurtosis[0]) + kurtosisExcessFloor(res.mcKurtosis[K - 1])) / (4 * dp.trials)),
          toleranceMode: 'abs',
          note: String.raw`理論 $\sqrt N$（兩個 MC 估計相除，容忍 4 倍相對標準誤）`,
          claim: 'approx',
        },
    { name: String.raw`總樣本數 $M\cdot N_{\max}$`, value: res.totalSamples, digits: 7 },
  ]
  const crossCheck = {
    analytic: { status: 'ok' as const, note: '平均與變異數為封閉式（productMoments）' },
    monteCarlo: degenerate
      ? { status: 'n/a' as const, note: String.raw`$s_1=0$：每一筆 $e\,x$ 都相同，沒有隨機性` }
      : {
          status: (zs.every((z) => Math.abs(z) < 4) ? 'ok' : 'mismatch') as 'ok' | 'mismatch',
          note: String.raw`${K} 個 $N$ 的樣本變異數 vs $s_1^2/N$，最大 $|z|=${texRes(Math.abs(worstZ), 3)}$（SE 以樣本 kurtosis 修正；$|z|<4$ 視為一致）`,
        },
    fixedPoint: { status: 'n/a' as const, note: '本實驗只示範統計平均，不涉及定點' },
  }

  const set = (patch: Partial<NoiseParams>) => setParams((p) => ({ ...p, ...patch }))

  return (
    <ExperimentShell
      id={NOISE_EXP_ID}
      title={String.raw`雜訊為什麼會被平均掉？（$1/\sqrt N$ 小型 Monte Carlo）`}
      level="L0"
      claim="exact"
      source="simulation"
      description={
        <>
          固定 <Tex>{'w'}</Tex>（不更新），量 <Tex>{'N'}</Tex> 筆 <Tex>{'e\\cdot x'}</Tex> 的平均{' '}
          <Tex>{'\\bar G_N=\\frac1N\\sum e_ix_i'}</Tex>，重複 <Tex>{'M'}</Tex> 次獨立試驗，看它的分散程度如何隨{' '}
          <Tex>{'N'}</Tex> 變小。
        </>
      }
      assumptions={[
        String.raw`$y=a\,x+v$；$v\sim\mathcal N(0,\sigma_v^2)$ 與 $x$ 獨立、iid`,
        String.raw`$w$ 固定（不更新），只觀察平均更新方向`,
        String.raw`$x$ 為 iid：Gaussian $\mathcal N(0,1)$ 或 $\pm1$ 等機率`,
        String.raw`理論 std 為 $s_1/\sqrt N$（精確）；sign 正確機率的 $\Phi(\cdot)$ 為 CLT 近似`,
      ]}
      params={{ a: params.a, w: params.w, sigma_v: params.sigmaV, x_kind: params.xKind, trials: params.trials, n_max: params.nMax }}
      seed={seed}
      onSeedChange={setSeed}
      units={{ a: '無因次', w: '無因次', sigma_v: '同 y', trials: '次', n_max: 'samples' }}
      metrics={metrics}
      warnings={[]}
      crossCheck={crossCheck}
      actions={{ onReset: () => { setParams(DEFAULTS); setSeed(SEED_DEFAULT) } }}
      exportData={() => ({
        N: res.checkpoints,
        mc_mean: res.mcMean,
        mc_std: res.mcStd,
        theory_std: res.theoryStd,
        mc_kurtosis: res.mcKurtosis,
        z_variance: zs,
        mc_p_correct: res.mcCorrect,
        clt_p_correct: res.cltCorrect,
      })}
      presets={presets}
      onLoadPreset={(p) => {
        setParams(fromPreset(p.params))
        if (typeof p.params.seed === 'number') setSeed(p.params.seed)
      }}
      controls={
        <>
          <ParamControl
            label={
              <>
                <Tex>{'a'}</Tex>（真實參數）
              </>
            }
            ariaLabel="a（真實參數）"
            value={params.a}
            onChange={(a) => set({ a })}
            min={-10}
            max={10}
            step={0.1}
            unit="—"
            reg="Behavioral: a_true"
          />
          <ParamControl
            label={
              <>
                <Tex>{'w'}</Tex>（目前的猜測，固定）
              </>
            }
            ariaLabel="w（目前的猜測，固定）"
            value={params.w}
            onChange={(w) => set({ w })}
            min={-10}
            max={10}
            step={0.1}
            unit="—"
            reg="REG_GAIN（凍結中的 w）"
            hint={
              <>
                <Tex>{'\\delta=a-w'}</Tex> 決定平均更新量 <Tex>{'\\delta\\,E[x^2]'}</Tex> 的大小與方向
              </>
            }
          />
          <ParamControl
            label={
              <>
                <Tex>{'\\sigma_v'}</Tex>（量測雜訊 RMS）
              </>
            }
            ariaLabel="sigma_v（量測雜訊 RMS）"
            value={params.sigmaV}
            onChange={(sigmaV) => set({ sigmaV })}
            min={0}
            max={10}
            step={0.1}
            unit="同 $y$"
            reg="Behavioral: sigma_v"
          />
          <SelectControl
            label={
              <>
                <Tex>{'x'}</Tex> 的分布
              </>
            }
            ariaLabel="x 的分布"
            value={params.xKind}
            onChange={(xKind) => set({ xKind })}
            options={[
              { value: 'gaussian', label: REGRESSOR_LABEL.gaussian },
              { value: 'pm_one', label: REGRESSOR_LABEL.pm_one },
            ]}
            reg="Behavioral: regressor 分布（DSM code 統計）"
          />
          <ParamControl
            label={
              <>
                試驗次數 <Tex>{'M'}</Tex>
              </>
            }
            ariaLabel="試驗次數 M"
            value={params.trials}
            onChange={(trials) => set({ trials })}
            min={20}
            max={200}
            integer
            clampOnBlur
            unit="次"
            reg="Behavioral: mc_trials"
          />
          <SelectControl
            label={
              <>
                最長平均長度 <Tex>{'N_{\\max}'}</Tex>
              </>
            }
            ariaLabel="最長平均長度 N_max"
            value={params.nMax}
            onChange={(nMax) => set({ nMax })}
            options={N_MAX_OPTIONS.map((n) => ({ value: n, label: String(n) }))}
            reg="REG_GMAC_N（累加長度）"
            hint={
              <>
                <Tex>{'M\\times N_{\\max}\\le2\\times10^5'}</Tex>，主執行緒即可算完
              </>
            }
          />
        </>
      }
    >
      {degen.kind === 'at-answer' && (
        <p className="callout">
          現在 <Tex>{'w=a'}</Tex>：平均更新量 <Tex>{'E[e\\,x]=0'}</Tex>，已經在答案上了。每一筆 <Tex>{'e\\cdot x=v\\,x'}</Tex> 只剩雜訊，平均會在 0 附近以{' '}
          <Tex>{'1/\\sqrt N'}</Tex> 縮小；「正負號是否正確」沒有意義（約 50%）。
        </p>
      )}
      {degen.kind === 'no-randomness' && (
        <p className="callout">
          <Tex>{'s_1=0'}</Tex>：
          {dp.a === dp.w ? (
            <>
              <Tex>{'w=a'}</Tex> 且 <Tex>{'\\sigma_v=0'}</Tex>，<Tex>{'e=(a-w)x+v\\equiv0'}</Tex>，每一筆 <Tex>{'e\\cdot x'}</Tex> 都是 0——已經學會、也沒有雜訊。
            </>
          ) : (
            <>
              <Tex>{'\\pm1'}</Tex> 輸入且 <Tex>{'\\sigma_v=0'}</Tex>，<Tex>{`e\\cdot x=(a-w)x^2=a-w=${texRes(degen.constant ?? 0)}`}</Tex>{' '}
              每一筆都一樣，一筆就夠了——平均不會再改善任何東西。
            </>
          )}
        </p>
      )}
      <Plot
        title="$N$ 筆平均的標準差 vs $N$（log–log）"
        ariaLabel="N 筆平均的標準差 vs N（log–log）"
        csvName="intro-noise-std"
        data={stdData}
        xLog
        yLog
        layout={STD_LAYOUT}
        height={300}
        caption={
          <>
            log–log 圖上斜率 <Tex>{'-\\tfrac12'}</Tex> 的直線就是 <Tex>{'1/\\sqrt N'}</Tex> 法則：<Tex>{'N'}</Tex> 變 100 倍，雜訊只降 10 倍。點：Monte Carlo 的{' '}
            <Tex>{'\\operatorname{std}(\\bar G_N)'}</Tex>；虛線：理論 <Tex>{'s_1/\\sqrt N'}</Tex>。
          </>
        }
      />
      <Plot
        title={String.raw`前 6 次試驗的 running average $\bar G_n$`}
        ariaLabel="前 6 次試驗的 running average"
        csvName="intro-noise-traces"
        data={traceData}
        xLog
        layout={TRACE_LAYOUT}
        height={300}
        caption={
          <>
            每條線是一次試驗的 running average <Tex>{'\\bar G_n=\\frac1n\\sum_{i=1}^{n}e_ix_i'}</Tex>：一開始亂跳（單筆的雜訊很大），但都慢慢被拉向同一個數{' '}
            <Tex>{'(a-w)E[x^2]'}</Tex>。點線是 <Tex>{'\\pm2s_1/\\sqrt n'}</Tex>（2 個理論標準差）的包絡。
          </>
        }
      />
      <ModeGate min="engineer">
        <Plot
          title="平均值的正負號判斷正確的機率"
          csvName="intro-noise-sign"
          data={correctData}
          xLog
          layout={CORRECT_LAYOUT}
          height={260}
          caption={
            <>
              CLT 近似 <Tex>{'\\Phi\\big(\\sqrt N\\,|E[e\\,x]|/s_1\\big)'}</Tex>（虛線，近似｜需驗證）與 Monte Carlo（點）。Ch05 會把這件事用在 1-bit
              comparator：要累加多少筆才能以 95% 機率判斷方向。
            </>
          }
        />
        <p className="small">
          <ClaimTag kind="approx" /> 小 <Tex>{'N'}</Tex> 時 <Tex>{'e\\cdot x'}</Tex> 並不是 Gaussian（Gaussian <Tex>{'x'}</Tex> 的 <Tex>{'x^2'}</Tex>{' '}
          項有重尾，<Tex>{'N=1'}</Tex> 的樣本 kurtosis 約 <Tex>{texNum(res.mcKurtosis[0], 3)}</Tex>，Gaussian 為 3），所以 CLT 曲線在左端只是近似；
          <Tex>{'N'}</Tex> 變大後兩者趨於一致。
        </p>
        <CodeBlock source={modelSrc} region="noiseAverage" path="src/chapters/ch00/model.ts" caption="這個實驗的 Monte Carlo 核心（固定 seed 可重現；$x$ 與 $v$ 各用一條 fork 出來的亂數流）。" />
      </ModeGate>
      <TryIt
        items={[
          <>
            把 <Tex>{'\\sigma_v'}</Tex> 從 1 調到 5：所有曲線整體上移（<Tex>{'s_1'}</Tex> 變大），但斜率仍是 <Tex>{'-1/2'}</Tex>——雜訊再大，只要 <Tex>{'N'}</Tex> 夠大一樣會被平均掉。
          </>,
          <>
            把 <Tex>{'x'}</Tex> 改成 <Tex>{'\\pm1'}</Tex> 碼：<Tex>{'s_1'}</Tex> 只剩 <Tex>{'\\sigma_v'}</Tex>（<Tex>{'x^2\\equiv1'}</Tex> 沒有額外的起伏），這就是 PLL 校正常用 <Tex>{'\\pm1'}</Tex> 或正規化 code 的原因之一。</>,
          <>
            把 <Tex>{'w'}</Tex> 設成 <Tex>{'a'}</Tex>：平均更新量變 0，「已經學會」時更新只剩雜訊。
          </>,
          <>換幾個 seed：個別路徑不同，但 std 的點都落在虛線附近（Monte Carlo 欄的 z 檢定會告訴你是否一致）。</>,
        ]}
      />
    </ExperimentShell>
  )
}
