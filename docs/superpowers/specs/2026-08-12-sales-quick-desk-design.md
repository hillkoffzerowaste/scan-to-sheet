# Sales Quick Desk Design

## 1. Objective

Build an enterprise-grade sales workspace inside the Scan to Sheet application shell. It presents and operates on the same customers, orders, preparation states, dispatch queue, outstation work, and Chiang Mai rounds as the Hillkoff Delivery System, but with a faster and less cluttered interface.

Sales Quick Desk is an independent domain module. It shares only the existing Google login and application shell with Scan to Sheet. It must not read from or write to Scan to Sheet scan records, Marketplace imports, Google Sheets, or Scan to Sheet Firestore collections for business data.

## 2. Access and identity

- Every user with a valid Google session in Scan to Sheet may open and operate Sales Quick Desk.
- The Hillkoff API key remains server-only in the Vercel environment variable `HILLKOFF_API_KEY`.
- Browser requests call allowlisted Scan to Sheet Vercel Functions. Those functions verify the Google session before calling Hillkoff `/api/v1`.
- Hillkoff sees the shared API-client identity. Scan to Sheet therefore records a separate audit event for mutations with the Google email, action, target identifier, outcome, request identifier, and timestamp.
- Audit records must not contain the API key, customer payload snapshots, raw upstream responses, or other unnecessary personal data.

## 3. Information architecture

The existing application navigation gains a distinct Sales section:

```text
Scan
Marketplace
Missing-work tools
Sales
  Overview
  Customers
  Orders
  Dispatch
  Outstation
  Chiang Mai rounds
Reports
```

On desktop, selecting Sales opens a full workspace beside the application navigation. On mobile, the application navigation becomes a slide drawer and Sales occupies the full viewport. Drawers inside Sales are reserved for order details, customer details, and short create/edit tasks; the entire workspace must not be compressed into one narrow drawer.

The active Sales view is addressable in the URL so refresh, back/forward navigation, and shared internal links restore the same module and filters. No customer or order data is cached in `localStorage`.

## 4. Module boundaries

```text
src/features/sales/
  SalesWorkspace.jsx
  SalesNavigation.jsx
  api/salesApi.js
  dashboard/
  customers/
  orders/
  dispatch/
  outstation/
  chiangmai/
  shared/

api/hillkoff/
  _client.js
  _audit.js
  customers.js
  customer-history.js
  orders.js
  workflow.js
  dispatch-dashboard.js
  outstation.js
  chiangmai-rounds.js
```

`src/features/sales` contains presentation state and user interaction only. It does not import Scan, Marketplace, Sheet, or scan-Firestore services. `api/hillkoff` contains narrowly scoped server gateways and shared authorization, timeout, response normalization, and audit behavior. It is not a general-purpose proxy.

The existing `api/hillkoff-me.js` health endpoint is migrated into or delegates to the shared Hillkoff client when the gateway foundation is introduced.

## 5. Sales overview

The overview answers operational questions rather than presenting decorative analytics. It contains compact counts and actionable lists for:

- today's orders;
- waiting for preparation;
- ready for dispatch;
- blocked or rework-required orders;
- outstation orders;
- Chiang Mai round assignments.

The primary search accepts order ID, booking number, customer name, phone, address, and other terms already supported by Hillkoff order search. Results show customer, booking number, package count/unit, COD, delivery area, service window, preparation states, and the next valid action.

All orders in Hillkoff are visible according to the selected view, regardless of whether they were created in the original Hillkoff UI or Sales Quick Desk.

## 6. Customer workspace

Users can:

- search by name, phone, customer ID, and address;
- view delivery information and order history;
- create a customer without leaving the order composer;
- edit an existing customer through a focused drawer.

Search results must prevent accidental duplicate creation by keeping the current query visible and showing close matches before the create action. Customer creation and editing use Hillkoff customer endpoints so normalization and server-side rules remain centralized.

## 7. Order composer

Order creation is independent of Scan to Sheet and Marketplace. Users enter or select Hillkoff customer and delivery information directly.

The desktop composer uses a two-column form with a continuously visible review summary; mobile uses one column. It is not a multi-page wizard. Fields are progressively disclosed by delivery type.

Core fields:

- customer;
- delivery method/type;
- service date and time window;
- package count and unit;
- COD;
- booking number(s);
- sales note;
- address and delivery area inherited from or explicitly confirmed against the customer record.

Conditional fields cover company driver, Grab/pickup, customer pickup, outstation carrier/tracking, and Chiang Mai round data. The final action shows a concise review and prevents duplicate submission. Booking conflicts, missing customers, invalid payloads, and idempotent replays are displayed distinctly using Hillkoff's response contract.

Creation always calls Hillkoff `/api/v1/orders`; Scan to Sheet must not reproduce booking registry, transaction, LINE, Sheet sync, or preparation-state rules.

## 8. Dispatch workspace

The dispatch view shows today's queue-oriented work and preparation readiness. An order offers Queue only when the data returned by Hillkoff proves that store and pack requirements are satisfied, no rework is pending, and its delivery method supports the action.

When Queue is unavailable, the interface shows the specific blocking reason instead of an unexplained disabled control. The server still calls Hillkoff workflow validation for every mutation; client-side readiness is guidance, not authority.

Mutation controls prevent repeat clicks, keep the order visible while pending, reconcile from the server after completion, and preserve a recoverable error state when rejected.

## 9. Outstation workspace

Outstation orders are separated from city dispatch. The workspace supports search and operational filtering by preparation state, carrier, tracking information, package count, service date, and incomplete required data.

Phase 1 uses the existing `/api/v1/orders` search/create capabilities and exposes only actions supported by the published v1 workflow contract. Features from the original UI that lack a v1 endpoint remain read-only or absent until a dedicated upstream endpoint is designed and tested.

## 10. Chiang Mai rounds workspace

Orders are grouped by round with counts and expandable lists. Unassigned orders form an explicit group. Users may assign or change a round through `/api/v1/orders/chiangmai-rounds`.

Round mutations show the current and proposed round, require confirmation when moving an already assigned order, prevent repeat submission, and reload affected groups after success. The UI does not calculate next-round business rules independently of Hillkoff.

## 11. Gateway contract

Every `api/hillkoff` handler:

1. accepts only documented HTTP methods;
2. requires a valid Scan to Sheet Google session;
3. validates and allowlists query parameters and payload fields;
4. reads `HILLKOFF_API_KEY` only on the server;
5. applies a bounded upstream timeout;
6. sends a request identifier and returns it on errors;
7. converts malformed or unavailable upstream responses to stable error codes and Thai user-facing messages;
8. never logs or returns secrets or raw upstream internals;
9. records mutation audit outcome without unnecessary personal data.

The browser never chooses an arbitrary upstream path, method, or host. Each business operation has a named gateway handler.

## 12. UI states and interaction standards

Every module defines loading, empty, loaded, stale/retrying, permission/session, validation, and upstream-error states. Long lists use bounded requests and pagination or explicit load-more behavior. Search is debounced and cancels obsolete requests.

The design follows the existing Scan to Sheet token system and mandatory accessibility rules:

- visible focus for every interactive control;
- skip navigation and semantic landmarks;
- keyboard-operable navigation, drawers, and dialogs;
- no status conveyed by color alone;
- minimum practical touch targets on mobile;
- zero document-level horizontal overflow at 375, 1000, and 1400 pixels;
- contrast measured from rendered light and dark themes.

## 13. Error and concurrency behavior

- `401` from the Scan to Sheet gateway means the Google session must be renewed.
- `401` from Hillkoff is mapped to an integration-credential error visible to operators without exposing details.
- `403` identifies insufficient API scope, origin/IP policy, or an unsupported role/action.
- `409` remains a conflict and triggers a targeted refresh of the affected customer, booking number, order, or workflow state.
- `429` shows a retryable rate-limit state with backoff; the UI does not automatically repeat mutations.
- `5xx`, timeout, or malformed responses preserve user input and provide a manual retry.

No optimistic mutation is used for order creation, queueing, deletion, or round assignment. Success is shown only after the authoritative Hillkoff response and reconciliation read.

## 14. Delivery phases

### Phase 1 — Foundation, customers, and order creation

- Sales navigation and URL-addressable workspace shell;
- shared Hillkoff gateway, session enforcement, response normalization, request IDs, and audit foundation;
- customer search/create/edit/history;
- order search and focused order detail;
- order composer and authoritative create result.

### Phase 2 — Today and dispatch

- operational overview and today's order list;
- preparation/readiness presentation;
- dispatch dashboard integration;
- queue mutation and reconciliation.

### Phase 3 — Outstation and Chiang Mai

- outstation filters and supported actions;
- grouped Chiang Mai rounds;
- assign/change round and reconciliation.

### Phase 4 — Hardening

- browser end-to-end flows;
- responsive and accessibility verification;
- rate-limit, timeout, conflict, repeated-click, and stale-state tests;
- production observability and audit review;
- reduce the API client's scopes to the operations actually used after final endpoint inventory.

Each phase must be independently deployable and must not require unfinished later phases for the existing Scan to Sheet workflows to continue operating.

## 15. Acceptance criteria

- Existing Scan, Marketplace, missing-work, and report behavior remains unchanged.
- A Google-authenticated user can enter Sales Quick Desk without receiving the Hillkoff API key.
- Customer and order data comes exclusively from Hillkoff `/api/v1`.
- Users can search/manage customers, create/search orders, view today's work, queue eligible orders, work with outstation views, and assign Chiang Mai rounds through separate modules.
- Original Hillkoff validation, booking transactions, workflow state machine, notifications, and sync behavior remain authoritative.
- Mutations are attributable to the signed-in Google email in the Scan to Sheet audit layer.
- Tests cover gateway authorization/redaction, request mapping, module state transitions, validation, conflicts, repeat-click protection, and error recovery.
- `npm run test:marketplace` and `npm run build` pass for every phase; UI phases additionally pass browser checks at 375, 1000, and 1400 pixels in light and dark themes.

## 16. Explicit non-goals

- Copying the original Hillkoff sales page or its large client component.
- Sharing business state with Scan or Marketplace modules.
- A generic authenticated proxy to arbitrary Hillkoff routes.
- Reimplementing Hillkoff transactions or workflow rules in Scan to Sheet.
- Route tasks, manual LINE sending, or specialized reports without dedicated v1 contracts.
- Offline order mutation or local persistence of customer/order records.
