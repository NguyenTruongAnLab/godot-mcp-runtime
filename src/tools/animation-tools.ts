import type { GodotRunner, OperationParams, ToolDefinition } from '../utils/godot-runner.js';
import {
  normalizeParameters,
  createErrorResponse,
  validateSceneArgs,
  validateNodePath,
} from '../utils/godot-runner.js';
import { executeSceneOp } from '../utils/handler-helpers.js';

export const animationToolDefinitions: ToolDefinition[] = [
  {
    name: 'configure_animation',
    description:
      'Create or completely re-configure an animation track on an AnimationPlayer node. Saves automatically. Clears any existing tracks on the specified animation, and builds a fresh set of value tracks with the specified keyframes. Values like position/translation/color auto-convert from standard JSON objects. Returns a plain-text confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        playerPath: {
          type: 'string',
          description:
            'Path to the AnimationPlayer node from scene root (e.g. "root/AnimationPlayer")',
        },
        animName: {
          type: 'string',
          description: 'Name of the animation (e.g., "walk", "idle", "jump")',
        },
        length: {
          type: 'number',
          description: 'Length of the animation in seconds (default: 1.0)',
        },
        loop: {
          type: 'boolean',
          description: 'Whether the animation should loop (default: false)',
        },
        tracks: {
          type: 'array',
          description: 'List of animation tracks to define.',
          items: {
            type: 'object',
            properties: {
              nodePath: {
                type: 'string',
                description:
                  'Path to the target node relative to the AnimationPlayer (e.g., "Sprite" or ".")',
              },
              property: {
                type: 'string',
                description:
                  'The property name to animate (e.g., "position", "rotation_degrees", "scale", "visible")',
              },
              keys: {
                type: 'array',
                description: 'Array of keyframes for this track.',
                items: {
                  type: 'object',
                  properties: {
                    time: { type: 'number', description: 'Time of the keyframe in seconds' },
                    value: {
                      description:
                        'The value at this keyframe. Can be a number, boolean, Vector2, Vector3, or Color object.',
                    },
                  },
                  required: ['time', 'value'],
                },
              },
            },
            required: ['nodePath', 'property', 'keys'],
          },
        },
      },
      required: ['projectPath', 'scenePath', 'playerPath', 'animName'],
    },
  },
];

export async function handleConfigureAnimation(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.playerPath || !validateNodePath(args.playerPath as string)) {
    return createErrorResponse('Valid playerPath is required', [
      'Provide the target AnimationPlayer node path',
    ]);
  }
  if (!args.animName) {
    return createErrorResponse('animName is required', ['Provide the animation name to configure']);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
    playerPath: args.playerPath,
    animName: args.animName,
  };
  if (args.length !== undefined) params.length = args.length;
  if (args.loop !== undefined) params.loop = args.loop;
  if (args.tracks !== undefined) {
    if (!Array.isArray(args.tracks)) {
      return createErrorResponse('tracks must be an array', [
        'Provide tracks as an array of track definitions',
      ]);
    }
    params.tracks = args.tracks;
  }

  return executeSceneOp(
    runner,
    'configure_animation',
    params,
    v.projectPath,
    'Failed to configure animation',
    [
      'Check that the AnimationPlayer node exists',
      'Ensure track paths and property names are correct',
    ],
  );
}
