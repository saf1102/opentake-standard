module.exports = {
 appId:'top.opentake.standard',productName:'OpenTake Standard',asar:false,
 directories:{output:'release'},electronDist:'node_modules/electron/dist',
 files:['release-source.json','desktop/**','dist/**','server/**','src/**','shared/**','!vendor/**','public/**','upgrade.json','vite.config.ts','package.json','LICENSE','NOTICE','TRADEMARK.md','THIRD-PARTY-LICENSES.json','licenses/**','!**/*.test.*','!desktop/build-app.mjs','!desktop/builder.config.cjs'],
 extraResources:[{from:'node_modules/electron/dist/LICENSE',to:'electron-LICENSE'},{from:'node_modules/electron/dist/LICENSES.chromium.html',to:'LICENSES.chromium.html'}],
 npmRebuild:false,
 win:{target:['dir'],icon:'public/opentake-icon-512.png',signAndEditExecutable:false},
 // Builder only assembles. build-app.mjs MUST clear attributes, ad-hoc sign and strictly verify afterwards.
 mac:{target:['dir'],identity:null,icon:'release/OpenTake.icns',category:'public.app-category.video',extendInfo:{CFBundleDisplayName:'OpenTake Standard',CFBundleName:'OpenTake Standard',NSScreenCaptureUsageDescription:'录制你选择的屏幕或窗口，制作演示视频。'}},
};
