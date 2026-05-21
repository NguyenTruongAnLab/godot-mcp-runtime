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
          description: 'Path to the AnimationPlayer node from scene root (e.g. "root/AnimationPlayer")',
        },
        animName: { type: 'string', description: 'Name of the animation (e.g., "walk", "idle", "jump")' },
        length: { type: 'number', description: 'Length of the animation in seconds (default: 1.0)' },
        loop: { type: 'boolean', description: 'Whether the animation should loop (default: false)' },
        tracks: {
          type: 'array',
          description: 'List of animation tracks to define.',
          items: {
            type: 'object',
            properties: {
              nodePath: {
                type: 'string',
                description: 'Path to the target node relative to the AnimationPlayer (e.g., "Sprite" or ".")',
              },
              property: {
                type: 'string',
                description: 'The property name to animate (e.g., "position", "rotation_degrees", "scale", "visible")',
              },
              keys: {
                type: 'array',
                description: 'Array of keyframes for this track.',
                items: {
                  type: 'object',
                  properties: {
                    time: { type: 'number', description: 'Time of the keyframe in seconds' },
                    value: {
                      description: 'The value at this keyframe. Can be a number, boolean, Vector2, Vector3, or Color object.',
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
  {
    name: 'get_animation_list',
    description:
      'List all animations defined in an AnimationPlayer node inside a scene. Returns: a list of each animation\'s name, length, loop flag, and track count. Use this to inspect existing animations before adding or modifying them with configure_animation. Works headlessly (no running project required).',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project' },
        playerPath: {
          type: 'string',
          description: 'Path to the AnimationPlayer node from scene root (e.g. "root/AnimationPlayer")',
        },
      },
      required: ['projectPath', 'scenePath', 'playerPath'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        animations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              length: { type: 'number' },
              loop: { type: 'boolean' },
              trackCount: { type: 'number' },
            },
          },
        },
      },
    },
  },
  {
    name: 'pipe_animation_states',
    description:
      'Programmatically wire animation state machines and blend trees inside an AnimationTree node within a scene file, headlessly without opening the Godot Editor.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Scene file path relative to the project (e.g. "scenes/main.tscn")' },
        treePath: {
          type: 'string',
          description: 'Scene-tree node path of the AnimationTree node to modify (e.g. "root/AnimationTree")',
        },
        states: {
          type: 'array',
          description: 'States to populate in the StateMachine',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Unique state name in the state machine (e.g., "walk")' },
              animName: { type: 'string', description: 'Target animation track name in the AnimationPlayer (e.g., "walk_loop")' },
            },
            required: ['name', 'animName'],
          },
        },
        transitions: {
          type: 'array',
          description: 'Transitions to link between states in the StateMachine',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'Source state name' },
              to: { type: 'string', description: 'Destination state name' },
              xfade_time: { type: 'number', description: 'Crossfade transition time in seconds' },
              auto_advance: { type: 'boolean', description: 'Whether to auto-advance to next state' },
            },
            required: ['from', 'to'],
          },
        },
        active: {
          type: 'boolean',
          description: 'Whether to set the AnimationTree active (default: true)',
        },
      },
      required: ['projectPath', 'scenePath', 'treePath'],
    },
  },
];

export async function handleConfigureAnimation(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.playerPath || !validateNodePath(args.playerPath as string)) {
    return createErrorResponse('Valid playerPath is required', ['Provide the target AnimationPlayer node path']);
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
      return createErrorResponse('tracks must be an array', ['Provide tracks as an array of track definitions']);
    }
    params.tracks = args.tracks;
  }

  return executeSceneOp(
    runner,
    'configure_animation',
    params,
    v.projectPath,
    'Failed to configure animation',
    ['Check that the AnimationPlayer node exists', 'Ensure track paths and property names are correct'],
  );
}

export async function handleGetAnimationList(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.playerPath || !validateNodePath(args.playerPath as string)) {
    return createErrorResponse('Valid playerPath is required', ['Provide the target AnimationPlayer node path']);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
    playerPath: args.playerPath,
  };

  return executeSceneOp(
    runner,
    'get_animation_list',
    params,
    v.projectPath,
    'Failed to get animation list',
    ['Check that the AnimationPlayer node exists in the scene', 'Verify the scene and node paths are correct'],
  );
}

export async function handlePipeAnimationStates(runner: GodotRunner, args: OperationParams) {
  args = normalizeParameters(args);
  const v = validateSceneArgs(args);
  if ('isError' in v) return v;

  if (!args.treePath || !validateNodePath(args.treePath as string)) {
    return createErrorResponse('Valid treePath is required', ['Provide the target AnimationTree node path']);
  }

  const params: OperationParams = {
    scenePath: args.scenePath,
    tree_path: args.treePath,
  };

  if (args.states !== undefined) {
    if (!Array.isArray(args.states)) {
      return createErrorResponse('states must be an array', ['Provide states as an array of state objects']);
    }
    params.states = args.states.map((s: any) => ({
      name: s.name,
      anim_name: s.animName,
    }));
  }

  if (args.transitions !== undefined) {
    if (!Array.isArray(args.transitions)) {
      return createErrorResponse('transitions must be an array', ['Provide transitions as an array of transition objects']);
    }
    params.transitions = args.transitions;
  }

  if (args.active !== undefined) {
    params.active = args.active;
  }

  return executeSceneOp(
    runner,
    'pipe_animation_states',
    params,
    v.projectPath,
    'Failed to pipe animation states',
    ['Check that the AnimationTree node exists', 'Ensure states and transition target names are correct'],
  );
}

