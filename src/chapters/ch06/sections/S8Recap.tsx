import { useMemo } from 'react'
import { ClaimTag, Quiz, Recap, Tex, TexBlock } from '@/components'
import { calPole, ctHpd, kqFromSigma, naiveCtWhiteCorrelation, toneCorrelation } from '@/simulation/models/polarity'
import { ChapterDiagram, ChapterHandCalc, ChapterSection, fx, radOf } from '../shared'

/** §8 演算法比較、思考題、本課必記、硬體對應與下一個問題 */
export function S8Recap() {
  const q2 = useMemo(() => {
    const C = toneCorrelation({ A: 1, mag: 0.8, phiRad: radOf(150), omega: 0.4 })
    const Kq = kqFromSigma(50)
    return { C, Kq, p: calPole(5, Kq, C) }
  }, [])
  const h2 = ctHpd('typeII', 2, 0.7)
  const naive01 = useMemo(() => naiveCtWhiteCorrelation('typeII', 0.1, 0.7), [])

  return (
    <ChapterSection id="ch06-s8" kicker="§8" title="比較、綜合手算、思考題與本課必記">
      <h3>
        怎麼讓 <Tex>{'C'}</Tex> 變回正的？三種 regressor 的比較（第 07 章詳述）
      </h3>
      <p>
        極性錯了，要改的是 GMAC 拿來相乘的那個訊號（regressor），不是 <Tex>{'\\mu'}</Tex>。常見的選擇有三種，先看圖再看表：
      </p>
      <ChapterDiagram id="D-06.25">
        <p>
          三個乘法器拿的都是同一個 comparator 輸出 <Tex>{'q[n]'}</Tex>（它的誤差裡含的是 <Tex>{'u=h*x'}</Tex>），差別只在另一個輸入：raw-x 直接用原始 code；delayed-x
          多一個 <Tex>{'D'}</Tex> 拍的延遲（藍色）；filtered-x 先讓 code 通過主 PLL 的模型 <Tex>{'\\hat h'}</Tex>（藍色），得到 <Tex>{'u_f=\\hat h*x'}</Tex>。
        </p>
        <p>
          每個乘法器的輸出取 block 平均之後，就是那一種 GMAC 的平均輸出 <Tex>{'E[G]\\approx K_q\\,\\delta\\times(\\text{相關})'}</Tex>（§3 的 F-06.2）；<Tex>{'K_q'}</Tex> 與{' '}
          <Tex>{'\\delta'}</Tex> 三種都一樣，所以最下面三格只寫出各自的「相關」，更新方向就看它的正負。
          圖上最下面的三格就是下表「相關」那一欄：raw-x 是本章的 <Tex>{'C=E[x\\,u]'}</Tex>；delayed-x 是 <Tex>{'C_D=E\\big[x[n-D]\\,u[n]\\big]'}</Tex>（單頻時正比於{' '}
          <Tex>{'\\cos(\\phi+\\Omega D)'}</Tex>，一個 <Tex>{'D'}</Tex> 只能對準一個頻率）；filtered-x 是 <Tex>{'E[u\\,u_f]'}</Tex>，模型準（<Tex>{'\\hat h=h'}</Tex>）時等於{' '}
          <Tex>{'E[u^2]\\ge0'}</Tex>。
        </p>
      </ChapterDiagram>
      <div className="table-wrap">
        <table className="ch06-table">
          <thead>
            <tr>
              <th>GMAC regressor</th>
              <th>相關</th>
              <th>需要知道</th>
              <th>硬體成本</th>
              <th>限制</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                raw <Tex>{'x'}</Tex>（本章）
              </td>
              <td>
                <Tex>{'C=\\tfrac{1}{2\\pi}\\int S\\operatorname{Re}H\\,d\\Omega'}</Tex>
              </td>
              <td>什麼都不用</td>
              <td>最低：conditional negate + 累加</td>
              <td>
                主 PLL 相位 <Tex>{'>90^\\circ'}</Tex> 的頻帶有能量就可能變號
              </td>
            </tr>
            <tr>
              <td>
                delayed <Tex>{'x[n-D]'}</Tex>
              </td>
              <td>
                <Tex>{'\\tfrac{1}{2\\pi}\\int S\\operatorname{Re}\\{He^{j\\Omega D}\\}d\\Omega'}</Tex>
              </td>
              <td>主要激勵頻率的相位</td>
              <td>
                <Tex>{'D'}</Tex> 級 delay register / tap MUX
              </td>
              <td>delay 只提供與頻率成正比的相位；換一個 FCW 就可能失效</td>
            </tr>
            <tr>
              <td>
                filtered-x <Tex>{'u_f=\\hat h*x'}</Tex>
              </td>
              <td>
                <Tex>{'E[u\\,u_f]'}</Tex>（<Tex>{'\\hat H=H'}</Tex> 時 <Tex>{'=E[u^2]\\ge0'}</Tex>）
              </td>
              <td>主 PLL 的模型 <Tex>{'\\hat H'}</Tex></td>
              <td>一個數位濾波器（與 PLL loop filter 同型）</td>
              <td>
                模型誤差夠大（<Tex>{'|\\angle H-\\angle\\hat H|>90^\\circ'}</Tex>）時同樣反向（E45）
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>綜合手算：近整數 FCW 加上一個 sample 的 code delay</h3>
      <p>
        做思考題之前，先把本章的式子串起來算一次：迴路的 <Tex>{'K_i=(\\omega_nT_s)^2'}</Tex>（§5.4）→ 鋸齒 residue 的自相關（F-06.17）→ 近整數的{' '}
        <Tex>{'C_D'}</Tex>（F-06.14、F-06.18）→ <Tex>{'K_q'}</Tex> 與 pole（§3）。這一題回答一個很實際的問題：
        <strong>GMAC 的 regressor 只比 PD 誤差晚一個 sample，raw-x LMS 的極性會不會反過來？</strong>
      </p>
      <ChapterDiagram id="D-06.26">
        <p>
          跟著圈號算。先算 ①：把 <Tex>{'\\omega_nT_s'}</Tex> 平方得到積分增益 <Tex>{'K_i'}</Tex>，⑤ 的門檻 <Tex>{'D^*=\\mathrm{frac}/K_i'}</Tex>（圖上寫成 D⋆）與 ⑦ 的二階項都要用到它；⑥ 的一階項只和{' '}
          <Tex>{'\\mathrm{frac}'}</Tex>、<Tex>{'D'}</Tex> 有關。再把 ⑥ 和 ⑦ 相加得到 ⑧ 的 <Tex>{'C_D/\\sigma_x^2'}</Tex>（藍色）——它的正負號就是這一題的答案。最後 ⑨ 到 ⑪ 接上
          comparator 增益 <Tex>{'K_q'}</Tex> 與 <Tex>{'\\mu'}</Tex>，把它換成 pole。②、③、④ 是檢查用的旁支：<Tex>{'\\Delta'}</Tex> 要遠小於 1，展開才準；
          <Tex>{'R_x[D]'}</Tex> 讓你親手看到鋸齒自相關的一次項。
        </p>
        <p>
          圖上的圈號和下面手算題的步驟編號一一對應：⑧ 就是 F-06.18（<Tex>{'D=0'}</Tex> 時退化成 F-06.14），⑪ 就是 F-06.3 的 <Tex>{'p=1-\\mu K_qC_D'}</Tex>。
        </p>
      </ChapterDiagram>
      <ChapterHandCalc
        id="HC-06.8"
        lead={String.raw`預設值是 §6.4 表格裡 $\mathrm{frac}=5\times10^{-4}$、$D=1$ 的那一格。換成你的 FCW 小數、$\omega_nT_s$（HC-06.6 的結果）、latency $d$ 與 code delay $D$，先用紙筆算門檻 $D^*=\mathrm{frac}/K_i$ 與 $C_D$ 的正負號，再把 $D$ 改成 0 重算一次比較。`}
      />

      <Quiz
        title="思考題 2（計算）"
        question={
          <>
            單頻 code（<Tex>{'A=1'}</Tex>），PLL 在該頻率 <Tex>{'|H|=0.8'}</Tex>、<Tex>{'\\phi=150^\\circ'}</Tex>，GMAC 用 raw <Tex>{'x'}</Tex>。
            <Tex>{'\\mu=5\\,\\mathrm{fs}'}</Tex>、
            <Tex>{'\\sigma_v=50\\,\\mathrm{fs}'}</Tex>。平均 pole 是多少？
          </>
        }
        options={[
          { label: <><Tex>{`p=${fx(1 - (q2.p - 1), 5)}`}</Tex>（收斂）</> },
          { label: <><Tex>{`p=${fx(q2.p, 5)}`}</Tex>（發散）</>, correct: true },
          { label: <><Tex>{'p=1'}</Tex>（臨界）</> },
          { label: <><Tex>{`p=${fx(1 + 5 * q2.Kq * 0.4, 5)}`}</Tex>（發散）</> },
        ]}
        answer={
          <>
            <TexBlock>{String.raw`C=\tfrac{A^2}{2}|H|\cos\phi=0.5\times0.8\times\cos150^\circ=${fx(q2.C, 4)}`}</TexBlock>
            <TexBlock>{String.raw`K_q=\sqrt{2/\pi}/50=${fx(q2.Kq, 6)}\,\mathrm{fs}^{-1},\qquad p=1-\mu K_qC=1+5\times${fx(q2.Kq, 6)}\times${fx(-q2.C, 4)}=${fx(q2.p, 5)}`}</TexBlock>
            <p>
              第一個選項把 <Tex>{'C'}</Tex> 的負號弄丟了；最後一個選項忘了 <Tex>{'|\\cos\\phi|'}</Tex>（只用了 <Tex>{'|H|/2=0.4'}</Tex>）。符號錯的時候，
              <Tex>{'\\mu'}</Tex> 再小也是 <Tex>{'p>1'}</Tex>。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 3（判斷）"
        question={
          <>
            Type-II 主 PLL（<Tex>{'\\zeta=0.7'}</Tex>），code 是 <Tex>{'\\omega=2\\omega_n'}</Tex> 的單頻。raw-x LMS 會怎樣？
          </>
        }
        options={[
          { label: '一定發散，因為 Type-II 有兩個積分器' },
          { label: <>收斂：<Tex>{'\\nu=2>1,\\;\\operatorname{Re}H>0'}</Tex></>, correct: true },
          { label: <><Tex>{'C=0'}</Tex>，沒有恢復力</> },
        ]}
        answer={
          <>
            <TexBlock>{String.raw`\operatorname{Re}H=\frac{-\nu^2(1-\nu^2)}{(1-\nu^2)^2+(2\zeta\nu)^2}=\frac{-4\times(-3)}{9+2.8^2}=\frac{12}{16.84}=${fx(h2.re, 4)}>0`}</TexBlock>
            <p>
              Type-II 只在 <Tex>{'\\omega<\\omega_n'}</Tex>（CT 原型；DT 時邊界略高，E44）反號。高於迴路頻寬的 code，PLL 來不及追，PD 幾乎看到原本的{' '}
              <Tex>{'x'}</Tex>。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 4（觀念）"
        question={
          <>
            白色 <Tex>{'\\pm1'}</Tex> code、DT 主迴路至少有一個 sample 的 loop delay。raw-x GMAC（<Tex>{'D=0'}</Tex>）的 <Tex>{'C'}</Tex> 是多少？
          </>
        }
        options={[
          { label: <><Tex>{'C=h[0]\\,\\sigma_x^2=\\sigma_x^2'}</Tex>（精確）</>, correct: true },
          { label: <><Tex>{'C'}</Tex> 取決於 <Tex>{'\\zeta'}</Tex> 與頻寬</> },
          { label: <><Tex>{`C=${fx(naive01, 3)}\\,\\sigma_x^2`}</Tex></> },
        ]}
        answer={
          <p>
            白色 code 的 <Tex>{'S_{xx}=\\sigma_x^2'}</Tex> ⇒ <Tex>{'C_D=h[D]\\sigma_x^2'}</Tex>（F-06.13）。<Tex>{'L(z)'}</Tex> 嚴格因果 ⇒ <Tex>{'h[0]=1'}</Tex>，
            所以 <Tex>{'C=\\sigma_x^2'}</Tex>，與 <Tex>{'\\zeta'}</Tex>、頻寬無關。<Tex>{fx(naive01, 5)}</Tex> 是把 <Tex>{'\\Omega'}</Tex> 錯代入 CT{' '}
            <Tex>{'H(j\\omega)'}</Tex>（<Tex>{'\\omega_nT_s=0.1'}</Tex>）再積分得到的錯誤值（E44）。
          </p>
        }
      />
      <Quiz
        title="思考題 5（研究）"
        question={
          <>
            FCW 接近整數時，一階 DSM residue 的基頻掉到 Type-II 的反相頻帶裡。為什麼 <Tex>{'C'}</Tex> 只是趨近 <Tex>{'0^+'}</Tex>，而不是變成負的？
          </>
        }
        answer={
          <>
            <p>
              時域答案（§6.4 方法 1）：鋸齒的自相關 <Tex>{'R/\\sigma_x^2=1-6t+6t^2'}</Tex> 有一個<strong>一次項</strong>（來自折返跳變），而 Type-II 的{' '}
              <Tex>{'m_0=m_1=0'}</Tex>（對 DC 與斜坡都零穩態誤差），把常數項與一次項都消掉，只剩二次項：
            </p>
            <TexBlock>{String.raw`\frac{C}{\sigma_x^2}\approx6\,\mathrm{frac}^2\,m_2=\frac{12\,\mathrm{frac}^2}{K_i}=\frac{3}{\pi^2}\Delta^2>0`}</TexBlock>
            <p>
              平滑 code 的 <Tex>{"R/\\sigma_x^2\\approx1-\\tfrac{E[x'^2]}{2\\sigma_x^2}k^2"}</Tex> 二次項是<strong>負</strong>的，所以{' '}
              <Tex>{"C\\approx-E[x'^2]\\,m_2/2<0"}</Tex>——就是 §5.3 的 <Tex>{"E[x\\,x'']=-E[x'^2]"}</Tex>。頻域答案（方法 2）：低次諧波貢獻負的{' '}
              <Tex>{'\\operatorname{Re}H'}</Tex>，折返跳變帶來的高次諧波（<Tex>{'\\operatorname{Re}H\\approx+1'}</Tex>）剛好在一階抵消：
              <Tex>{'\\int_0^\\infty\\operatorname{Re}H(\\nu)/\\nu^2\\,d\\nu=0'}</Tex>。
            </p>
            <p>
              但這只對 <Tex>{'D=0'}</Tex> 成立：regressor 落後 <Tex>{'D\\ge1'}</Tex> 個 sample 時，自相關的一次項 <Tex>{'-6\\,\\mathrm{frac}\\,|k-D|'}</Tex>{' '}
              不再被消掉，<Tex>{'C_D/\\sigma_x^2\\approx-12\\,\\mathrm{frac}\\,D+12\\,\\mathrm{frac}^2/K_i'}</Tex>（F-06.18）——<Tex>{'D>\\mathrm{frac}/K_i'}</Tex> 就變號，越接近整數越容易。
            </p>
            <p>
              另外，「不變號」是<strong>小訊號</strong>的結論。1-bit comparator 下 <Tex>{'C>0'}</Tex> 來自步階響應正、負兩瓣的相消；誤差一大，高的正瓣先被{' '}
              <Tex>{'\\mathrm{erf}'}</Tex> 壓扁，mean-field 特性 <Tex>{'E[G](\\delta)'}</Tex> 在 <Tex>{'\\delta_c'}</Tex> 變號（F-06.19、§6.4 但書 1）——<Tex>{'\\delta=0'}</Tex>{' '}
              只是局部穩定。
            </p>
          </>
        }
      />

      <Recap
        formulas={[
          { label: 'PD 看到的誤差（時間尺度分離）', tex: String.raw`e_{\mathrm{PD}}\approx(a-w)\,u+v,\qquad u=h*x,\qquad H_{\mathrm{PD}}=\frac{1}{1+L}` },
          { label: 'GMAC 平均與 pole', tex: String.raw`E[G]\approx K_q(a-w)\,C_D,\qquad p=1-\mu K_qC` },
          { label: <>單頻（<Tex>{'0<\\Omega<\\pi'}</Tex>）</>, tex: String.raw`C_D=\frac{A^2}{2}|H|\cos(\phi+\Omega D)` },
          { label: '多頻判據', tex: String.raw`C_D=\frac{1}{2\pi}\int_{-\pi}^{\pi}S_{xx}\operatorname{Re}\{He^{j\Omega D}\}\,d\Omega` },
          { label: 'Type-II（CT 原型）', tex: String.raw`\operatorname{Re}H=\frac{-\nu^2(1-\nu^2)}{(1-\nu^2)^2+(2\zeta\nu)^2}<0\;\;(\omega<\omega_n)` },
        ]}
        points={[
          <>
            GMAC 乘的是原始 code <Tex>{'x'}</Tex>，誤差裡卻是被主 PLL 濾過的 <Tex>{'u'}</Tex>；兩者的相關 <Tex>{'C'}</Tex> 決定更新方向。 <ClaimTag kind="exact" />
          </>,
          <>
            <Tex>{'C<0'}</Tex> 時 <Tex>{'p=1+\\mu K_q|C|>1'}</Tex>：<strong>
              減小 <Tex>{'\\mu'}</Tex> 不能修正符號
            </strong>，只能讓發散變慢。
          </>,
          <>
            單頻時符號由 <Tex>{'\\cos(\\phi+\\Omega D)'}</Tex> 決定；<Tex>{'\\pm90^\\circ'}</Tex> 是相關性的符號界線，不是 Bode phase margin。
            <Tex>{'\\Omega=0,\\pi'}</Tex> 是 2 倍的邊界情況（E46）。
          </>,
          <>
            Type-I（無額外 latency）的 <Tex>{'\\operatorname{Re}H'}</Tex> 恆正，只會變慢；Type-II 的 PD 看到慢速誤差的二次微分，
            <Tex>{"E[x\\,x'']=-E[x'^2]<0"}</Tex>，所以平滑的低頻 code 反號。
          </>,
          <>
            多頻時 <Tex>{'C/\\sigma_x^2'}</Tex> 是 <Tex>{'\\operatorname{Re}H'}</Tex> 以 code PSD 加權的平均；計算一律用 DT 的 <Tex>{'H(e^{j\\Omega})'}</Tex>，不可把{' '}
            <Tex>{'\\Omega'}</Tex> 代入 <Tex>{'H(j\\omega)'}</Tex>（E44）。近整數鋸齒 residue 在 <Tex>{'D=0'}</Tex> 時讓 <Tex>{'C\\to0^+'}</Tex>（恢復力消失，而且只是局部穩定：
            <Tex>{'|\\delta|>\\delta_c'}</Tex> 後 mean-field 特性變號，F-06.19），regressor 落後 <Tex>{'D>\\mathrm{frac}/K_i'}</Tex> 個 sample 則在小訊號就變號（F-06.18）。
          </>,
        ]}
      />

      <h3>連結到 PLL 硬體</h3>
      <div className="table-wrap">
        <table className="ch06-table">
          <thead>
            <tr>
              <th>本章的量</th>
              <th>硬體</th>
              <th>設計／驗證時要做的事</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Tex>{'G_k=\\frac1N\\sum q\\,x[n-D]'}</Tex>
              </td>
              <td className="ch06-hw">GMAC：conditional negate + accumulator（REG_GMAC_N）</td>
              <td>
                確認 <Tex>{'q'}</Tex> 的位元極性（<Tex>{'q=2b-1'}</Tex>）、sum / average 的 scaling
              </td>
            </tr>
            <tr>
              <td>
                <Tex>{'D'}</Tex>
              </td>
              <td className="ch06-hw">code delay FIFO / tap MUX（REG_GMAC_CODE_DLY）</td>
              <td>對齊 PD 取樣的 pipeline latency；不可只為單一頻率調</td>
            </tr>
            <tr>
              <td>
                <Tex>{'H_{\\mathrm{PD}}=1/(1+L)'}</Tex>
              </td>
              <td className="ch06-hw">主 PLL 的 REG_PLL_KP / REG_PLL_KI、DCO gain、loop latency</td>
              <td>
                用 DT 模型（E44）計算各 FCW / code 的 <Tex>{'C'}</Tex>；頻寬改變時重新檢查極性
              </td>
            </tr>
            <tr>
              <td>
                <Tex>{'C'}</Tex> 的符號
              </td>
              <td className="ch06-hw">silicon 上可量測</td>
              <td>
                凍結 w，做 <Tex>{'w\\pm\\Delta'}</Tex> 量 <Tex>{'S_{\\mathrm{GMAC}}=(\\bar G_+-\\bar G_-)/(2\\Delta)\\approx-K_qC'}</Tex>，附信賴區間（第 11、14 章）
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        <strong>下一個值得研究的問題：</strong>既然 raw <Tex>{'x'}</Tex> 會被 PLL 的相位「騙」，那是加幾個 delay register 就好（delay alignment），
        還是要在 GMAC 前放一個 PLL 模型（filtered-x）？兩者對多頻 DSM code、模型誤差與 FCW 改變的強健性差在哪裡？→ 第 07 章。
      </p>
    </ChapterSection>
  )
}
