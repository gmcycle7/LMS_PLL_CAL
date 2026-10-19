import { useMemo, useState } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { Callout, ClaimTag, ModeGate, ParamControl, Plot, Prereq, Section, StepDerivation, Tex, TexBlock, mathText, useThemeTokens, ChapterErratum } from '@/components'
import { DEFAULT_RULE, buildPlant, corrMatrix, logspace, tradeoffSweep, type RuleConfig } from '@/simulation/models/mimo'
import { Advanced, Deriv, Fig, FigRef, Hand, TagRow, TryIt, n, tn } from '../common'
import { NUM } from '../numbers'

const rule = (r: Partial<RuleConfig>): RuleConfig => ({ ...DEFAULT_RULE, ...r })

/** 速度 vs 雜訊 trade-off 曲線（解析：analyzeRule + Lyapunov） */
function TradeoffPlot() {
  const tokens = useThemeTokens()
  const [rho, setRho] = useState(0.99)
  const [N, setN] = useState(4096)
  const [sigmaV, setSigmaV] = useState(100)
  const [gammaReg, setGammaReg] = useState(0.5)
  const res = useMemo(() => {
    const plant = buildPlant({ mode: 'R', R: corrMatrix(2, rho), sigmaV, N })
    const scalar = tradeoffSweep(plant, rule({ rule: 'scalar' }), plant.Jn, logspace(1e-3, 0.99 * (2 / (1 + rho)), 60))
    const full = tradeoffSweep(plant, rule({ rule: 'full' }), plant.Jn, logspace(1e-3, 1.0, 60))
    const reg = tradeoffSweep(plant, rule({ rule: 'regularized', regForm: 'R', gamma: gammaReg }), plant.Jn, logspace(1e-5, 100, 80))
    const marks = [
      tradeoffSweep(plant, rule({ rule: 'scalar' }), plant.Jn, [0.5])[0],
      tradeoffSweep(plant, rule({ rule: 'full' }), plant.Jn, [0.5])[0],
      tradeoffSweep(plant, rule({ rule: 'regularized', regForm: 'R', gamma: 0.5 }), plant.Jn, [0.1])[0],
    ]
    return { scalar, full, reg, marks }
  }, [rho, N, sigmaV, gammaReg])
  const data: Data[] = useMemo(() => {
    const xs = (pts: { blocks95: number | null }[]) => pts.map((p) => p.blocks95)
    const ys = (pts: { maxStd: number | null }[]) => pts.map((p) => p.maxStd)
    return [
      { x: xs(res.scalar), y: ys(res.scalar), name: String.raw`一般 LMS（掃 $\mu K_q$）`, mode: 'lines', line: { color: tokens.series[0] } },
      { x: xs(res.full), y: ys(res.full), name: String.raw`完整反矩陣（掃 $\gamma$）`, mode: 'lines', line: { color: tokens.series[1] } },
      { x: xs(res.reg), y: ys(res.reg), name: String.raw`Regularized（$\gamma=${gammaReg}$，掃 $\lambda_{\mathrm{reg}}$）`, mode: 'lines', line: { color: tokens.series[2] } },
      {
        x: xs(res.marks),
        y: ys(res.marks),
        name: String.raw`§10.1 例：$\mu K_q=0.5$ / $\gamma=0.5$ / $\lambda_{\mathrm{reg}}=0.1$`,
        mode: 'text+markers',
        text: res.marks.map((m) => (m.blocks95 === null ? '—' : String(m.blocks95))),
        textposition: 'top center',
        marker: { size: 9, color: [tokens.series[0], tokens.series[1], tokens.series[2]], line: { width: 1, color: tokens.text } },
      },
    ]
  }, [res, gammaReg, tokens])
  const layout = useMemo(() => ({ xaxis: { title: { text: String.raw`$k_{95}$（blocks，越左越快）` } }, yaxis: { title: { text: String.raw`$\max_j\ \operatorname{std}(\delta_j)$（fs，越低越安靜）` } } }), [])
  return (
    <div className="card">
      <TagRow>
        <strong>動手觀察 2：收斂速度 vs 係數雜訊（同一張圖）</strong>
        <ClaimTag kind="approx" />
        <span className="small muted">線性 Gaussian 模型下是精確的 Lyapunov 解；對真正的 1-bit 迴路是近似（需近平衡）</span>
      </TagRow>
      <div className="grid-2">
        <div>
          <ParamControl label={mathText(String.raw`$\rho$（regressor 相關係數）`)} ariaLabel="ρ（regressor 相關係數）" value={rho} onChange={setRho} min={0} max={0.9999} step={0.0001} digits={6} unit="無因次" reg="BEH_RHO" hint={String.raw`$\rho=R_{12}$`} />
          <ParamControl label={mathText('$N$（GMAC block 長度）')} ariaLabel="N（GMAC block 長度）" value={N} onChange={setN} min={16} max={1048576} log integer clampOnBlur reg="REG_GMAC_N[19:0]" unit="samples" />
        </div>
        <div>
          <ParamControl
            label={mathText(String.raw`$\sigma_v$（comparator 前雜訊）`)}
            ariaLabel="σ_v（comparator 前雜訊）"
            value={sigmaV}
            onChange={setSigmaV}
            min={1}
            max={1000}
            log
            unit="fs"
            reg="BEH_SIGMA_V"
            hint={mathText(String.raw`$K_q=\sqrt{2/\pi}/\sigma_v$`)}
          />
          <ParamControl label={mathText(String.raw`$\gamma$（regularized 曲線）`)} ariaLabel="γ（regularized 曲線）" value={gammaReg} onChange={setGammaReg} min={0.01} max={1.99} step={0.01} unit="無因次" reg="REG_CAL_GAMMA" />
        </div>
      </div>
      <Plot
        title="95% 收斂 blocks（$x$）vs 穩態每參數 RMS（$y$）"
        data={data}
        xLog
        yLog
        height={340}
        csvName="ch10-speed-vs-noise"
        layout={layout}
        caption={
          <>
            每條曲線由 <code>tradeoffSweep()</code> 掃描一個超參數，每點解一次離散 Lyapunov 方程（F-10.15）。<Tex>{'y'}</Tex> 軸是{' '}
            <Tex>{String.raw`\max_j\sqrt{\operatorname{Var}(\delta_j)}`}</Tex>。左下角是理想區；沒有任何曲線同時又快又安靜。
          </>
        }
      />
      <TryIt>
        把 <Tex>{'N'}</Tex> 從 4096 改成 65536：三條曲線一起往下平移 4 倍（<Tex>{String.raw`\mathrm{RMS}\propto1/\sqrt N`}</Tex>，<Tex>{String.raw`\sqrt{16}=4`}</Tex>），但形狀不變——
        <Tex>{'N'}</Tex> 只買雜訊、不買速度。再把 <Tex>{String.raw`\rho`}</Tex> 拉到 0.9：完整反矩陣的雜訊懲罰明顯變小，因為 <Tex>{String.raw`\lambda_{\min}`}</Tex> 從 0.01 變成 0.1。
      </TryIt>
    </div>
  )
}

export function S3Noise() {
  const z = NUM.noise
  const r = NUM.rho099
  const kq2N = NUM.Kq * NUM.Kq * z.N * 1.5
  return (
    <>
      <Section kind="formula" title="10.4 代價：Preconditioner 會放大 GMAC Noise" level={2} id="ch10-noise">
        <TagRow>
          <span className="small muted">規格 §10.1</span>
          <ChapterErratum id="E37" />
          <ChapterErratum id="E21" />
          <ClaimTag kind="approx" />
        </TagRow>
        <Callout kind="info" title="直覺">
          <p>
            慢方向之所以慢，是因為 GMAC 在那個方向「看到的訊號」只有 <Tex>{String.raw`K_q\lambda_{\min}\xi`}</Tex> 那麼小（<Tex>{String.raw`\xi`}</Tex> 是誤差沿慢 eigenvector 的分量，§10.3 的模式座標）。反矩陣把這個方向的增益放大{' '}
            <Tex>{String.raw`1/\lambda_{\min}`}</Tex> 倍——<strong>但 GMAC 雜訊在同一個方向也一起被放大</strong>。Preconditioner 可以加速，但不能製造缺失的資訊。
          </p>
        </Callout>
        <p>
          把 <FigRef id="eigen-modes" /> 的其中一條模式迴路單獨拿出來（這次用完整反矩陣），補上 GMAC 雜訊進來的位置，就能看出訊號和雜訊走的路不一樣長：
        </p>
        <Fig id="noise-path">
          先跟著訊號走一圈：模式誤差 <Tex>{String.raw`\xi_i`}</Tex> 先乘 <Tex>{String.raw`K_q\lambda_i`}</Tex>（GMAC 沿這個方向看到的斜率，慢模式只有 <Tex>{String.raw`${tn(r.eig[1])}K_q`}</Tex>），再乘{' '}
          <Tex>{String.raw`\gamma/(K_q\lambda_i)`}</Tex>，兩者相乘剛好是 <Tex>{String.raw`\gamma`}</Tex>，與 <Tex>{String.raw`\lambda_i`}</Tex> 無關——這就是「每個模式一樣快」。再跟著雜訊走：紅色的{' '}
          <Tex>{String.raw`\zeta_i`}</Tex> 從中間的加法點進來，只經過後面那一塊，被乘上 <Tex>{String.raw`\gamma/(K_q\lambda_i)`}</Tex>：慢模式是 <Tex>{String.raw`${tn(r.eigMn[0])}/K_q`}</Tex>，快模式只有{' '}
          <Tex>{String.raw`${tn(r.eigMn[1])}/K_q`}</Tex>。圖上的 <Tex>{String.raw`\zeta_i`}</Tex> 是 GMAC 雜訊 <Tex>{String.raw`\boldsymbol\eta`}</Tex> 沿第 <Tex>{'i'}</Tex> 個 eigenvector 的分量（下面推導第 3 步的{' '}
          <Tex>{String.raw`\boldsymbol\zeta=\mathbf V^T\boldsymbol\eta`}</Tex>），它的變異 <Tex>{String.raw`\lambda_i/N`}</Tex> 是第 5 步；整個迴路寫成式子就是第 6 步的{' '}
          <Tex>{String.raw`\xi_{i,k+1}=(1-\gamma)\xi_{i,k}-\tfrac{\gamma}{K_q\lambda_i}\zeta_{i,k}`}</Tex>，穩態變異就是 F-10.6。
        </Fig>
        <Prereq title="變異數的兩條規則與 AR(1) 的穩態變異">
          <p>
            (1) <Tex>{String.raw`\operatorname{Var}(aX)=a^2\operatorname{Var}(X)`}</Tex>；(2) <Tex>{'X'}</Tex>、<Tex>{'Y'}</Tex> 獨立時{' '}
            <Tex>{String.raw`\operatorname{Var}(X+Y)=\operatorname{Var}X+\operatorname{Var}Y`}</Tex>。對 <Tex>{String.raw`x_{k+1}=p\,x_k+b\,z_k`}</Tex>（<Tex>{String.raw`z_k`}</Tex>{' '}
            白雜訊、變異 <Tex>{String.raw`s^2`}</Tex>、與 <Tex>{String.raw`x_k`}</Tex> 獨立），穩態時 <Tex>{String.raw`\operatorname{Var}(x_{k+1})=\operatorname{Var}(x_k)\equiv V`}</Tex>：
          </p>
          <TexBlock>{String.raw`V=p^2V+b^2s^2\ \Rightarrow\ V=\frac{b^2s^2}{1-p^2}\qquad(|p|<1)`}</TexBlock>
          <p>
            這個「一階 AR（autoregressive：新的值 = 舊的值乘一個數 + 新雜訊）的穩態變異」公式本節會用兩次。向量版本要用共變異矩陣與{' '}
            <Tex>{String.raw`\operatorname{Cov}(\mathbf A\mathbf z)=\mathbf A\operatorname{Cov}(\mathbf z)\mathbf A^T`}</Tex>，見 §10.2 的先備知識框。
          </p>
        </Prereq>
        <Deriv
          title={
            <>
              在 eigen 座標中一步一步算 <Tex>{String.raw`\operatorname{Var}(\xi_i)`}</Tex>（完整 Preconditioner）
            </>
          }
        >
          <StepDerivation
            steps={[
              {
                tex: String.raw`\boldsymbol\delta_{k+1}=\boldsymbol\delta_k-\mathbf M(K_q\mathbf R\boldsymbol\delta_k+\boldsymbol\eta_k),\quad\mathbf M=\gamma(K_q\mathbf R)^{-1}`,
                why: '更新式 + 線性 GMAC 模型（F-10.2）。',
              },
              {
                tex: String.raw`\boldsymbol\delta_{k+1}=(1-\gamma)\boldsymbol\delta_k-\frac{\gamma}{K_q}\mathbf R^{-1}\boldsymbol\eta_k`,
                why: (
                  <>
                    <Tex>{String.raw`K_q\mathbf M\mathbf R=\gamma\mathbf I`}</Tex>；<Tex>{String.raw`\mathbf M\boldsymbol\eta=(\gamma/K_q)\mathbf R^{-1}\boldsymbol\eta`}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`\mathbf R^{-1}=\mathbf V\boldsymbol\Lambda^{-1}\mathbf V^T,\quad\boldsymbol\xi=\mathbf V^T\boldsymbol\delta,\quad\boldsymbol\zeta=\mathbf V^T\boldsymbol\eta`,
                why: (
                  <>
                    <Tex>{String.raw`\mathbf R=\mathbf V\boldsymbol\Lambda\mathbf V^T`}</Tex> ⇒ 反矩陣只是把 <Tex>{String.raw`\lambda_i`}</Tex> 換成 <Tex>{String.raw`1/\lambda_i`}</Tex>；把誤差與雜訊都投影到 eigenvectors。
                  </>
                ),
              },
              {
                tex: String.raw`\boldsymbol\xi_{k+1}=(1-\gamma)\boldsymbol\xi_k-\frac{\gamma}{K_q}\boldsymbol\Lambda^{-1}\boldsymbol\zeta_k`,
                why: (
                  <>
                    兩邊左乘 <Tex>{String.raw`\mathbf V^T`}</Tex>，用 <Tex>{String.raw`\mathbf V^T\mathbf V=\mathbf I`}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`\operatorname{Cov}(\boldsymbol\zeta)=\mathbf V^T\frac{\mathbf R}{N}\mathbf V=\frac{\boldsymbol\Lambda}{N}`,
                why: (
                  <>
                    線性變換規則 <Tex>{String.raw`\operatorname{Cov}(\mathbf A\mathbf z)=\mathbf A\operatorname{Cov}(\mathbf z)\mathbf A^T`}</Tex>（取{' '}
                    <Tex>{String.raw`\mathbf A=\mathbf V^T`}</Tex>）與 <Tex>{String.raw`\operatorname{Cov}(\boldsymbol\eta)\approx\mathbf R/N`}</Tex>（§10.2）；再用{' '}
                    <Tex>{String.raw`\mathbf V^T\mathbf R\mathbf V=\mathbf V^T\mathbf V\boldsymbol\Lambda\mathbf V^T\mathbf V=\boldsymbol\Lambda`}</Tex>。投影後是對角 ⇒ 各模式雜訊互不相關、
                    <Tex>{String.raw`\operatorname{Var}(\zeta_i)=\lambda_i/N`}</Tex>。
                  </>
                ),
              },
              { tex: String.raw`\xi_{i,k+1}=(1-\gamma)\,\xi_{i,k}-\frac{\gamma}{K_q\lambda_i}\,\zeta_{i,k}`, why: '對角 ⇒ 每個模式是一個獨立的一階 AR。' },
              {
                tex: String.raw`\operatorname{Var}(\xi_i)=(1-\gamma)^2\operatorname{Var}(\xi_i)+\frac{\gamma^2}{K_q^2\lambda_i^2}\cdot\frac{\lambda_i}{N}`,
                why: (
                  <>
                    穩態兩邊變異相等；<Tex>{String.raw`\xi_{i,k}`}</Tex> 與 <Tex>{String.raw`\zeta_{i,k}`}</Tex> 獨立（<Tex>{String.raw`\zeta_{i,k}`}</Tex> 來自新的 block）。
                  </>
                ),
              },
              {
                tex: String.raw`\operatorname{Var}(\xi_i)\big[1-(1-\gamma)^2\big]=\frac{\gamma^2}{K_q^2N\lambda_i}`,
                why: (
                  <>
                    移項；<Tex>{String.raw`\lambda_i^2`}</Tex> 約掉一個 <Tex>{String.raw`\lambda_i`}</Tex>。
                  </>
                ),
              },
              { tex: String.raw`1-(1-\gamma)^2=2\gamma-\gamma^2=\gamma(2-\gamma)`, why: '展開平方。' },
              {
                tex: String.raw`\operatorname{Var}(\xi_i)=\frac{\gamma^2}{K_q^2N\lambda_i\,\gamma(2-\gamma)}=\frac{\gamma}{K_q^2N\lambda_i(2-\gamma)}`,
                why: (
                  <>
                    相除，約掉一個 <Tex>{String.raw`\gamma`}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`\operatorname{Cov}(\boldsymbol\delta)=\mathbf V\operatorname{diag}\!\big(\operatorname{Var}(\xi_i)\big)\mathbf V^T=\frac{\gamma}{K_q^2N(2-\gamma)}\,\mathbf V\boldsymbol\Lambda^{-1}\mathbf V^T=\frac{\gamma}{K_q^2N(2-\gamma)}\mathbf R^{-1}`,
                why: (
                  <>
                    轉回參數座標 <Tex>{String.raw`\boldsymbol\delta=\mathbf V\boldsymbol\xi`}</Tex>（各模式互不相關 ⇒ 共變異是對角的）。
                  </>
                ),
              },
            ]}
          />
        </Deriv>
        <TexBlock id="F-10.6" label={mathText('完整 Preconditioning 的穩態變異：第 $i$ 個 eigen-mode（不是第 $i$ 個參數）')}>
          {String.raw`\boxed{\operatorname{Var}(\xi_i)\approx\frac{\gamma}{K_q^2\,N\,\lambda_i\,(2-\gamma)}},\qquad \boxed{\operatorname{Cov}(\boldsymbol\delta)\approx\frac{\gamma}{K_q^2N(2-\gamma)}\,\mathbf R^{-1}}`}
        </TexBlock>
        <Callout
          kind="warn"
          title={
            <>
              勘誤 E37：規格的 <Tex>{String.raw`\delta_i`}</Tex> 指的是模式座標
            </>
          }
        >
          <p>
            規格寫 <Tex>{String.raw`\operatorname{Var}(\delta_i)`}</Tex>，但 §0 與 §10 的下標 i 都指「第 i 個參數」。這裡的 i 其實是第 i 個 eigen-mode：令{' '}
            <Tex>{String.raw`\boldsymbol\xi=\mathbf V^T\boldsymbol\delta`}</Tex>，則 <Tex>{String.raw`\operatorname{Var}(\xi_i)`}</Tex> 才是上式。每個<strong>參數</strong>的變異是{' '}
            <Tex>{String.raw`c\,[\mathbf R^{-1}]_{jj}`}</Tex>、<Tex>{String.raw`c=\gamma/(K_q^2N(2-\gamma))`}</Tex>，兩者數值差很多（見下例）。
            <ChapterErratum id="E37" />
          </p>
        </Callout>

        <h3 className="ch10-sub">
          數字：<Tex>{String.raw`\rho=0.99,\ \gamma=0.5,\ N=${z.N},\ \sigma_v=${NUM.sigmaV}\ \mathrm{fs}`}</Tex>
        </h3>
        <ol>
          <li>
            <Tex>{String.raw`K_q^2N(2-\gamma)=(${tn(NUM.Kq, 6)})^2\times${z.N}\times1.5=${tn(kq2N, 5)}\ \mathrm{fs}^{-2}`}</Tex>，所以{' '}
            <Tex>{String.raw`c=0.5/${tn(kq2N, 5)}=${tn(z.c, 5)}\ \mathrm{fs}^2`}</Tex>。
          </li>
          <li>
            慢模式（<Tex>{String.raw`\lambda_2=${tn(r.eig[1])}`}</Tex>）：<Tex>{String.raw`\operatorname{Var}(\xi_2)=c/${tn(r.eig[1])}=${tn(z.modeVar[1], 5)}\ \mathrm{fs}^2`}</Tex>；快模式（
            <Tex>{String.raw`\lambda_1=${tn(r.eig[0])}`}</Tex>）：<Tex>{String.raw`\operatorname{Var}(\xi_1)=c/${tn(r.eig[0])}=${tn(z.modeVar[0], 4)}\ \mathrm{fs}^2`}</Tex>。
          </li>
          <li>
            每個參數：<Tex>{String.raw`\operatorname{Var}(\delta_j)=c\,[\mathbf R^{-1}]_{jj}=${tn(z.c, 5)}\times${tn(r.Rinv[0][0], 5)}=${tn(z.perParam[0], 4)}\ \mathrm{fs}^2`}</Tex>（RMS{' '}
            {n(Math.sqrt(z.perParam[0]), 4)} fs）。等價地，它是兩個模式變異的平均：<Tex>{String.raw`\tfrac12(${tn(z.modeVar[1], 4)}+${tn(z.modeVar[0], 3)})`}</Tex>（
            <Tex>{String.raw`\mathbf V`}</Tex> 的元素都是 <Tex>{String.raw`\pm1/\sqrt2`}</Tex>）。
          </li>
          <li>
            弱模式 / 強模式的 RMS 比：<Tex>{String.raw`\sigma_{\text{weak}}/\sigma_{\text{strong}}=\sqrt{\lambda_{\max}/\lambda_{\min}}=\sqrt{199}=${tn(z.sqrt199, 4)}`}</Tex>（Lyapunov 數值解{' '}
            <Tex>{String.raw`\sqrt{\operatorname{Var}(\xi_2)/\operatorname{Var}(\xi_1)}=${tn(z.ratioStd, 5)}`}</Tex>）。
          </li>
        </ol>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  更新矩陣（同 <Tex>{String.raw`N=${z.N},\ \sigma_v=${NUM.sigmaV}\ \mathrm{fs}`}</Tex>）
                </th>
                <th className="ch10-num">95% blocks</th>
                <th className="ch10-num">
                  <Tex>{String.raw`\operatorname{Var}(\xi_{\text{slow}})`}</Tex>
                </th>
                <th className="ch10-num">
                  <Tex>{String.raw`\operatorname{Var}(\xi_{\text{fast}})`}</Tex>
                </th>
                <th className="ch10-num">
                  每參數 <Tex>{String.raw`\operatorname{Var}(\delta_j)`}</Tex>
                </th>
                <th className="ch10-num">
                  <Tex>{String.raw`\mathrm{RMS}(\delta_j)`}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  一般 LMS <Tex>{String.raw`\mu K_q=0.5`}</Tex>
                </td>
                <td className="ch10-num">{r.blocksScalar}</td>
                <td className="ch10-num">{n(z.scalarModeVar[1], 4)}</td>
                <td className="ch10-num">{n(z.scalarModeVar[0], 4)}</td>
                <td className="ch10-num">{n(z.scalarPerParam[0], 4)}</td>
                <td className="ch10-num">{n(Math.sqrt(z.scalarPerParam[0]), 4)} fs</td>
              </tr>
              <tr>
                <td>
                  Regularized <Tex>{String.raw`\gamma=0.5,\ \lambda_{\mathrm{reg}}=0.1`}</Tex>
                </td>
                <td className="ch10-num">{r.blocksReg}</td>
                <td className="ch10-num">{n(z.regModeVar[1], 4)}</td>
                <td className="ch10-num">{n(z.regModeVar[0], 4)}</td>
                <td className="ch10-num">{n(z.regPerParam[0], 4)}</td>
                <td className="ch10-num">{n(Math.sqrt(z.regPerParam[0]), 4)} fs</td>
              </tr>
              <tr className="ch10-hl">
                <td>
                  完整反矩陣 <Tex>{String.raw`\gamma=0.5`}</Tex>
                </td>
                <td className="ch10-num">{r.blocksFull}</td>
                <td className="ch10-num">{n(z.modeVar[1], 5)}</td>
                <td className="ch10-num">{n(z.modeVar[0], 4)}</td>
                <td className="ch10-num">{n(z.perParam[0], 4)}</td>
                <td className="ch10-num">{n(Math.sqrt(z.perParam[0]), 4)} fs</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small muted">
          單位 <Tex>{String.raw`\mathrm{fs}^2`}</Tex>。數值由離散 Lyapunov 方程（F-10.15，見下方進階框）解出，並與 F-10.6 / F-10.7 的閉式互相驗證（測試 <code>mimo.test.ts</code>）。完整反矩陣快了{' '}
          {n(r.blocksScalar / r.blocksFull, 4)} 倍，RMS 卻大了 {n(Math.sqrt(z.perParam[0] / z.scalarPerParam[0]), 3)} 倍。
        </p>
        <p>
          <strong>
            勘誤 E21 的比較（<Tex>{'K_q=1'}</Tex>，以 <Tex>{'1/N'}</Tex> 為單位）
          </strong>
          ：慢模式變異 一般 LMS <Tex>{String.raw`${tn(z.perN.scalarSlow, 4)}/N`}</Tex> vs 完整反矩陣 <Tex>{String.raw`${tn(z.perN.fullSlow, 4)}/N`}</Tex>，放大{' '}
          {n(z.perN.fullSlow / z.perN.scalarSlow, 4)} 倍；總變異（trace）<Tex>{String.raw`${tn(z.perN.scalarTrace, 4)}/N`}</Tex> vs <Tex>{String.raw`${tn(z.perN.fullTrace, 4)}/N`}</Tex>，放大{' '}
          {n(z.perN.fullTrace / z.perN.scalarTrace, 3)} 倍
          <ChapterErratum id="E21" />。
        </p>
        <Hand id="HC-10.4">
          預設數字就是上面「數字」那四步（<Tex>{String.raw`c=${tn(z.c, 5)}`}</Tex>、<Tex>{String.raw`${tn(z.modeVar[1], 5)}`}</Tex>／<Tex>{String.raw`${tn(z.modeVar[0], 4)}`}</Tex>、<Tex>{String.raw`\sqrt{199}`}</Tex>、每參數{' '}
          <Tex>{String.raw`${tn(z.perParam[0], 4)}\ \mathrm{fs}^2`}</Tex>）。把 <Tex>{'N'}</Tex> 改成 16384、<Tex>{String.raw`\rho`}</Tex> 改成 0.9，先用紙筆和計算機算一次，再展開步驟對答案——注意哪些量隨{' '}
          <Tex>{'N'}</Tex> 變、哪些只跟 <Tex>{String.raw`\rho`}</Tex> 有關。
        </Hand>

        <Advanced min="engineer" title="一般的模式變異公式（F-10.7）與任何更新矩陣都適用的 Lyapunov 方程（F-10.15）">
          <h3 className="ch10-sub">
            一般公式：任何與 <Tex>{String.raw`\mathbf R`}</Tex> 共用 eigenvectors 的 <Tex>{String.raw`\mathbf M`}</Tex>
          </h3>
          <p>
            若 <Tex>{String.raw`\mathbf M_n=K_q\mathbf M`}</Tex> 沿 <Tex>{String.raw`\mathbf v_i`}</Tex> 的增益是 <Tex>{'m_i'}</Tex>（<Tex>{String.raw`\mathbf M_n\mathbf v_i=m_i\mathbf v_i`}</Tex>），同樣的步驟給出 <Tex>{String.raw`\xi_{i,k+1}=p_i\xi_{i,k}-(m_i/K_q)\zeta_{i,k}`}</Tex>，再用 AR(1) 公式（<Tex>{String.raw`b=m_i/K_q,\ s^2=\lambda_i/N`}</Tex>）：
          </p>
          <TexBlock
            id="F-10.7"
            label={
              <>
                scalar（<Tex>{String.raw`m_i=\mu K_q`}</Tex>）、NLMS（<Tex>{String.raw`m_i=\tilde\mu/\operatorname{tr}\mathbf R`}</Tex>）、full（<Tex>{String.raw`m_i=\gamma/\lambda_i`}</Tex>）、regularized（
                <Tex>{String.raw`m_i=\gamma/(\lambda_i+\lambda_{\mathrm{reg}})`}</Tex>）共用
              </>
            }
          >
            {String.raw`\boxed{\operatorname{Var}(\xi_i)=\frac{m_i^2\,\lambda_i}{K_q^2\,N\,(1-p_i^2)},\qquad p_i=1-m_i\lambda_i}`}
          </TexBlock>
          <p>
            代入 scalar 的 <Tex>{String.raw`m_i=\mu K_q`}</Tex>：<Tex>{String.raw`1-p_i^2=\mu K_q\lambda_i(2-\mu K_q\lambda_i)\Rightarrow\operatorname{Var}(\xi_i)=\mu/\big(K_qN(2-\mu K_q\lambda_i)\big)`}</Tex>
            ——慢模式的雜訊幾乎與 <Tex>{String.raw`\lambda_i`}</Tex> 無關，因為增益沒有被放大。代入 full 的 <Tex>{String.raw`m_i=\gamma/\lambda_i`}</Tex> 就回到 F-10.6。對不共用 eigenvectors 的{' '}
            <Tex>{String.raw`\mathbf M`}</Tex>（diagonal 遇到不等功率、<Tex>{String.raw`\hat{\mathbf J}\ne\mathbf J`}</Tex>、sequential），不能再一個模式一個模式分開算，要直接追蹤整個共變異矩陣{' '}
            <Tex>{String.raw`\mathbf X_k=\operatorname{Cov}(\boldsymbol\delta_k)`}</Tex> 每個 block 怎麼變：
          </p>
          <Fig id="lyapunov">
            先看右邊繞圈的那一路（綠色）：這個 block 的共變異 <Tex>{String.raw`\mathbf X_k`}</Tex> 被迴路矩陣夾成 <Tex>{String.raw`\mathbf A\mathbf X_k\mathbf A^T`}</Tex>（<Tex>{String.raw`\rho(\mathbf A)<1`}</Tex> 時是縮小）。再看左邊進來的那一路（紅色）：新的
            GMAC 雜訊（共變異 <Tex>{String.raw`\mathbf R_x/N`}</Tex>）經過更新矩陣之後變成 <Tex>{String.raw`\mathbf M(\mathbf R_x/N)\mathbf M^T`}</Tex>，加進來。穩態就是「縮掉的」剛好等於「加進來的」：令{' '}
            <Tex>{String.raw`\mathbf X_{k+1}=\mathbf X_k=\mathbf X`}</Tex> 就是下面的 F-10.15（離散 Lyapunov 方程）。它是本節先備知識裡 <Tex>{String.raw`V=p^2V+b^2s^2`}</Tex> 的矩陣版：圖上的{' '}
            <Tex>{String.raw`\mathbf A`}</Tex> 對應 <Tex>{'p'}</Tex>、<Tex>{String.raw`\mathbf M`}</Tex> 對應 <Tex>{'b'}</Tex>、<Tex>{String.raw`\mathbf R_x/N`}</Tex> 對應 <Tex>{'s^2'}</Tex>。
          </Fig>
          <TexBlock
            id="F-10.15"
            label={
              <>
                任何 <Tex>{String.raw`\mathbf M`}</Tex> 的穩態共變異（需 <Tex>{String.raw`\rho(\mathbf A)<1`}</Tex>）
              </>
            }
          >
            {String.raw`\mathbf X=\mathbf A\mathbf X\mathbf A^T+\mathbf M\frac{\mathbf R_x}{N}\mathbf M^T,\qquad\mathbf X=\operatorname{Cov}(\boldsymbol\delta_\infty),\ \ \mathbf A=\mathbf I+\mathbf M\mathbf J`}
          </TexBlock>
          <p className="small muted">
            推導：對 <Tex>{String.raw`\boldsymbol\delta_{k+1}=\mathbf A\boldsymbol\delta_k-\mathbf M\boldsymbol\eta_k`}</Tex> 兩邊取 <Tex>{String.raw`E[\cdot\,\cdot^T]`}</Tex>，交叉項因{' '}
            <Tex>{String.raw`\boldsymbol\eta_k`}</Tex> 與 <Tex>{String.raw`\boldsymbol\delta_k`}</Tex> 獨立而為 0；穩態令 <Tex>{String.raw`\mathbf X_{k+1}=\mathbf X_k`}</Tex>。程式碼{' '}
            <code>dlyap()</code> 直接解這個 <Tex>{'P^2'}</Tex> 維線性方程。
          </p>
        </Advanced>
      </Section>

      <Section
        kind="formula"
        title={
          <>
            10.4.1 Regularized Preconditioner：<Tex>{String.raw`(\mathbf R+\lambda_{\mathrm{reg}}\mathbf I)^{-1}`}</Tex>
          </>
        }
        id="ch10-regularized"
      >
        <TagRow>
          <ChapterErratum id="E22" />
          <ClaimTag kind="exact" />
        </TagRow>
        <p>
          折衷辦法：在求逆之前先加一個小常數 <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex>（規格寫 <Tex>{String.raw`\lambda`}</Tex>，與 eigenvalue 撞名，本章改名 <ChapterErratum id="E22" />）。效果是：大的 eigenvalue 幾乎不受影響，小的 eigenvalue 不再被放大成 <Tex>{String.raw`1/\lambda_i`}</Tex>，最多只放大到 <Tex>{String.raw`1/\lambda_{\mathrm{reg}}`}</Tex>。
        </p>
        <Fig id="reg-compare">
          先看中間三格的增益 <Tex>{'m'}</Tex>：一般 LMS 是 0.5；完整反矩陣把它放大到 <Tex>{String.raw`\gamma/\lambda_{\min}=${tn(r.eigMn[0])}`}</Tex>；regularized（藍色）在分母多加{' '}
          <Tex>{String.raw`\lambda_{\mathrm{reg}}=0.1`}</Tex>，只放大到 <Tex>{String.raw`${tn(0.5 / (r.eig[1] + 0.1))}`}</Tex>。再看右邊的結果：<Tex>{'m'}</Tex> 越大，pole 離 1 越遠（越快），但每個參數的 RMS 也越大。圖上的{' '}
          <Tex>{'m'}</Tex> 就是 F-10.7 的 <Tex>{'m_i'}</Tex>（更新矩陣沿慢 eigenvector 的增益），三個 pole 都是 <Tex>{String.raw`p=1-m\lambda_{\min}`}</Tex>；把 <Tex>{String.raw`m=\gamma/(\lambda_{\min}+\lambda_{\mathrm{reg}})`}</Tex> 代進去就是下面的
          F-10.8。右邊的 RMS 是 §10.4 表格最後一欄（每個參數，不是每個模式）。
        </Fig>
        <Deriv title="poles 與雜訊">
          <StepDerivation
            steps={[
              {
                tex: String.raw`\mathbf M=\gamma\big(K_q(\mathbf R+\lambda_{\mathrm{reg}}\mathbf I)\big)^{-1}`,
                why: (
                  <>
                    定義。<Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex> 與 <Tex>{String.raw`\mathbf R`}</Tex> 同單位（正規化 regressor 時無因次）。
                  </>
                ),
              },
              {
                tex: String.raw`\mathbf R+\lambda_{\mathrm{reg}}\mathbf I=\mathbf V(\boldsymbol\Lambda+\lambda_{\mathrm{reg}}\mathbf I)\mathbf V^T`,
                why: (
                  <>
                    加 <Tex>{String.raw`\lambda_{\mathrm{reg}}\mathbf I=\lambda_{\mathrm{reg}}\mathbf V\mathbf V^T`}</Tex> 不改變 eigenvectors，只把每個 eigenvalue 加 <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`K_q\mathbf M\mathbf R=\gamma\,\mathbf V\operatorname{diag}\!\Big(\frac{\lambda_i}{\lambda_i+\lambda_{\mathrm{reg}}}\Big)\mathbf V^T`,
                why: (
                  <>
                    反矩陣 = <Tex>{String.raw`1/(\lambda_i+\lambda_{\mathrm{reg}})`}</Tex>，再乘 <Tex>{String.raw`\mathbf R`}</Tex> 的 <Tex>{String.raw`\lambda_i`}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`p_i=1-\gamma\frac{\lambda_i}{\lambda_i+\lambda_{\mathrm{reg}}},\qquad m_i=\frac{\gamma}{\lambda_i+\lambda_{\mathrm{reg}}}`,
                why: (
                  <>
                    每個模式的 pole 與增益（<Tex>{String.raw`\mathbf A=\mathbf I-K_q\mathbf M\mathbf R`}</Tex>）；<Tex>{'m_i'}</Tex> 代入 F-10.7 即得雜訊。
                  </>
                ),
              },
            ]}
          />
        </Deriv>
        <TexBlock id="F-10.8" label="Regularized（R 形式）">
          {String.raw`\boxed{p_i=1-\gamma\,\frac{\lambda_i}{\lambda_i+\lambda_{\mathrm{reg}}}}\qquad\begin{cases}\lambda_i\gg\lambda_{\mathrm{reg}}: & p_i\approx1-\gamma\ (\text{像完整反矩陣})\\ \lambda_i\ll\lambda_{\mathrm{reg}}: & p_i\approx1-\gamma\lambda_i/\lambda_{\mathrm{reg}}\ (\text{像 }\mu K_q=\gamma/\lambda_{\mathrm{reg}}\text{ 的 LMS})\end{cases}`}
        </TexBlock>
        <p>
          例：<Tex>{String.raw`\gamma=0.5,\ \lambda_{\mathrm{reg}}=0.1`}</Tex>：慢 pole <Tex>{String.raw`1-0.5\times0.01/0.11=${tn(r.regSlowPole, 6)}`}</Tex>，
          <Tex>{String.raw`k_{95}=${r.blocksReg}`}</Tex>；快 pole <Tex>{String.raw`${tn(r.regFastPole, 4)}`}</Tex>。慢模式增益從 <Tex>{String.raw`\gamma/\lambda_{\min}=${tn(r.eigMn[0], 4)}`}</Tex> 降到{' '}
          <Tex>{String.raw`\gamma/(\lambda_{\min}+\lambda_{\mathrm{reg}})=0.5/0.11=${tn(0.5 / 0.11, 4)}`}</Tex>，雜訊 RMS 從 {n(Math.sqrt(z.perParam[0]), 4)} fs 降到{' '}
          {n(Math.sqrt(z.regPerParam[0]), 4)} fs。<Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex> 等於說「我不相信比 <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex> 小的 eigenvalue，那些方向就慢慢來」。
        </p>
        <Callout
          kind="warn"
          title={
            <>
              兩種 regularizer 的 <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex> 單位不同（勘誤 E22）
            </>
          }
        >
          <p>
            R 形式 <Tex>{String.raw`(\mathbf R+\lambda_{\mathrm{reg}}\mathbf I)^{-1}`}</Tex> 中 <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex> 與 <Tex>{String.raw`\mathbf R`}</Tex> 同尺度；§10.5 的 J 形式{' '}
            <Tex>{String.raw`(\mathbf J^T\mathbf J+\lambda_{\mathrm{reg}}\mathbf I)^{-1}\mathbf J^T`}</Tex> 中 <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex> 與 <Tex>{String.raw`J^2`}</Tex> 同尺度（實體單位{' '}
            <Tex>{String.raw`\mathrm{fs}^{-2}`}</Tex>；匹配模型下 <Tex>{String.raw`\sigma_i=K_q\lambda_i`}</Tex>）。同一個數字 0.1 放進 J 形式（正規化），慢 pole 變成{' '}
            <Tex>{String.raw`1-0.5\cdot10^{-4}/(10^{-4}+0.1)=${tn(r.regJSlowPole, 6)}`}</Tex>，要 {n(r.regJBlocks, 5)} 個 block——完全不同的設計。
          </p>
        </Callout>
        <Hand id="HC-10.5">
          這一題只要四則運算。預設數字是上面的例子（慢模式 <Tex>{String.raw`\lambda_{\min}=0.01,\ \gamma=0.5,\ \lambda_{\mathrm{reg}}=0.1`}</Tex>）：R 形式與 J 形式各算一次。把{' '}
          <Tex>{String.raw`\lambda_i`}</Tex> 換成快模式的 1.99，或把 <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex> 換成 0.01、1，先用紙筆算，再展開步驟看 pole 怎麼在「像完整反矩陣」與「像一般 LMS」之間移動。
        </Hand>

        <ModeGate min="research">
          <Deriv
            title={
              <>
                Research：線性化的有效性指標 <Tex>{String.raw`E[\boldsymbol\delta^T\mathbf R\boldsymbol\delta]/\sigma_v^2`}</Tex>
              </>
            }
            min="research"
          >
            <p>
              所有雜訊公式都假設「近平衡」：殘差 <Tex>{String.raw`\mathbf u^T\boldsymbol\delta`}</Tex> 遠小於 <Tex>{String.raw`\sigma_v`}</Tex>，comparator 增益才等於{' '}
              <Tex>{'K_q'}</Tex>。完整反矩陣下：
            </p>
            <TexBlock>
              {String.raw`\frac{E[\boldsymbol\delta^T\mathbf R\boldsymbol\delta]}{\sigma_v^2}=\frac{\operatorname{tr}(\mathbf R\operatorname{Cov}\boldsymbol\delta)}{\sigma_v^2}=\frac{\gamma\operatorname{tr}(\mathbf R\mathbf R^{-1})}{K_q^2N(2-\gamma)\sigma_v^2}=\frac{P\gamma}{N(2-\gamma)}\cdot\frac{\pi}{2}`}
            </TexBlock>
            <p>
              （第一個等號：<Tex>{String.raw`E[\boldsymbol\delta^T\mathbf R\boldsymbol\delta]=\operatorname{tr}(\mathbf R\,E[\boldsymbol\delta\boldsymbol\delta^T])`}</Tex>；最後用{' '}
              <Tex>{String.raw`K_q^2\sigma_v^2=2/\pi`}</Tex>、<Tex>{String.raw`\operatorname{tr}\mathbf I=P`}</Tex>。）本例 <Tex>{String.raw`P=2,\ \gamma=0.5,\ N=${z.N}`}</Tex>：指標 ={' '}
              {n(z.validityFormula, 4)}（Lyapunov 值 {n(z.validity, 4)}），非常小，公式可信。但 <Tex>{String.raw`\gamma=1.5,\ N=64`}</Tex> 時指標 ={' '}
              <Tex>{String.raw`2\cdot1.5\cdot\pi/(2\cdot64\cdot0.5)=${tn((2 * 1.5 * Math.PI) / (2 * 64 * 0.5), 3)}`}</Tex>，Bussgang 增益壓縮因子約{' '}
              <Tex>{String.raw`1/\sqrt{1+${tn((2 * 1.5 * Math.PI) / (2 * 64 * 0.5), 3)}}=${tn(1 / Math.sqrt(1 + (2 * 1.5 * Math.PI) / (2 * 64 * 0.5)), 3)}`}</Tex>{' '}
              已不可忽略，sample-level 模擬會偏離公式（docs/validation.md 懷疑者的 MC 在此條件下量到變異比 0.835）。實驗中的「有效性指標」就是這個量。
              <ClaimTag kind="approx" />
            </p>
          </Deriv>
        </ModeGate>
      </Section>

      <Section id="ch10-tradeoff-lab" kind="explore" title="動手觀察：速度–雜訊 trade-off">
        <TradeoffPlot />
      </Section>
    </>
  )
}
