const fs = require('fs');
const p = 'server/property-actions.test.js';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/assert\.deepEqual\(game\.manageProperty\((.*?), \{ tileIndex: (.*?), action: (.*?) \}\), \{ success: false, error: (.*?) \}\);/g,
  (m, a, b, c, e) => 'reject(game, ' + a + ', ' + b + ', ' + c + ', ' + e + ');');
s = s.replace(/reject\(game, 'socket-a', 1, 'sell-house'\)\.error/, "assert.deepEqual");
s = s.replace("const lastFeed = game => game.feed[0]?.text;",
  "const lastFeed = game => game.feed[0]?.text;\nconst reject = (game, socket, tileIndex, action, error) =>\n  assert.deepEqual(game.manageProperty(socket, { tileIndex, action }), { success: false, error });");
fs.writeFileSync(p, s);
console.log('converted; remaining inline deepEqual manageProperty:', (s.match(/assert\.deepEqual\(game\.manageProperty/g) || []).length - 1);
