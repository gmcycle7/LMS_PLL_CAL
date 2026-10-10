/**
 * Ch04 的 Mermaid 圖（diagrams.test.ts 以真正的 mermaid parser 驗證語法）。
 * 標籤依勘誤修正：S_k（sum）與 G_k（average）分開寫（E07 / E18），q = 2b − 1（E07），
 * u 與 x 同單位、時間單位由 a、w 承載（E13），code 對齊延遲用 D（E34）。
 */

/** 規格 §4 的完整概念系統（修正標籤；PLL 快迴路與 LMS 慢迴路分開；含 noise 注入與 DTC 非線性）。 */
export const CONCEPT_SYSTEM = `flowchart TB
  subgraph PLLLOOP["主 PLL 迴路（快，每個 reference cycle）"]
    REF["Reference clock f_ref"] --> PD["Phase detector / BBPD"]
    PD --> PLLF["PLL loop filter"]
    PLLF --> VCO["VCO / DCO"]
    VCO --> DIV["Multi-modulus divider"]
    DIVCTL["Divider control: N_int + y[n]"] --> DIV
    DIV --> DTC["DTC: delay = w_k x[n] + INL d(x)"]
    DTC --> PD
  end
  FCW["FCW = N_int + frac"] --> DSM["Delta-Sigma modulator (accumulator s[n])"]
  DSM -->|"carry y[n]"| DIVCTL
  DSM -->|"residue s[n]/M"| RES["Fractional residue code x[n] (normalized)"]
  RES --> GC["Gain code correction w_k x[n]"]
  GC --> DTC
  subgraph LMSLOOP["LMS 校正迴路（慢，每 N 個 sample 更新一次）"]
    NOISE["PD noise v[n] (sigma_v)"] --> CMP["1-bit comparator: b[n] = (e >= 0), q[n] = 2b[n] - 1"]
    ALIGN["Code alignment x[n-D] or filtered-x u_f[n-D]"] -->|"x_ref[n]"| GMAC["GMAC: S_k = sum of q[n] x_ref[n]"]
    CMP --> GMAC
    GMAC --> SCALE["Normalize G_k = S_k / N, step mu"]
    SCALE --> ACC["Gain accumulator w_(k+1) = w_k + mu G_k"]
  end
  PD -.->|"phase error e[n] (fs)"| CMP
  RES --> ALIGN
  ACC --> GC`

/** 規格 §4.2 的 RTL 級資料流（補上 clear、位元數、commit）。 */
export const RTL_DATAFLOW = `flowchart LR
  X["aligned signed code x_ref[n], B_x bits"] --> NEG["conditional negate: b = 1 pass x, b = 0 use ~x + 1"]
  Q["comparator bit b[n], q = 2b - 1"] --> NEG
  NEG --> SUM["GMAC accumulator S: B_acc = 1 + ceil(log2(N M_x + 1)) bits (F-04.9)"]
  CLR["block boundary: clear S every N samples"] -.-> SUM
  SUM --> AVG["normalize: arithmetic shift by log2 N - F_G, rounding"]
  AVG --> STEP["step size mu: shift or multiply"]
  STEP --> ADD["add to high-resolution accumulator W"]
  ADD --> SAT["saturation / anti-windup"]
  SAT --> W["calibration gain register w_k"]
  W --> APPLY["physical DTC code mapping, commit after d blocks"]`

/** 系統圖 C：雜訊／回授等效模型（含 H_PD）。 */
export const NOISE_FEEDBACK = `flowchart LR
  XC["code x[n]"] --> MUL(("x"))
  DLT["delta_k = a - w_k"] --> MUL
  MUL -->|"delta_k x[n] (fs)"| HPD["H_PD(z): PLL error path"]
  HPD -->|"delta_k u[n]"| ADDN(("+"))
  VN["noise v[n]"] --> ADDN
  BOFF["offset b_off, INL d(x)"] --> ADDN
  ADDN -->|"e[n]"| SGN["sign: q[n]"]
  SGN --> CORR(("x"))
  XREF["x_ref[n] (aligned)"] --> CORR
  CORR --> AVGB["(1/N) sum over block k"]
  AVGB -->|"G_k"| MUN["mu"]
  MUN --> INTG["accumulator 1/(1 - z^-1)"]
  INTG -->|"w_k, after d blocks"| DLT`

/** Clock domain / latency 時序（sample n、block k、commit、apply）。 */
export const LATENCY_TIMELINE = `sequenceDiagram
  participant S as Sample clock f_s
  participant C as Comparator
  participant G as GMAC (block k)
  participant U as Update logic
  participant R as Gain register
  participant D as DTC control
  Note over S,G: block k = samples n = kN ... kN+N-1
  S->>C: sample n, code x[n-D] aligned
  C->>G: b[n], accumulate S = S + q x_ref
  Note over G: after sample kN+N-1 the sum S_k is complete
  G->>U: S_k, then clear S for block k+1
  U->>R: commit w_(k+1) = w_k + mu G_k (pipeline P_c samples)
  R->>D: apply at the start of block k+1+d
  Note over D: PD sees the new gain only from block k+1+d`
