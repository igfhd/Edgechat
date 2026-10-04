export function normalizeContentType(value) {
	return String(value || "")
		.split(";")[0]
		.trim()
		.toLowerCase();
}

export function sanitizeFilename(value, fallback = "file") {
	const cleaned = Array.from(
		String(value || "")
			.trim()
			.replaceAll("/", "_")
			.replaceAll("\\", "_"),
	)
		.filter((character) => {
			const codePoint = character.codePointAt(0);
			return codePoint === undefined || (codePoint >= 0x20 && codePoint !== 0x7f);
		})
		.join("");
	return cleaned.slice(0, 180) || fallback;
}

export function safeFilenameExtension(filename) {
	const cleanName = sanitizeFilename(filename);
	const dotIndex = cleanName.lastIndexOf(".");
	if (dotIndex <= 0) return "";
	const extension = cleanName.slice(dotIndex + 1).toLowerCase();
	return /^[a-z0-9]{1,10}$/.test(extension) ? `.${extension}` : "";
}
