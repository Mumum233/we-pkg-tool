import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Wallpaper Engine .tex reader.
//
// Verified against real Steam Workshop packages (PKGV0009 .. PKGV0024).
//
//   "TEXV0005\0"
//   "TEXI0001\0" int32 format, int32 flags, int32 texW, int32 texH,
//                int32 imgW,   int32 imgH
//                (texW/H is the GPU-aligned storage size, imgW/H the real size)
//   "TEXB0003\0" int32 flags, int32 imageFormat, int32 mipCount,
//                int32 width, int32 height, int32 zero, int32 zero
//
// After the container header comes a chain of mip levels. Each level is:
//     int32 levelWidth, int32 levelHeight, int32 zero, int32 zero,
//     int32 payloadLength, <payload>
// where the payload is a COMPLETE PNG or JPEG image, stored verbatim. Dimensions
// halve each level. The container's own width/height are the base level, so the
// chain is walked structurally rather than by computing block sizes.
//
// Some textures instead store one flat payload (no dimension prefix):
//     int32 payloadLength, <payload>
// and a few carry LZ4-compressed blocks. All three shapes are handled.
//
// Because the payload is a real PNG/JPEG, extraction is lossless: the bytes are
// handed back exactly as authored, never re-encoded.
// ---------------------------------------------------------------------------

export const IMAGE_FORMATS = {
  0: 'RGBA8888', 1: 'DXT5', 2: 'DXT5', 3: 'DXT3', 4: 'VIDEO',
  5: 'DXT3', 6: 'DXT1', 7: 'RG88', 8: 'R8', 13: 'DXT1', '-1': 'RGBA8888 (raw)',
};

const SIG_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SIG_JPEG = Buffer.from([0xff, 0xd8, 0xff]);

const A = (b, o) => (o + 4 <= b.length ? b.readInt32LE(o) : NaN);
const cstr = (b, o) => {
  let e = o;
  const lim = Math.min(b.length, o + 64);
  while (e < lim && b[e] !== 0) e++;
  return { s: b.subarray(o, e).toString('ascii'), next: e + 1 };
};

/** Measured byte length of the PNG or JPEG starting at `at`. */
export function imageEnd(b, at) {
  if (b.subarray(at, at + 8).equals(SIG_PNG)) {
    let p = at + 8;
    while (p + 8 <= b.length) {
      const len = b.readUInt32BE(p);
      const type = b.toString('ascii', p + 4, p + 8);
      p += 12 + len;
      if (type === 'IEND') return p;
      if (len < 0 || p > b.length) break;
    }
    return -1;
  }
  if (b.subarray(at, at + 3).equals(SIG_JPEG)) {
    let i = at + 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd9) return i + 2;
      if (m === 0xda) {                        // start of scan: hunt for EOI
        let j = i + 2 + b.readUInt16BE(i + 2);
        while (j + 2 <= b.length) {
          if (b[j] === 0xff && b[j + 1] === 0xd9) return j + 2;
          j++;
        }
        return -1;
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if (len < 2) { i += 2; continue; }
      i += 2 + len;
    }
    return -1;
  }
  return -1;
}

/** Dimensions of a PNG or JPEG payload. */
export function imageSize(d, ext) {
  if (ext === 'png' && d.length > 24) return { w: d.readUInt32BE(16), h: d.readUInt32BE(20) };
  if (ext === 'jpg') {
    let i = 2;
    while (i + 9 < d.length) {
      if (d[i] !== 0xff) { i++; continue; }
      const m = d[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: d.readUInt16BE(i + 5), w: d.readUInt16BE(i + 7) };
      }
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = d.readUInt16BE(i + 2);
      if (len < 2) { i += 2; continue; }
      i += 2 + len;
    }
  }
  return null;
}

export function parseTex(b) {
  let p = 0;
  let t = cstr(b, p);
  if (!t.s.startsWith('TEXV')) throw new Error(`not a TEX (magic ${JSON.stringify(t.s)})`);
  const texVersion = t.s;
  p = t.next;

  t = cstr(b, p);
  if (!t.s.startsWith('TEXI')) throw new Error(`expected TEXI, got ${JSON.stringify(t.s)}`);
  p = t.next;
  const header = {
    format: A(b, p), flags: A(b, p + 4),
    texW: A(b, p + 8), texH: A(b, p + 12),
    imgW: A(b, p + 16), imgH: A(b, p + 20),
  };
  p += 24;

  const bIdx = b.indexOf(Buffer.from('TEXB', 'latin1'), p);
  if (bIdx < 0) throw new Error('no TEXB container');
  t = cstr(b, bIdx);
  const containerTag = t.s;
  p = t.next;

  const container = { tag: containerTag, version: Number(containerTag.slice(4)), levels: [] };
  container.flags = A(b, p); p += 4;
  container.imageFormat = A(b, p); p += 4;
  if (container.version >= 4) { container.isVideo = A(b, p); p += 4; }
  container.mipCount = A(b, p); p += 4;
  container.width = A(b, p); p += 4;
  container.height = A(b, p); p += 4;
  p += 8;                                        // two reserved int32
  // Walk the mip chain structurally. The container's mipCount is not reliable
  // (some packages declare 7 levels while storing 2), so the chain is consumed
  // greedily and stops when a record can no longer be formed.
  let levelW = container.width, levelH = container.height;
  for (let i = 0; i < 64; i++) {
    if (p + 4 > b.length) break;
    if (levelW <= 1 && levelH <= 1) break;
    let dimW = NaN, dimH = NaN, payloadLen = NaN, payloadAt = NaN;

    // form A: w, h, 0, 0, len, payload
    if (p + 20 <= b.length) {
      const cw = A(b, p), ch = A(b, p + 4), z0 = A(b, p + 8), z1 = A(b, p + 12), len = A(b, p + 16);
      if (cw > 0 && ch > 0 && cw <= 32768 && ch <= 32768 && z0 === 0 && z1 === 0 &&
          len > 0 && p + 20 + len <= b.length) {
        dimW = cw; dimH = ch; payloadLen = len; payloadAt = p + 20;
      }
    }
    // form D: fmt=-1 RGBA payload -- [rawSize][storedSize], data immediately after.
    // Covers LZ4-compressed RGBA, including storedSize == rawSize (uncompressed).
    if (Number.isNaN(payloadAt) && container.imageFormat === -1 && p + 8 <= b.length) {
      const rawSize = A(b, p);
      const stored = A(b, p + 4);
      const dataAt = p + 8;
      if (rawSize > 0 && rawSize <= 64e6 && stored > 0 && dataAt + stored <= b.length) {
        let entry = null;
        if (rawSize === stored) {
          entry = { ext: 'rgba', rgba: true, data: b.subarray(dataAt, dataAt + stored), measured: stored };
        } else {
          try {
            entry = { ext: 'lz4', lz4: true, data: lz4Decompress(b.subarray(dataAt, dataAt + stored), rawSize), measured: rawSize };
          } catch { entry = null; }
        }
        if (entry) {
          container.levels.push({
            level: i, w: levelW, h: levelH, headerW: levelW, headerH: levelH,
            at: dataAt, declared: stored, verbatim: false, ...entry,
          });
          p = dataAt + stored;
          levelW = Math.max(1, levelW >> 1);
          levelH = Math.max(1, levelH >> 1);
          continue;
        }
      }
    }
    // form B: len, payload  (weakest evidence: a single length field)
    if (Number.isNaN(payloadAt) && p + 4 <= b.length) {
      const len = A(b, p);
      if (len > 0 && p + 4 + len <= b.length) {
        dimW = levelW; dimH = levelH; payloadLen = len; payloadAt = p + 4;
      }
    }
    if (Number.isNaN(payloadAt)) break;

    const start = b.indexOf(SIG_PNG, payloadAt) === payloadAt ? payloadAt
      : b.indexOf(SIG_JPEG, payloadAt) === payloadAt ? payloadAt : -1;
    let entry;
    if (start >= 0) {
      const ext = b.subarray(start, start + 8).equals(SIG_PNG) ? 'png' : 'jpg';
      const size = imageSize(b.subarray(start, start + Math.min(payloadLen, b.length - start)), ext);
      // `declared` is authoritative: the payload length is written by the packer
      // and, for every PNG in the samples, equals the image's own byte length.
      entry = {
        level: i, w: size?.w ?? dimW, h: size?.h ?? dimH,
        headerW: dimW, headerH: dimH,
        ext, at: start, declared: payloadLen,
        measured: imageEnd(b, start), verbatim: true,
        data: b.subarray(start, start + payloadLen),
      };
    } else {
      entry = { level: i, w: dimW, h: dimH, headerW: dimW, headerH: dimH, ext: null, at: payloadAt, declared: payloadLen, measured: -1, verbatim: false, data: b.subarray(payloadAt, payloadAt + payloadLen) };
    }
    container.levels.push(entry);

    p = payloadAt + payloadLen;
    levelW = Math.max(1, levelW >> 1);
    levelH = Math.max(1, levelH >> 1);
  }

  return { texVersion, header, container, consumed: p, total: b.length, exact: p === b.length };
}

// ---- fallbacks for block-compressed textures -------------------------------

/** Standard LZ4 block decompression. */
export function lz4Decompress(src, destSize) {
  const dst = Buffer.alloc(destSize);
  let s = 0, d = 0;
  while (s < src.length) {
    const token = src[s++];
    let lit = token >> 4;
    if (lit === 15) { let a; do { a = src[s++]; lit += a; } while (a === 255); }
    if (lit) {
      if (s + lit > src.length || d + lit > dst.length) throw new Error('LZ4 literal overrun');
      src.copy(dst, d, s, s + lit); s += lit; d += lit;
    }
    if (s >= src.length) break;
    if (s + 2 > src.length) throw new Error('LZ4 truncated');
    const off = src[s] | (src[s + 1] << 8); s += 2;
    let ml = token & 0x0f;
    if (ml === 15) { let a; do { a = src[s++]; ml += a; } while (a === 255); }
    ml += 4;
    if (off === 0 || off > d || d + ml > dst.length) throw new Error(`bad LZ4 match off=${off} d=${d} len=${ml}`);
    for (let i = 0; i < ml; i++) { dst[d] = dst[d - off]; d++; }
  }
  if (d !== destSize) throw new Error(`LZ4 produced ${d} of ${destSize} bytes`);
  return dst;
}

function dxtPalette(c0, c1, dxt1) {
  const r0 = ((c0 >> 11) & 31) * 255 / 31, g0 = ((c0 >> 5) & 63) * 255 / 63, b0 = (c0 & 31) * 255 / 31;
  const r1 = ((c1 >> 11) & 31) * 255 / 31, g1 = ((c1 >> 5) & 63) * 255 / 63, b1 = (c1 & 31) * 255 / 31;
  const q = [[r0, g0, b0, 255], [r1, g1, b1, 255]];
  if (!dxt1 || c0 > c1) {
    q.push([(2 * r0 + r1) / 3, (2 * g0 + g1) / 3, (2 * b0 + b1) / 3, 255]);
    q.push([(r0 + 2 * r1) / 3, (g0 + 2 * g1) / 3, (b0 + 2 * b1) / 3, 255]);
  } else {
    q.push([(r0 + r1) / 2, (g0 + g1) / 2, (b0 + b1) / 2, 255]);
    q.push([0, 0, 0, 0]);
  }
  return q;
}

export function decodeDxt(data, w, h, dxt1) {
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
  const need = bw * bh * (dxt1 ? 8 : 16);
  if (data.length < need) throw new Error(`DXT payload too short: ${data.length} < ${need}`);
  const out = Buffer.alloc(w * h * 4);
  const alpha = new Uint8Array(8);
  let o = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let abits = 0n;
      if (!dxt1) {
        const a0 = data[o], a1 = data[o + 1];
        alpha[0] = a0; alpha[1] = a1;
        if (a0 > a1) for (let i = 1; i <= 6; i++) alpha[i + 1] = ((7 - i) * a0 + i * a1) / 7;
        else { for (let i = 1; i <= 4; i++) alpha[i + 1] = ((5 - i) * a0 + i * a1) / 5; alpha[6] = 0; alpha[7] = 255; }
        for (let i = 0; i < 6; i++) abits |= BigInt(data[o + 2 + i]) << BigInt(8 * i);
        o += 8;
      }
      const c0 = data[o] | (data[o + 1] << 8), c1 = data[o + 2] | (data[o + 3] << 8);
      const pal = dxtPalette(c0, c1, dxt1);
      let bits = (data[o + 4] | (data[o + 5] << 8) | (data[o + 6] << 16) | (data[o + 7] << 24)) >>> 0;
      o += 8;
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const ci = bits & 3; bits >>>= 2;
          const ai = dxt1 ? 0 : Number(abits & 7n);
          if (!dxt1) abits >>= 3n;
          const x = bx * 4 + px, y = by * 4 + py;
          if (x >= w || y >= h) continue;
          const tt = (y * w + x) * 4, c = pal[ci];
          out[tt] = c[0]; out[tt + 1] = c[1]; out[tt + 2] = c[2];
          out[tt + 3] = dxt1 ? 255 : alpha[ai];
        }
      }
    }
  }
  return out;
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function rgbaToPng(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const target = args[0];
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? args[outIdx + 1] : null;
  const allMips = args.includes('--all-mips');

  const files = [];
  const st = fs.statSync(target);
  if (st.isDirectory()) {
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const q = path.join(d, e.name);
        if (e.isDirectory()) walk(q);
        else if (e.name.toLowerCase().endsWith('.tex')) files.push(q);
      }
    })(target);
  } else files.push(target);

  let exactCount = 0, okCount = 0, failCount = 0;
  const stats = new Map();
  for (const f of files.sort()) {
    const b = fs.readFileSync(f);
    try {
      const tex = parseTex(b);
      const c = tex.container;
      const verbatim = c.levels.filter((l) => l.verbatim).length;
      console.log(`OK   ${path.basename(f)}  fmt=${c.imageFormat}(${IMAGE_FORMATS[c.imageFormat] ?? '?'}) ${c.width}x${c.height} levels=${c.levels.length} verbatim=${verbatim} consumed=${tex.consumed}/${tex.total}${tex.exact ? ' EXACT' : ''}`);
      for (const l of c.levels) {
        console.log(`        L${l.level}: ${l.w}x${l.h} ${l.ext ?? 'opaque'} declared=${l.declared} measured=${l.measured}${l.verbatim ? '' : ' (not an image)'}`);
      }
      if (verbatim) okCount++;
      if (tex.exact) exactCount++;
      const chosen = allMips ? c.levels : c.levels.slice(0, 1);
      if (outDir) {
        fs.mkdirSync(outDir, { recursive: true });
        for (const l of chosen) {
          const base = path.basename(f).replace(/\.tex$/i, '');
          const suffix = allMips ? `_L${l.level}` : '';
          if (l.verbatim) {
            fs.writeFileSync(path.join(outDir, `${base}${suffix}.${l.ext}`), l.data);
          } else if (l.lz4 || l.rgba) {
            // compressed or raw RGBA pixels -> PNG
            const need = l.w * l.h * 4;
            if (l.data.length >= need) {
              fs.writeFileSync(path.join(outDir, `${base}${suffix}.png`), rgbaToPng(l.data.subarray(0, need), l.w, l.h));
            }
          }
        }
      }
      stats.set(`verbatim ${verbatim}/${c.levels.length}`, (stats.get(`verbatim ${verbatim}/${c.levels.length}`) ?? 0) + 1);
    } catch (e) {
      console.log(`FAIL ${path.basename(f)}  ${e.message}`);
      failCount++;
    }
  }
  console.log(`\nparsed=${okCount + failCount - 0} withVerbatim=${okCount} exactFileConsumption=${exactCount} failedParsing=${failCount}`);
}
