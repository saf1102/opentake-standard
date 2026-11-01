// SPDX-License-Identifier: MIT
#pragma once

#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>
#include <vector>

namespace opentake {

struct Mp4ClockPatch {
    uint64_t offset;
    std::vector<uint8_t> bytes;
};

struct Mp4ClockPlan {
    std::vector<Mp4ClockPatch> patches;
    size_t samples = 0;
    size_t fragments = 0;
};

using Mp4ClockRead = std::function<std::vector<uint8_t>(uint64_t, size_t)>;

// Throws on an unsupported or inconsistent file. Media payloads are never read.
Mp4ClockPlan planMp4Clock(
    const Mp4ClockRead& read, uint64_t fileBytes,
    const std::vector<int64_t>& timestampsHns, int64_t endTimeHns);

struct Mp4ClockResult {
    bool success = false;
    bool changed = false;
    std::filesystem::path rawBackup;
    std::string error;
};

// Final output keeps the requested filename. A changed file is first copied and
// verified, then atomically published with the pre-correction file retained.
Mp4ClockResult finalizeMp4Clock(
    const std::filesystem::path& video,
    const std::vector<int64_t>& timestampsHns, int64_t endTimeHns);

} // namespace opentake
