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
        系統地圖：整個網站都在講這張圖 <span className="dash-h2-kicker">規格 §4 的概念架構</span>
      </h2>
      <p className="dash-lead-sm">
        每一章開頭都會出現同一張圖，並用藍色標出那一章的主角，讓你知道「現在在系統的哪裡」。首頁談的是整個系統——六個條件分散在每一塊上——所以全部是藍色。先認得三個框，再往下看。
      </p>
      <SystemMap
        focus={DASH_SYSTEM_FOCUS}
        caption="系統地圖：每一章開頭都是這張圖，藍色標出該章的主角；首頁談整個系統，所以全部是藍色。實線是訊號流，虛線是 phase detector 的誤差被拿去給校正迴路觀察。教學用概念架構，不是特定晶片的 netlist。"
      />
      <ul className="dash-map-list">
        <li>
          <strong>主 PLL 迴路（快）</strong>：reference → phase detector → loop filter → VCO → divider → DTC → 回到 phase detector。它把輸出頻率鎖在 reference 的倍數上，每個 reference 週期都在動。
        </li>
        <li>
          <strong>小數除頻與補償</strong>：FCW → DSM → fractional residue → gain correction → DTC。DSM 讓除數在相鄰整數之間切換來得到小數倍頻；切換留下一把已知的相位鋸齒（記作 code <Tex>{'x[n]'}</Tex>，<Tex>{'n'}</Tex>{' '}
          數的是 reference 週期），由 DTC 產生相反的延遲把它抵銷。抵銷得準不準，就看乘在 code 上的校正係數 <Tex>{'w'}</Tex>。
        </li>
        <li>
          <strong>LMS 校正迴路（慢）</strong>：phase error → 1-bit comparator → GMAC → 除以 <Tex>{'N'}</Tex>、乘 <Tex>{'\\mu'}</Tex> → gain accumulator → quantizer → 回到 gain correction。comparator 只回答「早了還是晚了」（輸出{' '}
          <Tex>{'q[n]=\\pm1'}</Tex>）；GMAC 把 <Tex>{'N'}</Tex> 筆 <Tex>{'q[n]\\,x[n]'}</Tex> 加起來，看誤差和 code 是否還有相關；有，就把 <Tex>{'w'}</Tex> 往抵銷它的方向推一小步（步長由 learning rate <Tex>{'\\mu'}</Tex>{' '}
          決定）。這一圈每 <Tex>{'N'}</Tex> 個 sample 才動一次，是本站的主題。
        </li>
      </ul>
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
