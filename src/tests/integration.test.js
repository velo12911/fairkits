import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { allocate } from "../core/allocate.js";
import { parseItemsCsv, parseRequestsCsv, reportToCsv } from "../io/csv.js";
import { MAX_CSV_BYTES, MAX_ITEMS, assertDistributionSize } from "../io/limits.js";

// Execute the actual entry module with import bindings supplied by the harness.
// Only the DOM mount/download boundary and, for race tests, the engine are replaced.
// JSON is shared so objects passed to the real engine have the expected realm.
const entry = readFileSync(new URL("../main.js", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?;\r?\n/gm, "");
const input = () => ({ items: [{ id: "rice", name: "Rice", stock: 1 }],
  recipients: [{ id: "H1", requests: { rice: 2 } }] });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const csvFile = (text) => ({ size: new TextEncoder().encode(text).length, text: async () => text });
function harness(engine = allocate) {
  let handlers;
  const state = { results: [], errors: [], items: [], recipients: [], downloads: [], visible: null };
  vm.runInNewContext(entry, {
    JSON, MAX_CSV_BYTES, assertDistributionSize, allocate: engine,
    parseItemsCsv, parseRequestsCsv, reportToCsv,
    document: { querySelector: () => ({}) },
    downloadCsv: (filename, csv) => state.downloads.push({ filename, csv }),
    mountApp: (_, supplied) => {
      handlers = supplied;
      return {
        clearResults() { state.visible = null; },
        showResults(result) { state.visible = result; state.results.push(result); },
        showError(error) { state.errors.push(error); },
        setItems(items) { state.items.push(items); handlers.onInputChange(); },
        setRecipients(recipients) { state.recipients.push(recipients); handlers.onInputChange(); },
      };
    },
  });
  return { handlers, state };
}

test("integration preserves calculation, CSV imports, export, and edit invalidation", async () => {
  const { handlers, state } = harness();
  await handlers.onImportItems(csvFile("id,name,stock\nrice,Rice,1"));
  await handlers.onImportRequests(csvFile("recipientId,itemId,quantity\nH1,rice,2"));
  assert.equal(state.items[0][0].id, "rice");
  assert.equal(state.recipients[0][0].id, "H1");
  await handlers.onAllocate(input());
  handlers.onExport();
  assert.equal(state.downloads[0].filename, "allocation-report.csv");
  assert.match(state.downloads[0].csv, /H1,rice,2,1,1/);
  handlers.onInputChange();
  handlers.onExport();
  assert.equal(state.visible, null);
  assert.equal(state.downloads.length, 1);
  assert.match(state.errors.at(-1), /Calculate an allocation/);
});

test("an input change invalidates a pending calculation and its export", async () => {
  const work = deferred();
  const { handlers, state } = harness(() => work.promise);
  const pending = handlers.onAllocate(input());
  handlers.onInputChange();
  work.resolve(allocate(input()));
  await pending;
  handlers.onExport();
  assert.equal(state.results.length, 0);
  assert.equal(state.downloads.length, 0);
});

test("newer calculations win when earlier calculations complete last", async () => {
  const old = deferred();
  const recent = deferred();
  let calls = 0;
  const { handlers, state } = harness(() => ++calls === 1 ? old.promise : recent.promise);
  const first = handlers.onAllocate(input());
  const next = input(); next.items[0].stock = 2;
  const second = handlers.onAllocate(next);
  recent.resolve(allocate(next)); await second;
  old.resolve(allocate(input())); await first;
  assert.equal(state.results.length, 1);
  handlers.onExport();
  assert.match(state.downloads[0].csv, /H1,rice,2,2,0/);
});

test("stale calculation errors cannot overwrite a newer successful operation", async () => {
  const old = deferred();
  let calls = 0;
  const { handlers, state } = harness(data => ++calls === 1 ? old.promise : allocate(data));
  const pending = handlers.onAllocate(input());
  await handlers.onAllocate(input());
  old.reject(new Error("obsolete failure")); await pending;
  assert.equal(state.results.length, 1);
  assert.deepEqual(state.errors, []);
});

test("newer imports win and stale invalid CSV is discarded before parsing", async () => {
  const old = deferred();
  const { handlers, state } = harness();
  const pending = handlers.onImportItems({ size: 20, text: () => old.promise });
  await handlers.onImportItems(csvFile("id,name,stock\nnew,New,2"));
  old.resolve("malformed old file"); await pending;
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0][0].id, "new");
  assert.deepEqual(state.errors, []);
});

test("input edits cancel pending imports, including rejected file reads", async () => {
  for (const reject of [false, true]) {
    const old = deferred();
    const { handlers, state } = harness();
    const pending = handlers.onImportRequests({ size: 20, text: () => old.promise });
    handlers.onInputChange();
    if (reject) old.reject(new Error("obsolete read failure"));
    else old.resolve("recipientId,itemId,quantity\nH1,rice,1");
    await pending;
    assert.deepEqual(state.recipients, []);
    assert.deepEqual(state.errors, []);
  }
});

test("imports and calculations invalidate each other across asynchronous boundaries", async () => {
  const oldImport = deferred();
  const { handlers, state } = harness();
  const pendingImport = handlers.onImportItems({ size: 20, text: () => oldImport.promise });
  await handlers.onAllocate(input());
  oldImport.resolve("id,name,stock\nold,Old,1"); await pendingImport;
  assert.deepEqual(state.items, []);
  handlers.onExport();
  assert.equal(state.downloads.length, 1);

  const oldCalculation = deferred();
  const other = harness(() => oldCalculation.promise);
  const pendingCalculation = other.handlers.onAllocate(input());
  await other.handlers.onImportRequests(csvFile("recipientId,itemId,quantity\nH2,rice,1"));
  oldCalculation.resolve(allocate(input())); await pendingCalculation;
  assert.deepEqual(other.state.results, []);
  assert.equal(other.state.recipients[0][0].id, "H2");
});

test("oversized files are rejected before reading and declared size cannot bypass parser limits", async () => {
  const { handlers, state } = harness();
  let reads = 0;
  await handlers.onImportItems({ size: MAX_CSV_BYTES + 1, text() { reads++; return ""; } });
  assert.equal(reads, 0);
  assert.match(state.errors.at(-1), /no larger than/);
  await handlers.onImportItems({ size: 0, text: async () => "x".repeat(MAX_CSV_BYTES + 1) });
  assert.match(state.errors.at(-1), /byte size limit/);
  assert.deepEqual(state.items, []);
  await handlers.onImportItems({ size: MAX_CSV_BYTES, text: async () => "id,name,stock\nrice,Rice,1" });
  assert.equal(state.items.length, 1);
});

test("failed current imports preserve prior inputs but invalidate previous exports", async () => {
  const { handlers, state } = harness();
  await handlers.onImportItems(csvFile("id,name,stock\nrice,Rice,1"));
  await handlers.onAllocate(input());
  await handlers.onImportItems(csvFile("bad header"));
  assert.equal(state.items.length, 1);
  assert.equal(state.visible, null);
  assert.equal(state.errors.length, 1);
  handlers.onExport();
  assert.deepEqual(state.downloads, []);
});

test("integration rejects oversized distributions before calling the engine", async () => {
  let calls = 0;
  const { handlers, state } = harness(() => { calls++; });
  const data = input();
  data.items = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({ id: `S${i}`, stock: 0 }));
  await handlers.onAllocate(data);
  assert.equal(calls, 0);
  assert.match(state.errors[0], /supplies/);
});

test("inconsistent engine allocations cannot be downloaded", async () => {
  const { handlers, state } = harness(() => ({ allocations: [{ recipientId: "H1", itemId: "rice", quantity: 3 }] }));
  await handlers.onAllocate(input());
  handlers.onExport();
  assert.equal(state.downloads.length, 0);
  assert.match(state.errors[0], /exceeds requested/);
});
