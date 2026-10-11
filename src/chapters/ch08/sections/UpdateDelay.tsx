import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import {
  Callout,
  ClaimTag,
  CodeBlock,
  CodeCompare,
  Mermaid,
  ModeGate,
  Plot,
  Prereq,
  Quiz,
  Section,
  StepDerivation,
  Tex,
  TexBlock,
  TestBadge,
  useThemeTokens,
} from '@/components'
import stabilitySrc from '@/simulation/models/stability.ts?raw'
import { polyRoots } from '@/simulation/core'
import {
  delayBoundTable,
  delayCharPoly,
  delayCriticalGain,
  delayNoOvershootGain,
  delayStable,
  pmWithDelay,
  simulateDelayRecursion,
} from '@/simulation/models/stability'
import { ctx, Expand, fx, HandCalcSlot, rich, sig, tx } from '../common'
import { formula } from '../formulas'
import { HAND_BLOCKS } from '../handcalcs'
import { DELAY_LOOP_CHART, PHASE_BUDGET_CHART, PIPELINE_SEQ_CHART, ROOT_STATES_CHART } from '../diagrams'

const SRC_PATH = 'src/simulation/models/stability.ts'
// Plot 的 layout 放在模組層級：物件參考固定，重新渲染時不會觸發多餘的 Plotly.react
const RHO_LAYOUT: Partial<Layout> = { xaxis: { title: { text: 'g' } }, yaxis: { title: { text: 'ρ' }, range: [0, 1.8] } }
const PMD_LAYOUT: Partial<Layout> = { xaxis: { title: { text: 'g' } }, yaxis: { title: { text: 'PM_d [deg]' }, range: [-120, 95] } }

/** §8.3 更新延遲：δ_{k+1} = δ_k − gδ_{k−d} */
export function UpdateDelay() {
  const tokens = useThemeTokens()
  const table = useMemo(() => delayBoundTable(6), [])
  const hand = useMemo(() => simulateDelayRecursion(0.5, 1, 8).delta, [])
  const hand2 = useMemo(() => simulateDelayRecursion(1.2, 1, 8).delta, [])
  const g2 = delayCriticalGain(2)
  const rootsAtG2 = useMemo(() => polyRoots(delayCharPoly(g2, 2)), [g2])
  const curves = useMemo(() => {
    const gs = Array.from({ length: 241 }, (_, i) => 0.0025 + (2.4 * i) / 240)
    const rho: Data[] = [0, 1, 2, 3, 4].map((d) => ({
      x: gs,
      y: gs.map((g) => delayStable(g, d).rho),
      name: `d = ${d}`,
      mode: 'lines',
      line: { color: tokens.series[d % tokens.series.length], width: 2 },
    }))
    rho.push({ x: [0, 2.4], y: [1, 1], name: 'ρ = 1', mode: 'lines', line: { color: tokens.danger, dash: 'dash', width: 1 } })
    const pm: Data[] = [0, 1, 2, 3, 4].map((d) => ({
      x: gs,
      y: gs.map((g) => {
        const v = pmWithDelay(g, d).pmDeg
        return Number.isFinite(v) ? v : null
      }),
      name: `PM_d，d = ${d}`,
      mode: 'lines',
      line: { color: tokens.series[d % tokens.series.length], width: 2 },
    }))
    pm.push({ x: [0, 2.4], y: [0, 0], name: 'PM = 0', mode: 'lines', line: { color: tokens.danger, dash: 'dash', width: 1 } })
    return { rho, pm }
  }, [tokens])

  return (
    <Section kind="formula" title="§8.3 更新延遲會縮小穩定範圍" level={2} id="ch08-delay">
      <p>
        真實的 GMAC 不會在累加完的瞬間就把新係數送進 DTC：先要等 <Tex>{'N'}</Tex> 個 sample 累加完、做除法或 shift、寫入 shadow register，再在某個 block 邊界 commit 到 DTC。
        如果第 <Tex>{'k'}</Tex> 個 block 量到的 <Tex>{'G_k'}</Tex> 其實是 <Tex>{'d'}</Tex> 個 block 前的係數造成的，迴路就多了 <Tex>{'d'}</Tex> 個 block 的純延遲。
      </p>
      <p>
        {rich(
          String.raw`這個 $d$ 叫更新延遲（update delay，單位：block）：$d=0$ 是前一節的理想情形，$d=1$ 表示 DTC 永遠用著「上一版」的係數。先用時序圖看 $d=1$ 時一個 block 裡發生什麼事：`,
        )}
      </p>
      <Mermaid
        caption={String.raw`更新延遲 $d=1$ 的時序：注意每個 block 一開始，暫存器的最新值和 DTC 實際拿到的值差了一版`}
        chart={PIPELINE_SEQ_CHART}
      />
      <p className="small">
        {rich(
          String.raw`讀圖（由上往下是時間）：先看 block $k$ 的第一個箭頭——暫存器裡已經是 $w_k$，DTC 拿到的卻是 $w_{k-1}$。所以這個 block 的誤差是 $\delta_{k-1}=a-w_{k-1}$，GMAC 累加出來的是 $G_k=K\delta_{k-1}$，暫存器用它算出 $w_{k+1}$。再看 block $k+1$：同樣的事重複一次，所有下標加 $1$。下面的表是同一件事的表格版（多列了前一個 block $k-1$），每一欄是一個 block。`,
        )}
      </p>
      <div className="table-wrap">
        <table className="ch08-table">
          <caption>{rich(String.raw`Pipeline 時序（$d=1$ 的例子；每格是一個 GMAC block）`)}</caption>
          <thead>
            <tr>
              <th>block</th>
              <th>
                <Tex>{'k-1'}</Tex>
              </th>
              <th>
                <Tex>{'k'}</Tex>
              </th>
              <th>
                <Tex>{'k+1'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>DTC 使用的係數</td>
              <td>
                <Tex>{'w_{k-2}'}</Tex>
              </td>
              <td>
                <Tex>{'w_{k-1}'}</Tex>
              </td>
              <td>
                <Tex>{'w_{k}'}</Tex>
              </td>
            </tr>
            <tr>
              <td>GMAC 累加得到</td>
              <td>
                <Tex>{'G_{k-1}=K\\delta_{k-2}'}</Tex>
              </td>
              <td>
                <Tex>{'G_k=K\\delta_{k-1}'}</Tex>
              </td>
              <td>
                <Tex>{'G_{k+1}=K\\delta_{k}'}</Tex>
              </td>
            </tr>
            <tr>
              <td>暫存器更新</td>
              <td>
                <Tex>{'w_k=w_{k-1}+\\mu G_{k-1}'}</Tex>
              </td>
              <td>
                <Tex>{'w_{k+1}=w_k+\\mu G_k'}</Tex>
              </td>
              <td>
                <Tex>{'w_{k+2}=\\dots'}</Tex>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p>
        {rich(
          String.raw`把這個延遲畫回 §8.2 的方塊圖，只多了一個方塊：暫存器的輸出 $w_k$ 要先經過 $z^{-d}$（延遲 $d$ 個 block）才到 DTC。`,
        )}
      </p>
      <Mermaid
        caption={String.raw`加了更新延遲的 calibration loop：和 §8.2 的圖只差紅色那一格；注意 $\Sigma$ 輸出的誤差下標變成 $k-d$`}
        chart={DELAY_LOOP_CHART}
      />
      <p className="small">
        {rich(
          String.raw`讀圖：先看紅色的延遲方塊——進去的是 $w_k$，出來的是 $w_{k-d}$。再看 $\Sigma$：它減掉的是舊的 $w_{k-d}$，所以輸出是舊的誤差 $\delta_{k-d}=a-w_{k-d}$，GMAC 算出的是 $G_k=K\delta_{k-d}$。圖上繞一圈的三個方塊相乘，$K\cdot\frac{\mu}{z-1}\cdot z^{-d}$，就是下面 F-08.7 的 $L(z)=\frac{g\,z^{-d}}{z-1}$；$\Sigma$ 輸出的 $\delta_{k-d}$ 就是遞迴式 $\delta_{k+1}=\delta_k-g\,\delta_{k-d}$ 裡那個「舊的」誤差。`,
        )}
      </p>
      <p className="small">
        {rich(
          String.raw`F-08.7 裡的 $P(z)$ 是閉迴路的特徵多項式：它的根就是閉迴路 poles。後面常用到 spectral radius $\rho$——所有根的絕對值裡最大的那一個；$\rho<1$（所有根都在單位圓內）誤差才會衰減。`,
        )}
      </p>

      <Expand title="一步一步推導特徵式">
        <StepDerivation
          steps={[
            { tex: String.raw`G_k=K\,\delta_{k-d}`, why: rich(String.raw`第 $k$ 個 block 的 DTC 用的是 $d$ 個 block 前寫入的係數 $w_{k-d}$。`) },
            { tex: String.raw`\delta_{k+1}=\delta_k-\mu K\,\delta_{k-d}=\delta_k-g\,\delta_{k-d}`, why: rich(String.raw`和 §8.2 一樣用 $a$ 減去更新式；差別只在 $G$ 用的是舊的 $\delta$。`) },
            { tex: String.raw`z\,\Delta(z)=\Delta(z)-g\,z^{-d}\Delta(z)`, why: rich(String.raw`Z transform：往前一步＝乘 $z$，延遲 $d$ 步＝乘 $z^{-d}$（只看齊次部分，初值不影響 pole）。`) },
            { tex: String.raw`L(z)=\frac{g\,z^{-d}}{z-1}`, why: rich(String.raw`開迴路是三項相乘：積分器 $\frac{\mu}{z-1}$、GMAC 斜率 $K$、延遲 $z^{-d}$（$\frac{\mu}{z-1}\times K\times z^{-d}$，$g=\mu K$）。`) },
            { tex: String.raw`z-1+g\,z^{-d}=0`, why: rich(String.raw`閉迴路 poles：$1+L(z)=0$，兩邊乘 $(z-1)$。`) },
            { tex: String.raw`P(z)=z^{d+1}-z^{d}+g=0`, why: rich(String.raw`兩邊再乘 $z^d$，變成 $d+1$ 次多項式；$d+1$ 個根都要在單位圓內。`) },
          ]}
        />
      </Expand>
      <TexBlock id="F-08.7" label="更新延遲的遞迴、開迴路與特徵式">
        {formula('F-08.7').tex}
      </TexBlock>

      <h4>{rich(String.raw`先算一次：$d=1$（歷史 $\delta_{-1}=\delta_0=1$）`)}</h4>
      <div className="table-wrap">
        <table className="ch08-table">
          <thead>
            <tr>
              <th>{rich(String.raw`$g$`)}</th>
              {Array.from(hand, (_, k) => (
                <th key={k} className="num">
                  <Tex>{`\\delta_{${k}}`}</Tex>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">0.5</td>
              {Array.from(hand, (v, k) => (
                <td key={k} className="num mono">
                  {fx(v, 4)}
                </td>
              ))}
            </tr>
            <tr>
              <td className="mono">1.2</td>
              {Array.from(hand2, (v, k) => (
                <td key={k} className="num mono">
                  {fx(v, 3)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small">
        <Tex>{'g=0.5'}</Tex>：<Tex>{String.raw`\delta_1=1-0.5\cdot1=0.5,\ \delta_2=0.5-0.5\cdot1=0,\ \delta_3=0-0.5\cdot0.5=-0.25,\dots`}</Tex> 會 overshoot 但收斂。{rich(String.raw`$g=1.2$ 在一階模型裡是穩定的（pole $-0.2$），`)}
        加了一個 block 延遲就振盪發散。
      </p>

      <HandCalcSlot id="HC-08.4">
        {rich(String.raw`上面的表只有兩個 $g$。換成你自己的 $g$、$d$、$\delta_0$，在紙上一格一格往右算 ${HAND_BLOCKS} 個 block——親手算過一次 overshoot，比看十張圖有感覺。`)}
      </HandCalcSlot>

      <h4>{rich(String.raw`$g$ 加大時，根怎麼走？`)}</h4>
      <p>
        {rich(
          String.raw`接下來三段推導（$d=1$ 的 Jury 判據、$d=2$、一般的 $d$）其實都在回答同一個問題：$g$ 從 $0$ 慢慢加大時，$P(z)$ 的根怎麼移動、什麼時候踩到單位圓。踩到的那個 $g$ 叫臨界增益，記成 $g^{*}(d)$。先看整個過程的五個階段：`,
        )}
      </p>
      <Mermaid
        caption={String.raw`$g$ 由小到大，主導根經過的五個階段（畫的是 $d\ge1$）：綠色＝不 overshoot，藍色＝會 overshoot 但收斂，紅色＝臨界與發散`}
        chart={ROOT_STATES_CHART}
      />
      <p className="small">
        {rich(
          String.raw`讀圖（由左到右就是 $g$ 變大）：先看前兩格——$g$ 很小時，最慢的根在 $z\approx1-g$，和沒有延遲時一樣，$\delta_k$ 單調衰減、不變號。再看中間藍色那格——$g$ 超過門檻（$d=1$ 是 $${fx(delayNoOvershootGain(1), 2)}$，$d=2$ 是 $${fx(delayNoOvershootGain(2), 4)}$；$d=0$ 是 $1$，這時根變成負實數而不是複數）之後，$\delta_k$ 開始正負振盪，但振幅仍然越來越小。最後看紅色兩格——$g=g^{*}(d)$ 時根剛好在單位圓上，圖上的角度 $\omega^{*}=\frac{\pi}{2d+1}$（臨界時那個根在單位圓上的角度）與 $PM_d=0$（$PM_d$ 是含延遲的 phase margin，本節後半會算）就是 F-08.8、F-08.9 的結果（$d=0,1,2$ 時 $g^{*}=${fx(delayCriticalGain(0), 0)},\ ${fx(delayCriticalGain(1), 0)},\ ${fx(delayCriticalGain(2), 3)}$）；再大就發散。`,
        )}
      </p>

      <Prereq title="Jury 穩定判據（二次式）：不用解根就知道根在不在單位圓內">
        <p>
          對首一二次式 <Tex>{'P(z)=z^2+a_1z+a_0'}</Tex>，兩個根都在單位圓內 <Tex>{'\\iff'}</Tex> 下面三個條件同時成立：
        </p>
        <TexBlock>{String.raw`P(1)=1+a_1+a_0>0,\qquad P(-1)=1-a_1+a_0>0,\qquad |a_0|<1 .`}</TexBlock>
        <StepDerivation
          title="為什麼（只用根與係數的關係）"
          steps={[
            { tex: String.raw`P(z)=(z-z_1)(z-z_2)\;\Rightarrow\;a_0=z_1z_2,\;a_1=-(z_1+z_2)`, why: '展開比較係數（Vieta）。' },
            { tex: String.raw`z_{1,2}=x\pm jy\;\Rightarrow\;a_0=|z_1|^2`, why: rich(String.raw`複數共軛根時，兩根乘積＝模數平方；所以 $|z|<1\iff a_0<1$。`) },
            { tex: String.raw`z_1,z_2\in(-1,1)\;\Rightarrow\;P(1)=(1-z_1)(1-z_2)>0,\;P(-1)=(1+z_1)(1+z_2)>0`, why: rich(String.raw`實根都在 $(-1,1)$ 內時，拋物線在 $\pm1$ 兩端都是正的。`) },
            { tex: String.raw`\text{反之，若某實根}\ |z_i|\ge1\;\Rightarrow\;P(1)\le0\ \text{或}\ P(-1)\le0\ \text{或}\ |a_0|\ge1`, why: rich(String.raw`根跑出 $[-1,1]$ 時，拋物線在 $1$ 或 $-1$ 處變號（或兩根同側都在外面使 $|a_0|=|z_1z_2|\ge1$）。`) },
          ]}
        />
        <p className="small">
          {rich(String.raw`三次以上的多項式也有 Jury 表（條件更多）；本章 $d=2$ 用到三次的版本，一般的 $d$ 改用根軌跡論證。`)}
        </p>
      </Prereq>

      <Expand title={rich(String.raw`$d=1$：用 Jury 三個條件，一步一步`)}>
        <StepDerivation
          steps={[
            { tex: String.raw`P(z)=z^2-z+g\;\Rightarrow\;a_1=-1,\;a_0=g`, why: rich(String.raw`$d=1$ 代入 $z^{d+1}-z^d+g$。`) },
            { tex: String.raw`P(1)=1-1+g=g>0`, why: rich(String.raw`條件一：$g$ 必須是正的（就是「極性正確」）。`) },
            { tex: String.raw`P(-1)=1+1+g=2+g>0`, why: rich(String.raw`條件二：$g>-2$，已被條件一涵蓋。`) },
            { tex: String.raw`|a_0|=|g|<1`, why: '條件三：這是真正的限制。' },
            { tex: String.raw`0<g<1`, why: rich(String.raw`三者取交集。比一階模型的 $0<g<2$ 少了一半。`) },
            { tex: String.raw`g>\tfrac14:\;z=\tfrac12\pm j\sqrt{g-\tfrac14},\;|z|^2=\tfrac14+g-\tfrac14=g`, why: rich(String.raw`直接驗算：判別式 $1-4g<0$ 時是共軛複數根，$|z|^2=g$，所以 $|z|<1\iff g<1$。`) },
          ]}
          result={String.raw`d=1:\;0<g<1`}
        />
      </Expand>

      <HandCalcSlot id="HC-08.5">
        {rich(String.raw`Jury 判據只告訴你「穩不穩」。換一個 $g$，用二次公式把 $d=1$ 的兩個根真的解出來（複數就拆成實部、虛部），看它們離單位圓多遠。`)}
      </HandCalcSlot>

      <ModeGate min="engineer">
        <Expand title={rich(String.raw`$d=2$：三次式的 Jury 條件給出黃金比例 $\frac{\sqrt5-1}{2}=2\sin\frac{\pi}{10}$`)}>
          <p>
            對首一三次式 <Tex>{'z^3+a_2z^2+a_1z+a_0'}</Tex>，Jury 條件是 <Tex>{'P(1)>0'}</Tex>、<Tex>{'P(-1)<0'}</Tex>、<Tex>{'|a_0|<1'}</Tex>、
            <Tex>{'|a_0^2-1|>|a_0a_2-a_1|'}</Tex>。
          </p>
          <StepDerivation
            steps={[
              { tex: String.raw`P(z)=z^3-z^2+g\;\Rightarrow\;a_2=-1,\;a_1=0,\;a_0=g`, why: rich(String.raw`$d=2$ 代入。`) },
              { tex: String.raw`P(1)=g>0,\qquad P(-1)=-1-1+g=g-2<0\;\Rightarrow\;g<2`, why: '前兩個條件。' },
              { tex: String.raw`|a_0|=g<1`, why: '第三個條件。' },
              { tex: String.raw`|g^2-1|>|g\cdot(-1)-0|\;\Rightarrow\;1-g^2>g`, why: rich(String.raw`第四個條件；在 $0<g<1$ 時 $|g^2-1|=1-g^2$。`) },
              { tex: String.raw`g^2+g-1<0\;\Rightarrow\;g<\frac{-1+\sqrt5}{2}`, why: '解二次不等式（取正根）。' },
              { tex: String.raw`\frac{\sqrt5-1}{2}=2\sin18^\circ=2\sin\frac{\pi}{10}=${tx(g2, 9)}`, why: rich(String.raw`已知 $\sin18^\circ=\frac{\sqrt5-1}{4}$（正五邊形的幾何）；正好是一般公式 $d=2$ 的情形。`) },
            ]}
            result={String.raw`d=2:\;0<g<2\sin\frac{\pi}{10}\approx${tx(g2, 3)}`}
          />
          <p className="small">
            在 <Tex>{'g=g^*'}</Tex> 時三個根（由 polyRoots 計算）：{rootsAtG2.map((z, i) => (
              <span key={i}>
                <Tex>{ctx(z, 6)}</Tex>
                {i < rootsAtG2.length - 1 ? '、' : ''}
              </span>
            ))}
            ——前兩個就是 <Tex>{'e^{\\pm j\\pi/5}'}</Tex>（角度 36°），第三個是 <Tex>{'-g^*'}</Tex>。
          </p>
        </Expand>
      </ModeGate>

      <Expand title={rich(String.raw`一般 $d$：根軌跡論證（root crosses the unit circle）`)}>
        <StepDerivation
          steps={[
            { tex: String.raw`g\to0^+:\;z^{d}(z-1)=-g\approx0\;\Rightarrow\;z\approx1\ \text{與}\ z\approx0\ (d\ \text{重})`, why: rich(String.raw`起點都在閉單位圓內；$z\approx1$ 那個根會往內移（$z\approx1-g$），$z\approx0$ 那些根的大小約 $g^{1/d}$。`) },
            { tex: String.raw`\text{根隨 }g\text{ 連續移動}\;\Rightarrow\;\text{第一次失穩必定是某個根「穿過」}|z|=1`, why: '多項式的根是係數的連續函數；要從圓內跑到圓外一定要經過圓周。' },
            { tex: String.raw`z=e^{j\omega}\ \text{代入}\ z^{d}(z-1)=-g`, why: rich(String.raw`找出「根正好在單位圓上」的所有 $(\omega,g)$。`) },
            { tex: String.raw`\text{大小：}\;|e^{jd\omega}|\cdot|e^{j\omega}-1|=2\sin\frac{\omega}{2}=g`, why: rich(String.raw`$|e^{jd\omega}|=1$，再用弦長公式。`) },
            { tex: String.raw`\text{角度：}\;d\omega+\Big(\frac{\omega}{2}+90^\circ\Big)=180^\circ\pmod{360^\circ}`, why: rich(String.raw`$-g$（$g>0$）的角度是 $180^\circ$。`) },
            { tex: String.raw`\Big(d+\tfrac12\Big)\omega=90^\circ\;\Rightarrow\;\omega^{*}=\frac{\pi}{2d+1}`, why: rich(String.raw`取最小的正解（其他解的 $\omega$ 更大或是共軛，對應更大的 $g$）。`) },
            { tex: String.raw`g^{*}=2\sin\frac{\omega^{*}}{2}=2\sin\frac{\pi}{4d+2}`, why: rich(String.raw`代回大小條件。另外 $z=1$ 永遠不是根（$P(1)=g>0$）。`) },
          ]}
          result={String.raw`0<g<g^{*}(d)=2\sin\frac{\pi}{4d+2}`}
        />
      </Expand>
      <TexBlock id="F-08.8" label="臨界增益（只對這個特徵方程成立）">
        {formula('F-08.8').tex}
      </TexBlock>

      <h4>換成頻域再看一次：延遲吃掉多少相位？</h4>
      <p>
        {rich(
          String.raw`根軌跡回答的是「$g$ 最大可以到多少」。設計時更常問的是「現在這個 $g$ 離不穩定還有多遠」——這要用 §8.2 的 phase margin 來量。含 $d$ 個 block 延遲時的 phase margin 記成 $PM_d$，gain margin 記成 $GM_d$。算法像記帳：$PM=180^\circ+\angle L(e^{j\omega_c})$，所以一開始有 $180^\circ$ 的相位預算；沿著迴路每經過一個方塊，就扣掉它在交越頻率 $\omega_c$ 的相位落後，扣完剩下的就是 $PM_d$。`,
        )}
      </p>
      <Mermaid
        caption={String.raw`相位預算：從 $180^\circ$ 出發，沿著迴路的方塊一格一格扣；紅色的延遲每多一個 block 就多扣一個 $\omega_c$，藍色是扣完剩下的 $PM_d$`}
        chart={PHASE_BUDGET_CHART}
      />
      <p className="small">
        {rich(
          String.raw`讀圖：先看上面那一排由左到右——GMAC 斜率 $K>0$ 不改變相位；積分器 $\frac{\mu}{z-1}$ 落後 $90^\circ+\frac{\omega_c}{2}$（§8.2 用弦長公式推過）；紅色的延遲 $z^{-d}$ 再落後 $d\,\omega_c$。線上寫的是每過一格還剩多少，最後剩下的 $90^\circ-\frac{\omega_c}{2}-d\,\omega_c$ 就是下面 F-08.9 的 $PM_d$。再看用虛線連上來的那一格——交越頻率 $\omega_c=2\arcsin\frac g2$ 和 §8.2 完全一樣，因為延遲只改相位、不改大小；把它代進去就是 $PM_d=90^\circ-(2d+1)\arcsin\frac g2$。最後看最右邊紅色的那格：$PM_d$ 剛好扣到 $0$ 時的 $g$，正是 F-08.8 的臨界增益 $g^{*}(d)$；而 $GM_d=g^{*}(d)/g$ 量的是現在的 $g$ 離它還差幾倍。`,
        )}
      </p>

      <Expand title={rich(String.raw`同一個答案的頻域版本：$PM_d=0\iff g=g^*$`)}>
        <StepDerivation
          steps={[
            { tex: String.raw`|L(e^{j\omega})|=\frac{g}{2\sin(\omega/2)}`, why: rich(String.raw`$|e^{-jd\omega}|=1$：延遲不改大小，所以 $\omega_c=2\arcsin(g/2)$ 與 $d$ 無關。`) },
            { tex: String.raw`\angle L(e^{j\omega})=-90^\circ-\frac{\omega}{2}-d\,\omega`, why: rich(String.raw`延遲多扣 $d\omega$ 的相位。`) },
            { tex: String.raw`PM_d=90^\circ-\frac{\omega_c}{2}-d\,\omega_c=90^\circ-(2d+1)\arcsin\frac g2`, why: rich(String.raw`代入 $\omega_c$；每多一個 block 延遲，PM 多扣 $2\arcsin(g/2)=\omega_c$（換成度）。`) },
            { tex: String.raw`PM_d=0\iff\arcsin\frac g2=\frac{90^\circ}{2d+1}\iff g=2\sin\frac{\pi}{4d+2}`, why: rich(String.raw`和根軌跡得到同一個 $g^*$：PM 歸零的瞬間，閉迴路 pole 剛好踩在單位圓上（角度 $=\omega_c=\omega^*$）。`) },
            { tex: String.raw`\angle L=-180^\circ\Rightarrow\omega_{180}=\frac{\pi}{2d+1},\quad GM_d=\frac{1}{|L(e^{j\omega_{180}})|}=\frac{g^{*}}{g}`, why: rich(String.raw`Gain margin 也統一成「$g$ 離臨界值還差幾倍」。`) },
          ]}
        />
      </Expand>
      <TexBlock id="F-08.9" label="含延遲的 PM 與 GM">
        {formula('F-08.9').tex}
      </TexBlock>

      <HandCalcSlot id="HC-08.6">
        {rich(String.raw`把 $d$ 換成你 RTL 數出來的 pipeline 延遲、$g$ 換成你打算用的 loop gain，按一次 $\sin$、一次 $\sin^{-1}$、一次 $\log$，算出 $g^*$、$GM_d$ 和 $PM_d$。`)}
      </HandCalcSlot>

      <h4>{rich(String.raw`數值驗證 $d=0\ldots6$（封閉式 vs 不用封閉式的求根二分法）`)}</h4>
      <div className="table-wrap">
        <table className="ch08-table">
          <thead>
            <tr>
              <th className="num">{rich(String.raw`$d$`)}</th>
              <th className="num">{rich(String.raw`$g^*=2\sin\frac{\pi}{4d+2}$`)}</th>
              <th className="num">{rich(String.raw`$g^*$（數值求根）`)}</th>
              <th className="num">|差|</th>
              <th className="num">{rich(String.raw`$\omega^*$ [deg]`)}</th>
              <th className="num">{rich(String.raw`$\rho(0.999999\,g^*)$`)}</th>
              <th className="num">{rich(String.raw`$\rho(1.000001\,g^*)$`)}</th>
              <th className="num">{rich(String.raw`$g=0.3$ 時 $PM_d$`)}</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r) => (
              <tr key={r.d}>
                <td className="num mono">{r.d}</td>
                <td className="num mono">{fx(r.gCritClosed, 6)}</td>
                <td className="num mono">{fx(r.gCritNumeric, 6)}</td>
                <td className="num mono">{Math.abs(r.gCritClosed - r.gCritNumeric).toExponential(1)}</td>
                <td className="num mono">{fx(r.omegaCritDeg, 3)}</td>
                <td className="num mono">{fx(r.rhoBelow, 8)}</td>
                <td className="num mono">{fx(r.rhoAbove, 8)}</td>
                <td className="num mono">{fx(pmWithDelay(0.3, r.d).pmDeg, 2)}°</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        <ClaimTag kind="exact" /> 只對 <Tex>{'z^{d+1}-z^d+g=0'}</Tex> 這個特定特徵方程成立；golden vectors <code>delay_bounds.json</code>（Python brentq，不用封閉式）與上表的
        TypeScript 數值逐項比對到 1e-10。 <TestBadge id="T08" />
      </p>
      <div className="grid-2">
        <Plot
          title={String.raw`spectral radius $\rho(g)$：$d=0\ldots4$`}
          ariaLabel="spectral radius 對 loop gain（d = 0 到 4）"
          data={curves.rho}
          height={280}
          csvName="ch08-rho-vs-g"
          layout={RHO_LAYOUT}
          caption={rich(
            String.raw`每條曲線第一次碰到 $\rho=1$ 的位置就是 $g^*(d)$：$${table
              .slice(0, 5)
              .map((r) => sig(r.gCritNumeric, 3))
              .join(String.raw`,\ `)}$（由 polyRoots 逐點求根、二分法得到，不用封閉式）。`,
          )}
        />
        <Plot
          title={String.raw`$PM_d(g)$：每多一個 block，PM 多扣 $\omega_c$`}
          ariaLabel="含延遲的 phase margin 對 loop gain"
          data={curves.pm}
          height={280}
          csvName="ch08-pm-d"
          layout={PMD_LAYOUT}
          caption={rich(String.raw`$PM_d=90^\circ-(2d+1)\arcsin(g/2)$ 穿過 $0^\circ$ 的位置與左圖 $\rho=1$ 的位置相同。`)}
        />
      </div>

      <ModeGate min="research">
        <Expand title={rich(String.raw`Research：為什麼一過 $g^*$ 就真的不穩（transversality）以及小 $g$ 的根近似`)} badge="研究" openFrom="research">
          <StepDerivation
            steps={[
              { tex: String.raw`z=1+\varepsilon:\;(1+\varepsilon)^d\varepsilon=-g\;\Rightarrow\;\varepsilon=-g+O(g^2)`, why: rich(String.raw`慢根 $\approx1-g$：小 $g$ 時延遲幾乎不影響主要模態（所以小 $\mu$ 的 LMS 對延遲不敏感）。`) },
              { tex: String.raw`z^{d}=\frac{-g}{z-1}\approx g\;\Rightarrow\;|z|\approx g^{1/d}`, why: rich(String.raw`快根：$d$ 個根大致分佈在半徑 $g^{1/d}$ 的圓上；$g\to g^*$ 時其中一對共軛根先到達單位圓。`) },
              { tex: String.raw`\frac{d|z|}{dg}\Big|_{g^*}>0`, why: rich(String.raw`穿越方向向外（transversal）：數值上 $\rho(0.999999g^*)<1<\rho(1.000001g^*)$，上表每一列都成立。`) },
            ]}
          />
          <p className="small">
            這也解釋了為什麼「把 <Tex>{'\\mu'}</Tex> 調小」永遠能救回延遲造成的不穩：<Tex>{'g^*(d)>0'}</Tex> 對每個 <Tex>{'d'}</Tex> 都成立，所有快根都在半徑 <Tex>{'g^{1/d}'}</Tex> 附近，慢根在 <Tex>{'1-g'}</Tex>；代價是收斂時間{' '}
            <Tex>{'\\tau\\approx1/g'}</Tex> 變長、noise 頻寬變窄（Ch12、Ch14 的取捨）。
          </p>
        </Expand>
      </ModeGate>

      <h4>核心程式碼</h4>
      <CodeCompare
        items={[
          { label: '封閉式臨界增益', source: stabilitySrc, region: 'delayCriticalGain', path: SRC_PATH, note: '封閉式 F-08.8：一行算完' },
          { label: '數值臨界增益（掃描 + 二分）', source: stabilitySrc, region: 'delayCriticalGainNumeric', path: SRC_PATH, note: '只用數值 spectral radius：完全不碰封閉式' },
          { label: '穩定判斷 delayStable', source: stabilitySrc, region: 'delayStable', path: SRC_PATH, note: 'polyRoots（companion matrix + Newton polish）求根，再取最大模數' },
        ]}
      />
      <p className="small">
        {rich(
          String.raw`左：$g^*=2\sin\frac{\pi}{4d+2}$、$\omega^*=\frac{\pi}{2d+1}$。中：只呼叫 $\rho(g)=\max_i|z_i(g)|$，找第一個 $\rho\ge1$ 的區間後二分。右：$\rho(g)$ 本身＝對 $z^{d+1}-z^d+g$ 求 $d+1$ 個根。三者互相獨立，上面的表就是它們的逐列比對。`,
        )}
      </p>
      <ModeGate min="engineer">
        <div className="grid-2">
          <CodeBlock source={stabilitySrc} region="delayCharPoly" path={SRC_PATH} title="delayCharPoly" />
          <CodeBlock source={stabilitySrc} region="simulateDelayRecursion" path={SRC_PATH} title="simulateDelayRecursion（step response）" />
        </div>
        <CodeCompare
          items={[
            { label: '無延遲 pmFirstOrder（§8.2）', source: stabilitySrc, region: 'pmFirstOrder', path: SRC_PATH, note: String.raw`$d=0$ 的封閉式` },
            { label: '含延遲 pmWithDelay（§8.3）', source: stabilitySrc, region: 'pmWithDelay', path: SRC_PATH, note: '同一個 crossover；PM 多扣延遲的相位，GM 改用含延遲的臨界增益' },
          ]}
          caption="差異行以「← 差異」標出；無延遲時兩者逐位相同（單元測試確認）。"
        />
        <p className="small">
          {rich(
            String.raw`差異只有兩行：$PM$ 的係數 $1\to2d+1$（每個 block 多扣 $\omega_c=2\arcsin(g/2)$），$GM$ 的分子 $2\to g^*(d)$。$d=0$ 時 $g^*(0)=2$，兩個函式回到同一組數字。`,
          )}
        </p>
      </ModeGate>

      <Callout kind="warn" title={String.raw`工程注意：$d$ 不能用猜的`}>
        <ul>
          <li>
            <Tex>{'d'}</Tex> 是「GMAC 用來計算 <Tex>{'G_k'}</Tex> 的那批 sample 所看到的係數」與「<Tex>{'G_k'}</Tex> 更新出的新係數」之間隔了幾個 block。必須從 RTL 的 sample / accumulate / commit / apply
            timing 數出來；半個 block 的延遲（例如在 block 中間 commit）會讓模型變成非整數延遲，需要更細的時間軸（L5）。
          </li>
          <li>
            本站 <code>blockLms</code> 模擬器的 <code>cal_update_delay_blocks = d</code> 正是這個定義：block <Tex>{'k'}</Tex> 使用 <Tex>{'w_{k-d}'}</Tex>，平均模型就是本節的遞迴（PM Lab 的 Monte Carlo
            直接驗證）。
          </li>
          <li>
            設計建議：先算 <Tex>{'g^*(d)'}</Tex>，再留 GM（例如 <Tex>{'g\\le g^*/2'}</Tex>，<Tex>{'GM=6\\ \\mathrm{dB}'}</Tex>）給 <Tex>{'K_q'}</Tex>、<Tex>{'C'}</Tex> 的 PVT 變化——{rich(String.raw`$K$ 變大 2 倍，$g$ 也變大 2 倍。`)}
            <ClaimTag kind="approx" />
          </li>
        </ul>
      </Callout>

      <Quiz
        title="思考題 3（更新延遲）"
        question={
          <>
            RTL 的 pipeline 讓 <Tex>{'d=2'}</Tex>。你用一階模型選了 <Tex>{'g=0.65'}</Tex>（一階 PM 看起來還有 <Tex>{`${tx(pmWithDelay(0.65, 0).pmDeg, 1)}^\\circ`}</Tex>）。實際會怎樣？
          </>
        }
        options={[
          { label: rich(String.raw`穩定，因為 $0<g<2$`) },
          { label: rich(String.raw`穩定，因為一階 $PM$ 有 $${fx(pmWithDelay(0.65, 0).pmDeg, 0)}^\circ$`) },
          { label: rich(String.raw`不穩定：$g>2\sin(\pi/10)\approx${tx(g2, 3)}$`), correct: true },
          { label: '臨界振盪' },
        ]}
        answer={
          <>
            <Tex>{String.raw`g^*(2)=2\sin(\pi/10)=${tx(g2, 4)}<0.65`}</Tex>，所以不穩定：<Tex>{String.raw`\rho=${tx(delayStable(0.65, 2).rho, 4)}>1`}</Tex>。頻域上{' '}
            <Tex>{String.raw`PM_2=90^\circ-5\arcsin(0.325)=${tx(pmWithDelay(0.65, 2).pmDeg, 2)}^\circ<0`}</Tex>。一階的{' '}
            <Tex>{String.raw`${tx(pmWithDelay(0.65, 0).pmDeg, 1)}^\circ`}</Tex> 沒算到延遲：每個 block 再扣{' '}
            <Tex>{String.raw`\omega_c=${tx((pmWithDelay(0.65, 2).omegaC * 180) / Math.PI, 1)}^\circ`}</Tex>，兩個 block 共扣{' '}
            <Tex>{String.raw`${tx((2 * pmWithDelay(0.65, 2).omegaC * 180) / Math.PI, 1)}^\circ`}</Tex>，PM 就變成負的。
          </>
        }
      />
    </Section>
  )
}
