import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { inflateRawSync } from "node:zlib";

const root = new URL("../outputs/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const port = Number(process.env.PORT || 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${port}`);

    if (url.pathname === "/api/import" && request.method === "POST") {
      const name = (url.searchParams.get("name") || "").toLowerCase();
      const body = await readRequestBody(request);
      let text = "";

      if (name.endsWith(".txt") || name.endsWith(".text")) {
        text = body.toString("utf8");
      } else if (name.endsWith(".docx")) {
        text = extractDocxText(body);
      } else if (name.endsWith(".doc")) {
        return sendJson(response, 400, { error: "Старый формат .doc не поддерживается. Сохраните файл как .docx." });
      } else {
        return sendJson(response, 400, { error: "Поддерживаются только .docx и .txt." });
      }

      return sendJson(response, 200, { text });
    }

    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = normalize(join(root, requested));

    if (!file.startsWith(normalize(root))) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const data = await readFile(file);
    response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    response.end(data);
  } catch (error) {
    if (request.url?.startsWith("/api/")) {
      return sendJson(response, 500, { error: error.message || "Не получилось обработать файл." });
    }
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Serving http://127.0.0.1:${port}`);
});

function sendJson(response, status, data) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 12 * 1024 * 1024) {
        reject(new Error("Файл слишком большой."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function extractDocxText(buffer) {
  const xml = readZipEntry(buffer, "word/document.xml").toString("utf8");
  const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];

  return paragraphs
    .map((paragraph) => {
      const textNodes = paragraph.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) || [];
      return textNodes
        .map((node) => decodeXml(node.replace(/^<w:t[^>]*>/, "").replace(/<\/w:t>$/, "")))
        .join("")
        .trim();
    })
    .filter(Boolean)
    .join("\n");
}

function readZipEntry(buffer, targetName) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error("Не смог прочитать .docx как ZIP-архив.");

  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let offset = centralOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    if (name === targetName) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);

      if (method === 0) return compressed;
      if (method === 8) return inflateRawSync(compressed);
      throw new Error("Этот .docx использует неподдерживаемое сжатие.");
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error("В .docx не найден основной документ Word.");
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 66000); offset -= 1) {
    if (
      buffer[offset] === 0x50 &&
      buffer[offset + 1] === 0x4b &&
      buffer[offset + 2] === 0x05 &&
      buffer[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  return -1;
}

function decodeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
