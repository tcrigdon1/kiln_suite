#!/bin/bash
# Builds the long-form test media (≈7.5 GB total). Idempotent: skips outputs that already exist.
set -e
cd "$(dirname "$0")"
M=media; S=media/scratch; mkdir -p $M $S
for H in 0 1 2 3 4 5 6 7 8 9; do
  [ -f $S/hi_$H.webm ] || ./gen_variant.sh $H 1000k $S/hi_$H.webm
  [ -f $S/lo_$H.webm ] || ./gen_variant.sh $H 520k $S/lo_$H.webm
done
# 24 copies of each hour's 150 s variant = 10 h
rm -f $S/hi.txt $S/lo.txt $S/lo1h.txt
for H in 0 1 2 3 4 5 6 7 8 9; do for c in $(seq 1 24); do echo "file 'hi_$H.webm'" >> $S/hi.txt; echo "file 'lo_$H.webm'" >> $S/lo.txt; done; done
for c in $(seq 1 24); do echo "file 'lo_0.webm'" >> $S/lo1h.txt; done
[ -f $M/vod10h.webm ] || ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i $S/lo.txt -c copy $M/vod10h.webm
# MP4 (VP9 + Opus), moov at the end (no faststart); > 4 GiB so ffmpeg writes co64 chunk offsets
[ -f $M/vod10h.mp4 ] || ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i $S/hi.txt -c copy -strict -2 -f mp4 $M/vod10h.mp4
# 1 h WebM written to a pipe: no Cues, unknown-size Segment/Clusters (like live/recorded files)
[ -f $M/nocues1h.webm ] || ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i $S/lo1h.txt -c copy -live 1 -f webm pipe:1 > $M/nocues1h.webm
# short real H.264/AAC MP4 with the moov at the end (parser check; headless Chromium cannot decode it)
[ -f $M/h264_aac_moovend.mp4 ] || ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=s=640x360:r=30:d=20" -f lavfi -i "sine=f=440:d=20" \
  -c:v libx264 -preset veryfast -bf 2 -g 60 -c:a aac -b:a 96k -movflags +empty_moov-empty_moov $M/h264_aac_moovend.mp4 2>/dev/null || \
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=s=640x360:r=30:d=20" -f lavfi -i "sine=f=440:d=20" -c:v libx264 -preset veryfast -bf 2 -g 60 -c:a aac -b:a 96k $M/h264_aac_moovend.mp4
# raw MPEG-TS (as some downloaders leave HLS segments)
[ -f $M/segment.ts ] || ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=s=320x180:r=30:d=3" -f lavfi -i "sine=d=3" -c:v libx264 -preset veryfast -c:a aac -f mpegts $M/segment.ts
# variable frame rate (irregular dropped frames, like a struggling stream encoder): 20 s cut from a 60 fps variant
[ -f $M/vfr.webm ] || ffmpeg -hide_banner -loglevel error -y -i $S/lo_2.webm -t 20 -vf "select='not(eq(mod(n\,7)\,3))*not(eq(mod(n\,11)\,5))*not(between(mod(n\,97)\,40\,47))'" -fps_mode vfr -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 800k -g 120 -c:a copy $M/vfr.webm
ls -la $M
echo BUILD DONE
