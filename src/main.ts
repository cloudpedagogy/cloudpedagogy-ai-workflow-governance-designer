import './style.css';
import {
  INITIAL_STATE,
  calculateCompleteness,
  calculateAIDependency,
  getHumanOversightIndicator,
  DEMO_STATE,
  getGovernanceSuggestions,
  detectOversightGaps,
  detectConsecutiveAISteps,
  isHighRiskStep,
  hasMeaningfulWorkflowData,
  type WorkflowStore,
  type WorkflowStep
} from './data/model';
import {
  exportToJSON,
  exportDraftToJSON,
  exportRegistryToJSON,
  exportToMarkdown,
  exportToPDF,
  generatePrintableReportHTML
} from './utils/export';
import { generateUUID } from './utils/uuid';
import { escapeHtml, escapeAttr } from './utils/security';
import {
  validateWorkflowImport,
  validateWorkflowDraft,
  validateRegistryImport
} from './utils/schema';
import { StorageManager, type WorkflowSummary } from './utils/storage';

const STEP_TYPE_LABELS: Record<string, string> = {
  'human-only': 'Human Only',
  'ai-supported': 'AI Supported',
  'ai-generated': 'AI Generated',
  'decision-point': 'Decision Point'
};

export class App {
  private store: WorkflowStore = INITIAL_STATE;
  private currentView: string = 'dashboard';
  private storageManager: StorageManager;
  private isDemoMode: boolean = false;
  private hasUnsavedChanges: boolean = false;
  private preDemoStore: WorkflowStore | null = null;
  private preDemoHadUnsavedChanges: boolean = false;
  private expandedStepIds: Set<string> = new Set();

  constructor(storageManager?: StorageManager) {
    this.storageManager = storageManager || new StorageManager();
    this.loadFromStorage();
    this.initEventListeners();
    this.render();
  }

  public getStore(): WorkflowStore {
    return this.store;
  }

  public getIsDemoMode(): boolean {
    return this.isDemoMode;
  }

  public getHasUnsavedChanges(): boolean {
    return this.hasUnsavedChanges;
  }

  public listWorkflows(): WorkflowSummary[] {
    if (!this.isDemoMode) {
      this.storageManager.syncInMemoryWorkflow(this.store, this.hasUnsavedChanges);
    }
    return this.storageManager.listWorkflows();
  }

  private loadFromStorage() {
    const result = this.storageManager.loadWorkflow();
    this.store = result.data;
    if (result.success) {
      this.hasUnsavedChanges = false;
      this.hideCorruptedBanner();
      this.updateSaveStatus('saved');
    } else {
      if (result.rawCorrupted) {
        this.hasUnsavedChanges = true;
        this.showCorruptedBanner();
        this.updateSaveStatus(
          'error',
          'Saved workflow in local storage is corrupted. Auto-save is paused until you download the raw data or confirm starting fresh.'
        );
        console.warn('Storage load corrupted:', result.error);
      } else {
        this.hasUnsavedChanges = true;
        this.updateSaveStatus('error', result.error);
      }
    }
  }

  private saveToStorage(isExplicitUserSave: boolean = false): boolean {
    if (this.isDemoMode) {
      this.hasUnsavedChanges = true;
      this.updateCompletenessUI();
      this.updateSaveStatus('demo');
      this.syncPrintableReport();
      return true;
    }

    const result = this.storageManager.saveWorkflow(this.store);
    this.updateCompletenessUI();
    this.syncPrintableReport();

    if (result.success) {
      this.hasUnsavedChanges = false;
      this.updateSaveStatus('saved');
      this.syncRegistryToolbar();
      return true;
    } else {
      this.hasUnsavedChanges = true;
      if (result.isCorruptedLocked) {
        this.showCorruptedBanner();
      }
      this.updateSaveStatus('error', result.error);
      this.syncRegistryToolbar();
      if (isExplicitUserSave) {
        alert(
          `${result.error}\n\nRecovery Guidance: Open the "Export" tab in the sidebar and click "Export Draft / Recovery JSON" (or "Export Registry Backup") to save your work safely.`
        );
      }
      return false;
    }
  }

  private updateSaveStatus(status: 'saved' | 'unsaved' | 'demo' | 'error', customMsg?: string) {
    const el = document.getElementById('save-status');
    if (!el) return;

    el.className = 'save-status-badge';

    if (this.isDemoMode && status !== 'error') {
      el.classList.add('status-demo');
      el.textContent = 'Demo Mode (In-Memory Only)';
      el.title = 'Changes exist in memory only and will not overwrite your saved workflow.';
      return;
    }

    switch (status) {
      case 'saved':
        el.classList.add('status-saved');
        el.textContent = '✓ Saved';
        el.title = 'All changes saved to local storage.';
        break;
      case 'unsaved':
        el.classList.add('status-unsaved');
        el.textContent = '● Unsaved in Memory';
        el.title = customMsg || 'You have unsaved changes in memory that are not yet persisted.';
        break;
      case 'demo':
        el.classList.add('status-demo');
        el.textContent = 'Demo Mode (In-Memory Only)';
        el.title = 'Changes exist in memory only and will not overwrite your saved workflow.';
        break;
      case 'error':
        el.classList.add('status-error');
        el.textContent = '⚠️ Unsaved in Memory — Storage Error (Export JSON recommended)';
        el.title = customMsg || 'Storage failure. Changes exist in memory only; use the Export tab to save your workflow.';
        break;
    }
  }

  private showCorruptedBanner() {
    let banner = document.getElementById('corrupted-storage-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'corrupted-storage-banner';
      banner.setAttribute('role', 'alert');
      banner.innerHTML = `
        <div class="demo-banner-content">
          <strong>Corrupted Local Storage Detected:</strong> Unrecoverable data was found in browser storage. Auto-save is paused so your stored data is not silently overwritten.
        </div>
        <div class="demo-banner-actions">
          <button type="button" id="download-corrupted-raw" class="btn btn-sm btn-primary-light" aria-label="Download preserved corrupted raw data">Download Raw Data</button>
          <button type="button" id="discard-corrupted-storage" class="btn btn-sm btn-secondary-light" aria-label="Discard corrupted data and enable saving">Discard &amp; Start Fresh</button>
        </div>
      `;
      document.querySelector('.content')?.prepend(banner);

      document.getElementById('download-corrupted-raw')?.addEventListener('click', () => {
        this.downloadCorruptedRawData();
      });

      document.getElementById('discard-corrupted-storage')?.addEventListener('click', () => {
        this.discardCorruptedDataAndStartFresh();
      });
    }
  }

  private hideCorruptedBanner() {
    document.getElementById('corrupted-storage-banner')?.remove();
  }

  public downloadCorruptedRawData(): string | null {
    const raw = this.storageManager.getCorruptedRawData();
    if (!raw) {
      alert('No corrupted raw data is currently held in storage.');
      return null;
    }
    const dataUri = 'data:text/plain;charset=utf-8,' + encodeURIComponent(raw);
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', 'corrupted-workflow-raw.json');
    linkElement.click();
    return raw;
  }

  public discardCorruptedDataAndStartFresh(): boolean {
    if (!this.storageManager.isCorruptedStorageLocked()) {
      this.hideCorruptedBanner();
      return true;
    }

    if (
      !confirm(
        'Discard the unrecoverable stored data in local storage and start fresh with the current workflow? This will permanently overwrite the corrupted record.'
      )
    ) {
      return false;
    }

    const result = this.storageManager.discardCorruptedDataAndSave(this.store);
    if (result.success) {
      this.hasUnsavedChanges = false;
      this.hideCorruptedBanner();
      this.updateSaveStatus('saved');
      this.render();
      alert('Corrupted storage cleared. Your current workflow is now saved.');
      return true;
    } else {
      this.hasUnsavedChanges = true;
      this.updateSaveStatus('error', result.error);
      alert(
        `Failed to overwrite corrupted storage data:\n${result.error}\n\nOpen the "Export" tab and click "Export Draft / Recovery JSON" to save your work to disk.`
      );
      return false;
    }
  }

  private syncRestoreBackupButton() {
    const topActions = document.querySelector('.top-actions');
    if (!topActions) return;

    const existingBtn = document.getElementById('restore-backup');
    if (this.storageManager.hasProtectiveBackup()) {
      if (!existingBtn) {
        const btn = document.createElement('button');
        btn.id = 'restore-backup';
        btn.type = 'button';
        btn.className = 'btn btn-secondary';
        btn.setAttribute('aria-label', 'Restore previous workflow from protective backup');
        btn.textContent = 'Restore Backup';
        btn.addEventListener('click', () => {
          this.restoreFromBackup();
        });
        topActions.appendChild(btn);
      }
    } else if (existingBtn) {
      existingBtn.remove();
    }
  }

  private syncRegistryToolbar() {
    const contentEl = document.querySelector('.content');
    const viewContainer = document.getElementById('view-container');
    if (!contentEl || !viewContainer) return;

    let toolbar = document.getElementById('workflow-registry-bar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = 'workflow-registry-bar';
      toolbar.className = 'workflow-registry-bar';
      toolbar.setAttribute('role', 'region');
      toolbar.setAttribute('aria-label', 'Workflow Registry Controls');
      contentEl.insertBefore(toolbar, viewContainer);
    }

    const activeEl = document.activeElement as HTMLElement | null;
    const focusedToolbarElementId =
      activeEl && toolbar.contains(activeEl) && activeEl.id ? activeEl.id : null;

    if (!this.isDemoMode) {
      this.storageManager.syncInMemoryWorkflow(this.store, this.hasUnsavedChanges);
    }
    const workflows = this.storageManager.listWorkflows();
    const activeId = this.store.metadata.id;

    toolbar.innerHTML = `
      <div class="registry-selector-group">
        <label for="workflow-switcher" class="registry-label">Active Workflow (${workflows.length}):</label>
        <select id="workflow-switcher" aria-label="Switch active workflow" ${this.isDemoMode ? 'disabled' : ''}>
          ${workflows
            .map(wf => {
              const label = `${wf.title || 'Untitled Workflow'}${wf.hasUnsavedChanges ? ' ● (Unsaved)' : ''}`;
              const selected = !this.isDemoMode && wf.id === activeId ? 'selected' : '';
              return `<option value="${escapeAttr(wf.id)}" ${selected}>${escapeHtml(label)}</option>`;
            })
            .join('')}
        </select>
      </div>
      <div class="registry-actions-group">
        <button id="create-workflow-btn" type="button" class="btn btn-secondary btn-sm" aria-label="Create workflow in registry" ${this.isDemoMode ? 'disabled' : ''}>+ Create Workflow</button>
        <button id="duplicate-workflow-btn" type="button" class="btn btn-secondary btn-sm" aria-label="Duplicate active workflow" ${this.isDemoMode ? 'disabled' : ''}>Duplicate</button>
        <button id="rename-workflow-btn" type="button" class="btn btn-secondary btn-sm" aria-label="Rename active workflow" ${this.isDemoMode ? 'disabled' : ''}>Rename</button>
        <button id="delete-workflow-btn" type="button" class="btn btn-secondary btn-sm" aria-label="Delete active workflow" ${this.isDemoMode ? 'disabled' : ''}>Delete</button>
      </div>
    `;

    const switcher = document.getElementById('workflow-switcher') as HTMLSelectElement | null;
    switcher?.addEventListener('change', (e) => {
      const targetId = (e.target as HTMLSelectElement).value;
      if (targetId && targetId !== this.store.metadata.id) {
        this.switchWorkflow(targetId);
      }
    });

    document.getElementById('create-workflow-btn')?.addEventListener('click', () => {
      this.createWorkflowInRegistry();
    });

    document.getElementById('duplicate-workflow-btn')?.addEventListener('click', () => {
      this.duplicateCurrentWorkflow();
    });

    document.getElementById('rename-workflow-btn')?.addEventListener('click', () => {
      this.renameCurrentWorkflow();
    });

    document.getElementById('delete-workflow-btn')?.addEventListener('click', () => {
      this.deleteWorkflowById(this.store.metadata.id);
    });

    if (focusedToolbarElementId) {
      const restoredFocusEl = document.getElementById(focusedToolbarElementId) as
        | HTMLSelectElement
        | HTMLButtonElement
        | null;
      if (restoredFocusEl && !restoredFocusEl.disabled) {
        restoredFocusEl.focus();
      }
    }
  }

  public createWorkflowInRegistry(initialTitle: string = ''): boolean {
    if (this.isDemoMode) {
      alert('Exit Demo Mode first before creating a new workflow in your registry.');
      return false;
    }

    if (this.storageManager.isCorruptedStorageLocked()) {
      this.updateSaveStatus(
        'error',
        'Local storage contains unrecovered corrupted data. Resolve or download the corrupted data before modifying the registry.'
      );
      alert(
        'Cannot create workflow: Local storage contains unrecovered corrupted data. Resolve or download the corrupted data first.'
      );
      return false;
    }

    const res = this.storageManager.createWorkflowInRegistry(
      initialTitle,
      this.store,
      this.hasUnsavedChanges
    );
    this.store = res.activeWorkflow;
    this.expandedStepIds.clear();

    if (res.success && res.persisted) {
      this.hasUnsavedChanges = false;
      this.updateSaveStatus('saved');
      this.render();
      return true;
    } else {
      this.hasUnsavedChanges = true;
      this.updateSaveStatus('error', res.error);
      this.render();
      alert(
        `New workflow created in memory only, as local storage could not be updated:\n${res.error}\n\nUse the "Export" tab to export your work.`
      );
      return false;
    }
  }

  public switchWorkflow(targetId: string): boolean {
    if (this.isDemoMode) {
      alert('Exit Demo Mode before switching between saved workflows.');
      return false;
    }

    const res = this.storageManager.switchWorkflow(targetId, this.store, this.hasUnsavedChanges);
    if (!res.success) {
      alert(res.error || 'Could not switch to the selected workflow.');
      return false;
    }

    this.store = res.activeWorkflow;
    this.expandedStepIds.clear();
    this.hasUnsavedChanges = Boolean(res.hasUnsavedChanges);

    if (res.activeSwitchPersistFailed || res.error) {
      this.updateSaveStatus('error', res.error);
    } else if (this.hasUnsavedChanges) {
      this.updateSaveStatus('unsaved');
    } else {
      this.updateSaveStatus('saved');
    }

    this.render();
    return true;
  }

  public duplicateCurrentWorkflow(): boolean {
    if (this.isDemoMode) {
      return this.saveDemoAsMyWorkflow();
    }

    if (this.storageManager.isCorruptedStorageLocked()) {
      this.updateSaveStatus(
        'error',
        'Local storage contains unrecovered corrupted data. Resolve or download the corrupted data before duplicating.'
      );
      alert('Cannot duplicate workflow while corrupted storage data is locked.');
      return false;
    }

    const res = this.storageManager.duplicateWorkflow(
      this.store.metadata.id,
      this.store,
      this.hasUnsavedChanges
    );

    if (!res.success) {
      this.updateSaveStatus('error', res.error);
      alert(
        `Failed to duplicate workflow in local storage:\n${res.error}\n\nYour current workflow remains untouched.`
      );
      return false;
    }

    this.store = res.activeWorkflow;
    this.expandedStepIds.clear();
    this.hasUnsavedChanges = false;
    this.updateSaveStatus('saved');
    this.render();
    return true;
  }

  public renameCurrentWorkflow(providedTitle?: string): boolean {
    if (this.isDemoMode) {
      alert('Exit Demo Mode or save the demo as your own workflow before renaming.');
      return false;
    }

    let nextTitle = providedTitle;
    if (nextTitle === undefined) {
      const prompted =
        typeof window !== 'undefined' && typeof window.prompt === 'function'
          ? window.prompt('Enter a new title for this workflow:', this.store.metadata.title || '')
          : null;
      if (prompted === null) {
        return false;
      }
      nextTitle = prompted;
    }

    const trimmed = nextTitle.trim();
    if (!trimmed) {
      alert('Workflow title cannot be empty when renaming.');
      return false;
    }

    const res = this.storageManager.renameWorkflow(
      this.store.metadata.id,
      trimmed,
      this.store,
      this.hasUnsavedChanges
    );

    if (!res.success) {
      this.updateSaveStatus('error', res.error);
      alert(`Failed to rename workflow in local storage:\n${res.error}`);
      return false;
    }

    this.store = res.activeWorkflow;
    this.hasUnsavedChanges = Boolean(res.hasUnsavedChanges);
    this.updateSaveStatus(this.hasUnsavedChanges ? 'unsaved' : 'saved');
    this.render();
    return true;
  }

  public deleteWorkflowById(targetId?: string): boolean {
    if (this.isDemoMode) {
      alert('Exit Demo Mode before deleting workflows from your registry.');
      return false;
    }

    const idToDelete = targetId || this.store.metadata.id;
    const targetWf =
      idToDelete === this.store.metadata.id
        ? this.store
        : this.storageManager.getWorkflowById(idToDelete);

    if (!targetWf) {
      alert('Workflow not found in registry.');
      return false;
    }

    const titleDisplay = targetWf.metadata.title || 'Untitled Workflow';
    if (
      !confirm(
        `Delete workflow "${titleDisplay}" from the registry? A protective backup of this workflow will be created first.`
      )
    ) {
      return false;
    }

    const res = this.storageManager.deleteWorkflow(idToDelete, this.store, this.hasUnsavedChanges);
    if (!res.success) {
      this.updateSaveStatus('error', res.error);
      this.syncRestoreBackupButton();
      alert(
        `Cannot delete workflow "${titleDisplay}":\n${res.error}\n\nYour workflow has been preserved.`
      );
      return false;
    }

    this.store = res.activeWorkflow;
    this.expandedStepIds.clear();
    this.hasUnsavedChanges = Boolean(res.hasUnsavedChanges);
    this.updateSaveStatus(this.hasUnsavedChanges ? 'unsaved' : 'saved');
    this.render();
    return true;
  }

  public restoreFromBackup(): boolean {
    if (!this.storageManager.hasProtectiveBackup()) {
      alert('No valid protective backup is available to restore.');
      return false;
    }

    if (
      !confirm(
        'Restore your previous workflow from the protective backup? This will replace the current workflow in memory and local storage.'
      )
    ) {
      return false;
    }

    const restoreResult = this.storageManager.restoreProtectiveBackupWithFallback();
    if (!restoreResult.success || !restoreResult.data) {
      this.updateSaveStatus('error', restoreResult.error || 'Failed to restore workflow from protective backup.');
      this.syncRestoreBackupButton();
      alert(`Failed to restore protective backup: ${restoreResult.error || 'Storage error.'}`);
      return false;
    }

    if (restoreResult.persisted) {
      this.isDemoMode = false;
      this.preDemoStore = null;
      this.preDemoHadUnsavedChanges = false;
      this.hideDemoBanner();
      this.hideCorruptedBanner();
      this.store = restoreResult.data;
      this.expandedStepIds.clear();
      this.hasUnsavedChanges = false;
      this.updateSaveStatus('saved');
      this.render();
      alert(`Restored workflow "${this.store.metadata.title || 'Untitled Draft'}" from protective backup.`);
      return true;
    }

    // Active localStorage write failed, but the validated backup is available for safe in-memory recovery
    const recoverInMemory = confirm(
      `Active local storage could not be updated (${restoreResult.error}).\n\nWould you like to recover the backup workflow into memory so you can view and export it?`
    );
    if (!recoverInMemory) {
      this.updateSaveStatus('error', restoreResult.error);
      this.syncRestoreBackupButton();
      return false;
    }

    this.store = restoreResult.data;
    this.expandedStepIds.clear();
    this.isDemoMode = false;
    this.preDemoStore = null;
    this.preDemoHadUnsavedChanges = false;
    this.hasUnsavedChanges = true;
    this.hideDemoBanner();
    this.updateSaveStatus(
      'error',
      `Backup recovered in memory only (unsaved in local storage): ${restoreResult.error}`
    );
    this.render();
    alert(
      `Workflow "${this.store.metadata.title || 'Untitled Draft'}" recovered into memory only (could not persist to local storage: ${restoreResult.error}).\n\nYour workflow is currently UNSAVED. Open the "Export" tab and click "Export Draft / Recovery JSON" immediately.`
    );
    return true;
  }

  private showDemoBanner() {
    let banner = document.getElementById('demo-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'demo-banner';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      banner.innerHTML = `
        <div class="demo-banner-content">
          <strong>Demo Example (In-Memory Only):</strong> You are exploring pre-filled workflow data. Your saved workflows are not overwritten.
        </div>
        <div class="demo-banner-actions">
          <button id="save-demo-copy" type="button" class="btn btn-sm btn-primary-light" aria-label="Save copy as your own workflow">Save Copy as My Workflow</button>
          <button id="exit-demo" type="button" class="btn btn-sm btn-secondary-light" aria-label="Exit demo mode and return to your saved workflow">Exit Demo</button>
        </div>
      `;
      document.querySelector('.content')?.prepend(banner);

      document.getElementById('save-demo-copy')?.addEventListener('click', () => {
        this.saveDemoAsMyWorkflow();
      });

      document.getElementById('exit-demo')?.addEventListener('click', () => {
        this.exitDemoMode();
      });
    }
  }

  private hideDemoBanner() {
    document.getElementById('demo-banner')?.remove();
  }

  private saveDemoAsMyWorkflow(): boolean {
    const hasExistingWork =
      hasMeaningfulWorkflowData(this.preDemoStore) ||
      this.storageManager.wouldCreateBackup(this.preDemoStore || undefined);
    const divergent = this.storageManager.hasDivergentUnsavedWork(this.preDemoStore || undefined);

    let confirmPrompt: string;
    if (divergent) {
      confirmPrompt =
        'Save this demo copy as your active workflow? This will replace your existing workflow. Note: your pre-demo workflow has unsaved in-memory edits that differ from your last saved version; the single protective backup slot will preserve your latest unsaved pre-demo version (not both versions). Use "Export Draft / Recovery JSON" first if you require both.';
    } else if (hasExistingWork) {
      confirmPrompt =
        'Save this demo copy as your active workflow? This will replace your existing workflow in local storage (a protective backup of your previous workflow will be created first).';
    } else {
      confirmPrompt = 'Save this demo copy as your own workflow in local storage?';
    }

    if (!confirm(confirmPrompt)) {
      return false;
    }

    // Create and verify protective backup of the original workflow before replacing
    const backupResult = this.storageManager.createProtectiveBackup(this.preDemoStore || undefined);
    if (!backupResult.success) {
      this.updateSaveStatus('error', backupResult.error);
      this.syncRestoreBackupButton();
      alert(
        `Cannot replace existing workflow: Protective backup failed (${backupResult.error}).\n\nYour existing workflow has not been modified. You can export your demo copy from the "Export" tab.`
      );
      return false;
    }

    if (this.preDemoStore && hasMeaningfulWorkflowData(this.preDemoStore)) {
      this.storageManager.syncInMemoryWorkflow(this.preDemoStore, this.preDemoHadUnsavedChanges);
    }

    // Prepare candidate workflow copy with a fresh UUID
    const candidateStore: WorkflowStore = JSON.parse(JSON.stringify(this.store));
    candidateStore.metadata.id = generateUUID();
    candidateStore.metadata.created_at = new Date().toISOString();

    const saveResult = this.storageManager.saveWorkflow(candidateStore);

    if (saveResult.success) {
      this.store = candidateStore;
      this.isDemoMode = false;
      this.preDemoStore = null;
      this.preDemoHadUnsavedChanges = false;
      this.hasUnsavedChanges = false;
      this.hideDemoBanner();
      this.updateSaveStatus('saved');
      this.render();
      alert(
        `Workflow "${this.store.metadata.title}" saved as your own workflow.${
          backupResult.backedUp ? ' A protective backup of your previous workflow was saved.' : ''
        }`
      );
      return true;
    } else {
      const rollback = this.storageManager.rollbackProtectiveBackup(backupResult.previousBackup);
      this.hasUnsavedChanges = true;
      this.updateSaveStatus('error', saveResult.error);
      this.syncRestoreBackupButton();
      this.renderView();

      const rollbackNotice = !rollback.rolledBack && rollback.error ? `\n\nBackup note: ${rollback.error}` : '';
      alert(
        `Failed to save demo copy to local storage:\n${saveResult.error}${rollbackNotice}\n\nYou remain in Demo Mode: your demo edits are still in memory (exportable via the "Export" tab) and you can click "Exit Demo" to return to your previous workflow.`
      );
      return false;
    }
  }

  private exitDemoMode() {
    if (this.hasUnsavedChanges) {
      if (
        !confirm(
          'Exit demo mode? Any in-memory demo edits will be discarded, and your previous workflow will be restored.'
        )
      ) {
        return;
      }
    }
    this.isDemoMode = false;
    this.hideDemoBanner();

    if (this.preDemoStore) {
      this.store = JSON.parse(JSON.stringify(this.preDemoStore));
      this.hasUnsavedChanges = this.preDemoHadUnsavedChanges;
      this.preDemoStore = null;
      this.preDemoHadUnsavedChanges = false;
      this.storageManager.syncInMemoryWorkflow(this.store, this.hasUnsavedChanges);

      if (this.storageManager.isCorruptedStorageLocked()) {
        this.showCorruptedBanner();
        this.updateSaveStatus('error', 'Saved workflow in local storage is corrupted.');
      } else if (this.hasUnsavedChanges) {
        this.updateSaveStatus('unsaved');
      } else {
        this.updateSaveStatus('saved');
      }
    } else {
      this.loadFromStorage();
    }
    this.render();
  }

  private initEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        const view = target.dataset.view;
        if (view) {
          this.switchView(view);
        }
      });
    });

    // Top Actions
    document.getElementById('save-workflow')?.addEventListener('click', () => {
      if (this.isDemoMode) {
        this.saveDemoAsMyWorkflow();
        return;
      }

      const success = this.saveToStorage(true);
      if (success) {
        alert('Workflow saved locally.');
      }
    });

    document.getElementById('import-workflow')?.addEventListener('click', () => {
      this.importJSON();
    });

    document.getElementById('load-demo')?.addEventListener('click', () => {
      const hasUnsavedWork = !this.isDemoMode && this.hasUnsavedChanges && hasMeaningfulWorkflowData(this.store);
      const promptMsg = hasUnsavedWork
        ? 'You have unsaved changes in memory. Loading the healthcare demo will hold your current workflow in memory while you explore the demo, but unsaved changes will be lost if you refresh the page or replace your workflow with the demo. Load healthcare demo?'
        : 'Load healthcare demo? This will load a pre-filled example in memory. Your saved work will NOT be overwritten unless you click "Save Copy as My Workflow".';

      if (confirm(promptMsg)) {
        if (!this.isDemoMode) {
          this.storageManager.syncInMemoryWorkflow(this.store, this.hasUnsavedChanges);
          this.preDemoStore = JSON.parse(JSON.stringify(this.store));
          this.preDemoHadUnsavedChanges = this.hasUnsavedChanges;
        }
        this.store = JSON.parse(JSON.stringify(DEMO_STATE));
        this.isDemoMode = true;
        this.hasUnsavedChanges = false;
        this.render();
        this.showDemoBanner();
        this.updateSaveStatus('demo');
      }
    });

    document.getElementById('new-workflow')?.addEventListener('click', () => {
      if (this.storageManager.isCorruptedStorageLocked()) {
        this.updateSaveStatus(
          'error',
          'Local storage contains unrecovered corrupted data. Resolve or download the corrupted data before replacing the workflow.'
        );
        alert(
          'Cannot create new workflow: Local storage contains unrecovered corrupted data. Resolve or download the corrupted data first.'
        );
        return;
      }

      const backupTarget = this.isDemoMode && this.preDemoStore ? this.preDemoStore : this.store;
      const willBackup = this.storageManager.wouldCreateBackup(backupTarget);
      const divergent = this.storageManager.hasDivergentUnsavedWork(backupTarget);

      let confirmMsg: string;
      if (divergent) {
        confirmMsg =
          'Clear all data and start a new workflow? You have unsaved in-memory edits that differ from your last saved workflow: the single protective backup slot will preserve your latest unsaved in-memory version (not both versions). Cancel and use "Export Draft / Recovery JSON" first if you need both.';
      } else if (willBackup) {
        confirmMsg =
          'Clear all data and start a new workflow? A protective backup of your previous workflow has been saved.';
      } else {
        confirmMsg = 'Clear all data and start a new workflow?';
      }

      if (!confirm(confirmMsg)) {
        return;
      }

      const backupResult = this.storageManager.createProtectiveBackup(backupTarget);
      if (!backupResult.success) {
        this.updateSaveStatus('error', backupResult.error);
        this.syncRestoreBackupButton();
        alert(
          `Cannot create new workflow: Protective backup failed (${backupResult.error}).\n\nOpen the "Export" tab and click "Export Draft / Recovery JSON" first to prevent data loss.`
        );
        return;
      }

      if (backupTarget && hasMeaningfulWorkflowData(backupTarget)) {
        this.storageManager.syncInMemoryWorkflow(
          backupTarget,
          this.isDemoMode ? this.preDemoHadUnsavedChanges : this.hasUnsavedChanges
        );
      }

      const newStore: WorkflowStore = JSON.parse(JSON.stringify(INITIAL_STATE));
      newStore.metadata.id = generateUUID();
      newStore.metadata.created_at = new Date().toISOString();

      const saveResult = this.storageManager.saveWorkflow(newStore);
      if (!saveResult.success) {
        const rollback = this.storageManager.rollbackProtectiveBackup(backupResult.previousBackup);
        this.updateSaveStatus('error', saveResult.error);
        this.syncRestoreBackupButton();
        const rollbackNotice = !rollback.rolledBack && rollback.error ? `\n\nBackup note: ${rollback.error}` : '';
        alert(
          `Cannot create new workflow because local storage could not be updated:\n${saveResult.error}${rollbackNotice}\n\nYour previous workflow has been preserved.`
        );
        return;
      }

      this.store = newStore;
      this.expandedStepIds.clear();
      this.isDemoMode = false;
      this.preDemoStore = null;
      this.preDemoHadUnsavedChanges = false;
      this.hasUnsavedChanges = false;
      this.hideDemoBanner();
      this.updateSaveStatus('saved');
      this.render();
    });
  }

  private switchView(view: string) {
    this.currentView = view;
    document.querySelectorAll('.nav-item').forEach(btn => {
      const isActive = (btn as HTMLButtonElement).dataset.view === view;
      btn.classList.toggle('active', isActive);
      if (isActive) {
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.removeAttribute('aria-current');
      }
    });

    const titleMap: Record<string, string> = {
      dashboard: 'Dashboard',
      'workflow-context': 'Workflow Context',
      'workflow-builder': 'Step Builder',
      'governance-panel': 'Governance Controls',
      'reflection-layer': 'Reflection Layer',
      'export-panel': 'Export & Artifacts'
    };

    const titleEl = document.getElementById('view-title');
    if (titleEl) titleEl.textContent = titleMap[view] || 'Designer';

    this.renderView();
  }

  private updateCompletenessUI() {
    const completeness = calculateCompleteness(this.store);
    const progressEl = document.querySelector('.progress') as HTMLElement;
    const valueEl = document.querySelector('.completeness-mini .value') as HTMLElement;

    if (progressEl) progressEl.style.width = `${completeness}%`;
    if (valueEl) valueEl.textContent = `${completeness}%`;
  }

  private renderView() {
    const container = document.getElementById('view-container');
    if (!container) return;

    container.innerHTML = '';

    switch (this.currentView) {
      case 'dashboard':
        container.innerHTML = this.renderDashboard();
        break;
      case 'workflow-context':
        container.innerHTML = this.renderContextForm();
        this.attachContextEvents();
        break;
      case 'workflow-builder':
        container.innerHTML = this.renderStepBuilder();
        this.attachStepEvents();
        break;
      case 'governance-panel':
        container.innerHTML = this.renderGovernancePanel();
        this.attachGovernanceEvents();
        break;
      case 'reflection-layer':
        container.innerHTML = this.renderReflectionLayer();
        this.attachReflectionEvents();
        break;
      case 'export-panel':
        container.innerHTML = this.renderExportPanel();
        this.attachExportEvents();
        break;
    }
  }

  private renderDashboard() {
    const completeness = calculateCompleteness(this.store);
    const dependency = calculateAIDependency(this.store);
    const suggestions = getGovernanceSuggestions(this.store);
    const consecutiveClusters = detectConsecutiveAISteps(this.store);
    const gaps = detectOversightGaps(this.store);

    return `
      <div class="dash-grid">
        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Governance Completeness</span>
          </div>
          <div class="metric-value">${completeness}%</div>
          <div class="progress-bar">
            <div class="progress" style="width: ${completeness}%"></div>
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">AI Dependency Map</span>
          </div>
          <div class="metric-value">${dependency}%</div>
          <p class="metric-title">${dependency > 50 ? 'High concentration of AI reliance detected.' : 'Balanced human-AI collaboration.'}</p>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Workflow Steps</span>
          </div>
          <div class="metric-value">${this.store.steps.length}</div>
          <p class="metric-title">${escapeHtml(this.store.metadata.title) || 'Untitled Workflow'}</p>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Oversight Gaps</span>
          </div>
          <div class="metric-value">${getHumanOversightIndicator(this.store).count}</div>
          <p class="metric-title">${getHumanOversightIndicator(this.store).count > 0 ? 'Steps requiring additional oversight.' : 'All high-risk steps governed.'}</p>
        </div>
      </div>

      <div class="section" style="margin-top: 32px">
        <h2>Governance Insights</h2>
        <div class="insights-grid">
          <div class="insight-group">
            <h3 style="font-size: 14px; margin-bottom: 12px; color: var(--text-primary)">Design-Time Suggestions</h3>
            <ul style="list-style: none; padding: 0; margin: 0; font-size: 13px">
              ${suggestions.length > 0 ? suggestions.map(s => `
                <li style="padding: 10px; background: ${s.type === 'warning' ? '#FFFBEB' : '#F0F9FF'}; border-left: 3px solid ${s.type === 'warning' ? '#F59E0B' : '#0EA5E9'}; margin-bottom: 8px; border-radius: 4px; color: ${s.type === 'warning' ? '#92400E' : '#0369A1'}">
                  <strong>${escapeHtml(s.type.toUpperCase())}:</strong> ${escapeHtml(s.message)}
                </li>
              `).join('') : '<li style="color: var(--text-muted); font-style: italic">No immediate suggestions.</li>'}
            </ul>
          </div>
          <div class="insight-group">
            <h3 style="font-size: 14px; margin-bottom: 12px; color: var(--text-primary)">Workflow Pattern Analysis</h3>
            <div class="pattern-item" style="font-size: 13px; margin-bottom: 16px">
              <span style="display: block; font-weight: 600; margin-bottom: 4px">Consecutive AI Steps:</span>
              <span style="color: ${consecutiveClusters.length > 0 ? '#B91C1C' : '#059669'}">
                ${consecutiveClusters.length > 0 ? `Detected ${consecutiveClusters.length} sequence(s) of consecutive AI reliance.` : 'No excessive AI reliance clusters detected.'}
              </span>
            </div>
            <div class="pattern-item" style="font-size: 13px">
              <span style="display: block; font-weight: 600; margin-bottom: 4px">Oversight Completeness:</span>
              <span style="color: ${gaps.length > 0 ? '#B91C1C' : '#059669'}">
                ${gaps.length > 0 ? `Found ${gaps.length} AI steps with zero human oversight.` : 'All AI steps have defined oversight levels.'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="section" style="margin-top: 32px">
        <h2>Capability Intent</h2>
        <p>This workflow aims to operationalise governed AI involvement through explicit traceability and accountability.</p>
        <div class="cdd-pills" style="display: flex; gap: 8px; margin-top: 16px">
          <span class="step-type-pill">Traceability</span>
          <span class="step-type-pill">Accountability</span>
          <span class="step-type-pill">Risk Awareness</span>
        </div>
      </div>
    `;
  }

  private renderContextForm() {
    const { metadata } = this.store;
    return `
      <div class="section section-hero">
        <h2>Workflow Context Definition</h2>
        <p>Define the foundational purpose and organizational context for this automated workflow.</p>
        
        <form id="context-form">
          <div class="form-group">
            <label for="title">Workflow Title</label>
            <input type="text" id="title" aria-label="Workflow Title" value="${escapeAttr(metadata.title)}" placeholder="e.g. Automated Student Feedback Loop">
          </div>
          
          <div class="grid-2">
            <div class="form-group">
              <label for="owner">Workflow Owner</label>
              <input type="text" id="owner" aria-label="Workflow Owner" value="${escapeAttr(metadata.owner)}" placeholder="e.g. Head of AI Governance">
            </div>
            <div class="form-group">
              <label for="organisation">Organisation</label>
              <input type="text" id="organisation" aria-label="Organisation" value="${escapeAttr(metadata.organisation)}" placeholder="e.g. Global Health Initiative">
            </div>
          </div>

          <div class="form-group">
            <label for="purpose">Primary Purpose</label>
            <textarea id="purpose" aria-label="Primary Purpose" rows="3" placeholder="Describe what this workflow achieves...">${escapeHtml(metadata.purpose)}</textarea>
          </div>

          <div class="grid-2">
            <div class="form-group">
              <label for="domain">Domain</label>
              <select id="domain" aria-label="Domain">
                <option value="education" ${metadata.domain === 'education' ? 'selected' : ''}>Education</option>
                <option value="research" ${metadata.domain === 'research' ? 'selected' : ''}>Research</option>
                <option value="policy" ${metadata.domain === 'policy' ? 'selected' : ''}>Policy</option>
                <option value="operations" ${metadata.domain === 'operations' ? 'selected' : ''}>Operations</option>
              </select>
            </div>
            <div class="form-group">
              <label for="version">Version</label>
              <input type="text" id="version" aria-label="Version" value="${escapeAttr(metadata.version)}">
            </div>
          </div>
        </form>

        <details class="section" style="margin-top: 32px; border: 1px solid var(--border-color); border-radius: 8px; padding: 0;">
          <summary style="padding: 16px; cursor: pointer; font-weight: 600; font-size: 14px; color: var(--text-secondary);">
            Capability & Governance Notes (Optional)
          </summary>
          <div style="padding: 16px; border-top: 1px solid var(--border-color); background: #fafafa;">
            <div class="form-group">
              <label for="capabilityNotes" style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted);">AI Capability Notes</label>
              <textarea id="capabilityNotes" aria-label="AI Capability Notes" rows="2" style="font-size: 13px; font-family: inherit;" placeholder="How does this workflow develop AI capability?">${escapeHtml(metadata.capabilityNotes || '')}</textarea>
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label for="governanceNotes" style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted);">AI Governance Notes</label>
              <textarea id="governanceNotes" aria-label="AI Governance Notes" rows="2" style="font-size: 13px; font-family: inherit;" placeholder="Key governance considerations for this workflow...">${escapeHtml(metadata.governanceNotes || '')}</textarea>
            </div>
          </div>
        </details>
      </div>
    `;
  }

  private attachContextEvents() {
    const form = document.getElementById('context-form');
    form?.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const key = target.id as keyof typeof this.store.metadata;
      if (key in this.store.metadata || key === 'capabilityNotes' || key === 'governanceNotes') {
        (this.store.metadata as any)[key] = target.value;
        this.saveToStorage();
      }
    });

    document.getElementById('capabilityNotes')?.addEventListener('input', (e) => {
      this.store.metadata.capabilityNotes = (e.target as HTMLTextAreaElement).value;
      this.saveToStorage();
    });

    document.getElementById('governanceNotes')?.addEventListener('input', (e) => {
      this.store.metadata.governanceNotes = (e.target as HTMLTextAreaElement).value;
      this.saveToStorage();
    });
  }

  private renderStepBuilder() {
    return `
      <div class="section-actions" style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap">
        <p style="color: var(--text-secondary)">Define the sequence of human and AI actions in this workflow.</p>
        <button type="button" id="add-step" class="btn btn-primary" aria-label="Add new workflow step">+ Add New Step</button>
      </div>
      
      <div id="steps-list">
        ${this.store.steps.map((step, index) => {
          const isHighRisk = isHighRiskStep(step);
          const hasGaps = (step.type === 'ai-generated' || step.type === 'ai-supported') && step.human_oversight.oversight_level === 'none';
          
          return this.renderStepItem(step, index, isHighRisk, hasGaps);
        }).join('')}
      </div>

      ${this.store.steps.length === 0 ? `
        <div class="section" style="text-align: center; padding: 60px">
          <p style="color: var(--text-secondary)">No steps defined yet. Start by adding your first workflow step.</p>
        </div>
      ` : ''}
    `;
  }

  private renderStepHeaderBadgesHtml(step: WorkflowStep, index: number): string {
    const isHighRisk = isHighRiskStep(step);
    const hasGaps =
      (step.type === 'ai-generated' || step.type === 'ai-supported') &&
      step.human_oversight.oversight_level === 'none';
    const isUnapprovedDecision = step.type === 'decision-point' && !step.controls.approval_required;
    const isApprovedDecision = step.type === 'decision-point' && Boolean(step.controls.approval_required);

    return `
      <span class="step-number" style="font-weight: 700; color: var(--text-muted)">${index + 1}</span>
      <span class="step-title-text" style="font-weight: 600">${escapeHtml(step.name || 'Untitled Step')}</span>
      <span class="step-type-pill">${escapeHtml(STEP_TYPE_LABELS[step.type] || step.type)}</span>
      ${isHighRisk ? '<span class="step-type-pill badge-high-risk" style="background: #FEE2E2; color: #991B1B; border: 1px solid #FECACA">⚠️ High Risk</span>' : ''}
      ${step.human_oversight.intervention_points ? '<span class="step-type-pill badge-intervention" style="background: #E0F2FE; color: #075985; border: 1px solid #BAE6FD">🔗 Intervention Pt</span>' : ''}
      ${hasGaps ? '<span class="step-type-pill badge-missing-oversight" style="background: #FFFBEB; color: #92400E; border: 1px solid #FDE68A">❗ Missing Oversight</span>' : ''}
      ${isUnapprovedDecision ? '<span class="step-type-pill badge-decision-warning" style="background: #FFFBEB; color: #92400E; border: 1px solid #FDE68A">⚠️ Approval Unset</span>' : ''}
      ${isApprovedDecision ? '<span class="step-type-pill badge-decision-approved" style="background: #ECFDF5; color: #065F46; border: 1px solid #A7F3D0">✓ Decision Record</span>' : ''}
    `;
  }

  private renderDecisionPointControlsHtml(step: WorkflowStep): string {
    const sid = escapeAttr(step.id);
    return `
      <div class="governance-controls" style="border-top: 1px solid var(--border-color); margin-top: 16px; padding-top: 16px">
        <h4>Decision Point Controls</h4>
        <div class="form-group">
          <label for="step-${sid}-approval_required" style="display: flex; align-items: center; gap: 8px; cursor: pointer">
            <input type="checkbox" id="step-${sid}-approval_required" class="step-checkbox-nested" data-parent="controls" data-field="approval_required" aria-label="Decision Record Required" ${step.controls.approval_required ? 'checked' : ''} style="width: auto">
            Decision Record Required (Human-AI Decision Record Tool)
          </label>
        </div>
      </div>
    `;
  }

  private renderStepItem(step: WorkflowStep, index: number, _isHighRisk: boolean = false, _hasGaps: boolean = false) {
    const isExpanded = this.expandedStepIds.has(step.id);
    const totalSteps = this.store.steps.length;
    const stepLabel = escapeAttr(step.name || 'Untitled');
    const sid = escapeAttr(step.id);

    return `
      <div class="step-item" data-id="${sid}">
        <div class="step-header">
          <div class="step-header-badges" style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap">
            ${this.renderStepHeaderBadgesHtml(step, index)}
          </div>
          <div class="step-header-actions" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
            <button type="button" class="btn btn-secondary btn-sm move-step-up" aria-label="Move step ${index + 1}: ${stepLabel} up" ${index === 0 ? 'disabled' : ''}>↑ Move Up</button>
            <button type="button" class="btn btn-secondary btn-sm move-step-down" aria-label="Move step ${index + 1}: ${stepLabel} down" ${index === totalSteps - 1 ? 'disabled' : ''}>↓ Move Down</button>
            <button type="button" class="btn btn-secondary btn-sm edit-step" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-controls="step-content-${sid}" aria-label="Edit step ${index + 1}: ${stepLabel}">Edit</button>
            <button type="button" class="btn btn-secondary btn-sm delete-step" aria-label="Delete step ${index + 1}: ${stepLabel}">Delete</button>
          </div>
        </div>
        <div id="step-content-${sid}" class="step-content${isExpanded ? ' expanded' : ''}">
          <div class="grid-2">
            <div class="form-group">
              <label for="step-${sid}-name">Step Name</label>
              <input type="text" id="step-${sid}-name" class="step-input" data-field="name" aria-label="Step Name" value="${escapeAttr(step.name)}">
            </div>
            <div class="form-group">
              <label for="step-${sid}-type">Step Type</label>
              <select id="step-${sid}-type" class="step-input" data-field="type" aria-label="Step Type">
                <option value="human-only" ${step.type === 'human-only' ? 'selected' : ''}>Human Only</option>
                <option value="ai-supported" ${step.type === 'ai-supported' ? 'selected' : ''}>AI Supported</option>
                <option value="ai-generated" ${step.type === 'ai-generated' ? 'selected' : ''}>AI Generated</option>
                <option value="decision-point" ${step.type === 'decision-point' ? 'selected' : ''}>Decision Point</option>
              </select>
            </div>
          </div>
          
          <div class="form-group">
            <label for="step-${sid}-description">Description</label>
            <textarea id="step-${sid}-description" class="step-input" data-field="description" aria-label="Description" rows="2">${escapeHtml(step.description)}</textarea>
          </div>

          <div class="grid-2">
            <div class="form-group">
              <label for="step-${sid}-inputs">Inputs</label>
              <input type="text" id="step-${sid}-inputs" class="step-input" data-field="inputs" aria-label="Inputs" value="${escapeAttr(step.inputs.join(', '))}" placeholder="Comma separated...">
            </div>
            <div class="form-group">
              <label for="step-${sid}-outputs">Outputs</label>
              <input type="text" id="step-${sid}-outputs" class="step-input" data-field="outputs" aria-label="Outputs" value="${escapeAttr(step.outputs.join(', '))}" placeholder="Comma separated...">
            </div>
          </div>

          <div class="ai-involvement-layer" style="border-top: 1px solid var(--border-color); margin-top: 16px; padding-top: 16px">
            <h4>AI Involvement &amp; Reliance</h4>
            <div class="grid-2">
              <div class="form-group">
                <label for="step-${sid}-ai_role">AI Role / Function</label>
                <input type="text" id="step-${sid}-ai_role" class="step-input-nested" data-parent="ai_involvement" data-field="ai_role" aria-label="AI Role" value="${escapeAttr(step.ai_involvement.ai_role)}" placeholder="e.g. Drafts synthesis, classifies records">
              </div>
              <div class="form-group">
                <label for="step-${sid}-reliance_level">AI Reliance Level</label>
                <select id="step-${sid}-reliance_level" class="step-input-nested" data-parent="ai_involvement" data-field="reliance_level" aria-label="AI Reliance Level">
                  <option value="low" ${step.ai_involvement.reliance_level === 'low' ? 'selected' : ''}>Low</option>
                  <option value="medium" ${step.ai_involvement.reliance_level === 'medium' ? 'selected' : ''}>Medium</option>
                  <option value="high" ${step.ai_involvement.reliance_level === 'high' ? 'selected' : ''}>High</option>
                  <option value="critical" ${step.ai_involvement.reliance_level === 'critical' ? 'selected' : ''}>Critical</option>
                </select>
              </div>
            </div>
          </div>

          <div class="human-ai-boundary" style="border-top: 1px solid var(--border-color); margin-top: 16px; padding-top: 16px">
            <h4>Human-AI Boundary &amp; Oversight</h4>
            <div class="grid-2">
              <div class="form-group">
                <label for="step-${sid}-responsible_role">Responsible Role</label>
                <input type="text" id="step-${sid}-responsible_role" class="step-input-nested" data-parent="human_oversight" data-field="responsible_role" aria-label="Responsible Role" value="${escapeAttr(step.human_oversight.responsible_role)}" placeholder="e.g. Lead Researcher">
              </div>
              <div class="form-group">
                <label for="step-${sid}-oversight_level">Oversight Level</label>
                <select id="step-${sid}-oversight_level" class="step-input-nested" data-parent="human_oversight" data-field="oversight_level" aria-label="Oversight Level">
                  <option value="none" ${step.human_oversight.oversight_level === 'none' ? 'selected' : ''}>None</option>
                  <option value="minimal" ${step.human_oversight.oversight_level === 'minimal' ? 'selected' : ''}>Minimal (Outcome only)</option>
                  <option value="active" ${step.human_oversight.oversight_level === 'active' ? 'selected' : ''}>Active (Process review)</option>
                  <option value="full" ${step.human_oversight.oversight_level === 'full' ? 'selected' : ''}>Full (Real-time)</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label for="step-${sid}-intervention_points">Intervention Points</label>
              <input type="text" id="step-${sid}-intervention_points" class="step-input-nested" data-parent="human_oversight" data-field="intervention_points" aria-label="Intervention Points" value="${escapeAttr(step.human_oversight.intervention_points)}" placeholder="Where can a human override?">
            </div>
          </div>

          <div class="risk-layer" style="border-top: 1px solid var(--border-color); margin-top: 16px; padding-top: 16px">
            <h4>Risk Identification Layer</h4>
            <div class="grid-2">
              <div class="form-group">
                <label for="step-${sid}-bias_risk">Bias / Fairness Risk</label>
                <input type="text" id="step-${sid}-bias_risk" class="step-input-nested" data-parent="risks" data-field="bias_risk" aria-label="Bias / Fairness Risk" value="${escapeAttr(step.risks.bias_risk)}">
              </div>
              <div class="form-group">
                <label for="step-${sid}-operational_risk">Operational Risk</label>
                <input type="text" id="step-${sid}-operational_risk" class="step-input-nested" data-parent="risks" data-field="operational_risk" aria-label="Operational Risk" value="${escapeAttr(step.risks.operational_risk)}">
              </div>
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label for="step-${sid}-ethical_risk">Ethical Risk</label>
                <input type="text" id="step-${sid}-ethical_risk" class="step-input-nested" data-parent="risks" data-field="ethical_risk" aria-label="Ethical Risk" value="${escapeAttr(step.risks.ethical_risk)}">
              </div>
              <div class="form-group">
                <label for="step-${sid}-privacy_risk">Privacy / Data Risk</label>
                <input type="text" id="step-${sid}-privacy_risk" class="step-input-nested" data-parent="risks" data-field="privacy_risk" aria-label="Privacy Risk" value="${escapeAttr(step.risks.privacy_risk)}">
              </div>
            </div>
            <div class="form-group">
              <label for="step-${sid}-mitigation">Mitigation Strategy</label>
              <textarea id="step-${sid}-mitigation" class="step-input-nested" data-parent="risks" data-field="mitigation" aria-label="Mitigation Strategy" rows="2">${escapeHtml(step.risks.mitigation)}</textarea>
            </div>
          </div>

          ${step.type === 'decision-point' ? this.renderDecisionPointControlsHtml(step) : ''}
        </div>
      </div>
    `;
  }

  /**
   * Targeted DOM update for a single step item so changing step type (to/from decision-point),
   * step name, reliance level, oversight level, intervention points, or decision-record checkbox
   * immediately updates badges, aria-labels, and decision-point controls without full-view rerendering
   * or disrupting keyboard focus.
   */
  private updateStepItemDOM(stepEl: HTMLElement, step: WorkflowStep, index: number) {
    const badgesContainer = stepEl.querySelector('.step-header-badges');
    if (badgesContainer) {
      badgesContainer.innerHTML = this.renderStepHeaderBadgesHtml(step, index);
    }

    const nameForAria = step.name || 'Untitled';
    const upBtn = stepEl.querySelector('.move-step-up');
    const downBtn = stepEl.querySelector('.move-step-down');
    const editBtn = stepEl.querySelector('.edit-step');
    const deleteBtn = stepEl.querySelector('.delete-step');

    upBtn?.setAttribute('aria-label', `Move step ${index + 1}: ${nameForAria} up`);
    downBtn?.setAttribute('aria-label', `Move step ${index + 1}: ${nameForAria} down`);
    editBtn?.setAttribute('aria-label', `Edit step ${index + 1}: ${nameForAria}`);
    deleteBtn?.setAttribute('aria-label', `Delete step ${index + 1}: ${nameForAria}`);

    const stepContent = stepEl.querySelector('.step-content');
    if (!stepContent) return;

    const existingDecisionControls = stepContent.querySelector('.governance-controls');
    if (step.type === 'decision-point') {
      if (!existingDecisionControls) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = this.renderDecisionPointControlsHtml(step).trim();
        const newControlsEl = wrapper.firstElementChild as HTMLElement | null;
        if (newControlsEl) {
          stepContent.appendChild(newControlsEl);
          const checkbox = newControlsEl.querySelector('.step-checkbox-nested') as HTMLInputElement | null;
          if (checkbox) {
            this.bindStepCheckboxEvent(checkbox);
          }
        }
      } else {
        const checkbox = existingDecisionControls.querySelector(
          'input[data-field="approval_required"]'
        ) as HTMLInputElement | null;
        if (checkbox) {
          checkbox.checked = Boolean(step.controls.approval_required);
        }
      }
    } else if (existingDecisionControls) {
      existingDecisionControls.remove();
    }
  }

  private bindStepCheckboxEvent(checkbox: HTMLInputElement) {
    checkbox.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      const stepEl = target.closest('.step-item') as HTMLElement | null;
      const id = stepEl?.getAttribute('data-id');
      const parent = target.dataset.parent as any;
      const field = target.dataset.field as any;
      const index = this.store.steps.findIndex(s => s.id === id);
      const step = index >= 0 ? this.store.steps[index] : undefined;

      if (step && (step as any)[parent]) {
        (step as any)[parent][field] = target.checked;
        if (stepEl) {
          this.updateStepItemDOM(stepEl, step, index);
        }
        this.saveToStorage();
      }
    });
  }

  public moveStep(fromIndex: number, toIndex: number, direction?: 'up' | 'down'): boolean {
    if (
      fromIndex < 0 ||
      fromIndex >= this.store.steps.length ||
      toIndex < 0 ||
      toIndex >= this.store.steps.length ||
      fromIndex === toIndex
    ) {
      return false;
    }

    const [movedStep] = this.store.steps.splice(fromIndex, 1);
    this.store.steps.splice(toIndex, 0, movedStep);
    this.saveToStorage();
    this.render();

    // Restore keyboard focus to the moved step's reorder button (or fallback control at boundary)
    const movedStepEl = document.querySelector(
      `.step-item[data-id="${movedStep.id}"]`
    ) as HTMLElement | null;
    if (movedStepEl) {
      const preferredSelector = direction === 'down' ? '.move-step-down' : '.move-step-up';
      const fallbackSelector = direction === 'down' ? '.move-step-up' : '.move-step-down';
      const preferredBtn = movedStepEl.querySelector(preferredSelector) as HTMLButtonElement | null;
      const fallbackBtn = movedStepEl.querySelector(fallbackSelector) as HTMLButtonElement | null;
      const editBtn = movedStepEl.querySelector('.edit-step') as HTMLButtonElement | null;

      if (preferredBtn && !preferredBtn.disabled) {
        preferredBtn.focus();
      } else if (fallbackBtn && !fallbackBtn.disabled) {
        fallbackBtn.focus();
      } else {
        editBtn?.focus();
      }
    }
    return true;
  }

  private attachStepEvents() {
    document.getElementById('add-step')?.addEventListener('click', () => {
      const newStep: WorkflowStep = {
        id: generateUUID(),
        name: '',
        type: 'human-only',
        description: '',
        inputs: [],
        outputs: [],
        ai_involvement: { ai_role: '', reliance_level: 'low' },
        human_oversight: { responsible_role: '', oversight_level: 'none', intervention_points: '' },
        risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
        controls: { approval_required: false, escalation_path: '', review_cycle: '' }
      };
      this.expandedStepIds.add(newStep.id);
      this.store.steps.push(newStep);
      this.saveToStorage();
      this.render();

      const newStepNameInput = document.querySelector(
        `.step-item[data-id="${newStep.id}"] input.step-input[data-field="name"]`
      ) as HTMLInputElement | null;
      newStepNameInput?.focus();
    });

    document.querySelectorAll('.move-step-up').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).closest('.step-item')?.getAttribute('data-id');
        const idx = this.store.steps.findIndex(s => s.id === id);
        if (idx > 0) {
          this.moveStep(idx, idx - 1, 'up');
        }
      });
    });

    document.querySelectorAll('.move-step-down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).closest('.step-item')?.getAttribute('data-id');
        const idx = this.store.steps.findIndex(s => s.id === id);
        if (idx >= 0 && idx < this.store.steps.length - 1) {
          this.moveStep(idx, idx + 1, 'down');
        }
      });
    });

    document.querySelectorAll('.edit-step').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const editBtn = e.currentTarget as HTMLButtonElement;
        const item = editBtn.closest('.step-item');
        const id = item?.getAttribute('data-id');
        const contentEl = item?.querySelector('.step-content');
        if (contentEl && id) {
          const isNowExpanded = contentEl.classList.toggle('expanded');
          editBtn.setAttribute('aria-expanded', isNowExpanded ? 'true' : 'false');
          if (isNowExpanded) {
            this.expandedStepIds.add(id);
          } else {
            this.expandedStepIds.delete(id);
          }
        }
      });
    });

    document.querySelectorAll('.delete-step').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).closest('.step-item')?.getAttribute('data-id');
        if (confirm('Delete this step?')) {
          if (id) {
            this.expandedStepIds.delete(id);
          }
          this.store.steps = this.store.steps.filter(s => s.id !== id);
          this.saveToStorage();
          this.render();
        }
      });
    });

    document.querySelectorAll('.step-input').forEach(input => {
      const handleStepFieldChange = (e: Event) => {
        const target = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const stepEl = target.closest('.step-item') as HTMLElement | null;
        const id = stepEl?.getAttribute('data-id');
        const field = target.dataset.field as any;
        const index = this.store.steps.findIndex(s => s.id === id);
        const step = index >= 0 ? this.store.steps[index] : undefined;

        if (step) {
          if (field === 'inputs' || field === 'outputs') {
            (step as any)[field] = target.value
              .split(',')
              .map(s => s.trim())
              .filter(s => s.length > 0);
          } else {
            (step as any)[field] = target.value;
          }
          if (stepEl && (field === 'name' || field === 'type')) {
            this.updateStepItemDOM(stepEl, step, index);
          }
          this.saveToStorage();
        }
      };

      input.addEventListener('input', handleStepFieldChange);
      if (input.tagName === 'SELECT') {
        input.addEventListener('change', handleStepFieldChange);
      }
    });

    document.querySelectorAll('.step-input-nested').forEach(input => {
      const handleNestedFieldChange = (e: Event) => {
        const target = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const stepEl = target.closest('.step-item') as HTMLElement | null;
        const id = stepEl?.getAttribute('data-id');
        const parent = target.dataset.parent as any;
        const field = target.dataset.field as any;
        const index = this.store.steps.findIndex(s => s.id === id);
        const step = index >= 0 ? this.store.steps[index] : undefined;

        if (step && (step as any)[parent]) {
          (step as any)[parent][field] = target.value;
          if (
            stepEl &&
            (field === 'reliance_level' || field === 'oversight_level' || field === 'intervention_points')
          ) {
            this.updateStepItemDOM(stepEl, step, index);
          }
          this.saveToStorage();
        }
      };

      input.addEventListener('input', handleNestedFieldChange);
      if (input.tagName === 'SELECT') {
        input.addEventListener('change', handleNestedFieldChange);
      }
    });

    document.querySelectorAll('.step-checkbox-nested').forEach(input => {
      this.bindStepCheckboxEvent(input as HTMLInputElement);
    });
  }

  private renderGovernancePanel() {
    return `
      <div class="section">
        <h2>Governance Controls</h2>
        <p style="color: var(--text-secondary); margin-bottom: 24px">Define global governance parameters and step-specific controls.</p>
        
        <div id="governance-steps">
          ${this.store.steps.map(step => {
            const sid = escapeAttr(step.id);
            return `
            <div class="step-item">
              <div class="step-header">
                <span style="font-weight: 600">${escapeHtml(step.name || 'Untitled Step')}</span>
                <span class="step-type-pill">${escapeHtml(step.type)}</span>
              </div>
              <div class="step-content expanded" style="border-top: 1px solid var(--border-color)">
                <div class="grid-2">
                  <div class="form-group">
                    <label for="gov-${sid}-approval_required">Approval Required</label>
                    <select id="gov-${sid}-approval_required" class="gov-input" data-id="${sid}" data-field="approval_required" aria-label="Approval Required">
                      <option value="false" ${!step.controls.approval_required ? 'selected' : ''}>No</option>
                      <option value="true" ${step.controls.approval_required ? 'selected' : ''}>Yes</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label for="gov-${sid}-review_cycle">Review Cycle</label>
                    <input type="text" id="gov-${sid}-review_cycle" class="gov-input" data-id="${sid}" data-field="review_cycle" aria-label="Review Cycle" value="${escapeAttr(step.controls.review_cycle)}" placeholder="e.g. Quarterly">
                  </div>
                </div>
                <div class="form-group">
                  <label for="gov-${sid}-escalation_path">Escalation Path</label>
                  <input type="text" id="gov-${sid}-escalation_path" class="gov-input" data-id="${sid}" data-field="escalation_path" aria-label="Escalation Path" value="${escapeAttr(step.controls.escalation_path)}" placeholder="Who to contact if risks elevate?">
                </div>
              </div>
            </div>
          `;
          }).join('')}
        </div>
        ${this.store.steps.length === 0 ? `<p style="color: var(--text-muted); font-style: italic">No workflow steps defined yet. Add steps in the Step Builder to configure governance controls.</p>` : ''}
      </div>
    `;
  }

  private attachGovernanceEvents() {
    document.querySelectorAll('.gov-input').forEach(input => {
      const handleGovChange = (e: Event) => {
        const target = e.target as HTMLInputElement | HTMLSelectElement;
        const id = target.dataset.id;
        const field = target.dataset.field;
        const step = this.store.steps.find(s => s.id === id);
        if (step) {
          if (field === 'approval_required') {
            step.controls.approval_required = target.value === 'true';
          } else {
            (step.controls as any)[field!] = target.value;
          }
          this.saveToStorage();
        }
      };

      input.addEventListener('input', handleGovChange);
      if (input.tagName === 'SELECT') {
        input.addEventListener('change', handleGovChange);
      }
    });
  }

  private renderReflectionLayer() {
    const { reflection } = this.store;
    return `
      <div class="section section-hero">
        <h2>Critical Reflection Layer</h2>
        <p>Analyse the systemic risks and human accountability requirements of this workflow design.</p>
        
        <div class="form-group">
          <label for="failure_modes">Where could this workflow fail? (Failure Modes)</label>
          <textarea id="failure_modes" class="reflection-input" data-field="failure_modes" aria-label="Failure Modes" rows="3">${escapeHtml(reflection.failure_modes)}</textarea>
        </div>

        <div class="form-group">
          <label for="essential_judgement">Where is human judgement essential?</label>
          <textarea id="essential_judgement" class="reflection-input" data-field="essential_judgement" aria-label="Essential Human Judgement" rows="3">${escapeHtml(reflection.essential_judgement)}</textarea>
        </div>

        <div class="form-group">
          <label for="over_reliance_risks">Where is AI over-relied upon?</label>
          <textarea id="over_reliance_risks" class="reflection-input" data-field="over_reliance_risks" aria-label="AI Over-reliance Risks" rows="3">${escapeHtml(reflection.over_reliance_risks)}</textarea>
        </div>

        <div class="form-group">
          <label for="embedded_assumptions">What assumptions are embedded in this design?</label>
          <textarea id="embedded_assumptions" class="reflection-input" data-field="embedded_assumptions" aria-label="Embedded Assumptions" rows="3">${escapeHtml(reflection.embedded_assumptions)}</textarea>
        </div>
      </div>
    `;
  }

  private attachReflectionEvents() {
    document.querySelectorAll('.reflection-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const target = e.target as HTMLTextAreaElement;
        const field = target.dataset.field as keyof typeof this.store.reflection;
        this.store.reflection[field] = target.value;
        this.saveToStorage();
      });
    });
  }

  private renderExportPanel() {
    const workflowCount = this.listWorkflows().length;
    return `
      <div class="dash-grid">
        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">JSON Specification (Active Workflow)</span>
          </div>
          <p>Export the completed, schema-validated specification of the active workflow for downstream governance tools.</p>
          <button type="button" id="export-json" class="btn btn-primary" aria-label="Export workflow as JSON specification">Export JSON</button>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Draft / Recovery JSON (Active Workflow)</span>
          </div>
          <p>Export a lossless working draft of the active workflow at any stage, even if required metadata or step names are incomplete.</p>
          <button type="button" id="export-draft-json" class="btn btn-secondary" aria-label="Export unfinished working draft or recovery JSON">Export Draft / Recovery JSON</button>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Full Registry Backup (${workflowCount} Workflow${workflowCount === 1 ? '' : 's'})</span>
          </div>
          <p>Back up or restore the entire local multi-workflow registry (all completed workflows and working drafts). Note: in-browser protective backups hold a single workflow snapshot; download a Full Registry Backup before replacing your registry.</p>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <button type="button" id="export-registry-json" class="btn btn-secondary" aria-label="Export full workflow registry backup as JSON">Export Registry Backup</button>
            <button type="button" id="import-registry-json" class="btn btn-secondary" aria-label="Import workflow registry backup from JSON">Import Registry Backup</button>
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Markdown Document</span>
          </div>
          <p>Generate a structured governance report in Markdown format for documentation.</p>
          <button type="button" id="export-markdown" class="btn btn-primary" aria-label="Export workflow as Markdown document">Export Markdown</button>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Printable Report (PDF)</span>
          </div>
          <p>Generate a complete, structured print/PDF governance specification report including metadata, completeness metrics, steps, AI roles, human oversight, risks, controls, reflection, and scope disclaimer.</p>
          <button type="button" id="export-pdf" class="btn btn-primary" aria-label="Export workflow as printable PDF">Export PDF / Print</button>
        </div>
      </div>

      <div class="section" style="margin-top: 32px">
        <h2>Governance Schema</h2>
        <p style="color: var(--text-secondary)">This tool adheres to the AI Workflow Governance Schema. You can find the full schema in the <code>WORKFLOW_SCHEMA.json</code> file in the project root.</p>
      </div>
    `;
  }

  private attachExportEvents() {
    document.getElementById('export-json')?.addEventListener('click', () => {
      exportToJSON(this.store);
    });

    document.getElementById('export-draft-json')?.addEventListener('click', () => {
      exportDraftToJSON(this.store);
    });

    document.getElementById('export-registry-json')?.addEventListener('click', () => {
      this.exportRegistryBackup();
    });

    document.getElementById('import-registry-json')?.addEventListener('click', () => {
      this.importRegistryJSON();
    });

    document.getElementById('export-markdown')?.addEventListener('click', () => {
      exportToMarkdown(this.store);
    });

    document.getElementById('export-pdf')?.addEventListener('click', () => {
      this.syncPrintableReport();
      exportToPDF(this.store);
    });
  }

  public exportRegistryBackup(): string {
    if (!this.isDemoMode) {
      this.storageManager.syncInMemoryWorkflow(this.store, this.hasUnsavedChanges);
    }
    const snapshot = this.storageManager.getRegistrySnapshot();
    return exportRegistryToJSON(snapshot);
  }

  public importRegistryContent(content: string): boolean {
    const validation = validateRegistryImport(content);
    if (!validation.valid || !validation.registry) {
      alert(
        `Registry Import Rejected — Malformed or Incompatible Registry JSON:\n\n• ${validation.errors.join('\n• ')}\n\nYour existing workflow registry has NOT been modified.`
      );
      return false;
    }

    if (validation.warnings.length > 0) {
      const proceedWithWarnings = confirm(
        `Registry Import Warnings:\n• ${validation.warnings.join('\n• ')}\n\nDo you want to proceed?`
      );
      if (!proceedWithWarnings) return false;
    }

    const existingList = this.listWorkflows();
    const incomingCount = validation.registry.workflow_order.length;
    const confirmReplace = confirm(
      `Import registry backup containing ${incomingCount} workflow(s)?\n\nThis will replace your current local registry (${existingList.length} workflow(s)). Note: the in-browser protective backup slot preserves only the current active workflow; if you have multiple workflows you wish to keep, cancel and click "Export Registry Backup" first.`
    );
    if (!confirmReplace) {
      return false;
    }

    const backupTarget = this.isDemoMode && this.preDemoStore ? this.preDemoStore : this.store;
    const replaceRes = this.storageManager.replaceRegistry(validation.registry, backupTarget);

    if (!replaceRes.success) {
      this.updateSaveStatus('error', replaceRes.error);
      this.syncRestoreBackupButton();
      alert(
        `Registry Import Aborted:\n${replaceRes.error}\n\nYour existing workflows have been preserved.`
      );
      return false;
    }

    this.store = replaceRes.activeWorkflow;
    this.expandedStepIds.clear();
    this.isDemoMode = false;
    this.preDemoStore = null;
    this.preDemoHadUnsavedChanges = false;
    this.hasUnsavedChanges = false;
    this.hideDemoBanner();
    this.updateSaveStatus('saved');
    this.render();
    alert(`Successfully imported workflow registry (${incomingCount} workflow(s)).`);
    return true;
  }

  private importRegistryJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (re) => {
        const content = re.target?.result as string;
        this.importRegistryContent(content);
      };
      reader.readAsText(file);
    };
    input.click();
  }

  public importWorkflowContent(content: string): boolean {
    // 1. Validate file content before modifying any state
    let validation = validateWorkflowImport(content);
    if (!validation.valid || !validation.store) {
      const draftValidation = validateWorkflowDraft(content);
      if (draftValidation.valid && draftValidation.store) {
        const importAsDraft = confirm(
          `This JSON file is an incomplete working draft (${validation.errors.join('; ')}).\n\nDo you want to recover/import it as a working draft?`
        );
        if (!importAsDraft) {
          return false;
        }
        validation = draftValidation;
      } else {
        alert(
          `Import Rejected — Malformed or Incompatible JSON:\n\n• ${validation.errors.join('\n• ')}\n\nYour active workflow has NOT been modified.`
        );
        return false;
      }
    }

    // 2. Warn about non-blocking warnings if any
    if (validation.warnings.length > 0) {
      const proceed = confirm(
        `Import Warnings:\n• ${validation.warnings.join('\n• ')}\n\nDo you want to proceed with this import?`
      );
      if (!proceed) return false;
    }

    // 3. Create protective backup before replacing current work
    const backupTarget = this.isDemoMode && this.preDemoStore ? this.preDemoStore : this.store;
    if (this.storageManager.hasDivergentUnsavedWork(backupTarget)) {
      const proceedWithSingleSlot = confirm(
        'You have unsaved in-memory edits that differ from your last saved workflow. Importing will preserve your latest unsaved in-memory version in the single backup slot (it cannot preserve both versions). Cancel and use "Export Draft / Recovery JSON" first if you need both.\n\nProceed with import?'
      );
      if (!proceedWithSingleSlot) return false;
    }

    const backupResult = this.storageManager.createProtectiveBackup(backupTarget);
    if (!backupResult.success) {
      this.updateSaveStatus('error', backupResult.error);
      this.syncRestoreBackupButton();
      alert(
        `Import Aborted: Protective backup failed (${backupResult.error}).\n\nYour existing workflow could not be safely backed up. Open the "Export" tab and click "Export Draft / Recovery JSON" first.`
      );
      return false;
    }

    if (backupTarget && hasMeaningfulWorkflowData(backupTarget)) {
      this.storageManager.syncInMemoryWorkflow(
        backupTarget,
        this.isDemoMode ? this.preDemoHadUnsavedChanges : this.hasUnsavedChanges
      );
    }

    const importedStore = validation.store!;

    // 4. Verify persistence before replacing in-memory workflow
    const saveResult = this.storageManager.saveWorkflow(importedStore);
    if (!saveResult.success) {
      const rollback = this.storageManager.rollbackProtectiveBackup(backupResult.previousBackup);
      this.updateSaveStatus('error', saveResult.error);
      this.syncRestoreBackupButton();
      const rollbackNotice = !rollback.rolledBack && rollback.error ? `\n\nBackup note: ${rollback.error}` : '';
      alert(
        `Import Aborted — Local storage could not be updated:\n${saveResult.error}${rollbackNotice}\n\nYour previous workflow has been preserved.`
      );
      return false;
    }

    // 5. Safely apply imported workflow
    this.store = importedStore;
    this.expandedStepIds.clear();
    this.isDemoMode = false;
    this.preDemoStore = null;
    this.preDemoHadUnsavedChanges = false;
    this.hasUnsavedChanges = false;
    this.hideDemoBanner();
    this.updateSaveStatus('saved');
    this.render();

    alert(`Workflow "${this.store.metadata.title || 'Untitled Draft'}" successfully imported.`);
    return true;
  }

  private importJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (re) => {
        const content = re.target?.result as string;
        this.importWorkflowContent(content);
      };
      reader.readAsText(file);
    };
    input.click();
  }

  private syncPrintableReport() {
    const contentEl = document.querySelector('.content');
    if (!contentEl) return;

    let reportEl = document.getElementById('printable-governance-report');
    if (!reportEl) {
      reportEl = document.createElement('section');
      reportEl.id = 'printable-governance-report';
      reportEl.className = 'printable-report';
      reportEl.setAttribute('aria-label', 'Printable Governance Specification Report');
      const footerEl = contentEl.querySelector('.page-footer');
      if (footerEl) {
        contentEl.insertBefore(reportEl, footerEl);
      } else {
        contentEl.appendChild(reportEl);
      }
    }

    reportEl.innerHTML = generatePrintableReportHTML(this.store);
  }

  private render() {
    this.syncRestoreBackupButton();
    this.syncRegistryToolbar();
    this.updateCompletenessUI();
    this.renderView();
    this.syncPrintableReport();
  }
}

// Instantiate application in browser environment
if (typeof document !== 'undefined') {
  new App();
}
