#!/bin/bash
# Encode one ~150 s "hour variant" segment: 1280x720@60 VP9 + Opus, with a per-frame binary code strip
# (14 bits = frame index within segment, 4 bits = hour) and periodic loud audio bursts at 37 s and 112 s.
# usage: gen_variant.sh HOUR VBITRATE OUT [DUR]
H=$1; VB=$2; OUT=$3; D=${4:-150}
F="noise=alls=7:allf=t,drawbox=x=0:y=636:w=1280:h=84:color=black:t=fill"
for k in $(seq 0 13); do F="$F,drawbox=x=$((16+56*k)):y=654:w=48:h=48:color=white:t=fill:enable='mod(floor(n/pow(2\,$k))\,2)'"; done
for k in 0 1 2 3; do if [ $(( (H >> k) & 1 )) = 1 ]; then F="$F,drawbox=x=$((16+56*(15+k))):y=654:w=48:h=48:color=white:t=fill"; fi; done
F="$F,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:fontsize=56:fontcolor=white:box=1:boxcolor=black@0.6:x=40:y=40:text='HOUR $H  +%{pts\:hms}'"
A="0.025*(random(0)*2-1)*(1+0.3*sin(2*PI*t/7))+if(between(mod(t\,150)\,37\,38.5)\,0.5*sin(2*PI*330*t)+0.2*(random(1)*2-1)\,0)+if(between(mod(t\,150)\,112\,116)\,0.3*sin(2*PI*220*t)+0.1*(random(2)*2-1)\,0)"
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=s=1280x720:r=60:d=$D" -f lavfi -i "aevalsrc=exprs=$A|$A:s=48000:d=$D" \
  -vf "$F" -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -row-mt 1 -threads 2 -b:v $VB -minrate $VB -maxrate $VB -g 120 -keyint_min 120 \
  -c:a libopus -b:a 64k -shortest "$OUT"
