import { useDeferredValue, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import {
  Callout,
  ClaimTag,
  CodeCompare,
  ExperimentShell,
  ModeGate,
  ParamControl,
  Plot,
  Prereq,
  SelectControl,
  StepDerivation,
  Tex,
  useThemeTokens,
  type ExperimentPreset,
  type MetricRow,
} from '@/components'
import modelSrc from '../model.ts?raw'
import { analyzeEf, type EfRounding } from '../model'
import { ErratumNote, mergeParams, mt, n4, Observe, PageRef, pl, TryIt, useRoadmapPresets } from '../common'

const EXP_ID = 'roadmap-r3-ef'
const PATH = 'src/pages/roadmap/model.ts'

interface R3Params {
  mode: 'fixed' | 'rational'
  target: number
  fracBits: number
  num: number
  den: number
  rounding: EfRounding
  bits: number
}

const DEFAULTS: R3Params = { mode: 'rational', target: 32, fracBits: 10, num: 2, den: 5, rounding: 'nearest', bits: 6 }

const INLINE_PRESETS: ExperimentPreset[] = [
  { name: '精確有理數 32 + 2/5（規格 §13，T16）', params: { ...DEFAULTS }, description: '週期 5：[32, 33, 32, 33, 32]' },
  { name: '同一目標、floor rounding', params: { ...DEFAULTS, rounding: 'floor' }, description: '恰好是規格方法 B 的 [32, 32, 33, 32, 33]' },
  { name: '定點 F = 10 bits 表示 32.4', params: { ...DEFAULTS, mode: 'fixed', target: 32.4, fracBits: 10 }, description: '32.400390625，週期 512' },
  { name: '定點 F = 16 bits 表示 32.4', params: { ...DEFAULTS, mode: 'fixed', target: 32.4, fracBits: 16 }, description: '週期 32768：譜線很密、每根很小' },
  { name: '32 + 3/8', params: { ...DEFAULTS, num: 3, den: 8 }, description: '週期 8' },
]

// Plot 的 layout 是靜態的：放在模組層，避免每次 render 產生新物件而觸發 Plotly.react
const LAYOUT_CODE: Partial<Layout> = { xaxis: { title: { text: '$n$（code 更新）' } }, yaxis: { title: { text: 'code [LSB]' } } }
const LAYOUT_LINES: Partial<Layout> = { xaxis: { title: { text: '$f / f_u$' }, range: [0, 0.5] }, yaxis: { title: { text: '$|Y_k|/P$ [LSB]（$k \\ne P/2$ 時 peak 振幅是 2 倍）' } } }

function R3Experiment() {
  const [P, setP] = useState<R3Params>(DEFAULTS)
  const tokens = useThemeTokens()
  const presets = useRoadmapPresets(EXP_ID, INLINE_PRESETS, (pr) => setP((prev) => mergeParams(prev, pr)))
  const dP = useDeferredValue(P)
  const res = useMemo(
    () => analyzeEf({ mode: dP.mode, target: dP.target, fracBits: dP.fracBits, num: dP.num, den: dP.den, rounding: dP.rounding, bits: dP.bits }),
    [dP],
  )
  const S = res.S
  const target = dP.mode === 'rational' ? Math.floor(dP.target) + dP.num / Math.max(1, dP.den) : dP.target

  const warnings: string[] = []
  if (res.overload) warnings.push(String.raw`輸出 code 超出 ${dP.bits}-bit 範圍 $[0,\ ${2 ** dP.bits - 1}]$：quantizer overload，實際硬體會飽和、limit cycle 被打亂，平均不再等於 $w_H$。`)
  if (dP.mode === 'rational' && (dP.num < 0 || dP.num >= dP.den)) warnings.push(String.raw`分子必須滿足 $0\le\mathrm{num}<\mathrm{den}$（小數部分）；目前的設定等同改變整數部分。`)
  if (res.period > 4096) warnings.push(String.raw`週期 $P=${res.period}$ 很長：每根譜線很小、看起來像雜訊，但仍是決定性的 limit cycle（換 seed 不會變）。`)
  if (dP.mode === 'fixed' && Math.abs(res.represented - target) > 0)
    warnings.push(String.raw`$F=${dP.fracBits}$ bits 無法精確表示 ${target}：實際目標 ${res.represented}（誤差 ${n4(res.represented - target)} LSB），週期由表示值決定。`)

  const top = res.topLines[0]
  const topFold = top && 2 * top.k === res.period ? 1 : 2
  const parsevalOk = Math.abs(res.linePower - res.errorPower) <= 1e-9 * Math.max(1, res.errorPower)
  const metrics: MetricRow[] = [
    { name: '表示的目標 $w_H=W/S$', value: res.represented, unit: 'LSB', note: `$W=${res.W}$、$S=${S}$` },
    { name: String.raw`週期 $P$（量測：狀態第一次回到起點）`, value: res.period, unit: 'updates', analytic: res.periodTheory, tolerance: 0, formulaId: 'F-R3.1', claim: 'exact' },
    { name: '一個週期的平均', value: res.cycleMean, unit: 'LSB', analytic: res.represented, tolerance: 1e-12, formulaId: 'F-R3.1', claim: 'exact' },
    { name: String.raw`總量化誤差功率 $\overline{(y-w_H)^2}$`, value: res.errorPower, unit: String.raw`$\mathrm{LSB}^2$`, note: '全部是譜線（沒有連續雜訊）' },
    { name: String.raw`非 DC 譜線的功率和 $\sum_{k=1}^{P-1}|Y_k|^2/P^2$（Parseval）`, value: res.linePower, unit: String.raw`$\mathrm{LSB}^2$`, analytic: res.errorPower, tolerance: 1e-9, claim: 'exact' },
    { name: '最大譜線 $|Y_k|/P$', value: top?.mag ?? 0, unit: 'LSB', note: top ? `在 $${n4(top.fracFu)}\\,f_u$` : '' },
    {
      name: '最大譜線合成的實數 tone：peak 振幅',
      value: top ? topFold * top.mag : '無（輸出為常數）',
      unit: 'LSB',
      note: String.raw`$\pm k$ 兩條線合成一個實數 tone：peak $=2|Y_k|/P$（$k=P/2$ 時不乘 2）`,
    },
    {
      name: '最大譜線合成的實數 tone：功率',
      value: top ? topFold * top.mag * top.mag : '無（輸出為常數）',
      unit: String.raw`$\mathrm{LSB}^2$`,
      note: String.raw`$2|Y_k|^2/P^2$（$k=P/2$ 時不乘 2）；第 13 章與勘誤 E47 列的是 peak 與這個功率`,
    },
  ]

  const n = Math.min(Math.max(2 * res.cycle.length, 20), 160)
  const timeline: Data[] = useMemo(() => {
    const y = Array.from({ length: n }, (_, i) => res.cycle[i % res.cycle.length])
    return [
      { x: y.map((_, i) => i), y, name: '$y[n]$（6-bit code）', mode: 'lines+markers', line: { shape: 'hv', color: tokens.series[0] }, marker: { size: 4 } },
      { x: [0, n - 1], y: [res.represented, res.represented], name: '$w_H$', mode: 'lines', line: { dash: 'dash', color: tokens.textMuted } },
    ]
  }, [res, n, tokens])
  const lines = useMemo(() => (res.lines.length ? res.lines : res.topLines.map(({ fracFu, mag }) => ({ fracFu, mag }))), [res])
  const spec: Data[] = useMemo(
    () => [{ x: lines.map((l) => l.fracFu), y: lines.map((l) => l.mag), type: 'bar', name: '$|Y_k|/P$', marker: { color: tokens.series[1] }, width: lines.map(() => Math.max(0.004, 0.6 / res.period)) }],
    [lines, res.period, tokens],
  )

  return (
    <ExperimentShell
      id={EXP_ID}
      title="R3 預覽：一階 EF quantizer 的週期與譜線（整數實作）"
      level="L5"
      claim="exact"
      source="simulation"
      description={
        <>
          <Tex>{'v=w_H+r[n-1],\\ y=Q(v),\\ r[n]=v-y'}</Tex>，全部以整數 <Tex>{'W,R'}</Tex>（單位 <Tex>{'1/S'}</Tex> LSB）計算，不受浮點 tie 翻轉影響。
        </>
      }
      assumptions={['常數目標 $w_H$（LMS 已收斂且凍結）', '$r[-1]=0$；nearest 為 round-half-up', '頻率以 code 更新率 $f_u$ 為取樣率（未 ZOH 到 $f_s$，見第 13 章 E47）']}
      params={{ ...P }}
      units={{ target: 'LSB', fracBits: 'bits', bits: 'bits' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: { status: res.period === res.periodTheory && parsevalOk ? 'ok' : 'mismatch', note: String.raw`量測週期 vs $S/\gcd(W\bmod S,\ S)$；譜線功率和 vs 時域誤差功率（Parseval）` },
        monteCarlo: { status: 'n/a', note: '確定性計算，沒有隨機量' },
        fixedPoint: { status: 'ok', note: '本實作即整數 / 定點（$S=2^F$ 或分母）' },
      }}
      actions={{ onReset: () => setP(DEFAULTS) }}
      presets={presets}
      onLoadPreset={(pr) => setP((prev) => mergeParams(prev, pr.params))}
      exportData={() => ({ cycle_code: res.cycle, line_freq_over_fu: lines.map((l) => l.fracFu), line_mag_lsb: lines.map((l) => l.mag) })}
      controls={
        <>
          <SelectControl
            {...pl('$w_H$ 表示法', 'w_H 表示法')}
            value={P.mode}
            onChange={(mode) => setP({ ...P, mode })}
            options={[
              { value: 'rational', label: '精確有理數：整數 + 分子/分母' },
              { value: 'fixed', label: '定點：F 個小數 bit' },
            ]}
            reg="REG_GAIN_ACC 格式"
          />
          <ParamControl {...(P.mode === 'rational' ? pl('整數部分 $I$', '整數部分 I') : pl('$w_H$（目標）', 'w_H（目標）'))} value={P.target} onChange={(v) => setP({ ...P, target: v })} min={0} max={63} step={P.mode === 'rational' ? 1 : 0.001} integer={P.mode === 'rational'} unit="LSB" reg="REG_GAIN_TARGET（高解析 w_H）" />
          {P.mode === 'rational' ? (
            <>
              <ParamControl label="分子 num" value={P.num} onChange={(v) => setP({ ...P, num: v })} min={0} max={4095} integer clampOnBlur unit="—" reg="REG_GAIN_TARGET 小數部分（分子）" />
              <ParamControl label="分母 den" value={P.den} onChange={(v) => setP({ ...P, den: v })} min={1} max={4096} integer clampOnBlur unit="—" reg="REG_GAIN_TARGET 小數部分（分母）" />
            </>
          ) : (
            <ParamControl {...pl('$F$（小數 bits）', 'F（小數 bits）')} value={P.fracBits} onChange={(v) => setP({ ...P, fracBits: v })} min={0} max={16} integer clampOnBlur unit="bits" reg="REG_GAIN_ACC[F−1:0]" />
          )}
          <SelectControl
            {...pl('$Q$ rounding', 'Q rounding')}
            value={P.rounding}
            onChange={(rounding) => setP({ ...P, rounding })}
            options={[
              { value: 'nearest', label: 'nearest（round-half-up）' },
              { value: 'floor', label: 'floor（截斷）' },
            ]}
            reg="Q6 rounding mode"
          />
          <ParamControl label="code 位寬" value={P.bits} onChange={(v) => setP({ ...P, bits: v })} min={2} max={10} integer clampOnBlur unit="bits" reg="REG_GAIN_CODE 位寬" />
        </>
      }
    >
      <div className="rm-plots">
        <Plot title="輸出 code $y[n]$（重複兩個週期，最多 160 點）" data={timeline} layout={LAYOUT_CODE} height={280} csvName="r3-code" />
        <Plot
          title={res.lines.length ? '一個週期的譜線 $|Y_k|/P$' : `最大的 ${lines.length} 根譜線（$P=${res.period}$）`}
          data={spec}
          layout={LAYOUT_LINES}
          height={280}
          csvName="r3-lines"
        />
      </div>
    </ExperimentShell>
  )
}

export default function R3Preview() {
  return (
    <div className="rm-preview">
      <Prereq title="floor、round、mod 與 gcd">
        <p>
          <Tex>{'\\lfloor v\\rfloor'}</Tex> 是不大於 <Tex>{'v'}</Tex> 的最大整數；round-half-up 為 <Tex>{'\\lfloor v+\\tfrac12\\rfloor'}</Tex>。
          <Tex>{'a\\equiv b\\pmod S'}</Tex> 表示 <Tex>{'a-b'}</Tex> 是 <Tex>{'S'}</Tex> 的倍數。<Tex>{'nW\\equiv0\\pmod S'}</Tex> 的最小正整數解是 <Tex>{'n=S/\\gcd(W,S)'}</Tex>：例如 <Tex>{'W=2,S=5'}</Tex> 要 5 次、<Tex>{'W=410,S=1024'}</Tex> 要 512 次。
        </p>
      </Prereq>
      <StepDerivation
        title={mt(String.raw`一步一步推導：常數輸入的一階 EF quantizer 一定是週期 $S/\gcd(W\bmod S,\ S)$`)}
        steps={[
          { tex: String.raw`v[n]=w_H+r[n-1],\quad y[n]=Q(v[n]),\quad r[n]=v[n]-y[n]`, why: '規格 §13.4 的 error-feedback quantizer。' },
          { tex: String.raw`w_H=\frac WS,\ r[n]=\frac{R[n]}S\;\Rightarrow\;R[n]=W+R[n-1]-S\,y[n]`, why: <>兩邊乘 <Tex>{'S'}</Tex>；<Tex>{'W,R,y'}</Tex> 全是整數（定點 <Tex>{'S=2^F'}</Tex>，或有理數的分母）。</> },
          { tex: String.raw`R[n]\equiv R[n-1]+W\pmod S`, why: <><Tex>{'S\\,y[n]'}</Tex> 是 <Tex>{'S'}</Tex> 的倍數，在 mod S 下消失。</> },
          { tex: String.raw`R[n]\in[-\tfrac S2,\tfrac S2)\ (\text{nearest})\ \text{或}\ [0,S)\ (\text{floor})`, why: <>quantizer 的定義讓餘數落在長度 <Tex>{'S'}</Tex> 的固定區間，所以 <Tex>{'R[n]'}</Tex> 由它的 mod S 餘數唯一決定。</> },
          { tex: String.raw`R[n]\equiv R[-1]+(n+1)W\pmod S`, why: '把第 3 步反覆代入。' },
          { tex: String.raw`P=\min\{P>0:\ PW\equiv0\!\!\pmod S\}=\frac{S}{\gcd(W\bmod S,\ S)}`, why: '狀態第一次回到起點的步數。' },
          { tex: String.raw`\sum_{n=0}^{P-1}y[n]=\sum_{n=0}^{P-1}\big(w_H+r[n-1]-r[n]\big)=Pw_H+r[-1]-r[P-1]=Pw_H`, why: <>相鄰項相消（telescoping），且一個週期後 <Tex>{'r[P-1]=r[-1]'}</Tex>。</> },
        ]}
        result={String.raw`P=\frac{S}{\gcd(W\bmod S,\,S)},\qquad \frac1P\sum_{n=0}^{P-1}y[n]=w_H\qquad(\text{F-R3.1})`}
      />
      <p>
        <ClaimTag kind="exact" /> 平均<strong>恰好</strong>正確，但誤差全部集中在 <Tex>{'k\\,f_u/P'}</Tex> 的離散譜線上——不是白雜訊。rounding 方式與初值只改變循環的<strong>相位</strong>，不改變週期與譜線大小。
        <ErratumNote eid="E15">規格 §13.4 只說「可能」產生週期序列；常數有理輸入時其實必然週期。</ErratumNote>
      </p>
      <Callout kind="info" title="帶入手算：這三條公式的手算題在第 13 章">
        這個預覽用到的公式在 <PageRef id="ch13">第 13 章</PageRef>已經各有一題「帶入手算」，這裡不重複出題：
        <strong>HC-13.5</strong>（<Tex>{'v,\\ y,\\ r'}</Tex> 的表，一列一列量化並驗算 telescoping）、
        <strong>HC-13.6</strong>（精確分數與 <Tex>{'F'}</Tex> 個小數 bit 的週期 <Tex>{'S/\\gcd'}</Tex>）、
        <strong>HC-13.3</strong>（一個週期的譜線：複數 DFT 分實部／虛部計算）。在那裡用紙筆算完，再把同一組數字填進下面的實驗對答案。
      </Callout>
      <R3Experiment />
      <TryIt
        items={[
          String.raw`預設 $32+2/5$：週期 5、平均恰為 32.4、誤差功率 $0.24\ \mathrm{LSB}^2$（與 stochastic rounding 的 $p(1-p)$ 相同，只是全在譜線上）。`,
          String.raw`載入 preset「定點 $F=10$ bits 表示 32.4」：32.4 被表示成 32.400390625，週期變成 512，最大譜線落在約 $0.4\,f_u$。（只把表示法切到定點而不改目標時，目標仍是整數 32，週期是 1。）`,
          '把 rounding 改成 floor：循環變成規格方法 B 的 [32, 32, 33, 32, 33]——一階 ΔΣ 與 periodic toggle 是同一個東西。',
        ]}
      />
      <Observe>
        週期與平均都能用一行整數算術預測；R3 真正的研究題目是 <Tex>{'w_H'}</Tex> 隨 LMS 雜訊變動、二階／MASH quantizer、以及譜線經 code 混頻與 <Tex>{'T(f)'}</Tex> 之後的 spur。
      </Observe>
      <h4>核心程式碼</h4>
      <CodeCompare
        items={[
          { label: '整數 EF quantizer', source: modelSrc, region: 'efQuantizerInt', path: PATH, note: '只用整數加減與 floor。' },
          { label: '週期公式', source: modelSrc, region: 'efPeriod', path: PATH, note: String.raw`$S/\gcd(W\bmod S,\ S)$。` },
        ]}
        layout="tabs"
      />
      <ModeGate min="research">
        <h4>Research：為什麼一定要整數實作</h4>
        <p>
          浮點的 <Tex>{'32.4'}</Tex> 不是精確的 <Tex>{'162/5'}</Tex>；累加 <Tex>{'r[n]'}</Tex> 時捨入誤差可能讓某一步剛好落在 tie 的另一邊，循環的相位（甚至週期）就跟 golden model 不同。本站的 T16 golden vector 以精確 Fraction 產生；這裡的整數實作逐點吻合（見 model.test.ts）。
          <ErratumNote eid="E49">{String.raw`「Static error $-0.4$ LSB」的符號依 $\delta$ 的極性而定。`}</ErratumNote>
        </p>
      </ModeGate>
    </div>
  )
}
