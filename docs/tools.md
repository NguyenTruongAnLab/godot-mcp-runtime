# Tools Reference Catalog

The complete Model Context Protocol (MCP) tool reference for the `godot-mcp-runtime` server. This document catalogs all **80 active tools** categorized across ten highly optimized functional domains.

---

## 1. Project Management & Introspection (18 tools)

These tools introspect the directory workspace, manage general project properties, and edit configuration configurations inside `project.godot` without requiring an active game process.

| Tool | Action | Expected Parameters | Description & Boundaries |
| :--- | :--- | :--- | :--- |
| `launch_editor` | GUI Launch | `projectPath: string` | Launches the visual Godot Editor window. |
| `run_project` | Spawns Subprocess | `projectPath: string`, `background?: boolean`, `bridgePort?: int` | Launches the game, auto-injecting the `McpBridge` autoload. `background: true` positions the window off-screen at `(-9999, -9999)`. |
| `attach_project` | Runtime Listening | `projectPath: string`, `bridgePort?: int` | Prepares the runtime socket to listen for a manually launched game instance. |
| `detach_project` | Shutdown Socket | `projectPath: string` | Safely detaches the active runtime socket without killing the game subprocess. |
| `stop_project` | Kill Subprocess | `projectPath: string` | Terminates the running game process and dynamically dismantles the autoload bridge. |
| `get_debug_output` | Log Inspection | `projectPath: string` | Returns accumulated stdout and stderr logs of the active game session. |
| `list_projects` | File Search | `directoryPath: string` | Searches directories to locate valid folders containing `project.godot` files. |
| `get_project_info` | Engine Probe | `projectPath: string` | Resolves the exact active Godot engine version (e.g. `3.6.2.stable`) and metadata. |
| `get_project_files` | File Tree | `projectPath: string`, `extensions?: string[]` | Outputs the recursive project file structure filtered by custom file extensions. |
| `search_project` | Text Search | `projectPath: string`, `query: string` | Fast text scanner seeking pattern matches across all GDScript and configuration files. |
| `get_scene_dependencies` | Dependency Probe | `projectPath: string`, `scenePath: string` | Lists all external resources (`ExtResource`) that a scene depends on. |
| `get_project_settings` | Settings Read | `projectPath: string`, `section?: string` | Reads configurations from `project.godot`, optionally filtered by target sections. |
| `set_project_setting` | Settings Mutation | `projectPath: string`, `section: string`, `key: string`, `value: any` | Natively updates and serializes settings directly inside `project.godot`. |
| `set_collision_layer_name` | Layer Mapping | `projectPath: string`, `type: "2d" \| "3d"`, `layer: int`, `name: string` | Configures physics collision layer names in project settings. |
| `list_autoloads` | Autoload Probe | `projectPath: string` | Lists all registered project-wide singletons and their paths. |
| `add_autoload` | Autoload Add | `projectPath: string`, `name: string`, `path: string` | Registers a new singleton autoload configuration in `project.godot`. |
| `remove_autoload` | Autoload Remove | `projectPath: string`, `name: string` | Deregisters a singleton autoload, removing its entry from configuration files. |
| `update_autoload` | Autoload Edit | `projectPath: string`, `name: string`, `path: string` | Modifies paths or singleton properties of registered autoload entries. |

---

## 2. Runtime Control & Diagnostics (8 tools)

These tools require an active game process started via `run_project` or `attach_project`. They hook into the live running simulation via the TCP bridge socket.

| Tool | Action | Expected Parameters | Description & Boundaries |
| :--- | :--- | :--- | :--- |
| `take_screenshot` | View Frame | `projectPath: string`, `responseMode?: "preview" \| "full" \| "path_only"`, `previewMaxWidth?: int`, `previewMaxHeight?: int` | Captures a live screenshot. Returns low-overhead base64 images in preview mode (default 960x540) or saves binary files to disk. |
| `simulate_input` | Input Streaming | `projectPath: string`, `events: InputEvent[]` | Pipes a batched list of input events (keys, mouse buttons, motion sweeps, actions, or frame waits). |
| `get_ui_elements` | GUI Probe | `projectPath: string` | Discovers all active, visible Control nodes in the SceneTree, mapping positions and text. |
| `run_script` | Script Injection | `projectPath: string`, `source: string` | Natively compiles and executes arbitrary GDScript code blocks on the live SceneTree. |
| `get_performance_metrics` | Engine Monitor | `projectPath: string` | Returns live hardware profiling values (active FPS, static memory allocations, process times). |
| `query_spatial_collision` | Physics Query | `projectPath: string`, `origin: Vector3`, `destination: Vector3`, `collision_mask?: int`, `exclude_bodies?: string[]` | Queries the active physics server space, checking ray intersections or shape sweeps natively. Excludes listed node paths from collision queries. |
| `get_ground_clamp` | Terrain Snap | `projectPath: string`, `position: Vector2 \| Vector3`, `max_height?: float`, `min_height?: float`, `collision_mask?: int` | Vertical downward raycast column sweep to clamp spawn coordinates precisely onto dynamic terrain colliders. |
| `navigate_to` | Path Autopilot | `projectPath: string`, `targetNodePath: string`, `destination: Vector3`, `speed?: float`, `tolerance?: float`, `timeout?: float`, `navigationNodePath?: string` | Active runtime pathfinding autopilot that moves kinematic, rigid, or standard spatial agents using navigation meshes. |

---

## 3. Scene Mutations (headless) (7 tools)

Headless tools write changes directly to resource files (`.tscn`, `.tres`) offline using AST or regular expression parsers. They do not require an active game process.

| Tool | Action | Expected Parameters | Description & Boundaries |
| :--- | :--- | :--- | :--- |
| `create_scene` | Initialize File | `projectPath: string`, `scenePath: string`, `rootNodeType: string` | Generates a clean `.tscn` file initialized with a typed root node. |
| `add_node` | Node Creation | `projectPath: string`, `scenePath: string`, `nodeType: string`, `nodeName: string`, `parentNodePath: string`, `properties?: Record<string, any>` | Appends a child node to the target scene tree, configuring basic transform properties. |
| `load_sprite` | Sprite Texture | `projectPath: string`, `scenePath: string`, `nodePath: string`, `texturePath: string` | Configures albedo textures on 2D Sprite, 3D Sprite, or TextureRect nodes. |
| `save_scene` | Serializer Save | `projectPath: string`, `scenePath: string`, `newPath?: string` | Forces re-serialization of scene properties or duplicates a scene file via save-as. |
| `export_mesh_library` | Mesh Compiler | `projectPath: string`, `scenePath: string`, `tresPath: string` | Extracts meshes inside a scene and packages them as a GridMap `MeshLibrary` (`.tres`). |
| `batch_scene_operations` | Block Mutation | `projectPath: string`, `scenePath: string`, `operations: SceneOperation[]` | Batches node additions and texture applications in a single subprocess run. |
| `instance_scene` | Subscene Instance | `projectPath: string`, `scenePath: string`, `instancePath: string`, `parentNodePath: string`, `nodeName: string` | Instances an external subscene (e.g. player vehicle or hazard) into the target scene. |

---

## 4. Node Mutations & Operations (headless) (26 tools)

Headless node editors process individual properties and hierarchies inside scene files offline, utilizing the offline transactional snapshot mechanism to permit secure rollbacks.

| Tool | Action | Expected Parameters | Description & Boundaries |
| :--- | :--- | :--- | :--- |
| `delete_nodes` | Tree Removal | `projectPath: string`, `scenePath: string`, `nodePaths: string[]` | Removes target nodes and their descendants recursively from the scene file. |
| `set_node_properties` | Value Setter | `projectPath: string`, `scenePath: string`, `updates: NodeUpdate[]` | Modifies properties in bulk on target nodes. Supports Vector2, Vector3, and Color string auto-coercion. |
| `get_node_properties` | Value Getter | `projectPath: string`, `scenePath: string`, `nodes: NodeRequest[]` | Reads configured properties from target scene nodes. |
| `attach_script` | Script Binding | `projectPath: string`, `scenePath: string`, `nodePath: string`, `scriptPath: string` | Sets a GDScript resource as the script handler for a target scene node. |
| `get_scene_tree` | Tree Inspector | `projectPath: string`, `scenePath: string`, `maxDepth?: int` | Prints the recursive node hierarchy of a scene file on disk. |
| `duplicate_node` | Node Clone | `projectPath: string`, `scenePath: string`, `nodePath: string`, `newName: string` | Duplicates a node branch, appending the copy under the same parent. |
| `get_node_signals` | Signal Probe | `projectPath: string`, `scenePath: string`, `nodePath: string` | Lists declared signals and connections configured for a node. |
| `connect_signal` | Signal Wire | `projectPath: string`, `scenePath: string`, `sourceNode: string`, `signalName: string`, `targetNode: string`, `methodName: string` | Establishes signal connections between nodes. |
| `disconnect_signal` | Signal Sever | `projectPath: string`, `scenePath: string`, `sourceNode: string`, `signalName: string`, `targetNode: string`, `methodName: string` | Severs signal connections. |
| `set_node_metadata` | Metadata Set | `projectPath: string`, `scenePath: string`, `nodePath: string`, `metadata: Record<string, any>` | Saves custom key-value metadata dictionaries on nodes. |
| `get_node_metadata` | Metadata Get | `projectPath: string`, `scenePath: string`, `nodePath: string` | Retrieves configured metadata dictionaries. |
| `setup_control` | GUI Layout | `projectPath: string`, `scenePath: string`, `nodePath: string`, `anchorPreset: int`, `marginPreset?: int` | Configures margins and anchor bounds on UI Control container layers. |
| `setup_collision` | 2D Collider | `projectPath: string`, `scenePath: string`, `nodePath: string`, `shapeType: string`, `shapeSize: Vector2` | Creates and binds 2D collision boundaries (circle, rectangle). |
| `setup_collision_3d` | 3D Collider | `projectPath: string`, `scenePath: string`, `nodePath: string`, `shapeType: string`, `shapeSize: Vector3` | Creates and binds 3D collision bounds (box, cylinder, sphere). |
| `add_mesh_instance` | Mesh Attach | `projectPath: string`, `scenePath: string`, `parentNodePath: string`, `meshName: string`, `meshType: string` | Inserts a basic MeshInstance node configured with geometry primitives. |
| `set_physics_layers` | Physics Layers | `projectPath: string`, `scenePath: string`, `nodePath: string`, `collisionLayer: int`, `collisionMask: int` | Configures collision layer and mask bitmasks on physical bodies. |
| `get_physics_layers` | Physics Layers | `projectPath: string`, `scenePath: string`, `nodePath: string` | Reads active collision layers and masks. |
| `add_raycast` | Sensor Attach | `projectPath: string`, `scenePath: string`, `parentNodePath: string`, `sensorName: string`, `castTo: Vector3` | Attaches a spatial RayCast sensing node pointing along target vectors. |
| `setup_camera` | Cam Inject | `projectPath: string`, `scenePath: string`, `parentPath?: string`, `name?: string`, `dimension?: "2d" \| "3d"`, `current?: boolean`, `zoom?: Vector2`, `fov?: float`, `near?: float`, `far?: float`, `position?: Vector3`, `rotation?: Vector3`, `lookAt?: Vector3` | Instantiates and configures spatial or 2D cameras. Offline `lookAt` rotates spatial cameras mathematically. |
| `setup_lighting` | Light Inject | `projectPath: string`, `scenePath: string`, `parentNodePath: string`, `lightName: string`, `lightType: "Omni" \| "Spot" \| "Directional"` | Places light sources, configuring color, energy, and shadow properties. |
| `setup_environment` | Sky Setup | `projectPath: string`, `scenePath: string`, `parentNodePath: string`, `envName: string` | Appends WorldEnvironment nodes configured with sky panels. |
| `setup_navigation_3d` | Path Mesh | `projectPath: string`, `scenePath: string`, `parentNodePath: string`, `navName: string` | Generates a 3D pathfinding NavigationMeshInstance region. |
| `create_particles_3d` | Particle Emitter | `projectPath: string`, `scenePath: string`, `parentNodePath: string`, `emitterName: string`, `amount: int` | Attaches a 3D particle emitter node configured with visual processing materials. |
| `setup_animation_tree` | Anim State | `projectPath: string`, `scenePath: string`, `parentNodePath: string`, `treeName: string`, `playerPath: string` | Attaches `AnimationTree` nodes, mapping active blending controllers. |
| `setup_joint_3d` | Joint Constraint | `projectPath: string`, `scenePath: string`, `parentNodePath: string`, `jointName: string`, `nodeA: string`, `nodeB: string`, `jointType: string` | Links colliders using structural constraints (hinge, slider, pin). |
| `generate_gui_hierarchy` | GUI Compiler | `projectPath: string`, `scenePath: string`, `parentPath: string`, `hierarchy: LayoutDeclaration` | Recursively compiles deeply nested responsive Control containers from structured schemas in one pass. |

---

## 5. GDScript & Code Configuration (5 tools)

These tools manipulate `.gd` script files directly on disk, extracting declarations or dynamically injecting variables, functions, and signal wires.

| Tool | Action | Expected Parameters | Description & Boundaries |
| :--- | :--- | :--- | :--- |
| `list_script_elements` | AST Analysis | `projectPath: string`, `scriptPath: string` | Maps class variables, exported variables, functions, and signal declarations. |
| `add_script_variable` | Member Inject | `projectPath: string`, `scriptPath: string`, `name: string`, `type: string`, `defaultValue?: string`, `isExported?: boolean` | Injects typed variable declarations (including export properties in Godot 3/4 syntax). |
| `add_script_signal` | Signal Inject | `projectPath: string`, `scriptPath: string`, `name: string`, `args?: string[]` | Appends custom signal declarations to the script header. |
| `add_script_function` | Method Inject | `projectPath: string`, `scriptPath: string`, `name: string`, `args: string[]`, `body: string` | Appends a fully formulated GDScript function method block. |
| `remove_script_function` | Method Excise | `projectPath: string`, `scriptPath: string`, `name: string` | Removes target methods from script files. |

---

## 6. Input Action Mapping (3 tools)

These tools modify the input map dictionary configuration inside `project.godot` to bind inputs to events.

| Tool | Action | Expected Parameters | Description & Boundaries |
| :--- | :--- | :--- | :--- |
| `list_input_actions` | Action Probe | `projectPath: string` | Lists all input actions, mapping registered buttons, keys, or axes. |
| `add_input_action` | Action Register | `projectPath: string`, `actionName: string`, `deadzone?: float` | Declares a new input action wrapper inside `project.godot`. |
| `remove_input_action` | Action Remove | `projectPath: string`, `actionName: string` | Deregisters action configurations, clearing key mappings. |

---

## 7. Resources, Materials & Shaders (7 tools)

These tools parse and compile `.tres` resource files and custom `.shader` text structures offline.

| Tool | Action | Expected Parameters | Description & Boundaries |
| :--- | :--- | :--- | :--- |
| `create_tres_resource` | INI Resource | `projectPath: string`, `resourcePath: string`, `resourceType: string`, `properties: Record<string, any>` | Generates offline style boxes (`StyleBoxFlat`) or spatial materials (`SpatialMaterial`) in standard Godot INI file configurations. |
| `apply_spatial_material` | Material Bind | `projectPath: string`, `scenePath: string`, `nodePath: string`, `materialPath: string`, `surfaceIndex?: int` | Binds `.tres` materials to MeshInstance nodes inside scenes. |
| `set_spatial_material` | Material Direct | `projectPath: string`, `scenePath: string`, `nodePath: string`, `surfaceIndex?: int`, `albedoColor?: Color`, `albedoTexture?: string`, `metallic?: float`, `roughness?: float`, `normalEnabled?: boolean`, `normalTexture?: string`, `normalScale?: float`, `transparency?: boolean`, `cullMode?: string` | Natively creates or modifies a SpatialMaterial directly on a MeshInstance inside a scene headlessly. |
| `compile_material_tree` | Material Compiler | `projectPath: string`, `materialPath: string`, `type: string`, `textures: Record<string, string>`, `parameters?: Record<string, any>` | Natively compiles nested albedo, roughness, and normal maps into a `.tres` material file in a single transaction. |
| `create_shader_resource` | Shader Spawn | `projectPath: string`, `shaderPath: string`, `shaderType: "spatial" \| "canvas_item" \| "particles"` | Generates standard visual `.shader` files initialized with templates. |
| `apply_shader_material` | Shader Bind | `projectPath: string`, `scenePath: string`, `nodePath: string`, `shaderPath: string`, `uniforms?: Record<string, any>` | Attaches custom shaders to targets, binding uniforms to properties. |
| `import_resource` | Asset Import | `projectPath: string`, `assetPath: string` | Headlessly invokes asset importing processes for newly added textures, models, or meshes, updating imports. |

---

## 8. GridMap & TileMap Placement (2 tools)

These tools allow offline programmatic cell modifications inside 2D and 3D level scene files.

| Tool | Action | Expected Parameters | Description & Boundaries |
| :--- | :--- | :--- | :--- |
| `set_tilemap_cell` | 2D Cell Paint | `projectPath: string`, `scenePath: string`, `nodePath: string`, `x: int`, `y: int`, `tileId: int`, `flipX?: boolean`, `flipY?: boolean` | Places or clears cell tile values inside 2D `TileMap` structures. |
| `set_gridmap_cell` | 3D Cell Paint | `projectPath: string`, `scenePath: string`, `nodePath: string`, `x?: int`, `y?: int`, `z?: int`, `item?: int`, `orientation?: int`, `cells?: GridMapCell[]` | Places individual or bulk batch coordinates into `GridMap` blocks. |

---

## 9. Animation Editing & Piping (3 tools)

These tools configure keyframes, tracks, and state-machine transitions inside scene animation containers.

| Tool | Action | Expected Parameters | Description & Boundaries |
| :--- | :--- | :--- | :--- |
| `configure_animation` | Track Keying | `projectPath: string`, `scenePath: string`, `nodePath: string`, `animName: string`, `tracks: TrackDeclaration[]` | Programmatically creates tracks and inserts value keys inside `AnimationPlayer` resources. |
| `get_animation_list` | Anim Probe | `projectPath: string`, `scenePath: string`, `nodePath: string` | Enumerates all animations declared inside a scene's AnimationPlayer. |
| `pipe_animation_states` | Flow Piping | `projectPath: string`, `scenePath: string`, `treePath: string`, `states: StateNode[]`, `transitions: TransitionEdge[]` | Compiles anim state-machine graphs containing states, transition rules, and crossfades natively. |

---

## 10. Script & Scene Validation (1 tool)

This tool serves as an essential structural check to run before running or building.

| Tool | Action | Expected Parameters | Description & Boundaries |
| :--- | :--- | :--- | :--- |
| `validate` | Syntax Probe | `projectPath: string`, `scriptPath?: string`, `scenePath?: string`, `targets?: string[]` | Headlessly checks GDScript compile errors, missing external resource links, and structural bugs in scenes, reporting compiled error logs. |
