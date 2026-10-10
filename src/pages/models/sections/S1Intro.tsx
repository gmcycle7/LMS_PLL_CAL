import { useMemo } from 'react'
import { Callout, ClaimTag, ModelLevel, Section, SourceTag, SymbolTable, Tex } from '@/components'
import { truncationEquilibrium } from '../experiments/gmacMath'
import { ChLink, md, sig } from '../common'
import { SPEC_NUMBERS } from '../refNumbers'
import { MODEL_SYMBOLS } from '../symbols'

/** §1 開場：一個問題 + 先算一次（數字由 gmacMath 的精確 mean-field 計算） */
export function S1Intro() {
  // 同一個 L1 設定（σ_v = 100 fs、6-bit ±31 code、N = 4096）：理想浮點 vs RTL 的 floor 右移（F_G = 0）
  const ex = useMemo(() => truncationEquilibrium({ bx: 6, log2N: 12, gFracBits: 0, rounding: 'floor', sigmaV: 100 }), [])
  const a = 3
  const wRtl = a - ex.deltaStar
  return (
    <section aria-labelledby="models-s1">
      <h2 id="models-s1">1｜這次我們要回答的問題</h2>
      <div className="models-question">
        <div className="models-question-label">這次我們要回答的問題</div>
        <p>
          你用 Python 寫了規格 §15.2 的 Block Sign-LMS，模擬顯示 DTC gain 收斂到 <Tex>{'a=3\\,\\mathrm{fs}'}</Tex>。RTL 工程師照著同一張方塊圖寫出 Verilog，跑出來的
          gain 卻停在 <strong>{sig(wRtl, 4)} fs</strong>。晶片量測又是另一個數字。<strong>誰是對的？</strong>
        </p>
        <p className="small muted">
          答案：三個都「對」，因為它們回答的是三個不同層級的模型。差別只在 RTL 把 GMAC 總和做算術右移（floor）時丟掉了半個 LSB——這一個細節就讓固定點偏了{' '}
          <Tex>{`\\delta^*\\approx ${sig(ex.deltaStar, 4)}\\,\\mathrm{fs}`}</Tex>（§9 會一步一步推導，數字由精確的 Binomial mean-field 計算）。
        </p>
      </div>

      <Section kind="intuition" title="先算一次：同一個演算法，三種「答案」" level={3}>
        <div className="table-wrap">
          <table className="models-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>層級</th>
                <th>多包含了什麼</th>
                <th>
                  <Tex>{'w'}</Tex> 收斂到
                </th>
                <th>結論標籤</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>浮點 Block Sign-LMS（規格 §15.2 偽程式）</td>
                <td>
                  <ModelLevel level="L1" />
                </td>
                <td>Gaussian comparator、block 平均</td>
                <td>
                  <Tex>{'w^*=a=3\\,\\mathrm{fs}'}</Tex>（平均值；另有 <Tex>{`\\sigma_w\\approx${sig(SPEC_NUMBERS.sigmaW, 3)}\\,\\mathrm{fs}`}</Tex> 的隨機抖動）
                </td>
                <td>
                  <ClaimTag kind="approx" />
                </td>
              </tr>
              <tr>
                <td>RTL：GMAC 總和右移 12 bits（floor，不保留小數）</td>
                <td>
                  <ModelLevel level="L5" />
                </td>
                <td>二補數算術右移的截斷</td>
                <td>
                  <Tex>{`w^*=a-\\delta^*=${sig(wRtl, 4)}\\,\\mathrm{fs}`}</Tex>
                </td>
                <td>
                  <ClaimTag kind="exact" />（指定模型下的 mean-field）
                </td>
              </tr>
              <tr>
                <td>真實晶片</td>
                <td>
                  <ModelLevel level="L6" />
                </td>
                <td>PLL 非線性、DTC INL、PVT、colored noise…</td>
                <td>需要量測</td>
                <td>
                  <ClaimTag kind="research" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small">
          <SourceTag kind="illustrative" /> 數字為示意設定（<Tex>{'\\sigma_v=100\\,\\mathrm{fs}'}</Tex>、6-bit code、<Tex>{'N=4096'}</Tex>），不是任何晶片的量測。
        </p>
      </Section>

      <p>
        這一頁是 <strong>Part D</strong>：把前面各章的教學模型（L0–L2）接到工程 sign-off（L4–L6）。我們會做五件事：
      </p>
      <ol>
        <li>把規格 §15.1 的七個模型層級，和本站<strong>實際</strong>做到哪裡（誠實標示 Not implemented）。</li>
        <li>把 §15.2 的參考偽程式，與本站真正執行的 TypeScript 逐行對照，並從迴圈一路推導到 pole、<Tex>{'\\sigma_w'}</Tex> 與頻寬。</li>
        <li>用 §15.3 的 JSON 直接驅動模擬（可下載、上傳、Monte Carlo、定點對照）。</li>
        <li>§15.4 標準輸出與 §15.5「一條 FFT 不能證明有 spur」的量測檢查表。</li>
        <li>§16.1 十二項 RTL 硬體檢查（含 GMAC accumulator 位元數公式與截斷偏差）以及 §16.3「何時可以宣稱穩定」的語句測驗。</li>
      </ol>
      <Callout kind="info" title="本頁的程式碼與數字從哪裡來">
        頁面上的程式碼區塊是以 <code>?raw</code> 匯入、用 <code>// #region core:…</code> 標記擷取的<strong>網站實際執行</strong>的原始碼（
        <code>src/simulation/models/blockLms.ts</code>、<code>pll.ts</code>、<code>dsm.ts</code>、<code>dtc.ts</code>）；所有表格與曲線的數字都由這些程式或解析式即時計算。需要先備知識時，請展開各段的「先備知識」框；想先看直覺版可回到{' '}
        <ChLink to="/ch/04">Ch04 系統訊號流</ChLink>。
      </Callout>

      <SymbolTable rows={MODEL_SYMBOLS} title="本頁符號" caption={md('時間索引：$n$ = comparator sample、$k$ = GMAC block（附錄 B）。單位：時間一律 fs；code 正規化後無因次。')} />
    </section>
  )
}
