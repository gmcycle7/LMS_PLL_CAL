import { Callout, ClaimTag, CodeBlock, Mermaid, ModeGate, Quiz, Recap, Section, SourceTag, StepDerivation, Tex, ChRef } from '@/components'
import pyStability from '../../../../golden/lms_pll_golden/stability.py?raw'
import { useMemo } from 'react'
import { analyzeGeneral, comparatorKq, delayCriticalGain, pmFirstOrder, pmWithDelay, stableIntervalsNumeric, type ObservationSystem } from '@/simulation/models/stability'
import { ErratumNote, Expand, fx, HandCalcSlot, rich, tx } from '../common'
import { SYNTHESIS_FLOW_CHART, UNIFIED_LOOP_CHART } from '../diagrams'

/** 入門課 Lesson 4 / T13 的硬體數字：comparator 前雜訊 σ_v = 100 fs、±1 code、identity path（C = 1） */
const HW_SIGMA_V_FS = 100
const HW_MU_FS = [2, 10, 11.2, 50, 100, 150, 250]

/** 演算法／模型比較表、硬體對應、思考題與本課必記 */
export function Wrapup() {
  const gm = pmWithDelay(0.5, 1)
  // 把無因次的 g 換回晶片上的單位：g = μ[fs]·K_q[1/fs]·C
  const kq = comparatorKq(HW_SIGMA_V_FS)
  const hw10 = pmFirstOrder(10 * kq)
  const hwRows = HW_MU_FS.map((mu) => ({ mu, g: mu * kq, d0: pmFirstOrder(mu * kq), d1: pmWithDelay(mu * kq, 1), d2: pmWithDelay(mu * kq, 2) }))
  const second = useMemo(() => {
    const sys: ObservationSystem = { A: [[1.6, -0.68], [1, 0]], b: [1, 0], c: [0.04, 0.04], d: 0 }
    const iv = stableIntervalsNumeric((mu) => analyzeGeneral(sys, mu).rho, 0, 3, 601)
    return { hi: iv[0]?.hi ?? NaN, f1: analyzeGeneral(sys, 0.1).dcGain }
  }, [])
  return (
    <>
      <Section kind="assumptions" title="比較表：兩種 margin、六種模型的穩定條件" level={2} id="ch08-compare">
        <div className="table-wrap">
          <table className="ch08-table">
            <caption>Polarity margin vs Calibration phase margin</caption>
            <thead>
              <tr>
                <th></th>
                <th>Polarity margin（§8.1）</th>
                <th>Calibration PM（§8.2–8.4）</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>回答的問題</td>
                <td>平均更新方向對不對？</td>
                <td>迴路會不會振盪、對延遲有多脆弱？</td>
              </tr>
              <tr>
                <td>頻率軸</td>
                <td>
                  code 頻率 <Tex>{'\\Omega'}</Tex>（rad/sample，comparator rate）
                </td>
                <td>
                  更新頻率 <Tex>{'\\omega'}</Tex>（rad/block，<Tex>{'f_u=f_s/N'}</Tex>）
                </td>
              </tr>
              <tr>
                <td>公式</td>
                <td>
                  <Tex>{'\\arcsin(\\cos\\theta)'}</Tex>
                </td>
                <td>
                  <Tex>{'90^\\circ-(2d+1)\\arcsin(g/2)'}</Tex>（一般：<Tex>{'180^\\circ+\\angle\\frac{\\mu F}{z-1}'}</Tex>）
                </td>
              </tr>
              <tr>
                <td>{rich(String.raw`和 $\mu$ 有關嗎`)}</td>
                <td>{rich(String.raw`無關（只看 $\phi,\Omega,D$）`)}</td>
                <td>{rich(String.raw`直接由 $g=\mu K$ 決定`)}</td>
              </tr>
              <tr>
                <td>小於 0 的後果</td>
                <td>{rich(String.raw`極性錯誤：單調漂移、平均發散（調小 $\mu$ 沒用）`)}</td>
                <td>{rich(String.raw`振盪發散（調小 $\mu$ 有用）`)}</td>
              </tr>
              <tr>
                <td>修正方法</td>
                <td>delay alignment、filtered-x（<ChRef ch="07">Ch07</ChRef>）</td>
                <td>{rich(String.raw`降 $\mu$、縮短 pipeline、改善觀測動態`)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <h4>六種模型其實是同一個迴路</h4>
        <p>
          {rich(
            String.raw`看第二張表之前，先用一張圖把 §8.2–§8.4 收成同一個迴路：加法點、暫存器（積分器 $\frac{\mu}{z-1}$）和負回授從頭到尾都沒有變，三節之間唯一換掉的是「從 $\delta$ 到 $G$ 的觀測路徑」$F(z)$。下表的每一列，就是把不同的 $F(z)$ 代進開迴路增益 $L_{\mathrm{cal}}(z)=\frac{\mu F(z)}{z-1}$ 之後得到的穩定條件。`,
          )}
        </p>
        <Mermaid
          caption={String.raw`整章是同一個迴路：實線那一圈不變；用虛線指進藍色方塊的四格，是 §8.2、§8.3、§8.4 與 quasi-static 各自代進去的觀測路徑 $F(z)$，紅色那格是近似`}
          chart={UNIFIED_LOOP_CHART}
        />
        <p className="small">
          {rich(
            String.raw`讀圖：先看實線那一圈——目標 $a$ 從 $\Sigma$ 的「＋」端進來、$w_k$ 從「−」端回來，所以 $\delta_k=a-w_k$；它經過藍色的 $F(z)$ 變成 $G_k$，再被暫存器 $\frac{\mu}{z-1}$ 累加成 $w_k$。框起來的兩格相乘就是 F-08.14 的 $L_{\mathrm{cal}}(z)=\frac{\mu F(z)}{z-1}$。再看四條虛線——它們不是訊號，而是「把哪一個 $F(z)$ 代進藍色方塊」：$F=K$ 得到 F-08.2 的 $\frac{g}{z-1}$；$F=Kz^{-d}$（也就是 $G_k=K\delta_{k-d}$）得到 F-08.7 的 $\frac{g\,z^{-d}}{z-1}$；$F=\frac{b_sc_s}{z-r_s}$ 得到 F-08.16 用的 $\frac{\mu b_sc_s}{(z-1)(z-r_s)}$（§8.4 把 $K$ 正規化成 $1$）。§8.3 的圖把 $z^{-d}$ 畫在暫存器的輸出，這裡把它併進 $F(z)$：$a$ 是常數時，兩種畫法給出同一條遞迴式 $\delta_{k+1}=\delta_k-g\,\delta_{k-d}$。最後看紅色那格——quasi-static 把 $F(z)$ 換成常數 $F(1)$，等於退回「§8.2 一階」那一格的迴路，只是 $g$ 換成 $g_{\mathrm{eff}}=\mu F(1)$；觀測路徑的相位全部被丟掉，這就是下表「何時會錯」那一欄的來源。`,
          )}
        </p>
        <div className="table-wrap">
          <table className="ch08-table">
            <caption>{rich(String.raw`同一個 calibration loop，六種模型給的穩定條件（「本例」：§8.2–8.3 以 $g$、$d$ 表示；§8.4 用 Gallery #5 的 $r_s=0.8,\ b_sc_s=0.2$）`)}</caption>
            <thead>
              <tr>
                <th>模型</th>
                <th>條件</th>
                <th>本例數值</th>
                <th>標籤</th>
                <th>何時會錯</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>一階（§8.2）</td>
                <td>
                  <Tex>{'0<g<2'}</Tex>
                </td>
                <td>{rich(String.raw`$g<2$`)}</td>
                <td>
                  <ClaimTag kind="exact" />
                </td>
                <td>有更新延遲時一定高估；有觀測動態時可能高估（含一個 block latency，E19）也可能低估（無 latency 的反事實）</td>
              </tr>
              <tr>
                <td>
                  更新延遲 <Tex>{'d'}</Tex>（§8.3）
                </td>
                <td>
                  <Tex>{'0<g<2\\sin\\frac{\\pi}{4d+2}'}</Tex>
                </td>
                <td>
                  {rich(String.raw`$d=1$：$1$；$d=2$：`)} <Tex>{tx(delayCriticalGain(2), 3)}</Tex>
                </td>
                <td>
                  <ClaimTag kind="exact" />
                </td>
                <td>非整數延遲、pipeline 定義不清</td>
              </tr>
              <tr>
                <td>雙迴路 quasi-static（§8.4）</td>
                <td>
                  <Tex>{'0<\\mu b_sc_s<2(1-r_s)'}</Tex>
                </td>
                <td>{rich(String.raw`$\mu<2$`)}</td>
                <td>
                  <ClaimTag kind="approx" />
                </td>
                <td>
                  穩定上界永遠高估 2 倍（E19）；<Tex>{'\\mu b_sc_s'}</Tex> 不遠小於 <Tex>{'(1-r_s)^2/4'}</Tex> 時連 pole 與收斂速度也錯
                </td>
              </tr>
              <tr>
                <td>雙迴路完整（§8.4）</td>
                <td>
                  <Tex>{'0<\\mu b_sc_s<1-r_s'}</Tex>
                </td>
                <td>{rich(String.raw`$\mu<1$`)}</td>
                <td>
                  <ClaimTag kind="exact" />
                </td>
                <td>觀測不是一階、或 PLL 不是 LTI</td>
              </tr>
              <tr>
                <td>一般化 state-space（§8.4）</td>
                <td>
                  <Tex>{'\\rho(\\mathbf A_{\\mathrm{comb}})<1'}</Tex>
                </td>
                <td>數值掃描</td>
                <td>
                  <ClaimTag kind="exact" />
                </td>
                <td>{rich(String.raw`sign-LMS 的非線性（大誤差時等效斜率 $K$ 下降）、量化、noise`)}</td>
              </tr>
              <tr>
                <td>真實 block sign-LMS</td>
                <td>線性化在小誤差附近成立；線性不穩時形成有界 limit cycle</td>
                <td>PM Lab 的 Monte Carlo</td>
                <td>
                  <ClaimTag kind="research" />
                </td>
                <td>需要 describing function / 非線性分析、RTL 驗證</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section kind="diagram" title="連結到 PLL 硬體" level={2}>
        <div className="table-wrap">
          <table className="ch08-table">
            <thead>
              <tr>
                <th>本章符號</th>
                <th>硬體／RTL 對應</th>
                <th>怎麼量或怎麼算</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Tex>{'g=\\mu K_qC'}</Tex>
                </td>
                <td>
                  REG_CAL_MU（或 shift 量） <Tex>{'\\times'}</Tex> comparator 統計增益 <Tex>{'\\times'}</Tex> 相關
                </td>
                <td>
                  <Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex>（<ChRef ch="05">Ch05</ChRef>）；<Tex>{'C'}</Tex> 由 <ChRef ch="06">Ch06</ChRef> 或量測斜率 <Tex>{'S_{\\mathrm{GMAC}}'}</Tex>
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{'d'}</Tex>
                </td>
                <td>GMAC 累加 → 除法/shift → shadow register → commit 的 pipeline</td>
                <td>從 RTL timing 數 block；blockLms 的 <code>cal_update_delay_blocks</code></td>
              </tr>
              <tr>
                <td>
                  <Tex>{'F(z)'}</Tex>、<Tex>{'r_s'}</Tex>
                </td>
                <td>{rich(String.raw`主 PLL 的 error transfer（DTC 殘差從 PD 的 reference 輸入進去、PD 輸出 $e_{\mathrm{PD}}=H_{\mathrm{PD}}\,\phi_{\mathrm{dtc}}$）在 block rate 上的等效動態`)}</td>
                <td>{rich(String.raw`由 PLL loop filter／頻寬換算到 $f_u$，並包含 GMAC「取樣→觀測」的 latency；即使 PLL 很快（$r_s\approx0$），這個 latency 仍讓界限減半（E19）`)}</td>
              </tr>
              <tr>
                <td>PM、GM、DM</td>
                <td>Calibration sign-off 的動態裕度</td>
                <td>
                  {rich(String.raw`建議同時報告：例如 $d=1$、$g=0.5$ 時 $GM=$`)} <Tex>{`${tx(gm.gmDb, 2)}\\ \\mathrm{dB}`}</Tex>、{rich(String.raw`$PM=$`)} <Tex>{`${tx(gm.pmDeg, 1)}^\\circ`}</Tex>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <h4>{rich(String.raw`用晶片上的數字算一次：$g$ 到底是多少 fs 的 $\mu$？（入門課 Lesson 4 的例子）`)}</h4>
        <p>
          {rich(
            String.raw`本章的 $g$ 是無因次的。換回硬體單位只要一個數字：comparator 的統計增益 $K_q$。沿用入門課的例子——comparator 前雜訊 $\sigma_v=${HW_SIGMA_V_FS}$ fs、$\pm1$ code、identity path（$C=1$）、average-mode GMAC：`,
          )}{' '}
          <SourceTag kind="illustrative" />
        </p>
        <StepDerivation
          title={rich(String.raw`先算一次：$\mu=10$ fs（T13 的設定）`)}
          steps={[
            { tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{${fx(Math.sqrt(2 / Math.PI), 5)}}{${HW_SIGMA_V_FS}\ \mathrm{fs}}=${fx(kq, 7)}\ \mathrm{fs}^{-1}`, why: rich(String.raw`Ch05：1-bit comparator 在小誤差時的等效斜率（$E[q]\approx K_q\,\delta$）。`) },
            { tex: String.raw`g=\mu K_qC=10\ \mathrm{fs}\times${fx(kq, 7)}\ \mathrm{fs}^{-1}\times1=${fx(10 * kq, 6)}`, why: rich(String.raw`單位 $\mathrm{fs}\times\mathrm{fs}^{-1}$ 抵消：$g$ 無因次（E13）。`) },
            { tex: String.raw`p=1-g=${fx(hw10.pole, 5)}`, why: rich(String.raw`閉迴路 pole（F-08.3）；Ch12 / T13 的 noise 分析用的就是這個 $p$。`) },
            { tex: String.raw`\omega_c=2\arcsin\frac g2=${fx(hw10.omegaC, 5)}\ \mathrm{rad/block},\qquad PM=90^\circ-\arcsin\frac g2=${fx(hw10.pmDeg, 2)}^\circ`, why: rich(String.raw`F-08.4、F-08.5：$g\ll1$ 時 $\omega_c\approx g$、$PM\approx90^\circ$。`) },
            { tex: String.raw`DM=\frac{PM[\mathrm{rad}]}{\omega_c}=${fx(hw10.delayMarginBlocks, 2)}\ \text{blocks}`, why: rich(String.raw`F-08.6：這麼小的 $g$ 可以容忍約 $${Math.floor(hw10.delayMarginBlocks)}$ 個 block 的 pipeline 延遲——小 $\mu$ 對延遲不敏感。`) },
            { tex: String.raw`\mu<\frac{g^*(d)}{K_q}:\quad d=0\Rightarrow${fx(delayCriticalGain(0) / kq, 2)}\ \mathrm{fs},\quad d=1\Rightarrow${fx(delayCriticalGain(1) / kq, 2)}\ \mathrm{fs},\quad d=2\Rightarrow${fx(delayCriticalGain(2) / kq, 2)}\ \mathrm{fs}`, why: rich(String.raw`把 F-08.8 的 $g^*(d)$ 除以 $K_q$ 就是 $\mu$ 的上限：入門課的「$0<\alpha<250.66$ fs」正是 $d=0$；多一個 block 延遲就減半。`) },
          ]}
        />
        <div className="table-wrap">
          <table className="ch08-table">
            <caption>{rich(String.raw`$\sigma_v=${HW_SIGMA_V_FS}$ fs、$C=1$：不同 $\mu$ 的 loop gain 與裕度（由 comparatorKq、pmFirstOrder、pmWithDelay 即時計算）`)}</caption>
            <thead>
              <tr>
                <th className="num">{rich(String.raw`$\mu$ [fs]`)}</th>
                <th className="num">{rich(String.raw`$g=\mu K_q$`)}</th>
                <th className="num">{rich(String.raw`pole $1-g$`)}</th>
                <th className="num">{rich(String.raw`$PM$（$d=0$）`)}</th>
                <th className="num">{rich(String.raw`$PM_1$（$d=1$）`)}</th>
                <th className="num">{rich(String.raw`$PM_2$（$d=2$）`)}</th>
                <th className="num">{rich(String.raw`$DM$ [blocks]`)}</th>
                <th>判讀</th>
              </tr>
            </thead>
            <tbody>
              {hwRows.map((r) => (
                <tr key={r.mu}>
                  <td className="num mono">{r.mu}</td>
                  <td className="num mono">{fx(r.g, 5)}</td>
                  <td className="num mono">{fx(r.d0.pole, 5)}</td>
                  <td className="num mono">{fx(r.d0.pmDeg, 2)}°</td>
                  <td className={`num mono${r.d1.pmDeg <= 0 ? ' ch08-bad' : ''}`}>{fx(r.d1.pmDeg, 2)}°</td>
                  <td className={`num mono${r.d2.pmDeg <= 0 ? ' ch08-bad' : ''}`}>{fx(r.d2.pmDeg, 2)}°</td>
                  <td className="num mono">{fx(r.d0.delayMarginBlocks, 2)}</td>
                  <td>
                    {r.d0.pmDeg <= 0
                      ? '連無延遲都不穩'
                      : r.d1.pmDeg <= 0
                        ? rich(String.raw`只有 $d=0$ 穩定`)
                        : r.d2.pmDeg <= 0
                          ? rich(String.raw`$d\le1$ 穩定，$d=2$ 發散`)
                          : rich(String.raw`$d\le2$ 都穩定`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small">
          {rich(
            String.raw`紅字：$PM_d\le0$（不穩定）。$\mu=11.2$ fs 是入門課 Lesson 10 設計計算器建議的學習率，$PM=${fx(pmFirstOrder(11.2 * kq).pmDeg, 1)}^\circ$；對 PM 而言綽綽有餘——實務上限制 $\mu$ 的通常是 noise（Ch12）而不是穩定性。但若為了加速收斂把 $\mu$ 拉到 $100$ fs 以上，pipeline 的 $d$ 就開始決定生死。`,
          )}{' '}
          <ClaimTag kind="approx" />（<Tex>{'K_q'}</Tex> 是小誤差線性化；大誤差時等效斜率下降、裕度反而變大）
        </p>

        <Callout kind="info" title="設計檢查清單（本章）">
          <ol>
            <li>先確認極性：<Tex>{'C>0'}</Tex>（或 <Tex>{'M_{\\mathrm{polarity}}>0'}</Tex>，用 <Tex>{'\\arcsin(\\cos\\theta)'}</Tex> 計算，<ErratumNote id="E20" />）。</li>
            <li>從 RTL 數出更新延遲 <Tex>{'d'}</Tex>，算 <Tex>{'g^*(d)'}</Tex>；選 <Tex>{'g'}</Tex> 時保留 GM 給 <Tex>{'K_q'}</Tex>、<Tex>{'C'}</Tex> 的 PVT 變化。</li>
            <li>
              不論主 PLL 多快，都用 <Tex>{'L_{\\mathrm{cal}}=\\mu F(z)/(z-1)'}</Tex> 或 <Tex>{'\\rho(\\mathbf A_{\\mathrm{comb}})'}</Tex> 驗證，而且{' '}
              <Tex>{'F(z)'}</Tex> 要包含 GMAC 的 sample→observe latency；不要只用 quasi-static 的 <Tex>{'F(1)'}</Tex>——把 PLL 調快（
              <Tex>{'r_s\\to0'}</Tex>）並不會讓二狀態模型的界限從一半變回 quasi-static 的值（<ErratumNote id="E19" />）。
            </li>
            <li>
              時域模擬至少數百個 block，疊上 <Tex>{'\\rho^k'}</Tex> 參考線比斜率（<Tex>{'\\rho'}</Tex> 只給漸近速率，<Tex>{'\\rho^k'}</Tex> 不是誤差的上界）；複數 pole 的發散很慢、很像收斂。
            </li>
            <li>最後用真實 sign-LMS（含 comparator noise、量化）的 Monte Carlo 確認（PM Lab、Calibration Lab）。</li>
          </ol>
        </Callout>
      </Section>

      <Section kind="example" title="綜合手算：從晶片數字到穩定裕度" level={2} id="ch08-handcalc-synthesis">
        <p>
          {rich(
            String.raw`把整章串起來算一次：手上只有三個硬體數字——comparator 前的雜訊 $\sigma_v$、暫存器的學習率 $\mu$、RTL 數出來的更新延遲 $d$（再加上 Ch06 的相關 $C$）。先把它們換成無因次的 $g$（§8.2），再用 §8.3 的 $g^*(d)$、$GM_d$、$PM_d$ 判斷離不穩定還有多遠。預設值就是上面「用晶片上的數字算一次」的 $\sigma_v=${HW_SIGMA_V_FS}$ fs、$\mu=10$ fs。`,
          )}
        </p>
        <Mermaid
          caption={String.raw`綜合手算的計算順序：圓角的是四個輸入，其餘每一格是一步；先算到藍色的 $g$，再分頭算 pole、學習率上限與兩個裕度`}
          chart={SYNTHESIS_FLOW_CHART}
        />
        <p className="small">
          {rich(
            String.raw`讀圖：先看通到藍色方塊的那條主線——$\sigma_v\to K_q\to K\to g$，把三個硬體數字壓成一個沒有單位的 $g$（$K_q=\sqrt{2/\pi}/\sigma_v$ 是 Ch05 的 comparator 統計增益）。再看 $d$ 那條線——它只決定臨界增益 $g^{*}(d)$。最後兩條線會合：$g^{*}(d)$ 除以 $K$ 是學習率上限 $\mu_{\max}$，除以 $g$ 是 $GM_d$；$g$ 和 $d$ 一起決定 $PM_d$。圖上的每一格都對應下面手算題裡的一到兩個步驟（例如 $GM_d$ 那格在手算題裡分成「算倍數」和「換成 dB」），順序相同。`,
          )}
        </p>
        <HandCalcSlot id="HC-08.8">
          {rich(String.raw`把 $\sigma_v$、$\mu$、$C$、$d$ 換成你自己晶片的數字，拿紙筆和計算機從 $K_q$ 一路算到 $PM_d$。`)}
        </HandCalcSlot>
      </Section>

      <Section kind="example" title="思考題" level={2}>
        <Quiz
          title="思考題 5（Gain margin）"
          question={
            <>
              <Tex>{'d=1'}</Tex>、<Tex>{'g=0.5'}</Tex>。Gain margin 是多少 dB？
            </>
          }
          options={[
            { label: rich(String.raw`$20\log_{10}(2/0.5)=${tx(pmWithDelay(0.5, 0).gmDb, 2)}$ dB`) },
            { label: rich(String.raw`$20\log_{10}(1/0.5)=${tx(gm.gmDb, 2)}$ dB`), correct: true },
            { label: '0 dB' },
            { label: '無法定義' },
          ]}
          answer={
            <>
              有延遲時 <Tex>{'GM_d=g^*(d)/g'}</Tex>，<Tex>{'g^*(1)=2\\sin(\\pi/6)=1'}</Tex>，所以 <Tex>{String.raw`GM=1/0.5=2\Rightarrow ${tx(gm.gmDb, 2)}\ \mathrm{dB}`}</Tex>。<Tex>{String.raw`${tx(pmWithDelay(0.5, 0).gmDb, 2)}\ \mathrm{dB}`}</Tex> 是忽略延遲的一階答案（<Tex>{'GM=2/g'}</Tex>）。phase crossover 在 <Tex>{'\\omega_{180}=\\pi/3'}</Tex>，那裡 <Tex>{'|L|=0.5/(2\\sin30^\\circ)=0.5'}</Tex>。
            </>
          }
        />
        <Quiz
          title={String.raw`思考題 6（一般化 $F(z)$）`}
          question={
            <>
              某觀測路徑 <Tex>{'F(z)=0.04(z+1)/(z^2-1.6z+0.68)'}</Tex>（<Tex>{'F(1)=1'}</Tex>，觀測 poles <Tex>{'0.8\\pm j0.2'}</Tex>）。quasi-static 說 <Tex>{'0<\\mu<2'}</Tex>。完整模型呢？（用 Dual-Loop Explorer 的「二階觀測」preset 檢查）
            </>
          }
          answer={
            <>
              數值掃描 <Tex>{'\\rho(\\mathbf A_{\\mathrm{comb}})<1'}</Tex>（<Tex>{`F(1)=${tx(second.f1, 3)}`}</Tex>）得到 <Tex>{`0<\\mu<${tx(second.hi, 3)}`}</Tex>——quasi-static 高估約{' '}
              <Tex>{tx(2 / second.hi, 1)}</Tex> 倍。原因：<Tex>{'F(z)'}</Tex> 在低頻就有很大的相位延遲（兩個 <Tex>{'0.8\\pm j0.2'}</Tex> 的 poles 加上一個 block 的 latency），<Tex>{'\\omega_c'}</Tex> 附近的相位遠比 <Tex>{'-90^\\circ-\\omega/2'}</Tex> 更負；quasi-static 只看 <Tex>{'F(1)'}</Tex>，完全看不到相位。
            </>
          }
        />
      </Section>

      <Recap
        formulas={[
          { label: 'Polarity margin（E20）', tex: String.raw`\boxed{M_{\mathrm{polarity}}=\arcsin(\cos\theta)}` },
          { label: '一階 calibration loop（T08）', tex: String.raw`\boxed{L_{\mathrm{cal}}=\frac{g}{z-1},\;p=1-g,\;PM=90^\circ-\arcsin\frac g2}` },
          { label: '更新延遲', tex: String.raw`\boxed{g<g^*(d)=2\sin\frac{\pi}{4d+2},\quad PM_d=90^\circ-(2d+1)\arcsin\frac g2}` },
          { label: '雙迴路（T09、E19）', tex: String.raw`\boxed{0<\mu b_sc_s<1-r_s\iff0<g_{\mathrm{eff}}=\mu F(1)<1\quad(\text{quasi-static 以為 }<2)}` },
          { label: '一般化（E31）', tex: String.raw`\boxed{\rho\!\begin{bmatrix}\mathbf A_s&\mathbf b_s\\-\mu\mathbf c_s^{\mathsf T}&1-\mu d_s\end{bmatrix}<1,\quad L_{\mathrm{cal}}=\frac{\mu F(z)}{z-1}}` },
        ]}
        points={[
          <>{rich(String.raw`Polarity margin 只管方向（靜態、與 $\mu$ 無關）；phase margin 管動態（由 $g$ 與延遲決定）。兩者都要過。`)}</>,
          <>
            一階 calibration loop 就是積分器：<Tex>{'PM\\ge60^\\circ\\iff g\\le1'}</Tex>；{rich(String.raw`$g=1$ 的 delay margin 剛好 1 個 block。`)}
          </>,
          <>
            每多一個 block 的更新延遲，PM 多扣 <Tex>{'\\omega_c'}</Tex>；臨界增益 {[0, 1, 2, 3].map((dd) => fx(delayCriticalGain(dd), dd < 2 ? 0 : 3)).join(' → ')}…，{rich(String.raw`$PM=0$ 與根穿越單位圓是同一件事。`)}
          </>,
          <>
            時間尺度分離（quasi-static）把 <Tex>{'F(z)'}</Tex> 換成 <Tex>{'F(1)'}</Tex>，看不到觀測路徑的相位；二狀態例子的完整界限永遠只有一半（<Tex>{'GM'}</Tex> 少約 6 dB），與主 PLL 快慢無關——原因是那一個 block 的 sample→observe latency。
          </>,
          <>{rich(String.raw`複數 pole 的發散很慢：至少跑 300 blocks、疊上 $\rho^k$ 參考線看斜率（$\rho^k$ 只給漸近速率，不是誤差的包絡），不要被短視窗的「假收斂」騙。`)}</>,
          <>這些都是線性化平均模型；真實 sign-LMS 在線性不穩時會變成有界 limit cycle——仍然是失敗，只是不會「爆掉」。</>,
        ]}
      />

      <ModeGate min="research">
        <Expand
          title={
            <>
              對照：Python golden model（獨立實作，產生 T08 / T09 / <code>delay_bounds</code> 的 golden vectors）
            </>
          }
          badge="研究"
          openFrom="research"
        >
          <p className="small">
            TypeScript 的 <code>stability.ts</code> 與這份 NumPy/SciPy 實作互不共用程式碼；單元測試逐項比對 <code>golden/vectors/T08.json</code>、<code>T09.json</code>、
            <code>delay_bounds.json</code>（容忍度 1e-9 至 1e-12）。
          </p>
          <CodeBlock source={pyStability} lang="python" path="golden/lms_pll_golden/stability.py" title="Python 等價版本（整個檔）" />
        </Expand>
      </ModeGate>

      <ModeGate min="engineer">
        <Callout kind="info" title="下一個值得研究的問題">
          <ul>
            <li><ChRef ch="09">Ch09</ChRef>：迴路穩定不代表每個參數都學得到（Persistent Excitation、eigenvalue）。</li>
            <li>{rich(String.raw`Ch12：選了 $g$ 之後，GMAC noise 怎麼變成 $\sigma_w$ 與 output jitter（$g$ 越大越吵）。`)}</li>
            <li>{rich(String.raw`Ch14：PM、noise、收斂時間三者一起決定最佳 $\mu$ 與 $N$。`)}</li>
            <li>{rich(String.raw`附錄 R7：真正的 Fractional-N PLL closed-loop state-space 取代本章抽象的 $F(z)$。`)}</li>
            <li>
              {rich(String.raw`非線性：sign-LMS 的 describing function 能否預測 limit cycle 的振幅（PM Lab 的 MC 觀察到約為 $\sigma_v$ 的量級，僅為觀察）？`)}
              <ClaimTag kind="research" />
            </li>
          </ul>
        </Callout>
      </ModeGate>
    </>
  )
}
