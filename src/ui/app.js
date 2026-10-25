import "../styles.css";

const escape = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

export function mountApp(root, handlers) {
  let items = [];
  let recipients = [];
  let result = null;
  let busy = false;
  let submitted = null;

  root.innerHTML = `
    <header class="topbar"><a class="brand" href="#"><span class="brand-mark">F</span>FairKits</a><span class="tag">COMMUNITY DISTRIBUTION</span></header>
    <main class="workspace">
      <section class="intro"><div><p class="eyebrow">A LITTLE STRUCTURE. A FAIRER SHARE.</p><h1>Make every donation count.</h1><p>Bring your supplies and household requests together.<br>Build a fair distribution plan, then review it with your team.</p></div>
      <button type="button" data-action="example">Load Example Data</button></section>
      <div id="app-error" class="notice error" role="alert" tabindex="-1" hidden></div>
      <p id="app-status" class="status" role="status" aria-live="polite">Start with your supplies, or load the example to try FairKits.</p>
      <fieldset id="editor"><legend class="sr-only">Distribution inputs</legend>
        <section class="panel" aria-labelledby="supplies-title"><div class="section-heading"><div><p class="eyebrow">STEP 01</p><h2 id="supplies-title">Available supplies</h2><p>Use whole units, such as bags, bottles, or kits.</p></div><button type="button" data-action="import-items">Import supplies CSV</button></div>
          <div id="supplies"></div><button type="button" data-action="add-item" class="add-button">+ Add supply</button>
        </section>
        <section class="panel" aria-labelledby="households-title"><div class="section-heading"><div><p class="eyebrow">STEP 02</p><h2 id="households-title">Household requests</h2><p>Use anonymous household IDs. Do not enter names or contact details.</p></div><button type="button" data-action="import-requests">Import requests CSV</button></div>
          <div id="households"></div><button type="button" data-action="add-recipient" class="add-button">+ Add household</button>
        </section>
        <details class="csv-help"><summary>CSV format & import help</summary><p>Each import replaces its corresponding list. Import supplies first; requests must use matching supply IDs.</p><p>Supplies header: <code>id,name,stock</code> (stock: zero or greater).</p><p>Requests header: <code>recipientId,itemId,quantity</code> (quantity: one or greater). Repeated requests are combined by the importer.</p></details>
        <div class="calculate-bar"><div><strong>Ready to make a plan?</strong><p>Round-robin allocation gives each household a turn.</p></div><button type="button" data-action="calculate" class="primary">Calculate Allocation <span aria-hidden="true">→</span></button></div>
        <input type="file" id="items-file" accept=".csv,text/csv" hidden aria-label="Supplies CSV file">
        <input type="file" id="requests-file" accept=".csv,text/csv" hidden aria-label="Requests CSV file">
      </fieldset>
      <section class="panel results-panel" aria-labelledby="results-title"><div class="section-heading"><div><p class="eyebrow">STEP 03</p><h2 id="results-title">Review your allocation</h2></div><button type="button" data-action="export" disabled>Export results CSV</button></div><div id="results"></div></section>
      <footer>Made for communities. Decisions stay with people.<span>Review every allocation before distribution. Data stays in this browser tab and is lost on refresh.</span></footer>
    </main>`;

  const find = selector => root.querySelector(selector);
  const status = message => { find("#app-status").textContent = message; };
  function clearError() { find("#app-error").hidden = true; }
  function showError(message) {
    const box = find("#app-error");
    box.textContent = String(message);
    box.hidden = false;
    box.focus();
    status("Please correct the error and try again.");
  }
  function renderResults() {
    find('[data-action="export"]').disabled = busy || !result;
    if (!result) {
      find("#results").innerHTML = '<div class="empty"><span class="empty-symbol" aria-hidden="true">◎</span><h3>Your distribution plan will appear here</h3><p>Enter supplies and requests, then calculate to see allocations, unmet needs, and remaining stock.</p></div>';
      return;
    }
    const map = new Map();
    for (const allocation of result.allocations) {
      if (!map.has(allocation.recipientId)) map.set(allocation.recipientId, new Map());
      map.get(allocation.recipientId).set(allocation.itemId, allocation.quantity);
    }
    const rows = submitted.recipients.flatMap(recipient => submitted.items.map(item => {
      const requested = recipient.requests[item.id] ?? 0;
      const allocated = map.get(recipient.id)?.get(item.id) ?? 0;
      const unmet = requested - allocated;
      return `<tr><th scope="row">${escape(recipient.id)}</th><td>${escape(item.name)}</td><td>${requested}</td><td class="allocated">${allocated}</td><td class="${unmet > 0 ? "unmet" : ""}">${unmet}</td></tr>`;
    })).join("");
    find("#results").innerHTML = `<p class="notice review">Proposed allocation · Human review required before distribution.</p>
      ${(result.warnings ?? []).map(warning => `<p class="notice review">${escape(warning)}</p>`).join("")}
      <div class="table-scroll" tabindex="0" role="region" aria-label="Household allocation results"><table><caption>Household allocations and unmet requests</caption><thead><tr><th>Household</th><th>Supply</th><th>Requested</th><th>Allocated</th><th>Unmet</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No household requests to allocate.</td></tr>'}</tbody></table></div>
      <h3 class="stock-heading">Remaining inventory</h3><div class="stock-grid">${submitted.items.map(item => `<div class="stock-card"><span>${escape(item.name)}</span><strong>${result.remainingStock[item.id]}</strong><small>units remaining</small></div>`).join("") || '<p>No supplies entered.</p>'}</div>`;
  }
  function clearResults() {
    result = null;
    renderResults();
  }
  function changed() {
    clearError();
    clearResults();
    submitted = null;
    handlers.onInputChange();
    status("Inputs updated. Calculate to create a current allocation.");
  }
  function quantityInput(value, attributes, label) {
    return `<input type="number" min="0" max="${Number.MAX_SAFE_INTEGER}" step="1" required value="${escape(value)}" ${attributes} aria-label="${escape(label)}">`;
  }
  function renderSupplies() {
    find("#supplies").innerHTML = items.length ? `<div class="table-scroll"><table><caption class="sr-only">Available supplies</caption><thead><tr><th>Supply name</th><th>Supply ID</th><th>Available units</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${items.map((item, i) => `<tr><td><input data-item="${i}" data-field="name" value="${escape(item.name)}" aria-label="Supply ${i + 1} name" required></td><td><code>${escape(item.id)}</code></td><td>${quantityInput(item.stock, `data-item="${i}" data-field="stock"`, `Available units for ${item.name || item.id}`)}</td><td><button type="button" class="remove" data-action="remove-item" data-index="${i}" aria-label="Remove supply ${escape(item.name || item.id)}">Remove</button></td></tr>`).join("")}</tbody></table></div>` : '<p class="empty-inline">No supplies yet. Add your first supply or import a CSV.</p>';
  }
  function renderHouseholds() {
    // Keep unknown imported references visible instead of silently dropping them.
    const columns = new Map(items.map(item => [item.id, item.name || item.id]));
    for (const recipient of recipients) for (const id of Object.keys(recipient.requests)) {
      if (!columns.has(id)) columns.set(id, `${id} (missing supply)`);
    }
    find("#households").innerHTML = recipients.length ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Household request editor"><table><caption class="sr-only">Requested units per household</caption><thead><tr><th>Household ID</th>${[...columns.values()].map(name => `<th>${escape(name)}</th>`).join("")}<th><span class="sr-only">Actions</span></th></tr></thead><tbody>${recipients.map((recipient, i) => `<tr><td><input data-recipient="${i}" data-field="id" value="${escape(recipient.id)}" aria-label="Household ${i + 1} ID" required></td>${[...columns].map(([id, name]) => `<td>${quantityInput(Object.hasOwn(recipient.requests, id) ? recipient.requests[id] : 0, `data-recipient="${i}" data-request="${escape(id)}"`, `${recipient.id}: ${name} requested units`)}</td>`).join("")}<td><button type="button" class="remove" data-action="remove-recipient" data-index="${i}" aria-label="Remove household ${escape(recipient.id)}">Remove</button></td></tr>`).join("")}</tbody></table></div>` : '<p class="empty-inline">No households yet. Add anonymous household IDs and their requested units.</p>';
  }
  function renderEditors() { renderSupplies(); renderHouseholds(); }
  function nextId(prefix, list) {
    let n = 1;
    while (list.some(entry => entry.id === `${prefix}${String(n).padStart(3, "0")}`)) n++;
    return `${prefix}${String(n).padStart(3, "0")}`;
  }
  function quantity(value, label) {
    if (String(value).trim() === "" || !Number.isSafeInteger(Number(value)) || Number(value) < 0) {
      throw new Error(`${label}: enter a whole number from 0 to ${Number.MAX_SAFE_INTEGER}.`);
    }
    return Number(value);
  }
  function snapshot() {
    const ids = new Set(items.map(item => item.id));
    const seen = new Set();
    return {
      items: items.map(item => {
        if (!item.name.trim()) throw new Error(`Enter a supply name for ${item.id}.`);
        return { ...item, name: item.name.trim(), stock: quantity(item.stock, `${item.name} stock`) };
      }),
      recipients: recipients.map(recipient => {
        const id = recipient.id.trim();
        if (!id) throw new Error("Enter an anonymous ID for every household.");
        if (seen.has(id)) throw new Error(`Household ID "${id}" is repeated. Use a unique ID.`);
        seen.add(id);
        const requests = Object.fromEntries(Object.entries(recipient.requests).map(([itemId, value]) => {
          if (!ids.has(itemId)) throw new Error(`Household ${id} requests unknown supply "${itemId}". Import the matching supplies or remove this household.`);
          return [itemId, quantity(value, `${id}, ${itemId} request`)];
        }));
        return { id, requests };
      }),
    };
  }
  async function run(action, message) {
    if (busy) return;
    busy = true;
    find("#editor").disabled = true;
    find('[data-action="example"]').disabled = true;
    find('[data-action="export"]').disabled = true;
    root.setAttribute("aria-busy", "true");
    clearError();
    status(message);
    try { await action(); }
    catch (error) { showError(error instanceof Error ? error.message : String(error)); }
    finally {
      busy = false;
      find("#editor").disabled = false;
      find('[data-action="example"]').disabled = false;
      find('[data-action="export"]').disabled = !result;
      root.removeAttribute("aria-busy");
    }
  }

  root.addEventListener("input", event => {
    const target = event.target;
    if (busy || !target.matches("input[data-field], input[data-request]")) return;
    if (target.dataset.item !== undefined) items[Number(target.dataset.item)][target.dataset.field] = target.value;
    else {
      const recipient = recipients[Number(target.dataset.recipient)];
      if (target.dataset.request !== undefined) {
        Object.defineProperty(recipient.requests, target.dataset.request, { value: target.value, writable: true, enumerable: true, configurable: true });
      } else recipient.id = target.value;
    }
    changed();
  });
  root.addEventListener("change", event => {
    if (event.target.matches('input[data-field="name"]')) renderHouseholds();
    if (!event.target.matches('input[type="file"]') || busy) return;
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    changed();
    const handler = event.target.id === "items-file" ? handlers.onImportItems : handlers.onImportRequests;
    void run(() => handler(file), "Importing CSV…");
  });
  root.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button || busy) return;
    const action = button.dataset.action;
    if (action === "calculate") {
      changed();
      try {
        submitted = snapshot();
        void run(() => handlers.onAllocate(structuredClone(submitted)), "Calculating allocation…");
      } catch (error) { showError(error.message); }
      return;
    }
    if (action === "export") {
      if (result) void run(() => handlers.onExport(), "Export requested. Check your browser downloads.");
      return;
    }
    if (action === "import-items" || action === "import-requests") {
      find(action === "import-items" ? "#items-file" : "#requests-file").click();
      return;
    }
    if (action === "add-item") items.push({ id: nextId("S", items), name: "", stock: 0 });
    if (action === "add-recipient") recipients.push({ id: nextId("H", recipients), requests: {} });
    if (action === "remove-item") {
      const [removed] = items.splice(Number(button.dataset.index), 1);
      for (const recipient of recipients) delete recipient.requests[removed.id];
    }
    if (action === "remove-recipient") recipients.splice(Number(button.dataset.index), 1);
    if (action === "example") {
      items = [{ id: "rice", name: "Rice bags", stock: 8 }, { id: "water", name: "Water bottles", stock: 10 }, { id: "hygiene", name: "Hygiene kits", stock: 5 }];
      recipients = [
        { id: "H001", requests: { rice: 4, water: 3, hygiene: 2 } },
        { id: "H002", requests: { rice: 4, water: 2, hygiene: 2 } },
        { id: "H003", requests: { rice: 3, water: 3, hygiene: 2 } },
      ];
    }
    changed();
    renderEditors();
    if (action === "add-item") find(`input[data-item="${items.length - 1}"]`).focus();
    if (action === "add-recipient") find(`input[data-recipient="${recipients.length - 1}"]`).focus();
    if (action === "example") status("Example inputs loaded. Calculate Allocation to create the demonstration results.");
  });

  renderEditors();
  renderResults();
  return {
    setItems(value) { items = structuredClone(value); changed(); renderEditors(); status("Supplies imported. Review requests, then calculate."); },
    setRecipients(value) { recipients = structuredClone(value); changed(); renderEditors(); status("Household requests imported. Review inputs, then calculate."); },
    showResults(value) {
      if (!submitted) return;
      result = value;
      clearError();
      renderResults();
      status("Allocation ready. Review household allocations and remaining inventory below.");
    },
    showError,
    clearResults,
  };
}
