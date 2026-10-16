import { useMemo } from 'react'
import { Callout, ClaimTag, ModeGate, SourceTag, StepDerivation, Tex, TexBlock, ChRef } from '@/components'
import { comparatorKq, fxToneCorrelation, multiToneCorrelation, multiToneEmpirical, toneCorrelation, type Tone } from '../bridge'
import { BridgeCompare, ErratumNote, FormulaAnchor, PageChips, PrereqCorrelation, PrereqPsd, clean, num, r } from '../common'

const DEG = Math.PI / 180
/** T06 的 illustrative 參數：μ = 10 fs、σ_v = 100 fs ⇒ μK_q ≈ 0.0798 */
export const D2_MU = 10
export const D2_SIGMA_V = 100
const OMEGA = Math.PI / 6
const N_AVG = 12 * 100 // 整數週期（π/6 的週期為 12 samples）

export function d2Tables() {
  const g0 = D2_MU * comparatorKq(D2_SIGMA_V)
  const single = [0, 60, 90, 120, 180].map((deg) => {
    const C = toneCorrelation(1, 1, deg * DEG)
    const Cemp = multiToneEmpirical([{ A: 1, mag: 1, phiRad: deg * DEG, omega: OMEGA }], N_AVG)
    return { deg, C, Cemp, pole: 1 - g0 * C }
  })
  const t1: Tone = { A: 1, mag: 1, phiRad: 60 * DEG, omega: Math.PI / 6 }
  const t2: Tone = { A: 1, mag: 1, phiRad: 150 * DEG, omega: Math.PI / 3 }
  const two = {
    c1: toneCorrelation(1, 1, t1.phiRad),
    C: multiToneCorrelation([t1, t2]),
    Cemp: multiToneEmpirical([t1, t2], N_AVG),
  }
  const fx = [0, 45, 89, 91, 135, 180].map((deg) => {
    const c = fxToneCorrelation(1, 1, 0, 1, -deg * DEG)
    return { deg, c, pole: 1 - g0 * c }
  })
  return { g0, single, two: { ...two, pole: 1 - g0 * two.C, pole1: 1 - g0 * two.c1 }, fx }
}

function verdict(pole: number) {
  if (Math.abs(pole) < 1 - 1e-12) return <span className="papers-ok">平均收斂</span>
  if (Math.abs(pole) <= 1 + 1e-12) return <span className="papers-zero">沒有恢復力（random walk）</span>
  return <span className="papers-bad">平均發散</span>
}

/** D2 對應的本站推導：單頻／多頻相關判據與 filtered-x 模型誤差（Ch06–Ch07）。 */
export function D2Polarity() {
  const t = useMemo(d2Tables, [])
  return (
    <div className="papers-derived">
      <p>
        <SourceTag kind="illustrative" /> 以下是本站 <ChRef ch="06">Ch06</ChRef>–<ChRef ch="07">Ch07</ChRef> 的推導：單一參數、慢速、小訊號下的<strong>相關判據</strong>。D2 處理的是一般（多參數、寬頻）的
        FxLMS； 本站的結果只是它最簡單的特例，<strong>不是</strong> D2 的定理。
      </p>
      <PrereqCorrelation />
      <FormulaAnchor id="F-PR.5">
        <StepDerivation
          title={
            <>
              單頻 code 的相關 <Tex>{'C=E[x\\,u]'}</Tex>（<Tex>{r`0<\Omega<\pi`}</Tex>，<ErratumNote id="E46" />）
            </>
          }
          steps={[
            {
              tex: r`x[n]=A\cos(\Omega n),\qquad u[n]=A|H|\cos(\Omega n+\phi)`,
              why: (
                <>
                  LTI 路徑對正弦的穩態響應：振幅乘上 <Tex>{'|H|'}</Tex>、相位加上 <Tex>{r`\phi=\angle H(e^{j\Omega})`}</Tex>。
                </>
              ),
            },
            { tex: r`x[n]\,u[n]=A^2|H|\cos(\Omega n)\cos(\Omega n+\phi)`, why: '逐點相乘（GMAC 做的事）。' },
            {
              tex: r`=\frac{A^2|H|}{2}\Big[\cos\phi+\cos(2\Omega n+\phi)\Big]`,
              why: (
                <>
                  積化和差，取 <Tex>{r`\alpha=\Omega n+\phi`}</Tex>、<Tex>{r`\beta=\Omega n`}</Tex>。
                </>
              ),
            },
            {
              tex: r`E[x\,u]=\frac{A^2|H|}{2}\cos\phi+\underbrace{\frac{A^2|H|}{2}\,\overline{\cos(2\Omega n+\phi)}}_{=0}`,
              why: (
                <>
                  <Tex>{r`2\Omega`}</Tex> 的項在整數週期（或長時間）平均為 0；<Tex>{r`\Omega=0`}</Tex> 或 <Tex>{r`\pi`}</Tex> 時它不會消失，結果變 2 倍。
                </>
              ),
            },
          ]}
          result={r`C=\frac{A^2}{2}|H|\cos\phi,\qquad p=1-\mu K_qC`}
        />
      </FormulaAnchor>
      <p>
        以 <Tex>{r`\mu=${D2_MU}\ \mathrm{fs}`}</Tex>、<Tex>{r`\sigma_v=${D2_SIGMA_V}\ \mathrm{fs}`}</Tex>（<Tex>{r`\mu K_q=${num(t.g0, 6)}`}</Tex>）、
        <Tex>{'A=|H|=1'}</Tex>、<Tex>{r`\Omega=\pi/6`}</Tex> 計算；「時域平均」直接產生 <Tex>{'x[n]'}</Tex>、<Tex>{'u[n]'}</Tex> 相乘後平均 {N_AVG} 個 sample：
      </p>
      <div className="table-wrap">
        <table className="papers-table">
          <thead>
            <tr>
              <th className="num">
                <Tex>{r`\phi`}</Tex>
              </th>
              <th className="num">
                <Tex>{'C'}</Tex>（公式）
              </th>
              <th className="num">
                <Tex>{'C'}</Tex>（時域平均）
              </th>
              <th className="num">
                pole <Tex>{'p'}</Tex>
              </th>
              <th>結論</th>
            </tr>
          </thead>
          <tbody>
            {t.single.map((row) => (
              <tr key={row.deg}>
                <td className="num">{row.deg}°</td>
                <td className="num mono">{num(clean(row.C), 6)}</td>
                <td className="num mono">{num(clean(row.Cemp), 6)}</td>
                <td className="num mono">{num(clean(row.pole - 1) + 1, 7)}</td>
                <td>{verdict(clean(row.pole - 1) + 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <BridgeCompare
        caption={r`raw-x 與 filtered-x 的單頻相關只差一行：相位從 $\phi$ 換成 $\phi-\hat\phi$。兩段都是本頁表格實際呼叫的程式。`}
        items={[
          { label: 'raw-x 的相關', region: 'toneCorrelation', note: r`$E[x\,u]$：GMAC 乘原始 code $x$` },
          { label: 'filtered-x 的相關', region: 'fxToneCorrelation', note: r`$E[u\,u_f]$：GMAC 乘經模型濾過的 code $u_f=\hat h*x$` },
        ]}
      />
      <p>
        <ClaimTag kind="exact" /> 正的 learning rate 只在 <Tex>{'C>0'}</Tex> 時有恢復力；<Tex>{'C<0'}</Tex> 時把 <Tex>{r`\mu`}</Tex> 調小只會讓發散變慢，
        <strong>不會改變符號</strong>。
      </p>
      <h4 className="papers-subhead">多頻：不能只看一個頻率</h4>
      <p>
        兩個等振幅 tone：<Tex>{r`\Omega_1=\pi/6`}</Tex> 時 <Tex>{r`\phi_1=60^\circ`}</Tex>，<Tex>{r`\Omega_2=\pi/3`}</Tex> 時 <Tex>{r`\phi_2=150^\circ`}</Tex>。
        不同頻率的交叉項平均為 0，所以 <Tex>{'C'}</Tex> 是兩項之和：
      </p>
      <div className="table-wrap">
        <table className="papers-table">
          <tbody>
            <tr>
              <td>
                只看 tone 1（單頻 <Tex>{r`\pm90^\circ`}</Tex> 判據）
              </td>
              <td className="num mono">
                <Tex>{r`C_1=${num(t.two.c1, 6)}`}</Tex>
              </td>
              <td>{verdict(t.two.pole1)}</td>
            </tr>
            <tr>
              <td>兩個 tone 的加權和（公式）</td>
              <td className="num mono">
                <Tex>{r`C=${num(t.two.C, 6).replace('−', '-')}`}</Tex>
              </td>
              <td>{verdict(t.two.pole)}</td>
            </tr>
            <tr>
              <td>時域平均（{N_AVG} samples）</td>
              <td className="num mono">
                <Tex>{r`C=${num(t.two.Cemp, 6).replace('−', '-')}`}</Tex>
              </td>
              <td>與公式一致</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">
        想用自己的振幅與相位手算這張表：兩個 tone 的加權和、共用一個 code 延遲時的相關，以及 filtered-x 模型相位誤差，在 <ChRef ch="06">Ch06</ChRef>、<ChRef ch="07">Ch07</ChRef> 都有帶入手算題；本頁不重複。
        <PageChips ids={['ch06', 'ch07', 'workbook']} />
      </p>
      <PrereqPsd />
      <FormulaAnchor id="F-PR.6">
        <StepDerivation
          title={
            <>
              一般 WSS code 的判據（規格 §6.2；一律用離散時間的 <Tex>{r`H(e^{j\Omega})`}</Tex>，<ErratumNote id="E44" />）
            </>
          }
          steps={[
            {
              tex: r`C=E\Big[x[n]\sum_k h[k]\,x[n-k]\Big]=\sum_k h[k]\,R_x[k]`,
              why: (
                <>
                  <Tex>{r`u=h*x`}</Tex> 是卷積；期望值線性，<Tex>{r`R_x[k]=E[x[n]x[n-k]]`}</Tex> 是自相關。
                </>
              ),
            },
            {
              tex: r`=\sum_k h[k]\,\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}(e^{j\Omega})\,e^{j\Omega k}\,d\Omega=\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}(e^{j\Omega})\,H(e^{-j\Omega})\,d\Omega`,
              why: (
                <>
                  自相關是 PSD 的反轉換；交換加總與積分，<Tex>{r`\sum_k h[k]e^{j\Omega k}=H(e^{-j\Omega})`}</Tex>。
                </>
              ),
            },
            {
              tex: r`=\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}(e^{j\Omega})\,\mathrm{Re}\{H(e^{j\Omega})\}\,d\Omega`,
              why: (
                <>
                  <Tex>{'h'}</Tex> 為實數，所以 <Tex>{r`H(e^{-j\Omega})=\overline{H(e^{j\Omega})}`}</Tex>；<Tex>{r`S_{xx}`}</Tex> 是偶函數，虛部是奇函數，積分為 0。
                </>
              ),
            },
          ]}
          result={r`C=\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}(e^{j\Omega})\,|H(e^{j\Omega})|\cos\phi(\Omega)\,d\Omega`}
        />
      </FormulaAnchor>
      <p>
        適用條件：WSS code、穩定 LTI 路徑、單參數、慢速平均模型。它是 PSD、振幅、相位三者的<strong>加權總和</strong>；上面的兩 tone 例子就是兩根譜線的特例。
      </p>
      <ModeGate min="engineer">
        <h4 className="papers-subhead">
          Filtered-x：模型 <Tex>{r`\hat H`}</Tex> 的相位錯多少會出事（
          <ErratumNote id="E45" />）
        </h4>
        <p>
          GMAC 改乘 <Tex>{r`u_f=\hat h*x`}</Tex> 後，相關變成 <Tex>{r`E[u\,u_f]`}</Tex>。單頻時 <Tex>{r`u=A|H|\cos(\Omega n+\phi)`}</Tex>、
          <Tex>{r`u_f=A|\hat H|\cos(\Omega n+\hat\phi)`}</Tex>，同樣的積化和差（取 <Tex>{r`\alpha=\Omega n+\phi`}</Tex>、
          <Tex>{r`\beta=\Omega n+\hat\phi`}</Tex>）給出：
        </p>
        <TexBlock id="F-PR.7">{r`E[u\,u_f]=\frac{A^2}{2}\,|H|\,|\hat H|\cos(\phi-\hat\phi)`}</TexBlock>
        <p>
          <ClaimTag kind="exact" />
          （單頻、<Tex>{r`0<\Omega<\pi`}</Tex>）。只要模型的相位誤差 <Tex>{r`|\phi-\hat\phi|<90^\circ`}</Tex>，相關就是正的；振幅誤差只改變 loop gain 的大小，不改變符號：
        </p>
        <div className="table-wrap">
          <table className="papers-table">
            <thead>
              <tr>
                <th className="num">
                  模型相位誤差 <Tex>{r`\phi-\hat\phi`}</Tex>
                </th>
                <th className="num">
                  <Tex>{r`E[u\,u_f]`}</Tex>
                </th>
                <th className="num">pole</th>
                <th>結論</th>
              </tr>
            </thead>
            <tbody>
              {t.fx.map((row) => (
                <tr key={row.deg}>
                  <td className="num">{row.deg}°</td>
                  <td className="num mono">{num(clean(row.c), 6)}</td>
                  <td className="num mono">{num(row.pole, 7)}</td>
                  <td>{verdict(row.pole)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Callout kind="info" title="讀 D2 時要對照的地方">
          本站的判據都是「單一參數、相關的符號」；多參數時要看的是矩陣 <Tex>{r`E[\mathbf x\mathbf u^T]`}</Tex> 的特徵值（<ChRef ch="10">Ch10</ChRef>），不再只是一個數的正負。 D2
          的題名提到的 Toeplitz 矩陣與 pseudospectrum，就是處理這個一般情況的數學工具；它的條件與本站結果之間的關係，請以原文為準。
        </Callout>
      </ModeGate>
    </div>
  )
}
