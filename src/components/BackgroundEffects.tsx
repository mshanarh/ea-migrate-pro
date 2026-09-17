import { useEffect, useRef, useState } from "react";

/**
 * Full-screen animated background effects engine.
 *
 * A fixed, pointer-transparent canvas sits behind all app content (z-index 0,
 * content wrapped at z-index 1). The active effect and on/off state live in
 * localStorage (`bgEffectsEnabled`, `bgEffectType`) so any screen can switch
 * them instantly by writing the keys and dispatching `eamp:bg-effects`.
 * Pure canvas 2D — no external libraries, one rAF loop, dt-normalized motion.
 */

export type BgEffectCard = { id: string; name: string; subtitle: string };

export const BG_EFFECTS: BgEffectCard[] = [
  { id: "dollars", name: "Falling Dollars", subtitle: "Green $ symbols raining down" },
  { id: "matrix", name: "Matrix Code", subtitle: "Vertical 01 digit rain" },
  { id: "candles", name: "Candle Charts", subtitle: "Drifting OHLC candle bars" },
  { id: "starfield", name: "Starfield", subtitle: "Hyperspace stars from center" },
  { id: "neon", name: "Neon Grid", subtitle: "Synthwave perspective grid" },
  { id: "wave", name: "Ticker Wave", subtitle: "Flowing sine price line" },
  { id: "particles", name: "Particles", subtitle: "Connected dots network" },
  { id: "snow", name: "Snow", subtitle: "Soft falling white flakes" },
  { id: "embers", name: "Embers", subtitle: "Rising orange sparks" },
  { id: "rings", name: "Pulse Rings", subtitle: "Expanding circles" },
  { id: "bubbles", name: "Bubbles", subtitle: "Floating glass orbs" },
  { id: "fireflies", name: "Fireflies", subtitle: "Glowing yellow wanderers" },
  { id: "rain", name: "Rain", subtitle: "Slanted blue streaks" },
  { id: "lightning", name: "Lightning", subtitle: "Random white sky flashes" },
  { id: "constellations", name: "Constellations", subtitle: "Twinkling star map" },
  { id: "hexgrid", name: "Hex Grid", subtitle: "Pulsing hexagon outlines" },
  { id: "binary", name: "Binary Rain", subtitle: "Falling 1s and 0s" },
  { id: "currency", name: "Currency Mix", subtitle: "$ € £ ¥ symbols floating" },
  { id: "circuit", name: "Circuit Board", subtitle: "Tech traces and nodes" },
  { id: "orbs", name: "Glow Orbs", subtitle: "Drifting light spheres" },
  { id: "lava", name: "Lava Lamp", subtitle: "Slow metaball bloom" },
  { id: "smoke", name: "Smoke", subtitle: "Drifting gray plumes" },
  { id: "confetti", name: "Confetti", subtitle: "Tumbling colorful squares" },
  { id: "arrows", name: "Trade Arrows", subtitle: "Up/down buy sell arrows" },
  { id: "heartbeat", name: "Heartbeat", subtitle: "EKG pulse line" },
  { id: "vortex", name: "Spiral Vortex", subtitle: "Rotating galaxy swirl" },
  { id: "fractal", name: "Fractal Tree", subtitle: "Growing branch tree" },
  { id: "ripples", name: "Ripples", subtitle: "Water surface circles" },
  { id: "static", name: "Static Noise", subtitle: "Subtle TV grain" },
  { id: "barcode", name: "Barcode Stream", subtitle: "Scanning vertical bars" },
  { id: "fire", name: "Fire", subtitle: "Rising orange flames" },
  { id: "pips", name: "Pip Drops", subtitle: "Floating pip values" },
  { id: "bulls", name: "Bulls vs Bears", subtitle: "🐂 🐻 drifting" },
  { id: "trends", name: "Trend Lines", subtitle: "Diagonal market lines" },
  { id: "orderbook", name: "Order Book", subtitle: "Bid/ask depth bars" },
  { id: "volume", name: "Volume Histogram", subtitle: "Pulsing volume columns" },
  { id: "fib", name: "Fibonacci Arcs", subtitle: "Golden ratio sweeps" },
  { id: "tape", name: "Ticker Tape", subtitle: "Scrolling price quotes" },
  { id: "pnl", name: "Profit / Loss", subtitle: "Floating +$ / -$ values" },
  { id: "zigzag", name: "Zigzag Chart", subtitle: "Live zigzag price line" },
  { id: "pipgrid", name: "Pip Grid", subtitle: "Dot grid with sparks" },
];

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

type Stepper = (dt: number) => void;
type Factory = (ctx: CanvasRenderingContext2D, w: number, h: number) => Stepper;

const FACTORIES: Record<string, Factory> = {
  dollars: (ctx, w, h) => {
    const ps = Array.from({ length: 40 }, () => ({ x: rand(0, w), y: rand(0, h), v: rand(50, 110), s: rand(12, 26) }));
    return (dt) => {
      for (const p of ps) {
        p.y += p.v * dt;
        if (p.y > h + 30) { p.y = -30; p.x = rand(0, w); }
        ctx.font = `bold ${p.s}px monospace`;
        ctx.fillStyle = "rgba(0, 210, 90, 0.85)";
        ctx.fillText("$", p.x, p.y);
      }
    };
  },

  matrix: (ctx, w, h) => {
    const size = 14;
    const cols = Math.ceil(w / size);
    const drops = Array.from({ length: cols }, () => rand(-h, 0));
    return (dt) => {
      ctx.font = `${size}px monospace`;
      for (let i = 0; i < cols; i++) {
        const x = i * size;
        const y = drops[i] ?? 0;
        const speed = 60 + ((i * 37) % 90);
        const col = i % 3 === 0 ? "rgba(0,229,255," : "rgba(0,255,150,";
        ctx.fillStyle = `${col}0.9)`;
        ctx.fillText(Math.random() < 0.5 ? "0" : "1", x, y);
        for (let k = 1; k <= 5; k++) {
          ctx.fillStyle = `${col}${0.5 - k * 0.09})`;
          ctx.fillText(Math.random() < 0.5 ? "0" : "1", x, y - k * size);
        }
        drops[i] = y > h + 60 ? rand(-h / 2, 0) : y + speed * dt;
      }
    };
  },

  candles: (ctx, w, h) => {
    const cw = 16;
    const count = Math.ceil(w / cw) + 2;
    const mk = (x: number) => {
      const open = rand(0.25, 0.75);
      const close = rand(0.25, 0.75);
      return { x, open, close, hi: Math.min(open, close) - rand(0.03, 0.14), lo: Math.max(open, close) + rand(0.03, 0.14), drift: rand(16, 36) };
    };
    const cs = Array.from({ length: count }, (_, i) => mk(i * cw));
    return (dt) => {
      for (const c of cs) {
        c.x -= c.drift * dt;
        if (c.x < -cw) Object.assign(c, mk(w + cw));
        const up = c.close < c.open; // y grows downward
        const yO = c.open * h * 0.8 + h * 0.1;
        const yC = c.close * h * 0.8 + h * 0.1;
        const yH = c.hi * h * 0.8 + h * 0.1;
        const yL = c.lo * h * 0.8 + h * 0.1;
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath(); ctx.moveTo(c.x + 4, yH); ctx.lineTo(c.x + 4, yL); ctx.stroke();
        ctx.fillStyle = up ? "rgba(60,230,120,0.7)" : "rgba(255,85,85,0.7)";
        ctx.fillRect(c.x, Math.min(yO, yC), 8, Math.max(3, Math.abs(yC - yO)));
      }
    };
  },

  starfield: (ctx, w, h) => {
    const cx = w / 2, cy = h / 2, maxR = Math.hypot(cx, cy);
    const stars = Array.from({ length: 160 }, () => ({ a: rand(0, TAU), d: rand(0, maxR), s: rand(0.3, 1) }));
    return (dt) => {
      for (const st of stars) {
        const px = cx + Math.cos(st.a) * st.d;
        const py = cy + Math.sin(st.a) * st.d;
        st.d += (40 + st.s * 120) * dt * (st.d / maxR + 0.12);
        if (st.d > maxR * 1.1) { st.d = rand(0, 16); st.a = rand(0, TAU); }
        const size = 0.6 + (st.d / maxR) * 2.2;
        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.9, 0.15 + st.d / 200)})`;
        ctx.fillRect(px, py, size, size);
      }
    };
  },

  neon: (ctx, w, h) => {
    let offset = 0;
    return (dt) => {
      offset = (offset + dt) % 1;
      const horizon = h * 0.55;
      const g = ctx.createRadialGradient(w / 2, horizon, 0, w / 2, horizon, w * 0.4);
      g.addColorStop(0, "rgba(255,0,180,0.16)");
      g.addColorStop(1, "rgba(255,0,180,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, horizon + 2);
      ctx.strokeStyle = "rgba(0,229,255,0.55)";
      for (let i = 0; i < 14; i++) {
        const t = ((i + offset) % 14) / 14;
        const y = horizon + Math.pow(t, 2.2) * (h - horizon);
        ctx.globalAlpha = Math.min(1, t * 2);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(255,0,229,0.5)";
      for (let i = -10; i <= 10; i++) {
        ctx.beginPath();
        ctx.moveTo(w / 2 + i * 24, horizon);
        ctx.lineTo(w / 2 + i * (w / 5), h);
        ctx.stroke();
      }
    };
  },

  wave: (ctx, w, h) => {
    let phase = 0;
    return (dt) => {
      phase += dt * 2;
      ctx.strokeStyle = "rgba(0,229,255,0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 6) {
        const y = h / 2 + Math.sin(x * 0.02 + phase) * h * 0.12 * Math.sin(x * 0.004 + phase * 0.6);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.lineWidth = 1;
    };
  },

  particles: (ctx, w, h) => {
    const ps = Array.from({ length: 80 }, () => ({ x: rand(0, w), y: rand(0, h), vx: rand(-24, 24), vy: rand(-24, 24) }));
    return (dt) => {
      for (const p of ps) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      }
      ctx.strokeStyle = "rgba(0,229,255,0.18)";
      for (let i = 0; i < ps.length; i++) {
        const a = ps[i];
        if (!a) continue;
        for (let j = i + 1; j < ps.length; j++) {
          const b = ps[j];
          if (!b) continue;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 90) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        }
      }
      for (const p of ps) {
        ctx.fillStyle = "rgba(120,220,255,0.85)";
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, TAU); ctx.fill();
      }
    };
  },

  snow: (ctx, w, h) => {
    const fs = Array.from({ length: 90 }, () => ({ x: rand(0, w), y: rand(0, h), r: rand(1, 3.2), v: rand(16, 40), ph: rand(0, TAU) }));
    let t = 0;
    return (dt) => {
      t += dt;
      for (const f of fs) {
        f.y += f.v * dt;
        if (f.y > h + 4) { f.y = -4; f.x = rand(0, w); }
        ctx.fillStyle = `rgba(255,255,255,${0.3 + f.r / 9})`;
        ctx.beginPath(); ctx.arc(f.x + Math.sin(t * 0.8 + f.ph) * 14, f.y, f.r, 0, TAU); ctx.fill();
      }
    };
  },

  embers: (ctx, w, h) => {
    const ps: { x: number; y: number; v: number; life: number; s: number; drift: number }[] = [];
    let timer = 0;
    return (dt) => {
      timer -= dt;
      if (timer <= 0 && ps.length < 60) {
        timer = 0.06;
        ps.push({ x: rand(0, w), y: h + 6, v: rand(40, 90), life: 1, s: rand(1.2, 3), drift: rand(-14, 14) });
      }
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        if (!p) continue;
        p.y -= p.v * dt; p.x += p.drift * dt; p.life -= dt * 0.35;
        if (p.life <= 0 || p.y < -6) { ps.splice(i, 1); continue; }
        ctx.fillStyle = `rgba(255,${120 + Math.floor(90 * p.life)},40,${p.life})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s * p.life, 0, TAU); ctx.fill();
      }
    };
  },

  rings: (ctx, w, h) => {
    const rs: { x: number; y: number; r: number; life: number }[] = [];
    let timer = 0;
    return (dt) => {
      timer -= dt;
      if (timer <= 0) {
        timer = 0.8;
        if (rs.length < 10) rs.push({ x: rand(w * 0.15, w * 0.85), y: rand(h * 0.15, h * 0.85), r: 4, life: 1 });
      }
      for (let i = rs.length - 1; i >= 0; i--) {
        const r = rs[i];
        if (!r) continue;
        r.r += 70 * dt; r.life -= dt * 0.5;
        if (r.life <= 0) { rs.splice(i, 1); continue; }
        ctx.strokeStyle = `rgba(0,229,255,${r.life * 0.7})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.stroke();
      }
      ctx.lineWidth = 1;
    };
  },

  bubbles: (ctx, w, h) => {
    const bs = Array.from({ length: 26 }, () => ({ x: rand(0, w), y: rand(0, h), r: rand(6, 22), v: rand(14, 34), ph: rand(0, TAU) }));
    let t = 0;
    return (dt) => {
      t += dt;
      for (const b of bs) {
        b.y -= b.v * dt;
        if (b.y < -b.r * 2) { b.y = h + b.r; b.x = rand(0, w); }
        const x = b.x + Math.sin(t + b.ph) * 8;
        ctx.strokeStyle = "rgba(180,220,255,0.4)";
        ctx.fillStyle = "rgba(180,220,255,0.08)";
        ctx.beginPath(); ctx.arc(x, b.y, b.r, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath(); ctx.arc(x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.28, 0, TAU); ctx.stroke();
      }
    };
  },

  fireflies: (ctx, w, h) => {
    const fs = Array.from({ length: 40 }, () => ({ x: rand(0, w), y: rand(0, h), a: rand(0, TAU), ph: rand(0, TAU) }));
    let t = 0;
    return (dt) => {
      t += dt;
      ctx.shadowColor = "rgba(255,230,80,0.9)";
      ctx.shadowBlur = 12;
      for (const f of fs) {
        f.a += rand(-1.5, 1.5) * dt;
        f.x += Math.cos(f.a) * 22 * dt;
        f.y += Math.sin(f.a) * 22 * dt;
        if (f.x < 0) f.x = w; if (f.x > w) f.x = 0;
        if (f.y < 0) f.y = h; if (f.y > h) f.y = 0;
        const glow = Math.max(0.08, 0.4 + Math.sin(t * 2 + f.ph) * 0.35);
        ctx.fillStyle = `rgba(255,230,80,${glow})`;
        ctx.beginPath(); ctx.arc(f.x, f.y, 2.2, 0, TAU); ctx.fill();
      }
      ctx.shadowBlur = 0;
    };
  },

  rain: (ctx, w, h) => {
    const ds = Array.from({ length: 90 }, () => ({ x: rand(-40, w), y: rand(-h, h), v: rand(480, 780), len: rand(10, 22) }));
    return (dt) => {
      ctx.strokeStyle = "rgba(120,180,255,0.5)";
      for (const d of ds) {
        d.y += d.v * dt; d.x += d.v * 0.18 * dt;
        if (d.y > h + 20) { d.y = rand(-80, -10); d.x = rand(-40, w); }
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * 0.18, d.y - d.len);
        ctx.stroke();
      }
    };
  },

  lightning: (ctx, w, h) => {
    let timer = 1.5, flash = 0;
    type Bolt = { x: number; y: number }[];
    let bolt: Bolt = [];
    return (dt) => {
      timer -= dt;
      if (timer <= 0) {
        flash = 1; timer = 3;
        bolt = [];
        let x = rand(w * 0.2, w * 0.8), y = 0;
        bolt.push({ x, y });
        while (y < h) { x += rand(-40, 40); y += rand(30, 70); bolt.push({ x, y }); }
      }
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flash * 0.4})`;
        ctx.fillRect(0, 0, w, h);
        if (bolt.length) {
          ctx.strokeStyle = `rgba(255,255,255,${flash})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          bolt.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          ctx.stroke();
          ctx.lineWidth = 1;
        }
        flash -= dt * 2.5;
      }
    };
  },

  constellations: (ctx, w, h) => {
    const stars = Array.from({ length: 70 }, () => ({ x: rand(0, w), y: rand(0, h), ph: rand(0, TAU) }));
    const links: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
    for (let i = 0; i < stars.length; i++) {
      const a = stars[i];
      if (!a) continue;
      for (let j = i + 1; j < stars.length; j++) {
        const b = stars[j];
        if (!b) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) < 95) links.push({ a, b });
      }
    }
    let t = 0;
    return (dt) => {
      t += dt;
      ctx.strokeStyle = "rgba(140,180,255,0.14)";
      for (const { a, b } of links) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      for (const s of stars) {
        ctx.fillStyle = `rgba(255,255,255,${0.35 + Math.sin(t * 1.6 + s.ph) * 0.3})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, 1.6, 0, TAU); ctx.fill();
      }
    };
  },

  hexgrid: (ctx, w, h) => {
    const R = 26;
    const dx = R * 1.5, dy = R * Math.sqrt(3);
    const centers: { x: number; y: number }[] = [];
    for (let col = 0; col * dx < w + R * 2; col++) {
      for (let row = 0; row * dy < h + R * 2; row++) {
        centers.push({ x: col * dx, y: row * dy + (col % 2 ? dy / 2 : 0) });
      }
    }
    let t = 0;
    return (dt) => {
      t += dt;
      for (const c of centers) {
        const pulse = 0.15 + Math.max(0, Math.sin(t * 1.5 + (c.x + c.y) * 0.008)) * 0.5;
        ctx.strokeStyle = `rgba(0,229,255,${pulse})`;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          const px = c.x + Math.cos(a) * R * 0.85;
          const py = c.y + Math.sin(a) * R * 0.85;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.stroke();
      }
    };
  },

  binary: (ctx, w, h) => {
    const size = 14;
    const cols = Math.ceil(w / size);
    const drops = Array.from({ length: cols }, () => rand(-h, 0));
    return (dt) => {
      ctx.font = `${size}px monospace`;
      for (let i = 0; i < cols; i++) {
        const x = i * size;
        const y = drops[i] ?? 0;
        ctx.fillStyle = "rgba(0,255,120,0.9)";
        ctx.fillText(Math.random() < 0.5 ? "1" : "0", x, y);
        for (let k = 1; k <= 5; k++) {
          ctx.fillStyle = `rgba(0,255,120,${0.5 - k * 0.09})`;
          ctx.fillText(Math.random() < 0.5 ? "1" : "0", x, y - k * size);
        }
        drops[i] = y > h + 60 ? rand(-h / 2, 0) : y + (70 + ((i * 53) % 80)) * dt;
      }
    };
  },

  currency: (ctx, w, h) => {
    const syms = ["$", "€", "£", "¥"];
    const colors = ["rgba(0,229,255,0.8)", "rgba(60,230,120,0.8)", "rgba(255,200,60,0.8)", "rgba(255,120,200,0.8)"];
    const cs = Array.from({ length: 30 }, () => ({
      x: rand(0, w), y: rand(0, h),
      s: syms[Math.floor(rand(0, syms.length))] ?? "$",
      c: colors[Math.floor(rand(0, colors.length))] ?? "rgba(0,229,255,0.8)",
      v: rand(14, 40), size: rand(14, 30),
    }));
    return (dt) => {
      for (const c of cs) {
        c.y -= c.v * dt;
        if (c.y < -30) { c.y = h + 20; c.x = rand(0, w); }
        ctx.font = `bold ${c.size}px serif`;
        ctx.fillStyle = c.c;
        ctx.fillText(c.s, c.x, c.y);
      }
    };
  },

  circuit: (ctx, w, h) => {
    const traces = Array.from({ length: 12 }, () => {
      const pts: { x: number; y: number }[] = [];
      let x = rand(0, w), y = rand(0, h);
      pts.push({ x, y });
      const segs = 3 + Math.floor(rand(2, 5));
      for (let s = 0; s < segs; s++) {
        const len = rand(60, 160);
        if (Math.random() < 0.5) x += (Math.random() < 0.5 ? -1 : 1) * len;
        else y += (Math.random() < 0.5 ? -1 : 1) * len;
        pts.push({ x: Math.max(-40, Math.min(w + 40, x)), y: Math.max(-40, Math.min(h + 40, y)) });
      }
      return { pts, pulse: rand(0, 1), speed: rand(0.15, 0.4) };
    });
    return (dt) => {
      ctx.strokeStyle = "rgba(120,255,220,0.22)";
      for (const tr of traces) {
        ctx.beginPath();
        tr.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
        ctx.fillStyle = "rgba(0,229,255,0.6)";
        for (const p of tr.pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, TAU); ctx.fill(); }
        tr.pulse = (tr.pulse + tr.speed * dt) % 1;
        const total = tr.pts.length - 1;
        const f = tr.pulse * total;
        const i = Math.min(Math.floor(f), total - 1);
        const a = tr.pts[i], b = tr.pts[i + 1];
        if (a && b) {
          const t = f - i;
          ctx.fillStyle = "rgba(190,255,240,0.95)";
          ctx.beginPath();
          ctx.arc(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 3, 0, TAU);
          ctx.fill();
        }
      }
    };
  },

  orbs: (ctx, w, h) => {
    const cols = ["0,229,255", "40,120,255", "120,80,255"];
    const os = Array.from({ length: 7 }, (_, i) => ({ x: rand(0, w), y: rand(0, h), r: rand(50, 110), vx: rand(-14, 14), vy: rand(-10, 10), c: cols[i % 3] ?? "0,229,255" }));
    return (dt) => {
      ctx.globalCompositeOperation = "lighter";
      for (const o of os) {
        o.x += o.vx * dt; o.y += o.vy * dt;
        if (o.x < -o.r) o.x = w + o.r; if (o.x > w + o.r) o.x = -o.r;
        if (o.y < -o.r) o.y = h + o.r; if (o.y > h + o.r) o.y = -o.r;
        const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
        g.addColorStop(0, `rgba(${o.c},0.35)`);
        g.addColorStop(1, `rgba(${o.c},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    };
  },

  lava: (ctx, w, h) => {
    const bs = Array.from({ length: 9 }, (_, i) => ({
      x: rand(0, w), base: rand(0, h), ph: rand(0, TAU), r: rand(40, 90), v: rand(10, 24),
      c: ["255,90,40", "255,160,30", "255,60,120"][i % 3] ?? "255,90,40",
    }));
    let t = 0;
    return (dt) => {
      t += dt;
      ctx.globalCompositeOperation = "lighter";
      for (const b of bs) {
        const y = (b.base - t * b.v + h) % (h + b.r * 2) - b.r;
        const x = b.x + Math.sin(t * 0.4 + b.ph) * 30;
        const g = ctx.createRadialGradient(x, y, 0, x, y, b.r);
        g.addColorStop(0, `rgba(${b.c},0.4)`);
        g.addColorStop(1, `rgba(${b.c},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, b.r, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    };
  },

  smoke: (ctx, w, h) => {
    const ps = Array.from({ length: 12 }, () => ({ x: rand(0, w), y: rand(0, h), r: rand(30, 70), v: rand(8, 20) }));
    return (dt) => {
      for (const p of ps) {
        p.y -= p.v * dt;
        p.r += 12 * dt;
        if (p.y + p.r < 0) { p.y = h + p.r; p.x = rand(0, w); p.r = rand(30, 70); }
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, "rgba(160,160,170,0.1)");
        g.addColorStop(1, "rgba(160,160,170,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      }
    };
  },

  confetti: (ctx, w, h) => {
    const colors = ["#ff5252", "#ffd740", "#69f0ae", "#40c4ff", "#e040fb", "#ff6e40"];
    const cs = Array.from({ length: 60 }, () => ({
      x: rand(0, w), y: rand(-h, 0), v: rand(60, 140), r: rand(0, TAU), vr: rand(-4, 4), a: rand(0, TAU),
      c: colors[Math.floor(rand(0, colors.length))] ?? "#fff", s: rand(4, 8),
    }));
    return (dt) => {
      for (const c of cs) {
        c.y += c.v * dt; c.r += c.vr * dt; c.x += Math.sin(c.a + c.r) * 20 * dt;
        if (c.y > h + 10) { c.y = -10; c.x = rand(0, w); }
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.r);
        ctx.fillStyle = c.c;
        ctx.fillRect(-c.s / 2, -c.s / 2, c.s, c.s * 0.6);
        ctx.restore();
      }
    };
  },

  arrows: (ctx, w, h) => {
    const as = Array.from({ length: 28 }, () => ({ x: rand(0, w), y: rand(0, h), up: Math.random() < 0.5, v: rand(18, 40), s: rand(14, 24) }));
    return (dt) => {
      ctx.textAlign = "center";
      for (const a of as) {
        a.y += (a.up ? -a.v : a.v) * dt;
        if (a.y < -20) { a.y = h + 20; a.x = rand(0, w); }
        if (a.y > h + 20) { a.y = -20; a.x = rand(0, w); }
        ctx.font = `bold ${a.s}px sans-serif`;
        ctx.fillStyle = a.up ? "rgba(60,230,120,0.75)" : "rgba(255,90,90,0.75)";
        ctx.fillText(a.up ? "↑" : "↓", a.x, a.y);
      }
      ctx.textAlign = "left";
    };
  },

  heartbeat: (ctx, w, h) => {
    const ekg = (p: number) => {
      if (p < 0.1) return Math.sin((p / 0.1) * Math.PI) * 6;
      if (p < 0.18) return -((p - 0.1) / 0.08) * 14;
      if (p < 0.26) return -14 + ((p - 0.18) / 0.08) * 74;
      if (p < 0.34) return 60 - ((p - 0.26) / 0.08) * 84;
      if (p < 0.42) return -24 + ((p - 0.34) / 0.08) * 32;
      return Math.sin(((p - 0.42) / 0.58) * Math.PI) * 4;
    };
    let off = 0;
    return (dt) => {
      off += 90 * dt;
      ctx.strokeStyle = "rgba(60,230,120,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 4) {
        let p = ((x + off) / 340) % 1;
        if (p < 0) p += 1;
        const y = h / 2 - ekg(p);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.lineWidth = 1;
    };
  },

  vortex: (ctx, w, h) => {
    let t = 0;
    return (dt) => {
      t += dt * 0.5;
      const cx = w / 2, cy = h / 2, maxR = Math.hypot(cx, cy);
      for (let arm = 0; arm < 3; arm++) {
        for (let i = 0; i < 70; i++) {
          const d = (i / 70) * maxR;
          const a = t + (arm * TAU) / 3 + d * 0.012;
          const x = cx + Math.cos(a) * d;
          const y = cy + Math.sin(a) * d * 0.85;
          const alpha = (1 - d / maxR) * 0.8;
          ctx.fillStyle = arm === 1 ? `rgba(180,140,255,${alpha})` : `rgba(120,200,255,${alpha})`;
          ctx.beginPath(); ctx.arc(x, y, 1.4 + (1 - d / maxR) * 1.6, 0, TAU); ctx.fill();
        }
      }
    };
  },

  fractal: (ctx, w, h) => {
    let t = 0;
    const grow = (x: number, y: number, len: number, angle: number, depth: number) => {
      if (depth <= 0 || len < 4) return;
      const x2 = x + Math.cos(angle) * len;
      const y2 = y + Math.sin(angle) * len;
      ctx.strokeStyle = `rgba(120,255,160,${0.12 + depth * 0.06})`;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      const spread = 0.45 + Math.sin(t * 0.5) * 0.12;
      grow(x2, y2, len * 0.72, angle - spread, depth - 1);
      grow(x2, y2, len * 0.72, angle + spread, depth - 1);
    };
    return (dt) => {
      t += dt;
      const depth = Math.min(9, 2 + Math.floor((t % 9) * 1.2));
      grow(w / 2, h * 0.92, h * 0.16, -Math.PI / 2, depth);
    };
  },

  ripples: (ctx, w, h) => {
    const rs: { x: number; y: number; r: number; life: number }[] = [];
    let timer = 0;
    return (dt) => {
      timer -= dt;
      if (timer <= 0) {
        timer = 0.7;
        if (rs.length < 9) rs.push({ x: rand(0, w), y: rand(0, h), r: 2, life: 1 });
      }
      for (let i = rs.length - 1; i >= 0; i--) {
        const r = rs[i];
        if (!r) continue;
        r.r += 55 * dt; r.life -= dt * 0.45;
        if (r.life <= 0) { rs.splice(i, 1); continue; }
        ctx.strokeStyle = `rgba(160,220,255,${r.life * 0.5})`;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.stroke();
      }
    };
  },

  static: (ctx, w, h) => {
    return () => {
      for (let i = 0; i < 500; i++) {
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
      }
    };
  },

  barcode: (ctx, w, h) => {
    const bars: { x: number; wd: number; a: number }[] = [];
    let cursor = 0;
    while (cursor < w + 30) {
      bars.push({ x: cursor, wd: rand(2, 9), a: rand(0.2, 0.85) });
      cursor += rand(8, 26);
    }
    return (dt) => {
      const move = 60 * dt;
      for (const b of bars) b.x -= move;
      while (bars.length && (bars[0]?.x ?? 0) + (bars[0]?.wd ?? 0) < 0) bars.shift();
      const lastB = bars[bars.length - 1];
      if (!lastB || lastB.x + lastB.wd < w) {
        bars.push({ x: (lastB ? lastB.x + lastB.wd : 0) + rand(8, 26), wd: rand(2, 9), a: rand(0.2, 0.85) });
      }
      for (const b of bars) {
        ctx.fillStyle = `rgba(255,255,255,${b.a})`;
        ctx.fillRect(b.x, h * 0.2, b.wd, h * 0.6);
      }
    };
  },

  fire: (ctx, w, h) => {
    const ps: { x: number; y: number; v: number; life: number; s: number; drift: number }[] = [];
    let timer = 0;
    return (dt) => {
      timer -= dt;
      if (timer <= 0 && ps.length < 90) {
        timer = 0.03;
        ps.push({ x: w / 2 + rand(-w * 0.18, w * 0.18), y: h + 6, v: rand(60, 130), life: 1, s: rand(3, 7), drift: rand(-20, 20) });
      }
      ctx.globalCompositeOperation = "lighter";
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        if (!p) continue;
        p.y -= p.v * dt; p.x += p.drift * dt; p.life -= dt * 0.55;
        if (p.life <= 0 || p.y < -8) { ps.splice(i, 1); continue; }
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s * 2.4);
        if (p.life > 0.66) g.addColorStop(0, `rgba(255,230,80,${p.life})`);
        else if (p.life > 0.33) g.addColorStop(0, `rgba(255,140,40,${p.life})`);
        else g.addColorStop(0, `rgba(255,60,30,${p.life})`);
        g.addColorStop(1, "rgba(255,60,30,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 2.4, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    };
  },

  pips: (ctx, w, h) => {
    const vals = ["+12.5", "-3.2", "+8.1", "-1.4", "+23.7", "-0.6", "+5.5", "-7.9"];
    const ps: { x: number; y: number; v: string; up: boolean; life: number }[] = [];
    let timer = 0;
    return (dt) => {
      timer -= dt;
      if (timer <= 0 && ps.length < 22) {
        timer = 0.4;
        const v = vals[Math.floor(Math.random() * vals.length)] ?? "+1.0";
        ps.push({ x: rand(16, Math.max(20, w - 60)), y: h + 10, v, up: v.startsWith("+"), life: 1 });
      }
      ctx.font = "bold 14px monospace";
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        if (!p) continue;
        p.y -= 28 * dt; p.life -= dt * 0.18;
        if (p.life <= 0) { ps.splice(i, 1); continue; }
        ctx.fillStyle = p.up ? `rgba(60,230,120,${p.life})` : `rgba(255,90,90,${p.life})`;
        ctx.fillText(p.v, p.x, p.y);
      }
    };
  },

  bulls: (ctx, w, h) => {
    const es = Array.from({ length: 14 }, () => ({ x: rand(0, w), y: rand(0, h), vx: rand(-16, 16), bull: Math.random() < 0.5, ph: rand(0, TAU) }));
    let t = 0;
    return (dt) => {
      t += dt;
      ctx.font = "28px serif";
      ctx.textAlign = "center";
      for (const e of es) {
        e.x += e.vx * dt;
        if (e.x < -40) e.x = w + 40;
        if (e.x > w + 40) e.x = -40;
        ctx.fillText(e.bull ? "🐂" : "🐻", e.x, e.y + Math.sin(t + e.ph) * 8);
      }
      ctx.textAlign = "left";
    };
  },

  trends: (ctx, w, h) => {
    const ls = Array.from({ length: 8 }, (_, i) => ({ x: rand(-w, w), y: rand(0, h), up: i % 2 === 0, v: rand(30, 70) }));
    return (dt) => {
      ctx.lineWidth = 2;
      for (const l of ls) {
        l.x += l.v * dt;
        if (l.x > w + 200) { l.x = -200; l.y = rand(0, h); }
        const len = 160;
        ctx.strokeStyle = l.up ? "rgba(60,230,120,0.45)" : "rgba(255,90,90,0.45)";
        ctx.beginPath();
        ctx.moveTo(l.x, l.y + (l.up ? len * 0.5 : -len * 0.5));
        ctx.lineTo(l.x + len, l.y + (l.up ? -len * 0.5 : len * 0.5));
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    };
  },

  orderbook: (ctx, w, h) => {
    let t = 0;
    return (dt) => {
      t += dt;
      const rows = 12, rh = 12, gap = 6;
      const totalH = rows * (rh + gap);
      const startY = Math.max(20, (h - totalH) / 2);
      for (let i = 0; i < rows; i++) {
        const pulse = Math.sin(t * 1.4 + i * 0.9) * 0.5 + 0.5;
        const len = 30 + pulse * (w * 0.22);
        const y = startY + i * (rh + gap);
        ctx.fillStyle = `rgba(60,230,120,${0.25 + pulse * 0.3})`;
        ctx.fillRect(w / 2 - 8 - len, y, len, rh);
        ctx.fillStyle = `rgba(255,90,90,${0.25 + pulse * 0.3})`;
        ctx.fillRect(w / 2 + 8, y, len * 0.9, rh);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.beginPath();
      ctx.moveTo(w / 2, startY - 10);
      ctx.lineTo(w / 2, startY + totalH + 10);
      ctx.stroke();
    };
  },

  volume: (ctx, w, h) => {
    let t = 0;
    return (dt) => {
      t += dt;
      const bw = 12, gap = 6;
      const n = Math.ceil(w / (bw + gap));
      for (let i = 0; i < n; i++) {
        const pulse = Math.sin(t * (1 + (i % 5) * 0.2) + i * 12.9898) * 0.5 + 0.5;
        const bh = 10 + pulse * h * 0.22;
        ctx.fillStyle = i % 2 ? "rgba(60,230,120,0.4)" : "rgba(255,90,90,0.4)";
        ctx.fillRect(i * (bw + gap), h - bh, bw, bh);
      }
    };
  },

  fib: (ctx, w, h) => {
    let t = 0;
    const PHI = 1.618;
    return (dt) => {
      t += dt;
      const cx = w * 0.2, cy = h * 0.5;
      ctx.lineWidth = 1.5;
      for (let k = 0; k < 6; k++) {
        const r = 20 * Math.pow(PHI, k);
        if (r > Math.max(w, h) * 1.2) break;
        const sweep = t * 0.6 + k * 0.8;
        ctx.strokeStyle = `rgba(212,175,55,${0.5 - k * 0.06})`;
        ctx.beginPath();
        ctx.arc(cx, cy, r, sweep, sweep + Math.PI * (0.9 - k * 0.06));
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    };
  },

  tape: (ctx, w, h) => {
    const quote = "EURUSD 1.0845   GBPUSD 1.2632   XAUUSD 2330.50   BTCUSD 67420   USDJPY 151.24   ";
    const row = quote.repeat(3);
    let x1 = 0, x2 = w;
    ctx.font = "bold 13px monospace";
    return (dt) => {
      x1 -= 45 * dt; if (x1 < -w) x1 += w;
      x2 += 35 * dt; if (x2 > w) x2 -= w;
      ctx.fillStyle = "rgba(0,229,255,0.7)";
      ctx.fillText(row, x1, h * 0.3);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillText(row, x2 - w, h * 0.7);
    };
  },

  pnl: (ctx, w, h) => {
    const vals = ["+$120", "-$45", "+$310", "-$78", "+$56", "-$12", "+$204", "-$96"];
    const ps: { x: number; y: number; v: string; up: boolean; life: number }[] = [];
    let timer = 0;
    return (dt) => {
      timer -= dt;
      if (timer <= 0 && ps.length < 22) {
        timer = 0.5;
        const v = vals[Math.floor(Math.random() * vals.length)] ?? "+$10";
        ps.push({ x: rand(16, Math.max(20, w - 70)), y: h + 10, v, up: v.startsWith("+"), life: 1 });
      }
      ctx.font = "bold 15px monospace";
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        if (!p) continue;
        p.y -= 32 * dt; p.life -= dt * 0.2;
        if (p.life <= 0) { ps.splice(i, 1); continue; }
        ctx.fillStyle = p.up ? `rgba(60,230,120,${p.life})` : `rgba(255,90,90,${p.life})`;
        ctx.fillText(p.v, p.x, p.y);
      }
    };
  },

  zigzag: (ctx, w, h) => {
    const pts: { x: number; y: number }[] = [];
    let timer = 0;
    return (dt) => {
      timer -= dt;
      if (timer <= 0) {
        timer = 0.22;
        pts.push({ x: w + 10, y: rand(h * 0.25, h * 0.75) });
      }
      for (const p of pts) p.x -= 90 * dt;
      while (pts.length && (pts[0]?.x ?? -1) < -10) pts.shift();
      ctx.strokeStyle = "rgba(0,229,255,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      ctx.lineWidth = 1;
      const head = pts[pts.length - 1];
      if (head) {
        ctx.fillStyle = "#00e5ff";
        ctx.beginPath(); ctx.arc(head.x, head.y, 3.5, 0, TAU); ctx.fill();
      }
    };
  },

  pipgrid: (ctx, w, h) => {
    const gap = 34;
    const sparks: { x: number; y: number; life: number }[] = [];
    let timer = 0;
    return (dt) => {
      timer -= dt;
      if (timer <= 0) {
        timer = 0.35;
        if (sparks.length < 14) sparks.push({ x: Math.floor(rand(0, w / gap)) * gap + gap / 2, y: Math.floor(rand(0, h / gap)) * gap + gap / 2, life: 1 });
      }
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      for (let x = gap / 2; x < w; x += gap) {
        for (let y = gap / 2; y < h; y += gap) {
          ctx.fillRect(x - 1, y - 1, 2, 2);
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        if (!s) continue;
        s.life -= dt * 0.8;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.strokeStyle = `rgba(0,229,255,${s.life})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, (1 - s.life) * 12 + 2, 0, TAU); ctx.stroke();
        ctx.fillStyle = `rgba(0,229,255,${s.life})`;
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
      }
    };
  },
};

export function BackgroundEffects() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let stepper: Stepper | null = null;
    let builtFor = "";
    let last = performance.now();

    const readConfig = () => ({
      enabled: localStorage.getItem("bgEffectsEnabled") !== "false",
      type: localStorage.getItem("bgEffectType") || "dollars",
    });

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      builtFor = "";
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const { enabled, type } = readConfig();
      ctx.clearRect(0, 0, w, h);
      if (!enabled) return;

      const key = `${type}@${w}x${h}`;
      if (key !== builtFor || !stepper) {
        const factory = FACTORIES[type];
        stepper = factory ? factory(ctx, w, h) : null;
        builtFor = key;
      }
      stepper?.(dt);
    };

    const refresh = () => { builtFor = ""; };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("eamp:bg-effects", refresh);
    window.addEventListener("storage", refresh);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("eamp:bg-effects", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [mounted]);

  if (!mounted) return null;

  return (
    <canvas
      id="bg-effects-canvas"
      ref={canvasRef}
      aria-hidden
      style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 0, pointerEvents: "none", opacity: 0.6 }}
    />
  );
}
