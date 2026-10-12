import { useMemo } from 'react'
import { Callout, ClaimTag, CodeBlock, Section, SourceTag, SystemMap, Tex, TexBlock } from '@/components'
import peSrc from '@/simulation/models/pe.ts?raw'
import { lmsHandSteps, type HandStepRow } from '@/simulation/models/pe'
import { SYSTEM_FOCUS } from '../diagrams'
import { Diagram, FigRef, HandCalcBox, m, num, texNum } from '../shared'

const A_TRUE: [number, number] = [3, 1]

function HandTable({ rows, note }: { rows: HandStepRow[]; note?: string }) {
  return (
    <div className="table-wrap">
      <table className="ch09-table">
        <thead>
          <tr>
            <th>
              <Tex>k</Tex>
            </th>
            <th>
              <Tex>{String.raw`\mathbf u_k`}</Tex>
            </th>
            <th>
              <Tex>{String.raw`\mathbf w_k`}</Tex>
            </th>
            <th>
              <Tex>{String.raw`e_k=\mathbf u_k^T(\mathbf a-\mathbf w_k)`}</Tex>
            </th>
            <th>
              <Tex>{String.raw`\Delta\mathbf w=\mu e_k\mathbf u_k`}</Tex>
            </th>
            <th>
              <Tex>{String.raw`\mathbf w_{k+1}`}</Tex>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k}>
              <td>{r.k}</td>
              <td className="nowrap">({r.u.join(', ')})</td>
              <td className="nowrap">
                ({num(r.w[0])}, {num(r.w[1])})
              </td>
              <td>{num(r.e)}</td>
              <td className="nowrap">
                ({num(r.dw[0])}, {num(r.dw[1])})
              </td>
              <td className="nowrap">
                ({num(r.wNext[0])}, {num(r.wNext[1])})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="ch09-note">{note}</p>}
    </div>
  )
}

export function Intro() {
  const same = useMemo(() => lmsHandSteps({ a: A_TRUE, w0: [0, 0], mu: 0.25, us: Array.from({ length: 6 }, () => [1, 1] as [number, number]) }), [])
  const sameLong = useMemo(() => lmsHandSteps({ a: A_TRUE, w0: [0, 0], mu: 0.25, us: Array.from({ length: 60 }, () => [1, 1] as [number, number]) }), [])
  const alt = useMemo(
    () =>
      lmsHandSteps({
        a: A_TRUE,
        w0: [0, 0],
        mu: 0.25,
        us: Array.from({ length: 6 }, (_, k) => (k % 2 === 0 ? [1, 1] : [1, -1]) as [number, number]),
      }),
    [],
  )
  const altLong = useMemo(
    () =>
      lmsHandSteps({
        a: A_TRUE,
        w0: [0, 0],
        mu: 0.25,
        us: Array.from({ length: 60 }, (_, k) => (k % 2 === 0 ? [1, 1] : [1, -1]) as [number, number]),
      }),
    [],
  )
  const wInf = sameLong[sameLong.length - 1].wNext
  const wAlt = altLong[altLong.length - 1].wNext

  return (
    <>
      <p className="ch09-lead">
        前面幾章把 LMS 當成「一個旋鈕、一個誤差」：只要更新方向對、loop gain 在範圍內，誤差就會收斂。但真實的
        DTC / PLL 校正幾乎都是<strong>好幾個旋鈕同時調</strong>：多段 DTC gain、INL 係數、多相位 PMUX 的 phase offset（PHOS）、
        global offset……這一課要回答一個看似簡單、其實很深的問題：
      </p>
      <Callout kind="info" title="這一課要回答的問題">
        迴路<strong>穩定</strong>了、GMAC 也<strong>歸零</strong>了，每個參數就一定學對了嗎？答案是：不一定。
        要「學得到」每個參數，輸入必須在<strong>每一個參數方向</strong>上都持續提供能量——這叫{' '}
        <strong>Persistent Excitation（PE，持續激發）</strong>。
      </Callout>

      <SystemMap focus={SYSTEM_FOCUS} />
      <p className="ch09-map-note">
        <strong>你在這裡：</strong>藍色的四個方塊——regressor {m`x[n]`}、code alignment（filtered-x）、GMAC、gain accumulator {m`w_k`}——是 LMS 校正迴路裡
        「每個參數各要一份」的部分。前面幾章只有一份（一個係數）；這一章把它們複製成 {m`M`} 份、全部共用同一個 comparator 輸出，然後問：
        {m`M`} 個 accumulator 各自學得到自己的參數嗎？（§9.2 還會用到標著「主 PLL 迴路」的那一框：它會把 DC 誤差吃掉，讓其中一個參數完全看不到。）
        地圖上也要注意 LMS 的輸入是從哪裡接出來的：comparator 取的是 <strong>PD 的輸出</strong> {m`e[n]`}，也就是送進 loop filter 的同一個訊號
        （PD 輸出旁的標籤與 comparator 輸入旁的 {m`e[n]`} 標籤是同一條線）；DTC 在 reference clock 進來的位置，不在回授路徑上。
      </p>

      <Section kind="intuition" title="一個黑盒子：兩個旋鈕總是一起動" level={2} id="ch09-intro">
        <p>
          想像一個黑盒子有兩個未知參數 {m`\mathbf a=(a_1,a_2)`}（真值）。你每次輸入一組 <strong>regressor</strong> {m`\mathbf u=(u_1,u_2)`}
          ——regressor 就是「乘在某個參數上的那個已知輸入」，在 DTC 校正裡是 DSM 的 residue code。你手上有兩個旋鈕 {m`\mathbf w=(w_1,w_2)`}
          （校正係數），目標是把它們調到等於 {m`\mathbf a`}；但你只能看到一個數，誤差 {m`e=u_1(a_1-w_1)+u_2(a_2-w_2)`}。
          括號裡的 {m`a_i-w_i`}（真值減旋鈕）叫<strong>參數誤差</strong>，後面記成 {m`\delta_i`}。
        </p>
        <Diagram id="two-knob">
          看藍色的方塊：不管黑盒子裡有幾個參數，你量得到的只有 {m`e`} 這<strong>一個數</strong>。
        </Diagram>
        <p>
          <FigRef id="two-knob" /> 怎麼看：先看標著「黑盒子」的框——{m`u_1`}、{m`u_2`} 各自乘上未知的 {m`a_1`}、{m`a_2`}，相加成 {m`y`}。
          再看標著「你的兩個旋鈕」的框——同樣的 {m`u_1`}、{m`u_2`} 乘上 {m`w_1`}、{m`w_2`}，相加成 {m`\hat y`}。最後一個加法點把兩者相減（{m`y`} 那條線標 {m`+`}、
          {m`\hat y`} 那條線標 {m`-`}），得到藍色方塊裡的 {m`e`}。圖上「{m`\times a_1`}」與「{m`\times w_1`}」兩條路相減，就是公式裡的 {m`u_1(a_1-w_1)`} 這一項；
          {m`u_2`} 的兩條路相減就是 {m`u_2(a_2-w_2)`}。
        </p>
        <p>
          如果<strong>每一次</strong> {m`u_1=u_2`}（圖上的兩個輸入其實是同一個訊號：兩個旋鈕總是被同一個 code 一起推），
          你永遠只看得到 {m`(a_1-w_1)+(a_2-w_2)`}，也就是<strong>和</strong>；至於「差」是多少，資料裡根本沒有。
        </p>
        <p>
          在 PLL 裡這很常見：兩段 DTC gain 被高度相關的 DSM code 驅動、四個 PMUX phase 加上一個所有相位共用的 offset……
          迴路照樣穩定、GMAC 照樣歸零，但參數可能停在<strong>錯的地方</strong>。
        </p>
        <p>
          放回 PLL 裡，那個「唯一看得到的數」就是 <strong>PD 的輸出</strong> {m`e[n]`}（送進 loop filter 的同一個訊號）。接法是 reference clock {m`\to`} DTC {m`\to`} PD，
          回授路徑上只有 divider（或 PMUX）。以 DTC gain 這個旋鈕為例（{m`u=x[n]`}，{m`x[n]`} 是 DSM 的 residue code）：feedback（divider）edge 比理想時刻<strong>早到</strong>{' '}
          {m`a\,x[n]`}（{m`a`} 是真實的 DTC gain，也就是把這段早到的時間完全補回來所需要的 gain）；reference 端的 DTC 只能延遲、不能提前，所以它從固定的基準延遲 {m`T_0`} 往回扣：
          {m`\tau_{\mathrm{DTC}}[n]=T_0-w\,x[n]`}，其中 {m`w\,x[n]`} 是 DTC 的<strong>補償量</strong>（reference edge 被提前——也就是少延遲——的時間）。
          PD 量的是（被 DTC 延遲後的）reference edge 減 feedback edge：
        </p>
        <TexBlock>{String.raw`\begin{aligned}e[n]&=t_{\mathrm{ref}}'[n]-t_{\mathrm{fb}}[n]\\&=(a-w)\,x[n]+v[n]\end{aligned}`}</TexBlock>
        <p>
          補償不足（{m`w<a`}）時 reference 還是太晚，誤差為正；{m`T_0`} 是常數，被 PLL 當成靜態相位偏移吸收，不影響任何會動的量。
          有 {m`M`} 個旋鈕時，每個旋鈕各貢獻一項 {m`u_i(a_i-w_i)`}，全部加在同一個 {m`e[n]`} 裡——這就是上面的黑盒子。
          （這裡把 PLL 迴路本身的反應先省略；§9.2 會把它加回來：DTC 補償後的殘餘誤差要先經過 {m`H_{\mathrm{PD}}`} 才成為 PD 的輸出，那時記成 {m`e_{\mathrm{PD}}[n]`}。）
        </p>
      </Section>

      <Section kind="example" title={<>先算一次：{m`\mathbf u`} 永遠是 {m`(1,1)`}</>} level={3}>
        <p>
          設 {m`\mathbf a=(3,1)`}、起點 {m`\mathbf w_0=(0,0)`}、無雜訊，每一步 {m`\mathbf u=(1,1)`}。conventional LMS 每一步照「誤差 {m`\times`} regressor」
          修正旋鈕：{m`\mathbf w\leftarrow\mathbf w+\mu e\,\mathbf u`}，其中 {m`\mu`} 是 <strong>learning rate</strong>（步長：每一步照誤差修正多少），這裡取
          {m`\mu=0.25`}。下表的 {m`k`} 是第幾步，每一列都由 <code>lmsHandSteps()</code> 算出：
        </p>
        <HandTable rows={same} />
        <p>
          第 0 步：{m`e_0=1\cdot(3-0)+1\cdot(1-0)=4`}，{m`\Delta\mathbf w=0.25\cdot4\cdot(1,1)=(1,1)`}。第 1 步：
          {m`e_1=(3-1)+(1-1)=2`}，{m`\Delta\mathbf w=(0.5,0.5)`}……每一步誤差減半（因為 {m`\mu\|\mathbf u\|^2=0.25\cdot2=0.5`}）。
          60 步後 {m`\mathbf w=(${texNum(wInf[0], 6)},\ ${texNum(wInf[1], 6)})`}：
        </p>
        <TexBlock>{String.raw`\mathbf w_\infty=(2,\,2),\qquad e_\infty=(3-2)+(1-2)=0,\qquad \boldsymbol\delta_\infty=\mathbf a-\mathbf w_\infty=(1,\,-1)`}</TexBlock>
        <p>
          這裡的 {m`\boldsymbol\delta=\mathbf a-\mathbf w`} 就是把兩個參數誤差排成向量（真值減旋鈕；全站都用這個極性）。
          <strong>誤差歸零，但兩個參數都錯</strong>（{m`w_1=2`} vs {m`a_1=3`}、{m`w_2=2`} vs {m`a_2=1`}）。殘留的誤差 {m`(1,-1)`} 正好是 {m`\mathbf u=(1,1)`}「看不見」的方向：
          {m`(1,1)\cdot(1,-1)=0`}。這就是本章後面會叫做「{m`\lambda_{\min}=0`} 的 eigenvector」的方向。 <ClaimTag kind="exact" /> <SourceTag />
        </p>
      </Section>

      <Section kind="example" title={<>再算一次：{m`\mathbf u`} 在 {m`(1,1)`} 與 {m`(1,-1)`} 之間交替</>} level={3}>
        <HandTable rows={alt} />
        <p>
          這次第 1 步的 regressor {m`(1,-1)`} 恰好照到「差」的方向，所以兩個方向都被推到；60 步後
          {m`\mathbf w=(${texNum(wAlt[0], 6)},\ ${texNum(wAlt[1], 6)})`}，收斂到真值 {m`(3,1)`}。差別不在演算法、不在 {m`\mu`}，
          而在 <strong>輸入有沒有激發每一個方向</strong>。
        </p>
        <HandCalcBox id="HC-09.1">
          把 {m`\mathbf a`} 和 {m`\mu`} 換成你自己的數字，先用紙筆算兩步（每一步只有乘法和加減法）。{m`s=1`} 對照第一張表的前兩列，
          再把 {m`s`} 改成 {m`-1`} 對照這張表——看「差」{m`\delta_1-\delta_2`} 什麼時候才動得了。
        </HandCalcBox>
        <Callout kind="ok" title="本課主線">
          LMS 的收斂速度由 {m`\mathbf R=E[\mathbf u\mathbf u^T]`} 的 eigenvalues 決定：最大的 {m`\lambda_{\max}`} 限制 {m`\mu`}（穩定），
          最小的 {m`\lambda_{\min}`} 決定最慢的模式；{m`\lambda_{\min}=0`} 的方向完全學不到。
          （{m`\mathbf R`} 是「regressor 兩兩相乘、長期平均」排成的表；它的 eigenvalue {m`\lambda`} 可以想成輸入在某一個參數方向上的<strong>能量</strong>。
          這兩個名詞下一節從頭講。）
        </Callout>
        <CodeBlock source={peSrc} region="handSteps" path="src/simulation/models/pe.ts" caption="上面兩張表就是由這段程式碼算出（無雜訊、逐筆更新）。" />
      </Section>
    </>
  )
}
