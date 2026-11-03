#include "recording_video_format.h"
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>

void require(bool ok, const char* reason) { if (!ok) throw std::runtime_error(reason); }
int wmain(int argc, wchar_t** argv) {
 try {
    require(argc == 2, "provide a new output directory");
    const std::filesystem::path output(argv[1]);require(!std::filesystem::exists(output), "output directory already exists");
    std::filesystem::create_directories(output);
    require(SUCCEEDED(CoInitializeEx(nullptr, COINIT_MULTITHREADED)), "COM startup failed");
    Microsoft::WRL::ComPtr<ID3D11Device> device;Microsoft::WRL::ComPtr<ID3D11DeviceContext> context;
    require(SUCCEEDED(D3D11CreateDevice(nullptr,D3D_DRIVER_TYPE_HARDWARE,nullptr,D3D11_CREATE_DEVICE_BGRA_SUPPORT,nullptr,0,D3D11_SDK_VERSION,&device,nullptr,&context)), "D3D11 unavailable");
    // Padded rows and four corners: this catches crop, wrong stride, rotation,
    // and out-of-bounds bugs without relying only on a container's dimensions.
    std::vector<BYTE> source(11*7*4,0),scaled(4*4*4);
    for (int y=0;y<7;++y)for(int x=0;x<9;++x){auto p=&source[(y*11+x)*4];p[0]=BYTE(x*20);p[1]=BYTE(y*30);p[2]=90;p[3]=255;}
    scaleRecordingBgra(source.data(),11*4,9,7,scaled.data(),4,4);
    require(scaled[0]==0 && scaled[12]==160 && scaled[49]==180 && scaled[61]==180 && scaled[60]==160,"resampling lost edges or row pitch");
    int cases=0;
    for(const auto input : std::vector<RecordingVideoFormat>{{1280,720,30},{1280,720,60},{3008,3264,30},{3008,3264,60},{3301,2251,60},{6018,3385,60}}){
      for(bool software : {false,true}){
        const std::string label=std::to_string(input.width)+"x"+std::to_string(input.height)+"-"+std::to_string(input.fps)+(software?"-software":"-default");
        MFEncoderOptions options;options.preferSoftwareEncoder=software;
        bool baselineAccepted=false;
        {MFEncoder baseline;baselineAccepted=baseline.initialize((output/(label+"-baseline.mp4")).wstring(),input.width,input.height,input.fps,18'000'000,device.Get(),context.Get(),nullptr,options);}
        RecordingVideoFormat selected{};
        auto encoder=initializeRecordingEncoder((output/(label+".mp4")).wstring(),input.width,input.height,input.fps,device.Get(),context.Get(),nullptr,options,selected);
        require(bool(encoder),"adaptive initialization failed");
        if(baselineAccepted)require(selected.width==(input.width&~1)&&selected.height==(input.height&~1)&&selected.fps==input.fps,"working native format changed");
        require(selected.width<=input.width&&selected.height<=input.height&&!(selected.width%2)&&!(selected.height%2),"output enlarged or misaligned");
        require(std::abs(double(selected.width)/selected.height-double(input.width)/input.height)<0.004,"aspect ratio changed");
        std::vector<BYTE> pixels(size_t(input.width)*input.height*4);
        for(int y=0;y<input.height;++y)for(int x=0;x<input.width;++x){
          auto p=&pixels[(size_t(y)*input.width+x)*4];
          const bool right=x>=input.width/2,bottom=y>=input.height/2;
          p[0]=bottom?255:0;p[1]=right?255:0;p[2]=!bottom&&!right?255:0;p[3]=255;
          if(x<20||y<20||x>=input.width-20||y>=input.height-20)p[0]=p[1]=p[2]=255;
        }
        D3D11_TEXTURE2D_DESC desc{};desc.Width=input.width;desc.Height=input.height;desc.MipLevels=1;desc.ArraySize=1;
        desc.Format=DXGI_FORMAT_B8G8R8A8_UNORM;desc.SampleDesc.Count=1;desc.Usage=D3D11_USAGE_DEFAULT;
        D3D11_SUBRESOURCE_DATA data{pixels.data(),UINT(input.width*4),0};Microsoft::WRL::ComPtr<ID3D11Texture2D> texture;
        require(SUCCEEDED(device->CreateTexture2D(&desc,&data,&texture)),"capture texture unavailable");
        for(int i=0;i<12;++i){Microsoft::WRL::ComPtr<IMFSample> sample;
          require(encoder->captureVideoSample(texture.Get(),int64_t(i)*10'000'000/selected.fps,nullptr,sample)&&encoder->submitVideoSample(sample.Get()),"capture/encode failed");
        }
        require(encoder->finalize(),"finalize failed");
        std::ofstream json(output/(label+".json"));
        json<<"{\"baselineAccepted\":"<<(baselineAccepted?"true":"false")<<",\"sourceWidth\":"<<input.width<<",\"sourceHeight\":"<<input.height
            <<",\"requestedFps\":"<<input.fps<<",\"width\":"<<selected.width<<",\"height\":"<<selected.height<<",\"fps\":"<<selected.fps<<",\"frames\":12}";
        std::cout<<"PASS "<<label<<" baseline="<<baselineAccepted<<" selected="<<selected.width<<"x"<<selected.height<<"@"<<selected.fps<<std::endl;++cases;
      }
    }
    std::cout<<"PASS "<<cases<<" real encoder cases and resampling/stride checks"<<std::endl;return 0;
 } catch(const std::exception& e){std::cerr<<"FAIL "<<e.what()<<std::endl;return 1;}
}
