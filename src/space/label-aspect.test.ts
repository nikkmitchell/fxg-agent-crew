import { describe, expect, it } from "vitest";

/**
 * Text planes must match the shape of the canvas the text is drawn on.
 *
 * `makeLabelTexture` draws into a 512x128 canvas — 4:1. Mapping that onto a
 * plane of a different aspect does not crop or letterbox it, it STRETCHES it,
 * and the failure looks like blurring rather than like a mistake. A caption at
 * nearly 13:1 reached a headset as unreadable smudging.
 *
 * The numbers are read out of the components so this cannot pass while the
 * scene says something else.
 */
const LABEL_CANVAS_ASPECT = 512 / 128;

const planesIn = (source: string): [number, number][] =>
  [...source.matchAll(/planeGeometry args=\{\[([\d.]+), ([\d.]+)\]\}/g)].map(
    (match) => [Number(match[1]), Number(match[2])] as [number, number],
  );

describe("text planes", () => {
  it("shapes a button's label canvas like the button, rather than assuming 4:1", async () => {
    // THE RULE THIS FILE STATES, APPLIED TO THE FILE IT DID NOT CHECK. The
    // settings gear is a 0.14 x 0.14 square taking a 4:1 texture, so its glyph
    // was squeezed to a quarter of its width — "weirdly shaped, like its
    // stretched", from inside a headset. A test that knows stretching is the
    // failure mode and only ever looked at StillPanel.tsx is half a test.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./Backdrop.tsx", import.meta.url), "utf8"),
    );
    // Asserted on the source rather than by rendering, for the same reason the
    // check below is: this suite has no renderer, and the numbers must come out
    // of the component so it cannot pass while the scene says otherwise.
    expect(source, "WristButton must tell makeLabelTexture the plane's aspect")
      .toMatch(/makeLabelTexture\([\s\S]*?aspect:\s*width\s*\/\s*height/);
  });


  it("keeps the still panel's caption at the texture's own aspect", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./StillPanel.tsx", import.meta.url), "utf8"),
    );
    // The caption is the only hardcoded plane in this file; the frame itself is
    // sized from the station.
    const captions = planesIn(source);
    expect(captions.length, "expected exactly one fixed-size plane").toBe(1);
    const [width, height] = captions[0];
    expect(width / height).toBeCloseTo(LABEL_CANVAS_ASPECT, 2);
  });
});
