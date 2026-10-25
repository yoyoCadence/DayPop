"""Use unchanged DP-203 safety/quality measurement and fixed six-state arithmetic."""
import importlib.util
from pathlib import Path

ROOT=Path(__file__).resolve().parent
PREVIOUS=ROOT.parents[1]/'2026-10-25/motion-feasibility'
spec=importlib.util.spec_from_file_location('dp203_published_contract',PREVIOUS/'contract.py')
previous=importlib.util.module_from_spec(spec);spec.loader.exec_module(previous)
sha,decode,at,measure,quality_ok=previous.sha,previous.decode,previous.at,previous.measure,previous.quality_ok
LIMIT,QUALITY=previous.LIMIT,previous.QUALITY


def baseline():return previous.baseline('moon_cat')
