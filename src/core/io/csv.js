function parseCsvRecords(text) {
  if (typeof text !== "string") {
    throw new TypeError("CSV input must be a string.");
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

  function finishField() {
    fields.push(field);
    field = "";
    afterQuote = false;
  }

  function finishRecord() {
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
          field += '"';
          i++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += char;
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
      field += char;
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

function parseItemsCsv(text) {
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

  return [...itemsById.values()];
}

function parseRequestsCsv(text) {
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

    const total = (recipient.requests[itemId] ?? 0) + quantity;
    if (!Number.isSafeInteger(total)) {
      throw new Error(`Total quantity for recipient "${recipientId}" and item "${itemId}" exceeds the safe integer limit.`);
    }

    recipient.requests[itemId] = total;
  }

  return [...recipientsById.values()];
}

