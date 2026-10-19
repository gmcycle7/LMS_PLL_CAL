import { useDeferredValue, useMemo, useState } from 'react'
import { Callout, CodeBlock, ModeGate, ParamControl, Section, SelectControl, StepDerivation, Tex, mathText } from '@/components'
import { gammaEff, gosRationalBeta, loopH, typeIReH } from '@/simulation/models/sspll'
import certJson from '../../../../analysis/sspll/golden/results/gos_certificate.json'
import pyCertSrc from '../../../../analysis/sspll/golden/sspll_golden/gos_certificate.py?raw'
import theoremSrc from '../gosTheorem.ts?raw'
import { LOOPS, LOOP_KEYS, type LoopKey } from '../data'
import { gosCertificate, gosKernelMin, gosLipschitz, gosTypeIPositive, harmonicNumber, harmonicTailWeight, type GosCertificate } from '../gosTheorem'
import { Claim, DataTable, Diagram, Formula, Hand, Kappa, Sci, Src, fx, r } from '../common'

const THEOREM_PATH = 'src/pages/case-sspll/gosTheorem.ts'
const PY_PATH = 'analysis/sspll/golden/sspll_golden/gos_certificate.py'
const BETA0 = 0.016

interface GoldenCert {
  ok: boolean
  steps: number
  worst_lower: number
  worst_at: number
  Lg: number
  g_min: number
  LamM: number
  beta_min: number
  M: number
}
const GOLDEN = certJson as unknown as {
  nominal: Record<string, GoldenCert>
  extended: Record<string, GoldenCert>
  asymptote_ratio: { Ki: number; rows: Record<string, { beta: number; C: number; asym: number; ratio: number }> }
}

/** 讀者自己跑一次證書：選迴路、β_0、M（即時計算；TS port 與 golden 的 Python 同一套零件） */
function CertificateWidget() {
  const [loop, setLoop] = useState<LoopKey>('L2')
  const [beta0, setBeta0] = useState(BETA0)
  const [M, setM] = useState(1000)
  const d = useDeferredValue({ loop, beta0, M })
  const res = useMemo(() => gosCertificate(LOOPS[d.loop], { betaMin: d.beta0, M: d.M }), [d])
  return (
    <div className="card">
      <p>
        <strong>自己證一次</strong>（TS port 的 <code>gosCertificate</code>）：選一個迴路、起點 <Tex>{r`\beta_0`}</Tex> 與項數 <Tex>{'M'}</Tex>，證書從 <Tex>{r`\beta_0`}</Tex> 一步一步走到 <Tex>{r`\tfrac12`}</Tex>。
        <Tex>{r`\beta_0`}</Tex> 越小、需要的 <Tex>{'M'}</Tex> 越大（near-grid 的下界只有 <Tex>{r`\beta_0^2/K_i`}</Tex>，尾項 <Tex>{r`g_{\min}T_M\approx-0.2/(2\pi^2M)`}</Tex> 不能比它大）。
      </p>
      <div className="cs-inline-controls">
        <SelectControl label="迴路" value={loop} onChange={setLoop} options={LOOP_KEYS} />
        <ParamControl label={mathText('起點 $\\beta_0$')} ariaLabel="證書的起點 beta 0" value={beta0} onChange={setBeta0} min={0.002} max={0.2} step={0.001} digits={4} hint="預設 0.016；golden 以 M = 16000 推到 1/1024" />
        <ParamControl label={mathText('項數 $M$')} ariaLabel="截斷和的項數 M" value={M} onChange={setM} min={50} max={8000} step={50} integer clampOnBlur hint="每一步算 M 條諧波" />
      </div>
      <p>
        {res.ok ? (
          <>
            <strong className="cs-pos">證書成立</strong>：{res.steps.toLocaleString()} 步走到 <Tex>{r`\tfrac12`}</Tex>；最小的下界 <Tex>{`\\mathrm{LB}=${fx(res.worstLower, 5)}`}</Tex>（<Tex>{`12\\,\\mathrm{LB}=${fx(12 * res.worstLower, 4)}`}</Tex>）在{' '}
            <Tex>{`\\beta=${fx(res.worstAt, 4)}`}</Tex>；最短的一步 <Tex>{`${fx(res.minStep, 5)}`}</Tex>。所以在這個迴路、<Tex>{`\\beta\\in[${fx(res.betaMin, 3)},\\,${fx(1 - res.betaMin, 3)}]`}</Tex> 上 <Tex>{r`C_{GOS}>0`}</Tex>。
          </>
        ) : (
          <>
            <strong className="cs-neg">證書失敗</strong>（{res.reason}）——這不是反例，只表示這組 <Tex>{r`\beta_0`}</Tex>、<Tex>{'M'}</Tex> 的步長或尾項不夠；把 <Tex>{'M'}</Tex> 調大或 <Tex>{r`\beta_0`}</Tex> 調大再試。
          </>
        )}
        <span className="small muted">
          {' '}
          零件：<Tex>{`L_g=${fx(res.Lg, 3)}`}</Tex>、<Tex>{`\\Lambda_M=${fx(res.LamM, 3)}`}</Tex>、<Tex>{`g_{\\min}=${fx(res.gMin, 4)}`}</Tex>、<Tex>{`T_M=${fx(res.tailWeight, 7)}`}</Tex>。
        </span>
      </p>
    </div>
  )
}

/** §7b GOS「D = 0 不反號」：L1 一行證明、L2／L3 的電腦輔助證書、β < β_0 的漸近式收尾（哪一段精確、哪一段近似）。 */
export function S07bTheorem() {
  const cert = useMemo(() => {
    const out: Record<'L2' | 'L3', GosCertificate> = { L2: gosCertificate(LOOPS.L2), L3: gosCertificate(LOOPS.L3) }
    return out
  }, [])
  const lipL2 = useMemo(() => gosLipschitz(LOOPS.L2), [])
  const kmL2 = useMemo(() => gosKernelMin(LOOPS.L2, lipL2.Lg), [lipL2])
  const K1 = Number(LOOPS.L1.params.K)
  const Ki = Number(LOOPS.L2.params.Ki)
  const t1 = gosTypeIPositive(K1, 0.123)
  // β < β_0：精確諧波和與漸近式 β²/K_i 的比值（即時算；golden 的 asymptote_ratio 是同一批數字）
  const asym = useMemo(
    () =>
      [64, 128, 256, 512, 1000].map((b) => {
        const beta = 1 / b
        const C = gosRationalBeta(gammaEff(LOOPS.L2), 1, b)
        return { b, beta, C, asym: (beta * beta) / Ki, ratio: C / ((beta * beta) / Ki) }
      }),
    [Ki],
  )
  const HM = harmonicNumber(1000)
  const TM = harmonicTailWeight(1000)
  const ext = GOLDEN.extended
  return (
    <Section kind="formula" level={2} title="7b. 定理：$D=0$ 時 GOS 不反號——從猜想到證明" id="cs-7b">
      <p>
        §7.2 的最後一句是「這不是證明」：11 個迴路、每個 152,096 個 <Tex>{r`\beta`}</Tex> 沒有反例，但有限的掃描永遠證不了「所有 <Tex>{r`\beta`}</Tex>」。這一節把它補成定理。先看三條路：
      </p>
      <Diagram id="gos-theorem" />
      <p>
        先看左邊：L1 的 <Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex> 處處不為負，諧波和的每一項都 <Tex>{r`\ge0`}</Tex>，一行就證完。再看藍色那一格：L2、L3 在 <Tex>{r`0<f<f_{inv}`}</Tex> 是負的，不能逐項比；但諧波和是一個<strong>可以直接算</strong>的和——前{' '}
        <Tex>{'M'}</Tex> 項精確算、第 <Tex>{'M+1'}</Tex> 項以後用「每一條都落在谷底」壓住，再用 Lipschitz 常數把相鄰的 <Tex>{r`\beta`}</Tex> 接起來，有限步就能覆蓋整段 <Tex>{r`[\beta_0,\tfrac12]`}</Tex>。最後看紅色那一格：
        <Tex>{r`\beta<\beta_0`}</Tex> 的 near-grid 區仍只有 §7.2 的漸近式，是近似。
      </p>

      <h3>7b.1 L1：一行證明</h3>
      <p>
        <Tex>{r`L_1=Kz^{-1}/(1-z^{-1})`}</Tex> 的 <Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex> 在 §6.1 已經有 closed form（F-CS.7）。把它代進 F-CS.11 的諧波和：
      </p>
      <StepDerivation
        steps={[
          { tex: r`\mathrm{Re}\,H_{PD}(f)=\frac{(2-K)(1-\cos2\pi f)}{\lvert1-(1-K)e^{-j2\pi f}\rvert^2}\ \ge0\quad(0<K<2)`, why: <>F-CS.7：分子是兩個非負數的積（<Tex>{r`1-\cos\ge0`}</Tex>、<Tex>{'2-K>0'}</Tex>），分母是模的平方；等號只在 <Tex>{r`f\in\mathbb Z`}</Tex>。</> },
          { tex: r`C_{GOS}(\beta)=\sum_{m\ge1}w_m\,\mathrm{Re}\,H_{PD}(\mathrm{frac}(m\beta)),\qquad w_m=\frac{1}{2\pi^2m^2}>0`, why: <>F-CS.11 的諧波和；每條諧波的權重是功率，一定為正。</> },
          { tex: r`C_{GOS}(\beta)\ \ge\ w_1\,\mathrm{Re}\,H_{PD}(\beta)\ >0\quad(\beta\notin\mathbb Z)`, why: <>非負項的和不小於其中任何一項；<Tex>{r`\beta\notin\mathbb Z`}</Tex> 時 <Tex>{r`\mathrm{frac}(\beta)\ne0`}</Tex>，第一項嚴格為正。<Tex>{r`\beta\in\mathbb Z`}</Tex>（<Tex>{r`\alpha=k/8`}</Tex>）時 <Tex>{r`\rho\equiv0`}</Tex>，GOS 本來就不可觀測。</> },
        ]}
        result={r`\text{L1：}\ C_{GOS}(\beta)>0\ \ \forall\,\beta\in(0,1)`}
      />
      <Formula id="F-CS.24" />
      <p>
        <Claim kind="exact">
          指定模型：線性小訊號 PLL（L2 層級）、<Tex>{'D=0'}</Tex>、raw regressor、凍結權重；<Tex>{'0<K<2'}</Tex>
        </Claim>
        數字：<Tex>{`K=${fx(K1, 6)}`}</Tex>、<Tex>{r`\beta=0.123`}</Tex> 時第一項 <Tex>{`w_1\\,\\mathrm{Re}\\,H_{PD}(0.123)=${fx(t1.firstTerm, 5)}`}</Tex>，前 1000 項的和 <Tex>{`${fx(t1.partial, 5)}`}</Tex>（<Tex>{`12C=${fx(12 * t1.partial, 4)}`}</Tex>），和 §7.2 密集掃描的最小值 <Tex>{`12C=${fx(GOLDEN.nominal.L1.worst_lower * 12, 4)}`}</Tex> 在 <Tex>{r`\beta=0.016`}</Tex> 一致。同一個論證對任何 <Tex>{r`\mathrm{Re}\,H_{PD}\ge0`}</Tex> 的迴路都成立——這就是 §9 的 PSD 定理在單一 regressor 上的樣子；L1 加延遲或寄生極點之後有了反號帶，就得走下面這條路。
      </p>

      <h3>7b.2 L2、L3：可計算的證書</h3>
      <p>
        <Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex> 有負的頻帶時，諧波和裡有正有負，只能把它<strong>算出來</strong>——但 <Tex>{r`\beta`}</Tex> 有無限多個、和也有無限多項。三個零件把「無限」變成有限：
      </p>
      <StepDerivation
        steps={[
          {
            tex: r`g(f)\equiv\mathrm{Re}\,H_{PD}(e^{j2\pi f})=\sum_{n\ge0}h_{PD}[n]\cos(2\pi fn)\ \Rightarrow\ \lvert g'(f)\rvert\le2\pi\sum_{n\ge1}n\,\lvert h_{PD}[n]\rvert\equiv L_g`,
            why: <>把頻率響應寫成脈衝響應的 Fourier 級數（迴路穩定，<Tex>{r`\sum\lvert h\rvert<\infty`}</Tex>），逐項對 <Tex>{'f'}</Tex> 微分再取絕對值。<Tex>{r`n>N`}</Tex> 的尾項用極點的留數展開 <Tex>{r`h[n]=\sum_ic_i\lambda_i^n`}</Tex> 壓住（<Tex>{r`\sum_{n>N}n\rho^n`}</Tex> 有封閉式；展開先和遞迴算出的 <Tex>{'h[n]'}</Tex> 核對）。</>,
          },
          {
            tex: r`C_M(\beta)\equiv\sum_{m=1}^{M}w_m\,g(\mathrm{frac}(m\beta)):\quad\lvert C_M(\beta)-C_M(\beta')\rvert\le L_g\sum_{m\le M}w_m\,m\,\lvert\beta-\beta'\rvert=\underbrace{\frac{L_gH_M}{2\pi^2}}_{\Lambda_M}\lvert\beta-\beta'\rvert`,
            why: <><Tex>{r`g`}</Tex> 以 1 為週期，所以 <Tex>{r`g(\mathrm{frac}(m\beta))=g(m\beta)`}</Tex> 對 <Tex>{r`\beta`}</Tex> 連續（wrap 的瞬間 <Tex>{'g(1)=g(0)'}</Tex>），斜率最多 <Tex>{r`mL_g`}</Tex>；乘上 <Tex>{r`w_m=1/(2\pi^2m^2)`}</Tex> 只剩 <Tex>{'1/m'}</Tex>，加起來是調和數 <Tex>{r`H_M`}</Tex>。</>,
          },
          {
            tex: r`\sum_{m>M}w_m\,g(\mathrm{frac}(m\beta))\ \ge\ g_{\min}\,T_M,\qquad T_M=\sum_{m>M}w_m=\frac{\zeta(2,M+1)}{2\pi^2}\le\frac{1}{2\pi^2M},\quad g_{\min}\le\min_fg(f)`,
            why: <>尾項最壞的情況：每一條都落在谷底。<Tex>{r`g_{\min}`}</Tex> 取細格點的最小值再減 <Tex>{r`L_gh/2`}</Tex>（任何 <Tex>{'f'}</Tex> 離某個格點不超過 <Tex>{'h/2'}</Tex>），所以它是真正的下界。</>,
          },
          {
            tex: r`\mathrm{LB}_i\equiv C_M(\beta_i)+g_{\min}T_M>0\ \Rightarrow\ C(\beta)\ \ge\ \mathrm{LB}_i-\Lambda_M\lvert\beta-\beta_i\rvert>0\quad\forall\,\beta\in\Big[\beta_i,\ \beta_i+\frac{\mathrm{LB}_i}{\Lambda_M}\Big]`,
            why: <>在格點 <Tex>{r`\beta_i`}</Tex> 把前 <Tex>{'M'}</Tex> 項精確算出來、加上尾項的下界；往右走 <Tex>{r`\mathrm{LB}_i/\Lambda_M`}</Tex> 之內前 <Tex>{'M'}</Tex> 項最多掉 <Tex>{r`\mathrm{LB}_i`}</Tex>，總和仍 <Tex>{'>0'}</Tex>。</>,
          },
          {
            tex: r`\beta_{i+1}=\beta_i+\frac{\mathrm{LB}_i}{\Lambda_M},\quad\beta_0\to\tfrac12:\ \text{每一步都 }\mathrm{LB}_i>0\ \Rightarrow\ C(\beta)>0\ \ \forall\,\beta\in[\beta_0,\tfrac12];\qquad C(\beta)=C(1-\beta)`,
            why: <>下一個格點就取這一步的右端，而且<strong>直接重算</strong>（沒有任何一點是靠推測的）。走到 <Tex>{r`\tfrac12`}</Tex> 就證完 <Tex>{r`[\beta_0,\tfrac12]`}</Tex>；<Tex>{r`\mathrm{frac}(m(1-\beta))=1-\mathrm{frac}(m\beta)`}</Tex> 與 <Tex>{'g'}</Tex> 的偶性補上另一半。</>,
          },
        ]}
        result={r`\text{證書成立}\ \Rightarrow\ C_{GOS}(\beta)>0\ \ \forall\,\beta\in[\beta_0,\,1-\beta_0]`}
      />
      <Formula id="F-CS.25" />
      <p>
        <Claim kind="exact">
          指定模型：線性小訊號 PLL、<Tex>{'D=0'}</Tex>、raw regressor、凍結權重；證書的每一步都是不等式，浮點誤差約 <Tex>{r`10^{-13}`}</Tex>，遠小於最小的 <Tex>{r`\mathrm{LB}`}</Tex>
        </Claim>
        三個標稱迴路的結果（頁面載入時即時算；和 golden 的 Python 逐項相同，見 <code>gosTheorem.test.ts</code>）：
      </p>
      <DataTable
        className="cs-num"
        caption={r`證書：$\beta_0=0.016$、$M=1000$、$N=4096$、$n_f=200001$；最小的下界都出現在 $\beta_0$（near-grid 的 $C\approx\beta_0^2/K_i$ 最小）。`}
        head={['迴路', <Tex key="lg">{'L_g'}</Tex>, <Tex key="gm">{r`g_{\min}`}</Tex>, <Tex key="lam">{r`\Lambda_M`}</Tex>, '步數', <>最小 <Tex>{r`\mathrm{LB}`}</Tex>（<Tex>{r`12\,\mathrm{LB}`}</Tex>）</>, '在 $\\beta$', '結論']}
        rows={[
          ['L1', fx(GOLDEN.nominal.L1.Lg, 3), fx(GOLDEN.nominal.L1.g_min, 5), fx(GOLDEN.nominal.L1.LamM, 3), String(GOLDEN.nominal.L1.steps), <><Sci v={GOLDEN.nominal.L1.worst_lower} sig={4} />（{fx(12 * GOLDEN.nominal.L1.worst_lower, 4)}）</>, fx(GOLDEN.nominal.L1.worst_at, 3), '一行證明已涵蓋（證書只是對照）'],
          ...(['L2', 'L3'] as const).map((k) => {
            const c = cert[k]
            return [k, fx(c.Lg, 3), fx(c.gMin, 5), fx(c.LamM, 3), String(c.steps), <><Sci key="w" v={c.worstLower} sig={4} />（{fx(12 * c.worstLower, 4)}）</>, fx(c.worstAt, 3), c.ok ? <strong key="ok" className="cs-pos">成立：{mathText(`$C_{GOS}>0$ 於 $[${fx(c.betaMin, 3)},\\,${fx(1 - c.betaMin, 3)}]$`)}</strong> : <strong key="no" className="cs-neg">失敗：{c.reason}</strong>]
          }),
        ]}
      />
      <p>
        L2 的零件：<Tex>{`L_g=2\\pi\\sum_nn\\lvert h_{PD}[n]\\rvert=${fx(lipL2.Lg, 4)}`}</Tex>（<Tex>{r`N=4096`}</Tex>，尾項上界 <Sci v={lipL2.tail} sig={2} />，留數展開與遞迴的差 <Sci v={lipL2.residualErr} sig={2} />，最大極點半徑 <Tex>{`${fx(lipL2.rhoMax, 4)}`}</Tex>）；細格點的最小值{' '}
        <Tex>{`${fx(kmL2.gridMin, 5)}`}</Tex> 在 <Tex>{`${fx(kmL2.fAtMin * 4000, 1)}`}</Tex> MHz（§6.4 的谷底），減 <Tex>{r`L_gh/2`}</Tex> 得 <Tex>{`g_{\\min}=${fx(kmL2.gMin, 5)}`}</Tex>；<Tex>{`H_{1000}=${fx(HM, 4)}`}</Tex>、<Tex>{`T_{1000}=${fx(TM, 7)}`}</Tex>，所以尾項最多扣{' '}
        <Tex>{`g_{\\min}T_{1000}=${fx(kmL2.gMin * TM, 7)}`}</Tex>——比 <Tex>{r`\beta_0`}</Tex> 的 <Tex>{`\\beta_0^2/K_i=${fx((BETA0 * BETA0) / Ki, 5)}`}</Tex> 小一個數量級，這就是 <Tex>{r`M=1000`}</Tex> 夠用的原因。
      </p>
      <p>
        <Tex>{'M'}</Tex> 越大、<Tex>{r`\beta_0`}</Tex> 可以越小：golden 以 <Tex>{'M=16000'}</Tex> 把 L2 的證書推到 <Tex>{r`\beta_0=2^{-10}`}</Tex>（{ext.L2.steps.toLocaleString()} 步，最小 <Tex>{r`\mathrm{LB}`}</Tex> = <Sci v={ext.L2.worst_lower} sig={3} />
        ，<Tex>{`12\\,\\mathrm{LB}=${fx(12 * ext.L2.worst_lower, 5)}`}</Tex>）、L3 到同一個 <Tex>{r`\beta_0`}</Tex>（{ext.L3.steps.toLocaleString()} 步，<Sci v={ext.L3.worst_lower} sig={3} />）；這正好是 §7.2 密集掃描的最小 <Tex>{r`\beta=1/1000`}</Tex>。步數 <Tex>{r`\propto\int d\beta/C(\beta)\approx K_i(1/\beta_0-2)`}</Tex>：再往下每減半一次，步數加倍、<Tex>{'M'}</Tex> 要乘 4，所以 <Tex>{r`\beta\to0`}</Tex> 這一端永遠要靠漸近式收尾。
      </p>
      <Src>
        <code>analysis/sspll/golden/results/gos_certificate.json</code>（<code>tools/gos_certificate.py</code>，11 個迴路：§7.2 密集掃描的全部迴路都通過）；TS port <code>gosTheorem.ts</code> 在 <code>gosTheorem.test.ts</code> 逐項比對到 <Tex>{r`10^{-9}`}</Tex>。
      </Src>
      <CertificateWidget />
      <Hand id="HC-CS.10">{r`把下面的 $\beta$ 換成你自己的頻道（$\beta=\mathrm{frac}(8\alpha)$），只用前 4 條諧波，看單點證書能不能證明這一點的 $C_{GOS}>0$，以及一步能走多遠。`}</Hand>

      <h3>
        7b.3 <Tex>{r`\beta<\beta_0`}</Tex>：漸近式收尾（哪一段精確、哪一段近似）
      </h3>
      <p>
        證書沒有走到的 near-grid 區（<Tex>{r`0<\beta<\beta_0`}</Tex>）用 §7.2 的慢鋸齒漸近式 F-CS.12：Type-II、<Tex>{'D=0'}</Tex> 時 <Tex>{r`C\approx\beta^2/K_i>0`}</Tex>。它的推導把鋸齒拆成斜坡加 wrap、只留 <Tex>{r`\beta`}</Tex> 的前兩階，沒有誤差項的界限，所以是<strong>近似</strong>；數值上，精確的有理數式（F-CS.11 的 <code>gosRationalBeta</code>）和它的比值：
      </p>
      <DataTable
        className="cs-num"
        head={[<Tex key="b">{r`\beta=1/b`}</Tex>, '精確 $C$（F-CS.11）', <Tex key="a">{r`\beta^2/K_i`}</Tex>, '比值']}
        rows={asym.map((x) => [`1/${x.b}`, <Sci key="c" v={x.C} sig={5} />, <Sci key="a" v={x.asym} sig={5} />, <Kappa key="r" v={x.ratio} digits={6} tol={0} />])}
      />
      <p>
        <Claim kind="approx">
          <Tex>{r`\beta<\beta_0`}</Tex>：漸近式 + 在 <Tex>{r`\beta=1/b`}</Tex>（<Tex>{r`b\le1000`}</Tex>）的數值檢查，比值在 <Tex>{r`1\pm10^{-3}`}</Tex> 內；不是對所有 <Tex>{r`\beta`}</Tex> 的證明
        </Claim>
        所以本頁的結論分三段：<Tex>{r`\beta\in[\beta_0,1-\beta_0]`}</Tex> 是定理（L1 全域）；<Tex>{r`\beta<\beta_0`}</Tex>（與對稱的 <Tex>{r`\beta>1-\beta_0`}</Tex>）是「漸近式 + 數值」的近似；§19 的「仍未驗證」只剩後者，而且 <Tex>{r`\beta_0`}</Tex> 隨 <Tex>{'M'}</Tex> 可以一直往下推。
      </p>
      <Callout kind="info" title="換了迴路（PVT、延遲、寄生極點）怎麼辦？">
        <p>
          證書只用到 <Tex>{r`H_{PD}`}</Tex> 的脈衝響應與頻率響應，不用到「L2」這三個字：PVT 移動帶緣（§6.5）之後重跑一次就行（上面的小工具、或 golden 的 <code>certificate(loop)</code>）。§7.2 密集掃描的 11 個迴路——包括兩個有反號帶的 Type-I 變形——全部通過。證書失敗時不是反例：先把 <Tex>{'M'}</Tex> 調大（尾項）、再把 <Tex>{r`\beta_0`}</Tex> 調大（near-grid 用漸近式）；真的反例會在 §7.2 的精確有理數掃描裡以負值出現。
        </p>
      </Callout>
      <ModeGate min="engineer">
        <CodeBlock source={theoremSrc} region="gosCertificate" path={THEOREM_PATH} title="證書：一步一步走（TS，頁面即時執行的程式）" />
        <CodeBlock source={theoremSrc} region="gosLipschitz" path={THEOREM_PATH} title={r`$L_g=2\pi\sum n\lvert h_{PD}[n]\rvert$ 與尾項的留數上界`} />
        <CodeBlock source={theoremSrc} region="gosTypeIPositive" path={THEOREM_PATH} title="L1 的一行證明（程式版）" />
      </ModeGate>
      <ModeGate min="research">
        <CodeBlock source={pyCertSrc} region="certificate" lang="python" path={PY_PATH} title="Python golden 的同一段（results/gos_certificate.json 由它產生）" />
        <p className="small muted">
          對照 §7.2 的 <code>gosConjectureScan</code>：掃描只看有理數 <Tex>{r`\beta=a/b`}</Tex>（<Tex>{r`b\le b_{\max}`}</Tex>），證書涵蓋區間裡的每一個實數；兩者用的 <Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex> 是同一個函數（1000 MHz：L1 的 closed form 給{' '}
          <Tex>{`${fx(typeIReH(K1, 0.25), 5)}`}</Tex>、L2 的有理函數給 <Tex>{`${fx(loopH(LOOPS.L2, 0.25).re, 5)}`}</Tex>，都是 §6.4 表裡的數字）。
        </p>
      </ModeGate>
    </Section>
  )
}
