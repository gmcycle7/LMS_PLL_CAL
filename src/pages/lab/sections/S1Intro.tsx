import { Callout, ClaimTag, ModeGate, ModelLevel, Section, SourceTag, Tex, TexBlock } from '@/components'
import { ChLink, Diagram, ErratumNote, md, Question } from '../common'
import { PIPELINE_CHART } from '../diagrams'

const T = String.raw

const STAGE_ROWS: { stage: string; eq: string; level: 'L1' | 'L2' | 'L4' | 'L5'; ch: { to: string; label: string }[]; fn: string; assume: string }[] = [
  { stage: '① FCW → DSM', eq: T`r[n]=\sum_{m\le n}\bigl(y[m]-K/M\bigr)`, level: 'L2', ch: [{ to: '/ch/04', label: 'Ch04' }], fn: 'dsm.ts：DsmStream', assume: '理想數位 DSM、零初值；$f_s=f_{\\mathrm{ref}}$' },
  { stage: '② residue → code', eq: T`x=(r-o)\,s`, level: 'L2', ch: [{ to: '/ch/04', label: 'Ch04' }, { to: '/ch/11', label: 'Ch11' }], fn: 'dsm.ts：normalizationParams', assume: '$o$、$s$ 取自整段 record；unit_rms 保留 DC' },
  { stage: '③ DTC', eq: T`e_{\mathrm{DTC}}=(a-w_{\mathrm{app}})x+o_{\mathrm{DTC}}+c_2x^2+c_3x^3`, level: 'L2', ch: [{ to: '/ch/11', label: 'Ch11' }], fn: 'blockLms.ts：inner loop', assume: '靜態非線性；沒有 settling / glitch' },
  { stage: '④ PLL error path', eq: T`u_{\mathrm{pd}}=H_{\mathrm{PD}}\{e_{\mathrm{DTC}}\},\ H_{\mathrm{PD}}=\tfrac{1}{1+L}`, level: 'L2', ch: [{ to: '/ch/06', label: 'Ch06' }, { to: '/ch/07', label: 'Ch07' }], fn: 'unifiedLab.ts：pllDesign；pll.ts：designDtLoop', assume: '線性、時不變 DT 迴路；狀態跨 block 持續' },
  { stage: '⑤ Comparator', eq: T`q=\mathrm{sign}(u_{\mathrm{pd}}+b+v)`, level: 'L1', ch: [{ to: '/ch/05', label: 'Ch05' }], fn: 'blockLms.ts：inner loop', assume: '$v$ iid Gaussian；tie 取 $+1$' },
  { stage: '⑥ GMAC', eq: T`G_k=\tfrac1N\sum_{n\in k}q[n]\,x_{\mathrm{ref}}[n]`, level: 'L2', ch: [{ to: '/ch/04', label: 'Ch04' }, { to: '/ch/09', label: 'Ch09' }], fn: 'blockLms.ts：GMAC update', assume: 'average（或 sum）；raw / delayed / filtered regressor' },
  { stage: '⑦ Gain register', eq: T`w_{\mathrm{app}}=\mathrm{phys}(w_{k-d})`, level: 'L5', ch: [{ to: '/ch/13', label: 'Ch13' }], fn: 'blockLms.ts：gain register', assume: '開啟定點時才是 L5；否則理想浮點' },
  { stage: '⑧ 更新迴路', eq: T`w_{k+1}=w_k+\mu G_k`, level: 'L1', ch: [{ to: '/ch/08', label: 'Ch08' }, { to: '/ch/14', label: 'Ch14' }], fn: 'blockLms.ts：runBlockLms', assume: '更新延遲 $d$ 個 block' },
  { stage: '⑨ 輸出端', eq: T`t_{\mathrm{out}}=T\{e_{\mathrm{DTC}}\},\ T=1-H_{\mathrm{PD}}`, level: 'L4', ch: [{ to: '/ch/12', label: 'Ch12' }], fn: 'unifiedLab.ts：replayPipeline、analyzeOutput', assume: '只含 DTC 殘差這一個雜訊來源；線性、時不變的 $T$' },
]

/** §1–§2：開場問題、整條訊號鏈的方塊圖與「每一級是誰、在哪一章」。（符號表在頁末：sections/S6Symbols.tsx） */
export function S1Intro() {
  return (
    <>
      <section aria-labelledby="lab-s1">
        <h2 id="lab-s1">1｜把十四章接成一條線</h2>
        <Question>
          <p>
            前面每一章各研究校正迴路的一個零件：comparator 的統計、相位造成的極性、更新延遲、bias、雜訊、量化。<strong>把它們接起來之後，改一個旋鈕會一路傳到哪裡？</strong>
          </p>
          <p>
            例如：只把 FCW 的小數部分從 <Tex>{'0.3'}</Tex> 改成 <Tex>{'0.0001'}</Tex>，其他完全不動——校正還收斂嗎？收斂到哪裡？輸出多了幾 dBc 的 spur？這一頁讓你實際跑一次，並且每一級都看得到中間訊號。
          </p>
        </Question>

        <Section kind="intuition" title="直覺：還是那個黑盒子，只是中間多了三道關卡">
          <p>
            第 0 章的黑盒子是 <Tex>{'y=a\\,x'}</Tex>：你看得到輸入 <Tex>x</Tex> 和輸出 <Tex>y</Tex>，要猜 <Tex>a</Tex>。在 fractional-N PLL 裡，
            <Tex>x</Tex> 是 DSM 的 residue（你自己產生的 code，完全已知），<Tex>a</Tex> 是 DTC 的 gain 誤差，<Tex>{'y-wx=(a-w)x'}</Tex> 是 DTC 沒抵銷乾淨的時間誤差。校正就是 LMS：一直調 <Tex>w</Tex> 直到誤差與 code 不再相關。
          </p>
          <p>和黑盒子不同的是，你看不到乾淨的誤差，只看得到它經過三道關卡之後的樣子：</p>
          <ol>
            <li>
              <strong>主 PLL 會動它</strong>：PLL 自己會把看得到的相位誤差修掉，所以 phase detector 看到的是「被 PLL 修過之後剩下的」（high-pass，<Tex>{'H_{\\mathrm{PD}}'}</Tex>），不是原本的誤差。
            </li>
            <li>
              <strong>只剩 1 bit</strong>：comparator 只回答「早了還是晚了」，而且輸入端有比訊號大一百倍的雜訊。
            </li>
            <li>
              <strong>係數只有幾個 bit</strong>：<Tex>w</Tex> 最後要寫進一個 6-bit 的暫存器。
            </li>
          </ol>
          <p>
            另外，你真正在乎的不是 comparator 看到什麼，而是 <strong>PLL 輸出端</strong>的 jitter 與 spur——那是同一個 DTC 誤差走另一條路（low-pass，<Tex>{'T'}</Tex>）的結果。這兩條路不一樣，是整合模擬最容易弄錯的地方。
          </p>
        </Section>
      </section>

      <section aria-labelledby="lab-s2">
        <h2 id="lab-s2">2｜整條訊號鏈：九級、兩條路</h2>
        <Section kind="diagram" title="方塊圖">
          <p>
            先看整條鏈長什麼樣子，再看每一級的式子。箭頭是訊號的流向；標著 <Tex>{'w_{\\mathrm{app}}'}</Tex> 的那條線把校正出來的係數送回 DTC，形成一圈。
          </p>
          <Diagram
            chart={PIPELINE_CHART}
            caption="同一個 DTC 誤差分兩條路：藍色那條經 PD 的 error path（high-pass）到 comparator，是校正迴路看到的；棕色那條經 output transfer（low-pass）到輸出，是使用者看到的。編號對應 Lab 裡的九張 stage 卡片。"
            ariaLabel="FCW 到輸出端的九級訊號流程圖"
          >
            <p>
              先看 DTC 之後的分岔：同一個 <Tex>{'e_{\\mathrm{DTC}}[n]'}</Tex>（DTC 沒抵銷乾淨的時間誤差）一份送進藍色的 <Tex>{'H_{\\mathrm{PD}}'}</Tex>（第 4 級），一份送進棕色的 <Tex>T</Tex>（第 9
              級）。校正迴路是藍色那條路接下去的一圈：第 4 → 5 → 6 → 8 → 7 級，再回到第 3 級的 DTC；第 9 級只是「旁觀」，不在迴路裡。
            </p>
            <p>
              圖上帶 <Tex>{'[n]'}</Tex> 的訊號每個 comparator sample 更新一次；帶下標 <Tex>k</Tex> 的（<Tex>{'G_k'}</Tex>、<Tex>{'w_k'}</Tex>）每 <Tex>N</Tex> 個 sample 才更新一次。圖上的{' '}
              <Tex>{'w_{\\mathrm{app}}'}</Tex> 是「這個 block 實際作用在 DTC 上的係數」，比最新的 <Tex>{'w_k'}</Tex> 晚 <Tex>d</Tex> 個 block。
            </p>
          </Diagram>
          <TexBlock id="F-LAB.1" label="FCW 決定輸出頻率，也決定 DSM residue 這串 code 長什麼樣子。">
            {T`f_{\mathrm{out}}=\Bigl(N_{\mathrm{int}}+\frac KM\Bigr)f_{\mathrm{ref}},\qquad r[n]=\sum_{m=0}^{n}\Bigl(y[m]-\frac KM\Bigr)`}
          </TexBlock>
        </Section>

        <Section kind="formula" title="每一級的式子、模型層級、對應章節與實際執行的程式">
          <div className="table-wrap">
            <table className="lab-table">
              <thead>
                <tr>
                  <th>級</th>
                  <th>這一級做的事</th>
                  <th>模型層級</th>
                  <th>細節在哪一章</th>
                  <th>實際執行的程式</th>
                  <th>主要假設</th>
                </tr>
              </thead>
              <tbody>
                {STAGE_ROWS.map((r) => (
                  <tr key={r.stage}>
                    <th scope="row" className="nowrap">
                      {r.stage}
                    </th>
                    <td className="lab-formula-cell">
                      <Tex>{r.eq}</Tex>
                    </td>
                    <td>
                      <ModelLevel level={r.level} />
                    </td>
                    <td className="nowrap">
                      {r.ch.map((c) => (
                        <ChLink key={c.to} to={c.to}>
                          {c.label}
                        </ChLink>
                      ))}
                    </td>
                    <td className="small mono">{r.fn}</td>
                    <td className="small">{md(r.assume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small">
            整個實驗的模型層級取最高的那一級：沒開定點時是 <ModelLevel level="L4" />（有輸出端的 PSD / jitter），開了 6-bit 暫存器是 <ModelLevel level="L5" />。它<strong>不是</strong> <ModelLevel level="L6" />：主 PLL
            是線性模型，沒有 VCO 非線性、沒有 lock 過程，也沒有多速率。
          </p>
        </Section>

        <Section kind="assumptions" title="這個 Lab 能回答什麼、不能回答什麼">
          <div className="grid-2">
            <Callout kind="ok" title="可以回答">
              <ul className="small">
                <li>{md('某組 FCW / delay / $\\mu$ / $N$ 下，更新極性對不對（$C>0$？）、平均會不會收斂（$\\rho<1$？）')}</li>
                <li>收斂到哪裡（bias）、抖多大（{md('$\\sigma_w$')}）、多久收斂（{md('$\\tau$')}）</li>
                <li>殘差在輸出端變成多少 jitter、在哪個頻率留下多大的 tone（在這個線性模型下）</li>
                <li>解析公式與逐 sample 模擬差多少；哪些情況解析公式不能用（例如 code 的統計隨時間變、comparator 離開線性區）</li>
              </ul>
            </Callout>
            <Callout kind="warn" title="不能回答">
              <ul className="small">
                <li>某顆晶片實際量到的 spur：那需要它的 DTC INL、mismatch、supply coupling 與量測</li>
                <li>VCO / reference / PD 本身的 phase noise：這裡的輸出只有 DTC 殘差這一項</li>
                <li>
                  {md('$q$ 就是主迴路 BBPD 的架構（shared BBPD）：本頁的 comparator 是獨立的觀測路徑')}（<ErratumNote id="E03" />）
                </li>
                <li>多參數（GOS / PHOS）同時更新的閉迴路：只在 Training 分頁做線性化的可辨識性分析</li>
              </ul>
            </Callout>
          </div>
          <p className="small">
            標籤的讀法：<ClaimTag kind="exact" /> 是在指定模型下的精確結果（封閉式或逐位元可重現），<ClaimTag kind="approx" /> 是有適用範圍的近似，<ClaimTag kind="research" /> 是延伸假說。本頁所有圖表的來源都是{' '}
            <SourceTag kind="simulation" />（瀏覽器內即時計算），沒有任何量測資料。
          </p>
          <ModeGate min="research">
            <Callout kind="info" title="Research：與規格 §15.2 參考模型的關係">
              <p className="small">
                {md(
                  '迴路本身完全交給 `runBlockLms`（第 15 章頁面的參考 Block Sign-LMS）；本頁的 `unifiedLab.ts` 只做三件事：(1) 把 FCW / PLL 頻寬這類「設計語言」的參數換成它的設定；(2) 用同一個 seed 把每個 sample 重播一次，取出中間訊號並驗證與迴路逐位元一致，同時算出「把雜訊平均掉」的 mean-field 平均軌跡（§5.2）；(3) 加上輸出端（$T$）與 sweep / Monte Carlo / 序列分析。所以這裡看到的收斂行為與第 15 章的 JSON Lab 是同一份程式。',
                )}
              </p>
            </Callout>
          </ModeGate>
        </Section>
      </section>
    </>
  )
}
