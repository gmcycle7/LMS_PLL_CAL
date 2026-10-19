import { BadgeRow, Callout, ClaimTag, ModelLevel, SourceTag, TestBadge, Tex } from '@/components'
import { ERRATA } from '../errata'
import { ALL_FORMULAS, registryStats } from '../registry'
import { GLOBAL_SYMBOLS } from '../symbols'
import { QUICK_REF } from '../appendixA'
import { LIMITATIONS } from '../appendixB'
import { GLOSSARY } from '../glossary'
import { refValues } from '../refValues'
import { UNIT_TOPICS } from '../searchIndex'
import { texHz } from '../format'
import { Gate, PageLink, scrollToId } from '../common'
import { PAGE_SYMBOLS_ID } from './PageSymbolsSection'

/**
 * 頁首：這一頁是什麼、怎麼用；本頁自己新增的記號表放在頁尾（PageSymbolsSection，id="symbols"），這裡只留一行連結。
 * 搜尋中不顯示（由 index.tsx 控制）。
 */
export function IntroSection() {
  const r = refValues()
  const st = registryStats(ALL_FORMULAS)
  return (
    <section className="fr-intro" id="fr-intro">
      <BadgeRow label="本頁涵蓋的結論強度、來源、模型層級與相關測試">
        <ClaimTag kind="exact" />
        <ClaimTag kind="approx" />
        <ClaimTag kind="research" />
        <SourceTag kind="illustrative" />
        <ModelLevel level="L0" />
        <ModelLevel level="L1" />
        <TestBadge id="T13" />
        <TestBadge id="T14" />
      </BadgeRow>
      <p className="small fr-symbols-link">
        <button type="button" className="fr-link-button" onClick={() => scrollToId(PAGE_SYMBOLS_ID)}>
          本頁新增的記號表在最後 ↓
        </button>
        <span className="muted">（全站符號總表是下面的 §1；每個記號第一次出現時，正文會先用一句話說明。）</span>
      </p>
      <p>
        <strong>一個問題：</strong>同一份規格裡，<Tex>{String.raw`\delta`}</Tex> 在 §0 是 <Tex>{'a-w'}</Tex>、在 §3 是 <Tex>{'w-a'}</Tex>；<Tex>{String.raw`\mu`}</Tex> 在 §12 是{' '}
        <Tex>{String.raw`10\,\mathrm{fs}`}</Tex>、在 §8 是無因次的 1.2；「頻寬」可以是 <Tex>{texHz(r.loop.f3dbOneMinusP)}</Tex>、<Tex>{texHz(r.loop.f3dbExact)}</Tex> 或{' '}
        <Tex>{texHz(r.loop.enbw)}</Tex>。看到一條公式時，你怎麼知道它用的是哪一種約定？
      </p>
      <p>
        這一頁就是全站的「字典」：把所有章節的符號、單位、極性與時間索引收在同一個地方，並標出哪些地方因為驗算（<PageLink id="verification" /> 的 {ERRATA.length} 項勘誤）而與規格原文不同。上方的搜尋框會<strong>同時過濾六個段落</strong>；中文、英文術語、TeX 原始碼（<span className="mono">\sigma_w</span>）或 Unicode 符號（<span className="mono">σ_w</span>）都可以輸入。
      </p>
      <div className="fr-stats" role="list" aria-label="本頁收錄的內容">
        <span role="listitem">
          <strong>{GLOBAL_SYMBOLS.length}</strong> 個全站符號
        </span>
        <span role="listitem">
          <strong>{UNIT_TOPICS.length - 1}</strong> 個單位子題 + 換算器
        </span>
        <span role="listitem">
          <strong>{QUICK_REF.length}</strong> 列速查公式
        </span>
        <span role="listitem">
          <strong>{ALL_FORMULAS.length}</strong> 條登錄公式（{st.pages} 頁）
        </span>
        <span role="listitem">
          <strong>{LIMITATIONS.length}</strong> 條關鍵限制
        </span>
        <span role="listitem">
          <strong>{GLOSSARY.length}</strong> 個術語
        </span>
      </div>
      <Callout kind="info" title="怎麼讀這一頁">
        <ul className="fr-compact">
          <li>
            <strong>第一次來</strong>（Beginner）：先讀 §1 開頭的三條約定與手算例子，再讀 §2 的「先算一次」；推導預設收合，點標題就展開。
          </li>
          <li>
            <strong>查東西</strong>（Engineer）：直接搜尋。輸入公式 ID（例如 <span className="mono">F-12.9</span>）會捲到那一條；每個符號的「全站約定」下面都附「規格原文」，可以對照改了什麼。
          </li>
          <li>
            <strong>審稿</strong>（Research）：公式登錄可以顯示 TeX 原始碼；頁尾有「勘誤覆蓋表」，列出 {ERRATA.length} 項勘誤各自出現在哪些表與哪些公式。
          </li>
        </ul>
        <p className="small">
          每一條結論都帶標籤（<ClaimTag kind="exact" /> 在指定模型內可代數推導；<ClaimTag kind="approx" /> 用了獨立性、小訊號或長時間平均；<ClaimTag kind="research" /> 尚待模擬或量測）。所有「代入數字」都由站內同一套模擬／解析核心即時計算，並在測試中與 Python golden vectors 交叉比對；晶片相關的數值都是示例，不是量測。
        </p>
      </Callout>
      <Gate min="engineer">
        <p className="small muted">
          公式登錄共 {st.total} 條：{st.byClaim.exact} 條精確、{st.byClaim.approx} 條近似、{st.byClaim.research} 條研究假說；其中 {st.withErratum} 條帶勘誤註記，涉及 {st.errataReferenced.length} 項不同的勘誤。
        </p>
      </Gate>
    </section>
  )
}
