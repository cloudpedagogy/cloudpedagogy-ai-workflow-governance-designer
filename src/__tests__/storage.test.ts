import { describe, it, expect, beforeEach } from 'vitest';
import { StorageManager, STORAGE_KEY, BACKUP_KEY } from '../utils/storage';
import { DEMO_STATE, type WorkflowStore } from '../data/model';
import { App } from '../main';

class MockStorage implements Storage {
  private store: Map<string, string> = new Map();
  public throwOnSet: boolean = false;
  public throwOnBackup: boolean = false;

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.throwOnSet) {
      const err = new Error('QuotaExceededError: DOM Exception 22');
      err.name = 'QuotaExceededError';
      (err as any).code = 22;
      throw err;
    }
    if (this.throwOnBackup && key === BACKUP_KEY) {
      const err = new Error('QuotaExceededError: DOM Exception 22');
      err.name = 'QuotaExceededError';
      (err as any).code = 22;
      throw err;
    }
    this.store.set(key, String(value));
  }
}

describe('StorageManager & Persistence Hardening', () => {
  let mockStorage: MockStorage;
  let manager: StorageManager;

  beforeEach(() => {
    mockStorage = new MockStorage();
    manager = new StorageManager(mockStorage);
  });

  it('persists and reloads valid workflows successfully', () => {
    const saveResult = manager.saveWorkflow(DEMO_STATE);
    expect(saveResult.success).toBe(true);

    const loadResult = manager.loadWorkflow();
    expect(loadResult.success).toBe(true);
    expect(loadResult.data.metadata.title).toBe(DEMO_STATE.metadata.title);
    expect(loadResult.data.steps.length).toBe(DEMO_STATE.steps.length);
  });

  it('handles malformed JSON in storage without wiping out corrupted data', () => {
    const corruptPayload = '{"metadata": { "unclosed json';
    mockStorage.setItem(STORAGE_KEY, corruptPayload);

    const loadResult = manager.loadWorkflow();
    expect(loadResult.success).toBe(false);
    expect(loadResult.rawCorrupted).toBe(corruptPayload);
    // Crucially: existing corrupted data is preserved in storage for user recovery
    expect(mockStorage.getItem(STORAGE_KEY)).toBe(corruptPayload);
    // Safe initial state loaded in memory
    expect(loadResult.data).toBeDefined();
    expect(loadResult.data.steps).toEqual([]);
  });

  it('handles QuotaExceededError gracefully and returns actionable recovery error', () => {
    mockStorage.throwOnSet = true;

    const result = manager.saveWorkflow(DEMO_STATE);
    expect(result.success).toBe(false);
    expect(result.isQuotaExceeded).toBe(true);
    expect(result.error).toContain('Storage quota exceeded');
    expect(result.error).toContain('Export as JSON');
  });

  it('creates protective backup before destructive operations', () => {
    manager.saveWorkflow(DEMO_STATE);
    expect(mockStorage.getItem(STORAGE_KEY)).toBeDefined();

    const backupResult = manager.createProtectiveBackup();
    expect(backupResult.success).toBe(true);
    expect(mockStorage.getItem(BACKUP_KEY)).toBe(mockStorage.getItem(STORAGE_KEY));
  });

  it('aborts operation when protective backup fails', () => {
    manager.saveWorkflow(DEMO_STATE);
    mockStorage.throwOnBackup = true;

    const backupResult = manager.createProtectiveBackup();
    expect(backupResult.success).toBe(false);
    expect(backupResult.error).toContain('Failed to create protective backup');

    // Verify existing active record is intact
    const saved = mockStorage.getItem(STORAGE_KEY);
    expect(saved).toBeDefined();
    expect(JSON.parse(saved!).metadata.title).toBe(DEMO_STATE.metadata.title);
  });

  it('allows restoring from protective backup when needed', () => {
    manager.saveWorkflow(DEMO_STATE);
    manager.createProtectiveBackup();

    // Simulate accidental overwrite
    const dummy: WorkflowStore = {
      metadata: { id: 'dummy', title: 'Overwritten', version: '1', created_at: '', owner: 'O', organisation: '', purpose: 'P', domain: '' },
      steps: [],
      reflection: { failure_modes: '', essential_judgement: '', over_reliance_risks: '', embedded_assumptions: '' }
    };
    manager.saveWorkflow(dummy);
    expect(JSON.parse(mockStorage.getItem(STORAGE_KEY)!).metadata.title).toBe('Overwritten');

    // Restore backup
    const restored = manager.restoreProtectiveBackup();
    expect(restored).toBe(true);
    expect(JSON.parse(mockStorage.getItem(STORAGE_KEY)!).metadata.title).toBe(DEMO_STATE.metadata.title);
  });

  it('gracefully handles completely disabled / unavailable storage', () => {
    const brokenStorage = {
      getItem() { throw new Error('SecurityError: Access denied'); },
      setItem() { throw new Error('SecurityError: Access denied'); },
      removeItem() { throw new Error('SecurityError: Access denied'); },
      clear() {},
      key() { return null; },
      length: 0
    } as unknown as Storage;

    const unavailableManager = new StorageManager(brokenStorage);
    expect(unavailableManager.isAvailable()).toBe(false);

    const loadResult = unavailableManager.loadWorkflow();
    expect(loadResult.success).toBe(false);
    expect(loadResult.error).toContain('Browser storage is unavailable');

    const saveResult = unavailableManager.saveWorkflow(DEMO_STATE);
    expect(saveResult.success).toBe(false);
    expect(saveResult.error).toContain('Browser storage is unavailable');
  });

  it('5. preserves and reloads incomplete working drafts on refresh without treating them as corrupted', () => {
    const workingDraft: WorkflowStore = {
      metadata: {
        id: 'draft-id-99',
        title: 'Unfinished Draft Title',
        version: '1.0.0',
        created_at: '2026-02-01T00:00:00Z',
        owner: '', // Not yet filled
        organisation: '',
        purpose: '', // Not yet filled
        domain: 'education'
      },
      steps: [
        {
          id: 'step-unnamed-1',
          name: '', // Just added via "+ Add New Step"
          type: 'human-only',
          description: 'Partial step notes',
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

    const saveRes = manager.saveWorkflow(workingDraft);
    expect(saveRes.success).toBe(true);

    // Simulate page refresh / application restart
    const loadRes = manager.loadWorkflow();
    expect(loadRes.success).toBe(true);
    expect(loadRes.rawCorrupted).toBeUndefined();
    expect(loadRes.data.metadata.id).toBe('draft-id-99');
    expect(loadRes.data.metadata.title).toBe('Unfinished Draft Title');
    expect(loadRes.data.steps.length).toBe(1);
    expect(loadRes.data.steps[0].description).toBe('Partial step notes');
  });

  it('6. prevents corrupted storage from being silently overwritten by subsequent edits until explicitly confirmed', () => {
    document.body.innerHTML = `
      <div id="app">
        <nav class="sidebar"><div class="completeness-mini"><div class="progress"></div><div class="value"></div></div></nav>
        <main class="content">
          <header class="top-bar">
            <h1 id="view-title">Dashboard</h1>
            <div id="save-status-container"><span id="save-status">Saved</span></div>
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

    const corruptPayload = '{"metadata": { "broken_json": true ';
    mockStorage.setItem(STORAGE_KEY, corruptPayload);

    const app = new App(manager);

    // Corrupted banner is shown and raw data is preserved
    expect(document.getElementById('corrupted-storage-banner')).not.toBeNull();
    expect(mockStorage.getItem(STORAGE_KEY)).toBe(corruptPayload);

    // Simulate user editing the new workflow in memory (autosave triggered)
    app.getStore().metadata.title = 'New Edit While Corrupted';
    const saveAttempt = (app as any).saveToStorage();
    expect(saveAttempt).toBe(false);

    // CRITICAL: Corrupted storage must NOT be overwritten by autosave!
    expect(mockStorage.getItem(STORAGE_KEY)).toBe(corruptPayload);
    expect(document.getElementById('save-status')?.className).toContain('status-error');

    // User can download the preserved raw corrupted data
    const downloadedRaw = app.downloadCorruptedRawData();
    expect(downloadedRaw).toBe(corruptPayload);

    // If user cancels confirmation, corrupted data is still preserved
    window.confirm = () => false;
    window.alert = () => {};
    expect(app.discardCorruptedDataAndStartFresh()).toBe(false);
    expect(mockStorage.getItem(STORAGE_KEY)).toBe(corruptPayload);

    // When user explicitly confirms discarding corrupted data, saving is unlocked and new state is persisted
    window.confirm = () => true;
    expect(app.discardCorruptedDataAndStartFresh()).toBe(true);
    expect(document.getElementById('corrupted-storage-banner')).toBeNull();
    expect(JSON.parse(mockStorage.getItem(STORAGE_KEY)!).metadata.title).toBe('New Edit While Corrupted');
  });

  it('7. preserves previous workflow and displays accurate error status when import persistence fails', () => {
    document.body.innerHTML = `
      <div id="app">
        <nav class="sidebar"><div class="completeness-mini"><div class="progress"></div><div class="value"></div></div></nav>
        <main class="content">
          <header class="top-bar">
            <h1 id="view-title">Dashboard</h1>
            <div id="save-status-container"><span id="save-status">Saved</span></div>
            <div class="top-actions"></div>
          </header>
          <div id="view-container"></div>
        </main>
      </div>
    `;

    const existingWorkflow: WorkflowStore = {
      ...JSON.parse(JSON.stringify(DEMO_STATE)),
      metadata: {
        ...DEMO_STATE.metadata,
        id: 'existing-wf-1',
        title: 'Existing Persisted Workflow'
      }
    };
    mockStorage.setItem(STORAGE_KEY, JSON.stringify(existingWorkflow));

    // Allow backup write to succeed, but fail subsequent saveWorkflow write to STORAGE_KEY
    let failMainSave = false;
    const origSetItem = mockStorage.setItem.bind(mockStorage);
    mockStorage.setItem = (key: string, val: string) => {
      if (failMainSave && key === STORAGE_KEY) {
        const err = new Error('QuotaExceededError: DOM Exception 22');
        err.name = 'QuotaExceededError';
        throw err;
      }
      origSetItem(key, val);
    };

    const app = new App(manager);
    expect(app.getStore().metadata.title).toBe('Existing Persisted Workflow');

    failMainSave = true;
    window.alert = () => {};
    window.confirm = () => true;

    const importedPayload = JSON.stringify({
      metadata: {
        workflow_title: 'Large Imported Workflow',
        workflow_owner: 'Import Owner',
        purpose: 'Testing failed import persistence'
      },
      steps: []
    });

    const importSuccess = app.importWorkflowContent(importedPayload);
    expect(importSuccess).toBe(false);

    // Previous workflow is preserved in both memory and storage, and status badge shows error (not Saved)
    expect(app.getStore().metadata.title).toBe('Existing Persisted Workflow');
    expect(JSON.parse(mockStorage.getItem(STORAGE_KEY)!).metadata.title).toBe('Existing Persisted Workflow');
    expect(document.getElementById('save-status')?.className).toContain('status-error');
  });

  it('8. protects unsaved in-memory work when persistent storage is empty, and avoids false backup claims when blank', () => {
    document.body.innerHTML = `
      <div id="app">
        <nav class="sidebar"><div class="completeness-mini"><div class="progress"></div><div class="value"></div></div></nav>
        <main class="content">
          <header class="top-bar">
            <h1 id="view-title">Dashboard</h1>
            <div id="save-status-container"><span id="save-status">Saved</span></div>
            <div class="top-actions">
              <button id="new-workflow">New</button>
            </div>
          </header>
          <div id="view-container"></div>
        </main>
      </div>
    `;

    const app = new App(manager);

    // Case A: Blank initial workflow and empty storage -> no backup needed, confirm prompt must NOT claim backup was saved
    const confirmPrompts: string[] = [];
    window.confirm = (msg?: string) => {
      if (msg) confirmPrompts.push(msg);
      return true;
    };
    window.alert = () => {};

    document.getElementById('new-workflow')?.click();
    expect(confirmPrompts[0]).toBe('Clear all data and start a new workflow?');
    expect(confirmPrompts[0]).not.toContain('protective backup');

    // Case B: Empty STORAGE_KEY, but user has meaningful unsaved in-memory work and backup fails due to quota
    mockStorage.clear();
    app.getStore().metadata.title = 'Unsaved In-Memory Work';
    mockStorage.throwOnSet = true;

    document.getElementById('new-workflow')?.click();
    // Must abort and preserve the in-memory work!
    expect(app.getStore().metadata.title).toBe('Unsaved In-Memory Work');

    // Case C: Empty STORAGE_KEY, user has meaningful unsaved in-memory work, and storage becomes available
    mockStorage.throwOnSet = false;
    const backupRes = manager.createProtectiveBackup(app.getStore());
    expect(backupRes.success).toBe(true);
    expect(backupRes.backedUp).toBe(true);
    expect(JSON.parse(mockStorage.getItem(BACKUP_KEY)!).metadata.title).toBe('Unsaved In-Memory Work');
  });
});
