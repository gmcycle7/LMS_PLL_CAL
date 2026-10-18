import { ClaimTag, Section, Tex, TexBlock } from '@/components'
import { refValues } from '../refValues'
import { QUICK_GROUP_LABEL, QUICK_REF, type QuickGroup, type QuickRefRow } from '../appendixA'
import { ErrataList, ErratumTag, FormulaLinks, Gate, MatchCount, NoMatch, Rich } from '../common'
import { TableWrap } from '../TableWrap'

/**
 * (3) 規格附錄 A「一頁公式速查」的修正版：每一列的公式、使用條件都已依勘誤改寫；
 * 「代入數字」由 refValues()（站內核心）計算；「站內公式」是公式登錄的 ID，點擊會跳到該頁的公式。
 */
const GROUPS: QuickGroup[] = ['A', 'B', 'C']

export function QuickRefSection({ rows, searching }: { rows: QuickRefRow[]; searching: boolean }) {
  const r = refValues()
  const changed = QUICK_REF.filter((q) => q.fromSpec && (q.spec || q.errata.length > 0)).length
  const added = QUICK_REF.filter((q) => !q.fromSpec).length
  return (
    <Section kind="formula" level={2} id="fr-quick" title="3　附錄 A：一頁公式速查（修正版）">
      {!searching && (
        <p>
          規格附錄 A 原有 17 列（本站把「單頻 Phase Shift」與「Delayed Code」合併成一列，因為前者是 <Tex>{'D=0'}</Tex> 的特例）。本站保留全部內容，其中 {changed} 列的公式或使用條件依勘誤改寫或補註（Engineer 模式顯示「規格原文」），並補上 {added} 列規格正文有、速查表卻漏掉的關鍵公式（標「本站補充」）。每一列都標出結論標籤；使用條件不成立時，數字就不能直接套用。
        </p>
      )}
      <div className="fr-section-bar">
        <MatchCount shown={rows.length} total={QUICK_REF.length} active={searching} />
      </div>
      {rows.length === 0 ? (
        <NoMatch what="速查公式" />
      ) : (
        /*
          四欄（原本六欄，1280px 視窗時表寬 1537px、放在 911px 的欄裡，右邊三欄被切在畫面外）：
          結論標籤與勘誤放在「問題」的下面，「站內公式」放在核心公式的下面。內容一個字都沒少。
        */
        <TableWrap sticky>
          <table className="fr-table fr-quick-table fr-sticky-head">
            <thead>
              <tr>
                <th>問題與標籤</th>
                <th>核心公式（修正版）與站內公式</th>
                <th>使用條件</th>
                <th>代入數字</th>
              </tr>
            </thead>
            {GROUPS.map((g) => {
              const gr = rows.filter((q) => q.group === g)
              if (gr.length === 0) return null
              return (
                <tbody key={g}>
                  <tr className="fr-group-row">
                    <th colSpan={4} scope="colgroup">
                      {QUICK_GROUP_LABEL[g]}
                    </th>
                  </tr>
                  {gr.map((q) => (
                    <tr key={q.key} data-quick={q.key}>
                      <td data-label="問題" className="fr-quick-topic">
                        <strong>{q.topic}</strong>
                        {!q.fromSpec && <span className="fr-badge fr-badge-added">本站補充</span>}
                        <span className="fr-tag-col fr-cell-sub">
                          <ClaimTag kind={q.claim} />
                          <ErrataList ids={q.errata} empty="" />
                        </span>
                      </td>
                      <td data-label="核心公式">
                        <TexBlock>{q.tex}</TexBlock>
                        {q.spec && (
                          <Gate min="engineer">
                            <div className="fr-spec-orig small">
                              規格原文：<Rich text={q.spec} />
                            </div>
                          </Gate>
                        )}
                        {q.related.length > 0 && (
                          <div className="fr-cell-sub">
                            <span className="muted small">站內公式</span> <FormulaLinks ids={q.related} />
                          </div>
                        )}
                      </td>
                      <td data-label="使用條件">
                        <Rich text={q.conditions} />
                      </td>
                      <td data-label="代入數字" className="fr-example">
                        {q.example ? <Rich text={q.example(r)} /> : <span className="muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              )
            })}
          </table>
        </TableWrap>
      )}
      {!searching && (
        <p className="small muted">
          「代入數字」欄由本站同一套核心（lms.ts、comparator.ts、calNoise.ts、stability.ts、mimo.ts、bias.ts、quantizer.ts、optimizer.ts）即時計算，並在
          refValues.test.ts 與 golden/vectors 的 Python 參考值交叉比對（T01–T18）。spur 一列：規格寫的 <Tex>{String.raw`20\log_{10}(\pi f_{out}A_t)`}</Tex> 是
          <Tex>{'|T|=1'}</Tex> 的特例；<ErratumTag eid="E30" /> 說明 T13 的前提必須寫齊。
        </p>
      )}
    </Section>
  )
}
