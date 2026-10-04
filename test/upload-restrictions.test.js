import assert from 'node:assert/strict';
import test from 'node:test';
import { isFileTypeAllowed, validateUpload } from '../worker/src/api/upload.js';

test('isFileTypeAllowed - none mode allows normal files and respects blocked types', () => {
  // Default none mode without blocked types
  const res1 = isFileTypeAllowed({
    filename: 'document.pdf',
    mimeType: 'application/pdf',
    restrictionMode: 'none',
    blockedTypes: 'exe, bat, sh'
  });
  assert.equal(res1.allowed, true);

  // SVG file is allowed when not in blocked types
  const res2 = isFileTypeAllowed({
    filename: 'icon.svg',
    mimeType: 'image/svg+xml',
    restrictionMode: 'none',
    blockedTypes: 'exe, bat, sh'
  });
  assert.equal(res2.allowed, true);

  // Blocked file
  const res3 = isFileTypeAllowed({
    filename: 'virus.exe',
    mimeType: 'application/x-msdownload',
    restrictionMode: 'none',
    blockedTypes: 'exe, bat, sh'
  });
  assert.equal(res3.allowed, false);
  assert.match(res3.reason, /禁止上传/);
});

test('isFileTypeAllowed - blocklist mode blocks specified extensions and MIME types', () => {
  const settings = {
    restrictionMode: 'blocklist',
    blockedTypes: 'exe, bat, sh, php, image/svg+xml'
  };

  assert.equal(isFileTypeAllowed({ filename: 'photo.png', mimeType: 'image/png', ...settings }).allowed, true);
  assert.equal(isFileTypeAllowed({ filename: 'report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ...settings }).allowed, true);
  assert.equal(isFileTypeAllowed({ filename: 'script.sh', mimeType: 'text/x-shellscript', ...settings }).allowed, false);
  assert.equal(isFileTypeAllowed({ filename: 'icon.svg', mimeType: 'image/svg+xml', ...settings }).allowed, false);
});

test('isFileTypeAllowed - supports dot prefix, star prefix and custom formatting in blocked types', () => {
  const settings = {
    restrictionMode: 'blocklist',
    blockedTypes: '.bat, .sh, .exe, *.cmd, *.php'
  };

  assert.equal(isFileTypeAllowed({ filename: 'install.bat', mimeType: 'application/x-bat', ...settings }).allowed, false);
  assert.equal(isFileTypeAllowed({ filename: 'deploy.sh', mimeType: 'text/x-sh', ...settings }).allowed, false);
  assert.equal(isFileTypeAllowed({ filename: 'game.EXE', mimeType: 'application/octet-stream', ...settings }).allowed, false);
  assert.equal(isFileTypeAllowed({ filename: 'run.cmd', mimeType: 'application/cmd', ...settings }).allowed, false);
  assert.equal(isFileTypeAllowed({ filename: 'index.php', mimeType: 'application/x-php', ...settings }).allowed, false);
  assert.equal(isFileTypeAllowed({ filename: 'notes.txt', mimeType: 'text/plain', ...settings }).allowed, true);
  assert.equal(isFileTypeAllowed({ filename: 'image.png', mimeType: 'image/png', ...settings }).allowed, true);
});

test('isFileTypeAllowed - does not falsely match substring in filenames', () => {
  const settings = {
    restrictionMode: 'blocklist',
    blockedTypes: 'exe, bat, sh, php, cmd'
  };

  // Filenames that contain 'bat', 'sh', 'exe', 'cmd', 'php' as substrings must NOT be blocked
  assert.equal(isFileTypeAllowed({ filename: 'batman_movie.pdf', mimeType: 'application/pdf', ...settings }).allowed, true);
  assert.equal(isFileTypeAllowed({ filename: 'batch_processing.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ...settings }).allowed, true);
  assert.equal(isFileTypeAllowed({ filename: 'bash_shell_tutorial.txt', mimeType: 'text/plain', ...settings }).allowed, true);
  assert.equal(isFileTypeAllowed({ filename: 'sheet_financial.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ...settings }).allowed, true);
  assert.equal(isFileTypeAllowed({ filename: 'executive_summary.pdf', mimeType: 'application/pdf', ...settings }).allowed, true);
  assert.equal(isFileTypeAllowed({ filename: 'command_line_guide.md', mimeType: 'text/markdown', ...settings }).allowed, true);
  assert.equal(isFileTypeAllowed({ filename: 'php_interview_questions.pdf', mimeType: 'application/pdf', ...settings }).allowed, true);
});

test('isFileTypeAllowed - allowlist mode only permits specified extensions and MIME wildcards', () => {
  const settings = {
    restrictionMode: 'allowlist',
    allowedTypes: 'image/*, video/*, pdf, doc, docx, zip'
  };

  // Matched by extension
  assert.equal(isFileTypeAllowed({ filename: 'manual.pdf', mimeType: 'application/pdf', ...settings }).allowed, true);
  assert.equal(isFileTypeAllowed({ filename: 'archive.zip', mimeType: 'application/zip', ...settings }).allowed, true);

  // Matched by MIME wildcard
  assert.equal(isFileTypeAllowed({ filename: 'custom_image.bin', mimeType: 'image/webp', ...settings }).allowed, true);
  assert.equal(isFileTypeAllowed({ filename: 'clip.mp4', mimeType: 'video/mp4', ...settings }).allowed, true);

  // Not matched
  const notAllowed = isFileTypeAllowed({ filename: 'program.exe', mimeType: 'application/octet-stream', ...settings });
  assert.equal(notAllowed.allowed, false);
  assert.match(notAllowed.reason, /不在管理员允许上传的白名单中/);
});

test('validateUpload validates max file size and type restrictions', () => {
  const smallFile = new File(['hello'], 'test.txt', { type: 'text/plain' });
  const largeFile = new File([new Uint8Array(25 * 1024 * 1024)], 'large.zip', { type: 'application/zip' });

  // 1. Valid size and type
  assert.doesNotThrow(() => {
    validateUpload(smallFile, { uploadMaxFileSizeMb: 20, uploadRestrictionMode: 'none' });
  });

  // 2. Exceeds max file size
  assert.throws(() => {
    validateUpload(largeFile, { uploadMaxFileSizeMb: 20, uploadRestrictionMode: 'none' });
  }, /文件大小不能超过 20MB/);

  // 3. Blocked file in blocklist mode
  const exeFile = new File(['MZ'], 'setup.exe', { type: 'application/octet-stream' });
  assert.throws(() => {
    validateUpload(exeFile, {
      uploadRestrictionMode: 'blocklist',
      uploadBlockedTypes: 'exe, bat'
    });
  }, /禁止上传/);

  // 4. Dot prefix blocklist matches .bat, .sh, .exe
  const batFile = new File(['@echo off'], 'script.bat', { type: 'application/x-bat' });
  assert.throws(() => {
    validateUpload(batFile, {
      uploadRestrictionMode: 'blocklist',
      uploadBlockedTypes: '.bat, .sh, .exe'
    });
  }, /禁止上传/);

  // 5. Freedom mode with default blocked types still blocks dangerous executables
  assert.throws(() => {
    validateUpload(batFile, {
      uploadRestrictionMode: 'none',
      uploadBlockedTypes: 'exe, bat, cmd, sh, php'
    });
  }, /禁止上传/);
});
