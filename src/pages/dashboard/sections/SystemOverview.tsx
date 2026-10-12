import { memo } from 'react'
import { SystemMap, Tex } from '@/components'
import { DASH_SYSTEM_FOCUS } from '../diagrams'
import { scrollToId } from '../ui'
import { SymbolsJump } from './Symbols'

/**
 * 系統地圖（docs/teaching-style.md §2 第 0 步、§8）：全站共用的 PLL + LMS 校正系統方塊圖。
 * 每一章開頭都是這張圖、只把那一章的主角標成藍色；首頁談整個系統，所以全部標示。
 * 這一節的最後是「本頁符號表在最後 ↓」那一行（符號表本身在頁末，sections/Symbols.tsx）。
 */
export const SystemOverview = memo(function SystemOverview() {
  return (
    <section id="dash-map" aria-labelledby="dash-map-h">
      <h2 id="dash-map-h" className="dash-h2">
        系統地圖：整個網站都在講這張圖 <span className="dash-h2-kicker">規格 §4，DTC 改接在 reference 輸入端</span>
      </h2>
      <p className="dash-lead-sm">
        每一章開頭都會出現同一張圖，並用藍色標出那一章的主角，讓你知道「現在在系統的哪裡」。首頁談的是整個系統——六個條件分散在每一塊上——所以全部是藍色。先認得三個框，再往下看。
      </p>
      <SystemMap
        focus={DASH_SYSTEM_FOCUS}
        caption="系統地圖：每一章開頭都是這張圖，藍色標出該章的主角；首頁談整個系統，所以全部是藍色。實線是訊號流；LMS 校正迴路的輸入是 phase detector 的輸出 $e[n]$——圖上用一對同名的標籤（PD 輸出旁一個、comparator 輸入旁一個）代替一條會穿過其他線的連線。教學用概念架構，不是特定晶片的 netlist。"
      />
      <ul className="dash-map-list">
        <li>
          <strong>主 PLL 迴路（快）</strong>：reference → DTC → phase detector → loop filter → VCO；VCO 的輸出再經 divider（或 phase mux）回到 phase detector。DTC 在 reference 的輸入端，回授路徑上只有
          divider。這一圈把輸出頻率鎖在 reference 的倍數上，每個 reference 週期都在動。
        </li>
        <li>
          <strong>小數除頻與補償</strong>：FCW → DSM；DSM 的 carry 控制 divider，餘數（fractional residue）→ gain correction → reference 端的 DTC。DSM 讓除數在相鄰整數之間切換來得到小數倍頻；切換讓 feedback（divider）的 edge
          比理想時刻早到一段已知的時間 <Tex>{'a\\,x[n]'}</Tex>——它隨 <Tex>{'n'}</Tex> 一階一階變大、滿一個週期就折回來，像一把鋸齒。其中 code <Tex>{'x[n]'}</Tex> 是累加器的餘數（<Tex>{'0\\le x[n]<1'}</Tex>）、<Tex>{'n'}</Tex> 數的是 reference 週期、
          <Tex>{'a'}</Tex> 是真實的 DTC gain（理想值是一個 VCO 週期）。DTC 只能延遲、不能提前，所以它從一個固定的基準延遲 <Tex>{'T_0'}</Tex> 往回扣：<Tex>{'\\tau_{\\mathrm{DTC}}[n]=T_0-w\\,x[n]'}</Tex>。和「一律延遲{' '}
          <Tex>{'T_0'}</Tex>」相比，reference edge 等於也提前了 <Tex>{'w\\,x[n]'}</Tex>（這個量叫 DTC 的<strong>補償量</strong>），去對齊早到的 feedback edge。phase detector 量的是「DTC 延遲後的 reference edge 減 feedback
          edge」：<Tex>{"e[n]=t_{\\mathrm{ref}}'[n]-t_{\\mathrm{fb}}[n]=(a-w)\\,x[n]+v[n]"}</Tex>（<Tex>{'v[n]'}</Tex> 是雜訊；常數 <Tex>{'T_0'}</Tex> 被 PLL 當成靜態相位偏移吸收）。補償不足（<Tex>{'w<a'}</Tex>）時 reference
          還是太晚，誤差為正；補得準不準，就看乘在 code 上的校正係數 <Tex>{'w'}</Tex>。這裡先不看主 PLL 的動態；「一條方程式」那一節會把 <Tex>{'x'}</Tex> 換成經過 PLL error path 的 <Tex>{'u'}</Tex>。
        </li>
        <li>
          <strong>LMS 校正迴路（慢）</strong>：PD 的輸出 <Tex>{'e[n]'}</Tex> → 1-bit comparator → GMAC → 除以 <Tex>{'N'}</Tex>、乘 <Tex>{'\\mu'}</Tex> → gain accumulator → quantizer → 回到 gain
          correction。comparator 取的是 PD 的輸出 <Tex>{'e[n]'}</Tex>，也就是送進 loop filter 的同一個訊號，而且只留下它的正負號——補償後的 reference edge 比 feedback edge 晚（<Tex>{'q[n]=+1'}</Tex>）還是早（
          <Tex>{'q[n]=-1'}</Tex>）；GMAC 把 <Tex>{'N'}</Tex> 筆 <Tex>{'q[n]\\,x[n]'}</Tex> 加起來，看誤差和 code 是否還有相關；有，就把 <Tex>{'w'}</Tex> 往抵銷它的方向推一小步（步長由 learning rate{' '}
          <Tex>{'\\mu'}</Tex> 決定）。這一圈每 <Tex>{'N'}</Tex> 個 sample 才動一次，是本站的主題。
        </li>
      </ul>
      <p className="small muted">
        規格 §4 原來的概念圖用的是另一種接法（DTC 接在 divider 那一側）；本站一律照 reference 端 input DTC 的接法畫，上面這張圖也是。兩種接法的 <Tex>{'e[n]=(a-w)\\,x[n]+v[n]'}</Tex> 完全相同，所以各章的數學、手算數字與驗收向量都不受影響。
      </p>
      <p className="small muted">
        六個條件各自取決於這張圖的哪一塊，見
        <button type="button" className="btn btn-icon" style={{ margin: '0 4px', padding: '0 8px' }} onClick={() => scrollToId('dash-spine')}>
          一條方程式
        </button>
        那一節的第一張圖。
      </p>
      <SymbolsJump />
    </section>
  )
})
