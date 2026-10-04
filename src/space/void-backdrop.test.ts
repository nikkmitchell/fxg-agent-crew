import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PlaneGeometry, Matrix4, Vector4 } from 'three';
import { VOID_DRAW, VOID_VERTEX, VOID_FRAGMENT } from './void-backdrop';

describe('passthrough off in full environments', () => {
  it('does not suppress the backing because a shared environment surrounds the viewer', () => {
    const source = readFileSync(new URL('./Immersive.tsx', import.meta.url), 'utf8');
    // Regression boundary: this was gated by surrounded / isFullView, so the
    // setting flipped successfully but nothing changed on an AR headset.
    expect(source).toContain('{passthrough ? null : <VoidSphere />}');
    expect(source).not.toMatch(/passthrough\s*\|\|[^\n]*VoidSphere/);
  });
  it('covers every eye without depending on the world transform or far plane', () => {
    const geometry = new PlaneGeometry(2, 2);
    try {
      const points = geometry.attributes.position;
      const cameraMove = new Matrix4().makeTranslation(100, 2, -140);
      const projected: Vector4[] = [];
      for (let i=0;i<points.count;i++) {
        const p = new Vector4(points.getX(i), points.getY(i), .999999, 1);
        projected.push(p);
        expect(p.z / p.w).toBeLessThan(1);
        expect(p.clone().applyMatrix4(cameraMove).x).not.toEqual(p.x);
      }
      expect(Math.min(...projected.map(p=>p.x))).toBe(-1);
      expect(Math.max(...projected.map(p=>p.x))).toBe(1);
      expect(Math.min(...projected.map(p=>p.y))).toBe(-1);
      expect(Math.max(...projected.map(p=>p.y))).toBe(1);
      expect(VOID_VERTEX).not.toMatch(/modelViewMatrix|projectionMatrix/);
      expect(VOID_FRAGMENT).toContain('vec4(colour, 1.0)');
    } finally { geometry.dispose(); }
  });
  it('draws first without writing depth that could cover distant models', () => {
    expect(VOID_DRAW.renderOrder).toBeLessThan(0);
    expect(VOID_DRAW.depthWrite).toBe(false);
    expect(VOID_DRAW.depthTest).toBe(false);
    expect(VOID_DRAW.frustumCulled).toBe(false);
  });
});
