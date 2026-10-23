import assert from 'node:assert/strict';
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function unzip(b) {
  const end = b.length - 22;
  assert.equal(b.readUInt32LE(end), 0x06054b50);
  const count = b.readUInt16LE(end + 10), start = b.readUInt32LE(end + 16);
  assert.equal(start + b.readUInt32LE(end + 12), end);
  const out = new Map(); let at = start;
  for (let n = 0; n < count; n++) {
    assert.equal(b.readUInt32LE(at), 0x02014b50);
    const len = b.readUInt32LE(at + 20), nameLen = b.readUInt16LE(at + 28), extra = b.readUInt16LE(at + 30), comment = b.readUInt16LE(at + 32);
    const name = b.toString('utf8', at + 46, at + 46 + nameLen), offset = b.readUInt32LE(at + 42);
    assert(!out.has(name)); assert(!name.includes('..')); assert.equal(b.readUInt16LE(at + 10), 0);
    assert.equal(b.readUInt32LE(offset), 0x04034b50);
    assert.equal(b.readUInt16LE(offset + 8), 0);
    const localLen = b.readUInt16LE(offset + 26), localExtra = b.readUInt16LE(offset + 28);
    assert.equal(b.toString('utf8', offset + 30, offset + 30 + localLen), name);
    const data = b.subarray(offset + 30 + localLen + localExtra, offset + 30 + localLen + localExtra + len);
    assert.equal(data.length, len); assert.equal(crc32(data), b.readUInt32LE(at + 16)); assert.equal(crc32(data), b.readUInt32LE(offset + 14));
    out.set(name, data); at += 46 + nameLen + extra + comment;
  }
  assert.equal(at, end);
  return out;
}
export { unzip as readPptx };
