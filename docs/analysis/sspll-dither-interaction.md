# DSM dither、MASH 與 PMUX 隨機旋轉和 sign-LMS 的交互：為什麼 L2-PM45 搭 MASH 在 $\alpha=0.03$ 發散（案例頁 §10b 的推導全文）

> 補充 `docs/analysis/sspll-gos-phos-polarity.md` §11.4、§11.7 與 §19 第 7 條（2026-10-19）。那份文件把「PMUX 隨機旋轉／MASH」列為**只有 sim 證據**，並把「L2-PM45 搭 MASH 在 $\alpha=0.03$ 發散到 10.7 ps」標成**研究假說（理論無法解釋）**。本文把 §8 的模態分析延伸到隨機化的 code：一條 closed form（F-CS.27）重現時域 sim 的每一個 $\kappa_{PHOS}$（最大差 0.008），一條判定式（F-CS.28，只有線性段）說明那一點為什麼**沒有恢復力**（dead zone），並以 105 組 × 8 seeds 的閉迴路驗證；**沒有恢復力之後為什麼會長大（發散）仍是研究假說**——1-bit 大訊號斜率 $\kappa_\infty$ 當 dead zone 的第二段判定被 golden 否決（§5a，2026-10-19 審查更正）；§5b 再把 §7b 的證書工具延伸成「任何頻道都安全」的全頻道證書（F-CS.29），回答「哪個 PM 之後 MASH 不會出事」。
>
> **數字來源**：`analysis/sspll/golden/sspll_golden/dither_interaction.py`（`tools/dither_sweep.py` → `results/dither_interaction.json`；`test_sspll_dither_interaction.py` 12 個測試）。TS port 在 `src/simulation/models/sspll.ts` 的「code source」區塊，`sspll.test.ts` 逐項與 JSON 比對（closed form 相對 $10^{-9}$；acc1／MASH 的序列與 Python 是同一個整數遞迴，實際序列的線性相關與 $\kappa_\infty$——沿 mode 1 與沿最差模態——逐位相同到相對 $10^{-7}$；dq／rot 的隨機數不同，只比統計：絕對 0.05，實測最大差 0.018）。頁面讀的子集是 `src/pages/case-sspll/ditherNumbers.json`。
>
> **結論標籤**：【精確｜指定模型】＝給定 code 隨機部分的特徵函數與自相關時在線性小訊號、凍結權重、$D=0$ 的模型內精確（F-CS.26）；【近似｜需驗證】＝把隨機部分當成 iid 的 closed form（F-CS.27）與建立在它上面的判定式（F-CS.28，只有線性段；dead zone 不判）；【研究假說】＝dead zone 之後「長大」的機制（$\kappa_\infty<0$ 是候選，§5a 的計分不支持它當判準）；全頻道證書（F-CS.29）的不等式在 F-CS.27 的模型內沒有近似，對 MASH 的結論與 PM 門檻仍是【近似｜需驗證】。

## 0. 四種 code source（與 `analysis/sspll/sim/sim.py` 的 `SeqSource` 同一套構造）

以 $\Delta=T_{vco}/8$ 為單位，理想的總相位 $\Phi[n]=8n\alpha$（$\alpha$ 量化到 32 bit；$2^{29}$ 格點 = 一格 $\Delta$）。PMUX 的總指標 $P[n]$ 是整數（選相 $p=P\bmod8$），DTC 的 code 是 $c[n]$：

| source | 構造 | $c[n]$ | DTC range |
|---|---|---|---|
| acc1 | 一階累加器 $P=\lfloor\Phi\rfloor$ | $\rho=\Phi-P\in[0,1)$ | $1\Delta$ |
| dq | dithered quantizer $P=\lfloor\Phi+u\rfloor$，$u\sim U[0,1)$ iid | $\rho+1-b$，$b=\mathbf 1\{\rho+u\ge1\}$（給定 $\rho$ 是 Bernoulli($\rho$)） | $2\Delta$ |
| mash | MASH 1-1-1，$P=\Phi-r$，$r=(1-z^{-1})^2e_3$（第三級餘數的二階差分，$\in(-2,2)$） | $r+2$ | $4\Delta$ |
| rot$M$ | PMUX 指標後加 $m\sim U\{0..M-1\}$ iid：$P'=P+m$ | $\rho-m+(M-1)$ | $M\Delta$ |

共同點：**$P[n]+c[n]=\Phi[n]+$ 常數**。總補償量不變，隨機化只改變「PMUX 多跳幾相、DTC 多補幾格」的分配。

## 1. 載波與散開：任何 code source 的模態斜率（F-CS.26）

§8 把 one-hot regressor 拆成 DFT 模態 $z_m[n]=e^{j2\pi mp[n]/8}$。因為 $P\equiv p\pmod8$，

$$
\begin{aligned}
z_m[n]&=e^{j2\pi mP[n]/8} &&\text{(1) 整數 } P \text{ 與 } p \text{ 只差 8 的倍數}\\
&=e^{j2\pi m\Phi[n]/8}\,e^{-j2\pi m\tilde c[n]/8}\cdot\text{常數}=e^{j2\pi m\alpha n}\,u_m[n],\qquad u_m\equiv e^{-j\theta_m\tilde c},\ \theta_m=\tfrac{\pi m}{4} &&\text{(2) } P=\Phi-\tilde c-\text{常數}，\Phi/8=n\alpha\\
u_m&=\phi_m+\tilde u_m,\qquad\phi_m\equiv E[u_m]=E\big[e^{-j\theta_m\tilde c}\big],\quad E[\tilde u_m]=0 &&\text{(3) 平均（特徵函數）＋零均值起伏}\\
S_{z_m}(f)&=\lvert\phi_m\rvert^2\,\delta(f-m\alpha)+S_{\tilde u_m}(f-m\alpha),\qquad\lvert\phi_m\rvert^2+\textstyle\int S_{\tilde u_m}=1 &&\text{(4) 載波只是平移；}\lvert u\rvert=1\\
\mathrm{Re}\,\kappa_m&=\big\langle\overline{z_m}\,(h_{PD}*z_m)\big\rangle=\sum_{k\ge0}h_{PD}[k]\,\mathrm{Re}\big(e^{-j2\pi m\alpha k}R_{u_m}[k]\big) &&\text{(5) F-CS.3 的時域寫法，}R_u[k]=E[u[n]\overline{u[n-k]}]\\
&=\lvert\phi_m\rvert^2\,\mathrm{Re}\,H_{PD}(\mathrm{frac}(m\alpha))+\sum_{k\ge0}h_{PD}[k]\cos(2\pi m\alpha k)\,\tilde R_m[k],\qquad\tilde R_m[k]\equiv R_{u_m}[k]-\lvert\phi_m\rvert^2 &&\text{(6) } R_u\to\lvert\phi\rvert^2 \text{ 的部分加總成 } \mathrm{Re}H_{PD} \text{ 的 Fourier 級數}
\end{aligned}
$$

$\tilde c$ 是 code 的隨機部分（偏移是常數相位，取模平方後消失）。(6) 的第二項是**短記憶**：$\tilde R_m[k]$ 只有前幾個 $k$ 非零，而且 $h_{PD}[0]=1$ 讓 $\tilde R_m[0]=1-\lvert\phi_m\rvert^2$ 整個算進來、永遠是正項。這就是「載波落在反號帶就是負項、散開的部分幾乎永遠是正項、兩者相加才是 LMS 看到的符號」。

**模態 $m$ 與 $8-m$**：$P$ 是整數，所以 $z_{8-m}=\overline{z_m}$ 精確成立，$\mathrm{Re}\,\kappa_{8-m}=\mathrm{Re}\,\kappa_m$。把隨機部分當成 iid 時（§2）必須用主值角 $\theta_m=\pi\,\mathrm{fold}(m)/4$、$\mathrm{fold}(m)\in[-4,4]$：用 $\theta_7=7\pi/4$ 會把 mode 7 的載波錯算成 $\lvert\mathrm{sinc}^2(7\pi/8)\,\mathrm{sinc}(7\pi/4)\rvert^2\approx0$（程式裡的 `mode_fold`／`modeFold`）。

acc1（$\tilde c=\rho$ 鋸齒、$\tilde R=0$）時 (6) 退回 F-CS.13 的階梯線 $\sum_{\ell\equiv m}w_\ell\,\mathrm{Re}\,H_{PD}(\mathrm{frac}(\ell\alpha))$：$e^{-j\theta\rho}$ 對 $\rho$ 的 Fourier 係數 $v_k=(1-e^{-j\theta})/(j(\theta+2\pi k))$，$\lvert v_k\rvert^2=64\sin^2(\pi\ell/8)/(\pi\ell)^2=w_\ell$，$\ell=m+8k$。【精確｜指定模型】（F-CS.26）

## 2. 四種 code source 的 $\lvert\phi_m\rvert^2$ 與 $\tilde R_m$（F-CS.27）

### 2.1 MASH 1-1-1

把第三級餘數 $e_3$ 當成 iid 均勻 $[0,1)$。均勻數 $e$ 的特徵函數 $\lvert E[e^{-jte}]\rvert=\mathrm{sinc}(t/2)$（$\mathrm{sinc}\,x=\sin x/x$）；獨立和的特徵函數相乘，$\tilde c=e-2e'+e''$ 的係數 $[1,-2,1]$：

$$
\phi_m=\mathrm{sinc}^2\tfrac{\theta_m}{2}\,\mathrm{sinc}\,\theta_m,\qquad
R_m[1]=\mathrm{sinc}^2\tfrac{\theta_m}{2}\,\mathrm{sinc}^2\tfrac{3\theta_m}{2}\ (\text{係數 }[1,-3,3,-1]),\qquad
R_m[2]=\mathrm{sinc}^2\tfrac{\theta_m}{2}\,\mathrm{sinc}^2\theta_m\ (\text{係數 }[1,-2,0,2,-1]),\qquad R_m[k\ge3]=\lvert\phi_m\rvert^2 .
$$

$m=1$：$\mathrm{sinc}(\pi/8)=0.974495$、$\mathrm{sinc}(\pi/4)=0.900316$、$\mathrm{sinc}(3\pi/8)=0.784213$ ⇒ $\lvert\phi_1\rvert^2=0.730986$，$\tilde R_1=[0.269014,\,-0.146966,\,0.038764]$。MASH 留 73% 在載波、27% 散開。

### 2.2 dithered quantizer

給定鋸齒 $\rho$，$b\sim$ Bernoulli($\rho$)，regressor 的條件平均 $v(\rho)=e^{-j\theta\rho}\big((1-\rho)+\rho e^{j\theta}\big)$ 仍是 $\rho$ 的週期函數：Fourier 係數 $v_k$ 給階梯線 $\ell=m+8k$ 的權重，

$$
v_0=\int_0^1 v(\rho)\,d\rho=2\int_0^1(1-\rho)\cos(\theta\rho)\,d\rho=\frac{2(1-\cos\theta)}{\theta^2}=\mathrm{sinc}^2\tfrac\theta2\ \ (=\sqrt{W_1}\text{ 當 }m=1),\qquad\lvert v_0\rvert^2=W_1^2=0.901818 ;
$$

條件變異數 $1-\lvert v(\rho)\rvert^2=2\rho(1-\rho)(1-\cos\theta)$ 對 $\rho$ 平均（$E[\rho(1-\rho)]=\tfrac16$）成**白雜訊** $\tilde R[0]=(1-\cos\theta)/3$（$m=1$：0.097631）；$\sum_k\lvert v_k\rvert^2=1-\tilde R[0]$（Parseval）。dither 把 raw 的 5% 高次階梯線幾乎全變成白雜訊，但載波仍留 90%——所以只「部分有效」。

### 2.3 PMUX 隨機旋轉 $M$ 相

$u=e^{-j\theta\rho}\,e^{j\theta m}$，iid 的 $m$ 把每條階梯線乘上

$$
\lvert D_M(\theta)\rvert^2=\Big\lvert\tfrac1M\sum_{r=0}^{M-1}e^{j\theta r}\Big\rvert^2=\frac{\sin^2(M\theta/2)}{M^2\sin^2(\theta/2)},
$$

殺掉的功率 $1-\lvert D_M\rvert^2$ 變成白雜訊。$M=8$：$\sin(\pi m)=0$ 對每個 $m\ne0$，regressor 完全白化、$\kappa_m\equiv1$（sim 裡 rot8 不分 $\alpha$ 全收斂到 4 fs）。$M=4$：$\lvert D_4\rvert^2=0.426777,\,0,\,0.073223,\,0$（$m=1..4$）——只殺掉 mode 2、4，mode 1 剩 43%。

### 2.4 GOS（regressor $=c$）

$C_{GOS}=\sum_kh_{PD}[k]\tilde R_c[k]$（DC 被 $H_{PD}(0)=0$ 吸收）：dq 的 $c=\rho+1-b$ 給定 $\rho$ 的條件平均恆為 1，鋸齒被抵消，只剩白雜訊 $\tfrac16$ ⇒ $C=h[0]/6$、$\kappa_{GOS}=1$；MASH 的 $c$ 是 MA(2)，$\tilde R_c=[6,-4,1]/12$ ⇒ $C=(6h[0]-4h[1]+h[2])/12$，與 $\alpha$ 無關、永遠為正；rot$M$ 是鋸齒（F-CS.11）加白雜訊 $(M^2-1)/12$。時域 sim 的 $\kappa_G$ 以 $E[c^2]$（含偏移）正規化：dq $\tfrac{1/6}{7/6}=0.1429$（sim 0.1434）、MASH $0.587/4.5=0.130$（sim 0.132–0.135）。

【近似｜需驗證】（F-CS.27）：MASH 的 $e_3$ 實際是三級累加器的確定性序列，$\alpha$ 近有理數時有 tone。

## 3. 數字

`tools/dither_sweep.py` 對 L2（PM 60°）、L2 PM 45°（重新調到 320 MHz）、L3 × 五種 source：

- **closed form vs 實際序列的線性相關**（$2^{17}$ 拍、同一個整數遞迴）：$\kappa_{\min}$ 最大差 0.021（MASH、$\alpha=0.01$：第一級鋸齒週期只有 12.5 拍，第三級餘數有 tone）。
- **closed form vs 時域 sim 存檔**（`results/sim_dither_extract.json`，L2／L3 × dq／MASH／rot4／rot8 × 6 個 $\alpha$，48 點）：最大差 0.008。

| L2（PM 60°） | $\alpha=0.01$ | 0.03 | 0.253 | 0.496 |
|---|---|---|---|---|
| dq：closed／numeric／sim | +0.018／+0.018／+0.018 | +0.013／+0.013／+0.012 | +0.628／+0.632／+0.630 | +0.293／+0.293／+0.293 |
| MASH | +0.242／+0.263／+0.250 | +0.238／+0.234／+0.238 | +0.969／+0.974／+0.976 | +0.765／+0.765／+0.767 |
| rot4 | +0.557／+0.559／+0.559 | +0.559／+0.560／+0.560 | +1.000／+1.000／+1.003 | +1.000／+1.000／+1.008 |
| rot8 | 1／0.999／0.999 | 1／0.999／1.001 | 1／0.999／1.001 | 1／0.999／1.001 |

## 4. 為什麼是 L2-PM45、MASH、$\alpha=0.03$（120 MHz）

F-CS.26 (6) 的四項（$h_{PD}[1]=-(K_p+K_i)$、$h_{PD}[2]=K_p+(K_p+K_i)^2-2(K_p+K_i)$，1 拍延遲的 Type-II 長除法）：

| | $\mathrm{Re}\,H_{PD}(120\ \mathrm{MHz})$ | 載波 $0.731\,\mathrm{Re}\,H$ | $k=0$ | $k=1$ | $k=2$ | $\kappa_1$ | raw 的 $\kappa_1$ |
|---|---|---|---|---|---|---|---|
| L2 PM 45°（$K_p=0.223250$、$K_i=0.0579148$） | $-0.382476$ | $-0.279585$ | $+0.269014$ | $+0.040590$ | $-0.009372$ | **$+0.020646$**（dead zone） | $-0.307267$ |
| L2 PM 60° | $-0.094538$ | $-0.069106$ | $+0.269014$ | $+0.047928$ | $-0.009378$ | $+0.237668$（restoring） | $-0.033401$ |

$\lvert\phi_1\rvert^2$、$\tilde R$ 相同，$h_{PD}[1..2]$ 也差不多，差別全在 $\mathrm{Re}\,H_{PD}(120\ \mathrm{MHz})$：PM 60° 的反號帶到 135 MHz、谷底 $-0.205$ 在 84 MHz；PM 45° 的帶到 163 MHz、谷底 $-0.385$ 在 116 MHz（`params.json` 的 `sensitivity.L2_pm45`；TS 的 `inversionBands`），120 MHz 正在谷底旁邊。MASH 之下 PM 45° 在 98–131 MHz 落進 $\lvert\kappa_1\rvert\le\tau$ 的 dead zone（1 MHz 格點），PM 60° 的整條最低點仍有 $+0.157$（84 MHz，谷底附近）。MASH 把 27% 搬去高頻換來 $+0.30$，剩下的 73% 乘上 $-0.38$ 就是 $-0.28$——剛好抵消。

**dead zone 之後**：$\mathrm{Re}\,\kappa_1=0.0206$ 的實際時間常數約 $N_\tau/\mathrm{Re}\,\kappa_1\approx1211$ blocks（$N_\tau=25$ 是名義時間常數）。在 golden 的觀測窗（$B=1500$ blocks）裡，F-CS.2 的平均模型說這個模態只會縮到 $e^{-\kappa_1B/N_\tau}=e^{-1.24}=0.29$ 倍（實際 MASH 序列上量到的線性相關 $\kappa_1=+0.016$，倍數 0.39）。golden 的 8 個 seeds 卻全部長大，最終中位數 805 fs，是初值 173 fs 的 4.6 倍。**線性理論解釋得了「校不回來」，解釋不了「長大」**。【近似｜需驗證】（前半）

候選解釋是 §10.4 的 1-bit 大訊號：初始 PHOS 誤差 173 fs 已接近 $\sigma_v=200$ fs；在實際 MASH 序列上沿 mode-1 算 1-bit 相關 $\kappa_\infty=\langle\mathrm{sgn}(y)z\rangle/\lvert\langle\mathrm{sgn}(d)z\rangle\rvert$（$2^{16}$ 拍）：PM 45° 是 $-0.258$（同一個方向的線性相關 $-0.0013$），PM 60° 是 $+0.180$。Type-II 的 $h_{PD}$ 有長的負尾巴，面積小、持續時間長：線性看面積得到 0，sign 看持續時間得到負值。**但把它當判準，golden 的 18 個 dead zone 案例錯了 8 個**（§5a），所以這只是【研究假說】。

閉迴路（8 seeds × 1500 blocks，$N=512$、$N_\tau=25$）：PM 45° + MASH 8/8 發散（最終 PHOS rms 中位數 0.80 ps；原 sim 8000 blocks 到 10.7 ps），PM 60° + MASH 8/8 收斂（3.4 fs）。同一點的其他 source：dq $\kappa_1=-0.247$（反號，8/8 發散）、rot4 $+0.442$（restoring）、rot8 $1$。

## 5. 判定式（F-CS.28）

$$
\kappa_{\min}(\alpha;s)=\min_m\mathrm{Re}\,\kappa_m^{(s)}(\alpha):\qquad
\kappa_{\min}<-\tau\ \Rightarrow\ \text{反號（發散）},\qquad
\kappa_{\min}>\tau\ \Rightarrow\ \text{restoring},\qquad
\lvert\kappa_{\min}\rvert\le\tau\ \Rightarrow\ \text{dead zone：線性模型不判} .
$$

$\tau=0.05$ 是經驗門檻（$N_\tau=25$、1500 blocks 時 $\lvert\kappa\rvert=\tau$ 的倍數是 $e^{\pm\tau B/N_\tau}=e^{\pm3}$）。golden 把 105 組（3 個迴路 × 5 種 source × $\alpha\in\{0.002,0.01,0.02,0.03,0.137,0.253,0.496\}$）各跑 8 個 seeds：發散（或收斂）比例的 95% Wilson 區間不含 $\tfrac12$ 才和判定比——**線性段一致 87、不一致 0、dead zone 不判 18**（`results/dither_interaction.json` 的 `mc._summary`；這組數字只算了線性段）。案例頁的實驗 D 用同一個判定（dead zone 不判，n/a）和本頁即時的多 seed 閉迴路比，再和 golden 的 8 seeds 比；$\kappa_\infty$ 只列成提示。【近似｜需驗證】

### 5a. dead zone 的候選判準：計分（2026-10-19 審查更正）

上一版的 F-CS.28 有第二段：「$\lvert\kappa_{\min}\rvert\le\tau$ 時看 $\kappa_\infty$（沿最差模態），$<-\tau$ 發散、$>\tau$ 收斂」，而且 87／0／18 的總結只算了線性段，第二段完全沒有計分。審查用 golden 的 18 個 dead zone 案例計分後否決了它。`tools/dither_sweep.py` 的 `score_candidates`（`--rescore` 只重算計分、不重跑模擬）現在把每一列的候選判定寫進 `mc[*].candidates`、總計寫進 `mc._summary.candidates`；`test_SSPLL_dither_dead_zone_candidates_are_scored_and_two_stage_fails` 與 `sspll.test.ts` 用 TS 的 `twoStageCandidate`／`efoldVerdict` 逐格重算：

| 候選判準 | 105 組：一致／不一致／不判 | 18 個 dead zone | 不一致的組 |
|---|---|---|---|
| F-CS.28：線性段（採用） | 87／0／18 | 0／0／18 | — |
| 兩段：dead zone 看最差模態的 $\kappa_\infty$ | 93／8／4 | 6／8／4 | L2 acc1 0.253、0.496；L2 dq 0.01、0.03；L2-PM45 acc1 0.253；L3 acc1 0.253、0.496；L3 dq 0.01 |
| 兩段：dead zone 看 mode 1 的 $\kappa_\infty$ | 94／3／8 | 7／3／8 | L2 dq 0.01、0.03；L3 dq 0.01 |
| 觀測窗：$G=e^{-\kappa_{\min}B/N_\tau}$ 和 2、$\tfrac14$ 比 | 92／0／13 | 5／0／13 | — |

- **錯的方向都一樣**：$\kappa_\infty$ 很負，MC 卻收斂或停住，沒有反過來的。反例：L3、acc1、$\alpha=0.253$ 沿 mode 4 的 $\kappa_\infty=-0.744$，8/8 收斂（mode 1 的 $\kappa_\infty=+1$；把 seed-7 的 $\varepsilon_k$ 做 DFT，mode 4 只佔初始 PHOS 誤差功率的 0.6%，mode 1＋7 佔 63%，其餘模態收斂後 rms 已低於初值的 1/4）；L3、dq、$\alpha=0.01$ 的 $\kappa_\infty=-0.173$，0/8 發散、0/8 收斂（最終中位數 157 fs，初值 173 fs，停住）。這一點正是案例頁實驗 D 的 preset `code-l3-dq`：TS 的 $\kappa_\infty=-0.181$，4 個 seeds 停在初值附近；舊的兩段判定在那裡是 mismatch，現在是 n/a。
- $\kappa_\infty$ 是「誤差全在這一個模態、振幅遠大於 $\sigma_v$」的極限；閉迴路裡其他模態與 GOS 的誤差、比較器雜訊都會讓 sign 回到線性區。這個說法本身也是【研究假說】。
- **觀測窗**那一列就是 F-CS.2 的平均模型：模態 $m$ 每個 block 乘 $e^{-\kappa_m/N_\tau}$，$B$ 個 block 後最慢的乘 $G$。$G<\tfrac14$ 時每個模態都至少縮那麼多，「收斂」是模型的推論；$G>2$ 只保證最慢的模態長大，rms 還要看它佔多少。門檻 $\kappa_{\mathrm{div}}=N_\tau\ln2/B=0.01155$、$\kappa_{\mathrm{conv}}=N_\tau\ln4/B=0.02310$：0 個不一致、在 dead zone 多判 5 組（L2 acc1 0.01、0.03，L2-PM45 acc1 0.01、dq 0.01，L3 dq 0.02），等於說 $\tau=0.05$ 偏保守、真正的門檻依觀測窗而定。它不參與實驗 D 的 Analytic 欄（只列成指標）。【近似｜需驗證】
- **headline 仍沒有解**：L2-PM45／MASH／0.03 的 $G=0.29$ 在不判區，方向還和 MC（8/8 發散、4.6 倍）相反。【研究假說】下一步：把 GOS 誤差、其他模態與 $\sigma_v$ 一起放進 1-bit 的平均（有限振幅的 $g(A)$ 沿實際誤差方向），或做 cyclostationary 的 DSM 雜訊交叉項（§7）。

換了迴路（PVT 移動帶緣）只要重算 $\mathrm{Re}\,H_{PD}(\alpha)$——$\lvert\phi\rvert^2$ 與 $\tilde R$ 只和 $\theta_m$ 有關。

## 5b. 全頻道證書（F-CS.29）：把 §7b 的證書工具延伸到 code source

F-CS.28 一次判一個頻道；設計時要問的是「任何 $\alpha$ 都安全嗎」。`docs/analysis/sspll-gos-d0-theorem.md`（案例頁 §7b）已經有 $g=\mathrm{Re}\,H_{PD}$ 在所有頻率的**有證明下界** $g_{\min}$：細格點的最小值減 $L_gh/2$，$L_g=2\pi\sum_nn\lvert h_{PD}[n]\rvert$（`gos_certificate.lipschitz`／`kernel_min`，TS 的 `gosLipschitz`／`gosKernelMin`）。F-CS.26 第三行的每一項都能用最壞情況壓住：

$$
\begin{aligned}
\mathrm{Re}\,\kappa_m(\alpha)&=\sum_\ell w_\ell\,g\big(\mathrm{frac}(\ell\alpha)\big)+\sum_{k\ge0}h_{PD}[k]\cos(2\pi m\alpha k)\,\tilde R_m[k] &&\text{(1) F-CS.26 的一般形；}w_\ell\ge0\\
&\ge W_m\,g_{\min}+\sum_{k\ge0}h_{PD}[k]\cos(2\pi m\alpha k)\,\tilde R_m[k],\qquad W_m=\textstyle\sum_\ell w_\ell &&\text{(2) 每條線所在的頻率 }g\ge g_{\min}\\
&\ge W_m\,g_{\min}+\tilde R_m[0]-\sum_{k\ge1}\lvert h_{PD}[k]\rvert\,\lvert\tilde R_m[k]\rvert\ \equiv\ \mathrm{LB}_m &&\text{(3) }h_{PD}[0]=1\text{、}\lvert\cos\rvert\le1
\end{aligned}
$$

$W_m$：acc1 是 1、dq 是 $1-\tilde R_m[0]$、rot$M$ 是 $\lvert D_M\rvert^2$、MASH 是 $\lvert\phi_m\rvert^2$。$\min_m\mathrm{LB}_m>\tau$ 就證明「每一個頻道都 restoring」；$\ge-\tau$ 是「沒有頻道反號」；其餘證書不說話（要回到 F-CS.28 逐一掃）。在 F-CS.27 的模型內下界沒有近似（acc1、dq、rot 的模型本身精確），MASH 繼承 $e_3$ iid 的近似。【精確｜指定模型】（不等式）／【近似｜需驗證】（對 MASH 的結論與門檻）

L2（PM 60°）、MASH、mode 1：$g_{\min}=-0.20591$（谷底 83.8 MHz；格點最小值 $-0.20529$ 減 $L_gh/2=49.09\times2.5\times10^{-5}/2=6.1\times10^{-4}$），

$$
\mathrm{LB}_1=0.7310\times(-0.2059)+0.2690-0.3260\times0.1470-0.2580\times0.0388=-0.1505+0.2690-0.0479-0.0100=+0.0606>\tau ,
$$

mode 2–7 更大，所以 L2（PM 60°）搭 MASH 對**每一個**頻道都 restoring（在 F-CS.27 的模型內）。三個迴路的結果（`tools/dither_certificate.py` → `results/dither_certificate.json`）：

| $\min_m\mathrm{LB}_m$ | L2（PM 60°） | L2 PM 45° | L3 |
|---|---|---|---|
| acc1 | $-0.206$（不說話） | $-0.386$（不說話） | $-0.162$（不說話） |
| dq | $-0.088$（不說話） | $-0.251$（不說話） | $-0.049$（沒有頻道反號） |
| MASH | $+0.061$（**每個頻道 restoring**） | $-0.065$（不說話；掃描：98–131 MHz 是 dead zone） | $+0.109$（每個頻道 restoring） |
| rot4 | $+0.485$ | $+0.408$ | $+0.504$ |
| rot8 | $1$ | $1$ | $1$ |

**哪個 PM**：L2 在每個 PM 重新設計到 320 MHz（1 拍延遲），MASH 的下界隨 PM 單調上升；二分法得到 **PM $\ge58.5^\circ$ 證書成立**（$\mathrm{LB}_{\min}=\tau$ 的那一點），**PM $<47.9^\circ$ 一定有 dead zone 頻道**（1 MHz 掃描的 $\min\kappa_{\min}=\tau$），兩者之間證書不說話但掃描說每個頻道都 restoring。PM 40° 的掃描最小值 $-0.044$ 仍在 dead zone 內，還沒有真正反號的頻道。rot4 在 PM 40°–70° 都有證書（$\mathrm{LB}\ge0.37$）。頁面上的門檻是 7 個 PM 的線性內插（58.55°、48.01°，與二分法差 0.1° 以內）。【近似｜需驗證】

驗證：`test_SSPLL_dither_certificate_is_a_lower_bound_of_every_closed_form` 在 `dither_interaction.json` 存的每一個 $\alpha$、每個迴路、source、模態上檢查 $\mathrm{LB}_m\le\mathrm{Re}\,\kappa_m(\alpha)$；`codeCertificate.test.ts` 把 TS port（`src/pages/case-sspll/codeCertificate.ts`）與 JSON 比到相對 $10^{-6}$，並在另外 60 個 $\alpha$ 上重查不等式。

## 6. 手算（HC-CS.11、HC-CS.12）

HC-CS.11：三個 sinc → $\lvert\phi_1\rvert^2$、$\tilde R[0..2]$ → $h_{PD}[1..2]$ 的 closed form → 四項相加（§4 的表）。HC-CS.12：dq 的 $w_{white}=(1-\cos\theta_1)/3=0.097631$、$v_0=0.949641$、$w_1=0.901818$、$w_{rest}=0.000551$ ⇒ $\kappa_1^{dq}\approx-0.2467$；rot4 的 $\lvert D_4\rvert^2=1/(16\sin^2(\pi/8))=0.426777$ ⇒ $\kappa_1^{rot}=0.4268\times(-0.3073)+0.5732=+0.4421$；$M=8$ ⇒ $0$、$1$。

## 7. 仍未做的

- dead zone 之後「長大」的機制沒有解（§5a）：$\kappa_\infty$ 只沿一個模態、不含 GOS 耦合與其他模態的誤差，當判準在 18 個 dead zone 案例錯 8 個；觀測窗的線性讀法 0 個不一致，但 headline 那一點它也不判。
- MASH 的 iid 假設在小 $\alpha$（第一級鋸齒週期短）最差（差 0.02）；可以用實際序列的 numeric 取代 closed form（`kappa_numeric`，對該筆紀錄精確）。
- LSB dither（`sim.py` 的 `lsb`）沒有納入：sim 已經顯示它無效（code 幾乎不變）。
- 硬體：DTC range 要 2–8 倍，quantization 雜訊增加；本文沒有算 dither 後的 DTC 量化雜訊與 spur。

## 8. 檔案

| 檔案 | 內容 |
|---|---|
| `analysis/sspll/golden/sspll_golden/dither_interaction.py` | 序列、頻譜因子、closed form、numeric、$\kappa_\infty$、閉迴路、判定與交叉比對、dead zone 的候選判準（`hint_verdict`、`two_stage_verdict`、`efold_verdict`；`#region core:` code_sequence、code_factors、kappa_code、divergence_mc） |
| `analysis/sspll/golden/tools/dither_sweep.py` | 105 組 × 8 seeds → `results/dither_interaction.json`、頁面子集 `src/pages/case-sspll/ditherNumbers.json`；`score_candidates`（§5a 的計分，`--rescore` 只重算計分） |
| `analysis/sspll/golden/test_sspll_dither_interaction.py` | 12 個 `test_SSPLL_dither_*`（含 §5b 的兩個證書測試、§5a 的兩個計分測試） |
| `src/simulation/models/sspll.ts`（code source 區塊與其後的候選判準 `kappaInfHint`、`twoStageCandidate`、`efoldVerdict`）、`sspll.test.ts` | TS port 與 golden 比對（含 §5a 的逐格計分與沿最差模態的 $\kappa_\infty$） |
| `analysis/sspll/golden/tools/dither_certificate.py` | 全頻道證書（§5b）→ `results/dither_certificate.json`（三個迴路 × 5 種 source、PM 40°–70° 掃描、PM 門檻的二分法） |
| `src/pages/case-sspll/codeCertificate.ts`、`codeCertificate.test.ts` | 證書的 TS port（用 §7b 的 `gosLipschitz`／`gosKernelMin`）與 golden 比對 |
| `src/pages/case-sspll/sections/S10bDither.tsx`、`experiments/CodeSourceLab.tsx` | 頁面 §10b（F-CS.26–29、HC-CS.11／12、圖 code-sources／code-path、實驗 D、§10b.8 的證書表與 PM 掃描） |
