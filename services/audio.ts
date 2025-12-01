
export class AudioController {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  source: AudioBufferSourceNode | null = null;
  buffer: AudioBuffer | null = null;
  dataArray: Uint8Array | null = null;
  
  constructor() {
    // Lazy init
  }

  async loadFile(file: File): Promise<{ buffer: AudioBuffer, waveform: number[] }> {
    if (!this.ctx) this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    this.buffer = audioBuffer;

    // Generate simplified waveform for visualization (downsampled)
    const rawData = audioBuffer.getChannelData(0);
    const samples = 200; // Resolution of waveform
    const blockSize = Math.floor(rawData.length / samples);
    const waveform = [];
    
    for (let i = 0; i < samples; i++) {
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[blockSize * i + j]);
        }
        waveform.push(sum / blockSize);
    }
    
    // Normalize waveform
    const max = Math.max(...waveform);
    const normalizedWaveform = waveform.map(v => v / max);

    return { buffer: audioBuffer, waveform: normalizedWaveform };
  }

  play(time: number) {
    if (!this.ctx || !this.buffer) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    this.stop(); // Stop previous

    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    this.source.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // Handle offset carefully
    // If time > duration, don't play
    if (time >= this.buffer.duration) return;
    
    this.source.start(0, time);
  }

  stop() {
    if (this.source) {
        try { this.source.stop(); } catch(e) {}
        this.source.disconnect();
        this.source = null;
    }
  }

  getAudioData() {
    if (!this.analyser || !this.dataArray) return { bass: 0, mid: 0, treble: 0, fft: [] };

    this.analyser.getByteFrequencyData(this.dataArray);

    // Helper to average range
    const getAvg = (start: number, end: number) => {
        let sum = 0;
        const count = end - start;
        for(let i=start; i<end; i++) sum += this.dataArray![i];
        return (sum / count) / 255;
    };

    // Assuming 44.1kHz, 512 FFT size => bin size ~86Hz
    // Bass: 0-200Hz (~0-3 bins)
    // Mid: 200-2000Hz (~3-23 bins)
    // Treble: 2000Hz+ (~23+ bins)
    
    return {
        bass: getAvg(0, 4),
        mid: getAvg(4, 24),
        high: getAvg(24, 64),
        treble: getAvg(64, 128),
        fft: Array.from(this.dataArray).map(v => v / 255)
    };
  }
}

export const audioController = new AudioController();
