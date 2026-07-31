import { MARK_PATHS, STROKE, VIEWBOX } from '../lib/logoMark';

// The mark, drawn in `currentColor` so it takes the colour of whatever it sits
// in and needs no light/dark variant. Geometry is shared with the favicon — see
// src/lib/logoMark.js.
//
// `label` makes it an image with a name; without one it is decorative and hidden
// from screen readers, which is correct when it sits beside the word "Lacuna".
export default function Logo({ size = 22, className = '', label }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      fill="none"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <g
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {MARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}
