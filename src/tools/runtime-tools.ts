import { join, sep, resolve } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import type { GodotRunner, OperationParams, ToolDefinition } from '../utils/godot-runner.js';
import {
  normalizeParameters,
  validateProjectArgs,
  validateSubPath,
  createErrorResponse,
  getErrorMessage,
  isUnderDir,
  BRIDGE_WAIT_SPAWNED_TIMEOUT_MS,
} from '../utils/godot-runner.js';
import {
  attachRuntimeWarnings,
  parseBridgeJson,
  MAX_RUNTIME_ERROR_CONTEXT_LINES,
} from '../utils/handler-helpers.js';
import { logDebug } from '../utils/logger.js';
import { randomUUID } from 'crypto';

const SCREENSHOT_RESPONSE_MODES = ['full', 'preview', 'path_only'] as const;
const DEFAULT_PREVIEW_MAX_WIDTH = 960;
const DEFAULT_PREVIEW_MAX_HEIGHT = 540;

type ScreenshotResponseMode = (typeof SCREENSHOT_RESPONSE_MODES)[number];

interface ScreenshotBridgeResponse {
  path?: string;
  preview_path?: string;
  width?: number;
  height?: number;
  preview_width?: number;
  preview_height?: number;
  error?: string;
}

// --- Tool definitions ---

export const runtimeToolDefinitions: ToolDefinition[] = [
  {
    name: 'launch_editor',
    description:
      'Open the Godot editor GUI for a project for the human user. Use only when the user explicitly asks to "open the editor"; for any agent-driven work, use the headless scene/node tools (add_node, set_node_properties, etc.) instead - the editor cannot be controlled programmatically. Returns plain-text confirmation after spawning the editor process. Errors if projectPath has no project.godot.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'run_project',
    description:
      'Spawn a Godot project as a child process with stdout/stderr captured. Required before take_screenshot, simulate_input, get_ui_elements, run_script, or get_debug_output. For a Godot process you launched yourself, use attach_project instead. Verifies MCP bridge readiness before returning success. Returns plain-text status with the assigned bridge port. Call stop_project when done. Errors if projectPath is not a Godot project or another session is already active.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
        scene: {
          type: 'string',
          description:
            'Scene to run (path relative to project, e.g. "scenes/main.tscn"). Omit to use the project\'s main scene.',
        },
        background: {
          type: 'boolean',
          description:
            'If true, hides the Godot window off-screen and blocks all physical keyboard and mouse input, while keeping programmatic input (simulate_input, run_script) and screenshots fully active. Useful for automated agent-driven testing where the window should not be visible or interactive.',
        },
        bridgePort: {
          type: 'number',
          minimum: 1,
          maximum: 65535,
          description:
            "TCP port for the MCP bridge. Omit to auto-select a free port (recommended). The chosen port is baked into the project's `mcp_bridge.gd` at inject time, so the running Godot listens on exactly this port.",
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'attach_project',
    description:
      'Inject the MCP bridge into a Godot process you launch yourself, then wait up to 15s for the bridge to respond. Call BEFORE Godot launches - Godot reads autoloads only at process start, so a late call returns "bridge did not respond." Recommended pattern: kick off the Godot launch in parallel with this call so the wait absorbs startup. Prefer run_project unless MCP must not spawn Godot. Returns plain-text status with the resolved bridge port. Call detach_project or stop_project when done.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
        bridgePort: {
          type: 'number',
          minimum: 1,
          maximum: 65535,
          description:
            "TCP port for the MCP bridge. Omit to auto-select a free port (recommended). The chosen port is baked into the project's `mcp_bridge.gd` at inject time, so the running Godot listens on exactly this port.",
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'detach_project',
    description:
      'Clear attached-mode runtime state and remove the injected McpBridge autoload. Does NOT stop the manually launched Godot process - that stays running. Use after attach_project when you are done driving the game from MCP. For spawned sessions (run_project), use stop_project instead. Returns: message confirming detach plus externalProcessPreserved (always true here - that is the point of detach vs stop_project). Errors if called outside an attached session.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    outputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        externalProcessPreserved: { type: 'boolean' },
      },
    },
  },
  {
    name: 'get_debug_output',
    description:
      'Get captured stdout/stderr from a spawned Godot project. Use whenever runtime tools fail unexpectedly - script errors, missing nodes, and crash backtraces all surface here. Requires run_project (not attach_project; attached mode does not capture output). Returns: output/errors (last `limit` lines each, default 200), running (false after exit, null when attached), exitCode after exit, attached:true with empty arrays in attached mode.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max lines to return (default: 200, from end of output)',
        },
      },
      required: [],
    },
    outputSchema: {
      type: 'object',
      properties: {
        output: { type: 'array', items: { type: 'string' } },
        errors: { type: 'array', items: { type: 'string' } },
        running: { type: ['boolean', 'null'] },
        exitCode: { type: ['number', 'null'] },
        attached: { type: 'boolean' },
        tip: { type: 'string' },
      },
    },
  },
  {
    name: 'stop_project',
    description:
      'Stop the spawned Godot project and clean up MCP bridge state. Always call when done with runtime testing - even after a crash - to free the single process slot so run_project can be called again. For attached sessions, this detaches without killing the externally launched process. Returns: message, mode ("spawned"/"attached"), externalProcessPreserved (true only for attached), finalOutput and finalErrors (last 200 lines each). Errors if no session is active.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    outputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        mode: { type: 'string' },
        externalProcessPreserved: { type: 'boolean' },
        finalOutput: { type: 'array', items: { type: 'string' } },
        finalErrors: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'take_screenshot',
    description:
      'Capture a PNG of the running viewport. responseMode: preview (default - saves full PNG, returns bounded inline preview at 960x540), full (full inline PNG; use for small text or pixel-level inspection), path_only (saved-path only, no inline image). Saved under .mcp/screenshots. Returns: inline image block (full/preview modes), plus path and size of the saved PNG; previewPath/previewSize in preview mode; warnings for non-fatal runtime errors. Errors if no session or bridge times out (default 10000ms).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds to wait for the screenshot (default: 10000)',
        },
        responseMode: {
          type: 'string',
          enum: ['full', 'preview', 'path_only'],
          description:
            'Response payload mode. "preview" returns a bounded inline preview plus paths (default). "full" returns the full inline PNG. "path_only" returns paths only.',
        },
        previewMaxWidth: {
          type: 'number',
          description:
            'Maximum preview width in pixels when responseMode is "preview" (default: 960)',
        },
        previewMaxHeight: {
          type: 'number',
          description:
            'Maximum preview height in pixels when responseMode is "preview" (default: 540)',
        },
      },
      required: [],
    },
    // The handler also emits an inline `image` content block for full/preview modes;
    // outputSchema only describes the structured JSON text payload per MCP spec.
    outputSchema: {
      type: 'object',
      properties: {
        responseMode: { type: 'string' },
        path: { type: 'string' },
        size: {
          type: 'object',
          properties: {
            width: { type: 'number' },
            height: { type: 'number' },
          },
        },
        previewPath: { type: 'string' },
        previewSize: {
          type: 'object',
          properties: {
            width: { type: 'number' },
            height: { type: 'number' },
          },
        },
        warnings: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'simulate_input',
    description:
      "Simulate sequential input in a running project. Each action's `type` (key, mouse_button, mouse_motion, click_element, action, wait) gates which other fields apply - see per-property docs. For click_element use get_ui_elements first; resolution is by path/name, not visible text. Press/release require two actions; insert wait between for frame ticks. Returns: success, actions_processed, warnings for runtime errors fired by input handlers. Errors if no session or any action fails validation.",
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          description:
            'Array of input actions to execute sequentially. Each object must have a "type" field.',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['key', 'mouse_button', 'mouse_motion', 'click_element', 'action', 'wait'],
                description: 'The type of input action',
              },
              key: {
                type: 'string',
                description:
                  '[key] Godot KEY_* constant name without the prefix (e.g. "W", "Space", "Escape", "Enter", "Tab", "Up", "PageUp"). Errors on unrecognized names.',
              },
              pressed: {
                type: 'boolean',
                description:
                  '[key, mouse_button, action] Whether the input is pressed (true) or released (false). For mouse_button: omit to auto-click (press+release in one action); set explicitly only for hold/release. For key: defaults to true and does NOT auto-release - emit a second action with pressed:false to release.',
              },
              shift: { type: 'boolean', description: '[key] Shift modifier' },
              ctrl: { type: 'boolean', description: '[key] Ctrl modifier' },
              alt: { type: 'boolean', description: '[key] Alt modifier' },
              unicode: {
                type: 'number',
                description:
                  '[key] Unicode codepoint for text-entry Controls (LineEdit, TextEdit). Auto-derived for ASCII letters/digits (respecting shift); pass explicitly for symbols or non-ASCII. E.g. 33 for "!", 64 for "@".',
              },
              button: {
                type: 'string',
                enum: ['left', 'right', 'middle'],
                description: '[mouse_button, click_element] Mouse button (default: left)',
              },
              x: {
                type: 'number',
                description:
                  '[mouse_button, mouse_motion] X position in viewport pixels (0,0 = top-left)',
              },
              y: {
                type: 'number',
                description:
                  '[mouse_button, mouse_motion] Y position in viewport pixels (0,0 = top-left)',
              },
              relative_x: {
                type: 'number',
                description: '[mouse_motion] Relative X movement in pixels',
              },
              relative_y: {
                type: 'number',
                description: '[mouse_motion] Relative Y movement in pixels',
              },
              double_click: {
                type: 'boolean',
                description: '[mouse_button, click_element] Double click',
              },
              element: {
                type: 'string',
                description:
                  '[click_element] Identifies the UI element to click. Accepts: absolute node path (e.g. "/root/HUD/Button"), relative node path, or node name (BFS matched). Use get_ui_elements to discover valid names and paths.',
              },
              action: {
                type: 'string',
                description:
                  '[action] Godot input action name (as defined in Project Settings > Input Map)',
              },
              strength: {
                type: 'number',
                description: '[action] Action strength (0-1, default 1.0)',
              },
              ms: {
                type: 'number',
                description:
                  '[wait] Duration in milliseconds to pause before the next action (~16ms = one frame at 60fps).',
              },
            },
            required: ['type'],
          },
        },
      },
      required: ['actions'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        actions_processed: { type: 'number' },
        warnings: { type: 'array', items: { type: 'string' } },
        tip: { type: 'string' },
      },
    },
  },
  {
    name: 'get_ui_elements',
    description:
      'Walk the running scene tree and return all Control nodes with positions, sizes, types, and text content. Always call this before simulate_input click_element actions to discover valid element names and paths. Requires an active runtime session (run_project or attach_project). visibleOnly defaults true; pass false to include hidden Controls. filter narrows by class. Returns: elements[] with path/type/rect/visible plus optional text/disabled/tooltip.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        visibleOnly: {
          type: 'boolean',
          description:
            'Only return nodes where Control.visible is true (default: true). Set false to include hidden elements.',
        },
        filter: {
          type: 'string',
          description: 'Filter by Control node type (e.g. "Button", "Label", "LineEdit")',
        },
      },
      required: [],
    },
    outputSchema: {
      type: 'object',
      properties: {
        elements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              path: { type: 'string' },
              type: { type: 'string' },
              rect: {
                type: 'object',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  width: { type: 'number' },
                  height: { type: 'number' },
                },
              },
              visible: { type: 'boolean' },
              text: { type: 'string' },
              placeholder: { type: 'string' },
              disabled: { type: 'boolean' },
              tooltip: { type: 'string' },
            },
          },
        },
        warnings: { type: 'array', items: { type: 'string' } },
        tip: { type: 'string' },
      },
    },
  },
  {
    name: 'run_script',
    description:
      'Execute a custom GDScript in the live running project with full scene tree access. Requires an active runtime session. Script must extend Reference and define func execute(scene_tree) (Godot 3.x - do NOT use type hints like ": SceneTree" or "-> Variant" as they cause compilation errors in GDScript 1.0). Return values are JSON-serialized (primitives, Vector2/3, Color, Dictionary, Array, and Node path strings). Use print() for debug output - it appears in get_debug_output, not in the result. In spawned mode, stderr runtime errors escalate to errors (when the script returns null) or surface as warnings. Returns: { success, result, warnings?, tip? } where result is the JSON-serialized return value of execute().',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description:
            'GDScript source code. Must contain "extends Reference" and "func execute(scene_tree)" (Godot 3.x - no type annotations).',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in ms (default: 30000). Increase for long-running scripts.',
        },
      },
      required: ['script'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: {},
        warning: { type: 'string' },
        warnings: { type: 'array', items: { type: 'string' } },
        tip: { type: 'string' },
      },
    },
  },
  {
    name: 'get_performance_metrics',
    description:
      'Read all Godot Performance monitor values from the running game. Requires an active runtime session. Returns: a flat dictionary of all performance metrics including FPS, process time, memory usage, render stats (draw calls, vertices, video memory), physics stats (active objects, collision pairs), and object counts. Useful for profiling, optimization, and verifying that changes do not degrade performance.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    outputSchema: {
      type: 'object',
      properties: {
        fps: { type: 'number' },
        process_time_ms: { type: 'number' },
        physics_process_time_ms: { type: 'number' },
        memory_static_bytes: { type: 'number' },
        memory_dynamic_bytes: { type: 'number' },
        render_draw_calls: { type: 'number' },
        render_vertices_in_frame: { type: 'number' },
        render_objects_in_frame: { type: 'number' },
        nodes_count: { type: 'number' },
        physics_3d_active_objects: { type: 'number' },
      },
    },
  },
  {
    name: 'query_spatial_collision',
    description:
      'Perform physics raycasting inside the active, running 3D world to check if placing an entity is clear, test pathfinding corridors, or detect spatial obstacles. Requires an active runtime session (run_project or attach_project). Returns: collided (boolean), and if collided: position, normal, collider_name, collider_path, collider_id.',
    inputSchema: {
      type: 'object',
      properties: {
        origin: {
          type: 'object',
          description: 'Starting point of raycast {x, y, z}',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
          },
          required: ['x', 'y', 'z'],
        },
        destination: {
          type: 'object',
          description: 'Target point of raycast {x, y, z}',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
          },
          required: ['x', 'y', 'z'],
        },
        collision_mask: {
          type: 'number',
          description: 'Physics collision layer bitmask to check (default: 1)',
        },
        exclude_bodies: {
          type: 'array',
          items: { type: 'string' },
          description: 'Node paths or names of colliders to ignore/exclude from the query',
        },
      },
      required: ['origin', 'destination'],
    },
  },
  {
    name: 'get_ground_clamp',
    description:
      'Snap coordinates precisely to the top of road/terrain 3D colliders at any horizontal (x, z) location, returning the ground height (y) and surface normal vector. Requires an active runtime session. Scan starts from max_height downwards to min_height.',
    inputSchema: {
      type: 'object',
      properties: {
        position: {
          type: 'object',
          description: '2D coordinates {x, z} or 3D coordinate {x, y, z} representing the horizontal target location.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
          },
          required: ['x'],
        },
        max_height: {
          type: 'number',
          description: 'Start height of downwards scan (default: 100.0)',
        },
        min_height: {
          type: 'number',
          description: 'End height of downwards scan (default: -100.0)',
        },
        collision_mask: {
          type: 'number',
          description: 'Physics collision layer bitmask to check (default: 1, e.g. roads/terrain)',
        },
      },
      required: ['position'],
    },
  },
  {
    name: 'record_telemetry_sequence',
    description:
      'Record a time-series sequence of physical/spatial telemetry (position, rotation, scale, linear/angular velocities) for a target node in the running scene over a duration of time at a specified sampling interval. Can optionally capture and save synchronized screenshots at each step. Returns the structured sequence data and the path to the saved JSON telemetry file under .mcp/telemetry/. Errors if targetNodePath is missing or invalid, or no runtime session is active.',
    inputSchema: {
      type: 'object',
      properties: {
        targetNodePath: {
          type: 'string',
          description:
            'Absolute/relative node path or node name of the target node to record (e.g. "/root/HUD/Player" or "Player")',
        },
        duration: {
          type: 'number',
          description: 'Total duration in seconds to record telemetry (default: 2.0)',
        },
        interval: {
          type: 'number',
          description: 'Interval in seconds between telemetry samples (default: 0.2)',
        },
        captureScreenshots: {
          type: 'boolean',
          description: 'If true, captures synchronized PNG screenshots at each sample step (default: false)',
        },
      },
      required: ['targetNodePath'],
    },
  },
  {
    name: 'navigate_to',
    description:
      'Autopilot pathfinding routing command for a 3D Spatial node. Moves the node along a collision-free path calculated via get_simple_path() from a Navigation node, falling back to direct linear interpolation. Executes over physics frame tick loops dynamically inside the running game.',
    inputSchema: {
      type: 'object',
      properties: {
        targetNodePath: {
          type: 'string',
          description: 'Absolute/relative node path or unique name of the target node to move (e.g. "/root/Player" or "Player").',
        },
        destination: {
          type: 'object',
          description: 'Vector3 destination coordinates object.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
          },
          required: ['x', 'y', 'z'],
        },
        speed: {
          type: 'number',
          description: 'Movement speed in units per second (default: 5.0).',
        },
        navigationNodePath: {
          type: 'string',
          description: 'Optional path to specific Navigation node. If omitted, auto-discovers Navigation provider recursively.',
        },
        tolerance: {
          type: 'number',
          description: 'Stopping distance tolerance radius (default: 1.0).',
        },
        timeout: {
          type: 'number',
          description: 'autoclose limit in seconds before interrupting path traversal (default: 10.0).',
        },
      },
      required: ['targetNodePath', 'destination'],
    },
  },
];

// --- Helpers ---

function ensureRuntimeSession(runner: GodotRunner, actionDescription: string) {
  if (!runner.activeSessionMode || !runner.activeProjectPath) {
    return createErrorResponse(
      `No active runtime session. A project must be running or attached to ${actionDescription}.`,
      [
        'Use run_project to start a Godot project first',
        'Or use attach_project before launching Godot manually',
      ],
    );
  }

  if (
    runner.activeSessionMode === 'spawned' &&
    (!runner.activeProcess || runner.activeProcess.hasExited)
  ) {
    return createErrorResponse(
      `The spawned Godot process has exited and cannot ${actionDescription}.`,
      [
        'Use get_debug_output to inspect the last captured logs',
        'Call stop_project to clean up, then run_project again',
      ],
    );
  }

  return null;
}

// --- Handlers ---

export async function handleLaunchEditor(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);

  const v = validateProjectArgs(args);
  if ('isError' in v) return v;

  try {
    if (!runner.getGodotPath()) {
      await runner.detectGodotPath();
      if (!runner.getGodotPath()) {
        return createErrorResponse('Could not find a valid Godot executable path', [
          'Ensure Godot is installed correctly',
          'Set GODOT_PATH environment variable',
        ]);
      }
    }

    logDebug(`Launching Godot editor for project: ${v.projectPath}`);
    const process = runner.launchEditor(v.projectPath);

    process.on('error', (err: Error) => {
      console.error('Failed to start Godot editor:', err);
    });

    return {
      content: [
        {
          type: 'text',
          text: `Godot editor launched successfully for project at ${v.projectPath}.\nNote: the editor is a GUI application and cannot be controlled programmatically. Use the scene and node editing tools (add_node, set_node_properties, etc.) to modify the project headlessly without the editor.`,
        },
      ],
    };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to launch Godot editor: ${getErrorMessage(error)}`, [
      'Ensure Godot is installed correctly',
      'Check if the GODOT_PATH environment variable is set correctly',
    ]);
  }
}

export async function handleRunProject(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);

  const v = validateProjectArgs(args);
  if ('isError' in v) return v;

  if (typeof args.scene === 'string') {
    if (!validateSubPath(v.projectPath, args.scene)) {
      return createErrorResponse(
        `Invalid scene path: must be project-relative without ".." (got: ${args.scene})`,
        ['Pass scene as a path relative to the project root, e.g. "scenes/main.tscn"'],
      );
    }
  }

  if (!runner.getGodotPath()) {
    await runner.detectGodotPath();
    if (!runner.getGodotPath()) {
      return createErrorResponse('Could not find a valid Godot executable path', [
        'Set GODOT_PATH in your MCP client config to your Godot 3.x executable',
        'Ensure the path points at the Godot binary, not its installation folder',
        'On Windows, escape backslashes in JSON (e.g. "D:\\\\Godot\\\\Godot.exe")',
      ]);
    }
  }

  try {
    const background = args.background === true;
    const bridgePort = args.bridgePort;
    if (bridgePort !== undefined) {
      if (
        !Number.isInteger(bridgePort) ||
        (bridgePort as number) < 1 ||
        (bridgePort as number) > 65535
      ) {
        return createErrorResponse(
          `Invalid bridgePort: must be an integer in [1, 65535] (got: ${String(bridgePort)})`,
          ['Omit bridgePort to auto-select a free port', 'Pass a valid TCP port number'],
        );
      }
    }
    await runner.runProject(
      v.projectPath,
      args.scene as string | undefined,
      background,
      bridgePort as number | undefined,
    );

    const bridgeResult = await runner.waitForBridge();

    if (!bridgeResult.ready) {
      if (runner.activeProcess && runner.activeProcess.hasExited) {
        // Tear down the spawned-mode session state so a retry of run_project
        // works without an intervening stop_project.
        await runner.stopProject();
        return createErrorResponse(
          `Godot process exited before the MCP bridge could initialize.\n${bridgeResult.error || ''}`,
          [
            'Check get_debug_output for runtime errors',
            'Verify a display server is available (Wayland/X11)',
            'Check for broken autoloads with list_autoloads',
            'Retry run_project once the underlying issue is resolved',
          ],
        );
      }

      const recentErrors = runner.getRecentErrors(20);
      const errorTail = recentErrors.length > 0 ? `\nLast stderr:\n${recentErrors.join('\n')}` : '';
      const expected = runner.activeBridgePort;
      const onDisk = runner.readBakedBridgePort(v.projectPath);
      const raceDetected = onDisk !== null && expected !== null && onDisk !== expected;
      const racePrefix = raceDetected
        ? `Bridge timeout: expected port ${expected}, but on-disk script now has ${onDisk}. Another MCP client likely re-injected concurrently in the same project.\n`
        : '';
      const lines = [
        `${racePrefix}Godot process started, but the MCP bridge did not respond within ${BRIDGE_WAIT_SPAWNED_TIMEOUT_MS / 1000} seconds.`,
        '- The bridge listener never came up - likely an early _ready error or a stuck process holding the port',
        '- Session has been torn down; retry run_project to start a new one',
        errorTail,
      ];
      if (background) {
        lines.push('- Background mode: window hidden, physical input blocked');
      }
      // Tear down before returning so hasActiveRuntimeSession() reports false
      // and the next run_project lazy-reconnects cleanly.
      await runner.stopProject();
      const solutions = [
        'Check for broken autoloads with list_autoloads',
        `Check that the assigned bridge port (${runner.activeBridgePort}) is not occupied by another Godot process`,
        'Retry run_project',
      ];
      if (raceDetected) {
        solutions.push(
          'Concurrent MCP clients in the same project are not supported - run them in separate projects or sequence the calls',
        );
      }
      return createErrorResponse(lines.join('\n'), solutions);
    }

    const port = runner.activeBridgePort;
    const lines = [
      `Godot project started and MCP bridge is ready (port ${port}).`,
      '- Runtime tools (take_screenshot, simulate_input, get_ui_elements, run_script) are available now',
      '- Use get_debug_output to check runtime output and errors',
      '- Call stop_project when done',
    ];
    if (background) {
      lines.push('- Background mode: window hidden, physical input blocked');
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    if (errorMessage.includes('No display server available')) {
      return createErrorResponse(`Failed to run Godot project: ${errorMessage}`, [
        'Use attach_project with an externally launched Godot process',
        'Set DISPLAY or WAYLAND_DISPLAY environment variables',
        'Run from a graphical shell session',
      ]);
    }
    return createErrorResponse(`Failed to run Godot project: ${errorMessage}`, [
      'Ensure Godot is installed correctly',
      'Check if the GODOT_PATH environment variable is set correctly',
    ]);
  }
}

export async function handleAttachProject(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);

  const v = validateProjectArgs(args);
  if ('isError' in v) return v;

  try {
    const attachBridgePort = args.bridgePort;
    if (attachBridgePort !== undefined) {
      if (
        !Number.isInteger(attachBridgePort) ||
        (attachBridgePort as number) < 1 ||
        (attachBridgePort as number) > 65535
      ) {
        return createErrorResponse(
          `Invalid bridgePort: must be an integer in [1, 65535] (got: ${String(attachBridgePort)})`,
          [
            'Omit bridgePort to auto-select a free port',
            'Pass a valid TCP port number matching the externally launched Godot',
          ],
        );
      }
    }
    await runner.attachProject(v.projectPath, attachBridgePort as number | undefined);

    const bridgeResult = await runner.waitForBridgeAttached();

    if (!bridgeResult.ready) {
      const expected = runner.activeBridgePort;
      const onDisk = runner.readBakedBridgePort(v.projectPath);
      const raceDetected = onDisk !== null && expected !== null && onDisk !== expected;
      const racePrefix = raceDetected
        ? `Bridge timeout: expected port ${expected}, but on-disk script now has ${onDisk}. Another MCP client likely re-injected concurrently in the same project.\n`
        : '';
      // Tear down the attached-mode session state so retrying with
      // attach_project (or run_project) works without a manual detach first.
      await runner.stopProject();
      const solutions = [
        'If you are launching Godot yourself, run the launch in parallel with attach_project next time so the wait absorbs the startup - do not sequentialize',
        'If a human is launching Godot, retry attach_project once they have launched - bridge.inject is idempotent',
        'If Godot is already running but was launched before the bridge was injected, restart it (autoloads are read at startup)',
        `Check that no other Godot project is occupying the assigned bridge port (${runner.activeBridgePort})`,
      ];
      if (raceDetected) {
        solutions.push(
          'Concurrent MCP clients in the same project are not supported - run them in separate projects or sequence the calls',
        );
      }
      return createErrorResponse(
        `${racePrefix}Project attached but the MCP bridge is not ready.\n${bridgeResult.error || ''}`,
        solutions,
      );
    }

    const attachedPort = runner.activeBridgePort;
    return {
      content: [
        {
          type: 'text',
          text: [
            `Project attached and MCP bridge is ready (port ${attachedPort}).`,
            '- Runtime tools (take_screenshot, simulate_input, get_ui_elements, run_script) are available now',
            '- get_debug_output is unavailable in attached mode because MCP did not spawn the process',
            '- Use detach_project or stop_project when done to clean up the injected bridge state',
          ].join('\n'),
        },
      ],
    };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to attach project: ${getErrorMessage(error)}`, [
      'Check if project.godot is accessible',
      'Ensure MCP can write the bridge autoload into the project',
    ]);
  }
}

export async function handleDetachProject(runner: GodotRunner) {
  if (runner.activeSessionMode !== 'attached') {
    return createErrorResponse('No attached project to detach.', [
      'Use attach_project first for manual-launch workflows',
      'If MCP launched the game, use stop_project instead',
    ]);
  }

  const result = (await runner.stopProject())!;

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          message: 'Detached attached project and cleaned MCP bridge state',
          externalProcessPreserved: result.externalProcessPreserved === true,
        }),
      },
    ],
  };
}

export function handleGetDebugOutput(runner: GodotRunner, args: OperationParams = {}) {
  args = normalizeParameters(args);

  if (!runner.activeSessionMode) {
    return createErrorResponse('No active runtime session.', [
      'Use run_project to start a Godot project first',
      'Or use attach_project before launching Godot manually',
    ]);
  }

  if (runner.activeSessionMode === 'attached') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            output: [],
            errors: [],
            running: null,
            attached: true,
            tip: 'Attached mode does not capture stdout/stderr because Godot was launched outside MCP.',
          }),
        },
      ],
    };
  }

  const proc = runner.activeProcess;
  if (!proc) {
    return createErrorResponse('No active spawned process is available for debug output.', [
      'Use run_project to start a Godot project first',
      'Or use attach_project only when stdout/stderr capture is not needed',
    ]);
  }

  const limit = typeof args.limit === 'number' ? args.limit : 200;
  const response: {
    output: string[];
    errors: string[];
    running: boolean;
    exitCode?: number | null;
    tip?: string;
  } = {
    output: proc.output.slice(-limit),
    errors: proc.errors.slice(-limit),
    running: !proc.hasExited,
  };

  if (proc.hasExited) {
    response.exitCode = proc.exitCode;
    response.tip =
      'Process has exited. Call stop_project to clean up the process slot before starting a new one.';
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response),
      },
    ],
  };
}

export async function handleStopProject(runner: GodotRunner) {
  const result = await runner.stopProject();

  if (!result) {
    return createErrorResponse('No active Godot process to stop.', [
      'Use run_project to start a Godot project first',
      'The process may have already terminated',
    ]);
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          message:
            result.mode === 'attached'
              ? 'Attached project detached and MCP bridge state cleaned up'
              : 'Godot project stopped',
          mode: result.mode,
          externalProcessPreserved: result.externalProcessPreserved === true,
          finalOutput: result.output.slice(-200),
          finalErrors: result.errors.slice(-200),
        }),
      },
    ],
  };
}

function parseScreenshotResponseMode(value: unknown): ScreenshotResponseMode | null {
  if (value === undefined) return 'preview';
  if (typeof value !== 'string') return null;
  return SCREENSHOT_RESPONSE_MODES.includes(value as ScreenshotResponseMode)
    ? (value as ScreenshotResponseMode)
    : null;
}

function parsePreviewDimension(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.floor(value));
}

function normalizeScreenshotPath(path: string): string {
  return sep === '\\' ? path.replace(/\//g, '\\') : path;
}

export async function handleTakeScreenshot(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);

  const sessionError = ensureRuntimeSession(runner, 'take a screenshot');
  if (sessionError) {
    return sessionError;
  }

  const timeout = typeof args.timeout === 'number' ? args.timeout : 10000;
  const responseMode = parseScreenshotResponseMode(args.responseMode);
  if (responseMode === null) {
    return createErrorResponse('Invalid responseMode for take_screenshot', [
      'Use one of: "full", "preview", or "path_only"',
    ]);
  }

  const previewMaxWidth = parsePreviewDimension(args.previewMaxWidth, DEFAULT_PREVIEW_MAX_WIDTH);
  const previewMaxHeight = parsePreviewDimension(args.previewMaxHeight, DEFAULT_PREVIEW_MAX_HEIGHT);
  if (previewMaxWidth === null || previewMaxHeight === null) {
    return createErrorResponse('Invalid preview dimensions for take_screenshot', [
      'previewMaxWidth and previewMaxHeight must be positive numbers',
    ]);
  }

  const commandParams: Record<string, unknown> = {};
  if (responseMode === 'preview') {
    commandParams.preview_max_width = previewMaxWidth;
    commandParams.preview_max_height = previewMaxHeight;
  }

  try {
    const { response: responseStr, runtimeErrors } = await runner.sendCommandWithErrors(
      'screenshot',
      commandParams,
      timeout,
    );

    const parsedResult = parseBridgeJson<ScreenshotBridgeResponse>(responseStr, 'screenshot');
    if (!parsedResult.ok) return parsedResult.response;
    const parsed = parsedResult.data;

    if (parsed.error) {
      return createErrorResponse(`Screenshot server error: ${parsed.error}`, [
        'Ensure the project has a viewport (a headless project with no display server cannot render)',
        'Check disk space and permissions on the project directory (.mcp/screenshots/)',
      ]);
    }

    if (!parsed.path) {
      return createErrorResponse('Screenshot server returned no file path', [
        'The bridge response is missing the expected `path` field - this is a bridge bug, not a timing issue',
        'Check get_debug_output for runtime errors during the screenshot save',
      ]);
    }

    // Normalize path for the local filesystem (forward slashes from GDScript)
    const screenshotPath = normalizeScreenshotPath(parsed.path);

    // Defense-in-depth: the bridge runs in user-controlled GDScript and could
    // be patched to return any path. Refuse to read anything outside the
    // project's own .mcp/screenshots/ directory.
    const screenshotsRoot = resolve(runner.activeProjectPath as string, '.mcp', 'screenshots');
    if (!isUnderDir(screenshotsRoot, screenshotPath)) {
      return createErrorResponse(
        'Bridge returned a screenshot path outside .mcp/screenshots/. Refusing to read.',
        [
          'This indicates a tampered or misbehaving McpBridge autoload',
          'Stop the project, verify the bridge script is the one shipped with this server, and retry',
        ],
      );
    }

    if (!existsSync(screenshotPath)) {
      return createErrorResponse(`Screenshot file not found at: ${screenshotPath}`, [
        'The screenshot may have failed to save',
        'Check disk space and permissions',
      ]);
    }

    const metadata: Record<string, unknown> = {
      responseMode,
      path: parsed.path,
      size: { width: parsed.width, height: parsed.height },
    };

    const content: Array<{ type: string; [key: string]: unknown }> = [];

    if (responseMode === 'full') {
      const imageBuffer = readFileSync(screenshotPath);
      content.push({
        type: 'image',
        data: imageBuffer.toString('base64'),
        mimeType: 'image/png',
      });
    } else if (responseMode === 'preview') {
      if (!parsed.preview_path) {
        return createErrorResponse('Screenshot server returned no preview path', [
          'Ensure the running project has the current McpBridge autoload',
          'Restart the runtime after rebuilding the MCP server',
        ]);
      }
      const previewPath = normalizeScreenshotPath(parsed.preview_path);
      if (!isUnderDir(screenshotsRoot, previewPath)) {
        return createErrorResponse(
          'Bridge returned a screenshot preview path outside .mcp/screenshots/. Refusing to read.',
          [
            'This indicates a tampered or misbehaving McpBridge autoload',
            'Stop the project, verify the bridge script is the one shipped with this server, and retry',
          ],
        );
      }
      if (!existsSync(previewPath)) {
        return createErrorResponse(`Screenshot preview file not found at: ${previewPath}`, [
          'The preview may have failed to save',
          'Try again, or use responseMode "full" to return the original screenshot',
        ]);
      }
      const previewBuffer = readFileSync(previewPath);
      content.push({
        type: 'image',
        data: previewBuffer.toString('base64'),
        mimeType: 'image/png',
      });
      metadata.previewPath = parsed.preview_path;
      metadata.previewSize = { width: parsed.preview_width, height: parsed.preview_height };
    }

    attachRuntimeWarnings(metadata, runtimeErrors);

    content.push({ type: 'text', text: JSON.stringify(metadata) });

    return { content };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to take screenshot: ${getErrorMessage(error)}`, [
      'Check get_debug_output for crash backtraces or runtime errors',
      'If the game has exited, call stop_project, then run_project again',
      'For slow renders, increase the timeout parameter',
    ]);
  }
}

export async function handleSimulateInput(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);

  const sessionError = ensureRuntimeSession(runner, 'simulate input');
  if (sessionError) {
    return sessionError;
  }

  const actions = args.actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    return createErrorResponse('actions must be a non-empty array of input actions', [
      'Provide at least one action object with a "type" field',
    ]);
  }

  // Calculate timeout: sum of all wait durations + 10s buffer
  let totalWaitMs = 0;
  for (const action of actions) {
    if (
      typeof action === 'object' &&
      action !== null &&
      action.type === 'wait' &&
      typeof action.ms === 'number'
    ) {
      totalWaitMs += action.ms;
    }
  }
  const timeoutMs = totalWaitMs + 10000;

  try {
    const { response: responseStr, runtimeErrors } = await runner.sendCommandWithErrors(
      'input',
      { actions },
      timeoutMs,
    );

    const parsedResult = parseBridgeJson<{
      success?: boolean;
      error?: string;
      actions_processed?: number;
    }>(responseStr, 'simulate_input');
    if (!parsedResult.ok) return parsedResult.response;
    const parsed = parsedResult.data;

    if (parsed.error) {
      return createErrorResponse(`Input simulation error: ${parsed.error}`, [
        'Check action types and parameters',
        'Ensure key names are valid Godot key names',
      ]);
    }

    const payload: Record<string, unknown> = {
      success: true,
      actions_processed: parsed.actions_processed,
      tip: 'Call take_screenshot to verify the input had the intended visual effect.',
    };
    attachRuntimeWarnings(payload, runtimeErrors);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload),
        },
      ],
    };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to simulate input: ${getErrorMessage(error)}`, [
      'Check get_debug_output for crash backtraces or runtime errors (a signal handler firing on input may have crashed the game)',
      'If the game has exited, call stop_project, then run_project again',
    ]);
  }
}

export async function handleGetUiElements(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);

  const sessionError = ensureRuntimeSession(runner, 'query UI elements');
  if (sessionError) {
    return sessionError;
  }

  const visibleOnly = args.visibleOnly !== false;

  try {
    const cmdParams: Record<string, unknown> = { visible_only: visibleOnly };
    if (args.filter) cmdParams.type_filter = args.filter;
    const { response: responseStr, runtimeErrors } = await runner.sendCommandWithErrors(
      'get_ui_elements',
      cmdParams,
    );

    const parsedResult = parseBridgeJson<{ elements?: unknown[]; error?: string }>(
      responseStr,
      'get_ui_elements',
    );
    if (!parsedResult.ok) return parsedResult.response;
    const parsed = parsedResult.data;

    if (parsed.error) {
      return createErrorResponse(`UI element query error: ${parsed.error}`, [
        'Ensure the game has a UI with Control nodes',
      ]);
    }

    const payload: Record<string, unknown> = {
      ...parsed,
      tip: "Use simulate_input with type 'click_element' and a node_path or node name from this list to interact with these elements.",
    };
    attachRuntimeWarnings(payload, runtimeErrors);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload),
        },
      ],
    };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to get UI elements: ${getErrorMessage(error)}`, [
      'Check get_debug_output for crash backtraces or runtime errors',
      'If the game has exited, call stop_project, then run_project again',
    ]);
  }
}

export async function handleRunScript(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);

  const sessionError = ensureRuntimeSession(runner, 'execute scripts');
  if (sessionError) {
    return sessionError;
  }

  const script = args.script;
  if (typeof script !== 'string' || script.trim() === '') {
    return createErrorResponse('script is required and must be a non-empty string', [
      'Provide GDScript source code with extends Reference and func execute(scene_tree: SceneTree) -> Variant',
    ]);
  }

  if (!script.includes('func execute')) {
    return createErrorResponse(
      'Script must define func execute(scene_tree: SceneTree) -> Variant',
      ['Add a func execute(scene_tree: SceneTree) -> Variant method to your script'],
    );
  }

  // Write script to .mcp/scripts/ for audit trail
  try {
    const projectPath = runner.activeProjectPath;
    if (projectPath) {
      const scriptsDir = join(projectPath, '.mcp', 'scripts');
      mkdirSync(scriptsDir, { recursive: true });
      const timestamp = Date.now();
      const scriptFile = join(scriptsDir, `${timestamp}-${randomUUID()}.gd`);
      writeFileSync(scriptFile, script, 'utf8');
      logDebug(`Saved script to ${scriptFile}`);
    }
  } catch (error) {
    logDebug(`Failed to save script for audit: ${error}`);
  }

  const timeout = typeof args.timeout === 'number' ? args.timeout : 30000;

  try {
    const { response: responseStr, runtimeErrors } = await runner.sendCommandWithErrors(
      'run_script',
      { source: script },
      timeout,
    );

    const parsedResult = parseBridgeJson<{
      success?: boolean;
      result?: unknown;
      error?: string;
    }>(responseStr, 'run_script');
    if (!parsedResult.ok) return parsedResult.response;
    const parsed = parsedResult.data;

    if (parsed.error) {
      return createErrorResponse(`Script execution error: ${parsed.error}`, [
        'Check your GDScript syntax',
        'Ensure the script extends Reference',
        'Check get_debug_output for details',
      ]);
    }

    // Detect false-positive success: GDScript has no try-catch, so runtime errors
    // return null and the real error only appears in stderr.
    if (parsed.success && parsed.result === null && runner.activeSessionMode === 'spawned') {
      if (runtimeErrors.length > 0) {
        const errorContext = runtimeErrors.slice(0, MAX_RUNTIME_ERROR_CONTEXT_LINES).join('\n');
        return createErrorResponse(`Script runtime error detected:\n${errorContext}`, [
          'Fix the GDScript error in your script and retry',
          'Use get_debug_output for full process output',
        ]);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              result: null,
              warning:
                'Script returned null. If unexpected, check get_debug_output for runtime errors - GDScript does not propagate exceptions.',
              tip: 'Call take_screenshot to verify any visual changes, or get_debug_output to review print() output from your script.',
            }),
          },
        ],
      };
    }

    const payload: Record<string, unknown> = {
      success: true,
      result: parsed.result,
      tip: 'Call take_screenshot to verify any visual changes, or get_debug_output to review print() output from your script.',
    };
    attachRuntimeWarnings(payload, runtimeErrors);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload),
        },
      ],
    };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to execute script: ${getErrorMessage(error)}`, [
      'Check get_debug_output for crash backtraces or runtime errors raised inside the script',
      'If the game has exited, call stop_project, then run_project again',
      'For long-running scripts, increase the timeout parameter',
    ]);
  }
}

export async function handleGetPerformanceMetrics(runner: GodotRunner, _args: OperationParams) {
  const sessionError = ensureRuntimeSession(runner, 'read performance metrics');
  if (sessionError) {
    return sessionError;
  }

  try {
    const { response: responseStr } = await runner.sendCommandWithErrors(
      'performance_metrics',
      {},
      5000,
    );

    const parsedResult = parseBridgeJson<Record<string, number>>(responseStr, 'get_performance_metrics');
    if (!parsedResult.ok) return parsedResult.response;
    const parsed = parsedResult.data;

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(parsed, null, 2),
        },
      ],
    };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to get performance metrics: ${getErrorMessage(error)}`, [
      'Ensure the project is still running',
      'Try get_debug_output to check for runtime errors',
    ]);
  }
}

export async function handleQuerySpatialCollision(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const sessionError = ensureRuntimeSession(runner, 'query spatial collisions');
  if (sessionError) return sessionError;

  const origin = args.origin;
  const destination = args.destination;
  if (!origin || typeof origin !== 'object' || !destination || typeof destination !== 'object') {
    return createErrorResponse('origin and destination objects are required with x, y, and z numbers', [
      'Provide origin as {x: number, y: number, z: number}',
      'Provide destination as {x: number, y: number, z: number}',
    ]);
  }

  const payload: Record<string, unknown> = {
    origin,
    destination,
    collision_mask: typeof args.collisionMask === 'number' ? args.collisionMask : 1,
    exclude_bodies: Array.isArray(args.excludeBodies) ? args.excludeBodies : [],
  };

  try {
    const { response: responseStr } = await runner.sendCommandWithErrors(
      'query_spatial_collision',
      payload,
      10000,
    );

    const parsedResult = parseBridgeJson<any>(responseStr, 'query_spatial_collision');
    if (!parsedResult.ok) return parsedResult.response;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(parsedResult.data, null, 2),
        },
      ],
    };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to query spatial collision: ${getErrorMessage(error)}`, [
      'Ensure the project is still running',
      'Try get_debug_output to check for runtime errors',
    ]);
  }
}

export async function handleGetGroundClamp(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const sessionError = ensureRuntimeSession(runner, 'get ground clamp');
  if (sessionError) return sessionError;

  const position = args.position;
  if (!position || typeof position !== 'object') {
    return createErrorResponse('position object is required with x and z coordinates', [
      'Provide position as {x: number, z: number} or {x: number, y: number, z: number}',
    ]);
  }

  const payload: Record<string, unknown> = {
    position,
    max_height: typeof args.maxHeight === 'number' ? args.maxHeight : 100.0,
    min_height: typeof args.minHeight === 'number' ? args.minHeight : -100.0,
    collision_mask: typeof args.collisionMask === 'number' ? args.collisionMask : 1,
  };

  try {
    const { response: responseStr } = await runner.sendCommandWithErrors(
      'get_ground_clamp',
      payload,
      10000,
    );

    const parsedResult = parseBridgeJson<any>(responseStr, 'get_ground_clamp');
    if (!parsedResult.ok) return parsedResult.response;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(parsedResult.data, null, 2),
        },
      ],
    };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to get ground clamp: ${getErrorMessage(error)}`, [
      'Ensure the project is still running',
      'Try get_debug_output to check for runtime errors',
    ]);
  }
}

export async function handleRecordTelemetrySequence(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);

  const sessionErr = ensureRuntimeSession(runner, 'record telemetry sequence');
  if (sessionErr) return sessionErr;

  if (typeof args.targetNodePath !== 'string' || !args.targetNodePath) {
    return createErrorResponse('targetNodePath is required and must be a non-empty string', [
      'Provide a valid node path or node name to record',
    ]);
  }

  const duration = typeof args.duration === 'number' ? args.duration : 2.0;
  const interval = typeof args.interval === 'number' ? args.interval : 0.2;
  const captureScreenshots = args.captureScreenshots === true;

  if (duration <= 0 || duration > 30) {
    return createErrorResponse('duration must be a positive number up to 30 seconds', [
      'Reduce duration to avoid blocking connection for too long (max 30s)',
    ]);
  }

  if (interval < 0.05 || interval > 5) {
    return createErrorResponse('interval must be between 0.05 and 5 seconds', [
      'Provide a valid interval (e.g. 0.1s or 0.5s)',
    ]);
  }

  const payload: Record<string, unknown> = {
    target_node_path: args.targetNodePath,
    duration,
    interval,
    capture_screenshots: captureScreenshots,
  };

  try {
    const timeoutMs = (duration * 1000) + 10000;
    const { response: responseStr } = await runner.sendCommandWithErrors(
      'record_telemetry_sequence',
      payload,
      timeoutMs,
    );

    const parsedResult = parseBridgeJson<any>(responseStr, 'record_telemetry_sequence');
    if (!parsedResult.ok) return parsedResult.response;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(parsedResult.data, null, 2),
        },
      ],
    };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to record telemetry sequence: ${getErrorMessage(error)}`, [
      'Ensure the project is still running',
      'Try get_debug_output to check for runtime errors',
    ]);
  }
}

export async function handleNavigateTo(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);

  const sessionErr = ensureRuntimeSession(runner, 'navigate to');
  if (sessionErr) return sessionErr;

  if (typeof args.targetNodePath !== 'string' || !args.targetNodePath) {
    return createErrorResponse('targetNodePath is required and must be a non-empty string', [
      'Provide a valid node path or node name to navigate',
    ]);
  }

  if (typeof args.destination !== 'object' || args.destination === null) {
    return createErrorResponse('destination is required and must be a valid Vector3 object', [
      'Provide destination as { "x": x, "y": y, "z": z }',
    ]);
  }

  const speed = typeof args.speed === 'number' ? args.speed : 5.0;
  const tolerance = typeof args.tolerance === 'number' ? args.tolerance : 1.0;
  const timeout = typeof args.timeout === 'number' ? args.timeout : 10.0;

  if (timeout <= 0 || timeout > 180) {
    return createErrorResponse('timeout must be a positive number up to 180 seconds', [
      'Reduce timeout to avoid blocking connection for too long (max 180s)',
    ]);
  }

  const payload: Record<string, unknown> = {
    target_node_path: args.targetNodePath,
    destination: args.destination,
    speed,
    tolerance,
    timeout,
  };

  if (args.navigationNodePath !== undefined) {
    payload.navigation_node_path = args.navigationNodePath;
  }

  try {
    const timeoutMs = (timeout * 1000) + 10000;
    const { response: responseStr } = await runner.sendCommandWithErrors(
      'navigate_to',
      payload,
      timeoutMs,
    );

    const parsedResult = parseBridgeJson<any>(responseStr, 'navigate_to');
    if (!parsedResult.ok) return parsedResult.response;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(parsedResult.data, null, 2),
        },
      ],
    };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to navigate: ${getErrorMessage(error)}`, [
      'Ensure the project is still running',
      'Try get_debug_output to check for runtime errors',
    ]);
  }
}
