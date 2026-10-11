import { useMemo } from 'react'
import { ClaimTag, CodeBlock, ModeGate, Quiz, Recap, Section, StepDerivation, Tex, TexBlock } from '@/components'
import biasSrc from '@/simulation/models/bias.ts?raw'
import goldenPy from '../../../../golden/lms_pll_golden/bias.py?raw'
import { analyzeBias, buildCodeDistribution, codeMoments, fixedPoint, mseFixedPoint, signWeightedMedian, type ErrorModel } from '@/simulation/models/bias'
import { F } from '../formulas'
import { chop, num, m, texNum } from '../common'
import { Fig, FigRef } from '../Fig'
import { Hand } from '../Hand'

/** 演算法比較表、三個驗證層次、連結到 PLL、思考題與本課必記。 */
export function WrapSection() {
  const q = useMemo(() => {
    const five = buildCodeDistribution({ kind: 'five_level' })
    const pm = mseFixedPoint({ a: 1, b: 0, c2: 0, c3: 0.1, kappa: 0, sigmaV: 1 }, buildCodeDistribution({ kind: 'pm_one' }))
    const u = buildCodeDistribution({ kind: 'uniform_residue' })
    const mo = codeMoments(u)
    const off: ErrorModel = { a: 1, b: 0.05, c2: 0, c3: 0, kappa: 0, sigmaV: 1 }
    // 比較表的數字（勘誤 E17 例：σ_v(x) = √(1 + 0.25(x + 2)²)，b = 0.2；置中 code 的無雜訊 dead zone）
    const jit: ErrorModel = { a: 1, b: 0.2, c2: 0, c3: 0, kappa: 0, sigmaV: 1, jitterSlope: 0.25, jitterRef: -2 }
    return {
      pm,
      uStatic: mseFixedPoint(off, u, 'none'),
      uShared: mseFixedPoint(off, u, 'shared_bbpd'),
      uSignStatic: fixedPoint('sign', off, u, 'none').w,
      mo,
      sig01: fixedPoint('sign', { a: 1, b: 0, c2: 0, c3: 0.1, kappa: 0, sigmaV: 0.1 }, five).w,
      sig01Ratio: analyzeBias({ model: { a: 1, b: 0, c2: 0, c3: 0.1, kappa: 0, sigmaV: 0.1 }, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none' }).validityRatio,
      mo5: codeMoments(five),
      jitOffset: fixedPoint('sign', jit, five).w,
      jitCubic: fixedPoint('sign', { ...jit, c3: 0.1 }, five).w,
      deadCentered: signWeightedMedian({ ...off, b: 0.1, sigmaV: 0 }, five.values, five.probs),
    }
  }, [])
  // 本章 behavioral 測試清單的「預期值」：全部由模型即時計算（與 bias.test.ts 斷言的是同一組函式）
  const tests = useMemo(() => {
    const five = buildCodeDistribution({ kind: 'five_level' })
    const u4 = buildCodeDistribution({ kind: 'unipolar4' })
    const cubic: ErrorModel = { a: 1, b: 0, c2: 0, c3: 0.1, kappa: 0, sigmaV: 1 }
    const offm: ErrorModel = { a: 1, b: 0.5, c2: 0, c3: 0, kappa: 0, sigmaV: 1 }
    const jit: ErrorModel = { a: 1, b: 0.2, c2: 0, c3: 0, kappa: 0, sigmaV: 1, jitterSlope: 0.25, jitterRef: -2 }
    const dz = signWeightedMedian({ a: 1, b: 1, c2: 0, c3: 0, kappa: 0, sigmaV: 0 }, u4.values, u4.probs)
    return {
      mse: mseFixedPoint(cubic, five),
      s1: fixedPoint('sign', cubic, five).w,
      s0: fixedPoint('sign', { ...cubic, sigmaV: 0 }, five).w,
      s01: fixedPoint('sign', { ...cubic, sigmaV: 0.1 }, five).w,
      off: (['none', 'shared_bbpd', 'linear_pd'] as const).map((mode) => fixedPoint('sign', offm, u4, mode).w),
      jit: fixedPoint('sign', jit, five).w,
      jitMse: mseFixedPoint(jit, five),
      kappa: fixedPoint('sign', { a: 1, b: 0, c2: 0, c3: 0, kappa: 0.1, sigmaV: 1 }, five).w,
      dz,
      servo: fixedPoint('sign', { a: 1, b: 0.3, c2: 0, c3: 0.1, kappa: 0, sigmaV: 0.1 }, five, 'shared_bbpd').w,
    }
  }, [])

  return (
    <>
      <Section kind="assumptions" title="演算法比較：同一個誤差，三種答案" level={2} id="ch11-compare">
        <div className="table-wrap">
          <table className="ch11-table">
            <thead>
              <tr>
                <th>項目</th>
                <th>MSE-LMS</th>
                <th>{m('Sign-LMS（$\\sigma_v\\gg$ 殘差）')}</th>
                <th>{m('Sign-LMS（$\\sigma_v=0$）')}</th>
                <th>{m('Sign-LMS（$\\sigma_v(x)$ 隨 code）')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>GMAC 統計量</td>
                <td>
                  <Tex>{'E[x\\,e]'}</Tex>
                </td>
                <td>
                  <Tex>{String.raw`E[x\operatorname{erf}(e/\sqrt2\sigma_v)]\approx K_qE[xe]`}</Tex>
                </td>
                <td>
                  <Tex>{String.raw`E[x\operatorname{sign}(e)]`}</Tex>
                </td>
                <td>
                  <Tex>{String.raw`\approx\sqrt{2/\pi}\,E[xe/\sigma_v(x)]`}</Tex>
                </td>
              </tr>
              <tr>
                <td>固定點意義</td>
                <td>
                  <Tex>{'t(x)'}</Tex> 的 <Tex>{'x^2'}</Tex> 加權平均
                </td>
                <td>同左（一階）+ <Tex>{'O(1/\\sigma_v^2)'}</Tex> 修正</td>
                <td>
                  <Tex>{'t(x)'}</Tex> 的 <Tex>{'|x|'}</Tex> 加權中位數
                </td>
                <td>
                  <Tex>{'x^2/\\sigma_v(x)'}</Tex> 加權平均
                </td>
              </tr>
              <tr>
                <td>三階 INL 例</td>
                <td>1.34 <ClaimTag kind="exact" /></td>
                <td>
                  <Tex>{String.raw`1.34+3.456\times10^{-4}/\sigma_v^2`}</Tex> <ClaimTag kind="approx" />
                </td>
                <td>1.4 <ClaimTag kind="exact" /></td>
                <td>{m(`依 $\\sigma_v(x)$（E17 例加 $b=0.2$：$${texNum(q.jitCubic, 5)}$）`)}</td>
              </tr>
              <tr>
                <td>Offset + 置中 code</td>
                <td>無 bias</td>
                <td>無 bias（精確）</td>
                <td>
                  <strong>dead zone</strong>
                  {m(
                    `：5-level code 時 $E[G]=0$ 於整段 $(a-b/2,\\,a+b/2)$（$b=0.1$：$(${texNum(q.deadCentered.lo, 4)},\\,${texNum(q.deadCentered.hi, 4)})$），$a$ 是解但不唯一`,
                  )}
                </td>
                <td>
                  <strong>有 bias</strong>（{m(`E17 例：$w^*=${texNum(q.jitOffset, 5)}$`)}）
                </td>
              </tr>
              <tr>
                <td>需要的硬體</td>
                <td>多位元 TDC / ADC + 乘法器</td>
                <td>1-bit comparator + conditional negate</td>
                <td>同左</td>
                <td>同左</td>
              </tr>
              <tr>
                <td>雜訊的角色</td>
                <td>{m('只影響 $\\sigma_w$')}</td>
                <td>dither：把 1-bit 變回線性平均</td>
                <td>{m('沒有 dither $\\Rightarrow$ limit cycle / dead zone')}</td>
                <td>重新加權各 code</td>
              </tr>
            </tbody>
          </table>
        </div>
        <CodeBlock
          source={biasSrc}
          region="mcBlock"
          path="src/simulation/models/bias.ts"
          title="Monte Carlo 的一個 GMAC block：MSE 與 Sign 只差標示的那一行"
          caption={String.raw`Lab 的 worker 逐 sample 執行這段程式；主迴路 DC null 以 $\varphi$ 的積分 servo 實作。`}
        />
        <ModeGate min="research">
          <CodeBlock
            source={goldenPy}
            lang="python"
            path="golden/lms_pll_golden/bias.py"
            title="Python golden model（NumPy／SciPy 獨立實作，T12 的參考值由它產生）"
            caption={String.raw`golden 檔沿用規格書原始符號（$c$、$u$）；本站頁面依勘誤 E12 改記 $c_3$、$\varepsilon_{cc}$。bias.test.ts 讀 golden/vectors/T12.json 與上面的 TypeScript 實作交叉比對。`}
          />
        </ModeGate>
      </Section>

      <Section kind="assumptions" title="收斂 ≠ 準確 ≠ PLL 效能：三個驗證層次" level={2} id="ch11-levels">
        <p>
          回到開場的問題：GMAC 歸零了，DTC error 是零嗎？<FigRef id="verdict-tree" /> 把整章濃縮成一棵判斷樹。先看最上面兩個問題：先確認恢復斜率{' '}
          <Tex>{'S=K_qC'}</Tex> 是正的（真的收斂，而不是極性錯誤），再問 comparator 前是不是只有 gain 誤差與零均值雜訊 —— 兩題都答「是」才走到綠色的{' '}
          <Tex>{'w^*=a'}</Tex>。再看下半：多出來的每一項各對應本章的一節；最後的藍色六角形是 Sign-LMS 專屬的線性化檢查（勘誤 E01）。樹的前兩層對應下表的
          Convergence，其餘對應 Accuracy；PLL performance 要到 Ch12 之後才能回答。
        </p>
        <Fig id="verdict-tree" />
        <div className="table-wrap">
          <table className="ch11-table">
            <thead>
              <tr>
                <th>層次</th>
                <th>問的問題</th>
                <th>本章的工具</th>
                <th>通過不代表</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Convergence</td>
                <td>{m('$w$ 是否收斂到某個固定點？')}</td>
                <td>
                  <Tex>{'dE[G]/dw<0'}</Tex>、pole <Tex>{'1-\\mu S'}</Tex>、MC 軌跡
                </td>
                <td>收斂到正確的值</td>
              </tr>
              <tr>
                <td>Accuracy</td>
                <td>
                  <Tex>{'w^*'}</Tex> 離 <Tex>{'a'}</Tex> 多遠？殘差多大？
                </td>
                <td>
                  F-11.4–F-11.12、殘差表、<Tex>{'E[e_\\mathrm{det}^2]'}</Tex>
                </td>
                <td>輸出 jitter / spur 合格</td>
              </tr>
              <tr>
                <td>PLL performance</td>
                <td>殘差 pattern 經 PLL 後的 jitter、fractional spur？</td>
                <td>Ch12（noise / spur）、Ch13（量化）、Unified Lab</td>
                <td>所有 PVT / FCW 都合格（需 sign-off）</td>
              </tr>
            </tbody>
          </table>
        </div>
        <h3>本章的 behavioral 測試清單</h3>
        <p>
          每一列都是一個可以重跑的測試（<code>src/simulation/models/bias.test.ts</code>）；「預期」欄由本頁的模型即時計算，Monte Carlo 的判定用 §11.B 的{' '}
          <Tex>{String.raw`4\,\mathrm{SE}`}</Tex> ＋ 有限步長容許量。
        </p>
        <div className="table-wrap">
          <table className="ch11-table">
            <thead>
              <tr>
                <th>#</th>
                <th>條件</th>
                <th>預期</th>
                <th>驗證方式</th>
                <th>若失敗，代表</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td>{m('MSE-LMS、5-level、$c_3=0.1$')}</td>
                <td className="num">{num(tests.mse, 6)}</td>
                <td>T12a：封閉解 + golden vector</td>
                <td>誤差模型或動差算錯</td>
              </tr>
              <tr>
                <td>2</td>
                <td>{m('Sign-LMS、$\\sigma_v=1$')}</td>
                <td className="num">{num(tests.s1, 7)}</td>
                <td>T12b：mean-field root + MC 95% CI</td>
                <td>comparator 的 erf 模型或 GMAC 累加有誤</td>
              </tr>
              <tr>
                <td>3</td>
                <td>{m('Sign-LMS、$\\sigma_v=0$')}</td>
                <td className="num">{num(tests.s0, 6)}</td>
                <td>{m('T12c：$|x|$ 加權中位數 + MC limit cycle')}</td>
                <td>把無雜訊的 Sign 誤當成 MSE（1.34）</td>
              </tr>
              <tr>
                <td>4</td>
                <td>{m('Sign-LMS、$\\sigma_v=0.1$')}</td>
                <td className="num">{num(tests.s01, 6)}（不是 1.34）</td>
                <td>反面測試：以 1.34 當參考值必須判 mismatch</td>
                <td>{m('驗收條件沒有連同 $\\sigma_v$ 一起指定')}</td>
              </tr>
              <tr>
                <td>5</td>
                <td>{m('Offset $b=0.5$、$x\\in\\{0,1,2,3\\}$：none／shared BBPD／linear PD')}</td>
                <td className="num">{tests.off.map((w) => num(w, 5)).join(' ／ ')}</td>
                <td>三個公式 + mean-field + MC（勘誤 E03）</td>
                <td>主迴路 DC null 的架構假設不符</td>
              </tr>
              <tr>
                <td>6</td>
                <td>{m('Code-dependent jitter、置中 code、$b=0.2$')}</td>
                <td className="num">
                  {num(tests.jit, 5)}（MSE：{num(tests.jitMse, 5)}）
                </td>
                <td>{m('$1/\\sigma_v(x)$ 加權公式 + mean-field（勘誤 E17）')}</td>
                <td>把 centering 當成萬靈丹</td>
              </tr>
              <tr>
                <td>7</td>
                <td>{m('$\\varepsilon_{cc}=\\kappa x$、$\\kappa=0.1$')}</td>
                <td className="num">{num(tests.kappa, 6)}</td>
                <td>兩個世界的 GMAC 完全相同 + 不可辨識警告</td>
                <td>誤把耦合當成 gain（或反過來）</td>
              </tr>
              <tr>
                <td>8</td>
                <td>{m('無雜訊 + offset $b=1$、$x\\in\\{0,1,2,3\\}$')}</td>
                <td className="num">
                  ({num(tests.dz.lo, 5)}, {num(tests.dz.hi, 5)})
                </td>
                <td>dead zone 區間 + MC 落在區間內（依初值停在不同側）</td>
                <td>UI 把區間中的任意一點當成唯一解</td>
              </tr>
              <tr>
                <td>9</td>
                <td>{m('shared BBPD、$c_3=0.1$、$b=0.3$、$\\sigma_v=0.1$')}</td>
                <td className="num">{num(tests.servo, 6)}（理想 DC null）</td>
                <td>{m('MC 偏離理想值、與 $w^*(\\sigma_\\mathrm{eff})$ 一致（F-11.17）')}</td>
                <td>忽略 servo 自己的抖動</td>
              </tr>
              <tr>
                <td>10</td>
                <td>DSM 接近整數 FCW + DC null</td>
                <td>iid mean-field 不適用</td>
                <td>必須出現警告，且 MC 確實偏離（反面測試）</td>
                <td>把 near-integer 的 pattern 當成 iid code</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <strong>連結到 PLL：</strong>殘差 <Tex>{String.raw`e_\mathrm{det}(x;w^*)`}</Tex> 是 code 的確定函數，而 code 是 DSM 的確定序列 —— 所以殘差不是白雜訊，而是會在 fractional
          frequency 及其諧波產生 spur 的 pattern。GMAC 歸零只保證這個 pattern 與 <Tex>{'x'}</Tex> 不相關，不保證它與 <Tex>{'x^2'}</Tex>、<Tex>{'x^3'}</Tex>{' '}
          不相關。要壓低它，需要更多校正自由度（例如對 <Tex>{'x^3'}</Tex> 也做一個 LMS 係數 —— 這就進入 Ch09–10 的多參數 LMS 與 PE 問題）。
        </p>
      </Section>

      <Section kind="example" title="綜合手算：一顆 DTC 的 gain-bias 預算" level={2} id="ch11-synthesis">
        <p>
          把整章串起來算一次：給定 offset <Tex>{'b'}</Tex>、INL（<Tex>{'c_2'}</Tex>、<Tex>{'c_3'}</Tex>）、code-correlated 干擾 <Tex>{'\\kappa'}</Tex> 與 code 的平移{' '}
          <Tex>{'x_0'}</Tex>，(1) 三個來源各貢獻多少 gain bias（F-11.4）；(2) GMAC 歸零後每個 code 還剩多少殘差；(3) 這個 <Tex>{'w^*'}</Tex> 對 Sign-LMS
          可不可信（<Tex>{String.raw`\max|e_\mathrm{det}|/\sigma_v\le0.3`}</Tex>，勘誤 E01）；(4) 要讓平均 pole 為 0.98，<Tex>{'\\mu'}</Tex> 該設多少。
        </p>
        <p>
          <FigRef id="handcalc-flow" /> 是這一題的計算順序。先看 ①→③：code 的動差 → 三個 bias 項 → 固定點 <Tex>{'w^*'}</Tex>；再看 ③ 之後分出的兩條路 ——
          一條（④⑤）檢查這個 <Tex>{'w^*'}</Tex> 對 Sign-LMS 可不可信，另一條（⑥⑦）算收斂速度需要的 <Tex>{'\\mu'}</Tex>。圖上每個編號對應下面手算題的一組步驟。
        </p>
        <Fig id="handcalc-flow" />
        <Hand id="HC-11.8">{m('預設值就是 Gallery #7（答案 1.34、0.24、$\\mu\\approx0.0125$），可以直接和 §11.B 的 Lab 指標表對照。')}</Hand>
      </Section>

      <Section kind="explore" title="思考題" level={2} id="ch11-quiz">
        <Quiz
          title="思考題 1"
          question={
            <>
              同樣 <Tex>{'a=1'}</Tex>、<Tex>{'c_3=0.1'}</Tex>，但 code 改成等機率 <Tex>{'\\pm1'}</Tex>。MSE-LMS 的 <Tex>{'w^*'}</Tex> 是多少？
            </>
          }
          options={[{ label: '1.34' }, { label: '1.10', correct: true }, { label: '1.00' }, { label: '1.40' }]}
          answer={
            <>
              <StepDerivation
                steps={[
                  { tex: String.raw`E[x^2]=1,\quad E[x^4]=1`, why: m('$\\pm1$ 的任何偶次方都是 1。') },
                  { tex: String.raw`w^*=a+c_3\frac{E[x^4]}{E[x^2]}=1+0.1\cdot1`, why: '代入 F-11.8 的一般式。' },
                ]}
                result={String.raw`w^*=${texNum(q.pm, 4)}`}
              />
              <p>
                <Tex>{'\\pm1'}</Tex> code 時 <Tex>{'x^3=x'}</Tex>，三階 INL 和 gain 誤差完全分不開 —— 和 §11.3 的 <Tex>{'\\kappa x'}</Tex> 一樣是不可辨識。1.34 只屬於 5-level 分布（勘誤 E11）。
              </p>
            </>
          }
        />
        <Quiz
          title="思考題 2"
          question={
            <>
              Code 是 uniform <Tex>{'[0,1)'}</Tex> residue，comparator offset <Tex>{'b=0.05'}</Tex> t.u.，沒有 INL。(i) 主迴路 frozen 時（mode none），MSE-LMS 的 gain bias{' '}
              <Tex>{'w^*-a'}</Tex> 是多少？(ii) 若 comparator 就是 type-II 主 PLL 的 BBPD 呢？
            </>
          }
          answer={
            <>
              <StepDerivation
                steps={[
                  { tex: String.raw`E[x]=\tfrac12,\quad E[x^2]=\int_0^1x^2dx=\tfrac13`, why: m('uniform $[0,1)$ 的動差（積分）。') },
                  { tex: String.raw`\text{(i)}\;w^*-a=b\frac{E[x]}{E[x^2]}=0.05\cdot\frac{1/2}{1/3}=0.075`, why: '靜態 offset 公式 F-11.5。' },
                  { tex: String.raw`\text{(ii)}\;w^*-a=\frac{\operatorname{Cov}(x,0)}{\operatorname{Var}(x)}=0`, why: m('共用 BBPD 強制 $E[q]=0$，offset 被吸收成 static phase offset（F-11.6）。') },
                ]}
              />
              <p>
                {m(`模型計算：(i) $${texNum(q.uStatic - 1, 6)}$（Sign-LMS、$\\sigma_v=1$ 的 mean-field 為 $${texNum(q.uSignStatic - 1, 6)}$）；(ii) $${texNum(chop(q.uShared - 1), 6)}$。`)}同一顆 comparator offset，在不同主迴路架構下有完全不同的影響（勘誤 E03）。
              </p>
            </>
          }
        />
        <Quiz
          title="思考題 3"
          question={
            <>
              三階 INL 例（5-level、<Tex>{'a=1'}</Tex>、<Tex>{'c_3=0.1'}</Tex>）用 Sign-LMS，comparator 雜訊 <Tex>{'\\sigma_v=0.1'}</Tex>。可以用 1.34 當驗收標準嗎？
            </>
          }
          options={[
            { label: '可以，Sign-LMS 和 MSE-LMS 的固定點一樣' },
            { label: m('不行，最大殘差是 $\\sigma_v$ 的兩倍以上（$\\max|e_\\mathrm{det}|/\\sigma_v>2$），線性化失效，固定點約 1.367'), correct: true },
            { label: '不行，應該是 1.4' },
          ]}
          answer={
            <>
              <p>
                在 1.34 處的殘差最大是 0.24，是 <Tex>{'\\sigma_v'}</Tex> 的 2.4 倍（在真正的固定點處是 {num(q.sig01Ratio, 3)} 倍）：comparator 的 S 曲線已經彎曲，一階{' '}
                <Tex>{'K_q'}</Tex> 近似不成立。mean-field 精確根 = {num(q.sig01, 6)}（勘誤 E01 表的 1.36658）；
                也不是 1.4，因為雜訊仍提供部分 dither。驗收應以 mean-field 根（或 MC 的信賴區間）為準，並把 <Tex>{'\\sigma_v'}</Tex>、code 分布、演算法一起寫進測試條件。
              </p>
            </>
          }
        />
      </Section>

      <Recap
        title="這一課最重要的公式"
        formulas={[
          { tex: String.raw`\boxed{E[x\,e]=0\;\not\Rightarrow\;e[n]=0}`, label: 'GMAC 歸零只代表「與 code 不相關」' },
          { tex: F.fixedPoint, label: m('MSE 精確；Sign 需 $\\max_x|e_\\mathrm{det}(x;w^*)|\\ll\\sigma_v$（勘誤 E01）') },
          { tex: String.raw`E[q\mid x]=\operatorname{erf}\!\Big(\frac{e_\mathrm{det}}{\sqrt2\sigma_v}\Big)\approx K_q\Big(e_\mathrm{det}-\frac{e_\mathrm{det}^3}{6\sigma_v^2}\Big)`, label: 'Sign-LMS 的 mean-field 與它的修正項' },
          { tex: String.raw`\text{MSE}:\ w^*=\frac{E[x^2t(x)]}{E[x^2]}\qquad\text{無雜訊 Sign}:\ w^*=\operatorname{med}_{|x|}t(x)`, label: '平均 vs 中位數（1.34 vs 1.4）' },
          { tex: String.raw`\text{shared BBPD}:\ w^*\approx a+\frac{\operatorname{Cov}(x,d+\varepsilon_{cc})}{\operatorname{Var}(x)}`, label: '主迴路 DC null 會吸收 offset、改變分母（勘誤 E03）' },
        ]}
        points={[
          <>{m('LMS 的固定點由演算法的統計量決定：MSE 是 $x^2$ 加權平均、無雜訊 Sign 是 $|x|$ 加權中位數，Gaussian 雜訊在兩者之間平滑插值。')}</>,
          <>
            {m('「小誤差」指 $w^*$ 處')}
            <strong>整個</strong>
            {m('確定性殘差相對 $\\sigma_v$ 很小，不只是 $|a-w|$ 小；驗收值要附上 $\\sigma_v$、code 分布與演算法。')}
          </>,
          <>{m('Offset 造成的假 gain bias 取決於架構：靜態 $bE[x]/E[x^2]$、共用 BBPD 時消失、線性 PD + 獨立 comparator 時反而更大。')}</>,
          <>{m('Code centering 只在 $\\sigma_v>0$ 且與 code 無關（無雜訊時是 dead zone）、comparator 未飽和、且 DTC 參數一起重新定義時才有效。')}</>,
          <>{m('與 code 共線的確定性干擾（$\\varepsilon_{cc}=\\kappa x$、$\\pm1$ code 的 $x^3$）無法用單一 regressor 分辨；$C\\to0$（near-integer）時任何 bias 都被 $1/C$ 放大。')}</>,
        ]}
      />
      <p className="small muted">
        下一個值得研究的問題：如果同時用 <Tex>{'x'}</Tex> 與 <Tex>{'x^3'}</Tex> 兩個 regressor 做二參數 Sign-LMS，三階 INL 能被完全消除嗎？對 5-level code，<Tex>{'E[x^4]'}</Tex>、
        <Tex>{'E[x^6]'}</Tex> 組成的資訊矩陣條件數是多少？（提示：Ch09 的 PE 與 Ch10 的 preconditioner。）
      </p>
      <TexBlock>{String.raw`\mathbf R=\begin{bmatrix}E[x^2]&E[x^4]\\E[x^4]&E[x^6]\end{bmatrix}=\begin{bmatrix}${texNum(q.mo5.Ex2)}&${texNum(q.mo5.Ex4)}\\${texNum(q.mo5.Ex4)}&${texNum(q.mo5.Ex6)}\end{bmatrix}`}</TexBlock>
    </>
  )
}
