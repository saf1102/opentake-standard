import platform from '../platform.ts';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  CaptureJob,
  CaptureSource,
  MediaAsset,
  OpenScreenEnvironmentStatus,
} from "../../src/types/editor.ts";
import { CaptureJobSchema, CaptureSettingsSchema } from "../../src/types/editor.ts";

const REPOSITORY = "https://github.com/getopenscreen/openscreen";
const INSTALL_URL = "https://github.com/getopenscreen/openscreen/releases";
const EXPECTED_VERSION = "2.1.2";
type LiveCapture = {
  child: ChildProcessWithoutNullStreams;
  rawProject: string;
  viaLaunchServices: boolean;
};
const live = new Map<string, LiveCapture>();
export const activeCaptureJobs = () => live.size;

/** Where to look; the defaults are this server's own environment, Homebrew's folders and both Applications folders. */
export type OpenScreenLookup = { env?: NodeJS.ProcessEnv; home?: string; binDirs?: string[]; applicationDirs?: string[] };
const executableFile = (file: string) => {
  try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); }
  catch { return false; }
};
/**
 * Every place OpenScreen may be, in order: OPENSCREEN_BIN, the first `openscreen` on PATH (as `which` finds it), Homebrew,
 * then the app in /Applications and ~/Applications. Only file names are looked at: nothing is started. The recording
 * module and Settings › 已接入的 Agent both find OpenScreen through this, so they always agree.
 */
export function openScreenExecutableCandidates({
  env = process.env,
  home = os.homedir(),
  binDirs = ["/opt/homebrew/bin", "/usr/local/bin"],
  applicationDirs = ["/Applications", path.join(home, "Applications")],
}: OpenScreenLookup = {}) {
  if(process.platform==='win32'){
    const dirs=String(env.PATH||env.Path||'').split(path.delimiter).filter(dir=>path.isAbsolute(dir));
    return [...new Set([env.OPENSCREEN_BIN,...dirs.map(dir=>path.join(dir,'Openscreen.exe')),...[env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Programs'),env.ProgramFiles].filter((v):v is string=>Boolean(v)).flatMap(dir=>['Openscreen','OpenScreen','openscreen'].map(name=>path.join(dir,name,'Openscreen.exe')))].filter((v):v is string=>Boolean(v)))];
  }
  const fromPath = String(env.PATH || "").split(path.delimiter).filter((dir) => path.isAbsolute(dir))
    .map((dir) => path.join(dir, "openscreen")).find(executableFile);
  return [...new Set([
    env.OPENSCREEN_BIN,
    fromPath,
    ...binDirs.map((dir) => path.join(dir, "openscreen")),
    ...applicationDirs.flatMap((dir) => [
      path.join(dir, "Openscreen.app/Contents/MacOS/Openscreen"),
      path.join(dir, "OpenScreen.app/Contents/MacOS/OpenScreen"),
    ]),
  ].filter((value): value is string => Boolean(value)))];
}

export function findOpenScreenExecutable(lookup?: OpenScreenLookup) {
  return openScreenExecutableCandidates(lookup).find(executableFile);
}

/** An explicit test profile controls both the native app and the import scanner. */
export function openScreenProfile(env: NodeJS.ProcessEnv = process.env) {
  const value = env.OPENSCREEN_USER_DATA_DIR?.trim();
  if (!value) return undefined;
  if (!path.isAbsolute(value)) throw new Error("OPENSCREEN_USER_DATA_DIR 必须是绝对路径");
  return path.normalize(value);
}

export function openScreenProfileArgs(env: NodeJS.ProcessEnv = process.env) {
  const profile = openScreenProfile(env);
  return profile ? [`--user-data-dir=${profile}`] : [];
}

export function appBundleForExecutable(executable: string) {
  const resolved = fs.realpathSync(executable);
  const marker = ".app/Contents/MacOS/";
  const index = resolved.indexOf(marker);
  return index < 0 ? undefined : resolved.slice(0, index + 4);
}

function versionOf(executable: string) {
  // The macOS application executable treats `--version` as a normal GUI
  // launch. Read the bundle metadata first so an environment refresh never
  // opens OpenScreen or leaves a background process behind.
  if (process.platform === "darwin") {
    const contentsDir = path.dirname(path.dirname(fs.realpathSync(executable)));
    const infoPlist = path.join(contentsDir, "Info.plist");
    if (fs.existsSync(infoPlist)) {
      const result = spawnSync(
        "/usr/libexec/PlistBuddy",
        ["-c", "Print :CFBundleShortVersionString", infoPlist],
        { encoding: "utf8", timeout: 3_000 },
      );
      const version = String(result.stdout || "").trim();
      if (/^\d+\.\d+(?:\.\d+)?$/.test(version)) return version;
    }
  }

  // Windows Electron GUI binaries may launch instead of printing a version.
  if(process.platform==='win32')return undefined;
  for (const args of [["--version"], ["version"], ["--help"]]) {
    const result = spawnSync(executable, args, { encoding: "utf8", timeout: 5_000 });
    const match = `${result.stdout || ""}\n${result.stderr || ""}`.match(/(?:OpenScreen|Openscreen)?\s*v?(\d+\.\d+(?:\.\d+)?)/i);
    if (match) return match[1];
  }
  return undefined;
}

function accessibilityStatus(): "granted" | "missing" | "unknown" {
  if (process.platform !== "darwin") return "unknown";
  const result = spawnSync("/usr/bin/osascript", ["-e", "tell application \"System Events\" to return UI elements enabled"], { encoding: "utf8", timeout: 5_000 });
  if (result.status !== 0) return "unknown";
  return String(result.stdout).trim() === "true" ? "granted" : "missing";
}

export function openScreenEnvironmentStatus(): OpenScreenEnvironmentStatus {
  const executable = findOpenScreenExecutable();
  const version = executable ? versionOf(executable) : undefined;
  const supported = Boolean(version && /^2\.1\.2$/.test(version));
  return {
    installed: Boolean(executable), executable, version, supported,
    expectedVersion: EXPECTED_VERSION, repository: REPOSITORY, installUrl: INSTALL_URL,
    permissions: {
      screenRecording: executable ? "unknown" : "missing",
      accessibility: accessibilityStatus(),
      systemAudio: executable ? "unknown" : "missing",
    },
    message: !executable
      ? "未检测到 OpenScreen。安装后请在系统设置中授予屏幕录制权限。"
      : supported
        ? "已检测到受支持的 OpenScreen。首次录制时 macOS 会请求屏幕录制和系统音频权限。"
        : `检测到 OpenScreen ${version || "未知版本"}，当前已验证 2.1.2。`,
  };
}

function parseNdjson(text: string) {
  return text.split(/\r?\n/).flatMap((line) => {
    try { return line.trim() ? [JSON.parse(line) as Record<string, unknown>] : []; }
    catch { return []; }
  });
}

export function sourceListFromEvents(events: Record<string, unknown>[]): CaptureSource[] {
  const final = [...events].reverse().find((event) => event.type === "done" || event.event === "done") || events.at(-1) || {};
  const root = (final.sources && typeof final.sources === "object" ? final.sources : final) as Record<string, unknown>;
  const output: CaptureSource[] = [];
  const ingest = (type: CaptureSource["type"], values: unknown) => {
    if (!Array.isArray(values)) return;
    values.forEach((raw, index) => {
      if (!raw || typeof raw !== "object") return;
      const item = raw as Record<string, unknown>;
      const id = String(item.id ?? item.sourceId ?? item.deviceId ?? index);
      const name = String(item.name ?? item.title ?? item.label ?? `${type}-${index + 1}`);
      const displayIndex = type === "display" && Number.isInteger(item.index)
        ? Number(item.index)
        : undefined;
      output.push({
        id, type, name,
        captureValue: type === "display" ? String(displayIndex ?? index) : name,
        displayIndex,
        displayId: item.displayId == null ? undefined : String(item.displayId),
        appName: item.appName == null ? undefined : String(item.appName),
        thumbnail: typeof item.thumbnail === "string" ? item.thumbnail : undefined,
      });
    });
  };
  ingest("display", root.displays ?? final.displays);
  ingest("window", root.windows ?? final.windows);
  ingest("microphone", root.microphones ?? root.audioInputs ?? final.microphones);
  return output;
}

export async function listOpenScreenSources(): Promise<CaptureSource[]> {
  const executable = findOpenScreenExecutable();
  if (!executable) throw new Error("尚未安装 OpenScreen");
  const appBundle = process.platform === "darwin" ? appBundleForExecutable(executable) : undefined;
  if (appBundle) {
    // ScreenCaptureKit attributes permission to the responsible GUI bundle.
    // A CLI spawned directly by the background LaunchAgent is denied even
    // when OpenScreen itself is authorised, so launch the signed app bundle
    // and collect the documented `sources -o` result from a temporary file.
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "linkreader-openscreen-sources-"));
    const output = path.join(folder, "sources.json");
    return new Promise((resolve, reject) => {
      const child = spawn(
        "/usr/bin/open",
        ["-n", "-W", "-a", appBundle, "--args", "sources", "--json", "-o", output],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.once("error", reject);
      child.once("close", (code) => {
        try {
          if (code || !fs.existsSync(output)) {
            throw new Error(stderr.trim() || `OpenScreen sources 退出（${code ?? "未知"}）`);
          }
          const sources = JSON.parse(fs.readFileSync(output, "utf8")) as Record<string, unknown>;
          resolve(sourceListFromEvents([{ type: "done", sources }]));
        } catch (error) {
          reject(error);
        } finally {
          fs.rmSync(folder, { recursive: true, force: true });
        }
      });
    });
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["sources", "--json"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code) return reject(new Error(stderr.trim() || `OpenScreen sources 退出（${code}）`));
      resolve(sourceListFromEvents(parseNdjson(stdout)));
    });
  });
}
