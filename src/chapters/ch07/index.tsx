import { Callout, ClaimTag, Mermaid, ModelLevel, Section, SystemMap, Tex, TestBadge, ChRef } from '@/components'
import { useSettings } from '@/app/settings'
import { CHART_HANDCALC_FLOW, CH07_SYSTEM_FOCUS } from './diagrams'
import { Hand } from './Hand'
import { S1Problem } from './sections/S1Problem'
import { S2DelayDerivation } from './sections/S2DelayDerivation'
import { S3LinearPhase } from './sections/S3LinearPhase'
import { S4Gradient } from './sections/S4Gradient'
import { S5Mismatch } from './sections/S5Mismatch'
import { S6Hardware } from './sections/S6Hardware'
import { S7Wrapup } from './sections/S7Wrapup'
import { S8Symbols } from './sections/S8Symbols'
import { DelayFxLab } from './experiments/DelayFxLab'
import './chapter.css'

const r = String.raw

/** Chapter 07：Delay Alignment vs. Filtered-x LMS（規格 §7；課程第 7 課）。 */
export default function Chapter07() {
  const { mode } = useSettings()
  return (
    <div className="ch07">
      <p className="ch07-lead">
        <ChRef ch="06">Ch06</ChRef> 證明了：PLL 的誤差路徑 <Tex>{r`H_{\mathrm{PD}}`}</Tex> 可以讓 GMAC 的相關 <Tex>{'C=E[xu]'}</Tex>（原始 code <Tex>{'x'}</Tex> 與 comparator 實際看到的 code <Tex>{'u'}</Tex> 相乘後的平均）變號，LMS 往錯的方向更新，而且
        <strong>減小 learning rate 改不了符號</strong>。本章比較兩種修法：把 GMAC 的 code <strong>延遲</strong>幾個 sample（delay alignment），或用 PLL 誤差路徑的<strong>模型</strong>把 code 濾一次（filtered-x）。我們會推導它們何時有效、何時失效，算出硬體成本，並在同一個 seed
        下比較閉迴路。
      </p>
      <SystemMap focus={CH07_SYSTEM_FOCUS} />
      <p className="c-map-note">
        <strong>你在這裡：</strong>藍色的三塊是本章的主角——小數殘量 <Tex>{'x[n]'}</Tex>（GMAC 的 regressor 從這裡來）、code alignment（delay／filtered-x，本章要設計的方塊）、GMAC（把 comparator 的輸出 <Tex>{'q[n]'}</Tex> 和 regressor 相乘、累加；comparator 取的是 PD 的輸出 <Tex>{'e[n]'}</Tex>，也就是送進 loop filter 的同一個訊號）。沒有上色的主 PLL
        迴路（DTC 在 reference 輸入端，回授路徑上只有 divider）決定了誤差路徑 <Tex>{r`H_{\mathrm{PD}}`}</Tex>，本章完全不動它；本章新增的只有「GMAC 拿哪一個訊號當 regressor」這一件事：直接用 <Tex>{'x[n]'}</Tex>、先延遲 <Tex>{'D'}</Tex> 個 sample、或先經過 PLL 的模型 <Tex>{r`\hat H`}</Tex>。
      </p>
      {/* 章首骨架（本章資訊、先備自檢）由 PageFrame 放在上面的系統地圖之後（docs/teaching-style.md §9） */}
      <div className="c-tag-row">
        <ModelLevel level="L2" /> <TestBadge id="T07" /> <ClaimTag kind="exact" />
      </div>
      {mode === 'beginner' && (
        <Callout kind="info" title="入門模式：先抓住三句話">
          <ol>
            <li>GMAC 是在算「code 和 comparator 看到的誤差同不同步」；PLL 讓誤差晚到，就把 code 也延遲同樣的時間。</li>
            <li>但延遲只能對準一個頻率；code 若有很多頻率（DSM），要用 PLL 的模型 <Tex>{r`\hat H`}</Tex> 把 code 濾一次（filtered-x）。</li>
            <li>
              模型若錯太多（相位差超過 <Tex>{r`90^\circ`}</Tex>），filtered-x 一樣會反向更新。入門模式下推導預設收合（點「推導」展開，boxed 結論仍會顯示）；可以先看 7.1
              節的數字和 7.7 節的 Lab，再回頭展開。
            </li>
          </ol>
        </Callout>
      )}
      <S1Problem />
      <S2DelayDerivation />
      <S3LinearPhase />
      <S4Gradient />
      <S5Mismatch />
      <S6Hardware />
      <Section kind="explore" level={2} title="7.7 動手觀察：Delay / Filtered-x Lab" id="ch07-lab">
        <p>
          三模式切換（raw-x / delayed-x / filtered-x）、<Tex>{r`\hat H`}</Tex> 的頻寬／latency／相位／增益誤差、<Tex>{'x'}</Tex>、<Tex>{'u'}</Tex>、
          <Tex>{'x_D'}</Tex>、<Tex>{'u_f'}</Tex> 疊圖、相關 vs <Tex>{'D'}</Tex>，以及 A/B/C 同 seed 的閉迴路。可從 Experiment Gallery 的 #4「<Tex>{r`\phi=-120^\circ`}</Tex>、<Tex>{'D=4'}</Tex>」直接載入。
        </p>
        <p className="small muted">
          注意振幅：Lab 把 code 正規化成 unit power（單頻時 <Tex>{r`A=\sqrt2`}</Tex>、<Tex>{r`A^2/2=1`}</Tex>），所以 7.1 節手算（<Tex>{'A=1'}</Tex>）的
          <Tex>{r`C_0=-0.25`}</Tex>、<Tex>{r`C_4=+0.5`}</Tex> 在 Lab 裡顯示為 <Tex>{r`-0.5`}</Tex>、<Tex>{r`+1`}</Tex>——剛好 2 倍，符號與相位完全相同。
        </p>
        <DelayFxLab />
        <h3 className="ch07-subhead">綜合手算：三種 regressor 的 pole，先用手算、再和 Lab 對答案</h3>
        <p>
          先看計算的順序：同一組輸入分成三條支線算出三個相關，再各自換成 pole。
        </p>
        <Mermaid
          chart={CHART_HANDCALC_FLOW}
          caption={r`綜合手算的流程：①–④ 算三種 regressor 的相關，⑤–⑥ 算三個 pole 共用的 $\mu K_q$（藍色），⑦–⑨ 各做一次「1 減乘積」，最後看 pole 落在哪裡。`}
        />
        <p>
          先看 ① 到 ④：raw-x 的相關直接用 <Tex>{r`\cos\phi`}</Tex>；delayed-x 要先算殘餘相位 <Tex>{r`\theta`}</Tex> 再取 <Tex>{r`\cos`}</Tex>；filtered-x（<Tex>{r`\hat H=H`}</Tex>）的相關就是
          <Tex>{r`|H|^2`}</Tex>，不必算角度。再看藍色的 ⑥：三個 pole 都要乘同一個 <Tex>{r`\mu K_q`}</Tex>，只算一次。圖上 ⑦、⑧、⑨ 三格就是公式 <Tex>{r`p=1-\mu K_qC`}</Tex> 代入三個不同的
          <Tex>{'C'}</Tex>；格子的先後順序和下面手算題的 12 個步驟一致（圖上一格對應一到兩步）。
        </p>
        <Hand id="HC-07.8">
          進入思考題之前，把整章的公式串起來算一次：同一個單頻例子，分別算 raw-x、delayed-x、filtered-x 的相關與平均 pole。預設值就是 Lab
          的預設（Gallery #4）——先用紙筆和計算機算，再看上面 Lab 的指標表與閉迴路結果是不是同一組數字；然後把 <Tex>{r`\phi`}</Tex>、<Tex>{'D'}</Tex>、
          <Tex>{r`\mu`}</Tex> 換成你自己的。
        </Hand>
      </Section>
      <S7Wrapup />
      <S8Symbols />
    </div>
  )
}
