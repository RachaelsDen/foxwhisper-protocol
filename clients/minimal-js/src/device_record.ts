import { Buffer } from 'buffer';
import type {
  DeviceRecordBackup,
  DeviceRecordResetRequest,
  DeviceRecordRestoreRequest,
  DeviceRecordState,
} from './types.js';

function isValidBase64(value: string): boolean {
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length > 0;
  } catch {
    return false;
  }
}

function requireField(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export class DeviceRecordStore {
  private record: DeviceRecordState;

  constructor(userId: string, deviceId: string) {
    this.record = {
      user_id: userId,
      device_id: deviceId,
      version: 1,
      status: 'active',
      last_updated: Date.now(),
    };
  }

  get(): DeviceRecordState {
    return { ...this.record };
  }

  applyBackup(backup: DeviceRecordBackup): DeviceRecordState {
    requireField(backup.type === 'DEVICE_RECORD_BACKUP', 'invalid backup type');
    requireField(backup.version >= this.record.version, 'backup version must be >= current version');
    requireField(backup.device_id === this.record.device_id, 'device_id mismatch');
    requireField(backup.user_id === this.record.user_id, 'user_id mismatch');
    requireField(isValidBase64(backup.device_private_key), 'invalid device_private_key');
    requireField(isValidBase64(backup.device_public_key), 'invalid device_public_key');

    this.record = {
      ...this.record,
      version: backup.version,
      status: 'active',
      last_updated: backup.timestamp ?? Date.now(),
      backup,
    };
    return this.get();
  }

  applyRestore(request: DeviceRecordRestoreRequest, backupDataB64: string): DeviceRecordState {
    requireField(request.type === 'DEVICE_RECORD_RESTORE', 'invalid restore type');
    requireField(request.version >= this.record.version, 'restore version must be >= current version');
    requireField(isValidBase64(backupDataB64), 'invalid backup_data encoding');
    requireField(isValidBase64(request.verification_code), 'invalid verification_code');

    this.record = {
      ...this.record,
      user_id: request.user_id,
      device_id: request.device_id,
      version: request.version,
      status: 'active',
      last_updated: request.restore_timestamp ?? Date.now(),
      last_restore: request,
    };
    return this.get();
  }

  applyReset(request: DeviceRecordResetRequest): DeviceRecordState {
    requireField(request.type === 'DEVICE_RECORD_RESET', 'invalid reset type');
    requireField(request.version >= this.record.version, 'reset version must be >= current version');
    requireField(isValidBase64(request.verification_code), 'invalid verification_code');

    this.record = {
      ...this.record,
      user_id: request.user_id,
      device_id: request.device_id,
      version: request.version,
      status: 'inactive',
      last_updated: request.reset_timestamp ?? Date.now(),
      last_reset: request,
    };
    return this.get();
  }
}
