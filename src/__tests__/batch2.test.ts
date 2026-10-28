import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../main';
import {
  StorageManager,
  STORAGE_KEY,
  REGISTRY_KEY,
  BACKUP_KEY
} from '../utils/storage';
import {
  validateWorkflowImport,
  validateRegistryImport,
  mapStoreToSchema
} from '../utils/schema';
import { generateMarkdown, exportRegistryToJSON } from '../utils/export';
import { DEMO_STATE, detectConsecutiveAISteps, type WorkflowStore } from '../data/model';

function createTestDOM() {
  document.body.innerHTML = `
    <div id="app">
      <nav class="sidebar">
        <div class="nav-links">
          <button class="nav-item active" data-view="dashboard">Dashboard</button>
          <button class="nav-item" data-view="workflow-context">Context</button>
          <button class="nav-item" data-view="workflow-builder">Step Builder</button>
          <button class="nav-item" data-view="governance-panel">Governance</button>
          <button class="nav-item" data-view="reflection-layer">Reflection</button>
          <button class="nav-item" data-view="export-panel">Export</button>
        </div>
        <div class="completeness-mini">
          <div class="progress" style="width: 0%"></div>
          <div class="value">0%</div>
        </div>
      </nav>
      <main class="content">
        <header class="top-bar">
          <h1 id="view-title">Dashboard</h1>
          <div id="save-status-container">
            <span id="save-status">Saved</span>
          </div>
          <div class="top-actions">
            <button id="load-demo">Demo</button>
            <button id="new-workflow">New</button>
            <button id="save-workflow">Save</button>
            <button id="import-workflow">Import</button>
          </div>
        </header>
        <div id="view-container"></div>
      </main>
    </div>
  `;
}

function createMemoryStorage(backingMap: Map<string, string> = new Map()): Storage {
  return {
    getItem: (k: string) => backingMap.get(k) ?? null,
    setItem: (k: string, v: string) => {
      backingMap.set(k, String(v));
    },
    removeItem: (k: string) => {
      backingMap.delete(k);
    },
    clear: () => {
      backingMap.clear();
    },
    key: (i: number) => Array.from(backingMap.keys())[i] ?? null,
    get length() {
      return backingMap.size;
    }
  };
}

describe('Batch 2 — Governance Functionality & Multi-Workflow Registry', () => {
  let backingMap: Map<string, string>;
  let customStorage: Storage;

  beforeEach(() => {
    backingMap = new Map();
    customStorage = createMemoryStorage(backingMap);
    createTestDOM();
    window.confirm = () => true;
    window.alert = () => {};
  });

  it('1. exposes ai_role, reliance_level, ethical_risk, and privacy_risk in Step Builder and persists, reloads, imports, and exports them', () => {
    const manager = new StorageManager(customStorage);
    const app = new App(manager);

    // Navigate to Step Builder and add a step
    (document.querySelector('[data-view="workflow-builder"]') as HTMLElement).click();
    document.getElementById('add-step')?.click();

    const stepItem = document.querySelector('.step-item') as HTMLElement;
    expect(stepItem).not.toBeNull();

    const aiRoleInput = stepItem.querySelector(
      'input.step-input-nested[data-parent="ai_involvement"][data-field="ai_role"]'
    ) as HTMLInputElement;
    const relianceSelect = stepItem.querySelector(
      'select.step-input-nested[data-parent="ai_involvement"][data-field="reliance_level"]'
    ) as HTMLSelectElement;
    const ethicalRiskInput = stepItem.querySelector(
      'input.step-input-nested[data-parent="risks"][data-field="ethical_risk"]'
    ) as HTMLInputElement;
    const privacyRiskInput = stepItem.querySelector(
      'input.step-input-nested[data-parent="risks"][data-field="privacy_risk"]'
    ) as HTMLInputElement;

    expect(aiRoleInput).not.toBeNull();
    expect(relianceSelect).not.toBeNull();
    expect(ethicalRiskInput).not.toBeNull();
    expect(privacyRiskInput).not.toBeNull();

    // Edit all 4 fields via DOM events
    const nameInput = stepItem.querySelector('input.step-input[data-field="name"]') as HTMLInputElement;
    nameInput.value = 'Clinical Triage Synthesis';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    aiRoleInput.value = 'Synthesizes patient intake notes and flags urgency';
    aiRoleInput.dispatchEvent(new Event('input', { bubbles: true }));

    relianceSelect.value = 'critical';
    relianceSelect.dispatchEvent(new Event('change', { bubbles: true }));

    ethicalRiskInput.value = 'Demographic disparity in urgency scoring';
    ethicalRiskInput.dispatchEvent(new Event('input', { bubbles: true }));

    privacyRiskInput.value = 'Exposure of identifiable patient health records';
    privacyRiskInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Fill required metadata for completed export
    app.getStore().metadata.title = 'Triage Governance Workflow';
    app.getStore().metadata.owner = 'Chief Medical Informatics Officer';
    app.getStore().metadata.purpose = 'Govern clinical intake triage';
    (app as any).saveToStorage();

    // Verify in-memory store
    const step = app.getStore().steps[0];
    expect(step.ai_involvement.ai_role).toBe('Synthesizes patient intake notes and flags urgency');
    expect(step.ai_involvement.reliance_level).toBe('critical');
    expect(step.risks.ethical_risk).toBe('Demographic disparity in urgency scoring');
    expect(step.risks.privacy_risk).toBe('Exposure of identifiable patient health records');

    // Verify reload from storage on fresh App instance
    createTestDOM();
    const reloadedApp = new App(new StorageManager(customStorage));
    const reloadedStep = reloadedApp.getStore().steps[0];
    expect(reloadedStep.ai_involvement.ai_role).toBe('Synthesizes patient intake notes and flags urgency');
    expect(reloadedStep.ai_involvement.reliance_level).toBe('critical');
    expect(reloadedStep.risks.ethical_risk).toBe('Demographic disparity in urgency scoring');
    expect(reloadedStep.risks.privacy_risk).toBe('Exposure of identifiable patient health records');

    // Verify JSON export -> import round-trip
    const exportedJson = JSON.stringify(mapStoreToSchema(reloadedApp.getStore()));
    const importValidation = validateWorkflowImport(exportedJson);
    expect(importValidation.valid).toBe(true);
    expect(importValidation.store?.steps[0].ai_involvement.ai_role).toBe(
      'Synthesizes patient intake notes and flags urgency'
    );
    expect(importValidation.store?.steps[0].ai_involvement.reliance_level).toBe('critical');
    expect(importValidation.store?.steps[0].risks.ethical_risk).toBe(
      'Demographic disparity in urgency scoring'
    );
    expect(importValidation.store?.steps[0].risks.privacy_risk).toBe(
      'Exposure of identifiable patient health records'
    );
  });

  it('2. updates decision-point controls and governance badges immediately without losing focus or discarding existing field values', () => {
    const manager = new StorageManager(customStorage);
    const app = new App(manager);

    (document.querySelector('[data-view="workflow-builder"]') as HTMLElement).click();
    document.getElementById('add-step')?.click();

    const stepItem = document.querySelector('.step-item') as HTMLElement;
    const nameInput = stepItem.querySelector('input.step-input[data-field="name"]') as HTMLInputElement;
    const typeSelect = stepItem.querySelector('select.step-input[data-field="type"]') as HTMLSelectElement;

    // 1. Typing in Step Name keeps focus on nameInput and updates header title in place
    nameInput.focus();
    expect(document.activeElement).toBe(nameInput);
    nameInput.value = 'Final Clinical Sign-Off';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.activeElement).toBe(nameInput);
    expect(stepItem.querySelector('.step-title-text')?.textContent).toBe('Final Clinical Sign-Off');

    // Pre-populate escalation_path and review_cycle to ensure they survive step-type toggles
    app.getStore().steps[0].controls.escalation_path = 'Clinical Ethics Committee';
    app.getStore().steps[0].controls.review_cycle = 'Monthly';

    // Initially human-only: no decision-point controls, no high-risk badge
    expect(stepItem.querySelector('.governance-controls')).toBeNull();
    expect(stepItem.querySelector('.badge-high-risk')).toBeNull();

    // 2. Switch step type to decision-point
    typeSelect.focus();
    typeSelect.value = 'decision-point';
    typeSelect.dispatchEvent(new Event('change', { bubbles: true }));

    // Focus remains on typeSelect (no full-view rerender!)
    expect(document.activeElement).toBe(typeSelect);

    // Decision-record controls appear immediately and unapproved decision-point shows Approval Unset warning badge
    const govControls = stepItem.querySelector('.governance-controls');
    expect(govControls).not.toBeNull();
    expect(stepItem.querySelector('.badge-decision-warning')?.textContent).toContain('Approval Unset');

    const approvalCheckbox = govControls!.querySelector(
      'input.step-checkbox-nested[data-field="approval_required"]'
    ) as HTMLInputElement;
    expect(approvalCheckbox).not.toBeNull();
    expect(approvalCheckbox.checked).toBe(false);

    // 3. Check Decision Record Required -> warning badge replaced by Decision Record badge immediately
    approvalCheckbox.checked = true;
    approvalCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(app.getStore().steps[0].controls.approval_required).toBe(true);
    expect(stepItem.querySelector('.badge-decision-warning')).toBeNull();
    expect(stepItem.querySelector('.badge-decision-approved')?.textContent).toContain('Decision Record');

    // 4. Switch step type from decision-point to ai-generated (with 'none' oversight)
    typeSelect.value = 'ai-generated';
    typeSelect.dispatchEvent(new Event('change', { bubbles: true }));

    // Decision-point controls and badges are removed from DOM, Missing Oversight + High Risk badges appear
    expect(stepItem.querySelector('.governance-controls')).toBeNull();
    expect(stepItem.querySelector('.badge-decision-approved')).toBeNull();
    expect(stepItem.querySelector('.badge-missing-oversight')).not.toBeNull();
    expect(stepItem.querySelector('.badge-high-risk')).not.toBeNull();

    // Crucially: existing control values (approval_required, escalation_path, review_cycle) are preserved!
    expect(app.getStore().steps[0].controls.approval_required).toBe(true);
    expect(app.getStore().steps[0].controls.escalation_path).toBe('Clinical Ethics Committee');
    expect(app.getStore().steps[0].controls.review_cycle).toBe('Monthly');

    // 5. Switch back to decision-point -> checkbox renders checked and Decision Record badge is shown
    typeSelect.value = 'decision-point';
    typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    const restoredCheckbox = stepItem.querySelector(
      'input.step-checkbox-nested[data-field="approval_required"]'
    ) as HTMLInputElement;
    expect(restoredCheckbox).not.toBeNull();
    expect(restoredCheckbox.checked).toBe(true);
    expect(stepItem.querySelector('.badge-decision-warning')).toBeNull();
    expect(stepItem.querySelector('.badge-decision-approved')?.textContent).toContain('Decision Record');
  });

  it('3. supports accessible step reordering, boundary disabled controls, expanded new steps with focus, and empty arrays for cleared inputs/outputs', () => {
    const manager = new StorageManager(customStorage);
    const app = new App(manager);

    (document.querySelector('[data-view="workflow-builder"]') as HTMLElement).click();

    // Add Step 1 -> opens expanded and focuses Step Name input
    document.getElementById('add-step')?.click();
    let stepItems = document.querySelectorAll('.step-item');
    expect(stepItems.length).toBe(1);
    expect(stepItems[0].querySelector('.step-content')?.classList.contains('expanded')).toBe(true);
    const firstStepNameInput = stepItems[0].querySelector(
      'input.step-input[data-field="name"]'
    ) as HTMLInputElement;
    expect(document.activeElement).toBe(firstStepNameInput);

    firstStepNameInput.value = 'Step Alpha';
    firstStepNameInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Test inputs/outputs clearing produces [] rather than [""]
    const inputsField = stepItems[0].querySelector(
      'input.step-input[data-field="inputs"]'
    ) as HTMLInputElement;
    const outputsField = stepItems[0].querySelector(
      'input.step-input[data-field="outputs"]'
    ) as HTMLInputElement;

    inputsField.value = 'Dataset A, Dataset B';
    inputsField.dispatchEvent(new Event('input', { bubbles: true }));
    expect(app.getStore().steps[0].inputs).toEqual(['Dataset A', 'Dataset B']);

    inputsField.value = '   ,  ';
    inputsField.dispatchEvent(new Event('input', { bubbles: true }));
    expect(app.getStore().steps[0].inputs).toEqual([]);

    outputsField.value = '';
    outputsField.dispatchEvent(new Event('input', { bubbles: true }));
    expect(app.getStore().steps[0].outputs).toEqual([]);

    // Add Step 2 and Step 3
    document.getElementById('add-step')?.click();
    stepItems = document.querySelectorAll('.step-item');
    const secondNameInput = stepItems[1].querySelector('input.step-input[data-field="name"]') as HTMLInputElement;
    expect(document.activeElement).toBe(secondNameInput);
    secondNameInput.value = 'Step Beta';
    secondNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    app.getStore().steps[1].type = 'ai-generated';

    document.getElementById('add-step')?.click();
    stepItems = document.querySelectorAll('.step-item');
    const thirdNameInput = stepItems[2].querySelector('input.step-input[data-field="name"]') as HTMLInputElement;
    thirdNameInput.value = 'Step Gamma';
    thirdNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    app.getStore().steps[2].type = 'ai-supported';
    (app as any).saveToStorage();
    (app as any).render();

    stepItems = document.querySelectorAll('.step-item');
    // Boundary controls check
    const up0 = stepItems[0].querySelector('.move-step-up') as HTMLButtonElement;
    const down0 = stepItems[0].querySelector('.move-step-down') as HTMLButtonElement;
    const up1 = stepItems[1].querySelector('.move-step-up') as HTMLButtonElement;
    const down2 = stepItems[2].querySelector('.move-step-down') as HTMLButtonElement;

    expect(up0.disabled).toBe(true);
    expect(down0.disabled).toBe(false);
    expect(up1.disabled).toBe(false);
    expect(down2.disabled).toBe(true);
    expect(up1.getAttribute('aria-label')).toContain('Move step 2: Step Beta up');

    // Before reordering: Step 2 (ai-generated) and Step 3 (ai-supported) are consecutive AI steps
    expect(detectConsecutiveAISteps(app.getStore()).length).toBe(1);

    // Move Step 1 (Human-only Step Alpha) down to index 1 (between Beta and Gamma)
    down0.click();

    expect(app.getStore().steps.map(s => s.name)).toEqual(['Step Beta', 'Step Alpha', 'Step Gamma']);
    // Consecutive AI cluster is now broken by Human-only Step Alpha!
    expect(detectConsecutiveAISteps(app.getStore()).length).toBe(0);

    // Step numbers in DOM updated to 1, 2, 3
    stepItems = document.querySelectorAll('.step-item');
    expect(stepItems[0].querySelector('.step-number')?.textContent).toBe('1');
    expect(stepItems[0].querySelector('.step-title-text')?.textContent).toBe('Step Beta');
    expect(stepItems[1].querySelector('.step-number')?.textContent).toBe('2');
    expect(stepItems[1].querySelector('.step-title-text')?.textContent).toBe('Step Alpha');

    // Keyboard focus remains on the moved step's Move Down button
    const movedDownBtn = stepItems[1].querySelector('.move-step-down') as HTMLButtonElement;
    expect(document.activeElement).toBe(movedDownBtn);

    // Reload from storage and confirm sequence persisted
    createTestDOM();
    const reloadedApp = new App(new StorageManager(customStorage));
    expect(reloadedApp.getStore().steps.map(s => s.name)).toEqual(['Step Beta', 'Step Alpha', 'Step Gamma']);
  });

  it('4. manages multiple workflows in the local registry: create, list, switch, duplicate, rename, and delete with confirmation and backup', () => {
    const manager = new StorageManager(customStorage);
    const app = new App(manager);

    // Configure first workflow
    app.getStore().metadata.title = 'Workflow One';
    app.getStore().metadata.owner = 'Alice';
    (app as any).saveToStorage();
    const wf1Id = app.getStore().metadata.id;

    // Create second workflow in registry
    expect(app.createWorkflowInRegistry('Workflow Two')).toBe(true);
    const wf2Id = app.getStore().metadata.id;
    expect(wf2Id).not.toBe(wf1Id);
    expect(app.getStore().metadata.title).toBe('Workflow Two');

    const listAfterCreate = app.listWorkflows();
    expect(listAfterCreate.length).toBe(2);
    expect(listAfterCreate.map(w => w.title)).toEqual(['Workflow One', 'Workflow Two']);

    // Switch back to Workflow One
    expect(app.switchWorkflow(wf1Id)).toBe(true);
    expect(app.getStore().metadata.id).toBe(wf1Id);
    expect(app.getStore().metadata.title).toBe('Workflow One');

    // Duplicate Workflow One
    expect(app.duplicateCurrentWorkflow()).toBe(true);
    const dupId = app.getStore().metadata.id;
    expect(dupId).not.toBe(wf1Id);
    expect(app.getStore().metadata.title).toBe('Workflow One (Copy)');
    expect(app.getStore().metadata.owner).toBe('Alice');
    expect(app.listWorkflows().length).toBe(3);

    // Rename the duplicated workflow
    expect(app.renameCurrentWorkflow('Workflow Three Renamed')).toBe(true);
    expect(app.getStore().metadata.title).toBe('Workflow Three Renamed');
    expect(app.listWorkflows().find(w => w.id === dupId)?.title).toBe('Workflow Three Renamed');

    // Cancel delete confirmation -> workflow is NOT deleted
    window.confirm = () => false;
    expect(app.deleteWorkflowById(dupId)).toBe(false);
    expect(app.listWorkflows().length).toBe(3);

    // Confirm delete -> protective backup created and workflow removed from registry
    window.confirm = () => true;
    expect(app.deleteWorkflowById(dupId)).toBe(true);
    expect(app.listWorkflows().length).toBe(2);
    expect(app.listWorkflows().some(w => w.id === dupId)).toBe(false);

    // Protective backup holds the deleted workflow
    const backupRaw = customStorage.getItem(BACKUP_KEY);
    expect(backupRaw).not.toBeNull();
    expect(JSON.parse(backupRaw!).metadata.id).toBe(dupId);
    expect(JSON.parse(backupRaw!).metadata.title).toBe('Workflow Three Renamed');
  });

  it('5. safely migrates legacy cp_workflow_designer records and drafts without duplicating on subsequent launches or losing backups', () => {
    const legacyDraft: WorkflowStore = {
      metadata: {
        id: 'legacy-draft-001',
        title: 'Legacy Unfinished Draft',
        version: '1.0.0',
        created_at: '2026-01-15T00:00:00Z',
        owner: '',
        organisation: 'CloudPedagogy',
        purpose: '',
        domain: 'education'
      },
      steps: [
        {
          id: 'legacy-step-1',
          name: '',
          type: 'ai-supported',
          description: 'Draft step from legacy single-workflow storage',
          inputs: ['Notes'],
          outputs: [],
          ai_involvement: { ai_role: 'Summarizer', reliance_level: 'medium' },
          human_oversight: { responsible_role: 'Tutor', oversight_level: 'active', intervention_points: 'Review' },
          risks: { bias_risk: '', operational_risk: '', ethical_risk: 'Fairness', privacy_risk: 'Anon', mitigation: '' },
          controls: { approval_required: false, escalation_path: '', review_cycle: '' }
        }
      ],
      reflection: { failure_modes: '', essential_judgement: '', over_reliance_risks: '', embedded_assumptions: '' }
    };

    const existingBackup = JSON.stringify({
      ...DEMO_STATE,
      metadata: { ...DEMO_STATE.metadata, id: 'preserved-backup-id', title: 'Preserved Backup' }
    });

    customStorage.setItem(STORAGE_KEY, JSON.stringify(legacyDraft));
    customStorage.setItem(BACKUP_KEY, existingBackup);
    expect(customStorage.getItem(REGISTRY_KEY)).toBeNull();

    // First launch: migrates legacyDraft into REGISTRY_KEY and preserves BACKUP_KEY
    const app1 = new App(new StorageManager(customStorage));
    expect(app1.getStore().metadata.id).toBe('legacy-draft-001');
    expect(app1.getStore().metadata.title).toBe('Legacy Unfinished Draft');
    expect(app1.listWorkflows().length).toBe(1);
    expect(customStorage.getItem(REGISTRY_KEY)).not.toBeNull();
    expect(customStorage.getItem(BACKUP_KEY)).toBe(existingBackup);

    // Second and third launches: does NOT create duplicate migrated records
    createTestDOM();
    const app2 = new App(new StorageManager(customStorage));
    expect(app2.listWorkflows().length).toBe(1);
    expect(app2.getStore().metadata.id).toBe('legacy-draft-001');

    createTestDOM();
    const app3 = new App(new StorageManager(customStorage));
    expect(app3.listWorkflows().length).toBe(1);

    // Corrupted legacy or registry storage is NOT destructively migrated or overwritten
    const corruptStorageMap = new Map<string, string>();
    const corruptStorage = createMemoryStorage(corruptStorageMap);
    corruptStorage.setItem(STORAGE_KEY, '{"metadata": {"corrupted_legacy": ');
    createTestDOM();
    const corruptApp = new App(new StorageManager(corruptStorage));
    expect(corruptStorage.getItem(STORAGE_KEY)).toBe('{"metadata": {"corrupted_legacy": ');
    expect(corruptStorage.getItem(REGISTRY_KEY)).toBeNull();
    expect(document.getElementById('corrupted-storage-banner')).not.toBeNull();
    corruptApp.getStore().metadata.title = 'Attempted Autosave During Corruption';
    expect((corruptApp as any).saveToStorage()).toBe(false);
    expect(corruptStorage.getItem(STORAGE_KEY)).toBe('{"metadata": {"corrupted_legacy": ');
  });

  it('6. preserves unsaved in-memory edits when switching workflows and rolls back partial registry writes on quota failure', () => {
    let failWrites = false;
    let failRegistryOnly = false;

    const controlledStorage: Storage = {
      getItem: (k: string) => backingMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (failWrites && (k === STORAGE_KEY || k === REGISTRY_KEY)) {
          const err = new Error('QuotaExceededError');
          err.name = 'QuotaExceededError';
          throw err;
        }
        if (failRegistryOnly && k === REGISTRY_KEY) {
          const err = new Error('QuotaExceededError: Registry write failed');
          err.name = 'QuotaExceededError';
          throw err;
        }
        backingMap.set(k, String(v));
      },
      removeItem: (k: string) => {
        backingMap.delete(k);
      },
      clear: () => {
        backingMap.clear();
      },
      key: (i: number) => Array.from(backingMap.keys())[i] ?? null,
      get length() {
        return backingMap.size;
      }
    };

    const manager = new StorageManager(controlledStorage);
    const app = new App(manager);

    // Save Workflow A and Workflow B normally
    app.getStore().metadata.title = 'Workflow A (Saved)';
    (app as any).saveToStorage();
    const wfAId = app.getStore().metadata.id;

    app.createWorkflowInRegistry('Workflow B (Saved)');
    const wfBId = app.getStore().metadata.id;

    // Switch back to Workflow A and make an unsaved edit while storage quota fails
    app.switchWorkflow(wfAId);
    failWrites = true;
    app.getStore().metadata.title = 'Workflow A (Unsaved In-Memory Edit)';
    (app as any).saveToStorage();
    expect(app.getHasUnsavedChanges()).toBe(true);

    // Switch to Workflow B
    app.switchWorkflow(wfBId);
    expect(app.getStore().metadata.id).toBe(wfBId);
    expect(app.getStore().metadata.title).toBe('Workflow B (Saved)');

    // Switch back to Workflow A -> unsaved in-memory edit and unsaved flag are preserved!
    app.switchWorkflow(wfAId);
    expect(app.getStore().metadata.id).toBe(wfAId);
    expect(app.getStore().metadata.title).toBe('Workflow A (Unsaved In-Memory Edit)');
    expect(app.getHasUnsavedChanges()).toBe(true);

    // Test atomic rollback when STORAGE_KEY write succeeds but REGISTRY_KEY write fails
    failWrites = false;
    (app as any).saveToStorage(); // Now persisted cleanly
    const prevActiveRaw = controlledStorage.getItem(STORAGE_KEY);
    const prevRegistryRaw = controlledStorage.getItem(REGISTRY_KEY);

    failRegistryOnly = true;
    expect(app.renameCurrentWorkflow('Should Roll Back Title')).toBe(false);

    // Both STORAGE_KEY and REGISTRY_KEY must be rolled back to their exact prior state!
    expect(controlledStorage.getItem(STORAGE_KEY)).toBe(prevActiveRaw);
    expect(controlledStorage.getItem(REGISTRY_KEY)).toBe(prevRegistryRaw);
  });

  it('7. exports, validates, and imports full workflow registry backups safely without silent overwrite', () => {
    const manager = new StorageManager(customStorage);
    const app = new App(manager);

    app.getStore().metadata.title = 'Registry WF 1';
    app.getStore().metadata.owner = 'Owner 1';
    (app.getStore().metadata as any).custom_org_tag = 'tag-alpha';
    (app as any).saveToStorage();
    const id1 = app.getStore().metadata.id;

    app.createWorkflowInRegistry('Registry WF 2 (Draft)');
    const id2 = app.getStore().metadata.id;

    // Export full registry backup
    const backupJson = app.exportRegistryBackup();
    const parsedBackup = JSON.parse(backupJson);
    expect(parsedBackup.format).toBe('cloudpedagogy_workflow_registry');
    expect(parsedBackup.workflow_order).toEqual([id1, id2]);
    expect(parsedBackup.workflows[id1].metadata.custom_org_tag).toBe('tag-alpha');

    // Malformed / invalid registry import is rejected before any mutation
    const invalidRegistryJson = JSON.stringify({
      format: 'cloudpedagogy_workflow_registry',
      registry_version: '1.0.0',
      workflows: {
        bad: { metadata: {}, steps: [{ step_type: 'invalid-step-type' }] }
      }
    });
    expect(validateRegistryImport(invalidRegistryJson).valid).toBe(false);
    expect(app.importRegistryContent(invalidRegistryJson)).toBe(false);
    expect(app.listWorkflows().length).toBe(2);

    // Start a fresh storage instance with a single workflow, then import the 2-workflow registry backup
    const freshMap = new Map<string, string>();
    const freshStorage = createMemoryStorage(freshMap);
    createTestDOM();
    const appFresh = new App(new StorageManager(freshStorage));
    appFresh.getStore().metadata.title = 'Pre-Import Workflow';
    (appFresh as any).saveToStorage();

    // User cancels confirmation -> existing registry is preserved
    window.confirm = () => false;
    expect(appFresh.importRegistryContent(backupJson)).toBe(false);
    expect(appFresh.getStore().metadata.title).toBe('Pre-Import Workflow');

    // User confirms -> protective backup created and registry restored with original IDs and custom fields
    window.confirm = () => true;
    expect(appFresh.importRegistryContent(backupJson)).toBe(true);
    expect(appFresh.listWorkflows().length).toBe(2);
    expect(appFresh.listWorkflows().map(w => w.id)).toEqual([id1, id2]);
    expect(appFresh.getStore().metadata.id).toBe(id2);

    appFresh.switchWorkflow(id1);
    expect(appFresh.getStore().metadata.title).toBe('Registry WF 1');
    expect((appFresh.getStore().metadata as any).custom_org_tag).toBe('tag-alpha');
  });

  it('8. generates complete Markdown specification including all AI involvement, oversight, risks, controls, and reflection fields', () => {
    const store: WorkflowStore = {
      metadata: {
        id: 'md-test-01',
        title: 'Comprehensive Governance Spec',
        version: '2.1.0',
        created_at: '2026-03-01T00:00:00Z',
        owner: 'Governance Lead',
        organisation: 'Institute of AI Ethics',
        purpose: 'Full lifecycle verification',
        domain: 'research',
        capabilityNotes: 'Builds critical oversight literacy',
        governanceNotes: 'Requires institutional sign-off'
      },
      steps: [
        {
          id: 'step-md-1',
          name: 'Automated Literature Triage',
          type: 'decision-point',
          description: 'Screens candidate papers and records inclusion decision',
          inputs: ['Search Query', 'Corpus'],
          outputs: ['Ranked Citations'],
          ai_involvement: {
            ai_role: 'Ranks abstracts by relevance score',
            reliance_level: 'high'
          },
          human_oversight: {
            responsible_role: 'Principal Investigator',
            oversight_level: 'active',
            intervention_points: 'Manual override of exclusion threshold'
          },
          risks: {
            bias_risk: 'Language and publication venue bias',
            operational_risk: 'API latency or model drift',
            ethical_risk: 'Exclusion of underrepresented methodologies',
            privacy_risk: 'Unintended ingestion of unpublished manuscripts',
            mitigation: 'Dual human spot-check of 20% excluded papers'
          },
          controls: {
            approval_required: true,
            escalation_path: 'Research Integrity Board',
            review_cycle: 'Quarterly'
          }
        }
      ],
      reflection: {
        failure_modes: 'Silent omission of seminal papers',
        essential_judgement: 'Contextual interpretation of methodology quality',
        over_reliance_risks: 'Uncritical acceptance of top-ranked abstracts',
        embedded_assumptions: 'Relevance correlates with lexical similarity'
      }
    };

    const md = generateMarkdown(store);

    expect(md).toContain('**AI Role**: Ranks abstracts by relevance score');
    expect(md).toContain('**AI Reliance Level**: high');
    expect(md).toContain('**Responsible Role**: Principal Investigator');
    expect(md).toContain('**Oversight Level**: active');
    expect(md).toContain('**Intervention Points**: Manual override of exclusion threshold');
    expect(md).toContain('**Bias Risk**: Language and publication venue bias');
    expect(md).toContain('**Operational Risk**: API latency or model drift');
    expect(md).toContain('**Ethical Risk**: Exclusion of underrepresented methodologies');
    expect(md).toContain('**Privacy Risk**: Unintended ingestion of unpublished manuscripts');
    expect(md).toContain('**Mitigation**: Dual human spot-check of 20% excluded papers');
    expect(md).toContain('**Approval Required**: YES');
    expect(md).toContain('**Decision Record Required**: YES');
    expect(md).toContain('**Escalation Path**: Research Integrity Board');
    expect(md).toContain('**Review Cycle**: Quarterly');
    expect(md).toContain('Silent omission of seminal papers');
    expect(md).toContain('Contextual interpretation of methodology quality');
    expect(md).toContain('Uncritical acceptance of top-ranked abstracts');
    expect(md).toContain('Relevance correlates with lexical similarity');

    // Also verify exportRegistryToJSON helper directly
    const regStr = exportRegistryToJSON({
      format: 'cloudpedagogy_workflow_registry',
      registry_version: '1.0.0',
      updated_at: '2026-03-01T00:00:00Z',
      active_workflow_id: 'md-test-01',
      workflow_order: ['md-test-01'],
      workflows: { 'md-test-01': store }
    });
    expect(JSON.parse(regStr).workflows['md-test-01'].steps[0].ai_involvement.ai_role).toBe(
      'Ranks abstracts by relevance score'
    );
  });

  it('9. [Defect 3A] preserves unsaved in-memory workflow edits across initial placeholder recovery and all subsequent registry operations', () => {
    let failWrites = false;
    const controlledStorage: Storage = {
      getItem: (k: string) => backingMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (failWrites && (k === STORAGE_KEY || k === REGISTRY_KEY)) {
          const err = new Error('QuotaExceededError');
          err.name = 'QuotaExceededError';
          throw err;
        }
        backingMap.set(k, String(v));
      },
      removeItem: (k: string) => backingMap.delete(k),
      clear: () => backingMap.clear(),
      key: (i: number) => Array.from(backingMap.keys())[i] ?? null,
      get length() {
        return backingMap.size;
      }
    };

    // Sequence 3A-1: Initial placeholder edited while storage fails, then storage recovers and a second workflow is imported/saved
    const manager = new StorageManager(controlledStorage);
    const app = new App(manager);
    const initialPlaceholderId = app.getStore().metadata.id;

    failWrites = true;
    app.getStore().metadata.title = 'Unsaved Initial Placeholder Draft';
    app.getStore().metadata.owner = 'Dr. Placeholder';
    expect((app as any).saveToStorage()).toBe(false);
    expect(app.getHasUnsavedChanges()).toBe(true);

    // Storage recovers; user imports a second workflow
    failWrites = false;
    const importPayload = JSON.stringify({
      metadata: {
        workflow_id: 'imported-wf-2',
        workflow_title: 'Imported Second Workflow',
        workflow_owner: 'Owner 2',
        purpose: 'Second workflow purpose'
      },
      steps: []
    });
    expect(app.importWorkflowContent(importPayload)).toBe(true);

    // Initial placeholder with unsaved edits MUST NOT be deleted from inMemoryWorkflows or omitted from REGISTRY_KEY
    const listAfterImport = app.listWorkflows();
    expect(listAfterImport.map(w => w.id)).toEqual([initialPlaceholderId, 'imported-wf-2']);
    expect(listAfterImport.find(w => w.id === initialPlaceholderId)?.title).toBe(
      'Unsaved Initial Placeholder Draft'
    );

    // Sequence 3A-2: Persisted workflow W1 edited in memory while storage fails, then storage recovers and create/duplicate/rename/delete run
    app.switchWorkflow(initialPlaceholderId);
    failWrites = true;
    app.getStore().metadata.title = 'W1 Newer In-Memory Title v2';
    expect((app as any).saveToStorage()).toBe(false);

    // Storage recovers; user creates W3 in registry (and duplicates/renames/deletes)
    failWrites = false;
    expect(app.createWorkflowInRegistry('Workflow Three')).toBe(true);
    expect(app.duplicateCurrentWorkflow()).toBe(true);
    const dupId = app.getStore().metadata.id;
    expect(app.renameCurrentWorkflow('Workflow Three Copy Renamed')).toBe(true);
    expect(app.deleteWorkflowById(dupId)).toBe(true);

    // Simulate full browser reload: W1 must have 'W1 Newer In-Memory Title v2', NOT the older persisted title!
    createTestDOM();
    const reloadedApp = new App(new StorageManager(controlledStorage));
    expect(reloadedApp.switchWorkflow(initialPlaceholderId)).toBe(true);
    expect(reloadedApp.getStore().metadata.title).toBe('W1 Newer In-Memory Title v2');
    expect(reloadedApp.getStore().metadata.owner).toBe('Dr. Placeholder');
  });

  it('10. [Defect 3B] separates workflow content unsaved state from active-pointer persistence failure during repeated switches', () => {
    let failWrites = false;
    const controlledStorage: Storage = {
      getItem: (k: string) => backingMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (failWrites && (k === STORAGE_KEY || k === REGISTRY_KEY)) {
          const err = new Error('QuotaExceededError');
          err.name = 'QuotaExceededError';
          throw err;
        }
        backingMap.set(k, String(v));
      },
      removeItem: (k: string) => backingMap.delete(k),
      clear: () => backingMap.clear(),
      key: (i: number) => Array.from(backingMap.keys())[i] ?? null,
      get length() {
        return backingMap.size;
      }
    };

    const manager = new StorageManager(controlledStorage);
    const app = new App(manager);

    app.getStore().metadata.title = 'Saved Workflow 1';
    (app as any).saveToStorage();
    const wf1Id = app.getStore().metadata.id;

    app.createWorkflowInRegistry('Saved Workflow 2');
    const wf2Id = app.getStore().metadata.id;

    // Switch to WF 1 and edit its content while storage fails
    app.switchWorkflow(wf1Id);
    failWrites = true;
    app.getStore().metadata.title = 'Edited Unsaved Workflow 1';
    (app as any).saveToStorage();
    expect(app.getHasUnsavedChanges()).toBe(true);

    // Switch to unmodified WF 2 while storage writes still fail
    expect(app.switchWorkflow(wf2Id)).toBe(true);
    expect(app.getStore().metadata.id).toBe(wf2Id);
    expect(app.getStore().metadata.title).toBe('Saved Workflow 2');
    // Crucially: WF 2 content was NOT modified, so getHasUnsavedChanges() is false, while status badge shows storage error
    expect(app.getHasUnsavedChanges()).toBe(false);
    expect(document.getElementById('save-status')?.className).toContain('status-error');

    // Switch back and forth repeatedly while storage fails
    expect(app.switchWorkflow(wf1Id)).toBe(true);
    expect(app.getHasUnsavedChanges()).toBe(true);
    expect(app.switchWorkflow(wf2Id)).toBe(true);
    expect(app.getHasUnsavedChanges()).toBe(false);

    // WF 2 must NOT be contaminated in unsavedWorkflowIds
    expect(manager.isWorkflowUnsaved(wf2Id)).toBe(false);
    expect(manager.isWorkflowUnsaved(wf1Id)).toBe(true);

    // Restore storage and switch again
    failWrites = false;
    expect(app.switchWorkflow(wf1Id)).toBe(true);
    expect(app.getHasUnsavedChanges()).toBe(true);
    expect(app.switchWorkflow(wf2Id)).toBe(true);
    expect(app.getHasUnsavedChanges()).toBe(false);
    expect(document.getElementById('save-status')?.className).toContain('status-saved');

    const summaries = app.listWorkflows();
    expect(summaries.find(w => w.id === wf1Id)?.hasUnsavedChanges).toBe(true);
    expect(summaries.find(w => w.id === wf2Id)?.hasUnsavedChanges).toBe(false);
  });

  it('11. [Defect 4A] protects newer registry records from older STORAGE_KEY mirror on startup and synchronizes active mirror safely', () => {
    const wf1Newer: WorkflowStore = {
      ...JSON.parse(JSON.stringify(DEMO_STATE)),
      metadata: {
        ...DEMO_STATE.metadata,
        id: 'wf-1',
        title: 'Authoritative Newer WF 1 in Registry'
      }
    };
    const wf2Active: WorkflowStore = {
      ...JSON.parse(JSON.stringify(DEMO_STATE)),
      metadata: {
        ...DEMO_STATE.metadata,
        id: 'wf-2',
        title: 'Authoritative Active WF 2 in Registry'
      }
    };
    const wf1OlderMirror: WorkflowStore = {
      ...JSON.parse(JSON.stringify(DEMO_STATE)),
      metadata: {
        ...DEMO_STATE.metadata,
        id: 'wf-1',
        title: 'Stale Older Mirror WF 1 in STORAGE_KEY'
      }
    };

    const existingRegistry = {
      format: 'cloudpedagogy_workflow_registry',
      registry_version: '1.0.0',
      updated_at: '2026-04-01T00:00:00Z',
      active_workflow_id: 'wf-2',
      workflow_order: ['wf-1', 'wf-2'],
      workflows: {
        'wf-1': wf1Newer,
        'wf-2': wf2Active
      }
    };

    customStorage.setItem(REGISTRY_KEY, JSON.stringify(existingRegistry));
    customStorage.setItem(STORAGE_KEY, JSON.stringify(wf1OlderMirror));

    const app = new App(new StorageManager(customStorage));

    // 1. Loads registry's active_workflow_id ('wf-2')
    expect(app.getStore().metadata.id).toBe('wf-2');
    expect(app.getStore().metadata.title).toBe('Authoritative Active WF 2 in Registry');

    // 2. Synchronizes STORAGE_KEY mirror to 'wf-2'
    expect(JSON.parse(customStorage.getItem(STORAGE_KEY)!).metadata.id).toBe('wf-2');

    // 3. Does NOT overwrite 'wf-1' in registry with stale mirror from STORAGE_KEY
    app.switchWorkflow('wf-1');
    expect(app.getStore().metadata.title).toBe('Authoritative Newer WF 1 in Registry');

    // 4. If mirror synchronization fails on startup (e.g. quota error writing STORAGE_KEY), preserves registry and reports error non-destructively
    customStorage.setItem(REGISTRY_KEY, JSON.stringify(existingRegistry));
    customStorage.setItem(STORAGE_KEY, JSON.stringify(wf1OlderMirror));
    const readOnlyMirrorStorage: Storage = {
      getItem: (k: string) => backingMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k === STORAGE_KEY) {
          const err = new Error('QuotaExceededError: Cannot sync mirror');
          err.name = 'QuotaExceededError';
          throw err;
        }
        backingMap.set(k, String(v));
      },
      removeItem: (k: string) => backingMap.delete(k),
      clear: () => backingMap.clear(),
      key: (i: number) => Array.from(backingMap.keys())[i] ?? null,
      get length() {
        return backingMap.size;
      }
    };

    createTestDOM();
    const appSyncFail = new App(new StorageManager(readOnlyMirrorStorage));
    expect(appSyncFail.getStore().metadata.id).toBe('wf-2');
    expect(appSyncFail.getStore().metadata.title).toBe('Authoritative Active WF 2 in Registry');
    expect(document.getElementById('save-status')?.className).toContain('status-error');
    expect(JSON.parse(readOnlyMirrorStorage.getItem(REGISTRY_KEY)!).workflows['wf-1'].metadata.title).toBe(
      'Authoritative Newer WF 1 in Registry'
    );
  });

  it('12. [Defect 5A] verifies dual-key rollback, reports rollback failure/divergence explicitly, and does not commit unpersisted registry state', () => {
    let failFirstWrite = false;
    let failSecondWrite = false;
    let failRollbackWrite = false;
    let activeWriteCount = 0;

    const controlledStorage: Storage = {
      getItem: (k: string) => backingMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k === STORAGE_KEY) {
          activeWriteCount++;
          if (failFirstWrite) {
            const err = new Error('QuotaExceededError: First write failed');
            err.name = 'QuotaExceededError';
            throw err;
          }
          if (failRollbackWrite && activeWriteCount >= 2) {
            throw new Error('SecurityError: Rollback write blocked');
          }
        }
        if (k === REGISTRY_KEY && failSecondWrite) {
          const err = new Error('QuotaExceededError: Second write failed');
          err.name = 'QuotaExceededError';
          throw err;
        }
        backingMap.set(k, String(v));
      },
      removeItem: (k: string) => backingMap.delete(k),
      clear: () => backingMap.clear(),
      key: (i: number) => Array.from(backingMap.keys())[i] ?? null,
      get length() {
        return backingMap.size;
      }
    };

    const manager = new StorageManager(controlledStorage);
    const app = new App(manager);
    app.getStore().metadata.title = 'Persisted Baseline Workflow';
    (app as any).saveToStorage();
    const baselineId = app.getStore().metadata.id;
    const priorActiveRaw = controlledStorage.getItem(STORAGE_KEY);
    const priorRegistryRaw = controlledStorage.getItem(REGISTRY_KEY);

    // Case 1: Failed first write (STORAGE_KEY)
    failFirstWrite = true;
    activeWriteCount = 0;
    const res1 = manager.createWorkflowInRegistry('Failed Create 1', app.getStore(), false);
    expect(res1.success).toBe(false);
    expect(res1.rollbackFailed).toBe(false);
    expect(controlledStorage.getItem(STORAGE_KEY)).toBe(priorActiveRaw);
    expect(controlledStorage.getItem(REGISTRY_KEY)).toBe(priorRegistryRaw);
    // Persisted registry inside manager was NOT mutated to include 'Failed Create 1'
    expect((manager as any).registry.workflow_order).toEqual([baselineId]);

    // Case 2: Failed second write (REGISTRY_KEY) with successful rollback
    failFirstWrite = false;
    failSecondWrite = true;
    activeWriteCount = 0;
    const res2 = manager.saveWorkflow({
      ...app.getStore(),
      metadata: { ...app.getStore().metadata, title: 'Updated Title Failing Registry Write' }
    });
    expect(res2.success).toBe(false);
    expect(res2.rollbackFailed).toBe(false);
    expect(controlledStorage.getItem(STORAGE_KEY)).toBe(priorActiveRaw);
    expect(controlledStorage.getItem(REGISTRY_KEY)).toBe(priorRegistryRaw);

    // Case 3: Failed second write (REGISTRY_KEY) AND failed rollback of STORAGE_KEY -> explicit rollback failure & divergence reported
    failRollbackWrite = true;
    activeWriteCount = 0;
    const res3 = manager.saveWorkflow({
      ...app.getStore(),
      metadata: { ...app.getStore().metadata, title: 'Divergent Title After Failed Rollback' }
    });
    expect(res3.success).toBe(false);
    expect(res3.rollbackFailed).toBe(true);
    expect(res3.error).toContain('Rollback verification failed');
    expect(res3.error).toContain('active mirror restored: false');
    // Latest valid in-memory workflow data remains preserved for recovery export
    expect(manager.getWorkflowById(baselineId)?.metadata.title).toBe(
      'Divergent Title After Failed Rollback'
    );
  });

  it('13. [Defect 6A] rejects registry imports with duplicate effective workflow IDs or conflicting key/metadata IDs', () => {
    const manager = new StorageManager(customStorage);
    const app = new App(manager);
    app.getStore().metadata.title = 'Protected Existing Registry WF';
    (app as any).saveToStorage();

    // 1. Two differently keyed records resolving to the same metadata.workflow_id
    const duplicateIdPayload = JSON.stringify({
      format: 'cloudpedagogy_workflow_registry',
      registry_version: '1.0.0',
      active_workflow_id: 'shared-uuid-999',
      workflow_order: ['key_one', 'key_two'],
      workflows: {
        key_one: {
          metadata: {
            workflow_id: 'shared-uuid-999',
            workflow_title: 'First Colliding Workflow',
            workflow_owner: 'Owner A',
            purpose: 'Purpose A'
          },
          steps: []
        },
        key_two: {
          metadata: {
            workflow_id: 'shared-uuid-999',
            workflow_title: 'Second Colliding Workflow',
            workflow_owner: 'Owner B',
            purpose: 'Purpose B'
          },
          steps: []
        }
      }
    });

    const dupValidation = validateRegistryImport(duplicateIdPayload);
    expect(dupValidation.valid).toBe(false);
    expect(dupValidation.errors.some(e => e.includes('Duplicate workflow ID "shared-uuid-999"'))).toBe(
      true
    );

    expect(app.importRegistryContent(duplicateIdPayload)).toBe(false);
    expect(app.listWorkflows().length).toBe(1);
    expect(app.getStore().metadata.title).toBe('Protected Existing Registry WF');

    // 2. Metadata ID colliding with another workflow key in the registry map
    const keyCollisionPayload = JSON.stringify({
      format: 'cloudpedagogy_workflow_registry',
      registry_version: '1.0.0',
      workflows: {
        alpha: {
          metadata: { id: 'beta', title: 'Alpha claiming Beta ID' },
          steps: []
        },
        beta: {
          metadata: { id: 'gamma', title: 'Beta claiming Gamma ID' },
          steps: []
        }
      }
    });

    const keyCollisionResult = validateRegistryImport(keyCollisionPayload);
    expect(keyCollisionResult.valid).toBe(false);
    expect(
      keyCollisionResult.errors.some(e => e.includes('conflicts with workflow key "beta"'))
    ).toBe(true);
    expect(app.importRegistryContent(keyCollisionPayload)).toBe(false);
    expect(app.getStore().metadata.title).toBe('Protected Existing Registry WF');
  });
});
