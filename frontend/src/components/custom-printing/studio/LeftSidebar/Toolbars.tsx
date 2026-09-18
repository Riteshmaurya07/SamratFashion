"use client";

import React, { useRef } from 'react';
import { Type, Image as ImageIcon, Trash2, Undo2, Redo2 } from 'lucide-react';
import { useCustomDesignStore } from '@/store/useCustomDesignStore';

export const Toolbars = () => {
  const { addElement, removeElement, selectedElementId, undo, redo, historyIndex, history } = useCustomDesignStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddText = () => {
    addElement({
      id: crypto.randomUUID(),
      type: 'TEXT',
      x: 100,
      y: 100,
      width: 200,
      height: 50,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      locked: false,
      zIndex: 1,
      properties: {
        text: 'Hello World',
        fontFamily: 'Arial',
        fontSize: 32,
        fill: '#000000',
      }
    });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // For real implementation, upload to server, then set src
    // For local preview, we use object URL
    const src = URL.createObjectURL(file);
    
    addElement({
      id: crypto.randomUUID(),
      type: 'IMAGE',
      x: 50,
      y: 50,
      width: 150,
      height: 150,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      locked: false,
      zIndex: 1,
      properties: {
        src
      }
    });
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  return (
    <div className="w-full lg:w-16 h-16 lg:h-full bg-white flex lg:flex-col items-center lg:py-4 px-4 lg:px-0 space-x-4 lg:space-x-0 lg:space-y-4 shrink-0 shadow-sm z-20 overflow-x-auto">
      <button 
        onClick={handleAddText}
        className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center hover:bg-black hover:text-white transition-colors"
        title="Add Text"
      >
        <Type size={20} />
      </button>

      <button 
        onClick={() => fileInputRef.current?.click()}
        className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center hover:bg-black hover:text-white transition-colors"
        title="Upload Image"
      >
        <ImageIcon size={20} />
      </button>
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />

      <div className="hidden lg:block w-8 h-px bg-gray-200 my-2" />
      <div className="block lg:hidden h-8 w-px bg-gray-200 mx-2" />

      <button 
        onClick={undo}
        disabled={!canUndo}
        className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${canUndo ? 'bg-gray-50 hover:bg-gray-200' : 'text-gray-300'}`}
        title="Undo"
      >
        <Undo2 size={20} />
      </button>

      <button 
        onClick={redo}
        disabled={!canRedo}
        className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${canRedo ? 'bg-gray-50 hover:bg-gray-200' : 'text-gray-300'}`}
        title="Redo"
      >
        <Redo2 size={20} />
      </button>

      <div className="flex-1" />

      {selectedElementId && (
        <button 
          onClick={() => removeElement(selectedElementId)}
          className="w-10 h-10 rounded-xl bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
          title="Delete Selected"
        >
          <Trash2 size={20} />
        </button>
      )}
    </div>
  );
};
