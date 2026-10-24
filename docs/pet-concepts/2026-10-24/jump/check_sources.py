"""Reopen native sources: unchanged models, fixed camera, lift and neutral return."""
import bpy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def geometry():
    def value(socket):
        raw = socket.default_value
        return raw if isinstance(raw, (float, int, bool, str)) else list(raw)
    payload = [(m.name, [[round(v, 6) for v in vertex.co] for vertex in m.vertices],
                [list(p.vertices) for p in m.polygons],
                [(key.name, [list(point.co) for point in key.data]) for key in m.shape_keys.key_blocks] if m.shape_keys else [])
               for m in bpy.data.meshes]
    payload += [(curve.name, [(s.type, [list(p.co) for p in s.points],
                              [(list(p.co), list(p.handle_left), list(p.handle_right)) for p in s.bezier_points])
                             for s in curve.splines]) for curve in bpy.data.curves]
    payload += [(m.name, list(m.diffuse_color), m.use_nodes,
                 [(node.name, node.type, [(socket.identifier, value(socket)) for socket in [*node.inputs, *node.outputs]
                                          if hasattr(socket, "default_value")]) for node in m.node_tree.nodes],
                 [(link.from_node.name, link.from_socket.identifier, link.to_node.name, link.to_socket.identifier)
                  for link in m.node_tree.links]) for m in bpy.data.materials if m.node_tree]
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def check():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf8"))
    for char in manifest["characters"]:
        old_source = next(path for path in char["inputSha256"] if path.endswith(".blend"))
        bpy.ops.wm.open_mainfile(filepath=str(ROOT / old_source))
        original_geometry = geometry()
        bpy.context.scene.frame_set(1)
        bpy.context.view_layer.update()
        def world_pose():
            return {obj.name: [round(v, 6) for row in obj.matrix_world for v in row]
                    for obj in bpy.context.scene.objects if obj.type in {"MESH", "CURVE"}}
        original_pose = world_pose()
        bpy.ops.wm.open_mainfile(filepath=str(ROOT / char["source"]))
        scene = bpy.context.scene
        assert geometry() == original_geometry, "original mesh/material changed"
        assert scene.render.fps == 10 and scene.render.film_transparent
        assert scene.render.resolution_x == scene.render.resolution_y == 120
        assert {m.name: m.frame for m in scene.timeline_markers} == {"jump": 1, "jump return": 10}
        assert scene.frame_start == 1 and scene.frame_end == 10
        assert not scene.camera.animation_data and not scene.camera.data.animation_data, "animated jump camera"
        assert not any(image.filepath for image in bpy.data.images if image.source == "FILE")
        root = bpy.data.objects["CTRL / character anchor"]
        eyes = [m.shape_keys.key_blocks["Blink"] for m in bpy.data.meshes if m.shape_keys and "Blink" in m.shape_keys.key_blocks]
        assert len(eyes) >= 4 and all(key.id_data.animation_data for key in eyes), "missing native eye keys"
        poses, lifts, compressions = [], [], []
        for frame in range(1, 11):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            assert char["camera"] == {"matrix": [list(row) for row in scene.camera.matrix_world], "scale": scene.camera.data.ortho_scale}, "changed jump camera"
            assert list(root.location) == char["anchor"], "changed base anchor"
            assert all(abs(key.value) < 0.00001 for key in eyes), "jump eyes must stay open"
            poses.append(world_pose())
            lifts.append(root.delta_location.z)
            compressions.append((bpy.data.objects["CTRL / breath"] if char["id"] == "moon_cat" else root).delta_scale.z)
        assert poses[0] == poses[-1] == original_pose, "jump must return to original native pose"
        assert max(lifts) > .02 and min(compressions) < .98, "missing native lift or anticipation"
        assert len({str(p) for p in poses}) >= 6, "frozen native jump"
        print("NATIVE JUMP PASS", char["id"], "10 fixed-camera/anchor samples; lift/anticipation; original neutral endpoints and geometry/materials")


if __name__ == "__main__":
    check()
