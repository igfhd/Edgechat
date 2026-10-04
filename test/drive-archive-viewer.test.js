import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fflate from 'fflate';
import {
  parseArchive,
  parseTar,
  buildFileTree,
  getArchiveItemIcon,
  getArchiveFileMime,
  createZipArchive
} from '../frontend/src/utils/archiveUtils.js';

describe('云盘纯客户端解压与压缩包查看器 (Drive Archive Viewer)', () => {
  it('能够精准解压并构建多层级 ZIP 文件目录树', async () => {
    const zipData = fflate.zipSync({
      'documents/readme.md': fflate.strToU8('# 项目说明文档'),
      'documents/notes/todo.txt': fflate.strToU8('1. 测试解压'),
      'src/index.js': fflate.strToU8('console.log("hello");'),
      'images/logo.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      'root_config.json': fflate.strToU8('{"version": "1.0"}')
    });

    const parsed = await parseArchive(zipData, 'test-package.zip');
    assert.ok(parsed, '解析结果不应为空');
    assert.equal(Object.keys(parsed).length, 5);

    const tree = buildFileTree(parsed);
    assert.equal(tree.totalFiles, 5);
    assert.ok(tree.totalSize > 0);

    // Folders should be sorted first: documents, images, src, then root_config.json
    const rootFolders = tree.children.filter((c) => c.isFolder).map((c) => c.name);
    const rootFiles = tree.children.filter((c) => !c.isFolder).map((c) => c.name);

    assert.deepEqual(rootFolders, ['documents', 'images', 'src']);
    assert.deepEqual(rootFiles, ['root_config.json']);

    // Check nested directory
    const docFolder = tree.children.find((c) => c.name === 'documents');
    assert.ok(docFolder?.isFolder);
    const subNotes = docFolder.children.find((c) => c.name === 'notes');
    assert.ok(subNotes?.isFolder);
    assert.equal(subNotes.children[0].name, 'todo.txt');
  });

  it('支持 TAR 与 TAR.GZ 格式文件的解压与读取', async () => {
    // Construct standard TAR header and payload for test.txt
    const content = new TextEncoder().encode('Hello TAR file content');
    const tarBuf = new Uint8Array(1024); // 512 header + 512 data block

    // Write filename at offset 0
    const nameBytes = new TextEncoder().encode('sub/demo.txt');
    tarBuf.set(nameBytes, 0);

    // Write size octal string at offset 124 (12 bytes)
    const sizeStr = `${content.length.toString(8).padStart(11, '0')} `;
    tarBuf.set(new TextEncoder().encode(sizeStr), 124);

    // Write typeflag '0' at offset 156
    tarBuf[156] = 48; // '0'

    // Write magic 'ustar' at offset 257
    tarBuf.set(new TextEncoder().encode('ustar'), 257);

    // Write file content at offset 512
    tarBuf.set(content, 512);

    const parsedTar = parseTar(tarBuf);
    assert.ok(parsedTar['sub/demo.txt'], 'TAR 文件应被正确提取');
    assert.equal(new TextDecoder().decode(parsedTar['sub/demo.txt']), 'Hello TAR file content');

    // Test GZIP wrapped TAR
    const gzipped = fflate.gzipSync(tarBuf);
    const parsedGz = await parseArchive(gzipped, 'archive.tar.gz');
    assert.ok(parsedGz['sub/demo.txt'], 'TAR.GZ 应被解压并提取');
  });

  it('能为不同类型子文件匹配准确的图标与 MIME 类型', () => {
    assert.equal(getArchiveItemIcon({ isFolder: true, name: 'dir' }), '📁');
    assert.equal(getArchiveItemIcon({ isFolder: false, name: 'photo.jpg' }), '🖼️');
    assert.equal(getArchiveItemIcon({ isFolder: false, name: 'movie.mp4' }), '🎬');
    assert.equal(getArchiveItemIcon({ isFolder: false, name: 'song.mp3' }), '🎵');
    assert.equal(getArchiveItemIcon({ isFolder: false, name: 'doc.pdf' }), '📕');
    assert.equal(getArchiveItemIcon({ isFolder: false, name: 'notes.md' }), '📖');
    assert.equal(getArchiveItemIcon({ isFolder: false, name: 'data.csv' }), '📊');
    assert.equal(getArchiveItemIcon({ isFolder: false, name: 'code.js' }), '📝');

    assert.equal(getArchiveFileMime('pic.png'), 'image/png');
    assert.equal(getArchiveFileMime('page.html'), 'text/html');
    assert.equal(getArchiveFileMime('readme.md'), 'text/markdown');
    assert.equal(getArchiveFileMime('doc.pdf'), 'application/pdf');
  });

  it('能准确拦截 7z 与 RAR 专有格式并抛出清晰友好的引导提示', async () => {
    // 7z header signature: 37 7A BC AF 27 1C
    const mock7z = new Uint8Array([0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C, 0, 0, 0, 0]);
    await assert.rejects(
      async () => {
        await parseArchive(mock7z, 'test.7z');
      },
      /7z 采用了专有的 LZMA 压缩算法/
    );

    // RAR header signature: 52 61 72 21
    const mockRar = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00]);
    await assert.rejects(
      async () => {
        await parseArchive(mockRar, 'test.rar');
      },
      /RAR 采用了专有的 RAR5 压缩算法/
    );
  });
  it('能够解析纯多层级空文件夹的 ZIP 文件并构建完整层级树', async () => {
    const zipData = fflate.zipSync({
      'level1/level2/level3/': new Uint8Array(0),
      'empty_folder/': new Uint8Array(0)
    });

    const parsed = await parseArchive(zipData, 'empty-dirs.zip');
    assert.ok(parsed, '解析结果不应为空');

    const tree = buildFileTree(parsed);
    assert.equal(tree.totalFiles, 0);

    const rootFolders = tree.children.filter((c) => c.isFolder).map((c) => c.name);
    assert.deepEqual(rootFolders, ['empty_folder', 'level1']);

    const l1 = tree.children.find((c) => c.name === 'level1');
    assert.ok(l1?.isFolder);
    const l2 = l1.children.find((c) => c.name === 'level2');
    assert.ok(l2?.isFolder);
    const l3 = l2.children.find((c) => c.name === 'level3');
    assert.ok(l3?.isFolder);
    assert.equal(l3.children.length, 0);
  });

  it('支持纯客户端异步生成 ZIP 压缩包 (createZipArchive)', async () => {
    const filesToZip = {
      'docs/report.txt': fflate.strToU8('Hello World report'),
      'images/photo.png': new Uint8Array([1, 2, 3, 4]),
      'emptyDir/': new Uint8Array(0)
    };

    const zipBuffer = await createZipArchive(filesToZip);
    assert.ok(zipBuffer instanceof Uint8Array);
    assert.ok(zipBuffer.length > 0);

    // Verify it can be decompressed back
    const parsed = await parseArchive(zipBuffer, 'test.zip');
    assert.ok(parsed['docs/report.txt']);
    assert.equal(new TextDecoder().decode(parsed['docs/report.txt']), 'Hello World report');
    assert.ok(parsed['images/photo.png']);
    assert.equal(parsed['images/photo.png'].length, 4);
  });
});
