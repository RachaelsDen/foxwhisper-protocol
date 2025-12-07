import WebSocket from 'ws';
import type { WebSocketLike } from './types.js';

export function createWebSocket(url: string): WebSocketLike {
  const ws = new WebSocket(url);
  return ws as unknown as WebSocketLike;
}
