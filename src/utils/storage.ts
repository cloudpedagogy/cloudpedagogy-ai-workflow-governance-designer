import { INITIAL_STATE, type WorkflowStore } from '../data/model';
import { validateWorkflowImport } from './schema';
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
}

export interface BackupResult {
  success: boolean;
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
 * and protective pre-destructive backups.
 */
export class StorageManager {
  private customStorage?: Storage;

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

  /**
   * Loads and validates workflow from local storage.
   * If stored data is malformed, preserves the raw string without overwriting.
   */
  public loadWorkflow(): StorageLoadResult {
    if (!this.isAvailable()) {
      return {
        success: false,
        data: cloneInitialState(),
        error: 'Browser storage is unavailable. Changes will remain in memory only.'
      };
    }

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
      if (!raw) {
        return {
          success: true,
          data: cloneInitialState(),
          isNew: true
        };
      }

      const validation = validateWorkflowImport(raw);
      if (!validation.valid || !validation.store) {
        return {
          success: false,
          data: cloneInitialState(),
          error: `Corrupted workflow in local storage: ${validation.errors.join('; ')}`,
          rawCorrupted: raw
        };
      }

      return {
        success: true,
        data: validation.store
      };
    } catch (e: any) {
      return {
        success: false,
        data: cloneInitialState(),
        error: `Unexpected error reading from storage: ${e?.message || 'Unknown error'}`
      };
    }
  }

  /**
   * Saves workflow to local storage, handling quota errors gracefully.
   */
  public saveWorkflow(store: WorkflowStore): StorageSaveResult {
    if (!this.isAvailable()) {
      return {
        success: false,
        error: 'Browser storage is unavailable. Please export your workflow as JSON to save your work.'
      };
    }

    const s = this.storage;
    if (!s) {
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
          error: 'Storage quota exceeded. Your workflow cannot be saved locally. Export as JSON immediately to preserve your changes.',
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
   * Creates a protective backup before destructive actions (e.g. New Workflow, Import JSON).
   * If the backup fails, destructive operations MUST NOT proceed.
   */
  public createProtectiveBackup(): BackupResult {
    const s = this.storage;
    if (!s) {
      return {
        success: false,
        error: 'Storage is unavailable. Protective backup cannot be verified.'
      };
    }

    try {
      const current = s.getItem(STORAGE_KEY);
      if (!current) {
        // Nothing stored yet, nothing to lose
        return { success: true };
      }

      s.setItem(BACKUP_KEY, current);
      return { success: true };
    } catch (e: any) {
      return {
        success: false,
        error: `Failed to create protective backup: ${e?.message || 'Storage error'}`
      };
    }
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
   * Restores protective backup to active storage.
   */
  public restoreProtectiveBackup(): boolean {
    const s = this.storage;
    if (!s) return false;
    try {
      const backup = s.getItem(BACKUP_KEY);
      if (backup) {
        s.setItem(STORAGE_KEY, backup);
        return true;
      }
      return false;
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
