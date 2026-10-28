# Video Generator: Issues and Proposed Fixes

Scope: `animate.py`, `director.py`, `validator.py`, `audio.py`, `vo.py`, `engine/render.mjs`, `engine/player.js`, `engine/style.css`, `engine/player.html`, `package.json`, `package_1.json`, `package-lock.json`, `_env.example`, and the sample `plan.json`.

Status: these are proposals. Nothing in the repository has been changed.

## How to read this document

Each issue has an ID, a severity, the location, the problem, and a proposed fix. "Done when" is the acceptance check. Severity:

- **Critical**: the default pipeline produces wrong output and reports success.
- **High**: visibly wrong output, a crash on a normal path, or a claim the user can't check.
- **Medium**: quality or reliability problem that appears under specific conditions.
- **Low**: maintainability, performance or hygiene.

Items marked *(unverified)* depend on files I did not have.

## Summary

| ID | Title | Severity |
|---|---|---|
| PL-01 | Default pipeline never generates voice-over | Critical |
| PL-02 | Stale timeline makes picture and sound disagree | High |
| PL-03 | Narrated scene timing ignores `--duration` | High |
| PL-04 | Project folder names collide and overwrite | Medium |
| PL-05 | CLI exit code is 0 when validation fails | Medium |
| PL-06 | SFX kit is rebuilt on every run; no subprocess timeouts | Low |
| DR-01 | `--format` default makes social videos 16:9 | High |
| DR-02 | LLM planner ignores user options | High |
| DR-03 | Keyword router uses substring matches and wrong priority | Medium |
| DR-04 | Scene count fixed; short-form hooks get stretched | High |
| DR-05 | Fallback copy invents statistics and claims | High |
| DR-06 | Raw prompt text leaks into narration and on-screen titles | Medium |
| DR-07 | "lonely" and similar words trigger the Mars robot story | Medium |
| DR-08 | Educational fallback always shows a growth chart | Medium |
| DR-09 | Planner failures are swallowed silently | Medium |
| DR-10 | LLM output is not schema-validated | High |
| DR-11 | Hardcoded model name, branding and env var names | Low |
| VA-01 | Documented checks missing; resolution always PASS | High |
| VA-02 | WARN counts as pass; broken output is reported valid | Critical |
| VA-03 | No frame-count, scene-boundary or caption checks | Medium |
| VA-04 | Duration tolerance too loose for short videos | Low |
| VA-05 | `eval()` on ffprobe frame rate | Low |
| VA-06 | Output file selection may validate a draft | Low |
| VA-07 | Dead silent-mode condition | Low |
| RN-01 | Render crashes when a worker gets no frames | Medium |
| RN-02 | JPEG capture before H.264 encoding | Medium |
| RN-03 | Output has no colour tags | Medium |
| RN-04 | Segment concatenation timestamps not verified | Low |
| RN-05 | No cleanup on failure | Medium |
| RN-06 | Page errors don't stop the render | High |
| RN-07 | Chrome flags disable web security | Low |
| RN-08 | Missing Chrome gives an unclear error | Medium |
| RN-09 | Review bitrate uses magic numbers | Low |
| EN-01 | Video seek timeout silently accepts stale frames | High |
| EN-02 | Unknown motion templates render an empty chart | High |
| EN-03 | "Surge 10x" is hardcoded in the compare-bars template | High |
| EN-04 | Unit 7 robot drawn from hardcoded story code *(unverified)* | Medium |
| EN-05 | Font paths probably don't resolve *(unverified)* | High |
| EN-06 | Scene types, templates and SFX names duplicated across files | Medium |
| EN-07 | README describes NullMotion integration that isn't used | Low |
| AU-01 | Soft limiter distorts the whole mix | Medium |
| AU-02 | Single-pass loudness normalisation | Low |
| AU-03 | Shared random generator makes noise order-dependent | Low |
| AU-04 | `mix` defaults to 30 s with no timeline | Low |
| AU-05 | Music bed is regenerated in full on each mix; slow loops | Low |
| VO-01 | ElevenLabs cache key is incomplete | Medium |
| VO-02 | Word timing falls back to estimates without faster-whisper | High |
| VO-03 | File handles left open | Low |
| PK-01 | Two package manifests; `npm start` does not work from root | High |
| PK-02 | No `requirements.txt` | Medium |
| PK-03 | Env var names and example file name are inconsistent | Low |
| PK-04 | No LICENSE | Low |
| PK-05 | Playwright and Chrome versions are not pinned together | Low |

---

## 1. Pipeline (`animate.py`, timeline, render orchestration)

### PL-01 · Default pipeline never generates voice-over · Critical

- **Where:** `animate.py` `generate_animated_video`; `audio.py` `mix`; `engine/player.js` `estimate`.
- **Problem:** Step 2 only rebuilds the SFX kit. `vo.py` is never called, so no clips or `timeline.json` exist. `mix()` only mixes voice when `timeline.json` is present, so narration is dropped without a message. The player then estimates timing at 2.7 words per second. The render log prints a note, but the run still ends in success.
- **Fix:**
  1. When any scene has a `vo` line, `animate.py` runs the chosen TTS provider and then `vo.py build`.
  2. The provider comes from an option or env var (`VO_PROVIDER=eleven|fish|say`).
  3. If there is voice-over but no `timeline.json` after that step, stop with an error.
  4. Add `--no-vo` for silent videos, which must be explicit.

  ```python
  def ensure_voiceover(proj_dir, plan, provider):
      if not any(s.get("vo") for s in plan["scenes"]):
          return
      run_or_fail([sys.executable, "vo.py", provider, proj_dir])   # generate clips
      run_or_fail([sys.executable, "vo.py", "build", proj_dir])    # align + timeline.json
      if not os.path.exists(os.path.join(proj_dir, "timeline.json")):
          raise SystemExit("voice-over expected but timeline.json was not produced")
  ```
- **Done when:** `python animate.py "..."` with an ElevenLabs key produces a video whose audio contains narration, and a run with no voice provider stops with a clear message.

### PL-02 · Stale timeline makes picture and sound disagree · High

- **Where:** `engine/player.js` `__load` (fallback to `estimate`); `audio.py` `mix` (always reads `timeline.json`); `engine/render.mjs`.
- **Problem:** If the scene count differs from the plan, `player.js` silently uses an estimated timeline for the picture (a `console.warn` only). `audio.py` still reads the old `timeline.json`. Narration and visuals then drift apart. Nothing records which plan the timeline came from.
- **Fix:**
  1. `vo.py build` stores the SHA-256 of `plan.json` in `timeline.json`.
  2. `render.mjs` compares it with the current plan before rendering and stops on mismatch.
  3. Remove the silent estimate fallback. Use an explicit `--estimate-timing` flag to allow it.

  ```python
  # vo.py build
  plan_sha = hashlib.sha256(open(os.path.join(proj, "plan.json"), "rb").read()).hexdigest()
  json.dump({"plan_sha256": plan_sha, "duration": ..., "vo": ..., "scenes": ...}, f, indent=1)
  ```
  ```js
  // render.mjs, before opening the page
  const cur = crypto.createHash("sha256").update(fs.readFileSync(path.join(PROJ, "plan.json"))).digest("hex");
  if (timeline && timeline.plan_sha256 !== cur && !flag("estimate-timing"))
    throw new Error("timeline.json is stale: re-run `vo.py build` (or pass --estimate-timing)");
  ```
- **Done when:** editing `plan.json` without re-running `vo.py build` causes the render to stop with a clear message.

### PL-03 · Narrated scene timing ignores `--duration` · High

- **Where:** `vo.py` `build` (timeline from audio length); `director.py` (durations scaled to target).
- **Problem:** For narrated scenes, the end time comes from the audio plus `post`. `dur` is only a minimum. So `--duration 15` can produce a 40-second video, and the validator's expected duration (sum of `dur`) won't match.
- **Fix:** Add a fitting step before `build`. Compare total narration against the target and:
  1. Adjust per-utterance speed within a small range (for example 0.9–1.12), or
  2. Ask the planner to shorten the script, or
  3. Report the overrun and fail.
  Store `target_duration` in the plan and check against it in the validator.
- **Done when:** a 15-second request yields a video within ±10% of 15 seconds, or fails with the reason.

### PL-04 · Project folder names collide and overwrite · Medium

- **Where:** `director.py` `create_project`; `local_heuristic_director` (`safe_name` truncates to 28 characters).
- **Problem:** Two prompts with the same first 28 characters write to the same `launches/<name>/plan.json` and overwrite each other's assets. The sample project folder `explain-how-quantum-computer` also lost its last character.
- **Fix:** Build the name from a readable slug plus a short hash of the prompt and options. Refuse to overwrite an existing project unless `--force` is given.
  ```python
  slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40]
  name = f"{slug}-{hashlib.sha1(prompt.encode()).hexdigest()[:6]}"
  ```
- **Done when:** two different prompts with the same opening words create two folders.

### PL-05 · CLI exit code is 0 when validation fails · Medium

- **Where:** `animate.py` `main`.
- **Problem:** `sys.exit(1)` only happens when there is no video. If the video exists but fails validation, the process exits 0, so CI and scripts treat it as success.
- **Fix:** Exit non-zero when `valid` is false. Add `--allow-warnings` if a softer mode is wanted.
- **Done when:** a failed validation returns exit code 1.

### PL-06 · SFX kit is rebuilt on every run; no subprocess timeouts · Low

- **Where:** `animate.py` (`audio.py sfx`); `audio.py` `build_kit(force=True)`; all `subprocess.run` calls.
- **Problem:** Every run regenerates about 16 WAV files. Child processes have no timeout, so a hung ffmpeg or Node process blocks the pipeline indefinitely.
- **Fix:** Build the kit only when missing, or when `audio.py` changes (store a version stamp). Add `timeout=` to subprocess calls and report it as a failure.
- **Done when:** a second run does not rewrite `assets/sfx/`, and a stuck subprocess fails within the timeout.

---

## 2. Planner (`director.py`)

### DR-01 · `--format` default makes social videos 16:9 · High

- **Where:** `director.py` `main` (argparse default `"16:9"`), `local_heuristic_director` (`fmt = options.get("format") or ...`); `animate.py` (same default).
- **Problem:** The default is always passed through, so the social-only 9:16 fallback is never reached. A viral prompt run without `--format 9:16` renders landscape. The README examples pass the flag, which hides the bug.
- **Fix:** Default to `None` and resolve the format after the category is known.
  ```python
  parser.add_argument("--format", choices=FORMATS, default=None)
  # later
  fmt = options.get("format") or ("9:16" if category == "social" else "16:9")
  ```
- **Done when:** `python animate.py "... viral ..."` with no flags yields 9:16.

### DR-02 · LLM planner ignores user options · High

- **Where:** `director.py` `llm_creative_director` returns the model's plan; `create_project` only fills in missing fields.
- **Problem:** When an API key is set, `--duration`, `--format`, `--mood` and `--category` are discarded.
- **Fix:** Apply the user's options after planning, and make them authoritative.
  ```python
  def enforce_options(plan, opts):
      if opts.get("category"): plan["category"] = opts["category"]
      if opts.get("format"):   plan["format"] = opts["format"]
      if opts.get("mood"):     plan.setdefault("music", {})["mood"] = opts["mood"]
      if opts.get("duration"): rescale_durations(plan, float(opts["duration"]))
      return plan
  ```
  `rescale_durations` is the same ratio logic the heuristic already uses, moved into a shared helper.
- **Done when:** with a key set, each option changes the output as the user asked.

### DR-03 · Keyword router uses substring matches and wrong priority · Medium

- **Where:** `director.py` `detect_category_and_style`.
- **Problem:** `"app"` matches "happy", "approach" and "appear". `"reel"` matches "reelect". `"how to"` is checked before the social words, so "how to go viral on TikTok" is classed as educational.
- **Fix:** Match whole words and check categories in a deliberate order (social before educational).
  ```python
  def has_word(p, words):
      return any(re.search(rf"\b{re.escape(w)}\b", p) for w in words)

  ORDER = [("social", SOCIAL_WORDS), ("business", BIZ_WORDS), ("educational", EDU_WORDS),
           ("specialized", DATA_WORDS), ("cinematic", CINE_WORDS)]
  ```
  For the LLM path, let the model choose the category.
- **Done when:** "a happy dog" is storytelling, and "how to go viral on TikTok" is social.

### DR-04 · Scene count fixed; short-form hooks get stretched · High

- **Where:** `director.py` `local_heuristic_director` (three to five fixed scenes; durations scaled by ratio).
- **Problem:** A 60-second social request stretches the 3.8-second hook to about 18 seconds. Short-form needs a cut every 1.5 to 3 seconds, but the template gives about 5 seconds per shot.
- **Fix:** Derive the number of scenes from the duration and a cut length per format, and cap individual scene length.
  ```python
  CUT_SECONDS = {"social": 2.5, "business": 4.0, "educational": 6.0, "storytelling": 6.0, "cinematic": 7.0}
  n = max(3, min(40, round(target_dur / CUT_SECONDS.get(category, 5.0))))
  # the heuristic generates n beats; the hook is always <= 2.5 s for social
  ```
  The LLM prompt should state the target cut length and forbid scenes over the cap.
- **Done when:** a 15-second social plan has about 6 scenes and a hook under 2.5 seconds.

### DR-05 · Fallback copy invents statistics and claims · High

- **Where:** `director.py`: "a 10x difference" (specialized VO), "Intelligent automation built for results" and "revenue accelerate from day one" (business), "Verified" badges (social). `engine/player.js`: see EN-03.
- **Problem:** The offline output puts numbers and product claims into the video that the user never provided. For marketing or finance content that is a trust and legal risk.
- **Fix:** Remove invented facts from every template. Use placeholders that come only from user input, such as `{{metric}}` or `{{product}}`. The validator fails the render if a placeholder is unfilled. The LLM prompt must say: "do not invent statistics, customer names or results; use only facts given in the brief."
- **Done when:** the fallback output contains no digits or product claims that did not come from the prompt, and an unfilled placeholder fails validation.

### DR-06 · Raw prompt text leaks into narration and titles · Medium

- **Where:** `director.py` `local_heuristic_director` (`f"... how {prompt.lower()} really works?"`, `f"Stop scrolling. Here is what you need to know about {prompt.lower()}."`, `title = prompt[:40] + "..."`).
- **Problem:** Prompts are pasted into sentences, which produces broken narration ("how explain how quantum computers use superposition really works"). Titles cut off mid-word ("superp...") appear on screen.
- **Fix:** Derive a short topic noun phrase rather than the full prompt, and truncate only at word boundaries. Keep on-screen titles below a length limit set by the format. Route the rest to the LLM.
- **Done when:** no narration contains the raw prompt, and no on-screen text ends mid-word.

### DR-07 · "lonely" and similar words trigger the Mars robot story · Medium

- **Where:** `director.py` `local_heuristic_director` (`is_robot_mars` checks "robot", "mars", "garden", "flower", "lonely").
- **Problem:** "A lonely baker opens a bakery" gets the Unit 7 robot on Mars.
- **Fix:** Remove the story-specific keyword check. Only use the Unit 7 template when the prompt names the robot or Mars explicitly, and rely on the LLM for anything else.
- **Done when:** "a lonely baker" produces no robot or Martian scene.

### DR-08 · Educational fallback always shows a growth chart · Medium

- **Where:** `director.py` educational branch (`"16-line-growth"`).
- **Problem:** Every educational prompt gets an exponential growth chart with narration about "an elegant and measurable curve", whatever the topic.
- **Fix:** Only use a chart when the brief supplies data. Otherwise use a whiteboard diagram scene. Mark such plans as `quality: "draft-heuristic"`.
- **Done when:** a quantum-computing prompt offline produces no unrelated chart.

### DR-09 · Planner failures are swallowed silently · Medium

- **Where:** `director.py` `llm_creative_director` (two `except Exception: pass`).
- **Problem:** A failed Groq or Anthropic call quietly falls back to generic output. The user can't tell which planner ran.
- **Fix:** Log the failure with its reason, and record the planner in the plan.
  ```python
  except Exception as e:
      log.warning("LLM planner %s failed: %s; using the offline heuristic", name, e)
  plan["planner"] = planner_used   # "groq" | "anthropic" | "heuristic"
  ```
  The studio and CLI should show this in the summary.
- **Done when:** a bad key produces a visible warning and `plan.planner == "heuristic"`.

### DR-10 · LLM output is not schema-validated · High

- **Where:** `director.py` `create_project`: a plan is accepted if `scenes` is non-empty.
- **Problem:** Missing `theme` or `music`, unknown scene types, invalid cameras and misspelled templates all pass through and fail later in the renderer, far from the cause. The system prompt also lists templates the engine doesn't implement (see EN-02).
- **Fix:** Validate the plan against a schema before anything is written, retry the LLM once with the validation errors, then fall back. Use Pydantic (or JSON Schema) with the registry from EN-06.
  ```python
  class Scene(BaseModel):
      id: str
      type: Literal["story","motion","cinematic","whiteboard","kinetic",
                    "text","hero","logo","ui","cards","terminal","chips"]
      dur: float = Field(gt=0, le=60)
      vo: Optional[str] = None
      template: Optional[str] = None   # checked against the registry
  ```
- **Done when:** a plan with an unknown scene type is rejected with a message naming the field, and the planner retries once.

### DR-11 · Hardcoded model name, branding and env var names · Low

- **Where:** `director.py`: `"claude-3-5-sonnet-20241022"`, `"llama-3.3-70b-versatile"`, "Antigravity" in the system prompt and User-Agent, `GROQ_API` and `ANTHROPIC_API` env names.
- **Problem:** Model names are hardcoded and may be retired. The branding is inconsistent with the README. The env var names are non-standard.
- **Fix:** Read model names from env vars with current defaults (`GROQ_MODEL`, `ANTHROPIC_MODEL`) and check they still exist. Rename the branding to match the README. Accept `GROQ_API_KEY` and `ANTHROPIC_API_KEY`, with the old names as fallbacks.
- **Done when:** changing a model needs no code edit, and both env var spellings work.

---

## 3. Validation (`validator.py`)

### VA-01 · Documented checks missing; resolution always PASS · High

- **Where:** `validator.py` `validate_project_video`; module docstring.
- **Problem:** The docstring promises loudness and aspect-ratio checks. Neither exists. Resolution is reported with a hard-coded `PASS`. Loudness is never measured, although `audio.py` targets -14 LUFS.
- **Fix:**
  - Resolution: compare with the expected size for `plan["format"]`; FAIL on mismatch.
  - Loudness: run `ffmpeg -af ebur128=peak=true -f null -` on the audio, and check integrated loudness within ±1 LU of -14 and true peak at or below -1 dBTP.
  - Remove the docstring claims that are not implemented.
- **Done when:** a 9:16 plan rendered at 16:9 fails, and a video at -20 LUFS fails.

### VA-02 · WARN counts as pass; broken output is reported valid · Critical

- **Where:** `validator.py` `all_pass = all(c["status"] in ("PASS", "WARN") ...)`.
- **Problem:** A missing audio stream, a duration mismatch and black frames are all `WARN`, and `WARN` counts as valid. So a video with no narration prints "SUCCESS".
- **Fix:** Use three levels with clear meaning:
  - FAIL: the output is wrong (missing expected audio, wrong resolution, duration outside tolerance, unexpected black frames).
  - WARN: suspicious but acceptable.
  - `valid` is true only when there are no FAILs.

  ```python
  expects_audio = any(s.get("vo") for s in plan["scenes"]) or plan.get("music") not in (False, None)
  if expects_audio and not audio_stream:
      checks.append({"name": "audio_stream", "status": "FAIL", "message": "audio expected but missing"})
  valid = not any(c["status"] == "FAIL" for c in checks)
  ```
- **Done when:** a silent render of a narrated plan is reported as FAILED.

### VA-03 · No frame-count, scene-boundary or caption checks · Medium

- **Where:** `validator.py` (missing checks).
- **Problem:** Frame count, scene boundaries against `timeline.json`, caption coverage, and text safe zones for 9:16 are not checked. These are the things most likely to make a short-form video look wrong.
- **Fix:**
  - Frame count: `ffprobe -count_frames` against `duration * fps`.
  - Scene boundaries: check that the last scene ends at the video duration.
  - Captions: check each spoken word has a caption event.
  - Safe zones (9:16): check that caption boxes stay out of roughly the top 250 px and bottom 340 px of 1080x1920.
- **Done when:** a render with a dropped frame or missing captions fails.

### VA-04 · Duration tolerance too loose for short videos · Low

- **Where:** `validator.py`: `dur_pass = dur_diff <= max(4.0, expected_dur * 0.18)`.
- **Problem:** The fixed 4-second floor allows about 27% drift on a 15-second video.
- **Fix:** Use a tolerance of 0.5 seconds plus 2%, and make it configurable per plan.
- **Done when:** a 15-second video that renders 19 seconds fails.

### VA-05 · `eval()` on ffprobe frame rate · Low

- **Where:** `validator.py`: `fps = round(eval(fps_raw), 1)`.
- **Problem:** `eval` on external output is unnecessary and unsafe in principle.
- **Fix:** `from fractions import Fraction; fps = float(Fraction(fps_raw))`.
- **Done when:** no `eval` remains in the codebase (`grep -R "eval(" .` is empty).

### VA-06 · Output file selection may validate a draft · Low

- **Where:** `validator.py` `validate_project_video` (candidate list `[name.mp4, name-draft.mp4, name-review.mp4]`).
- **Problem:** The first existing file wins, so a leftover draft can be validated instead of the final render.
- **Fix:** Take the final path from the render output (write `out/result.json` with the path) and validate that exact file. Fall back to a name match only when the result file is missing.
- **Done when:** validating a project after a draft and a final render checks the final file.

### VA-07 · Dead silent-mode condition · Low

- **Where:** `validator.py`: `wants_silent = ... or music_setting is False`.
- **Problem:** `music_setting` is a dict, so `is False` is never true.
- **Fix:** `wants_silent = music is False or music.get("mood") == "silent"`, with `music = plan.get("music")`.
- **Done when:** a plan with `"music": false` is treated as silent.

---

## 4. Render pipeline (`engine/render.mjs`)

### RN-01 · Render crashes when a worker gets no frames · Medium

- **Where:** `render.mjs` `per = Math.ceil(total / workers)` and `renderRange`.
- **Problem:** With `total < workers`, the last worker gets an empty range. Its ffmpeg has no input and exits with an error, which rejects `Promise.all`. Example: 5 frames with 4 workers.
- **Fix:** Clamp the worker count and skip empty ranges.
  ```js
  const N = Math.max(1, Math.min(workers, total));
  const per = Math.ceil(total / N);
  const jobs = [...Array(N)].map((_, k) => [k, k * per, Math.min(total, (k + 1) * per)])
                            .filter(([, a, b]) => b > a);
  ```
- **Done when:** `--from 5 --to 5.2 --workers 4` renders without error.

### RN-02 · JPEG capture before H.264 encoding · Medium

- **Where:** `render.mjs` `shot()` (JPEG quality 93) and the mjpeg pipe.
- **Problem:** Two lossy steps. Thin whiteboard lines and small text show artifacts, and gradients band.
- **Fix:** Capture PNG for the final render (keep JPEG for `--draft`) and pipe as `-c:v png`. Measure the time cost; it is usually acceptable at 1080p.
- **Done when:** a still of a thin whiteboard line shows no JPEG ringing at 100% zoom.

### RN-03 · Output has no colour tags · Medium

- **Where:** `render.mjs` encode and mux commands.
- **Problem:** The MP4 carries no primaries, matrix or range tags, so players can shift colours, especially on phones.
- **Fix:** Convert explicitly and tag the output:
  ```
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv
  ```
- **Done when:** `ffprobe` reports bt709 primaries, transfer and matrix, and limited range.

### RN-04 · Segment concatenation timestamps not verified · Low

- **Where:** `render.mjs` `ffmpeg -f concat ... -c copy`.
- **Problem:** Concatenating independently encoded segments with stream copy can produce timestamp irregularities at the joins. Nothing checks this.
- **Fix:** Keep stream copy for speed, but validate the frame count and timestamp monotonicity (RN-06, VA-03). If either fails, re-encode the join.
- **Done when:** a render's `count_frames` equals `duration * fps` and timestamps are strictly increasing.

### RN-05 · No cleanup on failure · Medium

- **Where:** `render.mjs` top-level flow.
- **Problem:** An exception leaves Chrome open and `.seg*.mp4` and `.segs.txt` files behind.
- **Fix:** Wrap the render in `try/finally` that closes the browser and removes temporary files.
- **Done when:** a forced failure leaves no browser process and no `.seg` files.

### RN-06 · Page errors don't stop the render · High

- **Where:** `render.mjs` `page.on("pageerror", ...)` logs only.
- **Problem:** A broken scene keeps rendering, so the output has wrong frames and no failure.
- **Fix:** Record the first page error, check it after every frame, and throw.
  ```js
  let pageFault = null;
  page.on("pageerror", (e) => { pageFault ??= e; });
  // in the frame loop
  if (pageFault) throw new Error("page error during render: " + pageFault.message);
  ```
- **Done when:** a scene that throws during a frame stops the render with an error.

### RN-07 · Chrome flags disable web security · Low

- **Where:** `render.mjs` `chromium.launch` args `--disable-web-security`, `--allow-file-access-from-files`.
- **Problem:** Fine for trusted local plans. Not safe if a plan can reference arbitrary files or URLs from untrusted input.
- **Fix:** Keep the flags only for local rendering. Document this, and reject plan media paths that resolve outside the project folder.
- **Done when:** a plan with `src: "../../secret.png"` is rejected.

### RN-08 · Missing Chrome gives an unclear error · Medium

- **Where:** `render.mjs` `CHROME` lookup (`find` may return `undefined`, which Playwright reports vaguely).
- **Problem:** If no Chrome is found, the failure message doesn't say what to do.
- **Fix:** Check for a browser up front and print: set `CHROME`, install Chrome, or run `npx playwright install chromium`. Add these steps to `doctor` (see PK-05).
- **Done when:** a machine without Chrome gets an actionable message.

### RN-09 · Review bitrate uses magic numbers · Low

- **Where:** `render.mjs`: `Math.floor((14 * 8192) / ...) - 160`.
- **Problem:** The 14 MB target and the 160 kbps audio allowance are unexplained.
- **Fix:** Name them as constants with a comment (target size, audio bitrate).
- **Done when:** the constants are named and documented.

---

## 5. Engine (`engine/player.js`, `style.css`, `player.html`)

### EN-01 · Video seek timeout silently accepts stale frames · High

- **Where:** `player.js` `__seek`: `setTimeout(ok, 2000)` resolves the promise after 2 seconds whether or not the seek completed.
- **Problem:** A stale video frame can be captured, and output stops being deterministic.
- **Fix:** Reject on timeout so the render fails, and log which video and time failed.
  ```js
  function seekVideo(v, target) {
    return new Promise((ok, bad) => {
      const timer = setTimeout(() => bad(new Error(`video seek timeout at ${target}s`)), 2000);
      v.onseeked = () => { clearTimeout(timer); ok(); };
      v.currentTime = target;
    });
  }
  ```
- **Done when:** a video that fails to seek fails the render.

### EN-02 · Unknown motion templates render an empty chart · High

- **Where:** `player.js` `B.motion` (implements `16-line-growth`, `10-candlestick`, `13-compare-bars` only). `director.py` and the LLM system prompt reference `06-notification`, `07-chat-sim`, `08-prompt-bar`, `02-three-step`, `15-bar-3d`, `22-kinetic-headline`, `27-cinematic-hud-overlay`.
- **Problem:** An unimplemented template draws the card and caption with no chart, and nothing reports it. The social heuristic uses `06-notification` and gets an empty card.
- **Fix:** Put the list of templates in the registry (EN-06). Throw for an unknown template in `__load`, and make the planner choose only from the list. Implement or remove each template referenced anywhere.
- **Done when:** a plan with `template: "99-missing"` fails before any frame is rendered.

### EN-03 · "Surge 10x" is hardcoded in the compare-bars template · High

- **Where:** `player.js` `B.motion`, the `13-compare-bars` branch: `g.fillText("Surge 10x", ...)`.
- **Problem:** Every compare-bars scene prints a 10x claim regardless of the content. The same fabricated-claim problem as DR-05, inside the engine.
- **Fix:** Draw labels and values from the plan (`sc.bars: [{label, value}]`). If no data is given, draw no values.
- **Done when:** the compare-bars template shows only values present in the plan.

### EN-04 · Unit 7 robot drawn from hardcoded story code · Medium *(unverified)*

- **Where:** `player.js` `B.story`, around the comment "Animated Robot Character (Unit 7)".
- **Problem:** I did not confirm whether this code is gated on the plan's `continuity.characters`. If it is always drawn, every story video gets the robot.
- **Fix:** Move character art behind a registry entry keyed by `character.type`. Draw only characters listed in the plan's continuity block.
- **Done when:** a story about a gardener shows no robot.

### EN-05 · Font paths probably don't resolve · High *(unverified)*

- **Where:** `style.css`: `url(node_modules/@fontsource/...)`. Relative URLs resolve from `engine/`, but the root `package.json` installs `@fontsource/*` into the root `node_modules`.
- **Problem:** Unless `engine/node_modules` exists, the font requests fail. `__load` awaits `document.fonts.load(...)`, so this may crash the render or fall back to system fonts, which changes the look between machines.
- **Fix:** Pick one package root. Use `../node_modules/@fontsource/...` from `style.css`, and have `__load` fail if a required font isn't loaded. The file tree mentions `engine/package.json`; if it exists, put the font dependencies there instead.
- **Done when:** the render fails with a clear message if fonts are missing, and succeeds when they are installed.

### EN-06 · Scene types, templates and SFX names duplicated across files · Medium

- **Where:** `director.py` (scene types, templates, SFX names, formats), `player.js` (builders, templates, `FORMATS`), `vo.py` (`spoken_text` "mirrors spoken() in player.js"), `audio.py` (`KIT`).
- **Problem:** The same lists live in several places and must be kept in sync by hand. Drift is already happening (EN-02).
- **Fix:** One `engine/registry.json` that defines scene types, motion templates, formats, SFX names and the spoken-text rules. Python reads it. `render.mjs` reads it and passes it to `__load`. The validator and planner check against it.
  ```json
  {
    "scene_types": ["story","motion","cinematic","whiteboard","kinetic","text","hero","logo","ui","cards","terminal","chips"],
    "motion_templates": ["16-line-growth","10-candlestick","13-compare-bars"],
    "formats": {"16:9": [1920,1080], "9:16": [1080,1920], "1:1": [1080,1080], "4:5": [1080,1350]},
    "sfx": ["whoosh","swish","riser","boom","pop","click","ding","ping","key1","key2","key3","enter","sparkle","laser","impact","glitch","shimmer"]
  }
  ```
- **Done when:** adding a template in one place is enough, and a test fails if any list disagrees with the registry.

### EN-07 · README describes NullMotion integration that isn't used · Low

- **Where:** README; `player.js` section header "NullMotion Integration".
- **Problem:** The player re-implements three templates inline and does not load the NullMotion folder. The docs overstate what runs.
- **Fix:** Either integrate NullMotion through the registry, or correct the README to describe the inline templates.
- **Done when:** the README matches the code.

---

## 6. Audio (`audio.py`)

### AU-01 · Soft limiter distorts the whole mix · Medium

- **Where:** `audio.py` `mix`: `np.tanh(out / peak * 1.2) / np.tanh(1.2) * 0.95` when the peak exceeds 0.95.
- **Problem:** The `tanh` curve applies to the whole signal, so it colours the voice as well as the peaks.
- **Fix:** Use a proper limiter in the ffmpeg chain, before loudness normalisation: `alimiter=limit=0.891:attack=5:release=50` (about -1 dBFS). Remove the `tanh` step.
- **Done when:** a loud SFX cue is limited without changing the voice's spectrum (compare spectra before and after).

### AU-02 · Single-pass loudness normalisation · Low

- **Where:** `audio.py` `loudnorm=I=-14:TP=-1.5:LRA=11`.
- **Problem:** Single-pass `loudnorm` is less accurate than two-pass.
- **Fix:** Measure with `print_format=json` on the first pass, then apply the measured values with `linear=true` on the second pass.
- **Done when:** the output measures within ±0.5 LU of -14 LUFS.

### AU-03 · Shared random generator makes noise order-dependent · Low

- **Where:** `audio.py`: module-level `rng = np.random.default_rng(11)`, used by all SFX and the bed.
- **Problem:** Changing the order of generation changes the noise. Output is deterministic per run but fragile.
- **Fix:** Create a generator per sound from a name-derived seed, e.g. `np.random.default_rng(zlib.crc32(name.encode()))`.
- **Done when:** rebuilding one SFX doesn't change any other SFX.

### AU-04 · `mix` defaults to 30 s with no timeline · Low

- **Where:** `audio.py` `mix`: `dur = (t1 ... ) else 30.0`.
- **Problem:** Calling `mix` without `--to` or a timeline silently mixes 30 seconds.
- **Fix:** Require `--to` or a timeline, and error otherwise.
- **Done when:** `audio.py mix <project>` with no timeline and no `--to` exits with a message.

### AU-05 · Music bed regenerated in full on each mix; slow loops · Low

- **Where:** `audio.py` `bed()` and the envelope follower (Python loop in steps of 64 samples).
- **Problem:** Each `mix` call rebuilds the whole bed, even for a short segment. The follower is a Python loop, which is slow for long videos.
- **Fix:** Cache the bed to `out/bed.wav` keyed by its parameters and slice it. Vectorise the envelope with `scipy.signal.lfilter`.
- **Done when:** mixing a 60-second project takes under a few seconds.

---

## 7. Voice-over (`vo.py`)

### VO-01 · ElevenLabs cache key is incomplete · Medium

- **Where:** `vo.py` `gen_eleven`: key `eleven|voice|model|speed|say`.
- **Problem:** `stability` and the neighbouring lines (`previous_text`, `next_text`) are used in the request but not in the key. Changing them doesn't regenerate the clip, so stale audio is reused without warning.
- **Fix:** Include every request parameter in the key.
  ```python
  key = f"eleven|{args.voice}|{args.model}|{args.speed}|{args.stability}|" \
        f"{prev_text}|{next_text}|{u['say']}"
  ```
- **Done when:** changing stability or an adjacent line regenerates the affected clips.

### VO-02 · Word timing falls back to estimates without faster-whisper · High

- **Where:** `vo.py` `build`: `proportional()` when there are no timestamps and no transcriber; the flag message only says "pip install faster-whisper".
- **Problem:** Captions drift from speech. The `animate.py` path never installs or checks for faster-whisper, and the render succeeds anyway.
- **Fix:** Make word timing a requirement for the default path. Check for `faster-whisper` in `doctor` and in `build`. Allow estimates only with `--allow-estimated-timing`, and record `timing: "estimated"` in the timeline so the validator can report it.
- **Done when:** a build without word timing fails, unless estimates are explicitly allowed.

### VO-03 · File handles left open · Low

- **Where:** `vo.py` `json.load(open(...))` and `json.dump(words, open(meta, "w"))` in `gen_eleven`, `build`, `script`.
- **Problem:** Handles are not closed explicitly.
- **Fix:** Use `with open(...) as f:`.
- **Done when:** `grep -n "open(" vo.py` shows only `with` statements.

---

## 8. Packaging, setup and repository

### PK-01 · Two package manifests; `npm start` does not work from root · High

- **Where:** `package.json` (engine dependencies, no scripts) and `package_1.json` (name `animated-video-generator`, scripts `start` and `test`).
- **Problem:** The README expects `npm start` and `npm test` at the root. Only `package_1.json` defines them. It is unclear which file is used.
- **Fix:** Keep one root `package.json` containing the dependencies and scripts, and delete the other. Regenerate `package-lock.json` after merging.
  ```json
  {
    "name": "launch-video",
    "private": true,
    "type": "module",
    "scripts": {
      "start": "node studio/server.mjs",
      "studio": "node studio/server.mjs",
      "test": "python test/test_generator.py && node --test engine/"
    },
    "dependencies": {
      "playwright-core": "1.48.2",
      "@fontsource/inter-tight": "5.1.0",
      "@fontsource/instrument-serif": "5.1.0",
      "@fontsource/jetbrains-mono": "5.1.0"
    }
  }
  ```
- **Done when:** `npm install && npm start` works from a clean clone.

### PK-02 · No `requirements.txt` · Medium

- **Where:** Repository root.
- **Problem:** Python imports `numpy`, `scipy`, `requests`, and optionally `faster-whisper` and `sounddevice`, but nothing lists them.
- **Fix:** Add `requirements.txt` with the packages used and versions taken from a working environment (`pip freeze` on a machine that renders correctly). Mark optional packages in a separate file or with comments.
- **Done when:** `pip install -r requirements.txt` in a fresh venv runs `python animate.py "test"`.

### PK-03 · Env var names and example file name are inconsistent · Low

- **Where:** `_env.example` (the repo expects `.env.example`); `GROQ_API`, `ANTHROPIC_API`.
- **Problem:** The file name differs from what the README expects, and the key names don't follow the usual `*_API_KEY` convention.
- **Fix:** Rename to `.env.example`. Accept the standard names (`GROQ_API_KEY`, `ANTHROPIC_API_KEY`) and keep the old ones as fallbacks for one release.
- **Done when:** both spellings work and the README documents the standard names.

### PK-04 · No LICENSE · Low

- **Where:** Repository root.
- **Problem:** Without a license, others have no permission to use or modify the code.
- **Fix:** Add a LICENSE file with the chosen license.
- **Done when:** the repository shows a license.

### PK-05 · Playwright and Chrome versions are not pinned together · Low

- **Where:** `package-lock.json` pins `playwright-core` 1.48.2; `render.mjs` uses whichever Chrome is installed.
- **Problem:** Different Chrome versions can change rendering, which hurts reproducibility.
- **Fix:** Record the Chrome version used in `out/result.json`. Offer `npx playwright install chromium` as the default, so the browser version is fixed by the Playwright release. Add the check to `doctor`.
- **Done when:** a render records the browser version, and `doctor` reports it.

---

## 9. Sample output (`launches/explain-how-quantum-computer/plan.json`)

This plan shows the offline-heuristic failures in real output:

| Location | Problem | Issue |
|---|---|---|
| `sc_01.vo` | "Have you ever wondered how explain how quantum computers use superposition really works?" | DR-06 |
| `sc_01.text` | "Understanding: Explain how quantum computers use superp..." | DR-06 |
| `name` | `explain-how-quantum-computer` (last letter lost) | PL-04 |
| `sc_02.template` | `16-line-growth` chart with a line about "an elegant and measurable curve" for superposition | DR-08 |
| `continuity` | Empty; no content from the LLM | DR-09 |

Action: after the fixes, this prompt should either use the LLM planner or be marked `quality: "draft-heuristic"` and blocked from the final render.

---

## 10. Cross-cutting changes

These changes address several issues at once:

1. **Single registry** (EN-06): one source of truth for scene types, templates, formats and SFX names.
2. **Plan schema** (DR-10): every plan is validated before rendering.
3. **Strict by default**: silent fallbacks become errors, and opt-in flags (`--estimate-timing`, `--allow-estimated-timing`, `--no-vo`) make degraded modes explicit.
4. **Result file**: each run writes `out/result.json` with the planner used, the timing source, the browser version, the output path and the validation report. The studio and CLI read it.
5. **`doctor` command**: checks Python and Node versions, ffmpeg and ffprobe, Chrome, fonts, API keys, `faster-whisper`, and whether the registry and planner agree.
6. **Quality field**: plans carry `quality: "final" | "draft-heuristic"`. Final renders refuse draft plans.

## 11. Implementation order

**Phase 0: stop wrong output (Critical and High correctness)**
PL-01, PL-02, VA-02, VA-01, RN-06, EN-01, EN-02, PK-01

**Phase 1: viral quality**
DR-01, DR-02, DR-04, DR-05, DR-06, DR-10, EN-03, VO-02, PL-03

**Phase 2: reliability and output quality**
RN-01, RN-02, RN-03, RN-05, RN-08, EN-05, EN-06, AU-01, VO-01, PK-02

**Phase 3: cleanup**
All remaining Medium and Low items.

## 12. Verification

Add these tests. Each one maps to issues above.

| Test | Covers |
|---|---|
| `"a happy dog"` routes to storytelling; `"how to go viral on TikTok"` routes to social | DR-03 |
| Social request without `--format` yields 9:16 | DR-01 |
| LLM plan with `--duration 15 --format 9:16` yields 15 s and 9:16 | DR-02 |
| Social 15-second plan has about 6 scenes and a hook under 2.5 s | DR-04 |
| No digits or product claims in fallback output unless from the prompt | DR-05 |
| Narration never contains the raw prompt; on-screen text never ends mid-word | DR-06 |
| `"a lonely baker"` produces no robot scene | DR-07 |
| Bad API key produces a warning and `planner == "heuristic"` | DR-09 |
| Plan with unknown scene type fails schema validation | DR-10 |
| Silent render of a narrated plan is FAILED | VA-02 |
| Wrong resolution is FAILED | VA-01 |
| Loudness at -20 LUFS is FAILED | VA-01 |
| Dropped frame is detected | VA-03 |
| Render with 5 frames and 4 workers succeeds | RN-01 |
| Forced failure leaves no browser or `.seg` files | RN-05 |
| Page error during a frame fails the render | RN-06 |
| Edited `plan.json` without rebuilding timeline is refused | PL-02 |
| Unknown motion template fails before rendering | EN-02 |
| Compare-bars shows only plan values | EN-03 |
| Video seek timeout fails the render | EN-01 |
| Changing stability regenerates the ElevenLabs clip | VO-01 |
| Registry and implementation lists agree | EN-06 |

Suggested manual checks, once the fixes are in:

- Render one 9:16 social video at 15 s, one educational video at 30 s, and one narrated story. Inspect the first 3 seconds of each.
- Run `ffprobe` on the output and confirm the colour tags, frame count, duration, and audio loudness.

## 13. Not reviewed

These were not in the files I had, so the issues above don't cover them:

- Most of `player.js` (about 1,600 lines): I read the load, seek, timing and dispatch code and scanned the rest with search. Individual scene builders may contain more issues.
- `studio/` (server and UI).
- `test/test_generator.py`. I don't know what it currently covers.
- `NullMotion/`.
- `.gitignore`, `README.md`, `SKILL.md`, `reference/`, `examples/`.
- `engine/package.json`, if it exists (relevant to EN-05).
- The contents of `assets/sfx/`.