"use strict";

// Notebook view, written like a notes app. The months run on as one long article, newest first:
// a big month heading (with the month's total) > a day heading > one section per tag, then the
// day's total. Each section is plain ruled paper: write on any line, Enter for a new line,
// Backspace to join lines. Every line with an amount ("Petrol - 3000", "chai 25") is an expense
// of that tag; the totals follow as you type and the lines save themselves. Lines without an
// amount stay on the page as plain notes. Write "#food" in a line to move it to that tag, or a
// date ("28 Oct") on a line + Enter to turn to that day. It edits the same data as the list view.

const nb = { months: [], loaded: 0, pages: new Map(), monthTotals: new Map(), loading: false, observer: null, dirty: new Set() };

const MISC = "misc";            // the section for lines without a tag
const LINE = 38;                 // px between the rules; matches .d-area in app.css
const DRAFTS = "nbDrafts";       // lines without an amount, kept on this phone

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

// "#food" (or "#misc") in a line -> { key, text without it }; key is null when there is none.
function takeTagMark(text) {
  let key = null;
  const rest = text.replace(/(^|\s)#([a-z0-9][a-z0-9_&/+-]*)/gi, (all, sp, word) => {
    const name = word.toLowerCase();
    if (key || (name !== MISC && !isKnownTag(name))) return all;
    key = name;
    return sp;
  });
  return { key, text: rest.replace(/\s+/g, " ").trim() };
}

// A line of the page -> { name, paise } if it is an expense, or null if it is just a note.
function readLine(line) {
  const t = line.trim();
  if (!t || parseDateLine(t)) return null;
  const parsed = parseEntry(t);
  return parsed && parsed.name.length <= 100 ? parsed : null;
}
// Where to tuck the amount away on a written line: the amount and the "-" before it, or null.
function amountSpot(line) {
  if (!readLine(line) || takeTagMark(line).key) return null;
  const p = parseEntry(line);
  let start = p.at, end = p.at + p.len;
  while (start > 0 && /[\s\-:,@]/.test(line[start - 1])) start--;
  while (end < line.length && /[\s\-:,@]/.test(line[end])) end++;
  return { start, end, paise: p.paise };
}
const lineOf = (rec) => `${rec.name} - ${amountText(rec.amount_paise)}`;

// The section an expense is written under: its first listed tag, or misc.
const sectionKeyOf = (tags) => tags.find(isKnownTag) || MISC;
const sectionOrder = (key) => (key === MISC ? TAGS.length : TAGS.findIndex(([n]) => n === key));
const sectionColor = (key) => (key === MISC ? "#8a93a3" : tagColor(key));
const sectionTitle = (key) => (key === MISC ? "Miscellaneous" : tagLabel(key));

// ---------- notes kept on this phone ----------
const readDrafts = () => { const d = readJson(DRAFTS); return d && typeof d === "object" ? d : {}; };
function saveDraft(section, lines) {
  const all = readDrafts();
  const k = `${section.page.date}|${section.key}`;
  if (lines.length) all[k] = lines.join("\n"); else delete all[k];
  try { localStorage.setItem(DRAFTS, JSON.stringify(all)); } catch { /* storage full */ }
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
  const yms = nb.months.slice(0, nb.loaded);
  const chunks = await Promise.all(yms.map((ym) => api("GET", `/api/expenses?month=${ym}`)));
  $("nb-page").replaceChildren();
  nb.pages = new Map();
  nb.monthTotals = new Map();
  const today = ensureDay(todayStr());
  addItems(chunks.flat(), yms);
  const first = today.body.querySelector(".d-area");
  if (first) first.placeholder = "write here, like: chai 25";
  drawMore();
}

// Pages newest first; within a section, lines in the order they were written, then the notes.
function addItems(items, yms) {
  const touched = new Set();
  for (const it of [...items].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id - b.id))) {
    const section = ensureSection(ensureDay(it.date), sectionKeyOf(it.tags));
    section.records.push(it);
    touched.add(section);
  }
  const drafts = new Map();
  for (const [k, text] of Object.entries(readDrafts())) {
    const [date, key] = k.split("|");
    if (!yms.includes(date.slice(0, 7)) || typeof text !== "string") continue;
    const section = ensureSection(ensureDay(date), key === MISC || isKnownTag(key) ? key : MISC);
    drafts.set(section, [...(drafts.get(section) || []), text]);
    touched.add(section);
  }
  for (const s of touched) {
    s.area.value = [...s.records.map(lineOf), ...(drafts.get(s) || [])].join("\n");
    fit(s);
  }
  updateTotals();
}

// Older months come in as you scroll down to them (the button is there too).
function drawMore() {
  const more = $("nb-more");
  more.replaceChildren();
  if (nb.loaded >= nb.months.length) return;
  const btn = el("button", { type: "button", text: `Turn back to ${monthName(nb.months[nb.loaded], { month: "long", year: "numeric" })}` });
  btn.addEventListener("click", loadOlder);
  more.append(btn);
  if (!("IntersectionObserver" in window)) return;
  if (!nb.observer) {
    nb.observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !$("view-notebook").hidden) loadOlder();
    }, { rootMargin: "400px 0px" });
  }
  nb.observer.disconnect();
  nb.observer.observe(more);         // observing again re-checks, so a short month keeps loading
}

async function loadOlder() {
  if (nb.loading || nb.loaded >= nb.months.length) return;
  nb.loading = true;
  try {
    const ym = nb.months[nb.loaded];
    const items = await api("GET", `/api/expenses?month=${ym}`);
    nb.loaded += 1;
    addItems(items, [ym]);
  } catch { /* signed out */ }
  nb.loading = false;
  drawMore();
}

// ---------- the article: month heading > day heading > tag sections ----------
function ensureMonth(ym) {
  const page = $("nb-page");
  const groups = [...page.querySelectorAll(":scope > .d-monthgroup")];
  const found = groups.find((g) => g.dataset.ym === ym);
  if (found) return found;
  const total = el("span", { class: "d-monthtotal" });
  nb.monthTotals.set(ym, total);
  const group = el("section", { class: "d-monthgroup", "data-ym": ym },
    el("h2", { class: "d-month" }, el("span", { class: "d-monthname", text: monthName(ym, { month: "long", year: "numeric" }) }), total));
  const before = groups.find((g) => g.dataset.ym < ym);
  if (before) before.before(group); else page.append(group);
  return group;
}

// Every page is laid out with a section per tag, ready to write in, like a notes template.
function ensureDay(date) {
  let page = nb.pages.get(date);
  if (page) return page;
  const month = ensureMonth(date.slice(0, 7));
  const [y, m, d] = date.split("-").map(Number);
  const when = new Date(y, m - 1, d);
  const total = el("span", { class: "d-totalamt" });
  const body = el("div", { class: "d-body" });
  const head = el("h3", { class: "d-head" },
    el("span", { class: "d-date", text: when.toLocaleDateString("en-IN", { day: "numeric", month: "long" }) }),
    el("span", { class: "d-weekday", text: when.toLocaleDateString("en-IN", { weekday: "long" }) }));
  if (date === todayStr()) head.append(el("span", { class: "d-today", text: "today" }));
  const node = el("article", { class: "d-page", "data-date": date }, head, body,
    el("div", { class: "d-total" }, el("span", { text: "Total" }), total));
  page = { date, node, body, total, sections: new Map() };
  nb.pages.set(date, page);

  const siblings = [...month.querySelectorAll(":scope > .d-page")];
  const before = siblings.find((p) => p.dataset.date < date);
  if (before) before.before(node); else month.append(node);
  for (const [name] of TAGS) ensureSection(page, name);
  ensureSection(page, MISC);
  return page;
}

function ensureSection(page, key, lines = 2) {
  let section = page.sections.get(key);
  if (section) return section;
  const total = el("span", { class: "d-sectotal" });
  const hint = el("span", { class: "d-hint" });
  const area = el("textarea", {
    class: "d-area", rows: "1", autocomplete: "off", autocapitalize: "sentences", spellcheck: "false",
    enterkeyhint: "enter", "aria-label": `${sectionTitle(key)} on ${page.date}`,
  });
  const mirror = el("div", { class: "d-mirror", "aria-hidden": "true" });
  const node = el("section", { class: "d-sec", "data-key": key },
    el("h4", { class: "d-sechead", text: sectionTitle(key) }), el("div", { class: "d-paper" }, mirror, area),
    el("div", { class: "d-secfoot" }, hint, total));
  node.style.setProperty("--tc", sectionColor(key));
  section = { key, tag: key === MISC ? null : key, page, node, area, mirror, total, hint, min: lines, records: [], chain: Promise.resolve(), timer: 0 };
  page.sections.set(key, section);
  const order = sectionOrder(key);
  const after = [...page.sections.values()].find((s) => s !== section && sectionOrder(s.key) > order);
  if (after) after.node.before(node); else page.body.append(node);
  wireArea(section);
  fit(section);
  return section;
}

// The paper grows with what is written, keeping one empty line to write on below it.
function fit(section) {
  const a = section.area;
  if (!a.isConnected) return;
  const y = window.scrollY;
  a.style.height = "0";
  const extra = a.value === "" || a.value.endsWith("\n") ? 0 : LINE;
  a.style.height = `${Math.max(section.min * LINE, a.scrollHeight + extra)}px`;
  if (window.scrollY !== y) window.scrollTo(0, y);
  drawMirror(section);
}

// What you see is a copy of the text drawn under the (see-through) text box: written lines show
// the amount over on the right, while the line you are on shows exactly what you typed. The copy
// keeps every character in place (the moved amount is only hidden), so the lines wrap the same.
function drawMirror(section) {
  const a = section.area;
  let from = -1, to = -1;
  if (document.activeElement === a) {
    from = a.value.slice(0, a.selectionStart).split("\n").length - 1;
    to = a.value.slice(0, a.selectionEnd).split("\n").length - 1;
  }
  section.mirror.replaceChildren(...a.value.split("\n").map((line, i) => {
    const spot = i >= from && i <= to ? null : amountSpot(line);
    if (!spot) return el("div", { class: "d-ml", text: line || "\u200b" });
    return el("div", { class: "d-ml" }, line.slice(0, spot.start),
      el("span", { class: spot.start ? "d-hide" : "d-hide lead", text: line.slice(spot.start, spot.end) }), line.slice(spot.end),
      el("span", { class: "d-mamt", text: inr(spot.paise) }));
  }));
  // "25 water can": the amount leaves a gap in front; close it when the line fits on one row anyway.
  for (const hide of section.mirror.querySelectorAll(".d-hide.lead")) {
    if (hide.parentElement.offsetHeight <= LINE) hide.remove();
  }
}
document.addEventListener("selectionchange", () => {
  const a = document.activeElement;
  if (!a || !a.classList.contains("d-area")) return;
  for (const p of nb.pages.values()) for (const s of p.sections.values()) if (s.area === a) drawMirror(s);
});
window.addEventListener("resize", () => { for (const p of nb.pages.values()) for (const s of p.sections.values()) fit(s); });

function updateTotals() {
  const day = new Map();
  const month = new Map();
  const add = (map, k, v) => map.set(k, (map.get(k) || 0) + v);
  for (const [date, page] of nb.pages) {
    for (const s of page.sections.values()) {
      let sum = 0, notes = 0;
      for (const line of s.area.value.split("\n")) {
        const parsed = readLine(takeTagMark(line).text);
        if (parsed) sum += parsed.paise;
        else if (line.trim() && !parseDateLine(line)) notes += 1;
      }
      s.total.textContent = sum ? inr(sum) : "";
      s.hint.textContent = notes ? `${notes} line${notes === 1 ? "" : "s"} without an amount` : "";
      add(day, date, sum);
      add(month, date.slice(0, 7), sum);
    }
    page.total.textContent = day.get(date) ? inr(day.get(date)) : "";
  }
  for (const [ym, node] of nb.monthTotals) node.textContent = inr(month.get(ym) || 0);
}

// Write a date on a line and the notebook opens that day's page, at the same tag.
function gotoPage(date, key) {
  const page = ensureDay(date);
  const section = ensureSection(page, key);
  updateTotals();
  const a = section.area;
  if (a.value && !a.value.endsWith("\n")) { a.value += "\n"; fit(section); }
  a.focus();
  a.setSelectionRange(a.value.length, a.value.length);
  page.node.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------- writing ----------
function wireArea(section) {
  const a = section.area;
  a.addEventListener("input", (e) => {
    fit(section);
    updateTotals();
    if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") flush(section);
    else schedule(section);
  });
  a.addEventListener("blur", () => { drawMirror(section); flush(section); });
  a.addEventListener("focus", () => drawMirror(section));
  a.addEventListener("keydown", (e) => {
    const v = a.value, pos = a.selectionStart;
    if (e.key === "Enter") {
      const start = v.lastIndexOf("\n", pos - 1) + 1;
      const end = v.indexOf("\n", pos) < 0 ? v.length : v.indexOf("\n", pos);
      const date = parseDateLine(v.slice(start, end));
      if (!date) return;
      e.preventDefault();
      a.value = v.slice(0, start) + v.slice(end + 1);
      fit(section);
      updateTotals();
      gotoPage(date, section.key);
    } else if ((e.key === "ArrowDown" && !v.includes("\n", pos)) || (e.key === "ArrowUp" && !v.slice(0, pos).includes("\n"))) {
      // Past the first or last line: on to the next section, like one long page.
      const all = [...$("nb-page").querySelectorAll(".d-area")];
      const next = all[all.indexOf(a) + (e.key === "ArrowUp" ? -1 : 1)];
      if (!next) return;
      e.preventDefault();
      next.focus();
      const at = e.key === "ArrowUp" ? next.value.length : 0;
      next.setSelectionRange(at, at);
    }
  });
}

function schedule(section) {
  nb.dirty.add(section);
  clearTimeout(section.timer);
  section.timer = setTimeout(() => flush(section), 1200);
}

function flush(section) {
  clearTimeout(section.timer);
  nb.dirty.delete(section);
  section.chain = section.chain.then(() => save(section)).catch((err) => { if (err.message !== "Signed out") toast(err.message); });
}
// Leaving the app saves what is still waiting.
document.addEventListener("visibilitychange", () => { if (document.hidden) for (const s of [...nb.dirty]) flush(s); });

function appendLine(section, text) {
  const a = section.area;
  a.value = a.value.replace(/\n*$/, "") ? `${a.value.replace(/\n*$/, "")}\n${text}` : text;
  fit(section);
}

// Brings the stored expenses in line with what is written on the section's paper.
async function save(section) {
  const a = section.area;
  // "#food" lines go over to that tag first.
  const lines = a.value.split("\n");
  let moved = false;
  const kept = [];
  for (const line of lines) {
    const mark = takeTagMark(line);
    if (!mark.key) { kept.push(line); continue; }
    moved = true;
    if (mark.key === section.key || !mark.text) { kept.push(mark.text); continue; }
    const target = ensureSection(section.page, mark.key);
    appendLine(target, mark.text);
    flush(target);
  }
  if (moved) {
    const caret = Math.min(a.selectionStart, kept.join("\n").length);
    a.value = kept.join("\n");
    if (document.activeElement === a) a.setSelectionRange(caret, caret);
    fit(section);
    updateTotals();
  }

  const wanted = [];
  const notes = [];
  for (const line of kept) {
    const parsed = readLine(line);
    if (parsed) wanted.push(parsed);
    else if (line.trim()) notes.push(line.trim());
  }
  saveDraft(section, notes);

  // Pair each line with an expense: same words and amount first, then the rest in order (edits).
  const old = [...section.records];
  const pairs = wanted.map((w) => {
    const i = old.findIndex((r) => r.name === w.name && r.amount_paise === w.paise);
    return i < 0 ? null : old.splice(i, 1)[0];
  });
  for (let i = 0; i < wanted.length; i++) if (!pairs[i] && old.length) pairs[i] = old.shift();

  const records = [];
  for (let i = 0; i < wanted.length; i++) {
    const w = wanted[i], rec = pairs[i];
    const body = { name: w.name, amount: amountText(w.paise), date: section.page.date, note: rec ? rec.note : "", tags: rec ? rec.tags : section.tag ? [section.tag] : [] };
    try {
      if (!rec) records.push(await api("POST", "/api/expenses", body));
      else if (rec.name !== w.name || rec.amount_paise !== w.paise) records.push(await api("PUT", `/api/expenses/${rec.id}`, body));
      else records.push(rec);
    } catch (err) {
      if (rec) records.push(rec);
      if (err.message !== "Signed out") toast(err.message);
    }
  }
  const gone = [];
  for (const rec of old) {
    try { await api("DELETE", `/api/expenses/${rec.id}`); gone.push(rec); } catch (err) { records.push(rec); toast(err.message); }
  }
  section.records = records;

  if (gone.length) {
    toast(gone.length === 1 ? `Struck out ${gone[0].name}` : `Struck out ${gone.length} lines`, "Undo", async () => {
      for (const rec of gone) appendLine(section, lineOf(rec));
      updateTotals();
      flush(section);
      await section.chain;
    });
  }
}
