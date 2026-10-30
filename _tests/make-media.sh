#!/bin/bash
# Regenerates the test media that is too large to keep in git. Needs ffmpeg. Idempotent.
#   bash _tests/make-media.sh            → pass2/media/sync5m.webm (≈60 MB, 5 min A/V-sync clip)
#   bash _tests/make-media.sh --longform → also the 10-hour long-form set (≈7.5 GB, see cutline/longform/build_media.sh)
set -e
cd "$(dirname "$0")"
command -v ffmpeg >/dev/null || { echo "ffmpeg not found"; exit 1; }
S=cutline/pass2/media/sync5m.webm
if [ ! -f "$S" ]; then
  # 1280×720 @ 30 fps, 5 min. A 14-bit frame code sits in a strip at y=654: cell k (LSB first) is a 48-px white box at
  # x = 16 + 56k when bit k of the frame number is set (x4_av.js reads it back from the program canvas).
  # Audio: 1 kHz beep for 50 ms every 2 s on silence.
  boxes=""
  for k in $(seq 0 13); do boxes="$boxes,drawbox=x=$((16 + 56 * k)):y=654:w=48:h=48:color=white:t=fill:enable='eq(mod(floor(n/pow(2\,$k))\,2)\,1)'"; done
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=s=1280x720:r=30:d=300" \
    -f lavfi -i "sine=f=1000:r=48000:d=300,volume='if(lt(mod(t\,2)\,0.05),1,0)':eval=frame" \
    -vf "drawbox=x=0:y=640:w=1280:h=80:color=black:t=fill$boxes" \
    -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 1500k -g 60 -c:a libopus -b:a 96k -shortest "$S"
  echo "wrote $S"
fi
if [ "$1" = "--longform" ]; then bash cutline/longform/build_media.sh; fi
echo "media ready"
