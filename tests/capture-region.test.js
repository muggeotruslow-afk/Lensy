const test = require('node:test')
const assert = require('node:assert/strict')

const { protectCaptureRegion } = require('../lib/capture-region')

test('expands a short selection to 40 CSS pixels around its center', () => {
  assert.deepEqual(
    protectCaptureRegion(
      { x: 100, y: 200, w: 600, h: 20 },
      { width: 1920, height: 1080 },
      1
    ),
    { x: 100, y: 190, width: 600, height: 40, expandedVertically: true }
  )
})

test('scales minimum protected height with the screenshot scale factor', () => {
  assert.deepEqual(
    protectCaptureRegion(
      { x: 200, y: 400, w: 800, h: 40 },
      { width: 3840, height: 2160 },
      2
    ),
    { x: 200, y: 380, width: 800, height: 80, expandedVertically: true }
  )
})

test('keeps protected crop inside the top image edge', () => {
  assert.deepEqual(
    protectCaptureRegion(
      { x: 10, y: 2, w: 200, h: 12 },
      { width: 800, height: 600 },
      1
    ),
    { x: 10, y: 0, width: 200, height: 40, expandedVertically: true }
  )
})

test('leaves a sufficiently tall selection unchanged', () => {
  assert.deepEqual(
    protectCaptureRegion(
      { x: 10.4, y: 20.6, w: 300.2, h: 55.3 },
      { width: 800, height: 600 },
      1
    ),
    { x: 10, y: 21, width: 300, height: 55, expandedVertically: false }
  )
})

test('rejects zero-area capture events instead of producing a 1x1 OCR crop', () => {
  assert.throws(
    () => protectCaptureRegion(
      { x: 10, y: 10, w: 0, h: 0 },
      { width: 800, height: 600 },
      1
    ),
    /too small/i
  )
})
