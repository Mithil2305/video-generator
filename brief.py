#!/usr/bin/env python3
"""Structured creative-brief support.

A brief is a shot list written inside the prompt, for example:

    * Scene 1 (Hook, 0–5s): Bold kinetic typography: "Next 7 days. Before you order."
      Spoken VO: "Here are the next 7 days of sales, before you place the order."
    * Scene 2 (UI Demo, 5–13s): UI screen showing the forecast. Caption: "Sales next to expected demand."

When a brief is present it is authoritative. Its time ranges become fixed scene
boundaries, its quoted text becomes on-screen text, and its "Spoken VO" lines become
narration. The planner does not call an LLM and does not rescale scenes, so the
result matches the brief rather than a generic template.

Screenshots referenced by a brief can declare named regions in a sidecar file
`<image-stem>.regions.json` next to the image. A brief that says "zoom in on the
badge" then zooms to the region named by the badge keywords instead of guessing
coordinates. Regions are defined in normalised (0..1) screenshot coordinates.
"""
import json
import os
import re
from typing import Any, Dict, List, Optional

# Scene header: "* Scene 1 (Hook, 0–5s):" (bullet and colon optional; en dash, em dash or hyphen)
DASH = r"[\u2013\u2014\-]"
SCENE_SPLIT = re.compile(r"(?=\bScene\s+\d+\s*\()", re.IGNORECASE)
SCENE_HEAD = re.compile(
    r"^\s*[*\-\u2022]?\s*Scene\s+(\d+)\s*\(\s*([^,()]+?)\s*,\s*(\d+(?:\.\d+)?)\s*" + DASH +
    r"\s*(\d+(?:\.\d+)?)\s*s\s*\)\s*:?\s*",
    re.IGNORECASE,
)
# "25-second", "25 seconds", "25 sec"
DURATION_RE = re.compile(r"(\d+(?:\.\d+)?)\s*-?\s*(?:seconds?|secs?)\b", re.IGNORECASE)
FORMAT_RE = re.compile(r"\b(9:16|16:9|1:1|4:5)\b")
QUOTE = r"[\u201c\"]([^\u201d\"]+)[\u201d\"]"
FIELD_RES = {
    "vo": re.compile(r"Spoken\s+VO\s*:\s*" + QUOTE, re.IGNORECASE),
    "caption": re.compile(r"Caption\s*:\s*" + QUOTE, re.IGNORECASE),
    "sub": re.compile(r"Sub-?copy\s*:\s*" + QUOTE, re.IGNORECASE),
}
QUOTE_RE = re.compile(QUOTE)

DEFAULT_THEME = {
    "accent": "#329CDA", "dark": "#080F1A", "light": "#F6F9FC", "ink": "#0B0E14", "paper": "#E4EEF6",
}
# Share of the frame width a window occupies in each format; used to turn a zoom factor into a camera fill.
WINDOW_FRAC = {"9:16": 0.92, "1:1": 0.92, "4:5": 0.92, "16:9": 0.78}


class BriefError(ValueError):
    """Raised when a brief is present but cannot be turned into a valid plan."""


def _slug_tokens(text: str) -> List[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def parse_brief(prompt: str) -> Optional[Dict[str, Any]]:
    """Return the parsed brief, or None when the prompt has no scene list.

    Raises BriefError if a scene list exists but is inconsistent (gaps, overlaps,
    numbering problems, or a total that disagrees with the stated duration).
    """
    if not prompt or not re.search(r"\bScene\s+\d+\s*\(", prompt, re.IGNORECASE):
        return None

    parts = [p for p in SCENE_SPLIT.split(prompt) if re.match(r"\s*[*\-\u2022]?\s*Scene\s+\d+\s*\(", p, re.IGNORECASE)]
    header_text = SCENE_SPLIT.split(prompt)[0]

    scenes = []
    for part in parts:
        m = SCENE_HEAD.match(part)
        if not m:
            raise BriefError(f"could not read scene header: {part[:60]!r}")
        idx, label = int(m.group(1)), m.group(2).strip()
        start, end = float(m.group(3)), float(m.group(4))
        if end <= start:
            raise BriefError(f"scene {idx} ends before it starts ({start}–{end}s)")
        scenes.append({"index": idx, "label": label, "start": start, "end": end, "body": part[m.end():].strip()})

    # Numbering and contiguity
    for n, sc in enumerate(scenes, start=1):
        if sc["index"] != n:
            raise BriefError(f"scene numbers must run 1..N in order; found {sc['index']} where {n} was expected")
    if scenes[0]["start"] != 0:
        raise BriefError(f"the first scene must start at 0s (starts at {scenes[0]['start']}s)")
    for prev, cur in zip(scenes, scenes[1:]):
        if abs(cur["start"] - prev["end"]) > 1e-6:
            raise BriefError(f"gap or overlap between scene {prev['index']} (ends {prev['end']}s) and "
                             f"scene {cur['index']} (starts {cur['start']}s)")

    total = scenes[-1]["end"]
    dm = DURATION_RE.search(header_text)
    stated = float(dm.group(1)) if dm else None
    if stated is not None and abs(stated - total) > 1e-6:
        raise BriefError(f"the brief says {stated:g} seconds but its scenes end at {total:g}s; fix one of them")

    fm = FORMAT_RE.search(header_text)
    fmt = fm.group(1) if fm else None
    if not fmt:
        low = header_text.lower()
        fmt = "9:16" if "vertical" in low else ("1:1" if "square" in low else None)

    for sc in scenes:
        sc.update(_parse_body(sc["body"]))

    brand = None
    bm = re.search(r"\b([A-Z][A-Za-z0-9]+)'s\b", header_text)
    if bm:
        brand = bm.group(1)

    return {"duration": total, "stated_duration": stated, "format": fmt, "brand": brand,
            "header": header_text.strip(), "scenes": scenes}


def _parse_body(body: str) -> Dict[str, Any]:
    """Split a scene body into voice line, caption, subcopy, on-screen headline and description."""
    fields: Dict[str, Optional[str]] = {"vo": None, "caption": None, "sub": None}
    rest = body
    for key, rx in FIELD_RES.items():
        m = rx.search(rest)
        if m:
            fields[key] = m.group(1).strip()
            rest = rest[:m.start()] + " " + rest[m.end():]
    quotes = [q.strip() for q in QUOTE_RE.findall(rest)]
    description = re.sub(r"\s+", " ", QUOTE_RE.sub(" ", rest))
    description = re.sub(r"[\s*\u2022\-]+$", "", description).strip(" .:,")
    return {
        "vo": fields["vo"],
        "caption": fields["caption"],
        "sub": fields["sub"],
        "headline": quotes[0] if quotes else None,
        "description": description,
        "description_lc": description.lower(),
        "body_lc": body.lower(),
    }


def scene_kind(label: str, desc_lc: str) -> str:
    """Decide the engine builder for a scene from its label and description."""
    lab = label.lower()
    if re.search(r"\bcta\b|\bpill\b|\bbutton\b", desc_lc) or "cta" in lab:
        return "cta"
    if re.search(r"\bkinetic\b|\btypography\b", desc_lc) or lab.startswith("hook"):
        return "kinetic"
    if re.search(r"\bui\b|\bscreen\b|\bdashboard\b|\bzoom\b|\bscreenshot\b", desc_lc):
        return "ui"
    return "text"


def pick_screenshot(asset_dir: Optional[str], prompt: str, explicit: Optional[str] = None) -> Optional[str]:
    """Choose the screenshot whose file name best matches the brief. Logos are never screenshots."""
    if not asset_dir or not os.path.isdir(asset_dir):
        return None
    files = [f for f in os.listdir(asset_dir) if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
    files = [f for f in files if "logo" not in f.lower()]
    if explicit:
        for f in files:
            if os.path.splitext(f)[0].lower() == os.path.splitext(explicit)[0].lower():
                return f
    prompt_tokens = set(_slug_tokens(prompt))
    best, best_score = None, 0
    for f in sorted(files):
        stem = os.path.splitext(f)[0]
        toks = {t.lower() for t in re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+", stem)}
        score = len(toks & prompt_tokens)
        if score > best_score:
            best, best_score = f, score
    return best


def load_regions(asset_dir: str, image: str) -> Dict[str, Dict[str, Any]]:
    stem = os.path.splitext(image)[0]
    path = os.path.join(asset_dir, stem + ".regions.json")
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f).get("regions", {})


def _matched_regions(regions: Dict[str, Dict[str, Any]], desc_lc: str) -> List[tuple]:
    """Regions whose keywords appear in the description, ordered by where they first appear."""
    hits = []
    for name, r in regions.items():
        first = None
        for kw in r.get("keywords", []):
            m = re.search(r"\b" + re.escape(kw.lower()) + r"\b", desc_lc)
            if m and (first is None or m.start() < first):
                first = m.start()
        if first is not None:
            hits.append((first, name, r))
    return [(name, r) for _, name, r in sorted(hits, key=lambda x: x[0])]


def zoom_keys(regions_hit: List[tuple], dur: float, fmt: str) -> List[Dict[str, Any]]:
    """Camera keys for the UI builder: hold the full screenshot, then zoom to each region in turn."""
    # Every camera property needs a value at t=0. keyAt() holds the first keyed value backwards in time,
    # so a missing x/y would make the window jump to the first zoom target before it is reached.
    keys = [{"at": 0, "s": 1, "x": 0, "y": 0, "rx": 0, "ry": 0}]
    n = len(regions_hit)
    step = max(0.5, (dur - 0.8) / n)
    ww = WINDOW_FRAC.get(fmt, 0.92)
    for k, (_, r) in enumerate(regions_hit):
        x, y, w, h = r["rect"]
        fill = round(float(r.get("zoom", 2.0)) * w * ww, 3)
        keys.append({"at": round(0.5 + k * step, 2), "to": [x, y, w, h], "fill": fill})
    return keys


def plan_from_brief(brief: Dict[str, Any], prompt: str, options: Dict[str, Any],
                    asset_dir: Optional[str]) -> Dict[str, Any]:
    """Build a fixed-timing plan from a parsed brief. No LLM, no rescaling."""
    fmt = options.get("format") or brief.get("format") or "16:9"
    total = brief["duration"]
    scenes_b = brief["scenes"]

    brand_guess = options.get("brand") or brief.get("brand") or ""
    ui_text = " ".join(sc["description"] for sc in scenes_b if scene_kind(sc["label"], sc["description_lc"]) == "ui")
    ui_text = re.sub(re.escape(brand_guess), " ", ui_text, flags=re.IGNORECASE) if brand_guess else ui_text
    screen = pick_screenshot(asset_dir, ui_text or prompt, options.get("screen"))
    regions = load_regions(asset_dir, screen) if (asset_dir and screen) else {}
    logo = None
    if asset_dir and os.path.isdir(asset_dir):
        logos = sorted(f for f in os.listdir(asset_dir) if "logo" in f.lower() and f.lower().endswith(".png"))
        logo = logos[0] if logos else None

    scenes, warnings = [], []
    for sc in scenes_b:
        kind = scene_kind(sc["label"], sc["description_lc"])
        dur = round(sc["end"] - sc["start"], 3)
        base = {"id": f"sc_{sc['index']:02d}", "start": sc["start"], "dur": dur, "bg": "dark",
                "narrative_purpose": sc["label"], "brief_description": sc["description"]}
        if sc["vo"]:
            base["vo"] = sc["vo"]

        if kind == "cta":
            text = sc["headline"] or sc["caption"] or ""
            scene = dict(base, type="text", text=f"[{text}]" if text else "", size="l")
            if sc["sub"]:
                scene["sub"] = sc["sub"]
            scene["sfx"] = [{"name": "pop", "at": 0.4, "gain": 0.45}]
        elif kind == "kinetic":
            text = sc["headline"] or sc["caption"] or sc["vo"] or ""
            scene = dict(base, type="kinetic", text=text)
            scene["sfx"] = [{"name": "boom", "at": 0.05, "gain": 0.5}]
        elif kind == "ui" and screen:
            scene = dict(base, type="ui", src=f"assets/{screen}", side="top", frame="browser")
            if sc["caption"] or sc["headline"]:
                scene["text"] = sc["caption"] or sc["headline"]
            # Only an explicit zoom/focus/highlight in the brief moves the camera to a region.
            # Other scenes keep the builder's gentle push so a full-width window is never cropped.
            hits = _matched_regions(regions, sc["description_lc"]) if regions else []
            if hits and re.search(r"\b(zoom|zooms|zooming|focus|highlight|punch)\b", sc["description_lc"]):
                scene["cam"] = zoom_keys(hits, dur, fmt)
            scene["sfx"] = [{"name": "whoosh", "at": 0.05, "gain": 0.4}]
        else:
            text = sc["caption"] or sc["headline"] or sc["vo"] or ""
            scene = dict(base, type="text", text=text)
        scenes.append(scene)
        if kind == "ui" and sc["headline"] and screen:
            warnings.append(f"scene {sc['index']} names '{sc['headline']}', which is not checked against "
                            f"{screen}; confirm that label appears in the screenshot")

    scenes = [s for s in scenes if s["dur"] > 0]
    vo_enabled = any(s.get("vo") for s in scenes)
    brand_name = options.get("brand") or brief.get("brand") or "Brand"
    plan = {
        "title": (scenes_b[0]["headline"] or scenes_b[0]["caption"] or prompt[:40]).strip(),
        "prompt": prompt,
        "brief": {"duration": total, "format": brief.get("format"), "scenes": len(scenes_b)},
        "category": "business",
        "style": "motion_graphics",
        "format": fmt,
        "fps": 30,
        "target_duration": total,
        "timing": "fixed",
        "planner": "brief",
        "quality": "final",
        "theme": dict(DEFAULT_THEME),
        "music": {"mood": "synthwave", "bpm": 118, "gain": 0.3, "synth": True},
        "vo": {"pre": 0.12, "post": 0.2, "enabled": vo_enabled},
        "continuity": {"characters": [], "environments": [], "props": []},
        "scenes": scenes,
    }
    if logo:
        plan["brand"] = {"name": brand_name, "mark": f"assets/{logo}"}
    else:
        plan["brand"] = {"name": brand_name}
    if screen and not regions:
        warnings.append(f"no regions file for {screen}: zoom shots in the brief will not be applied")
    if warnings:
        plan["warnings"] = warnings
    return plan


def validate_brief_plan(plan: Dict[str, Any]) -> List[str]:
    """Problems that would make the rendered video disagree with the brief."""
    problems = []
    t = 0.0
    for sc in plan["scenes"]:
        if abs(sc["start"] - t) > 1e-6:
            problems.append(f"{sc['id']} starts at {sc['start']}s, expected {t:g}s")
        t = sc["start"] + sc["dur"]
        if sc["type"] == "ui" and not sc.get("src"):
            problems.append(f"{sc['id']} is a UI scene without a screenshot")
    if abs(t - plan["target_duration"]) > 1e-6:
        problems.append(f"scenes end at {t:g}s but the brief asks for {plan['target_duration']:g}s")
    return problems


if __name__ == "__main__":
    import sys
    text = open(sys.argv[1], encoding="utf-8").read() if len(sys.argv) > 1 else sys.stdin.read()
    b = parse_brief(text)
    print(json.dumps(b, indent=2, ensure_ascii=False) if b else "no brief found")
