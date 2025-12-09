import type { ProtocolErrorKind } from './types.js';

export class ClientError extends Error {
  constructor(message: string, public readonly meta?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ConnectionError extends ClientError {}
export class ProtocolError extends ClientError {
  constructor(message: string, meta?: Record<string, unknown> & { kind?: ProtocolErrorKind }) {
    super(message, meta);
  }
}
export class StateError extends ClientError {}
