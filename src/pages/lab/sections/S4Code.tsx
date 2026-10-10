import { Callout, CodeBlock, CodeCompare, ModeGate, Section, Tex } from '@/components'
import blockSrc from '@/simulation/models/blockLms.ts?raw'
import dsmSrc from '@/simulation/models/dsm.ts?raw'
import pllSrc from '@/simulation/models/pll.ts?raw'
import labSrc from '@/simulation/models/unifiedLab.ts?raw'
import { ChLink, ErratumNote, md } from '../common'

const LAB_PATH = 'src/simulation/models/unifiedLab.ts'

/** §6：核心程式碼（頁面顯示的就是 worker 裡實際執行的原始碼）與演算法比較表。 */
export function S4Code() {
  return (
    <section aria-labelledby="lab-s6">
      <h2 id="lab-s6">6｜核心程式碼：公式在程式裡長什麼樣子</h2>
      <p>
        下面每一段都是用 <code>?raw</code> 直接從原始檔擷取的（<code>#region core:…</code> 標記），就是 Lab 在 Web Worker 裡執行的程式，不是另外寫的示意版。黃色底的行是「差異行」（行尾有 <code>← 差異</code> 的註解）。
      </p>

      <Section kind="formula" title="6.1　三種主 PLL 誤差路徑：none / Type-I / Type-II" id="lab-s61">
        <p>
          三個函式回傳同樣形狀的東西：<Tex>{'H_{\\mathrm{PD}}(z)'}</Tex> 與 <Tex>{'T(z)'}</Tex> 的係數（<Tex>{'z^{-1}'}</Tex> 的升冪）。差別只在 open-loop <Tex>{'L(z)'}</Tex> 有幾個積分器。
        </p>
        <CodeCompare
          items={[
            { label: 'none（忽略主 PLL）', source: labSrc, region: 'pathNone', path: LAB_PATH, note: '教學基準：$H_{\\mathrm{PD}}=T=1$，PD 與輸出端看到的都是原始的 DTC 誤差。' },
            { label: 'Type-I DPLL', source: labSrc, region: 'pathType1', path: LAB_PATH, note: '一個積分器：$1+L=(1-\\rho_Tz^{-1})/(1-z^{-1})$；pole 由頻寬的封閉式反解（§4.4）。' },
            { label: 'Type-II DPLL', source: labSrc, region: 'pathType2', path: LAB_PATH, note: '兩個積分器（PI loop filter）：係數交給 pll.ts 的 designDtLoop（E44 的直接差分方程）。' },
          ]}
          caption="$T=1-H_{\mathrm{PD}}$：Type-I 的 $T$ 分子就是 $k\,z^{-(1+d_L)}$；Type-II 的 $T=L/(1+L)$ 由 designDtLoop 一併算出。"
        />
        <div className="table-wrap">
          <table className="lab-table">
            <caption>三種路徑的比較</caption>
            <thead>
              <tr>
                <th />
                <th>none</th>
                <th>Type-I</th>
                <th>Type-II</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">積分器個數</th>
                <td>0</td>
                <td>1（VCO）</td>
                <td>2（VCO + loop filter 的積分路徑）</td>
              </tr>
              <tr>
                <th scope="row">
                  <Tex>{'H_{\\mathrm{PD}}(1)'}</Tex>（DC）
                </th>
                <td>
                  <Tex>1</Tex>
                </td>
                <td>
                  <Tex>0</Tex>
                </td>
                <td>
                  <Tex>0</Tex>（二階零點）
                </td>
              </tr>
              <tr>
                <th scope="row">
                  低頻的 <Tex>{'|H_{\\mathrm{PD}}|'}</Tex>
                </th>
                <td>平的</td>
                <td>
                  <Tex>{'\\propto f'}</Tex>（<Tex>{'20\\,\\mathrm{dB/dec}'}</Tex>）
                </td>
                <td>
                  <Tex>{'\\propto f^2'}</Tex>（<Tex>{'40\\,\\mathrm{dB/dec}'}</Tex>）
                </td>
              </tr>
              <tr>
                <th scope="row">低頻的相位超前</th>
                <td>
                  <Tex>{'0^\\circ'}</Tex>
                </td>
                <td>
                  趨近 <Tex>{'90^\\circ'}</Tex>：<Tex>C</Tex> 變小但不變號
                </td>
                <td>
                  趨近 <Tex>{'180^\\circ'}</Tex>：單頻的 code 會讓 <Tex>C</Tex> 變號（第 6 章）
                </td>
              </tr>
              <tr>
                <th scope="row">offset / code 的 DC</th>
                <td>
                  原封不動到 comparator <Tex>{'\\Rightarrow'}</Tex> 假 gain bias
                </td>
                <td colSpan={2}>
                  到不了 comparator（<ErratumNote id="E03" />）；offset 參數不可辨識（<ErratumNote id="E04" />）
                </td>
              </tr>
              <tr>
                <th scope="row">設計參數</th>
                <td>無</td>
                <td>
                  <Tex>{'f_{\\mathrm{BW}}'}</Tex>、<Tex>{'d_L'}</Tex>
                </td>
                <td>
                  <Tex>{'f_{\\mathrm{BW}}'}</Tex>、<Tex>{'\\zeta'}</Tex>、<Tex>{'d_L'}</Tex>
                </td>
              </tr>
              <tr>
                <th scope="row">用途</th>
                <td>重現 T13 錨點；隔離 comparator / GMAC 的行為</td>
                <td>看「一個積分器」就夠的現象</td>
                <td>最接近實際的 fractional-N PLL（預設）</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ModeGate min="engineer">
          <CodeBlock source={labSrc} region="type1FromBw" path={LAB_PATH} title="Type-I：由 $-3\,\mathrm{dB}$ 頻寬反解 pole" caption="§4.4 的最後一步：$r^2+2sr-1=0$ 的正根。$s\le1$ 保證 $\rho_T\ge3-2\sqrt2$，與 E27「$-3\,\mathrm{dB}$ 點存在」的範圍一致。" />
          <CodeBlock source={pllSrc} region="designDtLoop" path="src/simulation/models/pll.ts" title="Type-II：designDtLoop（共用模型，第 6 章）" caption="$K_p=2\zeta\omega_nT_s$、$K_i=(\omega_nT_s)^2$；$L(z)$ 嚴格因果（至少一拍延遲），所以 $h_{\mathrm{PD}}[0]=1$。" />
        </ModeGate>
      </Section>

      <Section kind="formula" title="6.2　迴路本身 vs 重播：同一段運算寫兩次" id="lab-s62">
        <p>
          左邊是 <code>blockLms.ts</code> 的 inner loop（真正決定 <Tex>{'w_k'}</Tex> 的程式），右邊是本頁的重播迴圈。前十行逐行對應——這就是 §5.1「逐位元相同」的來源；右邊多出的兩行把同一個 sample 再送進{' '}
          <Tex>{'H_{\\mathrm{PD}}\\{x\\}'}</Tex> 與 <Tex>{'T'}</Tex>，供 PE 與輸出端分析。
        </p>
        <CodeCompare
          items={[
            { label: '迴路：runBlockLms 的 inner loop', source: blockSrc, region: 'blockLmsInnerLoop', path: 'src/simulation/models/blockLms.ts', note: '每個 sample：DTC 誤差 → $H_{\\mathrm{PD}}$ → 加雜訊 → 1-bit → 乘 regressor 累加。' },
            { label: '重播：replayPipeline 的 inner loop', source: labSrc, region: 'replayInnerLoop', path: LAB_PATH, note: '同一個 seed、同樣的 fork 標籤與運算順序；$w_{\\mathrm{app}}$ 直接讀迴路算出的值。' },
          ]}
          caption="濾波器 pathF 的狀態跨 block 持續（規格 §15.2）；comparator 的 tie 規則 $e\ge0\Rightarrow q=+1$（E07）。"
        />
        <ModeGate min="engineer">
          <CodeBlock source={dsmSrc} region="dsmResidue" path="src/simulation/models/dsm.ts" title="DSM residue：以整數累加（共用模型，第 4 章）" caption="residue 用整數分子累加再除以 $M$，不會有浮點誤差的累積；這也是 §4.1 的封閉式能逐位元對上的原因。" />
          <CodeBlock source={labSrc} region="firstOrderResidue" path={LAB_PATH} title="一階 DSM residue 的封閉式（§4.1）" caption="週期 $P=M/\gcd(K,M)$；$E[r]$、$E[r^2]$、$\mathrm{Var}(r)$、基頻振幅 $A_1$。Lab 的「code 統計」檢查就是拿它對模擬。" />
        </ModeGate>
      </Section>

      <Section kind="formula" title="6.3　輸出端：把 $t_{\mathrm{out}}$ 拆成兩項、spur 的封閉式" id="lab-s63">
        <CodeBlock source={labSrc} region="outputDecomposition" path={LAB_PATH} title="gain noise 的變異數近似（§4.9）" caption="$\sigma_w^2(\bar x^2+\mathrm{Var}(T\{\tilde x\}))$：第一項是 code 的 DC 把 gain 抖動直接送到輸出。" />
        <CodeBlock source={labSrc} region="fracSpurClosedForm" path={LAB_PATH} title="fractional spur 的封閉式（一階 DSM）" caption="$A_{\mathrm{spur}}=|a-\bar w|\,s\,A_1|T(f_1)|$；再用 calNoise.ts 的 spurBeta / spurDbcSmallAngle 換成 dBc（T15）。" />
      </Section>

      <Section kind="formula" title="6.4　判讀工具：mean-field 平均軌跡、AR(1) 的標準誤差、Run-to-Convergence" id="lab-s64">
        <p>
          先比較「迴路」與它的 mean-field 分身：左邊是 §6.2 那段真正抽亂數、做 1-bit 判斷的 inner loop；右邊把同一個 block 的 <Tex>q</Tex> 換成 <Tex>{'E[q\\mid e_{\\det}]=\\operatorname{erf}\\bigl(e_{\\det}/(\\sqrt2\\sigma_v)\\bigr)'}</Tex>，其餘（code、
          <Tex>{'H_{\\mathrm{PD}}'}</Tex>、更新式）完全一樣。兩者之差就是雜訊造成的抖動 <Tex>{'\\delta w'}</Tex>。
        </p>
        <CodeCompare
          items={[
            { label: '迴路：每個 sample 抽一次雜訊、輸出 1 bit', source: blockSrc, region: 'blockLmsInnerLoop', path: 'src/simulation/models/blockLms.ts', note: '$q=\\mathrm{sign}(u+b+v)$：隨機。' },
            { label: 'mean-field twin：把那 1 bit 換成它的期望值', source: labSrc, region: 'meanFieldTwin', path: LAB_PATH, note: '$E[q\\mid e_{\\det}]=\\operatorname{erf}(e_{\\det}/(\\sqrt2\\sigma_v))$：確定的（F-LAB.18）。同時記下每個 block 的 $C_k$、$B_k$。' },
          ]}
          caption="mean-field twin 不做小訊號線性化，也不假設 code 的統計平穩；唯一的近似是把 $(a-\hat w)$ 提到 $H_{\mathrm{PD}}$ 外面，以及 $E[\operatorname{erf}(\cdot)]\approx\operatorname{erf}(E[\cdot])$。"
        />
        <CodeCompare
          layout="tabs"
          items={[
            { label: 'AR(1) 平均的變異數', source: labSrc, region: 'ar1MeanVar', path: LAB_PATH, note: '§5.2 的 F-LAB.9（有限 $m$ 的精確式）。' },
            { label: '平均模型的預測（mean-field 或線性）', source: labSrc, region: 'linearPrediction', path: LAB_PATH, note: '預測「後半段的平均」與「擾動 RMS」：有 mean-field 軌跡就用它，否則退回常數 $w^*$、$g$ 的線性模型；不適用時回傳原因。' },
            { label: 'Run-to-Convergence', source: labSrc, region: 'convergenceBlocks', path: LAB_PATH, note: '§5.2 的 F-LAB.17；不收斂時回傳原因而不是數字。' },
          ]}
        />
      </Section>

      <Section kind="formula" title="6.5　FCW sweep 與 Training：$C$、斜率量測、Jacobian" id="lab-s65">
        <CodeCompare
          layout="tabs"
          items={[
            { label: 'FCW sweep 的一個點', source: labSrc, region: 'fcwPoint', path: LAB_PATH, note: '$C=E[x_{\\mathrm{ref}}u_x]$（整數週期平均）、$K$、$g$、$\\rho$、$\\tau$、PM。' },
            { label: '凍結 w 加減擾動的斜率量測（common random numbers）', source: labSrc, region: 'gmacSlopeCrn', path: LAB_PATH, note: '兩邊用同一個 $v$：只有落在兩個門檻之間的樣本貢獻差值（§5.3）。' },
            { label: '多參數 Jacobian', source: labSrc, region: 'jacobian', path: LAB_PATH, note: '$J_{ij}=K_qE[\\psi_i\\phi_{u,j}]$，以及每個基底除以自己 RMS 的 scaled 版本（§5.5）。' },
            { label: 'code randomization（研究延伸）', source: labSrc, region: 'codeRandomization', path: LAB_PATH, note: '在 residue 上疊一個已知的亂數；行為模型，不是特定晶片。' },
          ]}
        />
        <div className="table-wrap">
          <table className="lab-table">
            <caption>三種 code 來源的比較（Training 分頁可以直接看到）</caption>
            <thead>
              <tr>
                <th />
                <th>一階 DSM residue</th>
                <th>MASH 1-1-1 residue</th>
                <th>
                  iid <Tex>{'\\pm1'}</Tex>（參考）
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">波形</th>
                <td>
                  週期 <Tex>{'P=M/\\gcd(K,M)'}</Tex> 的鋸齒
                </td>
                <td>noise-like（週期極長）</td>
                <td>白色</td>
              </tr>
              <tr>
                <th scope="row">頻譜</th>
                <td>
                  一排譜線 <Tex>{'k\\,\\alpha f_{\\mathrm{ref}}'}</Tex>
                </td>
                <td>
                  <Tex>{'+40\\,\\mathrm{dB/dec}'}</Tex> 的 shaped noise
                </td>
                <td>平的</td>
              </tr>
              <tr>
                <th scope="row">
                  範圍 <Tex>{'[T_{\\mathrm{vco}}]'}</Tex>
                </th>
                <td>
                  <Tex>{'(-1,\\,0]'}</Tex>
                </td>
                <td>
                  約 <Tex>{'(-2,\\,2)'}</Tex>
                </td>
                <td>
                  <Tex>{'\\pm1'}</Tex>
                </td>
              </tr>
              <tr>
                <th scope="row">
                  raw regressor 的 <Tex>C</Tex>
                </th>
                <td>
                  隨 FCW 大幅變化；近整數 <Tex>{'\\to0^+'}</Tex>
                </td>
                <td>
                  <Tex>{'\\approx E[x^2]'}</Tex>，幾乎不隨 FCW 變
                </td>
                <td>
                  <Tex>{'=E[x^2]'}</Tex>
                </td>
              </tr>
              <tr>
                <th scope="row">近整數的 PE</th>
                <td>
                  <Tex>{'\\lambda_{\\min}\\to0'}</Tex>
                </td>
                <td>好</td>
                <td>好</td>
              </tr>
              <tr>
                <th scope="row">殘差造成的輸出</th>
                <td>
                  fractional spur（封閉式）；頻寬內 <Tex>{'|T|\\approx1'}</Tex>
                </td>
                <td>
                  寬頻雜訊，多數在 PLL 頻寬外被 <Tex>T</Tex> 濾掉
                </td>
                <td>寬頻雜訊</td>
              </tr>
              <tr>
                <th scope="row">可辨識 INL 嗎</th>
                <td>code level 多，但各基底在 PD 端高度相關</td>
                <td>可以（code level 多、頻譜寬）</td>
                <td>
                  不行：<Tex>{'x^2\\equiv1'}</Tex>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Callout kind="info" title="為什麼 Lab 還保留 iid $\pm1$ 的 code">
          <p className="small">
            {md(
              '它不是 DSM 的輸出，沒有任何 PLL 會真的用它；但規格 T13 的 $\\sigma_w\\approx0.399\\,\\mathrm{fs}$ 是在「unit-RMS 的 $\\pm1$ code、identity path」下算的（E30）。保留它，才能在同一條 pipeline 上把 golden vector 逐項對上，再一次改一個條件（換成 DSM、加上 PLL…）看數字怎麼離開錨點。',
            )}
          </p>
        </Callout>
        <p className="small">
          延伸閱讀：<ChLink to="/models">Behavioral Models 頁</ChLink>有 <code>runBlockLms</code> 完整的 block 迴圈、gain register 與規格 §15.2 偽程式的逐行對照。
        </p>
      </Section>
    </section>
  )
}
