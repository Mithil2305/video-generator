#!/usr/bin/env python3
"""Automated Test Suite for Universal Animated Video Generator.

Tests:
1. Prompt Parsing and Category/Style Inference (DR-03)
2. Format resolution and social 9:16 default (DR-01)
3. Storyboard Planning across diverse categories
4. Character and Environment Continuity Tracking (DR-07)
5. Multi-Mood Audio Bed Generation and SFX Kit (AU-03, PL-06)
6. Quality Validation & Schema Verification (DR-10, VA-01, VA-02, VA-04, VA-05)
7. Clean copy and no mid-word truncation (DR-05, DR-06)
8. Registry agreement (EN-06)
"""
import glob, json, os, re, sys, unittest

# Ensure root is in path
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from director import (
    detect_category_and_style, local_heuristic_director, create_project,
    enforce_options, validate_plan_schema, REGISTRY,
    find_matching_asset_directory, index_assets
)
from validator import validate_project_video
from audio import bed, KIT


class TestPromptUnderstanding(unittest.TestCase):
    def test_category_inference(self):
        # 1. Storytelling
        cat, style, mood = detect_category_and_style("A lonely robot discovering a garden on Mars.")
        self.assertEqual(cat, "storytelling")
        self.assertEqual(mood, "cinematic")

        # 2. Educational
        cat, style, mood = detect_category_and_style("Explain how quantum superposition works in 30 seconds.")
        self.assertEqual(cat, "educational")
        self.assertEqual(mood, "lofi")

        # 3. Business
        cat, style, mood = detect_category_and_style("Product launch video for our B2B SaaS startup with pricing.")
        self.assertEqual(cat, "business")
        self.assertEqual(mood, "corporate")

        # 4. Cinematic
        cat, style, mood = detect_category_and_style("Atmospheric visual poetry of midnight ocean mist and moonlight.")
        self.assertEqual(cat, "cinematic")
        self.assertEqual(mood, "cinematic")

        # 5. Social
        cat, style, mood = detect_category_and_style("Viral TikTok reel hook about morning habits.")
        self.assertEqual(cat, "social")

        # 6. Specialized
        cat, style, mood = detect_category_and_style("Financial metrics candlestick chart and leaderboard.")
        self.assertEqual(cat, "specialized")

    def test_dr03_word_matching_and_priority(self):
        # DR-03: 'happy' contains 'app' but must not match business
        cat, _, _ = detect_category_and_style("A happy dog playing in the park")
        self.assertEqual(cat, "storytelling")

        # DR-03: 'how to' with social keywords must match social before educational
        cat, _, _ = detect_category_and_style("How to go viral on TikTok with reels")
        self.assertEqual(cat, "social")


class TestStoryboardPlanning(unittest.TestCase):
    def test_dr01_social_default_format(self):
        # DR-01: Social request with no format passed must yield 9:16
        plan = local_heuristic_director("Viral TikTok hook for morning focus", {})
        self.assertEqual(plan["format"], "9:16")

        # Non-social default is 16:9
        plan_biz = local_heuristic_director("Product demo for our enterprise platform", {})
        self.assertEqual(plan_biz["format"], "16:9")

    def test_dr02_enforce_options(self):
        # DR-02: Options must be applied authoritatively
        plan = local_heuristic_director("Quantum computing", {})
        opts = {"duration": 15.0, "format": "9:16", "mood": "synthwave", "category": "social"}
        enforce_options(plan, opts)
        self.assertEqual(plan["format"], "9:16")
        self.assertEqual(plan["category"], "social")
        self.assertEqual(plan["music"]["mood"], "synthwave")
        self.assertAlmostEqual(sum(s["dur"] for s in plan["scenes"]), 15.0, places=1)

    def test_dr04_social_scene_count_and_hook(self):
        # DR-04: Short-form social video has rapid cut cadence and hook <= 2.5s
        plan = local_heuristic_director("Stop scrolling. 3 tips to double your productivity", {"duration": 15.0})
        self.assertEqual(plan["category"], "social")
        self.assertGreaterEqual(len(plan["scenes"]), 4)
        first_scene = plan["scenes"][0]
        self.assertLessEqual(first_scene["dur"], 2.5)

    def test_dr07_no_mars_robot_for_lonely_baker(self):
        # DR-07: 'lonely' must not trigger Unit 7 robot on Mars
        plan = local_heuristic_director("A lonely baker opens a small pastry shop", {})
        chars = plan.get("continuity", {}).get("characters", [])
        self.assertEqual(len(chars), 0)
        for s in plan["scenes"]:
            self.assertNotIn("unit seven", (s.get("vo") or "").lower())
            self.assertNotIn("mars", (s.get("vo") or "").lower())

    def test_dr06_clean_narration_and_titles(self):
        # DR-06: Prompt command verbs should not leak into narration
        prompt = "Explain how quantum computers use superposition"
        plan = local_heuristic_director(prompt, {})
        vo_01 = plan["scenes"][0].get("vo", "")
        self.assertNotIn("how explain how", vo_01.lower())
        # Titles must not end mid-word
        for s in plan["scenes"]:
            txt = s.get("text", "")
            if "..." in txt:
                self.assertFalse(re.search(r"[a-z]{1,3}\.\.\.", txt))

    def test_dr08_educational_chart_conditional(self):
        # DR-08: Explainer without data brief shouldn't force 16-line-growth
        plan_no_data = local_heuristic_director("How quantum computers use superposition", {})
        has_chart = any(s.get("template") == "16-line-growth" for s in plan_no_data["scenes"])
        self.assertFalse(has_chart)

        # But explainer with metrics mentions can include growth chart
        plan_data = local_heuristic_director("Explain the science of exponential growth curve metrics", {})
        has_chart_data = any(s.get("template") == "16-line-growth" for s in plan_data["scenes"])
        self.assertTrue(has_chart_data)

    def test_dr10_schema_validation(self):
        # DR-10: Unknown scene types or templates must be caught by schema validation
        valid_plan = local_heuristic_director("Simple explainer", {})
        ok, err = validate_plan_schema(valid_plan)
        self.assertTrue(ok)
        self.assertIsNone(err)

        # Invalid scene type
        bad_plan = {
            "format": "16:9",
            "scenes": [{"type": "nonexistent_type", "dur": 5.0}]
        }
        ok, err = validate_plan_schema(bad_plan)
        self.assertFalse(ok)
        self.assertIn("invalid type", err)

        # Invalid motion template
        bad_motion = {
            "format": "16:9",
            "scenes": [{"type": "motion", "template": "99-unimplemented", "dur": 5.0}]
        }
        ok, err = validate_plan_schema(bad_motion)
        self.assertFalse(ok)
        self.assertIn("unknown motion template", err)


class TestAudioEngine(unittest.TestCase):
    def test_multi_mood_beds(self):
        for mood in ["cinematic", "lofi", "suspense", "corporate", "silent"]:
            x = bed(2.0, bpm=100, mood=mood)
            self.assertEqual(x.shape[1], 2)
            if mood == "silent":
                self.assertEqual(x.max(), 0.0)
            else:
                self.assertGreater(x.max(), 0.0)

    def test_sfx_kit(self):
        for sfx in ["whoosh", "boom", "riser", "pop", "ding", "ping", "sparkle", "laser", "impact", "glitch", "shimmer"]:
            self.assertIn(sfx, KIT)


class TestQualityValidation(unittest.TestCase):
    def test_validation_report(self):
        proj_dir = os.path.join(ROOT, "launches", "a-45-second-animated-story-a")
        if os.path.exists(proj_dir):
            report = validate_project_video(proj_dir)
            self.assertIn("valid", report)
            self.assertIn("checks", report)

    def test_va05_no_eval_in_codebase(self):
        # VA-05: Ensure no eval() calls exist in production Python files
        py_files = glob.glob(os.path.join(ROOT, "*.py"))
        eval_matches = []
        eval_pattern = re.compile(r"\b" + "eval" + r"\s*\(")
        for pf in py_files:
            with open(pf, "r", encoding="utf-8") as f:
                for line_no, line in enumerate(f, 1):
                    if eval_pattern.search(line):
                        eval_matches.append(f"{os.path.basename(pf)}:{line_no}")
        self.assertEqual(eval_matches, [], f"Found eval() calls in: {eval_matches}")

    def test_en06_registry_agreement(self):
        # EN-06: Registry must contain required keys and match SFX kit
        self.assertIn("scene_types", REGISTRY)
        self.assertIn("motion_templates", REGISTRY)
        self.assertIn("formats", REGISTRY)
        self.assertIn("sfx", REGISTRY)

        for sfx_name in ["whoosh", "boom", "ding", "pop", "riser"]:
            self.assertIn(sfx_name, REGISTRY["sfx"])
            self.assertIn(sfx_name, KIT)


class TestAssetReferenceIntegration(unittest.TestCase):
    def test_find_and_index_yukti_assets(self):
        # 1. Automatic discovery from prompt mentioning Yukti
        asset_dir = find_matching_asset_directory("Product launch video for Yukti autonomous decision intelligence")
        self.assertIsNotNone(asset_dir)
        self.assertTrue(os.path.isdir(asset_dir))
        self.assertTrue(asset_dir.endswith("yukti-assets"))

        # 2. Index assets
        cat = index_assets(asset_dir)
        self.assertEqual(cat.get("brand_name"), "Yukti")
        self.assertEqual(cat.get("logo"), "yukti-logo.png")
        self.assertGreater(len(cat.get("videos", [])), 0)
        self.assertGreater(len(cat.get("images", [])), 0)

        # Verify key assets exist in index
        stems = {a["stem"].lower() for a in cat.get("all_assets", [])}
        self.assertIn("dashboardpage", stems)
        self.assertIn("actionspage", stems)
        self.assertIn("askyuktipage", stems)

    def test_heuristic_plan_incorporates_reference_assets(self):
        prompt = "Product launch video for Yukti autonomous decision intelligence"
        plan = local_heuristic_director(prompt, {"duration": 30.0})

        # Category and theme
        self.assertEqual(plan["category"], "business")
        self.assertEqual(plan.get("brand", {}).get("name"), "Yukti")
        self.assertEqual(plan.get("brand", {}).get("mark"), "assets/yukti-logo.png")
        self.assertEqual(plan.get("theme", {}).get("accent"), "#329CDA")

        # Verify UI scenes reference real assets
        ui_scenes = [s for s in plan["scenes"] if s.get("type") == "ui"]
        self.assertGreaterEqual(len(ui_scenes), 2)
        for sc in ui_scenes:
            self.assertTrue(sc.get("src", "").startswith("assets/"))
            # Confirm file exists in yukti-assets
            base_fname = os.path.basename(sc["src"])
            self.assertTrue(
                os.path.exists(os.path.join(ROOT, "assets", "yukti-assets", base_fname)),
                f"Referenced asset {base_fname} does not exist in assets/yukti-assets"
            )

        # Duration matches target
        total_dur = sum(s["dur"] for s in plan["scenes"])
        self.assertAlmostEqual(total_dur, 30.0, places=1)

    def test_explicit_assets_argument(self):
        # Pass explicit assets directory for generic prompt
        plan = local_heuristic_director("Enterprise software demo", {"assets": "assets/yukti-assets", "duration": 20.0})
        self.assertEqual(plan.get("brand", {}).get("name"), "Yukti")
        self.assertEqual(plan.get("brand", {}).get("mark"), "assets/yukti-logo.png")
        ui_scenes = [s for s in plan["scenes"] if s.get("type") == "ui"]
        self.assertGreaterEqual(len(ui_scenes), 1)


if __name__ == "__main__":
    unittest.main()

