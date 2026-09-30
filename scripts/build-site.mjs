// PixelWatch M0.5 spike S2: build a synthetic served tree (03 §3 shape, not schema-complete).
// Same inputs -> byte-identical output. No timestamps, no dependencies, no network.
//
// Env: STORE_TIP, PR_NUMBERS ("1" or "1,2"), RUN_KEY ("1001-a1"), HEAD_SHA (40 hex),
//      RELEASE_COMMIT, CONFIG_COMMIT (40 hex), OUT_DIR (default _site), BUILT_MANIFEST (path).
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

const PREFIX = "pixelwatch";
const PROJECTION_VERSION = 1;

function need(name, re) {
  const v = process.env[name] ?? "";
  if (!re.test(v)) throw new Error(`${name} is missing or invalid: ${JSON.stringify(v)}`);
  return v;
}
const storeTip = need("STORE_TIP", /^[a-z0-9-]{1,40}$/);
const prNumbers = need("PR_NUMBERS", /^[1-9][0-9]{0,5}(,[1-9][0-9]{0,5}){0,4}$/).split(",").map(Number);
const runKey = need("RUN_KEY", /^[1-9][0-9]{0,19}-a[1-9][0-9]{0,3}$/);
const headSha = need("HEAD_SHA", /^[0-9a-f]{40}$/);
const releaseCommit = need("RELEASE_COMMIT", /^[0-9a-f]{40}$/);
const configCommit = need("CONFIG_COMMIT", /^[0-9a-f]{40}$/);
const outDir = process.env.OUT_DIR || "_site";
const builtManifest = need("BUILT_MANIFEST", /./);

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
/** Canonical JSON: sorted keys, no whitespace. */
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v !== null && typeof v === "object"
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
      : JSON.stringify(v);

const generation = sha256(canonical({ storeTip, releaseCommit, configCommit, projectionVersion: PROJECTION_VERSION }));

// A 4x4 RGBA PNG whose colour depends on the store tip (synthetic, not a screenshot).
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png4x4(rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(4, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const row = Buffer.from([0, ...Array(4).fill([...rgb, 255]).flat()]);
  const raw = Buffer.concat(Array(4).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const tipHash = Buffer.from(sha256(storeTip), "hex");
const png = png4x4([tipHash[0], tipHash[1], tipHash[2]]);
const pngHash = sha256(png);
const pngPath = `blobs/${pngHash.slice(0, 2)}/${pngHash}.png`;

const files = new Map();
const json = (v) => Buffer.from(JSON.stringify(v, null, 2) + "\n");
files.set(
  "site.json",
  json({
    schemaVersion: 1,
    spike: "PixelWatch M0.5 S2 (synthetic)",
    generation,
    generationInputs: { storeTip, releaseCommit, configCommit, projectionVersion: PROJECTION_VERSION },
    streams: Object.fromEntries(prNumbers.map((n) => [`pr-${n}`, { latest: runKey }])),
  }),
);
for (const n of prNumbers) {
  files.set(`api/v1/pr/${n}/latest.json`, json({ schemaVersion: 1, prNumber: n, runKey, headSha, generation }));
}
files.set(pngPath, png);
files.set(
  "index.html",
  Buffer.from(
    `<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>PixelWatch spike S2</title>\n` +
      `<p>Synthetic PixelWatch M0.5 spike page. Not a product.</p>\n` +
      `<p>generation <code>${generation}</code></p>\n<img src="${pngPath}" width="64" height="64" alt="synthetic 4x4 swatch">\n</html>\n`,
  ),
);

rmSync(outDir, { recursive: true, force: true });
const built = { generation, runKey, prNumbers, prefix: PREFIX, png: pngPath, files: {} };
for (const [rel, bytes] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const full = join(outDir, PREFIX, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, bytes);
  built.files[rel] = { sha256: sha256(bytes), bytes: bytes.length };
}
// Root redirect page so the project site root isn't a 404.
writeFileSync(join(outDir, "index.html"), `<!doctype html><meta charset="utf-8"><a href="${PREFIX}/">${PREFIX}/</a>\n`);

writeFileSync(builtManifest, JSON.stringify(built, null, 2) + "\n");
console.log(`generation=${generation}`);
for (const [rel, f] of Object.entries(built.files)) console.log(`built ${rel} sha256=${f.sha256} bytes=${f.bytes}`);
