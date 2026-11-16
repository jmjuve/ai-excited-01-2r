// The Giant Rubber Duck — ai-excited-01 entry
// A colossal yellow rubber duck surfs a towering wave down a flooded city
// street at sunset. The joke is the scale: a bath toy the size of a building,
// with a tiny skyline, miniature cars and streetlamps below for scale.
// No text, clean flat-vector style, one huge unmistakable focal shape.
//
// Drawn programmatically, Node 22 stdlib only. Deterministic: a seeded RNG,
// two runs write byte-identical PNGs.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32) — deterministic, no Math.random anywhere.
// ---------------------------------------------------------------------------
let rngState = 20261116;
function rnd(): number {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rndRange(a: number, b: number): number {
  return a + (b - a) * rnd();
}

// ---------------------------------------------------------------------------
// CRC32 (PNG chunk checksums), standard table implementation.
// ---------------------------------------------------------------------------
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0; // filter: none
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (1 + width * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Framebuffer: rendered at 2x supersampling, then box-downsampled for smooth
// edges. All drawing coordinates are in 1024-space; primitives scale by SS.
// ---------------------------------------------------------------------------
const W = 1024;
const H = 1024;
const SS = 2;
const IW = W * SS;
const IH = H * SS;
const buf = new Uint8ClampedArray(IW * IH * 4);
for (let i = 0; i < buf.length; i += 4) buf[i + 3] = 255;

type RGBA = [number, number, number, number];

function blendPx(x: number, y: number, c: RGBA): void {
  if (x < 0 || y < 0 || x >= IW || y >= IH) return;
  const i = (y * IW + x) * 4;
  const a = c[3] / 255;
  if (a >= 1) {
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
    return;
  }
  const ia = 1 - a;
  buf[i] = Math.round(c[0] * a + buf[i] * ia);
  buf[i + 1] = Math.round(c[1] * a + buf[i + 1] * ia);
  buf[i + 2] = Math.round(c[2] * a + buf[i + 2] * ia);
}

// Scanline polygon fill (even-odd), points in 1024-space.
type Pt = [number, number];
function fillPoly(pts: Pt[], c: RGBA): void {
  const n = pts.length;
  if (n < 3) return;
  const sp: Pt[] = pts.map(([x, y]) => [x * SS, y * SS]);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of sp) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(IH - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const a = sp[i];
      const b = sp[(i + 1) % n];
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
        const t = (yc - a[1]) / (b[1] - a[1]);
        xs.push(a[0] + t * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(IW - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = x0; x <= x1; x++) blendPx(x, y, c);
    }
  }
}

// Ellipse (circle when rx === ry), rotated by `rot` radians.
function ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, c: RGBA, seg = 72): void {
  const pts: Pt[] = [];
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    const ex = Math.cos(t) * rx;
    const ey = Math.sin(t) * ry;
    pts.push([cx + ex * cr - ey * sr, cy + ex * sr + ey * cr]);
  }
  fillPoly(pts, c);
}

function circle(cx: number, cy: number, r: number, c: RGBA): void {
  ellipse(cx, cy, r, r, 0, c, 64);
}

// Thick line as a quad.
function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGBA): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  fillPoly(
    [
      [x0 + nx, y0 + ny],
      [x1 + nx, y1 + ny],
      [x1 - nx, y1 - ny],
      [x0 - nx, y0 - ny],
    ],
    c,
  );
  circle(x0, y0, w / 2, c);
  circle(x1, y1, w / 2, c);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(c0: RGBA, c1: RGBA, t: number): RGBA {
  return [
    Math.round(lerp(c0[0], c1[0], t)),
    Math.round(lerp(c0[1], c1[1], t)),
    Math.round(lerp(c0[2], c1[2], t)),
    Math.round(lerp(c0[3], c1[3], t)),
  ];
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const SKY_TOP: RGBA = [46, 18, 92, 255];
const SKY_MID: RGBA = [196, 62, 116, 255];
const SKY_LOW: RGBA = [255, 122, 61, 255];
const SKY_HORIZON: RGBA = [255, 205, 110, 255];
const SUN_CORE: RGBA = [255, 246, 196, 255];
const SUN_RIM: RGBA = [255, 190, 90, 255];
const CITY: RGBA = [38, 22, 66, 255];
const CITY_FAR: RGBA = [74, 38, 96, 255];
const WINDOW_LIT: RGBA = [255, 214, 120, 255];
const WATER_DEEP: RGBA = [10, 52, 84, 255];
const WATER: RGBA = [14, 88, 116, 255];
const WAVE_DARK: RGBA = [9, 110, 128, 255];
const WAVE: RGBA = [16, 158, 178, 255];
const WAVE_LIGHT: RGBA = [64, 205, 220, 255];
const FOAM: RGBA = [240, 253, 255, 255];
const FOAM_SOFT: RGBA = [220, 244, 250, 200];
const DUCK: RGBA = [255, 210, 31, 255];
const DUCK_DARK: RGBA = [240, 176, 18, 255];
const DUCK_LIGHT: RGBA = [255, 228, 110, 255];
const BEAK: RGBA = [255, 122, 26, 255];
const BEAK_DARK: RGBA = [230, 92, 12, 255];
const WHITE: RGBA = [255, 255, 255, 255];

// ---------------------------------------------------------------------------
// Sky: vertical sunset gradient, sun with halo, soft clouds.
// ---------------------------------------------------------------------------
function drawSky(): void {
  const stops: [number, RGBA][] = [
    [0, SKY_TOP],
    [0.34, SKY_MID],
    [0.6, SKY_LOW],
    [0.82, SKY_HORIZON],
    [1, SKY_HORIZON],
  ];
  for (let y = 0; y < IH; y++) {
    const t = y / IH;
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
    const lt = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0] || 1);
    const c = lerpColor(stops[i][1], stops[i + 1][1], Math.max(0, Math.min(1, lt)));
    for (let x = 0; x < IW; x++) {
      const p = (y * IW + x) * 4;
      buf[p] = c[0];
      buf[p + 1] = c[1];
      buf[p + 2] = c[2];
    }
  }

  // Sun glow: concentric translucent discs above the wave's rising face.
  const sunX = 620;
  const sunY = 215;
  for (let r = 240; r > 0; r -= 5) {
    const a = Math.round(lerp(0, 55, 1 - r / 240));
    circle(sunX, sunY, r, [255, 170, 80, a]);
  }
  circle(sunX, sunY, 92, SUN_RIM);
  circle(sunX, sunY, 74, SUN_CORE);

  // Soft flat clouds, warm pink and gold.
  const clouds: [number, number, number, number, RGBA][] = [
    [170, 150, 95, 14, [255, 150, 150, 60]],
    [300, 120, 70, 11, [255, 180, 140, 55]],
    [120, 250, 80, 12, [255, 140, 150, 50]],
    [880, 110, 85, 13, [255, 170, 130, 50]],
    [880, 470, 70, 11, [255, 190, 150, 45]],
  ];
  for (const [cx, cy, rx, ry, c] of clouds) ellipse(cx, cy, rx, ry, 0, c, 48);
}

// ---------------------------------------------------------------------------
// Tiny flooded city: miniature skyline, streetlamps and half-sunk cars at the
// bottom edge — the scale joke against the giant duck.
// ---------------------------------------------------------------------------
function drawSkyline(): void {
  // Far, hazier row.
  const far: [number, number, number][] = [
    [0, 120, 780],
    [110, 90, 800],
    [200, 150, 760],
    [330, 100, 800],
    [430, 130, 770],
  ];
  for (const [x, w, top] of far) {
    fillPoly(
      [
        [x, 1024],
        [x, top],
        [x + w, top],
        [x + w, 1024],
      ],
      CITY_FAR,
    );
  }
  // Near row, with lit windows.
  const near: [number, number, number][] = [
    [10, 70, 830],
    [95, 55, 860],
    [165, 90, 800],
    [270, 60, 850],
    [345, 80, 815],
    [440, 55, 860],
  ];
  for (const [x, w, top] of near) {
    fillPoly(
      [
        [x, 1024],
        [x, top],
        [x + w, top],
        [x + w, 1024],
      ],
      CITY,
    );
    // A few tiny lit windows.
    const rows = Math.floor((1024 - top) / 26);
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < Math.floor(w / 20); col++) {
        if (rnd() < 0.45) {
          fillPoly(
            [
              [x + 8 + col * 20, top + 12 + r * 26],
              [x + 15 + col * 20, top + 12 + r * 26],
              [x + 15 + col * 20, top + 20 + r * 26],
              [x + 8 + col * 20, top + 20 + r * 26],
            ],
            WINDOW_LIT,
          );
        }
      }
    }
  }

  // Streetlamps: thin poles with a glowing head, half-drowned, standing in
  // the open water on the right where the flood is visible.
  const lamps = [580, 680, 780, 880, 970];
  for (const lx of lamps) {
    thickLine(lx, 1024, lx, 940, 4, [30, 18, 52, 255]);
    circle(lx, 936, 7, [255, 220, 130, 255]);
    circle(lx, 936, 14, [255, 200, 100, 70]);
  }

  // Miniature cars, half-submerged, tilted by the flood, in the open water.
  const cars: [number, number, number, RGBA][] = [
    [620, 995, -0.06, [210, 60, 70, 255]],
    [720, 1000, 0.05, [70, 130, 210, 255]],
    [830, 992, -0.04, [240, 200, 60, 255]],
    [930, 1002, 0.08, [120, 200, 120, 255]],
  ];
  for (const [cx, cy, tilt, col] of cars) {
    const w = 46;
    const h = 16;
    const cr = Math.cos(tilt);
    const sr = Math.sin(tilt);
    const corner = (ox: number, oy: number): Pt => [cx + ox * cr - oy * sr, cy + ox * sr + oy * cr];
    fillPoly([corner(-w / 2, -h), corner(w / 2, -h), corner(w / 2, 0), corner(-w / 2, 0)], col);
    fillPoly([corner(-w / 4, -h - 9), corner(w / 4, -h - 9), corner(w / 3, -h), corner(-w / 3, -h)], [40, 50, 70, 255]);
    circle(cx - w / 4, cy - 1, 5, [20, 20, 30, 255]);
    circle(cx + w / 4, cy - 1, 5, [20, 20, 30, 255]);
  }
}

// ---------------------------------------------------------------------------
// Flood water across the bottom, with a warm sun reflection streak.
// ---------------------------------------------------------------------------
function drawWater(): void {
  fillPoly(
    [
      [0, 940],
      [1024, 900],
      [1024, 1024],
      [0, 1024],
    ],
    WATER_DEEP,
  );
  // Lighter surface band with shimmer lines.
  fillPoly(
    [
      [0, 952],
      [1024, 916],
      [1024, 960],
      [0, 990],
    ],
    WATER,
  );
  for (let i = 0; i < 26; i++) {
    const y = 930 + rnd() * 80;
    const x = rnd() * 1024;
    const len = 20 + rnd() * 70;
    thickLine(x, y, x + len, y + (rnd() - 0.5) * 3, 2, [255, 200, 120, Math.round(40 + rnd() * 70)]);
  }
}

// ---------------------------------------------------------------------------
// The towering wave: a huge diagonal wall of water rising from bottom-left
// to a curling crest top-right, with the sun glowing behind the crest.
// ---------------------------------------------------------------------------
function drawWave(): void {
  // Main wave body.
  fillPoly(
    [
      [0, 1024],
      [0, 800],
      [110, 660],
      [270, 540],
      [450, 420],
      [630, 310],
      [800, 225],
      [920, 185],
      [990, 195],
      [1024, 260],
      [980, 335],
      [880, 370],
      [760, 420],
      [620, 520],
      [470, 660],
      [310, 820],
      [170, 1024],
    ],
    WAVE,
  );
  // Darker shadow on the lower face.
  fillPoly(
    [
      [0, 1024],
      [0, 800],
      [110, 660],
      [270, 540],
      [450, 420],
      [520, 470],
      [380, 620],
      [230, 800],
      [120, 1024],
    ],
    WAVE_DARK,
  );
  // Bright light band sweeping up the face toward the crest.
  fillPoly(
    [
      [330, 520],
      [560, 360],
      [760, 260],
      [880, 235],
      [830, 300],
      [620, 420],
      [430, 560],
    ],
    WAVE_LIGHT,
  );
  // The curling crest: a big rolling tube over the top-right.
  ellipse(955, 255, 95, 62, -0.5, WAVE_LIGHT, 64);
  ellipse(955, 268, 62, 38, -0.5, WAVE_DARK, 64);
  ellipse(955, 262, 40, 22, -0.5, [6, 70, 88, 255], 64);
  // Foam lip along the crest edge.
  fillPoly(
    [
      [800, 225],
      [920, 185],
      [990, 195],
      [1024, 260],
      [1000, 285],
      [940, 240],
      [860, 245],
      [780, 275],
    ],
    FOAM,
  );
  // Foam drips hanging from the lip.
  for (let i = 0; i < 9; i++) {
    const x = 800 + rnd() * 200;
    const len = 14 + rnd() * 34;
    const y = 250 + rnd() * 20;
    thickLine(x, y, x + (rnd() - 0.5) * 10, y + len, 7 + rnd() * 6, FOAM_SOFT);
    circle(x, y + len, 5 + rnd() * 4, FOAM);
  }
  // White foam streaks racing down the wave face.
  for (let i = 0; i < 12; i++) {
    const t = rnd();
    const x = lerp(180, 830, t);
    const y = lerp(640, 300, t) + rnd() * 40;
    const len = 40 + rnd() * 90;
    thickLine(x, y, x + len * 0.55, y + len * 0.75, 4 + rnd() * 5, [235, 250, 255, Math.round(120 + rnd() * 90)]);
  }
}

// ---------------------------------------------------------------------------
// The Giant Rubber Duck: one huge yellow shape, tilted nose-up along the
// wave, big thrilled eye, open orange beak, wings tucked, tail up.
// ---------------------------------------------------------------------------
function drawDuck(): void {
  const rot = -0.42; // nose-up tilt along the wave slope
  const bx = 490; // body centre
  const by = 590;

  // Tail, sticking up at the back.
  fillPoly(
    [
      [300, 545],
      [255, 480],
      [315, 495],
      [345, 565],
    ],
    DUCK_DARK,
  );
  // Body: big tilted ellipse.
  ellipse(bx, by, 240, 168, rot, DUCK, 96);
  // Belly highlight on the lower front.
  ellipse(bx + 30, by + 55, 178, 98, rot, DUCK_LIGHT, 72);
  // Wing tucked on the body side: a dark crescent along the belly.
  ellipse(bx - 10, by + 25, 125, 60, rot - 0.18, DUCK_DARK, 64);
  ellipse(bx - 38, by + 2, 115, 52, rot - 0.18, DUCK, 64);

  // Head: big circle at the front-upper end of the body.
  const hx = 665;
  const hy = 410;
  circle(hx, hy, 120, DUCK);
  // Head highlight.
  ellipse(hx - 28, hy - 42, 66, 40, -0.4, DUCK_LIGHT, 48);

  // Beak: open, bright orange, pointing up-right along the tilt.
  fillPoly(
    [
      [737, 375],
      [855, 345],
      [878, 378],
      [765, 428],
    ],
    BEAK,
  );
  // Lower beak, slightly darker, dropped open.
  fillPoly(
    [
      [755, 428],
      [855, 415],
      [868, 445],
      [778, 468],
    ],
    BEAK_DARK,
  );
  // Beak seam.
  thickLine(765, 423, 855, 410, 4, [200, 70, 10, 255]);

  // Eye: huge, thrilled — big white, big pupil, sparkle.
  circle(665, 362, 38, WHITE);
  circle(678, 360, 20, [20, 20, 28, 255]);
  circle(670, 352, 8, WHITE);
  // Happy raised brow arc above the eye.
  thickLine(633, 312, 700, 306, 7, DUCK_DARK);

  // Cheek blush for charm.
  ellipse(718, 455, 28, 17, -0.3, [255, 150, 90, 160], 32);
}

// ---------------------------------------------------------------------------
// Motion: bursting spray, diagonal speed lines, foam at the wave base.
// ---------------------------------------------------------------------------
function drawSpray(): void {
  // Spray bursting off the crest.
  for (let i = 0; i < 90; i++) {
    const x = 780 + rnd() * 244;
    const y = 150 + rnd() * 190;
    const r = 2 + rnd() * 7;
    circle(x, y, r, [255, 255, 255, Math.round(150 + rnd() * 105)]);
  }
  // Spray kicked up around the duck, kept outside the body so it reads as
  // spray, not speckles on the duck itself.
  for (let i = 0; i < 40; i++) {
    const ang = rnd() * Math.PI * 2;
    const d = 250 + rnd() * 110;
    const x = 540 + Math.cos(ang) * d * 1.1;
    const y = 560 + Math.sin(ang) * d * 0.8;
    const r = 2 + rnd() * 6;
    circle(x, y, r, [255, 255, 255, Math.round(140 + rnd() * 115)]);
  }
  // Speed lines streaking in from the top-left, along the wave diagonal,
  // kept clear of the duck's face.
  for (let i = 0; i < 12; i++) {
    const x = rnd() * 430;
    const y = 40 + rnd() * 280;
    const len = 60 + rnd() * 130;
    thickLine(x, y, x + len, y - len * 0.45, 3 + rnd() * 4, [255, 255, 255, Math.round(50 + rnd() * 80)]);
  }
  // Foam churn at the wave base, bottom-left.
  for (let i = 0; i < 16; i++) {
    const x = rnd() * 340;
    const y = 900 + rnd() * 110;
    circle(x, y, 5 + rnd() * 13, FOAM_SOFT);
  }
  for (let i = 0; i < 10; i++) {
    const x = rnd() * 320;
    const y = 915 + rnd() * 95;
    circle(x, y, 3 + rnd() * 6, FOAM);
  }
}

// ---------------------------------------------------------------------------
// Downsample 2x2 box average -> 1024x1024 RGB, encode, write.
// ---------------------------------------------------------------------------
function render(): Buffer {
  drawSky();
  drawWater();
  drawSkyline();
  drawWave();
  drawDuck();
  drawSpray();

  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * IW + (x * SS + sx)) * 4;
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
        }
      }
      const o = (y * W + x) * 3;
      rgb[o] = Math.round(r / (SS * SS));
      rgb[o + 1] = Math.round(g / (SS * SS));
      rgb[o + 2] = Math.round(b / (SS * SS));
    }
  }
  return encodePng(W, H, rgb);
}

function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  const png = render();
  writeFileSync(join(outDir, 'entry.png'), png);
}

main();
