import { useMemo } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { Callout, ClaimTag, CodeBlock, CodeCompare, ModeGate, Plot, Quiz, Section, Tex, TexBlock, useThemeTokens, ChRef, FormulaLink } from '@/components'
import comparatorSrc from '@/simulation/models/comparator.ts?raw'
import { kq, kqMetaDrop, metaProb, nonidealSummary, nuHysteresis } from '@/simulation/models/comparator'
import { Fig, Hand, Steps, fx, hline, linspace, pct, texNum } from '../common'

const SRC_PATH = 'src/simulation/models/comparator.ts'
const TABLE_ETA = [0, 0.1, 0.3, 0.5, 1, 2]
const TABLE_EPS = [0.01, 0.05, 0.1, 0.3]
const N_BLOCK = 4096
const SIGMA = 100

/**
 * §5b：比較器不是理想的 sign()——hysteresis（門檻 ±h 帶記憶）與 metastability（決策窗 ε）。
 * 放在 §5（K_q）之後、§6 Comparator Lab 之前：§5 把 comparator 換成增益 K_q，這一節問「真實的 latch comparator 會把 K_q 和雜訊改成什麼」。
 * 所有數字由 src/simulation/models/comparator.ts 檔尾的模型算出（handcalcs.test.tsx 與 golden comparator_hysteresis 核對）。
 */
export function NonIdealSection() {
  const tokens = useThemeTokens()
  const d = useMemo(() => {
    const K0 = kq(SIGMA)
    const rows = TABLE_ETA.map((eta) => ({ eta, ...nonidealSummary(SIGMA, eta * SIGMA, 0) }))
    const epsRows = TABLE_EPS.map((r) => {
      const eps = r * SIGMA
      const s = nonidealSummary(SIGMA, 0, eps)
      return { r, pMeta: metaProb(0, SIGMA, eps), dropped: N_BLOCK * metaProb(0, SIGMA, eps), slope: kqMetaDrop(SIGMA, eps) / K0, info: s.infoRatio }
    })
    const etaGrid = linspace(0, 2.5, 126)
    const hyst = etaGrid.map((eta) => nonidealSummary(SIGMA, eta * SIGMA, 0))
    const epsGrid = linspace(0, 1, 101)
    const h03 = nonidealSummary(SIGMA, 0.3 * SIGMA, 0)
    const h1 = nonidealSummary(SIGMA, SIGMA, 0)
    const e005 = nonidealSummary(SIGMA, 0, 0.05 * SIGMA)
    return {
      K0,
      rows,
      epsRows,
      etaGrid,
      hyst,
      epsGrid,
      h03,
      h1,
      e005,
      pMeta005: metaProb(0, SIGMA, 5),
      nu1: nuHysteresis(SIGMA, SIGMA),
    }
  }, [])

  const hystData = useMemo<Data[]>(
    () => [
      { x: d.etaGrid, y: d.hyst.map((s) => s.slopeRatio), name: String.raw`平穩斜率 $K_q(h)/K_q$（F-05.22）`, mode: 'lines', line: { color: tokens.series[0], width: 2.5 } },
      { x: d.etaGrid, y: d.hyst.map((s) => Math.sqrt(1 / s.noiseFactor)), name: String.raw`雜訊折損 $\sqrt{(1-\nu)/(1+\nu)}$`, mode: 'lines', line: { color: tokens.series[1], dash: 'dash' } },
      { x: d.etaGrid, y: d.hyst.map((s) => s.kqEffRatio), name: String.raw`資訊等效增益 $K_{\mathrm{eff}}/K_q$（F-05.26）`, mode: 'lines', line: { color: tokens.series[2], width: 2.5 } },
      { x: d.etaGrid, y: d.hyst.map((s) => s.nu), name: String.raw`記憶因子 $\nu = 1 - 2\Phi(-\eta)$`, mode: 'lines', line: { color: tokens.series[3], dash: 'dot' } },
    ],
    [d, tokens],
  )
  const metaData = useMemo<Data[]>(
    () => [
      { x: d.epsGrid, y: d.epsGrid.map((r) => metaProb(0, SIGMA, r * SIGMA)), name: String.raw`$P_{\mathrm{meta}} = 2\Phi(\varepsilon/\sigma_v) - 1$（F-05.24）`, mode: 'lines', line: { color: tokens.series[0], width: 2.5 } },
      { x: d.epsGrid.filter((r) => r <= 0.6), y: d.epsGrid.filter((r) => r <= 0.6).map((r) => Math.sqrt(2 / Math.PI) * r), name: String.raw`小訊號 $K_q \varepsilon = \sqrt{2/\pi}\,\varepsilon/\sigma_v$`, mode: 'lines', line: { color: tokens.series[1], dash: 'dash' } },
      { x: d.epsGrid, y: d.epsGrid.map((r) => Math.exp(-(r * r) / 2)), name: String.raw`drop 之後的斜率 $K_{q,\mathrm{drop}}/K_q = e^{-\varepsilon^2/(2\sigma_v^2)}$（F-05.25）`, mode: 'lines', line: { color: tokens.series[2], width: 2.5 } },
      { x: d.epsGrid, y: d.epsGrid.map((r) => 1 - metaProb(0, SIGMA, r * SIGMA)), name: String.raw`每個 sample 的雜訊 $\operatorname{Var}(y) = 1 - P_{\mathrm{meta}}$`, mode: 'lines', line: { color: tokens.series[3], dash: 'dot' } },
    ],
    [d, tokens],
  )

  return (
    <Section kind="assumptions" level={2} id="ch05-nonideal" title={<>5b. 比較器不是理想的 sign()：hysteresis 與 metastability</>}>
      <p>
        §5 把 comparator 換成一個增益 <Tex>{'K_q'}</Tex> 加一個雜訊注入點，前提是它每一拍都獨立地、瞬間地判出 <Tex>{'e[n]'}</Tex> 的正負號。真實的 latch
        comparator（BBPD、取樣式 comparator）有兩件事做不到：<strong>（1）hysteresis</strong>——正回授的 latch 有記憶，上一拍判 <Tex>{'+1'}</Tex> 之後，輸入要掉到門檻{' '}
        <Tex>{'\\theta-h'}</Tex> 以下才會翻成 <Tex>{'-1'}</Tex>（判 <Tex>{'-1'}</Tex> 之後則要升到 <Tex>{'\\theta+h'}</Tex>）；<strong>（2）metastability</strong>
        ——輸入離門檻太近（<Tex>{'|e-\\theta_a|<\\varepsilon'}</Tex>）時，latch 在可用的決策時間 <Tex>{'T'}</Tex> 內還沒解到邏輯準位，下游的 GMAC 拿到的不是一個乾淨的 bit。這一節把這兩個效應放進 §5 的模型，問三個問題：<Tex>{'K_q'}</Tex> 變成什麼、方向正確率（§3、§4 的 <Tex>{'N'}</Tex>）要多幾倍樣本、對 LMS 迴路的 pole 與 <Tex>{'\\sigma_w'}</Tex> 有什麼影響。數字一律是 illustrative（<Tex>{String.raw`\sigma_v=100\,\mathrm{fs}`}</Tex>）；使用者晶片的 4 GHz reference 下一個 reference 週期是 250 ps，latch 可用的決策時間 <Tex>{'T'}</Tex> 只是其中一部分（例如半個週期 125 ps，HC-05.10 的提示）。
      </p>
      <Fig name="nonidealCmp">
        先順著主路徑看：PD 輸出 <Tex>{'e[n]'}</Tex> 減去<strong>有效門檻</strong> <Tex>{'\\theta_a'}</Tex> 得到 <Tex>{'d'}</Tex>，紅色菱形問 <Tex>{'|d|'}</Tex> 是否小於決策窗{' '}
        <Tex>{'\\varepsilon'}</Tex>：不是（往右）就正常解出 <Tex>{'q[n]=\\operatorname{sign}(d)'}</Tex> 進 GMAC；是（往左）就走紅色的 metastable 方塊，三條出口由左到右分別是 drop（送 0）、hold（送上一拍的{' '}
        <Tex>{'q[n-1]'}</Tex>）、late（正確的正負號晚一拍才到，乘到下一個 regressor <Tex>{'x[n+1]'}</Tex>）。再看右邊的回授：解出來的 <Tex>{'q[n]'}</Tex> 經過 <Tex>{'z^{-1}'}</Tex>{' '}
        到右下角的有效門檻，沿著最右邊的線回到加法點、選下一拍的門檻 <Tex>{'\\theta\\mp h'}</Tex>——這就是遲滯；<Tex>{'h=0'}</Tex> 時門檻永遠是 <Tex>{'\\theta'}</Tex>，回到 §2 的圖。圖上的 <Tex>{'y[n]'}</Tex> 是 GMAC 真正累加的值（<Tex>{'\\in\\{+1,0,-1\\}'}</Tex>），式子裡用它和理想的 <Tex>{'q[n]'}</Tex> 區分。
      </Fig>

      <h3>5b.1 遲滯：latch 狀態是一個兩狀態 Markov chain</h3>
      <p>
        每一拍的機率只取決於<strong>上一拍的輸出</strong>（它選了門檻），所以 latch 狀態 <Tex>{'\\sigma_n=q_n\\in\\{\\pm1\\}'}</Tex> 是一個兩狀態的 Markov chain——和 §7 的 birth–death
        chain 同一招：寫出兩個翻轉機率，用細緻平衡解平穩分布。
      </p>
      <Steps
        title="轉移機率、平穩分布與記憶因子（F-05.21）"
        steps={[
          { tex: String.raw`\theta_a=\theta-q_{n-1}\,h`, why: <>上一拍判 <Tex>{'+1'}</Tex> 時門檻降到 <Tex>{'\\theta-h'}</Tex>（要掉到它以下才翻成 <Tex>{'-1'}</Tex>）；判 <Tex>{'-1'}</Tex> 時升到 <Tex>{'\\theta+h'}</Tex>。</> },
          { tex: String.raw`t_+\equiv P(q_n=+1\mid q_{n-1}=-1)=P(s+v\ge\theta+h)=\Phi\!\Big(\frac{s-\theta-h}{\sigma_v}\Big)`, why: <>F-05.1 把門檻換成 <Tex>{'\\theta+h'}</Tex>：從 <Tex>{'-1'}</Tex> 翻到 <Tex>{'+1'}</Tex> 要越過較高的那個門檻。</> },
          { tex: String.raw`t_-\equiv P(q_n=-1\mid q_{n-1}=+1)=P(s+v<\theta-h)=\Phi\!\Big(\frac{\theta-h-s}{\sigma_v}\Big)`, why: '同理，另一側；留在原狀態的機率各是 $1-t_+$、$1-t_-$。' },
          { tex: String.raw`\pi_+\,t_-=\pi_-\,t_+`, why: <>細緻平衡：平穩時每一拍從 <Tex>{'+1'}</Tex> 流到 <Tex>{'-1'}</Tex> 的機率流量等於流回來的流量（§7 的 <Tex>{'\\pi_ku_k=\\pi_{k+1}\\bar u_{k+1}'}</Tex>）。</> },
          { tex: String.raw`\pi_+=\frac{t_+}{t_++t_-},\qquad E[q]=\pi_+-\pi_-=\frac{t_+-t_-}{t_++t_-}`, why: <>代入 <Tex>{'\\pi_-=1-\\pi_+'}</Tex> 解出來。</> },
          { tex: String.raw`\nu\equiv1-t_+-t_-,\qquad \operatorname{Cov}(q_n,q_{n+k})=(1-E[q]^2)\,\nu^k`, why: <>兩狀態 chain 的轉移矩陣有兩個特徵值 <Tex>{'1'}</Tex> 與 <Tex>{'\\nu'}</Tex>；初始偏離每拍乘 <Tex>{'\\nu'}</Tex>，所以相關隨 lag 以 <Tex>{'\\nu^k'}</Tex> 衰減。</> },
          { tex: String.raw`h=0:\quad t_++t_-=\Phi(z)+\Phi(-z)=1\;\Rightarrow\;\nu=0,\quad E[q]=2\Phi(z)-1`, why: <>沒有遲滯就沒有記憶，回到 §2 的 F-05.2（<Tex>{'z=(s-\\theta)/\\sigma_v'}</Tex>）。</> },
        ]}
      />
      <TexBlock id="F-05.21" label={<>遲滯 comparator 的轉移機率與平穩分布 <ClaimTag kind="exact" />（兩狀態 Markov chain；含決策窗 <Tex>{'\\varepsilon'}</Tex> 的一般式）</>}>
        {String.raw`\begin{aligned}&P(q_n=+1\mid q_{n-1})=\Phi\!\Big(\frac{s-\theta_a-\varepsilon}{\sigma_v}\Big),\qquad \theta_a=\theta-q_{n-1}\,h\\[0.6ex]&\pi_+=\frac{t_+}{t_++t_-},\qquad E[q]=\frac{t_+-t_-}{t_++t_-},\qquad \nu=1-t_+-t_-\end{aligned}`}
      </TexBlock>
      <p>
        接著問 §5 的問題：在工作點 <Tex>{'s=\\theta'}</Tex>（校正收斂後）附近，平穩的 <Tex>{'E[q]'}</Tex> 對 <Tex>{'s'}</Tex> 的斜率是多少？
      </p>
      <Steps
        title="平穩斜率 $K_q(h)$（F-05.22）：商的微分、在對稱點代入"
        steps={[
          { tex: String.raw`E[q]=\frac{\mathcal N(s)}{\mathcal D(s)},\qquad \mathcal N=t_+-t_-,\quad \mathcal D=t_++t_-`, why: '把分子、分母各取一個名字。' },
          { tex: String.raw`\frac{dE[q]}{ds}=\frac{\mathcal N'\mathcal D-\mathcal N\mathcal D'}{\mathcal D^2}`, why: '商的微分法則。' },
          { tex: String.raw`s=\theta:\quad t_+=t_-=\Phi(-\eta),\quad \eta\equiv\frac{h}{\sigma_v}\;\Rightarrow\;\mathcal N=0,\quad \mathcal D=2\Phi(-\eta)`, why: <>對稱點：兩個方向都要靠雜訊跨過 <Tex>{'h'}</Tex>。<Tex>{'\\mathcal N=0'}</Tex> 讓商的微分只剩第一項。</> },
          { tex: String.raw`t_+'=\frac{1}{\sigma_v}\varphi\!\Big(\frac{s-\theta-h}{\sigma_v}\Big)\to\frac{\varphi(\eta)}{\sigma_v},\qquad t_-'=-\frac{1}{\sigma_v}\varphi\!\Big(\frac{\theta-h-s}{\sigma_v}\Big)\to-\frac{\varphi(\eta)}{\sigma_v}`, why: <><Tex>{"\\Phi'=\\varphi"}</Tex> 加連鎖律（§5 方法二）；<Tex>{'\\varphi'}</Tex> 是偶函數。</> },
          { tex: String.raw`K_q(h)\equiv\frac{dE[q]}{ds}\Big|_{s=\theta}=\frac{\mathcal N'}{\mathcal D}=\frac{2\varphi(\eta)/\sigma_v}{2\Phi(-\eta)}=\frac{\varphi(\eta)}{\sigma_v\,\Phi(-\eta)}`, why: '代入；分子分母的 2 約掉。' },
          { tex: String.raw`h=0:\quad \frac{\varphi(0)}{\sigma_v\cdot\tfrac12}=\frac{2\varphi(0)}{\sigma_v}=\sqrt{\frac2\pi}\,\frac1{\sigma_v}=K_q`, why: '檢查：回到 F-05.10。' },
          { tex: String.raw`\frac{K_q(h)}{K_q}=\frac{\varphi(\eta)}{2\varphi(0)\,\Phi(-\eta)}\approx\frac{1-\eta^2/2}{1-2\varphi(0)\eta}\approx1+\sqrt{\tfrac2\pi}\,\eta\qquad(\eta\ll1)`, why: <>一階泰勒：<Tex>{'\\Phi(-\\eta)\\approx\\tfrac12-\\varphi(0)\\eta'}</Tex>。斜率<strong>隨 <Tex>{'h'}</Tex> 變大</strong>——latch 一旦翻過去就黏住，平均輸出對 <Tex>{'s'}</Tex> 更敏感（<Tex>{'\\varphi(\\eta)/\\Phi(-\\eta)'}</Tex> 是遞增的 inverse Mills ratio）。</> },
        ]}
      />
      <TexBlock id="F-05.22" label={<>遲滯 comparator 的平穩小訊號斜率與記憶因子 <ClaimTag kind="exact" />（<Tex>{'s=\\theta'}</Tex>、<Tex>{'\\varepsilon=0'}</Tex>）</>}>
        {String.raw`\boxed{K_q(h)=\frac{\varphi(\eta)}{\sigma_v\,\Phi(-\eta)},\qquad \nu=1-2\Phi(-\eta),\qquad \eta=\frac{h}{\sigma_v}}`}
      </TexBlock>
      <p>
        斜率變大聽起來是好事，但相鄰輸出現在是相關的（<Tex>{'\\nu>0'}</Tex>）：§3「雜訊只長 <Tex>{'\\sqrt N'}</Tex>」靠的是獨立。把 <Tex>{'\\operatorname{Var}(S_N)'}</Tex>{' '}
        重算一次，再看 <Tex>{'\\mathrm{SNR}_{\\mathrm{stat}}'}</Tex> 到底變好還是變壞：
      </p>
      <Steps
        title="相關樣本的 $\operatorname{Var}(S_N)$ 與資訊等效增益 $K_{\mathrm{eff}}$（F-05.23、F-05.26）"
        steps={[
          { tex: String.raw`\operatorname{Var}(S_N)=\sum_{i=1}^N\sum_{j=1}^N\operatorname{Cov}(q_i,q_j)=N c_0+2\sum_{k=1}^{N-1}(N-k)\,c_k,\qquad c_k\equiv\operatorname{Cov}(q_n,q_{n+k})`, why: <>和的變異數 = 所有共變異數相加；lag 為 <Tex>{'k'}</Tex> 的配對有 <Tex>{'N-k'}</Tex> 對、各算兩次。</> },
          { tex: String.raw`c_k=c_0\,\nu^k,\qquad c_0=1-m^2`, why: '上一段的 chain 結果（純遲滯）。' },
          { tex: String.raw`\sum_{k=1}^{N-1}(N-k)\nu^k=\frac{N\nu}{1-\nu}-\frac{\nu(1-\nu^N)}{(1-\nu)^2}`, why: <>等比級數 <Tex>{'\\sum\\nu^k'}</Tex> 與它對 <Tex>{'\\nu'}</Tex> 的導數 <Tex>{'\\sum k\\nu^{k-1}'}</Tex>（微積分）。</> },
          { tex: String.raw`\operatorname{Var}(S_N)=N(1-m^2)\Big[\frac{1+\nu}{1-\nu}-\frac{2\nu(1-\nu^N)}{N(1-\nu)^2}\Big]\;\xrightarrow{\;N\gg1/(1-\nu)\;}\;N(1-m^2)\,\frac{1+\nu}{1-\nu}`, why: <>整理；<Tex>{'\\nu=0'}</Tex> 回到 F-05.4。正相關讓雜訊變成 iid 的 <Tex>{'F=(1+\\nu)/(1-\\nu)'}</Tex> 倍（相鄰樣本「抵銷得比較慢」）。</> },
          { tex: String.raw`\mathrm{SNR}_{\mathrm{stat}}=\frac{N\,K_q(h)\,(s-\theta)}{\sqrt{N\,F}}=\sqrt N\,(s-\theta)\underbrace{K_q(h)\sqrt{\frac{1-\nu}{1+\nu}}}_{K_{\mathrm{eff}}}`, why: <>小訊號：<Tex>{'E[S_N]=NK_q(h)(s-\\theta)'}</Tex>、<Tex>{'1-m^2\\approx1'}</Tex>。和 §4 的 <Tex>{'\\sqrt{2/\\pi}\\,s\\sqrt N/\\sigma_v'}</Tex> 比，只差把 <Tex>{'K_q'}</Tex> 換成 <Tex>{'K_{\\mathrm{eff}}'}</Tex>。</> },
          { tex: String.raw`\frac{N(h)}{N(0)}=\Big(\frac{K_q}{K_{\mathrm{eff}}}\Big)^2`, why: <>F-05.9：<Tex>{'N\\propto1/m^2\\propto1/K^2'}</Tex>，同樣的正確率要求同樣的 <Tex>{'\\mathrm{SNR}_{\\mathrm{stat}}'}</Tex>。</> },
          { tex: String.raw`\frac{K_q(h)}{K_q}=\frac{e^{-\eta^2/2}}{2\Phi(-\eta)}\approx\frac{1-\eta^2/2}{1-a\eta}\approx1+a\eta+\Big(a^2-\frac12\Big)\eta^2,\qquad a\equiv\sqrt{2/\pi}`, why: <>小 <Tex>{'\\eta'}</Tex> 展開到二階：<Tex>{'2\\Phi(-\\eta)=1-2\\varphi(0)\\eta+O(\\eta^3)=1-a\\eta'}</Tex>，再用 <Tex>{'1/(1-x)\\approx1+x+x^2'}</Tex>。</> },
          { tex: String.raw`\nu=1-2\Phi(-\eta)\approx a\eta,\qquad \sqrt{\frac{1-\nu}{1+\nu}}=e^{-\nu-\nu^3/3-\cdots}\approx1-\nu+\frac{\nu^2}{2}\approx1-a\eta+\frac{a^2\eta^2}{2}`, why: <>取對數：<Tex>{'\\tfrac12[\\ln(1-\\nu)-\\ln(1+\\nu)]=-\\nu-\\nu^3/3-\\cdots'}</Tex>，再把 <Tex>{'e^{-\\nu}'}</Tex> 展開到二階。</> },
          { tex: String.raw`\frac{K_{\mathrm{eff}}}{K_q}\approx1-\frac{1-a^2}{2}\,\eta^2=1-\frac{1-2/\pi}{2}\,\eta^2\approx1-0.18\,\eta^2,\qquad \frac{N(h)}{N(0)}\approx1+0.36\,\eta^2`, why: <>兩式相乘：<Tex>{'\\pm a\\eta'}</Tex> 在一階<strong>相消</strong>（斜率的增益剛好被相關的損失吃掉），淨損失是二階小量。<Tex>{'\\eta=0.3'}</Tex>：<Tex>{'1-0.18\\times0.09=0.984'}</Tex>，對上表中的精確值 {fx(d.h03.kqEffRatio, 4)}。</> },
        ]}
      />
      <TexBlock id="F-05.23" label={<>相關樣本的 <Tex>{'\\operatorname{Var}(S_N)'}</Tex> <ClaimTag kind="exact" />（一般式的 <Tex>{'c_0'}</Tex>、<Tex>{'c_1'}</Tex>、<Tex>{'\\beta'}</Tex> 見公式登錄）</>}>
        {String.raw`\operatorname{Var}(S_N)=N(1-m^2)\Big[\frac{1+\nu}{1-\nu}-\frac{2\nu(1-\nu^N)}{N(1-\nu)^2}\Big]\qquad(\varepsilon=0)`}
      </TexBlock>
      <TexBlock id="F-05.26" label={<>資訊等效增益與所需樣本數的倍數 <ClaimTag kind="approx" />（CLT、小訊號）</>}>
        {String.raw`\boxed{K_{\mathrm{eff}}=K_q(h)\sqrt{\frac{1-\nu}{1+\nu}}\le K_q,\qquad \frac{N(h)}{N(0)}=\Big(\frac{K_q}{K_{\mathrm{eff}}}\Big)^2}`}
      </TexBlock>
      <div className="table-wrap">
        <table className="ch05-table">
          <caption>
            遲滯對四個設計量的影響（<Tex>{String.raw`\sigma_v=100\,\mathrm{fs}`}</Tex>、<Tex>{'s=\\theta'}</Tex>；由模型 nonidealSummary 算出，與 golden comparator_hysteresis 相同）。<Tex>{'F'}</Tex> 是 block 平均的雜訊變異數相對 iid 的倍數。
          </caption>
          <thead>
            <tr>
              <th className="num">
                <Tex>{'\\eta=h/\\sigma_v'}</Tex>
              </th>
              <th className="num">
                <Tex>{'K_q(h)/K_q'}</Tex>
              </th>
              <th className="num">
                <Tex>{'\\nu'}</Tex>
              </th>
              <th className="num">
                <Tex>{'F=\\tfrac{1+\\nu}{1-\\nu}'}</Tex>
              </th>
              <th className="num">
                <Tex>{'K_{\\mathrm{eff}}/K_q'}</Tex>
              </th>
              <th className="num">
                <Tex>{'N(h)/N(0)'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.eta} className={r.eta === 0.3 ? 'ch05-hl' : undefined}>
                <td className="num">{r.eta}</td>
                <td className="num">{fx(r.slopeRatio, 4)}</td>
                <td className="num">{fx(r.nu, 4)}</td>
                <td className="num">{fx(r.noiseFactor, 3)}</td>
                <td className="num">{fx(r.kqEffRatio, 4)}</td>
                <td className="num">{fx(r.nRatio, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Plot
        title="遲滯半寬 $h/\sigma_v$ 對斜率、雜訊與資訊等效增益的影響"
        data={hystData}
        layout={{ xaxis: { title: { text: String.raw`$\eta = h/\sigma_v$` } }, yaxis: { title: { text: '相對理想 comparator 的比值' }, range: [0, 3.65] }, shapes: [hline(1, tokens.textMuted)] }}
        height={320}
        csvName="ch05-hysteresis"
        caption={
          <>
            藍線往上（斜率變大）、虛線往下（相關讓雜訊變大），兩者相乘的 <Tex>{'K_{\\mathrm{eff}}/K_q'}</Tex> 永遠在 1 以下：<Tex>{'\\eta=0.3'}</Tex> 只掉 {pct(1 - d.h03.kqEffRatio, 1)}，
            <Tex>{'\\eta=1'}</Tex> 掉 {pct(1 - d.h1.kqEffRatio, 1)}（要多 {pct(d.h1.nRatio - 1, 0)} 的樣本），<Tex>{'\\eta=2'}</Tex> 以後 latch 幾乎不翻（<Tex>{'\\nu\\to1'}</Tex>），每個 block 只剩少數幾次獨立決策。
          </>
        }
      />
      <Hand id="HC-05.9">
        用你 comparator 的遲滯（例如 <Tex>{'h=0.3\\sigma_v'}</Tex>）算一次：斜率變成幾倍、<Tex>{'\\nu'}</Tex> 多大、達到同樣正確率要多幾倍樣本。查表只需要一個 <Tex>{'\\Phi(-\\eta)'}</Tex>。
      </Hand>

      <h3>5b.2 metastability：離門檻太近的 sample 解不出來</h3>
      <p>
        取樣式 comparator 是一個正回授的 latch：取樣時刻輸入差 <Tex>{'e-\\theta_a'}</Tex> 被以 <Tex>{'e^{t/\\tau_m}'}</Tex> 放大（<Tex>{'\\tau_m'}</Tex> 是再生時間常數），放大到邏輯準位才算「解出」。可用的決策時間 <Tex>{'T'}</Tex>{' '}
        有限，所以初始差太小的 sample 到時候還沒解出來——把「太小」折算到輸入就是一個窗 <Tex>{'|e-\\theta_a|<\\varepsilon'}</Tex>，<Tex>{'\\varepsilon=\\varepsilon_0e^{-T/\\tau_m}'}</Tex>。發生的機率只是 PDF 在門檻附近那一小條的面積：
      </p>
      <Steps
        title="$P_{\mathrm{meta}}$、它和 $K_q$ 的關係、以及 drop 之後的斜率（F-05.24、F-05.25）"
        steps={[
          { tex: String.raw`P_{\mathrm{meta}}=P(|e-\theta|<\varepsilon)=\int_{\theta-\varepsilon}^{\theta+\varepsilon}f(e)\,de=\Phi\!\Big(\frac{\varepsilon-d}{\sigma_v}\Big)-\Phi\!\Big(\frac{-\varepsilon-d}{\sigma_v}\Big),\quad d=s-\theta`, why: <><Tex>{'e\\sim\\mathcal N(s,\\sigma_v^2)'}</Tex>：窗內的面積是兩個 CDF 相減（§1 的 PDF 圖上門檻左右各 <Tex>{'\\varepsilon'}</Tex> 的那一條）。</> },
          { tex: String.raw`d=0:\quad P_{\mathrm{meta}}=2\Phi\!\Big(\frac{\varepsilon}{\sigma_v}\Big)-1=\operatorname{erf}\!\Big(\frac{\varepsilon}{\sqrt2\,\sigma_v}\Big)\approx\sqrt{\frac2\pi}\,\frac{\varepsilon}{\sigma_v}=K_q\,\varepsilon`, why: <>校正收斂後 <Tex>{'s=\\theta'}</Tex>；§5 方法一的一階泰勒——<strong>同一個 <Tex>{'K_q'}</Tex> 又出現了</strong>：漏掉的比例就是決策窗乘上 comparator 的增益。</> },
          { tex: String.raw`\varepsilon(T)=\varepsilon_0\,e^{-T/\tau_m}\qquad\Rightarrow\qquad P_{\mathrm{meta}}(T)\approx K_q\,\varepsilon_0\,e^{-T/\tau_m}`, why: <>再生：初始差要放大 <Tex>{'e^{T/\\tau_m}'}</Tex> 倍才到準位，所以「<Tex>{'T'}</Tex> 內解不出來」等價於初始差小於 <Tex>{'\\varepsilon_0e^{-T/\\tau_m}'}</Tex>。多給一個 <Tex>{'\\tau_m'}</Tex>，窗縮成 <Tex>{'1/e'}</Tex>——這就是 MTBF 公式的指數。</> },
          { tex: String.raw`\text{drop}:\quad E[y]=E[q]-\int_{|e-\theta|<\varepsilon}\operatorname{sign}(e-\theta)\,f(e)\,de`, why: <>漏掉的 sample 算 0：平均輸出少掉窗內那些 sign 的貢獻。</> },
          { tex: String.raw`\frac{d}{ds}\int_{\theta-\varepsilon}^{\theta+\varepsilon}\operatorname{sign}(e-\theta)\,f_v(e-s)\,de\Big|_{s=\theta}=\frac{2}{\sigma_v}\Big(\varphi(0)-\varphi\!\Big(\frac{\varepsilon}{\sigma_v}\Big)\Big)`, why: <>上一行的 <Tex>{'f(e)'}</Tex> 寫成雜訊的 PDF 平移 <Tex>{'f_v(e-s)'}</Tex>，才看得出它和 <Tex>{'s'}</Tex> 的關係；把 <Tex>{'f_v(e-s)'}</Tex> 對 <Tex>{'s'}</Tex> 微分等於對 <Tex>{'e'}</Tex> 微分變號，分成 <Tex>{'(\\theta,\\theta+\\varepsilon)'}</Tex> 與 <Tex>{'(\\theta-\\varepsilon,\\theta)'}</Tex> 兩段用微積分基本定理：每段得到端點的 PDF 值之差。</> },
          { tex: String.raw`\frac{dE[y]}{ds}\Big|_{s=\theta}=K_q-\frac{2}{\sigma_v}\Big(\varphi(0)-\varphi\!\Big(\frac{\varepsilon}{\sigma_v}\Big)\Big)=\frac{2\varphi(\varepsilon/\sigma_v)}{\sigma_v}=K_q\,e^{-\varepsilon^2/(2\sigma_v^2)}`, why: <><Tex>{'K_q=2\\varphi(0)/\\sigma_v'}</Tex>；<Tex>{'\\varphi(x)=\\varphi(0)e^{-x^2/2}'}</Tex>。漏掉的是最靠近門檻、幾乎擲硬幣的 sample，所以斜率只少<strong>二階</strong>小量。</> },
          { tex: String.raw`\operatorname{Var}(y)=E[y^2]-E[y]^2=(1-P_{\mathrm{meta}})-E[y]^2\approx1-P_{\mathrm{meta}}`, why: <><Tex>{'y^2=1'}</Tex>（有效）或 0（漏掉）。那些 sample 的雜訊是真的少掉了，所以每個 sample 的資訊 <Tex>{'(\\text{斜率})^2/\\operatorname{Var}'}</Tex> 反而略增：<Tex>{'e^{-\\varepsilon^2/\\sigma_v^2}/(1-P_{\\mathrm{meta}})>1'}</Tex>（對 <Tex>{'\\varepsilon\\lesssim1.2\\sigma_v'}</Tex> 成立；窗再大，連帶方向資訊的 sample 也漏掉了）。</> },
        ]}
      />
      <TexBlock id="F-05.24" label={<>metastability 的機率與決策窗對時間的關係 <ClaimTag kind="exact" />（<Tex>{'\\approx'}</Tex> 需 <Tex>{'\\varepsilon\\ll\\sigma_v'}</Tex>）</>}>
        {String.raw`\boxed{P_{\mathrm{meta}}=\Phi\!\Big(\frac{\varepsilon-d}{\sigma_v}\Big)-\Phi\!\Big(\frac{-\varepsilon-d}{\sigma_v}\Big)\;\xrightarrow{\;d=0\;}\;2\Phi\!\Big(\frac{\varepsilon}{\sigma_v}\Big)-1\approx K_q\,\varepsilon},\qquad \varepsilon(T)=\varepsilon_0\,e^{-T/\tau_m}`}
      </TexBlock>
      <TexBlock id="F-05.25" label={<>drop 之後的斜率與每個 sample 的變異數 <ClaimTag kind="exact" />（<Tex>{'h=0'}</Tex>、<Tex>{'s=\\theta'}</Tex>）</>}>
        {String.raw`\frac{dE[y]}{ds}\Big|_{s=\theta}=K_q\,e^{-\varepsilon^2/(2\sigma_v^2)},\qquad \operatorname{Var}(y)=1-P_{\mathrm{meta}},\qquad N_{\mathrm{meta}}=N\,P_{\mathrm{meta}}`}
      </TexBlock>
      <div className="table-wrap">
        <table className="ch05-table">
          <caption>
            決策窗的影響（<Tex>{String.raw`\sigma_v=100\,\mathrm{fs}`}</Tex>、<Tex>{'s=\\theta'}</Tex>、<Tex>{`N=${N_BLOCK}`}</Tex>）：漏掉的個數線性長、斜率只掉二階小量；最後一欄是每個 sample 的資訊相對理想的比。
          </caption>
          <thead>
            <tr>
              <th className="num">
                <Tex>{'\\varepsilon/\\sigma_v'}</Tex>
              </th>
              <th className="num">
                <Tex>{'P_{\\mathrm{meta}}'}</Tex>
              </th>
              <th className="num">
                每 block 漏掉 <Tex>{'NP_{\\mathrm{meta}}'}</Tex>
              </th>
              <th className="num">
                <Tex>{'K_{q,\\mathrm{drop}}/K_q'}</Tex>
              </th>
              <th className="num">
                資訊比 <Tex>{'(K_{\\mathrm{eff}}/K_q)^2'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {d.epsRows.map((r) => (
              <tr key={r.r} className={r.r === 0.05 ? 'ch05-hl' : undefined}>
                <td className="num">{r.r}</td>
                <td className="num">{fx(r.pMeta, 5)}</td>
                <td className="num">{fx(r.dropped, 1)}</td>
                <td className="num">{fx(r.slope, 5)}</td>
                <td className="num">{fx(r.info, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Plot
        title="決策窗 $\varepsilon/\sigma_v$：$P_{\mathrm{meta}}$ 與 drop 之後的斜率、雜訊"
        data={metaData}
        layout={{ xaxis: { title: { text: String.raw`$\varepsilon/\sigma_v$` } }, yaxis: { title: { text: '機率　/　相對理想的比值' }, range: [0, 1.05] } }}
        height={320}
        csvName="ch05-metastability"
        caption={
          <>
            <Tex>{'P_{\\mathrm{meta}}'}</Tex> 在 <Tex>{'\\varepsilon\\ll\\sigma_v'}</Tex> 時就是直線 <Tex>{'K_q\\varepsilon'}</Tex>；drop 之後的斜率（綠）與雜訊（點線）一起掉，但斜率掉得慢得多——
            <Tex>{'\\varepsilon=0.05\\sigma_v'}</Tex> 時漏掉 {pct(d.pMeta005, 2)} 的 sample、斜率只少 {pct(1 - kqMetaDrop(SIGMA, 5) / d.K0, 3)}。
          </>
        }
      />
      <Hand id="HC-05.10">
        用你 latch 的決策窗（折算到輸入，例如 <Tex>{'\\varepsilon=0.05\\sigma_v'}</Tex>）和 block 長度算一次：漏掉的比例、每個 block 漏幾個、斜率還剩幾成。
      </Hand>

      <h3>5b.3 對 LMS 迴路的影響：pole、係數雜訊與 regressor 延遲</h3>
      <p>
        把這些結果放進 §9 的 block 迴路（<FormulaLink id="F-05.20" />）：平均增益用新的斜率、雜訊用新的 <Tex>{'\\operatorname{Var}(S_N)'}</Tex>，其餘不變。
      </p>
      <Callout kind="info" title="三個效應各自改了迴路的哪一個量">
        <ul className="ch05-checklist">
          <li>
            <strong>遲滯 <Tex>{'h'}</Tex>：</strong>同樣的 <Tex>{'\\mu'}</Tex> 下 pole 變快（<Tex>{'p_{\\mathrm{cal}}=1-\\mu K_q(h)'}</Tex>，<Tex>{'h=\\sigma_v'}</Tex> 時 loop gain 乘 {fx(d.h1.slopeRatio, 2)}），但係數雜訊{' '}
            <Tex>{'\\sigma_w^2=\\mu^2F/(N(1-p_{\\mathrm{cal}}^2))'}</Tex> 多了 <Tex>{'F'}</Tex> 倍（<Tex>{'h=\\sigma_v'}</Tex>：<Tex>{`F=${fx(d.h1.noiseFactor, 2)}`}</Tex>，<Tex>{'\\sigma_w'}</Tex> 乘 {fx(Math.sqrt(d.h1.noiseFactor), 2)}）。把{' '}
            <Tex>{'\\mu'}</Tex> 縮小回同樣的 pole，<Tex>{'\\sigma_w^2'}</Tex> 仍是理想的 <Tex>{'F/(K_q(h)/K_q)^2=1/(K_{\\mathrm{eff}}/K_q)^2'}</Tex> 倍（<Tex>{'h=\\sigma_v'}</Tex>：{fx(d.h1.nRatio, 2)} 倍）——和「要多幾倍樣本」是同一個數。相鄰 block 的 <Tex>{'\\eta_k'}</Tex> 也會相關（<ChRef ch="12">Ch12</ChRef> 的 <Tex>{'\\sigma_w'}</Tex> 假設獨立；Roadmap R1 的有色 GMAC 雜訊）。<ClaimTag kind="approx" />
          </li>
          <li>
            <strong>metastability、drop：</strong>pole 幾乎不變（斜率只少 <Tex>{'\\varepsilon^2/(2\\sigma_v^2)'}</Tex>），雜訊少 <Tex>{'P_{\\mathrm{meta}}'}</Tex>；代價是 GMAC 的有效樣本數變成{' '}
            <Tex>{'N(1-P_{\\mathrm{meta}})'}</Tex>，硬體要有一個 valid 旗標把那些 sample 擋在累加器外（除數仍用 <Tex>{'N'}</Tex>，否則 learning rate 會跟著抖）。<ClaimTag kind="exact" />
          </li>
          <li>
            <strong>hold：</strong>那些 sample 重複上一拍的輸出，平均多出約 <Tex>{'P_{\\mathrm{meta}}\\,E[q]'}</Tex>（一階）、相鄰樣本多一點相關；沒有封閉式，只在模擬裡。<ClaimTag kind="research" />
          </li>
          <li>
            <strong>late：</strong>本章 <Tex>{'x\\equiv1'}</Tex> 時沒有影響（晚一拍還是 <Tex>{'\\pm1'}</Tex>）；一般的 regressor 下那 <Tex>{'P_{\\mathrm{meta}}'}</Tex> 的 sample 乘到的是 <Tex>{'x[n+1]'}</Tex>，等效相關變成{' '}
            <Tex>{'(1-P_{\\mathrm{meta}})\\,C(D)+P_{\\mathrm{meta}}\\,C(D+1)'}</Tex>——就是 <ChRef ch="07">Ch07</ChRef> 多一拍 code delay 的結果（單頻 code 時 <Tex>{'C(D+1)/C(D)\\to\\cos\\Omega'}</Tex>）。<ClaimTag kind="approx" />
          </li>
        </ul>
        <p className="ch05-note">
          這三種政策都在 blockLms 的 JSON 選項 <code>comparator</code>（<code>hysteresis_fs</code>、<code>meta_window_fs</code>、<code>meta_policy</code>）裡，可以在 Models 頁的 JSON Lab 用任何 regressor 與 PLL error path 跑；下面 §6 的 Comparator Lab 多了 <Tex>{'h'}</Tex> 與 <Tex>{'\\varepsilon'}</Tex> 兩個控制項（drop 政策），解析（chain 的 DP／CLT）和 Monte Carlo 互相核對。預設 <Tex>{'h=\\varepsilon=0'}</Tex> 與本章其餘部分完全相同。
        </p>
      </Callout>
      <ModeGate min="engineer">
        <CodeCompare
          caption="理想 comparator 的 P(q=+1) 與非理想 comparator 的三種結果機率：差異只在「門檻依上一拍而定」與「窗內算 metastable」兩行。"
          items={[
            { label: '理想 sign（§2）', source: comparatorSrc, region: 'pPlus', lang: 'typescript', path: SRC_PATH },
            { label: '遲滯 $\\pm h$ ＋ 決策窗 $\\varepsilon$（§5b）', source: comparatorSrc, region: 'comparatorTransitions', lang: 'typescript', path: SRC_PATH },
          ]}
        />
        <CodeBlock source={comparatorSrc} region="kqHysteresis" lang="typescript" path={SRC_PATH} title="F-05.22 的實作：平穩斜率 $K_q(h)$ 與記憶因子 $\nu$" />
      </ModeGate>
      <ModeGate min="research">
        <Callout kind="info" title="Research：怎麼量 $\varepsilon$ 與 $\tau_m$，以及這個模型沒有涵蓋的部分">
          <Tex>{'\\tau_m'}</Tex> 由 latch 的 <Tex>{'g_m/C'}</Tex> 決定，<Tex>{'\\varepsilon_0'}</Tex> 由取樣時刻的增益與邏輯準位決定；兩者合起來就是標準的 MTBF 式{' '}
          <Tex>{'\\mathrm{MTBF}=e^{T/\\tau_m}/(T_0f_{\\mathrm{clk}}f_{\\mathrm{data}})'}</Tex>，把 <Tex>{'1/\\mathrm{MTBF}'}</Tex> 換成每拍的機率就是 <Tex>{'P_{\\mathrm{meta}}'}</Tex>。量測上：掃 <Tex>{'T'}</Tex>（或時脈相位）看 GMAC 的 valid 計數，斜率給 <Tex>{'1/\\tau_m'}</Tex>、截距給{' '}
          <Tex>{'K_q\\varepsilon_0'}</Tex>。本節的 chain 假設 metastable 時 latch 狀態不變（drop）而且 <Tex>{'v'}</Tex> iid；真實 latch 解出來的方向在窗內並不是完全隨機（偏向初始差的正負號），而且 hysteresis 常常和 kickback、offset 一起出現——那些屬於 Roadmap R6 的量測驅動模型。
          <ClaimTag kind="research" />
        </Callout>
      </ModeGate>
      <Quiz
        title="思考題 5b-1"
        question={
          <>
            Comparator 的遲滯從 0 變成 <Tex>{'h=\\sigma_v'}</Tex>，LMS 的 <Tex>{'\\mu'}</Tex> 與 <Tex>{'N'}</Tex> 不變。下列哪一句正確？
          </>
        }
        options={[
          { label: String.raw`pole 變慢、係數雜訊 $\sigma_w$ 變小（遲滯濾掉了雜訊）` },
          { label: String.raw`pole 變快（loop gain 乘 ${fx(d.h1.slopeRatio, 2)}），但 $\sigma_w$ 變大（乘 ${fx(Math.sqrt(d.h1.noiseFactor), 2)}）`, correct: true },
          { label: '兩者都不變：遲滯只影響大訊號' },
          { label: String.raw`pole 不變、$\sigma_w$ 變大` },
        ]}
        answer={
          <>
            F-05.22：平穩斜率 <Tex>{`K_q(h)/K_q=\\varphi(1)/(2\\varphi(0)\\Phi(-1))=${fx(d.h1.slopeRatio, 3)}`}</Tex>，所以 <Tex>{'g=\\mu K_q(h)'}</Tex> 變大、pole 變快。但 <Tex>{`\\nu=1-2\\Phi(-1)=${fx(d.nu1, 4)}`}</Tex>，block 平均的雜訊是 iid 的{' '}
            <Tex>{`F=(1+\\nu)/(1-\\nu)=${fx(d.h1.noiseFactor, 2)}`}</Tex> 倍，<Tex>{'\\sigma_w'}</Tex> 乘 <Tex>{`\\sqrt F=${fx(Math.sqrt(d.h1.noiseFactor), 2)}`}</Tex>（pole 變快又讓 <Tex>{'1-p_{\\mathrm{cal}}^2'}</Tex> 變大，再多一點）。要回到同樣的 pole 得把{' '}
            <Tex>{'\\mu'}</Tex> 除以 {fx(d.h1.slopeRatio, 2)}，此時 <Tex>{'\\sigma_w^2'}</Tex> 仍是理想的 <Tex>{`F/${fx(d.h1.slopeRatio, 2)}^2=${fx(d.h1.nRatio, 2)}`}</Tex> 倍。
          </>
        }
      />
      <Quiz
        title="思考題 5b-2"
        question={
          <>
            決策窗 <Tex>{'\\varepsilon=0.05\\sigma_v'}</Tex>、<Tex>{`N=${N_BLOCK}`}</Tex>、drop 政策：每個 block 平均漏掉 {fx(N_BLOCK * d.pMeta005, 0)} 個 sample。達到 95% 方向正確率所需的{' '}
            <Tex>{'N'}</Tex> 怎麼變？
          </>
        }
        options={[
          { label: `多約 ${pct(d.pMeta005, 0)}（漏掉幾成就補幾成）` },
          { label: `幾乎不變，甚至少約 ${pct(d.e005.infoRatio - 1, 0)}`, correct: true },
          { label: '多約 16%（漏掉的比例平方的倒數）' },
          { label: '加倍' },
        ]}
        answer={
          <>
            漏掉的是 <Tex>{'|e-\\theta|<\\varepsilon'}</Tex> 的 sample——最靠近門檻、幾乎擲硬幣的那些。F-05.25：斜率只少 <Tex>{`\\varepsilon^2/(2\\sigma_v^2)=${texNum(0.00125, 3)}`}</Tex>，雜訊卻真的少了{' '}
            <Tex>{`P_{\\mathrm{meta}}=${fx(d.pMeta005, 4)}`}</Tex>；每個 sample 的資訊比 <Tex>{`e^{-\\varepsilon^2/\\sigma_v^2}/(1-P_{\\mathrm{meta}})=${fx(d.e005.infoRatio, 4)}`}</Tex>，所需 <Tex>{'N'}</Tex> 乘{' '}
            <Tex>{`${fx(d.e005.nRatio, 4)}`}</Tex>。前提是 GMAC 的除數仍是 <Tex>{'N'}</Tex>、而且 valid 旗標真的把那些 sample 擋掉；若改成 hold，平均反而多出一階的 <Tex>{'P_{\\mathrm{meta}}E[q]'}</Tex>，結論類似但多一點相關。
          </>
        }
      />
    </Section>
  )
}
