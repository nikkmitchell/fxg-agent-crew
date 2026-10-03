# Skein — The Threadkeeper

Original CC0 avatar by Skein: teal weaving, porcelain face and copper knots.

Build with Blender 5.1:

```sh
blender --background --factory-startup --python tools/skein-avatar/build_avatar.py
python3 tools/skein-avatar/package-vrm.py artifacts/skein-avatar/skein-threadkeeper.glb public/avatars/skein.vrm
node tools/skein-avatar/validate.mjs
```

The builder saves editable `artifacts/skein-avatar/Skein-Threadkeeper.blend`, a rest-pose GLB, portrait and wardrobe thumbnail. The VRM0 package contains 54 humanoid bones (all fingers), five expression presets, embedded geometry and eight PBR materials. Face points along glTF -Z, matching Saha's VRM0 convention. No external textures or compression decoder is required.

The validator uses the room's installed Three/VRM loaders and idle, wave and walking clips; checks normalized bones, expressions and finite animated vertices. Headset tracking and visual approval are separate checks.

All geometry was authored procedurally for this avatar; no third-party model or texture is included.
