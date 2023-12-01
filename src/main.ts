import './style.css'
import { UIRenderer, vec2, vec4, hexToRGBFloat } from './shading';

import { simData } from "../assets/sim_data";

const canvas = document.querySelector<HTMLCanvasElement>('#campaign-gifts-pile');
if (canvas === null) {
  throw new Error("present_for_blender could not find a canvas element with id 'campaign-gifts-pile'");
}

/*const colors: Array<vec4> = [
    [0.839, 0.761, 0.839, 1.0], // 0xd6c2d6
    [0.239, 0.302, 0.361, 1.0], // 0x3d4d5c
    [0.459, 0.549, 0.639, 1.0], // 0x758ca3
    [1.000, 0.820, 0.102, 1.0], // 0xffd11a
    [0.820, 0.820, 0.878, 1.0], // 0xd1d1e0
    [1.000, 0.651, 0.302, 1.0], // 0xffa64d
];*/
const colors: Array<vec4> = simData.presentColors.map((v) => hexToRGBFloat(v));
// Bg color to hardcode in the fragment shader.
//console.log(hexToRGBFloat(simData.colorBg));

const masses = [5, 10, 25, 50, 100, 250]; // in euros :)
const masses_kg =  masses.map((v) => v / 100.0);

const m_to_px = 100;
const px_to_m = 1 / m_to_px;
const scale = simData.scale;
const sidesPx = masses.map((v) => Math.sqrt(v) * scale);
// const widthVariancePercent = [0.0, 0.7, 0.3, 0.5, 0.25, 0.1]; // How much longer is one side vs the other.
                                                            // e.g. 0.5 = one side is 50% longer than the other.
// const widthVariancePercent = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]; // Use this one for squares.
const widthVariancePercent = simData.widthVariancePercent;
const widthsPx =  sidesPx.map((v, i) => v + v * widthVariancePercent[i]);
const heightsPx = widthsPx.map((v, i) => sidesPx[i]*sidesPx[i] / v);

let ids: Array<number> = [];
let positions: Array<vec2> = [];
let orientations: Array<vec2> = [];
let velocities: Array<vec2> = [];
let accells: Array<vec2> = [];

class Contact {
  toi: number;
  other_body_id: number;
  contact_point: vec2;
  surface_normal: vec2;

  constructor(toi: number, other_body_id: number, contact_point: vec2, surface_normal: vec2) {
    this.toi = toi;
    this.other_body_id = other_body_id;
    this.contact_point = contact_point;
    this.surface_normal = surface_normal;
  }
}

let contacts: Array<Array<Contact>> = [];

const gravity = -9.81; // m/s2

function load_initial_positions()
{
  for (const ob of simData.presents) {
    if (ob.label === 'border')
      continue;

    // Convert the information in the label to the indexes of the structures here.
    const tierValue = Number(ob.label.split("-")[0]);
    const tierIdx = masses.indexOf(tierValue);

    // Create an object and its initial simulation values.
    // Convert from matter.js (0,0) at top-left with y down and angles along x
    // to (0,0) at bottom-left with y up with angles along y.
    positions.push([ob.position.x * px_to_m, (canvas.height - ob.position.y) * px_to_m]);
    velocities.push([0.0, 0.0]);
    orientations.push([Math.sin(ob.angle), Math.cos(ob.angle)]);
    ids.push(tierIdx);
    contacts.push(new Array());
  }
}

function generate_initial_positions()
{
  let y = 300;
  let x = 10;
  for (let tier = 0; tier < 1; tier++) {
    const radius = widthsPx[tier] / 2;
    x += radius;
    positions.push([x * px_to_m, y * px_to_m]);
    velocities.push([0.0, -1]);
    orientations.push([0.5, 0.5]);
    accells.push([0.0, gravity]);
    ids.push(tier);
    contacts.push(new Array());

    positions.push([x * px_to_m, 100 * px_to_m]);
    velocities.push([0.0, 1.0]);
    orientations.push([0, 1]);
    accells.push([0.0, 0.0]);
    ids.push(tier);
    contacts.push(new Array());

    x += radius + 15;
  }
  console.log("positions in meters", positions);
}

function check_intersections() {
  for (let i = 0; i < positions.length; i++) {
    for (let j = i+1; j < positions.length; j++) {

      const tier1 = ids[i];
      const tier2 = ids[j];
      const radius1_m = heightsPx[tier1] * 0.5 * px_to_m;
      const radius2_m = heightsPx[tier2] * 0.5 * px_to_m;
      const pos1 = positions[i];
      const pos2 = positions[j];

      if (pos1[1] - pos2[1] < radius1_m + radius2_m)
      {
        console.log("CONTACT!", pos2[1] - pos1[1]);
        contacts[i].push( new Contact(0, j, pos1, [0, 1]) );
        contacts[j].push( new Contact(0, i, pos1, [0, -1]) );
      }
    }
  }
}

function determine_forces(i: number) {
  const b = 10;

  let net_force = 0;
  for (let c = 0; c < contacts[i].length; c++) {
    const contact = contacts[i][c];
    const i2 = contact.other_body_id;
    net_force += -b * velocities[i2][1];
    console.log("net force", i, net_force);
  }
  return net_force;
}

function update_physics(delta_time_ms: number) {
  const delta_time_s = delta_time_ms / 1000;

  check_intersections();

  // Update physics.
  for (let i = 0; i < positions.length; i++) {
    const tier = ids[i];
    const half_height_m = heightsPx[tier] * 0.5 * px_to_m;
    const mass = masses_kg[tier];

    // Calculate only on y to not bother with multiplying "vectors" in JS.
    const prev_p = positions[i][1];
    const prev_v = velocities[i][1];
    const prev_a = accells[i][1];

    const f_net = determine_forces(i);

    // Velocity Verlet
    const new_p = prev_p + prev_v * delta_time_s + 0.5*prev_a*delta_time_s*delta_time_s;
    const half_stepped_v = prev_v + 0.5*prev_a*delta_time_s;
    const new_a = 0;//((gravity*mass) + f_net) / mass;
    const new_v = half_stepped_v + 0.5*new_a*delta_time_s;

    if (new_p > half_height_m) {
      positions[i][1] = new_p;
      velocities[i][1] = new_v;
      accells[i][1] = new_a;
      console.log("p: ", new_p.toFixed(2), "v: ", new_v.toFixed(2), " a: ", new_a.toFixed(2));
    } else {
      // Give it a rest.
      positions[i][1] = half_height_m;
      velocities[i][1] = 0.0;
      accells[i][1] = 0.0;
    }
  }
}

function draw() {

  const ui = uiRenderer;
  ui.beginFrame();

  for (let i = 0; i < positions.length; i++) {
    const tier = ids[i];
    const p_px : vec2 = [ positions[i][0] * m_to_px, positions[i][1] * m_to_px ];
    ui.addOrientedRect(p_px, orientations[i], widthsPx[tier], heightsPx[tier], colors[tier], tier);
  }
  // Draw body origins.
  /*{
    const axisSize = 10;
    for (let i = 0; i < positions.length; i++) {
      const p_px : vec2 = [ positions[i][0] * m_to_px, positions[i][1] * m_to_px ];
      ui.addLine(p_px, [p_px[0]+orientations[i][1]*axisSize, p_px[1]-orientations[i][0]*axisSize], 1, [1.0, 0.0, 0.0, 1.0]);
    }
    for (let i = 0; i < positions.length; i++) {
      const p_px : vec2 = [ positions[i][0] * m_to_px, positions[i][1] * m_to_px ];
      ui.addLine(p_px, [p_px[0]+orientations[i][0]*axisSize, p_px[1]+orientations[i][1]*axisSize], 1, [0.0, 1.0, 0.0, 1.0]);
    }
  }*/

  ui.draw();
}


const fps = 30;
const frame_dur = Math.floor(1000/fps);
let start_time = 0;
let t = 0; // total simulation steps
function tick_simulation(current_time: number) {
  // Calcuate the time that has elapsed since the last frame
  const delta_time = current_time - start_time;

  // Tick a frame only after enough time accumulated.
  if (delta_time >= frame_dur) {
    start_time = current_time;

    //update_physics(delta_time);
    draw();

    console.log("ms: " + delta_time + " fps: " + Math.floor(1000 / delta_time));
    t--;
  }
  
  if (t > 0)
    requestAnimationFrame(tick_simulation);
}

//generate_initial_positions();
load_initial_positions();
const uiRenderer: UIRenderer = new UIRenderer(canvas, draw);
const patternsTextureID: WebGLTexture = uiRenderer.loadImage('/assets/patterns.png');

tick_simulation(frame_dur);
