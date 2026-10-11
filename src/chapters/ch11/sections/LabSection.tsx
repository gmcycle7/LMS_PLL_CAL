import { Callout, ClaimTag, CodeCompare, ModeGate, Section, StepDerivation, Tex, TexBlock } from '@/components'
import biasSrc from '@/simulation/models/bias.ts?raw'
import { BiasInlLab } from '../experiments/BiasInlLab'
import { F } from '../formulas'
import { ModeDetails, m } from '../common'
import { Fig, FigRef } from '../Fig'

const PATH = 'src/simulation/models/bias.ts'

/** Bias & INL Lab（規格 §19；T12 拆成 T12a / T12b / T12c，勘誤 E01）。 */
export function LabSection() {
  return (
    <Section kind="explore" title="11.B 動手做：Bias & INL Lab" level={2} id="ch11-lab">
      <p>
        把本章的所有元素放在同一個實驗裡：誤差模型（<Tex>{'b'}</Tex>、<Tex>{'c_2'}</Tex>、<Tex>{'c_3'}</Tex>、<Tex>{'\\kappa'}</Tex>）、code 分布、演算法（MSE / Sign）、雜訊{' '}
        <Tex>{'\\sigma_v'}</Tex> 與主迴路 DC null 模式。上方的 <Tex>{'w^*'}</Tex> 由 mean-field 即時計算；「執行 Run」在 Web Worker 中跑多條 seeded block-LMS chains，給出 95% 信賴區間與凍結{' '}
        <Tex>{'w'}</Tex> 時量到的平均 GMAC。Case A/B/C 共用同一個 seed（paired simulation），每個 Case 的 Monte Carlo 結果會留在「Case 並列比較」表裡。
      </p>
      <Callout kind="ok" title="試試看">
        <ol>
          <li>
            載入 <strong>Gallery #7</strong>（預設就是）：
            {m('Sign-LMS、$\\sigma_v=1\\Rightarrow w^*=1.340346$。按 Case 旁的「+」加入 Case B，把演算法改成 MSE（1.34 精確）；再加 Case C，把 $\\sigma_v$ 改成 0 $\\Rightarrow$ 1.4。三條 $E[G](w)$ 曲線在不同的地方穿過 0，按「執行 Run」後三個 Case 的 MC 會依序跑完並列在比較表。')}
          </li>
          <li>{m('把 $\\sigma_v$ 從 1 慢慢拉到 0.05：右上圖的 $w^*(\\sigma_v)$ 從 1.34 滑向 1.4，並在 $\\max|e_\\mathrm{det}|/\\sigma_v>0.3$ 時跳出「線性化失效」警告。')}</li>
          <li>
            載入「Comparator offset：靜態」preset，再切換 DC null 模式：none 1.2141 → shared BBPD 1.0000 → linear PD 1.5897。看 <Tex>{'\\varphi^*'}</Tex> 與 MC 量到的{' '}
            <Tex>{'E[q]\\approx0'}</Tex>。
          </li>
          <li>
            {m(
              '先把 $c_3$ 設成 0、$b$ 設成 0.2（code 仍是置中的 5-level）：$w^*=a$，offset 完全不造成 bias。再把 code 平移 $x_0$ 調到 +2（code 變成 $\\{0,\\dots,4\\}$）：offset 立刻變成 gain bias，一階約 $bE[x]/E[x^2]=0.2\\times2/6\\approx0.067$；調回 0 又消失。平移後切到 shared BBPD，bias 也消失。（若不先把 $c_3$ 歸零，平移 code 會同時改變 INL 的 bias，兩個效應混在一起。）',
            )}
          </li>
          <li>{m('載入「$\\varepsilon_{cc}=\\kappa x$」preset：$w^*=a+\\kappa$，而且畫面明說「不可辨識」。')}</li>
          <li>
            {m(
              '載入「無雜訊 + offset：dead zone」preset 後按 Run：三條 chain 都停在 dead zone 的下緣附近（因為 $w_0=1$ 從下面進來）。把 $w_0$ 改成 2 再跑一次，它們改停在上緣 —— 無雜訊時 LMS 停在哪裡取決於初值。',
            )}
          </li>
          <li>
            {m(
              '把 blocks 調到 100（時間常數 $1/g=50$ blocks，burn-in 只有 50 blocks）：畫面會警告 burn-in 太短、MC 平均偏向 $w_0$。按「執行至收斂 Run-to-Convergence」，Lab 會自動把 blocks 加倍重跑，直到 averaging window 的前半與後半不再有明顯漂移。',
            )}
          </li>
        </ol>
      </Callout>

      <p>
        按 Run 之後，Monte Carlo 的平均不會剛好等於上方的 mean-field <Tex>{'w^*'}</Tex>。<FigRef id="mc-gaps" /> 說明差在哪裡：先看左邊四個方塊 ——
        mean-field 固定點，加上三個可以事先估計的差距（① 有限步長、② servo 的抖動、③ servo 落後）—— 它們的和才是 Monte Carlo 量到的時間平均；再看右邊的六角形：Lab
        就是用這個不等式判定「一致 ✓」或「mismatch ✗」（<Tex>{String.raw`\mathrm{SE}`}</Tex> 是 Monte Carlo 平均值的標準誤，也就是統計上的不確定度）。圖上 ① 的式子就是下面的 F-11.16（<Tex>{"G''"}</Tex> 是平均 GMAC 曲線的二階導數，
        <Tex>{String.raw`\operatorname{Var}(w)`}</Tex> 是 <Tex>{'w'}</Tex> 抖動的變異數）；② 就是 §11.1 的 F-11.17。
      </p>
      <Fig id="mc-gaps" />
      <ModeDetails title={m('Monte Carlo 和 mean-field 為什麼不會「完全」一樣？三個差距與它們的估計式')}>
        <p>
          mean-field 的 <Tex>{'w^*'}</Tex> 是「<Tex>{'\\mu\\to0'}</Tex>、主迴路 <Tex>{'\\varphi'}</Tex> 為常數」的極限。真實的 block LMS（也就是 Lab 的 Monte Carlo）有三個可預期的差距；Lab
          不用經驗容許量去蓋掉它們，而是一個一個估出來：
        </p>
        <p>
          先看第 (1) 個差距的方塊圖（<FigRef id="finite-step-loop" />，全部是 block rate，索引 <Tex>{'k'}</Tex>）：<Tex>{String.raw`\delta w=w-w^*`}</Tex> 是 <Tex>{'w'}</Tex>{' '}
          離固定點的距離（注意不是全站的 <Tex>{String.raw`\delta=a-w`}</Tex>）。右邊的累加器（<Tex>{'\\times\\mu'}</Tex>、加法點、<Tex>{'z^{-1}'}</Tex>）就是{' '}
          <Tex>{String.raw`\delta w_{k+1}=\delta w_k+\mu G_k`}</Tex>；左邊的加法點把三個東西合成 <Tex>{'G_k'}</Tex>（推導第 1–2 行）：抽樣雜訊 <Tex>{String.raw`\eta_k`}</Tex>（<Tex>{'+'}</Tex>）、
          藍色的恢復力 <Tex>{String.raw`S\,\delta w_k`}</Tex>（<Tex>{'-'}</Tex>），以及紅色的曲率項 <Tex>{String.raw`\tfrac12G''(w^*)\,\delta w_k^2`}</Tex>（<Tex>{'+'}</Tex>）。
          只看藍色那條負回授，就是下面推導的第 3 行（pole <Tex>{'1-g'}</Tex>）；再加上紅色那條，就是第 4–5 行的偏移。
        </p>
        <Fig id="finite-step-loop" />
        <StepDerivation
          title={m('(1) 有限步長：erf 的曲率把 $w$ 的抖動「整流」成偏移')}
          steps={[
            { tex: String.raw`w_{k+1}=w_k+\mu\,G_k,\qquad G_k=E[G](w_k)+\eta_k,\quad \operatorname{Var}(\eta_k)\approx\frac{E[x^2]}{N}`, why: m('一個 block 的 GMAC = 平均值 + 抽樣雜訊；Sign-LMS 每個 sample 的 $(q\\,x)^2=x^2$，$N$ 個平均後變異數除以 $N$。') },
            { tex: String.raw`\delta w\equiv w-w^*:\qquad E[G](w)\approx-S\,\delta w+\tfrac12G''(w^*)\,\delta w^2`, why: m('在固定點附近泰勒展開到二次；$S=-dE[G]/dw$，$G\'\'$ 是 mean-field 曲線的二階導數（曲率）。') },
            { tex: String.raw`\delta w_{k+1}\approx(1-g)\,\delta w_k+\mu\,\eta_k,\quad g=\mu S\;\Rightarrow\;\operatorname{Var}(w)=\frac{\mu^2\operatorname{Var}(\eta)}{1-(1-g)^2}=\frac{\mu^2E[x^2]}{N\,g\,(2-g)}`, why: m('只留一次項：一階遞迴的穩態變異數（等比級數 $\\sum(1-g)^{2j}=1/(1-(1-g)^2)$，Ch12 會再用到）。') },
            { tex: String.raw`E[w_{k+1}]=E[w_k]\;\Rightarrow\;E\big[E[G](w)\big]=0\;\Rightarrow\;-S\,E[\delta w]+\tfrac12G''\,E[\delta w^2]=0`, why: m('穩態時 $w$ 的平均不再改變，所以「平均的更新量」必須是 0 —— 注意是 $G$ 的平均為 0，不是 $G(\\text{平均})$ 為 0。') },
            { tex: String.raw`E[\bar w]-w^*=E[\delta w]\approx\frac{G''(w^*)\operatorname{Var}(w)}{2S}`, why: m('解出平均偏移（$E[\\delta w^2]\\approx\\operatorname{Var}(w)$）。MSE-LMS 的 $E[G]$ 是直線，$G\'\'=0$，沒有這個偏移。') },
          ]}
        />
        <TexBlock id="F-11.16" label={m('有限步長偏移（Sign-LMS、$\\sigma_v>0$）')}>
          {F.finiteStep}
        </TexBlock>
        <p className="ch11-tags">
          <ClaimTag kind="approx" />
        </p>
        <ul>
          <li>
            {m(
              '$\\sigma_v=0$ 的離散 code：$E[G](w)$ 是階梯，沒有曲率可言；$w$ 在 $w^*$ 兩側來回跳（limit cycle），偏移的量級是一個 block 的平均步長 $\\mu E|x|$，$N$ 很小時再加上兩側漂移不對稱的項 $\\tfrac{\\mu E[x^2]}{2N}\\big|\\tfrac1{G_-}-\\tfrac1{G_+}\\big|$。',
            )}
          </li>
          <li>
            <strong>(2) servo 的抖動是額外的 dither</strong>（§11.1、F-11.17）：{m('DC null 模式下，MC 要對照的是 $\\sigma_\\mathrm{eff}$ 的 servo-aware 固定點，不是理想 DC null 的 $w^*$。')}
          </li>
          <li>
            <strong>(3) servo 落後</strong>：
            {m(
              '$w$ 每個 block 跳一步，$\\varphi$ 要 $\\tau=1/(k_\\varphi K_\\mathrm{servo})$ 個 sample 才跟上。這段時間 comparator 看到的是「$\\varphi$ 凍結」的 $G(w)$，它的曲率通常比 servo 跟上之後大得多，把沒跟上的那部分抖動 $\\approx\\tfrac{\\mu^2E[x^2]}{N}\\cdot\\tfrac{\\tau}{N}$ 整流成偏移。$N\\gg\\tau$ 時可忽略。',
            )}
          </li>
        </ul>
        <p>
          Lab 的 Analytic ↔ Monte Carlo 判定就是這三項加上統計誤差：
          <Tex>{String.raw`|\bar w_\mathrm{MC}-w^*_\text{servo-aware}|\le4\,\mathrm{SE}+(\text{有限步長與 servo 落後的估計})+0.25\,|w^*_\text{servo-aware}-w^*|`}</Tex>
          。超過就標成 mismatch，並說明最可能的原因。
        </p>
        <CodeCompare
          items={[
            { label: '有限步長／servo 落後的估計', source: biasSrc, region: 'finiteStepBias', path: PATH, note: "MSE：0；Sign 光滑：$G''(w^*)\\operatorname{Var}(w)/(2S)$；無雜訊離散 code：limit cycle 上界。" },
            { label: 'Analytic ↔ MC 的判定', source: biasSrc, region: 'mcAgreement', path: PATH, note: '容許量 = $4\\,\\mathrm{SE}$ + 有限步長 + servo 修正的 25%；dead zone 時比對區間。' },
          ]}
          caption="Lab 的交叉比對（✓ / ✗）就是右邊這個函式的回傳值。"
        />
      </ModeDetails>

      <ModeGate min="research">
        <p className="small muted">
          Research：切換到 Research 模式後，控制面板會出現 code-dependent jitter（<Tex>{'\\rho_j'}</Tex>、<Tex>{'x_j'}</Tex>），可重現勘誤 E17 的 0.9601。DSM code
          依時間順序循環，各 chain 隨機相位，CI 假設 chain 之間獨立；chains 太少時 SE 本身估不準，偶爾會出現假的 mismatch（增加 chains 再比一次）。
        </p>
      </ModeGate>
      <BiasInlLab />
    </Section>
  )
}
