import { Callout, ModeGate, Section, Tex, TexBlock } from '@/components'
import { phaseSequence } from '@/simulation/models/sspll'
import { FREF_MHZ, SIM_CFG } from '../data'
import { Claim, DataTable, Diagram, FigRef, Src, fx, r, tx } from '../common'

const ALPHA_EX = 0.137

/**
 * §2 架構：SSPLL + 8 相 PMUX + input DTC，小數相位的拆法、哪一條 edge 被延遲、兩個誤差的注入點、極性約定與 regressor 的手算表。
 * 接法與時間的寫法照 docs/assumptions.md §2a：DTC 在 reference 輸入端，延遲 = T_0 − 補償量；PD 量 t_ref′ − t_fb；
 * 比較器取 PD 的輸出（送進 loop filter 的同一個訊號）。數學（u、e_GOS、e_PHOS、δ = 真值 − 估計）不變。
 * 「理想模型」＝只留一階：實際的乘法 (1 − a)(1 + w_g) 展開後略去 a·w_g（以及它乘在 w_k 上的那一項）；不略去時零點在 w_g = a/(1 − a)。
 * 文中的例子數字（0.03093、7.03 fs、234.4 fs）由 SIM_CFG 算出，不手寫。
 */
export function S02Architecture() {
  const seq = phaseSequence(ALPHA_EX, 10, 'right')
  const beta = (8 * ALPHA_EX) % 1
  // 理想模型略去的 a·w_g 有多大（插圖值）：精確零點 a/(1 − a)、權重停在 w_g = a 時的殘餘 a²Δ、起始誤差 aΔ
  const aG = SIM_CFG.a
  const wgExact = aG / (1 - aG)
  const gosInitFs = aG * SIM_CFG.deltaPs * 1000
  const gosAtAFs = aG * aG * SIM_CFG.deltaPs * 1000
  return (
    <Section kind="diagram" level={2} title="2. 架構：誤差從哪裡進來" id="cs-2">
      <p>
        分數除頻要讓 feedback 的 edge 每拍多走 <Tex>{r`\alpha`}</Tex> 個 VCO 週期。你的做法是把這個小數相位拆成兩段：粗的一段由 feedback 端的 <strong>8 相 PMUX</strong> 選相位，每格是 <Tex>{r`\Delta=T_{vco}/8`}</Tex>（<Tex>{r`T_{vco}=1/f_{vco}`}</Tex> 是 VCO
        的週期；插圖值 <Tex>{`\\Delta=${SIM_CFG.deltaPs}`}</Tex> ps）；剩下不到一格的細部由 reference 端的 <strong>input DTC</strong>（digital-to-time converter，把數位 code 變成延遲）補上。
      </p>
      <Diagram id="sspll" />
      <p>
        先看主迴路：reference 先經過 DTC、VCO 經過 PMUX，兩條 edge 在 SSPD（phase detector，本章也叫它「相位比較點」）相比，PD 的輸出 <Tex>{r`e_{PD}`}</Tex> 經 loop filter 回去控制 VCO。回授路徑上只有 PMUX；DTC 在 reference 的輸入端，不在回授路徑上。再看校正迴路：1-bit
        比較器取的是 <strong>PD 的輸出</strong> <Tex>{r`e_{PD}[n]`}</Tex>，也就是送進 loop filter 的同一個訊號——圖上藍色的「PD 輸出」分出兩條線，一條給 loop filter，一條給比較器。比較器只留下它的正負號 <Tex>{'q'}</Tex>，和 regressor（分數累加器算出的 <Tex>{r`\rho[n]`}</Tex> 與{' '}
        <Tex>{'p[n]'}</Tex> 的 one-hot，圖上標著 regressor 的那一格）一起進 GMAC；sign-error LMS 用 GMAC 的結果更新 9 個權重（GOS 的 <Tex>{'w_g'}</Tex> 與 PHOS 的 <Tex>{r`w_0,\dots,w_7`}</Tex>），再送回 DTC 去修正它的補償量。兩個迴路共用同一個 PD 輸出，這就是主迴路會影響校正的原因。
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

      <h3>哪一條 edge 被延遲：DTC 從基準延遲往回扣</h3>
      <p>
        以理想的比較時刻為基準。小數相位累積到 <Tex>{r`\varphi[n]`}</Tex> 時，沒有補償的 feedback edge 會<strong>早到</strong> <Tex>{r`\varphi[n]\,T_{vco}=8\varphi[n]\Delta`}</Tex>。PMUX 選第 <Tex>{'p[n]'}</Tex> 相，把它往後挪 <Tex>{r`p[n]\Delta`}</Tex>，所以 PMUX 之後的 feedback edge 還早到{' '}
        <Tex>{r`\rho[n]\Delta`}</Tex>：粗調只能對到格線，還差不到一格。這一段由 DTC 補。DTC 在 reference 的輸入端，動不到 feedback edge，所以要對齊，就得讓 reference edge 也早同樣的時間。但 DTC <strong>只能延遲、不能提前</strong>；做法是先給 reference 一個固定的基準延遲{' '}
        <Tex>{'T_0'}</Tex>，再從 <Tex>{'T_0'}</Tex> 往回扣：
      </p>
      <TexBlock>{r`\tau_{DTC}[n]=T_0-\underbrace{\rho[n]\,\Delta}_{\text{補償量}}`}</TexBlock>
      <p>
        <Tex>{r`\rho[n]`}</Tex> 越大，DTC 的延遲越短：送進 DTC 的數位 code 是一個固定的中心值 <Tex>{'C_0'}</Tex> 減去補償量對應的 code，等於把 <Tex>{r`\rho[n]`}</Tex> 取補數。延遲不能是負的，所以 <Tex>{'T_0'}</Tex> 至少要有補償量的最大值那麼長（一格 <Tex>{r`\Delta`}</Tex>{' '}
        再加上 PHOS 修正的餘量）。<Tex>{'T_0'}</Tex> 是常數，PLL 把它當成靜態相位偏移吸收掉，不影響任何會動的量。本章把 DTC 從 <Tex>{'T_0'}</Tex> 扣掉的那一段時間叫做 DTC 的<strong>補償量</strong>——reference edge 被提前（也就是少延遲）的時間。PD 量的是「DTC 之後的 reference edge 減
        feedback edge」，<Tex>{r`t_{ref}'[n]-t_{fb}[n]`}</Tex>：補得不夠時 reference edge 還是太晚，誤差為正。所以下面兩個誤差都是「該補的量」減掉「實際補上的量」。
      </p>

      <h3>兩個誤差的注入點</h3>
      <ul>
        <li>
          <strong>GOS（DTC gain error）</strong>：DTC 在 reference 端。理想的補償量是 <Tex>{r`\rho\Delta`}</Tex>，實際的補償量是 <Tex>{r`(1-a)(1+w_g)\rho\Delta`}</Tex>：<Tex>{'a'}</Tex> 是 DTC 的增益誤差（真值，未知），<Tex>{'w_g'}</Tex> 是 LMS 對它的估計。兩者相減，比較點（PD 的輸入端）多出{' '}
          <Tex>{r`\rho\Delta-(1-a)(1+w_g)\,\rho\Delta=(a-w_g+a\,w_g)\,\rho\Delta`}</Tex>。<Tex>{'a'}</Tex> 與 <Tex>{'w_g'}</Tex> 都遠小於 1（<Tex>{'w_g'}</Tex> 從 0 往 <Tex>{'a'}</Tex> 附近走），乘積 <Tex>{r`a\,w_g`}</Tex> 最多約 <Tex>{'a^2'}</Tex>（插圖值{' '}
          <Tex>{`a=${aG}`}</Tex> 時是 <Tex>{tx(aG * aG, 4)}</Tex>）。本章的<strong>理想模型</strong>把這一項略去——這是只留一階的近似，條件是 <Tex>{r`\lvert a\rvert\ll1`}</Tex>、<Tex>{r`\lvert w_g\rvert\ll1`}</Tex>——得到{' '}
          <Tex>{r`e_{GOS}[n]=(a-w_g)\,\rho[n]\,\Delta`}</Tex>。
          <Claim kind="approx">
            略去 <Tex>{r`a\,w_g`}</Tex>
          </Claim>
          不略去的話，誤差剛好為 0 的條件是 DTC 的總增益 <Tex>{r`(1-a)(1+w_g)=1`}</Tex>，也就是 <Tex>{r`w_g=a/(1-a)`}</Tex>，不是 <Tex>{r`w_g=a`}</Tex>。例：<Tex>{`a=${aG}`}</Tex> 時 <Tex>{`a/(1-a)=${tx(wgExact, 5)}`}</Tex>；如果權重停在{' '}
          <Tex>{r`w_g=a`}</Tex>，以 <Tex>{r`\rho=1`}</Tex> 計還剩 <Tex>{`a^2\\Delta=${tx(gosAtAFs, 2)}`}</Tex> fs，是起始誤差 <Tex>{`a\\Delta=${tx(gosInitFs, 1)}`}</Tex> fs 的 <Tex>{`${tx(aG * 100, 0)}\\%`}</Tex>。
          <ModeGate min="engineer">
            <p className="small">
              不略去時 <Tex>{r`a-w_g+a\,w_g=(1-a)\big(\tfrac{a}{1-a}-w_g\big)`}</Tex>，對 <Tex>{'w_g'}</Tex> 仍是一條直線：和理想模型相比，零點由 <Tex>{'a'}</Tex> 移到 <Tex>{r`a/(1-a)`}</Tex>，斜率多乘 <Tex>{r`(1-a)>0`}</Tex>。所以單看 GOS 這一項，更新方向的正負號和理想模型相同；後面用{' '}
              <Tex>{r`\delta_g=a-w_g`}</Tex> 推出的符號結論不變，只要把「<Tex>{r`\delta_g=0`}</Tex>」讀成「<Tex>{r`w_g=a/(1-a)`}</Tex>」。§10 的 sim 與 §14 的實驗 C 用的是沒有略去這一項的物理注入模型。
            </p>
          </ModeGate>
        </li>
        <li>
          <strong>PHOS（PMUX phase offset）</strong>：PMUX 在 feedback 端。選到第 <Tex>{'k'}</Tex> 相時，feedback edge 除了 <Tex>{r`\rho\Delta`}</Tex> 之外，還多早到一個固定的時間偏差 <Tex>{r`\varepsilon_k`}</Tex>（真值，未知；晚到就是負值）。它和 <Tex>{r`\rho\Delta`}</Tex> 一樣是 DTC
          該補的量，所以 reference 端的 DTC 在補償量裡再加上估計值 <Tex>{'w_k'}</Tex> 把它補回來。所以 <Tex>{r`e_{PHOS}[n]=\sum_k(\varepsilon_k-w_k)\,\mathbf 1\{p[n]=k\}`}</Tex>。
          <ModeGate min="engineer">
            <p className="small">
              同一個理想模型還略去第二個乘積：<Tex>{'w_k'}</Tex> 是加在 DTC 的補償量裡的，也被 DTC 的總增益乘到，實際補上的是 <Tex>{r`(1-a)(1+w_g)\,w_k=w_k-(a-w_g+a\,w_g)\,w_k`}</Tex>。多出來的這一項是「GOS 還沒校掉的比例」乘上 <Tex>{'w_k'}</Tex>，在{' '}
              <Tex>{r`\lvert w_k\rvert\ll\Delta`}</Tex> 時遠小於 GOS 那一項；總增益校到 1 時它是 0，PHOS 的零點仍然是 <Tex>{r`w_k=\varepsilon_k`}</Tex>。它造成的 GOS–PHOS 耦合（<Tex>{r`\varepsilon/\Delta`}</Tex>）在 §9 (d) 有數字，§10 把它列為 sim 與理論的差異來源之一。
            </p>
          </ModeGate>
        </li>
      </ul>
      <Diagram id="injection" />
      <p>
        先看最上面的兩個乘法點（左邊是 GOS、右邊是 PHOS）：每個誤差都是「還沒校掉的量」乘上它的 regressor。本章把「真值 − 估計」記為 <Tex>{r`\delta`}</Tex>，也就是 <Tex>{r`\delta_g=a-w_g`}</Tex>、<Tex>{r`\delta_k=\varepsilon_k-w_k`}</Tex>；權重校準好的時候 <Tex>{r`\delta=0`}</Tex>，誤差就消失（理想模型下；不略去任何項時，零點是 <Tex>{r`w_g=a/(1-a)`}</Tex>、<Tex>{r`w_k=\varepsilon_k`}</Tex>）。再看下面：兩個誤差在比較點相加成{' '}
        <Tex>{'u[n]'}</Tex>——沒有迴路時，它就是 <Tex>{r`t_{ref}'-t_{fb}`}</Tex> 去掉常數 <Tex>{'T_0'}</Tex> 之後剩下的部分。但主迴路會反應，所以 PD 的輸出不是 <Tex>{'u[n]'}</Tex>，而是它通過藍色方塊之後的 <Tex>{r`e_{PD}[n]`}</Tex>；比較器取的就是這個輸出。圖上加法點的輸出就是下面公式裡的 <Tex>{'u[n]'}</Tex>：
      </p>
      <TexBlock>{r`u[n]=\underbrace{(a-w_g)\,\Delta\;\rho[n]}_{e_{GOS}[n]}+\underbrace{\sum_{k=0}^{7}(\varepsilon_k-w_k)\,\mathbf 1\{p[n]=k\}}_{e_{PHOS}[n]}=\sum_j\delta_j\,x_j[n]`}</TexBlock>
      <p className="small muted">
        這條式子是理想模型（只留一階）；沒有略去任何項的式子是 §14 的 <Tex>{r`u[n]=\rho\Delta+\varepsilon_p-(1-a)(1+w_g)(\rho\Delta+w_p)`}</Tex>。最後一個等號把 GOS 的 <Tex>{r`\Delta`}</Tex> 併進 <Tex>{r`\delta_0`}</Tex>，9 個誤差就寫成同一個形式；§4 會用到。藍色方塊 <Tex>{r`H_{PD}`}</Tex> 怎麼來，是 §3 的主題。
      </p>
      <Callout kind="info" title="極性約定">
        <p>
          PD 量的是 <Tex>{r`t_{ref}'-t_{fb}`}</Tex>，所以同樣是「edge 晚到」，發生在 reference 端與 feedback 端時，進到 PD 的符號相反。本章把兩邊都換算成同一個方向——「該補的量」減掉「DTC 實際補上的量」：<Tex>{r`\rho\Delta`}</Tex> 與 <Tex>{r`\varepsilon_k`}</Tex> 是 feedback edge
          早到的時間，補償量是 reference edge 被提前（少延遲）的時間。這樣在 <Tex>{r`H_{PD}\equiv1`}</Tex>（沒有迴路）時，<Tex>{r`w\leftarrow w+\mu\,q\,r`}</Tex> 對 GOS 與 PHOS 都往正確方向更新，所以 <FigRef id="injection" /> 的兩條線都標「＋」。這裡 <Tex>{r`\mu`}</Tex> 是步長，<Tex>{r`q=\pm1`}</Tex>{' '}
          是比較器輸出，<Tex>{'r'}</Tex> 是 GMAC 實際拿來相乘的 regressor（不做任何處理時 <Tex>{'r=x'}</Tex>）。實作時，GOS 與 PHOS 的更新符號仍要<strong>各自</strong>依 <Tex>{r`H\equiv1`}</Tex> 推導：PHOS 的修正是透過 reference 端的 DTC 加上去的，誤差卻來自 feedback 端。你的電路若把{' '}
          <Tex>{r`\varepsilon_k`}</Tex> 記成 PMUX 多出來的延遲（晚到為正），<Tex>{r`\varepsilon_k`}</Tex> 與 <Tex>{'w_k'}</Tex> 都要變號：<Tex>{'w_k'}</Tex> 改成加在 DTC 的延遲上，更新式變成 <Tex>{r`w_k\leftarrow w_k-\mu\,q\,r`}</Tex>。DTC 的 code 也因為「從{' '}
          <Tex>{'T_0'}</Tex> 往回扣」而要取補數。
        </p>
      </Callout>
      <p>
        注意：§4 會把「平均梯度的斜率」寫成矩陣 <Tex>{'C'}</Tex>，它只依賴 regressor 每條譜線的功率 <Tex>{r`\lvert c_\nu\rvert^2`}</Tex> 與一個頻域 kernel <Tex>{r`\Gamma`}</Tex>。所以 DTC code 用 <Tex>{r`\rho`}</Tex> 或 <Tex>{r`1-\rho`}</Tex>（取補數）、PMUX 索引用 <Tex>{'p'}</Tex> 或{' '}
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
