import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { DeviceRecordStore } from '../src/device_record.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const DR_VECTORS_PATH = path.join(ROOT_DIR, 'tests', 'common', 'handshake', 'dr_test_vectors.json');

const vectors = JSON.parse(fs.readFileSync(DR_VECTORS_PATH, 'utf8'));

describe('device record store semantics', () => {
  test('applies backup, restore, reset from vectors', () => {
    const backup = vectors.dr_backup.device_record;
    const restoreReq = vectors.dr_restore.restore_request;
    const backupData = vectors.dr_restore.backup_data;
    const resetReq = vectors.dr_reset.reset_request;

    const store = new DeviceRecordStore(backup.user_id, backup.device_id);

    const afterBackup = store.applyBackup(backup);
    expect(afterBackup.status).toBe('active');
    expect(afterBackup.version).toBe(backup.version);
    expect(afterBackup.backup?.device_public_key).toBe(backup.device_public_key);

    const afterRestore = store.applyRestore(restoreReq, backupData);
    expect(afterRestore.status).toBe('active');
    expect(afterRestore.version).toBeGreaterThanOrEqual(afterBackup.version);
    expect(afterRestore.last_restore?.device_id).toBe(restoreReq.device_id);

    const afterReset = store.applyReset(resetReq);
    expect(afterReset.status).toBe('inactive');
    expect(afterReset.version).toBeGreaterThanOrEqual(afterRestore.version);
    expect(afterReset.last_reset?.reset_reason).toBe(resetReq.reset_reason);
  });

  test('rejects non-monotonic versions on restore/reset', () => {
    const backup = vectors.dr_backup.device_record;
    const restoreReq = { ...vectors.dr_restore.restore_request, version: 1 };
    const backupData = vectors.dr_restore.backup_data;
    const resetReq = { ...vectors.dr_reset.reset_request, version: 0 };

    const store = new DeviceRecordStore(backup.user_id, backup.device_id);
    store.applyBackup({ ...backup, version: 2 });

    expect(() => store.applyRestore(restoreReq, backupData)).toThrow();
    expect(() => store.applyReset(resetReq)).toThrow();
  });
});
