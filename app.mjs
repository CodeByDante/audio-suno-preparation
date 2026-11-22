import { preset, rate } from './settings.mjs';
import { timeline } from './timeline.mjs';
const el = id => document.getElementById(id);
const form = el('processor');
const file = el('file');
const effects = el('effects');
const sourcePlayer = el('source-player');
const sourceTimeline = timeline(sourcePlayer);
let worker, url, sourceUrl, active, decodedSource;

function selectedEffects() {
  return Object.fromEntries([...effects.querySelectorAll('input')].map(input => [
    input.name.slice('effect-'.length), input.checked,
  ]));
}
function busy(value) {
  active = value;
  file.disabled = value;
  effects.disabled = value;
  el('preset').disabled = el('custom').disabled = value || !file.files.length;
  el('progress-box').hidden = !value;
}
function clear() {
  el('player').pause();
  el('player').removeAttribute('src');
  el('player').load();
  el('result').hidden = true;
  if (url) URL.revokeObjectURL(url);
}
function finish(message) {
  worker?.terminate();
  worker = undefined;
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
  el('filename').textContent = file.files[0]?.name || 'Elegir archivo';
  el('status').textContent = '';
  busy(false);
};
el('cancel').onclick = () => finish('Procesamiento cancelado.');
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
  const job = new Worker('./worker.js?v=2');
  worker = job;
  try {
    const decoded = await decodedSource;
    if (worker !== job) return;
    const channels = [0, 1].map(i => decoded.getChannelData(Math.min(i, decoded.numberOfChannels - 1)).slice());
    job.onmessage = ({data}) => {
      if (worker !== job) return;
      if (data.error) return finish(data.error);
      if (data.blob) {
        url = URL.createObjectURL(data.blob);
        el('player').src = el('download').href = url;
        el('download').download = source.name.replace(/\.[^.]+$/, '') + '_suno_ready.mp3';
        el('result').hidden = false;
        return finish('MP3 listo. El archivo original se conserva.');
      }
      el('progress').value = data.progress;
      el('status').textContent = data.message;
    };
    job.onerror = () => finish('No se pudo iniciar el motor de audio.');
    job.postMessage({ channels, settings, enabled }, channels.map(channel => channel.buffer));
  } catch {
    if (worker === job) finish('No se pudo leer el audio. Prueba con un MP3, WAV o FLAC válido.');
  }
}
el('preset').onclick = () => start(preset);
form.onsubmit = event => {
  event.preventDefault();
  start(Object.fromEntries(Object.keys(preset).map(key => [key, form.elements.namedItem(key).valueAsNumber])));
};
