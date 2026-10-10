import type { ReactNode } from 'react'
import { Callout, ClaimTag, CodeBlock, ModeGate, Prereq, Section, Tex, TexBlock } from '@/components'
import jsonLabSrc from '../experiments/jsonLabModel.ts?raw'
import { ar1EffectiveSamples, ar1RelSeStd, ar1SeMean } from '../experiments/jsonLabModel'
import { ChLink, HandCalcSlot, Steps, md, texNum } from '../common'
import { SPEC_NUMBERS } from '../refNumbers'

/** §15.3 預設模擬（num_blocks = 2000）拿來做統計的後半段 block 數 */
const TAIL_BLOCKS = 1000

type Status = 'yes' | 'partial' | 'no'

interface OutRow {
  item: ReactNode
  status: Status
  where: ReactNode
  note?: ReactNode
}

interface OutGroup {
  group: string
  rows: OutRow[]
}

const GROUPS: OutGroup[] = [
  {
    group: '時域',
    rows: [
      { item: md('$x[n]$、$u[n]$、$e[n]$、$q[n]$'), status: 'yes', where: '本頁 JSON Lab（trace，前 sample_trace_blocks 個 block）', note: 'trace.x / u / e / q / xRef' },
      { item: md('每個 block 的 $G_k$、$w_k$'), status: 'yes', where: '本頁 JSON Lab（圖 + CSV）', note: 'blocks.G、blocks.w、blocks.wPhys' },
      { item: '輸出相位誤差', status: 'partial', where: <ChLink to="/ch/12">Ch12</ChLink>, note: md('gain noise 乘上 code 後經線性 $T(z)$ 的輸出；JSON Lab 不輸出') },
    ],
  },
  {
    group: '參數統計',
    rows: [
      { item: 'mean gain、bias、standard deviation、MSE', status: 'yes', where: '本頁 JSON Lab 指標表', note: '後半段 blocks；SE 以 AR(1) 有效樣本數' },
      { item: 'settling / convergence time', status: 'yes', where: 'JSON Lab：settlingBlock', note: md('最後一次離開 $4\\sigma$ 帶之後的 block') },
      { item: 'saturation count、limit-cycle count', status: 'yes', where: 'JSON Lab（quantize_physical）', note: '另含 wrap 次數與 limit-cycle 週期' },
    ],
  },
  {
    group: '穩定性',
    rows: [
      {
        item: md('$K$、$C_D$、$S=\\partial G/\\partial w$'),
        status: 'yes',
        where: md('JSON Lab 解析區塊（$K$、$C$、mean-field 斜率 $K_\\mathrm{mf}$）'),
        note: md('$C_D$：設定 regressor_mode = delayed 與 $D$。規格的 $S=\\partial G/\\partial w$ 要是負值才有恢復力；本站顯示 $K_\\mathrm{mf}=-\\partial E[G]/\\partial w=-S$（正值代表有恢復力），避免和 GMAC 總和 $S_k$ 混淆'),
      },
      { item: md('$\\lambda_{\\min}$、$\\kappa$、Jacobian eigenvalues'), status: 'partial', where: <><ChLink to="/ch/09">Ch09</ChLink>、<ChLink to="/ch/10">Ch10</ChLink></>, note: 'JSON Lab 只有單一參數，沒有矩陣' },
      { item: md('$\\rho(\\mathbf A)$'), status: 'yes', where: md('JSON Lab：$z^{d+1}-z^d+g=0$ 的 spectral radius；Ch08 雙迴路'), note: '' },
      { item: '理想 / 完整 PM', status: 'partial', where: <><ChLink to="/ch/08">Ch08</ChLink>、JSON Lab（理想一階 PM）</>, note: '含主 PLL 耦合的完整 PM 只在 Ch08 的 2 狀態模型' },
    ],
  },
  {
    group: '頻域',
    rows: [
      { item: 'Code PSD', status: 'partial', where: <><ChLink to="/ch/04">Ch04</ChLink>、<ChLink to="/ch/12">Ch12</ChLink></>, note: 'dsmSpectra（Welch，標示 window / nperseg / ENBW）' },
      { item: 'Gain-code PSD、DTC time-error PSD', status: 'partial', where: <ChLink to="/ch/12">Ch12</ChLink>, note: 'ZOH multirate PSD（E09、E29）；平穩近似' },
      { item: 'PLL output phase noise、integrated jitter', status: 'partial', where: <ChLink to="/ch/12">Ch12</ChLink>, note: '線性化；不含 cyclostationary 項（R2）' },
      { item: 'spur frequency / dBc', status: 'partial', where: <><ChLink to="/ch/12">Ch12</ChLink>（<Tex>{'-93.8\\,\\mathrm{dBc}'}</Tex>，T15）、本頁 §8</>, note: '§8 示範三種量測模式的差異' },
    ],
  },
  {
    group: '不確定性',
    rows: [
      { item: 'Monte Carlo 多 seeds、confidence intervals', status: 'yes', where: 'JSON Lab：Monte Carlo（8 seeds，Student-t 95% CI）', note: '' },
      { item: 'effective sample size', status: 'partial', where: 'JSON Lab：AR(1) 近似（下方 §7.1，F-15.12）；core/stats.effectiveSampleSize（Geyer）', note: 'JSON Lab 只用 lag-1 自相關；一般的自相關序列要用 Geyer 截斷法' },
      { item: '相關雜訊的 autocorrelation', status: 'no', where: 'Not implemented（R1：colored noise）', note: '本站雜訊皆為 iid Gaussian' },
    ],
  },
  {
    group: '來源可追溯性',
    rows: [
      { item: '參數 JSON、seed', status: 'yes', where: 'JSON Lab：下載原文 / 補齊後設定；ExperimentShell 的 JSON 匯出', note: '' },
      { item: 'formula ID、模型層級', status: 'yes', where: '每個 TexBlock 的 F-xx.y 錨點；ExperimentShell 的 ModelLevel 徽章', note: '' },
      { item: 'simulation version、git commit', status: 'yes', where: 'ExperimentShell「模擬條件摘要」與 JSON / HTML 報告', note: '無 git 時標示 uncommitted' },
    ],
  },
]

const LABEL: Record<Status, string> = { yes: '✅ 提供', partial: '◐ 部分', no: '✗ Not implemented' }

/** §7 §15.4 標準輸出：本站提供哪些 */
export function S6Outputs() {
  const all = GROUPS.flatMap((g) => g.rows)
  const count = (s: Status) => all.filter((r) => r.status === s).length
  const n = SPEC_NUMBERS
  // §15.3 範例：ρ₁ = p、s_w = σ_w（解析值）代入 JSON Lab 用的同一組函式
  const nEff = ar1EffectiveSamples(TAIL_BLOCKS, n.p)
  const se = ar1SeMean(n.sigmaW, n.p, TAIL_BLOCKS)
  const relSe = ar1RelSeStd(n.p, TAIL_BLOCKS)
  return (
    <section aria-labelledby="models-s7">
      <h2 id="models-s7">7｜§15.4 標準輸出：本站提供哪些、還缺哪些</h2>
      <p>
        規格要求每個實驗輸出六大類資訊。下表逐項標示本站的實際狀態：<strong>{count('yes')}</strong> 項提供、<strong>{count('partial')}</strong> 項部分提供（在其他章節或簡化版本）、<strong>{count('no')}</strong>{' '}
        項未實作。
      </p>
      <div className="table-wrap">
        <table className="models-table">
          <thead>
            <tr>
              <th>類別</th>
              <th>輸出</th>
              <th>狀態</th>
              <th>在哪裡</th>
              <th>備註</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((g) =>
              g.rows.map((r, i) => (
                <tr key={`${g.group}-${i}`}>
                  {i === 0 && <th rowSpan={g.rows.length}>{g.group}</th>}
                  <td>{r.item}</td>
                  <td className="nowrap">
                    <span className={`models-status models-status-${r.status === 'yes' ? 'full' : r.status === 'partial' ? 'partial' : 'none'}`}>{LABEL[r.status]}</span>
                  </td>
                  <td>{r.where}</td>
                  <td className="small">{r.note}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <Section kind="assumptions" title="為什麼要這麼多輸出？" level={3}>
        <p>
          因為單一數字可以騙人：<strong>GMAC 歸零</strong>不代表 bias 為零（§3.5）；<strong><Tex>{'\\sigma_w'}</Tex> 很小</strong>不代表 output jitter 小（gain noise 要再乘 code、經 <Tex>{'T(z)'}</Tex>，Ch12）；<strong>一條 FFT 沒有峰</strong>不代表沒有 spur（§8）；
          <strong>8 個 seed 都收斂</strong>不代表全域穩定（§10）。每個結論都要能追溯到「哪個模型、哪組參數、哪個 seed、哪一版程式」。
        </p>
      </Section>
      <Section kind="formula" title="7.1 模擬值與解析值差多少算「一致」？AR(1) 有效樣本數" level={3}>
        <p>
          JSON Lab 的指標表把「後半段 <Tex>{'w'}</Tex> 的平均」和 mean-field 固定點 <Tex>{'w^*'}</Tex> 並列，差距在容忍度內才打勾。容忍度不能隨便訂：相鄰 block 的 <Tex>{'w_k'}</Tex> 高度相關（<Tex>{'w'}</Tex>{' '}
          每次只動一點點），{TAIL_BLOCKS} 個 block <strong>不等於</strong> {TAIL_BLOCKS} 個獨立樣本。
        </p>
        <Prereq title="共變異數（covariance）與「和的變異數」">
          <p>
            <Tex>{'\\mathrm{Cov}(X,Y)=E[(X-E[X])(Y-E[Y])]'}</Tex> 衡量兩個量「一起偏高或偏低」的程度；<Tex>{'\\mathrm{Cov}(X,X)=\\mathrm{Var}(X)'}</Tex>，獨立時為 0。相關係數是把它除以兩個標準差：
            <Tex>{'\\rho=\\mathrm{Cov}(X,Y)/(\\sigma_X\\sigma_Y)'}</Tex>，介於 <Tex>{'\\pm1'}</Tex>。把 <Tex>{'(X_1+\\cdots+X_n)^2'}</Tex> 展開就得到
            <Tex>{'\\mathrm{Var}\\bigl(\\sum_iX_i\\bigr)=\\sum_i\\sum_j\\mathrm{Cov}(X_i,X_j)'}</Tex>：共 <Tex>{'n^2'}</Tex> 項；獨立時只剩對角線的 <Tex>{'n'}</Tex> 項，回到熟悉的 <Tex>{'\\mathrm{Var}(\\bar X)=\\sigma^2/n'}</Tex>。
          </p>
        </Prereq>
        <Steps
          title="平均值的變異數：把所有兩兩相關加起來"
          steps={[
            {
              tex: String.raw`\delta_{k+\ell}=p^{\ell}\,\delta_k-\mu\sum_{i=0}^{\ell-1}p^{\,\ell-1-i}\eta_{k+i}\;\Rightarrow\;\mathrm{Cov}(w_k,w_{k+\ell})=\sigma_w^2\,p^{|\ell|}`,
              why: '把 §3.4 的遞迴 $\\delta_{k+1}=p\\delta_k-\\mu\\eta_k$ 往前代 $\\ell$ 次：後面那一串新雜訊與 $\\delta_k$ 獨立，所以相隔 $\\ell$ 個 block 的相關係數是 $p^{|\\ell|}$。這種序列叫 AR(1)，相鄰的相關係數記作 $\\rho_1$（這裡 $\\rho_1=p$）。',
            },
            {
              tex: String.raw`\bar w=\frac{1}{N_\mathrm{blk}}\sum_{k=1}^{N_\mathrm{blk}}w_k\;\Rightarrow\;\mathrm{Var}(\bar w)=\frac{1}{N_\mathrm{blk}^2}\sum_i\sum_j\mathrm{Cov}(w_i,w_j)=\frac{\sigma_w^2}{N_\mathrm{blk}^2}\sum_i\sum_j\rho_1^{|i-j|}`,
              why: '和的變異數＝所有兩兩共變異數的總和；常數 $1/N_\\mathrm{blk}$ 提出來變成平方。',
            },
            {
              tex: String.raw`\sum_{i=1}^{N_\mathrm{blk}}\sum_{j=1}^{N_\mathrm{blk}}\rho_1^{|i-j|}=N_\mathrm{blk}+2\sum_{\ell=1}^{N_\mathrm{blk}-1}(N_\mathrm{blk}-\ell)\,\rho_1^{\ell}`,
              why: '對角線（$\\ell=0$）有 $N_\\mathrm{blk}$ 項，每項是 1；相隔 $\\ell$ 的配對有 $N_\\mathrm{blk}-\\ell$ 組，$i<j$ 與 $i>j$ 各算一次。',
            },
            {
              tex: String.raw`\approx N_\mathrm{blk}\Bigl(1+2\sum_{\ell=1}^{\infty}\rho_1^{\ell}\Bigr)=N_\mathrm{blk}\Bigl(1+\frac{2\rho_1}{1-\rho_1}\Bigr)=N_\mathrm{blk}\,\frac{1+\rho_1}{1-\rho_1}`,
              why: '$N_\\mathrm{blk}\\gg1/(1-\\rho_1)$ 時，$\\rho_1^\\ell$ 在 $\\ell$ 還遠小於 $N_\\mathrm{blk}$ 就衰減到 0，所以 $(N_\\mathrm{blk}-\\ell)\\approx N_\\mathrm{blk}$、上限可以放到 $\\infty$；再用等比級數 $\\sum_{\\ell\\ge1}\\rho^\\ell=\\rho/(1-\\rho)$。',
            },
            {
              tex: String.raw`\mathrm{Var}(\bar w)\approx\frac{\sigma_w^2}{N_\mathrm{blk}}\cdot\frac{1+\rho_1}{1-\rho_1}\equiv\frac{\sigma_w^2}{N_\mathrm{eff}},\qquad N_\mathrm{eff}=N_\mathrm{blk}\,\frac{1-\rho_1}{1+\rho_1}`,
              why: '和獨立樣本的 $\\sigma^2/n$ 對照，定義「有效樣本數」$N_\\mathrm{eff}$：相關越強，$N_\\mathrm{eff}$ 越小。',
            },
            {
              tex: String.raw`\rho_1=p=${texNum(n.p, 5)},\;N_\mathrm{blk}=${TAIL_BLOCKS}:\quad N_\mathrm{eff}=${TAIL_BLOCKS}\times\frac{${texNum(1 - n.p, 5)}}{${texNum(1 + n.p, 5)}}=${texNum(nEff, 4)},\qquad \mathrm{SE}(\bar w)=\frac{\sigma_w}{\sqrt{N_\mathrm{eff}}}=\frac{${texNum(n.sigmaW, 5)}}{\sqrt{${texNum(nEff, 4)}}}=${texNum(se, 3)}\,\mathrm{fs}`,
              why: `代入 §15.3 範例：${TAIL_BLOCKS} 個 block 只相當於約 ${Math.round(nEff)} 個獨立樣本。JSON Lab 的容忍度取 $4\\,\\mathrm{SE}\\approx${texNum(4 * se, 3)}\\,\\mathrm{fs}$；如果誤當成獨立樣本，會以為 $\\mathrm{SE}=${texNum(n.sigmaW / Math.sqrt(TAIL_BLOCKS), 2)}\\,\\mathrm{fs}$，把正確的模擬判成「不一致」。`,
            },
          ]}
          result={String.raw`N_\mathrm{eff}=N_\mathrm{blk}\,\frac{1-\rho_1}{1+\rho_1},\qquad \mathrm{SE}(\bar w)=\frac{s_w}{\sqrt{N_\mathrm{eff}}}`}
        />
        <TexBlock id="F-15.12" label="AR(1) 有效樣本數與平均值的標準誤">
          {String.raw`\mathrm{Var}(\bar w)\approx\frac{\sigma_w^2}{N_\mathrm{blk}}\cdot\frac{1+\rho_1}{1-\rho_1}=\frac{\sigma_w^2}{N_\mathrm{eff}},\quad N_\mathrm{eff}=N_\mathrm{blk}\,\frac{1-\rho_1}{1+\rho_1},\quad \mathrm{SE}(\bar w)=\frac{s_w}{\sqrt{N_\mathrm{eff}}}`}
        </TexBlock>
        <p className="small">
          <ClaimTag kind="approx" /> 需要：暫態已經過去（所以只用後半段）、<Tex>{'N_\\mathrm{blk}\\gg1/(1-\\rho_1)'}</Tex>、<Tex>{'w'}</Tex> 近似 AR(1)（<Tex>{'d=0'}</Tex> 的一階平均模型時精確；有更新延遲或量化時只是近似）。JSON Lab 實際代入的是<strong>資料</strong>的 lag-1
          自相關 <Tex>{'\\hat\\rho_1'}</Tex> 與樣本標準差 <Tex>{'s_w'}</Tex>，不是解析值：平均值的容忍度是 <Tex>{'4\\,\\mathrm{SE}'}</Tex>（定點模式再加 1 LSB），<Tex>{'\\sigma_w'}</Tex> 的相對容忍度是{' '}
          <Tex>{`\\max(5\\%,\\,4\\times${texNum(100 * relSe, 3)}\\%)`}</Tex>，其中 <Tex>{`${texNum(100 * relSe, 3)}\\%`}</Tex> 來自 <Tex>{'\\sqrt{(1+\\rho_1^2)/(2N_\\mathrm{blk}(1-\\rho_1^2))}'}</Tex>（Gaussian AR(1) 的樣本標準差）。
        </p>
        <ModeGate min="engineer">
          <CodeBlock
            source={jsonLabSrc}
            region="ar1StandardError"
            path="src/pages/models/experiments/jsonLabModel.ts"
            title="core:ar1StandardError（jsonLabModel.ts）"
            caption="JSON Lab 指標表與交叉比對實際呼叫的三個函式；tailStats() 把資料的 $\hat\rho_1$ 與 $s_w$ 代進去。"
          />
        </ModeGate>
        <HandCalcSlot id="HC-MD.5">
          你打算模擬幾個 block？pole 多靠近 1？代進去算算看，這筆紀錄相當於幾個獨立樣本、平均值能量到多準。
        </HandCalcSlot>
      </Section>
      <Callout kind="info" title="誠實標示">
        「◐ 部分」表示該輸出在別的章節以簡化模型提供，或只在特定條件成立；「✗ Not implemented」表示本站目前沒有，不會在任何頁面顯示成已驗證。
      </Callout>
    </section>
  )
}
