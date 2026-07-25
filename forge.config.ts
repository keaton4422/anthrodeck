import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import MakerAppImage from '@reforged/maker-appimage';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'AnthroDeck',
    executableName: 'anthrodeck',
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32', 'linux'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: { options: { categories: ['Utility'] } },
    },
    // AppImage is the practical Steam Deck target: SteamOS is Arch-based with a read-only rootfs,
    // so a .deb can't be installed normally — an AppImage is chmod +x and run.
    new MakerAppImage({ options: { categories: ['Utility'] } }, ['linux']),
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
