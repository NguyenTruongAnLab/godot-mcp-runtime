import type { GodotRunner, OperationParams, ToolDefinition } from '../utils/godot-runner.js';
import {
  normalizeParameters,
  createErrorResponse,
  validateSceneArgs,
  validateNodePath,
} from '../utils/godot-runner.js';
import { executeSceneOp } from '../utils/handler-helpers.js';

export const tilemapToolDefinitions: ToolDefinition[] = [
  {
    name: 'set_tilemap_cell',
    description:
      'Set a specific cell in a TileMap node. Saves automatically. Can place a tile by its ID or clear it by passing -1. Supports mirroring (flipX, flipY) and transpose. Returns a plain-text confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        nodePath: {
          type: 'string',
          description: 'Path to the target TileMap node from scene root (e.g. "root/TileMap")',
        },
        x: { type: 'integer', description: 'The X coordinate of the cell' },
        y: { type: 'integer', description: 'The Y coordinate of the cell' },
        tileId: { type: 'integer', description: 'The tile ID to assign. Use -1 to clear the cell.' },
        flipX: { type: 'boolean', description: 'Whether to flip the tile horizontally' },
        flipY: { type: 'boolean', description: 'Whether to flip the tile vertically' },
        transpose: { type: 'boolean', description: 'Whether to transpose the tile (rotate 90 deg and flip)' },
      },
      required: ['projectPath', 'scenePath', 'nodePath', 'x', 'y', 'tileId'],
    },
  },
  {
    name: 'set_gridmap_cell',
    description:
      'Set a specific cell or multiple cells in a GridMap node (3D). Saves automatically. Can place an item by its ID or clear it by passing -1. Supports setting cell orientation. Returns a plain-text confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: {
          type: 'string',
          description: 'Scene file path relative to the project (e.g. "scenes/level.tscn")',
        },
        nodePath: {
          type: 'string',
          description: 'Path to the target GridMap node from scene root (e.g. "root/GridMap")',
        },
        x: { type: 'integer', description: 'The X coordinate of the cell' },
        y: { type: 'integer', description: 'The Y coordinate of the cell' },
        z: { type: 'integer', description: 'The Z coordinate of the cell' },
        item: { type: 'integer', description: 'The item ID to assign. Use -1 to clear the cell.' },
        orientation: { type: 'integer', description: 'Optional orientation index (0-23) for rotation' },
        cells: {
          type: 'array',
          description: 'Optional array of cell operations for batch execution. Each cell should contain x, y, z, item, and optional orientation.',
          items: {
            type: 'object',
            properties: {
              x: { type: 'integer' },
              y: { type: 'integer' },
              z: { type: 'integer' },
              item: { type: 'integer', description: 'Item ID to place (-1 to clear)' },
              orientation: { type: 'integer', description: 'Optional orientation index (0-23)' },
            },
            required: ['x', 'y', 'z', 'item'],
          },
        },
      },
      required: ['projectPath', 'scenePath', 'nodePath'],
    },
  },
];

export async function handleSetTilemapCell(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePath || !validateNodePath(args.nodePath as string)) {
    return createErrorResponse('Valid nodePath is required', ['Provide the target node path']);
  }
  if (args.x === undefined || typeof args.x !== 'number') {
    return createErrorResponse('Valid x coordinate is required', ['Provide x coordinate as integer']);
  }
  if (args.y === undefined || typeof args.y !== 'number') {
    return createErrorResponse('Valid y coordinate is required', ['Provide y coordinate as integer']);
  }
  if (args.tileId === undefined || typeof args.tileId !== 'number') {
    return createErrorResponse('Valid tileId is required', ['Provide tileId as integer']);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
    nodePath: args.nodePath,
    x: args.x,
    y: args.y,
    tileId: args.tileId,
  };
  if (args.flipX !== undefined) params.flipX = args.flipX;
  if (args.flipY !== undefined) params.flipY = args.flipY;
  if (args.transpose !== undefined) params.transpose = args.transpose;

  return executeSceneOp(
    runner,
    'set_tilemap_cell',
    params,
    v.projectPath,
    'Failed to set TileMap cell',
    ['Check that the node exists and is a TileMap', 'Verify tileId is valid in the TileSet'],
  );
}

export async function handleSetGridmapCell(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.nodePath || !validateNodePath(args.nodePath as string)) {
    return createErrorResponse('Valid nodePath is required', ['Provide the target node path']);
  }

  if (!args.cells) {
    if (args.x === undefined || typeof args.x !== 'number') {
      return createErrorResponse('Valid x coordinate is required', ['Provide x coordinate as integer or supply cells array']);
    }
    if (args.y === undefined || typeof args.y !== 'number') {
      return createErrorResponse('Valid y coordinate is required', ['Provide y coordinate as integer or supply cells array']);
    }
    if (args.z === undefined || typeof args.z !== 'number') {
      return createErrorResponse('Valid z coordinate is required', ['Provide z coordinate as integer or supply cells array']);
    }
    if (args.item === undefined || typeof args.item !== 'number') {
      return createErrorResponse('Valid item ID is required', ['Provide item as integer or supply cells array']);
    }
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
    nodePath: args.nodePath,
  };

  if (args.cells !== undefined) {
    if (!Array.isArray(args.cells)) {
      return createErrorResponse('cells must be an array of objects', ['Provide cells as a valid array']);
    }
    params.cells = args.cells;
  } else {
    params.x = args.x;
    params.y = args.y;
    params.z = args.z;
    params.item = args.item;
    if (args.orientation !== undefined) params.orientation = args.orientation;
  }

  return executeSceneOp(
    runner,
    'set_gridmap_cell',
    params,
    v.projectPath,
    'Failed to set GridMap cell',
    ['Check that the node exists and is a GridMap', 'Verify item ID is valid in the MeshLibrary'],
  );
}

