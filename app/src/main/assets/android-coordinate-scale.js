const NORMALIZED_MAX_PIXELS = 4194304
const NORMALIZED_MAX_DIMENSION = 8192
const PATCH_SIZE = 14
const DOWNSAMPLE_RATIO = 3
const MAX_IMAGE_TOKENS = 1024
const CELL_SIZE = PATCH_SIZE * DOWNSAMPLE_RATIO

function requestImageDimensions(width, height, maxPixels) {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)))
  if (scale === 1) return { width, height }
  if (width >= height) {
    let projectedWidth = Math.max(1, Math.floor(width * scale))
    let projectedHeight = Math.max(1, Math.round(projectedWidth * height / width))
    while (projectedWidth * projectedHeight > maxPixels && projectedWidth > 1) {
      projectedWidth -= 1
      projectedHeight = Math.max(1, Math.round(projectedWidth * height / width))
    }
    return { width: projectedWidth, height: projectedHeight }
  }
  let projectedHeight = Math.max(1, Math.floor(height * scale))
  let projectedWidth = Math.max(1, Math.round(projectedHeight * width / height))
  while (projectedWidth * projectedHeight > maxPixels && projectedHeight > 1) {
    projectedHeight -= 1
    projectedWidth = Math.max(1, Math.round(projectedHeight * width / height))
  }
  return { width: projectedWidth, height: projectedHeight }
}

function normalizedDimensions(width, height) {
  const budgeted = requestImageDimensions(width, height, NORMALIZED_MAX_PIXELS)
  const longEdge = Math.max(budgeted.width, budgeted.height)
  if (longEdge <= NORMALIZED_MAX_DIMENSION) return budgeted
  const scale = NORMALIZED_MAX_DIMENSION / longEdge
  return {
    width: Math.max(1, Math.floor(budgeted.width * scale)),
    height: Math.max(1, Math.floor(budgeted.height * scale)),
  }
}

const intDiv = (value, divisor) => Math.floor(value / divisor)
const ceilDiv = (value, divisor) => Math.floor((value + divisor - 1) / divisor)

function gridTokens(gridHeight, gridWidth) {
  return gridHeight * (gridWidth + 1) + 2
}

function gridCells(paddedLength) {
  return ceilDiv(intDiv(paddedLength, PATCH_SIZE), DOWNSAMPLE_RATIO)
}

function solveResizeRatio(height, width, budget) {
  const aspect = height / width
  const idealGridWidth = Math.sqrt((budget - 2) / aspect + 0.25) - 0.5
  const idealGridHeight = idealGridWidth * aspect
  let bestHeight
  let bestWidth
  if (idealGridWidth < 1) {
    bestWidth = CELL_SIZE
    bestHeight = intDiv(budget - 2, 2) * CELL_SIZE
  } else if (idealGridHeight < 1) {
    bestWidth = (intDiv(budget - 2, 1) - 1) * CELL_SIZE
    bestHeight = CELL_SIZE
  } else {
    const solvedGridWidth = Math.trunc(idealGridWidth)
    const solvedGridHeight = Math.trunc(idealGridHeight)
    const scale = Math.min(solvedGridWidth * CELL_SIZE / width, solvedGridHeight * CELL_SIZE / height)
    bestWidth = Math.trunc(width * scale / PATCH_SIZE) * PATCH_SIZE
    bestHeight = Math.trunc(height * scale / PATCH_SIZE) * PATCH_SIZE
  }
  return { bestWidth, bestHeight }
}

function longEdgeDimensions(width, height, longEdge) {
  if (longEdge >= Math.max(width, height)) return { width, height }
  return width >= height
    ? { width: longEdge, height: Math.max(1, Math.round(longEdge * height / width)) }
    : { width: Math.max(1, Math.round(longEdge * width / height)), height: longEdge }
}

function deepSeekRequestImageDimensions(width, height) {
  const paddedWidth = ceilDiv(width, PATCH_SIZE) * PATCH_SIZE
  const paddedHeight = ceilDiv(height, PATCH_SIZE) * PATCH_SIZE
  if (gridTokens(gridCells(paddedHeight), gridCells(paddedWidth)) <= MAX_IMAGE_TOKENS) {
    return { width, height }
  }
  const solved = solveResizeRatio(height, width, MAX_IMAGE_TOKENS)
  return longEdgeDimensions(width, height, width >= height ? solved.bestWidth : solved.bestHeight)
}

export function visionDimensions(captureWidth, captureHeight) {
  const normalized = normalizedDimensions(captureWidth, captureHeight)
  return deepSeekRequestImageDimensions(normalized.width, normalized.height)
}

function scaleAxis(value, sourceSize, deviceSize) {
  if (sourceSize <= 0) return value
  return Math.max(0, Math.min(deviceSize, Math.round(value * deviceSize / sourceSize)))
}

export function scalePoint(x, y, device, vision) {
  if (device.width === vision.width && device.height === vision.height) {
    return { x, y }
  }
  if (x > vision.width || y > vision.height) {
    return { x, y }
  }
  return {
    x: scaleAxis(x, vision.width, device.width),
    y: scaleAxis(y, vision.height, device.height),
  }
}
