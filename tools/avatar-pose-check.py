"""
THE POSE TEST, line 3 of the body contract (Baiwei, 7040): does a body's head, torso and limbs pass through each
other in the room's poses? Run with Blender (4.2 or newer), headless:

    blender -b --factory-startup -P tools/avatar-pose-check.py -- public/avatars/skein.vrm [--json] [--render DIR] [--tolerance 5]

It reads the VRM's humanoid map, imports the file as glTF, sorts every vertex into a part by the humanoid bone that
moves it most (a hair or cloth bone counts as the humanoid bone it hangs from), puts the body in four poses
(idle with arms down, head turned 60 degrees, both arms forward, a wave), and counts intersecting triangles between
parts that should not meet. Parts that join (head and neck, upper arm and shoulder, hips and thighs) are not
compared. The rest pose is measured too: contact the model already has at rest, a collar against a chin, is
reported as the baseline and only what a pose adds counts against it.

It is a mechanical check of geometry, not of how the body looks; it says where to look.
"""
import bpy, bmesh, json, struct, sys, math, os, tempfile
from mathutils import Matrix, Vector, Quaternion
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not args:
    print("usage: blender -b --factory-startup -P tools/avatar-pose-check.py -- my.vrm [--json]"); sys.exit(2)
path, as_json = args[0], "--json" in args
render_dir = args[args.index("--render") + 1] if "--render" in args else None
# A graze of a few triangles is not visible in the room; more than this is.
TOLERANCE = int(args[args.index("--tolerance") + 1]) if "--tolerance" in args else 5

raw = open(path, "rb").read()
document = json.loads(raw[20:20 + struct.unpack("<I", raw[12:16])[0]])
ext = document.get("extensions", {})
if "VRMC_vrm" in ext:
    version = 1
    human = {name: one["node"] for name, one in ext["VRMC_vrm"]["humanoid"]["humanBones"].items()}
elif "VRM" in ext:
    version = 0
    human = {one["bone"]: one["node"] for one in ext["VRM"]["humanoid"]["humanBones"]}
else:
    print("not a VRM"); sys.exit(2)
node_name = {i: n.get("name", f"node_{i}") for i, n in enumerate(document.get("nodes", []))}
bone_of = {name: node_name[node] for name, node in human.items()}

def part(humanoid):
    if humanoid in ("head", "leftEye", "rightEye", "jaw"): return "head"
    if humanoid in ("spine", "chest", "upperChest"): return "torso"
    if humanoid == "hips": return "hips"
    if humanoid == "neck": return "neck"
    for side, key in (("left", "L"), ("right", "R")):
        if humanoid == f"{side}Shoulder": return f"shoulder{key}"
        if humanoid == f"{side}UpperArm": return f"upperArm{key}"
        if humanoid.startswith(side) and ("LowerArm" in humanoid or "Hand" in humanoid or any(f in humanoid for f in ("Thumb", "Index", "Middle", "Ring", "Little"))): return f"forearm{key}"
        if humanoid.startswith(side) and any(k in humanoid for k in ("UpperLeg", "LowerLeg", "Foot", "Toes")): return f"leg{key}"
    return None

PAIRS = [("head", "torso"), ("head", "upperArmL"), ("head", "upperArmR"), ("head", "forearmL"), ("head", "forearmR"),
         ("torso", "forearmL"), ("torso", "forearmR"), ("forearmL", "forearmR"), ("forearmL", "legL"), ("forearmR", "legR"),
         ("forearmL", "hips"), ("forearmR", "hips"), ("legL", "legR")]

# Import. Blender's glTF importer reads a .vrm as the GLB it is once it has a .glb name.
bpy.ops.wm.read_factory_settings(use_empty=True)
glb = os.path.join(tempfile.mkdtemp(), "body.glb")
open(glb, "wb").write(raw)
bpy.ops.import_scene.gltf(filepath=glb, bone_heuristic="TEMPERANCE")
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.find_armature() == arm]
humanoid_of_bone = {v: k for k, v in bone_of.items()}

def humanoid_for(bone_name):
    bone = arm.data.bones.get(bone_name)
    while bone is not None:
        if bone.name in humanoid_of_bone: return humanoid_of_bone[bone.name]
        bone = bone.parent
    return None

# Facing: VRM 0 faces glTF -Z, VRM 1 faces +Z; Blender's importer maps glTF -Z to +Y.
forward = Vector((0, 1, 0)) if version == 0 else Vector((0, -1, 0))
up = Vector((0, 0, 1))

def _turn(humanoid, rotation):
    """Rotate a posed bone about its own head, in the armature's frame; children follow."""
    name = bone_of.get(humanoid)
    if not name or name not in arm.pose.bones: return
    bpy.context.view_layer.update()
    pb = arm.pose.bones[name]
    m = pb.matrix.copy()
    pb.matrix = Matrix.Translation(m.translation) @ (rotation.to_matrix() @ m.to_3x3()).to_4x4()
    bpy.context.view_layer.update()

def aim(humanoid, direction):
    """Point a bone along a direction in the armature's frame."""
    name = bone_of.get(humanoid)
    if not name or name not in arm.pose.bones: return
    bpy.context.view_layer.update()
    current = (arm.pose.bones[name].matrix.to_3x3() @ Vector((0, 1, 0))).normalized()
    _turn(humanoid, current.rotation_difference(direction.normalized()))

def twist(humanoid, axis, degrees):
    _turn(humanoid, Quaternion(axis, math.radians(degrees)))

def reset():
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = Quaternion(); pb.location = (0, 0, 0)
    bpy.context.view_layer.update()

# Which way is the character's left? Read it from the rest pose: the left hand is on its left.
lh, rh = bone_of.get("leftHand"), bone_of.get("rightHand")
if lh and rh:
    x = (arm.data.bones[lh].head_local - arm.data.bones[rh].head_local).x
    left_dir = Vector((1 if x > 0 else -1, 0, 0))
else:
    left_dir = Vector((1, 0, 0))
out = {"left": left_dir, "right": -left_dir}

POSES = {
    "rest": lambda: None,
    "idle": lambda: [aim(f"{s}UpperArm", out[s] * 0.32 - up + forward * 0.05) or aim(f"{s}LowerArm", out[s] * 0.18 - up + forward * 0.2) for s in ("left", "right")],
    "head turned": lambda: twist("head", up, 60),
    "arms forward": lambda: [aim(f"{s}UpperArm", forward) or aim(f"{s}LowerArm", forward) for s in ("left", "right")],
    "wave": lambda: (aim("leftUpperArm", out["left"] * 0.32 - up), aim("leftLowerArm", out["left"] * 0.18 - up + forward * 0.2),
                     aim("rightUpperArm", out["right"] + up * 0.5), aim("rightLowerArm", up + forward * 0.15)),
}

def parts_now():
    """Triangles per part, in world space, from the evaluated (posed) meshes."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    verts, tris = {}, {}
    for o in meshes:
        groups = {g.index: g.name for g in o.vertex_groups}
        owner = []
        for v in o.data.vertices:
            best = max(v.groups, key=lambda g: g.weight, default=None)
            owner.append(part(humanoid_for(groups.get(best.group, ""))) if best else None)
        ev = o.evaluated_get(depsgraph); mesh = ev.to_mesh()
        mesh.calc_loop_triangles()
        world = [o.matrix_world @ v.co for v in mesh.vertices]
        for t in mesh.loop_triangles:
            owners = [owner[i] for i in t.vertices]
            p = max(set(owners), key=owners.count)
            if p is None or owners.count(p) < 2: continue
            base = verts.setdefault(p, [])
            tris.setdefault(p, []).append((len(base), len(base) + 1, len(base) + 2))
            base.extend(world[i] for i in t.vertices)
        ev.to_mesh_clear()
    return {p: BVHTree.FromPolygons(verts[p], tris[p], epsilon=0.0) for p in verts}

def snapshot(file):
    """A quick front view for checking that the pose is the one meant (debug only)."""
    scene = bpy.context.scene
    if "PoseCam" not in bpy.data.objects:
        cam = bpy.data.objects.new("PoseCam", bpy.data.cameras.new("PoseCam")); scene.collection.objects.link(cam)
        cam.data.type = "ORTHO"; cam.data.ortho_scale = 2.4
        cam.location = forward * 4 + Vector((0, 0, 0.9)); cam.rotation_euler = (-forward).to_track_quat("-Z", "Y").to_euler()
        scene.camera = cam
        sun = bpy.data.objects.new("PoseSun", bpy.data.lights.new("PoseSun", "SUN")); scene.collection.objects.link(sun)
        sun.rotation_euler = cam.rotation_euler
        scene.render.engine = "BLENDER_WORKBENCH"; scene.render.resolution_x, scene.render.resolution_y = 400, 400
    scene.render.filepath = file
    bpy.ops.render.render(write_still=True)

results, baseline = {}, {}
for pose, apply in POSES.items():
    reset(); apply()
    trees = parts_now()
    if render_dir: snapshot(os.path.join(render_dir, f"{os.path.basename(path)}-{pose.replace(' ', '-')}.png"))
    counts = {}
    for a, b in PAIRS:
        if a in trees and b in trees:
            n = len(trees[a].overlap(trees[b]))
            if pose == "rest": baseline[f"{a}/{b}"] = n
            elif n > baseline.get(f"{a}/{b}", 0): counts[f"{a}/{b}"] = n - baseline.get(f"{a}/{b}", 0)
    results[pose] = counts

found = sorted({p for p in sum([[k.split("/")[0], k.split("/")[1]] for k in baseline], [])})
report = {"file": os.path.basename(path), "vrm": version, "parts": found,
          "rest_contact": {k: v for k, v in baseline.items() if v}, "poses": {k: v for k, v in results.items() if k != "rest"}}
clean = all(n <= TOLERANCE for counts in report["poses"].values() for n in counts.values())
report["ok"] = clean
if as_json:
    print("POSECHECK " + json.dumps(report))
else:
    print(f"POSECHECK {report['file']} (VRM {version})")
    if report["rest_contact"]: print("  already touching at rest (baseline): " + ", ".join(f"{k} {v}" for k, v in report["rest_contact"].items()))
    for pose, counts in report["poses"].items():
        print(f"  {pose}: " + ("clear" if not counts else ", ".join(f"{k} +{v} triangles{' (graze)' if v <= TOLERANCE else ''}" for k, v in counts.items())))
    print("  OK: nothing passes through in the room's poses." if clean else "  LOOK: the parts above pass through each other in that pose.")
sys.exit(0 if clean else 1)
