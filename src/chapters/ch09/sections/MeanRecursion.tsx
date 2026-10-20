import { useMemo } from 'react'
import { Callout, ClaimTag, Derivation, Prereq, Section, SourceTag, StepDerivation, TestBadge, TexBlock, ChRef, ChapterErratum } from '@/components'
import { matScale, matVec, type Matrix } from '@/simulation/core'
import {
  KQ_SIGMA100,
  bussgangMeanG,
  comparatorKq,
  corr2,
  eig2x2,
  eigenModes,
  meanSquareMap,
  meanTrajectory,
  modalCoords,
  optimalScalarGain,
  stepsToDecay,
  stepsToDecayReal,
} from '@/simulation/models/pe'
import { DerivBox, Diagram, FigRef, HandCalcBox, formulaTex, m, num, texMatrix, texNum, texVec } from '../shared'

/**
 * 1-bit 迴路自己的穩態抖動（小訊號估計）：把 F-09.18 的均方遞迴（meanSquareMap，detector = 'sign'，
 * 每個 block 注入 μ²R/N）迭代到固定點 P∞，回傳 E[s_δ²] = tr(R·P∞)/σ_v²，s_δ = √(δᵀRδ)/σ_v。
 * σ_v 取 1（結果與 σ_v 無關：g = μK_q 固定時 μ ∝ σ_v）。齊次半徑 < 1 才會收斂（ρ = 0.99、g = 0.5 時是 0.99）。
 */
function signJitterS2(rho: number, g: number, N: number): number {
  const R = corr2(rho)
  const mu = g / comparatorKq(1)
  const Q = matScale(R, (mu * mu) / N)
  let P: Matrix = [
    [0, 0],
    [0, 0],
  ]
  for (let i = 0; i < 6000; i++) P = meanSquareMap('gaussian', rho, g, N, P, Q, 'sign')
  return R[0][0] * P[0][0] + 2 * R[0][1] * P[0][1] + R[1][1] * P[1][1]
}

/** §9：e = uᵀδ + v → 平均遞迴 → 對角化 → p_i = 1 − μK_qλ_i → 598 → ρ = 1。 */
export function MeanRecursion() {
  const ex = useMemo(() => {
    const R = corr2(0.99)
    const modes = eigenModes(R, 0.5)
    const closed = eig2x2(1, 0.99, 1)
    const traj = meanTrajectory(R, 0.5, [1, 0], 4)
    const steps = [0, 1, 2, 3, 4].map((k) => {
      const d: [number, number] = [traj[0][k], traj[1][k]]
      return { k, d, c: modalCoords(closed.vectors, d) }
    })
    const lnF = Math.log(0.05)
    const lnP = Math.log(0.995)
    const phys = eigenModes(R, 0.5 * KQ_SIGMA100)
    const opt = optimalScalarGain(1.99, 0.01)
    const rho1 = eigenModes(corr2(1), 0.5)
    const traj1 = meanTrajectory(corr2(1), 0.5, [1, 0], 30)
    // 入門課第 11 課的例子：ρ = 0.8，只有第 2 個參數有誤差 δ = (0, 1)
    const R08 = corr2(0.8)
    const d08 = [0, 1]
    const G08 = matVec(R08, d08) // E[G | δ]/K_q = Rδ
    // 一步矩陣 A = I − gR（g = 0.5、ρ = 0.99）
    const A = R.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - 0.5 * v))
    const step08 = meanTrajectory(R08, 0.5, d08, 1)
    const modes08 = eigenModes(R08, 0.5)
    // 負相關的例子（F-09.5 的適用範圍）：ρ = −0.5 與 ρ = +0.5 的 λ_max、λ_min、κ 完全相同
    const neg = eigenModes(corr2(-0.5), 0.5)
    // 1-bit 的小訊號近似有多準（F-09.3 旁的說明）：單一參數、u ~ N(0,1)、σ_v = 1
    const kq1 = comparatorKq(1)
    const sign = {
      // Bussgang 精確條件平均 ÷ 線性化 K_q·Rδ = 1/√(1 + s_δ²)，s_δ = 0.1、0.3、1
      gain: [0.1, 0.3, 1].map((s) => bussgangMeanG('gaussian', 0, 1, s, 0)[0] / (kq1 * s)),
      // δ₀ = σ_v = 1、μ = 0.1 走一步：精確（Bussgang）、F-09.3 的線性式、linear detector
      stepExact: 1 - 0.1 * bussgangMeanG('gaussian', 0, 1, 1, 0)[0],
      stepLin: meanTrajectory(corr2(0), 0.1 * kq1, [1, 0], 1)[0][1],
      stepLinDet: meanTrajectory(corr2(0), 0.1, [1, 0], 1)[0][1],
      // 迴路自己的穩態抖動（F-09.18 的小訊號估計）：ρ = 0.99、g = 0.5，N = 1 與 N = 32
      jitterN1: signJitterS2(0.99, 0.5, 1),
      jitterN32: signJitterS2(0.99, 0.5, 32),
    }
    return { modes, steps, lnF, lnP, phys, opt, rho1, traj1, G08, step08, modes08, A, neg, sign }
  }, [])
  const { modes, steps, lnF, lnP, phys, opt, rho1, traj1, G08, step08, modes08, A, neg, sign } = ex

  return (
    <Section kind="formula" title={<>從誤差到平均遞迴：為什麼慢模式由 {m`\lambda_{\min}`} 決定</>} level={2} id="ch09-mean">
      <p>
        現在把開場的黑盒子寫成一般式。下面每一步一行，右邊寫「為什麼可以這樣做」。
      </p>

      <h3>1. 誤差：每個參數誤差乘上自己的 regressor 再相加</h3>
      <p>
        要校正的參數有 {m`M`} 個時，comparator 前面仍然只有<strong>一個</strong>誤差 {m`e[n]`}（在 PLL 裡它就是 PD 的輸出，也是送進 loop filter 的同一個訊號）。先約定兩個時間索引：{m`n`} 是 comparator 的 sample 編號（regressor {m`\mathbf u[n]`}、雜訊 {m`v[n]`}、誤差 {m`e[n]`} 每個 sample 都在變）；{m`k`} 是 GMAC block 的編號（一個 block 有 {m`N`} 個 sample，校正係數 {m`\mathbf w_k`} 每個 block 才更新一次，所以參數誤差 {m`\boldsymbol\delta_k=\mathbf a-\mathbf w_k`} 在一個 block 內是固定的）。
        {m`v[n]`} 是 comparator 前的雜訊，假設零均值。
      </p>
      <Diagram id="error-model">
        看藍色方塊：{m`M`} 條路全部加成同一個 {m`e[n]`}——comparator 分不出哪一部分是哪一個參數造成的。
      </Diagram>
      <p>
        <FigRef id="error-model" /> 怎麼看：先看每一條路——第 {m`i`} 個 regressor {m`u_i[n]`} 乘上「自己的」參數誤差 {m`\delta_i=a_i-w_i`}。再看加法點——
        {m`M`} 條路加上雜訊 {m`v[n]`}，全部混成一個數。圖上的「{m`\times\delta_i`}」就是下面 F-09.1 裡內積
        {m`\mathbf u^T\boldsymbol\delta_k=\sum_iu_i\delta_i`} 的第 {m`i`} 項，圖上的加法點就是那個 {m`\sum`}。下面一步一步把它從「真實輸出減預測輸出」推出來：
      </p>
      <StepDerivation
        steps={[
          { tex: String.raw`y[n]=\mathbf a^T\mathbf u[n]+v[n]`, why: <>真實系統：{m`M`} 個參數各自乘上 regressor，再加雜訊（線性模型）。</> },
          { tex: String.raw`\hat y[n]=\mathbf w_k^T\mathbf u[n]`, why: <>校正電路用目前的係數 {m`\mathbf w_k`} 做補償／預測。</> },
          { tex: String.raw`e[n]=y[n]-\hat y[n]=\mathbf a^T\mathbf u[n]-\mathbf w_k^T\mathbf u[n]+v[n]`, why: 'comparator 看到的是兩者之差。' },
          { tex: String.raw`=\mathbf u^T[n](\mathbf a-\mathbf w_k)+v[n]`, why: <>純量的轉置等於自己：{m`\mathbf a^T\mathbf u=\mathbf u^T\mathbf a`}，再提出 {m`\mathbf u^T`}。</> },
          { tex: String.raw`=\mathbf u^T[n]\boldsymbol\delta_k+v[n]`, why: <>定義 {m`\boldsymbol\delta_k=\mathbf a-\mathbf w_k`}（全站極性）。</> },
        ]}
      />
      <TexBlock id="F-09.1">{formulaTex('F-09.1')}</TexBlock>

      <h3>2. GMAC、更新與平均</h3>
      <p>
        GMAC 在一個 block（{m`N`} 個 sample）內累加 {m`t[n]\,\mathbf u[n]`}，其中 {m`t[n]`} 是偵測器的輸出：linear（conventional LMS）用 {m`t=e`}，1-bit comparator 用 {m`t=\mathrm{sign}(e)`}。累加完除以 {m`N`} 得到的<strong>平均</strong>記為 {m`\mathbf G_k`}（{m`M`} 個參數各一個分量）；block 結束時每個係數照自己的那個分量修正一次：{m`\mathbf w_{k+1}=\mathbf w_k+\mu\mathbf G_k`}。
      </p>
      <Diagram id="block-loop">
        看藍色的 GMAC 方塊：它之前的內積、偵測器、相關器每個 sample（{m`n`}）跑一次；它之後的 {m`\mathbf G_k`}、累加器與回授的 {m`\boldsymbol\delta_k`} 每個 block（{m`k`}）才更新一次。
      </Diagram>
      <p>
        <FigRef id="block-loop" /> 怎麼看：先看 sample rate 的那一段——{m`\boldsymbol\delta_k`} 與 {m`\mathbf u[n]`} 做內積、加上雜訊成為 PD 的輸出 {m`e[n]`}，經過偵測器變成 {m`t[n]`}，再乘回 {m`\mathbf u[n]`}。再看藍色的 GMAC——它把 {m`N`} 個乘積平均成一筆 {m`\mathbf G_k`}；{m`\mathbf G_k`} 乘上 {m`\mu`}
        加進累加器，{m`z^{-1}`} 表示新的係數要到下一個 block 才生效。最後看回授——{m`\mathbf w_k`} 以<strong>負號</strong>進入加法點（真值 {m`\mathbf a`}
        以正號），得到 {m`\boldsymbol\delta_k=\mathbf a-\mathbf w_k`}，繞回起點。圖上的「{m`(1/N)\Sigma`}」就是 F-09.2 的 {m`\mathbf G_k`}；「{m`\times\mu`} → 加法點 → {m`z^{-1}`}」就是更新式 {m`\mathbf w_{k+1}=\mathbf w_k+\mu\mathbf G_k`}；回授的那個負號，就是
        {m`\boldsymbol\delta_{k+1}=\boldsymbol\delta_k-\mu\mathbf G_k`} 裡的負號。（注意：真值 {m`\mathbf a`} 與它進入的那個加法點是<strong>數學模型</strong>，不是電路——硬體裡沒有「真值」這條線，{m`\boldsymbol\delta_k`} 只能透過 {m`e[n]`} 間接看到。）
      </p>
      <p>
        這個迴圈裡有隨機的 {m`\mathbf u`} 與 {m`v`}，所以先問「平均來說」會怎麼走。結論是：{m`\mathbf G_k`} 的平均正比於
        {m`\mathbf R\boldsymbol\delta_k`}，比例常數記為 {m`K_q`}。linear 時 {m`K_q=1`}，而且是<strong>精確</strong>的等式，誤差多大都成立。1-bit 時 {m`K_q=\sqrt{2/\pi}/\sigma_v`}，是<ChRef ch="05">第 5 章</ChRef> comparator 的統計小訊號增益（{m`\sigma_v`} 是雜訊 {m`v`} 的標準差，假設 {m`v`} 是 Gaussian），只在 comparator 輸入端由參數誤差造成的那一部分遠小於雜訊（{m`|\mathbf u^T\boldsymbol\delta_k|\ll\sigma_v`}）時<strong>近似</strong>成立。從 linear 換成 1-bit，多出來的就是這個小訊號條件；{m`\mathbf R`} 與它的 eigenvalue、eigenvector 都不變。
      </p>
      <DerivBox title={<>推導 {m`E[\boldsymbol\delta_{k+1}]=(\mathbf I-\mu K_q\mathbf R)E[\boldsymbol\delta_k]`}（linear 是等號；1-bit 是小訊號近似）</>}>
        <StepDerivation
          steps={[
            { tex: String.raw`\mathbf G_k=\frac1N\sum_{n\in k}t[n]\,\mathbf u[n]`, why: <>GMAC 的定義（平均；硬體若用總和要再除以 {m`N`}）。</> },
            { tex: String.raw`\boldsymbol\delta_{k+1}=\mathbf a-\mathbf w_{k+1}=\mathbf a-\mathbf w_k-\mu\mathbf G_k=\boldsymbol\delta_k-\mu\mathbf G_k`, why: <>代入更新式 {m`\mathbf w_{k+1}=\mathbf w_k+\mu\mathbf G_k`}。</> },
            {
              tex: String.raw`E[e\,\mathbf u\mid\boldsymbol\delta_k]=E[\mathbf u(\mathbf u^T\boldsymbol\delta_k+v)]=E[\mathbf u\mathbf u^T]\boldsymbol\delta_k+E[\mathbf u\,v]`,
              why: <>linear 時 {m`t=e`}；{m`\boldsymbol\delta_k`} 只由之前的 block 決定，與這個 block 的 {m`\mathbf u`} 獨立，可提出期望值外。</>,
            },
            { tex: String.raw`=\mathbf R\boldsymbol\delta_k+\mathbf 0`, why: <>{m`v`} 零均值且與 {m`\mathbf u`} 獨立 {m`\Rightarrow E[\mathbf u v]=E[\mathbf u]E[v]=\mathbf 0`}。</> },
            {
              tex: String.raw`E[\mathrm{sign}(e)\,\mathbf u\mid\boldsymbol\delta_k]\approx K_q\mathbf R\boldsymbol\delta_k,\quad K_q=\sqrt{2/\pi}/\sigma_v`,
              why: <>1-bit 時：comparator 的小訊號增益（<ChRef ch="05">第 5 章</ChRef>）；{m`|\mathbf u^T\boldsymbol\delta|\ll\sigma_v`} 時成立（本節末的「進階」框有 Bussgang 精確式）。</>,
            },
            {
              tex: String.raw`E[\mathbf G_k\mid\boldsymbol\delta_k]\ \begin{cases}=\mathbf R\boldsymbol\delta_k=K_q\mathbf R\boldsymbol\delta_k,\ \ K_q\equiv1&\text{linear}\\[2pt]\approx K_q\mathbf R\boldsymbol\delta_k,\ \ K_q=\sqrt{2/\pi}/\sigma_v&\text{1-bit（}|\mathbf u^T\boldsymbol\delta_k|\ll\sigma_v\text{）}\end{cases}`,
              why: (
                <>
                  {m`\mathbf G_k`} 是 {m`N`} 個同分布 sample 的平均，期望值和單一 sample 的相同。把兩種偵測器寫成同一個形式 {m`K_q\mathbf R\boldsymbol\delta_k`}：linear 是等號；1-bit 仍然是上一步的近似，換一個寫法不會讓它變精確。
                </>
              ),
            },
            {
              tex: String.raw`E[\boldsymbol\delta_{k+1}]=E[\boldsymbol\delta_k]-\mu\,E\big[E[\mathbf G_k\mid\boldsymbol\delta_k]\big]`,
              why: (
                <>
                  對 {m`\boldsymbol\delta_{k+1}=\boldsymbol\delta_k-\mu\mathbf G_k`} 取期望值（先對 block 內的 {m`\mathbf u`} 取條件期望，再對 {m`\boldsymbol\delta_k`} 平均：tower property）。這一步對兩種偵測器都精確。
                </>
              ),
            },
            {
              tex: String.raw`E\big[E[\mathbf G_k\mid\boldsymbol\delta_k]\big]\ \begin{cases}=K_q\mathbf R\,E[\boldsymbol\delta_k]&\text{linear}\\[2pt]\approx K_q\mathbf R\,E[\boldsymbol\delta_k]&\text{1-bit（小訊號）}\end{cases}`,
              why: (
                <>
                  {m`K_q\mathbf R\boldsymbol\delta_k`} 對 {m`\boldsymbol\delta_k`} 是線性的，期望值可以直接搬進去，linear 時這一步精確。1-bit 的精確條件平均（F-09.16）對
                  {m`\boldsymbol\delta_k`} 不是線性的，{m`E[f(\boldsymbol\delta_k)]\ne f(E[\boldsymbol\delta_k])`}，所以要先在小訊號下線性化，這一步才成立。
                </>
              ),
            },
          ]}
          result={formulaTex('F-09.3')}
        />
      </DerivBox>
      <TexBlock id="F-09.2">{formulaTex('F-09.2')}</TexBlock>
      <TexBlock id="F-09.3">{String.raw`\boxed{${formulaTex('F-09.3')}}`}</TexBlock>
      <Callout kind="warn" title={<>{m`K_q`} 必須明寫（<ChapterErratum id="E05" /> <ChapterErratum id="E08" />）</>}>
        規格 §9 寫成 {m`\boldsymbol\delta_{k+1}=(\mathbf I-\mu\mathbf R)\boldsymbol\delta_k`}，等於假設 {m`K_q=1`}——conventional LMS 的確如此；但 1-bit Sign-LMS 的 {m`K_q=\sqrt{2/\pi}/\sigma_v`} 帶單位 {m`\mathrm{fs}^{-1}`}。本章把 {m`g=\mu K_q`} 稱為 <strong>正規化 loop gain</strong>；規格的「{m`\mu=0.5`}」在本站讀作 {m`g=\mu K_q=0.5`}。 <ClaimTag kind="exact" />（linear；1-bit 為小訊號近似 <ClaimTag kind="approx" />）
      </Callout>
      <Callout kind="info" title="1-bit 時這是小訊號近似：多小才算小？">
        <p>
          判斷的量是 comparator 輸入端「參數誤差造成的訊號」與雜訊的比 {m`s_\delta`}（{m`\mathbf u^T\boldsymbol\delta`} 的 RMS 除以 {m`\sigma_v`}），不是
          {m`\|\boldsymbol\delta\|`} 本身。Gaussian {m`\mathbf u`} 的精確條件平均（F-09.16，本節末的「進階」框）用 {m`s_\delta`} 寫出來是下面的第二行：
        </p>
        <TexBlock>{String.raw`\begin{gathered}s_\delta=\frac{\sqrt{\boldsymbol\delta^T\mathbf R\boldsymbol\delta}}{\sigma_v}\\[4pt]E[\mathrm{sign}(e)\,\mathbf u\mid\boldsymbol\delta]=\frac{K_q}{\sqrt{1+s_\delta^2}}\,\mathbf R\boldsymbol\delta\end{gathered}`}</TexBlock>
        <p>
          方向仍是 {m`\mathbf R\boldsymbol\delta`}，但 {m`s_\delta=0.1`} 時修正量比 {m`K_q\mathbf R\boldsymbol\delta`} 少 {m`${texNum(100 * (1 - sign.gain[0]), 2)}\%`}、
          {m`s_\delta=0.3`} 少 {m`${texNum(100 * (1 - sign.gain[1]), 2)}\%`}、{m`s_\delta=1`} 少 {m`${texNum(100 * (1 - sign.gain[2]), 2)}\%`}。
        </p>
        <p>
          例：單一參數、{m`u\sim\mathcal N(0,1)`}、{m`\delta_0=\sigma_v=1`}、{m`\mu=0.1`}。真實的一步平均是
          {m`E[\delta_1]=1-0.1/\sqrt\pi=${texNum(sign.stepExact, 5)}`}；F-09.3 的線性式給 {m`1-0.1\sqrt{2/\pi}=${texNum(sign.stepLin, 5)}`}。
          {m`u`} 與 {m`\delta_0`} 的獨立性在這個例子完全成立，差的 {m`${texNum(sign.stepExact - sign.stepLin, 3)}`} 全部來自 comparator 的線性化。linear detector 沒有這個問題：同樣的數字下 {m`E[\delta_1]=(1-\mu)\delta_0=${texNum(sign.stepLinDet)}`}，{m`\delta_0`} 再大也是精確的。
        </p>
        <p>
          {m`\boldsymbol\delta_k`} 是隨機的，所以這個條件要對初始誤差成立，也要對迴路自己的穩態抖動成立。1-bit 每個 block 注入 {m`\mu^2\mathbf R/N`} 的雜訊（下一節 F-09.18）；把 F-09.18 迭代到穩態，就得到抖動造成的 {m`E[s_\delta^2]`}。本章的 {m`\rho=0.99`}、Gaussian {m`\mathbf u`}、{m`g=0.5`}：
          {m`N=1`} 時是 {m`${texNum(sign.jitterN1, 2)}`}——已經不是 {m`\ll1`}，這個估計自己的前提就不成立（Monte Carlo 的實際值更大，超過 {m`1`}），實際的平均收斂比線性式慢；{m`N=32`} 時是 {m`${texNum(sign.jitterN32, 2)}`}，才回到小訊號區。{m`g`} 大而 {m`N`} 小時要先檢查這一項。所以下面的 pole 與 {m`k_{95}`} 用在 1-bit 時是 {m`s_\delta\ll1`} 的局部結果，用在 linear detector 時才是精確的。 <ClaimTag kind="approx" />
        </p>
      </Callout>

      <h4>先算一次：兩個 LMS loop 會互相干擾（{m`\rho=0.8`}）</h4>
      <p>
        把上面框起來的平均遞迴，照兩個參數攤開來畫（{m`\mathbf R=\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}`}，{m`g=\mu K_q`}）：
      </p>
      <Diagram id="coupled-mean">
        看紅色的兩條交叉線（係數是 {m`\rho`}）：每個 loop 的 GMAC 除了自己的誤差，還會讀到另一個參數的誤差。
      </Diagram>
      <p>
        <FigRef id="coupled-mean" /> 怎麼看：先看不交叉的路——{m`E[\delta_1]`} 以係數 1 進第一個加法點，乘上 {m`g`} 之後從 {m`E[\delta_1]`} 自己身上扣掉（標著 {m`-`} 的那條線），得到下一個 block 的 {m`E[\delta_1]`}；如果只有這條路，就是前幾章的單參數 LMS（每個 block 乘上 {m`1-g`}）。再看紅色的交叉線——{m`E[\delta_2]`} 也以係數 {m`\rho`} 漏進同一個加法點，於是 loop 1 會去「修」其實是參數 2 造成的誤差，反過來也一樣。圖只畫了一個 block：輸出延遲一個 block（{m`z^{-1}`}）之後，就是下一輪的輸入。圖上進入加法點的係數 {m`1`} 與 {m`\rho`} 就是 {m`\mathbf R`} 的對角與非對角元素；兩個加法點的輸出就是 {m`\mathbf R\,E[\boldsymbol\delta]`} 的兩列 {m`\delta_1+\rho\delta_2`}、{m`\rho\delta_1+\delta_2`}
        （也就是 {m`E[\mathbf G]/K_q`}）；「{m`\times g`}」之後的減號就是 {m`\mathbf I-g\mathbf R`} 的那個負號。
      </p>
      <p>
        {m`\mathbf R`} 的非對角元素就是「干擾」。設 {m`\mathbf R=\begin{bmatrix}1&0.8\\0.8&1\end{bmatrix}`}，第 1 個參數已經完全正確、只有第 2 個有誤差：
        {m`\boldsymbol\delta=(0,\,1)`}。兩個 GMAC 的平均輸出是（由 <code>matVec</code> 計算）
      </p>
      <TexBlock>{String.raw`\frac{E[\mathbf G\mid\boldsymbol\delta]}{K_q}=\mathbf R\boldsymbol\delta=\begin{bmatrix}1&0.8\\0.8&1\end{bmatrix}\begin{bmatrix}0\\1\end{bmatrix}=${texVec(G08)}\quad\Rightarrow\quad E[G_1]=${texNum(G08[0])}\,K_q\,\delta_2`}</TexBlock>
      <p>
        第 1 個 loop 明明沒有誤差（{m`\delta_1=0`}），它的 GMAC 卻讀到 {m`${texNum(G08[0])}K_q\delta_2`}——因為兩個 regressor 的相關係數是 {m`\rho=${texNum(G08[0])}`}，第 2 個參數造成的誤差有 {m`${texNum(100 * G08[0])}\%`} 看起來像第 1 個參數的錯。於是 {m`g=0.5`} 走一步之後
        {m`E[\boldsymbol\delta_1]=(${texNum(step08[0][1])},\ ${texNum(step08[1][1])})`}：<strong>原本正確的 {m`w_1`} 被拉離真值 {m`${texNum(Math.abs(step08[0][1]))}`}</strong>，之後兩個 loop 才一起慢慢修回來（{m`\mathbf R`} 的 eigenvalues {m`\lambda=${texNum(modes08.lambdas[0])},\ ${texNum(modes08.lambdas[1])}`}，慢的那個模式每個 block 只乘上 {m`${texNum(modes08.poles[1])}`}，要 {m`k_{95}=${modes08.k95[1]}`} 個 block 才剩 5%——{m`k_{95}`} 的算法在下面第 4 小節）。要把這種耦合「解開」，就要換到 {m`\mathbf R`} 的 eigenvector 座標。 <ClaimTag kind="exact" /> <SourceTag />
      </p>

      <h3>3. 對角化：耦合的兩條遞迴變成兩條獨立的等比數列</h3>
      <p>
        交叉線讓兩條遞迴糾纏在一起，很難直接看出收斂有多快。解法是換一組座標：不看 {m`(\delta_1,\delta_2)`}，改看平均誤差在 {m`\mathbf R`} 的兩個
        eigenvector 上的分量 {m`c_1`}、{m`c_2`}（<strong>模態座標</strong>，modal coordinates）。在這組座標裡 {m`\mathbf R`} 只做縮放，交叉線就消失了：
      </p>
      <Diagram id="eigen-modes">
        比較綠色與紅色兩個方塊：同一個 {m`g`}，兩個模式的 pole 不一樣；紅色（{m`\lambda`} 小）那一條決定你要等多久（{m`g`} 不太大時；條件寫在 F-09.4 下面）。
      </Diagram>
      <p>
        <FigRef id="eigen-modes" /> 怎麼看：先看「旋轉」——把平均誤差投影到兩個 eigenvector，得到 {m`c_1`}（沿 {m`\mathbf v_1`}）與 {m`c_2`}（沿 {m`\mathbf v_2`}）。再看綠色與紅色兩個方塊——每個分量各走各的，每個 block 只乘上自己的倍數 {m`p_i`}，中間沒有任何交叉線；{m`p_i`} 叫這個模式的 <strong>pole</strong>
        （等比數列的公比）。最後「轉回」原座標，下一個 block 再走一圈。圖上的「旋轉」就是公式裡的 {m`\mathbf c_k=\mathbf Q^TE[\boldsymbol\delta_k]`}，「轉回」就是 {m`E[\boldsymbol\delta_k]=\mathbf Q\mathbf c_k`}，兩個方塊裡的 {m`p_1`}、{m`p_2`} 就是 F-09.4 的 {m`p_i=1-\mu K_q\lambda_i`}
        （{m`g=\mu K_q`}）。公式裡的 {m`\mathbf Q`} 是把 eigenvector {m`\mathbf v_1`}、{m`\mathbf v_2`} 當成欄排成的矩陣，{m`\boldsymbol\Lambda`} 是對角線上放
        {m`\lambda_1`}、{m`\lambda_2`} 的對角矩陣。本例的 {m`\mathbf v_1=(1,1)/\sqrt2`} 是共模、{m`\mathbf v_2=(1,-1)/\sqrt2`} 是差模。
      </p>
      <DerivBox title={<>推導 {m`p_i=1-\mu K_q\lambda_i`}</>}>
        <StepDerivation
          steps={[
            { tex: String.raw`\mathbf R=\mathbf Q\boldsymbol\Lambda\mathbf Q^T,\quad \mathbf Q^T\mathbf Q=\mathbf I`, why: '對稱矩陣可對角化（先備知識框）。' },
            { tex: String.raw`\mathbf c_k:=\mathbf Q^TE[\boldsymbol\delta_k]\ \Leftrightarrow\ E[\boldsymbol\delta_k]=\mathbf Q\mathbf c_k`, why: '把誤差寫成 eigenvector 的組合（換座標）。' },
            { tex: String.raw`\mathbf c_{k+1}=\mathbf Q^T(\mathbf I-g\mathbf Q\boldsymbol\Lambda\mathbf Q^T)\mathbf Q\mathbf c_k`, why: <>兩邊左乘 {m`\mathbf Q^T`}，並代入 {m`E[\boldsymbol\delta_k]=\mathbf Q\mathbf c_k`}；{m`g=\mu K_q`}。</> },
            { tex: String.raw`=(\mathbf Q^T\mathbf Q-g\,\mathbf Q^T\mathbf Q\,\boldsymbol\Lambda\,\mathbf Q^T\mathbf Q)\mathbf c_k=(\mathbf I-g\boldsymbol\Lambda)\mathbf c_k`, why: <>展開並用 {m`\mathbf Q^T\mathbf Q=\mathbf I`}。</> },
            { tex: String.raw`c_{i,k+1}=(1-g\lambda_i)\,c_{i,k}`, why: <>{m`\boldsymbol\Lambda`} 是對角矩陣 {m`\Rightarrow`} 每一列互不相干（decoupled）。</> },
            { tex: String.raw`c_{i,k}=(1-g\lambda_i)^k\,c_{i,0}`, why: '每一個模式都是等比數列（公比 = pole）。' },
          ]}
        />
      </DerivBox>
      <TexBlock id="F-09.4">{formulaTex('F-09.4')}</TexBlock>
      <p>
        等比數列 {m`p^k\to0\iff|p|<1`}，所以 <strong>平均收斂</strong>（mean convergence）{m`\iff`} 對所有 {m`i`}：{m`|1-g\lambda_i|<1`} {m`\iff`}
        {m`\lambda_{\min}>0`} 且 {m`0<g<2/\lambda_{\max}`}（{m`\lambda_i=0`} 的模式 {m`p_i=1`}，永遠不動）。注意：{m`\lambda_{\max}`} 限制了 {m`g`} 能多大；
        {m`g`} 不太大時（{m`g\le2/(\lambda_{\max}+\lambda_{\min})`}，就是下面第 5 小節的 {m`g^\star`}），最慢的是 {m`\lambda_{\min}`} 那個模式，pole 是
        {m`1-g\lambda_{\min}`}。{m`g`} 再大，{m`\lambda_{\max}`} 的模式會因為過衝（pole 是負的）而變成最慢的。 <ClaimTag kind="exact" />（給定 {m`g`} 的線性遞迴；用在 1-bit 時，這些 {m`p_i`} 只是小訊號區 {m`s_\delta\ll1`} 的局部 pole，見 F-09.3 下面的說明）
      </p>

      <h3>
        4. 例子：{m`\rho=0.99`}、{m`g=\mu K_q=0.5`} <TestBadge id="T10" /> <TestBadge id="T11" />
      </h3>
      <p>
        把上面的結果代入規格的例子。手算的順序就是下面這張流程圖，每一格只做一種運算：
      </p>
      <Diagram id="k95-flow">
        跟著 ① → ④ 走：{m`\rho`} 決定 eigenvalue，eigenvalue 乘上 {m`g`} 決定 pole，慢 pole 決定要等幾個 block。
      </Diagram>
      <p>
        <FigRef id="k95-flow" /> 怎麼看：先看 ①——兩個 eigenvalue 是 {m`1\pm\rho`}；它們的比值 {m`\kappa=\lambda_{\max}/\lambda_{\min}`} 叫
        <strong>condition number</strong>（eigenvalue spread），越大表示兩個方向差越多。再看 ②——同一個 {m`g`} 乘上不同的 {m`\lambda`}，得到快、慢兩個 pole。③ 檢查兩個 pole 的絕對值都小於 1。最後 ④——{m`k_{95}`} 是「慢模式衰減到只剩 5% 要幾個 block」。圖上 ① 的數字就是 F-09.5，④ 就是 F-09.6；下面的表格與推導逐格驗算。
      </p>
      <TexBlock id="F-09.5">{formulaTex('F-09.5')}</TexBlock>
      <p>
        <strong>適用範圍：</strong>{m`\lambda_1=1+\rho`} 配共模 {m`\mathbf v_1`}、{m`\lambda_2=1-\rho`} 配差模 {m`\mathbf v_2`}，這組配對對任何
        {m`-1\le\rho\le1`} 都成立。{m`\kappa`} 是「大的除以小的」，所以式中是 {m`|\rho|`}，而且需要 {m`|\rho|<1`}（{m`|\rho|=1`} 時
        {m`\lambda_{\min}=0`}、{m`\kappa=\infty`}，見第 6 小節）。本章的例子與手算都取 {m`\rho\ge0`}：{m`\lambda_{\max}=\lambda_1`}，共模是快模式。
        {m`\rho<0`}（兩個 regressor 多半反號）時角色對調：{m`\lambda_{\max}=\lambda_2=1+|\rho|`}，差模變成快模式、共模變成慢模式。例如 {m`\rho=-0.5`} 時
        {m`\lambda_{\max}=${texNum(neg.lambdas[0])}`}、{m`\lambda_{\min}=${texNum(neg.lambdas[1])}`}、{m`\kappa=${texNum(neg.kappa)}`}，和 {m`\rho=+0.5`} 一樣；漏掉絕對值會算成 {m`(1+\rho)/(1-\rho)=1/3<1`}，那是 {m`\lambda_1/\lambda_2`}，不是 {m`\lambda_{\max}/\lambda_{\min}`}。 <ClaimTag kind="exact" />
      </p>
      <div className="table-wrap">
        <table className="ch09-table">
          <thead>
            <tr>
              <th className="ch09-left">模式</th>
              <th>eigenvector</th>
              <th>{m`\lambda_i`}</th>
              <th>{m`p_i=1-0.5\lambda_i`}</th>
              <th>{m`k_{95}`}</th>
              <th className="ch09-left">白話</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="ch09-left">快（共模）</td>
              <td>{m`(1,1)/\sqrt2`}</td>
              <td>{num(modes.lambdas[0], 6)}</td>
              <td>{num(modes.poles[0], 6)}</td>
              <td>{modes.k95[0]}</td>
              <td className="ch09-left">兩個參數一起偏：一步就幾乎消失</td>
            </tr>
            <tr>
              <td className="ch09-left">慢（差模）</td>
              <td>{m`(1,-1)/\sqrt2`}</td>
              <td>{num(modes.lambdas[1], 6)}</td>
              <td>{num(modes.poles[1], 6)}</td>
              <td>{modes.k95[1]}</td>
              <td className="ch09-left">一高一低：每個 block 只修掉 0.5%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="ch09-note">
        表中數字由 <code>eigenModes()</code>（Jacobi）即時計算；{m`\kappa=${texNum(modes.kappa, 6)}`}。
      </p>

      <h4>先算一次：{m`\boldsymbol\delta_0=(1,0)`} 走四步</h4>
      <p>
        {m`(1,0)=\tfrac1{\sqrt2}\mathbf v_1+\tfrac1{\sqrt2}\mathbf v_2`}，兩個模式各佔一半。直接用 {m`\mathbf I-0.5\mathbf R=${texMatrix(A)}`}：
        {m`\big(${texNum(A[0][0])}\cdot1+(${texNum(A[0][1])})\cdot0,\ \ ${texNum(A[1][0])}\cdot1+${texNum(A[1][1])}\cdot0\big)=(${texNum(steps[1].d[0])},\,${texNum(steps[1].d[1])})`}。下表由 <code>meanTrajectory()</code> 算出：
      </p>
      <div className="table-wrap">
        <table className="ch09-table">
          <thead>
            <tr>
              <th>{m`k`}</th>
              <th>{m`E[\delta_1]`}</th>
              <th>{m`E[\delta_2]`}</th>
              <th>{m`c_{1,k}`}（快）</th>
              <th>{m`c_{2,k}`}（慢）</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.k}>
                <td>{s.k}</td>
                <td>{num(s.d[0], 6)}</td>
                <td>{num(s.d[1], 6)}</td>
                <td>{num(s.c[0], 6)}</td>
                <td>{num(s.c[1], 6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        一步之後共模分量只剩 {m`${texNum(modes.poles[0], 3)}\times${texNum(steps[0].c[0], 4)}=${texNum(steps[1].c[0], 2)}`}，誤差幾乎完全落在差模方向 {m`(1,-1)`} 上，接下來每個 block 只縮小 {m`${texNum(100 * (1 - modes.poles[1]), 3)}\%`}。
        <strong>迴路穩定，但大部分時間花在等最慢的那個模式。</strong>
      </p>
      <HandCalcBox id="HC-09.2">
        換一組 {m`\rho`}、{m`g`} 與初始誤差，先照「直接乘」算一步，再用「拆成共模／差模」算 {m`k`} 步（需要 {m`\sqrt2`} 和 {m`y^x`} 鍵）。範例數字就是上表：把 {m`k`} 改成 1–4 可以逐列對答案。
      </HandCalcBox>

      <h4>為什麼是 598 個 blocks？</h4>
      <StepDerivation
        steps={[
          { tex: String.raw`|c_{2,k}|=0.995^k\,|c_{2,0}|\le0.05\,|c_{2,0}|`, why: '「下降 95%」= 剩下不到初值的 5%。' },
          { tex: String.raw`0.995^k\le0.05`, why: <>兩邊除以 {m`|c_{2,0}|>0`}。</> },
          { tex: String.raw`k\ln0.995\le\ln0.05`, why: <>取自然對數；{m`\ln`} 是遞增函數，不等號方向不變。</> },
          {
            tex: String.raw`k\ge\frac{\ln0.05}{\ln0.995}=\frac{${texNum(lnF, 7)}}{${texNum(lnP, 7)}}=${texNum(lnF / lnP, 7)}`,
            why: <>{m`\ln0.995<0`}：兩邊除以負數，不等號翻轉。</>,
          },
          { tex: String.raw`k_{95}=\lceil${texNum(stepsToDecayReal(0.995), 7)}\rceil=${stepsToDecay(0.995)}`, why: 'block 數必須是整數，取上整（ceil）。' },
          {
            tex: String.raw`0.995^{597}=${texNum(Math.pow(0.995, 597), 6)}>0.05,\qquad 0.995^{598}=${texNum(Math.pow(0.995, 598), 6)}\le0.05`,
            why: '驗算：597 還差一點，598 剛好跨過。',
          },
          {
            tex: String.raw`k_{95}\approx\frac{\ln20}{g\lambda_{\min}}=\frac{${texNum(Math.log(20), 5)}}{0.005}\approx${texNum(Math.log(20) / 0.005, 5)}`,
            why: <>泰勒一階：{m`\ln(1-x)\approx-x`}（{m`x=g\lambda_{\min}`} 很小）；{m`\ln20\approx3`}，即「三個時間常數」。</>,
          },
        ]}
      />
      <TexBlock id="F-09.6">{formulaTex('F-09.6')}</TexBlock>
      <HandCalcBox id="HC-09.3">
        換一個 {m`\rho`} 與 {m`g`}，自己走一次「eigenvalue → {m`\kappa`} → pole → {m`k_{95}`}」（要按兩次 {m`\ln`}）。先猜猜看：{m`\rho`} 從 0.99 降到 0.9，要等的 blocks 會少幾倍？
      </HandCalcBox>
      <Callout kind="info" title={<>同樣的「{m`\mu=0.5`}」換成物理單位（<ChapterErratum id="E05" />）</>}>
        若 {m`\mu=0.5\,\mathrm{fs}`}、1-bit comparator 的 {m`\sigma_v=100\,\mathrm{fs}`}：{m`K_q=${texNum(KQ_SIGMA100, 6)}\,\mathrm{fs}^{-1}`}，
        {m`\mu K_q\lambda_{\min}=${texNum(0.5 * KQ_SIGMA100 * 0.01, 4)}`}，慢 pole {m`=${texNum(phys.poles[1], 9)}`}，需要 <strong>{phys.k95[1].toLocaleString('en-US')}</strong> blocks（不是 598）。要得到 {m`g=0.5`} 必須
        {m`\mu=0.5/K_q=${texNum(0.5 / KQ_SIGMA100, 6)}\,\mathrm{fs}`}。 <ClaimTag kind="approx" />（1-bit：{m`K_q`} 是小訊號增益，前提是
        {m`|\mathbf u^T\boldsymbol\delta_k|\ll\sigma_v=100\,\mathrm{fs}`}；單位換算本身是精確的算術）
      </Callout>

      <h3>5. 單一 {m`\mu`} 最多能多快？eigenvalue spread 的代價</h3>
      <p>
        {m`\mu`}（也就是 {m`g`}）只有一個，卻要同時服務快、慢兩個模式：
      </p>
      <Diagram id="scalar-gain">
        看紅色方塊：快模式限制了 {m`g`} 能開多大（{m`g<2/\lambda_{\max}`}）；藍色方塊是兩邊拉扯之後的最佳點。
      </Diagram>
      <p>
        <FigRef id="scalar-gain" /> 怎麼看：先看兩個分支——{m`g`} 加大時，慢模式每個 block 的倍數 {m`|1-g\lambda_{\min}|`} 一路變小（越來越快，直到
        {m`g=1/\lambda_{\min}`}）；但快模式的 {m`|1-g\lambda_{\max}|`} 先變小，過了 {m`g=1/\lambda_{\max}`} 之後反而變大，到 {m`g=2/\lambda_{\max}`} 就等於 1（不再收斂）。再看合流的地方——整體的收斂率是兩者之中較大的那個，所以兩者相等時最好。圖上藍色方塊的 {m`g^\star`} 與 {m`(\kappa-1)/(\kappa+1)`} 就是 F-09.7。
      </p>
      <DerivBox title={<>推導最佳 scalar gain {m`g^\star`}</>}>
        <StepDerivation
          steps={[
            { tex: String.raw`\rho_{\text{mean}}(g)=\max_i|1-g\lambda_i|=\max\big(|1-g\lambda_{\min}|,\ |1-g\lambda_{\max}|\big)`, why: <>最慢的模式決定整體速度；{m`|1-g\lambda|`} 是 {m`\lambda`} 的 V 形函數，最大值在兩端。</> },
            { tex: String.raw`1-g\lambda_{\min}=-(1-g\lambda_{\max})`, why: <>{m`g`} 變大時第一項變小、第二項變大；兩者相等時 max 最小。</> },
            { tex: String.raw`g^\star=\frac{2}{\lambda_{\max}+\lambda_{\min}}`, why: <>移項：{m`1-g\lambda_{\min}=g\lambda_{\max}-1\Rightarrow 2=g(\lambda_{\max}+\lambda_{\min})`}。</> },
            { tex: String.raw`\rho_{\text{mean}}(g^\star)=1-\frac{2\lambda_{\min}}{\lambda_{\max}+\lambda_{\min}}=\frac{\lambda_{\max}-\lambda_{\min}}{\lambda_{\max}+\lambda_{\min}}=\frac{\kappa-1}{\kappa+1}`, why: <>代回，並分子分母同除 {m`\lambda_{\min}`}（{m`\kappa=\lambda_{\max}/\lambda_{\min}`}）。</> },
          ]}
        />
      </DerivBox>
      <TexBlock id="F-09.7">{formulaTex('F-09.7')}</TexBlock>
      <p>
        {m`\rho=0.99`}：{m`g^\star=${texNum(opt.g, 6)}`}，最好也只有 {m`${texNum(opt.p, 6)}`}/block，仍需 {m`k_{95}=${stepsToDecay(opt.p)}`}。
        <strong>只要 {m`\kappa`} 很大，任何單一 {m`\mu`} 都快不起來</strong>——這是<ChRef ch="10">第 10 章</ChRef> preconditioner 的動機。 <ClaimTag kind="exact" />（線性遞迴的結論；1-bit 時 {m`g^\star`} 與這個收斂率同樣只在小訊號區成立，而且 {m`g`} 越大、迴路自己的抖動越大，見 F-09.3 下面的說明）
      </p>
      <HandCalcBox id="HC-09.4">
        兩個 regressor 的功率不一定相等。輸入你自己的 {m`E[u_1^2]`}、{m`E[u_1u_2]`}、{m`E[u_2^2]`}，用 trace 與 determinant 手算
        {m`\lambda_{\max}`}、{m`\lambda_{\min}`}、{m`\kappa`}，再算最佳的單一 {m`g^\star`} 與它的收斂率（只需要一次 {m`\sqrt{\ }`}）。範例是先備知識框的
        {m`a=2,\ b=0.6,\ d=1`}。
      </HandCalcBox>
      <p>
        {m`\kappa`} 還有第二個代價：雜訊。如果硬要讓兩個方向一樣快（最小平方解，或<ChRef ch="10">第 10 章</ChRef>的 preconditioner），沿弱方向（{m`\lambda_{\min}`}）估計出來的參數，標準差會是強方向（{m`\lambda_{\max}`}）的 {m`\sqrt{\lambda_{\max}/\lambda_{\min}}=\sqrt\kappa=\sqrt{${texNum(modes.kappa, 6)}}\approx${texNum(Math.sqrt(modes.kappa), 4)}`} 倍（訊號能量少 {m`\kappa`} 倍 {m`\Rightarrow`} 標準差大 {m`\sqrt\kappa`} 倍；<ChRef ch="10">第 10 章</ChRef>用 preconditioner 的變異數公式推導）。單一 {m`\mu`} 的 LMS 沒有這個放大，付出的就是上面那個「慢」。<strong>快與準不可兼得，根源都是 {m`\lambda_{\min}`} 太小。</strong> <ClaimTag kind="approx" />
      </p>

      <h3>6. {m`\rho=1`}：完全不可辨識（反面測試）</h3>
      <p>
        {m`\rho=1`} 時 {m`\lambda=${texNum(rho1.lambdas[0])},\ ${texNum(rho1.lambdas[1])}`}、{m`\kappa=\infty`}，慢 pole {m`p_2=${texNum(rho1.poles[1])}`}。此時 {m`u_1=u_2`}，{m`e=u_1(\delta_1+\delta_2)+v`} 只含 <strong>和</strong>；差模分量 {m`c_2=(\delta_1-\delta_2)/\sqrt2`} 對 {m`e`}
        毫無影響，所以：
      </p>
      <TexBlock>{String.raw`c_{2,k}=1^k\,c_{2,0}=c_{2,0}\;\text{（永遠停在初值）}`}</TexBlock>
      <p>
        從 {m`\boldsymbol\delta_0=(1,0)`} 出發，30 步後 {m`E[\boldsymbol\delta_{30}]=(${texNum(traj1[0][30], 5)},\ ${texNum(traj1[1][30], 5)})`}：和歸零、差仍是 1。<strong>增加 {m`N`}、加大 {m`\mu`}、跑更久都沒有用</strong>——缺的是資訊，不是時間。這就是開場「{m`\mathbf u`} 永遠是 {m`(1,1)`}」的例子。
        {m`\rho=-1`} 也一樣不可辨識，只是角色對調：{m`u_1=-u_2`}，{m`e=u_1(\delta_1-\delta_2)+v`} 只含<strong>差</strong>，看不到的變成共模 {m`(1,1)/\sqrt2`}。
        <ClaimTag kind="exact" />
      </p>

      <Prereq title="進階：1-bit comparator 的精確平均 GMAC（Bussgang / Price 定理）">
        <p>
          若 {m`\mathbf u\sim\mathcal N(\mathbf 0,\mathbf R)`}、{m`v\sim\mathcal N(0,\sigma_v^2)`} 獨立，則 {m`e=\mathbf u^T\boldsymbol\delta+v`} 與 {m`\mathbf u`}
          聯合高斯。對聯合高斯的 {m`(X,\mathbf Y)`}，Stein/Price 引理給 {m`E[f(X)\mathbf Y]=E[X\mathbf Y]\,E[f'(X)]`}；取 {m`f=\mathrm{sign}`}，
          {m`E[f'(X)]=2\,\mathrm{pdf}_X(0)=\sqrt{2/\pi}/\sigma_X`}：
        </p>
        <TexBlock id="F-09.16">{formulaTex('F-09.16')}</TexBlock>
        <p>
          方向永遠是 {m`\mathbf R\boldsymbol\delta`}（所以 eigen 結構完全相同），只是大誤差時有效增益被 {m`\sqrt{\sigma_v^2+\boldsymbol\delta^T\mathbf R\boldsymbol\delta}`} 壓低。
          {m`\pm1`} code 也有精確式 {m`\sum_s\pi_s\,\mathrm{erf}\big((\delta_1+s\delta_2)/(\sqrt2\sigma_v)\big)(1,s)`}（{m`\mathrm{erf}`} 是高斯累積分布的另一種寫法：
          {m`E[\mathrm{sign}(s_0+v)]=\mathrm{erf}\big(s_0/(\sqrt2\sigma_v)\big)`}，見<ChRef ch="05">第 5 章</ChRef>；{m`\pi_s=P(s)`}）。把它代進平均遞迴是
          <strong> mean-field 近似</strong>（期望值與非線性函數不可交換）。 <ClaimTag kind="exact" />（條件平均） <ClaimTag kind="approx" />（mean-field 遞迴）
        </p>
      </Prereq>

      <Derivation
        title="這一節的假設與單位"
        formulaId="F-09.3"
        level="L3"
        claim="approx"
        derivation={
          <p>
            平均遞迴 {m`E[\boldsymbol\delta_{k+1}]=(\mathbf I-\mu K_q\mathbf R)E[\boldsymbol\delta_k]`} 對 linear detector 是精確的（只需要這個 block 的 {m`\mathbf u`}、{m`v`} 與 {m`\boldsymbol\delta_k`} 獨立，{m`v`} 零均值、與 {m`\mathbf u`} 獨立；不限誤差大小）；對 1-bit 是小訊號近似（Gaussian {m`\mathbf u`} 的精確條件平均見 F-09.16；把它代回遞迴是 mean-field 近似）。它描述的是 <strong>ensemble 平均</strong>，不是單一軌跡、也不是均方值（見下一節）。
          </p>
        }
        symbols={[
          { symbol: 'g=\\mu K_q', meaning: '正規化 loop gain', unit: '無因次' },
          { symbol: 'K_q', meaning: <>1-bit：{m`\sqrt{2/\pi}/\sigma_v`}；linear：{m`1`}</>, unit: <>{m`\mathrm{fs}^{-1}`} 或 1</> },
          { symbol: '\\lambda_i', meaning: <>{m`\mathbf R`} 的 eigenvalue</>, unit: <>無因次（{m`\mathbf u`} 正規化時）</> },
        ]}
        units={
          <div className="table-wrap">
            <table className="c-derivation-table">
              <thead>
                <tr>
                  <th>量</th>
                  <th>單位</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{m`\mu`}</td>
                  <td>linear：無因次；1-bit：{m`\mathrm{fs}`}</td>
                </tr>
                <tr>
                  <td>{m`K_q`}</td>
                  <td>{m`\mathrm{fs}^{-1}`}（linear 時為 1）</td>
                </tr>
                <tr>
                  <td>{m`\boldsymbol\delta`}</td>
                  <td>{m`\mathrm{fs}`}（或正規化）</td>
                </tr>
                <tr>
                  <td>{m`k`}</td>
                  <td>block</td>
                </tr>
              </tbody>
            </table>
          </div>
        }
        assumptions={[
          String.raw`理想匹配：$e$ 對參數線性、GMAC regressor 與 PD 端的 $\mathbf u$ 一致（filtered-x 或 $H=1$）`,
          String.raw`$\mathbf u$ 跨 sample / block 獨立且平穩，與 $\boldsymbol\delta_k$ 獨立（block 更新使這成立）`,
          String.raw`$v$ 零均值、與 $\mathbf u$ 獨立`,
          String.raw`1-bit：$v$ 為 Gaussian，且 $|\mathbf u^T\boldsymbol\delta_k|\ll\sigma_v$（小訊號 $K_q$）——對初始誤差與迴路自己的穩態抖動都要成立`,
        ]}
      />
      <p className="ch09-note">
        本節數字全部由 <code>src/simulation/models/pe.ts</code> 即時計算；golden 值見 T10 / T11。
      </p>
    </Section>
  )
}
