import { spawn } from 'child_process';

const isWin = process.platform === 'win32';

function spawnProc(command: string, args: string[], label: string) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[${label}] exited via signal ${signal}`);
    } else {
      console.log(`[${label}] exited with code ${code}`);
    }
    if (code && code !== 0) process.exitCode = code;
    if (signal || (code && code !== 0)) {
      if (label === 'web' && !worker.killed) worker.kill('SIGTERM');
      if (label === 'worker' && !web.killed) web.kill('SIGTERM');
    }
  });

  return child;
}

const webCommand = isWin ? 'npm.cmd' : 'npm';
const workerCommand = isWin ? 'npm.cmd' : 'npm';

const web = spawnProc(webCommand, ['run', 'start:web'], 'web');
const worker = spawnProc(workerCommand, ['run', 'worker:instagram'], 'worker');

const shutdown = () => {
  web.kill('SIGTERM');
  worker.kill('SIGTERM');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
