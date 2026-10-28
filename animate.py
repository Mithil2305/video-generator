#!/usr/bin/env python3
"""End-to-End Universal Animated Video Generator CLI.

Executes the complete production lifecycle:
1. Creative Brief & AI Planning (director.py)
2. Audio & Timing Preparation (audio.py / vo.py)
3. Headless Chrome Frame-by-Frame Rendering (render.mjs)
4. Multi-Stream Audio Muxing (audio.py mix)
5. Quality Validation (validator.py)

Usage:
  python animate.py "A lonely robot discovering a garden on Mars" --dur 30 --style cinematic
  python animate.py "How quantum computers work" --category educational --style whiteboard
  python animate.py "Cryptocurrency market shift" --category specialized --style motion_graphics
"""
import argparse, json, os, subprocess, sys, time
from typing import Optional

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

SKILL_ROOT = os.path.dirname(os.path.abspath(__file__))
from director import create_project, CATEGORIES, STYLES, FORMATS, AUDIO_MOODS
from validator import validate_project_video


def run_process(cmd: list, cwd: Optional[str] = None) -> bool:
    print(f"  > {' '.join(cmd)}")
    p = subprocess.run(cmd, cwd=cwd or SKILL_ROOT)
    return p.returncode == 0


def generate_animated_video(prompt: str, options: dict) -> dict:
    t_start = time.time()
    print("\n" + "=" * 70)
    print("🎬 UNIVERSAL ANIMATED VIDEO GENERATOR")
    print("=" * 70)
    print(f"Prompt: \"{prompt}\"")
    print(f"Options: {json.dumps(options, indent=2)}\n")

    # Step 1: AI Creative Direction & Storyboarding
    print("[1/4] Planning Scene Storyboard...")
    plan_res = create_project(prompt, options)
    proj_dir = plan_res["project_dir"]
    plan = plan_res["plan"]
    name = plan["name"]
    print(f"  ✓ Storyboard planned: {len(plan['scenes'])} scenes in {proj_dir}")
    print(f"    Category: {plan.get('category')} | Style: {plan.get('style')} | Format: {plan.get('format')}")

    # Step 2: Audio Synthesis & Bed Pre-generation
    print("\n[2/4] Preparing Audio & Sound Design...")
    # Ensure SFX kit is present
    run_process([sys.executable, os.path.join(SKILL_ROOT, "audio.py"), "sfx"])
    print("  ✓ Audio sound effects and bed ready.")

    # Step 3: Frame-by-Frame Rendering with Headless Chrome & FFmpeg
    print("\n[3/4] Rendering Animation Frames (Playwright + FFmpeg)...")
    render_script = os.path.join(SKILL_ROOT, "engine", "render.mjs")
    render_args = ["node", render_script, proj_dir]
    if options.get("draft"):
        render_args.append("--draft")
    
    render_ok = run_process(render_args)
    if not render_ok:
        print("  ✗ Rendering encountered an error.", file=sys.stderr)
        return {"success": False, "error": "Render process failed", "project": proj_dir}

    # Step 4: Quality Validation
    print("\n[4/4] Validating Video Quality & Stream Integrity...")
    val_report = validate_project_video(proj_dir)
    is_valid = val_report.get("valid", False)
    
    elapsed = time.time() - t_start
    print("\n" + "=" * 70)
    if is_valid:
        print(f"🎉 SUCCESS: Video Rendered & Validated in {elapsed:.1f}s!")
        print(f"📁 Video File: {val_report.get('video_path')}")
        print(f"📊 Specs: {val_report.get('resolution')} | {val_report.get('duration')}s | {val_report.get('file_size_mb')} MB")
    else:
        print(f"⚠️ Video rendered with warnings in {elapsed:.1f}s.")
        print(f"📁 Video File: {val_report.get('video_path')}")
    print("=" * 70 + "\n")

    return {
        "success": is_valid,
        "project": proj_dir,
        "plan": plan,
        "video": val_report.get("video_path"),
        "validation": val_report,
        "elapsed_seconds": round(elapsed, 1)
    }


def main():
    parser = argparse.ArgumentParser(description="Generate any animated video from prompt")
    parser.add_argument("prompt", help="Text prompt, concept, or script")
    parser.add_argument("--category", choices=CATEGORIES, help="Video category")
    parser.add_argument("--style", choices=STYLES, help="Visual style preset")
    parser.add_argument("--format", choices=FORMATS, default="16:9", help="Aspect ratio (16:9, 9:16, 1:1, 4:5)")
    parser.add_argument("--duration", type=float, default=30.0, help="Target duration in seconds")
    parser.add_argument("--mood", choices=AUDIO_MOODS, help="Audio music mood")
    parser.add_argument("--draft", action="store_true", help="Render draft preview (half size, faster)")

    args = parser.parse_args()
    options = {
        "category": args.category,
        "style": args.style,
        "format": args.format,
        "duration": args.duration,
        "mood": args.mood,
        "draft": args.draft
    }
    res = generate_animated_video(args.prompt, options)
    if not res.get("success") and not res.get("video"):
        sys.exit(1)


if __name__ == "__main__":
    main()
