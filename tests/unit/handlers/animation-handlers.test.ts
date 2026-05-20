import { describe, it, expect } from 'vitest';
import { handleConfigureAnimation } from '../../../src/tools/animation-tools.js';
import { createFakeRunner } from '../../helpers/fake-runner.js';
import { hasError, expectErrorMatching } from '../../helpers/assertions.js';
import { fixtureProjectPath, fixtureScenePath } from '../../helpers/fixture-paths.js';

const validBase = {
  projectPath: fixtureProjectPath,
  scenePath: fixtureScenePath,
  playerPath: 'root/AnimationPlayer',
  animName: 'walk',
  length: 1.0,
  loop: true,
  tracks: [
    {
      nodePath: 'Sprite',
      property: 'position',
      keys: [
        { time: 0.0, value: { x: 0, y: 0 } },
        { time: 1.0, value: { x: 100, y: 0 } },
      ],
    },
  ],
};

describe('handleConfigureAnimation', () => {
  it('rejects missing projectPath', async () => {
    const fake = createFakeRunner();
    const result = await handleConfigureAnimation(fake.asRunner, {
      scenePath: fixtureScenePath,
      playerPath: 'root/AnimationPlayer',
      animName: 'walk',
    });
    expectErrorMatching(result, /projectPath/i);
  });

  it('rejects missing playerPath', async () => {
    const fake = createFakeRunner();
    const result = await handleConfigureAnimation(fake.asRunner, {
      projectPath: fixtureProjectPath,
      scenePath: fixtureScenePath,
      animName: 'walk',
    });
    expectErrorMatching(result, /playerPath/i);
  });

  it('rejects missing animName', async () => {
    const fake = createFakeRunner();
    const result = await handleConfigureAnimation(fake.asRunner, {
      projectPath: fixtureProjectPath,
      scenePath: fixtureScenePath,
      playerPath: 'root/AnimationPlayer',
    });
    expectErrorMatching(result, /animName/i);
  });

  it('rejects invalid tracks format', async () => {
    const fake = createFakeRunner();
    const result = await handleConfigureAnimation(fake.asRunner, {
      ...validBase,
      tracks: 'invalid' as any,
    });
    expectErrorMatching(result, /tracks must be an array/i);
  });

  it('surfaces runner exceptions as a structured MCP error response', async () => {
    const fake = createFakeRunner({ throws: new Error('boom') });
    const result = await handleConfigureAnimation(fake.asRunner, validBase);
    expectErrorMatching(result, /boom/);
  });

  it('returns parsed result on successful runner output', async () => {
    const fake = createFakeRunner({
      stdout: "Animation 'walk' configured successfully",
    });
    const result = await handleConfigureAnimation(fake.asRunner, validBase);
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain('configured successfully');
  });
});
