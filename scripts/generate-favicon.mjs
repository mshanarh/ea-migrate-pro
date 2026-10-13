/**
 * EA Migrate Pro favicon generator — dark background, bold gold "EA".
 *
 * Pure Node (zlib only), no image dependencies. Renders geometric bold
 * letterforms with 6x6 supersampling (anti-aliased edges), then packs
 * PNG-compressed 16/32/48/64 sizes into a single .ico container.
 *
 * Run: node scripts/generate-favicon.mjs
 */
import zlib from "node:zlib";
import fs from "node:fs";

/* ---------- minimal PNG encoder ---------- */
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/* ---------- icon geometry (256-unit design space) ---------- */
const DESIGN = 256;
const BG = [10, 10, 12]; // #0A0A0C dark
const GOLD_TOP = [250, 212, 92];
const GOLD_BOT = [188, 138, 30];
const CAP_TOP = 78;
const CAP_BOT = 178;
const CORNER_R = 52;

const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/** E: vertical spine + three bars. */
function inE(x, y) {
  return (
    inRect(x, y, 36, 78, 56, 178) || // spine
    inRect(x, y, 36, 78, 98, 98) || // top bar
    inRect(x, y, 36, 118, 92, 138) || // middle bar
    inRect(x, y, 36, 158, 98, 178) // bottom bar
  );
}

/** A: flat apex, two spreading legs, crossbar. */
function inA(x, y) {
  if (y < CAP_TOP || y > CAP_BOT) return false;
  if (y <= 96) return inRect(x, y, 160, 78, 184, 96); // flat top
  const t = (y - 96) / (CAP_BOT - 96);
  const left = 172 - 40 * t;
  const right = 172 + 40 * t;
  const half = 11;
  if (Math.abs(x - left) <= half || Math.abs(x - right) <= half) return true; // legs
  if (y >= 140 && y <= 160 && x > left + half && x < right - half) return true; // crossbar
  return false;
}

function insideRoundedBg(x, y) {
  const cx = Math.min(Math.max(x, CORNER_R), DESIGN - 1 - CORNER_R);
  const cy = Math.min(Math.max(y, CORNER_R), DESIGN - 1 - CORNER_R);
  return (x - cx) ** 2 + (y - cy) ** 2 <= CORNER_R * CORNER_R;
}

/** Coverage of the gold lettering at a design-space point. */
function letterCoverage(x, y) {
  return inE(x, y) || inA(x, y) ? 1 : 0;
}

/** Renders one icon size; returns RGBA buffer. */
function render(size, ss = 6) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = DESIGN / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let gold = 0;
      let bgHits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) * scale;
          const y = (py + (sy + 0.5) / ss) * scale;
          if (insideRoundedBg(x, y)) {
            bgHits++;
            gold += letterCoverage(x, y);
          }
        }
      }
      const samples = ss * ss;
      const idx = (py * size + px) * 4;
      if (bgHits === 0) continue; // fully transparent corner
      const bgAlpha = bgHits / samples;
      const goldAlpha = gold / samples;
      const gy = Math.min(Math.max((py + 0.5) * scale, CAP_TOP), CAP_BOT);
      const t = (gy - CAP_TOP) / (CAP_BOT - CAP_TOP);
      const r = BG[0] * (1 - goldAlpha) + (GOLD_TOP[0] + (GOLD_BOT[0] - GOLD_TOP[0]) * t) * goldAlpha;
      const g = BG[1] * (1 - goldAlpha) + (GOLD_TOP[1] + (GOLD_BOT[1] - GOLD_TOP[1]) * t) * goldAlpha;
      const b = BG[2] * (1 - goldAlpha) + (GOLD_TOP[2] + (GOLD_BOT[2] - GOLD_TOP[2]) * t) * goldAlpha;
      rgba[idx] = Math.round(r);
      rgba[idx + 1] = Math.round(g);
      rgba[idx + 2] = Math.round(b);
      rgba[idx + 3] = Math.round(255 * bgAlpha);
    }
  }
  return rgba;
}

/* ---------- ICO container (PNG-compressed entries) ---------- */
const sizes = [16, 32, 48, 64];
const pngs = sizes.map((size) => ({ size, data: encodePng(size, render(size)) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(pngs.length, 4);
const entries = [];
let offset = 6 + 16 * pngs.length;
for (const { size, data } of pngs) {
  const entry = Buffer.alloc(16);
  entry[0] = size === 256 ? 0 : size;
  entry[1] = size === 256 ? 0 : size;
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += data.length;
  entries.push(entry);
}
const ico = Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
fs.writeFileSync("public/favicon.ico", ico);

/* ---------- verification ---------- */
const check = render(64);
const px = (x, y) => {
  const i = (y * 64 + x) * 4;
  return [check[i], check[i + 1], check[i + 2], check[i + 3]];
};
const corner = px(0, 0);
const centerBg = px(32, 10);
const eSpine = px(11, 32); // inside the E spine
const aApex = px(43, 22); // inside the A top
let goldPixels = 0;
for (let i = 0; i < check.length; i += 4) if (check[i + 1] > 120 && check[i] > 130) goldPixels++;
console.log("favicon.ico written:", ico.length, "bytes; sizes:", sizes.join("/"));
console.log("corner (transparent):", corner.join(","));
console.log("top-center background:", centerBg.join(","));
console.log("E spine pixel:", eSpine.join(","));
console.log("A apex pixel:", aApex.join(","));
console.log("gold coverage:", ((goldPixels / (64 * 64)) * 100).toFixed(1) + "%");
