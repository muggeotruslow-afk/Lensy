const MIN_CAPTURE_HEIGHT_CSS_PX = 40

function captureTooSmallError() {
  const error = new Error('Capture region is too small')
  error.code = 'CAPTURE_TOO_SMALL'
  return error
}

function protectCaptureRegion(region, imageSize, scaleFactor = 1) {
  const values = [region?.x, region?.y, region?.w, region?.h, imageSize?.width, imageSize?.height]
  if (!values.every(Number.isFinite) || imageSize.width < 1 || imageSize.height < 1) {
    throw captureTooSmallError()
  }

  const rawWidth = Math.round(region.w)
  const rawHeight = Math.round(region.h)
  if (rawWidth < 1 || rawHeight < 1) throw captureTooSmallError()

  const x = Math.max(0, Math.min(Math.round(region.x), imageSize.width - 1))
  const originalY = Math.max(0, Math.min(Math.round(region.y), imageSize.height - 1))
  const width = Math.min(rawWidth, imageSize.width - x)
  const clampedHeight = Math.min(rawHeight, imageSize.height - originalY)
  if (width < 1 || clampedHeight < 1) throw captureTooSmallError()

  const safeScale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  const minimumHeight = Math.min(
    imageSize.height,
    Math.max(1, Math.round(MIN_CAPTURE_HEIGHT_CSS_PX * safeScale))
  )
  const expandedVertically = clampedHeight < minimumHeight

  if (!expandedVertically) {
    return { x, y: originalY, width, height: clampedHeight, expandedVertically: false }
  }

  const centerY = originalY + clampedHeight / 2
  const y = Math.max(0, Math.min(
    Math.round(centerY - minimumHeight / 2),
    imageSize.height - minimumHeight
  ))

  return { x, y, width, height: minimumHeight, expandedVertically: true }
}

module.exports = { MIN_CAPTURE_HEIGHT_CSS_PX, protectCaptureRegion }
