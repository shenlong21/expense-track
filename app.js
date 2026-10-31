"use strict";

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);

function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...kids);
  return node;
}

function inr(paise) {
  const whole = paise % 100 === 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR",
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
  }).format(paise / 100);
}

const pad = (n) => String(n).padStart(2, "0");
const currentYm = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const todayStr = () => `${currentYm()}-${pad(new Date().getDate())}`;

function monthName(ym, opts) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", opts);
}
function shortDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
const amountText = (paise) => (paise / 100).toFixed(paise % 100 ? 2 : 0);

// "1,250.5" / "₹ 40" -> paise, or null if not a valid positive amount
function parseAmount(text) {
  const t = text.replace(/[₹,\s]/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  const paise = Math.round(parseFloat(t) * 100);
  return paise > 0 ? paise : null;
}

// The tags offered while typing an expense. Each has its own colour, used on badges and in the charts.
const BASE_TAGS = [
  ["rent", "#7c5cff"], ["groceries", "#2e9e5b"], ["travel", "#1f8ef1"], ["shopping", "#e0489b"], ["food", "#f08a24"],
];
// Tags you add yourself are kept on this phone, each with the next colour from this palette.
const TAG_PALETTE = ["#00a5a8", "#c239b3", "#d13438", "#6b8e23", "#ca5010", "#0099bc", "#8e8cd8", "#986f0b"];
const validTags = (v) => (Array.isArray(v) ? v.filter((t) => Array.isArray(t) && typeof t[0] === "string" && /^#[0-9a-f]{6}$/i.test(t[1])) : []);
const readJson = (key) => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } };
// The tag list lives on this phone; the Tags screen adds, recolours, renames and deletes.
const TAGS = (() => {
  const saved = readJson("tagList");
  if (Array.isArray(saved)) return validTags(saved);
  return [...BASE_TAGS, ...validTags(readJson("customTags"))];   // first run, or from an older version
})();
function saveTags() {
  try { localStorage.setItem("tagList", JSON.stringify(TAGS)); } catch { /* storage full */ }
}
const nextTagColor = () => TAG_PALETTE.find((c) => !TAGS.some((t) => t[1] === c)) || TAG_PALETTE[TAGS.length % TAG_PALETTE.length];

// "  Pets " -> "pets"; null if it is not a valid tag name.
function cleanTagName(raw) {
  const name = String(raw).trim().toLowerCase().split(/\s+/).join(" ");
  return /^[a-z0-9][a-z0-9 _&/+-]{0,29}$/.test(name) ? name : null;
}

// Adds the tag to the list (if new) and returns its name, or null if the name is not valid.
function addCustomTag(raw, color) {
  const name = cleanTagName(raw);
  if (!name) return null;
  if (!TAGS.some(([n]) => n === name)) { TAGS.push([name, color || nextTagColor()]); saveTags(); }
  return name;
}
const tagColor = (tag) => (TAGS.find(([n]) => n === tag) || [, "#8a93a3"])[1];

const isKnownTag = (tag) => TAGS.some(([n]) => n === tag);

function tagBadge(tag) {
  const b = el("span", { class: "tagbadge", text: tag });
  b.style.setProperty("--tc", tagColor(tag));
  return b;
}

// A row of tag badges to pick one from. Hidden until there is something typed (sync).
function tagPicker(initial = null, onChange) {
  let value = initial;
  const node = el("div", { class: "tagrow", hidden: "", role: "group", "aria-label": "Tag" });
  const makeButton = (name) => {
    const b = tagBadge(name);
    b.className = "tagbadge pick";
    b.setAttribute("role", "button");
    b.tabIndex = 0;
    b.addEventListener("mousedown", (e) => e.preventDefault());   // keep the keyboard and the text field focused
    b.addEventListener("click", () => {
      value = value === name ? null : name;
      paint();
      if (onChange) onChange(value ? [value] : []);
    });
    return [name, b];
  };
  const buttons = TAGS.map(([name]) => makeButton(name));
  function paint() { for (const [name, b] of buttons) b.classList.toggle("on", name === value); }
  let editing = false;
  const plus = el("span", { class: "tagbadge pick add", role: "button", text: "+ New" });
  plus.tabIndex = 0;
  plus.addEventListener("mousedown", (e) => e.preventDefault());
  plus.addEventListener("click", startNew);
  node.append(...buttons.map(([, b]) => b), plus);
  paint();

  // "+ New" turns into a small text box; Enter makes the tag and selects it.
  function startNew() {
    const anchor = document.activeElement;   // the text field you were typing in
    const input = el("input", { class: "tagnew", placeholder: "New tag", maxlength: "30", autocomplete: "off", enterkeyhint: "done", "aria-label": "New tag name" });
    editing = true;
    plus.replaceWith(input);
    let done = false;
    const finish = (commit, refocus) => {
      if (done) return;
      done = true;
      const name = commit ? addCustomTag(input.value) : null;
      if (commit && input.value.trim() && !name) toast("Tags use letters, numbers and spaces (up to 30)");
      input.replaceWith(plus);
      if (name) {
        let pair = buttons.find(([n]) => n === name);
        if (!pair) { pair = makeButton(name); buttons.push(pair); plus.before(pair[1]); }
        value = name;
        paint();
        if (onChange) onChange([name]);
      }
      editing = false;
      if (refocus && anchor && anchor.focus) anchor.focus();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true, true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false, true); }
    });
    input.addEventListener("blur", () => finish(true, false));
    input.focus();
  }
  return {
    node,
    get value() { return value ? [value] : []; },
    get editing() { return editing; },
    sync(text) { node.hidden = !text.trim(); },
    reset() { value = null; paint(); node.hidden = true; },
  };
}

let toastTimer;
function toast(msg, actionLabel, action) {
  $("toast-msg").textContent = msg;
  const btn = $("toast-action");
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || "";
  btn.onclick = actionLabel ? async () => { hideToast(); await action(); } : null;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, actionLabel ? 7000 : 4000);
}
function hideToast() { $("toast").hidden = true; }

// ---------- data ----------
// Everything is stored on this phone (see local.js); there is no server and no login.
const api = (method, path, body) => localApi(method, path, body);

async function showApp() {
  $("app").hidden = false;
  await show(homeView());
}

// ---------- backup ----------
function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function backupNote() {
  const last = Number(localStorage.getItem("lastBackup") || 0);
  if (!last) return "Never backed up";
  const days = Math.floor((Date.now() - last) / 864e5);
  return days < 1 ? "Last backup: today" : `Last backup: ${days} day${days === 1 ? "" : "s"} ago`;
}

$("export").addEventListener("click", async () => {
  try {
    download(`expenses-${todayStr()}.csv`, await exportCsv());
    localStorage.setItem("lastBackup", String(Date.now()));
    toast("Backup saved to your downloads");
  } catch (err) { toast(err.message); }
});

$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const { added, skipped } = await importCsv(await file.text());
    toast(`Restored ${added} entr${added === 1 ? "y" : "ies"}${skipped ? `, skipped ${skipped} already here or invalid` : ""}`);
    await show(homeView());
  } catch (err) { toast(err.message); }
});

$("menu-btn").addEventListener("click", (e) => { e.stopPropagation(); $("backup-note").textContent = backupNote(); $("menu").hidden = !$("menu").hidden; });
document.addEventListener("click", () => { $("menu").hidden = true; });

// ---------- editable lines ----------
// Every row is plain inputs that save themselves when you leave the field.

function textInput(cls, value, placeholder, extra) {
  const i = el("input", { class: cls, placeholder: placeholder || "", autocomplete: "off", ...extra });
  i.value = value;
  i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); i.blur(); } });
  return i;
}
const nameInput = (v) => textInput("nm", v, "What for?", { maxlength: "100", enterkeyhint: "next", autocapitalize: "sentences" });
// Shown as "₹1,240.50" at rest and as the plain number while you type.
function setAmount(input, paise) {
  input.value = paise == null ? "" : document.activeElement === input ? amountText(paise) : inr(paise);
}
function amountInput(paise) {
  const i = textInput("amt", "", "₹", { inputmode: "decimal", enterkeyhint: "done" });
  setAmount(i, paise);
  i.addEventListener("focus", () => { const p = parseAmount(i.value); if (p !== null) { i.value = amountText(p); i.select(); } });
  i.addEventListener("blur", () => { const p = parseAmount(i.value); if (p !== null) i.value = inr(p); });
  return i;
}

// Shows "31 Oct"; a transparent native date input on top opens the picker.
function dateLead(value) {
  const label = el("span", { text: shortDate(value) });
  const input = el("input", { type: "date", "aria-label": "Date", min: "2000-01-01", max: "2100-12-31" });
  input.value = value;
  input.addEventListener("click", () => { try { input.showPicker(); } catch { /* unsupported */ } });
  const wrap = el("label", { class: "datechip" }, label, input);
  return {
    node: wrap, input,
    get value() { return input.value; },
    set value(v) { input.value = v; label.textContent = shortDate(v); },
  };
}

function dayLead(value) {
  const input = textInput("daynum", value ? String(value) : "", "Day", { inputmode: "numeric", maxlength: "2", "aria-label": "Day of month" });
  return {
    node: input, input,
    get value() { const n = Number(input.value); return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null; },
    set value(v) { input.value = v ? String(v) : ""; },
  };
}

// ---------- views ----------
const TITLES = { main: "Expenses", notebook: "Expenses", material: "Expenses", winui: "Expenses", gnome: "Expenses", charts: "Charts", tags: "Tags", recurring: "Recurring" };

// The home screen is the list UI ("main"), the notebook, the Material, WinUI or GNOME view; the choice is remembered.
const HOMES = ["main", "notebook", "material", "winui", "gnome"];
const homeView = () => { const h = localStorage.getItem("home"); return HOMES.includes(h) ? h : "main"; };

async function show(name) {
  for (const v of Object.keys(TITLES)) $(`view-${v}`).hidden = v !== name;
  $("title").textContent = TITLES[name];
  $("back").hidden = HOMES.includes(name);
  $("entry").hidden = name !== "main";
  document.body.classList.toggle("nb", name === "notebook");
  document.body.classList.toggle("mat", name === "material");
  document.body.classList.toggle("win", name === "winui");
  document.body.classList.toggle("gnm", name === "gnome");
  for (const b of document.querySelectorAll(".switch-view")) b.hidden = b.dataset.home === homeView();
  try {
    if (name === "main") { buildEntry(); await renderMain(); }
    else if (name === "notebook") await renderNotebook();
    else if (name === "material") await renderMaterial();
    else if (name === "winui") await renderWinui();
    else if (name === "gnome") await renderGnome();
    else if (name === "charts") await renderCharts();
    else if (name === "tags") await renderTags();
    else { buildRecurringEntry(); await renderRecurring(); }
  } catch (err) {
    if (err.message !== "Signed out") console.error(err);
  }
}

$("back").addEventListener("click", () => show(homeView()));
for (const b of document.querySelectorAll(".switch-view")) {
  b.addEventListener("click", () => { localStorage.setItem("home", b.dataset.home); show(b.dataset.home); });
}
$("go-charts").addEventListener("click", () => show("charts"));
$("go-tags").addEventListener("click", () => show("tags"));
$("go-recurring").addEventListener("click", () => show("recurring"));

// ---------- main: blank entry + month accordion ----------
const openMonths = new Set([currentYm()]);
const itemsByMonth = new Map();
let monthList = [];
let sumNodes = new Map();

// "chai 25", "25 chai", "auto fare rs 1,250.50" -> { name: "chai", paise: 2500 }.
// The amount is the number marked with ₹/rs/inr if there is one, otherwise the last number.
// Digits glued to letters ("4g", "3x") are not amounts.
function parseEntry(text) {
  const re = /(?<![\w.])((?:₹|rs\.?|inr)\s*)?(\d+(?:,\d{2,3})*(?:\.\d{1,2})?)(?!\w|\.\d)/gi;
  const found = [...text.matchAll(re)].filter((m) => parseAmount(m[2]) !== null);
  if (!found.length) return null;
  const pick = found.find((m) => m[1]) || found[found.length - 1];
  const rest = (text.slice(0, pick.index) + " " + text.slice(pick.index + pick[0].length))
    .replace(/\s+/g, " ").replace(/^[\s\-:,@]+|[\s\-:,@]+$/g, "")
    .replace(/^(?:for|on)\s+|\s+(?:for|on)$/i, "").trim();
  return { name: rest || "Expense", paise: parseAmount(pick[2]) };
}

function buildEntry() {
  const lead = dateLead(todayStr());
  const input = textInput("nm one", "", "e.g. chai 25", { maxlength: "120", enterkeyhint: "done", autocapitalize: "sentences" });
  const picker = tagPicker();
  let saving = false;

  async function trySave() {
    if (picker.editing) return;
    const parsed = parseEntry(input.value);
    if (saving) return;
    if (!parsed) { if (input.value.trim()) toast("Add an amount, like: chai 25"); return; }
    saving = true;
    try {
      await api("POST", "/api/expenses", {
        name: parsed.name, amount: amountText(parsed.paise), date: lead.value, tags: picker.value,
      });
    } catch (err) {
      saving = false;
      toast(err.message);
      return;
    }
    openMonths.add(lead.value.slice(0, 7));
    input.value = "";
    picker.reset();
    lead.value = todayStr();
    saving = false;
    await renderMain();
    input.focus();
  }

  input.addEventListener("change", trySave);
  input.addEventListener("input", () => picker.sync(input.value));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); trySave(); } });
  lead.input.addEventListener("change", () => { lead.value = lead.input.value; });

  $("entry").replaceChildren(el("div", { class: "new" }, picker.node, el("div", { class: "line" }, lead.node, input)));
}

async function renderMain() {
  monthList = await api("GET", "/api/months");
  const cur = currentYm();
  if (!monthList.some((m) => m.month === cur)) monthList.unshift({ month: cur, total_paise: 0, count: 0 });
  const wanted = monthList.map((m) => m.month).filter((ym) => openMonths.has(ym));
  await Promise.all(wanted.map(async (ym) => {
    itemsByMonth.set(ym, await api("GET", `/api/expenses?month=${ym}`));
  }));
  drawMonths();
}

// After an in-place edit: refresh the totals without rebuilding rows (keeps focus).
async function refreshTotals() {
  const fresh = await api("GET", "/api/months");
  for (const m of fresh) {
    const node = sumNodes.get(m.month);
    if (!node) return renderMain();
    node.textContent = inr(m.total_paise);
  }
}

function drawMonths() {
  const box = $("months");
  box.replaceChildren();
  sumNodes = new Map();
  for (const m of monthList) {
    const open = openMonths.has(m.month);
    const sum = el("span", { class: "sum", text: inr(m.total_paise) });
    sumNodes.set(m.month, sum);
    const head = el("button", { class: "month-head", type: "button", "aria-expanded": String(open) },
      el("span", { class: "name", text: monthName(m.month, { month: "long", year: "numeric" }) }),
      sum, el("span", { class: "chev", text: "›" }));
    head.addEventListener("click", async () => {
      if (open) openMonths.delete(m.month);
      else openMonths.add(m.month);
      try { await renderMain(); } catch { /* signed out */ }
    });
    const section = el("section", { class: "month" + (open ? " open" : "") }, head);
    if (open) {
      const items = itemsByMonth.get(m.month) || [];
      section.append(el("div", { class: "month-body" },
        ...(items.length ? items.map(expenseLine) : [el("div", { class: "empty", text: "Nothing yet." })])));
    }
    box.append(section);
  }
}

function expenseLine(it) {
  const lead = dateLead(it.date);
  const name = nameInput(it.name);
  const amount = amountInput(it.amount_paise);
  const del = el("button", { class: "del", type: "button", "aria-label": "Delete", text: "×" });
  // The dot shows the tag; tapping it opens the badges to change it.
  const dot = el("button", { class: "tagdot", type: "button", "aria-label": "Change tag" });
  const paintDot = () => {
    const t = it.tags.find(isKnownTag);
    if (t) dot.style.setProperty("--tc", tagColor(t)); else dot.style.removeProperty("--tc");
    dot.classList.toggle("none", !t);
    dot.title = t || "No tag";
  };
  paintDot();
  const picker = tagPicker(it.tags.find(isKnownTag) || null, (value) => setTags(value));
  picker.node.hidden = true;
  dot.addEventListener("click", () => { picker.node.hidden = !picker.node.hidden; });
  const row = el("div", { class: "line" }, lead.node, el("div", { class: "namecell" }, dot, name), amount, del);
  const wrap = el("div", { class: "exp" }, row, picker.node);

  async function setTags(value) {
    const tags = it.tags.filter((t) => !isKnownTag(t)).concat(value);
    try {
      const saved = await api("PUT", `/api/expenses/${it.id}`, {
        name: it.name, amount: amountText(it.amount_paise), date: it.date, note: it.note, tags,
      });
      Object.assign(it, saved);
      paintDot();
    } catch (err) { toast(err.message); }
  }

  function revert() {
    name.value = it.name; setAmount(amount, it.amount_paise); lead.value = it.date;
  }

  async function save() {
    const paise = parseAmount(amount.value);
    const n = name.value.trim();
    if (!n || paise === null) { row.classList.add("bad"); toast("Needs a name and an amount"); revert(); setTimeout(() => row.classList.remove("bad"), 1500); return; }
    if (n === it.name && paise === it.amount_paise && lead.value === it.date) { setAmount(amount, paise); return; }
    try {
      const saved = await api("PUT", `/api/expenses/${it.id}`, {
        name: n, amount: amountText(paise), date: lead.value, note: it.note, tags: it.tags,
      });
      const moved = saved.date !== it.date;
      Object.assign(it, saved);
      setAmount(amount, it.amount_paise);
      if (moved) { await renderMain(); } else { await refreshTotals(); }
    } catch (err) {
      toast(err.message);
      revert();
    }
  }
  name.addEventListener("change", save);
  amount.addEventListener("change", save);
  lead.input.addEventListener("change", () => { lead.value = lead.input.value; save(); });

  del.addEventListener("click", async () => {
    try {
      await api("DELETE", `/api/expenses/${it.id}`);
    } catch (err) { toast(err.message); return; }
    await renderMain();
    toast(`Deleted ${it.name}`, "Undo", async () => {
      await api("POST", "/api/expenses", {
        name: it.name, amount: amountText(it.amount_paise), date: it.date, note: it.note, tags: it.tags,
      });
      await renderMain();
    });
  });
  return wrap;
}

// ---------- charts ----------
function compact(paise) {
  const r = paise / 100;
  if (r >= 100000) return `${(r / 100000).toFixed(1)}L`;
  if (r >= 1000) return `${(r / 1000).toFixed(1)}k`;
  return String(Math.round(r));
}

async function renderCharts() {
  const cur = currentYm();
  const [summary, trend] = await Promise.all([
    api("GET", `/api/summary?month=${cur}`),
    api("GET", `/api/trend?month=${cur}&months=6`),
  ]);

  const tags = $("chart-tags");
  tags.replaceChildren();
  if (!summary.by_tag.length) tags.append(el("div", { class: "empty", text: "Nothing to show for this month." }));
  const max = Math.max(1, ...summary.by_tag.map((t) => t.amount_paise));
  for (const t of summary.by_tag) {
    const fill = el("div", { class: "bar-fill" });
    fill.style.width = `${(t.amount_paise / max) * 100}%`;
    fill.style.background = tagColor(t.tag);
    tags.append(el("div", { class: "bar-row" },
      el("div", { class: "top" }, el("span", { text: t.tag }), el("span", { text: inr(t.amount_paise) })),
      el("div", { class: "bar-track" }, fill)));
  }

  const tmax = Math.max(1, ...trend.map((t) => t.total_paise));
  const box = $("chart-trend");
  box.replaceChildren();
  for (const t of trend) {
    const bar = el("div", { class: "bar" });
    bar.style.height = `${(t.total_paise / tmax) * 100}%`;
    const barWrap = el("div", { class: "barwrap" }, el("div", { class: "v", text: t.total_paise ? compact(t.total_paise) : "" }), bar);
    box.append(el("div", { class: "col" + (t.month === cur ? " cur" : "") },
      barWrap, el("div", { class: "m", text: monthName(t.month, { month: "short" }) })));
  }
}

// ---------- recurring (same plain lines) ----------
function buildRecurringEntry() {
  const lead = dayLead(null);
  const name = nameInput("");
  const amount = amountInput(null);
  let saving = false;

  async function trySave() {
    const paise = parseAmount(amount.value);
    if (saving || !name.value.trim() || paise === null || lead.value === null) return;
    saving = true;
    try {
      await api("POST", "/api/recurring", {
        name: name.value.trim(), amount: amountText(paise), day: lead.value, note: "", tags: [], active: true,
      });
    } catch (err) {
      saving = false;
      toast(err.message);
      return;
    }
    name.value = ""; amount.value = ""; lead.value = null;
    saving = false;
    await renderRecurring();
    lead.input.focus();
  }
  lead.input.addEventListener("keydown", (e) => { if (e.key === "Enter") name.focus(); });
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") amount.focus(); });
  for (const c of [lead.input, name, amount]) c.addEventListener("change", trySave);

  $("recurring-entry").replaceChildren(el("div", { class: "new" },
    el("div", { class: "line" }, lead.node, name, amount, el("span"))));
}

async function renderRecurring() {
  const items = await api("GET", "/api/recurring");
  const list = $("recurring-list");
  list.replaceChildren();
  if (!items.length) { list.append(el("div", { class: "empty", text: "No recurring expenses." })); return; }
  list.append(el("div", { class: "card-list" }, ...items.map(recurringLine)));
}

function recurringLine(it) {
  const lead = dayLead(it.day);
  const name = nameInput(it.name);
  const amount = amountInput(it.amount_paise);
  const del = el("button", { class: "del", type: "button", "aria-label": "Delete", text: "×" });
  const row = el("div", { class: "line" + (it.active ? "" : " off") }, lead.node, name, amount, del);

  function revert() { name.value = it.name; setAmount(amount, it.amount_paise); lead.value = it.day; }

  async function save() {
    const paise = parseAmount(amount.value);
    const n = name.value.trim();
    const day = lead.value;
    if (!n || paise === null || day === null) { toast("Needs a day, a name and an amount"); revert(); return; }
    if (n === it.name && paise === it.amount_paise && day === it.day) return;
    try {
      Object.assign(it, await api("PUT", `/api/recurring/${it.id}`, {
        name: n, amount: amountText(paise), day, note: it.note, tags: it.tags, active: it.active,
      }));
    } catch (err) { toast(err.message); revert(); }
  }
  for (const c of [lead.input, name, amount]) c.addEventListener("change", save);

  del.addEventListener("click", async () => {
    try { await api("DELETE", `/api/recurring/${it.id}`); } catch (err) { toast(err.message); return; }
    await renderRecurring();
    toast(`Removed ${it.name} (past entries stay)`, "Undo", async () => {
      await api("POST", "/api/recurring", {
        name: it.name, amount: amountText(it.amount_paise), day: it.day, note: it.note, tags: it.tags, active: it.active,
      });
      await renderRecurring();
    });
  });
  return row;
}

// Keep the bottom entry above the on-screen keyboard (iOS does not resize the layout for it).
if (window.visualViewport) {
  const vv = window.visualViewport;
  const lift = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--kb", `${kb}px`);
  };
  vv.addEventListener("resize", lift);
  vv.addEventListener("scroll", lift);
}

// ---------- boot ----------
async function init() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  try {
    await localReady();
    await showApp();
  } catch (err) {
    document.body.textContent = `Could not open the storage on this phone: ${err.message}`;
  }
}
// Start once every script (local.js, app.js, notebook.js) has loaded.
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
