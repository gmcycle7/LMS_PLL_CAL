import { Section, SystemMap, Tex } from '@/components'
import { MAP_FOCUS } from '../diagrams'
import { Diagram, FigRef, r } from '../common'

/**
 * 章首的系統地圖（全站共用的 <SystemMap>）：標出本章在整個 PLL 校正系統中的位置。
 * 全站地圖（docs/assumptions.md §2a）和本章的晶片是同一種接法：DTC 在 reference 輸入端、回授路徑上只有 Divider／PMUX、
 * LMS 校正迴路的輸入取自 PD 的輸出。地圖下面用一句話說明對應關係，並把本章特有的細節（8 相 PMUX、DTC 只補一格 Δ）指到 §2。
 */
export function PageMap() {
  return (
    <div className="cs-map">
      <p>
        <strong>先看你在系統的哪裡。</strong>下圖是全站共用的系統地圖，藍色方塊是本章的主角：reference 輸入端的 DTC 與整個<strong>主 PLL 迴路</strong>（phase detector、loop filter、VCO、divider／PMUX），加上小數累加器與它產生的 regressor、1-bit 比較器、code 對齊與 GMAC。其他章把「誤差到
        PD 的響應」<Tex>{r`H_{PD}`}</Tex> 當成已知；本章把主迴路打開，算出 <Tex>{r`H_{PD}=1/(1+L)`}</Tex> 的實部在哪些頻率是負的，以及它怎麼讓 GMAC 的平均梯度反號。
      </p>
      <SystemMap
        focus={MAP_FOCUS}
        caption="系統地圖：藍色是本章的主角——reference 輸入端的 DTC、整個主 PLL 迴路（PD、loop filter、VCO、divider／PMUX）、小數累加器與 regressor，以及校正迴路的比較器、code 對齊與 GMAC。教學用概念架構，不是特定晶片的 netlist。"
      />
      <p className="small muted">
        地圖和你的晶片是同一種接法：reference 先經過 <strong>input DTC</strong> 才進 PD，回授路徑上只有地圖的「Divider / PMUX」——在你的晶片就是 8 相 PMUX；LMS 校正迴路的輸入取自 <strong>PD 的輸出</strong> <Tex>{'e[n]'}</Tex>（本章記為 <Tex>{r`e_{PD}[n]`}</Tex>），也就是送進 loop filter
        的同一個訊號。本章特有的細節——PMUX 粗調、DTC 只補一格 <Tex>{r`\Delta=T_{vco}/8`}</Tex> 以內、GOS 加 PHOS 共 9 個權重——見 §2 的 <FigRef id="sspll" />。
      </p>
    </div>
  )
}

/** §1 本章路線圖（原本這一節是符號表；符號表已移到章末 §21）。 */
export function S01Roadmap() {
  return (
    <Section kind="diagram" level={2} title="1. 本章路線圖：每一節回答什麼" id="cs-1">
      <p>
        這一章很長，但主線只有一條：<strong>誤差先被主迴路改造，LMS 看到的是改造後的版本</strong>。先用一張圖記住每一節在回答哪個問題，讀到一半迷路時再回來看。
      </p>
      <Diagram id="roadmap" />
      <p>
        先看藍色的三格：§3 算出誤差到 PD 的轉移函數 <Tex>{r`H_{PD}`}</Tex>；§4 說明 LMS 的平均梯度是「regressor 的功率」乘上 <Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex> 的加權和；§5、§6 找出 <Tex>{r`\mathrm{Re}\,H_{PD}<0`}</Tex>{' '}
        的頻帶。這三格就回答了「為什麼會反號」。再看下面的兩條支線：GOS 的 regressor 是鋸齒（§7），PHOS 的 regressor 是 8 個 one-hot（§8），兩者的功率落在不同的頻率，所以命運不同。最後三格是工程上要做的事：對策（§11）、線性分析漏掉的兩個效應（§12、§13），以及
        checklist（§15）。
      </p>
      <p className="small muted">
        只想要結論：看 §0 與 §15。想知道對策改的是哪一個方塊：直接跳到 §11 的 <FigRef id="remedy-g" />。
      </p>
    </Section>
  )
}
