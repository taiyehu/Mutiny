import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";

function unpackSwf(packed) {
  const signature = packed.subarray(0, 3).toString("ascii");
  if (signature === "FWS") return packed;
  if (signature === "CWS") {
    const header = Buffer.from(packed.subarray(0, 8));
    header.write("FWS", 0, "ascii");
    return Buffer.concat([header, zlib.inflateSync(packed.subarray(8))]);
  }
  if (signature === "ZWS") throw new Error("暂不支持 LZMA 压缩的 ZWS 文件");
  throw new Error(`不是有效的 SWF 文件：${signature || "无签名"}`);
}

function readBits(buffer, state, count, signed = false) {
  let value = 0;
  for (let index = 0; index < count; index += 1) {
    const byte = buffer[state.bit >> 3];
    value = value * 2 + ((byte >> (7 - (state.bit & 7))) & 1);
    state.bit += 1;
  }
  if (signed && value >= 2 ** (count - 1)) value -= 2 ** count;
  return value;
}

export function inspectSwf(packed) {
  const swf = unpackSwf(packed);
  const declaredLength = packed.readUInt32LE(4);
  if (swf.length !== declaredLength) throw new Error(`SWF 解压长度不匹配：声明 ${declaredLength}，实际 ${swf.length}`);
  const state = { bit: 64 };
  const bits = readBits(swf, state, 5);
  const xMin = readBits(swf, state, bits, true);
  const xMax = readBits(swf, state, bits, true);
  const yMin = readBits(swf, state, bits, true);
  const yMax = readBits(swf, state, bits, true);
  const headerOffset = Math.ceil(state.bit / 8);
  return {
    signature: packed.subarray(0, 3).toString("ascii"),
    version: packed[3],
    declaredLength,
    width: (xMax - xMin) / 20,
    height: (yMax - yMin) / 20,
    frameRate: swf.readUInt16LE(headerOffset) / 256,
    frameCount: swf.readUInt16LE(headerOffset + 2),
    unpacked: swf,
  };
}

export function extractInnerSwf(inputPath, outputPath) {
  const outerPacked = fs.readFileSync(inputPath);
  const outer = inspectSwf(outerPacked).unpacked;
  const rectBits = outer[8] >> 3;
  let offset = 8 + Math.ceil((5 + 4 * rectBits) / 8) + 4;
  const candidates = [];

  while (offset + 2 <= outer.length) {
    const header = outer.readUInt16LE(offset);
    offset += 2;
    const code = header >> 6;
    let length = header & 63;
    if (length === 63) {
      if (offset + 4 > outer.length) break;
      length = outer.readUInt32LE(offset);
      offset += 4;
    }
    if (offset + length > outer.length) throw new Error("外层 SWF 标签长度越界");
    if (code === 87 && length > 6) {
      const payload = outer.subarray(offset + 6, offset + length);
      if (["FWS", "CWS", "ZWS"].includes(payload.subarray(0, 3).toString("ascii"))) candidates.push(Buffer.from(payload));
    }
    offset += length;
    if (code === 0) break;
  }

  if (candidates.length !== 1) throw new Error(`预期找到 1 个内嵌 SWF，实际找到 ${candidates.length} 个`);
  const game = candidates[0];
  const metadata = inspectSwf(game);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, game);
  return {
    ...metadata,
    unpacked: undefined,
    packedBytes: game.length,
    sha256: crypto.createHash("sha256").update(game).digest("hex"),
    inputPath,
    outputPath,
  };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const inputPath = path.resolve(process.argv[2] || path.join(projectRoot, "mutiny.swf"));
  const outputPath = path.resolve(process.argv[3] || path.join(projectRoot, "local-player", "mutiny-game.swf"));
  const result = extractInnerSwf(inputPath, outputPath);
  console.log("内层 SWF 提取完成");
  console.log(`输出：${result.outputPath}`);
  console.log(`格式：${result.signature} v${result.version}`);
  console.log(`舞台：${result.width} × ${result.height}，${result.frameRate} fps`);
  console.log(`大小：${result.packedBytes} bytes`);
  console.log(`SHA-256：${result.sha256}`);
}
