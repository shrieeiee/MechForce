import sys, struct, os
data = open(sys.argv[1], 'rb').read()
out = sys.argv[2]
BS = 512
def blk(n): return data[n*BS:(n+1)*BS]
def l(b, off): return struct.unpack('>l', b[off:off+4])[0] if off >= 0 else struct.unpack('>l', b[BS+off:BS+off+4])[0]
def L(b, off): return struct.unpack('>L', b[off:off+4])[0] if off >= 0 else struct.unpack('>L', b[BS+off:BS+off+4])[0]
ffs = data[3] & 1
print('FFS' if ffs else 'OFS')
root = 880
def name(b):
    n = b[BS-80]
    return b[BS-79:BS-79+n].decode('latin1')
def read_file(hb):
    size = L(hb, -188)
    blocks = []
    b = hb
    while True:
        cnt = L(b, 8)
        for i in range(cnt):
            blocks.append(L(b, BS-204-4*i))
        ext = L(b, -8)
        if not ext: break
        b = blk(ext)
    res = b''
    for d in blocks:
        db = blk(d)
        res += db if ffs else db[24:24+L(db, 12)]
    return res[:size]
def walk(bn, path):
    b = blk(bn)
    for i in range(72):
        h = L(b, 24+4*i)
        while h:
            hb = blk(h)
            st = l(hb, -4)
            nm = name(hb)
            p = os.path.join(path, nm)
            if st == 2:
                os.makedirs(p, exist_ok=True); walk(h, p)
            elif st == -3:
                d = read_file(hb)
                open(p, 'wb').write(d)
                print(len(d), p)
            h = L(hb, -16)
os.makedirs(out, exist_ok=True)
walk(root, out)
