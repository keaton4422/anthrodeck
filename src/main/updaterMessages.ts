// Maps an electron-updater failure to guidance a pilot can act on. The raw errors are unhelpful
// out of context: "APPIMAGE env is not defined" really means "you installed the .deb or unzipped
// build, and only the AppImage can replace itself in place".
export function updaterErrorMessage(raw: string): string {
  if (/APPIMAGE env is not defined/i.test(raw)) {
    return 'Self-update needs the AppImage build. Re-download the .AppImage from GitHub Releases '
      + 'and point your Steam shortcut at it — after that, updates happen in-app.';
  }
  if (/404|latest.*\.yml|Cannot find|ENOENT/i.test(raw)) {
    return 'No update metadata for that release — download the latest build from GitHub manually.';
  }
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|network/i.test(raw)) {
    return 'Could not reach GitHub to check for updates. Check the Deck\'s network connection.';
  }
  if (/sha512|checksum/i.test(raw)) {
    return 'The downloaded update failed its checksum and was discarded. Try again.';
  }
  return raw;
}
