#!/usr/bin/env python3
"""Package the original Skein Blender GLB as a self-contained VRM 0.0.

Usage:
    python3 tools/skein-avatar/package-vrm.py skein.glb public/avatars/skein.vrm

The Blender export must contain a skinned humanoid with node names matching
VRM 0.0 human bone names, and mesh shape keys blink, a, joy, sorrow and fun.
This script adds metadata and references; it does not alter geometry, material
colors, skin weights, bone transforms, inverse bind matrices or orientation.
The source must already face glTF -Z, with +Y up and feet at ground level.

This is for our original CC0 artwork, not for relicensing imported models.
Schema source: https://github.com/vrm-c/vrm-specification/tree/master/specification/0.0/schema
VRM_USE_GLTFSHADER deliberately preserves the GLB's standard PBR materials.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import struct
import sys
from typing import Any


GLB_MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
MAX_BYTES = 40 * 1024 * 1024
EXPRESSIONS = ("blink", "a", "joy", "sorrow", "fun")
CORE_BONES = (
    "hips", "spine", "chest", "neck", "head",
    "leftUpperArm", "leftLowerArm", "leftHand",
    "rightUpperArm", "rightLowerArm", "rightHand",
    "leftUpperLeg", "leftLowerLeg", "leftFoot",
    "rightUpperLeg", "rightLowerLeg", "rightFoot",
)
HUMAN_BONES = (
    "hips", "spine", "chest", "upperChest", "neck", "head",
    "leftEye", "rightEye", "jaw",
    *(
        f"{side}{part}"
        for side in ("left", "right")
        for part in (
            "Shoulder", "UpperArm", "LowerArm", "Hand",
            "UpperLeg", "LowerLeg", "Foot", "Toes",
            *(f"{finger}{segment}" for finger in ("Thumb", "Index", "Middle", "Ring", "Little")
              for segment in ("Proximal", "Intermediate", "Distal")),
        )
    ),
)


class PackageError(ValueError):
    """An actionable problem in the input asset."""


def read_glb(path: Path) -> tuple[dict[str, Any], list[tuple[int, bytes]]]:
    data = path.read_bytes()
    if len(data) < 20:
        raise PackageError("The input is too short to be a GLB.")
    magic, version, length = struct.unpack_from("<III", data)
    if magic != GLB_MAGIC or version != 2:
        raise PackageError("Export a binary glTF 2.0 (.glb) from Blender.")
    if length != len(data):
        raise PackageError(f"GLB header declares {length} bytes; the file has {len(data)}.")
    chunks = []
    offset = 12
    while offset < length:
        if offset + 8 > length:
            raise PackageError("The GLB ends inside a chunk header.")
        size, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        if size % 4 or offset + size > length:
            raise PackageError("The GLB contains an incomplete or unaligned chunk.")
        chunks.append((kind, data[offset:offset + size]))
        offset += size
    if not chunks or chunks[0][0] != JSON_CHUNK:
        raise PackageError("The GLB's first chunk must contain glTF JSON.")
    if sum(kind == JSON_CHUNK for kind, _ in chunks) != 1:
        raise PackageError("A GLB must have exactly one JSON chunk.")
    if sum(kind == BIN_CHUNK for kind, _ in chunks) > 1:
        raise PackageError("A GLB may have only one binary chunk.")
    try:
        gltf = json.loads(chunks[0][1].decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as error:
        raise PackageError(f"The GLB JSON could not be read: {error}") from error
    if not isinstance(gltf, dict) or gltf.get("asset", {}).get("version") != "2.0":
        raise PackageError("The input must contain a glTF 2.0 asset.")
    return gltf, chunks[1:]


def humanoid_nodes(gltf: dict[str, Any]) -> dict[str, int]:
    nodes = gltf.get("nodes", [])
    named: dict[str, int] = {}
    for index, node in enumerate(nodes):
        name = node.get("name")
        if name not in HUMAN_BONES:
            continue
        if name in named:
            raise PackageError(f"More than one node is named {name}; humanoid names must be unique.")
        named[name] = index
    missing = [name for name in CORE_BONES if name not in named]
    if missing:
        raise PackageError("Missing bones required by Saha: " + ", ".join(missing))
    finger_bones = [name for name in HUMAN_BONES if any(finger in name for finger in ("Thumb", "Index", "Middle", "Ring", "Little"))]
    missing_fingers = [name for name in finger_bones if name not in named]
    if missing_fingers:
        raise PackageError("The complete Skein hand rig is missing: " + ", ".join(missing_fingers))

    parents: dict[int, int] = {}
    for parent, node in enumerate(nodes):
        for child in node.get("children", []):
            if not isinstance(child, int) or not 0 <= child < len(nodes):
                raise PackageError(f"Node {parent} refers to an invalid child.")
            if child in parents:
                raise PackageError(f"Node {child} has more than one parent.")
            parents[child] = parent
    for name, node in named.items():
        if name == "hips":
            continue
        visited = set()
        while node != named["hips"]:
            if node in visited:
                raise PackageError(f"The node hierarchy contains a cycle above {name}.")
            visited.add(node)
            if node not in parents:
                raise PackageError(f"Humanoid bone {name} must descend from hips.")
            node = parents[node]
    skins = gltf.get("skins", [])
    skinned_meshes = [node for node in nodes if "mesh" in node and "skin" in node]
    if not skins or not skinned_meshes:
        raise PackageError("The export has no skinned mesh; export the mesh and armature together.")
    for node in skinned_meshes:
        skin_index = node["skin"]
        if not isinstance(skin_index, int) or not 0 <= skin_index < len(skins):
            raise PackageError(f"Mesh node {node.get('name', '?')} has an invalid skin index.")
    return named


def expression_groups(gltf: dict[str, Any]) -> list[dict[str, Any]]:
    bindings: dict[str, list[dict[str, int]]] = {name: [] for name in EXPRESSIONS}
    used_meshes = {node["mesh"] for node in gltf.get("nodes", []) if "mesh" in node}
    for mesh_index, mesh in enumerate(gltf.get("meshes", [])):
        if mesh_index not in used_meshes:
            continue
        names = mesh.get("extras", {}).get("targetNames", [])
        if not isinstance(names, list):
            raise PackageError(f"Mesh {mesh_index} extras.targetNames must be an array.")
        for expression in EXPRESSIONS:
            if expression not in names:
                continue
            if names.count(expression) != 1:
                raise PackageError(f"Mesh {mesh_index} repeats morph target name {expression}.")
            target = names.index(expression)
            primitives = mesh.get("primitives", [])
            if not primitives or any(target >= len(primitive.get("targets", [])) for primitive in primitives):
                raise PackageError(f"Mesh {mesh_index} names {expression} but does not export its target on every primitive.")
            bindings[expression].append({"mesh": mesh_index, "index": target, "weight": 100})
    missing = [name for name, binds in bindings.items() if not binds]
    if missing:
        raise PackageError("Missing exported shape keys: " + ", ".join(missing) + ". Enable shape keys in Blender's glTF exporter.")
    return [
        {"name": name, "presetName": name, "binds": bindings[name], "materialValues": [], "isBinary": False}
        for name in EXPRESSIONS
    ]


def package(gltf: dict[str, Any], author: str, title: str, version: str,
            first_person_offset: list[float]) -> dict[str, Any]:
    extensions = gltf.setdefault("extensions", {})
    if "VRMC_vrm" in extensions or "VRM" in extensions:
        raise PackageError("Input already contains a VRM extension. Use the original Blender GLB.")
    unsupported = {"KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"}
    compressed = unsupported.intersection(gltf.get("extensionsUsed", []))
    if compressed:
        raise PackageError("Export without compression requiring extra decoders: " + ", ".join(sorted(compressed)))
    for kind in ("buffers", "images"):
        for resource in gltf.get(kind, []):
            uri = resource.get("uri")
            if uri is not None and not uri.startswith("data:"):
                raise PackageError(f"External {kind} URI {uri!r}: export embedded resources in one GLB.")
    bones = humanoid_nodes(gltf)
    groups = expression_groups(gltf)
    degree_map = {"curve": [0, 0, 0, 1, 1, 1, 1, 0], "xRange": 90, "yRange": 10}
    extensions["VRM"] = {
        "exporterVersion": "Skein-Threadkeeper-1.0",
        "specVersion": "0.0",
        "meta": {
            "title": title, "version": version, "author": author,
            "contactInformation": "https://saha.ing",
            "reference": "Original model, rig and expressions created for Saha; no borrowed model geometry.",
            "allowedUserName": "Everyone",
            # The misspelled Ussage keys are the actual VRM 0.0 field names.
            "violentUssageName": "Allow", "sexualUssageName": "Allow",
            "commercialUssageName": "Allow", "otherPermissionUrl": "",
            "licenseName": "CC0", "otherLicenseUrl": "",
        },
        "humanoid": {
            "humanBones": [{"bone": name, "node": bones[name], "useDefaultValues": True}
                           for name in HUMAN_BONES if name in bones],
            "armStretch": 0.05, "legStretch": 0.05,
            "upperArmTwist": 0.5, "lowerArmTwist": 0.5,
            "upperLegTwist": 0.5, "lowerLegTwist": 0.5,
            "feetSpacing": 0, "hasTranslationDoF": False,
        },
        "firstPerson": {
            "firstPersonBone": bones["head"],
            "firstPersonBoneOffset": dict(zip(("x", "y", "z"), first_person_offset)),
            "meshAnnotations": [{"mesh": index, "firstPersonFlag": "Auto"}
                                for index in range(len(gltf.get("meshes", [])))],
            "lookAtTypeName": "Bone",
            **{name: dict(degree_map) for name in (
                "lookAtHorizontalInner", "lookAtHorizontalOuter", "lookAtVerticalDown", "lookAtVerticalUp")},
        },
        "blendShapeMaster": {"blendShapeGroups": groups},
        "secondaryAnimation": {"boneGroups": [], "colliderGroups": []},
        "materialProperties": [
            {"name": material.get("name", f"Material_{index}"), "shader": "VRM_USE_GLTFSHADER",
             "renderQueue": -1, "floatProperties": {}, "vectorProperties": {},
             "textureProperties": {}, "keywordMap": {}, "tagMap": {}}
            for index, material in enumerate(gltf.get("materials", []))
        ],
    }
    used = gltf.setdefault("extensionsUsed", [])
    if "VRM" not in used:
        used.append("VRM")
    # VRM stays optional at glTF level: ordinary viewers should still show the
    # complete original PBR model without a VRM plugin.
    accessors = gltf.get("accessors", [])
    triangles = 0
    for mesh in gltf.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            if primitive.get("mode", 4) == 4:
                accessor = primitive.get("indices", primitive.get("attributes", {}).get("POSITION"))
                if accessor is not None:
                    triangles += accessors[accessor]["count"] // 3
    return {
        "title": title, "author": author, "license": "CC0", "vrmVersion": "0.0",
        "humanBones": len(bones), "meshes": len(gltf.get("meshes", [])),
        "materials": len(gltf.get("materials", [])), "triangles": triangles,
        "expressions": {group["name"]: len(group["binds"]) for group in groups},
        "orientation": "Unchanged; source must face -Z with +Y up.",
    }


def encode_glb(gltf: dict[str, Any], chunks: list[tuple[int, bytes]]) -> bytes:
    encoded = json.dumps(gltf, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    encoded += b" " * (-len(encoded) % 4)
    result = bytearray()
    for kind, data in [(JSON_CHUNK, encoded), *chunks]:
        result.extend(struct.pack("<II", len(data), kind))
        result.extend(data)
    size = 12 + len(result)
    if size > MAX_BYTES:
        raise PackageError(f"The result is {size:,} bytes, exceeding Saha's 40 MiB fetched-body guard.")
    return struct.pack("<III", GLB_MAGIC, 2, size) + result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", type=Path, help="Blender-exported, skinned .glb")
    parser.add_argument("output", type=Path, help="Destination .vrm")
    parser.add_argument("--title", default="Skein — The Threadkeeper")
    parser.add_argument("--author", default="Skein")
    parser.add_argument("--version", default="1.0")
    parser.add_argument("--first-person-offset", type=float, nargs=3, default=[0.0, 0.06, 0.0], metavar=("X", "Y", "Z"))
    args = parser.parse_args()
    try:
        if args.input.resolve() == args.output.resolve():
            raise PackageError("Keep the source GLB and output VRM as separate files.")
        gltf, chunks = read_glb(args.input)
        report = package(gltf, args.author, args.title, args.version, args.first_person_offset)
        data = encode_glb(gltf, chunks)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(data)
        report.update({"input": str(args.input.resolve()), "output": str(args.output.resolve()), "bytes": len(data)})
        print(json.dumps(report, ensure_ascii=False, indent=2))
    except (PackageError, OSError, ValueError, TypeError, KeyError, IndexError) as error:
        print(f"Cannot package avatar: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
