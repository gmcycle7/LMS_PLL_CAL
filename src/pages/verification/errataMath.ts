/**
 * 每一項勘誤的「數學重點」（KaTeX）：規格原式 → 修正式，加一句話摘要。
 *
 * src/data/errata.json 的 location / problem / correction / evidence 是 docs/validation.md 的原文（含 Unicode 拼成的公式）；
 * 這裡把同一件事的**核心公式**改寫成 LaTeX，放在勘誤卡片最上方（docs/teaching-style.md §3：數學一律 KaTeX）。
 * 式中的數字全部取自該勘誤的原文（不是另外算的）；能用章節模型重算的數字，另見 acceptance.computeErrataEvidence()。
 * data.test.ts 會檢查：49 項都有、每段 TeX 都能被 KaTeX 解析、gist 的 `$…$` 成對，
 * 以及式中的每個小數／三位以上的整數都逐字出現在 errata.json 該勘誤的文字裡（兩個合理捨入的例外列在測試中）。
 */
const r = String.raw

export interface ErratumMath {
  /** 一句話摘要（可含 `$…$` 行內 TeX） */
  gist: string
  /** 規格原文的寫法（TeX；純文字勘誤為 null） */
  spec: string | null
  /** 網站採用的修正（TeX） */
  fix: string
}

export const ERRATA_MATH: Record<string, ErratumMath> = {
  E01: {
    gist: r`$1.34$ 是 MSE-LMS 的固定點；1-bit Sign-LMS 的固定點隨 $\sigma_v$ 從 $1.4$（無雜訊）連續變到 $1.34$（雜訊主導）。`,
    spec: r`w^*=a+c\,\frac{E[x^4]}{E[x^2]}=1.34\qquad(\text{未說明演算法與 }\sigma_v)`,
    fix: r`\begin{aligned}\text{MSE-LMS：}&\ E[x\,e]=0\ \Rightarrow\ w^*=a+c_3\frac{E[x^4]}{E[x^2]}=\frac{67}{50}=1.34\\[2pt]\text{Sign-LMS：}&\ \sum_xp_x\,x\,\operatorname{erf}\!\Big(\frac{(a-w^*)x+c_3x^3}{\sqrt2\,\sigma_v}\Big)=0\ \Rightarrow\ w^*\approx1.34+\frac{3.456\times10^{-4}}{\sigma_v^2}\\[2pt]\sigma_v=0:\ &\ E[x\operatorname{sign}(e)]=0\ \Rightarrow\ w^*=1.4\end{aligned}`,
  },
  E02: {
    gist: r`偶數 $N$ 有 tie（$S_N=0$）；規格的 CLT 式近似的是「tie 平分」，照字面算 $P(S_{100}>0)$ 只有 $49.2\%$。`,
    spec: r`P(G_N>0)\approx\Phi\!\Big(\frac{m\sqrt N}{\sqrt{1-m^2}}\Big)\qquad(N=100,\ 10^3,\ 10^4)`,
    fix: r`\Phi\!\Big(\frac{m\sqrt N}{\sqrt{1-m^2}}\Big)\approx\begin{cases}P(S_N>0)&N\ \text{奇數}\\[2pt]P(S_N>0)+\tfrac12P(S_N=0)&N\ \text{偶數}\end{cases}\qquad P^{\rm even}_{\rm strict}\approx\Phi\!\Big(\frac{Nm-1}{\sqrt{N(1-m^2)}}\Big)`,
  },
  E03: {
    gist: r`靜態式假設 offset $b$ 的 DC 原封不動到達 comparator；type-II 主迴路會強制 $E[q]=0$，分母從 $E[x^2]$ 變成 $\operatorname{Var}(x)$。`,
    spec: r`w^*=a+\frac{b\,E[x]+E[x\,d(x)]+E[xu]}{E[x^2]}`,
    fix: r`\begin{aligned}\text{(A) DC 不被消除：}&\ w^*=a+\frac{bE[x]+E[xd]+E[x\varepsilon_{cc}]}{E[x^2]}\\[2pt]\text{(B) shared BBPD，}E[q]=0：&\ w^*\approx a+\frac{\operatorname{Cov}(x,d+\varepsilon_{cc})}{\operatorname{Var}(x)}\\[2pt]\text{(C) 線性 PD + 獨立 comparator：}&\ w^*\approx a+\frac{bE[x]+\operatorname{Cov}(x,d+\varepsilon_{cc})}{\operatorname{Var}(x)}\end{aligned}`,
  },
  E04: {
    gist: r`經 $H_{\rm PD}(1)=0$ 觀測時，global offset $b$ 是「完全不可觀察」，null space 從 1 維變成 2 維。`,
    spec: r`\dim\mathcal N(\mathbf R)=1\qquad(\text{common-mode「更難觀察」})`,
    fix: r`H_{\rm PD}(z{=}1)=0\ \Rightarrow\ u_b\to0,\ \ \sum_iu_i=0\ \Rightarrow\ \dim\mathcal N(\mathbf R_u)=2\quad(b\ \text{方向}+a_i\ \text{common-mode})`,
  },
  E05: {
    gist: r`§10.1 的數字隱含 $K_q\equiv1$；配上 §5 的物理 $K_q$ 會差兩個數量級。`,
    spec: r`p_{\rm slow}=1-\mu\lambda_{\min}=0.995\qquad(\mu=0.5)`,
    fix: r`p_i=1-\mu K_q\lambda_i:\qquad\mu K_q=0.5\ \Rightarrow\ 0.995\ (598\ \text{blocks});\qquad\mu=0.5\,\mathrm{fs},\ K_q=0.00798\,\mathrm{fs^{-1}}\ \Rightarrow\ 0.99996011\ (75{,}091\ \text{blocks})`,
  },
  E06: {
    gist: r`$12.9\,\mathrm{kHz}$ 是 $-3\,\mathrm{dB}$ corner，不是等效雜訊頻寬；拿它積分白雜訊會低估 $\sigma_w$ 約 $20\%$。`,
    spec: r`\text{Noise BW}\approx12.9\,\mathrm{kHz}`,
    fix: r`f_{3\rm dB}=\frac{f_u}{2\pi}\arccos\!\Big(1-\frac{(1-p)^2}{2p}\Big)=12.931\,\mathrm{kHz},\qquad\mathrm{ENBW}=\frac{f_u}{2}\cdot\frac{1-p}{1+p}=20.289\,\mathrm{kHz},\qquad\sigma_w^2=S_w^{(1)}(0)\cdot\mathrm{ENBW}`,
  },
  E07: {
    gist: r`§5 的 $G_N$ 是總和、而且沒有乘 $x$，卻與 §0 的 block 平均 $G_k$ 同名；$\operatorname{sign}(0)$ 與 tie 也沒有定義。`,
    spec: r`G_N=\sum_{i=1}^Nq_i,\qquad q=\operatorname{sign}(e)`,
    fix: r`S_N=\sum_{i=1}^Nq_i\ (\text{sum}),\quad G=\frac{S_N}{N}\ (\text{average});\qquad q=\begin{cases}+1&e\ge0\\-1&e<0\end{cases};\qquad S_N=0\ \text{時須指定 tie rule}`,
  },
  E08: {
    gist: r`$\pm25$ 是 $\mathbf M=0.5\,\mathbf R^{-1}$ 的元素（$\mathbf R^{-1}$ 本身約 $\pm50$），而且只在 $K_q\equiv1$ 時 pole 才是 $0.5$。`,
    spec: r`\mathbf M=0.5\,\mathbf R^{-1},\qquad\text{「反矩陣元素約 }\pm25\text{」}`,
    fix: r`\mathbf M=\gamma\,(K_q\mathbf R)^{-1};\qquad\mathbf R^{-1}=\begin{bmatrix}50.25&-49.75\\-49.75&50.25\end{bmatrix},\qquad0.5\,\mathbf R^{-1}=\begin{bmatrix}25.13&-24.87\\-24.87&25.13\end{bmatrix}`,
  },
  E09: {
    gist: r`block-rate 的 $S_w$ 不能直接放進 sample-rate 的卷積：要先經 ZOH（$\mathrm{sinc}^2$ 形狀、頻率軸縮 $N$ 倍）。`,
    spec: r`S_{\delta t}(e^{j\Omega})=\frac{1}{2\pi}\int S_x(e^{j\nu})\,S_w(e^{j(\Omega-\nu)})\,d\nu\qquad(S_w\ \text{定義在 block rate})`,
    fix: r`\delta w[n]=\delta w_{\lfloor(n-n_c)/N\rfloor},\qquad S_w^{(f_s)}(e^{j\Omega})=\frac1N\left[\frac{\sin(N\Omega/2)}{\sin(\Omega/2)}\right]^2S_w^{(f_u)}(e^{jN\Omega})`,
  },
  E10: {
    gist: r`四個「頻寬」不是同一個數：T14 改成分別驗證 exact $-3\,\mathrm{dB}$、兩個近似與 ENBW。`,
    spec: r`f_{\rm cal,BW}\approx\frac{1-p}{2\pi}f_u\approx\frac{-\ln p}{2\pi}f_u\approx12.9\,\mathrm{kHz}`,
    fix: r`\underbrace{12.931}_{\text{exact}},\ \ \underbrace{12.924}_{-\ln p},\ \ \underbrace{12.401}_{1-p}\ \ \mathrm{kHz};\qquad\mathrm{ENBW}=\frac{f_u(1-p)}{2(1+p)}=20.289\,\mathrm{kHz}\approx\frac{\pi}{2}f_{3\rm dB}`,
  },
  E11: {
    gist: r`$1.34$ 只對五值等機率 code 成立；preset 必須連同 code 分布一起存檔。`,
    spec: r`a=1,\ c_3=0.1\ \Rightarrow\ w^*=1.34\qquad(\text{未寫 code 分布})`,
    fix: r`w^*=a+c_3\frac{E[x^4]}{E[x^2]}=\begin{cases}1.34&x\in\{-2,\ldots,2\}\ \text{等機率}\\1.30&x\sim\mathcal N(0,1)\\1.10&x=\pm1\end{cases}`,
  },
  E12: {
    gist: r`§11 的 $u[n]$ 是 code-correlated disturbance，和 §0 的 filtered regressor $u=h*x$ 同名；改名 $\varepsilon_{cc}$、係數 $\kappa$。`,
    spec: r`e[n]=(a-w)x[n]+b+d(x[n])+u[n]+v[n]`,
    fix: r`e[n]=(a-w)x[n]+b+d(x[n])+\varepsilon_{cc}[n]+v[n];\qquad\varepsilon_{cc}=\kappa x\ \Rightarrow\ w^*=a+\kappa;\qquad w^*=a+\frac{B_{\rm bias}}{C},\ \ C=E[x\,(h*x)]`,
  },
  E13: {
    gist: r`單位統一：正規化 code 無因次、係數帶 fs；$g=\mu K$ 才是無因次的 loop gain（T09 的 $\mu=1.2$ 其實是 $g$）。`,
    spec: r`u:\ \text{「和 PD error 單位一致」};\qquad K\ \text{未定義};\qquad\mu=10\,\mathrm{fs}\ \text{與}\ \mu=1.2`,
    fix: r`[x]=[u]=1,\quad[a]=[w]=\mathrm{fs},\quad K:=K_qC=-\frac{\partial E[G]}{\partial w}\ [\mathrm{fs^{-1}}],\quad g:=\mu K\ [1],\quad[\mu]=\mathrm{fs}`,
  },
  E14: {
    gist: r`還有第三種界限：樣本路徑（almost-sure）收斂到 $\mu\approx2.42$；$\tfrac23<\mu<2.42$ 時路徑收斂但 $E[\delta^2]$ 發散（heavy tail）。`,
    spec: r`\text{mean：}0<\mu<2,\qquad\text{mean-square：}0<\mu<\tfrac23`,
    fix: r`\underbrace{0<\mu<\tfrac23}_{E[\delta_n^2]\to0}\ \subset\ \underbrace{0<\mu<2}_{E[\delta_n]\to0}\ \subset\ \underbrace{0<\mu<2.4212}_{\delta_n\to0\ \text{a.s.}},\qquad\lambda(\mu)=E\big[\ln|1-\mu x^2|\big]<0`,
  },
  E15: {
    gist: r`對常數 $32.4=162/5$，一階 ΔΣ「必然」是週期 5，而且就是 toggle 的循環移位：總誤差功率 $0.24\,\mathrm{LSB^2}$，不是白雜訊模型的 $2/12$。`,
    spec: r`\text{一階 EFB 對常數有理輸入「可能」產生週期序列}`,
    fix: r`r[n]=\operatorname{frac}\!\big(r[0]+n\,c\big),\ \ c=\frac{P}{q}\ (\text{最簡})\ \Rightarrow\ \text{週期恰為 }q;\qquad F\text{-bit 定點：週期}=\frac{2^F}{\gcd(K,2^F)}`,
  },
  E16: {
    gist: r`$\varepsilon$ 是相對縮減比，不是絕對誤差；還要檢查區間是否非空。`,
    spec: r`\frac{1-\varepsilon^{1/B}}{K_{\min}}\le\mu\le\frac{1}{K_{\max}}\qquad(\text{「降至 }\varepsilon\text{」})`,
    fix: r`|E[\delta_B]|\le\varepsilon|\delta_0|\ \ (0<\varepsilon<1)\ \Rightarrow\ \frac{1-\varepsilon^{1/B}}{K_{\min}}\le\mu\le\frac{1}{K_{\max}};\qquad\text{非空}\iff B\ge\frac{\ln\varepsilon}{\ln(1-K_{\min}/K_{\max})}`,
  },
  E17: {
    gist: r`jitter 隨 code 改變時，Sign-LMS 的固定點變成 $1/\sigma_v(x)$ 加權；此時 code centering 不再保證 offset 不造成 bias。`,
    spec: r`\sigma_v=\text{常數}\qquad(\text{隱含假設})`,
    fix: r`K_q(x)=\frac{\sqrt{2/\pi}}{\sigma_v(x)}\ \Rightarrow\ w^*\approx a+\frac{E\big[x\,B(x)/\sigma_v(x)\big]}{E\big[x^2/\sigma_v(x)\big]},\qquad B(x)=b+d(x)+\varepsilon_{cc}`,
  },
  E18: {
    gist: r`sum 與 average 的標準差差 $N$ 倍；方向機率 $P(S_N>0)=P(G>0)$ 則與尺度無關。`,
    spec: r`G_N=\sum_iq_i,\qquad\operatorname{Var}(G_N)=N(1-m^2)`,
    fix: r`E[S_N]=Nm,\ \ \operatorname{Var}(S_N)=N(1-m^2);\qquad E[G]=m,\ \ \operatorname{Var}(G)=\frac{1-m^2}{N}`,
  },
  E19: {
    gist: r`2 倍的差距來自觀測路徑固有的 1-block latency；把主 PLL 調快（$r\to0$）也不會消失。`,
    spec: r`\text{簡化：}0<\mu<2;\qquad\text{完整：}0<\mu<1\qquad(\text{歸因於時間尺度分離})`,
    fix: r`z^2-(1+r)z+r+\mu bc=0\ \Rightarrow\ 0<\mu bc<1-r;\qquad\text{quasi-static：}0<\mu bc<2(1-r)\quad(\text{恰差 2 倍，與 }r\text{ 無關})`,
  },
  E20: {
    gist: r`wrap 的週期是 $360^\circ$；若誤寫成 $\theta\bmod180^\circ$，極性錯誤會被顯示成正的 margin。`,
    spec: r`M_{\rm polarity}=90^\circ-|\operatorname{wrap}_{180}(\theta)|\qquad(\operatorname{wrap}_{180}\ \text{未定義})`,
    fix: r`\operatorname{wrap}_{180}(\theta)\triangleq\big((\theta+180^\circ)\bmod360^\circ\big)-180^\circ\in[-180^\circ,180^\circ),\qquad M_{\rm polarity}=\arcsin(\cos\theta)`,
  },
  E21: {
    gist: r`雜訊放大看的是 $\mathbf M$ 在慢 eigenvector 上的增益 $\gamma/(K_q\lambda_{\min})$，不是元素大小。`,
    spec: r`\text{「反矩陣元素約 }\pm25\text{」}`,
    fix: r`\mathbf R^{-1}=\frac{1}{1-\rho^2}\begin{bmatrix}1&-\rho\\-\rho&1\end{bmatrix}\approx\begin{bmatrix}50.25&-49.75\\-49.75&50.25\end{bmatrix};\qquad\text{慢模式增益}\ \frac{\gamma}{K_q\lambda_{\min}}=50`,
  },
  E22: {
    gist: r`$\lambda$ 同時表示 eigenvalue 與 regularization；兩種 regularizer 的單位與 pole 公式都不同。勘誤原文把它們分別寫成 $\varepsilon_R$、$\varepsilon_J$（下式）；本站 Ch10 沿用勘誤 E34 的改名，統一記為 $\lambda_{\rm reg}$，並標明它是加在 $\mathbf R$ 還是 $\mathbf J^T\mathbf J$ 上。`,
    spec: r`(\mathbf R+\lambda\mathbf I)^{-1},\qquad(\mathbf J^T\mathbf J+\lambda\mathbf I)^{-1},\qquad\lambda_i`,
    fix: r`\mathbf M=\gamma\big(K_q(\mathbf R+\varepsilon_R\mathbf I)\big)^{-1}:\ p_i=1-\frac{\gamma\lambda_i}{\lambda_i+\varepsilon_R};\qquad\mathbf M=-\gamma(\mathbf J^T\mathbf J+\varepsilon_J\mathbf I)^{-1}\mathbf J^T:\ p_i=1-\frac{\gamma\sigma_i^2}{\sigma_i^2+\varepsilon_J}`,
  },
  E23: {
    gist: r`598 是 mean（ensemble）遞迴的結果；per-sample（$N=1$）的 Gaussian regressor 在均方意義下發散。`,
    spec: r`\rho=0.99,\ \mu=0.5\ \Rightarrow\ 598\ \text{次更新}`,
    fix: r`\text{mean：}p=0.995\ \checkmark\qquad\text{mean-square spectral radius：}\ N=1:\ 1.98>1,\quad N=2:\ 0.9925,\quad N\ge16:\ 0.9900`,
  },
  E24: {
    gist: r`pole 公式只在 $\hat{\mathbf J}=\mathbf J$ 時成立；近奇異的 $\mathbf J$ 對量測誤差極敏感（$\hat\rho=0.996$ 就發散）。`,
    spec: r`p_i=1-\frac{\gamma\sigma_i^2}{\sigma_i^2+\lambda}`,
    fix: r`\text{poles}=\operatorname{eig}\!\big(\mathbf I+\mathbf M(\hat{\mathbf J})\,\mathbf J_{\rm true}\big);\qquad\hat{\mathbf J}=\mathbf J\ \text{時才化簡成}\ 1-\frac{\gamma\sigma_i^2}{\sigma_i^2+\lambda_{\rm reg}}`,
  },
  E25: {
    gist: r`標題與表格列數不一致（文字勘誤）。`,
    spec: null,
    fix: r`\text{「三種架構比較」}\ \to\ \text{「四種架構比較」（Scalar／NLMS／Regularized／Sequential）}`,
  },
  E26: {
    gist: r`兩個近似在 $p=0.92$ 時差 $4.2\%$，不能用「$\approx$」直接串起來。`,
    spec: r`f_{\rm cal,BW}\approx\frac{1-p}{2\pi}f_u\approx\frac{-\ln p}{2\pi}f_u`,
    fix: r`f_{3\rm dB}\approx\frac{-\ln p}{2\pi}f_u\ \ (p\to1)\ \approx\frac{1-p}{2\pi}f_u\quad\Big(\text{相對誤差}\approx-\frac{1-p}{2}\Big)`,
  },
  E27: {
    gist: r`exact 式只在 $p\ge0.1716$ 時存在；$p$ 更小時 Nyquist 內衰減不到 $3\,\mathrm{dB}$。`,
    spec: r`\text{「應使用 exact discrete-time }-3\,\mathrm{dB}\text{ 頻率」}\qquad(\text{未給公式與存在範圍})`,
    fix: r`\Omega_{3\rm dB}=\arccos\!\Big(1-\frac{(1-p)^2}{2p}\Big),\qquad3-2\sqrt2\le p<1\quad\big(0<\mu K\le2\sqrt2-2\big)`,
  },
  E28: {
    gist: r`DTFT 形式與單邊 $\mathrm{s^2/Hz}$ 的 PSD 差 $2/f_s$；漏掉會讓 $\mathcal L(f)$ 偏移 $10\log_{10}(f_s/2)\approx93\,\mathrm{dB}$。`,
    spec: r`S_{\delta t}(e^{j\Omega})\ \longleftrightarrow\ S^{(1)}_{\delta t}(f)\qquad(\text{缺換算式})`,
    fix: r`\sigma^2=\frac{1}{2\pi}\int_{-\pi}^{\pi}S(e^{j\Omega})\,d\Omega\ \Rightarrow\ S^{(1)}(f)=\frac{2}{f_s}\,S\big(e^{j2\pi f/f_s}\big),\qquad0<f<\frac{f_s}{2}`,
  },
  E29: {
    gist: r`同一個符號 $S_w$ 橫跨兩個取樣率；頻率軸差 $N=4096$ 倍，還漏掉 ZOH 的 $\mathrm{sinc}^2$。`,
    spec: r`S_w(e^{j\Omega})\ \text{同時用於 block rate 與 sample rate}`,
    fix: r`S_w^{(s)}(e^{j\theta})=\frac1N\left[\frac{\sin(N\theta/2)}{\sin(\theta/2)}\right]^2S_w(e^{jN\theta}),\qquad\theta\ [\mathrm{rad/sample}]`,
  },
  E30: {
    gist: r`T13 漏寫必要前提（unit-RMS code、identity path、average mode）；換成 sum mode 會得到 $g=326.8$ 而發散。`,
    spec: r`\sigma_v=100\,\mathrm{fs},\ N=4096,\ \mu=10\,\mathrm{fs}\ \Rightarrow\ p\approx0.92021,\ \sigma_w\approx0.399\,\mathrm{fs}`,
    fix: r`\text{前提：}E[x^2]=C=1,\ \text{average GMAC},\ \sigma_\eta^2\approx\frac1N;\qquad\sigma_w=\mu\sqrt{\frac{\sigma_\eta^2}{1-p^2}}=0.3992\,\mathrm{fs}`,
  },
  E31: {
    gist: r`§8.4 的 state-space $(\mathbf A,\mathbf B,\mathbf C,\mathbf D)$ 與 §0 的相關 $\mathbf C$、§7 的 code delay $D$ 撞名；改用 $(\mathbf A_s,\mathbf b_s,\mathbf c_s^T,d_s)$。`,
    spec: r`G_k=\mathbf C\mathbf s_k+\mathbf D\delta_k,\qquad\mathbf A_{\rm combined}=\begin{bmatrix}\mathbf A&\mathbf B\\-\mu\mathbf C&1-\mu\mathbf D\end{bmatrix}`,
    fix: r`\mathbf s_{k+1}=\mathbf A_s\mathbf s_k+\mathbf b_s\delta_k,\qquad G_k=\mathbf c_s^T\mathbf s_k+d_s\delta_k,\qquad F(z)=d_s+\mathbf c_s^T(z\mathbf I-\mathbf A_s)^{-1}\mathbf b_s`,
  },
  E32: {
    gist: r`§3 的 $\delta$ 極性與 §0 相反；遞迴形式不變，但 trace 會反號。`,
    spec: r`\delta_n=w_n-a`,
    fix: r`\delta_n=a-w_n,\qquad e_n=\delta_nx,\qquad\delta_{n+1}=(1-\mu x^2)\,\delta_n`,
  },
  E33: {
    gist: r`$\delta w=w-w^*$ 與 $\delta=a-w$ 極性相反、參考點也不同；算 cross-spectrum 時要用一致的極性。`,
    spec: r`\delta w_k=w_k-w^*,\qquad\delta t[n]=x[n]\,\delta w[n]`,
    fix: r`a-w_k=(a-w^*)-\delta w_k;\qquad\text{殘餘 timing error 的貢獻}=-x[n]\,\delta w[n]`,
  },
  E34: {
    gist: r`一批符號在不同章節代表不同的量；本站各章的符號表逐一註明採用的定義。`,
    spec: r`c,\ b,\ d,\ B,\ m,\ \alpha,\ \lambda,\ s,\ v[n]\qquad(\text{各章重複使用})`,
    fix: r`v,r,y\to\nu_q,r_q,y_Q;\quad\alpha,\beta\to\alpha_{\rm PE},\beta_{\rm PE};\quad\lambda\to\lambda_{\rm reg};\quad B\to B_{\rm bias},A_w,N_{\rm blk};\quad m\to m_q,\bar x`,
  },
  E35: {
    gist: r`時間索引：$n$ 是 comparator sample、$k$ 是 GMAC block、$m$ 是 PVT；不可混在同一式。`,
    spec: r`\sum_{n=k}^{k+N_0-1},\qquad w_{k+1}=w_k+\mu E\big[q[n]u_f[n]\big]`,
    fix: r`\alpha_{\rm PE}\mathbf I\preceq\sum_{n=n_0}^{n_0+N_0-1}\mathbf u[n]\mathbf u^T[n]\preceq\beta_{\rm PE}\mathbf I;\qquad w_{k+1}=w_k+\mu G_k^{(f)},\ \ G_k^{(f)}=\frac1N\sum_{n\in\text{block }k}q[n]u_f[n]`,
  },
  E36: {
    gist: r`拼字與用語（文字勘誤）。`,
    spec: null,
    fix: r`\text{Regessor}\to\text{Regressor};\qquad\text{仿真}\to\text{模擬};\qquad\text{周期}\to\text{週期}`,
  },
  E37: {
    gist: r`公式裡的下標 $i$ 是 eigen-mode，不是第 $i$ 個參數：mode 變異是 $127.8$ 與 $0.64$，每個參數卻是 $64.2\,\mathrm{fs^2}$。`,
    spec: r`\operatorname{Var}(\delta_i)\approx\frac{\gamma}{K_q^2N\lambda_i(2-\gamma)}`,
    fix: r`\boldsymbol\xi=\mathbf V^T\boldsymbol\delta:\ \operatorname{Var}(\xi_i)\approx\frac{\gamma}{K_q^2N\lambda_i(2-\gamma)};\qquad\operatorname{Cov}(\boldsymbol\delta)\approx\frac{\gamma}{K_q^2N(2-\gamma)}\,\mathbf R^{-1}`,
  },
  E38: {
    gist: r`iid 純量 $x$ 下獨立性自動成立，mean／mean-square 遞迴是精確式；只有相關 regressor（$u=h*x$）才是近似。`,
    spec: r`\text{「假設 }x_n\text{ 和前一輪係數誤差獨立」}\qquad(\text{看似近似})`,
    fix: r`x_n\ \text{iid}\ \Rightarrow\ \delta_n=f(\delta_0,x_0,\ldots,x_{n-1})\perp x_n\ \Rightarrow\ E[\delta_{n+1}]=(1-\mu P_x)\,E[\delta_n]\quad\text{（精確）}`,
  },
  E39: {
    gist: r`網站顯示 $\delta$ 的數值時一律用 $a-w$。`,
    spec: r`\delta_n=w_n-a\ \Rightarrow\ \delta_0,\delta_1,\delta_2=-2,\ -1.2,\ -0.72`,
    fix: r`\delta_n=a-w_n\ \Rightarrow\ \delta_0,\delta_1,\delta_2=+2,\ +1.2,\ +0.72`,
  },
  E40: {
    gist: r`$\operatorname{sign}(0)$ 的慣例會讓 Sign-Error 的穩態平均偏移 $0$、$\mu/2$ 或 $\mu$；驗證容忍度至少取 $\mu|x|$。`,
    spec: r`q=\operatorname{sign}(e),\qquad\operatorname{sign}(0)\ \text{未定義}`,
    fix: r`\text{數學 subgradient：}\operatorname{sign}(0)=0;\qquad\text{comparator：}e\ge0\to+1;\qquad\text{時間平均的偏移}=O(\mu|x|)`,
  },
  E41: {
    gist: r`成本有沒有 $\tfrac12$，梯度差 2 倍，推出的步長界也差 2 倍（$2/P_x$ 與 $1/P_x$）。`,
    spec: r`J_2(w)=E[(y-wx)^2],\qquad j_n=\tfrac12e_n^2`,
    fix: r`J_2(w)=\tfrac12E[(y-wx)^2]\ \Rightarrow\ \nabla J_2=-E[e\,x];\qquad\text{否則}\ \ w_{n+1}=w_n-\frac{\mu}{2}\hat\nabla J_2`,
  },
  E42: {
    gist: r`$E[\delta^2]$ 是係數的 mean-square deviation（MSD），不是 MSE 成本。`,
    spec: r`\text{「均方誤差」}\ E[\delta_{n+1}^2]`,
    fix: r`\mathrm{MSD}=E[\delta^2]\ \ne\ \mathrm{MSE}=E[e^2]=P_xE[\delta^2]+\sigma_v^2;\qquad\mathrm{MSD}_\infty=\frac{\mu P_x\sigma_v^2}{2P_x-\mu E[x^4]}`,
  },
  E43: {
    gist: r`拼字勘誤。`,
    spec: null,
    fix: r`\text{Regessor}\to\text{Regressor}`,
  },
  E44: {
    gist: r`算 $C$、$C_D$ 一律用 $H(e^{j\Omega})$（$\Omega$ 為 rad/sample）；CT 式只在 $\omega_nT_s\ll1$、無額外 latency 時近似成立。`,
    spec: r`H_{\rm PD}(s)=\frac{s^2}{s^2+2\zeta\omega_ns+\omega_n^2}\qquad(\text{直接用於 DT 相關})`,
    fix: r`H_{\rm PD}(z)=\frac{1}{1+L(z)},\qquad L(z)=\Big(K_p+\frac{K_i}{1-z^{-1}}\Big)\frac{z^{-(1+d)}}{1-z^{-1}},\qquad K_p=2\zeta\omega_nT_s,\ \ K_i=(\omega_nT_s)^2`,
  },
  E45: {
    gist: r`$\hat H\ne H$ 時 pole 要用交叉相關 $E[u\,u_f]$；相位差超過 $90^\circ$ 時 filtered-x 同樣會反向更新。`,
    spec: r`w_{k+1}=w_k+\mu E\big[q[n]u_f[n]\big],\qquad E[qu]\approx K_q(a-w)E[u^2]`,
    fix: r`E[G_k]\approx K_q(a-w_k)\,E[u\,u_f],\qquad E[u\,u_f]=\frac{1}{2\pi}\int_{-\pi}^{\pi}S_{xx}\operatorname{Re}\{H_{\rm PD}\hat H^*\}\,d\Omega,\qquad p_f=1-\mu K_qE[u\,u_f]`,
  },
  E46: {
    gist: r`單頻公式只在 $0<\Omega<\pi$、長時間（或整數週期）平均下成立；$\Omega=0,\pi$ 時是 2 倍。`,
    spec: r`E[xu]=\frac{A^2}{2}|H|\cos\phi,\qquad C_D=\frac{A^2}{2}|H|\cos(\phi+\Omega D)`,
    fix: r`0<\Omega<\pi:\ \text{同上};\qquad\Omega\in\{0,\pi\}:\ C_D=A^2H(e^{j\Omega})\cos(\Omega D);\qquad\text{有限 }N\ \text{ripple}\le\frac{A^2|H|}{2}\min\!\Big(1,\frac{1}{N|\sin\Omega|}\Big)`,
  },
  E47: {
    gist: r`主要能量在第 2 諧波 $2f_u/5$，不是 $f_u/5$；以 code 更新率取樣時只有這兩條獨立譜線。`,
    spec: r`\text{「帶有 }f_{\rm toggle}/5\text{ 及其諧波成分」}`,
    fix: r`e=[-0.4,-0.4,0.6,-0.4,0.6]:\qquad P(f_u/5)=0.03056,\quad P(2f_u/5)=0.20944\ \ \mathrm{LSB^2}\qquad(\text{高 }8.36\,\mathrm{dB};\ \text{總和 }0.24)`,
  },
  E48: {
    gist: r`大初始誤差時 comparator 飽和（slew-limited），公式嚴重低估（$\delta_0=\sigma_v$ 低估 $17\%$、$4\sigma_v$ 低估 $92\%$）。`,
    spec: r`E[\delta_B^2]\approx\delta_0^2p^{2B}+\mu^2\sigma_\eta^2\frac{1-p^{2B}}{1-p^2}`,
    fix: r`\text{線性 iid 模型：精確};\qquad\text{1-bit Sign-LMS：僅 }|\delta_0|\lesssim0.2\,\sigma_v;\qquad p^2=1:\ E[\delta_B^2]=\delta_0^2+B\mu^2\sigma_\eta^2`,
  },
  E49: {
    gist: r`正負號取決於定義；顯示時要標明用的是 $\delta=a-w$ 還是 $\delta w=w-w^*$。`,
    spec: r`w=32:\ \text{Static Error}=-0.4\,\mathrm{LSB}`,
    fix: r`w-w^*=-0.4\,\mathrm{LSB}\ \Longleftrightarrow\ \delta=a-w=+0.4\,\mathrm{LSB};\qquad\text{誤差功率}=0.16\,\mathrm{LSB^2}\ (\text{全在 DC})`,
  },
}
