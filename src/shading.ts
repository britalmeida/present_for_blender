// Load the vertex and fragment shader sources.
import vs_source from '../glsl/vertex.glsl';
import fs_source from '../glsl/fragment.glsl';

// Shorthands for meaningful types.
type vec2 = [number, number];
type vec4 = [number, number, number, number];

// Color conversion utility function.
export function hexToRGBFloat(hex: string): vec4 {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
    1.0
  ];
}

// Representation of a rectangle for geometry operations.
class Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;

  constructor(x: number, y: number, w: number, h: number) {
    this.left = x;
    this.right = x + w;
    this.top = y + h;
    this.bottom = y;
    this.width = w;
    this.height = h;
  }

  contains (x: number, y: number): boolean {
    return this.left <= x && x <= this.right &&
        this.bottom  <= y && y <= this.top;
  }
  intersects (other: Rect): boolean {
    return this.left <= other.right && other.left <= this.right &&
        this.bottom <= other.top && other.bottom <= this.top;
  }

  widen(val: number): void {
    this.left -= val;
    this.bottom -= val;
    this.width += val * 2.0;
    this.height += val * 2.0;
    this.right = this.left + this.width;
    this.top = this.bottom + this.height;
  }
  widened(val: number): Rect {
    return new Rect(this.left - val, this.bottom - val,
        this.width + val * 2.0, this.height + val * 2.0);
  }
  shrink(val: number): void {
    this.left += val;
    this.bottom += val;
    this.width -= val * 2.0;
    this.height -= val * 2.0;
    this.right = this.left + this.width;
    this.top = this.bottom + this.height;
  }

  encapsulate(point: vec2): void {
    this.left = Math.min(this.left, point[0]);
    this.right = Math.max(this.right, point[0]);
    this.bottom = Math.min(this.bottom, point[1]);
    this.top = Math.max(this.top, point[1]);
    this.width = this.right - this.left;
    this.height = this.top - this.bottom;
  }
}


// Constants shared with the shader configuration.
// Changes to these values need ot be reflected in the shader as well.

// Command types
const enum CMD {
  LINE     = 1,
  FRAME    = 4,
  ORI_RECT = 5,
  GIFT     = 6,
}

// Rendering context
const MAX_CMD_BUFFER_LINE = 512; // Note: constants are hardcoded on the shader side as well.
const MAX_CMD_DATA   = MAX_CMD_BUFFER_LINE * MAX_CMD_BUFFER_LINE;
const MAX_STYLE_CMDS = MAX_CMD_BUFFER_LINE;
const MAX_SHAPE_CMDS = MAX_CMD_DATA - MAX_STYLE_CMDS;
const TILE_SIZE = 5;            // Tile side: 32 pixels = 5 bits.
const MAX_TILES = 4 * 1024 - 1; // Must fit in the tileCmdRanges texture. +1 to fit the end index of the last tile.
const MAX_CMDS_PER_TILE = 64;
const TILE_CMDS_BUFFER_LINE = 256;


class UIRenderer {
  // Rendering context
  private gl: WebGL2RenderingContext;

  // Callback to trigger a redraw of the view component using this renderer.
  private readonly redrawCallback: () => void;

  // Viewport transform
  private viewport = {width: 1, height: 1};

  // Shader data
  private shaderInfo;
  private buffers;
  private cmdData = new Float32Array(MAX_CMD_DATA * 4); // Pre-allocate commands of 4 floats (128 width).
  private cmdDataIdx = 0;

  // Tiles
  private num_tiles_x = 1;
  private num_tiles_y = 1;
  private num_tiles_n = 1;
  private cmdsPerTile = new Array<Uint16Array>(MAX_TILES); // Unpacked list of commands, indexed by tile. Used when adding shapes.
  private tileCmds = new Uint16Array(TILE_CMDS_BUFFER_LINE * TILE_CMDS_BUFFER_LINE); // Packed list of commands.
  private tileCmdRanges = new Uint16Array(MAX_TILES + 1); // Where each tile's data is in tileCmds. List of start indexes.

  // Style
  private styleDataStartIdx = (MAX_CMD_DATA - MAX_STYLE_CMDS) * 4; // Start writing style to the last cmd data texture line.
  private styleDataIdx = this.styleDataStartIdx;
  private styleStep = 2 * 4; // Number of floats that a single style needs.

  // State
  private stateColor : vec4 = [-1, -1, -1, -1];
  private stateLineWidth = 1.0;
  private stateCorner = 0.0;
  private stateChanges = 0;


  addFrame(left: number, bottom: number, width: number, height: number, lineWidth: number, color: vec4, cornerWidth = 0): void {
    const bounds = new Rect(left, bottom, width, height);
    this.addPrimitiveShape(CMD.FRAME, bounds, color, lineWidth, cornerWidth);
  }

  addLine(p1: vec2, p2: vec2, width: number, color: vec4): void {
    const bounds = new Rect(p1[0], p1[1], 0, 0);
    bounds.encapsulate(p2);
    bounds.widen(Math.round(width * 0.5 + 0.01));
    if (this.addPrimitiveShape(CMD.LINE, bounds, color, width, 0)) {
      let w = this.cmdDataIdx;
      // Data 2 - Shape parameters
      this.cmdData[w++] = p1[0];
      this.cmdData[w++] = p1[1];
      this.cmdData[w++] = p2[0];
      this.cmdData[w++] = p2[1];

      this.cmdDataIdx = w;
    }
  }

  addOrientedRect(pos: vec2, ori: vec2, width: number, height: number, color: vec4, patternIdx: number) {
    const bounds = new Rect(pos[0], pos[1], 0, 0);
    const halfWidth = width*0.5+1;
    const halfHeight = height*0.5+1;
    bounds.widen(Math.sqrt(halfWidth*halfWidth + halfHeight*halfHeight));
    if (this.addPrimitiveShape(CMD.ORI_RECT, bounds, color, 0, 0)) {
      let w = this.cmdDataIdx;
      // Data 2 - Shape parameters
      this.cmdData[w++] = pos[0];
      this.cmdData[w++] = pos[1];
      this.cmdData[w++] = ori[0];
      this.cmdData[w++] = ori[1];
      // Data 3 - Shape parameters II
      this.cmdData[w++] = width;
      this.cmdData[w++] = height;
      this.cmdData[w++] = patternIdx;
      w += 1;

      this.cmdDataIdx = w;
    }
  }

  addGift(pos: vec2, ori: vec2, width: number, height: number, tierIdx: number) {
    const bounds = new Rect(pos[0], pos[1], 0, 0);
    const halfWidth = width*0.5+1;
    const halfHeight = height*0.5+1;
    bounds.widen(Math.sqrt(halfWidth*halfWidth + halfHeight*halfHeight));
    if (this.addPrimitiveShape(CMD.GIFT, bounds, this.stateColor, this.stateLineWidth, this.stateCorner)) {
      let w = this.cmdDataIdx;
      // Data 2 - Shape parameters
      this.cmdData[w++] = pos[0];
      this.cmdData[w++] = pos[1];
      this.cmdData[w++] = ori[0];
      this.cmdData[w++] = ori[1];
      // Data 3 - Shape parameters II
      this.cmdData[w++] = tierIdx;
      w += 3;

      this.cmdDataIdx = w;
    }
  }


  // Internal functions to write data to the command buffers.

  // Private. Write the given shape to the global command buffer and add it to the tiles with which it overlaps.
  // Returns false if it was unable to allocate the command.
  writeCmdToTiles(cmdType: CMD, bounds: Rect): boolean {

    // Get the w(rite) index for the global command buffer.
    let w = this.cmdDataIdx;
    // Check for at least 4 free command slots as that's the maximum a shape might need.
    if (w/4 + 4 > MAX_SHAPE_CMDS) {
      console.warn("Too many shapes to draw.", w/4 + 4, "of", MAX_SHAPE_CMDS);
      return false;
    }

    // Add the command index to the command list of all the tiles that might draw it.
    {
      // Get the shape's bounds in tile index space.
      const shape_tile_start_y = Math.max(bounds.bottom >> TILE_SIZE, 0);
      const shape_tile_start_x = Math.max(bounds.left >> TILE_SIZE, 0);
      const shape_tile_end_x = Math.min(bounds.right >> TILE_SIZE, this.num_tiles_x - 1);
      const shape_tile_end_y = Math.min(bounds.top >> TILE_SIZE, this.num_tiles_y - 1);
      //console.log(cmdType, w/4, "bounds l,r,b,t:", bounds.left, bounds.right, bounds.bottom, bounds.top,
      //    "tiles l,r,b,t:", shape_tile_start_x, shape_tile_end_x, shape_tile_start_y, shape_tile_end_y)

      for (let y = shape_tile_start_y; y <= shape_tile_end_y; y++) {
        for (let x = shape_tile_start_x; x <= shape_tile_end_x; x++) {
          const tile_idx = y * this.num_tiles_x + x;
          const num_tile_cmds = ++this.cmdsPerTile[tile_idx][0];
          if (num_tile_cmds > MAX_CMDS_PER_TILE - 2) {
            console.warn("Too many shapes in a single tile");
          }
          this.cmdsPerTile[tile_idx][num_tile_cmds] = w / 4;
        }
      }
    }

    // Write the command data to the global command buffer.
    // Data 0 - Header
    this.cmdData[w++] = cmdType;
    this.cmdData[w++] = (this.styleDataIdx - this.styleDataStartIdx - this.styleStep) / 4;
    w += 2;
    // Data 1 - Bounds
    this.cmdData[w++] = bounds.left;
    this.cmdData[w++] = bounds.bottom;
    this.cmdData[w++] = bounds.right;
    this.cmdData[w++] = bounds.top;
    // Update write index
    this.cmdDataIdx = w;

    return true;
  }

  // Private. Write the given style to the global style buffer if it is different from the current active style.
  pushStyleIfNew(color: vec4, lineWidth: number | null, corner: number | null): void {

    if (!this.stateColor.every((c, i) => c === color[i]) // Is color array different?
        || (lineWidth !== null && this.stateLineWidth !== lineWidth) // Is line width used for this shape and different?
        || (corner !== null && this.stateCorner !== corner)
    ) {
      this.stateColor = color;
      this.stateLineWidth = lineWidth ?? 1.0;
      this.stateCorner = corner ?? 0.0;
      this.stateChanges++;

      let sw = this.styleDataIdx;
      // Check for the required number of style data slots.
      if ((sw - this.styleDataStartIdx)/4 + 2 > MAX_STYLE_CMDS) {
        console.warn("Too many different styles to draw.", sw/4 + 2, "of", MAX_STYLE_CMDS);
        // Overwrite first styles.
        sw = this.styleDataStartIdx;
      }

      // Data 0 - Header
      this.cmdData[sw++] = this.stateLineWidth;
      this.cmdData[sw++] = this.stateCorner;
      sw += 2; // Unused.
      // Data 1 - Color
      this.cmdData.set(this.stateColor, sw);
      sw += 4;
      this.styleDataIdx = sw;
    }
  }

  // Private. Write the given shape and its style to the command buffers, if it is in the current view.
  addPrimitiveShape(cmdType: CMD, bounds: Rect, color: vec4, lineWidth: number, corner: number): boolean {

    // Clip bounds.
    if (bounds.right < 0 || bounds.left > this.viewport.width
      || bounds.top < 0 || bounds.bottom > this.viewport.height ) {
      return false;
    }

    // Check for a change of style and push a new style if needed.
    this.pushStyleIfNew(color, lineWidth, corner);

    // Write the shape command to the command buffer and add it to the tiles with which this shape overlaps.
    return this.writeCmdToTiles(cmdType, bounds);
  }

  // Render Loop

  // Initialize the state for a new frame
  beginFrame(): void {
    // Cache the viewport size and number of tiles for this frame.
    this.viewport.width = this.gl.canvas.offsetWidth;
    this.viewport.height = this.gl.canvas.offsetHeight;

    this.num_tiles_x = (this.viewport.width >> TILE_SIZE) + 1;
    this.num_tiles_y = (this.viewport.height >> TILE_SIZE) + 1;
    this.num_tiles_n = this.num_tiles_x * this.num_tiles_y;
    if (this.num_tiles_n > MAX_TILES) {
      console.warn("Too many tiles: ",
          this.num_tiles_n, "(", this.num_tiles_x, "x", this.num_tiles_y, "). Max is", MAX_TILES);
    }
    //console.log("vp", this.viewport.width, "x" ,this.viewport.height, "px. tiles", this.num_tiles_x, "x", this.num_tiles_y, "=", this.num_tiles_n);

    // Clear the command ranges for each tile that will be used this frame.
    for (let i = 0; i < this.num_tiles_n + 1; i++) {
      this.tileCmdRanges[i] = 0;
    }
    // Clear the commands and allocate space for each tile that will be used this frame.
    for (let i = 0; i < this.num_tiles_n; i++) {
      this.cmdsPerTile[i] = new Uint16Array(MAX_CMDS_PER_TILE);
    }
  }

  // Draw a frame with the current primitive commands.
  draw(): void {
    const gl = this.gl;

    // Set this view to occupy the full canvas.
    gl.viewport(0, 0, this.viewport.width, this.viewport.height);

    // Bind the shader.
    gl.useProgram(this.shaderInfo.program);

    gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.COLOR]);

    // Set the transform.
    gl.uniform2f(this.shaderInfo.uniforms.vpSize, this.viewport.width, this.viewport.height);

    // Bind the vertex data for the shader to use and specify how to interpret it.
    // The shader works as a full size rect, new coordinates don't need to be set per frame.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.pos);
    gl.enableVertexAttribArray(this.shaderInfo.attrs.vertexPos);
    gl.vertexAttribPointer(
      this.shaderInfo.attrs.vertexPos, // Shader attribute index
      2,         // Number of elements per vertex
      gl.FLOAT,  // Data type of each element
      false,     // Normalized?
      0,         // Stride if data is interleaved
      0          // Pointer offset to start of data
    );

    // Transfer texture data and bind to the shader samplers.
    // Note: sampler indexes are hardcoded in the shader's sample_texture().
    let textureUnit = 0;

    // Upload the command buffers to the GPU.
    {
      const numCmds = this.cmdDataIdx / 4;
      //console.log(numCmds, "commands, state changes:", this.stateChanges);

      gl.activeTexture(gl.TEXTURE0 + textureUnit);
      gl.bindTexture(gl.TEXTURE_2D, this.buffers.cmdBufferTexture);
      // Transfer commands.
      let width = Math.min(numCmds, MAX_CMD_BUFFER_LINE);
      let height = Math.ceil(numCmds / MAX_CMD_BUFFER_LINE);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, // Transfer data
          0, 0, width, height, // x,y offsets, width, height.
          gl.RGBA, gl.FLOAT, // Source format and type.
          this.cmdData);
      // Transfer styles.
      const numStyleData = (this.styleDataIdx - this.styleDataStartIdx) / 4;
      const styleWidth = Math.min(numStyleData, MAX_CMD_BUFFER_LINE);
      gl.texSubImage2D(gl.TEXTURE_2D, 0,
          0, MAX_CMD_BUFFER_LINE - 1, styleWidth, 1, // x,y offsets, width, height.
          gl.RGBA, gl.FLOAT,
          this.cmdData, this.styleDataStartIdx);
      gl.uniform1i(this.shaderInfo.uniforms.cmdBufferTex, textureUnit++); // Set shader sampler to use TextureUnit X

      // Pack the commands per tile.
      // Flatten each tile command list into a single array. Store the start of each tile command list in tileCmdRanges.
      let tileCmdIdx = 0;
      for (let ti = 0; ti < this.num_tiles_n; ti++) {
        this.tileCmdRanges[ti] = tileCmdIdx;
        for (let i = 0; i < this.cmdsPerTile[ti][0]; i++) {
          this.tileCmds[tileCmdIdx++] = this.cmdsPerTile[ti][i + 1];
        }
      }
      this.tileCmdRanges[this.num_tiles_n] = tileCmdIdx;

      // Transfer commands per tile
      gl.activeTexture(gl.TEXTURE0 + textureUnit);
      gl.bindTexture(gl.TEXTURE_2D, this.buffers.tileCmdsTexture);
      width = Math.min(tileCmdIdx, TILE_CMDS_BUFFER_LINE);
      height = Math.ceil(tileCmdIdx / TILE_CMDS_BUFFER_LINE);
      gl.texSubImage2D(gl.TEXTURE_2D, 0,
          0, 0, width, height, // x,y offsets, width, height.
          gl.RED_INTEGER, gl.UNSIGNED_SHORT,
          this.tileCmds);
      gl.uniform1i(this.shaderInfo.uniforms.tileCmdsBufferTex, textureUnit++);

      width = Math.min(this.num_tiles_n, MAX_TILES) + 1;
      gl.activeTexture(gl.TEXTURE0 + textureUnit);
      gl.bindTexture(gl.TEXTURE_2D, this.buffers.tileCmdRangesTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0,
          0, 0, width, 1, // x,y offsets, width, height.
          gl.RED_INTEGER, gl.UNSIGNED_SHORT,
          this.tileCmdRanges);
      gl.uniform1i(this.shaderInfo.uniforms.tileCmdRangesBufferTex, textureUnit++);
    }

    // Draw
    gl.drawArrays(gl.TRIANGLE_STRIP,
      0, // Offset.
      4  // Vertex count.
    );

    // Unbind the buffers and the shader.
    gl.disableVertexAttribArray(this.shaderInfo.attrs.vertexPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
    gl.useProgram(null);

    // Clear the draw list.
    this.cmdDataIdx = 0;
    // Clear the state.
    this.stateColor = [-1, -1, -1, -1];
    // Clear the style list.
    this.styleDataIdx = this.styleDataStartIdx;
    this.stateChanges = 0;
  }

  // Initialize the renderer: compile the shader and setup static data.
  constructor(canvas: HTMLCanvasElement, redrawCallback: () => void,
              colorBg: vec4 = [0.7176470588235294, 0.7529411764705882, 0.9, 1.0],
              giftColors: Array<vec4>, giftWidths: Array<number>, giftHeights: Array<number>) {
    this.redrawCallback = redrawCallback;

    // Initialize the GL context.
    const gl = canvas.getContext('webgl2');
    if (!gl) {
      // Only continue if WebGL is available and working.
      alert('Unable to initialize WebGL. Your browser may not support WebGL2.');
      throw new Error("UIRenderer failed to get WebGL 2 context");
    }
    this.gl = gl;


    // Load the shader code onto the GPU and compile shaders.
    const shaderProgram = initShaderProgram(gl, vs_source, fs_source);
    if (shaderProgram === null) {
      throw new Error("UIRenderer failed to initialize shader");
    }

    // Collect the shader's attribute locations.
    this.shaderInfo = {
      program: shaderProgram,
      attrs: {
        vertexPos: bindAttr(gl, shaderProgram, 'v_pos'),
      },
      uniforms: {
        vpSize: bindUniform(gl, shaderProgram, 'viewport_size'),
        bgColor: bindUniform(gl, shaderProgram, 'color_bg'),
        giftColors: bindUniform(gl, shaderProgram, 'gift_colors'),
        giftSizes: bindUniform(gl, shaderProgram, 'gift_sizes'),
        cmdBufferTex: bindUniform(gl, shaderProgram, 'cmd_data'),
        tileCmdRangesBufferTex: bindUniform(gl, shaderProgram, 'tile_cmd_ranges'),
        tileCmdsBufferTex: bindUniform(gl, shaderProgram, 'tile_cmds'),
      },
    };

    // Generate GPU buffer IDs that will be filled with data later for the shader to use.
    this.buffers = {
      pos: gl.createBuffer(),
      // Sadly, WebGL2 does not support Buffer Textures (no gl.texBuffer() or gl.TEXTURE_BUFFER target).
      // It doesn't support 1D textures either. We're left with a UBO or a 2D image for command data storage.
      // Chose a 2D image because it can support more data than the UBO.
      cmdBufferTexture: gl.createTexture(),
      tileCmdRangesTexture: gl.createTexture(),
      tileCmdsTexture: gl.createTexture(),
    };

    // Set the vertex positions as a full size rect. Done once, never changes.
    const positions = new Float32Array([
      1.0, 1.0, -1.0, 1.0, 1.0, -1.0, -1.0, -1.0,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.pos);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW); // Transfer data to GPU

    // Create the texture object to be associated with the commands buffer.
    gl.bindTexture(gl.TEXTURE_2D, this.buffers.cmdBufferTexture);
    gl.texStorage2D(gl.TEXTURE_2D, // Allocate immutable storage.
      1, // Number of mip map levels.
      gl.RGBA32F, // GPU internal format: 4x 32bit float components.
      MAX_CMD_BUFFER_LINE, MAX_CMD_BUFFER_LINE); // Width, height.
    disableMipMapping(gl);

    // Create the texture object to be associated with the tile ranges buffer.
    gl.bindTexture(gl.TEXTURE_2D, this.buffers.tileCmdRangesTexture);
    gl.texStorage2D(gl.TEXTURE_2D, // Allocate immutable storage.
      1, // Number of mip map levels.
      gl.R16UI, // GPU internal format: 16bit unsigned integer components.
      MAX_TILES + 1, 1); // Width, height.
    disableMipMapping(gl);

    // Create the texture object to be associated with the tile commands buffer.
    gl.bindTexture(gl.TEXTURE_2D, this.buffers.tileCmdsTexture);
    gl.texStorage2D(gl.TEXTURE_2D, // Allocate immutable storage.
      1, // Number of mip map levels.
      gl.R16UI, // GPU internal format: 16bit unsigned integer components.
      TILE_CMDS_BUFFER_LINE, TILE_CMDS_BUFFER_LINE); // Width, height.
    disableMipMapping(gl);

    // Setup the rendering constants: background color, gift colors and sizes.
    {
      gl.useProgram(this.shaderInfo.program);
      // Set bg color.
      gl.uniform4f(this.shaderInfo.uniforms.bgColor, colorBg[0], colorBg[1], colorBg[2], colorBg[3]);
      // Set gift colors.
      const giftColorData = new Float32Array(giftColors.length * 4); // vec4
      let i = 0;
      for (const color of giftColors) {
        giftColorData[i++] = color[0];
        giftColorData[i++] = color[1];
        giftColorData[i++] = color[2];
        giftColorData[i++] = color[3];
      }
      gl.uniform4fv(this.shaderInfo.uniforms.giftColors, giftColorData);
      // Set gift width and height.
      const giftSizesData = new Float32Array(giftWidths.length * 2); // vec2
      i = 0;
      for (var j=0; j<giftWidths.length; j++) {
        giftSizesData[i++] = giftWidths[j];
        giftSizesData[i++] = giftHeights[j];
      }
      gl.uniform2fv(this.shaderInfo.uniforms.giftSizes, giftSizesData);
      gl.useProgram(null);
    }
  }
}


function disableMipMapping(gl: WebGL2RenderingContext) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

// Get the shader location of an attribute of a shader by name.
function bindAttr(gl: WebGL2RenderingContext, program: WebGLProgram, attrName: string): GLint {
  const attr_idx = gl.getAttribLocation(program, attrName);
  if (attr_idx === -1)
    throw new Error("UIRenderer: Can not bind attribute '" + attrName + "'. Misspelled in renderer or shader code?");
  return attr_idx;
}


// Get the shader location of an uniform of a shader by name.
function bindUniform(gl: WebGL2RenderingContext, program: WebGLProgram, attrName: string): WebGLUniformLocation {
  const loc = gl.getUniformLocation(program, attrName);
  if (loc === null)
    throw new Error("UIRenderer: Can not bind uniform '" + attrName + "'. Misspelled in renderer or shader code?");
  return loc;
}


// Initialize a shader program with th given vertex and fragment shader source code.
function initShaderProgram(gl: WebGL2RenderingContext, vs_source: string, fs_source: string): WebGLProgram | null {

  const vs = loadShader(gl, gl.VERTEX_SHADER, vs_source);
  const fs = loadShader(gl, gl.FRAGMENT_SHADER, fs_source);
  if (vs === null || fs === null)
    return null;

  // Create the shader program
  const program = gl.createProgram() as WebGLProgram;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  // Check for failure
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('UIRenderer: An error occurred compiling a shader program: ' + gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return program;
}


// Creates a shader of the given type with the given source code and compiles it.
function loadShader(gl: WebGL2RenderingContext, shader_type: GLenum, source_code: string): WebGLShader | null {

  const shader = gl.createShader(shader_type) as WebGLShader;

  //console.log("Compiling", (shader_type===gl.VERTEX_SHADER)? "Vertex" : "Fragment", "Shader...");

  gl.shaderSource(shader, source_code);
  gl.compileShader(shader);

  // See if it compiled successfully
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('UIRenderer: An error occurred compiling a shader: ' + gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}


export { Rect, UIRenderer };
export type { vec2, vec4 };
