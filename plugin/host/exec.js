import { spawn } from 'node:child_process'

/**
 * 跑一条外部命令，收齐 stdout，失败/超时抛错。
 * stdout 是 Buffer：截图要走二进制，不能当字符串收。
 */
export function run(command, args, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, { windowsHide: true })
    } catch (error) {
      reject(new Error(`无法执行 ${command}：${error.message}`))
      return
    }

    const stdout = []
    const stderr = []
    let settled = false
    const finish = (settle, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      settle(value)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(reject, new Error(`${command} 超时（${timeout}ms）`))
    }, timeout)

    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', (error) => {
      const hint = error.code === 'ENOENT' ? `（找不到 ${command}，检查插件配置里的路径）` : ''
      finish(reject, new Error(`无法执行 ${command}${hint}：${error.message}`))
    })
    child.on('close', (code) => {
      const out = Buffer.concat(stdout)
      if (code === 0) {
        finish(resolve, out)
        return
      }
      const detail = Buffer.concat(stderr).toString('utf8').trim().slice(0, 400)
      finish(reject, new Error(`${command} 退出码 ${code}${detail ? `：${detail}` : ''}`))
    })
  })
}
