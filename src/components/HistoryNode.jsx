import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { motion } from 'framer-motion';
import { ERA_COLORS } from '../data/historyData';

const handleStyle = {
  width: 6,
  height: 6,
  background: 'rgba(0,0,0,0.18)',
  border: 'none',
};

function HistoryNode({ data, id }) {
  const { label, date, description, era, isRoot, expandable, expanded, onToggle } = data;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.55, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      whileHover={{ scale: 1.025 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => expandable && onToggle(id)}
      className={`relative w-[240px] rounded-2xl border border-black/5 bg-white/85 px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-8px_rgba(0,0,0,0.12)] backdrop-blur-xl transition-shadow duration-200 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_32px_-8px_rgba(0,0,0,0.2)] ${
        expandable ? 'cursor-pointer' : 'cursor-default'
      }`}
    >
      {!isRoot && <Handle type="target" position={Position.Top} style={handleStyle} />}

      <div className="flex items-start gap-2.5">
        <span
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: ERA_COLORS[era] ?? '#8e8e93' }}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight text-ink">{label}</p>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-subink">
            {date}
          </p>
          <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-snug text-subink/90">
            {description}
          </p>
        </div>
      </div>

      {expandable && (
        <>
          <motion.div
            animate={{ rotate: expanded ? 45 : 0 }}
            transition={{ duration: 0.2 }}
            className="absolute -bottom-2.5 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full bg-accent text-white shadow-[0_2px_6px_rgba(0,113,227,0.45)]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M5 0v10M0 5h10"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </motion.div>
          <Handle type="source" position={Position.Bottom} style={handleStyle} />
        </>
      )}
    </motion.div>
  );
}

export default memo(HistoryNode);
