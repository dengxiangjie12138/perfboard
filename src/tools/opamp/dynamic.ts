import type { CircuitParameters } from './algorithm';
export interface FrequencyResponse { real: number; imag: number; magnitude: number; phase: number; noiseGain: number }
export interface DynamicResult extends FrequencyResponse {
  outputDC: number; outputAmplitude: number; tau: number; inputPole: number; feedbackPole: number; unityFrequency: number; minimumGbw: number;
}
export function frequencyResponse(id: 'integrator' | 'differentiator', p: CircuitParameters, frequency: number): FrequencyResponse {
  const w = 2 * Math.PI * frequency;
  let real: number, imag: number, phase: number;
  if (id === 'integrator') {
    const x = w * p.r2 * p.c1, k = p.r2 / p.r1;
    real = -k / (1 + x * x); imag = k * x / (1 + x * x); phase = 180 - Math.atan(x) * 180 / Math.PI;
  } else {
    const x = w * p.r1 * p.c1, y = w * p.r2 * p.cf, a = 1 - x * y, b = x + y, t = w * p.r2 * p.c1, den = a * a + b * b;
    real = -t * b / den; imag = -t * a / den; phase = -90 - (Math.atan(x) + Math.atan(y)) * 180 / Math.PI;
  }
  return { real, imag, magnitude: Math.hypot(real, imag), phase, noiseGain: Math.hypot(1 - real, imag) };
}
export function dynamicResult(id: 'integrator' | 'differentiator', p: CircuitParameters): DynamicResult {
  const response = frequencyResponse(id, p, p.frequency);
  return { ...response,
    outputDC: id === 'integrator' ? p.vref - p.r2 / p.r1 * (p.vin - p.vref) : p.vref,
    outputAmplitude: response.magnitude * p.amplitude,
    tau: id === 'integrator' ? p.r2 * p.c1 : p.r1 * p.c1,
    inputPole: id === 'integrator' ? 0 : 1 / (2 * Math.PI * p.r1 * p.c1),
    feedbackPole: id === 'integrator' ? 1 / (2 * Math.PI * p.r2 * p.c1) : p.cf > 0 ? 1 / (2 * Math.PI * p.r2 * p.cf) : Infinity,
    unityFrequency: 1 / (2 * Math.PI * (id === 'integrator' ? p.r1 : p.r2) * p.c1),
    minimumGbw: id === 'integrator' ? p.frequency * 10 : (p.r1 + p.r2) / (2 * Math.PI * p.r1 * p.r1 * p.c1),
  };
}
export function sinePoint(p: CircuitParameters, response: DynamicResult, time: number) {
  const angle = 2 * Math.PI * p.frequency * time;
  return { input: p.vin + p.amplitude * Math.sin(angle), output: response.outputDC + p.amplitude * (response.real * Math.sin(angle) + response.imag * Math.cos(angle)) };
}
