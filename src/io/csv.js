import { MAX_CSV_BYTES, MAX_CSV_ROWS, MAX_CSV_FIELD_LENGTH, assertDistributionSize } from "./limits.js";

function parseCsvRecords(text) {
  if (typeof text !== "string") {
    throw new TypeError("CSV input must be a string.");
  }
  // Check before normalization, tokenization, or allocating an unbounded byte buffer.
  if (text.length > MAX_CSV_BYTES || new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES) {
    throw new Error(`CSV exceeds the ${MAX_CSV_BYTES}-byte size limit.`);
  }

  const input = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const records = [];

  let fields = [];
  let field = "";
  let line = 1;
  let recordLine = 1;
  let quoteLine = 1;
  let inQuotes = false;
  let afterQuote = false;
  let recordCount = 0;

  function append(char) {
    if (field.length >= MAX_CSV_FIELD_LENGTH) {
      throw new Error(`CSV field on line ${recordLine} exceeds ${MAX_CSV_FIELD_LENGTH} characters.`);
    }
    field += char;
  }

  function finishField() {
    if (fields.length >= 3) throw new Error(`Too many CSV fields on line ${recordLine}; expected 3.`);
    fields.push(field);
    field = "";
    afterQuote = false;
  }

  function finishRecord() {
    if (++recordCount > MAX_CSV_ROWS + 1) {
      throw new Error(`CSV exceeds the ${MAX_CSV_ROWS} data record limit.`);
    }
    finishField();

    if (!fields.every((value) => value.trim() === "")) {
      records.push({ fields, line: recordLine });
    }

    fields = [];
    recordLine = line + 1;
  }

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          append('"');
          i++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        append(char);
        if (char === "\n") line++;
      }
      continue;
    }

    if (afterQuote) {
      if (char === ",") {
        finishField();
      } else if (char === "\n") {
        finishRecord();
        line++;
        recordLine = line;
      } else {
        throw new Error(`Unexpected character after closing quote on line ${line}.`);
      }
      continue;
    }

    if (char === '"') {
      if (field.length !== 0) {
        throw new Error(`Unexpected quote in an unquoted field on line ${line}.`);
      }
      inQuotes = true;
      quoteLine = line;
    } else if (char === ",") {
      finishField();
    } else if (char === "\n") {
      finishRecord();
      line++;
      recordLine = line;
    } else {
      append(char);
    }
  }

  if (inQuotes) {
    throw new Error(`Unclosed quoted field starting on line ${quoteLine}.`);
  }

  if (fields.length > 0 || field.length > 0 || afterQuote) {
    finishRecord();
  }

  return records;
}

function parseTable(text, expectedColumns) {
  const records = parseCsvRecords(text);

  if (records.length === 0) {
    throw new Error("CSV is empty or has no header.");
  }

  const headerRecord = records[0];
  const headers = headerRecord.fields.map((value) => value.trim());

  if (headers.length !== expectedColumns.length) {
    throw new Error(`Header on line ${headerRecord.line} must contain: ${expectedColumns.join(", ")}.`);
  }

  const positions = new Map();

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];

    if (!expectedColumns.includes(header)) {
      throw new Error(`Unexpected column "${header}" in header on line ${headerRecord.line}.`);
    }
    if (positions.has(header)) {
      throw new Error(`Duplicate column "${header}" in header on line ${headerRecord.line}.`);
    }

    positions.set(header, i);
  }

  for (const column of expectedColumns) {
    if (!positions.has(column)) {
      throw new Error(`Missing column "${column}" in header on line ${headerRecord.line}.`);
    }
  }

  return records.slice(1).map(({ fields, line }) => {
    if (fields.length !== headers.length) {
      throw new Error(
        `Expected ${headers.length} fields but found ${fields.length} on line ${line}.`
      );
    }

    // Inspect raw ID fields before trim() removes tabs, newlines, or other controls.
    for (const column of ["id", "recipientId", "itemId"]) {
      if (positions.has(column) && /[\u0000-\u001f\u007f-\u009f]/u.test(fields[positions.get(column)])) {
        throw new Error(`Invalid ${column} on line ${line}: control characters are not allowed.`);
      }
    }

    return {
      line,
      values: Object.fromEntries(
        expectedColumns.map((column) => [column, fields[positions.get(column)].trim()])
      ),
    };
  });
}

function parseInteger(value, column, line, { min }) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${column} on line ${line}: expected an integer.`);
  }

  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min) {
    throw new Error(`Invalid ${column} on line ${line}: expected an integer >= ${min}.`);
  }

  return number;
}

export function parseItemsCsv(text) {
  const rows = parseTable(text, ["id", "name", "stock"]);
  const itemsById = new Map();

  for (const { line, values } of rows) {
    const { id, name } = values;

    if (!id) throw new Error(`Missing id on line ${line}.`);
    if (!name) throw new Error(`Missing name on line ${line}.`);

    const stock = parseInteger(values.stock, "stock", line, { min: 0 });
    const item = { id, name, stock };
    const existing = itemsById.get(id);

    if (existing && (existing.name !== name || existing.stock !== stock)) {
      throw new Error(`Conflicting duplicate item id "${id}" on line ${line}.`);
    }

    if (!existing) itemsById.set(id, item);
  }

  const items = [...itemsById.values()];
  assertDistributionSize(items, []);
  return items;
}

export function parseRequestsCsv(text) {
  const rows = parseTable(text, ["recipientId", "itemId", "quantity"]);
  const recipientsById = new Map();

  for (const { line, values } of rows) {
    const { recipientId, itemId } = values;

    if (!recipientId) throw new Error(`Missing recipientId on line ${line}.`);
    if (!itemId) throw new Error(`Missing itemId on line ${line}.`);

    const quantity = parseInteger(values.quantity, "quantity", line, { min: 1 });
    let recipient = recipientsById.get(recipientId);

    if (!recipient) {
      recipient = { id: recipientId, requests: {} };
      recipientsById.set(recipientId, recipient);
    }

    const current = Object.hasOwn(recipient.requests, itemId)
      ? recipient.requests[itemId]
      : 0;
    const total = current + quantity;
    if (!Number.isSafeInteger(total)) {
      throw new Error(`Total quantity for recipient "${recipientId}" and item "${itemId}" exceeds the safe integer limit.`);
    }

    Object.defineProperty(recipient.requests, itemId, {
      value: total,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  const recipients = [...recipientsById.values()];
  assertDistributionSize([], recipients);
  return recipients;
}

export function reportToCsv(input, result) {
  if (!Array.isArray(input)) {
    throw new TypeError("Input must be an array of recipients.");
  }
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError("Result must be an object keyed by recipient id.");
  }

  function validateQuantity(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative safe integer.`);
    }
    return value;
  }

  function escapeField(value) {
    let field = String(value);

    // Prevent spreadsheet applications from interpreting exported IDs as formulas.
    if (/^[\t\r\n]|^[ \t\r\n]*[=+\-@]/.test(field)) {
      field = `'${field}`;
    }

    if (/[",\r\n]/.test(field) || /^\s|\s$/.test(field)) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }

  const rows = [["recipientId", "itemId", "requested", "allocated", "unmet"]];
  const seenRecipients = new Set();

  // Check every supplied allocation, including keys that would otherwise be
  // omitted from the report because no corresponding request exists.
  const recipientsById = new Map(input.map(recipient => [recipient?.id, recipient]));
  for (const [recipientId, allocations] of Object.entries(result)) {
    const recipient = recipientsById.get(recipientId);
    if (!recipient) throw new Error(`Allocation references unknown recipient "${recipientId}".`);
    if (allocations === null || typeof allocations !== "object" || Array.isArray(allocations)) {
      throw new Error(`Allocations for recipient "${recipientId}" must be an object.`);
    }
    for (const [itemId, rawAllocated] of Object.entries(allocations)) {
      const allocated = validateQuantity(rawAllocated, `Allocated quantity for "${recipientId}" / "${itemId}"`);
      const requested = recipient.requests && Object.hasOwn(recipient.requests, itemId)
        ? validateQuantity(recipient.requests[itemId], `Requested quantity for "${recipientId}" / "${itemId}"`)
        : 0;
      if (allocated > requested) {
        throw new Error(`Allocated quantity for "${recipientId}" / "${itemId}" exceeds requested quantity.`);
      }
    }
  }

  for (const recipient of input) {
    if (!recipient || typeof recipient.id !== "string" || !recipient.id) {
      throw new Error("Each recipient must have a non-empty string id.");
    }
    if (!recipient.requests || typeof recipient.requests !== "object" ||
        Array.isArray(recipient.requests)) {
      throw new Error(`Requests for recipient "${recipient.id}" must be an object.`);
    }
    if (seenRecipients.has(recipient.id)) {
      throw new Error(`Duplicate recipient "${recipient.id}" in input.`);
    }
    seenRecipients.add(recipient.id);

    const recipientAllocations = Object.prototype.hasOwnProperty.call(result, recipient.id)
      ? result[recipient.id]
      : undefined;

    if (recipientAllocations !== undefined &&
        (recipientAllocations === null ||
         typeof recipientAllocations !== "object" ||
         Array.isArray(recipientAllocations))) {
      throw new Error(`Allocations for recipient "${recipient.id}" must be an object.`);
    }

    for (const [itemId, rawRequested] of Object.entries(recipient.requests)) {
      const requested = validateQuantity(
        rawRequested,
        `Requested quantity for "${recipient.id}" / "${itemId}"`
      );

      const allocatedValue =
        recipientAllocations &&
        Object.prototype.hasOwnProperty.call(recipientAllocations, itemId)
          ? recipientAllocations[itemId]
          : 0;
      const allocated = validateQuantity(
        allocatedValue,
        `Allocated quantity for "${recipient.id}" / "${itemId}"`
      );
      if (allocated > requested) {
        throw new Error(`Allocated quantity for "${recipient.id}" / "${itemId}" exceeds requested quantity.`);
      }

      rows.push([
        recipient.id,
        itemId,
        requested,
        allocated,
        requested - allocated,
      ]);
    }
  }

  return rows
    .map((row) => row.map(escapeField).join(","))
    .join("\r\n");
}
