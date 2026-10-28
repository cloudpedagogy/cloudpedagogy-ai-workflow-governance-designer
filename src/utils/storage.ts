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
  rollbackFailed?: boolean;
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
  activeSwitchPersistFailed?: boolean;
  rollbackFailed?: boolean;
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
 *
 * State separation:
 * - `this.registry` tracks the last known persisted registry state (only updated on verified writes/loads).
 * - `this.inMemoryWorkflows`, `this.inMemoryOrder`, and `this.inMemoryActiveId` track the live working session.
 * - `this.unsavedWorkflowIds` tracks strictly those workflows whose content has unpersisted in-memory edits.
 */
export class StorageManager {
  private customStorage?: Storage;
  private isCorruptedLocked: boolean = false;
  private corruptedRawData: string | null = null;
  private hasInspectedStorage: boolean = false;
  private registry: WorkflowRegistry = createInitialRegistry();
  private inMemoryWorkflows: Map<string, WorkflowStore> = new Map();
  private inMemoryOrder: string[] = [];
  private inMemoryActiveId: string = '';
  private unsavedWorkflowIds: Set<string> = new Set();
  private isInitialPlaceholder: boolean = true;

  constructor(customStorage?: Storage) {
    this.customStorage = customStorage;
    const activeId = this.registry.active_workflow_id;
    this.inMemoryActiveId = activeId;
    this.inMemoryOrder = [activeId];
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
   * Synchronizes the in-memory working copy and content-unsaved status of a workflow
   * so switching workflows never loses unsaved in-memory edits.
   */
  public syncInMemoryWorkflow(store: WorkflowStore, hasUnsavedChanges: boolean): void {
    if (!store || !store.metadata) return;
    const id = store.metadata.id || generateUUID();
    store.metadata.id = id;
    const cloned = cloneWorkflow(store);
    this.inMemoryWorkflows.set(id, cloned);
    if (!this.inMemoryOrder.includes(id)) {
      this.inMemoryOrder.push(id);
    }
    if (hasMeaningfulWorkflowData(cloned) || hasUnsavedChanges) {
      this.isInitialPlaceholder = false;
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
   * Builds a candidate WorkflowRegistry preferring the latest in-memory workflow state
   * over older persisted copies in `this.registry.workflows`.
   * Never discards an initial placeholder if it has meaningful data or unsaved edits in `inMemoryWorkflows`.
   */
  private buildNextRegistryFromMemory(activeId: string, excludeId?: string): WorkflowRegistry {
    const combinedOrder: string[] = [];
    for (const id of this.inMemoryOrder) {
      if (id && id !== excludeId && !combinedOrder.includes(id)) {
        combinedOrder.push(id);
      }
    }
    for (const id of this.registry.workflow_order) {
      if (id && id !== excludeId && !combinedOrder.includes(id)) {
        combinedOrder.push(id);
      }
    }
    for (const id of this.inMemoryWorkflows.keys()) {
      if (id && id !== excludeId && !combinedOrder.includes(id)) {
        combinedOrder.push(id);
      }
    }
    for (const id of Object.keys(this.registry.workflows)) {
      if (id && id !== excludeId && !combinedOrder.includes(id)) {
        combinedOrder.push(id);
      }
    }

    const workflows: Record<string, WorkflowStore> = {};
    const finalOrder: string[] = [];

    for (const id of combinedOrder) {
      const latestWf = this.inMemoryWorkflows.get(id) ?? this.registry.workflows[id];
      if (!latestWf) continue;

      if (
        this.isInitialPlaceholder &&
        id !== activeId &&
        !hasMeaningfulWorkflowData(latestWf) &&
        !this.unsavedWorkflowIds.has(id)
      ) {
        this.inMemoryWorkflows.delete(id);
        this.inMemoryOrder = this.inMemoryOrder.filter(k => k !== id);
        continue;
      }

      workflows[id] = cloneWorkflow(latestWf);
      finalOrder.push(id);
    }

    const resolvedActiveId =
      activeId && workflows[activeId] ? activeId : finalOrder[0] || activeId;

    return {
      format: REGISTRY_FORMAT,
      registry_version: this.registry.registry_version || REGISTRY_VERSION,
      updated_at: new Date().toISOString(),
      active_workflow_id: resolvedActiveId,
      workflow_order: finalOrder,
      workflows
    };
  }

  /**
   * Returns a snapshot of the full workflow registry including any unsaved in-memory edits.
   */
  public getRegistrySnapshot(): WorkflowRegistry {
    const activeId = this.inMemoryActiveId || this.registry.active_workflow_id;
    return this.buildNextRegistryFromMemory(activeId);
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
    return this.inMemoryActiveId || this.registry.active_workflow_id;
  }

  private resetWorkingStateFromRegistry(reg: WorkflowRegistry, isPlaceholder: boolean): void {
    this.registry = reg;
    this.inMemoryWorkflows.clear();
    this.inMemoryOrder = [...reg.workflow_order];
    this.inMemoryActiveId = reg.active_workflow_id;
    for (const [id, wf] of Object.entries(reg.workflows)) {
      this.inMemoryWorkflows.set(id, cloneWorkflow(wf));
      if (!this.inMemoryOrder.includes(id)) {
        this.inMemoryOrder.push(id);
      }
    }
    this.unsavedWorkflowIds.clear();
    this.isInitialPlaceholder = isPlaceholder;
  }

  /**
   * Loads and validates workflows from local storage, safely migrating legacy
   * cp_workflow_designer records into the versioned registry without duplicating
   * records on subsequent launches, overwriting newer registry records with an
   * older compatibility mirror, or overwriting corrupted storage data.
   */
  public loadWorkflow(): StorageLoadResult {
    const s = this.storage;
    if (!s) {
      const fallback = cloneInitialState();
      const reg = createInitialRegistry(fallback);
      this.resetWorkingStateFromRegistry(reg, true);
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
          this.resetWorkingStateFromRegistry(createInitialRegistry(safeFallback), true);
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
          this.resetWorkingStateFromRegistry(createInitialRegistry(fallbackData), !legacyStore);
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
        this.resetWorkingStateFromRegistry(createInitialRegistry(fresh), true);

        if (!this.isAvailable()) {
          return {
            success: false,
            data: fresh,
            error: 'Browser storage is unavailable. Changes will remain in memory only.'
          };
        }
        this.isCorruptedLocked = false;
        this.corruptedRawData = null;
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

        try {
          const serializedReg = JSON.stringify(migratedRegistry);
          s.setItem(REGISTRY_KEY, serializedReg);
          if (s.getItem(REGISTRY_KEY) !== serializedReg) {
            s.removeItem(REGISTRY_KEY);
          }
        } catch {
          try {
            s.removeItem(REGISTRY_KEY);
          } catch {
            // Ignore cleanup failure
          }
        }

        this.resetWorkingStateFromRegistry(migratedRegistry, false);
        this.isCorruptedLocked = false;
        this.corruptedRawData = null;
        return {
          success: true,
          data: cloneWorkflow(legacyStore)
        };
      }

      // 5. REGISTRY_KEY exists and is valid -> treat REGISTRY_KEY as authoritative for IDs already present!
      const reg = loadedRegistry!;
      let registryModifiedByUnmigratedLegacy = false;

      if (legacyStore) {
        const legacyId = legacyStore.metadata.id || generateUUID();
        legacyStore.metadata.id = legacyId;

        if (reg.workflows[legacyId]) {
          // Defect 4A fix: Do NOT overwrite authoritative registry workflow with an older STORAGE_KEY mirror.
          if (!reg.workflow_order.includes(legacyId)) {
            reg.workflow_order.push(legacyId);
          }
        } else if (hasMeaningfulWorkflowData(legacyStore)) {
          // Legacy workflow ID is absent from registry and has meaningful data: safely include it without
          // clobbering existing registry workflows or overriding an existing valid active_workflow_id.
          reg.workflows[legacyId] = cloneWorkflow(legacyStore);
          reg.workflow_order.push(legacyId);
          registryModifiedByUnmigratedLegacy = true;
        }
      }

      const activeId =
        reg.active_workflow_id && reg.workflows[reg.active_workflow_id]
          ? reg.active_workflow_id
          : reg.workflow_order[0];
      reg.active_workflow_id = activeId;

      const authoritativeActiveWf = reg.workflows[activeId];
      const serializedAuthoritativeActive = JSON.stringify(authoritativeActiveWf);

      this.resetWorkingStateFromRegistry(reg, false);
      this.isCorruptedLocked = false;
      this.corruptedRawData = null;

      // Keep the active-workflow mirror consistent with the registry's active_workflow_id where storage permits
      let mirrorSyncError: string | undefined;
      if (registryModifiedByUnmigratedLegacy) {
        try {
          const updatedRegStr = JSON.stringify(reg);
          s.setItem(REGISTRY_KEY, updatedRegStr);
          if (s.getItem(REGISTRY_KEY) !== updatedRegStr && rawRegistry) {
            s.setItem(REGISTRY_KEY, rawRegistry);
          }
        } catch (regSyncErr: any) {
          if (rawRegistry) {
            try {
              s.setItem(REGISTRY_KEY, rawRegistry);
            } catch {
              // Ignore
            }
          }
          mirrorSyncError = `Registry migration update failed: ${regSyncErr?.message || 'Storage write error'}`;
        }
      }

      if (rawLegacy !== null && rawLegacy !== serializedAuthoritativeActive) {
        try {
          s.setItem(STORAGE_KEY, serializedAuthoritativeActive);
          if (s.getItem(STORAGE_KEY) !== serializedAuthoritativeActive) {
            mirrorSyncError =
              'Active workflow mirror in local storage could not be verified after synchronization with the registry.';
          }
        } catch (syncErr: any) {
          mirrorSyncError = `Active workflow mirror could not be synchronized with registry: ${syncErr?.message || 'Storage write error'}`;
        }
      }

      if (mirrorSyncError) {
        return {
          success: false,
          data: cloneWorkflow(authoritativeActiveWf),
          error: mirrorSyncError
        };
      }

      return {
        success: true,
        data: cloneWorkflow(authoritativeActiveWf)
      };
    } catch (e: any) {
      const fallback = cloneInitialState();
      this.resetWorkingStateFromRegistry(createInitialRegistry(fallback), true);
      return {
        success: false,
        data: fallback,
        error: `Browser storage is unavailable or unreadable: ${e?.message || 'Unknown error'}. Changes will remain in memory only.`
      };
    }
  }

  /**
   * Writes the active workflow to STORAGE_KEY and the full registry to REGISTRY_KEY.
   * If either write fails, attempts to roll back both keys to their prior values,
   * verifies both keys against their prior values, and explicitly reports rollback failure
   * and potential key divergence if verification fails.
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
    } catch (readErr: any) {
      return {
        success: false,
        error: `Failed to read existing storage state prior to write: ${readErr?.message || 'Storage read error'}`
      };
    }

    try {
      const serializedActive = JSON.stringify(activeStore);
      const serializedRegistry = JSON.stringify(nextRegistry);

      s.setItem(STORAGE_KEY, serializedActive);
      s.setItem(REGISTRY_KEY, serializedRegistry);

      if (s.getItem(STORAGE_KEY) !== serializedActive || s.getItem(REGISTRY_KEY) !== serializedRegistry) {
        throw new Error('Failed to verify dual-key storage write.');
      }

      return { success: true, rollbackFailed: false };
    } catch (e: any) {
      let rollbackErrors: string[] = [];
      try {
        if (s.getItem(STORAGE_KEY) !== prevActiveRaw) {
          if (prevActiveRaw === null) {
            s.removeItem(STORAGE_KEY);
          } else {
            s.setItem(STORAGE_KEY, prevActiveRaw);
          }
        }
      } catch (rbActiveErr: any) {
        rollbackErrors.push(`Active mirror rollback error: ${rbActiveErr?.message || 'write failed'}`);
      }

      try {
        if (s.getItem(REGISTRY_KEY) !== prevRegistryRaw) {
          if (prevRegistryRaw === null) {
            s.removeItem(REGISTRY_KEY);
          } else {
            s.setItem(REGISTRY_KEY, prevRegistryRaw);
          }
        }
      } catch (rbRegErr: any) {
        rollbackErrors.push(`Registry rollback error: ${rbRegErr?.message || 'write failed'}`);
      }

      let activeVerified = false;
      let registryVerified = false;
      try {
        activeVerified = s.getItem(STORAGE_KEY) === prevActiveRaw;
        registryVerified = s.getItem(REGISTRY_KEY) === prevRegistryRaw;
      } catch {
        activeVerified = false;
        registryVerified = false;
      }

      const rollbackFailed = !activeVerified || !registryVerified || rollbackErrors.length > 0;
      const rollbackNotice = rollbackFailed
        ? ` Rollback verification failed (active mirror restored: ${activeVerified}, registry restored: ${registryVerified}${rollbackErrors.length > 0 ? '; ' + rollbackErrors.join('; ') : ''}). Storage keys may have diverged; export a Full Registry Backup immediately.`
        : '';

      if (isQuotaError(e)) {
        return {
          success: false,
          isQuotaExceeded: true,
          rollbackFailed,
          error: `Storage quota exceeded. Your workflow cannot be saved locally. Export as JSON immediately to preserve your changes.${rollbackNotice}`
        };
      }

      return {
        success: false,
        rollbackFailed,
        error: `Failed to persist workflow: ${e?.message || 'Unknown storage error'}${rollbackNotice}`
      };
    }
  }

  /**
   * Saves the given workflow as the active workflow in local storage and updates the registry.
   * Uses the latest in-memory state across all workflows and only commits `this.registry` on verified persistence.
   */
  public saveWorkflow(store: WorkflowStore): StorageSaveResult {
    if (!store.metadata.id) {
      store.metadata.id = generateUUID();
    }
    const wfId = store.metadata.id;
    const cloned = cloneWorkflow(store);
    const existedInSession =
      this.inMemoryWorkflows.has(wfId) || Boolean(this.registry.workflows[wfId]);
    const prevInMemoryWf = this.inMemoryWorkflows.get(wfId);
    const prevOrder = [...this.inMemoryOrder];
    const prevActiveId = this.inMemoryActiveId;
    const prevPlaceholder = this.isInitialPlaceholder;

    // Stage working in-memory copy to build candidate registry
    this.inMemoryWorkflows.set(wfId, cloned);
    if (!this.inMemoryOrder.includes(wfId)) {
      this.inMemoryOrder.push(wfId);
    }
    this.inMemoryActiveId = wfId;

    const nextRegistry = this.buildNextRegistryFromMemory(wfId);
    const result = this.persistRegistryAndActiveAtomically(nextRegistry, cloned);

    if (result.success) {
      this.registry = nextRegistry;
      this.inMemoryOrder = [...nextRegistry.workflow_order];
      this.isInitialPlaceholder = false;
      for (const persistedId of Object.keys(nextRegistry.workflows)) {
        this.unsavedWorkflowIds.delete(persistedId);
      }
    } else if (existedInSession) {
      // Existing workflow in session edited while storage failed: keep in memory and mark unsaved
      this.inMemoryOrder = prevOrder;
      if (!this.inMemoryOrder.includes(wfId)) {
        this.inMemoryOrder.push(wfId);
      }
      for (const [id, wf] of Object.entries(this.registry.workflows)) {
        if (!this.inMemoryWorkflows.has(id)) {
          this.inMemoryWorkflows.set(id, cloneWorkflow(wf));
        }
      }
      if (hasMeaningfulWorkflowData(cloned)) {
        this.isInitialPlaceholder = false;
      }
      this.unsavedWorkflowIds.add(wfId);
    } else {
      // Unpersisted speculative candidate (e.g. failed New Workflow / failed Import / failed Demo Copy):
      // revert candidate from in-memory session so aborted operations leave no phantom workflows
      if (prevInMemoryWf) {
        this.inMemoryWorkflows.set(wfId, prevInMemoryWf);
      } else {
        this.inMemoryWorkflows.delete(wfId);
      }
      for (const [id, wf] of Object.entries(this.registry.workflows)) {
        if (!this.inMemoryWorkflows.has(id)) {
          this.inMemoryWorkflows.set(id, cloneWorkflow(wf));
        }
      }
      this.inMemoryOrder = prevOrder;
      this.inMemoryActiveId = prevActiveId;
      this.isInitialPlaceholder = prevPlaceholder;
      this.unsavedWorkflowIds.delete(wfId);
    }
    return result;
  }

  /**
   * Creates a new workflow in the registry while preserving all existing workflows and unsaved edits.
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

    this.inMemoryWorkflows.set(newId, cloneWorkflow(newWf));
    if (!this.inMemoryOrder.includes(newId)) {
      this.inMemoryOrder.push(newId);
    }
    this.inMemoryActiveId = newId;

    const nextRegistry = this.buildNextRegistryFromMemory(newId);
    const saveResult = this.persistRegistryAndActiveAtomically(nextRegistry, newWf);

    if (saveResult.success) {
      this.registry = nextRegistry;
      this.inMemoryOrder = [...nextRegistry.workflow_order];
      for (const persistedId of Object.keys(nextRegistry.workflows)) {
        this.unsavedWorkflowIds.delete(persistedId);
      }
      return {
        success: true,
        persisted: true,
        activeWorkflow: cloneWorkflow(newWf),
        hasUnsavedChanges: false
      };
    }

    // Do NOT commit nextRegistry to this.registry when persistence fails (Defect 5A)
    this.unsavedWorkflowIds.add(newId);
    return {
      success: false,
      persisted: false,
      rollbackFailed: saveResult.rollbackFailed,
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
   * Strictly separates workflow content unsaved state (`hasUnsavedChanges`) from a failure
   * to persist the active-workflow pointer (`activeSwitchPersistFailed`).
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
      const currentActiveId = this.inMemoryActiveId || this.registry.active_workflow_id;
      const currentActive =
        currentInMemoryStore ??
        this.inMemoryWorkflows.get(currentActiveId) ??
        this.registry.workflows[currentActiveId] ??
        cloneInitialState();
      return {
        success: false,
        persisted: false,
        activeWorkflow: cloneWorkflow(currentActive),
        hasUnsavedChanges: currentHasUnsaved,
        error: `Workflow "${targetId}" was not found in the local registry.`
      };
    }

    this.inMemoryActiveId = targetId;
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

    const saveResult = this.persistRegistryAndActiveAtomically(nextRegistry, persistedTargetWf);
    if (saveResult.success) {
      this.registry = nextRegistry;
    }

    return {
      success: true,
      persisted: saveResult.success && !targetIsUnsaved,
      activeSwitchPersistFailed: !saveResult.success,
      rollbackFailed: saveResult.rollbackFailed,
      activeWorkflow: cloneWorkflow(targetWf),
      hasUnsavedChanges: targetIsUnsaved,
      error: saveResult.error,
      isQuotaExceeded: saveResult.isQuotaExceeded,
      isCorruptedLocked: saveResult.isCorruptedLocked
    };
  }

  /**
   * Duplicates a workflow in the registry with a fresh workflow UUID while preserving
   * all step data, governance settings, unsaved in-memory edits, and unknown fields.
   */
  public duplicateWorkflow(
    sourceId?: string,
    currentInMemoryStore?: WorkflowStore,
    currentHasUnsaved: boolean = false
  ): RegistryActionResult {
    if (currentInMemoryStore) {
      this.syncInMemoryWorkflow(currentInMemoryStore, currentHasUnsaved);
    }

    const resolvedSourceId = sourceId || this.inMemoryActiveId || this.registry.active_workflow_id;
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

    this.isInitialPlaceholder = false;
    const duplicate = cloneWorkflow(sourceWf);
    const newId = generateUUID();
    duplicate.metadata.id = newId;
    duplicate.metadata.created_at = new Date().toISOString();
    const baseTitle = duplicate.metadata.title?.trim() || 'Untitled Workflow';
    duplicate.metadata.title = `${baseTitle} (Copy)`;

    this.inMemoryWorkflows.set(newId, cloneWorkflow(duplicate));
    if (!this.inMemoryOrder.includes(newId)) {
      this.inMemoryOrder.push(newId);
    }
    const prevActiveId = this.inMemoryActiveId;
    this.inMemoryActiveId = newId;

    const nextRegistry = this.buildNextRegistryFromMemory(newId);
    const saveResult = this.persistRegistryAndActiveAtomically(nextRegistry, duplicate);

    if (saveResult.success) {
      this.registry = nextRegistry;
      this.inMemoryOrder = [...nextRegistry.workflow_order];
      for (const persistedId of Object.keys(nextRegistry.workflows)) {
        this.unsavedWorkflowIds.delete(persistedId);
      }
      return {
        success: true,
        persisted: true,
        activeWorkflow: cloneWorkflow(duplicate),
        hasUnsavedChanges: false
      };
    }

    // Revert in-memory duplicate candidate on failure so state remains coherent
    this.inMemoryWorkflows.delete(newId);
    this.inMemoryOrder = this.inMemoryOrder.filter(k => k !== newId);
    this.inMemoryActiveId = prevActiveId || resolvedSourceId;

    return {
      success: false,
      persisted: false,
      rollbackFailed: saveResult.rollbackFailed,
      activeWorkflow: cloneWorkflow(sourceWf),
      hasUnsavedChanges: currentHasUnsaved,
      error: saveResult.error,
      isQuotaExceeded: saveResult.isQuotaExceeded,
      isCorruptedLocked: saveResult.isCorruptedLocked
    };
  }

  /**
   * Renames a workflow in the registry and persists using the latest in-memory state across all workflows.
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

    const previousWf = cloneWorkflow(wf);
    const updatedWf = cloneWorkflow(wf);
    updatedWf.metadata.title = newTitle.trim();

    this.isInitialPlaceholder = false;
    this.inMemoryWorkflows.set(targetId, cloneWorkflow(updatedWf));

    const activeId = this.inMemoryActiveId || this.registry.active_workflow_id;
    const nextRegistry = this.buildNextRegistryFromMemory(activeId);
    const activeWf = nextRegistry.workflows[nextRegistry.active_workflow_id] ?? updatedWf;

    const saveResult = this.persistRegistryAndActiveAtomically(nextRegistry, activeWf);
    if (saveResult.success) {
      this.registry = nextRegistry;
      this.inMemoryOrder = [...nextRegistry.workflow_order];
      for (const persistedId of Object.keys(nextRegistry.workflows)) {
        this.unsavedWorkflowIds.delete(persistedId);
      }
      return {
        success: true,
        persisted: true,
        activeWorkflow: cloneWorkflow(this.inMemoryWorkflows.get(activeId) ?? activeWf),
        hasUnsavedChanges: this.unsavedWorkflowIds.has(activeId)
      };
    }

    // Revert in-memory title change on failed rename so state matches pre-rename state
    this.inMemoryWorkflows.set(targetId, previousWf);
    return {
      success: false,
      persisted: false,
      rollbackFailed: saveResult.rollbackFailed,
      activeWorkflow: cloneWorkflow(previousWf),
      hasUnsavedChanges: currentHasUnsaved,
      error: saveResult.error,
      isQuotaExceeded: saveResult.isQuotaExceeded,
      isCorruptedLocked: saveResult.isCorruptedLocked
    };
  }

  /**
   * Deletes a workflow from the registry after creating a verified protective backup.
   * Uses the latest in-memory state of all remaining workflows and rolls back if persistence fails.
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

    const currentActiveId = this.inMemoryActiveId || this.registry.active_workflow_id;
    const candidateRegistry = this.buildNextRegistryFromMemory(currentActiveId, targetId);

    let nextActiveWf: WorkflowStore;
    let nextActiveId: string;

    if (
      candidateRegistry.workflow_order.length === 0 ||
      Object.keys(candidateRegistry.workflows).length === 0
    ) {
      nextActiveWf = cloneInitialState();
      nextActiveId = nextActiveWf.metadata.id;
      candidateRegistry.workflows[nextActiveId] = cloneWorkflow(nextActiveWf);
      candidateRegistry.workflow_order = [nextActiveId];
      candidateRegistry.active_workflow_id = nextActiveId;
    } else {
      nextActiveId =
        currentActiveId !== targetId && candidateRegistry.workflows[currentActiveId]
          ? currentActiveId
          : candidateRegistry.workflow_order[0];
      candidateRegistry.active_workflow_id = nextActiveId;
      nextActiveWf = cloneWorkflow(candidateRegistry.workflows[nextActiveId]);
    }

    const saveResult = this.persistRegistryAndActiveAtomically(candidateRegistry, nextActiveWf);
    if (!saveResult.success) {
      this.rollbackProtectiveBackup(backupResult.previousBackup);
      return {
        success: false,
        persisted: false,
        rollbackFailed: saveResult.rollbackFailed,
        activeWorkflow: cloneWorkflow(targetWf),
        hasUnsavedChanges: currentHasUnsaved,
        error: saveResult.error,
        isQuotaExceeded: saveResult.isQuotaExceeded,
        isCorruptedLocked: saveResult.isCorruptedLocked
      };
    }

    this.registry = candidateRegistry;
    this.inMemoryWorkflows.delete(targetId);
    this.unsavedWorkflowIds.delete(targetId);
    this.inMemoryOrder = [...candidateRegistry.workflow_order];
    this.inMemoryActiveId = nextActiveId;
    this.inMemoryWorkflows.set(nextActiveId, cloneWorkflow(nextActiveWf));
    for (const persistedId of Object.keys(candidateRegistry.workflows)) {
      this.unsavedWorkflowIds.delete(persistedId);
    }

    return {
      success: true,
      persisted: true,
      backedUp: backupResult.backedUp,
      activeWorkflow: cloneWorkflow(nextActiveWf),
      hasUnsavedChanges: this.unsavedWorkflowIds.has(nextActiveId)
    };
  }

  /**
   * Replaces the workflow registry from a validated registry backup payload,
   * creating a protective backup first and rolling back if persistence fails.
   */
  public replaceRegistry(
    newRegistry: WorkflowRegistry,
    backupTarget?: WorkflowStore
  ): RegistryActionResult {
    const currentActiveId = this.inMemoryActiveId || this.registry.active_workflow_id;
    const backupResult = this.createProtectiveBackup(backupTarget);
    if (!backupResult.success) {
      const currentActive =
        backupTarget ??
        this.inMemoryWorkflows.get(currentActiveId) ??
        this.registry.workflows[currentActiveId] ??
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
        this.inMemoryWorkflows.get(currentActiveId) ??
        this.registry.workflows[currentActiveId] ??
        cloneInitialState();
      return {
        success: false,
        persisted: false,
        rollbackFailed: saveResult.rollbackFailed,
        activeWorkflow: cloneWorkflow(currentActive),
        error: saveResult.error,
        isQuotaExceeded: saveResult.isQuotaExceeded,
        isCorruptedLocked: saveResult.isCorruptedLocked
      };
    }

    this.resetWorkingStateFromRegistry(normalizedRegistry, false);

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
        if (!this.inMemoryOrder.includes(restoredId)) {
          this.inMemoryOrder.push(restoredId);
        }
        this.unsavedWorkflowIds.add(restoredId);
        this.inMemoryActiveId = restoredId;
        this.isInitialPlaceholder = false;
        return {
          success: true,
          persisted: false,
          data: restoredStore,
          error: 'Could not verify write to active local storage.'
        };
      }

      // Synchronize registry with restored workflow
      this.inMemoryWorkflows.set(restoredId, cloneWorkflow(restoredStore));
      if (!this.inMemoryOrder.includes(restoredId)) {
        this.inMemoryOrder.push(restoredId);
      }
      this.inMemoryActiveId = restoredId;
      this.isInitialPlaceholder = false;

      const nextRegistry = this.buildNextRegistryFromMemory(restoredId);
      this.registry = nextRegistry;
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
      if (!this.inMemoryOrder.includes(restoredId)) {
        this.inMemoryOrder.push(restoredId);
      }
      this.unsavedWorkflowIds.add(restoredId);
      this.inMemoryActiveId = restoredId;
      this.isInitialPlaceholder = false;
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
