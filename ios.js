"use strict";

// iOS view: Apple style. A summary card, inset grouped lists per day (coloured icon, title, amount),
// a bottom sheet to edit an expense, and a message-style bar to add ("chai 25" + send).
// It edits the same data as the other views.

const ios = { ym: currentYm(), months: [] };

async function renderIos() {
  const list = await api("GET", "/api/months");
  const months = new Set(list.map((m) => m.month));
  months.add(currentYm());
  ios.months = [...months].sort().reverse();
  if (!ios.months.includes(ios.ym)) ios.ym = currentYm();
  await drawIos();
}

function iosDayLabel(date) {
  const d = new Date(date + "T00:00");
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if (date === todayStr()) return "Today";
  if (date === `${yest.getFullYear()}-${pad(yest.getMonth() + 1)}-${pad(yest.getDate())}`) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

async function drawIos() {
  const items = (await api("GET", `/api/expenses?month=${ios.ym}`))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  const total = items.reduce((s, it) => s + it.amount_paise, 0);

  const month = el("select", { class: "i-month", "aria-label": "Month" });
  for (const ym of ios.months) {
    const o = el("option", { value: ym, text: monthName(ym, { month: "long", year: "numeric" }) });
    if (ym === ios.ym) o.selected = true;
    month.append(o);
  }
  month.addEventListener("change", () => { ios.ym = month.value; drawIos(); });

  const card = el("div", { class: "i-card" },
    el("div", { class: "i-cardtop" }, el("span", { class: "i-label", text: "Spent in" }), month),
    el("div", { class: "i-big", text: inr(total) }),
    el("div", { class: "i-label", text: `${items.length} expense${items.length === 1 ? "" : "s"}` }));

  const root = $("view-ios");
  root.replaceChildren(card);

  if (!items.length) {
    root.append(el("div", { class: "i-empty" },
      el("div", { class: "i-empty-title", text: "No Expenses" }),
      el("div", { text: "Type something like chai 25 below." })));
  }
  const days = new Map();
  for (const it of items) days.set(it.date, [...(days.get(it.date) || []), it]);
  for (const [date, rows] of days) {
    const sum = rows.reduce((s, it) => s + it.amount_paise, 0);
    root.append(el("div", { class: "i-sechead" }, el("span", { text: iosDayLabel(date) }), el("span", { text: inr(sum) })));
    const group = el("div", { class: "i-group" });
    for (const it of rows) group.append(iosRow(it));
    root.append(group);
  }
  root.append(iosBar());
}

function iosRow(it) {
  const tag = (it.tags || []).find(isKnownTag);
  const icon = el("div", { class: "i-icon", text: it.name.trim()[0] || "?" });
  icon.style.background = tag ? tagColor(tag) : "#8e8e93";
  const row = el("button", { type: "button", class: "i-row", "aria-label": `Edit ${it.name}` },
    icon,
    el("div", { class: "i-text" },
      el("div", { class: "i-title", text: it.name }),
      el("div", { class: "i-sub", text: tag || "No tag" })),
    el("span", { class: "i-val", text: inr(it.amount_paise) }),
    el("span", { class: "i-chev", text: "›" }));
  row.addEventListener("click", () => iosSheet(it));
  return row;
}

const closeIosSheet = () => { for (const n of document.querySelectorAll(".i-backdrop")) n.remove(); };

// The edit sheet slides up from the bottom. Done saves, Cancel (or tapping outside) discards.
function iosSheet(it) {
  closeIosSheet();
  const input = el("input", { class: "i-field", autocomplete: "off", maxlength: "120", enterkeyhint: "done", "aria-label": "Expense" });
  input.value = `${it.name} ${amountText(it.amount_paise)}`;
  const others = (it.tags || []).filter((t) => !isKnownTag(t));
  let tags = it.tags || [];
  const picker = tagPicker((it.tags || []).find(isKnownTag) || null, (v) => { tags = others.concat(v); });
  picker.node.hidden = false;

  const cancel = el("button", { type: "button", class: "i-nav", text: "Cancel" });
  const done = el("button", { type: "button", class: "i-nav bold", text: "Done" });
  const del = el("button", { type: "button", class: "i-delete", text: "Delete Expense" });
  const sheet = el("div", { class: "i-sheet", role: "dialog", "aria-modal": "true", "aria-label": "Edit expense" },
    el("div", { class: "i-grab" }),
    el("div", { class: "i-navbar" }, cancel, el("span", { class: "i-navtitle", text: "Edit Expense" }), done),
    el("div", { class: "i-sheetbody" },
      el("div", { class: "i-group" }, el("div", { class: "i-cell" }, input)),
      el("div", { class: "i-sechead" }, el("span", { text: "Tag" })),
      picker.node,
      del));
  const backdrop = el("div", { class: "i-backdrop" }, sheet);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeIosSheet(); });
  cancel.addEventListener("click", closeIosSheet);

  const save = async () => {
    const parsed = parseEntry(input.value);
    if (!parsed) { toast("Add an amount, like: chai 25"); return; }
    if (parsed.name !== it.name || parsed.paise !== it.amount_paise || tags.join() !== (it.tags || []).join()) {
      try {
        await api("PUT", `/api/expenses/${it.id}`, { name: parsed.name, amount: amountText(parsed.paise), date: it.date, note: it.note || "", tags });
      } catch (err) { toast(err.message); return; }
    }
    closeIosSheet();
    await drawIos();
  };
  done.addEventListener("click", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
    else if (e.key === "Escape") closeIosSheet();
  });

  del.addEventListener("click", async () => {
    const snap = { name: it.name, amount: amountText(it.amount_paise), date: it.date, note: it.note || "", tags: it.tags || [] };
    try { await api("DELETE", `/api/expenses/${it.id}`); } catch (err) { toast(err.message); return; }
    closeIosSheet();
    toast(`Deleted ${it.name}`, "Undo", async () => { await api("POST", "/api/expenses", snap); await drawIos(); });
    await drawIos();
  });

  document.body.append(backdrop);
  input.focus();
}

function iosBar() {
  const input = el("input", {
    class: "i-compose", placeholder: "Add expense, e.g. chai 25", autocomplete: "off", maxlength: "120",
    enterkeyhint: "send", autocapitalize: "sentences", "aria-label": "New expense",
  });
  const send = el("button", { type: "button", class: "i-send", "aria-label": "Add expense", text: "↑" });
  const picker = tagPicker();
  let saving = false;
  const add = async () => {
    if (saving) return;
    const parsed = parseEntry(input.value);
    if (!parsed) { if (input.value.trim()) toast("Add an amount, like: chai 25"); return; }
    saving = true;
    try {
      await api("POST", "/api/expenses", { name: parsed.name, amount: amountText(parsed.paise), date: todayStr(), tags: picker.value });
    } catch (err) { saving = false; toast(err.message); return; }
    picker.reset();
    ios.ym = currentYm();
    if (!ios.months.includes(ios.ym)) ios.months.unshift(ios.ym);
    saving = false;
    await drawIos();
    $("view-ios").querySelector(".i-compose").focus();
  };
  input.addEventListener("input", () => picker.sync(input.value));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  send.addEventListener("mousedown", (e) => e.preventDefault());   // keep the keyboard up
  send.addEventListener("click", add);
  return el("div", { class: "i-bar" }, picker.node, el("div", { class: "i-barrow" }, input, send));
}
