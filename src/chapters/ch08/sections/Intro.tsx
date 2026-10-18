import { Callout, ClaimTag, Mermaid, ModeGate, ModelLevel, Section, SourceTag, SystemMap, Tex, TestBadge, ChRef } from '@/components'
import { delayCriticalGain } from '@/simulation/models/stability'
import { ErratumNote, fx, rich } from '../common'
import { ROADMAP_CHART, SYSTEM_MAP_FOCUS } from '../diagrams'
import { SymbolsLink } from './Symbols'

/** 開場（問題 → 系統地圖 → 符號表連結）與學習地圖。本章符號表在章末（./Symbols.tsx）。 */
export function Intro() {
  return (
    <>
      <Callout kind="info" title="這一章要回答的問題">
        GMAC 的更新<strong>極性</strong>已經是對的、loop gain <Tex>{'g'}</Tex>（學習率 <Tex>{'\\mu'}</Tex> 乘上 GMAC 的平均斜率 <Tex>{'K'}</Tex>，沒有單位；§8.2 會從頭定義）也在一階模型的{' '}
        <Tex>{'0<g<2'}</Tex> 裡面——calibration loop 就一定穩定嗎？
        <br />
        答案是<strong>不一定</strong>。本章拆成三個陷阱：(1) polarity margin 不是 phase margin；(2) GMAC pipeline 的<strong>更新延遲</strong>會把 <Tex>{'g'}</Tex> 的穩定上界從 {fx(delayCriticalGain(0), 0)} 縮到 {fx(delayCriticalGain(1), 0)}、{fx(delayCriticalGain(2), 3)}…；(3) 主 PLL 對誤差的<strong>觀測動態</strong>（雙迴路，含一個 block 的取樣→觀測 latency）會讓「時間尺度分離」的簡化模型高估穩定範圍——在本章的二狀態模型裡恰好高估一倍，而且與主 PLL 的快慢無關（<ErratumNote id="E19" />）。
      </Callout>
      <div className="c-tag-row">
        <ModelLevel level="L1" /> <ModelLevel level="L2" /> <TestBadge id="T08" /> <TestBadge id="T09" /> <ClaimTag kind="exact" /> <SourceTag kind="illustrative" />
      </div>

      <p>
        {rich(
          String.raw`先看系統地圖，確認這一章在整個系統的哪裡。藍色的三個方塊——GMAC（把 comparator 的 $q[n]$ 和 code $x[n]$ 相乘累加，量出平均相關 $G_k$）、「$\div N$、$\times\mu$」（決定每次修正多少）與 gain accumulator（把修正量累加成係數 $w_k$）——就是前幾章的校正路徑。這一章新增的觀點是：把它們連同 $w$ 回到 reference 端的 DTC（$w$ 在 gain correction 乘上 code）、經過 PD 與主 PLL 得到 PD 的輸出 $e[n]$（就是送進 loop filter 的同一個訊號）、再由 comparator 取它的正負號回到 GMAC 的那一圈，當成一個`,
        )}
        <strong>回授迴路</strong>
        {rich(String.raw`來分析——它的 loop gain、更新延遲與主 PLL 的動態，決定校正會不會振盪。`)}
      </p>
      <SystemMap focus={SYSTEM_MAP_FOCUS} />
      <SymbolsLink />
      <ModeGate min="research">
        <Callout kind="info" title="Research 模式：本章的模型層級">
          §8.2–8.3 是 L1 的<strong>平均（mean-field）線性化模型</strong>：把 sign-LMS 的 <Tex>{'E[G\\mid\\delta]=\\mathrm{erf}(\\delta/(\\sqrt2\\sigma_v))'}</Tex> 在
          <Tex>{'\\delta=0'}</Tex> 附近線性化成 <Tex>{'K_q\\delta'}</Tex>。§8.4 是 L2 的抽象觀測模型。真實的 sign-LMS 在線性不穩定時並不會發散到無窮大，而是被{' '}
          <Tex>{'|G|\\le1'}</Tex> 限制成有界的 limit cycle（PM Lab 的 Monte Carlo 可以看到）——那屬於 <ClaimTag kind="research" />，需要 describing function 或非線性分析。
        </Callout>
      </ModeGate>

      <Section kind="intuition" title="先用一個生活例子：洗澡水的溫度旋鈕" level={2} id="ch08-intro">
        <p>
          你在調熱水。旋鈕轉了以後，水要 2 秒才流到蓮蓬頭。如果你每 0.5 秒就「看目前的水溫」再轉一次，你會轉過頭、再轉回來、又轉過頭——越轉越抖。問題不在你轉的<strong>方向</strong>（太冷就往熱的方向轉，方向完全正確），而在於你每次轉的<strong>量</strong>（loop gain）和你看到的資訊有多<strong>舊</strong>（延遲）。
        </p>
        <p>
          LMS 校正迴路完全一樣：GMAC 告訴你「方向」（polarity），學習率 <Tex>{'\\mu'}</Tex> 決定「轉多少」，pipeline 與主 PLL 決定「資訊有多舊」。前面幾章（<ChRef ch="05">Ch05</ChRef>–<ChRef ch="07">Ch07</ChRef>）處理的是方向；這一章處理的是<strong>量 <Tex>{'\\times'}</Tex> 延遲</strong>——也就是控制理論的 phase margin。
        </p>
        <Mermaid
          caption="本章的路線圖：由左到右，每一格比前一格多考慮一件事（延遲 → 觀測動態 → 任意線性觀測），穩定條件也跟著變嚴"
          chart={ROADMAP_CHART}
        />
        <p className="small">
          {rich(
            String.raw`讀圖：先看最左邊——只有一個積分器的一階迴路，條件是 $0<g<2$。再往右一格：把「資訊有多舊」加進來（更新延遲 $d$ 個 block），上界縮成 $2\sin\frac{\pi}{4d+2}$。第三格再加上主 PLL 的記憶（觀測狀態 $s$），條件變成 $\mu b_sc_s<1-r_s$。最右邊是通用的檢查法：把所有狀態排成一個矩陣 $\mathbf A_{\mathrm{comb}}$，看它的 spectral radius $\rho$（所有 eigenvalue 絕對值的最大者）是否小於 $1$。每一格的符號都會在對應的小節從頭定義。`,
          )}
        </p>
      </Section>

      <Section kind="diagram" title="本章學習地圖（對應入門課 Lesson 8–9）" level={2}>
        <p className="small">
          本章所有表格、曲線與數字都由 <code>src/simulation/models/stability.ts</code>（以及 PM Lab 選用的 <code>blockLms</code> Monte Carlo）即時計算；參數是教學示例，不是晶片量測值{' '}
          <SourceTag kind="illustrative" />。每一段推導後面都有一題<strong>帶入手算</strong>（HC-08.1 … HC-08.7）：把數字換成你自己的，用紙筆和工程計算機算一次，再對答案；章末思考題之前還有一題從晶片數字一路算到穩定裕度的綜合題（HC-08.8）。
        </p>
        <div className="table-wrap">
          <table className="ch08-table">
            <thead>
              <tr>
                <th>段落</th>
                <th>問題</th>
                <th>關鍵結果</th>
                <th>標籤</th>
                <th>驗證</th>
                <th>帶入手算</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>§8.1</td>
                <td>{rich(String.raw`相位 $\theta$ 多大時更新方向會反？`)}</td>
                <td>
                  <Tex>{String.raw`M=\arcsin(\cos\theta)`}</Tex>
                </td>
                <td>
                  <ClaimTag kind="exact" />
                </td>
                <td>
                  <ErratumNote id="E20" />
                </td>
                <td>HC-08.1</td>
              </tr>
              <tr>
                <td>§8.2</td>
                <td>calibration loop 自己的 PM 是多少？</td>
                <td>
                  <Tex>{String.raw`PM=90^\circ-\arcsin(g/2)`}</Tex>
                </td>
                <td>
                  <ClaimTag kind="exact" />
                </td>
                <td>
                  <TestBadge id="T08" />
                </td>
                <td>HC-08.2、HC-08.3</td>
              </tr>
              <tr>
                <td>§8.3</td>
                <td>{rich(String.raw`pipeline 延遲 $d$ 個 block 會怎樣？`)}</td>
                <td>
                  <Tex>{String.raw`g<2\sin\frac{\pi}{4d+2}`}</Tex>
                </td>
                <td>
                  <ClaimTag kind="exact" />
                </td>
                <td>{rich(String.raw`delay bounds $d=0\ldots6$`)}</td>
                <td>HC-08.4、HC-08.5、HC-08.6</td>
              </tr>
              <tr>
                <td>§8.4</td>
                <td>主 PLL 的觀測動態會怎樣？</td>
                <td>
                  <Tex>{String.raw`0<\mu b_sc_s<1-r_s`}</Tex>（不是 <Tex>{String.raw`2(1-r_s)`}</Tex>）
                </td>
                <td>
                  <ClaimTag kind="exact" /> / <ClaimTag kind="approx" />
                </td>
                <td>
                  <TestBadge id="T09" /> <ErratumNote id="E19" />
                </td>
                <td>HC-08.7</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small muted">
          表裡的公式只是預告：每個符號都會在對應的小節第一次出現時用一句話說明，完整的符號表放在本章最後。
        </p>
      </Section>
    </>
  )
}
