import { describe, it, expect } from 'vitest';
import { envWithoutOverlay, relaunchTarget, RELAUNCHED_FLAG } from '../steamOverlay';

// What Steam actually sets on the Deck: both the 32- and 64-bit overlay libraries.
const STEAM_PRELOAD = '/home/deck/.local/share/Steam/ubuntu12_32/gameoverlayrenderer.so:'
  + '/home/deck/.local/share/Steam/ubuntu12_64/gameoverlayrenderer.so';

describe('envWithoutOverlay', () => {
  it('strips the overlay and marks the relaunch', () => {
    const next = envWithoutOverlay({ LD_PRELOAD: STEAM_PRELOAD, HOME: '/home/deck' }, 'linux');
    expect(next).not.toBeNull();
    expect(next!.LD_PRELOAD).toBeUndefined();
    expect(next![RELAUNCHED_FLAG]).toBe('1');
    expect(next!.HOME).toBe('/home/deck');
  });

  it('keeps any other preloaded library, whatever the separator', () => {
    const next = envWithoutOverlay({ LD_PRELOAD: `/usr/lib/libfoo.so ${STEAM_PRELOAD}` }, 'linux');
    expect(next!.LD_PRELOAD).toBe('/usr/lib/libfoo.so');
  });

  it('does nothing without the overlay, off Linux, or in the relaunched process', () => {
    expect(envWithoutOverlay({}, 'linux')).toBeNull();
    expect(envWithoutOverlay({ LD_PRELOAD: '/usr/lib/libfoo.so' }, 'linux')).toBeNull();
    expect(envWithoutOverlay({ LD_PRELOAD: STEAM_PRELOAD }, 'darwin')).toBeNull();
    expect(envWithoutOverlay({ LD_PRELOAD: STEAM_PRELOAD, [RELAUNCHED_FLAG]: '1' }, 'linux')).toBeNull();
  });

  it('only matches the overlay library itself', () => {
    expect(envWithoutOverlay({ LD_PRELOAD: '/opt/notgameoverlayrenderer.so.bak' }, 'linux')).toBeNull();
  });
});

describe('relaunchTarget', () => {
  it('relaunches an AppImage through the AppImage, keeping the arguments', () => {
    const t = relaunchTarget(
      { APPIMAGE: '/home/deck/Applications/AnthroDeck.AppImage' },
      '/tmp/.mount_Anthro123/usr/lib/anthrodeck/anthrodeck',
      ['/tmp/.mount_Anthro123/usr/lib/anthrodeck/anthrodeck', '--software-render'],
    );
    expect(t).toEqual({ command: '/home/deck/Applications/AnthroDeck.AppImage', args: ['--software-render'] });
  });

  it('relaunches its own executable otherwise', () => {
    expect(relaunchTarget({}, '/opt/anthrodeck/anthrodeck', ['/opt/anthrodeck/anthrodeck']))
      .toEqual({ command: '/opt/anthrodeck/anthrodeck', args: [] });
  });
});
