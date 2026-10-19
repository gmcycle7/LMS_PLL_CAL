import { useMemo } from 'react'
import { Callout, ClaimTag, CodeCompare, ModeGate, Prereq, Section, StepDerivation, Tex, TexBlock, ChRef } from '@/components'
import dtcInlSrc from '@/simulation/models/dtcInl.ts?raw'
import { DEFAULT_STRUCTURE, hardwareCost, lutApproxRms, lutClosedForm, segmentClosedForm, type StructureConfig } from '@/simulation/models/dtcInl'
import { InlLmsLab } from '../experiments/InlLmsLab'
import { ModeDetails, m, num, texNum } from '../common'
import { F } from '../formulas'
import { Fig, FigRef } from '../Fig'
import { Hand } from '../Hand'

const PATH = 'src/simulation/models/dtcInl.ts'
const MU = 2
const SIGMA = 10
const N = 64

/** §11b.3 三種校正結構：更新式、收斂、穩態變異、硬體；實驗 B。 */
export function StructuresSection() {
  const t = useMemo(() => {
    const segs = Array.from({ length: 8 }, (_, k) => segmentClosedForm(k, 8, MU, SIGMA, N))
    const lut = lutClosedForm(64, MU, SIGMA, N)
    const cfgs: StructureConfig[] = [
      { ...DEFAULT_STRUCTURE, structure: 'piecewise', K: 8 },
      { ...DEFAULT_STRUCTURE, structure: 'lut', J: 64 },
      { ...DEFAULT_STRUCTURE, structure: 'poly', M: 3, basis: 'monomial' },
      { ...DEFAULT_STRUCTURE, structure: 'poly', M: 3, basis: 'legendre' },
    ]
    return { segs, lut, costs: cfgs.map((c) => ({ c, cost: hardwareCost(c) })), floor64: lutApproxRms({ d2: 20, d3: 0 }, 64), floor8: lutApproxRms({ d2: 20, d3: 0 }, 8), smallG: Math.sqrt(MU / (2 * segs[0].Kq * N)) }
  }, [])

  return (
    <Section kind="formula" title="11b.3 三種 INL 校正結構與它們的 LMS" level={2} id="ch11b-structures">
      <p>
        把 Ch11 的一個 gain 換成一排參數。<ChRef ch="09">Ch09</ChRef> 的多參數 LMS 說：給定 regressor 向量 <Tex>{'\\boldsymbol\\psi'}</Tex>，一切由相關矩陣 <Tex>{'\\mathbf R=E[\\boldsymbol\\psi\\boldsymbol\\psi^T]'}</Tex> 的特徵值決定——每個特徵值 <Tex>{'\\lambda_i'}</Tex> 是一個模式，pole <Tex>{'1-\\mu K_q\\lambda_i'}</Tex>。本章要做的只是把三種結構的 <Tex>{'\\boldsymbol\\psi'}</Tex> 寫出來，算 <Tex>{'\\mathbf R'}</Tex>。
      </p>
      <Prereq title="one-hot regressor 與對角的 $\\mathbf R$">
        <p>
          <Tex>{'\\mathbb 1_k(x)'}</Tex> 是「指示函數」：<Tex>{'x'}</Tex> 在第 <Tex>{'k'}</Tex> 段時為 1，否則為 0。一個 <Tex>{'x'}</Tex> 只落在一段，所以 <Tex>{'\\mathbb 1_k\\mathbb 1_l=0'}</Tex>（<Tex>{'k\\ne l'}</Tex>）：任何「one-hot × 函數」的 regressor 向量，兩兩乘積的期望值都是 0，<Tex>{'\\mathbf R'}</Tex> 自動對角。對角的 <Tex>{'\\mathbf R'}</Tex> 沒有模式耦合：每個參數就是一個獨立的一階迴路，特徵值就是對角元素 <Tex>{'\\lambda_k=E[\\varphi_k^2]'}</Tex>。<ChRef ch="09">Ch09</ChRef> F-09.14 的 one-hot 就是 LUT 的情形。
        </p>
      </Prereq>
      <p>
        <FigRef id="piecewise-loop" /> 以分段結構為例畫出整個迴路。先看上面：<Tex>{'x'}</Tex> 決定段號 <Tex>{'k'}</Tex>，one-hot 讓只有第 <Tex>{'k'}</Tex> 個 GMAC 累加 <Tex>{'q\\,x'}</Tex>、只有 <Tex>{'w_k'}</Tex> 更新。再看下面的回授：mux 用同一個 <Tex>{'k'}</Tex> 選出 <Tex>{'w_k'}</Tex> 送去 DTC，PD 看到 <Tex>{'(a+d(x)/x-w_k)\\,x+v'}</Tex>——每段在學自己的「有效 gain」<Tex>{'a+d(x)/x'}</Tex>。
      </p>
      <Fig id="piecewise-loop" />
      <StepDerivation
        title={m('多參數 block Sign-LMS 的小訊號 mean-field（Ch09 F-09.2–F-09.3 的改寫）')}
        steps={[
          { tex: String.raw`\boldsymbol\vartheta_{b+1}=\boldsymbol\vartheta_b+\mu\,\mathbf M\,\mathbf G_b,\qquad \mathbf G_b=\frac1N\sum_{n\in b}q[n]\,\boldsymbol\psi[n]`, why: m('每個 block 把 $q$ 乘上 regressor 向量累加（一排 GMAC），再乘 $\\mu$（與 preconditioner $\\mathbf M$，scalar 時 $\\mathbf M=\\mathbf I$）加到參數上。') },
          { tex: String.raw`E[q\mid x]=\operatorname{erf}\!\Big(\frac{e_\mathrm{det}}{\sqrt2\sigma_v}\Big)\approx K_q\,e_\mathrm{det},\qquad e_\mathrm{det}=\boldsymbol\psi^T(\boldsymbol\vartheta^*-\boldsymbol\vartheta)+r(x)`, why: m('comparator 線性化（Ch11 F-11.3，需 $|e_\\mathrm{det}|\\ll\\sigma_v$）；$\\boldsymbol\\vartheta^*$ 是 LS 最佳解，$r(x)$ 是結構貼不住的殘差（與 $\\boldsymbol\\psi$ 正交：$E[\\boldsymbol\\psi r]=\\mathbf 0$）。') },
          { tex: String.raw`E[\mathbf G]=K_q\,E\big[\boldsymbol\psi\boldsymbol\psi^T\big](\boldsymbol\vartheta^*-\boldsymbol\vartheta)+K_qE[\boldsymbol\psi\,r]=K_q\,\mathbf R\,(\boldsymbol\vartheta^*-\boldsymbol\vartheta)`, why: m('取期望值、利用正交性。$\\mathbf R=E[\\boldsymbol\\psi\\boldsymbol\\psi^T]$ 是 regressor 的相關矩陣。') },
          { tex: String.raw`\boldsymbol\delta_{b+1}=(\mathbf I-\mu K_q\mathbf M\mathbf R)\,\boldsymbol\delta_b,\qquad \boldsymbol\delta=\boldsymbol\vartheta-\boldsymbol\vartheta^*`, why: m('mean recursion：$\\mathbf R$ 的每個特徵向量是一個模式，pole $1-\\mu K_q\\lambda_i$（$\\mathbf M=\\mathbf I$）。穩定需 $\\mu K_q\\lambda_{\\max}<2$，最慢的是 $\\lambda_{\\min}$。') },
        ]}
      />
      <TexBlock id="F-11B.7" label={m('多參數 block LMS 與 mean-field')}>
        {F.blockLms}
      </TexBlock>
      <p className="ch11b-tags">
        <ClaimTag kind="approx" /> {m('小訊號線性化（$|e|\\ll\\sigma_v$）；一開始殘差很大時 comparator 飽和，以固定速度 $\\mu E|\\boldsymbol\\psi|$ 前進，mean-field 只描述後段（實驗 B 會警告）。')}
      </p>

      <h3 id="ch11b-piecewise">(a) 分段線性：每段一個 gain</h3>
      <p>
        regressor <Tex>{'\\varphi_k(x)=\\mathbb 1_k(x)\\,x'}</Tex>，<Tex>{'K'}</Tex> 個參數（<Tex>{'K=1'}</Tex> 就是 Ch11 的 gain LMS）。<Tex>{'\\mathbf R'}</Tex> 對角，第 <Tex>{'k'}</Tex> 段的特徵值是「這一段內 <Tex>{'x^2'}</Tex> 的期望值」：
      </p>
      <StepDerivation
        steps={[
          { tex: String.raw`\lambda_k=E\big[\mathbb 1_k(x)^2x^2\big]=E\big[x^2\mathbb 1_k(x)\big]=\int_{x_k}^{x_{k+1}}x^2\,p(x)\,dx`, why: m('$\\mathbb 1_k^2=\\mathbb 1_k$；只在這一段積分。') },
          { tex: String.raw`x\sim U(-1,1):\quad\lambda_k=\frac{x_{k+1}^3-x_k^3}{6},\qquad\sum_k\lambda_k=E[x^2]=\tfrac13`, why: m('密度 $1/2$、$\\int x^2=x^3/3$。各段加起來就是整個 $E[x^2]$——分段把 Ch11 的 $E[x^2]$ 切成 $K$ 份。') },
          { tex: String.raw`K=8:\ \lambda_8=\tfrac{1-0.75^3}{6}=${texNum(t.segs[7].lambda, 5)},\quad\lambda_5=\tfrac{0.25^3}{6}=${texNum(t.segs[4].lambda, 5)}\ \Rightarrow\ \frac{\lambda_8}{\lambda_5}=${texNum(t.segs[7].lambda / t.segs[4].lambda, 4)}`, why: m('靠近 $x=0$ 的段 $x^2$ 很小：regressor 幾乎沒有能量，comparator 看不出那一段的 gain 對不對——它當然慢。') },
          { tex: String.raw`p_k=1-\mu K_q\lambda_k,\qquad\tau_k=\frac1{\mu K_q\lambda_k},\qquad k_{95}=\Big\lceil\frac{\ln0.05}{\ln p_k}\Big\rceil`, why: m('每段一個一階迴路（Ch09 F-09.4、F-09.6）。') },
        ]}
      />
      <TexBlock id="F-11B.8" label={m('分段線性的 $\\lambda_k$、pole 與時間常數')}>
        {F.piecewise}
      </TexBlock>
      <p className="ch11b-tags">
        <ClaimTag kind="exact" /> {m('uniform $x$ 的封閉式；其他分布用段內的 $E[x^2\\mathbb 1_k]$（實驗 B 由樣本估計）。')}
      </p>
      <div className="table-wrap">
        <table className="ch11b-table">
          <caption className="small muted">{m(`$K=8$、$\\mu=${MU}$、$\\sigma_v=${SIGMA}$、$N=${N}$（illustrative）：各段的 $\\lambda_k$、$k_{95}$ 與穩態 $\\sigma_{w_k}$（由 segmentClosedForm 算出）。`)}</caption>
          <thead>
            <tr>
              <th>段</th>
              <th>
                <Tex>{'[x_k,x_{k+1}]'}</Tex>
              </th>
              <th>
                <Tex>{'\\lambda_k'}</Tex>
              </th>
              <th>
                <Tex>{'g_k=\\mu K_q\\lambda_k'}</Tex>
              </th>
              <th>
                <Tex>{'\\tau_k'}</Tex>（blocks）
              </th>
              <th>
                <Tex>{'k_{95}'}</Tex>
              </th>
              <th>
                <Tex>{'\\sigma_{w_k}'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {t.segs.map((s, k) => (
              <tr key={k}>
                <td className="num">{k + 1}</td>
                <td className="num">
                  [{num(s.lo, 3)}, {num(s.hi, 3)}]
                </td>
                <td className="num">{num(s.lambda, 4)}</td>
                <td className="num">{num(s.g, 4)}</td>
                <td className="num">{num(s.tau, 4)}</td>
                <td className="num">{s.k95}</td>
                <td className="num">{num(s.stdW, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        注意最後一欄：每段的穩態抖動幾乎一樣（<Tex>{`\\approx\\sqrt{\\mu/(2K_qN)}=${texNum(t.smallG, 4)}`}</Tex>），只有時間常數差 37 倍。這是 F-11B.10 的結果，下面推。
      </p>
      <Hand id="HC-11B.2">{m('選一段、換 $K$、$\\mu$、$\\sigma_v$、$N$，算這一段的 $\\lambda_k$、$k_{95}$ 與 $\\sigma_{w_k}$。')}</Hand>

      <h3 id="ch11b-lut">(b) LUT：每格一個修正值</h3>
      <p>
        regressor <Tex>{'\\varphi_j(x)=\\mathbb 1_j(x)'}</Tex>（純 one-hot，沒有乘 <Tex>{'x'}</Tex>），<Tex>{'J'}</Tex> 個參數。<Tex>{'\\lambda_j=E[\\mathbb 1_j]=p_j'}</Tex>——就是這一格被造訪的機率。uniform 時 <Tex>{'p_j=1/J'}</Tex>：
      </p>
      <StepDerivation
        steps={[
          { tex: String.raw`g_j=\mu K_qp_j=\frac{\mu K_q}{J},\qquad\tau_j=\frac{J}{\mu K_q}\ \text{blocks}`, why: m('格數直接乘進時間常數：格越細，每一格分到的更新越少。') },
          { tex: String.raw`\text{一個 }\tau_j\text{ 內這一格看到的樣本數}=N\tau_j\,p_j=\frac{N}{\mu K_q}`, why: m('$N\\tau_j$ 個 sample，每格分到 $p_j$：與 $J$ 無關。格數只改變「等多久」，不改變「每格看到多少」。') },
          { tex: String.raw`n_\mathrm{eff}=\frac{1}{K_q^2\operatorname{Var}(\theta_j)}\approx\frac{2N}{\mu K_q}`, why: m('直接平均 $n$ 個 1-bit 樣本（$\\hat d=\\bar q/K_q$）的變異數是 $1/(nK_q^2)$（Ch05 的 $\\sqrt N$ 累積）；LMS 的穩態變異數（F-11B.10）等於「平均了 $n_\\mathrm{eff}$ 個」——指數遺忘視窗的有效長度是時間常數的 2 倍。') },
        ]}
      />
      <TexBlock id="F-11B.9" label={m('LUT 的時間常數與每格樣本數')}>
        {F.lut}
      </TexBlock>
      <p className="ch11b-tags">
        <ClaimTag kind="exact" /> {m(`例：$J=64$、$\\mu=${MU}$、$\\sigma_v=${SIGMA}$、$N=${N}$：$\\tau_j=${texNum(t.lut.tau, 4)}$ blocks、每格每 $\\tau$ 看到 $${texNum(t.lut.samplesPerBinPerTau, 4)}$ 個樣本、$n_\\mathrm{eff}=${texNum(t.lut.effectiveSamples, 4)}$。`)}
      </p>
      <p>
        LUT 的代價不只是記憶體與時間：每格存一個常數，格內的斜率沒被修正。把 <Tex>{'d'}</Tex> 在格內展開成直線：
      </p>
      <StepDerivation
        steps={[
          { tex: String.raw`x\in\text{格 }j:\quad d(x)-\theta_j^*\approx d'(\bar x_j)\,(x-\bar x_j),\qquad\theta_j^*=E[d\mid\text{格 }j]`, why: m('每格的最佳常數是格內平均；殘差是斜率乘上離格中心的距離。') },
          { tex: String.raw`E\big[(x-\bar x_j)^2\mid\text{格 }j\big]=\frac{\Delta^2}{12},\qquad\Delta=\frac2J`, why: m('uniform 在寬 $\\Delta$ 的格內的變異數（和量化雜訊的 $\\Delta^2/12$ 同一個式子）。') },
          { tex: String.raw`\text{floor}^2=E\big[d'(x)^2\big]\frac{\Delta^2}{12},\qquad E[d'^2]=E\big[(2d_2x+3d_3x^2)^2\big]=\frac{4d_2^2}{3}+\frac{9d_3^2}{5}`, why: m('對所有格平均（$E[x^2]=\\tfrac13$、$E[x^4]=\\tfrac15$、$E[x^3]=0$）。') },
          { tex: String.raw`d_2=20:\quad J=8\Rightarrow\text{floor}=${texNum(t.floor8, 4)},\qquad J=64\Rightarrow${texNum(t.floor64, 4)}`, why: m('floor $\\propto1/J$，但 $\\tau_j\\propto J$：格數是「精度 vs 速度」的旋鈕。') },
        ]}
      />
      <TexBlock id="F-11B.13" label={m('LUT 的近似誤差（floor）')}>
        {F.lutApprox}
      </TexBlock>
      <p className="ch11b-tags">
        <ClaimTag kind="approx" /> {m('$d$ 在格內近似直線；鋸齒的跳變不在內。Python golden 以 200k 格點直接算，與封閉式相差 < 1%。')}
      </p>
      <Hand id="HC-11B.3">{m('換 $J$、$\\mu$、$\\sigma_v$、$N$，算每格的時間常數、有效樣本數與穩態抖動。')}</Hand>

      <h3 id="ch11b-poly">{m('(c) 多項式基底：$M$ 階，$M+1$ 個係數')}</h3>
      <p>
        regressor <Tex>{'\\varphi_m(x)=x^m'}</Tex>（或正交多項式），<Tex>{'M+1'}</Tex> 個參數；一次項 <Tex>{'\\theta_1'}</Tex> 就是 gain 校正、零次項 <Tex>{'\\theta_0'}</Tex> 吸收 offset——Ch11 的 gain LMS 是 <Tex>{'M=1'}</Tex> 的特例。它的 <Tex>{'\\mathbf R'}</Tex> <strong>不</strong>對角：<Tex>{'R_{mn}=E[x^{m+n}]'}</Tex> 是動差的 Hankel 矩陣，<Tex>{'x^3'}</Tex> 和 <Tex>{'x'}</Tex> 在 <Tex>{'[-1,1]'}</Tex> 上長得很像（相關係數 <Tex>{'E[x^4]/\\sqrt{E[x^2]E[x^6]}=0.917'}</Tex>），所以有一個很弱的方向。換 Legendre 基底讓 <Tex>{'\\mathbf R'}</Tex> 變對角——這是 §11b.3c 的條件數問題，連同 preconditioner 一起放在下一節的實驗 C。
      </p>
      <TexBlock id="F-11B.11" label={m('多項式基底的相關矩陣與條件數')}>
        {F.polyR}
      </TexBlock>
      <p className="ch11b-tags">
        <ClaimTag kind="exact" /> {m('uniform $x$ 的封閉式（HC-11B.4 用 2×2 分塊手算）。')}
      </p>

      <h3 id="ch11b-variance">穩態變異：三種結構共用的一條式子</h3>
      <StepDerivation
        steps={[
          { tex: String.raw`\mathbf G_b=K_q\mathbf R(\boldsymbol\vartheta^*-\boldsymbol\vartheta_b)+\boldsymbol\eta_b,\qquad\operatorname{Cov}(\boldsymbol\eta_b)=\frac{E[q^2\boldsymbol\psi\boldsymbol\psi^T]}{N}=\frac{\mathbf R}{N}`, why: m('一個 block 的 GMAC 向量 = 平均值 + 抽樣雜訊；Sign-LMS 的 $q^2=1$，所以雜訊的共變異數就是 $\\mathbf R/N$（Ch12 F-12.6 的向量版；MSE 要再乘 $\\sigma_v^2+\\text{floor}^2$）。') },
          { tex: String.raw`\xi_i=\mathbf v_i^T\boldsymbol\delta:\quad\xi_{i,b+1}=(1-\mu K_q\lambda_i)\,\xi_{i,b}+\mu\,\eta_{i,b},\qquad\operatorname{Var}(\eta_i)=\frac{\lambda_i}{N}`, why: m('投影到 $\\mathbf R$ 的特徵向量 $\\mathbf v_i$：模式之間解耦，每個是一階遞迴（Ch10 F-10.7）。') },
          { tex: String.raw`\operatorname{Var}(\xi_i)=\frac{\mu^2\lambda_i/N}{1-p_i^2}=\frac{\mu^2\lambda_i}{N\,g_i(2-g_i)}\overset{g_i\ll1}{\approx}\frac{\mu^2\lambda_i}{2N\mu K_q\lambda_i}=\frac{\mu}{2K_qN}`, why: m('一階遞迴的穩態變異數（等比級數 $\\sum p^{2j}$，Ch11 F-11.16 的同一步）。$\\lambda_i$ 消掉了：慢的模式雜訊小、但也累積得久，剛好抵消。') },
          { tex: String.raw`E[r^2]_\infty=\text{floor}^2+E\big[(\boldsymbol\psi^T\boldsymbol\delta)^2\big]=\text{floor}^2+\sum_i\lambda_i\operatorname{Var}(\xi_i)`, why: m('殘餘 INL 的總功率 = 結構貼不住的部分 + 參數抖動透過 regressor 漏出來的部分（misadjustment）。') },
        ]}
      />
      <TexBlock id="F-11B.10" label={m('穩態變異與 misadjustment')}>
        {F.variance}
      </TexBlock>
      <p className="ch11b-tags">
        <ClaimTag kind="approx" /> {m('Sign-LMS 的線性化；$g_i\\ll1$。實驗 B 的指標表把預測的 $\\sigma_\\theta$ 與 MC 後半段的 std 並列（時間常數接近視窗長度時 MC 的 std 會偏低）。')}
      </p>

      <h3 id="ch11b-compare-structures">三種結構並排</h3>
      <p>
        <FigRef id="structures" /> 把三種結構的 regressor、<Tex>{'\\mathbf R'}</Tex>、硬體與近似誤差排在一起；藍色方塊是決定收斂的 <Tex>{'\\mathbf R'}</Tex>。下表是硬體成本的粗估（illustrative，每個 sample 的乘法器、加法器與參數記憶體）。
      </p>
      <Fig id="structures" />
      <div className="table-wrap">
        <table className="ch11b-table">
          <thead>
            <tr>
              <th>結構</th>
              <th>regressor</th>
              <th>參數</th>
              <th>
                <Tex>{'\\mathbf R'}</Tex>
              </th>
              <th>最慢模式</th>
              <th>近似誤差（floor）</th>
              <th>乘法器 / 加法器 / 記憶體</th>
              <th>可辨識性風險</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>分段線性</td>
              <td>
                <Tex>{'\\mathbb 1_k(x)\\,x'}</Tex>
              </td>
              <td>
                <Tex>{'K'}</Tex>
              </td>
              <td>對角</td>
              <td>{m('$x\\approx0$ 的段（$\\lambda_k\\propto x^2$）')}</td>
              <td>段內曲率、段界跳變</td>
              <td>
                {t.costs[0].cost.multipliers} / {t.costs[0].cost.adders} / {t.costs[0].cost.memoryWords}
              </td>
              <td>{m('與 gain $w$ 共線（$\\sum\\mathbb 1_kx=x$）')}</td>
            </tr>
            <tr>
              <td>LUT</td>
              <td>
                <Tex>{'\\mathbb 1_j(x)'}</Tex>
              </td>
              <td>
                <Tex>{'J'}</Tex>
              </td>
              <td>對角</td>
              <td>{m('造訪最少的格（$\\tau_j=1/(\\mu K_qp_j)$）')}</td>
              <td>
                <Tex>{'\\Delta\\sqrt{E[d\'^2]/12}'}</Tex>
              </td>
              <td>
                {t.costs[1].cost.multipliers} / {t.costs[1].cost.adders} / {t.costs[1].cost.memoryWords}
              </td>
              <td>整體 offset 與 PD offset 共線；空格</td>
            </tr>
            <tr>
              <td>多項式（monomial）</td>
              <td>
                <Tex>{'x^m'}</Tex>
              </td>
              <td>
                <Tex>{'M+1'}</Tex>
              </td>
              <td>{m('Hankel（$\\kappa=67.6$）')}</td>
              <td>{m('$x^3$ 與 $x$ 的差方向')}</td>
              <td>
                <Tex>{'M'}</Tex> 階以上的 INL
              </td>
              <td>
                {t.costs[2].cost.multipliers} / {t.costs[2].cost.adders} / {t.costs[2].cost.memoryWords}
              </td>
              <td>{m('$x$ 項與 gain $w$ 共線')}</td>
            </tr>
            <tr>
              <td>多項式（Legendre）</td>
              <td>
                <Tex>{'P_m(x)'}</Tex>
              </td>
              <td>
                <Tex>{'M+1'}</Tex>
              </td>
              <td>{m('對角（uniform；$\\kappa=7$）')}</td>
              <td>{m('$P_3$（$\\lambda=1/7$）')}</td>
              <td>同上</td>
              <td>
                {t.costs[3].cost.multipliers} / {t.costs[3].cost.adders} / {t.costs[3].cost.memoryWords}
              </td>
              <td>同上</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ModeDetails title={m('核心程式碼：三種 regressor 與一個 block 的更新只差標示的幾行')}>
        <CodeCompare
          items={[
            { label: 'regressor（分段／LUT／多項式）', source: dtcInlSrc, region: 'regressor', path: PATH, note: '分段：one-hot × $x$；LUT：one-hot；多項式：$\\varphi_m(x)$。含 gain 時第一個元素是 $x$。' },
            { label: '一個 block 的向量 GMAC 與更新', source: dtcInlSrc, region: 'inlBlockLms', path: PATH, note: 'Sign 與 MSE 只差 $q$ 那一行；preconditioner 時 $\\boldsymbol\\vartheta\\leftarrow\\boldsymbol\\vartheta+\\mathbf M\\mathbf G$。' },
          ]}
          caption="實驗 B 的 worker 逐 sample 執行這兩段程式（網站實際執行的原始碼）。"
        />
      </ModeDetails>
      <ModeGate min="research">
        <p className="small muted">
          Research：分段結構的 <Tex>{'w_k\\,x'}</Tex> 在段界不連續（<Tex>{'(w_k-w_{k+1})x_{k+1}'}</Tex> 的跳變），真正的 segmented DTC 多半用「每段一個 offset + 共用的 fine gain」或連續的 piecewise-linear（hat 函數 regressor）；本章取任務指定的「每段一個 gain」以保持 <Tex>{'K=1\\Rightarrow'}</Tex> Ch11。hat 函數的 <Tex>{'\\mathbf R'}</Tex> 是三對角（相鄰段耦合），條件數約 3。
        </p>
      </ModeGate>
      <InlLmsLab />
      <Callout kind="ok" title="試試看">
        <ol>
          <li>{m('預設（分段 $K=8$、uniform、$d_2=20$）：殘餘 INL 從 9.1 降到約 0.9（floor 0.82）；參數軌跡裡外段 $w_8$ 幾個 block 就到、內段 $w_4$、$w_5$ 慢慢爬（$k_{95}$ 差 37 倍）。')}</li>
          <li>{m('把 code 改成 MASH（frac 0.618）：右下圖的造訪機率集中在中間，外段幾乎沒有樣本——警告「造訪機率低於 1%」，外段的 $w_k$ 不動。這就是 §11b.4 的 PE 問題。')}</li>
          <li>{m('結構改成 LUT、$J=64$：floor 降到 0.21，但 $\\tau_j=401$ blocks；$J=16$ 快 4 倍、floor 高 4 倍。frac 改 0.3：「有格完全沒有被造訪」。')}</li>
          <li>{m('結構改成多項式 Legendre $M=3$、$d_3=10$：floor $=0$（$d$ 在空間裡），條件數約 7；換 monomial 變 67.6，殘餘曲線多一條慢慢爬的尾巴。')}</li>
          <li>{m('開「gain $w$ 同時校正」：分段／多項式立刻警告 $\\mathbf R$ 奇異、$\\vartheta^*$ 不唯一——總補償量照樣收斂，但 $w$ 和 $w_k$ 一起漂。')}</li>
          <li>{m('$\\sigma_v$ 改 1：一開始 $|e|\\gg\\sigma_v$，comparator 飽和，MC 比 mean-field 慢（警告）。')}</li>
          <li>{m('preconditioner 改 diag、$\\gamma=0.05$：分段的 8 條軌跡同時到（所有 pole $=0.95$），代價是內段的 $\\sigma_{w_k}$ 變大（F-11B.14、Ch10 F-10.6）。')}</li>
        </ol>
      </Callout>
    </Section>
  )
}
