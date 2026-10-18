// 列印支援的進入點（main.tsx 載入一次）：樣式在 print.css，列印前後的 DOM 準備在 printPrep.ts
import './print.css'
import { installPrintPrep } from './printPrep'

if (typeof window !== 'undefined') installPrintPrep(window)
