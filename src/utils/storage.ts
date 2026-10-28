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
   * Creates and verifies a protective backup before destructive actions
   * (e.g. New Workflow, Import JSON, Save Demo Copy).
   * Protects both persisted storage data and meaningful unsaved in-memory work.
   * If a required backup fails, destructive operations MUST NOT proceed.
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
      const current = s.getItem(STORAGE_KEY);
      const hasInMemoryWork = hasMeaningfulWorkflowData(inMemoryStore);

      let payloadToBackup: string | null = null;
      if (hasInMemoryWork && inMemoryStore) {
        const serializedInMemory = JSON.stringify(inMemoryStore);
        payloadToBackup = !current || serializedInMemory !== current ? serializedInMemory : current;
      } else if (current) {
        payloadToBackup = current;
      }

      if (!payloadToBackup) {
        // Neither stored data nor meaningful in-memory work exists
        return { success: true, backedUp: false };
      }

      s.setItem(BACKUP_KEY, payloadToBackup);
      const verified = s.getItem(BACKUP_KEY);
      if (verified !== payloadToBackup) {
        return {
          success: false,
          backedUp: false,
          error: 'Failed to verify protective backup in local storage.'
        };
      }

      return { success: true, backedUp: true };
    } catch (e: any) {
      return {
        success: false,
        backedUp: false,
        error: `Failed to create protective backup: ${e?.message || 'Storage error'}`
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
   * Restores protective backup to active storage and verifies it.
   */
  public restoreProtectiveBackup(): boolean {
    const s = this.storage;
    if (!s) return false;
    try {
      const backup = s.getItem(BACKUP_KEY);
      if (!backup) return false;

      const validation = validateWorkflowDraft(backup);
      if (!validation.valid || !validation.store) {
        return false;
      }

      s.setItem(STORAGE_KEY, backup);
      const verified = s.getItem(STORAGE_KEY);
      if (verified !== backup) {
        return false;
      }

      this.isCorruptedLocked = false;
      this.corruptedRawData = null;
      this.hasInspectedStorage = true;
      return true;
    } catch {
      return false;
    }
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
