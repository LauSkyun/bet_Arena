export const defaultDurations = Object.freeze({ betMs: 60_000, battleMs: 40_000 });
export const legacyDurations = Object.freeze({ betMs: 20_000, battleMs: 25_000 });
export const secondsLimit = 300;

export function durationsFromSeconds(bet, battle) {
  if (![bet, battle].every((value) => Number.isInteger(value) && value >= 1 && value <= secondsLimit)) return null;
  return { betMs: bet * 1000, battleMs: battle * 1000 };
}
