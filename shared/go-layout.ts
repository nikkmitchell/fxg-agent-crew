import type { GoRoomItem } from "./room-items.js";
export type Point3 = { x: number; y: number; z: number };
/** Constant pitch and stone diameter. More intersections make a larger board,
 * never a denser grid; item.scale is the separate whole-table resize control. */
export const GO_PITCH = 0.075;
export const goExtent = (size: number) => (size - 1) * GO_PITCH;
export const goBoardWidth = (size: number) => goExtent(size) + 0.2;
export function goDeckWidth(size: number, colours: number): number {
  let halfWidth = Math.max(1.7, goBoardWidth(size) + (colours > 2 ? 1.4 : 1.12)) / 2;
  for (let i = 0; i < colours; i++) {
    const tray = goTray(i, colours, size);
    halfWidth = Math.max(halfWidth, Math.abs(tray.x) + 0.11 + 0.04, Math.abs(tray.z) + 0.135 + 0.04);
  }
  return halfWidth * 2;
}
export const GO_SURFACE = 0.86;
export const goPoint = (n: number, size: number) => -goExtent(size) / 2 + n * GO_PITCH;
export const goRadius = (_size?: number) => GO_PITCH * 0.43;
export function goBowl(index: number, count: number, size = 9): Point3 {
  const angle = Math.PI + index / count * Math.PI * 2;
  // A square perimeter keeps diagonal bowls outside the square playing surface.
  // Small boards still need enough perimeter for eight bowl-and-tray stations.
  const stationEdge = Math.max(goBoardWidth(size) / 2 + 0.295, count >= 6 ? 0.76 : 0);
  const radius = stationEdge / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
  return { x: Math.cos(angle) * radius, y: GO_SURFACE - 0.06, z: Math.sin(angle) * radius };
}
export function goTray(index: number, count: number, size = 9): Point3 {
  const bowl = goBowl(index, count, size);
  const angle = Math.PI + index / count * Math.PI * 2;
  return { x: bowl.x - Math.sin(angle) * 0.38, y: 0.752, z: bowl.z + Math.cos(angle) * 0.38 };
}
export function goLocal(p: Point3, item: GoRoomItem): Point3 {
  const x = (p.x - item.position.x) / item.scale;
  const z = (p.z - item.position.z) / item.scale;
  const c = Math.cos(item.position.rotationY), s = Math.sin(item.position.rotationY);
  return { x: c * x - s * z, y: (p.y - item.position.y) / item.scale, z: s * x + c * z };
}
export function goWorld(p: Point3, item: GoRoomItem): Point3 {
  const c = Math.cos(item.position.rotationY), s = Math.sin(item.position.rotationY);
  return { x: item.position.x + (c * p.x + s * p.z) * item.scale,
    y: item.position.y + p.y * item.scale, z: item.position.z + (-s * p.x + c * p.z) * item.scale };
}
export function goTouchBowl(p: Point3, item: GoRoomItem): boolean {
  const b = goBowl(item.activeColour, item.colours.length, item.size);
  return Math.hypot(p.x - b.x, p.z - b.z) < 0.19 && p.y > b.y - 0.06 && p.y < b.y + 0.15;
}
export function goTouchIntersection(p: Point3, size: number): { x: number; y: number } | null {
  if (p.y < GO_SURFACE - 0.025 || p.y > GO_SURFACE + 0.085) return null;
  const step = GO_PITCH, extent = goExtent(size);
  const x = Math.round((p.x + extent / 2) / step), y = Math.round((p.z + extent / 2) / step);
  if (x < 0 || y < 0 || x >= size || y >= size) return null;
  return Math.hypot(p.x - goPoint(x, size), p.z - goPoint(y, size)) < step * 0.43 ? { x, y } : null;
}
