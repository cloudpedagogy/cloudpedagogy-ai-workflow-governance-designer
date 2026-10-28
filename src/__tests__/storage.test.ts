import { describe, it, expect, beforeEach } from 'vitest';
import { StorageManager, STORAGE_KEY, BACKUP_KEY } from '../utils/storage';
import { DEMO_STATE, type WorkflowStore } from '../data/model';

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
});
