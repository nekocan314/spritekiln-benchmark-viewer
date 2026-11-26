import './style.css';
import type {
  BgTheme,
  Direction,
  LoadedPreset,
  PresetConfig,
  RenderMode,
  SpriteKilnAtlasJson,
  SpriteKilnDirAnim,
} from './types';

const DIRECTIONS: Direction[] = ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw'];

const PRESETS: PresetConfig[] = [
  {
    id: 'preset_a_light_ponytail_sword',
    label: 'A: 軽装・ポニテ・剣盾',
    shortLabel: 'A 軽装剣盾',
    description: '軽装 + ポニーテール + 片手剣＆盾',
  },
  {
    id: 'preset_b_light_short_staff',
    label: 'B: 軽装・ショート・発光杖',
    shortLabel: 'B 軽装杖',
    description: '軽装 + ショート + 発光クリスタル杖',
  },
  {
    id: 'preset_c_heavy_helm_sword',
    label: 'C: 重装兜・剣盾',
    shortLabel: 'C 重装騎士',
    description: '重装プレート + 兜(髪排他) + 剣盾',
  },
  {
    id: 'preset_d_robe_long_staff',
    label: 'D: ローブ・ロング・発光杖',
    shortLabel: 'D 魔術師',
    description: 'ローブ + 魔法帽子 + ロング + 発光杖',
  },
  {
    id: 'preset_e_base_hair_compare',
    label: 'E: 素体＋3髪型比較',
    shortLabel: 'E 髪型比較',
    description: '素体 + ショート / ポニテ / ロング 静止8方向',
    isHairCompare: true,
  },
];

const ACTION_LABELS: Record<string, string> = {
  idle: '待機',
  walk: '歩行',
  attack: '攻撃',
  dodge: '回避',
  compare: '髪型比較',
};

// State
const cache = new Map<string, LoadedPreset>();
let currentPreset: LoadedPreset | null = null;
let currentPresetIdx = 0;
let currentDirIdx = 0; // 0 = 's'
let currentAnim = 'idle';
let currentFrameIdx = 0;
let frameElapsedMs = 0;
let isPlaying = true;
let playbackSpeed = 1.0;
let renderMode: RenderMode = 'color';
let bgTheme: BgTheme = 'dark';

// Point light state (normalized 0..1 inside the 64x64 sprite box)
let lightPos = { x: 0.25, y: 0.25 };

// DOM refs
const canvas = document.getElementById('spriteCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
const stageWrap = document.getElementById('stageWrap') as HTMLElement;
const presetStrip = document.getElementById('presetStrip') as HTMLElement;
const actionRow = document.getElementById('actionRow') as HTMLElement;
const dirRow = document.getElementById('dirRow') as HTMLElement;
const dirBadge = document.getElementById('dirBadge') as HTMLElement;
const frameBadge = document.getElementById('frameBadge') as HTMLElement;
const eventBadge = document.getElementById('eventBadge') as HTMLElement;
const stageHint = document.getElementById('stageHint') as HTMLElement;
const timelineBar = document.getElementById('timelineBar') as HTMLElement;
const hairCompareBar = document.getElementById('hairCompareBar') as HTMLElement;
const btnPlayPause = document.getElementById('btnPlayPause') as HTMLButtonElement;
const btnPrev = document.getElementById('btnPrev') as HTMLButtonElement;
const btnNext = document.getElementById('btnNext') as HTMLButtonElement;

// Offscreen buffers for 64x64 pixel-perfect dynamic normal+emissive lighting
const offColor = document.createElement('canvas');
const offNormal = document.createElement('canvas');
const offEmissive = document.createElement('canvas');
const offLit = document.createElement('canvas');

let offSize = 64;
function ensureOffscreen(size: number): void {
  if (offSize === size && offColor.width === size) return;
  offSize = size;
  for (const c of [offColor, offNormal, offEmissive, offLit]) {
    c.width = size;
    c.height = size;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

async function loadPreset(config: PresetConfig): Promise<LoadedPreset> {
  const cached = cache.get(config.id);
  if (cached) return cached;

  const base = `./assets/sprites/${config.id}`;
  const res = await fetch(`${base}/${config.id}.json`);
  if (!res.ok) throw new Error(`Failed to load JSON for ${config.id}`);
  const json = (await res.json()) as SpriteKilnAtlasJson;

  const [colorImg, normalImg, emissiveImg] = await Promise.all([
    loadImage(`${base}/${config.id}.png`),
    loadImage(`${base}/${json.spritekiln.normal_map}`),
    loadImage(`${base}/${json.spritekiln.emissive_map}`),
  ]);

  const loaded: LoadedPreset = { config, json, colorImg, normalImg, emissiveImg };
  cache.set(config.id, loaded);
  return loaded;
}

function getCurrentDirAnim(): SpriteKilnDirAnim | null {
  if (!currentPreset) return null;
  const animEntry = currentPreset.json.spritekiln.animations[currentAnim];
  if (!animEntry) return null;
  const dir = DIRECTIONS[currentDirIdx];
  return animEntry.directions[dir] ?? null;
}

function buildPresetButtons(): void {
  presetStrip.innerHTML = '';
  PRESETS.forEach((p, idx) => {
    const btn = document.createElement('button');
    btn.className = `preset-btn${idx === currentPresetIdx ? ' active' : ''}`;
    btn.textContent = p.shortLabel;
    btn.title = p.label;
    btn.addEventListener('click', () => {
      void selectPreset(idx);
    });
    presetStrip.appendChild(btn);
  });
}

function buildDirButtons(): void {
  dirRow.innerHTML = '';
  DIRECTIONS.forEach((d, idx) => {
    const btn = document.createElement('button');
    btn.className = `dir-btn${idx === currentDirIdx ? ' active' : ''}`;
    btn.textContent = d.toUpperCase();
    btn.addEventListener('click', () => {
      currentDirIdx = idx;
      syncDirUI();
      renderFrame();
    });
    dirRow.appendChild(btn);
  });
}

function buildActionButtons(): void {
  actionRow.innerHTML = '';
  if (!currentPreset) return;
  const anims = Object.keys(currentPreset.json.spritekiln.animations);
  anims.forEach((name) => {
    const btn = document.createElement('button');
    btn.className = `action-btn${name === currentAnim ? ' active' : ''}`;
    btn.textContent = ACTION_LABELS[name] ?? name;
    btn.addEventListener('click', () => {
      selectAnim(name);
    });
    actionRow.appendChild(btn);
  });
}

function buildTimeline(): void {
  timelineBar.innerHTML = '';
  const dirAnim = getCurrentDirAnim();
  if (!dirAnim) return;
  const events = dirAnim.events ?? {};
  dirAnim.frames.forEach((_, idx) => {
    const seg = document.createElement('div');
    const evList = events[String(idx)] ?? [];
    const hasHit = evList.includes('hit');
    const hasEv = evList.length > 0;
    seg.className = `tl-seg${idx === currentFrameIdx ? ' active' : ''}${hasEv ? ' has-event' : ''}${hasHit ? ' has-hit' : ''}`;
    timelineBar.appendChild(seg);
  });
}

function syncDirUI(): void {
  const dir = DIRECTIONS[currentDirIdx];
  dirBadge.textContent = `DIR: ${dir.toUpperCase()}`;
  Array.from(dirRow.children).forEach((el, idx) => {
    el.classList.toggle('active', idx === currentDirIdx);
  });
}

function syncPlaybackUI(): void {
  btnPlayPause.textContent = isPlaying ? '⏸ 一時停止' : '▶ 再生';
}

function syncHairCompareUI(): void {
  const show = Boolean(currentPreset?.config.isHairCompare);
  hairCompareBar.hidden = !show;
  if (!show) return;
  hairCompareBar.querySelectorAll<HTMLButtonElement>('.hair-btn').forEach((btn) => {
    const f = Number(btn.dataset.hairFrame);
    btn.classList.toggle('active', f === currentFrameIdx);
  });
}

function updateFrameTelemetry(): void {
  const dirAnim = getCurrentDirAnim();
  if (!dirAnim) return;
  const total = dirAnim.frames.length;
  const dur = dirAnim.durations[currentFrameIdx] ?? 100;
  frameBadge.textContent = `F ${currentFrameIdx + 1}/${total} (${dur}ms)`;

  const evs = dirAnim.events?.[String(currentFrameIdx)] ?? [];
  if (evs.length > 0) {
    const label = evs.join(', ').toUpperCase();
    eventBadge.hidden = false;
    eventBadge.textContent = `⚡ ${label}`;
    eventBadge.className = 'badge event-badge';
    if (evs.includes('windup')) {
      eventBadge.classList.add('event-windup');
    } else if (evs.includes('step_l') || evs.includes('step_r') || evs.includes('land')) {
      eventBadge.classList.add('event-step');
    }
  } else {
    eventBadge.hidden = true;
  }

  Array.from(timelineBar.children).forEach((el, idx) => {
    el.classList.toggle('active', idx === currentFrameIdx);
  });
  syncHairCompareUI();
}

function selectAnim(name: string): void {
  currentAnim = name;
  currentFrameIdx = 0;
  frameElapsedMs = 0;
  // For one-shot actions (attack/dodge), restart playback automatically when tapped
  if (!currentPreset?.config.isHairCompare) {
    isPlaying = true;
    syncPlaybackUI();
  }
  Array.from(actionRow.children).forEach((el, idx) => {
    const animName = Object.keys(currentPreset!.json.spritekiln.animations)[idx];
    el.classList.toggle('active', animName === currentAnim);
  });
  buildTimeline();
  updateFrameTelemetry();
  renderFrame();
}

async function selectPreset(idx: number): Promise<void> {
  currentPresetIdx = idx;
  Array.from(presetStrip.children).forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });

  try {
    const loaded = await loadPreset(PRESETS[idx]);
    currentPreset = loaded;
    ensureOffscreen(loaded.json.spritekiln.frame_size);
    const anims = Object.keys(loaded.json.spritekiln.animations);
    if (!anims.includes(currentAnim)) {
      currentAnim = anims[0];
    }
    currentFrameIdx = 0;
    frameElapsedMs = 0;
    if (loaded.config.isHairCompare) {
      isPlaying = false;
      syncPlaybackUI();
    }
    buildActionButtons();
    buildTimeline();
    syncDirUI();
    updateFrameTelemetry();
    renderFrame();
  } catch (err) {
    console.error(err);
    stageHint.textContent = 'アセット読込エラー (assets/sprites を確認)';
  }
}

function stepFrame(delta: number): void {
  const dirAnim = getCurrentDirAnim();
  if (!dirAnim) return;
  const total = dirAnim.frames.length;
  isPlaying = false;
  syncPlaybackUI();
  currentFrameIdx = (currentFrameIdx + delta + total) % total;
  frameElapsedMs = 0;
  updateFrameTelemetry();
  renderFrame();
}

function renderDynamicLit(frameRect: { x: number; y: number; w: number; h: number }): void {
  if (!currentPreset) return;
  const { w, h, x, y } = frameRect;
  ensureOffscreen(w);

  const cCtx = offColor.getContext('2d', { willReadFrequently: true })!;
  const nCtx = offNormal.getContext('2d', { willReadFrequently: true })!;
  const eCtx = offEmissive.getContext('2d', { willReadFrequently: true })!;
  const outCtx = offLit.getContext('2d')!;

  cCtx.clearRect(0, 0, w, h);
  nCtx.clearRect(0, 0, w, h);
  eCtx.clearRect(0, 0, w, h);

  cCtx.drawImage(currentPreset.colorImg, x, y, w, h, 0, 0, w, h);
  nCtx.drawImage(currentPreset.normalImg, x, y, w, h, 0, 0, w, h);
  eCtx.drawImage(currentPreset.emissiveImg, x, y, w, h, 0, 0, w, h);

  const cData = cCtx.getImageData(0, 0, w, h).data;
  const nData = nCtx.getImageData(0, 0, w, h).data;
  const eData = eCtx.getImageData(0, 0, w, h).data;
  const outImg = outCtx.createImageData(w, h);
  const out = outImg.data;

  const lx = lightPos.x * w;
  const ly = lightPos.y * h;
  const lz = w * 0.42;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      const alpha = cData[i + 3];
      if (alpha === 0) continue;

      // Decode tangent-space normal [0..255] -> [-1..1]
      const nx = (nData[i] / 255) * 2 - 1;
      const ny = -((nData[i + 1] / 255) * 2 - 1); // flip Y to screen coords
      const nz = Math.max(0.05, (nData[i + 2] / 255) * 2 - 1);

      const dx = lx - px;
      const dy = ly - py;
      const dz = lz;
      const dist = Math.hypot(dx, dy, dz) || 1;
      const invD = 1 / dist;

      const ndl = Math.max(0, (nx * dx + ny * dy + nz * dz) * invD);
      const atten = 1 / (1 + (dist / (w * 0.65)) ** 2);

      // Quantize lighting slightly for crisp pixel-art feel
      const diffuse = 0.28 + 1.45 * ndl * atten;
      const spec = Math.pow(Math.max(0, (nz + (nz * dz * invD)) * 0.5), 14) * 0.45 * atten;

      const er = eData[i];
      const eg = eData[i + 1];
      const eb = eData[i + 2];
      const ea = eData[i + 3] / 255;

      // Warm point-light tint + full emissive bypass
      const rLit = cData[i] * diffuse * 1.06 + spec * 255;
      const gLit = cData[i + 1] * diffuse * 0.99 + spec * 245;
      const bLit = cData[i + 2] * diffuse * 0.90 + spec * 215;

      out[i] = Math.min(255, Math.round(rLit * (1 - ea) + er * 1.25 * ea + er * 0.35 * ea));
      out[i + 1] = Math.min(255, Math.round(gLit * (1 - ea) + eg * 1.25 * ea + eg * 0.35 * ea));
      out[i + 2] = Math.min(255, Math.round(bLit * (1 - ea) + eb * 1.25 * ea + eb * 0.35 * ea));
      out[i + 3] = alpha;
    }
  }

  outCtx.putImageData(outImg, 0, 0);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(offLit, 0, 0, w, h, 0, 0, canvas.width, canvas.height);

  // Draw subtle emissive bloom halo & interactive point-light orb indicator
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.filter = 'blur(8px)';
  ctx.globalAlpha = 0.7;
  ctx.drawImage(offEmissive, 0, 0, w, h, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  const cx = lightPos.x * canvas.width;
  const cy = lightPos.y * canvas.height;
  const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 34);
  grad.addColorStop(0, 'rgba(255, 240, 180, 0.95)');
  grad.addColorStop(0.35, 'rgba(255, 195, 95, 0.42)');
  grad.addColorStop(1, 'rgba(255, 195, 95, 0)');
  ctx.save();
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function renderFrame(): void {
  if (!currentPreset) return;
  const dirAnim = getCurrentDirAnim();
  if (!dirAnim) return;

  const frameName = dirAnim.frames[currentFrameIdx];
  const entry = currentPreset.json.frames[frameName];
  if (!entry) return;

  const { x, y, w, h } = entry.frame;
  ctx.imageSmoothingEnabled = false;

  if (renderMode === 'lit') {
    renderDynamicLit(entry.frame);
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const srcImg =
    renderMode === 'normal'
      ? currentPreset.normalImg
      : renderMode === 'emissive'
        ? currentPreset.emissiveImg
        : currentPreset.colorImg;

  ctx.drawImage(srcImg, x, y, w, h, 0, 0, canvas.width, canvas.height);

  // In emissive mode, add a soft glow preview around active emissive pixels
  if (renderMode === 'emissive') {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.filter = 'blur(6px)';
    ctx.globalAlpha = 0.85;
    ctx.drawImage(srcImg, x, y, w, h, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
}

// Animation Loop
let lastTs = performance.now();
function tick(now: number): void {
  const dt = Math.min(100, now - lastTs);
  lastTs = now;

  if (isPlaying && currentPreset) {
    const dirAnim = getCurrentDirAnim();
    if (dirAnim && dirAnim.frames.length > 0) {
      const dur = dirAnim.durations[currentFrameIdx] ?? 100;
      frameElapsedMs += dt * playbackSpeed;
      if (frameElapsedMs >= dur) {
        frameElapsedMs -= dur;
        const nextIdx = currentFrameIdx + 1;
        if (nextIdx >= dirAnim.frames.length) {
          currentFrameIdx = 0; // loop continuously in viewer for easy inspection
        } else {
          currentFrameIdx = nextIdx;
        }
        updateFrameTelemetry();
        renderFrame();
      }
    }
  }
  requestAnimationFrame(tick);
}

// Touch & Mouse Gestures on Stage
let pointerActive = false;
let swipeStartX = 0;
let swipeStartDir = 0;

function updateLightFromClient(clientX: number, clientY: number): void {
  const rect = canvas.getBoundingClientRect();
  lightPos = {
    x: Math.max(0.05, Math.min(0.95, (clientX - rect.left) / rect.width)),
    y: Math.max(0.05, Math.min(0.95, (clientY - rect.top) / rect.height)),
  };
  renderFrame();
}

stageWrap.addEventListener('pointerdown', (e) => {
  pointerActive = true;
  stageWrap.setPointerCapture(e.pointerId);
  if (renderMode === 'lit') {
    updateLightFromClient(e.clientX, e.clientY);
  } else {
    swipeStartX = e.clientX;
    swipeStartDir = currentDirIdx;
  }
});

stageWrap.addEventListener('pointermove', (e) => {
  if (!pointerActive) return;
  if (renderMode === 'lit') {
    updateLightFromClient(e.clientX, e.clientY);
  } else {
    const dx = e.clientX - swipeStartX;
    const step = Math.round(dx / 36);
    const nextDir = ((swipeStartDir - step) % 8 + 8) % 8;
    if (nextDir !== currentDirIdx) {
      currentDirIdx = nextDir;
      syncDirUI();
      renderFrame();
    }
  }
});

const endPointer = () => {
  pointerActive = false;
};
stageWrap.addEventListener('pointerup', endPointer);
stageWrap.addEventListener('pointercancel', endPointer);

// Control Bindings
btnPlayPause.addEventListener('click', () => {
  isPlaying = !isPlaying;
  syncPlaybackUI();
});

btnPrev.addEventListener('click', () => stepFrame(-1));
btnNext.addEventListener('click', () => stepFrame(1));

document.querySelectorAll<HTMLButtonElement>('.speed-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    playbackSpeed = Number(btn.dataset.speed);
    document.querySelectorAll('.speed-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

document.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    renderMode = btn.dataset.mode as RenderMode;
    document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    stageHint.textContent =
      renderMode === 'lit'
        ? '✨ 画面タッチ／ドラッグで点光源を移動'
        : '◀ 左右スワイプで8方向回転 ▶';
    renderFrame();
  });
});

document.querySelectorAll<HTMLButtonElement>('[data-bg]').forEach((btn) => {
  btn.addEventListener('click', () => {
    bgTheme = btn.dataset.bg as BgTheme;
    document.querySelectorAll('[data-bg]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    stageWrap.classList.remove('bg-dark', 'bg-mid', 'bg-light');
    stageWrap.classList.add(`bg-${bgTheme}`);
  });
});

hairCompareBar.querySelectorAll<HTMLButtonElement>('.hair-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const f = Number(btn.dataset.hairFrame);
    isPlaying = false;
    syncPlaybackUI();
    currentFrameIdx = f;
    frameElapsedMs = 0;
    updateFrameTelemetry();
    renderFrame();
  });
});

// Boot
buildPresetButtons();
buildDirButtons();
syncPlaybackUI();
void selectPreset(0);
requestAnimationFrame(tick);
