export function groupToRoom(groupId: string, suffix = 'main'): string {
  return `group:${groupId}:${suffix}`;
}

export function parseGroupId(roomId: string): string | null {
  if (!roomId.startsWith('group:')) return null;
  const parts = roomId.split(':');
  if (parts.length < 3) return null;
  const [, groupId] = parts;
  return groupId && groupId.length > 0 ? groupId : null;
}
