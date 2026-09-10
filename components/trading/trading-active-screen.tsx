"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { Expand, MoreVertical, X } from "lucide-react"
import type { TradingConfig } from "./config"

type TradingActiveScreenProps = {
  config: TradingConfig
  onClose: () => void
}

const SIGNAL_LINE = "Listening for signals"

export function TradingActiveScreen({ config, onClose }: TradingActiveScreenProps) {
  const { robotName, selectedColor, brokerName, accountType, brandName, robotImage, lot, openTrades, perSignal, executed } =
    config

  const rootRef = useRef<HTMLDivElement | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [typed, setTyped] = useState("")

  // typing animation for the terminal
  useEffect(() => {
    let charIndex = 0
    let mounted = true
    const type = () => {
      if (!mounted) return
      charIndex++
      setTyped(SIGNAL_LINE.slice(0, charIndex))
      if (charIndex < SIGNAL_LINE.length) {
        setTimeout(type, 55)
      } else {
        // commit the finished line and restart after a pause
        setTimeout(() => {
          if (!mounted) return
          setLines((prev) => [...prev, SIGNAL_LINE])
          setTyped("")
          charIndex = 0
          setTimeout(type, 900)
        }, 1200)
      }
    }
    const start = setTimeout(type, 400)
    return () => {
      mounted = false
      clearTimeout(start)
    }
  }, [])

  const clearTerminal = useCallback(() => {
    setLines([])
    setTyped("")
  }, [])

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      el.requestFullscreen?.().catch(() => {})
    }
  }, [])

  // close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <motion.div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${robotName} trading active`}
      className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-black text-white"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
    >
      {/* full-bleed robot background, top faded */}
      <div className="pointer-events-none absolute inset-0">
        <img src={robotImage || "/placeholder.svg"} alt="" className="h-full w-full object-cover object-top" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 25%, rgba(0,0,0,0.65) 60%, #000 88%)",
          }}
        />
      </div>

      {/* top bar */}
      <div className="relative z-10 flex items-center justify-between px-5 pt-5">
        <button type="button" aria-label="Menu" className="rounded-full p-2 text-white/90 hover:bg-white/10">
          <MoreVertical size={22} />
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Expand fullscreen"
            onClick={toggleFullscreen}
            className="rounded-full p-2 text-white/90 hover:bg-white/10"
          >
            <Expand size={20} />
          </button>
          <button
            type="button"
            onClick={clearTerminal}
            className="rounded-full border border-white/40 px-3 py-1 text-xs font-semibold tracking-wide text-white/90 hover:bg-white/10"
          >
            CLR
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-full border border-white/40 p-1.5 text-white/90 hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* spacer that lets the robot show through */}
      <div className="relative z-10 flex-1" />

      {/* bottom overlay content */}
      <div className="relative z-10 px-5 pb-5">
        <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-balance">{robotName} V2.0</h1>

        <p className="mt-1 text-sm font-semibold" style={{ color: "#22C55E" }}>
          Connected · {brokerName} · {accountType}
        </p>

        {/* pills row */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold"
            style={{
              color: "#22C55E",
              border: "2px solid #22C55E",
              backgroundColor: "#22C55E20",
              boxShadow: "0 0 16px #22C55E80",
            }}
          >
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#22C55E" }} />
            TRADING ACTIVE
          </span>
          <span className="inline-flex items-center rounded-full border-2 border-white px-4 py-2 text-sm font-bold text-white">
            ROBOT ACTIVATED
          </span>
        </div>

        {/* stats row */}
        <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-white/50">
          BY {brandName} · LOT {lot} · {openTrades} OPEN · {perSignal}/SIGNAL · {executed} EXECUTED
        </p>

        {/* terminal card */}
        <div
          className="mt-4 overflow-hidden rounded-xl bg-black p-4 font-mono text-sm"
          style={{ border: "1px solid #ffffff", height: 200 }}
        >
          <div className="flex h-full flex-col gap-1 overflow-y-auto">
            {lines.map((line, i) => (
              <div key={i} className="text-white/70">
                <span style={{ color: "#22C55E" }}>●</span> {line}
              </div>
            ))}
            <div className="text-white">
              <span style={{ color: "#22C55E" }}>●</span> {typed}
              <motion.span
                aria-hidden
                animate={{ opacity: [1, 0, 1] }}
                transition={{ duration: 1, repeat: Number.POSITIVE_INFINITY }}
              >
                _
              </motion.span>
            </div>
          </div>
        </div>

        {/* footer */}
        <p className="mt-3 text-right text-xs italic text-white/70">Powered by {brandName} Pro</p>
      </div>
    </motion.div>
  )
}
