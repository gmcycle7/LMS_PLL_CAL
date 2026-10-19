import { useMemo, type ReactNode } from 'react'
import './chapter.css'
import { AnchorLink, Callout, ClaimTag, ModelLevel, Section, TestBadge, ChapterErratum } from '@/components'
import { KQ_SIGMA100, corr2, eigenModes, meanSquareRadius, pm1DegenerateProb, signJitterSteadyState } from '@/simulation/models/pe'
import { Intro } from './sections/Intro'
import { MatrixPrereq } from './sections/MatrixPrereq'
import { MeanRecursion } from './sections/MeanRecursion'
import { MeanSquare } from './sections/MeanSquare'
import { PeDefinition } from './sections/PeDefinition'
import { Gauge } from './sections/Gauge'
import { CodeTour } from './sections/CodeTour'
import { Wrapup } from './sections/Wrapup'
import { ChapterSymbols } from './sections/Symbols'
import { PeEigenLab } from './experiments/PeEigenLab'
import { GaugeOneHotLab } from './experiments/GaugeOneHotLab'
import { m, texNum } from './shared'

const TOC: { id: string; label: ReactNode }[] = [
  { id: 'ch09-intro', label: '一個黑盒子：兩個旋鈕總是一起動（手算）' },
  { id: 'ch09-prereq', label: <>先備知識：矩陣、eigen、正定、{m`\kappa`}</> },
  { id: 'ch09-mean', label: <>平均遞迴、對角化、598 的由來、{m`\rho=1`}</> },
  { id: 'ch09-ms', label: 'Mean vs. mean-square（勘誤 E23）' },
  { id: 'ch09-pe', label: '§9.1 PE 的有限窗口定義' },
  { id: 'ch09-lab-pe', label: '實驗：PE / Eigen Lab' },
  { id: 'ch09-gauge', label: '§9.2 GOS / PHOS gauge freedom（勘誤 E04）' },
  { id: 'ch09-lab-gauge', label: '實驗：四相 One-Hot ＋ Global Offset' },
  { id: 'ch09-code', label: '核心程式碼與演算法比較' },
  { id: 'ch09-compare', label: '決策樹、比較表、綜合手算、思考題、本課必記、連結到 PLL' },
  { id: 'symbols', label: '本章符號表（章末）' },
]

/** Chapter 09「Persistent Excitation：穩定不代表學得到」（規格 §9、§9.1、§9.2）。 */
export default function Chapter09() {
  // 「試試看」提示裡引用的數字都由模型計算（ρ = 0.99、g = 0.5）
  const tip = useMemo(() => {
    const modes = eigenModes(corr2(0.99), 0.5)
    return {
      k95: modes.k95[1],
      msLinear: meanSquareRadius('gaussian', 0.99, 0.5, 1, 'linear'),
      msSign: meanSquareRadius('gaussian', 0.99, 0.5, 1, 'sign'),
      degPct: 100 * pm1DegenerateProb(0.99, 100),
      k95Phys: eigenModes(corr2(0.99), 0.5 * KQ_SIGMA100).k95[1],
      gMax: 2 / modes.lambdas[0],
      // 1-bit、N = 1 時迴路自己的穩態抖動（F-09.18 固定點的小訊號估計）：√E[s_δ²]
      jitterN1: Math.sqrt(signJitterSteadyState(modes.lambdas, 0.5, 1)),
    }
  }, [])
  return (
    <div className="ch09">
      {/* 章首：問題與系統地圖（Intro）先出現；標籤與本章目錄接在地圖之後（PageFrame 的章首骨架也放在那裡） */}
      <Intro
        afterMap={
          <>
            <div className="c-tag-row">
              <ModelLevel level="L3" />
              <ClaimTag kind="exact" />
              <TestBadge id="T10" />
              <TestBadge id="T11" />
            </div>
            <nav aria-label="本章目錄">
              <ol className="ch09-toc">
                {TOC.map((t) => (
                  <li key={t.id}>
                    <AnchorLink id={t.id} className="ch09-toc-link">
                      {t.label}
                    </AnchorLink>
                  </li>
                ))}
              </ol>
            </nav>
          </>
        }
      />
      <MatrixPrereq />
      <MeanRecursion />
      <MeanSquare />
      <PeDefinition />

      <Section kind="explore" title="動手觀察：PE / Eigen Lab" level={2} id="ch09-lab-pe">
        <Callout kind="info" title="試試看">
          <ul>
            <li>
              預設 {m`\rho=0.99`}、{m`g=0.5`}：橢圓幾乎是一條線，平均軌跡一步掉到 {m`\mathbf v_2`} 軸上，再花 {tip.k95} blocks 爬回原點（Gallery #6）。
            </li>
            <li>
              把 {m`\rho`} 拉到 1：{m`\lambda_{\min}=0`}，警告會說明為何「不可辨識」，慢模式曲線變成水平線。
            </li>
            <li>
              把 GMAC {m`N`} 改成 1（linear、Gaussian）：mean 不變，但 mean-square 半徑變成 {m`${texNum(tip.msLinear, 3)}`}（<ChapterErratum id="E23" />）；同樣設定改成 1-bit 則是 {m`${texNum(tip.msSign, 3)}`}（增量有界）。1-bit 這一組會多一則警告：迴路自己的穩態抖動估計 {m`\sqrt{E[s_\delta^2]}\approx${texNum(tip.jitterN1, 2)}`}，已經不在小訊號區（把 {m`N`} 加大，警告才會消失）。
            </li>
            <li>
              分布改成 {m`\pm1`} code、{m`N=1`}：灰色個別軌跡呈「平台 → 突然歸零」的階梯；{m`N_0=100`} 時約 {m`${texNum(tip.degPct, 2)}\%`} 的窗口 {m`\lambda_{\min}(\mathbf R_k)=0`}。
            </li>
            <li>
              偵測器改成 1-bit、{m`K_q`} 改「物理」、{m`\mu=0.5\,\mathrm{fs}`}：{m`k_{95}`} 變成 {tip.k95Phys.toLocaleString('en-US')}（<ChapterErratum id="E05" />）。
            </li>
            <li>
              {m`g`} 拉到 1（{m`=g^\star`}）最快；超過 {m`2/\lambda_{\max}=${texNum(tip.gMax, 4)}`} 快模式就發散。介於兩者之間時仍然收斂，但最慢的換成過衝的快模式（警告會列出它要幾個 block；把 {m`\rho`} 調小，這一段範圍比較寬，容易試）。
            </li>
            <li>
              按「執行至收斂」：blocks 會自動拉到 {m`\lceil1.25\,k_{95}\rceil`}，讓最慢的模式降到 5% 的那一刻落在圖內（{m`g\le g^\star`} 時是慢模式；{m`g>g^\star`}
              時換成過衝的快模式）；{m`k_{95}`} 超過上限時警告會說明為什麼到不了。
            </li>
          </ul>
        </Callout>
        <PeEigenLab />
      </Section>

      <Gauge />

      <Section kind="explore" title="動手觀察：四相 One-Hot ＋ Global Offset" level={2} id="ch09-lab-gauge">
        <Callout kind="info" title="試試看">
          <ul>
            <li>
              拖動 {m`c`}：{m`\boldsymbol\theta'`} 的輸出與 {m`\boldsymbol\theta`} 逐點重合（差異只剩 {m`10^{-16}`} 的浮點捨入）——Gallery #11。
            </li>
            <li>打開「PLL 抑制 DC」：u-domain 的 eigenvalue 出現第二個 0，連「只動 {m`b`}」都看不到（<ChapterErratum id="E04" />）。</li>
            <li>看約束表：raw-x 固定 {m`a_0`} 就夠了；u-domain 必須「不更新 {m`b`} ＋ 固定 {m`a_0`}」。</li>
            <li>
              打開 DC null、{m`\sigma_v=0.1`}、GMAC regressor = raw {m`\tilde{\mathbf x}`}：u-domain 的 {m`w_b`} 沒有恢復力而 random walk；改成 filtered
              {m`\tilde{\mathbf u}`} 則 {m`w_b`} 凍結（preset「u-domain ＋ raw x̃ GMAC」）。
            </li>
            <li>
              同一個設定把 {m`H_{\mathrm{PD}}`} 改成 type-I：{m`w_b`} 仍然漂移，但步進被主迴路阻尼（F-09.19 的分母），警告裡的預測值會跟著變小。
            </li>
            <li>
              序列改成 cyclic：null space 不變（它是結構性的）；raw-x 的 eigenvalues 也不變（{m`\mathbf R_x`} 只看同一時刻），但 u-domain 的非零
              eigenvalues 改變（濾波器把不同時刻混在一起）。
            </li>
          </ul>
        </Callout>
        <GaugeOneHotLab />
      </Section>

      <CodeTour />
      <Wrapup />
      <ChapterSymbols />
    </div>
  )
}
