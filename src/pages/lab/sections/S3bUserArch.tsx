import { useMemo } from 'react'
import { Callout, ClaimTag, HandCalc, ModeGate, ModelLevel, Prereq, Section, SourceTag, Tex, TexBlock, ChRef, ErratumLink } from '@/components'
import { PHOS_PATTERN } from '@/simulation/models/unifiedLab'
import { Diagram, md, sig, Steps, texHz, texNum } from '../common'
import { CHART_PMUX9 } from '../diagrams'
import { FORMULAS } from '../formulas'
import { HANDCALCS } from '../handcalcs'
import { cppll3Numbers, pmuxNumbers } from '../numbers'

const T = String.raw

/** 公式登錄（formulas.ts）裡的 TeX：頁面上的 TexBlock 與 /formulas 的登錄表用同一份，不會不同步 */
const ftex = (id: string): string => {
  const f = FORMULAS.find((x) => x.id === id)
  if (!f) throw new Error(`未登錄的公式 ${id}`)
  return f.tex
}

const hc = (id: string) => {
  const d = HANDCALCS.find((h) => h.id === id)
  if (!d) throw new Error(`未登錄的手算題 ${id}`)
  return d
}

/**
 * §5b（wave 5）：使用者的架構。Lab 原本只有一個 DTC gain（gos_only）與 none / Type-I / Type-II 三種主迴路；
 * 這一節把案例頁 /case/sspll 的架構接進來：8 相 PMUX 在回授、input DTC 只補一個相位步、9 個權重（PHOS × 8 + GOS）各自一個 GMAC，
 * 以及三階 CPPLL（charge pump + 二階濾波）的反號帶；另外交代 regressor 正負號的 spec / legacy 選項。
 * 數字全部由 numbers.ts 即時算（pmuxNumbers、cppll3Numbers），公式 F-LAB.19–21，手算題 HC-LAB.1、HC-LAB.2。
 */
export function S3bUserArch() {
  const pm = useMemo(() => pmuxNumbers(), [])
  const cp = useMemo(() => cppll3Numbers(), [])
  const band = cp.bands[0]
  return (
    <section aria-labelledby="lab-s5b" id="lab-s5b-section">
      <h2 id="lab-s5b">5b｜使用者的架構：8 相 PMUX + GOS 的 9 個權重、三階 CPPLL、regressor 的正負號</h2>
      <p>
        前面幾節的 Lab 只有<strong>一個</strong>要校正的數（DTC gain），主迴路是 none / Type-I / Type-II。使用者的晶片不是這樣：回授路徑上是 <strong>8 相 PMUX</strong>，input DTC 只補一個相位步（
        <Tex>{'\\Delta=T_{\\mathrm{vco}}/8'}</Tex>）以內的量，所以要同時校正 8 個 PMUX 相位 offset（PHOS）與 1 個 DTC gain（GOS），一共 <strong>9 個權重</strong>；案例頁 <ChRef ch="07b">/case/sspll</ChRef>{' '}
        分析的就是這個架構。這一節把它接進 Lab：三個分頁（Pipeline、FCW sweep、Monte Carlo）都能跑 9 個權重，另外加上三階 CPPLL 的主迴路，以及 regressor 正負號的選項。所有晶片數字都是示意{' '}
        <SourceTag kind="illustrative" />。
      </p>

      {/* ---------- 5b.1 ---------- */}
      <Section kind="assumptions" title="5b.1　regressor 的正負號：spec 與 legacy 只差一個鏡像" id="lab-s5b1">
        <p>
          <ModelLevel level="L2" /> <ClaimTag kind="exact" /> 全站的約定（<code>docs/assumptions.md</code> §2a）是 <Tex>{'x=s/M\\ge0'}</Tex>：code 越大，feedback edge 越早到。本頁原本的 code 是 DSM 的原始餘數{' '}
          <Tex>{'r=-s/M\\le0'}</Tex>（§4.2、§4.3），差一個負號。從這一輪起，參數面板第 ② 組多了「regressor 正負號」：<strong>spec</strong> 照 §2a 用 <Tex>{'x=-r'}</Tex>；<strong>legacy</strong> 是既有的{' '}
          <Tex>{'x=r'}</Tex>。既有的 preset 全部標 legacy（數字一位都不變），新的 preset 用 spec。
        </p>
        <Steps
          title="為什麼兩種正負號給出一模一樣的 $w_k$、$G_k$ 與 $\sigma_w$"
          steps={[
            { tex: T`x_{\mathrm{spec}}=-x_{\mathrm{leg}}`, why: '四種正規化都是 $x=(r-o)s$，而 $-r$ 的平均變號、RMS 與標準差不變，所以 $o$ 變號、$s$ 不變，結果恰好是 $-x_{\\mathrm{leg}}$（IEEE 的減法對負號對稱，連捨入都相同）。' },
            { tex: T`e_{\mathrm{spec}}=(a-w)(-x_{\mathrm{leg}})+o_{\mathrm{DTC}}+c_2x_{\mathrm{leg}}^2-c_3x_{\mathrm{leg}}^3`, why: '把 $x_{\\mathrm{spec}}$ 代進 $e_{\\mathrm{DTC}}=(a-w)x+o_{\\mathrm{DTC}}+c_2x^2+c_3x^3$：奇次項變號、偶次項不變。' },
            { tex: T`e_{\mathrm{spec}}=\bigl((-a)-(-w)\bigr)x_{\mathrm{leg}}+o_{\mathrm{DTC}}+c_2x_{\mathrm{leg}}^2+(-c_3)x_{\mathrm{leg}}^3`, why: '同一個式子也可以讀成：legacy 的 code、但 $a$、$w$、$c_3$ 都變號。所以 spec 的模擬 $=$ legacy 的模擬把 $a$、$w_0$、$c_3$ 變號，再把 $w$ 變號讀出來。' },
            { tex: T`G_{\mathrm{spec}}=\tfrac1N\sum q\,x_{\mathrm{ref,spec}}=-G_{\mathrm{leg}},\qquad w_{\mathrm{spec},k+1}=w_{\mathrm{spec},k}+\mu G_{\mathrm{spec}}=-(w_{\mathrm{leg},k}+\mu G_{\mathrm{leg}})`, why: '$q$ 相同（$e$ 相同）、regressor 變號 ⇒ $G$ 變號；更新式對 $w\\to-w$ 封閉。$C=E[x_{\\mathrm{ref}}u_x]$ 兩個因子一起變號，不變；$K_q$、$g$、$\\rho$、$\\sigma_w$ 都不含 $x$ 的正負號。' },
          ]}
          result={T`w^{\mathrm{spec}}_k\equiv w^{\mathrm{leg}}_k\big|_{a,w_0,c_3\to-a,-w_0,-c_3}\cdot(-1)\quad\text{（逐位元；定點 unsigned 暫存器除外）}`}
        />
        <p className="small">
          Lab 的做法：legacy + 單一 gain 仍由 <code>runBlockLms</code> 執行（和以前完全相同）；其他組合由同一個 inner loop 推廣成 <Tex>P</Tex> 個權重的 <code>runLabLoop</code> 執行。spec 的「跨級一致性」檢查就是上面最後一行：用變號的
          legacy <code>runBlockLms</code> 當鏡像，逐位元比對 <Tex>{'G_k'}</Tex>（容差 0）。會變的只有畫出來的 <Tex>{'x'}</Tex>、<Tex>{'e_{\\mathrm{DTC}}'}</Tex>、<Tex>{'t_{\\mathrm{out}}'}</Tex>（鏡像）與 offset、
          <Tex>{'c_2'}</Tex> 相對 <Tex>x</Tex> 的方向。
        </p>
      </Section>

      {/* ---------- 5b.2 ---------- */}
      <Section kind="diagram" title="5b.2　8 相 PMUX + input DTC：9 個權重各自一個 GMAC" id="lab-s5b2">
        <p>
          <ModelLevel level="L3" /> <ClaimTag kind="approx" /> 把分數相位以 <Tex>{'\\Delta=T_{\\mathrm{vco}}/8'}</Tex> 為單位來算：整數部分選 PMUX 的相位，小數部分交給 DTC。PMUX 第 <Tex>p</Tex> 相的 edge 比理想時刻多早到{' '}
          <Tex>{'\\varepsilon_p'}</Tex>（8 個 offset），DTC 的補償量是 <Tex>{'w_g\\,x+w_p'}</Tex>。PD 看到的還是「需要補的減掉實際補的」，只是多了 8 個 one-hot 的項。先看圖，再看式子。
        </p>
        <Diagram
          chart={CHART_PMUX9}
          caption="使用者的架構：累加器的整數部分選 PMUX 的相位、小數部分給 input DTC；PD 看到兩條 edge 的差，經主迴路到 PD 的輸出後 comparator 取正負號，同一個 1-bit 輸出同時餵 9 個 GMAC（藍色）。PHOS 的共模方向（棕色）被主迴路當成靜態相位偏移吸收，不可觀測。"
          ariaLabel="8 相 PMUX 加 input DTC 的 9 個權重方塊圖：累加器分出 PMUX 相位與 DTC code，PD 看到需要補的減掉實際補的，comparator 的 1-bit 輸出同時餵 GOS 與 8 個 PHOS 的 GMAC，共模方向不可觀測"
        >
          <p>
            先看最上面的累加器：它跑的是 <Tex>{'8\\alpha'}</Tex>（不是 <Tex>{'\\alpha'}</Tex>），每個 reference 週期前進 <Tex>{'8\\alpha'}</Tex> 個相位步。整數部分累積成 PMUX 的總指標 <Tex>{'P[n]'}</Tex>，取{' '}
            <Tex>{'\\bmod 8'}</Tex> 就是這一拍選的相位 <Tex>{'p[n]'}</Tex>；小數部分 <Tex>{'x[n]'}</Tex> 是 DTC 要補的量（以 <Tex>{'\\Delta'}</Tex> 計）：一階 DSM 時 <Tex>{'x[n]\\in[0,1)'}</Tex>（spec 的 <Tex>{'x\\ge0'}</Tex>）；preset 用的 MASH 1-1-1 是二階整形的餘數，<Tex>{'x'}</Tex> 會是負的、落在 <Tex>{'(-2,2)'}</Tex>（這個 preset 實測約 <Tex>{'[-1.85,\\,1.99]'}</Tex>）。
          </p>
          <p>
            圖上的加法點就是 PD：PMUX 那條線是「需要補的量」<Tex>{'a\\,x+\\varepsilon_p'}</Tex>（＋；分數相位 <Tex>{'x\\Delta'}</Tex> 已由 DTC 的標稱 gain 抵消，剩下的是 gain 誤差 <Tex>{'a\\,x'}</Tex> 與第 <Tex>p</Tex> 相的 offset），DTC 那條線是「實際補的量」<Tex>{'w_g x+w_p'}</Tex>（−），差就是{' '}
            <Tex>{'e_{\\mathrm{DTC}}=(a-w_g)x+(\\varepsilon_p-w_p)'}</Tex>。接下來和 §2 的九級一樣：<Tex>{'H_{\\mathrm{PD}}'}</Tex>、comparator、GMAC——只是 GMAC 有 9 個，PHOS 的 regressor 是「這一拍是不是第 <Tex>p</Tex> 相」的
            one-hot，GOS 的 regressor 仍是 <Tex>{'x_{\\mathrm{ref}}'}</Tex>。
          </p>
          <p>
            最下面棕色那一條是這個架構最重要的「看不見」：8 個 one-hot 加起來恆等於 1，所以 8 個 PHOS 權重一起加同一個常數時 PD 看到的只是一個 DC，而 Type-I / II / CPPLL 的 <Tex>{'H_{\\mathrm{PD}}(1)=0'}</Tex> 把它濾掉（
            <ErratumLink id="E04" />）。這個共模方向沒有恢復力，由初值與暫態決定；真正有意義的是<strong>去共模</strong>的 PHOS 殘差。
          </p>
        </Diagram>
        <Steps
          title="相位索引與 DTC code 怎麼從累加器來；9 個權重的誤差"
          steps={[
            { tex: T`\Phi[n]=8\alpha\,(n+1)=\lfloor8\alpha\rfloor(n+1)+(8\alpha\bmod 1)(n+1)`, why: '以 $\\Delta$ 為單位的分數相位；整數部分每拍固定前進 $\\lfloor8\\alpha\\rfloor$ 相，小數部分交給跑在 $(8\\alpha\\bmod 1)$ 的 DSM。' },
            { tex: T`P[n]=\lfloor8\alpha\rfloor(n+1)+\sum_{m\le n}y[m],\qquad p[n]=P[n]\bmod 8`, why: 'DSM 的輸出 $y$ 是「這一拍多吞幾個相位步」；累積起來就是 PMUX 的總指標，取餘數得到相位。MASH 的 $y$ 可以是負的，所以 $P$ 會前後擺。' },
            { tex: T`x[n]=\Phi[n]-P[n]=-r'[n]`, why: '相位裡 PMUX 沒補的那一部分就是 DTC 要補的量；它恰好是 DSM residue 的負值（一階時 $\\in[0,1)$）。pmuxOrder = random 時 $p$ 再轉 $m[n]$、$x$ 加 $m[n]$（DTC 範圍要大 8 倍，研究延伸）。' },
            { tex: T`e_{\mathrm{DTC}}[n]=\bigl(a\,x+\varepsilon_{p}\bigr)-\bigl(w_g x+w_p\bigr)+d(x)=(a-w_g)\,x+(\varepsilon_p-w_p)+d(x)`, why: '需要補的減掉實際補的：分數相位 $x\\Delta$ 由 DTC 的標稱 gain（每單位 code 一個 $\\Delta$）抵消，剩下要補的是 DTC 的 gain 誤差 $a\\,x$（$a$ 以 fs per $\\Delta$ 計）與第 $p$ 相的 offset $\\varepsilon_p$；實際補的是校正量 $w_g x+w_p$。$d(x)$ 是 DTC 的 offset 與 INL。' },
          ]}
          result={T`e_{\mathrm{DTC}}=\boldsymbol\delta^{\mathsf T}\boldsymbol\phi+d(x),\qquad \boldsymbol\phi=[1\{p=0\},\dots,1\{p=7\},\ x]^{\mathsf T},\qquad \boldsymbol\delta=[\varepsilon_0-w_0,\dots,\varepsilon_7-w_7,\ a-w_g]^{\mathsf T}`}
        />
        <TexBlock id="F-LAB.19" label={md('9 個權重的誤差是 $\\boldsymbol\\delta^{\\mathsf T}\\boldsymbol\\phi$：基底是 8 個 one-hot 與 $x$。PHOS 的 $\\varepsilon_p$ 以 feedback edge 早到為正（docs/assumptions.md §4）。')}>
          {ftex('F-LAB.19')}
        </TexBlock>
        <Prereq title="矩陣的「可觀測子空間」（接 §5.5 的秩）">
          <p>
            {md(
              '§5.5 說過：有一個方向「怎麼動，所有相關器都看不出差別」就是秩不足。這裡那個方向是明確的——8 個 PHOS 一起偏同一個常數。把資訊矩陣 $R_u=E[\\boldsymbol\\phi_u\\boldsymbol\\phi_u^{\\mathsf T}]$（$\\boldsymbol\\phi_u=H_{\\mathrm{PD}}\\{\\boldsymbol\\phi\\}$）對角化，特徵值為 0 的方向就是看不見的；其餘特徵向量張成的空間叫**可觀測子空間**，條件數、$\\mu$ 上限、PE 都只在那裡算（看不見的方向本來就不該要求它收斂）。',
            )}
          </p>
        </Prereq>
        <Steps
          title="9 個權重的平均模型：從 §5.5 的 Jacobian 到 poles 與穩態共變異"
          steps={[
            { tex: T`E[\mathbf G_k]\approx J\,\boldsymbol\delta_{k-d},\qquad J=K_q\,E\bigl[\boldsymbol\psi\,\boldsymbol\phi_u^{\mathsf T}\bigr]`, why: '§5.5 的多參數 Jacobian，基底換成 one-hot 與 $x$；$\\boldsymbol\\psi$ 是 GMAC 實際用的 regressor（raw / delayed / filtered），$d$ 是更新延遲。' },
            { tex: T`\boldsymbol\delta_{k+1}=\boldsymbol\delta_k-M\,\mathbf G_k\approx\boldsymbol\delta_k-MJ\,\boldsymbol\delta_{k-d},\qquad M=\operatorname{diag}(\mu_p,\dots,\mu_p,\mu)`, why: '每個權重 $w_j\\leftarrow w_j+\\mu_jG_j$，寫成 $\\boldsymbol\\delta=$ 目標 $-\\ \\mathbf w$ 的形式。$d=0$ 時狀態矩陣 $A=I-MJ$；$d\\ge1$ 時把 $\\boldsymbol\\delta_k,\\dots,\\boldsymbol\\delta_{k-d}$ 疊成增廣狀態。' },
            { tex: T`R_u=V\Lambda V^{\mathsf T},\qquad J_{\mathrm{obs}}=V^{\mathsf T}JV,\qquad \kappa=\frac{\lambda_{\max}}{\lambda_{\min}}\Big|_{\lambda>0}`, why: '把 $J$ 限制到可觀測子空間（去掉共模）再求特徵值與 poles；條件數是可觀測方向上最快與最慢模式的能量比。' },
            { tex: T`\mu_{\max}=\min_i\frac{2\,\mathrm{Re}\,\lambda_i}{|\lambda_i|^2}\quad(\lambda_i\in\operatorname{eig}J_{\mathrm{obs}})`, why: '所有權重共用一個 $\\mu$ 時第 $i$ 個模式的 pole 是 $1-\\mu\\lambda_i$，$|1-\\mu\\lambda|<1\\iff\\mu<2\\mathrm{Re}\\lambda/|\\lambda|^2$；有 $\\mathrm{Re}\\lambda\\le0$ 的模式就是極性錯誤（任何 $\\mu$ 都救不了）。' },
            { tex: T`X=AXA^{\mathsf T}+\frac{MR_\psi M^{\mathsf T}}{N},\qquad \sigma_j=\sqrt{X_{jj}}`, why: 'GMAC 雜訊 $\\boldsymbol\\eta_k$ 的共變異是 $R_\\psi/N$（$q^2=1$、近平衡），穩態 $\\mathrm{Cov}(\\boldsymbol\\delta)$ 是離散 Lyapunov 方程的解（第 10 章的 dlyap）；單一權重時退化成 F-LAB.8。' },
          ]}
          result={T`\text{穩定}\iff\rho(A)<1;\qquad \text{極性正確}\iff\min\mathrm{Re}\,\lambda(J_{\mathrm{obs}})>0;\qquad \sigma_j=\sqrt{X_{jj}}`}
        />
        <TexBlock id="F-LAB.20" label={md('9 個權重的平均模型。Lab 的 Pipeline 分頁顯示 $\\kappa$、$\\min\\mathrm{Re}\\,\\lambda$、$\\rho$ 與每個權重的 $\\sigma_j$；FCW sweep 每點重算（PMUX 序列隨 $\\alpha$ 變）；Monte Carlo 用 Bonferroni CI 同時檢查 9 個權重。')}>
          {ftex('F-LAB.20')}
        </TexBlock>
        <Section kind="example" title="先算一次：$H_{\mathrm{PD}}=1$、8 相等機率、$x$ 均勻時的封閉式" id="lab-s5b2-example" level={4}>
          <p>
            沒有主迴路（<Tex>{'H_{\\mathrm{PD}}=1'}</Tex>）、8 相等機率走訪、<Tex>x</Tex> 與相位獨立時 <Tex>{'R=E[\\boldsymbol\\phi\\boldsymbol\\phi^{\\mathsf T}]'}</Tex> 有封閉式：PHOS 區塊是{' '}
            <Tex>{'\\tfrac18I'}</Tex>、PHOS 與 <Tex>x</Tex> 的耦合是 <Tex>{'E[x]/8'}</Tex>、<Tex>x</Tex> 自己是 <Tex>{'E[x^2]'}</Tex>。7 個「和為 0」的 PHOS 模式和 <Tex>x</Tex> 無關（<Tex>{'\\lambda=\\tfrac18'}</Tex>），剩下 2 維是共模與{' '}
            <Tex>x</Tex> 的混合。用 <Tex>{`E[x]=${pm.Ex}`}</Tex>、<Tex>{`E[x^2]=${texNum(pm.Ex2, 4)}`}</Tex>（<Tex>{'x\\sim U[0,1)'}</Tex>）、<Tex>{`\\sigma_v=${pm.sigmaV}\\,\\mathrm{fs}`}</Tex>、<Tex>{`\\mu=${pm.mu}\\,\\mathrm{fs}`}</Tex>：
          </p>
          <div className="table-wrap">
            <table className="lab-table lab-table-num">
              <caption>9 權重資訊矩陣的封閉式特徵值與它們的意義（數字由 pmuxClosedFormEigen 算出）</caption>
              <thead>
                <tr>
                  <th>模式</th>
                  <th>
                    <Tex>{'\\lambda'}</Tex>
                  </th>
                  <th>
                    <Tex>{'g=\\mu K_q\\lambda'}</Tex>
                  </th>
                  <th>
                    <Tex>{'\\tau=1/g'}</Tex> [block]
                  </th>
                  <th>意義</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">
                    <Tex>{'\\lambda_+'}</Tex>（<Tex>x</Tex> 為主）
                  </th>
                  <td className="mono">{sig(pm.lambdaPlus, 4)}</td>
                  <td className="mono">{sig(pm.gFast, 4)}</td>
                  <td className="mono">{sig(1 / pm.gFast, 4)}</td>
                  <td>最快：GOS 與共模同向的混合</td>
                </tr>
                <tr>
                  <th scope="row">
                    <Tex>{'\\tfrac18'}</Tex>（7 個）
                  </th>
                  <td className="mono">{sig(pm.lambdaPhos, 4)}</td>
                  <td className="mono">{sig(pm.gPhos, 4)}</td>
                  <td className="mono">{sig(1 / pm.gPhos, 4)}</td>
                  <td>PHOS 的 7 個差模（相位之間的差）</td>
                </tr>
                <tr>
                  <th scope="row">
                    <Tex>{'\\lambda_-'}</Tex>（共模與 <Tex>x</Tex> 抵消）
                  </th>
                  <td className="mono">{sig(pm.lambdaMinus, 4)}</td>
                  <td className="mono">{sig(pm.gSlow, 4)}</td>
                  <td className="mono">{sig(1 / pm.gSlow, 4)}</td>
                  <td>最慢：「PHOS 全部加常數、GOS 減一點」幾乎看不見</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="small">
            條件數 <Tex>{`\\kappa=${texNum(pm.cond, 4)}`}</Tex>、共用步長的上限 <Tex>{`\\mu_{\\max}=2/(K_q\\lambda_{\\max})=${texNum(pm.muMax, 4)}\\,\\mathrm{fs}`}</Tex>。最慢的那個模式正是有主迴路時會變成<strong>不可觀測</strong>的共模方向（
            <Tex>{'H_{\\mathrm{PD}}(1)=0'}</Tex> 把它濾掉）——所以有主迴路時反而乾淨：Lab 把它從 <Tex>{'\\kappa'}</Tex> 拿掉，條件數只看剩下的 8 個模式。這也是為什麼 Lab 讓 PHOS 與 GOS 各用自己的步長（<Tex>{'\\mu_p'}</Tex> 與 <Tex>{'\\mu'}</Tex>
            ）：最簡單的 diagonal preconditioning（<ChRef ch="10">第 10 章</ChRef>）。
          </p>
          <HandCalc def={hc('HC-LAB.1')} />
        </Section>
        <ModeGate min="engineer" summary="PHOS 圖樣、PMUX 旋轉頻率與反號帶的關係">
          <Callout kind="info" title="Lab 的 PHOS 圖樣與「PMUX 旋轉頻率落在反號帶」">
            <p>
              {md(
                `PHOS 的 8 個 offset 是固定圖樣乘上可調的 RMS（illustrative；analysis/sspll/sim 的 seed-7：$\\varepsilon_0\\dots\\varepsilon_3$ 是 $[${PHOS_PATTERN.slice(0, 4).map((v) => texNum(v, 3)).join(',\\ ')}]$、$\\varepsilon_4\\dots\\varepsilon_7$ 是 $[${PHOS_PATTERN.slice(4).map((v) => texNum(v, 3)).join(',\\ ')}]$，再乘上 $\\sigma_\\varepsilon$；去共模、RMS 為 1）。PHOS 的 mode-1 regressor 以 PMUX 的旋轉頻率 $\\alpha f_{\\mathrm{ref}}$（折回 $[0,f_s/2]$）旋轉：它落在主迴路的反號帶（$\\mathrm{Re}\\,H_{\\mathrm{PD}}<0$）內時 $J_{\\mathrm{obs}}$ 就出現 $\\mathrm{Re}\\,\\lambda<0$ 的模式——這就是案例頁 §8 的 PHOS 反號。FCW sweep 分頁每點重算 PMUX 序列，把這些點標出來；對策（一階差分 regressor、MASH、隨機旋轉）在案例頁 §11。`,
              )}
            </p>
          </Callout>
        </ModeGate>
      </Section>

      {/* ---------- 5b.3 ---------- */}
      <Section kind="formula" title="5b.3　三階 CPPLL：由 PM 與第三極點比設計，反號帶有封閉式" id="lab-s5b3">
        <p>
          <ModelLevel level="L2" /> <ClaimTag kind="exact" /> 傳統的 charge-pump PLL 用 <Tex>{'R\\|C_1'}</Tex> 加一個 <Tex>{'C_2'}</Tex> 的二階濾波，閉迴路是三階：兩個積分器（CP + VCO）、一個零點、一個第三極點。Lab 的設計參數是閉迴路{' '}
          <Tex>{'|T|'}</Tex> 的 <Tex>{'-3\\,\\mathrm{dB}'}</Tex> 頻寬、連續時間 crossover 處的 phase margin，以及第三極點比 <Tex>{'r_p=\\omega_{p3}/\\omega_c'}</Tex>（案例頁的 L3 是 <Tex>{'r_p=\\sqrt b'}</Tex> 的對稱放置；這裡把 PM 與{' '}
          <Tex>{'r_p'}</Tex> 分開可調）。取樣用 impulse-invariant（CP 的電荷包是 impulse、每個 reference 週期取樣一次），和案例頁 L3 的 impulse 映射完全相同。
        </p>
        <Steps
          title="從 $\mathrm{PM}$ 與 $r_p$ 到 $L(z)$，再到反號帶"
          steps={[
            { tex: T`\mathrm{PM}=\arctan\frac{\omega_c}{\omega_z}-\arctan\frac{\omega_c}{\omega_p}\ \Rightarrow\ \tan\theta_z=\frac{\omega_c}{\omega_z},\quad \theta_z=\mathrm{PM}+\arctan\frac1{r_p}`, why: '三階迴路在 crossover 的相位是 $-180^\\circ+\\arctan(\\omega_c/\\omega_z)-\\arctan(\\omega_c/\\omega_p)$；把 $\\omega_p=r_p\\omega_c$ 代入、移項就得到零點（要求 $\\theta_z<90^\\circ$）。' },
            { tex: T`|L(j\omega_c)|=1\ \Rightarrow\ K=\omega_c^2\sqrt{1+\tfrac1{r_p^2}}\cos\theta_z`, why: '$|L|=K\\sqrt{1+(\\omega_c/\\omega_z)^2}\\big/\\bigl(\\omega_c^2\\sqrt{1+(\\omega_c/\\omega_p)^2}\\bigr)$，而 $\\sqrt{1+\\tan^2\\theta_z}=1/\\cos\\theta_z$。' },
            { tex: T`l(t)=Kt+B\bigl(1-e^{-\omega_pt}\bigr),\qquad B=\frac{K(\omega_p/\omega_z-1)}{\omega_p}`, why: '把 $L(s)$ 拆成部分分式再反拉氏：雙積分給斜坡、零點與第三極點那一對給一個指數趨近的常數。' },
            { tex: T`L(z)=\sum_{n\ge1}l(n)z^{-n}=\frac{Kz^{-1}}{(1-z^{-1})^2}+\frac{Bz^{-1}}{1-z^{-1}}-\frac{Bpz^{-1}}{1-pz^{-1}},\qquad p=e^{-\omega_p}`, why: 'impulse-invariant：電荷包在 $nT$ 注入、$(n+1)T$ 比較，所以 $L(z)$ 嚴格 proper（自然帶一拍延遲，$h_{\\mathrm{PD}}[0]=1$）；三個等比級數各自求和。' },
            { tex: T`-\mathrm{Re}\,L(\Omega)=\frac{K}{4\sin^2(\Omega/2)}+\frac{B(1-p^2)}{2|1-pe^{-j\Omega}|^2}`, why: '$\\mathrm{Re}\\{z^{-1}/(1-z^{-1})^2\\}=-1/(4\\sin^2(\\Omega/2))$、$\\mathrm{Re}\\{z^{-1}/(1-z^{-1})\\}=-\\tfrac12$、$\\mathrm{Re}\\{pz^{-1}/(1-pz^{-1})\\}=(p\\cos\\Omega-p^2)/|1-pe^{-j\\Omega}|^2$，合併後第二項是 $B(1-p^2)/(2|1-pe^{-j\\Omega}|^2)$。兩項都隨 $\\Omega$ 單調遞減。' },
            { tex: T`\mathrm{Re}\,H_{\mathrm{PD}}=\frac{1+\mathrm{Re}\,L}{|1+L|^2}<0\iff-\mathrm{Re}\,L>1`, why: '案例頁 §6 的恆等式：分母是正的，正負號只看 $1+\\mathrm{Re}\\,L$。單調遞減 ⇒ 反號帶是從 DC 到 $-\\mathrm{Re}\\,L=1$ 的唯一根 $f_{\\mathrm{inv}}$。' },
          ]}
          result={T`f_{\mathrm{inv}}:\ -\mathrm{Re}\,L(2\pi f_{\mathrm{inv}}/f_{\mathrm{ref}})=1,\qquad \mathrm{Re}\,H_{\mathrm{PD}}<0\ \text{for}\ 0<f<f_{\mathrm{inv}}`}
        />
        <TexBlock id="F-LAB.21" label={md(`例：$|T|$ 的 $-3\\,\\mathrm{dB}=${texHz(cp.bwHz, 3)}$、$\\mathrm{PM}=${cp.pmDeg}^\\circ$、$r_p=${cp.p3Ratio}$、$f_{\\mathrm{ref}}=${texHz(cp.fRefHz, 3)}$ ⇒ $f_c=${texHz(cp.c.fcCtHz, 4)}$、$f_z=${texHz(cp.c.fzHz, 4)}$、$f_{p3}=${texHz(cp.c.fpHz, 4)}$，反號帶 $[0,\\,${texHz(cp.fInvHz, 4)}]$。`)}>
          {ftex('F-LAB.21')}
        </TexBlock>
        <div className="table-wrap">
          <table className="lab-table lab-table-num">
            <caption>{md(`三階 CPPLL 的設計例（$|T|$ 的 $-3\\,\\mathrm{dB}=${texHz(cp.bwHz, 3)}$、$\\mathrm{PM}=${cp.pmDeg}^\\circ$、$r_p=${cp.p3Ratio}$、$f_{\\mathrm{ref}}=${texHz(cp.fRefHz, 3)}$；數字由 cppll3Numbers 算出，illustrative）`)}</caption>
            <thead>
              <tr>
                <th>量</th>
                <th>值</th>
                <th>說明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">
                  <Tex>{'f_c,\\ f_z,\\ f_{p3}'}</Tex>
                </th>
                <td className="mono">
                  {sig(cp.c.fcCtHz / 1e6, 4)} / {sig(cp.c.fzHz / 1e6, 4)} / {sig(cp.c.fpHz / 1e6, 4)} MHz
                </td>
                <td>連續時間的 crossover、零點、第三極點（二分法調 <Tex>{'\\omega_c'}</Tex> 讓實際 DT 的 <Tex>{'-3\\,\\mathrm{dB}'}</Tex> 等於設定值）</td>
              </tr>
              <tr>
                <th scope="row">
                  <Tex>{'K,\\ B,\\ p'}</Tex>
                </th>
                <td className="mono">
                  {sig(cp.c.K, 5)} / {sig(cp.c.B, 5)} / {sig(cp.c.p, 5)}
                </td>
                <td>impulse-invariant 的三個係數（rad/sample、<Tex>{'T_s=1'}</Tex>）</td>
              </tr>
              <tr>
                <th scope="row">
                  <Tex>{'f_{\\mathrm{inv}}'}</Tex>（反號帶上緣）
                </th>
                <td className="mono">{sig(cp.fInvHz / 1e6, 4)} MHz</td>
                <td>
                  <Tex>{'-\\mathrm{Re}\\,L=1'}</Tex> 的根；數值的 <code>inversionBands</code> 給 {band ? `[${sig(band.fLoHz / 1e6, 3)}, ${sig(band.fHiHz / 1e6, 4)}] MHz，最負 ${sig(band.minReH, 3)}` : '（無）'}（兩者一致）
                </td>
              </tr>
              <tr>
                <th scope="row">
                  <Tex>{'-\\mathrm{Re}\\,L'}</Tex> 在 <Tex>{`f=${sig(cp.fTestHz / 1e6, 3)}\\,\\mathrm{MHz}`}</Tex>
                </th>
                <td className="mono">
                  {sig(cp.test.term1, 4)} + {sig(cp.test.term2, 4)} = {sig(cp.test.total, 4)}
                </td>
                <td>{cp.test.total > 1 ? '> 1：在反號帶內' : '< 1：在反號帶外'}（HC-LAB.2 的預設）</td>
              </tr>
              <tr>
                <th scope="row">sampled-data crossover / PM</th>
                <td className="mono">
                  {sig(cp.fcSampledHz / 1e6, 4)} MHz / {sig(cp.pmSampled, 4)}°
                </td>
                <td>
                  取樣後（含一拍延遲）的實際值，由 <code>loopMargins</code> 算；和連續時間的 {cp.pmDeg}° 不同
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <HandCalc def={hc('HC-LAB.2')} />
        <p className="small">
          PllDesign 現在對每一種主迴路都附上反號帶（<code>inversionBands</code>，案例頁的做法）與 sampled-data 的 crossover / PM：Type-I 沒有反號帶、Type-II 與 CPPLL 從 DC 起有一段。Lab 的 PLL 卡片會列出來，FCW sweep
          會標出 PMUX 旋轉頻率落在帶內的點。到 Lab 載入 preset「使用者的架構」（4 GHz、320 MHz、8 相、MASH；主迴路就是案例頁的 L3，反號帶 <Tex>{'[0,\\,117.3]\\,\\mathrm{MHz}'}</Tex>）看三個分頁。再把
          code 來源改成一階 DSM、<Tex>{'\\alpha'}</Tex> 改到 0.01–0.025（<Tex>{'\\alpha f_{\\mathrm{ref}}=40'}</Tex>–<Tex>{'100\\,\\mathrm{MHz}'}</Tex>，在反號帶內），9 權重的 <Tex>{'\\min\\mathrm{Re}\\,\\lambda'}</Tex> 變負、
          <Tex>{'\\rho>1'}</Tex>：PHOS mode-1 反號；換回 MASH 又回到正值——MASH 什麼時候救得回來、什麼時候落在 dead zone，判定式在案例頁 §10b（Lab 只算線性化的 <Tex>{'J_{\\mathrm{obs}}'}</Tex>，沒有算大訊號的相關）。
        </p>
      </Section>
    </section>
  )
}
