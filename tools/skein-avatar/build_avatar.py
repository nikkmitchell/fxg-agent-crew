"""Author Skein's Threadkeeper in Blender, with a real humanoid/finger skin.

Run in a fresh background Blender process. No downloaded meshes or textures.
The GLB is a rest-pose asset; the blend opens in a separate presentation pose.
"""
import bpy
import math
import json
import os
import sys
from mathutils import Vector, Quaternion

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OUT = os.path.join(ROOT, 'artifacts/skein-avatar')
os.makedirs(OUT, exist_ok=True)
# This script is run with --factory-startup in a NEW background process.
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

def material(name, colour, metallic=0, roughness=.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    node = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    def linear(v): return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4
    rgb = [linear(int(colour[i:i+2],16)/255) for i in (0,2,4)]
    node.inputs['Base Color'].default_value = (*rgb,1)
    node.inputs['Metallic'].default_value = metallic
    node.inputs['Roughness'].default_value = roughness
    if name.startswith(('01', '04')):
        node.inputs['Emission Color'].default_value = (*rgb,1)
        node.inputs['Emission Strength'].default_value = .18 if name.startswith('01') else .12
    m.diffuse_color = (*rgb,1)
    return m

MATS = [
    material('01 • Deep tide / woven cloth','006A57',.05,.72),
    material('02 • Inkwell / flexible joints','102B32',0,.65),
    material('03 • Porcelain / warm face','EAD9BA',0,.38),
    material('04 • Burnished copper / seam','D87528',.65,.30),
    material('05 • Flax / raised threads','B8C6BA',.05,.75),
    material('06 • Honey / eyes','F5C96D',.25,.3),
    material('07 • Night / facial features','091B22',0,.48),
    material('08 • Catchlight','FFF1D0',.05,.28),
]

class Mesh:
    def __init__(self,name):
        self.name=name; self.v=[]; self.f=[]; self.m=[]; self.w=[]
    def add(self,verts,faces,mat,weights):
        offset=len(self.v)
        self.v.extend([tuple(p) for p in verts]); self.f.extend([tuple(offset+i for i in f) for f in faces])
        self.m.extend([mat]*len(faces))
        self.w.extend([weights(Vector(p)) if callable(weights) else weights for p in verts])
        return list(range(offset,len(self.v)))
    def ellipsoid(self,center,radii,mat,weights,seg=16,rings=10,rotation=None):
        verts=[]; faces=[]; c=Vector(center)
        def point(p):
            p=Vector(p)
            return c+(rotation@p if rotation else p)
        verts.append(point((0,0,-radii[2])))
        for j in range(1,rings):
            lat=-math.pi/2+math.pi*j/rings
            for i in range(seg):
                a=2*math.pi*i/seg
                verts.append(point((radii[0]*math.cos(lat)*math.cos(a),radii[1]*math.cos(lat)*math.sin(a),radii[2]*math.sin(lat))))
        north=len(verts); verts.append(point((0,0,radii[2])))
        for i in range(seg):
            n=(i+1)%seg
            faces.append((0,1+n,1+i))
            for j in range(rings-2):
                lo=1+j*seg; hi=lo+seg
                faces.append((lo+i,lo+n,hi+n,hi+i))
            last=1+(rings-2)*seg
            faces.append((last+i,last+n,north))
        return self.add(verts,faces,mat,weights)
    def tube(self,points,radius,mat,weights,sides=8,closed=False):
        pts=[Vector(p) for p in points]; verts=[]; faces=[]
        for i,p in enumerate(pts):
            tangent=(pts[(i+1)%len(pts)]-pts[(i-1)%len(pts)]).normalized() if closed else (pts[min(i+1,len(pts)-1)]-pts[max(i-1,0)]).normalized()
            axis=Vector((0,0,1))
            if abs(tangent.dot(axis))>.9: axis=Vector((0,1,0))
            u=tangent.cross(axis).normalized(); v=tangent.cross(u).normalized()
            r=radius[i] if isinstance(radius,list) else radius
            for j in range(sides):
                a=2*math.pi*j/sides; verts.append(p+r*(math.cos(a)*u+math.sin(a)*v))
        for i in range(len(pts) if closed else len(pts)-1):
            n=(i+1)%len(pts)
            for j in range(sides):
                faces.append((i*sides+j,i*sides+(j+1)%sides,n*sides+(j+1)%sides,n*sides+j))
        if not closed:
            faces.extend([tuple(reversed(range(sides))),tuple((len(pts)-1)*sides+j for j in range(sides))])
        return self.add(verts,faces,mat,weights)
    def capsule(self,a,b,width,depth,mat,weights):
        a=Vector(a); b=Vector(b); mid=(a+b)/2
        q=Vector((0,0,1)).rotation_difference(b-a)
        return self.ellipsoid(mid,(width,depth,(b-a).length/2+width*.32),mat,weights,10 if width<.02 else 16,6 if width<.02 else 10,q)
    def loft(self,sections,mat,weights,seg=40):
        verts=[]; faces=[]
        for z,rx,ry,dy in sections:
            for i in range(seg):
                t=2*math.pi*i/seg
                verts.append((rx*math.cos(t),dy+ry*math.sin(t),z))
        for j in range(len(sections)-1):
            for i in range(seg): faces.append((j*seg+i,j*seg+(i+1)%seg,(j+1)*seg+(i+1)%seg,(j+1)*seg+i))
        faces.extend([tuple(reversed(range(seg))),tuple((len(sections)-1)*seg+i for i in range(seg))])
        return self.add(verts,faces,mat,weights)
    def object(self,rig):
        mesh=bpy.data.meshes.new(self.name); mesh.from_pydata(self.v,[],self.f); mesh.update()
        obj=bpy.data.objects.new(self.name,mesh); bpy.context.collection.objects.link(obj)
        for mat in MATS: mesh.materials.append(mat)
        for p,mi in zip(mesh.polygons,self.m): p.material_index=mi; p.use_smooth=True
        groups={}
        for i,weights in enumerate(self.w):
            for bone,value in weights.items():
                if bone not in groups: groups[bone]=obj.vertex_groups.new(name=bone)
                groups[bone].add([i],value,'REPLACE')
        mod=obj.modifiers.new('Humanoid deformation','ARMATURE'); mod.object=rig
        obj.parent=rig
        return obj

body=Mesh('Skein • woven body')
face=Mesh('Skein • expression face')
headw={'head':1}
def torso(p):
    points=[(.9,'hips'),(1.075,'spine'),(1.245,'chest'),(1.365,'upperChest')]
    for i in range(len(points)-1):
        z0,b0=points[i]; z1,b1=points[i+1]
        if p.z<=z1:
            t=max(0,min(1,(p.z-z0)/(z1-z0))); return {b0:1-t,b1:t}
    return {'upperChest':1}

# Rest skeleton, +Y front in Blender, -Z front after glTF's axis conversion.
bones=[
    ('hips',(0,0,.91),(0,0,1.0),None),
    ('spine',(0,0,1.0),(0,0,1.17),'hips'),
    ('chest',(0,0,1.17),(0,0,1.32),'spine'),
    ('upperChest',(0,0,1.32),(0,0,1.405),'chest'),
    ('neck',(0,0,1.405),(0,0,1.49),'upperChest'),
    ('head',(0,0,1.49),(0,0,1.705),'neck'),
    ('leftEye',(-.053,.103,1.607),(-.053,.13,1.607),'head'),
    ('rightEye',(.053,.103,1.607),(.053,.13,1.607),'head'),
]
for side,s in [('left',-1),('right',1)]:
    def v(x,y,z): return (s*x,y,z)
    bones += [
      (side+'Shoulder',v(.04,0,1.36),v(.2,0,1.36),'upperChest'),
      (side+'UpperArm',v(.2,0,1.36),v(.465,0,1.36),side+'Shoulder'),
      (side+'LowerArm',v(.465,0,1.36),v(.705,0,1.36),side+'UpperArm'),
      (side+'Hand',v(.705,0,1.36),v(.805,0,1.36),side+'LowerArm'),
      (side+'UpperLeg',v(.105,0,.91),v(.105,0,.52),'hips'),
      (side+'LowerLeg',v(.105,0,.52),v(.105,0,.145),side+'UpperLeg'),
      (side+'Foot',v(.105,0,.145),v(.105,.14,.072),side+'LowerLeg'),
      (side+'Toes',v(.105,.14,.072),v(.105,.225,.06),side+'Foot'),
    ]
    fingers=[('Thumb',[(.739,.045,1.35),(.783,.078,1.35),(.817,.101,1.35),(.842,.116,1.35)]),
      ('Index',[(.79,.045,1.36),(.839,.047,1.36),(.869,.048,1.36),(.893,.049,1.36)]),
      ('Middle',[(.804,.009,1.36),(.858,.009,1.36),(.892,.009,1.36),(.918,.009,1.36)]),
      ('Ring',[(.796,-.024,1.36),(.844,-.026,1.36),(.875,-.027,1.36),(.900,-.028,1.36)]),
      ('Little',[(.778,-.053,1.36),(.815,-.059,1.36),(.842,-.063,1.36),(.863,-.066,1.36)])]
    for finger,coords in fingers:
        for i,suffix in enumerate(['Proximal','Intermediate','Distal']):
            name=side+finger+suffix; parent=side+'Hand' if i==0 else side+finger+['Proximal','Intermediate'][i-1]
            bones.append((name,v(*coords[i]),v(*coords[i+1]),parent))

armature=bpy.data.armatures.new('Threadkeeper • 54 bone humanoid')
rig=bpy.data.objects.new('Skein_Humanoid',armature); bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig; rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name,a,b,parent in bones:
    bone=armature.edit_bones.new(name); bone.head=a; bone.tail=b
    if parent: bone.parent=armature.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
rig.show_in_front=True
rig['design']='Skein / The Threadkeeper — original meshes, CC0'
rig['front']='Blender +Y, glTF -Z (VRM 0.x)'

# Shaped jacket with a close waist and rounded shoulders.
body.loft([(.805,.164,.095,0),(.86,.17,.103,0),(.945,.158,.097,0),(1.015,.14,.084,0),(1.10,.155,.096,0),(1.205,.185,.109,0),(1.30,.203,.102,0),(1.365,.186,.08,0),(1.4,.085,.068,0)],0,torso)
body.ellipsoid((0,0,.87),(.16,.105,.105),1,{'hips':1})
body.capsule((0,0,1.35),(0,0,1.49),.059,.058,1,{'neck':1})

def torso_shape(z):
    sections=[(.815,.167,.101),(.94,.16,.103),(1.015,.148,.09),(1.10,.163,.102),(1.205,.193,.115),(1.3,.208,.108),(1.365,.19,.086)]
    for i in range(len(sections)-1):
        za,xa,ya=sections[i];zb,xb,yb=sections[i+1]
        if z<=zb:
            t=max(0,min(1,(z-za)/(zb-za)));return xa+(xb-xa)*t,ya+(yb-ya)*t
    return sections[-1][1:]

# A lattice of raised threads is real silhouette geometry, not a baked picture.
for direction in [-1,1]:
    for j in range(8):
        pts=[]
        for i in range(24):
            z=.835+i/23*.50; theta=2*math.pi*j/8+direction*(z-.835)*6.5
            rx,ry=torso_shape(z); pts.append((rx*math.cos(theta),ry*math.sin(theta),z))
        body.tube(pts,.006,4 if direction==1 else 0,torso,5)

# Copper selvedge at waist; one continuous stitch encircles the woven body.
for z in [.823,.853]:
    rx,ry=torso_shape(z)
    body.tube([(rx*math.cos(t*2*math.pi/60),ry*math.sin(t*2*math.pi/60),z) for t in range(60)],.007,3,{'hips':1},8,True)

for side,s in [('left',-1),('right',1)]:
    def v(x,y,z): return (s*x,y,z)
    upper={side+'UpperArm':1};lower={side+'LowerArm':1};handw={side+'Hand':1}
    body.ellipsoid(v(.203,0,1.36),(.068,.074,.075),0,{side+'Shoulder':.35,side+'UpperArm':.65})
    body.capsule(v(.23,0,1.36),v(.442,0,1.36),.066,.072,0,upper)
    body.ellipsoid(v(.465,0,1.36),(.039,.05,.05),1,lower)
    body.capsule(v(.483,0,1.36),v(.686,0,1.36),.046,.054,2,lower)
    for j in range(9):
        x=.50+j*.021
        rr=.049*(1-.23*(x-.5)/.19)
        pts=[v(x+.005*math.sin(2*t),rr*math.cos(t),1.36+rr*math.sin(t)) for t in [k*2*math.pi/22 for k in range(22)]]
        body.tube(pts,.004,4 if j%3 else 3,lower,5,True)
    for x in [.274,.3]:
        body.tube([v(x,.077*math.cos(t),1.36+.069*math.sin(t)) for t in [k*2*math.pi/32 for k in range(32)]],.006,3,upper,8,True)
    body.ellipsoid(v(.712,0,1.36),(.025,.049,.041),3,lower)
    body.ellipsoid(v(.756,-.005,1.36),(.059,.061,.023),1,handw)
    body.ellipsoid(v(.752,-.01,1.375),(.042,.046,.013),2,handw)
    # Each phalanx has its own weights, including the three thumb joints.
    for name,a,b,parent in bones:
        if not name.startswith(side) or not any(f in name for f in ['Thumb','Index','Middle','Ring','Little']): continue
        weight={name:1}; index=['Proximal','Intermediate','Distal'].index(next(k for k in ['Proximal','Intermediate','Distal'] if name.endswith(k)))
        radius=.013 if 'Thumb' in name else .0118 if 'Little' not in name else .0097
        body.capsule(a,b,radius*(1-.07*index),radius*.85,2,weight)
        body.ellipsoid(a,(radius*.92,radius*.92,radius*.92),3,weight,10,6)
    up={side+'UpperLeg':1};lo={side+'LowerLeg':1};foot={side+'Foot':1}
    body.capsule(v(.105,0,.86),v(.105,0,.53),.078,.083,0,up)
    body.ellipsoid(v(.105,0,.52),(.057,.061,.053),1,lo)
    body.capsule(v(.105,0,.51),v(.105,.006,.19),.055,.06,0,lo)
    body.ellipsoid(v(.105,.026,.17),(.071,.078,.094),1,foot)
    body.ellipsoid(v(.105,.083,.074),(.079,.157,.064),1,foot)
    body.ellipsoid(v(.105,.13,.092),(.074,.111,.048),2,foot)
    for z,mat in [(.228,3),(.248,4),(.273,4)]:
        body.tube([v(.105+.065*math.cos(t),.006+.067*math.sin(t),z) for t in [k*2*math.pi/36 for k in range(36)]],.005,mat,lo,7,True)
    # Knee patch and a running seam down the shin.
    body.ellipsoid(v(.105,.062,.52),(.046,.017,.051),3,lo,20,10)
    body.tube([v(.11,.059,.27+i*.014) for i in range(16)],.005,4,lo,6)
    body.tube([v(.105+.078*math.cos(t),.083+.155*math.sin(t),.04) for t in [k*2*math.pi/48 for k in range(48)]],.006,3,foot,8,True)

# Asymmetric short woven mantle, curved around the shoulders without a long cape.
for j in range(7):
    pts=[]
    for i in range(55):
        t=-.25+i/54*2.9
        pts.append((.205*math.cos(t),.109*math.sin(t),1.365-j*.012-.035*(math.cos(t)*.5+.5)))
    body.tube(pts,.009,4 if j in [0,6] else 0,torso,8)
for j in range(3):
    body.tube([(.073*math.cos(t),.073*math.sin(t),1.414+j*.014) for t in [k*2*math.pi/48 for k in range(48)]],.011,0 if j!=1 else 3,{'neck':.3,'upperChest':.7},8,True)

# An open interlaced knot at the sternum: Skein's identifying mark.
for j in range(2):
    pts=[]
    for i in range(48):
        t=2*math.pi*i/48
        pts.append((.027*math.sin(t)+(j-.5)*.025,.126+.008*math.cos(t*2+j*math.pi),1.255+.041*math.cos(t)))
    body.tube(pts,.0065,3,{'chest':1},8,True)
body.ellipsoid((0,.13,1.255),(.008,.008,.013),5,{'chest':1},12,8)

# A porcelain mask nested in a tide-coloured head shell.
body.ellipsoid((0,-.009,1.579),(.124,.111,.153),0,headw,32,24)
body.ellipsoid((0,.033,1.574),(.112,.098,.137),2,headw,32,24)
# Nose bridges and ears retain a face at room scale.
body.ellipsoid((0,.128,1.568),(.017,.019,.029),2,headw,16,12)
for s in [-1,1]:
    body.ellipsoid((s*.12,.008,1.582),(.019,.027,.046),3,headw,16,12)
    body.ellipsoid((s*.124,.026,1.584),(.009,.012,.024),1,headw,12,10)

# Thread crest: three deliberate swept loops with copper ends.
for j in range(5):
    pts=[]
    for i in range(45):
        t=i/44
        x=-.094+(.175-j*.009)*t
        y=-.024+j*.018-.057*math.sin(math.pi*t)
        z=1.657+.126*math.sin(math.pi*t)**.8+j*.004
        pts.append((x,y,z))
    body.tube(pts,.014 if j<3 else .010,0 if j!=3 else 4,headw,9)
body.tube([(-.108,.018,1.62),(-.126,.009,1.675),(-.119,-.01,1.744),(-.08,-.015,1.802),(-.023,.002,1.806),(.009,.031,1.768),(-.004,.055,1.732)],.014,3,headw,9)

# Expression geometry. All morphs are authored on the actual exported skin.
eye_indices=[]; eyebrows=[]; mouth_indices=[]
for s in [-1,1]:
    eye_name='leftEye' if s==-1 else 'rightEye'
    cx=s*.050; cz=1.605
    ids=[]
    ids+=face.ellipsoid((cx,.123,cz),(.034,.011,.022),6,{eye_name:1},24,16)
    ids+=face.ellipsoid((cx,.132,cz),(.024,.006,.0155),5,{eye_name:1},24,14)
    ids+=face.ellipsoid((cx,.138,cz),(.010,.003,.013),6,{eye_name:1},20,12)
    ids+=face.ellipsoid((cx-s*.007,.142,cz+.007),(.004,.002,.004),7,{eye_name:1},12,8)
    eye_indices.append((ids,cz))
    pts=[(cx+(-.03+i*.0075),.126,1.643+.009*math.sin(i/8*math.pi)) for i in range(9)]
    eyebrows.extend(face.tube(pts,.0045,0,headw,8))
    # Tiny copper freckles.
    for i in range(3): body.ellipsoid((s*(.066+i*.012),.115-i*.006,1.56-i*.004),(.0028,.0028,.0028),3,headw,8,6)
mouth_indices+=face.ellipsoid((0,.129,1.53),(.029,.005,.006),6,headw,24,12)
body.tube([(-.027,.129,1.529),(-.013,.134,1.525),(0,.136,1.524),(.013,.134,1.525),(.027,.129,1.529)],.0028,3,headw,6)

skin=body.object(rig)
# Simplify the static cloth while preserving the hand weights and face morphs.
bpy.context.view_layer.objects.active=skin
skin.select_set(True)
simplify=skin.modifiers.new('Headset mesh budget','DECIMATE')
simplify.ratio=.43
simplify.use_collapse_triangulate=True
bpy.ops.object.modifier_apply(modifier=simplify.name)
expression=face.object(rig)
expression.shape_key_add(name='Basis',from_mix=False)
for name in ['blink','a','joy','sorrow','fun']:
    key=expression.shape_key_add(name=name,from_mix=False)
    key.value=0
    if name=='blink':
        for indices,z in eye_indices:
            for i in indices: key.data[i].co.z=z+(key.data[i].co.z-z)*.06
    elif name=='a':
        for i in mouth_indices:
            p=key.data[i].co; p.z=1.524+(p.z-1.53)*3.5; p.x*=.7; p.y+=.004
    elif name in ['joy','sorrow','fun']:
        factor=1 if name=='joy' else -.8 if name=='sorrow' else .45
        for i in mouth_indices:
            p=key.data[i].co; p.z+=factor*.010*(abs(p.x)/.029)**1.5
        for i in eyebrows:
            p=key.data[i].co; p.z+=.004*factor
        for indices,z in eye_indices:
            for i in indices:
                p=key.data[i].co
                p.z=z+(p.z-z)*(1-.2*max(factor,0))

# Useful original source metadata follows the .blend and the glTF node extras.
for obj in [rig,skin,expression]:
    obj['creator']='Skein';obj['license']='CC0-1.0';obj['original_geometry']=True
bpy.context.scene['README']='Threadkeeper is authored in rest T-pose, with 54 VRM0 bones and five facial morphs. Run build_avatar.py to regenerate. The scene is displayed in presentation pose; export uses rest pose.'

# Export only the avatar, in rest pose, with morphs, armature and no scene lights.
bpy.ops.object.select_all(action='DESELECT')
for obj in [rig,skin,expression]: obj.select_set(True)
bpy.context.view_layer.objects.active=rig
export_options={p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
args=dict(filepath=os.path.join(OUT,'skein-threadkeeper.glb'),export_format='GLB',use_selection=True,export_animations=False,export_skins=True,export_morph=True,export_extras=True)
if 'export_yup' in export_options: args['export_yup']=True
if 'export_apply' in export_options: args['export_apply']=False
bpy.ops.export_scene.gltf(**args)

def rotate_world(name,axis,angle):
    pb=rig.pose.bones[name]; rest=rig.data.bones[name].matrix_local.to_quaternion()
    pb.rotation_mode='QUATERNION';pb.rotation_quaternion=rest.inverted()@Quaternion(Vector(axis),angle)@rest
for side,s in [('left',-1),('right',1)]:
    rotate_world(side+'UpperArm',(0,1,0),s*math.radians(63))
    rotate_world(side+'LowerArm',(0,0,1),s*math.radians(9))
rotate_world('head',(0,0,1),math.radians(-7))
expression.data.shape_keys.key_blocks['joy'].value=.35

# A quiet studio presentation; these objects are deliberately outside the export.
floor_mat=material('Studio • warm stone','C6C5BE',0,.86)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,.001));floor=bpy.context.object;floor.name='Studio ground (not exported)';floor.data.materials.append(floor_mat)
def area(name,loc,power,size,colour,target):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=colour
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);obj.location=loc;obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
area('Key / silkbox',(2.3,3.2,4),430,3.0,(1,.88,.74),(0,0,1))
area('Fill / cool',(-2,1.3,2.6),260,2.5,(.70,.88,1),(0,0,1))
area('Rim / warm',(0,-2.5,3),500,2,(1,.75,.48),(0,0,1.3))
world=bpy.data.worlds.new('Quiet gallery');bpy.context.scene.world=world;world.use_nodes=True
background=next(n for n in world.node_tree.nodes if n.type=='BACKGROUND');background.inputs[0].default_value=(.38,.42,.45,1);background.inputs[1].default_value=.35
camera_data=bpy.data.cameras.new('Portrait camera');camera=bpy.data.objects.new('Portrait camera',camera_data);bpy.context.collection.objects.link(camera)
camera.location=(2.6,5,2.1);target=Vector((0,0,.96));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera_data.type='ORTHO';camera_data.ortho_scale=2.15
scene=bpy.context.scene;scene.camera=camera
try: scene.render.engine='CYCLES'
except TypeError: pass
if hasattr(scene,'cycles'): scene.cycles.samples=48;scene.cycles.use_denoising=True
scene.render.resolution_x=1200;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
formats=[i.identifier for i in scene.render.image_settings.bl_rna.properties['file_format'].enum_items]
if 'PNG' in formats: scene.render.image_settings.file_format='PNG'
scene.render.filepath=os.path.join(OUT,'skein-threadkeeper-portrait.png')
scene.render.film_transparent=False
# Frame the actual model on opening the saved file.
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
for screen in bpy.data.screens:
    for area_ui in screen.areas:
        if area_ui.type=='VIEW_3D':
            space=area_ui.spaces.active;space.region_3d.view_distance=2.6;space.region_3d.view_location=(0,0,.96);space.region_3d.view_rotation=camera.rotation_euler.to_quaternion();space.shading.type='MATERIAL'
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'Skein-Threadkeeper.blend'))
stats={'bones':len(bones),'vertices':len(skin.data.vertices)+len(expression.data.vertices),'polygons':len(skin.data.polygons)+len(expression.data.polygons),'triangles':sum(len(p.vertices)-2 for ob in [skin,expression] for p in ob.data.polygons),'materials':len(MATS),'expressions':['blink','a','joy','sorrow','fun'],'heightMeters':max(p[2] for p in body.v+face.v)}
with open(os.path.join(OUT,'source-stats.json'),'w') as f: json.dump(stats,f,indent=2)
print('SKEIN_STATS',json.dumps(stats),flush=True)
bpy.ops.render.render(write_still=True)
camera.location=(0,5,1.3);camera.rotation_euler=(Vector((0,0,.96))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=os.path.join(OUT,'skein-threadkeeper-front.png');scene.cycles.samples=32
bpy.ops.render.render(write_still=True)
scene.render.resolution_x=200;scene.render.resolution_y=300
camera_data.ortho_scale=2.13
scene.render.image_settings.file_format='JPEG' if 'JPEG' in formats else 'PNG'
scene.render.image_settings.quality=92
scene.render.filepath=os.path.join(ROOT,'public/avatars/thumbs/skein.jpg')
bpy.ops.render.render(write_still=True)
print('SKEIN_FINISHED',OUT,flush=True)
