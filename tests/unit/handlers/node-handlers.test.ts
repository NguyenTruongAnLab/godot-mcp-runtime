import { describe, it, expect } from 'vitest';
import {
  handleDeleteNodes,
  handleSetNodeProperties,
  handleGetNodeProperties,
  handleAttachScript,
  handleGetSceneTree,
  handleDuplicateNode,
  handleConnectSignal,
  handleDisconnectSignal,
  handleGetNodeSignals,
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
} from '../../../src/tools/node-tools.js';
import { createFakeRunner } from '../../helpers/fake-runner.js';
import { hasError, expectErrorMatching } from '../../helpers/assertions.js';
import { fixtureProjectPath, fixtureScenePath } from '../../helpers/fixture-paths.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const validBase = { projectPath: fixtureProjectPath, scenePath: fixtureScenePath };

// ---------------------------------------------------------------------------
// handleDeleteNodes
// ---------------------------------------------------------------------------

describe('handleDeleteNodes', () => {
  it('rejects missing projectPath', async () => {
    const fake = createFakeRunner();
    const result = await handleDeleteNodes(fake.asRunner, {
      scenePath: fixtureScenePath,
      nodePaths: ['root/Node'],
    });
    expectErrorMatching(result, /projectPath/i);
  });

  it('rejects projectPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleDeleteNodes(fake.asRunner, {
      projectPath: '../evil',
      scenePath: fixtureScenePath,
      nodePaths: ['root/Node'],
    });
    expectErrorMatching(result, /invalid project path/i);
  });

  it('rejects nonexistent project', async () => {
    const fake = createFakeRunner();
    const result = await handleDeleteNodes(fake.asRunner, {
      projectPath: '/ghost',
      scenePath: fixtureScenePath,
      nodePaths: ['root/Node'],
    });
    expectErrorMatching(result, /not a valid godot project/i);
  });

  it('rejects missing nodePaths', async () => {
    const fake = createFakeRunner();
    const result = await handleDeleteNodes(fake.asRunner, validBase);
    expectErrorMatching(result, /nodePaths/i);
  });

  it('rejects an empty nodePaths array', async () => {
    const fake = createFakeRunner({ stdout: '{}' });
    const result = await handleDeleteNodes(fake.asRunner, {
      ...validBase,
      nodePaths: [],
    });
    expectErrorMatching(result, /nodePaths/i);
  });

  it('rejects nodePath entry containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleDeleteNodes(fake.asRunner, {
      ...validBase,
      nodePaths: ['../escape'],
    });
    expectErrorMatching(result, /nodePath/i);
  });

  it('treats empty Godot output as a failed operation', async () => {
    const fake = createFakeRunner({ stdout: '' });
    const result = await handleDeleteNodes(fake.asRunner, {
      ...validBase,
      nodePaths: ['root/Node'],
    });
    expect(hasError(result)).toBe(true);
  });

  it('surfaces runner exceptions as a structured MCP error response', async () => {
    const fake = createFakeRunner({ throws: new Error('boom') });
    const result = await handleDeleteNodes(fake.asRunner, {
      ...validBase,
      nodePaths: ['root/Node'],
    });
    expectErrorMatching(result, /boom/);
  });

  it('returns parsed result on successful runner output', async () => {
    const fake = createFakeRunner({
      stdout: '{"results":[{"nodePath":"root/Sprite","success":true}]}',
    });
    const result = await handleDeleteNodes(fake.asRunner, {
      ...validBase,
      nodePaths: ['root/Sprite'],
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.results[0].success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleSetNodeProperties
// ---------------------------------------------------------------------------

describe('handleSetNodeProperties', () => {
  const validUpdates = [{ nodePath: 'root/Sprite', property: 'visible', value: true }];

  it('rejects missing projectPath', async () => {
    const fake = createFakeRunner();
    const result = await handleSetNodeProperties(fake.asRunner, {
      scenePath: fixtureScenePath,
      updates: validUpdates,
    });
    expectErrorMatching(result, /projectPath/i);
  });

  it('rejects projectPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleSetNodeProperties(fake.asRunner, {
      projectPath: '../evil',
      scenePath: fixtureScenePath,
      updates: validUpdates,
    });
    expectErrorMatching(result, /invalid project path/i);
  });

  it('rejects nonexistent project', async () => {
    const fake = createFakeRunner();
    const result = await handleSetNodeProperties(fake.asRunner, {
      projectPath: '/ghost',
      scenePath: fixtureScenePath,
      updates: validUpdates,
    });
    expectErrorMatching(result, /not a valid godot project/i);
  });

  it('rejects missing updates array', async () => {
    const fake = createFakeRunner();
    const result = await handleSetNodeProperties(fake.asRunner, validBase);
    expectErrorMatching(result, /updates/i);
  });

  it('treats empty Godot output as a failed operation', async () => {
    const fake = createFakeRunner({ stdout: '' });
    const result = await handleSetNodeProperties(fake.asRunner, {
      ...validBase,
      updates: validUpdates,
    });
    expect(hasError(result)).toBe(true);
  });

  it('surfaces runner exceptions as a structured MCP error response', async () => {
    const fake = createFakeRunner({ throws: new Error('boom') });
    const result = await handleSetNodeProperties(fake.asRunner, {
      ...validBase,
      updates: validUpdates,
    });
    expectErrorMatching(result, /boom/);
  });

  it('handles single-element updates array', async () => {
    const fake = createFakeRunner({
      stdout: '{"results":[{"nodePath":"root/Sprite","property":"visible","success":true}]}',
    });
    const result = await handleSetNodeProperties(fake.asRunner, {
      ...validBase,
      updates: validUpdates,
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.results[0].success).toBe(true);
  });

  it('handles multi-element updates array', async () => {
    const fake = createFakeRunner({
      stdout:
        '{"results":[{"nodePath":"root/A","property":"visible","success":true},{"nodePath":"root/B","property":"visible","success":true}]}',
    });
    const result = await handleSetNodeProperties(fake.asRunner, {
      ...validBase,
      updates: [
        { nodePath: 'root/A', property: 'visible', value: true },
        { nodePath: 'root/B', property: 'visible', value: false },
      ],
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.results).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// handleGetNodeProperties (always-array)
// ---------------------------------------------------------------------------

describe('handleGetNodeProperties', () => {
  const validNodes = [{ nodePath: 'root' }];

  it('rejects missing projectPath', async () => {
    const fake = createFakeRunner();
    const result = await handleGetNodeProperties(fake.asRunner, {
      scenePath: fixtureScenePath,
      nodes: validNodes,
    });
    expectErrorMatching(result, /projectPath/i);
  });

  it('rejects projectPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleGetNodeProperties(fake.asRunner, {
      projectPath: '../evil',
      scenePath: fixtureScenePath,
      nodes: validNodes,
    });
    expectErrorMatching(result, /invalid project path/i);
  });

  it('rejects nonexistent project', async () => {
    const fake = createFakeRunner();
    const result = await handleGetNodeProperties(fake.asRunner, {
      projectPath: '/ghost',
      scenePath: fixtureScenePath,
      nodes: validNodes,
    });
    expectErrorMatching(result, /not a valid godot project/i);
  });

  it('rejects missing nodes array', async () => {
    const fake = createFakeRunner();
    const result = await handleGetNodeProperties(fake.asRunner, validBase);
    expectErrorMatching(result, /nodes/i);
  });

  it('treats empty Godot output as a failed operation', async () => {
    const fake = createFakeRunner({ stdout: '' });
    const result = await handleGetNodeProperties(fake.asRunner, {
      ...validBase,
      nodes: validNodes,
    });
    expect(hasError(result)).toBe(true);
  });

  it('surfaces runner exceptions as a structured MCP error response', async () => {
    const fake = createFakeRunner({ throws: new Error('boom') });
    const result = await handleGetNodeProperties(fake.asRunner, {
      ...validBase,
      nodes: validNodes,
    });
    expectErrorMatching(result, /boom/);
  });

  it('returns parsed result on successful runner output', async () => {
    const fake = createFakeRunner({
      stdout: '{"results":[{"nodePath":"root","nodeType":"Node2D","properties":{}}]}',
    });
    const result = await handleGetNodeProperties(fake.asRunner, {
      ...validBase,
      nodes: validNodes,
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.results[0].nodePath).toBe('root');
    expect(parsed.results[0].nodeType).toBe('Node2D');
  });
});

// ---------------------------------------------------------------------------
// handleAttachScript
// ---------------------------------------------------------------------------

describe('handleAttachScript', () => {
  it('rejects missing projectPath', async () => {
    const fake = createFakeRunner();
    const result = await handleAttachScript(fake.asRunner, {
      scenePath: fixtureScenePath,
      nodePath: 'root/Node',
      scriptPath: 'player.gd',
    });
    expectErrorMatching(result, /projectPath/i);
  });

  it('rejects projectPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleAttachScript(fake.asRunner, {
      projectPath: '../evil',
      scenePath: fixtureScenePath,
      nodePath: 'root/Node',
      scriptPath: 'player.gd',
    });
    expectErrorMatching(result, /invalid project path/i);
  });

  it('rejects nonexistent project', async () => {
    const fake = createFakeRunner();
    const result = await handleAttachScript(fake.asRunner, {
      projectPath: '/ghost',
      scenePath: fixtureScenePath,
      nodePath: 'root/Node',
      scriptPath: 'player.gd',
    });
    expectErrorMatching(result, /not a valid godot project/i);
  });

  it('rejects missing nodePath', async () => {
    const fake = createFakeRunner();
    const result = await handleAttachScript(fake.asRunner, {
      ...validBase,
      scriptPath: 'player.gd',
    });
    expectErrorMatching(result, /nodePath/i);
  });

  it('rejects missing scriptPath', async () => {
    const fake = createFakeRunner();
    const result = await handleAttachScript(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Node',
    });
    expectErrorMatching(result, /scriptPath/i);
  });

  it('rejects scriptPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleAttachScript(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Node',
      scriptPath: '../outside.gd',
    });
    expectErrorMatching(result, /scriptPath|invalid/i);
  });

  it('rejects nonexistent script file', async () => {
    const fake = createFakeRunner();
    const result = await handleAttachScript(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Node',
      scriptPath: 'nonexistent_script.gd',
    });
    expectErrorMatching(result, /script file does not exist/i);
  });

  it('surfaces runner exceptions as a structured MCP error response', async () => {
    const fake = createFakeRunner({ throws: new Error('boom') });
    const result = await handleAttachScript(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Node',
      scriptPath: 'placeholder.gd',
    });
    expectErrorMatching(result, /boom/);
  });

  it('returns parsed result on successful runner output', async () => {
    const fake = createFakeRunner({
      stdout: "Script 'res://placeholder.gd' attached successfully to node 'root/Sprite'",
    });
    const result = await handleAttachScript(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Sprite',
      scriptPath: 'placeholder.gd',
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain('attached successfully');
  });
});

// ---------------------------------------------------------------------------
// handleGetSceneTree
// ---------------------------------------------------------------------------

describe('handleGetSceneTree', () => {
  it('rejects missing projectPath', async () => {
    const fake = createFakeRunner();
    const result = await handleGetSceneTree(fake.asRunner, { scenePath: fixtureScenePath });
    expectErrorMatching(result, /projectPath/i);
  });

  it('rejects projectPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleGetSceneTree(fake.asRunner, {
      projectPath: '../evil',
      scenePath: fixtureScenePath,
    });
    expectErrorMatching(result, /invalid project path/i);
  });

  it('rejects nonexistent project', async () => {
    const fake = createFakeRunner();
    const result = await handleGetSceneTree(fake.asRunner, {
      projectPath: '/ghost',
      scenePath: fixtureScenePath,
    });
    expectErrorMatching(result, /not a valid godot project/i);
  });

  it('rejects parentPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleGetSceneTree(fake.asRunner, {
      ...validBase,
      parentPath: '../root',
    });
    expectErrorMatching(result, /parentPath/i);
  });

  it('treats empty Godot output as a failed operation', async () => {
    const fake = createFakeRunner({ stdout: '' });
    const result = await handleGetSceneTree(fake.asRunner, validBase);
    expectErrorMatching(result, /scene tree|failed/i);
  });

  it('surfaces runner exceptions as a structured MCP error response', async () => {
    const fake = createFakeRunner({ throws: new Error('boom') });
    const result = await handleGetSceneTree(fake.asRunner, validBase);
    expectErrorMatching(result, /boom/);
  });

  it('returns parsed result on successful runner output', async () => {
    const fake = createFakeRunner({
      stdout: '{"name":"root","type":"Node2D","path":"root","script":"","children":[]}',
    });
    const result = await handleGetSceneTree(fake.asRunner, validBase);
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.name).toBe('root');
    expect(parsed.type).toBe('Node2D');
  });
});

// ---------------------------------------------------------------------------
// handleDuplicateNode
// ---------------------------------------------------------------------------

describe('handleDuplicateNode', () => {
  it('rejects missing projectPath', async () => {
    const fake = createFakeRunner();
    const result = await handleDuplicateNode(fake.asRunner, {
      scenePath: fixtureScenePath,
      nodePath: 'root/Node',
    });
    expectErrorMatching(result, /projectPath/i);
  });

  it('rejects projectPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleDuplicateNode(fake.asRunner, {
      projectPath: '../evil',
      scenePath: fixtureScenePath,
      nodePath: 'root/Node',
    });
    expectErrorMatching(result, /invalid project path/i);
  });

  it('rejects nonexistent project', async () => {
    const fake = createFakeRunner();
    const result = await handleDuplicateNode(fake.asRunner, {
      projectPath: '/ghost',
      scenePath: fixtureScenePath,
      nodePath: 'root/Node',
    });
    expectErrorMatching(result, /not a valid godot project/i);
  });

  it('rejects missing nodePath', async () => {
    const fake = createFakeRunner();
    const result = await handleDuplicateNode(fake.asRunner, validBase);
    expectErrorMatching(result, /nodePath/i);
  });

  it('rejects targetParentPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleDuplicateNode(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Node',
      targetParentPath: '../escape',
    });
    expectErrorMatching(result, /targetParentPath/i);
  });

  it('treats empty Godot output as a failed operation', async () => {
    const fake = createFakeRunner({ stdout: '' });
    const result = await handleDuplicateNode(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Node',
    });
    expect(hasError(result)).toBe(true);
  });

  it('surfaces runner exceptions as a structured MCP error response', async () => {
    const fake = createFakeRunner({ throws: new Error('boom') });
    const result = await handleDuplicateNode(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Node',
    });
    expectErrorMatching(result, /boom/);
  });

  it('returns parsed result on successful runner output', async () => {
    const fake = createFakeRunner({
      stdout: "Node duplicated successfully as 'Sprite2'",
    });
    const result = await handleDuplicateNode(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Sprite',
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain('duplicated successfully');
  });
});

// ---------------------------------------------------------------------------
// handleConnectSignal
// ---------------------------------------------------------------------------

describe('handleConnectSignal', () => {
  it('rejects missing projectPath', async () => {
    const fake = createFakeRunner();
    const result = await handleConnectSignal(fake.asRunner, {
      scenePath: fixtureScenePath,
      nodePath: 'root/Button',
      signal: 'pressed',
      targetNodePath: 'root/Label',
      method: '_on_pressed',
    });
    expectErrorMatching(result, /projectPath/i);
  });

  it('rejects projectPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleConnectSignal(fake.asRunner, {
      projectPath: '../evil',
      scenePath: fixtureScenePath,
      nodePath: 'root/Button',
      signal: 'pressed',
      targetNodePath: 'root/Label',
      method: '_on_pressed',
    });
    expectErrorMatching(result, /invalid project path/i);
  });

  it('rejects nonexistent project', async () => {
    const fake = createFakeRunner();
    const result = await handleConnectSignal(fake.asRunner, {
      projectPath: '/ghost',
      scenePath: fixtureScenePath,
      nodePath: 'root/Button',
      signal: 'pressed',
      targetNodePath: 'root/Label',
      method: '_on_pressed',
    });
    expectErrorMatching(result, /not a valid godot project/i);
  });

  it('rejects missing nodePath', async () => {
    const fake = createFakeRunner();
    const result = await handleConnectSignal(fake.asRunner, {
      ...validBase,
      signal: 'pressed',
      targetNodePath: 'root/Label',
      method: '_on_pressed',
    });
    expectErrorMatching(result, /nodePath/i);
  });

  it('rejects missing signal', async () => {
    const fake = createFakeRunner();
    const result = await handleConnectSignal(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Button',
      targetNodePath: 'root/Label',
      method: '_on_pressed',
    });
    expectErrorMatching(result, /signal/i);
  });

  it('rejects targetNodePath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleConnectSignal(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Button',
      signal: 'pressed',
      targetNodePath: '../evil',
      method: '_on_pressed',
    });
    expectErrorMatching(result, /nodePath/i);
  });

  it('treats empty Godot output as a failed operation', async () => {
    const fake = createFakeRunner({ stdout: '' });
    const result = await handleConnectSignal(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Button',
      signal: 'pressed',
      targetNodePath: 'root/Label',
      method: '_on_pressed',
    });
    expect(hasError(result)).toBe(true);
  });

  it('surfaces runner exceptions as a structured MCP error response', async () => {
    const fake = createFakeRunner({ throws: new Error('boom') });
    const result = await handleConnectSignal(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Button',
      signal: 'pressed',
      targetNodePath: 'root/Label',
      method: '_on_pressed',
    });
    expectErrorMatching(result, /boom/);
  });

  it('returns parsed result on successful runner output', async () => {
    const fake = createFakeRunner({
      stdout: "Signal 'pressed' connected from 'root/Button' to 'root/Receiver._on_pressed'",
    });
    const result = await handleConnectSignal(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Button',
      signal: 'pressed',
      targetNodePath: 'root/Receiver',
      method: '_on_pressed',
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain('connected');
  });
});

// ---------------------------------------------------------------------------
// handleDisconnectSignal
// ---------------------------------------------------------------------------

describe('handleDisconnectSignal', () => {
  it('rejects missing projectPath', async () => {
    const fake = createFakeRunner();
    const result = await handleDisconnectSignal(fake.asRunner, {
      scenePath: fixtureScenePath,
      nodePath: 'root/Button',
      signal: 'pressed',
      targetNodePath: 'root/Label',
      method: '_on_pressed',
    });
    expectErrorMatching(result, /projectPath/i);
  });

  it('rejects projectPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleDisconnectSignal(fake.asRunner, {
      projectPath: '../evil',
      scenePath: fixtureScenePath,
      nodePath: 'root/Button',
      signal: 'pressed',
      targetNodePath: 'root/Label',
      method: '_on_pressed',
    });
    expectErrorMatching(result, /invalid project path/i);
  });

  it('rejects nonexistent project', async () => {
    const fake = createFakeRunner();
    const result = await handleDisconnectSignal(fake.asRunner, {
      projectPath: '/ghost',
      scenePath: fixtureScenePath,
      nodePath: 'root/Button',
      signal: 'pressed',
      targetNodePath: 'root/Label',
      method: '_on_pressed',
    });
    expectErrorMatching(result, /not a valid godot project/i);
  });

  it('rejects missing nodePath', async () => {
    const fake = createFakeRunner();
    const result = await handleDisconnectSignal(fake.asRunner, {
      ...validBase,
      signal: 'pressed',
      targetNodePath: 'root/Label',
      method: '_on_pressed',
    });
    expectErrorMatching(result, /nodePath/i);
  });

  it('rejects missing signal', async () => {
    const fake = createFakeRunner();
    const result = await handleDisconnectSignal(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Button',
      targetNodePath: 'root/Label',
      method: '_on_pressed',
    });
    expectErrorMatching(result, /signal/i);
  });

  it('rejects targetNodePath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleDisconnectSignal(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Button',
      signal: 'pressed',
      targetNodePath: '../evil',
      method: '_on_pressed',
    });
    expectErrorMatching(result, /nodePath/i);
  });

  it('treats empty Godot output as a failed operation', async () => {
    const fake = createFakeRunner({ stdout: '' });
    const result = await handleDisconnectSignal(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Button',
      signal: 'pressed',
      targetNodePath: 'root/Label',
      method: '_on_pressed',
    });
    expect(hasError(result)).toBe(true);
  });

  it('surfaces runner exceptions as a structured MCP error response', async () => {
    const fake = createFakeRunner({ throws: new Error('boom') });
    const result = await handleDisconnectSignal(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Button',
      signal: 'pressed',
      targetNodePath: 'root/Label',
      method: '_on_pressed',
    });
    expectErrorMatching(result, /boom/);
  });

  it('returns parsed result on successful runner output', async () => {
    const fake = createFakeRunner({
      stdout: "Signal 'pressed' disconnected from 'root/Button' to 'root/Receiver._on_pressed'",
    });
    const result = await handleDisconnectSignal(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Button',
      signal: 'pressed',
      targetNodePath: 'root/Receiver',
      method: '_on_pressed',
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain('disconnected');
  });
});

// ---------------------------------------------------------------------------
// handleGetNodeSignals
// ---------------------------------------------------------------------------

describe('handleGetNodeSignals', () => {
  it('rejects missing projectPath', async () => {
    const fake = createFakeRunner();
    const result = await handleGetNodeSignals(fake.asRunner, {
      scenePath: fixtureScenePath,
      nodePath: 'root/Button',
    });
    expectErrorMatching(result, /projectPath/i);
  });

  it('rejects projectPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleGetNodeSignals(fake.asRunner, {
      projectPath: '../evil',
      scenePath: fixtureScenePath,
      nodePath: 'root/Button',
    });
    expectErrorMatching(result, /invalid project path/i);
  });

  it('rejects nonexistent project', async () => {
    const fake = createFakeRunner();
    const result = await handleGetNodeSignals(fake.asRunner, {
      projectPath: '/ghost',
      scenePath: fixtureScenePath,
      nodePath: 'root/Button',
    });
    expectErrorMatching(result, /not a valid godot project/i);
  });

  it('rejects missing nodePath', async () => {
    const fake = createFakeRunner();
    const result = await handleGetNodeSignals(fake.asRunner, validBase);
    expectErrorMatching(result, /nodePath/i);
  });

  it('rejects nodePath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleGetNodeSignals(fake.asRunner, {
      ...validBase,
      nodePath: '../escape',
    });
    expectErrorMatching(result, /nodePath/i);
  });

  it('treats empty Godot output as a failed operation', async () => {
    const fake = createFakeRunner({ stdout: '' });
    const result = await handleGetNodeSignals(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Button',
    });
    expect(hasError(result)).toBe(true);
  });

  it('surfaces runner exceptions as a structured MCP error response', async () => {
    const fake = createFakeRunner({ throws: new Error('boom') });
    const result = await handleGetNodeSignals(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Button',
    });
    expectErrorMatching(result, /boom/);
  });

  it('returns parsed result on successful runner output', async () => {
    const fake = createFakeRunner({
      stdout:
        '{"nodePath":"root/Button","nodeType":"Button","signals":[{"name":"pressed","connections":[]}]}',
    });
    const result = await handleGetNodeSignals(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Button',
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.nodePath).toBe('root/Button');
    expect(parsed.signals[0].name).toBe('pressed');
  });
});

// ---------------------------------------------------------------------------
// handleSetNodeMetadata
// ---------------------------------------------------------------------------

describe('handleSetNodeMetadata', () => {
  it('rejects missing metaName', async () => {
    const fake = createFakeRunner();
    const result = await handleSetNodeMetadata(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Player',
      metaValue: 'some_value',
    });
    expectErrorMatching(result, /metaName/i);
  });

  it('rejects missing metaValue', async () => {
    const fake = createFakeRunner();
    const result = await handleSetNodeMetadata(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Player',
      metaName: 'tag',
    });
    expectErrorMatching(result, /metaValue/i);
  });

  it('calls runner for successful set metadata', async () => {
    const fake = createFakeRunner({
      stdout: 'Successfully set metadata \'tag\' on node root/Player',
    });
    const result = await handleSetNodeMetadata(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Player',
      metaName: 'tag',
      metaValue: 'hazard',
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain('Successfully set metadata');
  });
});

// ---------------------------------------------------------------------------
// handleGetNodeMetadata
// ---------------------------------------------------------------------------

describe('handleGetNodeMetadata', () => {
  it('calls runner with all parameters including optional metaName', async () => {
    const fake = createFakeRunner({
      stdout: '{"nodePath":"root/Player","metadata":{"tag":"hazard"}}',
    });
    const result = await handleGetNodeMetadata(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Player',
      metaName: 'tag',
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.nodePath).toBe('root/Player');
    expect(parsed.metadata.tag).toBe('hazard');
  });

  it('calls runner without optional metaName', async () => {
    const fake = createFakeRunner({
      stdout: '{"nodePath":"root/Player","metadata":{"tag":"hazard","score":100}}',
    });
    const result = await handleGetNodeMetadata(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Player',
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.metadata.tag).toBe('hazard');
    expect(parsed.metadata.score).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// handleSetupControl
// ---------------------------------------------------------------------------

describe('handleSetupControl', () => {
  it('calls runner with all parameters', async () => {
    const fake = createFakeRunner({
      stdout: '{"nodePath":"root/CanvasLayer/HUD","applied":["anchor_preset=full_rect","min_size=Vector2(100, 50)","size_flags_h=fill","size_flags_v=fill","margins={\\"left\\":10,\\"top\\":10,\\"right\\":10,\\"bottom\\":10}","separation=15","grow_h=both","grow_v=both"],"count":8}',
    });
    const result = await handleSetupControl(fake.asRunner, {
      ...validBase,
      nodePath: 'root/CanvasLayer/HUD',
      anchorPreset: 'full_rect',
      minSize: 'Vector2(100, 50)',
      sizeFlagsH: 'fill',
      sizeFlagsV: 'fill',
      margins: { left: 10, top: 10, right: 10, bottom: 10 },
      separation: 15,
      growH: 'both',
      growV: 'both',
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.nodePath).toBe('root/CanvasLayer/HUD');
    expect(parsed.count).toBe(8);
    expect(parsed.applied).toContain('anchor_preset=full_rect');
    expect(parsed.applied).toContain('min_size=Vector2(100, 50)');
  });

  it('rejects missing nodePath', async () => {
    const fake = createFakeRunner();
    const result = await handleSetupControl(fake.asRunner, {
      ...validBase,
    });
    expectErrorMatching(result, /nodePath/i);
  });
});

// ---------------------------------------------------------------------------
// handleSetupCollision
// ---------------------------------------------------------------------------

describe('handleSetupCollision', () => {
  it('calls runner with all parameters for 2D shape', async () => {
    const fake = createFakeRunner({
      stdout: '{"nodePath":"root/Player/CollisionShape2D","shapeType":"RectangleShape2D","dimension":"2D","success":true}',
    });
    const result = await handleSetupCollision(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Player',
      shape: 'rectangle',
      width: 64,
      height: 32,
      disabled: false,
      oneWayCollision: true,
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.nodePath).toBe('root/Player/CollisionShape2D');
    expect(parsed.success).toBe(true);
  });

  it('rejects missing nodePath', async () => {
    const fake = createFakeRunner();
    const result = await handleSetupCollision(fake.asRunner, {
      ...validBase,
      shape: 'rectangle',
    });
    expectErrorMatching(result, /nodePath/i);
  });

  it('rejects missing shape', async () => {
    const fake = createFakeRunner();
    const result = await handleSetupCollision(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Player',
    });
    expectErrorMatching(result, /shape/i);
  });
});

// ---------------------------------------------------------------------------
// handleAddMeshInstance
// ---------------------------------------------------------------------------

describe('handleAddMeshInstance', () => {
  it('calls runner with primitive mesh settings', async () => {
    const fake = createFakeRunner({
      stdout: '{"nodePath":"root/Level/MyBox","name":"MyBox","meshType":"CubeMesh","success":true}',
    });
    const result = await handleAddMeshInstance(fake.asRunner, {
      ...validBase,
      parentPath: 'root/Level',
      name: 'MyBox',
      meshType: 'CubeMesh',
      meshProperties: { size: { x: 2, y: 2, z: 2 } },
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.nodePath).toBe('root/Level/MyBox');
    expect(parsed.success).toBe(true);
  });

  it('rejects missing mesh type and mesh file', async () => {
    const fake = createFakeRunner();
    const result = await handleAddMeshInstance(fake.asRunner, {
      ...validBase,
      name: 'MyBox',
    });
    expectErrorMatching(result, /meshType|meshFile/i);
  });
});

// ---------------------------------------------------------------------------
// handleSetPhysicsLayers
// ---------------------------------------------------------------------------

describe('handleSetPhysicsLayers', () => {
  it('rejects missing nodePath', async () => {
    const fake = createFakeRunner();
    const result = await handleSetPhysicsLayers(fake.asRunner, {
      ...validBase,
      collisionLayer: 1,
    });
    expectErrorMatching(result, /nodePath/i);
  });

  it('rejects missing both collisionLayer and collisionMask', async () => {
    const fake = createFakeRunner();
    const result = await handleSetPhysicsLayers(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Player',
    });
    expectErrorMatching(result, /collisionLayer and\/or collisionMask/i);
  });

  it('rejects invalid collisionLayer type', async () => {
    const fake = createFakeRunner();
    const result = await handleSetPhysicsLayers(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Player',
      collisionLayer: 'invalid',
    });
    expectErrorMatching(result, /invalid collisionLayer/i);
  });

  it('calls runner for successful layer update with bitmask', async () => {
    const fake = createFakeRunner({
      stdout: '{"nodePath":"root/Player","applied":{"collision_layer":5},"success":true}',
    });
    const result = await handleSetPhysicsLayers(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Player',
      collisionLayer: 5,
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.nodePath).toBe('root/Player');
    expect(parsed.applied.collision_layer).toBe(5);
  });

  it('calls runner for successful layer update with index array', async () => {
    const fake = createFakeRunner({
      stdout: '{"nodePath":"root/Player","applied":{"collision_mask":3},"success":true}',
    });
    const result = await handleSetPhysicsLayers(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Player',
      collisionMask: [1, 2],
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.applied.collision_mask).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// handleGetPhysicsLayers
// ---------------------------------------------------------------------------

describe('handleGetPhysicsLayers', () => {
  it('rejects missing nodePath', async () => {
    const fake = createFakeRunner();
    const result = await handleGetPhysicsLayers(fake.asRunner, {
      ...validBase,
    });
    expectErrorMatching(result, /nodePath/i);
  });

  it('calls runner for successful get physics layers', async () => {
    const fake = createFakeRunner({
      stdout: '{"nodePath":"root/Player","collision_layer":1,"collision_layer_info":[{"layer":1,"name":"Player"}],"collision_mask":2,"collision_mask_info":[{"layer":2,"name":"Enemies"}],"success":true}',
    });
    const result = await handleGetPhysicsLayers(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Player',
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.nodePath).toBe('root/Player');
    expect(parsed.collision_layer_info[0].name).toBe('Player');
  });
});

// ---------------------------------------------------------------------------
// handleAddRaycast
// ---------------------------------------------------------------------------

describe('handleAddRaycast', () => {
  it('rejects parentPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleAddRaycast(fake.asRunner, {
      ...validBase,
      parentPath: '../escape',
    });
    expectErrorMatching(result, /parentPath/i);
  });

  it('calls runner for successful add raycast', async () => {
    const fake = createFakeRunner({
      stdout: '{"nodePath":"root/Player/MyRay","name":"MyRay","dimension":"2D","success":true}',
    });
    const result = await handleAddRaycast(fake.asRunner, {
      ...validBase,
      parentPath: 'root/Player',
      name: 'MyRay',
      dimension: '2d',
      enabled: true,
      collisionMask: 1,
      collideWithAreas: true,
      collideWithBodies: false,
      targetX: 0,
      targetY: 100,
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.nodePath).toBe('root/Player/MyRay');
    expect(parsed.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleSetupCamera
// ---------------------------------------------------------------------------

describe('handleSetupCamera', () => {
  it('rejects parentPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleSetupCamera(fake.asRunner, {
      ...validBase,
      parentPath: '../escape',
    });
    expectErrorMatching(result, /parentPath/i);
  });

  it('calls runner for successful setup camera', async () => {
    const fake = createFakeRunner({
      stdout: '{"nodePath":"root/Player/Camera2D","name":"Camera2D","dimension":"2D","success":true}',
    });
    const result = await handleSetupCamera(fake.asRunner, {
      ...validBase,
      parentPath: 'root/Player',
      dimension: '2d',
      current: true,
      zoom: { x: 2.0, y: 2.0 },
      position: { x: 0, y: 0 },
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.nodePath).toBe('root/Player/Camera2D');
    expect(parsed.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleSetupLighting
// ---------------------------------------------------------------------------

describe('handleSetupLighting', () => {
  it('rejects parentPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleSetupLighting(fake.asRunner, {
      ...validBase,
      parentPath: '../escape',
    });
    expectErrorMatching(result, /parentPath/i);
  });

  it('calls runner for successful setup lighting', async () => {
    const fake = createFakeRunner({
      stdout: '{"nodePath":"root/Spatial/SunLight","name":"SunLight","lightType":"DirectionalLight","success":true}',
    });
    const result = await handleSetupLighting(fake.asRunner, {
      ...validBase,
      parentPath: 'root/Spatial',
      lightType: 'DirectionalLight',
      preset: 'sun',
      color: { r: 1, g: 1, b: 1, a: 1 },
      energy: 1.5,
      shadows: true,
      position: { x: 0, y: 10, z: 0 },
      rotation: { x: -45, y: -30, z: 0 },
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.nodePath).toBe('root/Spatial/SunLight');
    expect(parsed.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleSetupEnvironment
// ---------------------------------------------------------------------------

describe('handleSetupEnvironment', () => {
  it('rejects parentPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleSetupEnvironment(fake.asRunner, {
      ...validBase,
      parentPath: '../escape',
    });
    expectErrorMatching(result, /parentPath/i);
  });

  it('calls runner for successful setup environment', async () => {
    const fake = createFakeRunner({
      stdout: '{"nodePath":"root/WorldEnvironment","name":"WorldEnvironment","success":true}',
    });
    const result = await handleSetupEnvironment(fake.asRunner, {
      ...validBase,
      parentPath: 'root',
      ambientMode: 'color',
      ambientColor: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 },
      ambientEnergy: 1.0,
      skyType: 'ProceduralSky',
      skyTopColor: { r: 0.5, g: 0.7, b: 0.9, a: 1.0 },
      skyHorizonColor: { r: 0.7, g: 0.8, b: 0.9, a: 1.0 },
      groundBottomColor: { r: 0.2, g: 0.2, b: 0.2, a: 1.0 },
      groundHorizonColor: { r: 0.7, g: 0.8, b: 0.9, a: 1.0 },
      glowEnabled: true,
      ssaoEnabled: false,
      ssrEnabled: false,
      fogEnabled: true,
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.nodePath).toBe('root/WorldEnvironment');
    expect(parsed.success).toBe(true);
  });
 });

// ---------------------------------------------------------------------------
// handleSetupNavigation3D
// ---------------------------------------------------------------------------

describe('handleSetupNavigation3D', () => {
  it('rejects agentParentPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleSetupNavigation3D(fake.asRunner, {
      ...validBase,
      agentParentPath: '../escape',
    });
    expectErrorMatching(result, /agentParentPath/i);
  });

  it('calls runner for successful setup navigation 3D', async () => {
    const fake = createFakeRunner({
      stdout: '{"navigationPath":"root/Navigation","instancePath":"root/Navigation/NavigationMeshInstance","agentPath":"root/Player/NavigationAgent","success":true}',
    });
    const result = await handleSetupNavigation3D(fake.asRunner, {
      ...validBase,
      parentPath: 'root',
      navigationName: 'Navigation',
      name: 'NavigationMeshInstance',
      cellSize: 0.3,
      cellHeight: 0.2,
      agentHeight: 2.0,
      agentRadius: 0.5,
      agentMaxClimb: 0.9,
      agentMaxSlope: 45.0,
      setupAgent: true,
      agentParentPath: 'root/Player',
      agentName: 'NavigationAgent',
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.navigationPath).toBe('root/Navigation');
    expect(parsed.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleCreateParticles3D
// ---------------------------------------------------------------------------

describe('handleCreateParticles3D', () => {
  it('rejects parentPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleCreateParticles3D(fake.asRunner, {
      ...validBase,
      parentPath: '../escape',
    });
    expectErrorMatching(result, /parentPath/i);
  });

  it('calls runner for successful create particles 3D', async () => {
    const fake = createFakeRunner({
      stdout: '{"nodePath":"root/Spatial/CPUParticles","name":"CPUParticles","preset":"fire","success":true}',
    });
    const result = await handleCreateParticles3D(fake.asRunner, {
      ...validBase,
      parentPath: 'root/Spatial',
      name: 'CPUParticles',
      preset: 'fire',
      amount: 40,
      lifetime: 1.0,
      explosiveness: 0.0,
      direction: { x: 0, y: 1, z: 0 },
      spread: 15.0,
      gravity: { x: 0, y: 2, z: 0 },
      initialVelocity: 2.0,
      position: { x: 0, y: 0, z: 0 },
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.nodePath).toBe('root/Spatial/CPUParticles');
    expect(parsed.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleSetupAnimationTree
// ---------------------------------------------------------------------------

describe('handleSetupAnimationTree', () => {
  it('rejects parentPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleSetupAnimationTree(fake.asRunner, {
      ...validBase,
      parentPath: '../escape',
    });
    expectErrorMatching(result, /parentPath/i);
  });

  it('calls runner for successful setup animation tree', async () => {
    const fake = createFakeRunner({
      stdout: '{"nodePath":"root/Player/AnimationTree","name":"AnimationTree","success":true}',
    });
    const result = await handleSetupAnimationTree(fake.asRunner, {
      ...validBase,
      parentPath: 'root/Player',
      name: 'AnimationTree',
      animPlayerPath: 'root/Player/AnimationPlayer',
      states: ['idle', 'walk'],
      transitions: [
        { from: 'idle', to: 'walk', autoAdvance: false },
        { from: 'walk', to: 'idle', autoAdvance: false },
      ],
      active: true,
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.nodePath).toBe('root/Player/AnimationTree');
    expect(parsed.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleSetupCollision3D
// ---------------------------------------------------------------------------

describe('handleSetupCollision3D', () => {
  it('rejects missing nodePath', async () => {
    const fake = createFakeRunner();
    const result = await handleSetupCollision3D(fake.asRunner, {
      ...validBase,
    });
    expectErrorMatching(result, /nodePath/i);
  });

  it('calls runner for successful setup collision 3D', async () => {
    const fake = createFakeRunner({
      stdout: '{"nodePath":"root/Spatial/MeshInstance/MeshInstanceCollision","shapeType":"BoxShape","success":true}',
    });
    const result = await handleSetupCollision3D(fake.asRunner, {
      ...validBase,
      nodePath: 'root/Spatial/MeshInstance',
      collisionType: 'box',
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.nodePath).toBe('root/Spatial/MeshInstance/MeshInstanceCollision');
    expect(parsed.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleSetupJoint3D
// ---------------------------------------------------------------------------

describe('handleSetupJoint3D', () => {
  it('rejects parentPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleSetupJoint3D(fake.asRunner, {
      ...validBase,
      parentPath: '../escape',
    });
    expectErrorMatching(result, /parentPath/i);
  });

  it('calls runner for successful setup joint 3D', async () => {
    const fake = createFakeRunner({
      stdout: '{"nodePath":"root/Spatial/PinJoint","name":"PinJoint","jointType":"PinJoint","success":true}',
    });
    const result = await handleSetupJoint3D(fake.asRunner, {
      ...validBase,
      parentPath: 'root/Spatial',
      jointType: 'PinJoint',
      name: 'PinJoint',
      nodeA: 'root/Spatial/BodyA',
      nodeB: 'root/Spatial/BodyB',
      position: { x: 0, y: 1.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.nodePath).toBe('root/Spatial/PinJoint');
    expect(parsed.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleGenerateGuiHierarchy
// ---------------------------------------------------------------------------

describe('handleGenerateGuiHierarchy', () => {
  it('rejects parentPath containing ..', async () => {
    const fake = createFakeRunner();
    const result = await handleGenerateGuiHierarchy(fake.asRunner, {
      ...validBase,
      parentPath: '../escape',
      hierarchy: { type: 'Panel', name: 'MainPanel' },
    });
    expectErrorMatching(result, /parentPath/i);
  });

  it('rejects missing or invalid hierarchy', async () => {
    const fake = createFakeRunner();
    const result = await handleGenerateGuiHierarchy(fake.asRunner, {
      ...validBase,
      parentPath: 'root',
    });
    expectErrorMatching(result, /hierarchy/i);
  });

  it('calls runner for successful GUI hierarchy generation', async () => {
    const fake = createFakeRunner({
      stdout: '{"scene_path":"scenes/main.tscn","parent_path":"root","root_node_name":"MainPanel","root_node_path":"root/MainPanel","success":true}',
    });
    const result = await handleGenerateGuiHierarchy(fake.asRunner, {
      ...validBase,
      parentPath: 'root',
      hierarchy: {
        type: 'Panel',
        name: 'MainPanel',
        anchorPreset: 'full_rect',
        children: [
          {
            type: 'Button',
            name: 'PlayButton',
            minSize: { x: 100, y: 40 },
          },
        ],
      },
    });
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.root_node_path).toBe('root/MainPanel');
    expect(parsed.success).toBe(true);
  });
});




