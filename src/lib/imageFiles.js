// Getting image files out of the three ways people add them — a file picker, a
// drag, or a paste — and refusing the ones the server would reject anyway.
//
// Checking here as well as on the server is not redundant: it means a 40MB video
// is refused instantly instead of being uploaded first and rejected after.

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(',');

function describeSize(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// Splits a list of files into the ones worth uploading and a human-readable
// reason for each that isn't.
export function sortImageFiles(files) {
  const accepted = [];
  const rejected = [];
  for (const file of files ?? []) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      // SVG is refused on purpose: it can carry script, so the server won't take
      // it either. Say which formats do work rather than just "no".
      rejected.push(`${file.name || 'That file'} isn’t a PNG, JPEG, WebP, or GIF.`);
    } else if (file.size > MAX_IMAGE_BYTES) {
      rejected.push(
        `${file.name || 'That image'} is ${describeSize(file.size)} — the limit is 8MB.`
      );
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}

export function imagesFromDataTransfer(dataTransfer) {
  const files = Array.from(dataTransfer?.files ?? []);
  return sortImageFiles(files);
}

// A pasted screenshot arrives as a clipboard *item*, not a file in `files`, and
// has no name — hence the fallback, or every pasted image would be called "".
export function imagesFromClipboard(clipboardData) {
  const files = [];
  for (const item of clipboardData?.items ?? []) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return sortImageFiles(files);
}

export function hasImageFiles(dataTransfer) {
  return Array.from(dataTransfer?.types ?? []).includes('Files');
}
