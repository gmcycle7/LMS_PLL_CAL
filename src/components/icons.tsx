import type { ReactNode } from 'react'

/** 小型線條圖示（stroke = currentColor，跟隨文字顏色與主題） */

interface IconProps {
  size?: number
}

function Svg({ size = 16, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="c-icon"
    >
      {children}
    </svg>
  )
}

/** 直覺：燈泡 */
export const IconBulb = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z" />
  </Svg>
)

/** 圖：方塊圖 */
export const IconDiagram = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="7" height="6" rx="1" />
    <rect x="14" y="14" width="7" height="6" rx="1" />
    <path d="M10 7h4a3 3 0 0 1 3 3v4" />
  </Svg>
)

/** 公式：Σ */
export const IconSigma = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 5H6l6 7-6 7h12" />
  </Svg>
)

/** 範例：鉛筆 */
export const IconPencil = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="M13.5 6.5l4 4" />
  </Svg>
)

/** 探索：滑桿 */
export const IconSliders = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
)

/** 注意假設：三角警示 */
export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l9.5 17h-19z" />
    <path d="M12 10v4M12 17.5v.01" />
  </Svg>
)

/** 展開箭頭 */
export const IconChevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
)
