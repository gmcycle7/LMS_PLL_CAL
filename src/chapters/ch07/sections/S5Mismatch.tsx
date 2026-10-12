import { useMemo, type ReactNode } from 'react'
import type { Data } from 'plotly.js-dist-min'
import { Callout, ClaimTag, Mermaid, ModeGate, Plot, Section, SourceTag, Tex, TexBlock } from '@/components'
import {
  analyticCorr,
  buildHat,
  HAT_EXACT,
  logOmegaGrid,
  pathTransfer,
  phaseProfile,
  type FxCodeSpec,
  type FxHatSpec,
  type FxPathSpec,
} from '@/simulation/models/filteredX'
import { cArg, wrap180 } from '@/simulation/core'
import { freqz } from '@/simulation/signal'
import { CHART_LATENCY_MISMATCH, CHART_MISMATCH } from '../diagrams'
import { FoldSteps } from '../FoldSteps'
import { ErratumNote } from '../ErratumNote'
import { Hand } from '../Hand'
import { S5SecondDiff } from './S5SecondDiff'
import { DEG, fp, fx, kq, signClass, tx, txs } from '../util'

const r = String.raw
const TONE_PATH: FxPathSpec = { kind: 'single_tone', magnitude: 1, phaseDeg: -120, omega: Math.PI / 6 }
const TONE_CODE: FxCodeSpec = { kind: 'sinusoid', omega: Math.PI / 6 }
const TYPE2: FxPathSpec = { kind: 'type2_dt', wnTs: 0.1, zeta: 0.7, loopDelay: 1 }

/** §7.5：模型誤差（E45）——E[u u_f] 的 PSD 公式、逐頻率 90° 條件、失效例子、二次差分。 */
export function S5Mismatch() {
  // ── 失效例子：單頻 Ω = π/6，Ĥ = H·z^{−Δ} ──
  const latency = useMemo(() => {
    const H = pathTransfer(TONE_PATH)
    const Kq = kq(100)
    const om = [Math.PI / 6]
    const phH = cArg(freqz(H.b, H.a, om)[0])
    // 誤用 E[u²] 的 pole：E[u²] 與 Δ 無關
    const eu2 = analyticCorr({ code: TONE_CODE, h: H, g: H, D: 0 }) as number
    return Array.from({ length: 7 }, (_, d) => {
      const hat = buildHat(TONE_PATH, { ...HAT_EXACT, extraDelay: d }, TONE_CODE)
      const c = analyticCorr({ code: TONE_CODE, h: H, g: hat.full, D: 0 }) as number
      // ∠Ĥ − ∠H 由兩個濾波器的 freqz 計算（−180° 顯示為 −180°，不 wrap 成 +180°）
      const errWrapped = wrap180((cArg(freqz(hat.full.b, hat.full.a, om)[0]) - phH) * DEG)
      const err = errWrapped > 1e-9 ? errWrapped - 360 : errWrapped
      return { d, err, c, p: 1 - 10 * Kq * c, pWrong: 1 - 10 * Kq * eu2 }
    })
  }, [])

  // ── 逐頻率相位差：Type-II（d = 1）與幾種 Ĥ ──
  const prof = useMemo(() => {
    const H = pathTransfer(TYPE2)
    const om = logOmegaGrid(1e-3, 500)
    // key：查表用的識別字；trace：圖例名稱（數學寫成 `$...$`，Plot 元件轉成斜體符號與上下標）
    const variants: { key: string; trace: string; label: ReactNode; hat: FxHatSpec }[] = [
      { key: 'exact', trace: r`$\hat H = H$`, label: <Tex>{r`\hat H=H`}</Tex>, hat: HAT_EXACT },
      { key: 'bw+50', trace: '頻寬 +50%', label: <>頻寬誤差 <Tex>{r`\hat\omega_n=1.5\,\omega_n`}</Tex></>, hat: { ...HAT_EXACT, bwErrPct: 50 } },
      { key: 'bw-40', trace: '頻寬 −40%', label: <>頻寬誤差 <Tex>{r`\hat\omega_n=0.6\,\omega_n`}</Tex></>, hat: { ...HAT_EXACT, bwErrPct: -40 } },
      { key: 'latency-miss-1', trace: r`模型漏算 1 sample latency（$\hat d = 0$）`, label: <>模型漏算 1 sample loop latency（<Tex>{r`\hat d=0`}</Tex>）</>, hat: { ...HAT_EXACT, loopDelayErr: -1 } },
      { key: 'extra-3', trace: r`多算 3 sample（$z^{-3}$）`, label: <>多算 3 sample（<Tex>{r`\hat H=Hz^{-3}`}</Tex>）</>, hat: { ...HAT_EXACT, extraDelay: 3 } },
      { key: 'second-diff', trace: r`二次差分 $\hat H_2$`, label: <>二次差分 <Tex>{r`\hat H_2`}</Tex></>, hat: { ...HAT_EXACT, base: 'second_diff' } },
    ]
    const data: Data[] = variants.map((v) => {
      const hat = buildHat(TYPE2, v.hat, { kind: 'white_pm_one' })
      const p = phaseProfile({ h: H, g: hat.full, D: 0, omega: om })
      return { x: Array.from(om), y: Array.from(p.thetaDeg), name: v.trace, mode: 'lines' }
    })
    const band = (y: number) => ({ type: 'line' as const, xref: 'paper' as const, x0: 0, x1: 1, y0: y, y1: y, line: { dash: 'dash' as const, width: 1 } })
    // 白色 ±1 code 下各 Ĥ 的 E[u·u_f]
    const white: FxCodeSpec = { kind: 'white_pm_one' }
    const lp: FxCodeSpec = { kind: 'ar1', rho: 0.98 }
    // ρ = E[u·u_f]/√(E[u²]E[u_f²])：不同 Ĥ 的增益不同，只有正規化後才能比較
    const rhoOf = (code: FxCodeSpec, g: { b: number[]; a: number[] }) => {
      const c = analyticCorr({ code, h: H, g, D: 0 }) as number
      const eu2 = analyticCorr({ code, h: H, g: H, D: 0 }) as number
      const euf2 = analyticCorr({ code, h: g, g, D: 0 }) as number
      return { c, rho: c / Math.sqrt(eu2 * euf2) }
    }
    const table = variants.map((v) => {
      const hat = buildHat(TYPE2, v.hat, white)
      const w = rhoOf(white, hat.full)
      const l = rhoOf(lp, hat.full)
      return { key: v.key, label: v.label, white: w.c, whiteRho: w.rho, lowpass: l.c, lowpassRho: l.rho }
    })
    const row = (key: string) => table.find((t) => t.key === key) as (typeof table)[number]
    return { data, shapes: [band(90), band(-90)], table, row }
  }, [])

  return (
    <Section kind="assumptions" level={2} title="7.5 模型不準怎麼辦？Filtered-x 的極性條件（E45）" id="ch07-mismatch">
      <p>
        Filtered-x 的保證 <Tex>{r`E[u^2]\ge0`}</Tex> 只在 <Tex>{r`\hat H=H`}</Tex> 時成立。實際的 <Tex>{r`\hat H`}</Tex> 是設計者對 PLL 的<strong>模型</strong>：
        loop bandwidth 隨 PVT 漂移、DCO gain <Tex>{r`K_{\mathrm{DCO}}`}</Tex> 估錯、pipeline latency 少算一拍……{' '}
        <ErratumNote id="E45">
          規格只給了 <Tex>{r`\hat H=H`}</Tex> 的情形；有模型誤差時，analytic pole 必須用 <Tex>{r`E[u\,u_f]`}</Tex>。
        </ErratumNote>
      </p>
      <Mermaid
        chart={CHART_MISMATCH}
        caption={r`模型誤差：同一個 code 走真實路徑 $H$ 與藍色的模型 $\hat H$，GMAC 等效在算兩者輸出的相關 $E[u\,u_f]$。每個頻率的票是正是負，看 $H$ 與 $\hat H$ 在那個頻率的相位差有沒有超過 $90^\circ$。`}
      />
      <p>
        先看 code 分出去的兩路：一路是真實的誤差路徑 <Tex>{'H'}</Tex>，它的輸出 <Tex>{'u[n]'}</Tex> 藏在 comparator 的 <Tex>{'q[n]'}</Tex> 裡；另一路是藍色的模型
        <Tex>{r`\hat H`}</Tex>，它的輸出 <Tex>{'u_f[n]'}</Tex> 是 GMAC 的 regressor。再看後半段：GMAC 的平均等效在算 <Tex>{r`E[u\,u_f]`}</Tex>，把它拆到每個頻率就是「每個頻率一票」——
        圖上那個方塊裡的 <Tex>{r`S_{xx}|H||\hat H|\cos(\angle H-\angle\hat H)`}</Tex>，正是下面 F-07.12 的被積函數。振幅 <Tex>{r`|\hat H|`}</Tex> 只改變票的重量，
        相位差 <Tex>{r`\angle H-\angle\hat H`}</Tex> 才決定票的正負；六角形問的就是下面定理的條件。
      </p>
      <FoldSteps
        title={<>一般情形：<Tex>{r`E[u\,u_f]`}</Tex> 的時域與頻域形式</>}
        steps={[
          { tex: r`E[u\,u_f]=E\Big[\sum_kh[k]x[n-k]\sum_l\hat h[l]x[n-l]\Big]`, why: <>兩個卷積相乘（<Tex>{r`u=h*x`}</Tex>、<Tex>{r`u_f=\hat h*x`}</Tex>，同一個 code）。</> },
          { tex: r`=\sum_k\sum_l h[k]\,\hat h[l]\,R_x[k-l]`, why: <>期望值線性；<Tex>{r`E[x[n-k]x[n-l]]=R_x[k-l]`}</Tex>。</> },
          {
            // S_xx 不寫引數（和下一行、F-07.12 相同）：寫成 S_xx(e^{jΩ}) 時在手機（375 px）上只比欄位寬 4 px，會多出一條沒有用途的橫向捲軸
            tex: r`=\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}\,H(e^{j\Omega})\,\overline{\hat H(e^{j\Omega})}\,d\Omega`,
            why: (
              <>
                代入 <Tex>{r`R_x[m]=\frac1{2\pi}\int S_{xx}e^{j\Omega m}d\Omega`}</Tex>：<Tex>{'k'}</Tex> 的和收成 <Tex>{r`\overline{H}`}</Tex>、
                <Tex>{'l'}</Tex> 的和收成 <Tex>{r`\hat H`}</Tex>；再代換 <Tex>{r`\Omega\to-\Omega`}</Tex>（<Tex>{r`S_{xx}`}</Tex> 偶對稱、
                <Tex>{r`H(e^{-j\Omega})=\overline{H(e^{j\Omega})}`}</Tex>）得到 <Tex>{r`H\,\overline{\hat H}`}</Tex>。
              </>
            ),
          },
          {
            tex: r`=\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}\,|H|\,|\hat H|\cos\!\big(\angle H-\angle\hat H\big)\,d\Omega`,
            why: (
              <>
                結果是實數（虛部在 <Tex>{r`\pm\Omega`}</Tex> 抵消），<Tex>{r`\mathrm{Re}\{H\overline{\hat H}\}=|H||\hat H|\cos(\angle H-\angle\hat H)`}</Tex>。
              </>
            ),
          },
        ]}
      />
      <TexBlock id="F-07.12" label="模型誤差下的有效相關（E45）">
        {r`E[u\,u_f]=\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}\,|H|\,|\hat H|\cos\!\big(\angle H-\angle\hat H\big)\,d\Omega\;\overset{\hat H=H}{=}\;E[u^2]\ge0`}
      </TexBlock>
      <Callout kind="ok" title="定理（充分條件）">
        <p>
          若在所有 <Tex>{r`S_{xx}|H||\hat H|>0`}</Tex> 的頻率上都有 <Tex>{r`|\angle H-\angle\hat H|<90^\circ`}</Tex>，則
          <Tex>{r`E[u\,u_f]>0`}</Tex>：被積函數處處 <Tex>{r`\ge0`}</Tex>，而且至少在一段有 code 能量的頻帶（或一條譜線）上 <Tex>{r`>0`}</Tex>，
          積分（面積）就一定是正的。<ClaimTag kind="exact" />
        </p>
        <p className="small">
          這不是必要條件：只要加權積分為正就好，少數頻率超過 <Tex>{r`90^\circ`}</Tex> 可以被其他頻率「投票」蓋過。真正的判據就是積分本身——Lab 會直接算它。
          <strong>振幅誤差不會改變極性</strong>（只改變 <Tex>{'g'}</Tex>，影響速度與 <Tex>{r`g<2`}</Tex> 的穩定邊界）；危險的是<strong>相位誤差</strong>。
        </p>
      </Callout>
      <ModeGate min="research">
        <p className="small muted">
          文獻脈絡：「模型相位誤差小於 <Tex>{r`90^\circ`}</Tex>」是 Filtered-x LMS 的經典穩定條件，最早出現在主動噪音控制（ANC）的 secondary-path 分析——D. R. Morgan,
          “An analysis of multiple correlation cancellation loops with a filter in the auxiliary path,” <em>IEEE Trans. ASSP</em>, 1980；B. Widrow, D. Shur, S. Shaffer,
          “On adaptive inverse control,” <em>Asilomar Conf.</em>, 1981；J. C. Burgess, “Active adaptive sound control in a duct: A computer simulation,” <em>J. Acoust. Soc. Am.</em>, 1981；整理見 S. M. Kuo
          與 D. R. Morgan, “Active noise control: a tutorial review,” <em>Proc. IEEE</em>, 1999。那些結果是針對線性（多 bit）誤差訊號的慢速適應極限推導的；本章把同一個論證搬到
          1-bit comparator（誤差只剩正負號，增益換成 <Tex>{'K_q'}</Tex>）與 block 累加的 GMAC，上面的推導與 Monte Carlo 是本站自己的驗證，不是引用文獻的數值。{' '}
          <SourceTag kind="literature" /> <ClaimTag kind="research" />
        </p>
      </ModeGate>

      <h3 className="ch07-subhead">
        失效例子：<Tex>{r`\hat H`}</Tex> 多算了 <Tex>{'\\Delta'}</Tex> 個 sample 的 latency
      </h3>
      <p>
        模型最容易錯的地方是 latency：迴路裡的 pipeline 拍數多算或少算，模型的輸出就比真實路徑晚或早幾個 sample。先看多算的情形：
      </p>
      <Mermaid
        chart={CHART_LATENCY_MISMATCH}
        caption={r`失效例子：模型比真實路徑多了一個紅色的延遲（多算 $\Delta$ 個 sample 的 latency）。這和 7.1 節的相位記帳是同一件事，只是這次的延遲不是補償，而是誤差。`}
      />
      <p>
        先看經過真實路徑的那一路：相位加 <Tex>{r`\phi`}</Tex>。再看模型那一路：模型裡的 <Tex>{'H'}</Tex> 也加 <Tex>{r`\phi`}</Tex>（這部分是對的），但後面多了紅色的
        <Tex>{r`z^{-\Delta}`}</Tex>（<Tex>{r`\Delta`}</Tex> 是模型多算的 sample 數），相位又被減掉 <Tex>{r`\Omega\Delta`}</Tex>。相乘再平均之後共同的部分消掉，只剩
        <Tex>{r`\angle H-\angle\hat H=\Omega\Delta`}</Tex>——圖上最後那個紅色方塊，就是下表每一列在算的 <Tex>{r`E[u\,u_f]=|H|^2\cos(\Omega\Delta)`}</Tex>。
      </p>
      <p>
        回到 T07 的單頻例子（<Tex>{r`\Omega=30^\circ`}</Tex>，<Tex>{r`|H|=1`}</Tex>、<Tex>{r`\phi=-120^\circ`}</Tex>，unit-power code
        <Tex>{r`A^2/2=1`}</Tex>），用 <Tex>{r`\hat H=H\,z^{-\Delta}`}</Tex>：相位差 <Tex>{r`\angle H-\angle\hat H=\Omega\Delta`}</Tex>，所以
        <Tex>{r`E[u\,u_f]=|H|^2\cos(\Omega\Delta)`}</Tex>。下表即時計算；最後一欄是誤用 <Tex>{r`E[u^2]`}</Tex> 會報告的 pole（錯的）：
      </p>
      <div className="table-wrap">
        <table className="ch07-table">
          <thead>
            <tr>
              <th className="num">
                <Tex>{'\\Delta'}</Tex>
              </th>
              <th className="num">
                <Tex>{r`\angle\hat H-\angle H`}</Tex>
              </th>
              <th className="num">
                <Tex>{r`E[u\,u_f]`}</Tex>
              </th>
              <th className="num">
                正確 pole <Tex>{r`p_f`}</Tex>
              </th>
              <th className="num">
                誤用 <Tex>{r`E[u^2]`}</Tex> 的 pole
              </th>
              <th>結果</th>
            </tr>
          </thead>
          <tbody>
            {latency.map((row) => (
              <tr key={row.d} className={row.c < -1e-9 ? 'ch07-row-bad' : ''}>
                <td className="num">{row.d}</td>
                <td className="num">{fx(row.err, 0)}°</td>
                <td className={`num ${signClass(row.c)}`}>{fx(row.c, 4)}</td>
                <td className="num">{fx(row.p, 5)}</td>
                <td className="num">{fx(row.pWrong, 5)}</td>
                <td>{row.d === 0 ? '收斂（模型完美，基準）' : row.c > 1e-9 ? '收斂（變慢）' : row.c < -1e-9 ? 'filtered-x 也發散' : '沒有恢復力（漂移）'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        <Tex>{r`\mu=10\ \mathrm{fs}`}</Tex>、<Tex>{r`\sigma_v=100\ \mathrm{fs}`}</Tex>。<Tex>{r`\Delta=4`}</Tex> 時 <Tex>{r`E[u\,u_f]=\cos120^\circ=-0.5`}</Tex>：
        filtered-x 一樣反向更新，而用 <Tex>{r`E[u^2]`}</Tex> 算的 pole 仍會顯示「穩定」——這正是 E45 要避免的「UI 顯示成功、模型其實錯」。
        閉迴路驗證見 Lab 的 preset「E45：<Tex>{r`\hat H`}</Tex> 多算 latency」。 <ClaimTag kind="exact" /> <SourceTag />
      </p>
      <Hand id="HC-07.6">
        上表的任何一列都可以用手算重現：預設值是 <Tex>{r`\Delta=4`}</Tex> 那一列。把 <Tex>{r`\Delta`}</Tex>、<Tex>{r`\Omega`}</Tex> 或增益比
        <Tex>{r`r=|\hat H|/|H|`}</Tex> 換成你自己的數字，先用計算機算出 <Tex>{r`E[u\,u_f]`}</Tex> 和兩個 pole（正確的、誤用 <Tex>{r`E[u^2]`}</Tex> 的），再對答案——
        注意增益誤差改不了符號，相位誤差才會。
      </Hand>

      <ModeGate min="engineer">
        <h3 className="ch07-subhead">Type-II 迴路：哪一種模型誤差最危險？</h3>
        <p>
          下圖是 E44 的 DT Type-II 迴路（<Tex>{r`\omega_nT_s=0.1`}</Tex>、<Tex>{r`\zeta=0.7`}</Tex>、<Tex>{'d=1'}</Tex>）的逐頻率相位差
          <Tex>{r`\angle H-\angle\hat H`}</Tex>，虛線是 <Tex>{r`\pm90^\circ`}</Tex>。表格是兩種 unit-power code 下的 <Tex>{r`E[u\,u_f]`}</Tex>
          與正規化相關 <Tex>{r`\rho_{\mathrm{ref}}=E[u\,u_f]/\sqrt{E[u^2]E[u_f^2]}`}</Tex>（7.4 節）——各 <Tex>{r`\hat H`}</Tex> 的增益不同（二次差分的增益約 100 倍），
          <Tex>{r`E[u\,u_f]`}</Tex> 的大小不能直接比，只有符號與 <Tex>{r`\rho_{\mathrm{ref}}`}</Tex> 可以比：
        </p>
        <Plot
          title={r`$\angle H-\angle\hat H$（Type-II DPLL，$\omega_nT_s=0.1$、$\zeta=0.7$、$d=1$）`}
          data={prof.data}
          layout={{
            xaxis: { title: { text: r`$\Omega$ [rad/sample]（log）` } },
            yaxis: { title: { text: '相位差 [deg]' }, range: [-185, 185], dtick: 45 },
            shapes: prof.shapes,
          }}
          xLog
          height={340}
          csvName="ch07-phase-mismatch"
          caption={r`由 freqz($H$)、freqz($\hat H$) 計算；超出 $\pm90^\circ$ 的頻帶若有 code 能量，就會對 $E[u\,u_f]$ 投負票`}
        />
        <div className="table-wrap">
          <table className="ch07-table">
            <thead>
              <tr>
                <th rowSpan={2}>
                  <Tex>{r`\hat H`}</Tex>
                </th>
                <th className="num" colSpan={2}>
                  白色 <Tex>{r`\pm1`}</Tex> code
                </th>
                <th className="num" colSpan={2}>
                  低通 AR(1)，<Tex>{r`\rho_x=0.98`}</Tex>
                </th>
              </tr>
              <tr>
                <th className="num">
                  <Tex>{r`E[u\,u_f]`}</Tex>
                </th>
                <th className="num">
                  <Tex>{r`\rho_{\mathrm{ref}}`}</Tex>
                </th>
                <th className="num">
                  <Tex>{r`E[u\,u_f]`}</Tex>
                </th>
                <th className="num">
                  <Tex>{r`\rho_{\mathrm{ref}}`}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {prof.table.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td className={`num ${signClass(row.white)}`}>{fx(row.white, 5)}</td>
                  <td className={`num ${signClass(row.whiteRho, 1e-6)}`}>{fp(row.whiteRho, 3)}</td>
                  <td className={`num ${signClass(row.lowpass)}`}>{fx(row.lowpass, 5)}</td>
                  <td className={`num ${signClass(row.lowpassRho, 1e-6)}`}>{fp(row.lowpassRho, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul>
          <li>
            <strong>頻寬誤差</strong>只在 <Tex>{r`\omega_n`}</Tex> 附近（相位從 <Tex>{r`180^\circ`}</Tex> 轉到 <Tex>{r`0^\circ`}</Tex> 的過渡帶）造成相位差，
            兩端（低頻 <Tex>{r`\approx180^\circ`}</Tex>、高頻 <Tex>{r`\approx0^\circ`}</Tex>）不受影響——相當耐受（<Tex>{r`\hat\omega_n=1.5\,\omega_n`}</Tex> 時
            <Tex>{r`\rho_{\mathrm{ref}}=${tx(prof.row('bw+50').whiteRho, 3)}`}</Tex>／<Tex>{tx(prof.row('bw+50').lowpassRho, 3)}</Tex>）。
          </li>
          <li>
            <strong>latency 誤差</strong>是線性相位 <Tex>{r`\Omega\Delta`}</Tex>，<strong>頻率越高越大</strong>；DSM code 的能量正好集中在高頻，
            是最危險的模型誤差：只多算 3 個 sample，白色 code 的 <Tex>{r`\rho_{\mathrm{ref}}=${tx(prof.row('extra-3').whiteRho, 3)}`}</Tex>
            {prof.row('extra-3').whiteRho < 0 ? '（已經變號）' : ''}。
          </li>
          <li>
            <strong>二次差分</strong>只在 DC 附近與 Nyquist 附近相位正確，中頻帶的相位差超過 <Tex>{r`90^\circ`}</Tex>；白色 code 靠 Nyquist 附近的正票得到
            <Tex>{r`\rho_{\mathrm{ref}}=${tx(prof.row('second-diff').whiteRho, 3)}`}</Tex>，低通 AR(1) 反而只有
            <Tex>{txs(prof.row('second-diff').lowpassRho, 3)}</Tex>——下一段推導為什麼它只適合<strong>窄頻</strong>的低頻 tone。
          </li>
        </ul>
        <p className="small muted">
          <ClaimTag kind="exact" /> 表中數值由時域的雙重和 <Tex>{r`\sum_k\sum_lh[k]\hat h[l]R_x[k-l]`}</Tex>（上面推導的第二行）計算，測試中與 PSD 積分（F-07.12）交叉驗證；
          <Tex>{r`E[q\,u_f]\approx K_q\delta E[u\,u_f]`}</Tex> 本身另以 Monte Carlo 驗證（FIR 誤差路徑、<Tex>{r`\hat H=Hz^{-3}`}</Tex>）。
        </p>
      </ModeGate>

      <S5SecondDiff />
    </Section>
  )
}
