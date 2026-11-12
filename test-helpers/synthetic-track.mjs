// Builds made-up tracks for tests. Do not add recorded sessions as fixtures.
export const START = 1_000_000;
const METRES_PER_DEGREE = 111320;

// phases: [{ seconds, speed (m/s), heading (degrees), gps }], sampled once per second from a made-up origin.
// gps: false leaves the position out, the way a watch under water records speed but no fix.
export function syntheticTrack(phases) {
  const records = [];
  let north = 0;
  let east = 0;
  let second = 0;
  phases.forEach(({ seconds, speed, heading = 0, gps = true }) => {
    for (let step = 0; step < seconds; step += 1) {
      records.push({
        fields: {
          timestamp: START + second,
          enhanced_speed: speed,
          ...(gps ? { position_lat: north / METRES_PER_DEGREE, position_long: east / METRES_PER_DEGREE } : {}),
        },
      });
      north += speed * Math.cos(heading * Math.PI / 180);
      east += speed * Math.sin(heading * Math.PI / 180);
      second += 1;
    }
  });
  return records;
}

export function near(actual, expected, tolerance, message) {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(`${message}: expected ${expected} ± ${tolerance}, got ${actual}`);
  }
}
