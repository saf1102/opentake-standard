# Windows native video fallback patch

This MIT-licensed patch applies only to OpenScreen v2.1.2, commit
`d8889c626f859e0be8f4f87fdffc7362629550bc`. The official Electron app.asar stays
unchanged. A D3D11 device that cannot initialize a hardware decoder uses
libavcodec software decoding and the existing CpuFrames texture upload path.
An encoder video-device or frame-pool initialization failure selects system-memory
frames and the existing NV12 readback/encoder candidates. Partial device and pool
allocations are released on failure. Healthy hardware paths stay the default.
The fault-injection tests cover decoding and nonzero seek, both encoder pool
failure stages, complete MP4 export, frame count and strict decode of actual pixels.

`upstream.json` pins the repository, base commit, patched source hash and the
LGPL shared FFmpeg SDK URL/SHA256. `scripts/build-windows-compositor.mjs` fetches
that exact source, applies this patch and builds the N-API addon. It requires
Git, Rust MSVC, Visual Studio C++ x64/Windows SDK and LLVM (or LIBCLANG_PATH).
Generated dependencies and outputs stay under .build/ and native/windows/.
The installer preserves the original addon and includes the build receipt.

To run the focused upstream native regression after applying the patch, run
`cargo test --locked --release --lib -p openscreen-compositor failure_falls_back -- --nocapture`
from its crates directory, with FFMPEG_DIR and LIBCLANG_PATH set and the pinned
FFmpeg DLL directory on PATH. This requires a working hardware D3D11 device to
inject the failures; it does not silently pass without that prerequisite.
