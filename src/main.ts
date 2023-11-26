import './style.css'
import { UIRenderer } from './shading';

const num_tiers = 6;
const size_multiplier = 1;
const sizes = [15.81, 10.00, 7.07, 5.00, 3.16, 2.24];
const counts = [16, 27, 52, 446, 676, 2487];
const colors = [
    [0.839, 0.761, 0.839, 1.0], // 0xd6c2d6
    [0.239, 0.302, 0.361, 1.0], // 0x3d4d5c
    [0.459, 0.549, 0.639, 1.0], // 0x758ca3
    [1.000, 0.820, 0.102, 1.0], // 0xffd11a
    [0.820, 0.820, 0.878, 1.0], // 0xd1d1e0
    [1.000, 0.651, 0.302, 1.0], // 0xffa64d
];

const rect_widths = [15.81, 6.00, 9.07, 4.00, 3.16, 2.74];
const rect_heights = rect_widths.map((v, i) => sizes[i]*sizes[i] / v);

console.log("Total presents: ", counts.reduce((a, b) => a + b, 0));

function draw() {
  const w = canvas.width;
  const h = canvas.height;
  const ui = uiRenderer;
  ui.beginFrame();

  // Draw present lineup as circles.
  let y = h - 200;
  let x = 50;
  for (let tier = 0; tier < num_tiers; tier++) {
    const radius = sizes[tier] * size_multiplier;
    y -= radius;
    ui.addCircle([x, y], radius, colors[tier]);
    y -= radius + 15;
  }

  // Draw present lineup as rounded squares.
  y = h - 200;
  x += 50;
  let corner = 1.0;
  for (let tier = 0; tier < num_tiers; tier++) {
    const radius = sizes[tier] * size_multiplier;
    y -= radius;
    ui.addRect(x - radius, y - radius, radius * 2, radius * 2, colors[tier], corner);
    y -= radius + 15;
  }

  // Draw present lineup as rectangles.
  y = h - 200;
  x += 50;
  for (let tier = 0; tier < num_tiers; tier++) {
    const rect_width = rect_widths[tier] * size_multiplier;
    const rect_height = rect_heights[tier] * size_multiplier;
    y -= rect_height;
    ui.addRect(x - rect_width, y - rect_height, rect_width * 2, rect_height * 2, colors[tier], corner);
    y -= rect_height + 15;
  }

  // Draw present lineup as patterned squares.
  y = h - 200;
  x += 50;
  for (let tier = 0; tier < num_tiers; tier++) {
    const radius = sizes[tier] * size_multiplier;
    const pattern = 1;
    y -= radius;
    ui.addPresent([x, y], radius, pattern, colors[tier], [0.459, 0.549, 0.639, 1.0], corner);
    y -= radius + 15;
  }

  // Draw present lineup as textured hexagons.
  y = h - 200;
  x += 50;
  for (let tier = 0; tier < num_tiers; tier++) {
    const radius = sizes[tier] * size_multiplier;
    y -= radius;
    ui.addImage(x - radius, y - radius, radius * 2, radius * 2, eggTextureID, corner);
    y -= radius + 15;
  }

  ui.draw();
}


const canvas = document.querySelector<HTMLCanvasElement>('#canvas-view');
if (canvas === null) {
  throw new Error("present_for_blender could not find a canvas element with id 'canvas-view'");
}

const uiRenderer: UIRenderer = new UIRenderer(canvas, draw);

const eggTextureID: WebGLTexture = uiRenderer.loadImage('/assets/egg.png');
