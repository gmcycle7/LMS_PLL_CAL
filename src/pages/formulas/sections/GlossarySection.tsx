import { CLAIM_DESCRIPTION, CLAIM_LABEL, ClaimTag, MODEL_LEVEL_INFO, ModelLevel, Section, SOURCE_DESCRIPTION, SOURCE_LABEL, SourceTag } from '@/components'
import { Badge } from '@/components/Tags'
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
          <p className="small">
            全站的徽章只有一組基底，而且一種顏色只代表一件事：<strong>實心</strong>是結論強度（綠＝精確、琥珀＝近似、紫＝研究假說），<strong>描邊</strong>是出處與層級（藍＝模型層級、琥珀＝勘誤、灰＝來源），
            <strong>軟底</strong>是測試或比對的結果（青綠 ✓＝T-id verified、綠／紅／灰＝一致／不一致／不適用）。較長的徽章列（例如 Sign-off 頁判準的「出處」）同一行超過三個會摺成「+N」，點開再看。
          </p>
          <TableWrap>
            <table className="fr-table fr-tags-table c-table">
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
                <tr>
                  <td data-label="標籤">
                    <ModelLevel level="L3" />
                  </td>
                  <td data-label="意義">模型層級（規格 §15.1；下表）：藍描邊，L0–L6 同一種顏色、層級寫在字上。</td>
                </tr>
                <tr>
                  <td data-label="標籤">
                    <Badge variant="verified">✓ T01 verified</Badge> <Badge variant="partial">◐ T02 partial</Badge> <Badge variant="pending">○ T03 pending</Badge>
                  </td>
                  <td data-label="意義">
                    T-id 的驗證狀態（<span className="mono">src/data/verification-status.json</span>）：只有 TypeScript 與 Python golden 兩邊都通過才是 verified（青綠 ✓）；partial 是只有一邊、pending 是還沒有測試結果；fail 是紅色。
                  </td>
                </tr>
                <tr>
                  <td data-label="標籤">
                    <Badge variant="erratum">勘誤 E12</Badge>
                  </td>
                  <td data-label="意義">規格勘誤（docs/validation.md）：琥珀描邊；和「近似」的琥珀實心不同——它說的是「這條公式和規格原文不一樣」，不是結論強度。</td>
                </tr>
                <tr>
                  <td data-label="標籤">
                    <Badge variant="ok">✓ 一致（ok）</Badge> <Badge variant="mismatch">✗ 不一致（mismatch）</Badge> <Badge variant="na">n/a</Badge>
                  </td>
                  <td data-label="意義">實驗的交叉比對（Analytic／Monte Carlo／Fixed-Point）與判決：綠＝在寫明的 tolerance 內一致、紅＝超出、灰＝這種比對對該實驗不適用（會附原因）。</td>
                </tr>
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
            <table className="fr-table fr-levels-table c-table">
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
