// GitHub API client for the blog admin page.
// Reads one commit of the website repository (a "snapshot") and saves every change of one action
// as a single commit through the Git Data API: blobs, then a tree on top of the current tree,
// then a commit, then a fast-forward update of the branch. If the branch moved in the meantime,
// the changes are prepared again on the new head (at most maxRetries times).
// Runs in the browser and in Node 24: no DOM access, the fetch function is passed in.

export const API_VERSION = "2026-03-10";

const DEFAULT_BASE = "https://api.github.com";
const TIMEOUT_MS = 30000;
const LOCAL_HOSTS = ["127.0.0.1", "localhost"];
const LOCAL_API_RE = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;
const SHA_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const KEY_TEXT_RE = /(github_pat_|ghp_)[A-Za-z0-9_]+/g;

const MESSAGES = {
  network: "Could not reach GitHub. Check your internet connection and try again.",
  auth: "GitHub did not accept this access key. It may be mistyped, expired or deleted. Create a new key and sign in again.",
  permission: "This access key can't publish to the website. On GitHub, edit the key so it has access to the meritline-tax repository with Contents set to Read and write.",
  "not-found": "The website's repository could not be found. Check that the key has access to the meritline-tax repository.",
  conflict: "The website was changed somewhere else while you were publishing, so nothing was published. Your post is still here. Publish again when you are ready.",
  "rate-limit": "GitHub asked us to slow down. Wait a minute, then try again.",
  server: "GitHub had a temporary problem, so nothing was published. Wait a minute and try again.",
  version: "This admin page needs an update before it can talk to GitHub again.",
  validation: "GitHub rejected the change, so nothing was published.",
  unexpected: "Something unexpected went wrong, so nothing was published."
};

/** The API address. A local address is accepted only when the page itself runs on this computer. */
export function resolveApiBase(loc) {
  try {
    if (loc && LOCAL_HOSTS.includes(loc.hostname)) {
      const api = new URLSearchParams(loc.search || "").get("api");
      if (api && LOCAL_API_RE.test(api)) return api;
    }
  } catch { /* fall through to the default */ }
  return DEFAULT_BASE;
}

function hhmm(d) {
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function cleanDetail(s) {
  return String(s == null ? "" : s).replace(KEY_TEXT_RE, "[key]").replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * An error whose message is a complete sentence for the site owner.
 * new GitHubError(kind, { message?, detail?, status?, retryAt? }) or new GitHubError(kind, detailText)
 */
export class GitHubError extends Error {
  constructor(kind, opts = {}) {
    if (typeof opts === "string") opts = { detail: opts };
    const k = Object.prototype.hasOwnProperty.call(MESSAGES, kind) ? kind : "unexpected";
    const detail = cleanDetail(opts.detail);
    let message = opts.message ? String(opts.message).replace(KEY_TEXT_RE, "[key]") : MESSAGES[k];
    if (!opts.message && detail && (k === "validation" || k === "unexpected")) message += ` (${detail})`;
    super(message);
    this.name = "GitHubError";
    this.kind = k;
    this.status = typeof opts.status === "number" ? opts.status : null;
    this.retryAt = opts.retryAt instanceof Date ? opts.retryAt : null;
  }
}

function mapHttpError(status, headers, json, method) {
  const ghMessage = json && typeof json.message === "string" ? json.message : "";
  const header = name => { try { return headers.get(name); } catch { return null; } };
  if (status === 401) return new GitHubError("auth", { status });
  if (status === 403 || status === 429) {
    if (header("x-ratelimit-remaining") === "0") {
      const reset = Number(header("x-ratelimit-reset"));
      if (Number.isFinite(reset) && reset > 0) {
        const retryAt = new Date(reset * 1000);
        return new GitHubError("rate-limit", { status, retryAt, message: `GitHub is limiting requests right now. Try again after ${hhmm(retryAt)}.` });
      }
      return new GitHubError("rate-limit", { status });
    }
    const retryAfter = header("retry-after");
    if (status === 429 || retryAfter !== null || /secondary rate limit/i.test(ghMessage)) {
      const sec = Number(retryAfter);
      const retryAt = retryAfter !== null && Number.isFinite(sec) ? new Date(Date.now() + sec * 1000) : null;
      return new GitHubError("rate-limit", { status, retryAt });
    }
    return new GitHubError("permission", { status });
  }
  if (status === 404) return new GitHubError(method === "GET" ? "not-found" : "permission", { status });
  if (status === 410) return new GitHubError("version", { status });
  if (status >= 500) return new GitHubError("server", { status });
  if (status >= 400) return new GitHubError("validation", { status, detail: ghMessage || `error ${status}` });
  return new GitHubError("unexpected", { status, detail: `reply ${status}` });
}

// ---------- Byte helpers ----------

/** Base64 text of the bytes (no line breaks). */
export function bytesToBase64(bytes) {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Bytes of base64 text; whitespace is ignored (GitHub wraps its base64 every 60 characters). */
export function base64ToBytes(b64) {
  const clean = String(b64).replace(/\s+/g, "");
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(clean);
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Strict UTF-8 decoding that keeps a byte order mark; throws on invalid bytes. */
export function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

/** The id git gives a file with these bytes (same as `git hash-object`). */
export async function gitBlobSha(bytes) {
  const head = new TextEncoder().encode("blob " + bytes.length + "\0");
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head);
  all.set(bytes, head.length);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-1", all));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}

function checkRepoPath(path) {
  const ok = typeof path === "string" && path.length > 0 && path.length <= 400 && !path.startsWith("/") &&
    !path.includes("\\") && !path.includes("\0") &&
    path.split("/").every(seg => seg.length > 0 && seg !== "." && seg !== ".." && !/^[_.#~]/.test(seg));
  if (!ok) throw new GitHubError("unexpected", { detail: "a file name could not be used" });
}

function encodeBranch(branch) {
  return String(branch).split("/").map(encodeURIComponent).join("/");
}

// ---------- Client ----------

export function createClient({ base, token, owner, repo, fetch: fetchImpl }) {
  const apiBase = String(base || DEFAULT_BASE).replace(/\/+$/, "");
  const doFetch = fetchImpl || globalThis.fetch;
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const encoder = new TextEncoder();
  const blobCache = new Map();          // blob sha -> Promise<Uint8Array> (content-addressed, never stale)
  let queue = Promise.resolve();         // requests run one at a time

  function serial(task) {
    const run = queue.then(task, task);
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function send(method, path, body) {
    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token,
      "X-GitHub-Api-Version": API_VERSION
    };
    const init = { method, headers, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", redirect: "follow" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const ctrl = new AbortController();
    init.signal = ctrl.signal;
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res, text;
    try {
      res = await doFetch(apiBase + path, init);
      text = await res.text();
    } catch {
      throw new GitHubError("network");
    } finally {
      clearTimeout(timer);
    }
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch { json = null; } }
    if (res.status >= 200 && res.status < 300) {
      if (!json || typeof json !== "object") throw new GitHubError("unexpected", { status: res.status, detail: "GitHub sent a reply that could not be read" });
      return json;
    }
    throw mapHttpError(res.status, res.headers, json, method);
  }

  const request = (method, path, body) => serial(() => send(method, path, body));

  function readBlob(sha) {
    let p = blobCache.get(sha);
    if (!p) {
      p = request("GET", `${repoPath}/git/blobs/${sha}`).then(async json => {
        if (json.encoding !== "base64" || typeof json.content !== "string") throw new GitHubError("unexpected", { detail: "a file arrived in an unknown format" });
        const bytes = base64ToBytes(json.content);
        if (await gitBlobSha(bytes) !== sha) throw new GitHubError("unexpected", { detail: "a file arrived damaged" });
        return bytes;
      });
      blobCache.set(sha, p);
      p.catch(() => { if (blobCache.get(sha) === p) blobCache.delete(sha); });
    }
    return p;
  }

  async function readHead(branch) {
    const ref = await request("GET", `${repoPath}/git/ref/heads/${encodeBranch(branch)}`);
    const sha = ref && ref.object && ref.object.sha;
    if (typeof sha !== "string" || !SHA_RE.test(sha)) throw new GitHubError("unexpected", { detail: "the branch could not be read" });
    return sha;
  }

  async function readSnapshot(branch) {
    const headSha = await readHead(branch);
    const commit = await request("GET", `${repoPath}/git/commits/${headSha}`);
    const treeSha = commit && commit.tree && commit.tree.sha;
    if (typeof treeSha !== "string" || !SHA_RE.test(treeSha)) throw new GitHubError("unexpected", { detail: "the latest version could not be read" });
    const tree = await request("GET", `${repoPath}/git/trees/${treeSha}?recursive=1`);
    if (tree.truncated) throw new GitHubError("unexpected", { detail: "the website has too many files to list" });
    const entries = new Map();
    for (const e of Array.isArray(tree.tree) ? tree.tree : []) {
      if (e && e.type === "blob" && typeof e.path === "string" && typeof e.sha === "string") {
        entries.set(e.path, { mode: typeof e.mode === "string" ? e.mode : "100644", sha: e.sha });
      }
    }
    const paths = [...entries.keys()].sort();
    const missing = path => new GitHubError("unexpected", { message: `The file ${path} on the website could not be found, so nothing was published.` });
    const snap = {
      headSha,
      treeSha,
      has: path => entries.has(path),
      list: () => paths.slice(),
      readBytes: async path => {
        const e = entries.get(path);
        if (!e) throw missing(path);
        return (await readBlob(e.sha)).slice();
      },
      readText: async path => {
        const e = entries.get(path);
        if (!e) throw missing(path);
        const bytes = await readBlob(e.sha);
        try {
          return decodeUtf8(bytes);
        } catch {
          throw new GitHubError("unexpected", { message: `The file ${path} on the website could not be read, so nothing was published.` });
        }
      }
    };
    return { snap, entries };
  }

  return {
    async getRepo() {
      const json = await request("GET", repoPath);
      if (typeof json.default_branch !== "string" || !json.default_branch) {
        throw new GitHubError("unexpected", { detail: "the repository details could not be read" });
      }
      return { defaultBranch: json.default_branch, fullName: typeof json.full_name === "string" ? json.full_name : `${owner}/${repo}` };
    },

    async probeWrite() {
      try {
        await request("POST", `${repoPath}/git/blobs`, { content: "", encoding: "utf-8" });
      } catch (e) {
        if (e instanceof GitHubError && (e.status === 403 || e.status === 404) && e.kind !== "rate-limit") {
          throw new GitHubError("permission", { status: e.status });
        }
        throw e;
      }
    },

    async snapshot(branch) {
      return (await readSnapshot(branch)).snap;
    },

    async commit({ branch, prepare, maxRetries = 2, onStatus }) {
      const status = s => { try { if (onStatus) onStatus(s); } catch { /* status display only */ } };
      const uploaded = new Set();
      let attempt = 1;
      for (;;) {
        status("reading");
        const { snap, entries } = await readSnapshot(branch);
        status("preparing");
        const result = await prepare(snap);
        const changes = result && Array.isArray(result.changes) ? result.changes : [];
        if (!changes.length) return { commitSha: null, attempts: attempt, result };
        const message = result && typeof result.message === "string" ? result.message : "";
        if (!message.trim()) throw new GitHubError("unexpected", { detail: "the change had no description" });

        status("uploading");
        const tree = [];
        const seen = new Set();
        for (const c of changes) {
          checkRepoPath(c && c.path);
          if (seen.has(c.path)) throw new GitHubError("unexpected", { detail: "a file was listed twice" });
          seen.add(c.path);
          const existing = entries.get(c.path);
          if (c.delete === true) {
            if (existing) tree.push({ path: c.path, mode: existing.mode, type: "blob", sha: null });
            continue;
          }
          let bytes;
          if (typeof c.text === "string") bytes = encoder.encode(c.text);
          else if (c.bytes instanceof Uint8Array) bytes = c.bytes;
          else throw new GitHubError("unexpected", { detail: "a file had no content" });
          const local = await gitBlobSha(bytes);
          if (!uploaded.has(local)) {
            const blob = await request("POST", `${repoPath}/git/blobs`, { content: bytesToBase64(bytes), encoding: "base64" });
            if (blob.sha !== local) throw new GitHubError("unexpected", { detail: "a file did not arrive unchanged" });
            uploaded.add(local);
          }
          tree.push({ path: c.path, mode: existing ? existing.mode : "100644", type: "blob", sha: local });
        }
        if (!tree.length) return { commitSha: null, attempts: attempt, result };

        status("saving");
        const newTree = await request("POST", `${repoPath}/git/trees`, { base_tree: snap.treeSha, tree });
        if (typeof newTree.sha !== "string") throw new GitHubError("unexpected", { detail: "the new file list was not saved" });
        const newCommit = await request("POST", `${repoPath}/git/commits`, { message, tree: newTree.sha, parents: [snap.headSha] });
        if (typeof newCommit.sha !== "string") throw new GitHubError("unexpected", { detail: "the change was not saved" });
        try {
          await request("PATCH", `${repoPath}/git/refs/heads/${encodeBranch(branch)}`, { sha: newCommit.sha, force: false });
          return { commitSha: newCommit.sha, attempts: attempt, result };
        } catch (e) {
          if (!(e instanceof GitHubError) || (e.status !== 409 && e.status !== 422)) throw e;
          const now = await readHead(branch);
          if (now === snap.headSha) throw e;
          if (attempt <= maxRetries) {
            attempt++;
            status("retrying");
            continue;
          }
          throw new GitHubError("conflict", { status: e.status });
        }
      }
    }
  };
}
