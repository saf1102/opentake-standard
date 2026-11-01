#include "webcam_format.h"

#include <algorithm>

namespace {

bool isUsable(const WebcamFormat& format) {
    return format.width > 0 && format.height > 0;
}

bool fitsTarget(const WebcamFormat& format, int targetWidth, int targetHeight) {
    return format.width <= targetWidth && format.height <= targetHeight;
}

long long pixels(const WebcamFormat& format) {
    return static_cast<long long>(format.width) * static_cast<long long>(format.height);
}

// The part of a mode's frame rate the recording can use: the webcam is encoded
// at the target rate, so anything above it buys nothing.
int usefulFps(const WebcamFormat& format, int targetFps) {
    return std::min(format.fps, targetFps);
}

// The most a compressed mode may cost to decode, in pixels per second: 1080p
// at 30. Decoding MJPEG to NV12 through the helper's own source-reader setup,
// on an otherwise idle Ryzen 7 5800X, takes 4.9 ms a frame at 1920x1080,
// 9.2 ms at 2560x1440 and 19.7 ms at 3840x2160 (p95 22.7). 1080p30 is 15% of
// the 33 ms frame interval, a margin for slower CPUs and the screen encode
// running beside it; 4K30 already takes 60% on a fast desktop.
constexpr long long kMaxDecodedPixelsPerSecond = 1920LL * 1080LL * 30LL;

// A compressed mode is decoded at the rate the camera runs, not the rate we
// encode at, so a 60 fps mode costs twice its 30 fps twin.
bool decodable(const WebcamFormat& format, int targetFps) {
    const int fps = format.fps > 0 ? format.fps : targetFps;
    return !format.compressed || pixels(format) * fps <= kMaxDecodedPixelsPerSecond;
}

// True when `candidate` is a better frame rate than `best` for a target of
// `targetFps`: the lowest rate that still reaches the target, or -- when no
// mode reaches it -- the highest one on offer.
bool betterFps(int candidate, int best, int targetFps) {
    const bool candidateReaches = candidate >= targetFps;
    const bool bestReaches = best >= targetFps;
    if (candidateReaches != bestReaches) {
        return candidateReaches;
    }
    return candidateReaches ? candidate < best : candidate > best;
}

}  // namespace

WebcamFormat chooseWebcamFormat(
    const std::vector<WebcamFormat>& available,
    int targetWidth,
    int targetHeight,
    int targetFps) {
    const WebcamFormat target{targetWidth, targetHeight, targetFps, false};

    // Compressed modes too costly to decode are only considered when the camera
    // offers nothing else at all.
    const bool anyDecodable = std::any_of(available.begin(), available.end(), [&](const WebcamFormat& format) {
        return isUsable(format) && decodable(format, targetFps);
    });

    const auto eligible = [&](const WebcamFormat& format) {
        return isUsable(format) && (!anyDecodable || decodable(format, targetFps));
    };

    const bool anyFits = std::any_of(available.begin(), available.end(), [&](const WebcamFormat& format) {
        return eligible(format) && fitsTarget(format, targetWidth, targetHeight);
    });

    const WebcamFormat* best = nullptr;
    for (const WebcamFormat& format : available) {
        if (!eligible(format)) {
            continue;
        }
        // Once anything fits, oversized modes are out of the running entirely.
        // With nothing fitting we rank the oversized modes instead, smallest
        // first, so the scaler has the least work to do.
        if (anyFits != fitsTarget(format, targetWidth, targetHeight)) {
            continue;
        }
        if (best == nullptr) {
            best = &format;
            continue;
        }
        // Frame rate before pixels: a camera's largest uncompressed modes are
        // often stills-grade, 2 to 5 fps on a Logitech C920.
        if (usefulFps(format, targetFps) != usefulFps(*best, targetFps)) {
            if (usefulFps(format, targetFps) > usefulFps(*best, targetFps)) {
                best = &format;
            }
            continue;
        }
        if (pixels(format) != pixels(*best)) {
            const bool wins = anyFits ? pixels(format) > pixels(*best) : pixels(format) < pixels(*best);
            if (wins) {
                best = &format;
            }
            continue;
        }
        // Same picture either way: skip the decoder.
        if (format.compressed != best->compressed) {
            if (!format.compressed) {
                best = &format;
            }
            continue;
        }
        if (betterFps(format.fps, best->fps, targetFps)) {
            best = &format;
        }
    }

    return best ? *best : target;
}

