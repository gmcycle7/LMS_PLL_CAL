import { Callout, ClaimTag, CodeBlock, ModeGate, Section, Tex, TexBlock } from '@/components'
import optimizerSrc from '@/simulation/models/optimizer.ts?raw'
import { DEFAULT_CAL_SM } from '@/simulation/models/optimizer'
import { Diagram } from '../Diagram'
import { CHART_ALARM_HYSTERESIS, CHART_GUARD_ORDER, CHART_VERIFY_DECISION, IMPL_CHART, SPEC_CHART } from '../diagrams'
import { CalStateMachineExperiment, trackRmsPrediction } from '../experiments/CalStateMachine'
import { ErratumNote, md, tx } from '../shared'

/** §14.7：Calibration State Machine 與 guards */
export function S8StateMachine() {
  // VERIFY 的代價（預設值，全部由模型參數計算）：Δ² × block 數，換算成「等於幾個 TRACK block 的均方誤差」
  const c = DEFAULT_CAL_SM
  const verifyCost = c.verifyDelta ** 2 * c.verifyBlocks
  const trackMs = trackRmsPrediction(c) ** 2
  return (
    <Section kind="diagram" level={2} title="14.7 Calibration State Machine：把步長排程做成硬體" id="ch14-state-machine">
      <p>
        §14.6 告訴我們「先大後小」幾乎拿到 <Tex>{'1/k'}</Tex> 排程的好處；§14.2 告訴我們追蹤要另一個 <Tex>{'\\mu'}</Tex>。把它們串起來，再加上「什麼時候不能相信 GMAC」的保護，就是規格 §14.2 的狀態機。
      </p>
      <Diagram chart={SPEC_CHART} caption="規格 §14.2 的建議狀態機（原圖）：由左到右是開機後的主線，右邊兩個迴圈是背景追蹤時的暫停與重來。">
        <p>
          <strong>先看</strong>主線：RESET → LOCK（等 PLL 鎖定）→ COARSE（大步長）→ VERIFY（檢查收斂與偏差）→ FINE（小步長）→ TRACK（低頻寬背景追蹤）——這就是 §14.6 的「先大後小」加上 §14.2 (e) 的追蹤步長。
          <strong>再看</strong>TRACK 的兩個迴圈：低雜訊模式時可以 FREEZE 不動係數；mode 或 PVT 大變化時 RESTART，回到 COARSE 重新收斂。
        </p>
      </Diagram>
      <Diagram chart={IMPL_CHART} caption="本站實作的版本：每條箭頭都是 runCalStateMachine 裡真正的轉移條件（虛線為 guard 觸發的例外路徑）">
        <p>
          <strong>先看</strong>實線：和上圖同一條主線，但每條箭頭都寫上條件——COARSE 跑滿 <Tex>{'B_c'}</Tex> 個 block、FINE 跑滿 <Tex>{'B_f'}</Tex> 個 block（<Tex>{'\\mu_\\text{coarse}'}</Tex>、<Tex>{'\\mu_\\text{fine}'}</Tex>、<Tex>{'\\mu_\\text{track}'}</Tex>{' '}
          是三個狀態各自的步長）。VERIFY 有三個出口：通過進 FINE、殘差太大回 COARSE、斜率看不到就進 FAULT。<strong>再看</strong>虛線：失鎖時從任何更新中的狀態退回 LOCK，重新鎖定後先 VERIFY（如果失鎖時還在 COARSE，就回 COARSE 重跑）；暫存器卡在邊界（clip）時退回 last-known-good（LKG，上次確認過的好係數）再 RESTART（圖上以 COARSE 為例，任何更新中的狀態都適用；重試次數用完則進 FAULT）。
        </p>
        <p>
          圖上 VERIFY 方塊裡的 <Tex>{'\\hat K'}</Tex> 就是 §14.5 量測的斜率估計（F-14.21），<Tex>{'\\hat\\delta'}</Tex> 是用同一次量測估出來的殘餘誤差；兩者怎麼判定，放大在下面的 VERIFY 判定圖。
        </p>
      </Diagram>
      <ErratumNote id="E48">
        COARSE 階段的 <Tex>{'|\\delta|'}</Tex> 通常 <Tex>{'\\gtrsim0.5\\sigma_v'}</Tex>（comparator 飽和、slew-limited），F-14.3 不適用；coarse 長度用 F-14.5 或 Monte Carlo 決定，VERIFY 之後（<Tex>{'|\\delta|\\ll\\sigma_v'}</Tex>）才用線性公式設計{' '}
        <Tex>{'\\mu_\\text{fine}'}</Tex>、<Tex>{'\\mu_\\text{track}'}</Tex>。
      </ErratumNote>
      <h3>一個 block 裡的先後順序</h3>
      <p>
        狀態圖只畫出「從哪個狀態到哪個狀態」。硬體在每個 block 實際做的事有固定的先後：先看保護條件（guard），再決定這個 block 要不要更新、更新多少，最後才決定下一個狀態。
      </p>
      <Diagram chart={CHART_GUARD_ORDER} caption="每個 block 的處理順序（對應程式的 ① 到 ⑤）：紅色是被 guard 攔下來、這個 block 不照一般流程走的情況，藍色是正常更新的主線。">
        <p>
          <strong>先看</strong>上面兩個菱形（①）：失鎖優先，其次是「有人要求暫停」（低雜訊模式，或遇到 bad-FCW 而且政策設為 freeze）；這兩種情況都不更新係數。<strong>再看</strong>藍色主線（②③④）：依目前狀態決定步長與 DTC 實際使用的係數，量這個 block 的{' '}
          <Tex>{'G_k'}</Tex>，更新量 <Tex>{'\\mu G_k'}</Tex> 依序經過 max-step 限幅、暫存器 LSB 量化、上下限飽和。<strong>最後看</strong>下面的菱形（⑤）：如果係數連續 <Tex>{'n'}</Tex> 個 block 卡在暫存器邊界，就退回 last-known-good；否則照一般規則轉移狀態。
        </p>
        <p>
          圖上的 ① 就是下方程式碼 <code>core:calGuards</code> 的兩個 <code>if</code>，②–⑤ 是 <code>core:calStep</code> 其餘的部分；藍色方塊裡的「更新量 <Tex>{'\\mu G_k'}</Tex>」就是更新式 <Tex>{'w_{k+1}=w_k+\\mu G_k'}</Tex> 的第二項，只是多了三道保護。
        </p>
      </Diagram>
      <h3>每個 guard 在防什麼</h3>
      <div className="table-wrap">
        <table className="ch14-table">
          <thead>
            <tr>
              <th>Guard</th>
              <th>偵測</th>
              <th>本站的實作</th>
              <th>沒有它會怎樣（可用 preset 重現）</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>VERIFY（convergence + bias／polarity test）</td>
              <td>極性、可觀測性、殘差</td>
              <td>
                凍結 <Tex>{'w'}</Tex>，<Tex>{'w\\pm\\Delta'}</Tex> 各半個視窗，<Tex>{'\\hat K>z\\,\\mathrm{se}'}</Tex>、<Tex>{'|\\hat\\delta|\\le'}</Tex> 容許（F-14.21）
              </td>
              <td>極性錯誤時一路 coarse 到暫存器邊界（preset：極性錯誤）</td>
            </tr>
            <tr>
              <td>Hysteresis（Schmitt trigger）</td>
              <td>大的 mode／PVT 變化</td>
              <td>{md(String.raw`TRACK 中 $G$ 的 $W$-block 移動平均 $\bar G_W$：$|\bar G_W|$ 高於高門檻並持續 $n$ 個 block 才 RESTART，低於低門檻才解除`)}</td>
              <td>
                單一門檻時雜訊碰到就重來，於是反覆 RESTART；每次誤警報都要重付 COARSE 與 VERIFY 的代價，所以門檻要放得夠高（預設 <Tex>{'6\\sigma'}</Tex>）（preset：無 hysteresis）
              </td>
            </tr>
            <tr>
              <td>Mode change guard</td>
              <td>step 型變化</td>
              <td>同上警報 → RESTART → COARSE（大步長快速重新收斂）</td>
              <td>
                只靠 <Tex>{'\\mu_\\text{track}'}</Tex> 追，時間常數 <Tex>{'\\approx1/g_\\text{track}'}</Tex> 個 block（preset：PVT step；小 step 時 RESTART 不一定划算，見 preset：小的 PVT step）
              </td>
            </tr>
            <tr>
              <td>Lock detect</td>
              <td>PLL 失鎖、cycle slip</td>
              <td>失鎖期間 LOCK（不更新）；重新鎖定後先 VERIFY</td>
              <td>
                cycle slip 的假相關把 <Tex>{'w'}</Tex> 拉走（preset：失鎖，關掉 lock detect）
              </td>
            </tr>
            <tr>
              <td>Max update</td>
              <td>單一 block 的異常 G</td>
              <td>
                <Tex>{'|\\Delta w|\\le'}</Tex> MAX_UPDATE
              </td>
              <td>一次 glitch 造成大跳動</td>
            </tr>
            <tr>
              <td>Clip detection</td>
              <td>暫存器卡在邊界</td>
              <td>
                連續 <Tex>{'n'}</Tex> 個 block 在 <Tex>{'w_{\\min}'}</Tex>／<Tex>{'w_{\\max}'}</Tex> 時，退回 LKG、重試或 FAULT
              </td>
              <td>卡在 rail 繼續「更新」（preset：極性錯誤）</td>
            </tr>
            <tr>
              <td>Bad-FCW policy</td>
              <td>
                <Tex>{'C\\approx0'}</Tex> 的 near-integer FCW（Ch11 §11.4）
              </td>
              <td>freeze：該 FCW 期間暫停；ignore：照常更新</td>
              <td>
                <Tex>{'K\\approx0'}</Tex>（<Tex>{'\\lambda\\approx0'}</Tex>，不可辨識）加上假相關，<Tex>{'w'}</Tex> 會漂走或誤警報（preset：bad-FCW ignore）
              </td>
            </tr>
            <tr>
              <td>Last-known-good fallback</td>
              <td>任何 FAULT／clip</td>
              <td>
                VERIFY 通過或 TRACK 安靜時記下 <Tex>{'w'}</Tex>；出事時還原
              </td>
              <td>出事後係數停在壞值</td>
            </tr>
            <tr>
              <td>暫存器精度（L5）</td>
              <td>—</td>
              <td>
                暫存器 LSB 大於 0 時 <Tex>{'w'}</Tex> 以 LSB 量化（round-to-nearest）
              </td>
              <td>
                <Tex>{'\\mu_\\text{track}|G|<\\tfrac12\\,\\text{LSB}'}</Tex> 的更新被捨入吃掉，係數卡住（preset：定點 dead zone）
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>放大看兩個判斷：VERIFY 與 TRACK 警報</h3>
      <Diagram chart={CHART_VERIFY_DECISION} caption="VERIFY 的判定：先問「看不看得到正的斜率」，再問「殘差夠不夠小」；綠色是通過，紅色是停止更新。">
        <p>
          <strong>先看</strong>最上面兩個方塊：VERIFY 期間暫存器不動，DTC 前半段用 <Tex>{'w+\\Delta'}</Tex>、後半段用 <Tex>{'w-\\Delta'}</Tex>，由兩段的 GMAC 平均算出斜率估計 <Tex>{'\\hat K'}</Tex> 與殘差估計 <Tex>{'\\hat\\delta'}</Tex>。
          <strong>再看</strong>第一個菱形：斜率要明顯大於零（超過 <Tex>{'z'}</Tex> 倍標準誤），否則是極性錯誤或不可觀測，直接 FAULT。<strong>最後看</strong>第二、三個菱形：殘差在容許內就記下 last-known-good 並進 FINE；太大就回 COARSE 再收一次，重試次數用完才 FAULT。
        </p>
        <p>
          圖上的 <Tex>{'\\hat K=(\\bar G(-\\Delta)-\\bar G(+\\Delta))/(2\\Delta)'}</Tex> 就是 F-14.21 的 <Tex>{'\\hat K=(\\bar G_--\\bar G_+)/(2\\Delta)'}</Tex>；<Tex>{'\\hat\\delta'}</Tex> 的式子來自線性模型{' '}
          <Tex>{'E[G]\\approx K\\delta'}</Tex>：兩段的平均 <Tex>{'\\tfrac12(\\bar G_++\\bar G_-)\\approx K\\delta'}</Tex>（<Tex>{'\\pm\\Delta'}</Tex> 互相抵消），再除以 <Tex>{'\\hat K'}</Tex>。
        </p>
      </Diagram>
      <Diagram chart={CHART_ALARM_HYSTERESIS} caption="TRACK 警報的 hysteresis：要連續高於高門檻才重來，要低於低門檻才解除；兩個門檻之間什麼都不做。">
        <p>
          <strong>先看</strong>左邊的「安靜」：TRACK 時持續計算 <Tex>{'G'}</Tex> 的 <Tex>{'W'}</Tex>-block 移動平均 <Tex>{'\\bar G_W'}</Tex>（收斂後它應該在零附近）。<strong>再看</strong>中間的「累計中」：<Tex>{'|\\bar G_W|'}</Tex>{' '}
          高於高門檻才開始計數，夾在兩個門檻之間時計數保持不動，低於低門檻才歸零——這就是 Schmitt trigger。<strong>最後看</strong>右邊：計數達到 <Tex>{'n'}</Tex> 個 block 才 RESTART。
        </p>
        <p>
          圖上的高、低門檻就是程式裡的 <code>alarmHiZ</code>、<code>alarmLoZ</code>（以 <Tex>{'\\bar G_W'}</Tex> 的標準差 <Tex>{'1/\\sqrt{NW}'}</Tex> 為單位；預設 6 與 3），<Tex>{'n'}</Tex> 是 <code>alarmHold</code>。只有單一門檻時，雜訊一碰到就重來（上表的「無 hysteresis」）。
        </p>
      </Diagram>
      <Callout kind="warn" title="VERIFY 不是免費的：擾動的代價要算在狀態機頭上">
        <p>
          VERIFY 期間 DTC 實際使用 <Tex>{'w\\pm\\Delta'}</Tex>，所以 PLL 看到的誤差是 <Tex>{'a-w_\\text{applied}=\\delta\\mp\\Delta'}</Tex>，不是暫存器誤差 <Tex>{'\\delta'}</Tex>。一次 VERIFY 多出來的均方誤差（對 block 加總）：
        </p>
        <TexBlock>{String.raw`\begin{aligned}
\Delta^2\times B_\text{verify}&=${tx(c.verifyDelta, 4)}^2\times${c.verifyBlocks}=${tx(verifyCost, 5)}\ \mathrm{fs^2\cdot block}\\
&\approx${tx(verifyCost / trackMs, 3)}\times m_\text{track},\qquad m_\text{track}=\sigma_w^2+(r/g)^2=${tx(trackMs, 3)}\ \mathrm{fs^2}\ (\text{TRACK 每個 block 的均方誤差})
\end{aligned}`}</TexBlock>
        <p>
          所以下面的實驗一律用 DTC 實際誤差計算狀態機的 RMS（暫存器誤差另列一欄）。開機時的那一次 VERIFY 發生在評估視窗之前，不影響穩態數字；但 RESTART 之後、或失鎖重新鎖定之後的 VERIFY 都會被算進去。
          這也是 <Tex>{'\\Delta'}</Tex> 不能任意加大、VERIFY 要排在非關鍵時段的原因（§14.5 的 <Tex>{'\\Delta^*'}</Tex> 取捨只考慮量測誤差，沒有算這一項）。
        </p>
      </Callout>
      <p>
        <ClaimTag kind="research" /> 這是教學用的參考設計：門檻、視窗、重試次數都需要對真正的 PLL、DSM 與 PVT 情境做 behavioral／AMS 驗證（Part D）。
      </p>
      <ModeGate min="engineer">
        <CodeBlock source={optimizerSrc} region="calGuards" path="src/simulation/models/optimizer.ts" title="core:calGuards（全域 guards）" />
      </ModeGate>
      <ModeGate min="research">
        <CodeBlock source={optimizerSrc} region="calStep" path="src/simulation/models/optimizer.ts" title="core:calStep（完整的一個 block）" />
      </ModeGate>
      <Callout kind="info" title="試試看">
        <ul>
          <li>
            預設情境：誤差圖中狀態機先快速掉下來（COARSE），接著 VERIFY 的 <Tex>{'\\pm\\Delta'}</Tex> 擾動讓 DTC 實際誤差出現一段平台，之後在 TRACK 階段比「固定快 <Tex>{'\\mu'}</Tex>」安靜、比「固定安靜 <Tex>{'\\mu'}</Tex>」早收斂；低雜訊視窗（block 600–679）內係數完全不動。
          </li>
          <li>載入「PVT step」：block 450 的 100 fs 跳變在幾個 block 內觸發 RESTART；注意重新校正時 VERIFY 的擾動也算進評估 RMS，狀態機對固定快 <Tex>{'\\mu'}</Tex> 的優勢因此變小。</li>
          <li>
            載入「失鎖」：重新鎖定後的 VERIFY 讓評估 RMS 從暫存器誤差的零點幾 fs 變成一到兩 fs（代價），但仍遠低於兩個對照組。再關掉 lock detect：cycle slip 的假相關把 <Tex>{'w'}</Tex> 拉走，最後觸發 clip／VERIFY 失敗。
          </li>
          <li>
            載入「小的 PVT step」（25 fs）：RESTART 比留在 TRACK 好，但輸給一直用固定快 <Tex>{'\\mu'}</Tex> 的對照組。guard 不是永遠划算，要看 step 大小與 VERIFY 的代價。
          </li>
          <li>
            在「PVT step」情境把 VERIFY 擾動 <Tex>{'\\Delta'}</Tex> 從 10 fs 加大到 40 fs：狀態機的評估 RMS 反而超過固定快 <Tex>{'\\mu'}</Tex>（代價隨 <Tex>{'\\Delta^2'}</Tex> 成長）。
          </li>
          <li>
            載入「沒有 hysteresis」（單一門檻 <Tex>{'3\\sigma'}</Tex>）：Monte Carlo 的平均 RESTART 次數明顯大於 0，評估 RMS 變差；再打開 hysteresis（同樣的門檻）比較，最後換回預設的 <Tex>{'6\\sigma'}</Tex>。
          </li>
          <li>把暫存器 LSB 設成 0.25 fs：模型層級變成 L5，TRACK 卡在 dead zone。</li>
        </ul>
      </Callout>
      <CalStateMachineExperiment />
    </Section>
  )
}
