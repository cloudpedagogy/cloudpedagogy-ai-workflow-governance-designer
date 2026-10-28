import { INITIAL_STATE, hasMeaningfulWorkflowData, type WorkflowStore } from '../data/model';
import {
  REGISTRY_FORMAT,
  REGISTRY_VERSION,
  validateRegistryImport,
  validateWorkflowDraft,
  type WorkflowRegistry
} from './schema';
import { generateUUID } from './uuid';

export const STORAGE_KEY = 'cp_workflow_designer';
export const REGISTRY_KEY = 'cp_workflow_designer_registry';
export const BACKUP_KEY = 'cp_workflow_designer_backup';

export interface StorageLoadResult {
  success: boolean;
  data: WorkflowStore;
  error?: string;
  rawCorrupted?: string;
  isNew?: boolean;
}

export interface StorageSaveResult {
  success: boolean;
  error?: string;
  isQuotaExceeded?: boolean;
  isCorruptedLocked?: boolean;
}

export interface BackupResult {
  success: boolean;
  backedUp?: boolean;
  previousBackup?: string | null;
  divergentFromPersisted?: boolean;
  error?: string;
}

export interface BackupRollbackResult {
  rolledBack: boolean;
  error?: string;
}

export interface BackupRestoreResult {
  success: boolean;
  persisted: boolean;
  data?: WorkflowStore;
  error?: string;
}

export interface WorkflowSummary {
  id: string;
  title: string;
  owner: string;
  domain: string;
  version: string;
  created_at: string;
  stepCount: number;
  isActive: boolean;
  hasUnsavedChanges: boolean;
}

export interface RegistryActionResult {
  success: boolean;
  persisted: boolean;
  activeWorkflow: WorkflowStore;
  hasUnsavedChanges?: boolean;
  backedUp?: boolean;
  error?: string;
  isQuotaExceeded?: boolean;
  isCorruptedLocked?: boolean;
}

function cloneWorkflow(wf: WorkflowStore): WorkflowStore {
  return JSON.parse(JSON.stringify(wf));
}

function cloneInitialState(customTitle?: string): WorkflowStore {
  const clone = cloneWorkflow(INITIAL_STATE);
  clone.metadata.id = generateUUID();
  clone.metadata.created_at = new Date().toISOString();
  if (typeof customTitle === 'string') {
    clone.metadata.title = customTitle;
  }
  return clone;
}

function createInitialRegistry(initialWf?: WorkflowStore): WorkflowRegistry {
  const wf = initialWf ? cloneWorkflow(initialWf) : cloneInitialState();
  if (!wf.metadata.id) {
    wf.metadata.id = generateUUID();
  }
  return {
    format: REGISTRY_FORMAT,
    registry_version: REGISTRY_VERSION,
    updated_at: new Date().toISOString(),
    active_workflow_id: wf.metadata.id,
    workflow_order: [wf.metadata.id],
    workflows: {
      [wf.metadata.id]: wf
    }
  };
}

function isQuotaError(e: any): boolean {
  return Boolean(
    e?.name === 'QuotaExceededError' ||
      e?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e?.code === 22 ||
      e?.code === 1014 ||
      (typeof e?.message === 'string' && e.message.toLowerCase().includes('quota'))
  );
}

/**
 * StorageManager provides resilient persistence using both the versioned local registry
 * (cp_workflow_designer_registry) and the active workflow mirror (cp_workflow_designer).
 * Handles legacy migration, storage unavailability, quota exhaustion, corrupt storage protection,
 * working-draft persistence, unsaved in-memory workflow switching, and protective backups.
 */
export class StorageManager {
  private customStorage?: Storage;
  private isCorruptedLocked: boolean = false;
  private corruptedRawData: string | null = null;
  private hasInspectedStorage: boolean = false;
  private registry: WorkflowRegistry = createInitialRegistry();
  private inMemoryWorkflows: Map<string, WorkflowStore> = new Map();
  private unsavedWorkflowIds: Set<string> = new Set();
  private isInitialPlaceholder: boolean = true;

  constructor(customStorage?: Storage) {
    this.customStorage = customStorage;
    const activeId = this.registry.active_workflow_id;
    this.inMemoryWorkflows.set(activeId, cloneWorkflow(this.registry.workflows[activeId]));
  }

  private get storage(): Storage | null {
    if (this.customStorage) return this.customStorage;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage;
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Checks whether storage is accessible for reading and writing.
   */
  public isAvailable(): boolean {
    const s = this.storage;
    if (!s) return false;
    try {
      const testKey = `__cp_storage_test_${Date.now()}`;
      s.setItem(testKey, '1');
      s.removeItem(testKey);
      return true;
    } catch (e: any) {
      return isQuotaError(e);
    }
  }

  public isCorruptedStorageLocked(): boolean {
    return this.isCorruptedLocked;
  }

  public getCorruptedRawData(): string | null {
    return this.corruptedRawData;
  }

  /**
   * Synchronizes the in-memory working copy and unsaved status of a workflow
   * so switching workflows never loses unsaved in-memory edits.
   */
  public syncInMemoryWorkflow(store: WorkflowStore, hasUnsavedChanges: boolean): void {
    if (!store || !store.metadata) return;
    const id = store.metadata.id || generateUUID();
    store.metadata.id = id;
    const cloned = cloneWorkflow(store);
    this.inMemoryWorkflows.set(id, cloned);
    if (!this.registry.workflows[id]) {
      this.registry.workflows[id] = cloned;
    }
    if (!this.registry.workflow_order.includes(id)) {
      this.registry.workflow_order.push(id);
    }
    if (hasUnsavedChanges) {
      this.unsavedWorkflowIds.add(id);
    } else {
      this.unsavedWorkflowIds.delete(id);
    }
  }

  public isWorkflowUnsaved(id: string): boolean {
    return this.unsavedWorkflowIds.has(id);
  }

  /**
   * Returns a snapshot of the full workflow registry including any unsaved in-memory edits.
   */
  public getRegistrySnapshot(): WorkflowRegistry {
    const snapshot: WorkflowRegistry = {
      format: REGISTRY_FORMAT,
      registry_version: this.registry.registry_version || REGISTRY_VERSION,
      updated_at: this.registry.updated_at || new Date().toISOString(),
      active_workflow_id: this.registry.active_workflow_id,
      workflow_order: [...this.registry.workflow_order],
      workflows: {}
    };

    for (const id of snapshot.workflow_order) {
      const wf = this.inMemoryWorkflows.get(id) ?? this.registry.workflows[id];
      if (wf) {
        snapshot.workflows[id] = cloneWorkflow(wf);
      }
    }
    for (const [id, wf] of Object.entries(this.registry.workflows)) {
      if (!snapshot.workflows[id]) {
        snapshot.workflows[id] = cloneWorkflow(this.inMemoryWorkflows.get(id) ?? wf);
        snapshot.workflow_order.push(id);
      }
    }
    return snapshot;
  }

  /**
   * Lists all workflows in the registry in order.
   */
  public listWorkflows(): WorkflowSummary[] {
    const snapshot = this.getRegistrySnapshot();
    return snapshot.workflow_order
      .map(id => snapshot.workflows[id])
      .filter((wf): wf is WorkflowStore => Boolean(wf))
      .map(wf => ({
        id: wf.metadata.id,
        title: wf.metadata.title || 'Untitled Workflow',
        owner: wf.metadata.owner || '',
        domain: wf.metadata.domain || 'education',
        version: wf.metadata.version || '1.0.0',
        created_at: wf.metadata.created_at || '',
        stepCount: Array.isArray(wf.steps) ? wf.steps.length : 0,
        isActive: wf.metadata.id === snapshot.active_workflow_id,
        hasUnsavedChanges: this.unsavedWorkflowIds.has(wf.metadata.id)
      }));
  }

  public getWorkflowById(id: string): WorkflowStore | null {
    const wf = this.inMemoryWorkflows.get(id) ?? this.registry.workflows[id];
    return wf ? cloneWorkflow(wf) : null;
  }

  public getActiveWorkflowId(): string {
    return this.registry.active_workflow_id;
  }

  /**
   * Loads and validates workflows from local storage, safely migrating legacy
   * cp_workflow_designer records into the versioned registry without duplicating
   * records on subsequent launches or overwriting corrupted storage data.
   */
  public loadWorkflow(): StorageLoadResult {
    const s = this.storage;
    if (!s) {
      const fallback = cloneInitialState();
      this.registry = createInitialRegistry(fallback);
      this.inMemoryWorkflows.clear();
      this.inMemoryWorkflows.set(fallback.metadata.id, cloneWorkflow(fallback));
      this.unsavedWorkflowIds.clear();
      return {
        success: false,
        data: fallback,
        error: 'Browser storage is unavailable. Changes will remain in memory only.'
      };
    }

    try {
      const rawLegacy = s.getItem(STORAGE_KEY);
      const rawRegistry = s.getItem(REGISTRY_KEY);
      this.hasInspectedStorage = true;

      // 1. Inspect legacy STORAGE_KEY first for corruption
      let legacyStore: WorkflowStore | null = null;
      if (rawLegacy) {
        const legacyValidation = validateWorkflowDraft(rawLegacy);
        if (!legacyValidation.valid || !legacyValidation.store) {
          this.isCorruptedLocked = true;
          this.corruptedRawData = rawLegacy;
          const safeFallback = cloneInitialState();
          this.registry = createInitialRegistry(safeFallback);
          this.inMemoryWorkflows.clear();
          this.inMemoryWorkflows.set(safeFallback.metadata.id, cloneWorkflow(safeFallback));
          return {
            success: false,
            data: safeFallback,
            error: `Corrupted workflow in local storage: ${legacyValidation.errors.join('; ')}`,
            rawCorrupted: rawLegacy
          };
        }
        legacyStore = legacyValidation.store;
      }

      // 2. Inspect REGISTRY_KEY for corruption if present
      let loadedRegistry: WorkflowRegistry | null = null;
      if (rawRegistry) {
        const regValidation = validateRegistryImport(rawRegistry);
        if (!regValidation.valid || !regValidation.registry) {
          this.isCorruptedLocked = true;
          this.corruptedRawData = rawRegistry;
          const fallbackData = legacyStore ? cloneWorkflow(legacyStore) : cloneInitialState();
          this.registry = createInitialRegistry(fallbackData);
          this.inMemoryWorkflows.clear();
          this.inMemoryWorkflows.set(fallbackData.metadata.id, cloneWorkflow(fallbackData));
          return {
            success: false,
            data: fallbackData,
            error: `Corrupted workflow registry in local storage: ${regValidation.errors.join('; ')}`,
            rawCorrupted: rawRegistry
          };
        }
        loadedRegistry = regValidation.registry;
      }

      // 3. Empty storage (neither legacy key nor registry key exists)
      if (!legacyStore && !loadedRegistry) {
        const fresh = cloneInitialState();
        this.registry = createInitialRegistry(fresh);
        this.inMemoryWorkflows.clear();
        this.inMemoryWorkflows.set(fresh.metadata.id, cloneWorkflow(fresh));
        this.unsavedWorkflowIds.clear();

        if (!this.isAvailable()) {
          return {
            success: false,
            data: fresh,
            error: 'Browser storage is unavailable. Changes will remain in memory only.'
          };
        }
        this.isCorruptedLocked = false;
        this.corruptedRawData = null;
        this.isInitialPlaceholder = true;
        return {
          success: true,
          data: fresh,
          isNew: true
        };
      }

      // 4. Legacy STORAGE_KEY exists, but REGISTRY_KEY does not -> safe one-time migration
      if (legacyStore && !loadedRegistry) {
        const wfId = legacyStore.metadata.id || generateUUID();
        legacyStore.metadata.id = wfId;
        const migratedRegistry = createInitialRegistry(legacyStore);

        // Attempt atomic write of REGISTRY_KEY without touching STORAGE_KEY or BACKUP_KEY
        try {
          const serializedReg = JSON.stringify(migratedRegistry);
          s.setItem(REGISTRY_KEY, serializedReg);
          if (s.getItem(REGISTRY_KEY) !== serializedReg) {
            s.removeItem(REGISTRY_KEY);
          }
        } catch {
          // If quota prevents writing REGISTRY_KEY during startup migration, roll back partial write
          // and keep legacy STORAGE_KEY untouched while operating with migratedRegistry in memory.
          try {
            s.removeItem(REGISTRY_KEY);
          } catch {
            // Ignore cleanup failure
          }
        }

        this.registry = migratedRegistry;
        this.inMemoryWorkflows.clear();
        this.inMemoryWorkflows.set(wfId, cloneWorkflow(legacyStore));
        this.unsavedWorkflowIds.clear();
        this.isCorruptedLocked = false;
        this.corruptedRawData = null;
        this.isInitialPlaceholder = false;
        return {
          success: true,
          data: cloneWorkflow(legacyStore)
        };
      }

      // 5. REGISTRY_KEY exists and is valid; reconcile with legacyStore if present without duplicating
      const reg = loadedRegistry!;
      if (legacyStore) {
        const legacyId = legacyStore.metadata.id || generateUUID();
        legacyStore.metadata.id = legacyId;

        if (reg.workflows[legacyId]) {
          // Already in registry: update in place without adding duplicate order entry
          reg.workflows[legacyId] = cloneWorkflow(legacyStore);
          if (!reg.workflow_order.includes(legacyId)) {
            reg.workflow_order.push(legacyId);
          }
        } else {
          // External or unmigrated legacy workflow in STORAGE_KEY: merge into registry without losing existing entries
          reg.workflows[legacyId] = cloneWorkflow(legacyStore);
          reg.workflow_order.push(legacyId);
          reg.active_workflow_id = legacyId;
          try {
            const updatedRegStr = JSON.stringify(reg);
            s.setItem(REGISTRY_KEY, updatedRegStr);
          } catch {
            if (rawRegistry) {
              try {
                s.setItem(REGISTRY_KEY, rawRegistry);
              } catch {
                // Ignore
              }
            }
          }
        }
      }

      const activeId =
        reg.active_workflow_id && reg.workflows[reg.active_workflow_id]
          ? reg.active_workflow_id
          : reg.workflow_order[0];
      reg.active_workflow_id = activeId;

      this.registry = reg;
      this.inMemoryWorkflows.clear();
      for (const [id, wf] of Object.entries(reg.workflows)) {
        this.inMemoryWorkflows.set(id, cloneWorkflow(wf));
      }
      this.unsavedWorkflowIds.clear();
      this.isCorruptedLocked = false;
      this.corruptedRawData = null;
      this.isInitialPlaceholder = false;

      return {
        success: true,
        data: cloneWorkflow(reg.workflows[activeId])
      };
    } catch (e: any) {
      const fallback = cloneInitialState();
      this.registry = createInitialRegistry(fallback);
      this.inMemoryWorkflows.clear();
      this.inMemoryWorkflows.set(fallback.metadata.id, cloneWorkflow(fallback));
      return {
        success: false,
        data: fallback,
        error: `Browser storage is unavailable or unreadable: ${e?.message || 'Unknown error'}. Changes will remain in memory only.`
      };
    }
  }

  /**
   * Atomically writes the active workflow to STORAGE_KEY and the full registry to REGISTRY_KEY.
   * Rolls back both keys to their exact prior values if either write fails.
   */
  private persistRegistryAndActiveAtomically(
    nextRegistry: WorkflowRegistry,
    activeStore: WorkflowStore
  ): StorageSaveResult {
    const s = this.storage;
    if (!s) {
      return {
        success: false,
        error: 'Browser storage is unavailable. Please export your workflow as JSON to save your work.'
      };
    }

    if (!this.hasInspectedStorage) {
      try {
        const existingLegacy = s.getItem(STORAGE_KEY);
        const existingReg = s.getItem(REGISTRY_KEY);
        this.hasInspectedStorage = true;
        if (existingLegacy) {
          const check = validateWorkflowDraft(existingLegacy);
          if (!check.valid || !check.store) {
            this.isCorruptedLocked = true;
            this.corruptedRawData = existingLegacy;
          }
        } else if (existingReg) {
          const regCheck = validateRegistryImport(existingReg);
          if (!regCheck.valid || !regCheck.registry) {
            this.isCorruptedLocked = true;
            this.corruptedRawData = existingReg;
          }
        }
      } catch {
        // Handled below
      }
    }

    if (this.isCorruptedLocked) {
      return {
        success: false,
        isCorruptedLocked: true,
        error:
          'Auto-save is paused to protect corrupted data in local storage. Download the preserved raw data or explicitly confirm starting fresh to re-enable saving.'
      };
    }

    if (!this.isAvailable()) {
      return {
        success: false,
        error: 'Browser storage is unavailable. Please export your workflow as JSON to save your work.'
      };
    }

    let prevActiveRaw: string | null = null;
    let prevRegistryRaw: string | null = null;
    try {
      prevActiveRaw = s.getItem(STORAGE_KEY);
      prevRegistryRaw = s.getItem(REGISTRY_KEY);
    } catch {
      // Handled below
    }

    try {
      const serializedActive = JSON.stringify(activeStore);
      const serializedRegistry = JSON.stringify(nextRegistry);

      s.setItem(STORAGE_KEY, serializedActive);
      s.setItem(REGISTRY_KEY, serializedRegistry);

      if (s.getItem(STORAGE_KEY) !== serializedActive || s.getItem(REGISTRY_KEY) !== serializedRegistry) {
        throw new Error('Failed to verify atomic storage write.');
      }

      return { success: true };
    } catch (e: any) {
      // Roll back both keys so no partial registry or active workflow mutation remains
      try {
        if (prevActiveRaw === null) {
          s.removeItem(STORAGE_KEY);
        } else {
          s.setItem(STORAGE_KEY, prevActiveRaw);
        }
      } catch {
        // Ignore rollback write failure
      }
      try {
        if (prevRegistryRaw === null) {
          s.removeItem(REGISTRY_KEY);
        } else {
          s.setItem(REGISTRY_KEY, prevRegistryRaw);
        }
      } catch {
        // Ignore rollback write failure
      }

      if (isQuotaError(e)) {
        return {
          success: false,
          error:
            'Storage quota exceeded. Your workflow cannot be saved locally. Export as JSON immediately to preserve your changes.',
          isQuotaExceeded: true
        };
      }

      return {
        success: false,
        error: `Failed to persist workflow: ${e?.message || 'Unknown storage error'}`
      };
    }
  }

  /**
   * Saves the given workflow as the active workflow in local storage and updates the registry atomically.
   */
  public saveWorkflow(store: WorkflowStore): StorageSaveResult {
    if (!store.metadata.id) {
      store.metadata.id = generateUUID();
    }
    const wfId = store.metadata.id;
    const cloned = cloneWorkflow(store);

    // Keep in-memory copy updated even if persistence fails
    this.inMemoryWorkflows.set(wfId, cloned);

    const nextRegistry: WorkflowRegistry = {
      format: REGISTRY_FORMAT,
      registry_version: this.registry.registry_version || REGISTRY_VERSION,
      updated_at: new Date().toISOString(),
      active_workflow_id: wfId,
      workflow_order: [...this.registry.workflow_order],
      workflows: {}
    };

    for (const [id, wf] of Object.entries(this.registry.workflows)) {
      if (!wf) continue;
      if (this.isInitialPlaceholder && id !== wfId && !hasMeaningfulWorkflowData(wf)) {
        this.inMemoryWorkflows.delete(id);
        continue;
      }
      nextRegistry.workflows[id] = cloneWorkflow(wf);
    }
    nextRegistry.workflows[wfId] = cloned;
    nextRegistry.workflow_order = nextRegistry.workflow_order.filter(id => Boolean(nextRegistry.workflows[id]));
    if (!nextRegistry.workflow_order.includes(wfId)) {
      nextRegistry.workflow_order.push(wfId);
    }

    const result = this.persistRegistryAndActiveAtomically(nextRegistry, cloned);
    if (result.success) {
      this.registry = nextRegistry;
      this.isInitialPlaceholder = false;
      this.unsavedWorkflowIds.delete(wfId);
    } else {
      this.unsavedWorkflowIds.add(wfId);
      if (!this.registry.workflows[wfId]) {
        this.registry.workflows[wfId] = cloned;
      }
      if (!this.registry.workflow_order.includes(wfId)) {
        this.registry.workflow_order.push(wfId);
      }
      this.registry.active_workflow_id = wfId;
    }
    return result;
  }

  /**
   * Creates a new workflow in the registry while preserving all existing workflows in the registry.
   */
  public createWorkflowInRegistry(
    initialTitle: string = '',
    currentInMemoryStore?: WorkflowStore,
    currentHasUnsaved: boolean = false
  ): RegistryActionResult {
    this.isInitialPlaceholder = false;
    if (currentInMemoryStore) {
      this.syncInMemoryWorkflow(currentInMemoryStore, currentHasUnsaved);
    }

    const newWf = cloneInitialState(initialTitle);
    const newId = newWf.metadata.id;

    const nextRegistry: WorkflowRegistry = {
      format: REGISTRY_FORMAT,
      registry_version: this.registry.registry_version || REGISTRY_VERSION,
      updated_at: new Date().toISOString(),
      active_workflow_id: newId,
      workflow_order: [...this.registry.workflow_order],
      workflows: {}
    };

    for (const [id, wf] of Object.entries(this.registry.workflows)) {
      nextRegistry.workflows[id] = cloneWorkflow(wf);
    }
    if (currentInMemoryStore && currentInMemoryStore.metadata?.id) {
      const currId = currentInMemoryStore.metadata.id;
      if (!nextRegistry.workflows[currId]) {
        nextRegistry.workflows[currId] = cloneWorkflow(currentInMemoryStore);
      }
      if (!nextRegistry.workflow_order.includes(currId)) {
        nextRegistry.workflow_order.push(currId);
      }
    }

    nextRegistry.workflows[newId] = cloneWorkflow(newWf);
    if (!nextRegistry.workflow_order.includes(newId)) {
      nextRegistry.workflow_order.push(newId);
    }

    const saveResult = this.persistRegistryAndActiveAtomically(nextRegistry, newWf);
    this.inMemoryWorkflows.set(newId, cloneWorkflow(newWf));

    if (saveResult.success) {
      this.registry = nextRegistry;
      this.unsavedWorkflowIds.delete(newId);
      return {
        success: true,
        persisted: true,
        activeWorkflow: cloneWorkflow(newWf),
        hasUnsavedChanges: false
      };
    }

    // Even if storage write failed, preserve in memory or report error
    this.registry = nextRegistry;
    this.unsavedWorkflowIds.add(newId);
    return {
      success: false,
      persisted: false,
      activeWorkflow: cloneWorkflow(newWf),
      hasUnsavedChanges: true,
      error: saveResult.error,
      isQuotaExceeded: saveResult.isQuotaExceeded,
      isCorruptedLocked: saveResult.isCorruptedLocked
    };
  }

  /**
   * Switches the active workflow in the registry while preserving unsaved in-memory edits
   * on both the outgoing workflow and the target workflow.
   */
  public switchWorkflow(
    targetId: string,
    currentInMemoryStore?: WorkflowStore,
    currentHasUnsaved: boolean = false
  ): RegistryActionResult {
    if (currentInMemoryStore) {
      this.syncInMemoryWorkflow(currentInMemoryStore, currentHasUnsaved);
    }

    const targetWf = this.inMemoryWorkflows.get(targetId) ?? this.registry.workflows[targetId];
    if (!targetWf) {
      const currentActive =
        currentInMemoryStore ??
        this.inMemoryWorkflows.get(this.registry.active_workflow_id) ??
        this.registry.workflows[this.registry.active_workflow_id] ??
        cloneInitialState();
      return {
        success: false,
        persisted: false,
        activeWorkflow: cloneWorkflow(currentActive),
        hasUnsavedChanges: currentHasUnsaved,
        error: `Workflow "${targetId}" was not found in the local registry.`
      };
    }

    const targetIsUnsaved = this.unsavedWorkflowIds.has(targetId);
    const persistedTargetWf = this.registry.workflows[targetId] ?? targetWf;

    const nextRegistry: WorkflowRegistry = {
      ...this.registry,
      updated_at: new Date().toISOString(),
      active_workflow_id: targetId,
      workflow_order: [...this.registry.workflow_order],
      workflows: { ...this.registry.workflows }
    };
    if (!nextRegistry.workflows[targetId]) {
      nextRegistry.workflows[targetId] = cloneWorkflow(persistedTargetWf);
    }
    if (!nextRegistry.workflow_order.includes(targetId)) {
      nextRegistry.workflow_order.push(targetId);
    }

    this.registry = nextRegistry;

    // Only overwrite STORAGE_KEY if the target workflow doesn't have unpersisted changes or if we persist its last saved state
    const saveResult = this.persistRegistryAndActiveAtomically(nextRegistry, persistedTargetWf);

    return {
      success: true,
      persisted: saveResult.success && !targetIsUnsaved,
      activeWorkflow: cloneWorkflow(targetWf),
      hasUnsavedChanges: targetIsUnsaved || !saveResult.success,
      error: saveResult.error
    };
  }

  /**
   * Duplicates a workflow in the registry with a fresh workflow UUID while preserving
   * all step data, governance settings, and unknown fields.
   */
  public duplicateWorkflow(
    sourceId?: string,
    currentInMemoryStore?: WorkflowStore,
    currentHasUnsaved: boolean = false
  ): RegistryActionResult {
    if (currentInMemoryStore) {
      this.syncInMemoryWorkflow(currentInMemoryStore, currentHasUnsaved);
    }

    const resolvedSourceId = sourceId || this.registry.active_workflow_id;
    const sourceWf =
      (currentInMemoryStore && currentInMemoryStore.metadata?.id === resolvedSourceId
        ? currentInMemoryStore
        : null) ??
      this.inMemoryWorkflows.get(resolvedSourceId) ??
      this.registry.workflows[resolvedSourceId];

    if (!sourceWf) {
      const fallback = currentInMemoryStore ?? cloneInitialState();
      return {
        success: false,
        persisted: false,
        activeWorkflow: cloneWorkflow(fallback),
        error: `Cannot duplicate: workflow "${resolvedSourceId}" not found.`
      };
    }

    const duplicate = cloneWorkflow(sourceWf);
    const newId = generateUUID();
    duplicate.metadata.id = newId;
    duplicate.metadata.created_at = new Date().toISOString();
    const baseTitle = duplicate.metadata.title?.trim() || 'Untitled Workflow';
    duplicate.metadata.title = `${baseTitle} (Copy)`;

    const nextRegistry: WorkflowRegistry = {
      format: REGISTRY_FORMAT,
      registry_version: this.registry.registry_version || REGISTRY_VERSION,
      updated_at: new Date().toISOString(),
      active_workflow_id: newId,
      workflow_order: [...this.registry.workflow_order],
      workflows: {}
    };
    for (const [id, wf] of Object.entries(this.registry.workflows)) {
      nextRegistry.workflows[id] = cloneWorkflow(wf);
    }
    if (!nextRegistry.workflows[resolvedSourceId]) {
      nextRegistry.workflows[resolvedSourceId] = cloneWorkflow(sourceWf);
    }
    if (!nextRegistry.workflow_order.includes(resolvedSourceId)) {
      nextRegistry.workflow_order.push(resolvedSourceId);
    }

    nextRegistry.workflows[newId] = cloneWorkflow(duplicate);
    nextRegistry.workflow_order.push(newId);

    const saveResult = this.persistRegistryAndActiveAtomically(nextRegistry, duplicate);
    if (saveResult.success) {
      this.registry = nextRegistry;
      this.inMemoryWorkflows.set(newId, cloneWorkflow(duplicate));
      this.unsavedWorkflowIds.delete(newId);
      return {
        success: true,
        persisted: true,
        activeWorkflow: cloneWorkflow(duplicate),
        hasUnsavedChanges: false
      };
    }

    return {
      success: false,
      persisted: false,
      activeWorkflow: cloneWorkflow(sourceWf),
      hasUnsavedChanges: currentHasUnsaved,
      error: saveResult.error,
      isQuotaExceeded: saveResult.isQuotaExceeded,
      isCorruptedLocked: saveResult.isCorruptedLocked
    };
  }

  /**
   * Renames a workflow in the registry and persists atomically.
   */
  public renameWorkflow(
    targetId: string,
    newTitle: string,
    currentInMemoryStore?: WorkflowStore,
    currentHasUnsaved: boolean = false
  ): RegistryActionResult {
    if (currentInMemoryStore) {
      this.syncInMemoryWorkflow(currentInMemoryStore, currentHasUnsaved);
    }

    const wf = this.inMemoryWorkflows.get(targetId) ?? this.registry.workflows[targetId];
    if (!wf) {
      const fallback = currentInMemoryStore ?? cloneInitialState();
      return {
        success: false,
        persisted: false,
        activeWorkflow: cloneWorkflow(fallback),
        error: `Workflow "${targetId}" not found.`
      };
    }

    const updatedWf = cloneWorkflow(wf);
    updatedWf.metadata.title = newTitle.trim();

    const nextRegistry: WorkflowRegistry = {
      format: REGISTRY_FORMAT,
      registry_version: this.registry.registry_version || REGISTRY_VERSION,
      updated_at: new Date().toISOString(),
      active_workflow_id: this.registry.active_workflow_id,
      workflow_order: [...this.registry.workflow_order],
      workflows: {}
    };
    for (const [id, existing] of Object.entries(this.registry.workflows)) {
      nextRegistry.workflows[id] = cloneWorkflow(existing);
    }
    nextRegistry.workflows[targetId] = cloneWorkflow(updatedWf);
    if (!nextRegistry.workflow_order.includes(targetId)) {
      nextRegistry.workflow_order.push(targetId);
    }

    const activeId = nextRegistry.active_workflow_id;
    const activeWf = nextRegistry.workflows[activeId] ?? updatedWf;

    const saveResult = this.persistRegistryAndActiveAtomically(nextRegistry, activeWf);
    if (saveResult.success) {
      this.registry = nextRegistry;
      this.inMemoryWorkflows.set(targetId, cloneWorkflow(updatedWf));
      if (targetId === activeId) {
        this.unsavedWorkflowIds.delete(targetId);
      }
      return {
        success: true,
        persisted: true,
        activeWorkflow: cloneWorkflow(this.inMemoryWorkflows.get(activeId) ?? activeWf),
        hasUnsavedChanges: this.unsavedWorkflowIds.has(activeId)
      };
    }

    return {
      success: false,
      persisted: false,
      activeWorkflow: cloneWorkflow(wf),
      hasUnsavedChanges: currentHasUnsaved,
      error: saveResult.error,
      isQuotaExceeded: saveResult.isQuotaExceeded,
      isCorruptedLocked: saveResult.isCorruptedLocked
    };
  }

  /**
   * Deletes a workflow from the registry after creating a verified protective backup.
   * Rolls back atomically if persistence fails.
   */
  public deleteWorkflow(
    targetId: string,
    currentInMemoryStore?: WorkflowStore,
    currentHasUnsaved: boolean = false
  ): RegistryActionResult {
    if (currentInMemoryStore) {
      this.syncInMemoryWorkflow(currentInMemoryStore, currentHasUnsaved);
    }

    const targetWf = this.inMemoryWorkflows.get(targetId) ?? this.registry.workflows[targetId];
    if (!targetWf) {
      const fallback = currentInMemoryStore ?? cloneInitialState();
      return {
        success: false,
        persisted: false,
        activeWorkflow: cloneWorkflow(fallback),
        error: `Workflow "${targetId}" not found.`
      };
    }

    const backupResult = this.createProtectiveBackup(targetWf);
    if (!backupResult.success) {
      return {
        success: false,
        persisted: false,
        activeWorkflow: cloneWorkflow(targetWf),
        hasUnsavedChanges: currentHasUnsaved,
        error: backupResult.error
      };
    }

    const nextOrder = this.registry.workflow_order.filter(id => id !== targetId);
    const nextWorkflows: Record<string, WorkflowStore> = {};
    for (const [id, wf] of Object.entries(this.registry.workflows)) {
      if (id !== targetId) {
        nextWorkflows[id] = cloneWorkflow(wf);
      }
    }

    let nextActiveWf: WorkflowStore;
    let nextActiveId: string;

    if (nextOrder.length === 0 || Object.keys(nextWorkflows).length === 0) {
      nextActiveWf = cloneInitialState();
      nextActiveId = nextActiveWf.metadata.id;
      nextWorkflows[nextActiveId] = cloneWorkflow(nextActiveWf);
      nextOrder.push(nextActiveId);
    } else {
      nextActiveId =
        this.registry.active_workflow_id !== targetId && nextWorkflows[this.registry.active_workflow_id]
          ? this.registry.active_workflow_id
          : nextOrder[0];
      nextActiveWf = cloneWorkflow(this.inMemoryWorkflows.get(nextActiveId) ?? nextWorkflows[nextActiveId]);
    }

    const nextRegistry: WorkflowRegistry = {
      format: REGISTRY_FORMAT,
      registry_version: this.registry.registry_version || REGISTRY_VERSION,
      updated_at: new Date().toISOString(),
      active_workflow_id: nextActiveId,
      workflow_order: nextOrder,
      workflows: nextWorkflows
    };

    const saveResult = this.persistRegistryAndActiveAtomically(nextRegistry, nextActiveWf);
    if (!saveResult.success) {
      this.rollbackProtectiveBackup(backupResult.previousBackup);
      return {
        success: false,
        persisted: false,
        activeWorkflow: cloneWorkflow(targetWf),
        hasUnsavedChanges: currentHasUnsaved,
        error: saveResult.error,
        isQuotaExceeded: saveResult.isQuotaExceeded,
        isCorruptedLocked: saveResult.isCorruptedLocked
      };
    }

    this.registry = nextRegistry;
    this.inMemoryWorkflows.delete(targetId);
    this.unsavedWorkflowIds.delete(targetId);
    this.inMemoryWorkflows.set(nextActiveId, cloneWorkflow(nextActiveWf));

    return {
      success: true,
      persisted: true,
      backedUp: backupResult.backedUp,
      activeWorkflow: cloneWorkflow(nextActiveWf),
      hasUnsavedChanges: this.unsavedWorkflowIds.has(nextActiveId)
    };
  }

  /**
   * Atomically replaces the workflow registry from a validated registry backup payload,
   * creating a protective backup first and rolling back if persistence fails.
   */
  public replaceRegistry(
    newRegistry: WorkflowRegistry,
    backupTarget?: WorkflowStore
  ): RegistryActionResult {
    const backupResult = this.createProtectiveBackup(backupTarget);
    if (!backupResult.success) {
      const currentActive =
        backupTarget ??
        this.inMemoryWorkflows.get(this.registry.active_workflow_id) ??
        this.registry.workflows[this.registry.active_workflow_id] ??
        cloneInitialState();
      return {
        success: false,
        persisted: false,
        activeWorkflow: cloneWorkflow(currentActive),
        error: backupResult.error
      };
    }

    const activeId =
      newRegistry.active_workflow_id && newRegistry.workflows[newRegistry.active_workflow_id]
        ? newRegistry.active_workflow_id
        : newRegistry.workflow_order[0];
    const activeWf = cloneWorkflow(newRegistry.workflows[activeId]);

    const normalizedRegistry: WorkflowRegistry = {
      format: REGISTRY_FORMAT,
      registry_version: newRegistry.registry_version || REGISTRY_VERSION,
      updated_at: new Date().toISOString(),
      active_workflow_id: activeId,
      workflow_order: [...newRegistry.workflow_order],
      workflows: {}
    };
    for (const [id, wf] of Object.entries(newRegistry.workflows)) {
      normalizedRegistry.workflows[id] = cloneWorkflow(wf);
    }

    const saveResult = this.persistRegistryAndActiveAtomically(normalizedRegistry, activeWf);
    if (!saveResult.success) {
      this.rollbackProtectiveBackup(backupResult.previousBackup);
      const currentActive =
        backupTarget ??
        this.inMemoryWorkflows.get(this.registry.active_workflow_id) ??
        this.registry.workflows[this.registry.active_workflow_id] ??
        cloneInitialState();
      return {
        success: false,
        persisted: false,
        activeWorkflow: cloneWorkflow(currentActive),
        error: saveResult.error,
        isQuotaExceeded: saveResult.isQuotaExceeded,
        isCorruptedLocked: saveResult.isCorruptedLocked
      };
    }

    this.registry = normalizedRegistry;
    this.inMemoryWorkflows.clear();
    for (const [id, wf] of Object.entries(normalizedRegistry.workflows)) {
      this.inMemoryWorkflows.set(id, cloneWorkflow(wf));
    }
    this.unsavedWorkflowIds.clear();

    return {
      success: true,
      persisted: true,
      backedUp: backupResult.backedUp,
      activeWorkflow: cloneWorkflow(activeWf),
      hasUnsavedChanges: false
    };
  }

  /**
   * Explicitly discards unrecoverable corrupted data after user confirmation and saves the active workflow.
   */
  public discardCorruptedDataAndSave(store: WorkflowStore): StorageSaveResult {
    const previousRaw = this.corruptedRawData;
    this.isCorruptedLocked = false;
    this.corruptedRawData = null;
    this.hasInspectedStorage = true;

    const result = this.saveWorkflow(store);
    if (!result.success) {
      this.isCorruptedLocked = previousRaw !== null;
      this.corruptedRawData = previousRaw;
    }
    return result;
  }

  /**
   * Checks whether the in-memory workflow has meaningful unsaved changes that differ from
   * a non-empty persisted workflow in STORAGE_KEY.
   */
  public hasDivergentUnsavedWork(inMemoryStore?: WorkflowStore): boolean {
    const s = this.storage;
    if (!s || !inMemoryStore || !hasMeaningfulWorkflowData(inMemoryStore)) return false;
    try {
      const current = s.getItem(STORAGE_KEY);
      if (!current) return false;
      const check = validateWorkflowDraft(current);
      if (!check.valid || !check.store || !hasMeaningfulWorkflowData(check.store)) {
        return false;
      }
      return JSON.stringify(inMemoryStore) !== current;
    } catch {
      return false;
    }
  }

  /**
   * Checks whether a protective backup would be created for the given state without mutating storage.
   */
  public wouldCreateBackup(inMemoryStore?: WorkflowStore): boolean {
    if (hasMeaningfulWorkflowData(inMemoryStore)) return true;
    const s = this.storage;
    if (!s) return false;
    try {
      return Boolean(s.getItem(STORAGE_KEY));
    } catch {
      return false;
    }
  }

  /**
   * Creates and verifies a protective backup before destructive actions
   * (e.g. New Workflow, Import JSON, Save Demo Copy, Delete Workflow, Import Registry).
   * Protects both persisted storage data and meaningful unsaved in-memory work.
   * Preserves previousBackup so the caller can roll back if the subsequent save fails.
   */
  public createProtectiveBackup(inMemoryStore?: WorkflowStore): BackupResult {
    const s = this.storage;
    if (!s) {
      return {
        success: false,
        backedUp: false,
        error: 'Storage is unavailable. Protective backup cannot be verified.'
      };
    }

    if (this.isCorruptedLocked) {
      return {
        success: false,
        backedUp: false,
        error:
          'Local storage contains unrecovered corrupted data. Resolve or download the corrupted data before replacing the workflow.'
      };
    }

    try {
      const previousBackup = s.getItem(BACKUP_KEY);
      const current = s.getItem(STORAGE_KEY);
      const hasInMemoryWork = hasMeaningfulWorkflowData(inMemoryStore);
      const divergent = this.hasDivergentUnsavedWork(inMemoryStore);

      let payloadToBackup: string | null = null;
      if (hasInMemoryWork && inMemoryStore) {
        const serializedInMemory = JSON.stringify(inMemoryStore);
        payloadToBackup = !current || serializedInMemory !== current ? serializedInMemory : current;
      } else if (current) {
        payloadToBackup = current;
      }

      if (!payloadToBackup) {
        return { success: true, backedUp: false, previousBackup, divergentFromPersisted: false };
      }

      s.setItem(BACKUP_KEY, payloadToBackup);
      const verified = s.getItem(BACKUP_KEY);
      if (verified !== payloadToBackup) {
        return {
          success: false,
          backedUp: false,
          previousBackup,
          error: 'Failed to verify protective backup in local storage.'
        };
      }

      return {
        success: true,
        backedUp: true,
        previousBackup,
        divergentFromPersisted: divergent
      };
    } catch (e: any) {
      return {
        success: false,
        backedUp: false,
        error: `Failed to create protective backup: ${e?.message || 'Storage error'}`
      };
    }
  }

  /**
   * Attempts to restore the previous backup state when a subsequent active-workflow save fails.
   * If no previous backup existed (previousBackup is null/undefined), retains the newly created
   * valid backup so a recoverable backup remains available.
   * Never claims rollback succeeded without verifying the read-back.
   */
  public rollbackProtectiveBackup(previousBackup: string | null | undefined): BackupRollbackResult {
    if (!previousBackup) {
      return { rolledBack: true };
    }
    const s = this.storage;
    if (!s) {
      return {
        rolledBack: false,
        error: 'Storage unavailable; previous backup slot could not be restored.'
      };
    }
    try {
      s.setItem(BACKUP_KEY, previousBackup);
      const verified = s.getItem(BACKUP_KEY);
      if (verified !== previousBackup) {
        return {
          rolledBack: false,
          error: 'Previous backup slot verification failed; the most recent pre-operation backup remains in place.'
        };
      }
      return { rolledBack: true };
    } catch (e: any) {
      return {
        rolledBack: false,
        error: `Could not roll back to previous backup (${e?.message || 'storage write error'}); the most recent pre-operation backup remains preserved.`
      };
    }
  }

  /**
   * Checks whether a valid protective backup exists in storage.
   */
  public hasProtectiveBackup(): boolean {
    const raw = this.getProtectiveBackup();
    if (!raw) return false;
    const validation = validateWorkflowDraft(raw);
    return Boolean(validation.valid && validation.store);
  }

  /**
   * Reads protective backup data if available.
   */
  public getProtectiveBackup(): string | null {
    const s = this.storage;
    if (!s) return null;
    try {
      return s.getItem(BACKUP_KEY);
    } catch {
      return null;
    }
  }

  /**
   * Validates and restores protective backup, falling back to safe in-memory recovery
   * if writing to the active STORAGE_KEY fails. Never deletes or overwrites BACKUP_KEY on failure.
   */
  public restoreProtectiveBackupWithFallback(): BackupRestoreResult {
    const s = this.storage;
    if (!s) {
      return {
        success: false,
        persisted: false,
        error: 'Browser storage is unavailable; backup cannot be read.'
      };
    }

    let backup: string | null = null;
    try {
      backup = s.getItem(BACKUP_KEY);
    } catch (e: any) {
      return {
        success: false,
        persisted: false,
        error: `Failed to read protective backup: ${e?.message || 'Storage read error'}`
      };
    }

    if (!backup) {
      return {
        success: false,
        persisted: false,
        error: 'No protective backup found in local storage.'
      };
    }

    const validation = validateWorkflowDraft(backup);
    if (!validation.valid || !validation.store) {
      return {
        success: false,
        persisted: false,
        error: `Protective backup is invalid: ${validation.errors.join('; ')}`
      };
    }

    const restoredStore = validation.store;
    const restoredId = restoredStore.metadata.id || generateUUID();
    restoredStore.metadata.id = restoredId;

    try {
      s.setItem(STORAGE_KEY, backup);
      const verified = s.getItem(STORAGE_KEY);
      if (verified !== backup) {
        this.inMemoryWorkflows.set(restoredId, cloneWorkflow(restoredStore));
        this.unsavedWorkflowIds.add(restoredId);
        this.registry.active_workflow_id = restoredId;
        return {
          success: true,
          persisted: false,
          data: restoredStore,
          error: 'Could not verify write to active local storage.'
        };
      }

      // Synchronize registry with restored workflow
      this.registry.workflows[restoredId] = cloneWorkflow(restoredStore);
      if (!this.registry.workflow_order.includes(restoredId)) {
        this.registry.workflow_order.push(restoredId);
      }
      this.registry.active_workflow_id = restoredId;
      this.registry.updated_at = new Date().toISOString();
      this.inMemoryWorkflows.set(restoredId, cloneWorkflow(restoredStore));
      this.unsavedWorkflowIds.delete(restoredId);

      try {
        s.setItem(REGISTRY_KEY, JSON.stringify(this.registry));
      } catch {
        // Active STORAGE_KEY is already verified
      }

      this.isCorruptedLocked = false;
      this.corruptedRawData = null;
      this.hasInspectedStorage = true;
      return {
        success: true,
        persisted: true,
        data: restoredStore
      };
    } catch (e: any) {
      this.inMemoryWorkflows.set(restoredId, cloneWorkflow(restoredStore));
      this.unsavedWorkflowIds.add(restoredId);
      this.registry.active_workflow_id = restoredId;
      return {
        success: true,
        persisted: false,
        data: restoredStore,
        error: e?.message || 'Active local storage write failed.'
      };
    }
  }

  /**
   * Restores protective backup to active storage and verifies it.
   */
  public restoreProtectiveBackup(): boolean {
    const result = this.restoreProtectiveBackupWithFallback();
    return Boolean(result.success && result.persisted);
  }

  /**
   * Removes protective backup.
   */
  public clearProtectiveBackup(): void {
    const s = this.storage;
    if (!s) return;
    try {
      s.removeItem(BACKUP_KEY);
    } catch {
      // Ignore
    }
  }
}
