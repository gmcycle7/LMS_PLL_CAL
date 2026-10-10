import { Callout, ClaimTag, ModelLevel, SourceTag, SymbolTable, TestBadge, Tex } from '@/components'
import { ERRATA } from '../errata'
import { ALL_FORMULAS, registryStats } from '../registry'
import { GLOBAL_SYMBOLS } from '../symbols'
import { QUICK_REF } from '../appendixA'
import { LIMITATIONS } from '../appendixB'
import { GLOSSARY } from '../glossary'
import { refValues } from '../refValues'
import { UNIT_TOPICS } from '../searchIndex'
import { texHz, texNum } from '../format'
import { ErratumTag, Gate, PageLink, Rich } from '../common'

/**
 * 頁首：這一頁是什麼、怎麼用、本頁自己的符號（SymbolTable）。
 * 搜尋中不顯示（由 index.tsx 控制）。
 */
export function IntroSection() {
  const r = refValues()
  const st = registryStats(ALL_FORMULAS)
  return (
    <section className="fr-intro" id="fr-intro">
      <div className="c-tag-row">
        <ClaimTag kind="exact" />
        <ClaimTag kind="approx" />
        <ClaimTag kind="research" />
        <SourceTag kind="illustrative" />
        <ModelLevel level="L0" />
        <ModelLevel level="L1" />
        <TestBadge id="T13" />
        <TestBadge id="T14" />
      </div>
      <p>
        <strong>一個問題：</strong>同一份規格裡，<Tex>{String.raw`\delta`}</Tex> 在 §0 是 <Tex>{'a-w'}</Tex>、在 §3 是 <Tex>{'w-a'}</Tex>；<Tex>{String.raw`\mu`}</Tex> 在 §12 是{' '}
        <Tex>{String.raw`10\,\mathrm{fs}`}</Tex>、在 §8 是無因次的 1.2；「頻寬」可以是 <Tex>{texHz(r.loop.f3dbOneMinusP)}</Tex>、<Tex>{texHz(r.loop.f3dbExact)}</Tex> 或{' '}
        <Tex>{texHz(r.loop.enbw)}</Tex>。看到一條公式時，你怎麼知道它用的是哪一種約定？
      </p>
      <p>
        這一頁就是全站的「字典」：把所有章節的符號、單位、極性與時間索引收在同一個地方，並標出哪些地方因為驗算（<PageLink id="verification" /> 的 {ERRATA.length} 項勘誤）而與規格原文不同。
        上方的搜尋框會<strong>同時過濾六個段落</strong>；中文、英文術語、TeX 原始碼（<span className="mono">\sigma_w</span>）或 Unicode 符號（<span className="mono">σ_w</span>）都可以輸入。
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
            <strong>查東西</strong>（Engineer）：直接搜尋。輸入公式 ID（例如 <span className="mono">F-12.9</span>）會捲到那一條；每個符號都有「規格原文」欄可以對照改了什麼。
          </li>
          <li>
            <strong>審稿</strong>（Research）：公式登錄可以顯示 TeX 原始碼；頁尾有「勘誤覆蓋表」，列出 {ERRATA.length} 項勘誤各自出現在哪些表與哪些公式。
          </li>
        </ul>
        <p className="small">
          每一條結論都帶標籤（<ClaimTag kind="exact" /> 在指定模型內可代數推導；<ClaimTag kind="approx" /> 用了獨立性、小訊號或長時間平均；<ClaimTag kind="research" /> 尚待模擬或量測）。
          所有「代入數字」都由站內同一套模擬／解析核心即時計算，並在測試中與 Python golden vectors 交叉比對；晶片相關的數值都是示例，不是量測。
        </p>
      </Callout>
      <SymbolTable
        title="本頁符號（只在這一頁新增的記號；全站符號見 §1）"
        rows={[
          { symbol: '[y]', meaning: <Rich text="「$y$ 的單位」；因次分析時把單位當代數符號運算" />, firstSeen: '§2.3', note: <Rich text="例：$[\mu]=[w]/[G]$" /> },
          {
            symbol: 'f_r',
            meaning: '「這個序列自己的」取樣率',
            unit: String.raw`\mathrm{Hz}`,
            firstSeen: '§2.5',
            note: <Rich text="block 量（$w_k,G_k$）取 $f_u$；sample 量（$x[n],\delta t[n]$）取 $f_s$" />,
          },
          {
            symbol: String.raw`\Omega,\ \theta`,
            meaning: <Rich text="同一個頻率 $f$ 在 block 軸與 sample 軸上的角頻率" />,
            unit: String.raw`\mathrm{rad/block},\ \mathrm{rad/sample}`,
            firstSeen: '§2.1',
            note: <Rich text={String.raw`$\Omega=2\pi f/f_u=N\theta$；例 $f_{3\mathrm{dB}}$：$${texNum(r.loop.omega3dbBlock)}$ 與 $${texNum(r.loop.theta3dbSample)}$`} />,
          },
          {
            symbol: 'F(f)',
            meaning: <Rich text="$0\dots f$ 的雜訊功率佔總功率的比例（累積功率）" />,
            unit: '1',
            firstSeen: '§2.8',
            note: <Rich text={String.raw`$F(f_{3\mathrm{dB}})\approx\tfrac12$：corner 以下只有一半的雜訊`} />,
          },
          { symbol: 'k_x', meaning: <Rich text="code 的記帳倍率：$x'=k_xx$（例如 unit-RMS → LSB）" />, unit: '1', firstSeen: '§2.4', note: <Rich text={String.raw`$\mu\to\mu/k_x^2$ 才維持同一個 $g$`} /> },
          {
            symbol: 'n_c',
            meaning: 'commit／apply latency：新係數算出來到生效之間的延遲',
            unit: String.raw`\mathrm{samples}`,
            firstSeen: '§2.1',
            note: <Rich text="與 code delay $D$（samples）、更新延遲 $d$（blocks）是三個不同的量" />,
          },
          { symbol: String.raw`\varepsilon_p`, meaning: <Rich text="$1-p$（$=g$）：泰勒展開用的小量" />, unit: '1', firstSeen: '§2.6', note: <Rich text={String.raw`不是 §14 的 $\varepsilon$，也不是 $\varepsilon_{\mathrm{cc}}$`} /> },
          {
            symbol: String.raw`\hat\sigma_w,\ z`,
            meaning: <Rich text="Monte Carlo 估計的 $\sigma_w$ 與它對解析值的 z 分數" />,
            unit: String.raw`\mathrm{fs},\ 1`,
            firstSeen: '§2.8',
            note: <Rich text={String.raw`$z=(\hat\sigma_w^2-\sigma_w^2)/\mathrm{SE}$，以 AR(1) 有效樣本數修正`} />,
          },
        ]}
        caption={
          <>
            全站約定（<Tex>{String.raw`\delta=a-w`}</Tex>、<Tex>{'q=2b-1'}</Tex>、時間單位 fs、PSD 單邊）在 §1；本頁的例子預設 T13 條件：<Tex>{String.raw`f_s=4\,\mathrm{GHz}`}</Tex>、
            <Tex>{'N=4096'}</Tex>、<Tex>{String.raw`\mu=10\,\mathrm{fs}`}</Tex>、<Tex>{String.raw`\sigma_v=100\,\mathrm{fs}`}</Tex>、<Tex>{'C=1'}</Tex>、average mode（<ErratumTag eid="E30" />）。
          </>
        }
      />
      <Gate min="engineer">
        <p className="small muted">
          公式登錄共 {st.total} 條：{st.byClaim.exact} 條精確、{st.byClaim.approx} 條近似、{st.byClaim.research} 條研究假說；其中 {st.withErratum} 條帶勘誤註記，涉及 {st.errataReferenced.length} 項不同的勘誤。
        </p>
      </Gate>
    </section>
  )
}
