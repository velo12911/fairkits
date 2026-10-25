import assert from "node:assert/strict";
import test from "node:test";
import { parseItemsCsv, parseRequestsCsv, reportToCsv } from "../io/csv.js";
import { MAX_CSV_BYTES, MAX_CSV_ROWS, MAX_CSV_FIELD_LENGTH, MAX_ITEMS,
  MAX_RECIPIENTS, MAX_MATRIX_CELLS, assertDistributionSize } from "../io/limits.js";

test("CSV rejects every C0/C1 control in all ID columns before trimming", () => {
  for (const code of [...Array.from({ length: 32 }, (_, i) => i),
    ...Array.from({ length: 33 }, (_, i) => i + 127)]) {
    const id = `"${String.fromCharCode(code)}safe"`;
    assert.throws(() => parseItemsCsv(`id,name,stock\n${id},Rice,1`), /control characters/);
    assert.throws(() => parseRequestsCsv(`recipientId,itemId,quantity\n${id},rice,1`), /control characters/);
    assert.throws(() => parseRequestsCsv(`recipientId,itemId,quantity\nH1,${id},1`), /control characters/);
  }
  assert.equal(parseItemsCsv('id,name,stock\n" چاول ",Rice,1')[0].id, "چاول");
});

test("CSV size limit measures UTF-8 bytes, including direct parser calls", () => {
  assert.throws(() => parseItemsCsv("a".repeat(MAX_CSV_BYTES + 1)), /byte size limit/);
  const unicode = "é".repeat(MAX_CSV_BYTES / 2 + 1);
  assert.ok(unicode.length < MAX_CSV_BYTES);
  assert.throws(() => parseRequestsCsv(unicode), /byte size limit/);
});

test("CSV record limit includes duplicates and blank records but not quoted newlines", () => {
  const atLimit = "id,name,stock\n" + "rice,Rice,1\n".repeat(MAX_CSV_ROWS);
  assert.equal(parseItemsCsv(atLimit).length, 1);
  assert.throws(() => parseItemsCsv(atLimit + "rice,Rice,1"), /data record limit/);
  assert.throws(() => parseItemsCsv("id,name,stock\n" + "\n".repeat(MAX_CSV_ROWS + 1)), /data record limit/);
  assert.equal(parseItemsCsv('id,name,stock\nrice,"Rice\nbags",1')[0].name, "Rice\nbags");
});

test("CSV field limit applies during parsing to raw decoded fields and escaped quotes", () => {
  const name = "a".repeat(MAX_CSV_FIELD_LENGTH);
  assert.equal(parseItemsCsv(`id,name,stock\nrice,${name},1`)[0].name, name);
  assert.throws(() => parseItemsCsv(`id,name,stock\nrice,${name}a,1`), /field.*exceeds/);
  assert.throws(() => parseItemsCsv(`id,name,stock\nrice,"${'""'.repeat(MAX_CSV_FIELD_LENGTH + 1)}",1`), /field.*exceeds/);
  assert.throws(() => parseItemsCsv(`id,name,stock\nrice,${" ".repeat(MAX_CSV_FIELD_LENGTH + 1)},1`), /field.*exceeds/);
  assert.throws(() => parseItemsCsv("id,name,stock\nrice,Rice,1,extra"), /Too many CSV fields/);
});

test("shared distribution limits bound supplies, households, and unknown request columns", () => {
  const items = Array.from({ length: MAX_ITEMS }, (_, i) => ({ id: `S${i}` }));
  const recipients = Array.from({ length: MAX_RECIPIENTS }, (_, i) => ({ id: `H${i}`, requests: {} }));
  assert.equal(items.length * recipients.length, MAX_MATRIX_CELLS);
  assert.doesNotThrow(() => assertDistributionSize(items, recipients));
  assert.throws(() => assertDistributionSize([...items, { id: "extra" }], []), /supplies/);
  assert.throws(() => assertDistributionSize([], [...recipients, { id: "extra", requests: {} }]), /households/);
  assert.throws(() => assertDistributionSize(items, [{ id: "H", requests: { unknown: 1 } }]), /supply columns/);
  assert.throws(() => parseItemsCsv("id,name,stock\n" + Array.from({ length: MAX_ITEMS + 1 }, (_, i) => `S${i},Rice,1`).join("\n")), /supplies/);
  assert.throws(() => parseRequestsCsv("recipientId,itemId,quantity\n" + Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `H${i},rice,1`).join("\n")), /households/);
});

test("CSV export rejects allocations exceeding requests or referring to unknown recipients", () => {
  const input = [{ id: "H1", requests: { rice: 1, water: 0 } }];
  for (const allocations of [{ rice: 2 }, { water: 1 }, { missing: 1 }]) {
    assert.throws(() => reportToCsv(input, { H1: allocations }), /exceeds requested/);
  }
  assert.throws(() => reportToCsv(input, { unknown: { rice: 1 } }), /unknown recipient/);
  assert.match(reportToCsv(input, { H1: { rice: 1, water: 0 } }), /H1,rice,1,1,0/);
  assert.match(reportToCsv(input, {}), /H1,rice,1,0,1/);
});

test("parseItemsCsv handles reordered columns, BOM, and quoted fields", () => {
  const items = parseItemsCsv(
    '\uFEFFstock,name,id\r\n6,"Rice, long grain",rice\r\n2,"Beans\nblack",beans\r\n'
  );

  assert.deepEqual(items, [
    { id: "rice", name: "Rice, long grain", stock: 6 },
    { id: "beans", name: "Beans\nblack", stock: 2 },
  ]);
});

test("parseItemsCsv deduplicates identical items and rejects conflicts", () => {
  assert.deepEqual(
    parseItemsCsv("id,name,stock\nrice,Rice,6\nrice,Rice,6\n"),
    [{ id: "rice", name: "Rice", stock: 6 }]
  );
  assert.throws(
    () => parseItemsCsv("id,name,stock\nrice,Rice,6\nrice,Rice,7\n"),
    /Conflicting duplicate item id/
  );
});

test("CSV parsers reject malformed records and invalid quantities", () => {
  assert.throws(() => parseItemsCsv("id,name,stock\nrice,\"Rice,6\n"), /Unclosed quoted field/);
  assert.throws(() => parseItemsCsv("id,name,stock\nrice,Rice,-1\n"), /Invalid stock/);
  assert.throws(() => parseRequestsCsv("recipientId,itemId,quantity\nH001,rice,0\n"), /Invalid quantity/);
  assert.throws(() => parseItemsCsv("id,id,stock\nrice,Rice,6\n"), /Duplicate column/);
});

test("parseRequestsCsv combines repeated recipient and item rows", () => {
  assert.deepEqual(
    parseRequestsCsv(
      "recipientId,itemId,quantity\nH001,rice,2\nH002,rice,1\nH001,rice,3\nH001,beans,4\n"
    ),
    [
      { id: "H001", requests: { rice: 5, beans: 4 } },
      { id: "H002", requests: { rice: 1 } },
    ]
  );
});

test("parseRequestsCsv safely aggregates prototype-like item IDs", () => {
  const [recipient] = parseRequestsCsv(
    "recipientId,itemId,quantity\nH001,__proto__,2\nH001,__proto__,3\nH001,constructor,4\n"
  );

  assert.equal(Object.hasOwn(recipient.requests, "__proto__"), true);
  assert.equal(recipient.requests.__proto__, 5);
  assert.equal(recipient.requests.constructor, 4);
});

test("reportToCsv quotes fields and neutralizes spreadsheet formulas", () => {
  const csv = reportToCsv(
    [
      { id: "=H001", requests: { "rice,white": 4, beans: 1 } },
      { id: "H\"002", requests: { "rice,white": 2 } },
    ],
    {
      "=H001": { "rice,white": 2, beans: 1 },
      'H"002': { "rice,white": 2 },
    }
  );

  assert.equal(
    csv,
    [
      "recipientId,itemId,requested,allocated,unmet",
      "'=H001,\"rice,white\",4,2,2",
      "'=H001,beans,1,1,0",
      '"H""002","rice,white",2,2,0',
    ].join("\r\n")
  );
});
