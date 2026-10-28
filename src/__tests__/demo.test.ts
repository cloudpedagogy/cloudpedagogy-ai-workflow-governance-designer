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
});
