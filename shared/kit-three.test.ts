import { describe, expect, it } from "vitest";
import { kitThreeFile } from "./kit-three";

describe("what of three the room lends to spaces", () => {
  it("serves three's scripts and its addons", () => {
    expect(kitThreeFile("three.module.js")).toEqual({ dir: "build", file: "three.module.js" });
    expect(kitThreeFile("addons/loaders/GLTFLoader.js")).toEqual({ dir: "examples/jsm", file: "loaders/GLTFLoader.js" });
  });

  it("serves the decoders' WebAssembly only from addons/libs", () => {
    expect(kitThreeFile("addons/libs/draco/draco_decoder.wasm")).toEqual({ dir: "examples/jsm", file: "libs/draco/draco_decoder.wasm" });
    expect(kitThreeFile("addons/other.wasm")).toBeNull();
    expect(kitThreeFile("three.wasm")).toBeNull();
  });

  it("serves nothing else in the package", () => {
    for (const rest of ["three.cjs", "package.json", "addons/libs/draco/README.md", "LICENSE"]) expect(kitThreeFile(rest), rest).toBeNull();
  });
});
