import type { GodotRunner, OperationParams, ToolResponse } from './godot-runner.js';
import { createErrorResponse, extractGdError, getErrorMessage } from './godot-runner.js';
import { SnapshotManager } from './snapshot-manager.js';

export const MAX_RUNTIME_ERROR_CONTEXT_LINES = 30;

const mutatingOperations = new Set([
  'add_node', 'delete_nodes', 'set_node_properties', 'attach_script',
  'duplicate_node', 'set_node_metadata', 'load_sprite', 'setup_control',
  'setup_collision', 'add_mesh_instance', 'setup_camera', 'setup_lighting',
  'setup_environment', 'setup_navigation_3d', 'create_particles_3d',
  'setup_animation_tree', 'setup_collision_3d', 'setup_joint_3d',
  'set_tilemap_cell', 'set_gridmap_cell', 'configure_animation'
]);

/**
 * Wraps the execute + empty-stdout-check + try/catch around a headless GDScript
 * operation. Used by the 15 scene/node mutation handlers in tools/scene-tools.ts
 * and tools/node-tools.ts to eliminate identical error-handling duplication.
 *
 * Automatically creates transaction-backups before mutations, rolling them back if
 * an execution or validation step fails.
 */
export async function executeSceneOp(
  runner: GodotRunner,
  operation: string,
  params: OperationParams,
  projectPath: string,
  failurePrefix: string,
  emptyStdoutSolutions: string[],
  exceptionSolutions: string[] = ['Ensure Godot is installed correctly'],
): Promise<ToolResponse> {
  const scenePath = (params.scenePath || params.scene_path) as string | undefined;
  const isMutation = mutatingOperations.has(operation) && scenePath;

  let backupPath: string | null = null;
  if (isMutation && scenePath) {
    backupPath = await SnapshotManager.createBackup(projectPath, scenePath);
  }

  try {
    const { stdout, stderr } = await runner.executeOperation(operation, params, projectPath);
    
    if (!stdout.trim()) {
      if (isMutation && scenePath && backupPath) {
        await SnapshotManager.rollback(projectPath, scenePath, backupPath);
      }
      return createErrorResponse(
        `${failurePrefix}: ${extractGdError(stderr)}`,
        emptyStdoutSolutions,
      );
    }

    // Parse stdout to check for a logical "error" field returned from GDScript
    try {
      const parsed = JSON.parse(stdout);
      if (parsed && parsed.error) {
        if (isMutation && scenePath && backupPath) {
          await SnapshotManager.rollback(projectPath, scenePath, backupPath);
        }
        return createErrorResponse(
          `${failurePrefix}: ${parsed.error}`,
          emptyStdoutSolutions,
        );
      }
    } catch {
      // If output is not JSON, let the caller parse or handle it
    }

    return { content: [{ type: 'text', text: stdout }] };
  } catch (error: unknown) {
    if (isMutation && scenePath && backupPath) {
      await SnapshotManager.rollback(projectPath, scenePath, backupPath);
    }
    return createErrorResponse(`${failurePrefix}: ${getErrorMessage(error)}`, exceptionSolutions);
  }
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: ToolResponse };

/**
 * Parse a JSON frame returned by the McpBridge. On failure, returns a
 * structured error response so handlers can short-circuit with one branch.
 * `context` should describe which bridge command produced the frame.
 */
export function parseBridgeJson<T = unknown>(responseStr: string, context: string): ParseResult<T> {
  try {
    return { ok: true, data: JSON.parse(responseStr) as T };
  } catch (error) {
    return {
      ok: false,
      response: createErrorResponse(
        `Invalid response from bridge (${context}): ${getErrorMessage(error)}`,
        [
          'The bridge returned non-JSON data - check Godot stderr via get_debug_output',
          'Restart the project with stop_project followed by run_project',
        ],
      ),
    };
  }
}

/**
 * Attach captured runtime errors as a `warnings` array on a tool response
 * payload. No-op when there are no runtime errors. Truncates to
 * `MAX_RUNTIME_ERROR_CONTEXT_LINES` to keep payloads bounded.
 */
export function attachRuntimeWarnings(
  target: Record<string, unknown>,
  runtimeErrors: string[],
): void {
  if (runtimeErrors.length > 0) {
    target.warnings = runtimeErrors.slice(0, MAX_RUNTIME_ERROR_CONTEXT_LINES);
  }
}
