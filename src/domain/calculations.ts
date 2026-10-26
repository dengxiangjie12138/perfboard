export * from '../tools/shared/numeric';
export * from '../tools/feedback/algorithm';
export * from '../tools/stm32-timer/algorithm';
export const CALCULATION_SOURCES = {
  timer: 'https://www.st.com/resource/en/application_note/an4776-generalpurpose-timer-cookbook-for-stm32-microcontrollers-stmicroelectronics.pdf',
  feedback: 'https://www.ti.com/lit/SBAA346',
  preferredValues: 'https://www.vishay.com/docs/21014/perfval.pdf',
} as const;
