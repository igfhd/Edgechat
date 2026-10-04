import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("PWA manifest contains valid standalone configuration and icons", () => {
	const manifestPath = path.resolve("frontend/public/manifest.webmanifest");
	assert.ok(fs.existsSync(manifestPath), "manifest.webmanifest must exist in public directory");

	const content = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
	assert.equal(content.name, "EdgeChat");
	assert.equal(content.short_name, "EdgeChat");
	assert.equal(content.display, "standalone");
	assert.ok(content.icons && content.icons.length >= 1, "Must define icons for PWA installation");
	assert.ok(content.theme_color, "Must define theme_color");
});

test("PWA service worker handles offline precaching and bypasses API routes", () => {
	const swPath = path.resolve("frontend/public/sw.js");
	assert.ok(fs.existsSync(swPath), "sw.js must exist in public directory");

	const code = fs.readFileSync(swPath, "utf-8");
	assert.ok(code.includes("addEventListener('install'"), "Must have install listener");
	assert.ok(code.includes("addEventListener('activate'"), "Must have activate listener");
	assert.ok(code.includes("addEventListener('fetch'"), "Must have fetch listener");
	assert.ok(code.includes("url.pathname.startsWith('/api/')"), "Must bypass /api/ routes");
	assert.ok(code.includes("url.protocol.startsWith('ws')"), "Must bypass WebSockets");
});

test("frontend index.html includes PWA meta tags and manifest link", () => {
	const htmlPath = path.resolve("frontend/index.html");
	const html = fs.readFileSync(htmlPath, "utf-8");

	assert.ok(html.includes('rel="manifest"'), "index.html must include manifest link");
	assert.ok(html.includes('name="apple-mobile-web-app-capable"'), "index.html must support Apple standalone web app");
	assert.ok(html.includes('rel="apple-touch-icon"'), "index.html must include apple touch icon");
});
