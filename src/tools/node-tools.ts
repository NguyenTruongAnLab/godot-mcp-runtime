import { existsSync } from 'fs';
import { join } from 'path';
import type { GodotRunner, OperationParams, ToolDefinition } from '../utils/godot-runner.js';
import {
  normalizeParameters,
  validateSubPath,
  validateNodePath,
  createErrorResponse,
  validateSceneArgs,
} from '../utils/godot-runner.js';
import { executeSceneOp } from '../utils/handler-helpers.js';

// --- Tool definitions ---

export const nodeToolDefinitions: ToolDefinition[] = [
  {
    name: 'delete_nodes',
    description:
      'Remove one or more nodes (and their descendants) from a scene file. Always-array: pass a single-element nodePaths array for one-off deletes. Saves once at the end. Cannot delete the scene root - that entry returns an error and the rest still process. Returns: results array with one entry per nodePath in input order (success or error message).',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: {
          type: 'string',
          description: 'Scene file path relative to the project (e.g. "scenes/main.tscn")',
        },
        nodePaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Node paths from scene root to delete (e.g. ["root/Player/Sprite"])',
        },
      },
      required: ['projectPath', 'scenePath', 'nodePaths'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nodePath: { type: 'string' },
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    name: 'set_node_properties',
    description:
      'Set one or more node properties on a scene in a single Godot process. Always-array: pass a single-element updates array for one-off edits. Vector2 ({x,y}), Vector3 ({x,y,z}), and Color ({r,g,b,a}) auto-convert; primitives pass through. For other complex GDScript types (Resource, NodePath, etc.), use run_script. abortOnError stops on first failure (default false continues). Saves once at the end. Returns: results[] with one entry per update in input order (success or error).',
    annotations: { idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        updates: {
          type: 'array',
          description: 'Property updates to apply',
          items: {
            type: 'object',
            properties: {
              nodePath: {
                type: 'string',
                description: 'Node path from scene root (e.g. "root/Player")',
              },
              property: {
                type: 'string',
                description:
                  'GDScript property name in snake_case (e.g. "position", "modulate", "collision_layer")',
              },
              value: { description: 'New property value' },
            },
            required: ['nodePath', 'property', 'value'],
          },
        },
        abortOnError: {
          type: 'boolean',
          description: 'Stop processing on first error (default: false)',
        },
      },
      required: ['projectPath', 'scenePath', 'updates'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nodePath: { type: 'string' },
              property: { type: 'string' },
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    name: 'get_node_properties',
    description:
      "Read one or more nodes' current property values from a scene file in a single Godot process. Always-array: pass a single-element nodes array for one-off reads. Per-node changedOnly:true filters out properties matching class defaults (useful for compact diffs). Returns: { results: [{ nodePath, nodeType, properties?, error? }] }; failed reads include error and omit properties.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        nodes: {
          type: 'array',
          description: 'Nodes to read properties from',
          items: {
            type: 'object',
            properties: {
              nodePath: {
                type: 'string',
                description: 'Node path from scene root (e.g. "root/Player")',
              },
              changedOnly: {
                type: 'boolean',
                description: 'Only return properties differing from defaults (default: false)',
              },
            },
            required: ['nodePath'],
          },
        },
      },
      required: ['projectPath', 'scenePath', 'nodes'],
    },
  },
  {
    name: 'attach_script',
    description:
      'Attach an existing GDScript file to a node in a scene. Use after writing the script with the standard file tools and validating it via the validate tool. Replaces any previously attached script. Saves automatically. Returns: success with the resolved nodePath and scriptPath that were attached. Errors if scriptPath does not exist or nodePath is not found.',
    annotations: { idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        nodePath: { type: 'string', description: 'Node path from scene root (e.g. "root/Player")' },
        scriptPath: {
          type: 'string',
          description:
            'Path to the GDScript file relative to the project (e.g. "scripts/player.gd")',
        },
      },
      required: ['projectPath', 'scenePath', 'nodePath', 'scriptPath'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        nodePath: { type: 'string' },
        scriptPath: { type: 'string' },
      },
    },
  },
  {
    name: 'get_scene_tree',
    description:
      'Get the scene hierarchy as a nested tree of { name, type, path, script, children }. Use maxDepth:1 for a shallow listing of direct children only; default -1 returns the full tree. parentPath scopes the result to a subtree. Returns the nested tree as JSON text. Errors if scene does not exist or parentPath is not found.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        parentPath: {
          type: 'string',
          description: 'Scope to a subtree starting at this node path (e.g. "root/Player")',
        },
        maxDepth: {
          type: 'number',
          description:
            'Maximum recursion depth. -1 for unlimited (default: -1). 1 returns only direct children.',
        },
      },
      required: ['projectPath', 'scenePath'],
    },
  },
  {
    name: 'duplicate_node',
    description:
      'Duplicate a node and its descendants in a Godot scene. Use to clone a configured subtree without re-creating it node-by-node via add_node. newName defaults to the original name + "2"; targetParentPath defaults to the original parent. Saves automatically. Returns: success with originalPath and the newPath where the duplicate now lives - use newPath for follow-up edits. Errors if nodePath does not exist or targetParentPath cannot accept children.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        nodePath: { type: 'string', description: 'Node path from scene root to duplicate' },
        newName: {
          type: 'string',
          description: 'Name for the duplicated node (default: original name + "2")',
        },
        targetParentPath: {
          type: 'string',
          description: 'Parent node path for the duplicate (default: same parent as original)',
        },
      },
      required: ['projectPath', 'scenePath', 'nodePath'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        originalPath: { type: 'string' },
        newPath: { type: 'string' },
      },
    },
  },
  {
    name: 'get_node_signals',
    description:
      'List all signals defined on a node and their current connections. Use before connect_signal/disconnect_signal to verify signal/method names. The connections[].target field uses Godot absolute path format (/root/Scene/Node) - convert to scene-root-relative (root/Node) before passing to connect/disconnect_signal. Returns: nodeType and signals[], each with name and current connections (signal/target/method). Errors if node not found.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        nodePath: { type: 'string', description: 'Node path from scene root (e.g. "root/Button")' },
      },
      required: ['projectPath', 'scenePath', 'nodePath'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        nodePath: { type: 'string' },
        nodeType: { type: 'string' },
        signals: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              connections: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    signal: { type: 'string' },
                    target: { type: 'string' },
                    method: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    name: 'connect_signal',
    description:
      'Connect a signal on a source node to a method on a target node, persisting the connection in the .tscn. Use after get_node_signals to confirm the signal name on the source and the method name on the target. Connecting the same signal+method pair twice creates a duplicate connection - call get_node_signals first if uncertain. Saves automatically. Returns a plain-text confirmation naming the source, signal, target, and method. Errors if the signal does not exist on the source node or the method does not exist on the target node.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        nodePath: { type: 'string', description: 'Source node path from scene root' },
        signal: {
          type: 'string',
          description: 'Signal name on the source node (e.g. "pressed", "body_entered")',
        },
        targetNodePath: {
          type: 'string',
          description: 'Target node path from scene root that receives the signal',
        },
        method: {
          type: 'string',
          description: 'Method name on the target node to call when the signal fires',
        },
      },
      required: ['projectPath', 'scenePath', 'nodePath', 'signal', 'targetNodePath', 'method'],
    },
  },
  {
    name: 'disconnect_signal',
    description:
      'Remove an existing signal connection between two nodes, persisting the change in the .tscn. Use get_node_signals first to confirm the connection exists; recovery requires reconnecting via connect_signal. Saves automatically. Returns a plain-text confirmation naming the disconnected signal and target. Errors if the connection does not exist.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        nodePath: { type: 'string', description: 'Source node path from scene root' },
        signal: { type: 'string', description: 'Signal name on the source node' },
        targetNodePath: { type: 'string', description: 'Target node path from scene root' },
        method: { type: 'string', description: 'Method name on the target node' },
      },
      required: ['projectPath', 'scenePath', 'nodePath', 'signal', 'targetNodePath', 'method'],
    },
  },
  {
    name: 'set_node_metadata',
    description:
      'Set custom metadata on an existing scene node. Useful for tagging nodes with gameplay metadata (e.g. marking a node as a "hazard", "collectible", setting score value) without creating a script. Saves automatically. Returns a plain-text confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        nodePath: {
          type: 'string',
          description: 'Path to the target node from scene root (e.g. "root/Player")',
        },
        metaName: { type: 'string', description: 'Name of the metadata key to set' },
        metaValue: { description: 'Value of the metadata to set (boolean, number, string, Vector2, Vector3, Color)' },
      },
      required: ['projectPath', 'scenePath', 'nodePath', 'metaName', 'metaValue'],
    },
  },
  {
    name: 'get_node_metadata',
    description:
      'Get metadata defined on a scene node. Can fetch a specific key or retrieve all metadata defined on the node. Returns structured JSON containing metadata key-value pairs.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        nodePath: {
          type: 'string',
          description: 'Path to the target node from scene root (e.g. "root/Player")',
        },
        metaName: {
          type: 'string',
          description: 'Optional name of the specific metadata key to retrieve. If not provided, retrieves all metadata.',
        },
      },
      required: ['projectPath', 'scenePath', 'nodePath'],
    },
  },
  {
    name: 'setup_control',
    description:
      "Configure a Control/Container node's layout, sizing, size flags, margins (for MarginContainer), separation (for BoxContainer), and grow directions in a single atomic transaction. Saves once at the end.",
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: {
          type: 'string',
          description: 'Scene file path relative to the project (e.g. "scenes/main.tscn")',
        },
        nodePath: {
          type: 'string',
          description: 'Path to the target Control node (e.g. "root/CanvasLayer/HUD")',
        },
        anchorPreset: {
          type: 'string',
          description:
            'Standard Godot Control anchor preset: "top_left", "top_right", "bottom_left", "bottom_right", "center_left", "center_top", "center_right", "center_bottom", "center", "left_wide", "top_wide", "right_wide", "bottom_wide", "vcenter_wide", "hcenter_wide", "full_rect"',
          enum: [
            'top_left',
            'top_right',
            'bottom_left',
            'bottom_right',
            'center_left',
            'center_top',
            'center_right',
            'center_bottom',
            'center',
            'left_wide',
            'top_wide',
            'right_wide',
            'bottom_wide',
            'vcenter_wide',
            'hcenter_wide',
            'full_rect',
          ],
        },
        minSize: {
          type: 'string',
          description: 'Minimum size as a Vector2 expression (e.g. "Vector2(100, 50)")',
        },
        sizeFlagsH: {
          type: 'string',
          description: 'Horizontal size flags: "fill", "expand", "fill_expand", "shrink_center", "shrink_end"',
          enum: ['fill', 'expand', 'fill_expand', 'shrink_center', 'shrink_end'],
        },
        sizeFlagsV: {
          type: 'string',
          description: 'Vertical size flags: "fill", "expand", "fill_expand", "shrink_center", "shrink_end"',
          enum: ['fill', 'expand', 'fill_expand', 'shrink_center', 'shrink_end'],
        },
        margins: {
          type: 'object',
          description: 'Margin constant overrides (for MarginContainer nodes only)',
          properties: {
            left: { type: 'integer', description: 'Margin left override (margin_left)' },
            top: { type: 'integer', description: 'Margin top override (margin_top)' },
            right: { type: 'integer', description: 'Margin right override (margin_right)' },
            bottom: { type: 'integer', description: 'Margin bottom override (margin_bottom)' },
          },
        },
        separation: {
          type: 'integer',
          description: 'Separation constant override (for BoxContainer, HBoxContainer, VBoxContainer)',
        },
        growH: {
          type: 'string',
          description: 'Horizontal grow direction: "begin", "end", "both"',
          enum: ['begin', 'end', 'both'],
        },
        growV: {
          type: 'string',
          description: 'Vertical grow direction: "begin", "end", "both"',
          enum: ['begin', 'end', 'both'],
        },
      },
      required: ['projectPath', 'scenePath', 'nodePath'],
    },
  },
  {
    name: 'setup_collision',
    description:
      'Headlessly creates or overrides 2D/3D collision shapes on a PhysicsBody (KinematicBody, StaticBody, RigidBody) or Area node. Auto-detects space dimension (2D/3D) based on node class hierarchy, maps sizes to extents/radius/height, caches/overwrites shape node, and saves scene.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: {
          type: 'string',
          description: 'Scene file path relative to the project (e.g. "scenes/main.tscn")',
        },
        nodePath: {
          type: 'string',
          description: 'Path to the target physics body or area node (e.g. "root/Player")',
        },
        shape: {
          type: 'string',
          description:
            'Collision shape type: "rectangle"/"rect", "circle", "capsule", "segment", "convex"/"custom" for 2D; or "box", "sphere", "capsule", "cylinder", "convex" for 3D',
        },
        dimension: {
          type: 'string',
          description: 'Force dimension: "2d" or "3d" (usually auto-detected from node class)',
          enum: ['2d', '3d'],
        },
        width: { type: 'number', description: 'Width of rectangle/box/segment shape' },
        height: { type: 'number', description: 'Height of rectangle/box/capsule/cylinder shape' },
        depth: { type: 'number', description: 'Depth of 3D box shape' },
        radius: { type: 'number', description: 'Radius of circle/sphere/capsule/cylinder shape' },
        ax: { type: 'number', description: 'Start X for 2D segment shape' },
        ay: { type: 'number', description: 'Start Y for 2D segment shape' },
        bx: { type: 'number', description: 'End X for 2D segment shape' },
        by: { type: 'number', description: 'End Y for 2D segment shape' },
        points: {
          type: 'array',
          items: { type: 'array', items: { type: 'number' } },
          description: 'Points list for convex shape: array of [x, y] or [x, y, z] arrays',
        },
        disabled: { type: 'boolean', description: 'Whether the collision shape is disabled' },
        oneWayCollision: {
          type: 'boolean',
          description: 'Enable one-way collision (2D only)',
        },
      },
      required: ['projectPath', 'scenePath', 'nodePath', 'shape'],
    },
  },
  {
    name: 'add_mesh_instance',
    description:
      'Headlessly creates and adds a MeshInstance node to a Spatial (3D) parent node, supporting primitive shape mesh resource instantiation or GLTF/GLB/Tscn scene mesh extraction. Replaces translation/rotation/scale/properties, sets scene tree ownership, and saves scene automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: {
          type: 'string',
          description: 'Scene file path relative to the project (e.g. "scenes/main.tscn")',
        },
        parentPath: {
          type: 'string',
          description: 'Path to the parent Spatial node from scene root (default: root node)',
        },
        name: {
          type: 'string',
          description: 'Name for the new MeshInstance node (default: "MeshInstance")',
        },
        meshType: {
          type: 'string',
          description:
            'Primitive mesh resource type: "CubeMesh" (or "BoxMesh"), "SphereMesh", "CylinderMesh", "CapsuleMesh", "PlaneMesh", "PrismMesh", "QuadMesh"',
          enum: [
            'CubeMesh',
            'BoxMesh',
            'SphereMesh',
            'CylinderMesh',
            'CapsuleMesh',
            'PlaneMesh',
            'PrismMesh',
            'QuadMesh',
          ],
        },
        meshFile: {
          type: 'string',
          description: 'Path to a mesh resource or PackedScene resource to load (e.g. "res://models/car.glb")',
        },
        meshProperties: {
          type: 'object',
          description: 'Properties to set on the primitive mesh resource (e.g. { "size": { "x": 2, "y": 2, "z": 2 } })',
        },
        position: {
          type: 'object',
          description: 'Spatial translation Vector3 (e.g. { "x": 0, "y": 1, "z": 0 })',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
          },
          required: ['x', 'y', 'z'],
        },
        rotation: {
          type: 'object',
          description: 'Spatial rotation degrees Vector3 (e.g. { "x": 0, "y": 90, "z": 0 })',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
          },
          required: ['x', 'y', 'z'],
        },
        scale: {
          type: 'object',
          description: 'Spatial scale Vector3 (e.g. { "x": 1, "y": 1, "z": 1 })',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
          },
          required: ['x', 'y', 'z'],
        },
      },
      required: ['projectPath', 'scenePath'],
    },
  },
  {
    name: 'set_physics_layers',
    description:
      'Modifies physics collision layers and collision masks for a 2D or 3D physics body or Area node. Accepts either an integer bitmask (0 to 4294967295) or an array of active layer indices (1-32) that will be bitwise OR-ed together. Saves automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        nodePath: { type: 'string', description: 'Node path from scene root (e.g. "root/Player")' },
        collisionLayer: {
          description: 'New collision layer bitmask (int) or array of active layer indices (1-32)',
          oneOf: [
            { type: 'integer' },
            { type: 'array', items: { type: 'integer', minimum: 1, maximum: 32 } },
          ],
        },
        collisionMask: {
          description: 'New collision mask bitmask (int) or array of active layer indices (1-32)',
          oneOf: [
            { type: 'integer' },
            { type: 'array', items: { type: 'integer', minimum: 1, maximum: 32 } },
          ],
        },
      },
      required: ['projectPath', 'scenePath', 'nodePath'],
    },
  },
  {
    name: 'get_physics_layers',
    description:
      'Reads the active collision layer and mask of a physics body or Area node. Auto-detects 2D/3D context and resolves active layer/mask indices to their human-readable names configured in the project settings (project.godot).',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        nodePath: { type: 'string', description: 'Node path from scene root (e.g. "root/Player")' },
      },
      required: ['projectPath', 'scenePath', 'nodePath'],
    },
  },
  {
    name: 'add_raycast',
    description:
      'Creates and adds a RayCast (3D) or RayCast2D node under a specified parent node in the scene. Configures enabled state, collision masks, targets, and collision behaviors. Saves automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        parentPath: { type: 'string', description: 'Parent node path from scene root (default: root node)' },
        name: { type: 'string', description: 'Name for the new RayCast node (default: "RayCast")' },
        dimension: {
          type: 'string',
          description: 'Force space dimension: "2d" or "3d". If omitted, auto-detected from parent node.',
          enum: ['2d', '3d'],
        },
        enabled: { type: 'boolean', description: 'Whether the raycast is enabled (default: true)' },
        collisionMask: { type: 'integer', description: 'Collision mask bitmask to detect (default: 1)' },
        collideWithAreas: { type: 'boolean', description: 'Whether to detect Area collisions (default: false)' },
        collideWithBodies: { type: 'boolean', description: 'Whether to detect PhysicsBody collisions (default: true)' },
        targetX: { type: 'number', description: 'Target offset X (default: 0.0)' },
        targetY: { type: 'number', description: 'Target offset Y (default: 50.0 for 2D, -1.0 for 3D)' },
        targetZ: { type: 'number', description: 'Target offset Z (3D only, default: 0.0)' },
      },
      required: ['projectPath', 'scenePath'],
    },
  },
  {
    name: 'setup_camera',
    description:
      'Creates or configures a Camera (3D) or Camera2D node under a specified parent in the scene. Configures viewport active status, field-of-view, zoom, position/translation offsets, and rotation. Saves automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        parentPath: { type: 'string', description: 'Parent node path from scene root (default: root node)' },
        name: { type: 'string', description: 'Name for the Camera node (default: "Camera" or "Camera2D")' },
        dimension: {
          type: 'string',
          description: 'Force space dimension: "2d" or "3d". If omitted, auto-detected from parent node.',
          enum: ['2d', '3d'],
        },
        current: { type: 'boolean', description: 'Make the camera current (active view) in viewport (default: true)' },
        zoom: {
          type: 'object',
          description: '2D camera zoom factor Vector2 (e.g. { "x": 1.0, "y": 1.0 })',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['x', 'y'],
        },
        fov: { type: 'number', description: '3D camera Field-of-View in degrees (default: 70.0)' },
        near: { type: 'number', description: 'Camera near clipping plane distance' },
        far: { type: 'number', description: 'Camera far clipping plane distance' },
        position: {
          type: 'object',
          description: 'Camera position/translation Vector2/3 (e.g. { "x": 0, "y": 5, "z": 10 })',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
          },
          required: ['x', 'y'],
        },
        rotation: {
          type: 'object',
          description: 'Camera rotation degrees Vector3 (3D only, e.g. { "x": -15, "y": 0, "z": 0 })',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
          },
          required: ['x', 'y', 'z'],
        },
        lookAt: {
          type: 'object',
          description: 'Optional Vector3 coordinate target to look at (3D only). Overrides rotation.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
          },
          required: ['x', 'y', 'z'],
        },
      },
      required: ['projectPath', 'scenePath'],
    },
  },
  {
    name: 'setup_lighting',
    description:
      'Creates and configures a 3D light node (DirectionalLight, OmniLight, SpotLight) under a specified Spatial parent. Supports light presets (sun, indoor, dramatic) or detailed properties (color, energy, shadows, range, spot angle). Saves automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        parentPath: { type: 'string', description: 'Parent Spatial node path from scene root (default: root node)' },
        name: { type: 'string', description: 'Name for the light node (default: matches light type or preset)' },
        lightType: {
          type: 'string',
          description: 'Type of light: "DirectionalLight", "OmniLight", or "SpotLight" (default: "DirectionalLight")',
          enum: ['DirectionalLight', 'OmniLight', 'SpotLight'],
        },
        preset: {
          type: 'string',
          description: 'Preset light rig configuration: "sun" (Directional+Shadows), "indoor" (soft Omni), "dramatic" (bright Spot)',
          enum: ['sun', 'indoor', 'dramatic'],
        },
        color: {
          type: 'object',
          description: 'Light color RGBA (e.g. { "r": 1.0, "g": 0.95, "b": 0.85, "a": 1.0 })',
          properties: {
            r: { type: 'number' },
            g: { type: 'number' },
            b: { type: 'number' },
            a: { type: 'number' },
          },
          required: ['r', 'g', 'b', 'a'],
        },
        energy: { type: 'number', description: 'Light energy/intensity multiplier' },
        shadows: { type: 'boolean', description: 'Whether to enable shadow rendering' },
        range: { type: 'number', description: 'OmniLight/SpotLight attenuation range in units' },
        attenuation: { type: 'number', description: 'OmniLight/SpotLight attenuation curve' },
        spotAngle: { type: 'number', description: 'SpotLight cone angle in degrees' },
        spotAngleAttenuation: { type: 'number', description: 'SpotLight cone angle attenuation' },
        position: {
          type: 'object',
          description: 'Light translation Vector3 (e.g. { "x": 0, "y": 10, "z": 0 })',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
          },
          required: ['x', 'y', 'z'],
        },
        rotation: {
          type: 'object',
          description: 'Light rotation degrees Vector3 (e.g. { "x": -45, "y": -30, "z": 0 })',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
          },
          required: ['x', 'y', 'z'],
        },
      },
      required: ['projectPath', 'scenePath'],
    },
  },
  {
    name: 'setup_environment',
    description:
      'Creates or configures a WorldEnvironment node and Environment resource. Sets ambient lightning, background modes, procedural skies, glow, fog, and SSR/SSAO options. Saves automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        parentPath: { type: 'string', description: 'Parent node path from scene root (default: root node)' },
        name: { type: 'string', description: 'Name for the WorldEnvironment node (default: "WorldEnvironment")' },
        ambientMode: {
          type: 'string',
          description: 'Environment background mode: "sky", "color", "canvas", "clear_color" (default: "color")',
          enum: ['sky', 'color', 'canvas', 'clear_color'],
        },
        ambientColor: {
          type: 'object',
          description: 'Ambient light or background color (e.g. { "r": 0.2, "g": 0.2, "b": 0.2, "a": 1.0 })',
          properties: {
            r: { type: 'number' },
            g: { type: 'number' },
            b: { type: 'number' },
            a: { type: 'number' },
          },
          required: ['r', 'g', 'b', 'a'],
        },
        ambientEnergy: { type: 'number', description: 'Ambient light energy/intensity multiplier' },
        skyType: {
          type: 'string',
          description: 'Sky resource type to instantiate: "ProceduralSky" or "none" (default: "none")',
          enum: ['ProceduralSky', 'none'],
        },
        skyTopColor: {
          type: 'object',
          description: 'ProceduralSky top/sky color',
          properties: { r: { type: 'number' }, g: { type: 'number' }, b: { type: 'number' }, a: { type: 'number' } },
          required: ['r', 'g', 'b', 'a'],
        },
        skyHorizonColor: {
          type: 'object',
          description: 'ProceduralSky horizon color',
          properties: { r: { type: 'number' }, g: { type: 'number' }, b: { type: 'number' }, a: { type: 'number' } },
          required: ['r', 'g', 'b', 'a'],
        },
        groundBottomColor: {
          type: 'object',
          description: 'ProceduralSky ground bottom color',
          properties: { r: { type: 'number' }, g: { type: 'number' }, b: { type: 'number' }, a: { type: 'number' } },
          required: ['r', 'g', 'b', 'a'],
        },
        groundHorizonColor: {
          type: 'object',
          description: 'ProceduralSky ground horizon color',
          properties: { r: { type: 'number' }, g: { type: 'number' }, b: { type: 'number' }, a: { type: 'number' } },
          required: ['r', 'g', 'b', 'a'],
        },
        glowEnabled: { type: 'boolean', description: 'Enable glow/bloom post-processing effect' },
        ssaoEnabled: { type: 'boolean', description: 'Enable Screen Space Ambient Occlusion (3D only)' },
        ssrEnabled: { type: 'boolean', description: 'Enable Screen Space Reflections (3D only)' },
        fogEnabled: { type: 'boolean', description: 'Enable fog rendering effect' },
      },
      required: ['projectPath', 'scenePath'],
    },
  },
  {
    name: 'setup_navigation_3d',
    description:
      'Creates or configures a 3D Navigation node, instantiates a NavigationMeshInstance, and bakes the NavigationMesh headlessly. Can optionally setup a NavigationAgent under an agent node.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        parentPath: { type: 'string', description: 'Parent node path for the Navigation node (default: root node)' },
        navigationName: { type: 'string', description: 'Name of the Navigation node (default: "Navigation")' },
        name: { type: 'string', description: 'Name of the NavigationMeshInstance node (default: "NavigationMeshInstance")' },
        cellSize: { type: 'number', description: 'Cell size for navigation mesh generation' },
        cellHeight: { type: 'number', description: 'Cell height for navigation mesh generation' },
        agentHeight: { type: 'number', description: 'Agent height for navigation mesh generation' },
        agentRadius: { type: 'number', description: 'Agent radius for navigation mesh generation' },
        agentMaxClimb: { type: 'number', description: 'Agent max climb height for navigation mesh generation' },
        agentMaxSlope: { type: 'number', description: 'Agent max slope angle in degrees' },
        setupAgent: { type: 'boolean', description: 'Whether to also setup a NavigationAgent' },
        agentParentPath: { type: 'string', description: 'Parent node path for the NavigationAgent' },
        agentName: { type: 'string', description: 'Name of the NavigationAgent node (default: "NavigationAgent")' },
      },
      required: ['projectPath', 'scenePath'],
    },
  },
  {
    name: 'create_particles_3d',
    description:
      'Creates and configures a CPUParticles node (GLES2/3 compatible) in the 3D scene using pre-configured presets (fire, smoke, sparks) or custom settings.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        parentPath: { type: 'string', description: 'Parent Spatial node path (default: root node)' },
        name: { type: 'string', description: 'Name for the new CPUParticles node (default: "CPUParticles")' },
        preset: {
          type: 'string',
          description: 'Particle effect preset name: "fire", "smoke", "sparks"',
          enum: ['fire', 'smoke', 'sparks'],
        },
        amount: { type: 'integer', description: 'Number of particles emitted in one cycle' },
        lifetime: { type: 'number', description: 'Lifetime of each particle in seconds' },
        explosiveness: { type: 'number', description: 'Explosiveness factor (0.0 to 1.0)' },
        direction: {
          type: 'object',
          description: 'Emission direction Vector3',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          required: ['x', 'y', 'z'],
        },
        spread: { type: 'number', description: 'Spread angle in degrees' },
        gravity: {
          type: 'object',
          description: 'Gravity force Vector3 applied to particles',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          required: ['x', 'y', 'z'],
        },
        initialVelocity: { type: 'number', description: 'Initial velocity multiplier' },
        position: {
          type: 'object',
          description: 'Translation Vector3 of the emitter',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          required: ['x', 'y', 'z'],
        },
      },
      required: ['projectPath', 'scenePath'],
    },
  },
  {
    name: 'setup_animation_tree',
    description:
      'Creates or configures an AnimationTree node with an AnimationNodeStateMachine root, sets its AnimationPlayer, adds states, and connects transitions.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        parentPath: { type: 'string', description: 'Parent node path from scene root (default: root node)' },
        name: { type: 'string', description: 'Name of the AnimationTree node (default: "AnimationTree")' },
        animPlayerPath: { type: 'string', description: 'Relative path to the AnimationPlayer node' },
        states: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of animation names to add as states in the state machine',
        },
        transitions: {
          type: 'array',
          description: 'Array of state transition mappings',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'Source state name' },
              to: { type: 'string', description: 'Target state name' },
              autoAdvance: { type: 'boolean', description: 'Whether to transition automatically when finished' },
            },
            required: ['from', 'to'],
          },
        },
        active: { type: 'boolean', description: 'Whether the AnimationTree is active (default: true)' },
      },
      required: ['projectPath', 'scenePath'],
    },
  },
  {
    name: 'setup_collision_3d',
    description:
      'Generates and aligns a CollisionShape sibling/child node next to a MeshInstance, using its precise mesh geometry AABB bounding box, and instantiates a BoxShape or convex/concave shape.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        nodePath: { type: 'string', description: 'Path to the target MeshInstance node' },
        collisionType: {
          type: 'string',
          description: 'Collision shape synthesis strategy: "box", "convex", "sphere", "cylinder"',
          enum: ['box', 'convex', 'sphere', 'cylinder'],
        },
      },
      required: ['projectPath', 'scenePath', 'nodePath'],
    },
  },
  {
    name: 'setup_joint_3d',
    description:
      'Instantiates and configures a physical Joint node (Pin, Hinge, Slider, ConeTwist, or Generic6DOF) connecting two physics bodies.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        parentPath: { type: 'string', description: 'Parent Spatial node path (default: root node)' },
        jointType: {
          type: 'string',
          description: 'Type of joint to create: PinJoint, HingeJoint, SliderJoint, ConeTwistJoint, Generic6DOFJoint',
          enum: ['PinJoint', 'HingeJoint', 'SliderJoint', 'ConeTwistJoint', 'Generic6DOFJoint'],
        },
        name: { type: 'string', description: 'Name of the Joint node (default: matches jointType)' },
        nodeA: { type: 'string', description: 'Path to physics body A node' },
        nodeB: { type: 'string', description: 'Path to physics body B node' },
        position: {
          type: 'object',
          description: 'Joint translation Vector3',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          required: ['x', 'y', 'z'],
        },
        rotation: {
          type: 'object',
          description: 'Joint rotation degrees Vector3',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          required: ['x', 'y', 'z'],
        },
      },
      required: ['projectPath', 'scenePath'],
    },
  },
  {
    name: 'generate_gui_hierarchy',
    description:
      'Headlessly compiles and generates a deep recursive Control-based GUI hierarchy under a target parent node in a single atomic transaction. Supports custom properties, layout presets, minimum sizes, and margins for each node. Returns: information about the created GUI hierarchy including success status, resolved paths, and the name of the root generated node.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: {
          type: 'string',
          description: 'Scene file path relative to the project (e.g. "scenes/main.tscn")',
        },
        parentPath: {
          type: 'string',
          description: 'Parent Control node path from scene root (e.g. "root/CanvasLayer", defaults to "root")',
        },
        hierarchy: {
          type: 'object',
          description: 'Recursive dictionary describing the GUI tree hierarchy to build. Each node object contains: type (e.g., "Panel", "Label", "MarginContainer"), name, anchorPreset ("full_rect", "center", etc.), margins (object with left, top, right, bottom), minSize (Vector2-like {x, y}), properties (key-value dictionary), and children (array of node objects).',
        },
      },
      required: ['projectPath', 'scenePath', 'hierarchy'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        scene_path: { type: 'string' },
        parent_path: { type: 'string' },
        root_node_name: { type: 'string' },
        root_node_path: { type: 'string' },
      },
    },
  },
];

// --- Handlers ---

export async function handleDeleteNodes(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePaths || !Array.isArray(args.nodePaths) || args.nodePaths.length === 0) {
    return createErrorResponse('nodePaths array is required', [
      'Provide a non-empty array of node paths (e.g. ["root/Player"])',
    ]);
  }
  for (const p of args.nodePaths as unknown[]) {
    if (typeof p !== 'string' || !validateNodePath(p)) {
      return createErrorResponse('Invalid nodePath in nodePaths', [
        'Provide a scene-tree path without ".." (e.g. "root/Player")',
      ]);
    }
  }

  const params = { scenePath: args.scenePath, nodePaths: args.nodePaths };
  return executeSceneOp(runner, 'delete_nodes', params, v.projectPath, 'Failed to delete nodes', [
    'Check if the node paths are correct',
  ]);
}

export async function handleSetNodeProperties(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.updates || !Array.isArray(args.updates)) {
    return createErrorResponse('updates array is required', [
      'Provide an array of { nodePath, property, value }',
    ]);
  }

  const params = {
    scenePath: args.scenePath,
    updates: args.updates,
    abortOnError: args.abortOnError ?? false,
  };
  return executeSceneOp(
    runner,
    'set_node_properties',
    params,
    v.projectPath,
    'Failed to set node properties',
    ['Check node paths and property names'],
  );
}

export async function handleGetNodeProperties(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodes || !Array.isArray(args.nodes)) {
    return createErrorResponse('nodes array is required', [
      'Provide an array of { nodePath, changedOnly? }',
    ]);
  }

  const params = { scenePath: args.scenePath, nodes: args.nodes };
  return executeSceneOp(
    runner,
    'get_node_properties',
    params,
    v.projectPath,
    'Failed to get node properties',
    ['Check node paths'],
  );
}

export async function handleAttachScript(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePath || !validateNodePath(args.nodePath as string)) {
    return createErrorResponse('Valid nodePath is required', [
      'Provide the node path (e.g. "root/Player")',
    ]);
  }
  if (!args.scriptPath || !validateSubPath(v.projectPath, args.scriptPath as string)) {
    return createErrorResponse('Valid scriptPath is required', [
      'Provide a relative script path that stays inside the project directory',
    ]);
  }
  const scriptFullPath = join(v.projectPath, args.scriptPath as string);
  if (!existsSync(scriptFullPath)) {
    return createErrorResponse(`Script file does not exist: ${args.scriptPath}`, [
      'Create the script file first',
    ]);
  }

  const params = {
    scenePath: args.scenePath,
    nodePath: args.nodePath,
    scriptPath: args.scriptPath,
  };
  return executeSceneOp(runner, 'attach_script', params, v.projectPath, 'Failed to attach script', [
    'Ensure the script is valid for this node type',
  ]);
}

export async function handleGetSceneTree(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (args.parentPath && !validateNodePath(args.parentPath as string)) {
    return createErrorResponse('Invalid parentPath', [
      'Provide a scene-tree path without ".." (e.g. "root/Player")',
    ]);
  }

  const params: OperationParams = { scenePath: args.scenePath };
  if (args.parentPath) params.parentPath = args.parentPath;
  if (typeof args.maxDepth === 'number') params.maxDepth = args.maxDepth;
  return executeSceneOp(
    runner,
    'get_scene_tree',
    params,
    v.projectPath,
    'Failed to get scene tree',
    ['Ensure the scene is valid'],
  );
}

export async function handleDuplicateNode(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePath || !validateNodePath(args.nodePath as string)) {
    return createErrorResponse('Valid nodePath is required', [
      'Provide the node path to duplicate',
    ]);
  }
  if (args.targetParentPath && !validateNodePath(args.targetParentPath as string)) {
    return createErrorResponse('Invalid targetParentPath', [
      'Provide a scene-tree path without ".." (e.g. "root/Player")',
    ]);
  }

  const params: OperationParams = { scenePath: args.scenePath, nodePath: args.nodePath };
  if (args.newName) params.newName = args.newName;
  if (args.targetParentPath) params.targetParentPath = args.targetParentPath;
  return executeSceneOp(
    runner,
    'duplicate_node',
    params,
    v.projectPath,
    'Failed to duplicate node',
    ['Check if the node path and target parent path are correct'],
  );
}

export async function handleGetNodeSignals(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePath || !validateNodePath(args.nodePath as string)) {
    return createErrorResponse('Valid nodePath is required', [
      'Provide the node path (e.g. "root/Button")',
    ]);
  }

  const params = { scenePath: args.scenePath, nodePath: args.nodePath };
  return executeSceneOp(
    runner,
    'get_node_signals',
    params,
    v.projectPath,
    'Failed to get node signals',
    ['Check if the node path is correct'],
  );
}

interface ValidatedSignalArgs {
  projectPath: string;
  scenePath: string;
  nodePath: string;
  signal: string;
  targetNodePath: string;
  method: string;
}

function validateSignalArgs(
  args: OperationParams,
): ValidatedSignalArgs | ReturnType<typeof createErrorResponse> {
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePath || !validateNodePath(args.nodePath as string)) {
    return createErrorResponse('Valid nodePath is required', ['Provide the source node path']);
  }
  if (!args.signal || !args.targetNodePath || !args.method) {
    return createErrorResponse('signal, targetNodePath, and method are required', [
      'Provide all three parameters',
    ]);
  }
  if (!validateNodePath(args.targetNodePath as string)) {
    return createErrorResponse('Invalid targetNodePath', [
      'Provide a scene-tree path without ".." (e.g. "root/Player")',
    ]);
  }

  return {
    projectPath: v.projectPath,
    scenePath: v.scenePath,
    nodePath: args.nodePath as string,
    signal: args.signal as string,
    targetNodePath: args.targetNodePath as string,
    method: args.method as string,
  };
}

export async function handleConnectSignal(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSignalArgs(args);
  if ('isError' in v) return v;

  const params = {
    scenePath: v.scenePath,
    nodePath: v.nodePath,
    signal: v.signal,
    targetNodePath: v.targetNodePath,
    method: v.method,
  };
  return executeSceneOp(
    runner,
    'connect_signal',
    params,
    v.projectPath,
    'Failed to connect signal',
    ['Ensure the signal exists on the source node and the method exists on the target node'],
  );
}

export async function handleDisconnectSignal(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSignalArgs(args);
  if ('isError' in v) return v;

  const params = {
    scenePath: v.scenePath,
    nodePath: v.nodePath,
    signal: v.signal,
    targetNodePath: v.targetNodePath,
    method: v.method,
  };
  return executeSceneOp(
    runner,
    'disconnect_signal',
    params,
    v.projectPath,
    'Failed to disconnect signal',
    ['Ensure the signal connection exists before trying to disconnect it'],
  );
}

export async function handleSetNodeMetadata(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePath || !validateNodePath(args.nodePath as string)) {
    return createErrorResponse('Valid nodePath is required', ['Provide the target node path']);
  }
  if (!args.metaName || typeof args.metaName !== 'string' || args.metaName.trim() === '') {
    return createErrorResponse('Valid metaName is required', ['Provide a non-empty string for the metadata key']);
  }
  if (args.metaValue === undefined) {
    return createErrorResponse('metaValue is required', ['Provide a value to set for the metadata key']);
  }

  const params = {
    scenePath: args.scenePath,
    nodePath: args.nodePath,
    metaName: args.metaName,
    metaValue: args.metaValue,
  };
  return executeSceneOp(
    runner,
    'set_node_metadata',
    params,
    v.projectPath,
    'Failed to set node metadata',
    ['Check that the node exists and is valid'],
  );
}

export async function handleGetNodeMetadata(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePath || !validateNodePath(args.nodePath as string)) {
    return createErrorResponse('Valid nodePath is required', ['Provide the target node path']);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
    nodePath: args.nodePath,
  };
  if (args.metaName !== undefined) {
    params.metaName = args.metaName;
  }

  return executeSceneOp(
    runner,
    'get_node_metadata',
    params,
    v.projectPath,
    'Failed to get node metadata',
    ['Check that the node exists and has metadata defined'],
  );
}

export async function handleSetupControl(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePath || !validateNodePath(args.nodePath as string)) {
    return createErrorResponse('Valid nodePath is required', ['Provide the target node path']);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
    nodePath: args.nodePath,
  };

  if (args.anchorPreset !== undefined) params.anchorPreset = args.anchorPreset;
  if (args.minSize !== undefined) params.minSize = args.minSize;
  if (args.sizeFlagsH !== undefined) params.sizeFlagsH = args.sizeFlagsH;
  if (args.sizeFlagsV !== undefined) params.sizeFlagsV = args.sizeFlagsV;
  if (args.margins !== undefined) params.margins = args.margins;
  if (args.separation !== undefined) params.separation = args.separation;
  if (args.growH !== undefined) params.growH = args.growH;
  if (args.growV !== undefined) params.growV = args.growV;

  return executeSceneOp(
    runner,
    'setup_control',
    params,
    v.projectPath,
    'Failed to setup Control node layout',
    ['Check that the node exists, is a Control, and the parameters are valid'],
  );
}

export async function handleSetupCollision(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePath || !validateNodePath(args.nodePath as string)) {
    return createErrorResponse('Valid nodePath is required', ['Provide the physics body or area node path']);
  }
  if (!args.shape || typeof args.shape !== 'string' || args.shape.trim() === '') {
    return createErrorResponse('shape is required', [
      'Provide a valid shape type (e.g. "rectangle", "circle", "capsule", "box", "sphere", "cylinder")',
    ]);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
    nodePath: args.nodePath,
    shape: args.shape,
  };

  if (args.dimension !== undefined) params.dimension = args.dimension;
  if (args.width !== undefined) params.width = args.width;
  if (args.height !== undefined) params.height = args.height;
  if (args.depth !== undefined) params.depth = args.depth;
  if (args.radius !== undefined) params.radius = args.radius;
  if (args.ax !== undefined) params.ax = args.ax;
  if (args.ay !== undefined) params.ay = args.ay;
  if (args.bx !== undefined) params.bx = args.bx;
  if (args.by !== undefined) params.by = args.by;
  if (args.points !== undefined) params.points = args.points;
  if (args.disabled !== undefined) params.disabled = args.disabled;
  if (args.oneWayCollision !== undefined) params.oneWayCollision = args.oneWayCollision;

  return executeSceneOp(
    runner,
    'setup_collision',
    params,
    v.projectPath,
    'Failed to setup collision',
    ['Check that the node exists, is a PhysicsBody or Area, and parameter values are correct'],
  );
}

export async function handleAddMeshInstance(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.meshType && !args.meshFile) {
    return createErrorResponse('Either meshType or meshFile is required', [
      'Provide a meshType primitive name (e.g. "CubeMesh", "SphereMesh") or a meshFile path (e.g. "assets/models/character.glb")',
    ]);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
  };

  if (args.parentPath !== undefined) params.parentPath = args.parentPath;
  if (args.name !== undefined) params.name = args.name;
  if (args.meshType !== undefined) params.meshType = args.meshType;
  if (args.meshFile !== undefined) params.meshFile = args.meshFile;
  if (args.meshProperties !== undefined) params.meshProperties = args.meshProperties;
  if (args.position !== undefined) params.position = args.position;
  if (args.rotation !== undefined) params.rotation = args.rotation;
  if (args.scale !== undefined) params.scale = args.scale;

  return executeSceneOp(
    runner,
    'add_mesh_instance',
    params,
    v.projectPath,
    'Failed to add MeshInstance',
    ['Check that the parent node exists and is a Spatial, and parameter values are correct'],
  );
}

export async function handleSetPhysicsLayers(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePath || !validateNodePath(args.nodePath as string)) {
    return createErrorResponse('Valid nodePath is required', ['Provide the target node path (e.g. "root/Player")']);
  }
  if (args.collisionLayer === undefined && args.collisionMask === undefined) {
    return createErrorResponse('collisionLayer and/or collisionMask are required', [
      'Provide at least one collision layer or mask to set',
    ]);
  }
  if (args.collisionLayer !== undefined) {
    if (typeof args.collisionLayer !== 'number' && !Array.isArray(args.collisionLayer)) {
      return createErrorResponse('Invalid collisionLayer', [
        'collisionLayer must be a number or an array of numbers',
      ]);
    }
  }
  if (args.collisionMask !== undefined) {
    if (typeof args.collisionMask !== 'number' && !Array.isArray(args.collisionMask)) {
      return createErrorResponse('Invalid collisionMask', [
        'collisionMask must be a number or an array of numbers',
      ]);
    }
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
    nodePath: args.nodePath,
  };
  if (args.collisionLayer !== undefined) params.collisionLayer = args.collisionLayer;
  if (args.collisionMask !== undefined) params.collisionMask = args.collisionMask;

  return executeSceneOp(
    runner,
    'set_physics_layers',
    params,
    v.projectPath,
    'Failed to set physics layers',
    ['Check that the node exists and is a collision object or area'],
  );
}

export async function handleGetPhysicsLayers(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePath || !validateNodePath(args.nodePath as string)) {
    return createErrorResponse('Valid nodePath is required', ['Provide the target node path (e.g. "root/Player")']);
  }

  const params = {
    scenePath: args.scenePath,
    nodePath: args.nodePath,
  };

  return executeSceneOp(
    runner,
    'get_physics_layers',
    params,
    v.projectPath,
    'Failed to get physics layers',
    ['Check that the node exists and has collision properties'],
  );
}

export async function handleAddRaycast(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (args.parentPath && !validateNodePath(args.parentPath as string)) {
    return createErrorResponse('Invalid parentPath', [
      'Provide a scene-tree path without ".." (e.g. "root/Spatial")',
    ]);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
  };

  if (args.parentPath !== undefined) params.parentPath = args.parentPath;
  if (args.name !== undefined) params.name = args.name;
  if (args.dimension !== undefined) params.dimension = args.dimension;
  if (args.enabled !== undefined) params.enabled = args.enabled;
  if (args.collisionMask !== undefined) params.collisionMask = args.collisionMask;
  if (args.collideWithAreas !== undefined) params.collideWithAreas = args.collideWithAreas;
  if (args.collideWithBodies !== undefined) params.collideWithBodies = args.collideWithBodies;
  if (args.targetX !== undefined) params.targetX = args.targetX;
  if (args.targetY !== undefined) params.targetY = args.targetY;
  if (args.targetZ !== undefined) params.targetZ = args.targetZ;

  return executeSceneOp(
    runner,
    'add_raycast',
    params,
    v.projectPath,
    'Failed to add RayCast',
    ['Check that the parent node exists and parameters are valid'],
  );
}

export async function handleSetupCamera(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (args.parentPath && !validateNodePath(args.parentPath as string)) {
    return createErrorResponse('Invalid parentPath', [
      'Provide a scene-tree path without ".." (e.g. "root/Spatial")',
    ]);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
  };

  if (args.parentPath !== undefined) params.parentPath = args.parentPath;
  if (args.name !== undefined) params.name = args.name;
  if (args.dimension !== undefined) params.dimension = args.dimension;
  if (args.current !== undefined) params.current = args.current;
  if (args.zoom !== undefined) params.zoom = args.zoom;
  if (args.fov !== undefined) params.fov = args.fov;
  if (args.near !== undefined) params.near = args.near;
  if (args.far !== undefined) params.far = args.far;
  if (args.position !== undefined) params.position = args.position;
  if (args.rotation !== undefined) params.rotation = args.rotation;
  if (args.lookAt !== undefined) params.lookAt = args.lookAt;

  return executeSceneOp(
    runner,
    'setup_camera',
    params,
    v.projectPath,
    'Failed to setup Camera',
    ['Check parent node and that camera properties are valid'],
  );
}

export async function handleSetupLighting(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (args.parentPath && !validateNodePath(args.parentPath as string)) {
    return createErrorResponse('Invalid parentPath', [
      'Provide a scene-tree path without ".." (e.g. "root/Spatial")',
    ]);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
  };

  if (args.parentPath !== undefined) params.parentPath = args.parentPath;
  if (args.name !== undefined) params.name = args.name;
  if (args.lightType !== undefined) params.lightType = args.lightType;
  if (args.preset !== undefined) params.preset = args.preset;
  if (args.color !== undefined) params.color = args.color;
  if (args.energy !== undefined) params.energy = args.energy;
  if (args.shadows !== undefined) params.shadows = args.shadows;
  if (args.range !== undefined) params.range = args.range;
  if (args.attenuation !== undefined) params.attenuation = args.attenuation;
  if (args.spotAngle !== undefined) params.spotAngle = args.spotAngle;
  if (args.spotAngleAttenuation !== undefined) params.spotAngleAttenuation = args.spotAngleAttenuation;
  if (args.position !== undefined) params.position = args.position;
  if (args.rotation !== undefined) params.rotation = args.rotation;

  return executeSceneOp(
    runner,
    'setup_lighting',
    params,
    v.projectPath,
    'Failed to setup Lighting',
    ['Ensure parent node is a Spatial (3D) and light parameters are valid'],
  );
}

export async function handleSetupEnvironment(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (args.parentPath && !validateNodePath(args.parentPath as string)) {
    return createErrorResponse('Invalid parentPath', [
      'Provide a scene-tree path without ".." (e.g. "root/Spatial")',
    ]);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
  };

  if (args.parentPath !== undefined) params.parentPath = args.parentPath;
  if (args.name !== undefined) params.name = args.name;
  if (args.ambientMode !== undefined) params.ambientMode = args.ambientMode;
  if (args.ambientColor !== undefined) params.ambientColor = args.ambientColor;
  if (args.ambientEnergy !== undefined) params.ambientEnergy = args.ambientEnergy;
  if (args.skyType !== undefined) params.skyType = args.skyType;
  if (args.skyTopColor !== undefined) params.skyTopColor = args.skyTopColor;
  if (args.skyHorizonColor !== undefined) params.skyHorizonColor = args.skyHorizonColor;
  if (args.groundBottomColor !== undefined) params.groundBottomColor = args.groundBottomColor;
  if (args.groundHorizonColor !== undefined) params.groundHorizonColor = args.groundHorizonColor;
  if (args.glowEnabled !== undefined) params.glowEnabled = args.glowEnabled;
  if (args.ssaoEnabled !== undefined) params.ssaoEnabled = args.ssaoEnabled;
  if (args.ssrEnabled !== undefined) params.ssrEnabled = args.ssrEnabled;
  if (args.fogEnabled !== undefined) params.fogEnabled = args.fogEnabled;

  return executeSceneOp(
    runner,
    'setup_environment',
    params,
    v.projectPath,
    'Failed to setup Environment',
    ['Check that parent node exists and environment parameters are valid'],
  );
}

export async function handleSetupNavigation3D(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (args.parentPath && !validateNodePath(args.parentPath as string)) {
    return createErrorResponse('Invalid parentPath', [
      'Provide a scene-tree path without ".." (e.g. "root/Spatial")',
    ]);
  }
  if (args.agentParentPath && !validateNodePath(args.agentParentPath as string)) {
    return createErrorResponse('Invalid agentParentPath', [
      'Provide a scene-tree path without ".." (e.g. "root/Player")',
    ]);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
  };

  if (args.parentPath !== undefined) params.parentPath = args.parentPath;
  if (args.navigationName !== undefined) params.navigationName = args.navigationName;
  if (args.name !== undefined) params.name = args.name;
  if (args.cellSize !== undefined) params.cellSize = args.cellSize;
  if (args.cellHeight !== undefined) params.cellHeight = args.cellHeight;
  if (args.agentHeight !== undefined) params.agentHeight = args.agentHeight;
  if (args.agentRadius !== undefined) params.agentRadius = args.agentRadius;
  if (args.agentMaxClimb !== undefined) params.agentMaxClimb = args.agentMaxClimb;
  if (args.agentMaxSlope !== undefined) params.agentMaxSlope = args.agentMaxSlope;
  if (args.setupAgent !== undefined) params.setupAgent = args.setupAgent;
  if (args.agentParentPath !== undefined) params.agentParentPath = args.agentParentPath;
  if (args.agentName !== undefined) params.agentName = args.agentName;

  return executeSceneOp(
    runner,
    'setup_navigation_3d',
    params,
    v.projectPath,
    'Failed to setup Navigation 3D',
    ['Check that parent node exists and parameters are valid'],
  );
}

export async function handleCreateParticles3D(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (args.parentPath && !validateNodePath(args.parentPath as string)) {
    return createErrorResponse('Invalid parentPath', [
      'Provide a scene-tree path without ".." (e.g. "root/Spatial")',
    ]);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
  };

  if (args.parentPath !== undefined) params.parentPath = args.parentPath;
  if (args.name !== undefined) params.name = args.name;
  if (args.preset !== undefined) params.preset = args.preset;
  if (args.amount !== undefined) params.amount = args.amount;
  if (args.lifetime !== undefined) params.lifetime = args.lifetime;
  if (args.explosiveness !== undefined) params.explosiveness = args.explosiveness;
  if (args.direction !== undefined) params.direction = args.direction;
  if (args.spread !== undefined) params.spread = args.spread;
  if (args.gravity !== undefined) params.gravity = args.gravity;
  if (args.initialVelocity !== undefined) params.initialVelocity = args.initialVelocity;
  if (args.position !== undefined) params.position = args.position;

  return executeSceneOp(
    runner,
    'create_particles_3d',
    params,
    v.projectPath,
    'Failed to create CPUParticles 3D',
    ['Ensure parent node is a Spatial (3D) and preset or properties are valid'],
  );
}

export async function handleSetupAnimationTree(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (args.parentPath && !validateNodePath(args.parentPath as string)) {
    return createErrorResponse('Invalid parentPath', [
      'Provide a scene-tree path without ".." (e.g. "root/Player")',
    ]);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
  };

  if (args.parentPath !== undefined) params.parentPath = args.parentPath;
  if (args.name !== undefined) params.name = args.name;
  if (args.animPlayerPath !== undefined) params.animPlayerPath = args.animPlayerPath;
  if (args.states !== undefined) params.states = args.states;
  if (args.transitions !== undefined) params.transitions = args.transitions;
  if (args.active !== undefined) params.active = args.active;

  return executeSceneOp(
    runner,
    'setup_animation_tree',
    params,
    v.projectPath,
    'Failed to setup AnimationTree',
    ['Check that parent node exists and parameters are valid'],
  );
}

export async function handleSetupCollision3D(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePath || !validateNodePath(args.nodePath as string)) {
    return createErrorResponse('Valid nodePath is required', [
      'Provide the target MeshInstance node path (e.g. "root/MeshInstance")',
    ]);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
    nodePath: args.nodePath,
  };

  if (args.collisionType !== undefined) params.collisionType = args.collisionType;

  return executeSceneOp(
    runner,
    'setup_collision_3d',
    params,
    v.projectPath,
    'Failed to setup Collision 3D',
    ['Ensure the node exists, is a MeshInstance, and has a mesh resource assigned'],
  );
}

export async function handleSetupJoint3D(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (args.parentPath && !validateNodePath(args.parentPath as string)) {
    return createErrorResponse('Invalid parentPath', [
      'Provide a scene-tree path without ".." (e.g. "root/Spatial")',
    ]);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
  };

  if (args.parentPath !== undefined) params.parentPath = args.parentPath;
  if (args.jointType !== undefined) params.jointType = args.jointType;
  if (args.name !== undefined) params.name = args.name;
  if (args.nodeA !== undefined) params.nodeA = args.nodeA;
  if (args.nodeB !== undefined) params.nodeB = args.nodeB;
  if (args.position !== undefined) params.position = args.position;
  if (args.rotation !== undefined) params.rotation = args.rotation;

  return executeSceneOp(
    runner,
    'setup_joint_3d',
    params,
    v.projectPath,
    'Failed to setup Joint 3D',
    ['Ensure parent node is a Spatial and node paths A/B refer to valid physics bodies'],
  );
}

export async function handleGenerateGuiHierarchy(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (args.parentPath && !validateNodePath(args.parentPath as string)) {
    return createErrorResponse('Invalid parentPath', [
      'Provide a scene-tree path without ".." (e.g. "root/CanvasLayer")',
    ]);
  }

  if (!args.hierarchy || typeof args.hierarchy !== 'object') {
    return createErrorResponse('Valid hierarchy object is required', [
      'Provide a recursive dictionary describing the GUI tree layout',
    ]);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
    hierarchy: args.hierarchy,
  };

  if (args.parentPath !== undefined) params.parentPath = args.parentPath;

  return executeSceneOp(
    runner,
    'generate_gui_hierarchy',
    params,
    v.projectPath,
    'Failed to generate GUI hierarchy',
    ['Check that parent node exists and GUI hierarchy description is correct'],
  );
}


