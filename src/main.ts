import './style.css'
import { UIRenderer } from './shading';

const num_tiers = 6;
const size_multiplier = 200;
const sizes = [0.1581, 0.10, 0.0707, 0.05, 0.0316, 0.0224];
const counts = [16, 27, 52, 446, 676, 2487];
const colors = [
    [0.839, 0.761, 0.839, 1.0], // 0xd6c2d6
    [0.239, 0.302, 0.361, 1.0], // 0x3d4d5c
    [0.459, 0.549, 0.639, 1.0], // 0x758ca3
    [1.000, 0.820, 0.102, 1.0], // 0xffd11a
    [0.820, 0.820, 0.878, 1.0], // 0xd1d1e0
    [1.000, 0.651, 0.302, 1.0], // 0xffa64d
];

console.log("Total presents: ", counts.reduce((a, b) => a + b, 0));

function draw() {
  const w = canvas.width;
  const h = canvas.height;
  const ui = uiRenderer;
  ui.beginFrame();

  let y = h;
  for (let tier = 0; tier < num_tiers; tier++) {
    const num_presents = counts[tier];
    const radius = sizes[tier] * size_multiplier;
    let x = radius;
    y -= radius;
    for (let i = 0; i < num_presents; i++) {

      ui.addCircle([x, y], radius, colors[tier]);
      x += radius * 2;
      if (x > w) {
        x = radius;
        y -= radius * 2;
      }
    }
    y -= radius;
  }

  ui.draw();
}


const canvas = document.querySelector<HTMLCanvasElement>('#canvas-view');
if (canvas === null) {
  throw new Error("present_for_blender could not find a canvas element with id 'canvas-view'");
}

const uiRenderer: UIRenderer = new UIRenderer(canvas, draw);
