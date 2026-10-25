# FairKits

## Purpose
Help community organizations fairly distribute limited
donated supplies among requesting households.

## MVP Features
1. Enter available supplies and quantities.
2. Enter household requests.
3. Calculate a proposed allocation.
4. Display allocations, unmet requests, and remaining stock.
5. Export results to CSV.

## Allocation Policy
- Use deterministic round-robin distribution.
- Never exceed available stock or requested quantities.
- Rotate starting positions to reduce ordering bias.
- No urgency scoring in V1.
- All allocations require human review.

## Stack
- Vite
- Vanilla JavaScript
- CSS
- Browser-only; no backend or database

## Constraints
- Must be usable by nontechnical volunteers.
- Do not collect identifying household information.
- Keep the implementation simple and testable.
- Do not introduce unnecessary dependencies.

## Out of Scope
Authentication, AI-based allocation, persistent accounts,
payments, and multi-organization management.