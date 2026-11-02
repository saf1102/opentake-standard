#pragma once
#include "mf_encoder.h"
#include <algorithm>
#include <cmath>
#include <memory>
#include <vector>

struct RecordingVideoFormat { int width, height, fps; };
inline std::vector<RecordingVideoFormat> recordingVideoFormats(int width, int height, int fps) {
    width = std::max(2, width) & ~1; height = std::max(2, height) & ~1;
    std::vector<RecordingVideoFormat> formats{{width, height, std::max(1, fps)}};
    const int safeFps = std::min(30, std::max(1, fps));
    if (fps > safeFps) formats.push_back({width, height, safeFps});
    for (int edge : {2560, 1920, 1280}) {
        const double scale = std::min(1.0, double(edge) / std::max(width, height));
        const int w = std::max(2, int(width * scale) & ~1), h = std::max(2, int(height * scale) & ~1);
        if (w != formats.back().width || h != formats.back().height) formats.push_back({w, h, safeFps});
    }
    return formats;
}

// Complete-frame resampling, including every edge, using the mapped row pitch.
// The staging texture always retains the actual capture dimensions.
inline void scaleRecordingBgra(const BYTE* src, int stride, int sw, int sh, BYTE* dst, int dw, int dh) {
    for (int y = 0; y < dh; ++y) {
        const double sy = dh > 1 ? double(y) * (sh - 1) / (dh - 1) : 0;
        const int y0 = int(sy), y1 = std::min(sh - 1, y0 + 1); const double fy = sy - y0;
        for (int x = 0; x < dw; ++x) {
            const double sx = dw > 1 ? double(x) * (sw - 1) / (dw - 1) : 0;
            const int x0 = int(sx), x1 = std::min(sw - 1, x0 + 1); const double fx = sx - x0;
            for (int c = 0; c < 4; ++c) {
                const double a = src[y0 * stride + x0 * 4 + c] * (1-fx) + src[y0 * stride + x1 * 4 + c] * fx;
                const double b = src[y1 * stride + x0 * 4 + c] * (1-fx) + src[y1 * stride + x1 * 4 + c] * fx;
                dst[(size_t(y) * dw + x) * 4 + c] = BYTE(std::lround(a * (1-fy) + b * fy));
            }
        }
    }
}

std::unique_ptr<MFEncoder> initializeRecordingEncoder(const std::wstring& output,
    int captureWidth, int captureHeight, int requestedFps, ID3D11Device* device,
    ID3D11DeviceContext* context, const AudioInputFormat* audio, MFEncoderOptions options,
    RecordingVideoFormat& selected);
