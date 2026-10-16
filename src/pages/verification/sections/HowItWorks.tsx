import { useMemo } from 'react'
import { Callout, ClaimTag, CodeBlock, CodeCompare, getTestStatus, Section, StepDerivation, TestBadge, Tex, ChRef } from '@/components'
import acceptanceSrc from '@/simulation/models/acceptance.ts?raw'
import calNoiseSrc from '@/simulation/models/calNoise.ts?raw'
import comparatorSrc from '@/simulation/models/comparator.ts?raw'
import noisePy from '../../../../golden/lms_pll_golden/noise.py?raw'
import comparatorPy from '../../../../golden/lms_pll_golden/comparator.py?raw'
import verifyMjs from '../../../../scripts/verify.mjs?raw'
import statusFile from '@/data/verification-status.json'
import { meanSquareFactor } from '@/simulation/models/lms'
import { lyapunovExponent } from '@/simulation/models/scalarStability'
import { ALL_IDS, Diagram, Expand, M, steps, useAcceptance } from '../common'
import { CHART_PIPELINE, CHART_STATUS } from '../diagrams'
import { GOLDEN_INDEX } from '../golden'
import { extractJsConstLines, extractJsFunctions, extractPythonDefs, fmtNum } from '../format'

const STATUS_FILE = statusFile as { generatedAt?: string; commit?: string; note?: string }

function pyDefs(src: string, names: string[]): string {
  try {
    return extractPythonDefs(src, names)
  } catch (e) {
    return `# 無法切出 Python 函式：${(e as Error).message}`
  }
}

const VERIFY_STATUS = (() => {
  try {
    // 依閱讀順序：先看四種狀態的判定，再看「哪些測試算進某個 T-id」的兩條規則（regex 與使用它的函式）
    return [extractJsFunctions(verifyMjs, ['statusOf']), extractJsConstLines(verifyMjs, ['TS_PREFIX', 'PY_PREFIX']), extractJsFunctions(verifyMjs, ['tsIds', 'pyIds'])].join('\n\n')
  } catch (e) {
    return `// 無法切出 verify.mjs 的函式：${(e as Error).message}`
  }
})()

const PY_T13 = pyDefs(noisePy, ['cal_noise_example', 'sigma_w2_closed'])
const PY_T05 = pyDefs(comparatorPy, ['direction_prob_exact'])

const r = String.raw

/** §V.5 驗證管線怎麼運作 */
export function HowItWorks() {
  const st = useAcceptance()
  const heavy = useMemo(() => {
    const gauss = { kind: 'gaussian', sigma: 1 } as const
    return { g08: meanSquareFactor(0.8, 1, 3), lam08: lyapunovExponent(0.8, gauss), g23: meanSquareFactor(2 / 3, 1, 3) }
  }, [])
  const strict100 = (st.byId.T05.comp?.values.p_exact_strict_list as number[] | undefined)?.[0]
  const split100 = (st.byId.T05.comp?.values.p_exact_split_list as number[] | undefined)?.[0]

  return (
    <Section kind="diagram" title="§V.5 驗證管線：TypeScript、Python golden 與 verify 腳本" level={2} id="ver-pipeline">
      <p>
        驗證不是「看起來對」，而是一條可以重跑的管線。規格的 18 個驗收值先經過 docs/validation.md 的勘誤修正，再由兩個<strong>互不共用程式碼</strong>的實作分別計算：Python golden model（
        <code>golden/lms_pll_golden/</code>）與網站各章的 TypeScript 模型（<code>src/simulation/models/</code>）。
      </p>
      <Diagram
        chart={CHART_PIPELINE}
        caption="驗證管線：只有 TypeScript 與 Python 兩邊的自動測試都通過，TestBadge 才會顯示 verified。"
        ariaLabel="驗證管線方塊圖：規格與勘誤進到 Python golden，產生 golden vector 與 pytest；TypeScript 的 Vitest 讀同一份 vector；兩邊的結果由 verify 腳本彙整成狀態檔，TestBadge 只讀這個檔"
      >
        <p>
          <strong>先看</strong>
          最上面三格：規格的 T01–T18 先經過 <code>docs/validation.md</code> 的勘誤修正，再交給 Python golden。Python 這一側往下分成兩樣東西——<code>golden/vectors/Txx.json</code>（期望值與容忍度）和 pytest 測試。
        </p>
        <p>
          <strong>再看</strong>
          往下的幾層：網站各章的 TypeScript 模型有兩個去處——被 Vitest 的 <code>it(&apos;Txx: …&apos;)</code> 拿去對照同一份 vector，以及在本頁 <code>acceptance.ts</code> 即時重算。兩邊的測試結果由藍色的{' '}
          <code>verify.mjs</code> 彙整成 <code>verification-status.json</code>，最後只有綠色的 TestBadge 讀這個檔——所以「本頁即時重算」那個方塊<strong>沒有</strong>箭頭接到徽章（圖上對照下面的誠實聲明）。
        </p>
      </Diagram>
      <h3>四種狀態（scripts/verify.mjs 的判定）</h3>
      <Diagram
        chart={CHART_STATUS}
        caption="verify.mjs 的 statusOf：先問有沒有失敗，再問兩邊是不是都有通過的測試；只有走到綠色那一格才算 verified。"
        ariaLabel="四種狀態的判定流程：任何一邊有失敗是 fail；沒有失敗且兩邊都有通過的測試是 pass，也就是 verified；只有一邊有通過的測試是 partial；兩邊都沒有是 missing"
      >
        <p>
          <strong>先看</strong>
          最上面兩個方塊：TypeScript 端與 Python 端各自把「通過幾個、失敗幾個」交給 <code>statusOf</code>。<strong>再看</strong>
          三個菱形的順序：
          {M(r`先問失敗（有就是 fail，不管另一邊多漂亮），再問兩邊是不是都有通過的測試（才是 pass），最後問至少一邊有通過的測試（partial），都沒有就是 missing。`)}
          圖上的四個結果，就是下面四張說明卡。
        </p>
      </Diagram>
      <div className="ver-status-grid">
        <div className="ver-status-card">
          <h4>✓ pass → verified</h4>
          <p className="small">
            TypeScript（<code>it(&apos;T05: …&apos;)</code>，title 本身以 T-id 開頭）與 Python（<code>test_T05_…</code>）都有通過的測試，而且沒有任何失敗。<strong>只有這個狀態</strong>
            會顯示 verified。
          </p>
        </div>
        <div className="ver-status-card">
          <h4>◐ partial</h4>
          <p className="small">只有一邊有通過的測試（例如 Python 有、TS 還沒有）。數值可能是對的，但還不算獨立驗證。</p>
        </div>
        <div className="ver-status-card">
          <h4>✗ fail</h4>
          <p className="small">任何一邊有失敗的測試。verify 的結束碼非零（CI 會擋下）。</p>
        </div>
        <div className="ver-status-card">
          <h4>○ missing → pending</h4>
          <p className="small">兩邊都沒有對應測試。網站不得把它標成已驗證（規格 §20.5 第 5、8 點）。</p>
        </div>
      </div>
      <CodeBlock
        source={VERIFY_STATUS}
        path="scripts/verify.mjs"
        title="scripts/verify.mjs：statusOf（四種狀態的判定）與 T-id 的擷取規則（JavaScript；以函式名稱從原始檔切出）"
        caption="第一行先看失敗：任何一邊有失敗就是 fail；兩邊都有通過的測試才是 pass。TS_PREFIX：it() 的 title 本身要以「Txx:」開頭（可以是「T03/T04:」這種清單；describe 的名稱不算）。PY_PREFIX：函式名稱要以 test_Txx_ 開頭（所以 test_NEG_… 不計入任何 T-id）。"
      />
      <p>
        目前的狀態檔（<code>src/data/verification-status.json</code>，產生時間 {STATUS_FILE.generatedAt ?? '未知'}，commit {STATUS_FILE.commit ?? '未知'}）：
      </p>
      <div className="c-tag-row" style={{ flexWrap: 'wrap', gap: 6 }} data-testid="status-badges">
        {ALL_IDS.map((id) => (
          <TestBadge key={id} id={id} />
        ))}
      </div>
      <p className="small muted">
        滑鼠停在徽章上可看到被計入的測試名稱。TS 端計入 {ALL_IDS.filter((id) => getTestStatus(id).tsPassed > 0).length} / 18 個 T-id、Python 端計入{' '}
        {ALL_IDS.filter((id) => getTestStatus(id).pyPassed > 0).length} / 18 個（依此狀態檔；它在 <code>npm run verify</code> 之後才更新）。
      </p>
      <Callout kind="warn" title="誠實聲明：即時重算不等於 verified">
        本頁上方的「即時判定」只證明「<strong>你現在看到的這份程式</strong>與 golden JSON 一致」。它不經過 pytest，也不保證 golden JSON 是最新的；所以徽章只認{' '}
        <code>verification-status.json</code>。兩者不一致時（即時全綠、徽章 partial），代表狀態檔過期，而不是可以把它當成已驗證。
      </Callout>

      <h3>為什麼要兩個獨立實作？</h3>
      <p>
        假設一份程式碼「某個公式寫錯、而且剛好沒被自己的單元測試發現」的機率是 <Tex>{'q'}</Tex>。兩份<strong>獨立</strong>撰寫的程式碼要「錯在同一個地方、而且錯出同一個數字（誤差小於{' '}
        <Tex>{r`10^{-12}`}</Tex>）」，機率遠小於 <Tex>{'q^2'}</Tex>。反過來，兩邊不一致時，至少能確定<strong>有一邊</strong>錯了——這正是 golden model 的價值。網站的 TS 與 Python
        使用不同的語言與數值函式庫（自寫的 <code>erf</code>、<code>binomSf</code>、Jacobi 對 NumPy 的 LAPACK、自寫的 Brent 對 SciPy 的 <code>brentq</code>）。
      </p>
      <Expand title="Golden vector 的格式與比對規則" badge="規格">
        <p>
          每個 <code>golden/vectors/Txx.json</code> 都有 <code>inputs</code>、<code>expected</code>、<code>tolerance</code>（abs / rel）與可選的 <code>tolerance_overrides</code>。
          <code>expected</code> 只放<strong>確定性</strong>數值；Monte Carlo 結果不放（TS 與 NumPy 的亂數不同），TS 端以自己的 seed 跑，再用 §V.3 的 <Tex>{'z'}</Tex> 檢定和期望值比。索引檔{' '}
          <code>index.json</code> 列出 {GOLDEN_INDEX.vectors.length} 個 vector（golden model 版本 {GOLDEN_INDEX.golden_model_version}），比對規則寫在檔頭（以下為檔案原文）：
        </p>
        <p className="ver-mono small">{GOLDEN_INDEX.comparison_rule}</p>
        <CodeBlock source={acceptanceSrc} region="goldenRule" path="src/simulation/models/acceptance.ts" title="core:goldenRule（逐元素比對；F-VF.1）" />
        <CodeBlock
          source={acceptanceSrc}
          region="compareToGolden"
          path="src/simulation/models/acceptance.ts"
          title="core:compareToGolden（每個 expected key）"
          caption="沒有計算的 key 回報 missing（incomplete），不會被當成通過。這是「不得把未完成功能標成已驗證」在程式碼層的實作。"
        />
      </Expand>

      <h3>同一個公式，兩種語言（一）：T13 的 <Tex>{r`\sigma_w`}</Tex></h3>
      <p>
        左邊是網站<ChRef ch="12">第 12 章</ChRef>實際執行的 TypeScript（<code>calNoise.ts</code> 的 <code>#region core:calLoop</code>），右邊是 Python golden（<code>noise.py</code>
        ，以函式名稱從原始檔切出——Python 檔沒有 region 標記，但顯示的仍是實際檔案內容）。兩者各自算出 <Tex>{r`\sigma_w=\mu\sqrt{\sigma_\eta^2/(1-p^2)}`}</Tex>，在{' '}
        <Tex>{r`10^{-12}`}</Tex> 內一致（§V.2 的 T13 列）。
      </p>
      <CodeCompare
        items={[
          { label: 'TypeScript（網站）', source: calNoiseSrc, region: 'calLoop', path: 'src/simulation/models/calNoise.ts', note: r`$K=K_qC$、$g=\mu K$、$p=1-g$、$\sigma_w^2=\mu^2\sigma_\eta^2/(1-p^2)$` },
          { label: 'Python（golden）', source: PY_T13, lang: 'python', path: 'golden/lms_pll_golden/noise.py', note: 'cal_noise_example + sigma_w2_closed：同一組公式，獨立撰寫' },
        ]}
        caption="兩邊的變數名稱不同（loopCore / cal_noise_example），但每一行都能一一對應——這正是 code review 時要做的事。"
      />

      <h3>同一個公式，兩種語言（二）：T05 的 tie 怎麼算</h3>
      <p>
        T05 最容易出錯的地方是偶數 <Tex>{'N'}</Tex> 的 tie（勘誤 E02）。兩邊都用精確的 Binomial：<Tex>{r`K\sim\mathrm{Binomial}(N,p)`}</Tex>，<Tex>{r`S_N=2K-N`}</Tex>。TypeScript
        把三種結果 <Tex>{r`P(S_N>0)`}</Tex>、<Tex>{r`P(S_N=0)`}</Tex>、<Tex>{r`P(S_N<0)`}</Tex> 分開回傳，再由 tie rule 決定怎麼分配；Python 用一個 <code>rule</code> 參數。
        {strict100 !== undefined && split100 !== undefined && (
          <>
            {' '}
            <Tex>{'N=100'}</Tex> 時兩邊都得到 strict <Tex>{fmtNum(strict100, 6)}</Tex>、tie 平分 <Tex>{fmtNum(split100, 6)}</Tex>。
          </>
        )}
      </p>
      <CodeCompare
        items={[
          { label: 'TypeScript（網站）', source: comparatorSrc, region: 'directionExact', path: 'src/simulation/models/comparator.ts', note: r`自寫的 binomSf / binomPmf / binomCdf（core/special.ts）；回傳三個機率` },
          { label: 'Python（golden）', source: PY_T05, lang: 'python', path: 'golden/lms_pll_golden/comparator.py', note: r`scipy.stats.binom；rule = 'strict' 或 'split'（tie 算一半）` },
        ]}
        caption="差異在介面，不在數學：TS 把 tie 機率獨立出來（方便顯示與套用不同 rule），Python 直接回傳套用 rule 後的機率。"
      />

      <h3>自己重跑</h3>
      <pre className="ver-cmd">{`npm run golden                 # pytest：Python golden model（約 10 秒）
npm run golden:export          # 重新產生 golden/vectors/*.json
npx vitest run src/simulation/models/acceptance.test.ts   # 本頁的 T01–T18 + 反面 + mutant + MC + 勘誤證據
npm run verify                 # Vitest + pytest → src/data/verification-status.json
node scripts/verify.mjs --no-run   # 只重新解析 outputs/ 內既有的報告`}</pre>

      <h3>為什麼 T03 不能用「長時間平均 <Tex>{r`\delta^2`}</Tex>」驗證（heavy tail，勘誤 E14）</h3>
      <p>
        T03 說 Gaussian regressor 的均方界是 <Tex>{r`\mu<2/3`}</Tex>。直覺做法是跑很多步、平均 <Tex>{r`\delta_n^2`}</Tex> 看它收不收斂——但這會<strong>騙人</strong>：
      </p>
      <Expand title="推導：平均值由極少數路徑主導（$g(\mu)>1$ 但 $\lambda(\mu)<0$）" badge="推導">
        <StepDerivation
          steps={steps([
            { tex: r`\delta_n=\delta_0\prod_{k=0}^{n-1}(1-\mu x_k^2)`, why: r`無雜訊、iid $x$：誤差是 $n$ 個獨立因子的乘積。` },
            { tex: r`E[\delta_n^2]=\delta_0^2\,g(\mu)^n,\qquad g(\mu)=E[(1-\mu x^2)^2]=1-2\mu+3\mu^2`, why: r`獨立 $\Rightarrow$ 乘積的期望值 = 期望值的乘積；展開平方後代入 $E[x^2]=1$、$E[x^4]=3$。` },
            { tex: r`\ln|\delta_n|=\ln|\delta_0|+\sum_{k=0}^{n-1}\ln|1-\mu x_k^2|\ \approx\ \ln|\delta_0|+n\,\lambda(\mu)`, why: r`取對數把乘積變成和；大數法則 $\Rightarrow$ 典型路徑由 $\lambda(\mu)=E[\ln|1-\mu x^2|]$ 決定。` },
            { tex: `\\mu=0.8:\\quad g=${fmtNum(heavy.g08, 4)}>1\\quad\\text{但}\\quad\\lambda=${fmtNum(heavy.lam08, 4)}<0`, why: r`均方發散，但幾乎每條路徑都收斂。兩者並不矛盾：$\ln$ 是上凸函數（二階導數 $-1/X^2<0$），「先取 $\ln$ 再平均」不會超過「先平均再取 $\ln$」——$E[\ln X]\le\ln E[X]$（Jensen 不等式）；取 $X=(1-\mu x^2)^2$ 得 $2\lambda\le\ln g$，所以 $\lambda<0$ 而 $g>1$ 是可能的。數字由 lms.ts 與 scalarStability.ts 即時計算。` },
            { tex: r`\Rightarrow\ E[\delta_n^2]\ \text{由極少數巨大的路徑主導；有限條路徑的樣本平均幾乎必然低估}`, why: r`這就是 heavy tail：樣本標準差也跟著被低估，$\pm\mathrm{SE}$ 的信賴區間失效。` },
          ])}
          result={`\\text{改用封閉式 }g(2/3)=${fmtNum(heavy.g23, 6)}\\text{，或「單步」MC 估 }E[(1-\\mu x^2)^2]`}
        />
        <p className="small">
          單步 MC 只抽一次 <Tex>{'x'}</Tex>：<Tex>{r`f=1-\mu x^2`}</Tex> 的所有動差都有限，所以 <Tex>{r`\pm\mathrm{SE}`}</Tex> 可信——這就是 §V.3 T03 那一列的作法。 <ClaimTag kind="exact" />
        </p>
      </Expand>
    </Section>
  )
}
