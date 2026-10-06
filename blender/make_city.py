"""Pokemon-Center-style buildings for the city, one GLB per building type.
Run: Blender --background --python blender/make_city.py -- <models_dir> [preview.png]
Contract: origin at base centre, front faces -Y in Blender (= +Z in glTF), metres.
Footprints = TYPES x S in city/city.js. SignAnchor empty marks where the shop sign hangs.
Material names Roof / Accent are re-tinted per product by city.js; the rest stay as authored."""
import bpy, bmesh, sys, math, random, os
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
OUT_DIR = args[0]
OUT_PNG = args[1] if len(args) > 1 else None
S = 1.5
bpy.ops.wm.read_factory_settings(use_empty=True)

def lin(h):
    h = h.lstrip('#'); return [(int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4)]

def make_mat(name, color, rough=0.75, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(color), 1)
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*lin(emit), 1); b.inputs['Emission Strength'].default_value = strength
    return m

MATS = {
    'Wall': make_mat('Wall', '#f1ece2'), 'WallShade': make_mat('WallShade', '#d8d2c6'),
    'Roof': make_mat('Roof', '#d9382f', 0.55), 'Accent': make_mat('Accent', '#2f6fb8', 0.5),
    'Trim': make_mat('Trim', '#c9c3b6', 0.7), 'Base': make_mat('Base', '#7b7f80', 0.9),
    'Frame': make_mat('Frame', '#2a2f33', 0.5), 'Metal': make_mat('Metal', '#b8c0c4', 0.35, 0.8),
    'Gold': make_mat('Gold', '#e0b040', 0.3, 0.9),
    'GlassLit': make_mat('GlassLit', '#6b4a22', 0.2, 0.0, '#ffc66e', 1.0),
    'GlassCool': make_mat('GlassCool', '#3a5f80', 0.2, 0.0, '#bfe3ff', 0.9),
    'GlassDark': make_mat('GlassDark', '#162330', 0.15),
    'GlassDoor': make_mat('GlassDoor', '#d6eef7', 0.15, 0.0, '#d9f1ff', 1.1),
    'BallRed': make_mat('BallRed', '#e53b32', 0.35), 'BallWhite': make_mat('BallWhite', '#f6f6f2', 0.35),
    'BallBlack': make_mat('BallBlack', '#1a1a1a', 0.5),
}
bms = {}

def reset():
    global bms
    bms = {k: bmesh.new() for k in MATS}

def box(mat, cx, cy, cz, sx, sy, sz, rx=0.0, rz=0.0):
    m = Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(rx, 4, 'X') @ Matrix.Diagonal((sx, sy, sz, 1))
    bmesh.ops.create_cube(bms[mat], size=1.0, matrix=m)

def cyl(mat, cx, cy, cz, r1, r2, h, seg=28, axis='Z'):
    rot = Matrix.Rotation(math.pi / 2, 4, 'X') if axis == 'Y' else Matrix.Identity(4)
    bmesh.ops.create_cone(bms[mat], cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h,
                          matrix=Matrix.Translation((cx, cy, cz)) @ rot)

def frustum(mat, cx, cy, cz, w1, d1, w2, d2, h):
    bm = bms[mat]; v = []
    for w, d, z in ((w1, d1, cz - h / 2), (w2, d2, cz + h / 2)):
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            v.append(bm.verts.new((cx + sx * w / 2, cy + sy * d / 2, z)))
    for f in ((3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in f])

def sphere(mat, cx, cy, cz, r, sy=1.0):
    bmesh.ops.create_uvsphere(bms[mat], u_segments=28, v_segments=16, radius=1.0,
                              matrix=Matrix.Translation((cx, cy, cz)) @ Matrix.Diagonal((r, r * sy, r, 1)))

def ball(cx, cy, cz, r, sy=1.0):
    """Poke Ball: red top, white bottom, black band, front button toward -Y."""
    tmp = bmesh.new()
    bmesh.ops.create_uvsphere(tmp, u_segments=32, v_segments=18, radius=1.0, matrix=Matrix.Diagonal((r, r * sy, r, 1)))
    for f in tmp.faces:
        z = f.calc_center_median().z / r
        mat = 'BallRed' if z > 0.1 else ('BallWhite' if z < -0.1 else 'BallBlack')
        vs = [bms[mat].verts.new(v.co + Vector((cx, cy, cz))) for v in f.verts]
        try: bms[mat].faces.new(vs)
        except ValueError: pass
    tmp.free()
    fy = cy - r * sy
    cyl('BallBlack', cx, fy + 0.02 * r, cz, r * 0.30, r * 0.30, 0.14 * r * sy + 0.05, 24, 'Y')
    cyl('BallWhite', cx, fy - 0.03 * r, cz, r * 0.20, r * 0.20, 0.12 * r * sy + 0.05, 24, 'Y')

def pane(face, u, z, bw, bd, lit, ox=0, oy=0):
    fw, fh, fd = 2.0, 2.4, 0.3
    gm = 'GlassLit' if lit == 0 else ('GlassCool' if lit == 1 else 'GlassDark')
    if face in (0, 1):
        s = -1 if face == 0 else 1; y = oy + s * (bd / 2 + fd / 2 - 0.08)
        box('Frame', ox + u, y, z, fw + 0.2, fd, fh + 0.2); box(gm, ox + u, y + s * 0.12, z, fw - 0.3, 0.1, fh - 0.4)
        box('Trim', ox + u, y + s * 0.1, z - fh / 2 - 0.15, fw + 0.7, 0.4, 0.22)
    else:
        s = -1 if face == 2 else 1; x = ox + s * (bw / 2 + fd / 2 - 0.08)
        box('Frame', x, oy + u, z, fd, fw + 0.2, fh + 0.2); box(gm, x + s * 0.12, oy + u, z, 0.1, fw - 0.3, fh - 0.4)
        box('Trim', x + s * 0.1, oy + u, z - fh / 2 - 0.15, 0.4, fw + 0.7, 0.22)

def windows(bw, bd, z0, z1, step, cols, skip_front_below=0.0, ox=0, oy=0, faces=(0, 1, 2, 3), rng=None):
    rng = rng or random.Random(5); z = z0
    while z < z1:
        for face in faces:
            span = bw if face in (0, 1) else bd
            for i in range(cols):
                u = (i - (cols - 1) / 2) * (span - 3.4) / max(1, cols - 1)
                if face == 0 and z < skip_front_below: continue
                r = rng.random(); pane(face, u, z, bw, bd, 0 if r < 0.62 else (1 if r < 0.75 else 2), ox, oy)
        z += step

def entrance(front_y, width, oy_extra=0.0):
    box('Frame', 0, front_y - 0.1, 2.4, width + 0.7, 0.3, 4.8)
    box('GlassDoor', 0, front_y - 0.26, 2.35, width, 0.1, 4.1)
    for x in (-width / 4, 0, width / 4): box('Frame', x, front_y - 0.34, 2.35, 0.16, 0.12, 4.1)
    box('Frame', 0, front_y - 0.34, 4.3, width, 0.12, 0.16)
    box('Roof', 0, front_y - 1.7, 5.15, width + 1.6, 3.4, 0.4, rx=math.radians(-6))
    box('Accent', 0, front_y - 3.35, 5.0, width + 1.6, 0.3, 0.5)
    for sx in (-1, 1): box('Metal', sx * (width / 2 + 0.5), front_y - 3.0, 2.5, 0.22, 0.22, 5.0)
    box('Base', 0, front_y - 1.4, 0.18, width + 1.4, 2.8, 0.36)

def anchor(name, y, z):
    a = bpy.data.objects.new('SignAnchor', None); a.empty_display_type = 'PLAIN_AXES'; a.location = (0, y, z)
    bpy.context.collection.objects.link(a); return a

# ---------------------------------------------------------------- types
def t_tower():
    W = D = 7.2 * S; H = 17 * S; H1 = H * 0.62; uw, ud = W * 0.74, D * 0.74
    box('Base', 0, 0, 0.675, W + 1.0, D + 1.0, 1.35)
    box('Wall', 0, 0, H1 / 2, W, D, H1); box('Wall', 0, 0, H1 + (H - H1) / 2, uw, ud, H - H1)
    for z in (6.6, 10.4, 13.6): box('Roof', 0, 0, z, W + 0.35, D + 0.35, 0.55)
    box('Trim', 0, 0, H1 + 0.2, W + 0.9, D + 0.9, 0.55)
    frustum('Roof', 0, 0, H + 1.9, uw + 1.6, ud + 1.6, 1.4, 1.4, 3.8)
    ball(0, 0, H + 4.9, 2.1)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box('WallShade', sx * (W / 2 - 0.1), sy * (D / 2 - 0.1), H1 / 2, 0.8, 0.8, H1)
    windows(W, D, 2.8, H1 - 1.4, 3.4, 4, skip_front_below=11.4)
    windows(uw, ud, H1 + 2.0, H - 1.5, 3.3, 3)
    box('Frame', 0, -D / 2 - 0.05, H1 - 2.4, 3.0, 0.3, 3.0); ball(0, -D / 2 - 0.05, H1 - 2.4, 1.15, 0.28)
    entrance(-D / 2, W * 0.78); anchor('a', -(D / 2 + 0.2), 8.3)

def t_hall():
    W, D, H = 9.4 * S, 7.6 * S, 12.2
    box('Base', 0, 0, 0.675, W + 1.0, D + 1.0, 1.35)
    box('Wall', 0, 0, H / 2, W, D, H)
    box('Trim', 0, 0, H + 0.2, W + 0.9, D + 0.9, 0.5)
    frustum('Roof', 0, 0, H + 3.2, W + 2.2, D + 2.2, W * 0.5, 0.5, 5.4)
    box('Roof', 0, -D / 2 - 0.4, H + 1.4, 5.8, 1.4, 0.8)           # front gable base
    frustum('Roof', 0, -D / 2 - 0.3, H + 3.6, 6.4, 2.6, 0.5, 0.5, 4.2)
    ball(0, 0.0, H + 8.0, 2.3)
    for sx in (-1, 1): box('WallShade', sx * (W / 2 - 0.1), -D / 2 + 0.1, H / 2, 0.9, 0.9, H)
    for sx in (-1, 1): box('Wall', sx * (W / 2 + 2.4), 0.8, 4.2, 4.6, D * 0.8, 8.4); frustum('Roof', sx * (W / 2 + 2.4), 0.8, 9.6, 5.8, D * 0.8 + 1.2, 1.2, 1.2, 2.6)
    windows(W, D, 3.0, H - 1.5, 3.5, 4, skip_front_below=11.0, faces=(0, 1))
    windows(W, D, 3.0, H - 1.5, 3.5, 3, faces=(2, 3))
    entrance(-D / 2, W * 0.4); anchor('a', -(D / 2 + 0.2), 8.75)

def t_shop():
    W, D, H = 8.4 * S, 7.2 * S, 11.4
    box('Base', 0, 0, 0.675, W + 1.0, D + 1.0, 1.35)
    box('Wall', 0, 0, H / 2, W, D, H)
    box('Roof', 0, 0, H + 0.3, W + 1.6, D + 1.6, 0.6)
    frustum('Roof', 0, 0, H + 2.2, W + 0.6, D + 0.6, 2.6, 2.6, 3.2)
    ball(0, 0, H + 5.1, 1.7)
    box('Accent', 0, 0, H - 1.1, W + 0.3, D + 0.3, 0.7)
    for sx in (-1, 1): box('WallShade', sx * (W / 2 - 0.1), -D / 2 + 0.1, H / 2, 0.8, 0.8, H)
    box('Wall', W * 0.3, -D * 0.5 - 0.0, 3.0, 2.0, 0.1, 0.1)
    windows(W, D, 3.0, H - 2.4, 3.6, 3, skip_front_below=11.0)
    box('Metal', -W * 0.28, D * 0.15, H + 1.4, 1.8, 1.8, 1.4)
    entrance(-D / 2, W * 0.6); anchor('a', -(D / 2 + 0.2), 8.6)

def t_kiosk():
    W, D, H = 6.4 * S, 5.8 * S, 10.3
    box('Base', 0, 0, 0.675, W + 1.0, D + 1.0, 1.35)
    box('Wall', 0, 0, H / 2, W, D, H)
    box('Accent', 0, 0, H - 0.5, W + 0.3, D + 0.3, 0.6)
    frustum('Roof', 0, 0, H + 1.7, W + 2.0, D + 2.0, 0.8, 0.8, 3.0)
    ball(0, 0, H + 3.9, 1.3)
    windows(W, D, 3.0, H - 3.2, 3.8, 2, skip_front_below=11.0, faces=(1, 2, 3))
    box('Frame', 0, -D / 2 - 0.1, 2.0, W * 0.62 + 0.7, 0.3, 4.0)
    box('GlassDoor', 0, -D / 2 - 0.26, 1.95, W * 0.62, 0.1, 3.4)
    for sx in (-1, 1): box('Metal', sx * (W * 0.31 + 0.6), -D / 2 - 2.0, 2.3, 0.22, 0.22, 4.6)
    box('Roof', 0, -D / 2 - 1.4, 4.7, W * 0.62 + 1.6, 2.8, 0.36, rx=math.radians(-8))
    box('Base', 0, -D / 2 - 1.0, 0.18, W * 0.62 + 1.2, 2.0, 0.36)
    anchor('a', -(D / 2 + 0.2), 8.0)

def t_vault():
    W, D, H = 8.8 * S, 8.2 * S, 13.2
    box('Base', 0, 0, 0.675, W + 1.2, D + 1.2, 1.35)
    box('Wall', 0, 0, H / 2, W, D, H)
    box('Gold', 0, 0, H - 1.6, W + 0.6, D + 0.6, 0.5)
    box('Trim', 0, 0, H + 0.3, W + 1.0, D + 1.0, 0.6)
    box('Roof', 0, 0, H + 0.9, W * 0.8, D * 0.8, 0.8)
    ball(0, 0, H + 4.6, 4.6)
    for sx in (-1, 1):
        box('Wall', sx * (W / 2 + 2.6), 0, 4.6, 5.2, D * 0.85, 9.2); frustum('Roof', sx * (W / 2 + 2.6), 0, 10.3, 6.2, D * 0.85 + 1.2, 1.2, 1.2, 2.4)
        cyl('Trim', sx * (W / 2 - 0.5), -D / 2 - 1.2, 3.8, 0.55, 0.62, 7.6, 18)
    windows(W, D, 3.0, H - 3.0, 3.8, 4, skip_front_below=11.6, faces=(0, 1))
    windows(W, D, 3.0, H - 3.0, 3.8, 3, faces=(2, 3))
    entrance(-D / 2, W * 0.45); anchor('a', -(D / 2 + 0.2), 8.6)

def t_dome():
    R = 4.1 * S; H = 9.5 * S * 0.78; fz = 8.6 * S / 2
    cyl('Base', 0, 0, 0.675, R + 0.7, R + 0.7, 1.35, 36)
    cyl('Wall', 0, 0, H / 2, R, R, H, 36)
    cyl('Accent', 0, 0, H - 0.5, R + 0.15, R + 0.15, 0.7, 36)
    cyl('Roof', 0, 0, H + 2.4, R + 1.0, 0.7, 4.6, 36)
    ball(0, 0, H + 6.3, 1.5)
    rng = random.Random(3)
    for k in range(12):
        a = math.radians(30 * k + 15)
        if math.sin(a) < -0.35 and abs(math.cos(a)) < 0.62: continue
        x, y = math.cos(a) * (R + 0.1), -math.sin(a) * (R + 0.1)
        for z in (4.0, 7.6):
            lit = rng.random()
            gm = 'GlassLit' if lit < 0.62 else ('GlassCool' if lit < 0.75 else 'GlassDark')
            box('Frame', x, y, z, 0.3, 2.0, 2.4, rz=a); box(gm, x * 1.01, y * 1.01, z, 0.12, 1.6, 2.0, rz=a)
    aw, ad, ah = 9.0, 3.4, 10.4
    box('Wall', 0, -R - 0.6 + ad / 2 - 0.4, ah / 2, aw, ad, ah)
    box('Roof', 0, -R - 0.6 + ad / 2 - 0.4, ah + 0.3, aw + 1.0, ad + 1.0, 0.6)
    ball(0, -R - 0.6 + ad / 2 - 0.4, ah + 1.9, 1.3)
    entrance(-fz, aw * 0.62); anchor('a', -(fz + 0.2), 8.075)

TYPES = [('tower', t_tower), ('hall', t_hall), ('shop', t_shop), ('kiosk', t_kiosk), ('vault', t_vault), ('dome', t_dome)]

def finish(name, ox):
    objs = []
    for key, bm in bms.items():
        if not bm.verts: bm.free(); continue
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        me = bpy.data.meshes.new(name + '_' + key); bm.to_mesh(me); bm.free()
        ob = bpy.data.objects.new(name + '_' + key, me); ob.data.materials.append(MATS[key])
        for p in me.polygons: p.use_smooth = False
        bpy.context.collection.objects.link(ob); objs.append(ob)
    return objs

os.makedirs(OUT_DIR, exist_ok=True)
x_off = 0
for name, fn in TYPES:
    reset(); before = set(bpy.data.objects)
    fn()
    objs = finish(name, x_off)
    objs += [o for o in bpy.data.objects if o not in before and o.type == 'EMPTY']
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT_DIR, name + '.glb'), export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True, export_cameras=False, export_lights=False, export_extras=False)
    for o in objs: o.location.x += x_off
    x_off += 24
    print('EXPORTED', name, os.path.getsize(os.path.join(OUT_DIR, name + '.glb')))

if OUT_PNG:
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 20; sc.cycles.device = 'CPU'
    sc.render.resolution_x = 2000; sc.render.resolution_y = 760; sc.render.filepath = OUT_PNG
    sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True
    sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.35, 0.45, 0.65, 1)
    sc.world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    gp = bpy.data.objects.new('ground', bpy.data.meshes.new('g')); bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=140, matrix=Matrix.Translation((60, 0, 0))); bm.to_mesh(gp.data); bm.free()
    gm = bpy.data.materials.new('gm'); gm.use_nodes = True; gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.1, 0.22, 0.1, 1)
    gp.data.materials.append(gm); bpy.context.collection.objects.link(gp)
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 4.5; sun.color = (1.0, 0.85, 0.7)
    so = bpy.data.objects.new('sun', sun); so.rotation_euler = (math.radians(50), 0, math.radians(-30)); bpy.context.collection.objects.link(so)
    cam = bpy.data.cameras.new('cam'); cam.lens = 38
    co = bpy.data.objects.new('cam', cam); co.location = (60, -95, 26)
    co.rotation_euler = (Vector((60, 0, 7)) - co.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.collection.objects.link(co); sc.camera = co
    bpy.ops.render.render(write_still=True)
print('DONE')
