import { useMemo, type ReactNode } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
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
  ChRef,
} from '@/components'
import stabilitySrc from '@/simulation/models/stability.ts?raw'
import { calLoopGain, loopMargins, pmFirstOrder, simulateDelayRecursion } from '@/simulation/models/stability'
import { Expand, fx, HandCalcSlot, rich, sig, tx } from '../common'
import { formula } from '../formulas'
import { FIRST_ORDER_CHART, LOOP_CUT_CHART, PM_FLOW_CHART } from '../diagrams'

const SRC_PATH = 'src/simulation/models/stability.ts'
const HAND_GAINS = [0.5, 1, 1.5, 2.2]
const SPEC_GAINS = [0.2, 0.5, 1, 1.5, 1.8, 2]
// Plot 的 layout 放在模組層級：物件參考固定，重新渲染時不會觸發多餘的 Plotly.react（也不會重設使用者的縮放）
const PM_LAYOUT: Partial<Layout> = {
  xaxis: { title: { text: '$g$' } },
  yaxis: { title: { text: '$PM$ [deg]' }, range: [0, 95] },
  yaxis2: { title: { text: '$DM$ [blocks]' }, overlaying: 'y', side: 'right', range: [0, 3], showgrid: false },
}
const POLE_LAYOUT: Partial<Layout> = { xaxis: { title: { text: '$g$' } }, yaxis: { title: { text: 'pole' }, range: [-1.3, 1.1] } }

function behaviour(g: number): ReactNode {
  if (g <= 0) return '極性錯誤：發散'
  if (g < 1) return rich(String.raw`單調收斂（$0<p<1$）`)
  if (g === 1) return rich(String.raw`一步到位（deadbeat，$p=0$）`)
  if (g < 2) return rich(String.raw`正負交替但收斂（$-1<p<0$）`)
  if (g === 2) return rich(String.raw`臨界：$\pm1$ 永遠交替`)
  return rich(String.raw`正負交替發散（$p<-1$）`)
}

/** §8.2 一階 calibration loop：L_cal(z) = g/(z − 1) 與 PM */
export function FirstOrderPm() {
  const tokens = useThemeTokens()
  const g1 = pmFirstOrder(1)
  const g12 = pmFirstOrder(1.2)
  const g15 = pmFirstOrder(1.5)
  const numeric1 = useMemo(() => loopMargins((w) => calLoopGain(1, 0, w)), [])
  const curves = useMemo(() => {
    const gs = Array.from({ length: 221 }, (_, i) => 0.01 * i)
    const rows = gs.map((g) => pmFirstOrder(g))
    const pm: Data[] = [
      { x: gs, y: rows.map((r) => (Number.isFinite(r.pmDeg) ? r.pmDeg : null)), name: String.raw`$PM = 90^\circ - \arcsin(g/2)$`, mode: 'lines', line: { color: tokens.series[0], width: 2 } },
      { x: gs, y: rows.map((r) => (Number.isFinite(r.delayMarginBlocks) ? r.delayMarginBlocks : null)), name: String.raw`Delay margin $DM$ [blocks]（右軸）`, yaxis: 'y2', mode: 'lines', line: { color: tokens.series[2], width: 1.5, dash: 'dash' } },
      { x: [1], y: [pmFirstOrder(1).pmDeg], name: String.raw`$g = 1$：$PM = ${fx(pmFirstOrder(1).pmDeg, 0)}^\circ$（T08）`, mode: 'markers', marker: { size: 10, color: tokens.danger } },
    ]
    const pole: Data[] = [
      { x: gs, y: rows.map((r) => r.pole), name: String.raw`閉迴路 pole $1 - g$`, mode: 'lines', line: { color: tokens.series[1], width: 2 } },
      { x: gs, y: rows.map((r) => Math.abs(r.pole)), name: String.raw`$|\mathrm{pole}|$`, mode: 'lines', line: { color: tokens.series[3], width: 1.5, dash: 'dot' } },
      { x: [0, 2.2], y: [1, 1], name: String.raw`$|z| = 1$`, mode: 'lines', line: { color: tokens.textMuted, dash: 'dash', width: 1 } },
      { x: [0, 2.2], y: [-1, -1], name: String.raw`$z = -1$`, mode: 'lines', line: { color: tokens.textMuted, dash: 'dash', width: 1 }, showlegend: false },
    ]
    return { pm, pole }
  }, [tokens])

  return (
    <Section kind="formula" title={rich(String.raw`§8.2 真正的 calibration loop：$L_{\mathrm{cal}}(z)=\frac{g}{z-1}$`)} level={2} id="ch08-first-order">
      <p>
        GMAC 每 <Tex>{'N'}</Tex> 個 sample 吐出一個平均相關 <Tex>{'G_k'}</Tex>，係數暫存器把它累加起來：<Tex>{'w_{k+1}=w_k+\\mu G_k'}</Tex>。「累加」就是離散時間的
        <strong>積分器</strong>。積分器的輸出 <Tex>{'w'}</Tex> 又決定下一個 block 的誤差 <Tex>{'\\delta=a-w'}</Tex>——這是一個完整的回授迴路，所以它有自己的 loop
        gain、pole 和 phase margin。
      </p>
      <p>
        {rich(
          String.raw`先把符號講清楚（本節起時間都以 block 計）：$k$ 是 GMAC block 的編號（每 $N$ 個 sample 一個 block）；$a$ 是要學的真實增益，$w_k$ 是第 $k$ 個 block 的係數估計；$\delta_k=a-w_k$ 是還沒修掉的剩餘誤差（單位 fs）；$\mu$ 是學習率（每次修正的步長，單位 fs）。小誤差時 GMAC 的平均輸出正比於剩餘誤差，$G_k\approx K\delta_k$；斜率 $K=K_qC$（$K_q$ 是 Ch05 的 comparator 統計增益，$C$ 是 Ch06 的相關，$K$ 的單位是 $\mathrm{fs}^{-1}$）。兩者相乘的 $g=\mu K$ 沒有單位，叫正規化 loop gain——本章所有的穩定條件都只看這個數字。`,
        )}
      </p>
      <p>
        {rich(
          String.raw`把 $\delta_k=a-w_k$ 放回系統地圖上看：累加器餘數 $x[n]$（$n$ 屬於第 $k$ 個 block）讓 feedback（divider）edge 比理想時刻早到 $a\,x[n]$；reference 端的 DTC 只能延遲、不能提前，所以它從一個固定的基準延遲 $T_0$ 往回扣，$\tau_{\mathrm{DTC}}[n]=T_0-w_k\,x[n]$：code 越大延遲越短，reference edge 相對於這個基準也提前（少延遲）$w_k\,x[n]$（這是 DTC 的補償量；$T_0$ 是常數，被 PLL 當成靜態相位偏移吸收）。PD 量的是經過 DTC 的 reference edge 減 feedback edge，所以它的輸出是 $e[n]=(a-w_k)\,x[n]+v[n]=\delta_k\,x[n]+v[n]$（$v[n]$ 是 comparator 前的雜訊）：補償不足（$w_k<a$）時 reference 還是太晚，$e[n]$ 平均為正。comparator 取的就是這個 PD 輸出 $e[n]$ 的正負號，GMAC 再把它和 $x[n]$ 相乘累加。`,
        )}
      </p>
      <Mermaid
        caption={String.raw`一階 calibration loop（block rate）：沿著箭頭走一圈，注意加法點 $\Sigma$ 的兩個輸入一正一負，以及藍色的積分器`}
        chart={FIRST_ORDER_CHART}
      />
      <p className="small">
        {rich(
          String.raw`讀圖：先看圓形的加法點 $\Sigma$——目標 $a$ 從「＋」進來，$w_k$ 從「−」回來，所以輸出是 $\delta_k=a-w_k$（全站的極性約定）。再順著箭頭走：$\delta_k$ 乘上 GMAC 斜率 $K$ 變成 $G_k$，進入藍色的暫存器累加成 $w_k$，回到 $\Sigma$。圖上的 $\mu/(z-1)$ 就是更新式 $w_{k+1}=w_k+\mu G_k$ 換一種寫法：$z$ 是 Z transform 的變數，乘一次 $z^{-1}$ 代表延遲一個 block（下面的先備知識會從等比級數推出來）。`,
        )}
      </p>

      <h4>要量 phase margin，先把迴路剪開</h4>
      <p>
        {rich(
          String.raw`做法和類比迴路一樣：在某一點把迴路剪開，從缺口注入一個測試弦波，看它繞一圈回來變成什麼。沿途所有方塊的乘積叫開迴路增益（loop gain），記成 $L_{\mathrm{cal}}(z)$。`,
        )}
      </p>
      <Mermaid
        caption={String.raw`在 $\delta$ 處把迴路剪開：框起來的三個方塊相乘就是開迴路增益；回到 $\Sigma$ 時走的是負端，所以回來的訊號多一個負號`}
        chart={LOOP_CUT_CHART}
      />
      <p className="small">
        {rich(
          String.raw`讀圖：先看框起來的三個方塊——$\times K$、$\times\mu$、積分器 $\frac{1}{z-1}$，相乘就是下面 F-08.2 的 $L_{\mathrm{cal}}(z)=\frac{g}{z-1}$（圖上的 $\times K$ 與 $\times\mu$ 合起來就是公式裡的 $g=\mu K$）。再看最右邊：訊號回到 $\Sigma$ 時走的是「−」端，所以回來的是 $-L_{\mathrm{cal}}\,\delta_{\mathrm{in}}$。如果在某個頻率剛好 $L_{\mathrm{cal}}=-1$，回來的訊號和注入的一模一樣，迴路不需要外力就能一直振盪下去。Phase margin 與 gain margin 量的就是 $L_{\mathrm{cal}}$ 離 $-1$ 這一點還有多遠（差幾度、差幾倍）。`,
        )}
      </p>

      <Prereq title="Z transform：把「一串數字」變成「一個函數」（只需等比級數）">
        <p>
          把序列 <Tex>{'x_0,x_1,x_2,\\dots'}</Tex> 包成一個冪級數 <Tex>{'X(z)=\\sum_{k\\ge0}x_kz^{-k}'}</Tex>。最重要的兩個性質：
        </p>
        <StepDerivation
          steps={[
            { tex: String.raw`\mathcal Z\{x_{k+1}\}=\sum_{k\ge0}x_{k+1}z^{-k}=z\sum_{m\ge1}x_mz^{-m}=z\big(X(z)-x_0\big)`, why: rich(String.raw`令 $m=k+1$，再把少掉的第 0 項補回來：「往前一步」＝乘 $z$。`) },
            { tex: String.raw`\mathcal Z\{x_{k-1}\}=z^{-1}X(z)\quad(x_{-1}=0)`, why: rich(String.raw`同理，「延遲一步」＝乘 $z^{-1}$。所以 $z^{-1}$ 就是「一個 block 的延遲」。`) },
            { tex: String.raw`x_k=p^k\;\Rightarrow\;X(z)=\sum_{k\ge0}(p\,z^{-1})^k=\frac{1}{1-pz^{-1}}=\frac{z}{z-p}`, why: rich(String.raw`等比級數 $\sum r^k=\frac{1}{1-r}$（需 $|r|<1$）。分母為零的點 $z=p$ 叫 pole。`) },
            { tex: String.raw`|p|<1\iff p^k\to0`, why: rich(String.raw`等比數列收斂的條件。所以「所有 pole 在單位圓內」$\iff$「誤差衰減」——這就是離散時間穩定性的全部直覺。`) },
          ]}
        />
      </Prereq>

      <Expand title={rich(String.raw`一步一步推導 $L_{\mathrm{cal}}(z)$ 與閉迴路 pole`)}>
        <StepDerivation
          steps={[
            { tex: String.raw`G_k=K\,(a-w_k)=K\,\delta_k,\qquad K=K_qC>0`, why: rich(String.raw`小誤差時 GMAC 的平均輸出正比於剩餘誤差（Ch05 的 $K_q$、Ch06 的相關 $C$；E13 的定義）。`) },
            { tex: String.raw`w_{k+1}=w_k+\mu G_k`, why: rich(String.raw`暫存器每個 block 加上 $\mu$ 倍的 GMAC 輸出。`) },
            { tex: String.raw`\delta_{k+1}=a-w_{k+1}=(a-w_k)-\mu K\delta_k`, why: rich(String.raw`兩邊用 $a$ 去減（$a$ 是常數）。`) },
            { tex: String.raw`\delta_{k+1}=(1-g)\,\delta_k,\qquad g\triangleq\mu K`, why: rich(String.raw`合併同類項；$g$ 是無因次的正規化 loop gain（$\mu$ 的單位 $\mathrm{fs}$ 乘上 $K$ 的單位 $\mathrm{fs}^{-1}$：$\mathrm{fs}\times\mathrm{fs}^{-1}=1$）。`) },
            { tex: String.raw`(z-1)\,W(z)=\mu\,G(z)\;\Rightarrow\;W(z)=\frac{\mu}{z-1}\,G(z)`, why: rich(String.raw`對 $w$ 的更新式做 Z transform（初值項不影響轉移函數）：暫存器＝積分器 $\frac{\mu}{z-1}$。`) },
            { tex: String.raw`L_{\mathrm{cal}}(z)=\underbrace{K}_{\text{GMAC}}\cdot\underbrace{\frac{\mu}{z-1}}_{\text{暫存器}}=\frac{g}{z-1}`, why: rich(String.raw`開迴路增益＝沿著迴路走一圈所有方塊的乘積（在 $\Sigma$ 處斷開）。`) },
            { tex: String.raw`\frac{W(z)}{A(z)}=\frac{L}{1+L}=\frac{g}{z-1+g}\;\Rightarrow\;p=1-g`, why: rich(String.raw`閉迴路的分母 $1+L=0\iff z-1+g=0$，pole 正好是遞迴式的乘數 $1-g$。`) },
            { tex: String.raw`|1-g|<1\iff 0<g<2`, why: rich(String.raw`等比數列收斂條件（上面的先備知識）。$g=2$ 時 pole $=-1$：臨界，不是穩定。`) },
          ]}
          result={String.raw`L_{\mathrm{cal}}(z)=\frac{g}{z-1},\quad p=1-g,\quad 0<g<2`}
        />
      </Expand>
      <TexBlock id="F-08.2" label={rich(String.raw`一階 calibration loop（E13：$g=\mu K$，$K=K_qC$）`)}>
        {formula('F-08.2').tex}
      </TexBlock>
      <TexBlock id="F-08.3" label="閉迴路 pole 與穩定範圍">
        {formula('F-08.3').tex}
      </TexBlock>

      <h4>{rich(String.raw`先算一次：$\delta_0=1$，四種 $g$ 的前 6 個 block（由 simulateDelayRecursion 即時計算）`)}</h4>
      <div className="table-wrap">
        <table className="ch08-table">
          <thead>
            <tr>
              <th className="num">{rich(String.raw`$g$`)}</th>
              <th className="num">{rich(String.raw`pole $1-g$`)}</th>
              {[0, 1, 2, 3, 4, 5].map((k) => (
                <th key={k} className="num">
                  <Tex>{`\\delta_{${k}}`}</Tex>
                </th>
              ))}
              <th>行為</th>
            </tr>
          </thead>
          <tbody>
            {HAND_GAINS.map((g) => {
              const d = simulateDelayRecursion(g, 0, 5).delta
              return (
                <tr key={g}>
                  <td className="num mono">{g}</td>
                  <td className="num mono">{fx(1 - g, 2)}</td>
                  {Array.from(d).map((v, k) => (
                    <td key={k} className="num mono">
                      {fx(v, 4)}
                    </td>
                  ))}
                  <td>{behaviour(g)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="small">
        例：<Tex>{String.raw`g=1.5`}</Tex> 時 <Tex>{String.raw`\delta_1=(1-1.5)\cdot1=-0.5,\;\delta_2=(-0.5)(-0.5)=0.25`}</Tex>——「穩定」不代表「不振盪」，pole 在負實軸上就會正負交替。
      </p>

      <h4>從 loop gain 讀出 PM、GM、DM</h4>
      <p>
        {rich(
          String.raw`接下來要算三個「裕度」。名詞先講清楚：$\omega$ 是 block rate 上的離散頻率（單位 rad/block；$\omega=2\pi f/f_u$，$f_u=f_s/N$ 是每秒更新幾次）。$\omega_c$（gain crossover）是開迴路增益大小剛好等於 $1$ 的頻率。$PM$（phase margin）是在 $\omega_c$ 那一點，$L_{\mathrm{cal}}$ 的相位離 $-180^\circ$ 還剩幾度。$GM$（gain margin）是 loop gain 還能再放大幾倍才會不穩。$DM$（delay margin）是迴路還能再多塞幾個 block 的純延遲。`,
        )}
      </p>
      <Mermaid
        caption={String.raw`手算順序：從 $g$ 出發，一條線算 pole，一條線算交越頻率、相位、$PM$、$DM$，另一條線算 $GM$；藍色是本節的主角 $PM$`}
        chart={PM_FLOW_CHART}
      />
      <p className="small">
        {rich(
          String.raw`讀圖：先看從 $g$ 直接分出去的兩格——pole $p=1-g$（F-08.3）和 $GM=2/g$（F-08.6），各只要一步。再看中間那條長的：$g\to\omega_c\to\angle L\to PM\to DM$，每一格只做一種運算（一次 $\sin^{-1}$、一次減法、一次除法）。圖上的四格依序就是 F-08.4（$\omega_c$）、推導裡的 $\angle L=-90^\circ-\omega/2$、F-08.5（$PM$）與 F-08.6（$DM$）。`,
        )}
      </p>

      <Prereq title="Euler 公式與單位圓：單位圓上的弦長公式怎麼來的">
        <StepDerivation
          steps={[
            { tex: String.raw`e^{j\omega}=\cos\omega+j\sin\omega,\qquad |e^{j\omega}|=1`, why: rich(String.raw`Euler 公式（可由 $e^x$、$\cos$、$\sin$ 的泰勒展開比對得到）；它在單位圓上，角度 $\omega$。`) },
            { tex: String.raw`e^{j\omega}-1=e^{j\omega/2}\big(e^{j\omega/2}-e^{-j\omega/2}\big)`, why: rich(String.raw`提出「半角」$e^{j\omega/2}$：兩項相乘還原成 $e^{j\omega}-1$。`) },
            { tex: String.raw`e^{j\omega/2}-e^{-j\omega/2}=2j\sin\frac{\omega}{2}`, why: rich(String.raw`Euler 公式相減：$\cos$ 抵消、$\sin$ 加倍。`) },
            { tex: String.raw`e^{j\omega}-1=2\sin\frac{\omega}{2}\cdot e^{j(\omega/2+90^\circ)}`, why: rich(String.raw`$j=e^{j90^\circ}$；$0<\omega<2\pi$ 時 $\sin(\omega/2)>0$，所以這就是極座標形式。`) },
            { tex: String.raw`\big|e^{j\omega}-1\big|=2\sin\frac{\omega}{2},\qquad \angle\big(e^{j\omega}-1\big)=\frac{\omega}{2}+90^\circ`, why: rich(String.raw`直接讀出大小與角度。幾何意義：單位圓上一點到 $z=1$ 的弦長。`) },
          ]}
        />
      </Prereq>
      <Prereq title="離散時間迴路的 Bode / Nyquist / Phase margin（從連續時間搬過來要注意什麼）">
        <ul>
          <li>
            <strong>頻率響應</strong>：把 <Tex>{'z=e^{j\\omega}'}</Tex> 代入 <Tex>{'L(z)'}</Tex>。<Tex>{'\\omega'}</Tex> 的單位是 rad/block，只需看 <Tex>{'0\\le\\omega\\le\\pi'}</Tex>（對應{' '}
            <Tex>{'0\\le f\\le f_u/2'}</Tex>，<Tex>{'f=\\omega f_u/2\\pi'}</Tex>）；負頻率是共軛。
          </li>
          <li>
            <strong>Gain crossover</strong> <Tex>{'\\omega_c'}</Tex>：<Tex>{'|L(e^{j\\omega_c})|=1'}</Tex>。<strong>Phase margin</strong>：
            <Tex>{'PM=180^\\circ+\\angle L(e^{j\\omega_c})'}</Tex>，相位要從低頻<strong>連續展開</strong>（不能用 atan2 的主值硬套）。
          </li>
          <li>
            <strong>Gain margin</strong>：在 <Tex>{'\\angle L=-180^\\circ'}</Tex> 的頻率 <Tex>{'\\omega_{180}'}</Tex>，<Tex>{'GM=1/|L(e^{j\\omega_{180}})|'}</Tex>。
          </li>
          <li>
            <strong>為什麼看 −1 點</strong>：閉迴路 poles 是 <Tex>{'1+L(z)=0'}</Tex> 的根。當某個 pole 恰好落在單位圓上 <Tex>{'z=e^{j\\omega}'}</Tex>，就有{' '}
            <Tex>{'L(e^{j\\omega})=-1'}</Tex>——Nyquist 曲線穿過 −1。PM、GM 量的就是曲線離 −1 還有多遠（角度、倍數）。
          </li>
          <li>
            <strong>Delay margin</strong>：再多一個 <Tex>{'\\tau'}</Tex> block 的純延遲 <Tex>{'e^{-j\\omega\\tau}'}</Tex> 只改相位，在 <Tex>{'\\omega_c'}</Tex> 吃掉{' '}
            <Tex>{'\\omega_c\\tau'}</Tex> rad；所以 <Tex>{'DM=PM[\\mathrm{rad}]/\\omega_c'}</Tex>。
          </li>
          <li>
            <strong>{rich(String.raw`積分器 pole 在 $z=1$（單位圓上）`)}</strong>：Nyquist 圍線要用小半圓繞過它，對應 L 平面上半徑趨近無限大的半圓；<Tex>{'|L|'}</Tex> 在{' '}
            <Tex>{'\\omega\\to0'}</Tex> 時趨近無限大，畫圖要裁切。
          </li>
        </ul>
      </Prereq>

      <Expand title="一步一步推導 crossover 與 PM">
        <StepDerivation
          steps={[
            { tex: String.raw`L(e^{j\omega})=\frac{g}{e^{j\omega}-1}`, why: rich(String.raw`把 $z=e^{j\omega}$ 代入 $L_{\mathrm{cal}}$。`) },
            { tex: String.raw`|L(e^{j\omega})|=\frac{g}{2\sin(\omega/2)}`, why: '分母大小用上面的弦長公式。' },
            { tex: String.raw`|L(e^{j\omega_c})|=1\iff\sin\frac{\omega_c}{2}=\frac g2`, why: rich(String.raw`crossover 的定義；$\sin$ 在 $(0,\pi/2]$ 遞增，所以 $0<g\le2$ 時恰有一個解。`) },
            { tex: String.raw`\omega_c=2\arcsin\frac g2`, why: rich(String.raw`取反函數。$g>2$ 時無解：$|L|>1$ 對所有 $\omega$ 成立。`) },
            { tex: String.raw`\angle L(e^{j\omega})=0^\circ-\Big(\frac{\omega}{2}+90^\circ\Big)=-90^\circ-\frac{\omega}{2}`, why: rich(String.raw`分子 $g>0$ 的角度是 $0$；除法＝角度相減。低頻時 $-90^\circ$（積分器），連續變化、不需 wrap。`) },
            { tex: String.raw`PM=180^\circ+\angle L(e^{j\omega_c})=90^\circ-\frac{\omega_c}{2}`, why: 'PM 的定義。' },
            { tex: String.raw`PM=90^\circ-\arcsin\frac g2`, why: rich(String.raw`代入 $\omega_c=2\arcsin(g/2)$。`) },
          ]}
        />
      </Expand>
      <TexBlock id="F-08.4" label="Gain crossover">
        {formula('F-08.4').tex}
      </TexBlock>
      <TexBlock id="F-08.5" label="Calibration phase margin（T08）">
        {formula('F-08.5').tex}
      </TexBlock>
      <p>
        <strong>
          數字驗算（<Tex>{'g=1'}</Tex>）
        </strong>
        ：<Tex>{String.raw`\omega_c=2\arcsin(0.5)=\pi/3=${tx(g1.omegaC, 6)}\ \mathrm{rad/block}`}</Tex>；
        <Tex>{String.raw`\angle L=-90^\circ-30^\circ=-120^\circ`}</Tex>；<Tex>{String.raw`PM=${tx(g1.pmDeg, 4)}^\circ`}</Tex>。數值 crossover（不用封閉式，二分法 + 展開相位）得到{' '}
        <Tex>{String.raw`\omega_c=${tx(numeric1.omegaC, 10)},\ PM=${tx(numeric1.pmDeg, 8)}^\circ`}</Tex>。pole <Tex>{String.raw`1-g=${sig(g1.pole)}`}</Tex>：一步到位。 <TestBadge id="T08" />
      </p>

      <HandCalcSlot id="HC-08.2">
        {rich(String.raw`把 $g$ 換成你自己的 loop gain（例如 $0.8$ 或 $0.3$），拿計算機按一次 $\sin^{-1}$，自己算出 pole、$PM$ 和 $\omega_c$。`)}
      </HandCalcSlot>

      <h4>規格 §8.2 的表（由 pmFirstOrder 即時計算）</h4>
      <div className="table-wrap">
        <table className="ch08-table">
          <thead>
            <tr>
              <th className="num">{rich(String.raw`$g$`)}</th>
              <th className="num">{rich(String.raw`pole $1-g$`)}</th>
              <th className="num">{rich(String.raw`$\omega_c$ [rad/block]`)}</th>
              <th className="num">{rich(String.raw`$PM$`)}</th>
              <th className="num">{rich(String.raw`$GM=20\log_{10}(2/g)$`)}</th>
              <th className="num">{rich(String.raw`$DM$ [blocks]`)}</th>
              <th>狀態</th>
            </tr>
          </thead>
          <tbody>
            {SPEC_GAINS.map((g) => {
              const r = pmFirstOrder(g)
              return (
                <tr key={g}>
                  <td className="num mono">{g}</td>
                  <td className="num mono">{fx(r.pole, 1)}</td>
                  <td className="num mono">{fx(r.omegaC, 4)}</td>
                  <td className="num mono">{fx(r.pmDeg, 1)}°</td>
                  <td className="num mono">{fx(r.gmDb, 2)} dB</td>
                  <td className="num mono">{fx(r.delayMarginBlocks, 3)}</td>
                  <td>{r.marginal ? '臨界（不是穩定）' : r.stable ? '穩定' : '不穩定'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="grid-2">
        <Plot
          title={String.raw`PM 與 delay margin vs $g$（$d=0$）`}
          ariaLabel="PM 與 delay margin 對 loop gain"
          data={curves.pm}
          height={260}
          csvName="ch08-pm-vs-g"
          layout={PM_LAYOUT}
          caption={rich(
            String.raw`實線（左軸）：$PM=90^\circ-\arcsin(g/2)$；虛線（右軸）：$DM=PM[\mathrm{rad}]/\omega_c$。紅點是 T08 的 $g=1$：$PM=${tx(g1.pmDeg, 0)}^\circ$、$DM=${tx(g1.delayMarginBlocks, 0)}$ block。`,
          )}
        />
        <Plot
          title={String.raw`閉迴路 pole $1-g$`}
          ariaLabel="閉迴路 pole 對 loop gain"
          data={curves.pole}
          height={260}
          csvName="ch08-pole-vs-g"
          layout={POLE_LAYOUT}
          caption={rich(String.raw`$p=1-g$ 是一條直線；$|p|<1$（兩條虛線之間）才穩定，$g>1$ 之後 $p<0$：正負交替。`)}
        />
      </div>

      <Expand title={rich(String.raw`Nyquist 其實是一條直線：$\mathrm{Re}\,L=-g/2$（以及 $GM$、$DM$）`)}>
        <StepDerivation
          steps={[
            { tex: String.raw`L(e^{j\omega})=\frac{g}{2\sin(\omega/2)}\,e^{-j(\omega/2+90^\circ)}`, why: rich(String.raw`用極座標形式：大小 $\frac{g}{2\sin(\omega/2)}$，角度 $-90^\circ-\omega/2$。`) },
            { tex: String.raw`e^{-j(\omega/2+90^\circ)}=-\sin\frac{\omega}{2}-j\cos\frac{\omega}{2}`, why: rich(String.raw`$\cos(x+90^\circ)=-\sin x$、$\sin(x+90^\circ)=\cos x$。`) },
            { tex: String.raw`L(e^{j\omega})=-\frac g2-j\,\frac g2\cot\frac{\omega}{2}`, why: rich(String.raw`相乘：實部的 $\sin(\omega/2)$ 與分母抵消。`) },
            { tex: String.raw`\omega:0^+\to\pi\;\Rightarrow\;\mathrm{Im}\,L:-\infty\to0`, why: rich(String.raw`$\cot(\omega/2)$ 由 $+\infty$ 遞減到 $0$；曲線沿著 $\mathrm{Re}\,L=-g/2$ 由下往上走，在 $\omega=\pi$ 碰到實軸。`) },
            { tex: String.raw`L(e^{j\pi})=-\frac g2\;\Rightarrow\;GM=\frac{1}{g/2}=\frac{2}{g}`, why: rich(String.raw`唯一的 phase crossover 在 $\omega=\pi$；$-1$ 不被包圍 $\iff g/2<1\iff g<2$（與 pole 條件一致）。`) },
            { tex: String.raw`DM=\frac{PM[\mathrm{rad}]}{\omega_c}=\frac{\pi/2-\arcsin(g/2)}{2\arcsin(g/2)}`, why: rich(String.raw`$g=1$：$PM=60^\circ=\pi/3$ rad、$\omega_c=\pi/3$，所以 $DM=\frac{\pi/3}{\pi/3}=1$ block——剛好撐得住一個 block 的延遲（下一節 $d=1$ 的臨界就是 $g=1$）。`) },
          ]}
        />
        <TexBlock id="F-08.6" label="Nyquist 直線、GM、DM">
          {formula('F-08.6').tex}
        </TexBlock>
      </Expand>

      <HandCalcSlot id="HC-08.3">
        {rich(String.raw`rad/block 沒有感覺？把 $f_s$、$N$ 換成你晶片的數字，把 $\omega_c$ 換成 kHz，順便算 $GM$ 和 delay margin（上面「Nyquist 其實是一條直線」的推導）。`)}
      </HandCalcSlot>

      <h4>核心程式碼：封閉式 vs 數值（兩條獨立的路徑互相驗證）</h4>
      <CodeCompare
        items={[
          { label: '封閉式 pmFirstOrder', source: stabilitySrc, region: 'pmFirstOrder', path: SRC_PATH, note: '直接套封閉式（F-08.4、F-08.5、F-08.6）' },
          { label: '數值 loopMargins', source: stabilitySrc, region: 'loopMargins', path: SRC_PATH, note: '只用開迴路頻率響應的數值：找增益交越的變號區間、二分法、展開相位' },
        ]}
        caption="PM Lab 的「Analytic」交叉比對就是把這兩者並排：任何一邊寫錯都會顯示 mismatch。"
      />
      <p className="small">
        {rich(
          String.raw`左：$\omega_c=2\arcsin(g/2)$、$PM=90^\circ-\arcsin(g/2)$、$GM=2/g$ 各一行。右：完全不知道這些公式，只在 $\omega$ 網格上找 $|L(e^{j\omega})|-1$ 與 $\mathrm{Im}\,L$ 的變號，再用 $PM=180^\circ+\angle L(e^{j\omega_c})$ 的定義計算。`,
        )}
      </p>
      <ModeGate min="engineer">
        <CodeBlock source={stabilitySrc} region="calLoopGain" path={SRC_PATH} title={String.raw`calLoopGain：開迴路頻率響應（含 $d$ 個 block 的延遲）`} />
      </ModeGate>

      <Callout kind="info" title="怎麼讀這些數字">
        <ul>
          <li>
            <Tex>{'PM\\ge60^\\circ\\iff g\\le1\\iff'}</Tex> pole <Tex>{'\\ge0'}</Tex>：單調收斂、不 overshoot。<ClaimTag kind="exact" />（一階理想模型）
          </li>
          <li>
            {rich(String.raw`$g=1.5$ 的 $PM$ 還有 $${tx(g15.pmDeg, 1)}^\circ$，看起來不差——但 $DM$ 只有 $${tx(g15.delayMarginBlocks, 3)}$ block，`)}<strong>只要 pipeline 多一個 block 就發散</strong>（下一節）。PM 小的代價不是「慢」，是「對延遲脆弱」。
          </li>
          <li>
            實際設計還要另外檢查：低恢復力（<Tex>{'C'}</Tex> 小）、GMAC noise（<ChRef ch="12">Ch12</ChRef>：<Tex>{'\\sigma_w\\propto\\mu/\\sqrt{N(1-p^2)}'}</Tex>）、bias（<ChRef ch="11">Ch11</ChRef>）、輸入激勵（<ChRef ch="09">Ch09</ChRef>）。
            <ClaimTag kind="approx" />
          </li>
        </ul>
      </Callout>

      <Quiz
        title="思考題 2（一階 PM）"
        question={
          <>
            <Tex>{'g=1.2'}</Tex>、無延遲。閉迴路 pole 與 PM 各是多少？
          </>
        }
        options={[
          { label: rich(String.raw`pole $${tx(-g12.pole, 1)}$，$PM=${tx(90 - g12.pmDeg, 1)}^\circ$`) },
          { label: rich(String.raw`pole $${tx(g12.pole, 1)}$，$PM=${tx(g12.pmDeg, 1)}^\circ$`), correct: true },
          { label: rich(String.raw`pole $${tx(g12.pole, 1)}$，$PM=${tx(90 - g12.pmDeg, 1)}^\circ$`) },
          { label: rich(String.raw`pole $1.2$，$PM$ 無定義`) },
        ]}
        answer={
          <>
            <Tex>{String.raw`p=1-1.2=${tx(g12.pole, 1)}`}</Tex>（在負實軸：交替收斂）。<Tex>{String.raw`\arcsin(0.6)=36.87^\circ`}</Tex>，所以{' '}
            <Tex>{String.raw`PM=90^\circ-36.87^\circ=${tx(g12.pmDeg, 2)}^\circ`}</Tex>；<Tex>{String.raw`\omega_c=2\arcsin0.6=${tx(g12.omegaC, 4)}`}</Tex> rad/block，
            <Tex>{String.raw`DM=${tx(g12.delayMarginBlocks, 3)}<1`}</Tex> block：加一個 block 延遲就會發散（<Tex>{String.raw`g=1.2>g^*(1)=1`}</Tex>）。
          </>
        }
      />
    </Section>
  )
}
