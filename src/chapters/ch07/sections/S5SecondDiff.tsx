import { useMemo } from 'react'
import { Callout, ClaimTag, ModeGate, StepDerivation, Tex, TexBlock } from '@/components'
import { cArg } from '@/simulation/core'
import { freqz } from '@/simulation/signal'
import {
  analyticCorr,
  crossIntegralSplit,
  empiricalCorr,
  HAT_EXACT,
  pathTransfer,
  secondDiffApproxEdge,
  secondDiffAr1Corr,
  secondDiffFailBand,
  secondDiffPhaseErrApprox,
  secondDiffResponse,
  secondDiffTransfer,
  truncatedImpulse,
  type FxPathSpec,
} from '@/simulation/models/filteredX'
import { FoldSteps } from '../FoldSteps'
import { Hand } from '../Hand'
import { DEG, fp, fx, signClass, tx } from '../util'

const r = String.raw
const WN = 0.1
const ZETA = 0.7
const PATH0: Extract<FxPathSpec, { kind: 'type2_dt' }> = { kind: 'type2_dt', wnTs: WN, zeta: ZETA, loopDelay: 0 }
const PATH1: Extract<FxPathSpec, { kind: 'type2_dt' }> = { ...PATH0, loopDelay: 1 }
/** Ĥ₂ 的增益 K₂ = 1/(ω_nT_s)² */
const SCALE = 1 / (WN * WN)

const wrapDeg = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180

/** §7.5 後半：Type-II 的二次差分 regressor——CT 動機、DT 低頻相位（含 loop latency d）、失效頻帶、寬頻低通 code 的確切分析。 */
export function S5SecondDiff() {
  // ── 相位比較表與失效頻帶（d = 0、d = 1）──
  const sd = useMemo(() => {
    const H = pathTransfer(PATH0)
    const oms = [0.01, 0.03, 0.05, 0.1, 0.12, 0.2, Math.PI / 6, 1.5, 3]
    const Hz = freqz(H.b, H.a, oms)
    const rows = oms.map((o, i) => {
      const phH = cArg(Hz[i]) * DEG
      const ph2 = cArg(secondDiffResponse(o, SCALE)) * DEG
      return { o, phH, ph2, err: wrapDeg(phH - ph2), approx: secondDiffPhaseErrApprox(o, WN, ZETA, 0) * DEG }
    })
    const pi6 = rows.find((row) => Math.abs(row.o - Math.PI / 6) < 1e-12) as (typeof rows)[number]
    const band0 = secondDiffFailBand(PATH0)
    const band1 = secondDiffFailBand(PATH1)
    // 寬頻 MASH code（經驗值，與 Lab 同一段序列）：raw-x 與二次差分的正規化相關
    const mashCode = { kind: 'mash111' as const, frac: 0.3 }
    const mashSd = empiricalCorr({ path: PATH0, code: mashCode, mode: 'filtered', hat: { ...HAT_EXACT, base: 'second_diff' }, seed: 20261010 })
    const mashRaw = empiricalCorr({ path: PATH0, code: mashCode, mode: 'raw', seed: 20261010 })
    return {
      rows,
      pi6,
      band0,
      band1,
      edge0: secondDiffApproxEdge(WN, ZETA, 0),
      edge1: secondDiffApproxEdge(WN, ZETA, 1),
      rhoSdMash: mashSd.rho,
      rhoRawMash: mashRaw.rho,
    }
  }, [])

  // ── 寬頻低通 code（AR(1)）的確切分析 ──
  const ar = useMemo(() => {
    const g = secondDiffTransfer(SCALE)
    return [PATH0, PATH1].flatMap((path) => {
      const H = pathTransfer(path)
      const hImp = truncatedImpulse(H)
      return [0.98, 0.995].map((rhoX) => {
        const code = { kind: 'ar1' as const, rho: rhoX }
        const parts = secondDiffAr1Corr(hImp, rhoX)
        const closed = analyticCorr({ code, h: H, g, D: 0 }) as number
        const split = crossIntegralSplit({ code, h: H, g }) as { pos: number; neg: number; total: number }
        const eu2 = analyticCorr({ code, h: H, g: H, D: 0 }) as number
        const euf2 = analyticCorr({ code, h: g, g, D: 0 }) as number
        return {
          d: path.loopDelay,
          rhoX,
          h1: hImp[1],
          t0: SCALE * parts.t0,
          t1: SCALE * parts.t1,
          tail: SCALE * parts.tail,
          total: SCALE * parts.total,
          closed,
          pos: split.pos,
          neg: split.neg,
          rho: closed / Math.sqrt(eu2 * euf2),
        }
      })
    })
  }, [])

  return (
    <>
      <h3 className="ch07-subhead">
        最便宜的 <Tex>{r`\hat H`}</Tex>：Type-II 的二次差分 regressor
      </h3>
      <p>
        Filtered-x 需要在 code 路徑上放一個 <Tex>{r`\hat H`}</Tex>（FIR 或 IIR，含乘法器）。對 Type-II 主 PLL，有一個幾乎免費的近似。先用連續時間原型看它從哪裡來：
      </p>
      <FoldSteps
        steps={[
          {
            tex: r`H_{\mathrm{PD}}(s)=\frac{s^2}{s^2+2\zeta\omega_ns+\omega_n^2}=\frac{s^2}{\omega_n^2}\cdot\frac{1}{1+2\zeta\frac{s}{\omega_n}+\frac{s^2}{\omega_n^2}}`,
            why: <>連續時間參考原型（規格 §6.1）；把 <Tex>{r`\omega_n^2`}</Tex> 提出來。</>,
          },
          {
            tex: r`\approx\frac{s^2}{\omega_n^2}\qquad(|s|\ll\omega_n)`,
            why: <>低頻時第二個因子 <Tex>{r`\to1`}</Tex>（Type-II 的 high-pass 斜率 40 dB/dec）。</>,
          },
          {
            tex: r`s\;\leftrightarrow\;\frac{1-z^{-1}}{T_s}\ \Rightarrow\ \hat H_2(z)=\frac{(1-z^{-1})^2}{(\omega_nT_s)^2}`,
            why: <>一階差分近似微分（<Tex>{r`\omega_nT_s\ll1`}</Tex>）。</>,
          },
          {
            tex: r`1-e^{-j\Omega}=e^{-j\Omega/2}\big(e^{j\Omega/2}-e^{-j\Omega/2}\big)=2j\sin\tfrac{\Omega}{2}\,e^{-j\Omega/2}`,
            why: '提出半角相位（和 7.2 節證明等比數列時同一招）。',
          },
          {
            tex: r`(1-e^{-j\Omega})^2=-4\sin^2\!\tfrac{\Omega}{2}\,e^{-j\Omega}=4\sin^2\!\tfrac{\Omega}{2}\,e^{j(\pi-\Omega)}`,
            why: (
              <>
                平方：<Tex>{r`(2j)^2=-4`}</Tex>，<Tex>{r`-1=e^{j\pi}`}</Tex>。
              </>
            ),
          },
        ]}
        result={r`|\hat H_2|=\frac{4\sin^2(\Omega/2)}{(\omega_nT_s)^2}\approx\Big(\frac{\Omega}{\omega_nT_s}\Big)^2,\qquad\angle\hat H_2=\pi-\Omega\quad(0<\Omega<\pi)`}
      />
      <TexBlock id="F-07.14" label={<>二次差分 regressor；<Tex>{r`K_2`}</Tex> 是它的增益（<Tex>{r`\hat\omega_n`}</Tex> 為設計者估計的 <Tex>{r`\omega_n`}</Tex>）</>}>
        {r`\hat H_2(z)=K_2\,(1-z^{-1})^2,\quad K_2\equiv\frac{1}{(\hat\omega_nT_s)^2};\qquad (1-e^{-j\Omega})^2=-4\sin^2\!\tfrac{\Omega}{2}\,e^{-j\Omega}=4\sin^2\!\tfrac{\Omega}{2}\,e^{j(\pi-\Omega)}`}
      </TexBlock>

      <p>
        但真正要比的是 E44 的<strong>離散時間</strong> <Tex>{r`H_{\mathrm{PD}}(e^{j\Omega})`}</Tex>（含額外 loop latency <Tex>{'d'}</Tex>），不是 CT 原型。
        令 <Tex>{r`\nabla\equiv1-z^{-1}`}</Tex>（一階差分，backward difference），<Tex>{r`K_p=2\zeta\omega_nT_s`}</Tex>、<Tex>{r`K_i=(\omega_nT_s)^2`}</Tex>：
      </p>
      <FoldSteps
        steps={[
          {
            tex: r`L(z)=\Big(K_p+\frac{K_i}{\nabla}\Big)\frac{z^{-(1+d)}}{\nabla}=\frac{(K_i+K_p\nabla)\,z^{-(1+d)}}{\nabla^2}`,
            why: <>E44 的 DPLL 開迴路（PI loop filter 加上一個 DCO 積分器、<Tex>{'1+d'}</Tex> 個 sample 的延遲）；通分。</>,
          },
          {
            tex: r`H_{\mathrm{PD}}=\frac{1}{1+L}=\frac{\nabla^2}{\nabla^2+(K_i+K_p\nabla)\,z^{-(1+d)}}`,
            why: <>分子分母同乘 <Tex>{r`\nabla^2`}</Tex>。分子的 <Tex>{r`\nabla^2`}</Tex> 就是 Type-II 的兩個 DC 零點。</>,
          },
          {
            tex: r`\approx\frac{\nabla^2}{K_i}\cdot z^{1+d}\cdot\frac{1}{1+(K_p/K_i)\nabla}\qquad(|\nabla|\ll\omega_nT_s)`,
            why: (
              <>
                低頻時 <Tex>{r`|\nabla|\approx\Omega`}</Tex>，<Tex>{r`|\nabla|^2\ll K_i=(\omega_nT_s)^2`}</Tex>，分母的 <Tex>{r`\nabla^2`}</Tex> 可略；再提出
                <Tex>{r`K_iz^{-(1+d)}`}</Tex>。
              </>
            ),
          },
          {
            tex: r`\angle H_{\mathrm{PD}}\approx(\pi-\Omega)+(1+d)\Omega-\frac{K_p}{K_i}\Omega=\pi+d\,\Omega-\frac{2\zeta\,\Omega}{\omega_nT_s}`,
            why: (
              <>
                三個因子的相位相加：<Tex>{r`\angle\nabla^2=\pi-\Omega`}</Tex>（上面的結果）、<Tex>{r`\angle z^{1+d}=(1+d)\Omega`}</Tex>、
                <Tex>{r`\angle\frac{1}{1+(K_p/K_i)\nabla}\approx-\arctan\frac{K_p\Omega}{K_i}\approx-\frac{K_p}{K_i}\Omega`}</Tex>（<Tex>{r`\nabla\approx j\Omega`}</Tex>，arctan 一階泰勒）；
                <Tex>{r`K_p/K_i=2\zeta/(\omega_nT_s)`}</Tex>。
              </>
            ),
          },
          {
            tex: r`\angle H_{\mathrm{PD}}-\angle\hat H_2\approx(1+d)\,\Omega-\frac{2\zeta\,\Omega}{\omega_nT_s}`,
            why: <>減去 <Tex>{r`\angle\hat H_2=\pi-\Omega`}</Tex>。<Tex>{'d=0'}</Tex> 時恰好與 CT 原型的 <Tex>{r`\pi-2\zeta\Omega/(\omega_nT_s)`}</Tex> 推出的結果相同。</>,
          },
        ]}
      />
      <TexBlock id="F-07.15" label={<>二次差分的低頻相位差（DT，含 loop latency <Tex>{'d'}</Tex>）</>}>
        {r`\angle H_{\mathrm{PD}}-\angle\hat H_2\approx-\Omega\Big(\frac{2\zeta}{\omega_nT_s}-1-d\Big),\qquad|\cdot|<\frac{\pi}{2}\iff\Omega\lesssim\frac{\pi/2}{2\zeta/(\omega_nT_s)-1-d}`}
      </TexBlock>
      <p>
        <ClaimTag kind="approx" /> <Tex>{r`\omega_nT_s=0.1`}</Tex>、<Tex>{r`\zeta=0.7`}</Tex>：近似式給 <Tex>{r`\Omega\lesssim${tx(sd.edge0, 3)}`}</Tex>（<Tex>{'d=0'}</Tex>）、
        <Tex>{r`${tx(sd.edge1, 3)}`}</Tex>（<Tex>{'d=1'}</Tex>）；精確的 DT 計算第一次超過 <Tex>{r`90^\circ`}</Tex> 在
        {sd.band0 ? (
          <>
            {' '}
            <Tex>{r`\Omega=${tx(sd.band0.lo, 4)}\approx${tx(sd.band0.lo / WN, 2)}\,\omega_nT_s`}</Tex>（<Tex>{'d=0'}</Tex>）
          </>
        ) : (
          <>（<Tex>{'d=0'}</Tex> 時沒有超過）</>
        )}
        {sd.band1 ? (
          <>
            {' '}與 <Tex>{r`${tx(sd.band1.lo, 4)}`}</Tex>（<Tex>{'d=1'}</Tex>）
          </>
        ) : null}
        。注意它不是「高頻一律錯」：<Tex>{r`\Omega\to\pi`}</Tex> 時 <Tex>{r`\angle\hat H_2=\pi-\Omega\to0`}</Tex>，又和 <Tex>{r`H_{\mathrm{PD}}\approx1`}</Tex> 對齊了。
        相位差超過 <Tex>{r`90^\circ`}</Tex> 的是一段<strong>中頻帶</strong>
        {sd.band0 ? (
          <>
            {' '}
            <Tex>{r`${tx(sd.band0.lo, 3)}\lesssim\Omega\lesssim${tx(sd.band0.hi, 2)}`}</Tex> rad/sample（<Tex>{'d=0'}</Tex>，下表的紅色列）
          </>
        ) : null}
        {sd.band1 ? (
          <>
            {' '}
            與 <Tex>{r`${tx(sd.band1.lo, 3)}\lesssim\Omega\lesssim${tx(sd.band1.hi, 2)}`}</Tex>（<Tex>{'d=1'}</Tex>）
          </>
        ) : null}
        。
      </p>
      <div className="table-wrap">
        <table className="ch07-table">
          <thead>
            <tr>
              <th className="num">
                <Tex>{'\\Omega'}</Tex>
              </th>
              <th className="num">
                <Tex>{r`\angle H_{\mathrm{PD}}`}</Tex>（DT，<Tex>{'d=0'}</Tex>）
              </th>
              <th className="num">
                <Tex>{r`\angle\hat H_2=\pi-\Omega`}</Tex>
              </th>
              <th className="num">相位差（精確）</th>
              <th className="num">F-07.15 近似</th>
              <th>判讀</th>
            </tr>
          </thead>
          <tbody>
            {sd.rows.map((row) => (
              <tr key={row.o} className={Math.abs(row.err) > 90 ? 'ch07-row-bad' : ''}>
                <td className="num">{fx(row.o, 4)}</td>
                <td className="num">{fx(row.phH, 2)}°</td>
                <td className="num">{fx(row.ph2, 2)}°</td>
                <td className={`num ${Math.abs(row.err) < 90 ? 'ch07-pos' : 'ch07-neg'}`}>{fx(row.err, 2)}°</td>
                <td className="num">{row.o <= 0.1 ? `${fx(row.approx, 1)}°` : '（不適用）'}</td>
                <td>{Math.abs(row.err) < 90 ? '極性正確' : '極性錯誤'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ModeGate min="engineer">
        <Hand id="HC-07.7">
          上表 <Tex>{r`\Omega=\pi/6`}</Tex>（<Tex>{r`30^\circ`}</Tex>/sample）那一列的「極性錯誤」可以完全用手算驗證：把
          <Tex>{r`H_{\mathrm{PD}}`}</Tex> 與 <Tex>{r`\hat H_2`}</Tex> 都拆成實部、虛部，一步一步算到 <Tex>{r`E[u\,u_f]=\mathrm{Re}\{H_{\mathrm{PD}}\overline{\hat H_2}\}`}</Tex>
          （答案約 <Tex>{'-19.9'}</Tex>）。這一題步驟較多（複數的加、乘、除各一次），建議拿紙畫 Re／Im 兩欄慢慢算；算完再換成你自己的
          <Tex>{r`\omega_nT_s`}</Tex>、<Tex>{r`\zeta`}</Tex>、<Tex>{'d'}</Tex>、<Tex>{r`\Omega`}</Tex>。
        </Hand>
      </ModeGate>

      <ModeGate min="engineer">
        <h3 className="ch07-subhead">
          寬頻的「低通」code 也不行：<Tex>{r`\hat H_2`}</Tex> 的增益一路往高頻上升
        </h3>
        <p>
          上表是單頻。若 code 是寬頻的低通（例如 AR(1)，<Tex>{r`\rho_x`}</Tex> 接近 1），直覺上「能量大多在低頻，應該沒問題」——但 F-07.12 的權重是
          <Tex>{r`S_{xx}|H_{\mathrm{PD}}||\hat H_2|`}</Tex>：低頻 <Tex>{r`|H_{\mathrm{PD}}||\hat H_2|\approx(\Omega/\omega_nT_s)^4`}</Tex> 非常小，而
          <Tex>{r`|\hat H_2|=4\sin^2(\Omega/2)/(\omega_nT_s)^2`}</Tex> 一直升到 Nyquist，於是 AR(1) 的高頻尾巴（<Tex>{r`S_{xx}\propto1/\Omega^2`}</Tex>）在中頻帶拿到和低頻差不多的票數。
          AR(1) 可以在時域算出確切值：
        </p>
        <StepDerivation
          steps={[
            { tex: r`u_f[n]=K_2\big(x[n]-2x[n-1]+x[n-2]\big),\qquad K_2=\frac{1}{(\hat\omega_nT_s)^2}`, why: '二次差分 regressor（F-07.14）。' },
            {
              tex: r`E[u\,u_f]=K_2\sum_k h[k]\,E\big[x[n-k]\,(x[n]-2x[n-1]+x[n-2])\big]=K_2\sum_kh[k]\big(R_x[k]-2R_x[k-1]+R_x[k-2]\big)`,
              why: <>代入 <Tex>{r`u=h*x`}</Tex>；<Tex>{r`E[x[n-k]x[n-j]]=R_x[k-j]`}</Tex>（自相關是偶函數）。</>,
            },
            {
              tex: r`R_x[m]=\rho_x^{|m|}:\quad R_x[k]-2R_x[k-1]+R_x[k-2]=\begin{cases}(1-\rho_x)^2,&k=0\\-2(1-\rho_x),&k=1\\\rho_x^{k-2}(1-\rho_x)^2,&k\ge2\end{cases}`,
              why: (
                <>
                  逐項代入：<Tex>{r`k=0`}</Tex> 時 <Tex>{r`1-2\rho_x+\rho_x^2`}</Tex>；<Tex>{r`k=1`}</Tex> 時 <Tex>{r`\rho_x-2+\rho_x`}</Tex>（<Tex>{r`|k-2|=1`}</Tex>）；
                  <Tex>{r`k\ge2`}</Tex> 時 <Tex>{r`\rho_x^{k-2}(\rho_x^2-2\rho_x+1)`}</Tex>。
                </>
              ),
            },
            {
              tex: r`h[0]=1,\qquad h[1]=\begin{cases}-(K_p+K_i),&d=0\\0,&d\ge1\end{cases}`,
              why: (
                <>
                  <Tex>{r`L(z)=\big((K_p+K_i)-K_pz^{-1}\big)z^{-(1+d)}/\nabla^2`}</Tex> 從 <Tex>{r`z^{-(1+d)}`}</Tex> 開始，<Tex>{r`H=1-L+L^2-\cdots`}</Tex> 的
                  <Tex>{r`z^{-1}`}</Tex> 係數在 <Tex>{'d=0'}</Tex> 時是 <Tex>{r`-(K_p+K_i)`}</Tex>，<Tex>{r`d\ge1`}</Tex> 時是 0。
                </>
              ),
            },
            {
              tex: r`\sum_{k\ge0}h[k]=H_{\mathrm{PD}}(1)=0\ \Rightarrow\ 1+\sum_{k\ge2}h[k]\rho_x^{k-2}=-h[1]-\sum_{k\ge2}h[k]\big(1-\rho_x^{k-2}\big)`,
              why: <>Type-II 的 DC null（分子 <Tex>{r`\nabla^2`}</Tex>）：脈衝響應總和為 0；代回第三項的括號。</>,
            },
          ]}
          result={r`E[u\,u_f]=K_2\Big[\underbrace{-2(1-\rho_x)\,h[1]}_{d=0:\ 2(1-\rho_x)(K_p+K_i)>0;\ \ d\ge1:\ 0}+(1-\rho_x)^2\Big(1+\sum_{k\ge2}h[k]\rho_x^{k-2}\Big)\Big]`}
        />
        <TexBlock id="F-07.16" label={<>AR(1) code 下二次差分 regressor 的確切相關</>}>
          {r`E[u\,u_f]=K_2\Big[(1-\rho_x)^2h[0]-2(1-\rho_x)h[1]+(1-\rho_x)^2\sum_{k\ge2}h[k]\rho_x^{k-2}\Big],\qquad E[u_f^2]=2K_2^2(1-\rho_x)(3-\rho_x)`}
        </TexBlock>
        <p>
          所以 <Tex>{'d=0'}</Tex> 時只剩 <Tex>{r`O(1-\rho_x)`}</Tex> 的小正值，<Tex>{r`d\ge1`}</Tex> 時連這一項都消失，剩下的括號因 DC null 幾乎完全抵消（<Tex>{r`O((1-\rho_x)^3)`}</Tex>），
          符號由高階項決定、不受設計者控制。下表用 F-07.16 逐項計算，並與 7.5 節開頭的雙重和 <Tex>{r`\sum_k\sum_lh[k]\hat h[l]R_x[k-l]`}</Tex>（「封閉式」欄）、以及頻域正／負票（
          <Tex>{r`\frac1\pi\int_0^\pi S_{xx}\mathrm{Re}\{H\hat H_2^*\}d\Omega`}</Tex> 依被積函數正負拆開）交叉驗證（<Tex>{r`K_2=1/(\omega_nT_s)^2=${tx(SCALE, 0)}`}</Tex>）：
        </p>
        <div className="table-wrap">
          <table className="ch07-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'d'}</Tex>
                </th>
                <th className="num">
                  <Tex>{r`\rho_x`}</Tex>
                </th>
                <th className="num">
                  <Tex>{'h[1]'}</Tex>
                </th>
                <th className="num">
                  <Tex>{r`-2K_2(1-\rho_x)h[1]`}</Tex>
                </th>
                <th className="num">其餘兩項</th>
                <th className="num">F-07.16 總和</th>
                <th className="num">封閉式</th>
                <th className="num">正票</th>
                <th className="num">負票</th>
                <th className="num">
                  <Tex>{r`\rho_{\mathrm{ref}}`}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {ar.map((row) => (
                <tr key={`${row.d}-${row.rhoX}`}>
                  <td className="num">{row.d}</td>
                  <td className="num">{row.rhoX}</td>
                  <td className="num">{fx(row.h1, 4)}</td>
                  <td className="num">{fx(row.t1, 5)}</td>
                  <td className="num">{fp(row.t0 + row.tail, 4)}</td>
                  <td className={`num ${signClass(row.total, 1e-12)}`}>{fp(row.total, 5)}</td>
                  <td className="num">{fp(row.closed, 5)}</td>
                  <td className="num ch07-pos">{fx(row.pos, 4)}</td>
                  <td className="num ch07-neg">{fx(row.neg, 4)}</td>
                  <td className={`num ${signClass(row.rho, 1e-9)}`}>{fp(row.rho, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          正票與負票的大小差不多、互相抵消，總和只剩一點點：正規化相關 <Tex>{r`\rho_{\mathrm{ref}}`}</Tex> 遠小於 1 甚至為負。二次差分只適合<strong>窄頻</strong>的低頻 tone，
          不適合寬頻 code——即使那個 code 是「低通」的。閉迴路驗證見 Lab 的 preset「二次差分遇到寬頻低通 code」。 <ClaimTag kind="exact" />
        </p>
      </ModeGate>

      <Callout kind="info" title="二次差分 regressor 的硬體與限制">
        <p>
          只要兩個 code 暫存器（<Tex>{'x[n-1]'}</Tex>、<Tex>{'x[n-2]'}</Tex>）、一個左移（<Tex>{r`\times2`}</Tex>）和兩個加法器；
          <Tex>{r`K_2=1/(\hat\omega_nT_s)^2`}</Tex> 只是正的增益，可以併入 <Tex>{'\\mu'}</Tex> 或用 barrel shift。代價是 regressor 多 2 個 bit 的動態範圍。
          <strong>適用範圍</strong>：窄頻、低頻的 training tone（<Tex>{r`\Omega`}</Tex> 低於 F-07.15 的邊界，慢速 PVT tracking）。
          code 能量若落在上面的中頻帶（例如 <Tex>{r`\Omega=\pi/6`}</Tex> 的 training tone，<Tex>{r`\angle H_{\mathrm{PD}}=${tx(sd.pi6.phH, 1)}^\circ`}</Tex>、相位差
          <Tex>{r`${tx(sd.pi6.err, 1)}^\circ`}</Tex>），極性會{Math.abs(sd.pi6.err) > 90 ? <strong>反過來</strong> : '保持正確'}；
          MASH 這種能量堆在 Nyquist 附近的 DSM code，二次差分的正規化相關是 <Tex>{r`\rho=${tx(sd.rhoSdMash, 2)}`}</Tex>
          {sd.rhoSdMash > 0 ? (
            <>
              （符號是對的，因為 Nyquist 附近 <Tex>{r`\angle\hat H_2=\pi-\Omega\to0`}</Tex>；但中頻帶的負票讓它明顯小於 1）
            </>
          ) : (
            '（極性錯誤）'
          )}
          ，不如直接用 raw-x（<Tex>{r`H_{\mathrm{PD}}\approx1`}</Tex>，<Tex>{r`\rho=${tx(sd.rhoRawMash, 2)}`}</Tex>；
          同一段 MASH 序列的經驗值）。
        </p>
      </Callout>
    </>
  )
}
