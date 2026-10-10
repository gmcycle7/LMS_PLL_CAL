import { useDeferredValue, useMemo, useState } from 'react'
import { Callout, ModeGate, ParamControl, Section, SelectControl, StepDerivation, Tex, mathText } from '@/components'
import { gammaEff, gosConjectureScan } from '@/simulation/models/sspll'
import { FREF_MHZ, GOS_SCAN, LOOP_KEYS, LOOPS, PARAMS, PRED, WORKED, type LoopKey } from '../data'
import { Claim, DataTable, Formula, Kappa, ModelCompare, Sci, Src, fx, r, tx } from '../common'

const SCAN_LABEL: Record<string, string> = {
  L1: 'L1',
  L2: 'L2',
  L3: 'L3',
  L2_pm45: 'L2 PM 45°',
  L2_pm75: 'L2 PM 75°',
  L2_lat2: 'L2 延遲 2 拍',
  L3_pm45: 'L3 CT PM 45°',
  L3_pm55: 'L3 CT PM 55°',
  L3_halfT: 'L3 halfT 映射',
  L1_lat5_band: 'L1 延遲 5 拍（有反號帶）',
  L1_pole200M_band: 'L1 + 200 MHz 極點（有反號帶）',
}

/** 小工具：用 TS port 即時掃描「β = a/b（b ≤ bMax）的 12·C_GOS 有沒有負值」。這是數值檢查，不是證明。 */
function GosScanWidget() {
  const [loop, setLoop] = useState<LoopKey>('L2')
  const [variant, setVariant] = useState<'raw' | 'D:1'>('raw')
  const [bMax, setBMax] = useState(60)
  const d = useDeferredValue({ loop, variant, bMax })
  const res = useMemo(() => gosConjectureScan(gammaEff(LOOPS[d.loop], d.variant), d.bMax), [d])
  return (
    <div className="card">
      <p>
        <strong>自己掃一次</strong>（TS port 的 <code>gosConjectureScan</code>，精確公式 <Tex>{r`C=\sum_{k=1}^{b-1}\frac{\mathrm{Re}\,\Gamma_{\rm eff}(\mathrm{frac}(ka/b))}{4b^2\sin^2(\pi k/b)}`}</Tex>）：
      </p>
      <div className="cs-inline-controls">
        <SelectControl label="迴路" value={loop} onChange={setLoop} options={LOOP_KEYS} />
        <SelectControl
          label="相關器延遲"
          value={variant}
          onChange={setVariant}
          options={[
            { value: 'raw', label: 'D = 0（正確對齊）' },
            { value: 'D:1', label: 'D = +1（晚一拍）' },
          ]}
        />
        <ParamControl label={mathText('分母上限 $b_{\\max}$')} ariaLabel="分母上限 b_max" value={bMax} onChange={setBMax} min={4} max={160} integer clampOnBlur hint="golden 的離線掃描做到 1000" />
      </div>
      <p>
        掃了 <strong>{res.nBeta.toLocaleString()}</strong> 個最簡分數 <Tex>{r`\beta=a/b`}</Tex>（<Tex>{`b\\le${d.bMax}`}</Tex>）：負值 <strong className={res.nNegative ? 'cs-neg' : 'cs-pos'}>{res.nNegative}</strong> 個；最小的{' '}
        <Tex>{'12C'}</Tex> = <Kappa v={res.min12C} digits={6} tol={0} />，在 <Tex>{`\\beta=${res.at[0]}/${res.at[1]}`}</Tex>。
        {res.nNegative === 0
          ? '（沒有反例——但這只是有限掃描，不是證明。）'
          : d.variant === 'D:1'
            ? mathText('（相關器晚一拍時，near-grid 的 $\\beta$ 立刻反號：慢鋸齒 wrap 的那一拍被對到前一拍的 PD 響應。）')
            : mathText('（在正確對齊下找到負值：這是猜想的反例，請記下迴路與 $\\beta$ 並回報。）')}
      </p>
    </div>
  )
}

/** §7 GOS：鋸齒 regressor 的 Fourier 級數、near-grid 漸近式，以及「D = 0 不反號」的猜想。 */
export function S07Gos() {
  const rowNear = PRED.selected.L2.find((x) => x.alpha === 0.123)
  const scanRows = Object.entries(GOS_SCAN).filter(([k, v]) => !k.startsWith('_') && typeof v === 'object')
  return (
    <Section kind="formula" level={2} title="7. GOS：鋸齒 regressor" id="cs-7">
      <h3>7.1 Fourier 級數（一步一步）</h3>
      <StepDerivation
        steps={[
          {
            tex: r`\rho[n]=\mathrm{frac}(8\,\mathrm{frac}(n\alpha))=\mathrm{frac}(n\beta),\qquad \beta=\mathrm{frac}(8\alpha)`,
            why: <><Tex>{r`8\,\mathrm{frac}(n\alpha)`}</Tex> 與 <Tex>{r`8n\alpha`}</Tex> 只差 8 的整數倍，而 8 的整數倍不影響 frac。所以 <strong>GOS 只依賴 <Tex>{r`\beta`}</Tex></strong>。</>,
          },
          { tex: r`\mathrm{frac}(x)=\tfrac12-\textstyle\sum_{m\ge1}\frac{\sin(2\pi m x)}{\pi m}`, why: <>鋸齒波的 Fourier 級數（標準結果，可以對 <Tex>{'x'}</Tex> 在 <Tex>{'(0,1)'}</Tex> 上積分驗證）。</> },
          {
            tex: r`\sin\theta=\tfrac{1}{2j}\big(e^{j\theta}-e^{-j\theta}\big)\ \Rightarrow\ \lvert c_{\pm m}\rvert^2=\frac{1}{4\pi^2m^2}`,
            why: <>每個正弦拆成 <Tex>{r`\pm m\beta`}</Tex> 兩條線，各自的功率是 <Tex>{r`(1/2\pi m)^2`}</Tex>。</>,
          },
          { tex: r`C_{GOS}=\textstyle\sum_{m\ge1}\frac{\mathrm{Re}\,\Gamma_{\rm eff}(\mathrm{frac}(m\beta))}{2\pi^2m^2}`, why: <>代入 §4.3 的對角項公式。DC 項 <Tex>{'1/2'}</Tex> 乘上 <Tex>{r`\Gamma(0)=0`}</Tex>。</> },
          { tex: r`\textstyle\sum_{m\ge1}\frac{1}{2\pi^2m^2}=\frac{1}{2\pi^2}\cdot\frac{\pi^2}{6}=\frac1{12}=\mathrm{var}(\rho)`, why: <><Tex>{r`\sum 1/m^2=\pi^2/6`}</Tex>；權重加總恰好等於 <Tex>{r`\rho`}</Tex> 的變異數。</> },
        ]}
      />
      <Formula id="F-CS.11" />
      <p>
        <Claim kind="exact">
          <Tex>{r`\alpha`}</Tex> 為無理數時精確；有理數且 <Tex>{r`8\mid Q`}</Tex> 時，golden 的 exact periodic 與諧波和誤差 <Tex>{r`\le8.3\times10^{-10}`}</Tex>
        </Claim>
        正規化 <Tex>{r`\kappa_{GOS}=12C_{GOS}`}</Tex>，<Tex>{r`H\equiv1`}</Tex> 時為 1。另外 <Tex>{r`C(\beta)=C(1-\beta)`}</Tex>（譜線對稱），所以 <Tex>{'k/8'}</Tex> 兩側的<strong>線性</strong>行為相同。
      </p>
      <p>
        <strong>
          先算一次（L2，<Tex>{r`\alpha=0.137`}</Tex>，<Tex>{`\\beta=${tx(WORKED.d_beta, 3)}`}</Tex>）
        </strong>
        ：
      </p>
      <DataTable
        className="cs-num"
        head={[<Tex key="m">{'m'}</Tex>, '折到的頻率 [MHz]', <>權重 <Tex>{r`\frac{1}{2\pi^2m^2}`}</Tex></>, <Tex key="h">{r`\mathrm{Re}H_{PD}`}</Tex>, '貢獻']}
        rows={WORKED.d_terms.map((t) => [String(t.m), fx(t.f_MHz, 0), fx(t.w, 6), fx(t.ReH, 5), fx(t.contrib, 6)])}
      />
      <p>
        前 5 項得到 <Tex>{`12C=${tx(WORKED.d_partial5_12C, 4)}`}</Tex>，全部加起來是 <Tex>{`12C=${tx(WORKED.d_12C, 4)}`}</Tex>，restoring。基波 {fx(WORKED.d_terms[0].f_MHz, 0)} MHz 已經在反號帶（0–{fx(PARAMS.loops.L2.ReH_neg_bands_MHz[0][1], 1)} MHz）之外，而高次諧波會折回全頻帶，那裡大部分{' '}
        <Tex>{`\\mathrm{Re}H\\approx${tx(WORKED.d_terms[1].ReH, 2)}`}</Tex>–<Tex>{tx(WORKED.d_terms[WORKED.d_terms.length - 1].ReH, 2)}</Tex>。
      </p>
      <Src>
        golden 的 <code>worked_examples.json</code>；TS 的 <code>gosHarmonic</code> 在測試中重現到 <Tex>{r`2\times10^{-9}`}</Tex>。
      </Src>

      <h3>
        7.2 為什麼 GOS 在 <Tex>{'D=0'}</Tex> 時不反號（以及什麼時候會）
      </h3>
      <p>
        <strong>Near-grid</strong>（<Tex>{r`\alpha\approx k/8`}</Tex>，<Tex>{r`\beta\to0`}</Tex>）：<Tex>{r`\rho`}</Tex> 變成一個很慢的斜坡，每 <Tex>{r`1/\beta`}</Tex> 拍跳回 0 一次。時域推導（<Tex>{'s'}</Tex> = <Tex>{r`h_{PD}`}</Tex> 的步階響應，
        <Tex>{r`S_\infty=\sum_n s[n]`}</Tex>，<Tex>{r`S_D=\sum_{n<D}s[n]`}</Tex>）：
      </p>
      <Formula id="F-CS.12" />
      <ul>
        <li>
          <strong>Type-I</strong>：<Tex>{r`S_\infty=1/K`}</Tex>，所以 <Tex>{r`C\approx\beta/(2K)>0`}</Tex>。
        </li>
        <li>
          <strong>Type-II</strong>：<Tex>{r`H_{PD}`}</Tex> 在 DC 有雙零點，所以 <Tex>{r`S_\infty=0`}</Tex>。<Tex>{'D=0'}</Tex> 時第一項消失，剩下 <Tex>{r`C\approx\beta^2/K_i>0`}</Tex>，是一個 <strong>dead zone</strong>（很小但仍為正）。
        </li>
        <li>
          <strong>
            Type-II 且 <Tex>{'D=1'}</Tex>
          </strong>
          ：<Tex>{'S_1=s[0]=1'}</Tex>，所以 <Tex>{r`C\approx-\beta`}</Tex>，<strong>反號</strong>。
        </li>
      </ul>
      <DataTable
        className="cs-num"
        head={[<>檢查（<Tex>{r`\alpha=(1+\beta)/8`}</Tex>，<Tex>{r`\beta=1/P`}</Tex>）</>, ...PARAMS.gos_small_beta.L2.map((g) => <Tex key={g.P}>{`P=${g.P}`}</Tex>)]}
        rows={[
          [<>L2 <Tex>{'C'}</Tex>（exact，<Tex>{'D=0'}</Tex>）</>, ...PARAMS.gos_small_beta.L2.map((g) => <Sci key={g.P} v={g.C_D0} />)],
          [<>L2 <Tex>{r`\beta^2/K_i`}</Tex></>, ...PARAMS.gos_small_beta.L2.map((g) => <Sci key={g.P} v={g.asym_D0} />)],
          [<>L2 <Tex>{'C'}</Tex>（exact，<Tex>{'D=1'}</Tex>）</>, ...PARAMS.gos_small_beta.L2.map((g) => <span key={g.P} className={g.C_D1 < 0 ? 'cs-neg' : 'cs-pos'}><Sci v={g.C_D1} /></span>)],
          [<>L2 <Tex>{r`-\beta`}</Tex> 漸近</>, ...PARAMS.gos_small_beta.L2.map((g) => <Sci key={g.P} v={g.asym_D1} />)],
          [<>L1 <Tex>{'C'}</Tex>（exact）／<Tex>{r`\beta/(2K)`}</Tex></>, ...PARAMS.gos_small_beta.L1.map((g) => <span key={g.P}><Sci v={g.C_D0} />／<Sci v={g.asym_D0} /></span>)],
        ]}
      />
      <p>
        <Claim kind="exact">漸近式</Claim>
      </p>

      <h3>全域不反號是猜想</h3>
      <p>
        <Tex>{r`\mathrm{Re}H`}</Tex> 在一段頻帶內為負，所以 §9 的 PSD 定理不適用，只能靠數值。golden 的離線掃描對所有化簡後的 <Tex>{r`\beta=a/b`}</Tex>（<Tex>{r`b\le1000`}</Tex>）用精確公式檢查：
      </p>
      <DataTable
        className="cs-num"
        head={['迴路', '反號帶 [MHz]', '$\\beta$ 個數', '負值', <>最小 <Tex>{'12C'}</Tex></>, <>在 <Tex>{r`\beta`}</Tex></>]}
        rows={scanRows.map(([k, v]) => [
          SCAN_LABEL[k] ?? k,
          v.ReH_neg_band_MHz.length ? `0–${fx(v.ReH_neg_band_MHz[0][1], 2)}` : '無',
          v.n_beta.toLocaleString(),
          <strong key="n" className={v.n_negative ? 'cs-neg' : 'cs-pos'}>
            {v.n_negative}
          </strong>,
          <Sci key="m" v={v.min_12C} />,
          `${v.at[0]}/${v.at[1]}`,
        ])}
      />
      <Callout kind="warn" title="這是研究假說，不是定理">
        <p>
          <Claim kind="research" />
          在 <Tex>{'D=0'}</Tex>、raw regressor、線性化之下，GOS 對任何 <Tex>{r`\alpha`}</Tex> 都不反號。直覺是：鋸齒的功率按 <Tex>{r`1/m^2`}</Tex> 衰減，但諧波 <Tex>{r`m\beta`}</Tex> 折回後會均勻散布到全頻帶，而全頻帶上{' '}
          <Tex>{r`\mathrm{Re}H`}</Tex> 的平均值很大（§6.4）；近 DC 的負區只能「咬掉」<Tex>{r`\beta^2`}</Tex> 階的量。<strong>這不是證明</strong>。換迴路（更低 PM、更長延遲、寄生極點）時，請重新檢查。
        </p>
      </Callout>
      <GosScanWidget />
      <Callout kind="danger" title="注意：大訊號與 offset">
        <p>
          near-grid 的 GOS 小訊號恢復力只剩 <Tex>{`12C\\approx${rowNear ? tx(rowNear.kG_12C_ergodic, 2) : r`\text{—}`}`}</Tex>（L2，<Tex>{r`\alpha=0.123`}</Tex>，{fx(0.123 * FREF_MHZ, 0)} MHz）。大訊號時它是<strong>反向</strong>的（
          <Tex>{`\\kappa_\\infty=${rowNear ? tx(rowNear.LS_kinf_worst, 3) : r`\text{—}`}`}</Tex>，§10），而比較器 offset 也很容易把它推進大訊號區（§13）。
        </p>
      </Callout>
      <ModeGate min="engineer">
        <ModelCompare
          items={[
            { label: 'GOS：ergodic 諧波和', region: 'gosHarmonic', note: '無理數 $\\alpha$：$\\sum_m\\mathrm{Re}\\,\\Gamma(\\mathrm{frac}(m\\beta))/(2\\pi^2m^2)$ + 尾項。' },
            { label: 'GOS：有理數 $\\beta$ 的精確式', region: 'gosRational', note: '猜想掃描用：每條 DFT 線的功率 $1/(4b^2\\sin^2(\\pi k/b))$。' },
          ]}
        />
      </ModeGate>
    </Section>
  )
}
