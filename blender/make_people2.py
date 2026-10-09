"""Six rigged, stylised pedestrians (v2) with Walk / Idle / Wave / Browse clips -> city/models/person_v0..5.glb + people.json
Run: Blender --background --python blender/make_people2.py -- <out_dir> [preview.png]
Materials Skin / Shirt / Pants / Hair / Shoe / Accent are re-tinted per person by city.js; Eye / Pupil / Lip are fixed colours.
Front faces -Y in Blender (= +Z in glTF). All variants share one skeleton so every clip works on every body."""
import bpy, bmesh, sys, math, json, os
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]; PNG = args[1] if len(args) > 1 else None
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

def lin(h):
    h = h.lstrip('#'); return [(int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4)]
def mat(name, col, rough=0.7):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(col), 1); b.inputs['Roughness'].default_value = rough; return m
MATS = {n: mat(n, c, r) for n, c, r in [('Skin', '#e0b090', .6), ('Shirt', '#4a7fd9', .75), ('Pants', '#2b3445', .8), ('Hair', '#3b2616', .8), ('Shoe', '#d94a4a', .5),
                                         ('Accent', '#e8b84a', .6), ('Eye', '#f4f4f0', .4), ('Pupil', '#15151a', .3), ('Lip', '#b5675a', .6)]}

def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def sstep(t): t = clamp(t); return t * t * (3 - 2 * t)

# ------------------------------------------------------------------ geometry helpers (all operate on a bmesh)
def sph(bm, c, r, seg=10, rings=7):
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0, matrix=Matrix.Translation(c) @ Matrix.Diagonal((r[0], r[1], r[2], 1)))
def box(bm, c, s, rot=None):
    m = Matrix.Translation(c) @ (rot.to_4x4() if rot else Matrix.Identity(4)) @ Matrix.Diagonal((s[0], s[1], s[2], 1))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)
def tube(bm, rings, seg=10, caps=(False, False)):
    loops = []
    for (cx, cy, cz, rx, ry) in rings:
        loops.append([bm.verts.new((cx + rx * math.cos(2 * math.pi * i / seg), cy + ry * math.sin(2 * math.pi * i / seg), cz)) for i in range(seg)])
    for a, b in zip(loops, loops[1:]):
        for i in range(seg): j = (i + 1) % seg; bm.faces.new((a[i], a[j], b[j], b[i]))
    if caps[0]: bm.faces.new(loops[0])
    if caps[1]: bm.faces.new(list(reversed(loops[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
def between(bm, p0, p1, r, seg=6):
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0; q = d.to_track_quat('Z', 'Y')
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length, matrix=Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4())
def torus(bm, c, R, r, seg=14, tseg=5):
    vs = []
    for i in range(seg):
        a = 2 * math.pi * i / seg; row = []
        for j in range(tseg):
            b = 2 * math.pi * j / tseg
            row.append(bm.verts.new((c[0] + (R + r * math.cos(b)) * math.cos(a), c[1] + r * math.sin(b), c[2] + (R + r * math.cos(b)) * math.sin(a))))
        vs.append(row)
    for i in range(seg):
        for j in range(tseg): bm.faces.new((vs[i][j], vs[(i + 1) % seg][j], vs[(i + 1) % seg][(j + 1) % tseg], vs[i][(j + 1) % tseg]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
def cut(bm, fn):
    for v in [v for v in bm.verts if fn(v.co)]: bm.verts.remove(v)

# ------------------------------------------------------------------ skeleton (identical for every variant)
def make_rig(tag):
    ad = bpy.data.armatures.new('Rig' + tag); arm = bpy.data.objects.new('Rig' + tag, ad)
    bpy.context.collection.objects.link(arm); bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='EDIT')
    def bone(name, head, parent=None):
        b = ad.edit_bones.new(name); b.head = head; b.tail = (head[0], head[1], head[2] + 0.12)
        if parent: b.parent = ad.edit_bones[parent]
    bone('Hips', (0, 0, 0.95)); bone('Spine', (0, 0, 1.0), 'Hips'); bone('Head', (0, 0, 1.4), 'Spine')
    for s, x in (('L', 0.27), ('R', -0.27)):
        bone('UpperArm' + s, (x, 0, 1.34), 'Spine'); bone('LowerArm' + s, (x, 0, 1.04), 'UpperArm' + s)
    for s, x in (('L', 0.11), ('R', -0.11)):
        bone('UpperLeg' + s, (x, 0, 0.92), 'Hips'); bone('LowerLeg' + s, (x, 0, 0.5), 'UpperLeg' + s)
    bpy.ops.object.mode_set(mode='OBJECT'); return arm

# weight functions: position -> {bone: weight}
def fixed(b): return lambda co: {b: 1.0}
def blend(a, b, z0, z1):  # `a` above z0, `b` below z1
    return lambda co: (lambda t: {a: 1 - t, b: t})(sstep((z0 - co.z) / (z0 - z1)))
SPINE_HIPS = blend('Spine', 'Hips', 1.06, 0.92)
NECK = blend('Head', 'Spine', 1.50, 1.38)
def ARM(s): return blend('UpperArm' + s, 'LowerArm' + s, 1.11, 0.97)
def LEG(s): return blend('UpperLeg' + s, 'LowerLeg' + s, 0.57, 0.43)

def sleeve_rings(x, ez, B):
    r = [(x, 0, 1.4, .066 * B, .066 * B), (x, 0, 1.3, .072 * B, .072 * B)]
    return r + ([(x, 0, ez, .068 * B, .068 * B)] if ez >= 1.0 else [(x, 0, 1.05, .064 * B, .064 * B), (x, 0, ez, .06 * B, .06 * B)])

# ------------------------------------------------------------------ one variant
HARD = ('mouth', 'brows', 'pack', 'straps', 'pocket', 'zip', 'sole', 'glasses', 'bag', 'strap', 'scarfT', 'skirt', 'belt', 'buckle', 'lace', 'logo', 'draw', 'lash', 'fing')
def build_mesh(i, sp, arm, HI):
    parts = []; tag = str(i) + ('h' if HI else 'l')
    def hip(*a, **k):
        if HI: part(*a, **k)
    def part(name, matname, wfn, builder, smooth=True):
        bm = bmesh.new(); builder(bm); me = bpy.data.meshes.new(name + tag); bm.to_mesh(me); bm.free(); me.validate()
        ob = bpy.data.objects.new(name + tag, me); ob.data.materials.append(MATS[matname]); bpy.context.collection.objects.link(ob)
        groups = {}
        for v in me.vertices:
            for b, w in wfn(v.co).items():
                if w < 0.001: continue
                if b not in groups: groups[b] = ob.vertex_groups.new(name=b)
                groups[b].add([v.index], w, 'REPLACE')
        for p in me.polygons: p.use_smooth = smooth
        parts.append((ob, not name.startswith(HARD)))
    B = sp.get('bulk', 1.0); HS = sp.get('head', 1.0)
    # torso (shirt) + pelvis + neck
    part('torso', 'Shirt', SPINE_HIPS, lambda bm: tube(bm, [(0, 0, 0.9, .185 * B, .115 * B), (0, 0, 0.98, .175 * B, .113 * B), (0, 0, 1.12, .185 * B, .12 * B), (0, 0, 1.26, .225 * B, .135 * B), (0, 0, 1.37, .235 * B, .125 * B), (0, 0, 1.43, .09, .08)], 12, (True, True)))
    if sp['bottom'] != 'skirt':
        part('pelvis', 'Pants', SPINE_HIPS, lambda bm: tube(bm, [(0, 0, 0.74, .17 * B, .115 * B), (0, 0, 0.86, .185 * B, .12 * B), (0, 0, 0.96, .182 * B, .118 * B)], 12, (True, True)))
    part('neck', 'Skin', NECK, lambda bm: tube(bm, [(0, 0, 1.36, .052, .052), (0, 0, 1.52, .048, .048)], 8))
    # head + face
    hc = (0, 0, 1.6)
    part('head', 'Skin', fixed('Head'), lambda bm: sph(bm, hc, (.15 * HS, .165 * HS, .185 * HS), 14, 10))
    part('ears', 'Skin', fixed('Head'), lambda bm: [sph(bm, (sx * .146 * HS, 0.0, 1.595), (.022, .014, .036), 6, 5) for sx in (-1, 1)])
    part('nose', 'Skin', fixed('Head'), lambda bm: sph(bm, (0, -.163 * HS, 1.585), (.02, .026, .022), 6, 5))
    part('eyes', 'Eye', fixed('Head'), lambda bm: [sph(bm, (sx * .06 * HS, -.147 * HS, 1.625), (.03, .014, .031), 8, 6) for sx in (-1, 1)])
    part('pupils', 'Pupil', fixed('Head'), lambda bm: [sph(bm, (sx * .06 * HS, -.158 * HS, 1.625), (.016, .008, .018), 6, 5) for sx in (-1, 1)])
    part('mouth', 'Lip', fixed('Head'), lambda bm: [box(bm, (sx * .017 * HS, -.157 * HS, 1.54 + 0.002), (.026, .012, .011), Matrix.Rotation(-sx * 0.4, 3, 'Y')) for sx in (-1, 1)])
    part('brows', 'Hair', fixed('Head'), lambda bm: [box(bm, (sx * .06 * HS, -.15 * HS, 1.672), (.05, .012, .012), Matrix.Rotation(sx * 0.07, 3, 'Y')) for sx in (-1, 1)])
    # hair / hat
    def cap(bm, rx, ry, rz, cz, zmin, hair_z, back=0.0):
        sph(bm, (0, back, cz), (rx, ry, rz), 14, 9); cut(bm, lambda c: c.z < zmin or (c.y < -.075 * HS and c.z < hair_z))
    h = sp['hair']
    if h in ('short', 'cap', 'pony', 'bun', 'long'):
        part('hair', 'Hair', fixed('Head'), lambda bm: cap(bm, .158 * HS, .172 * HS, .192 * HS, 1.606, 1.55, 1.7, .006))
    if h == 'long':
        part('hairL', 'Hair', fixed('Head'), lambda bm: (sph(bm, (0, .115, 1.44), (.17, .075, .29), 10, 8), [sph(bm, (sx * .148, -.02, 1.52), (.036, .06, .19), 6, 6) for sx in (-1, 1)]))
    if h == 'pony':
        part('hairP', 'Hair', fixed('Head'), lambda bm: (sph(bm, (0, .2, 1.52), (.05, .05, .15), 8, 7), sph(bm, (0, .165, 1.64), (.035, .035, .035), 6, 5)))
    if h == 'bun':
        part('hairB', 'Hair', fixed('Head'), lambda bm: sph(bm, (0, .06, 1.82), (.075, .075, .07), 8, 7))
    if h == 'afro':
        part('hair', 'Hair', fixed('Head'), lambda bm: (sph(bm, (0, .02, 1.7), (.2, .2, .17), 12, 8), [sph(bm, (.175 * math.cos(a), .02 + .17 * math.sin(a), 1.7 + .05 * math.sin(a * 3)), (.085, .085, .085), 7, 5) for a in [k * math.pi / 4 for k in range(8)] if math.sin(a) > -.5], sph(bm, (0, .02, 1.82), (.12, .12, .08), 8, 6), cut(bm, lambda c: c.z < 1.6 or (c.y < -.1 and c.z < 1.72))))
    if h == 'cap':
        part('hat', 'Accent', fixed('Head'), lambda bm: (sph(bm, (0, .006, 1.64), (.178, .192, .16), 12, 8), cut(bm, lambda c: c.z < 1.622), sph(bm, (0, -.2, 1.652), (.115, .14, .012), 10, 4)))
    # arms
    for s, x in (('L', 0.27), ('R', -0.27)):
        sl = sp['sleeve']
        if sl != 'none':
            ez = 1.2 if sl == 'short' else 0.8
            part('sleeve' + s, 'Shirt', ARM(s), lambda bm, x=x, ez=ez: tube(bm, sleeve_rings(x, ez, B), 9))
            part('shoulder' + s, 'Shirt', fixed('UpperArm' + s), lambda bm, x=x: sph(bm, (x * 0.93, 0, 1.36), (.078 * B, .074 * B, .08 * B), 8, 6))
        sk0 = 1.22 if sl == 'short' else (0.8 if sl == 'long' else 1.4)
        part('skinarm' + s, 'Skin', ARM(s), lambda bm, x=x, sk0=sk0: tube(bm, [(x, 0, sk0 + .02, .056 * B, .056 * B), (x, 0, 1.04, .05 * B, .05 * B), (x, 0, .76, .04 * B, .04 * B)], 8))
        part('hand' + s, 'Skin', fixed('LowerArm' + s), lambda bm, x=x: (sph(bm, (x, 0, .7), (.046, .034, .062), 8, 6), sph(bm, (x + (.04 if s == 'L' else -.04), -.012, .72), (.016, .016, .036), 5, 4)))
        if sl == 'long':
            part('cuff' + s, 'Accent', fixed('LowerArm' + s), lambda bm, x=x: tube(bm, [(x, 0, .8, .052 * B, .052 * B), (x, 0, .75, .05 * B, .05 * B)], 8))
    # legs
    for s, x in (('L', 0.11), ('R', -0.11)):
        if sp['bottom'] == 'pants':
            part('leg' + s, 'Pants', LEG(s), lambda bm, x=x: tube(bm, [(x, 0, .94, .105 * B, .105 * B), (x, 0, .72, .098 * B, .098 * B), (x, 0, .5, .082 * B, .085 * B), (x, 0, .22, .068 * B, .07 * B), (x, 0, .1, .07 * B, .072 * B)], 9))
        else:
            zt = 0.6 if sp['bottom'] == 'shorts' else 0.95
            if sp['bottom'] == 'shorts':
                part('short' + s, 'Pants', LEG(s), lambda bm, x=x: tube(bm, [(x, 0, .94, .108 * B, .108 * B), (x, 0, .78, .104 * B, .104 * B), (x, 0, zt, .1 * B, .1 * B)], 9))
            part('skin' + s, 'Skin', LEG(s), lambda bm, x=x, zt=zt: tube(bm, [(x, 0, zt + .02 if sp['bottom'] == 'shorts' else .94, .088 * B, .088 * B), (x, 0, .5, .074 * B, .076 * B), (x, 0, .22, .056 * B, .058 * B), (x, 0, .1, .052 * B, .054 * B)], 9))
        part('shoe' + s, 'Shoe', fixed('LowerLeg' + s), lambda bm, x=x: sph(bm, (x, -.05, .075), (.066, .14, .06), 9, 6))
        part('sole' + s, 'Eye', fixed('LowerLeg' + s), lambda bm, x=x: box(bm, (x, -.045, .014), (.125, .29, .028)))
    # skirt / dress
    if sp['bottom'] == 'skirt':
        def skirtW(co):
            t = clamp((0.92 - co.z) / 0.36) * 0.8; b = 'UpperLegL' if co.x > 0 else 'UpperLegR'; return {'Hips': 1 - t, b: t}
        part('skirt', 'Pants' if sp['top'] != 'dress' else 'Shirt', skirtW, lambda bm: tube(bm, [(0, 0, .98, .185 * B, .122 * B), (0, 0, .86, .215 * B, .15 * B), (0, 0, .66, .29 * B, .21 * B), (0, 0, .56, .31 * B, .225 * B)], 14))
    # top details
    t = sp['top']
    if t == 'hoodie':
        part('hood', 'Shirt', SPINE_HIPS, lambda bm: sph(bm, (0, .095, 1.42), (.13, .07, .09), 9, 6))
        part('pocket', 'Accent', SPINE_HIPS, lambda bm: box(bm, (0, -.121 * B, 1.02), (.2 * B, .012, .08)))
    if t == 'jacket':
        part('zip', 'Accent', SPINE_HIPS, lambda bm: box(bm, (0, -.131 * B, 1.17), (.016, .012, .46)))
        part('collar', 'Accent', NECK, lambda bm: tube(bm, [(0, 0, 1.4, .105, .095), (0, 0, 1.455, .095, .088)], 10, (False, False)))
        part('hem', 'Accent', SPINE_HIPS, lambda bm: tube(bm, [(0, 0, .9, .19 * B, .12 * B), (0, 0, .95, .182 * B, .118 * B)], 12, (False, False)))
    # accessories
    for a in sp.get('acc', []):
        if a == 'backpack':
            part('pack', 'Accent', fixed('Spine'), lambda bm: (box(bm, (0, .19 * B, 1.2), (.3, .16, .36)), box(bm, (0, .275 * B, 1.12), (.22, .03, .16))))
            part('straps', 'Accent', fixed('Spine'), lambda bm: [box(bm, (sx * .095, -.012 * B, 1.24), (.04, .27 * B + .02, .03)) for sx in (-1, 1)] + [box(bm, (sx * .095, -.125 * B, 1.2), (.04, .014, .28)) for sx in (-1, 1)])
        if a == 'glasses':
            part('glasses', 'Pupil', fixed('Head'), lambda bm: ([torus(bm, (sx * .06 * HS, -.166 * HS, 1.625), .036, .005) for sx in (-1, 1)], box(bm, (0, -.168 * HS, 1.632), (.034, .008, .008)), [box(bm, (sx * .1 * HS, -.09 * HS, 1.63), (.006, .15, .008), Matrix.Rotation(sx * .5, 3, 'Z')) for sx in (-1, 1)]))
        if a == 'scarf':
            part('scarf', 'Accent', NECK, lambda bm: tube(bm, [(0, 0, 1.36, .115, .1), (0, 0, 1.44, .105, .095)], 10, (False, False)))
            part('scarfT', 'Accent', fixed('Spine'), lambda bm: box(bm, (.05, -.128, 1.26), (.075, .02, .24)))
        if a == 'bag':
            part('bag', 'Accent', fixed('Hips'), lambda bm: box(bm, (-.3 * B, .02, .93), (.07, .2, .17)))
            part('strap', 'Accent', fixed('Spine'), lambda bm: between(bm, (.19 * B, -.147, 1.37), (-.26 * B, -.142, 1.0), .014))
    if HI:  # extra detail only the close-up mesh carries
        for sd, x in (('L', 0.27), ('R', -0.27)):
            for k, off in enumerate((-.024, -.008, .008, .024)):
                hip('fing' + sd + str(k), 'Skin', fixed('LowerArm' + sd), lambda bm, x=x, off=off: tube(bm, [(x + off, -.004, .685, .0105, .0105), (x + off, -.011, .625, .0092, .0092), (x + off, -.014, .575, .0075, .0075)], 6))
        for sd, x in (('L', 0.11), ('R', -0.11)):
            hip('lace' + sd, 'Eye', fixed('LowerLeg' + sd), lambda bm, x=x: [box(bm, (x, -.085 + dy, .127), (.07, .012, .008)) for dy in (0, .028, .056)])
        if sp['bottom'] != 'skirt' and sp['top'] != 'dress':
            hip('belt', 'Accent', SPINE_HIPS, lambda bm: tube(bm, [(0, 0, .945, .19 * B, .125 * B), (0, 0, .985, .19 * B, .125 * B)], 12, (False, False)))
            hip('buckle', 'Eye', SPINE_HIPS, lambda bm: box(bm, (0, -.127 * B, .965), (.045, .012, .032)))
        hip('lash', 'Pupil', fixed('Head'), lambda bm: [box(bm, (sx * .06 * HS, -.152 * HS, 1.654), (.042, .006, .006)) for sx in (-1, 1)])
        if sp['top'] == 'hoodie':
            hip('draw', 'Eye', SPINE_HIPS, lambda bm: [between(bm, (sx * .03, -.116, 1.4), (sx * .034, -.12, 1.24), .006) for sx in (-1, 1)])
        if sp['top'] == 'tee':
            hip('logo', 'Accent', SPINE_HIPS, lambda bm: sph(bm, (-.075 * B, -.131 * B, 1.28), (.04, .008, .04), 8, 5))
    soft = [o for o, sf in parts if sf]; hard = [o for o, sf in parts if not sf]
    def join(objs):
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs: o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]; bpy.ops.object.join(); return bpy.context.view_layer.objects.active
    if HI:
        sm = join(soft); m = sm.modifiers.new('Sub', 'SUBSURF'); m.levels = 1; m.render_levels = 1; m.boundary_smooth = 'PRESERVE_CORNERS'
        bpy.context.view_layer.objects.active = sm; bpy.ops.object.modifier_apply(modifier='Sub')
        body = join([sm] + hard)
    else:
        body = join([o for o, _ in parts])
    body.name = 'PersonHi' if HI else 'PersonLo'
    mod = body.modifiers.new('Armature', 'ARMATURE'); mod.object = arm; body.parent = arm
    return body
def build(i, sp):
    arm = make_rig(str(i)); lo = build_mesh(i, sp, arm, False); hi = build_mesh(i, sp, arm, True)
    return arm, lo, hi

# ------------------------------------------------------------------ animation
def animate(arm):
    bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='POSE')
    PB = arm.pose.bones
    for pb in PB: pb.rotation_mode = 'XYZ'
    arm.animation_data_create()
    def clip(name, frames, fn, step=2):
        act = bpy.data.actions.new(name); arm.animation_data.action = act
        for f in range(0, frames + 1, step):
            t = (f / frames) * 2 * math.pi
            for pb in PB: pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0)
            fn(t)
            for pb in PB: pb.keyframe_insert('rotation_euler', frame=f + 1)
            PB['Hips'].keyframe_insert('location', frame=f + 1)
        act.use_fake_user = True; return act
    def walk(t):
        s = math.sin(t)
        for side, ph in (('L', 0.0), ('R', math.pi)):
            sp = math.sin(t + ph); cs = math.cos(t + ph)
            PB['UpperLeg' + side].rotation_euler.x = -sp * 0.66
            PB['LowerLeg' + side].rotation_euler.x = max(0.0, math.sin(t + ph + 1.7)) * 1.05 + 0.06
            PB['UpperArm' + side].rotation_euler.x = sp * 0.55
            PB['LowerArm' + side].rotation_euler.x = -0.4 - max(0.0, -sp) * 0.45
        PB['Spine'].rotation_euler.z = s * 0.1; PB['Spine'].rotation_euler.x = 0.05
        PB['Head'].rotation_euler.z = -s * 0.07; PB['Hips'].rotation_euler.z = -s * 0.07; PB['Hips'].rotation_euler.y = math.cos(t) * 0.03
        PB['Hips'].location.z = -abs(math.sin(t)) * 0.035 + 0.012
    def idle(t):
        s = math.sin(t); s2 = math.sin(t * 2)
        PB['Spine'].rotation_euler.x = s2 * 0.012; PB['Hips'].rotation_euler.z = s * 0.025; PB['Hips'].location.x = s * 0.01
        PB['Head'].rotation_euler.z = math.sin(t) * 0.35; PB['Head'].rotation_euler.x = math.sin(t * 2 + 1) * 0.06
        PB['UpperLegL'].rotation_euler.x = 0.02 + s * 0.02; PB['UpperLegR'].rotation_euler.x = -0.02 - s * 0.02
        for side, k in (('L', 1), ('R', -1)):
            PB['UpperArm' + side].rotation_euler.x = s2 * 0.03; PB['UpperArm' + side].rotation_euler.y = k * (0.06 + 0.02 * s2)
            PB['LowerArm' + side].rotation_euler.x = -0.16 + s2 * 0.03
    def wave(t):
        s = math.sin(t * 3)
        PB['UpperArmR'].rotation_euler.y = 2.45 + 0.05 * math.sin(t); PB['UpperArmR'].rotation_euler.x = -0.15
        PB['LowerArmR'].rotation_euler.y = 0.15 + s * 0.45; PB['LowerArmR'].rotation_euler.x = -0.3
        PB['Head'].rotation_euler.z = -0.15 + math.sin(t) * 0.1; PB['Spine'].rotation_euler.z = 0.05
        PB['UpperArmL'].rotation_euler.y = 0.07; PB['LowerArmL'].rotation_euler.x = -0.16; PB['Hips'].rotation_euler.z = math.sin(t) * 0.02
    def browse(t):
        s = math.sin(t)
        PB['Spine'].rotation_euler.x = 0.1 + s * 0.015; PB['Head'].rotation_euler.x = 0.25 + math.sin(t * 2) * 0.1; PB['Head'].rotation_euler.z = math.sin(t) * 0.45
        PB['UpperArmR'].rotation_euler.x = -1.15; PB['LowerArmR'].rotation_euler.x = -1.5; PB['UpperArmR'].rotation_euler.y = -0.1
        PB['UpperArmL'].rotation_euler.x = s * 0.05; PB['UpperArmL'].rotation_euler.y = 0.08; PB['LowerArmL'].rotation_euler.x = -0.2
        PB['Hips'].rotation_euler.z = s * 0.02; PB['Hips'].location.x = s * 0.008
    acts = [clip('Walk', 24, walk), clip('Idle', 96, idle), clip('Wave', 48, wave), clip('Browse', 96, browse)]
    arm.animation_data.action = acts[0]
    bpy.ops.object.mode_set(mode='OBJECT'); return acts

def static_pose(arm, t=0.7):  # pose for the preview render
    bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='POSE'); PB = arm.pose.bones
    arm.animation_data_clear()
    for pb in PB: pb.rotation_mode = 'XYZ'; pb.rotation_euler = (0, 0, 0)
    for side, ph in (('L', 0.0), ('R', math.pi)):
        sp = math.sin(t + ph)
        PB['UpperLeg' + side].rotation_euler.x = -sp * 0.66; PB['LowerLeg' + side].rotation_euler.x = max(0.0, math.sin(t + ph + 1.7)) * 1.05 + 0.06
        PB['UpperArm' + side].rotation_euler.x = sp * 0.55; PB['LowerArm' + side].rotation_euler.x = -0.4 - max(0.0, -sp) * 0.45
    bpy.ops.object.mode_set(mode='OBJECT')

# ------------------------------------------------------------------ the six bodies
VARIANTS = [
    dict(hair='short', top='hoodie', bottom='pants', sleeve='long', acc=['backpack'], bulk=1.0, head=1.0, scale=1.0),
    dict(hair='long', top='dress', bottom='skirt', sleeve='short', acc=['scarf'], bulk=0.92, head=1.0, scale=0.97),
    dict(hair='cap', top='tee', bottom='shorts', sleeve='short', acc=['glasses'], bulk=1.05, head=1.0, scale=1.04),
    dict(hair='pony', top='jacket', bottom='pants', sleeve='long', acc=['bag'], bulk=0.93, head=1.0, scale=0.99),
    dict(hair='afro', top='tee', bottom='shorts', sleeve='short', acc=['backpack'], bulk=0.9, head=1.22, scale=0.76),
    dict(hair='bun', top='jacket', bottom='pants', sleeve='long', acc=['glasses'], bulk=1.14, head=1.0, scale=1.06),
]
built = []
for i, sp in enumerate(VARIANTS):
    arm, lo, hi = build(i, sp); animate(arm)
    bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); lo.select_set(True); hi.select_set(True); bpy.context.view_layer.objects.active = arm
    f = os.path.join(OUT, f'person_v{i}.glb')
    bpy.ops.export_scene.gltf(filepath=f, export_format='GLB', use_selection=True, export_apply=False, export_yup=True,
                              export_animations=True, export_animation_mode='ACTIONS', export_skins=True, export_cameras=False, export_lights=False, export_extras=False,
                              export_draco_mesh_compression_enable=True, export_draco_position_quantization=14, export_draco_normal_quantization=10)
    print('EXPORTED', f, 'tris lo', sum(len(p.vertices) - 2 for p in lo.data.polygons), 'hi', sum(len(p.vertices) - 2 for p in hi.data.polygons), 'bytes', os.path.getsize(f))
    for a in list(bpy.data.actions): bpy.data.actions.remove(a)
    static_pose(arm); lo.hide_render = True; lo.hide_viewport = True; arm.location.x = (i - 2.5) * 0.95; built.append(arm)
json.dump({'variants': [{'file': f'person_v{i}.glb', 'scale': sp['scale']} for i, sp in enumerate(VARIANTS)]}, open(os.path.join(OUT, 'people.json'), 'w'))

if PNG:
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 24; sc.cycles.device = 'CPU'; sc.render.resolution_x = 1500; sc.render.resolution_y = 520; sc.render.filepath = PNG
    sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.62, 0.7, 0.8, 1)
    sun = bpy.data.lights.new('s', 'SUN'); sun.energy = 4.2; so = bpy.data.objects.new('s', sun); so.rotation_euler = (math.radians(55), 0, math.radians(-25)); bpy.context.collection.objects.link(so)
    gr = bpy.data.objects.new('g', bpy.data.meshes.new('g')); bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=2, y_segments=2, size=8); bm.to_mesh(gr.data); bm.free(); bpy.context.collection.objects.link(gr)
    gm = mat('ground', '#7a8f6a', .9); gr.data.materials.append(gm)
    cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; cam.ortho_scale = 5.8; co = bpy.data.objects.new('c', cam); co.location = (0, -8, 0.88); co.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.collection.objects.link(co); sc.camera = co
    bpy.ops.render.render(write_still=True)
