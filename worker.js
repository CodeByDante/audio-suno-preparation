const rate = 44100;
const db = value => 10 ** (value / 20);
const progress = (value, message) => postMessage({ progress: value, message });

function interpolate(channel, at) {
  const index = Math.floor(at);
  const first = channel[index] || 0;
  return first + ((channel[index + 1] || 0) - first) * (at - index);
}

function stretch(channels, ratio) {
  if (Math.abs(ratio - 1) < .00001) return channels;
  const hop = 1024;
  const grain = hop * 2;
  const length = Math.max(1, Math.round(channels[0].length / ratio));
  const result = channels.map(() => new Float32Array(length));
  const weight = new Float32Array(length);
  let previous = 0;
  for (let target = 0; target < length; target += hop) {
    const expected = Math.round(target * ratio);
    let source = expected;
    if (target > 0) {
      let best = -Infinity;
      for (let candidate = Math.max(0, expected - 144); candidate <= expected + 144; candidate += 12) {
        let dot = 0;
        let energy = 1e-9;
        for (let j = 0; j < hop; j += 12) {
          const value = (channels[0][candidate + j] || 0) + (channels[1][candidate + j] || 0);
          const prior = (channels[0][previous + hop + j] || 0) + (channels[1][previous + hop + j] || 0);
          dot += value * prior;
          energy += value * value;
        }
        const score = dot / Math.sqrt(energy);
        if (score > best) { best = score; source = candidate; }
      }
    }
    for (let j = 0; j < grain && target + j < length; j++) {
      const w = Math.sin(Math.PI * (j + .5) / grain) ** 2;
      weight[target + j] += w;
      for (let c = 0; c < 2; c++) result[c][target + j] += (channels[c][source + j] || 0) * w;
    }
    previous = source;
  }
  for (const channel of result) {
    for (let i = 0; i < length; i++) channel[i] /= weight[i];
  }
  return result;
}

function filter(type, frequency, gain = 0) {
  const angle = 2 * Math.PI * frequency / rate;
  const cos = Math.cos(angle);
  const alpha = Math.sin(angle) / Math.SQRT2;
  const a = 10 ** (gain / 40);
  const coefficients = {
    highpass: [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha],
    lowpass: [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha],
    peak: [1 + alpha * a, -2 * cos, 1 - alpha * a, 1 + alpha / a, -2 * cos, 1 - alpha / a],
  };
  const [b0,b1,b2,a0,a1,a2] = coefficients[type];
  let z1 = 0, z2 = 0;
  return x => {
    const y = x * b0 / a0 + z1;
    z1 = x * b1 / a0 - y * a1 / a0 + z2;
    z2 = x * b2 / a0 - y * a2 / a0;
    return y;
  };
}

function reverb(decay, channel) {
  const delays = [.071, .089, .113, .137].map((seconds, i) => {
    const delay = seconds + channel * .004 + i * .001;
    return { samples:new Float32Array(Math.round(rate * delay)), index:0, damped:0, feedback:db(-60 * delay / decay) };
  });
  return input => {
    let output = 0;
    for (const line of delays) {
      const delayed = line.samples[line.index];
      line.damped += .28 * (delayed - line.damped);
      line.samples[line.index] = input + line.feedback * line.damped;
      line.index = (line.index + 1) % line.samples.length;
      output += delayed;
    }
    return output / delays.length;
  };
}

function processAudio(channels, s, enabled = {}) {
  const has = effect => enabled[effect] !== false;
  const pitchRatio = 2 ** ((has('pitch') ? s.pitch : 0) / 12);
  // Compensate for the resampler's tempo change before applying the chosen pitch.
  const speed = has('speed') ? s.speed : 1;
  const source = stretch(channels, speed / pitchRatio);
  const length = Math.max(1, Math.round(channels[0].length / speed));
  const output = [new Float32Array(length), new Float32Array(length)];
  const antiAlias = 19500 / Math.max(1, pitchRatio);
  const tone = output.map(() => {
    const highpass = filter('highpass', s.low);
    const lowpass = filter('lowpass', s.high);
    const peak = filter('peak', s.eq, s.boost);
    return input => {
      const band = has('band') ? lowpass(highpass(input)) : input;
      return has('eq') ? peak(band) : band;
    };
  });
  if (pitchRatio > 1) {
    for (const channel of source) {
      const cutoff = filter('lowpass', antiAlias);
      const second = filter('lowpass', antiAlias);
      for (let i = 0; i < channel.length; i++) channel[i] = second(cutoff(channel[i]));
    }
  }
  const rooms = output.map((_, c) => reverb(s.decay, c));
  const noiseFilter = filter('lowpass', 6400);
  const noiseBass = filter('highpass', 260);
  const wet = has('reverb') ? s.wet / 100 : 0;
  let power = 0;
  for (const channel of channels) for (const sample of channel) power += sample * sample;
  const reference = Math.max(.005, Math.min(.3, Math.sqrt(power / (2 * channels[0].length))));
  let randomState = 381769;
  function noise() {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  }
  let pop = 0;
  let prevPop = 0;
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    const wow = (has('wow') ? s.wow : 0) / 100 * rate * (.014 * Math.sin(t * 2.4) + .0008 * Math.sin(t * 41));
    const position = Math.max(0, Math.min(source[0].length - 1, (i + wow) * pitchRatio));
    if (has('crackle') && noise() < 22 / rate) pop += (noise() * 2 - 1) * reference * s.crackle / 100;
    pop *= .92;
    const crack = pop - .65 * prevPop;
    prevPop = pop;
    const hiss = has('hiss') ? noiseBass(noiseFilter(noise() * 2 - 1)) * reference * .22 * s.hiss / 100 : 0;
    for (let c = 0; c < 2; c++) {
      const dry = tone[c](interpolate(source[c], position));
      const room = rooms[c](dry);
      output[c][i] = dry * (1 - wet * .4) + room * wet + hiss + crack;
    }
  }
  return output;
}

function encode(channels, ceiling, limiter = true) {
  const length = channels[0].length;
  const encoder = new lamejs.Mp3Encoder(2, rate, 320);
  const block = 1152;
  const pcm = [new Int16Array(block), new Int16Array(block)];
  const peak = offset => {
    let value = 0;
    for (let i = offset; i < Math.min(offset + block, length); i++) {
      value = Math.max(value, Math.abs(channels[0][i]), Math.abs(channels[1][i]));
    }
    return value;
  };
  const limit = db(ceiling);
  let gain = 1;
  let current = peak(0);
  const frames = [];
  for (let start = 0; start < length; start += block) {
    const next = peak(start + block);
    const desired = limiter ? Math.min(1, limit / (Math.max(current, next) || 1)) : 1;
    const count = Math.min(block, length - start);
    for (let i = 0; i < count; i++) {
      gain = desired < gain ? desired : gain + (desired - gain) * .0003;
      for (let c = 0; c < 2; c++) pcm[c][i] = Math.round(Math.max(-1, Math.min(1, channels[c][start + i] * gain)) * 32767);
    }
    current = next;
    const bytes = encoder.encodeBuffer(pcm[0].subarray(0, count), pcm[1].subarray(0, count));
    if (bytes.length) frames.push(bytes);
    if (start % (block * 100) === 0) progress(.55 + .44 * start / length, 'Exportando MP3…');
  }
  frames.push(encoder.flush());
  return new Blob(frames, { type: 'audio/mpeg' });
}

self.onmessage = ({data: {channels, settings, enabled}}) => {
  try {
    progress(.03, 'Aplicando tono, velocidad, reverb y vinilo…');
    const processed = processAudio(channels, settings, enabled);
    progress(.53, 'Cargando el codificador MP3…');
    importScripts('https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js');
    const blob = encode(processed, settings.ceiling, enabled?.limiter !== false);
    postMessage({blob});
  } catch (error) {
    postMessage({error: 'No se pudo procesar el audio. ' + (error.message || String(error))});
  }
};
