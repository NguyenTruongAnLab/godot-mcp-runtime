import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import type {
  GodotRunner,
  OperationParams,
  ToolDefinition,
  ToolResponse,
} from '../utils/godot-runner.js';
import {
  normalizeParameters,
  validateProjectArgs,
  validateSubPath,
  createErrorResponse,
  getErrorMessage,
  validateSceneArgs,
} from '../utils/godot-runner.js';
import { executeSceneOp } from '../utils/handler-helpers.js';

// --- Tool definitions ---

export const resourceToolDefinitions: ToolDefinition[] = [
  {
    name: 'create_tres_resource',
    description:
      'Headlessly serialize a Godot 3.x compatible .tres resource file (e.g. StyleBoxFlat or SpatialMaterial) on disk with precise custom properties. No running Godot process required. Returns plain-text confirmation on success.',
    annotations: { idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        resourcePath: {
          type: 'string',
          description:
            'Destination path inside the project root (e.g. "shiny_material.tres" or "res://ui_panel.tres")',
        },
        type: {
          type: 'string',
          enum: ['StyleBoxFlat', 'SpatialMaterial'],
          description: 'Type of the Godot resource to create',
        },
        properties: {
          type: 'object',
          description: 'Key-value pairs of properties to define on the resource',
        },
      },
      required: ['projectPath', 'resourcePath', 'type', 'properties'],
    },
  },
  {
    name: 'apply_spatial_material',
    description:
      'Assign a material resource (.tres) or configure material override on a MeshInstance inside a scene (.tscn) file using a headless Godot operation. Saves the scene automatically. Returns plain-text confirmation on success.',
    annotations: { idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: {
          type: 'string',
          description: 'Scene file path relative to the project root (e.g. "scenes/level.tscn")',
        },
        nodePath: {
          type: 'string',
          description: 'Scene-tree path to the MeshInstance node (e.g. "root/Player/MeshInstance")',
        },
        materialPath: {
          type: 'string',
          description:
            'Path to the material resource file relative to the project root or as res:// (e.g. "shiny.tres")',
        },
        surfaceIndex: {
          type: 'number',
          description:
            'Optional surface index to assign the material to. If not provided or -1, assigns as material_override.',
        },
      },
      required: ['projectPath', 'scenePath', 'nodePath', 'materialPath'],
    },
  },
];

// --- Helpers ---

function resolveResourcePath(projectPath: string, resourcePath: string): string {
  const rel = resourcePath.startsWith('res://') ? resourcePath.slice(6) : resourcePath;
  return join(projectPath, rel);
}

function serializePropertyValue(val: any): string {
  if (typeof val === 'boolean') {
    return val ? 'true' : 'false';
  }
  if (typeof val === 'number') {
    return val.toString();
  }
  if (typeof val === 'string') {
    // If it is already a serialized Godot constructor (e.g. Color(..), Vector2(..)) or reference, write raw
    if (
      /^(ExtResource|SubResource|Vector2|Vector3|Color|Rect2|PoolColorArray|PoolVector3Array|PoolRealArray|PoolIntArray|PoolStringArray|PoolVector2Array|PoolByteArray)\(.*\)$/.test(
        val,
      )
    ) {
      return val;
    }
    return JSON.stringify(val);
  }
  if (typeof val === 'object' && val !== null) {
    if ('r' in val && 'g' in val && 'b' in val) {
      const a = 'a' in val ? val.a : 1.0;
      return `Color( ${val.r}, ${val.g}, ${val.b}, ${a} )`;
    }
    if ('x' in val && 'y' in val && 'z' in val) {
      return `Vector3( ${val.x}, ${val.y}, ${val.z} )`;
    }
    if ('x' in val && 'y' in val) {
      return `Vector2( ${val.x}, ${val.y} )`;
    }
    if (Array.isArray(val)) {
      return `[ ${val.map(serializePropertyValue).join(', ')} ]`;
    }
  }
  return String(val);
}

// --- Handlers ---

export async function handleCreateTresResource(
  _runner: any,
  args: OperationParams,
): Promise<ToolResponse> {
  args = normalizeParameters(args);
  const v = validateProjectArgs(args);
  if ('isError' in v) return v;

  if (!args.resourcePath || typeof args.resourcePath !== 'string') {
    return createErrorResponse('resourcePath is required', ['Provide a resource destination path']);
  }
  if (!validateSubPath(v.projectPath, args.resourcePath)) {
    return createErrorResponse('Invalid resourcePath', [
      'Path must reside within the project root',
    ]);
  }
  if (
    !args.type ||
    typeof args.type !== 'string' ||
    !['StyleBoxFlat', 'SpatialMaterial'].includes(args.type)
  ) {
    return createErrorResponse('Valid type is required', [
      'Type must be StyleBoxFlat or SpatialMaterial',
    ]);
  }
  if (!args.properties || typeof args.properties !== 'object') {
    return createErrorResponse('properties object is required', [
      'Provide key-value pairs for resource fields',
    ]);
  }

  try {
    const fsPath = resolveResourcePath(v.projectPath, args.resourcePath);
    const lines: string[] = [];

    lines.push(`[gd_resource type="${args.type}" format=2]`);
    lines.push('');
    lines.push('[resource]');

    const propsObj = args.properties as Record<string, unknown>;
    for (const key of Object.keys(propsObj).sort()) {
      const val = propsObj[key];
      const serialized = serializePropertyValue(val);
      lines.push(`${key} = ${serialized}`);
    }
    lines.push(''); // Trailing newline

    writeFileSync(fsPath, lines.join('\n'), 'utf8');

    return {
      content: [
        {
          type: 'text',
          text: `Successfully created ${args.type} resource at ${args.resourcePath}`,
        },
      ],
    };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to create tres resource: ${getErrorMessage(error)}`);
  }
}

export async function handleApplySpatialMaterial(
  runner: GodotRunner,
  args: OperationParams,
): Promise<ToolResponse> {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePath || typeof args.nodePath !== 'string') {
    return createErrorResponse('nodePath is required', ['Provide the path to the MeshInstance']);
  }
  if (!args.materialPath || typeof args.materialPath !== 'string') {
    return createErrorResponse('materialPath is required', [
      'Provide the path to the material resource',
    ]);
  }

  const matFullPath = resolveResourcePath(v.projectPath, args.materialPath);
  if (!existsSync(matFullPath)) {
    return createErrorResponse(`Material file does not exist: ${args.materialPath}`, [
      'Create the material resource file first using create_tres_resource',
    ]);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
    nodePath: args.nodePath,
    materialPath: args.materialPath,
  };
  if (typeof args.surfaceIndex === 'number') {
    params.surfaceIndex = args.surfaceIndex;
  }

  return executeSceneOp(
    runner,
    'apply_spatial_material',
    params,
    v.projectPath,
    'Failed to apply spatial material',
    ['Ensure the node is a MeshInstance', 'Verify scene and material paths'],
  );
}
