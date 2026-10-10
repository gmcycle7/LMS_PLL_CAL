import { Fragment, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Callout, ClaimTag, Prereq, Section, SourceTag, SymbolTable, Tex, TexBlock, type SymbolEntry } from '@/components'
import { loopGainK, msdAfterBlocks, msdSplit } from '@/simulation/models/optimizer'
import { Hand, HandLink } from '../Hand'
import { HANDCALCS } from '../handcalcs'
import { BIAS2, md, nf, tx } from '../shared'

const SYMBOLS: SymbolEntry[] = [
  {
    symbol: '\\delta_k=a-w_k',
    meaning: '第 k 次更新後的剩餘係數誤差（register error）',
    unit: '\\mathrm{fs}',
    firstSeen: '§14.0',
    note: (
      <>
        全站約定 <Tex>{'\\delta=a-w'}</Tex>（§12 寫 <Tex>{'\\delta w=w-w^*'}</Tex>，差一個負號：雜訊項變號，二階矩相同）
      </>
    ),
  },
  { symbol: '\\delta_0', meaning: '開始校正時的初始誤差（確定值）', unit: '\\mathrm{fs}', firstSeen: '§14.0' },
  { symbol: 'w_k', meaning: '第 k 個 block 使用的校正係數（gain register）', unit: '\\mathrm{fs}', firstSeen: '§14.0' },
  {
    symbol: '\\mu',
    meaning: 'learning rate／gain_step（每 block 的更新倍率）',
    unit: '\\mathrm{fs}',
    firstSeen: '§14.0',
    note: (
      <>
        average-mode GMAC（<Tex>{'G'}</Tex> 無因次）時 <Tex>{'\\mu'}</Tex> 與 <Tex>{'w'}</Tex> 同單位（勘誤 E13）
      </>
    ),
  },
  {
    symbol: 'K=K_qC',
    meaning: (
      <>
        GMAC 的平均斜率 <Tex>{'-\\partial E[G]/\\partial w'}</Tex>（<Tex>{'K>0'}</Tex> 才有恢復力）
      </>
    ),
    unit: '\\mathrm{fs}^{-1}',
    firstSeen: '§14.1',
    note: (
      <>
        勘誤 E13：§0 未定義 <Tex>{'K'}</Tex>，本站定義 <Tex>{'K:=K_qC'}</Tex>
      </>
    ),
  },
  { symbol: 'K_q=\\sqrt{2/\\pi}/\\sigma_v', meaning: '1-bit comparator 的小訊號增益（§5.1）', unit: '\\mathrm{fs}^{-1}', firstSeen: '§14.1' },
  {
    symbol: 'C=E[x\\,u]=|H|\\cos\\theta',
    meaning: '有效相關（誤差路徑在 code 頻帶的增益乘上相位的餘弦）',
    unit: '—',
    firstSeen: '§14.1',
    note: (
      <>
        <Tex>{'|\\theta|\\ge90^\\circ\\Rightarrow C\\le0'}</Tex>：極性錯誤（Ch06）
      </>
    ),
  },
  { symbol: 'g=\\mu K', meaning: '無因次迴路增益', unit: '—', firstSeen: '§14.1' },
  { symbol: 'p=1-g', meaning: '平均誤差的 pole（每 block 乘上的倍數）', unit: '—', firstSeen: '§14.1' },
  {
    symbol: '\\eta_k',
    meaning: (
      <>
        第 k 個 block 的 GMAC 雜訊（<Tex>{'G_k'}</Tex> 減去平均值）
      </>
    ),
    unit: '—',
    firstSeen: '§14.1',
    note: (
      <>
        <Tex>{'E[\\eta_k]=0'}</Tex>；不同 block 互相獨立
      </>
    ),
  },
  {
    symbol: '\\sigma_\\eta^2',
    meaning: (
      <>
        <Tex>{'\\eta'}</Tex> 的變異數；<Tex>{'x=\\pm1'}</Tex>、近鎖定時 <Tex>{'\\approx1/N'}</Tex>
      </>
    ),
    unit: '—',
    firstSeen: '§14.1',
    note: (
      <>
        精確值 <Tex>{'(1-m^2)/N'}</Tex>，<Tex>{'m=E[q\\,x]'}</Tex>
      </>
    ),
  },
  { symbol: '\\sigma_v', meaning: 'comparator 前的雜訊 RMS', unit: '\\mathrm{fs}', firstSeen: '§14.0' },
  { symbol: 'N', meaning: '每個 GMAC block 累加的 comparator 樣本數', unit: '—', firstSeen: '§14.0' },
  { symbol: 'B', meaning: '更新次數（GMAC block 數）', unit: '—', firstSeen: '§14.0' },
  { symbol: 'T=NB', meaning: '總比較次數（開機校正的時間預算乘上 comparator rate）', unit: '—', firstSeen: '§14.0' },
  { symbol: 'f_s,\\ f_u=f_s/N', meaning: 'comparator 取樣率與 block（更新）率', unit: '\\mathrm{Hz}', firstSeen: '§14.3' },
  { symbol: 'A=4BK^2\\delta_0^2/\\sigma_\\eta^2', meaning: '「初始誤差 ÷ 雜訊底」的無因次比', unit: '—', firstSeen: '§14.2' },
  { symbol: '\\tau=-1/\\ln|p|', meaning: '平均誤差的時間常數', unit: '\\text{blocks}', firstSeen: '§14.2' },
  {
    symbol: '\\epsilon',
    meaning: (
      <>
        相對縮減比：要求 <Tex>{'|E[\\delta_B]|\\le\\epsilon|\\delta_0|'}</Tex>，<Tex>{'0<\\epsilon<1'}</Tex>
      </>
    ),
    unit: '—',
    firstSeen: '§14.5',
    note: '勘誤 E16：不是絕對誤差（fs）',
  },
  {
    symbol: 'K_{\\min},K_{\\max}',
    meaning: (
      <>
        所有 PVT／FCW corner 中最小、最大的 <Tex>{'K_i'}</Tex>（<Tex>{'i'}</Tex> = corner 編號）
      </>
    ),
    unit: '\\mathrm{fs}^{-1}',
    firstSeen: '§14.5',
    note: (
      <>
        勘誤 E13：<Tex>{'K_i=-\\partial E[G]/\\partial w\\,|_{\\text{corner }i}'}</Tex>，不是參數索引
      </>
    ),
  },
  { symbol: 'r=K_{\\min}/K_{\\max}', meaning: 'corner 散佈比（§14.5）', unit: '—', firstSeen: '§14.5', note: '§14.2 另以 r 表示 ramp 漂移（fs/block），依上下文與單位區分' },
  { symbol: 'PM,\\ PM_t,\\ g_{\\max}', meaning: '一階 calibration loop 的 phase margin、其下限，與對應的最大迴路增益', unit: '^\\circ,\\ —', firstSeen: '§14.2' },
  {
    symbol: 'r\\ (\\text{ramp})',
    meaning: (
      <>
        PVT ramp 漂移：<Tex>{'a'}</Tex> 每 block 增加的量
      </>
    ),
    unit: '\\mathrm{fs/block}',
    firstSeen: '§14.2',
  },
  { symbol: '\\sigma_\\zeta', meaning: 'random-walk 漂移每 block 的標準差', unit: '\\mathrm{fs}', firstSeen: '§14.2' },
  {
    symbol: 'S_w(e^{j\\Omega})',
    meaning: (
      <>
        係數雜訊 PSD（two-sided DTFT，<Tex>{'\\sigma_w^2=\\frac1{2\\pi}\\int_{-\\pi}^{\\pi}S_w\\,d\\Omega'}</Tex>）
      </>
    ),
    unit: '\\mathrm{fs^2/(cycle/block)}',
    firstSeen: '§14.2',
    note: (
      <>
        <Tex>{'\\Omega'}</Tex>（rad/block）以 block rate <Tex>{'f_u=f_s/N'}</Tex> 為準，不是 <Tex>{'f_s'}</Tex>
      </>
    ),
  },
  {
    symbol: 'P_k,\\ k_0',
    meaning: (
      <>
        最佳排程下的 <Tex>{'E[\\delta_k^2]'}</Tex>（Kalman 變異數）與其起點偏移 <Tex>{'k_0=\\sigma_\\eta^2/(K^2\\delta_0^2)'}</Tex>
      </>
    ),
    unit: '\\mathrm{fs}^2,\\ —',
    firstSeen: '§14.6',
  },
  { symbol: '\\Delta,\\ M,\\ \\hat K', meaning: '量測斜率時的擾動大小、每側 block 數與斜率估計值', unit: '\\mathrm{fs},\\ —,\\ \\mathrm{fs^{-1}}', firstSeen: '§14.5' },
]

/** 某個難度的手算題連結（以頓號相連）。 */
function handLinks(level: (typeof HANDCALCS)[number]['level']) {
  return HANDCALCS.filter((h) => h.level === level).map((h, i) => (
    <Fragment key={h.id}>
      {i > 0 && '、'}
      <HandLink id={h.id} />
    </Fragment>
  ))
}

/** §14.0：問題、先算一次、符號、先備知識 */
export function S1Intro() {
  const K = loopGainK(100, 0)
  const s2 = 1 / 4096
  const mu = 0.1 / K // 讓 g = 0.1 的 μ
  const p = 1 - mu * K
  const rows = useMemo(() => [0, 1, 2, 3].map((k) => ({ k, ...msdSplit(3, p, mu, s2, k), mean: Math.pow(p, k) * 3 })), [p, mu, s2])
  const noise = mu * mu * s2
  return (
    <>
      <p className="ch14-lead">
        前面幾章告訴我們 LMS <strong>會</strong>收斂、收斂到<strong>哪裡</strong>、以及雜訊會讓係數抖多大。這一章回答最實際的問題：
        <strong>晶片上的 learning rate <Tex>{'\\mu'}</Tex>、每次累加的樣本數 <Tex>{'N'}</Tex>、校正要跑幾次 <Tex>{'B'}</Tex>，到底該怎麼選？</strong>
        答案取決於你在最佳化「什麼」——最快收斂、最小終點 RMS、最小全程誤差、最少 spur、最佳 PVT 追蹤，各自的最佳 <Tex>{'\\mu'}</Tex> 都不同。
      </p>
      <p className="small">
        <strong>動手算會比較有感覺。</strong>本章有 {HANDCALCS.length} 題「帶入手算」，各自接在對應的推導或範例正後方：先看推導，馬上把數字換成你自己的，用紙筆和計算機算一次再對答案。只需四則運算：{handLinks('beginner')}；需要工程計算機的{' '}
        <Tex>{'\\ln'}</Tex>、開根號、<Tex>{'y^x'}</Tex>：{handLinks('engineer')}；需要查 <Tex>{'\\Phi'}</Tex> 表：{handLinks('research')}。全站的題目也收在 <Link to="/workbook">手算練習簿</Link>。
      </p>

      <SymbolTable rows={SYMBOLS} caption={md(String.raw`本章極性一律 $\delta=a-w$；$K$、$\mu$ 的單位依 average-mode GMAC（$G$ 無因次）。`)} />

      <Prereq title="期望值、變異數，以及「均方等於偏差平方加變異數」">
        <p>
          <Tex>{'E[X]'}</Tex>（期望值，expectation）可以想成「同一個實驗重做非常多次，X 的平均」。變異數（variance）衡量 X 在平均值附近散多開：
        </p>
        <TexBlock>{String.raw`\mathrm{Var}(X)=E\big[(X-E[X])^2\big]=E[X^2]-(E[X])^2`}</TexBlock>
        <p>把它移項就得到本章最重要的一條恆等式：</p>
        <TexBlock>{String.raw`\boxed{E[X^2]=\underbrace{(E[X])^2}_{\text{bias}^2}+\underbrace{\mathrm{Var}(X)}_{\text{variance}}}`}</TexBlock>
        <p>
          對 <Tex>{'X=\\delta_B'}</Tex>：均方誤差 = 「平均還差多少」的平方 + 「隨機抖動」。期望值是線性的：<Tex>{'E[aX+bY]=aE[X]+bE[Y]'}</Tex>，常數可以提出來。
        </p>
      </Prereq>

      <Prereq title="獨立（independence）讓交叉項消失">
        <p>
          若 <Tex>{'X'}</Tex>、<Tex>{'Y'}</Tex> 獨立，則 <Tex>{'E[XY]=E[X]E[Y]'}</Tex>。如果其中一個平均為 0，交叉項就是 0。例如兩個不同 block 的 GMAC 雜訊：
        </p>
        <TexBlock>{String.raw`E[\eta_k\eta_j]=E[\eta_k]E[\eta_j]=0\quad(k\ne j),\qquad E[\eta_k^2]=\sigma_\eta^2`}</TexBlock>
        <p>所以「一堆獨立雜訊加權相加」的平方期望值，只剩每一項自己的平方：<Tex>{'E[(\\sum_k c_k\\eta_k)^2]=\\sigma_\\eta^2\\sum_k c_k^2'}</Tex>。</p>
      </Prereq>

      <Prereq title="等比數列求和（geometric series）">
        <p>
          令 <Tex>{'S=1+r+r^2+\\dots+r^{B-1}'}</Tex>。兩邊乘 <Tex>{'r'}</Tex> 得 <Tex>{'rS=r+r^2+\\dots+r^B'}</Tex>，相減：
        </p>
        <TexBlock>{String.raw`S-rS=1-r^B\ \Rightarrow\ S=\frac{1-r^B}{1-r}\quad(r\ne1),\qquad S=B\quad(r=1)`}</TexBlock>
        <p>
          <Tex>{'|r|<1'}</Tex> 時 <Tex>{'r^B\\to0'}</Tex>，<Tex>{'S\\to1/(1-r)'}</Tex>。本章的 <Tex>{'r=p^2'}</Tex>。
        </p>
      </Prereq>

      <Prereq title="高斯分布、標準常態 CDF、erf，以及 comparator 增益從哪裡來">
        <p>
          comparator 看到 <Tex>{'e=\\delta+v'}</Tex>，<Tex>{'v\\sim\\mathcal N(0,\\sigma_v^2)'}</Tex>（高斯分布：鐘形曲線，68% 落在 <Tex>{'\\pm\\sigma_v'}</Tex> 內）。輸出 <Tex>{'q=+1'}</Tex> 的機率是
          <Tex>{'P(v>-\\delta)=\\Phi(\\delta/\\sigma_v)'}</Tex>，<Tex>{'\\Phi'}</Tex> 是標準常態的累積分布。因此
        </p>
        <TexBlock>{String.raw`E[q]=2\Phi(\delta/\sigma_v)-1=\mathrm{erf}\!\Big(\frac{\delta}{\sqrt2\sigma_v}\Big)\approx\frac{2}{\sqrt\pi}\cdot\frac{\delta}{\sqrt2\sigma_v}=\sqrt{\frac{2}{\pi}}\frac{\delta}{\sigma_v}=K_q\delta`}</TexBlock>
        <p>
          最後一步是泰勒一階展開（erf 在 0 的斜率為 <Tex>{'2/\\sqrt\\pi'}</Tex>），所以只有 <Tex>{'|\\delta|\\ll\\sigma_v'}</Tex> 時線性。<Tex>{'|\\delta|'}</Tex> 大時 erf 飽和在 <Tex>{'\\pm1'}</Tex>——這就是勘誤 E48 的 slew-limited 區。
        </p>
      </Prereq>

      <Prereq title="相關（correlation）：$C$ 是什麼">
        <p>
          兩個零均值訊號的相關 <Tex>{'E[x\\,u]'}</Tex> 衡量「<Tex>{'x'}</Tex> 大的時候 <Tex>{'u'}</Tex> 是不是也傾向大」。GMAC 把 comparator 輸出乘上原始 code <Tex>{'x'}</Tex> 再平均，所以它能看到的只有
          「誤差 <Tex>{'\\delta u'}</Tex> 裡跟 <Tex>{'x'}</Tex> 相關的部分」。若 <Tex>{'x=\\pm1'}</Tex> 經過誤差路徑變成 <Tex>{'u=c\\,x[n]+s\\,x[n-1]'}</Tex>（本章的相位模型，<Tex>{'c=|H|\\cos\\theta,\\ s=|H|\\sin\\theta'}</Tex>）：
        </p>
        <TexBlock>{String.raw`C=E[x[n]\,u[n]]=c\,E[x[n]^2]+s\,E[x[n]x[n-1]]=c\cdot1+s\cdot0=|H|\cos\theta`}</TexBlock>
        <p>
          延遲一拍的分量 <Tex>{'s'}</Tex> 與 <Tex>{'x[n]'}</Tex> 獨立、平均為 0，所以不提供恢復力；<Tex>{'\\theta>90^\\circ'}</Tex> 時 <Tex>{'C<0'}</Tex>，更新方向反了（Ch06）。
        </p>
      </Prereq>

      <Prereq title="Pole、Z transform 與一階迴路的 phase margin">
        <p>
          差分方程 <Tex>{'\\delta_{k+1}=p\\delta_k'}</Tex> 的解是 <Tex>{'\\delta_k=p^k\\delta_0'}</Tex>：<Tex>{'|p|<1'}</Tex> 收斂、<Tex>{'p<0'}</Tex> 正負交替。用 Z transform（把序列寫成 <Tex>{'z^{-k}'}</Tex> 的冪級數，延遲一拍 = 乘 <Tex>{'z^{-1}'}</Tex>）看，LMS 是一個積分器 <Tex>{'1/(z-1)'}</Tex> 乘上增益 <Tex>{'g'}</Tex>：
        </p>
        <TexBlock>{String.raw`\begin{aligned}
L(z)&=\frac{g}{z-1},\qquad z=e^{j\omega}\ (\omega\ \text{以 rad/block 計})\\
e^{j\omega}-1&=e^{j\omega/2}\big(e^{j\omega/2}-e^{-j\omega/2}\big)=e^{j\omega/2}\cdot2j\sin\tfrac{\omega}{2}\\
L(e^{j\omega})&=\frac{g}{2\sin(\omega/2)}\,e^{-j(\pi/2+\omega/2)}\\
|L(e^{j\omega_c})|=1&\Rightarrow\sin\tfrac{\omega_c}{2}=\tfrac g2\\
PM&=\pi+\angle L(e^{j\omega_c})=\tfrac{\pi}{2}-\tfrac{\omega_c}{2}=90^\circ-\arcsin\tfrac g2
\end{aligned}`}</TexBlock>
        <p className="small muted">
          第 2 行把 <Tex>{'e^{j\\omega/2}'}</Tex> 提出來（Euler：<Tex>{'e^{jx}-e^{-jx}=2j\\sin x'}</Tex>）；第 3 行的 <Tex>{'1/j=e^{-j\\pi/2}'}</Tex> 給出 <Tex>{'-90^\\circ'}</Tex>；最後把弧度換成度。
        </p>
        <p>
          <Tex>{'g=1'}</Tex>（<Tex>{'p=0'}</Tex>）時 <Tex>{'PM=60^\\circ'}</Tex>；<Tex>{'g\\to2'}</Tex> 時 <Tex>{'PM\\to0^\\circ'}</Tex>。細節見 Ch08。
        </p>
      </Prereq>

      <Prereq title="PSD（功率頻譜密度）與信賴區間（只用到的部分）">
        <p>
          PSD <Tex>{'S(e^{j\\Omega})'}</Tex> 告訴你訊號功率分布在哪些頻率：<Tex>{'\\sigma^2=\\frac1{2\\pi}\\int_{-\\pi}^{\\pi}S\\,d\\Omega'}</Tex>。白雜訊經過濾波器 <Tex>{'H'}</Tex> 後 PSD 乘上 <Tex>{'|H|^2'}</Tex>。
          Monte Carlo 的平均值有誤差；95% 信賴區間 <Tex>{'\\approx\\bar X\\pm1.96\\,s/\\sqrt{R}'}</Tex>（<Tex>{'s'}</Tex> 是樣本標準差、<Tex>{'R'}</Tex> 是獨立重複次數；來自中央極限定理：很多獨立樣本的平均近似高斯）。
        </p>
      </Prereq>

      <Section kind="intuition" level={2} title={md(String.raw`14.0 一個問題：$\mu$ 大一點好，還是小一點好？`)} id="ch14-question">
        <p>
          你有一顆 DTC gain 校正：comparator 雜訊 <Tex>{'\\sigma_v=100\\,\\mathrm{fs}'}</Tex>、每個 GMAC block 累加 <Tex>{'N=4096'}</Tex> 次、開機只給
          <Tex>{'T=131072'}</Tex> 次比較（<Tex>{'f_s=4\\,\\mathrm{GHz}'}</Tex> 時約 32.8 µs），也就是 <Tex>{'B=32'}</Tex> 次更新。初始誤差 <Tex>{'\\delta_0=3\\,\\mathrm{fs}'}</Tex>。
        </p>
        <ul>
          <li>
            <strong><Tex>{'\\mu'}</Tex> 太小</strong>：每次只修一點點，32 次後初始誤差還沒收完（<strong>bias</strong> 大）。
          </li>
          <li>
            <strong><Tex>{'\\mu'}</Tex> 太大</strong>：每次更新都把 GMAC 雜訊乘上 <Tex>{'\\mu'}</Tex> 灌進係數（<strong>variance</strong> 大）。
          </li>
        </ul>
        <p>中間一定有個最佳點。我們先用數字感受，再推公式。</p>
      </Section>

      <Section kind="example" level={2} title={md('14.0.1 先算一次：$g=0.1$ 的前三個 block')} id="ch14-hand">
        <p>
          取 <Tex>{`K=K_q=\\sqrt{2/\\pi}/100=${tx(K, 6)}\\,\\mathrm{fs^{-1}}`}</Tex>，選 <Tex>{`\\mu=0.1/K=${tx(mu, 5)}\\,\\mathrm{fs}`}</Tex>，所以
          <Tex>{`g=0.1,\\ p=0.9`}</Tex>；<Tex>{`\\sigma_\\eta^2=1/4096`}</Tex>，每次更新注入的雜訊功率
          <Tex>{`\\mu^2\\sigma_\\eta^2=${tx(noise, 5)}\\,\\mathrm{fs^2}`}</Tex>。均方誤差每個 block 的規則只有一行（下一節會推導）：
        </p>
        <TexBlock>{String.raw`E[\delta_{k+1}^2]=p^2\,E[\delta_k^2]+\mu^2\sigma_\eta^2`}</TexBlock>
        <TexBlock>{String.raw`\begin{aligned}
E[\delta_1^2]&=0.81\times ${tx(rows[0].total, 5)}+${tx(noise, 4)}=${tx(rows[1].total, 6)}\\
E[\delta_2^2]&=0.81\times ${tx(rows[1].total, 6)}+${tx(noise, 4)}=${tx(rows[2].total, 6)}\\
E[\delta_3^2]&=0.81\times ${tx(rows[2].total, 6)}+${tx(noise, 4)}=${tx(rows[3].total, 6)}
\end{aligned}`}</TexBlock>
        <div className="table-wrap">
          <table className="ch14-table">
            <thead>
              <tr>
                <th>
                  <Tex>{'k'}</Tex>
                </th>
                <th>
                  <Tex>{'E[\\delta_k]=p^k\\delta_0'}</Tex>
                </th>
                <th>
                  <Tex>{'\\text{bias}^2=p^{2k}\\delta_0^2'}</Tex>
                </th>
                <th>
                  <Tex>{'\\text{variance}=\\mu^2\\sigma_\\eta^2\\frac{1-p^{2k}}{1-p^2}'}</Tex>
                </th>
                <th>
                  <Tex>{'E[\\delta_k^2]\\ (\\mathrm{fs^2})'}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.k}>
                  <td className="num">{r.k}</td>
                  <td className="num">{nf(r.mean, 5)}</td>
                  <td className="num">{nf(r.bias2, 5)}</td>
                  <td className="num">{nf(r.variance, 5)}</td>
                  <td className="num">{nf(r.total, 6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          觀察：{BIAS2} 每步乘 0.81（縮小 19%），variance 從 0 開始慢慢長，最後停在 <Tex>{`\\mu^2\\sigma_\\eta^2/(1-p^2)=${tx(msdAfterBlocks(0, p, mu, s2, 1e6), 4)}\\,\\mathrm{fs^2}`}</Tex>。
          表格最後一欄與下一節的封閉式完全相同 <ClaimTag kind="exact" /> <SourceTag kind="illustrative" />。
        </p>
        <Callout kind="info" title="你會發現">
          前幾個 block 幾乎全是 {BIAS2}；如果只跑 3 個 block，<Tex>{'\\mu'}</Tex> 應該再大一點。但 <Tex>{'B=32'}</Tex> 時 {BIAS2} 會被壓到很小，variance 反而成為主角——<strong>最佳 <Tex>{'\\mu'}</Tex> 取決於 <Tex>{'B'}</Tex></strong>。
        </Callout>
        <Hand id="HC-14.1">
          上面的表格是 <Tex>{'g=0.1'}</Tex> 的情形。把 <Tex>{'g'}</Tex> 改成 0.25 或 0.5（或換成你自己的 <Tex>{'K'}</Tex>、<Tex>{'N'}</Tex>），先用紙筆照同一條遞迴算三列，再對答案——注意 <Tex>{'g'}</Tex> 越大，{BIAS2} 掉得越快，但每次注入的雜訊也越大。
        </Hand>
      </Section>
    </>
  )
}
