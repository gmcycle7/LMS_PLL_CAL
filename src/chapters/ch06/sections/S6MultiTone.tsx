import { useEffect, useMemo, useState } from 'react'
import { ClaimTag, CodeBlock, CodeCompare, ModeGate, Prereq, SourceTag, StepDerivation, Tex, TexBlock, ChRef } from '@/components'
import polaritySrc from '@/simulation/models/polarity.ts?raw'
import { freqz, impulseResponse } from '@/simulation/signal'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import {
  autocorrCorrelation,
  designPolarityLoop,
  impulseMoments,
  lineCorrelation,
  sawtoothAutocorr,
  sawtoothLines,
  sawtoothMomentApprox,
  type FcwSweepParams,
  type FcwSweepResult,
} from '@/simulation/models/polarity'
import { FcwSweepExperiment } from '../experiments/FcwSweepExperiment'
import { ChapterDiagram, ChapterHandCalc, ChapterSection, Erratum, f, JumpTo, StepBox } from '../shared'

const PATH = 'src/simulation/models/polarity.ts'

/** 表格的一組「精確 / 兩項近似」儲存格（負值標紅） */
function FragmentCells({ exact, two }: { exact: number; two: number }) {
  return (
    <>
      <td className={`num ${exact < 0 ? 'neg' : 'pos'}`}>{f(exact, 4)}</td>
      <td className="num">{f(two, 4)}</td>
    </>
  )
}

const BASIN_SWEEP: FcwSweepParams = { loopType: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: 0, delay: 0, fracMin: 5e-4, fracMax: 0.004, points: 4 }

/**
 * §6.4 的 basin 表：預設 Type-II 迴路、四個近整數 frac 的 C/σ² 與 mean-field 變號點 δ_c。
 * 需要產生 DSM code 並對數萬個 sample 做 erf 平均，所以交給 worker（sweepFcwPolarity）。
 */
function BasinTable() {
  const task = useWorkerTask<FcwSweepParams, FcwSweepResult>('polarity', 'sweepFcwPolarity')
  const { run } = task
  const [res, setRes] = useState<FcwSweepResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    run(BASIN_SWEEP)
      .then((r) => {
        if (alive) setRes(r)
      })
      .catch((e: unknown) => {
        if (alive && !isWorkerCancelled(e)) setErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [run])
  if (err) return <p className="small muted">basin 表計算失敗：{err}</p>
  if (!res) return <p className="small muted">basin 表計算中（worker）…</p>
  return (
    <div className="table-wrap">
      <table className="ch06-table" data-testid="ch06-basin-table">
        <thead>
          <tr>
            <th className="num">
              <Tex>{'\\mathrm{frac}'}</Tex>
            </th>
            <th className="num">
              <Tex>{'\\Delta=\\Omega_0/(\\omega_nT_s)'}</Tex>
            </th>
            <th className="num">
              小訊號 <Tex>{'C/\\sigma_x^2'}</Tex>（DSM 模擬）
            </th>
            <th className="num">
              <Tex>{'\\delta_c/\\sigma_v'}</Tex>
            </th>
            <th className="num">
              <Tex>{'\\delta_c'}</Tex>（<Tex>{'\\sigma_v=100\\,\\mathrm{fs}'}</Tex>）
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from(res.frac).map((fr, i) => (
            <tr key={fr}>
              <td className="num">{f(fr, 3)}</td>
              <td className="num">{f(res.ratio[i], 3)}</td>
              <td className="num pos">{f(res.dsm1[i], 3)}</td>
              <td className={`num ${Number.isFinite(res.basin[i]) ? 'neg' : ''}`}>{Number.isFinite(res.basin[i]) ? f(res.basin[i], 3) : '不變號'}</td>
              <td className="num">{Number.isFinite(res.basin[i]) ? `${f(100 * res.basin[i], 3)} fs` : '—'}</td>
            </tr>
          ))}
        </tbody>
        <caption>
          由 worker 即時計算（<code>sweepFcwPolarity</code> → <code>meanFieldCurve</code>）：20-bit 一階 DSM residue、預設 Type-II 迴路（<Tex>{'\\zeta=0.7'}</Tex>、
          <Tex>{'\\mathrm{BW}/f_{\\mathrm{ref}}=0.01'}</Tex>、<Tex>{'d=0'}</Tex>、<Tex>{'D=0'}</Tex>）。<Tex>{'C>0'}</Tex>（綠）但 <Tex>{'|\\delta|>\\delta_c'}</Tex>{' '}
          之後平均更新反向（紅）。 <SourceTag kind="simulation" />
        </caption>
      </table>
    </div>
  )
}

/** §6 多頻判據 C = (1/2π)∫S_xx Re{H} dΩ、五種估計法、近整數 FCW 的鋸齒抵消定理 */
export function S6MultiTone() {
  // §6.4 的即時驗算：預設 Type-II 迴路的動差、精確鋸齒相關、漸近式、截斷譜線（反面）
  const near = useMemo(() => {
    const des = designPolarityLoop({ type: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: 0 })
    const h = impulseResponse(des.b, des.a, 8192)
    const m = impulseMoments(h)
    const rows = [1e-4, 3e-4, 1e-3].map((fr) => {
      const lines = sawtoothLines(2 * Math.PI * fr, 4000)
      return {
        fr,
        delta: (2 * Math.PI * fr) / des.wLTs,
        exact: autocorrCorrelation(h, sawtoothAutocorr(fr)),
        asym: (12 * fr * fr) / des.Ki,
        trunc: 12 * lineCorrelation(lines, freqz(des.b, des.a, lines.omega)),
      }
    })
    // 延伸：GMAC code delay D 讓近整數鋸齒變號（exact = 自相關和；approx = 兩項動差展開）
    const delayRows = [0, 1, 2, 3, 4].map((D) => {
      const cells = [0.002, 5e-4].map((fr) => ({
        exact: autocorrCorrelation(h, sawtoothAutocorr(fr), D),
        mom: sawtoothMomentApprox(h, fr, D),
        two: -12 * fr * D + (12 * fr * fr) / des.Ki,
      }))
      return { D, cells }
    })
    return { des, m, rows, delayRows, flip: [0.002, 5e-4].map((fr) => fr / des.Ki) }
  }, [])
  return (
    <ChapterSection
      id="ch06-s6"
      kicker="§6"
      title={
        <>
          多頻輸入：<Tex>{'C=\\frac{1}{2\\pi}\\int S_{xx}\\operatorname{Re}H\\,d\\Omega'}</Tex>
        </>
      }
    >
      <p>
        真實的 DSM code 不是單一正弦，而是很多頻率的混合。這一節把 §4 推廣到任意（廣義平穩）code，結論是：
        <strong>
          <Tex>{'C'}</Tex> 是 <Tex>{'\\operatorname{Re}H'}</Tex> 以 code 的功率頻譜為權重的加權平均
        </strong>
        ——不是只看某一個頻率的相位。
      </p>
      <p>
        先認識兩個新的量（下面的先備知識框會從頭解釋）：<strong>功率頻譜密度</strong> <Tex>{'S_{xx}(e^{j\\Omega})'}</Tex> 告訴你 code 的功率分布在哪些頻率；
        <strong>自相關</strong> <Tex>{'R_x[\\ell]=E\\big[x[n]\\,x[n+\\ell]\\big]'}</Tex> 是 code 和「自己平移 <Tex>{'\\ell'}</Tex> 個 sample」的相關。兩者是同一份資訊的頻域與時域寫法；
        <Tex>{'\\sigma_x^2=E[x^2]'}</Tex> 是 code 的總功率。
      </p>
      <ChapterDiagram id="D-06.15">
        <p>
          圖上拿三條譜線當例子。先看每一列：一條頻率 <Tex>{'\\Omega_m'}</Tex> 的譜線有功率 <Tex>{'P_m'}</Tex>（單頻時 <Tex>{'P=A^2/2'}</Tex>，永遠是正的），乘上主 PLL
          在那個頻率的 <Tex>{'\\operatorname{Re}H'}</Tex>——這就是 §4 的單頻結果（<Tex>{'D=0'}</Tex> 時 <Tex>{'\\tfrac{A^2}{2}|H|\\cos\\phi=\\tfrac{A^2}{2}\\operatorname{Re}H'}</Tex>）。
          再看加法點：不同頻率的貢獻直接相加（不同頻率的正弦相乘後平均為 0，沒有交叉項）。對 Type-II，低頻那一列是負的（紅色）、高頻那一列是正的（綠色），
          <Tex>{'C'}</Tex> 的正負就看誰的功率大。
        </p>
        <p>
          圖上的 <Tex>{'P_m'}</Tex> 換成連續頻譜就是 <Tex>{'S_{xx}\\,d\\Omega/2\\pi'}</Tex>，「全部加起來」就變成積分——也就是下面 F-06.11 的{' '}
          <Tex>{'C=\\tfrac{1}{2\\pi}\\int S_{xx}\\operatorname{Re}H\\,d\\Omega'}</Tex>（<Tex>{'D\\ne0'}</Tex> 時把 <Tex>{'\\operatorname{Re}H'}</Tex> 換成{' '}
          <Tex>{'\\operatorname{Re}\\{He^{j\\Omega D}\\}'}</Tex>）。
        </p>
      </ChapterDiagram>

      <Prereq title={String.raw`自相關 $R_x[\ell]$`}>
        <p>
          <Tex>{'R_x[\\ell]=E\\big[x[n]\\,x[n+\\ell]\\big]'}</Tex>：訊號和「自己平移 <Tex>{'\\ell'}</Tex> 個 sample 的版本」的相關。
          <strong>廣義平穩</strong>（wide-sense stationary）的意思是這個值只跟間隔 <Tex>{'\\ell'}</Tex> 有關、跟 <Tex>{'n'}</Tex> 無關。性質：<Tex>{'R_x[-\\ell]=R_x[\\ell]'}</Tex>（偶函數）、<Tex>{'R_x[0]=E[x^2]=\\sigma_x^2'}</Tex>（零平均時）。
        </p>
      </Prereq>
      <Prereq title="功率頻譜密度 PSD、Wiener–Khinchin 與 Parseval">
        <p>
          PSD 是自相關的 DTFT：<Tex>{'S_{xx}(e^{j\\Omega})=\\sum_\\ell R_x[\\ell]e^{-j\\Omega\\ell}'}</Tex>，反過來{' '}
          <Tex>{'R_x[\\ell]=\\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi}S_{xx}(e^{j\\Omega})e^{j\\Omega\\ell}d\\Omega'}</Tex>（Wiener–Khinchin）。
          它告訴你「功率分布在哪些頻率」：<Tex>{'S_{xx}\\ge0'}</Tex>，實數訊號的 <Tex>{'S_{xx}'}</Tex> 對 <Tex>{'\\Omega'}</Tex> 是偶函數。
        </p>
        <p>
          令 <Tex>{'\\ell=0'}</Tex> 得到 <strong>Parseval</strong>：<Tex>{'\\sigma_x^2=R_x[0]=\\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi}S_{xx}\\,d\\Omega'}</Tex>——總功率 = 頻譜面積除以{' '}
          <Tex>{'2\\pi'}</Tex>。
        </p>
        <ul className="small">
          <li>
            單頻 <Tex>{'A\\cos\\Omega_0n'}</Tex>：<Tex>{'R_x[\\ell]=\\tfrac{A^2}{2}\\cos\\Omega_0\\ell'}</Tex>，頻譜是兩條線{' '}
            <Tex>{'S_{xx}=\\tfrac{\\pi A^2}{2}\\big[\\delta(\\Omega-\\Omega_0)+\\delta(\\Omega+\\Omega_0)\\big]'}</Tex>（每條面積 <Tex>{'\\pi A^2/2'}</Tex>），
            <Tex>{'\\tfrac{1}{2\\pi}\\int S_{xx}\\,d\\Omega=\\tfrac{A^2}{2}'}</Tex> ✓。
          </li>
          <li>
            白色雜訊：<Tex>{'S=\\sigma_x^2'}</Tex>（平的），<Tex>{'R_x[\\ell]=\\sigma_x^2\\delta[\\ell]'}</Tex>。
          </li>
          <li>
            單位注意 <Erratum id="E28" />：這裡是 DTFT 形式的雙邊密度（<Tex>{'\\sigma_x^2=\\int S_{xx}\\,d(\\Omega/2\\pi)'}</Tex>，也就是「每 cycle/sample」），
            不是頻譜分析儀的 one-sided per-Hz；換算{' '}
            <Tex>{'S^{(1)}(f)=2S(e^{j2\\pi f/f_s})/f_s'}</Tex>。
          </li>
        </ul>
      </Prereq>

      <StepBox title="逐步推導多頻判據">
        <StepDerivation
          steps={[
            { tex: String.raw`C_D=E\big[x[n-D]\,u[n]\big]=E\Big[x[n-D]\sum_k h[k]\,x[n-k]\Big]`, why: <>代入卷積 <Tex>{'u=h*x'}</Tex>。</> },
            { tex: String.raw`=\sum_k h[k]\,E\big[x[n-D]\,x[n-k]\big]=\sum_k h[k]\,R_x[k-D]`, why: <>期望值是線性的（<Tex>{'h[k]'}</Tex> 是常數）；平穩 ⇒ 只跟間隔 <Tex>{'(n-k)-(n-D)=D-k'}</Tex> 有關，<Tex>{'R_x'}</Tex> 是偶函數。</> },
            { tex: String.raw`=\sum_k h[k]\,\frac{1}{2\pi}\int_{-\pi}^{\pi}S_{xx}(e^{j\Omega})\,e^{j\Omega(k-D)}\,d\Omega`, why: <>Wiener–Khinchin：把 <Tex>{'R_x'}</Tex> 寫成 PSD 的反轉換。</> },
            { tex: String.raw`=\frac{1}{2\pi}\int_{-\pi}^{\pi}S_{xx}(e^{j\Omega})\Big(\sum_k h[k]e^{j\Omega k}\Big)e^{-j\Omega D}\,d\Omega`, why: <>交換求和與積分（有限能量 <Tex>{'h'}</Tex>、穩定路徑）。</> },
            { tex: String.raw`\sum_k h[k]e^{j\Omega k}=H(e^{-j\Omega})=\overline{H(e^{j\Omega})}`, why: <><Tex>{'h'}</Tex> 是實數 ⇒ 換 <Tex>{'\\Omega'}</Tex> 的符號等於取共軛。</> },
            { tex: String.raw`C_D=\frac{1}{2\pi}\int_{-\pi}^{\pi}S_{xx}\;\overline{H(e^{j\Omega})\,e^{j\Omega D}}\;d\Omega`, why: <>把 <Tex>{'e^{-j\\Omega D}'}</Tex> 一起放進共軛（<Tex>{'\\overline{z}\\,\\overline{w}=\\overline{zw}'}</Tex>）。</> },
            { tex: String.raw`\operatorname{Im}\{He^{j\Omega D}\}\text{ 是 }\Omega\text{ 的奇函數},\;S_{xx}\text{ 是偶函數}\;\Rightarrow\;\int S_{xx}\operatorname{Im}\{\cdot\}\,d\Omega=0`, why: '奇函數在對稱區間的積分為 0；只剩實部。' },
          ]}
        />
        <TexBlock id="F-06.11">{String.raw`\boxed{C_D=\frac{1}{2\pi}\int_{-\pi}^{\pi}S_{xx}(e^{j\Omega})\,\operatorname{Re}\{H_{\mathrm{PD}}(e^{j\Omega})\,e^{j\Omega D}\}\,d\Omega}`}</TexBlock>
        <TexBlock id="F-06.12">{String.raw`C_D=\sum_{k\ge0}h[k]\,R_x[k-D]`}</TexBlock>
        <p className="ch06-tags">
          <ClaimTag kind="exact" />
          <span className="small">
            條件：<Tex>{'x'}</Tex> 廣義平穩、路徑 LTI 且穩定；<Tex>{'S_{xx}'}</Tex> 與 <Tex>{'H'}</Tex> 都用 DT 形式（<Tex>{'\\Omega'}</Tex> 為
            rad/sample）<Erratum id="E44" />。
          </span>
        </p>
      </StepBox>

      <h3>
        6.1 讀法：<Tex>{'C/\\sigma_x^2'}</Tex> 是 <Tex>{'\\operatorname{Re}H'}</Tex> 的加權平均
      </h3>
      <p>
        令 <Tex>{'p(\\Omega)=S_{xx}(e^{j\\Omega})/(2\\pi\\sigma_x^2)'}</Tex>。它非負、積分為 1（Parseval），就像一個「頻率的機率分布」。<Tex>{'D=0'}</Tex> 時：
      </p>
      <TexBlock>{String.raw`\frac{C}{\sigma_x^2}=\int_{-\pi}^{\pi}p(\Omega)\,\operatorname{Re}H(e^{j\Omega})\,d\Omega\quad\Rightarrow\quad\min_\Omega\operatorname{Re}H\;\le\;\frac{C}{\sigma_x^2}\;\le\;\max_\Omega\operatorname{Re}H`}</TexBlock>
      <ul>
        <li>
          <strong>Type-I（無額外 latency）</strong>：<Tex>{'\\operatorname{Re}H>0'}</Tex> 處處成立 ⇒ <strong>任何 code</strong> 的 <Tex>{'C>0'}</Tex>。只會變慢，不會變號。{' '}
          <ClaimTag kind="exact" />（CT：F-06.7；DT <Tex>{'d=0'}</Tex>：<Tex>{'H=\\frac{1-z^{-1}}{1-\\rho z^{-1}},\\;\\rho=1-K'}</Tex>，
          <Tex>{'\\operatorname{Re}H=\\frac{(1+\\rho)(1-\\cos\\Omega)}{|1-\\rho e^{-j\\Omega}|^2}\\ge0'}</Tex>）
        </li>
        <li>
          <strong>Type-II</strong>：只要 code 的功率主要落在 <Tex>{'\\Omega<\\omega_nT_s'}</Tex>（<Tex>{'\\operatorname{Re}H<0'}</Tex> 的頻帶），<Tex>{'C'}</Tex>{' '}
          就是負的（例外見 §6.4：有跳變的鋸齒）。
        </li>
        <li>
          所以規格說「<Tex>{'C'}</Tex> 是 PSD、Magnitude、Phase 的<strong>加權總和</strong>，不是只看某個頻率的 PM」。
        </li>
      </ul>
      <h3>6.2 兩個精確的特例（用來驗證程式）</h3>
      <ChapterDiagram id="D-06.16">
        <p>
          從最上面的一般式出發（時域與頻域兩種寫法，即 F-06.12 與 F-06.11）。先看白色 code 那一支：白色 code 相鄰的 sample 互不相關，<Tex>{'R_x[\\ell]'}</Tex> 只在{' '}
          <Tex>{'\\ell=0'}</Tex> 不為零，所以求和只剩 <Tex>{'k=D'}</Tex> 那一項——<Tex>{'C_D'}</Tex> 就是脈衝響應在第 <Tex>{'D'}</Tex> 拍的值乘上 code 功率。再看單頻那一支：頻譜只有{' '}
          <Tex>{'\\pm\\Omega_0'}</Tex> 兩條線，積分只取到這兩點，回到 §4 的公式。
        </p>
        <p>
          圖上綠色那格的 <Tex>{'h[0]=1'}</Tex> 意思是：DT 迴路的 DCO 要到下一拍才反應，誤差出現的那一拍 PD 原封不動地看到它。所以白色 code 的 raw-x LMS 永遠有{' '}
          <Tex>{'C=\\sigma_x^2>0'}</Tex>，就是下面的 F-06.13。
        </p>
      </ChapterDiagram>
      <ul>
        <li>
          單頻：把兩條線代入，得 <Tex>{'C_D=\\tfrac{A^2}{2}\\operatorname{Re}\\{H(e^{j\\Omega_0})e^{j\\Omega_0D}\\}=\\tfrac{A^2}{2}|H|\\cos(\\phi+\\Omega_0D)'}</Tex>——就是 §4 的 F-06.4。
        </li>
        <li>
          白色 code：<Tex>{'S_{xx}=\\sigma_x^2'}</Tex> ⇒ <Tex>{'C_D=\\sigma_x^2\\cdot\\frac1{2\\pi}\\int\\operatorname{Re}\\{He^{j\\Omega D}\\}d\\Omega=\\sigma_x^2\\,h[D]'}</Tex>（反 DTFT 在 <Tex>{'D'}</Tex> 的值）。
        </li>
      </ul>
      <TexBlock id="F-06.13">{String.raw`\boxed{S_{xx}=\sigma_x^2\;\Rightarrow\;C_D=h[D]\,\sigma_x^2,\qquad C_0=h[0]\,\sigma_x^2=\sigma_x^2}`}</TexBlock>
      <p className="small">
        DT 主迴路嚴格因果（DCO 至少一個 sample 延遲）⇒ <Tex>{'h[0]=1'}</Tex>，白色 code 的 raw-x LMS 永遠有 <Tex>{'C=\\sigma_x^2>0'}</Tex>（E44 的精確結論）。
        白色 code 的功率平均分布在所有頻率，絕大部分落在迴路頻寬之外，PLL 來不及追，所以 PD 幾乎原封不動地看到它。
      </p>
      <ChapterHandCalc
        id="HC-06.7"
        lead={String.raw`用最簡單的「多頻」code 體會這個加權平均：兩個正弦，一個在 Type-II 的反相頻帶（$\nu_1<1$）、一個在迴路頻寬外（$\nu_2>1$）。先用紙筆算兩個 $\operatorname{Re}H$，再依功率 $A^2/2$ 加權；改動 $A_2$，找出 $C$ 變號的那一點。`}
      />

      <h3>
        6.3 六種算法，同一個 <Tex>{'C'}</Tex>
      </h3>
      <p>
        <JumpTo target="ch06-s7">§7 的 Polarity Explorer</JumpTo>（PLL 模式）對同一段 code 同時用下面四種數值方法算 <Tex>{'C'}</Tex>，並與封閉式（tone、iid、一階
        DSM 有）比較；單元測試另以 AR(1) × 隨機 FIR 的 Python 參考值驗證到 <Tex>{'10^{-10}'}</Tex>。
      </p>
      <ChapterDiagram id="D-06.17">
        <p>
          先看時域路線：從 code 算出自相關 <Tex>{'R_x'}</Tex>，從主 PLL 路徑算出脈衝響應 <Tex>{'h'}</Tex>，兩者配對求和。再看頻域路線：code 的功率頻譜{' '}
          <Tex>{'S_{xx}'}</Tex> 配上頻率響應 <Tex>{'H'}</Tex>，對頻率積分。兩條虛線表示每一對都是同一件東西的兩種表示（互為 DTFT），所以兩條路線一定得到同一個{' '}
          <Tex>{'C_D'}</Tex>。
        </p>
        <p>
          圖上的時域路線就是 F-06.12、頻域路線就是 F-06.11。下表的六種算法都是這兩條路線的變形：「鋸齒自相關」「自相關和」「時域經驗值」走時域，「單頻封閉式」「頻域積分」「譜線和」走頻域。
        </p>
      </ChapterDiagram>
      <div className="table-wrap">
        <table className="ch06-table">
          <thead>
            <tr>
              <th>方法</th>
              <th>需要什麼</th>
              <th>精確性</th>
              <th>運算量</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>單頻封閉式 F-06.4</td>
              <td>
                <Tex>{'|H|,\\;\\phi,\\;\\Omega'}</Tex>
              </td>
              <td>單頻精確（E46 條件）</td>
              <td>
                <Tex>{'O(1)'}</Tex>
              </td>
            </tr>
            <tr>
              <td>鋸齒自相關 F-06.17（一階 DSM）</td>
              <td>
                <Tex>{'h[k]'}</Tex>、<Tex>{'\\mathrm{frac}'}</Tex>
              </td>
              <td>相位等分布的理想鋸齒精確；不需截斷譜線</td>
              <td>
                <Tex>{'O(h\\text{ 長度})'}</Tex>
              </td>
            </tr>
            <tr>
              <td>頻域積分 F-06.11</td>
              <td>
                PSD 估計 + <Tex>{'H(e^{j\\Omega})'}</Tex>
              </td>
              <td>PSD 精確時精確；Welch 有 leakage / 窗偏差</td>
              <td>
                <Tex>{'O(\\text{格點數})'}</Tex>
              </td>
            </tr>
            <tr>
              <td>譜線和（週期圖）F-06.16</td>
              <td>
                一段 <Tex>{'L'}</Tex> 點紀錄的 DFT
              </td>
              <td>
                對循環相關是恆等式；與線性濾波差 <Tex>{'O(h\\text{ 長度}/L)'}</Tex>
              </td>
              <td>
                <Tex>{'O(L\\log L)'}</Tex>
              </td>
            </tr>
            <tr>
              <td>自相關和 F-06.12</td>
              <td>
                截斷的 <Tex>{'h[k]'}</Tex> 與 <Tex>{'R_x'}</Tex>
              </td>
              <td>
                <Tex>{'R_x'}</Tex> 精確時精確；IIR 需截斷
              </td>
              <td>
                <Tex>{'O(L\\log L)'}</Tex>（FFT 自相關）
              </td>
            </tr>
            <tr>
              <td>時域經驗值</td>
              <td>
                <Tex>{'x'}</Tex>、<Tex>{'u'}</Tex> 兩段序列
              </td>
              <td>
                有限樣本估計（週期 code 誤差 <Tex>{'\\sim1/L'}</Tex>，隨機 code <Tex>{'\\sim1/\\sqrt L'}</Tex>）
              </td>
              <td>
                <Tex>{'O(L)'}</Tex>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <CodeCompare
        layout="tabs"
        items={[
          { label: '頻域積分', source: polaritySrc, region: 'spectralCorrelation', path: PATH, note: String.raw`梯形法；半邊格點 $[0,\pi]$` },
          { label: '譜線和', source: polaritySrc, region: 'lineCorrelation', path: PATH, note: '單頻、鋸齒、三角波、週期圖都是它的特例' },
          { label: '自相關和', source: polaritySrc, region: 'autocorrCorrelation', path: PATH, note: String.raw`$\sum_k h[k]\,R_x[k-D]$` },
          { label: '時域經驗值', source: polaritySrc, region: 'empiricalCorrelation', path: PATH, note: 'GMAC 去掉 comparator 後的樣子' },
        ]}
        caption="四個函式都在 Polarity Explorer 的 PLL 模式中實際執行，結果列在指標表。"
      />
      <ModeGate min="research">
        <StepBox title="（Research）週期圖譜線和為什麼是精確恆等式" min="research">
          <StepDerivation
            steps={[
              { tex: String.raw`\frac1L\sum_{n=0}^{L-1}a[n]\,b[n]=\frac{1}{L^2}\sum_{m=0}^{L-1}\overline{A[m]}\,B[m]`, why: <>離散 Parseval（實數 <Tex>{'a'}</Tex>）：時域內積 = 頻域內積 / <Tex>{'L'}</Tex>。</> },
              { tex: String.raw`a[n]=x[(n-D)\bmod L]\Rightarrow A[m]=X[m]e^{-j\Omega_mD};\quad b=h\circledast x\Rightarrow B[m]=H(e^{j\Omega_m})X[m]`, why: '循環平移 = 乘相位；循環卷積 = 相乘。' },
              { tex: String.raw`\hat C_D=\sum_{m=0}^{L-1}\frac{|X[m]|^2}{L^2}\,H(e^{j\Omega_m})\,e^{j\Omega_mD}`, why: <>代入；<Tex>{'|X[m]|^2'}</Tex> 是實數，<Tex>{'m'}</Tex> 與 <Tex>{'L-m'}</Tex> 共軛成對，和為實數 ⇒ 取實部。</> },
            ]}
          />
          <TexBlock id="F-06.16">{String.raw`\hat C_D=\sum_{m=0}^{L-1}\frac{|X[m]|^2}{L^2}\operatorname{Re}\{H(e^{j\Omega_m})e^{j\Omega_mD}\},\qquad\Omega_m=\frac{2\pi m}{L}`}</TexBlock>
          <p className="small">
            這就是 F-06.11 在 DFT 格點上的版本（<Tex>{'S\\approx|X|^2/L'}</Tex>、<Tex>{'d\\Omega=2\\pi/L'}</Tex>）。與「線性」濾波的時域值只差 IIR 暫態造成的邊緣項，
            實驗中兩者的差通常小於 <Tex>{'10^{-3}'}</Tex>。
          </p>
        </StepBox>
      </ModeGate>

      <h3>6.4 近整數 FCW：residue 的能量跑到低頻，會發生什麼？</h3>
      <p>
        FCW（frequency control word）是 PLL 的除頻比，寫成「整數 + 小數」，小數部分記作 <Tex>{'\\mathrm{frac}'}</Tex>。
        一階 DSM 的 DTC phase residue 在 FCW 接近整數（<Tex>{'\\mathrm{frac}'}</Tex> 很小）時是一個很慢的鋸齒波：每 <Tex>{'1/\\mathrm{frac}'}</Tex> 個 reference
        cycle 線性地走完一趟、再跳回起點。它的基頻 <Tex>{'\\Omega_0=2\\pi\\,\\mathrm{frac}'}</Tex> 會掉到迴路頻寬以下——正是 Type-II{' '}
        <Tex>{'\\operatorname{Re}H<0'}</Tex> 的頻帶。
      </p>
      <ChapterDiagram id="D-06.18">
        <p>
          從上往下：FCW 的小數 <Tex>{'\\mathrm{frac}'}</Tex> 越小，一階 DSM 的 residue 鋸齒折返得越慢，基頻 <Tex>{'\\Omega_0=2\\pi\\,\\mathrm{frac}'}</Tex> 越低。菱形比較的是{' '}
          <Tex>{'\\Delta=\\Omega_0/(\\omega_nT_s)'}</Tex>：鋸齒基頻相對於迴路自然頻率的比值。<Tex>{'\\Delta\\gg1'}</Tex>（綠色）時所有諧波都在迴路頻寬外，PD
          幾乎原封不動地看到 code；<Tex>{'\\Delta\\ll1'}</Tex>（紅色）時低次諧波掉進 Type-II <Tex>{'\\operatorname{Re}H<0'}</Tex> 的頻帶——regressor
          的能量被搬進了反相頻帶。但鋸齒有折返的跳變，高次諧波拖著一條只以 <Tex>{'1/k^2'}</Tex> 衰減的尾巴，仍在頻寬外（<Tex>{'\\operatorname{Re}H\\approx+1'}</Tex>），兩邊幾乎抵消（棕色）。
        </p>
        <p>
          把圖 6.15 的三條譜線換成鋸齒的無限多條諧波（第 <Tex>{'k'}</Tex> 條的功率 <Tex>{'P_k\\propto1/k^2'}</Tex>），就是這張圖；最後一格的{' '}
          <Tex>{'\\tfrac{3}{\\pi^2}\\Delta^2'}</Tex> 就是後面 F-06.14 的結果。
        </p>
      </ChapterDiagram>
      <p>
        直覺會說「基頻掉進反相頻帶，那 <Tex>{'C'}</Tex> 一定變負」。精確計算的答案比較細緻，分三層（下面的圖 6.19 把它畫成一棵決策樹）：
      </p>
      <ol>
        <li>
          <strong>
            小訊號、<Tex>{'D=0'}</Tex>：不會變號，而是 <Tex>{'C\\to0^+'}</Tex>
          </strong>
          （恢復力以 <Tex>{'\\mathrm{frac}^2'}</Tex> 消失）。下面用兩種方法證明：方法 1 只用泰勒展開（DT 精確），方法 2 用頻域（CT 原型）。
        </li>
        <li>
          <strong>誤差一大就會變號</strong>（但書 1）：1-bit comparator 讓 <Tex>{'\\delta=0'}</Tex> 只是局部穩定，basin 半徑 <Tex>{'\\delta_c'}</Tex> 隨 frac 變小而縮小。
        </li>
        <li>
          <strong>regressor 落後一個 sample 就會變號</strong>（但書 2）：<Tex>{'D\\ge1'}</Tex> 時連小訊號的 <Tex>{'C_D'}</Tex> 都是負的。
        </li>
      </ol>
      <p>
        所以「近整數 FCW 會讓 Type-II 的極性反轉」是對的，只是機制不是「基頻落在反相頻帶」這麼單純（那個論證對平滑 code 才成立，見本節最後）。
      </p>
      <ChapterDiagram id="D-06.19">
        <p>
          先問 GMAC 的 code delay <Tex>{'D'}</Tex>：<Tex>{'D=0'}</Tex>（regressor 和 PD 誤差完全對齊）走一邊，<Tex>{'D\\ge1'}</Tex> 走另一邊。對齊的那一邊再問誤差大小：
          <Tex>{'|\\delta|'}</Tex> 小於 basin 半徑 <Tex>{'\\delta_c'}</Tex> 時是小訊號結論（棕色：不變號，但恢復力趨近 0）；超過 <Tex>{'\\delta_c'}</Tex> 就是但書
          1（紅色）。沒對齊的那一邊比較 <Tex>{'D'}</Tex> 和門檻 <Tex>{'\\mathrm{frac}/K_i'}</Tex>：超過門檻就是但書 2（紅色），連小訊號都變號。這裡{' '}
          <Tex>{'K_i=(\\omega_nT_s)^2'}</Tex> 是 5.4 的積分增益，<Tex>{'d'}</Tex> 是主迴路的額外 latency。
        </p>
        <p>
          圖上三個有公式的格子，依序對應本節的 F-06.14（小訊號）、F-06.19 的 mean-field 特性（但書 1；<Tex>{'\\delta_c'}</Tex> 是它的變號點）與 F-06.18（但書 2）；下面依這個順序推導。
        </p>
      </ChapterDiagram>
      <p>
        要算 <Tex>{'C'}</Tex>，先要知道鋸齒 code 的自相關。白話：相隔 <Tex>{'\\ell'}</Tex> 個 sample 的兩個鋸齒值，大部分時候只差一小段（一起沿著斜坡走）；但只要中間折返過一次，
        兩個值就差了一整個峰對峰。折返的機率正比於間隔——這讓自相關多出一個<strong>一次項</strong>，是鋸齒和平滑 code 最大的不同。
      </p>
      <ChapterDiagram id="D-06.20">
        <p>
          先看最上面：把鋸齒寫成相位 <Tex>{'\\theta'}</Tex>（0 到 1 均勻分布），值是 <Tex>{'\\theta-\\tfrac12'}</Tex>。過了 <Tex>{'\\ell'}</Tex> 個 sample，相位前進{' '}
          <Tex>{'t'}</Tex>（<Tex>{'\\ell\\cdot\\mathrm{frac}'}</Tex> 的小數部分）。再看菱形：<Tex>{'\\theta+t'}</Tex> 沒超過 1 就沒折返，兩個值只差 <Tex>{'t'}</Tex>；超過了（紅色，機率{' '}
          <Tex>{'t'}</Tex>）就多扣 1。把兩種情況對 <Tex>{'\\theta'}</Tex> 平均，得到最下面的結果。
        </p>
        <p>
          圖上的 <Tex>{'t'}</Tex> 就是 F-06.17 的 <Tex>{'t_\\ell'}</Tex>；下面先備知識框的第 2 步把積分拆成兩段，正是菱形的兩個出口。
        </p>
      </ChapterDiagram>
      <Prereq title="鋸齒波的自相關（直接積分）與 Fourier 級數">
        <p>
          峰對峰 1 的鋸齒 <Tex>{'s(\\theta)=\\theta-\\tfrac12'}</Tex>（<Tex>{'0\\le\\theta<1'}</Tex>，以週期 1 延伸；<Tex>{'\\theta'}</Tex> 以「週期」為單位）。相位等分布時，
          相隔 <Tex>{'t'}</Tex> 個週期（<Tex>{'0\\le t<1'}</Tex>）的自相關是對 <Tex>{'\\theta'}</Tex> 的平均：
        </p>
        <StepDerivation
          steps={[
            {
              tex: String.raw`R(t)=\int_0^1\big(\theta-\tfrac12\big)\big(\mathrm{frac}(\theta+t)-\tfrac12\big)\,d\theta`,
              why: <>自相關的定義：等分布的相位 <Tex>{'\\theta'}</Tex> 在 <Tex>{'[0,1)'}</Tex> 上平均（時間平均 = 對相位積分）。</>,
            },
            {
              tex: String.raw`=\int_0^{1}\big(\theta-\tfrac12\big)\big(\theta+t-\tfrac12\big)d\theta-\int_{1-t}^{1}\big(\theta-\tfrac12\big)d\theta`,
              why: (
                <>
                  <Tex>{'\\theta+t\\ge1'}</Tex>（即 <Tex>{'\\theta\\ge1-t'}</Tex>）時鋸齒已折返：<Tex>{'\\mathrm{frac}(\\theta+t)=\\theta+t-1'}</Tex>，多出一項 <Tex>{'-1'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`=\frac1{12}+t\cdot0-\Big[\tfrac12\big(\theta-\tfrac12\big)^2\Big]_{1-t}^{1}=\frac1{12}-\frac18+\frac12\big(\tfrac12-t\big)^2`,
              why: (
                <>
                  第一項：<Tex>{'\\int_0^1(\\theta-\\frac12)^2d\\theta=\\frac1{12}'}</Tex>，<Tex>{'\\int_0^1(\\theta-\\frac12)d\\theta=0'}</Tex>；第二項直接積分。
                </>
              ),
            },
            {
              tex: String.raw`R(t)=\frac1{12}-\frac{t(1-t)}{2},\qquad\frac{R(t)}{\sigma_x^2}=1-6\,t(1-t),\quad\sigma_x^2=R(0)=\frac1{12}`,
              why: <>展開 <Tex>{'\\tfrac12(\\tfrac12-t)^2=\\tfrac18-\\tfrac t2+\\tfrac{t^2}2'}</Tex> 後整理；<Tex>{'\\sigma_x^2=1/12'}</Tex> 就是均勻分布的變異數。</>,
            },
          ]}
        />
        <p className="small">
          頻域看法：<Tex>{'s(\\theta)=-\\sum_{k\\ge1}\\frac{\\sin 2\\pi k\\theta}{\\pi k}'}</Tex>，第 <Tex>{'k'}</Tex> 次諧波功率 <Tex>{'P_k=\\frac{1}{2\\pi^2k^2}'}</Tex>，
          總和 <Tex>{'\\sum P_k=\\frac{1}{2\\pi^2}\\cdot\\frac{\\pi^2}{6}=\\frac1{12}'}</Tex>。功率頻譜像 <Tex>{'1/\\Omega^2'}</Tex>：低頻多，但因為有
          <strong>折返的跳變</strong>，高頻也拖著一條長尾巴（只衰減成 <Tex>{'1/k^2'}</Tex>）。
        </p>
      </Prereq>

      <p>
        結論（一階 DSM residue = 相位等分布的理想鋸齒；<Tex>{'t'}</Tex> 是兩個 sample 之間的鋸齒相位差，以週期為單位）：
      </p>
      <TexBlock id="F-06.17">{String.raw`\boxed{\frac{R_x[\ell]}{\sigma_x^2}=1-6\,t_\ell(1-t_\ell),\qquad t_\ell=\mathrm{frac}\big(|\ell|\cdot\mathrm{frac}\big)}`}</TexBlock>
      <p className="ch06-tags">
        <ClaimTag kind="exact" />
        <span className="small">注意 <Tex>{'t'}</Tex> 很小時 <Tex>{'R/\\sigma_x^2\\approx1-6t+6t^2'}</Tex> 有一個<strong>一次項</strong>——來自折返跳變；平滑 code 沒有一次項。</span>
      </p>
      <ModeGate min="research">
        <StepBox title={String.raw`（Research）有限相位格點：$\mathrm{frac}=0.25$ 這類 FCW 的修正`} min="research">
          <p>
            上面假設相位在 <Tex>{'[0,1)'}</Tex> 連續等分布。<Tex>{'B'}</Tex>-bit 累加器（<Tex>{'M=2^B'}</Tex>、<Tex>{'K=\\mathrm{round}(\\mathrm{frac}\\cdot M)'}</Tex>）的相位其實只取{' '}
            <Tex>{'P=M/\\gcd(K,M)'}</Tex> 個等距值 <Tex>{'j/P'}</Tex>；<Tex>{'P'}</Tex> 很小時（例如 <Tex>{'\\mathrm{frac}=0.25\\Rightarrow P=4'}</Tex>）要用離散求和重算：
          </p>
          <StepDerivation
            steps={[
              {
                tex: String.raw`E[a\,b]=\frac1P\sum_{j=0}^{P-1}\frac{j}{P}\cdot\frac{(j+s)\bmod P}{P},\qquad t=\frac{s}{P}`,
                why: (
                  <>
                    <Tex>{'a=j/P'}</Tex> 是現在的相位，<Tex>{'b'}</Tex> 是 <Tex>{'\\ell'}</Tex> 個 sample 後的相位（往前走 <Tex>{'s'}</Tex> 格，超過就折返）。
                  </>
                ),
              },
              {
                tex: String.raw`=\frac{1}{P^3}\Big[\sum_j j^2+s\sum_j j-P\!\!\sum_{j=P-s}^{P-1}\!\!j\Big]=\frac{(P-1)(2P-1)}{6P^2}-\frac{s\,(P-s)}{2P^2}`,
                why: (
                  <>
                    折返的 <Tex>{'s'}</Tex> 個點各少 <Tex>{'P'}</Tex>；用 <Tex>{'\\sum j=\\tfrac{P(P-1)}{2}'}</Tex>、<Tex>{'\\sum j^2=\\tfrac{(P-1)P(2P-1)}{6}'}</Tex> 化簡。
                  </>
                ),
              },
              {
                tex: String.raw`R=E[a\,b]-\Big(\frac{P-1}{2P}\Big)^2=\frac{P^2-1}{12P^2}-\frac{t(1-t)}{2}`,
                why: (
                  <>
                    減去平均值的平方；<Tex>{'t=0'}</Tex> 給出 <Tex>{'\\sigma_x^2=\\tfrac{P^2-1}{12P^2}'}</Tex>（離散均勻分布的變異數）。
                  </>
                ),
              },
            ]}
            result={String.raw`\frac{R_x[\ell]}{\sigma_x^2}=1-6\,\frac{P^2}{P^2-1}\,t_\ell(1-t_\ell)`}
          />
          <p className="small">
            和連續相位只差一個因子 <Tex>{'c_P=P^2/(P^2-1)'}</Tex>（<Tex>{'P=2'}</Tex>：<Tex>{'4/3'}</Tex>；<Tex>{'P=4'}</Tex>：<Tex>{'16/15'}</Tex>；<Tex>{'P\\ge8'}</Tex> 時小於 1.6%）。
            程式的 <code>dsmPhaseGrid()</code> 依分析長度決定該用哪個 <Tex>{'P'}</Tex>：紀錄涵蓋完整週期時精確；<Tex>{'\\mathrm{frac}\\approx p/q'}</Tex>{' '}
            而 20-bit 的真實週期比紀錄還長時，相位在紀錄內只在 <Tex>{'q'}</Tex> 個格點附近漂移，用等效格點數（近似）。Polarity Explorer 的「封閉式」列會註明用的是哪一種。
          </p>
          <CodeBlock source={polaritySrc} region="dsmPhaseGrid" path={PATH} title="DSM 在一段紀錄內實際走過的相位格點" />
        </StepBox>
      </ModeGate>
      <p>
        <strong>方法 1 的想法：</strong>把這個自相關代進時域公式 <Tex>{'C=\\sum_kh[k]\\,R_x[k]'}</Tex>。近整數時自相關是 <Tex>{'k'}</Tex> 的二次式，所以 <Tex>{'C'}</Tex>{' '}
        只需要脈衝響應的三個加權和——<strong>動差</strong>（moment）<Tex>{'m_j=\\sum_kk^j\\,h[k]'}</Tex>，<Tex>{'j=0,1,2'}</Tex>。
      </p>
      <ChapterDiagram id="D-06.21">
        <p>
          先看第一格：近整數時，<Tex>{'h[k]'}</Tex> 衰減完之前鋸齒還沒折返，所以自相關是 <Tex>{'k'}</Tex> 的二次式（常數項、一次項、二次項）。再看中間三格：每一項乘上{' '}
          <Tex>{'h[k]'}</Tex> 再對 <Tex>{'k'}</Tex> 求和，各得到一個動差。Type-II 的 <Tex>{'m_0=0'}</Tex>（DC 誤差被完全追掉）與 <Tex>{'m_1=0'}</Tex>（斜坡誤差也被完全追掉）讓前兩項消失（棕色），
          只剩二次項。
        </p>
        <p>
          圖上進加法點的三條線，就是公式 <Tex>{'C/\\sigma_x^2\\approx m_0-6\\,\\mathrm{frac}\\,m_1+6\\,\\mathrm{frac}^2m_2'}</Tex> 的三項；代入{' '}
          <Tex>{'m_2=2/K_i'}</Tex> 就是 F-06.14。
        </p>
      </ChapterDiagram>
      <StepBox title="方法 1（DT 精確）：鋸齒自相關 + 脈衝響應的動差">
        <StepDerivation
          steps={[
            {
              tex: String.raw`\frac{C}{\sigma_x^2}=\sum_{k\ge0}h[k]\,\frac{R_x[k]}{\sigma_x^2}=\sum_{k\ge0}h[k]\,\big(1-6t_k(1-t_k)\big)`,
              why: (
                <>
                  F-06.12（<Tex>{'D=0'}</Tex>）代入 F-06.17。這是 DT 精確式，<code>sawtoothAutocorr</code> 就是這樣算的。
                </>
              ),
            },
            {
              tex: String.raw`k\cdot\mathrm{frac}<1\;\Rightarrow\;t_k=k\,\mathrm{frac}\;\Rightarrow\;1-6t_k(1-t_k)=1-6k\,\mathrm{frac}+6k^2\mathrm{frac}^2`,
              why: (
                <>
                  近整數：<Tex>{'h[k]'}</Tex> 衰減完之前鋸齒還沒折返（<Tex>{'\\Omega_0\\ll\\omega_nT_s'}</Tex>），所以 <Tex>{'t_k'}</Tex> 就是 <Tex>{'k\\,\\mathrm{frac}'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`\frac{C}{\sigma_x^2}\approx m_0-6\,\mathrm{frac}\,m_1+6\,\mathrm{frac}^2\,m_2,\qquad m_j=\sum_k k^j\,h[k]`,
              why: <>逐項求和；<Tex>{'m_j'}</Tex> 叫做脈衝響應的第 <Tex>{'j'}</Tex> 個動差（moment）。</>,
            },
            {
              tex: String.raw`H(e^{j\Omega})=\sum_k h[k]e^{-j\Omega k}=m_0-j\Omega\,m_1-\frac{\Omega^2}{2}m_2+\cdots`,
              why: (
                <>
                  把 <Tex>{'e^{-j\\Omega k}=1-j\\Omega k-\\tfrac12\\Omega^2k^2+\\cdots'}</Tex>（泰勒展開）代入：動差就是 <Tex>{'H'}</Tex> 在 DC 的泰勒係數。
                </>
              ),
            },
            {
              tex: String.raw`H_{\text{Type-II}}=\frac{(1-e^{-j\Omega})^2}{A(e^{j\Omega})},\quad(1-e^{-j\Omega})^2=-\Omega^2+O(\Omega^3),\quad A(1)=K_i`,
              why: (
                <>
                  F-06.10 的 DT 迴路：分子是兩個積分器造成的 DC 雙重零點；分母在 <Tex>{'z=1'}</Tex> 等於 <Tex>{'(K_p+K_i)-K_p=K_i'}</Tex>，與 latency{' '}
                  <Tex>{'d'}</Tex> 無關。
                </>
              ),
            },
            {
              tex: String.raw`\Rightarrow\;H=-\frac{\Omega^2}{K_i}+O(\Omega^3)\;\Rightarrow\;m_0=0,\;m_1=0,\;m_2=\frac{2}{K_i}`,
              why: <>比較 <Tex>{'\\Omega^0,\\Omega^1,\\Omega^2'}</Tex> 的係數。<Tex>{'m_0=0'}</Tex>：PLL 完全追掉 DC；<Tex>{'m_1=0'}</Tex>：Type-II 對斜坡（頻率偏移）也是零穩態誤差。</>,
            },
            {
              tex: String.raw`\frac{C}{\sigma_x^2}\approx\frac{12\,\mathrm{frac}^2}{K_i}=\frac{12\,\mathrm{frac}^2}{(\omega_nT_s)^2}=\frac{3}{\pi^2}\Big(\frac{\Omega_0}{\omega_nT_s}\Big)^2>0`,
              why: (
                <>
                  代回，並用 <Tex>{'\\Omega_0=2\\pi\\,\\mathrm{frac}'}</Tex>：<Tex>{'12/(2\\pi)^2=3/\\pi^2'}</Tex>。一階項因 <Tex>{'m_1=0'}</Tex> 消失，只剩正的二階項。
                </>
              ),
            },
          ]}
        />
        <TexBlock id="F-06.14">{String.raw`\boxed{\frac{C}{\sigma_x^2}\approx m_0-6\,\mathrm{frac}\,m_1+6\,\mathrm{frac}^2m_2\overset{\text{Type-II}}{=}\frac{3}{\pi^2}\Big(\frac{\Omega_0}{\omega_nT_s}\Big)^2\to0^+}`}</TexBlock>
        <p className="ch06-tags">
          <ClaimTag kind="approx" />
          <span className="small">
            漸近式（<Tex>{'\\Omega_0\\ll\\omega_nT_s'}</Tex>）；對 DT 迴路、任何 latency <Tex>{'d'}</Tex> 都成立。精確值用第一行的有限和，sweep 實驗以實際 20-bit DSM residue 驗證。
          </span>
        </p>
        <p>用預設迴路（Type-II、<Tex>{'\\zeta=0.7'}</Tex>、<Tex>{'\\mathrm{BW}/f_{\\mathrm{ref}}=0.01'}</Tex>、<Tex>{'d=0'}</Tex>）即時驗算：</p>
        <TexBlock>{String.raw`\begin{gathered}\omega_nT_s=${f(near.des.wLTs, 5)},\quad K_i=${f(near.des.Ki, 5)}\\[2pt] m_0=${f(near.m[0], 2)},\;\; m_1=${f(near.m[1], 2)},\;\; m_2=${f(near.m[2], 7)}\;\;\Big(\tfrac{2}{K_i}=${f(2 / near.des.Ki, 7)}\Big)\end{gathered}`}</TexBlock>
        <div className="table-wrap">
          <table className="ch06-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'\\mathrm{frac}'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'\\Delta=\\Omega_0/(\\omega_nT_s)'}</Tex>
                </th>
                <th className="num">
                  精確 <Tex>{'\\sum_k h[k](1-6t_k(1-t_k))'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'\\tfrac{3}{\\pi^2}\\Delta^2'}</Tex>
                </th>
                <th className="num">
                  截斷 4000 條譜線（錯誤做法）
                </th>
              </tr>
            </thead>
            <tbody>
              {near.rows.map((r) => (
                <tr key={r.fr}>
                  <td className="num">{f(r.fr, 3)}</td>
                  <td className="num">{f(r.delta, 4)}</td>
                  <td className="num pos">{f(r.exact, 4)}</td>
                  <td className="num">{f(r.asym, 4)}</td>
                  <td className={`num ${r.trunc < 0 ? 'neg' : ''}`}>{f(r.trunc, 4)}</td>
                </tr>
              ))}
            </tbody>
            <caption>
              全部由 <code>sawtoothAutocorr</code> / <code>impulseMoments</code> / <code>lineCorrelation</code> 即時計算。最後一欄示範反面情況：鋸齒譜線只以{' '}
              <Tex>{'1/k^2'}</Tex> 衰減，截斷會漏掉 <Tex>{'\\approx\\tfrac{6}{\\pi^2k_{\\max}}'}</Tex> 的高頻尾巴（那裡 <Tex>{'\\operatorname{Re}H\\approx+1'}</Tex>），
              近整數時甚至把符號算錯。
            </caption>
          </table>
        </div>
        <p>
          物理圖像：Type-II 對斜坡零穩態誤差（<Tex>{'m_0=m_1=0'}</Tex>），鋸齒的每一段斜坡都被完全追掉；PD 只看到折返跳變後的暫態，
          它和鋸齒的相關只剩一個正的二階小量。對照 Type-I：<Tex>{'m_1=-1/K'}</Tex>（只追得掉 DC，追不掉斜坡），所以{' '}
          <Tex>{'C/\\sigma_x^2\\approx6\\,\\mathrm{frac}/K=\\tfrac{3}{\\pi}\\Delta'}</Tex>，是一階、衰減得比較慢。
        </p>
        <CodeBlock source={polaritySrc} region="sawtoothAutocorr" path={PATH} title="鋸齒自相關與脈衝響應動差（FCW sweep 的精確理論曲線）" />
      </StepBox>

      <StepBox title="方法 2（頻域、CT 原型）：鋸齒 residue 的「抵消定理」">
        <StepDerivation
          steps={[
            {
              tex: String.raw`\frac{C}{\sigma_x^2}=12\sum_{k\ge1}\frac{\operatorname{Re}H(e^{jk\Omega_0})}{2\pi^2k^2}=\frac{6}{\pi^2}\sum_{k\ge1}\frac{\operatorname{Re}H(e^{jk\Omega_0})}{k^2}`,
              why: (
                <>
                  譜線和（<code>lineCorrelation</code>）除以 <Tex>{'\\sigma_x^2=1/12'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`\nu_k=k\Delta,\;\Delta=\frac{\Omega_0}{\omega_nT_s}:\quad\sum_k\frac{\operatorname{Re}H}{k^2}=\Delta\sum_k\frac{\operatorname{Re}H(\nu_k)}{\nu_k^2}\,\Delta\;\approx\;\Delta\int_0^\infty\frac{\operatorname{Re}H(\nu)}{\nu^2}\,d\nu`,
              why: (
                <>
                  <Tex>{'1/k^2=\\Delta^2/\\nu_k^2'}</Tex>；<Tex>{'\\Delta'}</Tex> 很小時求和變成 Riemann 積分（CT 原型）。
                </>
              ),
            },
            {
              tex: String.raw`g(\nu)=\frac{\operatorname{Re}H}{\nu^2}=\frac{-(1-\nu^2)}{(1-\nu^2)^2+4\zeta^2\nu^2},\qquad g(1/\nu)\cdot\frac{1}{\nu^2}=-g(\nu)`,
              why: (
                <>
                  Type-II 封閉式（F-06.8）；代入 <Tex>{'\\nu\\to1/\\nu'}</Tex>，分子分母同乘 <Tex>{'\\nu^4'}</Tex> 後化簡。
                </>
              ),
            },
            {
              tex: String.raw`\int_1^\infty g(\nu)\,d\nu\overset{\nu=1/t}{=}\int_0^1 g(1/t)\,\frac{dt}{t^2}=-\int_0^1g(t)\,dt\;\Rightarrow\;\int_0^\infty g=0`,
              why: '換變數：低頻的負貢獻與高頻的正貢獻剛好抵消。',
            },
            {
              tex: String.raw`\sum_{k\ge1}g(k\Delta)\,\Delta=\int_0^\infty g-\frac{\Delta}{2}g(0)+\cdots=0+\frac{\Delta}{2}`,
              why: (
                <>
                  Euler–Maclaurin 修正：<Tex>{'g(0)=-1'}</Tex>（<Tex>{'g'}</Tex> 是 <Tex>{'\\nu'}</Tex> 的偶函數，奇階導數項為 0）。
                </>
              ),
            },
            {
              tex: String.raw`\frac{C}{\sigma_x^2}\approx\frac{6}{\pi^2}\cdot\Delta\cdot\frac{\Delta}{2}=\frac{3}{\pi^2}\Delta^2>0`,
              why: '一階項被抵消，只剩下一個正的二階小量——與方法 1 完全一致。',
            },
          ]}
        />
        <ModeGate min="research">
          <p className="small">
            （Research）這個抵消在 DT 也是精確的。利用 <Tex>{'\\sum_{m\\in\\mathbb Z}\\frac{1}{(\\Omega+2\\pi m)^2}=\\frac{1}{4\\sin^2(\\Omega/2)}'}</Tex>、
            <Tex>{'|1-e^{-j\\Omega}|^2=4\\sin^2(\\Omega/2)'}</Tex> 與 <Tex>{'\\operatorname{Re}H(e^{j\\Omega})'}</Tex> 的偶對稱：
          </p>
          <TexBlock>{String.raw`\int_0^\infty\frac{\operatorname{Re}H(e^{j\Omega})}{\Omega^2}d\Omega=\int_0^\pi\operatorname{Re}\Big\{\frac{H(e^{j\Omega})}{|1-e^{-j\Omega}|^2}\Big\}d\Omega=\int_0^\pi\operatorname{Re}\Big\{\frac{-e^{-j\Omega}}{A(e^{j\Omega})}\Big\}d\Omega=\pi f[0]=0`}</TexBlock>
          <p className="small">
            因為 Type-II 的 <Tex>{'H=(1-z^{-1})^2/A'}</Tex> 除以 <Tex>{'(1-z^{-1})(1-z)'}</Tex> 剩下 <Tex>{'F(z)=-z^{-1}/A(z)'}</Tex>，它嚴格因果（迴路穩定時{' '}
            <Tex>{'1/A'}</Tex> 是因果的冪級數），所以 <Tex>{'f[0]=0'}</Tex>。比較兩種方法的一階項可得一般恆等式{' '}
            <Tex>{'\\int_0^\\infty\\operatorname{Re}H(e^{j\\Omega})\\,\\Omega^{-2}d\\Omega=-\\tfrac{\\pi}{2}m_1'}</Tex>（Type-I：<Tex>{'m_1=-1/K'}</Tex> ⇒{' '}
            <Tex>{'\\pi/(2K)'}</Tex>，正是 CT 的 <Tex>{'\\pi/2'}</Tex> 換回 <Tex>{'\\Omega'}</Tex> 單位），所以「頻域抵消」與「<Tex>{'m_1=0'}</Tex>」是同一件事。
          </p>
        </ModeGate>
      </StepBox>
      <p>
        <strong>
          小訊號結論（<Tex>{'D=0'}</Tex>、<Tex>{'|\\delta|\\,u_{\\max}\\ll\\sigma_v'}</Tex>）：理想的一階 residue 在近整數時不會讓 Type-II 變號，而是讓恢復力以{' '}
          <Tex>{'\\mathrm{frac}^2'}</Tex> 的速度消失。
        </strong>{' '}
        <Tex>{'C\\to0^+'}</Tex> 的後果是 LMS 停滯，而線性化的固定點 <Tex>{'w^*\\approx a+B/C'}</Tex> 對任何 bias <Tex>{'B'}</Tex> 極度敏感——<Tex>{'B/C'}</Tex>{' '}
        大到超出線性範圍時，<Tex>{'{a+B/C}'}</Tex> 只是線性外推，不再是固定點（<ChRef ch="11">第 11 章</ChRef> §11.4 的代回檢查）。但這個結論有兩個重要的但書：
        誤差一大（下一個框）或 regressor 錯開一個 sample（再下一個框），符號還是會翻。
      </p>
      <p>
        <strong>但書 1 的白話：</strong>近整數時的 <Tex>{'C>0'}</Tex>，其實是「一個正數」和「一個幾乎一樣大的負數」相加剩下的。1-bit comparator 在誤差大時會飽和，而且
        <strong>先壓扁大的那一個</strong>。這裡要用不做小訊號近似的 mean-field 特性 <Tex>{'E[G](\\delta)'}</Tex>：把參數誤差固定在 <Tex>{'\\delta'}</Tex> 時 GMAC
        的平均輸出（圖 6.5 的 S 形曲線，不取切線）。
      </p>
      <ChapterDiagram id="D-06.22">
        <p>
          先看最上面：鋸齒每折返一次，等於在 PD 前加一個步階；PD 看到的是主迴路的步階響應 <Tex>{'s[k]=\\sum_{j\\le k}h[j]'}</Tex>。Type-II 的 <Tex>{'s[k]'}</Tex>{' '}
          有兩瓣，面積剛好相消：高而窄的正瓣（綠色）與矮而長的負瓣（紅色）。再往下：<Tex>{'|\\delta u|'}</Tex> 大的正瓣先碰到 comparator 的飽和區，貢獻被壓扁；負瓣的{' '}
          <Tex>{'|\\delta u|'}</Tex> 還小，貢獻繼續隨 <Tex>{'\\delta'}</Tex> 成長。最後看菱形：誤差小於 <Tex>{'\\delta_c'}</Tex> 時正瓣仍然略勝，<Tex>{'E[G]'}</Tex> 和{' '}
          <Tex>{'\\delta'}</Tex> 同號，把誤差拉回 0；超過 <Tex>{'\\delta_c'}</Tex> 之後負瓣勝出，<Tex>{'E[G]'}</Tex> 和 <Tex>{'\\delta'}</Tex> 反號，把誤差往外推。
        </p>
        <p>
          圖上的「同號／反號」就是下面推導最後一步的兩個情況；<Tex>{'\\delta_c'}</Tex> 是 <Tex>{'E[G](\\delta)'}</Tex> 第一次穿過 0 的位置（basin 半徑），推導框裡的 basin
          表列出它的數值。
        </p>
      </ChapterDiagram>
      <StepBox
        title={
          <>
            但書 1：<Tex>{'C>0'}</Tex> 只保證「局部」穩定——1-bit comparator 讓 mean-field 特性在 <Tex>{'\\delta_c'}</Tex> 變號
          </>
        }
      >
        <p>
          先看 PD 在近整數時到底看到什麼。鋸齒每折返一次，等於在 PD 前加一個高度 <Tex>{'1/\\sigma_x=\\sqrt{12}'}</Tex> 的<strong>步階</strong>（standardize 後）。PD
          看到的是主迴路的步階響應 <Tex>{'s[k]=\\sum_{j\\le k}h[j]'}</Tex>：從 <Tex>{'s[0]=h[0]=1'}</Tex> 開始被 PLL 追掉，Type-II 還會過衝成負的。
        </p>
        <StepDerivation
          steps={[
            {
              tex: String.raw`\sum_{k=0}^{K}s[k]=\sum_{k=0}^{K}\sum_{j\le k}h[j]=\sum_{j}h[j]\,(K+1-j)\;\xrightarrow{K\to\infty}\;(K+1)\,m_0-m_1`,
              why: (
                <>
                  交換求和順序：<Tex>{'h[j]'}</Tex> 出現在所有 <Tex>{'k\\ge j'}</Tex> 的項裡，共 <Tex>{'K+1-j'}</Tex> 次。
                </>
              ),
            },
            {
              tex: String.raw`\text{Type-II: }m_0=m_1=0\;\Rightarrow\;\sum_k s[k]=0`,
              why: '步階響應的正瓣面積 = 負瓣面積：高而窄的正瓣（最高 1），加上矮而長的負瓣。',
            },
            {
              tex: String.raw`C=E[x\,u]>0\ \text{但很小}:\quad\underbrace{x\cdot(\text{正瓣})}_{>0}+\underbrace{x\cdot(\text{負瓣})}_{<0}\approx0^+`,
              why: (
                <>
                  折返後 <Tex>{'x'}</Tex> 幾乎不動，兩瓣的貢獻在一階互相抵消（這就是 <Tex>{'m_1=0'}</Tex>），只剩 <Tex>{'O(\\mathrm{frac}^2)'}</Tex> 的正值。
                </>
              ),
            },
            {
              tex: String.raw`E[G](\delta)=E\Big[x\,\mathrm{erf}\!\Big(\frac{\delta u}{\sqrt2\sigma_v}\Big)\Big]:\quad|u|_{\text{正瓣}}\le\sqrt{12}\ \text{先飽和},\qquad|u|_{\text{負瓣}}\ll1\ \text{仍線性}`,
              why: (
                <>
                  F-06.19：<Tex>{'\\delta'}</Tex> 變大時，<Tex>{'\\mathrm{erf}'}</Tex> 先壓扁 <Tex>{'|u|'}</Tex> 大的正瓣；負瓣的 <Tex>{'|\\delta u|'}</Tex> 還很小，貢獻繼續隨{' '}
                  <Tex>{'\\delta'}</Tex> 線性成長。
                </>
              ),
            },
            {
              tex: String.raw`\Rightarrow\;E[G](\delta)\begin{cases}>0,&0<\delta<\delta_c\ (\text{拉回 }0)\\<0,&\delta>\delta_c\ (\text{往外推})\end{cases}`,
              why: (
                <>
                  原本就幾乎抵消的兩項，正的那項被壓扁後負的勝出。<Tex>{'\\delta=0'}</Tex> 的 basin 半徑是 <Tex>{'\\delta_c'}</Tex>。
                </>
              ),
            },
          ]}
        />
        <BasinTable />
        <p>
          <Tex>{'\\delta_c'}</Tex> 只和比值 <Tex>{'\\delta/\\sigma_v'}</Tex> 有關，而且越接近整數越小——所以<strong>「近整數會讓 Type-II 的極性反轉」在 1-bit
          迴路裡是真的，只是反轉發生在誤差超過 <Tex>{'\\delta_c'}</Tex> 之後</strong>：起始誤差太大、或 <Tex>{'\\mu'}</Tex> 太大讓穩態雜訊{' '}
          <Tex>{'3\\sigma_w'}</Tex> 接近 <Tex>{'\\delta_c'}</Tex>，<Tex>{'w'}</Tex> 就會離開 basin 而遠離 <Tex>{'a'}</Tex>。Type-I（<Tex>{'d=0'}</Tex>）的步階響應{' '}
          <Tex>{'s[k]=(1-K)^k'}</Tex> 沒有負瓣，不會有這個現象。單元測試以逐 sample 的閉迴路驗證：同一組設定（<Tex>{'\\mathrm{frac}=0.002'}</Tex>），
          <Tex>{'|\\delta_0|<\\delta_c'}</Tex> 收斂、<Tex>{'|\\delta_0|>\\delta_c'}</Tex> 遠離，而且漂移斜率等於 <Tex>{'\\mu|E[G](\\delta)|'}</Tex>。
        </p>
        <p className="ch06-tags">
          <ClaimTag kind="approx" />
          <ClaimTag kind="research" />
          <span className="small">
            mean-field（Gaussian 雜訊、時間尺度分離）；到 <JumpTo target="ch06-s7">§7</JumpTo> 載入 preset「近整數 basin」看 <Tex>{'E[G](\\delta)'}</Tex> 曲線，下方 sweep
            的第三張圖畫出 <Tex>{'\\delta_c/\\sigma_v'}</Tex> 對 frac 的變化。
          </span>
        </p>
        <CodeBlock source={polaritySrc} region="meanFieldCurve" path={PATH} title={String.raw`mean-field 特性與變號點 $\delta_c$`} />
      </StepBox>
      <p>
        <strong>但書 2 的白話：</strong>上面的抵消只在 regressor 和 PD 誤差「同一拍」相乘時才成立。GMAC 的 code 只要晚一個 sample，折返那一拍的尖峰就會乘到折返
        <strong>之前</strong>的 code。
      </p>
      <ChapterDiagram id="D-06.23">
        <p>
          先看最上面：鋸齒折返時 <Tex>{'x'}</Tex> 從頂部跳到底部，PD 當拍看到一個尖峰（<Tex>{'h[0]=1'}</Tex>），之後是 PLL 追趕的尾巴（面積 <Tex>{'-1'}</Tex>）。再比較兩條支路：
          <Tex>{'D=0'}</Tex> 時尖峰乘到折返之後的底部值，尾巴乘到的也差不多是同樣的值，兩者在一階抵消（棕色）；<Tex>{'D\\ge1'}</Tex>{' '}
          時尖峰改乘到折返之前的頂部值，和尾巴乘到的底部值差了一整個峰對峰，抵消不掉（紅色）。
        </p>
        <p>
          圖上棕色那格剩下的 <Tex>{'+12\\,\\mathrm{frac}^2/K_i'}</Tex> 就是 F-06.14；紅色那格多出的 <Tex>{'-12\\,\\mathrm{frac}\\,D'}</Tex> 就是下面 F-06.18 的一階項。
          <Tex>{'D>\\mathrm{frac}/K_i'}</Tex> 時負的一階項蓋過正的二階項，<Tex>{'C_D'}</Tex> 變負。
        </p>
      </ChapterDiagram>
      <StepBox
        title={
          <>
            但書 2：GMAC code delay <Tex>{'D\\ge1'}</Tex> 會讓近整數鋸齒在小訊號就變號
          </>
        }
      >
        <p>
          上面的 <Tex>{'C\\to0^+'}</Tex> 只對 <Tex>{'D=0'}</Tex>（regressor 與 PD 誤差完全對齊）成立。把 F-06.17 代入一般的 <Tex>{'C_D'}</Tex>：
        </p>
        <StepDerivation
          steps={[
            {
              tex: String.raw`\frac{C_D}{\sigma_x^2}=\sum_k h[k]\,\frac{R_x[k-D]}{\sigma_x^2}\approx\sum_k h[k]\big(1-6\,\mathrm{frac}\,|k-D|+6\,\mathrm{frac}^2(k-D)^2\big)`,
              why: (
                <>
                  F-06.12 與 F-06.17；近整數時 <Tex>{'|k-D|\\,\\mathrm{frac}<1'}</Tex>。注意是 <Tex>{'|k-D|'}</Tex>：自相關對 lag 是偶函數，在 lag 0 有折角（來自跳變）。
                </>
              ),
            },
            {
              tex: String.raw`\sum_k h[k]\,|k-D|=\sum_k h[k](k-D)+2\sum_{k<D}h[k](D-k)=(m_1-Dm_0)+2\sum_{k<D}h[k](D-k)`,
              why: (
                <>
                  <Tex>{'|\\ell|=\\ell+2\\max(-\\ell,0)'}</Tex>：只有 <Tex>{'k<D'}</Tex>（regressor 比誤差晚）的項會多出來。
                </>
              ),
            },
            {
              tex: String.raw`\text{Type-II: }m_0=m_1=0,\quad\sum_k h[k](k-D)^2=m_2-2Dm_1+D^2m_0=\frac{2}{K_i}`,
              why: '方法 1 已證明的動差。',
            },
            {
              tex: String.raw`h[0]=1,\;h[1]=\dots=h[d]=0\;\Rightarrow\;\sum_{k<D}h[k](D-k)=D\quad(D\le d+1)`,
              why: (
                <>
                  DT 迴路要 <Tex>{'1+d'}</Tex> 個 sample 後才開始修正，之前 PD 看到的就是原始誤差（<Tex>{'D>d+1'}</Tex> 時多出 <Tex>{'O(\\omega_nT_s)'}</Tex> 的小修正，程式照算）。
                </>
              ),
            },
            {
              tex: String.raw`\frac{C_D}{\sigma_x^2}\approx-12\,\mathrm{frac}\cdot D+\frac{12\,\mathrm{frac}^2}{K_i}\;<0\iff D>\frac{\mathrm{frac}}{K_i}=\frac{\mathrm{frac}}{(\omega_nT_s)^2}`,
              why: '代回；一階項是負的，而 D = 0 時唯一的正項只有二階。',
            },
          ]}
        />
        <TexBlock id="F-06.18">{String.raw`\boxed{\frac{C_D}{\sigma_x^2}\approx-12\,\mathrm{frac}\,D+\frac{12\,\mathrm{frac}^2}{(\omega_nT_s)^2}\quad(\text{Type-II、一階 DSM、}1\le D\le d+1)}`}</TexBlock>
        <p className="ch06-tags">
          <ClaimTag kind="approx" />
          <span className="small">動差展開，精確到 <Tex>{'\\mathrm{frac}^2'}</Tex>；單元測試與 20-bit DSM 時域模擬、閉迴路（由收斂變發散）交叉驗證。</span>
        </p>
        <p>
          物理圖像：斜坡被 Type-II 完全追掉，PD 只看到折返跳變——跳變當下的尖峰 <Tex>{'h[0]=1'}</Tex> 加上之後 PLL 追趕的尾巴（面積 <Tex>{'-1'}</Tex>）。
          <Tex>{'D=0'}</Tex> 時尖峰乘到跳變<strong>後</strong>的鋸齒底部、尾巴乘到差不多同樣的值，兩者在一階互相抵消；<Tex>{'D\\ge1'}</Tex> 時尖峰改乘到跳變
          <strong>前</strong>的鋸齒頂部，抵消不掉，留下 <Tex>{'-12\\,\\mathrm{frac}\\,D'}</Tex>。近整數時 <Tex>{'D=0'}</Tex> 的恢復力只有{' '}
          <Tex>{'O(\\mathrm{frac}^2)'}</Tex>，所以當 <Tex>{'\\mathrm{frac}<K_i=(\\omega_nT_s)^2'}</Tex> 時，<strong>一個 sample 的時間錯位就足以讓 raw-x LMS 變號</strong>——這才是「近整數 FCW
          會讓 Type-II 的極性反轉」的精確版本。
        </p>
        <div className="table-wrap">
          <table className="ch06-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'D'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'\\mathrm{frac}=0.002'}</Tex>：精確
                </th>
                <th className="num">兩項近似</th>
                <th className="num">
                  <Tex>{'\\mathrm{frac}=5\\times10^{-4}'}</Tex>：精確
                </th>
                <th className="num">兩項近似</th>
              </tr>
            </thead>
            <tbody>
              {near.delayRows.map((r) => (
                <tr key={r.D}>
                  <td className="num">{r.D}</td>
                  {r.cells.map((c, i) => (
                    <FragmentCells key={i} exact={c.exact} two={c.two} />
                  ))}
                </tr>
              ))}
            </tbody>
            <caption>
              預設 Type-II 迴路（<Tex>{'d=0'}</Tex>）的 <Tex>{'C_D/\\sigma_x^2'}</Tex>，由 <code>sawtoothAutocorr</code> 與 F-06.18 即時計算。變號門檻{' '}
              <Tex>{`D>\\mathrm{frac}/K_i=${f(near.flip[0], 3)}`}</Tex>（<Tex>{'\\mathrm{frac}=0.002'}</Tex>）、<Tex>{`${f(near.flip[1], 3)}`}</Tex>（
              <Tex>{'\\mathrm{frac}=5\\times10^{-4}'}</Tex>）。到 §7 把 PLL 模式設成一階 DSM、<Tex>{'\\mathrm{frac}=0.002'}</Tex>，再看 <Tex>{'C_D'}</Tex> vs{' '}
              <Tex>{'D'}</Tex> 的圖。
            </caption>
          </table>
        </div>
        <p className="small">
          對硬體的意義：GMAC 的 code delay 必須與「DTC 誤差到 PD 取樣」的 pipeline latency <strong>精確</strong>對齊；近整數時 regressor 落後一個 sample
          就足以反轉極性（regressor 超前則一階項為 0，因為 <Tex>{'k<D'}</Tex> 的項不存在）。高頻成形的 MASH 1-1-1 residue 更敏感：相鄰 sample 強烈反相關（
          <Tex>{'R_x[1]<0'}</Tex>），<Tex>{'D=1'}</Tex> 就讓 <Tex>{'C_D'}</Tex> 變成很大的負值（把下方 sweep 的 <Tex>{'D'}</Tex> 設成 1 可以看到）——這和 PLL
          的相位無關，純粹是 code 對齊問題。delay 的選法與強健性見<ChRef ch="07">第 07 章</ChRef>，SSPLL 的實例見 <a href="#/case/sspll">案例頁</a>。
        </p>
        <p className="small">
          想用自己的 <Tex>{'\\mathrm{frac}'}</Tex>、<Tex>{'\\omega_nT_s'}</Tex>、<Tex>{'D'}</Tex> 把上表的任何一格算出來？章末的綜合手算題{' '}
          <JumpTo target="handcalc-HC-06.8">HC-06.8</JumpTo> 把 F-06.17、F-06.14、F-06.18 與 pole 串成一題。
        </p>
      </StepBox>
      <p>
        反過來，若 code 的頻譜衰減得<strong>比 <Tex>{'1/\\Omega^2'}</Tex> 快</strong>——沒有跳變的平滑慢變 code（例如三角波 <Tex>{'P_k\\propto1/k^4'}</Tex>、慢正弦）——
        低頻的負貢獻就贏了：三角波 <Tex>{'C/\\sigma_x^2\\approx-\\tfrac{12}{\\pi^2}\\Delta^2<0'}</Tex>，raw-x LMS 變號（用自相關的語言：平滑 code 的{' '}
        <Tex>{'R_x[k]/\\sigma_x^2\\approx1-c\\,k^2'}</Tex> 沒有一次項，<Tex>{'C/\\sigma_x^2\\approx-c\\,m_2<0'}</Tex>）。哪些實際 code 屬於這一類（例如 regressor 經過抽取 / 平滑、
        或 code 的不連續處被別的機制吸收）要看架構，屬 <ClaimTag kind="research" />。具體的 GOS / PHOS 例子見{' '}
        <a href="#/case/sspll">案例頁：SSPLL 的 GOS / PHOS 極性</a>。MASH 1-1-1 的 residue 被 <Tex>{'(1-z^{-1})^2'}</Tex> 推到高頻，
        <Tex>{'C/\\sigma_x^2\\approx1'}</Tex>。
      </p>
      <FcwSweepExperiment />
    </ChapterSection>
  )
}
