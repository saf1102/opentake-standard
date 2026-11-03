# Windows recording clock source

Pinned native Windows Graphics Capture source from OpenScreen v2.1.2:
https://github.com/getopenscreen/openscreen/tree/v2.1.2/electron/native/wgc-capture

Original MIT license is preserved in LICENSE. OpenTake's local changes retain
the exact normalized recording-clock stamp of each submitted video sample,
finalize the requested MP4 against that clock, and write a .clock.json sidecar
only after timing verification succeeds.
The OpenScreen app and native compositor remain separate, unchanged installs.

On this Win11/Intel MFT path, even the upstream delayed SampleDuration fix is
reset to 1/60 s at fragmented-MP4 boundaries. mp4_clock.h/.cpp correct container
metadata before the native encoder reports success. The requested MP4 path
contains the verified result, including fragment durations and seek indexes.
The original file is preserved as *.capture-raw-<pid>-<counter>.mp4. Media payload,
sample order, and cursor timestamps stay unchanged; there is no re-encoding or
duration-ratio scaling. Failure preserves the recording and diagnostic copies
and is reported as a failed save.

The metadata reader is bounded to two hours, one million samples, and 8 MB per
metadata atom. Unknown layouts, reordered video, or sample/clock mismatches fail
explicitly. Already correct files are verified without rewriting. Standard
independently verifies the result and keeps sidecar-based repair for earlier
recordings with a valid exact clock.

Build with npm run build:native on Windows x64 with Visual Studio 2022/2026,
the C++ CMake tools and Windows SDK. Generated binaries go to native/windows;
intermediate files go to .build/windows-recording. No toolchain is downloaded.

Build all native checks with CMake --build .build/windows-recording --config
Release. Run audio_sample_utils_test, frame_slot_clock_test,
frame_visibility_test, webcam_format_test, mp4_clock_test, and
mf_encoder_color_test from its Release directory. The last test requires
ffmpeg/ffprobe on PATH and exercises the actual software and hardware MFTs.
webcam_snapshot_test uses a real camera and is a separate manual check.
