import { Callout, ModeGate, Prereq, Section, StepDerivation, Tex, TexBlock } from '@/components'
import { useMemo } from 'react'
import { W1, W_SQUARE, analyseAlpha, indicatorLineWeight, kappaInfWorst, kappaRational, largeSignalPeriodic, makeL1 } from '@/simulation/models/sspll'
import { DOC_PHOS, FREF_MHZ, LOOPS, PARAMS, PRED, SIM_CFG, SURE, SURE_GOLDEN, WORKED, type LoopKey } from '../data'
import { Claim, DataTable, Diagram, Formula, HandLink, Kappa, ModelCode, Sci, Src, TryIt, fs, fx, intervalsText, r, tx } from '../common'
import { SignMapExplorer } from '../experiments/SignMapExplorer'

const fold = (fMHz: number): number => Math.min(fMHz, FREF_MHZ - fMHz)

/** §8 PHOS：8 相 circulant 與 DFT 模態（含實驗 B）。 */
export function S08Phos() {
  const lines = WORKED.c_lines
  const wSum = lines.reduce((a, l) => a + l.w, 0)
  const cSum = lines.reduce((a, l) => a + l.w * l.ReH, 0)
  const nearInt = kappaRational(LOOPS.L2, 1, 256)
  const ref50 = kappaRational(LOOPS.L2, 1, 50).refP
  const p50 = DOC_PHOS.points['L2|1/50']
  const alias = DOC_PHOS.alias_rationals
  const chk = DOC_PHOS.circulant_check
  const aliasBound = (k: LoopKey) => W_SQUARE * SURE[k].minReH + (1 - W_SQUARE) * SURE[k].maxReH
  const map = PARAMS.map_j4096
  const web = PARAMS.signmap_summary
  const sim020 = PRED.selected.L2.find((x) => x.alpha === 0.02)
  const sim021 = PRED.selected.L2.find((x) => x.alpha === 0.021)
  const alias247 = PRED.selected.L2.find((x) => x.alpha === 0.247)
  // 「試試看」引用的數字：全部由 TS port 即時計算（與實驗 B 顯示的值相同）
  const tryNums = useMemo(() => {
    // α = 983/8000（491.5 MHz，1/8 正下方）：大訊號 κ∞ 在三種 regressor 下的值
    const ls = (v: string) => kappaInfWorst(largeSignalPeriodic(LOOPS.L2, 983, 8000, SIM_CFG, v))
    // filtered-x 的 Type-I 模型：α·f_ref = 71.5 MHz 時 κ_PHOS 隨 K̂ 的變化
    const fxI = (kHat: number) => analyseAlpha(LOOPS.L2, 71.5 / FREF_MHZ, 'fx:typeI', { typeI: makeL1({ K: kHat }) }).kappaPhos
    // 帶緣 127 MHz：最差模態的 κ
    const edge = analyseAlpha(LOOPS.L2, 127 / FREF_MHZ)
    // 手算例 α = 0.021 的 κ_1（完整的複數；表格只列實部）
    const k1 = analyseAlpha(LOOPS.L2, 0.021).kappaM[0]
    return { lsRaw: ls('raw'), lsAc: ls('ac'), ls1d: ls('1diff'), fx02: fxI(0.2), fx01: fxI(0.1), fx005: fxI(0.05), edge: edge.kappaM[edge.worstMode - 1], k1 }
  }, [])
  return (
    <Section kind="formula" level={2} title="8. PHOS：8 相 circulant 與 DFT 模態" id="cs-8">
      <h3>8.1 一步一步推到特徵值</h3>
      <Prereq title="circulant 矩陣、DFT 向量、模態">
        <ul>
          <li>
            <strong>circulant 矩陣</strong>：每一列都是上一列向右循環移一格的方陣，所以元素只依賴「列號減行號（mod 8）」：<Tex>{r`C_{jk}=c[(j-k)\bmod8]`}</Tex>。8 個 PMUX 相位排成一圈、彼此地位相同，它們的相關矩陣自然長這樣。
          </li>
          <li>
            <strong>DFT 向量</strong> <Tex>{r`v_m[k]=e^{j2\pi mk/8}`}</Tex>（<Tex>{'m=0..7'}</Tex>）：繞一圈剛好轉 <Tex>{'m'}</Tex> 次的複數弦波。把它循環移一格只會多乘一個相位因子，所以它是<strong>任何</strong> circulant 矩陣的特徵向量；對應的特徵值就是第一列{' '}
            <Tex>{'c[\\cdot]'}</Tex> 的 DFT。
          </li>
          <li>
            <strong>模態（mode）</strong>：8 個 PHOS 誤差 <Tex>{r`\delta_k`}</Tex> 可以拆成 8 個 DFT 向量的組合。<Tex>{'m=0'}</Tex> 是 8 相一起偏（共模），<Tex>{'m=1'}</Tex> 是沿著相位繞一圈的一個弦波，<Tex>{'m=4'}</Tex> 是奇偶相交替。LMS 對每個模態各自收斂或發散。
          </li>
        </ul>
      </Prereq>
      <p>
        PHOS 有 8 個權重、8 條 one-hot regressor，平均梯度是一個 <Tex>{r`8\times8`}</Tex> 矩陣。它不用硬算：8 個相位排成一圈、地位相同，所以矩陣是 circulant，可以換到「模態」的座標，一個模態一個模態分開看，每個模態只剩一個數 <Tex>{r`\lambda_m`}</Tex>（模態 <Tex>{'m'}</Tex> 的特徵值；正規化成{' '}
        <Tex>{r`\kappa_m=8\lambda_m`}</Tex>，沒有迴路時等於 1）。
      </p>
      <Diagram id="phos-modes" />
      <p>
        先由上往下看前四格：PMUX 的相位索引 <Tex>{'p[n]'}</Tex> 產生 8 條 one-hot，它們的矩陣只依賴兩個相位的差，所以特徵向量就是 DFT 向量。再看分出來的五格，每一格是一個（或一對共軛的）模態，裡面寫的是它最強那條譜線的頻率與權重：mode 1（藍色）的基波就是 PMUX 繞一圈的頻率{' '}
        <Tex>{r`\alpha f_{ref}`}</Tex>，權重 <Tex>{'W_1'}</Tex> 高達 {fx(W1 * 100, 0)}%；mode 2、3、4 的基波在 2、3、4 倍的頻率，權重是 {fx(64 * indicatorLineWeight(2) * 100, 0)}%、{fx(64 * indicatorLineWeight(3) * 100, 0)}%、{fx(W_SQUARE * 100, 0)}%（mode 4 是 <Tex>{r`\ell=\pm4`}</Tex> 兩條線合計）。共模（<Tex>{'m=0'}</Tex>）只有 DC，被迴路完全吸收。圖上每一格的「權重」就是下面推導第 4 步的{' '}
        <Tex>{r`w_\ell=64\sin^2(\pi\ell/8)/(\pi^2\ell^2)`}</Tex>（<Tex>{r`\ell`}</Tex> 是譜線編號，第 <Tex>{r`\ell`}</Tex> 條線的頻率是 <Tex>{r`\ell\alpha f_{ref}`}</Tex>），「基波」是 <Tex>{r`\ell=m`}</Tex> 的那一條。
      </p>
      <StepDerivation
        steps={[
          {
            tex: r`\mathbf 1\{p[n]=k\}=\textstyle\sum_{\ell} a_\ell\,e^{-j2\pi\ell k/8}\,e^{j2\pi\ell\varphi[n]},\quad \lvert a_\ell\rvert=\Big\lvert\frac{\sin(\pi\ell/8)}{\pi\ell}\Big\rvert`,
            why: <>one-hot 是「相位 <Tex>{r`\varphi`}</Tex> 落在第 <Tex>{'k'}</Tex> 個 1/8 區間」的指示函數。它在 <Tex>{r`\varphi`}</Tex> 上的 Fourier 係數是 sinc 形；平移 <Tex>{'k/8'}</Tex> 只多一個相位因子。</>,
          },
          { tex: r`C_{jk}=\textstyle\sum_\ell \lvert a_\ell\rvert^2\,e^{j2\pi\ell(j-k)/8}\,\Gamma_{\rm eff}(\ell\alpha)`, why: <>代入 §4.3：只依賴 <Tex>{'j-k'}</Tex>，所以 <Tex>{'C'}</Tex> 是 <strong>circulant</strong>（每一列是上一列的循環移位）。</> },
          {
            tex: r`v_m[k]=e^{j2\pi mk/8}\ \Rightarrow\ \frac{v_m^HCv_m}{8}=8\textstyle\sum_{\ell\equiv m\,(8)}\lvert a_\ell\rvert^2\,\Gamma_{\rm eff}(\ell\alpha)\equiv\lambda_m`,
            why: <>circulant 矩陣的特徵向量就是 DFT 向量。<Tex>{r`\sum_j e^{j2\pi(\ell-m)j/8}`}</Tex> 只在 <Tex>{r`\ell\equiv m\ (\mathrm{mod}\ 8)`}</Tex> 時非零，其值為 8。</>,
          },
          {
            tex: r`\kappa_m=8\lambda_m=\textstyle\sum_{\ell\equiv m}w_\ell\,\Gamma_{\rm eff}(\ell\alpha),\quad w_\ell=\frac{64\sin^2(\pi\ell/8)}{\pi^2\ell^2},\quad \textstyle\sum_{\ell\equiv m}w_\ell=1`,
            why: <>乘以 8 正規化；<Tex>{r`\ell`}</Tex> 要同時取正負整數（<Tex>{r`\ell=m+8k`}</Tex>，<Tex>{r`k\in\mathbb Z`}</Tex>）。權重和為 1，因為模態 <Tex>{'m'}</Tex> 的 regressor <Tex>{r`e^{-j2\pi m p[n]/8}`}</Tex> 振幅恆為 1（Parseval），而且沒有 DC 線。</>,
          },
          { tex: r`\lambda_0=\Gamma_{\rm eff}(0)\cdot(\cdots)=0`, why: <><Tex>{'m=0'}</Tex> 是共模，只剩 DC 線，乘上 <Tex>{r`\Gamma(0)=H(1)=0`}</Tex>。</> },
        ]}
      />
      <Formula id="F-CS.13" />
      <p>
        <Claim kind="exact">
          無理數 <Tex>{r`\alpha`}</Tex> 或 <Tex>{r`8\mid Q`}</Tex>。golden：circulant 誤差 <Tex>{r`\le`}</Tex> <Sci v={Math.max(chk.L2.circulant_err, chk.L3.circulant_err)} sig={2} />；ergodic 與 periodic 的 <Tex>{r`\lambda`}</Tex> 差 <Tex>{r`\le`}</Tex>{' '}
          <Sci v={Math.max(chk.L2.ergodic_vs_periodic_err, chk.L3.ergodic_vs_periodic_err)} sig={2} />；<Tex>{r`\lvert\lambda_0\rvert\le`}</Tex> <Sci v={Math.max(chk.L2.lambda0_abs, chk.L3.lambda0_abs)} sig={2} />
        </Claim>
      </p>
      <p>
        <strong>
          <Tex>{r`\kappa_m`}</Tex> 是複數；談正負時看實部。
        </strong>{' '}
        <Tex>{r`\Gamma_{\rm eff}`}</Tex> 是複數，所以 <Tex>{r`\lambda_m`}</Tex>、<Tex>{r`\kappa_m`}</Tex> 一般也是複數，而且 <Tex>{r`\lambda_{8-m}=\overline{\lambda_m}`}</Tex>（<Tex>{'C'}</Tex> 是實數矩陣；mode 7 是 mode 1 的共軛，<Tex>{r`\lambda_4`}</Tex> 是實數）。§4
        說過，決定誤差放大或縮小的是 <Tex>{r`\mathrm{Re}\,\lambda`}</Tex>，所以反號、上下界、sign map 與門檻 <Tex>{r`\tau`}</Tex> 看的都是實部：下面一律寫成 <Tex>{r`\mathrm{Re}\,\kappa_m`}</Tex>，最差的那個記作{' '}
        <Tex>{r`\kappa_{PHOS}=\min_m\mathrm{Re}\,\kappa_m`}</Tex>。虛部 <Tex>{r`\mathrm{Im}\,\kappa_m`}</Tex> 讓誤差旋轉，到 §12 的有限步長判據才用到；那裡要代整個複數，不能只代實部。
      </p>
      <p>
        <strong>共模是精確的 null</strong>：對任何 <Tex>{r`\alpha`}</Tex>（包括 <Tex>{r`8\nmid Q`}</Tex>、occupancy 不均）都成立。因為 <Tex>{'H(1)=0'}</Tex>，全 1 向量同時是右 null（<Tex>{r`C\mathbf1=\langle x\,(h*1)\rangle=0`}</Tex>）與左 null（
        <Tex>{r`\mathbf 1^TC=0`}</Tex>）。物理上，共模就是一個靜態相位偏移，迴路會把它吃掉，所以它無害也不可觀測。
        <Claim kind="exact" />
      </p>
      <p>
        <strong>權重集中在基波</strong>：<Tex>{`w_1=W_1=64\\sin^2(\\pi/8)/\\pi^2=${tx(W1, 5)}`}</Tex>。所以
      </p>
      <TexBlock>{`\\boxed{\\ \\mathrm{Re}\\,\\kappa_1\\approx${tx(W1, 4)}\\,\\mathrm{Re}\\,H_{PD}(\\alpha f_{ref})+\\text{（剩下 ${fx((1 - W1) * 100, 0)}\\% 散在高頻）}\\ }`}</TexBlock>
      <p>
        mode-1 的 regressor 就是「PMUX 以 <Tex>{r`\alpha f_{ref}`}</Tex> 旋轉」這件事本身。旋轉頻率落在反號帶，mode-1 就反號。
      </p>
      <p>
        <strong>
          先算一次（L2，<Tex>{r`\alpha=0.021`}</Tex>，<Tex>{r`\alpha f_{ref}=84`}</Tex> MHz）
        </strong>
        ：
      </p>
      <DataTable
        className="cs-num"
        head={[<>線 <Tex>{r`\ell`}</Tex></>, '折到的頻率 [MHz]', <Tex key="w">{r`w_\ell`}</Tex>, <Tex key="h">{r`\mathrm{Re}H`}</Tex>, '貢獻']}
        rows={[
          ...lines.map((l) => [String(l.l).replace('-', '−'), fx(fold(l.f_MHz), 0), fx(l.w, 5), fx(l.ReH, 5), <Kappa key="c" v={l.w * l.ReH} digits={5} tol={0} />]),
          ['其他', '', fx(1 - wSum, 5), '', <Kappa key="c" v={WORKED.c_8Relam1 - cSum} digits={4} tol={0} />],
          [<strong key="s">合計 <Tex>{r`\mathrm{Re}\,\kappa_1=8\,\mathrm{Re}\,\lambda_1`}</Tex></strong>, '', '1', '', <Kappa key="c" v={WORKED.c_8Relam1} digits={5} />],
        ]}
      />
      <p>
        這是最差點附近，<Tex>{`\\mathrm{Re}\\,\\kappa_1=${tx(WORKED.c_8Relam1, 4)}`}</Tex>（完整的複數是{' '}
        <Tex>{`\\kappa_1=${tx(tryNums.k1.re, 4)}${tryNums.k1.im >= 0 ? '+' : '-'}${tx(Math.abs(tryNums.k1.im), 4)}j`}</Tex>；虛部不改變反號與否，§12 才用到）；L2 在 <Tex>{r`j/4096`}</Tex> 網格上的最差值是 <Tex>{tx(map.L2.worst_kP, 4)}</Tex> @ {fx(map.L2.worst_at_MHz, 1)} MHz。同一點其他模態為{' '}
        <Tex>{`\\mathrm{Re}\\,\\kappa_{2..4}=${WORKED.c_8lam_all.slice(1, 4).map((v) => tx(v, 3)).join(',\\ ')}`}</Tex>，全部 restoring，所以只有 mode-1（以及 mode-7，它是 mode-1 的共軛）反號。
      </p>
      <Src>
        golden 的 <code>worked_examples.json</code>；TS 的 <code>phosLambdaHarmonic</code> 在測試中重現 7 個模態到 <Tex>{r`2\times10^{-9}`}</Tex>。
      </Src>
      <p>
        <strong>換你算：</strong>表中第一列的 <Tex>{r`\mathrm{Re}H(\alpha f_{ref})`}</Tex> 與 <Tex>{r`W_1\mathrm{Re}H`}</Tex> 可以用 §6.2 的手算題 <HandLink id="HC-CS.5" /> 代你自己的 <Tex>{r`\alpha f_{ref}`}</Tex> 重算；想先判斷一個頻道在不在帶內，用 §15.3 的綜合題{' '}
        <HandLink id="HC-CS.8" />。
      </p>

      <h3>8.2 嚴格的 mode-1 界限：「一定反號」與「不可能反號」</h3>
      <p>
        mode-1 有 95% 的權重在基波，但還有 5% 散在別的頻率。只看基波會不會誤判？把剩下的 5% 想成「不知道落在哪裡」，分別放在對你最有利與最不利的頻率，就得到 <Tex>{r`\mathrm{Re}\,\kappa_1`}</Tex> 的上下界（<Tex>{r`\kappa_1`}</Tex> 是複數，不能和實數比大小；能夾的是實部，而反號正好只看實部）：
      </p>
      <Diagram id="mode1-bounds" />
      <p>
        先看最上面一格：算出 PMUX 旋轉頻率 <Tex>{'f_{rot}'}</Tex>（折回 <Tex>{r`[0,f_{ref}/2]`}</Tex> 之後）上的 <Tex>{r`h=\mathrm{Re}\,H_{PD}`}</Tex>。再看兩個六角形的判斷框：第一個問「就算其餘權重全放在 <Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex> 最大的頻率，總和還是負的嗎？」是的話一定反號；第二個問「就算其餘權重全放在{' '}
        <Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex> 最小的頻率，總和還是不為負嗎？」是的話不可能反號。兩個判斷框裡的式子就是下面推導第 2 步的上界與下界（raw regressor 時 <Tex>{r`\Gamma=H_{PD}`}</Tex>）；第一個判斷框移項之後就是第 3 步。
      </p>
      <StepDerivation
        steps={[
          {
            tex: r`\begin{aligned}\mathrm{Re}\,\kappa_1&=W_1\,\mathrm{Re}\Gamma(\alpha)\\&\quad+\textstyle\sum_{\ell\ne1}w_\ell\,\mathrm{Re}\Gamma(\ell\alpha)\end{aligned}`,
            why: <>F-CS.13 兩邊取實部（權重 <Tex>{r`w_\ell`}</Tex> 是實數），再把基波從和裡拿出來。</>,
          },
          {
            tex: r`W_1\mathrm{Re}\Gamma(\alpha)+(1-W_1)\min_f\mathrm{Re}\Gamma\;\le\;\mathrm{Re}\,\kappa_1\;\le\;W_1\mathrm{Re}\Gamma(\alpha)+(1-W_1)\max_f\mathrm{Re}\Gamma`,
            why: <>其餘權重和為 <Tex>{'1-W_1'}</Tex>，每一項夾在 <Tex>{r`\mathrm{Re}\Gamma`}</Tex> 的全域最小與最大之間。</>,
          },
          { tex: r`\text{一定反號}\iff\mathrm{Re}\,H(\alpha f_{ref})<-\frac{(1-W_1)\max\mathrm{Re}H}{W_1}`, why: <>上界 <Tex>{'<0'}</Tex> 就保證反號。</> },
        ]}
      />
      <Formula id="F-CS.14" />
      <DataTable
        className="cs-num"
        head={['', <Tex key="m">{r`\max\mathrm{Re}H`}</Tex>, '門檻', <><strong>一定反號</strong>（<Tex>{r`\alpha f_{ref}`}</Tex>）</>, <>mode-1 <strong>不可能反號</strong></>, 'TS port 求根 [MHz]']}
        rows={(['L2', 'L3'] as const).map((k) => [
          k,
          fx(SURE_GOLDEN[k].max_ReH, 5),
          fx(SURE_GOLDEN[k].threshold_ReH, 5),
          <strong key="s">{`${fx(SURE_GOLDEN[k].sure_MHz[0], 2)}–${fx(SURE_GOLDEN[k].sure_MHz[1], 2)} MHz`}</strong>,
          `> ${fx(SURE_GOLDEN[k].impossible_above_MHz, 2)} MHz`,
          `${fx((SURE[k].sure?.[0] ?? NaN) * FREF_MHZ, 3)}–${fx((SURE[k].sure?.[1] ?? NaN) * FREF_MHZ, 3)}；> ${fx(SURE[k].impossibleAbove * FREF_MHZ, 3)}`,
        ])}
        caption="前四欄是 golden 的 params.json（以 0.004 MHz 的格點回報）；最後一欄是 TS port 的 mode1SureBand 以二分法求出的根，兩者相差 $<0.005$ MHz。"
      />
      <p>
        <Claim kind="exact" />
        但只對<strong>無理數 <Tex>{r`\alpha`}</Tex> 與 <Tex>{r`8\mid Q`}</Tex></strong>（這時 <Tex>{r`8\mid Q`}</Tex> 的離散權重 <Tex>{r`w_1(Q)=\frac{64\sin^2(\pi/8)}{Q^2\sin^2(\pi/Q)}\ge W_1`}</Tex>，界限仍然成立）。
      </p>
      <Prereq title="Rayleigh quotient 與 normal 矩陣（為什麼 $8\nmid Q$ 時界限不能直接用）">
        <ul>
          <li>
            <strong>Rayleigh quotient</strong>：對一個方向 <Tex>{'v'}</Tex>，<Tex>{r`v^HCv/v^Hv`}</Tex> 是「誤差沿 <Tex>{'v'}</Tex> 時，梯度在 <Tex>{'v'}</Tex> 上的分量」。若 <Tex>{'v'}</Tex> 剛好是特徵向量，它就等於特徵值。
          </li>
          <li>
            <strong>normal 矩陣</strong>：有一組互相垂直的特徵向量的矩陣（對稱矩陣、circulant 矩陣都是）。這時任何方向的 Rayleigh quotient 都是特徵值的加權平均，所以「某個方向為負」就代表「有負的特徵值」。
          </li>
          <li>
            不是 normal 時，特徵向量彼此不垂直，Rayleigh quotient 可以跑到所有特徵值的範圍之外，上面的推論就不成立，只能直接算特徵值。
          </li>
        </ul>
      </Prereq>
      <p>
        對 <Tex>{r`8\nmid Q`}</Tex>，<Tex>{'C'}</Tex> 不是 normal 矩陣。這時「某個方向的 Rayleigh quotient 為負」不能推出「有實部為負的特徵值」，所以帶內 <Tex>{r`8\nmid Q`}</Tex> 的反號只有數值證據：golden 檢查了 <Tex>{r`Q\le120`}</Tex>{' '}
        落在帶內的所有有理數，全部反號。
        <Claim kind="approx" />
      </p>

      <h3>8.3 精確 sign map</h3>
      <p>
        <Tex>{r`\alpha=j/4096`}</Tex>（<Tex>{'j=1..2048'}</Tex>），exact periodic，floor 約定，理想注入模型；<Tex>{r`\kappa_{PHOS}=8\min_m\mathrm{Re}\lambda_m`}</Tex>：
      </p>
      <DataTable
        className="cs-fit"
        head={['', <><Tex>{r`\tau=10^{-3}`}</Tex> 的反號帶 [MHz]</>, <Tex key="t">{r`\tau=10^{-2}`}</Tex>, <>最差 <Tex>{r`\kappa_{PHOS}`}</Tex></>, 'GOS 負值']}
        rows={(['L1', 'L2', 'L3'] as LoopKey[]).map((k) => [
          k,
          intervalsText(map[k]['bands_tau0.001']),
          map[k]['bands_tau0.01'].length ? <strong key="b">{intervalsText(map[k]['bands_tau0.01'])}</strong> : '無',
          <>
            <Kappa v={map[k].worst_kP} tol={1e-3} /> @ {fx(map[k].worst_at_MHz, 1)} MHz
          </>,
          <>
            {map[k].n_gos_neg}（最小 <Tex>{r`\kappa_{GOS}`}</Tex> = <Sci v={map[k].min_kG} sig={3} /> @ {fx(map[k].min_kG_at_MHz, 0)} MHz）
          </>,
        ])}
      />
      <p>
        網站資料 <code>signmap_L*.json</code> 用的是另一個網格：<Tex>{r`\alpha=(2j-1)/8000`}</Tex>，也就是 <Tex>{r`\alpha f_{ref}=0.5,1.5,\dots,1999.5`}</Tex> MHz。這個網格上<strong>每一點都有 8 | Q</strong>，所以 PHOS 精確是 circulant。在這個網格上：
      </p>
      <ul>
        <li>
          L2 的 <Tex>{r`\tau=10^{-2}`}</Tex> 帶是 {intervalsText(web.L2['phos_inverted_MHz_tau0.01'])} MHz，最差 {fx(web.L2.worst_kP, 5)} @ {fx(web.L2.worst_kP_at_MHz, 1)} MHz；L3 是 {intervalsText(web.L3['phos_inverted_MHz_tau0.01'])} MHz，最差{' '}
          {fx(web.L3.worst_kP, 5)} @ {fx(web.L3.worst_kP_at_MHz, 1)} MHz。
        </li>
        <li>
          L2 的 <Tex>{r`\tau=10^{-3}`}</Tex> 分模態：m1 在 {intervalsText(web.L2['m1_inverted_MHz_tau0.001'])} MHz；m2 在 {intervalsText(web.L2['m2_inverted_MHz_tau0.001'])} MHz；m3 在 {intervalsText(web.L2['m3_inverted_MHz_tau0.001'])} MHz；m4 在{' '}
          {intervalsText(web.L2['m4_inverted_MHz_tau0.001'])} MHz。
        </li>
      </ul>

      <h3>
        8.4 三種「特殊 <Tex>{r`\alpha`}</Tex>」
      </h3>
      <p>
        <strong>
          (a) 近整數（<Tex>{r`\alpha\to0`}</Tex>）：dead zone，不是穩健反號。
        </strong>{' '}
        one-hot 變成每 <Tex>{r`1/(8\alpha)`}</Tex> 拍換一次相的階梯，<Tex>{r`C\approx(\text{rate})\cdot S_\infty\cdot\sum\Delta^2/2`}</Tex> 加上對 <Tex>{r`1/(8\alpha)`}</Tex> 指數小的尾項。Type-II 的 <Tex>{r`S_\infty=0`}</Tex>，只剩符號不定的尾項。L2 在{' '}
        {fx(FREF_MHZ / 256, 1)} MHz（<Tex>{r`\alpha=1/256`}</Tex>）時 <Tex>{`\\mathrm{Re}\\,\\kappa_{1..4}=${nearInt.km.slice(0, 4).map((k) => (k.re >= 0 ? '+' : '') + tx(k.re, 5)).join(',\\ ')}`}</Tex>：最負的是 m3、m4，不是 m1。這就是不同報告之間「反號帶下緣 3.9／16／22.5 MHz」說法不同的根因：門檻不同（
        <Tex>{r`10^{-12}`}</Tex> 或 <Tex>{r`10^{-3}`}</Tex>），統計的模態也不同。
        <Claim kind="approx">
          數值是精確的，但它的符號會隨 step response 的尾巴、<Tex>{r`\sigma_v`}</Tex>、探測幅度而變，實務上一律當作「不收斂、會漂移」
        </Claim>
      </p>
      <p>
        <strong>(b) 有理數 <Tex>{r`\alpha`}</Tex> 的週期效應。</strong>
      </p>
      <ul>
        <li>
          <Tex>{r`8\mid Q`}</Tex>：occupancy 均勻，<Tex>{'C'}</Tex> 是 circulant，與 ergodic 公式一致。
        </li>
        <li>
          <Tex>{r`8\nmid Q`}</Tex>：occupancy 不均勻（<Tex>{r`\alpha=1/50`}</Tex> 的 8 相佔用率是 {p50.occupancy.map((o) => fx(o, 2)).join('、')}），GOS–PHOS 有耦合（§9）。例：<Tex>{r`\alpha=1/50`}</Tex> 時 L2 的{' '}
          <Tex>{`8\\min_m\\operatorname{Re}\\lambda_m=${tx(p50.eightlam_min, 4)}`}</Tex>（特徵值是複數，這裡取實部最小的那一個）；若改用同一紀錄的開迴路參考正規化（sim 的做法，參考值是 {fx(ref50, 2)} 而不是 1/8），得到 <Tex>{tx(p50.kP_occnorm, 4)}</Tex>。不同報告之間「{fx(sim020?.kP_sim, 4)} @ <Tex>{r`\alpha=0.020`}</Tex>」（時域 sim）與「{fx(sim021?.kP_8lam_ergodic, 3)} @ 84 MHz」（理論）的差異，
          <strong>全部</strong>來自這個正規化與 <Tex>{r`\alpha`}</Tex> 本身不同。
          <Claim kind="exact" />
        </li>
        <li>
          <strong>PE failure</strong>：<Tex>{r`\alpha=1/4`}</Tex> 只走訪 {DOC_PHOS.pe_failure['1/4'].phases_visited} 個相、<Tex>{r`\alpha=1/2`}</Tex> 只走訪 {DOC_PHOS.pe_failure['1/2'].phases_visited} 個相；<Tex>{r`\alpha=k/8`}</Tex> 時{' '}
          <Tex>{r`\rho\equiv0`}</Tex>（var = {DOC_PHOS.pe_failure['1/8'].var_rho}），GOS 不可觀測。
        </li>
      </ul>
      <p>
        <strong>
          (c) <Tex>{r`\alpha\approx\tfrac14,\tfrac12`}</Tex> 的 alias 區。
        </strong>{' '}
        這兩個頻道的 <Tex>{r`\alpha f_{ref}`}</Tex> 是 {fx(FREF_MHZ / 4, 0)}、{fx(FREF_MHZ / 2, 0)} MHz，mode-1 的基波離反號帶很遠。但別的模態的基波會被取樣「折回」低頻，還是可能掉進反號帶。先看圖：
      </p>
      <Diagram id="alias" />
      <p>
        先看前三格：mode 4 的 regressor 是 <Tex>{r`(-1)^{p[n]}`}</Tex>（奇偶相交替）。<Tex>{'p[n]'}</Tex> 是奇數還是偶數，只看 <Tex>{r`4\varphi[n]`}</Tex> 的小數部分落在前半還是後半；而 <Tex>{r`4\varphi`}</Tex> 每拍前進 <Tex>{r`4\alpha`}</Tex>，<Tex>{r`\alpha=\tfrac14`}</Tex>{' '}
        時剛好前進一整圈，看起來完全不動。<Tex>{r`\alpha`}</Tex> 稍微偏離 <Tex>{r`\tfrac14`}</Tex>，每拍只多走 <Tex>{r`4(\alpha-\tfrac14)`}</Tex> 圈，這條 regressor 就變成一個很慢的方波，頻率是 <Tex>{r`4\lvert\alpha-\tfrac14\rvert f_{ref}`}</Tex>——PMUX 明明轉得很快，mode 4 卻落在低頻，這就是
        alias。再看六角形的判斷框與紅色那一格：方波的基波權重是 <Tex>{`8/\\pi^2\\approx${tx(W_SQUARE, 2)}`}</Tex>，比 mode-1 的 <Tex>{`W_1\\approx${tx(W1, 2)}`}</Tex> 小；就算基波落在 <Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex> 最負的頻率，其餘權重全放在最有利的頻率時 <Tex>{r`\kappa`}</Tex>{' '}
        的上界仍然是正的，所以不能保證反號，實際上是正負近乎抵消的 dead zone。圖上的 <Tex>{r`4\lvert\alpha-\tfrac14\rvert f_{ref}`}</Tex> 就是下面第一點的 <Tex>{r`4\delta`}</Tex>（乘上 <Tex>{r`f_{ref}`}</Tex>），紅色那一格的不等式就是清單後面那一句。
      </p>
      <p>
        把式子寫出來：設 <Tex>{r`\alpha=\tfrac14+\delta`}</Tex>（<strong>只在這一小段</strong>，<Tex>{r`\delta`}</Tex> 是頻道偏移 <Tex>{r`\alpha-\tfrac14`}</Tex>，不是權重誤差），每拍 <Tex>{'p'}</Tex> 前進 <Tex>{r`2+8\delta`}</Tex>：
      </p>
      <ul>
        <li>
          m4 的 regressor <Tex>{r`(-1)^{p[n]}=e^{j\pi p[n]}`}</Tex> 是頻率 <Tex>{r`4\delta`}</Tex> 的<strong>方波</strong>，基波權重是 <Tex>{`8/\\pi^2=${tx(W_SQUARE, 4)}`}</Tex>。
        </li>
        <li>
          在 <Tex>{r`\alpha=\tfrac12+\delta`}</Tex> 附近，m2 是頻率 <Tex>{r`2\delta`}</Tex> 的階梯相量（基波權重同樣 {fx(W_SQUARE, 2)}），m4 是 <Tex>{r`4\delta`}</Tex>。
        </li>
      </ul>
      <p>
        因為 <Tex>{`${tx(W_SQUARE, 2)}\\min\\mathrm{Re}H+${tx(1 - W_SQUARE, 2)}\\max\\mathrm{Re}H>0`}</Tex>（L2：{fx(aliasBound('L2'), 4)}；L3：{fx(aliasBound('L3'), 4)}），<strong>alias 區的反號永遠不能保證</strong>，只會是近乎抵消的 dead zone。在 8 | Q 的網格上{' '}
        <Tex>{r`\lvert\kappa_{PHOS}\rvert\lesssim5\times10^{-3}`}</Tex>；<Tex>{r`8\nmid Q`}</Tex> 的有理數可以到 <Tex>{tx(alias.L2.worst[0][3], 4)}</Tex>（L2，<Tex>{`\\alpha=${alias.L2.worst[0][0]}/${alias.L2.worst[0][1]}`}</Tex>），其次{' '}
        <Tex>{`${alias.L2.worst[1][0]}/${alias.L2.worst[1][1]}`}</Tex>：<Tex>{tx(alias.L2.worst[1][3], 4)}</Tex>。L2 在 <Tex>{r`Q\le400`}</Tex>、mode-1 帶緣以上有 {alias.L2.n_hits} 個 PHOS 反號的有理數，其中離 <Tex>{r`\tfrac14`}</Tex> 或{' '}
        <Tex>{r`\tfrac12`}</Tex> 超過 <Tex>{r`\pm0.02`}</Tex> 的有 {alias.L2.n_far} 個；L3 則是 {alias.L3.n_hits} 個。
        <Claim kind="exact">界限部分</Claim>
      </p>
      <Callout kind="info" title="所以不能只看 $\mathrm{Re}\,H_{PD}(\alpha f_{ref})$ 一個點">
        <p>
          單線近似在近整數時過度悲觀、在 alias 區完全看不到問題（§10 的表）。完整的判斷要看<strong>每個模態</strong>的加權和——下面的實驗就是做這件事。
        </p>
      </Callout>

      <h3>8.5 動手觀察</h3>
      <SignMapExplorer />
      <TryIt
        items={[
          <>預設（L2、83.5 MHz、raw）：mode 1 與 mode 7 的長條是紅的（<Tex>{`\\mathrm{Re}\\,\\kappa\\approx${tx(web.L2.worst_kP, 2)}`}</Tex>），其餘是藍的。把 regressor 模式換成「一階差分」：全部變藍——同一個 <Tex>{r`\alpha`}</Tex>、同一個迴路，只改了 GMAC 的 regressor。</>,
          <>把 <Tex>{r`\alpha f_{ref}`}</Tex> 拉到 140 MHz 以上：mode-1 的下界變成正的；再拉到 988.5 MHz（<Tex>{r`\alpha\approx\tfrac14`}</Tex>）：這次輪到 mode 4 掉進 dead zone，而單線近似仍然顯示 +{fx(alias247?.kP_single_line, 1)}。</>,
          <>
            輸入 80 MHz（<Tex>{r`\alpha=1/50`}</Tex>，<Tex>{r`8\nmid Q`}</Tex>）：指標列的「精確週期 <Tex>{r`\kappa_{PHOS}`}</Tex>」（{fx(p50.kP_occnorm, 3)}，以該紀錄的開迴路參考 {fx(ref50, 2)} 正規化）與 ergodic（{fx(p50.ergodic_min, 3)}）不同，並出現 GOS–PHOS 耦合。
          </>,
          <>
            491.5 MHz（<Tex>{r`\alpha`}</Tex> 在 1/8 正下方）：小訊號全部 restoring，但「大訊號 <Tex>{r`\kappa_\infty`}</Tex>」是 {fs(tryNums.lsRaw, 3)}——看警告的解釋。換成 ac：縮到 {fs(tryNums.lsAc, 3)}（Type-II 的 near-grid 只去平均還不夠，仍略為負）；換成一階差分才變成{' '}
            {fs(tryNums.ls1d, 3)}。把迴路換成 L1 再試一次 ac，就會是正的。
          </>,
          <>選「D = +1」：隨便哪個 <Tex>{r`\alpha`}</Tex> 幾乎都是紅的。</>,
          <>
            把 <Tex>{r`\alpha f_{ref}`}</Tex> 設為 71.5 MHz，選「filtered-x：Type-I 模型」：<Tex>{r`\hat K=0.2`}</Tex> 時 <Tex>{`\\kappa_{PHOS}=${tx(tryNums.fx02, 4)}`}</Tex>；降到 0.1（已低於 §11.2 的臨界值）時會出現「保證消失」的警告，但{' '}
            <Tex>{`\\kappa_{PHOS}=${tx(tryNums.fx01, 4)}`}</Tex> 仍為正；降到 0.05 才真的反號（<Tex>{`\\kappa_{PHOS}=${tx(tryNums.fx005, 4)}`}</Tex>）。臨界值是「對任何 <Tex>{r`\alpha`}</Tex> 都保證安全」的界線，不是「一低於就反號」的界線。
          </>,
          <>
            把 <Tex>{r`\alpha f_{ref}`}</Tex> 設為 127 MHz、<Tex>{r`N_\tau=25`}</Tex>（<Tex>{r`N_\tau`}</Tex> 的單位是 block：沒有迴路、8 個相位被選到的次數一樣多（<Tex>{r`H\equiv1`}</Tex>、<Tex>{r`\kappa=1`}</Tex>）時 LMS 每個 block 修掉誤差的 <Tex>{r`1/N_\tau`}</Tex>，所以叫開迴路的名義時間常數；它越小，步長越大，§12 再細講）：<Tex>{`\\kappa_1=${tx(tryNums.edge.re, 4)}+${tx(tryNums.edge.im, 4)}j`}</Tex>，<Tex>{r`\mathrm{Re}\,\kappa>0`}</Tex> 但{' '}
            <Tex>{`\\lvert\\kappa\\rvert^2/(2N_\\tau)=${tx((tryNums.edge.re ** 2 + tryNums.edge.im ** 2) / 50, 4)}`}</Tex> 更大，有限步長判據顯示不穩定；把 <Tex>{r`N_\tau`}</Tex> 加大到 50 就穩定了（§12）。
          </>,
        ]}
      />
      <ModeGate min="engineer">
        <ModelCode region="phosLambda" title="PHOS 模態特徵值 $\lambda_m$ 的 ergodic 諧波和（實驗 B 的長條圖就是這段程式算的）" caption="每個模態 $m$ 只收集 $\ell\equiv m\ (\mathrm{mod}\ 8)$ 的譜線；$\lambda_0=0$（共模）。尾項用 $\mathrm{Re}\,\Gamma$ 的等分佈平均與 Hurwitz zeta 補上。" />
      </ModeGate>
    </Section>
  )
}
