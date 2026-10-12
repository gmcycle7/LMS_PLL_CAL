import { memo, useMemo } from 'react'
import { Callout, ClaimTag, HandCalc, Mermaid, ModeGate, Prereq, StepDerivation, Tex, TexBlock } from '@/components'
import { useSettings } from '@/app/settings'
import { SIX_CONDITIONS } from '../data'
import { BLOCK_EQUATION_CHART, CONDITION_MAP_CHART, CONDITION_MAP_LEGEND } from '../diagrams'
import {
  DEFAULT_PARAMS,
  blocksTo95,
  comparatorGain,
  criticalGain,
  evaluateThesis,
  fixedToneRadius,
  impulseEnergyClosed,
  impulseEnergyClosedD1,
  impulseEnergyLyapunov,
  phaseMarginDeg,
  polarityOf,
} from '../thesisModel'
import { handcalc } from '../handcalcs'
import { DiagramWalk, ErratumLink, Glue, Rich, scrollToId } from '../ui'

const R = (t: string) => <Rich text={t} />

const f = (x: number, d = 5) => Number(x.toPrecision(d)).toString()

/** 推導正後方的「帶入手算」：先看推導，馬上代數字算一次（docs/teaching-style.md §7） */
function SpineHandCalc({ id, lead }: { id: string; lead: string }) {
  return (
    <div className="dash-handcalc" data-handcalc={id}>
      <p className="dash-handcalc-lead">
        <strong>換你算一次：</strong>
        <Rich text={lead} />
      </p>
      <HandCalc def={handcalc(id)} />
    </div>
  )
}
/** 科學記號的 TeX：4.084e-5 → 4.084\times10^{-5} */
const texSci = (x: number, d = 4) => {
  const [m, e] = x.toExponential(d - 1).split('e')
  return `${Number(m)}\\times10^{${Number(e)}}`
}

/** 用同一條線性化方程式推出六個條件中的 2–5 號（極性、穩定、variance、bias），並補上延遲與多參數。 */
export const MathSpine = memo(function MathSpine() {
  const { atLeast, mode } = useSettings()
  const t13 = useMemo(() => evaluateThesis({ ...DEFAULT_PARAMS, B: 0 }), [])
  const gStar = useMemo(() => [0, 1, 2, 3, 4].map((d) => ({ d, g: criticalGain(d) })), [])
  const pm = phaseMarginDeg(t13.g, 0)
  // 先備知識「相關」的兩個例子（T06 / T07），由 polarityOf 現算
  const corr = useMemo(
    () => ({
      t06: polarityOf({ Px: 0.5, Hmag: 1, phiDeg: 120, omega: Math.PI / 6, D: 0 }),
      t07: polarityOf({ Px: 0.5, Hmag: 1, phiDeg: -120, omega: Math.PI / 6, D: 4 }),
    }),
    [],
  )
  // 推導 4（system-level）的數字：預設參數，以及 T15（A = 1、Δw = 0.5 fs ⇒ A_t = 0.5 fs peak）
  const sys = useMemo(() => ({ base: evaluateThesis(DEFAULT_PARAMS), t15: evaluateThesis({ ...DEFAULT_PARAMS, Px: 0.5, B: 0.25 }) }), [])
  // 推導 7 的反例（ρ = 0、θ = 60°、μK_qP_x|H| = 1.5）：本模型的 pole 與兩個固定正交 code 的 pole，由計算核心現算
  const ft = useMemo(() => {
    const gp = 1.5
    const p = { ...DEFAULT_PARAMS, B: 0, mu: gp / comparatorGain(DEFAULT_PARAMS.sigmaV), twoParam: true, rho: 0, phiDeg: 60 }
    const r = evaluateThesis(p)
    const c = r.polarity.cosTheta
    return { gp, model: 1 - r.g, fixed: fixedToneRadius(p), re: 1 - gp * c, im: gp * Math.sqrt(1 - c * c), abs2: (1 - gp * c) ** 2 + gp * gp * (1 - c * c) }
  }, [])
  // T10 / T11 的數字（ρ = 0.99、μK_q = 0.5）由公式現算
  const rho = 0.99
  const kappa = (1 + rho) / (1 - rho)
  const t11 = blocksTo95(1 - 0.5 * (1 - rho))
  // 推導 6 的數值表：同樣的 g，commit 延遲 d 讓 Σy²（也就是 σ_w²）變大多少
  const delayNoise = useMemo(
    () =>
      [t13.g, 0.3, 0.6].map((g) => ({
        g,
        rows: [0, 1, 2].map((d) => {
          const e = impulseEnergyLyapunov(g, d)
          return { d, energy: e, ratio: Math.sqrt(e / impulseEnergyClosed(g)) }
        }),
        closedD1: impulseEnergyClosedD1(g),
      })),
    [t13.g],
  )

  return (
    <section id="dash-spine" aria-labelledby="dash-spine-h">
      <h2 id="dash-spine-h" className="dash-h2">
        一條方程式看懂六個條件 <span className="dash-h2-kicker">規格 §5–§12 的共同骨架</span>
      </h2>
      <p className="dash-lead-sm">
        六個條件看起來各講各的，但其中四個（極性、穩定、variance、bias）都來自<strong>同一條</strong>線性化的 block 方程式；第六個（system-level）是把它的結果換算到
        DTC 輸出，第一個（identifiability）是它的多參數版本。先把它推出來，你就知道每一章在放大哪一個項。
      </p>

      <p className="small muted">
        兩個時間索引：<Tex>{'n'}</Tex> 數的是 comparator sample，<Tex>{'k'}</Tex> 數的是 GMAC block（每 <Tex>{'N'}</Tex> 個 sample 一個）。其餘符號在第一次出現時說明；完整的符號表在本頁最後。
      </p>

      <h3 className="dash-h3">先看圖：校正迴路與六個條件的位置</h3>
      <Mermaid
        chart={CONDITION_MAP_CHART}
        ariaLabel="校正迴路方塊圖：DSM code 經 reference 端的 DTC、PLL error path 到 PD 的輸出，1-bit comparator 取 PD 輸出的正負號，再經 GMAC、係數更新回到 DTC；六個條件分別標在 DSM、PLL error path、係數更新、comparator、DTC 與 PLL 輸出"
        caption="實線是訊號流（一圈就是一次校正更新），虛線把每個條件（圓角膠囊）接到它主要取決的那一塊。DTC 在 reference 的輸入端，給的是補償量 $w\cdot x$；comparator 取的是 PD 的輸出 $e[n]$，也就是送進 loop filter 的同一個訊號。下面的方程式只是把這張圖寫成數學。"
      />
      <div className="table-wrap">
        <table className="dash-legend-table">
          <thead>
            <tr>
              <th>條件</th>
              <th>主要取決於哪一塊</th>
              <th>由哪些量決定</th>
            </tr>
          </thead>
          <tbody>
            {CONDITION_MAP_LEGEND.map((row) => {
              const c = SIX_CONDITIONS[row.n - 1]
              return (
                <tr key={row.n}>
                  <td className="nowrap">
                    <button type="button" className="dash-chip" onClick={() => scrollToId(`dash-cond-${c.id}`)} title={c.en}>
                      {row.n}. {c.zh}
                    </button>
                  </td>
                  <td>{row.block}</td>
                  <td>
                    <Rich text={row.knobs} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Prereq title="期望值與變異數：「很多次的平均」">
        <p>
          把同一個隨機實驗重複非常多次，結果的平均就是期望值。若 <Tex>{'X'}</Tex> 取值 <Tex>{'x_i'}</Tex> 的機率是 <Tex>{'P_i'}</Tex>：
        </p>
        <TexBlock>{String.raw`E[X]=\sum_i x_i P_i,\qquad \mathrm{Var}(X)=E\big[(X-E[X])^2\big]=E[X^2]-E[X]^2`}</TexBlock>
        <p>
          例：公平的 <Tex>{'\\pm1'}</Tex>（各 1/2）有 <Tex>{'E=0'}</Tex>、<Tex>{'\\mathrm{Var}=1'}</Tex>。互相獨立時變異數可以相加，所以 <Tex>{'N'}</Tex> 個平均的變異數是
          <Tex>{'\\mathrm{Var}\\big(\\tfrac1N\\sum X_i\\big)=\\tfrac{1}{N}\\mathrm{Var}(X)'}</Tex>——這就是 GMAC 累加 <Tex>{'N'}</Tex> 筆後雜訊以 <Tex>{'1/\\sqrt N'}</Tex>{' '}
          下降的原因。期望值是線性的：<Tex>{'E[aX+bY]=aE[X]+bE[Y]'}</Tex>，不需要獨立。
        </p>
      </Prereq>
      <Prereq title="高斯分布與 erf：comparator 的統計增益從哪來">
        <p>
          零均值、標準差 <Tex>{'\\sigma'}</Tex> 的高斯雜訊 <Tex>{'v'}</Tex> 的機率密度是 <Tex>{'\\frac{1}{\\sqrt{2\\pi}\\sigma}e^{-v^2/(2\\sigma^2)}'}</Tex>。
          Comparator 輸入是 <Tex>{'s+v'}</Tex>，輸出 +1 的機率是{' '}
          <Glue>
            <Tex>{'P(v>-s)=\\Phi(s/\\sigma)'}</Tex>，
          </Glue>
          其中
        </p>
        <TexBlock>{String.raw`\Phi(z)=\int_{-\infty}^{z}\frac{e^{-t^2/2}}{\sqrt{2\pi}}\,dt=\tfrac12\Big[1+\mathrm{erf}\big(z/\sqrt2\big)\Big],\qquad \mathrm{erf}(z)=\frac{2}{\sqrt\pi}\int_0^z e^{-t^2}dt`}</TexBlock>
        <p>
          所以 <Tex>{'E[q]=(+1)\\Phi+(-1)(1-\\Phi)=2\\Phi-1=\\mathrm{erf}\\big(s/(\\sqrt2\\sigma)\\big)'}</Tex>。erf 在 0 的導數是{' '}
          <Tex>{'2/\\sqrt\\pi'}</Tex>（被積函數在 0 等於 1），泰勒一階得 <Tex>{'E[q]\\approx\\frac{2}{\\sqrt\\pi}\\cdot\\frac{s}{\\sqrt2\\sigma}=\\sqrt{2/\\pi}\\,s/\\sigma'}</Tex>。
          只在 <Tex>{'|s|\\ll\\sigma'}</Tex> 時成立；<Tex>{'s'}</Tex> 大了 erf 會飽和。
        </p>
      </Prereq>
      <Prereq title="相關（correlation）：兩個訊號「同進同退」的程度，以及單頻公式">
        <p>
          兩個零均值訊號的相關是乘積的長時間平均 <Tex>{'E[x\\,u]'}</Tex>：同號的時候多，平均為正；一半同號一半異號，平均為 0；總是異號，平均為負。 GMAC
          做的就是這件事（把 <Tex>{'q\\cdot x'}</Tex> 累加起來），所以條件 2 的 <Tex>{'C=E[x\\,u]'}</Tex> 就是「code 和它造成的誤差有多同步」。單頻 code
          可以直接算出來：
        </p>
        <StepDerivation
          steps={[
            {
              tex: String.raw`x[n-D]=A\cos(\Omega n-\Omega D),\qquad u[n]=|H|\,A\cos(\Omega n+\phi)`,
              why: R('線性、係數固定的 error path 對正弦波只改變振幅（乘 $|H|$）與相位（加 $\\phi$）；GMAC 用的是延遲 $D$ 個 sample 的 code。'),
            },
            {
              tex: String.raw`x[n-D]\,u[n]=\frac{A^2|H|}{2}\Big[\cos(\phi+\Omega D)+\cos(2\Omega n+\phi-\Omega D)\Big]`,
              why: R('積化和差：$\\cos\\alpha\\cos\\beta=\\tfrac12[\\cos(\\alpha-\\beta)+\\cos(\\alpha+\\beta)]$，取 $\\alpha=\\Omega n+\\phi$、$\\beta=\\Omega n-\\Omega D$。'),
            },
            {
              tex: String.raw`E\big[\cos(2\Omega n+\phi-\Omega D)\big]=0\qquad(0<\Omega<\pi)`,
              why: R('第二項是頻率 $2\\Omega$ 的弦波，正負各半，長時間平均為 0；$\\Omega=0$ 或 $\\pi$ 時它變成常數，公式要改（勘誤 E46）。'),
            },
          ]}
          result={String.raw`C_D=E\big[x[n-D]\,u[n]\big]=\frac{A^2}{2}\,|H|\cos(\phi+\Omega D)=P_x\,|H|\cos\theta`}
        />
        <p>
          代數字（<Tex>{'A=1'}</Tex>、<Tex>{'|H|=1'}</Tex>）：<Tex>{`\\phi=120^\\circ,\\ D=0\\Rightarrow C=${f(corr.t06.C)}`}</Tex>（負的：正的{' '}
          <Tex>{'\\mu'}</Tex> 會把係數推離 <Tex>{'a'}</Tex>，T06）；<Tex>{`\\phi=-120^\\circ,\\ \\Omega=\\pi/6,\\ D=4\\Rightarrow\\theta=${f(corr.t07.thetaDeg)}^\\circ,\\ C_D=${f(corr.t07.C)}`}</Tex>
          （四個 delay register 把極性修回來，T07）。<ClaimTag kind="exact" />
        </p>
      </Prereq>
      <Prereq title="等比數列、pole 與單位圓（Z transform 的直覺版）">
        <p>
          遞迴 <Tex>{'\\delta_{k+1}=p\\,\\delta_k'}</Tex> 的解是 <Tex>{'\\delta_k=p^k\\delta_0'}</Tex>：<Tex>{'|p|<1'}</Tex> 才會趨近 0；
          <Tex>{'p<0'}</Tex> 時正負交替（震盪）。更長的遞迴（例如 <Tex>{'\\delta_{k+1}=\\delta_k-g\\,\\delta_{k-d}'}</Tex>）就猜{' '}
          <Tex>{'\\delta_k=z^k'}</Tex> 代進去，得到一個多項式（特徵方程）；所有根都在複數平面的<strong>單位圓內</strong>（<Tex>{'|z|<1'}</Tex>）才收斂。
          這些根就叫 pole，Z transform 只是把這件事系統化。
        </p>
      </Prereq>
      <Prereq title="矩陣的特徵值（$2\times2$ 就夠）">
        <p>
          對稱矩陣 <Tex>{'\\mathbf R'}</Tex> 的特徵向量 <Tex>{'\\mathbf v'}</Tex> 滿足 <Tex>{'\\mathbf R\\mathbf v=\\lambda\\mathbf v'}</Tex>：沿這個方向，矩陣只做縮放。
          對 <Tex>{'\\mathbf R=\\begin{bmatrix}1&\\rho\\\\\\rho&1\\end{bmatrix}'}</Tex>，解 <Tex>{'\\det(\\mathbf R-\\lambda\\mathbf I)=(1-\\lambda)^2-\\rho^2=0'}</Tex>{' '}
          得 <Tex>{'\\lambda=1\\pm\\rho'}</Tex>，方向 <Tex>{'(1,\\pm1)/\\sqrt2'}</Tex>。<Tex>{'\\rho\\to1'}</Tex> 時 <Tex>{'\\lambda_{\\min}\\to0'}</Tex>：
          兩個參數只有「和」看得見，「差」幾乎看不見。
        </p>
      </Prereq>
      <Prereq title="頻寬：−3 dB 與 ENBW（PSD 的一句話版本）">
        <p>
          PSD（power spectral density）是「每 Hz 有多少雜訊功率」；整條曲線積分就是總功率。濾波器的 −3 dB 頻率是 <Tex>{'|H|^2'}</Tex> 掉到 DC 一半的位置；
          ENBW（equivalent noise bandwidth）則是「把 <Tex>{'|H(0)|^2'}</Tex> 當高度、通過同樣總雜訊功率的理想方波寬度」。兩者定義不同、數值也不同，不能混用（
          <ErratumLink eid="E06" />）。
        </p>
      </Prereq>

      <h3 className="dash-h3">再看一張圖：把那一圈畫成一條方程式</h3>
      <p>
        上面那張圖畫的是硬體方塊。現在把每個方塊換成它在「平均」意義下做的事——乘一個數，或加一個數——整個校正迴路就變成一張可以直接寫成方程式的訊號流圖。先認得四個符號：
        <Tex>{'\\delta_k=a-w_k'}</Tex> 是第 <Tex>{'k'}</Tex> 個 block 還剩多少參數誤差（真值 <Tex>{'a'}</Tex> 減目前的係數{' '}
        <Glue>
          <Tex>{'w_k'}</Tex>）；
        </Glue>
        <Tex>{'C'}</Tex> 是 code 與它造成的誤差之間的相關；<Tex>{'B'}</Tex> 是 code
        與「不是 gain 誤差造成的」干擾之間的相關；<Tex>{'\\eta_k'}</Tex> 是這個 block 的 GMAC 雜訊。
      </p>
      <DiagramWalk
        chart={BLOCK_EQUATION_CHART}
        caption="線性化的 block 方程式畫成訊號流：三個藍色方塊相乘就是 loop gain，棕色的干擾決定 bias，雜訊每個 block 都重新加進來一次。下面的推導 1 到 3 只是把這張圖一段一段寫成數學。"
        ariaLabel="線性化 block 方程式的訊號流圖：真值減去係數得到參數誤差，乘上相關 C、加上干擾 B、乘上 comparator 增益、加上 GMAC 雜訊得到 GMAC 輸出，乘上學習率後進累加器，累加器的輸出以負號回授"
      >
        <p>
          先看 <Tex>{'a'}</Tex> 進去的那個加法點：真值是「＋」，回授的係數 <Tex>{'w_k'}</Tex> 是「−」，所以它的輸出是 <Tex>{'\\delta_k=a-w_k'}</Tex>（全站極性）。順著箭頭走到底，就是推導 1 的第四行{' '}
          <Tex>{'G_k=K_q(C\\,\\delta_k+B)+\\eta_k'}</Tex>；再乘 <Tex>{'\\mu'}</Tex> 進累加器，就是更新律 <Tex>{'w_{k+1}=w_k+\\mu G_k'}</Tex>。
        </p>
        <p>
          圖上三個藍色方塊相乘是 loop gain <Tex>{'g=\\mu K_qC'}</Tex>：<Tex>{'C'}</Tex> 的正負決定這一圈是負回授還是正回授（條件 2），<Tex>{'g'}</Tex> 的大小決定會不會修過頭（條件 3）。棕色的 <Tex>{'B'}</Tex> 從旁邊加進來，迴路只會把{' '}
          <Tex>{'C\\,\\delta+B'}</Tex> 修到 0，所以停在 <Tex>{'\\delta^*=-B/C'}</Tex> 而不是 0（條件 5）。<Tex>{'\\eta_k'}</Tex> 每個 block 重新抽一次，迴路只能把它平均、不能消掉（條件 4）。
        </p>
      </DiagramWalk>

      <details className="dash-details" open={atLeast('engineer')} key={`spine-1-${mode}`}>
        <summary>推導 1：線性化 block 方程式 → pole（條件 2、3）</summary>
        <div className="dash-details-body">
          <StepDerivation
            steps={[
              {
                tex: String.raw`e[n]=\underbrace{(a-w_k)\,u[n]+\varepsilon_{\mathrm{det}}[n]}_{e_{\mathrm{det}}[n]}+v[n]`,
                why: R('Comparator 取的是 PD 的輸出 $e[n]$（送進 loop filter 的同一個訊號）：剩下的 gain 誤差經 PLL error path 之後的量，加上 deterministic 干擾，再加上隨機雜訊（§11）。前兩項不含隨機雜訊，合稱 $e_{\\mathrm{det}}$。把 $(a-w_k)$ 提到 error path 的卷積外面（寫成 $(a-w_k)\\,u[n]$，$u=h*x$），前提是 $w$ 在這條 path 的記憶長度內幾乎不變（時間尺度分離，Ch06 的 F-06.1）；$w$ 變得快時要回到 $h*\\big((a-w)\\,x\\big)$。'),
              },
              {
                tex: String.raw`E\big[q[n]\,\big|\,e_{\mathrm{det}}\big]=\mathrm{erf}\!\Big(\frac{e_{\mathrm{det}}}{\sqrt2\,\sigma_v}\Big)\approx K_q\,e_{\mathrm{det}},\quad K_q=\frac{\sqrt{2/\pi}}{\sigma_v}`,
                why: R('把 $v$ 平均掉（先備知識：高斯與 erf），再對 erf 做一階泰勒展開；需要 $|e_{\\mathrm{det}}|\\ll\\sigma_v$。'),
              },
              {
                tex: String.raw`E[G_k]=\frac1N\sum_{n}E\big[q[n]\,x[n]\big]\approx K_q\big(E[x\,u]\,\delta_k+E[x\,\varepsilon_{\mathrm{det}}]\big)=K_q\,(C\,\delta_k+B)`,
                why: R('期望值是線性的；$x$ 由 code 決定，可以提到條件期望外面；再用 $C$、$B$ 的定義。'),
              },
              { tex: String.raw`G_k=K_q\,(C\,\delta_k+B)+\eta_k,\qquad E[\eta_k]=0`, why: R('把 $G_k$ 寫成「平均 + 零均值擾動」，$\\eta_k$ 就是 GMAC 雜訊的定義。') },
              { tex: String.raw`\delta_{k+1}=a-w_{k+1}=a-(w_k+\mu G_k)=\delta_k-\mu G_k`, why: R('代入更新律 $w_{k+1}=w_k+\\mu G_k$，並用 $\\delta=a-w$ 的極性。') },
              { tex: String.raw`\delta_{k+1}=(1-\mu K_qC)\,\delta_k-\mu K_qB-\mu\eta_k`, why: R('把上一行的 $G_k$ 代入並整理。') },
            ]}
          />
          <TexBlock id="F-DB.1">{String.raw`\boxed{\delta_{k+1}=p\,\delta_k-\mu K_qB-\mu\eta_k,\qquad p=1-\mu K_qC=1-g}`}</TexBlock>
          <p>
            讀法：<strong>
              <Tex>{'C'}</Tex> 的正負
            </strong>
            決定 <Tex>{'p'}</Tex> 是在 1 的左邊還是右邊（條件 2：極性）；<strong>
              <Tex>{'g=\\mu K_qC'}</Tex> 的大小
            </strong>
            決定 <Tex>{'|p|<1'}</Tex> 是否成立（條件 3：穩定，<Tex>{'0<g<2'}</Tex>）。T13 的數字：
            <Tex>{`K_q=${f(t13.Kq)}\\,\\mathrm{fs^{-1}},\\ g=${f(t13.g)},\\ p=${f(1 - t13.g)}`}</Tex>，phase margin{' '}
            <Tex>{`90^\\circ-\\arcsin(g/2)=${f(pm, 4)}^\\circ`}</Tex>。 <ClaimTag kind="approx" />
          </p>
        </div>
      </details>
      <SpineHandCalc id="HC-DB.1" lead="把 $\sigma_v$、$\mu$、$P_x$、$|H|$、$\theta$ 代進去，自己算出 $K_q$、$C$、$g$、$p$（預設數字就是 T13）。試試 $\theta=120^\circ$ 會發生什麼事。" />

      <details className="dash-details" open={atLeast('engineer')} key={`spine-2-${mode}`}>
        <summary>推導 2：固定點 → bias（條件 5）</summary>
        <div className="dash-details-body">
          <StepDerivation
            steps={[
              { tex: String.raw`E[\delta_{k+1}]=p\,E[\delta_k]-\mu K_qB`, why: R('對推導 1 的結果取期望值，$E[\\eta_k]=0$。') },
              { tex: String.raw`\delta^*=p\,\delta^*-\mu K_qB`, why: R('若 $|p|<1$，平均會停在固定點：令 $E[\\delta_{k+1}]=E[\\delta_k]=\\delta^*$。') },
              { tex: String.raw`(1-p)\,\delta^*=-\mu K_qB\;\Rightarrow\;\mu K_qC\,\delta^*=-\mu K_qB`, why: R('移項，並用 $1-p=\\mu K_qC$。') },
              { tex: String.raw`\delta^*=-\frac{B}{C}`, why: R('兩邊除以 $\\mu K_qC$（需要 $C\\ne0$）。') },
            ]}
            result={String.raw`w^*=a-\delta^*=a+\frac{B}{C}`}
          />
          <p>
            兩個重點：(1) 停下來的地方是 <Tex>{'E[G]=0'}</Tex>，<strong>不是</strong> <Tex>{'w=a'}</Tex>；(2) <Tex>{'C'}</Tex> 在分母：極性裕度小（
            <Tex>{'C\\to0'}</Tex>）時，同樣的干擾 <Tex>{'B'}</Tex> 會被放大成很大的 bias。若 <Tex>{'C<0'}</Tex>，<Tex>{'w^*'}</Tex> 是排斥點，根本到不了。
            這是 MSE-LMS 的線性固定點 <ClaimTag kind="exact" />；1-bit Sign-LMS 只在殘差遠小於 <Tex>{'\\sigma_v'}</Tex> 時近似成立（
            <ErratumLink eid="E01" />）：<Tex>{'B/C'}</Tex> 是線性化的 bias，大到讓 comparator 飽和時它只是線性外推，<Tex>{'a+B/C'}</Tex> 不再是 Sign-LMS
            的固定點（Ch11 §11.4；體檢的條件 5 會亮「注意」）。若 comparator 就是主 PLL 的 BBPD（type-II 迴路強制 <Tex>{'E[q]=0'}</Tex>），offset 造成的 bias 會被吸收、分母改成{' '}
            <Tex>{'\\mathrm{Var}(x)'}</Tex>（<ErratumLink eid="E03" />）。
          </p>
        </div>
      </details>
      <SpineHandCalc id="HC-DB.2" lead="給定 $B$、$C$、$g$ 與初始誤差，手算固定點 $\Delta w=B/C$ 和平均誤差的前兩步，看它朝哪裡收斂。" />

      <details className="dash-details" open={atLeast('engineer')} key={`spine-3-${mode}`}>
        <summary>{R('推導 3：等比級數 → 係數雜訊 $\\sigma_w$（條件 4）')}</summary>
        <div className="dash-details-body">
          <StepDerivation
            steps={[
              { tex: String.raw`\delta w_k=w_k-w^*=-(\delta_k-\delta^*)`, why: R('定義相對固定點的係數雜訊（極性與 $\\delta$ 相反，勘誤 E33）。') },
              { tex: String.raw`\delta w_{k+1}=p\,\delta w_k+\mu\,\eta_k`, why: R('把推導 1 的遞迴減去固定點方程式 $\\delta^*=p\\delta^*-\\mu K_qB$，常數項抵消。') },
              {
                tex: String.raw`E[\delta w_{k+1}^2]=p^2E[\delta w_k^2]+2p\mu\,E[\delta w_k\eta_k]+\mu^2E[\eta_k^2]=p^2E[\delta w_k^2]+\mu^2\sigma_\eta^2`,
                why: R('平方後取期望值；$\\eta_k$ 只含第 $k$ 個 block 的新雜訊，與 $\\delta w_k$ 獨立且零均值，交叉項為 0。'),
              },
              { tex: String.raw`\sigma_w^2=p^2\sigma_w^2+\mu^2\sigma_\eta^2`, why: R('穩態時前後兩個 block 的變異數相同（需 $|p|<1$）。') },
              { tex: String.raw`\sigma_\eta^2=\mathrm{Var}\Big(\frac1N\sum q\,x\Big)\approx\frac{E[x^2]}{N}=\frac{P_x}{N}`, why: R('近平衡時 $q$ 近似 iid $\\pm1$（$q^2=1$），$N$ 筆平均的變異數除以 $N$（勘誤 E30：精確為 $(1-m^2)P_x/N$，$m=E[q]$）。') },
            ]}
            result={String.raw`\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}=\frac{\mu^2P_x}{N\,g\,(2-g)}`}
          />
          <p>
            T13：<Tex>{`\\sigma_w=\\sqrt{\\frac{${DEFAULT_PARAMS.mu}^2\\cdot ${DEFAULT_PARAMS.Px}/${DEFAULT_PARAMS.N}}{1-${f(1 - t13.g)}^2}}=${f(t13.sigmaW, 4)}\\,\\mathrm{fs}`}</Tex>
            。它是 <strong>gain-equivalent</strong> 的係數雜訊，不是 PLL 輸出 jitter：乘上 code（隨機部分是 <Tex>{'x\\,\\delta w'}</Tex>）並和 bias 那一項合起來，才是條件 6 檢查的
            DTC-referred <Tex>{'\\sigma_{\\delta t}'}</Tex>（推導 4）；再經過 output transfer <Tex>{'T(f)'}</Tex> 才是輸出 jitter，本頁不算這一步（Ch12 的 F-12.17）。
            <ClaimTag kind="approx" />
          </p>
          <p className="small muted">
            一個 trade-off 就藏在這裡：<Tex>{'g'}</Tex> 越小收斂越慢（時間常數 <Tex>{'\\approx1/g'}</Tex> blocks），但{' '}
            <Tex>{'\\sigma_w^2\\propto\\mu^2/g\\propto\\mu'}</Tex>——<Tex>{'\\mu'}</Tex> 減半，雜訊功率約減半、收斂時間約加倍。
          </p>
        </div>
      </details>
      <SpineHandCalc id="HC-DB.3" lead="用 $\mu$、$N$、$P_x$、$g$ 手算 $\sigma_w$；同一題順便算「更新晚一個 block（$d=1$）」時雜訊放大多少（封閉式的推導在 Research 模式的推導 6）。" />

      <details className="dash-details" open={atLeast('engineer')} key={`spine-sys-${mode}`}>
        <summary>推導 4：把 bias 與雜訊換算到 DTC 輸出 → timing error 與 spur（條件 6）</summary>
        <div className="dash-details-body">
          <StepDerivation
            steps={[
              {
                tex: String.raw`\delta t[n]=w_k\,x[n]-a\,x[n]=(w_k-a)\,x[n]=(\Delta w+\delta w_k)\,x[n]`,
                why: R('Reference 端的 DTC 實際給的補償量是 $w\\,x$（從基準延遲 $T_0$ 往回扣），需要的是 $a\\,x$（feedback edge 早到的量）；兩者的差就是 $\\delta t$（多補償為正）。PD 量到的殘餘 $(a-w_k)\\,x$ 正好是它的負號（勘誤 E33）；下面只用到大小與功率，正負號不影響結果。再把 $w-a$ 拆成固定的 bias $\\Delta w=w^*-a$（推導 2）與隨機的 $\\delta w_k$（推導 3）。'),
              },
              {
                tex: String.raw`E[\delta t^2]=\Delta w^2E[x^2]+2\,\Delta w\,E[x^2\,\delta w_k]+E[x^2\,\delta w_k^2]=P_x\,(\Delta w^2+\sigma_w^2)`,
                why: R('$\\delta w_k$ 零均值，而且（近似）與 code 獨立：中間的交叉項為 0，最後一項拆成 $E[x^2]\\,E[\\delta w_k^2]$。'),
              },
              {
                tex: String.raw`x[n]\,\Delta w=A\,\Delta w\cos\Omega n\quad\Rightarrow\quad A_t=A\,|\Delta w|=\sqrt{2P_x}\,|\Delta w|`,
                why: R('單頻 code 時，bias 那一項是一根頻率固定的 timing tone，peak 值 $A_t$（單位 fs）。'),
              },
              {
                tex: String.raw`\varphi(t)=2\pi f_{\mathrm{out}}\,|T|\,A_t\cos\omega_xt=\beta\cos\omega_xt`,
                why: R('時間誤差換成輸出相位要乘 $2\\pi f_{\\mathrm{out}}$（fs 換成 rad），再乘 PLL output transfer 在 tone 頻率的 $|T|$；$\\beta$ 是調變指數。'),
              },
              {
                tex: String.raw`\cos(\omega_0t+\beta\cos\omega_xt)\approx\cos\omega_0t-\beta\cos\omega_xt\,\sin\omega_0t`,
                why: R('$\\beta\\ll1$：對相位做一階泰勒展開 $\\cos(\\theta+\\varepsilon)\\approx\\cos\\theta-\\varepsilon\\sin\\theta$。'),
              },
              {
                tex: String.raw`=\cos\omega_0t-\frac{\beta}{2}\Big[\sin(\omega_0+\omega_x)t+\sin(\omega_0-\omega_x)t\Big]`,
                why: R('積化和差 $\\sin A\\cos B=\\tfrac12[\\sin(A+B)+\\sin(A-B)]$：載波兩側各一根 sideband，振幅是載波的 $\\beta/2$。'),
              },
            ]}
          />
          <TexBlock id="F-DB.5">{String.raw`\boxed{\sigma_{\delta t}=\sqrt{P_x\,(\Delta w^2+\sigma_w^2)},\qquad \mathrm{Spur}\approx20\log_{10}\frac{\beta}{2}=20\log_{10}\!\big(\pi f_{\mathrm{out}}\,|T|\,A_t\big)}`}</TexBlock>
          <p>
            代數字。預設參數（<Tex>{`\\sigma_w=${f(sys.base.sigmaW, 4)}\\,\\mathrm{fs},\\ \\Delta w=${f(sys.base.deltaW, 4)}\\,\\mathrm{fs},\\ P_x=${sys.base.params.Px}`}</Tex>）：
            <Tex>{`\\sigma_{\\delta t}=${f(sys.base.sigmaDt, 4)}\\,\\mathrm{fs}`}</Tex>。T15 的例子（<Tex>{`A_t=${f(sys.t15.AtPeak, 4)}\\,\\mathrm{fs}`}</Tex> peak、
            <Tex>{`f_{\\mathrm{out}}=${sys.t15.params.foutGHz}\\,\\mathrm{GHz}`}</Tex>、<Tex>{'|T|=1'}</Tex>）：
            <Tex>{`\\beta=${texSci(sys.t15.betaRad)}\\,\\mathrm{rad}`}</Tex>，<Tex>{`\\mathrm{Spur}=${f(sys.t15.spurDbc, 4)}\\,\\mathrm{dBc}`}</Tex>——只有 0.5 fs 的 bias tone
            就有這麼大。<ClaimTag kind="approx" />
          </p>
          <p className="small muted">
            四個提醒：(1) <Tex>{'\\sigma_{\\delta t}'}</Tex> 是 <strong>DTC-referred</strong> 的量，還沒經過 PLL 的頻率響應，不能直接叫 output jitter（規格 §12.1 的提醒）；(2)
            隨機部分的頻譜形狀——低頻的 <Tex>{'\\delta w'}</Tex> 乘上寬頻 code 之後變成寬頻——在 Ch12，而且 block rate 的 <Tex>{'\\delta w_k'}</Tex> 要先以 ZOH 展開到
            sample rate 才能套卷積公式（<ErratumLink eid="E09" />）；(3) variance 與 bias
            各自在預算內，平方和仍可能超出預算，所以條件 6 必須另外檢查；(4) 條件 6 問的是「在不在預算內」，不是「比校正前好」：它不看初始誤差{' '}
            <Tex>{'w_0-a'}</Tex>。例如 gain 本來就正確（<Tex>{'w_0=a'}</Tex>、<Tex>{'B=0'}</Tex>）時，不校正的 gain-error timing 是 0；開著固定步長的追蹤反而多出{' '}
            <Tex>{`\\sqrt{P_x}\\,\\sigma_w=${f(t13.sigmaDt, 4)}\\,\\mathrm{fs}`}</Tex> 的隨機誤差，卻仍在 <Tex>{`${DEFAULT_PARAMS.jitterBudget}\\,\\mathrm{fs}`}</Tex>{' '}
            的預算內、判定通過（freeze 與持續追蹤的取捨在 Ch13、Ch14）。
          </p>
        </div>
      </details>
      <SpineHandCalc
        id="HC-DB.5"
        lead={String.raw`把 $\sigma_w$ 與 $\Delta w$ 換算成 DTC-referred 的 $\sigma_{\delta t}$、tone 幅度 $A_t$、調變指數 $\beta$ 與 spur（預設數字就是 T15 的 $${f(sys.t15.spurDbc, 4)}\,\mathrm{dBc}$）。`}
      />

      <ModeGate min="research">
        <details className="dash-details" open key="spine-4">
          <summary>{R('推導 5（Research）：commit 延遲 $d$ 個 block → 臨界增益 $g^*$')}</summary>
          <div className="dash-details-body">
            <StepDerivation
              steps={[
                { tex: String.raw`w_{k+1}=w_k+\mu\,G_{k-d}\;\Rightarrow\;\delta_{k+1}=\delta_k-g\,\delta_{k-d}`, why: R('RTL 的 commit pipeline 讓第 $k$ 次更新用到 $d$ 個 block 前的 GMAC（略去雜訊與 $B$）。') },
                { tex: String.raw`z^{d+1}-z^{d}+g=0`, why: R('代入 $\\delta_k=z^k$ 並同除 $z^{k-d}$（先備知識：pole）。') },
                { tex: String.raw`L(z)=\frac{g\,z^{-d}}{z-1},\qquad |L(e^{j\omega})|=\frac{g}{2\sin(\omega/2)}`, why: R('同一個迴路寫成 open-loop：$1+L=0$ 正是上面的特徵方程；$|e^{j\\omega}-1|=2\\sin(\\omega/2)$。') },
                { tex: String.raw`\omega_c=2\arcsin(g/2),\qquad \angle L(e^{j\omega})=-\frac{\pi}{2}-\Big(d+\frac12\Big)\omega`, why: R('令 $|L|=1$ 解出 crossover；$e^{j\\omega}-1=2j\\sin(\\omega/2)\\,e^{j\\omega/2}$ 的相位是 $\\pi/2+\\omega/2$。') },
                { tex: String.raw`\mathrm{PM}=180^\circ+\angle L(e^{j\omega_c})=90^\circ-(2d+1)\arcsin(g/2)`, why: R('代入 $\\omega_c$，換成角度。') },
              ]}
              result={String.raw`\mathrm{PM}=0\iff g^*=2\sin\frac{\pi}{4d+2}`}
            />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <Tex>{'d'}</Tex>（blocks）
                    </th>
                    {gStar.map((r) => (
                      <th key={r.d} className="num">
                        {r.d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <Tex>{'g^*=2\\sin\\frac{\\pi}{4d+2}'}</Tex>
                    </td>
                    {gStar.map((r) => (
                      <td key={r.d} className="num">
                        {f(r.g, 6)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="small muted">
              只晚一個 block，可用的 loop gain 就從 <Tex>{f(gStar[0].g)}</Tex> 掉到 <Tex>{f(gStar[1].g)}</Tex>。Ch08 §8.4 的雙迴路<strong>二狀態模型</strong>
              （主 PLL 的觀測是一階狀態，誤差晚一個 block 才被 GMAC 看到）是同一個機制：在那個模型裡，完整的 <Tex>{'\\mu'}</Tex> 上界恰好是 quasi-static（把主 PLL
              當成瞬間到穩態）上界的一半——換算成等效 loop gain（<Tex>{'\\mu'}</Tex> 乘上觀測路徑的 DC 增益），正是上表的 <Tex>{f(gStar[0].g)}</Tex> 掉到{' '}
              <Tex>{f(gStar[1].g)}</Tex>；主 PLL 沒有記憶時，它就是這裡的 <Tex>{'d=1'}</Tex>（本頁 Q10、<ErratumLink eid="E19" />）。這個「一半」是該指定模型的結果，不是所有 PLL
              雙迴路的通則：觀測路徑不同，比例就不一定是一半（Ch08 的二階觀測例子差距更大；拿掉那一個 block 的 latency，quasi-static 反而可能偏保守）。
              <ClaimTag kind="exact" />（Ch08 §8.4 的二狀態模型）
            </p>
          </div>
        </details>
        <details className="dash-details" open key="spine-5">
          <summary>{R('推導 6（Research）：有 commit 延遲時的 $\\sigma_w$——等比級數不夠用了')}</summary>
          <div className="dash-details-body">
            <Prereq title="脈衝響應與卷積（一句話版本）">
              <p>
                對一個線性、係數固定的遞迴，只在某一拍輸入 1、其他時候輸入 0，得到的輸出序列 <Tex>{'y_0,y_1,y_2,\\dots'}</Tex> 叫<strong>脈衝響應</strong>
                （impulse response）。任何輸入都可以看成一連串「不同時間、不同大小的脈衝」，而線性代表各個脈衝的反應可以直接相加，所以
              </p>
              <TexBlock>{String.raw`\text{out}_k=\sum_{m\ge0}y_m\,\text{in}_{k-m}`}</TexBlock>
              <p>
                這個「把過去每一筆輸入乘上它已經衰減到的權重，再全部加起來」的運算就叫<strong>卷積</strong>（convolution）。例：{' '}
                <Tex>{'y_m=p^m'}</Tex> 時，<Tex>{'\\text{out}_k=\\text{in}_k+p\\,\\text{in}_{k-1}+p^2\\,\\text{in}_{k-2}+\\cdots'}</Tex>，越舊的輸入影響越小。
              </p>
            </Prereq>
            <p>
              推導 3 用到「<Tex>{'\\delta w_k'}</Tex> 只和上一個 block 有關」。更新晚 <Tex>{'d'}</Tex> 個 block 之後這件事不成立，要換一個算法。以{' '}
              <Tex>{'d=1'}</Tex> 為例，把它完整做一次：
            </p>
            <StepDerivation
              steps={[
                {
                  tex: String.raw`\delta w_{k+1}=\delta w_k-g\,\delta w_{k-1}+\mu\,\eta_{k-1}`,
                  why: R('推導 5 的遞迴（$d=1$）加上 GMAC 雜訊：第 $k$ 次更新用的是上一個 block 的 $G_{k-1}$，所以注入的是 $\\eta_{k-1}$。'),
                },
                {
                  tex: String.raw`\delta w_k=\mu\sum_{m\ge0}y_m\,\eta_{k-2-m},\qquad y_0=1,\ \ y_m=y_{m-1}-g\,y_{m-2}\ \ (y_{-1}=0)`,
                  why: R('線性系統：輸出是「脈衝響應 $y_m$」與輸入的卷積（每一筆過去的雜訊各自沿著 $y_m$ 衰減，再全部加起來）。'),
                },
                {
                  tex: String.raw`\sigma_w^2=\mu^2\sigma_\eta^2\sum_{m\ge0}y_m^2=\mu^2\sigma_\eta^2\,r_0,\qquad r_j\equiv\sum_{m}y_m\,y_{m-j}`,
                  why: R('不同 block 的 $\\eta$ 互相獨立，變異數直接相加；所以只需要 $r_0=\\sum y_m^2$。'),
                },
                {
                  tex: String.raw`\sum_{m\ge1}y_m\cdot y_m=\sum_{m\ge1}y_m\,(y_{m-1}-g\,y_{m-2})\ \Rightarrow\ r_0-1=r_1-g\,r_2`,
                  why: R('把遞迴兩邊乘上 $y_m$，對 $m\\ge1$ 加總；左邊少了 $y_0^2=1$。'),
                },
                {
                  tex: String.raw`\sum_{m\ge1}y_m\,y_{m-1}=\sum_{m\ge1}(y_{m-1}-g\,y_{m-2})\,y_{m-1}\ \Rightarrow\ r_1=r_0-g\,r_1\ \Rightarrow\ r_1=\frac{r_0}{1+g}`,
                  why: R('改乘 $y_{m-1}$ 再加總：$\\sum y_{m-1}^2=r_0$、$\\sum y_{m-1}y_{m-2}=r_1$。'),
                },
                {
                  tex: String.raw`\sum_{m\ge2}y_m\,y_{m-2}=\sum_{m\ge2}(y_{m-1}-g\,y_{m-2})\,y_{m-2}\ \Rightarrow\ r_2=r_1-g\,r_0`,
                  why: R('再乘 $y_{m-2}$：三個未知數 $r_0,r_1,r_2$ 現在有三條線性方程式。'),
                },
                {
                  tex: String.raw`r_0-1=(1-g)\,r_1+g^2r_0=\frac{1-g}{1+g}\,r_0+g^2r_0\ \Rightarrow\ r_0\,(1-g)\Big[(1+g)-\frac{1}{1+g}\Big]=1`,
                  why: R('把 $r_2$、$r_1$ 代回第一條，並把 $1-g^2$ 拆成 $(1-g)(1+g)$ 後提出 $(1-g)$。'),
                },
                {
                  tex: String.raw`(1+g)-\frac{1}{1+g}=\frac{(1+g)^2-1}{1+g}=\frac{g\,(2+g)}{1+g}`,
                  why: R('通分，並展開 $(1+g)^2-1=2g+g^2$；代回上一行解出 $r_0$。'),
                },
              ]}
            />
            <TexBlock id="F-DB.2">{String.raw`\boxed{\sigma_w^2=\mu^2\sigma_\eta^2\sum_m y_m^2,\qquad \sum_m y_m^2=\frac{1}{g\,(2-g)}\ \ (d=0),\qquad \frac{1+g}{g\,(1-g)\,(2+g)}\ \ (d=1)}`}</TexBlock>
            <p>
              兩件事值得注意：(1) 分母的 <Tex>{'(1-g)'}</Tex> 在 <Tex>{'g\\to g^*(1)=1'}</Tex> 時趨近 0——接近臨界增益時雜訊先爆掉，穩定邊界不是「還能用」的邊界；(2){' '}
              <Tex>{'g\\ll1'}</Tex> 時兩式都約為 <Tex>{'1/(2g)'}</Tex>，延遲只在 <Tex>{'g'}</Tex> 不小時才明顯。任意 <Tex>{'d'}</Tex>{' '}
              的做法一樣（未知數變成 <Tex>{'(d+1)^2'}</Tex> 個）：把狀態寫成 <Tex>{'\\mathbf s_m=(y_m,\\dots,y_{m-d})^T=\\mathbf A\\,\\mathbf s_{m-1}'}</Tex>、
              <Tex>{'\\mathbf s_0=\\mathbf e_1'}</Tex>，令 <Tex>{'\\mathbf P=\\sum_m\\mathbf s_m\\mathbf s_m^T'}</Tex>，就得到離散 Lyapunov 方程：
            </p>
            <TexBlock id="F-DB.3">{String.raw`\mathbf P=\mathbf A\,\mathbf P\,\mathbf A^{T}+\mathbf e_1\mathbf e_1^{T},\qquad \sum_m y_m^2=P_{11},\qquad \mathbf A=\begin{bmatrix}1&0&\cdots&-g\\1&0&\cdots&0\\&\ddots&&\vdots\\0&\cdots&1&0\end{bmatrix}_{(d+1)\times(d+1)}`}</TexBlock>
            <p>
              網站的體檢就是這樣算（下方「動手體檢」有程式碼，並和「照定義一項一項加」互相比對）。<ClaimTag kind="exact" />
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <Tex>{'g'}</Tex>
                    </th>
                    <th className="num">
                      <Glue>
                        <Tex>{'d=0'}</Tex>：
                      </Glue>
                      <Tex>{'\\sum y^2'}</Tex>
                    </th>
                    <th className="num">
                      <Glue>
                        <Tex>{'d=1'}</Tex>：
                      </Glue>
                      <Tex>{'\\sum y^2'}</Tex>（封閉式）
                    </th>
                    <th className="num">
                      <Glue>
                        <Tex>{'d=2'}</Tex>：
                      </Glue>
                      <Tex>{'\\sum y^2'}</Tex>
                    </th>
                    <th className="num">
                      <Tex>{'\\sigma_w(d{=}1)/\\sigma_w(d{=}0)'}</Tex>
                    </th>
                    <th className="num">
                      <Tex>{'\\sigma_w(d{=}2)/\\sigma_w(d{=}0)'}</Tex>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {delayNoise.map((row) => (
                    <tr key={row.g}>
                      <td className="num">{f(row.g, 4)}</td>
                      <td className="num">{f(row.rows[0].energy)}</td>
                      <td className="num">
                        {f(row.rows[1].energy)}（{f(row.closedD1)}）
                      </td>
                      <td className="num">{Number.isFinite(row.rows[2].energy) ? f(row.rows[2].energy) : '∞（不穩定）'}</td>
                      <td className="num">{f(row.rows[1].ratio, 4)}</td>
                      <td className="num">{Number.isFinite(row.rows[2].ratio) ? f(row.rows[2].ratio, 4) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted">
              表中數字由 Lyapunov 解即時計算；括號內是上面推導的 <Tex>{'d=1'}</Tex> 封閉式（兩者應完全相同）。第一列是 T13 的 <Tex>{'g'}</Tex>：延遲兩個 block
              只讓 <Tex>{'\\sigma_w'}</Tex> 增加{' '}
              <Glue>
                <Tex>{`${f((delayNoise[0].rows[2].ratio - 1) * 100, 2)}\\%`}</Tex>；
              </Glue>
              <Tex>{'g=0.6'}</Tex> 時 <Tex>{'d=2'}</Tex> 已經非常接近{' '}
              <Tex>{`g^*(2)=${f(gStar[2].g, 4)}`}</Tex>，<Tex>{'\\sigma_w'}</Tex> 變成 <Tex>{`${f(delayNoise[2].rows[2].ratio, 3)}`}</Tex> 倍——還沒發散，但已經不能用了。
            </p>
          </div>
        </details>
        <details className="dash-details" open key="spine-6">
          <summary>{R('推導 7（Research）：兩個參數、相關係數 $\\rho$ → 慢模式與雜訊放大（條件 1）')}</summary>
          <div className="dash-details-body">
            <StepDerivation
              steps={[
                { tex: String.raw`E[\mathbf G_k]\approx K_q\,C\,\tilde{\mathbf R}\,\boldsymbol\delta_k,\qquad \tilde{\mathbf R}=\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}`, why: R('假設交叉相關也以同一個 $C$ 縮放：$E[x_i[n-D]\\,u_j[n]]=C\\,\\tilde R_{ij}$。「經過同一條 path」還不夠：要 $\\theta=0^\\circ$，或每個延遲的交叉相關都是自相關的 $\\rho$ 倍（見本推導最後的提醒）。有效 regressor 的 $\\mathbf R=E[\\mathbf u\\mathbf u^T]=|H|^2P_x\\tilde{\\mathbf R}$，$C=P_x|H|\\cos\\theta$。') },
                { tex: String.raw`\tilde{\mathbf R}=\mathbf V\boldsymbol\Lambda\mathbf V^{T},\quad \tilde\lambda_{\pm}=1\pm\rho,\quad \boldsymbol\xi=\mathbf V^{T}\boldsymbol\delta`, why: '用特徵向量換座標（先備知識：特徵值）。' },
                { tex: String.raw`\mathbf M=\mu\mathbf I:\quad \xi_{i,k+1}=(1-g\,\tilde\lambda_i)\,\xi_{i,k}`, why: R('每個 mode 各自是一個純量迴路，loop gain 變成 $g\\tilde\\lambda_i$（先略去雜訊與 $B$）。') },
                {
                  tex: String.raw`k_{95}=\Big\lceil\frac{\ln0.05}{\ln|1-g\tilde\lambda_{\min}|}\Big\rceil`,
                  why: R(
                    `弱方向衰減到 5% 所需的 block 數（T11：$g=0.5$、$\\tilde\\lambda=${f(1 - rho)}\\Rightarrow k_{95}=${t11}$）。$g\\le1$（也就是 $g\\le2/(\\tilde\\lambda_++\\tilde\\lambda_-)$）時它也是最慢的方向；$g$ 更大時強方向過衝（$1-g\\tilde\\lambda_{\\max}$ 靠近 $-1$），最慢的反而是強方向。`,
                  ),
                },
                {
                  tex: String.raw`\mathbf M=\mu\tilde{\mathbf R}^{-1}:\quad \xi_{i,k+1}=(1-g)\,\xi_{i,k}-\frac{\mu}{\tilde\lambda_i}\,\zeta_{i,k},\qquad \zeta_{i,k}=\mathbf v_i^{T}\boldsymbol\eta_k,\ \ \mathrm{Var}(\zeta_{i,k})=\tilde\lambda_i\,\frac{P_x}{N}`,
                  why: R('Preconditioner 把所有 mode 拉成同一個 $g$；$\\zeta_{i,k}$ 是 GMAC 雜訊向量在第 $i$ 個特徵向量 $\\mathbf v_i$ 上的投影（共變異 $\\propto\\tilde{\\mathbf R}$，所以變異數 $\\propto\\tilde\\lambda_i$），它也被乘上 $1/\\tilde\\lambda_i$。'),
                },
                {
                  tex: String.raw`\mathrm{Var}(\xi_i)=\frac{\mu^2}{\tilde\lambda_i^{2}}\cdot\tilde\lambda_i\frac{P_x}{N}\cdot\frac{1}{g\,(2-g)}=\frac{\mu^2P_x}{N\,g\,(2-g)}\cdot\frac{1}{\tilde\lambda_i}`,
                  why: R('每個 mode 都是推導 3 的純量迴路（pole $1-g$），直接套 $\\sigma^2=(\\text{步長})^2\\times(\\text{雜訊變異數})/(1-p^2)$：variance 與 $\\tilde\\lambda_i$ 成反比。'),
                },
              ]}
            />
            <TexBlock id="F-DB.4">{String.raw`\boxed{\mathbf M=\mu\tilde{\mathbf R}^{-1}:\qquad \frac{\sigma_{\xi,\mathrm{weak}}}{\sigma_{\xi,\mathrm{strong}}}=\sqrt{\frac{\tilde\lambda_{\max}}{\tilde\lambda_{\min}}}=\sqrt{\kappa}}`}</TexBlock>
            <p className="small muted">
              <Tex>{`\\rho=${rho}`}</Tex>：<Tex>{`\\kappa=${f(kappa)}`}</Tex>，<Tex>{`\\sqrt\\kappa=${f(Math.sqrt(kappa), 4)}`}</Tex>。<Tex>{'g<1'}</Tex> 時 preconditioner
              每個係數的 <Tex>{'\\sigma_w'}</Tex> 也比一般 LMS 大，快與安靜不能兼得——這就是第 13 個問題；<Tex>{'g>1'}</Tex> 時它反而比較小（這裡沒有 commit 延遲；對照的數字在下面的
              HC-DB.4）。規格 §10.1 的數字以 <Tex>{'K_q=1'}</Tex> 正規化（<ErratumLink eid="E05" />）。<ClaimTag kind="approx" />
            </p>
            <Callout kind="warn" title="這個 $2\times2$ 模型多了一個假設：交叉相關也以同一個 $C$ 縮放">
              <StepDerivation
                steps={[
                  {
                    tex: String.raw`E\big[x_i[n-D]\,u_j[n]\big]=\sum_k h[k]\,r_{ij}[D-k],\qquad r_{ij}[m]=E\big[x_i[n]\,x_j[n+m]\big]`,
                    why: R('把 $u_j=h*x_j$ 代回去：用到的是每一個延遲的交叉相關 $r_{ij}[m]$，不只是 $m=0$ 的 $\\rho$。'),
                  },
                  {
                    tex: String.raw`r_{ij}[m]=\tilde R_{ij}\,r_{11}[m]\ \Rightarrow\ E\big[x_i[n-D]\,u_j[n]\big]=\tilde R_{ij}\sum_k h[k]\,r_{11}[D-k]=C\,\tilde R_{ij}`,
                    why: R('每個延遲都成同一個比例時，就得到本模型的 $C\\,\\tilde{\\mathbf R}$（充分條件；例如兩個互相獨立、頻譜相同的窄頻隨機 code 的線性混合）。'),
                  },
                  {
                    tex: String.raw`\begin{aligned}x_i[n]=A\cos(\Omega n+\psi_i):\quad E\big[x_i[n-D]\,u_j[n]\big]&=P_x|H|\cos(\theta+\psi_j-\psi_i)\\&=C\,\tilde R_{ij}-P_x|H|\sin\theta\,\sin(\psi_j-\psi_i)\end{aligned}`,
                    why: R('兩個固定的同頻單頻 code（$\\rho=\\cos(\\psi_2-\\psi_1)$）：和先備知識「相關」同一個積化和差。$\\theta\\ne0^\\circ$ 時多出反對稱的一項，矩陣不再對稱，也不再是 $C\\,\\tilde{\\mathbf R}$。'),
                  },
                ]}
              />
              <TexBlock id="F-DB.6">{String.raw`\boxed{\begin{aligned}E\big[x_i[n-D]\,u_j[n]\big]&=P_x|H|\cos(\theta+\psi_j-\psi_i)\\[2pt]\lambda_\pm&=P_x|H|\big(\cos\theta\pm\sqrt{\rho^2-\sin^2\theta}\big)\end{aligned}}`}</TexBlock>
              <p>
                這個矩陣的兩個特徵值之和是 <Tex>{'\\lambda_++\\lambda_-=2P_x|H|\\cos\\theta'}</Tex>、乘積是 <Tex>{'\\lambda_+\\lambda_-=P_x^2|H|^2(1-\\rho^2)'}</Tex>；
                <Tex>{'\\theta=0^\\circ'}</Tex> 時回到 <Tex>{'C(1\\pm\\rho)'}</Tex>。例：<Tex>{'\\rho=0'}</Tex>、<Tex>{'\\theta=60^\\circ'}</Tex>、
                <Tex>{`\\mu K_qP_x|H|=${f(ft.gp)}`}</Tex>。本模型的 pole 是 <Tex>{`1-${f(ft.gp)}\\cos60^\\circ=${f(ft.model, 4)}`}</Tex>；兩個固定的正交 code 的 pole 是{' '}
                <Tex>{`1-${f(ft.gp)}\\,e^{\\pm j60^\\circ}=${f(ft.re, 4)}\\mp j${f(ft.im, 4)}`}</Tex>，<Tex>{`|z|=\\sqrt{${f(ft.abs2, 4)}}\\approx${f(ft.fixed, 4)}`}</Tex>，會發散。同樣的{' '}
                <Tex>{'\\rho'}</Tex>、同樣的 <Tex>{'C'}</Tex>，結論相反；這類情況要用完整的 Jacobian（Ch10）。下方的體檢遇到雙參數且{' '}
                <Tex>{'\\theta\\ne0^\\circ'}</Tex> 時會列出這個對照值。<ClaimTag kind="exact" />
              </p>
            </Callout>
          </div>
        </details>
      </ModeGate>
      {/* 放在 Research 區塊之外：三種模式都看得到這一題（推導在 Research 模式的推導 7；特徵值的先備知識在上面） */}
      <SpineHandCalc
        id="HC-DB.4"
        lead="兩個相關的參數（$\tilde\lambda_\pm=1\pm\rho$，見先備知識「矩陣的特徵值」）用 preconditioner 校正時，手算兩個 mode 的係數雜訊 $\sigma_{\xi,\pm}$、它們的比值 $\sqrt\kappa$，以及每個係數的 $\sigma_w$。預設數字就是體檢的 preset「$\rho=0.99$ ＋ preconditioner」；完整推導在 Research 模式的推導 7。這一題取 $\theta=0^\circ$，兩個 regressor 的交叉相關就是 $C\,\tilde{\mathbf R}$；$\theta\ne0^\circ$ 時這個 $2\times2$ 模型多一個假設（體檢會提醒）。"
      />
    </section>
  )
})
