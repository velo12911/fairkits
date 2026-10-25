// Shared browser resource contract. CSV parsers bound each imported list;
// integration checks the complete input before allocation. A parser cannot check
// the union of a replacement list with the other list already held by the UI.
// Frontend owner: call assertDistributionSize(candidateItems, candidateRecipients)
// BEFORE committing manual edits/example data/import setters or rendering a matrix.
// Columns include unknown request IDs, since the UI displays those as well.
// onInputChange() does not carry state, so integration cannot inspect manual edits.
export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_CSV_ROWS = 10_000; // Logical data records, including blank records; excludes header.
export const MAX_CSV_FIELD_LENGTH = 1_024; // Decoded UTF-16 code units, before trimming.
export const MAX_ITEMS = 100;
export const MAX_RECIPIENTS = 250;
export const MAX_MATRIX_CELLS = 25_000;

export function assertDistributionSize(items, recipients) {
  if (!Array.isArray(items) || !Array.isArray(recipients)) {
    throw new Error("Distribution must contain items and recipients arrays.");
  }
  if (items.length > MAX_ITEMS) throw new Error(`At most ${MAX_ITEMS} supplies are supported.`);
  if (recipients.length > MAX_RECIPIENTS) {
    throw new Error(`At most ${MAX_RECIPIENTS} households are supported.`);
  }
  const columns = new Set(items.map(item => item.id));
  for (const recipient of recipients) {
    for (const id of Object.keys(recipient.requests ?? {})) {
      columns.add(id);
      if (columns.size > MAX_ITEMS) throw new Error(`At most ${MAX_ITEMS} supply columns are supported.`);
    }
  }
  if (columns.size * recipients.length > MAX_MATRIX_CELLS) {
    throw new Error(`At most ${MAX_MATRIX_CELLS} household request cells are supported.`);
  }
}
