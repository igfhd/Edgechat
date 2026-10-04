import * as fflate from 'fflate';

/**
 * Parses raw TAR binary buffer into a path-to-Uint8Array dictionary.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Record<string, Uint8Array>}
 */
export function parseTar(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const files = {};
  let offset = 0;

  function readString(start, length) {
    let end = start;
    while (end < start + length && u8[end] !== 0) end++;
    return new TextDecoder().decode(u8.subarray(start, end)).trim();
  }

  function readOctal(start, length) {
    const str = readString(start, length);
    return str ? parseInt(str, 8) : 0;
  }

  while (offset + 512 <= u8.length) {
    let isEmpty = true;
    for (let i = 0; i < 512; i++) {
      if (u8[offset + i] !== 0) {
        isEmpty = false;
        break;
      }
    }
    if (isEmpty) break;

    const name = readString(offset, 100);
    const size = readOctal(offset + 124, 12);
    const type = String.fromCharCode(u8[offset + 156]);
    const prefix = readString(offset + 345, 155);
    const fullPath = (prefix ? `${prefix}/${name}` : name).replace(/^\/+/, '');

    offset += 512;
    if ((type === '0' || type === '\0' || type === '') && name) {
      files[fullPath] = u8.slice(offset, offset + size);
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

/**
 * Async ZIP decompressor using fflate.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Promise<Record<string, Uint8Array>>}
 */
export function unzipAsync(buffer) {
  return new Promise((resolve, reject) => {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    fflate.unzip(u8, (err, unzipped) => {
      if (err) return reject(err);
      resolve(unzipped);
    });
  });
}

/**
 * Async GZIP decompressor using fflate.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Promise<Uint8Array>}
 */
export function gunzipAsync(buffer) {
  return new Promise((resolve, reject) => {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    fflate.gunzip(u8, (err, decompressed) => {
      if (err) return reject(err);
      resolve(decompressed);
    });
  });
}

/**
 * Smart Archive Parser supporting .zip, .tar, .gz, .tar.gz, .tgz
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {string} filename
 * @returns {Promise<Record<string, Uint8Array>>}
 */
export async function parseArchive(buffer, filename = '') {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const nameLower = (filename || '').toLowerCase();

  // 1. Magic bytes check
  const isZip = u8[0] === 0x50 && u8[1] === 0x4b; // PK
  const isGzip = u8[0] === 0x1f && u8[1] === 0x8b;
  const is7z = u8[0] === 0x37 && u8[1] === 0x7a && u8[2] === 0xbc && u8[3] === 0xaf && u8[4] === 0x27 && u8[5] === 0x1c;
  const isRar = (u8[0] === 0x52 && u8[1] === 0x61 && u8[2] === 0x72 && u8[3] === 0x21);

  if (is7z || nameLower.endsWith('.7z')) {
    throw new Error('7z 采用了专有的 LZMA 压缩算法，暂不支持纯网页端免下载解析。请直接下载到本地使用 7-Zip / WinRAR 查看，或打包为 .zip / .tar.gz 格式上传即可在线浏览！');
  }

  if (isRar || nameLower.endsWith('.rar')) {
    throw new Error('RAR 采用了专有的 RAR5 压缩算法，暂不支持纯网页端免下载解析。请直接下载到本地使用 WinRAR 查看，或打包为 .zip 格式上传即可在线浏览！');
  }

  let result = null;

  if (isZip || nameLower.endsWith('.zip')) {
    result = await unzipAsync(u8);
  } else if (isGzip || nameLower.endsWith('.gz') || nameLower.endsWith('.tgz')) {
    const uncompressed = await gunzipAsync(u8);
    if (nameLower.endsWith('.tar.gz') || nameLower.endsWith('.tgz') || nameLower.endsWith('.tar')) {
      result = parseTar(uncompressed);
    } else {
      const baseName = filename.replace(/\.gz$/i, '') || 'extracted_file';
      result = { [baseName]: uncompressed };
    }
  } else if (nameLower.endsWith('.tar')) {
    result = parseTar(u8);
  } else {
    // Fallback: try unzip first, then tar
    try {
      result = await unzipAsync(u8);
    } catch {
      result = parseTar(u8);
    }
  }

  if (!result || Object.keys(result).length === 0) {
    throw new Error('未能从此压缩包中读取到有效文件列表，可能文件已损坏或使用了不支持的压缩算法。请直接下载到本地查看。');
  }

  return result;
}

/**
 * Convert flat { [path]: Uint8Array } to hierarchical tree
 */
export function buildFileTree(filesMap) {
  const root = {
    name: 'root',
    path: '',
    isFolder: true,
    children: [],
    totalFiles: 0,
    totalSize: 0
  };

  const folderMap = new Map();
  folderMap.set('', root);

  const paths = Object.keys(filesMap).sort();

  for (const rawPath of paths) {
    // Normalize path separators and remove leading / trailing slashes
    const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.endsWith('/')) {
      // Directory entry in ZIP
      const folderPath = normalized.replace(/\/+$/, '');
      if (folderPath) {
        ensureFolder(folderPath, folderMap, root);
      }
      continue;
    }

    const segments = normalized.split('/');
    const fileName = segments.pop();
    const parentPath = segments.join('/');

    const parentFolder = ensureFolder(parentPath, folderMap, root);
    const data = filesMap[rawPath];
    const size = data?.byteLength || 0;

    const fileNode = {
      name: fileName,
      path: normalized,
      isFolder: false,
      size,
      data
    };

    parentFolder.children.push(fileNode);
    root.totalFiles++;
    root.totalSize += size;
  }

  // Sort all children: folders first, then alphabetical
  sortTreeNode(root);

  return root;
}

function ensureFolder(folderPath, folderMap, root) {
  if (!folderPath) return root;
  if (folderMap.has(folderPath)) return folderMap.get(folderPath);

  const segments = folderPath.split('/');
  let currentPath = '';
  let parent = root;

  for (const seg of segments) {
    currentPath = currentPath ? `${currentPath}/${seg}` : seg;
    if (folderMap.has(currentPath)) {
      parent = folderMap.get(currentPath);
    } else {
      const newFolder = {
        name: seg,
        path: currentPath,
        isFolder: true,
        children: []
      };
      parent.children.push(newFolder);
      folderMap.set(currentPath, newFolder);
      parent = newFolder;
    }
  }

  return parent;
}

function sortTreeNode(node) {
  if (!node.children?.length) return;
  node.children.sort((a, b) => {
    if (a.isFolder && !b.isFolder) return -1;
    if (!a.isFolder && b.isFolder) return 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
  for (const child of node.children) {
    if (child.isFolder) {
      sortTreeNode(child);
    }
  }
}

/**
 * Returns emoji icon for file or folder
 */
export function getArchiveItemIcon(item) {
  if (item.isFolder) return '📁';
  const name = item.name || '';
  const ext = (name.split('.').pop() || '').toLowerCase();

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return '🖼️';
  if (['mp4', 'webm', 'mov', 'mkv', 'avi', 'ogg'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) return '🎵';
  if (ext === 'pdf') return '📕';
  if (['md', 'markdown'].includes(ext)) return '📖';
  if (['csv', 'tsv'].includes(ext)) return '📊';
  if (['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'].includes(ext)) return '📑';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) return '📦';
  if (['js', 'ts', 'jsx', 'tsx', 'vue', 'json', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'rb', 'html', 'htm', 'css', 'scss', 'sql', 'sh', 'yaml', 'yml', 'toml', 'ini', 'env', 'log', 'txt'].includes(ext)) return '📝';
  return '📄';
}

/**
 * Return MIME type for file based on name
 */
export function getArchiveFileMime(name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const mimeMap = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    avif: 'image/avif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    markdown: 'text/markdown',
    json: 'application/json',
    html: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    ts: 'text/plain',
    csv: 'text/csv'
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Trigger client-side browser download for a sub-file
 */
export function downloadArchiveSubFile(uint8Array, filename) {
  const mime = getArchiveFileMime(filename);
  const blob = new Blob([uint8Array], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Async ZIP compressor using fflate.
 * @param {Record<string, Uint8Array>} filesMap
 * @returns {Promise<Uint8Array>}
 */
export function createZipArchive(filesMap) {
  return new Promise((resolve, reject) => {
    fflate.zip(filesMap, { level: 6 }, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

/**
 * Trigger client-side browser download for a generated ZIP archive
 * @param {Uint8Array} zipUint8Array
 * @param {string} zipFilename
 */
export function downloadZipArchive(zipUint8Array, zipFilename = 'archive.zip') {
  const blob = new Blob([zipUint8Array], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
