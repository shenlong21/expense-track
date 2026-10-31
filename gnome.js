"use strict";

// GNOME view: libadwaita style. Boxed lists of rows (avatar, title, subtitle, value), a month
// row, and a bottom entry with a suggested-action button
// ("chai 25" + Add). It edits the same data as the other views.

const gnm = { ym: currentYm(), months: [] };

async function renderGnome() {
  const list = await api("GET", "/api/months");
  const months = new Set(list.map((m) => m.month));
  months.add(currentYm());
  gnm.months = [...months].sort().reverse();
  if (!gnm.months.includes(gnm.ym)) gnm.ym = currentYm();
  await drawGnome();
}

async function drawGnome() {
  const items = (await api("GET", `/api/expenses?month=${gnm.ym}`))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  const total = items.reduce((s, it) => s + it.amount_paise, 0);

  const combo = el("select", { class: "g-combo", "aria-label": "Month" });
  for (const ym of gnm.months) {
    const o = el("option", { value: ym, text: monthName(ym, { month: "long", year: "numeric" }) });
    if (ym === gnm.ym) o.selected = true;
    combo.append(o);
  }
  combo.addEventListener("change", () => { gnm.ym = combo.value; drawGnome(); });

  const overview = el("div", { class: "g-list" },
    gnmRow("Month", "", combo),
    gnmRow("Spent", `${items.length} expense${items.length === 1 ? "" : "s"}`, el("span", { class: "g-total", text: inr(total) })));

  const root = $("view-gnome");
  root.replaceChildren(overview);

  root.append(el("h2", { class: "g-heading", text: "Expenses" }));
  if (!items.length) {
    root.append(el("div", { class: "g-status" },
      el("div", { class: "g-status-title", text: "No expenses yet" }),
      el("div", { text: "Type something like chai 25 below." })));
  } else {
    const list = el("div", { class: "g-list" });
    for (const it of items) list.append(gnmItem(it));
    root.append(list);
  }
  root.append(gnmBar());
}

// An Adw.ActionRow: title and subtitle on the left, a widget on the right.
function gnmRow(title, subtitle, suffix) {
  return el("div", { class: "g-row" },
    el("div", { class: "g-text" },
      el("div", { class: "g-title", text: title }),
      subtitle ? el("div", { class: "g-sub", text: subtitle }) : ""),
    suffix || "");
}

function gnmItem(it) {
  const wrap = el("div", { class: "g-item" });
  const avatar = () => {
    const tag = (it.tags || []).find(isKnownTag);
    const a = el("div", { class: "g-avatar", text: it.name.trim()[0] || "?" });
    a.style.setProperty("--tc", tagColor(tag));
    return a;
  };
  const show = () => {
    const tag = (it.tags || []).find(isKnownTag);
    const row = el("div", { class: "g-row g-activatable", role: "button", tabindex: "0", "aria-label": `Edit ${it.name}` },
      avatar(),
      el("div", { class: "g-text" },
        el("div", { class: "g-title", text: it.name }),
        el("div", { class: "g-sub" }, shortDate(it.date), ...(tag ? [tagBadge(tag)] : []))),
      el("span", { class: "g-val", text: inr(it.amount_paise) }));
    row.addEventListener("click", edit);
    row.addEventListener("keydown", (e) => { if (e.key === "Enter") edit(); });
    wrap.replaceChildren(row);
  };
  const edit = () => {
    const input = el("input", { class: "g-entry", autocomplete: "off", maxlength: "120", enterkeyhint: "done", "aria-label": "Edit expense" });
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
      await drawGnome();
    };
    const del = el("button", { type: "button", class: "g-btn destructive", text: "Delete" });
    const save = el("button", { type: "button", class: "g-btn suggested", text: "Save" });
    for (const b of [del, save]) b.addEventListener("mousedown", (e) => e.preventDefault());   // keep the field focused
    del.addEventListener("click", () => { done = true; remove(); });
    save.addEventListener("click", () => finish(true));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => { if (!picker.editing) finish(true); });
    wrap.replaceChildren(el("div", { class: "g-editor" }, input, picker.node, el("div", { class: "g-actions" }, del, save)));
    input.focus();
    input.select();
  };
  const remove = async () => {
    const snap = { name: it.name, amount: amountText(it.amount_paise), date: it.date, note: it.note || "", tags: it.tags || [] };
    try { await api("DELETE", `/api/expenses/${it.id}`); } catch (err) { toast(err.message); return; }
    toast(`Deleted ${it.name}`, "Undo", async () => { await api("POST", "/api/expenses", snap); await drawGnome(); });
    await drawGnome();
  };
  show();
  return wrap;
}

function gnmBar() {
  const input = el("input", {
    class: "g-entry", placeholder: "Add expense, e.g. chai 25", autocomplete: "off", maxlength: "120",
    enterkeyhint: "done", autocapitalize: "sentences", "aria-label": "New expense",
  });
  const btn = el("button", { type: "button", class: "g-btn suggested", text: "Add" });
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
    gnm.ym = currentYm();
    if (!gnm.months.includes(gnm.ym)) gnm.months.unshift(gnm.ym);
    saving = false;
    await drawGnome();
    $("view-gnome").querySelector(".g-bar .g-entry").focus();
  };
  input.addEventListener("input", () => picker.sync(input.value));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  btn.addEventListener("mousedown", (e) => e.preventDefault());   // keep the keyboard up
  btn.addEventListener("click", add);
  return el("div", { class: "g-bar" }, picker.node, el("div", { class: "g-barrow" }, input, btn));
}
