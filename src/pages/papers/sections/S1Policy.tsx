import { Callout, ClaimTag, ModeGate, Section, SourceTag, Tex } from '@/components'
import { PAPERS } from '../references'
import { calNoise } from '../bridge'
import { PageChips, Question, num, r } from '../common'
import { D1_PARAMS } from '../panels/D1Noise'

/** §1：這一頁的規則——已發表主張 vs 本站推導。 */
export function S1Policy() {
  const sigmaW = calNoise(D1_PARAMS).sigmaW
  const verified = PAPERS.filter((p) => p.doi).length
  return (
    <Section kind="intuition" level={2} title="1. 這一頁的規則：「論文說的」和「本站推的」要分開" id="papers-policy">
      <Question>
        一篇 ISSCC 論文的題名寫著 74 fs jitter；本站 Ch12 算出 <Tex>{r`\sigma_w\approx${num(sigmaW, 3)}\ \mathrm{fs}`}</Tex>。這兩個數字可以放在一起比嗎？
      </Question>
      <p>
        <strong>不行。</strong>前者是作者在他們的晶片、他們的量測條件下得到的 <em>output jitter</em>（量測值）；後者是本站在 illustrative
        參數下、用一階線性化模型算出的
        <em>gain-equivalent 係數雜訊</em>（推導值），單位雖然都是 fs，代表的物理量完全不同。這一頁的每一篇文獻都用同一套規則處理：
      </p>
      <div className="table-wrap">
        <table className="papers-table">
          <thead>
            <tr>
              <th>類別</th>
              <th>是什麼</th>
              <th>本頁怎麼標示</th>
              <th>例子</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="nowrap">
                已發表主張
                <br />
                <span className="small muted">published claim</span>
              </td>
              <td>作者在經同行審查（或公開發表）的文獻中聲稱的結果。</td>
              <td>
                <SourceTag kind="literature" /> 只寫到<strong>題名本身就能確定</strong>的範圍；本站沒有逐頁核對內文，因此不轉述內文細節或數字。
              </td>
              <td>D4 題名中的 74 fs jitter、−59 dBc spur。</td>
            </tr>
            <tr>
              <td className="nowrap">
                規格書的描述
                <br />
                <span className="small muted">spec Appendix D</span>
              </td>
              <td>本站規格書附錄 D 為每篇文獻寫的一句話摘要。</td>
              <td>原樣列出，並標「未經本站核對」。</td>
              <td>D3：「說明回授型 Adaptive LMS 不可只依靠 ±90° 的簡化判據。」</td>
            </tr>
            <tr>
              <td className="nowrap">
                本站推導
                <br />
                <span className="small muted">derived on this site</span>
              </td>
              <td>本站由基礎模型自己推導的公式，數字由網站程式即時計算，並以 Python golden model 與 TypeScript 測試交叉驗算。</td>
              <td>
                <ClaimTag kind="exact" /> / <ClaimTag kind="approx" /> / <ClaimTag kind="research" /> 與 <SourceTag kind="illustrative" />
                ，並連到推導所在的章節。
              </td>
              <td>
                <Tex>{r`g^*(d)=2\sin\frac{\pi}{4d+2}`}</Tex>（更新延遲的臨界增益）。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Callout kind="warn" title="四條不能違反的規則">
        <ol>
          <li>
            <strong>文獻不是本站數值的量測來源。</strong>本站所有數字都是 illustrative 或 simulation；沒有任何一個數字取自這些文獻。
          </li>
          <li>
            <strong>文獻不替本站模型 sign-off。</strong>「某篇論文也用 LMS 校正 DTC」不代表本站的一階模型對你的 PLL 成立；sign-off 要看{' '}
            <PageChips ids={['models', 'signoff']} />。
          </li>
          <li>
            <strong>不捏造。</strong>只列確定的書目：{verified} 篇有 DOI 的文獻，其作者、卷期、頁碼都以 DOI 的 Crossref 紀錄核對過（2026-10-10），DOI
            與規格書完全相同；D7 是講義，沒有 DOI。教科書只引用到書名層級。
          </li>
          <li>
            <strong>本站推導旁一定有條件。</strong>每個公式都寫明模型與假設（例如「一階、無延遲、小訊號」），換了條件就要重推。
          </li>
        </ol>
      </Callout>
      <ModeGate min="research">
        <Callout kind="info" title="Research：書目核對的方法與限制">
          <ul>
            <li>
              核對來源：每個 DOI 的 Crossref 紀錄（作者順序、題名、期刊／會議名、卷、期、頁碼、出版月份、會議地點）。Crossref
              是出版社登錄的後設資料，不等於核對了全文。每張卡片的 BibTeX 只由這些核對過的欄位組合而成，沒有另外補任何欄位。
            </li>
            <li>D4 的題名在 Crossref 紀錄中以「12.1」開頭，那是 ISSCC 的論文編號，本頁保留原樣。</li>
            <li>D7 的規格書連結在核對日回傳 HTTP 404；本頁同時列出課程頁與目前可連線的版本，但沒有核對講義內容是否與 2025 版相同。</li>
            <li>本頁的「題名層級主張」刻意保守：例如 D5 題名說 pseudorandom dither 會造成 spurious tones，本頁不推測它分析了哪一種 DDSM 或哪一種 PRBS。</li>
          </ul>
        </Callout>
      </ModeGate>
    </Section>
  )
}
