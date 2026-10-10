import { Callout, ClaimTag, ModeGate, Prereq, Tex } from '@/components'
import { CONDITIONS, ITEMS, ITEM_STATUS_DESC, type Condition, type ItemStatus } from '../data'
import { n4, PageRef, Rich, StatusBadge } from '../common'
import { useR1HandCalc } from '../previews/R1Colored'

/** 六個條件在本站已有的基礎章節 */
const BASICS: Record<Condition, string[]> = {
  identifiability: ['ch09', 'ch10'],
  polarity: ['ch06', 'ch07'],
  stability: ['ch03', 'ch08'],
  variance: ['ch05', 'ch12'],
  bias: ['ch11'],
  system: ['ch12', 'ch13'],
}

const STATUSES: ItemStatus[] = ['partial', 'pending', 'not-started', 'in-analysis']

export function Intro() {
  const hc = useR1HandCalc()
  return (
    <>
      <p>
        <strong>這一頁要回答的問題：</strong>這個網站已經能回答什麼？還不能回答什麼？下一步要研究的題目，各自需要哪些數學？
      </p>
      <p>
        規格書的最終主旨是：成功的 calibration 必須<strong>同時</strong>滿足六件事。前 14 章在「簡化但可驗證」的模型裡把每一件事講清楚；
        規格附錄 C 的 R1–R10，加上使用者實際遇到的 SSPLL 案例，則是把這些簡化拿掉之後還沒解決的問題。
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>條件</th>
              <th>要回答的問題</th>
              <th>本站已有的基礎</th>
              <th>延伸研究</th>
            </tr>
          </thead>
          <tbody>
            {CONDITIONS.map((c) => (
              <tr key={c.id}>
                <td className="nowrap">{c.label}</td>
                <td>
                  <Rich text={c.question} />
                </td>
                <td>
                  {BASICS[c.id].map((id, i) => (
                    <span key={id}>
                      {i > 0 && '、'}
                      <PageRef id={id} />
                    </span>
                  ))}
                </td>
                <td className="nowrap">
                  {ITEMS.filter((it) => it.conditions.includes(c.id))
                    .map((it) => it.id)
                    .join('、')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>先算一次：一個「簡化」差多少？</h3>
      <p>
        第 12 章的 <Tex>{'\\sigma_w\\approx0.399'}</Tex> fs（T13）假設相鄰 GMAC block 的雜訊互相獨立。如果它們有相關係數 <Tex>{'\\rho'}</Tex>（R1），答案會變成多少？
        先用數字算一次（推導在 R1 的預覽裡）：
      </p>
      <ol>
        <li>
          <Tex>{`K=\\sqrt{2/\\pi}/100=${n4(hc.K)}\\ \\mathrm{fs^{-1}}`}</Tex>，<Tex>{`p=1-\\mu K=1-10\\times${n4(hc.K)}=${n4(hc.p)}`}</Tex>。
        </li>
        <li>
          放大因子 <Tex>{'(1+p\\rho)/(1-p\\rho)'}</Tex>：<Tex>{`\\rho=0.5\\Rightarrow\\frac{1+${n4(hc.rows[1].pr)}}{1-${n4(hc.rows[1].pr)}}=${n4(hc.rows[1].factor)}`}</Tex>。
        </li>
        <li>
          <Tex>{`\\sigma_w=${n4(hc.rows[0].sigmaW)}\\times\\sqrt{${n4(hc.rows[1].factor)}}=${n4(hc.rows[1].sigmaW)}\\ \\mathrm{fs}`}</Tex>；反號相關 <Tex>{'\\rho=-0.5'}</Tex> 時是 <Tex>{`${n4(hc.rows[2].sigmaW)}\\ \\mathrm{fs}`}</Tex>。
        </li>
      </ol>
      <p>
        <ClaimTag kind="exact" /> 在線性化模型下精確（數字由 <code>sigmaW2Colored</code> 即時算出）。同一個係數雜訊，只因一個「獨立」假設不成立，RMS 就差 {n4(hc.rows[1].sigmaW / hc.rows[0].sigmaW)} 倍——這就是 Research Backlog 存在的理由：
        每個簡化都要有人回頭檢查。
      </p>

      <h3>怎麼讀狀態</h3>
      <div className="rm-legend">
        {STATUSES.map((s) => (
          <div key={s} className="rm-legend-item">
            <StatusBadge status={s} />
            <p>{ITEM_STATUS_DESC[s]}</p>
          </div>
        ))}
      </div>
      <Callout kind="warn" title="這一頁上沒有任何東西是 verified">
        研究項目的狀態只有上面四種。每張卡片下方的「數學預覽」是在明確的簡化模型內推導、並用程式驗算（封閉式 vs 數值 vs Monte Carlo）的<strong>第一步</strong>，
        不代表研究完成。全站只有 T01–T18 的驗收測試在 TypeScript 與 Python golden 兩邊都通過時才顯示 verified（見 <PageRef id="verification" />）。
      </Callout>
      <ModeGate min="engineer">
        <Prereq title="「驗證」在本站的意思">
          <p>
            一個 T-id 要顯示 verified，必須：(1) TypeScript 有以 <code>Txx:</code> 命名的測試通過；(2) Python golden model 有 <code>test_Txx_…</code> 通過；
            (3) 由 <code>npm run verify</code> 彙整進 <code>src/data/verification-status.json</code>。本頁 P0–P5 的進度直接讀這個檔案；研究項目則沒有 T-id，所以不可能是 verified。
          </p>
        </Prereq>
      </ModeGate>
    </>
  )
}
