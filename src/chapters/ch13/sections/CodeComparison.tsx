import { useMemo } from 'react'
import { ClaimTag, CodeBlock, CodeCompare, Mermaid, ModeGate, Section, Tex } from '@/components'
import quantSrc from '@/simulation/models/quantizer.ts?raw'
import pySrc from '../../../../golden/lms_pll_golden/quantization.py?raw'
import { STRATEGY_LABEL, runQuantLab } from '@/simulation/models/quantizer'
import { DEFAULT_LAB_PARAMS, Fold, SpurAt, Unit, fx, num } from '../common'
import { CHART_FIVE_STRATEGIES, CHART_POWER_SPLIT } from '../diagrams'

const PATH = 'src/simulation/models/quantizer.ts'
const CMP_LEN = 8000

const HW: Record<string, { state: string; cost: string }> = {
  freeze: { state: '無（一個暫存器）', cost: '最低；不切換' },
  toggle: { state: '模 togglePeriod 的計數器 + pattern 邏輯', cost: '低；固定週期' },
  stochastic: { state: 'PRBS / 亂數產生器 + 比較器', cost: '中；需亂數源' },
  deltaSigma: { state: '（整數 + 小數 bit 寬的）加法器 + 誤差暫存器 s.r', cost: '低；一個累加器' },
  deltaSigmaDither: { state: 'ΔΣ 累加器 + PRBS dither', cost: '中；累加器 + 亂數源' },
}

export function CodeComparison() {
  const rows = useMemo(() => {
    // L = 8000 = 1600 個完整週期：B、D 的平均與功率是精確值（不是 O(1/L) 近似）
    const lab = runQuantLab({ params: { ...DEFAULT_LAB_PARAMS, mixing: false, length: CMP_LEN }, cases: [], compareAll: true, compareScenario: { lmsNoise: false, nUpd: 1 } })
    return lab.compare
  }, [])

  return (
    <Section kind="example" title="核心程式碼並排：五種策略只差在哪幾行？" level={2} id="ch13-code">
      <p>
        下面就是網站實際執行的程式碼（<code>{PATH}</code>，以 <code>?raw</code> 匯入、<code>#region core:*</code> 擷取）。五個函式有相同的介面
        <code>(W, s, c) → y</code>：<code>W</code> 是以 <Tex>{'1/D'}</Tex> LSB 為單位的整數 <Tex>{'w_H[n]'}</Tex>，<code>s</code> 是狀態，<code>c</code> 是設定。標記
        <code>← 差異</code> 的行就是它們真正不同的地方。
      </p>
      <Mermaid
        chart={CHART_FIVE_STRATEGIES}
        caption="五種策略並排。先看中間一欄：五個方塊的差別只在「送進共用量化器的 $v$ 是什麼」；再看藍色的 D、E：只有它們有從輸出拉回來的虛線（誤差回授）。計數器只給 B，亂數只給 C 與 E。"
      />
      <p className="small ch13-figwalk">
        圖上每個方塊裡的 <Tex>{'v'}</Tex> 就是程式碼裡送進 <code>quantize()</code> 的那個值（A 的 <code>s.wFreeze</code>、B / C 的 <code>(lo + bit) * c.D</code>、D 的 <code>W + s.r</code>、E 的 <code>V + d</code>）；圖上回授線的{' '}
        <Tex>{'r[n]=v-y'}</Tex> 就是 D、E 最後存回 <code>s.r</code> 的那一行。下面的程式碼分頁照同樣的順序排，標記 <code>← 差異</code> 的行對應圖上各方塊不同的地方。
      </p>
      <CodeCompare
        items={[
          { label: 'A Freeze', source: quantSrc, region: 'freezeStep', path: PATH, note: '只量化凍結當下存進 s.wFreeze 的目標值，之後完全忽略輸入 W（內部高解析係數）。' },
          { label: 'B Toggle', source: quantSrc, region: 'toggleStep', path: PATH, note: '開迴路：相位只由計數器 s.n 決定；小數部分先被四捨五入成「togglePeriod 分之 k」，所以解析度有限。' },
          { label: 'C Stochastic', source: quantSrc, region: 'stochasticStep', path: PATH, note: '以亂數決定進位；平均正確、誤差白色。' },
          { label: 'D ΔΣ', source: quantSrc, region: 'deltaSigmaStep', path: PATH, note: '把上次的量化誤差 s.r 加回來（error feedback），再把這次的誤差存回 s.r。' },
          { label: 'E ΔΣ+dither', source: quantSrc, region: 'deltaSigmaDitherStep', path: PATH, note: '與 D 只差兩行：量化前多加一個 dither 樣本 d，但存回 s.r 的誤差不含 d。' },
        ]}
        caption="D 與 E 的差別只有兩行；B 與 D 的差別在「有沒有誤差回授」。常數 32.4 時 B 與 D 卻輸出同一個循環（§13.4）。"
      />
      <Fold title={<>共用的量化器 <Tex>{'Q_B'}</Tex> 與 <Tex>{'r'}</Tex> 暫存器：整數運算讓 tie 判斷完全精確（勘誤 E15）</>}>
        <CodeBlock source={quantSrc} region="quantize" path={PATH} caption="rational / fixed 模式下 $V$、$D$ 都是整數；float 模式 $D=1$（用來示範 tie 被浮點誤差翻轉）。" />
        <CodeBlock
          source={quantSrc}
          region="residual"
          path={PATH}
          caption="D、E 存回 s.r 之前經過的 residual()：wrap 時硬體丟掉的進位不會留在 $r$ 裡；anti-windup 則把 $r$ 夾回正常範圍（§13.6）。"
        />
      </Fold>
      <ModeGate min="engineer">
        <Fold title="亂數來源：PRBS（LFSR）與 dither">
          <CodeBlock source={quantSrc} region="prbs" path={PATH} />
          <CodeBlock source={quantSrc} region="dither" path={PATH} />
        </Fold>
        <Fold title="解析週期與譜線：efbPeriod、lineSpectrum、zohWeight">
          <CodeBlock source={quantSrc} region="efbPeriod" path={PATH} />
          <CodeBlock source={quantSrc} region="lineSpectrum" path={PATH} />
          <CodeBlock source={quantSrc} region="zohWeight" path={PATH} />
        </Fold>
      </ModeGate>
      <ModeGate min="research">
        <Fold title="Python golden（精確 Fraction 運算；T16/T17 的交叉比對來源）" openFrom="research">
          <CodeBlock
            source={pySrc}
            lang="python"
            path="golden/lms_pll_golden/quantization.py"
            caption="Vitest 讀 golden/vectors/T16.json、T17.json、quantizer_first_order.json，逐點比對 TypeScript 的整數運算結果。"
          />
        </Fold>
      </ModeGate>

      <h3>演算法比較表（常數 <Tex>{String.raw`w_H=32.4`}</Tex>，同一 seed）</h3>
      <Mermaid
        chart={CHART_POWER_SPLIT}
        caption={String.raw`同樣的功率、不同的頻率分布。先看上面一組：只用 32 與 33 的方法（B、C、常數輸入的 D）總誤差功率都是 $0.24\,\mathrm{LSB}^2$，差別只在它落在兩條譜線還是攤平成白色；再看下面兩條：A 的功率較小但全在 DC，E 的總功率較大但沒有譜線。`}
      />
      <p className="small ch13-figwalk">
        圖上的 <Tex>{'p(1-p)'}</Tex> 就是 §13.3 公式 F-13.6 的變異數，兩條譜線的數字是 §13.2 的 <Tex>{'P_1'}</Tex>、<Tex>{'P_2'}</Tex>，「被 <Tex>{String.raw`1-z^{-1}`}</Tex> 推到高頻」是 §13.4 的 NTF。這張圖就是本章的主旨「平均正確{' '}
        <Tex>{String.raw`\ne`}</Tex> 頻譜理想」；下表把同一件事用模擬的數字再列一次（「總誤差功率」「最大譜線」「頻帶內」三欄）。
      </p>
      <div className="table-wrap">
        <table className="ch13-table ch13-table-wide" aria-label="五種量化策略在常數 32.4 下的比較：平均、DC 誤差、功率、譜線、週期與硬體成本">
          <thead>
            <tr>
              <th>策略</th>
              <th>
                平均 code <Tex>{String.raw`\overline y`}</Tex>
              </th>
              <th>
                DC 誤差 <Tex>{String.raw`\delta w`}</Tex> <Unit>{'LSB'}</Unit>
              </th>
              <th>
                總誤差功率 <Unit>{'LSB^2'}</Unit>
              </th>
              <th>
                頻帶內（<Tex>{'f<f_u/64'}</Tex>）
              </th>
              <th>
                最大譜線 <Unit>{'LSB^2'}</Unit>
              </th>
              <th>週期</th>
              <th>code 階數</th>
              <th>切換率</th>
              <th>需要的硬體狀態</th>
              <th>成本</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.strategy}>
                <td className="nowrap">{STRATEGY_LABEL[r.strategy]}</td>
                <td>{fx(r.metrics.meanCode, 4)}</td>
                <td>{fx(r.metrics.dcError, 4)}</td>
                <td>{fx(r.metrics.errPower, 4)}</td>
                <td>{r.metrics.lfErrPower < 1e-20 ? '0' : num(r.metrics.lfErrPower, 3)}</td>
                <td>{r.metrics.maxSpur ? <SpurAt power={r.metrics.maxSpur.power} fRel={r.metrics.maxSpur.f / r.fu} digits={4} /> : '—'}</td>
                <td>{r.metrics.period || '無'}</td>
                <td>{r.metrics.levels}</td>
                <td>{fx(r.metrics.toggleRate, 3)}</td>
                <td>{HW[r.strategy].state}</td>
                <td>{HW[r.strategy].cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        由 <code>runQuantLab()</code> 以 {CMP_LEN} 次更新即時計算（功率單位 <Tex>{String.raw`\mathrm{LSB}^2`}</Tex>、DC 誤差依 <Tex>{String.raw`\delta w=w-w^*`}</Tex> 約定）。C、E 的數值是有限樣本估計（
        <ClaimTag kind="approx" />
        ；頻帶內為 Welch 估計、譜線需通過統計顯著檢定），A、B、D 為精確值（<ClaimTag kind="exact" />；頻帶內由一個週期的精確線譜加總）。「頻帶內」={' '}
        <Tex>{String.raw`\mathrm{DC}^2+\int_0^{f_u/64}S_e\,df`}</Tex>，代表會直接當成 static / 慢變 gain error 的部分。
      </p>
    </Section>
  )
}
