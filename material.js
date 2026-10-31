"use strict";

// Material view: a Material 3 style home. A summary card for the chosen month, month chips,
// expenses grouped by day, and a text field + button pinned at the bottom ("chai 25" -> add).
// It edits the same data as the other views.

const mat = { ym: currentYm(), months: [] };

async function renderMaterial() {
  const list = await api("GET", "/api/months");
  const months = new Set(list.map((m) => m.month));
  months.add(currentYm());
  mat.months = [...months].sort().reverse();
  if (!mat.months.includes(mat.ym)) mat.ym = currentYm();
  await drawMaterial();
}

async function drawMaterial() {
  const root = $("view-material");
  const items = (await api("GET", `/api/expenses?month=${mat.ym}`))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  const total = items.reduce((s, it) => s + it.amount_paise, 0);

  const hero = el("div", { class: "m-hero" },
    el("div", { class: "lbl", text: monthName(mat.ym, { month: "long", year: "numeric" }).toUpperCase() }),
    el("div", { class: "big", text: inr(total) }),
    el("div", { class: "sub", text: `${items.length} expense${items.length === 1 ? "" : "s"}` }));

  const chips = el("div", { class: "m-chips" });
  for (const ym of mat.months) {
    const chip = el("button", { type: "button", class: "m-chip" + (ym === mat.ym ? " on" : ""), text: monthName(ym, { month: "short", year: "2-digit" }) });
    chip.addEventListener("click", () => { mat.ym = ym; drawMaterial(); });
    chips.append(chip);
  }

  const body = el("div");
  if (!items.length) body.append(el("div", { class: "m-empty", text: "Nothing yet. Type something like chai 25 below." }));
  const days = new Map();
  for (const it of items) days.set(it.date, [...(days.get(it.date) || []), it]);
  for (const [date, rows] of days) {
    const sum = rows.reduce((s, it) => s + it.amount_paise, 0);
    body.append(el("div", { class: "m-day" }, el("span", { text: shortDate(date) }), el("span", { class: "tot", text: inr(sum) })));
    const card = el("div", { class: "m-card" });
    for (const it of rows) card.append(materialItem(it));
    body.append(card);
  }

  root.replaceChildren(hero, chips, body, materialBar());
}

function materialItem(it) {
  const row = el("div", { class: "m-item" });
  const avatar = () => el("div", { class: "m-avatar", text: it.name.trim()[0] || "?" });
  const show = () => {
    const main = el("button", { type: "button", class: "m-text", "aria-label": `Edit ${it.name}` },
      el("div", { class: "m-name", text: it.name }),
      el("div", { class: "m-support" }, new Date(it.date + "T00:00").toLocaleDateString("en-IN", { weekday: "long" }), ...(it.tags || []).map(tagBadge)));
    main.addEventListener("click", edit);
    const del = el("button", { type: "button", class: "m-del", "aria-label": `Delete ${it.name}`, text: "×" });
    del.addEventListener("click", remove);
    row.replaceChildren(avatar(), main, el("div", { class: "m-amt", text: inr(it.amount_paise) }), del);
  };
  const edit = () => {
    const input = el("input", { class: "m-edit", autocomplete: "off", maxlength: "120", enterkeyhint: "done", "aria-label": "Edit expense" });
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
      await drawMaterial();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    row.replaceChildren(avatar(), input, picker.node);
    input.focus();
    input.select();
  };
  const remove = async () => {
    const snap = { name: it.name, amount: amountText(it.amount_paise), date: it.date, note: it.note || "", tags: it.tags || [] };
    try { await api("DELETE", `/api/expenses/${it.id}`); } catch (err) { toast(err.message); return; }
    toast(`Deleted ${it.name}`, "Undo", async () => { await api("POST", "/api/expenses", snap); await drawMaterial(); });
    await drawMaterial();
  };
  show();
  return row;
}

function materialBar() {
  const input = el("input", {
    class: "m-field", placeholder: "Add expense, e.g. chai 25", autocomplete: "off", maxlength: "120",
    enterkeyhint: "done", autocapitalize: "sentences", "aria-label": "New expense",
  });
  const fab = el("button", { type: "button", class: "m-fab", "aria-label": "Add expense", text: "+" });
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
    mat.ym = currentYm();
    if (!mat.months.includes(mat.ym)) mat.months.unshift(mat.ym);
    saving = false;
    await drawMaterial();
    $("view-material").querySelector(".m-field").focus();
  };
  input.addEventListener("input", () => picker.sync(input.value));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  fab.addEventListener("mousedown", (e) => e.preventDefault());   // keep the keyboard up
  fab.addEventListener("click", add);
  return el("div", { class: "m-bar" }, picker.node, el("div", { class: "m-row" }, input, fab));
}
