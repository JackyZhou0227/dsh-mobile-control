# Claimed Device Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the claimed-device sidebar so session controls are at the top and the available device details fill the panel, with less important details hidden at narrow widths.

**Architecture:** Keep the implementation in the existing self-contained `plugin/client.js`. Render session controls before connection status and a grouped device-details section after it. Use existing CSS container queries for narrow/wide information priorities; do not change host operations or the unclaimed workflow.

**Tech Stack:** Browser-injected React via `createElement`, inline CSS in `plugin/client.js`, Node.js assertion-based tests.

---

## File Map

- Modify `plugin/client.js`: add locale labels and conditional device rows, reorder claimed-state blocks, add responsive detail priorities.
- Modify `plugin/test/client.mjs`: verify the idle path remains intact and inspect source/CSS for claimed-state ordering and breakpoint rules. The current test shallow-renders only the initial loading state, so do not assume it can render the populated state.
- Read only `plugin/host/adapters/android.js`, `plugin/host/adapters/harmony.js`, `plugin/host/adapters/ios.js`, and `plugin/host/registry.js` to confirm available detail keys. No host changes are expected.

### Task 1: Add complete available device details

**Files:**
- Modify: `plugin/client.js`
- Test: `plugin/test/client.mjs`

- [ ] **Step 1: Add source-level checks for detail keys and optional row handling**

Add assertions in `plugin/test/client.mjs` that the client reads `brand`, `osVersion`, `sdk`, `width`, `height`, `density`, `connection`, and `id`, and that the detail-row helper omits undefined, null, and empty values.

- [ ] **Step 2: Run the test and confirm the new detail checks fail**

Run: `node plugin/test/client.mjs`
Expected: FAIL because brand, SDK, and density are not currently rendered.

- [ ] **Step 3: Add localized labels and optional-row formatting**

In both `zh` and `en` dictionaries in `plugin/client.js`, add labels for brand, SDK/API level, and density. Add a helper beside `kv` that returns `null` when the value is undefined, null, or empty. Format density as `<value> dpi`; do not render placeholder rows for unavailable adapter fields.

- [ ] **Step 4: Render the available fields in a device-details group**

Use existing device data only. Render platform, model, brand, OS/version, SDK, resolution, density, connection type, and device ID. Keep the field labels concise and the displayed ID selectable or ellipsized using existing key/value conventions.

- [ ] **Step 5: Run the client test**

Run: `node plugin/test/client.mjs`
Expected: PASS; all referenced locale keys exist in both dictionaries and the new field/CSS source assertions pass.

### Task 2: Put session controls first and define narrow priorities

**Files:**
- Modify: `plugin/client.js`
- Test: `plugin/test/client.mjs`

- [ ] **Step 1: Add source checks for block ordering and responsive rules**

Assert that the claimed `.dmc-sessionControl` block is declared before `.dmc-status`, and that `.dmc-deviceDetails` follows status. Assert that the existing container-query breakpoint hides only the low-priority detail rows at narrow widths and restores them at `min-width:620px`.

- [ ] **Step 2: Run the client test and confirm new ordering checks fail**

Run: `node plugin/test/client.mjs`
Expected: FAIL because the control block does not exist and details currently precede status.

- [ ] **Step 3: Render the top session control block**

Wrap the existing agent hint and release button in `.dmc-sessionControl`, render it as the first claimed-state child of `.dmc-foot`, and preserve the same `release` handler and translated labels. Leave the status row's refresh handler unchanged.

- [ ] **Step 4: Reorder details and remove bottom anchoring**

Render `.dmc-status` immediately after `.dmc-sessionControl`, followed by `.dmc-deviceDetails`. Remove `.dmc-root:not(.idle) .dmc-release{margin-top:auto}` and any obsolete claimed-state release separator that only supports bottom placement. Do not alter idle foot children (`dmc-info`, batch title, batch form).

- [ ] **Step 5: Apply narrow and wide visibility rules**

At narrow widths, keep session control, connection status, platform/model, OS/version, and resolution visible. Hide brand, SDK, density, connection type, and full device ID through explicit detail-row classes. At `@container (min-width:620px)`, show all populated detail rows. Continue using host theme tokens, compact key/value typography, and no nested cards.

- [ ] **Step 6: Run the client test**

Run: `node plugin/test/client.mjs`
Expected: PASS, including existing idle layout assertions and new claimed-panel structure/style assertions.

### Task 3: Run regression checks

**Files:**
- Verify: `plugin/client.js`, `plugin/test/client.mjs`

- [ ] **Step 1: Run the offline-relevant suites**

Run: `node plugin/test/client.mjs; node plugin/test/routes.mjs; node plugin/test/provision.mjs`
Expected: all suites report success.

- [ ] **Step 2: Check formatting and changed files**

Run: `git diff --check; git status --short; git diff --stat`
Expected: no whitespace errors; functional changes are limited to the client UI and its test, with the approved spec and plan documents.

- [ ] **Step 3: Review expected responsive behavior**

Confirm source-level assertions cover the narrow/wide container rules. If visual browser verification is available in the implementation environment, inspect the claimed sidebar at widths below and above 620px and verify the unclaimed layout is unchanged.
