#include "dshow_webcam_capture.h"

#include <cstdio>

namespace {

int failures = 0;

void expect(const char* label, bool condition) {
    if (condition) {
        return;
    }
    std::printf("FAIL %s\n", label);
    ++failures;
}

}  // namespace

int main() {
    const std::vector<BYTE> frame(4 * 2 * 2, 0x80);

    // A new sequence is copied, with the size and sequence it was stored with.
    WebcamFrameSnapshot fresh;
    expect("new sequence is copied", snapshotWebcamFrame(frame, 2, 2, 7, 6, fresh));
    expect("new sequence carries its data", fresh.data == frame);
    expect("new sequence carries its size", fresh.width == 2 && fresh.height == 2);
    expect("new sequence carries its number", fresh.sequence == 7);

    // The regression this file exists for: the writer polls at the screen's
    // rate, twice the camera's, and a frame it already holds must cost nothing.
    WebcamFrameSnapshot unchanged;
    expect("unchanged sequence reports nothing new", !snapshotWebcamFrame(frame, 2, 2, 7, 7, unchanged));
    expect("unchanged sequence copies nothing", unchanged.data.empty() && unchanged.sequence == 0);

    // No frame stored yet: nothing to hand out, whatever the caller last saw.
    WebcamFrameSnapshot empty;
    expect("empty frame is not copied", !snapshotWebcamFrame({}, 2, 2, 1, 0, empty));
    expect("unknown size is not copied", !snapshotWebcamFrame(frame, 0, 2, 1, 0, empty));

    if (failures > 0) {
        std::printf("%d webcam snapshot check(s) failed\n", failures);
        return 1;
    }
    std::printf("webcam snapshot checks passed\n");
    return 0;
}

