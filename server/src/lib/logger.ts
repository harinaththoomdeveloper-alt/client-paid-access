type Fields = Record<string, unknown>

function write(level: 'info' | 'warn' | 'error', msg: string, fields: Fields = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })
  if (level === 'error') console.error(line)
  else console.log(line)
}

export const log = {
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))
