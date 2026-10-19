import { useMemo } from 'react'
import { Callout, ClaimTag, Quiz, Recap, Section, StepDerivation, ChRef, ChapterErratum } from '@/components'
import { eigSym } from '@/simulation/core'
import { KQ_SIGMA100, eigenModes, corr2, gaugeNullVector, meanSquareRadius, pm1DegenerateProb, stepsToDecay } from '@/simulation/models/pe'
import { Diagram, FigRef, HandCalcBox, formulaTex, m, texNum } from '../shared'

/** P 相 one-hot ＋ 共用 offset 的解析 R_x = [[1, 1ᵀ/P], [1/P, I/P]]（iid 等機率） */
function onehotRx(P: number): number[][] {
  return Array.from({ length: P + 1 }, (_, i) =>
    Array.from({ length: P + 1 }, (_, j) => (i === 0 && j === 0 ? 1 : i === 0 || j === 0 ? 1 / P : i === j ? 1 / P : 0)),
  )
}

/** 比較表、思考題、本課必記、連結到 PLL。 */
export function Wrapup() {
  const q1 = useMemo(() => {
    const modes = eigenModes(corr2(0.9), 0.5)
    return { lambdas: modes.lambdas, poles: modes.poles, k95: stepsToDecay(modes.poles[1]) }
  }, [])
  // 「本課必記」與解析裡引用的數字（由模型計算）
  const facts = useMemo(
    () => ({
      k95: eigenModes(corr2(0.99), 0.5).k95[1],
      pSlow: eigenModes(corr2(0.99), 0.5).poles[1],
      k95Phys: eigenModes(corr2(0.99), 0.5 * KQ_SIGMA100).k95[1],
      msN1: meanSquareRadius('gaussian', 0.99, 0.5, 1),
      degPct: 100 * pm1DegenerateProb(0.99, 100),
    }),
    [],
  )
  // 相數一般化：P = 4（本章）與 P = 8（例如 8 相 PMUX）的 R_x eigenvalues，由 Jacobi eigSym 計算
  const phases = useMemo(
    () =>
      [4, 8].map((P) => {
        const ev = eigSym(onehotRx(P)).values
        return { P, max: ev[0], mid: ev[1], midCount: ev.filter((v) => Math.abs(v - 1 / P) < 1e-9).length, nulls: ev.filter((v) => Math.abs(v) < 1e-12).length }
      }),
    [],
  )
  // 思考題 2：選項全部由 θ 與 gauge 向量 n 算出（與 §9.2「先算一次」用不同的數字）
  const q2 = useMemo(() => {
    const theta = [2, 1, 4, 0, 3]
    const c = 2
    const n = gaugeNullVector(4)
    const tuple = (v: number[]) => `(${v.join(', ')})`
    const gauge = theta.map((t, i) => t + c * n[i]) // θ + c·n：b 加 c、每個 a_i 減 c
    const both = theta.map((t) => t + c) // b 與 a_i 同時加 c（不是 gauge）
    const onlyA = theta.map((t, i) => (i === 0 ? t : t - c)) // 只動 a_i
    const onlyB = theta.map((t, i) => (i === 0 ? t + c : t)) // 只動 b
    const y = (v: number[], ph: number) => v[0] + v[1 + ph]
    return { theta, c, tuple, gauge, both, onlyA, onlyB, y }
  }, [])

  return (
    <>
      <Section kind="assumptions" title="PE 不足時，哪些「調參」有用、哪些沒用？" level={2} id="ch09-compare">
        <p>
          先把整章收成一張決策樹：拿到一個校正架構，怎麼判斷「這個參數學得到嗎」？
        </p>
        <Diagram id="identifiable-tree">
          從上往下回答三個藍色的問題；走到紅色方塊就表示任何「調參」都救不了，必須改激發或改參數化。
        </Diagram>
        <p>
          <FigRef id="identifiable-tree" /> 怎麼用：挑一個你關心的參數方向 {m`\mathbf v`}（單一參數，或是「共模」「差模」這類組合）。先問 ①（結構）——PD 端的
          regressor 在這個方向上有沒有投影？沒有的話（例如 gauge、{m`\rho=1`}），{m`\lambda=0`}，只能改參數化或另找觀測路徑。再問 ②（時間）——是不是<strong>每一個</strong>窗口都有能量？有些窗口沒有的話，只有在好的窗口才學得到。最後問 ③（快慢）——{m`\kappa`} 很大時學得到，但要等很久。圖上 ① 的「pole = 1」就是 F-09.4 在 {m`\lambda_i=0`} 時的 {m`p_i=1`}；② 就是 F-09.9 的 PE 定義；③ 的 {m`k_{95}\approx\ln20/(g\lambda_{\min})`}
          就是 F-09.6 的近似式。下表把圖上每一種對策（以及兩種常見但沒用的做法）的效果列出來：
        </p>
        <div className="table-wrap">
          <table className="ch09-table">
            <thead>
              <tr>
                <th className="ch09-left">手段</th>
                <th className="ch09-left">對 {m`\lambda_{\min}`}／{m`\kappa`} 的影響</th>
                <th className="ch09-left">對慢模式</th>
                <th className="ch09-left">對雜訊</th>
                <th className="ch09-left">能救 {m`\lambda_{\min}=0`} 嗎？</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="ch09-left">加大 {m`\mu`}</td>
                <td className="ch09-left">不變</td>
                <td className="ch09-left">變快，但受 {m`g<2/\lambda_{\max}`} 限制，最好也只有 {m`(\kappa-1)/(\kappa+1)`}</td>
                <td className="ch09-left">變大</td>
                <td className="ch09-left">不能</td>
              </tr>
              <tr>
                <td className="ch09-left">加長 GMAC {m`N`}</td>
                <td className="ch09-left">不變（{m`\mathbf R`} 是平均）</td>
                <td className="ch09-left">每 block 一樣慢（但每 block 更久）</td>
                <td className="ch09-left">變小；且讓 mean-square 接近 mean（E23）</td>
                <td className="ch09-left">不能</td>
              </tr>
              <tr>
                <td className="ch09-left">Preconditioner {m`\mathbf M=\gamma(K_q\mathbf R)^{-1}`}（<ChRef ch="10">第 10 章</ChRef>：{m`\mathbf M`} 是矩陣步長、{m`\gamma`} 是無因次步長）</td>
                <td className="ch09-left">等效 {m`\kappa\to1`}</td>
                <td className="ch09-left">所有 pole {m`=1-\gamma`}</td>
                <td className="ch09-left">慢方向雜訊被放大 {m`\propto1/\lambda_{\min}`}</td>
                <td className="ch09-left">不能（無法求逆）</td>
              </tr>
              <tr>
                <td className="ch09-left">改善激發（code randomization、dither、training sequence）</td>
                <td className="ch09-left">{m`\lambda_{\min}\uparrow`}、{m`\kappa\downarrow`}</td>
                <td className="ch09-left">真正變快</td>
                <td className="ch09-left">可能增加 spur／jitter（第 12、13 章）</td>
                <td className="ch09-left">能（若新激發覆蓋該方向）</td>
              </tr>
              <tr>
                <td className="ch09-left">約束／重新參數化（gauge fixing）</td>
                <td className="ch09-left">移除零方向</td>
                <td className="ch09-left">剩下的參數可辨識</td>
                <td className="ch09-left">不變</td>
                <td className="ch09-left">能（只學可辨識的組合）</td>
              </tr>
              <tr>
                <td className="ch09-left">Leakage／regularization</td>
                <td className="ch09-left">等效 {m`\lambda_i\to\lambda_i+\varepsilon`}（{m`\varepsilon`} 是 leakage 的強度；{m`\mathbf I-\mu(K_q\mathbf R+\varepsilon\mathbf I)`}）</td>
                <td className="ch09-left">被拉向先驗值</td>
                <td className="ch09-left">有界</td>
                <td className="ch09-left">只能讓它「有界且有 bias」</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          重點：<strong>穩定性由 {m`\lambda_{\max}`} 決定，可辨識性與速度由 {m`\lambda_{\min}`} 決定。</strong>任何只改 {m`\mu`}、{m`N`} 的作法都改變不了 {m`\lambda_{\min}`}；要嘛改激發，要嘛改參數化。
          <ClaimTag kind="exact" />（mean recursion 下；「速度由 {m`\lambda_{\min}`} 決定」指 {m`g\le g^\star=2/(\lambda_{\max}+\lambda_{\min})`}，{m`g`} 更大時最慢的是
          {m`\lambda_{\max}`} 的模式，F-09.7）
        </p>
      </Section>

      <Section kind="example" title="綜合手算：把這一課串起來" level={2} id="ch09-synthesis">
        <p>
          做思考題之前，先把整章的三件事用同一組數字串起來：<strong>穩定</strong>看 {m`g\lambda_{\max}`}、<strong>速度</strong>看 {m`g\lambda_{\min}`}（{m`g\le g^\star`} 時）、
          <strong>PE</strong> 看每一個窗口。這一題用的是物理單位（1-bit comparator 的 {m`\sigma_v`} 與 {m`\mu`} 都以 {m`\mathrm{fs}`} 計），所以第一步就是把 {m`\mu`} 換成無因次的 {m`g=\mu K_q`}（<ChapterErratum id="E05" />）。
        </p>
        <Diagram id="synthesis-flow">
          跟著 ① → ⑧ 算：前兩格換單位，藍色菱形檢查穩定，接著算速度，最後兩格回到「每一個窗口」。
        </Diagram>
        <p>
          <FigRef id="synthesis-flow" /> 怎麼看：先看 ①②——{m`\sigma_v`}（comparator 前雜訊的標準差）決定 {m`K_q`}，{m`K_q`} 把帶單位的 {m`\mu`} 換成無因次的 {m`g`}。再看 ③④——穩定只看 {m`g\lambda_{\max}`}；⑤⑥——速度看 {m`g\lambda_{\min}`}（{m`g\le g^\star=2/(\lambda_{\max}+\lambda_{\min})`} 時，最慢的就是這個模式）。最後 ⑦⑧——長期平均沒問題，不代表每一個長度 {m`N_0`} 的窗口都沒問題。圖上 ①–⑧ 的每一格，就是下面手算題裡的一到兩個步驟（⑥ 是 F-09.6、⑦ 是 F-09.11、⑧ 是 F-09.12）。
        </p>
        <HandCalcBox id="HC-09.8">
          填入你的 {m`\sigma_v`}、{m`\mu`}、{m`\rho`} 與窗口長度 {m`N_0`}，用紙筆和工程計算機（{m`\sqrt{\ }`}、{m`\ln`}、{m`y^x`}）算出 {m`g`}、{m`k_{95}`}
          與退化窗口機率，再對答案。全站所有手算題都收在「手算練習簿」頁，可以隨機出題、列印成練習卷。
        </HandCalcBox>
      </Section>

      <Section kind="example" title="思考題" level={2} id="ch09-quiz">
        <Quiz
          title="思考題 1（計算）"
          question={
            <>
              {m`\rho=0.9`}、{m`g=\mu K_q=0.5`}。慢模式下降 95% 需要幾個 blocks？
            </>
          }
          options={[
            { label: '6' },
            { label: String(q1.k95), correct: true },
            { label: '598' },
            { label: '30' },
          ]}
          answer={
            <StepDerivation
              steps={[
                { tex: String.raw`\lambda=1\pm0.9=${texNum(q1.lambdas[0])},\ ${texNum(q1.lambdas[1])}`, why: <>{m`\lambda=1\pm\rho`}（F-09.5）。</> },
                { tex: String.raw`p_{\text{slow}}=1-0.5\cdot${texNum(q1.lambdas[1])}=${texNum(q1.poles[1])}`, why: <>{m`p=1-g\lambda_{\min}`}（F-09.4）。</> },
                { tex: String.raw`k_{95}=\lceil\ln0.05/\ln${texNum(q1.poles[1])}\rceil=\lceil${texNum(Math.log(0.05) / Math.log(q1.poles[1]), 5)}\rceil=${q1.k95}`, why: 'F-09.6。' },
              ]}
            />
          }
        />
        <Quiz
          title="思考題 2（gauge）"
          question={
            <>
              四相 one-hot ＋ global offset，真值 {m`(b,a_0,a_1,a_2,a_3)=(${q2.theta.join(',')})`}。哪一組參數對<strong>每一個</strong> one-hot 輸入都給出完全相同的 {m`y`}？
            </>
          }
          options={[
            { label: m`${q2.tuple(q2.both)}` },
            { label: m`${q2.tuple(q2.onlyA)}` },
            { label: m`${q2.tuple(q2.gauge)}`, correct: true },
            { label: m`${q2.tuple(q2.onlyB)}` },
          ]}
          answer={
            <>
              <p>
                必須是 {m`\boldsymbol\theta+c\,\mathbf n`}、{m`\mathbf n=(1,-1,-1,-1,-1)`}：{m`b`} 加多少、每個 {m`a_i`} 就要減多少。取 {m`c=${q2.c}`}：
                {m`b=${q2.theta[0]}+${q2.c}=${q2.gauge[0]}`}、{m`a_i-${q2.c}\ \Rightarrow\ ${q2.tuple(q2.gauge)}`}。
              </p>
              <StepDerivation
                steps={[
                  {
                    tex: String.raw`\text{第 0 相：}\ y=b+a_0=${q2.theta[0]}+${q2.theta[1]}=${q2.y(q2.theta, 0)},\qquad y'=${q2.gauge[0]}+(${q2.gauge[1]})=${q2.y(q2.gauge, 0)}`,
                    why: '驗算：輸出相同（其餘三相同理）。',
                  },
                  {
                    tex: String.raw`${q2.tuple(q2.both)}:\ y'=${q2.both[0]}+${q2.both[1]}=${q2.y(q2.both, 0)}\ne${q2.y(q2.theta, 0)}`,
                    why: <>{m`b`} 與 {m`a_i`} <strong>同時</strong>加 {m`${q2.c}`}：輸出多了 {m`${2 * q2.c}`}，不是 gauge。</>,
                  },
                  {
                    tex: String.raw`${q2.tuple(q2.onlyA)}:\ y'=${q2.y(q2.onlyA, 0)},\qquad ${q2.tuple(q2.onlyB)}:\ y'=${q2.y(q2.onlyB, 0)}`,
                    why: <>只動 {m`a_i`} 或只動 {m`b`}：輸出各差 {m`${q2.c}`}（raw-x domain 看得出來）。</>,
                  },
                ]}
              />
            </>
          }
        />
        <Quiz
          title="思考題 3（mean vs mean-square）"
          question={
            <>
              {m`z\sim\mathcal N(0,1)`}，{m`E[z^2]=1`}、{m`E[z^4]=3`}。{m`E[(1-z^2)^2]`} 等於多少？這說明 per-sample（{m`N=1`}）LMS 的什麼現象？
            </>
          }
          options={[{ label: '0' }, { label: '1' }, { label: '2', correct: true }, { label: '3' }]}
          answer={
            <p>
              {m`E[(1-z^2)^2]=1-2\cdot1+3=2`}。平均倍數 {m`E[1-z^2]=0`}（平均意義下共模一步消失），但平方的平均 {m`=2>1`}：均方每步約翻倍（{m`\rho=0.99`}、{m`g=0.5`} 時精確的 {m`\rho_{\mathrm{MS}}=${texNum(facts.msN1, 5)}`}）。<strong>mean 收斂不代表 mean-square 收斂</strong>（<ChapterErratum id="E23" />）。
            </p>
          }
        />
        <Quiz
          title="思考題 4（PLL DC null）"
          question={
            <>
              PLL 的 {m`H_{\mathrm{PD}}(1)=0`}。對四相 one-hot ＋ {m`b`} 的 5 個參數，若只做「固定 reference phase {m`a_0:=0`}」，{m`\mathbf R_u`} 還剩幾個零 eigenvalue？
            </>
          }
          options={[{ label: '0' }, { label: '1', correct: true }, { label: '2' }, { label: '3' }]}
          answer={
            <p>
              1 個：{m`b`} 方向。u-domain 的 null space 是 {m`\mathrm{span}\{\mathbf e_b,\ (0,1,1,1,1)\}`}（2 維）；{m`\{a_0=0\}`} 與它的交集只剩 {m`\mathbf e_b`}，固定 {m`a_0`} 只消掉共模那一維。要完全可辨識，還得「此路徑不更新 {m`b`}」或用獨立路徑量 {m`b`}（<ChapterErratum id="E04" />）。上方 Gauge 實驗的約束表會即時顯示這個結果。
            </p>
          }
        />
      </Section>

      <Recap
        title="本課必記"
        formulas={[
          { label: <>平均遞迴（linear 精確、1-bit 是小訊號近似；{m`K_q`} 明寫；mean，不是 mean-square）</>, tex: formulaTex('F-09.3') },
          { label: 'Eigen-mode pole', tex: String.raw`p_i=1-\mu K_q\lambda_i(\mathbf R),\qquad k_{95}=\lceil\ln0.05/\ln|p|\rceil` },
          { label: String.raw`$2\times2$ 例子`, tex: String.raw`\lambda=1\pm\rho,\ \mathbf v=(1,\pm1)/\sqrt2,\ \kappa=\frac{1+|\rho|}{1-|\rho|}\quad(\rho=.99:\ 1.99,\ 0.01,\ 199)` },
          {
            label: 'PE（有限窗口；每一個 $k$）',
            tex: String.raw`\alpha\mathbf I\preceq\mathbf S_k=\sum_{n=k}^{k+N_0-1}\mathbf u[n]\mathbf u^T[n]\preceq\beta\mathbf I\iff\lambda_{\min}(\mathbf S_k)\ge\alpha\ \text{且}\ \lambda_{\max}(\mathbf S_k)\le\beta`,
          },
          { label: 'Gauge', tex: String.raw`\tilde{\mathbf x}^T\mathbf n=0,\ \mathbf n=(1,-1,-1,-1,-1);\quad H_{\mathrm{PD}}(1)=0\Rightarrow\dim\mathcal N(\mathbf R_u)=2` },
        ]}
        points={[
          <>
            穩定看 {m`\lambda_{\max}`}（{m`0<g<2/\lambda_{\max}`}），速度看 {m`\lambda_{\min}`}（{m`g\le g^\star=2/(\lambda_{\max}+\lambda_{\min})`} 時；{m`g`} 更大，最慢的換成
            {m`\lambda_{\max}`} 的模式）；{m`\kappa`} 大時任何單一 {m`\mu`} 都快不起來。
          </>,
          <>{m`\lambda_{\min}=0`} 的方向不可辨識：pole {m`=1`}，誤差永遠停在初值。加大 {m`\mu`}、加長 {m`N`}、跑更久都沒用。</>,
          <>
            規格的「{m`\mu=0.5\to${texNum(facts.pSlow)}\to${facts.k95}`}」是 {m`g=\mu K_q=0.5`}、mean recursion 的結論；物理 {m`K_q`}（{m`\sigma_v=100\,\mathrm{fs}`}、{m`\mu=0.5\,\mathrm{fs}`}）時是{' '}
            {facts.k95Phys.toLocaleString('en-US')} blocks（1-bit，小訊號近似），linear detector、{m`N=1`}
            Gaussian 時均方發散。
          </>,
          <>PE 是對<strong>每一個窗口</strong>的要求；量過幾段時間的 {m`\lambda_{\min}(\mathbf R_k)`} 不等於證明 PE（{m`\pm1`} code、{m`\rho=0.99`}、{m`N_0=100`} 時 {m`${texNum(facts.degPct, 3)}\%`} 的窗口退化）。</>,
          <>One-hot ＋ global offset 天生有 1 維 gauge；經 {m`H_{\mathrm{PD}}(1)=0`} 的 PLL 後變 2 維，{m`b`} 完全不可觀察，必須另找路徑或不更新。</>,
        ]}
      />

      <Section kind="diagram" title="連結到 PLL 硬體" level={2} id="ch09-pll">
        <ul>
          <li>
            <strong>{m`\lambda_{\min}`} 對應什麼硬體？</strong> 兩個校正係數的 regressor 在 PD 端的「差」的能量。多段 DTC gain、INL 基底函數若由同一個 DSM residue
            的相近函數驅動，差模能量很小。
          </li>
          <li>
            <strong>PMUX / PHOS：</strong> one-hot 相位選擇天生滿足 {m`\sum_ix_i=1`}，與 global offset 形成 gauge；在主 PLL 鎖定（BBPD 的輸出同時驅動 loop filter，也是 GMAC 取用的 {m`e`}）的架構裡，DC 被主迴路吃掉，{m`b`} 完全看不到。
          </li>
          <li>
            <strong>相數不是 4（例如 8 相 PMUX）：</strong> 結論完全相同，只換數字。{m`P`} 相 one-hot ＋ 共用 offset 的
            {m`\mathbf R_x`} eigenvalues 是 {m`\{1+\tfrac1P,\ \tfrac1P\ (\times(P-1)),\ 0\}`}：
            {phases.map((ph, i) => (
              <span key={ph.P}>
                {i > 0 ? '；' : ''}
                {m`P=${ph.P}`} 時為 {m`${texNum(ph.max, 6)},\ ${texNum(ph.mid, 6)}\ (\times${ph.midCount}),\ 0`}（{ph.nulls} 個零）
              </span>
            ))}
            （由 <code>eigSym</code> 計算）。null vector 仍是 {m`(1,-1,\dots,-1)`}；經 {m`H_{\mathrm{PD}}(1)=0`} 後只剩 {m`P-1`} 個可辨識的相位差，F-09.19 的 {m`\tfrac54`} 換成 {m`1+\tfrac1P`}。
          </li>
          <li>
            <strong>GMAC 的 {m`N`}：</strong> 不改變 {m`\mathbf R`}，但決定 mean-square 是否接近 mean（E23）以及雜訊大小（<ChRef ch="12">第 12 章</ChRef>）。
          </li>
          <li>
            <strong>Sign-off 時要量什麼：</strong> 行為模型輸出滑動窗口 {m`\lambda_{\min}(\mathbf R_k)`}、{m`\kappa(\mathbf R_k)`}、singular values，並跨 FCW／PVT 掃描；對任何零方向都要有明確的處理（約束、不更新、獨立路徑）。
          </li>
        </ul>
        <Callout kind="info" title="下一課">
          <ChRef ch="10">第 10 章</ChRef>：既然單一 {m`\mu`} 受 {m`\kappa`} 限制，能不能用矩陣 {m`\mathbf M`} 讓每個模式一樣快？可以（preconditioner），但代價是把慢方向的雜訊放大——而且 <strong>preconditioner 不能製造缺失的資訊</strong>。
        </Callout>
      </Section>
    </>
  )
}
