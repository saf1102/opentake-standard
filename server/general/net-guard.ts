/**
 * 联网 lets the agent find material online (pictures, sound, music, data), never software (S先生 2026-10-26: 下载软件、
 * 插件、代码这些在后台关闭). Three layers, whether the switch is on or off:
 * - the package managers are offline and point nowhere, and git reaches only local files;
 * - their commands in the agent's PATH refuse at once;
 * - after every turn, anything in the film folder that is software (installers, archives, programs, package folders,
 *   code libraries other than the kit's own) is moved aside to agent/blocked/, not deleted, and named in the conversation.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const NOWHERE = 'http://127.0.0.1:9/';
/** Environment that keeps package managers from fetching anything. */
export const OFFLINE_PACKAGES: NodeJS.ProcessEnv = {
  npm_config_offline: 'true', npm_config_registry: NOWHERE, npm_config_audit: 'false', npm_config_fund: 'false',
  YARN_ENABLE_NETWORK: '0', YARN_NPM_REGISTRY_SERVER: NOWHERE, BUN_CONFIG_REGISTRY: NOWHERE,
  PIP_NO_INDEX: '1', PIP_INDEX_URL: NOWHERE, PIP_DISABLE_PIP_VERSION_CHECK: '1', UV_OFFLINE: '1', UV_INDEX_URL: NOWHERE,
  CARGO_NET_OFFLINE: 'true', GOPROXY: 'off', GOFLAGS: '-mod=mod', GEM_HOST: NOWHERE,
  HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_FROM_API: '1',
  // git may read the folder, not clone or fetch from anywhere
  GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0',
};
/** Commands that install or fetch software; in the agent's PATH they refuse. */
export const REFUSED_COMMANDS = ['npm', 'npx', 'pnpm', 'pnpx', 'yarn', 'bun', 'bunx', 'pip', 'pip3', 'pipx', 'uv', 'uvx', 'conda', 'mamba', 'brew', 'port', 'gem', 'cargo', 'go', 'deno', 'installer', 'softwareupdate'];
export const refusal = (name: string) => `#!/bin/sh\necho "OpenTake：出片时不能下载或安装软件、插件、代码（${name}）。要找素材可以直接下载图片、音频、数据文件。" >&2\nexit 126\n`;

const PACKAGE_DIRS = new Set(['node_modules', '.git', 'site-packages', '__pypackages__', '.venv', 'venv', 'bower_components', 'jspm_packages']);
const PACKAGE_FILES = /\.(zip|tar|tgz|gz|bz2|xz|7z|rar|whl|egg|dmg|pkg|mpkg|app|exe|msi|deb|rpm|jar|crx|xpi|vsix|dylib|so|node|wasm)$/i;
const CODE = /\.(m?js|cjs|py|sh|rb|pl|php|lua)$/i;
/** Folders the agent's own work lives in, or ours: not looked at. */
const SKIP = new Set(['.tmp', '.tmp-look', '.opentake', 'look', 'render', 'out']);

const hash = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function binary(file: string) {
  try {
    const fd = fs.openSync(file, 'r'), head = Buffer.alloc(4);
    fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
    const m = head.readUInt32BE(0);
    // Mach-O (both byte orders, 32/64-bit, universal) and ELF
    return [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0x7f454c46].includes(m);
  } catch { return false; }
}

/**
 * Move the software found in `work` to `dest`. Code is allowed where the agent writes its own (the pages and their
 * folders); a code library in assets/ or vendor/ must be one we allow (`allowed`: sha256 of the copies that are fine).
 */
export function quarantineSoftware(work: string, dest: string, allowed: string[] = KEPT_LIBRARIES) {
  const ok = new Set(allowed);
  const moved: string[] = [];
  const move = (rel: string) => {
    const target = path.join(dest, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(path.join(work, rel), fs.existsSync(target) ? `${target}.${Date.now()}` : target);
    moved.push(rel);
  };
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(work, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!dir && SKIP.has(entry.name)) continue;
        if (PACKAGE_DIRS.has(entry.name) || /\.(app|framework|bundle)$/i.test(entry.name)) { move(rel); continue; }
        walk(rel); continue;
      }
      const top = rel.split('/')[0];
      if (PACKAGE_FILES.test(entry.name) || binary(path.join(work, rel))) { move(rel); continue; }
      if (CODE.test(entry.name) && (top === 'assets' || top === 'vendor') && !ok.has(hash(path.join(work, rel)))) move(rel);
    }
  };
  if (fs.existsSync(work)) walk('');
  return moved;
}

/**
 * Code libraries a film may keep in vendor/ (sha256): GSAP 3.15.0's gsap.min.js, which HF.md had films copy until
 * S先生 dropped GSAP on 10-26 for its licence. Films made before keep their copy; new pages animate with CSS.
 */
export const KEPT_LIBRARIES = ['92bb9a96476f983d212a2bc4f54c889039c1696dd4461d40a736860938570fbb'];
