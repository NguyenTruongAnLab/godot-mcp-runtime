/**
 * Tool dispatch table.
 *
 * Maps every MCP tool name to a handler that takes the runner + raw args and
 * returns the tool response. Extracted from index.ts so tests can exercise
 * dispatch as a pure data structure (no Server / stdio / lifecycle setup).
 *
 * Behavioral contract preserved from the original switch in index.ts:
 *  - Each name routes to the same handler it did before.
 *  - Unknown tool names throw McpError(MethodNotFound, ...) - see
 *    `dispatchToolCall`.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import type {
  GodotRunner,
  OperationParams,
  ToolHandler,
  ToolResponse,
} from './utils/godot-runner.js';

import {
  handleLaunchEditor,
  handleRunProject,
  handleAttachProject,
  handleDetachProject,
  handleGetDebugOutput,
  handleStopProject,
  handleTakeScreenshot,
  handleSimulateInput,
  handleGetUiElements,
  handleRunScript,
  handleGetPerformanceMetrics,
  handleQuerySpatialCollision,
  handleGetGroundClamp,
  handleRecordTelemetrySequence,
  handleNavigateTo,
} from './tools/runtime-tools.js';

import {
  handleListAutoloads,
  handleAddAutoload,
  handleRemoveAutoload,
  handleUpdateAutoload,
} from './tools/autoload-tools.js';

import {
  handleListProjects,
  handleGetProjectInfo,
  handleGetProjectFiles,
  handleSearchProject,
  handleGetSceneDependencies,
  handleGetProjectSettings,
  handleSetProjectSetting,
  handleSetCollisionLayerName,
} from './tools/project-tools.js';

import {
  handleCreateScene,
  handleAddNode,
  handleLoadSprite,
  handleSaveScene,
  handleExportMeshLibrary,
  handleBatchSceneOperations,
  handleInstanceScene,
} from './tools/scene-tools.js';

import {
  handleDeleteNodes,
  handleSetNodeProperties,
  handleGetNodeProperties,
  handleAttachScript,
  handleGetSceneTree,
  handleDuplicateNode,
  handleGetNodeSignals,
  handleConnectSignal,
  handleDisconnectSignal,
  handleSetNodeMetadata,
  handleGetNodeMetadata,
  handleSetupControl,
  handleSetupCollision,
  handleAddMeshInstance,
  handleSetPhysicsLayers,
  handleGetPhysicsLayers,
  handleAddRaycast,
  handleSetupCamera,
  handleSetupLighting,
  handleSetupEnvironment,
  handleSetupNavigation3D,
  handleCreateParticles3D,
  handleSetupAnimationTree,
  handleSetupCollision3D,
  handleSetupJoint3D,
  handleGenerateGuiHierarchy,
} from './tools/node-tools.js';

import { handleValidate } from './tools/validate-tools.js';

import {
  handleListScriptElements,
  handleAddScriptVariable,
  handleAddScriptSignal,
  handleAddScriptFunction,
  handleRemoveScriptFunction,
} from './tools/script-tools.js';

import {
  handleListInputActions,
  handleAddInputAction,
  handleRemoveInputAction,
} from './tools/input-tools.js';

import {
  handleCreateTresResource,
  handleApplySpatialMaterial,
  handleCompileMaterialTree,
  handleSetSpatialMaterial,
} from './tools/resource-tools.js';

import { handleSetTilemapCell, handleSetGridmapCell } from './tools/tilemap-tools.js';
import { handleConfigureAnimation, handleGetAnimationList, handlePipeAnimationStates } from './tools/animation-tools.js';
import { handleCreateShaderResource, handleApplyShaderMaterial } from './tools/shader-tools.js';
import { handleImportResource } from './tools/import-resource-tools.js';

export const toolDispatch: Record<string, ToolHandler> = {
  // Project tools
  launch_editor: handleLaunchEditor,
  run_project: handleRunProject,
  attach_project: handleAttachProject,
  detach_project: handleDetachProject,
  get_debug_output: handleGetDebugOutput,
  stop_project: handleStopProject,
  list_projects: (_runner, args) => handleListProjects(args),
  get_project_info: handleGetProjectInfo,
  take_screenshot: handleTakeScreenshot,
  simulate_input: handleSimulateInput,
  get_ui_elements: handleGetUiElements,
  run_script: handleRunScript,
  get_performance_metrics: handleGetPerformanceMetrics,
  query_spatial_collision: handleQuerySpatialCollision,
  get_ground_clamp: handleGetGroundClamp,
  record_telemetry_sequence: handleRecordTelemetrySequence,
  navigate_to: handleNavigateTo,
  list_autoloads: (_runner, args) => handleListAutoloads(args),
  add_autoload: (_runner, args) => handleAddAutoload(args),
  remove_autoload: (_runner, args) => handleRemoveAutoload(args),
  update_autoload: (_runner, args) => handleUpdateAutoload(args),
  get_project_files: (_runner, args) => handleGetProjectFiles(args),
  search_project: (_runner, args) => handleSearchProject(args),
  get_scene_dependencies: (_runner, args) => handleGetSceneDependencies(args),
  get_project_settings: (_runner, args) => handleGetProjectSettings(args),
  set_project_setting: (_runner, args) => handleSetProjectSetting(_runner, args),
  set_collision_layer_name: (_runner, args) => handleSetCollisionLayerName(_runner, args),

  // Scene tools
  create_scene: handleCreateScene,
  add_node: handleAddNode,
  load_sprite: handleLoadSprite,
  save_scene: handleSaveScene,
  export_mesh_library: handleExportMeshLibrary,
  batch_scene_operations: handleBatchSceneOperations,
  instance_scene: handleInstanceScene,

  // Node tools
  delete_nodes: handleDeleteNodes,
  set_node_properties: handleSetNodeProperties,
  get_node_properties: handleGetNodeProperties,
  attach_script: handleAttachScript,
  get_scene_tree: handleGetSceneTree,
  duplicate_node: handleDuplicateNode,
  get_node_signals: handleGetNodeSignals,
  connect_signal: handleConnectSignal,
  disconnect_signal: handleDisconnectSignal,
  set_node_metadata: handleSetNodeMetadata,
  get_node_metadata: handleGetNodeMetadata,
  setup_control: handleSetupControl,
  setup_collision: handleSetupCollision,
  add_mesh_instance: handleAddMeshInstance,
  set_physics_layers: handleSetPhysicsLayers,
  get_physics_layers: handleGetPhysicsLayers,
  add_raycast: handleAddRaycast,
  setup_camera: handleSetupCamera,
  setup_lighting: handleSetupLighting,
  setup_environment: handleSetupEnvironment,
  setup_navigation_3d: handleSetupNavigation3D,
  create_particles_3d: handleCreateParticles3D,
  setup_animation_tree: handleSetupAnimationTree,
  setup_collision_3d: handleSetupCollision3D,
  setup_joint_3d: handleSetupJoint3D,
  generate_gui_hierarchy: handleGenerateGuiHierarchy,

  // Validate tools
  validate: handleValidate,

  // Script tools
  list_script_elements: handleListScriptElements,
  add_script_variable: handleAddScriptVariable,
  add_script_signal: handleAddScriptSignal,
  add_script_function: handleAddScriptFunction,
  remove_script_function: handleRemoveScriptFunction,

  // Input tools
  list_input_actions: handleListInputActions,
  add_input_action: handleAddInputAction,
  remove_input_action: handleRemoveInputAction,

  // Resource tools
  create_tres_resource: handleCreateTresResource,
  apply_spatial_material: handleApplySpatialMaterial,
  set_spatial_material: handleSetSpatialMaterial,
  compile_material_tree: handleCompileMaterialTree,
  set_tilemap_cell: handleSetTilemapCell,
  set_gridmap_cell: handleSetGridmapCell,
  configure_animation: handleConfigureAnimation,
  get_animation_list: handleGetAnimationList,
  pipe_animation_states: handlePipeAnimationStates,
  create_shader_resource: handleCreateShaderResource,
  apply_shader_material: handleApplyShaderMaterial,
  import_resource: handleImportResource,
};

export async function dispatchToolCall(
  runner: GodotRunner,
  toolName: string,
  args: OperationParams,
): Promise<ToolResponse> {
  const handler = toolDispatch[toolName];
  if (!handler) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
  }
  return await handler(runner, args);
}
