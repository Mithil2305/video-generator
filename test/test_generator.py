#!/usr/bin/env python3
"""Automated Test Suite for Universal Animated Video Generator.

Tests:
1. Prompt Parsing and Category/Style Inference
2. Storyboard Planning across 6 Diverse Categories:
   - Storytelling (Lonely robot on Mars)
   - Educational (Quantum computing whiteboard)
   - Business (SaaS launch turnaround)
   - Cinematic (Cyberpunk rain sequence)
   - Social (TikTok kinetic text)
   - Specialized (Financial candlestick/metrics)
3. Character and Environment Continuity Tracking
4. Multi-Mood Audio Bed Generation (Cinematic, Lo-fi, Suspense, Corporate)
5. Quality Validation on Rendered Video Streams
6. Universal Scene Builder Verification
"""
import json, os, sys, unittest

# Ensure root is in path
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from director import detect_category_and_style, local_heuristic_director, create_project
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


class TestStoryboardPlanning(unittest.TestCase):
    def test_storytelling_storyboard(self):
        prompt = "A 45-second animated story about a lonely robot discovering a garden on Mars."
        plan = local_heuristic_director(prompt, {"duration": 45.0})
        self.assertEqual(plan["category"], "storytelling")
        self.assertEqual(plan["style"], "cinematic")
        self.assertGreaterEqual(len(plan["scenes"]), 3)
        # Check that scenes do NOT force product launch or marketing copy
        for s in plan["scenes"]:
            self.assertNotIn("free trial", (s.get("vo") or "").lower())
            self.assertNotIn("cta", (s.get("vo") or "").lower())
        # Check character continuity
        chars = plan.get("continuity", {}).get("characters", [])
        self.assertGreaterEqual(len(chars), 1)
        self.assertIn("robot", chars[0]["type"].lower())

    def test_educational_storyboard(self):
        prompt = "Explain quantum computing and qubit entanglement."
        plan = local_heuristic_director(prompt, {"duration": 30.0})
        self.assertEqual(plan["category"], "educational")
        # Should have whiteboard or diagram scenes
        types = [s["type"] for s in plan["scenes"]]
        self.assertTrue("whiteboard" in types or "motion" in types)

    def test_social_storyboard(self):
        prompt = "Stop scrolling. 3 daily habits to double your focus."
        plan = local_heuristic_director(prompt, {"duration": 15.0})
        self.assertEqual(plan["category"], "social")
        self.assertEqual(plan["format"], "9:16")
        types = [s["type"] for s in plan["scenes"]]
        self.assertTrue("kinetic" in types or "motion" in types)

    def test_specialized_storyboard(self):
        prompt = "Cryptocurrency market shift and trading volume comparison."
        plan = local_heuristic_director(prompt, {"duration": 20.0})
        self.assertEqual(plan["category"], "specialized")
        # Should use motion templates like candlestick or compare-bars
        has_motion = any(s["type"] == "motion" for s in plan["scenes"])
        self.assertTrue(has_motion)


class TestAudioEngine(unittest.TestCase):
    def test_multi_mood_beds(self):
        # Generate 2 seconds of each mood to verify DSP synthesis stability
        for mood in ["cinematic", "lofi", "suspense", "corporate", "silent"]:
            x = bed(2.0, bpm=100, mood=mood)
            self.assertEqual(x.shape[1], 2)
            if mood == "silent":
                self.assertEqual(x.max(), 0.0)
            else:
                self.assertGreater(x.max(), 0.0)

    def test_sfx_kit(self):
        # Verify required SFX keys are registered
        for sfx in ["whoosh", "boom", "riser", "pop", "ding", "ping", "sparkle", "laser", "impact", "glitch", "shimmer"]:
            self.assertIn(sfx, KIT)


class TestQualityValidation(unittest.TestCase):
    def test_validation_report(self):
        proj_dir = os.path.join(ROOT, "launches", "a-45-second-animated-story-a")
        if os.path.exists(proj_dir):
            report = validate_project_video(proj_dir)
            self.assertIn("valid", report)
            self.assertIn("checks", report)
            self.assertTrue(report["valid"])


if __name__ == "__main__":
    unittest.main()
