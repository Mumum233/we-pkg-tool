/**
 * Publish this folder to GitHub via the REST API.
 *
 * Uses the Git Data API to build the whole tree and land it as a single commit,
 * so no git binary is needed. The token is read from the environment and never
 * written to disk or passed on a command line.
 *
 * Usage:
 *   set GITHUB_TOKEN=ghp_xxx
 *   node publish.mjs <owner/repo> [--private] [--description "..."]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const token = process.env.GITHUB_TOKEN;
const dryRun = process.argv.includes('--dry-run');

if (!token && !dryRun) {
  console.error('GITHUB_TOKEN is not set.');
  process.exit(1);
}

const repoArg = process.argv[2];
if (!repoArg || !repoArg.includes('/')) {
  console.error('Usage: node publish.mjs <owner/repo> [--private] [--description "..."]');
  process.exit(1);
}
const [owner, repoName] = repoArg.split('/');
const isPrivate = process.argv.includes('--private');
const dIdx = process.argv.indexOf('--description');
const description = dIdx >= 0 ? process.argv[dIdx + 1] : 'Extract original wallpaper images from Wallpaper Engine .pkg/.tex files (lossless)';

// fileURLToPath is required here: the previous naive string munging produced a
// path with a leading slash on Windows ("/D:/...") and the file scan would miss
// everything.
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const API = 'https://api.github.com';

// Files to publish, in a deliberate order. Nothing matched by .gitignore goes up:
// no extracted images, no .tex/.pkg, ever.
const SKIP_DIRS = new Set(['node_modules', '.git', 'output', 'images', 'out']);
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.tex', '.pkg']);

function collect(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.gitignore') continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...collect(path.join(dir, e.name), rel));
    } else {
      const ext = path.extname(e.name).toLowerCase();
      if (SKIP_EXT.has(ext)) {
        console.log(`  skip (would be copyrighted content): ${rel}`);
        continue;
      }
      out.push({ rel, abs: path.join(dir, e.name) });
    }
  }
  return out;
}

async function api(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'we-pkg-tool-publisher',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const msg = json?.message ?? text.slice(0, 300);
    const err = new Error(`${method} ${url} -> ${res.status} ${msg}`);
    err.status = res.status;
    err.details = json?.errors;
    throw err;
  }
  return json;
}

const files = collect(ROOT);
if (!files.length) throw new Error('nothing to publish');
console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Preparing ${files.length} files for ${owner}/${repoName}\n`);

if (dryRun) {
  for (const f of files) {
    console.log(`  would upload: ${f.rel} (${fs.statSync(f.abs).size} bytes)`);
  }
  console.log('\nDry run only. Set GITHUB_TOKEN and drop --dry-run to publish.');
  process.exit(0);
}

// 1. who am I
const me = await api('GET', '/user');
console.log(`authenticated as ${me.login}`);

// 2. create the repo (tolerate it already existing)
let repoExists = false;
try {
  await api('GET', `/repos/${owner}/${repoName}`);
  repoExists = true;
  console.log(`repository ${owner}/${repoName} already exists, will add a commit to it`);
} catch (e) {
  if (e.status !== 404) throw e;
}
if (!repoExists) {
  await api('POST', '/user/repos', {
    name: repoName,
    description,
    private: isPrivate,
    has_issues: true,
    has_wiki: false,
    auto_init: false,
  });
  console.log(`created repository ${owner}/${repoName}`);
}

// 3. The Git Data API cannot write blobs into a repository that has no commits
//    at all ("Git Repository is empty"). Seed one commit through the Contents
//    API first when the repo is brand new.
let seeded = false;
try {
  await api('GET', `/repos/${owner}/${repoName}/git/ref/heads/main`);
} catch {
  const seed = files.find((f) => f.rel === 'README.md') ?? files[0];
  await api('PUT', `/repos/${owner}/${repoName}/contents/${seed.rel}`, {
    message: 'Initial commit',
    content: fs.readFileSync(seed.abs).toString('base64'),
  });
  seeded = true;
  console.log(`seeded repository with ${seed.rel}`);
}

// 4. build blobs
const tree = [];
for (const f of files) {
  const content = fs.readFileSync(f.abs);
  const blob = await api('POST', `/repos/${owner}/${repoName}/git/blobs`, {
    content: content.toString('base64'),
    encoding: 'base64',
  });
  tree.push({ path: f.rel, mode: '100644', type: 'blob', sha: blob.sha });
  console.log(`  + ${f.rel} (${content.length} bytes)`);
}

// 4. parent commit, if the repo already had content
let parents = [];
try {
  const ref = await api('GET', `/repos/${owner}/${repoName}/git/ref/heads/main`);
  parents = [ref.object.sha];
} catch { /* empty repo */ }

// 5. tree -> commit -> ref
const newTree = await api('POST', `/repos/${owner}/${repoName}/git/trees`, { tree });
const commit = await api('POST', `/repos/${owner}/${repoName}/git/commits`, {
  message: 'Extract original wallpaper images from Wallpaper Engine pkg/tex (lossless, zero deps)',
  tree: newTree.sha,
  parents,
});

if (parents.length) {
  await api('PATCH', `/repos/${owner}/${repoName}/git/refs/heads/main`, { sha: commit.sha, force: false });
} else {
  await api('POST', `/repos/${owner}/${repoName}/git/refs`, { ref: 'refs/heads/main', sha: commit.sha });
}

console.log(`\nDone. https://github.com/${owner}/${repoName}`);
