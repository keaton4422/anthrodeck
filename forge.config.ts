import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import MakerAppImage from '@reforged/maker-appimage';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { shipInto } = require('./tools/shipDeps.mjs');

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'AnthroDeck',
    executableName: 'anthrodeck',
    // Packager adds the platform extension: assets/icon.ico on Windows, assets/icon.icns on macOS.
    // All of them are rendered from assets/logo.svg by tools/renderIcons.cjs.
    icon: 'assets/icon',
    // The window icon on Linux (taskbar, Alt+Tab). Ships beside app.asar as resources/icon.png.
    extraResource: ['assets/icon.png'],
  },
  rebuildConfig: {},
  hooks: {
    // The Vite plugin sets packagerConfig.ignore to exclude everything outside /.vite, so the
    // package ships with NO node_modules. Anything marked external in vite.main.config.ts would
    // therefore be missing at runtime. This puts the un-bundlable ones back.
    packageAfterCopy: async (_config, buildPath) => {
      const shipped = shipInto(buildPath, __dirname);
      console.log(`  shipped ${shipped.length} un-bundlable packages into the app`);
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32', 'linux'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: { options: { categories: ['Utility'], icon: 'assets/icon.png' } },
    },
    // AppImage is the practical Steam Deck target: SteamOS is Arch-based with a read-only rootfs,
    // so a .deb can't be installed normally — an AppImage is chmod +x and run.
    new MakerAppImage({ options: { categories: ['Utility'], icon: 'assets/icon.png' } }, ['linux']),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
