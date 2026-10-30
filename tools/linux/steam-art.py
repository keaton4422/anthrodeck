#!/usr/bin/env python3
# steam-art.py [--dry-run]: give AnthroDeck's non-Steam shortcut its library art and its icon.
#
# The art (portrait, wide, hero, logo) goes in each Steam user's config/grid/ under the shortcut's
# app id. The icon is the shortcut's own `icon` field in config/shortcuts.vdf: it's what the Steam
# menu's list of running games shows, and without it AnthroDeck is a blank square there.
#
# Steam rewrites shortcuts.vdf from memory, so close Steam first (in Game Mode: Power → Switch to
# Desktop, then quit Steam; or run this from SSH after `steam -shutdown`). Run from the repo:
#   python3 tools/linux/steam-art.py
import glob, os, shutil, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', '..', 'assets')
ICON_DEST = os.path.expanduser('~/.local/share/anthrodeck/icon.png')
GRID = {'p.png': 'portrait.png', '.png': 'wide.png', '_hero.png': 'hero.png', '_logo.png': 'logo.png'}

# Binary KeyValues: 0x00 map, 0x01 string, 0x02 int32, 0x08 end of map.
def parse(d, i=0):
    out = []
    while True:
        t = d[i]; i += 1
        if t == 8: return out, i
        j = d.index(b'\0', i); k = d[i:j].decode('utf-8', 'replace'); i = j + 1
        if t == 0: v, i = parse(d, i)
        elif t == 1: j = d.index(b'\0', i); v = d[i:j].decode('utf-8', 'replace'); i = j + 1
        elif t == 2: v = struct.unpack_from('<I', d, i)[0]; i += 4
        else: raise ValueError('unknown type %d at %d' % (t, i - 1))
        out.append((k, t, v))

def dump(items):
    b = b''
    for k, t, v in items:
        b += bytes([t]) + k.encode() + b'\0'
        if t == 0: b += dump(v) + b'\x08'
        elif t == 1: b += v.encode() + b'\0'
        elif t == 2: b += struct.pack('<I', v)
    return b

def steam_running():
    return any(open(p, 'rb').read().split(b'\0')[0].endswith(b'/steam')
               for p in glob.glob('/proc/[0-9]*/cmdline') if os.access(p, os.R_OK))

def main():
    dry = '--dry-run' in sys.argv
    if steam_running() and not dry:
        sys.exit('Steam is running: it would overwrite the change. Close it first (see the top of this file).')
    if not dry:
        os.makedirs(os.path.dirname(ICON_DEST), exist_ok=True)
        shutil.copyfile(os.path.join(ASSETS, 'icons', '256x256.png'), ICON_DEST)
    found = False
    for vdf in glob.glob(os.path.expanduser('~/.local/share/Steam/userdata/*/config/shortcuts.vdf')):
        raw = open(vdf, 'rb').read()
        top, _ = parse(raw, 0)
        if dump(top) + b'\x08' != raw:   # only write a file this reads back exactly
            print('%s: not understood, left alone' % vdf); continue
        changed = False
        for _, _, shortcuts in top:
            for _, _, entry in shortcuts:
                fields = {k: v for k, _, v in entry}
                if 'AnthroDeck' not in str(fields.get('Exe', '')) and fields.get('AppName') != 'AnthroDeck': continue
                found = True
                appid = fields.get('appid')
                print('%s: AnthroDeck is %s, icon %r' % (vdf, appid, fields.get('icon', '')))
                if fields.get('icon') != ICON_DEST:
                    entry[:] = [(k, t, ICON_DEST if k == 'icon' else v) for k, t, v in entry]
                    if 'icon' not in fields: entry.append(('icon', 1, ICON_DEST))
                    changed = True
                grid = os.path.join(os.path.dirname(vdf), 'grid')
                for suffix, name in GRID.items():
                    dest = os.path.join(grid, '%d%s' % (appid, suffix))
                    print('  %s -> %s' % (name, dest))
                    if not dry:
                        os.makedirs(grid, exist_ok=True)
                        shutil.copyfile(os.path.join(ASSETS, 'steam', 'png', name), dest)
        if changed and not dry:
            shutil.copyfile(vdf, vdf + '.bak')
            open(vdf, 'wb').write(dump(top) + b'\x08')
            print('  icon -> %s (backup: %s.bak)' % (ICON_DEST, vdf))
    if not found: sys.exit('No AnthroDeck shortcut found. Add it to Steam first (Add a Non-Steam Game).')

if __name__ == '__main__':
    main()
