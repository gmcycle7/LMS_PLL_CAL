import { CLAIM_DESCRIPTION, CLAIM_LABEL, ClaimTag, MODEL_LEVEL_INFO, ModelLevel, Section, SOURCE_DESCRIPTION, SOURCE_LABEL, SourceTag } from '@/components'
import type { ClaimKind, ModelLevelId, SourceKind } from '@/components'
import { GLOSSARY, GLOSSARY_CATEGORY_LABEL, GLOSSARY_CATEGORY_ORDER, type GlossaryTerm } from '../glossary'
import { ErrataList, ErratumTag, FormulaLinks, Gate, MatchCount, NoMatch, PageLinks, Rich } from '../common'
import { TableWrap } from '../TableWrap'

/**
 * (5) 中英術語表（一句話定義 + 連結）＋ 標籤與模型層級的定義。
 * 模型層級表取自共用 labels.ts（規格 §15.1），並在顯示時套用勘誤 E36 的用字修正（周期→週期、仿真→模擬）。
 */
const LEVELS: ModelLevelId[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6']

/** 勘誤 E36：簡體／異體用字修正（只用於顯示） */
export function fixE36(s: string): string {
  return s.replace(/周期/g, '週期').replace(/仿真/g, '模擬').replace(/Regessor/g, 'Regressor')
}

export function GlossarySection({ rows, searching }: { rows: GlossaryTerm[]; searching: boolean }) {
  return (
    <Section kind="intuition" level={2} id="fr-glossary" title="6　術語表（中文 / English）">
      {!searching && (
        <p>
          每個術語給中文、英文（與縮寫）、一句話白話定義，以及出現的頁面和代表公式。縮寫展開以本站與案例頁的用法為準（例如 GOS／PHOS，不同公司或論文可能不同）。
        </p>
      )}
      <div className="fr-section-bar">
        <MatchCount shown={rows.length} total={GLOSSARY.length} active={searching} />
      </div>
      {rows.length === 0 ? (
        <NoMatch what="術語" />
      ) : (
        GLOSSARY_CATEGORY_ORDER.map((c) => {
          const cr = rows.filter((g) => g.category === c)
          if (cr.length === 0) return null
          return (
            <div key={c} className="fr-gloss-group">
              <h3 className="fr-sub">{GLOSSARY_CATEGORY_LABEL[c]}</h3>
              <dl className="fr-gloss">
                {cr.map((g) => (
                  <div key={g.key} className="fr-gloss-item" data-term={g.key}>
                    <dt>
                      {g.abbr && <span className="fr-abbr">{g.abbr}</span>}
                      <span className="fr-zh">{g.zh}</span>
                      <span className="fr-en">{g.en}</span>
                    </dt>
                    <dd>
                      <Rich text={g.def} />
                      <div className="fr-gloss-links small">
                        <PageLinks ids={g.pages} />
                        {g.formulas && g.formulas.length > 0 && <FormulaLinks ids={g.formulas} />}
                        {g.errata && g.errata.length > 0 && <ErrataList ids={g.errata} />}
                      </div>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )
        })
      )}

      {!searching && (
        <Gate min="engineer">
          <h3 className="fr-sub" id="fr-tags">
            標籤的定義
          </h3>
          <TableWrap>
            <table className="fr-table fr-tags-table">
              <thead>
                <tr>
                  <th>標籤</th>
                  <th>意義</th>
                </tr>
              </thead>
              <tbody>
                {(['exact', 'approx', 'research'] as ClaimKind[]).map((k) => (
                  <tr key={k}>
                    <td data-label="標籤">
                      <ClaimTag kind={k} />
                    </td>
                    <td data-label="意義">
                      {CLAIM_LABEL[k]}：{CLAIM_DESCRIPTION[k]}
                    </td>
                  </tr>
                ))}
                {(['illustrative', 'simulation', 'literature', 'measured'] as SourceKind[]).map((k) => (
                  <tr key={k}>
                    <td data-label="標籤">
                      <SourceTag kind={k} />
                    </td>
                    <td data-label="意義">
                      {SOURCE_LABEL[k]}：{SOURCE_DESCRIPTION[k]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <h3 className="fr-sub" id="fr-levels">
            模型層級 L0–L6（規格 §15.1）
          </h3>
          <p className="small">
            用字依 <ErratumTag eid="E36" /> 修正（「周期」→「週期」、「仿真」→「模擬」）。不可對同一組參數在不同層級算出互相矛盾、卻都標成「精確」的答案。
          </p>
          <TableWrap>
            <table className="fr-table fr-levels-table">
              <thead>
                <tr>
                  <th>層級</th>
                  <th>模型</th>
                  <th>時間基準</th>
                  <th>驗證什麼</th>
                </tr>
              </thead>
              <tbody>
                {LEVELS.map((l) => (
                  <tr key={l}>
                    <td data-label="層級">
                      <ModelLevel level={l} />
                    </td>
                    <td data-label="模型">{fixE36(MODEL_LEVEL_INFO[l].model)}</td>
                    <td data-label="時間基準">{fixE36(MODEL_LEVEL_INFO[l].timebase)}</td>
                    <td data-label="驗證">{fixE36(MODEL_LEVEL_INFO[l].verifies)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Gate>
      )}
    </Section>
  )
}
