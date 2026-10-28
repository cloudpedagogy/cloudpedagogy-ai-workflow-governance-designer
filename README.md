# AI Workflow Governance Designer

A local-first, governance-focused design environment for creating, analysing, and documenting AI-supported workflows with explicit human oversight, risk controls, and accountability boundaries.

---

## 🎯 Purpose & Intended Users

The **AI Workflow Governance Designer** helps teams design structured AI-assisted workflows before deployment by making human–AI boundaries, reliance levels, risk dimensions, intervention points, and approval controls explicit at the design stage.

**Intended Users:**
- **AI Governance & Risk Leads** defining human-in-the-loop oversight, escalation paths, and review cycles.
- **Educators, Curriculum Designers, & Academic Leaders** designing transparent AI-supported teaching, assessment, or administrative workflows.
- **Research & Policy Teams** documenting methodological accountability, ethical/privacy risks, and critical reflection for AI-assisted research or public-sector processes.
- **System & Operations Architects** specifying workflow structures for downstream governance review.

---

## 🔗 Role in the CloudPedagogy Ecosystem

- **Phase:** Phase 2 — Governance Pipeline
- **Role:** Specifies the governance structure of AI-supported workflows by defining decision points, AI reliance levels, oversight roles, and risk controls at the design stage.
- **Upstream Inputs:** Institutional policy, user-defined workflow requirements, or capability maturity assessment outcomes.
- **Downstream Outputs:** Provides the structured workflow specification used by the **AI Governance Risk Scanner** and mandated decision-point contexts for the **Human-AI Decision Record**.
- **Scope Boundary:**
  - Does **not** perform authoritative, independent risk audits or legal certification.
  - Does **not** record live production decision outcomes or connect to external AI models.

For a full ecosystem overview, see: [SYSTEM_OVERVIEW.md](../SYSTEM_OVERVIEW.md)

---

## 🧩 Main Governance Functionality

1. **Workflow Context & Ownership (`Context` Tab):**
   - Define workflow title, owner, organisation, primary purpose, domain (`education`, `research`, `policy`, `operations`), semantic version, and optional AI Capability & Governance notes.
2. **Ordered Step Builder (`Step Builder` Tab):**
   - Create, expand/collapse, edit, reorder (`Move Up` / `Move Down` with keyboard focus preservation), and delete ordered workflow steps.
   - Classify each step as `human-only`, `ai-supported`, `ai-generated`, or `decision-point`, and document step descriptions, inputs, and outputs.
3. **AI Involvement & Reliance:**
   - Specify the **AI Role / Function** (`ai_involvement.ai_role`) and **AI Reliance Level** (`low`, `medium`, `high`, `critical`) for every step.
4. **Human–AI Boundary & Oversight:**
   - Define the **Responsible Role**, **Oversight Level** (`none`, `minimal`, `active`, `full`), and explicit **Intervention Points** where human operators can pause, review, or override AI outputs.
5. **Four-Dimensional Risk Identification & Mitigation:**
   - Document **Bias / Fairness Risk**, **Operational Risk**, **Ethical Risk**, **Privacy / Data Risk**, and targeted **Mitigation Strategies** per step.
6. **Governance Controls & Decision-Point Reactivity (`Step Builder` & `Governance` Tabs):**
   - Configure **Approval Required**, **Escalation Path**, and **Review Cycle** per step.
   - Changing a step to or from `decision-point` immediately updates **Decision Record Required** controls and governance badges (`⚠️ Approval Unset` vs. `✓ Decision Record`) without losing focus or discarding existing control values.
7. **Real-Time Governance Metrics & Pattern Analysis (`Dashboard` Tab):**
   - Tracks the indicative **Governance Completeness Index (%)**, **AI Dependency Map (%)**, **High-Risk Oversight Gaps**, **Consecutive AI Reliance Clusters**, and **Design-Time Suggestions**.
8. **Critical Reflection Layer (`Reflection` Tab):**
   - Document systemic **Failure Modes**, **Essential Human Judgement**, **AI Over-Reliance Risks**, and **Embedded Assumptions**.

---

## 🗂️ Multiple-Workflow Management

The application includes a versioned local **Multi-Workflow Registry** toolbar directly above the workspace:
- **Switch Active Workflow:** Switch between saved workflows and working drafts via the accessible `Active Workflow` selector. Unsaved in-memory edits are preserved across workflow switches within the session and marked with `● (Unsaved)`.
- **Create (`+ Create Workflow`):** Creates a new workflow with a unique UUID in the registry and switches to it.
- **Duplicate (`Duplicate`):** Clones the active workflow (including all steps, risks, controls, reflection fields, and custom extension properties) under a new workflow UUID and step UUIDs.
- **Rename (`Rename`):** Updates the active workflow's title in memory and persists the updated registry.
- **Delete (`Delete`):** Prompts for confirmation, creates a verified protective backup of the target workflow first, and removes it from the registry (automatically creating a fresh workflow if the last workflow in the registry was deleted).

---

## 🔐 Local-First Storage, Privacy & Legacy Migration

- **100% Local-First:** All workflow data stays in your browser's `localStorage`.
- **Zero Telemetry & Zero Network Calls:** No analytics, external scripts, fonts, or backend API calls are made at runtime.
- **Storage Keys Used:**
  - `cp_workflow_designer` — Active workflow record (maintained in sync for single-workflow compatibility).
  - `cp_workflow_designer_registry` — Versioned multi-workflow registry (`cloudpedagogy_workflow_registry`, v`1.0.0`) storing `active_workflow_id`, `workflow_order`, and `workflows`.
  - `cp_workflow_designer_backup` — Single-slot in-browser protective backup created before destructive single-workflow operations (`New Workflow`, `Import JSON`, `Save Copy as My Workflow`, `Delete`, or `Import Registry Backup`).
- **Idempotent Legacy Migration:**
  - If a browser has an existing `cp_workflow_designer` record (completed workflow or incomplete draft) from an earlier single-workflow version and no `cp_workflow_designer_registry`, startup automatically migrates that workflow into the registry once without duplicating entries on subsequent reloads or disturbing `cp_workflow_designer_backup`.

---

## 📦 Export Formats, Import & Recovery Procedures

### 1. Formal Workflow JSON Specification (`Export JSON`)
- Validates required fields (`title`, `owner`, `purpose`, and step names) and exports a schema-compliant JSON file (`workflow-<title>.json`) conforming to [`WORKFLOW_SCHEMA.json`](./WORKFLOW_SCHEMA.json).
- Preserves unknown top-level, metadata, step, and nested extension fields losslessly across import/export round-trips.

### 2. Draft / Recovery JSON (`Export Draft / Recovery JSON`)
- Exports the active workflow at any stage (`workflow-draft-<title>.json` with `"_draft_recovery": true`), even when required metadata or step names are incomplete or when `localStorage` is full.

### 3. Full Registry Backup (`Export Registry Backup` / `Import Registry Backup`)
- Exports all workflows and drafts in the local registry into a single portable file (`workflow-registry-backup.json` with `"format": "cloudpedagogy_workflow_registry"`).
- Importing a registry backup validates every contained workflow before mutating state, warns that replacing the registry will overwrite existing local workflows, creates a single-workflow protective backup of the active workflow, and atomically updates `localStorage`.

### 4. Markdown Document (`Export Markdown`)
- Generates a structured Markdown specification (`workflow-<title>.md`) covering metadata, completeness/dependency metrics, all step fields (AI role/reliance, human oversight, all 4 risk categories, mitigations, approval/decision-record status, escalation path, review cycle), critical reflection, and the governance disclaimer.

### 5. Print / Save as PDF Governance Report (`Export PDF / Print`)
- Uses a dedicated print presentation (`#printable-governance-report`) and native `window.print()` (no external PDF library required).
- Clicking **Export PDF / Print** (or pressing `Cmd+P` / `Ctrl+P` from any view) hides the application navigation chrome and prints the complete, multi-section **AI Workflow Governance Specification Report** formatted with page-break protection for PDF archival.

### 6. Data-Safety & Recovery Guarantees
- **Demo Mode Safety:** Exploring **Demo Example** loads sample data in memory only (`Demo Mode (In-Memory Only)`). Exiting demo mode restores your exact prior workflow (including unsaved in-memory edits). Saving a demo copy requires confirmation and a verified protective backup first.
- **Corrupted Storage Protection:** If `localStorage` contains malformed or unrecoverable JSON on startup, auto-save is locked and a **Corrupted Local Storage Detected** banner allows you to **Download Raw Data** (`corrupted-workflow-raw.json`) before choosing whether to discard and start fresh.
- **Protective Backup Recovery (`Restore Backup`):** Whenever a valid backup exists in `cp_workflow_designer_backup`, a **Restore Backup** button appears in the top bar. If restoring to `localStorage` fails due to quota exhaustion, the app offers safe in-memory recovery so you can immediately export your restored workflow.

---

## 🛠️ Development, Testing & Production Build

### Prerequisites
- Node.js (v18+ recommended) and `npm`

### Install Dependencies
```bash
npm install
```

### Run Development Server
```bash
npm run dev
```

### Run Automated Test Suite (Vitest + JSDOM)
```bash
npm test
```

### Run TypeScript Typecheck
```bash
npx tsc --noEmit
```

### Build for Production
```bash
npm run build
```
The static production bundle is emitted to `dist/` with relative asset paths (`./`) suitable for deployment to any static hosting environment or subpath.

---

## ⚠️ Known Limitations

1. **Browser `localStorage` Quota & Clearing:** All local persistence relies on browser `localStorage` (typically ~5 MB per origin). Clearing browser site data or using private/incognito windows will remove locally stored workflows unless exported to disk via **Export JSON**, **Export Draft / Recovery JSON**, or **Export Registry Backup**.
2. **Single-Slot In-Browser Protective Backup:** The automatic in-browser backup key (`cp_workflow_designer_backup`) holds a single workflow snapshot (preferring the latest valid in-memory state when unsaved edits diverge from the last persisted version). Before replacing a multi-workflow registry or when preserving multiple historical snapshots, download a **Full Registry Backup** (`workflow-registry-backup.json`).
3. **Non-Transactional `localStorage` API:** Because the browser `localStorage` API is not natively transactional across multiple keys (`cp_workflow_designer` and `cp_workflow_designer_registry`), the application performs explicit verification and automatic rollback if a multi-key write fails mid-operation, and surfaces a warning if a rollback write itself encounters a storage error.

---

## ⚖️ Non-Certification Disclaimer & Licensing

### Governance & Non-Certification Disclaimer
This repository contains exploratory, framework-aligned design tools developed for structured reflection, capability development, and governance planning.

All metrics (including the **Governance Completeness Index** and **AI Dependency Map**) and exported reports are **indicative design-time aids only**. They do **not** constitute formal certification, independent risk audit sign-off, or legal/regulatory compliance. Outputs should always be interpreted in context using qualified professional judgement.

### License & Commercial Distinction
- This repository is open-source software released under the [MIT License](./LICENSE).
- It operates as a standalone, client-side open-source tool and is distinct from any private or commercial CloudPedagogy AI Management Studio offering. CloudPedagogy capability frameworks and related publications are licensed separately.
