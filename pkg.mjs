import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Wallpaper Engine PKG parser.
//
// File starts with:  int32 magicLen, bytes magic ("PKGV00xx"), int32 field2
// The PKG version is encoded in the magic itself (PKGV0024 -> 24); the int32
// after it is NOT the version.
//
// A record is assumed to be:
//     int32 nameLen, bytes name, int32 offset, int32 size
// with two knobs that differ between packages:
//     nul   - bytes of padding after the name
//     align - whether odd-length records are padded so the next nameLen is 4-aligned
// The correct combination is determined empirically by requiring that a parse
// consume the file exactly: records end where the payload begins, the payload
// is gapless from offset 0, and tableEnd + payloadLength == fileSize.
// ---------------------------------------------------------------------------

const VARIANTS = [];
for (const nul of [0, 1]) {
  for (const align of [false, true]) {
    for (const trailing of [false, true]) {
      VARIANTS.push({ nul, align, trailing });
    }
  }
}

function tryParse(b, v) {
  const magicLen = b.readInt32LE(0);
  if (magicLen < 4 || magicLen > 32) return null;
  const magic = b.subarray(4, 4 + magicLen).toString('ascii');
  if (!/^PKGV\d{4}$/.test(magic)) return null;

  let p = 4 + magicLen;
  p += 4;                                   // field2, semantics unknown/unused

  const recs = [];
  while (p + 4 <= b.length) {
    const start = p;
    const nameLen = b.readInt32LE(p);
    if (nameLen < 1 || nameLen > 1024) break;
    const nameFrom = p + 4;
    const nameTo = nameFrom + nameLen;
    if (nameTo > b.length) break;
    const name = b.subarray(nameFrom, nameTo).toString('utf8').replace(/\0+$/, '');
    if (!name || /[\x00-\x1f]/.test(name)) break;
    p = nameTo + v.nul;
    if (v.trailing) p += 4;                 // some versions carry an extra int before offset
    if (p + 8 > b.length) break;
    const offset = b.readInt32LE(p); p += 4;
    const size = b.readInt32LE(p); p += 4;
    if (offset < 0 || size < 0 || offset + size > b.length) break;
    recs.push({ name, offset, size, start });
    if (v.align && p % 4 !== 0) p += 4 - (p % 4);
    if (recs.length > 200000) return null;
  }
  if (!recs.length) return null;

  const tableEnd = p;
  const sorted = [...recs].sort((a, z) => a.offset - z.offset);
  let cursor = 0;
  for (const e of sorted) {
    if (e.offset !== cursor) return null;   // must be gapless from 0
    cursor = e.offset + e.size;
  }
  if (tableEnd + cursor !== b.length) return null;   // must close on EOF
  return { magic, version: Number(magic.slice(4)), tableEnd, records: sorted, payloadLength: cursor };
}

/**
 * Determine the layout that closes exactly on EOF. Returns null if none does.
 */
export function parsePkg(b, opts = {}) {
  const only = opts.variant ? VARIANTS.filter((v) => JSON.stringify(v) === JSON.stringify(opts.variant)) : VARIANTS;
  const winners = [];
  for (const v of only) {
    let r = null;
    try { r = tryParse(b, v); } catch { r = null; }
    if (r) winners.push({ variant: v, result: r });
  }
  if (!winners.length) return null;
  // prefer the variant yielding the most records (a wrong alignment usually
  // still parses a few records before derailing)
  winners.sort((a, z) => z.result.records.length - a.result.records.length);
  const best = winners[0];
  const ambiguous = winners.filter((w) => w.result.records.length === best.result.records.length).length > 1;
  return { ...best.result, variant: best.variant, ambiguous };
}

export function readPkgFile(file) {
  return fs.readFileSync(file);
}

// ---------------------------------------------------------------------------
// CLI: node pkg.mjs <pkgfile|dir> [--list] [--extract <outdir>]
// ---------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const target = args[0];
  const doList = args.includes('--list') || !args.includes('--extract');
  const exIdx = args.indexOf('--extract');
  const outDir = exIdx >= 0 ? args[exIdx + 1] : null;

  const files = [];
  const st = fs.statSync(target);
  if (st.isDirectory()) {
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const q = path.join(d, e.name);
        if (e.isDirectory()) walk(q);
        else if (e.name.toLowerCase().endsWith('.pkg')) files.push(q);
      }
    })(target);
  } else files.push(target);

  for (const f of files.sort()) {
    const b = readPkgFile(f);
    const r = parsePkg(b);
    if (!r) { console.log(`FAIL  ${f}  (${b.length} bytes) - no layout closes`); continue; }
    const flag = r.ambiguous ? ' [ambiguous]' : '';
    console.log(`OK${flag}  ${path.basename(path.dirname(f))}\\${path.basename(f)}  magic=${r.magic} v=${r.version} recs=${r.records.length} tableEnd=${r.tableEnd} payload=${r.payloadLength} size=${b.length} variant=${JSON.stringify(r.variant)}`);
    if (doList && !outDir) {
      for (const e of r.records) console.log(`        ${String(e.size).padStart(10)}  ${e.name}`);
    }
    if (outDir) {
      const root = path.resolve(outDir);
      for (const e of r.records) {
        const dst = path.resolve(root, e.name);
        if (!dst.startsWith(root + path.sep)) throw new Error(`path escape: ${e.name}`);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, b.subarray(r.tableEnd + e.offset, r.tableEnd + e.offset + e.size));
      }
      console.log(`        extracted ${r.records.length} files -> ${root}`);
    }
  }
}
