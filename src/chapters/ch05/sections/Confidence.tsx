import { useMemo } from 'react'
import { ClaimTag, Prereq, SourceTag, Tex, TexBlock } from '@/components'
import { normCdf, normInv, wilsonCI } from '@/simulation/core'
import { binomialAcceptance, directionOutcomeExact, pPlus } from '@/simulation/models/comparator'
import { Steps, fx, texInt, texNum } from '../common'

/** 先備知識：Monte Carlo 判對率的信賴區間（Wilson score interval），放在 Comparator Lab 之前。 */
export function ConfidencePrereq() {
  const ex = useMemo(() => {
    const T = 4000
    const k = 3150
    const z = normInv(0.975)
    const ph = k / T
    const wald = z * Math.sqrt((ph * (1 - ph)) / T)
    const w = wilsonCI(k, T, 0.95)
    const small = wilsonCI(0, 20, 0.95)
    // 交叉比對用的接受域：一般情形（P ≈ 0.79）與稀有事件（飽和 preset：s = 60 fs、N = 101）
    const accMid = binomialAcceptance(T, ph)
    const sdMid = Math.sqrt(T * ph * (1 - ph))
    const pSat = directionOutcomeExact(pPlus(60, 100), 101, 'half').correct
    const accSat = binomialAcceptance(T, pSat)
    const sdSat = Math.sqrt(T * pSat * (1 - pSat))
    return { T, k, z, ph, wald, w, small, accMid, sdMid, pSat, accSat, sdSat, tail: normCdf(-4), zOne: 1 / sdSat, pOne: T * (1 - pSat) }
  }, [])
  return (
    <Prereq title="信賴區間：Monte Carlo 的判對率要怎麼附上誤差棒（Wilson score interval）">
      <p>
        Monte Carlo 做了 <Tex>{'T'}</Tex> 次獨立的 trial，其中 <Tex>{'k'}</Tex> 次判對，估計值 <Tex>{'\\hat P=k/T'}</Tex>。每次 trial 是一個「成功機率{' '}
        <Tex>{'P'}</Tex>」的 Bernoulli，
        所以 <Tex>{'k\\sim\\mathrm{Bin}(T,P)'}</Tex>、<Tex>{'\\operatorname{Var}(\\hat P)=P(1-P)/T'}</Tex>（§3 的同一套數學）。
      </p>
      <Steps
        title={
          <>
            從 <Tex>{String.raw`|\hat P-P|\le z\cdot\mathrm{SD}`}</Tex> 解出 <Tex>{'P'}</Tex> 的範圍
          </>
        }
        steps={[
          { tex: String.raw`\big(\hat P-P\big)^2\le z^2\,\frac{P(1-P)}{T}`, why: <>CLT：<Tex>{'\\hat P'}</Tex> 近似 Gaussian；用<strong>真實</strong> <Tex>{'P'}</Tex> 的變異數（Wilson 的關鍵），<Tex>{`z=${fx(ex.z, 2)}`}</Tex> 對應 95%。</> },
          { tex: String.raw`\hat P^2-2\hat PP+P^2\le\frac{z^2}{T}\big(P-P^2\big)`, why: '展開左邊的平方。' },
          { tex: String.raw`\Big(1+\frac{z^2}{T}\Big)P^2-\Big(2\hat P+\frac{z^2}{T}\Big)P+\hat P^2\le0`, why: <>整理成 <Tex>{'P'}</Tex> 的二次不等式：開口向上，所以 <Tex>{'P'}</Tex> 必須落在兩根之間。</> },
          { tex: String.raw`P=\frac{\hat P+\frac{z^2}{2T}\pm z\sqrt{\frac{\hat P(1-\hat P)}{T}+\frac{z^2}{4T^2}}}{1+\frac{z^2}{T}}`, why: '一元二次公式求根（判別式化簡後除以 2 的係數）。' },
        ]}
      />
      <TexBlock id="F-05.14" label={<>Wilson 區間 <ClaimTag kind="approx" />（<Tex>{'T'}</Tex> 有限時的覆蓋率接近、但不保證等於標稱值）</>}>
        {String.raw`P\in\frac{\hat P+\frac{z^2}{2T}\pm z\sqrt{\frac{\hat P(1-\hat P)}{T}+\frac{z^2}{4T^2}}}{1+\frac{z^2}{T}}`}
      </TexBlock>
      <p>
        例（數字為示意 <SourceTag kind="illustrative" />）：<Tex>{`T=${ex.T},\\;k=${ex.k}\\;\\Rightarrow\\;\\hat P=${fx(ex.ph, 4)}`}</Tex>，95% Wilson 區間 <Tex>{`[${fx(ex.w.lo, 4)},\\,${fx(ex.w.hi, 4)}]`}</Tex>；
        常見的 Wald 區間 <Tex>{`\\hat P\\pm z\\sqrt{\\hat P(1-\\hat P)/T}=\\hat P\\pm${fx(ex.wald, 4)}`}</Tex> 在這裡幾乎一樣。差別出現在{' '}
        <Tex>{'\\hat P'}</Tex> 接近 0 或 1、或 <Tex>{'T'}</Tex> 小時：
        <Tex>{'k=0,\\;T=20'}</Tex> 時 Wald 區間寬度為 0（荒謬），Wilson 給 <Tex>{`[0,\\,${fx(ex.small.hi, 3)}]`}</Tex>。實驗中「<Tex>{'P(\\text{判對})'}</Tex> vs{' '}
        <Tex>{'N'}</Tex>」的誤差棒與 KPI 都用 Wilson。
      </p>
      <p>
        <strong>實驗怎麼判定「Monte Carlo 與解析一致」？</strong>反過來問：若解析值 <Tex>{'P'}</Tex> 是對的，判對次數 <Tex>{'k\\sim\\mathrm{Bin}(T,P)'}</Tex>{' '}
        會落在哪裡？本站用精確 Binomial 的尾機率找出接受域 <Tex>{'[k_{\\mathrm{lo}},k_{\\mathrm{hi}}]'}</Tex>，使{' '}
        <Tex>{`P(k<k_{\\mathrm{lo}})<\\Phi(-4)`}</Tex> 且 <Tex>{`P(k>k_{\\mathrm{hi}})<\\Phi(-4)=${texNum(ex.tail, 3)}`}</Tex>（每一側都是「4 個標準差」的尾機率）。
        MC 的計數落在裡面就標 <code>ok</code>，否則標 <code>mismatch</code>。
      </p>
      <ul>
        <li>
          一般情形 <Tex>{`T=${ex.T},\\ P=${fx(ex.ph, 4)}`}</Tex>：接受域 <Tex>{`[${ex.accMid.kLo},\\,${ex.accMid.kHi}]`}</Tex>，和{' '}
          <Tex>{`TP\\pm4\\,\\mathrm{SD}=${texInt(ex.T * ex.ph)}\\pm${fx(4 * ex.sdMid, 1)}`}</Tex> 幾乎一樣。
        </li>
        <li>
          稀有事件（飽和 preset：<Tex>{`P(\\text{判錯})=${texNum(1 - ex.pSat, 2)}`}</Tex>）：<Tex>{`\\mathrm{SD}=${fx(ex.sdSat, 3)}`}</Tex> 次，常態近似完全失效——只要剛好出現 1 次判錯
          （機率約 <Tex>{`T(1-P)=${fx(100 * ex.pOne, 2)}\\%`}</Tex>，並不罕見），「<Tex>{'\\pm4\\,\\mathrm{SD}'}</Tex>」就會把它算成{' '}
          <Tex>{`${fx(ex.zOne, 0)}\\sigma`}</Tex> 的異常。精確接受域是 <Tex>{`[${ex.accSat.kLo},\\,${ex.accSat.kHi}]`}</Tex>：0 或 1 次判錯都算一致。
          <ClaimTag kind="exact" />
        </li>
      </ul>
    </Prereq>
  )
}
