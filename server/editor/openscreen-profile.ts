import path from "node:path";
import { findProject } from "./store.ts";
import { openScreenProfile } from "./openscreen.ts";
import { legacyWindowsHud } from "./openscreen-platform.ts";

/** Each macOS project owns the native app profile scanned by this host. */
export function openScreenProjectProfile(projectId: string) {
  const { dir } = findProject(projectId, true);
  if (process.platform === "win32" && legacyWindowsHud) return undefined;
  const explicit = openScreenProfile();
  if (process.platform === "win32") return explicit;
  return explicit ? path.join(explicit, projectId) : path.join(dir, "analysis", "openscreen", "native-profile");
}

