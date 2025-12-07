import type { DeviceRecord } from './types.js';

export class DeviceRecordStore {
  private record: DeviceRecord;

  constructor(deviceId: string) {
    this.record = {
      device_id: deviceId,
      dr_version: 1,
      last_updated: Date.now(),
    };
  }

  get(): DeviceRecord {
    return { ...this.record };
  }

  applyUpdate(version: number): DeviceRecord {
    if (version > this.record.dr_version) {
      this.record = {
        ...this.record,
        dr_version: version,
        last_updated: Date.now(),
      };
    }
    return this.get();
  }
}
