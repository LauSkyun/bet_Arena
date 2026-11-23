const minimumPercent = 110n;

function teamPercent(own, pool) {
  if (own === 0) return null;
  const percent = (70n * pool + 2800n) / BigInt(own);
  return Number(percent < minimumPercent ? minimumPercent : percent);
}

export function returnsFor(teams) {
  const red = teams.red.total;
  const blue = teams.blue.total;
  const pool = BigInt(red) + BigInt(blue);
  return { red: teamPercent(red, pool), blue: teamPercent(blue, pool) };
}

export function winningCredit(stake, percent) {
  if (stake === 0) return 0;
  return Number((BigInt(stake) * BigInt(percent)) / 100n);
}
