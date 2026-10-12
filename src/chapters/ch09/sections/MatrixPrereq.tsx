import { useMemo } from 'react'
import { ClaimTag, Prereq, Section, StepDerivation, Tex, TexBlock } from '@/components'
import { matVec } from '@/simulation/core'
import { corr2, eig2x2 } from '@/simulation/models/pe'
import { Diagram, FigRef, HandCalcLink, m, texNum, texVec } from '../shared'

/** 先備知識：期望值／相關、矩陣乘向量、對稱矩陣、eigen、正定、condition number、singular value。 */
export function MatrixPrereq() {
  // 四筆樣本估計 E[u1u2]（由程式計算，非手打）
  const samples: [number, number][] = [
    [1, 1],
    [-1, -1],
    [1, 1],
    [1, -1],
  ]
  const e12 = samples.reduce((s, [a, b]) => s + a * b, 0) / samples.length
  const e11 = samples.reduce((s, [a]) => s + a * a, 0) / samples.length
  const e22 = samples.reduce((s, [, b]) => s + b * b, 0) / samples.length

  const probes = useMemo(() => {
    const R = corr2(0.99)
    return [
      [1, 1],
      [1, -1],
      [1, 0],
    ].map((v) => ({ v, Rv: matVec(R, v) }))
  }, [])
  // 圖 9.2（R 這台機器）圖說與說明裡的數字：與上面的 probes 是同一組計算
  const machine = useMemo(() => {
    const out = probes.map((pr) => Array.from(pr.Rv))
    return { out, ratio: out[0][0] / out[1][0] }
  }, [probes])
  const general = eig2x2(2, 0.6, 1)
  // singular value 驗算：R² 的 eigenvalues 開根號 = R 的 eigenvalues（R 對稱半正定）
  const sv = useMemo(() => {
    const R = corr2(0.99)
    const R2 = [
      [R[0][0] * R[0][0] + R[0][1] * R[1][0], R[0][0] * R[0][1] + R[0][1] * R[1][1]],
      [R[1][0] * R[0][0] + R[1][1] * R[1][0], R[1][0] * R[0][1] + R[1][1] * R[1][1]],
    ]
    return { sq: eig2x2(R2[0][0], R2[0][1], R2[1][1]).values }
  }, [])
  // 條件期望的小例子：兩班人數相同，各班平均 → 全體平均（由程式計算）
  const cond = useMemo(() => {
    const means = [60, 80]
    return { n: 30, means, total: means.reduce((a, b) => a + b, 0) / means.length }
  }, [])

  return (
    <Section kind="formula" title="先備知識：把兩個旋鈕寫成矩陣" level={2} id="ch09-prereq">
      <p>
        這一課需要一點線性代數。只要會微積分就夠了——下面每一個框都從頭講，已經熟悉的人可以跳過。
      </p>
      <p>
        整節其實只要記住一個畫面：<strong>矩陣 {m`\mathbf R`} 是一台「丟一個向量進去、吐一個向量出來」的機器</strong>。這裡的 {m`\mathbf R`} 是
        <strong>相關矩陣</strong>（correlation matrix）{m`\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}`}：對角線的 1 是每個 regressor 自己的功率，
        {m`\rho`}（相關係數，correlation coefficient）是兩個 regressor「同進同出」的程度，{m`\rho=1`} 表示完全一樣、{m`\rho=0`} 表示平均起來既不同向也不反向（正交，見下面的先備知識框）。
        下圖取 {m`\rho=0.99`}，把三個不同的向量丟進去：
      </p>
      <Diagram id="matrix-machine">
        比較三列的輸出：綠色與紅色那兩列「方向不變、只被縮放」，縮放的倍數差了 {m`${texNum(machine.ratio)}`} 倍。
      </Diagram>
      <p>
        <FigRef id="matrix-machine" /> 怎麼看：先看輸入是 {m`(1,1)`} 與 {m`(1,-1)`} 的那兩列——{m`(1,1)`} 進去變成 {m`${texNum(machine.out[0][0])}\times(1,1)`}，{m`(1,-1)`} 進去變成
        {m`${texNum(machine.out[1][0])}\times(1,-1)`}，方向都沒變。這種「只被縮放」的向量叫 <strong>eigenvector</strong>，縮放的倍數叫
        <strong>eigenvalue</strong>，記成 {m`\lambda`}。再看輸入是 {m`(1,0)`} 的那一列——進去之後變成 {m`(${texNum(machine.out[2][0])},\,${texNum(machine.out[2][1])})`}，
        方向變了，所以它不是 eigenvector。圖上的「{m`\times\mathbf R`}」就是下面要講的矩陣乘向量 {m`\mathbf R\mathbf x`}；圖上的 1.99 與 0.01 就是後面公式裡的
        {m`\lambda_{\max}=1+\rho`} 與 {m`\lambda_{\min}=1-\rho`}（{m`\rho\ge0`} 時；{m`\rho<0`} 時兩者對調）。這一章的結論幾乎都來自這張圖：步長不太大時，LMS 沿著 {m`\lambda`} 大的方向學得快，沿著 {m`\lambda`} 小的方向學得慢。
      </p>

      <Prereq title={String.raw`期望值 $E[\cdot]$、相關（correlation）與相關矩陣 $\mathbf R$`}>
        <p>
          {m`E[\cdot]`}（expectation，期望值）＝「做很多很多次再平均」。例如 {m`E[u_1u_2]`} 是 {m`u_1u_2`} 這個乘積的長期平均。
          它告訴我們兩個 regressor 是否「同進同出」：
        </p>
        <ul>
          <li>{m`E[u_1u_2]>0`}：多半同號（一起推同一個方向）。</li>
          <li>
            {m`E[u_1u_2]=0`}：<strong>正交（orthogonal）</strong>，兩個 regressor 互相不干擾。只要其中一個的平均為 0，這也就是不相關（uncorrelated，
            {m`E[u_1u_2]=E[u_1]\,E[u_2]`}，第 0 章 §0.7 的定義）；本章的 {m`\rho`} 與 {m`\mathbf R`} 用的都是不扣平均的 {m`E[u_iu_j]`}。
          </li>
          <li>{m`E[u_1u_2]<0`}：多半反號。</li>
        </ul>
        <p>
          四筆樣本 {m`(1,1),(-1,-1),(1,1),(1,-1)`} 的平均乘積是 {m`\tfrac{1+1+1-1}{4}=${texNum(e12)}`}。相關係數（correlation coefficient）
          把功率正規化掉：
        </p>
        <TexBlock>{String.raw`\rho=\frac{E[u_1u_2]}{\sqrt{E[u_1^2]\,E[u_2^2]}}=\frac{${texNum(e12)}}{\sqrt{${texNum(e11)}\cdot${texNum(e22)}}}=${texNum(e12 / Math.sqrt(e11 * e22))},\qquad -1\le\rho\le1`}</TexBlock>
        <p>
          <strong>獨立（independent）</strong>：若 {m`X`} 與 {m`Y`} 互不影響，則 {m`E[XY]=E[X]\,E[Y]`}。本章常用：雜訊 {m`v`} 與 regressor 獨立且
          {m`E[v]=0\ \Rightarrow\ E[v\,\mathbf u]=E[v]\,E[\mathbf u]=\mathbf 0`}。
        </p>
        <p>
          <strong>條件期望（conditional expectation）</strong> {m`E[X\mid Y]`}：先把 {m`Y`} 當成「已經知道的固定值」，只對剩下的隨機性平均；結果是 {m`Y`} 的函數。
          再對 {m`Y`} 平均一次就回到普通的期望值：{m`E\big[E[X\mid Y]\big]=E[X]`}（tower property，「先分組平均、再把各組平均起來」）。
          例：兩班各 {m`${cond.n}`} 人，班平均分別是 {m`${cond.means[0]}`} 與 {m`${cond.means[1]}`} 分（這就是 {m`E[\text{分數}\mid\text{班級}]`}），
          全體平均 {m`=\tfrac12\cdot${cond.means[0]}+\tfrac12\cdot${cond.means[1]}=${texNum(cond.total)}`}。本章用它來處理「先固定目前的參數誤差
          {m`\boldsymbol\delta_k`}，只對這個 block 的 regressor 與雜訊平均」。
        </p>
        <p>
          把所有兩兩乘積的平均排成一個表，就是 <strong>相關矩陣</strong>（correlation matrix）：
        </p>
        <TexBlock>{String.raw`\mathbf R=E[\mathbf u\mathbf u^T]=\begin{bmatrix}E[u_1^2]&E[u_1u_2]\\E[u_2u_1]&E[u_2^2]\end{bmatrix}\ \xrightarrow{\ E[u_i^2]=1\ }\ \begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}`}</TexBlock>
        <p>
          其中 {m`\mathbf u\mathbf u^T`} 是「直的向量乘橫的向量」得到的 {m`2\times2`} 表（outer product），第 {m`i`} 列第 {m`j`} 欄是 {m`u_iu_j`}。
        </p>
      </Prereq>

      <Prereq title="矩陣乘向量（matrix–vector product）">
        <p>每一列和向量做「對應相乘再相加」：</p>
        <TexBlock>{String.raw`\begin{bmatrix}r_{11}&r_{12}\\r_{21}&r_{22}\end{bmatrix}\begin{bmatrix}x\\y\end{bmatrix}=\begin{bmatrix}r_{11}x+r_{12}y\\r_{21}x+r_{22}y\end{bmatrix}`}</TexBlock>
        <p>
          用 {m`\rho=0.99`} 的 {m`\mathbf R`} 試三個向量（由 <code>matVec</code> 計算）：
        </p>
        <div className="table-wrap">
          <table className="ch09-table">
            <thead>
              <tr>
                <th>{m`\mathbf x`}</th>
                <th>{m`\mathbf R\mathbf x`}</th>
                <th className="ch09-left">觀察</th>
              </tr>
            </thead>
            <tbody>
              {probes.map(({ v, Rv }, i) => (
                <tr key={i}>
                  <td>
                    <Tex>{texVec(v)}</Tex>
                  </td>
                  <td>
                    <Tex>{texVec(Rv)}</Tex>
                  </td>
                  <td className="ch09-left">
                    {i === 0 && <>{m`=1.99\times(1,1)`}：方向不變，只被放大 1.99 倍</>}
                    {i === 1 && <>{m`=0.01\times(1,-1)`}：方向不變，只剩 0.01 倍</>}
                    {i === 2 && <>方向改變了（不再平行於 {m`(1,0)`}）</>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          前兩個向量很特別：{m`\mathbf R`} 對它們只做「縮放」。這種向量叫 <strong>eigenvector</strong>，縮放倍數叫 <strong>eigenvalue</strong>。
        </p>
      </Prereq>

      <Prereq title="對稱矩陣（symmetric matrix）">
        <p>
          {m`\mathbf R^T=\mathbf R`}（沿對角線翻轉不變）叫對稱。相關矩陣<strong>一定</strong>對稱，因為 {m`u_1u_2=u_2u_1\ \Rightarrow`}
          {m`R_{12}=E[u_1u_2]=E[u_2u_1]=R_{21}`}。對稱矩陣有兩個好性質（本章會一直用）：eigenvalues 都是實數；不同 eigenvalue 的
          eigenvectors 互相垂直（orthogonal）。
        </p>
      </Prereq>

      <Prereq title={String.raw`Eigenvalue 與 eigenvector：從 $\det(\mathbf R-\lambda\mathbf I)=0$ 一步一步算（$2\times2$）`} defaultOpen>
        <StepDerivation
          title={<>求 {m`\mathbf R=\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}`} 的 eigenvalues 與 eigenvectors</>}
          steps={[
            { tex: String.raw`\mathbf R\mathbf v=\lambda\mathbf v,\qquad \mathbf v\ne\mathbf 0`, why: <>定義：{m`\mathbf R`} 只把 {m`\mathbf v`} 縮放 {m`\lambda`} 倍。</> },
            { tex: String.raw`(\mathbf R-\lambda\mathbf I)\mathbf v=\mathbf 0`, why: <>{m`\lambda\mathbf v=\lambda\mathbf I\mathbf v`}，移項（{m`\mathbf I`} 是單位矩陣）。</> },
            {
              tex: String.raw`\det(\mathbf R-\lambda\mathbf I)=0`,
              why: <>若行列式不為 0，矩陣可逆，唯一解是 {m`\mathbf v=\mathbf 0`}；要有非零解，行列式必須為 0。</>,
            },
            {
              tex: String.raw`\det\begin{bmatrix}1-\lambda&\rho\\\rho&1-\lambda\end{bmatrix}=(1-\lambda)^2-\rho^2=0`,
              why: <>{m`2\times2`} 行列式 = 對角相乘 − 反對角相乘。</>,
            },
            { tex: String.raw`1-\lambda=\pm\rho`, why: <>兩邊開根號（平方相等 {m`\iff`} 相等或相反）。</> },
            { tex: String.raw`\lambda_1=1+\rho,\qquad \lambda_2=1-\rho`, why: <>解出 {m`\lambda`}；{m`\rho\ge0`} 時 {m`\lambda_1`} 較大，{m`\rho<0`} 時換成 {m`\lambda_2`} 較大（合起來 {m`\lambda_{\max,\min}=1\pm|\rho|`}）。</> },
            {
              tex: String.raw`\lambda_1:\ \begin{bmatrix}-\rho&\rho\\\rho&-\rho\end{bmatrix}\begin{bmatrix}v_1\\v_2\end{bmatrix}=\mathbf 0\Rightarrow v_1=v_2\Rightarrow \mathbf v_1=\tfrac1{\sqrt2}\begin{bmatrix}1\\1\end{bmatrix}`,
              why: <>代回 {m`(\mathbf R-\lambda_1\mathbf I)\mathbf v=\mathbf 0`}；第一列 {m`-\rho v_1+\rho v_2=0`}。除以長度 {m`\sqrt2`} 變成單位向量。</>,
            },
            {
              tex: String.raw`\lambda_2:\ \begin{bmatrix}\rho&\rho\\\rho&\rho\end{bmatrix}\begin{bmatrix}v_1\\v_2\end{bmatrix}=\mathbf 0\Rightarrow v_1=-v_2\Rightarrow \mathbf v_2=\tfrac1{\sqrt2}\begin{bmatrix}1\\-1\end{bmatrix}`,
              why: <>同理：{m`\rho v_1+\rho v_2=0`}。</>,
            },
            {
              tex: String.raw`\mathbf v_1^T\mathbf v_2=\tfrac12(1\cdot1+1\cdot(-1))=0`,
              why: '驗算：兩個 eigenvector 垂直（對稱矩陣的性質）。',
            },
          ]}
          result={String.raw`\lambda=1\pm\rho,\quad \mathbf v=\tfrac1{\sqrt2}(1,\pm1)`}
        />
        <p>
          <strong>白話</strong>：{m`\mathbf v_1=(1,1)/\sqrt2`} 是「兩個參數一起偏」的 <strong>共模（common mode）</strong>，
          {m`\mathbf v_2=(1,-1)/\sqrt2`} 是「一個偏高一個偏低」的 <strong>差模（differential mode）</strong>。{m`\rho`} 越接近 1，
          差模的 eigenvalue {m`1-\rho`} 越小——輸入越少「照到」差模。 <ClaimTag kind="exact" />
        </p>
        <p>一般的 {m`2\times2`} 對稱矩陣 {m`\begin{bmatrix}a&b\\b&d\end{bmatrix}`} 同樣解二次方程式：</p>
        <TexBlock>{String.raw`\lambda^2-(a+d)\lambda+(ad-b^2)=0\ \Rightarrow\ \lambda=\frac{a+d}{2}\pm\sqrt{\Big(\frac{a-d}{2}\Big)^2+b^2},\qquad \tan2\theta=\frac{2b}{a-d}`}</TexBlock>
        <p>
          其中 {m`\theta`} 是主軸角：{m`\mathbf v_{\max}=(\cos\theta,\sin\theta)`}。例如 {m`a=2,b=0.6,d=1`}：
          {m`\lambda=${texNum(general.values[0])},\ ${texNum(general.values[1])}`}、{m`\theta=${texNum((general.angle * 180) / Math.PI)}^\circ`}
          （由 <code>eig2x2</code> 計算；網站在 {m`2\times2`} 用這個閉式解，在更大的矩陣用 Jacobi 迭代 <code>eigSym</code>，兩者互相驗算）。
        </p>
        <p>
          想馬上代自己的數字算一次？<HandCalcLink id="HC-09.4" /> 用同一個公式（寫成 trace 與 determinant）一步一步算任意對稱 {m`2\times2`}，
          <HandCalcLink id="HC-09.6" /> 則從四筆 regressor 開始算。
        </p>
      </Prereq>

      <Prereq title="對角化（diagonalization）：換成 eigenvector 座標">
        <p>把 eigenvectors 排成矩陣的欄 {m`\mathbf Q=[\mathbf v_1\ \mathbf v_2]`}、eigenvalues 排成對角矩陣 {m`\boldsymbol\Lambda`}：</p>
        <TexBlock>{String.raw`\mathbf R\mathbf Q=\mathbf Q\boldsymbol\Lambda\ \Rightarrow\ \mathbf R=\mathbf Q\boldsymbol\Lambda\mathbf Q^T,\qquad \mathbf Q^T\mathbf Q=\mathbf I`}</TexBlock>
        <p>
          {m`\mathbf Q^T\mathbf Q=\mathbf I`}（orthogonal）是因為 eigenvectors 互相垂直且長度為 1，所以 {m`\mathbf Q^{-1}=\mathbf Q^T`}。
          任何向量 {m`\boldsymbol\delta`} 都可以拆成 {m`\boldsymbol\delta=\sum_ic_i\mathbf v_i`}，係數 {m`\mathbf c=\mathbf Q^T\boldsymbol\delta`}
          （也就是 {m`c_i=\mathbf v_i^T\boldsymbol\delta`}，投影長度）。在這個座標裡 {m`\mathbf R`} 只是各軸各自縮放 {m`\lambda_i`} 倍。
        </p>
      </Prereq>

      <Prereq title="正定（positive definite）與「沒有被激發的方向」">
        <p>
          {m`\mathbf R`} 正定 {m`\iff`} 對所有 {m`\mathbf v\ne\mathbf 0`}：{m`\mathbf v^T\mathbf R\mathbf v>0`}。對相關矩陣：
        </p>
        <TexBlock>{String.raw`\mathbf v^T\mathbf R\mathbf v=\mathbf v^TE[\mathbf u\mathbf u^T]\mathbf v=E[(\mathbf v^T\mathbf u)^2]\ \ge0`}</TexBlock>
        <p>
          所以相關矩陣一定<strong>半正定</strong>（PSD）。等號成立 {m`\iff`} {m`\mathbf v^T\mathbf u=0`} 幾乎總是成立 {m`\iff`} regressor 從來不在
          {m`\mathbf v`} 方向上動 {m`\iff`} 那個方向的參數誤差對 {m`e`} 毫無影響（學不到）。用 eigen 座標：
          {m`\mathbf v^T\mathbf R\mathbf v=\sum_i\lambda_ic_i^2`}，因此 <strong>正定 {m`\iff`} 所有 {m`\lambda_i>0`}</strong>。
        </p>
      </Prereq>

      <Prereq title={String.raw`Condition number $\kappa$ 與 singular value`}>
        <p>
          {m`\kappa=\lambda_{\max}/\lambda_{\min}`}（eigenvalue spread）。{m`\rho=0.99`}：{m`\kappa=1.99/0.01=199`}。
          一般（不一定對稱的）矩陣 {m`\mathbf A`} 用 singular values：{m`\sigma_i(\mathbf A)=\sqrt{\lambda_i(\mathbf A^T\mathbf A)}`}、
          {m`\kappa=\sigma_{\max}/\sigma_{\min}`}。對稱半正定的 {m`\mathbf R`}，{m`\sigma_i=\lambda_i`}，兩種定義一致。
          {m`\lambda_{\min}=0`} 時 {m`\kappa=\infty`}（矩陣奇異，singular）。
        </p>
        <p>
          驗算（由 <code>eig2x2</code> 計算）：{m`\mathbf R^T\mathbf R=\mathbf R^2`} 的 eigenvalues 是 {m`${texNum(sv.sq[0], 6)}`} 與 {m`${texNum(sv.sq[1], 6)}`}，
          開根號得 {m`\sigma=${texNum(Math.sqrt(sv.sq[0]), 6)},\ ${texNum(Math.sqrt(sv.sq[1]), 6)}`}——正好等於 {m`\lambda=1.99,\ 0.01`}。
          白話：{m`\sigma_{\max}`} 是矩陣能把向量「最多放大幾倍」，{m`\sigma_{\min}`} 是「最少放大幾倍」；{m`\kappa`} 大表示某些方向幾乎被壓扁。
        </p>
      </Prereq>
    </Section>
  )
}
