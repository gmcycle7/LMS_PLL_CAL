import { useMemo } from 'react'
import { Callout, ModeGate, Section, Tex, ChapterErratum } from '@/components'
import { lyapunovExponent, stabilityFactors } from '@/simulation/models/scalarStability'
import { Fig, T, tnum } from '../common'
import { CHART_MC_COMPARE, CHART_MC_FLOW } from '../diagrams'
import { StabilityLab } from '../experiments/StabilityLab'

export function LabSection() {
  // 說明文字中的解析數字（即時計算；MC 比例則註明 seed）
  const v = useMemo(() => {
    const G = { kind: 'gaussian', sigma: 1 } as const
    return { g08: stabilityFactors(0.8, G).g, l23: lyapunovExponent(2.3, G), l26: lyapunovExponent(2.6, G) }
  }, [])
  return (
    <>
      <h2 id="lab">6｜綜合實驗：Stability Lab</h2>
      <Section id="ch03-three-convergence" kind="explore" title="三種收斂畫在同一張圖">
        <p>
          主圖的縱軸是 <Tex>{T`\log_{10}`}</Tex>，所以等比數列變成直線，斜率就是每步的對數縮放率：解析 MSD 的斜率是 <Tex>{T`\tfrac12\log_{10}g`}</Tex>、mean 是{' '}
          <Tex>{T`\log_{10}|1-\mu P_x|`}</Tex>、典型路徑是 <Tex>{T`\lambda/\ln10`}</Tex>。Monte Carlo 在 Web Worker 中執行，每條路徑有自己的亂數串流，同一個 seed 完全可重現。下面的「試試看」都有對應的 preset（實驗外框的 preset 下拉選單）。
        </p>
        <Fig
          chart={CHART_MC_FLOW}
          caption={T`Stability Lab 的 Monte Carlo 流程。看藍色的主幹（每一步在 log 域累加、記錄 $\log_{10}|\delta_n|$）與最下面的三個輸出：綠色兩個可信，紅色的天真平均只用來示範它會偏低。`}
          ariaLabel="一個 seed 分出 M 條路徑，每條抽 x、在 log 域走 N 步並記錄 log10 delta；每個時間點取 10%、50%、90% 分位數與收斂比例，另外直接平均 delta 平方"
        />
        <p>
          由上往下看：一個 seed 分出 <Tex>M</Tex> 條路徑（程式裡的變數叫 <code>paths</code>），每條路徑各自抽 <Tex>{T`x[n]`}</Tex>、走 <Tex>N</Tex> 步（<Tex>N</Tex> 是每條路徑的步數），並記下{' '}
          <Tex>{T`\log_{10}|\delta[n]|`}</Tex>。「走一步」那一格就是第 4 節的累加器：無雜訊時在 log 域每步加上 <Tex>{T`\ln|1-\mu x[n]^2|`}</Tex>，所以 <Tex>{T`10^{-300}`}</Tex> 以下的數也不會 underflow。最下面三個輸出：每個時間點把 <Tex>M</Tex> 條路徑排序，取 10%／50%／90% 分位數（主圖的色帶與中位數線）；低於 <Tex>{T`10^{-3}|\delta_0|`}</Tex> 的路徑比例（「收斂比例」圖）；以及直接平均{' '}
          <Tex>{T`\delta[n]^2`}</Tex> 的「天真 MC」。
        </p>
        <Fig
          chart={CHART_MC_COMPARE}
          caption={T`量到的（左，藍）對上不靠這批路徑的預測（右，綠）。前四列對得上才算驗證；最後一列（紅）在 heavy tail 時對不上，正是第 5 節的重點。`}
          ariaLabel="五組比對：MC 中位數對典型路徑 n lambda；MC 10% 與 90% 分位帶對 CLT 預測的分位；MC 收斂比例對 CLT 預測的比例；單步 MC 的樣本平均對封閉式或數值積分；天真 MC 對解析 MSD，heavy tail 時對不上"
        />
        <p>
          每一列是一組比對：左邊是 Monte Carlo 量到的量，右邊是<strong>不靠這批路徑</strong>算出來的預測，線上的字是判定標準。先看前三列：中位數對典型路徑 <Tex>{T`n\lambda`}</Tex>、分位帶對 CLT 的{' '}
          <Tex>{T`n\lambda\mp1.2816\,s\sqrt n`}</Tex>、收斂比例對 <Tex>{T`\Phi(z)`}</Tex>（圖上寫的是 <Tex>{T`\ln`}</Tex> 域的量；主圖的縱軸再除以 <Tex>{T`\ln10`}</Tex> 換成{' '}
          <Tex>{T`\log_{10}`}</Tex>）。再看第四列：單步 MC 只平均一步的 <Tex>f</Tex>、<Tex>{T`f^2`}</Tex>、<Tex>{T`\ln|f|`}</Tex>，和封閉式的 <Tex>{T`1-\mu P_x`}</Tex>、<Tex>g</Tex>、<Tex>\lambda</Tex> 相差要在{' '}
          <Tex>{T`\pm4`}</Tex> 個標準誤（SE）以內。最後一列是反面教材：天真平均在 heavy tail 時遠低於解析的 <Tex>{T`g^n\delta_0^2`}</Tex>。
        </p>
        <ul>
          <li>
            <Tex>{T`\mu=0.5`}</Tex>（Gaussian）：三條解析線都往下，MC 分位帶沿著典型路徑線——全部收斂。
          </li>
          <li>
            <Tex>{T`\mu=0.8`}</Tex>（預設）：「解析 <Tex>{T`\tfrac12\log_{10}E[\delta_n^2]`}</Tex>」那條線往上（<Tex>{T`g=${tnum(v.g08, 4)}`}</Tex>），但「MC 分位帶」往下掉到{' '}
            <Tex>{T`10^{-40}`}</Tex> 附近；「天真 MC」（直接平均樣本 <Tex>{T`\delta^2`}</Tex>）介於兩者之間，誤導性最強。
            <ChapterErratum id="E14" />
          </li>
          <li>
            <Tex>{T`\mu=2.3`}</Tex>：連 mean 都發散（<Tex>{T`1-\mu P_x=-1.3`}</Tex>），但 <Tex>{T`\lambda<0`}</Tex>，路徑仍會收斂——只是非常慢：
            <Tex>{T`\lambda=${tnum(v.l23, 3)}`}</Tex>，<Tex>{T`N=200`}</Tex> 時大約只有一半路徑低於 <Tex>{T`10^{-3}|\delta_0|`}</Tex>，preset 用{' '}
            <Tex>{T`N=1000`}</Tex> 時約四分之三（seed 20261010 的 MC），<Tex>N</Tex> 越大比例越接近 1。看「收斂比例」圖。
          </li>
          <li>
            <Tex>{T`\mu=2.6`}</Tex>：<Tex>{T`\lambda=${tnum(v.l26, 3)}>0`}</Tex>，典型路徑也發散。
          </li>
          <li>
            分布改 <Tex>{T`\pm1`}</Tex>：三條線與分位帶完全重合（<Tex>{T`|x|`}</Tex> 常數，每條路徑都一樣）；改清單 <Tex>{T`\{0\times9,\ 3\}`}</Tex>、<Tex>{T`\mu=0.5`}</Tex>：mean
            收斂、路徑發散。
          </li>
          <li>
            開啟 <Tex>{T`\sigma_v=0.1`}</Tex>：<Tex>{T`\mu=0.3`}</Tex> 時分位帶停在穩態 <Tex>{T`\sqrt{\text{MSD}_\infty}`}</Tex> 附近；<Tex>{T`\mu=0.8`}</Tex> 時穩態 MSD
            無限大，但分位帶仍是有限的——heavy-tail 穩態（Research 模式看 Kesten 尾指數）。
          </li>
          <li>按「＋」新增 Case B / C，用同一個 seed 並排比較不同 <Tex>\mu</Tex> 或不同分布。</li>
          <li>
            對照第 5 節的 CLT 預測（F-03.18）：主圖兩條灰色細點線（<Tex>{T`n\lambda\pm1.2816\,s\sqrt n`}</Tex>）應該貼著藍色 10–90% 分位帶的上下緣；「收斂比例」圖的虛線是{' '}
            <Tex>{T`\Phi\big((\ln10^{-3}-n\lambda)/(s\sqrt n)\big)`}</Tex>。把 <Tex>\mu</Tex> 設成 2、<Tex>{T`N=200`}</Tex>，指標表的 MC 收斂比例與 CLT 預測都在 83% 附近（勘誤 E14 的數字）。
          </li>
          <li>
            工具列：<strong>執行 Run</strong> 以目前參數重跑；<strong>凍結 Freeze</strong> 讓你連續改好幾個參數而不必每改一次就重跑 Monte Carlo；
            <strong>執行至收斂</strong> 會依 <Tex>\lambda</Tex> 把步數設成典型路徑降到 <Tex>{T`10^{-3}|\delta_0|`}</Tex> 所需步數的 2 倍（<Tex>{T`\lambda\ge0`}</Tex> 時會說明為什麼做不到）。
          </li>
        </ul>
        <StabilityLab />
        <ModeGate min="research">
          <Callout kind="info" title="Research：Monte Carlo 細節">
            <ul>
              <li>
                無雜訊時每條路徑在 log 域累加 <Tex>{T`\ln|1-\mu x^2|`}</Tex>，所以 <Tex>{T`10^{-300}`}</Tex> 以下與 <Tex>{T`10^{+300}`}</Tex> 以上都能正確排序；有雜訊時改在線性域，overflow 的路徑記為 <Tex>{T`+\infty`}</Tex>（仍計入分位數）。
              </li>
              <li>
                分位數以 NumPy「linear」內插；記錄點最多 401 個（路徑很多時自動減少，使記錄矩陣 <Tex>{T`\le4\times10^6`}</Tex> 格），以 Float32 儲存{' '}
                <Tex>{T`\log_{10}|\delta_n|`}</Tex>：相對誤差 <Tex>{T`2^{-24}\approx6\times10^{-8}`}</Tex>，即使 <Tex>{T`|\log_{10}|\delta||=300`}</Tex> 也只差約{' '}
                <Tex>{T`2\times10^{-5}`}</Tex> decade。
              </li>
              <li>
                樣本 Lyapunov 指數 <Tex>{T`\hat\lambda=\overline{\ln|\delta_N/\delta_0|}/N`}</Tex> 的變異數有限，<Tex>{T`\pm4`}</Tex> SE 與解析值比對是可信的；
                <Tex>{T`\delta^2`}</Tex> 的樣本平均則不是（第 5 節）。
              </li>
              <li>
                Hill estimator 取最大 2% 的 <Tex>{T`|\delta_N|`}</Tex>：<Tex>{T`\hat\kappa_t=k\big/\sum_{i\le k}\ln\big(|\delta|_{(i)}/|\delta|_{(k+1)}\big)`}</Tex>。它對路徑數、
                <Tex>k</Tex> 的選擇與是否已達穩態都很敏感，只標 [近似]（seed 不同時可差 10% 左右）。
              </li>
            </ul>
          </Callout>
        </ModeGate>
      </Section>
    </>
  )
}
