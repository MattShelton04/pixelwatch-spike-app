// PixelWatch M0.5 spike S2: readiness poll (ADR 0004) and CDN observer.
//
//   node scripts/probe.mjs ready            # in the deploy job, after deploy-pages
//   node scripts/probe.mjs observe <secs>   # anywhere (e.g. locally) to time the switchover
//
// Env: SITE_URL (served prefix, ending in "/"), BUILT_MANIFEST (ready mode), PR_NUMBERS (observe),
//      TIMEOUT_S (default 600), INTERVAL_S (default 5), LOG_FILE (JSON lines, optional).
// Ready = served site.json has the expected generation AND every PR latest.json names the
// expected run key + generation AND every fetched body's SHA-256 equals the built bytes AND the
// PNG answers with the built bytes. HTTP 200 alone is never ready.
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

const MAX_BODY = 1 << 20;
const HEADERS = ["age", "x-cache", "x-cache-hits", "x-served-by", "etag", "last-modified", "cache-control", "date"];
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

const siteUrl = process.env.SITE_URL ?? "";
if (!/^https:\/\/[a-z0-9-]+\.github\.io\/[A-Za-z0-9._-]+\/pixelwatch\/$/.test(siteUrl)) {
  throw new Error(`SITE_URL must be https://<owner>.github.io/<repo>/pixelwatch/, got ${JSON.stringify(siteUrl)}`);
}
const intervalMs = 1000 * Number(process.env.INTERVAL_S || 5);
const logFile = process.env.LOG_FILE;
const t0 = Date.now();

async function get(rel, bust) {
  const url = new URL(rel, siteUrl);
  if (bust) url.searchParams.set("cb", `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BODY) throw new Error(`body over ${MAX_BODY} bytes`);
    const h = Object.fromEntries(HEADERS.map((k) => [k, res.headers.get(k)]).filter(([, v]) => v !== null));
    let parsed;
    if (res.status === 200 && rel.endsWith(".json")) {
      try {
        parsed = JSON.parse(buf.toString("utf8"));
      } catch {
        parsed = undefined;
      }
    }
    return { rel, bust, status: res.status, ms: Date.now() - started, sha256: sha256(buf), bytes: buf.length, headers: h, parsed };
  } catch (e) {
    return { rel, bust, status: 0, ms: Date.now() - started, error: String(e?.message ?? e) };
  }
}

function log(entry) {
  const line = JSON.stringify(entry);
  console.log(line);
  if (logFile) appendFileSync(logFile, line + "\n");
}

const brief = (r) => ({
  rel: r.rel,
  bust: r.bust || undefined,
  status: r.status,
  generation: r.parsed?.generation,
  runKey: r.parsed?.runKey,
  sha256: r.sha256,
  ms: r.ms,
  headers: r.headers,
  error: r.error,
});

const [mode, arg] = process.argv.slice(2);

if (mode === "ready") {
  const built = JSON.parse(readFileSync(process.env.BUILT_MANIFEST, "utf8"));
  const timeoutMs = 1000 * Number(process.env.TIMEOUT_S || 600);
  const targets = ["site.json", ...built.prNumbers.map((n) => `api/v1/pr/${n}/latest.json`), built.png];
  let polls = 0;
  const seen = { stale200: 0, notFound: 0, otherStatus: 0, digestMismatch: 0 };
  for (;;) {
    polls++;
    const results = await Promise.all(targets.map((t) => get(t, false)));
    const busted = await get("site.json", true);
    const verdicts = results.map((r) => {
      const want = built.files[r.rel]?.sha256;
      if (r.status !== 200) return r.status === 404 ? "404" : `status-${r.status}`;
      if (r.rel.endsWith(".json")) {
        if (r.parsed?.generation !== built.generation) return "stale-generation";
        if (r.rel.includes("/pr/") && r.parsed?.runKey !== built.runKey) return "stale-run-key";
      }
      return r.sha256 === want ? "ok" : "digest-mismatch";
    });
    for (const v of verdicts) {
      if (v === "stale-generation" || v === "stale-run-key") seen.stale200++;
      else if (v === "404") seen.notFound++;
      else if (v === "digest-mismatch") seen.digestMismatch++;
      else if (v !== "ok") seen.otherStatus++;
    }
    const ready = verdicts.every((v) => v === "ok");
    log({ poll: polls, elapsedMs: Date.now() - t0, at: new Date().toISOString(), ready, verdicts, results: results.map(brief), cacheBusted: brief(busted) });
    if (ready) {
      console.log(`READY generation=${built.generation} after ${Date.now() - t0} ms, ${polls} polls; not-ready observations: ${JSON.stringify(seen)}`);
      break;
    }
    if (Date.now() - t0 + intervalMs > timeoutMs) {
      console.log(`NOT READY after ${Date.now() - t0} ms, ${polls} polls: stored; deployment pending. Observations: ${JSON.stringify(seen)}`);
      process.exit(2);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
} else if (mode === "observe") {
  const durationMs = 1000 * Number(arg || 600);
  const prs = (process.env.PR_NUMBERS || "1").split(",");
  const targets = ["site.json", ...prs.map((n) => `api/v1/pr/${n}/latest.json`)];
  let polls = 0;
  while (Date.now() - t0 < durationMs) {
    polls++;
    const results = await Promise.all([...targets.map((t) => get(t, false)), get("site.json", true)]);
    log({ poll: polls, elapsedMs: Date.now() - t0, at: new Date().toISOString(), results: results.map(brief) });
    await new Promise((r) => setTimeout(r, intervalMs));
  }
} else {
  throw new Error("usage: probe.mjs ready | observe <seconds>");
}
