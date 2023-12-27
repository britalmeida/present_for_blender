import './style.css'
import { UIRenderer, vec2, vec4, hexToRGBFloat } from './shading';

import { simData } from "../assets/sim_data";

// HTML area for the presents simulation.
const canvas = document.querySelector<HTMLCanvasElement>('#campaign-gifts-pile');
if (canvas === null) {
  throw new Error("present_for_blender could not find a canvas element with id 'campaign-gifts-pile'");
}
const WIDTH = canvas.offsetWidth / 1;
const HEIGHT = canvas.offsetHeight / 1;

// Data - the presents!
const masses = [5, 10, 60, 120, 300, 600, 5*12, 10*12, 25*12, 50*12, 100*12, 250*12]; // in euros :)

// Simulation Configuration
const colors: Array<vec4> = ['#e4e4e4', '#e4e4e4', '#e4e4e4', '#e4e4e4', '#e4e4e4', '#e4e4e4',
                             '#ffd1a8', '#bddbff', '#ffb668', '#8aadff', '#ee9543', '#7795cd'].map((v) => hexToRGBFloat(v));
// Bg color to hardcode in the fragment shader.
const colorBg = hexToRGBFloat('#5a535c');

const scale = 8 / Math.sqrt(12);
let widthVariancePercent = [      // How much longer is one side vs the other.
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0,   // e.g. 0.5 = one side is 50% longer than the other.
  0.0, 0.7, 0.3, 0.5, 0.25, 0.1]; // 0.0 is a square. Don't type 1.0 ;)

// ~ end Configuration

// Calculate present sizes in px.
const m_to_px = 100;
const px_to_m = 1 / m_to_px;
const sidesPx = masses.map((v) => Math.sqrt(v) * scale);
const widthsPx =  sidesPx.map((v, i) => v + v * widthVariancePercent[i]);
const heightsPx = widthsPx.map((v, i) => sidesPx[i]*sidesPx[i] / v);
//console.log("Present widths in px:", widthsPx);
//console.log("Present heights in px:", heightsPx);

// Runtime data for the present simulation and present renderer.
const masses_kg =  masses.map((v) => v / 1000.0);
const gravity = -9.81; // m/s2

class PresentSimData {
  presentID = 0;    // Index into the presents. It uniquely ids a present for the sim and is returned for the tooltip.
  tierIdx = 0;      // Index into the subscription tiers configurations (labels, box color, size, etc...).
  pos: vec2 = [0.0, 0.0]; // Current position of the center of each present. In physics sim coordinates.
  ori: vec2 = [0.0, 1.0]; // Current orientation of each present, as a normalized heading vector with Y-up being forward.
  v:   vec2 = [0.0, 0.0];
  a:   vec2 = [0.0, 0.0];
}
const presentSimData = new Array<PresentSimData>();

class Contact {
  other: number; // The ID of the other body.
  p: vec2; // Contact position on the surface of the object.
  n: vec2; // Surface normal

  constructor(other: number, contact_point: vec2, surface_normal: vec2) {
    this.other = other;
    this.p = contact_point;
    this.n = surface_normal;
  }
}
let contacts: Array<Array<Contact>> = [];

//generate_initial_positions();
//load_initial_positions();

function load_initial_positionsToRenderer()
{
  for (const body of simData.presents) {
    if (body.label === 'border')
      continue;

    var present = new PresentSimData();

    // Convert the information in the label to the indexes.
    const labelParts = body.label.split("-");
    present.presentID = Number(labelParts[1]);
    present.tierIdx = masses.indexOf(Number(labelParts[0]));

    // Create an object and its initial simulation values.
    // Convert from matter.js (0,0) at top-left with y down and angles along x
    // to (0,0) at bottom-left with y up with angles along y.
    present.pos = [body.position.x * px_to_m, (HEIGHT - body.position.y) * px_to_m];
    present.ori = [Math.sin(body.angle), Math.cos(body.angle)];

    presentSimData.push(present);
    contacts.push(new Array());
  }

}

function loadInitialPositionsFromRendererToRapier(RAPIER: any, world: any)
{
  for (const present of presentSimData) {  
    // Create a dynamic rigid-body with the position and orientation from the render data.
    let rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(present.pos[0], present.pos[1])
      .setRotation(Math.asin(present.ori[0]));
    let rigidBody = world.createRigidBody(rigidBodyDesc);

    // Create a cuboid collider attached to the dynamic rigidBody, with dimensions as in the present tier.
    let colliderDesc = RAPIER.ColliderDesc.cuboid(widthsPx[present.tierIdx] * px_to_m, heightsPx[present.tierIdx] * px_to_m);
    let collider = world.createCollider(colliderDesc, rigidBody);
  }
}

function generate_initial_positions()
{
  let y = 30;
  let x = 5;
  let p = 0;
  let angle = 0.7853982;
  for (let tierIdx = 0; tierIdx < masses.length; tierIdx++) {
    const radius = widthsPx[tierIdx] / 2;
    x += radius;

    var present = new PresentSimData();
    present.presentID = p++;
    present.tierIdx = tierIdx;
    present.pos = [x * px_to_m, y * px_to_m];
    present.ori = [Math.sin(angle), Math.cos(angle)];
    present.a = [0.0, gravity];
    presentSimData.push(present);
    contacts.push(new Array());

    x += radius + 60;
  }
}

function check_intersections() {
  for (let i = 0; i < presentSimData.length; i++) {
    for (let j = i+1; j < presentSimData.length; j++) {

      const tier1 = presentSimData[i].tierIdx;
      const tier2 = presentSimData[j].tierIdx;
      const radius1_m = heightsPx[tier1] * 0.5 * px_to_m;
      const radius2_m = heightsPx[tier2] * 0.5 * px_to_m;
      const pos1 = presentSimData[i].pos;
      const pos2 = presentSimData[j].pos;

      if (pos1[1] - pos2[1] < radius1_m + radius2_m)
      {
        //console.log("CONTACT!", (pos2[1] - pos1[1]).toFixed(3));
        contacts[i].push( new Contact(j, [0.0, -radius1_m], [0, -1]) );
        contacts[j].push( new Contact(i, [0.0, +radius2_m], [0, +1]) );
      }
    }
  }
}

function determine_forces(i: number) {
  const b = 10;

  let net_force = 0;
  for (let c = 0; c < contacts[i].length; c++) {
    const contact = contacts[i][c];
    const i2 = contact.other;
    net_force += -b * presentSimData[i2].v[1];
    //console.log("net force", i, net_force);
  }
  return net_force;
}

function updatePhysicsWithOwnCode(delta_time_ms: number) {
  const delta_time_s = delta_time_ms / 1000;

  check_intersections();

  // Update physics.
  for (let i = 0; i < presentSimData.length; i++) {
    const tier = presentSimData[i].tierIdx;
    const half_height_m = heightsPx[tier] * 0.5 * px_to_m;
    const mass = masses_kg[tier];

    // Calculate only on y to not bother with multiplying "vectors" in JS.
    const prev_p = presentSimData[i].pos[1];
    const prev_v = presentSimData[i].v[1];
    const prev_a = presentSimData[i].a[1];

    const f_net = determine_forces(i);

    // Velocity Verlet
    const new_p = prev_p + prev_v * delta_time_s + 0.5*prev_a*delta_time_s*delta_time_s;
    const half_stepped_v = prev_v + 0.5*prev_a*delta_time_s;
    const new_a = ((gravity*mass) + f_net) / mass;
    const new_v = half_stepped_v + 0.5*new_a*delta_time_s;

    if (new_p > half_height_m) {
      presentSimData[i].pos[1] = new_p;
      presentSimData[i].v[1] = new_v;
      presentSimData[i].a[1] = new_a;
      //console.log("p: ", new_p.toFixed(2), "v: ", new_v.toFixed(2), " a: ", new_a.toFixed(2));
    } else {
      // Give it a rest.
      presentSimData[i].pos[1] = half_height_m;
      presentSimData[i].v[1] = 0.0;
      presentSimData[i].a[1] = 0.0;
    }
  }
}


function updatePhysicsWithRapier(world: any) {
  world.step();

  // Sync Rapier's positions and orientations to the renderer.
  let i = 0;
  world.forEachRigidBody((body: RigidBody) => {
    let position = body.translation();
    let angle = body.rotation();
    presentSimData[i].pos = [position.x, position.y];
    presentSimData[i].ori = [Math.sin(angle), Math.cos(angle)];
    i++;
  });
}


function draw() {

  const ui = uiRenderer;
  ui.beginFrame();

  for (let i = 0; i < presentSimData.length; i++) {
    const tier = presentSimData[i].tierIdx;
    const p_px : vec2 = [ presentSimData[i].pos[0] * m_to_px, presentSimData[i].pos[1] * m_to_px ];
    ui.addGift(p_px, presentSimData[i].ori, widthsPx[tier], heightsPx[tier], tier);

  }
  // Draw body origins.
  /*{
    const axisSize = 10;
    for (const present of presentSimData) {
      const p_px : vec2 = [ present.pos[0] * m_to_px, present.pos[1] * m_to_px ];
      ui.addLine(p_px, [p_px[0]+present.ori[1]*axisSize, p_px[1]-present.ori[0]*axisSize], 1, [1.0, 0.0, 0.0, 1.0]);
    }
    for (const present of presentSimData) {
      const p_px : vec2 = [ present.pos[0] * m_to_px, present.pos[1] * m_to_px ];
      ui.addLine(p_px, [p_px[0]+present.ori[0]*axisSize, p_px[1]+present.ori[1]*axisSize], 1, [0.0, 1.0, 0.0, 1.0]);
    }
  }*/

  // Draw contacts.
  /*{
    for (let i = 0; i < presentSimData.length; i++) {
      for (const contact of contacts[i]) {
        const p : vec2 = [(presentSimData[i].pos[0] + contact.p[0])*m_to_px,
                          (presentSimData[i].pos[1] + contact.p[1])*m_to_px];
        ui.addLine(p, [p[0]+contact.n[0]*5, p[1]+contact.n[1]*5], 1, [1.0, 1.0, 0.0, 1.0]);
      }
    }
  }*/

  ui.draw();
}


const fps = 30;
const frame_dur = Math.floor(1000/fps);
let start_time = 0;
let t = 100; // total simulation steps

const uiRenderer: UIRenderer = new UIRenderer(canvas, colorBg, colors, widthsPx, heightsPx);



import('@dimforge/rapier2d').then(RAPIER => {

  // Create Physics world.
  const gravity = { x: 0.0, y: -9.81 };
  let world = new RAPIER.World(gravity);

  // Create the ground
  let groundColliderDesc = RAPIER.ColliderDesc.cuboid(10.0, 0.01);
  world.createCollider(groundColliderDesc);

  load_initial_positionsToRenderer();
  loadInitialPositionsFromRendererToRapier(RAPIER, world);

  function tick_simulation(current_time: number) {
    // Calcuate the time that has elapsed since the last frame
    const delta_time = current_time - start_time;
  
    // Tick a frame only after enough time accumulated.
    if (delta_time >= frame_dur) {
      start_time = current_time;
  
      //updatePhysicsWithOwnCode(frame_dur);
      updatePhysicsWithRapier(world);

      draw();
  
      if (delta_time > 40)
        console.log("ms: " + delta_time + " fps: " + Math.floor(1000 / delta_time));
      t--;
    }
  
    if (t > 0)
      requestAnimationFrame(tick_simulation);
  }
  
  tick_simulation(frame_dur);
})
