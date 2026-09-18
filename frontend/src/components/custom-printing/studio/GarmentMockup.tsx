import React from 'react';
import { useCustomDesignStore } from '@/store/useCustomDesignStore';

export const GarmentMockup = ({ children }: { children: React.ReactNode }) => {
  const { activeZone, configurations, activeConfigIndex } = useCustomDesignStore();
  const activeColor = configurations[activeConfigIndex]?.color || '#ffffff';

  // Architecture: 
  // 1. Base Garment Color
  // 2. Design Layer (Canvas)
  // 3. Texture/Shadows Overlay (pointer-events-none, mix-blend-multiply)
  
  return (
    <div className="relative w-full h-full min-h-[600px] bg-gray-50 rounded-lg flex items-center justify-center overflow-hidden border border-gray-200 shadow-inner">
      {/* 1. Base Garment Color */}
      <div 
        className="absolute w-[450px] h-[550px] rounded-[60px] transition-colors duration-300"
        style={{ backgroundColor: activeColor }}
      >
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-8 bg-gray-50 rounded-b-full" />
      </div>

      {/* Background active zone text (under canvas) */}
      <div className="absolute inset-0 flex items-center justify-center font-black text-gray-800/5 text-6xl uppercase pointer-events-none tracking-widest z-0">
        {activeZone.replace(/([A-Z])/g, ' $1').trim()}
      </div>

      {/* 2. The Canvas Editor Layer - The Design */}
      <div className="relative z-10">
        {children}
      </div>

      {/* 3. Texture / Shadow Overlay */}
      {/* In a production app, this would be `<img src="/shadows.png" className="mix-blend-multiply" />` */}
      <div 
        className="absolute w-[450px] h-[550px] rounded-[60px] pointer-events-none z-20 mix-blend-multiply opacity-30"
        style={{
          background: 'radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.8) 0%, rgba(0,0,0,0) 40%), radial-gradient(ellipse at 70% 80%, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 60%)',
          boxShadow: 'inset 0 0 50px rgba(0,0,0,0.1)'
        }}
      />
    </div>
  );
};
