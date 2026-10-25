
function isRecord(value) {
    return value !== null && typeof value === "object" &&
        (Object.getPrototypeOf(value) === Object.prototype ||
            Object.getPrototypeOf(value) === null);
}

function validateQuantity(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a nonnegative safe integer.`);
    }
}

function validateId(id, label, seen) {
    if (typeof id !== "string" || id.trim() === "") {
        throw new Error(`${label} must be a nonempty string.`);
    }
    if (seen.has(id)) throw new Error(`Duplicate ${label}: "${id}".`);
    seen.add(id);
}

// Accept data, not executable getters or inherited fields. Allocation uses only
// the validated copies below, so a later property read cannot change quantities.
function ownData(record, key, label) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) return undefined;
    if (!Object.hasOwn(descriptor, "value")) {
        throw new Error(`${label} must be an own data property, not an accessor.`);
    }
    return descriptor.value;
}

/**
 * Item i starts at recipient i % recipientCount. Missing requests mean zero.
 * Emit positive allocations in item order, then original recipient order.
 * Shortages are normal (warnings stays empty), as in the contract example.
 * Safe integer quantities keep inventory arithmetic exact.
 */
export function allocate(input) {
    if (!isRecord(input)) {
        throw new Error("Input must be an object with items and recipients arrays.");
    }
    const sourceItems = ownData(input, "items", "Items");
    const sourceRecipients = ownData(input, "recipients", "Recipients");
    if (!Array.isArray(sourceItems) || !Array.isArray(sourceRecipients)) {
        throw new Error("Input must be an object with items and recipients arrays.");
    }
    const items = [];
    const recipients = [];
    const itemIds = new Set();
    for (let index = 0; index < sourceItems.length; index++) {
        const item = ownData(sourceItems, index, "Item array entry");
        if (!isRecord(item)) throw new Error("Each item must be an object.");
        const id = ownData(item, "id", "Item ID");
        const stock = ownData(item, "stock", "Stock");
        validateId(id, "item ID", itemIds);
        validateQuantity(stock, `Stock for item "${id}"`);
        items.push({ id, stock });
    }
    const recipientIds = new Set();
    for (let index = 0; index < sourceRecipients.length; index++) {
        const recipient = ownData(sourceRecipients, index, "Recipient array entry");
        if (!isRecord(recipient)) throw new Error("Each recipient must be an object.");
        const id = ownData(recipient, "id", "Recipient ID");
        validateId(id, "recipient ID", recipientIds);
        const sourceRequests = ownData(recipient, "requests", "Requests");
        if (!isRecord(sourceRequests)) {
            throw new Error(`Requests for recipient "${id}" must be an object.`);
        }
        const requests = Object.create(null);
        for (const itemId of Reflect.ownKeys(sourceRequests)) {
            if (typeof itemId !== "string") {
                throw new Error(`Requests for recipient "${id}" cannot use symbol item IDs.`);
            }
            if (!itemIds.has(itemId)) {
                throw new Error(`Unknown item "${itemId}" requested by recipient "${id}".`);
            }
            const quantity = ownData(sourceRequests, itemId, `Request for item "${itemId}"`);
            validateQuantity(quantity, `Request for item "${itemId}" by recipient "${id}"`);
            requests[itemId] = quantity;
        }
        recipients.push({ id, requests });
    }

    const allocations = [];
    const remainingStock = {};
    items.forEach((item, itemIndex) => {
        const requests = recipients.map(recipient =>
            Object.hasOwn(recipient.requests, item.id) ? recipient.requests[item.id] : 0);
        let maxRequest = 0;
        for (const request of requests) maxRequest = Math.max(maxRequest, request);

        // Binary-search the largest affordable number of complete rounds.
        // Subtract from a budget to avoid overflowing a total-demand sum.
        let low = 0;
        let high = Math.min(item.stock, maxRequest);
        while (low < high) {
            const rounds = low + Math.ceil((high - low) / 2);
            let budget = item.stock;
            let affordable = true;
            for (const request of requests) {
                const quantity = Math.min(request, rounds);
                if (quantity > budget) {
                    affordable = false;
                    break;
                }
                budget -= quantity;
            }
            if (affordable) low = rounds;
            else high = rounds - 1;
        }

        let stock = item.stock;
        const quantities = requests.map(request => {
            const quantity = Math.min(request, low);
            stock -= quantity;
            return quantity;
        });
        // At most one partial round remains; skip satisfied recipients.
        const count = requests.length;
        for (let offset = 0; offset < count && stock > 0; offset++) {
            const index = (itemIndex % count + offset) % count;
            if (quantities[index] < requests[index]) {
                quantities[index]++;
                stock--;
            }
        }
        quantities.forEach((quantity, index) => {
            if (quantity > 0) {
                allocations.push({ recipientId: recipients[index].id, itemId: item.id, quantity });
            }
        });
        // Own properties let IDs such as "__proto__" remain ordinary keys.
        Object.defineProperty(remainingStock, item.id, {
            value: stock, enumerable: true, writable: true, configurable: true,
        });
    });
    return { allocations, remainingStock, warnings: [] };
}
