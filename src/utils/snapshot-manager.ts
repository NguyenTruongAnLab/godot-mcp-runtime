import { promises as fs, existsSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Resolve the absolute path of a scene or resource in the project.
 * Converts res:// paths and relative paths to absolute filesystem paths.
 */
export function getAbsoluteScenePath(projectPath: string, scenePath: string): string {
  let cleanPath = scenePath;
  if (cleanPath.startsWith('res://')) {
    cleanPath = cleanPath.substring(6);
  }
  return resolve(projectPath, cleanPath);
}

/**
 * Manages offline backups and transaction rollbacks for scene/node operations.
 */
export class SnapshotManager {
  static getBackupDir(projectPath: string): string {
    return join(projectPath, '.mcp', 'backups');
  }

  /**
   * Creates a backup of the target scene or resource file under .mcp/backups/.
   * Enforces a rolling limit of the last 20 backups.
   */
  static async createBackup(projectPath: string, scenePath: string): Promise<string | null> {
    try {
      const absolutePath = getAbsoluteScenePath(projectPath, scenePath);
      if (!existsSync(absolutePath)) {
        return null;
      }
      const backupDir = this.getBackupDir(projectPath);
      await fs.mkdir(backupDir, { recursive: true });

      const fileContent = await fs.readFile(absolutePath);
      const timestamp = Date.now();
      // Replace path separators and characters to create a clean, safe filename
      const safeName = encodeURIComponent(scenePath.replace(/[:\/\\?]/g, '_'));
      const backupPath = join(backupDir, `${safeName}_${timestamp}.bak`);
      
      await fs.writeFile(backupPath, fileContent);
      
      // Keep backups bounded
      await this.pruneBackups(projectPath);

      return backupPath;
    } catch (e) {
      console.error('[SnapshotManager] Failed to create backup:', e);
      return null;
    }
  }

  /**
   * Reverts the scene/resource file to its pre-mutation state from the backup.
   */
  static async rollback(projectPath: string, scenePath: string, backupPath: string): Promise<boolean> {
    try {
      const absolutePath = getAbsoluteScenePath(projectPath, scenePath);
      if (!existsSync(backupPath)) {
        return false;
      }
      const fileContent = await fs.readFile(backupPath);
      await fs.writeFile(absolutePath, fileContent);
      
      // Clean up the backup file after rollback
      try {
        await fs.unlink(backupPath);
      } catch {
        // Ignore deletion failures
      }
      return true;
    } catch (e) {
      console.error('[SnapshotManager] Rollback failed:', e);
      return false;
    }
  }

  /**
   * Prunes older backups to maintain a maximum of 20 backups.
   */
  private static async pruneBackups(projectPath: string): Promise<void> {
    try {
      const backupDir = this.getBackupDir(projectPath);
      if (!existsSync(backupDir)) return;
      const files = await fs.readdir(backupDir);
      const bakFiles = files.filter(f => f.endsWith('.bak')).map(f => ({
        name: f,
        path: join(backupDir, f)
      }));

      if (bakFiles.length <= 20) {
        return;
      }

      // Read stats to sort by modified time
      const stats = await Promise.all(
        bakFiles.map(async f => {
          const s = await fs.stat(f.path);
          return { ...f, mtime: s.mtimeMs };
        })
      );
      stats.sort((a, b) => a.mtime - b.mtime);

      // Delete the oldest files exceeding the limit
      const toDelete = stats.slice(0, stats.length - 20);
      for (const f of toDelete) {
        await fs.unlink(f.path);
      }
    } catch (e) {
      console.error('[SnapshotManager] Pruning failed:', e);
    }
  }
}
