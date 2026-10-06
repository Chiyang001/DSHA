import { GRID_COLS, GRID_ROWS } from './android-screen-targets.js'

function badgeSvg(index) {
  const label = String(index)
  const width = Math.max(34, 16 + label.length * 10)
  return Buffer.from(
    `<svg width="${width}" height="28" xmlns="http://www.w3.org/2000/svg">`
    + `<rect x="0" y="0" width="${width}" height="28" rx="8" fill="#ff3b30" fill-opacity="0.92"/>`
    + `<text x="${width / 2}" y="19" text-anchor="middle" fill="white" font-size="15" `
    + `font-family="sans-serif" font-weight="700">${label}</text></svg>`,
  )
}

function gridSvg(width, height) {
  const cellWidth = width / GRID_COLS
  const cellHeight = height / GRID_ROWS
  let content = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
  content += `<rect x="0" y="0" width="${width}" height="${height}" fill="none"/>`
  for (let col = 0; col <= GRID_COLS; col += 1) {
    const x = Math.round(col * cellWidth)
    content += `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#4da3ff" stroke-opacity="0.22" stroke-width="1"/>`
  }
  for (let row = 0; row <= GRID_ROWS; row += 1) {
    const y = Math.round(row * cellHeight)
    content += `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#4da3ff" stroke-opacity="0.22" stroke-width="1"/>`
  }
  content += `<text x="12" y="24" fill="#4da3ff" fill-opacity="0.8" font-size="18" font-family="sans-serif">`
    + `Grid fallback ${GRID_COLS}x${GRID_ROWS}: col 0 left, row 0 top</text>`
  content += '</svg>'
  return Buffer.from(content)
}

export async function annotateScreenshot(inputPath, targets, width, height) {
  const sharp = (await import('sharp')).default
  const outputPath = inputPath.replace(/\.png$/i, '-annotated.png')
  const overlays = [{
    input: gridSvg(width, height),
    top: 0,
    left: 0,
  }]
  for (const target of targets) {
    const badge = badgeSvg(target.index)
    overlays.push({
      input: badge,
      top: Math.max(0, Math.min(height - 28, target.tapY - 14)),
      left: Math.max(0, Math.min(width - 34, target.tapX - 17)),
    })
  }
  await sharp(inputPath).composite(overlays).png().toFile(outputPath)
  return outputPath
}
