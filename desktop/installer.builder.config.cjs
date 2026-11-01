const base=require('./builder.config.cjs');
const {OFFLINE_CHANNEL,distributionIdentity}=require('./distribution.cjs');
const identity=distributionIdentity({opentakeDistribution:OFFLINE_CHANNEL},'win32');
module.exports={...base,
 appId:identity.APP_ID,productName:identity.APP_NAME,executableName:identity.APP_NAME,
 directories:{...base.directories,output:'release/windows'},
 compression:'maximum',
 afterPack:require('./production-pack.cjs').afterPack,
 afterSign:require('./production-pack.cjs').finalizePayload,
 extraMetadata:{opentakeDistribution:OFFLINE_CHANNEL},
 extraResources:[{from:'../runtime-payload',to:'runtimes',filter:['**/*','!browsers/chromium-1243/**','!**/__pycache__/**','!**/*.pyc','!**/*.log']}],
 files:[...base.files,'WINDOWS-RUNTIME-NOTICES.md','!public/**','!desktop/*.test.*','!desktop/installer.builder.config.cjs','!desktop/build-installer.mjs','!desktop/prepare-runtimes.mjs','!desktop/build-app.mjs','!desktop/production-pack.cjs','!desktop/install-payload.cjs','!desktop/installer.nsh','!desktop/nsis/**','!desktop/installer-assets/**','!desktop/generate-installer-art.py','!desktop/python-sitecustomize.py','!**/*.map','!**/*.d.ts','!**/*.d.cts','!node_modules/lucide-react/**'],
 win:{...base.win,icon:'public/opentake.ico',signAndEditExecutable:true,signExecutable:false,target:['nsis'],requestedExecutionLevel:'asInvoker',artifactName:'OpenTake-Standard-Setup-${version}-x64.${ext}'},
 nsis:{oneClick:false,perMachine:false,allowElevation:false,packElevateHelper:false,
  allowToChangeInstallationDirectory:true,displayLanguageSelector:false,include:'desktop/installer.nsh',
  createDesktopShortcut:false,createStartMenuShortcut:true,shortcutName:identity.APP_NAME,
  uninstallDisplayName:identity.APP_NAME,deleteAppDataOnUninstall:false,runAfterFinish:true,
  installerIcon:'public/opentake.ico',uninstallerIcon:'public/opentake.ico',installerSidebar:'desktop/installer-assets/sidebar.bmp',uninstallerSidebar:'desktop/installer-assets/sidebar.bmp',differentialPackage:false,
  // One complete staging tree is verified before promotion. Upstream's default
  // split media files would otherwise be written only after that check.
  preCompressedFileExtensions:[],
  installerLanguages:['zh_CN','en_US'],language:'2052'},
};
