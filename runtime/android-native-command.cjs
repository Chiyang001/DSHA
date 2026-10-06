const http = require('node:http')

function bridgeCall(method, fields, signal) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, ...fields })
    const request = http.request({
      hostname: '127.0.0.1',
      port: 3981,
      path: '/rpc',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-bridge-token': process.env.DSH_ANDROID_BRIDGE_TOKEN,
      },
      signal,
    }, response => {
      let data = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        data += chunk
        if (data.length > 16384) request.destroy(new Error('Android bridge response too large'))
      })
      response.on('error', reject)
      response.on('end', () => {
        try {
          const result = JSON.parse(data)
          if (response.statusCode !== 200) throw new Error(result.error || `Android bridge HTTP ${response.statusCode}`)
          resolve(result)
        } catch (error) { reject(error) }
      })
    })
    request.setTimeout(10000, () => request.destroy(new Error('Android bridge timed out')))
    request.on('error', reject)
    request.end(body)
  })
}

async function callPath(method, path, signal, fields = {}) {
  if (signal?.aborted) {
    const error = new Error('Aborted')
    error.name = 'AbortError'
    throw error
  }
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0') || path.length > 4096)
    throw new TypeError('Expected an absolute Android file path')
  return bridgeCall(method, { path, ...fields }, signal)
}

exports.openNativeTextFile = async (path, signal) => { await callPath('openTextFile', path, signal) }
exports.openNativePath = async (path, signal) => { await callPath('openFile', path, signal) }
exports.openNativeAssociatedPath = exports.openNativePath
exports.nativeFileApplications = async (path, signal) => (await callPath('fileApplications', path, signal)).applications
exports.openNativeFileApplication = async (path, application, signal) => {
  if (typeof application !== 'string' || !application) throw new TypeError('Expected an application identifier')
  await callPath('openFile', path, signal, { application })
}
exports.canOpenNativePath = () => true
