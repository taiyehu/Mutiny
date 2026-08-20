import fs from "node:fs";
import zlib from "node:zlib";

const inputPath = process.argv[2] || "local-player/mutiny-game.swf";
const needle = (process.argv[3] || "nitrome").toLowerCase();

function unpackSwf(input) {
  const signature = input.subarray(0, 3).toString("ascii");
  if (signature === "FWS") return Buffer.from(input);
  if (signature !== "CWS") throw new Error(`暂不支持 ${signature} SWF`);
  return Buffer.concat([Buffer.from("FWS"), input.subarray(3, 8), zlib.inflateSync(input.subarray(8))]);
}

function readCString(buffer, start, limit = buffer.length) {
  let end = start;
  while (end < limit && buffer[end] !== 0) end += 1;
  return { value: buffer.subarray(start, end).toString("utf8"), next: Math.min(end + 1, limit) };
}

function readPushValues(data, pool) {
  const values = [];
  let cursor = 0;
  while (cursor < data.length) {
    const type = data[cursor++];
    if (type === 0) {
      const string = readCString(data, cursor);
      values.push({ type: "string", value: string.value });
      cursor = string.next;
    } else if (type === 1) {
      values.push({ type: "float", value: data.readFloatLE(cursor) }); cursor += 4;
    } else if (type === 2 || type === 3) {
      values.push({ type: type === 2 ? "null" : "undefined", value: null });
    } else if (type === 4) {
      values.push({ type: "register", value: data[cursor++] });
    } else if (type === 5) {
      values.push({ type: "boolean", value: data[cursor++] !== 0 });
    } else if (type === 6) {
      const swapped = Buffer.concat([data.subarray(cursor + 4, cursor + 8), data.subarray(cursor, cursor + 4)]);
      values.push({ type: "double", value: swapped.readDoubleLE(0) }); cursor += 8;
    } else if (type === 7) {
      values.push({ type: "integer", value: data.readInt32LE(cursor) }); cursor += 4;
    } else if (type === 8) {
      const index = data[cursor++]; values.push({ type: "constant8", index, value: pool[index] });
    } else if (type === 9) {
      const index = data.readUInt16LE(cursor); cursor += 2;
      values.push({ type: "constant16", index, value: pool[index] });
    } else {
      values.push({ type: `unknown-${type}`, value: null }); break;
    }
  }
  return values;
}

function decodeFunctionHeader(actionCode, data) {
  let cursor = 0;
  const name = readCString(data, cursor); cursor = name.next;
  const parameterCount = data.readUInt16LE(cursor); cursor += 2;
  if (actionCode === 0x8e) {
    cursor += 1 + 2;
    for (let index = 0; index < parameterCount; index += 1) {
      cursor += 1;
      cursor = readCString(data, cursor).next;
    }
  } else {
    for (let index = 0; index < parameterCount; index += 1) cursor = readCString(data, cursor).next;
  }
  const codeSize = data.readUInt16LE(cursor); cursor += 2;
  return { name: name.value, codeSize };
}

function inspectActions(buffer, context, inheritedPool = [], force = false) {
  let cursor = 0;
  let pool = inheritedPool;
  const actions = [];
  while (cursor < buffer.length) {
    const offset = cursor;
    const code = buffer[cursor++];
    if (code === 0) break;
    let length = 0;
    if (code >= 0x80) {
      if (cursor + 2 > buffer.length) break;
      length = buffer.readUInt16LE(cursor); cursor += 2;
    }
    const data = buffer.subarray(cursor, cursor + length);
    cursor += length;
    let detail;
    if (code === 0x88) {
      const count = data.readUInt16LE(0);
      let stringCursor = 2;
      pool = [];
      for (let index = 0; index < count; index += 1) {
        const string = readCString(data, stringCursor);
        pool.push(string.value); stringCursor = string.next;
      }
      detail = { poolMatches: pool.map((value, index) => ({ index, value })).filter((entry) => entry.value.toLowerCase().includes(needle)) };
    } else if (code === 0x96) {
      detail = { values: readPushValues(data, pool) };
    } else if (code === 0x99 || code === 0x9d) {
      detail = { branch: data.readInt16LE(0), target: cursor + data.readInt16LE(0) };
    }
    let functionHeader;
    if (code === 0x9b || code === 0x8e) {
      functionHeader = decodeFunctionHeader(code, data);
      const previousValues = actions.at(-1)?.detail?.values || [];
      const inferredName = [...previousValues].reverse().find((value) => typeof value.value === "string")?.value;
      const functionName = functionHeader.name || inferredName || "<anonymous>";
      detail = { functionName, codeSize: functionHeader.codeSize };
      actions.push({ offset, code, length, detail });
      const body = buffer.subarray(cursor, cursor + functionHeader.codeSize);
      inspectActions(body, `${context}/${functionName}`, pool, functionName.toLowerCase().includes(needle));
      cursor += functionHeader.codeSize;
      continue;
    }
    actions.push({ offset, code, length, detail });
  }

  const interesting = new Set();
  if (force) actions.forEach((_, index) => interesting.add(index));
  actions.forEach((action, index) => {
    const text = JSON.stringify(action.detail || "").toLowerCase();
    if (text.includes(needle)) for (let nearby = Math.max(0, index - 12); nearby <= Math.min(actions.length - 1, index + 20); nearby += 1) interesting.add(nearby);
  });
  if (interesting.size) {
    console.log(`\n=== ${context} ===`);
    for (const index of [...interesting].sort((a, b) => a - b)) console.log(JSON.stringify(actions[index]));
  }
}

const swf = unpackSwf(fs.readFileSync(inputPath));
let cursor = 8;
const rectBytes = Math.ceil((5 + (swf[cursor] >> 3) * 4) / 8);
cursor += rectBytes + 4;
let tagIndex = 0;
while (cursor + 2 <= swf.length) {
  const header = swf.readUInt16LE(cursor);
  const code = header >> 6;
  let length = header & 0x3f;
  let headerSize = 2;
  if (length === 0x3f) { length = swf.readUInt32LE(cursor + 2); headerSize = 6; }
  const data = swf.subarray(cursor + headerSize, cursor + headerSize + length);
  if (code === 12) inspectActions(data, `tag-${tagIndex}-DoAction`);
  if (code === 59 && data.length >= 2) inspectActions(data.subarray(2), `tag-${tagIndex}-DoInitAction-sprite-${data.readUInt16LE(0)}`);
  cursor += headerSize + length;
  tagIndex += 1;
  if (code === 0) break;
}
