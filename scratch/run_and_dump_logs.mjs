import { GodotRunner } from './dist/utils/godot-runner.js';

async function runAndDump() {
  const runner = new GodotRunner({
    godotPath: 'c:/Users/nguytruo/Documents/Github/vie-grabBike/Godot/Godot_v3.6.2-stable_win64.exe'
  });
  const projectPath = 'c:/Users/nguytruo/Documents/Github/vie-grabBike/Godot/Godot-MCP/Game';

  console.log('Running project to dump logs...');
  try {
    const process = await runner.runProject(projectPath, undefined, false, 9902);
    console.log('Process spawned. Waiting 5 seconds...');
    await new Promise(r => setTimeout(r, 5000));
  } catch (err) {
    console.error('Failed to run:', err);
  } finally {
    console.log('\n--- CAPTURED STDOUT ---');
    console.log(runner.activeProcess?.output.join('\n') || 'None');

    console.log('\n--- CAPTURED STDERR ---');
    console.log(runner.activeProcess?.errors.join('\n') || 'None');

    await runner.stopProject();
    console.log('Project stopped.');
  }
}

runAndDump();
