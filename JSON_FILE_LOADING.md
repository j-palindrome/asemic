# JSON File Upload & Parsing Feature

This feature adds comprehensive support for loading and parsing JSON files in the Asemic application using Tauri's file operations.

## Overview

The JSON file upload functionality allows users to:

- Load JSON files from the file system via a file dialog
- Validate JSON structure and content
- Parse loaded data into scene configurations
- Automatically integrate loaded scenes into the application

## Architecture

### Components

#### 1. Tauri Backend (`src-tauri/src/main.rs`)

Two new Tauri commands:

**`load_json_file(file_path: String) -> Result<JsonFileData, String>`**

- Validates file exists and is a `.json` file
- Reads file content from disk
- Validates JSON syntax
- Returns file data with metadata

**`parse_json_file(json_content: String, file_name: String) -> ParsedJsonResult`**

- Parses JSON string into a Value
- Generates preview information
- Returns structured result with success/error status

#### 2. React Hook (`src/renderer/hooks/useJsonFileLoader.ts`)

`useJsonFileLoader()` - Custom hook providing:

- `selectAndLoadJsonFile()` - Opens file dialog and loads JSON
- `clearError()` - Clears error messages
- `reset()` - Resets state
- State: `isLoading`, `error`, `fileName`, `data`

#### 3. UI Component (`src/renderer/components/JsonFileLoader.tsx`)

`JsonFileLoader` - React component with:

- Load button with file dialog
- Error display with dismiss
- Success message with preview
- Loading state handling

#### 4. Integration (`src/renderer/app/AsemicApp.tsx`)

- `handleJsonFileLoaded()` handler converts loaded JSON to scenes format
- Displays loader in scene settings panel
- Auto-updates scenes when JSON is loaded

## Usage

### Basic Usage (React Component)

```tsx
import { JsonFileLoader } from '@/renderer/components/JsonFileLoader'
import { ParsedJsonResult } from '@/renderer/hooks/useJsonFileLoader'

function MyComponent() {
  const handleFileLoaded = (result: ParsedJsonResult) => {
    if (result.success && result.data) {
      // Process the loaded data
      console.log('Loaded:', result.data)
    }
  }

  return <JsonFileLoader onFileLoaded={handleFileLoaded} />
}
```

### Using the Hook Directly

```tsx
import { useJsonFileLoader } from '@/renderer/hooks/useJsonFileLoader'

function MyComponent() {
  const { isLoading, error, fileName, data, selectAndLoadJsonFile } =
    useJsonFileLoader()

  return (
    <div>
      <button onClick={selectAndLoadJsonFile} disabled={isLoading}>
        Load JSON
      </button>
      {error && <div>{error}</div>}
      {data?.success && <div>Loaded: {fileName}</div>}
    </div>
  )
}
```

### In AsemicApp

The JSON loader is accessible via the Settings panel (Settings icon in toolbar):

1. Click the Settings icon (`⚙️`) to open scene settings
2. The JSON loader panel appears on the right side
3. Click "Load JSON File" to open file dialog
4. Select a JSON file to load and parse
5. Loaded scenes automatically update the editor

## JSON Format Support

The loader supports multiple JSON formats:

### Format 1: Array of Scenes

```json
[
  {
    "code": "circle(0.5, 0.5, 0.1)",
    "length": 5,
    "offset": 0
  },
  {
    "code": "square(0.3, 0.3, 0.2)",
    "length": 3,
    "offset": 0
  }
]
```

### Format 2: Object with Scenes Property

```json
{
  "scenes": [
    {
      "code": "circle(0.5, 0.5, 0.1)",
      "length": 5
    }
  ]
}
```

### Format 3: Single Scene Object

```json
{
  "code": "circle(0.5, 0.5, 0.1)",
  "length": 5,
  "offset": 0,
  "params": {
    "speed": 1.5,
    "size": 0.75
  }
}
```

## Scene Properties

Supported scene properties:

- **code** (string): Drawing instructions/expressions
- **length** (number, default: 0.1): Scene duration in seconds
- **offset** (number, default: 0): Time offset within scene
- **pause** (number, optional): Pause duration
- **params** (object, optional): Scene parameters
  - Key-value pairs of parameter names and values
  - Example: `{ "speed": 2.5, "size": 0.75 }`
- **osc** (array, optional): OSC messages to send
  - Each item: `{ "name": "/address", "value": number }`

## Error Handling

The loader provides comprehensive error handling:

- **File not found**: Returns clear error message
- **Invalid file extension**: Requires `.json` file
- **Invalid JSON syntax**: Reports parsing errors with line numbers
- **Read errors**: Handles file system read failures

All errors are displayed in the UI with a dismiss button.

## Implementation Details

### Tauri Command Integration

Commands are registered in `main.rs`:

```rust
.invoke_handler(tauri::generate_handler![
    parser_setup,
    parser_draw,
    parser_eval_expression,
    load_json_file,
    parse_json_file,
])
```

### Validation Flow

```
File Dialog → load_json_file → Validate JSON → parse_json_file → Convert to Scenes → Update Editor
```

### Scene Conversion Logic

The `handleJsonFileLoaded()` function in AsemicApp:

1. Checks if result was successful
2. Determines JSON structure (array, object with scenes, or single scene)
3. Converts to `SceneSettings[]` array
4. Serializes to JSON string
5. Updates editor and saves to localStorage

## Type Safety

All types are fully defined in TypeScript:

```typescript
interface JsonFileData {
  content: string
  file_name: string
}

interface ParsedJsonResult {
  success: boolean
  data?: Record<string, any> | any[]
  error?: string
  file_name: string
  preview?: string
}

interface JsonLoadState {
  isLoading: boolean
  error?: string
  fileName?: string
  data?: ParsedJsonResult
}
```

## Security Considerations

- File operations are restricted to user-selected files via file dialog
- JSON is validated before parsing
- No arbitrary code execution
- File size is read in memory (reasonable for most JSON configs)

## Future Enhancements

Potential improvements:

1. **File History**: Remember recently loaded files
2. **Drag & Drop**: Support dropping JSON files on canvas
3. **Export**: Save current scenes as JSON
4. **Templates**: Built-in JSON scene templates
5. **Batch Operations**: Load multiple files at once
6. **JSON Schema Validation**: Validate against schema
7. **Preview in File Dialog**: Show JSON preview before loading

## Troubleshooting

### "File not found" error

- Ensure file path is correct
- Check file permissions

### "Invalid JSON" error

- Validate JSON syntax using a JSON validator
- Check for trailing commas or unquoted keys

### Scenes not updating

- Verify JSON is in supported format
- Check browser console for errors
- Clear browser cache and reload

### File dialog not opening

- Ensure Tauri plugin-dialog is initialized
- Check Tauri capabilities in `capabilities/default.json`

## Examples

### Complete Scene Configuration

```json
[
  {
    "code": "loop(5) { circle(i/5, 0.5, 0.05) }",
    "length": 10,
    "offset": 0,
    "params": {
      "speed": 2.0,
      "size": 1.0
    }
  },
  {
    "code": "square(0.3, 0.3, 0.3)",
    "length": 5,
    "offset": 0.5
  }
]
```

### With OSC Messages

```json
[
  {
    "code": "spiral()",
    "length": 8,
    "osc": [
      { "name": "/synth/freq", "value": 440 },
      { "name": "/synth/volume", "value": 0.8 }
    ]
  }
]
```

## Testing

To test the JSON loading feature:

1. Create a sample JSON file with scene data
2. Run the application
3. Open Settings (⚙️ icon)
4. Click "Load JSON File"
5. Select your JSON file
6. Verify scenes load correctly in editor

## API Reference

### `useJsonFileLoader()`

```typescript
const {
  isLoading: boolean,
  error?: string,
  fileName?: string,
  data?: ParsedJsonResult,
  selectAndLoadJsonFile: () => Promise<ParsedJsonResult | null>,
  clearError: () => void,
  reset: () => void
} = useJsonFileLoader()
```

### `JsonFileLoader` Component Props

```typescript
interface JsonLoaderProps {
  onFileLoaded?: (data: ParsedJsonResult) => void
  className?: string
}
```

### Tauri Commands

```typescript
// Load and validate JSON file
await invoke<JsonFileData>('load_json_file', { filePath })

// Parse JSON content
await invoke<ParsedJsonResult>('parse_json_file', {
  jsonContent: string,
  fileName: string
})
```
