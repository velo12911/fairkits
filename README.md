# FairKits

FairKits helps community organizations distribute donated supplies among households using a transparent, deterministic allocation policy. Built with vanilla JavaScript, CSS, and Vite, it runs in the browser without a backend or database.

## Getting started

Use Node.js 20.19+ within the 20.x series, or Node.js 22.12+ (the installed Vite package's supported range), with npm. From this directory, run:

```sh
npm ci
npm run dev
```

Open the local URL printed in the terminal.

## Using FairKits

1. Add supplies with names and available quantities, or import a supplies CSV.
2. Add anonymous household IDs and their requested quantities, or import a requests CSV.
3. Select **Calculate Allocation**.
4. Review allocated quantities, unmet requests, and remaining inventory.
5. Select **Export results CSV** to download the report.

Use **Load Example Data** for a demonstration, then calculate to generate real results. Changing inputs clears the previous allocation and disables export until you calculate again.

**A person must review every allocation before distribution.** Use anonymous IDs, not household names or contact details. Inputs are held in memory and lost on refresh; exported CSV files remain wherever you save them.

## Allocation policy

Each supply is allocated independently using round-robin distribution. The starting household rotates between supplies to reduce ordering bias. Allocation never exceeds available stock or household requests.

The engine batches complete rounds rather than iterating over every unit, supporting large safe-integer quantities. Missing requests mean zero. Results are deterministic for the same input and ordering. There is no AI allocation or urgency scoring.

## CSV formats

Import supplies first. Request item IDs must match supply IDs. Each import replaces its corresponding list.

**Supplies** — stock must be a nonnegative integer:

```csv
id,name,stock
rice,Rice bags,8
water,Water bottles,10
```

**Requests** — quantity must be a positive integer; repeated household/item rows are combined:

```csv
recipientId,itemId,quantity
H001,rice,4
H001,water,3
H002,rice,4
```

Exports contain `recipientId,itemId,requested,allocated,unmet`. Spreadsheet formula prefixes in exported identifiers are neutralized. IDs containing control characters are rejected during import.

## Resource limits

The shared contract is defined in [src/io/limits.js](./src/io/limits.js).

| Resource | Limit |
| --- | --- |
| CSV file size | 2 MiB |
| CSV data records | 10,000, including blank records; excluding the header |
| Decoded CSV field length | 1,024 UTF-16 code units before trimming |
| Supply columns | 100, including unknown request IDs |
| Households | 250 |
| Household request cells | 25,000 |

Quantities cannot exceed JavaScript's maximum safe integer, `9,007,199,254,740,991`. Pending imports and calculations are discarded if newer operations or input changes invalidate them.

## Tests and production build

```sh
npm test
npm run build
npm run preview
```

Tests use Node's built-in test runner and cover allocation fairness, conservation, validation, CSV handling, resource limits, and asynchronous integration races. The production build writes to `dist/`; preview serves that build locally.

## Source overview

- [src/core/allocate.js](./src/core/allocate.js): allocation engine.
- [src/main.js](./src/main.js): integration handlers and operation invalidation.
- [src/io/](./src/io/): CSV parsing, export, and shared limits.
- [src/ui/app.js](./src/ui/app.js): browser interface and input state.
- [src/styles.css](./src/styles.css): responsive styling.
- [src/tests/](./src/tests/): regression tests.

Read [PROJECT.md](./PROJECT.md) for scope and [AGENTS.md](./AGENTS.md) before contributing. Respect file ownership and preserve the existing integration interfaces.
