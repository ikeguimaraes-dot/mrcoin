import { randomInt } from 'node:crypto';
import { SPIN_SECTORS } from './spins.constants';

export interface SectorDraw {
  sectorIndex: number;
  coinsAwarded: number;
}

/** Sorteia um dos 8 setores com `crypto.randomInt` (nunca `Math.random` — o sorteio nunca pode
 * ser previsível). `sectorIndex` sempre vem de `randomInt(0, SPIN_SECTORS.length)`, então o
 * acesso ao array é sempre dentro dos limites por construção. */
export function drawSector(): SectorDraw {
  const sectorIndex = randomInt(0, SPIN_SECTORS.length);
  return { sectorIndex, coinsAwarded: SPIN_SECTORS[sectorIndex] as number };
}
