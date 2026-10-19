import { useEffect, useMemo, useRef, useState } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
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
import { meanGhatCurves } from './gmacMath'
import { DEFAULT_GMAC_PARAMS, gmacSizing, gmacWarnings, type GmacSizingParams } from './gmacSizing'

/** 字串內的 `$...$` 以 KaTeX 顯示（ParamControl 的 label / hint 用） */
const md = (s: string) => mathText(s)

/** 實驗 'gmac-datapath-sizing'：§16.1 第 3–5 項 */
const GMAC_EXPERIMENT_ID = 'gmac-datapath-sizing'

// layout 放在模組層級：identity 穩定，Plot 只在資料改變時重畫
const CURVE_LAYOUT = { xaxis: { title: { text: '$\\delta = a - w$ [fs]' } }, yaxis: { title: { text: '$E[\\hat G]$（正規化）' } } }

export function GmacSizingLab() {
  const urlPreset = useUrlPreset(GMAC_EXPERIMENT_ID)
  const [p, setP] = useState<GmacSizingParams>(() => ({ ...DEFAULT_GMAC_PARAMS, ...((urlPreset?.params ?? {}) as Partial<GmacSizingParams>) }))
  const applied = useRef<string | null>(urlPreset?.id ?? null)
  useEffect(() => {
    if (urlPreset && applied.current !== urlPreset.id) {
      applied.current = urlPreset.id
      setP({ ...DEFAULT_GMAC_PARAMS, ...(urlPreset.params as Partial<GmacSizingParams>) })
    }
  }, [urlPreset])
  const presets: ExperimentPreset[] = useMemo(
    () => presetsForExperiment(GMAC_EXPERIMENT_ID).map((x) => ({ name: x.title, params: x.params, description: x.description })),
    [],
  )
  const dp = useDebouncedValue(p, 150)
  const tokens = useThemeTokens()
  const out = useMemo(() => {
    try {
      return { o: gmacSizing(dp), err: null as string | null }
    } catch (e) {
      return { o: null, err: e instanceof Error ? e.message : String(e) }
    }
  }, [dp])
  const o = out.o
  const set = <K extends keyof GmacSizingParams>(k: K, v: GmacSizingParams[K]) => setP((x) => ({ ...x, [k]: v }))

  const curve = useMemo(() => {
    if (!o) return null
    const d = o.eq.derived
    const approxFloor = d.ell > 0 ? d.deltaG / (2 * d.K) : 0
    const R = Math.max(4 * approxFloor, (0.05 * dp.sigmaV) / d.xNorm, 1e-6)
    const deltas = Array.from({ length: 121 }, (_, i) => -R + (2 * R * i) / 120)
    const c = meanGhatCurves({ bx: dp.bx, log2N: dp.log2N, gFracBits: dp.gFracBits, sigmaV: dp.sigmaV }, deltas)
    const data: Data[] = [
      { x: deltas, y: c.ideal, name: '無截斷 $E[G] = x_n(2\\Phi - 1)$', mode: 'lines', line: { color: tokens.textMuted, width: 1.5 } },
      { x: deltas, y: c.linear, name: '線性化 $K\\delta$', mode: 'lines', line: { color: tokens.textMuted, dash: 'dot', width: 1 } },
      { x: deltas, y: c.floor, name: 'floor 右移 $E[\\hat G]$', mode: 'lines', line: { color: tokens.series[1], width: 2 } },
      { x: deltas, y: c.halfUp, name: 'round half up $E[\\hat G]$', mode: 'lines', line: { color: tokens.series[0], width: 2, dash: 'dash' } },
    ]
    return { data, R }
  }, [o, dp, tokens])

  const metrics: MetricRow[] = o
    ? [
        { name: '經驗法則 $B_x+\\lceil\\log_2N\\rceil$', value: o.bitsRule, unit: 'bits' },
        { name: '$B_\\mathrm{acc}$ 精確：symmetric code', value: o.bitsSym, unit: 'bits', formulaId: 'F-16.1', claim: 'exact', analytic: o.bitsRule, tolerance: 0 },
        { name: '$B_\\mathrm{acc}$ 精確：full-range code', value: o.bitsFull, unit: 'bits', formulaId: 'F-16.1', claim: 'exact' },
        { name: '最壞正總和 $N\\max(q\\,x)$', value: o.maxPos * o.N, unit: 'code LSB', claim: 'exact' },
        {
          name: `少 1 bit（${o.bitsSel - 1} bits）時的 wrap 結果`,
          value: o.shortPos.wrapped,
          unit: 'code LSB',
          formulaId: 'F-16.2',
          claim: 'exact',
          note: o.shortPos.firstOverflow !== null ? `正確值 ${o.shortPos.exact}；第 ${o.shortPos.firstOverflow} 筆開始溢位${o.shortPos.wrapped < 0 ? '，符號翻轉' : ''}` : '正向沒有溢位（溢位發生在負向）',
        },
        { name: '$G$ 的 LSB $\\Delta_G$（正規化）', value: o.eq.derived.deltaG, unit: '1', claim: 'exact' },
        { name: '自然 dither $\\sigma_G/\\Delta_G$', value: o.eq.derived.ditherLsb, unit: 'LSB', claim: 'approx' },
        {
          name: '截斷平衡點 $\\delta^*=a-w^*$（精確 mean-field）',
          value: o.eq.hasEquilibrium ? o.eq.deltaStar : '無平衡點',
          unit: 'fs',
          formulaId: 'F-16.3',
          claim: 'exact',
          analytic: o.eq.hasEquilibrium ? o.eq.approxDeltaStar : undefined,
          tolerance: o.eq.hasEquilibrium && o.eq.derived.ditherLsb >= 0.4 ? Math.max(0.05 * Math.abs(o.eq.approxDeltaStar), 2e-3 * dp.sigmaV / 100) : undefined,
          note: '解析值為近似式 $\\Delta_G/(2K)$（floor）或 0（half up）；精確值為 Binomial 求和（平均 $\\pm40\\sigma$）加 bisection',
        },
        { name: '死區寬度 $\\delta_\\mathrm{hi}-\\delta_\\mathrm{lo}$', value: o.eq.hasEquilibrium ? o.eq.deadZone : NaN, unit: 'fs', claim: 'exact' },
        { name: '$w=a$ 時的平均漂移 $\\mu\\,E[\\hat G](0)$', value: dp.mu * o.eq.meanAtTruth, unit: 'fs/block', claim: 'exact' },
        { name: '線性化 $\\sigma_w$（對照）', value: o.sigmaW, unit: 'fs', formulaId: 'F-15.5', claim: 'approx', note: `$g=\\mu K=${o.g.toPrecision(4)}$，$\\sigma_\\eta^2=x_n^2/N$` },
      ]
    : []

  const crossCheck: CrossCheck = o
    ? {
        analytic:
          o.eq.derived.ell <= 0
            ? { status: 'n/a', note: '$F_G\\ge\\log_2N$：沒有截斷' }
            : o.eq.derived.ditherLsb < 0.4
              ? { status: 'n/a', note: '自然 dither $<0.4$ LSB：近似式前提不成立（看精確值）' }
              : {
                  status: Math.abs(o.eq.deltaStar - o.eq.approxDeltaStar) <= Math.max(0.05 * Math.abs(o.eq.approxDeltaStar), 2e-3 * dp.sigmaV / 100) ? 'ok' : 'mismatch',
                  note: `近似式 $\\Delta_G/(2K)$ 給 ${o.eq.approxDeltaStar.toPrecision(5)} fs，精確 mean-field 給 ${o.eq.deltaStar.toPrecision(5)} fs`,
                },
        monteCarlo: { status: 'not-implemented', note: '位元級 Monte Carlo 見 Ch04 Fixed-Point Lab（gmac.ts）' },
        fixedPoint: {
          status: o.okPos.firstOverflow === null && o.okNeg.firstOverflow === null && (o.shortPos.firstOverflow !== null || o.shortNeg.firstOverflow !== null) ? 'ok' : 'mismatch',
          note: `bit-true 最壞情況累加：${o.bitsSel} bits 無溢位、${o.bitsSel - 1} bits 溢位（逐筆 wrap）`,
        },
      }
    : { analytic: { status: 'n/a', note: '尚未計算' }, monteCarlo: { status: 'n/a', note: '尚未計算' }, fixedPoint: { status: 'n/a', note: '尚未計算' } }

  return (
    <ExperimentShell
      id={GMAC_EXPERIMENT_ID}
      title="GMAC datapath 計算器：accumulator 位元數、wrap 與右移截斷偏差"
      level="L5"
      claim="exact"
      source="illustrative"
      description={
        <>
          有號 <Tex>{'B_x'}</Tex>-bit 的 <Tex>{'\\pm A'}</Tex> code（<Tex>{'A=2^{B_x-1}-1'}</Tex>）、Gaussian comparator。位元數與 wrap 以 bit-true 逐筆累加驗證；截斷偏差以下式的精確平均求平衡點：
          <TexBlock>{'S=A(2k-N),\\quad k\\sim\\mathrm{Binomial}\\bigl(N,\\,\\Phi(\\delta x_n/\\sigma_v)\\bigr)'}</TexBlock>
        </>
      }
      assumptions={[
        '$q\\,x$ 以條件取負實作；accumulator 為二補數、逐筆 wrap（未保護）',
        'average 以算術右移 $\\ell=\\log_2N-F_G$ bits 實作（$N$ 為 2 的冪）；floor 為二補數右移、half up 為先加 $2^{\\ell-1}$ 再右移',
        'code 為 $\\pm A$ iid（最大 symmetric 幅度），comparator 雜訊 Gaussian、與 code 獨立；平衡點為 mean-field（忽略 $w$ 的抖動）',
        '$\\sigma_w$ 對照值用線性化 $d=0$ 一階模型，未含截斷',
      ]}
      params={{ ...dp }}
      units={{ bx: 'bits', log2N: 'log2(samples)', gFracBits: 'bits', sigmaV: 'fs', mu: 'fs' }}
      metrics={metrics}
      warnings={out.err ? [`參數無效：${out.err}`] : o ? gmacWarnings(o, dp) : []}
      crossCheck={crossCheck}
      actions={{ onReset: () => setP(DEFAULT_GMAC_PARAMS) }}
      exportData={() => {
        if (!curve || !o) throw new Error('沒有結果')
        const get = (name: string) => (curve.data.find((t) => (t as { name?: string }).name === name) as { y: number[] }).y
        return {
          delta_fs: (curve.data[0] as { x: number[] }).x,
          E_G_ideal: get('無截斷 $E[G] = x_n(2\\Phi - 1)$'),
          E_Ghat_floor: get('floor 右移 $E[\\hat G]$'),
          E_Ghat_half_up: get('round half up $E[\\hat G]$'),
        }
      }}
      presets={presets}
      onLoadPreset={(pr) => setP({ ...DEFAULT_GMAC_PARAMS, ...(pr.params as Partial<GmacSizingParams>) })}
      controls={
        <>
          <ParamControl label={md('code 位元數 $B_x$')} ariaLabel="code 位元數 B_x" value={p.bx} onChange={(v) => set('bx', v)} min={2} max={16} step={1} integer clampOnBlur unit="bits" reg="RTL：GMAC 輸入 code 寬度" />
          <ParamControl
            label={md('$\\log_2N$')}
            ariaLabel="log2 N"
            value={p.log2N}
            onChange={(v) => set('log2N', v)}
            min={0}
            max={20}
            step={1}
            integer
            clampOnBlur
            unit="—"
            reg="REG_GMAC_N（2 的冪）"
            hint={md(`$N=${2 ** p.log2N}$`)}
          />
          <SelectControl
            label="code 範圍"
            value={p.range}
            onChange={(v) => set('range', v)}
            options={[
              { value: 'symmetric', label: 'symmetric（不含最負值）' },
              { value: 'full', label: 'full（含最負值）' },
            ]}
            reg="RTL：code 編碼範圍"
          />
          <SelectControl
            label="右移 rounding"
            value={p.rounding}
            onChange={(v) => set('rounding', v)}
            options={[
              { value: 'floor', label: 'floor（算術右移）' },
              { value: 'half_up', label: 'round half up' },
            ]}
            reg="RTL：GMAC normalize rounding"
          />
          <ParamControl
            label={md('保留小數 bit $F_G$')}
            ariaLabel="保留小數 bit F_G"
            value={p.gFracBits}
            onChange={(v) => set('gFracBits', v)}
            min={0}
            max={20}
            step={1}
            integer
            clampOnBlur
            unit="bits"
            reg="RTL：G 的 fractional bits"
            hint={md('$F_G\\ge\\log_2N$ 時不截斷')}
          />
          <ParamControl label={md('$\\sigma_v$（comparator 前雜訊）')} ariaLabel="sigma_v（comparator 前雜訊）" value={p.sigmaV} onChange={(v) => set('sigmaV', v)} min={0.1} max={1000} log unit="fs" reg="Behavioral：pd_noise_rms_fs" />
          <ParamControl label={md('$\\mu$（只用於 $\\sigma_w$ 對照）')} ariaLabel="mu（只用於 sigma_w 對照）" value={p.mu} onChange={(v) => set('mu', v)} min={0.001} max={1000} log unit="fs" reg="REG_CAL_MU（gain_step）" />
        </>
      }
    >
      {curve && (
        <Plot
          title="平均 GMAC 輸出 vs $\delta=a-w$：截斷讓過零點偏移"
          data={curve.data}
          layout={CURVE_LAYOUT}
          height={300}
          csvName="gmac-truncation"
          caption="floor 曲線比理想曲線整體低半個 LSB，過零點右移到 $\delta^*>0$（也就是 $w^*<a$）；half up 幾乎不偏。"
        />
      )}
      {o && (
        <p className="small">
          <Tex>{`N=${o.N}`}</Tex>、<Tex>{`\\max|q\\,x|=${Math.max(o.maxPos, o.maxNeg)}`}</Tex> LSB；{o.bitsSel}-bit 二補數範圍 <Tex>{`[-${2 ** (o.bitsSel - 1)},\\,${2 ** (o.bitsSel - 1) - 1}]`}</Tex>。
        </p>
      )}
    </ExperimentShell>
  )
}
