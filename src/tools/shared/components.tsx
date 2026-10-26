export function Heading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <header className="calc-heading"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></header>; }
export function NumberField({ label, value, onChange, unit, min = '0', max, integer = false, help }: { label: string; value: string; onChange: (value: string) => void; unit?: string; min?: string; max?: string; integer?: boolean; help?: string }) {
  return <label className="calc-field"><span>{label}</span><div className="calc-input-unit"><input type="number" value={value} min={min} max={max} step={integer ? '1' : 'any'} onChange={event => onChange(event.target.value)} />{unit && <b>{unit}</b>}</div>{help && <small>{help}</small>}</label>;
}
export function ErrorMessage({ text }: { text: string }) { return <p className="calc-error" role="alert">{text}</p>; }
