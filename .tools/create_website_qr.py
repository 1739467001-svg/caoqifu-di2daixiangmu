"""Generate this site's QR locally: Model 2, version 2, level L, mask 0.

Pattern placement and GF arithmetic adapted from Project Nayuki's QR generator.
Copyright (c) Project Nayuki. MIT License.
https://www.nayuki.io/page/qr-code-generator-library

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
"""
from pathlib import Path
from PIL import Image, ImageDraw

URL = 'https://112.74.63.237/ai-youth/'
payload = URL.encode('utf-8')
bits = [int(c) for c in '0100' + f'{len(payload):08b}' + ''.join(f'{b:08b}' for b in payload)]
assert len(bits) <= 272
bits += [0] * min(4, 272-len(bits))
bits += [0] * (-len(bits) % 8)
data = [int(''.join(map(str, bits[i:i+8])), 2) for i in range(0,len(bits),8)]
pad = 0
while len(data) < 34:
    data.append((0xec,0x11)[pad % 2])
    pad += 1

def mul(x,y):
    z=0
    for i in reversed(range(8)):
        z=(z << 1) ^ ((z >> 7)*0x11d)
        z^=((y >> i)&1)*x
    return z

div=[0]*9+[1]
root=1
for _ in range(10):
    for j in range(10):
        div[j]=mul(div[j],root)
        if j<9: div[j]^=div[j+1]
    root=mul(root,2)
ecc=[0]*10
for b in data:
    factor=b^ecc.pop(0)
    ecc.append(0)
    for i,coef in enumerate(div): ecc[i]^=mul(coef,factor)
words=data+ecc
# Every Reed-Solomon syndrome must be zero.
root=1
for _ in range(10):
    syndrome=0
    for word in words: syndrome=mul(syndrome,root)^word
    assert syndrome==0
    root=mul(root,2)

n=25
m=[[False]*n for _ in range(n)]
fixed=[[False]*n for _ in range(n)]
def put(x,y,value):
    if 0<=x<n and 0<=y<n:
        m[y][x]=bool(value)
        fixed[y][x]=True
for i in range(n):
    put(6,i,i%2==0)
    put(i,6,i%2==0)
for cx,cy in [(3,3),(n-4,3),(3,n-4)]:
    for dy in range(-4,5):
        for dx in range(-4,5): put(cx+dx,cy+dy,max(abs(dx),abs(dy)) not in (2,4))
for dy in range(-2,3):
    for dx in range(-2,3): put(18+dx,18+dy,max(abs(dx),abs(dy))!=1)
fmt_data=8  # L=01, mask=000
rem=fmt_data
for _ in range(10): rem=(rem << 1)^((rem >> 9)*0x537)
fmt=((fmt_data << 10)|rem)^0x5412
def fb(i): return (fmt >> i)&1
for i in range(6): put(8,i,fb(i))
put(8,7,fb(6)); put(8,8,fb(7)); put(7,8,fb(8))
for i in range(9,15): put(14-i,8,fb(i))
for i in range(8): put(n-1-i,8,fb(i))
for i in range(8,15): put(8,n-15+i,fb(i))
put(8,n-8,True)
coords=[]
for right in range(n-1,0,-2):
    if right<=6: right-=1
    for vert in range(n):
        for j in range(2):
            x=right-j
            y=n-1-vert if (right+1)&2==0 else vert
            if not fixed[y][x]: coords.append((x,y))
assert len(coords)==359
for i,(x,y) in enumerate(coords):
    bit=(words[i//8] >> (7-i%8))&1 if i<352 else 0
    m[y][x]=bool(bit)^((x+y)%2==0)
# Read the encoded payload back from the finished matrix.
readbits=[int(m[y][x])^int((x+y)%2==0) for x,y in coords[:352]]
assert readbits[:4]==[0,1,0,0]
size=int(''.join(map(str,readbits[4:12])),2)
decoded=bytes(int(''.join(map(str,readbits[12+i*8:20+i*8])),2) for i in range(size))
assert decoded==payload
scale=20; border=4
im=Image.new('RGB',((n+border*2)*scale,)*2,'white')
draw=ImageDraw.Draw(im)
for y in range(n):
    for x in range(n):
        if m[y][x]:
            xx=(x+border)*scale; yy=(y+border)*scale
            draw.rectangle((xx,yy,xx+scale-1,yy+scale-1),fill='black')
out=Path(__file__).resolve().parents[1]/'发现网站二维码.png'
im.save(out)
print(out)
print('Encoded payload and error correction verified:',decoded.decode())
