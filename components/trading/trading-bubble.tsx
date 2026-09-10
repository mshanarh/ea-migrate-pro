"use client"

import { useRef } from "react"
import { motion } from "framer-motion"

type TradingBubbleProps = {
  robotImage: string
  robotName: string
  selectedColor: string
  onOpen: () => void
  onStop: () => void
}

const LONG_PRESS_MS = 650

export function TradingBubble({ robotImage, robotName, selectedColor, onOpen, onStop }: TradingBubbleProps) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)
  const dragging = useRef(false)

  const clearTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const startLongPress = () => {
    longPressFired.current = false
    clearTimer()
    longPressTimer.current = setTimeout(() => {
      if (!dragging.current) {
        longPressFired.current = true
        onStop()
      }
    }, LONG_PRESS_MS)
  }

  return (
    <motion.button
      type="button"
      aria-label={`${robotName} trading assistant. Tap to open, long-press to stop.`}
      // spring pop-in
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 22 }}
      // draggable like a chat head
      drag
      dragMomentum={false}
      dragElastic={0.12}
      onDragStart={() => {
        dragging.current = true
        clearTimer()
      }}
      onDragEnd={() => {
        // slight delay so the tap handler can read the flag
        setTimeout(() => (dragging.current = false), 0)
      }}
      onPointerDown={startLongPress}
      onPointerUp={clearTimer}
      onPointerLeave={clearTimer}
      whileTap={{ scale: 0.94 }}
      onClick={() => {
        if (longPressFired.current || dragging.current) return
        onOpen()
      }}
      className="fixed z-50 flex items-center justify-center rounded-full p-0 outline-none"
      style={{
        bottom: 100,
        right: 20,
        width: 80,
        height: 80,
        borderRadius: "50%",
        border: `3px solid ${selectedColor}`,
        boxShadow: `0 0 25px ${selectedColor}`,
        cursor: "grab",
        touchAction: "none",
      }}
    >
      {/* pulsing glow ring */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full"
        animate={{ boxShadow: [`0 0 12px ${selectedColor}`, `0 0 30px ${selectedColor}`, `0 0 12px ${selectedColor}`] }}
        transition={{ duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        style={{ borderRadius: "50%" }}
      />

      {/* robot face cropped to circle */}
      <span
        className="relative h-full w-full overflow-hidden rounded-full"
        style={{ borderRadius: "50%" }}
      >
        <img
          src={robotImage || "/placeholder.svg"}
          alt={robotName}
          className="h-full w-full object-cover"
          draggable={false}
        />
      </span>

      {/* online green dot with pulse */}
      <span
        aria-hidden
        className="absolute"
        style={{ bottom: 2, right: 2, width: 20, height: 20 }}
      >
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ background: "#22C55E", border: "3px solid #ffffff" }}
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 1.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ background: "#22C55E" }}
          animate={{ opacity: [0.6, 0, 0.6], scale: [1, 1.9, 1.9] }}
          transition={{ duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: "easeOut" }}
        />
      </span>
    </motion.button>
  )
}
