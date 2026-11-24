import React from 'react';

interface BrandLogoProps {
  className?: string;
  showFrame?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  className = 'w-12 h-12',
  showFrame = true,
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Obsidian Base Tile */}
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="13"
        fill="#111111"
        stroke={showFrame ? '#2f63ff' : 'none'}
        strokeOpacity={showFrame ? '0.45' : undefined}
        strokeWidth={showFrame ? '1.5' : undefined}
      />

      {/* 2x2 Shift Matrix Grid */}
      <rect x="13" y="13" width="17" height="17" rx="3" fill="#ffffff" />
      <rect x="34" y="13" width="17" height="17" rx="3" fill="#eef2ff" />
      <rect x="13" y="34" width="17" height="17" rx="3" fill="#a9bcff" />
      {/* Active Shift Electric Cobalt */}
      <rect x="34" y="34" width="17" height="17" rx="3" fill="#2f63ff" />
    </svg>
  );
};

interface BrandWordProps {
  className?: string;
}

export const BrandWord: React.FC<BrandWordProps> = ({ className = '' }) => {
  return (
    <span className={`kv-font-display tracking-[0.03em] uppercase font-normal ${className}`.trim()}>
      SKLADIN
    </span>
  );
};
