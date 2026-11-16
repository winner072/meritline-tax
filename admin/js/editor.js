// Article body editor: a contenteditable area with a small formatting toolbar, a link dialog,
// pictures (resized in the browser, kept as pending files until publishing), simple tables,
// and paste/drop cleaning. Whatever the area contains, getHtml() returns the canonical body
// produced by sanitize.js, so the published page only ever gets markup the site supports.

import { sanitizeToCanonical, canonicalToEditable, cleanPastedHtml, textToEditableHtml, normalizeHref } from "./sanitize.js?v=20261116";

const DEFAULT_LIMITS = { maxImageInputBytes: 10 * 1024 * 1024, maxImageBytes: 1024 * 1024, maxImageSide: 1600, maxPictures: 10, maxColumns: 8 };
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const TABLE_HTML = "<table><thead><tr><th>Column 1</th><th>Column 2</th><th>Column 3</th></tr></thead><tbody><tr><td><br></td><td><br></td><td><br></td></tr></tbody></table><p><br></p>";
const EMPTY_HTML = "<p><br></p>";
const PICTURE_MSG = "To add a picture, use the Picture button.";

const escHtml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = s => escHtml(s).replace(/"/g, "&quot;");

function newPendingId() {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return "p" + [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), type, quality));
}

/**
 * Resizes and re-encodes a picture file (this also removes camera and location data).
 * Resolves to a PendingImage or rejects with an Error whose message can be shown as is.
 */
export async function preparePicture(file, limits = DEFAULT_LIMITS) {
  const ext = IMAGE_TYPES[file && file.type];
  if (!ext) throw new Error("Use a JPG, PNG or WebP picture.");
  if (file.size > limits.maxImageInputBytes) throw new Error("This picture is larger than 10 MB. Please use a smaller picture.");
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This picture could not be opened. Please try another file.");
  }
  const scale = Math.min(1, limits.maxImageSide / Math.max(bmp.width, bmp.height));
  const width = Math.max(1, Math.round(bmp.width * scale));
  const height = Math.max(1, Math.round(bmp.height * scale));
  const draw = whiteBackground => {
    const cv = document.createElement("canvas");
    cv.width = width;
    cv.height = height;
    const ctx = cv.getContext("2d");
    if (whiteBackground) { ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, width, height); }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, width, height);
    return cv;
  };
  let blob = null, outExt = ext, type = file.type;
  try {
    if (ext === "jpg") {
      blob = await canvasToBlob(draw(true), "image/jpeg", 0.85);
    } else if (ext === "webp") {
      blob = await canvasToBlob(draw(false), "image/webp", 0.85);
      if (!blob || blob.type !== "image/webp") { blob = await canvasToBlob(draw(true), "image/jpeg", 0.85); outExt = "jpg"; type = "image/jpeg"; }
    } else {
      blob = await canvasToBlob(draw(false), "image/png");
      if (blob && blob.size > limits.maxImageBytes) { blob = await canvasToBlob(draw(true), "image/jpeg", 0.85); outExt = "jpg"; type = "image/jpeg"; }
    }
  } finally {
    if (bmp.close) bmp.close();
  }
  if (!blob) throw new Error("This picture could not be opened. Please try another file.");
  if (blob.size > limits.maxImageBytes) throw new Error("This picture is too large even after shrinking it. Please use a smaller picture.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const dataUrl = await blobToDataUrl(blob);
  return { id: newPendingId(), bytes, ext: outExt, type, width, height, dataUrl };
}

export function createEditor(root, opts) {
  const { toolbar, getLinkTargets, onChange, onMessage } = opts;
  const limits = Object.assign({}, DEFAULT_LIMITS, opts.limits || {});
  const ac = new AbortController();
  const on = (target, type, fn, options) => target && target.addEventListener(type, fn, Object.assign({ signal: ac.signal }, options || {}));
  const $ = id => document.getElementById(id);
  const message = (text, level = "info") => { try { if (onMessage) onMessage(text, level); } catch { /* display only */ } };

  const tableTools = $("table-tools");
  const imageTools = $("image-tools");
  const imageInput = $("image-input");
  const link = {
    dialog: $("link-dialog"), guide: $("link-guide"), page: $("link-page"), url: $("link-url"), error: $("link-error"),
    apply: $("link-apply"), remove: $("link-remove"), cancel: $("link-cancel")
  };
  const pic = {
    dialog: $("image-dialog"), heading: $("image-dialog-h"), thumb: $("image-thumb"), size: $("image-size"), alt: $("image-alt"),
    error: $("image-error"), insert: $("image-insert"), cancel: $("image-cancel")
  };

  const images = new Map();              // pending id -> { image: PendingImage, url: objectURL }
  let lastRange = null;                  // the last selection inside the editor
  let changeTimer = null;
  let internalDrag = false;
  let selectedImg = null;
  let linkState = null;                  // { range, anchor }
  let picState = null;                   // { mode: "add" | "alt", image?, img?, range }
  let destroyed = false;

  // ---------- Basics ----------
  try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch { /* older browsers */ }
  try { document.execCommand("styleWithCSS", false, false); } catch { /* older browsers */ }

  function changed() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { if (!destroyed && onChange) onChange(); }, 300);
  }

  function ensureNotEmpty() {
    const hasBlock = [...root.childNodes].some(n => n.nodeType === 1 ? n.nodeName !== "BR" : n.nodeType === 3 && n.data.trim() !== "");
    if (!hasBlock) root.innerHTML = EMPTY_HTML;
    markEmpty();
  }

  // "is-empty" shows the "Write the article here." prompt while the article is one empty paragraph.
  function markEmpty() {
    const only = root.childNodes.length === 1 ? root.firstChild : null;
    const empty = !!only && only.nodeName === "P" && only.textContent === "" && !only.querySelector("img");
    root.classList.toggle("is-empty", empty);
  }

  function rangeInRoot(r) {
    return !!r && root.contains(r.startContainer) && root.contains(r.endContainer);
  }

  function currentRange() {
    const sel = document.getSelection();
    if (sel && sel.rangeCount && rangeInRoot(sel.getRangeAt(0))) return sel.getRangeAt(0);
    return rangeInRoot(lastRange) ? lastRange : null;
  }

  function restoreRange(r) {
    root.focus({ preventScroll: true });
    if (!rangeInRoot(r)) return;
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function placeCaret(node, selectContents = false) {
    const r = document.createRange();
    if (selectContents) r.selectNodeContents(node);
    else { r.selectNodeContents(node); r.collapse(true); }
    restoreRange(r);
    lastRange = r.cloneRange();
  }

  function elementOf(node) {
    return node && node.nodeType === 3 ? node.parentNode : node;
  }

  function closestIn(node, selector) {
    const el = elementOf(node);
    if (!el || !root.contains(el)) return null;
    const hit = el.closest(selector);
    return hit && root.contains(hit) && hit !== root ? hit : null;
  }

  function topBlock(node) {
    let n = elementOf(node);
    if (!n || !root.contains(n) || n === root) return null;
    while (n.parentNode && n.parentNode !== root) n = n.parentNode;
    return n.parentNode === root ? n : null;
  }

  function exec(cmd, value) {
    try { return document.execCommand(cmd, false, value); } catch { return false; }
  }

  function isEmptyBlock(el) {
    return !!el && el.nodeName === "P" && el.textContent.trim() === "" && !el.querySelector("img");
  }

  // Inserts nodes as top-level blocks after the block that holds the caret.
  function insertBlocksAfterCurrent(fragment) {
    const r = currentRange();
    const block = r ? topBlock(r.startContainer) : null;
    const nodes = [...fragment.childNodes];
    if (!block) root.append(fragment);
    else if (isEmptyBlock(block)) block.before(fragment);
    else block.after(fragment);
    const last = nodes[nodes.length - 1];
    if (last && !last.nextSibling) last.after(document.createRange().createContextualFragment(EMPTY_HTML));
    return nodes;
  }

  // Chrome can put a new list (and later blocks) inside the current paragraph or heading, e.g.
  // <p><ul>..</ul><p>..</p></p>. Lift such blocks back to the top level so every top-level block is
  // a single paragraph, heading, list, note box, table or picture. The caret is kept.
  const NESTED_BLOCKS = ":scope > :is(p,h1,h2,h3,h4,h5,h6) > :is(p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,table,div)";
  const BLOCK_RE = /^(P|H[1-6]|UL|OL|BLOCKQUOTE|TABLE|DIV)$/;

  function liftNestedBlocks() {
    if (!root.querySelector(NESTED_BLOCKS)) return false;
    const saved = saveCaret(currentRange());
    for (let guard = 0; guard < 20; guard++) {
      const inner = root.querySelector(NESTED_BLOCKS);
      if (!inner) break;
      const outer = inner.parentNode;
      const parts = [];
      const runs = new Set();
      let run = null;
      for (const n of [...outer.childNodes]) {
        if (n.nodeType === 1 && BLOCK_RE.test(n.nodeName)) { run = null; parts.push(n); continue; }
        if (!run) { run = document.createElement(outer.nodeName.toLowerCase()); parts.push(run); runs.add(run); }
        run.append(n);
      }
      // Inline leftovers between the lifted blocks become their own block, unless they are only spacing.
      const keep = p => !runs.has(p) || p.textContent.trim() !== "" || !!p.querySelector("img") || (saved && p.contains(saved.sc));
      outer.replaceWith(...parts.filter(keep));
    }
    if (saved) restoreCaret(saved, root.firstElementChild);
    return true;
  }

  // Removes inline style attributes that the browser adds when inserting HTML.
  function stripInlineStyles() {
    for (const el of root.querySelectorAll("[style]")) el.removeAttribute("style");
    for (const el of root.querySelectorAll("font")) el.replaceWith(...el.childNodes);
  }

  // ---------- Toolbar ----------
  function setPressed(cmd, on) {
    const b = toolbar.querySelector(`[data-cmd="${cmd}"]`);
    if (b) b.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function updateState() {
    if (destroyed) return;
    const r = currentRange();
    const node = r ? r.startContainer : null;
    const inTable = !!(node && closestIn(node, "table"));
    const inQuote = !!(node && closestIn(node, "blockquote"));
    const inList = node ? closestIn(node, "ul,ol") : null;
    const heading = node ? closestIn(node, "h1,h2,h3,h4,h5,h6") : null;
    setPressed("h2", !!heading && /^H[12]$/.test(heading.nodeName));
    setPressed("h3", !!heading && /^H[3-6]$/.test(heading.nodeName));
    setPressed("p", !!node && !heading && !inQuote && !inList && !inTable && !!closestIn(node, "p"));
    setPressed("quote", inQuote);
    setPressed("ul", !!inList && inList.nodeName === "UL");
    setPressed("ol", !!inList && inList.nodeName === "OL");
    setPressed("link", !!(node && closestIn(node, "a")));
    let bold = false, italic = false;
    const live = document.getSelection();
    if (live && live.rangeCount && rangeInRoot(live.getRangeAt(0))) { try { bold = document.queryCommandState("bold"); italic = document.queryCommandState("italic"); } catch { /* ignore */ } }
    setPressed("bold", bold);
    setPressed("italic", italic);
    if (tableTools) tableTools.hidden = !inTable;
    if (selectedImg && (!root.contains(selectedImg) || !r || !r.intersectsNode(selectedImg))) deselectImage();
  }

  function toggleHeading(tag) {
    const r = currentRange();
    const heading = r ? closestIn(r.startContainer, "h1,h2,h3,h4,h5,h6") : null;
    const isSame = heading && (tag === "h2" ? /^H[12]$/.test(heading.nodeName) : /^H[3-6]$/.test(heading.nodeName));
    exec("formatBlock", isSame ? "<p>" : `<${tag}>`);
  }

  // The note box is built directly in the DOM (not with formatBlock, which puts each line in its own
  // blockquote in Chrome), so it always has the editable form <blockquote><p>..</p></blockquote>.
  function saveCaret(r) {
    return r ? { sc: r.startContainer, so: r.startOffset, ec: r.endContainer, eo: r.endOffset } : null;
  }

  function restoreCaret(saved, fallback) {
    const ok = saved && root.contains(saved.sc) && root.contains(saved.ec);
    if (!ok) { if (fallback) placeCaret(fallback); return; }
    const r = document.createRange();
    try {
      r.setStart(saved.sc, Math.min(saved.so, nodeLength(saved.sc)));
      r.setEnd(saved.ec, Math.min(saved.eo, nodeLength(saved.ec)));
    } catch {
      if (fallback) placeCaret(fallback);
      return;
    }
    restoreRange(r);
    lastRange = r.cloneRange();
  }

  function nodeLength(n) {
    return n.nodeType === 3 ? n.data.length : n.childNodes.length;
  }

  function toParagraph(block) {
    if (block.nodeName === "P") return block;
    const p = document.createElement("p");
    p.append(...block.childNodes);
    block.replaceWith(p);
    return p;
  }

  function toggleQuote() {
    liftNestedBlocks();
    const r = currentRange();
    if (!r) return;
    const quote = closestIn(r.startContainer, "blockquote");
    if (quote) { unwrapQuote(quote, r); return; }
    const first = topBlock(r.startContainer);
    const last = topBlock(r.endContainer) || first;
    if (!first) return;
    const blocks = [];
    for (let n = first; n; n = n.nextElementSibling) {
      blocks.push(n);
      if (n === last) break;
    }
    if (blocks.some(b => !/^(P|H[1-6]|DIV)$/.test(b.nodeName) || b.querySelector("img,table,ul,ol,blockquote"))) {
      message("A note box can only hold text. Select only paragraphs, then press Note box.", "warn");
      return;
    }
    const saved = saveCaret(r);
    const box = document.createElement("blockquote");
    first.before(box);
    for (const b of blocks) {
      box.append(b);
      const p = toParagraph(b);
      if (!p.firstChild) p.append(document.createElement("br"));
    }
    restoreCaret(saved, box.firstElementChild);
  }

  function unwrapQuote(quote, r) {
    const saved = saveCaret(r || currentRange());
    const frag = document.createDocumentFragment();
    let pending = null;
    for (const n of [...quote.childNodes]) {
      const blockish = n.nodeType === 1 && /^(P|H[1-6]|UL|OL|TABLE|DIV)$/.test(n.nodeName);
      if (blockish) { pending = null; frag.append(n); continue; }
      if (!pending) { pending = document.createElement("p"); frag.append(pending); }
      pending.append(n);
    }
    const first = frag.firstChild;
    quote.replaceWith(frag);
    restoreCaret(saved, first);
  }

  function runCommand(cmd) {
    const r = currentRange();
    if (!r && cmd !== "image") { root.focus(); }
    const inTable = !!(r && closestIn(r.startContainer, "table"));
    if (inTable && ["h2", "h3", "p", "quote", "ul", "ol", "table", "image"].includes(cmd)) {
      message("Headings, lists, note boxes, tables and pictures can't go inside a table. Move the cursor below the table first.", "warn");
      return;
    }
    const inQuote = !!(r && closestIn(r.startContainer, "blockquote"));
    if (inQuote && ["h2", "h3", "ul", "ol"].includes(cmd)) {
      message("Headings and lists can't go inside a note box. Press Note box first to turn the box back into normal text.", "warn");
      return;
    }
    if (r) restoreRange(r);
    switch (cmd) {
      case "h2": toggleHeading("h2"); break;
      case "h3": toggleHeading("h3"); break;
      case "p": if (!inQuote) exec("formatBlock", "<p>"); break;
      case "quote": toggleQuote(); break;
      case "bold": exec("bold"); break;
      case "italic": exec("italic"); break;
      case "ul": exec("insertUnorderedList"); break;
      case "ol": exec("insertOrderedList"); break;
      case "link": openLinkDialog(); return;
      case "table": insertTable(); break;
      case "image": choosePicture(); return;
      default: return;
    }
    liftNestedBlocks();
    stripInlineStyles();
    ensureNotEmpty();
    changed();
    updateState();
  }

  on(toolbar, "mousedown", e => { if (e.target.closest("button[data-cmd]")) e.preventDefault(); });

  // Keyboard: the toolbar is one tab stop; Left/Right, Home and End move between its buttons and
  // Escape goes back to the article text where the caret was.
  const toolButtons = () => [...toolbar.querySelectorAll("button[data-cmd]")].filter(b => !b.disabled && !b.hidden);
  function setRoving(active) {
    for (const b of toolButtons()) b.tabIndex = b === active ? 0 : -1;
  }
  setRoving(toolButtons()[0]);
  on(toolbar, "focusin", e => {
    const b = e.target.closest("button[data-cmd]");
    if (b) setRoving(b);
  });
  on(toolbar, "keydown", e => {
    const list = toolButtons();
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    let next = null;
    if (e.key === "ArrowRight") next = list[(i + 1) % list.length];
    else if (e.key === "ArrowLeft") next = list[(i - 1 + list.length) % list.length];
    else if (e.key === "Home") next = list[0];
    else if (e.key === "End") next = list[list.length - 1];
    else if (e.key === "Escape") {
      e.preventDefault();
      restoreRange(lastRange);
      return;
    }
    if (!next) return;
    e.preventDefault();
    setRoving(next);
    next.focus();
  });
  on(toolbar, "click", e => {
    const b = e.target.closest("button[data-cmd]");
    if (b && toolbar.contains(b)) runCommand(b.dataset.cmd);
  });

  // ---------- Tables ----------
  function insertTable() {
    const frag = document.createRange().createContextualFragment(TABLE_HTML);
    const r = currentRange();
    const block = r ? topBlock(r.startContainer) : null;
    const nodes = [...frag.childNodes];
    const table = nodes[0];
    if (block && isEmptyBlock(block)) { block.before(table); }
    else if (block) { block.after(...nodes); }
    else { root.append(...nodes); }
    const th = table.querySelector("th");
    if (th) placeCaret(th, true);
  }

  function cellContext() {
    const r = currentRange();
    const cell = r ? closestIn(r.startContainer, "td,th") : null;
    if (!cell) return null;
    const table = cell.closest("table");
    const row = cell.parentNode;
    return { cell, row, table, col: cell.cellIndex, cols: Math.max(...[...table.rows].map(tr => tr.cells.length)) };
  }

  function makeCell(tag, text) {
    const c = document.createElement(tag);
    if (text) c.textContent = text; else c.append(document.createElement("br"));
    return c;
  }

  function tableCommand(cmd) {
    const c = cellContext();
    if (!c) return;
    const { cell, row, table, col, cols } = c;
    const inHead = row.parentNode && row.parentNode.nodeName === "THEAD";
    if (cmd === "add-row") {
      let tbody = table.tBodies[0];
      if (!tbody) { tbody = document.createElement("tbody"); table.append(tbody); }
      const tr = document.createElement("tr");
      for (let i = 0; i < cols; i++) tr.append(makeCell("td"));
      if (inHead) tbody.prepend(tr); else row.after(tr);
      placeCaret(tr.cells[0]);
    } else if (cmd === "add-col") {
      if (cols >= limits.maxColumns) { message(`A table can have up to ${limits.maxColumns} columns.`, "warn"); return; }
      for (const tr of table.rows) {
        const isHead = tr.parentNode.nodeName === "THEAD";
        const ref = tr.cells[Math.min(col, tr.cells.length - 1)];
        const nc = makeCell(isHead ? "th" : "td", isHead ? `Column ${cols + 1}` : "");
        if (ref) ref.after(nc); else tr.append(nc);
      }
      const target = row.cells[col + 1];
      if (target) placeCaret(target, inHead);
    } else if (cmd === "del-row") {
      if (inHead) { message("The heading row can't be removed. Use Remove table to delete the whole table.", "warn"); return; }
      const body = [...table.tBodies].reduce((n, tb) => n + tb.rows.length, 0);
      if (body <= 1) { message("A table needs at least one row. Use Remove table to delete it.", "warn"); return; }
      const next = row.nextElementSibling || row.previousElementSibling;
      row.remove();
      if (next && next.cells[0]) placeCaret(next.cells[0]);
    } else if (cmd === "del-col") {
      if (cols <= 1) { message("A table needs at least one column. Use Remove table to delete it.", "warn"); return; }
      for (const tr of table.rows) if (tr.cells[col]) tr.cells[col].remove();
      const target = row.cells[Math.min(col, row.cells.length - 1)];
      if (target) placeCaret(target);
    } else if (cmd === "del-table") {
      const next = table.nextElementSibling || table.previousElementSibling;
      table.remove();
      ensureNotEmpty();
      placeCaret(next && root.contains(next) ? next : root.firstElementChild);
    } else {
      return;
    }
    void cell;
    changed();
    updateState();
  }

  if (tableTools) {
    on(tableTools, "mousedown", e => { if (e.target.closest("button[data-cmd]")) e.preventDefault(); });
    on(tableTools, "click", e => {
      const b = e.target.closest("button[data-cmd]");
      if (b) tableCommand(b.dataset.cmd);
    });
  }

  // ---------- Links ----------
  function linkKind() {
    const checked = document.querySelector('input[name="link-kind"]:checked');
    return checked ? checked.value : "url";
  }

  function showLinkKind(kind) {
    for (const radio of document.querySelectorAll('input[name="link-kind"]')) radio.checked = radio.value === kind;
    for (const box of link.dialog.querySelectorAll(".choice-field")) box.classList.toggle("is-off", box.dataset.kind !== kind);
    link.error.hidden = true;
  }

  function fillSelect(select, items) {
    select.replaceChildren();
    for (const it of items) {
      const o = document.createElement("option");
      o.value = it.value;
      o.textContent = it.label;
      select.append(o);
    }
  }

  function openLinkDialog() {
    if (!link.dialog) return;
    const r = currentRange();
    const anchor = r ? closestIn(r.startContainer, "a") : null;
    linkState = { range: r ? r.cloneRange() : null, anchor };
    let targets = { guides: [], pages: [] };
    try { targets = getLinkTargets() || targets; } catch { /* no site data yet */ }
    const guides = (targets.guides || []).filter(g => g && g.file)
      .map(g => ({ value: g.file, label: g.title || g.file }))
      .sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
    const pages = (targets.pages || []).filter(p => p && p.href).map(p => ({ value: p.href, label: p.label || p.href }));
    fillSelect(link.guide, guides);
    fillSelect(link.page, pages);
    const radio = v => document.querySelector(`input[name="link-kind"][value="${v}"]`);
    radio("guide").disabled = !guides.length;
    radio("page").disabled = !pages.length;
    link.url.value = "";
    let kind = guides.length ? "guide" : "url";
    if (anchor) {
      const href = anchor.getAttribute("href") || "";
      if (guides.some(g => g.value === href)) { kind = "guide"; link.guide.value = href; }
      else if (pages.some(p => p.value === href)) { kind = "page"; link.page.value = href; }
      else { kind = "url"; link.url.value = href; }
    }
    showLinkKind(kind);
    link.remove.hidden = !anchor;
    link.apply.textContent = anchor ? "Change link" : "Add link";
    link.dialog.showModal();
    (kind === "guide" ? link.guide : kind === "page" ? link.page : link.url).focus();
  }

  function closeLinkDialog() {
    if (link.dialog.open) link.dialog.close();
  }

  function applyLink() {
    const kind = linkKind();
    let href = null, label = "";
    if (kind === "guide") {
      href = link.guide.value || null;
      label = link.guide.selectedOptions[0] ? link.guide.selectedOptions[0].textContent : "";
    } else if (kind === "page") {
      href = link.page.value || null;
      label = link.page.selectedOptions[0] ? link.page.selectedOptions[0].textContent : "";
    } else {
      let raw = link.url.value.trim();
      if (raw && !/^[a-z][a-z0-9+.-]*:/i.test(raw) && /^[^\s/:]+\.[a-z]{2,}(?:[/?#]|$)/i.test(raw)) raw = "https://" + raw;
      href = /^(https?:\/\/|mailto:)/i.test(raw) ? normalizeHref(raw) : null;
      label = raw.replace(/^mailto:/i, "");
      if (!href) { link.error.hidden = false; link.url.focus(); return; }
    }
    if (!href) { link.error.hidden = false; return; }
    const { range, anchor } = linkState || {};
    linkState = null;
    closeLinkDialog();
    if (anchor && root.contains(anchor)) {
      anchor.setAttribute("href", href);
      placeCaret(anchor, true);
    } else {
      restoreRange(range);
      const r = currentRange();
      if (!r || r.collapsed) exec("insertHTML", `<a href="${escAttr(href)}">${escHtml(label || href)}</a>`);
      else exec("createLink", href);
      stripInlineStyles();
    }
    changed();
    updateState();
  }

  function removeLink() {
    const { anchor } = linkState || {};
    linkState = null;
    closeLinkDialog();
    if (anchor && root.contains(anchor)) {
      placeCaret(anchor, true);
      exec("unlink");
      if (root.contains(anchor)) anchor.replaceWith(...anchor.childNodes);
      changed();
      updateState();
    }
  }

  if (link.dialog) {
    on(link.apply, "click", applyLink);
    on(link.remove, "click", removeLink);
    on(link.cancel, "click", () => { closeLinkDialog(); });
    on(link.dialog, "close", () => {
      if (!linkState) return;
      const r = linkState.range;
      linkState = null;
      restoreRange(r);
    });
    on(link.url, "keydown", e => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } });
    on(link.url, "input", () => { link.error.hidden = true; });
    for (const radio of document.querySelectorAll('input[name="link-kind"]')) on(radio, "change", () => showLinkKind(radio.value));
  }

  // ---------- Pictures ----------
  function pictureCount() {
    return root.querySelectorAll("img").length;
  }

  function choosePicture() {
    if (pictureCount() >= limits.maxPictures) { message(`Use ${limits.maxPictures} pictures or fewer in one post.`, "error"); return; }
    const r = currentRange();
    picState = { mode: "add", range: r ? r.cloneRange() : null };
    imageInput.value = "";
    imageInput.click();
  }

  function openPictureDialog(state) {
    picState = state;
    pic.error.hidden = true;
    if (state.mode === "add") {
      pic.heading.textContent = "Add a picture";
      pic.insert.textContent = "Add picture";
      pic.thumb.src = state.image.dataUrl;
      pic.alt.value = "";
      pic.size.textContent = `${state.image.width} × ${state.image.height} pixels, ${Math.max(1, Math.round(state.image.bytes.length / 1024))} KB`;
    } else {
      pic.heading.textContent = "Change the description";
      pic.insert.textContent = "Save description";
      pic.thumb.src = state.img.currentSrc || state.img.src;
      pic.alt.value = state.img.getAttribute("alt") || "";
      pic.size.textContent = "";
    }
    pic.thumb.alt = "";
    pic.dialog.showModal();
    pic.alt.focus();
  }

  function altProblem(alt) {
    if (!alt) return "Add a description of the picture.";
    if (alt.length > 150) return "Keep the description to 150 characters or fewer.";
    return null;
  }

  function confirmPicture() {
    const alt = pic.alt.value.replace(/\s+/g, " ").trim();
    const problem = altProblem(alt);
    if (problem) { pic.error.textContent = problem; pic.error.hidden = false; pic.alt.focus(); return; }
    const state = picState;
    picState = null;
    pic.dialog.close();
    if (!state) return;
    if (state.mode === "alt") {
      if (root.contains(state.img)) state.img.setAttribute("alt", alt);
      changed();
      return;
    }
    const image = state.image;
    const url = URL.createObjectURL(new Blob([image.bytes], { type: image.type }));
    images.set(image.id, { image, url });
    const p = document.createElement("p");
    const img = document.createElement("img");
    img.setAttribute("src", url);
    img.setAttribute("data-pending", image.id);
    img.setAttribute("alt", alt);
    img.setAttribute("width", String(image.width));
    img.setAttribute("height", String(image.height));
    p.append(img);
    restoreRange(state.range);
    const frag = document.createDocumentFragment();
    frag.append(p);
    insertBlocksAfterCurrent(frag);
    const after = p.nextElementSibling;
    if (after) placeCaret(after);
    changed();
    updateState();
  }

  async function onFileChosen() {
    const file = imageInput.files && imageInput.files[0];
    imageInput.value = "";
    if (!file) return;
    const range = picState && picState.range;
    try {
      message("Preparing the picture...", "info");
      const image = await preparePicture(file, limits);
      if (destroyed) return;
      message("", "info");
      openPictureDialog({ mode: "add", image, range });
    } catch (e) {
      message(e && e.message ? e.message : "This picture could not be opened. Please try another file.", "error");
    }
  }

  function selectImage(img) {
    deselectImage();
    selectedImg = img;
    img.classList.add("is-selected");
    if (imageTools) imageTools.hidden = false;
    const r = document.createRange();
    r.selectNode(img);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    lastRange = r.cloneRange();
  }

  function deselectImage() {
    if (selectedImg) {
      selectedImg.classList.remove("is-selected");
      if (!selectedImg.getAttribute("class")) selectedImg.removeAttribute("class");
    }
    selectedImg = null;
    if (imageTools) imageTools.hidden = true;
  }

  function removeSelectedImage() {
    const img = selectedImg;
    if (!img || !root.contains(img)) return;
    deselectImage();
    const parent = img.parentNode;
    const next = topBlock(img) ? topBlock(img).nextElementSibling : null;
    img.remove();
    if (parent && parent !== root && parent.nodeName === "P" && parent.textContent.trim() === "" && !parent.querySelector("img")) parent.remove();
    ensureNotEmpty();
    placeCaret(next && root.contains(next) ? next : root.firstElementChild);
    changed();
    updateState();
  }

  on(imageInput, "change", onFileChosen);
  if (pic.dialog) {
    on(pic.insert, "click", confirmPicture);
    on(pic.cancel, "click", () => { picState = null; pic.dialog.close(); });
    on(pic.alt, "input", () => { pic.error.hidden = true; });
    on(pic.alt, "keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); confirmPicture(); } });
    on(pic.dialog, "close", () => {
      picState = null;
      pic.thumb.removeAttribute("src");
      root.focus({ preventScroll: true });
    });
  }
  if (imageTools) {
    on(imageTools, "mousedown", e => { if (e.target.closest("button[data-cmd]")) e.preventDefault(); });
    on(imageTools, "click", e => {
      const b = e.target.closest("button[data-cmd]");
      if (!b || !selectedImg) return;
      if (b.dataset.cmd === "alt") openPictureDialog({ mode: "alt", img: selectedImg, range: null });
      else if (b.dataset.cmd === "remove") removeSelectedImage();
    });
  }

  // ---------- Editing area events ----------
  on(root, "click", e => {
    if (e.target && e.target.nodeName === "IMG" && root.contains(e.target)) selectImage(e.target);
    else if (selectedImg) deselectImage();
  });

  on(root, "input", e => {
    if (!e.isComposing) liftNestedBlocks();
    ensureNotEmpty();
    changed();
  });

  on(root, "keydown", e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (e.key === "k" || e.key === "K")) { e.preventDefault(); openLinkDialog(); return; }
    if (mod && !e.altKey && (e.key === "u" || e.key === "U")) { e.preventDefault(); return; }
    if (e.key === "Enter" && !e.shiftKey && !mod) {
      // Enter on an empty line at the end of a note box leaves the box.
      const r = currentRange();
      const quote = r ? closestIn(r.startContainer, "blockquote") : null;
      const line = r ? closestIn(r.startContainer, "p") : null;
      if (quote && r.collapsed && line && quote.contains(line) && line.textContent.trim() === "" && !line.nextElementSibling) {
        e.preventDefault();
        line.remove();
        const p = document.createElement("p");
        p.append(document.createElement("br"));
        quote.after(p);
        if (!quote.textContent.trim() && !quote.querySelector("img")) quote.remove();
        placeCaret(p);
        changed();
      }
    }
  });

  function insertCleaned(html, text) {
    const r = currentRange();
    const inlineOnly = r && closestIn(r.startContainer, "h1,h2,h3,h4,h5,h6,td,th");
    if (inlineOnly) {
      let plain = text || "";
      if (!plain && html) {
        const doc = new DOMParser().parseFromString("<!doctype html><body>" + cleanPastedHtml(html), "text/html");
        plain = doc.body.textContent || "";
      }
      plain = plain.replace(/\s+/g, " ").trim();
      if (plain) exec("insertText", plain);
    } else {
      const fragment = html ? cleanPastedHtml(html) : textToEditableHtml(text || "");
      if (!fragment) return;
      exec("insertHTML", fragment);
      liftNestedBlocks();
      stripInlineStyles();
    }
    ensureNotEmpty();
    changed();
    updateState();
  }

  on(root, "paste", e => {
    e.preventDefault();
    const dt = e.clipboardData;
    if (!dt) return;
    const html = dt.getData("text/html");
    const text = dt.getData("text/plain");
    if (!html && !text) {
      if (dt.files && dt.files.length) message(PICTURE_MSG, "warn");
      return;
    }
    insertCleaned(html, text);
  });

  on(root, "dragstart", () => { internalDrag = true; });
  on(document, "dragend", () => { internalDrag = false; });
  on(root, "drop", e => {
    if (internalDrag) { internalDrag = false; setTimeout(() => { stripInlineStyles(); changed(); }, 0); return; }
    e.preventDefault();
    const dt = e.dataTransfer;
    if (!dt) return;
    if (dt.files && dt.files.length) { message(PICTURE_MSG, "warn"); return; }
    const html = dt.getData("text/html");
    const text = dt.getData("text/plain");
    if (!html && !text) return;
    const at = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (at && rangeInRoot(at)) restoreRange(at);
    insertCleaned(html, text);
  });

  on(document, "selectionchange", () => {
    const sel = document.getSelection();
    if (sel && sel.rangeCount && rangeInRoot(sel.getRangeAt(0))) lastRange = sel.getRangeAt(0).cloneRange();
    updateState();
  });

  // ---------- Content in and out ----------
  function setHtml(canonical, pending) {
    deselectImage();
    if (pending instanceof Map) {
      for (const [id, image] of pending) {
        if (!image || !image.bytes || images.has(id)) continue;
        images.set(id, { image, url: URL.createObjectURL(new Blob([image.bytes], { type: image.type || "image/png" })) });
      }
    }
    const tpl = document.createElement("template");
    // Cleaned again on the way in, so a damaged draft or saved copy can never bring other markup.
    tpl.innerHTML = canonical ? canonicalToEditable(sanitizeToCanonical(canonical)) : "";
    let missing = 0;
    for (const img of [...tpl.content.querySelectorAll("img")]) {
      const m = /^pending:(p[0-9a-f]{8})$/.exec(img.getAttribute("src") || "");
      if (!m) continue;
      const entry = images.get(m[1]);
      if (entry) {
        img.setAttribute("src", entry.url);
        img.setAttribute("data-pending", m[1]);
      } else {
        const parent = img.parentNode;
        img.remove();
        if (parent && parent.nodeName === "P" && !parent.textContent.trim() && !parent.querySelector("img")) parent.remove();
        missing++;
      }
    }
    root.replaceChildren(tpl.content);
    ensureNotEmpty();
    lastRange = null;
    if (missing) message("Some pictures could not be kept in the draft on this computer. Add them again with the Picture button.", "warn");
    updateState();
  }

  function getHtml() {
    const doc = document.implementation.createHTMLDocument("");
    const clone = doc.importNode(root, true);
    for (const img of clone.querySelectorAll("img[data-pending]")) {
      img.setAttribute("src", "pending:" + img.getAttribute("data-pending"));
    }
    return sanitizeToCanonical(clone.innerHTML);
  }

  function getPendingImages() {
    const out = new Map();
    for (const img of root.querySelectorAll("img[data-pending]")) {
      const id = img.getAttribute("data-pending");
      const entry = images.get(id);
      if (entry && !out.has(id)) out.set(id, entry.image);
    }
    return out;
  }

  ensureNotEmpty();

  return {
    getHtml,
    setHtml,
    getPendingImages,
    focus() { root.focus(); },
    destroy() {
      destroyed = true;
      clearTimeout(changeTimer);
      ac.abort();
      if (link.dialog && link.dialog.open) link.dialog.close();
      if (pic.dialog && pic.dialog.open) pic.dialog.close();
      if (tableTools) tableTools.hidden = true;
      if (imageTools) imageTools.hidden = true;
      for (const { url } of images.values()) URL.revokeObjectURL(url);
      images.clear();
      root.replaceChildren();
      root.classList.remove("is-empty");
    }
  };
}
