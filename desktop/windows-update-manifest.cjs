// Windows installers have their own feed; never accept a macOS/source download.
const {REPOSITORY:repository,desktopTag}=require('./release-contract.cjs');
const endpoint = `https://github.com/${repository}/releases/latest/download/windows-update.json`;
const validVersion = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
function windowsRelease(value) {
  if (!value || value.schemaVersion !== 1 || value.product !== 'opentake-standard' || value.platform !== 'win32' || value.arch !== 'x64' || value.channel !== 'stable' || !validVersion(value.version) || !Number.isSafeInteger(value.windowsBuild) || value.windowsBuild < 1 || typeof value.notes !== 'string' || value.notes.length > 16000 || typeof value.revision !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(value.revision) || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.sha256) || !Number.isSafeInteger(value.size) || value.size < 1) return null;
  const tag = desktopTag(value.version,value.windowsBuild);
  const url = `https://github.com/${repository}/releases/download/${tag}/OpenTake-Standard-Setup-${value.version}-x64.exe`;
  if (value.url !== url) return null;
  return {schemaVersion:1, product:'opentake-standard', platform:'win32', arch:'x64', channel:'stable', version:value.version, windowsBuild:value.windowsBuild, revision:value.revision, notes:value.notes, url, sha256:value.sha256.toLowerCase(), size:value.size};
}
function newerWindows(release, currentVersion, currentBuild) {
  if (!validVersion(currentVersion)) return false;
  const left = release.version.split('.').map(BigInt), right = currentVersion.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i];
  return release.windowsBuild > currentBuild;
}
module.exports = {repository, endpoint, windowsRelease, newerWindows};
