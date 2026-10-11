import { Callout, Section, Tex, TexBlock } from '@/components'
import { phaseSequence } from '@/simulation/models/sspll'
import { FREF_MHZ, SIM_CFG } from '../data'
import { Claim, DataTable, Diagram, FigRef, Src, fx, r } from '../common'

const ALPHA_EX = 0.137

/** §2 架構：SSPLL + 8 相 PMUX + input DTC，小數相位的拆法、兩個誤差的注入點、極性約定與 regressor 的手算表。 */
export function S02Architecture() {
  const seq = phaseSequence(ALPHA_EX, 10, 'right')
  const beta = (8 * ALPHA_EX) % 1
  return (
    <Section kind="diagram" level={2} title="2. 架構：誤差從哪裡進來" id="cs-2">
      <p>
        分數除頻要讓 feedback 的 edge 每拍多走 <Tex>{r`\alpha`}</Tex> 個 VCO 週期。你的做法是把這個小數相位拆成兩段：粗的一段由 feedback 端的 <strong>8 相 PMUX</strong> 選相位，每格是 <Tex>{r`\Delta=T_{vco}/8`}</Tex>（<Tex>{r`T_{vco}=1/f_{vco}`}</Tex> 是 VCO
        的週期；插圖值 <Tex>{`\\Delta=${SIM_CFG.deltaPs}`}</Tex> ps）；剩下不到一格的細部由 reference 端的 <strong>input DTC</strong>（digital-to-time converter，把數位 code 變成延遲）補上。
      </p>
      <Diagram id="sspll" />
      <p>
        先看主迴路：reference 經過 DTC、VCO 經過 PMUX，兩邊在「相位比較點」（SSPD 的取樣節點）相比，差值經 loop filter 回去控制 VCO。再看校正迴路：1-bit 比較器從同一個比較點取出正負號 <Tex>{'q'}</Tex>，和分數累加器送來的 regressor 一起進 GMAC；sign-error LMS 用 GMAC
        的結果更新 9 個權重（GOS 的 <Tex>{'w_g'}</Tex> 與 PHOS 的 <Tex>{r`w_0,\dots,w_7`}</Tex>），再送回 DTC 去修正延遲。兩個迴路共用同一個比較點，這就是主迴路會影響校正的原因。
      </p>

      <h3>
        小數相位怎麼拆成 <Tex>{'p[n]'}</Tex> 與 <Tex>{r`\rho[n]`}</Tex>
      </h3>
      <p>
        分數累加器每拍把 <Tex>{r`\alpha`}</Tex> 加進去、只留小數部分，得到累積的小數相位 <Tex>{r`\varphi[n]`}</Tex>（單位是 VCO 週期）。把它乘以 8，整數部分告訴 PMUX 該選第幾相，小數部分就是 DTC 還要補的量：
      </p>
      <Diagram id="phase-split" />
      <p>
        先看上半部的迴圈：<Tex>{r`z^{-1}`}</Tex> 表示延遲一拍，所以加法點的輸出是「上一拍的 <Tex>{r`\varphi`}</Tex> 加上 <Tex>{r`\alpha`}</Tex>」，取小數（<Tex>{r`\mathrm{frac}(x)=x-\lfloor x\rfloor`}</Tex>）之後就是這一拍的 <Tex>{r`\varphi[n]`}</Tex>。再看下半部：乘以 8 之後，floor
        方塊的輸出就是公式裡的 <Tex>{'p[n]'}</Tex>；第二個加法點把 <Tex>{r`8\varphi[n]`}</Tex> 減掉 <Tex>{'p[n]'}</Tex>，輸出就是公式裡的 <Tex>{r`\rho[n]`}</Tex>。
      </p>
      <TexBlock>{r`\varphi[n]=\mathrm{frac}(n\alpha),\qquad p[n]=\lfloor 8\,\varphi[n]\rfloor\in\{0,\dots,7\},\qquad \rho[n]=8\,\varphi[n]-p[n]\in[0,1)`}</TexBlock>
      <p>
        同樣這兩個數也是 LMS 的 <strong>regressor</strong> <Tex>{'x_i[n]'}</Tex>（共 9 條）：<Tex>{r`x_0[n]=\rho[n]`}</Tex> 給 GOS 用；<Tex>{r`x_{1+k}[n]=\mathbf 1\{p[n]=k\}`}</Tex> 給第 <Tex>{'k'}</Tex> 相的 PHOS 用，<Tex>{r`\mathbf 1\{\cdot\}`}</Tex> 是指示函數（括號裡成立時為
        1，否則為 0），所以每一拍 8 條裡只有一條是 1，這就是「one-hot」。
      </p>

      <h3>兩個誤差的注入點</h3>
      <ul>
        <li>
          <strong>GOS（DTC gain error）</strong>：DTC 在 reference 端。理想的延遲是 <Tex>{r`\rho\Delta`}</Tex>，實際的延遲是 <Tex>{r`(1-a)(1+w_g)\rho\Delta`}</Tex>：<Tex>{'a'}</Tex> 是 DTC 的增益誤差（真值，未知），<Tex>{'w_g'}</Tex> 是 LMS 對它的估計。理想模型下，比較點多出{' '}
          <Tex>{r`e_{GOS}[n]=(a-w_g)\,\rho[n]\,\Delta`}</Tex>。
        </li>
        <li>
          <strong>PHOS（PMUX phase offset）</strong>：PMUX 在 feedback 端。選到第 <Tex>{'k'}</Tex> 相時，edge 多出一個固定的時間偏差 <Tex>{r`\varepsilon_k`}</Tex>（真值，未知）；這個偏差經由 reference 端的 DTC 用估計值 <Tex>{'w_k'}</Tex> 補回來。所以{' '}
          <Tex>{r`e_{PHOS}[n]=\sum_k(\varepsilon_k-w_k)\,\mathbf 1\{p[n]=k\}`}</Tex>。
        </li>
      </ul>
      <Diagram id="injection" />
      <p>
        先看最上面的兩個乘法點（左邊是 GOS、右邊是 PHOS）：每個誤差都是「還沒校掉的量」乘上它的 regressor。本章把「真值 − 估計」記為 <Tex>{r`\delta`}</Tex>，也就是 <Tex>{r`\delta_g=a-w_g`}</Tex>、<Tex>{r`\delta_k=\varepsilon_k-w_k`}</Tex>；權重校準好的時候 <Tex>{r`\delta=0`}</Tex>，誤差就消失。再看下面：兩個誤差在比較點相加成{' '}
        <Tex>{'u[n]'}</Tex>，但 PD 看到的不是 <Tex>{'u[n]'}</Tex>，而是它通過藍色方塊之後的 <Tex>{r`e_{PD}[n]`}</Tex>。圖上加法點的輸出就是下面公式裡的 <Tex>{'u[n]'}</Tex>：
      </p>
      <TexBlock>{r`u[n]=\underbrace{(a-w_g)\,\Delta\;\rho[n]}_{e_{GOS}[n]}+\underbrace{\sum_{k=0}^{7}(\varepsilon_k-w_k)\,\mathbf 1\{p[n]=k\}}_{e_{PHOS}[n]}=\sum_j\delta_j\,x_j[n]`}</TexBlock>
      <p className="small muted">
        最後一個等號把 GOS 的 <Tex>{r`\Delta`}</Tex> 併進 <Tex>{r`\delta_0`}</Tex>，9 個誤差就寫成同一個形式；§4 會用到。藍色方塊 <Tex>{r`H_{PD}`}</Tex> 怎麼來，是 §3 的主題。
      </p>
      <Callout kind="info" title="極性約定">
        <p>
          reference 端與 feedback 端的誤差在比較點的符號相反。我們規定：在 <Tex>{r`H_{PD}\equiv1`}</Tex>（沒有迴路）時，<Tex>{r`w\leftarrow w+\mu\,q\,r`}</Tex> 會往正確方向更新，並用這個規定吸收兩邊的符號——所以 <FigRef id="injection" /> 的兩條線都標「＋」。這裡{' '}
          <Tex>{r`\mu`}</Tex> 是步長，<Tex>{r`q=\pm1`}</Tex> 是比較器輸出，<Tex>{'r'}</Tex> 是 GMAC 實際拿來相乘的 regressor（不做任何處理時 <Tex>{'r=x'}</Tex>）。實作時，GOS 與 PHOS 的更新符號要<strong>各自</strong>依 <Tex>{r`H\equiv1`}</Tex> 推導，因為 PHOS 的修正是透過 reference 端的 DTC
          加上去的，誤差卻來自 feedback 端。
        </p>
      </Callout>
      <p>
        注意：§4 會把「平均梯度的斜率」寫成矩陣 <Tex>{'C'}</Tex>，它只依賴 regressor 每條譜線的功率 <Tex>{r`\lvert c_\nu\rvert^2`}</Tex> 與一個頻域 kernel <Tex>{r`\Gamma`}</Tex>。所以 DTC code 用 <Tex>{r`\rho`}</Tex> 或 <Tex>{r`1-\rho`}</Tex>、PMUX 索引用 <Tex>{'p'}</Tex> 或{' '}
        <Tex>{'p+1'}</Tex>、PMUX 旋轉方向（§8 的模態特徵值滿足 <Tex>{r`\mathrm{Re}\lambda_m=\mathrm{Re}\lambda_{8-m}`}</Tex>）都<strong>不會</strong>改變反號結論。
        <Claim kind="exact" />
      </p>

      <h3>先看一次 regressor 長什麼樣（<Tex>{`\\alpha=${ALPHA_EX}`}</Tex>）</h3>
      <DataTable
        className="cs-num"
        head={[<Tex key="n">{'n'}</Tex>, ...seq.p.map((_, n) => String(n))]}
        rows={[
          [<Tex key="p">{'p[n]'}</Tex>, ...seq.p.map((v) => String(v))],
          [<Tex key="r">{r`\rho[n]`}</Tex>, ...seq.rho.map((v) => fx(v, 3))],
        ]}
      />
      <p>
        <Tex>{`8\\alpha=${fx(8 * ALPHA_EX, 3)}`}</Tex>：PMUX 每拍前進約 1 相，旋轉一圈約 8 拍，所以 mode-1 的頻率是 <Tex>{`\\alpha f_{ref}=${fx(ALPHA_EX * FREF_MHZ, 0)}`}</Tex> MHz。<Tex>{r`\rho`}</Tex> 每拍增加{' '}
        <Tex>{`\\beta=\\mathrm{frac}(8\\alpha)=${fx(beta, 3)}`}</Tex>，是一個頻率 <Tex>{`\\beta f_{ref}=${fx(beta * FREF_MHZ, 0)}`}</Tex> MHz 的慢鋸齒。這兩個頻率（PMUX 的旋轉、鋸齒的基頻）就是後面決定 PHOS 與 GOS 命運的主角。
      </p>
      <Src>
        由 <code>sspll.ts</code> 的 <code>phaseSequence</code> 即時產生（floor 約定）；與 golden 的 <code>worked_examples.json</code> 在測試中比對。
      </Src>
    </Section>
  )
}
