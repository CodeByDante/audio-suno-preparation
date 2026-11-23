export async function livePreview(context, player) {
  await context.audioWorklet.addModule(new URL('./workers/live-effects.mjs', import.meta.url));
  const source = context.createMediaElementSource(player);
  const highpass = new BiquadFilterNode(context, { type: 'highpass', Q: -3 });
  const lowpass = new BiquadFilterNode(context, { type: 'lowpass', Q: -3 });
  const realce = new BiquadFilterNode(context, { type: 'peaking', Q: Math.SQRT1_2 });
  const live = new AudioWorkletNode(context, 'live-effects', { outputChannelCount: [2] });
  const dry = new GainNode(context);
  const wet = new GainNode(context, { gain: 0 });
  source.connect(dry).connect(context.destination);
  source.connect(highpass).connect(lowpass).connect(realce).connect(live).connect(wet).connect(context.destination);

  const reset = () => live.port.postMessage({ reset: true });
  player.addEventListener('seeking', reset);
  player.addEventListener('emptied', reset);
  player.addEventListener('pause', reset);

  return (settings, effects) => {
    const active = Object.values(effects).some(Boolean);
    player.preservesPitch = true;
    player.playbackRate = effects.speed ? settings.speed : 1;
    const now = context.currentTime;
    dry.gain.setTargetAtTime(active ? 0 : 1, now, .005);
    wet.gain.setTargetAtTime(active ? 1 : 0, now, .005);
    const band = effects.band && settings.low < settings.high;
    highpass.type = band ? 'highpass' : 'peaking';
    lowpass.type = band ? 'lowpass' : 'peaking';
    highpass.frequency.setTargetAtTime(settings.low, now, .01);
    lowpass.frequency.setTargetAtTime(settings.high, now, .01);
    realce.frequency.setTargetAtTime(settings.eq, now, .01);
    realce.gain.setTargetAtTime(effects.eq ? settings.boost : 0, now, .01);
    live.port.postMessage({
      ratio: effects.pitch ? 2 ** (settings.pitch / 12) : 1,
      wet: effects.reverb ? settings.wet / 100 : 0,
      decay: settings.decay,
      wow: effects.wow ? settings.wow / 100 : 0,
      hiss: effects.hiss ? settings.hiss * .22 / 100 : 0,
      crackle: effects.crackle ? settings.crackle / 100 : 0,
      limit: effects.limiter ? 10 ** (settings.ceiling / 20) : 1,
    });
  };
}
