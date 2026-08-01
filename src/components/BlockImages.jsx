import { useRef } from 'react';
import { ACCEPT_ATTRIBUTE } from '../lib/imageFiles';

// Shared image UI, so a block and its expanded view show pictures the same way
// rather than drifting into two designs.

export function AddImageButton({ onFiles, title = 'Add an image', className = '', children }) {
  const input = useRef(null);
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        title={title}
        aria-label={title}
        className={className}
      >
        {children ?? (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect
              x="1.9"
              y="3.2"
              width="12.2"
              height="9.6"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle cx="5.9" cy="6.7" r="1.15" fill="currentColor" />
            <path
              d="M2.6 11.4l3.2-2.7 2.5 2.1 2.3-2 2.8 2.4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          // Cleared so choosing the same file twice in a row still fires a change.
          e.target.value = '';
        }}
      />
    </>
  );
}

// The row of pictures on a block. `object-cover` on a fixed height keeps a row of
// mixed portrait and landscape images tidy; the full shape is visible in the
// expanded view.
export function ImageStrip({ images = [], onOpen, onRemove, uploading = 0 }) {
  if (images.length === 0 && uploading === 0) return null;

  return (
    <div className="mt-2 flex gap-1.5">
      {images.map((image) => (
        <div key={image.id} className="group/img relative min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpen}
            title={image.name}
            className="block w-full cursor-zoom-in overflow-hidden rounded-lg border border-line bg-sunken"
          >
            <img
              src={image.url}
              alt={image.name}
              // Height rather than width, so one image fills the block and four
              // sit in a row without any of them collapsing.
              className="h-[84px] w-full object-cover"
              loading="lazy"
              draggable={false}
            />
          </button>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(image.id)}
              title="Remove image"
              aria-label={`Remove ${image.name}`}
              className="nodrag absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-[11px] leading-none text-white opacity-0 transition-opacity group-hover/img:opacity-100 hover:bg-danger"
            >
              ×
            </button>
          )}
        </div>
      ))}

      {uploading > 0 && (
        <div className="flex h-[84px] min-w-0 flex-1 items-center justify-center rounded-lg border border-dashed border-line2 bg-sunken">
          <span className="text-[10.5px] text-subink">Uploading…</span>
        </div>
      )}
    </div>
  );
}
