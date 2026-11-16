// Blog admin page: screens, sign-in, browser drafts, preview, and the publish and delete flows.
// Everything that changes the website goes through planCommit (generate.js) and client.commit
// (github.js), so one action is always one commit and nothing is half-written.

// Every relative import carries the same ?v= as index.html, so a browser never mixes old and new files.
import { CONFIG } from "./config.js?v=20261116";
import { createClient, resolveApiBase, GitHubError } from "./github.js?v=20261116";
import { createEditor } from "./editor.js?v=20261116";
import {
  PlanError, LIMITS, SEO_TITLE_SUFFIX, cleanText, typesetText, slugify, validatePost, newPost, postFromJson,
  loadSiteContext, buildPostPage, planCommit, needsShareImage, findInboundLinks, findListingGaps, planRepair
} from "./generate.js?v=20261116";
import { renderShareImage } from "./og.js?v=20261116";

// The page loaded, so the "open this on your website" fallback is not needed.
{ const boot = document.getElementById("boot-msg"); if (boot) boot.remove(); }

// The admin must never run inside another site's frame.
if (window.top !== window.self) {
  document.documentElement.replaceChildren();
  throw new Error("framed");
}

// ---------- Environment ----------

const API_BASE = resolveApiBase(window.location);
const LOCAL_API = API_BASE !== CONFIG.apiBase;          // only possible on this computer (see github.js)
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const KEY_RE = /^github_pat_[A-Za-z0-9_]{20,}$/;
// Classic and app keys: they cannot be limited to one repository, so they are refused before they are used.
const CLASSIC_KEY_RE = /^gh[pousr]_/;
const CLASSIC_KEY_MSG = "This is an older type of GitHub key that can change all your repositories. Create a fine-grained key with the steps below.";
const REMEMBER_MS = (CONFIG.rememberDays || 30) * 24 * 60 * 60 * 1000;
const POST_PATH_RE = /^admin\/posts\/([a-z0-9-]+)\.json$/;
const DRAFT_ID_RE = /^[0-9a-f]{16}$/;
const OTHER_CATEGORY = "*other*";
const OG_SOURCES = { latin: "../fonts/figtree-latin.woff2", latinExt: "../fonts/figtree-latin-ext.woff2", icon: "../images/icon.png" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function isRealIso(s) {
  const m = ISO_RE.exec(String(s || ""));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const TODAY_OVERRIDE = (() => {
  if (!LOCAL_API) return null;
  const t = new URLSearchParams(window.location.search).get("today");
  return isRealIso(t) ? t : null;
})();

function todayIso() {
  if (TODAY_OVERRIDE) return TODAY_OVERRIDE;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const hhmm = d => String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");

function fmtLong(iso) {
  const m = ISO_RE.exec(String(iso || ""));
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : String(iso || "");
}

// The same "Month D, YYYY" form as the website, with the time.
function fmtSaved(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${hhmm(d)}`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- Storage (every access may fail: private windows, blocked storage) ----------

const PREFIX = CONFIG.storagePrefix;

function storageOf(kind) {
  try { return kind === "local" ? window.localStorage : window.sessionStorage; } catch { return null; }
}
function sGet(kind, key) {
  try { const s = storageOf(kind); return s ? s.getItem(PREFIX + key) : null; } catch { return null; }
}
function sSet(kind, key, value) {
  try { const s = storageOf(kind); if (!s) return false; s.setItem(PREFIX + key, value); return true; } catch { return false; }
}
function sDel(kind, key) {
  try { const s = storageOf(kind); if (s) s.removeItem(PREFIX + key); } catch { /* nothing to remove */ }
}

// A remembered key is forgotten after CONFIG.rememberDays without use ("keyUsed" holds the last use).
let memoryKey = null;
let keyExpired = false;
function loadKey() {
  const session = sGet("session", "key");
  if (session) return session;
  const local = sGet("local", "key");
  if (local) {
    const used = Date.parse(sGet("local", "keyUsed") || "");
    if (Number.isFinite(used) && Date.now() - used > REMEMBER_MS) {
      clearKey();
      keyExpired = true;
      return null;
    }
    sSet("local", "keyUsed", new Date().toISOString());
    return local;
  }
  return memoryKey;
}
function saveKey(key, remember) {
  memoryKey = key;
  if (remember) { sSet("local", "key", key); sSet("local", "keyUsed", new Date().toISOString()); sDel("session", "key"); }
  else { sSet("session", "key", key); sDel("local", "key"); sDel("local", "keyUsed"); }
}
function clearKey() {
  memoryKey = null;
  sDel("session", "key");
  sDel("local", "key");
  sDel("local", "keyUsed");
}

// Drafts: an index plus one record per post id. Drafts never leave this browser.
function readDraftIndex() {
  try {
    const list = JSON.parse(sGet("local", "drafts") || "[]");
    return Array.isArray(list) ? list.filter(d => d && DRAFT_ID_RE.test(d.draftId)) : [];
  } catch { return []; }
}
function writeDraftIndex(list) {
  return sSet("local", "drafts", JSON.stringify(list));
}
function readDraft(draftId) {
  if (!DRAFT_ID_RE.test(String(draftId))) return null;
  try {
    const rec = JSON.parse(sGet("local", "draft." + draftId) || "null");
    return rec && rec.post && typeof rec.post === "object" ? rec : null;
  } catch { return null; }
}
function deleteDraft(draftId) {
  sDel("local", "draft." + draftId);
  writeDraftIndex(readDraftIndex().filter(d => d.draftId !== draftId));
}

function dataUrlToBytes(url) {
  const m = /^data:[^;,]*;base64,(.*)$/.exec(String(url || ""));
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

// ---------- State and DOM helpers ----------

const $ = id => document.getElementById(id);
const app = $("app");

const S = {
  screen: null,
  busy: false,
  client: null,
  branch: null,
  ctx: null,
  ctxError: null,
  posts: [],                 // [{ slug, post } | { slug, error: true }]
  gaps: [],                  // posts missing from the lists: [{ slug, title, missing }]
  listLoaded: false,
  undo: { kp: null, faq: null },
  draft: null,               // { draftId, mode, baseModified, post }
  editor: null,
  slugEdited: false,
  categoryOther: false,      // "Other..." chosen in the card label list
  formMessages: [],
  touched: new Set(),
  showAllErrors: false,
  validation: { errors: [], warnings: [] },
  dirty: false,
  saveTimer: null,
  validateTimer: null,
  og: { title: null, png: null, fits: true, url: null },
  ogTimer: null,
  ogSeq: 0,
  action: null,              // { kind, mode, post, today, assets, plan, draftId? }
  live: null,
  confirmOgUrl: null,
  bodyMsgTimer: null
};

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "text") node.textContent = v;
    else if (k === "className") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

function setBusy(on) {
  S.busy = on;
  app.dataset.busy = on ? "true" : "false";
}

function showScreen(name, { keepError = false } = {}) {
  if (S.screen === "result" && name !== "result") stopLiveCheck();
  for (const sec of app.querySelectorAll(":scope > .screen")) sec.hidden = sec.id !== "screen-" + name;
  app.dataset.screen = name;
  S.screen = name;
  if (!keepError) hideError();
  renderSiteProblem();
  $("sign-out").hidden = !S.client;
  const h1 = $("screen-" + name) && $("screen-" + name).querySelector("h1");
  window.scrollTo(0, 0);
  if (h1) {
    h1.setAttribute("tabindex", "-1");
    try { h1.focus({ preventScroll: true }); } catch { /* focus is a convenience */ }
  }
}

// An error from this page whose message is already a full sentence for the owner.
function ownerError(message) {
  const e = new Error(message);
  e.forOwner = true;
  return e;
}

function safeMessage(err) {
  if (err instanceof GitHubError || isPlanError(err) || (err && err.forOwner)) return err.message;
  const detail = err && err.message ? String(err.message).replace(/(github_pat_|ghp_)[A-Za-z0-9_]+/g, "[key]").slice(0, 160) : "";
  return "Something unexpected went wrong, so nothing was changed." + (detail ? ` (${detail})` : "");
}

function isPlanError(err) {
  return !!err && (err instanceof PlanError || err.name === "PlanError");
}

function showError(err) {
  const text = typeof err === "string" ? err : safeMessage(err);
  $("app-error-text").textContent = text;
  $("app-error").hidden = false;
  $("app-error").scrollIntoView({ block: "nearest" });
}

function hideError() {
  $("app-error").hidden = true;
  $("app-error-text").textContent = "";
}

// The website could be read but not used (for example it still has the old page layout): one notice that stays
// on the list, editor and preview screens until the website is read again without the problem.
function siteProblemText(err) {
  if (isPlanError(err) && err.code === "SHELL") {
    return "Your website does not have the new page layout yet, so posts can't be published from this page. Upload the new website files, then press Refresh list.";
  }
  if (isPlanError(err) && err.code === "ANCHOR") {
    return `A file on your website${err.file ? ` (${err.file})` : ""} no longer has the layout this page expects, so posts can't be published right now. If you changed or uploaded that file recently, put back the version from GitHub, then press Refresh list.`;
  }
  return "Your website could not be read completely, so posts can't be published right now. Press Refresh list to try again.";
}

function siteBlocked() {
  return !!S.client && !S.ctx && !!S.ctxError;
}

function renderSiteProblem() {
  const blocked = siteBlocked();
  const show = blocked && ["list", "editor", "preview"].includes(S.screen);
  $("site-problem").hidden = !show;
  $("new-post").disabled = blocked;
  if (!show) return;
  $("site-problem-text").textContent = siteProblemText(S.ctxError);
  $("site-problem-detail").textContent = safeMessage(S.ctxError);
}

function handleError(err) {
  if (err instanceof GitHubError && err.kind === "auth") { authLost(err.message); return; }
  if (isPlanError(err) && S.screen === "editor" && S.draft) {
    if (err.code === "VALIDATION" && Array.isArray(err.issues) && err.issues.length) {
      S.showAllErrors = true;
      S.validation = { errors: err.issues, warnings: S.validation.warnings };
      renderIssues();
      showFormError();
      return;
    }
    if (err.code === "SLUG_TAKEN") {
      S.showAllErrors = true;
      S.validation = { errors: [{ field: "slug", message: err.message }], warnings: S.validation.warnings };
      renderIssues();
      showFormError();
      return;
    }
  }
  showError(err);
}

function makeClient(key) {
  return createClient({ base: API_BASE, token: key, owner: CONFIG.owner, repo: CONFIG.repo, fetch: window.fetch.bind(window) });
}

// ---------- Sign in and out ----------

async function onSignIn(e) {
  e.preventDefault();
  if (S.busy) return;
  const input = $("key");
  const key = input.value.trim();
  const errBox = $("signin-error");
  errBox.hidden = true;
  $("signin-note").hidden = true;
  $("key-format").hidden = !key || KEY_RE.test(key) || CLASSIC_KEY_RE.test(key);
  if (!key) {
    errBox.textContent = "Paste your access key first.";
    errBox.hidden = false;
    input.focus();
    return;
  }
  if (CLASSIC_KEY_RE.test(key)) {
    errBox.textContent = CLASSIC_KEY_MSG;
    errBox.hidden = false;
    $("key-help").open = true;
    input.focus();
    return;
  }
  const button = $("signin-submit");
  setBusy(true);
  button.textContent = "Signing in...";
  button.disabled = true;
  const client = makeClient(key);
  let repo;
  try {
    repo = await client.getRepo();
    await client.probeWrite();
  } catch (err) {
    setBusy(false);
    button.textContent = "Sign in";
    button.disabled = false;
    errBox.textContent = safeMessage(err);
    errBox.hidden = false;
    return;
  }
  saveKey(key, $("remember").checked);
  input.value = "";
  $("key-format").hidden = true;
  S.client = client;
  S.branch = repo.defaultBranch;
  setBusy(false);
  button.textContent = "Sign in";
  button.disabled = false;
  showScreen("list");
  renderList();
  await loadData();
}

function resetSession() {
  stopLiveCheck();
  clearKey();
  S.client = null;
  S.branch = null;
  S.ctx = null;
  S.ctxError = null;
  S.posts = [];
  S.gaps = [];
  S.listLoaded = false;
  S.action = null;
}

// Returns true when a post was open (its draft is now saved on this computer).
function leaveEditorSaving() {
  if (S.editor) {
    saveDraftNow();
    closeEditor();
    return true;
  }
  return false;
}

function signOut() {
  if (S.busy) return;
  leaveEditorSaving();
  resetSession();
  setBusy(false);
  showScreen("signin");
  $("signin-error").hidden = true;
  $("signin-note").textContent = "You are signed out.";
  $("signin-note").hidden = false;
}

function authLost(message) {
  const hadPost = leaveEditorSaving() || (S.action && S.action.kind === "publish");
  resetSession();
  setBusy(false);
  showScreen("signin");
  const note = $("signin-note");
  note.textContent = "Your post is saved on this computer. After you sign in, find it under Drafts on this computer. If your key has expired, create a new one with the steps below.";
  note.hidden = !hadPost;
  $("signin-error").textContent = message;
  $("signin-error").hidden = false;
}

// ---------- Loading the website data ----------

async function loadData({ background = false } = {}) {
  if (!S.client) return;
  const client = S.client;
  if (!background) {
    setBusy(true);
    $("posts-loading").hidden = false;
  }
  try {
    if (!S.branch) S.branch = (await client.getRepo()).defaultBranch;
    const snap = await client.snapshot(S.branch);
    let ctx = null, ctxError = null;
    try {
      ctx = await loadSiteContext(snap);
    } catch (err) {
      if (err instanceof GitHubError && err.kind !== "unexpected") throw err;
      ctxError = err;
    }
    const posts = [];
    for (const path of snap.list()) {
      const m = POST_PATH_RE.exec(path);
      if (!m) continue;
      try {
        posts.push({ slug: m[1], post: postFromJson(await snap.readText(path)) });
      } catch (err) {
        if (err instanceof GitHubError && err.kind !== "unexpected") throw err;
        posts.push({ slug: m[1], error: true });
      }
    }
    // Posts whose card or lines went missing from the lists (for example after an upload from an older copy).
    let gaps = [];
    if (ctx) {
      try {
        gaps = await findListingGaps(snap, ctx, posts.filter(p => p.post));
      } catch (err) {
        if (err instanceof GitHubError && err.kind !== "unexpected") throw err;
        gaps = [];
      }
    }
    if (S.client !== client) return;
    S.ctx = ctx;
    S.ctxError = ctxError;
    S.posts = posts;
    S.gaps = gaps;
    S.listLoaded = true;
    renderSiteProblem();
    if (S.screen === "list") renderList();
    if (S.editor) refreshEditorChoices();
  } catch (err) {
    if (S.client !== client) return;
    if (!background || (err instanceof GitHubError && err.kind === "auth")) handleError(err);
  } finally {
    if (!background) {
      setBusy(false);
      $("posts-loading").hidden = true;
    }
  }
}

// ---------- Posts list ----------

function topicLabel(topicId) {
  const t = S.ctx && S.ctx.topics ? S.ctx.topics.find(x => x.id === topicId) : null;
  return t ? t.label : topicId || "No topic";
}

function sortedPosts() {
  return S.posts.slice().sort((a, b) => {
    if (a.error || b.error) return a.error === b.error ? a.slug.localeCompare(b.slug) : a.error ? 1 : -1;
    return (b.post.published || "").localeCompare(a.post.published || "") ||
      (b.post.modified || "").localeCompare(a.post.modified || "") ||
      cleanText(a.post.title).localeCompare(cleanText(b.post.title));
  });
}

// A draft of changes to a post that is no longer on the website (deleted here or on another computer).
function isOrphanDraft(rec) {
  if (!rec || rec.mode !== "update" || !S.listLoaded || !S.client) return false;
  const id = rec.post && rec.post.id ? rec.post.id : rec.postId;
  const slug = rec.post && rec.post.slug ? rec.post.slug : rec.slug;
  return !S.posts.some(p => (p.post && p.post.id === id) || (p.error && p.slug === slug));
}

function renderList() {
  renderSiteProblem();
  // Posts missing from the lists
  const gaps = S.ctx ? S.gaps : [];
  $("repair-box").hidden = gaps.length === 0;
  if (gaps.length) {
    $("repair-text").textContent = gaps.length === 1
      ? `"${gaps[0].title}" is missing from the Blog page or from other lists on your website. Put it back?`
      : `${gaps.length} of your posts are missing from the Blog page or from other lists on your website. Put them back?`;
    $("repair-start").textContent = gaps.length === 1 ? "Put it back" : "Put them back";
  }

  // Drafts on this computer
  const index = readDraftIndex().filter(d => readDraft(d.draftId));
  index.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  const dl = $("drafts-list");
  dl.replaceChildren();
  for (const d of index) {
    const title = cleanText(d.title || "") || "Untitled draft";
    const kind = d.mode === "update" ? (isOrphanDraft(d) ? "Changes to a post that was deleted" : "Changes to a published post") : "New post";
    const meta = `${kind} · Saved ${fmtSaved(d.savedAt)}`;
    dl.append(el("li", { dataset: { draft: d.draftId } },
      el("p", { className: "row-title", text: title }),
      el("p", { className: "row-meta", text: meta }),
      el("div", { className: "row-actions" },
        el("button", { type: "button", className: "textbtn", "data-action": "resume", text: "Continue" }),
        el("button", { type: "button", className: "textbtn", "data-action": "discard", text: "Delete draft" }))));
  }
  $("drafts-block").hidden = index.length === 0;

  // Published posts
  const pl = $("posts-list");
  pl.replaceChildren();
  for (const entry of sortedPosts()) {
    if (entry.error) {
      pl.append(el("li", { className: "row-broken", dataset: { slug: entry.slug } },
        el("p", { className: "row-title", text: "This post's saved copy can't be read" }),
        el("p", { className: "row-meta", text: `meritlinetaxservices.com/blog/${entry.slug}.html` })));
      continue;
    }
    const p = entry.post;
    let meta = `${topicLabel(p.topic)} · Published ${fmtLong(p.published)}`;
    if (p.modified && p.modified !== p.published) meta += ` · Updated ${fmtLong(p.modified)}`;
    pl.append(el("li", { dataset: { slug: entry.slug } },
      el("p", { className: "row-title", text: cleanText(p.title) || entry.slug }),
      el("p", { className: "row-meta", text: meta }),
      el("div", { className: "row-actions" },
        el("button", { type: "button", className: "textbtn", "data-action": "edit", text: "Edit" }),
        el("a", { "data-action": "view", href: `../blog/${entry.slug}.html`, target: "_blank", rel: "noopener noreferrer", text: "View on site" }),
        el("button", { type: "button", className: "textbtn", "data-action": "delete", text: "Delete" }))));
  }
  $("posts-empty").hidden = !(S.listLoaded && S.posts.length === 0);

  // Hand-written guides
  const hand = S.ctx && Array.isArray(S.ctx.guideCards) ? S.ctx.guideCards.filter(g => !g.isAdmin) : [];
  const hl = $("hand-guides-list");
  hl.replaceChildren();
  for (const g of hand.slice().sort((a, b) => String(a.title).localeCompare(String(b.title)))) {
    hl.append(el("li", { className: "hand-row" },
      el("span", { text: g.title }),
      el("a", { href: `../blog/${g.file}`, target: "_blank", rel: "noopener noreferrer", text: "View" })));
  }
  $("hand-guides-summary").textContent = `Guides written by hand (${hand.length})`;
  $("hand-guides").hidden = !S.ctx;
}

function inlineConfirm(row, text, yesLabel, noLabel, onYes, yesAction = "confirm-yes", noAction = "confirm-no") {
  const old = row.querySelector(".inline-confirm");
  if (old) old.remove();
  const actions = row.querySelector(".row-actions");
  if (actions) actions.hidden = true;
  const box = el("div", { className: "inline-confirm", role: "group" },
    el("span", { text }),
    el("button", { type: "button", className: "textbtn", "data-action": yesAction, text: yesLabel }),
    el("button", { type: "button", className: "textbtn", "data-action": noAction, text: noLabel }));
  row.append(box);
  box.addEventListener("click", ev => {
    const b = ev.target.closest("button");
    if (!b) return;
    ev.stopPropagation();
    box.remove();
    if (actions) actions.hidden = false;
    if (b.dataset.action === yesAction) onYes(true);
    else if (noAction !== "confirm-no") onYes(false);
  });
  box.querySelector("button").focus();
}

function onDraftsClick(e) {
  const b = e.target.closest("button[data-action]");
  const row = e.target.closest("li[data-draft]");
  if (!b || !row || S.busy) return;
  const id = row.dataset.draft;
  if (b.dataset.action === "resume") resumeDraft(id);
  else if (b.dataset.action === "discard") {
    inlineConfirm(row, "Delete this draft? This can't be undone.", "Yes", "No", () => { deleteDraft(id); renderList(); });
  }
}

function onPostsClick(e) {
  const b = e.target.closest("button[data-action]");
  const row = e.target.closest("li[data-slug]");
  if (!b || !row || S.busy) return;
  const entry = S.posts.find(p => p.slug === row.dataset.slug && p.post);
  if (!entry) return;
  if (b.dataset.action === "edit") editPost(entry, row);
  else if (b.dataset.action === "delete") startDelete(entry, b);
}

// ---------- Opening the editor ----------

function normalizePost(p) {
  const s = v => (typeof v === "string" ? v : "");
  const o = p && typeof p === "object" ? p : {};
  const card = o.card || {}, lead = o.lead || {};
  return {
    schema: 1, id: s(o.id), slug: s(o.slug), title: s(o.title), seoTitle: s(o.seoTitle), description: s(o.description),
    topic: s(o.topic), region: s(o.region),
    card: { category: s(card.category), thumb: s(card.thumb), summary: s(card.summary) },
    lead: { answer: s(lead.answer), text: s(lead.text) },
    keyPoints: Array.isArray(o.keyPoints) ? o.keyPoints.map(k => ({ bold: s(k && k.bold), text: s(k && k.text) })) : [],
    bodyHtml: s(o.bodyHtml),
    faq: Array.isArray(o.faq) ? o.faq.map(f => ({ q: s(f && f.q), a: s(f && f.a) })) : [],
    rulesAsOf: s(o.rulesAsOf), published: s(o.published), modified: s(o.modified),
    images: Array.isArray(o.images) ? o.images.map(i => Object.assign({}, i)) : []
  };
}

function startNewPost() {
  if (S.busy) return;
  const post = newPost(todayIso());
  openEditor({ draftId: post.id, mode: "create", baseModified: "", post }, { fresh: true });
}

function resumeDraft(draftId) {
  let rec = readDraft(draftId);
  if (!rec) { deleteDraft(draftId); renderList(); return; }
  let changedElsewhere = false, deletedPost = false;
  if (isOrphanDraft(rec)) {
    // The post was deleted: these changes can only go out as a new post (with an editable web address).
    const today = todayIso();
    rec = Object.assign({}, rec, { mode: "create", baseModified: "", post: Object.assign({}, rec.post, { published: today, modified: today }) });
    sSet("local", "draft." + rec.draftId, JSON.stringify(rec));
    writeDraftIndex(readDraftIndex().map(d => (d.draftId === rec.draftId ? Object.assign({}, d, { mode: "create" }) : d)));
    deletedPost = true;
  } else if (rec.mode === "update") {
    const published = S.posts.find(p => p.post && p.post.id === rec.post.id);
    changedElsewhere = !!(published && published.post.modified && rec.baseModified && published.post.modified > rec.baseModified);
  }
  openEditor(rec, { changedElsewhere, deletedPost, restored: true });
}

function editPost(entry, row) {
  const pub = entry.post;
  const rec = readDraft(pub.id);
  const fromPublished = () => openEditor({ draftId: pub.id, mode: "update", baseModified: pub.modified, post: pub }, {});
  if (!rec) { fromPublished(); return; }
  inlineConfirm(row, "You have unpublished changes to this post on this computer. Continue with them?",
    "Continue", "Delete my changes and start from the published version",
    useDraft => {
      if (useDraft) {
        openEditor(rec, { changedElsewhere: !!(pub.modified && rec.baseModified && pub.modified > rec.baseModified), restored: true });
      } else {
        deleteDraft(pub.id);
        fromPublished();
      }
    }, "edit-continue", "edit-fresh");
}

function openEditor(rec, { fresh = false, restored = false, changedElsewhere = false, deletedPost = false } = {}) {
  closeEditor();
  const post = normalizePost(rec.post);
  S.draft = { draftId: rec.draftId || post.id, mode: rec.mode === "update" ? "update" : "create", baseModified: rec.baseModified || "", post };
  S.touched = new Set();
  S.showAllErrors = false;
  S.validation = { errors: [], warnings: [] };
  S.dirty = false;
  S.slugEdited = S.draft.mode === "update" || (!!post.slug && post.slug !== slugify(post.title));
  S.categoryOther = false;
  S.formMessages = [];
  S.og = { title: null, png: null, fits: true, url: null };

  const isEdit = S.draft.mode === "update";
  $("editor-h1").textContent = isEdit ? "Edit post" : "New post";
  $("btn-publish").textContent = isEdit ? "Publish changes" : "Publish";
  $("preview-publish").textContent = isEdit ? "Publish changes" : "Publish";
  $("btn-discard").textContent = isEdit ? "Discard changes" : "Delete draft";
  $("discard-confirm-text").textContent = isEdit ? "Discard your changes? This can't be undone." : "Delete this draft? This can't be undone.";
  $("discard-confirm").hidden = true;
  $("btn-discard").hidden = false;
  $("edit-note").hidden = !changedElsewhere;
  $("deleted-note").hidden = !deletedPost;
  $("form-error").hidden = true;
  setPublishWorking(false);
  setEditorMsg("");
  setBodyMsg("", "info");

  fillEditorFields();

  const pending = new Map();
  for (const im of Array.isArray(rec.pendingImages) ? rec.pendingImages : []) {
    const bytes = dataUrlToBytes(im && im.dataUrl);
    if (!bytes || !/^p[0-9a-f]{8}$/.test(String(im.id))) continue;
    pending.set(im.id, { id: im.id, bytes, ext: im.ext, type: im.type, width: im.width, height: im.height, dataUrl: im.dataUrl });
  }
  S.editor = createEditor($("body-editor"), {
    toolbar: $("body-toolbar"),
    getLinkTargets: () => ({
      guides: S.ctx && Array.isArray(S.ctx.guideCards) ? S.ctx.guideCards.filter(g => g.slug !== S.draft.post.slug) : [],
      pages: S.ctx && Array.isArray(S.ctx.sitePages) ? S.ctx.sitePages.map(p => ({ href: p.href, label: p.label })) : []
    }),
    onChange: () => markChanged("body-editor"),
    onMessage: (text, level) => setBodyMsg(text, level),
    limits: {
      maxImageInputBytes: CONFIG.maxImageInputBytes, maxImageBytes: CONFIG.maxImageBytes, maxImageSide: CONFIG.maxImageSide,
      maxPictures: LIMITS && LIMITS.images ? LIMITS.images : 10
    }
  });
  S.editor.setHtml(post.bodyHtml, pending);

  if (restored && rec.savedAt) {
    const d = new Date(rec.savedAt);
    const sameDay = !Number.isNaN(d.getTime()) && d.toDateString() === new Date().toDateString();
    setDraftStatus(sameDay ? `Draft saved at ${hhmm(d)}` : `Draft saved ${fmtSaved(rec.savedAt)}`);
  } else {
    setDraftStatus("");
  }

  showScreen("editor");
  if (!fresh) {
    for (const id of ["f-title", "f-slug", "f-seo-title", "f-description", "f-topic", "f-region", "f-category", "f-thumb",
      "f-summary", "f-lead-answer", "f-lead-text", "body-editor", "f-rules-date", "f-published"]) S.touched.add(id);
    runValidation();
  } else {
    $("f-title").focus();
  }
  renderOg();
}

function closeEditor() {
  clearTimeout(S.saveTimer);
  clearTimeout(S.validateTimer);
  clearTimeout(S.ogTimer);
  for (const kind of ["kp", "faq"]) hideUndo(kind);
  S.ogSeq++;
  if (S.editor) { S.editor.destroy(); S.editor = null; }
  if (S.og.url) URL.revokeObjectURL(S.og.url);
  S.og = { title: null, png: null, fits: true, url: null };
  $("og-preview").hidden = true;
  $("og-preview").removeAttribute("src");
  S.draft = null;
  S.dirty = false;
}

// ---------- Editor fields ----------

const SIMPLE_FIELDS = [
  ["f-title", p => p.title, (p, v) => { p.title = v; }],
  ["f-seo-title", p => p.seoTitle, (p, v) => { p.seoTitle = v; }],
  ["f-description", p => p.description, (p, v) => { p.description = v; }],
  ["f-thumb", p => p.card.thumb, (p, v) => { p.card.thumb = v; }],
  ["f-summary", p => p.card.summary, (p, v) => { p.card.summary = v; }],
  ["f-lead-answer", p => p.lead.answer, (p, v) => { p.lead.answer = v; }],
  ["f-lead-text", p => p.lead.text, (p, v) => { p.lead.text = v; }],
  ["f-rules-date", p => p.rulesAsOf, (p, v) => { p.rulesAsOf = v; }],
  ["f-published", p => p.published, (p, v) => { p.published = v; }]
];

function fillEditorFields() {
  const p = S.draft.post;
  const isEdit = S.draft.mode === "update";
  for (const [id, get] of SIMPLE_FIELDS) $(id).value = get(p);
  const slug = $("f-slug");
  slug.value = p.slug;
  slug.readOnly = isEdit;
  $("f-slug-hint").textContent = isEdit
    ? "The web address of a published post can't change."
    : "Made from the title. Lowercase letters, numbers and dashes only. It can't be changed after publishing.";
  $("published-field").hidden = isEdit;
  $("published-facts").hidden = !isEdit;
  $("fact-published").textContent = fmtLong(p.published);
  $("fact-modified").textContent = fmtLong(p.modified || p.published);
  $("f-published").max = todayIso();
  refreshEditorChoices();
  renderRows("kp");
  renderRows("faq");
  updateCounters();
}

function refreshEditorChoices() {
  if (!S.draft) return;
  const p = S.draft.post;
  // Topics
  const topicSel = $("f-topic");
  topicSel.replaceChildren(el("option", { value: "", text: "Choose a topic" }));
  const topics = S.ctx && Array.isArray(S.ctx.topics) ? S.ctx.topics : [];
  for (const t of topics) topicSel.append(el("option", { value: t.id, text: t.label }));
  if (p.topic && !topics.some(t => t.id === p.topic)) topicSel.append(el("option", { value: p.topic, text: p.topic }));
  topicSel.value = p.topic;
  refreshRegion();
  // Card labels
  const catSel = $("f-category");
  const cats = S.ctx && Array.isArray(S.ctx.categories) ? S.ctx.categories.filter(c => typeof c === "string" && c) : [];
  catSel.replaceChildren(el("option", { value: "", text: "Choose a card label" }));
  for (const c of cats) catSel.append(el("option", { value: c, text: c }));
  catSel.append(el("option", { value: OTHER_CATEGORY, text: "Other..." }));
  const other = $("f-category-other");
  if (!p.card.category) { catSel.value = ""; showOtherCategory(S.categoryOther); }
  else if (cats.includes(p.card.category) && !S.categoryOther) { catSel.value = p.card.category; showOtherCategory(false); }
  else { catSel.value = OTHER_CATEGORY; showOtherCategory(true); other.value = p.card.category; }
  if (S.categoryOther && !p.card.category) { catSel.value = OTHER_CATEGORY; showOtherCategory(true); }
}

// The "Your own card label" box and its visible label appear together.
function showOtherCategory(on) {
  $("f-category-other").hidden = !on;
  $("f-category-other-label").hidden = !on;
}

function refreshRegion() {
  const p = S.draft.post;
  const topic = S.ctx && Array.isArray(S.ctx.topics) ? S.ctx.topics.find(t => t.id === p.topic) : null;
  const regions = topic && Array.isArray(topic.regions) ? topic.regions : [];
  const field = $("region-field");
  const sel = $("f-region");
  if (!regions.length) {
    field.hidden = true;
    sel.replaceChildren(el("option", { value: "", text: "Choose a group of countries" }));
    if (topic && p.region) p.region = "";
    return;
  }
  field.hidden = false;
  sel.replaceChildren(el("option", { value: "", text: "Choose a group of countries" }));
  for (const r of regions) sel.append(el("option", { value: r.label, text: r.label }));
  if (p.region && !regions.some(r => r.label === p.region)) sel.append(el("option", { value: p.region, text: p.region }));
  sel.value = p.region;
}

function updateCounters() {
  if (!S.draft) return;
  const p = S.draft.post;
  const seoLen = cleanText(p.seoTitle || p.title).length + (cleanText(p.seoTitle || p.title) ? SEO_TITLE_SUFFIX.length : 0);
  $("seo-title-count").textContent = `${seoLen} of 60 characters`;
  $("description-count").textContent = plural(cleanText(p.description).length, "character", "characters");
}

// Key points and questions: rows rebuilt from the post data on every structural change.
const ROWSETS = {
  kp: {
    list: "kp-list", add: "kp-add", rowClass: "kp-row", max: () => (LIMITS && LIMITS.keyPoints) || 8, label: "Point",
    items: () => S.draft.post.keyPoints, blank: () => ({ bold: "", text: "" }),
    fields: [
      { key: "bold", name: "kp-bold", idp: "kp-bold-", label: "Bold start (optional)", tag: "input" },
      { key: "text", name: "kp-text", idp: "kp-text-", label: "Point", tag: "input" }
    ]
  },
  faq: {
    list: "faq-list", add: "faq-add", rowClass: "faq-row", max: () => (LIMITS && LIMITS.faq) || 12, label: "Question",
    items: () => S.draft.post.faq, blank: () => ({ q: "", a: "" }),
    fields: [
      { key: "q", name: "faq-q", idp: "faq-q-", label: "Question", tag: "input" },
      { key: "a", name: "faq-a", idp: "faq-a-", label: "Answer", tag: "textarea" }
    ]
  }
};

function renderRows(kind) {
  const def = ROWSETS[kind];
  const items = def.items();
  const list = $(def.list);
  list.replaceChildren();
  items.forEach((item, i) => {
    const row = el("div", { className: def.rowClass, dataset: { index: String(i) } },
      el("p", { className: "row-num", text: `${def.label} ${i + 1}` }));
    for (const f of def.fields) {
      const id = f.idp + i;
      const input = f.tag === "textarea" ? el("textarea", { id, name: f.name, rows: "3" }) : el("input", { id, name: f.name, type: "text", autocomplete: "off" });
      input.value = item[f.key];
      row.append(el("div", { className: "field" },
        el("label", { for: id, text: f.label }),
        input,
        el("p", { className: "field-msg", dataset: { for: id }, hidden: true })));
    }
    row.append(el("div", { className: "row-tools" },
      el("button", { type: "button", className: "textbtn", "data-action": "up", disabled: i === 0, text: "Move up" }),
      el("button", { type: "button", className: "textbtn", "data-action": "down", disabled: i === items.length - 1, text: "Move down" }),
      el("button", { type: "button", className: "textbtn", "data-action": "remove", text: "Remove" })));
    list.append(row);
  });
  $(def.add).disabled = items.length >= def.max();
}

function onRowsInput(kind, e) {
  const def = ROWSETS[kind];
  const row = e.target.closest("[data-index]");
  const f = def.fields.find(x => x.name === e.target.name);
  if (!row || !f) return;
  const item = def.items()[Number(row.dataset.index)];
  if (!item) return;
  item[f.key] = e.target.value;
  markChanged(e.target.id);
}

function onRowsClick(kind, e) {
  const b = e.target.closest("button[data-action]");
  const row = e.target.closest("[data-index]");
  if (!b || !row) return;
  const def = ROWSETS[kind];
  const items = def.items();
  const i = Number(row.dataset.index);
  let focusIndex = i;
  if (b.dataset.action === "up" && i > 0) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; focusIndex = i - 1; }
  else if (b.dataset.action === "down" && i < items.length - 1) { [items[i + 1], items[i]] = [items[i], items[i + 1]]; focusIndex = i + 1; }
  else if (b.dataset.action === "remove") {
    const [removed] = items.splice(i, 1);
    focusIndex = Math.min(i, items.length - 1);
    offerUndo(kind, removed, i);
  }
  else return;
  renderRows(kind);
  const target = focusIndex >= 0 ? $(def.list).querySelector(`[data-index="${focusIndex}"] button[data-action="${b.dataset.action === "remove" ? "remove" : b.dataset.action}"]`) : null;
  if (target && !target.disabled) target.focus(); else $(def.add).focus();
  markChanged(def.list);
}

// A removed key point or question can be put back for a short while.
const UNDO_MS = 10000;
function offerUndo(kind, item, index) {
  hideUndo(kind);
  const box = $(`${kind}-undo`);
  const u = { item, index, timer: setTimeout(() => hideUndo(kind), UNDO_MS) };
  S.undo[kind] = u;
  box.querySelector("span").textContent = kind === "kp" ? "Key point removed." : "Question removed.";
  box.hidden = false;
}
function hideUndo(kind) {
  const u = S.undo[kind];
  if (u) clearTimeout(u.timer);
  S.undo[kind] = null;
  const box = $(`${kind}-undo`);
  if (box) box.hidden = true;
}
function undoRemove(kind) {
  const u = S.undo[kind];
  if (!u || !S.draft) return;
  const def = ROWSETS[kind];
  const items = def.items();
  hideUndo(kind);
  if (items.length >= def.max()) return;
  const at = Math.min(u.index, items.length);
  items.splice(at, 0, u.item);
  renderRows(kind);
  const first = $(def.list).querySelector(`[data-index="${at}"] input, [data-index="${at}"] textarea`);
  if (first) first.focus();
  markChanged(def.list);
}

function addRow(kind) {
  const def = ROWSETS[kind];
  const items = def.items();
  if (items.length >= def.max()) return;
  items.push(def.blank());
  renderRows(kind);
  const first = $(def.list).querySelector(`[data-index="${items.length - 1}"] input, [data-index="${items.length - 1}"] textarea`);
  if (first) first.focus();
  markChanged(def.list);
}

function onFieldInput(e) {
  if (!S.draft) return;
  const t = e.target;
  const p = S.draft.post;
  const simple = SIMPLE_FIELDS.find(([id]) => id === t.id);
  if (simple) {
    simple[2](p, t.value);
    if (t.id === "f-title") {
      if (S.draft.mode === "create" && !S.slugEdited) {
        p.slug = slugify(p.title);
        $("f-slug").value = p.slug;
      }
      scheduleOg();
    }
    updateCounters();
    markChanged(t.id);
    return;
  }
  if (t.id === "f-slug") {
    if (S.draft.mode === "update") return;
    const cleaned = t.value.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-{2,}/g, "-").slice(0, 80);
    if (cleaned !== t.value) t.value = cleaned;
    // An emptied field goes back to following the title (filled in again when the field is left).
    S.slugEdited = cleaned !== "";
    p.slug = cleaned || slugify(p.title);
    markChanged("f-slug");
    return;
  }
  if (t.id === "f-topic") {
    p.topic = t.value;
    refreshRegion();
    markChanged("f-topic");
    return;
  }
  if (t.id === "f-region") {
    p.region = t.value;
    markChanged("f-region");
    return;
  }
  if (t.id === "f-category") {
    const other = $("f-category-other");
    if (t.value === OTHER_CATEGORY) {
      // The empty box is not marked as a problem until the owner leaves it (see the focusout handler).
      S.categoryOther = true;
      showOtherCategory(true);
      p.card.category = other.value;
      other.focus();
      markChanged(null);
    } else {
      S.categoryOther = false;
      showOtherCategory(false);
      p.card.category = t.value;
      markChanged("f-category");
    }
    return;
  }
  if (t.id === "f-category-other") {
    p.card.category = t.value;
    markChanged(t.value.trim() ? "f-category" : null);
  }
}

function collectPost() {
  const p = S.draft.post;
  return {
    schema: 1, id: p.id, slug: p.slug, title: p.title, seoTitle: p.seoTitle, description: p.description,
    topic: p.topic, region: p.region,
    card: { category: p.card.category, thumb: p.card.thumb, summary: p.card.summary },
    lead: { answer: p.lead.answer, text: p.lead.text },
    keyPoints: p.keyPoints.map(k => ({ bold: k.bold, text: k.text })),
    bodyHtml: S.editor ? S.editor.getHtml() : p.bodyHtml,
    faq: p.faq.map(f => ({ q: f.q, a: f.a })),
    rulesAsOf: p.rulesAsOf, published: p.published, modified: p.modified,
    images: p.images.map(i => Object.assign({}, i))
  };
}

// ---------- Changes, drafts and validation ----------

function markChanged(fieldId) {
  if (!S.draft) return;
  if (fieldId) S.touched.add(fieldId);
  S.dirty = true;
  setDraftStatus("Saving draft...");
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(saveDraftNow, 800);
  clearTimeout(S.validateTimer);
  S.validateTimer = setTimeout(runValidation, 300);
  setEditorMsg("");
}

function setDraftStatus(text, level) {
  const s = $("draft-status");
  s.textContent = text;
  s.classList.toggle("is-warning", level === "warn");
}

function saveDraftNow() {
  clearTimeout(S.saveTimer);
  if (!S.draft || !S.editor || !S.dirty) return;
  const post = collectPost();
  S.draft.post.bodyHtml = post.bodyHtml;
  const pendingImages = [...S.editor.getPendingImages().values()]
    .map(({ id, ext, type, width, height, dataUrl }) => ({ id, ext, type, width, height, dataUrl }));
  const savedAt = new Date().toISOString();
  const rec = { draftId: S.draft.draftId, mode: S.draft.mode, baseModified: S.draft.baseModified, post, pendingImages, savedAt };
  let ok = sSet("local", "draft." + rec.draftId, JSON.stringify(rec));
  let warn = null;
  if (!ok && pendingImages.length) {
    rec.pendingImages = [];
    ok = sSet("local", "draft." + rec.draftId, JSON.stringify(rec));
    if (ok) warn = "Draft saved without pictures. This browser has no room for them.";
  }
  if (ok) {
    const entry = { draftId: rec.draftId, postId: post.id, slug: post.slug, title: post.title, mode: rec.mode, savedAt };
    const index = readDraftIndex().filter(d => d.draftId !== rec.draftId);
    index.push(entry);
    ok = writeDraftIndex(index);
  }
  if (!ok) { setDraftStatus("This browser could not save the draft.", "warn"); return; }
  S.dirty = false;
  if (warn) setDraftStatus(warn, "warn");
  else setDraftStatus(`Draft saved at ${hhmm(new Date())}`);
}

const FIELD_IDS = {
  title: "f-title", slug: "f-slug", seoTitle: "f-seo-title", description: "f-description", topic: "f-topic", region: "f-region",
  "card.category": "f-category", "card.thumb": "f-thumb", "card.summary": "f-summary", "lead.answer": "f-lead-answer",
  "lead.text": "f-lead-text", bodyHtml: "body-editor", rulesAsOf: "f-rules-date", published: "f-published",
  keyPoints: "kp-list", faq: "faq-list", form: "form-error"
};

function inputIdFor(field) {
  if (FIELD_IDS[field]) return FIELD_IDS[field];
  let m = /^keyPoints\[(\d+)\]\.(bold|text)$/.exec(field);
  if (m) return `kp-${m[2]}-${m[1]}`;
  m = /^faq\[(\d+)\]\.(q|a)$/.exec(field);
  if (m) return `faq-${m[2]}-${m[1]}`;
  m = /^keyPoints\[(\d+)\]/.exec(field);
  if (m) return `kp-text-${m[1]}`;
  m = /^faq\[(\d+)\]/.exec(field);
  if (m) return `faq-q-${m[1]}`;
  return "form-error";
}

function runValidation() {
  clearTimeout(S.validateTimer);
  if (!S.draft) return { errors: [], warnings: [] };
  const post = collectPost();
  let res;
  try {
    res = validatePost(post, S.ctx || null, { mode: S.draft.mode, today: todayIso() }) || {};
  } catch {
    res = {};
  }
  let errors = Array.isArray(res.errors) ? res.errors.slice() : [];
  const warnings = Array.isArray(res.warnings) ? res.warnings.slice() : [];
  // The web address is made from the title: while both are empty, "Add a title." says all there is to say.
  if (S.draft.mode === "create" && !S.slugEdited && !cleanText(post.title) && !post.slug) errors = errors.filter(e => e.field !== "slug");
  if (S.og.fits === false && cleanText(post.title) && S.og.title === S.draft.post.title) {
    warnings.push({ field: "title", message: "This title is too long for the share picture. Shorten it so it fits." });
  }
  S.validation = { errors, warnings };
  renderIssues();
  return S.validation;
}

// The inputs a field message belongs to (the card label has a list and an "Other" box).
function msgTargets(id) {
  const ids = id === "f-category" ? ["f-category", "f-category-other"] : [id];
  return ids.map(x => $(x)).filter(e => e && e.matches("input,select,textarea,[contenteditable]"));
}

function setDescribedBy(input, msgId, on) {
  const ids = (input.getAttribute("aria-describedby") || "").split(/\s+/).filter(x => x && x !== msgId);
  if (on) ids.unshift(msgId);
  if (ids.length) input.setAttribute("aria-describedby", ids.join(" "));
  else input.removeAttribute("aria-describedby");
}

function renderIssues() {
  const screen = $("screen-editor");
  for (const m of screen.querySelectorAll(".field-msg[data-for]")) {
    m.hidden = true;
    m.textContent = "";
    m.classList.remove("is-error", "is-warning");
    if (!m.id) m.id = `${m.dataset.for}-msg`;
    for (const input of msgTargets(m.dataset.for)) setDescribedBy(input, m.id, false);
  }
  for (const inp of screen.querySelectorAll("[aria-invalid]")) inp.removeAttribute("aria-invalid");
  const byId = new Map();
  const add = (issue, level) => {
    const id = inputIdFor(issue.field);
    if (!S.showAllErrors && !S.touched.has(id) && !(id.startsWith("kp-") || id.startsWith("faq-"))) return;
    if (!S.showAllErrors && (id.startsWith("kp-") || id.startsWith("faq-")) && !S.touched.has(id)) return;
    const cur = byId.get(id) || { level, messages: [] };
    if (level === "error") cur.level = "error";
    if (!cur.messages.includes(issue.message)) cur.messages.push(issue.message);
    byId.set(id, cur);
  };
  for (const e of S.validation.errors) add(e, "error");
  for (const w of S.validation.warnings) add(w, "warn");
  const formMessages = [];
  for (const [id, info] of byId) {
    if (id === "form-error") { formMessages.push(...info.messages); continue; }
    const msg = screen.querySelector(`.field-msg[data-for="${id}"]`);
    if (!msg) { if (info.level === "error") formMessages.push(...info.messages); continue; }
    msg.textContent = info.messages.join(" ");
    msg.classList.add(info.level === "error" ? "is-error" : "is-warning");
    msg.hidden = false;
    for (const input of msgTargets(id)) {
      setDescribedBy(input, msg.id, true);
      if (info.level === "error") input.setAttribute("aria-invalid", "true");
    }
  }
  S.formMessages = formMessages;
  if (!$("form-error").hidden) showFormError();
}

function showFormError() {
  const box = $("form-error");
  const marked = new Set(S.validation.errors.map(e => inputIdFor(e.field))
    .filter(id => id !== "form-error" && $("screen-editor").querySelector(`.field-msg[data-for="${id}"]`)));
  const n = marked.size;
  const text = n === 0 ? "Fix this before publishing:" : n === 1 ? "Fix the item marked in red above before publishing."
    : `Fix the ${n} items marked in red above before publishing.`;
  box.replaceChildren(el("p", { id: "form-error-text", text }));
  for (const m of S.formMessages || []) box.append(el("p", { text: m }));
  if (!S.validation.errors.length) { box.hidden = true; return; }
  box.hidden = false;
}

function focusFirstError() {
  const first = $("screen-editor").querySelector(".field-msg.is-error:not([hidden])");
  if (!first) { $("form-error").scrollIntoView({ block: "center" }); return; }
  const target = $(first.dataset.for);
  if (target && typeof target.focus === "function" && target.id !== "form-error") {
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center" });
  } else {
    first.scrollIntoView({ block: "center" });
  }
}

// Messages in the sticky action bar, so they are seen wherever the owner is in the form.
function setEditorMsg(text) {
  const m = $("editor-msg");
  m.textContent = text;
  m.hidden = !text;
  $("draft-status").hidden = !!text;
}

function publishLabel() {
  return S.draft && S.draft.mode === "update" ? "Publish changes" : "Publish";
}

// While the website is being checked, both Publish buttons say so and are marked busy.
function setPublishWorking(on) {
  for (const id of ["btn-publish", "preview-publish"]) {
    const b = $(id);
    b.textContent = on ? "Checking..." : publishLabel();
    if (on) b.setAttribute("aria-disabled", "true");
    else b.removeAttribute("aria-disabled");
  }
}

function setBodyMsg(text, level) {
  const m = $("body-msg");
  clearTimeout(S.bodyMsgTimer);
  m.classList.remove("is-error", "is-warning", "is-info");
  if (!text) { m.hidden = true; m.textContent = ""; return; }
  m.textContent = text;
  m.classList.add(level === "error" ? "is-error" : level === "warn" ? "is-warning" : "is-info");
  m.hidden = false;
  if (level !== "error") S.bodyMsgTimer = setTimeout(() => { m.hidden = true; }, 8000);
}

// ---------- Share picture ----------

function scheduleOg() {
  clearTimeout(S.ogTimer);
  S.ogTimer = setTimeout(renderOg, 600);
}

async function renderOg() {
  if (!S.draft) return;
  const title = S.draft.post.title;
  const seq = ++S.ogSeq;
  const img = $("og-preview"), empty = $("og-empty"), warning = $("og-warning");
  if (!cleanText(title)) {
    if (S.og.url) URL.revokeObjectURL(S.og.url);
    S.og = { title, png: null, fits: true, url: null };
    img.hidden = true;
    empty.textContent = "The share picture appears here when the post has a title.";
    empty.hidden = false;
    warning.hidden = true;
    return;
  }
  try {
    const res = await renderShareImage(typesetText(title), OG_SOURCES);
    if (seq !== S.ogSeq || !S.draft) return;
    if (S.og.url) URL.revokeObjectURL(S.og.url);
    const url = URL.createObjectURL(new Blob([res.png], { type: "image/png" }));
    S.og = { title, png: res.png, fits: res.fits !== false, url };
    img.src = url;
    img.hidden = false;
    empty.hidden = true;
    warning.hidden = res.fits !== false;
    runValidation();
  } catch (err) {
    if (seq !== S.ogSeq || !S.draft) return;
    S.og = { title: null, png: null, fits: true, url: S.og.url };
    img.hidden = true;
    empty.textContent = err && err.message ? err.message : "The share picture could not be made in this browser.";
    empty.hidden = false;
  }
}

async function sharePngFor(post) {
  if (S.og.png && S.og.title === post.title) return S.og.png;
  try {
    const res = await renderShareImage(typesetText(post.title), OG_SOURCES);
    return res.png;
  } catch (err) {
    throw ownerError(err && err.message ? err.message : "The share picture could not be made in this browser.");
  }
}

// ---------- Preview ----------

function previewHtml(html) {
  // Scripts are removed: the preview frame runs none anyway, and this keeps the console quiet.
  let out = html.replace(/<script\b(?![^>]*type="application\/ld\+json")[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<head>/i, '<head><base target="_blank">');
  return out;
}

function openPreview() {
  if (!S.draft || S.busy) return;
  if (!S.ctx) {
    if (siteBlocked()) { renderSiteProblem(); $("site-problem").scrollIntoView({ block: "nearest" }); return; }
    showError("The website could not be read yet. Go back to your posts and press Refresh list.");
    return;
  }
  showScreen("preview");
  renderPreview();
}

function renderPreview() {
  if (!S.draft || !S.ctx) return;
  const post = collectPost();
  const pending = S.editor ? S.editor.getPendingImages() : new Map();
  $("preview-note").hidden = S.ctx.topics.some(t => t.id === post.topic);
  try {
    const built = buildPostPage(post, S.ctx, { preview: { imageSrc: id => (pending.get(id) ? pending.get(id).dataUrl : "") } });
    $("preview-frame").srcdoc = previewHtml(built.html);
  } catch (err) {
    showError(err);
  }
}

function setPreviewWidth(width) {
  for (const b of $("preview-width").querySelectorAll("button[data-width]")) b.setAttribute("aria-pressed", b.dataset.width === width ? "true" : "false");
  $("preview-stage").classList.toggle("is-phone", width === "phone");
}

// ---------- Publish ----------

async function startPublish() {
  if (!S.draft || S.busy) return;
  hideError();
  setEditorMsg("");
  if (S.screen !== "editor") showScreen("editor");
  const mode = S.draft.mode;
  const today = todayIso();
  S.showAllErrors = true;
  // When the website could not be used at the last reading (see the notice at the top), the form can't be
  // checked against it (there are no topics to choose), so the website is read again first and its own
  // problem is reported, or the post goes through if the website has been fixed meanwhile.
  if (!siteBlocked()) {
    const res = runValidation();
    if (res.errors.length) {
      showFormError();
      focusFirstError();
      return;
    }
  }
  $("form-error").hidden = true;
  if (!S.client) { authLost("Sign in again to publish."); return; }
  saveDraftNow();
  const post = collectPost();
  setBusy(true);
  setPublishWorking(true);
  setEditorMsg("Checking the website...");
  try {
    if (!S.branch) S.branch = (await S.client.getRepo()).defaultBranch;
    const snap = await S.client.snapshot(S.branch);
    const pending = S.editor.getPendingImages();
    const images = new Map();
    for (const [id, im] of pending) images.set(id, { bytes: im.bytes, ext: im.ext, width: im.width, height: im.height });
    let needs = true;
    try {
      const prevPath = `admin/posts/${post.slug}.json`;
      const prev = snap.has(prevPath) ? postFromJson(await snap.readText(prevPath)) : null;
      needs = needsShareImage(post, prev, snap);
    } catch { needs = true; }
    let ogPng = null;
    try {
      ogPng = await sharePngFor(post);
    } catch (err) {
      if (needs) throw err;
    }
    const assets = { ogPng, images };
    const plan = await planCommit({ mode, post, today, snapshot: snap, assets });
    setEditorMsg("");
    if (!plan.changes || !plan.changes.length) {
      setEditorMsg("Nothing has changed since this post was last published, so there is nothing to publish.");
      return;
    }
    S.action = { kind: "publish", mode, post, today, assets, plan, draftId: S.draft.draftId };
    renderConfirm(plan, assets);
    showScreen("confirm");
  } catch (err) {
    setEditorMsg("");
    handleError(err);
  } finally {
    if (S.draft) setPublishWorking(false);
    setBusy(false);
  }
}

function renderNotes(box, notes) {
  box.replaceChildren(...(Array.isArray(notes) ? notes : []).map(n => el("p", { text: n })));
  box.hidden = !box.childElementCount;
}

function renderConfirm(plan, assets) {
  const repair = plan.mode === "repair";
  $("confirm-h1").textContent = repair ? "Put your posts back on the lists?" : plan.mode === "update" ? "Publish these changes?" : "Ready to publish?";
  $("confirm-title").textContent = repair
    ? ((plan.summary || []).length === 1 ? "One post" : `${(plan.summary || []).length} posts`)
    : cleanText(plan.post ? plan.post.title : S.action.post.title);
  $("confirm-publish").textContent = repair ? "Put them back now" : "Publish now";
  $("confirm-cancel").textContent = S.editor ? "Back to editing" : "Cancel";
  const list = $("confirm-list");
  list.replaceChildren();
  for (const item of plan.summary || []) list.append(el("li", { dataset: { kind: item.kind }, text: item.label }));
  renderNotes($("confirm-notes"), plan.notes);
  if (S.confirmOgUrl) { URL.revokeObjectURL(S.confirmOgUrl); S.confirmOgUrl = null; }
  const ogItem = (plan.summary || []).find(i => i.kind === "share-image" && i.action !== "remove");
  if (ogItem && assets && assets.ogPng) {
    S.confirmOgUrl = URL.createObjectURL(new Blob([assets.ogPng], { type: "image/png" }));
    $("confirm-og").src = S.confirmOgUrl;
    $("confirm-og-box").hidden = false;
  } else {
    $("confirm-og").removeAttribute("src");
    $("confirm-og-box").hidden = true;
  }
}

const WORKING_TEXT = {
  reading: "Reading the website...",
  preparing: "Preparing your post...",
  uploading: "Uploading files...",
  saving: "Publishing...",
  retrying: "The website was changed at the same time. Trying again..."
};

async function runCommit() {
  const act = S.action;
  if (!act || S.busy || !S.client) return;
  const isDelete = act.kind === "delete";
  const isRepair = act.kind === "repair";
  showScreen("working");
  $("working-h1").textContent = isDelete ? "Deleting..." : isRepair ? "Putting your posts back..." : "Publishing...";
  const status = $("working-status");
  status.textContent = WORKING_TEXT.reading;
  setBusy(true);
  let retrying = false;
  try {
    const out = await S.client.commit({
      branch: S.branch,
      prepare: snap => (isRepair
        ? planRepair({ slugs: act.slugs, today: act.today, snapshot: snap, assets: act.assets })
        : planCommit({ mode: act.mode, post: act.post, today: act.today, snapshot: snap, assets: act.assets })),
      onStatus: s => {
        if (s === "retrying") retrying = true;
        if (retrying && s !== "saving") status.textContent = WORKING_TEXT.retrying;
        else status.textContent = WORKING_TEXT[s] || status.textContent;
      }
    });
    setBusy(false);
    const plan = out.result && out.result.changes ? out.result : act.plan;
    if (isRepair) {
      if (out.commitSha) S.gaps = [];
      showResult(act, plan, out.commitSha);
      S.action = null;
      loadData({ background: true });
      return;
    }
    if (out.commitSha) {
      // After a publish the draft is done; after a delete, unpublished changes to that post can't go anywhere.
      if (isDelete) deleteDraft(act.post.id);
      else {
        deleteDraft(act.draftId);
        closeEditor();
      }
    }
    // Keep the list right until the background reload below finishes.
    if (out.commitSha) {
      const slug = act.post.slug;
      S.posts = S.posts.filter(p => p.slug !== slug);
      if (!isDelete && plan && plan.post) S.posts.push({ slug: plan.post.slug, post: plan.post });
    }
    showResult(act, plan, out.commitSha);
    S.action = null;
    loadData({ background: true });
  } catch (err) {
    setBusy(false);
    if (isDelete || isRepair) { showScreen("list"); renderList(); }
    else if (S.editor) { showScreen("editor"); }
    else { showScreen("list"); renderList(); }
    handleError(err);
  }
}

function showResult(act, plan, commitSha) {
  const isDelete = act.kind === "delete";
  if (act.kind === "repair") {
    showScreen("result");
    $("result-url-line").hidden = true;
    setLive("", false);
    $("result-h1").textContent = commitSha === null ? "Nothing to put back" : "Done";
    $("result-text").textContent = commitSha === null
      ? "Your posts are already on every list, so nothing was changed."
      : "Your posts are back on the Blog page and the other lists. It may take a minute or two to show on the website.";
    return;
  }
  const slug = plan && plan.pagePath ? plan.pagePath.replace(/^blog\//, "").replace(/\.html$/, "") : act.post.slug;
  showScreen("result");
  const link = $("result-url");
  link.textContent = plan && plan.pageUrl ? plan.pageUrl : `${CONFIG.siteUrl}/blog/${slug}.html`;
  link.href = `../blog/${slug}.html`;
  $("result-url-line").hidden = isDelete;
  setLive("", false);
  if (commitSha === null) {
    $("result-h1").textContent = "Nothing to publish";
    $("result-text").textContent = "Nothing changed, so nothing was published.";
    return;
  }
  $("result-h1").textContent = isDelete ? "Deleted" : plan && plan.mode === "update" ? "Changes published" : "Published";
  $("result-text").textContent = isDelete
    ? "The post is deleted. It may take a minute or two to disappear from the website."
    : "Your post is published. It may take a minute or two to appear on the website.";
  startLiveCheck({ slug, expected: isDelete ? null : plan.expectedPage, isDelete });
}

function setLive(text, isLive) {
  const s = $("live-status");
  s.replaceChildren();
  s.classList.toggle("is-live", !!isLive);
  if (!text) return;
  if (isLive) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 12 12");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", "6");
    c.setAttribute("cy", "6");
    c.setAttribute("r", "6");
    c.setAttribute("fill", "currentColor");
    svg.append(c);
    s.append(svg);
  }
  s.append(document.createTextNode(text));
}

function startLiveCheck({ slug, expected, isDelete }) {
  stopLiveCheck();
  const started = Date.now();
  const interval = LOCAL_API ? CONFIG.livePollLocalMs : CONFIG.livePollMs;
  const norm = t => String(t).replace(/\r\n/g, "\n");
  const want = expected != null ? norm(expected) : null;
  const token = { timer: null };
  S.live = token;
  setLive("Checking the website...", false);
  const tick = async () => {
    if (S.live !== token) return;
    let done = false;
    try {
      const res = await fetch(`../blog/${slug}.html?check=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
      if (isDelete) done = res.status === 404;
      else if (res.status === 200) done = want !== null && norm(await res.text()) === want;
    } catch { /* not reachable yet; keep checking */ }
    if (S.live !== token) return;
    if (done) {
      setLive(isDelete ? "Removed from the website" : "Live now", true);
      S.live = null;
      return;
    }
    const elapsed = Date.now() - started;
    if (elapsed >= CONFIG.liveTimeoutMs) {
      setLive(isDelete
        ? "The website still shows the post. It should disappear soon."
        : "The website has not shown the change yet. It should appear soon. Your post is saved.", false);
      S.live = null;
      return;
    }
    if (elapsed >= 180000) setLive("Still updating. GitHub can take up to 10 minutes.", false);
    token.timer = setTimeout(tick, interval);
  };
  token.timer = setTimeout(tick, interval);
}

function stopLiveCheck() {
  if (S.live) clearTimeout(S.live.timer);
  S.live = null;
}

// ---------- Delete ----------

async function startDelete(entry, button) {
  if (S.busy || !S.client) return;
  hideError();
  setBusy(true);
  const label = button ? button.textContent : "";
  if (button) button.textContent = "Preparing...";
  try {
    if (!S.branch) S.branch = (await S.client.getRepo()).defaultBranch;
    const snap = await S.client.snapshot(S.branch);
    const today = todayIso();
    const plan = await planCommit({ mode: "delete", post: entry.post, today, snapshot: snap, assets: {} });
    S.action = { kind: "delete", mode: "delete", post: entry.post, today, assets: {}, plan };
    $("delete-title").textContent = cleanText(entry.post.title);
    const list = $("delete-list");
    list.replaceChildren();
    for (const item of plan.summary || []) list.append(el("li", { dataset: { kind: item.kind }, text: item.label }));
    let inbound = [];
    try { inbound = findInboundLinks(entry.slug, S.posts.filter(p => p.post).map(p => p.post)) || []; } catch { inbound = []; }
    const links = $("delete-links-list");
    links.replaceChildren();
    for (const l of inbound) links.append(el("li", { text: cleanText(l.title) || l.slug }));
    $("delete-links").hidden = inbound.length === 0;
    renderNotes($("delete-notes"), plan.notes);
    $("delete-draft-note").hidden = !readDraft(entry.post.id);
    const input = $("delete-confirm-input");
    input.value = "";
    $("delete-submit").disabled = true;
    showScreen("delete");
  } catch (err) {
    handleError(err);
  } finally {
    if (button) button.textContent = label;
    setBusy(false);
  }
}

// ---------- Putting posts back on the lists ----------

async function startRepair() {
  if (S.busy || !S.client || !S.gaps.length) return;
  hideError();
  setBusy(true);
  const button = $("repair-start");
  const label = button.textContent;
  button.textContent = "Preparing...";
  try {
    if (!S.branch) S.branch = (await S.client.getRepo()).defaultBranch;
    const snap = await S.client.snapshot(S.branch);
    const today = todayIso();
    const slugs = S.gaps.map(g => g.slug);
    // A share picture is made only for a post whose picture is missing too.
    const ogPngs = new Map();
    for (const slug of slugs) {
      const path = `admin/posts/${slug}.json`;
      if (!snap.has(path) || snap.has(`images/og-${slug}.png`)) continue;
      const post = postFromJson(await snap.readText(path));
      ogPngs.set(slug, await sharePngFor(post));
    }
    const assets = { ogPngs };
    const plan = await planRepair({ slugs, today, snapshot: snap, assets });
    if (!plan.changes.length) {
      S.gaps = [];
      renderList();
      return;
    }
    S.action = { kind: "repair", mode: "repair", slugs, today, assets, plan, post: null };
    renderConfirm(plan, {});
    showScreen("confirm");
  } catch (err) {
    handleError(err);
  } finally {
    button.textContent = label;
    setBusy(false);
  }
}

// ---------- Wiring ----------

function backToList() {
  if (S.editor) leaveEditorSaving();
  showScreen("list");
  renderList();
}

// Keeps a field "untouched" while its message would only be noise; the "Other" box counts for the card label.
function touchIdFor(t) {
  if (t.id === "f-category-other") return "f-category";
  if (t.id === "f-category" && t.value === OTHER_CATEGORY) return null;
  return t.id;
}

function wire() {
  $("signin-form").addEventListener("submit", onSignIn);
  $("key").addEventListener("input", () => { $("signin-error").hidden = true; });
  $("sign-out").addEventListener("click", signOut);
  $("app-error-dismiss").addEventListener("click", hideError);
  $("key-help-link").href = CONFIG.keyHelpUrl;

  $("new-post").addEventListener("click", startNewPost);
  $("refresh").addEventListener("click", () => { if (!S.busy) { hideError(); loadData(); } });
  $("drafts-list").addEventListener("click", onDraftsClick);
  $("posts-list").addEventListener("click", onPostsClick);

  const editorScreen = $("screen-editor");
  editorScreen.addEventListener("input", e => {
    const t = e.target;
    if (!t || !t.id) return;
    if (t.closest("#kp-list")) onRowsInput("kp", e);
    else if (t.closest("#faq-list")) onRowsInput("faq", e);
    else if (t.id !== "body-editor" && t.id !== "image-input") onFieldInput(e);
  });
  editorScreen.addEventListener("change", e => {
    const t = e.target;
    if (t && (t.tagName === "SELECT" || t.type === "date")) onFieldInput(e);
  });
  editorScreen.addEventListener("focusout", e => {
    const t = e.target;
    if (t && t.id === "f-slug" && S.draft && S.draft.mode === "create" && !t.value) t.value = S.draft.post.slug;
    const id = t && t.id ? touchIdFor(t) : null;
    if (id && S.draft && !S.touched.has(id) && (t.matches("input,select,textarea") || t.id === "body-editor")) {
      S.touched.add(id);
      runValidation();
    }
  });
  $("kp-list").addEventListener("click", e => onRowsClick("kp", e));
  $("faq-list").addEventListener("click", e => onRowsClick("faq", e));
  $("kp-add").addEventListener("click", () => addRow("kp"));
  $("faq-add").addEventListener("click", () => addRow("faq"));
  $("kp-undo").addEventListener("click", e => { if (e.target.closest("button")) undoRemove("kp"); });
  $("faq-undo").addEventListener("click", e => { if (e.target.closest("button")) undoRemove("faq"); });

  $("btn-preview").addEventListener("click", openPreview);
  $("btn-publish").addEventListener("click", startPublish);
  $("btn-back").addEventListener("click", () => { if (!S.busy) backToList(); });
  $("btn-back-top").addEventListener("click", () => { if (!S.busy) backToList(); });
  $("repair-start").addEventListener("click", startRepair);
  $("btn-discard").addEventListener("click", () => {
    $("btn-discard").hidden = true;
    $("discard-confirm").hidden = false;
    $("discard-no").focus();
  });
  $("discard-no").addEventListener("click", () => {
    $("discard-confirm").hidden = true;
    $("btn-discard").hidden = false;
    $("btn-discard").focus();
  });
  $("discard-yes").addEventListener("click", () => {
    if (!S.draft || S.busy) return;
    deleteDraft(S.draft.draftId);
    S.dirty = false;
    closeEditor();
    showScreen("list");
    renderList();
  });

  $("preview-close").addEventListener("click", () => showScreen("editor"));
  $("preview-publish").addEventListener("click", startPublish);
  $("preview-width").addEventListener("click", e => {
    const b = e.target.closest("button[data-width]");
    if (b) setPreviewWidth(b.dataset.width);
  });
  window.addEventListener("focus", () => { if (S.screen === "preview") renderPreview(); });

  $("confirm-publish").addEventListener("click", runCommit);
  $("confirm-cancel").addEventListener("click", () => { S.action = null; showScreen(S.editor ? "editor" : "list"); if (!S.editor) renderList(); });

  $("result-done").addEventListener("click", () => { showScreen("list"); renderList(); });

  $("delete-confirm-input").addEventListener("input", e => {
    $("delete-submit").disabled = e.target.value.trim().toUpperCase() !== "DELETE";
  });
  $("delete-confirm-input").addEventListener("keydown", e => {
    if (e.key === "Enter" && !$("delete-submit").disabled) { e.preventDefault(); runCommit(); }
  });
  $("delete-submit").addEventListener("click", () => { if (!$("delete-submit").disabled) runCommit(); });
  $("delete-cancel").addEventListener("click", () => { S.action = null; showScreen("list"); renderList(); });

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveDraftNow(); });
  window.addEventListener("pagehide", saveDraftNow);

  // A file dropped outside the article area must not replace the admin page.
  const hasFiles = e => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
  window.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", e => { if (hasFiles(e)) e.preventDefault(); });
}

async function start() {
  wire();
  const key = loadKey();
  if (!key) {
    showScreen("signin");
    if (keyExpired) {
      $("signin-note").textContent = `For your safety, this computer forgot the access key after ${CONFIG.rememberDays || 30} days without use. Paste it again to sign in.`;
      $("signin-note").hidden = false;
    }
    return;
  }
  S.client = makeClient(key);
  showScreen("list");
  renderList();
  setBusy(true);
  $("posts-loading").hidden = false;
  try {
    const repo = await S.client.getRepo();
    S.branch = repo.defaultBranch;
  } catch (err) {
    setBusy(false);
    $("posts-loading").hidden = true;
    handleError(err);
    return;
  }
  setBusy(false);
  await loadData();
}

start();
