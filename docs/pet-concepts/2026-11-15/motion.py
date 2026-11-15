"""Animation timing shared by the SVG artists and Blender timeline.

The final key of a repeating sequence matches the initial key and is excluded
from export, so there is no double hold at the seam.
"""
POSES = ('idle', 'walk', 'sit', 'sleep', 'jump', 'look', 'grab')
TIMING = {
    'idle': [360, 360, 360, 140, 220, 360, 360],
    'walk': [100] * 8,
    'sit': [270, 270, 270, 140, 270, 270],
    'sleep': [300] * 8,
    'jump': [100] * 10,
    'look': [160] * 10,
    'grab': [100] * 6,
}
SINGLES = {'look', 'jump'}
POSTER = {'idle': 0, 'walk': 1, 'sit': 0, 'sleep': 0, 'jump': 4, 'look': 4, 'grab': 0}
