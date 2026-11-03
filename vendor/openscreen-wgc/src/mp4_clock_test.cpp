// SPDX-License-Identifier: MIT
#include "mp4_clock.h"
#include "recording_clock_file.h"
#include <Windows.h>
#include <algorithm>
#include <fstream>
#include <iostream>
#include <stdexcept>

namespace {
using Bytes = std::vector<uint8_t>;
int failed = 0, ran = 0;
void expect(const char* name, bool value) { ++ran; std::cout << (value ? "PASS " : "FAIL ") << name << '\n'; if (!value) ++failed; }
Bytes u32(uint32_t n) { return {uint8_t(n >> 24),uint8_t(n >> 16),uint8_t(n >> 8),uint8_t(n)}; }
Bytes u64(uint64_t n) { auto a = u32(uint32_t(n >> 32)); const auto b = u32(uint32_t(n)); a.insert(a.end(),b.begin(),b.end()); return a; }
Bytes join(const std::vector<Bytes>& values) { Bytes result; for (const auto& v : values) result.insert(result.end(),v.begin(),v.end()); return result; }
Bytes full(uint32_t flags = 0, uint8_t version = 0) { return {version,uint8_t(flags >> 16),uint8_t(flags >> 8),uint8_t(flags)}; }
Bytes atom(const char* type, const std::vector<Bytes>& parts, bool wide = false) {
    const auto body = join(parts); Bytes typeBytes(type,type+4);
    return wide ? join({u32(1),typeBytes,u64(body.size()+16),body}) : join({u32(uint32_t(body.size()+8)),typeBytes,body});
}
Bytes track(uint32_t id, const char* handler) {
    return atom("trak",{atom("tkhd",{full(),u32(0),u32(0),u32(id),u32(0),u32(0)}),
        atom("mdia",{atom("mdhd",{full(),u32(0),u32(0),u32(1000),u32(0)}),
            atom("hdlr",{full(),u32(0),Bytes(handler,handler+4)}),
            atom("minf",{atom("stbl",{atom("stts",{full(),u32(2),u32(2),u32(100),u32(1),u32(200)})})})})});
}
struct Fixture {
    Bytes bytes, movie;
    std::vector<int64_t> clock{0,1'000'000,2'000'000,4'000'000};
    int64_t end = 5'000'000;
};
Fixture fixture(bool explicitBase = false, bool audio = false, bool wideMovie = false, uint32_t cts = 0, uint32_t count = 2, bool padded = false) {
    auto traf = [&](uint32_t id, std::vector<uint32_t> durations, uint64_t base) {
        std::vector<Bytes> parts{padded ? atom("tfhd",{full(1),u32(id),u64(0),u32(0)}) : atom("tfhd",{full(0x20000),u32(id)})};
        if (explicitBase) parts.push_back(atom("tfdt",{full(0,1),u64(base)}));
        std::vector<Bytes> samples{full(0x301|(cts?0x800:0)),u32(count),u32(0)};
        for (auto n : durations) {samples.push_back(u32(n));samples.push_back(u32(3));if(cts)samples.push_back(u32(cts));}
        parts.push_back(atom("trun",samples));return atom("traf",parts);
    };
    Fixture f;
    std::vector<Bytes> movie{atom("mvhd",{full(),u32(0),u32(0),u32(1000),u32(0)}),track(1,"vide")};
    if(audio)movie.push_back(track(2,"soun"));f.movie=atom("moov",movie,wideMovie);
    std::vector<Bytes> first{atom("mfhd",{full(),u32(1)}),traf(1,{100,16},0)};
    if(audio)first.push_back(traf(2,{100,100},0));
    const auto a=atom("moof",first),data=atom("mdat",{Bytes{'a','b','c','d','e','f'}});
    const auto secondAt=f.movie.size()+a.size()+data.size();
    std::vector<Bytes> second{atom("mfhd",{full(),u32(2)}),traf(1,{100,16},116)};
    if(audio)second.push_back(traf(2,{100,100},200));
    const auto index=atom("mfra",{atom("tfra",{full(0,1),u32(1),u32(0),u32(1),u64(116),u64(secondAt),Bytes{1,1,1}})});
    f.bytes=join({f.movie,a,data,atom("moof",second),atom("mdat",{Bytes{'g','h','i','j','k','l'}}),index});return f;
}
opentake::Mp4ClockPlan plan(const Fixture& f) {
    return opentake::planMp4Clock([&](uint64_t at,size_t n){
        if(at>f.bytes.size()||n>f.bytes.size()-size_t(at))throw std::runtime_error("bad test read");
        return Bytes(f.bytes.begin()+size_t(at),f.bytes.begin()+size_t(at)+n);
    },f.bytes.size(),f.clock,f.end);
}
Bytes repaired(const Fixture& f,const opentake::Mp4ClockPlan& p) {
    auto bytes=f.bytes;for(const auto& x:p.patches)std::copy(x.bytes.begin(),x.bytes.end(),bytes.begin()+size_t(x.offset));return bytes;
}
uint64_t number(const Bytes& b,size_t at,size_t n=4) {uint64_t result=0;for(size_t i=0;i<n;++i)result=(result<<8)|b.at(at+i);return result;}
size_t find(const Bytes& b,const char* s,size_t start=0) {
    const auto at=std::search(b.begin()+start,b.end(),s,s+4);if(at==b.end())throw std::runtime_error("fixture atom not found");return size_t(at-b.begin());
}
std::vector<uint64_t> durations(const Bytes& b) {
    std::vector<uint64_t> result;size_t at=0;
    for(;;){
        const auto found=std::search(b.begin()+at,b.end(),"trun","trun"+4);if(found==b.end())break;
        at=size_t(found-b.begin());const auto n=number(b,at+8);
        for(size_t i=0;i<n;++i)result.push_back(number(b,at+16+i*8));at+=4;
    }return result;
}
bool refuses(const Fixture& f) {try{plan(f);return false;}catch(const std::exception&){return true;}}
void write(const std::filesystem::path& p,const Bytes& data) {std::ofstream s(p,std::ios::binary);s.write(reinterpret_cast<const char*>(data.data()),std::streamsize(data.size()));if(!s)throw std::runtime_error("test write failed");}
Bytes read(const std::filesystem::path& p) {std::ifstream s(p,std::ios::binary);return Bytes(std::istreambuf_iterator<char>(s),{});}
}

int wmain(int argc,wchar_t** argv) {
    if(argc==4 && std::wstring(argv[1])==L"--file") {
        std::ifstream clock{std::filesystem::path(argv[3])};int64_t end=0;size_t count=0;
        clock>>end>>count;if(!clock||!count||count>1'000'000)return 2;
        std::vector<int64_t> stamps(count);for(auto& t:stamps)clock>>t;if(!clock)return 2;
        const auto result=opentake::finalizeMp4Clock(std::filesystem::path(argv[2]),stamps,end);
        std::cout<<"success="<<result.success<<" changed="<<result.changed<<"\n";
        if(!result.success)std::cerr<<result.error<<"\n";
        return result.success?0:1;
    }
    try {
        auto implicit=fixture();auto p=plan(implicit);auto fixed=repaired(implicit,p);
        expect("fragment-boundaries-without-tfdt",durations(fixed)==std::vector<uint64_t>({100,100,200,100}));
        expect("container-size-unchanged",fixed.size()==implicit.bytes.size());
        const auto media=find(fixed,"mdat");expect("media-payload-unchanged",Bytes(fixed.begin()+media+4,fixed.begin()+media+10)==Bytes({'a','b','c','d','e','f'}));
        implicit.bytes=fixed;expect("already-correct-is-idempotent",plan(implicit).patches.empty());
        auto explicitTime=fixture(true);auto corrected=repaired(explicitTime,plan(explicitTime));
        const auto firstBase=find(corrected,"tfdt"),secondBase=find(corrected,"tfdt",firstBase+4),index=find(corrected,"tfra");
        expect("explicit-decode-base-corrected",number(corrected,secondBase+8,8)==200);
        expect("random-access-time-corrected",number(corrected,index+20,8)==200);
        auto audio=fixture(true,true);expect("audio-sample-durations-preserved",durations(repaired(audio,plan(audio)))==std::vector<uint64_t>({100,100,100,100,200,100,100,100}));
        auto held=fixture();held.end=8'000'000;expect("last-picture-held-to-stop-time",durations(repaired(held,plan(held))).back()==400);
        auto wide=fixture(false,false,true);expect("64-bit-atom-length",durations(repaired(wide,plan(wide)))==std::vector<uint64_t>({100,100,200,100}));
        auto padded=fixture(false,false,false,0,2,true);
        expect("windows-zero-header-padding-preserved",durations(repaired(padded,plan(padded)))==std::vector<uint64_t>({100,100,200,100}));
        padded.bytes[find(padded.bytes,"tfhd")+23]=1;
        expect("unknown-header-data-refused",refuses(padded));
        auto zero=fixture(true);const auto zeroAt=find(zero.bytes,"trun")+24;
        std::fill(zero.bytes.begin()+zeroAt,zero.bytes.begin()+zeroAt+4,0);
        const auto zeroFixed=repaired(zero,plan(zero));
        expect("zero-video-duration-repaired-from-exact-clock",durations(zeroFixed)==std::vector<uint64_t>({100,100,200,100}));
        zero.bytes=zeroFixed;expect("zero-duration-repair-converges",plan(zero).patches.empty());
        auto zeroAudio=fixture(true,true);const auto audioRun=find(zeroAudio.bytes,"trun",find(zeroAudio.bytes,"trun")+4);
        std::fill(zeroAudio.bytes.begin()+audioRun+16,zeroAudio.bytes.begin()+audioRun+20,0);
        expect("zero-audio-duration-still-refused",refuses(zeroAudio));
        auto wrong=fixture();wrong.clock[2]=wrong.clock[1];expect("nonmonotonic-clock-refused",refuses(wrong));
        wrong=fixture();wrong.end=wrong.clock.back();expect("invalid-end-refused",refuses(wrong));
        wrong=fixture();wrong.clock.push_back(4'500'000);expect("missing-frame-refused",refuses(wrong));
        expect("malformed-sample-count-refused",refuses(fixture(false,false,false,0,3)));
        expect("reordered-frames-refused",refuses(fixture(false,false,false,1)));
        wrong=fixture();wrong.bytes.pop_back();expect("truncated-file-refused",refuses(wrong));
        auto plain=fixture();plain.bytes=plain.movie;plain.clock={0,1'000'000,2'000'000};plain.end=4'000'000;
        expect("plain-mp4-clock-verified",plan(plain).patches.empty());
        plain.clock[2]=2'200'000;expect("unknown-plain-timing-refused",refuses(plain));
        wchar_t temp[MAX_PATH]{};GetTempPathW(MAX_PATH,temp);
        const auto dir=std::filesystem::path(temp)/(L"opentake-clock-"+std::to_wstring(GetCurrentProcessId())+L"-"+std::to_wstring(GetTickCount64()));
        if(!std::filesystem::create_directory(dir))throw std::runtime_error("test directory already exists");
        std::string clockError;const auto clockFile=dir/L"中文 时钟.json";
        expect("clock-wide-path-durable-publication",opentake::writeClockFile(clockFile,"exact-clock",clockError)&&read(clockFile)==Bytes({'e','x','a','c','t','-','c','l','o','c','k'}));
        expect("clock-publication-never-overwrites-earlier-data",!opentake::writeClockFile(clockFile,"replacement",clockError)&&read(clockFile)==Bytes({'e','x','a','c','t','-','c','l','o','c','k'}));
        expect("clock-publication-reports-native-error",!clockError.empty());
        const auto video=dir/L"中文 空格录制.mp4";auto file=fixture(true);write(video,file.bytes);
        const auto result=opentake::finalizeMp4Clock(video,file.clock,file.end);
        expect("native-final-path-published",result.success&&result.changed&&read(video)==repaired(file,plan(file)));
        expect("uncorrected-original-preserved",result.success&&!result.rawBackup.empty()&&read(result.rawBackup)==file.bytes);
        const auto before=read(video);const auto again=opentake::finalizeMp4Clock(video,file.clock,file.end);
        expect("repeated-finalization-does-not-rewrite",again.success&&!again.changed&&again.rawBackup.empty()&&read(video)==before);
        const auto bad=dir/L"bad.mp4";write(bad,file.bytes);auto badClock=file.clock;badClock.pop_back();
        const auto badResult=opentake::finalizeMp4Clock(bad,badClock,file.end);
        expect("failed-validation-preserves-file",!badResult.success&&read(bad)==file.bytes);
        const auto locked=dir/L"locked.mp4";write(locked,file.bytes);
        HANDLE lock=CreateFileW(locked.c_str(),GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE,nullptr,OPEN_EXISTING,0,nullptr);
        if(lock==INVALID_HANDLE_VALUE)throw std::runtime_error("test sharing lock failed");
        const auto blocked=opentake::finalizeMp4Clock(locked,file.clock,file.end);CloseHandle(lock);
        expect("failed-publication-never-reports-success",!blocked.success&&read(locked)==file.bytes);
        // This directory was exclusively created above under GetTempPathW.
        if(!failed){
            if(std::filesystem::weakly_canonical(dir.parent_path())!=std::filesystem::weakly_canonical(temp)||
               dir.filename().wstring().rfind(L"opentake-clock-",0)!=0)throw std::runtime_error("unsafe test cleanup path");
            std::filesystem::remove_all(dir);
        }
    } catch(const std::exception& error) {++failed;std::cerr<<"ERROR "<<error.what()<<"\n";}
    std::cout<<"ran "<<ran<<" native clock checks; failures="<<failed<<"\n";return failed?1:0;
}
