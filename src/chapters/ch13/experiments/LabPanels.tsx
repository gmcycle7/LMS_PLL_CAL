import { useMemo } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { ClaimTag, Plot, Tex, type ThemeTokens, ChapterErratum } from '@/components'
import { isRotation, pllT2, STRATEGY_LABEL, type QuantLabResult, type StrategyRun } from '@/simulation/models/quantizer'
import { STRATEGY_COLOR, SpurAt, Unit, db, fx, n, ntex, num, texLabel } from '../common'

export interface CaseView {
  id: string
  seriesIndex: number
  run: StrategyRun
}

/** Case 名稱的文字部分（策略名稱、LMS 雜訊）；$N_\mathrm{upd}$ 另外處理（圖例用 caseTex，表格用 CaseName）。 */
function caseHead(c: CaseView): string {
  return `Case ${c.id}：${STRATEGY_LABEL[c.run.strategy]}${c.run.lmsNoise ? '（LMS 雜訊）' : ''}`
}

/** 圖例用的 Case 名稱：數學寫成 `$...$`，由 Plot 轉成斜體符號與上下標。 */
function caseTex(c: CaseView): string {
  return `${texLabel(caseHead(c))}${c.run.nUpd > 1 ? String.raw`，$N_\mathrm{upd}=${c.run.nUpd}$` : ''}`
}

/** 表格裡的 Case 名稱（$N_\mathrm{upd}$ 用 KaTeX 排版）。 */
function CaseName({ c }: { c: CaseView }) {
  return (
    <>
      {caseHead(c)}
      {c.run.nUpd > 1 && (
        <>
          ，<Tex>{String.raw`N_\mathrm{upd}=${c.run.nUpd}`}</Tex>
        </>
      )}
    </>
  )
}

/** code 時間軸：6-bit code、內部 w_H、ΔΣ 量化器輸入 v 與 r。 */
export function TimelinePanel({ run, tokens }: { run: StrategyRun; tokens: ThemeTokens }) {
  const isDs = run.strategy === 'deltaSigma' || run.strategy === 'deltaSigmaDither'
  const data = useMemo<Data[]>(() => {
    const t = run.trace
    const out: Data[] = [
      { x: t.n, y: t.y, name: String.raw`$y[n]$（6-bit code）`, mode: 'lines', line: { shape: 'hv', color: tokens.series[STRATEGY_COLOR[run.strategy]], width: 2 } },
      { x: t.n, y: t.wH, name: String.raw`$w_H[n]$（內部高解析）`, mode: 'lines', line: { color: tokens.textMuted, width: 1 } },
      { x: t.n, y: t.wStar, name: String.raw`$w^*[n]$`, mode: 'lines', line: { color: tokens.text, width: 1, dash: 'dot' } },
    ]
    if (isDs) out.push({ x: t.n, y: t.v, name: String.raw`$v[n] = w_H + r[n-1]$（accumulator）`, mode: 'markers', marker: { size: 4, color: tokens.series[2] } })
    return out
  }, [run, tokens, isDs])
  const rData = useMemo<Data[]>(
    () => [{ x: run.trace.n, y: run.trace.r, name: String.raw`$r[n]$`, mode: 'lines+markers', marker: { size: 3 }, line: { color: tokens.series[4], width: 1 } }],
    [run, tokens],
  )
  return (
    <>
      <Plot
        title={`Code timeline（${texLabel(STRATEGY_LABEL[run.strategy])}，前 ${run.trace.n.length} 次更新）`}
        ariaLabel={`Code timeline（${STRATEGY_LABEL[run.strategy]}，前 ${run.trace.n.length} 次更新）`}
        data={data}
        height={280}
        csvName="ch13-lab-timeline"
        layout={{ xaxis: { title: { text: String.raw`$n$（code 更新）` } }, yaxis: { title: { text: 'LSB' } } }}
      />
      {isDs && (
        <Plot
          title={String.raw`ΔΣ 內部誤差 $r[n]$（沒有 overload 時有界）`}
          ariaLabel="ΔΣ 內部誤差 r[n]（沒有 overload 時有界）"
          data={rData}
          height={200}
          csvName="ch13-lab-residual"
          layout={{ xaxis: { title: { text: String.raw`$n$` } }, yaxis: { title: { text: String.raw`$r$ [LSB]` } } }}
        />
      )}
    </>
  )
}

/** code 直方圖（機率）。 */
export function HistogramPanel({ cases, tokens }: { cases: CaseView[]; tokens: ThemeTokens }) {
  const data = useMemo<Data[]>(
    () =>
      cases.map((c) => {
        const total = c.run.hist.counts.reduce((a, b) => a + b, 0)
        return {
          type: 'bar',
          x: c.run.hist.codes,
          y: c.run.hist.counts.map((k) => k / total),
          name: caseTex(c),
          marker: { color: tokens.series[c.seriesIndex] },
        }
      }),
    [cases, tokens],
  )
  return (
    <Plot
      title="Code 直方圖（各 code 出現的比例）"
      data={data}
      height={240}
      csvName="ch13-lab-histogram"
      layout={{ barmode: 'group', xaxis: { title: { text: String.raw`code $y$` }, dtick: 1 }, yaxis: { title: { text: '比例' } } }}
    />
  )
}

/** code 誤差 PSD（A/B/C 疊圖 + 理論 + LMS 地板）。 */
export function PsdPanel({ cases, tokens, active }: { cases: CaseView[]; tokens: ThemeTokens; active?: CaseView }) {
  const data = useMemo<Data[]>(() => {
    const out: Data[] = []
    for (const c of cases) {
      const ps = c.run.psd
      out.push({ x: ps.f, y: ps.psd, name: caseTex(c), line: { color: tokens.series[c.seriesIndex], width: 1.2 } })
      if (ps.theory) out.push({ x: ps.f, y: ps.theory, name: `Case ${c.id} 理論`, line: { color: tokens.series[c.seriesIndex], width: 1, dash: 'dash' } })
      if (ps.lmsRef) out.push({ x: ps.f, y: ps.lmsRef, name: String.raw`Case ${c.id} LMS 地板 $S_{\delta w}$`, line: { color: tokens.textMuted, width: 1, dash: 'dot' } })
    }
    // Spur 標記（規格 §13.6 的互動項目）：把目前 Case 譜線表的每條線標在 Welch 曲線上（取該頻率附近 ±2 bins 的最大值）
    if (active && active.run.lines.length) {
      const ps = active.run.psd
      const xs: number[] = []
      const ys: number[] = []
      const labels: string[] = []
      for (const l of active.run.lines.slice(0, 8)) {
        if (!(l.f > 0) || l.f > active.run.fu / 2) continue
        const i0 = Math.round(l.f / ps.df)
        let peak = 0
        for (let i = Math.max(1, i0 - 2); i <= Math.min(ps.psd.length - 1, i0 + 2); i++) if (ps.psd[i] > peak) peak = ps.psd[i]
        if (!(peak > 0)) continue
        xs.push(l.f)
        ys.push(peak)
        labels.push(String.raw`${l.k !== null ? `$k = ${l.k}$，` : ''}線功率 $${ntex(l.power, 4)}\,\mathrm{LSB}^2$`)
      }
      if (xs.length)
        out.push({
          x: xs,
          y: ys,
          text: labels,
          name: `Spur 標記（Case ${active.id} 的譜線表）`,
          mode: 'markers',
          marker: { symbol: 'triangle-down', size: 10, color: tokens.series[active.seriesIndex], line: { color: tokens.text, width: 1 } },
          hovertemplate: '%{x:.5g} Hz<br>%{text}<extra></extra>',
        })
    }
    return out
  }, [cases, tokens, active])
  const ps = cases[0]?.run.psd
  const allZero = cases.every((c) => c.run.metrics.errVar < 1e-18)
  return (
    <>
      <Plot
        title={String.raw`Code 誤差 $e=y-w^*$ 的 PSD（Welch）`}
        ariaLabel="Code 誤差 e = y − w* 的 PSD（Welch）"
        data={data}
        height={300}
        xLog
        yLog
        csvName="ch13-lab-psd"
        layout={{ xaxis: { title: { text: String.raw`$f$ [Hz]（以 $f_u$ 取樣）` } }, yaxis: { title: { text: String.raw`PSD [$\mathrm{LSB}^2/\mathrm{Hz}$]` } } }}
        caption={
          ps
            ? (
                <>
                  Welch：{ps.window}、nperseg {ps.nperseg}、{ps.nSegments} 段、ENBW {n(ps.enbwHz, 4)} Hz、<Tex>{String.raw`\Delta f=${ntex(ps.df, 4)}\,\mathrm{Hz}`}</Tex>、one-sided、<Tex>{String.raw`\mathrm{LSB}^2/\mathrm{Hz}`}</Tex>
                  、每段去平均（DC 誤差另列於指標表）。譜線的 PSD 高度取決於 ENBW；線功率請看譜線表。
                </>
              )
            : undefined
        }
      />
      {ps && ps.warnings.length > 0 && <p className="small muted">Welch 設定調整：{ps.warnings.join('；')}</p>}
      {allZero && <p className="small muted">所有 case 的誤差都是常數（例如 Freeze）：去平均後 <Tex>{String.raw`\mathrm{PSD}\equiv0`}</Tex>，誤差全部在 DC（見 DC 誤差指標）。</p>}
    </>
  )
}

/** 譜線表（精確 DFT 或 Welch 偵測）與 ZOH 線。 */
export function SpurTable({ run, lsbFs }: { run: StrategyRun; lsbFs: number }) {
  return (
    <div className="ch13-spur">
      <div className="small">
        <strong>Spur table</strong>（{STRATEGY_LABEL[run.strategy]}）：
        {run.linesExact ? (
          <>
            一個完整週期的精確 DFT <ClaimTag kind="exact" />
          </>
        ) : (
          <>
            Welch + significantTones（prominence <Tex>{String.raw`\ge15\,\mathrm{dB}`}</Tex>，且峰值高於局部雜訊平均的 <Tex>{String.raw`\chi^2_\nu`}</Tex> <Tex>{String.raw`6\sigma`}</Tex> 門檻；Hann 主瓣 <Tex>{String.raw`\pm2`}</Tex> bins）<ClaimTag kind="approx" />
          </>
        )}
      </div>
      {run.lines.length === 0 ? (
        <p className="small muted">沒有統計顯著的譜線（誤差為常數，或為白色 / 連續頻譜）。</p>
      ) : (
        <div className="table-wrap">
          <table className="ch13-table" aria-label="code 誤差的譜線表：頻率、諧波編號與線功率">
            <thead>
              <tr>
                <th>#</th>
                <th>
                  <Tex>{'f'}</Tex> [Hz]
                </th>
                <th>
                  <Tex>{'f/f_u'}</Tex>
                </th>
                <th>
                  <Tex>{'k'}</Tex>
                </th>
                <th>
                  線功率 <Tex>{'P_k'}</Tex> <Unit>{'LSB^2'}</Unit>
                </th>
                <th>
                  <Tex>{String.raw`10\log_{10}P_k`}</Tex> [dB]
                </th>
                <th>
                  <Tex>{String.raw`P_k\,\Delta_\mathrm{LSB}^2`}</Tex> <Unit>{'fs^2'}</Unit>
                </th>
              </tr>
            </thead>
            <tbody>
              {run.lines.slice(0, 8).map((l, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{num(l.f, 5)}</td>
                  <td>{fx(l.f / run.fu, 5)}</td>
                  <td>{l.k ?? '—'}</td>
                  <td>{num(l.power, 4)}</td>
                  <td>{db(l.power)}</td>
                  <td>{num(l.power * lsbFs * lsbFs, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {run.zohLines && run.zohLines.length > 0 && (
        <>
          <div className="small">
            ZOH 到 <Tex>{String.raw`f_s=N_\mathrm{upd}f_u`}</Tex> 後的線（<Tex>{String.raw`\mathrm{sinc}^2`}</Tex> 權重，勘誤 E47） <ClaimTag kind="exact" />
          </div>
          <div className="table-wrap">
            <table className="ch13-table" aria-label="code 以 ZOH 保持到 f_s 後的譜線">
              <thead>
                <tr>
                  <th>
                    <Tex>{'k'}</Tex>
                  </th>
                  <th>
                    <Tex>{'f'}</Tex> [Hz]
                  </th>
                  <th>
                    線功率 <Tex>{String.raw`P_k^{\mathrm{ZOH}}`}</Tex> <Unit>{'LSB^2'}</Unit>
                  </th>
                </tr>
              </thead>
              <tbody>
                {run.zohLines.slice(0, 8).map((l) => (
                  <tr key={l.k ?? 0}>
                    <td>{l.k}</td>
                    <td>{num(l.f, 5)}</td>
                    <td>{num(l.power, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/** Limit-cycle period detector。 */
export function PeriodPanel({ run }: { run: StrategyRun }) {
  const m = run.metrics
  const match = m.periodAnalytic !== null && m.period === m.periodAnalytic
  return (
    <div className="ch13-period card">
      <div className="small">
        <strong>Limit-cycle period detector</strong>（比較整數 code 序列，從第 L/4 個 sample 起、至少重複 2 次；勘誤 E15）
      </div>
      <ul className="small">
        <li>
          偵測週期：<strong className="ch13-period-detected">{m.period > 0 ? m.period : '未偵測到（非週期或 > 上限）'}</strong>；可偵測上限 {m.periodLimit}
        </li>
        <li>
          解析週期：{m.periodAnalytic ?? '—'}
          {m.periodAnalytic !== null && m.periodAnalytic <= m.periodLimit && (
            <span className={match ? 'ch13-ok' : 'ch13-bad'}>{match ? ' ✓ 一致' : ' ✗ 不一致'}</span>
          )}
          {m.periodAnalytic !== null && m.periodAnalytic > m.periodLimit && (
            <span className="small muted">（解析週期超過可偵測上限：紀錄太短，偵測到的只是局部近似週期）</span>
          )}
        </li>
        {run.cycle && <li>一個週期的 code：[{run.cycle.join(', ')}]</li>}
        <li>
          格點：{run.grid.arithmetic}
          {run.grid.q ? (
            <>
              （<Tex>{String.raw`w^*=${run.grid.p}/${run.grid.q}`}</Tex>，以 <Tex>{String.raw`1/(${run.grid.q}\cdot2^{16})\,\mathrm{LSB}`}</Tex> 為單位的整數運算）
            </>
          ) : run.grid.arithmetic === 'fixed' ? (
            <>
              （<Tex>{String.raw`w_H=${run.grid.W0}/${run.grid.D}=${run.grid.represented}`}</Tex>）
            </>
          ) : (
            '（IEEE double）'
          )}
        </li>
        {run.bitTrue && (
          <li>
            與精確 rational 模型逐點比較：{run.bitTrue.mismatches === 0 ? '完全相同' : `${run.bitTrue.mismatches} 個 sample 不同，第一個在 n = ${run.bitTrue.firstIndex}`}
          </li>
        )}
      </ul>
    </div>
  )
}

/** Mixing：δt PSD 與 |T|²。 */
export function MixingPanel({ cases, tokens, bwHz, zeta }: { cases: CaseView[]; tokens: ThemeTokens; bwHz: number; zeta: number }) {
  const withMix = cases.filter((c) => c.run.mixing)
  const data = useMemo<Data[]>(() => {
    const out: Data[] = withMix.map((c) => ({
      x: c.run.mixing!.f,
      y: c.run.mixing!.psd,
      name: String.raw`${caseTex(c)}：$\sigma_\mathrm{out}=${ntex(c.run.mixing!.sigmaOutFs, 3)}\,\mathrm{fs}$`,
      line: { color: tokens.series[c.seriesIndex], width: 1.1 },
    }))
    if (withMix.length) {
      const f = withMix[0].run.mixing!.f
      const t2 = pllT2(f, bwHz, zeta)
      out.push({ x: f, y: Array.from(t2, (v) => 10 * Math.log10(Math.max(v, 1e-30))), name: String.raw`$|T(f)|^2$ [dB]（右軸）`, yaxis: 'y2', line: { color: tokens.textMuted, dash: 'dash', width: 1 } })
    }
    return out
  }, [withMix, tokens, bwHz, zeta])
  if (!withMix.length) return <p className="small muted">Mixing 已關閉（在控制面板開啟「DSM residue mixing」）。</p>
  const mx = withMix[0].run.mixing!
  return (
    <>
      <Plot
        title={String.raw`$\delta t=\Delta_\mathrm{LSB}\,(y-w^*)\,x[n]$ 的 PSD（$x$ 為 DSM residue）`}
        ariaLabel="timing error δt 的 PSD：code 誤差乘上 DSM residue"
        data={data}
        height={300}
        xLog
        yLog
        csvName="ch13-lab-mixing"
        layout={{
          xaxis: { title: { text: String.raw`$f$ [Hz]（以 $f_s$ 取樣）` } },
          yaxis: { title: { text: String.raw`$S_{\delta t}$ [$\mathrm{fs}^2/\mathrm{Hz}$]` } },
          yaxis2: { title: { text: String.raw`$|T|^2$ [dB]` }, overlaying: 'y', side: 'right', showgrid: false, range: [-80, 5] },
        }}
        caption={
          <>
            Welch：Hann、nperseg {mx.nperseg}、ENBW {n(mx.enbwHz, 4)} Hz、one-sided、<Tex>{String.raw`\mathrm{fs}^2/\mathrm{Hz}`}</Tex>、每段去平均（顯示用 log max-hold 抽點）；第一個 Case 用 {mx.samples} 個 reference
            cycle（<Tex>{String.raw`=\min(\text{mixing 樣本上限},\ L\cdot N_\mathrm{upd})`}</Tex>）、涵蓋 {mx.codesUsed} 次 code 更新。<Tex>{'T(f)'}</Tex>：CT 二階原型（<Tex>{String.raw`f\ll f_s`}</Tex> 時才準）
            <ClaimTag kind="approx" />。
          </>
        }
      />
      <div className="table-wrap">
        <table className="ch13-table" aria-label="各 Case 的 timing error RMS、經 PLL 後的 output jitter 與最大 tone">
          <thead>
            <tr>
              <th>Case</th>
              <th>
                <Tex>{String.raw`\sigma_{\delta t}`}</Tex>（未經 PLL）<Unit>{'fs'}</Unit>
              </th>
              <th>
                <Tex>{String.raw`\sigma_\mathrm{out}=\sqrt{\textstyle\int_{f_L}|T|^2S_{\delta t}^{(1)}\,df}`}</Tex> <Unit>{'fs'}</Unit>
              </th>
              <th>
                積分下限 <Tex>{'f_L'}</Tex> [Hz]
              </th>
              <th>
                慢變成分（<Tex>{'f<f_L'}</Tex>）RMS <Unit>{'fs'}</Unit>
              </th>
              <th>
                靜態偏移 <Tex>{String.raw`\overline{\delta t}`}</Tex> <Unit>{'fs'}</Unit>
              </th>
              <th>
                <Tex>{String.raw`\delta t`}</Tex> 最大 tone <Unit>{'fs^2'}</Unit> @ <Tex>{'f'}</Tex>
              </th>
              <th>
                reference cycles／Welch 段數／混頻週期 <Tex>{String.raw`\mathrm{lcm}(P_\mathrm{code}N_\mathrm{upd},P_\mathrm{DSM})`}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {withMix.map((c) => (
              <tr key={c.id}>
                <td>
                  <CaseName c={c} />
                </td>
                <td>{num(c.run.mixing!.sigmaRawFs, 4)}</td>
                <td>{num(c.run.mixing!.sigmaOutFs, 4)}</td>
                <td>{num(c.run.mixing!.fLowHz, 4)}</td>
                <td>{c.run.mixing!.slowRmsFs === null ? '—（紀錄太短）' : num(c.run.mixing!.slowRmsFs, 3)}</td>
                <td>{num(c.run.mixing!.meanFs, 3)}</td>
                <td>{c.run.mixing!.maxTone ? <>{num(c.run.mixing!.maxTone.power, 3)} @ {num(c.run.mixing!.maxTone.f, 4)} Hz</> : '—'}</td>
                <td>
                  {c.run.mixing!.samples}／{c.run.mixing!.nSegments}／
                  {c.run.mixing!.productPeriod === null ? '—' : <span className={c.run.mixing!.productPeriod > c.run.mixing!.samples ? 'ch13-bad' : undefined}>{c.run.mixing!.productPeriod}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        <Tex>{String.raw`\sigma_\mathrm{out}`}</Tex> 只含 <Tex>{String.raw`f\ge f_L=f_s/N_\mathrm{seg}`}</Tex> 的成分（Welch 每段去平均）。比 <Tex>{'f_L'}</Tex> 慢的成分另外列出：整段平均{' '}
        <Tex>{String.raw`\overline{\delta t}`}</Tex> 是靜態 timing 偏移（PLL 會吸收，不算 jitter）；「慢變成分」是不重疊區塊平均的 RMS（至少 4 個區塊才估計），它落在 PLL 通帶內但<strong>沒有</strong>計入{' '}
        <Tex>{String.raw`\sigma_\mathrm{out}`}</Tex>。各 Case 的 <Tex>{String.raw`N_\mathrm{upd}`}</Tex> 不同時紀錄長度與 <Tex>{'f_L'}</Tex> 也可能不同（見最後一欄），比較前請先把 <Tex>{'L'}</Tex> 設到讓 reference cycle 數相同。最後一欄的混頻週期（code 為週期序列、一階 DSM
        時才有）若比紀錄長（紅字），最慢的差頻分辨不出來、只會出現在「靜態偏移」，<Tex>{String.raw`\sigma_\mathrm{out}`}</Tex> 會低估（§13.5b 的 FCW 陷阱）。
      </p>
    </>
  )
}

/** 五策略比較（同一情境、同 seed）。 */
export function ComparePanel({ result, tokens, lsbFs }: { result: QuantLabResult; tokens: ThemeTokens; lsbFs: number }) {
  const data = useMemo<Data[]>(
    () =>
      result.compare
        .filter((r) => r.metrics.errVar > 1e-18)
        .map((r) => ({ x: r.psd.f, y: r.psd.psd, name: texLabel(STRATEGY_LABEL[r.strategy]), line: { color: tokens.series[STRATEGY_COLOR[r.strategy]], width: 1.1 } })),
    [result, tokens],
  )
  const scen = result.compareScenario
  // 勘誤 E15 的 acceptance check（常數情境）：D 的穩態循環必須是 B 的循環移位，而且最大譜線相同
  const B = result.compare.find((r) => r.strategy === 'toggle')
  const D = result.compare.find((r) => r.strategy === 'deltaSigma')
  const constant = B?.theory != null && D?.theory != null
  const shift = constant && B?.cycle && D?.cycle ? isRotation(D.cycle, B.cycle) : -1
  const sameLine = !!B?.metrics.maxSpur && !!D?.metrics.maxSpur && Math.abs(B.metrics.maxSpur.power - D.metrics.maxSpur.power) < 1e-12
  return (
    <>
      {constant && B && D && (
        <p className="small" data-testid="ch13-accept-db">
          <strong>Acceptance check（<ChapterErratum id="E15" />）：</strong>
          {shift >= 0 && sameLine ? (
            <span className="ch13-ok">
              ✓ D ≡ B：D 的循環 [{D.cycle?.join(', ')}] 是 B 的循環 [{B.cycle?.join(', ')}] 的循環移位（移 {shift} 格），週期 {D.metrics.period}、最大譜線功率相同。
            </span>
          ) : (
            <span className="ch13-bad">
              ✗ D 與 B 不是同一個循環（B 週期 {B.metrics.period || '—'}、D 週期 {D.metrics.period || '—'}）：toggle 的 pattern 只能表示 <Tex>{'h/L_t'}</Tex>，或 D 發生 overload / 定點週期與 B
              不同。
            </span>
          )}
        </p>
      )}
      <div className="table-wrap">
        <table className="ch13-table ch13-table-wide" aria-label="同一情境、同一 seed 下五種量化策略的總表">
          <thead>
            <tr>
              <th>策略</th>
              <th>
                DC 誤差 <Tex>{String.raw`\delta w`}</Tex> <Unit>{'LSB'}</Unit>
              </th>
              <th>
                DC 誤差 <Unit>{'fs'}</Unit>
              </th>
              <th>
                總功率 <Unit>{'LSB^2'}</Unit>
              </th>
              <th>
                頻帶內 <Tex>{'e'}</Tex> <Unit>{'LSB^2'}</Unit>
              </th>
              <th>
                頻帶內量化誤差 <Tex>{String.raw`\epsilon`}</Tex> <Unit>{'LSB^2'}</Unit>
              </th>
              <th>
                LMS 地板 <Unit>{'LSB^2'}</Unit>
              </th>
              <th>
                最大譜線 <Unit>{'LSB^2'}</Unit>
              </th>
              <th>週期</th>
              <th>切換率</th>
              <th>
                追蹤誤差（後 1/4）<Unit>{'LSB'}</Unit>
              </th>
              <th>
                <Tex>{String.raw`\sigma_\mathrm{out}`}</Tex> <Unit>{'fs'}</Unit>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.compare.map((r) => (
              <tr key={r.strategy}>
                <td className="nowrap">{STRATEGY_LABEL[r.strategy]}</td>
                <td>{fx(r.metrics.dcError, 4)}</td>
                <td>{fx(r.metrics.dcError * lsbFs, 4)}</td>
                <td>{fx(r.metrics.errPower, 4)}</td>
                <td>
                  {num(r.metrics.lfErrPower, 3)}
                  {r.metrics.lfExact ? '' : '*'}
                </td>
                <td>{r.strategy === 'freeze' && r.lmsNoise ? '—' : num(r.metrics.lfQuantPower, 3)}</td>
                <td>{r.lmsNoise ? num(r.metrics.lfLmsPower, 3) : '—'}</td>
                <td>{r.metrics.maxSpur ? <SpurAt power={r.metrics.maxSpur.power} fRel={r.metrics.maxSpur.f / r.fu} fDigits={4} /> : '—'}</td>
                <td>{r.metrics.period || '無'}</td>
                <td>{fx(r.metrics.toggleRate, 3)}</td>
                <td>{fx(r.metrics.trackDcError, 4)}</td>
                <td>{r.mixing ? num(r.mixing.sigmaOutFs, 3) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        情境：{scen.lmsNoise ? <>含 LMS 雜訊的 <Tex>{'w_H'}</Tex></> : <>常數 <Tex>{'w_H'}</Tex></>}、<Tex>{String.raw`N_\mathrm{upd}=${scen.nUpd}`}</Tex>（跟隨目前選取的 Case）。頻帶內{' '}
        <Tex>{String.raw`=\mathrm{DC}^2+\int_0^{f_u/64}S\,df`}</Tex>，<Tex>{'e=y-w^*'}</Tex>、<Tex>{String.raw`\epsilon=y-w_H`}</Tex>；* 為 Welch 估計，其餘為一個週期的精確線譜加總。Freeze 不追蹤{' '}
        <Tex>{'w_H'}</Tex>，所以時變情境不列 <Tex>{String.raw`\epsilon`}</Tex>。DC 誤差採 <Tex>{String.raw`\delta w=\overline y-w^*`}</Tex> 約定；依 §0 的 <Tex>{String.raw`\delta=a-w`}</Tex> 則正負號相反（<ChapterErratum id="E49" />），換成 fs 是乘{' '}
        <Tex>{String.raw`\Delta_\mathrm{LSB}`}</Tex>（<ChapterErratum id="E13" />）。
      </p>
      <Plot
        title="五策略的 code 誤差 PSD（同一情境、同 seed）"
        data={data}
        height={280}
        xLog
        yLog
        csvName="ch13-lab-compare-psd"
        layout={{ xaxis: { title: { text: String.raw`$f$ [Hz]` } }, yaxis: { title: { text: String.raw`PSD [$\mathrm{LSB}^2/\mathrm{Hz}$]` } } }}
        caption={
          <>
            Welch、Hann、one-sided、<Tex>{String.raw`\mathrm{LSB}^2/\mathrm{Hz}`}</Tex>、每段去平均（設定同上方 PSD 圖）。Freeze 的誤差為常數（去平均後 PSD 恆為 0）不畫；常數情境下若 acceptance check 通過，B 與 D 的曲線完全重疊（<ChapterErratum id="E15" />）。
          </>
        }
      />
    </>
  )
}
