# Godot MCP Runtime

A lightweight, powerful [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that pairs comprehensive headless scene editing with full runtime control over a **Godot 3.5+** project (natively supported out-of-the-box, optimized for Godot 3.5.x and 3.6.x stable).

Scene, node, scripting, input mapping, resources, shaders, and validation operations cover everything in the engine; the runtime bridge adds screenshots, input simulation, UI discovery, collision queries, ground clamping, and live GDScript execution against the running scene tree.

<p align="center">
  <img src="docs/assets/demo.gif" alt="Agent driving a Godot game via MCP runtime tools" width="1000">
</p>

<h3 align="center">The AI doesn't just write your game - it can test, verify, and profile its work.</h3>

- **Dedicated Godot 3.5+ Support** - Works headlessly and at runtime specifically with Godot 3.x (GDScript 1.0) projects, providing a dedicated toolkit where newer options are missing.
- **Headless Editing** - Create/modify scenes, add/delete nodes, attach scripts, wire signals, compile materials, and validate GDScript, completely in the background.
- **Runtime Telemetry** - Capture screenshots, simulate precise input sequences, perform Control-node UI discovery, query physics server collisions, clamp heights to ground slopes, and record multi-frame telemetry sequences.
- **Transactional Safety** - Non-editor offline operations use an automated snapshot-backup mechanism (`.mcp/backups/`) to permit atomic rollbacks of scene modifications.
- **Self-Healing Bridge** - Autoload bridge runs with keepalive heartbeats and fallback port-scanning, recovering connections automatically upon drop.
- **Zero Footprint** - No editor addons or persistent git pollution; the `McpBridge` autoload is dynamically registered and cleanly dismantled on shutdown.

Think of it as [Playwright MCP](https://github.com/microsoft/playwright-mcp) but engineered for Godot games. Run the project, capture screenshots, query the physics world, simulate inputs, and execute scripts against the live tree. The AI agent closes the loop on its own changes instead of handing off to a human to verify.

> [!NOTE]
> This is a highly optimized, pipeline-oriented developer kit. What it does is let an agent programmatically confirm that scenes load without crashing, buttons respond, score values update, vehicle colliders query the physics engine, and GDScripts run without throwing stack errors.

---

## Contents

1. [Architectural Highlights & Compatibility](#architectural-highlights--compatibility)
2. [Quick Start & IDE Installation](#quick-start--ide-installation)
3. [Native JSON-RPC Testing](#native-json-rpc-testing)
4. [Programmatic Operations Pipeline](#programmatic-operations-pipeline)
5. [Tool Schema Reference](#tool-schema-reference)
6. [Docs & Development](#docs--development)
7. [License](#license)

---

## Architectural Highlights & Compatibility

To achieve absolute compatibility and high-throughput execution in **Godot 3.5+ (GDScript 1.0)**, this runtime resolves critical technical constraints:

### 1. Headless Execution via `--no-window`
Godot 3.x does not support the `--headless` CLI flag. Launching with `--headless` causes the executable to exit immediately with code `0`. We resolve this by running with the `--no-window` parameter, which launches the engine with a hidden, off-screen window. This allows headless background operations to run flawlessly on Windows display servers.

### 2. GDScript 1.0 Membership Negation Syntax
GDScript 1.0 does not support the compound `not in` membership negation operator (e.g. `item not in cache`), which results in syntax crashes. We normalize all membership negation expressions to `not (item in cache)` which parses cleanly on the Godot 3.x parser.

### 3. Real Type Serialization
Godot 3.x uses `TYPE_REAL` as its core float type identifier rather than `TYPE_FLOAT`. The runtime correctly maps float types to `TYPE_REAL` to ensure precise, error-free type serialization.

### 4. Correct `ResourceSaver` API Signature
The `ResourceSaver.save` signature in Godot 3.x is:
- `ResourceSaver.save(path, resource)`
The server programmatically handles and serializes this signature format, saving scenes safely without throwing invalid argument type exceptions.

### 5. Type-Safe Auto-Coercion Layer
To eliminate type mismatch crashes, all node and property mutation tools feature auto-coercion. When an agent sends a formatted string like `"Vector2(100, 200)"`, `"Color("#ff0000")"`, or `"Vector3(0, 1.5, 0)"`, the bridge compiles these expressions headlessly using standard Godot `Expression` structures, converting them to native typed engine objects before application.

### 6. Transactional Safety & Local Snapshots
Headless operations run completely outside active GUI editor sessions, meaning they cannot access the `EditorUndoRedoManager`. Accessing active editor buffers in headless processes throws fatal crashes. We resolve this by implementing an offline snapshot-backup pipeline in the Node layer. Before any scene or node modification, the raw file is baked into `.mcp/backups/`, permitting robust offline rollbacks.

---

## Quick Start & IDE Installation

### Prerequisites
- [Node.js](https://nodejs.org/) v20+
- [Godot 3.5+](https://godotengine.org/) (Download stable binary)

### IDE Configuration (Claude, Cursor, etc.)

Add the following setup to your client's config file (e.g., `C:\Users\<Username>\.gemini\antigravity-ide\mcp_config.json` or `mcp_config.json` in your respective editor configurations).

> [!IMPORTANT]
> **Windows Path Escaping:** Use forward slashes (`/`) or double backslashes (`\\`) in the JSON configuration, and ensure `GODOT_PATH` points directly to the executable file, not just the folder.

```json
{
  "mcpServers": {
    "godot": {
      "command": "node",
      "args": [
        "C:/path/to/godot-mcp-runtime/dist/index.js"
      ],
      "env": {
        "GODOT_PATH": "C:/path/to/Godot_v3.6.2-stable_win64.exe",
        "DEBUG": "true"
      }
    }
  }
}
```

---

## Native JSON-RPC Testing

You can natively verify that the server is working and communicating over standard input/output streams by running the provided testing script:

```bash
# Run compilation
npm run build

# Execute native stdio test
node test_native_mcp.mjs
```

### What `test_native_mcp.mjs` Does:
1. **Initialize Handshake:** Sends an MCP `initialize` request to negotiate client-server capabilities.
2. **List Tools Schema:** Requests `tools/list` to verify that all 78 rich editing and runtime tools are successfully registered.
3. **Execute Tool Call:** Invokes `get_project_info` against a demo project directory to confirm Godot subprocess execution and version parsing (e.g. `3.6.2.stable.official`).

---

## Programmatic Operations Pipeline

You can use the built-in `GodotRunner` within your own scripts to headlessly construct scenes and test features. 

### Example script using `GodotRunner`:
```javascript
import { GodotRunner } from './dist/utils/godot-runner.js';
import { resolve } from 'path';

async function run() {
  const runner = new GodotRunner({ 
    godotPath: 'c:/path/to/Godot_v3.6.2-stable_win64.exe' 
  });
  const projectPath = resolve('./Game');

  // Create a new spatial player scene headlessly
  await runner.executeOperation('create_scene', {
    scene_path: 'res://Player.tscn',
    root_node_type: 'KinematicBody'
  }, projectPath);

  // Add a Camera node to Level scene
  await runner.executeOperation('add_node', {
    scene_path: 'res://Level.tscn',
    node_type: 'Camera',
    node_name: 'Camera',
    parent_node_path: 'root'
  }, projectPath);

  console.log("Headless operations pipeline completed successfully!");
}
run();
```

---

## Tool Schema Reference

The server exposes **78 tools** grouped into nine highly optimized operational categories:

### 1. Project Management & Introspection (18 tools)
- `launch_editor` - Open the visual Godot editor GUI.
- `run_project` - Run the game with the `McpBridge` autoload dynamically registered.
- `attach_project` - Connect the runtime bridge to a manually started game instance.
- `detach_project` - Cleanly remove the autoload configuration without affecting the running process.
- `stop_project` - Terminate the active game process and safely unregister the bridge.
- `get_debug_output` - Retrieve stdout and stderr logs of the active game session.
- `list_projects` - Search a directory to find valid Godot projects.
- `get_project_info` - Retrieve engine version details and project metadata.
- `get_project_files` - Output the recursive project file structure with extensions.
- `search_project` - Perform a fast, case-sensitive text search across all project source files.
- `get_scene_dependencies` - Introspect a scene file to output its external resources.
- `get_project_settings` - Read configuration parameters from `project.godot`.
- `set_project_setting` - Mutate `project.godot` parameters natively.
- `set_collision_layer_name` - Tag standard 2D and 3D collision layer names.
- `list_autoloads` / `add_autoload` / `remove_autoload` / `update_autoload` - Manage autoload singletons.

### 2. Runtime Control & Diagnostics (7 tools)
- `take_screenshot` - Capture game screens (preview mode returns low-overhead base64, path mode returns disk path).
- `simulate_input` - Send batched input streams (keypresses, mouse clicks, action triggers, wait frames).
- `get_ui_elements` - Introspect active Control-node dimensions, properties, and text nodes.
- `run_script` - Compile and execute raw GDScript blocks against the live, active SceneTree.
- `get_performance_metrics` - Retrieve engine performance monitors (FPS, process times, static memory).
- `query_spatial_collision` - Natively sweep a trajectory or query the active 2D/3D physics space state.
- `get_ground_clamp` - Project coordinates onto complex mesh terrains to calculate slopes and snaps.

### 3. Scene Mutations (7 tools)
- `create_scene` - Instantly initialize a `.tscn` file with a typed root node.
- `add_node` - Append new nodes to scenes (position, translation, and scale properties).
- `load_sprite` - Configure 2D and 3D sprite textures and texture rectangle parameters.
- `save_scene` - Re-serialize active modifications or execute a save-as operation.
- `export_mesh_library` - Compile grid mesh collections headlessly from scene models.
- `batch_scene_operations` - Pipe multiple scene changes (adds, sprite configuration) in a single run.
- `instance_scene` - Instance subscenes (e.g. vehicles, pedestrian entities) under parent nodes.

### 4. Node Mutations & Operations (26 tools)
- `delete_nodes` - Remove nodes and their children from target scenes.
- `set_node_properties` / `get_node_properties` - Mass-manage node property dictionaries.
- `attach_script` - Wire GDScript source files to specified node targets.
- `get_scene_tree` - Introspect the recursive node hierarchy of a scene file.
- `duplicate_node` - Duplicate target node branches in a scene.
- `get_node_signals` / `connect_signal` / `disconnect_signal` - Manage signal connections.
- `set_node_metadata` / `get_node_metadata` - Configure key-value metadata dictionaries.
- `setup_control` - Configure layout containers, responsive anchors, and margins.
- `setup_collision` / `setup_collision_3d` - Setup 2D and 3D collision boundaries.
- `add_mesh_instance` - Attach 3D meshes (cube, cylinder, sphere) to nodes.
- `set_physics_layers` / `get_physics_layers` - Manage collision mask and layer values.
- `add_raycast` - Add spatial sensing RayCast nodes to nodes.
- `setup_camera` - Attach and configure spatial cameras.
- `setup_lighting` / `setup_environment` - Define spatial light assets and environment panels.
- `setup_navigation_3d` - Configure navigation mesh bounds and pathfinder nodes.
- `create_particles_3d` - Setup spatial particle emitter parameters.
- `setup_animation_tree` - Append `AnimationTree` instances with state machineries.
- `setup_joint_3d` - Link physical colliders using standard constraints.
- `generate_gui_hierarchy` - Compile hierarchical GUI structures from clean declarations.

### 5. GDScript & Code Configuration (5 tools)
- `list_script_elements` - Introspect a `.gd` file to map functions, signals, and variables.
- `add_script_variable` - Inject custom class variables and editor exports.
- `add_script_signal` / `add_script_function` / `remove_script_function` - Mutate GDScript members.

### 6. Input Action Mapping (3 tools)
- `list_input_actions` / `add_input_action` / `remove_input_action` - Mutate game input maps inside `project.godot`.

### 7. Resources, Materials & Shaders (6 tools)
- `create_tres_resource` - Generate spatial materials and style boxes in offline INI formats.
- `apply_spatial_material` - Bind custom materials to mesh instances.
- `compile_material_tree` - Natively compile nested material files with texture mappings.
- `create_shader_resource` - Output clean `.shader` canvas and spatial templates.
- `apply_shader_material` - Wire shaders to target nodes and configure properties.
- `import_resource` - Trigger headless importing processes for imported textures and models.

### 8. GridMap & TileMap Placement (2 tools)
- `set_tilemap_cell` - Place tiles inside 2D `TileMap` structures.
- `set_gridmap_cell` - Configure coordinates inside 3D `GridMap` structures.

### 9. Animation Editing & Piping (3 tools)
- `configure_animation` - Manage keyframes and tracks on `AnimationPlayer` nodes.
- `get_animation_list` - Enumerate animations declared in a target scene.
- `pipe_animation_states` - Build clean state transition machineries declaratively.

### 10. Script & Scene Validation (1 tool)
- `validate` - Perform syntax audits and resource reference checking headlessly.

---

## Docs & Development

Explore the `/docs` directory for detailed technical guides:
- [`docs/tools.md`](docs/tools.md) - Comprehensive API schema parameters.
- [`docs/architecture.md`](docs/architecture.md) - Internal processes, thread pipelines, and data-flow diagrams.

---

## License

This project is licensed under the [MIT License](LICENSE).
