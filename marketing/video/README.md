# QRoadScan launch video source

Produced assets are delivered separately under `/workspace/qroadscan-launch/video/exports/`:

- 1920×1080, 64-second MP4 product overview.
- 1080×1920, 38-second vertical social edit.
- 1280×720 YouTube thumbnail.
- Matching SRT caption files and upload copy.

The film uses actual browser recordings of the delivery, truck and aircraft demo interfaces, animated title cards, transitions, a conceptual API excerpt and an original synthesized score. It has on-screen editorial copy/captions and music; it does not clone or imitate a person's voice. No third-party music or stock footage was used. Delivery footage is a recorded public API example; truck/aircraft values are illustrative fixtures, labeled on screen. There are no accident-reduction, verified-access, ATC or flight-readiness claims.

## Source files

- `capture-product.cjs`: captures the three local example apps and desktop/mobile images. Requires the example servers on ports 8899, 8900 and 8901.
- `trailer.html`: motion-graphics stage and both aspect-ratio timelines.
- `record-trailer.cjs`: records the stage through Chromium/Playwright.
- `create_music.py`: reproducible original synthesis using NumPy, no samples.
- `thumbnail.html`: editable YouTube cover.

Toolchain: Node.js 22+, Chromium, playwright-core with its ffmpeg dependency, Python/NumPy and system FFmpeg. Scripts currently target the shared `/workspace/qroadscan-launch/video` render folder and the environment's installed browser tools. To reproduce elsewhere, update those paths and run a loopback static server for the stage on port 8910. Keep capture footage and final MP4s outside Git to avoid committing large generated media.

Encoding: H.264/yuv420p, 30fps, AAC stereo 48kHz, fast-start MP4; music normalized around −18 LUFS with end fades. Files are intended for user review/upload, not automatic posting. Review current allowances and product behavior before reusing campaign claims in a future release.
