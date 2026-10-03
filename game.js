(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const gameShell = document.querySelector('.game-shell');
  const avatar = new Image();
  avatar.decoding = 'async';
  avatar.src = './assets/nailong.webp?v=1';

  const audioUrls = {
    charge: './assets/charge.mp3?v=4',
    center: './assets/center.mp3?v=1',
    laugh: './assets/laugh.mp3?v=1'
  };
  const audioElements = { charge: null, center: null, laugh: null };
  const audioBufferPromises = { charge: null, center: null, laugh: null };
  let idleAudioScheduled = false;

  // Decode the short clips as soon as the page opens. Mobile browsers can take
  // a noticeable amount of time to start an HTMLAudioElement on its first tap;
  // Web Audio lets the actual press trigger a ready in-memory buffer instead.
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let audioContext = null;
  let audioBus = null;
  const audioBuffers = { charge: null, center: null, laugh: null };
  const audioSources = { charge: null, center: null, laugh: null };

  function getElementAudio(name) {
    if (audioElements[name]) return audioElements[name];
    const audio = new Audio();
    audio.preload = 'none';
    audio.src = audioUrls[name];
    audio.muted = muted;
    audioElements[name] = audio;
    return audio;
  }

  function setupAudioContext() {
    if (!AudioContextClass) return null;
    if (audioContext) return audioContext;
    try {
      audioContext = new AudioContextClass({ latencyHint: 'interactive' });
      audioBus = audioContext.createGain();
      audioBus.gain.value = 1;
      audioBus.connect(audioContext.destination);
    } catch (error) {
      audioContext = null;
      audioBus = null;
    }
    return audioContext;
  }

  function loadAudioBuffer(name) {
    const context = setupAudioContext();
    if (!context) return Promise.resolve(null);
    if (audioBuffers[name]) return Promise.resolve(audioBuffers[name]);
    if (audioBufferPromises[name]) return audioBufferPromises[name];
    audioBufferPromises[name] = fetch(audioUrls[name], { cache: 'force-cache' }).then(async response => {
      if (!response.ok) throw new Error('Audio request failed');
      audioBuffers[name] = await context.decodeAudioData(await response.arrayBuffer());
      return audioBuffers[name];
    }).catch(() => null);
    return audioBufferPromises[name];
  }

  function warmAudio() {
    const context = setupAudioContext();
    if (!context) return;
    if (context.state === 'suspended') context.resume().catch(() => {});
    // The charge clip is needed on the first press; the other two can wait.
    loadAudioBuffer('charge');
    if (!idleAudioScheduled) {
      idleAudioScheduled = true;
      setTimeout(() => {
        loadAudioBuffer('center');
        loadAudioBuffer('laugh');
      }, 2500);
    }
  }

  function stopDecodedSound(name) {
    const source = audioSources[name];
    if (!source) return;
    try { source.stop(); } catch (error) {}
    try { source.disconnect(); } catch (error) {}
    audioSources[name] = null;
  }

  function playDecodedSound(name) {
    const context = setupAudioContext();
    const buffer = audioBuffers[name];
    if (!context || !audioBus || !buffer || muted) return false;
    if (context.state === 'suspended') context.resume().catch(() => {});
    stopDecodedSound(name);
    try {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(audioBus);
      source.onended = () => {
        if (audioSources[name] === source) audioSources[name] = null;
        try { source.disconnect(); } catch (error) {}
      };
      source.start(0);
      audioSources[name] = source;
      return true;
    } catch (error) {
      return false;
    }
  }

  function playElementSound(name) {
    if (muted) return;
    const element = getElementAudio(name);
    element.currentTime = 0;
    element.play().catch(() => {});
  }

  function stopChargeSound() {
    stopDecodedSound('charge');
    if (audioElements.charge) audioElements.charge.pause();
  }

  const scoreNode = document.getElementById('score');
  const finalScoreNode = document.getElementById('final-score');
  const startScreen = document.getElementById('start-screen');
  const failScreen = document.getElementById('fail-screen');
  const startButton = document.getElementById('start-button');
  const restartButton = document.getElementById('restart-button');
  const homeButton = document.getElementById('home-button');
  const helpButton = document.getElementById('help-button');
  const settingsButton = document.getElementById('settings-button');
  const bestButton = document.getElementById('best-button');
  const shareButton = document.getElementById('share-button');
  const targetButton = document.getElementById('target-button');
  const recordLabel = document.getElementById('record-label');
  const toastNode = document.getElementById('toast');

  const DESIGN_W = 375;
  const DESIGN_H = 812;
  let W = DESIGN_W;
  let H = DESIGN_H;
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let viewScale = 1;
  let viewLeft = 0;
  let viewTop = 0;

  let mode = 'menu';
  let score = 0;
  let platforms = [];
  let currentIndex = 0;
  let player = { x: -76, z: 0, y: 0 };
  let camera = { x: -76, z: 0, targetX: -76, targetZ: 0 };
  let charge = null;
  let jump = null;
  let landing = null;
  let fall = null;
  let particles = [];
  let lastTime = performance.now();
  let failTimer = null;
  let centerHit = null;
  let toastTimer = null;
  let muted = false;
  let bestScore = Number(localStorage.getItem('naiwa-best-score') || 0);

  const MAX_CHARGE_MS = 1250;
  const MAX_JUMP = 322;
  const MIN_JUMP = 22;
  const CAMERA_EASE = 7.5;

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const smooth = (t) => t * t * (3 - 2 * t);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const centerRadius = platform => platform.size * 0.11;

  function showNotice(text) {
    toastNode.textContent = text;
    toastNode.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastNode.classList.remove('show'), 1300);
  }

  function setMuted(value) {
    muted = value;
    Object.values(audioElements).forEach(audio => { if (audio) audio.muted = muted; });
    if (audioBus) audioBus.gain.value = muted ? 0 : 1;
    settingsButton.textContent = muted ? '×' : '•••';
    settingsButton.setAttribute('aria-pressed', String(muted));
    showNotice(muted ? '声音已关闭' : '声音已开启');
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(320, rect.width);
    cssH = Math.max(500, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewScale = Math.min(cssW / DESIGN_W, cssH / DESIGN_H);
    viewLeft = (cssW - DESIGN_W * viewScale) / 2;
    viewTop = (cssH - DESIGN_H * viewScale) / 2;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    document.documentElement.style.setProperty('--game-left', viewLeft + 'px');
    document.documentElement.style.setProperty('--game-top', viewTop + 'px');
    document.documentElement.style.setProperty('--game-center-x', (viewLeft + DESIGN_W * viewScale / 2) + 'px');
    document.documentElement.style.setProperty('--game-width', (DESIGN_W * viewScale) + 'px');
    document.documentElement.style.setProperty('--game-height', (DESIGN_H * viewScale) + 'px');
    document.documentElement.style.setProperty('--game-scale', String(viewScale));
  }

  function resetGame() {
    score = 0;
    currentIndex = 0;
    mode = 'idle';
    charge = null;
    jump = null;
    landing = null;
    fall = null;
    particles = [];
    centerHit = null;
    stopChargeSound();
    stopDecodedSound('center');
    if (audioElements.center) {
      audioElements.center.pause();
      audioElements.center.currentTime = 0;
    }
    if (failTimer) clearTimeout(failTimer);
    failTimer = null;
    scoreNode.textContent = '0';
    failScreen.classList.add('hidden');
    gameShell.classList.remove('failed');

    platforms = [{ x: -76, z: 0, size: 155, style: 'green', special: null }];
    player = { x: platforms[0].x, z: platforms[0].z, y: 0 };
    camera = { x: 0, z: player.z, targetX: 0, targetZ: player.z };
    addPlatform(true);
    addPlatform(false);
  }

  function addPlatform(firstJump) {
    const previous = platforms[platforms.length - 1];
    const angle = firstJump ? 0 : rand(-0.62, 0.62);
    const distance = firstJump ? 230 : rand(188, 232);
    const dx = Math.sin(angle) * distance;
    const dz = Math.cos(angle) * distance;
    const stylePool = platforms.length < 4 ? ['green', 'gray', 'white'] : ['green', 'gray', 'white', 'red', 'lime'];
    let style = firstJump ? 'gray' : stylePool[Math.floor(Math.random() * stylePool.length)];
    let special = style === 'lime' ? 'face' : style === 'red' ? 'coin' : null;
    if (!firstJump && platforms.length >= 4 && Math.random() < .34) {
      const roll = Math.random();
      if (roll < .28) { special = 'cup'; style = 'white'; }
      else if (roll < .52) { special = 'drum'; style = 'gray'; }
      else if (roll < .76) { special = 'face'; style = 'lime'; }
      else { special = 'coin'; style = 'red'; }
    }
    platforms.push({
      x: clamp(previous.x + dx, -270, 270),
      z: previous.z + dz,
      size: rand(120, 150),
      style: style,
      special: special
    });
  }

  function beginCharge() {
    if (!startScreen.classList.contains('hidden')) return;
    if (mode !== 'idle') return;
    warmAudio();
    charge = { start: performance.now() };
    mode = 'charging';
    if (!playDecodedSound('charge')) playElementSound('charge');
  }

  function endCharge() {
    if (mode !== 'charging' || !charge) return;
    const elapsed = performance.now() - charge.start;
    const power = clamp(elapsed / MAX_CHARGE_MS, 0.08, 1.14);
    stopChargeSound();
    charge = null;
    startJump(power);
  }

  function startJump(power) {
    const current = platforms[currentIndex];
    const next = platforms[currentIndex + 1];
    const dx = next.x - player.x;
    const dz = next.z - player.z;
    const length = Math.max(1, Math.hypot(dx, dz));
    const dir = { x: dx / length, z: dz / length };
    const travel = MIN_JUMP + power * MAX_JUMP;
    const landingPoint = { x: player.x + dir.x * travel, z: player.z + dir.z * travel };
    jump = {
      started: performance.now(),
      duration: 520 + power * 125,
      power: power,
      from: { x: player.x, z: player.z, y: player.y },
      to: { x: landingPoint.x, z: landingPoint.z, y: 0 },
      target: next,
      fromPlatform: current,
      height: 58 + travel * 0.30
    };
    mode = 'jumping';
  }

  function sampleJump(now) {
    if (!jump) return null;
    const raw = clamp((now - jump.started) / jump.duration, 0, 1);
    const contactAt = .88;
    const t = clamp(raw / contactAt, 0, 1);
    const e = easeOut(t);
    return {
      raw: raw,
      t: t,
      x: lerp(jump.from.x, jump.to.x, e),
      z: lerp(jump.from.z, jump.to.z, e),
      y: raw >= contactAt ? 0 : lerp(jump.from.y, jump.to.y, e) + Math.sin(Math.PI * t) * jump.height
    };
  }

  function finishJump(sample) {
    if (!jump) return;
    const contact = sample || sampleJump(performance.now()) || { x: jump.to.x, z: jump.to.z };
    const landingPoint = { x: contact.x, z: contact.z };
    const target = jump.target;
    const localX = Math.abs(landingPoint.x - target.x);
    const localZ = Math.abs(landingPoint.z - target.z);
    const half = target.size * 0.48;
    const landed = localX <= half && localZ <= half;
    player = { x: landingPoint.x, z: landingPoint.z, y: 0 };
    if (!landed) {
      fail({ x: landingPoint.x, z: landingPoint.z, y: 0, vx: jump.to.x - jump.from.x, vz: jump.to.z - jump.from.z });
      return;
    }

    const centerDistance = Math.hypot(localX, localZ);
    const hitCenter = centerDistance <= centerRadius(target);
    const points = hitCenter ? 2 : 1;
    currentIndex += 1;
    score += points;
    scoreNode.textContent = String(score);
    if (hitCenter) {
      centerHit = { x: target.x, z: target.z, started: performance.now(), points };
      if (!playDecodedSound('center')) playElementSound('center');
      showNotice('中心命中  +' + points);
    }
    camera.targetX = 0;
    camera.targetZ = player.z;
    if (currentIndex + 2 >= platforms.length) addPlatform(false);
    burst(player.x, player.z, hitCenter ? '#f4cf4c' : '#f4a62f');
    landing = { started: performance.now(), duration: 300 };
    jump = null;
    mode = 'landing';
  }

  function fail(point) {
    if (mode === 'failed') return;
    mode = 'failed';
    if (audioElements.center) audioElements.center.pause();
    stopDecodedSound('center');
    stopChargeSound();
    charge = null;
    jump = null;
    fall = {
      x: point.x,
      z: point.z,
      y: point.y,
      vx: point.vx * 0.30,
      vz: point.vz * 0.30,
      vy: 20,
      started: performance.now()
    };
    if (!playDecodedSound('laugh')) playElementSound('laugh');
    finalScoreNode.textContent = String(score);
    const isRecord = score > bestScore;
    if (isRecord) {
      bestScore = score;
      localStorage.setItem('naiwa-best-score', String(bestScore));
      recordLabel.textContent = '新纪录';
    } else {
      recordLabel.textContent = '本局结束';
    }
    burst(point.x, point.z, '#f4cf4c');
    gameShell.classList.add('failed');
    failTimer = setTimeout(() => failScreen.classList.remove('hidden'), 640);
  }

  function burst(x, z, color) {
    for (let i = 0; i < 12; i++) {
      particles.push({ x: x, z: z, y: 5, vx: rand(-18, 18), vz: rand(-18, 18), vy: rand(20, 42), life: rand(.45, .8), color: color });
    }
  }

  function update(dt, now) {
    const cameraEase = 1 - Math.exp(-dt * CAMERA_EASE);
    camera.x += (camera.targetX - camera.x) * cameraEase;
    camera.z += (camera.targetZ - camera.z) * cameraEase;

    if (mode === 'jumping' && jump) {
      const sample = sampleJump(now);
      jump.lastSample = sample;
      // The collision point is the actual descending contact point, so no landing is snapped to a platform center.
      if (sample && sample.raw >= .88) finishJump(sample);
    }

    if (mode === 'landing' && landing) {
      if ((now - landing.started) / landing.duration >= 1) {
        landing = null;
        mode = 'idle';
      }
    }

    if (mode === 'failed' && fall) {
      fall.x += fall.vx * dt;
      fall.z += fall.vz * dt;
      fall.y += fall.vy * dt;
      fall.vy -= 90 * dt;
    }

    particles = particles.filter(p => (p.life -= dt) > 0);
    particles.forEach(p => {
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.y += p.vy * dt;
      p.vy -= 72 * dt;
    });
  }

  function project(x, z, y) {
    const rx = x - camera.x;
    const rz = z - camera.z;
    return {
      x: W / 2 + rx * 0.58 + rz * 0.58,
      y: H * 0.60 + rx * 0.25 - rz * 0.45 - (y || 0)
    };
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#c8c9d7');
    sky.addColorStop(.52, '#c9cad8');
    sky.addColorStop(1, '#c3c5d4');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
  }

  function drawPlatform(platform, active) {
    const half = platform.size / 2;
    const depth = Math.max(16, platform.size * 0.20);
    const corners = [
      project(platform.x - half, platform.z - half, 0),
      project(platform.x + half, platform.z - half, 0),
      project(platform.x + half, platform.z + half, 0),
      project(platform.x - half, platform.z + half, 0)
    ];
    const lower = corners.map(point => ({ x: point.x, y: point.y + depth }));
    const palettes = {
      green: { top: '#5d9b69', sides: ['#3e7550', '#f1f1ee', '#4c8159'] },
      gray: { top: '#5b5b61', sides: ['#45464d', '#eeeeec', '#62636a'] },
      white: { top: '#f4f4f5', sides: ['#85858c', '#ffffff', '#a6a6ab'] },
      red: { top: '#ed314f', sides: ['#922d40', '#ad3447', '#c44355'] },
      lime: { top: '#b6ef3c', sides: ['#5f983e', '#74b044', '#8ec84b'] }
    };
    const colors = palettes[platform.style] || palettes.green;
    const center = project(platform.x, platform.z, 0);

    ctx.save();
    ctx.globalAlpha = active ? 1 : 0.95;
    ctx.fillStyle = 'rgba(57, 58, 71, .22)';
    ctx.beginPath();
    ctx.ellipse(center.x - 5, center.y + depth + 13, platform.size * .60, depth * .28, 0, 0, Math.PI * 2);
    ctx.fill();

    const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
    edges.forEach((edge, index) => {
      const a = edge[0];
      const b = edge[1];
      ctx.fillStyle = colors.sides[index === 0 ? 2 : index === 1 ? 1 : index === 2 ? 0 : 1];
      ctx.beginPath();
      ctx.moveTo(corners[a].x, corners[a].y);
      ctx.lineTo(corners[b].x, corners[b].y);
      ctx.lineTo(lower[b].x, lower[b].y);
      ctx.lineTo(lower[a].x, lower[a].y);
      ctx.closePath();
      ctx.fill();
    });

    ctx.fillStyle = colors.top;
    ctx.beginPath();
    corners.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    ctx.closePath();
    ctx.fill();

    if (platform.special === 'face') {
      ctx.fillStyle = '#26312d';
      ctx.beginPath();
      ctx.arc(center.x - platform.size * .14, center.y - platform.size * .08, 3, 0, Math.PI * 2);
      ctx.arc(center.x + platform.size * .14, center.y - platform.size * .08, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#26312d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(center.x, center.y + platform.size * .02, platform.size * .12, .12, Math.PI - .12);
      ctx.stroke();
    } else if (platform.special === 'coin') {
      ctx.fillStyle = '#f7d235';
      ctx.beginPath();
      ctx.arc(center.x, center.y - platform.size * .08, platform.size * .10, 0, Math.PI * 2);
      ctx.fill();
    } else if (platform.special === 'cup') {
      const cupY = center.y - platform.size * .13;
      ctx.fillStyle = '#f4f4f5';
      ctx.beginPath();
      ctx.moveTo(center.x - 16, cupY - 2);
      ctx.lineTo(center.x + 16, cupY - 2);
      ctx.lineTo(center.x + 11, cupY + 19);
      ctx.lineTo(center.x - 11, cupY + 19);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#6a6b73';
      ctx.beginPath();
      ctx.ellipse(center.x, cupY - 3, 17, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#31313a';
      ctx.beginPath();
      ctx.arc(center.x, cupY - 7, 7, 0, Math.PI * 2);
      ctx.fill();
    } else if (platform.special === 'drum') {
      const drumY = center.y - platform.size * .13;
      ctx.fillStyle = '#efefef';
      ctx.fillRect(center.x - 17, drumY - 2, 34, 18);
      ctx.fillStyle = '#5a5b63';
      ctx.beginPath();
      ctx.ellipse(center.x, drumY - 2, 17, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(center.x, drumY + 16, 17, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // The visible target and scoring area share the exact world-space center and radius.
    drawCenterMarker(platform);
    ctx.restore();
  }

  function drawCenterMarker(platform) {
    const lightPlatform = platform.style === 'white' || platform.style === 'lime';
    const point = project(platform.x, platform.z, 0);
    const dotW = platform.size * .055;
    const dotH = platform.size * .020;
    ctx.fillStyle = lightPlatform ? 'rgba(53,68,58,.55)' : 'rgba(255,255,255,.92)';
    ctx.beginPath();
    ctx.ellipse(point.x, point.y, dotW, dotH, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCenterFeedback(now) {
    if (!centerHit) return;
    const t = clamp((now - centerHit.started) / 950, 0, 1);
    if (t >= 1) { centerHit = null; return; }
    const p = project(centerHit.x, centerHit.z, 0);
    ctx.save();
    ctx.globalAlpha = Math.min(1, (1 - t) * 3);
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.font = 'bold 22px "Microsoft YaHei", sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    ctx.fillStyle = '#be7924';
    const y = p.y - 82 - t * 25;
    ctx.strokeText('+' + centerHit.points, p.x, y);
    ctx.fillText('+' + centerHit.points, p.x, y);
    ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
    ctx.strokeText('中心命中', p.x, y + 18);
    ctx.fillText('中心命中', p.x, y + 18);
    ctx.restore();
  }

  function drawAvatar(point, scale, squash, tilt) {
    if (!avatar.complete || !avatar.naturalWidth) return;
    const h = Math.min(68, Math.max(52, H * .085)) * scale;
    const w = h * avatar.naturalWidth / avatar.naturalHeight;
    ctx.save();
    ctx.translate(point.x, point.y - h);
    ctx.rotate(tilt || 0);
    ctx.scale(1 + squash * .08, 1 - squash * .06);
    ctx.globalAlpha = .15;
    ctx.fillStyle = '#6a542d';
    ctx.beginPath();
    ctx.ellipse(0, h + 3, w * .42, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.drawImage(avatar, -w / 2, 0, w, h);
    ctx.restore();
  }

  function heroState(now) {
    if (mode === 'jumping' && jump) {
      const sample = sampleJump(now);
      const t = sample.t;
      return {
        x: sample.x,
        z: sample.z,
        y: sample.y,
        scale: 1 + Math.sin(Math.PI * t) * .06,
        squash: Math.sin(Math.PI * t) * -.5,
        tilt: Math.atan2(jump.to.x - jump.from.x, jump.to.z - jump.from.z) * .12
      };
    }
    if (mode === 'landing' && landing) {
      const t = clamp((now - landing.started) / landing.duration, 0, 1);
      const spring = Math.cos(t * Math.PI * 2.15) * Math.exp(-4.4 * t);
      return { x: player.x, z: player.z, y: spring * 7, scale: 1 + spring * .025, squash: spring, tilt: 0 };
    }
    if (mode === 'failed' && fall) {
      const age = Math.max(0, (now - fall.started) / 1000);
      return { x: fall.x, z: fall.z, y: fall.y, scale: 1 - Math.min(.25, age * .08), squash: 0, tilt: -.22 - age * .45 };
    }
    return { x: player.x, z: player.z, y: player.y, scale: 1, squash: mode === 'charging' ? .6 : 0, tilt: 0 };
  }

  function render(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.save();
    ctx.translate(viewLeft, viewTop);
    ctx.scale(viewScale, viewScale);
    drawBackground();

    const visible = platforms
      .map((platform, index) => ({ platform: platform, index: index }))
      .filter(item => Math.abs(item.index - currentIndex) <= 1)
      .sort((a, b) => b.platform.z - a.platform.z);
    visible.forEach(item => drawPlatform(item.platform, item.index === currentIndex));

    const hero = heroState(now);
    const heroPoint = project(hero.x, hero.z, hero.y);
    drawAvatar(heroPoint, hero.scale, hero.squash, hero.tilt);

    particles.forEach(p => {
      const point = project(p.x, p.z, p.y);
      ctx.globalAlpha = clamp(p.life * 2, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    drawCenterFeedback(now);
    ctx.restore();
  }

  function loop(now) {
    const dt = Math.min(.035, (now - lastTime) / 1000);
    lastTime = now;
    update(dt, now);
    render(now);
    requestAnimationFrame(loop);
  }

  function bindPress(element) {
    element.addEventListener('pointerdown', event => {
      event.preventDefault();
      if (element.setPointerCapture && event.pointerId !== undefined) element.setPointerCapture(event.pointerId);
      beginCharge();
    });
    element.addEventListener('pointerup', event => {
      event.preventDefault();
      endCharge();
      if (element.releasePointerCapture && event.pointerId !== undefined && element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    });
    element.addEventListener('pointercancel', endCharge);
  }

  bindPress(canvas);
  startButton.addEventListener('pointerdown', () => { warmAudio(); });
  startButton.addEventListener('click', () => {
    warmAudio();
    resetGame();
    startScreen.classList.add('hidden');
    lastTime = performance.now();
  });
  startScreen.addEventListener('pointerdown', event => {
    if (event.target === startButton) return;
    event.preventDefault();
    warmAudio();
    resetGame();
    startScreen.classList.add('hidden');
    lastTime = performance.now();
    beginCharge();
  });
  restartButton.addEventListener('click', () => {
    warmAudio();
    resetGame();
    startScreen.classList.add('hidden');
  });
  homeButton.addEventListener('click', () => {
    resetGame();
    mode = 'menu';
    startScreen.classList.remove('hidden');
  });
  helpButton.addEventListener('click', event => {
    event.stopPropagation();
    showNotice('长按蓄力，松开后跳跃');
  });
  settingsButton.addEventListener('click', event => {
    event.stopPropagation();
    setMuted(!muted);
  });
  bestButton.addEventListener('click', event => {
    event.stopPropagation();
    showNotice('最高分  ' + bestScore);
  });
  targetButton.addEventListener('click', event => {
    event.stopPropagation();
    showNotice('最高分  ' + bestScore);
  });
  shareButton.addEventListener('click', async event => {
    event.stopPropagation();
    const shareData = { title: '跳一跳', text: '来玩奶龙版跳一跳', url: window.location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else if (navigator.clipboard) await navigator.clipboard.writeText(window.location.href);
      showNotice(navigator.share ? '分享面板已打开' : '链接已复制');
    } catch (error) {
      showNotice('分享已取消');
    }
  });
  window.addEventListener('keydown', event => {
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      warmAudio();
      if (!startScreen.classList.contains('hidden')) {
        resetGame();
        startScreen.classList.add('hidden');
        lastTime = performance.now();
      }
      if (!event.repeat) beginCharge();
    }
  });
  window.addEventListener('keyup', event => {
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      endCharge();
    }
  });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && mode === 'charging') endCharge();
  });

  resize();
  resetGame();
  warmAudio();
  requestAnimationFrame(loop);
})();
