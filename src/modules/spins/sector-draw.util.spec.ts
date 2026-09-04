import { drawSector } from './sector-draw.util';
import { SPIN_SECTORS } from './spins.constants';

describe('drawSector', () => {
  it('sempre devolve um sectorIndex válido (0-7) com o valor certo do setor', () => {
    for (let i = 0; i < 200; i += 1) {
      const { sectorIndex, coinsAwarded } = drawSector();
      expect(sectorIndex).toBeGreaterThanOrEqual(0);
      expect(sectorIndex).toBeLessThan(SPIN_SECTORS.length);
      expect(coinsAwarded).toBe(SPIN_SECTORS[sectorIndex]);
    }
  });

  it('distribuição estatística coerente ao longo de muitos giros — cada setor ~1/8, cada valor conforme sua frequência', () => {
    const N = 8000;
    const countByValue = new Map<number, number>();

    for (let i = 0; i < N; i += 1) {
      const { coinsAwarded } = drawSector();
      countByValue.set(coinsAwarded, (countByValue.get(coinsAwarded) ?? 0) + 1);
    }

    // 50 e 150 saem em 3 dos 8 setores cada (3/8 = 37.5%); 500 e 1000 em 1 dos 8 (12.5%).
    // Tolerância generosa (±25% relativo) — a N=8000 isso é várias dezenas de desvios-padrão
    // de folga, então só falha se o sorteio estiver genuinamente enviesado, não por acaso.
    const expected = { 50: 0.375, 150: 0.375, 500: 0.125, 1000: 0.125 };
    for (const [value, probability] of Object.entries(expected)) {
      const count = countByValue.get(Number(value)) ?? 0;
      const expectedCount = N * probability;
      const tolerance = expectedCount * 0.25;
      expect(count).toBeGreaterThan(expectedCount - tolerance);
      expect(count).toBeLessThan(expectedCount + tolerance);
    }

    // Nenhum valor fora dos 4 esperados.
    expect(new Set(countByValue.keys())).toEqual(new Set([50, 150, 500, 1000]));
  });
});
