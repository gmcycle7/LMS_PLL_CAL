import { useEffect, useState } from 'react'

/** 追蹤一個 CSS media query 是否成立（沒有 matchMedia 的環境，例如 jsdom，一律 false）。 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}
