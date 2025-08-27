# TouchDesigner Component Setup Guide

This document provides step-by-step instructions for creating the Asemic .tox component structure in TouchDesigner.

## Component Hierarchy

```
AsemicExtension (Base COMP)
├── sourceDAT (Text DAT)
├── paramsDAT (Table DAT)
├── geometryComp (Geometry COMP)
│   └── geo1 (Geometry SOP)
├── audioOut (Audio Device Out CHOP)
├── movieOut (Movie File Out TOP)
└── timer1 (Timer CHOP)
```

## Step-by-Step Setup

### 1. Create Base Component

1. In TouchDesigner Network Editor, press Tab and type "base"
2. Select "Base COMP" and place it
3. Rename to "AsemicExtension"
4. Double-click to enter the component

### 2. Add Source Input (Text DAT)

1. Press Tab, type "text", select "Text DAT"
2. Rename to "sourceDAT"
3. In the Text DAT parameters:
   - Set "Language" to "Other"
   - Set "Word Wrap" to "Off"
   - In the "Text" page, you can paste initial Asemic source code

### 3. Add Parameters Table (Table DAT)

1. Press Tab, type "table", select "Table DAT"
2. Rename to "paramsDAT"
3. This will store runtime parameters and their values
4. Set up initial columns: "Name", "Value", "Type"

### 4. Add Geometry Output (Geometry COMP)

1. Press Tab, type "geo", select "Geometry COMP"
2. Rename to "geometryComp"
3. Double-click to enter it
4. Inside, add a Geometry SOP:
   - Press Tab, type "geo", select "Geometry SOP"
   - Rename to "geo1"
   - This will receive the generated geometry

### 5. Add Audio Output (Audio Device Out CHOP)

1. Go back to main component level
2. Press Tab, type "audiodeviceout", select "Audio Device Out CHOP"
3. Rename to "audioOut"
4. Configure output device in parameters

### 6. Add Video Recording (Movie File Out TOP)

1. Press Tab, type "moviefileout", select "Movie File Out TOP"
2. Rename to "movieOut"
3. In parameters:
   - Set codec (recommend H.264)
   - Set output file path
   - Set "Record" to pulse parameter

### 7. Add Timer (Timer CHOP)

1. Press Tab, type "timer", select "Timer CHOP"
2. Rename to "timer1"
3. Set "Start" to "On"
4. This provides timing reference for animation

## Extension Setup

### 1. Add Extension

1. Select the base "AsemicExtension" component
2. Go to the "Extensions" page in parameters
3. Click the "+" to add a new extension
4. Set:
   - File: point to your `AsemicExtension.py` file
   - Function: leave blank (uses class)
   - Class Name: `AsemicExtension`

### 2. Setup Callbacks

In the "Callbacks" page of the base component, add:

#### onParChange

```python
# Called when any parameter changes
ext.onParamChange(par)
```

#### onPulse

```python
# Called when pulse parameters are triggered
ext.onPulse(par)
```

#### onCook (optional)

```python
# Called every frame
# ext.onCook()
```

### 3. Setup DAT Callbacks

For the sourceDAT:

1. Select sourceDAT
2. Go to "Callbacks" page
3. Add to "onTableChange":

```python
# Call the extension when source changes
parent().ext.onSourceChange(me)
```

## Custom Parameters

The extension will automatically create these parameters:

- **play** (Toggle) - Start/stop animation
- **progress** (Float) - Scrub through timeline
- **record** (Toggle) - Start/stop recording
- **width** (Integer) - Canvas width
- **height** (Integer) - Canvas height

You can add more parameters manually:

1. Select the base component
2. Go to "Custom" page
3. Click "+" to add new parameters
4. The extension will pick up parameter changes automatically

## Data Flow

```
sourceDAT → Extension Parser → geometryComp (visual)
                            ↘ audioOut (audio)
                            ↘ movieOut (recording)

Parameters → Extension → Update outputs
```

## Testing the Setup

1. Put some test Asemic code in sourceDAT
2. Toggle the "play" parameter
3. Check that the extension initializes without errors
4. Visual output should appear in geometryComp
5. Use "record" parameter to test video capture

## Troubleshooting

### Extension Not Loading

- Check that the Python file path is correct
- Verify the class name is exactly "AsemicExtension"
- Check the Python console for syntax errors

### No Visual Output

- Verify geometryComp has geo1 SOP inside
- Check that the parser is receiving source data
- Enable "Auto Layout" on geometry viewer

### Callbacks Not Working

- Ensure callbacks are typed exactly as shown
- Check that `ext` variable exists (extension loaded)
- Verify parameter names match the extension code

### Performance Issues

- Reduce canvas resolution (width/height parameters)
- Limit animation frame rate
- Optimize the parser logic for complex source code

## Saving as .tox

Once everything is working:

1. Select the base "AsemicExtension" component
2. Right-click → "Save Component"
3. Choose filename ending in ".tox"
4. The component can now be shared and reused

## Advanced Features

### OSC Output

Connect audioOut to OSC Output DATs for external communication

### Multiple Instances

The .tox can be instantiated multiple times with different source code

### Preset Management

Use the paramsDAT to store and recall parameter presets

### External Control

Map custom parameters to MIDI or OSC inputs for live performance
