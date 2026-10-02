const fs = require('fs');
const svg = fs.readFileSync('data/ref/ean.svg', 'utf8');
const blocks = svg.match(/<path[^>]*d="([^"]+)"/g) || [];

// 每个模块网格点是否被黑色矩形覆盖。
const covered = new Set();
const ORIGIN = 16.39;

// 逐命令跟踪画笔，收集每个闭合子路径出现过的全部 x 坐标，
// 用 maxX-minX 得到该矩形（黑条）的模块宽度。
for (const b of blocks) {
  const d = b.match(/d="([^"]+)"/)[1].replace(/\s+/g, ' ').trim();
  const cmdRe = /([MmVvHhZz])([^MmVvHhZz]*)/g;
  let mm;
  let x = 0;
  let y = 0;
  let xs = [];
  let hasRelativeH = false;
  const nums = (s) =>
    s
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
  while ((mm = cmdRe.exec(d)) !== null) {
    const [, cmd, argStr] = mm;
    const args = nums(argStr);
    if (cmd === 'M') {
      x = args[0];
      y = args[1];
      xs = [x];
      hasRelativeH = false;
    } else if (cmd === 'm') {
      x += args[0];
      y += args[1];
      xs = [x];
    } else if (cmd === 'h') {
      x += args[0];
      xs.push(x);
      hasRelativeH = true;
    } else if (cmd === 'H') {
      x = args[0];
      xs.push(x);
    } else if (cmd === 'v') {
      y += args[0];
    } else if (cmd === 'V') {
      y = args[0];
    } else if (cmd === 'z' || cmd === 'Z') {
      if (!hasRelativeH) continue;
      // 黑条矩形的所有 x 坐标都位于 *.39 网格；文字字形不在此网格上。
      const onGrid = xs.every((v) => Math.abs((v - ORIGIN) - Math.round(v - ORIGIN)) < 0.05);
      if (!onGrid) continue;
      const minX = Math.min(...xs);
      const width = Math.round(Math.max(...xs) - minX);
      const from = Math.round(minX - ORIGIN);
      for (let i = 0; i < width; i++) {
        if (from + i >= 0 && from + i < 95) covered.add(from + i);
      }
    }
  }
}

let bits = '';
for (let i = 0; i < 95; i++) bits += covered.has(i) ? '1' : '0';
console.log(bits, bits.length);
  let x = 0;
  let y = 0;
  let xs = [];
  let hasRelativeH = false;
