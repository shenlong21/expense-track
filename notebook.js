"use strict";

// Notebook view, written like a paper diary. Each day is a page of ruled paper, newest page
// first (today at the top). You write straight onto the next blank line: "chai 25" + Enter
// and the line is inked, and a fresh blank line opens below it. Write a date on a blank line
// ("28 Oct") to turn to that day's page. It edits the same data as the list view.

const nb = { rows: [], months: [], loaded: 0, pages: new Map(), monthTotals: new Map() };

// ---------- dates written on a line ----------
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december"];

function monthIndex(word) {
  if (word.length < 3) return -1;
  return MONTH_NAMES.findIndex((n) => n.startsWith(word));
}

// "29 Oct", "Oct 29", "29/10", "29-10-2026", "today", "yesterday" -> "YYYY-MM-DD" or null
function parseDateLine(text) {
  const t = text.trim().toLowerCase().replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
  const now = new Date();
  const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  if (t === "today") return todayStr();
  if (t === "yesterday") { const d = new Date(now); d.setDate(d.getDate() - 1); return iso(d.getFullYear(), d.getMonth(), d.getDate()); }
  let m, d, mo, y;
  if ((m = t.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9})(?: (\d{4}))?$/))) { d = +m[1]; mo = monthIndex(m[2]); y = m[3]; }
  else if ((m = t.match(/^([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/))) { mo = monthIndex(m[1]); d = +m[2]; y = m[3]; }
  else if ((m = t.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?$/))) { d = +m[1]; mo = +m[2] - 1; y = m[3]; }
  else return null;
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  let year = y ? +y : now.getFullYear();
  let date = new Date(year, mo, d);
  // A date without a year that lands well in the future means last year.
  if (!y && date - now > 31 * 864e5) { year -= 1; date = new Date(year, mo, d); }
  if (date.getMonth() !== mo || date.getDate() !== d || year < 2000 || year > 2100) return null;
  return iso(year, mo, d);
}

// ---------- loading ----------
async function renderNotebook() {
  const list = await api("GET", "/api/months");
  const months = new Set(list.map((m) => m.month));
  months.add(currentYm());
  nb.months = [...months].sort().reverse();
  if (!nb.loaded) nb.loaded = Math.min(2, nb.months.length);
  await loadNotebook();
}

async function loadNotebook() {
  const chunks = await Promise.all(nb.months.slice(0, nb.loaded).map((ym) => api("GET", `/api/expenses?month=${ym}`)));
  // Pages newest first; within a page, lines in the order they were written.
  const items = chunks.flat().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id - b.id));
  buildPage(items);
}

function buildPage(items) {
  $("nb-page").replaceChildren();
  nb.rows = [];
  nb.pages = new Map();
  nb.monthTotals = new Map();
  ensureDay(todayStr());
  for (const it of items) {
    const page = ensureDay(it.date);
    const row = makeRow(it);
    nb.rows.push(row);
    page.blank.node.before(row.node);
  }

  const more = $("nb-more");
  more.replaceChildren();
  if (nb.loaded < nb.months.length) {
    const btn = el("button", { type: "button", text: "Turn back to older pages" });
    btn.addEventListener("click", async () => { nb.loaded += 1; try { await loadNotebook(); } catch { /* signed out */ } });
    more.append(btn);
  }
  updateTotals();
}

// ---------- the diary: month ribbon > day page > ruled lines ----------
function ensureMonth(ym) {
  const page = $("nb-page");
  const groups = [...page.querySelectorAll(":scope > .d-monthgroup")];
  const found = groups.find((g) => g.dataset.ym === ym);
  if (found) return found;
  const total = el("span", { class: "d-monthtotal" });
  nb.monthTotals.set(ym, total);
  const group = el("section", { class: "d-monthgroup", "data-ym": ym },
    el("div", { class: "d-month" }, el("span", { class: "d-monthname", text: monthName(ym, { month: "long", year: "numeric" }) }), total));
  const before = groups.find((g) => g.dataset.ym < ym);
  if (before) before.before(group); else page.append(group);
  return group;
}

function ensureDay(date) {
  let page = nb.pages.get(date);
  if (page) return page;
  const month = ensureMonth(date.slice(0, 7));
  const [y, m, d] = date.split("-").map(Number);
  const when = new Date(y, m - 1, d);
  const total = el("span", { class: "d-totalamt" });
  const totalRow = el("div", { class: "d-total", hidden: "" }, el("span", { text: "Total" }), total);
  const lines = el("div", { class: "d-lines" });
  const head = el("div", { class: "d-head" },
    el("span", { class: "d-date", text: when.toLocaleDateString("en-IN", { day: "numeric", month: "long" }) }),
    el("span", { class: "d-weekday", text: when.toLocaleDateString("en-IN", { weekday: "long" }) }));
  if (date === todayStr()) head.append(el("span", { class: "d-today", text: "today" }));
  const node = el("article", { class: "d-page", "data-date": date }, head, lines, totalRow);
  page = { date, node, lines, total, totalRow, blank: null };
  nb.pages.set(date, page);

  const siblings = [...month.querySelectorAll(":scope > .d-page")];
  const before = siblings.find((p) => p.dataset.date < date);
  if (before) before.before(node); else month.append(node);
  addBlank(page);
  return page;
}

// Every page always ends with one blank line to write on.
function addBlank(page) {
  const blank = makeRow({ date: page.date });
  blank.blank = true;
  if (page.date === todayStr()) blank.input.placeholder = "write here, like: chai 25";
  page.lines.append(blank.node);
  nb.rows.push(blank);
  page.blank = blank;
  return blank;
}

function updateTotals() {
  const day = new Map();
  const month = new Map();
  for (const r of nb.rows) {
    if (r.bad || !r.paise) continue;
    day.set(r.date, (day.get(r.date) || 0) + r.paise);
    month.set(r.date.slice(0, 7), (month.get(r.date.slice(0, 7)) || 0) + r.paise);
  }
  for (const [date, page] of nb.pages) {
    const sum = day.get(date) || 0;
    page.totalRow.hidden = !sum;
    page.total.textContent = sum ? inr(sum) : "";
  }
  for (const [ym, node] of nb.monthTotals) node.textContent = inr(month.get(ym) || 0);
}

// Write a date on a blank line and the diary opens that day's page.
function gotoPage(date) {
  const page = ensureDay(date);
  updateTotals();
  page.blank.input.focus();
  page.node.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------- lines ----------
function makeRow(d) {
  const row = {
    id: d.id ?? null, name: d.name || "", paise: d.amount_paise || 0, date: d.date,
    note: d.note || "", tags: d.tags || [], bad: false, raw: "", removed: false, dirty: false, blank: false,
    chain: Promise.resolve(),
  };
  row.input = el("input", {
    class: "d-in", autocomplete: "off", maxlength: "120", enterkeyhint: "next",
    autocapitalize: "sentences", "aria-label": "Diary line",
  });
  row.amt = el("span", { class: "d-amt" });
  row.node = el("div", { class: "d-row" }, row.input, row.amt);
  paint(row);

  row.input.addEventListener("input", () => { row.dirty = true; });
  row.input.addEventListener("focus", () => { row.input.value = rawText(row); });
  row.input.addEventListener("blur", () => commit(row, false));
  row.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(row, true); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const all = [...$("nb-page").querySelectorAll(".d-in")];
      const next = all[all.indexOf(row.input) + (e.key === "ArrowUp" ? -1 : 1)];
      if (next) { e.preventDefault(); next.focus(); }
    }
  });
  return row;
}

const rawText = (row) => (row.bad ? row.raw : row.name ? `${row.name} ${amountText(row.paise)}` : "");

// Once inked: the words on the left, the amount tidied to the right.
function paint(row) {
  row.input.value = row.bad ? row.raw : row.name;
  row.amt.textContent = row.bad ? "needs an amount" : row.paise ? inr(row.paise) : "";
  row.node.classList.toggle("bad", row.bad);
}

function commit(row, viaEnter) {
  if (row.removed) return;
  const page = nb.pages.get(row.date);
  if (!row.dirty) {                               // nothing written: just tidy up
    paint(row);
    if (viaEnter && !row.bad) {
      const all = [...page.lines.querySelectorAll(".d-in")];
      const next = all[all.indexOf(row.input) + 1];
      if (next) next.focus();
    }
    return;
  }
  row.dirty = false;
  const text = row.input.value.trim();

  if (!text) {
    if (row.blank) paint(row); else removeRow(row, true);   // wiping out a line removes the expense
    return;
  }
  if (row.blank) {
    const date = parseDateLine(text);
    if (date) { row.input.value = ""; paint(row); gotoPage(date); return; }
  }
  const parsed = parseEntry(text);
  if (!parsed) {
    row.bad = true; row.raw = text; row.paise = 0;
    paint(row); updateTotals();
    toast("Add an amount, like: chai 25");
    return;
  }
  row.bad = false;
  row.name = parsed.name;
  row.paise = parsed.paise;
  paint(row);
  updateTotals();
  row.chain = row.chain.then(() => persist(row));

  if (row.blank) {                                // the blank line is now written: open the next one
    row.blank = false;
    row.input.removeAttribute("placeholder");
    const next = addBlank(page);
    if (viaEnter) next.input.focus();             // synchronous, so the phone keyboard stays up
  } else if (viaEnter) {
    row.input.blur();
  }
}

async function persist(row) {
  const body = { name: row.name, amount: amountText(row.paise), date: row.date, note: row.note, tags: row.tags };
  try {
    if (row.id) await api("PUT", `/api/expenses/${row.id}`, body);
    else row.id = (await api("POST", "/api/expenses", body)).id;
  } catch (err) {
    if (err.message === "Signed out") return;
    toast(err.message);
    row.bad = true; row.raw = rawText({ ...row, bad: false }); row.paise = 0;
    paint(row); updateTotals();
  }
}

function removeRow(row, offerUndo) {
  const idx = nb.rows.indexOf(row);
  if (idx < 0) return;
  const snap = { name: row.name, amount: amountText(row.paise), date: row.date, note: row.note, tags: row.tags };
  const hadAmount = row.paise > 0;
  row.removed = true;
  nb.rows.splice(idx, 1);
  row.node.remove();

  const page = nb.pages.get(row.date);
  if (page && page.lines.children.length <= 1 && page.date !== todayStr()) {   // an empty old page closes
    const month = page.node.parentElement;
    nb.pages.delete(page.date);
    page.node.remove();
    nb.rows = nb.rows.filter((r) => r !== page.blank);
    if (!month.querySelector(".d-page")) { nb.monthTotals.delete(month.dataset.ym); month.remove(); }
  }
  updateTotals();

  row.chain = row.chain.then(async () => { if (row.id) await api("DELETE", `/api/expenses/${row.id}`); });
  if (offerUndo && snap.name && hadAmount) {
    toast(`Struck out ${snap.name}`, "Undo", async () => {
      await row.chain;
      await api("POST", "/api/expenses", snap);
      await loadNotebook();
    });
  }
}
