"""Вариант B1 пилота (см. variant_b.py и CONTRACT.md)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from variant_b import make  # noqa: E402

_v = make("B1")
VARIANT = _v.VARIANT
provision, snapshot, run_agent, teardown = _v.provision, _v.snapshot, _v.run_agent, _v.teardown
