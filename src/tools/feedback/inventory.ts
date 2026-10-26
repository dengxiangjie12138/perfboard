import { parseResistance, type Resistor } from './algorithm';
export interface InventoryResistorInput { id: string; name: string; category: string; parameters?: string; location?: string; stockStatus?: string }
export function parseInventoryResistors(parts: readonly InventoryResistorInput[]): Resistor[] {
  return parts.flatMap(part => {
    if (!/电阻|resistor/i.test(part.category)) return [];
    const ohms = parseResistance(part.name) ?? parseResistance(part.parameters ?? '');
    return ohms === null ? [] : [{ ohms, id: part.id, name: part.name, location: part.location, stockStatus: part.stockStatus }];
  });
}
