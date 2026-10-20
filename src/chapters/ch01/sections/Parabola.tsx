import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { ClaimTag, CodeBlock, Derivation, ModeGate, Plot, Prereq, Section, StepDerivation, Tex, TexBlock, useThemeTokens, ChRef, ChapterErratum } from '@/components'
import { mean } from '@/simulation/core'
import { batchL2, mseParabola } from '@/simulation/models/lossCompare'
import lossSrc from '@/simulation/models/lossCompare.ts?raw'
import { BlockDiagram, ChapterHandCalc, PllLink, SpecNote, texNum, useChapterMode } from '../common'

/** 與 §1.0 相同的三筆含雜訊資料：把「期望值」當成三筆等機率的平均 */
const X = [1, 2, 4]
const Y = [3.2, 5.7, 12.5]

export function ParabolaSection() {
  const tokens = useThemeTokens()
  const { atLeast } = useChapterMode()
  const m = useMemo(() => {
    const Ex2 = mean(X.map((x) => x * x))
    const Exy = mean(X.map((x, i) => x * Y[i]))
    const Ey2 = mean(Y.map((y) => y * y))
    const wT = 2.5 // 示範切線的位置
    // lossCompare.ts 的 mseParabola：w*、J(w*) 與 w = wT 的斜率 dJ/dw = w·E[x²] − E[xy] = −E[e·x]（手算題 HC-01.2 用同一個函式）
    const par = mseParabola(Ex2, Exy, Ey2, wT)
    const J = (w: number) => 0.5 * mean(X.map((x, i) => (Y[i] - w * x) ** 2))
    // §1.2.1「正交 ≠ 不相關」的數字（審查 C09）：最佳解的誤差 e* = y − w*·x 與 x 相乘再平均是 0，
    // 但 e* 的平均 E[e*] = −2/45、輸入的平均 E[x] = 7/3 都不是 0，所以 E[e*x] = 0 ≠ E[e*]·E[x] = −14/135
    const Ex = mean(X)
    const Ee = mean(X.map((x, i) => Y[i] - par.wStar * x))
    return { Ex2, Exy, Ey2, wStar: par.wStar, Jmin: par.jMin, J, wT, slope: par.slope, check: batchL2(X, Y), Ex, Ee }
  }, [])

  const plot = useMemo<Data[]>(() => {
    const grid = Array.from({ length: 161 }, (_, i) => 1.5 + (3 * i) / 160)
    const half = 0.35
    return [
      { x: grid, y: grid.map(m.J), name: String.raw`$J(w)=\tfrac12\cdot\tfrac13\,\sum(y_i-w\,x_i)^2$`, mode: 'lines', line: { color: tokens.series[0] } },
      { x: [m.wStar], y: [m.Jmin], name: String.raw`$w^*=${texNum(m.wStar, 5)}$`, mode: 'markers', marker: { size: 12, color: tokens.series[1] } },
      {
        x: [m.wT - half, m.wT + half],
        y: [m.J(m.wT) - m.slope * half, m.J(m.wT) + m.slope * half],
        name: String.raw`$w=${m.wT}$ 的切線（斜率 $-E[e\,x]=${texNum(m.slope, 4)}$）`,
        mode: 'lines',
        line: { dash: 'dot', color: tokens.series[3] },
      },
      { x: [m.wT], y: [m.J(m.wT)], name: `$w=${m.wT}$`, mode: 'markers', marker: { size: 9, color: tokens.series[3] } },
      { x: [1.5, 4.5], y: [m.Jmin, m.Jmin], name: String.raw`$J(w^*)$（雜訊底）`, mode: 'lines', line: { dash: 'dash', color: tokens.textMuted } },
    ]
  }, [m, tokens])

  const expand = (
    <StepDerivation
      title={
        <>
          把 <Tex>{'J_2(w)'}</Tex> 展開成 <Tex>{'w'}</Tex> 的二次式
        </>
      }
      steps={[
        { tex: String.raw`J_2(w)=E\big[(y-wx)^2\big]`, why: '定義（規格 §1）' },
        {
          tex: String.raw`=E\big[y^2-2wxy+w^2x^2\big]`,
          why: (
            <>
              乘開 <Tex>{String.raw`(A-B)^2=A^2-2AB+B^2`}</Tex>，其中 <Tex>{'A=y'}</Tex>、<Tex>{'B=wx'}</Tex>
            </>
          ),
        },
        { tex: String.raw`=E[y^2]-E[2wxy]+E[w^2x^2]`, why: '期望值的線性：和的平均 = 平均的和' },
        {
          tex: String.raw`=E[y^2]-2w\,E[xy]+w^2\,E[x^2]`,
          why: (
            <>
              <Tex>{'w'}</Tex> 是我們選的確定數，不是隨機變數，可以提到 <Tex>{'E[\\cdot]'}</Tex> 外面（<Tex>{'E[cX]=cE[X]'}</Tex>）
            </>
          ),
        },
      ]}
    />
  )

  const minimize = (
    <StepDerivation
      title="微分 = 0 求最低點"
      steps={[
        {
          tex: String.raw`\frac{dJ_2}{dw}=\frac{d}{dw}\Big(E[y^2]-2w\,E[xy]+w^2E[x^2]\Big)`,
          why: (
            <>
              上一步的結果；<Tex>{'E[y^2]'}</Tex>、<Tex>{'E[xy]'}</Tex>、<Tex>{'E[x^2]'}</Tex> 都是與 <Tex>{'w'}</Tex> 無關的常數
            </>
          ),
        },
        {
          tex: String.raw`=0-2E[xy]+2w\,E[x^2]`,
          why: (
            <>
              逐項微分：<Tex>{String.raw`\tfrac{d}{dw}c=0`}</Tex>、<Tex>{String.raw`\tfrac{d}{dw}cw=c`}</Tex>、<Tex>{String.raw`\tfrac{d}{dw}cw^2=2cw`}</Tex>
            </>
          ),
        },
        { tex: String.raw`-2E[xy]+2w^*E[x^2]=0`, why: '拋物線的最低點斜率為 0' },
        {
          tex: String.raw`w^*=\frac{E[xy]}{E[x^2]}\qquad(E[x^2]>0)`,
          why: (
            <>
              移項、兩邊除以 <Tex>{'2E[x^2]'}</Tex>；<Tex>{'E[x^2]=0'}</Tex> 時（<Tex>{'x'}</Tex> 恆為 0）無解：不可辨識
            </>
          ),
        },
        { tex: String.raw`\frac{d^2J_2}{dw^2}=2E[x^2]>0`, why: '二階導數為正，拋物線開口向上，所以這是最小值而不是最大值' },
      ]}
    />
  )

  const substitute = (
    <StepDerivation
      title={
        <>
          代入 <Tex>{'y=ax+v'}</Tex>：最佳解是不是 <Tex>{'a'}</Tex>？
        </>
      }
      steps={[
        {
          tex: String.raw`E[xy]=E\big[x(ax+v)\big]`,
          why: (
            <>
              把模型 <Tex>{'y=ax+v'}</Tex> 代入
            </>
          ),
        },
        {
          tex: String.raw`=a\,E[x^2]+E[xv]`,
          why: (
            <>
              乘開後用線性；<Tex>{'a'}</Tex> 是常數可提出
            </>
          ),
        },
        {
          tex: String.raw`w^*=\frac{aE[x^2]+E[xv]}{E[x^2]}=a+\frac{E[xv]}{E[x^2]}`,
          why: (
            <>
              代回 <Tex>{String.raw`w^*=E[xy]/E[x^2]`}</Tex>，分子拆成兩項
            </>
          ),
        },
      ]}
      result={String.raw`w^*=a\iff E[xv]=0\quad(\text{且 }E[x^2]>0)`}
    />
  )

  const normalEq = (
    <StepDerivation
      title="Normal equation（正交原理）"
      steps={[
        { tex: String.raw`\frac{dJ_2}{dw}\Big|_{w^*}=-2E[xy]+2w^*E[x^2]=0`, why: '最低點條件（上一段的第 3 步）' },
        { tex: String.raw`E[xy]-w^*E[x^2]=E\big[x\,(y-w^*x)\big]`, why: '把兩項合回同一個期望值（線性的反向使用）' },
        { tex: String.raw`=E[e^*x]=0,\qquad e^*=y-w^*x`, why: '括號裡正是最佳解的誤差' },
      ]}
    />
  )

  const square = (
    <StepDerivation
      title="配方：成本 = 雜訊底 + 二次碗"
      steps={[
        {
          tex: String.raw`J(w)=\tfrac12\big(E[y^2]-2wE[xy]+w^2E[x^2]\big)`,
          why: (
            <>
              本站的 <Tex>{String.raw`J=\tfrac12J_2`}</Tex>（F-01.3 乘 <Tex>{String.raw`\tfrac12`}</Tex>）
            </>
          ),
        },
        {
          tex: String.raw`\begin{aligned}&=\tfrac12E[x^2]\Big(w^2-2w\,\frac{E[xy]}{E[x^2]}\Big)\\&\quad+\tfrac12E[y^2]\end{aligned}`,
          why: (
            <>
              把含 <Tex>{'w'}</Tex> 的兩項提出 <Tex>{'E[x^2]'}</Tex>
            </>
          ),
        },
        {
          tex: String.raw`=\tfrac12E[x^2]\big(w^2-2ww^*+w^{*2}\big)-\tfrac12E[x^2]w^{*2}+\tfrac12E[y^2]`,
          why: (
            <>
              用 <Tex>{String.raw`w^*=E[xy]/E[x^2]`}</Tex>，並加減 <Tex>{'w^{*2}'}</Tex> 湊完全平方
            </>
          ),
        },
        {
          tex: String.raw`=\tfrac12E[x^2](w-w^*)^2+\tfrac12\Big(E[y^2]-\frac{E[xy]^2}{E[x^2]}\Big)`,
          why: (
            <>
              <Tex>{String.raw`w^2-2ww^*+w^{*2}=(w-w^*)^2`}</Tex>；<Tex>{String.raw`E[x^2]\,w^{*2}=E[xy]^2/E[x^2]`}</Tex>
            </>
          ),
        },
        {
          tex: String.raw`J(w^*)=\tfrac12E[v^2]\quad\text{若 }E[xv]=0`,
          why: (
            <>
              代入 <Tex>{'y=ax+v'}</Tex> 且 <Tex>{'E[xv]=0'}</Tex>：<Tex>{String.raw`E[y^2]=a^2E[x^2]+E[v^2]`}</Tex>、
              <Tex>{String.raw`E[xy]^2/E[x^2]=a^2E[x^2]`}</Tex>，相減只剩 <Tex>{'E[v^2]'}</Tex>
            </>
          ),
        },
      ]}
    />
  )

  const half = (
    <StepDerivation
      title={
        <>
          從單筆成本 <Tex>{String.raw`j_n=\tfrac12e_n^2`}</Tex> 推出 LMS
        </>
      }
      steps={[
        {
          tex: String.raw`j_n=\tfrac12e_n^2,\qquad e_n=y_n-wx_n`,
          why: (
            <>
              單筆成本；<Tex>{'E[j_n]=J(w)'}</Tex>，所以它是 <Tex>{'J'}</Tex> 的「一筆樣本」
            </>
          ),
        },
        {
          tex: String.raw`\frac{\partial j_n}{\partial w}=e_n\cdot\frac{\partial e_n}{\partial w}`,
          why: (
            <>
              連鎖律：<Tex>{String.raw`\tfrac{d}{dw}\big(\tfrac12u^2\big)=u\,\tfrac{du}{dw}`}</Tex>，<Tex>{String.raw`\tfrac12`}</Tex> 正好消掉平方帶下來的 2
            </>
          ),
        },
        {
          tex: String.raw`=e_n\cdot(-x_n)=-e_nx_n`,
          why: (
            <>
              <Tex>{'e_n=y_n-wx_n'}</Tex> 對 <Tex>{'w'}</Tex> 微分；<Tex>{'y_n'}</Tex>、<Tex>{'x_n'}</Tex> 是已知數
            </>
          ),
        },
        {
          tex: String.raw`w_{n+1}=w_n-\mu\frac{\partial j_n}{\partial w}=w_n+\mu e_nx_n`,
          why: (
            <>
              Gradient descent：往梯度的反方向走 <Tex>{'\\mu'}</Tex> 倍
            </>
          ),
        },
        {
          tex: String.raw`E\Big[\frac{\partial j_n}{\partial w}\Big]=-E[xy]+wE[x^2]=\frac{dJ}{dw}`,
          why: (
            <>
              單筆梯度的期望值等於平均成本的梯度（無偏；<Tex>{'w'}</Tex> 在這一步是確定數）；LMS 用它代替真正的梯度
            </>
          ),
        },
      ]}
    />
  )

  const meanUpdate = (
    <StepDerivation
      title={
        <>
          平均而言，LMS 的每一步指向哪裡？（<Tex>{'w'}</Tex> 固定在目前的值，對資料取平均）
        </>
      }
      steps={[
        {
          tex: String.raw`E[\Delta w]=\mu\,E[e\,x]=\mu\,E\big[(y-wx)\,x\big]=\mu\big(E[xy]-w\,E[x^2]\big)`,
          why: (
            <>
              代入 <Tex>{'e=y-wx'}</Tex>，用期望值的線性；<Tex>{'w'}</Tex> 是目前的值（確定數）
            </>
          ),
        },
        {
          tex: String.raw`=\mu\big((a-w)\,E[x^2]+E[xv]\big)`,
          why: (
            <>
              §1.2：<Tex>{String.raw`E[xy]=a\,E[x^2]+E[xv]`}</Tex>
            </>
          ),
        },
        {
          tex: String.raw`=\mu\,E[x^2]\,(w^*-w)`,
          why: (
            <>
              提出 <Tex>{'E[x^2]'}</Tex> 並用 <Tex>{String.raw`w^*=a+E[xv]/E[x^2]`}</Tex>：平均更新量永遠指向 <Tex>{'w^*'}</Tex>，大小正比於還差多遠
            </>
          ),
        },
      ]}
      result={String.raw`E[\Delta w]=\mu\,E[x^2]\,(w^*-w)\ \overset{E[xv]=0}{=}\ \mu\,E[x^2]\,(a-w)`}
    />
  )

  return (
    <>
      <Section
        kind="formula"
        title={
          <>
            1.2 <Tex>{'J(w)'}</Tex> 是一條拋物線：用微積分找最低點
          </>
        }
        level={2}
        id="ch01-s12"
      >
        <p>
          先把「Mean Squares」寫成 <Tex>{'w'}</Tex> 的函數。因為 <Tex>{'w'}</Tex> 只出現在 <Tex>{'(y-wx)^2'}</Tex> 裡，展開後一定是{' '}
          <Tex>{'w'}</Tex> 的二次式——也就是拋物線。
        </p>
        <Prereq title="相關（correlation）$E[xy]$：兩個量「一起動」的程度">
          <p>
            <Tex>{'E[xy]'}</Tex> 是「<Tex>{'x'}</Tex> 乘 <Tex>{'y'}</Tex>」的平均。若 <Tex>{'x'}</Tex> 大的時候 <Tex>{'y'}</Tex>{' '}
            也大、<Tex>{'x'}</Tex> 為負時 <Tex>{'y'}</Tex> 也為負，乘積多半是正的，<Tex>{'E[xy]'}</Tex> 就是大的正數；若兩者毫無關係且其中一個平均為 0，正負乘積互相抵消，<Tex>{'E[xy]=0'}</Tex>，稱為<strong>正交（orthogonal）</strong>。
          </p>
          <p className="small">
            用語提醒：<Tex>{'E[xy]=0'}</Tex> 叫正交；<strong>不相關（uncorrelated）</strong>是指 <Tex>{'E[xy]=E[x]\\,E[y]'}</Tex>（<ChRef ch="00">Ch00</ChRef> §0.7 的定義）。只要其中一個量的平均為 0，兩者就是同一件事——所以雜訊 <Tex>{'v'}</Tex> 零均值時，<Tex>{'E[xv]=0'}</Tex> 說成正交或不相關都可以。但 §1.2.1 的最佳誤差{' '}
            <Tex>{'e^*'}</Tex> 平均不一定是 0（輸入 <Tex>{'x'}</Tex> 的平均也不一定是 0），那裡要說「正交」（正交原理）。
          </p>
          <ul>
            <li>
              <Tex>{'E[x^2]'}</Tex>：<Tex>{'x'}</Tex> 和自己的相關，就是輸入功率 <Tex>{'P_x'}</Tex>。
            </li>
            <li>
              <Tex>{'E[xv]=0'}</Tex>：雜訊不會「跟著 <Tex>{'x'}</Tex> 一起動」。若 <Tex>{'v'}</Tex> 與 <Tex>{'x'}</Tex> 獨立且{' '}
              <Tex>{'E[v]=0'}</Tex>，則 <Tex>{'E[xv]=E[x]\\,E[v]=0'}</Tex>（獨立時乘積的平均 = 平均的乘積）。
            </li>
          </ul>
        </Prereq>
        <p>
          先講結論，再看為什麼：這條拋物線的最低點 <Tex>{'w^*'}</Tex> 只需要兩個平均就算得出來——輸入平方的平均 <Tex>{'E[x^2]'}</Tex>，以及輸入乘量測的平均{' '}
          <Tex>{'E[xy]'}</Tex>。用 §1.0 的三筆含雜訊資料走一次：
        </p>
        <BlockDiagram id="D-01.5">
          先看左邊的資料表拆成兩欄：①每筆的 <Tex>{'x_i^2'}</Tex>、②每筆的 <Tex>{'x_iy_i'}</Tex>。再看 ③④ 各自加總，最後 ⑤ 相除——整題只有一次除法。圖上的{' '}
          <Tex>{String.raw`\Sigma x_i^2`}</Tex> 除以筆數就是公式裡的 <Tex>{'E[x^2]'}</Tex>，<Tex>{String.raw`\Sigma x_iy_i`}</Tex> 除以筆數就是 <Tex>{'E[xy]'}</Tex>；分子分母同除以 3 會消掉，所以 <Tex>{String.raw`w^*=E[xy]/E[x^2]=\Sigma x_iy_i/\Sigma x_i^2`}</Tex>（下面的 F-01.4）。
        </BlockDiagram>
        <TexBlock
          id="F-01.3"
          label={
            <>
              <Tex>{'J_2(w)'}</Tex> 是 <Tex>{'w'}</Tex> 的二次式
            </>
          }
        >
          {String.raw`J_2(w)=E[y^2]-2w\,E[xy]+w^2E[x^2]`}
        </TexBlock>
        {atLeast('engineer') ? expand : <Derivation title="逐步展開 $J_2(w)$" derivation={expand} level="L0" claim="exact" />}
        <p>
          <strong>先用數字看一次</strong>（三筆含雜訊資料，每筆機率 1/3）：
          <Tex>{String.raw`E[x^2]=\tfrac13(1+4+16)=${texNum(m.Ex2, 6)}`}</Tex>、
          <Tex>{String.raw`E[xy]=${texNum(m.Exy, 6)}`}</Tex>、<Tex>{String.raw`E[y^2]=${texNum(m.Ey2, 6)}`}</Tex>，所以
        </p>
        <TexBlock>
          {String.raw`J_2(w)=${texNum(m.Ey2, 6)}-2\cdot${texNum(m.Exy, 6)}\,w+${texNum(m.Ex2, 6)}\,w^2`}
        </TexBlock>
        {atLeast('engineer') ? minimize : <Derivation title="微分 = 0 求最低點" derivation={minimize} level="L0" claim="exact" />}
        <TexBlock id="F-01.4" label="MSE 最佳解（純量 Wiener 解）">
          {String.raw`\boxed{w^*=\frac{E[xy]}{E[x^2]}=a+\frac{E[xv]}{E[x^2]}}`}
        </TexBlock>
        <p>
          數字：<Tex>{String.raw`w^*=${texNum(m.Exy, 6)}/${texNum(m.Ex2, 6)}=${texNum(m.wStar, 6)}`}</Tex>，與 §1.0 的{' '}
          <Tex>{String.raw`\hat a_{\text{LS}}=${texNum(m.check, 6)}`}</Tex> 相同（三筆等機率時，期望值就是樣本平均）。
        </p>
        <Plot
          title="三筆資料的 $J(w)$：拋物線、最低點與切線"
          ariaLabel="三筆資料的成本曲線 J(w)：拋物線、最低點與切線"
          data={plot}
          layout={{ xaxis: { title: { text: '$w$' } }, yaxis: { title: { text: '$J(w)$' } } }}
          height={280}
          csvName="ch01-parabola"
          caption={
            <>
              由三筆資料即時計算。切線斜率 <Tex>{String.raw`dJ/dw=-E[e\,x]`}</Tex>：斜率為負 ⇒ 往右（<Tex>{'w'}</Tex> 變大）成本下降。
            </>
          }
        />

        {atLeast('engineer') ? substitute : <Derivation title="代入 $y=ax+v$" derivation={substitute} level="L0" claim="exact" />}
        <p>
          <ClaimTag kind="exact" />{' '}
          <strong>
            只有在雜訊與輸入正交（<Tex>{'E[xv]=0'}</Tex>：相乘再平均等於 0）時，最小平方解才等於真值 <Tex>{'a'}</Tex>。
          </strong>
          規格 §1 沒寫出這個條件{' '}
          <SpecNote>
            <Tex>{'w^*=a'}</Tex> 需 <Tex>{'E[xv]=0'}</Tex> 且 <Tex>{'E[x^2]>0'}</Tex>
          </SpecNote>
          。典型成立的情況：<Tex>{'v'}</Tex> 零均值且與 <Tex>{'x'}</Tex> 獨立——其實 <Tex>{'v'}</Tex> 零均值、與 <Tex>{'x'}</Tex> 不相關（<ChRef ch="00">Ch00</ChRef> §0.7
          的定義）就足夠（§1.4 手算例 <Tex>{'v=0'}</Tex> 也成立）。反例：若量測誤差裡有一部分「跟著{' '}
          <Tex>{'x'}</Tex> 走」，例如 <Tex>{String.raw`v=0.5\,x+u`}</Tex>（<Tex>{'u'}</Tex> 與 <Tex>{'x'}</Tex> 獨立、零均值），則{' '}
          <Tex>{String.raw`E[xv]=0.5E[x^2]`}</Tex>，<Tex>{String.raw`w^*=a+0.5`}</Tex>——LMS 會非常穩定地收斂到<strong>錯的答案</strong>。這正是 Part C 的 bias 問題（
          <Link to="/ch/11">Ch11：GMAC 歸零不代表 DTC Error 為零</Link>）。
        </p>
        <ChapterHandCalc id="HC-01.1">
          用你自己的三筆資料算一次 <Tex>{'w^*'}</Tex>：先在紙上列出 <Tex>{'x_i^2'}</Tex> 與 <Tex>{'x_iy_i'}</Tex> 兩欄再加總；把{' '}
          <Tex>{'w^*'}</Tex> 代回去，親手確認殘差乘上 <Tex>{'x'}</Tex> 的總和是 0（下一小節的 normal equation）；最後填一個你認為的真值{' '}
          <Tex>{'a'}</Tex>，看雜訊貢獻了多少 bias。預設就是上面那三筆含雜訊資料。
        </ChapterHandCalc>
      </Section>

      <Section kind="formula" title="1.2.1 Normal equation：最佳解處「誤差與輸入正交」" level={3} id="ch01-s121">
        <p>
          §1.2 用「斜率為 0」找到最低點。同一個條件還有另一種讀法，而且硬體更喜歡：不用算成本，只要檢查
          <strong>誤差和輸入還有沒有「一起動」</strong>。做法是把每一筆的誤差乘上輸入、再取平均——這種「相乘再平均」的電路叫相關器（correlator）。
        </p>
        <BlockDiagram id="D-01.6">
          先看藍色的三格：誤差 <Tex>{'e'}</Tex> 和輸入 <Tex>{'x'}</Tex> 相乘，很多筆取平均，得到相關 <Tex>{'E[e\\,x]'}</Tex>。再看菱形：不是 0 就走下面「否」那條路回去再調{' '}
          <Tex>{'w'}</Tex>（調完得到新的誤差，再繞一圈），是 0 就停在綠色那一格。圖上綠色方塊裡的 <Tex>{String.raw`E[e^*x]=0`}</Tex> 就是下面的 normal equation（F-01.5），其中{' '}
          <Tex>{'e^*=y-w^*x'}</Tex> 是最佳解的誤差；「再調 <Tex>{'w'}</Tex>」那一格的 <Tex>{String.raw`\mu E[e\,x]`}</Tex> 是 §1.3 會算出來的 LMS 平均更新量。
        </BlockDiagram>
        {atLeast('engineer') ? normalEq : <Derivation title="Normal equation" derivation={normalEq} level="L0" claim="exact" />}
        <TexBlock id="F-01.5" label="Normal equation（正交原理）">
          {String.raw`\boxed{E[e^*x]=0}`}
        </TexBlock>
        <p className="small">
          <ClaimTag kind="exact" /> 名稱與成立條件：<Tex>{'E[e^*x]=0'}</Tex>（相乘再平均等於 0）叫做誤差與輸入<strong>正交（orthogonal）</strong>。只要{' '}
          <Tex>{'E[x^2]>0'}</Tex> 它就成立，不需要對雜訊做任何假設——就算 <Tex>{String.raw`E[xv]\ne0`}</Tex>、<Tex>{String.raw`w^*\ne a`}</Tex> 也一樣。它和「不相關」（
          <Tex>{String.raw`E[e^*x]=E[e^*]\,E[x]`}</Tex>，<Link to="/ch/00">Ch00</Link> §0.7 的定義）不是同一句話：兩者只有在 <Tex>{'E[x]=0'}</Tex> 或{' '}
          <Tex>{'E[e^*]=0'}</Tex> 時才相同。§1.2 的三筆資料就不同：<Tex>{'E[e^*x]=0'}</Tex>，但 <Tex>{String.raw`E[e^*]=${texNum(m.Ee, 4)}`}</Tex>、
          <Tex>{String.raw`E[x]=${texNum(m.Ex, 4)}`}</Tex>，<Tex>{String.raw`E[e^*]\,E[x]=${texNum(m.Ee * m.Ex, 4)}\ne0`}</Tex>。若 <Tex>{'v'}</Tex> 零均值且與{' '}
          <Tex>{'x'}</Tex> 獨立，則 <Tex>{'w^*=a'}</Tex>、<Tex>{'e^*=v'}</Tex>、<Tex>{'E[e^*]=0'}</Tex>：這時正交也就是不相關，所以常被簡稱為「不相關」。相關器累加的是 <Tex>{String.raw`e\cdot x`}</Tex> 本身，不會先扣掉平均，所以它檢查的是正交（PLL 的 GMAC 也一樣不扣平均，只是誤差先取了正負號，見下面的「連結到 PLL」）。
        </p>
        <p>
          白話：如果誤差和輸入還「一起動」（<Tex>{'E[ex]\\ne0'}</Tex>），代表誤差裡還有一部分可以用調 <Tex>{'w'}</Tex> 解釋掉，就還沒到最低點。LMS 的平均更新量 <Tex>{String.raw`\mu E[e\,x]`}</Tex> 正是在「量測還剩多少相關」，相關歸零就停。
        </p>
        <PllLink>
          GMAC（gain multiply-accumulate）在硬體裡累加的就是 <Tex>{String.raw`\sum_n q_n x_n`}</Tex>，其中{' '}
          <Tex>{String.raw`q_n=\operatorname{sign}(e_n)`}</Tex> 來自 1-bit comparator／BBPD：它取的是 PD 的輸出 <Tex>{'e_n'}</Tex>（送進 loop filter 的同一個訊號）的正負號（
          <Tex>{String.raw`\operatorname{sign}`}</Tex> 取正負號：正數給 <Tex>{'+1'}</Tex>、負數給 <Tex>{'-1'}</Tex>）。它正是上圖的相關器，只是誤差先被取了正負號。所以校正迴路的固定點是{' '}
          <Tex>{String.raw`E[\operatorname{sign}(e)\,x]=0`}</Tex>——那是 §2 的 MAE 版 normal equation，不是 MSE 版。兩者何時一致，見{' '}
          <Link to="/ch/05">
            Ch05（comparator 等效增益 <Tex>{'K_q'}</Tex>）
          </Link>與 <Link to="/ch/11">Ch11（1.34 vs 1.4）</Link>。
        </PllLink>
        <p>
          最後一個問題：到了 <Tex>{'w^*'}</Tex>，成本是不是 0？不是。成本可以拆成兩塊——一塊跟 <Tex>{'w'}</Tex> 有關（調得掉），一塊跟 <Tex>{'w'}</Tex> 無關（調不掉）：
        </p>
        <BlockDiagram id="D-01.7">
          先看上面那條路：你選的 <Tex>{'w'}</Tex> 減掉 <Tex>{'w^*'}</Tex>、平方、再乘上藍色的 <Tex>{String.raw`\tfrac12E[x^2]`}</Tex>——這是一個碗，<Tex>{'w=w^*'}</Tex> 時剛好是 0。再看下面紅色那一格：雜訊底 <Tex>{'J(w^*)'}</Tex> 不經過任何含 <Tex>{'w'}</Tex> 的方塊，直接加到輸出。圖上兩條路相加，就是下面的 F-01.6：
          <Tex>{String.raw`J(w)=J(w^*)+\tfrac12E[x^2](w-w^*)^2`}</Tex>。
        </BlockDiagram>
        {atLeast('engineer') ? square : <Derivation title="配方" derivation={square} level="L0" claim="exact" />}
        <TexBlock id="F-01.6" label="成本 = 雜訊底 + 二次碗">
          {String.raw`J(w)=J(w^*)+\tfrac12E[x^2]\,(w-w^*)^2`}
        </TexBlock>
        <p>
          數字：<Tex>{String.raw`J(w^*)=${texNum(m.Jmin, 6)}`}</Tex>（上圖的虛線）。調 <Tex>{'w'}</Tex> 只能消掉「碗」的部分，消不掉雜訊底；碗的曲率 <Tex>{'E[x^2]'}</Tex> 越大，偏離最佳解的代價越大——也越容易學（§1.4 的收斂速度正比於 <Tex>{String.raw`\mu E[x^2]`}</Tex>）。
        </p>
        <ModeGate min="engineer">
          <CodeBlock
            source={lossSrc}
            region="mseParabola"
            path="src/simulation/models/lossCompare.ts"
            title="拋物線只需要三個數：$E[x^2]$、$E[xy]$、$E[y^2]$（網站實際執行的程式碼）"
            caption="上面的 $w^*$、$J(w^*)$、切線斜率，以及下面的手算題，都是呼叫這個函式算出來的。"
          />
        </ModeGate>
        <ChapterHandCalc id="HC-01.2">
          拋物線上任選一個 <Tex>{'w'}</Tex>，手算它的成本與斜率；求出 <Tex>{'w^*'}</Tex> 後代回去確認 normal equation{' '}
          <Tex>{'E[e^*x]=0'}</Tex>，再用「雜訊底 + 二次碗」驗算一次。預設數字是上面三筆資料的三個總和，
          <Tex>{'w=2.5'}</Tex> 就是圖上畫切線的那一點。
        </ChapterHandCalc>
      </Section>

      <Section
        kind="formula"
        title={
          <>
            1.3 公式從哪來？以及那個 <Tex>{String.raw`\tfrac12`}</Tex>（勘誤 E41）
          </>
        }
        level={2}
        id="ch01-s13"
      >
        <p>
          規格 §1 的成本 <Tex>{'J_2'}</Tex> 沒有 <Tex>{String.raw`\tfrac12`}</Tex>，但 §1.1 的單筆成本 <Tex>{String.raw`j_n=\tfrac12e_n^2`}</Tex> 有 <Tex>{String.raw`\tfrac12`}</Tex>。兩者梯度差 2 倍
          <ChapterErratum id="E41" />。本站統一採用
        </p>
        <TexBlock
          id="F-01.2"
          label={
            <>
              本站的 MSE 成本（argmin 與 <Tex>{'J_2'}</Tex> 相同）
            </>
          }
        >
          {String.raw`J(w)=\tfrac12E\big[(y-wx)^2\big]=\tfrac12J_2(w)`}
        </TexBlock>
        <p>
          為什麼要在意這個 <Tex>{String.raw`\tfrac12`}</Tex>？LMS 是「沿著成本的斜率往下走一步」（gradient descent）：算出單筆成本對 <Tex>{'w'}</Tex> 的斜率，往反方向走{' '}
          <Tex>{'\\mu'}</Tex> 倍。成本前面有沒有 <Tex>{String.raw`\tfrac12`}</Tex>，斜率就差 2 倍，走出來的步伐也差 2 倍：
        </p>
        <BlockDiagram id="D-01.8">
          每一列由左到右都是同樣四格：單筆成本 → 對 <Tex>{'w'}</Tex> 微分 → 乘上負的步長 → 更新量 <Tex>{String.raw`\Delta w`}</Tex>。先比第一列和第二列：成本差 2 倍、步長也差 2 倍，互相抵消，更新量都是 <Tex>{String.raw`\mu e x`}</Tex>（綠色）。再看第三列：成本沒有 <Tex>{String.raw`\tfrac12`}</Tex>、步長卻沒有減半，更新量變成{' '}
          <Tex>{String.raw`2\mu ex`}</Tex>（紅色）。圖上第一列的 <Tex>{String.raw`\tfrac12e^2`}</Tex> 就是下面推導的單筆成本 <Tex>{String.raw`j_n=\tfrac12e_n^2`}</Tex>，最後一格就是 F-01.7 的 <Tex>{String.raw`\mu e_nx_n`}</Tex>。
        </BlockDiagram>
        {atLeast('engineer') ? half : <Derivation title={String.raw`由 $j_n=\tfrac12e_n^2$ 推出 LMS`} derivation={half} level="L0" claim="exact" />}
        <TexBlock id="F-01.7" label="LMS 更新式（規格 §1.1）">
          {String.raw`\boxed{w_{n+1}=w_n+\mu\,e_nx_n}`}
        </TexBlock>
        <p>
          單筆的更新量 <Tex>{String.raw`\Delta w=\mu ex`}</Tex> 會被雜訊推來推去，但把很多筆平均起來，方向非常清楚：永遠朝著 <Tex>{'w^*'}</Tex>，而且離得越遠推得越用力。畫成方塊圖，就是一個一階的負回授迴路：
        </p>
        <BlockDiagram id="D-01.9">
          先看左邊的加法點：目標 <Tex>{'w^*'}</Tex> 進「＋」、目前的 <Tex>{'w'}</Tex> 進「−」，出來的是還差多遠 <Tex>{'w^*-w'}</Tex>。再看藍色方塊：乘上{' '}
          <Tex>{String.raw`\mu E[x^2]`}</Tex> 就是這一步的平均更新量，加回 <Tex>{'w'}</Tex>、存進暫存器（<Tex>{'z^{-1}'}</Tex> 表示延遲一筆），下一筆再繞一圈。圖上「平均更新量」那一格就是下面推導的結果{' '}
          <Tex>{String.raw`E[\Delta w]=\mu E[x^2](w^*-w)`}</Tex>；迴路增益 <Tex>{String.raw`\mu E[x^2]`}</Tex> 越大收斂越快，太大則會衝過頭（下表的收斂條件）。
        </BlockDiagram>
        {atLeast('engineer') ? meanUpdate : <Derivation title="平均更新量指向 $w^*$（逐步）" derivation={meanUpdate} level="L0" claim="exact" />}
        <p className="small">
          <ClaimTag kind="exact" /> 這就是 §1.2.1 的 normal equation 的動態版本：<Tex>{'E[ex]'}</Tex> 不為 0 就繼續修正，修正方向總是朝{' '}
          <Tex>{'w^*'}</Tex>；到了 <Tex>{'w=w^*'}</Tex> 平均更新量才歸零。單筆更新還會被雜訊推來推去，要平均很多筆（誤差以{' '}
          <Tex>{String.raw`1/\sqrt N`}</Tex> 下降）才看得出這個方向——PLL 的 GMAC 累加器做的正是這件事。
        </p>
        <p>
          把圖 1-8 的三種寫法整理成表。表中 <Tex>{'P_x=E[x^2]'}</Tex> 是輸入功率（輸入平方的平均），也就是成本拋物線 <Tex>{'J'}</Tex> 的曲率；「曲率」那一欄決定步長可以多大：
        </p>
        <div className="table-wrap">
          <table className="ch01-table">
            <thead>
              <tr>
                <th>你對誰做 gradient descent</th>
                <th>單步更新</th>
                <th>曲率（Hessian）</th>
                <th>平均收斂條件</th>
                <th>和 LMS 一樣嗎？</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Tex>{String.raw`J=\tfrac12J_2`}</Tex>，步長 <Tex>{'\\mu'}</Tex>
                </td>
                <td>
                  <Tex>{String.raw`\mu e x`}</Tex>
                </td>
                <td>
                  <Tex>{'P_x'}</Tex>
                </td>
                <td>
                  <Tex>{String.raw`0<\mu<2/P_x`}</Tex>
                </td>
                <td>✓（本站）</td>
              </tr>
              <tr>
                <td>
                  <Tex>{'J_2'}</Tex>，步長 <Tex>{'\\mu/2'}</Tex>
                </td>
                <td>
                  <Tex>{String.raw`\tfrac{\mu}{2}\cdot2ex=\mu ex`}</Tex>
                </td>
                <td>
                  <Tex>{'2P_x'}</Tex>
                </td>
                <td>
                  <Tex>{String.raw`0<\mu<2/P_x`}</Tex>
                </td>
                <td>✓（等價寫法）</td>
              </tr>
              <tr>
                <td>
                  <Tex>{'J_2'}</Tex>，步長 <Tex>{'\\mu'}</Tex>
                </td>
                <td>
                  <Tex>{String.raw`2\mu ex`}</Tex>
                </td>
                <td>
                  <Tex>{'2P_x'}</Tex>
                </td>
                <td>
                  <Tex>{String.raw`0<\mu<1/P_x`}</Tex>
                </td>
                <td>✗ 步長大 2 倍；用這個界去設計 LMS 會白白砍掉一半範圍</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ModeGate min="engineer">
          <StepDerivation
            title="為什麼曲率決定步長上限（確定性 GD）"
            steps={[
              {
                tex: String.raw`w_{k+1}=w_k-\mu\,J'(w_k)`,
                why: (
                  <>
                    對 <Tex>{'J'}</Tex> 做 gradient descent（用真正的平均梯度，不是單筆樣本）
                  </>
                ),
              },
              {
                tex: String.raw`J'(w)=E[x^2]\,(w-w^*)=P_x\,(w-w^*)`,
                why: (
                  <>
                    對 F-01.6 微分：<Tex>{String.raw`\tfrac{d}{dw}\tfrac12P_x(w-w^*)^2=P_x(w-w^*)`}</Tex>
                  </>
                ),
              },
              {
                tex: String.raw`w_{k+1}-w^*=(1-\mu P_x)\,(w_k-w^*)`,
                why: (
                  <>
                    兩邊減 <Tex>{'w^*'}</Tex>、整理（<Tex>{'k'}</Tex> 是 GD 的迭代次數）
                  </>
                ),
              },
              {
                tex: String.raw`|1-\mu P_x|<1\iff 0<\mu<\frac{2}{P_x}`,
                why: (
                  <>
                    每步乘上 <Tex>{String.raw`1-\mu P_x`}</Tex>，絕對值小於 1 才會縮小（等比數列）
                  </>
                ),
              },
            ]}
          />
          <p className="small">
            若誤把 <Tex>{'J_2'}</Tex> 的曲率 <Tex>{'2P_x'}</Tex> 當成 LMS 的曲率，會得到 <Tex>{String.raw`0<\mu<1/P_x`}</Tex>——例如 <Tex>{'x=2'}</Tex> 時算出 <Tex>{String.raw`1/x^2=0.25`}</Tex>，但實際 LMS 在 <Tex>{String.raw`\mu=0.4`}</Tex>{' '}
            仍收斂（<Tex>{String.raw`p=1-0.4\cdot4=-0.6`}</Tex>，下一節的實驗可以驗證）。
          </p>
        </ModeGate>
        <ChapterHandCalc id="HC-01.3">
          親手把上表的三列各走一步：同一筆資料、同一個 <Tex>{'\\mu'}</Tex>，有沒有那個 <Tex>{String.raw`\tfrac12`}</Tex>{' '}
          差在哪裡？預設是 <Tex>{String.raw`x=2,\ \mu=0.4`}</Tex>（介於 <Tex>{'1/x^2'}</Tex> 與 <Tex>{'2/x^2'}</Tex> 之間）。
        </ChapterHandCalc>
        <p>
          <ClaimTag kind="exact" /> LMS 是用<strong>單筆隨機梯度</strong> <Tex>{String.raw`-e_nx_n`}</Tex> 近似平均成本{' '}
          <Tex>{'J'}</Tex> 的梯度，每一步都不是「直接解出全資料最佳解」。單筆梯度的期望值等於真正的梯度（無偏），所以平均而言往下坡走；但每一步都帶著雜訊，這是之後 <ChRef ch="03">Ch03</ChRef>（mean vs mean-square）與 <ChRef ch="12">Ch12</ChRef>（係數雜訊）的源頭。
        </p>
      </Section>
    </>
  )
}
