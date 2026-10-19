import type { ReactNode } from 'react'
import { Callout, ClaimTag, CodeBlock, MathText, ModeGate, Quiz, Section, Tex, TexBlock, ChRef } from '@/components'
import { studentTInv } from '@/simulation/core'
import judgesSrc from '../judges.ts?raw'
import stabilitySrc from '@/simulation/models/stability.ts?raw'
import {
  accumulatorBitsRequired,
  regPinvM,
  delayPoles,
  effectiveSamples,
  efbSequence,
  errorPower,
  gCrit,
  jacobianRobustness,
  kq,
  mimoJudge,
  negateWorstCaseSum,
  noiseGainSum,
  pmDeg,
  spurDbc,
  wrapTwos,
} from '../judges'
import { CornerJudgeExperiment } from '../experiments/CornerJudge'
import { FixedPointJudgeExperiment } from '../experiments/FixedPointJudge'
import { MimoJudgeExperiment } from '../experiments/MimoJudgeLab'
import { CHART_CORNER_JUDGE, CHART_MIMO_LOOP, CHART_OUTPUT_PATH } from '../diagrams'
import { Diagram, ErratumNote, HandCalcSlot, Steps, nf, tx } from '../shared'

const PATH = 'src/pages/signoff/judges.ts'

/** 角度的 TeX：把浮點殘差（|x| < 1e-9）顯示成 0；數值用大括號包住，避免科學記號的指數與 ^\circ 形成雙重上標。 */
const degTex = (x: number) => (Number.isFinite(x) ? `{${tx(Math.abs(x) < 1e-9 ? 0 : x, 4)}}^\\circ` : '\\text{—}')

/** §4–§8：每一列的判準數學 + 判斷器。`afterCorner` 放在 §4（Corner）之後、§5 之前（§4b PVT corner 表，index.tsx 傳進來）。 */
export function S4Cases({ afterCorner }: { afterCorner?: ReactNode } = {}) {
  // Corner：g_crit 表與一個例子（即時計算）
  const crit = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ d, g: gCrit(d), w: Math.PI / (2 * d + 1) }))
  const g1 = 1
  const pm1 = [0, 1, 2].map((d) => pmDeg(g1, d))
  const rho1d1 = delayPoles(1, 1).rho
  // Noise：T13 條件
  const K = kq(100)
  const mu = 10
  const N = 4096
  const p = 1 - mu * K
  const sw = mu * Math.sqrt((1 / N) * noiseGainSum(mu * K, 0))
  const eff = effectiveSamples(10_000, p)
  const t7 = studentTInv(0.975, 7)
  // Fixed point
  const bits = accumulatorBitsRequired(6, 4096)
  const negMax = negateWorstCaseSum(6, 4096)
  const efb5 = efbSequence(162, 5, 5, 'round').y
  const efbPow = errorPower(efb5, 32.4)
  // MIMO T18
  const t18 = mimoJudge([[-1, 2], [2, -1]], [[0.2, 0], [0, 0.2]])
  // Research：Ĵ 誤差的 Bauer–Fike 穩健性（E24 的例子）
  const Jt = [[-1, -0.99], [-0.99, -1]]
  const Jh = [[-1, -0.996], [-0.996, -1]]
  const rob0 = jacobianRobustness(Jt, Jh, regPinvM(Jh, 1, 0))
  const rob4 = jacobianRobustness(Jt, Jh, regPinvM(Jh, 1, 1e-4))
  // Spur（T15 條件）
  const spur = spurDbc(13e9, 0.5)

  return (
    <>
      <Section kind="formula" level={2} title={String.raw`4. Corner：同一個 $\mu$ 要通過最慢與最快的 corner`} id="so-corner">
        <p>
          每個 corner（PVT、PLL BW、mode）都有自己的 <Tex>{'K^{(c)}=K_q(\\sigma_{v,c})\\,C_c'}</Tex>。硬體只有一組 <Tex>{'\\mu'}</Tex>：
          <strong>最快</strong>的 corner（<Tex>{'K_{\\max}'}</Tex>）決定穩定與 PM 的上限，<strong>最慢</strong>的 corner（<Tex>{'K_{\\min}'}</Tex>）決定收斂時間與 bias 的下限。再加上真實硬體的 commit latency <Tex>{'d'}</Tex>，一階模型的 <Tex>{'0<g<2'}</Tex> 就不再適用。
        </p>
        <Diagram
          chart={CHART_CORNER_JUDGE}
          caption={String.raw`Corner 判準：同一組 $(\mu,d,N)$ 對每個 corner 各算一個 $K_c$ 和 $g_c$，五項判準全部通過，這個 $\mu$ 才可行；$\rho<1$ 才有收斂時間與穩態雜訊可談。`}
          ariaLabel="Corner 判準流程圖：corner 清單與同一組 mu、d、N 算出每個 corner 的恢復力 K 與迴路增益 g，依序檢查極性、穩定、相位裕度，穩定之後才檢查收斂時間與雜訊，所有 corner 的五項判準都通過才算這個 mu 可行"
        >
          <p>
            先看最上面兩個圓角框：硬體只有<strong>一組</strong> <Tex>{'(\\mu,d,N)'}</Tex>，corner 卻有很多個，每個 corner 的 <Tex>{'\\sigma_{v,c}'}</Tex>、<Tex>{'\\theta_c'}</Tex> 不同，所以 <Tex>{'K_c'}</Tex> 與 <Tex>{'g_c=\\mu K_c'}</Tex> 也不同。通常<strong>最快</strong>的 corner（<Tex>{'K_{\\max}'}</Tex>）先卡住穩定與 PM，<strong>最慢</strong>的（<Tex>{'K_{\\min}'}</Tex>）先卡住收斂時間與 bias。
          </p>
          <p>
            藍色的「穩定」是其他兩項的前提：<Tex>{'z^{d+1}-z^d+g_c=0'}</Tex> 的根都在單位圓內（<Tex>{'\\rho<1'}</Tex>），<Tex>{'k_{95}'}</Tex>（收斂 95% 需要的 block 數）與 <Tex>{'\\sigma_w'}</Tex> 才有有限的值；不穩定的 corner 這兩項直接是 <Tex>{'\\infty'}</Tex>。
          </p>
        </Diagram>
        <Steps
          title="更新延遲 $d$ 時的 PM 與臨界增益"
          steps={[
            { tex: String.raw`\delta_{k+1}=\delta_k-g\,\delta_{k-d}\ \Rightarrow\ L(z)=\frac{g\,z^{-d}}{z-1}`, why: String.raw`把「積分器 $1/(z-1)$」與「延遲 $z^{-d}$」串起來，就是 calibration loop 的開迴路增益。` },
            { tex: String.raw`|L(e^{j\omega_c})|=1\iff|e^{j\omega_c}-1|=g\iff2\sin\frac{\omega_c}{2}=g`, why: String.raw`單位圓上 $|z^{-d}|=1$；$|e^{j\omega}-1|=2\sin(\omega/2)$（三角恆等式）。` },
            { tex: String.raw`\angle L(e^{j\omega_c})=-d\,\omega_c-\Big(\frac\pi2+\frac{\omega_c}{2}\Big)`, why: String.raw`$e^{j\omega}-1=2j\sin(\omega/2)\,e^{j\omega/2}$ 的相位是 $\pi/2+\omega/2$，放在分母要變號；延遲貢獻 $-d\omega$。` },
            { tex: String.raw`PM_d=\pi+\angle L=\frac\pi2-\frac{(2d+1)\,\omega_c}{2}=90^\circ-(2d+1)\arcsin\frac g2`, why: String.raw`PM 定義為相位距離 $-180^\circ$ 還有多少。` },
            { tex: String.raw`PM_d=0\iff\arcsin\frac g2=\frac{90^\circ}{2d+1}\iff g_\text{crit}(d)=2\sin\frac{\pi}{4d+2}`, why: String.raw`PM 歸零時 crossover 正好落在單位圓上的根（角度 $\omega_c=\pi/(2d+1)$）。` },
          ]}
          result={String.raw`0<\mu K_{\max}<g_\text{crit}(d),\qquad PM_d(\mu K_{\max})\ge PM_t`}
        />
        <TexBlock id="F-SO.5" label="更新延遲下的 PM 與臨界增益">{String.raw`PM_d(g)=90^\circ-(2d+1)\arcsin\frac g2,\qquad g_\text{crit}(d)=2\sin\frac{\pi}{4d+2}`}</TexBlock>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <Tex>{'d'}</Tex> [blocks]
                </th>
                {crit.map((c) => (
                  <th key={c.d} className="num">
                    {c.d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Tex>{'g_\\text{crit}(d)'}</Tex>
                </td>
                {crit.map((c) => (
                  <td key={c.d} className="num">
                    {nf(c.g, 6)}
                  </td>
                ))}
              </tr>
              <tr>
                <td>臨界根的角度 <Tex>{'\\pi/(2d+1)'}</Tex> [rad]</td>
                {crit.map((c) => (
                  <td key={c.d} className="num">
                    {nf(c.w, 5)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          例：<Tex>{'g=1'}</Tex> 在 <Tex>{'d=0'}</Tex> 時 <Tex>{`PM_0=${degTex(pm1[0])}`}</Tex>（T08）；<Tex>{'d=1'}</Tex> 時 <Tex>{`PM_1=${degTex(pm1[1])}`}</Tex>（正好臨界，spectral radius {nf(rho1d1, 6)}）；
          <Tex>{'d=2'}</Tex> 時 <Tex>{`PM_2=${degTex(pm1[2])}`}</Tex>（已不穩定）。<ClaimTag kind="exact" />（在線性化一階模型內）
        </p>
        <ErratumNote id="E16">
          §14.1 的 <Tex>{'\\mu'}</Tex> 區間中 <Tex>{'\\epsilon'}</Tex> 是「相對縮減比」（<Tex>{'0<\\epsilon<1'}</Tex>），不是絕對誤差；只約束平均誤差，RMS 要另外檢查。
        </ErratumNote>
        <HandCalcSlot id="HC-SO.4">
          預設值是下面 Corner 判斷器預設的兩列：最快的 FF 125°C（<Tex>{'\\sigma_v=70\\,\\mathrm{fs}'}</Tex>、<Tex>{'\\theta=10^\\circ'}</Tex>）與最慢的 near-grid FCW（<Tex>{'\\sigma_v=100\\,\\mathrm{fs}'}</Tex>、<Tex>{'\\theta=60^\\circ'}</Tex>），<Tex>{'\\mu=10\\,\\mathrm{fs}'}</Tex>、<Tex>{'d=1'}</Tex>。把 <Tex>{'B'}</Tex> 改成 50，或把 <Tex>{'\\mu'}</Tex> 改成 40，看哪一個 corner 先不合格。
        </HandCalcSlot>
        <p>
          <strong>
            收斂時間 <Tex>{'k_{95}'}</Tex> 怎麼數：
          </strong>
          平均誤差 <Tex>{'y_{k+1}=y_k-g\\,y_{k-d}'}</Tex>（初始歷史 <Tex>{'y_j=1'}</Tex>）是常係數線性遞迴，解一定是特徵式 <Tex>{'z^{d+1}-z^d+g=0'}</Tex> 的 <Tex>{'d+1'}</Tex> 個極點的組合 <Tex>{'y_k=\\sum_i c_i\\lambda_i^k'}</Tex>（重根補 <Tex>{'k\\lambda^k'}</Tex> 項；係數 <Tex>{'c_i'}</Tex> 由 <Tex>{'d+1'}</Tex> 個初始條件解線性方程組）。判斷器就用這個模態展開逐步求值，取最後一次 <Tex>{'|y_k|>0.05'}</Tex> 的下一個 block；「之後不再超過」由三角不等式上界 <Tex>{'\\sum_{i,p}|c_{i,p}|\\,k^p\\rho_i^k\\le0.05'}</Tex>（<Tex>{'\\rho_i=|\\lambda_i|'}</Tex>；重根才有 <Tex>{'p\\ge1'}</Tex> 的項）證明。和 <a href="#/">首頁</a>「六條件一分鐘體檢」逐 block 遞推（settleDelayed）得到相同的數字（測試在 <Tex>{'d=0\\ldots6'}</Tex> 的整個穩定區逐點比對，差 <Tex>{'<1'}</Tex> 步）。<ClaimTag kind="exact" />（在線性化平均模型內）
          <Tex>{'d=0'}</Tex> 時它等於 <Tex>{'\\lceil\\ln0.05/\\ln\\rho\\rceil'}</Tex>；<Tex>{'d\\ge1'}</Tex> 時 <Tex>{'\\rho^k'}</Tex> 不是誤差的包絡（留數 <Tex>{'c_i'}</Tex> 與複根的振盪都被丟掉），那個式子只當「<Tex>{'\\rho'}</Tex> 漸近估計」另列、不拿來判定 <ClaimTag kind="approx" />（例：<Tex>{'d=1'}</Tex>、<Tex>{'g=0.25'}</Tex> 是重根 <Tex>{'z=0.5'}</Tex>，<Tex>{'y_k=(k+2)/2^{k+1}'}</Tex>，估計給 5，模態展開要 7，所以 <Tex>{'B=6'}</Tex> 時只看 <Tex>{'\\rho'}</Tex> 會誤判通過）。
        </p>
        <p className="small muted">
          單一 corner 的 <Tex>{'PM_d'}</Tex>、<Tex>{'g_\\text{crit}(d)'}</Tex> 與 <Tex>{'\\mu_{\\max}'}</Tex> 的手算題在 <a href="#/ch/08">Ch08</a>；corner 區間與 <Tex>{'B'}</Tex> 的下限在 <a href="#/ch/14">Ch14</a>。本頁這一題把兩者接起來：同一個 <Tex>{'\\mu'}</Tex> 要同時過兩個 corner。
        </p>
        <CornerJudgeExperiment />
        <CodeBlock source={judgesSrc} region="cornerJudge" path={PATH} title="每個 corner 的判準" />
        <CodeBlock source={judgesSrc} region="delayPoles" path={PATH} title="$z^{d+1}-z^d+g=0$ 的根" />
        <CodeBlock source={stabilitySrc} region="settleFromPoles" path="src/simulation/models/stability.ts" title={String.raw`$k_{95}$：用極點的模態展開逐步求值，上界 $\sum|c|k^p\rho^k\le0.05$ 證明之後不再超過`} />
      </Section>

      {afterCorner}

      <Section kind="formula" level={2} title="5. FCW 與 Noise：靠近 0 的 $C$ 與「多 seeds」的統計" id="so-fcw-noise">
        <h3>
          5.1 FCW：<Tex>{'C'}</Tex> 變小時，bias 被放大
        </h3>
        <Steps
          title="Near-integer 的固定點敏感度"
          steps={[
            { tex: String.raw`E[G(w)]\approx K_q\big(C\,(a-w)+B_\text{bias}\big)`, why: String.raw`線性化：恢復力項 + 與 code 相關的干擾 bias 項 $B_\text{bias}=bE[x]+E[x\,d(x)]+E[x\,\varepsilon_{cc}]$（E12 的命名）。` },
            { tex: String.raw`E[G(w^*)]=0\ \Rightarrow\ w^*\approx a+\frac{B_\text{bias}}{C}`, why: String.raw`固定點的定義是 $E[G(w^*)]=0$；把上一步線性化的 $E[G]$ 代進去解出來，所以是 $\approx$（線性化在 $w^*$ 處也要成立，見下面的說明）。` },
            { tex: String.raw`\frac{\partial w^*}{\partial C}=-\frac{B_\text{bias}}{C^2}`, why: String.raw`對 $C$ 微分：$C\to0$ 時敏感度以 $1/C^2$ 爆增。` },
            { tex: String.raw`C<0:\ \ \frac{\partial E[G]}{\partial w}=-K_qC>0\ \Rightarrow\ w^*\text{ 是 repelling point}`, why: String.raw`斜率變號：$w$ 比 $w^*$ 大一點時 $E[G]>0$，更新 $w\leftarrow w+\mu G$ 把它推得更遠——固定點在代數上仍存在，但迴路會離開它（不可達）。` },
            { tex: String.raw`C=0:\ \ E[G(w)]\approx K_qB_\text{bias}\ \ (\text{與 }w\text{ 無關})\ \Rightarrow\ \text{沒有固定點}`, why: String.raw`恢復力項消失後，GMAC 只剩與 $w$ 無關的 bias：$B_\text{bias}\ne0$ 時 $w$ 以每個 block $\mu K_qB_\text{bias}$ 的速度一路漂到 rail。這是 keep-out FCW 的典型失效樣貌。` },
          ]}
        />
        <p>
          所以 FCW sweep 要同時報 <Tex>{'\\hat C(\\mathrm{FCW})'}</Tex> 與 <Tex>{'|B_\\text{bias}/\\hat C|'}</Tex>；兩者任一不合格的 FCW 進 keep-out 清單。
          <Tex>{'|B_\\text{bias}/\\hat C|'}</Tex> 是線性化的值（第一步用了 <Tex>{'E[q]\\approx K_qs'}</Tex>）：把 <Tex>{'w=a+B_\\text{bias}/\\hat C'}</Tex> 代回去，comparator 前的確定性殘差 <Tex>{'e_\\text{det}[n]'}</Tex>（不含雜訊 <Tex>{'v'}</Tex> 的部分）也跟著 <Tex>{'1/\\hat C'}</Tex> 變大。它大到讓 comparator 飽和（<Tex>{String.raw`\max_n|e_\text{det}[n]|>0.3\,\sigma_v`}</Tex>）時，<Tex>{'a+B_\\text{bias}/\\hat C'}</Tex> 只是線性外推，不能再當作固定點（Sign-LMS 可能沒有吸引的固定點），這種 FCW 也進 keep-out（<a href="#/ch/11">Ch11 §11.4</a>）。PE 則看滑動窗資訊矩陣的 <Tex>{'\\lambda_{\\min}'}</Tex>——但有限窗只能證明「量過的窗」，不能證明未來所有窗（規格 §9.1）。
        </p>
        <ErratumNote id="E12">
          §11 的干擾改名 <Tex>{'\\varepsilon_{cc}'}</Tex>（避免與 <Tex>{'u=h*x'}</Tex> 衝突）；§11.4 的 <Tex>{'C'}</Tex> 與 §6 相同，<Tex>{'B'}</Tex> 為 <Tex>{'B_\\text{bias}'}</Tex>。
        </ErratumNote>

        <h3>
          5.2 Noise：<Tex>{'\\sigma_w'}</Tex> 的解析值與「多 seeds」
        </h3>
        <p>
          T13 條件（unit-RMS code、identity path、average GMAC、<Tex>{'N=4096'}</Tex>、<Tex>{'\\mu=10\\,\\mathrm{fs}'}</Tex>、<Tex>{'\\sigma_v=100\\,\\mathrm{fs}'}</Tex>）：
          <Tex>{`g=\\mu K_q=${tx(mu * K, 6)}`}</Tex>，<Tex>{`p=${tx(p, 8)}`}</Tex>，<Tex>{`\\sigma_w=\\mu\\sigma_\\eta/\\sqrt{1-p^2}=${tx(sw, 6)}\\,\\mathrm{fs}`}</Tex>（gain-equivalent，不是 output jitter）。
        </p>
        <Steps
          title="為什麼「一條很長的軌跡」不等於很多個獨立樣本"
          steps={[
            { tex: String.raw`\delta w_{k+1}=p\,\delta w_k+\mu\eta_k\ \Rightarrow\ \mathrm{corr}(\delta w_k,\delta w_{k+\ell})=p^{|\ell|}`, why: 'AR(1)：相鄰 block 的係數誤差高度相關（$p$ 接近 1）。' },
            { tex: String.raw`\mathrm{Var}\Big(\frac1K\sum_k\delta w_k\Big)\approx\frac{\sigma_w^2}{K}\cdot\frac{1+p}{1-p}`, why: '相關的樣本平均：變異數放大 $(1+p)/(1-p)$ 倍（等比數列求和）。' },
            { tex: String.raw`K_\text{eff,mean}=K\frac{1-p}{1+p},\qquad K_\text{eff,var}\approx K\frac{1-p^2}{1+p^2}`, why: String.raw`等效獨立樣本數；估計 $\sigma_w^2$ 時用後者。` },
          ]}
          result={String.raw`K=10^4,\ p=${tx(p, 5)}\ \Rightarrow\ K_\text{eff,mean}\approx${tx(eff.forMean, 4)},\ \ K_\text{eff,var}\approx${tx(eff.forVariance, 4)}`}
        />
        <p>
          做法：跑 <Tex>{'n'}</Tex> 個<strong>獨立 seeds</strong>，每個 seed 丟掉暫態後估一個 <Tex>{'\\hat\\sigma_{w,i}'}</Tex>，再對 <Tex>{'\\{\\hat\\sigma_{w,i}\\}'}</Tex> 做 Student-t CI：
          <Tex>{'\\bar x\\pm t_{0.975,n-1}s/\\sqrt n'}</Tex>，8 個 seeds 時 <Tex>{`t_{0.975,7}=${tx(t7, 5)}`}</Tex>。解析值落在 CI 內才算「交叉比對通過」。
          <ClaimTag kind="approx" />
        </p>
        <ErratumNote id="E30">
          T13 必須連同前提一起寫：unit-RMS code、identity path（<Tex>{'C=E[x^2]=1'}</Tex>）、average GMAC、<Tex>{'\\sigma_\\eta^2\\approx1/N'}</Tex>；換成 sum 模式時 <Tex>{'g'}</Tex> 乘 <Tex>{'N'}</Tex>，會發散。
        </ErratumNote>
        <ErratumNote id="E06">
          12.9 kHz 是 <Tex>{'-3\\,\\mathrm{dB}'}</Tex> corner，不是 noise bandwidth；積分白雜訊要用 ENBW（約為 <Tex>{'\\pi/2'}</Tex> 倍）。
        </ErratumNote>
      </Section>

      <Section kind="formula" level={2} title="6. 非線性與定點：累加器位元、shift、limit cycle" id="so-fixed">
        <Steps
          title="GMAC 累加器需要幾個 bit"
          steps={[
            { tex: String.raw`p[n]\equiv q[n]\,x[n]\in[-2^{B_x-1},\,2^{B_x-1}-1]`, why: String.raw`假設被累加的每一筆乘積仍是有號 $B_x$-bit：code 範圍對稱，或 conditional negate 把 $-(-2^{B_x-1})$ 飽和成 $2^{B_x-1}-1$。` },
            { tex: String.raw`-N\,2^{B_x-1}\ \le\ \sum_{n=1}^{N}p[n]\ \le\ N\,(2^{B_x-1}-1)`, why: '最壞情況：每一筆都取同一個端點（N 筆相加就是乘 N）。' },
            { tex: String.raw`-2^{B_\text{acc}-1}\le-N\,2^{B_x-1}\iff B_\text{acc}-1\ge(B_x-1)+\log_2N`, why: String.raw`$B_\text{acc}$-bit two’s complement 能表示 $[-2^{B_\text{acc}-1},\,2^{B_\text{acc}-1}-1]$；負端要求較嚴，兩邊取 $\log_2$。` },
            { tex: String.raw`N\,(2^{B_x-1}-1)\le2^{B_\text{acc}-1}-1`, why: String.raw`正端自動成立：左邊 $=N2^{B_x-1}-N\le2^{B_\text{acc}-1}-N\le2^{B_\text{acc}-1}-1$（因為 $N\ge1$）。` },
          ]}
          result={String.raw`B_\text{acc}\ge B_x+\lceil\log_2N\rceil\quad(6\text{-bit}\times4096\Rightarrow${bits})`}
        />
        <TexBlock id="F-SO.10" label="累加器位元與 shift scaling">{String.raw`B_\text{acc}\ge B_x+\lceil\log_2N\rceil,\qquad G_\text{shift}=\frac{\sum q\,x}{2^s}=\frac{N}{2^s}\,G_\text{avg}`}</TexBlock>
        <Callout kind="warn" title="差 1 個 count 的角落：conditional negate 沒有飽和">
          若 RTL 的 conditional negate 輸出多 1 bit（不飽和），<Tex>{'q=-1'}</Tex> 遇到 <Tex>{'x=-2^{B_x-1}'}</Tex> 時乘積是 <Tex>{'+2^{B_x-1}'}</Tex>。<Tex>{'N'}</Tex> 筆全中的總和
          <Tex>{String.raw`N\,2^{B_x-1}=${negMax}`}</Tex>（6-bit × 4096）比 {bits}-bit 可表示的最大值 <Tex>{`2^{${bits - 1}}-1=${2 ** (bits - 1) - 1}`}</Tex> 多 1，wrap 後變成 <Tex>{`${wrapTwos(negMax, bits)}`}</Tex>——正的最大相關被讀成負的最大相關。簽核時要確認三者之一：code 範圍對稱、negate 有飽和，或再加 1 個 guard bit（規格 §16.1-3 的「guard bits」）。
        </Callout>
        <p className="small muted">
          想用自己的 <Tex>{'B_x'}</Tex>、<Tex>{'N'}</Tex>、<Tex>{'B_\\text{acc}'}</Tex> 手算位元數、wrap 後的值與右移的比例：<a href="#/ch/04">Ch04</a> 的手算題（GMAC 累加器要幾個 bit、位元不夠時 wrap 成多少、sum 與 average 差幾倍）已經涵蓋，本頁不重複出題。
        </p>
        <Steps
          title="一階 error-feedback quantizer 對常數目標必有週期"
          steps={[
            { tex: String.raw`v[k]=c+r[k-1],\quad y[k]=Q(v[k]),\quad r[k]=v[k]-y[k]`, why: '一階 EFB：把上一次的量化誤差加回來。' },
            { tex: String.raw`r[k]=r[k-1]+c-y[k]\ \Rightarrow\ r[k]=r[-1]+(k+1)c-\sum_{i\le k}y[i]`, why: '展開遞迴；$y[i]$ 都是整數。' },
            { tex: String.raw`r[k]\equiv r[-1]+(k+1)c\pmod 1`, why: String.raw`整數和不影響小數部分（floor 時 $r\in[0,1)$；round 時 $r\in[-\tfrac12,\tfrac12)$）。` },
            { tex: String.raw`c=\frac Pq\ (\gcd(P,q)=1)\ \Rightarrow\ (k+1)c\bmod1\ \text{的週期為 }q`, why: String.raw`$\{kP\bmod q\}$ 走遍 $0,\dots,q-1$ 才回到起點（$P$ 與 $q$ 互質）；所以殘差 $r[k]$ 的週期恰為 $q$。` },
            { tex: String.raw`y[k]=c+r[k-1]-r[k]\ \Rightarrow\ y[k+q]=y[k]`, why: String.raw`輸出由相鄰兩個殘差決定，所以 $y$ 也以 $q$ 為週期（它的最小週期 $T$ 整除 $q$）。` },
            { tex: String.raw`\sum_{k=1}^{q}y[k]=q\,c+r[0]-r[q]=P=\frac qT\sum_{k=1}^{T}y[k]\ \Rightarrow\ \frac qT\ \Big|\ P\ \Rightarrow\ T=q`, why: String.raw`走完殘差的一個完整週期（$q$ 拍）後 $r[q]=r[0]$，首尾相消，輸出總和恰為 $qc=P$。若 $y$ 的最小週期 $T$ 比 $q$ 短，這個和等於 $q/T$ 份相同的整數和，所以 $q/T$ 整除 $P$；但 $q/T$ 也整除 $q$，而 $P$、$q$ 互質 ⇒ $q/T=1$。` },
          ]}
          result={String.raw`T_\text{lc}=q;\qquad\text{定點 }F\text{ bits：}\ T_\text{lc}=\frac{2^F}{\gcd(K_F,2^F)}`}
        />
        <TexBlock id="F-SO.11" label="EFB limit-cycle 週期">{String.raw`c=\frac Pq\Rightarrow T_\text{lc}=q,\qquad K_F=\mathrm{round}(w_H2^F)\bmod2^F\Rightarrow T_\text{lc}=\frac{2^F}{\gcd(K_F,2^F)}`}</TexBlock>
        <p>
          例：<Tex>{'c=32.4=162/5'}</Tex>，round 輸出 <Tex>{`[${efb5.join(',')}]`}</Tex>，一個週期的誤差功率 <Tex>{`${tx(efbPow, 6)}\\,\\mathrm{LSB}^2`}</Tex>——白雜訊一階 NTF 模型預測 <Tex>{`2/12=${tx(2 / 12, 4)}\\,\\mathrm{LSB}^2`}</Tex>，兩者不同（附錄 B 第 10 點）。
        </p>
        <ErratumNote id="E15">
          常數有理輸入時一階 EFB「必然」進入週期 <Tex>{'q'}</Tex> 的 limit cycle（不是「可能」）；對靜態目標，<Tex>{'\\Delta\\Sigma'}</Tex> 與 periodic toggle 頻譜相同。
        </ErratumNote>
        <p className="small muted">
          RTL 的 <Tex>{'w_H'}</Tex> 是定點數：同樣的「32.4」，小數位元數 <Tex>{'F'}</Tex> 不同，週期就不同。想手算 <Tex>{'K_F'}</Tex>、<Tex>{'\\gcd'}</Tex> 與週期，用 <a href="#/ch/13">Ch13</a> 的手算題（limit cycle 的週期：精確分數與 <Tex>{'F'}</Tex> 個小數 bit 的定點），或直接在下面的判斷器改 <Tex>{'F'}</Tex>。
        </p>
        <FixedPointJudgeExperiment />
        <CodeBlock source={judgesSrc} region="efbExact" path={PATH} title="精確整數 EFB（本頁執行的程式碼）" />
      </Section>

      <Section kind="formula" level={2} title="7. 多參數：各自穩定 ≠ 一起穩定" id="so-mimo">
        <Diagram
          chart={CHART_MIMO_LOOP}
          caption={String.raw`多參數的線性化迴路：誤差向量 $\boldsymbol\delta\mathbf w_k$ 經過 $\mathbf J$ 與 $\mathbf M$ 再加回自己，整圈就是矩陣 $\mathbf I+\mathbf M\mathbf J$；只看對角元素會漏掉交叉項。`}
          ariaLabel="多參數線性化迴路方塊圖：係數誤差向量一路直通加法點，另一路先乘 Jacobian J 得到 GMAC 平均輸出，再乘更新矩陣 M，與直通項相加後經過一個 block 的延遲回到誤差向量；整圈的矩陣是 I 加 M J，單獨看對角元素會漏掉交叉項"
        >
          <p>
            先看加法點的兩條進線：直通的 <Tex>{'\\boldsymbol\\delta\\mathbf w_k'}</Tex>（正號）加上走過 <Tex>{'\\mathbf J'}</Tex>、<Tex>{'\\mathbf M'}</Tex> 的修正量 <Tex>{'\\mathbf M\\mathbf J\\,\\boldsymbol\\delta\\mathbf w_k'}</Tex>（正號；穩定時 <Tex>{'\\mathbf J'}</Tex> 的 eigenvalue 為負，所以修正量實際上是往回拉）。輸出 <Tex>{'\\boldsymbol\\delta\\mathbf w_{k+1}=(\\mathbf I+\\mathbf M\\mathbf J)\\boldsymbol\\delta\\mathbf w_k'}</Tex>，經過一個 block 延遲 <Tex>{'z^{-1}'}</Tex> 回到起點。
          </p>
          <p>
            棕紅色的「只看對角」是常見的漏洞：它假設其他參數凍結，只剩 <Tex>{'1+M_{ii}J_{ii}'}</Tex>；藍色的 <Tex>{'\\rho(\\mathbf I+\\mathbf M\\mathbf J)'}</Tex> 才是一起更新時真正的判準。
          </p>
        </Diagram>
        <Steps
          title="多參數更新的線性化"
          steps={[
            { tex: String.raw`\mathbf w_{k+1}=\mathbf w_k+\mathbf M\,\mathbf G_k`, why: String.raw`一般更新：$\mathbf M=\mu\mathbf I$（原始）、$\mathrm{diag}(\mu_i)$（各自步長）、或 preconditioner。` },
            { tex: String.raw`E[\mathbf G_k]\approx\mathbf J\,(\mathbf w_k-\mathbf w^*)`, why: String.raw`在固定點附近一階泰勒展開；$\mathbf J=\partial E[\mathbf G]/\partial\mathbf w$（量測得到的 $\hat{\mathbf J}$ 不必對稱）。` },
            { tex: String.raw`\boldsymbol\delta\mathbf w_{k+1}=(\mathbf I+\mathbf M\mathbf J)\,\boldsymbol\delta\mathbf w_k`, why: String.raw`代入並令 $\boldsymbol\delta\mathbf w=\mathbf w-\mathbf w^*$（平均動態）。` },
            { tex: String.raw`\text{單獨更新第 }i\text{ 個：}\ \delta w_{i,k+1}=(1+M_{ii}J_{ii})\,\delta w_{i,k}`, why: '其他參數凍結時，只剩對角元素。' },
            { tex: String.raw`\rho(\mathbf I+\mathbf M\mathbf J)\ \ne\ \max_i|1+M_{ii}J_{ii}|`, why: 'eigenvalue 由整個矩陣決定；非對角的交叉耦合可以把 eigenvalue 推出單位圓。' },
          ]}
        />
        <p>
          T18：<Tex>{'\\mathbf J=\\begin{bmatrix}-1&2\\\\2&-1\\end{bmatrix}'}</Tex>、<Tex>{'\\mathbf M=0.2\\mathbf I'}</Tex>：對角 pole <Tex>{t18.diagPoles.map((x) => tx(x, 4)).join(',\\ ')}</Tex>（各自穩定），但 <Tex>{`\\mathrm{eig}(\\mathbf I+\\mathbf M\\mathbf J)=\\{${t18.eigA.map((z) => tx(z.re, 6)).join(',\\ ')}\\}`}</Tex>，<Tex>{`\\rho=${tx(t18.rho, 6)}>1`}</Tex>——一起更新時發散。原因：<Tex>{'\\mathbf J'}</Tex> 的 eigenvalue <Tex>{t18.eigJ.map((z) => tx(z.re, 6)).join(',\\ ')}</Tex> 中有正值，沿那個方向的「恢復力」是負的。<ClaimTag kind="exact" />
        </p>
        <TexBlock id="F-SO.7" label="多參數局部線性穩定判準">{String.raw`\rho\big(\mathbf I+\mathbf M\mathbf J_\text{true}\big)<1,\qquad \mathbf M=-\gamma(\hat{\mathbf J}^T\hat{\mathbf J}+\varepsilon_J\mathbf I)^{-1}\hat{\mathbf J}^T\ \overset{\hat{\mathbf J}=\mathbf J}{\Longrightarrow}\ p_i=1-\gamma\frac{\sigma_i^2}{\sigma_i^2+\varepsilon_J}`}</TexBlock>
        <ErratumNote id="E24">
          pole 公式只在 <Tex>{'\\hat{\\mathbf J}=\\mathbf J'}</Tex> 時成立；實務上 <Tex>{'\\mathbf M'}</Tex> 由量測 <Tex>{'\\hat{\\mathbf J}'}</Tex> 建構，poles 必須用 <Tex>{'\\mathrm{eig}\\big(\\mathbf I+\\mathbf M(\\hat{\\mathbf J})\\,\\mathbf J_\\text{true}\\big)'}</Tex>，近奇異時對 <Tex>{'\\hat{\\mathbf J}'}</Tex> 誤差極敏感。
        </ErratumNote>
        <ErratumNote id="E22">
          regularization 參數記為 <Tex>{'\\varepsilon_J'}</Tex>（規格寫 <Tex>{'\\lambda'}</Tex>，與 eigenvalue 衝突）。
        </ErratumNote>
        <ModeGate min="research">
          <Steps
            title={String.raw`Research：$\hat{\mathbf J}$ 有誤差時，多大的誤差還保證穩定？（Bauer–Fike）`}
            steps={[
              { tex: String.raw`\mathbf A_\text{true}=\mathbf I+\mathbf M\mathbf J=\underbrace{(\mathbf I+\mathbf M\hat{\mathbf J})}_{\hat{\mathbf A}}+\underbrace{\mathbf M(\mathbf J-\hat{\mathbf J})}_{\mathbf E}`, why: '把真實閉迴路矩陣拆成「設計者以為的」加上「模型誤差造成的擾動」。' },
              { tex: String.raw`\hat{\mathbf A}=\mathbf V\boldsymbol\Lambda\mathbf V^{-1}\ \Rightarrow\ \min_i|\lambda(\mathbf A_\text{true})-\hat\lambda_i|\le\kappa(\mathbf V)\,\|\mathbf E\|_2`, why: 'Bauer–Fike 定理：可對角化矩陣的 eigenvalue 對擾動的敏感度由 eigenvector 矩陣的條件數決定。' },
              { tex: String.raw`\hat{\mathbf A}\text{ 對稱}\Rightarrow\kappa(\mathbf V)=1\Rightarrow\rho(\mathbf A_\text{true})\le\rho(\hat{\mathbf A})+\|\mathbf E\|_2`, why: String.raw`對稱矩陣的 eigenvector 正交（regularized pinv 時 $\mathbf M\hat{\mathbf J}$ 是 $\hat{\mathbf J}^T\hat{\mathbf J}$ 的函數，因此 $\hat{\mathbf A}$ 對稱）。` },
              { tex: String.raw`\|\mathbf E\|_2<1-\rho(\hat{\mathbf A})\ \Rightarrow\ \text{保證穩定}`, why: '充分條件（不是必要條件）：設計時要留的「模型誤差裕度」。' },
            ]}
          />
          <p>
            E24 的例子（<Tex>{'\\hat\\rho=0.996'}</Tex>、真實 <Tex>{'\\rho=0.99'}</Tex>、<Tex>{'\\gamma=1'}</Tex>）：<Tex>{'\\varepsilon_J=0'}</Tex> 時 <Tex>{`\\rho(\\hat{\\mathbf A})=${tx(Math.abs(rob0.rhoHat) < 1e-9 ? 0 : rob0.rhoHat, 3)}`}</Tex>（一步到位）看起來完美，但 <Tex>{`\\|\\mathbf E\\|_2=${tx(rob0.normE, 5)}`}</Tex>，真實 <Tex>{`\\rho=${tx(rob0.rhoTrue, 5)}`}</Tex>（發散）。<Tex>{'\\varepsilon_J=10^{-4}'}</Tex> 時
            <Tex>{`\\rho(\\hat{\\mathbf A})=${tx(rob4.rhoHat, 5)}`}</Tex>、<Tex>{`\\|\\mathbf E\\|_2=${tx(rob4.normE, 5)}`}</Tex>：上界 <Tex>{tx(rob4.bound, 5)}</Tex> 不足以保證，但真實 <Tex>{`\\rho=${tx(rob4.rhoTrue, 5)}`}</Tex> 穩定——
            regularization 用一點設計裕度（慢模式變慢）換來對 <Tex>{'\\hat{\\mathbf J}'}</Tex> 誤差的穩健性。<ClaimTag kind="exact" />
          </p>
        </ModeGate>
        <MimoJudgeExperiment />
        <CodeBlock source={judgesSrc} region="mimoJudge" path={PATH} title="MIMO 判準（本頁執行的程式碼）" />
      </Section>

      <Section kind="formula" level={2} title="8. 校正策略與 output：最後驗收的是 PLL 輸出" id="so-strategy">
        <p>
          GMAC 歸零只代表 LMS 停在 <Tex>{'w^*'}</Tex>。sign-off 最後要問：係數的殘差與抖動，經過 DTC 與主 PLL 之後，在<strong>輸出</strong>造成多少 PN、jitter 與 spur？先把接法說清楚：feedback（divider）edge 比理想時刻早到 <Tex>{'a\\,x[n]'}</Tex>；DTC 在 reference 輸入端、只能延遲不能提前，所以它從固定的基準延遲 <Tex>{'T_0'}</Tex> 往回扣 <Tex>{'w\\,x[n]'}</Tex>（<Tex>{'\\tau_\\mathrm{DTC}=T_0-w\\,x[n]'}</Tex>；這個<strong>補償量</strong>讓 reference edge 少延遲、也就是提前這麼多）。PD 量的是（被 DTC 延遲後的）reference edge 減 feedback edge：<Tex>{'e[n]=t_\\mathrm{ref}\'[n]-t_\\mathrm{fb}[n]=(a-w)\\,x[n]+v[n]'}</Tex>。
        </p>
        <Diagram
          chart={CHART_OUTPUT_PATH}
          caption={String.raw`從係數偏差到輸出：block 速率的 $\delta w_k$ 展開到 sample 速率、乘上 code 得到 DTC 的補償誤差 $\delta t[n]$；它留下的殘差（$-\delta t$）在 PD 的 reference 輸入注入，經輸出 transfer $T$ 換成相位，再分成確定性的 spur 與隨機的 PN／jitter。`}
          ariaLabel="從 gain code 偏差到輸出 spur 與 jitter 的方塊圖：block 速率的係數偏差經零階保持展開到 sample 速率，乘上 code 得到 DTC 的補償誤差（reference 端的 DTC 多補償的時間），它留下的殘差（負的補償誤差）在 PD 的 reference 輸入注入，經過輸出 transfer T 並乘上負的 2 pi f_out 得到輸出相位，單一 tone 時換算調變指數與 spur，隨機分量換算成輸出相位雜訊與 jitter"
        >
          <p>
            先看最上面：<Tex>{'\\delta w_k'}</Tex> 是 block 速率（索引 <Tex>{'k'}</Tex>）的係數偏差，每 <Tex>{'N'}</Tex> 個 sample 才換一次，所以要先以 ZOH 展開到 sample 速率（索引 <Tex>{'n'}</Tex>，含 commit latency <Tex>{'n_c'}</Tex>）才能乘上 code <Tex>{'x[n]'}</Tex>。藍色的 <Tex>{'T=L/(1+L)'}</Tex> 是<strong>輸出路徑</strong>的 transfer——不是校正迴路看到的 <Tex>{'H_\\mathrm{PD}'}</Tex>；兩者混淆是 §9 反面測試的一項（PLL 誤差路徑與輸出路徑混淆）。DTC 的殘差從 PD 的 reference 輸入進去（回授路徑上只有 divider），所以 <Tex>{'e_\\mathrm{PD}=H_\\mathrm{PD}\\,\\phi_\\mathrm{dtc}'}</Tex>、<Tex>{'\\theta_\\mathrm{out}=+T\\,\\phi_\\mathrm{dtc}'}</Tex>，兩者都是正號（<Tex>{'\\theta_\\mathrm{out}'}</Tex> 就是圖上的輸出相位 <Tex>{'\\varphi_\\mathrm{out}'}</Tex>）；圖上 <Tex>{'\\varphi_\\mathrm{out}'}</Tex> 的負號來自殘差本身：多補償 <Tex>{'\\delta t'}</Tex>，reference edge 就太早，殘差是 <Tex>{'-\\delta t'}</Tex>。
          </p>
          <p>
            最下面分兩條：單一 tone 的 <Tex>{'\\delta t'}</Tex> 變成相位調變，spur 看 <Tex>{'\\beta'}</Tex>；隨機的部分變成輸出相位雜訊。GMAC 歸零只是定義了 <Tex>{'w^*'}</Tex>，這兩個輸出指標才是最後的驗收。
          </p>
        </Diagram>
        <Steps
          title="從 gain code 到輸出 spur（DTC 殘差在 reference 輸入注入）"
          steps={[
            { tex: String.raw`\delta t[n]=x[n]\,\delta w[n],\qquad \delta w[n]=\delta w_{\lfloor(n-n_c)/N\rfloor}`, why: String.raw`DTC 的補償誤差 = code × 係數偏差：補償量 $w\,x$ 比該有的多了 $\delta t$，reference edge 因此少延遲、早到 $\delta t$；block-rate 的 $\delta w_k$ 以 ZOH（含 commit latency $n_c$）展開到 sample rate（E09）。` },
            { tex: String.raw`e_\text{PD}=\phi_\text{dtc}-\theta_\text{out},\qquad \theta_\text{out}=L\,e_\text{PD}\ \Rightarrow\ \theta_\text{out}=T\,\phi_\text{dtc},\quad T=\frac{L}{1+L}`, why: String.raw`DTC 殘差 $\phi_\text{dtc}$ 在 PD 的 reference 輸入注入；回授路徑上只有 divider，沒有 DTC。相位一律記成「edge 的時間誤差 $\times\,2\pi f_\text{out}$」（晚到為正），所以經過 divider 數值不變：$\theta_\text{fb}=\theta_\text{out}$。代入得 $\theta_\text{out}(1+L)=L\,\phi_\text{dtc}$；同時 $e_\text{PD}=H_\mathrm{PD}\,\phi_\text{dtc}$，兩者都是正號，$H_\mathrm{PD}+T=1$。` },
            { tex: String.raw`\phi_\text{dtc}=-2\pi f_\text{out}\,\delta t\ \Rightarrow\ \phi_\text{out}=\theta_\text{out}=T\,\phi_\text{dtc}=-2\pi f_\text{out}\,T\,\delta t`, why: String.raw`殘差 = 該補的減掉實際補的（和 $e=(a-w)x$ 同號誌）：多補償 $\delta t$，reference edge 早到 $\delta t$，時間誤差就是 $-\delta t$——負號從這裡來，不是 $T$ 的號誌；時間轉相位乘 $2\pi f_\text{out}$。$\phi_\text{out}$ 是 $\theta_\text{out}$ 的另一個名字（輸出相位）；輸出路徑用閉迴路 $T$（不是 $H_\mathrm{PD}$）。負號只決定相位的正負，$|T|^2$、jitter 與 spur 的 dBc 都與它無關。` },
            { tex: String.raw`\delta t=A_t\cos(2\pi f_mt)\ \Rightarrow\ \beta=2\pi f_\text{out}A_t|T(f_m)|`, why: '單一 tone 的相位調變指數。' },
            { tex: String.raw`\text{SSB spur}=20\log_{10}\frac{J_1(\beta)}{J_0(\beta)}\approx20\log_{10}\frac\beta2=20\log_{10}(\pi f_\text{out}A_t)\ \ (|T|=1)`, why: String.raw`小角近似：$J_1(\beta)\approx\beta/2$、$J_0(\beta)\approx1$。` },
          ]}
          result={String.raw`f_\text{out}=13\,\mathrm{GHz},\ A_t=0.5\,\mathrm{fs}\ \Rightarrow\ ${tx(spur, 5)}\,\mathrm{dBc}`}
        />
        <ErratumNote id="E28">
          DTFT 形式 PSD 與 one-sided <Tex>{'S^{(1)}(f)'}</Tex> 之間差 <Tex>{'2/f_s'}</Tex>；每張 PSD 圖都要標 one/two-sided、取樣率與單位。
        </ErratumNote>
        <ErratumNote id="E09">
          block-rate 的 <Tex>{'S_w'}</Tex> 不能直接放到 sample-rate 卷積：先 ZOH 展開（<Tex>{'\\mathrm{sinc}^2'}</Tex> 型權重），頻率軸標明 <Tex>{'f_u'}</Tex> 或 <Tex>{'f_s'}</Tex>。
        </ErratumNote>
        <Callout kind="info" title="策略類檢查的共同判準">
          <ul>
            <li>每個狀態（coarse／fine／track／freeze）寫出 <Tex>{'(\\mu,N)'}</Tex> 與<strong>有統計意義</strong>的切換條件（例如 <Tex>{'|\\bar G|<z\\sigma_\\eta/\\sqrt m'}</Tex>）。</li>
            <li>coarse 階段的大步長落在 erf 飽和區（勘誤 E48），用 MC 而非線性公式驗證收斂時間。</li>
            <li>每個 mode（injection、VCO band、PMUX pattern）各自的極性與 <Tex>{'C'}</Tex> 都要量；relock 後回到規格內的時間要有上界。</li>
            <li>量化策略以 spur 與總誤差功率定量比較（§6 的 EFB 判斷器、<ChRef ch="13">Ch13</ChRef>）。</li>
          </ul>
        </Callout>
        <Quiz
          title="思考題 8-1"
          question={
            <>
              RTL 的 commit latency 量到 <Tex>{'d=2'}</Tex> block。設計者用 <Tex>{'g=\\mu K_{\\max}=0.8'}</Tex>（理由：「一階模型 <Tex>{'0<g<2'}</Tex>，還有很多裕度」）。對嗎？
            </>
          }
          options={[
            { label: <MathText>{'對，$0.8<2$'}</MathText> },
            { label: <MathText>{`不對：$d=2$ 時 $g_\\text{crit}=${tx(gCrit(2), 6)}<0.8$，迴路不穩定`}</MathText>, correct: true },
            { label: <MathText>{'要看 $N$'}</MathText> },
            { label: <MathText>{String.raw`要看 $\sigma_v$`}</MathText> },
          ]}
          answer={
            <>
              <p>
                <Tex>{`g_\\text{crit}(2)=2\\sin(\\pi/10)=${tx(gCrit(2), 6)}`}</Tex>。<Tex>{'g=0.8'}</Tex> 時 <Tex>{'z^3-z^2+0.8=0'}</Tex> 的 spectral radius 為 <Tex>{`${tx(delayPoles(0.8, 2).rho, 6)}>1`}</Tex>。
                <Tex>{'N'}</Tex> 與 <Tex>{'\\sigma_v'}</Tex> 只影響 <Tex>{'K'}</Tex>（已包含在 <Tex>{'g'}</Tex> 裡），不改變臨界增益。
              </p>
            </>
          }
        />
      </Section>
    </>
  )
}
