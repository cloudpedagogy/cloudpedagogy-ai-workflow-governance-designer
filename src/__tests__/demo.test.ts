import { describe, it, expect, beforeEach } from 'vitest';
import { StorageManager, STORAGE_KEY } from '../utils/storage';
import { DEMO_STATE, type WorkflowStore } from '../data/model';
import { App } from '../main';

describe('Demo Mode Isolation & Data Protection', () => {
  let localStorageMock: Map<string, string>;
  let customStorage: Storage;

  beforeEach(() => {
    localStorageMock = new Map();
    customStorage = {
      getItem: (k: string) => localStorageMock.get(k) ?? null,
      setItem: (k: string, v: string) => { localStorageMock.set(k, String(v)); },
      removeItem: (k: string) => { localStorageMock.delete(k); },
      clear: () => { localStorageMock.clear(); },
      key: (i: number) => Array.from(localStorageMock.keys())[i] ?? null,
      get length() { return localStorageMock.size; }
    } as Storage;

    // Set up basic DOM structure for App
    document.body.innerHTML = `
      <div id="app">
        <nav class="sidebar">
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
  });

  it('preserves existing saved user workflow when loading demo', () => {
    const userWorkflow: WorkflowStore = {
      metadata: {
        id: 'user-wf-original',
        title: 'Original User Workflow',
        version: '1.0.0',
        created_at: '2026-01-01T00:00:00Z',
        owner: 'Original Owner',
        organisation: 'Original Org',
        purpose: 'Original Purpose',
        domain: 'education'
      },
      steps: [
        {
          id: 'step-orig-1',
          name: 'Original Step 1',
          type: 'human-only',
          description: '',
          inputs: [],
          outputs: [],
          ai_involvement: { ai_role: '', reliance_level: 'low' },
          human_oversight: { responsible_role: '', oversight_level: 'full', intervention_points: '' },
          risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
          controls: { approval_required: false, escalation_path: '', review_cycle: '' }
        }
      ],
      reflection: { failure_modes: '', essential_judgement: '', over_reliance_risks: '', embedded_assumptions: '' }
    };

    customStorage.setItem(STORAGE_KEY, JSON.stringify(userWorkflow));

    const storageManager = new StorageManager(customStorage);
    const app = new App(storageManager);

    // Initial state reflects user's saved workflow
    expect(app.getStore().metadata.title).toBe('Original User Workflow');

    // Simulate clicking "Load Demo"
    window.confirm = () => true;
    document.getElementById('load-demo')?.click();

    // App state now contains demo
    expect(app.getIsDemoMode()).toBe(true);
    expect(app.getStore().metadata.title).toBe(DEMO_STATE.metadata.title);

    // CRITICAL: Persistent storage still contains the user's original workflow!
    const savedInStorage = JSON.parse(customStorage.getItem(STORAGE_KEY)!);
    expect(savedInStorage.metadata.title).toBe('Original User Workflow');
    expect(savedInStorage.metadata.id).toBe('user-wf-original');
  });

  it('permits editing demo in memory without modifying saved persistent data', () => {
    const userWorkflow: WorkflowStore = {
      metadata: {
        id: 'user-wf-original',
        title: 'Original User Workflow',
        version: '1.0.0',
        created_at: '2026-01-01T00:00:00Z',
        owner: 'Original Owner',
        organisation: 'Original Org',
        purpose: 'Original Purpose',
        domain: 'education'
      },
      steps: [],
      reflection: { failure_modes: '', essential_judgement: '', over_reliance_risks: '', embedded_assumptions: '' }
    };

    customStorage.setItem(STORAGE_KEY, JSON.stringify(userWorkflow));

    const storageManager = new StorageManager(customStorage);
    const app = new App(storageManager);

    // Enter demo mode
    window.confirm = () => true;
    document.getElementById('load-demo')?.click();
    expect(app.getIsDemoMode()).toBe(true);

    // Switch to context view and edit title in input
    const contextNav = document.querySelector('[data-view="workflow-context"]') as HTMLElement;
    if (contextNav) contextNav.click();

    // Simulate editing demo workflow in memory
    app.getStore().metadata.title = 'Modified In-Memory Demo';

    // Verify localStorage has NOT been overwritten
    const savedInStorage = JSON.parse(customStorage.getItem(STORAGE_KEY)!);
    expect(savedInStorage.metadata.title).toBe('Original User Workflow');
    expect(savedInStorage.metadata.id).toBe('user-wf-original');
  });

  it('saves a new copy with a fresh UUID when user explicitly saves demo as own workflow', () => {
    const storageManager = new StorageManager(customStorage);
    const app = new App(storageManager);

    window.confirm = () => true;
    window.alert = () => {};
    document.getElementById('load-demo')?.click();

    const demoBanner = document.getElementById('demo-banner');
    expect(demoBanner).toBeDefined();

    // Click "Save Copy as My Workflow" button
    const saveCopyBtn = document.getElementById('save-demo-copy');
    saveCopyBtn?.click();

    // Exits demo mode
    expect(app.getIsDemoMode()).toBe(false);

    // Stored in localStorage with fresh ID (not 'demo-healthcare-001')
    const saved = JSON.parse(customStorage.getItem(STORAGE_KEY)!);
    expect(saved.metadata.id).not.toBe('demo-healthcare-001');
    expect(saved.metadata.id.length).toBeGreaterThan(10);
    expect(saved.metadata.title).toBe(DEMO_STATE.metadata.title);
  });

  it('restores original saved workflow when exiting demo mode', () => {
    const originalWorkflow: WorkflowStore = {
      metadata: {
        id: 'user-wf-saved-1',
        title: 'My Important Workflow',
        version: '1.0.0',
        created_at: '2026-01-01T00:00:00Z',
        owner: 'Jonathan',
        organisation: 'CloudPedagogy',
        purpose: 'Auditing AI systems',
        domain: 'research'
      },
      steps: [],
      reflection: { failure_modes: '', essential_judgement: '', over_reliance_risks: '', embedded_assumptions: '' }
    };
    customStorage.setItem(STORAGE_KEY, JSON.stringify(originalWorkflow));

    const storageManager = new StorageManager(customStorage);
    const app = new App(storageManager);

    // Enter demo mode
    window.confirm = () => true;
    document.getElementById('load-demo')?.click();
    expect(app.getStore().metadata.title).toBe(DEMO_STATE.metadata.title);

    // Exit demo mode via banner button
    document.getElementById('exit-demo')?.click();

    // Verified: demo banner is removed and user's original workflow is restored
    expect(app.getIsDemoMode()).toBe(false);
    expect(app.getStore().metadata.title).toBe('My Important Workflow');
    expect(app.getStore().metadata.id).toBe('user-wf-saved-1');
  });

  it('1. protects existing workflow when saving a demo copy: prompts confirmation, creates backup, and supports Restore Backup', () => {
    const originalWorkflow: WorkflowStore = {
      metadata: {
        id: 'orig-populated-id',
        title: 'Populated Original Workflow',
        version: '1.0.0',
        created_at: '2026-01-01T00:00:00Z',
        owner: 'Dr. Alice',
        organisation: 'University Lab',
        purpose: 'Clinical governance validation',
        domain: 'research'
      },
      steps: [
        {
          id: 'orig-step-1',
          name: 'Ethics Review',
          type: 'human-only',
          description: 'Review protocol',
          inputs: ['Protocol'],
          outputs: ['Approval'],
          ai_involvement: { ai_role: 'None', reliance_level: 'low' },
          human_oversight: { responsible_role: 'Chair', oversight_level: 'full', intervention_points: 'All' },
          risks: { bias_risk: 'Low', operational_risk: 'Delay', ethical_risk: 'Low', privacy_risk: 'Low', mitigation: 'Checklist' },
          controls: { approval_required: true, escalation_path: 'Board', review_cycle: 'Monthly' }
        }
      ],
      reflection: {
        failure_modes: 'Incomplete ethics packet',
        essential_judgement: 'Human ethics sign-off',
        over_reliance_risks: 'None',
        embedded_assumptions: 'Standard clinical trial'
      }
    };
    customStorage.setItem(STORAGE_KEY, JSON.stringify(originalWorkflow));

    const storageManager = new StorageManager(customStorage);
    const app = new App(storageManager);

    const confirmMessages: string[] = [];
    window.confirm = (msg?: string) => {
      if (msg) confirmMessages.push(msg);
      return true;
    };
    window.alert = () => {};

    // Enter demo mode and modify the demo
    document.getElementById('load-demo')?.click();
    expect(app.getIsDemoMode()).toBe(true);
    app.getStore().metadata.title = 'Modified Healthcare Demo Copy';

    // Click "Save Copy as My Workflow"
    document.getElementById('save-demo-copy')?.click();

    // Verify replacement confirmation was requested
    expect(confirmMessages.some(m => m.includes('replace your existing workflow'))).toBe(true);
    expect(app.getIsDemoMode()).toBe(false);
    expect(app.getStore().metadata.title).toBe('Modified Healthcare Demo Copy');

    // Verify protective backup of the original workflow was created
    expect(storageManager.hasProtectiveBackup()).toBe(true);
    const backupParsed = JSON.parse(storageManager.getProtectiveBackup()!);
    expect(backupParsed.metadata.id).toBe('orig-populated-id');
    expect(backupParsed.metadata.title).toBe('Populated Original Workflow');

    // Verify accessible "Restore Backup" button is rendered and restores the original workflow
    const restoreBtn = document.getElementById('restore-backup');
    expect(restoreBtn).not.toBeNull();
    restoreBtn?.click();

    expect(app.getStore().metadata.id).toBe('orig-populated-id');
    expect(app.getStore().metadata.title).toBe('Populated Original Workflow');
    expect(app.getStore().steps[0].name).toBe('Ethics Review');
    expect(JSON.parse(customStorage.getItem(STORAGE_KEY)!).metadata.id).toBe('orig-populated-id');
  });

  it('2. aborts demo replacement and preserves both existing workflow and demo edits when backup fails', () => {
    const originalWorkflow: WorkflowStore = {
      metadata: {
        id: 'orig-safe-id',
        title: 'Protected Original Workflow',
        version: '1.0.0',
        created_at: '2026-01-01T00:00:00Z',
        owner: 'Owner',
        organisation: 'Org',
        purpose: 'Purpose',
        domain: 'education'
      },
      steps: [],
      reflection: { failure_modes: '', essential_judgement: '', over_reliance_risks: '', embedded_assumptions: '' }
    };
    customStorage.setItem(STORAGE_KEY, JSON.stringify(originalWorkflow));

    let failBackupWrites = false;
    const quotaFailingStorage: Storage = {
      ...customStorage,
      getItem: (k: string) => localStorageMock.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (failBackupWrites) {
          const err = new Error('QuotaExceededError');
          err.name = 'QuotaExceededError';
          throw err;
        }
        localStorageMock.set(k, String(v));
      },
      removeItem: (k: string) => { localStorageMock.delete(k); },
      clear: () => { localStorageMock.clear(); },
      key: (i: number) => Array.from(localStorageMock.keys())[i] ?? null,
      get length() { return localStorageMock.size; }
    };

    const storageManager = new StorageManager(quotaFailingStorage);
    const app = new App(storageManager);

    window.confirm = () => true;
    const alerts: string[] = [];
    window.alert = (msg?: string) => { if (msg) alerts.push(msg); };

    document.getElementById('load-demo')?.click();
    app.getStore().metadata.title = 'Edited Demo That Cannot Backup';

    // Simulate quota failure when attempting to write backup
    failBackupWrites = true;
    document.getElementById('save-demo-copy')?.click();

    // Replacement must abort: still in demo mode, demo edits preserved in memory, original workflow intact in storage
    expect(app.getIsDemoMode()).toBe(true);
    expect(app.getStore().metadata.title).toBe('Edited Demo That Cannot Backup');
    expect(alerts.some(a => a.includes('Protective backup failed'))).toBe(true);
    expect(JSON.parse(localStorageMock.get(STORAGE_KEY)!).metadata.id).toBe('orig-safe-id');
  });

  it('3. restores incomplete working draft reliably when exiting demo mode', () => {
    const incompleteDraft: WorkflowStore = {
      metadata: {
        id: 'draft-wf-1',
        title: 'Work in Progress Title Only',
        version: '1.0.0',
        created_at: '2026-01-01T00:00:00Z',
        owner: '', // Incomplete owner
        organisation: '',
        purpose: '', // Incomplete purpose
        domain: 'education'
      },
      steps: [
        {
          id: 'draft-step-1',
          name: '', // Unnamed step just added
          type: 'ai-supported',
          description: 'Draft step description',
          inputs: [],
          outputs: [],
          ai_involvement: { ai_role: '', reliance_level: 'low' },
          human_oversight: { responsible_role: '', oversight_level: 'none', intervention_points: '' },
          risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
          controls: { approval_required: false, escalation_path: '', review_cycle: '' }
        }
      ],
      reflection: { failure_modes: '', essential_judgement: '', over_reliance_risks: '', embedded_assumptions: '' }
    };
    customStorage.setItem(STORAGE_KEY, JSON.stringify(incompleteDraft));

    const storageManager = new StorageManager(customStorage);
    const app = new App(storageManager);
    expect(app.getStore().metadata.title).toBe('Work in Progress Title Only');

    window.confirm = () => true;
    document.getElementById('load-demo')?.click();
    expect(app.getIsDemoMode()).toBe(true);

    // Exit demo mode
    document.getElementById('exit-demo')?.click();

    expect(app.getIsDemoMode()).toBe(false);
    expect(app.getStore().metadata.id).toBe('draft-wf-1');
    expect(app.getStore().metadata.title).toBe('Work in Progress Title Only');
    expect(app.getStore().steps.length).toBe(1);
    expect(app.getStore().steps[0].description).toBe('Draft step description');
  });

  it('4. warns when entering demo mode with unsaved in-memory changes and restores them on exit', () => {
    // Storage that fails on write so changes stay unsaved in memory
    const readOnlyStorage: Storage = {
      getItem: (k: string) => localStorageMock.get(k) ?? null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0
    };

    const storageManager = new StorageManager(readOnlyStorage);
    const app = new App(storageManager);

    // Switch to context view and edit title so we have unsaved in-memory work
    app.getStore().metadata.title = 'Unsaved In-Memory Research Workflow';
    const titleInput = document.createElement('input');
    titleInput.id = 'title';
    titleInput.value = 'Unsaved In-Memory Research Workflow';
    // Trigger saveToStorage via context input
    (app as any).saveToStorage();
    expect(app.getHasUnsavedChanges()).toBe(true);

    const confirmPrompts: string[] = [];
    window.confirm = (msg?: string) => {
      if (msg) confirmPrompts.push(msg);
      return true;
    };

    document.getElementById('load-demo')?.click();
    expect(confirmPrompts[0]).toContain('unsaved changes in memory');
    expect(app.getIsDemoMode()).toBe(true);
    expect(app.getStore().metadata.title).toBe(DEMO_STATE.metadata.title);

    // Exit demo mode and verify the unsaved in-memory workflow is restored with unsaved status
    document.getElementById('exit-demo')?.click();
    expect(app.getIsDemoMode()).toBe(false);
    expect(app.getStore().metadata.title).toBe('Unsaved In-Memory Research Workflow');
    expect(app.getHasUnsavedChanges()).toBe(true);
    expect(document.getElementById('save-status')?.textContent).toContain('Unsaved in Memory');
  });

  it('5. preserves preDemoStore, demo mode, demo banner, and visible error status when demo save fails after backup succeeds', () => {
    const workflowA: WorkflowStore = {
      metadata: {
        id: 'wf-A',
        title: 'Workflow A (Persisted)',
        version: '1.0.0',
        created_at: '2026-01-01T00:00:00Z',
        owner: 'Owner A',
        organisation: 'Org A',
        purpose: 'Purpose A',
        domain: 'education'
      },
      steps: [],
      reflection: { failure_modes: '', essential_judgement: '', over_reliance_risks: '', embedded_assumptions: '' }
    };
    customStorage.setItem(STORAGE_KEY, JSON.stringify(workflowA));

    let failActiveStorageWrites = false;
    const selectiveStorage: Storage = {
      getItem: (k: string) => localStorageMock.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (failActiveStorageWrites && k === STORAGE_KEY) {
          const err = new Error('QuotaExceededError: Active storage full');
          err.name = 'QuotaExceededError';
          throw err;
        }
        localStorageMock.set(k, String(v));
      },
      removeItem: (k: string) => { localStorageMock.delete(k); },
      clear: () => { localStorageMock.clear(); },
      key: (i: number) => Array.from(localStorageMock.keys())[i] ?? null,
      get length() { return localStorageMock.size; }
    };

    const storageManager = new StorageManager(selectiveStorage);
    const app = new App(storageManager);

    // Modify A into B in memory while active storage writes fail so B remains unsaved
    failActiveStorageWrites = true;
    app.getStore().metadata.title = 'Workflow B (Unsaved Pre-Demo)';
    (app as any).saveToStorage();
    expect(app.getHasUnsavedChanges()).toBe(true);

    const confirmPrompts: string[] = [];
    window.confirm = (msg?: string) => {
      if (msg) confirmPrompts.push(msg);
      return true;
    };
    window.alert = () => {};

    // Enter demo mode and edit demo
    document.getElementById('load-demo')?.click();
    expect(app.getIsDemoMode()).toBe(true);
    app.getStore().metadata.title = 'Modified Demo Copy In Memory';

    // Attempt to save demo copy: backup to BACKUP_KEY succeeds, but saveWorkflow to STORAGE_KEY fails!
    document.getElementById('save-demo-copy')?.click();

    // 1. Explained single-snapshot backup precedence before replacement
    expect(confirmPrompts.some(m => m.includes('single protective backup slot'))).toBe(true);

    // 2. Demo mode, demo banner, and modified demo copy remain intact in memory
    expect(app.getIsDemoMode()).toBe(true);
    expect(document.getElementById('demo-banner')).not.toBeNull();
    expect(app.getStore().metadata.title).toBe('Modified Demo Copy In Memory');

    // 3. Genuine storage-error status is visible even in demo mode
    const statusBadge = document.getElementById('save-status')!;
    expect(statusBadge.className).toContain('status-error');
    expect(statusBadge.textContent).toContain('Storage Error');

    // 4. Restore button is synchronized and visible on the failure path
    expect(document.getElementById('restore-backup')).not.toBeNull();

    // 5. Clicking Exit Demo reliably recovers pre-demo snapshot B (with its unsaved status)
    document.getElementById('exit-demo')?.click();
    expect(app.getIsDemoMode()).toBe(false);
    expect(app.getStore().metadata.title).toBe('Workflow B (Unsaved Pre-Demo)');
    expect(app.getHasUnsavedChanges()).toBe(true);
    expect(JSON.parse(localStorageMock.get(STORAGE_KEY)!).metadata.title).toBe('Workflow A (Persisted)');
  });
});
