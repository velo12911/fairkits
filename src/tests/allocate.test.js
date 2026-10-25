import test from "node:test";
import assert from "node:assert/strict";
import { allocate } from "../core/allocate.js";

test("security: validates non-enumerable request quantities", () => {
    for (const value of [-1, 0.5, NaN, Infinity, "2"]) {
        const requests = Object.defineProperty({}, "rice", { value });
        assert.throws(() => allocate({ items: [{ id: "rice", stock: 3 }],
            recipients: [{ id: "H1", requests }] }), /nonnegative safe integer/);
    }
});

test("security: rejects hidden unknown and symbol request keys", () => {
    for (const key of ["unknown", Symbol("rice")]) {
        const requests = Object.defineProperty({}, key, { value: 1 });
        assert.throws(() => allocate({ items: [{ id: "rice", stock: 3 }],
            recipients: [{ id: "H1", requests }] }), /Unknown item|symbol/i);
    }
});

test("security: rejects accessor quantities without executing them", () => {
    let reads = 0;
    const item = { id: "rice", get stock() { reads++; return reads === 1 ? 1 : 10; } };
    assert.throws(() => allocate({ items: [item], recipients: [{ id: "H1", requests: { rice: 10 } }] }), /data property/);
    const requests = { get rice() { reads++; return 10; } };
    assert.throws(() => allocate({ items: [{ id: "rice", stock: 1 }], recipients: [{ id: "H1", requests }] }), /data property/);
    assert.equal(reads, 0);
});

test("security: accepts null-prototype records without modifying prototypes", () => {
    const requests = Object.assign(Object.create(null), { constructor: 2, toString: 1 });
    Object.defineProperty(requests, "__proto__", { value: 3, enumerable: true });
    const before = Object.getOwnPropertyDescriptors(Object.prototype);
    const result = allocate({ items: Object.keys(requests).map(id => ({ id, stock: 9 })),
        recipients: [{ id: "__proto__", requests }] });
    assert.deepEqual(result.allocations.map(r => r.quantity), [2, 1, 3]);
    assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
});

test("security: conserves large inventories exactly using an independent BigInt oracle", () => {
    const max = Number.MAX_SAFE_INTEGER;
    for (let count = 1; count <= 12; count++) {
        for (const stock of [0, 1, max - 1, max]) {
            const requests = Array.from({ length: count }, (_, i) => i % 3 === 0 ? 1 : max - i);
            const result = allocate({ items: [{ id: "rice", stock }],
                recipients: requests.map((rice, i) => ({ id: String(i), requests: { rice } })) });
            let total = 0n;
            for (const row of result.allocations) {
                assert.ok(Number.isSafeInteger(row.quantity) && row.quantity > 0);
                assert.ok(row.quantity <= requests[Number(row.recipientId)]);
                total += BigInt(row.quantity);
            }
            assert.equal(total + BigInt(result.remainingStock.rice), BigInt(stock));
            const demand = requests.reduce((sum, quantity) => sum + BigInt(quantity), 0n);
            assert.equal(total, demand < BigInt(stock) ? demand : BigInt(stock));
        }
    }
});

const fixture = (stock = 6, requests = [4, 4, 4]) => ({
    items: [{ id: "rice", name: "Rice", stock }],
    recipients: requests.map((rice, i) => ({ id: `H00${i + 1}`, requests: { rice } })),
});
const row = (recipientId, itemId, quantity) => ({ recipientId, itemId, quantity });

test("matches the agreed contract, including normal shortage warnings", () => {
    assert.deepEqual(allocate(fixture()), {
        allocations: [row("H001", "rice", 2), row("H002", "rice", 2), row("H003", "rice", 2)],
        remainingStock: { rice: 0 }, warnings: [],
    });
});

test("rotates the starting recipient per item and wraps around", () => {
    const input = {
        items: ["a", "b", "c", "d"].map(id => ({ id, stock: 1 })),
        recipients: ["x", "y", "z"].map(id => ({ id, requests: { a: 2, b: 2, c: 2, d: 2 } })),
    };
    assert.deepEqual(allocate(input).allocations, [
        row("x", "a", 1), row("y", "b", 1), row("z", "c", 1), row("x", "d", 1),
    ]);
});

test("skips satisfied recipients and distributes the partial round in order", () => {
    assert.deepEqual(allocate(fixture(8, [1, 8, 8])).allocations, [
        row("H001", "rice", 1), row("H002", "rice", 4), row("H003", "rice", 3),
    ]);
});

test("handles zero stock, zero requests, surplus and exact stock", () => {
    assert.deepEqual(allocate(fixture(0)).allocations, []);
    assert.deepEqual(allocate(fixture(8, [0, 0])).remainingStock, { rice: 8 });
    assert.deepEqual(allocate(fixture(8, [0, 0])).allocations, []);
    assert.deepEqual(allocate(fixture(10, [1, 2])).remainingStock, { rice: 7 });
    assert.deepEqual(allocate(fixture(3, [1, 2])).allocations, [row("H001", "rice", 1), row("H002", "rice", 2)]);
});

test("handles empty recipient and item lists and missing request keys", () => {
    assert.deepEqual(allocate(fixture(8, [])), { allocations: [], remainingStock: { rice: 8 }, warnings: [] });
    assert.deepEqual(allocate({ items: [], recipients: [{ id: "x", requests: {} }] }),
        { allocations: [], remainingStock: {}, warnings: [] });
    const input = fixture(8);
    input.recipients.forEach(recipient => { recipient.requests = {}; });
    assert.deepEqual(allocate(input).remainingStock, { rice: 8 });
});

test("is deterministic and does not mutate deeply frozen input", () => {
    const input = fixture(7, [1, 9, 4]);
    const before = structuredClone(input);
    function freeze(value) {
        for (const child of Object.values(value)) {
            if (child && typeof child === "object") freeze(child);
        }
        Object.freeze(value);
    }
    freeze(input);
    const first = allocate(input);
    assert.deepEqual(allocate(input), first);
    assert.deepEqual(input, before);
    first.allocations[0].quantity = 999;
    first.remainingStock.rice = 999;
    assert.deepEqual(allocate(input), allocate(before));
});

test("supports very large quantities and total demand above the safe integer limit", () => {
    const max = Number.MAX_SAFE_INTEGER;
    assert.deepEqual(allocate(fixture(max, [max, max])).allocations, [
        row("H001", "rice", 4503599627370496), row("H002", "rice", 4503599627370495),
    ]);
    assert.deepEqual(allocate(fixture(max, [max])).remainingStock, { rice: 0 });
    assert.deepEqual(allocate(fixture(max, [1, 2])).remainingStock, { rice: max - 3 });
});

test("treats prototype-like IDs as ordinary own keys", () => {
    const input = {
        items: ["__proto__", "constructor", "toString"].map(id => ({ id, stock: 2 })),
        recipients: [{ id: "__proto__", requests: JSON.parse('{"__proto__":1,"constructor":1}') }],
    };
    const result = allocate(input);
    assert.deepEqual(result.allocations, [row("__proto__", "__proto__", 1), row("__proto__", "constructor", 1)]);
    assert.deepEqual(result.remainingStock, JSON.parse('{"__proto__":1,"constructor":1,"toString":2}'));
    assert.equal(Object.getPrototypeOf(result.remainingStock), Object.prototype);
});

test("rejects invalid input structures, including sparse arrays", () => {
    for (const input of [undefined, null, [], 3, {}, { items: {}, recipients: [] }, { items: [], recipients: null }]) {
        assert.throws(() => allocate(input), /items and recipients arrays/);
    }
    for (const item of [null, [], 4, undefined]) {
        assert.throws(() => allocate({ items: [item], recipients: [] }), /item must be an object/);
    }
    assert.throws(() => allocate({ items: new Array(1), recipients: [] }), /item must be an object/);
    for (const recipient of [null, [], 4, undefined]) {
        assert.throws(() => allocate({ items: [], recipients: [recipient] }), /recipient must be an object/);
    }
    for (const requests of [undefined, null, [], 4, new Date()]) {
        assert.throws(() => allocate({ items: [], recipients: [{ id: "x", requests }] }), /Requests.*must be an object/);
    }
});

test("rejects duplicate IDs and empty or non-string IDs", () => {
    const duplicateItem = fixture();
    duplicateItem.items.push({ id: "rice", stock: 0 });
    assert.throws(() => allocate(duplicateItem), /Duplicate item ID/);
    const duplicateRecipient = fixture();
    duplicateRecipient.recipients[1].id = "H001";
    assert.throws(() => allocate(duplicateRecipient), /Duplicate recipient ID/);
    for (const id of [undefined, null, "", "  ", 42]) {
        const input = fixture();
        input.items[0].id = id;
        assert.throws(() => allocate(input), /item ID must be a nonempty string/);
        const other = fixture();
        other.recipients[0].id = id;
        assert.throws(() => allocate(other), /recipient ID must be a nonempty string/);
    }
});

test("rejects invalid stock and request quantities without coercion", () => {
    for (const quantity of [-1, 1.5, NaN, Infinity, -Infinity, "2", null, undefined, true, 1n, Number.MAX_SAFE_INTEGER + 1]) {
        const input = fixture();
        input.items[0].stock = quantity;
        assert.throws(() => allocate(input), /Stock.*nonnegative safe integer/);
        assert.throws(() => allocate(fixture(0, [quantity])), /Request.*nonnegative safe integer/);
    }
});

test("rejects unknown item references even when their request is zero", () => {
    for (const quantity of [0, 1]) {
        const input = fixture();
        input.recipients[0].requests.unknown = quantity;
        assert.throws(() => allocate(input), /Unknown item "unknown".*"H001"/);
    }
});

// A deliberately simple per-unit oracle, used only with small quantities.
function reference(input) {
    const allocations = [];
    const remainingStock = {};
    input.items.forEach((item, itemIndex) => {
        let stock = item.stock;
        const quantities = input.recipients.map(() => 0);
        while (stock > 0) {
            let progressed = false;
            for (let offset = 0; offset < quantities.length && stock > 0; offset++) {
                const i = (itemIndex + offset) % quantities.length;
                if (quantities[i] < (input.recipients[i].requests[item.id] ?? 0)) {
                    quantities[i]++;
                    stock--;
                    progressed = true;
                }
            }
            if (!progressed) break;
        }
        quantities.forEach((quantity, i) => {
            if (quantity) allocations.push(row(input.recipients[i].id, item.id, quantity));
        });
        remainingStock[item.id] = stock;
    });
    return { allocations, remainingStock, warnings: [] };
}

test("matches unit-round-robin and conserves inventory across 1920 exhaustive cases", () => {
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) {
        for (let stock = 0; stock < 10; stock++) for (let rotation = 0; rotation < 3; rotation++) {
            const input = fixture(stock, [a, b, c]);
            input.items.unshift(...Array.from({ length: rotation }, (_, i) => ({ id: `empty${i}`, stock: 0 })));
            const result = allocate(input);
            assert.deepEqual(result, reference(input));
            let total = 0;
            for (const allocation of result.allocations) {
                const request = input.recipients.find(r => r.id === allocation.recipientId).requests[allocation.itemId];
                assert.ok(Number.isSafeInteger(allocation.quantity) && allocation.quantity > 0 && allocation.quantity <= request);
                total += allocation.quantity;
            }
            assert.equal(total + result.remainingStock.rice, stock);
            assert.equal(total, Math.min(stock, a + b + c));
        }
    }
});
