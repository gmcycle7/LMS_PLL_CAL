import { Callout, ClaimTag, ModeGate, Prereq, Tex, ChRef } from '@/components'
import { CONDITIONS, ITEMS, ITEM_STATUS_DESC, type Condition, type ItemStatus } from '../data'
import { Diagram, mt, n4, PageRef, Rich, StatusBadge } from '../common'
import { CHART_R1_LOOP, CHART_SIX_CONDITIONS, CHART_STATUS_FLOW } from '../diagrams'
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
        規格書的最終主旨是：成功的 calibration 必須<strong>同時</strong>滿足六件事。前 14 章在「簡化但可驗證」的模型裡把每一件事講清楚；規格附錄 C 的 R1–R10，加上使用者實際遇到的 SSPLL 案例，則是把這些簡化拿掉之後還沒解決的問題。
      </p>
      <Diagram
        chart={CHART_SIX_CONDITIONS}
        caption="成功的 calibration 要同時滿足的六件事：每個方塊中間一行是判斷式，最下面一行是還在研究它的題目。"
        ariaLabel="六個成功條件的方塊圖：資訊足夠、方向正確、動態穩定、統計精度、收斂到正確值、系統效能，六個都成立才算成功"
      >
        <p>
          <strong>先看</strong>左邊六個方塊的中間一行，那是每個條件的判斷式：
          {mt(String.raw`$\lambda_{\min}$ 是資訊矩陣 $\mathbf R$ 最小的 eigenvalue（最難被激發的參數方向有多少資訊）；$C$ 是 GMAC 用的 regressor 與 phase detector 實際看到的訊號之間的相關（correlation），它的正負號決定平均更新方向；$\sigma_w$ 是收斂後校正係數抖動的 RMS；$w^*$ 是 GMAC 平均輸出歸零、係數停下來的位置。`)}
        </p>
        <p>
          <strong>再看</strong>右邊：六個箭頭都要成立，校正才算成功；少了任何一個，係數可能學不到、往反方向走、發散、抖太大、停在錯的值，或是係數對了但 PLL 輸出沒有變好。圖上每個方塊最下面一行的 R 編號，就是下表「延伸研究」那一欄。
        </p>
      </Diagram>
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
        <ChRef ch="12">第 12 章</ChRef>的 <Tex>{'\\sigma_w\\approx0.399'}</Tex> fs（T13）假設相鄰 GMAC block 的雜訊互相獨立。如果它們有相關係數 <Tex>{'\\rho'}</Tex>（R1），答案會變成多少？先用數字算一次（推導在 R1 的預覽裡）：
      </p>
      <Diagram
        chart={CHART_R1_LOOP}
        caption="有色 GMAC 雜訊推動係數誤差：上半部產生相鄰 block 相關的雜訊，下半部是第 12 章的一階校正迴路。藍色方塊是第 12 章沒有的那一項。"
        ariaLabel="R1 的訊號流方塊圖：白雜訊經一階回授產生相鄰 block 相關的 GMAC 雜訊，乘上步長後進入 pole 為 p 的一階校正迴路，輸出係數誤差"
      >
        <p>
          <strong>先看</strong>下半部（<ChRef ch="12">第 12 章</ChRef>已經有的）：
          {mt(String.raw`第 $k$ 個 block 的 GMAC 雜訊 $\eta_k$ 乘上步長 $\mu$ 後加進係數誤差 $\delta w_k=w_k-w^*$（係數離它停下來的位置 $w^*$ 多遠）；誤差每個 block 乘上 pole $p=1-\mu K$，其中 $K=K_qC$ 是 GMAC 平均輸出對誤差的斜率。寫成式子是 $\delta w_{k+1}=p\,\delta w_k+\mu\,\eta_k$。`)}
        </p>
        <p>
          <strong>再看</strong>上半部：
          {mt(String.raw`第 12 章假設 $\eta_k$ 各 block 獨立；這裡讓它帶著上一個 block 的記憶，$\eta_{k+1}=\rho\,\eta_k+\sqrt{1-\rho^2}\,\sigma_\eta\,\xi_k$，$\rho$ 就是相鄰 block 的相關係數，前面的 $\sqrt{1-\rho^2}$ 讓 $\eta_k$ 的變異數維持 $\sigma_\eta^2$。圖上藍色的 $\rho$ 設成 0，整張圖就退回第 12 章；最右邊的 $\sigma_w^2$ 是下面要算的數。`)}
        </p>
      </Diagram>
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
        <ClaimTag kind="exact" /> 在線性化模型下精確（數字由 <code>sigmaW2Colored</code> 即時算出）。同一個係數雜訊，只因一個「獨立」假設不成立，RMS 就差 {n4(hc.rows[1].sigmaW / hc.rows[0].sigmaW)} 倍——這就是 Research Backlog 存在的理由：每個簡化都要有人回頭檢查。
      </p>

      <h3>怎麼讀狀態</h3>
      <Diagram
        chart={CHART_STATUS_FLOW}
        caption="一個研究項目的狀態怎麼決定：由上往下依序問三個問題；不管走到哪一個結果，都不會是 verified。"
        ariaLabel="研究項目狀態的判定流程：資料檔直接指定、有本站已有的子目標、有預覽或待辦的子目標，分別得到分析中、部分覆蓋、待辦、未開始"
      >
        <p>
          <strong>先看</strong>三個菱形的順序：先問資料檔有沒有直接指定狀態，再問有沒有任何一個子目標已經在本站的章節裡（簡化版），最後問有沒有只做成本頁預覽或排進待辦的子目標。<strong>再看</strong>
          最下面的紅色方塊：四種結果都通到那裡，因為研究項目沒有 T-id 驗收測試。圖上的四個結果，就是下面四張說明卡。
        </p>
      </Diagram>
      <div className="rm-legend">
        {STATUSES.map((s) => (
          <div key={s} className="rm-legend-item">
            <StatusBadge status={s} />
            <p>{ITEM_STATUS_DESC[s]}</p>
          </div>
        ))}
      </div>
      <Callout kind="warn" title="這一頁上沒有任何東西是 verified">
        研究項目的狀態只有上面四種。每張卡片下方的「數學預覽」是在明確的簡化模型內推導、並用程式驗算（封閉式 vs 數值 vs Monte Carlo）的<strong>第一步</strong>，不代表研究完成。全站只有 T01–T18 的驗收測試在 TypeScript 與 Python golden 兩邊都通過時才顯示 verified（見 <PageRef id="verification" />）。
      </Callout>
      <ModeGate min="engineer" summary="「驗證」在本站的意思（verified 的三個條件）">
        <Prereq title="「驗證」在本站的意思">
          <p>
            一個 T-id 要顯示 verified，必須：(1) TypeScript 有以 <code>Txx:</code> 命名的測試通過；(2) Python golden model 有 <code>test_Txx_…</code> 通過；(3) 由 <code>npm run verify</code> 彙整進 <code>src/data/verification-status.json</code>。本頁 P0–P5 的進度直接讀這個檔案；研究項目則沒有 T-id，所以不可能是 verified。
          </p>
        </Prereq>
      </ModeGate>
    </>
  )
}
