import { useMemo, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  ClaimTag,
  CodeBlock,
  Derivation,
  ModeGate,
  Plot,
  Prereq,
  Section,
  SourceTag,
  StepDerivation,
  Tex,
  TexBlock,
  useThemeTokens,
} from '@/components'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import { averageCost, batchOptima, type TieRule } from '@/simulation/models/lms'
import {
  FOUR_POINT_VALUES,
  batchHuber,
  batchL1,
  batchL2,
  contaminatedMedianApprox,
  lmsSteadyState,
  populationOptima,
  signErrorJitterApprox,
  signErrorLatticeStationary,
  type EfficiencyParams,
  type EfficiencyResult,
  type LossDataParams,
} from '@/simulation/models/lossCompare'
import lmsSrc from '@/simulation/models/lms.ts?raw'
import lossSrc from '@/simulation/models/lossCompare.ts?raw'
import { Link } from 'react-router-dom'
import { BlockDiagram, ChapterHandCalc, Erratum, f, PllLink, SpecNote, texNum, useChapterMode } from '../common'
import { MseMaeLab } from '../experiments/MseMaeLab'

const Y4 = [...FOUR_POINT_VALUES]
const ONES = [1, 1, 1, 1]
const MU_SS = 0.2
const FOUR: LossDataParams = {
  model: 'four_point',
  a: 0,
  xDist: 'const',
  xScale: 1,
  sigma: 0,
  outlierProb: 0,
  outlierSize: 0,
  outlierSign: 'positive',
  n: 0,
  seed: 0,
}
const CONTAM = { sigma: 1, eps: 0.1, s: 20 }
/** §2.3.2：純 Gaussian 雜訊（σ_v = 1、x ≡ 1）下 Sign-Error 的抖動；μ 每次縮小 4 倍 ⇒ std 應縮小 2 倍 */
const JIT_SIGMA = 1
const JIT_MUS = [0.2, 0.05, 0.0125]
const JIT_PLOT_MU = 0.05
/** 顯示用：把 1e-12 以下的浮點殘差（例如 3e-19）顯示成 0 */
const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v)

export function MedianExampleSection() {
  const tokens = useThemeTokens()
  const { atLeast } = useChapterMode()

  const ex = useMemo(() => {
    const bo = batchOptima(Y4) // lms.ts：平均與中位數區間
    const hub = batchHuber(ONES, Y4, 1)
    const J = (k: 'mse' | 'mae' | 'huber', w: number) => averageCost(k, w, ONES, Y4, 1)
    const pts = [bo.mse, bo.maeLow, hub]
    const below = (w: number) => Y4.filter((y) => y < w).length
    const above = (w: number) => Y4.filter((y) => y > w).length
    const slopes = [-1, 5, 11].map((w) => ({ w, below: below(w), above: above(w), slope: (below(w) - above(w)) / Y4.length }))
    const influence = [10, 100, 1000].map((s) => {
      const y = [0, 0, 0, s]
      const m = batchL1(ONES, y)
      return { s, mean: batchL2(ONES, y), median: 0.5 * (m.lo + m.hi), huber: batchHuber(ONES, y, 1) }
    })
    const ey2 = Y4.reduce((s, y) => s + y * y, 0) / Y4.length // E[y²]
    return { bo, hub, J, pts, slopes, influence, ey2, vary: ey2 - bo.mse * bo.mse }
  }, [])

  const costPlot = useMemo<Data[]>(() => {
    const grid = Array.from({ length: 261 }, (_, i) => -2 + (14 * i) / 260)
    return [
      { x: grid, y: grid.map((w) => ex.J('mse', w)), name: String.raw`$J_{\mathrm{MSE}}(w)=\tfrac14\,\sum\,\tfrac12(y_i-w)^2$`, mode: 'lines', line: { color: tokens.series[0] } },
      { x: grid, y: grid.map((w) => ex.J('mae', w)), name: String.raw`$J_{\mathrm{MAE}}(w)=\tfrac14\,\sum|y_i-w|$`, mode: 'lines', line: { color: tokens.series[1] } },
      { x: grid, y: grid.map((w) => ex.J('huber', w)), name: String.raw`$J_{\mathrm{Huber}}(w)$（$\delta_H=1$）`, mode: 'lines', line: { color: tokens.series[2] } },
      { x: [ex.bo.mse], y: [ex.J('mse', ex.bo.mse)], name: `平均 ${f(ex.bo.mse)}`, mode: 'markers', marker: { size: 11, color: tokens.series[0] } },
      { x: [ex.bo.maeLow], y: [ex.J('mae', ex.bo.maeLow)], name: `中位數 ${f(ex.bo.maeLow)}`, mode: 'markers', marker: { size: 11, color: tokens.series[1] } },
      { x: [ex.hub], y: [ex.J('huber', ex.hub)], name: `Huber ${f(ex.hub, 4)}`, mode: 'markers', marker: { size: 11, color: tokens.series[2] } },
    ]
  }, [ex, tokens])

  const lms = useMemo(() => lmsSteadyState(FOUR, MU_SS), [])
  const lattice = useMemo(
    () =>
      (['zero', 'plus', 'minus'] as TieRule[]).map((tie) => ({ tie, r: signErrorLatticeStationary(FOUR, { w0: 0, mu: MU_SS, tie })! })),
    [],
  )
  const contam = useMemo(() => {
    const p: LossDataParams = { ...FOUR, model: 'contaminated', a: 0, sigma: CONTAM.sigma, outlierProb: CONTAM.eps, outlierSize: CONTAM.s }
    const o = populationOptima(p, 1)
    return { o, approx: contaminatedMedianApprox(CONTAM.sigma, CONTAM.eps) }
  }, [])

  // §2.3.2：Gaussian 雜訊下 Sign-Error 的抖動——lattice 精確值 vs 擴散近似 √(μ/(4f)) vs 同速度的 LMS
  const jit = useMemo(() => {
    const p: LossDataParams = { ...FOUR, model: 'contaminated', a: 0, sigma: JIT_SIGMA }
    return JIT_MUS.map((mu) => {
      const lat = signErrorLatticeStationary(p, { w0: 0, mu, tie: 'zero' })!
      const ap = signErrorJitterApprox(p, mu)
      const kq = 2 * ap.density // 等效 1-bit 增益 K_q = 2f(m)
      const muLms = mu * kq // 收斂速度相同的 LMS 步長：pole 1 − μ_L = 1 − μK_q
      const lmsVar = lmsSteadyState(p, muLms).variance
      return { mu, latStd: lat.std, apStd: Math.sqrt(ap.variance), kq, muLms, lmsStd: Math.sqrt(lmsVar), ratio: lat.std ** 2 / lmsVar }
    })
  }, [])

  // §2.3.2 的圖：μ = JIT_PLOT_MU 時的精確穩態分布 π(w)（格點鏈）、擴散近似的 Gaussian 與 ±μ 的單步範圍
  const jitPlot = useMemo<Data[]>(() => {
    const p: LossDataParams = { ...FOUR, model: 'contaminated', a: 0, sigma: JIT_SIGMA }
    const mu = JIT_PLOT_MU
    const lat = signErrorLatticeStationary(p, { w0: 0, mu, tie: 'zero' })!
    const v = signErrorJitterApprox(p, mu).variance
    const keep = lat.grid.map((g, i) => ({ g, pk: lat.pi[i] })).filter((q) => Math.abs(q.g) <= 5 * lat.std)
    // 連續近似：π_k ≈ 格點間距 × N(w_k; 0, μ/(4f))
    const gauss = keep.map((q) => (lat.h * Math.exp((-q.g * q.g) / (2 * v))) / Math.sqrt(2 * Math.PI * v))
    return [
      { x: keep.map((q) => q.g), y: keep.map((q) => q.pk), type: 'bar', name: String.raw`精確 $\pi(w)$（格點鏈，$\mu=${mu}$）`, marker: { color: tokens.series[1] } },
      { x: keep.map((q) => q.g), y: gauss, mode: 'lines', name: String.raw`擴散近似 $\mathcal N(0,\ \mu/(4f))$，$\operatorname{std}=${texNum(Math.sqrt(v), 3)}$`, line: { color: tokens.series[3], dash: 'dash' } },
      { x: [-mu, -mu, null, mu, mu], y: [0, lat.piMax, null, 0, lat.piMax], mode: 'lines', name: String.raw`$\pm\mu|x|=\pm${mu}$（單步步長）`, line: { color: tokens.textMuted, dash: 'dot' } },
    ]
  }, [tokens])

  // 估計量效率（Research）：Worker 任務
  const eff = useWorkerTask<EfficiencyParams, EfficiencyResult>('lossCompare', 'estimatorEfficiency', { restartOnRun: true })
  const [effRes, setEffRes] = useState<{ clean: EfficiencyResult; dirty: EfficiencyResult } | null>(null)
  const [effErr, setEffErr] = useState<string | null>(null)
  const runEff = async () => {
    setEffErr(null)
    try {
      const base = { n: 101, trials: 4000, sigma: 1, outlierSize: CONTAM.s, huberDelta: 1.345 }
      const clean = await eff.run({ ...base, outlierProb: 0, seed: 101 })
      const dirty = await eff.run({ ...base, outlierProb: CONTAM.eps, seed: 202 })
      setEffRes({ clean, dirty })
    } catch (e) {
      if (!isWorkerCancelled(e)) setEffErr(e instanceof Error ? e.message : String(e))
    }
  }

  const mseDeriv = (
    <StepDerivation
      title="MSE：令導數為 0，得到平均"
      steps={[
        {
          tex: String.raw`J_{\text{MSE}}(w)=\frac14\sum_{i=1}^4\tfrac12(y_i-w)^2`,
          why: (
            <>
              只估一個常數：<Tex>{String.raw`x\equiv1`}</Tex>，期望值 = 四筆的平均（每筆機率 <Tex>{String.raw`\tfrac14`}</Tex>）。這就是 §1.3 的{' '}
              <Tex>{String.raw`J=\tfrac12J_2`}</Tex>（含 <Tex>{String.raw`\tfrac12`}</Tex>）；為了和 MAE、Huber 並列，本節寫成 <Tex>{String.raw`J_{\text{MSE}}`}</Tex>
            </>
          ),
        },
        {
          tex: String.raw`J_{\text{MSE}}'(w)=\frac14\sum_i(w-y_i)=w-\frac14\sum_iy_i`,
          why: (
            <>
              逐項微分（連鎖律）：<Tex>{String.raw`\tfrac{d}{dw}\tfrac12(y_i-w)^2=(y_i-w)\cdot(-1)=w-y_i`}</Tex>
            </>
          ),
        },
        { tex: String.raw`w^*=\frac14(0+0+0+10)=${texNum(ex.bo.mse, 6)}`, why: '令導數為 0：最佳解是平均值' },
      ]}
    />
  )

  const maeDeriv = (
    <StepDerivation
      title="MAE：導數等於「下面的個數減去上面的個數」"
      steps={[
        { tex: String.raw`J_{\text{MAE}}(w)=\frac14\sum_{i=1}^4|y_i-w|`, why: '把平方換成絕對值' },
        {
          tex: String.raw`\frac{d}{dw}|y_i-w|=\begin{cases}+1,&w>y_i\\-1,&w<y_i\end{cases}`,
          why: (
            <>
              §2.2：<Tex>{'|u|'}</Tex> 的導數是 <Tex>{String.raw`\operatorname{sign}(u)`}</Tex>，<Tex>{'u=y_i-w'}</Tex>，再乘 <Tex>{'du/dw=-1'}</Tex>
            </>
          ),
        },
        {
          tex: String.raw`J_{\text{MAE}}'(w)=\frac{\#\{y_i<w\}-\#\{y_i>w\}}{4}\quad(w\ne y_i)`,
          why: (
            <>
              每個在 <Tex>{'w'}</Tex> 下面的點貢獻 <Tex>{'+1'}</Tex>，上面的貢獻 <Tex>{'-1'}</Tex>
            </>
          ),
        },
        {
          tex: String.raw`J_{\text{MAE}}'(w)=${ex.slopes.map((s) => `${texNum(s.slope, 3)}\\ (w=${s.w})`).join(',\\quad ')}`,
          why: (
            <>
              三個區間 <Tex>{String.raw`(-\infty,0)`}</Tex>、<Tex>{'(0,10)'}</Tex>、<Tex>{String.raw`(10,\infty)`}</Tex> 各代一個點（<code>batchOptima</code> 的資料即時計數）：先下降、過了 0 就上升
            </>
          ),
        },
        {
          tex: String.raw`\partial J_{\text{MAE}}(0)=\tfrac14\Big(\underbrace{0}_{\#\{y_i<0\}}-\underbrace{1}_{\#\{y_i>0\}}+\underbrace{3\cdot[-1,1]}_{\text{三個 }y_i=0}\Big)=\tfrac14[-4,\,2]=\big[-1,\ \tfrac12\big]\ni0`,
          why: (
            <>
              <Tex>{'w=0'}</Tex> 正好踩在三個資料點上：下面沒有點（貢獻 0）、上面有 <Tex>{'y=10'}</Tex> 一個點（貢獻 <Tex>{'-1'}</Tex>），而三個 <Tex>{'y_i=0'}</Tex>{' '}
              各貢獻一整段次梯度 <Tex>{'[-1,1]'}</Tex>（§2.2）。區間相加：<Tex>{String.raw`-1+3\cdot[-1,1]=[-4,2]`}</Tex>。集合含 0 ⇒ 0 是最小值（凸函數的最小值條件{' '}
              <Tex>{String.raw`0\in\partial J`}</Tex>）
            </>
          ),
        },
      ]}
      result={String.raw`w^*_{\text{MAE}}=\operatorname{median}\{0,0,0,10\}=0`}
    />
  )

  const huberDeriv = (
    <StepDerivation
      title={
        <>
          Huber（<Tex>{String.raw`\delta_H=1`}</Tex>）：解 <Tex>{String.raw`\sum_i\psi_H(y_i-w)=0`}</Tex>
        </>
      }
      steps={[
        {
          tex: String.raw`\sum_i\psi_H(y_i-w)=3\,\psi_H(-w)+\psi_H(10-w)`,
          why: (
            <>
              對 <Tex>{'w'}</Tex> 微分 <Tex>{String.raw`\sum_i\rho_H(y_i-w)`}</Tex> 得 <Tex>{String.raw`-\sum_i\psi_H(y_i-w)`}</Tex>，令它為 0；資料是三個 0 和一個 10
            </>
          ),
        },
        {
          tex: String.raw`=3(-w)+1\quad(0\le w\le1)`,
          why: (
            <>
              猜最小值在 <Tex>{'[0,1]'}</Tex>：<Tex>{String.raw`|-w|\le1`}</Tex> 時 <Tex>{String.raw`\psi_H(-w)=-w`}</Tex>；<Tex>{'10-w>1'}</Tex>，被截成 <Tex>{'+1'}</Tex>
            </>
          ),
        },
        {
          tex: String.raw`-3w+1=0\Rightarrow w=\tfrac13\approx${texNum(ex.hub, 6)}`,
          why: (
            <>
              確實落在假設的 <Tex>{'[0,1]'}</Tex> 區間內（自洽）；<code>batchHuber</code> 以二分法得到同一個數
            </>
          ),
        },
      ]}
    />
  )

  const lmsSs = (
    <StepDerivation
      title={
        <>
          LMS（<Tex>{String.raw`x\equiv1`}</Tex>）的穩態平均與抖動
        </>
      }
      steps={[
        {
          tex: String.raw`w_{n+1}=w_n+\mu(y_n-w_n)=(1-\mu)\,w_n+\mu\,y_n`,
          why: (
            <>
              <Tex>{String.raw`x\equiv1`}</Tex> 代入 LMS（<Tex>{'e_n=y_n-w_n'}</Tex>）
            </>
          ),
        },
        {
          tex: String.raw`\begin{aligned}m&=(1-\mu)\,m+\mu E[y]\\&\Rightarrow\ m=E[y]\end{aligned}`,
          why: (
            <>
              兩邊取期望值，穩態時 <Tex>{'E[w_{n+1}]=E[w_n]=m'}</Tex>
            </>
          ),
        },
        {
          tex: String.raw`s^2=(1-\mu)^2s^2+\mu^2\operatorname{Var}(y)`,
          why: (
            <>
              <Tex>{'y_n'}</Tex> 與 <Tex>{'w_n'}</Tex> 獨立（<Tex>{'w_n'}</Tex> 只用到過去的 <Tex>{'y'}</Tex>），變異數相加；穩態時 <Tex>{String.raw`\operatorname{Var}(w_{n+1})=\operatorname{Var}(w_n)=s^2`}</Tex>
            </>
          ),
        },
        {
          tex: String.raw`s^2=\frac{\mu^2\operatorname{Var}(y)}{1-(1-\mu)^2}=\frac{\mu\operatorname{Var}(y)}{2-\mu}`,
          why: (
            <>
              <Tex>{String.raw`1-(1-\mu)^2=\mu(2-\mu)`}</Tex>；需 <Tex>{String.raw`0<\mu<2`}</Tex>（<Tex>{String.raw`|1-\mu|<1`}</Tex>）
            </>
          ),
        },
        {
          tex: String.raw`\operatorname{Var}(y)=E[y^2]-E[y]^2=${texNum(ex.ey2, 6)}-${texNum(ex.bo.mse, 6)}^2=${texNum(ex.vary, 6)},\quad s=\sqrt{\tfrac{${MU_SS}\times${texNum(ex.vary, 6)}}{2-${MU_SS}}}=${texNum(Math.sqrt(lms.variance), 5)}`,
          why: (
            <>
              <Tex>{String.raw`\mu=${MU_SS}`}</Tex> 的數字（<code>lmsSteadyState</code> 計算）
            </>
          ),
        },
      ]}
    />
  )

  const jitterDeriv = (
    <StepDerivation
      title={
        <>
          連續雜訊下 Sign-Error 的抖動（<Tex>{String.raw`x\equiv1`}</Tex>；<Tex>{'F'}</Tex>、<Tex>{'f'}</Tex> 是 <Tex>{'y'}</Tex> 的 CDF 與密度，<Tex>{'m'}</Tex> 是中位數）
        </>
      }
      steps={[
        {
          tex: String.raw`P(\uparrow\mid w)=P(y>w)=1-F(w),\qquad P(\downarrow\mid w)=P(y<w)=F(w)`,
          why: (
            <>
              Sign-Error：<Tex>{'e=y-w>0'}</Tex> 就往上走 <Tex>{'\\mu'}</Tex>，否則往下；連續分布「剛好相等」的機率是 0，所以這裡不需要 tie 慣例
            </>
          ),
        },
        {
          tex: String.raw`F(w)\approx F(m)+f(m)\,(w-m)=\tfrac12+f(m)\,d,\qquad d:=w-m`,
          why: (
            <>
              泰勒一階展開（<Tex>{"F'=f"}</Tex>）；中位數的定義就是 <Tex>{String.raw`F(m)=\tfrac12`}</Tex>
            </>
          ),
        },
        {
          tex: String.raw`E[s_n\mid d_n]=P(\uparrow)-P(\downarrow)=1-2F(w_n)\approx-2f(m)\,d_n`,
          why: (
            <>
              <Tex>{String.raw`s_n=\pm1`}</Tex> 是這一步的方向。平均方向正比於偏離量、符號相反：像一個增益 <Tex>{String.raw`K_q:=2f(m)`}</Tex> 的線性回授
            </>
          ),
        },
        {
          tex: String.raw`d_{n+1}=d_n+\mu s_n\ \Rightarrow\ d_{n+1}^2=d_n^2+2\mu\,d_ns_n+\mu^2`,
          why: (
            <>
              兩邊平方；<Tex>{'s_n^2=1'}</Tex>（不管往上往下，步長的平方都是 <Tex>{'\\mu^2'}</Tex>）
            </>
          ),
        },
        {
          tex: String.raw`E[d_{n+1}^2]=E[d_n^2]-4\mu f(m)\,E[d_n^2]+\mu^2`,
          why: (
            <>
              取期望值：先固定 <Tex>{'d_n'}</Tex> 對 <Tex>{'s_n'}</Tex> 平均（上一步的結果），再對 <Tex>{'d_n'}</Tex> 平均 ⇒{' '}
              <Tex>{String.raw`E[d_ns_n]=-2f(m)\,E[d_n^2]`}</Tex>
            </>
          ),
        },
        {
          tex: String.raw`4\mu f(m)\,E[d_\infty^2]=\mu^2\ \Rightarrow\ E[d_\infty^2]=\frac{\mu}{4f(m)}`,
          why: (
            <>
              穩態時 <Tex>{String.raw`E[d_{n+1}^2]=E[d_n^2]`}</Tex>：「回授拉回的量」與「每步注入的 <Tex>{'\\mu^2'}</Tex>」平衡
            </>
          ),
        },
        {
          tex: String.raw`f(m)=\frac{1}{\sqrt{2\pi}\,\sigma_v}\ \Rightarrow\ \operatorname{Var}(w_\infty)\approx\frac{\sqrt{2\pi}}{4}\,\mu\sigma_v=\frac{\mu}{2}\sqrt{\frac{\pi}{2}}\,\sigma_v\approx${texNum(Math.sqrt(2 * Math.PI) / 4, 4)}\,\mu\sigma_v`,
          why: (
            <>
              Gaussian 雜訊 <Tex>{String.raw`\mathcal N(0,\sigma_v^2)`}</Tex> 的密度在中心的值（§1.4.1 先備知識的公式代 <Tex>{'t=m'}</Tex>）
            </>
          ),
        },
      ]}
      result={String.raw`\operatorname{Var}(w_\infty)\approx\frac{\mu}{4f(m)}=\frac{\mu}{2K_q},\qquad K_q:=2f(m)`}
    />
  )

  const piOver2 = (
    <StepDerivation
      title={
        <>
          同樣的收斂速度下，只用 1 bit 要付出 <Tex>{String.raw`\pi/2`}</Tex> 倍的變異數（Gaussian 雜訊）
        </>
      }
      steps={[
        {
          tex: String.raw`E[d_{n+1}]\approx(1-\mu K_q)\,E[d_n]`,
          why: (
            <>
              對 <Tex>{String.raw`d_{n+1}=d_n+\mu s_n`}</Tex> 取期望值並用 <Tex>{String.raw`E[s_n\mid d_n]\approx-K_qd_n`}</Tex>：pole 是{' '}
              <Tex>{String.raw`1-\mu K_q`}</Tex>，和步長 <Tex>{String.raw`\mu_L=\mu K_q`}</Tex> 的 Conventional LMS（<Tex>{String.raw`x\equiv1`}</Tex>）一樣快
            </>
          ),
        },
        {
          tex: String.raw`\operatorname{Var}_{\text{LMS}}=\frac{\mu_L\sigma_v^2}{2-\mu_L}\approx\frac{\mu K_q\sigma_v^2}{2}`,
          why: (
            <>
              F-01.15（<Tex>{String.raw`\operatorname{Var}(y)=\sigma_v^2`}</Tex>），小 <Tex>{'\\mu_L'}</Tex> 時分母 <Tex>{String.raw`\approx2`}</Tex>
            </>
          ),
        },
        {
          tex: String.raw`\frac{\operatorname{Var}_{\text{Sign-Error}}}{\operatorname{Var}_{\text{LMS}}}\approx\frac{\mu/(2K_q)}{\mu K_q\sigma_v^2/2}=\frac{1}{K_q^2\sigma_v^2}=\frac{\pi}{2}\approx${texNum(Math.PI / 2, 4)}`,
          why: (
            <>
              代入 <Tex>{String.raw`K_q=2f(m)=\sqrt{2/\pi}/\sigma_v`}</Tex>；<Tex>{'\\mu'}</Tex> 與 <Tex>{'\\sigma_v'}</Tex> 都消掉了
            </>
          ),
        },
      ]}
    />
  )

  const markov = (
    <StepDerivation
      title={
        <>
          Sign-Error 的格點 Markov 鏈（tie 慣例 <Tex>{String.raw`\operatorname{sign}(0)=0`}</Tex>、<Tex>{'w_0=0'}</Tex>）
        </>
      }
      steps={[
        {
          tex: String.raw`w_n\in\{k\mu:k\in\mathbb Z\}`,
          why: (
            <>
              每步只走 <Tex>{String.raw`\pm\mu`}</Tex> 或不動，從 0 出發就永遠在格點上
            </>
          ),
        },
        {
          tex: String.raw`0<w=k\mu<10:\ P(\downarrow)=P(y=0)=\tfrac34,\quad P(\uparrow)=P(y=10)=\tfrac14`,
          why: (
            <>
              <Tex>{'y=0'}</Tex> 給 <Tex>{'e<0'}</Tex>、<Tex>{'y=10'}</Tex> 給 <Tex>{'e>0'}</Tex>（<Tex>{String.raw`w\ge10`}</Tex> 的狀態機率小於{' '}
              <Tex>{String.raw`3^{-10/\mu}`}</Tex>——<Tex>{String.raw`\mu=${MU_SS}`}</Tex> 時是 <Tex>{String.raw`3^{-${Math.round(10 / MU_SS)}}`}</Tex>——以下忽略）
            </>
          ),
        },
        {
          tex: String.raw`w=0:\ P(\text{不動})=\tfrac34\ (e=0,\ \operatorname{sign}(0)=0),\quad P(\uparrow)=\tfrac14`,
          why: (
            <>
              這裡 tie 慣例登場；<Tex>{'w<0'}</Tex> 時兩種 <Tex>{'y'}</Tex> 都讓 <Tex>{'w'}</Tex> 往上，所以負的格點只是暫態
            </>
          ),
        },
        {
          tex: String.raw`\pi_0\cdot\tfrac14=\pi_1\cdot\tfrac34,\qquad \pi_k\cdot\tfrac14=\pi_{k+1}\cdot\tfrac34`,
          why: (
            <>
              流量平衡：長期而言，從 <Tex>{'k'}</Tex> 往上跨的次數 = 從 <Tex>{'k+1'}</Tex> 往下跨的次數
            </>
          ),
        },
        {
          tex: String.raw`\pi_k=\pi_0\,3^{-k},\quad \sum_k\pi_k=\tfrac32\pi_0=1\Rightarrow\pi_0=\tfrac23`,
          why: (
            <>
              等比數列求和 <Tex>{String.raw`\sum_{k\ge0}3^{-k}=\tfrac{1}{1-1/3}=\tfrac32`}</Tex>
            </>
          ),
        },
        {
          tex: String.raw`\overline w=\mu\sum_k k\,\pi_k=\mu\cdot\tfrac23\cdot\sum_k k\,3^{-k}=\mu\cdot\tfrac23\cdot\tfrac34=\tfrac{\mu}{2}`,
          why: (
            <>
              <Tex>{String.raw`\sum_k k\,r^k=\tfrac{r}{(1-r)^2}`}</Tex>（對等比級數微分），<Tex>{String.raw`r=\tfrac13`}</Tex> 時為 <Tex>{String.raw`\tfrac34`}</Tex>
            </>
          ),
        },
      ]}
    />
  )

  return (
    <>
      <Section
        kind="example"
        title={
          <>
            2.3 <Tex>{String.raw`y\in\{0,0,0,10\}`}</Tex>：平均 2.5 vs 中位數 0
          </>
        }
        level={2}
        id="ch01-s23"
      >
        <p>
          規格 §2.3 的例子：只估一個常數 <Tex>{'w'}</Tex>（<Tex>{'x\\equiv1'}</Tex>），資料是 <Tex>{'\\{0,0,0,10\\}'}</Tex>。
          最小平方解是平均 <Tex>{texNum(ex.bo.mse)}</Tex>，最小絕對值解是中位數 <Tex>{texNum(ex.bo.maeLow)}</Tex>。
          <strong>Outlier 抵抗能力與統計最佳解都改變了。</strong> <SourceTag />
        </p>
        <p>
          下面把三種損失在這四筆資料上的平均成本分別記作 <Tex>{String.raw`J_{\text{MSE}}`}</Tex>、<Tex>{String.raw`J_{\text{MAE}}`}</Tex>、
          <Tex>{String.raw`J_{\text{Huber}}`}</Tex>（也就是 <Tex>{String.raw`\rho_2`}</Tex>、<Tex>{String.raw`\rho_1`}</Tex>、<Tex>{String.raw`\rho_H`}</Tex> 的平均；
          <Tex>{String.raw`J_{\text{MSE}}`}</Tex> 就是 §1.3 含 <Tex>{String.raw`\tfrac12`}</Tex> 的 <Tex>{'J'}</Tex>）。找最低點的方法都是「看斜率」，但兩種成本的斜率長得完全不一樣：
        </p>
        <BlockDiagram id="D-01.16">
          先看左邊（MSE）：斜率是 <Tex>{'w'}</Tex> 減平均，解「斜率 = 0」就得到平均 <Tex>{texNum(ex.bo.mse)}</Tex>。再看右邊（MAE）：斜率只跟「<Tex>{'w'}</Tex>{' '}
          下面有幾筆、上面有幾筆」有關，跟資料離多遠無關——上面多就往上移、下面多就往下移，移到斜率由負變正的地方停下來，那就是中位數{' '}
          <Tex>{texNum(ex.bo.maeLow)}</Tex>。outlier <Tex>{'10'}</Tex> 在右邊只算「一筆」，在左邊卻用它的大小去拉平均。圖上右邊的斜率就是 F-01.13 的{' '}
          <Tex>{String.raw`\big(\#\{y_i<w\}-\#\{y_i>w\}\big)/N`}</Tex>，其中 <Tex>{String.raw`\#\{\cdot\}`}</Tex> 表示「滿足括號內條件的資料筆數」、<Tex>{'N=4'}</Tex>。
        </BlockDiagram>
        {atLeast('engineer') ? (
          <>
            {mseDeriv}
            {maeDeriv}
            {huberDeriv}
          </>
        ) : (
          <>
            <Derivation title="MSE $\Rightarrow$ 平均（逐步）" derivation={mseDeriv} level="L0" claim="exact" />
            <Derivation title="MAE $\Rightarrow$ 中位數（逐步）" derivation={maeDeriv} level="L0" claim="exact" />
            <Derivation title="Huber $\Rightarrow\tfrac13$（逐步）" derivation={huberDeriv} level="L0" claim="exact" />
          </>
        )}
        <TexBlock
          id="F-01.13"
          label={
            <>
              MAE 的導數＝計數差（<Tex>{'w'}</Tex> 不等於任何 <Tex>{'y_i'}</Tex>）
            </>
          }
        >
          {String.raw`\frac{d}{dw}\,\frac1N\sum_i|y_i-w|=\frac{\#\{y_i<w\}-\#\{y_i>w\}}{N}`}
        </TexBlock>
        <p>
          <ClaimTag kind="exact" /> 一般化：斜率在 <Tex>{'w'}</Tex> 由小變大時，每越過一個資料點就增加 <Tex>{'2/N'}</Tex>。
          斜率由負轉正的位置——一半的點在下面、一半在上面——就是<strong>中位數</strong>。<Tex>{'N'}</Tex> 為奇數時唯一；<Tex>{'N'}</Tex> 為偶數且中間兩個值不同時，
          兩者之間斜率剛好是 0，<strong>整段都是最小值</strong>（例如 <Tex>{'\\{0,10\\}'}</Tex> 的 <Tex>{'[0,10]'}</Tex>）。
          一般 <Tex>{'x_i'}</Tex> 時把 <Tex>{String.raw`|y_i-wx_i|=|x_i|\,|y_i/x_i-w|`}</Tex> 看成加權，最佳解是加權中位數：
        </p>
        <TexBlock
          id="F-01.14"
          label={
            <>
              一般 <Tex>{'x'}</Tex>：加權中位數
            </>
          }
        >
          {String.raw`w_{L1}=\operatorname{wmedian}\Big(\tfrac{y_i}{x_i};\ |x_i|\Big)`}
        </TexBlock>
        <Plot
          title="同一組資料的三種成本 $J(w)$"
          ariaLabel="同一組資料的三種成本 J(w)：MSE、MAE、Huber"
          data={costPlot}
          layout={{ xaxis: { title: { text: '$w$' } }, yaxis: { title: { text: '$J(w)$' } } }}
          height={300}
          csvName="ch01-four-point-cost"
          caption={
            <>
              <Tex>{String.raw`J_{\text{MSE}}`}</Tex> 是平滑拋物線；<Tex>{String.raw`J_{\text{MAE}}`}</Tex> 是折線（在 0 和 10 轉折），最低點在 0；
              <Tex>{String.raw`J_{\text{Huber}}`}</Tex> 的最低點 <Tex>{String.raw`\tfrac13`}</Tex> 在本例落在兩者之間。由 <code>lms.ts</code> 的{' '}
              <code>averageCost</code> 計算。記號：<Tex>{String.raw`J_{\text{MSE}}=E[\rho_2(e)]`}</Tex> 就是 §1.3 含{' '}
              <Tex>{String.raw`\tfrac12`}</Tex> 的 <Tex>{'J'}</Tex>（不是規格沒有 <Tex>{String.raw`\tfrac12`}</Tex> 的 <Tex>{'J_2'}</Tex>）<Erratum id="E41" />。
            </>
          }
        />
        <div className="table-wrap">
          <table className="ch01-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'w'}</Tex>
                </th>
                <th className="num">
                  <Tex>{String.raw`J_{\text{MSE}}(w)`}</Tex>（<Tex>{String.raw`\tfrac12`}</Tex> 平方平均）
                </th>
                <th className="num">
                  <Tex>{String.raw`J_{\text{MAE}}(w)`}</Tex>（絕對值平均）
                </th>
                <th className="num">
                  <Tex>{String.raw`J_{\text{Huber}}(w)`}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {ex.pts.map((w) => (
                <tr key={w}>
                  <td className="num">{f(w, 6)}</td>
                  <td className="num">{f(ex.J('mse', w), 6)}</td>
                  <td className="num">{f(ex.J('mae', w), 6)}</td>
                  <td className="num">{f(ex.J('huber', w), 6)}</td>
                </tr>
              ))}
            </tbody>
            <caption>
              三列分別是平均、中位數與 Huber 解；每一欄的最小值出現在不同的 <Tex>{'w'}</Tex>——「最佳」取決於你選的成本。
            </caption>
          </table>
        </div>
        <ChapterHandCalc id="HC-01.6">
          換四個你自己的數字（記得放一個 outlier）：手算平均與中位數，再挑一個 <Tex>{'w'}</Tex>{' '}
          數一數上下各有幾筆，算出 MAE 成本的斜率。預設的 <Tex>{String.raw`\{0,0,0,10\}`}</Tex> 會重現上表的前兩列。
        </ChapterHandCalc>
        <p>
          <strong>Outlier 的影響力</strong>：把 10 換成 100、1000（由 <code>batchL2 / batchL1 / batchHuber</code> 計算）：
        </p>
        <div className="table-wrap">
          <table className="ch01-table">
            <thead>
              <tr>
                <th>資料</th>
                <th className="num">平均（MSE）</th>
                <th className="num">中位數（MAE）</th>
                <th className="num">
                  Huber（<Tex>{String.raw`\delta_H=1`}</Tex>）
                </th>
              </tr>
            </thead>
            <tbody>
              {ex.influence.map((r) => (
                <tr key={r.s}>
                  <td className="mono">[0, 0, 0, {r.s}]</td>
                  <td className="num">{f(r.mean, 6)}</td>
                  <td className="num">{f(r.median, 6)}</td>
                  <td className="num">{f(r.huber, 6)}</td>
                </tr>
              ))}
            </tbody>
            <caption>
              平均跟著 outlier 無限制地跑；中位數不動；Huber 停在 <Tex>{String.raw`\tfrac13`}</Tex>（<Tex>{'\\psi_H'}</Tex> 被截在{' '}
              <Tex>{String.raw`\pm\delta_H`}</Tex>，影響力有上限：bounded influence）。
            </caption>
          </table>
        </div>
        <CodeBlock
          source={lossSrc}
          region="batchOptima"
          path="src/simulation/models/lossCompare.ts"
          title="三種批次最佳解（一般 $x$ 版本）"
          caption="lms.ts 的 core:batchOptima 是 $x\equiv1$ 的特例（Engineer 模式顯示於下方），兩者在本例給出相同答案。"
        />
        <ModeGate min="engineer">
          <CodeBlock source={lmsSrc} region="batchOptima" path="src/simulation/models/lms.ts" title="$x\equiv1$ 的特例（Ch00–Ch03 共用）" />
        </ModeGate>
      </Section>

      <Section kind="formula" title="2.3.1 逐筆更新會停在哪裡？LMS → 平均、Sign-Error → 中位數" level={3} id="ch01-s231">
        <p>
          LMS 與 Sign-Error 都是一筆一筆隨機抽資料（這裡從 <Tex>{String.raw`\{0,0,0,10\}`}</Tex> 等機率抽、<Tex>{String.raw`x\equiv1`}</Tex>）。
          <strong>平均更新量由正轉負的地方</strong>就是它們的「目標」——左邊平均往上推、右邊平均往下推。先把兩個迴路畫出來：
        </p>
        <BlockDiagram id="D-01.17">
          先看兩列共同的部分：量測 <Tex>{'y_n'}</Tex> 減掉暫存器裡的 <Tex>{'w_n'}</Tex> 得到誤差 <Tex>{'e_n'}</Tex>，乘上 <Tex>{'\\mu'}</Tex> 後累加回 <Tex>{'w'}</Tex>。再看唯一不同的藍色那一格：
          上面讓 <Tex>{'e_n'}</Tex> 原樣通過，所以每步走 <Tex>{String.raw`\mu e_n`}</Tex>，離得遠走得多——它是一個會慢慢忘掉舊資料的平均器，停在平均。下面只留{' '}
          <Tex>{String.raw`\operatorname{sign}(e_n)`}</Tex>，每步固定走 <Tex>{String.raw`\pm\mu`}</Tex>——它像一個上下數的計數器，往上與往下的次數一樣多時才不再漂移，那個位置是中位數。
          圖上兩列的平均更新量就是下面兩條式子：上面是 <Tex>{String.raw`\mu E[y-w]`}</Tex>，下面是 <Tex>{String.raw`\mu E[\operatorname{sign}(y-w)]`}</Tex>。
        </BlockDiagram>
        <p className="small">
          下面式子裡的 <Tex>{String.raw`P(\cdot)`}</Tex> 是事件的機率（重複很多次時該事件發生的比例）：從 <Tex>{String.raw`\{0,0,0,10\}`}</Tex> 等機率抽一筆，
          <Tex>{String.raw`P(y=0)=\tfrac34`}</Tex>、<Tex>{String.raw`P(y=10)=\tfrac14`}</Tex>。
        </p>
        <TexBlock
          label={
            <>
              Conventional LMS：平均更新量是 <Tex>{'w'}</Tex> 的連續函數，在平均值剛好為 0
            </>
          }
        >
          {String.raw`E[\Delta w]=\mu\,E[y-w]=\mu\,(E[y]-w)=0\iff w=E[y]=${texNum(ex.bo.mse)}`}
        </TexBlock>
        <TexBlock label="Sign-Error LMS：平均更新量是階梯函數，在中位數「跳過」0（由正變負）">
          {String.raw`E[\Delta w]=\mu\,E[\operatorname{sign}(y-w)]=\mu\big(P(y>w)-P(y<w)\big)=\begin{cases}+\mu,&w<0\\[2pt] -\tfrac{\mu}{2},&0<w<10\\[2pt] -\mu,&w>10\end{cases}`}
        </TexBlock>
        <p className="small">
          注意 Sign-Error 的平均更新量<strong>沒有任何一點剛好等於 0</strong>：<Tex>{'w<0'}</Tex> 時四筆都在上面（<Tex>{String.raw`P(y>w)-P(y<w)=1-0`}</Tex>），
          <Tex>{'0<w<10'}</Tex> 時三筆在下面、一筆在上面（<Tex>{String.raw`\tfrac14-\tfrac34=-\tfrac12`}</Tex>）。它在 <Tex>{'w=0'}</Tex> 由正跳到負，
          這正是 §2.3 的「<Tex>{String.raw`0\in\partial J_{\text{MAE}}(0)`}</Tex>」：中位數是變號點，不是零點。剛好站在 <Tex>{'w=0'}</Tex> 上的那一步怎麼走，就由{' '}
          <Tex>{String.raw`\operatorname{sign}(0)`}</Tex> 慣例決定（<Tex>{String.raw`+\tfrac{\mu}{4}`}</Tex>、<Tex>{String.raw`+\mu`}</Tex> 或{' '}
          <Tex>{String.raw`-\tfrac{\mu}{2}`}</Tex>，分別對應 <Tex>{String.raw`\operatorname{sign}(0)=0,+1,-1`}</Tex>）。
        </p>
        <p>但固定步長不會「停」在目標上，而是在附近抖動。抖多少可以精確算出來：</p>
        {atLeast('engineer') ? lmsSs : <Derivation title="LMS 穩態推導" derivation={lmsSs} level="L0" claim="exact" />}
        <TexBlock
          id="F-01.15"
          label={
            <>
              LMS 穩態（<Tex>{String.raw`x\equiv1`}</Tex>，<Tex>{'y'}</Tex> iid）
            </>
          }
        >
          {String.raw`E[w_\infty]=E[y],\qquad \operatorname{Var}(w_\infty)=\frac{\mu\operatorname{Var}(y)}{2-\mu}`}
        </TexBlock>
        <p className="small">
          <ClaimTag kind="exact" /> 這是精確式而非近似：資料 iid 時 <Tex>{'w_n'}</Tex> 只由 <Tex>{String.raw`y_0,\dots,y_{n-1}`}</Tex> 決定，與{' '}
          <Tex>{'y_n'}</Tex> 自動獨立 <Erratum id="E38" />。若資料有時間相關（例如 Part B 的 <Tex>{'u=h*x'}</Tex>），同一公式才降為
          independence approximation <ClaimTag kind="approx" />。數字：<Tex>{String.raw`\mu=${MU_SS}\Rightarrow E[w_\infty]=${texNum(lms.mean)},\ \operatorname{std}=${texNum(Math.sqrt(lms.variance), 5)}`}</Tex>。
        </p>
        <ModeGate min="engineer">
          <CodeBlock
            source={lossSrc}
            region="lmsSteadyState"
            path="src/simulation/models/lossCompare.ts"
            title="LMS 穩態的封閉式（MSE vs MAE Lab 的 analytic 交叉比對用的就是它）"
            caption="$x\equiv A$ 用 F-01.15（$A=1$ 時）；$x$ 零均值（$\pm A$、Gaussian）用勘誤 E42 的 MSD 公式。"
          />
        </ModeGate>
        <p>
          Sign-Error 每步只走 <Tex>{'\\pm\\mu|x|'}</Tex>。這組資料在中位數 0 上有 <Tex>{String.raw`\tfrac34`}</Tex> 的點質量（point mass：有正的機率「剛好等於」這個值）：只要 <Tex>{'w'}</Tex>{' '}
          離開 0，每一步就以 <Tex>{String.raw`\tfrac34`}</Tex> 的機率被拉回，所以停在第 <Tex>{'k'}</Tex> 格的機率以 <Tex>{'3^{-k}'}</Tex> 衰減——它困在中位數附近
          <strong>
            約 <Tex>{String.raw`\pm\mu|x|`}</Tex> 的帶
          </strong>
          內。把 <Tex>{'w_n'}</Tex> 長時間的平均記作 <Tex>{String.raw`\overline w`}</Tex>（時間平均），它與中位數的差是 <Tex>{String.raw`O(\mu|x|)`}</Tex>{' '}
          <Erratum id="E40" />。把「在哪一格、下一步往哪走」畫成狀態圖最清楚（<Tex>{'w_0=0'}</Tex>、<Tex>{String.raw`\operatorname{sign}(0)=0`}</Tex>）：
        </p>
        <BlockDiagram id="D-01.18">
          每個圓角方塊是 <Tex>{'w'}</Tex> 可能待的一格（<Tex>{String.raw`0,\ \mu,\ 2\mu,\dots`}</Tex>），箭頭上是走那條路的機率。先看藍色的 <Tex>{'w=0'}</Tex>：抽到 0（機率{' '}
          <Tex>{String.raw`\tfrac34`}</Tex>）時 <Tex>{'e=0'}</Tex>、原地不動，抽到 10（機率 <Tex>{String.raw`\tfrac14`}</Tex>）才往右一格。再看右邊每一格：往左回去的機率都是{' '}
          <Tex>{String.raw`\tfrac34`}</Tex>、往右只有 <Tex>{String.raw`\tfrac14`}</Tex>，所以越右邊越少去，待在第 <Tex>{'k'}</Tex> 格的時間比例是 <Tex>{String.raw`\tfrac23\cdot3^{-k}`}</Tex>。
          把圖上每一格的位置乘上待在那裡的比例再加起來，就是下式右邊 <Tex>{String.raw`\operatorname{sign}(0)=0`}</Tex> 那一列的 <Tex>{String.raw`\overline w=\mu/2`}</Tex>；
          換成另外兩種 tie 慣例，只會改變 <Tex>{'w=0'}</Tex> 那一格的箭頭（Research 模式有完整推導）。
        </BlockDiagram>
        <TexBlock
          id="F-01.16"
          label={
            <>
              Sign-Error 的時間平均（固定步長、中位數唯一；右式需 <Tex>{'w_0'}</Tex> 是 <Tex>{'\\mu'}</Tex> 的整數倍、精確算術）
            </>
          }
        >
          {String.raw`\big|\,\overline{w}-w_{L1}\big|=O(\mu|x|),\qquad y\in\{0,0,0,10\}:\ \overline{w}=\begin{cases}\mu/2,&\operatorname{sign}(0)=0\\ \mu,&\operatorname{sign}(0)=+1\\ 0,&\operatorname{sign}(0)=-1\end{cases}`}
        </TexBlock>
        <p>
          <ClaimTag kind="exact" /> 驗證「時間平均 vs 中位數」的容忍度因此至少要取 <Tex>{'\\mu|x|'}</Tex>，報告中要記錄 tie 慣例與算術（exact／IEEE double／fixed-point）。
          （軌跡本身抖多大是另一回事：這組資料是 <Tex>{String.raw`O(\mu)`}</Tex>，但有連續雜訊時不是——見 §2.3.2。）
          下表由 <code>signErrorLatticeStationary</code> 精確計算（<Tex>{String.raw`\mu=${MU_SS},\ w_0=0`}</Tex>）：
        </p>
        <div className="table-wrap">
          <table className="ch01-table">
            <thead>
              <tr>
                <th>
                  <Tex>{String.raw`\operatorname{sign}(0)`}</Tex> 慣例
                </th>
                <th className="num">
                  時間平均 <Tex>{String.raw`\overline w`}</Tex>
                </th>
                <th className="num">
                  <Tex>{String.raw`\overline w/\mu`}</Tex>
                </th>
                <th className="num">穩態 std</th>
                <th className="num">
                  <Tex>{String.raw`\pi(w=0)`}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {lattice.map(({ tie, r }) => {
                const k0 = r.grid.findIndex((g) => Math.abs(g) < 1e-12)
                return (
                  <tr key={tie}>
                    <td>
                      <Tex>{tie === 'zero' ? '0' : tie === 'plus' ? '+1' : '-1'}</Tex>
                      {tie === 'zero' ? '（數學次梯度）' : '（comparator）'}
                    </td>
                    <td className="num">{f(clean(r.mean), 8)}</td>
                    <td className="num">{f(clean(r.mean / MU_SS), 6)}</td>
                    <td className="num">{f(r.std, 5)}</td>
                    <td className="num">{k0 >= 0 ? f(r.pi[k0], 6) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
            <caption>
              對照 LMS：穩態平均 <Tex>{texNum(lms.mean)}</Tex>、std <Tex>{texNum(Math.sqrt(lms.variance), 4)}</Tex>。Sign-Error 的 std 只有 LMS 的{' '}
              <Tex>{String.raw`1/${texNum(Math.sqrt(lms.variance) / lattice[0].r.std, 3)}`}</Tex>（<Tex>{String.raw`\operatorname{sign}(0)=0`}</Tex>{' '}
              時），而且不被 outlier 10 拉走。
            </caption>
          </table>
        </div>
        <ModeGate min="research">
          <Prereq title="Markov 鏈的穩態分布：只用「流量平衡」">
            <p>
              想像 <Tex>{'w'}</Tex> 在格點上跳來跳去很久。長期下來，「從格點 <Tex>{'k'}</Tex> 往上跳到 <Tex>{'k+1'}</Tex>」的次數，必須和「從{' '}
              <Tex>{'k+1'}</Tex> 往下跳回 <Tex>{'k'}</Tex>」的次數一樣多（否則所有機率都會往一邊堆積）。若 <Tex>{'\\pi_k'}</Tex> 是待在{' '}
              <Tex>{'k'}</Tex> 的時間比例（Markov 鏈的穩態分布）、<Tex>{'u_k'}</Tex>、<Tex>{'d_k'}</Tex> 是往上／往下的機率：
            </p>
            <TexBlock>{String.raw`\pi_k\,u_k=\pi_{k+1}\,d_{k+1}\quad\Longrightarrow\quad \frac{\pi_{k+1}}{\pi_k}=\frac{u_k}{d_{k+1}}`}</TexBlock>
            <p className="small">
              只能在相鄰格點間移動（birth–death chain）時這個條件就足以決定整個分布，再用 <Tex>{String.raw`\sum\pi_k=1`}</Tex> 正規化。時間平均 = <Tex>{String.raw`\sum_k w_k\pi_k`}</Tex>。
            </p>
          </Prereq>
          {markov}
          <CodeBlock
            source={lossSrc}
            region="signErrorLattice"
            path="src/simulation/models/lossCompare.ts"
            title="一般資料分布的格點鏈精確解"
            caption="同一套程式也處理 Gaussian 雜訊 + outlier、$x=\pm A$ 的情形；MSE vs MAE Lab 的「lattice 精確值」就是它。"
          />
          <FixedPointNote />
        </ModeGate>
      </Section>

      <Section
        kind="formula"
        title={
          <>
            2.3.2 有連續雜訊時：Sign-Error 的抖動是 <Tex>{String.raw`O(\sqrt{\mu})`}</Tex>，不是 <Tex>{String.raw`O(\mu)`}</Tex>
          </>
        }
        level={3}
        id="ch01-s232"
      >
        <p>
          上一小節「困在 <Tex>{String.raw`\pm\mu|x|`}</Tex> 的帶內」靠的是中位數上的<strong>點質量</strong>（一離開就以 <Tex>{String.raw`\tfrac34`}</Tex> 的機率被拉回）。
          真實量測的雜訊是連續的（例如 Gaussian）：在中位數附近，往上與往下的機率都接近 <Tex>{String.raw`\tfrac12`}</Tex>，回復力很弱，
          <Tex>{'w'}</Tex> 會像隨機遊走一樣晃出去很多格才被拉回。<strong>要分清楚兩件事</strong>：
        </p>
        <ul>
          <li>
            <strong>時間平均</strong>與中位數的差：仍是 <Tex>{String.raw`O(\mu|x|)`}</Tex>（F-01.16、<Erratum id="E40" />）。
          </li>
          <li>
            <strong>軌跡的抖動</strong>（std）：點質量資料是 <Tex>{String.raw`O(\mu|x|)`}</Tex>；連續雜訊是 <Tex>{String.raw`O(\sqrt{\mu})`}</Tex>，遠大於單步步長。
          </li>
        </ul>
        <p className="small">
          <SpecNote title="本章審查補充：勘誤 E40 的數值證據來自有 tie 的離散資料（T01 參數、{0,0,0,10}）；連續雜訊時「±μ|x|」只約束時間平均，不約束軌跡">
            勘誤 E40 的「<Tex>{String.raw`\pm\mu|x|`}</Tex> 帶」指的是時間平均（以及無雜訊／點質量資料的軌跡）；有連續雜訊時軌跡的抖動要用 F-01.18
          </SpecNote>
        </p>
        <Plot
          title="Gaussian 雜訊（$\sigma_v=1$）下 Sign-Error 的精確穩態分布：遠比 $\pm\mu$ 寬"
          ariaLabel="Gaussian 雜訊下 Sign-Error 的精確穩態分布：遠比單步步長寬"
          data={jitPlot}
          layout={{ xaxis: { title: { text: String.raw`$w-\text{中位數}$` } }, yaxis: { title: { text: String.raw`$\pi$（待在該格點的時間比例）` } }, bargap: 0.15 }}
          height={270}
          csvName="ch01-sign-error-jitter"
          caption={
            <>
              長條是格點鏈的精確解（<code>signErrorLatticeStationary</code>），不是模擬直方圖；虛線是下面要推導的近似。兩條點線之間（
              <Tex>{String.raw`\pm\mu`}</Tex>）只佔一小部分機率。
            </>
          }
        />
        <Prereq title="機率密度 $f$ 與累積分布 $F$：連續隨機量的「機率」怎麼算">
          <p>
            連續的隨機量 <Tex>{'y'}</Tex>（例如帶 Gaussian 雜訊的量測）剛好等於某個數的機率是 0，所以改問「不超過 <Tex>{'t'}</Tex> 的機率」：
            <strong>累積分布函數（CDF）</strong> <Tex>{String.raw`F(t)=P(y\le t)`}</Tex>，從 0 單調爬到 1。它的導數{' '}
            <Tex>{String.raw`f(t)=F'(t)`}</Tex> 叫<strong>機率密度（PDF）</strong>：<Tex>{String.raw`P(t<y\le t+dt)\approx f(t)\,dt`}</Tex>，單位是{' '}
            <Tex>{String.raw`1/[y]`}</Tex>。
          </p>
          <ul>
            <li>
              中位數 <Tex>{'m'}</Tex>：<Tex>{String.raw`F(m)=\tfrac12`}</Tex>（一半的機率在下面）。
            </li>
            <li>
              <Tex>{String.raw`P(y>t)=1-F(t)`}</Tex>；在 <Tex>{'m'}</Tex> 附近用泰勒一階：<Tex>{String.raw`F(t)\approx\tfrac12+f(m)(t-m)`}</Tex>。
            </li>
            <li>
              Gaussian <Tex>{String.raw`\mathcal N(m,\sigma^2)`}</Tex>：<Tex>{String.raw`f(m)=\tfrac{1}{\sqrt{2\pi}\,\sigma}`}</Tex>（鐘形曲線的最高點；<Tex>{'\\sigma'}</Tex>{' '}
              越大曲線越矮）。
            </li>
            <li>
              點質量（例如 <Tex>{String.raw`P(y=0)=\tfrac34`}</Tex>）讓 <Tex>{'F'}</Tex> 在該點「跳階」，不可微——沒有密度，下面的推導不適用。
            </li>
          </ul>
        </Prereq>
        <p>
          為什麼會變寬、寬多少？關鍵是把只會輸出 <Tex>{String.raw`\pm1`}</Tex> 的 <Tex>{String.raw`\operatorname{sign}`}</Tex> 拆成兩部分：「平均起來」它像一個固定增益，剩下的當成每一步注入的抖動。
          令 <Tex>{'m'}</Tex> 是資料的中位數、<Tex>{'d_n=w_n-m'}</Tex> 是離中位數多遠，<Tex>{'f(m)'}</Tex> 是資料的機率密度在中位數的值（上面的先備知識框）：
        </p>
        <BlockDiagram id="D-01.19">
          先看藍色方塊：<Tex>{'w'}</Tex> 比中位數高一點（<Tex>{'d_n>0'}</Tex>），往下走的機率就比往上多一點，平均方向是 <Tex>{'-K_qd_n'}</Tex>——
          <Tex>{'K_q=2f(m)'}</Tex> 是 Sign-Error 的等效小訊號增益：雜訊的密度越高（雜訊越小），正負號對位置越敏感。再看另一條進加法點的 <Tex>{String.raw`\xi_n`}</Tex>：每一步的方向{' '}
          <Tex>{'s_n'}</Tex> 終究只能是 <Tex>{'+1'}</Tex> 或 <Tex>{'-1'}</Tex>，扣掉平均後剩下的零均值部分就是它。最後乘上 <Tex>{'\\mu'}</Tex>、累加回去。
          圖上的迴路就是下面推導的兩行：<Tex>{String.raw`d_{n+1}=d_n+\mu s_n`}</Tex> 與 <Tex>{String.raw`E[s_n\mid d_n]\approx-K_qd_n`}</Tex>；回授拉回的量和每步注入的{' '}
          <Tex>{String.raw`\mu^2`}</Tex> 平衡，得到 F-01.18 的 <Tex>{String.raw`\mu/(2K_q)`}</Tex>。
        </BlockDiagram>
        {atLeast('engineer') ? jitterDeriv : <Derivation title="連續雜訊下 Sign-Error 抖動的推導" derivation={jitterDeriv} level="L0" claim="approx" />}
        <TexBlock
          id="F-01.18"
          label={
            <>
              Sign-Error 在連續雜訊下的穩態抖動（小 <Tex>{'\\mu'}</Tex> 的擴散近似 diffusion approximation：把一格一格的隨機遊走看成「線性回復力 + 每步固定能量」；<Tex>{String.raw`f_{\tilde v}(t^*)`}</Tex> 是總雜訊 <Tex>{String.raw`\tilde v=y-ax`}</Tex> 的密度在固定點的值）
            </>
          }
        >
          {String.raw`\boxed{\operatorname{Var}(w_\infty)\approx\frac{\mu}{4f_{\tilde v}(t^*)}=\frac{\mu}{2K_q}},\qquad K_q:=2f_{\tilde v}(t^*)\ \overset{\text{Gaussian}}{=}\ \sqrt{\tfrac{2}{\pi}}\,\frac{1}{\sigma_v}`}
        </TexBlock>
        <p>
          <ClaimTag kind="approx" /> 適用條件：(1) 雜訊在固定點有密度（沒有點質量）；(2) 每步在雜訊座標上走的距離遠小於雜訊寬度，
          <Tex>{String.raw`\mu x^2f_{\tilde v}\ll1`}</Tex>（才能把 CDF 線性化）；(3) 穩態抖動的寬度本身也要遠小於雜訊寬度：把 CDF 多展開兩階，固定點落在 Gaussian 主體上、標準化位置{' '}
          <Tex>{String.raw`z=t^*/\sigma_v`}</Tex> 時，近似的 std 比精確值小約 <Tex>{String.raw`\kappa/4`}</Tex>，
          <Tex>{String.raw`\kappa=(1+z^2)\,x^2\operatorname{Var}(w_\infty)/\sigma_v^2`}</Tex>（<Tex>{String.raw`x\equiv A`}</Tex>；<code>signErrorDiffusionKappa</code>）。沒有 outlier 時{' '}
          <Tex>{String.raw`z=0`}</Tex>、<Tex>{String.raw`\kappa=\tfrac{\pi}{2}\mu x^2f_{\tilde v}`}</Tex>，和 (2) 是同一件事；但單邊 outlier 把中位數推到主體的尾巴時{' '}
          <Tex>{String.raw`f_{\tilde v}`}</Tex> 變小，(2) 看起來更容易滿足，近似卻變差——例如 outlier 出現的機率 <Tex>{String.raw`\varepsilon=0.45`}</Tex>、<Tex>{String.raw`\mu=0.2`}</Tex> 時{' '}
          <Tex>{String.raw`\mu f_{\tilde v}\approx0.018`}</Tex>，近似的 std 卻比格點鏈小三成以上。污染資料要看 <Tex>{String.raw`\kappa`}</Tex>（§2.6.1 的綜合手算以{' '}
          <Tex>{String.raw`\kappa\le0.2`}</Tex> 為界）。一般的 <Tex>{'x'}</Tex>（<Tex>{String.raw`x\equiv A`}</Tex>、<Tex>{String.raw`\pm A`}</Tex>、Gaussian）代入同樣的推導，
          漂移與每步能量都多一個 <Tex>{'E[x^2]'}</Tex>，相除後消掉——結果與 <Tex>{'|x|'}</Tex> 無關（見 <code>core:signErrorJitter</code> 的註解；
          <Tex>{String.raw`x\equiv A`}</Tex> 時 <Tex>{'t^*'}</Tex> 是雜訊的中位數，<Tex>{'x'}</Tex> 零均值時 <Tex>{'t^*=0'}</Tex>）。下表用格點鏈的<strong>精確</strong> std 驗證（
          <Tex>{String.raw`\sigma_v=${JIT_SIGMA},\ x\equiv1`}</Tex>）：
        </p>
        <div className="table-wrap">
          <table className="ch01-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'\\mu'}</Tex>（= 單步步長）
                </th>
                <th className="num">精確 std（格點鏈）</th>
                <th className="num">
                  近似 <Tex>{String.raw`\sqrt{\mu/(4f)}`}</Tex>
                </th>
                <th className="num">
                  std <Tex>{'/\\mu'}</Tex>
                </th>
                <th className="num">
                  同速度 LMS 的 std（<Tex>{String.raw`\mu_L=\mu K_q`}</Tex>）
                </th>
                <th className="num">
                  <Tex>{String.raw`\operatorname{Var}_{\text{SE}}/\operatorname{Var}_{\text{LMS}}`}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {jit.map((r) => (
                <tr key={r.mu}>
                  <td className="num">{r.mu}</td>
                  <td className="num">{f(r.latStd, 4)}</td>
                  <td className="num">{f(r.apStd, 4)}</td>
                  <td className="num">{f(r.latStd / r.mu, 3)}</td>
                  <td className="num">{f(r.lmsStd, 4)}</td>
                  <td className="num">{f(r.ratio, 4)}</td>
                </tr>
              ))}
            </tbody>
            <caption>
              由 <code>signErrorLatticeStationary</code>（精確）、<code>signErrorJitterApprox</code>（近似）與 <code>lmsSteadyState</code> 即時計算。
              <Tex>{'\\mu'}</Tex> 每縮小 4 倍，std 只縮小約 2 倍（<Tex>{String.raw`\propto\sqrt{\mu}`}</Tex>）；std 是單步步長的{' '}
              <Tex>{texNum(jit[0].latStd / jit[0].mu, 2)}</Tex>～<Tex>{texNum(jit[jit.length - 1].latStd / jit[jit.length - 1].mu, 2)}</Tex> 倍，
              <Tex>{'\\mu'}</Tex> 越小差越多。「同速度 LMS」是步長 <Tex>{String.raw`\mu_L=\mu K_q`}</Tex> 的 Conventional LMS（平均收斂得和 Sign-Error 一樣快）；
              最後一欄隨 <Tex>{'\\mu\\to0'}</Tex> 趨近 <Tex>{String.raw`\pi/2\approx${texNum(Math.PI / 2, 4)}`}</Tex>——只用 1 bit 的代價。
            </caption>
          </table>
        </div>
        <ModeGate min="engineer">
          {piOver2}
          <p className="small">
            <ClaimTag kind="approx" /> 這個 <Tex>{String.raw`\pi/2`}</Tex>（<Tex>{String.raw`10\log_{10}(\pi/2)\approx${texNum(10 * Math.log10(Math.PI / 2), 3)}\ \mathrm{dB}`}</Tex>）就是「只看正負號」的代價，
            和 §2.4 中位數相對於平均的效率損失是同一個數——Sign-Error LMS 可以看成「線上版的中位數」。單位提醒：Sign-Error 的{' '}
            <Tex>{'\\mu'}</Tex> 單位是 <Tex>{String.raw`[y]/[x]^2`}</Tex>（<Tex>{String.raw`\operatorname{sign}(e)`}</Tex> 無因次），LMS 的 <Tex>{'\\mu_L'}</Tex> 是{' '}
            <Tex>{String.raw`1/[x]^2`}</Tex>；兩者靠 <Tex>{'K_q'}</Tex>（單位 <Tex>{String.raw`1/[y]`}</Tex>）換算：<Tex>{String.raw`\mu_L=\mu K_q`}</Tex>。
          </p>
          <CodeBlock
            source={lossSrc}
            region="signErrorJitter"
            path="src/simulation/models/lossCompare.ts"
            title="擴散近似（一般 $x$ 的版本；MSE vs MAE Lab 的「擴散近似」指標）"
          />
        </ModeGate>
        <ChapterHandCalc id="HC-01.7">
          用你自己的 <Tex>{'\\mu'}</Tex> 與 <Tex>{'\\sigma_v'}</Tex> 重算上表的一列：先求 <Tex>{'K_q'}</Tex>，再算 Sign-Error 的抖動、它是單步步長的幾倍，以及和「同速度
          LMS」相比多付了多少（需要 <Tex>{'\\pi'}</Tex> 與開根號）。預設 <Tex>{String.raw`\sigma_v=1,\ \mu=0.05`}</Tex> 是表中間那一列。
        </ChapterHandCalc>
        <PllLink>
          這就是 PLL 校正迴路的日常：comparator 前的雜訊（例如 100 fs RMS）遠大於要校正的誤差，<Tex>{String.raw`K_q=\sqrt{2/\pi}/\sigma_v`}</Tex> 正是{' '}
          <Link to="/ch/05">Ch05</Link> 的 comparator 等效小訊號增益（T04：<Tex>{String.raw`\sigma_v=100\ \mathrm{fs}\Rightarrow K_q\approx${texNum(Math.sqrt(2 / Math.PI) / 100, 4)}\ \mathrm{fs}^{-1}`}</Tex>），而{' '}
          <Tex>{String.raw`\operatorname{Var}(w)\approx\mu/(2K_q)`}</Tex> 再除以 GMAC 的累加長度 <Tex>{'N'}</Tex>，就是 <Link to="/ch/12">Ch12</Link> 係數雜訊{' '}
          <Tex>{String.raw`\sigma_w`}</Tex> 的小增益近似。所以「雜訊夠大時 Sign-Error 像縮放過的 LMS」不是巧合：雜訊把 <Tex>{String.raw`\operatorname{sign}(\cdot)`}</Tex>{' '}
          的階梯「抹平」成斜率 <Tex>{'K_q'}</Tex> 的直線。
        </PllLink>
      </Section>

      <ModeGate min="research">
        <Section kind="assumptions" title="2.4 （Research）污染資料下的中位數與估計量效率" level={3} id="ch01-s24">
          <p>
            一般化的情境：<Tex>{String.raw`y=a+v+o`}</Tex>，<Tex>{String.raw`v\sim\mathcal N(0,\sigma^2)`}</Tex>，以機率{' '}
            <Tex>{'\\varepsilon'}</Tex> 出現 <Tex>{'o=+s'}</Tex>。平均被拉到 <Tex>{'a+\\varepsilon s'}</Tex>；中位數 <Tex>{'a+m'}</Tex> 滿足 CDF ={' '}
            <Tex>{String.raw`\tfrac12`}</Tex>：
          </p>
          <BlockDiagram id="D-01.20">
            先看左邊三個來源怎麼加成量測 <Tex>{'y'}</Tex>：真值 <Tex>{'a'}</Tex>、Gaussian 雜訊 <Tex>{'v'}</Tex>，以及偶爾出現的 outlier <Tex>{'o'}</Tex>（機率{' '}
            <Tex>{'\\varepsilon'}</Tex> 是 <Tex>{'+s'}</Tex>，其餘時候是 0）。再看右邊兩種目標：平均（紅色）被拉走 <Tex>{String.raw`\varepsilon s`}</Tex>，outlier 多大就拉多遠；
            中位數（綠色）只被拉走 <Tex>{'m'}</Tex>，因為它只在乎 outlier 佔了幾成、不在乎多大。圖上的 <Tex>{'m'}</Tex> 就是下式要解的未知數。
          </BlockDiagram>
          <TexBlock id="F-01.17" label="單邊污染的中位數">
            {String.raw`(1-\varepsilon)\,\Phi\!\Big(\frac{m}{\sigma}\Big)+\varepsilon\,\Phi\!\Big(\frac{m-s}{\sigma}\Big)=\tfrac12\ \xrightarrow{s\gg\sigma}\ m\approx\sigma\,\Phi^{-1}\!\Big(\frac{1}{2(1-\varepsilon)}\Big)`}
          </TexBlock>
          <p>
            <ClaimTag kind="exact" />（左式，二分法求根）／<ClaimTag kind="approx" />（右式）。
            <Tex>{String.raw`\sigma=${CONTAM.sigma},\ \varepsilon=${CONTAM.eps},\ s=${CONTAM.s}`}</Tex>：
            平均偏移 <Tex>{texNum(contam.o.l2, 6)}</Tex>，中位數偏移 <Tex>{texNum(contam.o.l1.lo, 6)}</Tex>（近似式{' '}
            <Tex>{texNum(contam.approx, 6)}</Tex>），Huber（<Tex>{String.raw`\delta_H=1`}</Tex>）<Tex>{texNum(contam.o.huber, 6)}</Tex>。只要{' '}
            <Tex>{String.raw`\varepsilon<\tfrac12`}</Tex> 且 <Tex>{String.raw`s\gg\sigma`}</Tex>，中位數的偏移幾乎與 <Tex>{'s'}</Tex> 無關、平均的偏移{' '}
            <Tex>{String.raw`\varepsilon s`}</Tex> 卻隨 <Tex>{'s'}</Tex> 線性成長（中位數的 breakdown point 為 50%）。
          </p>
          <CodeBlock
            source={lossSrc}
            region="populationOptima"
            path="src/simulation/models/lossCompare.ts"
            title="母體最佳解：期望梯度為 0 的點（平均／中位數／Huber 位置）"
          />
          <Prereq title="$\Phi(z)$：標準常態分布的累積機率">
            <p>
              <Tex>{String.raw`\Phi(z)=P(Z\le z)`}</Tex>，<Tex>{String.raw`Z\sim\mathcal N(0,1)`}</Tex>，也就是鐘形曲線{' '}
              <Tex>{String.raw`\tfrac{1}{\sqrt{2\pi}}e^{-t^2/2}`}</Tex> 從 <Tex>{String.raw`-\infty`}</Tex> 積分到 <Tex>{'z'}</Tex> 的面積：<Tex>{String.raw`\Phi(z)=\int_{-\infty}^{z}\tfrac{1}{\sqrt{2\pi}}e^{-t^2/2}\,dt`}</Tex>。<Tex>{'\\Phi(0)=\\tfrac12'}</Tex>；
              <Tex>{'\\Phi^{-1}'}</Tex> 是它的反函數（給機率求 <Tex>{'z'}</Tex>）。若 <Tex>{String.raw`v\sim\mathcal N(0,\sigma^2)`}</Tex>，則{' '}
              <Tex>{String.raw`P(v\le t)=\Phi(t/\sigma)`}</Tex>。
            </p>
          </Prereq>
          <p>
            代價是：沒有 outlier 的乾淨 Gaussian 資料下，中位數比平均「抖」——樣本數 <Tex>{'N'}</Tex> 大時{' '}
            <Tex>{String.raw`\operatorname{Var}(\text{median})/\operatorname{Var}(\text{mean})\to\pi/2\approx1.571`}</Tex>{' '}
            <ClaimTag kind="approx" />（漸近結果）。按下按鈕用 Monte Carlo（Worker，<Tex>{'N=101'}</Tex>、4000 次重複）驗證：
          </p>
          <button type="button" className="btn" onClick={() => void runEff()} disabled={eff.running}>
            {eff.running ? '計算中…' : '執行估計量效率 Monte Carlo'}
          </button>
          {effErr && <p className="small">錯誤：{effErr}</p>}
          {effRes && (
            <div className="table-wrap">
              <table className="ch01-table">
                <thead>
                  <tr>
                    <th>資料</th>
                    <th>估計量</th>
                    <th className="num">平均（偏差）</th>
                    <th className="num">變異數</th>
                    <th className="num">
                      MSE = 偏差<Tex>{'^2'}</Tex> + 變異數
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['clean', <>乾淨 Gaussian</>, effRes.clean],
                      ['dirty', <Tex key="d">{String.raw`\varepsilon=${CONTAM.eps},\ s=${CONTAM.s}`}</Tex>, effRes.dirty],
                    ] as const
                  ).flatMap(([id, label, r]) =>
                    (['mean', 'median', 'huber'] as const).map((k) => (
                      <tr key={`${id}-${k}`}>
                        <td>{label}</td>
                        <td>
                          {k === 'mean' ? '平均' : k === 'median' ? '中位數' : <>Huber（<Tex>{String.raw`\delta_H=1.345`}</Tex>）</>}
                        </td>
                        <td className="num">{f(r[k].avg, 4)}</td>
                        <td className="num">{f(r[k].variance, 4)}</td>
                        <td className="num">{f(r[k].avg ** 2 + r[k].variance, 4)}</td>
                      </tr>
                    )),
                  )}
                </tbody>
                <caption>
                  乾淨資料{' '}
                  <Tex>{String.raw`\operatorname{Var}(\text{median})/\operatorname{Var}(\text{mean})=${texNum(effRes.clean.median.variance / effRes.clean.mean.variance, 4)}`}</Tex>
                  （理論 <Tex>{String.raw`\to\pi/2\approx${texNum(Math.PI / 2, 5)}`}</Tex>）。污染資料下平均的偏差{' '}
                  <Tex>{String.raw`\approx\varepsilon s=${texNum(CONTAM.eps * CONTAM.s)}`}</Tex>，中位數與 Huber 遠勝。真值為 0。
                </caption>
              </table>
            </div>
          )}
        </Section>
      </ModeGate>

      <Section kind="explore" title="2.5 動手：MSE vs MAE Lab" level={2} id="ch01-s25">
        <p>
          同一組資料、三種演算法。預設是 <Tex>{String.raw`\{0,0,0,10\}`}</Tex>、<Tex>{String.raw`\mu=0.2`}</Tex>；切到 contaminated 可以調 outlier 比例{' '}
          <Tex>{'\\varepsilon'}</Tex> 與大小 <Tex>{'s'}</Tex>，也可以換 <Tex>{'x'}</Tex> 的分布。
        </p>
        <MseMaeLab />
      </Section>
    </>
  )
}

/** IEEE double vs 定點整數 code 的 Sign-Error（勘誤 E40） */
function FixedPointNote() {
  return (
    <div>
      <p className="small">
        為什麼需要「定點」版本？lms.ts 的 <code>signErrorStep</code> 是 IEEE double 連加，<Tex>{String.raw`0.2+0.2+0.2-0.2-0.2-0.2`}</Tex>{' '}
        在 double 裡等於 <Tex>{texNum([0.2, 0.2, 0.2, -0.2, -0.2, -0.2].reduce((w, d) => w + d, 0), 3)}</Tex>（即時計算），不會剛好回到 0；
        下面的定點版本把 <Tex>{'w'}</Tex> 存成整數 code <Tex>{'k'}</Tex>（<Tex>{String.raw`w=w_0+k\,\mu|x|`}</Tex>），每步 <Tex>{String.raw`k\pm1`}</Tex>，tie 才會如數學所述地發生：
      </p>
      <CodeBlock source={lossSrc} region="signErrorFixedPoint" path="src/simulation/models/lossCompare.ts" title="定點（整數 code）Sign-Error" />
    </div>
  )
}
