import { useMemo } from 'react'
import { Callout, ClaimTag, ModeGate, Prereq, Section, StepDerivation, Tex, TexBlock, ChRef } from '@/components'
import { buildCodeDistribution, fixedPoint, meanGmacSign, mseFixedPoint, type ErrorModel } from '@/simulation/models/bias'
import { F } from '../formulas'
import { CODE_KIND_TEX, Erratum, chop, num, m, texNum } from '../common'
import { Fig, FigRef } from '../Fig'

/** §11.3：code-correlated deterministic error 與 identifiability（勘誤 E12、E17）。 */
export function CorrelatedSection() {
  const demo = useMemo(() => {
    const five = buildCodeDistribution({ kind: 'five_level' })
    const worldA: ErrorModel = { a: 1, b: 0, c2: 0, c3: 0, kappa: 0.1, sigmaV: 0.5 }
    const worldB: ErrorModel = { ...worldA, a: 1.1, kappa: 0 }
    let maxDiff = 0
    for (let i = 0; i <= 40; i++) {
      const w = 0.6 + i * 0.025
      maxDiff = Math.max(maxDiff, Math.abs(meanGmacSign(w, worldA, five) - meanGmacSign(w, worldB, five)))
    }
    const kinds = (['five_level', 'unipolar4', 'uniform_residue', 'gaussian'] as const).map((k) => {
      const d = buildCodeDistribution({ kind: k })
      return { k, mse: mseFixedPoint(worldA, d), sign: fixedPoint('sign', worldA, d).w }
    })
    return { maxDiff, kinds }
  }, [])

  return (
    <Section kind="formula" title="11.3 Code-correlated deterministic error 與 identifiability" level={2} id="ch11-correlated">
      <p className="small">
        <Erratum id="E12" note="干擾改名 ε_cc、係數 κ" />
        <Erratum id="E17" note="這裡的干擾是 deterministic，不是 random jitter" />
        規格書標題寫「Code-Correlated Jitter」，但內文處理的是<strong>確定性</strong>的 <Tex>{String.raw`\varepsilon_{cc}=\kappa x`}</Tex>（例如 DSM pattern 經 supply ripple 或 clock
        phase 耦合到 PD，形成與 code 成正比的 deterministic jitter, DJ）。隨機、零均值的 jitter 不會造成 bias（§11.0 的類別 ① 與 ④）。
      </p>
      <p>
        先看 <FigRef id="identifiability" /> 的上半部：同一個 code <Tex>{'x[n]'}</Tex> 同時乘上 <Tex>{'(a-w)'}</Tex>（DTC 的 gain 誤差，藍色）與{' '}
        <Tex>{'\\kappa'}</Tex>（耦合係數，紅色；單位和 gain 一樣是 t.u.），兩者在 comparator 前直接相加。再看下半部：comparator 只看得到它們的和{' '}
        <Tex>{String.raw`((a+\kappa)-w)\,x`}</Tex>，所以 LMS 要把 <Tex>{'w'}</Tex> 調到 <Tex>{'a+\\kappa'}</Tex> 才會停。圖上紅色的「
        <Tex>{'\\times\\kappa'}</Tex>」就是公式裡的 <Tex>{String.raw`\varepsilon_{cc}=\kappa x`}</Tex>；comparator 方塊裡的 <Tex>{'e[n]'}</Tex>{' '}
        就是下面「兩個世界」推導的第一行。
      </p>
      <Fig id="identifiability" />
      <StepDerivation
        steps={[
          { tex: String.raw`\varepsilon_{cc}[n]=\kappa\,x[n]`, why: '假設耦合到 PD 的誤差與 code 成正比（最簡單的 code-correlated DJ）。' },
          { tex: String.raw`E[x\,\varepsilon_{cc}]=\kappa\,E[x^2]`, why: m('代入 F-11.4 分子的第三項；$\\kappa$ 是常數可提出。') },
          { tex: String.raw`w^*=a+\frac{\kappa E[x^2]}{E[x^2]}=a+\kappa`, why: m('$E[x^2]$ 約掉：bias 剛好是 $\\kappa$，與 code 分布無關。') },
        ]}
      />
      <TexBlock id="F-11.13">{F.kappa}</TexBlock>
      <p className="small">
        想代數字算一次？§11.4 的帶入手算 HC-11.7 前兩步就是這個式子：先算 <Tex>{'B=\\kappa\\,E[x^2]'}</Tex>，靜態（<Tex>{'C=E[x^2]'}</Tex>）時{' '}
        <Tex>{'w^*=a+B/E[x^2]=a+\\kappa'}</Tex>；接著再把同一個 <Tex>{'B'}</Tex> 放到 near-integer 的小 <Tex>{'C'}</Tex> 上，看 bias 被放大多少。
      </p>
      <p>
        數值檢查（<Tex>{'a=1'}</Tex>、<Tex>{'\\kappa=0.1'}</Tex>、<Tex>{'\\sigma_v=0.5'}</Tex>；即時計算）：
      </p>
      <div className="table-wrap">
        <table className="ch11-table">
          <thead>
            <tr>
              <th>code 分布</th>
              <th>MSE-LMS</th>
              <th>
                Sign-LMS mean-field（<Tex>{'\\sigma_v=0.5'}</Tex>）
              </th>
            </tr>
          </thead>
          <tbody>
            {demo.kinds.map((r) => (
              <tr key={r.k}>
                <td>{m(CODE_KIND_TEX[r.k])}</td>
                <td className="num">{num(r.mse, 8)}</td>
                <td className="num">{num(r.sign, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        四種分布、兩種演算法都是 <Tex>{'a+\\kappa=1.1'}</Tex>（只有 <Tex>{'\\kappa x'}</Tex> 時 <Tex>{String.raw`e_\mathrm{det}=(a+\kappa-w)x`}</Tex>，在 <Tex>{'w=a+\\kappa'}</Tex> 處每個 code
        的殘差都是 0，所以 Sign-LMS 也精確）。<ClaimTag kind="exact" />
      </p>

      <h3>為什麼「分不開」：一個兩個世界的論證</h3>
      <StepDerivation
        steps={[
          { tex: String.raw`e=(a-w)x+\kappa x+\cdots=\big((a+\kappa)-w\big)x+\cdots`, why: m('把 $\\kappa x$ 併進 gain 項：comparator 看到的誤差只依賴 $a+\\kappa$。') },
          {
            tex: String.raw`\text{世界 A：}(a,\kappa)=(1,\,0.1)\qquad\text{世界 B：}(a,\kappa)=(1.1,\,0)`,
            why: '兩個物理上不同的晶片：A 的 DTC gain 正確但有耦合，B 的 DTC gain 偏 10% 但沒有耦合。',
          },
          {
            tex: String.raw`P(q=+1\mid x,w)\text{ 在兩個世界完全相同}\;\Rightarrow\;\max_w\big|E[G]_A-E[G]_B\big|=${texNum(chop(demo.maxDiff), 3)}`,
            why: m(
              `對每個 code、每個 $w$，comparator 的輸出機率都一樣（右式由模型在 $w\\in[0.6,1.6]$ 的 41 個點掃描計算；實際最大差 $${texNum(demo.maxDiff, 2)}$ 只是浮點捨入）。`,
            ),
          },
          { tex: String.raw`\Rightarrow\;\text{任何只用 }(x[n],q[n])\text{ 的演算法都無法分辨 A 與 B}`, why: '資料的機率分布相同，資訊上就不可能區分 —— 這叫不可辨識（unidentifiable）。' },
        ]}
      />
      <p>
        那麼 <Tex>{'w^*=a+\\kappa'}</Tex> 到底是好是壞？<FigRef id="coupling-node" /> 從最上面的問題出發：<Tex>{String.raw`\varepsilon_{cc}`}</Tex>{' '}
        是真的出現在相位路徑上（PLL 的輸出也有），還是只出現在「觀測」的路徑上？走綠色出口時校正幫了忙，走紅色出口時校正反而把誤差寫進輸出。
      </p>
      <Fig id="coupling-node" />
      <Callout kind="warn" title={m('$w^*=a+\\kappa$ 是「錯」的嗎？要看你在乎哪個誤差')}>
        <p>
          若 <Tex>{String.raw`\varepsilon_{cc}`}</Tex> 也同樣出現在 PLL 輸出的相位誤差中（例如它本來就是 DTC 路徑上的 pattern-dependent delay），那麼 <Tex>{'w=a+\\kappa'}</Tex>{' '}
          反而把它一起抵消了，對輸出 jitter 是好事。若它只出現在<strong>觀測路徑</strong>（例如只耦合到 comparator 的 threshold），那麼 <Tex>{'w=a+\\kappa'}</Tex> 就是把一個不存在的
          誤差「校正」進 DTC，輸出端反而多了 <Tex>{'\\kappa x'}</Tex> 的 timing error。<ClaimTag kind="research" /> 需要以閉迴路模擬或實測確認耦合發生在哪個節點。
        </p>
      </Callout>

      <h3>怎麼打破不可辨識？</h3>
      <div className="table-wrap">
        <table className="ch11-table">
          <thead>
            <tr>
              <th>方法</th>
              <th>原理</th>
              <th>代價</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>額外 training sequence</td>
              <td>在 DTC 端加入一個耦合路徑看不到的已知 test code（或 dither）<Tex>{'s[n]'}</Tex>，改用 <Tex>{'s'}</Tex> 當 GMAC regressor</td>
              <td>動態範圍、額外的 spur（<ChRef ch="12">Ch12</ChRef>）</td>
            </tr>
            <tr>
              <td>Chopping / code randomization</td>
              <td>
                DTC 端套用 <Tex>{'c[n]x[n]'}</Tex>（<Tex>{'c=\\pm1'}</Tex> 隨機），GMAC 用 <Tex>{'c\\,x'}</Tex>：耦合項 <Tex>{String.raw`E[c\,x\cdot\kappa x]=\kappa E[c]E[x^2]=0`}</Tex>
              </td>
              <td>需要可翻轉的 DTC 映射；<ClaimTag kind="research" /></td>
            </tr>
            <tr>
              <td>額外觀測者</td>
              <td>第二個 comparator / TDC 在不同節點觀察，兩個方程解兩個未知數</td>
              <td>面積、匹配</td>
            </tr>
            <tr>
              <td>參數約束</td>
              <td>{m('由 characterization 已知 $\\kappa$（或 $a$ 的範圍），固定其中一個')}</td>
              <td>PVT 漂移時失效</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ModeGate min="engineer">
        <p className="small">
          數學上這和 <ChRef ch="09">Ch09</ChRef> 的 gauge freedom 是同一件事：把 <Tex>{'(a,\\kappa)'}</Tex> 當成兩個未知數，資料只依賴 <Tex>{'a+\\kappa'}</Tex>。兩個參數各自的 regressor 都是{' '}
          <Tex>{'x'}</Tex>，所以它們的「資訊矩陣」（regressor 兩兩相乘的期望值）是
        </p>
        <TexBlock>{String.raw`\mathbf R=E\!\left[\begin{bmatrix}x\\x\end{bmatrix}\begin{bmatrix}x&x\end{bmatrix}\right]=E[x^2]\begin{bmatrix}1&1\\1&1\end{bmatrix}`}</TexBlock>
        <Prereq title="特徵值（eigenvalue）：一個矩陣「在哪個方向上有多少資訊」">
          <p>
            {m(
              '對一個方陣 $\\mathbf R$，若某個非零向量 $\\mathbf v$ 乘上 $\\mathbf R$ 之後只是被拉長或縮短（方向不變）：$\\mathbf R\\mathbf v=\\lambda\\mathbf v$，$\\lambda$ 就叫特徵值、$\\mathbf v$ 叫特徵向量。白話：沿著 $\\mathbf v$ 這個參數方向移動，資料提供的「辨識力」是 $\\lambda$；$\\lambda=0$ 表示沿這個方向怎麼移動，資料都看不出差別。',
            )}
          </p>
          <StepDerivation
            steps={[
              { tex: String.raw`\begin{bmatrix}1&1\\1&1\end{bmatrix}\begin{bmatrix}1\\1\end{bmatrix}=\begin{bmatrix}2\\2\end{bmatrix}=2\begin{bmatrix}1\\1\end{bmatrix}`, why: m('直接乘：方向 $(1,1)$（$a$ 與 $\\kappa$ 一起變）被放大 2 倍 ⇒ $\\lambda_1=2$。') },
              { tex: String.raw`\begin{bmatrix}1&1\\1&1\end{bmatrix}\begin{bmatrix}1\\-1\end{bmatrix}=\begin{bmatrix}0\\0\end{bmatrix}=0\begin{bmatrix}1\\-1\end{bmatrix}`, why: m('方向 $(1,-1)$（$a$ 增加多少、$\\kappa$ 就減少多少）被乘成 0 ⇒ $\\lambda_2=0$。') },
              { tex: String.raw`\det(\mathbf R-\lambda\mathbf I)=(1-\lambda)^2-1=\lambda(\lambda-2)=0\;\Rightarrow\;\lambda\in\{0,\,2\}`, why: m('一般的求法：解特徵方程式（$2\\times2$ 行列式 $ad-bc$）；結果與上面兩行一致。') },
            ]}
          />
        </Prereq>
        <p className="small">
          所以 <Tex>{'\\mathbf R'}</Tex> 的特徵值是 <Tex>{'2E[x^2]'}</Tex> 與 <Tex>{'0'}</Tex>：零特徵值的方向 <Tex>{'(\\Delta a,\\Delta\\kappa)\\propto(1,-1)'}</Tex>{' '}
          就是不可辨識的 null space（<Tex>{String.raw`\lambda_\mathrm{min}=0`}</Tex>）。單一 regressor <Tex>{'x'}</Tex> 只能提供一個方程，解不出兩個未知數。
        </p>
      </ModeGate>
    </Section>
  )
}
