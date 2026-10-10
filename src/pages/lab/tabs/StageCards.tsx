import { memo, useMemo } from 'react'
import { Callout, ClaimTag, ModelLevel, Tex } from '@/components'
import { bernoulliMoments, efbConstant, efbPeriod, toggleCycle } from '@/simulation/models/quantizer'
import type { CheckItem, PipelineChecks, PipelineResult, StageReport } from '@/simulation/models/unifiedLab'
import { ChLink, fmtHz, md, sig, StatusPill, texifyShared, texNum } from '../common'
import { isInformational } from '../logic'

const STAGE_LINK: Record<StageReport['id'], { to: string; label: string }[]> = {
  dsm: [{ to: '/ch/04', label: 'Ch04 residue' }],
  code: [{ to: '/ch/04', label: 'Ch04' }, { to: '/ch/11', label: 'Ch11 code centering' }],
  dtc: [{ to: '/ch/11', label: 'Ch11 Bias & INL' }],
  pll: [{ to: '/ch/06', label: 'Ch06 Polarity' }, { to: '/ch/07', label: 'Ch07 Filtered-x' }],
  comparator: [{ to: '/ch/05', label: 'Ch05 Comparator' }],
  gmac: [{ to: '/ch/04', label: 'Ch04 GMAC' }, { to: '/ch/09', label: 'Ch09 PE' }],
  register: [{ to: '/ch/13', label: 'Ch13 Quantization' }],
  update: [{ to: '/ch/08', label: 'Ch08 Phase Margin' }, { to: '/ch/14', label: 'Ch14 Optimizer' }],
  output: [{ to: '/ch/12', label: 'Ch12 Noise → Output' }],
}

/** 數值欄：頻率自動換成 kHz / MHz / GHz（單位欄就留白），其餘 6 位有效數字 */
function fmtValue(v: number | string | null, unit?: string): string {
  if (v === null) return '—'
  if (typeof v === 'string') return v
  if (unit === 'Hz') return fmtHz(v, 6)
  return sig(v, 6)
}

function StageCard({ s }: { s: StageReport }) {
  const hard = s.warnings.filter((w) => !isInformational(w))
  const info = s.warnings.filter((w) => isInformational(w))
  return (
    <section className="lab-stage" data-stage={s.id} aria-label={s.id}>
      <header className="lab-stage-head">
        <h4 className="lab-stage-title">{md(s.title)}</h4>
        <ModelLevel level={s.level} />
        <span className="lab-stage-links small">
          {STAGE_LINK[s.id].map((l) => (
            <ChLink key={l.to + l.label} to={l.to}>
              {l.label}
            </ChLink>
          ))}
        </span>
      </header>
      <div className="table-wrap">
        <table className="lab-table lab-stage-table">
          <tbody>
            {s.metrics.map((m, i) => (
              <tr key={`${m.name}-${i}`}>
                <th scope="row">
                  {md(m.name)}
                  {m.note && <div className="small muted">{md(m.note)}</div>}
                </th>
                <td className="mono lab-num">{typeof m.value === 'string' ? md(m.value) : fmtValue(m.value, m.unit)}</td>
                <td className="nowrap">{m.unit && !(m.unit === 'Hz' && typeof m.value === 'number') ? md(m.unit) : ''}</td>
                <td>{m.claim ? <ClaimTag kind={m.claim} /> : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hard.map((w, i) => (
        <Callout key={`w${i}`} kind="warn" title="這一級的警告">
          <p>{md(texifyShared(w))}</p>
        </Callout>
      ))}
      {info.map((w, i) => (
        <p key={`i${i}`} className="small muted lab-stage-info">
          註：{md(texifyShared(w))}
        </p>
      ))}
      <details className="lab-stage-assume">
        <summary className="small">這一級的假設（{s.assumptions.length}）</summary>
        <ul className="small">
          {s.assumptions.map((a, i) => (
            <li key={i}>{md(a)}</li>
          ))}
        </ul>
      </details>
    </section>
  )
}

/** 九級的報告卡片：每級顯示模型層級、指標（含結論標籤）、警告與假設。 */
export const StageCards = memo(function StageCards({ stages }: { stages: StageReport[] }) {
  return (
    <div className="lab-stages">
      {stages.map((s) => (
        <StageCard key={s.id} s={s} />
      ))}
    </div>
  )
})

const CHECK_ROWS: { key: keyof PipelineChecks; name: string; what: string }[] = [
  { key: 'replay', name: '跨級一致性（replay）', what: '獨立重寫的逐 sample 迴圈重算每個 $G_k$' },
  { key: 'code', name: 'code 統計', what: '$E[x]$、$E[x^2]$ vs 一階 DSM 封閉式' },
  { key: 'meanW', name: 'mean $w$', what: '後半段平均 vs mean-field 平均軌跡的同段預測（F-LAB.18）' },
  { key: 'sigmaW', name: '$\\sigma_w$', what: '後半段 $w$ 對平均軌跡的殘差 RMS vs $\\sigma_{w,\\mathrm{pred}}$（單一 seed）' },
  { key: 'noiseMix', name: 'gain noise × code', what: '$T\\{-\\delta w\\,x\\}$ 的 RMS vs $\\sigma_w\\sqrt{\\bar x^2+\\mathrm{Var}(T\\{\\tilde x\\})}$' },
  { key: 'spur', name: 'fractional spur', what: 'toneFit vs 封閉式 $|a-\\bar w|sA_1|T(f_1)|$' },
  { key: 'fixedPoint', name: '定點 vs 浮點', what: '同 seed 的浮點對照' },
]

const num = (v: number | undefined): string => (v === undefined ? '' : sig(v, 6))

/** 七項交叉比對的明細表（ExperimentShell 的三欄只是它的摘要）。 */
export const CheckTable = memo(function CheckTable({ checks }: { checks: PipelineChecks }) {
  return (
    <div className="table-wrap">
      <table className="lab-table">
        <thead>
          <tr>
            <th>檢查</th>
            <th>狀態</th>
            <th className="lab-num">模擬值</th>
            <th className="lab-num">解析值</th>
            <th>說明（含容差）</th>
          </tr>
        </thead>
        <tbody>
          {CHECK_ROWS.map((r) => {
            const c: CheckItem = checks[r.key]
            return (
              <tr key={r.key} data-check={r.key} data-status={c.status}>
                <th scope="row">
                  {md(r.name)}
                  <div className="small muted">{md(r.what)}</div>
                </th>
                <td>
                  <StatusPill status={c.status} />
                </td>
                <td className="mono lab-num">{num(c.value)}</td>
                <td className="mono lab-num">{num(c.analytic)}</td>
                <td className="small">{md(c.note)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
})

/**
 * 量化策略 what-if（開迴路，第 13 章的函式）：把「浮點收斂值 ÷ LSB」當成固定目標，比較 freeze / toggle / stochastic / 一階 ΔΣ。
 * 閉迴路裡只有 rounding（blockLms）；這張表回答「如果改用別的策略把同一個目標送到 6-bit code 會怎樣」。
 */
export function QuantWhatIf({ result }: { result: PipelineResult }) {
  const p = result.params
  const rows = useMemo(() => {
    const target = (result.floatTwin ? result.floatTwin.meanW : result.metrics.meanW) / p.lsbFs
    if (!Number.isFinite(target)) return null
    const lo = p.signedReg ? -(2 ** (p.physicalBits - 1)) : 0
    const hi = p.signedReg ? 2 ** (p.physicalBits - 1) - 1 : 2 ** p.physicalBits - 1
    const inRange = target >= lo && target <= hi
    const frozen = Math.min(hi, Math.max(lo, Math.round(target)))
    const base = Math.floor(target)
    const frac = target - base
    const bern = bernoulliMoments(base, frac)
    const cyc = toggleCycle(target, 5)
    const cycMean = cyc.reduce((a, b) => a + b, 0) / cyc.length
    // 第 13 章的 EFB 量化器是 unsigned code：目標為負或超出範圍時不算（表格顯示「—」）
    const efb = inRange && target >= 0 ? efbConstant({ target, steps: 12, bits: Math.max(p.physicalBits, 6) }) : null
    return { target, lo, hi, inRange, frozen, frac, bern, cyc, cycMean, efb, period: efb ? efbPeriod(efb.W, efb.D) : NaN }
  }, [result, p.lsbFs, p.physicalBits, p.signedReg])
  if (!rows) return null
  const lsb = p.lsbFs
  return (
    <div className="lab-whatif">
      <h4>
        量化策略 what-if（開迴路）：目標 <Tex>{`w_H/\\Delta=${texNum(rows.target, 6)}\\ \\mathrm{LSB}`}</Tex>
      </h4>
      <p className="small">
        閉迴路模擬只用 rounding。這裡把同 seed 浮點的收斂值當成固定目標，用第 13 章的函式（<code>toggleCycle</code>、<code>bernoulliMoments</code>、<code>efbConstant</code>）算四種策略的平均誤差與誤差功率；頻譜與
        spur 的比較在 <ChLink to="/ch/13">第 13 章</ChLink>。
      </p>
      {!rows.inRange && (
        <Callout kind="warn" title="目標超出 code 範圍">
          <p>
            <Tex>{`w_H/\\Delta=${texNum(rows.target, 5)}`}</Tex> 不在 <Tex>{`[${rows.lo},\\,${rows.hi}]`}</Tex> 內：任何策略都會飽和在端點，靜態誤差無法消除（要換 LSB、位元數或 signed）。
          </p>
        </Callout>
      )}
      <div className="table-wrap">
        <table className="lab-table">
          <thead>
            <tr>
              <th>策略</th>
              <th>輸出</th>
              <th className="lab-num">
                平均誤差 <Tex>{'[\\mathrm{LSB}]'}</Tex>
              </th>
              <th className="lab-num">
                平均誤差 <Tex>{'[\\mathrm{fs}]'}</Tex>
              </th>
              <th className="lab-num">
                誤差變異 <Tex>{'[\\mathrm{LSB}^2]'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">A：freeze（最近 code）</th>
              <td className="mono">{rows.frozen}</td>
              <td className="mono lab-num">{sig(rows.frozen - rows.target, 4)}</td>
              <td className="mono lab-num">{sig((rows.frozen - rows.target) * lsb, 4)}</td>
              <td className="mono lab-num">0（全在 DC）</td>
            </tr>
            <tr>
              <th scope="row">B：週期 5 的 toggle</th>
              <td className="mono">{rows.cyc.join(', ')}</td>
              <td className="mono lab-num">{sig(rows.cycMean - rows.target, 4)}</td>
              <td className="mono lab-num">{sig((rows.cycMean - rows.target) * lsb, 4)}</td>
              <td className="mono lab-num">{sig(rows.cyc.reduce((a, v) => a + (v - rows.cycMean) ** 2, 0) / rows.cyc.length, 4)}</td>
            </tr>
            <tr>
              <th scope="row">C：stochastic rounding</th>
              <td className="mono">
                {Math.floor(rows.target)} / {Math.floor(rows.target) + 1}，<Tex>{`P=${texNum(rows.frac, 4)}`}</Tex>
              </td>
              <td className="mono lab-num">0</td>
              <td className="mono lab-num">0</td>
              <td className="mono lab-num">{sig(rows.bern.variance, 4)}</td>
            </tr>
            <tr>
              <th scope="row">
                D：一階 <Tex>{'\\Delta\\Sigma'}</Tex>（error feedback）
              </th>
              <td className="mono">{rows.efb ? `${rows.efb.y.slice(0, 10).join(', ')}…（目標的有理近似下，週期 ${rows.period}）` : '—（目標超出 unsigned 範圍）'}</td>
              <td className="mono lab-num">0</td>
              <td className="mono lab-num">0</td>
              <td className="mono lab-num">{sig(rows.bern.variance, 4)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">
        C、D 的長期平均等於目標（誤差 0），誤差變異同為 <Tex>{'p(1-p)'}</Tex>（<Tex>{'p'}</Tex> 是小數部分）；差別只在頻譜：C 是白的，D 被推到高頻但在有理目標下是週期序列（有譜線）。B 的平均只能是{' '}
        <Tex>{'1/5'}</Tex> LSB 的倍數。
      </p>
    </div>
  )
}
