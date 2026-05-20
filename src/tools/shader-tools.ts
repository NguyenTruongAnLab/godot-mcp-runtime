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
  validateNodePath,
} from '../utils/godot-runner.js';
import { executeSceneOp } from '../utils/handler-helpers.js';

export const shaderToolDefinitions: ToolDefinition[] = [
  {
    name: 'create_shader_resource',
    description:
      'Create a Godot 3.x compatible custom shader (.shader) file on disk. No running Godot process required. Returns plain-text confirmation on success.',
    annotations: { idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        shaderPath: {
          type: 'string',
          description:
            'Destination path for the shader file relative to the project root (e.g. "shaders/neon.shader")',
        },
        shaderType: {
          type: 'string',
          enum: ['spatial', 'canvas_item', 'particles'],
          description: 'The type of shader (defaults to spatial)',
        },
        shaderCode: {
          type: 'string',
          description:
            'Complete custom GLSL shader code block. If not provided, a default template is written.',
        },
      },
      required: ['projectPath', 'shaderPath'],
    },
  },
  {
    name: 'apply_shader_material',
    description:
      'Assign a custom shader to a ShaderMaterial on a scene node using a headless Godot operation. Sets custom shader parameters. Saves the scene automatically. Returns plain-text confirmation on success.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project root' },
        nodePath: {
          type: 'string',
          description: 'Scene-tree path to the target node (e.g. "root/Player/MeshInstance")',
        },
        shaderPath: {
          type: 'string',
          description: 'Path to the shader resource file relative to the project root or res://',
        },
        shaderParams: {
          type: 'object',
          description:
            'Optional uniform parameters to configure on the ShaderMaterial (e.g., {"color_tint": {"r":1,"g":0,"b":0}, "speed": 2.5})',
        },
      },
      required: ['projectPath', 'scenePath', 'nodePath', 'shaderPath'],
    },
  },
];

export async function handleCreateShaderResource(
  _runner: any,
  args: OperationParams,
): Promise<ToolResponse> {
  args = normalizeParameters(args);
  const v = validateProjectArgs(args);
  if ('isError' in v) return v;

  if (!args.shaderPath || typeof args.shaderPath !== 'string') {
    return createErrorResponse('shaderPath is required', ['Provide a shader destination path']);
  }
  if (!validateSubPath(v.projectPath, args.shaderPath)) {
    return createErrorResponse('Invalid shaderPath', ['Path must reside within the project root']);
  }

  const shaderType = args.shaderType || 'spatial';
  let shaderCode = args.shaderCode as string;

  if (!shaderCode) {
    shaderCode = `shader_type ${shaderType};

// Keep uniforms easy to manipulate programmatically
uniform vec4 albedo : hint_color = vec4(1.0);
uniform float metallic : hint_range(0.0, 1.0) = 0.0;
uniform float roughness : hint_range(0.0, 1.0) = 1.0;

void fragment() {
	ALBEDO = albedo.rgb;
	METALLIC = metallic;
	ROUGHNESS = roughness;
}
`;
  }

  try {
    const fsPath = join(v.projectPath, args.shaderPath);
    writeFileSync(fsPath, shaderCode, 'utf8');

    return {
      content: [
        {
          type: 'text',
          text: `Successfully created custom shader file at ${args.shaderPath}`,
        },
      ],
    };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to create shader file: ${getErrorMessage(error)}`);
  }
}

export async function handleApplyShaderMaterial(
  runner: GodotRunner,
  args: OperationParams,
): Promise<ToolResponse> {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePath || typeof args.nodePath !== 'string' || !validateNodePath(args.nodePath)) {
    return createErrorResponse('Valid nodePath is required', ['Provide target node path']);
  }
  if (!args.shaderPath || typeof args.shaderPath !== 'string') {
    return createErrorResponse('shaderPath is required', ['Provide a valid shader path']);
  }

  const rel = (args.shaderPath as string).startsWith('res://')
    ? (args.shaderPath as string).slice(6)
    : (args.shaderPath as string);
  const shaderFullPath = join(v.projectPath, rel);
  if (!existsSync(shaderFullPath)) {
    return createErrorResponse(`Shader file does not exist: ${args.shaderPath}`, [
      'Create the shader resource file first using create_shader_resource',
    ]);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
    nodePath: args.nodePath,
    shaderPath: args.shaderPath,
  };
  if (args.shaderParams !== undefined) {
    params.shaderParams = args.shaderParams;
  }

  return executeSceneOp(
    runner,
    'apply_shader_material',
    params,
    v.projectPath,
    'Failed to apply shader material',
    ['Ensure the node exists and is compatible with materials', 'Verify scene and shader paths'],
  );
}
