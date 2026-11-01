import platform from './platform.ts'
import { execFile, spawn, type ChildProcess, type ExecFileOptions, type ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Ambient owner tag (e.g. an export job id). Long-running tasks enter it once
 * (`processOwner.enterWith(jobId)`); every child spawned downstream registers
 * itself so the whole tree can be cancelled without threading handles through
 * a dozen call sites.
 */
export const processOwner = new AsyncLocalStorage<string>()

const liveChildren = new Map<string, Set<ChildProcess>>()
// Owners that have been cancelled: any child spawned afterwards is killed on
// sight, so internal fallbacks cannot start fresh work after cancellation.
const killedOwners = new Set<string>()
const ownedCancellations = new Map<string, Set<() => void>>()

/** Third-party renderers spawn their own children; cancel through their API too. */
export function registerOwnedCancellation(cancel: () => void): () => void {
  const owner = processOwner.getStore()
  if (!owner) return () => {}
  if (killedOwners.has(owner)) { cancel(); return () => {} }
  let callbacks = ownedCancellations.get(owner)
  if (!callbacks) ownedCancellations.set(owner, callbacks = new Set())
  callbacks.add(cancel)
  return () => {
    callbacks!.delete(cancel)
    if (!callbacks!.size) ownedCancellations.delete(owner)
  }
}

export function isProcessOwnerCancelled() {
  const owner = processOwner.getStore()
  return Boolean(owner && killedOwners.has(owner))
}

/**
 * Signal the child's whole process group (children are spawned detached when an
 * owner is present, so the child is the group leader). Falls back to signaling
 * the direct child when the group is gone or the platform has no groups.
 * Export chains like 服务→准备 worker→FFmpeg must die as a tree, not one link.
 */
function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if(child.pid && process.platform==='win32'){platform.killTree(child.pid,signal);return;}
  try {
    if (child.pid && process.platform !== 'win32') {
      process.kill(-child.pid, signal)
      return
    }
  } catch { /* group gone or not a leader — signal the direct child */ }
  try { child.kill(signal) } catch { /* already gone */ }
}

/** SIGTERM every live child owned by `owner`, escalating to SIGKILL. Returns count. */
export function killOwnedProcesses(owner: string): number {
  killedOwners.add(owner)
  const callbacks = ownedCancellations.get(owner)
  ownedCancellations.delete(owner)
  for (const cancel of callbacks || []) { try { cancel() } catch { /* still kill owned children */ } }
  const children = liveChildren.get(owner)
  if (!children?.size) return 0
  for (const child of children) {
    signalProcessTree(child, 'SIGTERM')
    const timer = setTimeout(() => signalProcessTree(child, 'SIGKILL'), 2_000)
    timer.unref()
  }
  liveChildren.delete(owner)
  return children.size
}

/** Clear the kill mark (e.g. an export retry) so the owner may spawn again. */
export function resetProcessOwnerKill(owner: string): void {
  killedOwners.delete(owner)
}

/**
 * Register a raw `spawn()` child under the ambient owner. Children of a killed
 * owner are SIGTERMed immediately instead of being tracked.
 */
export function trackChildProcess(child: ChildProcess): void {
  const owner = processOwner.getStore()
  if (!owner) return
  if (killedOwners.has(owner)) {
    signalProcessTree(child, 'SIGTERM')
    return
  }
  let owned = liveChildren.get(owner)
  if (!owned) liveChildren.set(owner, (owned = new Set()))
  owned.add(child)
  child.once('close', () => {
    const set = liveChildren.get(owner)
    if (set?.delete(child) && !set.size) liveChildren.delete(owner)
  })
}

function trackOwned(child: ChildProcess): string | undefined {
  const owner = processOwner.getStore()
  if (!owner) return undefined
  if (killedOwners.has(owner)) {
    signalProcessTree(child, 'SIGTERM')
    return undefined
  }
  let owned = liveChildren.get(owner)
  if (!owned) liveChildren.set(owner, (owned = new Set()))
  owned.add(child)
  return owner
}

function untrackOwned(owner: string | undefined, child: ChildProcess): void {
  if (!owner) return
  const owned = liveChildren.get(owner)
  if (owned?.delete(child) && !owned.size) liveChildren.delete(owner)
}

/**
 * promisify(execFile) replacement that registers the child under the ambient
 * process owner, so export cancellation reaches plain execFile call sites too.
 */
export function execFileAsync(
  file: string,
  args: readonly string[] = [],
  options: ExecFileOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  // Owned children lead their own process group so cancellation kills the tree.
  const detach = processOwner.getStore() !== undefined && process.platform !== 'win32'
  // detached is honoured at runtime (execFile forwards options to spawn) but is
  // missing from the ExecFileOptions type — hence the cast.
  const execOptions = { encoding: 'utf8', ...options, detached: detach } as unknown as ExecFileOptionsWithStringEncoding
  return new Promise((resolve, reject) => {
    const child = execFile(file, args as string[], execOptions, (error, stdout, stderr) => {
      untrackOwned(owner, child)
      if (error) reject(error)
      else resolve({ stdout, stderr })
    })
    const owner = trackOwned(child)
  })
}

export type ClosedStdinProcessOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  maxBuffer?: number;
  inactivityTimeout?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

/**
 * Run a non-interactive child process with stdin connected to the null device.
 *
 * `execFile()` creates a piped stdin and leaves it open. Commands such as
 * `codex exec` deliberately read piped stdin as extra prompt context, so an
 * otherwise non-interactive invocation can wait forever for EOF. Using
 * `stdio: ["ignore", ...]` makes EOF immediate without touching any unrelated
 * desktop or CLI processes.
 */
export function runWithClosedStdin(
  executable: string,
  args: string[],
  options: ClosedStdinProcessOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const maxBuffer = options.maxBuffer ?? 16 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      // Owned children lead their own process group so cancellation kills the tree.
      detached: processOwner.getStore() !== undefined && process.platform !== 'win32',
    });
    const owner = trackOwned(child);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let terminalError: Error | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let inactivityTimer: NodeJS.Timeout | undefined;

    const armInactivityTimer = () => {
      if (!options.inactivityTimeout) return;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        terminalError = new Error(`子进程超过 ${options.inactivityTimeout}ms 没有产生新进度，已终止`);
        signalProcessTree(child, "SIGTERM");
        forceKillTimer = setTimeout(() => signalProcessTree(child, "SIGKILL"), 2_000);
        forceKillTimer.unref();
      }, options.inactivityTimeout);
      inactivityTimer.unref();
    };
    armInactivityTimer();

    const timeoutTimer = options.timeout
      ? setTimeout(() => {
          terminalError = new Error(`子进程运行超过 ${options.timeout}ms，已终止`);
          signalProcessTree(child, "SIGTERM");
          forceKillTimer = setTimeout(() => signalProcessTree(child, "SIGKILL"), 2_000);
          forceKillTimer.unref();
        }, options.timeout)
      : undefined;
    timeoutTimer?.unref();

    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (inactivityTimer) clearTimeout(inactivityTimer);
      untrackOwned(owner, child);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    };
    const stopForBuffer = (stream: "stdout" | "stderr") => {
      terminalError = new Error(`${stream} 超过 ${maxBuffer} 字节上限，已终止子进程`);
      signalProcessTree(child, "SIGTERM");
    };
    // A throwing progress callback (e.g. cooperative export cancellation) must
    // become this promise's rejection with the child cleaned up — letting it
    // escape the EventEmitter data handler would crash the whole service.
    const runCallback = (callback: ((chunk: string) => void) | undefined, chunk: Buffer) => {
      if (!callback) return;
      try {
        callback(chunk.toString("utf8"));
      } catch (error) {
        terminalError ||= error instanceof Error ? error : new Error(String(error));
        signalProcessTree(child, "SIGTERM");
      }
    };

    child.stdout.on("data", (value: Buffer | string) => {
      armInactivityTimer();
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maxBuffer) {
        stopForBuffer("stdout");
        return;
      }
      stdout.push(chunk);
      runCallback(options.onStdout, chunk);
    });
    child.stderr.on("data", (value: Buffer | string) => {
      armInactivityTimer();
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      stderrBytes += chunk.byteLength;
      if (stderrBytes > maxBuffer) {
        stopForBuffer("stderr");
        return;
      }
      stderr.push(chunk);
      runCallback(options.onStderr, chunk);
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code, signal) => {
      if (terminalError) {
        finish(terminalError);
        return;
      }
      if (code === 0) {
        finish();
        return;
      }
      const stderrText = Buffer.concat(stderr).toString("utf8").trim();
      const detail = stderrText ? `：${stderrText.slice(-2_000)}` : "";
      finish(new Error(`子进程退出码 ${code ?? "未知"}${signal ? `（${signal}）` : ""}${detail}`));
    });
  });
}
