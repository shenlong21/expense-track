"use strict";

// WinUI 3 view: a Fluent-style home. A summary card with a month picker and a tag breakdown bar,
// a compact table (date, name, tag, amount), and a command bar pinned at the bottom
// ("chai 25" + Add). It edits the same data as the other views.

const win = { ym: currentYm(), months: [] };

async function renderWinui() {
  const list = await api("GET", "/api/months");
  const months = new Set(list.map((m) => m.month));
  months.add(currentYm());
  win.months = [...months].sort().reverse();
  if (!win.months.includes(win.ym)) win.ym = currentYm();
  await drawWinui();
}

async function drawWinui() {
  const items = (await api("GET", `/api/expenses?month=${win.ym}`))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  const total = items.reduce((s, it) => s + it.amount_paise, 0);

  const combo = el("select", { class: "w-combo", "aria-label": "Month" });
  for (const ym of win.months) {
    const o = el("option", { value: ym, text: monthName(ym, { month: "long", year: "numeric" }) });
    if (ym === win.ym) o.selected = true;
    combo.append(o);
  }
  combo.addEventListener("change", () => { win.ym = combo.value; drawWinui(); });

  const summary = el("div", { class: "w-card w-summary" },
    el("div", { class: "w-sumtop" },
      el("div", {},
        el("div", { class: "w-caption", text: "Spent this month" }),
        el("div", { class: "w-title", text: inr(total) }),
        el("div", { class: "w-caption", text: `${items.length} expense${items.length === 1 ? "" : "s"}` })),
      combo),
    winBreakdown(items, total));

  const table = el("div", { class: "w-card w-table", role: "table" },
    el("div", { class: "w-row w-headrow", role: "row" },
      el("span", { text: "Date" }), el("span", { text: "Name" }), el("span", { text: "Tag" }), el("span", { class: "r", text: "Amount" }), el("span")));
  if (!items.length) table.append(el("div", { class: "w-empty", text: "No expenses yet. Type something like chai 25 below." }));
  for (const it of items) table.append(winRow(it));

  $("view-winui").replaceChildren(summary, table, winBar());
}

// A thin stacked bar: one coloured segment per tag, plus a legend.
function winBreakdown(items, total) {
  const wrap = el("div", { class: "w-break" });
  if (!total) return wrap;
  const by = new Map();
  for (const it of items) {
    const t = (it.tags || []).find(isKnownTag) || "untagged";
    by.set(t, (by.get(t) || 0) + it.amount_paise);
  }
  const bar = el("div", { class: "w-stack" });
  const legend = el("div", { class: "w-legend" });
  for (const [tag, paise] of [...by].sort((a, b) => b[1] - a[1])) {
    const seg = el("span", { title: `${tag} ${inr(paise)}` });
    seg.style.flex = String(paise);
    seg.style.background = tagColor(tag);
    bar.append(seg);
    const item = el("span", { class: "w-key" }, el("i"), `${tag} ${Math.round((paise / total) * 100)}%`);
    item.firstChild.style.background = tagColor(tag);
    legend.append(item);
  }
  wrap.append(bar, legend);
  return wrap;
}

function winRow(it) {
  const wrap = el("div", { class: "w-item" });
  const show = () => {
    const tag = (it.tags || []).find(isKnownTag);
    const del = el("button", { type: "button", class: "w-del", "aria-label": `Delete ${it.name}`, text: "✕" });
    del.addEventListener("click", (e) => { e.stopPropagation(); remove(); });
    const row = el("div", { class: "w-row", role: "row", tabindex: "0", "aria-label": `Edit ${it.name}` },
      el("span", { class: "w-date", text: shortDate(it.date) }),
      el("span", { class: "w-name", text: it.name }),
      el("span", {}, tag ? tagBadge(tag) : ""),
      el("span", { class: "r w-amt", text: inr(it.amount_paise) }),
      del);
    row.addEventListener("click", edit);
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === row) edit(); });
    wrap.replaceChildren(row);
  };
  const edit = () => {
    const input = el("input", { class: "w-edit", autocomplete: "off", maxlength: "120", enterkeyhint: "done", "aria-label": "Edit expense" });
    input.value = `${it.name} ${amountText(it.amount_paise)}`;
    const others = (it.tags || []).filter((t) => !isKnownTag(t));
    let tags = it.tags || [];
    const picker = tagPicker((it.tags || []).find(isKnownTag) || null, (v) => { tags = others.concat(v); });
    picker.node.hidden = false;
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const text = input.value.trim();
      const parsed = save && text ? parseEntry(text) : null;
      if (save && text && !parsed) toast("Add an amount, like: chai 25");
      if (parsed && (parsed.name !== it.name || parsed.paise !== it.amount_paise || tags.join() !== (it.tags || []).join())) {
        try {
          await api("PUT", `/api/expenses/${it.id}`, { name: parsed.name, amount: amountText(parsed.paise), date: it.date, note: it.note || "", tags });
        } catch (err) { toast(err.message); }
      }
      await drawWinui();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => { if (!picker.editing) finish(true); });
    wrap.replaceChildren(el("div", { class: "w-editrow" }, el("span", { class: "w-date", text: shortDate(it.date) }), input), picker.node);
    input.focus();
    input.select();
  };
  const remove = async () => {
    const snap = { name: it.name, amount: amountText(it.amount_paise), date: it.date, note: it.note || "", tags: it.tags || [] };
    try { await api("DELETE", `/api/expenses/${it.id}`); } catch (err) { toast(err.message); return; }
    toast(`Deleted ${it.name}`, "Undo", async () => { await api("POST", "/api/expenses", snap); await drawWinui(); });
    await drawWinui();
  };
  show();
  return wrap;
}

function winBar() {
  const input = el("input", {
    class: "w-field", placeholder: "Add expense, e.g. chai 25", autocomplete: "off", maxlength: "120",
    enterkeyhint: "done", autocapitalize: "sentences", "aria-label": "New expense",
  });
  const btn = el("button", { type: "button", class: "w-accent", text: "Add" });
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
    win.ym = currentYm();
    if (!win.months.includes(win.ym)) win.months.unshift(win.ym);
    saving = false;
    await drawWinui();
    $("view-winui").querySelector(".w-field").focus();
  };
  input.addEventListener("input", () => picker.sync(input.value));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  btn.addEventListener("mousedown", (e) => e.preventDefault());   // keep the keyboard up
  btn.addEventListener("click", add);
  return el("div", { class: "w-bar" }, picker.node, el("div", { class: "w-barrow" }, input, btn));
}
