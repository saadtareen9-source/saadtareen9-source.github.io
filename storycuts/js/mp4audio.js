// Pull just the sound out of a phone video (.mov / .mp4) without loading the
// whole file: read the index (moov), find the AAC audio track, read only its
// samples and wrap them as an ADTS .aac stream, which every browser can decode.
// A 1 GB iPhone video usually has only a few MB of sound.

async function readAt(file, start, length) {
  return new DataView(await file.slice(start, start + length).arrayBuffer());
}

/** Walk the top-level boxes to find moov (it can be at the start or the end). */
async function findMoov(file) {
  let pos = 0;
  while (pos + 8 <= file.size) {
    const h = await readAt(file, pos, 16);
    let size = h.getUint32(0);
    const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
    let header = 8;
    if (size === 1) { size = Number(h.getBigUint64(8)); header = 16; }
    if (size === 0) size = file.size - pos;
    if (size < header) return null;
    if (type === 'moov') {
      if (size > 200 * 1024 * 1024) return null;
      return { view: await readAt(file, pos, size), start: header };
    }
    pos += size;
  }
  return null;
}

function* boxes(view, start, end) {
  let p = start;
  while (p + 8 <= end) {
    let size = view.getUint32(p);
    const type = String.fromCharCode(view.getUint8(p + 4), view.getUint8(p + 5), view.getUint8(p + 6), view.getUint8(p + 7));
    let header = 8;
    if (size === 1) { size = Number(view.getBigUint64(p + 8)); header = 16; }
    if (size === 0) size = end - p;
    if (size < header || p + size > end) return;
    yield { type, start: p + header, end: p + size };
    p += size;
  }
}
const child = (view, box, type) => { for (const b of boxes(view, box.start, box.end)) if (b.type === type) return b; return null; };
const path = (view, box, types) => types.reduce((b, t) => (b ? child(view, b, t) : null), box);

/** Read the AudioSpecificConfig from an esds box (object type, sample rate index, channels). */
function parseEsds(view, box) {
  let p = box.start + 4; // version + flags
  const end = box.end;
  const readLen = () => { let len = 0; for (let i = 0; i < 4; i++) { const b = view.getUint8(p++); len = (len << 7) | (b & 0x7f); if (!(b & 0x80)) break; } return len; };
  while (p < end) {
    const tag = view.getUint8(p++);
    const len = readLen();
    if (tag === 0x03) { p += 2; const flags = view.getUint8(p++); if (flags & 0x80) p += 2; if (flags & 0x40) p += view.getUint8(p) + 1; if (flags & 0x20) p += 2; continue; }
    if (tag === 0x04) { p += 13; continue; }
    if (tag === 0x05) {
      const b0 = view.getUint8(p), b1 = view.getUint8(p + 1);
      return { objectType: b0 >> 3, freqIndex: ((b0 & 7) << 1) | (b1 >> 7), channels: (b1 >> 3) & 15 };
    }
    p += len;
  }
  return null;
}

/**
 * Returns an ArrayBuffer holding the video's AAC sound as ADTS, or null if
 * this isn't an MP4/MOV with AAC audio (then the caller decodes another way).
 */
export async function extractAacAsAdts(file) {
  const moov = await findMoov(file);
  if (!moov) return null;
  const { view } = moov;
  const root = { start: moov.start, end: view.byteLength };
  for (const trak of boxes(view, root.start, root.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(view, trak, 'mdia');
    const hdlr = mdia && child(view, mdia, 'hdlr');
    if (!hdlr) continue;
    const kind = String.fromCharCode(view.getUint8(hdlr.start + 8), view.getUint8(hdlr.start + 9), view.getUint8(hdlr.start + 10), view.getUint8(hdlr.start + 11));
    if (kind !== 'soun') continue;
    const stbl = path(view, mdia, ['minf', 'stbl']);
    const stsd = stbl && child(view, stbl, 'stsd');
    if (!stsd) continue;
    // first sample entry: must be mp4a
    const entry = stsd.start + 8;
    const fmt = String.fromCharCode(view.getUint8(entry + 4), view.getUint8(entry + 5), view.getUint8(entry + 6), view.getUint8(entry + 7));
    if (fmt !== 'mp4a') return null;
    const entrySize = view.getUint32(entry);
    const version = view.getUint16(entry + 16);
    const extra = version === 1 ? 16 : version === 2 ? 36 : 0; // QuickTime sound description v1/v2
    let esds = null;
    for (const b of boxes(view, entry + 36 + extra, entry + entrySize)) {
      if (b.type === 'esds') esds = b;
      if (b.type === 'wave') esds = child(view, b, 'esds') || esds;
    }
    const cfg = esds && parseEsds(view, esds);
    if (!cfg) return null;
    // sample sizes
    const stsz = child(view, stbl, 'stsz');
    const fixed = view.getUint32(stsz.start + 4), count = view.getUint32(stsz.start + 8);
    const sizes = new Array(count);
    for (let i = 0; i < count; i++) sizes[i] = fixed || view.getUint32(stsz.start + 12 + i * 4);
    // chunk offsets
    const stco = child(view, stbl, 'stco'), co64 = child(view, stbl, 'co64');
    const chunkOffsets = [];
    if (stco) { const n = view.getUint32(stco.start + 4); for (let i = 0; i < n; i++) chunkOffsets.push(view.getUint32(stco.start + 8 + i * 4)); }
    else if (co64) { const n = view.getUint32(co64.start + 4); for (let i = 0; i < n; i++) chunkOffsets.push(Number(view.getBigUint64(co64.start + 8 + i * 8))); }
    // samples per chunk
    const stsc = child(view, stbl, 'stsc');
    const runs = [];
    { const n = view.getUint32(stsc.start + 4); for (let i = 0; i < n; i++) runs.push([view.getUint32(stsc.start + 8 + i * 12), view.getUint32(stsc.start + 12 + i * 12)]); }
    // where each sample lives in the file
    const spans = [];
    let s = 0;
    for (let c = 0; c < chunkOffsets.length && s < count; c++) {
      let per = 0;
      for (const [first, n] of runs) if (c + 1 >= first) per = n;
      let off = chunkOffsets[c];
      for (let k = 0; k < per && s < count; k++, s++) { spans.push([off, sizes[s]]); off += sizes[s]; }
    }
    if (!spans.length) return null;
    // read the audio bytes in large, contiguous reads
    const total = spans.reduce((a, [, n]) => a + n + 7, 0);
    const out = new Uint8Array(total);
    const profile = Math.max(1, cfg.objectType) - 1;
    let o = 0, i = 0;
    while (i < spans.length) {
      let j = i, end = spans[i][0] + spans[i][1];
      while (j + 1 < spans.length && spans[j + 1][0] === end && end - spans[i][0] < 4 * 1024 * 1024) { j++; end += spans[j][1]; }
      const bytes = new Uint8Array(await file.slice(spans[i][0], end).arrayBuffer());
      let b = 0;
      for (let k = i; k <= j; k++) {
        const len = spans[k][1] + 7;
        out[o] = 0xff; out[o + 1] = 0xf1;
        out[o + 2] = (profile << 6) | (cfg.freqIndex << 2) | (cfg.channels >> 2);
        out[o + 3] = ((cfg.channels & 3) << 6) | (len >> 11);
        out[o + 4] = (len >> 3) & 0xff;
        out[o + 5] = ((len & 7) << 5) | 0x1f;
        out[o + 6] = 0xfc;
        out.set(bytes.subarray(b, b + spans[k][1]), o + 7);
        o += len; b += spans[k][1];
      }
      i = j + 1;
    }
    return out.buffer;
  }
  return null;
}
