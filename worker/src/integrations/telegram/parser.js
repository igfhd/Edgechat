function displayName(user) {
	const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
	return name || user?.username || `Telegram ${user?.id || "用户"}`;
}

function parseAttachment(message) {
	if (Array.isArray(message.photo) && message.photo.length) {
		const photo = message.photo.at(-1);
		return {
			kind: "photo",
			fileId: String(photo.file_id),
			fileUniqueId: String(photo.file_unique_id || ""),
			fileName: `photo-${message.message_id}.jpg`,
			mimeType: "image/jpeg",
			fileSize: Number(photo.file_size || 0),
		};
	}
	if (message.video?.file_id) {
		return {
			kind: "video",
			fileId: String(message.video.file_id),
			fileUniqueId: String(message.video.file_unique_id || ""),
			fileName: message.video.file_name || `video-${message.message_id}.mp4`,
			mimeType: message.video.mime_type || "video/mp4",
			fileSize: Number(message.video.file_size || 0),
		};
	}
	if (message.document?.file_id) {
		return {
			kind: "document",
			fileId: String(message.document.file_id),
			fileUniqueId: String(message.document.file_unique_id || ""),
			fileName: message.document.file_name || `file-${message.message_id}`,
			mimeType: message.document.mime_type || "application/octet-stream",
			fileSize: Number(message.document.file_size || 0),
		};
	}
	return null;
}

export function parseTelegramMessageUpdate(update) {
	const message = update?.message || update?.channel_post;
	if (!message?.chat) {
		return null;
	}

	const isChannel = message.chat.type === "channel" || Boolean(update?.channel_post);
	let sender;
	if (isChannel && !message.from) {
		const channelTitle = message.chat.title || message.chat.username || "Telegram 频道";
		const author = message.author_signature ? `${channelTitle} (${message.author_signature})` : channelTitle;
		sender = {
			id: String(message.chat.id),
			displayName: author,
			avatarUrl: "",
		};
	} else if (message.from && !message.from.is_bot) {
		sender = {
			id: String(message.from.id),
			displayName: displayName(message.from),
			avatarUrl: "",
		};
	} else {
		return null;
	}

	if (!Number.isInteger(Number(message.message_id))) {
		return null;
	}
	const attachment = parseAttachment(message);
	const content = typeof message.text === "string" ? message.text : String(message.caption || "");
	if (!content.trim() && !attachment) {
		return null;
	}

	return {
		telegramChatId: String(message.chat.id),
		telegramChatTitle: message.chat.title || message.chat.username || "",
		telegramMessageId: Number(message.message_id),
		sourceMessageId: `${message.chat.id}:${message.message_id}`,
		content,
		attachment,
		sender,
	};
}
