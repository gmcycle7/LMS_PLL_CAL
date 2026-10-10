import { useEffect, useMemo, useRef, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  ExperimentShell,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  TexBlock,
  mathText,
  useDebouncedValue,
  useThemeTokens,
  type CrossCheck,
  type ExperimentPreset,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import type { WindowName } from '@/simulation/signal'
import { DEFAULT_FFT_PARAMS, FFT_DEMO_FS, fitToleranceDb, runFftPitfalls, type FftPitfallParams, type FftPitfallResult } from './fftPitfalls'

/** 字串內的 `$...$` 以 KaTeX 顯示（ParamControl 的 label / hint 用） */
const md = (s: string) => mathText(s)

const WINDOW_LABEL: Record<WindowName, string> = {
  rectangular: '矩形（rectangular）',
  hann: 'Hann',
  blackmanHarris: 'Blackman-Harris（4-term）',
}


function metricsOf(r: FftPitfallResult, p: FftPitfallParams): MetricRow[] {
  const tolFit = fitToleranceDb(r)
  return [
    {
      name: '載波讀值（whole-record 峰值 bin，相對 $A_1^2/2$）',
      value: r.carrierMeasDb,
      unit: 'dB',
      analytic: r.scallopDb,
      tolerance: 0.05,
      formulaId: 'F-15.11',
      claim: 'exact',
      note: '解析值為視窗 scalloping $10\\log_{10}\\bigl(|W(\\delta)|^2/(\\sum w)^2\\bigr)$',
    },
    { name: 'Spur (A) whole-record FFT 峰值', value: r.spurFftDbc, unit: 'dBc', analytic: p.spurDbc, tolerance: 1, claim: 'approx', note: 'spur 前後 1 個 bin 的最大值，除以量到的載波' },
    {
      name: 'Spur (B) Welch 主瓣積分',
      value: r.spurWelchDbc,
      unit: 'dBc',
      analytic: p.spurDbc,
      tolerance: 1,
      claim: 'approx',
      note: '$\\sum_\\mathrm{lobe}S(f)\\,\\Delta f$ 除以載波功率 $P_1$（含落在主瓣內的雜訊與洩漏）',
    },
    { name: '(B) 積分範圍內只有載波時的功率（洩漏）', value: r.welchLobeLeakDbc, unit: 'dBc', claim: 'exact', note: '無雜訊、無 spur 的 Welch（決定性）；高於 spur 時 (B) 量到的是洩漏' },
    {
      name: '(B) 積分範圍內白雜訊的期望功率',
      value: r.welchLobeNoiseDbc,
      unit: 'dBc',
      formulaId: 'F-15.11',
      claim: 'exact',
      note: '$2\\sigma^2n_\\mathrm{bins}/n_\\mathrm{seg}$：(B) 的讀值大約是 spur 與它的功率和，不會低於它',
    },
    {
      name: 'Spur (C) coherent tone fit',
      value: r.spurFitDbc,
      unit: 'dBc',
      analytic: p.spurDbc,
      tolerance: Number.isFinite(tolFit) ? tolFit : undefined,
      claim: 'approx',
      note: Number.isFinite(tolFit)
        ? `容忍度為 $3\\sigma$：$\\sigma(\\hat A_2)/A_2=\\sigma\\sqrt{2/N}/A_2=${(100 * r.fitRelStd).toFixed(2)}\\%$`
        : '雜訊太大：$3\\sigma$ 相對誤差達 100% 以上，量不到',
    },
    { name: '只有載波時 spur 位置的洩漏', value: r.leakAtSpurDbc, unit: 'dBc', claim: 'exact', note: '無雜訊、無 spur 的 periodogram（決定性）' },
    { name: '每 bin 雜訊底（解析）', value: r.noiseFloorDbc, unit: 'dBc/bin', formulaId: 'F-15.11', claim: 'exact' },
    {
      name: '遠離 tone 的 bin 中位數，加上 $10\\log_{10}(1/\\ln2)$',
      value: r.floorMedianDbc + 10 * Math.log10(1 / Math.LN2),
      unit: 'dBc/bin',
      analytic: r.noiseFloorDbc,
      tolerance: 0.6,
      claim: 'approx',
      note: 'Gaussian 雜訊的 periodogram bin 為 $\\chi^2_2$（指數）分布：中位數等於平均乘上 $\\ln2$；洩漏主導時不成立',
    },
    { name: '排除兩個主瓣後的最高點', value: r.falsePeakDbc, unit: 'dBc', note: `位於 bin ${r.falsePeakBin}；比真實 spur 高就會被誤判` },
    { name: 'ENBW（whole-record）', value: r.enbwBins, unit: 'bins', claim: 'exact' },
    { name: 'Welch RBW（即 ENBW）', value: r.welchEnbwHz, unit: 'Hz', claim: 'exact', note: `${r.welchSegments} 個 segment 平均` },
    { name: 'Welch spur 峰值 PSD', value: r.spurWelchPeakDbcHz, unit: 'dBc/Hz', note: '同一個 tone，換 nperseg 這個數字就變：tone 要用 dBc（積分），不是 dBc/Hz' },
  ]
}

/** 實驗 'fft-spur-pitfalls'：§15.5 一條 FFT 不能證明有 spur */
const FFT_EXPERIMENT_ID = 'fft-spur-pitfalls'

export function FftPitfallsLab() {
  const urlPreset = useUrlPreset(FFT_EXPERIMENT_ID)
  const [p, setP] = useState<FftPitfallParams>(() => ({ ...DEFAULT_FFT_PARAMS, ...((urlPreset?.params ?? {}) as Partial<FftPitfallParams>) }))
  const applied = useRef<string | null>(urlPreset?.id ?? null)
  useEffect(() => {
    if (urlPreset && applied.current !== urlPreset.id) {
      applied.current = urlPreset.id
      setP({ ...DEFAULT_FFT_PARAMS, ...(urlPreset.params as Partial<FftPitfallParams>) })
    }
  }, [urlPreset])
  const presets: ExperimentPreset[] = useMemo(
    () => presetsForExperiment(FFT_EXPERIMENT_ID).map((x) => ({ name: x.title, params: x.params, description: x.description })),
    [],
  )
  const dp = useDebouncedValue(p, 120)
  const tokens = useThemeTokens()
  const out = useMemo(() => {
    try {
      return { r: runFftPitfalls(dp), err: null as string | null }
    } catch (e) {
      return { r: null, err: e instanceof Error ? e.message : String(e) }
    }
  }, [dp])
  const r = out.r
  const set = <K extends keyof FftPitfallParams>(k: K, v: FftPitfallParams[K]) => setP((o) => ({ ...o, [k]: v }))

  const plot = useMemo(() => {
    if (!r) return null
    const D = Math.round(dp.spurOffsetBins)
    const lo = Math.max(0, r.k1 - 2.5 * D)
    const hi = Math.min(r.N / 2, r.k1 + 3.5 * D)
    const data: Data[] = [
      { x: r.binAxis, y: r.specDbc, name: 'periodogram（載波 + spur + 雜訊）', mode: 'lines', line: { color: tokens.series[0], width: 1 } },
      { x: r.binAxis, y: r.leakDbc, name: '只有載波（洩漏）', mode: 'lines', line: { color: tokens.series[1], width: 1, dash: 'dot' } },
      { x: [lo, hi], y: [r.noiseFloorDbc, r.noiseFloorDbc], name: '每 bin 雜訊底（解析）', mode: 'lines', line: { color: tokens.textMuted, dash: 'dash', width: 1 } },
      { x: [(r.f2 * r.N) / r.fs], y: [dp.spurDbc], name: '真實 spur 位準', mode: 'markers', marker: { symbol: 'diamond', size: 10, color: tokens.series[2] } },
    ]
    const layout = {
      xaxis: { title: { text: '頻率 [bin = f·N/f_s]' }, range: [lo, hi] },
      yaxis: { title: { text: 'dBc per bin（相對 A₁²/2）' }, range: [Math.max(-200, Math.min(r.noiseFloorDbc, dp.spurDbc) - 30), 5] },
    }
    return { data, layout }
  }, [r, dp, tokens])

  const crossCheck: CrossCheck = r
    ? {
        analytic: {
          status: Math.abs(r.carrierMeasDb - r.scallopDb) <= 0.05 ? 'ok' : 'mismatch',
          note: `載波讀值 ${r.carrierMeasDb.toFixed(3)} dB vs 解析 scalloping ${r.scallopDb.toFixed(3)} dB`,
        },
        monteCarlo: { status: 'not-implemented', note: '單一 realization；多 seed 統計未實作（可改 seed 觀察 (C) 的 $3\\sigma$ 範圍）' },
        fixedPoint: { status: 'n/a', note: '浮點訊號處理示範，沒有定點路徑' },
      }
    : { analytic: 'not-implemented', monteCarlo: 'not-implemented', fixedPoint: 'n/a' }

  return (
    <ExperimentShell
      id={FFT_EXPERIMENT_ID}
      title="一條 FFT 不能證明有 Spur：三種量測模式對照"
      level="L4"
      claim="exact"
      source="illustrative"
      description={
        <>
          <TexBlock>{'x[n]=\\cos(2\\pi f_1n/f_s)+A_2\\cos(2\\pi f_2n/f_s+\\varphi_2)+v[n]'}</TexBlock>取樣率 <Tex>{`f_s=${FFT_DEMO_FS / 1e6}\\,\\mathrm{MHz}`}</Tex>（示意）。同一筆資料用 (A) whole-record
          periodogram、(B) Welch PSD、(C) 已知頻率的 coherent tone fit 量 spur，看誰說真話。
        </>
      }
      assumptions={[
        '示意訊號：一個載波（$A_1=1$）、一個 spur（$A_2=10^{\\mathrm{spur_{dBc}}/20}$）與白色 Gaussian 雜訊',
        "periodogram 為 one-sided、scaling = 'spectrum'（tone 在 bin 中心讀 $A^2/2$）；Welch 為 density（$x^2/\\mathrm{Hz}$）",
        'coherent tone fit 假設頻率精確已知；頻率誤差 $\\Delta f$ 會使振幅下降約 $\\operatorname{sinc}(\\Delta f\\,N/f_s)$',
        'detrend = none；載波頻率 $f_1=(\\mathrm{round}(N/8)+\\delta)\\,f_s/N$，spur 在 $f_2=f_1+\\Delta\\,f_s/N$',
      ]}
      params={{ ...dp }}
      seed={p.seed}
      onSeedChange={(s) => set('seed', s)}
      units={{ log2N: 'log2(samples)', offsetBins: 'bin', spurOffsetBins: 'bin', spurDbc: 'dBc', noiseDbc: 'dB（總功率相對載波）', welchLog2Seg: 'log2(samples)' }}
      metrics={r ? metricsOf(r, dp) : []}
      warnings={out.err ? [`參數無效：${out.err}`] : (r?.warnings ?? [])}
      crossCheck={crossCheck}
      actions={{ onReset: () => setP(DEFAULT_FFT_PARAMS) }}
      exportData={() => {
        if (!r) throw new Error('沒有結果')
        return { bin: r.binAxis, periodogram_dBc: r.specDbc, carrier_only_dBc: r.leakDbc }
      }}
      presets={presets}
      onLoadPreset={(pr) => setP({ ...DEFAULT_FFT_PARAMS, ...(pr.params as Partial<FftPitfallParams>) })}
      controls={
        <>
          <ParamControl
            label={md('紀錄長度 $\\log_2N$')}
            ariaLabel="紀錄長度 log2 N"
            value={p.log2N}
            onChange={(v) => set('log2N', v)}
            min={8}
            max={16}
            step={1}
            integer
            clampOnBlur
            unit="log2 samples"
            reg="Measurement：record length N"
            hint={md(`$N=${2 ** p.log2N}$`)}
          />
          <ParamControl
            label={md('非相干偏移 $\\delta$')}
            ariaLabel="非相干偏移 delta"
            value={p.offsetBins}
            onChange={(v) => set('offsetBins', v)}
            min={0}
            max={0.5}
            step={0.01}
            unit="bin"
            reg="Measurement：coherent / noncoherent"
            hint={md('$\\delta=0$ 為 coherent（整數週期）')}
          />
          <ParamControl
            label={md('spur 距離 $\\Delta$')}
            ariaLabel="spur 距離 Delta"
            value={p.spurOffsetBins}
            onChange={(v) => set('spurOffsetBins', v)}
            min={3}
            max={2000}
            step={1}
            integer
            clampOnBlur
            unit="bin"
            reg="Signal：f2 - f1（spur offset）"
          />
          <ParamControl label="真實 spur 位準" value={p.spurDbc} onChange={(v) => set('spurDbc', v)} min={-140} max={-20} step={0.5} unit="dBc" reg="Signal：spur amplitude" />
          <ParamControl label="雜訊總功率（相對載波）" value={p.noiseDbc} onChange={(v) => set('noiseDbc', v)} min={-160} max={-20} step={0.5} unit="dB" reg="Signal：white noise power" />
          <SelectControl
            label="視窗"
            value={p.window}
            onChange={(v) => set('window', v)}
            options={(Object.keys(WINDOW_LABEL) as WindowName[]).map((w) => ({ value: w, label: WINDOW_LABEL[w] }))}
            reg="Measurement：window"
          />
          <ParamControl
            label={md('Welch segment $\\log_2(\\text{nperseg})$')}
            ariaLabel="Welch segment log2(nperseg)"
            value={p.welchLog2Seg}
            onChange={(v) => set('welchLog2Seg', v)}
            min={5}
            max={16}
            step={1}
            integer
            clampOnBlur
            unit="log2 samples"
            reg="Measurement：Welch nperseg"
            hint={md('超過 $\\log_2N$ 時以 $N$ 計算')}
          />
        </>
      }
    >
      {plot && <Plot title="Whole-record periodogram（dBc per bin）" data={plot.data} layout={plot.layout} height={320} csvName="fft-pitfalls" caption={r ? `window = ${dp.window}、$N=${r.N}$、ENBW 為 ${r.enbwBins.toFixed(3)} bins、$\\Delta f=f_s/N=${(r.fs / r.N / 1e3).toFixed(3)}$ kHz、one-sided、scaling = spectrum（bin 中心的 tone 讀 $A^2/2$）；$f_1$ 在 bin ${(r.k1 + dp.offsetBins).toFixed(2)}，$f_2$ 在 bin ${(r.k1 + dp.offsetBins + Math.round(dp.spurOffsetBins)).toFixed(2)}` : undefined} />}
      <div className="small models-tryit">
        試試看：
        <ol className="models-tight">
          <li>
            把 <Tex>{'\\delta'}</Tex> 設成 0（coherent），矩形窗的洩漏消失，(A) 與 (C) 回到真實的 spur 位準；(B) 仍偏高，因為 Welch 主瓣的幾個 bin 裡裝了和 spur 同量級的雜訊（看警告與指標表）——把雜訊降到{' '}
            <Tex>{'-90\\,\\mathrm{dB}'}</Tex> 或加長 Welch segment 再看。
          </li>
          <li>
            <Tex>{'\\delta=0.5'}</Tex> 時換成 Blackman-Harris，洩漏底掉到 spur 以下。
          </li>
          <li>
            <Tex>{'\\log_2N=8'}</Tex> 時雜訊底升高，spur 消失在雜訊裡；(C) 的不確定度也跟著變大（看它的容忍度）。
          </li>
          <li>
            把 Welch segment 縮到 <Tex>{'2^6'}</Tex>，(B) 的結果被載波裙邊吃掉；同時看「Welch spur 峰值 PSD」怎麼隨 RBW 改變。
          </li>
        </ol>
      </div>
    </ExperimentShell>
  )
}
