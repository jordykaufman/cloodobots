// Reads card backs off the page's main thread, so the camera view stays smooth: a frame
// of RGBA pixels in, what the reader found out back.

import { grayOf, readLayout } from './backs.js';
import { slim } from './live-scan.js';

self.onmessage = e => {
  const { seq, w, h, buf } = e.data;
  const t0 = performance.now();
  const res = readLayout(grayOf(new Uint8ClampedArray(buf), w, h));
  self.postMessage({ seq, ms: performance.now() - t0, res: slim(res) });
};
