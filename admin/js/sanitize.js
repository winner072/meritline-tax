// Blog admin: allowlist cleaner for the article text.
// Any HTML (editor content, paste from Word or Google Docs, saved text) is parsed into an inert document,
// read into a small block model (headings, paragraphs, lists, note boxes, tables, pictures) and written
// out again as the canonical body markup. Nothing is copied across from the parsed document: no element,
// attribute, style, class or handler survives except what the model writes itself.

// One list of reserved heading ids and invisible characters for the whole admin (kept in generate.js).
import { RESERVED_IDS as RESERVED_ID_LIST, INVISIBLE_RE } from "./generate.js?v=20261116";

export const EXTERNAL_LINKS_NEW_TAB = false;

const RESERVED_IDS = new Set(RESERVED_ID_LIST);
const ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SRC_RE = /^\.\.\/images\/blog\/[a-z0-9-]+-\d+\.(?:jpg|png|webp)$/;
const PENDING_ID_RE = /^p[0-9a-f]{8}$/;
const SIZE_RE = /^[1-9]\d{0,5}$/;
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// Removed together with everything inside them.
const DROP = new Set(["script", "style", "template", "noscript", "iframe", "frame", "frameset", "object", "embed",
  "applet", "form", "input", "button", "select", "textarea", "option", "optgroup", "datalist", "svg", "math", "canvas",
  "video", "audio", "source", "track", "map", "area", "meta", "link", "title", "head", "base", "param"]);
// Block-level elements that are unwrapped: they only end the current paragraph.
const UNWRAP_BLOCK = new Set(["div", "section", "article", "header", "footer", "main", "aside", "nav", "figure",
  "center", "address", "details", "summary", "fieldset", "legend", "hgroup", "menu", "hr", "dl", "body", "html",
  "thead", "tbody", "tfoot", "tr", "td", "th"]);
// Elements whose text becomes a paragraph of its own.
const PARA = new Set(["p", "dt", "dd", "pre", "figcaption", "caption", "li"]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const BOUNDARY = new Set([...UNWRAP_BLOCK, ...PARA, ...HEADINGS, "ul", "ol", "blockquote", "table"]);

const F0 = Object.freeze({ b: false, i: false, href: null });

const str = v => (v === null || v === undefined ? "" : String(v));
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escA = s => esc(s).replace(/"/g, "&quot;");

export function cleanText(s) {
  return str(s).replace(LONE_SURROGATE_RE, "").normalize("NFC").replace(INVISIBLE_RE, "")
    .replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

// Cleans a raw text node without collapsing or trimming (that happens per block, across runs).
function cleanRaw(s) {
  return str(s).replace(LONE_SURROGATE_RE, "").replace(INVISIBLE_RE, "").replace(/\u00a0/g, " ").normalize("NFC");
}

export function normalizeHref(raw) {
  try {
    if (typeof raw !== "string") return null;
    const h = raw.trim();
    if (!h || h.length > 2000) return null;
    if (/[\s"<>\\\u0000-\u001f\u007f-\u009f]/.test(h)) return null;
    if (/^#[a-z0-9][a-z0-9-]*$/.test(h)) return h;
    if (/^[a-z0-9-]+\.html(?:#[a-z0-9-]+)?$/.test(h)) return h;
    if (/^\.\.\/(?:[a-z0-9-]+\.html)?(?:#[a-z0-9-]+)?$/.test(h)) return h;
    let url;
    try { url = new URL(h); } catch { return null; }
    if (url.protocol === "mailto:") return /^mailto:[^@\s]+@[^@\s]+$/.test(h) ? h : null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host === "meritlinetaxservices.com" || host === "www.meritlinetaxservices.com") {
      // Links to this website are written the way the guides write them: relative to the blog folder.
      if (url.search || url.port) return null;
      const hash = url.hash;
      if (hash && !/^#[a-z0-9-]+$/.test(hash)) return null;
      let m = /^\/blog\/([a-z0-9-]+\.html)$/.exec(url.pathname);
      if (m) return m[1] + hash;
      m = /^\/([a-z0-9-]+\.html)$/.exec(url.pathname);
      if (m) return "../" + m[1] + hash;
      if (url.pathname === "/") return "../" + hash;
      return null;
    }
    const out = url.href;
    if (out.length > 2000 || /[\s"<>\\]/.test(out)) return null;
    return out;
  } catch {
    return null;
  }
}

// ---------- Reading HTML into the block model ----------

function tagOf(el) {
  return str(el.localName).toLowerCase();
}
function isDropped(el, tag) {
  if (DROP.has(tag)) return true;
  if (el.hasAttribute("hidden")) return true;
  const st = el.getAttribute("style");
  return !!st && /display\s*:\s*none|mso-hide\s*:\s*all|visibility\s*:\s*hidden|mso-list\s*:\s*ignore/i.test(st);
}
function hasClass(el, name) {
  return (" " + str(el.getAttribute("class")).replace(/\s+/g, " ") + " ").includes(" " + name + " ");
}
// Value of one CSS property in a style attribute, matched on the whole property name (so Word's
// mso-bidi-font-weight is not read as font-weight). The last declaration wins, as in CSS.
function styleProp(st, name) {
  let val = "";
  for (const decl of st.split(";")) {
    const k = decl.indexOf(":");
    if (k > 0 && decl.slice(0, k).trim().toLowerCase() === name) val = decl.slice(k + 1).trim().toLowerCase();
  }
  return val;
}
function fmtFor(el, tag, f) {
  let { b, i, href } = f;
  const st = str(el.getAttribute("style"));
  const fw = st ? styleProp(st, "font-weight") : "";
  const fs = st ? styleProp(st, "font-style") : "";
  if (tag === "b" || tag === "strong") {
    if (!/^(?:normal|lighter|[1-5]00)\b/.test(fw)) b = true;
  } else if (tag === "i" || tag === "em") {
    if (!/^normal\b/.test(fs)) i = true;
  } else if (st) {
    const w = /^(bold|bolder|normal|lighter|\d{3})\b/.exec(fw);
    if (w) {
      const v = w[1];
      b = v === "bold" || v === "bolder" || (/^\d+$/.test(v) && +v >= 600);
    }
    const s = /^(italic|oblique|normal)\b/.exec(fs);
    if (s) i = s[1] !== "normal";
  }
  if (tag === "a") href = normalizeHref(el.getAttribute("href"));
  return b === f.b && i === f.i && href === f.href ? f : { b, i, href };
}
const run = (text, f) => ({ text, b: f.b, i: f.i, href: f.href });

// Collapses whitespace across runs, trims the block, gives each space only the formatting that keeps it
// inside its neighbours' elements (so no link, strong or em starts or ends with a space) and merges equal
// neighbours. Nesting is a > strong > em, so a space is bold only when both sides share the link, and
// italic only when both sides also share the bold.
function normRuns(runs) {
  const segs = [];
  for (const r of runs) {
    for (const piece of r.text.replace(/\s+/g, " ").split(/( )/)) {
      if (piece === "") continue;
      if (piece === " ") {
        if (segs.length && segs[segs.length - 1].sp) continue;
        segs.push({ sp: true });
      } else {
        segs.push({ sp: false, text: piece, b: r.b, i: r.i, href: r.href });
      }
    }
  }
  while (segs.length && segs[0].sp) segs.shift();
  while (segs.length && segs[segs.length - 1].sp) segs.pop();
  const out = [];
  for (let k = 0; k < segs.length; k++) {
    let s = segs[k];
    if (s.sp) {
      const a = segs[k - 1], c = segs[k + 1];
      const sameLink = a.href === c.href;
      const b = sameLink && a.b && c.b;
      s = { text: " ", b, i: sameLink && a.b === c.b && a.i && c.i, href: sameLink ? a.href : null };
    }
    const last = out[out.length - 1];
    if (last && last.b === s.b && last.i === s.i && last.href === s.href) last.text += s.text;
    else out.push({ text: s.text, b: s.b, i: s.i, href: s.href });
  }
  return out;
}
const plainOf = runs => normRuns(runs).map(r => r.text).join("");

function picOf(el) {
  const pend = el.getAttribute("data-pending");
  let src = null;
  if (pend && PENDING_ID_RE.test(pend)) src = "pending:" + pend;
  else {
    const s = str(el.getAttribute("src")).trim();
    if (SRC_RE.test(s) || /^pending:p[0-9a-f]{8}$/.test(s)) src = s;
  }
  if (!src) return null;
  const w = str(el.getAttribute("width")).trim(), h = str(el.getAttribute("height")).trim();
  if (!SIZE_RE.test(w) || !SIZE_RE.test(h)) return null;
  return { t: "pic", src, alt: cleanText(el.getAttribute("alt")), width: +w, height: +h };
}

function isWordListPara(el) {
  const cls = str(el.getAttribute("class"));
  const st = str(el.getAttribute("style"));
  return /(?:^|\s)MsoListParagraph/i.test(cls) || (/mso-list\s*:/i.test(st) && !/mso-list\s*:\s*ignore/i.test(st));
}

function toBlocks(html) {
  const doc = new DOMParser().parseFromString("<!doctype html><body>" + str(html), "text/html");
  const blocks = [];
  let para = null;
  // Pictures found inside a heading, list, note box or table are placed right after that block.
  let held = [];
  const holdPic = el => { const p = picOf(el); if (p) held.push(p); };
  const flushPics = () => { if (held.length) { blocks.push(...held); held = []; } };

  const endP = () => {
    if (para) {
      const runs = normRuns(para);
      if (runs.length) blocks.push({ t: "p", runs });
    }
    para = null;
  };

  // Inline walk used inside headings, list items and table cells: block boundaries become spaces.
  function inline(node, f, sink) {
    for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
      if (ch.nodeType === 3) { sink.text(cleanRaw(ch.data), f); continue; }
      if (ch.nodeType !== 1) continue;
      const tag = tagOf(ch);
      if (isDropped(ch, tag)) continue;
      if (tag === "br") { sink.space(); continue; }
      if (tag === "img") { holdPic(ch); continue; }
      const ff = fmtFor(ch, tag, f);
      if ((tag === "ul" || tag === "ol") && sink.list) { sink.list(ch, ff); continue; }
      if (tag === "li" && sink.item) { sink.item(ch, ff); continue; }
      if (BOUNDARY.has(tag)) { sink.space(); inline(ch, ff, sink); sink.space(); continue; }
      inline(ch, ff, sink);
    }
  }
  const runSink = runs => ({ text: (t, f) => runs.push(run(t, f)), space: () => runs.push(run(" ", F0)) });

  // Lists: nested lists are flattened into the list they appear in.
  function endItem(L) {
    if (L.cur) {
      const runs = normRuns(L.cur);
      if (runs.length) L.items.push(runs);
    }
    L.cur = null;
  }
  function itemSink(L) {
    return {
      text: (t, f) => {
        if (!L.cur) { if (!/\S/.test(t)) return; L.cur = []; }
        L.cur.push(run(t, f));
      },
      space: () => { if (L.cur) L.cur.push(run(" ", F0)); },
      list: (el, f) => { endItem(L); list(el, f, L); },
      item: (el, f) => { endItem(L); inline(el, f, itemSink(L)); endItem(L); }
    };
  }
  function list(el, f, L) {
    const sink = itemSink(L);
    for (let ch = el.firstChild; ch; ch = ch.nextSibling) {
      if (ch.nodeType === 3) { sink.text(cleanRaw(ch.data), f); continue; }
      if (ch.nodeType !== 1) continue;
      const tag = tagOf(ch);
      if (isDropped(ch, tag)) continue;
      if (tag === "img") { holdPic(ch); continue; }
      const ff = fmtFor(ch, tag, f);
      if (tag === "li") sink.item(ch, ff);
      else if (tag === "ul" || tag === "ol") sink.list(ch, ff);
      else inline(ch, ff, sink);
    }
  }
  function finishList(L) {
    endItem(L);
    if (L.items.length) blocks.push({ t: L.t, items: L.items });
  }

  // Word lists: consecutive "MsoListParagraph" paragraphs become one list. Returns the last node used.
  function wordList(first, f) {
    const items = [];
    let last = first;
    for (let s = first; s; s = s.nextSibling) {
      if (s.nodeType === 1) {
        const tag = tagOf(s);
        if (tag === "p" && !isDropped(s, tag) && isWordListPara(s)) { items.push(s); last = s; continue; }
        break;
      }
      if (s.nodeType === 3 && /\S/.test(cleanRaw(s.data))) break;
    }
    const markerEl = [...items[0].querySelectorAll("[style]")].find(e => /mso-list\s*:\s*ignore/i.test(e.getAttribute("style")));
    const marker = markerEl ? str(markerEl.textContent) : "";
    const L = { t: /^\s*(?:\d+|[a-zA-Z]|[ivxlcdm]+)[.)]/.test(marker) ? "ol" : "ul", items: [], cur: null };
    for (const p of items) {
      endItem(L);
      inline(p, fmtFor(p, "p", f), itemSink(L));
      endItem(L);
    }
    finishList(L);
    return last;
  }

  // Note boxes: every block inside becomes a paragraph of the box.
  function note(el, f) {
    const N = { paras: [], cur: null };
    const endNP = () => {
      if (N.cur) {
        const runs = normRuns(N.cur);
        if (runs.length) N.paras.push(runs);
      }
      N.cur = null;
    };
    const walk = (node, ff) => {
      for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
        if (ch.nodeType === 3) {
          const t = cleanRaw(ch.data);
          if (!N.cur) { if (!/\S/.test(t)) continue; N.cur = []; }
          N.cur.push(run(t, ff));
          continue;
        }
        if (ch.nodeType !== 1) continue;
        const tag = tagOf(ch);
        if (isDropped(ch, tag)) continue;
        if (tag === "img") { holdPic(ch); continue; }
        if (tag === "br") { endNP(); continue; }
        const f2 = fmtFor(ch, tag, ff);
        if (BOUNDARY.has(tag)) { endNP(); walk(ch, f2); endNP(); continue; }
        walk(ch, f2);
      }
    };
    walk(el, f);
    endNP();
    if (N.paras.length) blocks.push({ t: "note", paras: N.paras });
  }

  // Tables: simple ones stay tables (first row is the header); others become one paragraph per row.
  function table(el, f) {
    const rows = [], captions = [];
    let headRow = null;
    const collect = (parent, inHead) => {
      for (const c of parent.children) {
        const tag = tagOf(c);
        if (isDropped(c, tag)) continue;
        if (tag === "tr") { rows.push(c); if (inHead && !headRow) headRow = c; }
        else if (tag === "thead") collect(c, true);
        else if (tag === "tbody" || tag === "tfoot") collect(c, false);
        else if (tag === "caption") captions.push(c);
      }
    };
    collect(el, false);
    for (const c of captions) { endP(); flow(c, fmtFor(c, "caption", f)); endP(); }
    if (!headRow) headRow = rows[0] || null;
    const cellsOf = tr => [...tr.children].filter(c => { const t = tagOf(c); return (t === "td" || t === "th") && !isDropped(c, t); });
    const span = c => parseInt(str(c.getAttribute("colspan")) || "1", 10) > 1 || parseInt(str(c.getAttribute("rowspan")) || "1", 10) > 1;
    const cellRuns = c => { const runs = []; inline(c, fmtFor(c, tagOf(c), f), runSink(runs)); return normRuns(runs); };
    const nested = !!el.querySelector("table");
    const headCells = headRow ? cellsOf(headRow) : [];
    if (!nested && headCells.length >= 1 && headCells.length <= 8 && !rows.some(tr => cellsOf(tr).some(span))) {
      const head = headCells.map(c => cellRuns(c).map(r => r.text).join(""));
      const body = [];
      for (const tr of rows) {
        if (tr === headRow) continue;
        const cells = cellsOf(tr).slice(0, head.length).map(cellRuns);
        while (cells.length < head.length) cells.push([]);
        if (cells.some(r => r.length)) body.push(cells);
      }
      if (body.length) { blocks.push({ t: "table", head, rows: body }); return; }
    }
    for (const tr of rows) {
      const parts = cellsOf(tr).map(cellRuns).filter(r => r.length);
      if (!parts.length) continue;
      const runs = [];
      parts.forEach((r, k) => { if (k) runs.push(run("; ", F0)); runs.push(...r); });
      const n = normRuns(runs);
      if (n.length) blocks.push({ t: "p", runs: n });
    }
  }

  function heading(el, tag, f) {
    const runs = [];
    inline(el, f, runSink(runs));
    const text = plainOf(runs);
    if (!text) return;
    const id = tag === "h2" ? str(el.getAttribute("id")) : "";
    const level = tag === "h1" || tag === "h2" ? "h2" : "h3";
    blocks.push({ t: level, id: level === "h2" && ID_RE.test(id) && !RESERVED_IDS.has(id) ? id : null, text });
  }

  // Top-level flow.
  function flow(node, f) {
    for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
      if (ch.nodeType === 3) {
        const t = cleanRaw(ch.data);
        if (!para) { if (!/\S/.test(t)) continue; para = []; }
        para.push(run(t, f));
        continue;
      }
      if (ch.nodeType !== 1) continue;
      const el = ch, tag = tagOf(el);
      if (isDropped(el, tag)) continue;
      if (tag === "br") { endP(); continue; }
      if (tag === "img") {
        endP();
        const pic = picOf(el);
        if (pic) blocks.push(pic);
        continue;
      }
      if (HEADINGS.has(tag)) { endP(); heading(el, tag, F0); flushPics(); continue; }
      const ff = fmtFor(el, tag, f);
      if (tag === "ul" || tag === "ol") {
        endP();
        const L = { t: tag, items: [], cur: null };
        list(el, ff, L);
        finishList(L);
        flushPics();
        continue;
      }
      if (tag === "table") { endP(); table(el, ff); flushPics(); continue; }
      if (tag === "blockquote" || (tag === "div" && hasClass(el, "callout"))) { endP(); note(el, ff); flushPics(); continue; }
      if (tag === "p" && isWordListPara(el)) { endP(); ch = wordList(el, f); flushPics(); continue; }
      if (PARA.has(tag) || UNWRAP_BLOCK.has(tag)) { endP(); flow(el, ff); endP(); continue; }
      flow(el, ff);
    }
  }

  flow(doc.body, F0);
  endP();
  return blocks;
}

// ---------- Writing the model ----------

function newTab(href) {
  return EXTERNAL_LINKS_NEW_TAB && /^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : "";
}
function groupBy(runs, key, render) {
  let out = "";
  for (let k = 0; k < runs.length;) {
    const v = runs[k][key];
    let j = k;
    while (j < runs.length && runs[j][key] === v) j++;
    out += render(v, runs.slice(k, j));
    k = j;
  }
  return out;
}
// Nesting order is always a > strong > em.
function renderInline(runs) {
  return groupBy(runs, "href", (href, g1) => {
    const inner = groupBy(g1, "b", (b, g2) => {
      const t = groupBy(g2, "i", (i, g3) => {
        const s = esc(g3.map(r => r.text).join(""));
        return i ? `<em>${s}</em>` : s;
      });
      return b ? `<strong>${t}</strong>` : t;
    });
    return href ? `<a href="${escA(href)}"${newTab(href)}>${inner}</a>` : inner;
  });
}
// A numbered-list item that opens with a bold run followed by more text: the bold run is the step title.
function olItem(runs) {
  const r0 = runs[0];
  if (runs.length > 1 && r0.b && !r0.i && !r0.href && !runs[1].b) {
    const rest = runs.slice(1).map(r => ({ ...r }));
    rest[0].text = rest[0].text.replace(/^ /, "");
    if (!rest[0].text) rest.shift();
    if (rest.length) return { title: r0.text, rest };
  }
  return { title: null, rest: runs };
}
function picHtml(b) {
  return `<p><img src="${escA(b.src)}" alt="${escA(b.alt)}" width="${b.width}" height="${b.height}" loading="lazy" decoding="async" style="height:auto"></p>`;
}

function renderCanonical(blocks) {
  let out = "";
  blocks.forEach((b, k) => {
    let s = "";
    if (b.t === "h2") s = `<h2${b.id ? ` id="${b.id}"` : ""}>${esc(b.text)}</h2>`;
    else if (b.t === "h3") s = `<h3>${esc(b.text)}</h3>`;
    else if (b.t === "p") s = `<p>${renderInline(b.runs)}</p>`;
    else if (b.t === "ul") s = "<ul>" + b.items.map(r => `\n  <li>${renderInline(r)}</li>`).join("") + "\n</ul>";
    else if (b.t === "ol") {
      s = '<ol class="steps-list">' + b.items.map(r => {
        const x = olItem(r);
        return `\n  <li><div>${x.title !== null ? `<b>${esc(x.title)}</b>` : ""}${renderInline(x.rest)}</div></li>`;
      }).join("") + "\n</ol>";
    } else if (b.t === "note") s = '<div class="callout">' + b.paras.map(r => `<p>${renderInline(r)}</p>`).join("") + "</div>";
    else if (b.t === "table") {
      s = '<div class="tbl">\n  <table>\n    <thead><tr>' + b.head.map(h => `<th>${esc(h)}</th>`).join("") + "</tr></thead>\n    <tbody>" +
        b.rows.map(r => "\n      <tr>" + r.map((c, n) => `<td data-label="${escA(b.head[n])}">${renderInline(c)}</td>`).join("") + "</tr>").join("") +
        "\n    </tbody>\n  </table>\n</div>";
    } else if (b.t === "pic") s = picHtml(b);
    out += (k === 0 ? "" : b.t === "h2" ? "\n\n" : "\n") + s;
  });
  return out;
}

function renderEditable(blocks) {
  return blocks.map(b => {
    if (b.t === "h2") return `<h2${b.id ? ` id="${b.id}"` : ""}>${esc(b.text)}</h2>`;
    if (b.t === "h3") return `<h3>${esc(b.text)}</h3>`;
    if (b.t === "p") return `<p>${renderInline(b.runs)}</p>`;
    if (b.t === "ul") return "<ul>" + b.items.map(r => `<li>${renderInline(r)}</li>`).join("") + "</ul>";
    if (b.t === "ol") {
      return "<ol>" + b.items.map(r => {
        const x = olItem(r);
        return `<li>${x.title !== null ? `<strong>${esc(x.title)}</strong> ` : ""}${renderInline(x.rest)}</li>`;
      }).join("") + "</ol>";
    }
    if (b.t === "note") return "<blockquote>" + b.paras.map(r => `<p>${renderInline(r)}</p>`).join("") + "</blockquote>";
    if (b.t === "table") {
      return "<table><thead><tr>" + b.head.map(h => `<th>${h ? esc(h) : "<br>"}</th>`).join("") + "</tr></thead><tbody>" +
        b.rows.map(r => "<tr>" + r.map(c => `<td>${c.length ? renderInline(c) : "<br>"}</td>`).join("") + "</tr>").join("") +
        "</tbody></table>";
    }
    if (b.t === "pic") return picHtml(b);
    return "";
  }).join("");
}

// ---------- Public API ----------

export function sanitizeToCanonical(html) {
  try {
    return renderCanonical(toBlocks(html));
  } catch {
    return "";
  }
}

export function canonicalToEditable(canonical) {
  try {
    return renderEditable(toBlocks(canonical));
  } catch {
    return "";
  }
}

export function cleanPastedHtml(html) {
  return canonicalToEditable(sanitizeToCanonical(html));
}

export function textToEditableHtml(text) {
  try {
    return str(text).replace(/\r\n?/g, "\n").split(/\n\s*\n/)
      .map(p => cleanText(p)).filter(Boolean)
      .map(p => `<p>${esc(p)}</p>`).join("");
  } catch {
    return "";
  }
}
