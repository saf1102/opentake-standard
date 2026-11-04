const path = require('node:path');
const {randomUUID} = require('node:crypto');

// cmd parses a batch invocation once, then a typical npm shim expands %*.
// Protect both passes. Percent signs travel through a private, single-pass
// environment expansion so names such as %PATH% remain literal data.
const meta = /[()[\]%!^"`<>&|;, *?]/g;
const caret = value => value.replace(meta, char => '^' + char);
function quoteArgument(value) {
 let result = '"', slashes = 0;
 for (const char of value) {
  if (char === '\\') { slashes++; continue; }
  result += '\\'.repeat(char === '"' ? slashes * 2 + 1 : slashes) + char;
  slashes = 0;
 }
 return result + '\\'.repeat(slashes * 2) + '"';
}
function agentLaunch(file, args = [], options = {}, platform = process.platform) {
 if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return {file, args: [...args], options: {...options, shell: false}};
 if (typeof file !== 'string' || [file, ...args].some(value => typeof value !== 'string' || /[\r\n\0]/.test(value))) throw Error('程序路径和命令参数不能包含换行或空字符');
 const env = {...(options.env || process.env)};
 const percent = 'OPENTAKE_LITERAL_' + randomUUID().replaceAll('-', '');
 env[percent] = '%';
 const protectPercent = value => value.replaceAll('%', '%' + percent + '%');
 const command = [protectPercent(caret(path.win32.normalize(file))), ...args.map(value => protectPercent(caret(caret(quoteArgument(value)))))].join(' ');
 const systemRoot = Object.entries(env).find(([key]) => key.toLowerCase() === 'systemroot')?.[1] || 'C:\\Windows';
 return {file: path.win32.join(systemRoot, 'System32', 'cmd.exe'), args: ['/d', '/s', '/v:off', '/c', '"' + command + '"'], options: {...options, env, shell: false, windowsVerbatimArguments: true}};
}
module.exports = {agentLaunch, quoteArgument};
