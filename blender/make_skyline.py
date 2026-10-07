"""Background skyline building types -> city/models/sk_<name>.glb (instanced on the web).
Run: Blender --background --python blender/make_skyline.py -- <models_dir> [preview.png]
Materials: Wall (tinted per instance by instance colour), Roof, GlassLit/GlassCool/GlassDark, Frame, Metal, Beacon, Trim."""
import bpy, bmesh, sys, math, random, os
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
OUT_DIR = args[0]; PNG = args[1] if len(args) > 1 else None
bpy.ops.wm.read_factory_settings(use_empty=True)

def lin(h):
    h = h.lstrip('#'); return [(int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4)]
def mm(name, col, rough=0.8, metal=0.0, emit=None, st=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(col), 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if emit: b.inputs['Emission Color'].default_value = (*lin(emit), 1); b.inputs['Emission Strength'].default_value = st
    return m
MATS = {'Wall': mm('Wall', '#d8d4cc'), 'Trim': mm('Trim', '#b9b4aa', 0.7), 'Roof': mm('Roof', '#3a3f45', 0.9), 'Frame': mm('Frame', '#22272b', 0.5),
        'Metal': mm('Metal', '#aab2b8', 0.35, 0.8), 'Beacon': mm('Beacon', '#ff3b3b', 0.4, 0, '#ff3b3b', 3.0),
        'GlassLit': mm('GlassLit', '#6b4a22', 0.2, 0, '#ffc66e', 1.0), 'GlassCool': mm('GlassCool', '#3a5f80', 0.2, 0, '#bfe3ff', 0.9),
        'GlassDark': mm('GlassDark', '#162330', 0.15)}
bms = {}
def reset():
    global bms; bms = {k: bmesh.new() for k in MATS}
def box(m, cx, cy, cz, sx, sy, sz, rz=0.0):
    if m == 'Frame': return   # distant buildings: glass panes only (halves triangles)
    bmesh.ops.create_cube(bms[m], size=1.0, matrix=Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Diagonal((sx, sy, sz, 1)))
def cyl(m, cx, cy, cz, r1, r2, h, seg=32):
    bmesh.ops.create_cone(bms[m], cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=h, matrix=Matrix.Translation((cx, cy, cz)))
def sph(m, cx, cy, cz, r):
    bmesh.ops.create_uvsphere(bms[m], u_segments=18, v_segments=10, radius=r, matrix=Matrix.Translation((cx, cy, cz)))
rng = random.Random(11)
def glass(): r = rng.random(); return 'GlassLit' if r < 0.55 else ('GlassCool' if r < 0.72 else 'GlassDark')

def grid_faces(w, d, z0, z1, step, cols_w, cols_d, ox=0, oy=0):
    z = z0
    while z < z1:
        for face in range(4):
            span, cols = (w, cols_w) if face in (0, 1) else (d, cols_d)
            for i in range(cols):
                u = (i - (cols - 1) / 2) * (span - 3.2) / max(1, cols - 1)
                g = glass()
                if face in (0, 1):
                    s = -1 if face == 0 else 1; y = oy + s * (d / 2 + 0.12)
                    box('Frame', ox + u, y, z, 2.0, 0.3, 2.5); box(g, ox + u, y + s * 0.12, z, 1.6, 0.1, 2.1)
                else:
                    s = -1 if face == 2 else 1; x = ox + s * (w / 2 + 0.12)
                    box('Frame', x, oy + u, z, 0.3, 2.0, 2.5); box(g, x + s * 0.12, oy + u, z, 0.1, 1.6, 2.1)
        z += step

def stepped():
    w = d = 18; hs = [26, 14, 9]
    box('Trim', 0, 0, 0.5, w + 1, d + 1, 1)
    box('Wall', 0, 0, hs[0] / 2, w, d, hs[0]); box('Wall', 0, 0, hs[0] + hs[1] / 2, w * 0.7, d * 0.7, hs[1]); box('Wall', 0, 0, hs[0] + hs[1] + hs[2] / 2, w * 0.45, d * 0.45, hs[2])
    for z in (hs[0], hs[0] + hs[1]): box('Trim', 0, 0, z, w * (0.7 if z > hs[0] else 1) + 0.8, d * (0.7 if z > hs[0] else 1) + 0.8, 0.6)
    box('Roof', 0, 0, sum(hs) + 0.4, w * 0.45 + 0.8, d * 0.45 + 0.8, 0.8); box('Metal', 0, 0, sum(hs) + 5, 0.25, 0.25, 9); box('Beacon', 0, 0, sum(hs) + 9.8, 0.9, 0.9, 0.9)
    grid_faces(w, d, 3.5, hs[0] - 1.5, 3.8, 4, 4); grid_faces(w * 0.7, d * 0.7, hs[0] + 2, hs[0] + hs[1] - 1, 3.6, 3, 3); grid_faces(w * 0.45, d * 0.45, sum(hs) - hs[2] + 2, sum(hs) - 1.5, 3.4, 2, 2)
    return sum(hs) + 10
def slab():
    w, d, h = 32, 12, 24
    box('Trim', 0, 0, 0.5, w + 1, d + 1, 1); box('Wall', 0, 0, h / 2, w, d, h); box('Roof', 0, 0, h + 0.4, w + 1, d + 1, 0.8)
    for k, z in enumerate(range(4, h - 2, 4)):
        for face in (0, 1):
            s = -1 if face == 0 else 1
            for i in range(-6, 7):
                g = glass(); box('Frame', i * 2.4, s * (d / 2 + 0.1), z, 2.2, 0.3, 2.4); box(g, i * 2.4, s * (d / 2 + 0.22), z, 1.9, 0.1, 2.0)
    for z in range(4, h - 2, 4): box('Trim', 0, 0, z - 1.5, w + 0.5, d + 0.5, 0.25)
    for x in (-8, 8): box('Metal', x, 0, h + 2.2, 3, 3, 2.8)
    box('Beacon', w / 2 - 1, 0, h + 1.4, 0.8, 0.8, 0.8)
    return h + 3
def apartment():
    w, d, h = 20, 16, 26
    box('Trim', 0, 0, 0.5, w + 1, d + 1, 1); box('Wall', 0, 0, h / 2, w, d, h)
    z = 4
    while z < h - 2:
        for face in (0, 1):
            s = -1 if face == 0 else 1
            for i in range(4):
                u = (i - 1.5) * 4.4; g = glass()
                box('Frame', u, s * (d / 2 + 0.1), z, 2.2, 0.3, 2.6); box(g, u, s * (d / 2 + 0.22), z, 1.8, 0.1, 2.2)
            box('Trim', 0, s * (d / 2 + 0.9), z - 1.6, w * 0.9, 1.8, 0.25)
        for face in (2, 3):
            s = -1 if face == 2 else 1
            for i in range(3):
                u = (i - 1) * 4.6; g = glass(); box('Frame', s * (w / 2 + 0.1), u, z, 0.3, 2.2, 2.6); box(g, s * (w / 2 + 0.22), u, z, 0.1, 1.8, 2.2)
        z += 3.6
    sh = bmesh.ops  # gable roof
    bm = bms['Roof']; v = []
    for ww, dd, zz in ((w + 1.4, d + 1.4, h), (w + 1.4, 0.3, h + 5)):
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)): v.append(bm.verts.new((sx * ww / 2, sy * dd / 2, zz)))
    for f in ((3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)): bm.faces.new([v[i] for i in f])
    box('Wall', 5, 0, h + 3, 1.6, 1.6, 4); box('Beacon', 0, 0, h + 5.6, 0.8, 0.8, 0.8)
    return h + 6
def round_tower():
    r, h = 9, 36
    cyl('Trim', 0, 0, 0.6, r + 0.8, r + 0.8, 1.2); cyl('Wall', 0, 0, h / 2, r, r, h)
    for z in range(4, h - 2, 4):
        cyl('Trim', 0, 0, z - 1.6, r + 0.3, r + 0.3, 0.25)
        for k in range(14):
            a = k * (2 * math.pi / 14) + (0.2 if (z // 4) % 2 else 0); g = glass()
            box('Frame', math.cos(a) * (r + 0.1), math.sin(a) * (r + 0.1), z, 0.3, 2.2, 2.6, rz=a); box(g, math.cos(a) * (r + 0.22), math.sin(a) * (r + 0.22), z, 0.1, 1.8, 2.2, rz=a)
    cyl('Roof', 0, 0, h + 0.6, r + 0.7, r + 0.7, 1.2); sph('Metal', 0, 0, h + 1.2, r * 0.55); box('Metal', 0, 0, h + 8, 0.25, 0.25, 8); box('Beacon', 0, 0, h + 12.2, 0.9, 0.9, 0.9)
    return h + 13
def mall():
    w, d, h = 34, 20, 12
    box('Trim', 0, 0, 0.5, w + 1, d + 1, 1); box('Wall', 0, 0, h / 2, w, d, h); box('Roof', 0, 0, h + 0.4, w + 1, d + 1, 0.8)
    for i in range(-3, 4):
        box('Roof', i * 4.8, 0, h + 1.9, 4.6, d * 0.9, 0.5)
        sx = i * 4.8
        for k in range(2): box('Wall', sx - 2.1 + k * 0.1, 0, h + 1.2 + k * 0.2, 0.3, d * 0.9, 1.6 + k * 0.8)
    for face in (0, 1):
        s = -1 if face == 0 else 1
        box('Frame', 0, s * (d / 2 + 0.1), 3.2, w * 0.82, 0.4, 5.2); box('GlassLit', 0, s * (d / 2 + 0.3), 3.2, w * 0.8, 0.1, 4.6)
        for i in range(-6, 7): box('Frame', i * 2.4, s * (d / 2 + 0.36), 3.2, 0.14, 0.1, 4.6)
        for i in range(-5, 6):
            g = glass(); box('Frame', i * 3, s * (d / 2 + 0.1), 8.8, 2.0, 0.3, 2.2); box(g, i * 3, s * (d / 2 + 0.22), 8.8, 1.6, 0.1, 1.8)
    box('Beacon', w / 2 - 1, d / 2 - 1, h + 1.6, 0.8, 0.8, 0.8)
    return h + 3

TYPES = [('stepped', stepped, 22), ('slab', slab, 34), ('apartment', apartment, 24), ('round', round_tower, 22), ('mall', mall, 38)]
os.makedirs(OUT_DIR, exist_ok=True)
xo = 0
for name, fn, spacing in TYPES:
    reset(); before = set(bpy.data.objects); height = fn(); objs = []
    for key, bm in bms.items():
        if not bm.verts: bm.free(); continue
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        me = bpy.data.meshes.new(name + key); bm.to_mesh(me); bm.free()
        ob = bpy.data.objects.new(name + '_' + key, me); ob.data.materials.append(MATS[key]); bpy.context.collection.objects.link(ob); objs.append(ob)
        uvl = me.uv_layers.new(name='UVMap')
        for p in me.polygons:
            n = p.normal.copy(); ax = n.cross(Vector((0, 0, 1))) if abs(n.z) < 0.95 else Vector((1, 0, 0)); ax.normalize(); ay = n.cross(ax).normalized()
            for li in p.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co; uvl.data[li].uv = (co.dot(ax) / 4, co.dot(ay) / 4)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT_DIR, f'sk_{name}.glb'), export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_cameras=False, export_lights=False, export_extras=False, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
    print('EXPORTED', name, os.path.getsize(os.path.join(OUT_DIR, f'sk_{name}.glb')), 'height', height)
    for o in objs: o.location.x += xo
    xo += 44

if PNG:
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 16; sc.cycles.device = 'CPU'
    sc.render.resolution_x = 2000; sc.render.resolution_y = 800; sc.render.filepath = PNG
    sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.35, 0.45, 0.65, 1)
    sun = bpy.data.lights.new('s', 'SUN'); sun.energy = 4; so = bpy.data.objects.new('s', sun); so.rotation_euler = (math.radians(50), 0, math.radians(-30)); bpy.context.collection.objects.link(so)
    gp = bpy.data.objects.new('g', bpy.data.meshes.new('g')); b2 = bmesh.new(); bmesh.ops.create_grid(b2, x_segments=1, y_segments=1, size=200, matrix=Matrix.Translation((88, 0, 0))); b2.to_mesh(gp.data); b2.free()
    gm = bpy.data.materials.new('gm'); gm.use_nodes = True; gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.1, 0.2, 0.1, 1); gp.data.materials.append(gm); bpy.context.collection.objects.link(gp)
    cam = bpy.data.cameras.new('c'); cam.lens = 30; co = bpy.data.objects.new('c', cam); co.location = (88, -150, 38)
    co.rotation_euler = (Vector((88, 0, 14)) - co.location).to_track_quat('-Z', 'Y').to_euler(); bpy.context.collection.objects.link(co); sc.camera = co
    bpy.ops.render.render(write_still=True)
