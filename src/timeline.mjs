const get = id => document.getElementById(id);

function time(seconds) {
  const tenths = Math.floor((Number.isFinite(seconds) ? seconds : 0) * 10);
  const minutes = String(Math.floor(tenths / 600)).padStart(2, '0');
  const remainder = (tenths % 600 / 10).toFixed(1).padStart(4, '0');
  return minutes + ':' + remainder;
}

export function timeline(player, prefix = '', track = 'pista original', chooseFile, beforePlay) {
  const resolve = id => get(prefix + id);
  const canvas = resolve('waveform');
  const seek = resolve('seek');
  const play = resolve('play');
  const empty = resolve('empty-wave');
  const playhead = resolve('playhead');
  const clock = resolve('clock');
  const context = canvas.getContext('2d');
  const surface = seek.closest('.timeline');
  seek.addEventListener('pointerdown', () => surface.classList.add('pointer-focus'));
  seek.addEventListener('keydown', () => surface.classList.remove('pointer-focus'));
  seek.addEventListener('blur', () => surface.classList.remove('pointer-focus'));
  let hasSource = !chooseFile;
  if (chooseFile) empty.addEventListener('click', () => { if (!hasSource) chooseFile(); });
  let peaks;
  let frame;
  let starting = false;

  function paint() {
    const width = Math.round(canvas.clientWidth * devicePixelRatio);
    const height = Math.round(canvas.clientHeight * devicePixelRatio);
    if (!width || !height) return;
    canvas.width = width;
    canvas.height = height;
    context.strokeStyle = '#534766';
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();
    if (!peaks) return;
    const step = Math.max(1, Math.round(2 * devicePixelRatio));
    context.fillStyle = '#c5a2ff';
    for (let x = 0; x < width; x += step) {
      const index = Math.floor(x / width * peaks.length);
      const magnitude = peaks[index] * height * .44;
      context.fillRect(x, height / 2 - magnitude, Math.max(1, step - 1), Math.max(1, magnitude * 2));
    }
  }

  function update() {
    const duration = Number.isFinite(player.duration) ? player.duration : 0;
    const position = duration ? Math.min(player.currentTime, duration) : 0;
    seek.disabled = !duration;
    play.disabled = !duration && hasSource;
    seek.max = duration;
    seek.value = position;
    const timestamp = time(position);
    seek.setAttribute('aria-valuetext', timestamp);
    playhead.style.left = (duration ? position / duration * 100 : 0) + '%';
    playhead.hidden = !duration;
    clock.textContent = timestamp + ' / ' + time(duration);
    const playing = duration && !player.paused && !player.ended;
    play.textContent = playing ? 'Ⅱ  Pausar' : '▶  Reproducir';
    play.setAttribute('aria-label', hasSource ? (playing ? 'Pausar ' + track : 'Reproducir ' + track) : 'Cargar audio');
  }

  function animate() {
    update();
    if (!player.paused && !player.ended) frame = requestAnimationFrame(animate);
  }

  player.addEventListener('loadedmetadata', update);
  player.addEventListener('seeked', update);
  player.addEventListener('play', animate);
  for (const event of ['pause', 'ended', 'emptied']) {
    player.addEventListener(event, () => { cancelAnimationFrame(frame); update(); });
  }
  seek.addEventListener('input', () => {
    player.currentTime = Number(seek.value);
    update();
  });
  play.addEventListener('click', async () => {
    if (!hasSource) return chooseFile();
    if (player.paused) {
      if (starting) return;
      starting = true;
      try {
        if (beforePlay) await beforePlay();
        await player.play();
      } catch {
        get('status').textContent = 'No se pudo reproducir este archivo en el navegador.';
      } finally {
        starting = false;
      }
    } else player.pause();
  });
  new ResizeObserver(paint).observe(canvas);

  function normalize() {
    const maximum = Math.max(.01, ...peaks);
    for (let i = 0; i < peaks.length; i++) peaks[i] /= maximum;
    empty.hidden = true;
    paint();
  }

  return {
    reset(selected) {
      hasSource = !chooseFile || selected;
      if (chooseFile) empty.disabled = selected;
      peaks = undefined;
      empty.hidden = false;
      empty.textContent = selected ? 'Leyendo la forma de onda…' : 'Haz clic para cargar un audio';
      paint();
      update();
    },
    drawPeaks(values) {
      peaks = values;
      normalize();
    },
    draw(buffer) {
      const count = Math.min(2048, buffer.length);
      peaks = new Float32Array(count);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const samples = buffer.getChannelData(c);
        for (let n = 0; n < count; n++) {
          const first = Math.floor(n * buffer.length / count);
          const last = Math.floor((n + 1) * buffer.length / count);
          const stride = Math.max(1, Math.floor((last - first) / 32));
          for (let i = first; i < last; i += stride) peaks[n] = Math.max(peaks[n], Math.abs(samples[i]));
        }
      }
      normalize();
    },
    unavailable() {
      empty.textContent = 'No se pudo leer la forma de onda de este archivo.';
    },
  };
}
