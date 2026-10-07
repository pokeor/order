"""Rigged low-poly pedestrian with Walk and Idle clips -> city/models/person.glb
Run: Blender --background --python blender/make_people.py -- <out.glb> [preview.png]
Materials Skin / Shirt / Pants / Hair / Shoe are re-tinted per person by city.js.
Front faces -Y in Blender (= +Z in glTF)."""
import bpy, bmesh, sys, math
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]; PNG = args[1] if len(args) > 1 else None
bpy.ops.wm.read_factory_settings(use_empty=True)

def lin(h):
    h = h.lstrip('#'); return [(int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4)]
def mat(name, col, rough=0.7):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(col), 1); b.inputs['Roughness'].default_value = rough; return m
MATS = {'Skin': mat('Skin', '#e0b090', 0.6), 'Shirt': mat('Shirt', '#4a7fd9'), 'Pants': mat('Pants', '#2b3445'),
        'Hair': mat('Hair', '#3b2616', 0.8), 'Shoe': mat('Shoe', '#e8e8e8', 0.5)}

# ---- armature: stub bones whose HEAD is the joint pivot
arm_data = bpy.data.armatures.new('Rig'); arm = bpy.data.objects.new('Rig', arm_data)
bpy.context.collection.objects.link(arm); bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
def bone(name, head, parent=None):
    b = arm_data.edit_bones.new(name); b.head = head; b.tail = (head[0], head[1], head[2] + 0.12)
    if parent: b.parent = arm_data.edit_bones[parent]
    return b
bone('Hips', (0, 0, 0.95)); bone('Spine', (0, 0, 1.0), 'Hips'); bone('Head', (0, 0, 1.4), 'Spine')
for s, x in (('L', 0.27), ('R', -0.27)):
    bone('UpperArm' + s, (x, 0, 1.34), 'Spine'); bone('LowerArm' + s, (x, 0, 1.04), 'UpperArm' + s)
for s, x in (('L', 0.11), ('R', -0.11)):
    bone('UpperLeg' + s, (x, 0, 0.92), 'Hips'); bone('LowerLeg' + s, (x, 0, 0.5), 'UpperLeg' + s)
bpy.ops.object.mode_set(mode='OBJECT')

# ---- body parts, each rigidly weighted to one bone
parts = []
def part(name, bonename, matname, build):
    bm = bmesh.new(); build(bm)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(MATS[matname]); bpy.context.collection.objects.link(ob)
    vg = ob.vertex_groups.new(name=bonename); vg.add([v.index for v in me.vertices], 1.0, 'REPLACE')
    for p in me.polygons: p.use_smooth = True
    parts.append(ob)
def cyl(r1, r2, h, x, y, z, seg=10):
    return lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=h, matrix=Matrix.Translation((x, y, z)))
def sph(r, x, y, z, sx=1, sy=1, sz=1, seg=12, rings=8):
    return lambda bm: bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0, matrix=Matrix.Translation((x, y, z)) @ Matrix.Diagonal((r * sx, r * sy, r * sz, 1)))
def blk(w, d, h, x, y, z):
    return lambda bm: bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((x, y, z)) @ Matrix.Diagonal((w, d, h, 1)))

part('pelvis', 'Hips', 'Pants', blk(0.42, 0.26, 0.24, 0, 0, 0.9))
part('torso', 'Spine', 'Shirt', sph(0.5, 0, 0, 1.2, 0.5, 0.3, 0.55, 14, 10))
part('head', 'Head', 'Skin', sph(0.2, 0, -0.01, 1.58, 1, 1.05, 1.1, 14, 10))
def hair(bm):
    bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=8, radius=1.0, matrix=Matrix.Translation((0, 0.03, 1.63)) @ Matrix.Diagonal((0.215, 0.225, 0.2, 1)))
    for v in [v for v in bm.verts if v.co.z < 1.60]: bm.verts.remove(v)
part('hair', 'Head', 'Hair', hair)
for s, x in (('L', 0.27), ('R', -0.27)):
    part('uarm' + s, 'UpperArm' + s, 'Shirt', cyl(0.075, 0.065, 0.34, x, 0, 1.19))
    part('larm' + s, 'LowerArm' + s, 'Skin', cyl(0.06, 0.05, 0.3, x, 0, 0.89))
    part('hand' + s, 'LowerArm' + s, 'Skin', sph(0.058, x, 0, 0.71, 1, 1, 1.2, 8, 6))
for s, x in (('L', 0.11), ('R', -0.11)):
    part('uleg' + s, 'UpperLeg' + s, 'Pants', cyl(0.095, 0.08, 0.46, x, 0, 0.7))
    part('lleg' + s, 'LowerLeg' + s, 'Pants', cyl(0.078, 0.06, 0.42, x, 0, 0.29))
    part('shoe' + s, 'LowerLeg' + s, 'Shoe', blk(0.13, 0.3, 0.1, x, -0.05, 0.05))

bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]; bpy.ops.object.join()
body = bpy.context.view_layer.objects.active; body.name = 'Person'
mod = body.modifiers.new('Armature', 'ARMATURE'); mod.object = arm; body.parent = arm

# ---- animation
bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='POSE')
PB = arm.pose.bones
for pb in PB: pb.rotation_mode = 'XYZ'
arm.animation_data_create()
def clip(name, frames, fn):
    act = bpy.data.actions.new(name); arm.animation_data.action = act
    for f in range(0, frames + 1, 2):
        t = (f / frames) * 2 * math.pi
        for pb in PB: pb.rotation_euler = (0, 0, 0)
        fn(t)
        for pb in PB: pb.keyframe_insert('rotation_euler', frame=f + 1)
    return act
def walk(t):
    s = math.sin(t)
    for side, ph in (('L', 0.0), ('R', math.pi)):
        sp = math.sin(t + ph)
        PB['UpperLeg' + side].rotation_euler.x = -sp * 0.62
        PB['LowerLeg' + side].rotation_euler.x = max(0.0, math.sin(t + ph + 1.6)) * 1.0 + 0.05
        PB['UpperArm' + side].rotation_euler.x = sp * 0.5
        PB['LowerArm' + side].rotation_euler.x = -0.35 - max(0.0, -sp) * 0.3
    PB['Spine'].rotation_euler.z = s * 0.06; PB['Head'].rotation_euler.z = -s * 0.04; PB['Hips'].rotation_euler.z = -s * 0.05
def idle(t):
    s = math.sin(t)
    PB['Spine'].rotation_euler.x = s * 0.015; PB['Head'].rotation_euler.z = math.sin(t * 0.5) * 0.25
    for side in 'LR':
        PB['UpperArm' + side].rotation_euler.x = s * 0.04; PB['LowerArm' + side].rotation_euler.x = -0.12
walk_act = clip('Walk', 24, walk); idle_act = clip('Idle', 72, idle)
for a in (walk_act, idle_act):
    a.use_fake_user = True
arm.animation_data.action = walk_act
bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); body.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=False, export_yup=True,
                          export_animations=True, export_animation_mode='ACTIONS', export_skins=True, export_cameras=False,
                          export_lights=False, export_extras=False)
print('EXPORTED person')

if PNG:
    sc = bpy.context.scene; sc.frame_set(7)
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 24; sc.cycles.device = 'CPU'; sc.render.resolution_x = 700; sc.render.resolution_y = 900; sc.render.filepath = PNG
    sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.55, 0.65, 1)
    sun = bpy.data.lights.new('s', 'SUN'); sun.energy = 4; so = bpy.data.objects.new('s', sun); so.rotation_euler = (math.radians(50), 0, math.radians(30)); bpy.context.collection.objects.link(so)
    cam = bpy.data.cameras.new('c'); co = bpy.data.objects.new('c', cam); co.location = (2.2, -4.2, 1.5)
    co.rotation_euler = (Vector((0, 0, 0.9)) - co.location).to_track_quat('-Z', 'Y').to_euler(); bpy.context.collection.objects.link(co); sc.camera = co
    bpy.ops.render.render(write_still=True)
