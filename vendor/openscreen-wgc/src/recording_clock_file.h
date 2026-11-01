// SPDX-License-Identifier: MIT
#pragma once
#include <Windows.h>
#include <atomic>
#include <filesystem>
#include <iterator>
#include <string>

namespace opentake {
// Publish only a fully written, durable clock. Keep the temporary on failure
// and never replace an earlier recording's clock. Antivirus/indexer sharing
// locks may be transient on Windows; an ACL/disk error still fails boundedly.
inline bool writeClockFile(const std::filesystem::path& target, const std::string& bytes,
                           std::string& error) {
    static std::atomic<unsigned long long> sequence{0};
    const auto temporary = std::filesystem::path(target.wstring() + L"." +
        std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(++sequence) + L".tmp");
    auto fail = [&](const char* operation, DWORD code) {
        error = std::string(operation) + " (Win32=" + std::to_string(code) + ")";
        return false;
    };
    HANDLE file = CreateFileW(temporary.c_str(), GENERIC_WRITE, FILE_SHARE_READ,
                             nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return fail("Create recording clock", GetLastError());
    DWORD written = 0;
    const bool ok = bytes.size() <= 32'000'000 &&
        WriteFile(file, bytes.data(), DWORD(bytes.size()), &written, nullptr) &&
        written == bytes.size() && FlushFileBuffers(file);
    const auto code = GetLastError(); CloseHandle(file);
    if (!ok) return fail("Write recording clock", code);
    constexpr DWORD waits[]{15,30,50,90,140,220,350};
    for (size_t attempt=0;;++attempt) {
        if (MoveFileExW(temporary.c_str(), target.c_str(), MOVEFILE_WRITE_THROUGH)) return true;
        const auto renameCode=GetLastError();
        if (attempt == std::size(waits) || (renameCode != ERROR_SHARING_VIOLATION &&
            renameCode != ERROR_LOCK_VIOLATION && renameCode != ERROR_ACCESS_DENIED))
            return fail("Publish recording clock", renameCode);
        Sleep(waits[attempt]);
    }
}
} // namespace opentake
