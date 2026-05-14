'use client';

import React, { useRef, useState, useEffect } from 'react';

/**
 * ChartContainer — Fixes Recharts ResponsiveContainer -1 dimension issue
 *
 * Supports two usage patterns:
 *
 * 1. Render prop (receives explicit width/height):
 * <ChartContainer className="h-72">
 *   {({ width, height }) => (
 *     <LineChart width={width} height={height} ...>
 *       ...
 *     </LineChart>
 *   )}
 * </ChartContainer>
 *
 * 2. Direct children (auto-measures container, no explicit dims passed):
 * <ChartContainer className="h-64">
 *   <ResponsiveContainer width="100%" height="100%">
 *     <BarChart ...>
 *       ...
 *     </BarChart>
 *   </ResponsiveContainer>
 * </ChartContainer>
 */
export default function ChartContainer({
  children,
  className = '',
}: {
  children: ((dims: { width: number; height: number }) => React.ReactNode) | React.ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      if (w > 0 && h > 0 && (w !== dimensions.width || h !== dimensions.height)) {
        setDimensions({ width: w, height: h });
      }
    };

    measure();

    const observer = new ResizeObserver(() => {
      measure();
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [dimensions.width, dimensions.height]);

  // If children is a function, use render prop pattern
  if (typeof children === 'function') {
    return (
      <div ref={containerRef} className={className}>
        {dimensions.width > 0 && dimensions.height > 0 ? (
          children(dimensions)
        ) : (
          <div className="flex items-center justify-center h-full text-app-text4 text-xs animate-pulse">
            Cargando gráfico...
          </div>
        )}
      </div>
    );
  }

  // Direct children pattern — just render them inside the container
  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}
