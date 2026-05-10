const generatePoints = (lat, lng, users) => {
  const points = [];
  // basic Box-Muller transform for gaussian
  for (let i = 0; i < users; i++) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
    // sigma = 50 meters approx
    const latOffset = z0 * (50 / 111320); 
    const lngOffset = z1 * (50 / (111320 * Math.cos(lat * Math.PI / 180)));
    points.push({ latitude: lat + latOffset, longitude: lng + lngOffset, weight: 1 });
  }
  return points;
}
console.log(generatePoints(0, 0, 5).length);
