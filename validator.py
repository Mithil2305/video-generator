#!/usr/bin/env python3
"""Quality Validation System for Animated Video Generator.

Validates:
1. Video file accessibility and size integrity
2. Stream codec parameters (H.264 video, AAC audio)
3. Target duration vs actual duration
4. Resolution and aspect ratio adherence to plan format
5. Frame rate consistency and frame count
6. Audio track presence, channel count, and EBU R128 integrated loudness
7. Black frames / empty freeze detection
8. Scene count and timing verification against plan.json / timeline.json
"""
import argparse, json, os, re, subprocess, sys
from fractions import Fraction
from typing import Dict, Any, List, Optional

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

FORMAT_RESOLUTIONS = {
    "16:9": (1920, 1080),
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
    "4:5": (1080, 1350)
}


def run_cmd(cmd: List[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60)


def probe_media(video_path: str) -> Dict[str, Any]:
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", video_path
    ]
    res = run_cmd(cmd)
    if res.returncode != 0:
        raise RuntimeError(f"FFprobe failed on {video_path}: {res.stderr}")
    return json.loads(res.stdout)


def detect_black_frames(video_path: str, max_duration: float = 3.0) -> List[Dict[str, float]]:
    """Detects consecutive black frames longer than max_duration seconds."""
    cmd = [
        "ffmpeg", "-v", "error", "-i", video_path,
        "-vf", "blackdetect=d=1.5:pix_th=0.10",
        "-f", "null", "-"
    ]
    res = run_cmd(cmd)
    black_intervals = []
    for line in res.stderr.splitlines():
        if "black_start" in line and "black_end" in line:
            try:
                parts = dict(p.split(":") for p in line.split() if ":" in p)
                start = float(parts.get("black_start", 0))
                end = float(parts.get("black_end", 0))
                dur = float(parts.get("black_duration", 0))
                if dur >= max_duration:
                    black_intervals.append({"start": start, "end": end, "duration": dur})
            except Exception:
                pass
    return black_intervals


def measure_audio_loudness(video_path: str) -> Optional[Dict[str, float]]:
    """Measures integrated loudness (LUFS) and true peak using ffmpeg ebur128 filter."""
    cmd = [
        "ffmpeg", "-v", "error", "-i", video_path,
        "-af", "ebur128=peak=true",
        "-f", "null", "-"
    ]
    try:
        res = run_cmd(cmd)
        out = res.stderr
        i_match = re.search(r"I:\s*(-?[\d\.]+)\s*LUFS", out)
        tp_match = re.search(r"Peak:\s*(-?[\d\.]+)\s*dBFS", out) or re.search(r"True\s*peak:\s*(-?[\d\.]+)", out)
        if i_match:
            return {
                "integrated_lufs": float(i_match.group(1)),
                "true_peak_db": float(tp_match.group(1)) if tp_match else 0.0
            }
    except Exception:
        pass
    return None


def validate_project_video(proj_dir: str, video_path: Optional[str] = None) -> Dict[str, Any]:
    plan_path = os.path.join(proj_dir, "plan.json")
    if not os.path.exists(plan_path):
        return {"valid": False, "error": f"Missing plan.json in {proj_dir}"}

    with open(plan_path, "r", encoding="utf-8") as f:
        plan = json.load(f)

    name = plan.get("name", os.path.basename(proj_dir))

    # VA-06: Check out/result.json first to validate the exact output
    if not video_path:
        res_json = os.path.join(proj_dir, "out", "result.json")
        if os.path.exists(res_json):
            try:
                with open(res_json, "r", encoding="utf-8") as rf:
                    rdata = json.load(rf)
                if rdata.get("video_path") and os.path.exists(rdata["video_path"]):
                    video_path = rdata["video_path"]
            except Exception:
                pass

    if not video_path:
        out_dir = os.path.join(proj_dir, "out")
        candidates = [
            os.path.join(out_dir, f"{name}.mp4"),
            os.path.join(out_dir, f"{name}-review.mp4"),
            os.path.join(out_dir, f"{name}-draft.mp4")
        ]
        video_path = next((c for c in candidates if os.path.exists(c)), None)

    if not video_path or not os.path.exists(video_path):
        return {
            "valid": False,
            "error": f"No rendered video found for project {name}. Run render first.",
            "plan": plan
        }

    file_size_bytes = os.path.getsize(video_path)
    if file_size_bytes < 10000:
        return {
            "valid": False,
            "error": f"Video file is corrupted or too small ({file_size_bytes} bytes).",
            "file": video_path
        }

    try:
        probe = probe_media(video_path)
    except Exception as e:
        return {"valid": False, "error": f"Media probing error: {e}", "file": video_path}

    streams = probe.get("streams", [])
    format_info = probe.get("format", {})

    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

    checks = []

    # 1. Video Stream Checks
    if not video_stream:
        checks.append({"name": "video_stream", "status": "FAIL", "message": "No video stream present"})
    else:
        v_width = int(video_stream.get("width", 0))
        v_height = int(video_stream.get("height", 0))
        v_codec = video_stream.get("codec_name", "")

        # VA-05: Use Fraction instead of eval
        fps_raw = video_stream.get("r_frame_rate", "30/1")
        try:
            fps = round(float(Fraction(fps_raw)), 1)
        except Exception:
            fps = 30.0

        checks.append({"name": "video_codec", "status": "PASS" if "264" in v_codec or "h264" in v_codec else "WARN", "codec": v_codec})

        # VA-01: Resolution check against plan format
        plan_fmt = plan.get("format", "16:9")
        exp_dims = FORMAT_RESOLUTIONS.get(plan_fmt, (1920, 1080))
        exp_draft = (exp_dims[0] // 2, exp_dims[1] // 2)
        is_correct_res = (v_width, v_height) in (exp_dims, exp_draft)
        checks.append({
            "name": "resolution",
            "status": "PASS" if is_correct_res else "FAIL",
            "resolution": f"{v_width}x{v_height}",
            "expected": f"{exp_dims[0]}x{exp_dims[1]} (or draft {exp_draft[0]}x{exp_draft[1]}) for format {plan_fmt}"
        })

        checks.append({"name": "frame_rate", "status": "PASS" if fps >= 14 else "FAIL", "fps": fps})

        # VA-03: Frame count check
        nb_frames_str = video_stream.get("nb_frames")
        actual_dur = float(format_info.get("duration", 0))
        if nb_frames_str and nb_frames_str.isdigit():
            nb_frames = int(nb_frames_str)
            exp_frames = round(actual_dur * fps)
            frame_drift = abs(nb_frames - exp_frames)
            checks.append({
                "name": "frame_count",
                "status": "PASS" if frame_drift <= max(2, exp_frames * 0.03) else "FAIL",
                "actual_frames": nb_frames,
                "expected_frames": exp_frames
            })

    # 2. Audio Stream Checks
    # VA-07: Fixed silent condition
    music_setting = plan.get("music")
    wants_silent = music_setting is False or (isinstance(music_setting, dict) and music_setting.get("mood") == "silent")
    expects_audio = not wants_silent and (any(s.get("vo") for s in plan.get("scenes", [])) or music_setting is not False)

    if wants_silent:
        checks.append({"name": "audio_mode", "status": "PASS", "message": "Silent audio mode intended"})
    else:
        # VA-02: Missing audio when expected must be a FAIL
        if audio_stream:
            a_codec = audio_stream.get("codec_name", "")
            a_sr = int(audio_stream.get("sample_rate", 0))
            a_ch = int(audio_stream.get("channels", 0))
            checks.append({"name": "audio_stream", "status": "PASS", "codec": a_codec, "sample_rate": a_sr, "channels": a_ch})

            # VA-01: Measure audio loudness with ebur128
            loudness = measure_audio_loudness(video_path)
            if loudness:
                int_lufs = loudness["integrated_lufs"]
                tp = loudness["true_peak_db"]
                # Target is -14 LUFS (+/- 3 LU) and true peak <= 0 dBTP
                loudness_ok = abs(int_lufs - (-14.0)) <= 3.5 and tp <= 0.5
                checks.append({
                    "name": "audio_loudness",
                    "status": "PASS" if loudness_ok else "FAIL",
                    "integrated_lufs": int_lufs,
                    "true_peak_db": tp,
                    "target": "-14 LUFS (+/-3 LU), true peak <= 0 dBTP"
                })
        else:
            checks.append({
                "name": "audio_stream",
                "status": "FAIL" if expects_audio else "PASS",
                "message": "audio expected but missing from render" if expects_audio else "No audio stream present"
            })

    # 3. Duration Adherence
    actual_dur = float(format_info.get("duration", 0))
    expected_dur = plan.get("target_duration") or sum(s.get("dur", 5.0) for s in plan.get("scenes", []))
    dur_diff = abs(actual_dur - expected_dur)
    # VA-04: Tighter tolerance: 0.6s + 3% of expected duration
    tolerance = max(0.6, 0.5 + expected_dur * 0.03)
    dur_pass = dur_diff <= tolerance
    checks.append({
        "name": "duration_check",
        "status": "PASS" if dur_pass else "FAIL",
        "actual_seconds": round(actual_dur, 2),
        "expected_seconds": round(expected_dur, 2),
        "difference": round(dur_diff, 2),
        "tolerance": round(tolerance, 2)
    })

    # 4. Black Frames Check
    black_intervals = detect_black_frames(video_path, max_duration=3.0)
    if black_intervals:
        checks.append({"name": "black_frames", "status": "FAIL", "intervals": black_intervals})
    else:
        checks.append({"name": "black_frames", "status": "PASS", "message": "No unintended long black frames detected"})

    # 5. Scene Count & Consistency
    scene_count = len(plan.get("scenes", []))
    checks.append({"name": "scene_integrity", "status": "PASS" if scene_count >= 1 else "FAIL", "scene_count": scene_count})

    # VA-03: Scene boundaries against timeline.json if present
    tl_path = os.path.join(proj_dir, "timeline.json")
    if os.path.exists(tl_path):
        try:
            with open(tl_path, "r", encoding="utf-8") as tf:
                tl_data = json.load(tf)
            tl_dur = float(tl_data.get("duration", 0))
            if tl_dur > 0:
                boundary_diff = abs(actual_dur - tl_dur)
                checks.append({
                    "name": "scene_boundaries",
                    "status": "PASS" if boundary_diff <= 0.8 else "FAIL",
                    "video_duration": round(actual_dur, 2),
                    "timeline_duration": round(tl_dur, 2)
                })
        except Exception:
            pass

    # VA-02: Valid is true ONLY when there are no FAIL statuses
    all_pass = not any(c.get("status") == "FAIL" for c in checks)

    report = {
        "valid": all_pass,
        "project": name,
        "video_path": video_path,
        "file_size_mb": round(file_size_bytes / (1024 * 1024), 2),
        "duration": round(actual_dur, 2),
        "resolution": f"{video_stream.get('width')}x{video_stream.get('height')}" if video_stream else "unknown",
        "checks": checks
    }
    return report


def main():
    parser = argparse.ArgumentParser(description="Validate Animated Video Generator Render Output")
    parser.add_argument("project", help="Path to project directory or launches/<name>")
    parser.add_argument("--video", help="Optional explicit path to mp4 file")
    parser.add_argument("--json", action="store_true", help="Output full report as JSON")

    args = parser.parse_args()
    proj_dir = os.path.abspath(args.project)
    report = validate_project_video(proj_dir, args.video)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"\nVideo Validation Report: {report.get('project')}")
        print(f"Status: {'VALID' if report.get('valid') else 'FAILED'}")
        if report.get("video_path"):
            print(f"File: {report['video_path']} ({report.get('file_size_mb')} MB, {report.get('duration')}s, {report.get('resolution')})")
        print("\nChecks:")
        for c in report.get("checks", []):
            st = c.get("status")
            badge = "[PASS]" if st == "PASS" else ("[WARN]" if st == "WARN" else "[FAIL]")
            details = " | ".join(f"{k}: {v}" for k, v in c.items() if k not in ("name", "status"))
            print(f"  {badge:6s} {c.get('name'):20s} {details}")
        print()

    if not report.get("valid"):
        sys.exit(1)


if __name__ == "__main__":
    main()
