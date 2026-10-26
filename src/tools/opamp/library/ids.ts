export const LIBRARY_IDS = ['ac-inv','ac-noninv','lowpass-inv','sk-highpass','sk-lowpass','mfb-bandpass','tia','current-uni','current-bi','howland','pwm','reference','sine-osc','hv-driver','half-wave','full-wave','single-diff','level-shift','pga','mic-noninv','mic-tia'] as const;
export type LibraryId = typeof LIBRARY_IDS[number];
