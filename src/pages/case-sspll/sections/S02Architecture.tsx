import { Callout, Mermaid, Section, Tex } from '@/components'
import { phaseSequence } from '@/simulation/models/sspll'
import { FREF_MHZ } from '../data'
import { Claim, DataTable, Src, fx, r } from '../common'

export const SSPLL_CHART = `flowchart LR
  ACC["分數累加器<br/>FCW = N_int + α<br/>φ[n] = frac(nα)"] -->|"ρ[n]（細部殘差）"| DTC
  ACC -->|"p[n]（相位索引）"| PMUX
  REF["4 GHz reference"] --> DTC["input DTC<br/>延遲 = (1−a)(1+w_g)·ρΔ + PHOS 修正"]
  DTC --> SUM(("相位比較點<br/>（SSPD 取樣）"))
  VCO["VCO（f_vco）"] --> PMUX["8 相 PMUX<br/>第 k 相實際延遲 k/8·T_vco + ε_k"]
  PMUX --> SUM
  SUM -->|"e_PD = h_PD * u"| LF["loop filter／SSCP<br/>（L1：P；L2：P+I；L3：R+C1∥C2）"]
  LF --> VCO
  SUM --> CMP["1-bit 比較器<br/>q = sign(e_PD + v)"]
  CMP --> GMAC["GMAC：Σ q·r_i<br/>（N = 512 sample 一個 block）"]
  ACC -->|"regressor x_i[n]"| GMAC
  GMAC --> LMS["sign-error LMS<br/>w_g, w_0 … w_7"]
  LMS --> DTC`

const ALPHA_EX = 0.137

/** §2 架構：SSPLL + 8 相 PMUX + input DTC，兩個誤差的注入點、極性約定與 regressor 的手算表。 */
export function S02Architecture() {
  const seq = phaseSequence(ALPHA_EX, 10, 'right')
  const beta = (8 * ALPHA_EX) % 1
  return (
    <Section kind="diagram" level={2} title="2. 架構：誤差從哪裡進來" id="cs-2">
      <Mermaid
        chart={SSPLL_CHART}
        caption="使用者的 SSPLL：分數除頻由 feedback 端的 8 相 PMUX（粗調，每格 Δ = T_vco/8）加上 reference 端的 input DTC（細調，範圍一格 Δ）實現；1-bit 比較器接在 SSPD 的取樣節點。"
        ariaLabel="SSPLL 方塊圖：分數累加器送出 PMUX 相位索引與 DTC 細部殘差；DTC 與 PMUX 的誤差在相位比較點注入，經 loop filter 與 VCO 形成迴路；比較器輸出與 regressor 進入 GMAC 與 sign-error LMS，更新 DTC 的校正係數。"
      />
      <h3>兩個誤差的注入點</h3>
      <ul>
        <li>
          <strong>GOS（DTC gain error）</strong>：DTC 在 reference 端。實際延遲是 <Tex>{r`(1-a)(1+w_g)\rho\Delta`}</Tex>，理想值是 <Tex>{r`\rho\Delta`}</Tex>。理想模型下，比較點多出{' '}
          <Tex>{r`e_{GOS}[n]=(a-w_g)\,\rho[n]\,\Delta`}</Tex>。
        </li>
        <li>
          <strong>PHOS（PMUX phase offset）</strong>：PMUX 在 feedback 端。選到第 <Tex>{'k'}</Tex> 相時多出 <Tex>{r`\varepsilon_k`}</Tex>；這個偏差經由 reference 端的 DTC 用 <Tex>{'w_k'}</Tex> 補回來。所以{' '}
          <Tex>{r`e_{PHOS}[n]=\sum_k(\varepsilon_k-w_k)\,\mathbf 1\{p[n]=k\}`}</Tex>。
        </li>
      </ul>
      <Callout kind="info" title="極性約定">
        <p>
          reference 端與 feedback 端的誤差在比較點的符號相反。我們規定：在 <Tex>{r`H_{PD}\equiv1`}</Tex>（沒有迴路）時，<Tex>{r`w\leftarrow w+\mu\,q\,r`}</Tex> 會往正確方向更新，並用這個規定吸收兩邊的符號。實作時，GOS 與 PHOS
          的更新符號要<strong>各自</strong>依 <Tex>{r`H\equiv1`}</Tex> 推導，因為 PHOS 的修正是透過 reference 端的 DTC 加上去的，誤差卻來自 feedback 端。
        </p>
      </Callout>
      <p>
        注意：<Tex>{'C'}</Tex> 只依賴 <Tex>{r`\lvert c_\nu\rvert^2`}</Tex> 與 <Tex>{r`\Gamma`}</Tex>。所以 DTC code 用 <Tex>{r`\rho`}</Tex> 或 <Tex>{r`1-\rho`}</Tex>、PMUX 索引用 <Tex>{'p'}</Tex> 或 <Tex>{'p+1'}</Tex>、PMUX
        旋轉方向（<Tex>{r`\mathrm{Re}\lambda_m=\mathrm{Re}\lambda_{8-m}`}</Tex>）都<strong>不會</strong>改變反號結論。
        <Claim kind="exact" />
      </p>

      <h3>先看一次 regressor 長什麼樣（<Tex>{`\\alpha=${ALPHA_EX}`}</Tex>）</h3>
      <DataTable
        className="cs-num"
        head={[<Tex key="n">{'n'}</Tex>, ...seq.p.map((_, n) => String(n))]}
        rows={[
          [<Tex key="p">{'p[n]'}</Tex>, ...seq.p.map((v) => String(v))],
          [<Tex key="r">{r`\rho[n]`}</Tex>, ...seq.rho.map((v) => fx(v, 3))],
        ]}
      />
      <p>
        <Tex>{`8\\alpha=${fx(8 * ALPHA_EX, 3)}`}</Tex>：PMUX 每拍前進約 1 相，旋轉一圈約 8 拍，所以 mode-1 的頻率是 <Tex>{`\\alpha f_{ref}=${fx(ALPHA_EX * FREF_MHZ, 0)}`}</Tex> MHz。<Tex>{r`\rho`}</Tex> 每拍增加{' '}
        <Tex>{`\\beta=\\mathrm{frac}(8\\alpha)=${fx(beta, 3)}`}</Tex>，是一個頻率 <Tex>{`\\beta f_{ref}=${fx(beta * FREF_MHZ, 0)}`}</Tex> MHz 的慢鋸齒。這兩個頻率（PMUX 的旋轉、鋸齒的基頻）就是後面決定 PHOS 與 GOS 命運的主角。
      </p>
      <Src>
        由 <code>sspll.ts</code> 的 <code>phaseSequence</code> 即時產生（floor 約定）；與 golden 的 <code>worked_examples.json</code> 在測試中比對。
      </Src>
    </Section>
  )
}
