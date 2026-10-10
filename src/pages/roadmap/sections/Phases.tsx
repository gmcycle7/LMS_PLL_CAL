import { Mermaid, TestBadge } from '@/components'
import { PHASES, PHASE_STATE_LABEL, phaseProgress } from '../data'
import { ErratumTag, PageRef, Rich } from '../common'

export const PHASE_CHART = `flowchart LR
  P0["P0 基礎"] --> P1["P1 數學"]
  P0 --> P3["P3 MIMO / Bias"]
  P1 --> P2["P2 PLL / Stability"]
  P2 --> P4["P4 Noise / Quantization"]
  P1 --> P5["P5 Integrated Lab"]
  P2 --> P5
  P3 --> P5
  P4 --> P5`

export function Phases() {
  return (
    <>
      <p>
        實作計畫（<code>docs/implementation_plan.md</code>，對應規格 §20.6）把網站分成六個階段。下面每張卡片的「驗收進度」由 <code>src/data/verification-status.json</code> 即時計算：
        只有 TypeScript 與 Python golden 兩邊都通過的 T-id 才算 pass；沒有 T-id 的驗收項（build、瀏覽器、手機版、presets 下載）一律需要人工確認，本頁不會替它們打勾。
      </p>
      <Mermaid chart={PHASE_CHART} caption="階段依賴（docs/implementation_plan.md）" ariaLabel="P0 到 P5 的依賴圖" />
      <div className="rm-phases">
        {PHASES.map((ph) => {
          const pr = phaseProgress(ph)
          return (
            <article key={ph.id} className="rm-phase" data-phase={ph.id} data-state={pr.state}>
              <h3>
                {ph.id}｜{ph.title}
              </h3>
              <span className="rm-phase-state" data-state={pr.state}>
                {PHASE_STATE_LABEL[pr.state]}
              </span>
              {pr.total > 0 && (
                <p className="small">
                  驗收 T-id：兩邊皆通過 {pr.counts.pass} / {pr.total}；partial {pr.counts.partial}；fail {pr.counts.fail}；無結果 {pr.counts.missing}
                </p>
              )}
              <div className="rm-phase-label">依賴</div>
              <p className="small">{ph.deps.length ? ph.deps.join('、') : '—'}</p>
              <div className="rm-phase-label">交付</div>
              <ul className="small">
                {ph.deliverables.map((d) => (
                  <li key={d}>
                    <Rich text={d} />
                  </li>
                ))}
              </ul>
              <div className="rm-phase-label">頁面</div>
              <p className="small">
                {ph.pages.map((id, i) => (
                  <span key={id}>
                    {i > 0 && '、'}
                    <PageRef id={id} />
                  </span>
                ))}
              </p>
              <div className="rm-phase-label">驗收條件</div>
              <ul className="small">
                {ph.acceptance.map((a) => (
                  <li key={a}>
                    <Rich text={a} />
                  </li>
                ))}
              </ul>
              {ph.tests.length > 0 && (
                <div className="rm-badges">
                  {ph.tests.map((t) => (
                    <TestBadge key={t} id={t} />
                  ))}
                </div>
              )}
              <div className="rm-phase-label">風險</div>
              <ul className="small">
                {ph.risks.map((r) => (
                  <li key={r}>
                    <Rich text={r} />
                  </li>
                ))}
              </ul>
              {ph.errata.length > 0 && (
                <div className="rm-badges">
                  {ph.errata.map((e) => (
                    <ErratumTag key={e} eid={e} />
                  ))}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </>
  )
}
