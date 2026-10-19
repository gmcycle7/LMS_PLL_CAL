import { useMemo, type ReactNode } from 'react'
import { Callout, ClaimTag, Section, SourceTag, StepDerivation, SystemMap, Tex, TexBlock, ChRef } from '@/components'
import { lutApproxRms, uniformResidualAfterGain } from '@/simulation/models/dtcInl'
import { num, signed, m, texNum } from '../common'
import { SYSTEM_MAP_FOCUS } from '../diagrams'
import { F } from '../formulas'
import { Fig, FigRef } from '../Fig'

const D2 = 20

/**
 * §11b 開場：問題、系統地圖、為什麼 gain 校正不夠、INL 模型與 F-11B.1／F-11B.2。
 * @param afterMap 接在系統地圖的「你在這裡」之後的內容（index.tsx 把標籤列放在這裡；PageFrame 的章首骨架也插在地圖之後）
 */
export function IntroSection({ afterMap }: { afterMap?: ReactNode } = {}) {
  const t = useMemo(() => {
    const xs = [-1, -0.5, 0, 0.5, 1]
    const sigma2 = 1 / 3
    const rows = xs.map((x) => ({ x, d: D2 * x * x, r: D2 * (x * x - sigma2) }))
    const u = uniformResidualAfterGain({ d2: D2, d3: 0 })
    return { rows, rms: u.rms, floor8: lutApproxRms({ d2: D2, d3: 0 }, 8), floor64: lutApproxRms({ d2: D2, d3: 0 }, 64) }
  }, [])

  return (
    <>
      <Callout kind="info" title="這一課要回答的問題">
        <p className="ch11b-lead">
          <ChRef ch="11">Ch11</ChRef> 證明了：gain 校正收斂之後，GMAC 歸零，但每個 code 的誤差並沒有歸零——DTC 的 INL <Tex>{'d(x)'}</Tex> 還留在 PD 的輸出裡。那這些殘差會造成什麼後果？要怎麼把它們校掉？
        </p>
        <p>
          答案分兩半。後果：殘差 <Tex>{'d(x[n])'}</Tex> 是 code 的<strong>非線性</strong>函數，它會把 MASH 整形到高頻的量化雜訊<strong>折回帶內</strong>（noise folding），變成輸出 jitter——這一段推導全站之前沒有。校正：只要給 LMS 更多 regressor（分段 one-hot、LUT one-hot、多項式冪次），同一套{' '}
          <ChRef ch="09">Ch09</ChRef>–<ChRef ch="10">Ch10</ChRef> 的多參數理論就告訴你每一種結構的收斂速度、穩態抖動、硬體成本，以及什麼時候學不到（gauge、缺乏樣本）。
        </p>
        <p className="small">
          先認識本章新出現的符號（完整符號表在本章最後）：<Tex>{'x\\in[-1,1]'}</Tex> 是<strong>正規化</strong>的 DTC code（MASH 的餘數 <Tex>{'r'}</Tex> 除以 2），無因次；<Tex>{'d(x)'}</Tex> 是 DTC 的 INL——這個 code 比直線多出來的延遲（t.u.，例如 fs）；<Tex>{'c(x)=\\sum_i\\theta_i\\varphi_i(x)'}</Tex> 是 INL 校正加上去的補償量，<Tex>{'\\theta_i'}</Tex> 是要學的參數、<Tex>{'\\varphi_i(x)'}</Tex> 是對應的 regressor；<Tex>{'R_x[m]'}</Tex> 是 code 的自相關、<Tex>{'S_x(\\nu)'}</Tex> 是它的 PSD（<Tex>{'\\nu=f/f_s'}</Tex>）。
        </p>
      </Callout>
      <SystemMap focus={SYSTEM_MAP_FOCUS} />
      <p className="c-map-note">
        <strong>你在這裡：</strong>藍色是這一課的主角：INL 住在 DTC 裡；折返的雜訊來自 DSM 的餘數（code 的頻譜）；校正迴路仍然是 comparator → GMAC → accumulator，只是 GMAC 與 accumulator 從一個變成一排（每個 regressor 一個）。PD 的輸出 <Tex>{'e[n]'}</Tex> 還是 comparator 唯一的輸入（<ChRef ch="04">Ch04</ChRef> 的訊號流不變）。
      </p>
      {afterMap}

      <Section kind="intuition" title="直覺：一條直線貼不住的曲線，貼完還剩什麼" level={2} id="ch11b-intuition">
        <p>
          <ChRef ch="11">Ch11</ChRef> §11.2 的結論是 gain 校正會停在 <Tex>{'w^*=a+d_3E[x^4]/E[x^2]'}</Tex>（F-11.8），而且每個 code 都還剩殘差。本章從這裡接下去：把殘差寫成「<Tex>{'d(x)'}</Tex> 減掉它的最佳直線」。先用最簡單的二次 INL <Tex>{'d(x)=d_2x^2'}</Tex>、uniform 的 code 算一次（<Tex>{`d_2=${D2}`}</Tex> t.u.，illustrative）：
        </p>
        <div className="table-wrap">
          <table className="ch11b-table">
            <thead>
              <tr>
                <th>
                  code <Tex>{'x'}</Tex>
                </th>
                <th>
                  INL <Tex>{'d(x)=d_2x^2'}</Tex>
                </th>
                <th>
                  gain 校正後的殘餘 <Tex>{'d_2(x^2-\\tfrac13)'}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.x}>
                  <td className="num">{num(r.x, 3)}</td>
                  <td className="num">{num(r.d, 4)}</td>
                  <td className="num">{signed(r.r, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          二次 INL 是偶函數，和 <Tex>{'x'}</Tex> 正交：gain 校正對它<strong>完全沒有作用</strong>（<Tex>{'w^*=a'}</Tex>），只有它的平均 <Tex>{'d_2E[x^2]=d_2/3'}</Tex> 被主迴路當成靜態相位吸收掉。剩下的殘餘 rms 是{' '}
          <Tex>{String.raw`\sqrt{E[r^2]}=\sqrt{4d_2^2/45}=${texNum(t.rms, 4)}`}</Tex> t.u.——跟 INL 本身同一個量級。三次 INL 稍好一點：它的線性部分 <Tex>{'\\tfrac35d_3x'}</Tex>（uniform）被 gain 吸收，剩下 <Tex>{'d_3(x^3-\\tfrac35x)'}</Tex>。
        </p>
        <p>
          那如果不是一條直線，而是 8 段各自的直線（分段）、64 格各自的常數（LUT）、或一條三次曲線（多項式）呢？同一個 <Tex>{`d_2=${D2}`}</Tex>：LUT 8 格的近似誤差只剩 <Tex>{texNum(t.floor8, 4)}</Tex>，64 格剩 <Tex>{texNum(t.floor64, 4)}</Tex>（F-11B.13），三次多項式則是 0（<Tex>{'d'}</Tex> 本來就是多項式）。這就是本章的三種結構——它們各要付多少代價（收斂時間、穩態抖動、乘法器與記憶體）、什麼時候學不到，是 §11b.3 與 §11b.4 的事。
        </p>
        <p>
          但在那之前，§11b.2 先回答「為什麼非校不可」：<Tex>{'d(x[n])'}</Tex> 不只是一個確定性的 spur pattern（<ChRef ch="11">Ch11</ChRef> 的說法），它還會把本來被 MASH 推到高頻的量化雜訊<strong>乘</strong>回帶內。
        </p>
        <p className="small muted">
          <ClaimTag kind="exact" /> {m('上表與 $\\sqrt{4d_2^2/45}$ 在「uniform $x$、$d=d_2x^2$」的指定模型中可代數驗證（HC-11B.5 的第一步）。')} <SourceTag kind="illustrative" />
        </p>
      </Section>

      <Section kind="diagram" title="11b.1 INL 校正的模型：補償量從 $T_0$ 往回扣" level={2} id="ch11b-model">
        <p>
          先看 <FigRef id="inl-model" /> 的 DTC 方塊。全站的接法（<ChRef ch="04">Ch04</ChRef>、docs/assumptions.md §2a）：reference 端的 DTC 只能延遲，從固定的基準延遲 <Tex>{'T_0'}</Tex> 往回扣。Ch11 扣的是 gain 的補償量 <Tex>{'w\\,x'}</Tex>；本章再扣一個 INL 的補償量 <Tex>{'c(x)'}</Tex>。DTC 自己多出來的延遲 <Tex>{'d(x)'}</Tex>（INL，多延遲為正）加在上面。再看下半：PD 量「DTC 延遲後的 reference edge 減 feedback edge」，comparator 取 PD 的輸出；新的東西是 regressor 產生器——它把一個 <Tex>{'x'}</Tex> 變成一個向量 <Tex>{'\\boldsymbol\\psi'}</Tex>，GMAC 也跟著變成一排。
        </p>
        <Fig id="inl-model" />
        <StepDerivation
          title={m('從 DTC 的延遲到 PD 的輸出（每一步都是代入）')}
          steps={[
            { tex: String.raw`\tau_\mathrm{DTC}[n]=T_0-w\,x[n]-c(x[n])+d(x[n])`, why: m('DTC 的延遲：基準 $T_0$ 減掉兩個補償量，加上 INL（這個 code 多出來的延遲）。') },
            { tex: String.raw`t_\mathrm{ref}'[n]=\tau_\mathrm{DTC}[n],\qquad t_\mathrm{fb}[n]=-a\,x[n]`, why: m('reference edge 到達 PD 的時間就是 DTC 的延遲（以理想 reference 時刻為 0）；feedback（divider）edge 早到 $a\\,x$（$a$ 是真實的 DTC gain，Ch11）。') },
            { tex: String.raw`e[n]=t_\mathrm{ref}'[n]-t_\mathrm{fb}[n]=T_0+(a-w)\,x[n]+d(x[n])-c(x[n])`, why: m('PD 是減法點。常數 $T_0$ 只讓鎖定相位整個平移，主 PLL 把它吸收掉，不算進誤差。') },
            { tex: String.raw`e[n]=(a-w)\,x[n]+b+d(x[n])-c(x[n])+v[n]`, why: m('加上 PD／comparator 的 offset $b$ 與雜訊 $v$（和 Ch11 F-11.1 同一個模型；$\\varepsilon_{cc}$ 這裡先略去）。') },
            { tex: String.raw`c(x)=\sum_{i=1}^{P}\theta_i\,\varphi_i(x)\quad\Rightarrow\quad e[n]=\big[(a-w)x+b+d(x)\big]-\boldsymbol\theta^T\boldsymbol\varphi(x)+v`, why: m('補償量寫成參數 × regressor 的線性組合：校正的目標是讓 $\\boldsymbol\\theta^T\\boldsymbol\\varphi(x)$ 貼住方括號裡的東西。這是 Ch09 的多參數誤差模型（F-09.1），只是 regressor 換成 $\\varphi_i(x)$。') },
          ]}
        />
        <TexBlock id="F-11B.1" label={m('INL 校正的誤差模型')}>
          {F.errorModel}
        </TexBlock>
        <p className="ch11b-tags">
          <ClaimTag kind="exact" /> {m('靜態誤差路徑、$v$ 與 $x$ 獨立；PLL 的動態（$H_\\mathrm{PD}$）像 Ch11 一樣先吸收進誤差路徑。')}
        </p>
        <p>
          「gain 校正後剩下什麼」可以精確地寫出來。把 <Tex>{'d(x)=d_2x^2+d_3x^3'}</Tex> 對零均值的 <Tex>{'x'}</Tex> 分解成「<Tex>{'x'}</Tex> 的倍數」加上「與 <Tex>{'x'}</Tex> 正交的部分」：前者被 gain 吸收，後者就是殘餘。對 Gaussian 的 <Tex>{'x'}</Tex> 這個分解有名字——Hermite 多項式 <Tex>{'\\mathrm{He}_2=x^2-\\sigma^2'}</Tex>、<Tex>{'\\mathrm{He}_3=x^3-3\\sigma^2x'}</Tex>，彼此正交、也和 <Tex>{'x'}</Tex> 正交：
        </p>
        <StepDerivation
          steps={[
            { tex: String.raw`E[x\,d(x)]=d_2E[x^3]+d_3E[x^4]=3d_3\sigma_x^4,\qquad w^*-a=\frac{E[x\,d]}{E[x^2]}=3d_3\sigma_x^2`, why: m('Ch11 F-11.4 的固定點（MSE 精確、Sign 需 $|e|\\ll\\sigma_v$）；零均值 Gaussian 的 $E[x^3]=0$、$E[x^4]=3\\sigma^4$。') },
            { tex: String.raw`r(x)=d(x)-(w^*-a)x-E[d]=d_2(x^2-\sigma_x^2)+d_3(x^3-3\sigma_x^2x)=d_2\sigma_x^2\mathrm{He}_2\!\big(\tfrac x{\sigma_x}\big)+d_3\sigma_x^3\mathrm{He}_3\!\big(\tfrac x{\sigma_x}\big)`, why: m('減掉 gain 吸收的直線與主迴路吸收的平均 $E[d]=d_2\\sigma^2$，剩下的剛好是兩個 Hermite 分量。') },
            { tex: String.raw`E[r^2]=d_2^2E[\mathrm{He}_2^2]\sigma^4+d_3^2E[\mathrm{He}_3^2]\sigma^6=2d_2^2\sigma_x^4+6d_3^2\sigma_x^6`, why: m('Hermite 的正交性：$E[\\mathrm{He}_p\\mathrm{He}_q]=p!\\,\\delta_{pq}$（$x/\\sigma$ 是標準常態），交叉項為 0。') },
          ]}
        />
        <TexBlock id="F-11B.2" label={m('gain 校正後的殘餘 INL（Gaussian code）')}>
          {F.hermite}
        </TexBlock>
        <p className="ch11b-tags">
          <ClaimTag kind="approx" /> {m('只有 Gaussian 的 $x$ 才是 Hermite；uniform 的 $x$ 用 $E[x^4]/E[x^2]=\\tfrac35$ 與 $E[r^2]=4d_2^2/45+4d_3^2/175$（HC-11B.5），MASH 的 $x$ 介於兩者之間（峰度約 2.4）。')}
        </p>
        <p>
          這個分解在下一節有用：Hermite 分量的自相關有封閉式（Mehler 公式），所以「殘餘 INL 的 PSD」可以直接從「code 的 PSD」算出來。
        </p>
      </Section>
    </>
  )
}
