export function makeSpaceRoom(spaceId: string, suffix = 'main'): string {
  return `space:${spaceId}:${suffix}`;
}

export function isSpaceRoom(roomId: string): boolean {
  return roomId.startsWith('space:');
}
