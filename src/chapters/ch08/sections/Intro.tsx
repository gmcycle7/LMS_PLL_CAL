import { Callout, ClaimTag, Mermaid, ModeGate, ModelLevel, Section, SourceTag, SymbolTable, Tex, TestBadge, type SymbolEntry } from '@/components'
import { delayCriticalGain } from '@/simulation/models/stability'
import { ErratumNote, fx, rich } from '../common'
import { ROADMAP_CHART } from '../diagrams'

const SYMBOLS: SymbolEntry[] = [
  { symbol: String.raw`\theta=\phi+\Omega D`, meaning: rich(String.raw`單頻相關的總相位（PLL error path 相位 $\phi$ 加上 code delay $D$ 造成的 $\Omega D$）`), unit: String.raw`\mathrm{deg}`, firstSeen: '§8.1', note: <ErratumNote id="E34">{rich(String.raw`$D$ 是 code delay（samples），不是 §8.4 的 feedthrough $d_s$`)}</ErratumNote> },
  { symbol: String.raw`\mathrm{wrap}_{180}(\theta)`, meaning: rich(String.raw`把角度折回 $[-180^\circ,180^\circ)$ 的函數，週期 $360^\circ$`), unit: String.raw`\mathrm{deg}`, firstSeen: '§8.1', note: <ErratumNote id="E20">{rich(String.raw`規格未定義值域，本章採 $((\theta+180^\circ)\bmod 360^\circ)-180^\circ$`)}</ErratumNote> },
  { symbol: String.raw`M_{\mathrm{polarity}}`, meaning: rich(String.raw`Polarity margin：$\theta$ 離 $\pm90^\circ$ 邊界還有多遠（只看更新方向）`), unit: String.raw`\mathrm{deg}`, firstSeen: '§8.1', note: rich(String.raw`等於 $\arcsin(\cos\theta)$`) },
  { symbol: String.raw`\delta_k=a-w_k`, meaning: rich(String.raw`第 $k$ 個 block 的剩餘參數誤差`), unit: String.raw`\mathrm{fs}`, firstSeen: '§8.2', note: rich(String.raw`全站極性約定 $\delta=a-w$（§0）`) },
  { symbol: String.raw`G_k`, meaning: rich(String.raw`GMAC 第 $k$ 個 block 的平均相關輸出（average mode）`), unit: String.raw`1`, firstSeen: '§8.2', note: <ErratumNote id="E18">{rich(String.raw`sum mode 要再乘 $N$；§8.4 的 $G$ 以 $K\equiv1$ 正規化（與 $\delta$ 同單位）`)}</ErratumNote> },
  { symbol: String.raw`K=K_qC`, meaning: rich(String.raw`GMAC 平均輸出對 $\delta$ 的斜率（小誤差線性化）`), unit: String.raw`\mathrm{fs}^{-1}`, firstSeen: '§8.2', note: <ErratumNote id="E13">{rich(String.raw`§0 未定義 $K$，本站定義 $K=K_qC=-\partial E[G]/\partial w$`)}</ErratumNote> },
  { symbol: String.raw`\mu`, meaning: '學習率（每個 block 更新一次）', unit: String.raw`\mathrm{fs}`, firstSeen: '§8.2', note: <ErratumNote id="E13">{rich(String.raw`§8.4 中為 $K\equiv1$ 的正規化步長（無因次，等同 $g$）`)}</ErratumNote> },
  { symbol: String.raw`g=\mu K`, meaning: '正規化 loop gain（決定一切穩定性的無因次量）', unit: String.raw`1`, firstSeen: '§8.2' },
  { symbol: String.raw`z`, meaning: rich(String.raw`Z transform 變數；$z^{-1}$ ＝延遲一個 block`), unit: String.raw`1`, firstSeen: '§8.2' },
  { symbol: String.raw`L_{\mathrm{cal}}(z)`, meaning: 'Calibration loop 的開迴路增益（loop gain）', unit: String.raw`1`, firstSeen: '§8.2' },
  { symbol: String.raw`\omega`, meaning: rich(String.raw`block-rate 離散頻率，$\omega=2\pi f/f_u$，$0\le\omega\le\pi$`), unit: String.raw`\mathrm{rad/block}`, firstSeen: '§8.2', note: rich(String.raw`不是 comparator rate 的 $\Omega$（rad/sample）`) },
  { symbol: String.raw`\omega_c`, meaning: rich(String.raw`Gain crossover：$|L(e^{j\omega_c})|=1$ 的頻率`), unit: String.raw`\mathrm{rad/block}`, firstSeen: '§8.2' },
  { symbol: String.raw`\omega_{180}`, meaning: rich(String.raw`Phase crossover：$\angle L(e^{j\omega_{180}})=-180^\circ$ 的頻率`), unit: String.raw`\mathrm{rad/block}`, firstSeen: '§8.2', note: rich(String.raw`延遲模型 $\frac{\pi}{2d+1}$；二狀態模型 $\arccos\frac{1+r_s}{2}$`) },
  { symbol: String.raw`PM,\;GM,\;DM`, meaning: 'Phase margin、Gain margin、Delay margin', unit: String.raw`\mathrm{deg},\;\mathrm{dB},\;\mathrm{blocks}`, firstSeen: '§8.2' },
  { symbol: String.raw`d`, meaning: rich(String.raw`更新延遲：GMAC 結果要 $d$ 個 block 後才作用到 DTC`), unit: String.raw`\mathrm{blocks}`, firstSeen: '§8.3', note: <ErratumNote id="E34">{rich(String.raw`不是 §11 的 $d(x)$，也不是 code delay $D$，也不是 §8.4 的 feedthrough $d_s$`)}</ErratumNote> },
  { symbol: String.raw`g^{*}(d)`, meaning: rich(String.raw`延遲 $d$ 時的臨界增益`), unit: String.raw`1`, firstSeen: '§8.3' },
  { symbol: String.raw`\rho`, meaning: 'Spectral radius：所有 pole（或 eigenvalue）絕對值的最大者', unit: String.raw`1`, firstSeen: '§8.3', note: rich(String.raw`$\rho<1\iff$ 線性模型穩定`) },
  { symbol: String.raw`P(z)`, meaning: '閉迴路特徵多項式（根 = 閉迴路 poles）', unit: String.raw`1`, firstSeen: '§8.3' },
  { symbol: String.raw`N_{\mathrm{blk}}`, meaning: '模擬或觀察的 block 數（實驗中的「模擬長度」）', unit: String.raw`\mathrm{blocks}`, firstSeen: '實驗 1', note: <ErratumNote id="E34">{rich(String.raw`刻意不用 $K$：$K$ 已是 GMAC 斜率`)}</ErratumNote> },
  { symbol: String.raw`s_k`, meaning: rich(String.raw`抽象觀測狀態（主 PLL 對 $\delta$ 的「記憶」）`), unit: String.raw`\mathrm{fs}`, firstSeen: '§8.4', note: <ErratumNote id="E34">{rich(String.raw`不是 VCO 控制電壓，也不是 §5 的誤差 $s$`)}</ErratumNote> },
  { symbol: String.raw`r_s,\;b_s,\;c_s`, meaning: rich(String.raw`二狀態模型：觀測 pole、$\delta\to s$ 耦合、$s\to G$ 觀測增益（正規化後無因次）`), unit: String.raw`1`, firstSeen: '§8.4', note: <ErratumNote id="E31">{rich(String.raw`規格寫 $r,b,c$；改名避免與 §0 的 $\mathbf C$、§11 的 $c$ 衝突`)}</ErratumNote> },
  { symbol: String.raw`\mathbf A_s,\;\mathbf b_s,\;\mathbf c_s^{\mathsf T},\;d_s`, meaning: '一般化觀測 state-space：狀態矩陣、輸入、輸出、直通', unit: String.raw`1`, firstSeen: '§8.4', note: <ErratumNote id="E31">{rich(String.raw`規格寫 $\mathbf A,\mathbf B,\mathbf C,D$；$\mathbf c_s^{\mathsf T}$ 即規格的 $\mathbf C$（亦稱 $\mathbf C_{\mathrm{obs}}$），不是 §0 的相關矩陣 $\mathbf C=E[\mathbf x\mathbf u^{\mathsf T}]$`)}</ErratumNote> },
  { symbol: String.raw`\mathbf A_{\mathrm{comb}}`, meaning: rich(String.raw`把觀測狀態與 $\delta$ 合併後的閉迴路矩陣`), unit: String.raw`1`, firstSeen: '§8.4' },
  { symbol: String.raw`F(z)`, meaning: rich(String.raw`觀測轉移函數 $\delta\to G$（$F(1)$ 就是等效 $K$）`), unit: String.raw`1`, firstSeen: '§8.4' },
  { symbol: String.raw`g_{\mathrm{eff}}=\mu F(1)`, meaning: rich(String.raw`雙迴路的等效 loop gain：quasi-static 一階模型的 $g$`), unit: String.raw`1`, firstSeen: '§8.4', note: rich(String.raw`二狀態模型 $g_{\mathrm{eff}}=\frac{\mu b_sc_s}{1-r_s}$；完整模型要求 $g_{\mathrm{eff}}<1$`) },
]

/** 開場、學習地圖與本章符號表 */
export function Intro() {
  return (
    <>
      <Callout kind="info" title="這一章要回答的問題">
        GMAC 的更新<strong>極性</strong>已經是對的、loop gain <Tex>{'g'}</Tex> 也在一階模型的 <Tex>{'0<g<2'}</Tex> 裡面——calibration loop 就一定穩定嗎？
        <br />
        答案是<strong>不一定</strong>。本章拆成三個陷阱：(1) polarity margin 不是 phase margin；(2) GMAC pipeline 的<strong>更新延遲</strong>會把 <Tex>{'g'}</Tex> 的穩定上界從 {fx(delayCriticalGain(0), 0)} 縮到 {fx(delayCriticalGain(1), 0)}、{fx(delayCriticalGain(2), 3)}…；
        (3) 主 PLL 對誤差的<strong>觀測動態</strong>（雙迴路，含一個 block 的取樣→觀測 latency）會讓「時間尺度分離」的簡化模型高估穩定範圍——在本章的二狀態模型裡恰好高估一倍，而且與主 PLL 的快慢無關（<ErratumNote id="E19" />）。
      </Callout>
      <div className="c-tag-row">
        <ModelLevel level="L1" /> <ModelLevel level="L2" /> <TestBadge id="T08" /> <TestBadge id="T09" /> <ClaimTag kind="exact" /> <SourceTag kind="illustrative" />
      </div>

      <SymbolTable
        rows={SYMBOLS}
        caption={
          <>
            全站約定見 Formula &amp; Unit Reference。本章的時間索引 <Tex>{'k'}</Tex> 一律是 GMAC block（更新率 <Tex>{'f_u=f_s/N'}</Tex>），頻率 <Tex>{'\\omega'}</Tex> 以 rad/block 計。
          </>
        }
      />
      <ModeGate min="research">
        <Callout kind="info" title="Research 模式：本章的模型層級">
          §8.2–8.3 是 L1 的<strong>平均（mean-field）線性化模型</strong>：把 sign-LMS 的 <Tex>{'E[G\\mid\\delta]=\\mathrm{erf}(\\delta/(\\sqrt2\\sigma_v))'}</Tex> 在
          <Tex>{'\\delta=0'}</Tex> 附近線性化成 <Tex>{'K_q\\delta'}</Tex>。§8.4 是 L2 的抽象觀測模型。真實的 sign-LMS 在線性不穩定時並不會發散到無窮大，而是被{' '}
          <Tex>{'|G|\\le1'}</Tex> 限制成有界的 limit cycle（PM Lab 的 Monte Carlo 可以看到）——那屬於 <ClaimTag kind="research" />，需要 describing function 或非線性分析。
        </Callout>
      </ModeGate>

      <Section kind="intuition" title="先用一個生活例子：洗澡水的溫度旋鈕" level={2} id="ch08-intro">
        <p>
          你在調熱水。旋鈕轉了以後，水要 2 秒才流到蓮蓬頭。如果你每 0.5 秒就「看目前的水溫」再轉一次，你會轉過頭、再轉回來、又轉過頭——
          越轉越抖。問題不在你轉的<strong>方向</strong>（太冷就往熱的方向轉，方向完全正確），而在於你每次轉的<strong>量</strong>（loop gain）和你看到的資訊有多<strong>舊</strong>（延遲）。
        </p>
        <p>
          LMS 校正迴路完全一樣：GMAC 告訴你「方向」（polarity），學習率 <Tex>{'\\mu'}</Tex> 決定「轉多少」，pipeline 與主 PLL 決定「資訊有多舊」。
          前面幾章（Ch05–Ch07）處理的是方向；這一章處理的是<strong>量 × 延遲</strong>——也就是控制理論的 phase margin。
        </p>
        <Mermaid
          caption="本章的三個模型：一階 → 加更新延遲 → 加觀測動態（雙迴路）"
          chart={ROADMAP_CHART}
        />
      </Section>

      <Section kind="diagram" title="本章學習地圖（對應入門課 Lesson 8–9）" level={2}>
        <p className="small">
          本章所有表格、曲線與數字都由 <code>src/simulation/models/stability.ts</code>（以及 PM Lab 選用的 <code>blockLms</code> Monte Carlo）即時計算；參數是教學示例，不是晶片量測值{' '}
          <SourceTag kind="illustrative" />。每一段推導後面都有一題<strong>帶入手算</strong>（HC-08.1 … HC-08.7）：把數字換成你自己的，用紙筆和工程計算機算一次，再對答案；章末思考題之前還有一題從晶片數字一路算到穩定裕度的綜合題（HC-08.8）。
        </p>
        <div className="table-wrap">
          <table className="ch08-table">
            <thead>
              <tr>
                <th>段落</th>
                <th>問題</th>
                <th>關鍵結果</th>
                <th>標籤</th>
                <th>驗證</th>
                <th>帶入手算</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>§8.1</td>
                <td>{rich(String.raw`相位 $\theta$ 多大時更新方向會反？`)}</td>
                <td>
                  <Tex>{String.raw`M=\arcsin(\cos\theta)`}</Tex>
                </td>
                <td>
                  <ClaimTag kind="exact" />
                </td>
                <td>
                  <ErratumNote id="E20" />
                </td>
                <td>HC-08.1</td>
              </tr>
              <tr>
                <td>§8.2</td>
                <td>calibration loop 自己的 PM 是多少？</td>
                <td>
                  <Tex>{String.raw`PM=90^\circ-\arcsin(g/2)`}</Tex>
                </td>
                <td>
                  <ClaimTag kind="exact" />
                </td>
                <td>
                  <TestBadge id="T08" />
                </td>
                <td>HC-08.2、HC-08.3</td>
              </tr>
              <tr>
                <td>§8.3</td>
                <td>{rich(String.raw`pipeline 延遲 $d$ 個 block 會怎樣？`)}</td>
                <td>
                  <Tex>{String.raw`g<2\sin\frac{\pi}{4d+2}`}</Tex>
                </td>
                <td>
                  <ClaimTag kind="exact" />
                </td>
                <td>{rich(String.raw`delay bounds $d=0\ldots6$`)}</td>
                <td>HC-08.4、HC-08.5、HC-08.6</td>
              </tr>
              <tr>
                <td>§8.4</td>
                <td>主 PLL 的觀測動態會怎樣？</td>
                <td>
                  <Tex>{String.raw`0<\mu b_sc_s<1-r_s`}</Tex>（不是 <Tex>{String.raw`2(1-r_s)`}</Tex>）
                </td>
                <td>
                  <ClaimTag kind="exact" /> / <ClaimTag kind="approx" />
                </td>
                <td>
                  <TestBadge id="T09" /> <ErratumNote id="E19" />
                </td>
                <td>HC-08.7</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
    </>
  )
}
