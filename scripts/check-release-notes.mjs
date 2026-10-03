import { readFile } from 'node:fs/promises';

/**
 * Refuses to rewrite release notes that are already deployed — DP-110.
 *
 * AGENTS.md makes a deployed release's notes immutable: users have already been
 * shown them, and the update dialog of an older build renders whatever
 * `version.json` says. Until now that rule was kept by memory. This compares
 * what staging serves right now with what is about to be published.
 *
 * Usage: node scripts/check-release-notes.mjs <deployed version.json URL or file>
 *
 * Two rules, both against the deployed `version.json`:
 *   1. `release-notes.json` must still hold the deployed version's entry,
 *      unchanged. This is what catches editing 0.4.1 while shipping 0.4.2.
 *   2. If this build has the same version, its `dist/version.json` must be
 *      identical. Redeploying a version to ship code fixes stays legal; changing
 *      what it says does not.
 *
 * Rule 1 relies on `version.json` being a verbatim copy of its release entry,
 * which is what `scripts/generate-release-assets.mjs` writes. If that ever adds
 * derived fields, this comparison has to learn about them.
 *
 * It can only see the release that is deployed at this moment. Entries for
 * older releases are not shipped anywhere, so nothing here can vouch for them.
 *
 * A build older than what is deployed is a rollback (docs/deployment.md §4). The
 * tag being restored cannot know about a release made after it, so rule 1 would
 * always fail; a rollback is warned about and allowed instead.
 *
 * A 404 means nothing is deployed yet and passes. Any other failure to read the
 * deployed file stops the deploy: publishing without knowing what is live is
 * exactly the case this exists for.
 *
 * Nothing here calls `process.exit()` after the request: exiting with a response
 * body still open aborts Node on Windows with a libuv assertion, which turned a
 * passing 404 into exit code 127.
 */

class CheckFailure extends Error {}

function fail(message) {
  throw new CheckFailure(message);
}

/** Field order and whitespace are not content; compare by value. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function sameRelease(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

/** Names what differs, so the error says which line to put back. */
function describeDifference(deployed, local) {
  const lines = [];
  for (const key of [...new Set([...Object.keys(deployed), ...Object.keys(local)])].sort()) {
    if (sameRelease(deployed[key], local[key])) continue;
    if (key === 'changes' && Array.isArray(deployed.changes) && Array.isArray(local.changes)) {
      const length = Math.max(deployed.changes.length, local.changes.length);
      for (let index = 0; index < length; index += 1) {
        if (deployed.changes[index] === local.changes[index]) continue;
        lines.push(`  changes[${index}]: 已部署 ${JSON.stringify(deployed.changes[index])} → 本次 ${JSON.stringify(local.changes[index])}`);
      }
    } else {
      lines.push(`  ${key}: 已部署 ${JSON.stringify(deployed[key])} → 本次 ${JSON.stringify(local[key])}`);
    }
  }
  return lines.join('\n');
}

/** Negative when `left` is the older version. Plain x.y.z, as the repo uses. */
function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function parseDeployed(text, target) {
  try {
    return JSON.parse(text);
  } catch {
    return fail(`已部署的 version.json 不是有效的 JSON（${target}）。`);
  }
}

/** `null` when nothing is deployed yet. */
async function readDeployed(target) {
  if (!/^https?:\/\//.test(target)) return parseDeployed(await readFile(target, 'utf8'), target);

  // Pages caches version.json for minutes; a unique query asks for the origin.
  const url = new URL(target);
  url.searchParams.set('ts', String(Date.now()));
  let response;
  try {
    response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  } catch (cause) {
    return fail(`讀不到已部署的 version.json（${target}）：${cause instanceof Error ? cause.message : cause}。無法確認線上版本時不部署，請稍後重試。`);
  }
  const text = await response.text();
  if (response.status === 404) return null;
  if (!response.ok) {
    return fail(`已部署的 version.json 回應 HTTP ${response.status}（${target}）。無法確認線上版本時不部署，請稍後重試。`);
  }
  return parseDeployed(text, target);
}

async function check(target) {
  const deployed = await readDeployed(target);
  if (deployed === null) return `Release notes check passed: nothing is deployed at ${target} yet.`;
  if (typeof deployed?.version !== 'string') fail(`已部署的 version.json 沒有 version 欄位（${target}）。`);

  const releaseNotes = JSON.parse(await readFile('release-notes.json', 'utf8'));
  const built = JSON.parse(await readFile('dist/version.json', 'utf8'));

  if (compareVersions(built.version, deployed.version) < 0) {
    console.log(`::warning::這次部署的 ${built.version} 比線上的 ${deployed.version} 舊，視為 rollback，不比對公告。`);
    return `Release notes check skipped: rolling back from ${deployed.version} to ${built.version}.`;
  }

  const recorded = releaseNotes.releases.find((release) => release.version === deployed.version);
  if (!recorded) {
    fail(`release-notes.json 找不到已部署的 ${deployed.version}。已部署版本的公告不可刪除。`);
  }
  if (!sameRelease(recorded, deployed)) {
    fail(`release-notes.json 的 ${deployed.version} 與已部署的內容不同。已部署版本的公告不可回寫，變更請開新版本號。\n${describeDifference(deployed, recorded)}`);
  }
  if (built.version === deployed.version && !sameRelease(built, deployed)) {
    fail(`這次產出的 version.json 與已部署的 ${deployed.version} 同版號但內容不同。請先重新執行 npm run build。\n${describeDifference(deployed, built)}`);
  }

  return built.version === deployed.version
    ? `Release notes check passed: redeploying ${built.version} with the notes that are already live.`
    : `Release notes check passed: ${built.version} replaces ${deployed.version}, whose notes are unchanged.`;
}

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/check-release-notes.mjs <deployed version.json URL or file>');
  process.exitCode = 2;
} else {
  try {
    console.log(await check(target));
  } catch (error) {
    if (!(error instanceof CheckFailure)) throw error;
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
