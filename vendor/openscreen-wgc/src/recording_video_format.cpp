#include "recording_video_format.h"
#include <iostream>

std::unique_ptr<MFEncoder> initializeRecordingEncoder(const std::wstring& output,
    int captureWidth, int captureHeight, int requestedFps, ID3D11Device* device,
    ID3D11DeviceContext* context, const AudioInputFormat* audio, MFEncoderOptions options,
    RecordingVideoFormat& selected) {
    std::cout << "{\"event\":\"capture-format\",\"schemaVersion\":2,\"width\":" << captureWidth
              << ",\"height\":" << captureHeight << ",\"fps\":" << requestedFps
              << ",\"pixelFormat\":\"BGRA8\"}" << std::endl;
    for (const auto format : recordingVideoFormats(captureWidth, captureHeight, requestedFps)) {
        std::cerr << "INFO: capture-format=" << captureWidth << "x" << captureHeight << " BGRA8; encoder-format-attempt="
                  << format.width << "x" << format.height << "@" << format.fps << " NV12" << std::endl;
        auto attemptOptions = options;
        if (format.width != captureWidth || format.height != captureHeight) attemptOptions.useDxgiInput = false;
        const auto pixels = int64_t(format.width) * format.height;
        const int bitrate = pixels >= 3840 * 2160 ? 45'000'000 : pixels >= 2560 * 1440 ? 28'000'000 : 18'000'000;
        std::cout << "{\"event\":\"encoder-format-attempt\",\"schemaVersion\":2,\"width\":" << format.width
                  << ",\"height\":" << format.height << ",\"fps\":" << format.fps
                  << ",\"pixelFormat\":\"NV12\"}" << std::endl;
        auto encoder = std::make_unique<MFEncoder>();
        if (encoder->initialize(output, format.width, format.height, format.fps, bitrate, device, context, audio, attemptOptions)) {
            selected = format;
            std::cerr << "INFO: encoder-format-selected=" << format.width << "x" << format.height << "@" << format.fps
                      << " NV12; encoder=" << encoder->videoEncoderRuntime() << std::endl;
            std::cout << "{\"event\":\"encoder-format-selected\",\"schemaVersion\":2,\"width\":" << format.width
                      << ",\"height\":" << format.height << ",\"fps\":" << format.fps
                      << ",\"pixelFormat\":\"NV12\",\"scaled\":"
                      << ((format.width != captureWidth || format.height != captureHeight) ? "true" : "false") << "}" << std::endl;
            return encoder;
        }
        // Disk, audio, device, and other failures are not video capability errors.
        if (!encoder->videoTypeRejected()) break;
        std::cerr << "WARNING: Video media type rejected; trying the next bounded, aspect-preserving recording format." << std::endl;
    }
    return nullptr;
}
