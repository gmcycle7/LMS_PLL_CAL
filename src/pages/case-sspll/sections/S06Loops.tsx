import type { ReactNode } from 'react'
import { Callout, ModeGate, Prereq, Section, StepDerivation, Tex, mathText } from '@/components'
import { cAbs } from '@/simulation/core/complex'
import { loopH, loopT, makeL1, mode1SureBand } from '@/simulation/models/sspll'
import { BAND, FREF_MHZ, LOOP_KEYS, LOOPS, PARAMS, SUMMARY, WORKED, type BandRow } from '../data'
import { Claim, DataTable, Diagram, FigRef, Formula, Hand, Kappa, ModelCompare, Sci, Src, TryIt, fx, r, tx } from '../common'
import { HpdExplorer } from '../experiments/HpdExplorer'

const TABLE_F_MHZ = [10, 20, 40, 60, 83.8, 100, 120, 134.82, 200, 320, 1000, 2000]

function bandText(bands: BandRow[]): ReactNode {
  if (!bands.length) return '無'
  return (
    <strong>
      {bands.map((b) => `${fx(b[0], 0)}–${fx(b[1], 2)} MHz`).join('；')}
    </strong>
  )
}

/** §6 三個迴路：設計與精確的反號帶（含實驗 A）。 */
export function S06Loops() {
  const K = Number(LOOPS.L1.params.K)
  const Kp = Number(LOOPS.L2.params.Kp)
  const Ki = Number(LOOPS.L2.params.Ki)
  const p3 = LOOPS.L3.params
  const T1 = PARAMS.typeI_criteria
  const S = PARAMS.sensitivity
  const pole200 = mode1SureBand(makeL1({ fPoleHz: 200e6 }))
  const typeIRows: [string, string, ReactNode][] = [
    ['lat2', '延遲 $d=2$', <Tex key="c">{r`K(d-\tfrac12)`}</Tex>],
    ['lat4', '延遲 $d=4$', ''],
    ['lat5', '延遲 $d=5$', ''],
    ['pole500M', '寄生極點 500 MHz', <Tex key="c">{r`K(\tfrac12+\tfrac{p}{1-p})`}</Tex>],
    ['pole250M', '寄生極點 250 MHz', ''],
    ['pole200M', '寄生極點 200 MHz', ''],
  ]
  return (
    <Section kind="formula" level={2} title="6. 三個迴路：設計與精確的反號帶" id="cs-6">
      <p>
        所有迴路都以「<Tex>{r`\lvert T\rvert`}</Tex> 的 −3 dB = 320 MHz」為設計目標（TS port 設計出來的三個迴路：{LOOP_KEYS.map((k) => `${k} ${fx(SUMMARY[k].f3dBMHz, 6)} MHz`).join('、')}）。三者的差別在 §3 <FigRef id="hpd-loop" /> 的 <Tex>{'L(z)'}</Tex> 外框裡放了什麼：
      </p>
      <Diagram id="three-loops" />
      <p>
        先數藍色方塊（每個藍色方塊含一個積分器）：L1 只有 VCO 那一個，所以是 Type-I；L2 的 loop filter 多一條積分路徑、L3 的 charge pump 把電荷存在電容上，各多一個積分器，所以是 Type-II。再看每一列方塊裡的式子：把同一列的方塊相乘就是該迴路的 <Tex>{'L'}</Tex>，例如 L1 是{' '}
        <Tex>{r`K\cdot\tfrac{1}{z-1}=\tfrac{Kz^{-1}}{1-z^{-1}}`}</Tex>（<Tex>{r`\tfrac{1}{z-1}`}</Tex> 就是「積分器加 1 拍延遲」<Tex>{r`\tfrac{z^{-1}}{1-z^{-1}}`}</Tex>），L2 是 <Tex>{r`\big(K_p+\tfrac{K_i}{1-z^{-1}}\big)\tfrac{1}{z-1}`}</Tex>。L3 是連續時間電路（<Tex>{'s'}</Tex> 是 Laplace
        變數，<Tex>{r`\omega_z`}</Tex>、<Tex>{r`\omega_p`}</Tex> 是 loop filter 的零點與極點頻率），要多一步「每拍取樣一次」才變成 <Tex>{'L_3(z)'}</Tex>，§6.3 會推。依 §5.2 的直覺，兩個積分器的 L2、L3 在低頻一定反號，一個積分器的 L1 不一定。
      </p>

      <h3>6.1 L1：SSPLL Type-I</h3>
      <Formula id="F-CS.7" />
      <p>
        <Tex>{`L_1=\\dfrac{Kz^{-1}}{1-z^{-1}}`}</Tex>，由 <Tex>{r`\lvert T(\Omega_3)\rvert^2=\tfrac12`}</Tex> 解出 <Tex>{`K=${fx(K, 6)}`}</Tex>。
      </p>
      <StepDerivation
        title={mathText(r`一步一步：L1 的 $\mathrm{Re}\,H_{PD}\ge0$`)}
        steps={[
          { tex: r`H_{PD}=\frac{1-z^{-1}}{1-(1-K)z^{-1}}`, why: <><Tex>{'1/(1+L)'}</Tex> 分子分母同乘 <Tex>{r`(1-z^{-1})`}</Tex>。</> },
          { tex: r`\mathrm{Re}\,H_{PD}=\frac{\mathrm{Re}\{(1-e^{-j\Omega})(1-(1-K)e^{j\Omega})\}}{\lvert1-(1-K)e^{-j\Omega}\rvert^2}`, why: '分子分母同乘分母的共軛。' },
          {
            tex: r`=\frac{(2-K)(1-\cos\Omega)}{\lvert1-(1-K)e^{-j\Omega}\rvert^2}\;\ge0\quad(0<K<2)`,
            why: <>展開分子：<Tex>{r`1-(1-K)e^{j\Omega}-e^{-j\Omega}+(1-K)`}</Tex>，取實部得到 <Tex>{r`(2-K)(1-\cos\Omega)`}</Tex>。</>,
          },
        ]}
      />
      <p>
        L1 沒有反號帶（TS 掃描：{BAND.L1 ? '有' : '無'}；golden：closed form 誤差 <Sci v={Number(PARAMS.closed_forms.L1_ReH_err)} sig={1} />，<Tex>{r`\min\mathrm{Re}H`}</Tex> 出現在 DC 附近）。
        <Claim kind="exact" />
      </p>
      <Callout kind="warn" title="但 Type-I 不是天生免疫（對抗審查的修正）">
        <p>
          標稱的 L1 沒有反號帶，是因為它剛好只有 1 拍延遲、也沒有別的極點。實際電路在 SSPD 之後常有額外的 pipeline 延遲，或 loop filter 上的寄生極點：
        </p>
        <Diagram id="type1-variants" />
        <p>
          先看第一列（標稱）：依 §5.1，只要看 <Tex>{r`\mathrm{Re}\,L`}</Tex>。一個積分器加 1 拍延遲的實部固定是 <Tex>{r`-\tfrac12`}</Tex>，所以 <Tex>{r`\mathrm{Re}\,L=-K/2`}</Tex>，<Tex>{'K<2'}</Tex> 時不可能低於 <Tex>{'-1'}</Tex>。再看下面兩列的紅色方塊：多出來的延遲（迴路總共 <Tex>{'d'}</Tex> 拍）或寄生極點（
          <Tex>{'p'}</Tex> 是它在 <Tex>{'z'}</Tex> 平面上的位置，<Tex>{r`p=e^{-2\pi f_{pole}/f_{ref}}`}</Tex>，極點頻率越低 <Tex>{'p'}</Tex> 越接近 1）都會在低頻把 <Tex>{r`\mathrm{Re}\,L`}</Tex> 再往下拉。圖上每個框標題寫的下限，取絕對值就是下表的「判據」與下面公式的兩個不等式：判據值大於 1，
          <Tex>{r`\mathrm{Re}\,L`}</Tex> 就會低於 <Tex>{'-1'}</Tex>，出現反號帶。
        </p>
        <p>把延遲或寄生極點加進去、再重新調到 320 MHz：</p>
        <DataTable
          className="cs-num"
          head={['變形（都重新調到 320 MHz）', <Tex key="k">{'K'}</Tex>, '判據', '判據值', 'PM', <><Tex>{r`\mathrm{Re}H<0`}</Tex> 帶</>]}
          rows={typeIRows.map(([key, label, crit]) => {
            const g = T1[key]
            return [label, fx(g.K, 4), crit, g.criterion > 1 ? <strong>{fx(g.criterion, 3)}</strong> : fx(g.criterion, 3), `${fx(g.PM_deg, 1)}°`, bandText(g.bands)]
          })}
        />
        <Formula id="F-CS.10" />
        <ul>
          <li>
            延遲：<Tex>{r`\lvert\sin(nx)/\sin x\rvert\le n`}</Tex>，所以 <Tex>{r`\mathrm{Re}\,L\ge-K(d-\tfrac12)`}</Tex>，在 <Tex>{r`\Omega\to0`}</Tex> 時取到。
          </li>
          <li>
            極點：<Tex>{r`\frac{(1-p)z^{-1}}{(1-z^{-1})(1-pz^{-1})}=\frac{z^{-1}}{1-z^{-1}}-\frac{pz^{-1}}{1-pz^{-1}}`}</Tex>。第一項實部恆為 <Tex>{r`-\tfrac12`}</Tex>；第二項的實部在 <Tex>{r`\Omega\to0`}</Tex> 時最負，為{' '}
            <Tex>{r`-p/(1-p)`}</Tex>。
          </li>
        </ul>
        <p>
          <Claim kind="exact" />
          L1 加 200 MHz 寄生極點時反號帶很淺（min {fx(T1.pole200M.bands[0][2], 3)}）：mode-1 {pole200.sure ? '有' : '沒有'}「一定反號」的區間，golden 的 <Tex>{r`j/4096`}</Tex> map 上 PHOS 也沒有反號——帶太淺時，其餘 5% 的高頻權重就能把它救回來。
        </p>
      </Callout>
      <Hand id="HC-CS.3">{r`預設是標稱的 L1（$K=0.388836$、$d=1$、$f=20$ MHz，也就是 §5.2 那張表的 L1 列）。把上表某一列的 $K$ 與 $d$ 填進去，先手算判據 $K(d-\tfrac12)$ 與 $\mathrm{Re}\,H_{PD}$，再對答案。`}</Hand>

      <h3>6.2 L2：SSPLL Type-II（P + I）</h3>
      <p>
        <Tex>{r`L_2=\Big(K_p+\dfrac{K_i}{1-z^{-1}}\Big)\dfrac{z^{-1}}{1-z^{-1}}`}</Tex>，<Tex>{r`K_i=\omega_n^2`}</Tex>、<Tex>{r`K_p=2\zeta\omega_n`}</Tex>。<Tex>{`\\zeta=${fx(Number(LOOPS.L2.params.zeta), 4)}`}</Tex> 對應 sampled-data 的 PM{' '}
        {fx(SUMMARY.L2.pmDeg, 2)}°，<Tex>{r`\omega_n`}</Tex> 讓 BW 為 320 MHz：<Tex>{`K_p=${fx(Kp, 6)}`}</Tex>、<Tex>{`K_i=${fx(Ki, 7)}`}</Tex>（<Tex>{'K_p'}</Tex> 是比例路徑的增益，<Tex>{'K_i'}</Tex> 是積分路徑的增益，都以「每拍」為單位；<Tex>{r`\zeta`}</Tex> 與{' '}
        <Tex>{r`\omega_n`}</Tex> 是二階系統的阻尼比與自然頻率）。
      </p>
      <p>
        要找反號帶，依 §5.1 只要算 <Tex>{r`\mathrm{Re}\,L_2`}</Tex>。把 <Tex>{'L_2'}</Tex> 的括號乘開，它是兩條路徑的和，可以分開看：
      </p>
      <Diagram id="re-l2" />
      <p>
        先看比例路徑：它是一個積分器，實部固定是 <Tex>{r`-K_p/2`}</Tex>，不隨頻率變（下面推導的第 2 步）。再看藍色的積分路徑：它是兩個積分器串接，結果是純實數而且為負，頻率越低越負（第 3 步）。圖上加法點的輸出就是第 4 步的 <Tex>{r`\mathrm{Re}\,L_2`}</Tex>；菱形的判斷{' '}
        <Tex>{r`\mathrm{Re}\,L_2<-1`}</Tex> 解出來的邊界（反號帶的上緣），就是第 6 步的 <Tex>{'f_{inv}'}</Tex>。因為積分路徑在 DC 趨向 <Tex>{r`-\infty`}</Tex>，反號帶一定從 DC 開始。
      </p>
      <StepDerivation
        title={mathText(r`一步一步：$\mathrm{Re}\,L_2$ 的精確式與帶緣`)}
        steps={[
          { tex: r`\frac{z^{-1}}{1-z^{-1}}=\frac{1}{e^{j\Omega}-1}=\frac{e^{-j\Omega/2}}{2j\sin(\Omega/2)}`, why: <>分子分母同乘 <Tex>{'z'}</Tex>，再把 <Tex>{r`e^{j\Omega}-1`}</Tex> 寫成 <Tex>{r`e^{j\Omega/2}\cdot2j\sin(\Omega/2)`}</Tex>。</> },
          { tex: r`\mathrm{Re}\frac{z^{-1}}{1-z^{-1}}=\mathrm{Re}\frac{\cos\frac\Omega2-j\sin\frac\Omega2}{2j\sin\frac\Omega2}=-\frac12`, why: <>除以純虛數 <Tex>{r`2j\sin`}</Tex>：實部只來自 <Tex>{r`-j\sin`}</Tex> 那一項。積分器（含 1 拍延遲）的實部永遠是 −½。</> },
          { tex: r`\frac{z^{-1}}{(1-z^{-1})^2}=\frac{1}{(e^{j\Omega/2}-e^{-j\Omega/2})^2}=-\frac{1}{4\sin^2(\Omega/2)}`, why: <>同樣寫成 <Tex>{r`(2j\sin)^2`}</Tex>，結果是<strong>純實數</strong>而且為負：雙積分器把訊號「翻面」。</> },
          { tex: r`\mathrm{Re}\,L_2=-\frac{K_p}{2}-\frac{K_i}{4\sin^2(\Omega/2)}`, why: '兩項相加，乘上增益。' },
          { tex: r`\mathrm{Re}\,L_2<-1\iff\sin^2\frac\Omega2<\frac{K_i}{2(2-K_p)}`, why: <>代入 §5.1 的恆等式，移項（需要 <Tex>{'K_p<2'}</Tex>）。</> },
          { tex: r`f_{inv}=\frac{f_{ref}}{\pi}\arcsin\sqrt{\frac{K_i}{2(2-K_p)}}`, why: <>解出 <Tex>{r`\Omega`}</Tex>，再換成頻率。</> },
        ]}
      />
      <Formula id="F-CS.8" />
      <p>
        <strong>數值手算</strong>：<Tex>{`\\frac{K_i}{2(2-K_p)}=${tx(WORKED.b_ratio, 7)}`}</Tex> → 開根號得 <Tex>{tx(WORKED.b_sqrt, 6)}</Tex> → <Tex>{r`\arcsin`}</Tex> 得 <Tex>{tx(WORKED.b_asin, 6)}</Tex> → 乘上 <Tex>{`${FREF_MHZ}/\\pi`}</Tex> 得{' '}
        <Tex>{`f_{inv}=${tx(WORKED.b_f_inv_MHz, 3)}\\ \\mathrm{MHz}`}</Tex>。TS 的數值掃描得到 {fx(BAND.L2?.hi ?? NaN, 6)} MHz。
        <Claim kind="exact" />
      </p>
      <Hand id="HC-CS.4">{r`把 $K_p$、$K_i$ 換成你的迴路（或 PVT 角落的值），先用計算機按出 $f_{inv}$，再對答案。`}</Hand>
      <p>
        <strong>在 83.8 MHz 手算 <Tex>{r`\mathrm{Re}H`}</Tex></strong>：<Tex>{`\\Omega=${tx(WORKED.a_Omega, 6)}`}</Tex>，<Tex>{`\\sin^2(\\Omega/2)=${tx(WORKED.a_sin2, 7)}`}</Tex>；<Tex>{`\\mathrm{Re}L=${tx(-Kp / 2, 6)}${tx(-Ki / (4 * WORKED.a_sin2), 6)}=${tx(WORKED.a_ReL_closed, 6)}`}</Tex>；
        <Tex>{`L=${tx(WORKED.a_L_complex[0], 5)}${tx(WORKED.a_L_complex[1], 5)}j`}</Tex>，<Tex>{`\\lvert1+L\\rvert^2=${tx(WORKED.a_abs_1plusL_sq, 5)}`}</Tex>；<Tex>{`\\mathrm{Re}H=(1${tx(WORKED.a_ReL_closed, 5)})/${tx(WORKED.a_abs_1plusL_sq, 5)}=${tx(WORKED.a_ReH, 5)}`}</Tex>。這正是 L2 反號帶的最低點。
      </p>
      <Hand id="HC-CS.5">{r`同一個算法、換你來：把 $f$ 換成你的 PMUX 旋轉頻率 $\alpha f_{ref}$，實部、虛部分開算出 $\mathrm{Re}\,H_{PD}$，最後乘上 $W_1$ 就是 PHOS mode-1 的單線估計（§8.1）。`}</Hand>

      <h3>6.3 L3：傳統 CPPLL（3 階 Type-II）</h3>
      <p>
        連續時間模型 <Tex>{r`L(s)=K\frac{1+s/\omega_z}{s^2(1+s/\omega_p)}`}</Tex>，其中 <Tex>{r`\omega_z=\omega_c/\sqrt b`}</Tex>、<Tex>{r`\omega_p=\omega_c\sqrt b`}</Tex>、<Tex>{r`K=\omega_c^2/\sqrt b`}</Tex>、
        <Tex>{r`b=1+C_1/C_2=\big(\frac{1+\sin\mathrm{PM}}{\cos\mathrm{PM}}\big)^2`}</Tex>。取 CT PM = 60° 的放置法，得到 <Tex>{`b=${fx(Number(p3.b), 3)}`}</Tex>；<Tex>{`\\omega_cT_{ref}=${fx(Number(p3.wc), 6)}`}</Tex>（CT 交越頻率{' '}
        {fx(Number(p3.fcCtMHz), 2)} MHz），<Tex>{`f_z=${fx(Number(p3.fzMHz), 2)}`}</Tex> MHz、<Tex>{`f_p=${fx(Number(p3.fpMHz), 2)}`}</Tex> MHz。
      </p>
      <Prereq title="Laplace transform、部分分式、impulse-invariant 取樣">
        <ul>
          <li>
            <strong>Laplace transform</strong>：連續時間版本的 Z transform。把「對時間微分」寫成乘上 <Tex>{'s'}</Tex>、「對時間積分」寫成除以 <Tex>{'s'}</Tex>，微分方程就變成 <Tex>{'s'}</Tex> 的代數式。只需要三個對照：
            <Tex>{r`\tfrac1s\leftrightarrow1`}</Tex>（步階）、<Tex>{r`\tfrac1{s^2}\leftrightarrow t`}</Tex>（斜坡）、<Tex>{r`\tfrac{1}{s+a}\leftrightarrow e^{-at}`}</Tex>（指數衰減），都是 <Tex>{r`t\ge0`}</Tex>。由右邊回到左邊叫「逆
            Laplace」。
          </li>
          <li>
            <strong>部分分式</strong>：把一個有理式拆成幾個簡單分式的和（微積分裡積有理函數時用過），這樣每一項都能直接查上面的對照表。
          </li>
          <li>
            <strong>CPPLL 的 <Tex>{'L(s)'}</Tex> 怎麼來</strong>：charge pump 的電流流進 <Tex>{r`R+C_1`}</Tex> 並聯 <Tex>{'C_2'}</Tex> 的 loop filter（一個積分、一個零點 <Tex>{r`\omega_z`}</Tex>、一個極點 <Tex>{r`\omega_p`}</Tex>），VCO 再把電壓積分成相位（多一個{' '}
            <Tex>{'1/s'}</Tex>）。
          </li>
          <li>
            <strong>impulse-invariant 取樣</strong>：PD 每個 <Tex>{r`T_{ref}`}</Tex> 只比較一次。先算「在 <Tex>{'t=0'}</Tex> 打進一個很窄的電荷包之後，相位隨時間怎麼走」——這就是 <Tex>{'l(t)'}</Tex>；再每隔一拍讀一次{' '}
            <Tex>{'l(n)'}</Tex>，就得到離散時間的 <Tex>{'L(z)'}</Tex>。時間以 <Tex>{r`T_{ref}`}</Tex> 為單位，所以 <Tex>{r`\omega`}</Tex> 的單位是 rad/sample。
          </li>
        </ul>
      </Prereq>
      <p>
        做法和 §6.2 一樣：把 <Tex>{'L_3'}</Tex> 拆成幾條路徑，各自取實部再相加。差別只在這些路徑要先從連續時間「取樣」過來：
      </p>
      <Diagram id="re-l3" />
      <p>
        先看左邊兩格：charge pump 打進一個電荷包之後，VCO 的相位照 <Tex>{'l(t)'}</Tex> 走（<Tex>{'K'}</Tex> 是斜坡的斜率，<Tex>{'B'}</Tex> 是步階的高度，<Tex>{r`\omega_p`}</Tex> 是 loop filter 的極點頻率）；PD 每拍只看一次，所以離散的開迴路增益是 <Tex>{r`L_3(z)=\sum_{n\ge1}l(n)z^{-n}`}</Tex>。再看分出來的三條路徑：
        <Tex>{'l(t)'}</Tex> 的斜坡取樣後是雙積分（藍色，和 <FigRef id="re-l2" /> 的積分路徑同型，實部越低頻越負），步階取樣後是單積分（實部固定 <Tex>{'-B/2'}</Tex>，相當於 L2 的比例路徑），指數衰減取樣後是一個位在 <Tex>{r`p=e^{-\omega_p}`}</Tex> 的極點。圖上三條路徑的式子就是下面推導第 3
        步的三項；加法點的輸出取負號就是第 4 步的 <Tex>{r`-\mathrm{Re}\,L`}</Tex>：第一項直接對上，後兩條路徑的實部通分相加就是第二項 <Tex>{r`B(1-p^2)/(2\lvert1-pe^{-j\Omega}\rvert^2)`}</Tex>（其中 <Tex>{r`\lvert1-pe^{-j\Omega}\rvert^2=1-2p\cos\Omega+p^2`}</Tex>）。
      </p>
      <StepDerivation
        title={mathText(r`一步一步：CP 的電荷包在 $nT$ 注入、$(n+1)T$ 比較（impulse-invariant）`)}
        steps={[
          { tex: r`L(s)=\frac{K}{s^2}+\frac{B}{s}-\frac{B}{s+\omega_p},\qquad B=\frac{K(\omega_p/\omega_z-1)}{\omega_p}>0`, why: '部分分式。' },
          { tex: r`l(t)=Kt+B\big(1-e^{-\omega_pt}\big)`, why: '逆 Laplace 得到「一個電荷包之後的相位」。' },
          {
            tex: r`L(z)=\textstyle\sum_{n\ge1} l(n)\,z^{-n}=K\frac{z^{-1}}{(1-z^{-1})^2}+B\frac{z^{-1}}{1-z^{-1}}-B\frac{pz^{-1}}{1-pz^{-1}},\ \ p=e^{-\omega_p}`,
            why: <>每一拍取樣一次（<Tex>{'l(0)=0'}</Tex>，所以嚴格 proper）；等比數列求和。</>,
          },
          {
            tex: r`-\mathrm{Re}\,L=\frac{K}{4\sin^2(\Omega/2)}+\frac{B(1-p^2)}{2\lvert1-pe^{-j\Omega}\rvert^2}`,
            why: <>用 §6.2 的第 2、3 步，加上 <Tex>{r`\mathrm{Re}\{-pz^{-1}/(1-pz^{-1})\}=-p(\cos\Omega-p)/\lvert1-pe^{-j\Omega}\rvert^2`}</Tex>，合併得到。</>,
          },
        ]}
      />
      <Formula id="F-CS.9" />
      <p>
        數值：<Tex>{`B=${fx(Number(p3.B), 5)}`}</Tex>、<Tex>{`p=${fx(Number(p3.p), 5)}`}</Tex>；反號帶 <Tex>{`0\\text{–}${tx(BAND.L3?.hi ?? NaN, 3)}\\ \\mathrm{MHz}`}</Tex>，最低 {fx(BAND.L3?.min ?? NaN, 4)} @ {fx(BAND.L3?.fMin ?? NaN, 1)} MHz（closed form 相對誤差{' '}
        <Sci v={Number(PARAMS.closed_forms.L3_ReL_rel_err)} sig={1} />）。
        <Claim kind="exact" />
      </p>
      <p>
        <strong>帶緣依賴取樣映射</strong>（對抗審查的修正；每種都重新調到 320 MHz）：
      </p>
      <DataTable
        className="cs-num"
        head={['映射', '意義', 'PM', '反號帶', '最低']}
        rows={[
          ['impulse（本文 L3）', '窄電荷包，下一拍比較', `${fx(SUMMARY.L3.pmDeg, 2)}°`, `0–${fx(BAND.L3?.hi ?? NaN, 3)} MHz`, <Kappa key="k" v={BAND.L3?.min} />],
          ['halfT', <>電荷包中心延後 <Tex>{'T/2'}</Tex>（<Tex>{r`e^{-sT/2}`}</Tex> 型）</>, `${fx(S.L3_halfT.PM_deg, 2)}°`, `0–${fx(S.L3_halfT.bands[0][1], 3)} MHz`, <Kappa key="k" v={S.L3_halfT.bands[0][2]} digits={3} />],
          ['zoh', 'PD 輸出保持一整拍', `${fx(S.L3_zoh.PM_deg, 2)}°`, `0–${fx(S.L3_zoh.bands[0][1], 3)} MHz`, <Kappa key="k" v={S.L3_zoh.bands[0][2]} digits={3} />],
        ]}
      />
      <p className="small muted">
        另外，背景研究裡有一個 <Tex>{'b'}</Tex> 與 PM 都不同的 CPPLL 設計，它的帶緣不能套到 L3；本頁所有 L3 數字都是上表第一列的設計（可在下方實驗 A 改 CT PM 自己重算）。
      </p>

      <h3>
        6.4 一張表看 <Tex>{r`H_{PD}`}</Tex>
      </h3>
      <DataTable
        className="cs-num"
        head={[
          <><Tex>{'f'}</Tex> (MHz)</>,
          ...LOOP_KEYS.flatMap((k) => [<>{k} <Tex>{r`\mathrm{Re}H`}</Tex></>, <>{k} <Tex>{r`\lvert T\rvert`}</Tex></>]),
        ]}
        rows={TABLE_F_MHZ.map((fm) => [
          String(fm),
          ...LOOP_KEYS.flatMap((k) => {
            const f = fm / FREF_MHZ
            return [<Kappa key={`${k}h`} v={loopH(LOOPS[k], f).re} digits={5} tol={5e-5} />, fx(cAbs(loopT(LOOPS[k], f)), 4)]
          }),
        ])}
        caption={<>由 TS port 即時計算（與 hpd_L*.json 相同的函式）。紅色粗體＝<Tex>{r`\mathrm{Re}\,H_{PD}<0`}</Tex>。</>}
      />
      <p>
        圖形的樣子：L2、L3 的 <Tex>{r`\mathrm{Re}H`}</Tex> 從 DC 以 <Tex>{r`-\Omega^2`}</Tex> 往下，在 {fx(BAND.L3?.fMin ?? NaN, 0)}–{fx(BAND.L2?.fMin ?? NaN, 0)} MHz 到谷底，在 {fx(BAND.L3?.hi ?? NaN, 0)}–{fx(BAND.L2?.hi ?? NaN, 0)} MHz 回到 0，之後一路升到{' '}
        {fx(Math.min(SUMMARY.L2.maxReH, SUMMARY.L3.maxReH), 2)}–{fx(SUMMARY.L1.maxReH, 2)}。L1 從 0 單調上升，沒有負值。注意在 320 MHz（−3 dB 頻率）三者的 <Tex>{r`\lvert T\rvert`}</Tex> 都是 {fx(Math.SQRT1_2, 4)}，但 <Tex>{r`\mathrm{Re}H`}</Tex>{' '}
        已經是正的——<strong>反號帶比迴路頻寬窄得多</strong>，它在 peaking 區。
      </p>

      <h3>6.5 PVT 與設計參數會移動帶緣（keep-out 要留 margin）</h3>
      <DataTable
        className="cs-num"
        head={['loop gain 倍率（不重新設計）', 'L2 BW [MHz]', 'L2 帶緣 [MHz]', 'L2 最低', 'L3 BW [MHz]', 'L3 帶緣 [MHz]', 'L3 最低']}
        rows={[0.6, 0.8, 1, 1.25, 1.5].map((g) => {
          const a = g === 1 ? { f3dB_MHz: SUMMARY.L2.f3dBMHz, bands: [[0, BAND.L2?.hi ?? NaN, BAND.L2?.min ?? NaN, 0]] } : S[`L2_gain${g}`]
          const b = g === 1 ? { f3dB_MHz: SUMMARY.L3.f3dBMHz, bands: [[0, BAND.L3?.hi ?? NaN, BAND.L3?.min ?? NaN, 0]] } : S[`L3_gain${g}`]
          return [`$\\times${g}$${g === 1 ? '（標稱）' : ''}`, fx(a.f3dB_MHz, 0), fx(a.bands[0][1], 2), fx(a.bands[0][2], 3), fx(b.f3dB_MHz, 0), fx(b.bands[0][1], 2), fx(b.bands[0][2], 3)]
        })}
      />
      <DataTable
        className="cs-num"
        head={['設計變化', 'BW [MHz]', 'PM', '反號帶', '最低']}
        rows={(
          [
            ['L2_pm45', 'L2 PM 45°（重新調到 320 MHz）'],
            ['L2_pm75', 'L2 PM 75°（重新調到 320 MHz）'],
            ['L2_lat2_redesign', 'L2 延遲 2 拍（重新設計 PM 60°）'],
            ['L2_lat2_fixedKpKi', 'L2 延遲 2 拍（增益不變、不重新設計）'],
            ['L3_pm45', 'L3 CT PM 45°'],
            ['L3_pm55', 'L3 CT PM 55°'],
          ] as [string, string][]
        ).map(([key, label]) => [label, fx(S[key].f3dB_MHz, 0), `${fx(S[key].PM_deg, 2)}°`, `0–${fx(S[key].bands[0][1], 2)} MHz`, fx(S[key].bands[0][2], 3)])}
      />
      <p>
        <Claim kind="exact" />
        PM 越大反號帶越窄越淺，但只要是 Type-II，帶子一定從 DC 開始。keep-out 清單必須涵蓋 loop-gain 的 PVT 角落（L2 在 <Tex>{r`\times0.6`}</Tex>–<Tex>{r`\times1.5`}</Tex> 之間，帶緣從 {fx(S['L2_gain0.6'].bands[0][1], 0)} 移到 {fx(S['L2_gain1.5'].bands[0][1], 0)} MHz）。
      </p>
      <Src>
        <code>params.json</code> 的 <code>sensitivity</code>／<code>typeI_criteria</code>（golden）；同一批設計由 TS port 重算並在 <code>sspll.test.ts</code> 比對（帶緣誤差 <Tex>{r`<2\times10^{-5}`}</Tex> MHz）。
      </Src>

      <h3>6.6 動手觀察</h3>
      <HpdExplorer />
      <TryIt
        items={[
          <>預設 L2：紅底從 DC 延伸到 closed form 的 <Tex>{'f_{inv}'}</Tex>；把 PM 目標從 60° 拉到 45°，帶緣右移、谷底加深；拉到 75° 帶子變窄，但<strong>左端永遠黏在 DC</strong>。</>,
          <>把 loop gain 倍率拉到 0.6 與 1.5：帶緣跟著移動（PVT）；這就是 keep-out 要留 margin 的原因。</>,
          <>切到 L1：整條 <Tex>{r`\mathrm{Re}H\ge0`}</Tex>。把延遲改成 5 拍，或加 200 MHz 寄生極點：Type-I 也出現反號帶（判據值 &gt; 1）。</>,
          <>
            打開「疊上一階差分的 <Tex>{r`\mathrm{Re}\,\Gamma_{\rm eff}`}</Tex>」：1 拍延遲的 L2／L3 不管怎麼改 PM、gain，那條線都不會掉到 0 以下（需 <Tex>{r`K_i\le2K_p`}</Tex>）。但把 L1 的延遲加到 5 拍，指標列的「一階差分的 margin」會變成負的——1diff
            的保證也依賴迴路（§11.1）。
          </>,
          <>切到 L3，比較三種取樣映射：帶緣只差 2 MHz 左右，但 PM 差 6°。</>,
        ]}
      />
      <ModeGate min="engineer">
        <ModelCompare
          layout="tabs"
          items={[
            { label: '反號帶的掃描', region: 'inversionBands', note: '符號只看 $1+\\mathrm{Re}\\,L$；帶緣用二分法。' },
            { label: 'L2 帶緣的 closed form', region: 'bandEdge', note: '$f_{inv}=\\tfrac{f_{ref}}{\\pi}\\arcsin\\sqrt{K_i/(2(2-K_p))}$' },
            { label: 'L1 的 K', region: 'typeIK', note: '$\\lvert T(\\Omega_3)\\rvert^2=\\tfrac12$ 的 closed form。' },
          ]}
        />
      </ModeGate>
    </Section>
  )
}
