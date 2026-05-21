#!/usr/bin/env node
/**
 * Godot MCP Server
 *
 * This MCP server provides tools for interacting with the Godot game engine.
 * It enables AI assistants to launch the Godot editor, run Godot projects,
 * capture debug output, manipulate scenes and nodes, and more.
 */

// Lower-level `Server` is deliberate; see CONTRIBUTING.md "MCP SDK: Server vs McpServer".
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { GodotServerConfig } from './utils/godot-runner.js';
import { GodotRunner, getErrorMessage } from './utils/godot-runner.js';

import { dispatchToolCall } from './dispatch.js';
import { runtimeToolDefinitions } from './tools/runtime-tools.js';
import { autoloadToolDefinitions } from './tools/autoload-tools.js';
import { projectToolDefinitions } from './tools/project-tools.js';
import { sceneToolDefinitions } from './tools/scene-tools.js';
import { nodeToolDefinitions } from './tools/node-tools.js';
import { validateToolDefinitions } from './tools/validate-tools.js';
import { scriptToolDefinitions } from './tools/script-tools.js';
import { inputToolDefinitions } from './tools/input-tools.js';
import { resourceToolDefinitions } from './tools/resource-tools.js';
import { tilemapToolDefinitions } from './tools/tilemap-tools.js';
import { animationToolDefinitions } from './tools/animation-tools.js';
import { shaderToolDefinitions } from './tools/shader-tools.js';
import { importResourceToolDefinitions } from './tools/import-resource-tools.js';

export const allToolDefinitions = [
  ...runtimeToolDefinitions,
  ...autoloadToolDefinitions,
  ...projectToolDefinitions,
  ...sceneToolDefinitions,
  ...nodeToolDefinitions,
  ...validateToolDefinitions,
  ...scriptToolDefinitions,
  ...inputToolDefinitions,
  ...resourceToolDefinitions,
  ...tilemapToolDefinitions,
  ...animationToolDefinitions,
  ...shaderToolDefinitions,
  ...importResourceToolDefinitions,
];

export const serverInstructions = `Godot MCP Server - AI-driven Godot 3.x project manipulation.

Tool categories:
- Project management: launch_editor, run_project, attach_project, detach_project, stop_project, get_debug_output, list_projects, get_project_info
- Scene editing (headless): create_scene, add_node, load_sprite, save_scene, export_mesh_library, batch_scene_operations
- Node editing (headless): delete_nodes, set_node_properties, get_node_properties, attach_script, get_scene_tree, duplicate_node, get_node_signals, connect_signal, disconnect_signal, set_node_metadata, get_node_metadata, generate_gui_hierarchy
- Runtime (requires run_project or attach_project): take_screenshot, simulate_input, get_ui_elements, run_script, query_spatial_collision, get_ground_clamp
- Project config & Scripting (no Godot process): list_autoloads, add_autoload, remove_autoload, update_autoload, get_project_files, search_project, get_scene_dependencies, get_project_settings, list_script_elements, add_script_variable, add_script_signal, add_script_function, remove_script_function, list_input_actions, add_input_action, remove_input_action
- Resource & Material compiling: create_tres_resource, apply_spatial_material, compile_material_tree, create_shader_resource, apply_shader_material, set_tilemap_cell, set_gridmap_cell, configure_animation, pipe_animation_states
- Validation: validate

Key behaviors:
- All mutation operations (add_node, set_node_properties, delete_nodes, etc.) save the scene automatically. Only use save_scene for save-as (newPath) or re-canonicalization.
- Headless Godot initializes ALL registered autoloads. If any autoload is broken, headless operations will fail. Use list_autoloads / remove_autoload to diagnose.
- run_project verifies bridge readiness before returning success. If it reports degraded status, retry runtime tools after a moment or check get_debug_output.
- attach_project is the fallback path for a manually launched Godot process. It injects the bridge and marks the project active, but it does not spawn Godot or capture stdout/stderr.
- click_element in simulate_input resolves by node path or node name (BFS search), NOT by visible text. Use get_ui_elements to discover valid element identifiers.
- run_script expects GDScript with "extends Reference" and "func execute(scene_tree)" (Godot 3.x - no type annotations like ": SceneTree" or "-> Variant").
- run_project spawns Godot without -d so runtime errors do not pause execution; the \`breakpoint\` keyword in user code is a no-op (no debugger is attached). SCRIPT ERROR output and GDScript backtraces still appear in stderr.`;

class GodotMcpServer {
  private server: Server;
  private runner: GodotRunner;

  constructor(config?: GodotServerConfig) {
    this.runner = new GodotRunner(config);

    this.server = new Server(
      {
        name: 'godot-mcp',
        version: '3.1.1',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
        instructions: serverInstructions,
      },
    );

    this.setupToolHandlers();
    this.setupResourceHandlers();

    this.server.onerror = (error) => console.error('[MCP Error]', error);

    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private async cleanup() {
    console.error('[SERVER] Cleaning up resources');
    await this.runner.stopProject();
    await this.server.close();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: allToolDefinitions,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const args = request.params.arguments || {};

      console.error(`[SERVER] Handling tool request: ${toolName}`);

      return await dispatchToolCall(this.runner, toolName, args);
    });
  }

  private setupResourceHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'godot://scene/tree',
          name: 'Active Scene Tree',
          mimeType: 'application/json',
          description: 'The real-time scene node hierarchy of the running Godot game',
        },
        {
          uri: 'godot://performance/metrics',
          name: 'Engine Performance Metrics',
          mimeType: 'application/json',
          description: 'Real-time telemetry (FPS, Draw Calls, Memory, Physics/Render stats)',
        },
        {
          uri: 'godot://logs/debug',
          name: 'Cumulative Debug Logs',
          mimeType: 'text/plain',
          description: 'Stdout and stderr logs accumulated from the running Godot instance',
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      console.error(`[SERVER] Reading resource: ${uri}`);

      if (uri === 'godot://scene/tree') {
        if (!this.runner.activeSessionMode) {
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({ error: 'No active session. Please start the project first.' }),
              },
            ],
          };
        }

        const scriptSource = `extends Reference
func execute(scene_tree):
\tvar root = scene_tree.root
\treturn _dump_tree(root)

func _dump_tree(node):
\tvar children = []
\tfor child in node.get_children():
\t\tchildren.append(_dump_tree(child))
\treturn {
\t\t"name": String(node.name),
\t\t"class": node.get_class(),
\t\t"children": children
\t}`;

        try {
          const responseStr = await this.runner.sendCommand('run_script', { source: scriptSource }, 5000);
          const parsed = JSON.parse(responseStr);
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(parsed.result || parsed, null, 2),
              },
            ],
          };
        } catch (err: any) {
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({ error: `Failed to fetch scene tree: ${err.message}` }),
              },
            ],
          };
        }
      } else if (uri === 'godot://performance/metrics') {
        if (!this.runner.activeSessionMode) {
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({ error: 'No active session. Please start the project first.' }),
              },
            ],
          };
        }
        try {
          const responseStr = await this.runner.sendCommand('performance_metrics', {}, 5000);
          const parsed = JSON.parse(responseStr);
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(parsed, null, 2),
              },
            ],
          };
        } catch (err: any) {
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({ error: `Failed to fetch metrics: ${err.message}` }),
              },
            ],
          };
        }
      } else if (uri === 'godot://logs/debug') {
        if (this.runner.activeSessionMode === 'spawned' && this.runner.activeProcess) {
          const output = this.runner.activeProcess.output.join('\n');
          const errors = this.runner.activeProcess.errors.join('\n');
          const logs = `--- STDOUT ---\n${output}\n\n--- STDERR ---\n${errors}`;
          return {
            contents: [
              {
                uri,
                mimeType: 'text/plain',
                text: logs,
              },
            ],
          };
        } else if (this.runner.activeSessionMode === 'attached') {
          return {
            contents: [
              {
                uri,
                mimeType: 'text/plain',
                text: 'Attached mode active: debug logs are not captured by the MCP runner.',
              },
            ],
          };
        } else {
          return {
            contents: [
              {
                uri,
                mimeType: 'text/plain',
                text: 'No active Godot project session. Call run_project first.',
              },
            ],
          };
        }
      } else {
        throw new Error(`Unknown resource URI: ${uri}`);
      }
    });
  }

  async run() {
    try {
      await this.runner.detectGodotPath();

      const godotPath = this.runner.getGodotPath();
      if (godotPath) {
        console.error(`[SERVER] Using Godot at: ${godotPath}`);
      }
      // detectGodotPath() already emits a specific logError on failure (bad
      // GODOT_PATH, no binary found, etc.). Don't duplicate with a generic
      // warning here - the runner's message names the actual cause.

      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('Godot MCP server running on stdio');
    } catch (error: unknown) {
      console.error('[SERVER] Failed to start:', getErrorMessage(error));
      process.exit(1);
    }
  }
}

// Create and run the server
const server = new GodotMcpServer();
server.run().catch((error: unknown) => {
  console.error('Failed to run server:', getErrorMessage(error));
  process.exit(1);
});
