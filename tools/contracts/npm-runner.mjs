import { execFileSync } from 'node:child_process'

function formatOutput(value) {
  if (value === undefined || value === null) return ''
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value)
  return text.trim()
}

export function runNpm(args, options = {}) {
  const npmCli = process.env.npm_execpath
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const commandArgs = npmCli ? [npmCli, ...args] : args
  try {
    return execFileSync(command, commandArgs, {
      cwd: options.cwd,
      encoding: options.encoding ?? 'utf8',
      maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        ...options.env,
      },
      shell: !npmCli && process.platform === 'win32',
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const details = [formatOutput(error.stdout), formatOutput(error.stderr)].filter(Boolean).join('\n')
    throw new Error(`npm ${args.join(' ')} failed${details ? `:\n${details}` : ''}`, { cause: error })
  }
}
