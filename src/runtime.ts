import { spawn, type ChildProcess } from 'node:child_process';

const children = new Set<ChildProcess>();
let shuttingDown = false;
let worker: ChildProcess | undefined;

function start(entrypoint: string, label: string): ChildProcess {
  const child = spawn(process.execPath, [entrypoint], { env: process.env, stdio: 'inherit' });
  children.add(child);
  child.once('error', (error) => console.error(JSON.stringify({ level: 'error', service: label, error: error.message })));
  child.once('exit', () => children.delete(child));
  return child;
}

function startWorker(): void {
  if (shuttingDown) return;
  worker = start('dist/worker.js', 'worker');
  worker.once('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(JSON.stringify({ level: 'error', service: 'worker', code, signal, message: 'Worker stopped; restarting in 30 seconds' }));
    setTimeout(startWorker, 30_000);
  });
}

function stop(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill(signal);
  setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
  }, 10_000).unref();
}

process.once('SIGTERM', () => stop('SIGTERM'));
process.once('SIGINT', () => stop('SIGINT'));

startWorker();
const server = start('dist/server.js', 'web');
server.once('exit', (code, signal) => {
  if (!shuttingDown) {
    console.error(JSON.stringify({ level: 'error', service: 'web', code, signal, message: 'Web server stopped' }));
    stop('SIGTERM');
  }
  process.exitCode = code ?? (signal ? 1 : 0);
});
