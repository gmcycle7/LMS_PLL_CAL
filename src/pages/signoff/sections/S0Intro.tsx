import { Callout, ClaimTag, ModelLevel, Prereq, Section, SourceTag, SymbolTable, Tex, TexBlock, mathText, type SymbolEntry } from '@/components'
import { normCdf, normInv, studentTInv } from '@/simulation/core'
import { cornerJudge, efbPeriod, failureUpperBound, gCrit, inlMseFixedPoint, kq, pmDeg, slopeStdErr } from '../judges'
import { ErratumTag, nf, scrollToAnchor, tx } from '../shared'

const SYMBOLS: SymbolEntry[] = [
  { symbol: '\\delta=a-w', meaning: '剩餘參數誤差（真值減校正係數）', unit: '\\mathrm{fs}', firstSeen: '§0', note: <>全站約定（規格 §3、§12 的反向極性見 <ErratumTag id="E32" /> <ErratumTag id="E33" />）</> },
  { symbol: 'a,\\ w', meaning: '真實係數、GMAC block 使用的校正係數', unit: '\\mathrm{fs}/\\text{unit code}', firstSeen: '§0', note: 'code 正規化時 $w$ 的單位是「每單位 code 的 fs」（E13）' },
  { symbol: 'w^*', meaning: 'LMS 的固定點：$E[G(w^*)]=0$（一般 $w^*\\ne a$）', unit: '\\mathrm{fs}', firstSeen: '§3' },
  { symbol: 'G_k', meaning: '第 $k$ 個 GMAC block 的平均相關輸出 $\\frac1N\\sum_n q[n]\\,x[n-D]$', unit: '—', firstSeen: '§1', note: <>average 模式；sum 模式差 <Tex>{'N'}</Tex> 倍 <ErratumTag id="E18" /></> },
  { symbol: '\\bar G(w)', meaning: '把 $w$ 凍結時 $G_k$ 的期望值（mean-field）', unit: '—', firstSeen: '§2' },
  { symbol: '\\Delta\\ (\\Delta w)', meaning: 'freeze 量測時加在 $w$ 上的擾動', unit: '\\mathrm{fs}', firstSeen: '§2' },
  { symbol: 'M', meaning: '每一側（$+\\Delta$ 或 $-\\Delta$）量測的 block 數', unit: '—', firstSeen: '§2', note: '粗體 $\\mathbf M$ 是多參數更新矩陣，兩者不同' },
  { symbol: 'S=\\partial\\bar G/\\partial w', meaning: 'GMAC 對 $w$ 的斜率（$S_\\mathrm{GMAC}$）', unit: '\\mathrm{fs}^{-1}', firstSeen: '§2' },
  { symbol: 'K=-S=K_qC', meaning: '恢復力（$K>0$ 才會往正確方向更新）', unit: '\\mathrm{fs}^{-1}', firstSeen: '§2', note: <>§0 未定義 <Tex>{'K'}</Tex>，本站採 E13 <ErratumTag id="E13" /></> },
  { symbol: 'K_q=\\sqrt{2/\\pi}/\\sigma_v', meaning: '1-bit comparator 小訊號增益（$|s|\\ll\\sigma_v$）', unit: '\\mathrm{fs}^{-1}', firstSeen: '§2' },
  { symbol: 'C=E[x[n-D]\\,u[n]]', meaning: '原始 code 與有效 regressor 的相關（含路徑相位與 code delay）', unit: '—', firstSeen: '§2' },
  { symbol: 'D', meaning: 'GMAC code delay（sample）', unit: '\\text{samples}', firstSeen: '§2', note: '與更新延遲 $d$（block）不同（E34）' },
  { symbol: 'd', meaning: '更新／commit 延遲', unit: '\\text{blocks}', firstSeen: '§4' },
  { symbol: 'g=\\mu K,\\ p=1-g', meaning: '無因次迴路增益與一階 pole', unit: '—', firstSeen: '§3' },
  { symbol: 'g_\\text{crit}(d)', meaning: '更新延遲 $d$ 時的臨界增益 $2\\sin\\frac{\\pi}{4d+2}$', unit: '—', firstSeen: '§4' },
  { symbol: '\\sigma_\\eta^2', meaning: 'GMAC block 雜訊變異數（$\\pm1$ code、近平衡時 $\\approx1/N$）', unit: '—', firstSeen: '§2' },
  { symbol: '\\mathrm{se},\\ z', meaning: '估計值的標準誤、判決用的信心倍數', unit: '—', firstSeen: '§0' },
  { symbol: '\\mathbf J,\\ \\hat{\\mathbf J}', meaning: '多參數 Jacobian $\\partial E[\\mathbf G]/\\partial\\mathbf w$ 與其量測值', unit: '\\mathrm{fs}^{-1}', firstSeen: '§2.5' },
  { symbol: '\\mathbf M,\\ \\mathbf A=\\mathbf I+\\mathbf M\\mathbf J', meaning: '更新矩陣與線性化閉迴路矩陣', unit: '—', firstSeen: '§7' },
  { symbol: '\\rho(\\mathbf A)', meaning: 'spectral radius（$\\max_i|\\lambda_i|$）', unit: '—', firstSeen: '§7', note: 'regressor 相關係數另記 $\\rho_{GP}$' },
  { symbol: '\\sigma_i,\\ \\kappa', meaning: '奇異值與 condition number $\\sigma_{\\max}/\\sigma_{\\min}$', unit: '—', firstSeen: '§7' },
  { symbol: 'g_2(\\mu),\\ \\lambda(\\mu)', meaning: '均方係數 $E[(1-\\mu x^2)^2]$ 與 Lyapunov 指數 $E[\\log|1-\\mu x^2|]$', unit: '—', firstSeen: '§3', note: <>與迴路增益 <Tex>{'g'}</Tex> 區分；a.s. 界見 <ErratumTag id="E14" /></> },
  { symbol: 'n,\\ k_f,\\ p_U', meaning: '獨立試驗數、觀察到的失效數、失效機率上界', unit: '—', firstSeen: '§3.5' },
  { symbol: 'B_x,\\ B_\\text{acc},\\ F', meaning: 'GMAC 輸入位元、累加器位元、內部小數位元', unit: '\\text{bits}', firstSeen: '§6' },
  { symbol: 'T_\\text{lc}', meaning: 'limit cycle 週期（與閉迴路 $T=L/(1+L)$ 不同）', unit: '\\text{updates}', firstSeen: '§6' },
]

/** 字串欄位中的 `$…$` 以 KaTeX 顯示（SymbolTable 的 meaning／note 是 ReactNode，不會自動轉）。 */
const SYMBOL_ROWS: SymbolEntry[] = SYMBOLS.map((r) => ({ ...r, meaning: mathText(r.meaning), note: mathText(r.note) }))

const PILLARS: { name: string; question: string; tex: string; rows: string }[] = [
  { name: 'Identifiability', question: '資訊夠不夠？每個參數方向都有恢復力嗎？', tex: '\\lambda_{\\min}(\\mathbf R)>0,\\ \\ \\sigma_{\\min}(\\mathbf J)>0', rows: 'FCW、多參數、SSPLL' },
  { name: 'Polarity', question: '更新方向對不對？', tex: 'K=K_qC>0,\\ \\ \\mathrm{diag}(\\hat{\\mathbf J})<0', rows: '基本正確性、Corner、FCW、SSPLL' },
  { name: 'Stability', question: '迴路動態會不會發散？', tex: '\\rho\\big(\\text{閉迴路矩陣}\\big)<1,\\ \\ g<g_\\text{crit}(d)', rows: 'Corner、多參數、策略' },
  { name: 'Variance', question: '統計精度夠不夠？', tex: '\\sigma_w=\\mu\\sigma_\\eta\\sqrt{\\textstyle\\sum h_k^2}\\le\\sigma_{w,\\max}', rows: 'Noise、Corner' },
  { name: 'Bias', question: '收斂到「正確的物理參數」嗎？', tex: '|w^*-a|\\le\\varepsilon_\\text{bias}', rows: '非線性、Noise、FCW' },
  { name: 'System-level', question: '真的改善 PLL output 的 jitter／spur 嗎？', tex: '\\phi_\\text{out}=-2\\pi f_\\text{out}T\\,\\delta t', rows: '校正策略' },
]

/** §0：問題、符號、六個條件、先備知識 */
export function S0Intro() {
  // 先備知識裡的數字全部即時計算
  const z975 = normInv(0.975)
  const t7 = studentTInv(0.975, 7)
  const pu100 = failureUpperBound(0, 100)
  const k100 = kq(100)
  // 入門版「四層檢查」的一組數字（T13 條件：σ_v = 100 fs、N = 4096、μ = 10 fs、C = 1），全部即時計算
  const walk = (() => {
    const mu = 10
    const N = 4096
    const delta = 20
    const M = 8
    const g = mu * k100
    const zFreeze = k100 / slopeStdErr(delta, N, M)
    const [row] = cornerJudge([{ name: 'T13', sigmaV: 100, thetaDeg: 0 }], { mu, d: 0, pmTargetDeg: 0, B: Infinity, N, sigmaWMax: Infinity })
    return { mu, N, delta, M, g, zFreeze, pole: 1 - g, pm: pmDeg(g, 0), tau: -1 / Math.log(1 - g), k95: row.settle95, sigmaW: row.sigmaW, gCrit2: gCrit(2), wInl: inlMseFixedPoint([-2, -1, 0, 1, 2], 1, 0.1), period: efbPeriod(162, 5) }
  })()
  return (
    <>
      <p className="so-lead">
        前面 14 章與各個實驗室教你「LMS 為什麼會收斂、收斂到哪、抖多大」。這一頁回答 tape-out 前最後的問題：
        <strong>我要檢查哪些東西、用什麼數學判準、看到什麼才能簽名？</strong>
        而簽名的時候，<strong>報告裡那句「穩定」到底是什麼意思？</strong>
      </p>
      <div className="c-tag-row">
        <ModelLevel level="L1" />
        <ModelLevel level="L3" />
        <ModelLevel level="L5" />
        <ClaimTag kind="exact" />
        <ClaimTag kind="approx" />
        <ClaimTag kind="research" />
        <SourceTag kind="illustrative" />
      </div>
      <Callout kind="warn" title="這一頁不能做什麼">
        本頁的模型都是 L0–L5 的教學／行為模型（規格 §15.1），所有數值皆為 <strong>illustrative</strong>。它能幫你把 sign-off 的<strong>判準</strong>與<strong>措辭</strong>做對，
        但不能取代 Spectre／AMS 模擬、bit-true RTL 與實測。規格開宗明義：不要把一階模型的穩定界限當成整顆 PLL 的 sign-off 結論。
      </Callout>

      <Section kind="intuition" level={2} title="0. 簽核（sign-off）要回答什麼？" id="so-intro">
        <p>
          想像你是 design reviewer，設計者交來一句話：「LMS gain calibration 已驗證，穩定。」你該追問的不是「真的嗎？」，而是六個<strong>可以用數學判定</strong>的問題。
          規格的最終主旨是：成功的校正必須<strong>同時</strong>滿足下面六項——任何一項沒過，其他五項做得再好都沒用。
        </p>
        <div className="table-wrap">
          <table className="so-pillars">
            <thead>
              <tr>
                <th>條件</th>
                <th>白話問題</th>
                <th>數學判準（代表式）</th>
                <th>Matrix 中負責的列</th>
              </tr>
            </thead>
            <tbody>
              {PILLARS.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td>{p.question}</td>
                  <td>
                    <Tex>{p.tex}</Tex>
                  </td>
                  <td>{p.rows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          這一頁的結構：先用 <a href="#/signoff" onClick={(e) => { e.preventDefault(); scrollToAnchor('so-matrix') }}>互動 Sign-off Matrix</a> 列出每一項要驗證什麼、怎麼判斷、本站哪個實驗能幫你，並記錄你的進度（存在你自己的瀏覽器，可匯出 Markdown／JSON）；
          接著逐列推導判準背後的數學（每一步都寫理由）；最後是規格 §17 的反面測試與附錄 B 的十項限制。
        </p>
      </Section>

      <Section kind="example" title="0.1 入門版：先用一組數字走完四層檢查">
        <p>
          如果六個條件一次看太多，先把簽核想成<strong>體檢的四個問題</strong>（入門課的四層檢查表）：方向對嗎 → 迴路增益會不會太大 → 雜訊抖多大 → 非理想把答案帶到哪。
          下面用全站最常用的一組數字（<Tex>{'\\sigma_v=100\\,\\mathrm{fs}'}</Tex>、<Tex>{`N=${walk.N}`}</Tex>、<Tex>{`\\mu=${walk.mu}\\,\\mathrm{fs}`}</Tex>、<Tex>{'C=1'}</Tex>，測試 T13 的條件）各算一個數字——每一列的算法在後面的段落都有一步一步的推導。
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>層</th>
                <th>要回答的問題</th>
                <th>算式</th>
                <th className="num">這組數字</th>
                <th>結論</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1 方向</td>
                <td>GMAC 說「往上調」時，真的該往上嗎？</td>
                <td>
                  <Tex>{'z=K_qC\\,\\Delta\\sqrt{2MN}'}</Tex>（freeze <Tex>{`\\pm\\Delta`}</Tex>，<Tex>{`\\Delta=${walk.delta}\\,\\mathrm{fs}`}</Tex>、<Tex>{`M=${walk.M}`}</Tex>）
                </td>
                <td className="num">
                  <Tex>{`K_q=${tx(k100, 5)}\\,\\mathrm{fs}^{-1},\\ z=${tx(walk.zFreeze, 4)}`}</Tex>
                </td>
                <td>
                  <Tex>{'z\\gg3'}</Tex>：極性判得很清楚（§2）
                </td>
              </tr>
              <tr>
                <td>2 增益</td>
                <td>每次修正會不會修過頭？</td>
                <td>
                  <Tex>{'g=\\mu K_qC,\\ p=1-g,\\ PM=90^\\circ-\\arcsin(g/2)'}</Tex>
                </td>
                <td className="num">
                  <Tex>{`g=${tx(walk.g, 5)},\\ p=${tx(walk.pole, 5)},\\ PM={${tx(walk.pm, 4)}}^\\circ`}</Tex>
                </td>
                <td>
                  <Tex>{'0<g<2'}</Tex>：穩定；即使 commit 延遲 <Tex>{'d=2'}</Tex> 也還有 <Tex>{`g<g_\\text{crit}(2)=${tx(walk.gCrit2, 4)}`}</Tex>（§4）
                </td>
              </tr>
              <tr>
                <td>3 雜訊</td>
                <td>收斂後係數抖多大？要等多久？</td>
                <td>
                  <Tex>{'\\sigma_w=\\mu\\sigma_\\eta/\\sqrt{1-p^2},\\ \\tau=-1/\\ln p'}</Tex>
                </td>
                <td className="num">
                  <Tex>{`\\sigma_w=${tx(walk.sigmaW, 4)}\\,\\mathrm{fs},\\ \\tau=${tx(walk.tau, 4)},\\ k_{95}=${walk.k95}`}</Tex>
                </td>
                <td>約 {walk.k95} 個 block 收斂 95%；抖動是 gain-equivalent，不是 output jitter（§5）</td>
              </tr>
              <tr>
                <td>4 非理想</td>
                <td>它停下來的地方，是「正確答案」嗎？</td>
                <td>
                  <Tex>{'w^*=a+c_3E[x^4]/E[x^2]'}</Tex>；6-bit code 的 limit cycle
                </td>
                <td className="num">
                  <Tex>{`a=1\\Rightarrow w^*=${tx(walk.wInl, 4)}`}</Tex>；<Tex>{`32.4\\Rightarrow T_\\text{lc}=${walk.period}`}</Tex>
                </td>
                <td>GMAC 歸零 ≠ 沒有偏差；量化會產生週期性的 spur（§6、§8、附錄 B）</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small muted">
          第 4 列的兩個數字分別來自三階 INL 例（<Tex>{'x\\in\\{-2,\\dots,2\\}'}</Tex>、<Tex>{'c_3=0.1'}</Tex>、MSE-LMS；Sign-LMS 的固定點依 <Tex>{'\\sigma_v'}</Tex> 落在 1.34 與 1.4 之間，勘誤 <ErratumTag id="E01" />）與常數目標 32.4 的一階 error-feedback quantizer。
          四層都過了，才輪到後面比較細的問題：多個 corner、多個 FCW、多個參數一起更新、證據夠不夠。
        </p>
      </Section>

      <SymbolTable rows={SYMBOL_ROWS} caption={mathText(String.raw`本頁一律 $\delta=a-w$；$K$、$\mu$ 的單位依 average-mode GMAC（$G$ 無因次）。粗體為矩陣。`)} />

      <Prereq title="期望值、變異數與「平均的標準誤」">
        <p>
          <Tex>{'E[X]'}</Tex>（期望值）是「同一實驗重做無限多次的平均」；變異數 <Tex>{'\\mathrm{Var}(X)=E[(X-E[X])^2]'}</Tex> 衡量散布。
          若 <Tex>{'X_1,\\dots,X_M'}</Tex> 互相獨立、變異數都是 <Tex>{'\\sigma^2'}</Tex>，它們的平均 <Tex>{'\\bar X'}</Tex> 的變異數是：
        </p>
        <TexBlock>{String.raw`\mathrm{Var}(\bar X)=\mathrm{Var}\Big(\frac1M\sum_{i=1}^MX_i\Big)=\frac1{M^2}\sum_{i=1}^M\mathrm{Var}(X_i)=\frac{\sigma^2}{M}\ \Rightarrow\ \mathrm{se}(\bar X)=\frac{\sigma}{\sqrt M}`}</TexBlock>
        <p>
          第二個等號用了「獨立 ⇒ 變異數相加」，常數 <Tex>{'1/M'}</Tex> 提出來要平方。這就是「多量幾次、誤差以 <Tex>{'1/\\sqrt M'}</Tex> 下降」。
          兩個獨立估計相減時，變異數同樣相加：<Tex>{'\\mathrm{Var}(\\bar X-\\bar Y)=\\mathrm{Var}(\\bar X)+\\mathrm{Var}(\\bar Y)'}</Tex>。
        </p>
      </Prereq>

      <Prereq title="高斯分布、中央極限定理與信賴區間（CI）">
        <p>
          很多獨立小量相加後近似高斯（鐘形）分布——中央極限定理（CLT）。高斯分布 95% 的機率落在平均 <Tex>{`\\pm${nf(z975, 4)}\\,\\sigma`}</Tex> 內（<Tex>{`\\Phi^{-1}(0.975)=${nf(z975, 6)}`}</Tex>，本頁即時計算）。
          所以 95% 信賴區間是 <Tex>{'\\bar X\\pm1.96\\,\\mathrm{se}'}</Tex>。
        </p>
        <p>
          樣本少時 <Tex>{'\\sigma'}</Tex> 也要用樣本估計，倍數改用 Student-t：例如 8 個 seeds（自由度 7）時 <Tex>{`t_{0.975,7}=${nf(t7, 5)}`}</Tex>，比 1.96 大，因為「估計的 <Tex>{'\\sigma'}</Tex> 本身也有誤差」。
          判決常用<strong>單邊</strong>：要宣稱 <Tex>{'K>0'}</Tex>，就要求 <Tex>{'\\hat K-z\\,\\mathrm{se}>0'}</Tex>，<Tex>{'z=3'}</Tex> 時單邊錯判機率 <Tex>{`\\Phi(-3)=${nf(100 * normCdf(-3), 3)}\\%`}</Tex>。
        </p>
      </Prereq>

      <Prereq title="二項分布與「0 次失效」能推出什麼">
        <p>
          每次試驗獨立、失效機率 <Tex>{'p'}</Tex>，做 <Tex>{'n'}</Tex> 次都沒失效的機率是 <Tex>{'(1-p)^n'}</Tex>。如果真實的 <Tex>{'p'}</Tex> 很大，「全部成功」就很不可能——
          這讓我們能反推 <Tex>{'p'}</Tex> 的上界。例如 100 個 seeds 全過，95% 信心下 <Tex>{`p\\le ${nf(pu100, 4)}`}</Tex>（本頁 §3.5 推導）。注意這只對「與試驗同分布的條件」有效。
        </p>
      </Prereq>

      <Prereq title="矩陣、eigenvalue 與 spectral radius">
        <p>
          向量遞迴 <Tex>{'\\mathbf s_{k+1}=\\mathbf A\\mathbf s_k'}</Tex>。若 <Tex>{'\\mathbf A\\mathbf v=\\lambda\\mathbf v'}</Tex>（<Tex>{'\\mathbf v'}</Tex> 是 eigenvector、<Tex>{'\\lambda'}</Tex> 是 eigenvalue），
          那從 <Tex>{'\\mathbf v'}</Tex> 出發每走一步就乘 <Tex>{'\\lambda'}</Tex>：<Tex>{'\\mathbf s_k=\\lambda^k\\mathbf v'}</Tex>。一般初值可以拆成各 eigenvector 的組合，所以
        </p>
        <TexBlock>{String.raw`\mathbf s_k\to\mathbf 0\ \ \forall\mathbf s_0\iff\rho(\mathbf A)\equiv\max_i|\lambda_i|<1`}</TexBlock>
        <p>
          這是純量 <Tex>{'r^k\\to0\\iff|r|<1'}</Tex>（等比數列）的矩陣版。<Tex>{'\\lambda'}</Tex> 可以是複數（振盪）；<Tex>{'|\\lambda|'}</Tex> 是它到原點的距離，所以「穩定 ⇔ 所有 eigenvalue 在 unit circle 內」。
          奇異值 <Tex>{'\\sigma_i'}</Tex> 是 <Tex>{'\\sqrt{\\lambda_i(\\mathbf J^T\\mathbf J)}'}</Tex>：它告訴你 <Tex>{'\\mathbf J'}</Tex> 在各方向「放大多少」，<Tex>{'\\sigma_{\\min}=0'}</Tex> 代表某個參數組合完全看不見。
        </p>
      </Prereq>

      <Prereq title="Comparator 的 erf 與 $K_q$（Ch05 的一句話版本）">
        <p>
          comparator 看到 <Tex>{'e=s+v'}</Tex>，<Tex>{'v\\sim\\mathcal N(0,\\sigma_v^2)'}</Tex>，<Tex>{'q=\\mathrm{sign}(e)'}</Tex>，則 <Tex>{'E[q]=\\mathrm{erf}(s/(\\sqrt2\\sigma_v))'}</Tex>。
          泰勒一階：<Tex>{'E[q]\\approx K_qs'}</Tex>，<Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex>；<Tex>{'\\sigma_v=100\\,\\mathrm{fs}'}</Tex> 時 <Tex>{`K_q=${nf(k100, 6)}\\,\\mathrm{fs}^{-1}`}</Tex>。
          <Tex>{'|s|'}</Tex> 接近 <Tex>{'\\sigma_v'}</Tex> 以後 erf 飽和，線性化失效（附錄 B 第 3 點）。
        </p>
      </Prereq>

      <Prereq title="Z transform 與更新延遲的特徵方程">
        <p>
          延遲一拍 = 乘 <Tex>{'z^{-1}'}</Tex>。若更新用的是 <Tex>{'d'}</Tex> 個 block 以前的誤差：<Tex>{'\\delta_{k+1}=\\delta_k-g\\,\\delta_{k-d}'}</Tex>。代入 <Tex>{'\\delta_k=z^k'}</Tex>：
        </p>
        <TexBlock>{String.raw`z^{k+1}=z^k-g\,z^{k-d}\ \Rightarrow\ z^{d+1}-z^d+g=0`}</TexBlock>
        <p>
          這個多項式的根就是 poles；全部在 unit circle 內才穩定。<Tex>{'d=0'}</Tex> 時 <Tex>{'z=1-g'}</Tex>，得到熟悉的 <Tex>{'0<g<2'}</Tex>；<Tex>{'d\\ge1'}</Tex> 時臨界增益變小（§4 推導）。
        </p>
      </Prereq>
    </>
  )
}
