import React from 'react';
import { IDesignLayout } from '@/store/useCustomDesignStore';

interface Props {
  design: IDesignLayout;
  zone: 'front' | 'back' | 'leftSleeve' | 'rightSleeve';
  width?: number;
  height?: number;
}

export const ReadOnlyDesignCanvas: React.FC<Props> = ({ design, zone, width = 300, height = 300 }) => {
  const elements = design[zone]?.elements || [];

  return (
    <div 
      className="relative bg-white border border-gray-200 shadow-inner overflow-hidden" 
      style={{ width, height }}
    >
      {/* Printable Area Guide (approximate) */}
      <div className="absolute inset-0 m-auto border-2 border-dashed border-gray-200/50 pointer-events-none" style={{ width: width * 0.6, height: height * 0.8 }} />
      
      {elements.map((el) => {
        // We scale down the coordinates. Assuming original canvas was 400x500.
        // For simplicity, we just use raw values and let overflow hidden handle it.
        const left = el.x;
        const top = el.y;
        
        return (
          <div
            key={el.id}
            className="absolute origin-top-left flex items-center justify-center"
            style={{
              left,
              top,
              width: el.width,
              height: el.height,
              transform: `scale(${el.scaleX}, ${el.scaleY}) rotate(${el.rotation}deg)`,
              opacity: el.opacity,
              zIndex: el.zIndex,
            }}
          >
            {el.type === 'TEXT' ? (
              <span style={{ 
                fontFamily: el.properties.fontFamily, 
                fontSize: el.properties.fontSize,
                color: el.properties.fill,
                fontWeight: el.properties.fontWeight,
                textAlign: 'center',
                width: '100%',
                lineHeight: 1
              }}>
                {el.properties.text}
              </span>
            ) : el.type === 'IMAGE' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={el.properties.src} alt="Design element" className="w-full h-full object-contain" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
