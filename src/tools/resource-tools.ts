import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { GodotRunner, OperationParams, ToolDefinition, ToolResponse } from '../utils/godot-runner.js';
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
          description: 'Destination path inside the project root (e.g. "shiny_material.tres" or "res://ui_panel.tres")',
        },
        type: {
          type: 'string',
          enum: ['StyleBoxFlat', 'SpatialMaterial', 'Environment', 'DynamicFont', 'Theme', 'GradientTexture', 'Curve', 'ProceduralSky'],
          description: 'Type of the Godot resource to create. Supports: StyleBoxFlat, SpatialMaterial, Environment, DynamicFont, Theme, GradientTexture, Curve, ProceduralSky.',
        },
        properties: {
          type: 'object',
          description: 'Key-value pairs of properties to define on the resource',
        },
      },
      required: ['projectPath', 'resourcePath', 'type'],
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
          description: 'Path to the material resource file relative to the project root or as res:// (e.g. "shiny.tres")',
        },
        surfaceIndex: {
          type: 'number',
          description: 'Optional surface index to assign the material to. If not provided or -1, assigns as material_override.',
        },
      },
      required: ['projectPath', 'scenePath', 'nodePath', 'materialPath'],
    },
  },
  {
    name: 'compile_material_tree',
    description:
      'Headlessly compile a high-fidelity SpatialMaterial or ShaderMaterial .tres resource file on disk, automatically mapping diffuse/normal/roughness textures to ExtResource references and generating embedded custom shader SubResources if needed. No running Godot process required. Returns plain-text confirmation on success.',
    annotations: { idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        materialPath: {
          type: 'string',
          description: 'Destination path of .tres file relative to project root (e.g. "materials/shiny.tres" or "res://shiny.tres")',
        },
        type: {
          type: 'string',
          enum: ['SpatialMaterial', 'ShaderMaterial'],
          description: 'Material resource type: SpatialMaterial or ShaderMaterial (default: SpatialMaterial)',
        },
        shaderPath: {
          type: 'string',
          description: '[ShaderMaterial only] Path to the custom shader resource file (.shader) relative to project root',
        },
        shaderCode: {
          type: 'string',
          description: '[ShaderMaterial only] Inline custom shader code to embed as a SubResource',
        },
        textures: {
          type: 'object',
          description: 'Mapping of texture uniform/parameter name to texture file paths relative to project root',
        },
        parameters: {
          type: 'object',
          description: 'Key-value pairs of floats, Colors, or Vector2/3 properties to configure on the material',
        },
      },
      required: ['projectPath', 'materialPath'],
    },
  },
  {
    name: 'set_spatial_material',
    description:
      'Directly create or configure properties on a SpatialMaterial on a MeshInstance inside a scene (.tscn) file headlessly. Automatically instantiates a SpatialMaterial if not already present, supports albedo, roughness, metallic, normal maps, transparency, and cull modes. Saves automatically. Returns confirmation.',
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
        surfaceIndex: {
          type: 'number',
          description: 'Optional surface index to assign or configure the material on. If not provided or -1, configures material_override.',
        },
        albedoColor: {
          type: 'string',
          description: 'Optional hex code or constructor string or RGBA color (e.g., "#FF0000" or "Color(1, 0, 0, 1)")',
        },
        albedoTexture: {
          type: 'string',
          description: 'Optional texture resource path relative to project (e.g., "textures/albedo.png" or "res://textures/albedo.png")',
        },
        metallic: {
          type: 'number',
          description: 'Metallic factor value (0.0 to 1.0)',
        },
        roughness: {
          type: 'number',
          description: 'Roughness factor value (0.0 to 1.0)',
        },
        metallicTexture: {
          type: 'string',
          description: 'Optional metallic texture path (e.g. "res://textures/metal.png")',
        },
        roughnessTexture: {
          type: 'string',
          description: 'Optional roughness texture path (e.g. "res://textures/rough.png")',
        },
        normalEnabled: {
          type: 'boolean',
          description: 'Enable or disable normal mapping',
        },
        normalTexture: {
          type: 'string',
          description: 'Optional normal map texture path (e.g. "res://textures/normal.png")',
        },
        normalScale: {
          type: 'number',
          description: 'Normal map strength scale (default: 1.0)',
        },
        transparency: {
          type: 'boolean',
          description: 'Whether the material uses alpha transparency',
        },
        cullMode: {
          type: 'string',
          enum: ['back', 'front', 'disabled', 'none'],
          description: 'Cull mode to apply: back, front, disabled (none)',
        },
      },
      required: ['projectPath', 'scenePath', 'nodePath'],
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
        val
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

const SUPPORTED_TYPES = ['StyleBoxFlat', 'SpatialMaterial', 'Environment', 'DynamicFont', 'Theme', 'GradientTexture', 'Curve', 'ProceduralSky'];

export async function handleCreateTresResource(_runner: any, args: OperationParams): Promise<ToolResponse> {
  args = normalizeParameters(args);
  const v = validateProjectArgs(args);
  if ('isError' in v) return v;

  if (!args.resourcePath || typeof args.resourcePath !== 'string') {
    return createErrorResponse('resourcePath is required', ['Provide a resource destination path']);
  }
  if (!validateSubPath(v.projectPath, args.resourcePath)) {
    return createErrorResponse('Invalid resourcePath', ['Path must reside within the project root']);
  }
  if (!args.type || typeof args.type !== 'string' || !SUPPORTED_TYPES.includes(args.type)) {
    return createErrorResponse('Valid type is required', [
      `Type must be one of: ${SUPPORTED_TYPES.join(', ')}`,
    ]);
  }
  const propsObj = (args.properties && typeof args.properties === 'object')
    ? args.properties as Record<string, unknown>
    : {};

  try {
    const fsPath = resolveResourcePath(v.projectPath, args.resourcePath);
    const content = generateTresContent(args.type, propsObj);
    writeFileSync(fsPath, content, 'utf8');

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

// Generate .tres content for different resource types
function generateTresContent(type: string, props: Record<string, unknown>): string {
  const lines: string[] = [];
  let subResourceCounter = 0;
  const subResources: string[] = [];

  // Check if any property value references a sub-resource type
  const subResourceTypes = ['ProceduralSky', 'SpatialMaterial', 'StyleBoxFlat'];

  function processProperties(properties: Record<string, unknown>, isSubResource = false): string[] {
    const propLines: string[] = [];
    const sortedKeys = Object.keys(properties).sort();

    for (const key of sortedKeys) {
      const val = properties[key];

      // If the value is an object with a _type field, it's an inline sub-resource
      if (typeof val === 'object' && val !== null && !Array.isArray(val) && '_type' in (val as Record<string, unknown>)) {
        const subObj = val as Record<string, unknown>;
        const subType = subObj._type as string;
        if (subResourceTypes.includes(subType) || SUPPORTED_TYPES.includes(subType)) {
          subResourceCounter++;
          const subId = subResourceCounter;
          const subProps = { ...subObj };
          delete subProps._type;

          const subPropLines: string[] = [];
          for (const sk of Object.keys(subProps).sort()) {
            subPropLines.push(`${sk} = ${serializePropertyValue(subProps[sk])}`);
          }

          subResources.push(
            `[sub_resource type="${subType}" id=${subId}]\n${subPropLines.join('\n')}`
          );

          propLines.push(`${key} = SubResource( ${subId} )`);
          continue;
        }
      }

      const serialized = serializePropertyValue(val);
      propLines.push(`${key} = ${serialized}`);
    }
    return propLines;
  }

  // Handle type-specific defaults
  const defaults = getTypeDefaults(type);
  const mergedProps = { ...defaults, ...props };
  const propLines = processProperties(mergedProps);

  // Build the load_steps value: 1 (main resource) + number of sub-resources
  const loadSteps = 1 + subResources.length;
  if (loadSteps > 1) {
    lines.push(`[gd_resource type="${type}" load_steps=${loadSteps} format=2]`);
  } else {
    lines.push(`[gd_resource type="${type}" format=2]`);
  }
  lines.push('');

  // Sub-resources go before [resource]
  for (const sr of subResources) {
    lines.push(sr);
    lines.push('');
  }

  lines.push('[resource]');
  lines.push(...propLines);
  lines.push(''); // Trailing newline

  return lines.join('\n');
}

// Sensible defaults for new resource types (avoids creating empty/broken resources)
function getTypeDefaults(type: string): Record<string, unknown> {
  switch (type) {
    case 'Environment':
      return {
        background_mode: 2,  // BG_SKY
        ambient_light_color: { r: 0.3, g: 0.3, b: 0.3, a: 1.0 },
        ambient_light_energy: 1.0,
        tonemap_mode: 1,     // Filmic
        tonemap_exposure: 1.0,
      };
    case 'DynamicFont':
      return {
        size: 16,
      };
    case 'Theme':
      return {};
    case 'GradientTexture':
      return {
        width: 256,
      };
    case 'Curve':
      return {
        min_value: 0.0,
        max_value: 1.0,
        bake_resolution: 100,
      };
    case 'ProceduralSky':
      return {
        sky_top_color: { r: 0.35, g: 0.55, b: 0.85, a: 1.0 },
        sky_horizon_color: { r: 0.65, g: 0.78, b: 0.92, a: 1.0 },
        ground_bottom_color: { r: 0.15, g: 0.12, b: 0.1, a: 1.0 },
        ground_horizon_color: { r: 0.65, g: 0.65, b: 0.62, a: 1.0 },
        sun_angle_max: 100.0,
        sun_energy: 16.0,
      };
    default:
      return {};
  }
}

export async function handleApplySpatialMaterial(runner: GodotRunner, args: OperationParams): Promise<ToolResponse> {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePath || typeof args.nodePath !== 'string') {
    return createErrorResponse('nodePath is required', ['Provide the path to the MeshInstance']);
  }
  if (!args.materialPath || typeof args.materialPath !== 'string') {
    return createErrorResponse('materialPath is required', ['Provide the path to the material resource']);
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
    ['Ensure the node is a MeshInstance', 'Verify scene and material paths']
  );
}

export async function handleCompileMaterialTree(_runner: any, args: OperationParams): Promise<ToolResponse> {
  args = normalizeParameters(args);
  const v = validateProjectArgs(args);
  if ('isError' in v) return v;

  const matPath = args.materialPath;
  if (!matPath || typeof matPath !== 'string') {
    return createErrorResponse('materialPath is required', ['Provide a destination material file path']);
  }
  if (!validateSubPath(v.projectPath, matPath)) {
    return createErrorResponse('Invalid materialPath', ['Path must reside within the project root']);
  }

  const type = args.type || 'SpatialMaterial';
  if (type !== 'SpatialMaterial' && type !== 'ShaderMaterial') {
    return createErrorResponse('type must be SpatialMaterial or ShaderMaterial', [
      'Set type as "SpatialMaterial" or "ShaderMaterial"',
    ]);
  }

  try {
    const fsPath = resolveResourcePath(v.projectPath, matPath);
    const parentDir = dirname(fsPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    const extResources: { path: string; type: string; id: number }[] = [];
    const subResources: { code: string; type: string; id: number }[] = [];
    let nextId = 1;

    // 1. Handle Shader path
    let shaderRef = '';
    if (type === 'ShaderMaterial') {
      if (typeof args.shaderPath === 'string' && args.shaderPath.trim() !== '') {
        const sPath = args.shaderPath.startsWith('res://') ? args.shaderPath : `res://${args.shaderPath}`;
        const shaderId = nextId++;
        extResources.push({ path: sPath, type: 'Shader', id: shaderId });
        shaderRef = `ExtResource( ${shaderId} )`;
      } else if (typeof args.shaderCode === 'string' && args.shaderCode.trim() !== '') {
        const shaderId = nextId++;
        subResources.push({ code: args.shaderCode, type: 'Shader', id: shaderId });
        shaderRef = `SubResource( ${shaderId} )`;
      } else {
        return createErrorResponse('ShaderMaterial requires either shaderPath or shaderCode', [
          'Provide shaderPath: "res://shaders/my.shader"',
          'Or provide shaderCode: "shader_type spatial; ..."',
        ]);
      }
    }

    // 2. Handle Textures (ext_resources)
    const textureMap: Record<string, string> = {}; // key -> ExtResource(...)
    const texturesInput = (args.textures && typeof args.textures === 'object') ? (args.textures as Record<string, any>) : {};

    for (const key of Object.keys(texturesInput)) {
      const texVal = texturesInput[key];
      let tPath = '';
      if (typeof texVal === 'string') {
        tPath = texVal;
      } else if (texVal && typeof texVal === 'object' && typeof texVal.path === 'string') {
        tPath = texVal.path;
      }

      if (tPath) {
        if (!tPath.startsWith('res://')) {
          tPath = `res://${tPath}`;
        }
        let existing = extResources.find((r) => r.path === tPath && r.type === 'Texture');
        let tId: number;
        if (existing) {
          tId = existing.id;
        } else {
          tId = nextId++;
          extResources.push({ path: tPath, type: 'Texture', id: tId });
        }
        textureMap[key] = `ExtResource( ${tId} )`;
      }
    }

    // 3. Collect parameters and merge textures
    const finalParams: Record<string, string> = {};

    if (type === 'ShaderMaterial' && shaderRef) {
      finalParams['shader'] = shaderRef;
    }

    const paramsInput = (args.parameters && typeof args.parameters === 'object') ? (args.parameters as Record<string, any>) : {};
    
    for (const key of Object.keys(textureMap)) {
      const paramKey = type === 'ShaderMaterial' ? `shader_param/${key}` : key;
      finalParams[paramKey] = textureMap[key];
    }

    for (const key of Object.keys(paramsInput)) {
      const paramKey = type === 'ShaderMaterial' ? `shader_param/${key}` : key;
      if (finalParams[paramKey] !== undefined) {
        continue;
      }
      const rawVal = paramsInput[key];
      if (typeof rawVal === 'string' && textureMap[rawVal]) {
        finalParams[paramKey] = textureMap[rawVal];
      } else {
        finalParams[paramKey] = serializePropertyValue(rawVal);
      }
    }

    const lines: string[] = [];
    const loadSteps = 1 + extResources.length + subResources.length;

    lines.push(`[gd_resource type="${type}" load_steps=${loadSteps} format=2]`);
    lines.push('');

    for (const res of extResources) {
      lines.push(`[ext_resource path="${res.path}" type="${res.type}" id=${res.id}]`);
    }
    if (extResources.length > 0) lines.push('');

    for (const sub of subResources) {
      lines.push(`[sub_resource type="${sub.type}" id=${sub.id}]`);
      const escapedCode = sub.code.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
      lines.push(`code = "${escapedCode}"`);
      lines.push('');
    }

    lines.push('[resource]');
    const sortedKeys = Object.keys(finalParams).sort();
    for (const key of sortedKeys) {
      lines.push(`${key} = ${finalParams[key]}`);
    }
    lines.push('');

    writeFileSync(fsPath, lines.join('\n'), 'utf8');

    return {
      content: [
        {
          type: 'text',
          text: `Successfully compiled ${type} at ${args.materialPath} with ${extResources.length} texture dependencies.`,
        },
      ],
    };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to compile material tree: ${getErrorMessage(error)}`);
  }
}

export async function handleSetSpatialMaterial(runner: GodotRunner, args: OperationParams): Promise<ToolResponse> {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePath || typeof args.nodePath !== 'string') {
    return createErrorResponse('nodePath is required', ['Provide the path to the MeshInstance']);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
    nodePath: args.nodePath,
  };

  if (typeof args.surfaceIndex === 'number') params.surfaceIndex = args.surfaceIndex;
  if (args.albedoColor !== undefined) params.albedoColor = args.albedoColor;
  if (args.albedoTexture !== undefined) params.albedoTexture = args.albedoTexture;
  if (typeof args.metallic === 'number') params.metallic = args.metallic;
  if (typeof args.roughness === 'number') params.roughness = args.roughness;
  if (args.metallicTexture !== undefined) params.metallicTexture = args.metallicTexture;
  if (args.roughnessTexture !== undefined) params.roughnessTexture = args.roughnessTexture;
  if (args.normalEnabled !== undefined) params.normalEnabled = args.normalEnabled;
  if (args.normalTexture !== undefined) params.normalTexture = args.normalTexture;
  if (typeof args.normalScale === 'number') params.normalScale = args.normalScale;
  if (args.transparency !== undefined) params.transparency = args.transparency;
  if (args.cullMode !== undefined) params.cullMode = args.cullMode;

  return executeSceneOp(
    runner,
    'set_spatial_material',
    params,
    v.projectPath,
    'Failed to set spatial material',
    ['Ensure the node is a MeshInstance', 'Verify scene and properties']
  );
}
