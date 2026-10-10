import { useState, type ReactNode } from 'react'
import { ClaimTag, Section, SourceTag, TestBadge, type ClaimKind } from '@/components'
import { KIND_LABEL, LEVEL_LABEL, PAPERS, doiUrl, formatCitation, pageCount, toBibtex, type PaperId, type PaperRef } from '../references'
import { ErratumNote, Fold, PageChips, Question, RichText } from '../common'
import { D1Noise } from '../panels/D1Noise'
import { D2Polarity } from '../panels/D2Polarity'
import { D3Delay } from '../panels/D3Delay'
import { D4Excitation } from '../panels/D4Excitation'
import { D5Quant, D6Dither } from '../panels/D5D6Quant'
import { D7Eigen } from '../panels/D7Eigen'

/** 每篇文獻對應的「本站推導」面板、一句話摘要（`$…$` 為 TeX）與結論標籤 */
const DERIVED: Record<PaperId, { summary: string; claims: ClaimKind[]; tests: string[]; panel: () => ReactNode }> = {
  D1: {
    summary: String.raw`白色 GMAC 雜訊 $\to$ 係數 RMS $\sigma_w$、四種「頻寬」定義（Ch12）`,
    claims: ['exact', 'approx'],
    tests: ['T13', 'T14'],
    panel: () => <D1Noise />,
  },
  D2: {
    summary: String.raw`單頻／多頻相關判據 $C=E[xu]$、filtered-x 的模型相位誤差（Ch06–Ch07）`,
    claims: ['exact'],
    tests: ['T06'],
    panel: () => <D2Polarity />,
  },
  D3: {
    summary: String.raw`更新延遲的臨界增益 $g^*(d)$ 與 PM：極性正確仍可能發散（Ch08）`,
    claims: ['exact'],
    tests: ['T08'],
    panel: () => <D3Delay />,
  },
  D4: {
    summary: String.raw`激勵變弱時 bias、時間常數、$\sigma_w^2$ 一起 $\propto 1/C$；$\lambda_{\min}$ 與 code 相關（Ch09、Ch11）`,
    claims: ['approx', 'research'],
    tests: [],
    panel: () => <D4Excitation />,
  },
  D5: {
    summary: String.raw`常數目標的 limit cycle、有限狀態 $\Rightarrow$ 週期 $\Rightarrow$ 線譜、PRBS dither 的接法與準位數（Ch13）`,
    claims: ['exact'],
    tests: ['T16'],
    panel: () => <D5Quant />,
  },
  D6: {
    summary: String.raw`subtractive vs non-subtractive dither 的誤差功率 $\tfrac1{12}$ vs $f(1-f)$ 與 Monte Carlo 驗算（Ch13）`,
    claims: ['exact', 'research'],
    tests: ['T17'],
    panel: () => <D6Dither />,
  },
  D7: {
    summary: String.raw`mean recursion 的 eigen-mode $1-\mu\lambda_i$、慢模式步數、mean vs mean-square（Ch03、Ch09、Ch10）`,
    claims: ['exact'],
    tests: ['T03', 'T11'],
    panel: () => <D7Eigen />,
  },
}

/** 複製文字到剪貼簿；瀏覽器不支援或被拒絕時回傳 false（畫面上仍可手動選取）。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function Citation({ p }: { p: PaperRef }) {
  const pc = pageCount(p.pages)
  const [copied, setCopied] = useState<'' | 'ok' | 'fail'>('')
  const bib = toBibtex(p)
  return (
    <div className="papers-cite">
      <p className="papers-cite-text">{formatCitation(p)}</p>
      <div className="papers-cite-links">
        {p.doi ? (
          <a href={doiUrl(p.doi)} target="_blank" rel="noopener noreferrer" className="papers-doi">
            DOI: {p.doi}
          </a>
        ) : (
          <span className="papers-nodoi">無 DOI（{KIND_LABEL[p.kind]}）</span>
        )}
        {pc !== null && <span className="small muted">頁數 {pc}（由頁碼推得）</span>}
        <span className="small muted">書目核對：{p.verifiedBy}</span>
      </div>
      {p.links && (
        <ul className="papers-links">
          {p.links.map((l) => (
            <li key={l.url}>
              <a href={l.url} target="_blank" rel="noopener noreferrer">
                {l.label}
              </a>
              {l.status && <span className="small muted"> — {l.status}</span>}
            </li>
          ))}
        </ul>
      )}
      <details className="papers-bib">
        <summary className="small">BibTeX（由上面核對過的欄位產生；特殊字元已轉成 LaTeX 寫法，可直接貼進 .bib）</summary>
        <pre className="papers-bibtex" data-bibtex={p.id}>
          {bib}
        </pre>
        <div className="papers-cite-tools">
          <button
            type="button"
            className="btn"
            onClick={() => {
              void copyText(bib).then((ok) => setCopied(ok ? 'ok' : 'fail'))
            }}
          >
            複製 BibTeX
          </button>
          {copied === 'ok' && <span className="papers-cite-copied">已複製</span>}
          {copied === 'fail' && <span className="small muted">無法存取剪貼簿，請手動選取上方文字</span>}
        </div>
      </details>
    </div>
  )
}

export function PaperCard({ p }: { p: PaperRef }) {
  const d = DERIVED[p.id]
  return (
    <article className="papers-card" id={`papers-${p.id}`} data-paper={p.id}>
      <header className="papers-card-head">
        <span className="papers-id">{p.id}</span>
        <span className="small muted">規格書附錄 D #{p.specIndex}</span>
        <span className="papers-badge">{KIND_LABEL[p.kind]}</span>
        <span className="papers-badge">{LEVEL_LABEL[p.level]}</span>
        <span className="papers-badge">建議第 {p.order} 順位</span>
        <SourceTag kind="literature" />
      </header>
      <h3 className="papers-card-title">{p.title}</h3>
      <Citation p={p} />
      <p>
        <strong>為什麼讀：</strong>
        <RichText text={p.relevance} />
      </p>
      <p className="papers-related">
        <strong>本站相關頁面：</strong>
        <PageChips ids={p.pages_} />
      </p>
      <div className="table-wrap">
        <table className="papers-table papers-claims">
          <tbody>
            <tr>
              <th scope="row">已發表主張（題名層級）</th>
              <td>
                <RichText text={p.titleClaim} />
              </td>
            </tr>
            <tr>
              <th scope="row">規格書附錄 D 的描述</th>
              <td>
                「{p.specNote}」<span className="small muted">（原樣引用；未經本站核對）</span>
              </td>
            </tr>
            <tr>
              <th scope="row">本站推導（derived on this site）</th>
              <td>
                <RichText text={d.summary} />{' '}
                {d.claims.map((c) => (
                  <ClaimTag key={c} kind={c} />
                ))}
                <span className="small muted">（每個公式的條件見下方面板；本站自己的推導與數字，不是這篇文獻的結果）</span>
                {d.tests.length > 0 && (
                  <div className="small">
                    數字對照的 golden 驗收值：
                    {d.tests.map((t) => (
                      <TestBadge key={t} id={t} />
                    ))}
                  </div>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="papers-tips">
        <strong>怎麼讀：</strong>
        <ul>
          {p.tips.map((t, i) => (
            <li key={i}>
              <RichText text={t} />
            </li>
          ))}
        </ul>
      </div>
      {p.errata.length > 0 && (
        <p className="small">
          相關勘誤：
          {p.errata.map((id) => (
            <ErratumNote key={id} id={id} />
          ))}
        </p>
      )}
      <Fold title={<>本站對應的推導與數字（{p.id}）</>}>{d.panel()}</Fold>
    </article>
  )
}

/** §3：七篇文獻（依規格書附錄 D 的編號）。 */
export function S3Papers() {
  return (
    <Section kind="example" level={2} title="3. 七份文獻：書目、為什麼讀、和本站的哪裡對照" id="papers-list">
      <Question>每一篇在講什麼？哪些是作者的主張、哪些是本站自己推的？讀的時候要先看本站哪一章？</Question>
      <p>
        每張卡片分成三層：<strong>書目</strong>（有 DOI 者以 Crossref 紀錄核對，並附可複製的 BibTeX）、<strong>主張的分層</strong>（題名層級的已發表主張／規格書的描述／本站推導）、
        以及可展開的<strong>本站對應推導</strong>（公式一步一步推、數字由程式即時計算）。
      </p>
      {PAPERS.map((p) => (
        <PaperCard key={p.id} p={p} />
      ))}
    </Section>
  )
}
