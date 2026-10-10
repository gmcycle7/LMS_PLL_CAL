import { useMemo } from 'react'
import { ClaimTag, Quiz, Recap, Tex, TexBlock } from '@/components'
import { CONDITIONS_TEX, FORMULAS } from '../formulas'
import { accumulatorBits, eig2, liftedDualLoop, loopTransfer, pmuxKappa, PMUX_W1, sigmaW2Colored, zetaWnFromKpKi } from '../model'
import { mt, n4 } from '../common'
import { ALPHA_Q, USER_L2 } from '../previews/SspllPolarity'

const METHODS: { name: string; claim: 'exact' | 'approx' | 'research'; can: string; cannot: string; used: string }[] = [
  { name: '封閉式（closed form）', claim: 'exact', can: '在明確模型內給出精確公式與趨勢；可直接設計', cannot: '模型假設（線性、iid、平穩）一不成立就失效', used: 'R1、R3、R4、R5、R7、R8、R9、R10、SSPLL' },
  { name: '狀態空間 + Lyapunov', claim: 'exact', can: '任意有限階 ARMA 雜訊、多狀態耦合的穩態共變異', cannot: '只對線性系統；非線性（sign、飽和）需線性化', used: 'R1、R4' },
  { name: 'Monte Carlo（固定 seed + CI）', claim: 'approx', can: '檢驗封閉式本身；可放進非線性', cannot: '有限樣本不能證明全域穩定；heavy tail 時 CI 會騙人（E14）', used: 'R1、R2、R4、R6、R8' },
  { name: '多速率 lifting', claim: 'exact', can: '把快迴路一個 block 內的 $N$ 步精確積掉，得到 block rate 的 poles', cannot: '需要線性、時不變（LTI）快迴路', used: 'R7' },
  { name: '整數 / bit-true 算術', claim: 'exact', can: '週期、溢位、rounding 的確定性結論', cannot: '只到位元層級；不含類比非理想', used: 'R3、R9' },
  { name: '一個週期的 DFT（譜線功率加權）', claim: 'exact', can: '週期性 regressor（PMUX one-hot、DTC 鋸齒）的平均斜率，逐條譜線可檢查', cannot: '線性小訊號；1-bit 飽和與 comparator offset 需要時域模擬', used: 'R3、SSPLL' },
  { name: '事件級模擬', claim: 'research', can: 'edge 時序、DSM 的非線性 divider、四條 noise 路徑', cannot: '本站尚未實作（R7 待辦）', used: '—' },
  { name: 'RTL / AMS co-simulation', claim: 'research', can: '最接近 sign-off', cannot: '本站尚未實作（R9 待辦）', used: '—' },
]

export function Methods() {
  return (
    <>
      <p>
        每個研究預覽都用「至少兩種獨立算法算同一個數」來檢查自己：封閉式 vs 數值解 vs Monte Carlo。下表整理這些算法各自能宣稱什麼、不能宣稱什麼。
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>算法</th>
              <th>結論等級</th>
              <th>能做什麼</th>
              <th>限制</th>
              <th>本頁用在</th>
            </tr>
          </thead>
          <tbody>
            {METHODS.map((m) => (
              <tr key={m.name}>
                <td>{m.name}</td>
                <td>
                  <ClaimTag kind={m.claim} />
                </td>
                <td>{mt(m.can)}</td>
                <td>{mt(m.cannot)}</td>
                <td>{m.used}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function Wrapup() {
  const p = 1 - 10 * (Math.sqrt(2 / Math.PI) / 100)
  const fNeg = sigmaW2Colored({ p, mu: 10, sigmaEta2: 1 / 4096, rho: -0.5 }) / sigmaW2Colored({ p, mu: 10, sigmaEta2: 1 / 4096, rho: 0 })
  const fPos = sigmaW2Colored({ p, mu: 10, sigmaEta2: 1 / 4096, rho: 0.5 }) / sigmaW2Colored({ p, mu: 10, sigmaEta2: 1 / 4096, rho: 0 })
  const acc = accumulatorBits(6, 4096, true)
  const rho16 = eig2(liftedDualLoop({ r: 0.8, b: 0.2, c: 1, mu: 1.2, N: 16 })).rho
  const rho1 = eig2(liftedDualLoop({ r: 0.8, b: 0.2, c: 1, mu: 1.2, N: 1 })).rho
  // 思考題 3：使用者的 L2、α = 0.021（取最近的 j/4096），全部由 model 即時計算
  const q3 = useMemo(() => {
    const H = loopTransfer({ kind: 'type2', KL: 0, ...zetaWnFromKpKi(USER_L2.Kp, USER_L2.Ki), d: 0 }).Hpd
    const r = pmuxKappa(H, Math.round(0.021 * ALPHA_Q), ALPHA_Q)
    return { kappa: r.kappaPhos1, reRot: r.lines[0].reH }
  }, [])
  return (
    <>
      <h3>思考題</h3>
      <Quiz
        title="思考題 1（計算，R1）"
        question={
          <>
            T13 條件下 <Tex>{`p=${n4(p)}`}</Tex>。若相鄰 block 的 GMAC 雜訊<strong>反號</strong>相關 <Tex>{'\\rho=-0.5'}</Tex>，<Tex>{'\\sigma_w^2'}</Tex> 會變成白雜訊時的幾倍？
          </>
        }
        options={[{ label: `約 ${n4(fPos)} 倍` }, { label: `約 ${n4(fNeg)} 倍`, correct: true }, { label: '不變（只看功率）' }, { label: '無法計算' }]}
        answer={
          <>
            <TexBlock>{`\\frac{1+p\\rho}{1-p\\rho}=\\frac{1-${n4(0.5 * p)}}{1+${n4(0.5 * p)}}=${n4(fNeg)}`}</TexBlock>
            反號相關讓相鄰 block 的雜訊互相抵消，係數抖得更少。{n4(fPos)} 是 <Tex>{'\\rho=+0.5'}</Tex> 的答案；「只看功率」正是 R1 要糾正的錯誤。
          </>
        }
      />
      <Quiz
        title="思考題 2（觀念，SSPLL）"
        question={
          <>
            一個 Type-II PLL 的 <Tex>{'\\mathrm{Re}\\{H_{\\mathrm{PD}}\\}'}</Tex> 在低頻為負。raw-x GMAC 的 regressor 是<strong>白色</strong> <Tex>{'\\pm1'}</Tex> code。LMS 會反號發散嗎？
          </>
        }
        options={[{ label: '會，低頻反號就一定發散' }, { label: mt(String.raw`不會：白色 code 的 $C=h_{\mathrm{PD}}[0]=1>0$`), correct: true }, { label: mt(String.raw`要看 $\mu$ 的大小`) }]}
        answer={
          <>
            <Tex>{'C=\\sum_kh[k]R_x[k]'}</Tex>，白色 code 只有 <Tex>{'R_x[0]\\ne0'}</Tex>，所以 <Tex>{'C=h[0]=1'}</Tex>（<Tex>{'L'}</Tex> 嚴格因果）。等價地，<Tex>{'\\frac1{2\\pi}\\int\\mathrm{Re}\\,H\\,d\\Omega=h[0]'}</Tex>：
            低頻的負面積被高頻的正面積補回來。要反號，code 的能量必須集中在反號帶內（例如 PMUX 的相位旋轉）。<Tex>{'\\mu'}</Tex> 的大小只影響「多快」，不影響正負。
          </>
        }
      />
      <Quiz
        title="思考題 3（計算，SSPLL）"
        question={
          <>
            使用者的 L2 迴路（<Tex>{`K_p=${USER_L2.Kp},\\ K_i=${USER_L2.Ki}`}</Tex>）、FCW 小數 <Tex>{'\\alpha=0.021'}</Tex>，PMUX 以 84 MHz 旋轉，那裡 <Tex>{`\\mathrm{Re}\\{H_{\\mathrm{PD}}\\}=${n4(q3.reRot)}`}</Tex>。
            只看基波（<Tex>{`W_1=${n4(PMUX_W1)}`}</Tex>）估計 PHOS mode-1 的 <Tex>{'\\kappa_1'}</Tex>；和把所有譜線都算進去的值比起來差多少？
          </>
        }
        answer={
          <>
            <TexBlock>{`W_1\\,\\mathrm{Re}\\{H_{\\mathrm{PD}}\\}=${n4(PMUX_W1)}\\times(${n4(q3.reRot)})=${n4(PMUX_W1 * q3.reRot)}`}</TexBlock>
            把一個週期的所有譜線都加進去（<code>pmuxKappa</code>）得到 <Tex>{`\\kappa_1=${n4(q3.kappa)}`}</Tex>：其餘 5% 的功率落在高頻，那裡 <Tex>{'\\mathrm{Re}\\{H_{\\mathrm{PD}}\\}>1'}</Tex>，
            所以實際值比基波估計「少負」約 <Tex>{`${n4(q3.kappa - PMUX_W1 * q3.reRot)}`}</Tex>，但仍然是負的——PHOS 反號。
          </>
        }
      />
      <Quiz
        title="思考題 4（計算，R9）"
        question={
          <>
            6-bit two’s complement code（允許 <Tex>{'-32'}</Tex>）、conditional negate、<Tex>{'N=4096'}</Tex>。18-bit 累加器夠嗎？
          </>
        }
        options={[{ label: mt('夠：$6+12=18$') }, { label: `不夠：需要 ${acc.bitsRequired} bits`, correct: true }]}
        answer={
          <>
            <Tex>{'q=-1,\\ x=-32\\Rightarrow qx=+32'}</Tex>；全部同號時總和 <Tex>{`32\\times4096=${acc.maxSum}=2^{17}`}</Tex>，比 18-bit 的正上限 <Tex>{'2^{17}-1'}</Tex> 多 1，wrap 成 <Tex>{'-2^{17}'}</Tex>（符號翻轉）。
            限制 code 為對稱範圍（<Tex>{'\\pm31'}</Tex>）時 18 bits 才夠。
          </>
        }
      />
      <Quiz
        title="思考題 5（觀念，R7）"
        question={
          <>
            規格 §8.4 的例子 <Tex>{'r_s=0.8,\\ b_s=0.2,\\ c_s=1,\\ \\mu=1.2'}</Tex> 在 <Tex>{'N=1'}</Tex> 時 <Tex>{`\\rho=${n4(rho1)}`}</Tex>（發散）。若 GMAC 改成每 16 個快迴路 sample 平均一次再更新，會怎樣？
          </>
        }
        answer={
          <>
            用 lifting 矩陣 <Tex>{'\\mathbf A_{16}'}</Tex> 計算：<Tex>{`\\rho(\\mathbf A_{16})=${n4(rho16)}<1`}</Tex>，收斂。block 平均讓快迴路在更新之間幾乎走完暫態，耦合項 <Tex>{'-\\mu c_sS_N/N'}</Tex> 變小——
            穩定性取決於多速率結構，不能只用單一速率的公式判斷。
          </>
        }
      />
      <Quiz
        title="思考題 6（計算，R10）"
        question={
          <>
            線性模型、固定 <Tex>{'\\mu'}</Tex>、多 block 時 <Tex>{'\\sigma_{w,\\min}^2\\approx\\ln(1/\\varepsilon)/(2K^2f_sT)'}</Tex>。規格把 <Tex>{'\\sigma_{w,\\max}'}</Tex> 減半，校正時間至少要變幾倍？
          </>
        }
        options={[{ label: '2 倍' }, { label: '4 倍', correct: true }, { label: mt(String.raw`$\sqrt2$ 倍`) }]}
        answer={<><Tex>{'\\sigma_w^2\\propto1/T'}</Tex>，所以 <Tex>{'\\sigma_w'}</Tex> 減半要 <Tex>{'T'}</Tex> 變 4 倍（或 <Tex>{'K'}</Tex> 變 2 倍：雜訊更小或相關更大）。</>}
      />

      <Recap
        title="本頁必記"
        formulas={[
          { label: '有色 GMAC 雜訊（R1）', tex: String.raw`\boxed{\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}\cdot\frac{1+p\rho}{1-p\rho}}` },
          { label: '反號條件（SSPLL）', tex: String.raw`\boxed{\mathrm{Re}\{H_{\mathrm{PD}}\}=\frac{1+\mathrm{Re}\{L\}}{|1+L|^2}<0\iff\mathrm{Re}\{T\}>1}` },
          { label: 'PMUX 的 mode-1 幾乎是單頻（SSPLL）', tex: String.raw`\boxed{\kappa_1\approx W_1\,\mathrm{Re}\{H_{\mathrm{PD}}(\alpha f_{\mathrm{ref}})\},\quad W_1=\frac{64\sin^2(\pi/8)}{\pi^2}\approx0.95}` },
          { label: '多速率 lifting（R7）', tex: String.raw`\boxed{\mathbf A_N=\begin{bmatrix}r_s^N&b_sS_N\\-\mu c_sS_N/N&1-\mu c_sb_s\frac{N-S_N}{N(1-r_s)}\end{bmatrix}}` },
          { label: '最佳追蹤增益（R8）', tex: String.raw`\boxed{g^*=\frac{P^-}{P^-+\sigma_y^2}}` },
          { label: '規格反推（R10）', tex: String.raw`\boxed{\sigma_{w,\min}^2\approx\frac{\ln(1/\varepsilon)}{2K^2f_sT_{\max}}}` },
        ]}
        points={[
          '每一個簡化（iid、平穩、單一速率、Gaussian、無溢位）都對應一個研究題目；本頁把它們的「第一步」算出來，但沒有一個是 verified。',
          '獨立假設不成立時，雜訊預算不能只做功率相加：有色雜訊、cyclostationary、cross-spectrum 都會改變答案。',
          mt(String.raw`極性反轉需要「迴路有 peaking」＋「regressor 能量集中在反號帶」兩個條件同時成立；白色或低通 code 不會反號，PMUX 以 $\alpha f_{\mathrm{ref}}$ 旋轉的 one-hot 會。`),
          mt(String.raw`穩定性取決於整個多速率結構：同一個 $\mu$，換一個 GMAC 長度 $N$，結論可能相反。`),
          mt(String.raw`設計要從規格反推：先確認可行集合非空（時間、雜訊、slew、PM 四個約束），再談最佳 $\mu$。`),
        ]}
      />
    </>
  )
}

/** 本頁公式登錄（formulas.ts）：每個 ID 在頁面上只出現一次，作為 Formula Reference 的錨點。 */
export function FormulaList() {
  return (
    <div className="rm-formulas">
      {FORMULAS.map((f) => (
        <div key={f.id} className="rm-formula">
          <TexBlock id={f.id} label={f.title}>
            {f.tex}
          </TexBlock>
          <p className="small muted">
            <ClaimTag kind={f.claim} /> {mt(CONDITIONS_TEX[f.id] ?? f.conditions)}
          </p>
        </div>
      ))}
    </div>
  )
}
