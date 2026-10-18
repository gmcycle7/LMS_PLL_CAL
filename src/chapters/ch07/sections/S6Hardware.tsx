import { useMemo, type ReactNode } from 'react'
import { ClaimTag, CodeBlock, CodeCompare, Mermaid, ModeGate, Section, SourceTag, Tex, ChRef } from '@/components'
import fxSrc from '@/simulation/models/filteredX.ts?raw'
import pySrc from '../../../../golden/lms_pll_golden/polarity.py?raw'
import {
  analyticCorr,
  analyticCorrSweep,
  buildHat,
  HAT_EXACT,
  pathTransfer,
  secondDiffFailBand,
  type FxCodeSpec,
  type FxHatSpec,
  type FxPathSpec,
} from '@/simulation/models/filteredX'
import { CHART_COST_LADDER, CHART_DECISION, CHART_RTL_REGRESSORS } from '../diagrams'
import { fp, fx, signClass, tx } from '../util'

const r = String.raw

interface Scenario {
  label: ReactNode
  path: FxPathSpec
  code: FxCodeSpec
}

/** 四種 regressor 在同一組場景下的正規化相關 ρ（由封閉式即時計算）。 */
function rhoTable(scenarios: Scenario[]) {
  return scenarios.map((s) => {
    const H = pathTransfer(s.path)
    const eu2 = analyticCorr({ code: s.code, h: H, g: H, D: 0 }) as number
    const raw = (analyticCorr({ code: s.code, h: H, g: null, D: 0 }) as number) / Math.sqrt(eu2)
    const sweep = analyticCorrSweep({ code: s.code, h: H, g: null, Ds: Int32Array.from({ length: 401 }, (_, i) => i) }) as Float64Array
    let bestD = 0
    let bestC = -Infinity
    sweep.forEach((c, D) => {
      if (c > bestC + 1e-15) {
        bestC = c
        bestD = D
      }
    })
    const rhoOf = (hatSpec: FxHatSpec) => {
      const hat = buildHat(s.path, hatSpec, s.code)
      const c = analyticCorr({ code: s.code, h: H, g: hat.full, D: 0 }) as number
      const euf2 = analyticCorr({ code: s.code, h: hat.full, g: hat.full, D: 0 }) as number
      return c / Math.sqrt(eu2 * euf2)
    }
    return {
      label: s.label,
      raw,
      delayed: bestC / Math.sqrt(eu2),
      bestD,
      filtered: rhoOf(HAT_EXACT),
      second: s.path.kind === 'type2_dt' ? rhoOf({ ...HAT_EXACT, base: 'second_diff' }) : NaN,
    }
  })
}

/** §7.6：硬體成本、方塊圖、演算法比較表與核心程式碼並排。 */
export function S6Hardware() {
  // 二次差分的極性反轉頻帶（ω_nT_s = 0.1、ζ = 0.7、d = 0；精確 freqz 掃描）
  const band = useMemo(() => secondDiffFailBand({ kind: 'type2_dt', wnTs: 0.1, zeta: 0.7, loopDelay: 0 }), [])
  const rows = useMemo(
    () =>
      rhoTable([
        {
          label: (
            <>
              T07：單頻 <Tex>{r`\Omega=\pi/6`}</Tex>、<Tex>{r`\phi=-120^\circ`}</Tex>
            </>
          ),
          path: { kind: 'single_tone', magnitude: 1, phaseDeg: -120, omega: Math.PI / 6 },
          code: { kind: 'sinusoid', omega: Math.PI / 6 },
        },
        {
          label: (
            <>
              Type-II、低頻 tone <Tex>{r`\Omega=0.3\,\omega_nT_s`}</Tex>
            </>
          ),
          path: { kind: 'type2_dt', wnTs: 0.1, zeta: 0.7, loopDelay: 0 },
          code: { kind: 'sinusoid', omega: 0.03 },
        },
        {
          label: (
            <>
              Type-II、tone <Tex>{r`\Omega=\pi/6`}</Tex>（高於 <Tex>{r`\omega_n`}</Tex>）
            </>
          ),
          path: { kind: 'type2_dt', wnTs: 0.1, zeta: 0.7, loopDelay: 0 },
          code: { kind: 'sinusoid', omega: Math.PI / 6 },
        },
        {
          label: <>Type-II、白色 <Tex>{r`\pm1`}</Tex> code</>,
          path: { kind: 'type2_dt', wnTs: 0.1, zeta: 0.7, loopDelay: 1 },
          code: { kind: 'white_pm_one' },
        },
        {
          label: (
            <>
              Type-II、低通 AR(1) <Tex>{r`\rho_x=0.98`}</Tex>
            </>
          ),
          path: { kind: 'type2_dt', wnTs: 0.1, zeta: 0.7, loopDelay: 1 },
          code: { kind: 'ar1', rho: 0.98 },
        },
      ]),
    [],
  )

  return (
    <Section kind="diagram" level={2} title="7.6 硬體成本與演算法比較：raw-x / delayed-x / filtered-x / 二次差分" id="ch07-hardware">
      <p>
        前面幾節各講一種 regressor。這一節把它們放回同一顆晶片裡：先看它們在 RTL 的位置，再比成本，最後用一張流程圖決定「我需要哪一種」。
      </p>
      <Mermaid
        chart={CHART_RTL_REGRESSORS}
        caption="四種 regressor 在 RTL 中的位置：同一個 GMAC，只差 regressor 從哪裡來（藍色的 REG_GMAC_XSEL 選擇；暫存器名稱為示意）。comparator 取的是 PD 的輸出，累加器的校正係數送回 reference 端的 DTC。"
      />
      <p>
        先看 code 往 DTC 走的那一路（reference 端的 DTC、PLL 誤差路徑、comparator）：DTC 在 reference 輸入端，它的補償量是 <Tex>{r`w_k\,x[n]`}</Tex>（DTC 只能延遲，所以 RTL
        送進 DTC 的數位 code 是把 <Tex>{r`w_k\,x[n]`}</Tex> 從一個固定的中心值往回扣——<Tex>{'x[n]'}</Tex> 越大，延遲越短；<ChRef ch="04">Ch04</ChRef>），補償之後留下 <Tex>{r`(a-w_k)\,x[n]`}</Tex>，經過 PLL 的誤差路徑、加上雜訊，成為 PD 的輸出
        <Tex>{r`e_{\mathrm{PD}}[n]`}</Tex>；comparator 取的就是這個 PD 輸出，也就是送進 loop filter 的同一個訊號。這部分四種做法完全相同，輸出是 <Tex>{'q[n]'}</Tex>。再看 code 分出去的四條支路：直接接線的 raw、shift register 加 tap
        MUX（7.3 節的 delay line）、模型 <Tex>{r`\hat H`}</Tex>（後面可再接一個延遲）、二次差分（7.5 節）。藍色的選擇器從四者中選一個，圖上它的輸出就是公式裡的
        <Tex>{r`x_{\mathrm{ref}}[n]`}</Tex>；GMAC 與更新式 <Tex>{r`w\leftarrow w+\mu G_k`}</Tex> 完全不用改，累加器的 <Tex>{'w_k'}</Tex> 送回 reference 端的 DTC。
      </p>
      <h3 className="ch07-subhead">
        硬體成本表（<Tex>{'B'}</Tex> = code 位元數，<Tex>{r`D_{\max}`}</Tex> = 最大延遲，<Tex>{r`L_{\mathrm{FIR}}`}</Tex> = FIR tap 數）
      </h3>
      <p>
        四種做法的成本差很多。先用一張階梯圖看全貌，再看表格的細節：
      </p>
      <Mermaid
        chart={CHART_COST_LADDER}
        caption="硬體成本階梯：每往後一階，額外硬體與需要事先知道的東西都變多，能修好的 code 也變廣（低頻 tone → 任意單頻 → 寬頻）；藍色的 filtered-x 是唯一能在 raw-x 失效的寬頻 code 上修好極性的做法。"
      />
      <p>
        順著箭頭一階一階看，每一格的四行依序是：做法、額外硬體、需要事先知道什麼、何時有效。先看第 0、1 階：raw-x 不花任何硬體；二次差分只多兩個暫存器，但只對 Type-II 迴路的低頻 tone
        有效。再看第 2、3 階：delayed-x 的成本隨 <Tex>{r`D_{\max}`}</Tex> 成長——7.3 節的 Type-II 例子要一百多級的 code FIFO；filtered-x 要乘法器，也要知道整個 <Tex>{r`\hat H`}</Tex>。圖上每一格對應下表的一列，表裡多了「失效模式」。
      </p>
      <div className="table-wrap">
        <table className="ch07-table">
          <thead>
            <tr>
              <th>做法</th>
              <th>GMAC regressor</th>
              <th>額外硬體</th>
              <th>需要知道什麼</th>
              <th>何時有效</th>
              <th>失效模式</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>raw-x</strong>
              </td>
              <td>
                <Tex>{'x[n]'}</Tex>
              </td>
              <td>無</td>
              <td>無</td>
              <td>
                code 頻帶上 <Tex>{r`|\angle H|<90^\circ`}</Tex>（例如高頻 DSM code，<Tex>{r`H_{\mathrm{PD}}\approx1`}</Tex>）
              </td>
              <td>
                低頻／窄頻 code 經 Type-II 後相位 <Tex>{r`\approx180^\circ\Rightarrow C<0`}</Tex>（<ChRef ch="06">Ch06</ChRef>）
              </td>
            </tr>
            <tr>
              <td>
                <strong>delayed-x</strong>
              </td>
              <td>
                <Tex>{'x[n-D]'}</Tex>
              </td>
              <td>
                <Tex>{r`D_{\max}\times B`}</Tex> 個 flip-flop 的 shift register + <Tex>{r`D_{\max}`}</Tex> 選 1 MUX + <code>REG_GMAC_DLY</code>
              </td>
              <td>
                主要 code 頻率的相位 <Tex>{r`\phi(\Omega_0)`}</Tex>
              </td>
              <td>窄頻 code（training tone、單一主譜線）</td>
              <td>
                寬頻 code；FCW、PVT、頻寬改變 <Tex>{'\\phi'}</Tex> 就要重找 <Tex>{'D'}</Tex>；延遲方向寫反（符號約定）
              </td>
            </tr>
            <tr>
              <td>
                <strong>filtered-x</strong>
              </td>
              <td>
                <Tex>{r`(\hat h*x)[n-D]`}</Tex>
              </td>
              <td>
                FIR：<Tex>{r`L_{\mathrm{FIR}}`}</Tex> 個乘法器 + adder tree；或 2 階 IIR（約 5 個乘法器 + 狀態暫存器）+ 係數暫存器
              </td>
              <td>
                <Tex>{r`\hat H`}</Tex>：<Tex>{r`\omega_n`}</Tex>、<Tex>{r`\zeta`}</Tex>、loop latency、<Tex>{r`K_{\mathrm{DCO}}`}</Tex>
              </td>
              <td>
                任何 code，只要被激勵頻帶上殘餘相位 <Tex>{r`|\angle H-\angle\hat H+\Omega D|<90^\circ`}</Tex>（<Tex>{'D=0'}</Tex> 時就是{' '}
                <span className="nowrap">
                  <Tex>{r`|\angle H-\angle\hat H|<90^\circ`}</Tex>；
                </span>
                充分條件，真正判據是 F-07.12 的加權積分 &gt; 0）
              </td>
              <td>
                模型誤差（尤其 latency，E45）；<Tex>{'D'}</Tex> 設錯（<Tex>{r`\hat H=H`}</Tex> 時要 <Tex>{'D=0'}</Tex>）；IIR 的定點 limit cycle 與 bit growth
              </td>
            </tr>
            <tr>
              <td>
                <strong>二次差分</strong>
              </td>
              <td>
                <Tex>{r`K_2\,(x[n]-2x[n-1]+x[n-2])`}</Tex>
              </td>
              <td>
                <Tex>{r`2\times B`}</Tex> flip-flop + 2 個加法器（<Tex>{'B+2'}</Tex> bit）+ 1 個左移；<Tex>{'K_2'}</Tex> 併入 <Tex>{'\\mu'}</Tex>
              </td>
              <td>
                只要知道是 Type-II（<Tex>{r`\hat\omega_n`}</Tex> 只影響增益）
              </td>
              <td>
                <strong>窄頻</strong>、低頻 tone（<Tex>{r`\Omega`}</Tex> 低於 F-07.15 的邊界，約 <Tex>{r`\omega_nT_s`}</Tex>）
              </td>
              <td>
                中頻 tone
                {band ? (
                  <>
                    （<Tex>{r`\omega_nT_s=0.1`}</Tex>、<Tex>{'d=0'}</Tex> 時 <Tex>{r`${tx(band.lo, 3)}\lesssim\Omega\lesssim${tx(band.hi, 2)}`}</Tex> rad/sample）
                  </>
                ) : null}
                ：相位差 <Tex>{r`>90^\circ`}</Tex>，極性反轉；寬頻 code（即使是低通 AR(1)）正負票幾乎抵消，<Tex>{'\\rho'}</Tex> 接近 0（F-07.16）
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 className="ch07-subhead">
        同一組場景，四種 regressor 的正規化相關 <Tex>{'\\rho'}</Tex>（7.4 節：越接近 1 越好，負值代表發散）
      </h3>
      <div className="table-wrap">
        <table className="ch07-table">
          <thead>
            <tr>
              <th>場景（unit-power code）</th>
              <th className="num">raw-x</th>
              <th className="num">
                delayed-x（最佳 <Tex>{'D'}</Tex>）
              </th>
              <th className="num">
                filtered-x <Tex>{r`\hat H=H`}</Tex>
              </th>
              <th className="num">二次差分</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td>{row.label}</td>
                <td className={`num ${signClass(row.raw, 1e-6)}`}>{fx(row.raw, 3)}</td>
                <td className={`num ${signClass(row.delayed, 1e-6)}`}>
                  {fx(row.delayed, 3)}（<Tex>{`D=${row.bestD}`}</Tex>）
                </td>
                <td className={`num ${signClass(row.filtered, 1e-6)}`}>{fx(row.filtered, 3)}</td>
                <td className={`num ${signClass(row.second, 1e-9)}`}>{Number.isFinite(row.second) ? fp(row.second, 3) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        由 <Tex>{r`\rho=C/\sqrt{E[x_{\mathrm{ref}}^2]E[u^2]}`}</Tex> 的封閉式計算；delayed-x 在 <Tex>{r`D\in[0,400]`}</Tex> 中取最大。單頻時 delayed-x 的 <Tex>{r`\rho=\cos\theta`}</Tex>：整數 <Tex>{'D'}</Tex> 一格是 <Tex>{'\\Omega'}</Tex>，最佳殘餘相位 <Tex>{r`|\theta|\le\Omega/2`}</Tex>，所以
        <Tex>{r`\rho\ge\cos(\Omega/2)`}</Tex>（低頻 tone 幾乎是 1，但 <Tex>{'D'}</Tex> 要夠長；<Tex>{r`\Omega=\pi/6`}</Tex> 時至少 <Tex>{r`\cos15^\circ=0.966`}</Tex>）。寬頻時只有 filtered-x（<Tex>{r`\hat H=H`}</Tex>、<Tex>{'D=0'}</Tex>）恆為 1。二次差分只在低頻 tone 接近 1，在中頻 tone 變號，在寬頻 code 接近 0（7.5 節）。<ClaimTag kind="exact" /> <SourceTag />
      </p>

      <h3 className="ch07-subhead">決策流程：我需要哪一種修法？</h3>
      <p>
        把上面兩張表濃縮成一張流程圖：能用便宜的就不用貴的，但每走一步都要確認相關的符號。
      </p>
      <Mermaid
        chart={CHART_DECISION}
        caption={r`決策流程：先確認 raw-x 的相關 $C$ 的符號；不行的話看 code 是不是窄頻（窄頻才能用二次差分或 delayed-x）；寬頻 code 用 filtered-x（藍色），而且一定要回頭檢查 $E[u\,u_f]$ 的符號（紅色：模型不對就修模型）。`}
      />
      <p>
        先看起點與第一個六角形：確認 raw-x 的 <Tex>{'C'}</Tex> 是正是負——可以用公式算，也可以在 bring-up 時量 GMAC 斜率（7.10 節）。<Tex>{r`C>0`}</Tex> 而且 <Tex>{r`\rho`}</Tex>
        不太小，就什麼都不用加（例如高頻的 MASH code）。再看第二個六角形：code 是窄頻才輪得到便宜的做法——低頻 tone 配 Type-II 用二次差分，其他窄頻 code 用 delayed-x（<Tex>{'D'}</Tex> 由 F-07.4 的
        <Tex>{r`D^\star`}</Tex> 取整數）。寬頻 code 直接走到藍色的 filtered-x，然後一定要過最後一個六角形：圖上問的 <Tex>{r`E[u\,u_f]>0`}</Tex> 就是 F-07.12 的積分（<Tex>{'D=0'}</Tex>；regressor 有額外延遲時問的是 <Tex>{r`C_{f,D}>0`}</Tex>）；不成立就走到紅色方塊修模型，最常見的原因是
        latency 算錯（E45）。綠色方塊是可以收工的終點；方向對了之後，還要到 <ChRef ch="08">Ch08</ChRef> 檢查 loop gain <Tex>{'g'}</Tex> 的穩定範圍。
      </p>

      <h3 className="ch07-subhead">核心程式碼並排：四種 regressor 只差一行</h3>
      <p>
        下面是本站實際執行的程式碼（<code>src/simulation/models/filteredX.ts</code>，Lab 的波形與相關性都用它算；測試確認它與閉迴路模擬
        <code>runBlockLms</code> 的 <Tex>{r`x_{\mathrm{ref}}`}</Tex> 逐點相同）。標記 <code>← 差異</code> 的那一行就是演算法的全部差別：
      </p>
      <CodeCompare
        items={[
          { label: 'raw-x', source: fxSrc, region: 'raw', path: 'src/simulation/models/filteredX.ts', note: '零成本；隱含假設誤差路徑沒有相位' },
          { label: 'delayed-x', source: fxSrc, region: 'delayed', path: 'src/simulation/models/filteredX.ts', note: '只補一個與頻率成正比的相位：只能對準一個頻率' },
          { label: 'filtered-x', source: fxSrc, region: 'filtered', path: 'src/simulation/models/filteredX.ts', note: '每個頻率都補上模型的振幅與相位' },
          { label: '二次差分', source: fxSrc, region: 'secondDiff', path: 'src/simulation/models/filteredX.ts', note: 'Type-II 的低頻近似模型，只用加法器與移位' },
        ]}
        caption="四個 region 的迴圈結構相同；GMAC 本身（7.4 節的 gmac region）完全不變。"
      />
      <ModeGate min="engineer">
        <h3 className="ch07-subhead">延遲方向的符號約定，在程式碼裡也只差一個正負號</h3>
        <CodeCompare
          items={[
            { label: '延遲 code（本站 $D$）', source: fxSrc, region: 'toneCorrCode', path: 'src/simulation/models/filteredX.ts', note: '殘餘相位加上延遲造成的相位' },
            { label: '延遲 comparator error', source: fxSrc, region: 'toneCorrError', path: 'src/simulation/models/filteredX.ts', note: '殘餘相位減去延遲造成的相位' },
          ]}
        />
        <CodeBlock
          source={fxSrc}
          region="toneCorrAtTheta"
          path="src/simulation/models/filteredX.ts"
          title={r`兩者共用的單頻相關（含 E46 的 $\Omega=0$、$\pi$ 邊界）`}
        />
      </ModeGate>
      <ModeGate min="research">
        <h3 className="ch07-subhead">對照：Python golden model（獨立實作，T07 的 golden vector 由它產生）</h3>
        <p className="small muted">
          <code>single_tone_corr</code>、<code>best_delay</code>、<code>tone_corr_time_domain</code> 與上面的 TypeScript 獨立撰寫；
          <code>filteredX.test.ts</code> 讀 <code>golden/vectors/T07.json</code> 交叉比對（容差 <Tex>{r`10^{-12}`}</Tex>）。
        </p>
        <CodeBlock source={pySrc} lang="python" path="golden/lms_pll_golden/polarity.py" title="golden/lms_pll_golden/polarity.py（§6–§7）" />
      </ModeGate>
    </Section>
  )
}
