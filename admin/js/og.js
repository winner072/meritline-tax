// Share picture (1200 x 630 PNG) for a post. The card is laid out in a hidden copy of the site's share-card
// template (inside a shadow root, so the admin page's CSS cannot reach it), which lets the browser's own line
// breaking, text-wrap: balance and font metrics choose the font size and the lines. The result is then painted
// on a <canvas> and encoded as PNG. The geometry matches the existing images/og-*.png pictures.
//
// ogHeadlineHtml is pure and safe to import anywhere; the rendering functions need a browser document.

const FAMILY = "MeritlineShareFigtree";       // private family name, isolated from page CSS
const RANGE_LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const RANGE_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF";
const W = 1200, H = 630, INK = "#0B1220", INK2 = "#4A5565", LINE = "#D5DAE1";
const MAX_FS = 80, MIN_FS = 40, MAX_LINES = 4, MIN_GAP = 64;
const FAIL_MSG = "The share picture could not be made in this browser.";

// ---------- Headline preparation (pure) ----------

const NBSP = "\u00a0";
const MARK = String.fromCharCode(0);
const decode = s => s.replace(/&nbsp;/g, NBSP)
  .replace(/&#(\d+);/g, (all, n) => safeCodePoint(+n, all))
  .replace(/&#x([0-9a-f]+);/gi, (all, n) => safeCodePoint(parseInt(n, 16), all))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function safeCodePoint(n, fallback) {
  try { return String.fromCodePoint(n); } catch { return fallback; }
}

// Turns the page H1 inner HTML (typeset text) into the headline markup of the share card: text, &nbsp; and
// <span class="nw"> only, with the card's line-break ties added.
export function ogHeadlineHtml(h1Html) {
  const h = String(h1Html === null || h1Html === undefined ? "" : h1Html).replace(/\s+/g, " ").trim();
  const res = []; const stack = []; let pos = 0;
  const re = /<(\/?)([a-zA-Z0-9]+)([^>]*)>/g; let m;
  const text = t => res.push(esc(decode(t)).replace(/\u00a0/g, "&nbsp;"));
  while ((m = re.exec(h))) {
    text(h.slice(pos, m.index)); pos = re.lastIndex;
    const closing = m[1], tag = m[2].toLowerCase(), attrs = m[3];
    if (tag !== "span") continue;                                  // every other tag is dropped, its text kept
    if (!closing && /class="[^"]*\bnw\b/.test(attrs)) { stack.push("nw"); res.push('<span class="nw">'); }
    else if (!closing) stack.push("plain");
    else if (stack.length && stack.pop() === "nw") res.push("</span>");
  }
  text(h.slice(pos));
  let out = res.join("").trim();
  out = out.replace(/(^|\s)([AaI]) (?=\S)/g, "$1$2&nbsp;");      // one-letter words stay with the next word
  const P = '<span class="nw">', Q = "<span" + MARK + 'class="nw">';
  out = out.split(P).join(Q);
  out = out.replace(/ ([A-Za-z0-9.]{1,4}[?:])(?=\s|$)/g, "&nbsp;$1");   // short word before ? or : stays with the previous word
  out = out.replace(/(^|[\s;])([A-Za-z]{2}) (?=\S)/g, "$1$2&nbsp;");   // two-letter words never end a line
  const k = out.lastIndexOf(" "); if (k > -1) out = out.slice(0, k) + "&nbsp;" + out.slice(k + 1);   // last two words together
  return out.split(Q).join(P);
}

// ---------- Assets (fonts and icon, loaded once) ----------

let assetsReady = null;
// sources: { latin, latinExt, icon } as URL strings or ArrayBuffers.
function loadAssets(src) {
  if (!assetsReady) {
    assetsReady = (async () => {
      const buf = async s => {
        if (typeof s !== "string") return s;
        const r = await fetch(s);
        if (!r.ok) throw new Error(FAIL_MSG);
        return r.arrayBuffer();
      };
      const faces = [new FontFace(FAMILY, await buf(src.latinExt), { weight: "300 900", unicodeRange: RANGE_EXT }),
                     new FontFace(FAMILY, await buf(src.latin), { weight: "300 900", unicodeRange: RANGE_LATIN })];
      for (const f of faces) { await f.load(); document.fonts.add(f); }
      await document.fonts.load(`700 80px "${FAMILY}"`, "Form 5472 \u2013\u00fc"); await document.fonts.load(`500 22px "${FAMILY}"`, "m");
      const iconBlob = new Blob([await buf(src.icon)], { type: "image/png" });
      const icon = await createImageBitmap(iconBlob, { resizeWidth: 60, resizeHeight: 60, resizeQuality: "high" });
      return { icon, iconUrl: URL.createObjectURL(iconBlob) };
    })();
    assetsReady.catch(() => { assetsReady = null; });            // a failed load is tried again next time
  }
  return assetsReady;
}

// ---------- Layout ----------

// Same structure and CSS as the template, inside a shadow root so the admin page's own CSS cannot reach it.
function buildCard(iconUrl) {
  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;left:-30000px;top:0;width:1200px;height:630px;visibility:hidden;pointer-events:none;contain:strict";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
:host{all:initial}
*{box-sizing:border-box}
.card{position:absolute;left:0;top:0;width:1200px;height:630px;padding:68px 88px 56px;display:flex;flex-direction:column;background:#fff;
  font-family:"${FAMILY}",sans-serif;color:${INK};-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.rule{flex:0 0 auto;height:2px;background:${INK};width:100%}
.head{flex:1 1 auto;min-height:0;padding-top:34px;position:relative}
h1{margin:0;font-weight:700;line-height:1.08;letter-spacing:-0.005em;color:${INK};text-wrap:balance;font-kerning:normal;max-width:100%}
h1 .nw{white-space:nowrap;font:inherit;color:inherit}
.foot{flex:0 0 auto;display:flex;align-items:center;gap:18px;padding-top:24px;border-top:1px solid ${LINE}}
.foot img{width:60px;height:60px;display:block;flex:0 0 auto}
.name{font-size:26px;font-weight:700;line-height:1.2;color:${INK2}}
.url{font-size:22px;font-weight:500;line-height:1.25;color:${INK2};margin-top:2px}
.probe{position:absolute;left:88px;top:0;text-wrap:nowrap;white-space:nowrap}
.pz{display:inline-block;width:0;height:0}
</style><div class="card"><div class="rule"></div><div class="head"><h1 class="hl"></h1></div><div class="foot"><img alt="" src="${iconUrl}"><div class="txt"><div class="name">Meritline Tax Services<span class="pz pn"></span></div><div class="url">meritlinetaxservices.com<span class="pz pu"></span></div></div></div><h1 class="probe">X<span class="pz pb"></span></h1></div>`;
  document.body.appendChild(host);
  const q = sel => root.querySelector(sel);
  return { host, card: q(".card"), head: q(".head"), h1: q(".hl"), foot: q(".foot"), icon: q(".foot img"), txt: q(".txt"), pn: q(".pn"), pu: q(".pu"), probe: q(".probe"), pb: q(".pb") };
}

// Puts the headline markup into the card's H1. The markup is read in an inert document and only text and
// <span class="nw"> are rebuilt, which gives the same nodes as the template without copying anything else.
function setHeadline(h1, headlineHtml) {
  const doc = new DOMParser().parseFromString("<!doctype html><body>" + String(headlineHtml || ""), "text/html");
  const copy = (from, to) => {
    for (let n = from.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) to.appendChild(document.createTextNode(n.data));
      else if (n.nodeType === 1) {
        const tag = n.localName;
        if (tag === "script" || tag === "style" || tag === "template") continue;
        if (tag === "span" && n.classList.contains("nw")) {
          const s = document.createElement("span");
          s.className = "nw";
          copy(n, s);
          to.appendChild(s);
        } else copy(n, to);
      }
    }
  };
  const frag = document.createDocumentFragment();
  copy(doc.body, frag);
  h1.replaceChildren(frag);
}

function lineBoxes(el) {
  const r = document.createRange(); r.selectNodeContents(el);
  const lines = [];
  for (const x of [...r.getClientRects()].filter(x => x.width > 0.5)) {
    const l = lines.find(L => Math.abs(L.top - x.top) < x.height * 0.5);
    if (!l) lines.push({ top: x.top, left: x.left, right: x.right });
    else { l.left = Math.min(l.left, x.left); l.right = Math.max(l.right, x.right); }
  }
  return lines.sort((a, b) => a.top - b.top);
}

// Font-size loop of the template: largest size from 80 down that fits in 4 lines,
// with 64px kept free above the footer rule and nothing wider than the column.
function fit(c) {
  const availH = c.head.getBoundingClientRect().height - 34;
  for (let fs = MAX_FS; fs >= MIN_FS; fs--) {
    c.h1.style.fontSize = fs + "px";
    const b = c.h1.getBoundingClientRect(), lines = lineBoxes(c.h1);
    const overflowX = Math.max(...lines.map(l => l.right)) > b.right + 0.5 || c.h1.scrollWidth > c.h1.clientWidth + 1;
    const overflowY = b.height > availH - MIN_GAP + 0.5;
    if (!overflowX && !overflowY && lines.length <= MAX_LINES) return { fs, fits: true };
  }
  c.h1.style.fontSize = MIN_FS + "px";
  return { fs: MIN_FS, fits: false };
}

// Text of each visual line (one Range per character), with its top and left.
function splitLines(h1) {
  const out = []; let cur = null; const r = document.createRange();
  const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    for (let i = 0; i < n.data.length; i++) {
      r.setStart(n, i); r.setEnd(n, i + 1);
      const rs = r.getClientRects(), rc = rs.length ? rs[rs.length - 1] : null;
      if (!rc || (rc.width === 0 && n.data[i] === " ")) { if (cur) cur.text += n.data[i]; continue; }
      if (!cur || Math.abs(rc.top - cur.top) > rc.height * 0.5) { cur = { top: rc.top, left: rc.left, text: "" }; out.push(cur); }
      cur.text += n.data[i];
    }
  }
  return out.map(l => ({ ...l, text: l.text.replace(/^ +| +$/g, "") }));
}

function pngBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error(FAIL_MSG)); return; }
      blob.arrayBuffer().then(ab => resolve(new Uint8Array(ab)), reject);
    }, "image/png");
  });
}

// ---------- Public API ----------

// h1Html: the post title as typeset HTML (typesetText(post.title)).
export async function renderShareImage(h1Html, sources) {
  return renderPreparedHeadline(ogHeadlineHtml(h1Html), sources);
}

// headlineHtml: output of ogHeadlineHtml() (text, &nbsp; and <span class="nw"> only).
export async function renderPreparedHeadline(headlineHtml, sources) {
  let assets;
  try {
    assets = await loadAssets(sources || {});
  } catch {
    throw new Error(FAIL_MSG);
  }
  let c = null;
  try {
    c = buildCard(assets.iconUrl);
    if (!c.icon.complete) await new Promise(r => { c.icon.onload = c.icon.onerror = r; });
    setHeadline(c.h1, headlineHtml);
    const { fs, fits } = fit(c);
    const lines = splitLines(c.h1);
    const card = c.card.getBoundingClientRect(), h1r = c.h1.getBoundingClientRect();
    c.probe.style.fontSize = fs + "px";
    const baseOffset = c.pb.getBoundingClientRect().top - c.probe.getBoundingClientRect().top;   // baseline within one line box
    const rel = (el, k) => el.getBoundingClientRect()[k] - card[k === "top" ? "top" : "left"];
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    if (!ctx) throw new Error(FAIL_MSG);
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = INK; ctx.fillRect(88, 68, 1024, 2);                                   // 2px ink rule
    const footTop = rel(c.foot, "top");                                        // border-top of the footer
    ctx.fillStyle = LINE; ctx.fillRect(88, Math.round(footTop), 1024, 1);                 // 1px hairline
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(assets.icon, Math.round(rel(c.icon, "left")), Math.round(rel(c.icon, "top")));
    ctx.textBaseline = "alphabetic"; ctx.fontKerning = "normal"; ctx.textRendering = "geometricPrecision";
    ctx.fillStyle = INK2; ctx.letterSpacing = "0px";
    const textX = Math.round(rel(c.txt, "left"));
    ctx.font = `700 26px "${FAMILY}"`; ctx.fillText("Meritline Tax Services", textX, Math.round(rel(c.pn, "top")));
    ctx.font = `500 22px "${FAMILY}"`; ctx.fillText("meritlinetaxservices.com", textX, Math.round(rel(c.pu, "top")));
    ctx.fillStyle = INK; ctx.font = `700 ${fs}px "${FAMILY}"`; ctx.letterSpacing = `${-0.005 * fs}px`;
    const h1Top = h1r.top - card.top, firstTop = lines.length ? lines[0].top : 0;
    for (const l of lines) ctx.fillText(l.text, Math.round(h1r.left - card.left) + (l.left - h1r.left), Math.round(h1Top + (l.top - firstTop) + baseOffset));
    const png = await pngBytes(cv);
    return { png, canvas: cv, fontSize: fs, lines: lines.map(l => l.text), fits };
  } catch {
    throw new Error(FAIL_MSG);
  } finally {
    if (c) c.host.remove();
  }
}
