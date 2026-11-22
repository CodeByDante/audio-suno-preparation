import { preset, rate } from './settings.mjs';
import { timeline } from './timeline.mjs?v=8';
const el = id => document.getElementById(id);
const form = el('processor');
const file = el('file');
const effects = el('effects');
const sourcePlayer = el('source-player');
const sourceTimeline = timeline(sourcePlayer, '', 'pista original', () => file.click());
const player = el('player');
const resultTimeline = timeline(player, 'result-', 'audio procesado');
const effectChecks = [...effects.querySelectorAll('input[type=checkbox]')];
const restoreDefaults = el('restore-defaults');
const clearEffects = el('clear-effects');
const cutPanel = el('cut-panel');
const cutStart = el('cut-start');
const cutEnd = el('cut-end');
const cutSelection = el('cut-selection');
let mode = 'effects';
let sourceDuration = 0;

function updateCutSelection() {
  const start = cutStart.valueAsNumber;
  const end = cutEnd.valueAsNumber;
  const valid = Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= sourceDuration;
  cutSelection.hidden = mode !== 'cut' || !valid;
  if (valid) {
    cutSelection.style.left = 100 * start / sourceDuration + '%';
    cutSelection.style.width = 100 * (end - start) / sourceDuration + '%';
  }
}

function setMode(next) {
  mode = next;
  const cutting = next === 'cut';
  el('mode-effects').setAttribute('aria-pressed', String(!cutting));
  el('mode-cut').setAttribute('aria-pressed', String(cutting));
  el('effects-panel').hidden = cutting;
  cutPanel.hidden = !cutting;
  cutPanel.disabled = !cutting || !sourceDuration;
  el('preset').disabled = active || !file.files.length || (cutting && !sourceDuration);
  el('preset').textContent = cutting ? 'Cortar y exportar MP3 ↗' : 'Procesar audio ↗';
  el('status').textContent = '';
  updateCutSelection();
}

el('mode-effects').onclick = () => setMode('effects');
el('mode-cut').onclick = () => setMode('cut');
cutStart.oninput = cutEnd.oninput = updateCutSelection;
for (const [button, input] of [['mark-start', cutStart], ['mark-end', cutEnd]]) {
  el(button).onclick = () => {
    input.value = Math.min(sourceDuration, Math.round(sourcePlayer.currentTime * 1000) / 1000);
    updateCutSelection();
  };
}

function updatePresetSelection() {
  restoreDefaults.checked = effectChecks.every(input => input.checked) &&
    Object.entries(preset).every(([key, value]) => form.elements.namedItem(key).valueAsNumber === value);
  clearEffects.checked = effectChecks.every(input => !input.checked);
}

function selectPreset(defaults) {
  for (const input of effectChecks) input.checked = defaults;
  if (defaults) {
    for (const [key, value] of Object.entries(preset)) form.elements.namedItem(key).value = value;
  }
  updatePresetSelection();
}
restoreDefaults.addEventListener('click', () => selectPreset(true));
clearEffects.addEventListener('click', () => selectPreset(false));
effects.addEventListener('change', updatePresetSelection);
sourcePlayer.addEventListener('play', () => player.pause());
player.addEventListener('play', () => sourcePlayer.pause());
let worker, url, sourceUrl, active, decodedSource, conversion;

function audioWorker() {
  return worker ??= new Worker('./worker.js?v=9');
}

function selectedEffects() {
  return Object.fromEntries([...effects.querySelectorAll('input[type=checkbox]')].map(input => [
    input.name.slice('effect-'.length), input.checked,
  ]));
}
function busy(value) {
  active = value;
  file.disabled = value;
  el('mode-effects').disabled = el('mode-cut').disabled = value;
  cutPanel.disabled = value || mode !== 'cut' || !sourceDuration;
  effects.disabled = value;
  restoreDefaults.disabled = clearEffects.disabled = value;
  el('remove-file').disabled = value;
  el('preset').disabled = value || !file.files.length || (mode === 'cut' && !sourceDuration);
  el('progress-box').hidden = !value;
}
function clear() {
  el('player').pause();
  el('player').removeAttribute('src');
  el('player').load();
  el('result').hidden = true;
  if (url) URL.revokeObjectURL(url);
  url = undefined;
}
function finish(message, terminate = false) {
  if (terminate) {
    worker?.terminate();
    worker = undefined;
  }
  conversion = undefined;
  busy(false);
  el('status').textContent = message;
}
file.onchange = () => {
  clear();
  sourcePlayer.pause();
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  const selected = file.files[0];
  sourceDuration = 0;
  cutStart.value = cutEnd.value = 0;
  updateCutSelection();
  if (selected) {
    sourceUrl = URL.createObjectURL(selected);
    sourcePlayer.src = sourceUrl;
    try { audioWorker().postMessage({ prepare: true }); } catch { /* Retry when processing. */ }
  } else {
    sourceUrl = undefined;
    sourcePlayer.removeAttribute('src');
    sourcePlayer.load();
  }
  sourceTimeline.reset(Boolean(selected));
  decodedSource = selected ? decode(selected) : undefined;
  const pending = decodedSource;
  pending?.then(buffer => {
    if (decodedSource !== pending) return;
    sourceDuration = buffer.duration;
    cutStart.max = cutEnd.max = sourceDuration;
    cutEnd.value = sourceDuration;
    cutPanel.disabled = active || mode !== 'cut';
    el('preset').disabled = active;
    updateCutSelection();
    sourceTimeline.draw(buffer);
  }, () => {
    if (decodedSource === pending) sourceTimeline.unavailable();
  });
  el('remove-file').hidden = !selected;
  el('status').textContent = '';
  busy(false);
};
el('remove-file').onclick = () => {
  file.value = '';
  file.onchange();
};
el('cancel').onclick = () => finish('Procesamiento cancelado.', true);
async function decode(source) {
  return new OfflineAudioContext(2, 1, rate).decodeAudioData(await source.arrayBuffer());
}
async function start(settings) {
  const source = file.files[0];
  if (active || !source) return;
  const cutting = mode === 'cut';
  const range = cutting ? [cutStart.valueAsNumber, cutEnd.valueAsNumber] : null;
  const enabled = selectedEffects();
  if (!cutting && enabled.band && settings.low >= settings.high) {
    el('status').textContent = 'El corte inferior debe ser menor que el corte superior.';
    return;
  }
  clear();
  sourcePlayer.pause();
  busy(true);
  el('progress').removeAttribute('value');
  el('status').textContent = 'Leyendo el archivo…';
  const request = Symbol();
  conversion = request;
  try {
    const job = audioWorker();
    const decoded = await decodedSource;
    if (conversion !== request) return;
    const first = range ? Math.round(range[0] * rate) : 0;
    const last = range ? Math.min(decoded.length, Math.round(range[1] * rate)) : decoded.length;
    if (range && (!range.every(Number.isFinite) || range[0] < 0 || range[1] > decoded.duration || first >= last)) {
      return finish('Elige un inicio y un final válidos dentro de la pista.');
    }
    const channels = [0, 1].map(i => decoded.getChannelData(Math.min(i, decoded.numberOfChannels - 1)).slice(first, last));
    job.onmessage = ({data}) => {
      if (conversion !== request) return;
      if (data.error) return finish(data.error);
      if (data.blob) {
        url = URL.createObjectURL(data.blob);
        el('player').src = el('download').href = url;
        el('download').download = source.name.replace(/\.[^.]+$/, '') + (cutting ? '_recorte.mp3' : '_suno_ready.mp3');
        el('result-title').textContent = cutting ? 'Audio recortado' : 'Audio procesado';
        el('result').hidden = false;
        resultTimeline.reset(true);
        resultTimeline.drawPeaks(data.peaks);
        return finish('');
      }
      el('progress').value = data.progress;
      el('status').textContent = data.message;
    };
    job.onerror = () => finish('No se pudo iniciar el motor de audio.', true);
    job.postMessage({ channels, settings, enabled, cutting }, channels.map(channel => channel.buffer));
  } catch {
    if (conversion === request) finish('No se pudo leer el audio. Prueba con un MP3, WAV o FLAC válido.');
  }
}
form.onsubmit = event => {
  event.preventDefault();
  if (document.activeElement?.matches('.stepper input')) document.activeElement.blur();
  start(Object.fromEntries(Object.keys(preset).map(key => [key, form.elements.namedItem(key).valueAsNumber])));
};

for (const stepper of effects.querySelectorAll('.stepper')) {
  const input = stepper.querySelector('input');
  let previous = input.value;
  const begin = () => {
    if (!input.readOnly) return;
    previous = input.value;
    input.readOnly = false;
    input.focus();
  };
  const commit = () => {
    if (input.readOnly) return;
    const current = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : Number(previous);
    const minimum = Number(input.min);
    const clamped = Math.max(minimum, Math.min(Number(input.max), current));
    const step = Number(input.step);
    const decimalPlaces = (input.step.split('.')[1] || '').length;
    input.value = (minimum + Math.round((clamped - minimum) / step) * step).toFixed(decimalPlaces);
    input.readOnly = true;
    updatePresetSelection();
  };
  input.addEventListener('dblclick', begin);
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !input.readOnly) {
      input.value = previous;
      commit();
      event.preventDefault();
    }
    if (event.key === 'Enter') {
      if (input.readOnly) begin();
      else commit();
      event.preventDefault();
    }
  });
  for (const button of stepper.querySelectorAll('button')) {
    button.addEventListener('click', () => {
      commit();
      const increment = input.name === 'speed' ? .01 : 1;
      const next = input.valueAsNumber + Number(button.dataset.step) * increment;
      const bounded = Math.max(Number(input.min), Math.min(Number(input.max), next));
      const decimalPlaces = (input.step.split('.')[1] || '').length;
      input.value = bounded.toFixed(decimalPlaces);
      updatePresetSelection();
    });
  }
}
