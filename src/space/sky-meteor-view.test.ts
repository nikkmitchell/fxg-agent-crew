import { expect, test, vi } from "vitest";
import * as THREE from "three";
import { meteorSpec } from "../../shared/sky-meteors";
import { SkyMeteorView } from "./sky-meteor-view";

test("a rendered bolide keeps moving during burn-out and has a visible brightness peak", () => {
  const random = vi.spyOn(Math, "random").mockReturnValue(.5);
  const view = new SkyMeteorView();
  try {
    const forward = new THREE.Vector3(0, 0, -1);
    const spec = meteorSpec(() => .5, "bolide");
    view.preview("bolide", forward);
    const mesh = view.group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    const position = mesh.geometry.getAttribute("position");
    view.update(.3, 1, forward, false);
    const faint = mesh.material.uniforms.uAlpha.value;
    view.update((spec.duration + spec.linger) * spec.peak - .3, 1, forward, false);
    expect(mesh.material.uniforms.uAlpha.value).toBeGreaterThan(faint * 5);
    view.update(spec.duration - (spec.duration + spec.linger) * spec.peak, 1, forward, false);
    const before = new THREE.Vector3().fromBufferAttribute(position, 0);
    const brightness = mesh.material.uniforms.uAlpha.value;
    view.update(spec.linger * .75, 1, forward, false);
    expect(new THREE.Vector3().fromBufferAttribute(position, 0).distanceTo(before)).toBeGreaterThan(30);
    expect(mesh.material.uniforms.uAlpha.value).toBeLessThan(brightness * .2);
    view.update(spec.linger * .26, 1, forward, false);
    expect(view.group.children).toHaveLength(0);
  } finally { view.dispose(); random.mockRestore(); }
});
