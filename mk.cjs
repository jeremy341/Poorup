const fs = require("fs");
const lines = fs.readFileSync("public/clientSocialSurfaces.js", "utf8").split(/\r?\n/);
const a = [...lines.slice(0, 22), ...lines.slice(63, 77)];
fs.writeFileSync("public/clientDupTest.js", a.join("\n") + "\n");
console.log("---- file:");
console.log(a.map((x) => (x.length > 90 ? x.slice(0, 90) + "…" : x)).join("\n"));
