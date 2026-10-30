# Quick ISO-BMFF top-level box dump + sample-table box types inside moov (verifies moov-at-end and co64)
import struct, sys
f = open(sys.argv[1], 'rb'); size = f.seek(0, 2); off = 0; moov = None
while off + 8 <= size:
    f.seek(off); s, t = struct.unpack('>I4s', f.read(8)); hdr = 8
    if s == 1: s = struct.unpack('>Q', f.read(8))[0]; hdr = 16
    elif s == 0: s = size - off
    print('top %-4s @ %d size %d%s' % (t.decode(), off, s, ' (64-bit size)' if hdr == 16 else ''))
    if t == b'moov': moov = (off, s)
    off += s
def walk(b, o, e, depth, path):
    while o + 8 <= e:
        s, t = struct.unpack('>I4s', b[o:o+8]); t = t.decode('latin1')
        if s < 8: break
        if t in ('stco', 'co64', 'stsz', 'stss', 'stts', 'ctts', 'stsc'):
            n = struct.unpack('>I', b[o+12:o+16])[0] if t != 'stsz' else struct.unpack('>I', b[o+16:o+20])[0]
            print('  ' + '/'.join(path + [t]) + ' entries=%d' % n)
        if t in ('trak', 'mdia', 'minf', 'stbl', 'edts'): walk(b, o + 8, o + s, depth + 1, path + [t])
        if t == 'elst': print('  ' + '/'.join(path + [t]) + ' raw=' + b[o+8:o+s].hex())
        if t == 'hdlr': path_h = b[o+16:o+20].decode(); print('  ' + '/'.join(path) + ' handler=' + path_h)
        o += s
if moov:
    f.seek(moov[0]); b = f.read(moov[1]); walk(b, 8, len(b), 0, [])
