/* ===========================
   State
=========================== */
const frozenPhotos = { left: null, rt: null, rb: null };

let stream = null;
let currentProfileId = null;
let currentLayout = null;

let pointerWasDragging = false;


/* ===========================
   Snap settings
=========================== */
const SNAP_RATIO = 0.015; // 5% of safe width
const SNAP_RESIST = 1.0;  // magnetic strength (0.7–0.9 is good)
/* ===========================
   Elements
=========================== */

const flash = document.getElementById("flash");
const beepSound = document.getElementById("beepSound");
const shutterSound = document.getElementById("shutterSound");
shutterSound.addEventListener("loadedmetadata", () => {
  console.log("Shutter duration (sec):", shutterSound.duration);
});

const loginScreen = document.getElementById("loginScreen");
const cameraCheckScreen = document.getElementById("cameraCheckScreen");
const layoutSetupScreen = document.getElementById("layoutSetupScreen");
const boothScreen = document.getElementById("boothScreen");

const profileSelect = document.getElementById("profileSelect");
const checkVideo = document.getElementById("checkVideo");

const stage = document.getElementById("stage");
const stageBooth = document.getElementById("stageBooth");

const workCanvas = document.getElementById("workCanvas");
const workCtx = workCanvas.getContext("2d");

// Setup frames
const frameLeft_setup = document.getElementById("frameLeft_setup");
const frameRT_setup = document.getElementById("frameRT_setup");
const frameRB_setup = document.getElementById("frameRB_setup");

// Booth frames
const frameLeft = document.getElementById("frameLeft");
const frameRT = document.getElementById("frameRT");
const frameRB = document.getElementById("frameRB");

// required shot order: RT -> RB -> LEFT
const shotOrder = [frameRT, frameRB, frameLeft];


const frameFrozen = {
  left: false,
  rt: false,
  rb: false
};


/* ===========================
   Helpers
=========================== */

function addTouchSelection(el, key) {
  let pressTimer = null;
  let longPressed = false;

  el.addEventListener("pointerdown", e => {
    longPressed = false;

    pressTimer = setTimeout(() => {
      longPressed = true;

      if (selectedSetupFrames.includes(key)) {
        selectedSetupFrames =
          selectedSetupFrames.filter(k => k !== key);
      } else {
        selectedSetupFrames.push(key);
      }
      updateSetupSelectionUI();
    }, 350);
  });

  el.addEventListener("pointermove", () => {
    // movement = drag intent → cancel tap / long-press
    clearTimeout(pressTimer);
  });

  el.addEventListener("pointerup", e => {
    clearTimeout(pressTimer);

    // 🚫 if this interaction was a drag, do NOTHING
    if (pointerWasDragging) return;

    // short tap
    if (!longPressed) {
      if (e.shiftKey) {
        if (selectedSetupFrames.includes(key)) {
          selectedSetupFrames =
            selectedSetupFrames.filter(k => k !== key);
        } else {
          selectedSetupFrames.push(key);
        }
      } else {
        if (selectedSetupFrames.includes(key)) {
          selectedSetupFrames = [];
        } else {
          selectedSetupFrames = [key];
        }
      }
      updateSetupSelectionUI();
    }
  });


  el.addEventListener("pointercancel", () => {
    clearTimeout(pressTimer);
  });
}



function getBoxEdges(box) {
  return {
    left: box.x,
    right: box.x + box.w,
    top: box.y,
    bottom: box.y + box.h,
    cx: box.x + box.w / 2,
    cy: box.y + box.h / 2
  };
}


function setFrameBordersVisible(visible) {
  [frameLeft, frameRT, frameRB].forEach(f => {
    f.style.borderColor = visible ? "" : "transparent";
  });
}

function getEdges(box) {
  return {
    v: [box.x, box.x + box.w], // vertical edges
    h: [box.y, box.y + box.h]  // horizontal edges
  };
}

function collectSnapTargets(excludeKey) {
  const targets = {
    v: [0, 1], // stage vertical edges
    h: [0, 1]  // stage horizontal edges
  };

  Object.keys(currentLayout).forEach(k => {
    if (k === excludeKey) return;
    const e = getBoxEdges(currentLayout[k]);
    targets.v.push(e.left, e.right);
    targets.h.push(e.top, e.bottom);
  });

  return targets;
}

function snapEdges(edges, targets, snap) {
  let dx = 0, dy = 0;
  let minDX = snap, minDY = snap;

  // vertical
  [edges.left, edges.right].forEach(a => {
    targets.v.forEach(b => {
      const d = b - a;
      if (Math.abs(d) < minDX) {
        minDX = Math.abs(d);
        dx = d;
      }
    });
  });

  // horizontal
  [edges.top, edges.bottom].forEach(a => {
    targets.h.forEach(b => {
      const d = b - a;
      if (Math.abs(d) < minDY) {
        minDY = Math.abs(d);
        dy = d;
      }
    });
  });

  return { dx, dy };
}

function snapValue(value, target, snap) {
  const d = target - value;
  if (Math.abs(d) < snap) return target;
  return value;
}


function getAudioDurationMs(audioEl, fallbackMs = 1200) {
  if (!audioEl) return fallbackMs;

  // duration is available and valid
  if (!isNaN(audioEl.duration) && audioEl.duration > 0) {
    return audioEl.duration * 1000;
  }

  // fallback (mobile / slow load safety)
  return fallbackMs;
}

function snapMove(key, x, y) {
  const box = currentLayout[key];
  const snap = SNAP_RATIO;

  const edges = {
    left: x,
    right: x + box.w,
    top: y,
    bottom: y + box.h
  };

  const targets = collectSnapTargets(key);
  const { dx, dy } = snapEdges(edges, targets, snap);

  return {
    x: x + dx * SNAP_RESIST,
    y: y + dy * SNAP_RESIST
  };
}




function applyResizeSnapping(key, box) {
  const snap = SNAP_RATIO;

  Object.keys(currentLayout).forEach(k => {
    if (k === key) return;
    const o = currentLayout[k];

    // width snap
    if (Math.abs(box.w - o.w) < snap) {
      box.w = o.w;
    }

    // height snap
    if (Math.abs(box.h - o.h) < snap) {
      box.h = o.h;
    }

    // right edge snap
    if (Math.abs((box.x + box.w) - (o.x + o.w)) < snap) {
      box.w = (o.x + o.w) - box.x;
    }

    // bottom edge snap
    if (Math.abs((box.y + box.h) - (o.y + o.h)) < snap) {
      box.h = (o.y + o.h) - box.y;
    }
  });

  // stage edges
  if (Math.abs(box.x + box.w - 1) < snap) box.w = 1 - box.x;
  if (Math.abs(box.y + box.h - 1) < snap) box.h = 1 - box.y;
}


function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}


function show(screen) {
  [loginScreen, cameraCheckScreen, layoutSetupScreen, boothScreen].forEach(s => s.classList.add("hidden"));
  screen.classList.remove("hidden");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function doFlash() {
  flash.classList.add("on");
  setTimeout(() => flash.classList.remove("on"), 150);
}

function playSafe(audioEl) {
  try { audioEl.currentTime = 0; audioEl.play(); } catch {}
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function structuredCloneSafe(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* ===========================
   Storage (per profile)
=========================== */
function loadLayout(profileId) {
  const raw = localStorage.getItem(`layout:${profileId}`);
  return raw ? JSON.parse(raw) : structuredCloneSafe(DEFAULT_LAYOUT);
}

function saveLayout(profileId, layout) {
  try {
    localStorage.setItem(`layout:${profileId}`, JSON.stringify(layout));
  } catch {
    // ignore (private mode/quota)
  }
}

/* ===========================
   Profiles
=========================== */
function loadProfiles() {
  profileSelect.innerHTML = "";
  for (const key in PROFILES) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = PROFILES[key].name;
    profileSelect.appendChild(opt);
  }
}

async function applyProfile(profileId) {
  const profile = PROFILES[profileId] || PROFILES.guest;
  currentProfileId = profile.id;
  localStorage.setItem("profile", currentProfileId);

  // stage backgrounds
  stage.style.backgroundImage = `url("${profile.background}")`;
  stageBooth.style.backgroundImage = `url("${profile.background}")`;

  // safe padding for preview placement (UI only)
  stage.querySelector(".safe").style.setProperty("--safe-padding", profile.safePadding || "70px");
  stageBooth.querySelector(".safe").style.setProperty("--safe-padding", profile.safePadding || "70px");

  // set aspect ratio from real image so stage matches background shape
  await setStageAspectFromImage(profile.background, stage);
  await setStageAspectFromImage(profile.background, stageBooth);

  // load layout for this profile
  currentLayout = loadLayout(currentProfileId);
  applyLayoutToSetup(currentLayout);
  applyLayoutToBooth(currentLayout);

  // clear frozen photos
  frozenPhotos.left = frozenPhotos.rt = frozenPhotos.rb = null;
}

/* sets CSS --bg-ar for the stage based on image natural size */
function setStageAspectFromImage(src, stageEl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      stageEl.style.setProperty("--bg-ar", `${img.naturalWidth} / ${img.naturalHeight}`);
      resolve();
    };
    img.onerror = () => resolve(); // don’t block
    img.src = src;
  });
}

/* ===========================
   Camera lifecycle
=========================== */
async function startCamera(videoElements) {
  if (!stream) {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
  videoElements.forEach(v => {
    v.srcObject = stream;
    v.play().catch(() => {});
  });
}

function stopCamera() {
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
  stream = null;
}

/* ===========================
   Layout application (percent → CSS)
   Percentages are relative to SAFE box.
=========================== */
function applyLayoutToSetup(layout) {
  setFrameBox(frameLeft_setup, layout.left);
  setFrameBox(frameRT_setup, layout.rt);
  setFrameBox(frameRB_setup, layout.rb);
}

function applyLayoutToBooth(layout) {
  setFrameBox(frameLeft, layout.left);
  setFrameBox(frameRT, layout.rt);
  setFrameBox(frameRB, layout.rb);
}

function setFrameBox(frameEl, box) {
  frameEl.style.left = (box.x * 100) + "%";
  frameEl.style.top = (box.y * 100) + "%";
  frameEl.style.width = (box.w * 100) + "%";
  frameEl.style.height = (box.h * 100) + "%";
}

/* ===========================
   Dragging (Pointer events: mouse + touch)
=========================== */
function makeDraggable(frameEl, key) {
  frameEl.addEventListener("pointerdown", (e) => {

    // ❌ Do not drag when resizing
    if (e.target.classList.contains("resize-handle")) return;

    e.preventDefault();

    // If this frame is not selected → select it
    if (!selectedSetupFrames.includes(key)) {
      selectSetupFrame(key, e.shiftKey);
    }

    const safeRect = stage.querySelector(".safe").getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;

    // Snapshot starting positions of ALL selected frames
    const startBoxes = {};
    selectedSetupFrames.forEach(k => {
      startBoxes[k] = { ...currentLayout[k] };
    });

    let dragging = false;
    pointerWasDragging = false;

    function onMove(ev) {
      const dxPx = ev.clientX - startX;
      const dyPx = ev.clientY - startY;

      // Start drag only after small threshold
      if (!dragging) {
        if (Math.abs(dxPx) < 4 && Math.abs(dyPx) < 4) return;
        dragging = true;
        pointerWasDragging = true;
        frameEl.setPointerCapture(e.pointerId);
      }

      const dx = dxPx / safeRect.width;
      const dy = dyPx / safeRect.height;

      // 🔥 MOVE ALL SELECTED FRAMES
      selectedSetupFrames.forEach(k => {
        const box = startBoxes[k];
        const w = box.w;
        const h = box.h;
        let tx = box.x + dx;
        let ty = box.y + dy;

        const snapped = snapMove(k, tx, ty);

        let nx = tx;

        //Object.keys(currentLayout).forEach(oKey => {
        //  if (oKey === k) return;
        //  const o = currentLayout[oKey];
        //
        //  // snap left → left
        //  nx = snapValue(nx, o.x, SNAP_RATIO);
        //
        //  // snap right → right
        //  nx = snapValue(nx + w, o.x + o.w, SNAP_RATIO) - w;
        //});
        
        currentLayout[k].x = clamp(nx, 0, 1 - w);

        currentLayout[k].y = clamp(snapped.y, 0, 1 - h);
      });

      applyLayoutToSetup(currentLayout);
    }

    function onUp() {
      pointerWasDragging = false;
      try { frameEl.releasePointerCapture(e.pointerId); } catch {}
      frameEl.removeEventListener("pointermove", onMove);
      frameEl.removeEventListener("pointerup", onUp);
      frameEl.removeEventListener("pointercancel", onUp);
    }

    frameEl.addEventListener("pointermove", onMove);
    frameEl.addEventListener("pointerup", onUp);
    frameEl.addEventListener("pointercancel", onUp);
  });
}

let selectedSetupFrames = [];

/* attach dragging */
makeDraggable(frameLeft_setup, "left");
makeDraggable(frameRT_setup, "rt");
makeDraggable(frameRB_setup, "rb");

/* attach touch selection (mobile-friendly) */
addTouchSelection(frameLeft_setup, "left");
addTouchSelection(frameRT_setup, "rt");
addTouchSelection(frameRB_setup, "rb");


const SETUP_FRAMES = {
  left: frameLeft_setup,
  rt: frameRT_setup,
  rb: frameRB_setup
};

function updateSetupSelectionUI() {
  Object.entries(SETUP_FRAMES).forEach(([key, el]) => {
    el.classList.toggle("selected", selectedSetupFrames.includes(key));
  });
}

function selectSetupFrame(key, additive) {
  if (!additive) selectedSetupFrames = [];
  if (!selectedSetupFrames.includes(key)) {
    selectedSetupFrames.push(key);
  }
  updateSetupSelectionUI();
}

function clearSetupSelection() {
  selectedSetupFrames = [];
  updateSetupSelectionUI();
}

// Object.entries(SETUP_FRAMES).forEach(([key, el]) => {
//   el.addEventListener("pointerdown", e => {
//     e.stopPropagation();
//     selectSetupFrame(key, e.shiftKey);
//   });
// });

const safeEl = stage.querySelector(".safe");

safeEl.addEventListener("pointerdown", e => {
  // Only clear if:
  // 1) clicking empty safe area
  // 2) not starting a drag
  if (e.target === safeEl && !pointerWasDragging) {
    clearSetupSelection();
  }
});



function getSetupGroupBounds(keys) {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  keys.forEach(k => {
    const f = currentLayout[k];
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + f.w);
    maxY = Math.max(maxY, f.y + f.h);
  });

  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY
  };
}

function centerSetupGroupBoth() {
  if (!selectedSetupFrames.length) return;

  // 1 frame → center that frame
  if (selectedSetupFrames.length === 1) {
    const k = selectedSetupFrames[0];
    currentLayout[k].x = 0.5 - currentLayout[k].w / 2;
    currentLayout[k].y = 0.5 - currentLayout[k].h / 2;
    applyLayoutToSetup(currentLayout);
    return;
  }

  // 2+ frames → center group
  const box = getSetupGroupBounds(selectedSetupFrames);
  const dx = 0.5 - box.w / 2 - box.x;
  const dy = 0.5 - box.h / 2 - box.y;

  selectedSetupFrames.forEach(k => {
    currentLayout[k].x += dx;
    currentLayout[k].y += dy;
  });

  applyLayoutToSetup(currentLayout);
}

function makeResizable(frameEl, key) {
  const handles = frameEl.querySelectorAll(".resize-handle");

  handles.forEach(handle => {
    handle.addEventListener("pointerdown", e => {
      e.stopPropagation();
      e.preventDefault();
      pointerWasDragging = true;
      handle.setPointerCapture(e.pointerId);
      

      const safeRect = stage.querySelector(".safe").getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;

      const box = currentLayout[key];
      const orig = { ...box };

      const anchor = {
        right: orig.x + orig.w,
        bottom: orig.y + orig.h
      };


      function onMove(ev) {
        const dx = (ev.clientX - startX) / safeRect.width;
        const dy = (ev.clientY - startY) / safeRect.height;
      
        // reset to original each move
        box.x = orig.x;
        box.y = orig.y;
        box.w = orig.w;
        box.h = orig.h;
      
        const targets = collectSnapTargets(key);
        const snap = SNAP_RATIO;
      
        // LEFT edge (NW / SW)
        if (handle.classList.contains("nw") || handle.classList.contains("sw")) {
          let newLeft = orig.x + dx;
        
          const { dx: snapDX } = snapEdges({ left: newLeft }, targets, snap);
          newLeft += snapDX * SNAP_RESIST;
        
          box.x = clamp(newLeft, 0, orig.x + orig.w - 0.05);
          box.w = anchor.right - box.x;
        }
      
        // RIGHT edge (NE / SE)
        if (handle.classList.contains("ne") || handle.classList.contains("se")) {
          let newRight = orig.x + orig.w + dx;
        
          const { dx: snapDX } = snapEdges({ left: newRight }, targets, snap);
          newRight += snapDX * SNAP_RESIST;
        
          box.w = clamp(newRight - orig.x, 0.05, 1);
        }
      
        // TOP edge (NW / NE)
        if (handle.classList.contains("nw") || handle.classList.contains("ne")) {
          let newTop = orig.y + dy;
        
          const { dy: snapDY } = snapEdges({ top: newTop }, targets, snap);
          newTop += snapDY * SNAP_RESIST;
        
          box.y = clamp(newTop, 0, orig.y + orig.h - 0.05);
          box.h = anchor.bottom - box.y;
        }
      
        // BOTTOM edge (SW / SE)
        if (handle.classList.contains("sw") || handle.classList.contains("se")) {
          let newBottom = orig.y + orig.h + dy;
        
          const { dy: snapDY } = snapEdges({ top: newBottom }, targets, snap);
          newBottom += snapDY * SNAP_RESIST;
        
          box.h = clamp(newBottom - orig.y, 0.05, 1);
        }
      
        applyLayoutToSetup(currentLayout);
      }


      function onUp() {
        pointerWasDragging = false;
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
      }

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);

    });
  });
}

makeResizable(frameLeft_setup, "left");
makeResizable(frameRT_setup, "rt");
makeResizable(frameRB_setup, "rb");

function alignSetupLeft() {
  if (selectedSetupFrames.length < 2) return;
  const ref = currentLayout[selectedSetupFrames[0]];

  selectedSetupFrames.slice(1).forEach(k => {
    currentLayout[k].x = ref.x;
  });

  applyLayoutToSetup(currentLayout);
}


/* ===========================
   Booth frame state
=========================== */
function setFrameState(frame, state) {
  const video = frame.querySelector("video.cam");
  const img = frame.querySelector("img.photo");
  const cd = frame.querySelector(".countdown");

  if (state === "idle") {
    frame.classList.remove("active");
    cd.classList.add("hidden");
    cd.textContent = "";
    if (video) video.classList.add("hidden");
  
    const veil = frame.querySelector(".whiteveil");
  
    const isFrozen =
      (frame === frameLeft && frameFrozen.left) ||
      (frame === frameRT && frameFrozen.rt) ||
      (frame === frameRB && frameFrozen.rb);
  
    if (!isFrozen) {
      if (img) img.classList.add("hidden");
      if (veil) veil.style.opacity = "1"; // white only if not frozen
    }
  }



  if (state === "counting") {
    frame.classList.add("active");
    if (video) video.classList.remove("hidden");
    if (img) img.classList.add("hidden");
    cd.classList.remove("hidden");
  }

  if (state === "frozen") {
    frame.classList.remove("active");
    cd.classList.add("hidden");
    cd.textContent = "";
  
    if (video) video.classList.add("hidden");
    if (img) img.classList.remove("hidden");
  
    // 🔥 IMPORTANT: remove white veil permanently
    const veil = frame.querySelector(".whiteveil");
    if (veil) veil.style.opacity = "0";
  }

}

/* ===========================
   Capture flow
   - warmup already handled outside
=========================== */
async function takePhotos() {
  // all idle (white)

  for (const frame of shotOrder) {
    setFrameState(frame, "counting");

    const cd = frame.querySelector(".countdown");
    const video = frame.querySelector("video.cam");
    const imgEl = frame.querySelector("img.photo");

    // get real beep duration
    const beepDelay = getAudioDurationMs(beepSound, 600);

    // countdown 5 → 1
    for (let i = 5; i >= 1; i--) {
      cd.textContent = String(i);
      playSafe(beepSound);
      await sleep(beepDelay);
    }

    // remove "1" BEFORE shutter
    cd.textContent = "";
    await sleep(120); // short visual pause


    // capture current video frame (mirrored)
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;

    workCanvas.width = vw;
    workCanvas.height = vh;

    workCtx.save();
    workCtx.clearRect(0, 0, vw, vh);
    workCtx.translate(vw, 0);
    workCtx.scale(-1, 1);
    workCtx.drawImage(video, 0, 0, vw, vh);
    workCtx.restore();

    /* 🔊 shutter EXACTLY at capture */
    playSafe(shutterSound);
    /* ⚡ flash immediately after sound */
    doFlash();

    imgEl.src = workCanvas.toDataURL("image/png");

    // ⏳ WAIT for shutter sound to finish
    const shutterDelay = getAudioDurationMs(shutterSound, 1200);
    await sleep(shutterDelay);

    

    // store Image object (ensure loaded)
    const stored = new Image();
    stored.onload = () => {
      if (frame === frameLeft) frozenPhotos.left = stored;
      if (frame === frameRT) frozenPhotos.rt = stored;
      if (frame === frameRB) frozenPhotos.rb = stored;
    };
    stored.src = imgEl.src;

    if (frame === frameLeft) frameFrozen.left = true;
    if (frame === frameRT) frameFrozen.rt = true;
    if (frame === frameRB) frameFrozen.rb = true;


    setFrameState(frame, "frozen");
  }
}

/* ===========================
   Manual render export
   IMPORTANT: we do NOT rely on layout definitions.
   We render based on actual DOM frame positions on stageBooth,
   mapped to background pixel coordinates.
=========================== */
async function exportJpg() {
  await new Promise(r => requestAnimationFrame(r));

  const profile = PROFILES[currentProfileId] || PROFILES.guest;
  if (!profile) return;

  if (!frozenPhotos.left || !frozenPhotos.rt || !frozenPhotos.rb) {
    alert("Photos not ready yet.");
    setFrameBordersVisible(true);
    return;
  }

  const bg = await loadImage(profile.background);

  const BW = bg.naturalWidth;
  const BH = bg.naturalHeight;

  const out = document.createElement("canvas");
  out.width = BW;
  out.height = BH;
  const ctx = out.getContext("2d");

  ctx.drawImage(bg, 0, 0, BW, BH);

  const stageRect = stageBooth.getBoundingClientRect();

  const rectLeft = frameLeft.getBoundingClientRect();
  const rectRT   = frameRT.getBoundingClientRect();
  const rectRB   = frameRB.getBoundingClientRect();

  function mapRect(r) {
    return {
      x: (r.left - stageRect.left) / stageRect.width * BW,
      y: (r.top  - stageRect.top ) / stageRect.height * BH,
      w: r.width  / stageRect.width  * BW,
      h: r.height / stageRect.height * BH
    };
  }

  drawCoverRounded(ctx, frozenPhotos.left, mapRect(rectLeft),  Math.round(BW * 0.015));
  drawCoverRounded(ctx, frozenPhotos.rt,   mapRect(rectRT),    Math.round(BW * 0.015));
  drawCoverRounded(ctx, frozenPhotos.rb,   mapRect(rectRB),    Math.round(BW * 0.015));

  const a = document.createElement("a");
  a.download = "photobooth.jpg";
  a.href = out.toDataURL("image/jpeg", 0.95);
  a.click();

  // ✅ restore ONLY at the very end
  setFrameBordersVisible(true);
}


function drawCoverRounded(ctx, img, box, r) {
  if (!img || !img.naturalWidth || !img.naturalHeight) return;

  const { x, y, w, h } = box;

  // object-fit: cover crop
  const imgAR = img.naturalWidth / img.naturalHeight;
  const frameAR = w / h;

  let sx, sy, sw, sh;

  if (imgAR > frameAR) {
    sh = img.naturalHeight;
    sw = sh * frameAR;
    sx = (img.naturalWidth - sw) / 2;
    sy = 0;
  } else {
    sw = img.naturalWidth;
    sh = sw / frameAR;
    sx = 0;
    sy = (img.naturalHeight - sh) / 2;
  }

  ctx.save();
  roundRectClip(ctx, x, y, w, h, r);
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
}

function roundRectClip(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.clip();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("Failed to load image: " + src));
    im.src = src;
  });
}

/* ===========================
   Buttons / Flow
=========================== */
document.getElementById("loginBtn").onclick = async () => {
  const selected = profileSelect.value;
  await applyProfile(selected);
  show(cameraCheckScreen);
  await startCamera([checkVideo]);
};

document.getElementById("backToLoginBtn").onclick = () => {
  stopCamera();
  localStorage.removeItem("profile");
  show(loginScreen);
};

document.getElementById("okCameraBtn").onclick = () => {
  stopCamera();
  show(layoutSetupScreen);
};

document.getElementById("resetLayoutBtn").onclick = () => {
  if (!currentProfileId) return;
  currentLayout = structuredCloneSafe(DEFAULT_LAYOUT);
  applyLayoutToSetup(currentLayout);
};

document.getElementById("changeUserBtn1").onclick =
document.getElementById("changeUserBtn2").onclick = () => {
  stopCamera();
  localStorage.removeItem("profile");
  location.reload();
};

document.getElementById("startCaptureBtn").onclick = async () => {
  if (!currentProfileId) return;

  // save layout per profile
  saveLayout(currentProfileId, currentLayout);

  // apply same layout to booth stage
  applyLayoutToBooth(currentLayout);

  show(boothScreen);

  // start camera ONLY here (on booth frames)
  const boothVideos = shotOrder.map(f => f.querySelector("video.cam"));
  await startCamera(boothVideos);

  // 1s warm-up before first countdown
  await sleep(1000);

  await takePhotos();

  // stop camera immediately after 3rd freeze
  stopCamera();
};

document.getElementById("retakeBtn").onclick = async () => {
  frozenPhotos.left = frozenPhotos.rt = frozenPhotos.rb = null;

  shotOrder.forEach(f => {
    const img = f.querySelector("img.photo");
    img.classList.add("hidden");
    setFrameState(f, "idle");
  });

  const boothVideos = shotOrder.map(f => f.querySelector("video.cam"));

  frameFrozen.left = false;
  frameFrozen.rt = false;
  frameFrozen.rb = false;


  await startCamera(boothVideos);

  await sleep(600);
  await takePhotos();
  stopCamera();
};

document.getElementById("saveBtn").onclick = exportJpg;

/* ===========================
   Init
=========================== */
loadProfiles();

(async function init() {
  const saved = localStorage.getItem("profile");
  if (saved && PROFILES[saved]) {
    await applyProfile(saved);
    show(cameraCheckScreen);
    await startCamera([checkVideo]);
  } else {
    show(loginScreen);
  }
})();
