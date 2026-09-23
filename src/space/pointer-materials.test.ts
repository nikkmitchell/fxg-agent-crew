import { ShaderChunk, ShaderLib } from "three";
import { describe, expect, it } from "vitest";
import { COLOR_ANCHOR, TwoToneCursorMaterial, TwoToneRayMaterial, VERTEX_ANCHOR } from "./pointer-materials.js";

/**
 * The pointer is recoloured by replacing a line in three.js's own shader. If a
 * three.js update renames that line, the replace quietly does nothing and the
 * pointer is pure white again — invisible on white panels, which is what Nikk
 * reported. These hold the anchors, and that the injection actually lands.
 */

const basic = () => ({ vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader });

describe("the pointer's light-with-a-dark-edge", () => {
  it("still finds the lines it replaces in this three.js", () => {
    expect(ShaderLib.basic.fragmentShader).toContain(COLOR_ANCHOR);
    expect(ShaderLib.basic.vertexShader).toContain(VERTEX_ANCHOR);
    expect(ShaderChunk.color_fragment).toBeDefined();
  });

  for (const [name, Material] of [["cursor", TwoToneCursorMaterial], ["ray", TwoToneRayMaterial]] as const) {
    it(`${name}: draws a dark edge into the colour, and keeps the anchor for the rest`, () => {
      const parameters = basic() as Parameters<InstanceType<typeof Material>["onBeforeCompile"]>[0];
      new Material().onBeforeCompile(parameters, undefined as never);
      expect(parameters.fragmentShader).toContain("mix(diffuseColor.rgb, vec3(0.07, 0.07, 0.08)");
      // Injected exactly once, after the anchor, not instead of it.
      expect(parameters.fragmentShader.split(COLOR_ANCHOR)).toHaveLength(2);
      expect(parameters.vertexShader.split(VERTEX_ANCHOR)).toHaveLength(2);
    });

    it(`${name}: is still transparent, so the brightness setting can dim it`, () => {
      expect(new Material().transparent).toBe(true);
    });
  }

  it("keeps the ray fading away from the hand, as the library's does", () => {
    const parameters = basic() as Parameters<TwoToneRayMaterial["onBeforeCompile"]>[0];
    new TwoToneRayMaterial().onBeforeCompile(parameters, undefined as never);
    expect(parameters.fragmentShader).toMatch(/\* vFade;/);
  });
});
