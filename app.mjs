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
  return worker ??= new Worker('./worker.js?v=8');
}

function selectedEffects() {
  return Object.fromEntries([...effects.querySelectorAll('input[type=checkbox]')].map(input => [
    input.name.slice('effect-'.length), input.checked,
  ]));
}
function busy(value) {
  active = value;
  file.disabled = value;
  effects.disabled = value;
  restoreDefaults.disabled = clearEffects.disabled = value;
  el('remove-file').disabled = value;
  el('preset').disabled = value || !file.files.length;
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
    if (decodedSource === pending) sourceTimeline.draw(buffer);
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
  const enabled = selectedEffects();
  if (enabled.band && settings.low >= settings.high) {
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
    const channels = [0, 1].map(i => decoded.getChannelData(Math.min(i, decoded.numberOfChannels - 1)).slice());
    job.onmessage = ({data}) => {
      if (conversion !== request) return;
      if (data.error) return finish(data.error);
      if (data.blob) {
        url = URL.createObjectURL(data.blob);
        el('player').src = el('download').href = url;
        el('download').download = source.name.replace(/\.[^.]+$/, '') + '_suno_ready.mp3';
        el('result').hidden = false;
        resultTimeline.reset(true);
        resultTimeline.drawPeaks(data.peaks);
        return finish('');
      }
      el('progress').value = data.progress;
      el('status').textContent = data.message;
    };
    job.onerror = () => finish('No se pudo iniciar el motor de audio.', true);
    job.postMessage({ channels, settings, enabled }, channels.map(channel => channel.buffer));
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
