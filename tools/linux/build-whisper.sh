#!/usr/bin/env bash
# Builds the on-device speech engine the Linux app ships with (resources/whisper): whisper.cpp's
# whisper-cli, linked statically so it runs on SteamOS as-is, plus a small English model. The Deck
# has no speech service of its own and Chromium's speech API doesn't work inside Electron, so this
# is how the Deck hears the pilot (src/main/whisperTranscriber.ts).
#
# Both inputs are pinned: the source to a commit, the model to a checksum.
#
#   tools/linux/build-whisper.sh [out-dir]     (default: build/whisper)
set -euo pipefail

WHISPER_TAG=v1.9.5
WHISPER_COMMIT=d1be6fde11ac6e0407606b4e42fe72d34add8037
MODEL=ggml-base.en-q5_1.bin
MODEL_SHA256=4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f

root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$(mkdir -p "${1:-$root/build/whisper}" && cd "${1:-$root/build/whisper}" && pwd)"
work="$root/build/whisper-src"

if [ ! -d "$work/.git" ]; then
  git clone --quiet --depth 1 --branch "$WHISPER_TAG" https://github.com/ggml-org/whisper.cpp "$work"
fi
got="$(git -C "$work" rev-parse HEAD)"
[ "$got" = "$WHISPER_COMMIT" ] || { echo "whisper.cpp $WHISPER_TAG is $got, expected $WHISPER_COMMIT" >&2; exit 1; }

# The Steam Deck's CPU (Zen 2) has AVX2, FMA and F16C; the build machine's own extras are left out.
# No OpenMP and a static C++ runtime, so the binary needs nothing beyond glibc.
cmake -S "$work" -B "$work/build" -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
  -DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON -DGGML_OPENMP=OFF \
  -DCMAKE_EXE_LINKER_FLAGS="-static-libgcc -static-libstdc++" >/dev/null
cmake --build "$work/build" --config Release --target whisper-cli -j "$(nproc 2>/dev/null || echo 4)" >/dev/null
install -m 755 "$work/build/bin/whisper-cli" "$out/whisper-cli"

if ! echo "$MODEL_SHA256  $out/$MODEL" | sha256sum -c --status 2>/dev/null; then
  curl -fsSL -o "$out/$MODEL.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$MODEL"
  echo "$MODEL_SHA256  $out/$MODEL.part" | sha256sum -c --quiet
  mv "$out/$MODEL.part" "$out/$MODEL"
fi

ldd "$out/whisper-cli" || true
ls -la "$out"
