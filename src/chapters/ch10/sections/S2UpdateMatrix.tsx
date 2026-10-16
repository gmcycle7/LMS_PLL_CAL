import { useMemo, useState, type ReactNode } from 'react'
import type { Data } from 'plotly.js-dist-min'
import { Callout, ClaimTag, ModeGate, ParamControl, Plot, Section, StepDerivation, Tex, TexBlock, TestBadge, mathText, useThemeTokens, ChRef } from '@/components'
import { DEFAULT_RULE, analyzeRule, buildPlant, corrMatrix, type RuleConfig } from '@/simulation/models/mimo'
import { Deriv, Erratum, Fig, FigRef, Hand, TagRow, TryIt, chop, n, nint, texMat, tn } from '../common'
import { NUM, SIGMA_KQ1 } from '../numbers'

const rule = (r: Partial<RuleConfig>): RuleConfig => ({ ...DEFAULT_RULE, ...r })

/** ρ 滑桿：一般 / 完整反矩陣 / regularized 的主導 pole 與 95% blocks（全部由 analyzeRule 計算，K_q 正規化為 1） */
function RhoWidget() {
  const [rho, setRho] = useState(0.99)
  const [muKq, setMuKq] = useState(0.5)
  const [gamma, setGamma] = useState(0.5)
  const [lambdaReg, setLambdaReg] = useState(0.1)
  const tokens = useThemeTokens()
  const fl = NUM.fastLed

  const rows = useMemo(() => {
    const plant = buildPlant({ mode: 'R', R: corrMatrix(2, rho), sigmaV: SIGMA_KQ1, N: 4096 })
    const cfgs: { key: string; label: ReactNode; cfg: RuleConfig }[] = [
      {
        key: 'scalar',
        label: (
          <>
            一般 LMS（<Tex>{String.raw`\mathbf M=\mu\mathbf I`}</Tex>）
          </>
        ),
        cfg: rule({ rule: 'scalar', muKq }),
      },
      {
        key: 'full',
        label: (
          <>
            完整反矩陣 <Tex>{String.raw`\gamma(K_q\mathbf R)^{-1}`}</Tex>
          </>
        ),
        cfg: rule({ rule: 'full', gamma }),
      },
      {
        key: 'reg',
        label: (
          <>
            Regularized <Tex>{String.raw`\gamma\big(K_q(\mathbf R+\lambda_{\mathrm{reg}}\mathbf I)\big)^{-1}`}</Tex>
          </>
        ),
        cfg: rule({ rule: 'regularized', regForm: 'R', gamma, lambdaReg }),
      },
    ]
    return cfgs.map(({ key, label, cfg }) => {
      const an = analyzeRule(plant, cfg, plant.Jn)
      return { key, label, an }
    })
  }, [rho, muKq, gamma, lambdaReg])

  const curve = useMemo(() => {
    const rhos = Array.from({ length: 120 }, (_, i) => 1 - Math.pow(10, -0.2 - (3.6 * i) / 119)) // 0.37 … 0.99984
    const mk = (cfgOf: () => RuleConfig) =>
      rhos.map((r) => {
        const plant = buildPlant({ mode: 'R', R: corrMatrix(2, r), sigmaV: SIGMA_KQ1, N: 4096 })
        const an = analyzeRule(plant, cfgOf(), plant.Jn)
        return an.ok && an.blocks95 !== null ? an.blocks95 : null
      })
    return {
      x: rhos.map((r) => 1 - r),
      scalar: mk(() => rule({ rule: 'scalar', muKq })),
      full: mk(() => rule({ rule: 'full', gamma })),
      reg: mk(() => rule({ rule: 'regularized', regForm: 'R', gamma, lambdaReg })),
    }
  }, [muKq, gamma, lambdaReg])

  const data: Data[] = useMemo(
    () => [
      { x: curve.x, y: curve.scalar, name: '一般 LMS', mode: 'lines', line: { color: tokens.series[0] } },
      { x: curve.x, y: curve.full, name: '完整反矩陣', mode: 'lines', line: { color: tokens.series[1] } },
      { x: curve.x, y: curve.reg, name: 'Regularized', mode: 'lines', line: { color: tokens.series[2] } },
      {
        x: [1 - rho, 1 - rho, 1 - rho],
        y: rows.map((r) => r.an.blocks95 ?? null),
        name: String.raw`目前 $\rho = ${rho}$`,
        mode: 'markers',
        marker: { size: 9, color: [tokens.series[0], tokens.series[1], tokens.series[2]], line: { width: 1, color: tokens.text } },
      },
    ],
    [curve, rows, rho, tokens],
  )
  const layout = useMemo(() => ({ xaxis: { title: { text: String.raw`$1-\rho$（越往左 regressor 越相關）` } }, yaxis: { title: { text: String.raw`$k_{95}$（blocks）` } } }), [])

  return (
    <div className="card">
      <TagRow>
        <strong>
          動手觀察 1：<Tex>{String.raw`\rho`}</Tex> 滑桿（<Tex>{'K_q'}</Tex> 正規化為 1）
        </strong>
        <ClaimTag kind="exact" />
        <span className="small muted">
          mean recursion（平均誤差的遞迴）、<Tex>{String.raw`\hat{\mathbf J}=\mathbf J`}</Tex>（建構 <Tex>{String.raw`\mathbf M`}</Tex> 用的 Jacobian 估計等於真實值，§10.5）
        </span>
      </TagRow>
      <div className="grid-2">
        <div>
          <ParamControl
            label={mathText(String.raw`$\rho$（regressor 相關係數）`)}
            ariaLabel="ρ（regressor 相關係數）"
            value={rho}
            onChange={setRho}
            min={0}
            max={0.9999}
            step={0.0001}
            digits={6}
            unit="無因次"
            reg="BEH_RHO"
            hint={mathText(String.raw`$\rho=R_{12}$，$\mathbf R=\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}$；$\lambda=1\pm\rho$`)}
          />
          <ParamControl
            label={mathText(String.raw`$\mu K_q$（一般 LMS）`)}
            ariaLabel="μK_q（一般 LMS）"
            value={muKq}
            onChange={setMuKq}
            min={0.001}
            max={2.5}
            step={0.001}
            unit="無因次"
            reg="REG_CAL_MU"
            hint={mathText(String.raw`穩定需 $0<\mu K_q<2/\lambda_{\max}=2/(1+\rho)$`)}
          />
        </div>
        <div>
          <ParamControl
            label={mathText(String.raw`$\gamma$（preconditioned loop gain）`)}
            ariaLabel="γ（preconditioned loop gain）"
            value={gamma}
            onChange={setGamma}
            min={0.001}
            max={1.999}
            step={0.001}
            unit="無因次"
            reg="REG_CAL_GAMMA"
            hint={mathText(String.raw`完整反矩陣時所有 pole $=1-\gamma$`)}
          />
          <ParamControl
            label={mathText(String.raw`$\lambda_{\mathrm{reg}}$（R 形式）`)}
            ariaLabel="λ_reg（R 形式）"
            value={lambdaReg}
            onChange={setLambdaReg}
            min={0}
            max={10}
            step={0.0001}
            unit={String.raw`無因次（$\mathbf R$ 形式）`}
            reg="REG_CAL_LAMBDA_REG"
            hint={mathText(String.raw`與 $\mathbf R$ 同單位（正規化 regressor ⇒ 無因次）；勘誤 E22`)}
          />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>方法</th>
              <th className="ch10-num">
                主導 pole（<Tex>{'|p|'}</Tex> 最大）
              </th>
              <th className="ch10-num">95% 衰減 blocks</th>
              <th className="ch10-num">
                <Tex>{String.raw`\rho(\mathbf I+\mathbf M\mathbf J)`}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label, an }) => (
              <tr key={key}>
                <td>{label}</td>
                <td className="ch10-num">{an.ok && an.poles[0] ? n(chop(an.poles[0].re), 6) : '—'}</td>
                <td className="ch10-num">{an.ok ? an.blocks95 === null ? <span className="ch10-bad">不收斂</span> : nint(an.blocks95) : <span className="ch10-bad">{mathText(an.error)}</span>}</td>
                <td className="ch10-num">{an.ok ? n(chop(an.spectralRadius), 6) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Plot
        title={String.raw`95% 衰減所需 blocks $k_{95}$ vs $1-\rho$（log–log）`}
        ariaLabel="95% 衰減所需 blocks vs 1 − ρ（log–log）"
        data={data}
        xLog
        yLog
        height={300}
        csvName="ch10-blocks-vs-rho"
        layout={layout}
        caption={
          <>
            <Tex>{String.raw`\mu K_q\le1`}</Tex> 時，一般 LMS 的 <Tex>{String.raw`k_{95}\approx\ln0.05/\ln\big(1-\mu K_q(1-\rho)\big)\propto1/(1-\rho)`}</Tex>（慢模式主導）；
            <Tex>{String.raw`\mu K_q>1`}</Tex> 時改由快模式主導，式子裡的 pole 換成 <Tex>{String.raw`|1-\mu K_q(1+\rho)|`}</Tex>，<Tex>{String.raw`\rho\ge2/(\mu K_q)-1`}</Tex> 就不收斂（曲線在那裡中斷）。完整反矩陣與{' '}
            <Tex>{String.raw`\rho`}</Tex> 無關（只要 <Tex>{String.raw`\rho<1`}</Tex>）；regularized 在 <Tex>{String.raw`1-\rho\ll\lambda_{\mathrm{reg}}`}</Tex> 後才開始變慢。
          </>
        }
      />
      <TryIt>
        <Tex>{String.raw`\rho=0.99`}</Tex> 時三列應是{' '}
        <strong>
          {nint(NUM.rho099.blocksScalar)} / {nint(NUM.rho099.blocksFull)} / {nint(NUM.rho099.blocksReg)}
        </strong>
        。把 <Tex>{String.raw`\rho`}</Tex> 拉到 0.9999：一般 LMS 需要約 6 萬個 block；把 <Tex>{String.raw`\mu K_q`}</Tex> 拉到超過{' '}
        <Tex>{String.raw`2/\lambda_{\max}=2/(1+\rho)`}</Tex>（<Tex>{String.raw`\rho=0.99`}</Tex> 時約 1.005），一般 LMS 的快模式 pole 跑到 −1 以下而發散。再把{' '}
        <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex> 調到 0，regularized 就變回完整反矩陣。再試一組：把 <Tex>{String.raw`\rho`}</Tex> 設成 {n(fl.rho)}、<Tex>{String.raw`\mu K_q`}</Tex> 拉到 {n(fl.muKq)}（還在穩定上限{' '}
        <Tex>{String.raw`2/(1+\rho)\approx${tn(fl.muMax)}`}</Tex> 之內）——一般 LMS 那一列的主導 pole 變成 {n(fl.fast)}，是快模式，要 <strong>{nint(fl.blocks)}</strong> 個 block；慢模式自己的 pole 是 {n(fl.slow)}，只要{' '}
        {nint(fl.blocksSlowAlone)} 個。<Tex>{String.raw`\mu K_q`}</Tex> 超過 1 之後，最慢的就不再是 <Tex>{String.raw`\lambda_{\min}`}</Tex> 那個模式。
      </TryIt>
    </div>
  )
}

export function S2UpdateMatrix() {
  const r = NUM.rho099
  const ph = NUM.phys
  const fl = NUM.fastLed
  const nn = NUM.nonNormal
  const sd = NUM.smallSignal
  return (
    <>
      <Section
        kind="formula"
        title={
          <>
            10.3 更新矩陣 <Tex>{String.raw`\mathbf M`}</Tex>：誤差遞迴與 pole
          </>
        }
        level={2}
        id="ch10-update-matrix"
      >
        <TagRow>
          <span className="small muted">規格 §10、§10.1</span>
          <ClaimTag kind="exact" />
        </TagRow>
        <p>
          有了 <Tex>{String.raw`\mathbf G_k\approx K_q\mathbf R\boldsymbol\delta_k+\boldsymbol\eta_k`}</Tex>，一般的多參數更新是
        </p>
        <TexBlock>{String.raw`\mathbf w_{k+1}=\mathbf w_k+\mathbf M\,\mathbf G_k`}</TexBlock>
        <p>
          <Tex>{String.raw`\mathbf M`}</Tex> 是 <Tex>{'P\\times P'}</Tex> 的「更新矩陣」：第 i 列告訴硬體「第 i 個係數要用哪些 GMAC 的輸出、各乘多少」。把上一節的結果和這條更新式接起來，就是一個每個 block 走一圈的迴路：
        </p>
        <Fig id="update-loop">
          先從左邊的加法點看起：<Tex>{String.raw`\boldsymbol\delta_k=\mathbf a-\mathbf w_k`}</Tex>（<Tex>{String.raw`\mathbf w_k`}</Tex> 以負號進來）。往右經過「<Tex>{String.raw`\times K_q\mathbf R`}</Tex>」（上一節的
          F-10.1），再加上 GMAC 雜訊 <Tex>{String.raw`\boldsymbol\eta_k`}</Tex>，得到 <Tex>{String.raw`\mathbf G_k`}</Tex>；乘上藍色的 <Tex>{String.raw`\mathbf M`}</Tex> 後進入右邊的累加器（加法點 +{' '}
          <Tex>{String.raw`z^{-1}`}</Tex>，<Tex>{String.raw`z^{-1}`}</Tex> 代表延遲一個 block），變成 <Tex>{String.raw`\mathbf w_{k+1}`}</Tex>。再看回授：<Tex>{String.raw`\mathbf w`}</Tex> 回到左邊時帶負號，所以繞一圈的增益是{' '}
          <Tex>{String.raw`-K_q\mathbf M\mathbf R`}</Tex>——這就是下面推導出來的 <Tex>{String.raw`\mathbf A_{\mathrm{cal}}=\mathbf I-K_q\mathbf M\mathbf R`}</Tex>。圖上的「<Tex>{String.raw`\times K_q\mathbf R`}</Tex>」就是公式裡的{' '}
          <Tex>{String.raw`-\mathbf J`}</Tex>（<Tex>{String.raw`\mathbf J`}</Tex> 是 GMAC 對 <Tex>{String.raw`\mathbf w`}</Tex> 的斜率，<Tex>{String.raw`\mathbf w`}</Tex> 變大時 <Tex>{String.raw`\mathbf G`}</Tex> 變小，所以帶負號）。
        </Fig>
        <p>
          迴路裡只有 <Tex>{String.raw`\mathbf M`}</Tex> 可以設計。五種常見選擇：
        </p>
        <ul>
          <li>
            <strong>原始 LMS</strong>：<Tex>{String.raw`\mathbf M=\mu\mathbf I`}</Tex>（每個係數只看自己的 GMAC，大家同一個步長 <Tex>{String.raw`\mu`}</Tex>）。
          </li>
          <li>
            <strong>Diagonal</strong>：<Tex>{String.raw`\mathbf M=\operatorname{diag}(\mu_1,\dots,\mu_P)`}</Tex>（每個 loop 各自調步長 <Tex>{String.raw`\mu_i`}</Tex>）。
          </li>
          <li>
            <strong>NLMS</strong>：<Tex>{String.raw`\mathbf M=\tilde\mu/(K_q\operatorname{tr}\mathbf R)\cdot\mathbf I`}</Tex>（用 regressor 總能量 <Tex>{String.raw`\operatorname{tr}\mathbf R`}</Tex> 正規化；<Tex>{String.raw`\tilde\mu`}</Tex>{' '}
            是正規化後的無因次步長，§10.6）。
          </li>
          <li>
            <strong>理想 Preconditioning</strong>：<Tex>{String.raw`\mathbf M=\gamma(K_q\mathbf R)^{-1}`}</Tex>（每個係數用<strong>全部</strong> GMAC 的線性組合；<Tex>{String.raw`\gamma`}</Tex> 是無因次的
            loop gain，意思是「每個 block 把誤差修掉的比例」）。
          </li>
          <li>
            <strong>Noise-robust</strong>：<Tex>{String.raw`\mathbf M=\gamma\big(K_q(\mathbf R+\lambda_{\mathrm{reg}}\mathbf I)\big)^{-1}`}</Tex>（求逆之前先加一個小常數{' '}
            <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex>，叫 regularization 參數，§10.4.1），或對 Jacobian 用 regularized pseudoinverse（§10.5）。
          </li>
        </ul>
        <Fig id="m-variants">
          先看最上面一列（scalar，基準）；再往下逐列比較藍色方塊改了什麼：diagonal 只是把一個 <Tex>{String.raw`\mu`}</Tex> 換成 <Tex>{'P'}</Tex> 個；full inverse 與 regularized 才真的用到「別的」GMAC（
          <Tex>{String.raw`\mathbf M`}</Tex> 有非對角元素）；sequential 則是每個 block 只留一個 <Tex>{String.raw`M_{ii}`}</Tex>，其餘係數凍結（§10.6）。右邊一欄是各自的 pole <Tex>{'p_i'}</Tex>（第{' '}
          <Tex>{'i'}</Tex> 個模式的誤差每個 block 乘上的數）與代價：圖上的 <Tex>{String.raw`\lambda_i`}</Tex> 是 <Tex>{String.raw`\mathbf R`}</Tex> 的 eigenvalue，<Tex>{String.raw`\lambda_{\min}`}</Tex> 是最小的那個；這幾個式子就是本節的
          F-10.3、F-10.4 與 §10.4.1 的 F-10.8。NLMS 沒有另外畫：它仍然是 <Tex>{String.raw`\mu\mathbf I`}</Tex>，只是 <Tex>{String.raw`\mu=\tilde\mu/(K_q\operatorname{tr}\mathbf R)`}</Tex>（§10.6 的 <FigRef id="nlms" />）。
        </Fig>
        <Deriv title="把更新式改寫成誤差的遞迴">
          <StepDerivation
            steps={[
              {
                tex: String.raw`\mathbf a-\mathbf w_{k+1}=\mathbf a-\mathbf w_k-\mathbf M\mathbf G_k`,
                why: (
                  <>
                    兩邊同時被 <Tex>{String.raw`\mathbf a`}</Tex> 減（<Tex>{String.raw`\mathbf a`}</Tex> 是常數）。
                  </>
                ),
              },
              {
                tex: String.raw`\boldsymbol\delta_{k+1}=\boldsymbol\delta_k-\mathbf M\mathbf G_k`,
                why: (
                  <>
                    定義 <Tex>{String.raw`\boldsymbol\delta=\mathbf a-\mathbf w`}</Tex>（全站極性約定）。
                  </>
                ),
              },
              {
                tex: String.raw`\boldsymbol\delta_{k+1}=\boldsymbol\delta_k-\mathbf M(K_q\mathbf R\boldsymbol\delta_k+\boldsymbol\eta_k)`,
                why: (
                  <>
                    代入 <Tex>{String.raw`\mathbf G\approx K_q\mathbf R\boldsymbol\delta+\boldsymbol\eta`}</Tex>（F-10.1）。
                  </>
                ),
              },
              {
                tex: String.raw`\boldsymbol\delta_{k+1}=(\mathbf I-K_q\mathbf M\mathbf R)\,\boldsymbol\delta_k-\mathbf M\boldsymbol\eta_k`,
                why: (
                  <>
                    把 <Tex>{String.raw`\boldsymbol\delta_k`}</Tex> 提出來（矩陣分配律，注意 <Tex>{String.raw`\mathbf M`}</Tex> 在左邊、不可交換）。
                  </>
                ),
              },
              {
                tex: String.raw`\mathbf J\equiv\frac{\partial E[\mathbf G]}{\partial\mathbf w}=-K_q\mathbf R\ \Rightarrow\ \mathbf I-K_q\mathbf M\mathbf R=\mathbf I+\mathbf M\mathbf J`,
                why: (
                  <>
                    <Tex>{String.raw`\mathbf w`}</Tex> 增加 ⇒ <Tex>{String.raw`\boldsymbol\delta`}</Tex> 減少 ⇒ <Tex>{String.raw`\mathbf G`}</Tex> 減少，所以 Jacobian 帶負號。
                  </>
                ),
              },
            ]}
          />
        </Deriv>
        <TexBlock
          id="F-10.2"
          label={
            <>
              一般更新矩陣下的誤差遞迴（<Tex>{String.raw`\mathbf A_{\mathrm{cal}}`}</Tex> 的 eigenvalue = 平均 poles）
            </>
          }
        >
          {String.raw`\boxed{\boldsymbol\delta_{k+1}=\mathbf A_{\mathrm{cal}}\,\boldsymbol\delta_k-\mathbf M\boldsymbol\eta_k,\qquad \mathbf A_{\mathrm{cal}}=\mathbf I-K_q\mathbf M\mathbf R=\mathbf I+\mathbf M\mathbf J}`}
        </TexBlock>
        <p>
          取平均（<Tex>{String.raw`E[\boldsymbol\eta]=0`}</Tex>）得到 <Tex>{String.raw`E[\boldsymbol\delta_{k+1}]=\mathbf A_{\mathrm{cal}}E[\boldsymbol\delta_k]`}</Tex>：
          平均誤差收斂 ⇔ <Tex>{String.raw`\mathbf A_{\mathrm{cal}}`}</Tex> 的所有 eigenvalue 在單位圓內。這是<strong>平均收斂（mean convergence）</strong>，不是「每條軌跡一定收斂」。
        </p>
        <p id="ch10-linear-model-note">
          F-10.2 的等號，是把 F-10.1 的 <Tex>{String.raw`\approx`}</Tex> 當成等式（線性模型 <Tex>{String.raw`\mathbf G=K_q\mathbf R\boldsymbol\delta+\boldsymbol\eta`}</Tex>）之後才有的。真正的 1-bit comparator 只有在小訊號{' '}
          <Tex>{String.raw`|\mathbf u^T\boldsymbol\delta_k|\ll\sigma_v`}</Tex> 時才接近這個模型，所以本章由 <Tex>{String.raw`\mathbf A_{\mathrm{cal}}`}</Tex> 算出來的 pole 與 <Tex>{'k_{95}'}</Tex>（F-10.3、F-10.4、F-10.5、F-10.8、F-10.10、F-10.12）用在 1-bit
          迴路時，都只是小訊號區的局部結果。 <ClaimTag kind="approx" />
        </p>
        <ModeGate min="engineer">
          <p className="small muted">
            多小才算小：看 <Tex>{String.raw`s_\delta=\sqrt{\boldsymbol\delta^T\mathbf R\boldsymbol\delta}/\sigma_v`}</Tex>（<ChRef ch="09">第 9 章</ChRef> F-09.3 的符號；它的平方平均就是 §10.9 的有效性指標）。Gaussian regressor 時 comparator 的平均增益是{' '}
            <Tex>{String.raw`K_q/\sqrt{1+s_\delta^2}`}</Tex>（§10.2 的 F-10.13）：<Tex>{String.raw`s_\delta=${tn(sd.s[0])}`}</Tex> 時比 <Tex>{'K_q'}</Tex> 少 {n(100 * (1 - sd.gain[0]), 2)}%，<Tex>{String.raw`s_\delta=${tn(sd.s[1])}`}</Tex> 少{' '}
            {n(100 * (1 - sd.gain[1]), 2)}%，<Tex>{String.raw`s_\delta=${tn(sd.s[2])}`}</Tex> 少 {n(100 * (1 - sd.gain[2]), 2)}%；每個模式的有效 loop gain 跟著變小。這個條件要對初始誤差成立，也要對迴路自己的穩態抖動成立。
          </p>
        </ModeGate>
        <p className="small muted">
          兩個名字：<Tex>{String.raw`\mathbf A_{\mathrm{cal}}`}</Tex> 叫<strong>校正迴路矩陣</strong>（誤差每個 block 被它乘一次）；<Tex>{String.raw`\mathbf J`}</Tex> 叫 <strong>Jacobian</strong>（斜率矩陣），第{' '}
          <Tex>{'(i,j)'}</Tex> 格是「<Tex>{'w_j'}</Tex> 增加 1 fs 時，GMAC<sub>i</sub> 的平均變化多少」，單位 <Tex>{String.raw`\mathrm{fs}^{-1}`}</Tex>。§10.5 會直接量它。
        </p>

        <h3 className="ch10-sub">
          原始 LMS：<Tex>{String.raw`\mathbf M=\mu\mathbf I`}</Tex> 的 poles
        </h3>
        <p>
          <Tex>{String.raw`\mathbf M=\mu\mathbf I`}</Tex> 時兩個係數仍然透過 <Tex>{String.raw`\mathbf R`}</Tex> 互相耦合，直接盯著 <Tex>{String.raw`\delta_1`}</Tex>、<Tex>{String.raw`\delta_2`}</Tex>{' '}
          很難看出收斂有多快。訣竅是換一組座標：沿著 <Tex>{String.raw`\mathbf R`}</Tex> 的 eigenvector 看，耦合就不見了，剩下幾條各走各的一階迴路。
        </p>
        <Fig id="eigen-modes">
          先看左邊的「<Tex>{String.raw`\times\mathbf V^T`}</Tex>」：它把 <Tex>{String.raw`(\delta_1,\delta_2)`}</Tex> 換成模式座標 <Tex>{String.raw`\boldsymbol\xi=\mathbf V^T\boldsymbol\delta`}</Tex>，也就是共模{' '}
          <Tex>{String.raw`\xi_1=(\delta_1+\delta_2)/\sqrt2`}</Tex> 與差模 <Tex>{String.raw`\xi_2=(\delta_1-\delta_2)/\sqrt2`}</Tex>。再看中間：每個模式每個 block 只是乘上自己的 pole，兩條線不再交叉；最後「
          <Tex>{String.raw`\times\mathbf V`}</Tex>」轉回原來的座標。圖上的「<Tex>{String.raw`\times p_i`}</Tex>」就是下面 F-10.3 的 <Tex>{String.raw`p_i=1-\mu K_q\lambda_i`}</Tex>：圖畫的是 <Tex>{String.raw`\rho\ge0`}</Tex>（本章正文的例子都是），這時 <Tex>{String.raw`\lambda_1=1+\rho`}</Tex> 大，共模很快消失；
          <Tex>{String.raw`\lambda_2=1-\rho`}</Tex> 小，差模（紅色）拖很久（這是步長不太大時的情形，條件寫在 F-10.3 下面）。<Tex>{String.raw`\rho<0`}</Tex> 時兩者對調：<Tex>{String.raw`\lambda_2=1-\rho`}</Tex> 較大，差模快、共模慢；合起來寫是{' '}
          <Tex>{String.raw`\lambda_{\max,\min}=1\pm|\rho|`}</Tex>。這張圖畫的是無雜訊的平均遞迴。
        </Fig>
        <Deriv title="用 eigen 分解把耦合拆開">
          <StepDerivation
            steps={[
              {
                tex: String.raw`\mathbf A_{\mathrm{cal}}=\mathbf I-\mu K_q\mathbf R`,
                why: (
                  <>
                    代入 <Tex>{String.raw`\mathbf M=\mu\mathbf I`}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`=\mathbf V\mathbf V^T-\mu K_q\mathbf V\boldsymbol\Lambda\mathbf V^T`,
                why: (
                  <>
                    <Tex>{String.raw`\mathbf R=\mathbf V\boldsymbol\Lambda\mathbf V^T`}</Tex>，且 <Tex>{String.raw`\mathbf V\mathbf V^T=\mathbf I`}</Tex>（eigenvector 正交）。
                  </>
                ),
              },
              {
                tex: String.raw`=\mathbf V(\mathbf I-\mu K_q\boldsymbol\Lambda)\mathbf V^T`,
                why: (
                  <>
                    左右提出 <Tex>{String.raw`\mathbf V`}</Tex>、<Tex>{String.raw`\mathbf V^T`}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`\boldsymbol\xi_{k+1}=(\mathbf I-\mu K_q\boldsymbol\Lambda)\,\boldsymbol\xi_k,\quad \boldsymbol\xi=\mathbf V^T\boldsymbol\delta`,
                why: (
                  <>
                    兩邊左乘 <Tex>{String.raw`\mathbf V^T`}</Tex>：在 eigen 座標中矩陣是對角的 ⇒ 每個模式各自是一個等比數列。
                  </>
                ),
              },
              { tex: String.raw`\xi_{i,k}=(1-\mu K_q\lambda_i)^k\,\xi_{i,0}`, why: '對角矩陣的 k 次方 = 對角元素各自 k 次方。' },
            ]}
          />
        </Deriv>
        <TexBlock id="F-10.3" label="Scalar LMS 的模式 pole 與穩定範圍（線性模型的 mean recursion；1-bit 時是小訊號區的局部 pole）">
          {String.raw`\boxed{p_i=1-\mu K_q\lambda_i(\mathbf R)},\qquad 0<\mu K_q<\frac{2}{\lambda_{\max}}`}
        </TexBlock>
        <p>
          穩定範圍由最大 eigenvalue 決定（快模式不能 overshoot 超過 −1）。收斂速度則看<strong>絕對值最大</strong>的 pole：
        </p>
        <TexBlock>{String.raw`\max_i|p_i|=\max\big(|1-\mu K_q\lambda_{\min}|,\ |1-\mu K_q\lambda_{\max}|\big)`}</TexBlock>
        <p>
          （<Tex>{String.raw`|1-\mu K_q\lambda|`}</Tex> 對 <Tex>{String.raw`\lambda`}</Tex> 是 V 字形，最大值一定落在兩端的 eigenvalue，中間的不會更慢。）步長不太大時，也就是{' '}
          <Tex>{String.raw`\mu K_q\le 2/(\lambda_{\max}+\lambda_{\min})`}</Tex>，最慢的是最小 eigenvalue 的慢模式，pole 是 <Tex>{String.raw`1-\mu K_q\lambda_{\min}`}</Tex>。本章 <Tex>{String.raw`2\times2`}</Tex> 例子的{' '}
          <Tex>{String.raw`\mathbf R`}</Tex> 對角都是 1，<Tex>{String.raw`\lambda_{\max}+\lambda_{\min}=\operatorname{tr}\mathbf R=2`}</Tex>，條件就是 <Tex>{String.raw`\mu K_q\le1`}</Tex>；本章的例子用{' '}
          <Tex>{String.raw`\mu K_q=0.5`}</Tex> 或更小（§10.6 用到 1），都在這個範圍內。
        </p>
        <p>
          步長再大（但還在穩定範圍內），快模式的 pole <Tex>{String.raw`1-\mu K_q\lambda_{\max}`}</Tex> 是負的，而且絕對值反過來比慢模式大：名字叫「快」的模式每個 block 變號、縮得最慢，變成拖住收斂的那一個。例如{' '}
          <Tex>{String.raw`\rho=${tn(fl.rho)}`}</Tex>（<Tex>{String.raw`\lambda=${tn(fl.eig[0])},\ ${tn(fl.eig[1])}`}</Tex>）、<Tex>{String.raw`\mu K_q=${tn(fl.muKq)}`}</Tex>（穩定上限{' '}
          <Tex>{String.raw`2/${tn(fl.eig[0])}\approx${tn(fl.muMax)}`}</Tex>）：<Tex>{String.raw`p=${tn(fl.fast)},\ ${tn(fl.slow)}`}</Tex>，沿快模式的誤差每個 block 只縮到 {n(fl.dominant)} 倍，比慢模式的{' '}
          {n(Math.abs(fl.slow))} 倍還慢。§10.3.1 的「換你算」HC-10.2 輸入這兩個數字，可以一步一步對答案。
        </p>
        <p>
          兩個 eigenvalue 的比值是 <Tex>{String.raw`\kappa=\lambda_{\max}/\lambda_{\min}`}</Tex>：<strong>即使 <Tex>{String.raw`\mu`}</Tex> 選到最大合法值，慢模式 pole 也大於</strong>{' '}
          <Tex>{String.raw`1-2/\kappa`}</Tex>（因為 <Tex>{String.raw`\mu K_q\lambda_{\min}<2\lambda_{\min}/\lambda_{\max}`}</Tex>）。兩個模式一起看，<Tex>{String.raw`\max_i|p_i|`}</Tex> 最小只能到{' '}
          <Tex>{String.raw`(\kappa-1)/(\kappa+1)`}</Tex>，在 <Tex>{String.raw`\mu K_q=2/(\lambda_{\max}+\lambda_{\min})`}</Tex> 時達到（<ChRef ch="09">第 9 章</ChRef> F-09.7）；<Tex>{String.raw`\rho=0.99`}</Tex> 時{' '}
          <Tex>{String.raw`\kappa=${tn(r.cond, 5)}`}</Tex>，最好也只有 {n(r.bestMaxPole)}。<Tex>{String.raw`\kappa`}</Tex> 很大時，怎麼調 <Tex>{String.raw`\mu`}</Tex> 都快不起來。
        </p>

        <h3 className="ch10-sub">
          理想 Preconditioner：<Tex>{String.raw`\mathbf M=\gamma(K_q\mathbf R)^{-1}\Rightarrow p_i=1-\gamma`}</Tex>
        </h3>
        <p>
          Scalar LMS 慢的原因可以用一句話說完：每個模式的 loop gain 等於「更新矩陣沿這個方向的增益」乘上「<Tex>{String.raw`\mathbf R`}</Tex> 沿這個方向的 eigenvalue」，而 scalar LMS 對所有方向都用同一個增益。
          完整反矩陣的想法很直接：哪個方向的 eigenvalue 小，就把那個方向的增益調大，剛好補回來。
        </p>
        <Fig id="mode-gain">
          先看 ① Scalar 那一框：兩個模式乘的是同一個 <Tex>{String.raw`m=\mu K_q=0.5`}</Tex>，loop gain 分別是 <Tex>{String.raw`0.5\times${tn(r.eig[0])}=${tn(1 - r.fast)}`}</Tex> 與{' '}
          <Tex>{String.raw`0.5\times${tn(r.eig[1])}=${tn(1 - r.slow)}`}</Tex>，慢模式（紅色）的 pole 是 {n(r.slow)}。再看 ② Full inverse 那一框：藍色方塊把 <Tex>{'m_i'}</Tex> 改成 <Tex>{String.raw`\gamma/\lambda_i`}</Tex>（快模式{' '}
          {n(r.eigMn[1])}、慢模式 {n(r.eigMn[0])}），乘回 <Tex>{String.raw`\lambda_i`}</Tex> 之後兩個模式的 loop gain 都是 <Tex>{String.raw`\gamma=0.5`}</Tex>。圖上的 <Tex>{'m_i'}</Tex> 是<strong>正規化更新矩陣</strong>{' '}
          <Tex>{String.raw`\mathbf M_n=K_q\mathbf M`}</Tex>（把 <Tex>{'K_q'}</Tex> 乘進去，無因次）沿第 <Tex>{'i'}</Tex> 個 eigenvector 的增益（<Tex>{String.raw`\mathbf M_n\mathbf v_i=m_i\mathbf v_i`}</Tex>），「loop gain」就是{' '}
          <Tex>{String.raw`1-p_i=m_i\lambda_i`}</Tex>；所以 F-10.3 是 <Tex>{String.raw`m_i=\mu K_q`}</Tex>，下面的 F-10.4 是 <Tex>{String.raw`m_i=\gamma/\lambda_i\Rightarrow p_i=1-\gamma`}</Tex>。
        </Fig>
        <Deriv title="為什麼一個反矩陣就能讓所有模式一樣快">
          <StepDerivation
            steps={[
              {
                tex: String.raw`\mathbf A_{\mathrm{cal}}=\mathbf I-K_q\,\gamma(K_q\mathbf R)^{-1}\mathbf R`,
                why: (
                  <>
                    代入 <Tex>{String.raw`\mathbf M=\gamma(K_q\mathbf R)^{-1}`}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`=\mathbf I-\gamma\,K_q\,\frac{1}{K_q}\mathbf R^{-1}\mathbf R`,
                why: (
                  <>
                    <Tex>{String.raw`(c\mathbf R)^{-1}=c^{-1}\mathbf R^{-1}`}</Tex>（純量可以提出）。
                  </>
                ),
              },
              {
                tex: String.raw`=\mathbf I-\gamma\mathbf I=(1-\gamma)\mathbf I`,
                why: (
                  <>
                    <Tex>{String.raw`\mathbf R^{-1}\mathbf R=\mathbf I`}</Tex>（<Tex>{String.raw`\mathbf R`}</Tex> 正定才有反矩陣）。
                  </>
                ),
              },
              { tex: String.raw`\boldsymbol\delta_k=(1-\gamma)^k\boldsymbol\delta_0`, why: '每個方向都是同一個等比數列：沒有慢模式了。' },
            ]}
          />
        </Deriv>
        <TexBlock
          id="F-10.4"
          label={
            <>
              完整 Preconditioner（<Tex>{String.raw`\mathbf R`}</Tex> 正定、模型匹配；<Tex>{'K_q'}</Tex> 必須包含在 <Tex>{String.raw`\mathbf M`}</Tex> 裡）
            </>
          }
        >
          {String.raw`\boxed{\mathbf M=\gamma(K_q\mathbf R)^{-1}\ \Rightarrow\ \mathbf A_{\mathrm{cal}}=(1-\gamma)\mathbf I,\quad p_i=1-\gamma\ \ \forall i}`}
        </TexBlock>
        <p>
          穩定需要 <Tex>{String.raw`0<\gamma<2`}</Tex>；<Tex>{String.raw`\gamma=1`}</Tex> 時一步到位（deadbeat）。直覺：<Tex>{String.raw`\mathbf R^{-1}`}</Tex> 把「看得不清楚」的方向放大、「看得很清楚」的方向縮小，
          使每個方向的有效 loop gain 都是 <Tex>{String.raw`\gamma`}</Tex>。代價在 §10.4。
        </p>
      </Section>

      <Section
        kind="example"
        title={
          <>
            10.3.1 強耦合的代價：598 個 block 變成 5 個 block（並寫清楚 <Tex>{'K_q'}</Tex>）
          </>
        }
        id="ch10-598"
      >
        <TagRow>
          <span className="small muted">規格 §10.1</span>
          <Erratum id="E05" />
          <Erratum id="E08" />
          <Erratum id="E21" />
          <TestBadge id="T11" />
        </TagRow>
        <Callout
          kind="info"
          title={
            <>
              本例採正規化 <Tex>{'K_q=1'}</Tex>（<Tex>{String.raw`\mu`}</Tex> 代表無單位 loop gain <Tex>{String.raw`\mu K_q`}</Tex>）
            </>
          }
        >
          <p>
            規格 §10.1 的 0.995、598、0.5、5 只在 <Tex>{'K_q=1'}</Tex>（或 <Tex>{String.raw`\mu`}</Tex> 已吸收 <Tex>{'K_q'}</Tex>）時成立。下表先用正規化數字，再換成<ChRef ch="05">第 5 章</ChRef>的實體{' '}
            <Tex>{String.raw`K_q=${tn(NUM.Kq, 6)}\ \mathrm{fs}^{-1}`}</Tex>。
          </p>
        </Callout>
        <p>
          <Tex>{String.raw`\mathbf R=\begin{bmatrix}1&0.99\\0.99&1\end{bmatrix}`}</Tex>：<Tex>{String.raw`\lambda_{\max}=${tn(r.eig[0])}`}</Tex>、
          <Tex>{String.raw`\lambda_{\min}=${tn(r.eig[1])}`}</Tex>、<Tex>{String.raw`\kappa=${tn(r.cond, 5)}`}</Tex>。要算的只有一件事：誤差衰減到 5%（下降 95%）需要幾個 block，記為{' '}
          <Tex>{'k_{95}'}</Tex>。計算順序如下圖：
        </p>
        <Fig id="k95-flow">
          先沿上面一路由左到右：<Tex>{String.raw`\rho`}</Tex> → eigenvalue → 慢 pole → 兩個 <Tex>{String.raw`\ln`}</Tex> 相除、無條件進位，得到 {nint(r.blocksScalar)}。再看下面一路：完整反矩陣的 pole 直接是{' '}
          <Tex>{String.raw`1-\gamma`}</Tex>，不必看 <Tex>{String.raw`\lambda`}</Tex>，得到 {nint(r.blocksFull)}。藍色那一格是最常見的錯誤：圖上的「<Tex>{String.raw`\mu K_q`}</Tex>」是一個無因次的數；手上的{' '}
          <Tex>{String.raw`\mu`}</Tex> 若是 fs，要先乘上 <Tex>{'K_q'}</Tex>（<Tex>{String.raw`\mathrm{fs}^{-1}`}</Tex>）才能代進去（下表第 3、4 列就是弄錯單位的後果，第 5 列是正確的寫法）。圖上每一格對應下面的步驟 1–3；
          <Tex>{String.raw`k_{95}`}</Tex> 那一格就是 F-10.5。
        </Fig>
        <ol>
          <li>
            一般 LMS，<Tex>{String.raw`\mu K_q=0.5`}</Tex>：慢 pole <Tex>{String.raw`p_{\min}=1-0.5\times${tn(r.eig[1])}=${tn(r.slow)}`}</Tex>，快 pole{' '}
            <Tex>{String.raw`1-0.5\times${tn(r.eig[0])}=${tn(r.fast)}`}</Tex>。
          </li>
          <li>
            95% 衰減需要 <Tex>{String.raw`|p|^k\le0.05`}</Tex>，<Tex>{'p'}</Tex> 代<strong>絕對值最大</strong>的那個 pole（這裡是慢 pole <Tex>{String.raw`${tn(r.slow)}`}</Tex>；快 pole{' '}
            <Tex>{String.raw`${tn(r.fast)}`}</Tex> 一個 block 就降到 5% 以下）。兩邊取 ln（ln 是遞增函數，但 <Tex>{String.raw`\ln|p|<0`}</Tex>，除過去不等號反向）：
            <TexBlock id="F-10.5">{String.raw`\boxed{k_{95}=\left\lceil\frac{\ln0.05}{\ln|p|}\right\rceil}=\left\lceil\frac{${tn(r.ln005, 5)}}{${tn(r.lnSlow, 5)}}\right\rceil=\lceil ${tn(r.blocksScalarReal, 5)}\rceil=${r.blocksScalar}`}</TexBlock>
            這條式子一次只算<strong>一個模式</strong>。本例的 <Tex>{String.raw`\mathbf A_{\mathrm{cal}}=\mathbf I-\mu K_q\mathbf R`}</Tex> 是對稱矩陣，各模式的方向互相垂直，所以不管初始誤差指向哪裡，整個誤差向量的長度最慢也只照最慢的{' '}
            <Tex>{'|p|'}</Tex> 衰減——代 <Tex>{String.raw`|p|=\rho(\mathbf A_{\mathrm{cal}})`}</Tex>（最大的 <Tex>{'|p_i|'}</Tex>，spectral radius）就是整體的 <Tex>{'k_{95}'}</Tex>。
          </li>
          <li>
            完整反矩陣 <Tex>{String.raw`\mathbf M=0.5(K_q\mathbf R)^{-1}`}</Tex>（<Tex>{String.raw`\gamma=0.5`}</Tex>）：所有 pole = 0.5，
            <Tex>{String.raw`k_{95}=\lceil\ln0.05/\ln0.5\rceil=\lceil ${tn(r.blocksFullReal, 4)}\rceil=${r.blocksFull}`}</Tex>（驗算：<Tex>{String.raw`0.5^4=0.0625>0.05`}</Tex>、
            <Tex>{String.raw`0.5^5=0.03125\le0.05`}</Tex>）。
          </li>
        </ol>
        <ModeGate min="engineer">
          <Callout
            kind="warn"
            title={
              <>
                <Tex>{String.raw`\mathbf A_{\mathrm{cal}}`}</Tex> 不對稱時，F-10.5 只是下界
              </>
            }
          >
            <p>
              上面用到「各模式的方向互相垂直」。<Tex>{String.raw`\mathbf A_{\mathrm{cal}}`}</Tex> 不是<strong>正規矩陣</strong>（normal matrix：<Tex>{String.raw`\mathbf A\mathbf A^T=\mathbf A^T\mathbf A`}</Tex>，對稱矩陣都是）時就不成立——例如 §10.5
              量到的一般 <Tex>{String.raw`\mathbf J`}</Tex>、<Tex>{String.raw`\hat{\mathbf J}\ne\mathbf J`}</Tex>，或各 loop 用不同增益。這時 eigenvector 不再互相垂直，只剩 <Tex>{String.raw`\|\mathbf A^k\|_2\ge\rho(\mathbf A)^k`}</Tex>（正規時是等號；<Tex>{String.raw`\|\cdot\|_2`}</Tex>{' '}
              是最大 singular value，也就是最壞初始方向的放大倍數）：誤差長度可以先變大再衰減。
            </p>
            <p>
              例：<Tex>{String.raw`\mathbf J_n=${texMat(nn.J)}`}</Tex>、<Tex>{String.raw`\mu K_q=${tn(nn.muKq)}`}</Tex> 得 <Tex>{String.raw`\mathbf A=\mathbf I+\mu K_q\mathbf J_n=${texMat(nn.A)}`}</Tex>，兩個 pole 都是{' '}
              <Tex>{String.raw`${tn(nn.rho)}`}</Tex>，F-10.5 給 <Tex>{String.raw`\lceil\ln0.05/\ln${tn(nn.rho)}\rceil=${nn.asym}`}</Tex>。但{' '}
              <Tex>{String.raw`\mathbf A^k=\begin{bmatrix}2^{-k}&k\,2^{-(k-1)}\\0&2^{-k}\end{bmatrix}`}</Tex>，從 <Tex>{String.raw`\boldsymbol\delta_0=(${nn.delta0.join(',')})`}</Tex> 出發，
              <Tex>{String.raw`\|\boldsymbol\delta_5\|=${tn(nn.n5, 3)}`}</Tex>、<Tex>{String.raw`\|\boldsymbol\delta_8\|=${tn(nn.n8, 3)}`}</Tex>、<Tex>{String.raw`\|\boldsymbol\delta_9\|=${tn(nn.n9, 3)}`}</Tex>：要{' '}
              <strong>{nn.blocks}</strong> 個 block 才低於 5%，不是 {nn.asym} 個。
            </p>
            <p>
              <Tex>{String.raw`\rho(\mathbf A)<1`}</Tex> 仍然保證最後會收斂（穩定的判斷不變），只是有限時間的 block 數要改看 <Tex>{String.raw`\|\mathbf A^k\|_2\le0.05`}</Tex>。本章互動實驗的{' '}
              <Tex>{'k_{95}'}</Tex> 就是這樣算的：最小的 <Tex>{'k'}</Tex>，使所有 <Tex>{String.raw`j\ge k`}</Tex> 都有 <Tex>{String.raw`\|\mathbf A^j\|_2\le0.05`}</Tex>；<Tex>{String.raw`\mathbf A`}</Tex> 對稱（正規）時兩種算法給同一個數。
            </p>
          </Callout>
        </ModeGate>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>情境</th>
                <th>更新矩陣</th>
                <th className="ch10-num">最慢 pole</th>
                <th className="ch10-num">95% blocks</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  正規化 <Tex>{'K_q=1'}</Tex>，一般 LMS
                </td>
                <td>
                  <Tex>{String.raw`\mu K_q=0.5`}</Tex>
                </td>
                <td className="ch10-num">{n(r.slow, 6)}</td>
                <td className="ch10-num">{nint(r.blocksScalar)}</td>
              </tr>
              <tr className="ch10-hl">
                <td>
                  正規化 <Tex>{'K_q=1'}</Tex>，完整反矩陣
                </td>
                <td>
                  <Tex>{String.raw`0.5(K_q\mathbf R)^{-1}`}</Tex>
                </td>
                <td className="ch10-num">0.5</td>
                <td className="ch10-num">{nint(r.blocksFull)}</td>
              </tr>
              <tr>
                <td>
                  實體 <Tex>{String.raw`K_q=${tn(NUM.Kq, 6)}\ \mathrm{fs}^{-1}`}</Tex>
                </td>
                <td>
                  <Tex>{String.raw`\mu=0.5\ \mathrm{fs}`}</Tex>
                </td>
                <td className="ch10-num">{n(ph.slowPole, 9)}</td>
                <td className="ch10-num">{nint(ph.blocks)}</td>
              </tr>
              <tr>
                <td className="ch10-bad">錯誤：忘了 <Tex>{'K_q'}</Tex></td>
                <td>
                  <Tex>{String.raw`0.5\mathbf R^{-1}`}</Tex>
                </td>
                <td className="ch10-num">{n(ph.forgotKqPole, 6)}</td>
                <td className="ch10-num">{nint(ph.forgotKqBlocks)}</td>
              </tr>
              <tr>
                <td className="ch10-good">正確：把 <Tex>{'K_q'}</Tex> 放進反矩陣</td>
                <td>
                  <Tex>{String.raw`0.5(K_q\mathbf R)^{-1}`}</Tex>
                </td>
                <td className="ch10-num">{n(ph.fullPole, 6)}</td>
                <td className="ch10-num">{nint(ph.fullBlocks)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small muted">
          全表由 <code>analyzeRule()</code> 計算。「忘了 <Tex>{'K_q'}</Tex>」那一列：<Tex>{String.raw`\mathbf A=\mathbf I-K_q\cdot0.5\mathbf R^{-1}\mathbf R=(1-0.5K_q)\mathbf I`}</Tex>，pole ={' '}
          {n(ph.forgotKqPole, 6)}，需要 {nint(ph.forgotKqBlocks)} 個 block——比規格宣稱的 {r.blocksFull} 慢 {n(ph.forgotKqBlocks / r.blocksFull, 4)} 倍。這就是勘誤 E05 / E08 要求 Lab 同時顯示{' '}
          <Tex>{String.raw`g_i=\mu K_q\lambda_i`}</Tex> 與單位（<Tex>{'K_q'}</Tex> 為 <Tex>{String.raw`\mathrm{fs}^{-1}`}</Tex>、<Tex>{String.raw`\mu`}</Tex> 為 fs）的原因。
        </p>
        <p className="small muted" id="ch10-phys-kq-note">
          <ClaimTag kind="approx" /> 後三列的實體 <Tex>{'K_q'}</Tex> 是 1-bit comparator 的小訊號增益：{nint(ph.blocks)}、{nint(ph.forgotKqBlocks)}、{nint(ph.fullBlocks)} 這三個 block 數的前提是{' '}
          <Tex>{String.raw`|\mathbf u^T\boldsymbol\delta_k|\ll\sigma_v=${tn(NUM.sigmaV)}\ \mathrm{fs}`}</Tex>（F-10.2 下面的說明）；單位換算本身是精確的算術。
        </p>
        <Hand id="HC-10.2">
          598 是怎麼來的？預設數字（<Tex>{String.raw`\rho=0.99,\ \mu K_q=0.5`}</Tex>）就是上面的例子。把 <Tex>{String.raw`\rho`}</Tex> 換成 0.9 或 0.5、<Tex>{String.raw`\mu K_q`}</Tex> 換成你想試的值，先用紙筆（<Tex>{String.raw`\ln`}</Tex>{' '}
          按計算機）算出兩個 pole 與 <Tex>{'k_{95}'}</Tex>，再展開步驟對答案。
        </Hand>

        <h3 className="ch10-sub">反矩陣有多大？（不是 <Tex>{String.raw`\pm25`}</Tex>，而是 <Tex>{String.raw`\pm50`}</Tex>）</h3>
        <TexBlock>
          {String.raw`\mathbf R^{-1}=\frac{1}{1-\rho^2}\begin{bmatrix}1&-\rho\\-\rho&1\end{bmatrix}=${texMat(r.Rinv, 5)},\qquad \mathbf M_n=K_q\mathbf M=0.5\mathbf R^{-1}=${texMat(r.Mn, 5)}`}
        </TexBlock>
        <p>
          （<Tex>{String.raw`\mathbf M_n=K_q\mathbf M`}</Tex> 是把 <Tex>{'K_q'}</Tex> 乘進去之後的無因次「正規化更新矩陣」；實體的 <Tex>{String.raw`\mathbf M=\mathbf M_n/K_q`}</Tex> 單位是 fs。）規格說「反矩陣元素約 <Tex>{String.raw`\pm25`}</Tex>」：其實{' '}
          <Tex>{String.raw`\mathbf R^{-1}`}</Tex> 本身是{' '}
          <strong>
            {n(r.Rinv[0][0], 4)} / {n(r.Rinv[0][1], 4)}
          </strong>
          ，<Tex>{String.raw`\pm25`}</Tex> 是 <Tex>{String.raw`0.5\mathbf R^{-1}`}</Tex>（而且對角為正、非對角為負，不是「<Tex>{String.raw`\pm`}</Tex>」隨意）
          <Erratum id="E21" />。換成實體單位 <Tex>{String.raw`\mathbf M=\mathbf M_n/K_q=${texMat(ph.Mphys, 5)}\ \mathrm{fs}`}</Tex>：一個 GMAC 的單位輸出要讓係數動約{' '}
          {n(ph.Mphys[0][0], 3)} fs，暫存器的位寬與定點誤差都要重新評估。
        </p>
        <p>
          元素大小不是重點，<strong>方向增益</strong>才是：<Tex>{String.raw`\mathbf M_n`}</Tex> 的 eigenvalue 是{' '}
          <Tex>{String.raw`\gamma/\lambda_{\min}=${tn(r.eigMn[0], 5)}`}</Tex>（沿慢 eigenvector <Tex>{String.raw`[1,-1]^T/\sqrt2`}</Tex>）與{' '}
          <Tex>{String.raw`\gamma/\lambda_{\max}=${tn(r.eigMn[1], 5)}`}</Tex>（沿快 eigenvector）。GMAC noise 沿慢方向被乘上 {n(r.eigMn[0], 4)}——下一節計算代價。
        </p>
        <Hand id="HC-10.3">
          <Tex>{String.raw`2\times2`}</Tex> 的反矩陣只要四則運算。預設數字會算出上面的 <Tex>{String.raw`\mathbf M_n=${texMat(r.Mn, 4)}`}</Tex>；把 <Tex>{'R_{12}'}</Tex> 換成 0.6 或 0.8（或把 <Tex>{'R_{11}'}</Tex> 改成 2，模擬兩個
          regressor 功率不同）先用紙筆算一次，並驗算 <Tex>{String.raw`\mathbf M_n\mathbf R=\gamma\mathbf I`}</Tex>，再展開步驟對答案。
        </Hand>
      </Section>

      <Section
        kind="explore"
        title={
          <>
            動手觀察：相關係數 <Tex>{String.raw`\rho`}</Tex> 對三種更新矩陣的影響
          </>
        }
      >
        <RhoWidget />
        <p className="small muted">
          Diagonal 規則在這個例子裡沒有幫助：<Tex>{String.raw`\mathbf R`}</Tex> 的對角都是 1，「讓每個 loop 單獨 <Tex>{String.raw`p=1-\gamma`}</Tex>」得到{' '}
          <Tex>{String.raw`\mathbf M_n=${texMat(r.diagMn, 3)}`}</Tex>，和 <Tex>{String.raw`\mu K_q=0.5`}</Tex> 的 scalar LMS 完全一樣（{nint(r.blocksScalar)} blocks）。對角正規化只能修正「各參數功率不同」，修正不了「參數之間相關」。
        </p>
      </Section>
    </>
  )
}
