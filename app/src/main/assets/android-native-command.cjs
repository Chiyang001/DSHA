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

async function openNativePath(path, signal) {
  if (signal?.aborted) {
    const error = new Error('Aborted')
    error.name = 'AbortError'
    throw error
  }
  await bridgeCall('openTextFile', { path }, signal)
}

exports.openNativeTextFile = openNativePath
exports.openNativePath = openNativePath
exports.canOpenNativePath = () => true
