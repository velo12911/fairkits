import { allocate } from "./core/allocate.js";
import { mountApp } from "./ui/app.js";
import {
  parseItemsCsv,
  parseRequestsCsv,
  reportToCsv,
} from "./io/csv.js";
import { downloadCsv } from "./io/export.js";
import { MAX_CSV_BYTES, assertDistributionSize } from "./io/limits.js";

const root = document.querySelector("#app");
if (!root) {
  throw new Error('App root element "#app" was not found.');
}

let controller;
let latestCalculation = null;
let revision = 0;

function clearCalculation() {
  revision++;
  latestCalculation = null;
  controller?.clearResults();
}

function showError(error) {
  controller?.showError(error instanceof Error ? error.message : String(error));
}

async function importFile(file, parse, update) {
  clearCalculation();
  const operationRevision = revision;

  try {
    if (!file || typeof file.text !== "function") {
      throw new TypeError("Select a valid file to import.");
    }
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_CSV_BYTES) {
      throw new Error(`Select a CSV file no larger than ${MAX_CSV_BYTES} bytes.`);
    }

    const text = await file.text();
    if (operationRevision !== revision) return;
    const parsed = parse(text);
    if (operationRevision !== revision) return;
    update(parsed);
  } catch (error) {
    if (operationRevision === revision) showError(error);
  }
}

controller = mountApp(root, {
  async onAllocate(input) {
    clearCalculation();
    const operationRevision = revision;

    try {
      assertDistributionSize(input?.items, input?.recipients);
      // Keep an immutable snapshot and give the engine its own copy.
      const serializedInput = JSON.stringify(input);
      if (serializedInput === undefined) {
        throw new TypeError("Allocation input must be JSON-serializable.");
      }

      const inputSnapshot = JSON.parse(serializedInput);
      assertDistributionSize(inputSnapshot.items, inputSnapshot.recipients);
      const result = await allocate(JSON.parse(serializedInput));
      if (operationRevision !== revision) return;

      if (!result || !Array.isArray(result.allocations)) {
        throw new Error("Allocation engine returned an invalid result.");
      }

      latestCalculation = { input: inputSnapshot, result };
      controller.showResults(result);
    } catch (error) {
      if (operationRevision === revision) showError(error);
    }
  },

  onImportItems(file) {
    return importFile(file, parseItemsCsv, (items) => controller.setItems(items));
  },

  onImportRequests(file) {
    return importFile(file, parseRequestsCsv, (recipients) =>
      controller.setRecipients(recipients)
    );
  },

  onExport() {
    try {
      if (!latestCalculation) {
        throw new Error("Calculate an allocation before exporting the report.");
      }

      const allocationMap = Object.create(null);
      for (const { recipientId, itemId, quantity } of latestCalculation.result.allocations) {
        if (
          typeof recipientId !== "string" ||
          typeof itemId !== "string" ||
          !Number.isSafeInteger(quantity) ||
          quantity < 0
        ) {
          throw new Error("Allocation engine returned an invalid allocation row.");
        }

        const recipientAllocations =
          allocationMap[recipientId] ?? (allocationMap[recipientId] = Object.create(null));
        recipientAllocations[itemId] = (recipientAllocations[itemId] ?? 0) + quantity;

        if (!Number.isSafeInteger(recipientAllocations[itemId])) {
          throw new Error("Allocated quantity exceeds the safe integer limit.");
        }
      }

      const csv = reportToCsv(latestCalculation.input.recipients, allocationMap);
      downloadCsv("allocation-report.csv", csv);
    } catch (error) {
      showError(error);
    }
  },

  onInputChange() {
    clearCalculation();
  },
});
