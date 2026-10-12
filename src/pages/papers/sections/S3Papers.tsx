import { useState, type ReactNode } from 'react'
import { ClaimTag, Section, SourceTag, TestBadge, Tex, type ClaimKind } from '@/components'
import { KIND_LABEL, LEVEL_LABEL, PAPERS, doiUrl, formatCitation, pageCount, toBibtex, type PaperId, type PaperRef } from '../references'
import { Diagram, ErratumNote, Fold, PageChips, Question, RichText, r } from '../common'
import { CHART_PAPER_MAP } from '../diagrams'
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
      <Diagram
        chart={CHART_PAPER_MAP}
        caption="七份文獻各自對照校正迴路的哪一塊：每個方塊最下面一行是文獻編號與本站的章節。"
        ariaLabel="校正迴路方塊圖：code、PLL 誤差路徑、comparator、GMAC、累加器、更新延遲、量化器，各方塊標出對應的文獻 D1 到 D7 與本站章節"
      >
        <p>
          <strong>先看</strong>訊號怎麼繞一圈，從最上面的 code <Tex>{'x[n]'}</Tex> 開始。feedback（divider）edge 比理想時刻早到 <Tex>{'a\\,x[n]'}</Tex>（<Tex>{'a'}</Tex> 是真實的 DTC gain）；
          reference 端 DTC 只能延遲、不能提前，所以它從固定的基準延遲 <Tex>{'T_0'}</Tex> 往回扣補償量 <Tex>{'w\\,x[n]'}</Tex>（<Tex>{'w'}</Tex> 是校正係數，<Tex>{r`\tau_{\mathrm{DTC}}=T_0-w\,x[n]`}</Tex>）。兩者差的 <Tex>{'(a-w)\\,x[n]'}</Tex> 就是第二個方塊的殘差。
          PD 量的是（被 DTC 延遲後的）reference edge 減 feedback edge，<Tex>{r`e[n]=t_{\mathrm{ref}}'[n]-t_{\mathrm{fb}}[n]`}</Tex>；殘差經 PLL 誤差路徑{' '}
          <Tex>{r`H_{\mathrm{PD}}`}</Tex> 變成 phase detector 輸出的誤差 <Tex>{'e[n]'}</Tex>。comparator 取的就是 PD 的輸出 <Tex>{'e[n]'}</Tex>，也就是送進 loop filter 的同一個訊號，只留下正負號 <Tex>{'q[n]'}</Tex>；GMAC 把一個 block 的 <Tex>{'N'}</Tex> 個{' '}
          <Tex>{'q[n]\\,x[n]'}</Tex> 平均成 <Tex>{'G_k'}</Tex>，乘上步長 <Tex>{r`\mu`}</Tex> 後累加成新的 <Tex>{'w'}</Tex>，再經過更新延遲與有限位元量化回到 DTC。
        </p>
        <p>
          <strong>再看</strong>每個方塊最下面一行：那一塊出問題時該讀哪一份文獻、先看本站哪一章。圖上的 GMAC 方塊就是 §4 的 <Tex>{r`G_k=\tfrac1N\sum q\,x`}</Tex>；D4
          是晶片實例，放在最上游的 code，因為它最直接對照的是「激勵夠不夠」。
        </p>
      </Diagram>
      {PAPERS.map((p) => (
        <PaperCard key={p.id} p={p} />
      ))}
    </Section>
  )
}
