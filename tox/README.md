# Asemic TouchDesigner Extension

This folder contains the files needed to create a TouchDesigner .tox extension based on the Asemic web worker.

## Files Structure

- `AsemicExtension.py` - Main extension logic
- `README.md` - This file
- `component_setup.md` - Instructions for setting up the .tox structure

## How to Create the .tox

1. **Create Base Component**

   - In TouchDesigner, create a new Base COMP
   - Name it "AsemicExtension"

2. **Add Child Components**

   - Text DAT named "sourceDAT" for source code input
   - Table DAT named "paramsDAT" for parameters
   - Geometry COMP named "geometryComp" for visual output
   - Audio Device Out CHOP named "audioOut" for audio
   - Movie File Out TOP named "movieOut" for recording

3. **Setup Extension**

   - In the Base COMP's Extensions, add a new extension
   - Set the file to point to `AsemicExtension.py`
   - Set the class name to `AsemicExtension`

4. **Add Callbacks**

   - In the Base COMP callbacks, add:
     - `onParChange` -> `ext.onParamChange(par)`
     - `onPulse` -> `ext.onPulse(par)`

5. **Configure Components**
   - Set the sourceDAT to use callbacks: `ext.onSourceChange(me)`
   - Configure the geometryComp with a Geometry SOP inside
   - Setup the movieOut with appropriate codec settings

## Key Differences from Web Worker

### Threading

- TouchDesigner doesn't use web workers
- Animation is handled via TD's timeline or timer callbacks
- Use `run()` function for delayed execution

### Rendering

- Instead of WebGPU/Canvas, uses TouchDesigner's SOP geometry
- Visual output goes through Geometry COMPs and Render TOPs
- Audio output uses CHOPs instead of web audio

### Data Flow

- Parameters flow through TouchDesigner's parameter system
- No message passing - direct method calls
- Use callbacks for reactive updates

### File I/O

- TouchDesigner has built-in file operations
- Can directly read/write files without web restrictions

## Usage

1. Load your Asemic source code into the sourceDAT
2. Use the custom parameters to control playback
3. Visual output appears in the geometryComp
4. Audio output goes to the audioOut CHOP
5. Enable recording to capture video output

## TODO

The following features need to be implemented by porting from the TypeScript codebase:

- [ ] Complete parser logic from `Parser.ts`
- [ ] Renderer implementations for visual output
- [ ] Audio rendering and OSC output
- [ ] File loading and preset management
- [ ] Transform calculations and animations
- [ ] Proper geometry generation from parsed data

## Development Notes

This extension provides the framework for the TouchDesigner version. The actual parsing and rendering logic would need to be ported from the existing TypeScript classes:

- `Parser.ts` -> Python parser implementation
- `AsemicVisual.ts` / `WebGPURenderer.ts` -> TouchDesigner SOP geometry
- `AsemicAudio.ts` -> TouchDesigner CHOP audio
- Web worker message system -> TouchDesigner callbacks
