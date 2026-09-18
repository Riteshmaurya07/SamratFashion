"use client";

import React from 'react';
import { useFabricAdapter } from './useFabricAdapter';

export const CanvasEditor = () => {
  // Dimensions that match the logical printable area bounds mapped by the backend/adapter
  const CANVAS_WIDTH = 400;
  const CANVAS_HEIGHT = 500;
  
  // Initialize and attach adapter sync
  useFabricAdapter('studio-canvas', CANVAS_WIDTH, CANVAS_HEIGHT);

  return (
    <div 
      className="relative bg-white/20 backdrop-blur-sm shadow-xl transition-all"
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
    >
      <canvas id="studio-canvas" className="w-full h-full" />
    </div>
  );
};
