import { expect, test, vi } from "vitest";
import * as THREE from "three";
import { METEOR_TRAIL_DECAY, meteorSpec } from "../../shared/sky-meteors";
import { SkyMeteorView } from "./sky-meteor-view";

test.each(["meteor", "bolide"] as const)("a rendered %s moves during burn-out and has a brightness peak", (kind) => {
  const random = vi.spyOn(Math, "random").mockReturnValue(.5);
  const view = new SkyMeteorView();
  try {
    const forward = new THREE.Vector3(0, 0, -1);
    const spec = meteorSpec(() => .5, kind);
    const beginning = (spec.duration + spec.linger) * .07;
    view.preview(kind, forward);
    const mesh = view.group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    const position = mesh.geometry.getAttribute("position");
    view.update(beginning, 1, forward, false);
    const faint = mesh.material.uniforms.uAlpha.value;
    view.update((spec.duration + spec.linger) * spec.peak - beginning, 1, forward, false);
    expect(mesh.material.uniforms.uAlpha.value).toBeGreaterThan(faint * 5);
    view.update(spec.duration - (spec.duration + spec.linger) * spec.peak, 1, forward, false);
    const before = new THREE.Vector3().fromBufferAttribute(position, 0);
    const brightness = mesh.material.uniforms.uAlpha.value;
    view.update(spec.linger * .75, 1, forward, false);
    expect(new THREE.Vector3().fromBufferAttribute(position, 0).distanceTo(before)).toBeGreaterThan(spec.bolide ? 30 : 1);
    expect(mesh.material.uniforms.uAlpha.value).toBeLessThan(brightness * .2);
    view.update(spec.linger * .26, 1, forward, false);
    // Only the dim afterimage remains after the moving head reaches zero.
    expect(mesh.material.uniforms.uAlpha.value).toBe(0);
    view.update(METEOR_TRAIL_DECAY[kind] * 3, 1, forward, false);
    expect(view.group.children).toHaveLength(0);
  } finally { view.dispose(); random.mockRestore(); }
});
