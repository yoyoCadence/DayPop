"""Reopen native sources: unchanged models, closed eyes, camera and loop."""
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
        bpy.ops.wm.open_mainfile(filepath=str(ROOT / char["source"]))
        scene = bpy.context.scene
        assert geometry() == original_geometry, "original mesh/material changed"
        assert scene.render.fps == 10 and scene.render.film_transparent
        assert scene.render.resolution_x == scene.render.resolution_y == 120
        assert {m.name for m in scene.timeline_markers} == {"sleep", "sleep loop boundary"}
        assert not scene.camera.animation_data and not scene.camera.data.animation_data, "animated sleep camera"
        assert not any(image.filepath for image in bpy.data.images if image.source == "FILE")
        root = bpy.data.objects["CTRL / character anchor"]
        eyes = [m.shape_keys.key_blocks["Blink"] for m in bpy.data.meshes if m.shape_keys and "Blink" in m.shape_keys.key_blocks]
        assert len(eyes) >= 4 and all(key.id_data.animation_data for key in eyes), "missing native closed-eye keys"
        poses = []
        for frame in range(1, 46):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            assert char["camera"] == {"matrix": [list(row) for row in scene.camera.matrix_world], "scale": scene.camera.data.ortho_scale}, "changed sleep camera"
            assert list(root.location) == char["anchor"], "changed base anchor"
            assert all(abs(key.value - 1) < 0.00001 for key in eyes), "sleep eyes must stay closed"
            poses.append([[round(v, 6) for row in obj.matrix_world for v in row] for obj in scene.objects if obj.type in {"MESH", "CURVE"}])
        assert poses[0] == poses[44], "sleep keyed loop boundary must close"
        assert len({str(p) for p in poses[:44]}) >= 6, "frozen native sleep"
        print("NATIVE SLEEP PASS", char["id"], "45 fixed-camera/anchor samples; closed eyes; unchanged geometry/materials")


if __name__ == "__main__":
    check()
