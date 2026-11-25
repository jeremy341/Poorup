// SKYLINE PAINTER: builds the tiny pixel-building silhouette shared by the
// board, the Home view and the theme page layer. Pure SVG writer, no state.

const DEFAULT_SKYLINE_PALETTE = { far: "#123634", near: "#0d2725", light: "#78894f" };

export function paintSkyline(el, data, palette = DEFAULT_SKYLINE_PALETTE) {
  const far = palette.far || DEFAULT_SKYLINE_PALETTE.far;
  const near = palette.near || DEFAULT_SKYLINE_PALETTE.near;
  const light = palette.light || DEFAULT_SKYLINE_PALETTE.light;
  let out = "";
  data.forEach(([x, y, w, h], i) => {
    out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${far}"/>`;
    for (let r = 0; r < Math.floor((h - 2) / 3); r++) {
      for (let c = 0; c < Math.floor((w - 1) / 2); c++) {
        const lit = (r + c + i) % 3 === 0;
        out += `<rect x="${x + 1 + c * 2}" y="${y + 2 + r * 3}" width="1" height="1" fill="${lit ? light : near}"/>`;
      }
    }
  });
  el.innerHTML = out;
}
