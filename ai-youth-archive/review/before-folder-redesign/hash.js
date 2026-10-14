// SHA-256 for local draft fingerprints, including plain-HTTP deployments.
// This does not sign credentials or verify an issuer's identity.
async function draftDigest(bytes) {
  if (globalThis.crypto?.subtle) return crypto.subtle.digest('SHA-256', bytes);
  const constants = new Uint32Array(64), h = new Uint32Array(8);
  let prime = 2, found = 0;
  while (found < 64) {
    let valid = true;
    for (let i = 2; i * i <= prime; i++) if (prime % i === 0) { valid = false; break; }
    if (valid) {
      if (found < 8) h[found] = (Math.sqrt(prime) % 1) * 0x100000000;
      constants[found++] = (Math.cbrt(prime) % 1) * 0x100000000;
    }
    prime++;
  }
  const data = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  data.set(bytes); data[bytes.length] = 128;
  const view = new DataView(data.buffer);
  view.setUint32(data.length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(data.length - 4, bytes.length * 8);
  const w = new Uint32Array(64), rotate = (x, n) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      w[i] = w[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) + w[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10));
    }
    let [a,b,c,d,e,f,g,k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotate(e,6) ^ rotate(e,11) ^ rotate(e,25)) + ((e & f) ^ (~e & g)) + constants[i] + w[i]) >>> 0;
      const t2 = ((rotate(a,2) ^ rotate(a,13) ^ rotate(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      k=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    [a,b,c,d,e,f,g,k].forEach((v,i) => h[i] = h[i] + v);
  }
  const result = new DataView(new ArrayBuffer(32));
  h.forEach((v,i) => result.setUint32(i * 4, v));
  return result.buffer;
}
