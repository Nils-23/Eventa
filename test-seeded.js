const seededRandom = (seed) => {
  const x = Math.sin(seed++) * 10000;
  return x - Math.floor(x);
};
console.log(seededRandom(1), seededRandom(2));
