import type { IBinaryData, IExecuteFunctions } from 'n8n-workflow';
import { BINARY_ENCODING, NodeOperationError } from 'n8n-workflow';

import type { UploadMimeType } from './constants';
import { UPLOAD_TIMEOUT_MS } from './constants';
import { klapRequest } from './transport';

const MIME_ALIASES: Record<string, UploadMimeType> = {
	'video/mp4': 'video/mp4',
	'video/x-m4v': 'video/mp4',
	'video/m4v': 'video/mp4',
	'video/quicktime': 'video/quicktime',
	'video/webm': 'video/webm',
};

const EXTENSIONS: Record<string, UploadMimeType> = {
	mp4: 'video/mp4',
	m4v: 'video/mp4',
	mov: 'video/quicktime',
	qt: 'video/quicktime',
	webm: 'video/webm',
};

/** The upload type Klap accepts for this file (MP4, MOV or WebM), from its MIME type or extension. */
export function uploadMimeType(
	binary: Pick<IBinaryData, 'mimeType' | 'fileName' | 'fileExtension'>,
) {
	const mime = (binary.mimeType ?? '').split(';')[0].trim().toLowerCase();
	if (MIME_ALIASES[mime]) return MIME_ALIASES[mime];
	const extension = (binary.fileExtension ?? binary.fileName?.split('.').pop() ?? '').toLowerCase();
	return EXTENSIONS[extension];
}

/**
 * Sends the file's bytes to the signed Cloud Storage URL Klap handed out. The
 * URL carries its own authorization, so no credential goes with it.
 */
async function putToSignedUrl(
	context: IExecuteFunctions,
	url: string,
	contentType: UploadMimeType,
	binary: IBinaryData,
) {
	let body: Buffer;
	let contentLength: number;
	if (binary.id) {
		// Stored outside memory (filesystem or S3 mode): stream it instead of loading it whole.
		const metadata = await context.helpers.getBinaryMetadata(binary.id);
		body = (await context.helpers.getBinaryStream(binary.id)) as unknown as Buffer;
		contentLength = metadata.fileSize;
	} else {
		body = Buffer.from(binary.data, BINARY_ENCODING);
		contentLength = body.length;
	}
	await context.helpers.httpRequest({
		method: 'PUT',
		url,
		body,
		headers: { 'Content-Type': contentType, 'Content-Length': contentLength },
		json: false,
		timeout: UPLOAD_TIMEOUT_MS,
	});
}

/**
 * Uploads an input binary to Klap (signed upload URL, PUT, signed read URL) and
 * returns the URL to clip it from, valid 48 hours.
 */
export async function uploadBinaryVideo(
	this: IExecuteFunctions,
	itemIndex: number,
	binaryPropertyName: string,
): Promise<{ sourceUrl: string; fileName?: string }> {
	const binary = this.helpers.assertBinaryData(itemIndex, binaryPropertyName);
	const type = uploadMimeType(binary);
	if (!type) {
		throw new NodeOperationError(
			this.getNode(),
			`Klap accepts MP4, MOV and WebM videos. The file in "${binaryPropertyName}" is ${
				binary.mimeType || 'of an unknown type'
			}.`,
			{ itemIndex },
		);
	}

	const upload = await klapRequest<{ signed_upload_url: string; filename: string }>(
		this,
		'POST',
		'/media/upload',
		{ body: { type }, itemIndex },
	);

	try {
		await putToSignedUrl(this, upload.signed_upload_url, type, binary);
	} catch (error) {
		throw new NodeOperationError(
			this.getNode(),
			"Klap couldn't receive the video file. Try again in a minute.",
			{ itemIndex, description: (error as Error).message },
		);
	}

	const read = await klapRequest<{ signed_read_url: string }>(this, 'GET', '/media/upload', {
		qs: { filename: upload.filename },
		itemIndex,
	});

	return { sourceUrl: read.signed_read_url, fileName: binary.fileName };
}
