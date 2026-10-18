import { useMemo, type ReactNode } from 'react'
import { ClaimTag, CodeBlock, CodeCompare, ModeGate, Section, SourceTag, Tex } from '@/components'
import comparatorSrc from '@/simulation/models/comparator.ts?raw'
import goldenPy from '../../../../golden/lms_pll_golden/comparator.py?raw'
import { TIE_RULES, directionOutcomeClt, directionOutcomeExact, meanQ, pPlus, tieRuleEquilibrium, type TieRule } from '@/simulation/models/comparator'
import { Fig, fx, pct } from '../common'

const SRC_PATH = 'src/simulation/models/comparator.ts'

const HW: Record<TieRule, { hw: ReactNode; pro: ReactNode }> = {
  strict: {
    hw: (
      <>
        評分慣例（規格字面 <Tex>{'P(S_N>0)'}</Tex>）：tie 一律算錯＝最壞情況。硬體不知道 <Tex>{'s'}</Tex> 的正負，所以它不是可實作的規則；
        <Tex>{'s>0'}</Tex> 時與硬體 <Tex>{'\\operatorname{sign}(0)=-1'}</Tex> 相同
      </>
    ),
    pro: (
      <>
        最保守；偶數 <Tex>{'N'}</Tex> 時判對率最低。偏差欄以 <Tex>{'\\operatorname{sign}(0)=-1'}</Tex> 計算：<Tex>{'+1/(NK_q)'}</Tex>
      </>
    ),
  },
  half: {
    hw: (
      <>
        <Tex>{'S_N=0'}</Tex> 時用 LFSR 的一個位元決定 <Tex>{'\\pm1'}</Tex>
      </>
    ),
    pro: '無偏、與規格 CLT 表一致；需要一個隨機位元',
  },
  plus: {
    hw: '直接取 two’s-complement 累加器的 MSB 當正負號（0 視為正）',
    pro: (
      <>
        硬體最省；偶數 <Tex>{'N'}</Tex> 有 <Tex>{'-1/(NK_q)'}</Tex> 的平衡偏差
      </>
    ),
  },
  skip: {
    hw: (
      <>
        累加器零偵測（<Tex>{'S_N=0'}</Tex>）時不更新係數
      </>
    ),
    pro: (
      <>
        無偏；需要對 <Tex>{'\\lceil\\log_2(N+1)\\rceil+1'}</Tex> 位元的累加器做零偵測，tie 時浪費一個 block
      </>
    ),
  },
}

/** §8：方法比較表 + 核心程式碼並排。 */
export function CompareSection() {
  const rows = useMemo(() => {
    const p = pPlus(1, 100)
    return TIE_RULES.map((r) => ({
      r,
      o100: directionOutcomeExact(p, 100, r),
      o101: directionOutcomeExact(p, 101, r),
      bias: tieRuleEquilibrium(100, 100, r),
    }))
  }, [])
  /** 偶數 N = 100 時，連續性修正 CLT 與精確值的最大差（四種 rule）。 */
  const corrErr = useMemo(() => {
    const p = pPlus(1, 100)
    const m = meanQ(1, 100)
    return Math.max(...TIE_RULES.map((r) => Math.abs(directionOutcomeClt(m, 100, r).correct - directionOutcomeExact(p, 100, r).correct)))
  }, [])

  return (
    <Section kind="example" level={2} title="8. 方法與演算法比較：精確 vs 近似 vs Monte Carlo，以及四種 tie rule">
      <h3>8.1 計算「判對機率」的方法</h3>
      <p>
        同一個「判對機率」，本章前面用了五種算法。該用哪一種，取決於三個問題：雜訊樣本是不是彼此獨立、你要的是驗收數字還是設計方程、<Tex>{'N'}</Tex> 是奇數還是偶數。
      </p>
      <Fig name="methodChoice">
        從最上面的菱形開始回答：雜訊有時間相關時，只有逐 sample 的 Monte Carlo 還成立（Binomial 的前提是樣本獨立）；它也是唯一能直接換成別種雜訊分布、用來驗證模型本身的方法。樣本獨立時再看你要什麼：要驗收數字就用精確的 Binomial（綠色）；要手算或設計方程就用 CLT（藍色），偶數 <Tex>{'N'}</Tex> 而且 tie rule 是確定性的，要加連續性修正；想用模擬交叉檢查或掃很大的 <Tex>{'N'}</Tex>，直接抽{' '}
        <Tex>{'K\\sim\\mathrm{Bin}(N,p)'}</Tex> 最快。圖上的五個葉子就是下表的五列；<Tex>{'T'}</Tex> 是 Monte Carlo 的 trial 數，<Tex>{'\\sigma_S=\\sqrt{N(1-m^2)}'}</Tex> 是{' '}
        <Tex>{'S_N'}</Tex> 的標準差。
      </Fig>
      <div className="table-wrap">
        <table className="ch05-table">
          <thead>
            <tr>
              <th>方法</th>
              <th>公式</th>
              <th>
                成本（每個 <Tex>{'N'}</Tex>）
              </th>
              <th>精度</th>
              <th>tie 處理</th>
              <th>何時用</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                Exact binomial <ClaimTag kind="exact" />
              </td>
              <td>
                <Tex>{String.raw`\sum_{k>N/2}\binom Nk p^k(1-p)^{N-k}`}</Tex>
              </td>
              <td>
                <Tex>{'O(\\sqrt{Np(1-p)})'}</Tex>（從眾數往尾巴加總）
              </td>
              <td>
                雙精度（相對誤差 <Tex>{'\\sim10^{-13}'}</Tex>）
              </td>
              <td>
                <Tex>{'P(S_N=0)'}</Tex> 單獨算出，任何 rule 都可套用
              </td>
              <td>
                驗收（T05）、門檻 <Tex>{'N'}</Tex>、偶數 <Tex>{'N'}</Tex>
              </td>
            </tr>
            <tr>
              <td>
                CLT 規格式 <ClaimTag kind="approx" />
              </td>
              <td>
                <Tex>{'\\Phi(m\\sqrt N/\\sqrt{1-m^2})'}</Tex>
              </td>
              <td>
                <Tex>{'O(1)'}</Tex>
              </td>
              <td>
                誤差 <Tex>{'O(1/\\sqrt N)'}</Tex>，偶數 <Tex>{'N'}</Tex> 主要是 tie 質量
              </td>
              <td>隱含 half（random tie-break）</td>
              <td>
                設計方程、手算、<Tex>{'N\\gg1'}</Tex> 的奇數 <Tex>{'N'}</Tex>
              </td>
            </tr>
            <tr>
              <td>
                CLT + 連續性修正 <ClaimTag kind="approx" />
              </td>
              <td>
                <Tex>{'\\Phi((Nm\\mp1)/\\sigma_S)'}</Tex>
              </td>
              <td>
                <Tex>{'O(1)'}</Tex>
              </td>
              <td>
                偶數 <Tex>{'N'}</Tex> 也準：<Tex>{'N=100'}</Tex> 時四種 rule 與精確值最大差 <Tex>{`${(100 * corrErr).toFixed(3)}\\%`}</Tex>
              </td>
              <td>
                依 rule 把切點移到 <Tex>{'\\pm1'}</Tex>（half 取兩者平均）
              </td>
              <td>
                手算偶數 <Tex>{'N'}</Tex>
              </td>
            </tr>
            <tr>
              <td>
                MC sample-level <SourceTag kind="simulation" />
              </td>
              <td>
                <Tex>{'\\sum_i\\mathrm{sign}(s+v_i-\\theta)'}</Tex>
              </td>
              <td>
                <Tex>{'O(NT)'}</Tex>
              </td>
              <td>
                統計誤差 <Tex>{'\\sqrt{P(1-P)/T}'}</Tex>
              </td>
              <td>與解析使用同一 rule</td>
              <td>驗證模型本身；可換成非 Gaussian 雜訊</td>
            </tr>
            <tr>
              <td>
                MC binomial <SourceTag kind="simulation" />
              </td>
              <td>
                <Tex>{'S_N=2K-N,\\;K\\sim\\mathrm{Bin}(N,p)'}</Tex>
              </td>
              <td>
                <Tex>{'O(T\\log N)'}</Tex>（建表 <Tex>{'O(\\sqrt N)'}</Tex>）
              </td>
              <td>與 sample-level 同分布（僅限 iid）</td>
              <td>同上</td>
              <td>
                大 <Tex>{'N'}</Tex>、<Tex>{'P(\\text{判對})'}</Tex> vs <Tex>{'N'}</Tex> 掃描
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <CodeCompare
        caption="同一個問題的兩種答案：左邊逐項加總 Binomial（精確），右邊用 Gaussian 一次算完（近似）。高亮行是兩者真正不同的地方。"
        items={[
          { label: 'Exact binomial', source: comparatorSrc, region: 'directionExact', path: SRC_PATH, note: '把 $K>N/2$ 的機率逐項加總；tie 是單一 pmf 值。' },
          { label: 'CLT（含連續性修正）', source: comparatorSrc, region: 'directionClt', path: SRC_PATH, note: String.raw`$S_N\approx$ Gaussian；偶數 $N$ 把切點移到格點中點 $\pm1$。` },
        ]}
      />
      <CodeCompare
        caption={String.raw`Monte Carlo 的兩個引擎：$S_N$ 只取決於 $+1$ 的個數 $K$，所以 iid 雜訊下可以直接抽 $K\sim\mathrm{Bin}(N,p)$。`}
        items={[
          { label: 'Sample-level', source: comparatorSrc, region: 'mcSampleLevel', path: SRC_PATH, note: '逐個產生 Gaussian、比較、累加：$O(N)$。' },
          { label: 'Binomial', source: comparatorSrc, region: 'mcBinomial', path: SRC_PATH, note: String.raw`一次抽出 $K$：$O(\log N)$；只適用 iid（雜訊有時間相關時必須用 sample-level）。` },
        ]}
      />

      <h3>
        8.2 四種 tie rule（只在偶數 <Tex>{'N'}</Tex> 有差）
      </h3>
      <div className="table-wrap">
        <table className="ch05-table">
          <caption>
            <Tex>{String.raw`s=1\,\mathrm{fs},\ \sigma_v=100\,\mathrm{fs}`}</Tex>。偏差 <Tex>{'s^*'}</Tex> 是判號式 block 迴路（<Tex>{'x\\equiv1'}</Tex>）在{' '}
            <Tex>{'N=100'}</Tex> 的精確平衡點（推導在 §3.4，Engineer 模式顯示）；線性 GMAC 更新不受 tie rule 影響。
          </caption>
          <thead>
            <tr>
              <th>rule</th>
              <th>硬體實作</th>
              <th className="num">
                <Tex>{'N=100'}</Tex> 判對／判錯／不動
              </th>
              <th className="num">
                <Tex>{'N=101'}</Tex> 判對
              </th>
              <th className="num">
                平衡偏差 <Tex>{'s^*'}</Tex>（<Tex>{'N=100'}</Tex>）
              </th>
              <th>評語</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.r}>
                <td className="nowrap">{x.r === 'plus' ? <Tex>{'\\operatorname{sign}(0)=+1'}</Tex> : x.r}</td>
                <td>{HW[x.r].hw}</td>
                <td className="num">
                  {pct(x.o100.correct, 1)} / {pct(x.o100.wrong, 1)} / {pct(x.o100.hold, 1)}
                </td>
                <td className="num">{pct(x.o101.correct, 2)}</td>
                <td className="num">{fx(Math.abs(x.bias) < 1e-9 ? 0 : x.bias, 3)} fs</td>
                <td>{HW[x.r].pro}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CodeCompare
        caption="E02 的要求：Monte Carlo 與解析曲線必須用同一條 tie rule。左邊把 $P(S_N=0)$ 那一份機率分給「判對／判錯／不動」，右邊是 MC 對每個 trial 做同樣的判定；高亮行是兩者唯一的不同。"
        items={[
          { label: '解析：applyTieRule', source: comparatorSrc, region: 'applyTieRule', path: SRC_PATH, note: '把 tie 的機率質量依 rule 分配（精確）。' },
          { label: 'Monte Carlo：classify', source: comparatorSrc, region: 'classify', path: SRC_PATH, note: '每個 trial 抽出 $S_N$ 後依同一條 rule 判定（統計）。' },
        ]}
      />

      <ModeGate min="engineer">
        <h3>8.3 其他核心程式碼（網站實際執行的版本）</h3>
        <CodeBlock source={comparatorSrc} region="pPlus" path={SRC_PATH} />
        <CodeBlock source={comparatorSrc} region="meanQ" path={SRC_PATH} />
        <CodeBlock source={comparatorSrc} region="kq" path={SRC_PATH} />
        <CodeBlock source={comparatorSrc} region="sumMoments" path={SRC_PATH} />
        <CodeBlock source={comparatorSrc} region="samplesForConfidence" path={SRC_PATH} />
        <CodeBlock source={comparatorSrc} region="tieEquilibrium" path={SRC_PATH} />
        <CodeBlock
          source={comparatorSrc}
          region="mcAcceptance"
          path={SRC_PATH}
          caption={String.raw`Comparator Lab 的「Analytic ↔ Monte Carlo」判準：MC 的計數必須落在精確 Binomial 的接受域內（每側機率 $<\Phi(-4)$）。稀有事件時 $4\cdot\mathrm{SE}$ 的常態近似會誤報，所以不用它。`}
        />
        <CodeBlock source={comparatorSrc} region="bitEncoding" path={SRC_PATH} caption={String.raw`反面測試：0/1 編碼的平均值偏 $\tfrac12$（T04）。`} />
      </ModeGate>
      <ModeGate min="research">
        <CodeBlock source={comparatorSrc} region="binomialSampler" path={SRC_PATH} caption={String.raw`inversion 抽樣：在 $\pm12\sigma$ 的累積表上二分搜尋（截掉的質量 $<10^{-30}$）。`} />
        <CodeBlock source={comparatorSrc} region="runComparatorMC" path={SRC_PATH} caption="Worker 端的完整 Monte Carlo（每個雜訊源各自 fork，可重現）。" />
        <CodeBlock
          source={goldenPy}
          lang="python"
          path="golden/lms_pll_golden/comparator.py"
          title="Python golden model（獨立實作，產生 golden/vectors/T04、T05）"
          caption="direction_prob_exact 的 'split' 對應本站的 half rule、'strict' 對應 strict。TypeScript 測試逐項比對這份 golden 的輸出。"
        />
      </ModeGate>
    </Section>
  )
}
