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

## v4: CFR packet duration on Windows and macOS

Both production drain paths now supply a missing encoded packet duration in the
encoder time base before timestamp rescaling and the first mux write. A positive
encoder duration and PTS/DTS are preserved, including packets received on flush.
No remux, duration metadata override or post-export repair is used. The pinned
patch also contains the Mac fix; applying it is necessary for a future Mac addon
rebuild, but this task does not replace any installed Mac or Windows binary.

`patchedFiles` pins every changed or added source file. The build receipt kind is
`opentake-compositor-software-video-v4`; v2/v3 receipts cannot be reused.
The Rust container regression writes and reads actual MP4s at 24/30/60 fps with
1, 7 and 200 frames. Windows tests h264_mf and libopenh264, plus full WARP export
without a hardware video device. Mac runs its real drain path using a local SDK
software encoder fixture (libx264 only in tests; product candidates unchanged).
The nine hardware-dependent legacy tests remain unchanged.
