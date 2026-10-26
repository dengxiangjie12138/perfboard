export const number = (value: number) => value === 0 ? '0' : Math.abs(value) >= 1e7 || Math.abs(value) < 0.00001 ? value.toExponential(8) : Number(value.toPrecision(10)).toString();
// Suppress binary rounding noise only at the presentation boundary.
export const percent = (value: number) => { const display = Math.abs(value) < 1e-10 ? 0 : value; return `${display > 0 ? '+' : ''}${number(display)} %`; };
export const resistance = (ohms: number) => ohms >= 1e6 ? `${number(ohms / 1e6)} MΩ` : ohms >= 1000 ? `${number(ohms / 1000)} kΩ` : `${number(ohms)} Ω`;
