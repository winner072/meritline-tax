/* =====================================================================
   MERITLINE TAX — SITE SETTINGS
   Type your details between the quotes, save, and re-upload the folder.
   They appear on every page automatically.
   ===================================================================== */
const SETTINGS = {
  email: "",          // e.g. "info@meritlinetax.com"
  phone: "+44 7520659818",          // how your number should appear, e.g. "+44 7520659818"
  whatsapp: "447520659818",       // same number, digits only with country code, e.g. "447520659818"
  hours: "Monday to Friday, 7:00 AM to 5:00 PM GMT",   // your business hours, shown on every page
  formEndpoint: "",   // your Formspree form URL, e.g. "https://formspree.io/f/abcdwxyz"
  bookingUrl: "",     // your Calendly (or similar) link for the free 20-minute call
  uploadUrl: "",      // your secure document upload / client portal link
  ptin: "",           // your PTIN once issued, e.g. "P01234567"
  payments: "",       // e.g. "Card, bank transfer, or Wise"
  team: [             // more team members. Put each photo in the images folder.
    // { name: "Jane Doe, CPA", role: "Reviewing CPA (Ohio)", photo: "images/jane.jpg" }
  ],
  linkedin: "",       // your LinkedIn page link, e.g. "https://www.linkedin.com/company/meritline-tax"
  reviewUrl: "",      // your Trustpilot (or other) review page link
  reviews: [          // real client reviews only, with permission
    // { text: "Meritline filed three years of Form 5472 for my LLC quickly.", name: "Adaeze O.", place: "Lagos, Nigeria" }
  ]
};
/* ===================================================================== */

const ROOT = document.documentElement.dataset.root || "";
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const store = {
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (_) {} },
  take(k) { try { const v = sessionStorage.getItem(k); sessionStorage.removeItem(k); return v; } catch (_) { return null; } }
};

/* ---------- Settings applied on every page ---------- */
(function () {
  if (SETTINGS.bookingUrl) document.querySelectorAll("[data-book]").forEach(a => { a.href = SETTINGS.bookingUrl; a.target = "_blank"; a.rel = "noopener"; a.removeAttribute("data-service"); });
  if (SETTINGS.uploadUrl) document.querySelectorAll("[data-upload]").forEach(a => { a.href = SETTINGS.uploadUrl; a.hidden = false; });
  if (SETTINGS.ptin) document.querySelectorAll("[data-ptin]").forEach(el => { el.textContent = "IRS-registered tax preparer · PTIN " + SETTINGS.ptin; el.hidden = false; });
  if (SETTINGS.payments) document.querySelectorAll("[data-payments]").forEach(el => { el.querySelector("b").textContent = SETTINGS.payments; el.hidden = false; });
  const rv = $("reviews");
  if (rv && SETTINGS.reviews && SETTINGS.reviews.length) {
    $("reviewList").innerHTML = SETTINGS.reviews.map(r => `<figure class="review"><blockquote>“${esc(r.text)}”</blockquote><figcaption><b>${esc(r.name || "")}</b>${r.place ? `<span>${esc(r.place)}</span>` : ""}</figcaption></figure>`).join("");
    rv.hidden = false;
  }
  const tg = $("teamGrid");
  if (tg && SETTINGS.team && SETTINGS.team.length) tg.insertAdjacentHTML("beforeend", SETTINGS.team.map(m => `<figure class="member">${m.photo ? `<img src="${esc(ROOT + m.photo)}" alt="${esc(m.name)}" width="72" height="72">` : `<span class="member-ph">${esc((m.name || "?").charAt(0))}</span>`}<figcaption><b>${esc(m.name)}</b><span>${esc(m.role || "")}</span></figcaption></figure>`).join(""));
  const map = { email: SETTINGS.email, phone: SETTINGS.phone, hours: SETTINGS.hours };
  document.querySelectorAll("[data-contact]").forEach(el => {
    const k = el.dataset.contact, v = map[k]; if (!v) return;
    el.classList.remove("fill");
    if (k === "email") el.innerHTML = `<a href="mailto:${esc(v)}">${esc(v)}</a>`;
    else if (k === "phone" && SETTINGS.whatsapp) el.innerHTML = `<a href="https://wa.me/${SETTINGS.whatsapp.replace(/\D/g, "")}" target="_blank" rel="noopener">${esc(v)}</a>`;
    else el.textContent = v;
  });
  if (SETTINGS.linkedin) document.querySelectorAll("[data-linkedin]").forEach(el => { el.classList.remove("fill"); el.innerHTML = `<a href="${esc(SETTINGS.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>`; });
  if (SETTINGS.whatsapp) {
    const link = "https://wa.me/" + SETTINGS.whatsapp.replace(/\D/g, "");
    [["waFloat"], ["mWa"]].forEach(([id]) => { const w = $(id); if (w) { w.href = link; w.hidden = false; } });
  }
  const yr = $("yr"); if (yr) yr.textContent = new Date().getFullYear();
})();

const PRICES = {
 "Foreign-Owned (5472/1120)": {
  "desc": "Form 5472 and pro forma Form 1120 compliance for non-resident owners of U.S. LLCs and corporations.",
  "rows": [
   [
    "Form 5472 + Pro Forma 1120",
    "From $200",
    1,
    "Annual information return for foreign-owned U.S. LLCs and corporations."
   ],
   [
    "Pro Forma 1120",
    "Included",
    "",
    "Filed together with Form 5472 at no extra cost."
   ],
   [
    "Form 7004 (Extension)",
    "$100",
    "",
    "Extends the Form 5472 deadline from April 15 to October 15."
   ],
   [
    "FBAR / FinCEN 114",
    "From $150"
   ],
   [
    "Reasonable Cause Statement",
    "From $250",
    "",
    "A written explanation to the IRS requesting relief from late-filing penalties."
   ],
   [
    "International Tax Consultation",
    "$50"
   ],
   [
    "Multi-Year Catch-Up",
    "Quoted by years missed",
    "",
    "Priced on the number of years you missed and the work involved in each."
   ]
  ]
 },
 "State Filings": {
  "desc": "We keep your LLC in good standing with its state: annual reports, franchise tax, and state tax returns. State fees and any tax owed are paid by you, and on request we make the payment to the state on your behalf.",
  "extrasLabel": "Other states we file in include:",
  "extras": [
   "California",
   "New York",
   "New Jersey",
   "Texas franchise tax",
   "Illinois",
   "Georgia",
   "Massachusetts"
  ],
  "rows": [
   [
    "Wyoming annual report",
    "$100 + state fee",
    "",
    "Due each year by the first day of the month your company was formed."
   ],
   [
    "Delaware annual LLC tax / franchise tax",
    "$100 + state fee",
    "",
    "LLCs: due June 1. Corporations: due March 1."
   ],
   [
    "Florida annual report",
    "$100 + state fee",
    "",
    "Due each year between January 1 and May 1."
   ],
   [
    "New Mexico LLCs",
    "Nothing to file",
    "",
    "New Mexico does not require an annual report from LLCs. Your federal filing still applies."
   ],
   [
    "Annual report, any other state",
    "$100 + state fee"
   ],
   [
    "State Business Tax Return",
    "From $100",
    "",
    "Per state. The state tax owed is paid separately by you."
   ],
   [
    "State Individual Tax Return",
    "From $100",
    "",
    "Per state. The state tax owed is paid separately by you."
   ],
   [
    "State payment on your behalf",
    "On request",
    "",
    "We submit your state fee or tax payment directly to the state for you."
   ]
  ]
 },
 "Late Filings & IRS": {
  "desc": "Help with IRS notices, late filings, penalties, and getting back in good standing.",
  "rows": [
   [
    "Reasonable Cause Statement",
    "From $250",
    "",
    "A written explanation to the IRS requesting relief from penalties."
   ],
   [
    "Tax / IRS Notice Review",
    "From $150",
    "",
    "We review the letter you received and explain your options."
   ],
   [
    "Late Filing Assistance",
    "From $200"
   ],
   [
    "Prior-Year Filing",
    "From $200",
    "",
    "A return for a past tax year that was never filed."
   ],
   [
    "Multi-Year Catch-Up",
    "Quoted by years missed",
    "",
    "Priced on the number of years you missed and the work involved in each."
   ]
  ]
 },
 "Consultations": {
  "desc": "Start with a free 20-minute call. Longer, focused sessions are available when you need detailed guidance before you file or form.",
  "rows": [
   [
    "20-Minute Introductory Call",
    "Free",
    1,
    "We listen to your situation, tell you which filings apply, and give you a quote. No detailed tax advice on this call."
   ],
   [
    "30-Minute Consultation",
    "$30",
    "",
    "A paid advice session. Bring your own questions and get detailed answers about your U.S. tax position."
   ],
   [
    "LLC Tax Consultation",
    "$30",
    "",
    "How your LLC is taxed and what it must file each year."
   ],
   [
    "Business Tax Consultation",
    "$30",
    "",
    "Business returns, deductions, and deadlines."
   ],
   [
    "Business Structure Consultation",
    "$50",
    "",
    "Choosing between an LLC, partnership, or corporation."
   ],
   [
    "International Tax Consultation",
    "$50",
    "",
    "Foreign ownership, Form 5472, FBAR, and cross-border questions."
   ]
  ]
 },
 "Business Tax": {
  "desc": "Federal returns for corporations, partnerships, and LLCs, plus extensions and catch-up filings.",
  "rows": [
   [
    "Form 5472 + Pro Forma 1120",
    "From $200",
    1
   ],
   [
    "Form 1120 (C Corporation)",
    "From $300"
   ],
   [
    "Form 1065 (Partnership + Schedule K-1)",
    "From $300",
    "",
    "Depending on the number of partners and the activity in the year."
   ],
   [
    "State Business Tax Return",
    "From $100",
    "",
    "Filing fee per state. See the State Tax tab for details."
   ],
   [
    "Form 7004 (Extension)",
    "$100"
   ],
   [
    "FBAR (FinCEN 114)",
    "From $150"
   ],
   [
    "Multi-Year Catch-Up",
    "Quoted by years missed",
    "",
    "Priced on the number of years you missed and the work involved in each."
   ]
  ]
 },
 "Individual Tax": {
  "desc": "Federal returns for individuals, self-employed professionals, business owners, and investors. Individual fees depend on your income sources and complexity, and can be discussed with you.",
  "extras": [
   "Investment income returns"
  ],
  "rows": [
   [
    "Form 1040",
    "From $150"
   ],
   [
    "Self-Employed 1040",
    "From $150"
   ],
   [
    "Business Owner 1040",
    "From $200"
   ],
   [
    "Complex 1040",
    "From $250"
   ],
   [
    "State Individual Return",
    "From $100",
    "",
    "Filing fee per state. See the State Tax tab for details."
   ],
   [
    "Amended Return",
    "From $150",
    "",
    "We first review your original return to find what needs correcting, then file the amendment."
   ],
   [
    "Prior-Year Return",
    "From $200",
    "",
    "A return for a past tax year that was never filed."
   ],
   [
    "Multi-Year Catch-Up",
    "Quoted by years missed",
    "",
    "Priced on the number of years you missed and the work involved in each."
   ]
  ]
 },
 "LLC & Formation": {
  "desc": "We register your U.S. LLC, obtain your EIN, and keep your company in good standing.",
  "extras": [
   "State fees paid on your behalf"
  ],
  "rows": [
   [
    "U.S. LLC Formation",
    "From $200 + state fee"
   ],
   [
    "LLC Formation + EIN",
    "$250 + state fee"
   ],
   [
    "EIN Assistance",
    "$75"
   ],
   [
    "Operating Agreement",
    "$75"
   ],
   [
    "Annual Report Filing",
    "$100 + state fee"
   ],
   [
    "Registered Agent",
    "Separate fee"
   ]
  ]
 },
 "Bookkeeping": {
  "desc": "Accurate monthly bookkeeping in QuickBooks, Xero, or Excel, with records ready for tax time.",
  "extras": [
   "QuickBooks",
   "Xero",
   "Excel",
   "Bank & credit card reconciliation",
   "Transaction categorization",
   "Financial statements"
  ],
  "rows": [
   [
    "Starter Bookkeeping",
    "From $125/month"
   ],
   [
    "Growth Bookkeeping",
    "From $200/month"
   ],
   [
    "Business Bookkeeping",
    "From $300/month"
   ],
   [
    "Catch-Up Bookkeeping",
    "From $250",
    "",
    "Recording months or years of past transactions that were never booked."
   ],
   [
    "Bookkeeping Cleanup",
    "Custom quote",
    "",
    "Correcting errors in existing books so they are accurate and tax-ready."
   ]
  ]
 }
};

const SERVICE_FOR_TAB = {"Foreign-Owned (5472/1120)": "Form 5472 + Pro Forma 1120 (foreign-owned U.S. business)", "State Filings": "State filing or annual report", "Late Filings & IRS": "Late filing or IRS notice", "Consultations": "Consultation", "Business Tax": "Business tax return (1120 / 1065)", "Individual Tax": "Individual tax return (1040)", "LLC & Formation": "LLC formation / EIN", "Bookkeeping": "Bookkeeping (QuickBooks / Xero / Excel)"};
const SLUGS = {"foreign-owned": "Foreign-Owned (5472/1120)", "state-filings": "State Filings", "late-filings": "Late Filings & IRS", "consultations": "Consultations", "business-tax": "Business Tax", "individual-tax": "Individual Tax", "llc-formation": "LLC & Formation", "bookkeeping": "Bookkeeping"};
const MORE_TABS = ["Business Tax", "Individual Tax", "LLC & Formation", "Bookkeeping"];

/* ---------- Carry a chosen service or note to the quote form ---------- */
document.addEventListener("click", e => {
  const a = e.target.closest("[data-service]");
  if (a && a.dataset.service) { store.set("mt_service", a.dataset.service); const s = $("f-service"); if (s) s.value = a.dataset.service; }
}, true);
function carryNote(text) { store.set("mt_msg", text); const m = $("f-msg"); if (m && !m.value) m.value = text + "\n"; }

/* ---------- Pricing tabs (pricing page) ---------- */
(function () {
  const tabs = $("priceTabs"), panel = $("pricePanel"); if (!tabs || !panel) return;
  function show(name) {
    const d = PRICES[name]; if (!d) return;
    if (MORE_TABS.includes(name) && !tabs.classList.contains("show-more")) { tabs.classList.add("show-more"); $("tabToggle").textContent = "Fewer services −"; }
    tabs.querySelectorAll("button[data-k]").forEach(b => b.setAttribute("aria-selected", b.dataset.k === name));
    panel.classList.remove("all-rows");
    panel.innerHTML = `<p class="panel-desc">${esc(d.desc)}</p><div class="table-scroll"><table><thead><tr><th>Service</th><th>Starting price</th></tr></thead><tbody>${
      d.rows.map(([s, p, f, n], ri) => `<tr class="${f ? "featured" : ""}${ri > 4 ? " row-more" : ""}"><td>${esc(s)}${n ? `<small class="row-note">${esc(n)}</small>` : ""}</td><td${/^\$|^From|^Free/.test(p) ? "" : ' class="quote"'}>${esc(p)}</td></tr>`).join("")
    }</tbody></table></div>${d.rows.length > 5 ? `<button type="button" class="rows-toggle" id="rowsToggle" data-more="Show all ${d.rows.length} services">Show all ${d.rows.length} services</button>` : ""}${d.extras ? `<div class="extras"><span>${esc(d.extrasLabel || "Also included:")}</span>${d.extras.map(x => `<em>${esc(x)}</em>`).join("")}</div>` : ""}<div class="panel-cta"><span>${name === "Consultations" ? "Start with a free 20-minute call." : "Ready to get started?"}</span><a class="btn btn-primary" href="${ROOT}contact.html#quote" data-service="${esc(SERVICE_FOR_TAB[name] || "")}">${name === "Consultations" ? "Book a free call" : "Get a free quote"}</a></div>`;
  }
  Object.keys(PRICES).forEach(k => {
    const b = document.createElement("button");
    b.type = "button"; b.setAttribute("role", "tab"); b.dataset.k = k; b.textContent = k;
    if (MORE_TABS.includes(k)) b.classList.add("tab-more");
    b.addEventListener("click", () => show(k));
    tabs.appendChild(b);
  });
  const m = document.createElement("button"); m.type = "button"; m.className = "tab-toggle"; m.id = "tabToggle"; m.textContent = "Other services +";
  m.addEventListener("click", () => { const on = tabs.classList.toggle("show-more"); m.textContent = on ? "Fewer services −" : "Other services +"; });
  tabs.appendChild(m);
  panel.addEventListener("click", e => { const b = e.target.closest("#rowsToggle"); if (!b) return; const on = panel.classList.toggle("all-rows"); b.textContent = on ? "Show fewer" : b.dataset.more; });
  show(SLUGS[location.hash.slice(1)] || "Foreign-Owned (5472/1120)");
  window.addEventListener("hashchange", () => { const n = SLUGS[location.hash.slice(1)]; if (n) show(n); });
})();

/* ---------- Deadlines list (highlights the next one) ---------- */
(function () {
  const list = $("hdList"); if (!list) return;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let best = null, bd = null;
  list.querySelectorAll("li").forEach(li => {
    let d = new Date(now.getFullYear(), +li.dataset.m - 1, +li.dataset.d);
    if (d < now) d = new Date(now.getFullYear() + 1, +li.dataset.m - 1, +li.dataset.d);
    if (!bd || d < bd) { bd = d; best = li; }
  });
  const days = Math.round((bd - now) / 86400000);
  best.classList.add("next");
  best.querySelector("b").dataset.away = days === 0 ? "Today" : days === 1 ? "Tomorrow" : "In " + days + " days";
})();

/* ---------- Compliance check ---------- */
(function () {
  const body = $("qzBody"); if (!body) return;
  const stepEl = $("qzStep"), bar = $("qzBar"), back = $("qzBack");
  const YN = [["yes", "Yes"], ["no", "No"], ["unsure", "I am not sure"]];
  const Q = [
    { k: "type", q: "What type of company do you have?", o: [["llc", "U.S. LLC"], ["corp", "U.S. corporation"], ["none", "Not a U.S. company"]] },
    { k: "own", q: "Who owns the company?", o: [["one", "One owner, living outside the U.S."], ["multi", "Two or more owners, at least one outside the U.S."], ["us", "Only U.S. citizens or residents"]] },
    { k: "state", q: "Where is the company registered?", o: [["wy", "Wyoming"], ["de", "Delaware"], ["nm", "New Mexico"], ["fl", "Florida"], ["other", "Another state"]] },
    { k: "filed", q: "Has the company filed its federal return (such as Form 5472) every year since it was formed?", o: [["yes", "Yes, every year"], ["no", "No, some years were missed"], ["new", "It was formed this year"], ["unsure", "I am not sure"]], skip: a => a.own === "us" },
    { k: "fbar", q: "Did the company hold more than $10,000 in total in accounts outside the U.S. at any time in the year?", o: YN },
    { k: "irs", q: "Have you received a letter or penalty notice from the IRS?", o: [["yes", "Yes"], ["no", "No"]] }
  ];
  let a = {}, i = 0, trail = [];
  function ask() {
    const q = Q[i];
    stepEl.textContent = "Question " + (i + 1) + " of " + Q.length;
    bar.style.width = Math.round(i / Q.length * 100) + "%";
    back.hidden = trail.length === 0;
    body.innerHTML = `<p class="qz-q">${esc(q.q)}</p><div class="qz-opts">${q.o.map(([v, l]) => `<button type="button" class="qz-opt" data-v="${v}">${esc(l)}</button>`).join("")}</div>`;
  }
  function next() {
    do { i++; } while (i < Q.length && Q[i].skip && Q[i].skip(a));
    if (i >= Q.length || a.type === "none") return result();
    ask();
  }
  function items() {
    const L = [];
    if (a.own === "us") L.push(["Form 5472 generally does not apply", "It is mainly for foreign-owned companies. Your company may still need a business or individual return, which we also prepare.", "", "Not required"]);
    else if (a.type === "corp") L.push(["Form 1120 with Form 5472", "A U.S. corporation files Form 1120 each year, with Form 5472 when it is at least 25% foreign-owned.", "from $300", "Likely required"]);
    else if (a.own === "multi") L.push(["Form 1065 partnership return + Schedules K-1", "An LLC with two or more owners is usually taxed as a partnership. Foreign partners can bring extra reporting.", "from $300", "Likely required"]);
    else L.push(["Form 5472 + Pro Forma 1120", "Needed each year by most foreign-owned single-member LLCs, even in a year with no income.", "from $200", "Likely required"]);
    const corp = a.type === "corp";
    const S = {
      wy: ["Wyoming annual report", "Due every year by the first day of the month your company was formed.", "$100 + state fee", "Required"],
      de: corp ? ["Delaware franchise tax and annual report", "Due every year by March 1.", "$100 + state fee", "Required"] : ["Delaware annual LLC tax", "Due every year by June 1.", "$100 + state fee", "Required"],
      nm: corp ? ["New Mexico corporate report", "New Mexico corporations file a periodic report with the state.", "$100 + state fee", "Required"] : ["New Mexico: no annual report", "New Mexico does not require an annual report from LLCs. Your federal filing still applies.", "", "Nothing to file"],
      fl: ["Florida annual report", "Due every year between January 1 and May 1.", "$100 + state fee", "Required"],
      other: ["State annual report or tax filing", "Most states require an annual report or tax filing. We confirm the exact rules for your state.", "$100 + state fee", "To confirm"]
    };
    if (S[a.state]) L.push(S[a.state]);
    if (a.filed === "no") L.push(["Catch-up filing for missed years", "Each missed Form 5472 can carry a $25,000 IRS penalty. We file the missed years and, where it applies, a reasonable cause statement.", "quoted by years missed", "Act soon"]);
    if (a.filed === "unsure") L.push(["Filing history review", "We check which years were filed and which are missing, then catch up any gaps.", "quoted if years are missing", "To confirm"]);
    if (a.fbar === "yes") L.push(["FBAR (FinCEN Form 114)", "Required when accounts outside the U.S. total more than $10,000 at any time in the year.", "from $150", "Likely required"]);
    if (a.fbar === "unsure") L.push(["FBAR (FinCEN Form 114)", "Required only if accounts outside the U.S. total more than $10,000. We confirm this with you.", "from $150", "To confirm"]);
    if (a.irs === "yes") L.push(["IRS notice review", "We review the letter, explain your options, and prepare a response where needed.", "from $150", "Urgent"]);
    return L;
  }
  function result() {
    stepEl.textContent = "Your result"; bar.style.width = "100%"; back.hidden = true;
    const quote = ROOT + "contact.html#quote";
    if (a.type === "none") {
      body.innerHTML = `<h3 class="qz-h">These filings apply to U.S. companies</h3><p class="qz-p">Form 5472 and state annual reports are filed by U.S. LLCs and corporations. If you plan to form one, or your non-U.S. company does business in the U.S., send us a message and we will confirm what applies.</p><div class="btns"><a class="btn btn-primary" href="${quote}">Get a free quote</a><button type="button" class="again">Start again</button></div>`;
      return;
    }
    const L = items();
    const tagClass = g => /Urgent|Act soon/.test(g) ? "hot" : /Not required|Nothing/.test(g) ? "off" : /confirm/.test(g) ? "chk" : "req";
    const summary = L.filter(x => !/Not required|Nothing/.test(x[3])).map(x => x[0]).join("; ");
    body.innerHTML = `<h3 class="qz-h">Your filing checklist</h3><p class="qz-p">Based on your answers, this is what your company most likely needs.</p>
      <ul class="qz-list">${L.map(([n, d, p, g]) => `<li><span class="qz-tag ${tagClass(g)}">${esc(g)}</span><b>${esc(n)}</b><span class="qz-d">${esc(d)}</span>${p ? `<em>${esc(p)}</em>` : ""}</li>`).join("")}</ul>
      <div class="btns"><a class="btn btn-primary" href="${quote}" id="qzCta" data-service="Form 5472 + Pro Forma 1120 (foreign-owned U.S. business)">Get a free quote for this</a><button type="button" class="again">Start again</button></div>`;
    $("qzCta").addEventListener("click", () => carryNote("From my compliance check: " + summary));
  }
  body.addEventListener("click", ev => {
    const o = ev.target.closest(".qz-opt");
    if (o) { a[Q[i].k] = o.dataset.v; trail.push(i); return next(); }
    if (ev.target.closest(".again")) { a = {}; i = 0; trail = []; ask(); }
  });
  back.addEventListener("click", () => { if (!trail.length) return; i = trail.pop(); delete a[Q[i].k]; ask(); });
  ask();
})();

/* ---------- Price estimator ---------- */
(function () {
  const box = $("estimator"); if (!box) return;
  const yrs = $("estYears"), tot = $("estTotal"), mo = $("estMonthly"), note = $("estNote"), cta = $("estCta");
  let text = "";
  function calc() {
    const y = +yrs.value; let once = 0, monthly = 0; const picked = [];
    box.querySelectorAll("input[type=checkbox]:checked").forEach(c => {
      const p = +c.value, u = c.dataset.unit; picked.push(c.nextElementSibling.textContent);
      if (u === "yr") once += p * y; else if (u === "once") once += p; else monthly += p;
    });
    tot.textContent = "$" + once.toLocaleString("en-US");
    mo.hidden = !monthly; mo.textContent = "+ $" + monthly + "/month bookkeeping";
    note.hidden = y < 2;
    text = "Estimate: " + picked.join(", ") + " · " + y + " tax year" + (y > 1 ? "s" : "") + " · est. $" + once + (monthly ? " + $" + monthly + "/mo" : "");
  }
  box.addEventListener("change", calc); calc();
  cta.addEventListener("click", () => carryNote(text));
})();

/* ---------- FAQ: show more ---------- */
(function () {
  const b = $("faqToggle"), m = $("faqMore"); if (!b || !m) return;
  b.dataset.more = b.textContent;
  b.addEventListener("click", () => { m.hidden = !m.hidden; b.textContent = m.hidden ? b.dataset.more : "Show fewer questions"; });
})();

/* ---------- Leave a review ---------- */
(function () {
  const open = $("reviewOpen"), form = $("reviewForm"), msg = $("reviewMsg"); if (!form) return;
  if (SETTINGS.reviewUrl) { const x = $("reviewExt"); x.href = SETTINGS.reviewUrl; x.hidden = false; }
  open.addEventListener("click", () => { form.hidden = !form.hidden; open.setAttribute("aria-expanded", !form.hidden); if (!form.hidden) $("r-name").focus(); });
  form.addEventListener("submit", async e => {
    e.preventDefault(); msg.hidden = false;
    if (!$("r-name").value.trim() || !$("r-text").value.trim()) { msg.textContent = "Please add your name and your review."; return; }
    if (!$("r-consent").checked) { msg.textContent = "Please tick the box to agree that we may publish your review."; return; }
    if (!SETTINGS.formEndpoint) { msg.textContent = "Online reviews are not active yet. Please send your review to us by email or WhatsApp. Thank you!"; return; }
    msg.textContent = "Sending…";
    try {
      const r = await fetch(SETTINGS.formEndpoint, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } }); if (!r.ok) throw 0;
      form.reset(); msg.textContent = "Thank you for your review! We appreciate you taking the time.";
    } catch (_) { msg.textContent = "Your review could not be sent. Please try again, or send it to us by email or WhatsApp."; }
  });
})();

/* ---------- Deadline reminder sign-up ---------- */
(function () {
  const form = $("remindForm"); if (!form) return;
  const msg = $("rmMsg");
  form.addEventListener("submit", async e => {
    e.preventDefault(); msg.hidden = false;
    const email = $("rm-email").value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { msg.textContent = "Please enter a valid email address."; return; }
    if (!SETTINGS.formEndpoint) { msg.textContent = "Sign-up is not active yet. Please message us by email or WhatsApp and we will add you."; return; }
    msg.textContent = "Sending…";
    try {
      const r = await fetch(SETTINGS.formEndpoint, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } }); if (!r.ok) throw 0;
      form.reset(); msg.textContent = "You are on the list. We will remind you before your deadline.";
    } catch (_) { msg.textContent = "That did not go through. Please try again, or message us by email or WhatsApp."; }
  });
})();

/* ---------- Quote form ---------- */
(function () {
  const form = $("quote"); if (!form) return;
  const msg = $("formMsg");
  const svc = store.take("mt_service"), note = store.take("mt_msg");
  if (svc) { const s = $("f-service"); if (s) s.value = svc; }
  if (note) { const m = $("f-msg"); if (m && !m.value) m.value = note + "\n"; }
  form.addEventListener("submit", async e => {
    e.preventDefault(); msg.hidden = false;
    const name = $("f-name").value.trim(), email = $("f-email").value.trim();
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) { msg.textContent = "Please enter your full name and a valid email address."; return; }
    if (!SETTINGS.formEndpoint) { msg.textContent = "Online requests are not active yet. Please contact us directly using the email or WhatsApp number on this page."; return; }
    msg.textContent = "Sending…";
    try {
      const r = await fetch(SETTINGS.formEndpoint, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } }); if (!r.ok) throw 0;
      form.reset(); msg.textContent = "Thank you. Your quote request has been received and we will reply shortly.";
    } catch (_) { msg.textContent = "Your request could not be sent. Please try again, or contact us directly by email or WhatsApp."; }
  });
})();

/* ---------- Navigation ---------- */
(function () {
  const links = $("navLinks"), menuBtn = $("menuBtn");
  const closeSubs = () => document.querySelectorAll(".has-sub.open").forEach(x => { x.classList.remove("open"); x.firstElementChild.setAttribute("aria-expanded", false); });
  const closeMenu = () => { links.classList.remove("open"); menuBtn.setAttribute("aria-expanded", false); };
  menuBtn.addEventListener("click", () => menuBtn.setAttribute("aria-expanded", links.classList.toggle("open")));
  document.querySelectorAll(".sub-toggle").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    const li = b.parentElement, open = !li.classList.contains("open");
    closeSubs();
    if (open) { li.classList.add("open"); b.setAttribute("aria-expanded", true); }
  }));
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closeSubs(); closeMenu(); } });
  document.addEventListener("click", e => {
    if (!e.target.closest(".has-sub")) closeSubs();
    const a = e.target.closest('a[href^="#"]'); if (!a) return;
    const el = $(a.getAttribute("href").slice(1)); if (!el) return;
    e.preventDefault(); closeSubs(); closeMenu();
    if (el.tagName === "DETAILS") el.open = true;
    el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  });
  if (location.hash) { const t = $(location.hash.slice(1)); if (t && t.tagName === "DETAILS") t.open = true; }
})();

/* ---------- Phone action bar: show after the top section ---------- */
(function () {
  const bar = $("mBar"), hero = document.querySelector(".hero, .page-hero"); if (!bar || !hero) return;
  const upd = () => bar.classList.toggle("show", window.scrollY > hero.offsetHeight - 160);
  window.addEventListener("scroll", upd, { passive: true }); upd();
})();
