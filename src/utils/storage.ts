import { INITIAL_STATE, hasMeaningfulWorkflowData, type WorkflowStore } from '../data/model';
import { validateWorkflowDraft } from './schema';
import { generateUUID } from './uuid';

export const STORAGE_KEY = 'cp_workflow_designer';
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

function cloneInitialState(): WorkflowStore {
  const clone = JSON.parse(JSON.stringify(INITIAL_STATE));
  clone.metadata.id = generateUUID();
  clone.metadata.created_at = new Date().toISOString();
  return clone;
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
 * StorageManager provides resilient persistence using the standard cp_workflow_designer key.
 * Handles storage unavailability, quota exhaustion, corrupt storage recovery,
 * working-draft persistence, and protective pre-destructive backups.
 */
export class StorageManager {
  private customStorage?: Storage;
  private isCorruptedLocked: boolean = false;
  private corruptedRawData: string | null = null;
  private hasInspectedStorage: boolean = false;

  constructor(customStorage?: Storage) {
    this.customStorage = customStorage;
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
   * Loads and validates workflow (including unfinished working drafts) from local storage.
   * If stored data is malformed or incompatible, preserves the raw string and locks auto-save
   * so subsequent edits cannot silently overwrite it.
   */
  public loadWorkflow(): StorageLoadResult {
    const s = this.storage;
    if (!s) {
      return {
        success: false,
        data: cloneInitialState(),
        error: 'Browser storage is unavailable. Changes will remain in memory only.'
      };
    }

    try {
      const raw = s.getItem(STORAGE_KEY);
      this.hasInspectedStorage = true;

      if (!raw) {
        if (!this.isAvailable()) {
          return {
            success: false,
            data: cloneInitialState(),
            error: 'Browser storage is unavailable. Changes will remain in memory only.'
          };
        }
        this.isCorruptedLocked = false;
        this.corruptedRawData = null;
        return {
          success: true,
          data: cloneInitialState(),
          isNew: true
        };
      }

      const validation = validateWorkflowDraft(raw);
      if (!validation.valid || !validation.store) {
        this.isCorruptedLocked = true;
        this.corruptedRawData = raw;
        return {
          success: false,
          data: cloneInitialState(),
          error: `Corrupted workflow in local storage: ${validation.errors.join('; ')}`,
          rawCorrupted: raw
        };
      }

      this.isCorruptedLocked = false;
      this.corruptedRawData = null;
      return {
        success: true,
        data: validation.store
      };
    } catch (e: any) {
      return {
        success: false,
        data: cloneInitialState(),
        error: ` Browser storage is unavailable or unreadable: ${e?.message || 'Unknown error'}. Changes will remain in memory only.`.trim()
      };
    }
  }

  /**
   * Saves workflow to local storage, handling quota errors gracefully and refusing
   * to silently overwrite unrecovered corrupted storage data.
   */
  public saveWorkflow(store: WorkflowStore): StorageSaveResult {
    const s = this.storage;
    if (!s) {
      return {
        success: false,
        error: 'Browser storage is unavailable. Please export your workflow as JSON to save your work.'
      };
    }

    // If loadWorkflow() was not called yet, inspect existing storage to prevent silent overwrite of corrupt data
    if (!this.hasInspectedStorage) {
      try {
        const existing = s.getItem(STORAGE_KEY);
        this.hasInspectedStorage = true;
        if (existing) {
          const check = validateWorkflowDraft(existing);
          if (!check.valid || !check.store) {
            this.isCorruptedLocked = true;
            this.corruptedRawData = existing;
          }
        }
      } catch {
        // Handled by availability/setItem check below
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

    try {
      const serialized = JSON.stringify(store);
      s.setItem(STORAGE_KEY, serialized);
      return { success: true };
    } catch (e: any) {
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
   * Explicitly discards unrecoverable corrupted data after user confirmation and saves the active workflow.
   */
  public discardCorruptedDataAndSave(store: WorkflowStore): StorageSaveResult {
    const previousRaw = this.corruptedRawData;
    this.isCorruptedLocked = false;
    this.corruptedRawData = null;
    this.hasInspectedStorage = true;

    const result = this.saveWorkflow(store);
    if (!result.success) {
      // Restore lock if write failed so state remains accurate
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
   * (e.g. New Workflow, Import JSON, Save Demo Copy).
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
        // Neither stored data nor meaningful in-memory work exists
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

    try {
      s.setItem(STORAGE_KEY, backup);
      const verified = s.getItem(STORAGE_KEY);
      if (verified !== backup) {
        return {
          success: true,
          persisted: false,
          data: validation.store,
          error: 'Could not verify write to active local storage.'
        };
      }

      this.isCorruptedLocked = false;
      this.corruptedRawData = null;
      this.hasInspectedStorage = true;
      return {
        success: true,
        persisted: true,
        data: validation.store
      };
    } catch (e: any) {
      return {
        success: true,
        persisted: false,
        data: validation.store,
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
