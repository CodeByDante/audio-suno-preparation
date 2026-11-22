import { preset, rate } from './settings.mjs';
const el = id => document.getElementById(id);
const form = el('processor');
const file = el('file');
let worker, url, active;
function busy(value) {
  active = value;
  file.disabled = value;
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
  el('filename').textContent = file.files[0]?.name || 'Elegir archivo';
  el('status').textContent = '';
  busy(false);
};
el('cancel').onclick = () => finish('Procesamiento cancelado.');
async function start(settings) {
  const source = file.files[0];
  if (active || !source) return;
  if (settings.low >= settings.high) {
    el('status').textContent = 'El corte inferior debe ser menor que el corte superior.';
    return;
  }
  clear();
  busy(true);
  el('progress').removeAttribute('value');
  el('status').textContent = 'Leyendo el archivo…';
  const job = new Worker('./worker.js');
  worker = job;
  try {
    const decoded = await new OfflineAudioContext(2, 1, rate).decodeAudioData(await source.arrayBuffer());
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
    job.postMessage({ channels, settings }, channels.map(channel => channel.buffer));
  } catch {
    if (worker === job) finish('No se pudo leer el audio. Prueba con un MP3, WAV o FLAC válido.');
  }
}
el('preset').onclick = () => start(preset);
form.onsubmit = event => {
  event.preventDefault();
  start(Object.fromEntries(Object.keys(preset).map(key => [key, form.elements.namedItem(key).valueAsNumber])));
};
