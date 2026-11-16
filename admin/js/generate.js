// Blog admin: builds the post page and the listing edits, checks post data and plans one commit.
// Pure functions only (no DOM, no window, no location), so the same code runs in the browser and in Node.
// Note: hub card counts in confirm labels use "guide" for one card, as the hub page itself does.

export const SITE = "https://meritlinetaxservices.com";
export const SCHEMA_VERSION = 1;
export const SEO_TITLE_SUFFIX = "";
export const REFERENCE_GUIDES = ["blog/form-5472-no-income.html", "blog/how-to-get-ein-without-ssn.html",
  "blog/can-i-file-form-5472-myself.html", "blog/foreign-owned-llc-taxes.html"];
export const COUNTRY_TOPIC = "topic-us-llc-taxes-by-country";
// Ids a heading must never take: the shared page parts, and the ids js/main.js looks up on every page (a heading
// with one of them would be mistaken for a site form). loadSiteContext adds the ids it finds in the current
// layout and in js/main.js, so later site edits are covered too.
export const RESERVED_IDS = ["main", "navLinks", "menuBtn", "remindForm", "rm-email", "rmMsg", "mBar", "mWa",
  "waFloat", "yr", "questions",
  "quote", "estimator", "reviews", "f-name", "f-email", "f-phone", "f-msg", "f-service", "f-state", "f-formed",
  "f-ldate", "f-lnum", "r-name", "r-text", "r-consent"];
export const LIMITS = { keyPoints: 8, faq: 12, images: 10, titleMax: 150, slugMax: 80, seoTitleWarn: 60,
  descMin: 120, descMax: 160, thumbWarn: 14, summaryWarn: 170 };

// ---------- Messages ----------

const SHELL_MSG = "The admin could not find a guide page to copy the site layout from, so nothing was published.";
const BLOG_LIST_MSG = 'blog.html no longer has the expected "All guides" list, so nothing was published.';

const PLAN_MESSAGES = {
  VALIDATION: "Fix the items marked in the form before publishing.",
  ANCHOR: "A file on the website no longer has the expected layout, so nothing was published.",
  SHELL: SHELL_MSG,
  SLUG_TAKEN: "Another page already uses this web address. Choose another one.",
  NOT_FOUND: "This post is no longer on the website. Go back to your posts and refresh the list.",
  MISSING_ASSET: "The share picture is not ready yet. Wait a moment, then publish again.",
  BAD_DATA: "The saved copy of this post could not be read, so nothing was changed."
};

const MSG = {
  titleEmpty: "Add a title.",
  titleLong: "Shorten the title to 150 characters or fewer.",
  slugPattern: "Use only lowercase letters, numbers and dashes, starting and ending with a letter or number.",
  slugReserved: "This web address is reserved. Choose another one.",
  slugTaken: "Another page already uses this web address. Choose another one.",
  topic: "Choose a topic.",
  region: "Choose the group of countries this post belongs to.",
  category: "Add a card label.",
  thumb: "Add a short card word.",
  summary: "Add a short summary for the blog page.",
  answer: "Add the short answer that opens the post.",
  body: "Write the article text.",
  alt: "Every picture needs a description.",
  pictures: "Use 10 pictures or fewer in one post.",
  keyPoint: "Fill in this point or remove it.",
  keyPointsMax: "Use 8 key points or fewer.",
  faqPair: "Add both a question and an answer, or remove this row.",
  faqMax: "Use 12 questions or fewer.",
  description: "Add a search description.",
  date: "Enter a valid date.",
  future: "The published date can't be in the future.",
  token: "Remove the GitHub access key from this post. Publishing it would make it public.",
  bodyBad: "The article text contains formatting the website can't use. Please copy it into the editor again.",
  savedBad: "The saved copy of this post could not be read, so nothing was changed.",
  newerSchema: "This post was saved by a newer version of the admin page.",
  pictureMissing: "A picture in the article is not ready on this computer. Remove it and add it again with the Picture button.",
  pictureGone: "A picture in the article is no longer on the website. Remove it and add it again with the Picture button.",
  postIncomplete: "The post data is incomplete, so nothing was published. Go back to your posts and open the post again.",
  alreadyRemoved: "This post has already been removed from the website.",
  wTitle: "Long titles are hard to read. Try to keep it under 90 characters.",
  wSeo: n => `Search titles over 60 characters may be cut short in Google. This one has ${n}.`,
  wDesc: n => `Search descriptions work best between 120 and 160 characters. This one has ${n}.`,
  wThumb: "Keep the card word short, about 12 characters.",
  wSummary: "Keep the summary to one or two short sentences.",
  wHeading: "Add at least one heading so readers can scan the post."
};

export class PlanError extends Error {
  constructor(code, message, issues) {
    super(message || PLAN_MESSAGES[code] || PLAN_MESSAGES.BAD_DATA);
    this.name = "PlanError";
    this.code = code;
    this.issues = Array.isArray(issues) ? issues : [];
  }
}

function anchorError(file, what, detail) {
  const e = new PlanError("ANCHOR", `${file} no longer has the expected ${what}, so nothing was published.` + (detail ? ` (${detail})` : ""));
  e.file = file;
  e.what = what;
  e.detail = detail || "";
  return e;
}
function blogListError() {
  const e = new PlanError("ANCHOR", BLOG_LIST_MSG);
  e.file = "blog.html";
  return e;
}
function reformattedError(file) {
  const e = new PlanError("ANCHOR", `${file} has been reformatted by hand, so the admin cannot update its list of guides safely. Nothing was published.`);
  e.file = file;
  e.reformatted = true;
  return e;
}
// Re-issues an ANCHOR error under the repository path that was actually being edited.
function withFile(path, fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof PlanError && e.code === "ANCHOR" && e.file && e.file !== path) {
      if (e.reformatted) throw reformattedError(path);
      if (e.what) throw anchorError(path, e.what, e.detail);
    }
    throw e;
  }
}

// ---------- Small helpers ----------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const POST_ID_RE = /^[0-9a-f]{16}$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TOKEN_RE = /(?:github_pat_|ghp_)\w{20,}/;
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export const INVISIBLE_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200d\u2060\ufeff\ufffe\uffff]/g;
// Characters XML 1.0 does not allow at all (feed.xml would stop being readable).
const XML_BAD_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const LD_OPEN = '<script type="application/ld+json">';
const CARD_OPEN = '<a class="post-card" href="';

const str = v => (v === null || v === undefined ? "" : String(v));
const arr = v => (Array.isArray(v) ? v : []);
const count = (t, s) => (s ? t.split(s).length - 1 : 0);
const reEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function isoParts(iso) {
  const m = ISO_RE.exec(str(iso));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1000 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}
const isRealIso = iso => isoParts(iso) !== null;
const maxIso = (a, b) => (str(a) > str(b) ? str(a) : str(b));

function codePoint(n, fallback) {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : fallback;
}

// ---------- Text and escaping ----------

export function escHtml(s) {
  return str(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function escAttr(s) {
  return escHtml(s).replace(/"/g, "&quot;");
}
export function escXml(s) {
  return escHtml(str(s).replace(XML_BAD_RE, ""));
}
export function jsonLd(obj) {
  let s;
  try { s = JSON.stringify(obj); } catch { s = "null"; }
  if (typeof s !== "string") s = "null";
  return s.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
export function mdText(s) {
  return str(s).replace(/\s+/g, " ").trim().replace(/([\\[\]])/g, "\\$1");
}
export function plainText(html) {
  return str(html).replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (m, n) => codePoint(parseInt(n, 10), m))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (m, h) => codePoint(parseInt(h, 16), m))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\u00a0/g, " ");
}
export function cleanText(s) {
  return str(s).replace(LONE_SURROGATE_RE, "").normalize("NFC").replace(INVISIBLE_RE, "")
    .replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

const MONTH_ALT = MONTHS.join("|");
const TS_NW = /(^|[\s(\u201c"\u2018'])([A-Za-z0-9][A-Za-z0-9.\u2019']*(?:[-\u2013\u2011][A-Za-z0-9][A-Za-z0-9.\u2019']*)+)/g;
const TS_FORM = /\b(Forms?) (?=\d|<span class="nw">\d)/g;
const TS_US = /\bU\.S\. (?=LLC)/g;
const TS_PRO = /\b([Pp]ro) ([Ff]orma)\b/g;
const TS_DATE_Y = new RegExp(`\\b(${MONTH_ALT}) (\\d{1,2}), (\\d{4})\\b`, "g");
const TS_DATE = new RegExp(`\\b(${MONTH_ALT}) (\\d{1,2})\\b`, "g");

function typeset(s) {
  return s.replace(TS_NW, '$1<span class="nw">$2</span>')
    .replace(TS_FORM, "$1&nbsp;")
    .replace(TS_US, "U.S.&nbsp;")
    .replace(TS_PRO, "$1&nbsp;$2")
    .replace(TS_DATE_Y, "$1&nbsp;$2,&nbsp;$3")
    .replace(TS_DATE, "$1&nbsp;$2");
}
export function typesetText(plain) {
  return typeset(escHtml(cleanText(plain)));
}
export function typesetHtml(canonicalHtml) {
  return str(canonicalHtml).split(/(<[^>]*>)/).map((part, k) => (k % 2 ? part : typeset(part))).join("");
}

export function longDateHtml(iso) {
  const p = isoParts(iso);
  if (!p) return escHtml(str(iso));
  return `${MONTHS[p.m - 1]}&nbsp;${p.d},&nbsp;${p.y}`;
}
export function rfc822(iso) {
  const p = isoParts(iso);
  if (!p) return "";
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${DAY3[wd]}, ${String(p.d).padStart(2, "0")} ${MON3[p.m - 1]} ${p.y} 00:00:00 +0000`;
}
export function eolOf(t) {
  return str(t).includes("\r\n") ? "\r\n" : "\n";
}

// ---------- Slugs, ids, read time ----------

function cutAtDash(s, max) {
  if (s.length <= max) return s;
  const k = s.slice(0, max + 1).lastIndexOf("-");
  return (k > 0 ? s.slice(0, k) : s.slice(0, max)).replace(/-+$/, "");
}
export function slugify(title) {
  const s = str(title).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cutAtDash(s, LIMITS.slugMax);
}
export function slugProblem(slug, ctx, opts) {
  const s = str(slug);
  if (!SLUG_RE.test(s)) return MSG.slugPattern;
  if (s === "index" || s.startsWith("topic-")) return MSG.slugReserved;
  const own = opts && opts.ownSlug;
  const paths = ctx && ctx.paths;
  if (paths && typeof paths.has === "function" && s !== own) {
    if (paths.has(`blog/${s}.html`) || paths.has(`images/og-${s}.png`) || paths.has(`admin/posts/${s}.json`)) return MSG.slugTaken;
  }
  return null;
}
export function headingId(plain) {
  const s = cutAtDash(str(plain).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""), 80);
  return s || "section";
}

const H2_RE = /<h2(?: id="([^"]*)")?>([\s\S]*?)<\/h2>/g;

// reservedIds: optional extra ids to avoid (ctx.reservedIds); RESERVED_IDS are always avoided.
export function assignHeadingIds(body, reservedIds) {
  const s = str(body);
  const reserved = new Set([...RESERVED_IDS, ...(reservedIds || [])]);
  const used = new Set();
  // Valid ids already in the body are kept first (first occurrence wins), so published deep links stay stable.
  const kept = [...s.matchAll(H2_RE)].map(m => {
    const id = m[1];
    if (id !== undefined && ID_RE.test(id) && !reserved.has(id) && !used.has(id)) {
      used.add(id);
      return id;
    }
    return null;
  });
  let k = 0;
  return s.replace(H2_RE, (m, id, inner) => {
    let out = kept[k++];
    if (!out) {
      const base = headingId(plainText(inner));
      out = base;
      for (let n = 2; used.has(out) || reserved.has(out); n++) {
        const suffix = "-" + n;
        out = base.slice(0, 80 - suffix.length).replace(/-+$/, "") + suffix;
      }
      used.add(out);
    }
    return `<h2 id="${out}">${inner}</h2>`;
  });
}

// Saved text from before an id was reserved: the heading loses that id and gets a new one from assignHeadingIds.
function dropReservedIds(body, reservedIds) {
  const reserved = new Set([...RESERVED_IDS, ...(reservedIds || [])]);
  return str(body).replace(/<h2 id="([^"]*)">/g, (m, id) => (reserved.has(id) ? "<h2>" : m));
}

// Every id the site's own layout and script use, so a heading never takes one of them.
export function siteIds(shell, mainJs) {
  const out = new Set(RESERVED_IDS);
  if (shell) {
    const parts = [shell.head, shell.header, shell.footer, shell.tail, shell.authorBoxLine, shell.asideDarkLine,
      shell.asideCallPrefix, shell.asideCallSuffix, shell.byline, shell.ctaPrefix, shell.ctaMid, shell.ctaSuffix];
    for (const m of parts.map(str).join("\n").matchAll(/\sid="([^"]+)"/g)) out.add(m[1]);
  }
  const js = str(mainJs);
  for (const re of [/\$\(\s*["']([^"'\s]+)["']\s*\)/g, /getElementById\(\s*["']([^"'\s]+)["']\s*\)/g, /querySelector(?:All)?\(\s*["']#([A-Za-z][\w-]*)/g]) {
    for (const m of js.matchAll(re)) out.add(m[1]);
  }
  return out;
}

export function readMinutes(articleInnerHtml) {
  const words = plainText(articleInnerHtml).split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.max(1, Math.ceil(words / 200));
}

// ---------- Post data ----------

export function newPostId() {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function newPost(today) {
  const day = isRealIso(today) ? str(today) : localToday();
  return {
    schema: SCHEMA_VERSION, id: newPostId(), slug: "", title: "", seoTitle: "", description: "", topic: "", region: "",
    card: { category: "", thumb: "", summary: "" },
    lead: { answer: "", text: "" },
    keyPoints: [], bodyHtml: "", faq: [],
    rulesAsOf: day, published: day, modified: day, images: []
  };
}

const posInt = v => (Number.isInteger(+v) && +v > 0 ? +v : 0);

// The exact key order of admin/posts/<slug>.json.
function shapePost(p) {
  const o = p && typeof p === "object" ? p : {};
  const card = o.card && typeof o.card === "object" ? o.card : {};
  const lead = o.lead && typeof o.lead === "object" ? o.lead : {};
  return {
    schema: SCHEMA_VERSION,
    id: str(o.id), slug: str(o.slug), title: str(o.title), seoTitle: str(o.seoTitle), description: str(o.description),
    topic: str(o.topic), region: str(o.region),
    card: { category: str(card.category), thumb: str(card.thumb), summary: str(card.summary) },
    lead: { answer: str(lead.answer), text: str(lead.text) },
    keyPoints: arr(o.keyPoints).map(k => ({ bold: str(k && k.bold), text: str(k && k.text) })),
    bodyHtml: str(o.bodyHtml),
    faq: arr(o.faq).map(f => ({ q: str(f && f.q), a: str(f && f.a) })),
    rulesAsOf: str(o.rulesAsOf), published: str(o.published), modified: str(o.modified),
    images: arr(o.images).map(i => ({ path: str(i && i.path), alt: str(i && i.alt), width: posInt(i && i.width), height: posInt(i && i.height) }))
  };
}

export function postToJson(post) {
  return JSON.stringify(shapePost(post), null, 2) + "\n";
}

export function postFromJson(text) {
  let o;
  try {
    o = JSON.parse(str(text).replace(/^\ufeff/, ""));
  } catch {
    throw new PlanError("BAD_DATA", MSG.savedBad);
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new PlanError("BAD_DATA", MSG.savedBad);
  if (o.schema !== SCHEMA_VERSION) throw new PlanError("BAD_DATA", MSG.newerSchema);
  const bad = () => new PlanError("BAD_DATA", MSG.savedBad);
  if (typeof o.id !== "string" || !POST_ID_RE.test(o.id)) throw bad();
  if (typeof o.slug !== "string" || !SLUG_RE.test(o.slug)) throw bad();
  const optStr = v => v === undefined || typeof v === "string";
  const optObj = v => v === undefined || (v && typeof v === "object" && !Array.isArray(v));
  const optArr = v => v === undefined || Array.isArray(v);
  for (const k of ["title", "seoTitle", "description", "topic", "region", "bodyHtml", "rulesAsOf", "published", "modified"]) {
    if (!optStr(o[k])) throw bad();
  }
  if (!optObj(o.card) || !optObj(o.lead) || !optArr(o.keyPoints) || !optArr(o.faq) || !optArr(o.images)) throw bad();
  if (o.card && !["category", "thumb", "summary"].every(k => optStr(o.card[k]))) throw bad();
  if (o.lead && !["answer", "text"].every(k => optStr(o.lead[k]))) throw bad();
  if (o.keyPoints && !o.keyPoints.every(k => optObj(k) && k && optStr(k.bold) && optStr(k.text))) throw bad();
  if (o.faq && !o.faq.every(f => optObj(f) && f && optStr(f.q) && optStr(f.a))) throw bad();
  if (o.images && !o.images.every(i => optObj(i) && i && optStr(i.path) && optStr(i.alt))) throw bad();
  return shapePost(o);
}

export function findInboundLinks(slug, posts) {
  const s = str(slug);
  if (!s) return [];
  const a = `href="${s}.html"`, b = `href="${s}.html#`;
  return arr(posts)
    .filter(p => p && str(p.slug) !== s && (str(p.bodyHtml).includes(a) || str(p.bodyHtml).includes(b)))
    .map(p => ({ slug: str(p.slug), title: str(p.title) }));
}

// ---------- Validation ----------

const PIC_ATTR_RE = /<img src="([^"]*)" alt="([^"]*)" width="(\d+)" height="(\d+)"/g;

export function validatePost(post, ctx, opts) {
  const errors = [], warnings = [];
  try {
    const p = shapePost(post);
    const mode = opts && opts.mode === "update" ? "update" : "create";
    const today = opts && isRealIso(opts.today) ? opts.today : null;
    const err = (field, message) => errors.push({ field, message });
    const warn = (field, message) => warnings.push({ field, message });

    const title = cleanText(p.title);
    if (!title) err("title", MSG.titleEmpty);
    else if (title.length > LIMITS.titleMax) err("title", MSG.titleLong);

    if (mode === "create") {
      const own = ctx && ctx.adminSlugs && typeof ctx.adminSlugs.has === "function" && ctx.adminSlugs.has(p.slug) ? p.slug : null;
      const problem = slugProblem(p.slug, ctx, { ownSlug: own });
      if (problem) err("slug", problem);
    }

    const topicId = str(p.topic).trim();
    let hub = null;
    if (!topicId) err("topic", MSG.topic);
    else if (ctx && ctx.hubs && typeof ctx.hubs.get === "function") {
      hub = ctx.hubs.get(topicId) || null;
      if (!hub) err("topic", MSG.topic);
    }
    if (hub && arr(hub.regions).length) {
      const want = cleanText(p.region);
      if (!want || !hub.regions.some(r => cleanText(r.label) === want)) err("region", MSG.region);
    }

    if (!cleanText(p.card.category)) err("card.category", MSG.category);
    if (!cleanText(p.card.thumb)) err("card.thumb", MSG.thumb);
    if (!cleanText(p.card.summary)) err("card.summary", MSG.summary);
    if (!cleanText(p.lead.answer)) err("lead.answer", MSG.answer);

    const body = p.bodyHtml;
    const pics = [...body.matchAll(PIC_ATTR_RE)];
    const bodyText = cleanText(plainText(body));
    if (!bodyText && !pics.length) err("bodyHtml", MSG.body);
    else {
      if (!canonicalOk(body)) err("bodyHtml", MSG.bodyBad);
      if (pics.some(m => !cleanText(plainText(m[2])))) err("bodyHtml", MSG.alt);
      if (pics.length > LIMITS.images) err("bodyHtml", MSG.pictures);
    }

    p.keyPoints.forEach((k, i) => {
      if (!cleanText(k.bold) && !cleanText(k.text)) err(`keyPoints[${i}].text`, MSG.keyPoint);
    });
    if (p.keyPoints.length > LIMITS.keyPoints) err("keyPoints", MSG.keyPointsMax);

    p.faq.forEach((f, i) => {
      const q = cleanText(f.q), a = cleanText(f.a);
      if (!q || !a) err(`faq[${i}].${q ? "a" : "q"}`, MSG.faqPair);
    });
    if (p.faq.length > LIMITS.faq) err("faq", MSG.faqMax);

    const desc = cleanText(p.description);
    if (!desc) err("description", MSG.description);

    if (!isRealIso(p.rulesAsOf)) err("rulesAsOf", MSG.date);
    if (!isRealIso(p.published)) err("published", MSG.date);
    else if (today && p.published > today) err("published", MSG.future);

    const texts = [p.title, p.seoTitle, p.description, p.region, p.card.category, p.card.thumb, p.card.summary,
      p.lead.answer, p.lead.text, body];
    for (const k of p.keyPoints) texts.push(k.bold, k.text);
    for (const f of p.faq) texts.push(f.q, f.a);
    if (texts.some(t => TOKEN_RE.test(t))) err("form", MSG.token);

    // Warnings
    if (title.length > 90) warn("title", MSG.wTitle);
    const seo = (cleanText(p.seoTitle) || title);
    if (seo) {
      const n = (seo + SEO_TITLE_SUFFIX).length;
      if (n > LIMITS.seoTitleWarn) warn("seoTitle", MSG.wSeo(n));
    }
    if (desc && (desc.length < LIMITS.descMin || desc.length > LIMITS.descMax)) warn("description", MSG.wDesc(desc.length));
    if (cleanText(p.card.thumb).length > LIMITS.thumbWarn) warn("card.thumb", MSG.wThumb);
    if (cleanText(p.card.summary).length > LIMITS.summaryWarn) warn("card.summary", MSG.wSummary);
    if ((bodyText || pics.length) && !/<h2[ >]/.test(body)) warn("bodyHtml", MSG.wHeading);
  } catch {
    if (!errors.length) errors.push({ field: "form", message: MSG.postIncomplete });
  }
  return { errors, warnings };
}

// ---------- Canonical body check ----------

const TEXT_RE = /^(?:[^<>&\u00a0\u0000-\u001f\u007f]|&amp;|&lt;|&gt;)*$/;
const ATTR_RE = /^(?:[^<>&"\u0000-\u001f\u007f]|&amp;|&quot;|&lt;|&gt;)*$/;
const PIC_LINE_RE = /^<p><img src="(\.\.\/images\/blog\/[a-z0-9-]+-\d+\.(?:jpg|png|webp)|pending:p[0-9a-f]{8})" alt="([^"]*)" width="([1-9]\d{0,5})" height="([1-9]\d{0,5})" loading="lazy" decoding="async" style="height:auto"><\/p>$/;
const LINK_OPEN_RE = /^<a href="([^"]*)"( target="_blank" rel="noopener")?>$/;
const HREF_FORMS = [
  /^#[a-z0-9][a-z0-9-]*$/,
  /^[a-z0-9-]+\.html(?:#[a-z0-9-]+)?$/,
  /^\.\.\/(?:[a-z0-9-]+\.html)?(?:#[a-z0-9-]+)?$/,
  /^https?:\/\/[^\s"<>\\\u0000-\u001f\u007f]+$/,
  /^mailto:[^@\s"<>\\]+@[^@\s"<>\\]+$/
];

const textOk = (s, allowEmpty) => TEXT_RE.test(s) && !s.includes("  ") && !/^ | $/.test(s) && (allowEmpty || s.length > 0);
const decodeAttr = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function hrefOk(raw) {
  if (!ATTR_RE.test(raw)) return false;
  const h = decodeAttr(raw);
  if (!h || h.length > 2000) return false;
  return HREF_FORMS.some(re => re.test(h));
}

// Inline content of a block: text, strong (em inside), em, links (strong/em inside), nesting a > strong > em.
function inlineOk(s) {
  const toks = s.split(/(<[^>]*>)/);
  const stack = [];
  let hasText = false;
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k];
    if (k % 2 === 0) {
      if (tok === "") continue;
      if (!TEXT_RE.test(tok) || tok.includes("  ")) return false;
      const prev = k === 0 ? "start" : toks[k - 1];
      const next = k === toks.length - 1 ? "end" : toks[k + 1];
      if (tok.startsWith(" ") && (prev === "start" || !prev.startsWith("</"))) return false;
      if (tok.endsWith(" ") && (next === "end" || next.startsWith("</"))) return false;
      hasText = true;
      for (const e of stack) e.content = true;
      continue;
    }
    if (tok === "<strong>") {
      if (stack.some(e => e.tag === "strong" || e.tag === "em")) return false;
      stack.push({ tag: "strong", content: false });
    } else if (tok === "<em>") {
      if (stack.some(e => e.tag === "em")) return false;
      stack.push({ tag: "em", content: false });
    } else if (LINK_OPEN_RE.test(tok)) {
      if (stack.length) return false;
      if (!hrefOk(LINK_OPEN_RE.exec(tok)[1])) return false;
      stack.push({ tag: "a", content: false });
    } else if (tok === "</strong>" || tok === "</em>" || tok === "</a>") {
      const top = stack.pop();
      if (!top || `</${top.tag}>` !== tok || !top.content) return false;
    } else {
      return false;
    }
  }
  return stack.length === 0 && hasText;
}

function canonicalOk(html) {
  const s = str(html);
  if (s === "") return true;
  const lines = s.split("\n");
  const reserved = new Set(RESERVED_IDS);
  let i = 0, blocks = 0;
  while (i < lines.length) {
    let blank = 0;
    while (i < lines.length && lines[i] === "") { blank++; i++; }
    if (i >= lines.length) return false;
    const L = lines[i];
    const isH2 = L.startsWith("<h2");
    if (blocks === 0 ? blank !== 0 : blank !== (isH2 ? 1 : 0)) return false;
    blocks++;
    let m;
    if (isH2) {
      m = /^<h2(?: id="([^"]*)")?>(.*)<\/h2>$/.exec(L);
      if (!m || (m[1] !== undefined && (!ID_RE.test(m[1]) || reserved.has(m[1]))) || !textOk(m[2])) return false;
      i++;
    } else if (L.startsWith("<h3>")) {
      m = /^<h3>(.*)<\/h3>$/.exec(L);
      if (!m || !textOk(m[1])) return false;
      i++;
    } else if (L.startsWith("<p><img ")) {
      m = PIC_LINE_RE.exec(L);
      if (!m || !ATTR_RE.test(m[2])) return false;
      i++;
    } else if (L.startsWith("<p>")) {
      m = /^<p>(.*)<\/p>$/.exec(L);
      if (!m || !inlineOk(m[1])) return false;
      i++;
    } else if (L === "<ul>") {
      i++;
      let n = 0;
      while (i < lines.length && lines[i].startsWith("  <li>")) {
        m = /^ {2}<li>(.*)<\/li>$/.exec(lines[i]);
        if (!m || !inlineOk(m[1])) return false;
        n++; i++;
      }
      if (!n || lines[i] !== "</ul>") return false;
      i++;
    } else if (L === '<ol class="steps-list">') {
      i++;
      let n = 0;
      while (i < lines.length && lines[i].startsWith("  <li>")) {
        m = /^ {2}<li><div>(.*)<\/div><\/li>$/.exec(lines[i]);
        if (!m) return false;
        let inner = m[1];
        const b = /^<b>([^<]*)<\/b>/.exec(inner);
        if (b) {
          if (!textOk(b[1])) return false;
          inner = inner.slice(b[0].length);
          if (inner.startsWith(" ")) return false;
        }
        if (!inlineOk(inner)) return false;
        n++; i++;
      }
      if (!n || lines[i] !== "</ol>") return false;
      i++;
    } else if (L.startsWith('<div class="callout">')) {
      m = /^<div class="callout">((?:<p>.*?<\/p>)+)<\/div>$/.exec(L);
      if (!m) return false;
      const paras = m[1].slice(3, -4).split("</p><p>");
      if (!paras.every(inlineOk)) return false;
      i++;
    } else if (L === '<div class="tbl">') {
      if (lines[i + 1] !== "  <table>") return false;
      const hm = /^ {4}<thead><tr>((?:<th>[^<]*<\/th>){1,8})<\/tr><\/thead>$/.exec(lines[i + 2] || "");
      if (!hm || lines[i + 3] !== "    <tbody>") return false;
      const heads = [...hm[1].matchAll(/<th>([^<]*)<\/th>/g)].map(x => x[1]);
      if (!heads.every(h => textOk(h, true))) return false;
      const labels = heads.map(h => escAttr(plainText(h)));
      i += 4;
      let rows = 0;
      while (i < lines.length && lines[i].startsWith("      <tr>")) {
        m = /^ {6}<tr>(.*)<\/tr>$/.exec(lines[i]);
        if (!m) return false;
        const cells = [];
        const cre = /<td data-label="([^"]*)">(.*?)<\/td>/y;
        let c, at = 0;
        while ((c = cre.exec(m[1]))) { cells.push(c); at = cre.lastIndex; }
        if (at !== m[1].length || cells.length !== heads.length) return false;
        let filled = false;
        for (let k = 0; k < cells.length; k++) {
          if (cells[k][1] !== labels[k]) return false;
          if (cells[k][2] !== "") {
            if (!inlineOk(cells[k][2])) return false;
            filled = true;
          }
        }
        if (!filled) return false;
        rows++; i++;
      }
      if (!rows || lines[i] !== "    </tbody>" || lines[i + 1] !== "  </table>" || lines[i + 2] !== "</div>") return false;
      i += 3;
    } else {
      return false;
    }
  }
  return true;
}

export function assertCanonicalBody(html) {
  if (!canonicalOk(html)) throw new PlanError("BAD_DATA", MSG.bodyBad);
}

// ---------- Shell (layout copied from a reference guide) ----------

const ASIDE_CALL_RE = /^( {8}<div class="aside-box"><h3>Free <span class="nw">20-minute<\/span> call<\/h3><p>)(.*?)(<\/p>.*)$/;
const CTA_RE = /\n( {8}<div class="art-cta">\n {10}<h2>)(.*?)(<\/h2>\n {10}<p>)(.*?)( Email <strong class="cta-contact">.*?<\/p>\n {10}<p>.*?<\/p>\n {8}<\/div>\n)/;

const HEAD_TAGS = [
  ["title", /<title>[^<]*<\/title>/, v => `<title>${v.title}</title>`],
  ["description", /<meta name="description" content="[^"]*">/, v => `<meta name="description" content="${v.desc}">`],
  ["og:title", /<meta property="og:title" content="[^"]*">/, v => `<meta property="og:title" content="${v.title}">`],
  ["og:description", /<meta property="og:description" content="[^"]*">/, v => `<meta property="og:description" content="${v.desc}">`],
  ["article:published_time", /<meta property="article:published_time" content="[^"]*">/, v => `<meta property="article:published_time" content="${v.pub}">`],
  ["article:modified_time", /<meta property="article:modified_time" content="[^"]*">/, v => `<meta property="article:modified_time" content="${v.mod}">`],
  ["og:image", /<meta property="og:image" content="[^"]*">/, v => `<meta property="og:image" content="${SITE}/images/og-${v.slug}.png">`],
  ["canonical", /<link rel="canonical" href="[^"]*">/, v => `<link rel="canonical" href="${SITE}/blog/${v.slug}.html">`],
  ["og:url", /<meta property="og:url" content="[^"]*">/, v => `<meta property="og:url" content="${SITE}/blog/${v.slug}.html">`],
  ["twitter:image", /<meta name="twitter:image" content="[^"]*">/, v => `<meta name="twitter:image" content="${SITE}/images/og-${v.slug}.png">`]
];

const countRe = (t, re) => (t.match(new RegExp(re.source, "g")) || []).length;

function fillHead(head, values) {
  let h = head;
  for (const [, re, make] of HEAD_TAGS) h = h.replace(re, () => make(values));
  return h;
}

export function extractShell(referenceText, path) {
  const p = str(path);
  const fail = reason => {
    const e = new PlanError("SHELL", `${SHELL_MSG} (${reason})`);
    e.reason = reason;
    return e;
  };
  const src = str(referenceText);
  const eol = eolOf(src);
  const r = src.replace(/\r\n/g, "\n");
  const sm = /(?:^|\/)([a-z0-9-]+)\.html$/.exec(p);
  const refSlug = sm ? sm[1] : "";
  const once = (needle, label) => {
    const n = count(r, needle);
    if (n !== 1) throw fail(`${p}: ${label} found ${n} times instead of once`);
    return r.indexOf(needle);
  };

  const iHeadEnd = once("</head>", "the end of the page head");
  const head = r.slice(0, iHeadEnd);
  if (!/^\ufeff?<!doctype html>/i.test(head)) throw fail(`${p}: the page does not start as expected`);
  if (!head.includes("styles.css?v=")) throw fail(`${p}: the stylesheet link was not found`);
  if (!head.includes('<meta property="og:type" content="article">')) throw fail(`${p}: it is not marked as an article`);
  if (/<style|<script/i.test(head)) throw fail(`${p}: its page head has styles or scripts of its own`);
  for (const [name, re] of HEAD_TAGS) {
    if (countRe(head, re) !== 1) throw fail(`${p}: the ${name} tag was not found exactly once`);
  }

  const iMain = once('<main id="main">', "the main content");
  const header = r.slice(iHeadEnd, iMain);
  if (!header.includes('id="navLinks"') || !header.includes('id="menuBtn"') || !header.includes('<a href="../blog.html" aria-current="page">Blog</a>')) {
    throw fail(`${p}: the site header is not as expected`);
  }
  const iMainEnd = once("</main>", "the end of the main content");
  const iLd = r.indexOf(LD_OPEN, iMainEnd);
  if (iLd < 0) throw fail(`${p}: no structured data after the main content`);
  const footer = r.slice(iMainEnd, iLd);
  if (!footer.startsWith("</main>\n") || !footer.includes('id="remindForm"') || !footer.includes('id="mBar"') || !footer.includes('id="waFloat"')) {
    throw fail(`${p}: the site footer is not as expected`);
  }
  const iTail = once("<script>document.documentElement.dataset.root", "the closing scripts");
  const tail = r.slice(iTail);
  if (!tail.includes("main.js?v=") || !tail.endsWith("</html>\n")) throw fail(`${p}: the closing scripts are not as expected`);
  if (!(iHeadEnd < iMain && iMain < iMainEnd && iMainEnd < iLd && iLd < iTail)) throw fail(`${p}: the page parts are out of order`);

  const authorBoxes = [...r.matchAll(/^ {8}<div class="author-box">.*\n/gm)];
  if (authorBoxes.length !== 1) throw fail(`${p}: the author box was not found exactly once`);

  const asideOpen = '<aside class="aside">\n';
  const iAside = once(asideOpen, "the side column") + asideOpen.length;
  const iRelated = r.indexOf('        <div class="aside-box"><h3>Related</h3>', iAside);
  if (iRelated < 0) throw fail(`${p}: the Related box was not found`);
  const asideLines = r.slice(iAside, iRelated).split("\n");
  if (asideLines.length !== 3 || asideLines[2] !== "" ||
      !asideLines[0].startsWith('        <div class="aside-box') || !asideLines[1].startsWith('        <div class="aside-box')) {
    throw fail(`${p}: the side column boxes are not as expected`);
  }
  const call = ASIDE_CALL_RE.exec(asideLines[1]);
  if (!call) throw fail(`${p}: the call box is not as expected`);

  const by = /<div class="art-meta">(<span>By .*?<\/span>)<span>/.exec(r);
  if (!by) throw fail(`${p}: the author line was not found`);
  const cta = CTA_RE.exec(r);
  if (!cta) throw fail(`${p}: the call-to-action box is not as expected`);

  let article = null;
  for (const m of r.slice(iLd, iTail).matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)) {
    let o;
    try { o = JSON.parse(m[1]); } catch { throw fail(`${p}: its structured data could not be read`); }
    if (!article && o && o["@type"] === "Article") article = o;
  }
  if (!article || !article.author || !article.publisher || !article.isPartOf || !article.inLanguage) {
    throw fail(`${p}: the article structured data is not as expected`);
  }

  // The head with every per-page value blanked must not mention the reference page any more.
  const skeleton = fillHead(head, { title: "", desc: "", pub: "", mod: "", slug: "x" });
  if (refSlug && skeleton.includes(refSlug)) throw fail(`${p}: its page head has text that belongs to that page only`);

  return {
    path: p, refSlug, eol, head, header, footer, tail,
    authorBoxLine: authorBoxes[0][0],
    asideDarkLine: asideLines[0] + "\n",
    asideCallPrefix: call[1], asideCallSuffix: call[3] + "\n",
    byline: by[1],
    ctaPrefix: cta[1], ctaMid: cta[3], ctaSuffix: cta[5],
    ldAuthor: article.author, ldPublisher: article.publisher, ldIsPartOf: article.isPartOf, ldInLanguage: article.inLanguage
  };
}

// ---------- Page assembly ----------

export function assemblePostPage(parts, shell) {
  const P = parts || {};
  const slug = str(P.slug);
  const url = `${SITE}/blog/${slug}.html`;
  const og = `${SITE}/images/og-${slug}.png`;
  const head = fillHead(shell.head, { title: str(P.titleText), desc: str(P.descriptionAttr), pub: escAttr(P.published), mod: escAttr(P.modified), slug });
  const dateText = str(P.published) === str(P.modified) ? longDateHtml(P.published) : "Updated " + longDateHtml(P.modified);
  const cta = shell.ctaPrefix + str(P.ctaH2Html) + shell.ctaMid + str(P.ctaTextHtml) + shell.ctaSuffix;
  const asideDark = P.asideDarkLine === null || P.asideDarkLine === undefined ? shell.asideDarkLine : str(P.asideDarkLine);
  const asideCall = shell.asideCallPrefix + str(P.asideCallHtml) + shell.asideCallSuffix;

  const main = `<main id="main">
  <section class="page-hero">
    <div class="wrap">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="../">Home</a> <span aria-hidden="true">/</span> <a href="../blog.html">Blog</a> <span aria-hidden="true">/</span> <a href="${str(P.hubHref)}">${str(P.hubLabelHtml)}</a></nav>
      <h1>${str(P.h1Html)}</h1>
      <div class="art-meta">${shell.byline}<span>${dateText}</span><span>${str(P.readMinutes)} min read</span></div>
    </div>
  </section>

  <section class="sec-tight">
    <div class="wrap page-wrap">
      <article class="prose article">
${str(P.articleInner)}
${shell.authorBoxLine}${cta}        <p class="disclaimer">${str(P.disclaimerHtml)}</p>
        <section class="read-next" aria-label="Read next"><h2>Read next in <a href="${str(P.hubHref)}">${str(P.hubLabelHtml)}</a></h2><div class="rn-grid">${str(P.readNextCardsHtml)}</div></section>
      </article>
      <aside class="aside">
${asideDark}${asideCall}        <div class="aside-box"><h3>Related</h3><ul>${str(P.relatedHtml)}</ul></div>
      </aside>
    </div>
  </section>
`;

  const article = {
    "@context": "https://schema.org", "@type": "Article",
    headline: str(P.headline), description: str(P.ldDescription), image: og,
    datePublished: str(P.published), dateModified: str(P.modified),
    author: shell.ldAuthor, publisher: shell.ldPublisher, isPartOf: shell.ldIsPartOf, inLanguage: shell.ldInLanguage,
    mainEntityOfPage: url
  };
  let ld = `${LD_OPEN}${jsonLd(article)}</script>\n`;
  if (Array.isArray(P.faq) && P.faq.length) {
    const faq = {
      "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: P.faq.map(x => ({ "@type": "Question", name: str(x.name), acceptedAnswer: { "@type": "Answer", text: str(x.text) } }))
    };
    ld += `${LD_OPEN}${jsonLd(faq)}</script>\n`;
  }
  const crumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: SITE + "/blog.html" },
      { "@type": "ListItem", position: 3, name: str(P.hubLabel), item: `${SITE}/blog/${str(P.hubHref)}` },
      { "@type": "ListItem", position: 4, name: str(P.headline), item: url }
    ]
  };
  ld += `${LD_OPEN}${jsonLd(crumbs)}</script>\n`;

  const out = head + shell.header + main + shell.footer + ld + shell.tail;
  const eol = P.eol === "\r\n" || P.eol === "\n" ? P.eol : shell.eol;
  return eol === "\r\n" ? out.replace(/\n/g, "\r\n") : out;
}

const CTA_H2 = "Need help with your filing?";
const CTA_TEXT = "Tell us about your situation and we will confirm what you need to file, with a clear quote before any work begins.";
const ASIDE_CALL_TEXT = "Not sure what applies to you? Talk to us first, at no cost.";
const PENALTY_TOPIC = "topic-penalties-and-late-filing";
const PENALTY_ASIDE_DARK = '        <div class="aside-box dark"><h3>Late filings</h3><p class="big">Free quote</p><p><span class="nw">Catch-up</span> filings priced by the number of years missed, with a reasonable cause statement where the facts support it.</p><a class="btn btn-primary" href="../contact.html#quote">Get a free quote</a></div>\n';

const RELATED_DEFAULT = [
  ["../form-5472-checker.html", "Free tool: Form&nbsp;5472 checker"],
  ["form-5472-explained.html", "Form&nbsp;5472 instructions explained"],
  ["foreign-owned-llc-taxes.html", "Foreign-owned LLC taxes: the complete guide"],
  ["../form-5472.html", "Form&nbsp;5472 &amp; Pro&nbsp;Forma&nbsp;1120 service"],
  ["../state-filings.html", "State filings &amp; annual reports"]
];
const RELATED = {
  "topic-deadlines-and-extensions": [
    ["../form-5472-checker.html", "Free tool: Form&nbsp;5472 checker"],
    ["form-5472-deadline-2026-2027.html", "Form&nbsp;5472 Deadline 2026 and 2027"],
    ["form-5472-extension-form-7004.html", "Form&nbsp;5472 Extension: Form&nbsp;7004"],
    ["form-5472-explained.html", "Form&nbsp;5472 instructions explained"],
    ["../form-5472.html", "Form&nbsp;5472 &amp; Pro&nbsp;Forma&nbsp;1120 service"]
  ],
  "topic-penalties-and-late-filing": [
    ["../form-5472-penalty-calculator.html", "Free tool: penalty calculator"],
    ["../reasonable-cause-letter-generator.html", "Free tool: reasonable cause letter"],
    ["form-5472-late-filing-penalty-abatement.html", "Form&nbsp;5472 Late Filing Penalty and Abatement"],
    ["../late-filings.html", 'Late filings &amp; <span class="nw">catch-up</span>'],
    ["../form-5472.html", "Form&nbsp;5472 &amp; Pro&nbsp;Forma&nbsp;1120 service"]
  ]
};

const SITE_PAGES = [
  ["../form-5472.html", "Form 5472 and Pro Forma 1120 service"],
  ["../state-filings.html", "State filings"],
  ["../late-filings.html", "Late filings and catch-up"],
  ["../pricing.html", "Pricing"],
  ["../contact.html", "Contact"],
  ["../form-5472-checker.html", "Form 5472 checker"],
  ["../form-5472-penalty-calculator.html", "Penalty calculator"],
  ["../reasonable-cause-letter-generator.html", "Reasonable cause letter builder"],
  ["../about.html", "About"]
];

const pathOfHref = href => (href.startsWith("../") ? href.slice(3) : `blog/${href}`);

// Country guides link to the service, up to 3 guides of their own region, then the general guides.
const COUNTRY_RELATED_HEAD = [["../form-5472.html", "Form&nbsp;5472 &amp; Pro&nbsp;Forma&nbsp;1120"]];
const COUNTRY_RELATED_TAIL = [
  ["form-5472-explained.html", "Form&nbsp;5472 instructions explained"],
  ["../state-filings.html", "State filings &amp; annual reports"],
  ["foreign-owned-llc-taxes.html", "Foreign-owned LLC taxes: the complete guide"]
];

// A hand-written hub card the post may link to: not the post, not made with the admin, and still on the website.
const linkableCard = (ctx, c, slug) => c.slug !== slug && !ctx.adminSlugs.has(c.slug) && ctx.paths.has(pathOfHref(c.href));

// The part of a card title before its first colon (outside any tag), as the country guides' Related boxes use it.
export function shortTitleHtml(titleHtml) {
  const toks = str(titleHtml).split(/(<[^>]*>)/);
  let depth = 0, out = "";
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k];
    if (k % 2) {
      if (/^<\//.test(tok)) depth--; else if (!/\/>$/.test(tok)) depth++;
      out += tok;
      continue;
    }
    const i = depth === 0 ? tok.indexOf(":") : -1;
    if (i >= 0) {
      const cut = (out + tok.slice(0, i)).trim();
      return cut || str(titleHtml);
    }
    out += tok;
  }
  return str(titleHtml);
}

function regionCards(ctx, topicId, region, slug) {
  const hub = ctx.hubs.get(topicId);
  const want = cleanText(region);
  if (!hub || !arr(hub.regions).length || !want) return [];
  return hub.cards.filter(c => c.region === want && linkableCard(ctx, c, slug));
}

function relatedHtml(ctx, topicId, slug, region) {
  let list = RELATED[topicId] || RELATED_DEFAULT;
  if (topicId === COUNTRY_TOPIC) {
    const siblings = regionCards(ctx, topicId, region, slug).slice(0, 3).map(c => [c.href, shortTitleHtml(c.titleHtml)]);
    list = [...COUNTRY_RELATED_HEAD, ...siblings, ...COUNTRY_RELATED_TAIL];
  }
  return list
    .filter(([href]) => href !== `${slug}.html` && ctx.paths.has(pathOfHref(href)))
    .map(([href, label]) => `<li><a href="${href}">${label}</a></li>`)
    .join("");
}

// Hub cards whose page is not in the repository are skipped (as in the Related box), so a guide
// removed by hand without updating its hub never gets a new link. A post in a hub with regions first
// takes two guides of its own region and "Form 5472 explained", as the country guides do.
function readNextHtml(ctx, topicId, slug, region) {
  const seen = new Set(), picks = [];
  const take = c => {
    if (picks.length >= 3 || seen.has(c.href) || !linkableCard(ctx, c, slug)) return false;
    seen.add(c.href);
    picks.push(c);
    return true;
  };
  const same = regionCards(ctx, topicId, region, slug);
  if (same.length) {
    let n = 0;
    for (const c of same) if (n < 2 && take(c)) n++;
    const core = ctx.hubs.get("topic-form-5472");
    const explained = core ? core.cards.find(c => c.href === "form-5472-explained.html") : null;
    if (explained) take(explained);
  }
  const order = [topicId, "topic-form-5472", ...ctx.topics.map(t => t.id)];
  for (const id of order) {
    const hub = ctx.hubs.get(id);
    if (!hub) continue;
    for (const c of hub.cards) take(c);
  }
  return picks.map(c => `<a class="rn-card" href="${c.href}"><b>${c.titleHtml}</b><span>${c.summaryHtml}</span></a>`).join("");
}

const disclaimerHtml = (topicId, rulesAsOf) => (topicId === COUNTRY_TOPIC
  ? `This article is general information based on U.S. federal rules as of ${longDateHtml(rulesAsOf)}. It is not tax or legal advice for your specific situation, and it does not cover tax obligations in your home country, which you should confirm with a local tax adviser. Rules and due dates can change, so confirm your requirements before you file.`
  : `This article is general information based on federal rules as of ${longDateHtml(rulesAsOf)}. It is not tax or legal advice for your specific situation. Rules and due dates can change, so confirm your requirements before you file.`);

export function buildPostPage(post, ctx, opts) {
  const options = opts || {};
  const preview = options.preview || null;
  if (!ctx || !ctx.shell || !Array.isArray(ctx.topics)) throw new PlanError("SHELL");
  const p = shapePost(post);

  if (!preview) {
    if (!SLUG_RE.test(p.slug)) throw new PlanError("VALIDATION", undefined, [{ field: "slug", message: MSG.slugPattern }]);
    const { errors } = validatePost(p, ctx, { mode: "update", today: maxIso(p.published, p.modified) });
    if (errors.length) throw new PlanError("VALIDATION", undefined, errors);
    assertCanonicalBody(p.bodyHtml);
    if (/src="pending:/.test(p.bodyHtml)) throw new PlanError("MISSING_ASSET", MSG.pictureMissing);
  }

  const topic = ctx.topics.find(t => t.id === p.topic) || (preview ? ctx.topics[0] : null);
  if (!topic) throw new PlanError("VALIDATION", undefined, [{ field: "topic", message: MSG.topic }]);
  const title = cleanText(p.title) || (preview ? "Untitled post" : "");
  const slug = SLUG_RE.test(p.slug) ? p.slug : "preview";

  // Body
  let body = dropReservedIds(p.bodyHtml, ctx.reservedIds);
  if (!canonicalOk(body)) body = "<p>The article text could not be shown.</p>";
  body = assignHeadingIds(body, ctx.reservedIds);
  if (preview) {
    body = body.replace(/src="pending:(p[0-9a-f]{8})"/g, (m, id) => {
      let src = "";
      try { src = str(typeof preview.imageSrc === "function" ? preview.imageSrc(id) : ""); } catch { src = ""; }
      return `src="${escAttr(src)}"`;
    });
  }
  const bodyHtml = body ? typesetHtml(body) : "";

  const blocks = [];
  const answer = cleanText(p.lead.answer), leadText = cleanText(p.lead.text);
  if (answer) blocks.push(`<p class="lead"><strong>${typesetText(answer)}</strong>${leadText ? " " + typesetText(leadText) : ""}</p>`);

  const kps = p.keyPoints.map(k => ({ b: cleanText(k.bold), t: cleanText(k.text) })).filter(k => k.b || k.t);
  if (kps.length) {
    const li = k => (k.b && k.t ? `<li><strong>${typesetText(k.b)}</strong> ${typesetText(k.t)}</li>`
      : k.b ? `<li><strong>${typesetText(k.b)}</strong></li>` : `<li>${typesetText(k.t)}</li>`);
    blocks.push(`<div class="keypoints">\n  <h2>Key points</h2>\n  <ul>\n${kps.map(k => "    " + li(k)).join("\n")}\n  </ul>\n</div>`);
  }

  const faq = p.faq.map(f => ({ q: cleanText(f.q), a: cleanText(f.a) })).filter(f => (preview ? f.q || f.a : f.q && f.a));
  const toc = [...bodyHtml.matchAll(/<h2 id="([^"]*)">([\s\S]*?)<\/h2>/g)].map(m => `<li><a href="#${m[1]}">${m[2]}</a></li>`);
  if (faq.length) toc.push('<li><a href="#questions">Frequently asked questions</a></li>');
  if (toc.length >= 2) blocks.push(`<nav class="toc" aria-label="On this page"><p class="toc-h">On this page</p><ol>${toc.join("")}</ol></nav>`);

  if (bodyHtml) blocks.push(bodyHtml);

  let faqLd = null;
  if (faq.length) {
    const lines = faq.map(f => ({ h: typesetText(f.q), a: typesetText(f.a) }));
    blocks.push(`<h2 id="questions">Frequently asked questions</h2>\n` + lines.map(x => `<h3>${x.h}</h3><p>${x.a}</p>`).join("\n"));
    faqLd = lines.map(x => ({ name: plainText(x.h), text: plainText(x.a) }));
  }

  const articleInner = "\n" + blocks.join("\n\n") + "\n";
  const minutes = readMinutes(articleInner);
  const h1Html = typesetText(title);

  const parts = {
    slug, eol: options.eol,
    titleText: escAttr(cleanText(p.seoTitle) ? cleanText(p.seoTitle) + SEO_TITLE_SUFFIX : title + SEO_TITLE_SUFFIX),
    descriptionAttr: escAttr(cleanText(p.description)),
    published: p.published, modified: p.modified,
    hubHref: `${topic.id}.html`, hubLabelHtml: topic.labelHtml, hubLabel: topic.label,
    h1Html, readMinutes: minutes, articleInner,
    ctaH2Html: CTA_H2, ctaTextHtml: CTA_TEXT,
    disclaimerHtml: disclaimerHtml(topic.id, p.rulesAsOf),
    readNextCardsHtml: readNextHtml(ctx, topic.id, slug, p.region),
    asideDarkLine: topic.id === PENALTY_TOPIC ? PENALTY_ASIDE_DARK : null,
    asideCallHtml: ASIDE_CALL_TEXT,
    relatedHtml: relatedHtml(ctx, topic.id, slug, p.region),
    ldDescription: cleanText(p.description),
    headline: plainText(h1Html),
    faq: faqLd
  };
  return { html: assemblePostPage(parts, ctx.shell), readMinutes: minutes, articleInner };
}

export function cardData(post, minutes) {
  const p = shapePost(post);
  return {
    slug: p.slug,
    thumbHtml: typesetText(p.card.thumb),
    catHtml: typesetText(p.card.category),
    titleHtml: typesetText(p.title),
    summaryHtml: typesetText(p.card.summary),
    minutes
  };
}

// ---------- Listings ----------

export function cardHtml(card, href, eol) {
  const e = eol === "\r\n" ? "\r\n" : "\n";
  return `<a class="post-card" href="${href}">${e}` +
    `          <div class="post-thumb" aria-hidden="true"><b>${card.thumbHtml}</b></div>${e}` +
    `          <div class="post-body"><span class="post-cat">${card.catHtml}</span><h3>${card.titleHtml}</h3><p>${card.summaryHtml}</p><span class="post-meta">${card.minutes} min read</span></div>${e}` +
    `        </a>`;
}

// [start, end) of the card block with this href inside [from, to), or null.
function findCard(t, href, from, to, eol, fail) {
  const open = `${CARD_OPEN}${href}">`;
  const s = t.indexOf(open, from);
  if (s < 0 || s >= to) return null;
  const s2 = t.indexOf(open, s + 1);
  if (s2 > -1 && s2 < to) throw fail(`the card for ${href} appears twice`);
  const close = `${eol}        </a>`;
  const e = t.indexOf(close, s);
  if (e < 0 || e > to) throw fail(`the card for ${href} has no end`);
  const end = e + close.length;
  if (t.slice(s + open.length, end).includes('<a class="post-card"')) throw fail(`the card for ${href} is not closed`);
  return [s, end];
}

const CARD_RE = /<a class="post-card" href="([^"]+)">([\s\S]*?)<\/a>/g;
function cardParts(inner) {
  const g = re => { const m = re.exec(inner); return m ? m[1] : ""; };
  return {
    thumbHtml: g(/<b>([\s\S]*?)<\/b><\/div>/),
    catHtml: g(/<span class="post-cat">([\s\S]*?)<\/span><h3>/),
    titleHtml: g(/<h3>([\s\S]*?)<\/h3>/),
    summaryHtml: g(/<\/h3><p>([\s\S]*?)<\/p><span class="post-meta">/),
    minutes: parseInt(g(/<span class="post-meta">(\d+) min read<\/span>/), 10) || 0
  };
}

// blog.html
function blogSection(t) {
  const A = "<h2>All guides</h2>", B = '<h2 class="blog-h2">Guides by country</h2>';
  if (count(t, A) !== 1 || count(t, B) !== 1) throw blogListError();
  const a = t.indexOf(A), b = t.indexOf(B);
  if (b < a) throw blogListError();
  return [a, b];
}
// The "Guides by country" part: from its heading to the end of the section, with its region headings.
function blogCountryPart(t) {
  const [, b] = blogSection(t);
  const e = t.indexOf("</section>", b);
  return [b, e < 0 ? t.length : e];
}
// Where the region grid for this label starts and ends in blog.html, or null when blog.html has no such heading.
function blogRegionRange(t, regionLabel) {
  const want = cleanText(regionLabel);
  if (!want) return null;
  const [b, e] = blogCountryPart(t);
  const regions = hubRegions(t, b, e);
  const matches = regions.filter(r => r.label === want);
  if (matches.length !== 1) return null;
  const next = regions.find(r => r.index > matches[0].index);
  return [matches[0].end, next ? next.index : e];
}
// Where a card for this href sits in blog.html: "all" (All guides), "country" (with its region label) or null.
export function blogCardPlace(blogText, slug) {
  const t = str(blogText);
  const open = `${CARD_OPEN}blog/${slug}.html">`;
  const p = t.indexOf(open);
  if (p < 0) return null;
  const [a, b] = blogSection(t);
  if (p > a && p < b) return { part: "all", region: "" };
  const [c, e] = blogCountryPart(t);
  if (p > c && p < e) {
    const r = regionAt(hubRegions(t, c, e), p);
    return { part: "country", region: r ? r.label : "" };
  }
  return null;
}
// regionLabel: for a by-country post, the card goes first in that region's grid under "Guides by country"
// (as the hand-written country guides are listed); otherwise, or when blog.html has no grid for that region,
// first in "All guides". A card in the other place is moved.
export function blogUpsertCard(blogText, card, regionLabel) {
  let t = str(blogText);
  const eol = eolOf(t);
  const href = `blog/${card.slug}.html`;
  const html = cardHtml(card, href, eol);
  const [a, b] = blogSection(t);
  const region = blogRegionRange(t, regionLabel);
  const [from, to] = region || [a, b];
  const found = findCard(t, href, from, to, eol, () => blogListError());
  if (found) {
    if (t.slice(found[0], found[1]) === html) return t;
    return t.slice(0, found[0]) + html + t.slice(found[1]);
  }
  t = blogRemoveCard(t, card.slug, { countryPart: true });
  const [a2, b2] = blogSection(t);
  const [from2, to2] = blogRegionRange(t, regionLabel) || [a2, b2];
  const first = t.indexOf(CARD_OPEN, from2);
  if (first < 0 || first > to2) throw blogListError();
  return t.slice(0, first) + html + t.slice(first);
}
// opts.countryPart: also look in "Guides by country" (only ever asked for a post made with the admin).
export function blogRemoveCard(blogText, slug, opts) {
  const t = str(blogText), eol = eolOf(t);
  const href = `blog/${slug}.html`;
  const [a, b] = blogSection(t);
  const found = findCard(t, href, a, b, eol, () => blogListError());
  if (found) return t.slice(0, found[0]) + t.slice(found[1]);
  if (!(opts && opts.countryPart)) return t;
  const [c, e] = blogCountryPart(t);
  const inCountry = findCard(t, href, c, e, eol, () => blogListError());
  return inCountry ? t.slice(0, inCountry[0]) + t.slice(inCountry[1]) : t;
}
export function parseTopics(blogText) {
  const t = str(blogText);
  const open = '<nav class="topic-chips" aria-label="Browse by topic">';
  const n = count(t, open);
  if (n !== 1) throw anchorError("blog.html", "topic list", `the topic links were found ${n} times instead of once`);
  const s = t.indexOf(open) + open.length;
  const e = t.indexOf("</nav>", s);
  if (e < 0) throw anchorError("blog.html", "topic list", "the end of the topic links was not found");
  const out = [];
  for (const m of t.slice(s, e).matchAll(/<a href="blog\/(topic-[a-z0-9-]+)\.html">([\s\S]*?)<\/a>/g)) {
    out.push({ href: `${m[1]}.html`, file: `blog/${m[1]}.html`, labelHtml: m[2] });
  }
  if (!out.length) throw anchorError("blog.html", "topic list", "no topic links were found");
  return out;
}
export function parseGuideCards(blogText) {
  const t = str(blogText);
  const [a, b] = blogSection(t);
  const e = t.indexOf("</section>", b);
  const out = [], seen = new Set();
  for (const [x, y] of [[a, b], [b, e < 0 ? t.length : e]]) {
    for (const m of t.slice(x, y).matchAll(CARD_RE)) {
      const sm = /^blog\/([a-z0-9-]+)\.html$/.exec(m[1]);
      if (!sm || seen.has(sm[1])) continue;
      seen.add(sm[1]);
      const c = cardParts(m[2]);
      out.push({ slug: sm[1], file: `${sm[1]}.html`, titleHtml: c.titleHtml, title: cleanText(plainText(c.titleHtml)), summaryHtml: c.summaryHtml, isAdmin: false });
    }
  }
  return out;
}

// Topic hubs
const HUB_H2 = "<h2>All guides in this topic</h2>";
const HUB_META_RE = /<div class="art-meta"><span>Updated [^<]*<\/span><span>\d+ guides?<\/span><\/div>/;
const CP_ANCHOR = LD_OPEN + '{"@context":"https://schema.org","@type":"CollectionPage"';

function hubFileOf(t) {
  const m = /<link rel="canonical" href="https:\/\/meritlinetaxservices\.com\/(blog\/[a-z0-9-]+\.html)">/.exec(t);
  return m ? m[1] : "The topic page";
}
function hubSection(t, file) {
  const n = count(t, HUB_H2);
  if (n !== 1) throw anchorError(file, "list of guides", `the "All guides in this topic" heading was found ${n} times instead of once`);
  const a = t.indexOf(HUB_H2);
  const b = t.indexOf("</section>", a);
  if (b < 0) throw anchorError(file, "list of guides", "the end of the list was not found");
  return [a, b];
}
function hubRegions(t, a, b) {
  const out = [];
  for (const m of t.slice(a, b).matchAll(/<h3 class="blog-h3">(.*?)<\/h3>/g)) {
    out.push({ index: a + m.index, end: a + m.index + m[0].length, labelHtml: m[1], label: cleanText(plainText(m[1])) });
  }
  return out;
}
function regionAt(regions, pos) {
  let cur = null;
  for (const r of regions) if (r.index < pos) cur = r;
  return cur;
}
function hubCollection(t, file) {
  const n = count(t, CP_ANCHOR);
  if (n === 0) {
    for (const m of t.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      let o = null;
      try { o = JSON.parse(m[1]); } catch { o = null; }
      if (o && o["@type"] === "CollectionPage") throw reformattedError(file);
    }
    throw anchorError(file, "list for search engines (JSON-LD)", "the CollectionPage block was not found");
  }
  if (n > 1) throw anchorError(file, "list for search engines (JSON-LD)", `the CollectionPage block was found ${n} times`);
  const s = t.indexOf(CP_ANCHOR) + LD_OPEN.length;
  const e = t.indexOf("</script>", s);
  if (e < 0) throw anchorError(file, "list for search engines (JSON-LD)", "the end of the block was not found");
  const raw = t.slice(s, e);
  let obj;
  try { obj = JSON.parse(raw); } catch { throw reformattedError(file); }
  if (jsonLd(obj) !== raw) throw reformattedError(file);
  if (!obj.mainEntity || typeof obj.mainEntity !== "object" || !Array.isArray(obj.mainEntity.itemListElement)) {
    throw anchorError(file, "list for search engines (JSON-LD)", "the list of items was not found");
  }
  return { s, e, obj };
}
// Recount the cards, refresh "Updated ... / N guides" and rebuild the ItemList in card order.
function hubRefresh(t, today, file, names) {
  const [a, b] = hubSection(t, file);
  const cards = [...t.slice(a, b).matchAll(CARD_RE)];
  const n = cards.length;
  if (count(t, '<div class="art-meta">') !== 1 || !HUB_META_RE.test(t)) throw anchorError(file, "guide count line", "the date and count line was not found");
  t = t.replace(HUB_META_RE, () => `<div class="art-meta"><span>Updated ${longDateHtml(today)}</span><span>${n} ${n === 1 ? "guide" : "guides"}</span></div>`);
  const { s, e, obj } = hubCollection(t, file);
  const old = new Map();
  for (const x of obj.mainEntity.itemListElement) if (x && typeof x.url === "string") old.set(x.url, x.name);
  obj.mainEntity.itemListElement = cards.map((m, i) => {
    const url = `${SITE}/blog/${m[1]}`;
    let name = names.get(url);
    if (name === undefined) name = old.get(url);
    if (name === undefined) name = cleanText(plainText(cardParts(m[2]).titleHtml));
    return { "@type": "ListItem", position: i + 1, name, url };
  });
  obj.mainEntity.numberOfItems = n;
  obj.dateModified = today;
  return t.slice(0, s) + jsonLd(obj) + t.slice(e);
}
export function hubUpsertCard(hubText, card, today, regionLabel) {
  let t = str(hubText);
  const file = hubFileOf(t), eol = eolOf(t);
  let [a, b] = hubSection(t, file);
  const href = `${card.slug}.html`;
  const url = `${SITE}/blog/${href}`;
  const html = cardHtml(card, href, eol);
  const fail = d => anchorError(file, "list of guides", d);
  const want = cleanText(regionLabel);
  const pickRegion = regions => {
    if (!regions.length) return null;
    const matches = regions.filter(r => r.label === want);
    if (!want || !matches.length) throw new PlanError("VALIDATION", undefined, [{ field: "region", message: MSG.region }]);
    if (matches.length > 1) throw fail(`the group "${want}" appears more than once`);
    return matches[0];
  };
  let regions = hubRegions(t, a, b);
  let target = pickRegion(regions);
  const names = new Map([[url, plainText(card.titleHtml)]]);
  const found = findCard(t, href, a, b, eol, fail);
  if (found) {
    const cur = regionAt(regions, found[0]);
    if (!regions.length || (cur && target && cur.index === target.index)) {
      if (t.slice(found[0], found[1]) === html) return t;
      return hubRefresh(t.slice(0, found[0]) + html + t.slice(found[1]), today, file, names);
    }
    t = t.slice(0, found[0]) + t.slice(found[1]);
    [a, b] = hubSection(t, file);
    regions = hubRegions(t, a, b);
    target = pickRegion(regions);
  }
  let from = a, limit = b;
  if (target) {
    from = target.end;
    const next = regions.find(r => r.index > target.index);
    limit = next ? next.index : b;
  }
  const first = t.indexOf(CARD_OPEN, from);
  if (first < 0 || first >= limit) throw fail(target ? `no card was found under "${target.label}"` : "no card was found to place the new one before");
  return hubRefresh(t.slice(0, first) + html + t.slice(first), today, file, names);
}
export function hubRemoveCard(hubText, slug, today) {
  const t = str(hubText);
  const file = hubFileOf(t), eol = eolOf(t);
  const [a, b] = hubSection(t, file);
  const found = findCard(t, `${slug}.html`, a, b, eol, d => anchorError(file, "list of guides", d));
  if (!found) return t;
  return hubRefresh(t.slice(0, found[0]) + t.slice(found[1]), today, file, new Map());
}
export function parseHub(hubText, topicId) {
  const t = str(hubText);
  const id = str(topicId);
  const file = `blog/${id}.html`;
  const crumb = /<nav class="crumbs" aria-label="Breadcrumb">.*<span>(.*?)<\/span><\/nav>/.exec(t);
  if (!crumb) throw anchorError(file, "topic list", "the topic name in the breadcrumb was not found");
  const [a, b] = hubSection(t, file);
  const regions = hubRegions(t, a, b);
  const labels = new Set();
  for (const r of regions) {
    if (labels.has(r.label)) throw anchorError(file, "list of guides", `the group "${r.label}" appears more than once`);
    labels.add(r.label);
  }
  const cards = [];
  for (const m of t.slice(a, b).matchAll(CARD_RE)) {
    const href = m[1];
    const sm = /^([a-z0-9-]+)\.html$/.exec(href);
    const c = cardParts(m[2]);
    const region = regionAt(regions, a + m.index);
    cards.push({ slug: sm ? sm[1] : href.replace(/\.html$/, ""), href, thumbHtml: c.thumbHtml, catHtml: c.catHtml,
      titleHtml: c.titleHtml, summaryHtml: c.summaryHtml, minutes: c.minutes, region: region ? region.label : null });
  }
  return {
    id, file, labelHtml: crumb[1], label: cleanText(plainText(crumb[1])),
    regions: regions.map(r => ({ labelHtml: r.labelHtml, label: r.label })),
    cards
  };
}

// sitemap.xml
export function sitemapSet(text, url, iso) {
  const t = str(text), eol = eolOf(t);
  const loc = `<loc>${url}</loc>`;
  const n = count(t, loc);
  if (n > 1) throw anchorError("sitemap.xml", "list of guides", `${url} is listed ${n} times`);
  if (n === 1) {
    const m = new RegExp(`(<loc>${reEscape(url)}</loc><lastmod>)([^<]*)(</lastmod>)`).exec(t);
    if (!m) throw anchorError("sitemap.xml", "list of guides", `${url} has no date`);
    if (m[2] === iso) return t;
    return t.slice(0, m.index) + m[1] + iso + m[3] + t.slice(m.index + m[0].length);
  }
  const ends = count(t, "</urlset>");
  if (ends !== 1) throw anchorError("sitemap.xml", "sitemap end tag", `found ${ends} times instead of once`);
  const end = t.indexOf("</urlset>");
  return t.slice(0, end) + `  <url><loc>${url}</loc><lastmod>${iso}</lastmod></url>` + eol + t.slice(end);
}
export function sitemapRemove(text, url) {
  const t = str(text);
  const s = t.indexOf(`<url><loc>${url}</loc>`);
  if (s < 0) return t;
  const ls = t.lastIndexOf("\n", s) + 1;
  const nl = t.indexOf("\n", s);
  const le = nl < 0 ? t.length : nl + 1;
  return t.slice(0, ls) + t.slice(le);
}
// Updates the date of a page that is already listed; never adds one.
function sitemapTouch(text, url, iso) {
  return count(text, `<loc>${url}</loc>`) ? sitemapSet(text, url, iso) : text;
}

// feed.xml
function feedItem(item, eol) {
  const url = str(item.url);
  return `<item>${eol}<title>${escXml(cleanText(item.title))}</title>${eol}<link>${url}</link>${eol}` +
    `<guid isPermaLink="true">${url}</guid>${eol}<category>${escXml(cleanText(item.category))}</category>${eol}` +
    `<description>${escXml(cleanText(item.description))}</description>${eol}<pubDate>${rfc822(item.pubIso)}</pubDate>${eol}</item>${eol}`;
}
function feedFind(t, url, eol) {
  const link = `<link>${url}</link>`;
  const n = count(t, link);
  if (!n) return null;
  if (n > 1) throw anchorError("feed.xml", "list of guides", `${url} is listed ${n} times`);
  const p = t.indexOf(link);
  const open = `<item>${eol}`, close = `</item>${eol}`;
  const s = t.lastIndexOf(open, p);
  const e = t.indexOf(close, p);
  if (s < 0 || e < 0 || t.slice(s + open.length, p).includes("<item>") || t.slice(p, e).includes("<item>")) {
    throw anchorError("feed.xml", "list of guides", `the entry for ${url} is not as expected`);
  }
  return [s, e + close.length];
}
function pubIsoOf(block) {
  const m = /<pubDate>[A-Z][a-z]{2}, (\d\d) ([A-Z][a-z]{2}) (\d{4})/.exec(block);
  if (!m || MON3.indexOf(m[2]) < 0) return "";
  return `${m[3]}-${String(MON3.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1]}`;
}
function feedCheckDate(t) {
  const n = count(t, "<lastBuildDate>");
  if (n !== 1 || !/<lastBuildDate>[^<]*<\/lastBuildDate>/.test(t)) throw anchorError("feed.xml", "feed date", `the date line was found ${n} times instead of once`);
}
function feedTouch(t, today) {
  return t.replace(/<lastBuildDate>[^<]*<\/lastBuildDate>/, () => `<lastBuildDate>${rfc822(today)}</lastBuildDate>`);
}
export function feedUpsert(text, item, today) {
  const t = str(text), eol = eolOf(t);
  feedCheckDate(t);
  const html = feedItem(item, eol);
  const found = feedFind(t, str(item.url), eol);
  let out;
  if (found) {
    if (t.slice(found[0], found[1]) === html) return t;
    out = t.slice(0, found[0]) + html + t.slice(found[1]);
  } else {
    let pos = -1;
    const itemRe = new RegExp(`<item>${eol}[\\s\\S]*?</item>${eol}`, "g");
    for (const m of t.matchAll(itemRe)) {
      const pub = pubIsoOf(m[0]);
      if (pub && pub <= str(item.pubIso)) { pos = m.index; break; }
    }
    if (pos < 0) {
      const n = count(t, "</channel>");
      if (n !== 1) throw anchorError("feed.xml", "feed end tag", `found ${n} times instead of once`);
      pos = t.indexOf("</channel>");
    }
    out = t.slice(0, pos) + html + t.slice(pos);
  }
  return feedTouch(out, today);
}
export function feedRemove(text, url, today) {
  const t = str(text), eol = eolOf(t);
  const found = feedFind(t, str(url), eol);
  if (!found) return t;
  feedCheckDate(t);
  return feedTouch(t.slice(0, found[0]) + t.slice(found[1]), today);
}

// llms.txt
const LLMS_SECTIONS = {
  core: ["## Core guides", "## Guides by country of residence"],
  country: ["## Guides by country of residence", "## Company"]
};
const LAST_UPDATED_RE = /^Last updated: \d{4}-\d{2}-\d{2}(?=\r?$)/gm;

function llmsCheckDate(t) {
  const n = (t.match(LAST_UPDATED_RE) || []).length;
  if (n !== 1) throw anchorError("llms.txt", '"Last updated" line', `found ${n} times instead of once`);
}
function llmsTouch(t, today) {
  return t.replace(LAST_UPDATED_RE, () => `Last updated: ${today}`);
}
function lineBounds(t, p, eol) {
  const before = t.lastIndexOf(eol, p);
  const ls = before < 0 ? 0 : before + eol.length;
  const after = t.indexOf(eol, p);
  const le = after < 0 ? t.length : after;
  return [ls, le];
}
function llmsRemoveLine(t, key, eol) {
  const p = t.indexOf(key);
  if (p < 0) return t;
  const [ls, le] = lineBounds(t, p, eol);
  if (ls >= eol.length) return t.slice(0, ls - eol.length) + t.slice(le);
  return t.slice(Math.min(t.length, le + eol.length));        // first line of the file: drop the EOL after it
}
export function llmsUpsert(text, item, today) {
  const t0 = str(text), eol = eolOf(t0);
  const [heading, next] = LLMS_SECTIONS[item && item.section === "country" ? "country" : "core"];
  const url = str(item.url);
  const note = cleanText(item.note).replace(/\.$/, "");
  const line = `- [${mdText(cleanText(item.title))}](${url})` + (note ? `: ${note}` : "");
  llmsCheckDate(t0);
  if (count(t0, `${eol}${heading}${eol}`) !== 1) throw anchorError("llms.txt", `"${heading}" section`, "the heading was not found exactly once");
  if (count(t0, `${eol}${eol}${next}${eol}`) !== 1) throw anchorError("llms.txt", `"${heading}" section`, `the "${next}" heading after it was not found exactly once`);
  const key = `](${url})`;
  const n = count(t0, key);
  if (n > 1) throw anchorError("llms.txt", "list of guides", `${url} is listed ${n} times`);
  let t = t0;
  if (n === 1) {
    const p = t.indexOf(key);
    const [ls, le] = lineBounds(t, p, eol);
    const hs = t.lastIndexOf(eol + "## ", ls);
    const here = hs < 0 ? "" : t.slice(hs + eol.length, t.indexOf(eol, hs + eol.length));
    if (here === heading) {
      if (t.slice(ls, le) === line) return t0;
      return llmsTouch(t.slice(0, ls) + line + t.slice(le), today);
    }
    t = llmsRemoveLine(t, key, eol);
  }
  const end = t.indexOf(`${eol}${eol}${next}${eol}`);
  if (end < 0) throw anchorError("llms.txt", `"${heading}" section`, `the "${next}" heading after it was not found`);
  return llmsTouch(t.slice(0, end) + eol + line + t.slice(end), today);
}
export function llmsRemove(text, url, today) {
  const t = str(text), eol = eolOf(t);
  const key = `](${str(url)})`;
  if (!t.includes(key)) return t;
  llmsCheckDate(t);
  return llmsTouch(llmsRemoveLine(t, key, eol), today);
}

// ---------- Site context ----------

export async function loadSiteContext(snapshot) {
  const paths = new Set(snapshot.list());
  let shell = null, last = "none of the reference guides is on the website";
  for (const g of REFERENCE_GUIDES) {
    if (!paths.has(g)) continue;
    try {
      shell = extractShell(await snapshot.readText(g), g);
      break;
    } catch (e) {
      if (!(e instanceof PlanError)) throw e;
      last = e.reason || e.message;
    }
  }
  if (!shell) throw new PlanError("SHELL", `${SHELL_MSG} (${last})`);

  if (!paths.has("blog.html")) throw blogListError();
  const blogText = await snapshot.readText("blog.html");
  const chips = parseTopics(blogText);
  const guideCards = parseGuideCards(blogText);

  const categories = [], seenCat = new Set();
  const addCats = text => {
    for (const m of text.matchAll(/<span class="post-cat">([\s\S]*?)<\/span><h3>/g)) {
      const c = cleanText(plainText(m[1]));
      if (c && !seenCat.has(c)) { seenCat.add(c); categories.push(c); }
    }
  };
  addCats(blogText);

  const topics = [], hubs = new Map();
  for (const chip of chips) {
    const id = chip.file.slice("blog/".length, -".html".length);
    if (hubs.has(id) || !paths.has(chip.file)) continue;
    const hubText = await snapshot.readText(chip.file);
    const hub = parseHub(hubText, id);
    hubs.set(id, hub);
    topics.push({ id, file: chip.file, href: chip.href, labelHtml: hub.labelHtml, label: hub.label, regions: hub.regions, isCountry: id === COUNTRY_TOPIC });
    addCats(hubText);
  }
  if (!topics.length) throw anchorError("blog.html", "topic list", "no topic page was found");

  const adminSlugs = new Set();
  for (const p of paths) {
    const m = /^admin\/posts\/([a-z0-9-]+)\.json$/.exec(p);
    if (m) adminSlugs.add(m[1]);
  }
  for (const c of guideCards) c.isAdmin = adminSlugs.has(c.slug);
  const sitePages = SITE_PAGES.filter(([href]) => paths.has(pathOfHref(href))).map(([href, label]) => ({ href, labelHtml: escHtml(label), label }));
  const reservedIds = siteIds(shell, paths.has("js/main.js") ? await snapshot.readText("js/main.js") : "");
  return { paths, shell, topics, hubs, guideCards, categories, adminSlugs, sitePages, reservedIds };
}

// ---------- Listings a published post is missing from ----------

// For each post made with the admin, the lists that no longer mention it (for example after blog.html was
// uploaded again from an older copy). posts: [{ slug, post }] from admin/posts/*.json.
export async function findListingGaps(snapshot, ctx, posts) {
  const paths = ctx.paths;
  const textOf = async p => (paths.has(p) ? snapshot.readText(p) : "");
  const blog = await textOf("blog.html");
  const sitemap = await textOf("sitemap.xml");
  const feed = await textOf("feed.xml");
  const llms = await textOf("llms.txt");
  const hubTexts = new Map();
  const out = [];
  for (const entry of arr(posts)) {
    const p = entry && entry.post;
    if (!p || !SLUG_RE.test(str(p.slug)) || p.slug !== entry.slug) continue;
    const slug = p.slug;
    const url = `${SITE}/blog/${slug}.html`;
    const topic = ctx.topics.find(t => t.id === p.topic);
    const missing = [];
    if (!paths.has(`blog/${slug}.html`)) missing.push("page");
    if (!blog.includes(`${CARD_OPEN}blog/${slug}.html">`)) missing.push("blog");
    if (topic) {
      if (!hubTexts.has(topic.file)) hubTexts.set(topic.file, await textOf(topic.file));
      if (!hubTexts.get(topic.file).includes(`${CARD_OPEN}${slug}.html">`)) missing.push("hub");
    }
    if (!sitemap.includes(`<loc>${url}</loc>`)) missing.push("sitemap");
    if (!feed.includes(`<link>${url}</link>`)) missing.push("feed");
    if (!llms.includes(`](${url})`)) missing.push("llms");
    if (missing.length) out.push({ slug, title: cleanText(p.title) || slug, missing });
  }
  return out;
}

// ---------- Commit plan ----------

export function needsShareImage(post, previousPost, snapshot) {
  if (!previousPost) return true;
  if (cleanText(post && post.title) !== cleanText(previousPost.title)) return true;
  const slug = str(previousPost.slug || (post && post.slug));
  return !(snapshot && typeof snapshot.has === "function" && snapshot.has(`images/og-${slug}.png`));
}

function toBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (v && ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return null;
}

const commitTitle = title => cleanText(str(title).replace(/[[\]]/g, "")).slice(0, 100).trimEnd();
const KIND_ORDER = ["post", "blog", "hub", "share-image", "image", "sitemap", "feed", "llms", "post-data"];
const siteHost = SITE.replace(/^https:\/\//, "");

function hubCardCount(text) {
  try {
    const t = str(text);
    const [a, b] = hubSection(t, hubFileOf(t));
    return [...t.slice(a, b).matchAll(CARD_RE)].length;
  } catch {
    return 0;
  }
}

export async function planCommit(input) {
  const { mode, post, today, snapshot, assets } = input || {};
  if (mode !== "create" && mode !== "update" && mode !== "delete") throw new PlanError("BAD_DATA", MSG.postIncomplete);
  if (!isRealIso(today)) throw new PlanError("BAD_DATA", MSG.postIncomplete);
  const ctx = await loadSiteContext(snapshot);
  const slug = str(post && post.slug);
  if (!SLUG_RE.test(slug)) {
    if (mode !== "create") throw new PlanError("NOT_FOUND", mode === "delete" ? MSG.alreadyRemoved : undefined);
    throw new PlanError("VALIDATION", undefined, [{ field: "slug", message: MSG.slugPattern }]);
  }
  const jsonPath = `admin/posts/${slug}.json`;
  const pagePath = `blog/${slug}.html`;
  const pageUrl = `${SITE}/${pagePath}`;
  const ogPath = `images/og-${slug}.png`;
  const imageFileRe = new RegExp(`^images/blog/${reEscape(slug)}-(\\d+)\\.(?:jpg|png|webp)$`);

  // Reads go through one cache; a missing listing file is reported like a missing anchor.
  const texts = new Map();
  const read = async path => {
    if (!texts.has(path)) {
      if (!ctx.paths.has(path)) {
        if (path === "blog.html") throw blogListError();
        throw anchorError(path, "list of guides", "the file is missing");
      }
      texts.set(path, await snapshot.readText(path));
    }
    return texts.get(path);
  };

  const previous = ctx.paths.has(jsonPath) ? postFromJson(await read(jsonPath)) : null;
  let eff = mode;
  if (mode === "create") {
    if (previous) {
      if (previous.id === str(post.id)) eff = "update";
      else throw new PlanError("SLUG_TAKEN");
    } else {
      const problem = slugProblem(slug, ctx, { ownSlug: null });
      if (problem === MSG.slugTaken) throw new PlanError("SLUG_TAKEN");
      if (problem) throw new PlanError("VALIDATION", undefined, [{ field: "slug", message: problem }]);
    }
  } else if (!previous) {
    throw new PlanError("NOT_FOUND", mode === "delete" ? MSG.alreadyRemoved : undefined);
  }

  const newTexts = new Map();          // path -> full new text
  const binaries = [];                 // { path, bytes }
  const deletes = new Set();           // paths to remove (only if present)
  let final = null, built = null, warnings = [];

  const blog0 = await read("blog.html");
  const feed0 = await read("feed.xml");
  const llms0 = await read("llms.txt");
  const sm0 = await read("sitemap.xml");
  const hubTexts = new Map();
  for (const t of ctx.topics) hubTexts.set(t.id, await read(t.file));
  const hubAfter = new Map();

  let blog1, feed1, llms1;
  if (eff === "delete") {
    blog1 = blogRemoveCard(blog0, slug, { countryPart: true });
    for (const t of ctx.topics) hubAfter.set(t.id, withFile(t.file, () => hubRemoveCard(hubTexts.get(t.id), slug, today)));
    feed1 = feedRemove(feed0, pageUrl, today);
    llms1 = llmsRemove(llms0, pageUrl, today);
    deletes.add(pagePath).add(jsonPath).add(ogPath);
    for (const p of ctx.paths) if (imageFileRe.test(p)) deletes.add(p);
  } else {
    // 4. Clean copy of the post
    const src = shapePost(post);
    const id = previous ? previous.id : src.id;
    if (!POST_ID_RE.test(id)) throw new PlanError("BAD_DATA", MSG.postIncomplete);
    const srcBody = dropReservedIds(src.bodyHtml, ctx.reservedIds);
    assertCanonicalBody(srcBody);
    const topic = ctx.topics.find(t => t.id === src.topic.trim()) || null;
    final = shapePost({
      id, slug,
      title: cleanText(src.title), seoTitle: cleanText(src.seoTitle), description: cleanText(src.description),
      topic: src.topic.trim(),
      region: topic && topic.regions.length ? cleanText(src.region) : "",
      card: { category: cleanText(src.card.category), thumb: cleanText(src.card.thumb), summary: cleanText(src.card.summary) },
      lead: { answer: cleanText(src.lead.answer), text: cleanText(src.lead.text) },
      keyPoints: src.keyPoints.map(k => ({ bold: cleanText(k.bold), text: cleanText(k.text) })),
      bodyHtml: assignHeadingIds(srcBody, ctx.reservedIds),
      faq: src.faq.map(f => ({ q: cleanText(f.q), a: cleanText(f.a) })),
      rulesAsOf: src.rulesAsOf,
      published: previous ? previous.published : src.published,
      modified: "",
      images: []
    });

    // Pictures: number new ones after the highest number already used for this post.
    let maxN = 0;
    const bump = path => { const m = imageFileRe.exec(path); if (m) maxN = Math.max(maxN, +m[1]); };
    for (const p of ctx.paths) bump(p);
    if (previous) for (const im of previous.images) bump(im.path);
    const pendingPaths = new Map();
    for (const m of final.bodyHtml.matchAll(PIC_ATTR_RE)) {
      const pm = /^pending:(p[0-9a-f]{8})$/.exec(m[1]);
      if (pm) {
        if (pendingPaths.has(pm[1])) continue;
        const a = assets && assets.images && typeof assets.images.get === "function" ? assets.images.get(pm[1]) : null;
        const bytes = a ? toBytes(a.bytes) : null;
        if (!bytes || !bytes.length || !["jpg", "png", "webp"].includes(a.ext)) throw new PlanError("MISSING_ASSET", MSG.pictureMissing);
        const path = `images/blog/${slug}-${++maxN}.${a.ext}`;
        pendingPaths.set(pm[1], path);
        binaries.push({ path, bytes });
      } else {
        const em = /^\.\.\/(images\/blog\/.+)$/.exec(m[1]);
        if (!em || !imageFileRe.test(em[1]) || !ctx.paths.has(em[1])) throw new PlanError("MISSING_ASSET", MSG.pictureGone);
      }
    }
    final.bodyHtml = final.bodyHtml.replace(/src="pending:(p[0-9a-f]{8})"/g, (m, pid) => `src="../${pendingPaths.get(pid)}"`);
    final.images = [...final.bodyHtml.matchAll(PIC_ATTR_RE)].map(m => ({
      path: m[1].slice(3), alt: plainText(m[2]), width: +m[3], height: +m[4]
    }));
    const keep = new Set(final.images.map(i => i.path));
    for (const p of ctx.paths) if (imageFileRe.test(p) && !keep.has(p)) deletes.add(p);

    // A new post: modified = published. An update: modified = today, unless nothing but that date would change
    // (publishing an unchanged post on a later day must not report an update that did not happen).
    if (!previous) final.modified = final.published;
    else {
      final.modified = previous.modified;
      if (!isRealIso(previous.modified) || postToJson(final) !== postToJson(previous)) final.modified = maxIso(today, final.published);
    }

    const res = validatePost(final, ctx, { mode: eff, today });
    if (res.errors.length) throw new PlanError("VALIDATION", undefined, res.errors);
    warnings = res.warnings;

    // 5. Page
    const oldPage = ctx.paths.has(pagePath) ? await read(pagePath) : null;
    built = buildPostPage(final, ctx, { eol: oldPage !== null ? eolOf(oldPage) : ctx.shell.eol });
    newTexts.set(pagePath, built.html);

    // 6. Listings
    const card = cardData(final, built.readMinutes);
    const isCountry = final.topic === COUNTRY_TOPIC;
    blog1 = blogUpsertCard(blog0, card, isCountry ? final.region : "");
    for (const t of ctx.topics) {
      const h0 = hubTexts.get(t.id);
      hubAfter.set(t.id, withFile(t.file, () => (t.id === final.topic
        ? hubUpsertCard(h0, card, today, t.regions.length ? final.region : "")
        : hubRemoveCard(h0, slug, today))));
    }
    feed1 = feedUpsert(feed0, { title: final.title, url: pageUrl, category: final.card.category, description: final.description, pubIso: final.published }, today);
    // Country lines are named after the country (the card word), as the other lines of that section are.
    llms1 = llmsUpsert(llms0, { title: isCountry && final.card.thumb ? final.card.thumb : final.title, url: pageUrl, note: final.description, section: isCountry ? "country" : "core" }, today);

    // 7. Share picture
    if (needsShareImage(final, previous, snapshot)) {
      const png = toBytes(assets && assets.ogPng);
      if (!png || !png.length) throw new PlanError("MISSING_ASSET");
      binaries.push({ path: ogPath, bytes: png });
    }
    // 8. Saved copy for later editing
    newTexts.set(jsonPath, postToJson(final));
  }

  // Sitemap last: it needs to know which listing pages changed.
  let sm1 = eff === "delete" ? sitemapRemove(sm0, pageUrl) : sitemapSet(sm0, pageUrl, final.modified);
  if (blog1 !== blog0) sm1 = sitemapTouch(sm1, `${SITE}/blog.html`, today);
  for (const t of ctx.topics) if (hubAfter.get(t.id) !== hubTexts.get(t.id)) sm1 = sitemapTouch(sm1, `${SITE}/${t.file}`, today);

  newTexts.set("blog.html", blog1);
  for (const t of ctx.topics) newTexts.set(t.file, hubAfter.get(t.id));
  newTexts.set("feed.xml", feed1);
  newTexts.set("llms.txt", llms1);
  newTexts.set("sitemap.xml", sm1);

  // 9. Real changes only
  const changes = [];
  for (const [path, text] of newTexts) {
    const before = ctx.paths.has(path) ? await read(path) : null;
    if (before !== text) changes.push({ path, text });
  }
  for (const b of binaries) changes.push({ path: b.path, bytes: b.bytes });
  for (const p of deletes) if (ctx.paths.has(p)) changes.push({ path: p, delete: true });
  changes.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));

  // Summary for the confirm screen
  const summary = [];
  const fileAction = c => (c.delete ? "remove" : ctx.paths.has(c.path) ? "update" : "add");
  const hubOrder = [];
  for (const t of ctx.topics) {
    const had = hubTexts.get(t.id).includes(`${CARD_OPEN}${slug}.html">`);
    const has = hubAfter.get(t.id).includes(`${CARD_OPEN}${slug}.html">`);
    hubOrder.push({ t, had, has });
  }
  hubOrder.sort((x, y) => (x.has === y.has ? 0 : x.has ? 1 : -1));
  const byPath = new Map(changes.map(c => [c.path, c]));
  const push = (c, kind, label) => summary.push({ path: c.path, action: fileAction(c), kind, label });
  const removing = eff === "delete";
  for (const kind of KIND_ORDER) {
    if (kind === "post") {
      const c = byPath.get(pagePath);
      if (c) push(c, kind, `${c.delete ? "Page removed" : ctx.paths.has(pagePath) ? "Updated page" : "New page"}: ${siteHost}/${pagePath}`);
    } else if (kind === "blog") {
      const c = byPath.get("blog.html");
      if (c) {
        const was = blogCardPlace(blog0, slug), now = removing ? null : blogCardPlace(blog1, slug);
        const where = pl => (pl.part === "country" ? `under "${pl.region}" in "Guides by country"` : 'at the top of "All guides"');
        const same = was && now && was.part === now.part && was.region === now.region;
        push(c, kind, removing ? "Blog page: card removed" : same ? "Blog page: card updated"
          : was ? `Blog page: card moved ${now.part === "country" ? `to "${now.region}" in "Guides by country"` : 'to the top of "All guides"'}`
            : `Blog page: card added ${where(now || { part: "all" })}`);
      }
    } else if (kind === "hub") {
      for (const { t, had, has } of hubOrder) {
        const c = byPath.get(t.file);
        if (!c) continue;
        const n = hubCardCount(hubAfter.get(t.id));
        const guides = `${n} ${n === 1 ? "guide" : "guides"}`;
        const label = !has ? `Topic page "${t.label}": card removed, now ${guides}`
          : had ? `Topic page "${t.label}": card updated` : `Topic page "${t.label}": card added, now ${guides}`;
        push(c, kind, label);
      }
    } else if (kind === "share-image") {
      const c = byPath.get(ogPath);
      if (c) push(c, kind, c.delete ? "Share picture removed" : ctx.paths.has(ogPath) ? "Share picture for social media: updated" : "Share picture for social media: created");
    } else if (kind === "image") {
      for (const c of changes) {
        if (!imageFileRe.test(c.path)) continue;
        const name = c.path.slice(c.path.lastIndexOf("/") + 1);
        push(c, kind, c.delete ? `Picture removed: ${name}` : `Picture added: ${name}`);
      }
    } else if (kind === "sitemap") {
      const c = byPath.get("sitemap.xml");
      if (c) push(c, kind, removing ? "Sitemap for search engines: page removed"
        : sm0.includes(`<loc>${pageUrl}</loc>`) ? "Sitemap for search engines: date updated" : "Sitemap for search engines: page added");
    } else if (kind === "feed") {
      const c = byPath.get("feed.xml");
      if (c) push(c, kind, removing ? "News feed (RSS): post removed" : feed0.includes(`<link>${pageUrl}</link>`) ? "News feed (RSS): post updated" : "News feed (RSS): post added");
    } else if (kind === "llms") {
      const c = byPath.get("llms.txt");
      if (c) push(c, kind, removing ? "Site summary file (llms.txt): line removed" : llms0.includes(`](${pageUrl})`) ? "Site summary file (llms.txt): line updated" : "Site summary file (llms.txt): line added");
    } else if (kind === "post-data") {
      const c = byPath.get(jsonPath);
      if (c) push(c, kind, c.delete ? "Saved copy for later editing: removed" : previous ? "Saved copy for later editing: updated" : "Saved copy for later editing: created");
    }
  }

  // Things the owner has to do by hand: the by-country topic page and llms.txt state the number of country
  // guides in their text, and the topic page has a tax treaty table; none of that is edited here.
  const notes = [];
  const country = ctx.topics.find(t => t.id === COUNTRY_TOPIC);
  if (country) {
    const o = hubOrder.find(x => x.t.id === COUNTRY_TOPIC);
    if (o && o.had !== o.has) {
      const n = hubCardCount(hubAfter.get(COUNTRY_TOPIC));
      notes.push(`Not changed here: the topic page "${country.label}" and the site summary file (llms.txt) say in their text how many countries are covered, and the topic page has a tax treaty table. After publishing, the topic page lists ${n} ${n === 1 ? "guide" : "guides"}, so update that number and the treaty table by hand if needed.`);
    }
  }

  const titleForMessage = removing ? previous.title : final.title;
  const verb = eff === "create" ? "Add" : eff === "update" ? "Update" : "Remove";
  return {
    mode: eff,
    changes,
    post: final,
    message: `${verb} post: ${commitTitle(titleForMessage)}`,
    summary,
    notes,
    warnings,
    pageUrl,
    pagePath,
    expectedPage: built ? built.html : null
  };
}

// ---------- Putting posts back on the lists ----------

// A snapshot with planned changes applied on top, so several plans can be chained into one commit.
function overlaySnapshot(base, changes) {
  const texts = new Map(), bytes = new Map(), gone = new Set();
  for (const c of changes) {
    if (c.delete) { gone.add(c.path); texts.delete(c.path); bytes.delete(c.path); continue; }
    gone.delete(c.path);
    if (typeof c.text === "string") texts.set(c.path, c.text); else bytes.set(c.path, c.bytes);
  }
  const has = p => !gone.has(p) && (texts.has(p) || bytes.has(p) || base.has(p));
  return {
    has,
    list: () => {
      const s = new Set(base.list());
      for (const p of gone) s.delete(p);
      for (const p of texts.keys()) s.add(p);
      for (const p of bytes.keys()) s.add(p);
      return [...s].sort();
    },
    readText: async p => {
      if (texts.has(p)) return texts.get(p);
      if (!has(p)) throw new PlanError("ANCHOR", `The file ${p} on the website could not be found, so nothing was published.`);
      return base.readText(p);
    },
    readBytes: async p => (bytes.has(p) ? bytes.get(p) : base.readBytes(p))
  };
}

const PLACE_NAMES = { page: "its page", blog: "the Blog page", hub: "its topic page", sitemap: "the sitemap", feed: "the news feed", llms: "llms.txt" };

// Re-publishes the saved copy of each post (an update with no edits), which puts its card and lines back
// where they are missing, as one commit. input: { slugs, today, snapshot, assets: { ogPngs: Map(slug -> png) } }
export async function planRepair(input) {
  const { slugs, today, snapshot, assets } = input || {};
  if (!isRealIso(today)) throw new PlanError("BAD_DATA", MSG.postIncomplete);
  await loadSiteContext(snapshot);               // the same layout checks as any other publish
  let snap = snapshot;
  const all = new Map();
  const titles = [], summary = [], notes = [];
  for (const slug of arr(slugs)) {
    const jsonPath = `admin/posts/${slug}.json`;
    if (!SLUG_RE.test(str(slug)) || !snap.has(jsonPath)) continue;
    const post = postFromJson(await snap.readText(jsonPath));
    const sctx = await loadSiteContext(snap);
    const [gap] = await findListingGaps(snap, sctx, [{ slug, post }]);
    if (!gap) continue;
    const ogPng = assets && assets.ogPngs && typeof assets.ogPngs.get === "function" ? assets.ogPngs.get(slug) : null;
    const plan = await planCommit({ mode: "update", post, today, snapshot: snap, assets: { ogPng, images: new Map() } });
    if (!plan.changes.length) continue;
    for (const c of plan.changes) all.set(c.path, c);
    snap = overlaySnapshot(snap, plan.changes);
    titles.push(cleanText(post.title) || slug);
    summary.push({ path: `blog/${slug}.html`, action: "update", kind: "repair",
      label: `"${cleanText(post.title) || slug}": back on ${gap.missing.map(m => PLACE_NAMES[m] || m).join(", ")}` });
    for (const n of plan.notes) if (!notes.includes(n)) notes.push(n);
  }
  // Only what differs from the website as it is now.
  const changes = [];
  for (const c of all.values()) {
    if (c.delete) { if (snapshot.has(c.path)) changes.push(c); continue; }
    if (typeof c.text === "string" && snapshot.has(c.path) && (await snapshot.readText(c.path)) === c.text) continue;
    changes.push(c);
  }
  changes.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  const message = titles.length === 1 ? `Restore listings: ${commitTitle(titles[0])}` : `Restore listings for ${titles.length} posts`;
  return { mode: "repair", changes, post: null, message, summary, notes, warnings: [], pageUrl: null, pagePath: null, expectedPage: null };
}
