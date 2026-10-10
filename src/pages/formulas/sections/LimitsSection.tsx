import { Section } from '@/components'
import { refValues } from '../refValues'
import { LIMITATIONS, type Limitation } from '../appendixB'
import { ErrataList, MatchCount, NoMatch, PageLinks, Rich } from '../common'

/**
 * (4) 規格附錄 B「數學與工程上的關鍵限制」＋ 本站依勘誤補充的 5 條。
 * 每條附一個由站內核心算出的反例數字：忘了這條限制會錯多少。
 */
export function LimitsSection({ rows, searching }: { rows: Limitation[]; searching: boolean }) {
  const r = refValues()
  return (
    <Section kind="assumptions" level={2} id="fr-limits" title="5　附錄 B：數學與工程上的關鍵限制">
      {!searching && (
        <p>
          規格附錄 B 的 10 條限制原文保留（第 10 條「PRBS 周期」依勘誤統一寫成「週期」），每條加上「為什麼」與一個算出來的反例；
          後面 5 條是驗算時發現、規格沒有寫成限制但實際會讓數字錯掉的地方（標「本站補充」）。
        </p>
      )}
      <div className="fr-section-bar">
        <MatchCount shown={rows.length} total={LIMITATIONS.length} active={searching} />
      </div>
      {rows.length === 0 ? (
        <NoMatch what="限制" />
      ) : (
        <ol className="fr-limits">
          {rows.map((l) => (
            <li key={l.key} className="fr-limit card" data-limit={l.key}>
              <div className="fr-limit-head">
                <span className="fr-limit-no">{l.specNo !== null ? `B${l.specNo}` : '＋'}</span>
                <strong>{l.title}</strong>
                {l.specNo === null && <span className="fr-badge fr-badge-added">本站補充</span>}
              </div>
              <p>
                <Rich text={l.text} />
              </p>
              <p className="small">
                <span className="fr-why">為什麼：</span>
                <Rich text={l.why} />
              </p>
              {l.example && (
                <p className="small fr-example">
                  <span className="fr-why">算給你看：</span>
                  <Rich text={l.example(r)} />
                </p>
              )}
              <div className="fr-limit-foot small">
                <ErrataList ids={l.errata} empty="" /> <PageLinks ids={l.pages} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}
