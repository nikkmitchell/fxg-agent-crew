import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PlaneGeometry, Matrix4, Vector4 } from 'three';
import { VOID_DRAW, VOID_VERTEX, VOID_FRAGMENT, backgroundIsPicture, voidBacking } from './void-backdrop';
import { Color, Texture } from 'three';

describe('passthrough off in full environments', () => {
  it('in AR, passthrough off means the void even inside a full environment (the bug), and on means the room', () => {
    expect(voidBacking({ passthrough: false, blendMode: 'alpha-blend', surrounded: true })).toBe(true);
    expect(voidBacking({ passthrough: false, blendMode: 'alpha-blend', surrounded: false })).toBe(true);
    expect(voidBacking({ passthrough: true, blendMode: 'alpha-blend', surrounded: true })).toBe(false);
  });
  it('in opaque VR, a full environment keeps its own sky; an empty room still has the void', () => {
    expect(voidBacking({ passthrough: false, blendMode: 'opaque', surrounded: true })).toBe(false);
    expect(voidBacking({ passthrough: false, blendMode: 'opaque', surrounded: false })).toBe(true);
    expect(voidBacking({ passthrough: false, blendMode: null, surrounded: true })).toBe(false);
  });
  it('stands aside for a picture sky, which is opaque by itself, but not for a colour one', () => {
    expect(backgroundIsPicture(new Texture())).toBe(true);
    expect(backgroundIsPicture(new Color('#000'))).toBe(false);
    expect(backgroundIsPicture(null)).toBe(false);
  });
  it('is the rule the room actually uses', () => {
    const source = readFileSync(new URL('./Immersive.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(/voidBacking\(\{ passthrough, blendMode, surrounded: surrounded \?\? roomItems\.some\(isFullView\) \}\) \? <VoidSphere \/> : null/);
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
