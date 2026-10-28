"""
Unit and integration tests for NullMotion template library integration into launch-video.
Tests:
1. Python-level plan schema validation & registry checks
2. Missing required field rejection naming template & field
3. Missing optional field omission without error
4. Rejection of unknown / unimplemented templates
5. Execution of engine Playwright test suite (test_motion_contract.mjs):
   - Determinism (pixel hash check at t=1.5s)
   - Seek order independence (5s -> 2s vs fresh page at 2s)
   - Engine-level schema validation in window.__load
   - Multi-format text bounds check (16:9, 9:16, 1:1, 4:5)
   - Zero real-time clock APIs in engine/motion/
   - End-to-end smoke renders (16:9 and 9:16) through render.mjs & validator.py
"""

import os
import sys
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from director import validate_plan_schema, get_motion_templates, REGISTRY


class TestNullMotionIntegration(unittest.TestCase):
    def test_registry_motion_templates(self):
        # Must have motion_templates list in REGISTRY
        self.assertIn("motion_templates", REGISTRY)
        templates = get_motion_templates(implemented_only=True)
        # Ensure our high-value templates are implemented
        expected_implemented = [
            "16-line-growth",
            "13-compare-bars",
            "10-candlestick",
            "14-leaderboard",
            "01-cta-pill",
            "02-three-step",
            "06-notification",
            "18-cta-click",
            "22-kinetic-headline"
        ]
        for tid in expected_implemented:
            self.assertIn(tid, templates, f"Template {tid} should be registered as implemented")
            self.assertIn("schema", templates[tid])

    def test_motion_schema_required_field_missing(self):
        # 13-compare-bars requires 'bars'
        bad_plan = {
            "format": "16:9",
            "scenes": [
                {
                    "type": "motion",
                    "template": "13-compare-bars",
                    "dur": 4.0,
                    "data": {
                        "unit": "x"
                    }
                }
            ]
        }
        ok, err = validate_plan_schema(bad_plan)
        self.assertFalse(ok)
        self.assertIsNotNone(err)
        # Error must name template and field
        self.assertIn("13-compare-bars", err)
        self.assertIn("bars", err)

    def test_motion_schema_optional_field_omitted(self):
        # 13-compare-bars with optional 'unit' omitted should pass
        good_plan = {
            "format": "16:9",
            "scenes": [
                {
                    "type": "motion",
                    "template": "13-compare-bars",
                    "dur": 4.0,
                    "data": {
                        "bars": [
                            {"label": "Before", "value": 10},
                            {"label": "After", "value": 50}
                        ]
                    }
                }
            ]
        }
        ok, err = validate_plan_schema(good_plan)
        self.assertTrue(ok)
        self.assertIsNone(err)

    def test_unimplemented_or_unknown_template_rejected(self):
        bad_plan = {
            "format": "16:9",
            "scenes": [
                {
                    "type": "motion",
                    "template": "99-nonexistent-template",
                    "dur": 4.0
                }
            ]
        }
        ok, err = validate_plan_schema(bad_plan)
        self.assertFalse(ok)
        self.assertIn("unknown motion template", err)

    def test_engine_motion_contract_suite(self):
        # Runs the Playwright contract test suite (determinism, seek order, formats, real-time ban, smoke renders)
        script_path = os.path.join(ROOT, "test", "test_motion_contract.mjs")
        proc = subprocess.run(
            ["node", script_path],
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        if proc.returncode != 0:
            print(proc.stdout)
            print(proc.stderr)
        self.assertEqual(proc.returncode, 0, f"Engine motion contract test failed: {proc.stderr}")
        self.assertIn("ALL TESTS PASSED SUCCESSFULLY! (6/6)", proc.stdout)


if __name__ == "__main__":
    unittest.main()
