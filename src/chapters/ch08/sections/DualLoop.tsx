import { useMemo } from 'react'
import {
  Callout,
  ClaimTag,
  CodeBlock,
  CodeCompare,
  Mermaid,
  ModeGate,
  Prereq,
  Quiz,
  Section,
  StepDerivation,
  Tex,
  TexBlock,
  TestBadge,
} from '@/components'
import stabilitySrc from '@/simulation/models/stability.ts?raw'
import {
  analyzeDualLoop,
  analyzeGeneral,
  calLoopGainGeneral,
  dualLoopFullMuRange,
  dualLoopGainMargin,
  dualLoopSimplifiedMuRange,
  loopMargins,
  peakAbs,
  pmFirstOrder,
  simulateFullModel,
  stableIntervalsNumeric,
  type DualLoopParams,
} from '@/simulation/models/stability'
import { ctx, ErratumNote, Expand, fx, HandCalcSlot, rich, sig, tx } from '../common'
import { formula } from '../formulas'
import {
  DUAL_LOOP_CHART,
  DUAL_REGIMES_CHART,
  DUAL_SIGNAL_FLOW_CHART,
  LATENCY_SPLIT_CHART,
  STABILITY_CHECK_CHART,
  STATE_SPACE_CHART,
} from '../diagrams'

const SRC_PATH = 'src/simulation/models/stability.ts'
const EX: DualLoopParams = { r: 0.8, b: 0.2, c: 1, mu: 1.2 }
const MU_TABLE = [0.02, 0.05, 0.2, 0.5, 0.8, 1, 1.2]
const R_TABLE = [-0.5, 0, 0.5, 0.8, 0.95]

/**
 * 「ρ^k 只是漸近速率的參考線，不是 |δ_k| 的包絡」用到的數字（技術審查 R02），全部由 simulateFullModel 逐 block 算出：
 * - maxRatio：p 的軌跡在前 steps 個 block 內 |δ_k|/ρ^k 的最大值（複數 pole 時會略大於 1）；
 * - doubleRatio：同一組 r_s、b_s、c_s 在重根（μ = (1 − r_s)²/(4 b_s c_s)，本例 0.05、z = 0.9）時 |δ_steps|/ρ^steps；
 *   重根的解是 δ_k = (1 + k(1 − z)/z)·z^k（由 δ_0 = δ_1 = 1 定出），本例 (1 + k/9)·0.9^k；
 * - doubleBelowE：重根的 |δ_k| 從第幾個 block 起一直 ≤ 1/e（對照 τ = −1/ln z 這個漸近時間常數）。
 */
export function dualLoopRhoReference(
  p: DualLoopParams,
  steps: number,
): { maxRatio: number; muDouble: number; zDouble: number; doubleRatio: number; doubleBelowE: number } {
  const rho = analyzeDualLoop(p).rho
  const traj = simulateFullModel(p, steps).delta
  let maxRatio = 0
  for (let k = 0; k <= steps; k++) maxRatio = Math.max(maxRatio, Math.abs(traj[k]) / rho ** k)
  // 重根門檻四捨五入到 12 位有效數字（(1 − 0.8)² / 0.8 的浮點結果是 0.04999…975，顯示與計算都用 0.05）
  const muDouble = Number(((1 - p.r) ** 2 / (4 * p.b * p.c)).toPrecision(12))
  const zDouble = (1 + p.r) / 2
  const dbl = simulateFullModel({ ...p, mu: muDouble }, steps).delta
  let lastAboveE = -1
  for (let k = 0; k <= steps; k++) if (Math.abs(dbl[k]) > Math.exp(-1)) lastAboveE = k
  return { maxRatio, muDouble, zDouble, doubleRatio: Math.abs(dbl[steps]) / zDouble ** steps, doubleBelowE: lastAboveE + 1 }
}

/** §8.4 主 PLL 與 LMS 的耦合（雙迴路；勘誤 E19、E31） */
export function DualLoop() {
  const ex = useMemo(() => analyzeDualLoop(EX), [])
  const top = ex.poles.find((z) => z.im > 0) ?? ex.poles[0]
  const disc = ex.discriminant
  const traj = useMemo(() => simulateFullModel(EX, 300).delta, [])
  // 振盪週期（blocks）與「一個週期內的峰值」：單一時間點可能剛好落在零交越附近
  const periodBlocks = (2 * Math.PI) / Math.atan2(top.im, top.re)
  const P = Math.ceil(periodBlocks)
  const windows = [30, 100, 300].map((K) => ({ K, last: Math.abs(traj[K]), lastPeriodPeak: peakAbs(traj, K - P, K), env: ex.rho ** K }))
  const first30Peak = peakAbs(traj, 0, 30)
  // ρ^k 不是 |δ_k| 的包絡（技術審查 R02）：本例（複數 pole）的峰值最多高出多少；μ = 0.05 的重根 z = 0.9 是 δ_k = (1 + k/9)·0.9^k
  const rhoRef = useMemo(() => dualLoopRhoReference(EX, 300), [])
  const dblRow = useMemo(() => analyzeDualLoop({ ...EX, mu: rhoRef.muDouble }), [rhoRef.muDouble])
  const mu05 = useMemo(() => analyzeDualLoop({ ...EX, mu: 0.5 }), [])
  const rTable = useMemo(
    () =>
      R_TABLE.map((r) => {
        const b = 0.2
        const c = 1
        const full = dualLoopFullMuRange(r, b, c)
        const simp = dualLoopSimplifiedMuRange(r, b, c)
        const numFull = stableIntervalsNumeric((mu) => analyzeDualLoop({ r, b, c, mu }).rho, 0, 3 * simp.hi, 601)
        // 反事實：觀測沒有 latency（s_k 先吃進 δ_k 再算 G_k）⇒ A_s = r, b_s = b, c_s = c·r, d_s = c·b
        const zl = { A: [[r]], b: [b], c: [c * r], d: c * b }
        const zlScan = stableIntervalsNumeric((mu) => analyzeGeneral(zl, mu).rho, 0, (2 * (1 + r)) / (b * c) + 5, 801)
        return { r, full, simp, numFull, zlHi: zlScan.length > 0 ? zlScan[0].hi : NaN }
      }),
    [],
  )
  const muRows = useMemo(() => MU_TABLE.map((mu) => ({ mu, a: analyzeDualLoop({ ...EX, mu }) })), [])
  // 頻域驗算（μ = 0.5，兩個模型都穩定的例子）：封閉式 ω_180、GM vs 數值 loopMargins
  const freq = useMemo(() => {
    const p = { ...EX, mu: 0.5 }
    const cf = dualLoopGainMargin(p)
    const num = loopMargins((w) => calLoopGainGeneral({ A: [[p.r]], b: [p.b], c: [p.c], d: 0 }, p.mu, w))
    return { mu: p.mu, cf, num, pmSimp: pmFirstOrder(cf.gEff).pmDeg }
  }, [])

  return (
    <Section kind="formula" title="§8.4 主 PLL 與 LMS 的耦合：雙迴路與時間尺度分離" level={2} id="ch08-dual-loop">
      <p>
        {rich(String.raw`到目前為止都假設 GMAC 量到的是「當下的」$K\delta_k$。實際上 DTC 的殘餘誤差是從 PD 的 reference 輸入端進入`)}
        <strong>主 PLL</strong>
        {rich(
          String.raw`，而 comparator 取的是 PD 的輸出（送進 loop filter 的同一個訊號）。把 DTC 殘差換算成相位，記成 $\phi_{\mathrm{dtc}}$。PD 量的是 reference 減 feedback；feedback 那條線只經過 divider，送回來的就是輸出相位 $\theta_{\mathrm{out}}$（相位都折算到同一個參考）。主迴路把 $\phi_{\mathrm{dtc}}$ 變成 $\theta_{\mathrm{out}}=T\,\phi_{\mathrm{dtc}}$（$T$ 是閉迴路轉移函數），所以 PD 的輸出是 $e_{\mathrm{PD}}=\phi_{\mathrm{dtc}}-\theta_{\mathrm{out}}=(1-T)\,\phi_{\mathrm{dtc}}=H_{\mathrm{PD}}\,\phi_{\mathrm{dtc}}$，其中 $H_{\mathrm{PD}}=1-T$ 是主 PLL 的 error transfer（兩個式子都是正號）。GMAC 看到的因此是 PLL 處理過的殘差——主迴路有自己的狀態（loop filter、VCO 相位），也就是有`,
        )}
        <strong>記憶</strong>
        {rich(String.raw`。於是有兩個迴路疊在一起：快的主 PLL、慢的 calibration。工程上常說「calibration 比 PLL 慢很多，所以可以假設 PLL 已經穩態」——這就是`)}
        <strong>時間尺度分離（quasi-static）</strong>
        。本節用最簡單的二維模型檢查這句話什麼時候會錯。
      </p>
      <p>
        {rich(
          String.raw`最簡單的模型只要兩個會記憶的量（狀態）。一個是原本就有的剩餘誤差 $\delta_k$。另一個是新的「觀測狀態」$s_k$：主 PLL 對過去誤差的記憶（抽象量，單位 fs）。描述 $s$ 只要三個數字：$r_s$ 是它每個 block 保留下來的比例（觀測 pole，$|r_s|<1$；越接近 $1$ 記得越久）、$b_s$ 是 $\delta$ 灌進 $s$ 的耦合、$c_s$ 是 GMAC 從 $s$ 讀出 $G$ 的增益。本節把 GMAC 的斜率正規化成 $K\equiv1$，所以 $\mu$ 是沒有單位的步長（等同前面的 $g$），$G$ 和 $\delta$ 同單位。`,
        )}
      </p>
      <Mermaid
        caption={String.raw`二狀態模型（方程式版）：沿著箭頭走一圈；藍色那格是有記憶的觀測狀態 $s$，重點是 GMAC 讀的是 $s$，而不是誤差 $\delta$ 本身`}
        chart={DUAL_LOOP_CHART}
      />
      <p className="small">
        {rich(
          String.raw`讀圖：先看藍色的「觀測動態」那一格——$\delta_k$ 進去更新的是下一個 block 的 $s_{k+1}$。再看「GMAC」那一格——它用的是現在的 $s_k$，而 $s_k$ 是由 $\delta_{k-1},\delta_{k-2},\dots$ 累積成的，裡面沒有 $\delta_k$。最後「暫存器」用 $G_k$ 修正 $\delta$（$\delta=a-w$ 的極性，所以是減號），算出來的 $\delta_{k+1}$ 到下一個 block 就成了圖最左邊的 $\delta_k$。圖上三格裡的式子就是下面 F-08.10 的矩陣：第一格是矩陣的第一列，後兩格代在一起（$\delta_{k+1}=\delta_k-\mu c_ss_k$）是第二列。`,
        )}
      </p>
      <p>
        {rich(
          String.raw`工程上常用的簡化是：既然 $\delta$ 變得很慢，就當 $s$ 每一刻都已經追到穩態值 $s=\frac{b_s}{1-r_s}\,\delta$，於是 GMAC 看到的只是 $\delta$ 乘上一個常數 $F(1)=\frac{b_sc_s}{1-r_s}$。這裡 $F(z)$ 是從 $\delta$ 到 $G$ 的「觀測轉移函數」，$F(1)$ 是它的 DC 增益。把兩個模型畫成訊號流並排，差別一眼就看得出來：`,
        )}
      </p>
      <Mermaid
        caption="完整模型與 quasi-static 近似的訊號流對照：藍色那一圈（有記憶的觀測狀態）在近似裡被換成紅色的常數增益；兩邊的暫存器完全相同"
        chart={DUAL_SIGNAL_FLOW_CHART}
      />
      <p className="small">
        {rich(
          String.raw`讀圖：先看標題是「完整二狀態模型」的那一框裡藍色的一圈——$b_s\delta_k$ 和 $r_ss_k$ 在 $\Sigma$ 相加得到 $s_{k+1}$，要過一個 $z^{-1}$ 才變成 GMAC 讀得到的 $s_k$；這個 $z^{-1}$ 就是「$\delta_k$ 要到下一個 block 才被看到」的那一個 block latency。再看標題是「Quasi-static 近似」的那一框——整個藍色的圈被換成紅色的 $\times F(1)$，記憶和延遲都不見了。對照下面的 F-08.10：兩個 $z^{-1}$ 的輸出就是狀態向量的 $s_k$ 與 $\delta_k$；$\times r_s$、$\times b_s$ 是矩陣的第一列；「$\times c_s\to\times\mu\to\Sigma$ 的負端」是第二列的 $-\mu c_s$；$\delta_k$ 直接回到 $\Sigma$ 正端的那條線是右下角的 $1$。`,
        )}
      </p>
      <p className="small">
        <ErratumNote id="E31">
          {rich(String.raw`規格的 $r,b,c$ 與一般化的 $\mathbf A,\mathbf B,\mathbf C,D$ 在本站改名為 $r_s,b_s,c_s$ 與 $\mathbf A_s,\mathbf b_s,\mathbf c_s^{\mathsf T},d_s$`)}
        </ErratumNote>
        {rich(String.raw`：粗體 $\mathbf C$ 在 §0 是相關矩陣 $E[\mathbf x\mathbf u^{\mathsf T}]$、$D$ 在 §7 是 code delay。`)}<Tex>{'s'}</Tex> 是抽象觀測狀態，<strong>不是</strong>特定的 VCO 控制電壓；<Tex>{'\\mu'}</Tex> 是 <Tex>{'K\\equiv1'}</Tex> 的正規化步長（E13）。
      </p>

      <Prereq title={String.raw`矩陣、特徵值與特徵多項式（$2\times2$ 就夠用）`}>
        <StepDerivation
          steps={[
            { tex: String.raw`\mathbf x_{k+1}=\mathbf A\mathbf x_k`, why: rich(String.raw`把好幾個一起演化的變數排成向量；$\mathbf A$ 描述「下一步怎麼由這一步算出」。`) },
            { tex: String.raw`\mathbf x_k=\lambda^k\mathbf v\;\Rightarrow\;\lambda^{k+1}\mathbf v=\lambda^k\mathbf A\mathbf v\;\Rightarrow\;\mathbf A\mathbf v=\lambda\mathbf v`, why: rich(String.raw`猜一個「每步只乘一個常數 $\lambda$」的解；$\lambda$ 叫 eigenvalue，$\mathbf v$ 叫 eigenvector。`) },
            { tex: String.raw`(\lambda\mathbf I-\mathbf A)\mathbf v=\mathbf 0,\ \mathbf v\ne\mathbf 0\iff\det(\lambda\mathbf I-\mathbf A)=0`, why: rich(String.raw`齊次線性方程有非零解 $\iff$ 係數矩陣的行列式為 $0$。`) },
            { tex: String.raw`\det\begin{bmatrix}\lambda-a_{11}&-a_{12}\\-a_{21}&\lambda-a_{22}\end{bmatrix}=\lambda^2-(a_{11}+a_{22})\lambda+(a_{11}a_{22}-a_{12}a_{21})`, why: rich(String.raw`$2\times2$ 行列式＝對角乘積 − 反對角乘積；$\lambda$ 的係數是 $-\mathrm{tr}(\mathbf A)$，常數項是 $\det\mathbf A$。`) },
            { tex: String.raw`\rho(\mathbf A)=\max_i|\lambda_i|<1\iff\mathbf x_k\to\mathbf 0`, why: rich(String.raw`任何初值都可以寫成 eigenvector 的組合，每個分量乘上 $\lambda_i^k$；最大的 $|\lambda_i|$（spectral radius）決定成敗。（不可對角化時改用 Jordan form，多出 $k\lambda^k$ 這類項，結論不變。）`) },
          ]}
        />
      </Prereq>

      <Expand title="一步一步：狀態方程與特徵式">
        <StepDerivation
          steps={[
            { tex: String.raw`s_{k+1}=r_s\,s_k+b_s\,\delta_k`, why: rich(String.raw`觀測狀態：每個 block 保留 $r_s$ 倍的舊值，再加上 $b_s$ 倍的目前誤差（主 PLL 的一階近似）。`) },
            { tex: String.raw`G_k=c_s\,s_k`, why: rich(String.raw`GMAC 只看得到觀測狀態 $s_k$——它由 $\delta_{k-1},\delta_{k-2},\dots$ 累積而成，不含 $\delta_k$。`) },
            { tex: String.raw`\delta_{k+1}=\delta_k-\mu\,c_s\,s_k`, why: rich(String.raw`校正更新（$\delta=a-w$ 的極性）。`) },
            { tex: String.raw`\begin{bmatrix}s_{k+1}\\ \delta_{k+1}\end{bmatrix}=\begin{bmatrix}r_s&b_s\\ -\mu c_s&1\end{bmatrix}\begin{bmatrix}s_k\\ \delta_k\end{bmatrix}`, why: rich(String.raw`把兩條式子排成矩陣：第一列是 $s$ 的式子，第二列是 $\delta$ 的式子。`) },
            { tex: String.raw`\det(z\mathbf I-\mathbf A)=(z-r_s)(z-1)-(b_s)(-\mu c_s)`, why: rich(String.raw`$2\times2$ 行列式。`) },
            { tex: String.raw`P(z)=z^2-(1+r_s)z+(r_s+\mu b_sc_s)`, why: rich(String.raw`展開。$\mu=0$ 時根是 $r_s$（主迴路自己）與 $1$（暫存器積分器）。`) },
          ]}
        />
      </Expand>
      <TexBlock id="F-08.10" label="二狀態模型（記號依 E31）">
        {formula('F-08.10').tex}
      </TexBlock>

      <div className="grid-2">
        <div>
          <h4>簡化：quasi-static（時間尺度分離）</h4>
          <Expand title="quasi-static 的一步一步推導">
            <StepDerivation
              steps={[
                { tex: String.raw`s=r_s s+b_s\delta\;\Rightarrow\;s=\frac{b_s}{1-r_s}\,\delta`, why: rich(String.raw`假設 $\delta$ 變得很慢，$s$ 每一刻都已經到穩態（固定點）。`) },
                { tex: String.raw`G=c_s s=\frac{b_sc_s}{1-r_s}\,\delta=F(1)\,\delta`, why: rich(String.raw`GMAC 的等效斜率 $K_{\mathrm{eff}}=\frac{b_sc_s}{1-r_s}$，就是觀測路徑的 DC 增益。`) },
                { tex: String.raw`\delta_{k+1}=\Big(1-\frac{\mu b_sc_s}{1-r_s}\Big)\delta_k`, why: rich(String.raw`回到 §8.2 的一階模型，$g_{\mathrm{eff}}=\mu F(1)$。`) },
                { tex: String.raw`0<\mu b_sc_s<2(1-r_s)`, why: rich(String.raw`一階條件 $0<g_{\mathrm{eff}}<2$。`) },
              ]}
            />
          </Expand>
          <p className="small">
            例子 <Tex>{'r_s=0.8,b_s=0.2,c_s=1'}</Tex>：<Tex>{'F(1)=1'}</Tex>，簡化模型認為 <Tex>{String.raw`0<\mu<${tx(ex.simplifiedRange.hi, 0)}`}</Tex>。 <ClaimTag kind="approx" />
          </p>
        </div>
        <div>
          <h4>完整：Jury 判據</h4>
          <Expand title="Jury 判據的一步一步推導">
            <StepDerivation
              steps={[
                { tex: String.raw`a_1=-(1+r_s),\;a_0=r_s+\mu b_sc_s`, why: rich(String.raw`對照 $z^2+a_1z+a_0$。`) },
                { tex: String.raw`P(1)=1-(1+r_s)+r_s+\mu b_sc_s=\mu b_sc_s>0`, why: rich(String.raw`條件一：$\mu$ 與 $b_sc_s$ 同號（極性正確）。`) },
                { tex: String.raw`P(-1)=2(1+r_s)+\mu b_sc_s>0`, why: rich(String.raw`條件二：$|r_s|<1$ 時自動成立。`) },
                { tex: String.raw`|r_s+\mu b_sc_s|<1\;\Rightarrow\;\mu b_sc_s<1-r_s`, why: '條件三：真正的上界。' },
              ]}
              result={String.raw`0<\mu b_sc_s<1-r_s`}
            />
          </Expand>
          <p className="small">
            同一個例子：<Tex>{String.raw`0<\mu<${tx(ex.fullRange.hi, 0)}`}</Tex>——<strong>只有簡化模型的一半</strong>。 <ClaimTag kind="exact" />
          </p>
        </div>
      </div>
      <TexBlock id="F-08.11" label="完整 vs quasi-static（E19）">
        {formula('F-08.11').tex}
      </TexBlock>

      <h4>{rich(String.raw`先算一次：$\mu=1.2$（規格 Gallery #5、T09）`)}</h4>
      <StepDerivation
        steps={[
          { tex: String.raw`P(z)=z^2-1.8z+(0.8+0.2\cdot1.2)=z^2-1.8z+1.04`, why: rich(String.raw`代入 $r_s=0.8$、$b_sc_s=0.2$、$\mu=1.2$。`) },
          { tex: String.raw`\Delta=1.8^2-4\cdot1.04=3.24-4.16=${tx(disc, 2)}`, why: rich(String.raw`判別式 $<0$：共軛複數根（也等於 $(1-r_s)^2-4\mu b_sc_s$）。`) },
          { tex: String.raw`z=\frac{1.8\pm j\sqrt{0.92}}{2}=${ctx(top, 4)},\ ${ctx({ re: top.re, im: -top.im }, 4)}`, why: '二次公式。' },
          { tex: String.raw`|z|=\sqrt{0.9^2+${fx(top.im, 4)}^2}=\sqrt{1.04}=${tx(ex.rho, 5)}>1`, why: rich(String.raw`共軛根的模數平方＝常數項 $a_0=1.04$（Vieta）：直接看出發散。`) },
          { tex: String.raw`\text{簡化模型：}\;1-\frac{1.2\cdot0.2}{0.2}=${tx(ex.simplifiedPole, 1)},\;|{-0.2}|<1`, why: 'quasi-static 預測「快速、交替收斂」——方向完全相反的結論。' },
        ]}
        result={String.raw`|z|=\sqrt{1.04}\approx1.0198>1\;\Rightarrow\;\text{完整模型發散}`}
      />
      <p>
        時域（由 simulateFullModel 計算，<Tex>{'s_0=0,\\ \\delta_0=1'}</Tex>）：因為 <Tex>{'|z|'}</Tex> 只比 1 大 2%，又是複數 pole（振盪週期{' '}
        <Tex>{String.raw`2\pi/\arg z=${tx(periodBlocks, 1)}`}</Tex> blocks），發散非常慢，而且 <Tex>{'|\\delta_k|'}</Tex> 每半個週期就掉到接近 0 一次。{rich(String.raw`下表的 $N_{\mathrm{blk}}$ 是「觀察到第幾個 block 為止」（不用 $K$ 這個字母，因為 $K$ 已經是 GMAC 斜率）：`)}
      </p>
      <div className="table-wrap">
        <table className="ch08-table">
          <thead>
            <tr>
              <th className="num">{rich(String.raw`看到第 $N_{\mathrm{blk}}$ 個 block`)}</th>
              <th className="num">{rich(String.raw`最後一點 $|\delta_{N_{\mathrm{blk}}}|$`)}</th>
              <th className="num">{rich(String.raw`最後 ${P} 個 block 的峰值`)}</th>
              <th className="num">{rich(String.raw`參考線 $\rho^{N_{\mathrm{blk}}}$`)}</th>
            </tr>
          </thead>
          <tbody>
            {windows.map((w) => (
              <tr key={w.K}>
                <td className="num mono">{w.K}</td>
                <td className="num mono">{fx(w.last, 3)}</td>
                <td className="num mono">{fx(w.lastPeriodPeak, 3)}</td>
                <td className="num mono">{fx(w.env, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        {rich(
          String.raw`兩種常見的誤判：(1) 只跑幾十個 block——前 $30$ 個 block 的峰值只從 $1$ 長到 $${fx(first30Peak, 2)}$，看起來像「還在收斂中的振盪」；(2) 只看最後一點——$|\delta_{100}|=${fx(windows[1].last, 3)}$ 剛好落在零交越附近，但同一個週期內的峰值已經是 $${fx(windows[1].lastPeriodPeak, 2)}$。`,
        )}
        <strong>正確做法：跑 <Tex>{'\\ge300'}</Tex> blocks，看每個週期的峰值，或疊上 <Tex>{'\\rho^k'}</Tex> 參考線比斜率。</strong> <TestBadge id="T09" />
      </p>
      <ModeGate min="engineer">
        <p className="small">
          {rich(
            String.raw`$\rho^k$ 在這裡是參考線，不是 $|\delta_k|$ 的包絡：$\rho$ 只決定漸近速率（log 軸上的斜率）。本例是複數 pole，前 $300$ 個 block 的 $|\delta_k|$ 最多比 $\rho^k$ 高 $${fx((rhoRef.maxRatio - 1) * 100, 1)}\%$；但 $\mu=${rhoRef.muDouble}$ 剛好是重根 $z=${fx(rhoRef.zDouble, 1)}$，$\delta_k=(1+k/9)\,0.9^k$，到 $k=300$ 已經是 $\rho^k$ 的 $${fx(rhoRef.doubleRatio, 0)}$ 倍。所以拿它比斜率（收斂還是發散、多快），不要拿它當誤差的上界。`,
          )}{' '}
          <ClaimTag kind="exact" />
        </p>
      </ModeGate>

      <HandCalcSlot id="HC-08.7">
        {rich(String.raw`把 $r_s$、$b_s$、$c_s$、$\mu$ 換成你自己的數字（先試 $\mu=0.5$ 和 $\mu=1$），用二次公式解出完整模型的 poles，再和 quasi-static 的預測比一比。`)}
      </HandCalcSlot>

      <h4>差的那 2 倍從哪裡來？把觀測路徑拆開看</h4>
      <p>
        {rich(
          String.raw`完整模型的觀測轉移函數可以拆成兩段：$F(z)=\frac{b_sc_s}{z-r_s}=z^{-1}\cdot\frac{b_sc_s}{1-r_sz^{-1}}$——一個 block 的純延遲（latency），乘上一個沒有延遲的低通。把「只留 DC 增益」「只有低通」「延遲加低通」三種觀測並排，就知道是哪一段在作怪。圖上的 $g_{\mathrm{eff}}=\mu F(1)=\frac{\mu b_sc_s}{1-r_s}$ 是等效 loop gain：把雙迴路當成 §8.2 的一階迴路時的 $g$。`,
        )}
      </p>
      <Mermaid
        caption={String.raw`三種觀測模型並排：同一個 $\delta$ 進去，各自的 $G$ 接上同一個暫存器，看 (a)(b)(c) 的穩定上界；紅色是多出來的那一個 block latency 與它造成的上界`}
        chart={LATENCY_SPLIT_CHART}
      />
      <p className="small">
        {rich(
          String.raw`讀圖：每一列左邊是觀測路徑（從 $\delta$ 到 $G$），最右邊那格是把 $G$ 接上同一個暫存器 $\delta_{k+1}=\delta_k-\mu G_k$ 之後算出來的穩定上界。先比 (a) 和 (b)——把常數增益換成真正的低通，上界由 $2(1-r_s)$ 變成 $2(1+r_s)$，在 $r_s\ge0$ 時反而更寬：只有低通的話，quasi-static 是保守的。再比 (b) 和 (c)——多串一個紅色的 $z^{-1}$，上界掉到 $1-r_s$，剛好是 (a) 的一半。所以讓 quasi-static 高估的不是低通的 pole $r_s$，而是那一個 block 的 latency。圖上三個上界依序就是 F-08.11 的 quasi-static 條件、下面「反事實驗證」推出的 $0<\mu b_sc_s<2(1+r_s)$，以及 F-08.11 的完整模型條件。`,
        )}
      </p>

      <Callout kind="warn" title="差 2 倍的原因不是「主 PLL 不夠快」">
        <p>
          <ErratumNote id="E19" /> 規格把這一節放在「時間尺度分離」的標題下，容易讓人以為「把主 PLL 調快（<Tex>{'r_s\\to0'}</Tex>）就能回到 <Tex>{'0<\\mu<2'}</Tex>」。不會：
        </p>
        <ol>
          <li>
            完整上界 <Tex>{'(1-r_s)/(b_sc_s)'}</Tex> 對<strong>每一個</strong> <Tex>{'r_s'}</Tex> 都恰好是簡化上界 <Tex>{'2(1-r_s)/(b_sc_s)'}</Tex> 的一半（下表，數值掃描驗證）。
          </li>
          <li>
            <Tex>{'r_s=0'}</Tex>（主迴路瞬間穩態、沒有記憶）時，模型變成 <Tex>{'\\delta_{k+1}=\\delta_k-\\mu b_sc_s\\,\\delta_{k-1}'}</Tex>——正好是 §8.3 的 <Tex>{'d=1'}</Tex>，界限{' '}
            <Tex>{'g<1'}</Tex>。
          </li>
          <li>
            所以差異來自<strong>觀測路徑的動態結構</strong>本身：<Tex>{'G_k'}</Tex> 用的是 <Tex>{'s_k'}</Tex>，而 <Tex>{'s_k'}</Tex> 只含 <Tex>{'\\delta_{k-1}'}</Tex> 以前的資訊——模型裡內建了一個
            block 的 sample→observe latency。它不是 GMAC pipeline 的更新延遲（本模型 <Tex>{'d=0'}</Tex>），也不只是「時間尺度分離不足」：分離不足影響的是 pole
            位置與收斂速度（下面的複數 pole 門檻，<ClaimTag kind="approx" />），而<strong>上界減半</strong>來自這一個 block 的 latency。<ClaimTag kind="exact" />
          </li>
        </ol>
        <p className="small">
          換成等效 loop gain <Tex>{'g_{\\mathrm{eff}}=\\mu F(1)=\\mu b_sc_s/(1-r_s)'}</Tex> 來說更簡單：quasi-static 要求 <Tex>{'g_{\\mathrm{eff}}<2'}</Tex>（§8.2 的界限），完整模型要求{' '}
          <Tex>{'g_{\\mathrm{eff}}<1'}</Tex>（§8.3 <Tex>{'d=1'}</Tex> 的界限），對任何 <Tex>{'r_s'}</Tex> 都一樣——下面的「頻域觀點」會用 Bode 的 <Tex>{'-180^\\circ'}</Tex> 點證明。
        </p>
      </Callout>
      <div className="table-wrap">
        <table className="ch08-table">
          <caption>
            {rich(String.raw`$b_s=0.2$、$c_s=1$，不同 $r_s$：完整上界（封閉式／數值掃描）、quasi-static 上界、比值，以及「觀測沒有 latency」的反事實模型`)}
          </caption>
          <thead>
            <tr>
              <th className="num">{rich(String.raw`$r_s$`)}</th>
              <th className="num">{rich(String.raw`完整 $\frac{1-r_s}{b_sc_s}$`)}</th>
              <th className="num">完整（數值掃描）</th>
              <th className="num">{rich(String.raw`quasi-static $\frac{2(1-r_s)}{b_sc_s}$`)}</th>
              <th className="num">比值</th>
              <th className="num">無 latency 版本（數值掃描）</th>
              <th className="num">{rich(String.raw`$\frac{2(1+r_s)}{b_sc_s}$`)}</th>
            </tr>
          </thead>
          <tbody>
            {rTable.map((row) => (
              <tr key={row.r}>
                <td className="num mono">{row.r}</td>
                <td className="num mono">{fx(row.full.hi, 4)}</td>
                <td className="num mono">{fx(row.numFull[0]?.hi ?? NaN, 4)}</td>
                <td className="num mono">{fx(row.simp.hi, 4)}</td>
                <td className="num mono">{fx(row.full.hi / row.simp.hi, 4)}</td>
                <td className="num mono">{fx(row.zlHi, 3)}</td>
                <td className="num mono">{fx((2 * (1 + row.r)) / 0.2, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ModeGate min="engineer">
        <Expand title="反事實驗證：如果觀測沒有那一個 block 的 latency 會怎樣？" badge="工程">
          <p>
            把觀測改成「先吃進 <Tex>{'\\delta_k'}</Tex> 再算 <Tex>{'G_k'}</Tex>」：<Tex>{'s_k=r_ss_{k-1}+b_s\\delta_k,\\;G_k=c_ss_k'}</Tex>。寫成一般化 state-space（狀態取{' '}
            <Tex>{'s_{k-1}'}</Tex>）就是 <Tex>{'A_s=r_s,\\ b_s,\\ c_s\\to c_sr_s,\\ d_s=c_sb_s'}</Tex>，<Tex>{'F(z)=\\frac{b_sc_s\\,z}{z-r_s}'}</Tex>（相對次數 0，沒有一步延遲）。
          </p>
          <StepDerivation
            steps={[
              { tex: String.raw`P(z)=(z-1)(z-r_s)+\mu b_sc_s\,z=z^2-(1+r_s-\mu b_sc_s)z+r_s`, why: rich(String.raw`閉迴路 $(z-1)+\mu F(z)=0$，乘上 $(z-r_s)$。`) },
              { tex: String.raw`P(1)=\mu b_sc_s>0,\quad P(-1)=2(1+r_s)-\mu b_sc_s>0,\quad |r_s|<1`, why: rich(String.raw`Jury 三條件；常數項 $r_s$ 與 $\mu$ 無關。`) },
              { tex: String.raw`0<\mu b_sc_s<2(1+r_s)`, why: rich(String.raw`上界由 $P(-1)$ 決定（實根穿過 $-1$，而不是複數對穿過單位圓）。`) },
            ]}
          />
          <p className="small">
            <Tex>{'r_s=0'}</Tex> 時與 quasi-static 完全一樣（<Tex>{'\\mu b_sc_s<2'}</Tex>）；<Tex>{'r_s>0'}</Tex> 時反而比 quasi-static <strong>更</strong>寬
            {rich(String.raw`（例子：$\mu<${sig((2 * (1 + EX.r)) / (EX.b * EX.c), 4)}$ vs $\mu<${sig(ex.simplifiedRange.hi, 4)}$）`)}——因為{' '}
            <Tex>{'F(-1)=b_sc_s/(1+r_s)'}</Tex> 比 <Tex>{'F(1)=b_sc_s/(1-r_s)'}</Tex> 小，高頻增益被觀測的低通衰減。上表最後兩欄是數值掃描與封閉式的比對。
          </p>
          <p className="small">
            把這兩個模型並排看，歸因就清楚了。完整模型的觀測可以拆成「一個 block 的延遲 <Tex>{'\\times'}</Tex> 沒有 latency 的低通」：
          </p>
          <TexBlock>{String.raw`F(z)=\frac{b_sc_s}{z-r_s}=\underbrace{z^{-1}}_{\text{一個 block 的 latency}}\cdot\underbrace{\frac{b_sc_s}{1-r_sz^{-1}}}_{\text{低通（反事實模型的 }F\text{）}}`}</TexBlock>
          <ul className="small">
            <li>
              只有低通（沒有 <Tex>{'z^{-1}'}</Tex>）：上界 <Tex>{'2(1+r_s)\\ge'}</Tex> quasi-static 的 <Tex>{'2(1-r_s)'}</Tex>（<Tex>{'r_s\\ge0'}</Tex>）——quasi-static 是<strong>保守</strong>的（安全）。
            </li>
            <li>
              再乘上那一個 <Tex>{'z^{-1}'}</Tex>：上界掉到 <Tex>{'1-r_s'}</Tex>——quasi-static 由保守變成<strong>樂觀 2 倍</strong>（危險）。
            </li>
          </ul>
          <p className="small">
            所以 quasi-static 的錯誤可以往<strong>兩個方向</strong>偏；讓它在本模型「高估穩定範圍」的，是 sample→observe 的那一個 block latency，而不是低通的 pole <Tex>{'r_s'}</Tex> 本身（
            <ErratumNote id="E19" />）。<ClaimTag kind="exact" />
          </p>
        </Expand>
      </ModeGate>

      <Expand title={rich(String.raw`頻域觀點：為什麼「恰好一半」而且與 $r_s$ 無關（用 Bode 的 $-180^\circ$ 點證明）`)}>
        <StepDerivation
          steps={[
            { tex: String.raw`F(z)=\frac{b_sc_s}{z-r_s}\;\Rightarrow\;L_{\mathrm{cal}}(z)=\frac{\mu b_sc_s}{(z-1)(z-r_s)}`, why: rich(String.raw`二狀態模型的觀測轉移函數（下面「一般化」的 $n=1$ 情形）。比 §8.2 多了一個 pole $r_s$。`) },
            { tex: String.raw`\angle L(e^{j\omega})=-\Big(90^\circ+\frac{\omega}{2}\Big)-\angle\big(e^{j\omega}-r_s\big)`, why: rich(String.raw`積分器的相位（§8.2）再扣掉向量 $e^{j\omega}-r_s$ 的角度。quasi-static 把第二項當成 $0^\circ$。`) },
            { tex: String.raw`\angle L=-180^\circ\iff\angle\big(e^{j\omega}-r_s\big)=90^\circ-\frac{\omega}{2}`, why: 'Phase crossover 的條件：移項。' },
            { tex: String.raw`\frac{\sin\omega}{\cos\omega-r_s}=\cot\frac{\omega}{2}=\frac{1+\cos\omega}{\sin\omega}`, why: rich(String.raw`兩邊取 $\tan$：左邊是向量 $(\cos\omega-r_s,\ \sin\omega)$ 的斜率；右邊用 $\tan(90^\circ-x)=\cot x$ 與半角公式 $\cot\frac{\omega}{2}=\frac{1+\cos\omega}{\sin\omega}$。`) },
            { tex: String.raw`\sin^2\omega=(1+\cos\omega)(\cos\omega-r_s)\;\Rightarrow\;1-\cos\omega=\cos\omega-r_s`, why: rich(String.raw`交叉相乘；$\sin^2\omega=(1-\cos\omega)(1+\cos\omega)$，兩邊約掉 $(1+\cos\omega)$（$0<\omega<\pi$ 時不為零）。`) },
            { tex: String.raw`\cos\omega_{180}=\frac{1+r_s}{2}`, why: rich(String.raw`臨界頻率那一點的實部，正好在兩個開迴路 pole（$r_s$ 與 $1$）的正中間：它到兩個 pole 的距離相等（等腰三角形）。`) },
            { tex: String.raw`\big|e^{j\omega_{180}}-1\big|^2=2-2\cos\omega_{180}=1-r_s,\qquad \big|e^{j\omega_{180}}-r_s\big|^2=1-2r_s\cos\omega_{180}+r_s^2=1-r_s`, why: rich(String.raw`$|e^{j\omega}-x|^2=1-2x\cos\omega+x^2$（餘弦定理），代入 $\cos\omega_{180}$。兩段距離都是 $\sqrt{1-r_s}$。`) },
            { tex: String.raw`\big|L(e^{j\omega_{180}})\big|=\frac{\mu b_sc_s}{\sqrt{1-r_s}\,\sqrt{1-r_s}}=\frac{\mu b_sc_s}{1-r_s}=\mu F(1)\triangleq g_{\mathrm{eff}}`, why: rich(String.raw`完整模型在 $-180^\circ$ 那一點的增益，剛好等於 quasi-static 的等效 loop gain $g_{\mathrm{eff}}$。`) },
            { tex: String.raw`GM_{\text{完整}}=\frac{1}{g_{\mathrm{eff}}}\qquad\text{vs.}\qquad GM_{\text{quasi-static}}=\frac{2}{g_{\mathrm{eff}}}`, why: rich(String.raw`quasi-static 就是 §8.2 的 $g_{\mathrm{eff}}/(z-1)$，$GM=2/g$。兩者永遠差 $2$ 倍（$6.02$ dB）；$r_s$ 完全消掉了。`) },
          ]}
          result={String.raw`\underbrace{0<g_{\mathrm{eff}}<1}_{\text{完整模型}}\qquad\text{vs.}\qquad\underbrace{0<g_{\mathrm{eff}}<2}_{\text{quasi-static}},\qquad g_{\mathrm{eff}}=\mu F(1)=\frac{\mu b_sc_s}{1-r_s}`}
        />
        <p className="small">
          用 <Tex>{'g_{\\mathrm{eff}}'}</Tex> 表示之後一目了然：完整模型的界限對<strong>任何</strong> <Tex>{'r_s'}</Tex> 都是 <Tex>{'g_{\\mathrm{eff}}<1'}</Tex>，也就是 §8.3 <Tex>{'d=1'}</Tex> 的{' '}
          <Tex>{'g^*(1)=1'}</Tex>；quasi-static 的 <Tex>{'g_{\\mathrm{eff}}<2'}</Tex> 則是 <Tex>{'d=0'}</Tex> 的界限。<Tex>{'r_s=0'}</Tex> 時 <Tex>{'\\omega_{180}=60^\\circ'}</Tex>、
          <Tex>{'\\angle F=-\\omega'}</Tex>，觀測就是純粹一個 block 的延遲。
        </p>
        <p className="small">
          {rich(
            String.raw`數值驗算（$r_s=${EX.r}$、$b_sc_s=${sig(EX.b * EX.c)}$、$\mu=${freq.mu}$，$g_{\mathrm{eff}}=${sig(freq.cf.gEff, 4)}$）：$\omega_{180}=\arccos(${sig((1 + EX.r) / 2, 4)})=${fx(freq.cf.omega180, 4)}$ rad/block（數值 phase crossover：$${fx(freq.num.phaseCrossovers[0]?.omega ?? NaN, 4)}$）；$GM_{\text{完整}}=${fx(freq.cf.gmFullDb, 2)}$ dB（數值 $${fx(freq.num.gmDb, 2)}$ dB），$GM_{\text{quasi-static}}=${fx(freq.cf.gmSimplifiedDb, 2)}$ dB；$PM_{\text{完整}}=${fx(freq.num.pmDeg, 1)}^\circ$（數值），quasi-static 卻以為有 $${fx(freq.pmSimp, 1)}^\circ$。那一點觀測路徑的相位是 $\angle F(e^{j\omega_{180}})=-(90^\circ-\omega_{180}/2)=${fx(freq.cf.obsPhaseAt180Deg, 1)}^\circ$，quasi-static 當它是 $0^\circ$。`,
          )}{' '}
          <ClaimTag kind="exact" />
        </p>
        <ModeGate min="engineer">
          <p className="small">
            {rich(
              String.raw`順帶一提，觀測路徑在低頻的群延遲是 $-\frac{d\angle F}{d\omega}\big|_{\omega\to0}=\frac{1}{1-r_s}$ blocks（由 $\angle F=-\operatorname{atan2}(\sin\omega,\cos\omega-r_s)\approx-\frac{\omega}{1-r_s}$），可以拆成 $1$（latency）$+\frac{r_s}{1-r_s}$（低通）。本例是 $${sig(1 / (1 - EX.r), 3)}$ 個 block：calibration 看到的資訊平均「舊」了這麼久，這就是 $\mu>${sig(ex.muComplex, 3)}$ 之後完整模型收斂遠比 quasi-static 慢的原因。`,
            )}{' '}
            <ClaimTag kind="approx" />
          </p>
        </ModeGate>
      </Expand>
      <p className="small">
        {rich(
          String.raw`下式的 $\omega_{180}$ 是 phase crossover：開迴路相位剛好到 $-180^\circ$ 的那個頻率（rad/block）。在那一點看增益離 $1$ 還有幾倍，就是 gain margin。`,
        )}
      </p>
      <TexBlock id="F-08.16" label="完整二狀態模型的 phase crossover 與 GM（E19 的頻域版本）">
        {formula('F-08.16').tex}
      </TexBlock>

      <h4>{rich(String.raw`$\mu$ 由小到大：quasi-static 是怎麼一步一步錯掉的`)}</h4>
      <p>
        {rich(
          String.raw`「上界差 $2$ 倍」只是最後的結果。把 $\mu$ 從 $0$ 慢慢加大，完整模型的兩個 pole 會依序經過四個區間，quasi-static 在每個區間錯的方式都不一樣。門檻都用 $\mu b_sc_s$ 表示；圖上的「本例」是上面 Gallery #5 的 $r_s=${EX.r}$、$b_sc_s=${sig(EX.b * EX.c)}$。`,
        )}
      </p>
      <Mermaid
        caption={String.raw`$\mu$ 由小到大的四個區間：每一格上面一行是完整模型的 poles，下面是 quasi-static 的說法；綠色＝兩者一致，藍色＝都穩定但速度估錯，紅色＝完整模型已經發散`}
        chart={DUAL_REGIMES_CHART}
      />
      <p className="small">
        {rich(
          String.raw`讀圖（由上往下就是 $\mu$ 變大）：先看綠色那格——$\mu b_sc_s$ 還小於 $\frac{(1-r_s)^2}{4}$ 時，完整模型是兩個實根，慢的那個接近 quasi-static 的 $1-g_{\mathrm{eff}}$，近似可信。再看藍色那格——過了這個門檻（本例 $\mu=${sig(ex.muComplex, 3)}$），兩個根變成共軛複數，模數 $|z|=\sqrt{r_s+\mu b_sc_s}$ 隨 $\mu$ 變大，也就是收斂越來越慢；quasi-static 的 pole $1-g_{\mathrm{eff}}$ 卻繼續往 $0$ 靠近，以為越來越快。這時還沒有不穩定，但速度已經估錯了。最後看兩個紅色的格子——$\mu b_sc_s$ 超過 $1-r_s$（本例 $\mu=${sig(ex.fullRange.hi, 3)}$）時 $|z|>1$，完整模型振盪發散，quasi-static 的 pole 卻還在 $-1$ 與 $0$ 之間（上面「先算一次」的 $\mu=1.2$ 就落在這一格）；要到 $2(1-r_s)$（本例 $\mu=${sig(ex.simplifiedRange.hi, 3)}$）以上，兩個模型才都說不穩定。圖上第一個門檻與模數就是下面的 F-08.12，後兩個門檻是 F-08.11 的兩個上界。`,
        )}
      </p>

      <Expand title="時間尺度分離何時可信：複數 pole 門檻">
        <StepDerivation
          steps={[
            { tex: String.raw`\Delta=(1+r_s)^2-4(r_s+\mu b_sc_s)=(1-r_s)^2-4\mu b_sc_s`, why: '判別式化簡。' },
            { tex: String.raw`\mu b_sc_s<\frac{(1-r_s)^2}{4}:\ \text{兩個實根（一快一慢）}`, why: rich(String.raw`$\Delta>0$。慢根才可能近似成 $1-\mu F(1)$。`) },
            { tex: String.raw`\mu b_sc_s>\frac{(1-r_s)^2}{4}:\ z=\frac{1+r_s}{2}\pm j\sqrt{-\Delta}/2,\ |z|=\sqrt{r_s+\mu b_sc_s}`, why: rich(String.raw`$\Delta<0$：共軛對，模數平方＝常數項。$\mu$ 再大，$|z|$ 只會變大——「增加 $\mu$ 讓它更快」失效。`) },
            { tex: String.raw`|z|\ge\frac{1+r_s}{2}`, why: rich(String.raw`複數區的 $|z|$ 下限（本例 $0.9$）：完整模型的收斂速度有天花板，簡化模型完全看不到。`) },
          ]}
        />
      </Expand>
      <TexBlock id="F-08.12" label="複數 pole 門檻與模數">
        {formula('F-08.12').tex}
      </TexBlock>
      <div className="table-wrap">
        <table className="ch08-table">
          <caption>
            {rich(
              String.raw`$r_s=0.8$、$b_s=0.2$、$c_s=1$（門檻 $\mu=${sig(ex.muComplex, 3)}$）：簡化 pole vs 完整 poles（即時計算）。$\tau=-1/\ln\rho$（簡化模型的 $\rho$ 是 $|1-g_{\mathrm{eff}}|$）是 $\rho^k$ 降到 $1/e$ 所需的 block 數：由漸近衰減率換算的時間常數，不是逐 block 數出來的收斂時間`,
            )}
          </caption>
          <thead>
            <tr>
              <th className="num">{rich(String.raw`$\mu$`)}</th>
              <th className="num">{rich(String.raw`quasi-static pole $1-\frac{\mu b_sc_s}{1-r_s}$`)}</th>
              <th className="num">完整 poles</th>
              <th className="num">{rich(String.raw`完整 $\rho$`)}</th>
              <th className="num">{rich(String.raw`$\tau$ 簡化 [blocks]`)}</th>
              <th className="num">{rich(String.raw`$\tau$ 完整 [blocks]`)}</th>
              <th>結論</th>
            </tr>
          </thead>
          <tbody>
            {muRows.map(({ mu, a }) => {
              const tauS = Math.abs(a.simplifiedPole) < 1e-12 ? 0 : Math.abs(a.simplifiedPole) < 1 ? -1 / Math.log(Math.abs(a.simplifiedPole)) : NaN
              const tauF = a.rho < 1 ? -1 / Math.log(a.rho) : NaN
              return (
                <tr key={mu}>
                  <td className="num mono">{mu}</td>
                  <td className="num mono">{fx(a.simplifiedPole, 4)}</td>
                  <td className="num mono">{a.poles.map((z) => ctx(z, 4)).join('、')}</td>
                  <td className="num mono">{fx(a.rho, 4)}</td>
                  <td className="num mono">{fx(tauS, 2)}</td>
                  <td className="num mono">{fx(tauF, 2)}</td>
                  <td>{a.marginal ? '臨界' : !a.stable ? (a.simplifiedStable ? '簡化說穩定、實際發散' : '都不穩定') : tauF > 2 * tauS ? '都穩定，但實際慢很多' : '近似可用'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="small">
        <ClaimTag kind="approx" /> 時間尺度分離近似（慢 pole <Tex>{'\\approx1-\\mu b_sc_s/(1-r_s)'}</Tex>）只在 <Tex>{'\\mu b_sc_s\\ll(1-r_s)^2/4'}</Tex> 時成立，本例{' '}
        <Tex>{String.raw`\mu\ll${sig(ex.muComplex, 3)}`}</Tex>。
        {rich(
          String.raw`$\mu=0.5$ 時簡化 pole $${fx(mu05.simplifiedPole, 2)}$（$\tau\approx${fx(-1 / Math.log(mu05.simplifiedPole), 2)}$ blocks），完整 $\rho=${fx(mu05.rho, 4)}$（$\tau\approx${fx(-1 / Math.log(mu05.rho), 1)}$ blocks）。`,
        )}
      </p>
      <ModeGate min="engineer">
        <p className="small">
          {rich(
            String.raw`表裡的 $\tau$ 是漸近的時間常數，重根那一列（$\mu=${rhoRef.muDouble}$）最看得出差別：$\tau$ 完整 $=${fx(-1 / Math.log(dblRow.rho), 2)}$ blocks，但 $\delta_k=(1+k/9)\,0.9^k$ 要到第 $${rhoRef.doubleBelowE}$ 個 block 才降到 $1/e$ 以下，反而和簡化模型的 $${fx(-1 / Math.log(Math.abs(dblRow.simplifiedPole)), 2)}$ blocks 差不多。所以那一列的結論是「近似可用」，不是「完整模型快一倍」。`,
          )}{' '}
          <ClaimTag kind="exact" />
        </p>
      </ModeGate>
      <ModeGate min="research">
        <Expand title={rich(String.raw`Research：慢根的二階修正（為什麼門檻是 $(1-r_s)^2$）`)} badge="研究" openFrom="research">
          <StepDerivation
            steps={[
              { tex: String.raw`z=1+\varepsilon:\;(1+\varepsilon-r_s)\,\varepsilon+\mu b_sc_s=0`, why: rich(String.raw`把慢根寫成 $1$ 附近的小偏移，代入 $(z-r_s)(z-1)+\mu b_sc_s=0$。`) },
              { tex: String.raw`\varepsilon(1-r_s)+\varepsilon^2=-\mu b_sc_s`, why: '展開。' },
              { tex: String.raw`\begin{aligned}\varepsilon&=-\frac{\mu b_sc_s}{1-r_s}\\&\quad-\frac{(\mu b_sc_s)^2}{(1-r_s)^3}+O(\mu^3)\end{aligned}`, why: '逐階代入（第一階就是 quasi-static）。' },
              { tex: String.raw`\frac{\text{二階項}}{\text{一階項}}=\frac{\mu b_sc_s}{(1-r_s)^2}\ll1`, why: rich(String.raw`相對修正小才可信：$\mu b_sc_s\ll(1-r_s)^2$，與複數門檻 $(1-r_s)^2/4$ 同一個尺度。`) },
            ]}
          />
        </Expand>
      </ModeGate>

      <h4>一般化：主 PLL 不只一個狀態時怎麼檢查</h4>
      <p>
        {rich(
          String.raw`真實的主 PLL 不會只有一個狀態。把觀測狀態換成 $n$ 維向量 $\mathbf s_k$，用四個量描述觀測路徑：$\mathbf A_s$（狀態矩陣：$\mathbf s$ 自己每個 block 怎麼演化）、$\mathbf b_s$（$\delta$ 怎麼灌進 $\mathbf s$）、$\mathbf c_s^{\mathsf T}$（GMAC 怎麼從 $\mathbf s$ 讀出 $G$）、$d_s$（直通項：$\delta$ 不經過任何狀態、當下就出現在 $G$ 的部分）。二狀態模型就是 $n=1$：$\mathbf A_s=r_s$、$\mathbf b_s=b_s$、$\mathbf c_s^{\mathsf T}=c_s$、$d_s=0$。`,
        )}
      </p>
      <Mermaid
        caption={String.raw`一般化 state-space 的訊號流：「觀測動態」那一框（藍色的四個量）整個就是觀測轉移函數 $F(z)$，「暫存器」那一框是積分器；兩框串成一圈就是 calibration loop`}
        chart={STATE_SPACE_CHART}
      />
      <p className="small">
        {rich(
          String.raw`讀圖：先看「觀測動態」那一框——$\delta_k$ 分兩路進去：一路經 $\mathbf b_s$ 進入狀態（過 $z^{-1}$、被 $\mathbf A_s$ 回授、再由 $\mathbf c_s^{\mathsf T}$ 讀出），另一路經 $d_s$ 直接到輸出，兩路相加得到 $G_k$；這整框從 $\delta$ 到 $G$ 的轉移函數就是 F-08.14 的 $F(z)=d_s+\mathbf c_s^{\mathsf T}(z\mathbf I-\mathbf A_s)^{-1}\mathbf b_s$。再看「暫存器」那一框——$\delta_{k+1}=\delta_k-\mu G_k$：一個積分器 $\frac{\mu}{z-1}$，$\mu G_k$ 從 $\Sigma$ 的負端進去（負回授）。兩框繞一圈，方塊的乘積就是 F-08.14 的 $L_{\mathrm{cal}}(z)=\frac{\mu F(z)}{z-1}$。圖上四個藍色方塊加上 $\mu$，剛好填滿 F-08.13 的合併矩陣 $\mathbf A_{\mathrm{comb}}$：上列是 $\mathbf A_s$、$\mathbf b_s$，下列是 $-\mu\mathbf c_s^{\mathsf T}$、$1-\mu d_s$。`,
        )}
      </p>
      <p>
        {rich(String.raw`有了 $\mathbf A_{\mathrm{comb}}$（把觀測狀態和 $\delta$ 排在一起的閉迴路矩陣），穩定性檢查就是固定的幾個步驟——本站的`)} <code>combinedMatrix</code> 與{' '}
        <code>analyzeGeneral</code> 就是照這個順序算的：
      </p>
      <Mermaid
        caption={String.raw`穩定性檢查流程：組矩陣 → 求 eigenvalue → 取最大的絕對值 $\rho$ → 和 $1$ 比；注意 $\rho=1$ 是臨界，不算穩定`}
        chart={STABILITY_CHECK_CHART}
      />
      <p className="small">
        {rich(
          String.raw`讀圖：先由上往下看到菱形——藍色那格組出的矩陣就是 F-08.13；eigenvalue 就是閉迴路 poles（F-08.14 最後一式：它們是 $z-1+\mu F(z)=0$ 的根，再加上 $\mathbf A_s$ 裡不受 $\delta$ 影響或 GMAC 看不到的模態）；$\rho$ 是其中絕對值最大的。再看菱形的三個出口：只有 $\rho<1$ 才往下走到時域驗證；$\rho=1$ 是臨界，$\rho>1$ 是發散。`,
        )}
      </p>

      <Expand title="一般化：任意線性觀測（state-space）">
        <StepDerivation
          steps={[
            { tex: String.raw`\mathbf s_{k+1}=\mathbf A_s\mathbf s_k+\mathbf b_s\delta_k,\qquad G_k=\mathbf c_s^{\mathsf T}\mathbf s_k+d_s\delta_k,\qquad \delta_{k+1}=\delta_k-\mu G_k`, why: rich(String.raw`把二狀態推廣成 $n$ 維觀測；$d_s$ 是 $\delta$ 直接進入 $G$ 的部分（沒有延遲）。`) },
            { tex: String.raw`\delta_{k+1}=-\mu\mathbf c_s^{\mathsf T}\mathbf s_k+(1-\mu d_s)\,\delta_k`, why: rich(String.raw`把 $G_k$ 代進更新式。`) },
            { tex: String.raw`\begin{bmatrix}\mathbf s_{k+1}\\ \delta_{k+1}\end{bmatrix}=\underbrace{\begin{bmatrix}\mathbf A_s&\mathbf b_s\\ -\mu\mathbf c_s^{\mathsf T}&1-\mu d_s\end{bmatrix}}_{\mathbf A_{\mathrm{comb}}}\begin{bmatrix}\mathbf s_k\\ \delta_k\end{bmatrix}`, why: rich(String.raw`分塊矩陣：上面 $n$ 列是觀測，最下面一列是暫存器。`) },
            { tex: String.raw`(z\mathbf I-\mathbf A_s)\mathbf S(z)=\mathbf b_s\Delta(z)\;\Rightarrow\;G(z)=\big[d_s+\mathbf c_s^{\mathsf T}(z\mathbf I-\mathbf A_s)^{-1}\mathbf b_s\big]\Delta(z)=F(z)\,\Delta(z)`, why: rich(String.raw`對觀測方程做 Z transform，解出 $\mathbf S$ 再代入 $G$：$F(z)$ 是 $\delta\to G$ 的轉移函數。`) },
            { tex: String.raw`(z-1)\Delta(z)=-\mu F(z)\Delta(z)\;\Rightarrow\;L_{\mathrm{cal}}(z)=\frac{\mu F(z)}{z-1}`, why: rich(String.raw`暫存器積分器 $\frac{\mu}{z-1}$ 乘上觀測 $F(z)$。$F\equiv K$ 時回到 §8.2。`) },
            { tex: String.raw`\det(z\mathbf I-\mathbf A_{\mathrm{comb}})=\det(z\mathbf I-\mathbf A_s)\cdot\Big(z-1+\mu d_s+\mu\mathbf c_s^{\mathsf T}(z\mathbf I-\mathbf A_s)^{-1}\mathbf b_s\Big)`, why: rich(String.raw`分塊行列式的 Schur complement：$\det\begin{bmatrix}P&Q\\R&S\end{bmatrix}=\det P\cdot(S-RP^{-1}Q)$。`) },
            { tex: String.raw`=\det(z\mathbf I-\mathbf A_s)\,\big(z-1+\mu F(z)\big)`, why: rich(String.raw`所以 $\mathbf A_{\mathrm{comb}}$ 的 eigenvalue $=$ $1+L_{\mathrm{cal}}(z)=0$ 的根（加上不可控／不可觀的 $\mathbf A_s$ 模態）。`) },
          ]}
        />
      </Expand>
      <TexBlock id="F-08.13" label="合併矩陣（記號依 E31）">
        {formula('F-08.13').tex}
      </TexBlock>
      <TexBlock id="F-08.14" label="觀測轉移函數與 calibration loop gain">
        {formula('F-08.14').tex}
      </TexBlock>
      <TexBlock id="F-08.15" label={rich(String.raw`Quasi-static＝把 $F(z)$ 換成 $F(1)$`)}>
        {formula('F-08.15').tex}
      </TexBlock>
      <p className="small">
        驗算（E31 的數值證據）：二狀態例子是 <Tex>{'A_s=0.8,\\ b_s=0.2,\\ c_s=1,\\ d_s=0'}</Tex>，<Tex>{String.raw`F(1)=\frac{1\cdot0.2}{1-0.8}=${tx(ex.dcGain, 3)}`}</Tex>，和 §8.2 的{' '}
        <Tex>{'K=1'}</Tex> 一致；<Tex>{String.raw`n=1`}</Tex> 時 <Tex>{String.raw`(z-r_s)\big(z-1+\mu\frac{b_sc_s}{z-r_s}\big)=(z-r_s)(z-1)+\mu b_sc_s`}</Tex>，就是上面的 <Tex>{'P(z)'}</Tex>。
      </p>

      <h4>核心程式碼：quasi-static vs 完整模型（同一個迴圈，差一行）</h4>
      <CodeCompare
        items={[
          { label: 'Quasi-static（簡化）', source: stabilitySrc, region: 'simulateQuasiStatic', path: SRC_PATH, note: '觀測狀態每個 block 都直接設成穩態值（沒有記憶）' },
          { label: '完整二狀態模型', source: stabilitySrc, region: 'simulateFullModel', path: SRC_PATH, note: '觀測狀態有記憶；GMAC 看到的只含上一個 block 以前的誤差' },
        ]}
        caption={String.raw`兩個版本的 $G$ 與更新式完全相同，差別只在 $s$ 那一行——這一行就是 E19 所說的觀測動態（含一個 block 的 sample→observe latency）。`}
      />
      <ModeGate min="engineer">
        <CodeCompare
          layout="tabs"
          items={[
            { label: 'Jury 封閉式（完整）', source: stabilitySrc, region: 'dualLoopFullRange', path: SRC_PATH },
            { label: 'Quasi-static 區間', source: stabilitySrc, region: 'dualLoopSimplifiedRange', path: SRC_PATH },
            { label: '數值區間掃描', source: stabilitySrc, region: 'stableIntervals', path: SRC_PATH },
            { label: '頻域 GM（完整 vs 簡化）', source: stabilitySrc, region: 'dualLoopGainMargin', path: SRC_PATH },
          ]}
        />
        <div className="grid-2">
          <CodeBlock source={stabilitySrc} region="dualLoopMatrix" path={SRC_PATH} title="dualLoopMatrix：二狀態矩陣" />
          <CodeBlock source={stabilitySrc} region="dualLoopCharPoly" path={SRC_PATH} title="dualLoopCharPoly：特徵多項式係數" />
        </div>
        <div className="grid-2">
          <CodeBlock source={stabilitySrc} region="combinedMatrix" path={SRC_PATH} title="combinedMatrix：合併矩陣" />
          <CodeBlock source={stabilitySrc} region="observationTransfer" path={SRC_PATH} title="observationTransfer：觀測轉移函數與開迴路增益" />
        </div>
      </ModeGate>

      <Quiz
        title="思考題 4（雙迴路）"
        question={
          <>
            同事說：「把主 PLL 頻寬加大（<Tex>{'r_s'}</Tex> 從 0.8 降到 0），觀測就幾乎瞬間穩態，quasi-static 的 <Tex>{'0<\\mu b_sc_s<2(1-r_s)'}</Tex> 就會變準。」對嗎？
          </>
        }
        options={[
          { label: rich(String.raw`對：$r_s\to0$ 時時間尺度分離成立`) },
          { label: rich(String.raw`不對：完整界限永遠是一半；$r_s=0$ 時正好是 $d=1$ 的 $g<1$`), correct: true },
          { label: rich(String.raw`不對：$r_s\to0$ 時完整模型反而無條件穩定`) },
        ]}
        answer={
          <>
            <Tex>{String.raw`r_s=0`}</Tex>：<Tex>{String.raw`s_{k+1}=b_s\delta_k\Rightarrow G_k=c_sb_s\delta_{k-1}`}</Tex>，更新式變成{' '}
            <Tex>{String.raw`\delta_{k+1}=\delta_k-\mu b_sc_s\delta_{k-1}`}</Tex>——§8.3 的 <Tex>{'d=1'}</Tex>，需要 <Tex>{'\\mu b_sc_s<1'}</Tex>；quasi-static 卻說 <Tex>{'<2'}</Tex>。
            比值對任何 <Tex>{'r_s'}</Tex> 都是 <Tex>{'\\tfrac12'}</Tex>（上表）。差異的來源是觀測路徑的那一個 block 的 sample→observe latency，而不是主迴路的快慢（勘誤 E19）。
          </>
        }
      />
    </Section>
  )
}
