import { Callout, ClaimTag, ModeGate, Prereq, Section, StepDerivation, Tex, TexBlock, ChRef } from '@/components'
import { Deriv, Fig, FigRef, Hand, TagRow, n, tn } from '../common'
import { NUM } from '../numbers'

export function S1Coupling() {
  const c = NUM.coupling
  const Kq = NUM.Kq
  /** 單一 GMAC（R_ii = 1）在一個 block 內的雜訊 RMS：√(1/N) */
  const etaRms = 1 / Math.sqrt(NUM.noise.N)
  return (
    <>
      <Section
        kind="example"
        title={
          <>
            10.1 先算一次：<Tex>{'w_1'}</Tex> 明明是對的，<Tex>{'G_1'}</Tex> 卻不是 0
          </>
        }
        level={2}
        id="ch10-coupling"
      >
        <TagRow>
          <span className="small muted">規格 §10 開頭</span>
          <ClaimTag kind="approx" />
        </TagRow>
        <p>
          兩個參數、regressor 相關係數 <Tex>{String.raw`\rho=0.8`}</Tex>：<Tex>{String.raw`\mathbf R=\begin{bmatrix}1&0.8\\0.8&1\end{bmatrix}`}</Tex>。
          假設 <Tex>{String.raw`w_1`}</Tex> 已經完全正確（<Tex>{String.raw`\delta_1=0`}</Tex>），只有 <Tex>{String.raw`w_2`}</Tex> 差了{' '}
          <Tex>{String.raw`\delta_2=${c.delta[1]}\ \mathrm{fs}`}</Tex>。Comparator 雜訊 <Tex>{String.raw`\sigma_v=${NUM.sigmaV}\ \mathrm{fs}`}</Tex>。
        </p>
        <p>
          兩個 GMAC 看的是同一個 comparator，所以平均起來，每個參數的誤差都會流到<strong>每一個</strong> GMAC，只是走的路不一樣。先看圖，再把數字一格一格算出來：
        </p>
        <Fig id="coupling">
          先看上面那個加法點（GMAC<sub>1</sub>）：它有兩個輸入，一個是自己的誤差 <Tex>{String.raw`\delta_1`}</Tex> 乘上 <Tex>{String.raw`R_{11}=1`}</Tex>，另一個是別人的誤差{' '}
          <Tex>{String.raw`\delta_2`}</Tex> 乘上 <Tex>{String.raw`R_{12}=0.8`}</Tex>（紅色）。再把例子的數字放上去：<Tex>{String.raw`\delta_1=0`}</Tex>，自己的路徑沒有訊號；紅色路徑卻送進{' '}
          <Tex>{String.raw`0.8\times10`}</Tex>，所以 <Tex>{'G_1'}</Tex> 不是 0。圖上的「<Tex>{String.raw`\times R_{ij}`}</Tex>」就是 §10.2 的 F-10.1 裡的 <Tex>{String.raw`R_{ij}`}</Tex>，加法點就是對{' '}
          <Tex>{'j'}</Tex> 求和，「<Tex>{String.raw`\times K_q`}</Tex>」是 comparator 把「差幾 fs」變成「<Tex>{String.raw`\pm1`}</Tex> 的平均」的斜率（單位 <Tex>{String.raw`\mathrm{fs}^{-1}`}</Tex>）。下面四個步驟只是把這張圖由左到右算一遍。
        </Fig>
        <ol>
          <li>
            Comparator 增益（<ChRef ch="05">第 5 章</ChRef>）：<Tex>{String.raw`K_q=\sqrt{2/\pi}/\sigma_v=0.79788/100=${tn(Kq, 6)}\ \mathrm{fs}^{-1}`}</Tex>。
          </li>
          <li>
            GMAC<sub>1</sub> 的平均（下一段推導）：
            <TexBlock>{String.raw`G_1\approx K_q(R_{11}\delta_1+R_{12}\delta_2)=${tn(Kq, 6)}\times(1\times0+0.8\times${c.delta[1]})=${tn(c.G1lin, 4)}`}</TexBlock>
          </li>
          <li>
            GMAC<sub>2</sub>：<Tex>{String.raw`G_2\approx K_q(0.8\times0+1\times${c.delta[1]})=${tn(c.G2lin, 4)}`}</Tex>。
          </li>
          <li>
            若用 scalar LMS（每個係數只用自己的 GMAC：<Tex>{String.raw`\Delta w_i=\mu G_i`}</Tex>；<Tex>{String.raw`\mu`}</Tex> 是 learning rate，也叫步長，單位 fs）、取{' '}
            <Tex>{String.raw`\mu=${c.muFs}\ \mathrm{fs}`}</Tex> 更新一次：<Tex>{String.raw`\Delta w_1=\mu G_1=${c.muFs}\times${tn(c.G1lin, 4)}=${tn(c.w1Shift, 4)}\ \mathrm{fs}`}</Tex>。
            <strong>原本正確的 <Tex>{'w_1'}</Tex> 被推離了 {n(c.w1Shift, 3)} fs。</strong>
          </li>
        </ol>
        <Callout kind="warn" title="這就是 cross-coupling">
          <p>
            <Tex>{String.raw`G_1=0.8K_q\delta_2\ne0`}</Tex>：即使 <Tex>{String.raw`\delta_1=0`}</Tex>，只要 <Tex>{String.raw`R_{12}\ne0`}</Tex> 而{' '}
            <Tex>{String.raw`w_2`}</Tex> 錯，GMAC<sub>1</sub> 就不會歸零。單看 GMAC<sub>1</sub> 的人會以為 <Tex>{'w_1'}</Tex> 錯了。
          </p>
        </Callout>
        <p>
          繼續算幾步。為了讓數字乾淨，先把 <Tex>{'K_q'}</Tex> 正規化為 1（<Tex>{String.raw`\mu K_q=0.5`}</Tex>），並把上面的 <Tex>{String.raw`\approx`}</Tex> 當成等式（線性模型；1-bit comparator 時是誤差遠小於{' '}
          <Tex>{String.raw`\sigma_v`}</Tex> 的小訊號近似）。這時無雜訊的平均遞迴是 <Tex>{String.raw`\boldsymbol\delta_{k+1}=(\mathbf I-\mu K_q\mathbf R)\boldsymbol\delta_k`}</Tex>（§10.3 推導）：
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>block k</th>
                <th className="ch10-num">
                  <Tex>{String.raw`\delta_{1,k}`}</Tex>
                </th>
                <th className="ch10-num">
                  <Tex>{String.raw`\delta_{2,k}`}</Tex>
                </th>
                <th>發生什麼事</th>
              </tr>
            </thead>
            <tbody>
              {c.handRows.slice(0, 5).map((r) => (
                <tr key={r.k} className={r.k === 1 ? 'ch10-hl' : undefined}>
                  <td>{r.k}</td>
                  <td className="ch10-num">{n(r.d1, 4)}</td>
                  <td className="ch10-num">{n(r.d2, 4)}</td>
                  <td className="small">
                    {r.k === 0 && <Tex>{String.raw`w_1\ \text{正確},\ \delta_2=10`}</Tex>}
                    {r.k === 1 && (
                      <>
                        <Tex>{String.raw`\delta_1=0-0.5(1\cdot0+0.8\cdot10)=-4`}</Tex>：<Tex>{'w_1'}</Tex> 被拉偏；{' '}
                        <Tex>{String.raw`\delta_2=10-0.5(0.8\cdot0+1\cdot10)=5`}</Tex>
                      </>
                    )}
                    {r.k === 2 && (
                      <>
                        <Tex>{String.raw`\delta_2=5-0.5(0.8\cdot(-4)+5)=4.1`}</Tex>
                      </>
                    )}
                    {r.k >= 3 && '兩者沿差模方向一起慢慢縮小'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          表格由 <code>propagateLinearMoments()</code>（src/simulation/models/mimo.ts）計算。注意 <Tex>{String.raw`k\ge2`}</Tex> 後兩個誤差幾乎等大反號：系統很快消掉共模分量（
          <Tex>{String.raw`p_1=1-0.5\times${tn(c.eig[0])}=${tn(1 - 0.5 * c.eig[0])}`}</Tex>），剩下的差模分量以{' '}
          <Tex>{String.raw`p_2=1-0.5\times${tn(c.eig[1])}=${tn(1 - 0.5 * c.eig[1])}`}</Tex> 慢慢衰減。
        </p>
      </Section>

      <Section
        kind="formula"
        title={
          <>
            10.2 一步一步推導：<Tex>{String.raw`\mathbf G\approx K_q\mathbf R\boldsymbol\delta`}</Tex>
          </>
        }
        id="ch10-derive-G"
      >
        <p>
          <FigRef id="coupling" /> 畫的是「平均之後」的結果。這一節回到每一個 sample，看這個平均是怎麼來的：誤差先相加、comparator 取正負號、每個 GMAC 再各自做相關。
        </p>
        <Fig id="sample-to-block">
          先看上框的加法點：兩個參數的誤差各自乘上自己的 regressor（<Tex>{String.raw`u_j[n]\,\delta_j`}</Tex>），和雜訊 <Tex>{'v[n]'}</Tex> 加在一起成為 <Tex>{'e[n]'}</Tex>；comparator 只留下正負號{' '}
          <Tex>{'q[n]'}</Tex>。再看 <Tex>{'q[n]'}</Tex> 分成兩條：各自乘上自己的 code <Tex>{'x_i[n]'}</Tex>，進到下框累加 <Tex>{'N'}</Tex> 次、除以 <Tex>{'N'}</Tex>，每個 block 輸出一個{' '}
          <Tex>{String.raw`G_{i,k}`}</Tex>（下標 <Tex>{'k'}</Tex> 是 block 編號）。圖上的加法點就是下面推導第 1 步的 <Tex>{String.raw`e[n]=\mathbf u^T[n]\boldsymbol\delta_k+v[n]`}</Tex>，「累加{' '}
          <Tex>{'N'}</Tex> 次再 <Tex>{String.raw`\div N`}</Tex>」就是第 3 步的 <Tex>{String.raw`\tfrac1N\sum_n`}</Tex>；因為一個 block 之內 <Tex>{String.raw`\mathbf w`}</Tex> 不變，上框裡的{' '}
          <Tex>{String.raw`\delta_j`}</Tex> 是常數。
        </Fig>
        <p>
          這條路上只有一個方塊不是線性的：comparator。推導最關鍵的一步，就是把「只會回答正或負」的它換成一個普通的增益 <Tex>{'K_q'}</Tex>。先只看<strong>一個</strong> sample（把{' '}
          <Tex>{String.raw`\mathbf u`}</Tex> 當成固定的數），把這一步單獨畫出來：
        </p>
        <Fig id="comparator-gain">
          先看最上面的加法點：這個 sample 的訊號 <Tex>{String.raw`s=\mathbf u^T\boldsymbol\delta`}</Tex>（§10.1 的例子裡 <Tex>{String.raw`\delta_1=0`}</Tex>、<Tex>{String.raw`\delta_2=${c.delta[1]}\ \mathrm{fs}`}</Tex>，碰到{' '}
          <Tex>{'u_2=+1'}</Tex> 的 sample 時 <Tex>{String.raw`s=${c.delta[1]}\ \mathrm{fs}`}</Tex>）和雜訊 <Tex>{'v'}</Tex>（RMS <Tex>{String.raw`\sigma_v=${NUM.sigmaV}\ \mathrm{fs}`}</Tex>）相加，comparator 只回答正或負——單看一次，
          <Tex>{'q'}</Tex> 幾乎是擲硬幣。再看「對雜訊取平均」那一格：同一個 <Tex>{'s'}</Tex> 重複很多次，<Tex>{'+1'}</Tex> 會比 <Tex>{'-1'}</Tex> 多出現一點點，<Tex>{String.raw`\pm1`}</Tex> 的平均是{' '}
          <Tex>{String.raw`\operatorname{erf}\big(s/(\sqrt2\,\sigma_v)\big)=${tn(c.erfOne, 4)}`}</Tex>。最後看最下面分出的兩條路：<Tex>{String.raw`|s|\ll\sigma_v`}</Tex> 時 erf 幾乎是一條通過原點的直線，斜率就是{' '}
          <Tex>{'K_q'}</Tex>（藍色；<Tex>{String.raw`K_q s=${tn(c.G2lin, 4)}`}</Tex>，只比 erf 的值大 {n(100 * (c.G2lin / c.erfOne - 1), 2)}%）；<Tex>{'|s|'}</Tex> 大到和 <Tex>{String.raw`\sigma_v`}</Tex>{' '}
          差不多時曲線變平（紅色），「增益 = <Tex>{'K_q'}</Tex>」就不成立了。圖上「對雜訊取平均」那一格就是下面推導第 6 步的 <Tex>{String.raw`E[q\mid\mathbf u]`}</Tex>，藍色那一格就是第 7 步的{' '}
          <Tex>{String.raw`K_q\,\mathbf u^T\boldsymbol\delta`}</Tex>；這條 erf 是怎麼來的，在緊接著的先備知識框（<ChRef ch="05">第 5 章</ChRef>的結果）。
        </Fig>
        <Prereq title="回顧第 5 章：Gaussian 雜訊下 sign 的平均與 comparator 小訊號增益">
          <p>
            Gaussian（常態）雜訊 <Tex>{String.raw`v\sim\mathcal N(0,\sigma_v^2)`}</Tex> 的機率密度是{' '}
            <Tex>{String.raw`\frac{1}{\sqrt{2\pi}\sigma_v}e^{-v^2/(2\sigma_v^2)}`}</Tex>；標準常態的累積機率{' '}
            <Tex>{String.raw`\Phi(z)=\int_{-\infty}^{z}\frac{1}{\sqrt{2\pi}}e^{-t^2/2}\,dt`}</Tex>，誤差函數{' '}
            <Tex>{String.raw`\operatorname{erf}(x)=\frac{2}{\sqrt\pi}\int_0^xe^{-t^2}dt`}</Tex>，兩者的關係是 <Tex>{String.raw`2\Phi(z)-1=\operatorname{erf}(z/\sqrt2)`}</Tex>（換變數{' '}
            <Tex>{String.raw`t\to t/\sqrt2`}</Tex>）。訊號 <Tex>{'s'}</Tex> 固定時 <Tex>{String.raw`P(s+v>0)=P(v>-s)=\Phi(s/\sigma_v)`}</Tex>（對稱），所以
          </p>
          <TexBlock>{String.raw`E[\operatorname{sign}(s+v)]=2\Phi(s/\sigma_v)-1=\operatorname{erf}\!\Big(\frac{s}{\sqrt2\,\sigma_v}\Big)\approx\sqrt{\frac2\pi}\frac{s}{\sigma_v}=K_q\,s\quad(|s|\ll\sigma_v)`}</TexBlock>
          <p>
            最後一步是 erf 在 0 的一階泰勒展開：<Tex>{String.raw`\operatorname{erf}(z)\approx\frac{2}{\sqrt\pi}z`}</Tex>，代入{' '}
            <Tex>{String.raw`z=s/(\sqrt2\sigma_v)`}</Tex> 得 <Tex>{String.raw`\sqrt{2/\pi}\,s/\sigma_v`}</Tex>。
          </p>
        </Prereq>
        <Deriv title="從 comparator 到向量 GMAC（每一步一個理由）">
          <StepDerivation
            steps={[
              {
                tex: String.raw`e[n]=\sum_{j=1}^{P}u_j[n]\,(a_j-w_j)+v[n]=\mathbf u^T[n]\,\boldsymbol\delta_k+v[n]`,
                why: (
                  <>
                    每個參數的誤差經過自己的 regressor 進入 comparator，全部相加；block <Tex>{'k'}</Tex> 內 <Tex>{String.raw`\mathbf w`}</Tex> 固定。
                  </>
                ),
              },
              { tex: String.raw`q[n]=\operatorname{sign}(e[n])`, why: '1-bit comparator 只留下正負號。' },
              {
                tex: String.raw`G_{i,k}=\frac1N\sum_{n\in k}q[n]\,u_i[n]`,
                why: (
                  <>
                    第 i 個 GMAC 用自己的 regressor 去相關「同一個」<Tex>{'q'}</Tex>（理想匹配 <Tex>{String.raw`\mathbf x=\mathbf u`}</Tex>）。
                  </>
                ),
              },
              {
                tex: String.raw`E[G_{i,k}]=E\big[q\,u_i\big]`,
                why: (
                  <>
                    block 內 <Tex>{'N'}</Tex> 個 sample 是 iid（independent and identically distributed：彼此獨立、分布相同）：平均的期望值等於單一 sample 的期望值（期望值是線性的）。
                  </>
                ),
              },
              {
                tex: String.raw`E[q\,u_i]=E_{\mathbf u}\Big[u_i\,E[q\mid\mathbf u]\Big]`,
                why: (
                  <>
                    分兩段平均（iterated expectation）：先把 <Tex>{String.raw`\mathbf u`}</Tex> 當成固定值、只對雜訊 <Tex>{'v'}</Tex> 平均，再對{' '}
                    <Tex>{String.raw`\mathbf u`}</Tex> 平均；結果與一次全部平均相同。可以這樣做是因為 <Tex>{'v'}</Tex> 與 <Tex>{String.raw`\mathbf u`}</Tex> 獨立。
                  </>
                ),
              },
              {
                tex: String.raw`E[q\mid\mathbf u]=\operatorname{erf}\!\Big(\frac{\mathbf u^T\boldsymbol\delta}{\sqrt2\,\sigma_v}\Big)`,
                why: (
                  <>
                    固定 <Tex>{String.raw`\mathbf u`}</Tex> 時 <Tex>{String.raw`s=\mathbf u^T\boldsymbol\delta`}</Tex> 是常數，套用上面的先備知識。
                  </>
                ),
              },
              {
                tex: String.raw`E[q\mid\mathbf u]\approx K_q\,\mathbf u^T\boldsymbol\delta`,
                why: (
                  <>
                    小誤差 <Tex>{String.raw`|\mathbf u^T\boldsymbol\delta|\ll\sigma_v`}</Tex>：erf 的一階泰勒展開。
                  </>
                ),
              },
              {
                tex: String.raw`E[q\,u_i]\approx K_q\,E\Big[u_i\sum_j u_j\delta_j\Big]=K_q\sum_j E[u_iu_j]\,\delta_j`,
                why: (
                  <>
                    代入並把常數 <Tex>{String.raw`\delta_j`}</Tex> 提出期望值（線性）。
                  </>
                ),
              },
              {
                tex: String.raw`E[q\,u_i]\approx K_q\sum_j R_{ij}\,\delta_j`,
                why: (
                  <>
                    定義 <Tex>{String.raw`R_{ij}=E[u_iu_j]`}</Tex>。
                  </>
                ),
              },
            ]}
            result={String.raw`E[\mathbf G_k]\approx K_q\,\mathbf R\,\boldsymbol\delta_k`}
          />
        </Deriv>
        <TexBlock
          id="F-10.1"
          label={
            <>
              多參數 GMAC 的平均（小訊號；<Tex>{String.raw`\boldsymbol\delta=\mathbf a-\mathbf w`}</Tex>）
            </>
          }
        >
          {String.raw`\boxed{E[\mathbf G_k]\approx K_q\,\mathbf R\,(\mathbf a-\mathbf w_k)},\qquad G_i\approx K_q\Big(R_{ii}\,\delta_i+\sum_{j\ne i}R_{ij}\,\delta_j\Big)`}
        </TexBlock>
        <p>
          第二式把耦合寫得很清楚：<Tex>{String.raw`R_{ii}\delta_i`}</Tex> 是「自己的誤差」，<Tex>{String.raw`\sum_{j\ne i}R_{ij}\delta_j`}</Tex>{' '}
          是「別人漏進來的誤差」。對角元素決定每個 loop 的極性與斜率，非對角元素決定耦合。<ClaimTag kind="approx" />
        </p>
        <Hand id="HC-10.1">
          預設數字就是 §10.1 的例子（<Tex>{String.raw`\rho=0.8,\ \boldsymbol\delta=(0,10)\ \mathrm{fs},\ \sigma_v=100\ \mathrm{fs},\ \mu=10\ \mathrm{fs}`}</Tex>）。先把{' '}
          <Tex>{String.raw`\rho`}</Tex>、<Tex>{String.raw`\delta_1`}</Tex>、<Tex>{String.raw`\delta_2`}</Tex> 換成你自己的數字，用紙筆把 <Tex>{'G_1'}</Tex>、<Tex>{'G_2'}</Tex> 與更新一次後的誤差算出來，再展開步驟對答案；試試{' '}
          <Tex>{String.raw`\rho=0`}</Tex>，看耦合項消失。
        </Hand>

        <Prereq title="變異數與共變異矩陣（covariance matrix）：雜訊「多大、往哪個方向」">
          <p>
            一個隨機量 <Tex>{'X'}</Tex>（平均 <Tex>{'m=E[X]'}</Tex>）的<strong>變異數</strong>是偏離平均的平方的平均：{' '}
            <Tex>{String.raw`\operatorname{Var}(X)=E[(X-m)^2]=E[X^2]-m^2`}</Tex>，開根號就是 RMS（標準差）。把 <Tex>{'P'}</Tex> 個隨機量排成向量{' '}
            <Tex>{String.raw`\mathbf z`}</Tex>（平均 <Tex>{String.raw`\mathbf m`}</Tex>），所有配對的「偏差乘積的平均」排成一張表，就是<strong>共變異矩陣</strong>：
          </p>
          <TexBlock>
            {String.raw`\operatorname{Cov}(\mathbf z)=E\big[(\mathbf z-\mathbf m)(\mathbf z-\mathbf m)^T\big]=E[\mathbf z\mathbf z^T]-\mathbf m\mathbf m^T=\begin{bmatrix}\operatorname{Var}(z_1)&E[(z_1-m_1)(z_2-m_2)]\\E[(z_2-m_2)(z_1-m_1)]&\operatorname{Var}(z_2)\end{bmatrix}`}
          </TexBlock>
          <p>
            對角線是每個分量自己的變異數，非對角是兩個分量「一起偏」的程度（0 代表不相關）。本章會用到兩條規則：
          </p>
          <ul>
            <li>
              <strong>線性變換</strong>：<Tex>{String.raw`\operatorname{Cov}(\mathbf A\mathbf z)=\mathbf A\operatorname{Cov}(\mathbf z)\mathbf A^T`}</Tex>。理由：{' '}
              <Tex>{String.raw`E[\mathbf A(\mathbf z-\mathbf m)(\mathbf z-\mathbf m)^T\mathbf A^T]`}</Tex>，常數矩陣可以提出期望值。純量版本就是{' '}
              <Tex>{String.raw`\operatorname{Var}(aX)=a^2\operatorname{Var}(X)`}</Tex>。
            </li>
            <li>
              <strong>
                <Tex>{'N'}</Tex> 個獨立樣本的平均
              </strong>
              ：<Tex>{String.raw`\operatorname{Cov}\big(\tfrac1N\sum_{n=1}^N\mathbf z_n\big)=\tfrac{1}{N}\operatorname{Cov}(\mathbf z)`}</Tex>（獨立 ⇒ 共變異相加得{' '}
              <Tex>{String.raw`N\operatorname{Cov}(\mathbf z)`}</Tex>，再乘上 <Tex>{String.raw`(1/N)^2`}</Tex>）。這就是「累加 <Tex>{'N'}</Tex> 次，雜訊 RMS 降為{' '}
              <Tex>{String.raw`1/\sqrt N`}</Tex>」。
            </li>
          </ul>
        </Prereq>
        <p>
          F-10.1 只是<strong>平均</strong>。每個 block 實際量到的 GMAC 會在這個平均附近抖動，因為它只是 <Tex>{'N'}</Tex> 個「<Tex>{String.raw`\pm1`}</Tex> 乘上 code」的平均。先看這個抖動從哪裡來、有多大：
        </p>
        <Fig id="gmac-noise">
          先看上框：每個 sample 的乘積 <Tex>{String.raw`q[n]\,x_i[n]`}</Tex> 只有正或負兩種值。近平衡（<Tex>{String.raw`\boldsymbol\delta\approx\mathbf 0`}</Tex>）時 <Tex>{'q'}</Tex> 幾乎只由雜訊{' '}
          <Tex>{'v'}</Tex> 決定、和 code 無關，所以乘積的<strong>平均</strong>很小（就是 F-10.1 的 <Tex>{String.raw`K_q\mathbf R\boldsymbol\delta`}</Tex>），但它的<strong>抖動</strong>一點也不小：因為{' '}
          <Tex>{'q^2=1'}</Tex>，乘積的共變異就是 code 自己的 <Tex>{String.raw`\mathbf R`}</Tex>。再看下框：GMAC 把 <Tex>{'N'}</Tex> 個獨立的乘積平均起來，平均不變，共變異除以 <Tex>{'N'}</Tex>（RMS 降為{' '}
          <Tex>{String.raw`1/\sqrt N`}</Tex>）。圖上的 <Tex>{String.raw`\boldsymbol\eta_k`}</Tex> 就是下面式子裡的 <Tex>{String.raw`\boldsymbol\eta_k=\mathbf G_k-E[\mathbf G_k]`}</Tex>；紅色那一格代的是 §10.1 的數字：訊號{' '}
          <Tex>{String.raw`G_1\approx${tn(c.G1lin, 3)}`}</Tex> 只比單一 block 的雜訊 RMS <Tex>{String.raw`1/${Math.sqrt(NUM.noise.N)}=${tn(etaRms, 3)}`}</Tex> 大 {n(c.G1lin / etaRms, 2)} 倍——單看一個 block 的 GMAC
          只能大致相信它的方向，要靠很多個 block 慢慢累積（這就是 loop gain 不能太大的原因，§10.4 會算代價）。
        </Fig>
        <p>
          把抖動記成 <Tex>{String.raw`\boldsymbol\eta_k`}</Tex>：<Tex>{String.raw`\mathbf G_k=E[\mathbf G_k]+\boldsymbol\eta_k`}</Tex>。<Tex>{String.raw`\boldsymbol\eta_k`}</Tex> 的平均是 0，近平衡（
          <Tex>{String.raw`\boldsymbol\delta\approx\mathbf 0`}</Tex>）時共變異是
        </p>
        <TexBlock>{String.raw`\operatorname{Cov}(\boldsymbol\eta_k)\approx\frac{\mathbf R}{N}\qquad\Big(\text{每個 GMAC 的雜訊 RMS}\approx\sqrt{R_{ii}/N};\ N=${NUM.noise.N},\ R_{ii}=1\Rightarrow1/${Math.sqrt(NUM.noise.N)}=${tn(etaRms, 3)}\Big)`}</TexBlock>
        <p className="small muted">
          （<Tex>{'N'}</Tex> 是每個 block 累加的 sample 數。若 GMAC 用的 code <Tex>{String.raw`\mathbf x`}</Tex> 與有效 regressor <Tex>{String.raw`\mathbf u`}</Tex> 不同，上式的{' '}
          <Tex>{String.raw`\mathbf R`}</Tex> 要換成 code 自己的自相關矩陣 <Tex>{String.raw`\mathbf R_x=E[\mathbf x\mathbf x^T]`}</Tex>；匹配時兩者相同。）
        </p>
        <p className="small muted">
          這是近似：需要近平衡，而且 block 內的 sample 彼此獨立。Engineer 模式有逐步推導（把上圖上框的「共變異 <Tex>{String.raw`\approx\mathbf R`}</Tex>」與下框的「<Tex>{String.raw`\div N`}</Tex>」各寫成一行式子）。
          <ClaimTag kind="approx" />
        </p>

        <ModeGate min="engineer">
          <Deriv
            title={
              <>
                GMAC 雜訊的共變異：<Tex>{String.raw`\operatorname{Cov}(\boldsymbol\eta)\approx\mathbf R/N`}</Tex>
              </>
            }
          >
            <p>
              定義 <Tex>{String.raw`\boldsymbol\eta_k=\mathbf G_k-E[\mathbf G_k]`}</Tex>。單一 sample 的向量 <Tex>{String.raw`q\mathbf u`}</Tex>：
            </p>
            <StepDerivation
              steps={[
                { tex: String.raw`\operatorname{Cov}(q\mathbf u)=E[q^2\mathbf u\mathbf u^T]-E[q\mathbf u]E[q\mathbf u]^T`, why: '共變異的定義：二階動差減去平均的外積。' },
                {
                  tex: String.raw`=E[\mathbf u\mathbf u^T]-\mathbf m\mathbf m^T=\mathbf R-\mathbf m\mathbf m^T`,
                  why: (
                    <>
                      <Tex>{String.raw`q=\pm1\Rightarrow q^2=1`}</Tex>；<Tex>{String.raw`\mathbf m=E[q\mathbf u]\approx K_q\mathbf R\boldsymbol\delta`}</Tex>。
                    </>
                  ),
                },
                {
                  tex: String.raw`\approx\mathbf R`,
                  why: (
                    <>
                      近平衡時 <Tex>{String.raw`\boldsymbol\delta\approx0\Rightarrow\mathbf m\approx0`}</Tex>（<Tex>{String.raw`\mathbf m=O(K_q\boldsymbol\delta)`}</Tex>，外積是二階小量）。
                    </>
                  ),
                },
                {
                  tex: String.raw`\operatorname{Cov}(\boldsymbol\eta_k)=\frac{1}{N}\operatorname{Cov}(q\mathbf u)\approx\frac{\mathbf R}{N}`,
                  why: (
                    <>
                      <Tex>{'N'}</Tex> 個 iid sample 的平均：變異除以 <Tex>{'N'}</Tex>（獨立 ⇒ 變異相加，再乘 <Tex>{String.raw`1/N^2`}</Tex>）。
                    </>
                  ),
                },
              ]}
            />
            <p>
              所以 GMAC 雜訊本身就帶有 <Tex>{String.raw`\mathbf R`}</Tex> 的形狀：沿第 i 個 eigenvector 的雜訊 RMS 是{' '}
              <Tex>{String.raw`\sqrt{\lambda_i/N}`}</Tex>，小 eigenvalue 的方向雜訊確實比較小——但那個方向的「訊號」<Tex>{String.raw`K_q\lambda_i\xi_i`}</Tex>（<Tex>{String.raw`\xi_i`}</Tex> 是誤差{' '}
              <Tex>{String.raw`\boldsymbol\delta`}</Tex> 沿第 i 個 eigenvector 的分量，§10.3 會正式定義）{' '}
              縮小得更快（<Tex>{String.raw`\propto\lambda_i`}</Tex>，雜訊只 <Tex>{String.raw`\propto\sqrt{\lambda_i}`}</Tex>），所以訊雜比{' '}
              <Tex>{String.raw`\propto\sqrt{\lambda_i}`}</Tex>：越弱的方向越難量。這個事實在 §10.4（雜訊放大）會決定一切。若 GMAC 的 code{' '}
              <Tex>{String.raw`\mathbf x`}</Tex> 與有效 regressor <Tex>{String.raw`\mathbf u`}</Tex> 不同，則 <Tex>{String.raw`\operatorname{Cov}(\boldsymbol\eta)\approx\mathbf R_x/N`}</Tex>、
              <Tex>{String.raw`\mathbf R_x=E[\mathbf x\mathbf x^T]`}</Tex>。
            </p>
          </Deriv>
        </ModeGate>

        <Deriv title="Research：不用小訊號近似的精確平均（Gaussian regressor，Bussgang 定理）" min="research">
          <p>
            若 <Tex>{String.raw`\mathbf u\sim\mathcal N(\mathbf 0,\mathbf R_u)`}</Tex>，則 <Tex>{String.raw`s=\mathbf u^T\boldsymbol\delta+v`}</Tex> 也是 Gaussian，
            且 <Tex>{String.raw`(\mathbf u,s)`}</Tex> 聯合 Gaussian。Bussgang 定理：對聯合 Gaussian 的 <Tex>{String.raw`\mathbf u`}</Tex> 與{' '}
            <Tex>{'s'}</Tex>，<Tex>{String.raw`E[\mathbf u\,g(s)]=\frac{E[\mathbf us]}{E[s^2]}E[s\,g(s)]`}</Tex>。
          </p>
          <StepDerivation
            steps={[
              {
                tex: String.raw`E[\mathbf u\,s]=E[\mathbf u\mathbf u^T]\boldsymbol\delta+E[\mathbf u v]=\mathbf R_u\boldsymbol\delta`,
                why: (
                  <>
                    <Tex>{'v'}</Tex> 與 <Tex>{String.raw`\mathbf u`}</Tex> 獨立且零均值。
                  </>
                ),
              },
              { tex: String.raw`E[s^2]=\boldsymbol\delta^T\mathbf R_u\boldsymbol\delta+\sigma_v^2\equiv\sigma_s^2`, why: '兩個獨立零均值項的變異相加。' },
              { tex: String.raw`E[s\operatorname{sign}(s)]=E|s|=\sigma_s\sqrt{2/\pi}`, why: 'Gaussian 的平均絕對值（half-normal 的平均）。' },
              { tex: String.raw`E[\mathbf u\operatorname{sign}(s)]=\frac{\mathbf R_u\boldsymbol\delta}{\sigma_s^2}\,\sigma_s\sqrt{\frac2\pi}=\sqrt{\frac2\pi}\frac{\mathbf R_u\boldsymbol\delta}{\sigma_s}`, why: '代入 Bussgang 定理。' },
              {
                tex: String.raw`E[\mathbf G]=\mathbf B\,E[\mathbf u\operatorname{sign}(s)]=\sqrt{\frac2\pi}\frac{\mathbf C\boldsymbol\delta}{\sqrt{\sigma_v^2+\boldsymbol\delta^T\mathbf R_u\boldsymbol\delta}}`,
                why: (
                  <>
                    GMAC 用 <Tex>{String.raw`\mathbf x=\mathbf B\mathbf u`}</Tex>，<Tex>{String.raw`\mathbf C=E[\mathbf x\mathbf u^T]=\mathbf B\mathbf R_u`}</Tex>。
                  </>
                ),
              },
            ]}
          />
          <TexBlock
            id="F-10.13"
            label={
              <>
                精確（Gaussian <Tex>{String.raw`\mathbf u`}</Tex>）：方向永遠是 <Tex>{String.raw`\mathbf C\boldsymbol\delta`}</Tex>，只有增益隨{' '}
                <Tex>{String.raw`\|\boldsymbol\delta\|`}</Tex> 被壓縮
              </>
            }
          >
            {String.raw`E[\mathbf G]=\sqrt{\frac{2}{\pi}}\;\frac{\mathbf C\boldsymbol\delta}{\sqrt{\sigma_v^2+\boldsymbol\delta^T\mathbf R_u\boldsymbol\delta}}\;\xrightarrow{\ \boldsymbol\delta\to0\ }\;K_q\mathbf C\boldsymbol\delta`}
          </TexBlock>
          <p>
            兩個推論：(1) 對 Gaussian regressor，<strong>耦合結構 <Tex>{String.raw`\mathbf C\boldsymbol\delta`}</Tex> 是精確的</strong>，不是近似；近似的只有「增益 =
            <Tex>{'K_q'}</Tex>」。(2) 誤差大時有效增益 <Tex>{String.raw`K_q/\sqrt{1+\boldsymbol\delta^T\mathbf R_u\boldsymbol\delta/\sigma_v^2}`}</Tex> 變小，
            所以 Sign-LMS 一開始比線性模型慢。上面例子 <Tex>{String.raw`\boldsymbol\delta=(0,10)`}</Tex>：精確{' '}
            <Tex>{String.raw`G_1=${tn(c.Gexact[0], 5)}`}</Tex> vs 線性 <Tex>{String.raw`${tn(c.G1lin, 5)}`}</Tex>（壓縮因子{' '}
            <Tex>{String.raw`1/\sqrt{1+100/10^4}=${tn(c.Gexact[0] / c.G1lin, 5)}`}</Tex>）。<Tex>{String.raw`\pm1`}</Tex> 碼則用列舉：{' '}
            <Tex>{String.raw`E[\mathbf G]=\sum_{\mathbf s}p(\mathbf s)\,\mathbf B\mathbf s\,\operatorname{erf}\big(\mathbf s^T\boldsymbol\delta/(\sqrt2\sigma_v)\big)`}</Tex>（程式碼{' '}
            <code>signGmacMean</code>）。<ClaimTag kind="exact" />
          </p>
        </Deriv>
      </Section>
    </>
  )
}
