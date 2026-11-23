// Two overlapping delay taps shift pitch without changing the playback clock.
class LiveEffects extends AudioWorkletProcessor {
  constructor() {
    super();
    this.window = .06 * sampleRate;
    this.buffers = Array.from({ length: 2 }, () => new Float32Array(Math.ceil(this.window + .04 * sampleRate) + 2));
    this.rooms = this.buffers.map(() => [.071, .089, .113, .137].map(seconds => ({
      samples: new Float32Array(Math.round(seconds * sampleRate)),
      index: 0,
      damped: 0,
    })));
    this.position = 0;
    this.phase = 0;
    this.pop = 0;
    this.noise = 0;
    this.level = 0;
    this.settings = { ratio: 1, wet: 0, decay: 1, wow: 0, hiss: 0, crackle: 0, limit: 1 };
    this.port.onmessage = ({ data }) => {
      if (data.reset) {
        for (const buffer of this.buffers) buffer.fill(0);
        for (const room of this.rooms) {
          for (const line of room) {
            line.samples.fill(0);
            line.damped = 0;
          }
        }
        this.level = this.pop = this.noise = 0;
      } else {
        this.settings = data;
      }
    };
  }

  process([input], [output]) {
    if (!input.length) return true;
    const { ratio, wet, decay, wow, hiss, crackle, limit } = this.settings;
    const feedback = this.rooms[0].map(line => 10 ** (-3 * line.samples.length / (sampleRate * decay)));
    const size = this.buffers[0].length;
    for (let i = 0; i < output[0].length; i++) {
      this.phase += (1 - ratio) / this.window;
      this.phase -= Math.floor(this.phase);
      const alternate = (this.phase + .5) % 1;
      const weight = Math.sin(Math.PI * this.phase) ** 2;
      const time = (currentFrame + i) / sampleRate;
      const drift = wow ? (.015 + .014 * Math.sin(time * 2.4) + .0008 * Math.sin(time * 41)) * wow * sampleRate : 0;
      const first = (size + this.position - this.phase * this.window - drift) % size;
      const second = (size + this.position - alternate * this.window - drift) % size;
      const amplitude = Math.abs(input[0][i]);
      this.level += .001 * (amplitude - this.level);
      const reference = Math.max(.005, Math.min(.3, this.level));
      const random = Math.random() * 2 - 1;
      this.noise += .45 * (random - this.noise);
      const previousPop = this.pop;
      if (crackle && Math.random() < 22 / sampleRate) this.pop += random * reference * crackle;
      this.pop *= .92;
      const texture = this.noise * reference * hiss + this.pop - .65 * previousPop;
      for (let channel = 0; channel < output.length; channel++) {
        const buffer = this.buffers[channel];
        const sample = input[channel]?.[i] ?? input[0][i];
        buffer[this.position] = sample;
        const dry = ratio === 1
          ? (wow ? this.read(buffer, (size + this.position - drift) % size) : sample)
          : this.read(buffer, first) * weight + this.read(buffer, second) * (1 - weight);
        let room = 0;
        if (wet) {
          for (const [index, line] of this.rooms[channel].entries()) {
            const delayed = line.samples[line.index];
            line.damped += .28 * (delayed - line.damped);
            line.samples[line.index] = dry + feedback[index] * line.damped;
            line.index = (line.index + 1) % line.samples.length;
            room += delayed;
          }
        }
        const mixed = dry * (1 - wet * .4) + room * wet / 4 + texture;
        output[channel][i] = Math.max(-limit, Math.min(limit, mixed));
      }
      this.position = (this.position + 1) % size;
    }
    return true;
  }

  read(buffer, position) {
    const index = Math.floor(position);
    return buffer[index] + (buffer[(index + 1) % buffer.length] - buffer[index]) * (position - index);
  }
}

registerProcessor('live-effects', LiveEffects);
