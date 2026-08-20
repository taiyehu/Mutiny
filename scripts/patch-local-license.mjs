import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const inputPath = path.resolve(process.argv[2] || "local-player/mutiny-game.swf");
const outputPath = path.resolve(process.argv[3] || "local-player/mutiny-game-local.swf");

function unpackSwf(input) {
  const signature = input.subarray(0, 3).toString("ascii");
  if (signature === "FWS") return Buffer.from(input);
  if (signature !== "CWS") throw new Error(`暂不支持 ${signature} SWF`);
  return Buffer.concat([Buffer.from("FWS"), input.subarray(3, 8), zlib.inflateSync(input.subarray(8))]);
}

function readCString(buffer, start, limit = buffer.length) {
  let end = start;
  while (end < limit && buffer[end] !== 0) end += 1;
  if (end >= limit) throw new Error("AS2 字符串没有结束符");
  return { value: buffer.subarray(start, end).toString("utf8"), next: end + 1 };
}

function readConstantPool(data) {
  const count = data.readUInt16LE(0);
  const pool = [];
  let cursor = 2;
  for (let index = 0; index < count; index += 1) {
    const string = readCString(data, cursor);
    pool.push(string.value);
    cursor = string.next;
  }
  return pool;
}

function readPushStrings(data, pool) {
  const strings = [];
  let cursor = 0;
  while (cursor < data.length) {
    const type = data[cursor++];
    if (type === 0) {
      const string = readCString(data, cursor);
      strings.push(string.value); cursor = string.next;
    } else if (type === 1 || type === 7) cursor += 4;
    else if (type === 2 || type === 3) continue;
    else if (type === 4 || type === 5 || type === 8) {
      const value = data[cursor++];
      if (type === 8 && typeof pool[value] === "string") strings.push(pool[value]);
    } else if (type === 6) cursor += 8;
    else if (type === 9) {
      const value = data.readUInt16LE(cursor); cursor += 2;
      if (typeof pool[value] === "string") strings.push(pool[value]);
    } else throw new Error(`未知 ActionPush 类型 ${type}`);
  }
  return strings;
}

function readFunctionCodeSize(actionCode, data) {
  let cursor = readCString(data, 0).next;
  const parameterCount = data.readUInt16LE(cursor); cursor += 2;
  if (actionCode === 0x8e) {
    cursor += 3;
    for (let index = 0; index < parameterCount; index += 1) {
      cursor += 1;
      cursor = readCString(data, cursor).next;
    }
  } else {
    for (let index = 0; index < parameterCount; index += 1) cursor = readCString(data, cursor).next;
  }
  return data.readUInt16LE(cursor);
}

function patchGetNitrome(actions, absoluteStart) {
  let cursor = 0;
  let pool = [];
  let previousPushStrings = [];
  while (cursor < actions.length) {
    const code = actions[cursor++];
    if (code === 0) break;
    let length = 0;
    if (code >= 0x80) { length = actions.readUInt16LE(cursor); cursor += 2; }
    const dataStart = cursor;
    const data = actions.subarray(dataStart, dataStart + length);
    cursor += length;
    if (code === 0x88) pool = readConstantPool(data);
    if (code === 0x96) previousPushStrings = readPushStrings(data, pool);
    if (code !== 0x9b && code !== 0x8e) continue;

    const codeSize = readFunctionCodeSize(code, data);
    const functionName = previousPushStrings.at(-1);
    if (functionName === "getNitrome") {
      const body = actions.subarray(cursor, cursor + codeSize);
      const expectedPrefix = Buffer.from([0x96, 0x02, 0x00, 0x05, 0x00]);
      if (!body.subarray(0, expectedPrefix.length).equals(expectedPrefix)) {
        throw new Error("getNitrome() 结构与预期不符；为避免损坏文件，未应用补丁");
      }
      body[4] = 1;
      return absoluteStart + cursor + 4;
    }
    cursor += codeSize;
  }
  return null;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

const original = fs.readFileSync(inputPath);
const swf = unpackSwf(original);
let cursor = 8;
cursor += Math.ceil((5 + (swf[cursor] >> 3) * 4) / 8) + 4;
let patchedOffset = null;

while (cursor + 2 <= swf.length) {
  const header = swf.readUInt16LE(cursor);
  const tagCode = header >> 6;
  let length = header & 0x3f;
  let headerSize = 2;
  if (length === 0x3f) { length = swf.readUInt32LE(cursor + 2); headerSize = 6; }
  const dataStart = cursor + headerSize;
  if (tagCode === 59 && length >= 2 && swf.readUInt16LE(dataStart) === 2007) {
    patchedOffset = patchGetNitrome(swf.subarray(dataStart + 2, dataStart + length), dataStart + 2);
    if (patchedOffset !== null) break;
  }
  cursor = dataStart + length;
  if (tagCode === 0) break;
}

if (patchedOffset === null) throw new Error("没有找到经过验证的 NitromeGame.getNitrome() 锁定逻辑");

const output = Buffer.concat([Buffer.from("CWS"), swf.subarray(3, 8), zlib.deflateSync(swf.subarray(8), { level: 9 })]);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output);

console.log("本地许可补丁已生成");
console.log(`输入：${inputPath}`);
console.log(`输出：${outputPath}`);
console.log(`修改：解压数据偏移 ${patchedOffset}，getNitrome() 默认值 false → true`);
console.log(`原始 SHA-256：${sha256(original)}`);
console.log(`补丁 SHA-256：${sha256(output)}`);
