"use client";

import React from 'react';
import { AlignCenterHorizontal, AlignCenterVertical, ArrowDownToLine, ArrowUpToLine } from 'lucide-react';
import { useCustomDesignStore, IDesignElement } from '@/store/useCustomDesignStore';

export const PropertiesPanel = () => {
  const { design, activeZone, selectedElementId, updateElement, pushHistory } = useCustomDesignStore();
  
  const selectedElement = design[activeZone]?.elements.find(e => e.id === selectedElementId);

  if (!selectedElement) {
    return (
      <div className="p-6 text-center text-gray-400 mt-10">
        <p>Select an element to edit its properties.</p>
      </div>
    );
  }

  const handleChange = (key: keyof IDesignElement | string, value: any, isProperty: boolean = false) => {
    if (!selectedElementId) return;
    if (isProperty) {
      updateElement(selectedElementId, {
        properties: { ...selectedElement.properties, [key]: value }
      });
    } else {
      updateElement(selectedElementId, { [key]: value });
    }
  };

  const handleBlur = () => {
    pushHistory(); // Save snapshot after typed change
  };

  const handleCenter = (axis: 'x' | 'y') => {
    // Assuming printable zone is left: 50, top: 100, width: 300, height: 300
    if (axis === 'x') {
      handleChange('x', 50 + 150 - (selectedElement.width * selectedElement.scaleX) / 2);
    } else {
      handleChange('y', 100 + 150 - (selectedElement.height * selectedElement.scaleY) / 2);
    }
    pushHistory();
  };

  const handleZIndex = (direction: 'up' | 'down') => {
    handleChange('zIndex', selectedElement.zIndex + (direction === 'up' ? 1 : -1));
    pushHistory();
  };

  return (
    <div className="p-4 space-y-6">
      <div>
        <h3 className="font-semibold text-gray-800 mb-4 uppercase text-xs tracking-wider">Properties</h3>
        
        {/* Alignment & Layers */}
        <div className="grid grid-cols-4 gap-2 mb-6">
          <button onClick={() => handleCenter('x')} className="p-2 bg-gray-50 rounded hover:bg-gray-200 flex justify-center" title="Center Horizontally"><AlignCenterHorizontal size={16} /></button>
          <button onClick={() => handleCenter('y')} className="p-2 bg-gray-50 rounded hover:bg-gray-200 flex justify-center" title="Center Vertically"><AlignCenterVertical size={16} /></button>
          <button onClick={() => handleZIndex('up')} className="p-2 bg-gray-50 rounded hover:bg-gray-200 flex justify-center" title="Bring Forward"><ArrowUpToLine size={16} /></button>
          <button onClick={() => handleZIndex('down')} className="p-2 bg-gray-50 rounded hover:bg-gray-200 flex justify-center" title="Send Backward"><ArrowDownToLine size={16} /></button>
        </div>

        {/* Common Properties */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Opacity</label>
            <input 
              type="range" 
              min="0.1" 
              max="1" 
              step="0.1"
              value={selectedElement.opacity}
              onChange={(e) => handleChange('opacity', parseFloat(e.target.value))}
              onMouseUp={handleBlur}
              className="w-full"
            />
          </div>
        </div>

        {/* Text Specific Properties */}
        {selectedElement.type === 'TEXT' && (
          <div className="space-y-4 mt-6">
            <h3 className="font-semibold text-gray-800 mb-2 uppercase text-xs tracking-wider">Text Options</h3>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Content</label>
              <textarea 
                value={selectedElement.properties.text || ''}
                onChange={(e) => handleChange('text', e.target.value, true)}
                onBlur={handleBlur}
                className="w-full text-sm p-2 border border-gray-200 rounded-md bg-gray-50 focus:bg-white transition-colors focus:ring-1 focus:ring-black outline-none"
                rows={3}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Color</label>
              <div className="flex space-x-2">
                <input 
                  type="color" 
                  value={selectedElement.properties.fill || '#000000'}
                  onChange={(e) => handleChange('fill', e.target.value, true)}
                  onBlur={handleBlur}
                  className="w-8 h-8 rounded cursor-pointer"
                />
                <span className="text-sm font-mono self-center text-gray-600">
                  {selectedElement.properties.fill || '#000000'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
