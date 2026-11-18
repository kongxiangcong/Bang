import { fileURLToPath } from 'node:url';

export function codexHookFiles(project) {
  const script = fileURLToPath(new URL('./hook.mjs', import.meta.url));
  const ps = value => "'" + value.replaceAll("'", "''") + "'";
  const sh = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  const windows = process.platform === 'win32';
  const args = [process.execPath, script, project];
  const command = windows
    ? '& ' + args.map(ps).join(' ') + ' --context-v1'
    : args.map(sh).join(' ') + ' --context-v1';
  const hook = windows
    ? 'powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + Buffer.from(command, 'utf16le').toString('base64')
    : command;
  const hooks = JSON.stringify({
    hooks: { UserPromptSubmit: [{ hooks: [{
      type: 'command', command: hook, timeout: 30, additionalContextLimit: 0,
    }] }] },
  }, null, 2);
  return { command, hooks };
}
