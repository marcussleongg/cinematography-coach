import { Room, LocalVideoTrack } from "https://esm.sh/livekit-client@2";

// ════════════════════════════════════════════════════════════════
//  VISION PROVIDER  (mock → live based on stream + target availability)
// ════════════════════════════════════════════════════════════════
const MOVE_MODEL = "Qwen/Qwen3.6-27B-FP8";

let _tick = 0;
function cannedResult(intent) {
  _tick++;
  const t = _tick;
  const landing   = Math.min(0.95, (t / 20) * 0.9 + 0.05 + (Math.random() * 0.06 - 0.03));
  const comp      = 0.55 + Math.sin(t * 0.4) * 0.2 + (Math.random() * 0.08 - 0.04);
  const timing    = 0.6  + Math.cos(t * 0.3) * 0.15 + (Math.random() * 0.06 - 0.03);

  const dirStyle  = intent.director?.toLowerCase() || "";
  const moveType  = intent.moveType?.toLowerCase() || "dolly";

  let cue = null;
  if (landing < 0.25) {
    cue = moveType.includes("pan") ? "rotate further away" : "back up more";
  } else if (comp < 0.45) {
    cue = dirStyle.includes("wes") ? "center the subject" : "adjust framing";
  } else if (timing < 0.4) {
    cue = "slow down — revealing too early";
  } else if (landing > 0.75 && comp < 0.65) {
    cue = "ease right";
  } else if (landing > 0.85) {
    cue = "almost there…";
  }

  return {
    landing: clamp(landing, 0, 1),
    composition: clamp(comp, 0, 1),
    timing: clamp(timing, 0, 1),
    cue,
    latency_ms: 60 + Math.floor(Math.random() * 90),
  };
}

function buildMovePrompt(intent) {
  const director = intent.director || "cinematic";
  const move     = intent.moveType?.replace("_", " ") || "move";
  return `Image1=target frame. Image2=live camera. ${director} style, ${move}.
Respond JSON only: {"landing":0-1,"composition":0-1,"timing":0-1,"cue":"≤6 words"|null}
landing=how close Image2 matches Image1, 1 = match. cue=null only if landing>=0.85.`;
}

async function queryOvershoot(intent) {
  const targetUrl = `ovs://streams/${targetFrameRef.streamId}?frame_index=${targetFrameRef.frameIndex}`;
  // we are looking at the last 2 seconds of the stream with fps 2, so 4 frames in total
  const liveUrl   = `ovs://streams/${streamId}?start_offset_ms=-2000&max_fps=2`;

  const body = {
    model: MOVE_MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: targetUrl } },  // Image 1: target
        { type: "video_url", video_url: { url: liveUrl } },    // Image 2: live window
        { type: "text",      text: buildMovePrompt(intent) },
      ],
    }],
    max_tokens: 80,
    response_format: { type: "json_object" },
  };

  const t0 = performance.now();
  const r  = await fetch("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const latency_ms = Math.round(performance.now() - t0);

  if (!r.ok) throw new Error(`Query ${r.status}: ${await r.text()}`);

  const data    = await r.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  const clean   = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  const parsed  = JSON.parse(clean);

  return {
    landing:     clamp(parsed.landing     ?? 0, 0, 1),
    composition: clamp(parsed.composition ?? 0, 0, 1),
    timing:      clamp(parsed.timing      ?? 0, 0, 1),
    cue:         parsed.cue || null,
    latency_ms,
  };
}

async function getVisionResult(intent) {
  // Use real inference when we have a live stream + a real locked frame index
  if (streamId && targetFrameRef?.frameIndex != null) {
    try {
      return await queryOvershoot(intent);
    } catch (e) {
      console.warn("Inference failed, using mock fallback:", e);
      return cannedResult(intent);  // keep loop alive on transient errors
    }
  }
  // Mock fallback: no stream or no locked frame yet
  await new Promise(r => setTimeout(r, 60 + Math.random() * 120));
  return cannedResult(intent);
}


// ════════════════════════════════════════════════════════════════
//  INTENT PARSER
// ════════════════════════════════════════════════════════════════
const DIRECTOR_KEYWORDS = {
  "wes anderson": { director: "Wes Anderson", composition: "symmetric centered flat", moveHint: "precise reveal" },
  "kubrick":      { director: "Kubrick",       composition: "one-point perspective",   moveHint: "slow menacing push" },
  "fincher":      { director: "Fincher",        composition: "cold tension symmetry",   moveHint: "clinical slow push" },
  "spielberg":    { director: "Spielberg",      composition: "dynamic heroic framing",  moveHint: "emotional dolly" },
  "wong kar-wai": { director: "Wong Kar-Wai",   composition: "saturated intimate",      moveHint: "slow drift" },
  "noe":          { director: "Gaspar Noé",     composition: "disorienting extreme",    moveHint: "aggressive push" },
};

const MOVE_KEYWORDS = {
  "dolly in":  "dolly_in",  "push in":   "dolly_in",
  "dolly out": "dolly_out", "pull out":  "dolly_out", "pullback": "dolly_out",
  "pan left":  "pan_left",  "pan right": "pan_right",
  "pan":       "pan",
  "track":     "track",     "tracking":  "track",
  "crane":     "crane",     "tilt":      "tilt",
};

function parseIntent(text) {
  const lower = text.toLowerCase();
  let directorInfo = null;
  for (const [key, val] of Object.entries(DIRECTOR_KEYWORDS)) {
    if (lower.includes(key)) { directorInfo = val; break; }
  }

  let moveType = null;
  for (const [key, val] of Object.entries(MOVE_KEYWORDS)) {
    if (lower.includes(key)) { moveType = val; break; }
  }
  if (!moveType) moveType = "dolly_in";

  const modifiers = [];
  if (lower.includes("slow"))     modifiers.push("slow");
  if (lower.includes("fast"))     modifiers.push("fast");
  if (lower.includes("handheld")) modifiers.push("handheld");
  if (lower.includes("smooth"))   modifiers.push("smooth");

  return {
    raw: text,
    director:      directorInfo?.director || null,
    directorStyle: directorInfo?.composition || null,
    moveType,
    modifiers,
    moveHint:      directorInfo?.moveHint || null,
  };
}

function moveHintText(intent) {
  const m = intent.moveType || "dolly_in";
  if (m === "dolly_in")        return "Step back until the subject looks comfortably small.";
  if (m === "dolly_out")       return "Move close to the subject — push in, then reveal.";
  if (m.startsWith("pan"))     return "Rotate away until your target leaves the frame.";
  if (m === "track")           return "Step to the side until you're off-angle.";
  return "Position yourself at your starting point.";
}

function chipsHTML(intent) {
  const chips = [];
  if (intent.director) chips.push(intent.director);
  chips.push(intent.moveType.replace("_", " "));
  intent.modifiers.forEach(m => chips.push(m));
  return chips.map(c => `<span class="chip">${c}</span>`).join("");
}


// ════════════════════════════════════════════════════════════════
//  STATE MACHINE
// ════════════════════════════════════════════════════════════════
let state = "SETUP";
let intent = null;
let targetFrameRef = null;
let moveStats = { ticks: 0, startTime: 0, totalLatency: 0 };

function transition(to) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(`screen-${to.toLowerCase()}`).classList.add("active");
  state = to.toUpperCase();
}


// ════════════════════════════════════════════════════════════════
//  OVERSHOOT STREAM  (Phase 3)
// ════════════════════════════════════════════════════════════════
let streamId       = null;
let livekitRoom    = null;
let keepaliveTimer = null;

function setModePill(text, color) {
  const pill = document.getElementById("mode-pill");
  pill.textContent = text;
  pill.style.color = color || "";
  pill.style.borderColor = color ? color.replace(")", ", 0.4)").replace("var(", "rgba(") : "";
}

async function setupStream() {
  try {
    const r = await fetch("/api/stream", { method: "POST" });
    const data = await r.json();
    if (data.mock) return; // no API key — stay in local/mock mode

    streamId = data.id;

    livekitRoom = new Room();
    await livekitRoom.connect(data.publish.url, data.publish.token);
    const mediaTrack = cameraStream.getVideoTracks()[0];
    const track = new LocalVideoTrack(mediaTrack);
    await livekitRoom.localParticipant.publishTrack(track);

    setModePill("STREAM", "var(--green)");

    // Keepalive every 120s — resets TTL, returns fresh token
    keepaliveTimer = setInterval(async () => {
      if (!streamId) return;
      try {
        const kr = await fetch("/api/renew", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: streamId }),
        });
        if (kr.ok) {
          const kd = await kr.json();
          // Reconnect LiveKit with the fresh token if room dropped
          if (kd.token && livekitRoom?.state === "disconnected") {
            await livekitRoom.connect(data.publish.url, kd.token);
          }
        }
      } catch (e) { console.warn("Keepalive failed:", e); }
    }, 120_000);

  } catch (e) {
    console.warn("Stream setup failed — running in local mode:", e);
  }
}

async function deleteStream() {
  clearInterval(keepaliveTimer);
  keepaliveTimer = null;
  if (livekitRoom) { livekitRoom.disconnect(); livekitRoom = null; }
  if (streamId) {
    await fetch(`/api/stream-status?id=${streamId}`, { method: "DELETE" }).catch(() => {});
    streamId = null;
  }
  setModePill("MOCK", "");
}


// ════════════════════════════════════════════════════════════════
//  AUDIO ENGINE
// ════════════════════════════════════════════════════════════════
let audioCtx = null;
let osc = null, panner = null, gainNode = null;
let pulseInterval = null;
let speechBusy = false;
let lastSpokenCue = null;
let lastCueTime = 0;
const CUE_DEBOUNCE_MS = 3000;

function unlockAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  gainNode = audioCtx.createGain();
  gainNode.gain.value = 0;
  panner = audioCtx.createStereoPanner();
  osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 220;
  osc.connect(panner).connect(gainNode).connect(audioCtx.destination);
  osc.start();
}

function startTone() {
  if (!audioCtx) return;
  gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
  gainNode.gain.setTargetAtTime(0.08, audioCtx.currentTime, 0.05);
}

function stopTone() {
  if (!audioCtx) return;
  gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
  gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.15);
}

function updateTone(landing, composition, pan = 0) {
  if (!audioCtx || !osc) return;
  osc.frequency.setTargetAtTime(180 + landing * 340, audioCtx.currentTime, 0.08);
  panner.pan.setTargetAtTime(clamp(pan, -1, 1), audioCtx.currentTime, 0.1);

  clearInterval(pulseInterval);
  const distance = 1 - landing;
  if (distance > 0.3) {
    const rate = 200 + (1 - distance) * 600;
    pulseInterval = setInterval(() => {
      if (!gainNode) return;
      gainNode.gain.setTargetAtTime(0.12, audioCtx.currentTime, 0.01);
      setTimeout(() => gainNode.gain.setTargetAtTime(0.02, audioCtx.currentTime, 0.04), 40);
    }, rate);
  }
}

function playLandChime() {
  if (!audioCtx) return;
  stopTone();
  clearInterval(pulseInterval);
  [0, 0.15, 0.3, 0.5].forEach((t, i) => {
    const freq = [523, 659, 784, 1047][i];
    const g = audioCtx.createGain();
    const o = audioCtx.createOscillator();
    o.type = "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.12, audioCtx.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + t + 0.4);
    o.connect(g).connect(audioCtx.destination);
    o.start(audioCtx.currentTime + t);
    o.stop(audioCtx.currentTime + t + 0.5);
  });
}

function speak(text) {
  if (!window.speechSynthesis) return;
  const now = Date.now();
  if (text === lastSpokenCue && now - lastCueTime < CUE_DEBOUNCE_MS) return;
  lastSpokenCue = text;
  lastCueTime = now;
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 1.1; utt.pitch = 1.0; utt.volume = 0.85;
  utt.onend = utt.onerror = () => { speechBusy = false; };
  speechBusy = true;
  window.speechSynthesis.speak(utt);
}


// ════════════════════════════════════════════════════════════════
//  SMOOTHING BUFFER
// ════════════════════════════════════════════════════════════════
const SMOOTH_N = 3;
const smoothBufs = { landing: [], composition: [], timing: [] };

function smoothPush(key, val) {
  smoothBufs[key].push(val);
  if (smoothBufs[key].length > SMOOTH_N) smoothBufs[key].shift();
  return smoothBufs[key].reduce((a, b) => a + b, 0) / smoothBufs[key].length;
}

function resetSmooth() {
  Object.keys(smoothBufs).forEach(k => (smoothBufs[k] = []));
}


// ════════════════════════════════════════════════════════════════
//  UI UPDATES
// ════════════════════════════════════════════════════════════════
function updateBars({ landing, composition, timing }) {
  document.getElementById("bar-landing").style.width     = (landing     * 100) + "%";
  document.getElementById("bar-composition").style.width = (composition * 100) + "%";
  document.getElementById("bar-timing").style.width      = (timing      * 100) + "%";
}

function updateCue(cue) {
  document.getElementById("cue-display").textContent = cue ?? "";
  if (cue) speak(cue);
}

function updateLatency(ms) {
  const el = document.getElementById("latency-badge");
  el.textContent = `${ms} ms`;
  el.style.color = ms < 200 ? "var(--green)" : ms < 350 ? "var(--accent)" : "var(--red)";
}


// ════════════════════════════════════════════════════════════════
//  CAMERA
// ════════════════════════════════════════════════════════════════
let cameraStream = null;

async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 854 }, height: { ideal: 480 }, facingMode: { ideal: "environment" } },
      audio: false,
    });
    const v = document.getElementById("video");
    v.srcObject = cameraStream;
    await v.play();
    v.classList.add("live");
  } catch (e) {
    alert("Camera access denied. Please allow camera and reload.");
    throw e;
  }
}


// ════════════════════════════════════════════════════════════════
//  MOVE LOOP
// ════════════════════════════════════════════════════════════════
const LAND_THRESHOLD = 0.88;
let loopRunning = false;

async function runMoveLoop() {
  loopRunning = true;
  _tick = 0;
  resetSmooth();
  moveStats = { ticks: 0, startTime: Date.now(), totalLatency: 0 };

  while (loopRunning) {
    const t0 = performance.now();
    const raw = await getVisionResult(intent);
    if (!loopRunning) break;

    const displayLatency = raw.latency_ms ?? Math.round(performance.now() - t0);
    updateLatency(displayLatency);
    moveStats.ticks++;
    moveStats.totalLatency += displayLatency;

    const smoothed = {
      landing:     smoothPush("landing",     raw.landing),
      composition: smoothPush("composition", raw.composition),
      timing:      smoothPush("timing",      raw.timing),
    };

    updateBars(smoothed);
    updateCue(raw.cue);
    updateTone(smoothed.landing, smoothed.composition, (raw.composition - 0.5) * -1.4);

    if (smoothed.landing >= LAND_THRESHOLD) {
      loopRunning = false;
      onLand(smoothed);
      return;
    }

    await new Promise(r => setTimeout(r, 50));
  }
}

function stopMoveLoop() {
  loopRunning = false;
  stopTone();
  clearInterval(pulseInterval);
  window.speechSynthesis?.cancel();
}

function onLand(smoothed) {
  stopTone();
  clearInterval(pulseInterval);
  playLandChime();
  speak("Landed.");

  const flash = document.getElementById("land-flash");
  flash.style.opacity = "1";
  setTimeout(() => (flash.style.opacity = "0"), 600);

  const elapsed = ((Date.now() - moveStats.startTime) / 1000).toFixed(1);
  const avgLat  = Math.round(moveStats.totalLatency / moveStats.ticks);
  document.getElementById("land-details").innerHTML =
    `Duration: <strong>${elapsed}s</strong><br>
     Ticks: <strong>${moveStats.ticks}</strong><br>
     Avg latency: <strong>${avgLat} ms</strong><br>
     Style: <strong>${intent.director || "custom"}</strong>`;

  transition("land");
}


// ════════════════════════════════════════════════════════════════
//  EVENT WIRING
// ════════════════════════════════════════════════════════════════
const shotInput = document.getElementById("shot-input");

shotInput.addEventListener("input", () => {
  const text = shotInput.value.trim();
  document.getElementById("intent-chips").innerHTML = text ? chipsHTML(parseIntent(text)) : "";
});

shotInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); document.getElementById("btn-start").click(); }
});

// SETUP → LOCK
document.getElementById("btn-start").addEventListener("click", async () => {
  unlockAudio();
  intent = parseIntent(shotInput.value.trim() || "Wes Anderson symmetric, slow dolly in");
  await startCamera();
  await setupStream();  // starts WebRTC publish; falls back gracefully if no key
  document.getElementById("lock-intent-badge").textContent =
    (intent.director || "Custom") + " · " + intent.moveType.replace("_", " ");
  transition("lock");
});

// LOCK → HINT  (captures real frame index if stream is live)
document.getElementById("btn-lock").addEventListener("click", async () => {
  if (streamId) {
    try {
      const r = await fetch(`/api/stream-status?id=${streamId}`);
      const data = await r.json();
      targetFrameRef = {
        streamId,
        frameIndex: data.last_frame_index,
        lockedAt: Date.now(),
      };
    } catch (e) {
      console.warn("Frame capture failed, using timestamp fallback:", e);
      targetFrameRef = { streamId, frameIndex: null, lockedAt: Date.now() };
    }
  } else {
    targetFrameRef = { lockedAt: Date.now(), note: "mock_ref" };
  }

  document.getElementById("hint-text").textContent = moveHintText(intent);
  document.getElementById("hint-chips").innerHTML = chipsHTML(intent);
  transition("hint");
});

document.getElementById("btn-back-to-setup").addEventListener("click", () => transition("setup"));

// HINT → MOVE
document.getElementById("btn-go").addEventListener("click", () => {
  transition("move");
  startTone();
  if (streamId && targetFrameRef?.frameIndex != null) setModePill("LIVE", "var(--green)");
  speak("Moving. " + (intent.director ? intent.director + " style." : ""));
  runMoveLoop();
});

// HINT cancel — abort + delete stream
document.getElementById("btn-cancel-hint").addEventListener("click", async () => {
  await deleteStream();
  transition("setup");
});

// MOVE stop — abort + delete stream
document.getElementById("btn-stop").addEventListener("click", async () => {
  stopMoveLoop();
  await deleteStream();
  transition("setup");
  updateCue(null);
  updateBars({ landing: 0, composition: 0, timing: 0 });
});

// LAND → new shot — keep stream alive, just reset inference loop
document.getElementById("btn-new-shot").addEventListener("click", () => {
  _tick = 0;
  transition("setup");
  shotInput.value = "";
  document.getElementById("intent-chips").innerHTML = "";
  updateBars({ landing: 0, composition: 0, timing: 0 });
});


// ════════════════════════════════════════════════════════════════
//  UTILITY
// ════════════════════════════════════════════════════════════════
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
