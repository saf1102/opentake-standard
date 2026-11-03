// SPDX-License-Identifier: MIT
#include "mp4_clock.h"

#include <Windows.h>

#include <algorithm>
#include <atomic>
#include <fstream>
#include <limits>
#include <map>
#include <stdexcept>
#include <tuple>

namespace opentake {
namespace {
using Bytes = std::vector<uint8_t>;
constexpr uint64_t kMaxInteger = 9'007'199'254'740'991ULL;
constexpr int64_t kMaxClockHns = 72'000'000'000LL;
constexpr uint64_t kMaxMetadata = 8'000'000;

[[noreturn]] void invalid(const char* message) { throw std::runtime_error(message); }
void require(const Bytes& data, size_t at, size_t count) {
    if (at > data.size() || count > data.size() - at) invalid("Truncated MP4 metadata");
}
uint64_t number(const Bytes& data, size_t at, size_t count = 4) {
    require(data, at, count);
    uint64_t value = 0;
    for (size_t i = 0; i < count; ++i) value = (value << 8) | data[at + i];
    if (value > kMaxInteger) invalid("MP4 integer exceeds supported range");
    return value;
}
void setNumber(Bytes& data, size_t at, uint64_t value, size_t count = 4) {
    require(data, at, count);
    if (value > kMaxInteger || (count < 8 && value >= (uint64_t(1) << (count * 8))))
        invalid("MP4 time field overflow");
    for (size_t i = count; i > 0; --i) { data[at + i - 1] = uint8_t(value & 255); value >>= 8; }
}
uint64_t sum(uint64_t a, uint64_t b) {
    if (a > kMaxInteger || b > kMaxInteger - a) invalid("MP4 time overflow");
    return a + b;
}
uint64_t rescale(uint64_t value, uint64_t scale, uint64_t denominator) {
    if (!denominator || !scale || scale > 0xffffffff || denominator > 0xffffffff)
        invalid("Unsupported MP4 timebase");
    const uint64_t quotient = value / denominator;
    if (quotient > kMaxInteger / scale) invalid("MP4 rescale overflow");
    const uint64_t remainder = value % denominator;
    return sum(quotient * scale, (remainder * scale + denominator / 2) / denominator);
}
uint64_t clockTicks(int64_t value, uint64_t scale) {
    if (value < 0 || value > kMaxClockHns) invalid("Recording clock out of range");
    return rescale(uint64_t(value), scale, 10'000'000);
}
struct Atom { std::string type; size_t start, body, end; };
std::vector<Atom> children(const Bytes& data, size_t begin, size_t end) {
    require(data, begin, end >= begin ? end - begin : data.size() + 1);
    std::vector<Atom> result;
    while (begin < end) {
        require(data, begin, 8);
        uint64_t size = number(data, begin); size_t header = 8;
        if (size == 1) { size = number(data, begin + 8, 8); header = 16; }
        if (size == 0) size = end - begin;
        if (size < header || size > end - begin) invalid("Invalid MP4 atom length");
        result.push_back({std::string(data.begin() + begin + 4, data.begin() + begin + 8),
                          begin, begin + header, begin + size_t(size)});
        begin += size_t(size);
    }
    return result;
}
std::vector<Atom> children(const Bytes& data, const Atom& parent) {
    return children(data, parent.body, parent.end);
}
Atom exactly(const Bytes& data, const Atom& parent, const char* type) {
    std::vector<Atom> matches;
    for (const auto& atom : children(data, parent)) if (atom.type == type) matches.push_back(atom);
    if (matches.size() != 1) invalid("Required MP4 atom missing or duplicated");
    return matches.front();
}
bool versionOne(const Bytes& data, const Atom& atom) {
    require(data, atom.body, 4);
    if (data[atom.body] > 1) invalid("Unsupported MP4 atom version");
    return data[atom.body] == 1;
}
uint64_t flags(const Bytes& data, const Atom& atom) {
    require(data, atom.body, 4); return number(data, atom.body + 1, 3);
}
struct FileAtom { std::string type; uint64_t at, size; };
struct Track {
    uint64_t id, scale;
    Atom trak, tkhd, mdia, mdhd;
    bool wide, mediaWide, video;
};
struct Run { size_t first; uint64_t count; };
using RunKey = std::pair<size_t, size_t>;
std::atomic<uint64_t> uniqueId{0};

std::filesystem::path auxiliary(const std::filesystem::path& video, const wchar_t* kind) {
    auto name = video.stem().wstring() + kind + std::to_wstring(GetCurrentProcessId()) +
                L"-" + std::to_wstring(++uniqueId);
    return video.parent_path() / (name + (kind == std::wstring(L".capture-raw-") ? L".mp4" : L".tmp"));
}
std::vector<uint8_t> readAt(std::ifstream& stream, uint64_t at, size_t length) {
    stream.clear(); stream.seekg(std::streamoff(at));
    Bytes bytes(length); stream.read(reinterpret_cast<char*>(bytes.data()), std::streamsize(length));
    if (!stream || size_t(stream.gcount()) != length) invalid("Could not read MP4 metadata");
    return bytes;
}
} // namespace

Mp4ClockPlan planMp4Clock(const Mp4ClockRead& read, uint64_t fileBytes,
                         const std::vector<int64_t>& stamps, int64_t endHns) {
    if (stamps.empty() || stamps.size() > 1'000'000 || stamps.front() != 0)
        invalid("Missing or unsupported recording clock");
    for (size_t i = 0; i < stamps.size(); ++i) {
        if (stamps[i] < 0 || stamps[i] > kMaxClockHns || (i && stamps[i] <= stamps[i - 1]))
            invalid("Recording clock must be strictly increasing");
    }
    if (endHns <= stamps.back() || endHns > kMaxClockHns) invalid("Invalid recording end time");
    if (fileBytes > kMaxInteger) invalid("Recording is too large");
    std::vector<FileAtom> top;
    for (uint64_t at = 0; at < fileBytes;) {
        if (fileBytes - at < 8) invalid("Truncated MP4 file header");
        const auto head = read(at, size_t(std::min<uint64_t>(16, fileBytes - at)));
        uint64_t length = number(head, 0), header = 8;
        if (length == 1) { length = number(head, 8, 8); header = 16; }
        if (!length) length = fileBytes - at;
        if (length < header || length > fileBytes - at) invalid("Invalid MP4 file atom");
        top.push_back({std::string(head.begin() + 4, head.begin() + 8), at, length});
        if (top.size() > 2'000'000) invalid("Too many MP4 atoms");
        at += length;
    }
    const auto load = [&](const FileAtom& atom) {
        if (atom.size > kMaxMetadata) invalid("MP4 metadata exceeds supported size");
        auto bytes = read(atom.at, size_t(atom.size));
        if (bytes.size() != atom.size) invalid("Short MP4 metadata read");
        return bytes;
    };
    std::vector<FileAtom> moovs;
    size_t fragmentCount = 0;
    for (const auto& a : top) { if (a.type == "moov") moovs.push_back(a); if (a.type == "moof") ++fragmentCount; }
    if (moovs.size() != 1) invalid("Missing or duplicated MP4 movie metadata");
    auto movie = load(moovs.front()); const auto originalMovie = movie;
    const auto root = children(movie, 0, movie.size()).front();
    const auto mvhd = exactly(movie, root, "mvhd"); const bool movieWide = versionOne(movie, mvhd);
    if (mvhd.end - mvhd.body < (movieWide ? 32u : 20u)) invalid("Truncated movie header");
    const auto movieScale = number(movie, mvhd.body + (movieWide ? 20 : 12));
    if (!movieScale) invalid("Invalid movie timebase");
    std::vector<Track> tracks;
    for (const auto& atom : children(movie, root)) {
        if (atom.type != "trak") continue;
        const auto tkhd = exactly(movie, atom, "tkhd"); const bool wide = versionOne(movie, tkhd);
        const auto mdia = exactly(movie, atom, "mdia"); const auto mdhd = exactly(movie, mdia, "mdhd");
        const bool mediaWide = versionOne(movie, mdhd); const auto handler = exactly(movie, mdia, "hdlr");
        if (tkhd.end - tkhd.body < (wide ? 36u : 24u) || mdhd.end - mdhd.body < (mediaWide ? 32u : 20u) ||
            handler.end - handler.body < 12) invalid("Truncated MP4 track header");
        require(movie, handler.body + 8, 4);
        const bool video = std::string(movie.begin() + handler.body + 8, movie.begin() + handler.body + 12) == "vide";
        const auto id = number(movie, tkhd.body + (wide ? 20 : 12));
        const auto scale = number(movie, mdhd.body + (mediaWide ? 20 : 12));
        if (!id || !scale || std::any_of(tracks.begin(), tracks.end(), [&](const Track& t){return t.id == id;}))
            invalid("Invalid or duplicated MP4 track");
        tracks.push_back({id, scale, atom, tkhd, mdia, mdhd, wide, mediaWide, video});
    }
    std::vector<Track> videoTracks;
    for (const auto& track : tracks) if (track.video) videoTracks.push_back(track);
    if (videoTracks.size() != 1) invalid("Exactly one recorded video track is required");
    const auto video = videoTracks.front();
    std::vector<uint64_t> ticks; ticks.reserve(stamps.size());
    for (auto t : stamps) {
        const auto tick = clockTicks(t, video.scale);
        if (!ticks.empty() && tick <= ticks.back()) invalid("Video timebase cannot represent this clock");
        ticks.push_back(tick);
    }
    const auto end = clockTicks(endHns, video.scale);
    if (end <= ticks.back()) invalid("Video end time cannot be represented");
    Mp4ClockPlan plan; plan.samples = stamps.size(); plan.fragments = fragmentCount;
    uint64_t movieEnd = clockTicks(endHns, movieScale);
    std::map<uint64_t, uint64_t> rawDecodeEnd;
    std::map<uint64_t, std::map<RunKey, Run>> fragmentRuns;
    size_t sampleIndex = 0;
    if (!fragmentCount) {
        const auto minf = exactly(movie, video.mdia, "minf"); const auto stbl = exactly(movie, minf, "stbl");
        const auto stts = exactly(movie, stbl, "stts"); const auto entries = number(movie, stts.body + 4);
        if (entries > 1'000'000 || stts.end - stts.body != 8 + entries * 8) invalid("Invalid plain MP4 timing table");
        uint64_t cursor = 0;
        for (uint64_t i = 0; i < entries; ++i) {
            const auto count = number(movie, stts.body + 8 + size_t(i) * 8);
            const auto delta = number(movie, stts.body + 12 + size_t(i) * 8);
            if (!delta || count > ticks.size() - sampleIndex) invalid("Plain MP4 frame count mismatch");
            for (uint64_t j = 0; j < count; ++j) {
                if (cursor != ticks[sampleIndex++]) invalid("Plain MP4 frame timestamps differ from recording clock");
                cursor = sum(cursor, delta);
            }
        }
        if (sampleIndex != ticks.size()) invalid("Plain MP4 frame count mismatch");
        // Plain tables may group durations. Refuse a mismatch instead of
        // changing run counts, shifting sample offsets, or estimating a ratio.
        if (cursor != end) invalid("Plain MP4 end time differs from recording clock");
        return plan;
    }
    for (const auto& fileAtom : top) {
        if (fileAtom.type != "moof") continue;
        auto fragment = load(fileAtom); const auto before = fragment;
        const auto fragmentRoot = children(fragment, 0, fragment.size()).front();
        size_t trafNumber = 0;
        for (const auto& traf : children(fragment, fragmentRoot)) {
            if (traf.type != "traf") continue;
            ++trafNumber;
            const auto tfhd = exactly(fragment, traf, "tfhd");
            const auto id = number(fragment, tfhd.body + 4);
            const auto trackIt = std::find_if(tracks.begin(), tracks.end(), [&](const Track& t){return t.id == id;});
            if (trackIt == tracks.end()) invalid("Fragment references an unknown track");
            const auto& track = *trackIt;
            size_t p = tfhd.body + 8; const auto headerFlags = flags(fragment, tfhd);
            if (fragment[tfhd.body] != 0 || (headerFlags & ~uint64_t(0x3003b))) invalid("Unsupported fragment header flags");
            if (headerFlags & 1) p += 8; if (headerFlags & 2) p += 4;
            uint64_t defaultDuration = 0;
            if (headerFlags & 8) { defaultDuration = number(fragment, p); p += 4; }
            if (headerFlags & 16) p += 4; if (headerFlags & 32) p += 4;
            // The Windows fragmented sink emits one trailing zero word after
            // base_data_offset although its flag is not set. Keep this bounded
            // padding byte-identical; reject other unexplained header data.
            if (p + 4 == tfhd.end && number(fragment, p) == 0) p += 4;
            if (p != tfhd.end) invalid("Unsupported fragment header");
            std::vector<Atom> bases;
            for (const auto& child : children(fragment, traf)) if (child.type == "tfdt") bases.push_back(child);
            if (bases.size() > 1) invalid("Duplicated fragment decode time");
            uint64_t rawEnd = rawDecodeEnd[id];
            if (!bases.empty()) {
                const auto& base = bases.front(); const bool wide = versionOne(fragment, base);
                if (base.end != base.body + (wide ? 12 : 8)) invalid("Invalid fragment decode time");
                rawEnd = number(fragment, base.body + 4, wide ? 8 : 4);
                if (track.video) {
                    if (sampleIndex >= ticks.size()) invalid("More encoded frames than recording clock");
                    setNumber(fragment, base.body + 4, ticks[sampleIndex], wide ? 8 : 4);
                }
            }
            size_t runNumber = 0;
            for (const auto& run : children(fragment, traf)) {
                if (run.type != "trun") continue;
                ++runNumber; const auto runFlags = flags(fragment, run);
                versionOne(fragment, run);
                if (runFlags & ~uint64_t(0xf05)) invalid("Unsupported MP4 sample flags");
                const auto count = number(fragment, run.body + 4); p = run.body + 8;
                if (count > 1'000'000 || (track.video && count > ticks.size() - sampleIndex))
                    invalid("Encoded sample count differs from recording clock");
                if (runFlags & 1) p += 4; if (runFlags & 4) p += 4;
                const uint64_t fields = ((runFlags & 0x100) ? 1 : 0) + ((runFlags & 0x200) ? 1 : 0) +
                                        ((runFlags & 0x400) ? 1 : 0) + ((runFlags & 0x800) ? 1 : 0);
                if (p > run.end || count * fields * 4 != run.end - p) invalid("Invalid MP4 sample table length");
                if (track.video) fragmentRuns[fileAtom.at][{trafNumber, runNumber}] = {sampleIndex, count};
                for (uint64_t i = 0; i < count; ++i) {
                    auto duration = defaultDuration;
                    if (runFlags & 0x100) {
                        duration = number(fragment, p);
                        if (track.video) setNumber(fragment, p, (sampleIndex + 1 < ticks.size() ? ticks[sampleIndex + 1] : end) - ticks[sampleIndex]);
                        p += 4;
                    } else if (track.video) invalid("Video fragment has no independent sample durations");
                    // A Windows H.264 MFT can emit a zero duration (observed
                    // at a fragment boundary on a cold take). Video duration
                    // is replaced above from the independently validated exact
                    // clock. Refusing its old value discarded that clock too.
                    // Audio has no such independent clock: never invent it.
                    if (!duration && !track.video) invalid("Zero MP4 sample duration");
                    rawEnd = sum(rawEnd, duration);
                    if (runFlags & 0x200) { number(fragment, p); p += 4; }
                    if (runFlags & 0x400) { number(fragment, p); p += 4; }
                    if (runFlags & 0x800) {
                        if (number(fragment, p) && track.video) invalid("Reordered video timestamps are unsupported");
                        p += 4;
                    }
                    if (track.video) ++sampleIndex;
                }
                if (p != run.end) invalid("Invalid MP4 sample table length");
            }
            rawDecodeEnd[id] = rawEnd;
            if (!track.video) movieEnd = std::max(movieEnd, rescale(rawEnd, movieScale, track.scale));
        }
        if (fragment != before) plan.patches.push_back({fileAtom.at, std::move(fragment)});
    }
    if (sampleIndex != ticks.size()) invalid("Fewer encoded frames than recording clock");
    setNumber(movie, video.mdhd.body + (video.mediaWide ? 24 : 16), end, video.mediaWide ? 8 : 4);
    setNumber(movie, video.tkhd.body + (video.wide ? 28 : 20), clockTicks(endHns, movieScale), video.wide ? 8 : 4);
    setNumber(movie, mvhd.body + (movieWide ? 24 : 16), movieEnd, movieWide ? 8 : 4);
    for (const auto& atom : children(movie, root)) {
        if (atom.type != "mvex") continue;
        for (const auto& child : children(movie, atom)) if (child.type == "mehd") {
            const bool wide = versionOne(movie, child); setNumber(movie, child.body + 4, movieEnd, wide ? 8 : 4);
        }
    }
    if (movie != originalMovie) plan.patches.push_back({moovs.front().at, std::move(movie)});
    for (const auto& fileAtom : top) {
        if (fileAtom.type != "mfra") continue;
        auto index = load(fileAtom); const auto before = index;
        const auto indexRoot = children(index, 0, index.size()).front();
        for (const auto& tfra : children(index, indexRoot)) {
            if (tfra.type != "tfra" || number(index, tfra.body + 4) != video.id) continue;
            const bool wide = versionOne(index, tfra); const auto packed = number(index, tfra.body + 8);
            const size_t lengths[]{size_t(((packed >> 4) & 3) + 1), size_t(((packed >> 2) & 3) + 1), size_t((packed & 3) + 1)};
            const auto count = number(index, tfra.body + 12); size_t p = tfra.body + 16;
            if (count > 1'000'000) invalid("Too many random-access entries");
            for (uint64_t i = 0; i < count; ++i) {
                const size_t timeAt = p; p += wide ? 8 : 4;
                const auto offset = number(index, p, wide ? 8 : 4); p += wide ? 8 : 4;
                const auto traf = number(index, p, lengths[0]); p += lengths[0];
                const auto run = number(index, p, lengths[1]); p += lengths[1];
                const auto sample = number(index, p, lengths[2]); p += lengths[2];
                const auto fragment = fragmentRuns.find(offset);
                if (fragment == fragmentRuns.end()) invalid("Random-access fragment offset mismatch");
                const auto found = fragment->second.find({size_t(traf), size_t(run)});
                if (found == fragment->second.end() || !sample || sample > found->second.count)
                    invalid("Random-access sample index mismatch");
                setNumber(index, timeAt, ticks[found->second.first + size_t(sample) - 1], wide ? 8 : 4);
            }
            if (p != tfra.end) invalid("Invalid random-access table length");
        }
        if (index != before) plan.patches.push_back({fileAtom.at, std::move(index)});
    }
    return plan;
}

Mp4ClockResult finalizeMp4Clock(const std::filesystem::path& video,
                              const std::vector<int64_t>& stamps, int64_t endHns) {
    Mp4ClockResult result;
    std::filesystem::path temporary;
    try {
        if (!video.is_absolute() || video.extension() != L".mp4") invalid("An absolute recording MP4 path is required");
        const auto size = std::filesystem::file_size(video);
        const auto modified = std::filesystem::last_write_time(video);
        std::ifstream input(video, std::ios::binary);
        if (!input) invalid("Could not open finalized recording");
        auto read = [&](uint64_t at, size_t n) { return readAt(input, at, n); };
        const auto plan = planMp4Clock(read, size, stamps, endHns);
        if (plan.patches.empty()) { result.success = true; return result; }
        temporary = auxiliary(video, L".timing-fix-");
        if (!CopyFileW(video.c_str(), temporary.c_str(), TRUE)) invalid("Could not create exclusive MP4 timing copy");
        if (std::filesystem::file_size(video) != size || std::filesystem::last_write_time(video) != modified)
            invalid("Recording changed during timing verification");
        input.close();
        {
            std::fstream output(temporary, std::ios::binary | std::ios::in | std::ios::out);
            if (!output) invalid("Could not open MP4 timing copy");
            for (const auto& patch : plan.patches) {
                output.seekp(std::streamoff(patch.offset));
                output.write(reinterpret_cast<const char*>(patch.bytes.data()), std::streamsize(patch.bytes.size()));
                if (!output) invalid("Could not write MP4 timing metadata");
            }
            output.flush(); if (!output) invalid("Could not flush MP4 timing metadata");
        }
        {
            std::ifstream checked(temporary, std::ios::binary);
            const auto verified = planMp4Clock([&](uint64_t at, size_t n){ return readAt(checked, at, n); },
                                               size, stamps, endHns);
            if (!verified.patches.empty()) invalid("Native MP4 timing verification did not converge");
        }
        HANDLE file = CreateFileW(temporary.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
        if (file == INVALID_HANDLE_VALUE) invalid("Could not open timing copy for durable flush");
        const BOOL flushed = FlushFileBuffers(file); CloseHandle(file);
        if (!flushed) invalid("Could not durably flush timing copy");
        result.rawBackup = auxiliary(video, L".capture-raw-");
        if (!CreateHardLinkW(result.rawBackup.c_str(), video.c_str(), nullptr) &&
            !CopyFileW(video.c_str(), result.rawBackup.c_str(), TRUE))
            invalid("Could not preserve the uncorrected native MP4");
        if (std::filesystem::file_size(video) != size || std::filesystem::last_write_time(video) != modified)
            invalid("Recording changed before timing publication");
        if (!MoveFileExW(temporary.c_str(), video.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
            invalid("Could not atomically publish the corrected native MP4");
        result.success = true; result.changed = true;
    } catch (const std::exception& error) {
        result.error = error.what();
        // Leave the requested recording and any diagnostic copies available.
        // No failed finalization is reported as a saved recording.
    }
    return result;
}
} // namespace opentake
