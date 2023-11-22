# Present for Blender

Explorations for simulating arrangements of 10k objects in a web browser.


## Experiments
- [Jolt.js](src/jolt.html)
- [matter.js](src/matter.html)
- verly.js, box2d,
- [uirenderer-canvas](index.html)


## Development Instructions (uirenderer-sim)

### IDE Configuration
- [vscode-shader](https://open-vsx.org/extension/slevesque/shader)
GLSL support (syntax highlighting, code completion)
- [ESLint](https://marketplace.visualstudio.com/items?itemName=Vdbaeumer.vscode-eslint)
to show warnings from the ESLint yarn installed package directly in the IDE.
- `eslint.experimental.useFlatConfig`

### Update and Run
1. Get the latest changes and update the development environment:
   ```
   git pull
   yarn install
   ```

2. The codebase should always be verified to have no errors or warnings in every commit. The IDE should help.
   ```
   yarn run lint  
   yarn run build
   ```

3. Serve the webpage and reload on change:
   ```
   yarn run dev
   ```
